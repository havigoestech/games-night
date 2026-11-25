// Trivia — a quiz-night game: the host builds a playlist of rounds (which can
// mix modes), played as one continuous game with a single running leaderboard.
// Teams or solo (solo = each player is a one-person team). Modes are pluggable
// modules in ./modes; this engine owns the common lifecycle, timer, scoring
// accumulation and reconnect snapshots.
const QRCode = require('qrcode');
const orchestrator = require('../tournament/orchestrator');

const TEAM_COLORS = ['#FF2D55', '#5856D6', '#FF9500', '#34C759', '#00C7BE', '#FF375F', '#BF5AF2', '#FFD60A'];
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const MODES = {
  'fastest-finger': require('./modes/fastest-finger'),
  'same-letter': require('./modes/same-letter'),
  'same-letter-round': require('./modes/same-letter-round'),
  'closest-wins': require('./modes/closest-wins'),
  'the-big-bluff': require('./modes/the-big-bluff'),
};

const rooms = new Map();

// Category list for the host's playlist builder, derived from the MC bank.
let MC_CATEGORIES = [];
try {
  const b = require('./data/questions-mc.js').QUESTIONS || [];
  const c = {}; b.forEach(q => { c[q.cat] = (c[q.cat] || 0) + 1; });
  MC_CATEGORIES = Object.keys(c).sort();
} catch (e) { MC_CATEGORIES = []; }

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
function clearRoomTimer(room) {
  if (room.questionTimer) { clearInterval(room.questionTimer); room.questionTimer = null; }
}
function currentRound(room) { return room.playlist[room.roundIndex] || null; }
function modeOf(room) { const r = currentRound(room); return r ? MODES[r.mode] : null; }

function sanitizePlaylist(raw) {
  const out = [];
  for (const r of (Array.isArray(raw) ? raw : [])) {
    const mode = r && MODES[r.mode] ? r.mode : null;
    if (!mode) continue;
    out.push({
      mode,
      category: (r.category || 'any'),
      difficulty: (r.difficulty || 'any'),
      count: Math.min(Math.max(parseInt(r.count) || 5, 1), 20),
      seconds: Math.min(Math.max(parseInt(r.seconds) || MODES[mode].meta.defaultSeconds, 5), 180)
    });
  }
  if (!out.length) out.push({ mode: 'fastest-finger', category: 'any', difficulty: 'any', count: 5, seconds: 20 });
  return out;
}

// Full current-state snapshot (reconnect-safe). Never includes the correct answer
// during a live question — only once we're in the reveal phase.
function snapshot(room, playerId) {
  const round = currentRound(room);
  const mode = modeOf(room);
  const s = {
    phase: room.phase,
    teamMode: room.teamMode,
    roundIndex: room.roundIndex,
    totalRounds: room.playlist.length,
    qNumber: room.qIndexInRound + 1,
    qCount: round ? round.count : 0,
    teamNames: room.teams.map(t => t.name),
    teamColors: room.teams.map(t => t.color),
    scores: getScores(room),
    secondsLeft: room.secondsLeft,
    roundMeta: round ? { modeName: MODES[round.mode].meta.name, modeIcon: MODES[round.mode].meta.icon, category: round.category, difficulty: round.difficulty, count: round.count } : null,
    roundScores: room.lastRoundScores || null
  };
  if ((room.phase === 'question' || room.phase === 'question-reveal') && room.currentPublic) {
    s.question = room.currentPublic;
  }
  if (room.phase === 'question-reveal' && room.currentReveal) {
    s.reveal = room.currentReveal;
  }
  if (playerId != null && mode && mode.youState && (room.phase === 'question' || room.phase === 'question-reveal')) {
    s.you = mode.youState(room, playerId);
  }
  return s;
}

module.exports = function registerTrivia(namespace, localIP, port) {

  function emitPlayers(room) {
    if (room.hostSocketId) namespace.to(room.hostSocketId).emit('players-update', { allPlayers: publicPlayers(room), scores: getScores(room) });
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

  // server-authoritative countdown for the current stage, mirrored for reconnects
  function startStageTimer(room) {
    clearRoomTimer(room);
    room.questionTimer = setInterval(() => {
      room.secondsLeft--;
      if (room.secondsLeft > 0) { namespace.to(room.roomCode).emit('timer', { secondsLeft: room.secondsLeft }); }
      else { namespace.to(room.roomCode).emit('timer', { secondsLeft: 0 }); resolveStage(room); }
    }, 1000);
  }

  function broadcastStage(room) {
    const round = currentRound(room);
    const mode = MODES[round.mode];
    namespace.to(room.roomCode).emit('question', { ...room.currentPublic, roundIndex: room.roundIndex, qNumber: room.qIndexInRound + 1, qCount: round.count, seconds: room.secondsLeft, modeName: mode.meta.name, modeIcon: mode.meta.icon });
  }

  function beginQuestion(room) {
    const round = currentRound(room);
    const mode = MODES[round.mode];
    mode.pickAndStart(room, round);
    room.phase = 'question';
    room.currentPublic = mode.publicQuestion(room);
    room.currentReveal = null;
    room.secondsLeft = room.currentPublic.seconds || round.seconds;
    broadcastStage(room);
    startStageTimer(room);
  }

  // A stage ended (timer ran out, or the host advanced, or everyone's in).
  // Multi-stage modes (e.g. The Big Bluff) return the next stage here; otherwise
  // we score and reveal.
  function resolveStage(room) {
    clearRoomTimer(room);
    if (room.phase !== 'question') return;
    const mode = modeOf(room);
    const next = mode.nextStage ? mode.nextStage(room) : null;
    if (next) {
      room.currentPublic = next;
      room.secondsLeft = next.seconds || currentRound(room).seconds;
      broadcastStage(room);
      startStageTimer(room);
      return;
    }
    const reveal = mode.score(room);
    reveal.scores = getScores(room);
    reveal.roundIndex = room.roundIndex;
    reveal.qNumber = room.qIndexInRound + 1;
    reveal.qCount = currentRound(room).count;
    reveal.modeName = mode.meta.name;
    reveal.modeIcon = mode.meta.icon;
    room.phase = 'question-reveal';
    room.currentReveal = reveal;
    namespace.to(room.roomCode).emit('question-reveal', reveal);
  }

  function emitRoundIntro(room) {
    const round = currentRound(room);
    const mode = MODES[round.mode];
    if (mode.startRound) mode.startRound(room, round);   // let a mode set up round-level state (e.g. a fixed letter)
    room.phase = 'round-intro';
    room.roundScoreBase = getScores(room).map(s => s.score);   // to compute this round's delta
    namespace.to(room.roomCode).emit('round-intro', {
      roundIndex: room.roundIndex, totalRounds: room.playlist.length,
      modeName: mode.meta.name, modeIcon: mode.meta.icon,
      category: round.category, difficulty: round.difficulty, count: round.count,
      roundNote: round._roundNote || null
    });
  }

  function emitRoundOver(room) {
    const scores = getScores(room);
    const roundScores = scores.map((s, i) => ({ ...s, roundPoints: s.score - (room.roundScoreBase ? room.roundScoreBase[i] : 0) }));
    room.lastRoundScores = roundScores;
    room.phase = 'round-over';
    namespace.to(room.roomCode).emit('round-over', { roundIndex: room.roundIndex, totalRounds: room.playlist.length, roundScores, scores });
  }

  function endGame(room) {
    if (room.concluded) return;
    room.concluded = true;
    clearRoomTimer(room);
    room.phase = 'game-over';
    const scores = getScores(room).sort((a, b) => b.score - a.score);
    namespace.to(room.roomCode).emit('game-over', { scores });
    // Tournament hand-back: report final standings to the orchestrator.
    if (room.tournament && typeof room.onComplete === 'function') {
      try { room.onComplete(scores); } catch (e) { console.error('[trivia] onComplete error:', e.message); }
    }
  }

  // Move the state machine forward from wherever it is (the host's "Next" button).
  function advance(room) {
    if (room.phase === 'round-intro') {
      room.qIndexInRound = 0;
      beginQuestion(room);
    } else if (room.phase === 'question') {
      resolveStage(room);                    // host chose to cut the stage short
    } else if (room.phase === 'question-reveal') {
      const round = currentRound(room);
      if (room.qIndexInRound + 1 < round.count) { room.qIndexInRound++; beginQuestion(room); }
      else { emitRoundOver(room); }
    } else if (room.phase === 'round-over') {
      if (room.roundIndex + 1 < room.playlist.length) { room.roundIndex++; room.qIndexInRound = -1; emitRoundIntro(room); }
      else { endGame(room); }
    }
  }

  // Host "skip this question": abandon the current question (no scoring) and go
  // straight to the next one, or to round-over if it was the last.
  function skipQuestion(room) {
    clearRoomTimer(room);
    const round = currentRound(room);
    if (!round) return;
    if (room.qIndexInRound + 1 < round.count) { room.qIndexInRound++; beginQuestion(room); }
    else { emitRoundOver(room); }
  }

  // Host "skip this round/mode": drop the rest of the current round and jump to
  // the next round's intro, or end the game if it was the last round.
  function skipRound(room) {
    clearRoomTimer(room);
    if (room.roundIndex + 1 < room.playlist.length) { room.roundIndex++; room.qIndexInRound = -1; emitRoundIntro(room); }
    else { endGame(room); }
  }

  namespace.on('connection', (socket) => {

    socket.on('create-room', ({ teamNames, teamCount, teamMode, playlist, familyFriendly = true, baseUrl }) => {
      try {
        const mode = teamMode === 'individual' ? 'individual' : 'teams';
        let teams = [];
        if (mode === 'teams') {
          const n = Math.min(Math.max(parseInt(teamCount) || 2, 2), 8);
          teams = Array.from({ length: n }, (_, i) => ({
            name: ((teamNames || [])[i] || `Team ${i + 1}`).trim() || `Team ${i + 1}`,
            color: TEAM_COLORS[i], score: 0
          }));
        }
        const roomCode = generateRoomCode();
        const room = {
          roomCode, hostSocketId: socket.id,
          teams, players: [],
          teamMode: mode, familyFriendly: !!familyFriendly,
          playlist: sanitizePlaylist(playlist),
          phase: 'lobby',
          roundIndex: -1, qIndexInRound: -1,
          currentQuestion: null, modeState: null, currentPublic: null, currentReveal: null,
          usedQuestions: new Set(),
          secondsLeft: null, questionTimer: null,
          roundScoreBase: null, lastRoundScores: null
        };
        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;

        const isLocalhost = baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(baseUrl);
        const playerBaseUrl = (!baseUrl || isLocalhost) ? `http://${localIP}:${port}` : baseUrl;
        const joinUrl = `${playerBaseUrl}/games/trivia/player.html?room=${roomCode}`;

        socket.emit('room-created', { roomCode, joinUrl, localIP, port, teams: getScores(room), teamMode: mode, playlist: room.playlist });
        QRCode.toDataURL(joinUrl, { width: 200, margin: 1, color: { dark: '#ffffff', light: '#0a0a18' } })
          .then(qrDataUrl => socket.emit('qr-ready', { qrDataUrl }))
          .catch(e => console.error('[trivia] QR error:', e.message));
        console.log('[trivia] room', roomCode, '| mode:', mode, '| rounds:', room.playlist.length);
      } catch (err) {
        console.error('[trivia] create-room error:', err);
        socket.emit('create-room-error', { message: 'Failed to create room: ' + err.message });
      }
    });

    socket.on('get-meta', () => {
      socket.emit('trivia-meta', { categories: MC_CATEGORIES, modes: Object.values(MODES).map(m => m.meta) });
    });

    socket.on('check-room', ({ roomCode }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.phase === 'game-over') {
        socket.emit('room-check-result', { found: false, message: room ? 'This game has ended.' : 'Room not found. Check the code and try again.' });
        return;
      }
      socket.emit('room-check-result', { found: true, teamMode: room.teamMode, teams: room.teams.map(t => ({ name: t.name, color: t.color })) });
    });

    socket.on('join-room', ({ roomCode, playerName, teamIndex, playerId }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.phase === 'game-over') { socket.emit('join-error', { message: room ? 'This game has ended.' : 'Room not found.' }); return; }
      const name = (playerName || '').trim() || 'Anonymous';
      const pid = playerId ? String(playerId).slice(0, 64) : null;

      const existing = pid ? room.players.find(p => p.playerId === pid) : null;
      if (existing) { existing.name = name; bindPlayer(socket, room, existing); return; }

      let idx;
      if (room.teamMode === 'individual') {
        room.teams.push({ name, color: TEAM_COLORS[room.teams.length % TEAM_COLORS.length], score: 0 });
        idx = room.teams.length - 1;
      } else {
        idx = parseInt(teamIndex);
        if (isNaN(idx) || idx < 0 || idx >= room.teams.length) { socket.emit('join-error', { message: 'Invalid team.' }); return; }
      }
      const player = { socketId: socket.id, playerId: pid, name, teamIndex: idx, connected: true };
      room.players.push(player);
      bindPlayer(socket, room, player);
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

    // ── Host controls ──
    socket.on('start-game', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'lobby') return;
      room.roundIndex = 0; room.qIndexInRound = -1;
      emitRoundIntro(room);
    });

    socket.on('advance', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      advance(room);
    });

    // Host in-game controls — available during active play (any question/round phase).
    socket.on('skip-question', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      if (room.phase !== 'question' && room.phase !== 'question-reveal') return;
      skipQuestion(room);
    });

    socket.on('skip-round', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      if (!['round-intro', 'question', 'question-reveal', 'round-over'].includes(room.phase)) return;
      skipRound(room);
    });

    // Host adjusts a live reveal (e.g. Same Letter strike) — delegated to the mode.
    socket.on('host-action', (payload) => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'question-reveal') return;
      const mode = modeOf(room);
      if (mode && mode.hostAction && mode.hostAction(room, payload || {})) {
        const reveal = room.currentReveal;
        reveal.scores = getScores(room);
        namespace.to(room.roomCode).emit('question-reveal', reveal);
      }
    });

    socket.on('end-game', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      endGame(room);
    });

    // Tournament: the host page adopts a pre-created room instead of creating one.
    socket.on('claim-host', ({ roomCode }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || !room.tournament) return;
      room.hostSocketId = socket.id;
      socket.join(code);
      socket.roomCode = code;
      socket.isHost = true;
      socket.emit('host-attached', {
        roomCode: code,
        teamMode: room.teamMode,
        teams: getScores(room),
        ...snapshot(room, null)
      });
      emitPlayers(room);
    });

    // ── Player answer ──
    socket.on('submit', (payload) => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.phase !== 'question') return;
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;
      const mode = modeOf(room);
      const res = mode.submit(room, player, payload || {});
      if (res && res.ok) {
        socket.emit('you-submitted', res.ack || { choice: res.choice });
        const answered = mode.progressCount ? mode.progressCount(room) : (room.modeState && room.modeState.answers ? room.modeState.answers.size : 0);
        const total = room.players.filter(p => p.connected).length;
        if (room.hostSocketId) namespace.to(room.hostSocketId).emit('answer-progress', { answered, total });
        if (res.allAnswered) resolveStage(room);
      }
    });

    socket.on('disconnect', () => {
      const roomCode = socket.roomCode;
      if (!roomCode) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      if (socket.isHost) {
        clearRoomTimer(room);
        namespace.to(roomCode).emit('host-disconnected', {});
        rooms.delete(roomCode);
      } else {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) { player.connected = false; emitPlayers(room); }
      }
    });
  });

  // ── Tournament integration (gated by room.tournament) ───────
  // Trivia runs in a tournament as a single Fastest Finger round; the tournament's
  // "length" is the number of questions. The host adopts the room via claim-host,
  // plays the round, and endGame() hands final standings back to the orchestrator.
  orchestrator.register('trivia', ({ roster, teams, mode, config, length, onComplete }) => {
    const roomCode = generateRoomCode();
    const gameMode = mode === 'individual' ? 'individual' : 'teams';
    const builtTeams = (teams || []).map((t, i) => ({
      name: t.name, color: t.color || TEAM_COLORS[i % TEAM_COLORS.length], score: 0
    }));
    const count = Math.min(Math.max(parseInt(length) || 8, 1), 20);
    const room = {
      roomCode,
      hostSocketId: null,
      teams: builtTeams,
      players: (roster || []).map(r => ({ socketId: null, playerId: r.playerId, name: r.name, teamIndex: r.teamIndex, connected: false })),
      teamMode: gameMode,
      familyFriendly: true,
      playlist: sanitizePlaylist([{ mode: 'fastest-finger', category: 'any', difficulty: 'any', count, seconds: 20 }]),
      phase: 'lobby',
      roundIndex: -1, qIndexInRound: -1,
      currentQuestion: null, modeState: null, currentPublic: null, currentReveal: null,
      usedQuestions: new Set(),
      secondsLeft: null, questionTimer: null,
      roundScoreBase: null, lastRoundScores: null,
      tournament: true,
      onComplete,
      concluded: false
    };
    rooms.set(roomCode, room);
    console.log('[trivia] tournament room', roomCode, '| mode:', gameMode, '| questions:', count, '| players:', room.players.length);
    return { roomCode };
  });
};
