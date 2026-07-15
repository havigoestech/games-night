const QRCode = require('qrcode');
const orchestrator = require('./orchestrator');

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

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
    nextGameIndex: room.gameIndex + 1 < room.plan.length ? room.gameIndex + 1 : null,
    liveGame: room.liveGameRoom ? { slug: room.liveGameSlug, roomCode: room.liveGameRoom } : null,
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

  // Launch game `index` in the plan: hand its slug's launcher a room pre-seeded
  // with our roster + teams, and a completion callback. Then tell every phone
  // to hop into that game.
  function launchGame(room, index) {
    const game = room.plan[index];
    if (!orchestrator.isRegistered(game.slug)) {
      // Stage 2 wires Text Twist first; other games become tournament-ready in
      // Stage 3. Until then, tell the host rather than failing silently.
      namespace.to(room.hostSocketId).emit('game-unavailable', {
        slug: game.slug, name: game.name, index
      });
      return false;
    }

    // Two-sided games (Family Feud, Kill & Injury) need exactly two sides. Two
    // teams map straight across; otherwise (individuals, or >2 teams) we split
    // the field into two balanced squads for this game — every player of an
    // entity stays together, and the squad assignment is remembered so the
    // result can be handed back to the right people.
    let roster, teams, launchMode;
    room.liveSquads = null;
    if (game.twoSided && !(room.mode === 'teams' && room.teams.length === 2)) {
      const sideOf = {};   // tournament team index -> squad 0/1
      shuffle(room.teams.map((_, i) => i)).forEach((ti, k) => { sideOf[ti] = k % 2; });
      room.liveSquads = sideOf;
      teams = [{ name: 'Squad A', color: '#00C7BE' }, { name: 'Squad B', color: '#FF9500' }];
      roster = room.players.map(p => ({ playerId: p.playerId, name: p.name, teamIndex: sideOf[p.teamIndex] }));
      launchMode = 'teams';
    } else {
      roster = room.players.map(p => ({ playerId: p.playerId, name: p.name, teamIndex: p.teamIndex }));
      teams = room.teams.map(t => ({ name: t.name, color: t.color }));
      launchMode = room.mode;
    }

    const launched = orchestrator.launch(game.slug, {
      roster, teams, mode: launchMode,
      config: game.config, length: game.length,
      onComplete: (scores) => onGameComplete(room, index, scores)
    });
    if (!launched || !launched.roomCode) return false;

    room.gameIndex = index;
    room.liveGameSlug = game.slug;
    room.liveGameRoom = launched.roomCode;
    room.phase = 'in-game';

    namespace.to(room.roomCode).emit('goto-game', {
      slug: game.slug,
      name: game.name,
      icon: game.icon,
      index,
      total: room.plan.length,
      playerUrl: `/games/${game.slug}/player.html?room=${launched.roomCode}&t=${room.roomCode}`,
      hostUrl: `/games/${game.slug}/host.html?room=${launched.roomCode}&t=${room.roomCode}`
    });
    return true;
  }

  // Called by a game (via the launcher's onComplete) when it finishes. Convert
  // its finishing order into placement points and add to the running standings.
  function onGameComplete(room, index, scores) {
    const lastPts = room.placement[room.placement.length - 1] || 1;
    const pointsFor = pos => (room.placement[pos] != null ? room.placement[pos] : lastPts);

    // `scores` is already sorted best-first; ties (equal game score) share the
    // higher position's points.
    const awarded = [];
    if (room.liveSquads) {
      // Squad game: `scores` is the two squads' results (entry.index = squad
      // 0/1). Everyone on the winning squad gets 1st-place points, the losing
      // squad 2nd — mapped back to each real tournament entity.
      const squadPts = {};
      scores.forEach((entry, pos) => {
        const pts = (pos > 0 && entry.score === scores[pos - 1].score) ? squadPts[scores[pos - 1].index] : pointsFor(pos);
        squadPts[entry.index] = pts;
      });
      room.teams.forEach((t, ti) => {
        const squad = room.liveSquads[ti];
        const pts = squadPts[squad] != null ? squadPts[squad] : 0;
        t.score += pts;
        awarded.push({ teamIndex: ti, name: t.name, color: t.color, gameScore: null, position: null, points: pts, squad });
      });
      awarded.sort((a, b) => b.points - a.points);
    } else {
      scores.forEach((entry, pos) => {
        const pts = (pos > 0 && entry.score === scores[pos - 1].score) ? awarded[pos - 1].points : pointsFor(pos);
        awarded.push({ teamIndex: entry.index, name: entry.name, color: entry.color, gameScore: entry.score, position: pos + 1, points: pts });
        if (room.teams[entry.index]) room.teams[entry.index].score += pts;
      });
    }

    room.results.push({ index, slug: room.plan[index].slug, name: room.plan[index].name, icon: room.plan[index].icon, awarded, squadded: !!room.liveSquads });
    room.liveSquads = null;
    room.liveGameRoom = null;
    room.liveGameSlug = null;
    room.phase = 'between';

    namespace.to(room.roomCode).emit('game-complete', {
      index,
      gameName: room.plan[index].name,
      awarded,
      standings: getStandings(room),
      nextGameIndex: index + 1 < room.plan.length ? index + 1 : null,
      results: room.results
    });
  }

  namespace.on('connection', (socket) => {

    socket.on('create-tournament', ({ mode, teamCount, teamNames, plan, placement, baseUrl, hostId }) => {
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
          hostId: hostId ? String(hostId).slice(0, 64) : null,   // survives the host hopping to a game
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

    // Host: kick off the tournament by launching the first game.
    socket.on('start-tournament', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'lobby') return;
      if (room.players.length < 2) {
        socket.emit('start-blocked', { message: 'Need at least 2 players to start.' });
        return;
      }
      launchGame(room, 0);
    });

    // Host: after the between-games standings, move on to the next game.
    socket.on('next-game', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'between') return;
      const next = room.gameIndex + 1;
      if (next >= room.plan.length) return;
      launchGame(room, next);
    });

    // Host: re-attach after hopping out to a game (each hop is a full page load,
    // so the tournament socket dropped). Matched by the persistent hostId.
    socket.on('reclaim-host', ({ roomCode, hostId }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { socket.emit('reclaim-failed', { message: 'Tournament not found.' }); return; }
      if (room.hostId && String(hostId).slice(0, 64) !== room.hostId) {
        socket.emit('reclaim-failed', { message: 'Not the tournament host.' });
        return;
      }
      room.hostSocketId = socket.id;
      socket.join(code);
      socket.roomCode = code;
      socket.isHost = true;
      socket.emit('host-reclaimed', { roomCode: code, ...snapshot(room, null) });
      emitPlayers(room);
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
        // Once a tournament is under way the host is CONSTANTLY hopping out to
        // game host pages (each hop drops this socket). Only tear the room down
        // if they leave from the lobby — otherwise keep it alive so they can
        // reclaim it by hostId when they come back.
        room.hostSocketId = null;
        if (room.phase === 'lobby') {
          namespace.to(roomCode).emit('host-disconnected', {});
          rooms.delete(roomCode);
        }
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
