const QRCode = require('qrcode');

const TEAM_COLORS = [
  '#FF2D55', '#5856D6', '#FF9500', '#34C759',
  '#00C7BE', '#FF375F', '#BF5AF2', '#FFD60A'
];
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// The games a tournament can string together, and how each one's config maps.
// `twoSided` games (Family Feud, Kill & Injury) demand exactly two sides — in an
// individuals tournament the field is auto-split into two squads for them.
const GAME_CATALOG = {
  'grab-the-mic':   { name: 'Grab the Mic', icon: '🎤', twoSided: false, lengthLabel: 'Play to', lengthDefault: 10 },
  'family-feud':    { name: 'Family Feud',  icon: '🎯', twoSided: true,  lengthLabel: 'Questions', lengthDefault: 5 },
  'text-twist':     { name: 'Text Twist',   icon: '🔤', twoSided: false, lengthLabel: 'Rounds', lengthDefault: 3 },
  'kill-and-injury':{ name: 'Kill & Injury',icon: '🕵️', twoSided: true,  lengthLabel: 'Matches', lengthDefault: 3 }
};

const rooms = new Map();

function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

// Cumulative tournament standings — score here is PLACEMENT points earned across
// games, not any single game's raw score.
function getStandings(room) {
  return room.teams
    .map((t, i) => ({ index: i, name: t.name, color: t.color, score: t.score }))
    .sort((a, b) => b.score - a.score);
}

function rawTeams(room) {
  return room.teams.map((t, i) => ({ index: i, name: t.name, color: t.color, score: t.score }));
}

function publicPlayers(room) {
  return room.players.map(p => ({ name: p.name, teamIndex: p.teamIndex, connected: p.connected }));
}

// Sanitise the host's game plan against the catalog: known slugs only, sane
// lengths, carry through per-game config.
function sanitisePlan(plan) {
  if (!Array.isArray(plan)) return [];
  return plan.slice(0, 12).map((g, i) => {
    const slug = GAME_CATALOG[g && g.slug] ? g.slug : null;
    if (!slug) return null;
    const cat = GAME_CATALOG[slug];
    const length = Math.min(Math.max(parseInt(g.length) || cat.lengthDefault, 1), 50);
    return {
      id: `g${i}`,
      slug,
      name: cat.name,
      icon: cat.icon,
      twoSided: cat.twoSided,
      length,
      config: (g.config && typeof g.config === 'object') ? g.config : {}
    };
  }).filter(Boolean);
}

function sanitisePlacement(placement) {
  const arr = Array.isArray(placement)
    ? placement.map(n => parseInt(n)).filter(n => !isNaN(n) && n >= 0)
    : [];
  if (!arr.length) return [10, 7, 5, 3, 1];
  return arr.slice(0, 8);
}

// Everything a client needs to render the current moment. Kept identical for
// host and player — the tournament has no hidden per-side data (each game
// guards its own secrets while it runs).
function snapshot(room, teamIndex) {
  return {
    phase: room.phase,
    mode: room.mode,
    plan: room.plan,
    placement: room.placement,
    gameIndex: room.gameIndex,
    teams: rawTeams(room),
    standings: getStandings(room),
    teamNames: room.teams.map(t => t.name),
    teamColors: room.teams.map(t => t.color),
    results: room.results,
    myTeamIndex: typeof teamIndex === 'number' ? teamIndex : null
  };
}

module.exports = function registerTournament(namespace, localIP, port) {

  function emitPlayers(room) {
    if (!room.hostSocketId) return;
    namespace.to(room.hostSocketId).emit('players-update', {
      allPlayers: publicPlayers(room),
      standings: getStandings(room),
      teams: rawTeams(room)
    });
  }

  function bindPlayer(socket, room, player) {
    player.socketId = socket.id;
    player.connected = true;
    socket.join(room.roomCode);
    socket.roomCode = room.roomCode;
    socket.playerName = player.name;
    socket.teamIndex = player.teamIndex;
    socket.playerId = player.playerId;
    socket.isHost = false;
    socket.emit('joined', { roomCode: room.roomCode, teamIndex: player.teamIndex, ...snapshot(room, player.teamIndex) });
    emitPlayers(room);
  }

  namespace.on('connection', (socket) => {

    socket.on('create-tournament', ({ mode, teamCount, teamNames, plan, placement, baseUrl }) => {
      try {
        console.log('[tournament] create-tournament from', socket.id);
        const gameMode = mode === 'individual' ? 'individual' : 'teams';

        let teams = [];
        if (gameMode === 'teams') {
          const count = Math.min(Math.max(parseInt(teamCount) || 2, 2), 8);
          teams = Array.from({ length: count }, (_, i) => ({
            name: ((teamNames || [])[i] || `Team ${i + 1}`).trim() || `Team ${i + 1}`,
            color: TEAM_COLORS[i],
            score: 0
          }));
        }

        const cleanPlan = sanitisePlan(plan);
        if (!cleanPlan.length) {
          socket.emit('create-tournament-error', { message: 'Pick at least one game for the tournament.' });
          return;
        }

        const roomCode = generateRoomCode();
        const room = {
          roomCode,
          hostSocketId: socket.id,
          mode: gameMode,
          teams,
          players: [],
          plan: cleanPlan,
          placement: sanitisePlacement(placement),
          phase: 'lobby',
          gameIndex: -1,          // -1 = lobby; 0..n-1 once games begin
          results: [],            // one entry per completed game (Stage 2+)
          liveGameRoom: null
        };

        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;

        // Host might have opened the page on localhost — players on phones
        // can't reach that, so swap localhost/127.0.0.1 for the LAN IP.
        const isLocalhost = baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(baseUrl);
        const playerBaseUrl = (!baseUrl || isLocalhost) ? `http://${localIP}:${port}` : baseUrl;
        const joinUrl = `${playerBaseUrl}/games/tournament/player.html?room=${roomCode}`;

        console.log('[tournament] Created:', roomCode, '| mode:', gameMode,
          '| games:', cleanPlan.map(g => g.slug).join(' → '));

        socket.emit('tournament-created', {
          roomCode, joinUrl, localIP, port,
          mode: gameMode, teams: rawTeams(room), plan: cleanPlan, placement: room.placement,
          qrDataUrl: null
        });

        QRCode.toDataURL(joinUrl, { width: 200, margin: 1, color: { dark: '#ffffff', light: '#0a0a18' } })
          .then(qrDataUrl => socket.emit('qr-ready', { qrDataUrl }))
          .catch(e => console.error('[tournament] QR error:', e.message));

      } catch (err) {
        console.error('[tournament] create-tournament error:', err);
        socket.emit('create-tournament-error', { message: 'Failed to create tournament: ' + err.message });
      }
    });

    socket.on('check-room', ({ roomCode }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.phase === 'complete') {
        socket.emit('room-check-result', {
          found: false,
          message: room ? 'This tournament has ended.' : 'Tournament not found. Check the code and try again.'
        });
        return;
      }
      socket.emit('room-check-result', {
        found: true,
        mode: room.mode,
        teams: room.teams.map(t => ({ name: t.name, color: t.color }))
      });
    });

    socket.on('join-room', ({ roomCode, playerName, teamIndex, playerId }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.phase === 'complete') {
        socket.emit('join-error', { message: room ? 'This tournament has ended.' : 'Tournament not found.' });
        return;
      }
      const name = (playerName || '').trim() || 'Anonymous';
      const pid = playerId ? String(playerId).slice(0, 64) : null;

      // Same playerId = the same phone returning (screen-locked, re-scanned QR,
      // or coming back from a game). Re-bind to the existing slot.
      const existing = pid ? room.players.find(p => p.playerId === pid) : null;
      if (existing) {
        existing.name = name;
        if (room.mode === 'individual') {
          room.teams[existing.teamIndex].name = name;
        } else {
          const idx = parseInt(teamIndex);
          if (!isNaN(idx) && idx >= 0 && idx < room.teams.length) existing.teamIndex = idx;
        }
        bindPlayer(socket, room, existing);
        return;
      }

      let idx;
      if (room.mode === 'individual') {
        room.teams.push({ name, color: TEAM_COLORS[room.teams.length % TEAM_COLORS.length], score: 0 });
        idx = room.teams.length - 1;
      } else {
        idx = parseInt(teamIndex);
        if (isNaN(idx) || idx < 0 || idx >= room.teams.length) {
          socket.emit('join-error', { message: 'Invalid team.' });
          return;
        }
      }

      room.players.push({ socketId: socket.id, playerId: pid, name, teamIndex: idx, connected: true });
      bindPlayer(socket, room, room.players[room.players.length - 1]);
    });

    socket.on('rejoin-room', ({ roomCode, playerId }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        socket.emit('rejoin-failed', { message: 'Tournament not found — it may have ended.' });
        return;
      }
      if (room.phase === 'complete') {
        socket.emit('rejoin-failed', { message: 'This tournament has ended.' });
        return;
      }
      const pid = playerId ? String(playerId).slice(0, 64) : null;
      const player = pid ? room.players.find(p => p.playerId === pid) : null;
      if (!player) {
        socket.emit('rejoin-failed', { message: 'Could not find you in this tournament — please join again.' });
        return;
      }
      bindPlayer(socket, room, player);
    });

    socket.on('request-sync', () => {
      const room = rooms.get(socket.roomCode);
      if (!room) return;
      socket.emit('sync', snapshot(room, socket.isHost ? null : socket.teamIndex));
    });

    // ── Stage 2 will implement launching games, capturing results, and
    //    advancing standings. For now this just acknowledges the plan is ready.
    socket.on('start-tournament', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'lobby') return;
      if (room.mode === 'individual' && room.players.length < 2) {
        socket.emit('start-blocked', { message: 'Need at least 2 players to start.' });
        return;
      }
      // Stage 1 stub — signal readiness without launching a game yet.
      namespace.to(room.roomCode).emit('tournament-ready', {
        plan: room.plan, standings: getStandings(room)
      });
    });

    socket.on('end-tournament', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      room.phase = 'complete';
      namespace.to(room.roomCode).emit('tournament-over', { standings: getStandings(room), results: room.results });
    });

    socket.on('disconnect', () => {
      const roomCode = socket.roomCode;
      if (!roomCode) return;
      const room = rooms.get(roomCode);
      if (!room) return;

      if (socket.isHost) {
        namespace.to(roomCode).emit('host-disconnected', {});
        rooms.delete(roomCode);
      } else {
        // Keep the player — they may just be hopping into a game or locking
        // their phone. Marked away, re-bound on return.
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          player.connected = false;
          emitPlayers(room);
        }
      }
    });
  });
};

module.exports.GAME_CATALOG = GAME_CATALOG;
module.exports.sanitisePlan = sanitisePlan;
module.exports.sanitisePlacement = sanitisePlacement;
