// Trivia — a quiz-night game: the host builds a playlist of rounds (which can
// mix modes), played as one continuous game with a single running leaderboard.
// Teams or solo (solo = each player is a one-person team). Modes are pluggable
// modules in ./modes; this engine owns the common lifecycle, timer, scoring
// accumulation and reconnect snapshots.
const QRCode = require('qrcode');

const TEAM_COLORS = ['#FF2D55', '#5856D6', '#FF9500', '#34C759', '#00C7BE', '#FF375F', '#BF5AF2', '#FFD60A'];
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const MODES = {
  'fastest-finger': require('./modes/fastest-finger'),
  'same-letter': require('./modes/same-letter'),
  'closest-wins': require('./modes/closest-wins'),
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

  function beginQuestion(room) {
    const round = currentRound(room);
    const mode = MODES[round.mode];
    mode.pickAndStart(room, round);
    room.phase = 'question';
    room.currentPublic = mode.publicQuestion(room);
    room.currentReveal = null;
    room.secondsLeft = round.seconds;
    const payload = { ...room.currentPublic, roundIndex: room.roundIndex, qNumber: room.qIndexInRound + 1, qCount: round.count, seconds: round.seconds };
    namespace.to(room.roomCode).emit('question', payload);
    // server-authoritative countdown, mirrored for reconnects
    clearRoomTimer(room);
    room.questionTimer = setInterval(() => {
      room.secondsLeft--;
      if (room.secondsLeft > 0) { namespace.to(room.roomCode).emit('timer', { secondsLeft: room.secondsLeft }); }
      else { namespace.to(room.roomCode).emit('timer', { secondsLeft: 0 }); resolveQuestion(room); }
    }, 1000);
  }

  function resolveQuestion(room) {
    clearRoomTimer(room);
    if (room.phase !== 'question') return;
    const reveal = modeOf(room).score(room);
    reveal.scores = getScores(room);
    reveal.roundIndex = room.roundIndex;
    reveal.qNumber = room.qIndexInRound + 1;
    reveal.qCount = currentRound(room).count;
    room.phase = 'question-reveal';
    room.currentReveal = reveal;
    namespace.to(room.roomCode).emit('question-reveal', reveal);
  }

  function emitRoundIntro(room) {
    const round = currentRound(room);
    room.phase = 'round-intro';
    room.roundScoreBase = getScores(room).map(s => s.score);   // to compute this round's delta
    namespace.to(room.roomCode).emit('round-intro', {
      roundIndex: room.roundIndex, totalRounds: room.playlist.length,
      modeName: MODES[round.mode].meta.name, modeIcon: MODES[round.mode].meta.icon,
      category: round.category, difficulty: round.difficulty, count: round.count
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
    clearRoomTimer(room);
    room.phase = 'game-over';
    const scores = getScores(room).sort((a, b) => b.score - a.score);
    namespace.to(room.roomCode).emit('game-over', { scores });
  }

  // Move the state machine forward from wherever it is (the host's "Next" button).
  function advance(room) {
    if (room.phase === 'round-intro') {
      room.qIndexInRound = 0;
      beginQuestion(room);
    } else if (room.phase === 'question') {
      resolveQuestion(room);                 // host chose to cut the timer short
    } else if (room.phase === 'question-reveal') {
      const round = currentRound(room);
      if (room.qIndexInRound + 1 < round.count) { room.qIndexInRound++; beginQuestion(room); }
      else { emitRoundOver(room); }
    } else if (room.phase === 'round-over') {
      if (room.roundIndex + 1 < room.playlist.length) { room.roundIndex++; room.qIndexInRound = -1; emitRoundIntro(room); }
      else { endGame(room); }
    }
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

    socket.on('end-game', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      endGame(room);
    });

    // ── Player answer ──
    socket.on('submit', (payload) => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.phase !== 'question') return;
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;
      const res = modeOf(room).submit(room, player, payload || {});
      if (res && res.ok) {
        socket.emit('you-submitted', res.ack || { choice: res.choice });
        const answered = room.modeState && room.modeState.answers ? room.modeState.answers.size : 0;
        const total = room.players.filter(p => p.connected).length;
        if (room.hostSocketId) namespace.to(room.hostSocketId).emit('answer-progress', { answered, total });
        if (res.allAnswered) resolveQuestion(room);
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
};
