// No Say Am — a Taboo-style describing game.
//
// One player on the active team is the DESCRIBER: their phone shows a card (a
// word + five forbidden words). Their teammates shout guesses; the describer
// taps "Got it ✓" (point) or "Skip". A per-turn timer runs down. The host TV
// shows the clock, the running score and whose turn it is — but NEVER the word,
// so the room can't see it. At the end of a turn the host reviews the words that
// were got and can STRIKE any that were wrongly awarded (describer slipped a
// forbidden word), removing the point. Teams take turns across a set number of
// rounds; the describer rotates through each team's members.
//
// Same skeleton as the other games (grab-the-mic is the reference): a module-
// level rooms Map, a snapshot() that paints any phase for reconnects, and the
// create/check/join/rejoin/request-sync handlers. Server-authoritative timer.
const QRCode = require('qrcode');
const orchestrator = require('../tournament/orchestrator');
const { CARDS } = require('./data/cards.js');

const TEAM_COLORS = ['#FF2D55', '#5856D6', '#FF9500', '#34C759', '#00C7BE', '#FF375F', '#BF5AF2', '#FFD60A'];
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TURN_SECONDS = [45, 60, 90, 120];   // selectable per-turn timer
const DEFAULT_SECONDS = 60;
const ROUND_CHOICES = [1, 2, 3, 4, 5];     // selectable number of rounds
const DEFAULT_ROUNDS = 3;

const rooms = new Map();

function generateRoomCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function getScores(room) {
  return room.teams.map((t, i) => ({ index: i, name: t.name, color: t.color, score: t.score }));
}
function publicPlayers(room) {
  return room.players.map(p => ({ playerId: p.playerId, name: p.name, teamIndex: p.teamIndex, connected: p.connected }));
}
function clearTurnTimer(room) {
  if (room.turnTimer) { clearInterval(room.turnTimer); room.turnTimer = null; }
}
function liveGot(room) { return room.turnLog.filter(e => e.result === 'got' && !e.struck).length; }
function skippedCount(room) { return room.turnLog.filter(e => e.result === 'skipped').length; }

// Deal the next card from the shuffled deck; reshuffle when exhausted so a long
// game never runs dry. A serial number guards got/skip against double-taps.
function dealNextCard(room) {
  if (room.deckIndex >= room.deck.length) { room.deck = shuffle(CARDS); room.deckIndex = 0; }
  room.currentCard = room.deck[room.deckIndex++];
  room.cardSerial++;
  return room.currentCard;
}

// Pick the describer for a team, rotating through its members across rounds so
// everyone gets a go. Prefers connected members; falls back to any member.
function pickDescriber(room, teamIndex) {
  const connected = room.players.filter(p => p.teamIndex === teamIndex && p.connected);
  const pool = connected.length ? connected : room.players.filter(p => p.teamIndex === teamIndex);
  if (!pool.length) return null;
  const n = room.describerRot[teamIndex] || 0;
  room.describerRot[teamIndex] = n + 1;
  return pool[n % pool.length];
}

// Everything a client needs to paint the current moment. The live CARD is only
// ever included for the describer's own playerId (so the TV / other phones can
// never read the word); at turn-over the whole turn log is public (already
// guessed/revealed) so the host can strike wrongly-awarded words.
function snapshot(room, playerId) {
  const isDescriber = !!playerId && playerId === room.describerId;
  const dTeam = room.teams[room.describerTeamIndex];
  const s = {
    phase: room.phase,
    mode: room.mode,
    scores: getScores(room),
    teamNames: room.teams.map(t => t.name),
    teamColors: room.teams.map(t => t.color),
    round: room.round,
    totalRounds: room.totalRounds,
    turnSeconds: room.turnSeconds,
    secondsLeft: room.secondsLeft,
    describerId: room.describerId,
    describerName: room.describerName,
    describerTeamIndex: room.describerTeamIndex,
    describerTeamName: dTeam ? dTeam.name : null,
    describerTeamColor: dTeam ? dTeam.color : null,
    gotCount: liveGot(room),
    skipCount: skippedCount(room),
    cardSerial: room.cardSerial,
    isDescriber
  };
  if (isDescriber && room.phase === 'in-turn' && room.currentCard) {
    s.card = { word: room.currentCard.word, taboo: room.currentCard.taboo, serial: room.cardSerial, cardNumber: room.turnLog.length + 1 };
  }
  if (room.phase === 'turn-over' || room.phase === 'round-over') {
    s.turnLog = room.turnLog.map((e, i) => ({ index: i, word: e.word, result: e.result, struck: e.struck }));
  }
  return s;
}

module.exports = function registerNoSayAm(namespace, localIP, port) {

  require('../shared/pause.js')(namespace, rooms);   // ⏸ pause / resume

  function emitPlayers(room) {
    if (!room.hostSocketId) return;
    namespace.to(room.hostSocketId).emit('players-update', { allPlayers: publicPlayers(room), scores: getScores(room) });
  }

  function describerSocketId(room) {
    const d = room.players.find(p => p.playerId === room.describerId);
    return d ? d.socketId : null;
  }

  function bindPlayer(socket, room, player) {
    player.socketId = socket.id;
    player.connected = true;
    socket.join(room.roomCode);
    socket.roomCode = room.roomCode;
    socket.playerId = player.playerId;
    socket.isHost = false;
    socket.emit('joined', { roomCode: room.roomCode, teamIndex: player.teamIndex, ...snapshot(room, player.playerId) });
    emitPlayers(room);
  }

  function concludeGame(room) {
    if (room.concluded) return;
    room.concluded = true;
    clearTurnTimer(room);
    room.phase = 'game-over';
    const scores = getScores(room).sort((a, b) => b.score - a.score);
    namespace.to(room.roomCode).emit('game-over', { scores });
    if (room.tournament && typeof room.onComplete === 'function') {
      try { room.onComplete(scores); } catch (e) { console.error('[no-say-am] onComplete error:', e.message); }
    }
  }

  // Set up the next team's turn (or end the round / game). Lands in 'turn-intro'
  // so the describer can get ready before the clock starts.
  function beginTurn(room) {
    clearTurnTimer(room);
    const describer = pickDescriber(room, room.turnTeamIndex);
    room.describerId = describer ? describer.playerId : null;
    room.describerName = describer ? describer.name : null;
    room.describerTeamIndex = room.turnTeamIndex;
    room.currentCard = null;
    room.secondsLeft = room.turnSeconds;
    room.turnLog = [];
    room.phase = 'turn-intro';
    const team = room.teams[room.turnTeamIndex];
    namespace.to(room.roomCode).emit('turn-intro', {
      round: room.round, totalRounds: room.totalRounds,
      teamIndex: room.turnTeamIndex, teamName: team ? team.name : '', teamColor: team ? team.color : '#fff',
      describerId: room.describerId, describerName: room.describerName,
      turnSeconds: room.turnSeconds
    });
  }

  function startTurnClock(room) {
    clearTurnTimer(room);
    room.phase = 'in-turn';
    room.secondsLeft = room.turnSeconds;
    dealNextCard(room);
    const team = room.teams[room.describerTeamIndex];
    namespace.to(room.roomCode).emit('turn-started', {
      describerId: room.describerId, describerName: room.describerName,
      teamName: team ? team.name : '', teamColor: team ? team.color : '#fff',
      secondsLeft: room.secondsLeft
    });
    const dSock = describerSocketId(room);
    if (dSock) namespace.to(dSock).emit('card', { word: room.currentCard.word, taboo: room.currentCard.taboo, serial: room.cardSerial, cardNumber: 1 });

    room.turnTimer = setInterval(() => {
      if (room.paused) return;             // frozen while paused
      room.secondsLeft--;
      if (room.secondsLeft > 0) {
        namespace.to(room.roomCode).emit('timer', { secondsLeft: room.secondsLeft });
      } else {
        endTurn(room);
      }
    }, 1000);
  }

  function endTurn(room) {
    clearTurnTimer(room);
    room.secondsLeft = 0;
    room.phase = 'turn-over';
    const team = room.teams[room.describerTeamIndex];
    namespace.to(room.roomCode).emit('turn-over', {
      describerName: room.describerName,
      teamIndex: room.describerTeamIndex, teamName: team ? team.name : '', teamColor: team ? team.color : '#fff',
      turnLog: room.turnLog.map((e, i) => ({ index: i, word: e.word, result: e.result, struck: e.struck })),
      got: liveGot(room), skipped: skippedCount(room),
      scores: getScores(room)
    });
  }

  // After a turn-over, move to the next team — or end the round / game.
  function advanceAfterTurn(room) {
    room.turnTeamIndex++;
    if (room.turnTeamIndex < room.teams.length) {
      beginTurn(room);
      return;
    }
    // Round complete.
    room.round++;
    if (room.round >= room.totalRounds) {
      concludeGame(room);
      return;
    }
    room.turnTeamIndex = 0;
    room.phase = 'round-over';
    namespace.to(room.roomCode).emit('round-over', {
      round: room.round - 1, totalRounds: room.totalRounds,
      nextRound: room.round,
      scores: getScores(room)
    });
  }

  namespace.on('connection', (socket) => {

    socket.on('create-room', ({ teamCount, teamNames, mode, turnSeconds, totalRounds, baseUrl }) => {
      try {
        console.log('[no-say-am] create-room from', socket.id);
        const gameMode = mode === 'individual' ? 'individual' : 'teams';
        let teams = [];
        if (gameMode === 'teams') {
          const count = Math.min(Math.max(parseInt(teamCount) || 2, 2), 8);
          teams = Array.from({ length: count }, (_, i) => ({
            name: ((teamNames || [])[i] || `Team ${i + 1}`).trim() || `Team ${i + 1}`,
            color: TEAM_COLORS[i], score: 0
          }));
        }
        const secs = TURN_SECONDS.includes(parseInt(turnSeconds)) ? parseInt(turnSeconds) : DEFAULT_SECONDS;
        const rounds = ROUND_CHOICES.includes(parseInt(totalRounds)) ? parseInt(totalRounds) : DEFAULT_ROUNDS;

        const roomCode = generateRoomCode();
        const room = {
          roomCode, hostSocketId: socket.id,
          teams, players: [],
          phase: 'lobby', mode: gameMode,
          turnSeconds: secs, totalRounds: rounds,
          round: 0, turnTeamIndex: 0,
          describerRot: {}, describerId: null, describerName: null, describerTeamIndex: 0,
          deck: shuffle(CARDS), deckIndex: 0, currentCard: null, cardSerial: 0,
          turnLog: [], secondsLeft: secs, turnTimer: null,
          tournament: false, concluded: false
        };
        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;

        const isLocalhost = baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(baseUrl);
        const playerBaseUrl = (!baseUrl || isLocalhost) ? `http://${localIP}:${port}` : baseUrl;
        const joinUrl = `${playerBaseUrl}/games/no-say-am/player.html?room=${roomCode}`;

        console.log('[no-say-am] Room created:', roomCode, '| mode:', gameMode, '|', secs + 's', '|', rounds, 'rounds');
        socket.emit('room-created', { roomCode, joinUrl, localIP, port, teams: room.teams, mode: gameMode, turnSeconds: secs, totalRounds: rounds, qrDataUrl: null });

        QRCode.toDataURL(joinUrl, { width: 200, margin: 1, color: { dark: '#ffffff', light: '#0a0a18' } })
          .then(qrDataUrl => socket.emit('qr-ready', { qrDataUrl }))
          .catch(e => console.error('[no-say-am] QR error:', e.message));
      } catch (err) {
        console.error('[no-say-am] create-room error:', err);
        socket.emit('create-room-error', { message: 'Failed to create room: ' + err.message });
      }
    });

    socket.on('check-room', ({ roomCode }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.phase === 'game-over') {
        socket.emit('room-check-result', { found: false, message: room ? 'This game has ended.' : 'Room not found. Check the code and try again.' });
        return;
      }
      socket.emit('room-check-result', { found: true, mode: room.mode, teams: room.teams.map(t => ({ name: t.name, color: t.color })) });
    });

    socket.on('join-room', ({ roomCode, playerName, teamIndex, playerId }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.phase === 'game-over') {
        socket.emit('join-error', { message: room ? 'This game has ended.' : 'Room not found.' });
        return;
      }
      const name = (playerName || '').trim() || 'Anonymous';
      const pid = playerId ? String(playerId).slice(0, 64) : null;
      const existing = pid ? room.players.find(p => p.playerId === pid) : null;
      if (existing) {
        existing.name = name;
        if (room.mode === 'individual') { room.teams[existing.teamIndex].name = name; }
        else { const idx = parseInt(teamIndex); if (!isNaN(idx) && idx >= 0 && idx < room.teams.length) existing.teamIndex = idx; }
        bindPlayer(socket, room, existing);
        return;
      }
      let idx;
      if (room.mode === 'individual') {
        room.teams.push({ name, color: TEAM_COLORS[room.teams.length % TEAM_COLORS.length], score: 0 });
        idx = room.teams.length - 1;
      } else {
        idx = parseInt(teamIndex);
        if (isNaN(idx) || idx < 0 || idx >= room.teams.length) { socket.emit('join-error', { message: 'Invalid team.' }); return; }
      }
      room.players.push({ socketId: socket.id, playerId: pid, name, teamIndex: idx, connected: true });
      bindPlayer(socket, room, room.players[room.players.length - 1]);
    });

    socket.on('rejoin-room', ({ roomCode, playerId }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { socket.emit('rejoin-failed', { message: 'Room not found — the game may have ended.' }); return; }
      if (room.phase === 'game-over') { socket.emit('rejoin-failed', { message: 'This game has ended.' }); return; }
      const pid = playerId ? String(playerId).slice(0, 64) : null;
      const player = pid ? room.players.find(p => p.playerId === pid) : null;
      if (!player) { socket.emit('rejoin-failed', { message: 'Could not find you in this room — please join again.' }); return; }
      bindPlayer(socket, room, player);
    });

    socket.on('request-sync', () => {
      const room = rooms.get(socket.roomCode);
      if (!room) return;
      socket.emit('sync', snapshot(room, socket.playerId));
    });

    // Host starts the game from the lobby.
    socket.on('start-game', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'lobby') return;
      room.round = 0;
      room.turnTeamIndex = 0;
      beginTurn(room);
    });

    // Start the clock for the current turn — the host OR the describer can do it.
    socket.on('start-turn', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.phase !== 'turn-intro') return;
      if (!socket.isHost && socket.playerId !== room.describerId) return;
      startTurnClock(room);
    });

    // Describer (or host as backup) marks the current card got / skipped. The
    // serial guards against a double-tap awarding two points for one card.
    socket.on('mark', ({ result, serial }) => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.phase !== 'in-turn') return;
      if (!socket.isHost && socket.playerId !== room.describerId) return;
      if (typeof serial === 'number' && serial !== room.cardSerial) return;   // stale tap — ignore
      const got = result === 'got';
      room.turnLog.push({ word: room.currentCard.word, result: got ? 'got' : 'skipped', struck: false });
      if (got && room.teams[room.describerTeamIndex]) room.teams[room.describerTeamIndex].score++;
      dealNextCard(room);
      const dSock = describerSocketId(room);
      if (dSock) namespace.to(dSock).emit('card', { word: room.currentCard.word, taboo: room.currentCard.taboo, serial: room.cardSerial, cardNumber: room.turnLog.length + 1 });
      namespace.to(room.roomCode).emit('turn-progress', { got: liveGot(room), skipped: skippedCount(room), scores: getScores(room), lastResult: got ? 'got' : 'skipped' });
    });

    // Host ends the turn before the clock runs out.
    socket.on('end-turn', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'in-turn') return;
      endTurn(room);
    });

    // Host strikes (toggles) a GOT word at turn-over — removes/restores the point.
    socket.on('strike', ({ index }) => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'turn-over') return;
      const entry = room.turnLog[index];
      if (!entry || entry.result !== 'got') return;
      entry.struck = !entry.struck;
      const team = room.teams[room.describerTeamIndex];
      if (team) team.score += entry.struck ? -1 : 1;
      namespace.to(room.roomCode).emit('turn-over', {
        describerName: room.describerName,
        teamIndex: room.describerTeamIndex, teamName: team ? team.name : '', teamColor: team ? team.color : '#fff',
        turnLog: room.turnLog.map((e, i) => ({ index: i, word: e.word, result: e.result, struck: e.struck })),
        got: liveGot(room), skipped: skippedCount(room),
        scores: getScores(room)
      });
    });

    // Host moves on from a turn-over to the next team / round / game-over.
    socket.on('next', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'turn-over') return;
      advanceAfterTurn(room);
    });

    // Host continues from a round-over into the next round.
    socket.on('advance', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'round-over') return;
      beginTurn(room);
    });

    socket.on('end-game', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      concludeGame(room);
    });

    // Tournament: adopt the pre-created room as its host.
    socket.on('claim-host', ({ roomCode }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || !room.tournament) return;
      room.hostSocketId = socket.id;
      socket.join(code);
      socket.roomCode = code;
      socket.isHost = true;
      socket.emit('host-attached', {
        roomCode: code, teams: room.teams.map(t => ({ name: t.name, color: t.color })), mode: room.mode,
        turnSeconds: room.turnSeconds, totalRounds: room.totalRounds,
        ...snapshot(room, null)
      });
      emitPlayers(room);
    });

    socket.on('disconnect', () => {
      const roomCode = socket.roomCode;
      if (!roomCode) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      if (socket.isHost) {
        clearTurnTimer(room);
        namespace.to(roomCode).emit('host-disconnected', {});
        rooms.delete(roomCode);
      } else {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) { player.connected = false; emitPlayers(room); }
      }
    });
  });

  // ── Tournament integration ───────
  orchestrator.register('no-say-am', ({ roster, teams, mode, config, length, onComplete }) => {
    const roomCode = generateRoomCode();
    const gameMode = mode === 'individual' ? 'individual' : 'teams';
    const builtTeams = (teams || []).map((t, i) => ({ name: t.name, color: t.color || TEAM_COLORS[i % TEAM_COLORS.length], score: 0 }));
    const secs = TURN_SECONDS.includes(parseInt(config && config.turnSeconds)) ? parseInt(config.turnSeconds) : DEFAULT_SECONDS;
    const rounds = Math.min(Math.max(parseInt(length) || DEFAULT_ROUNDS, 1), 5);

    const room = {
      roomCode, hostSocketId: null,
      teams: builtTeams,
      players: (roster || []).map(r => ({ socketId: null, playerId: r.playerId, name: r.name, teamIndex: r.teamIndex, connected: false })),
      phase: 'lobby', mode: gameMode,
      turnSeconds: secs, totalRounds: rounds,
      round: 0, turnTeamIndex: 0,
      describerRot: {}, describerId: null, describerName: null, describerTeamIndex: 0,
      deck: shuffle(CARDS), deckIndex: 0, currentCard: null, cardSerial: 0,
      turnLog: [], secondsLeft: secs, turnTimer: null,
      tournament: true, onComplete, concluded: false
    };
    rooms.set(roomCode, room);
    console.log('[no-say-am] tournament room', roomCode, '|', rounds, 'rounds | players:', room.players.length);
    return { roomCode };
  });
};
