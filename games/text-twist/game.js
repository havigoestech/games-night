const QRCode = require('qrcode');
const { dictionary, randomPuzzle, scoreWord, MIN_LEN } = require('./puzzles');
const orchestrator = require('../tournament/orchestrator');

const TEAM_COLORS = [
  '#FF2D55', '#5856D6', '#FF9500', '#34C759',
  '#00C7BE', '#FF375F', '#BF5AF2', '#FFD60A'
];
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const LOCKOUT_MS = 2000;      // wrong word freezes that player's input only
const BOARD_CLEAR_BONUS = 250;

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

function getScores(room) {
  return room.teams.map((t, i) => ({ index: i, name: t.name, color: t.color, score: t.score }));
}

function publicPlayers(room) {
  return room.players.map(p => ({ name: p.name, teamIndex: p.teamIndex, connected: p.connected }));
}

function clearRoundTimer(room) {
  if (room.roundTimer) { clearInterval(room.roundTimer); room.roundTimer = null; }
}

// Can `word` be built from the rack, respecting letter counts?
function formable(word, letters) {
  const pool = {};
  for (const c of letters) pool[c] = (pool[c] || 0) + 1;
  for (const c of word) {
    if (!pool[c]) return false;
    pool[c]--;
  }
  return true;
}

// How many words of each length exist, and how many this team has found.
// This is the ONLY view of the unfound answers any client ever gets — it gives
// teams direction ("we're missing the 7-letter one") without leaking words.
function buckets(room, teamIndex) {
  const found = room.found[teamIndex] || new Map();
  const out = new Map();
  for (const w of room.puzzle.words) {
    const b = out.get(w.length) || { length: w.length, total: 0, got: 0 };
    b.total++;
    if (found.has(w)) b.got++;
    out.set(w.length, b);
  }
  return [...out.values()].sort((a, b) => a.length - b.length);
}

function teamWords(room, teamIndex) {
  const found = room.found[teamIndex];
  if (!found) return [];
  return [...found.values()];
}

function teamProgress(room) {
  return room.teams.map((t, i) => ({
    teamIndex: i,
    wordCount: room.found[i] ? room.found[i].size : 0,
    points: room.roundPoints[i] || 0,
    total: room.puzzle ? room.puzzle.words.length : 0
  }));
}

// Everything a client needs to render the current moment. A phone that slept
// mid-round wakes up with the right letters, a LIVE timer, and its team's word
// list intact. Deliberately carries no unfound answer text.
function snapshot(room, teamIndex) {
  return {
    phase: room.phase,
    round: room.round,
    mode: room.mode,
    difficulty: room.difficulty,
    roundSeconds: room.roundSeconds,
    secondsLeft: room.secondsLeft,
    letters: room.letters,
    scores: getScores(room),
    teamNames: room.teams.map(t => t.name),
    teamColors: room.teams.map(t => t.color),
    myWords: room.puzzle && teamIndex != null ? teamWords(room, teamIndex) : [],
    buckets: room.puzzle && teamIndex != null ? buckets(room, teamIndex) : [],
    progress: room.puzzle ? teamProgress(room) : [],
    lastRoundResult: room.lastRoundResult
  };
}

module.exports = function registerTextTwist(namespace, localIP, port) {

  function emitPlayers(room) {
    if (!room.hostSocketId) return;
    namespace.to(room.hostSocketId).emit('players-update', {
      allPlayers: publicPlayers(room),
      scores: getScores(room)
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
    socket.emit('joined', {
      roomCode: room.roomCode,
      teamIndex: player.teamIndex,
      ...snapshot(room, player.teamIndex)
    });
    emitPlayers(room);
  }

  // Broadcast counts (never words) to everyone — safe to show on the host TV.
  function pushProgress(room) {
    namespace.to(room.roomCode).emit('team-progress', { progress: teamProgress(room) });
  }

  function endRound(room, reason, winnerTeamIndex = null) {
    clearRoundTimer(room);
    room.secondsLeft = 0;
    room.phase = 'round-over';

    // Bank each team's round points into their running score.
    room.teams.forEach((t, i) => { t.score += room.roundPoints[i] || 0; });
    if (winnerTeamIndex != null) {
      room.teams[winnerTeamIndex].score += BOARD_CLEAR_BONUS;
      room.roundPoints[winnerTeamIndex] = (room.roundPoints[winnerTeamIndex] || 0) + BOARD_CLEAR_BONUS;
    }

    // Full reveal — the only time word text goes out to everyone.
    const allWords = room.puzzle.words.map(w => ({
      word: w,
      length: w.length,
      pts: scoreWord(w, room.letters.length),
      isTopWord: w.length === room.letters.length,
      foundBy: room.teams.map((_, i) => i).filter(i => room.found[i] && room.found[i].has(w))
    }));

    room.lastRoundResult = {
      reason,
      winnerTeamIndex,
      bonus: winnerTeamIndex != null ? BOARD_CLEAR_BONUS : 0,
      source: room.puzzle.source,
      roundPoints: room.teams.map((_, i) => room.roundPoints[i] || 0)
    };

    const finalRound = !!room.tournament && room.round >= room.tournamentLength;

    namespace.to(room.roomCode).emit('round-complete', {
      reason,
      winnerTeamIndex,
      bonus: winnerTeamIndex != null ? BOARD_CLEAR_BONUS : 0,
      letters: room.letters,
      topWord: room.puzzle.source,
      allWords,
      roundPoints: room.teams.map((_, i) => room.roundPoints[i] || 0),
      scores: getScores(room),
      tournamentFinalRound: finalRound
    });

    // In a tournament this game runs for a fixed number of rounds — after the
    // last one, wrap up automatically and hand the result back to the
    // tournament (a beat later, so the round-over reveal has time to show).
    if (finalRound) setTimeout(() => concludeGame(room), 6000);
  }

  // Ends the game once and, if it's a tournament game, reports the final
  // standings back to the tournament via the onComplete callback.
  function concludeGame(room) {
    if (room.concluded) return;
    room.concluded = true;
    clearRoundTimer(room);
    room.phase = 'game-over';
    const scores = getScores(room).sort((a, b) => b.score - a.score);
    namespace.to(room.roomCode).emit('game-over', { scores });
    if (room.tournament && typeof room.onComplete === 'function') {
      try { room.onComplete(scores); } catch (e) { console.error('[text-twist] onComplete error:', e.message); }
    }
  }

  namespace.on('connection', (socket) => {

    socket.on('create-room', ({ teamCount, teamNames, mode, difficulty, roundSeconds, baseUrl }) => {
      try {
        console.log('[text-twist] create-room from', socket.id);
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

        const diff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
        const validSeconds = [60, 90, 120, 180];
        const secs = validSeconds.includes(parseInt(roundSeconds)) ? parseInt(roundSeconds) : 120;

        const roomCode = generateRoomCode();
        const room = {
          roomCode,
          hostSocketId: socket.id,
          teams,
          players: [],
          phase: 'lobby',
          mode: gameMode,
          difficulty: diff,
          roundSeconds: secs,
          secondsLeft: null,
          round: 0,
          puzzle: null,
          letters: null,
          found: {},           // teamIndex -> Map<word, {word, pts, by, isTopWord}>
          roundPoints: {},     // teamIndex -> points this round
          usedSources: new Set(),
          roundTimer: null,
          lastRoundResult: null
        };

        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;

        // Host might have opened the page on localhost — players on phones
        // can't reach that, so swap localhost/127.0.0.1 for the LAN IP.
        const isLocalhost = baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(baseUrl);
        const playerBaseUrl = (!baseUrl || isLocalhost) ? `http://${localIP}:${port}` : baseUrl;
        const joinUrl = `${playerBaseUrl}/games/text-twist/player.html?room=${roomCode}`;

        console.log('[text-twist] Room created:', roomCode, '| mode:', gameMode, '| difficulty:', diff, '|', secs + 's');

        socket.emit('room-created', {
          roomCode, joinUrl, localIP, port,
          teams: room.teams, mode: gameMode, difficulty: diff, roundSeconds: secs,
          qrDataUrl: null
        });

        QRCode.toDataURL(joinUrl, { width: 200, margin: 1, color: { dark: '#ffffff', light: '#0a0a18' } })
          .then(qrDataUrl => socket.emit('qr-ready', { qrDataUrl }))
          .catch(e => console.error('[text-twist] QR error:', e.message));

      } catch (err) {
        console.error('[text-twist] create-room error:', err);
        socket.emit('create-room-error', { message: 'Failed to create room: ' + err.message });
      }
    });

    socket.on('check-room', ({ roomCode }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.phase === 'game-over') {
        socket.emit('room-check-result', {
          found: false,
          message: room ? 'This game has ended.' : 'Room not found. Check the code and try again.'
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
      if (!room || room.phase === 'game-over') {
        socket.emit('join-error', { message: room ? 'This game has ended.' : 'Room not found.' });
        return;
      }
      const name = (playerName || '').trim() || 'Anonymous';
      const pid = playerId ? String(playerId).slice(0, 64) : null;

      // Same playerId = same phone coming back (screen-locked, or re-scanned the
      // QR). Re-bind to the existing slot rather than creating a duplicate.
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
        if (room.puzzle) { room.found[idx] = new Map(); room.roundPoints[idx] = 0; }
      } else {
        idx = parseInt(teamIndex);
        if (isNaN(idx) || idx < 0 || idx >= room.teams.length) {
          socket.emit('join-error', { message: 'Invalid team.' });
          return;
        }
      }

      room.players.push({ socketId: socket.id, playerId: pid, name, teamIndex: idx, connected: true, lockedUntil: 0 });
      bindPlayer(socket, room, room.players[room.players.length - 1]);
    });

    socket.on('rejoin-room', ({ roomCode, playerId }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        socket.emit('rejoin-failed', { message: 'Room not found — the game may have ended.' });
        return;
      }
      if (room.phase === 'game-over') {
        socket.emit('rejoin-failed', { message: 'This game has ended.' });
        return;
      }
      const pid = playerId ? String(playerId).slice(0, 64) : null;
      const player = pid ? room.players.find(p => p.playerId === pid) : null;
      if (!player) {
        socket.emit('rejoin-failed', { message: 'Could not find you in this room — please join again.' });
        return;
      }
      bindPlayer(socket, room, player);
    });

    socket.on('request-sync', () => {
      const room = rooms.get(socket.roomCode);
      if (!room) return;
      socket.emit('sync', snapshot(room, socket.isHost ? null : socket.teamIndex));
    });

    // Host: deal a new jumble and start the clock.
    socket.on('start-round', ({ difficulty } = {}) => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      if (room.phase !== 'lobby' && room.phase !== 'round-over') return;
      if (room.teams.length === 0) return;   // individual mode with nobody in yet

      if (['easy', 'medium', 'hard'].includes(difficulty)) room.difficulty = difficulty;

      clearRoundTimer(room);

      // Avoid repeating a jumble within one game.
      let puzzle;
      for (let i = 0; i < 40; i++) {
        puzzle = randomPuzzle(room.difficulty);
        if (!room.usedSources.has(puzzle.source)) break;
      }
      room.usedSources.add(puzzle.source);

      room.puzzle = puzzle;
      room.letters = shuffle(puzzle.source.split('')).join('');
      room.round++;
      room.phase = 'round';
      room.found = {};
      room.roundPoints = {};
      room.lastRoundResult = null;
      room.teams.forEach((_, i) => { room.found[i] = new Map(); room.roundPoints[i] = 0; });
      room.players.forEach(p => { p.lockedUntil = 0; });

      let secondsLeft = room.roundSeconds;
      room.secondsLeft = secondsLeft;

      namespace.to(room.roomCode).emit('round-start', {
        round: room.round,
        letters: room.letters,
        difficulty: room.difficulty,
        roundSeconds: room.roundSeconds,
        secondsLeft,
        // totals only — never the words themselves
        buckets: buckets(room, 0).map(b => ({ length: b.length, total: b.total, got: 0 })),
        totalWords: puzzle.words.length,
        progress: teamProgress(room),
        scores: getScores(room)
      });

      room.roundTimer = setInterval(() => {
        secondsLeft--;
        room.secondsLeft = secondsLeft;   // mirrored so a reconnect gets a live timer
        if (secondsLeft > 0) {
          namespace.to(room.roomCode).emit('timer', { secondsLeft });
        } else {
          namespace.to(room.roomCode).emit('timer', { secondsLeft: 0 });
          endRound(room, 'timer');
        }
      }, 1000);
    });

    socket.on('submit-word', ({ word }) => {
      const room = rooms.get(socket.roomCode);
      if (!room || socket.isHost || room.phase !== 'round') return;

      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;

      const now = Date.now();
      if (player.lockedUntil > now) {
        socket.emit('word-rejected', { word: '', reason: 'locked', lockMs: player.lockedUntil - now });
        return;
      }

      const guess = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
      const teamIndex = player.teamIndex;
      const found = room.found[teamIndex];
      if (!found) return;

      const reject = (reason) => {
        player.lockedUntil = now + LOCKOUT_MS;
        socket.emit('word-rejected', { word: guess, reason, lockMs: LOCKOUT_MS });
      };

      if (guess.length < MIN_LEN)                  return reject('too-short');
      if (!formable(guess, room.letters))          return reject('letters');
      if (!dictionary.has(guess))                  return reject('not-a-word');

      // A teammate already got it — honest collision in a shared pool, so no
      // lockout. With four people typing at once this happens constantly.
      if (found.has(guess)) {
        socket.emit('word-duplicate', { word: guess, by: found.get(guess).by });
        return;
      }

      // Not one of this puzzle's answers (dictionary word, but unreachable) —
      // shouldn't happen since formable+dictionary implies it's an answer, but
      // guard anyway.
      if (!room.puzzle.words.includes(guess)) return reject('not-a-word');

      const isTopWord = guess.length === room.letters.length;
      const pts = scoreWord(guess, room.letters.length);
      found.set(guess, { word: guess, pts, by: player.name, isTopWord });
      room.roundPoints[teamIndex] = (room.roundPoints[teamIndex] || 0) + pts;

      // Word text goes ONLY to the team that found it.
      const teamSockets = room.players
        .filter(p => p.teamIndex === teamIndex && p.connected)
        .map(p => p.socketId);
      const payload = {
        word: guess, pts, isTopWord, by: player.name,
        teamIndex,
        teamWords: teamWords(room, teamIndex),
        buckets: buckets(room, teamIndex),
        roundPoints: room.roundPoints[teamIndex]
      };
      for (const sid of teamSockets) namespace.to(sid).emit('word-accepted', payload);

      pushProgress(room);

      if (found.size >= room.puzzle.words.length) {
        namespace.to(room.roomCode).emit('board-cleared', {
          teamIndex, teamName: room.teams[teamIndex].name, bonus: BOARD_CLEAR_BONUS
        });
        endRound(room, 'board-clear', teamIndex);
      }
    });

    socket.on('end-round', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'round') return;
      endRound(room, 'host-ended');
    });

    socket.on('end-game', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      concludeGame(room);
    });

    // Tournament: the host claims an already-created (pre-seeded) game room as
    // its host, rather than creating one via the setup screen.
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
        teams: room.teams.map(t => ({ name: t.name, color: t.color })),
        mode: room.mode,
        difficulty: room.difficulty,
        roundSeconds: room.roundSeconds,
        tournamentLength: room.tournamentLength,
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
        clearRoundTimer(room);
        namespace.to(roomCode).emit('host-disconnected', {});
        rooms.delete(roomCode);
      } else {
        // Phones lock constantly mid-game — keep the player, just mark them away.
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          player.connected = false;
          emitPlayers(room);
        }
      }
    });
  });

  // ── Tournament integration ──────────────────────────────────
  // The tournament calls this to spin up a game room already seeded with its
  // roster and teams. Players auto-join by playerId (rejoin) — no team pick.
  // Everything tournament-specific is gated behind room.tournament, so normal
  // play is byte-for-byte unchanged.
  orchestrator.register('text-twist', ({ roster, teams, mode, config, length, onComplete }) => {
    const roomCode = generateRoomCode();
    const gameMode = mode === 'individual' ? 'individual' : 'teams';
    const builtTeams = (teams || []).map((t, i) => ({
      name: t.name, color: t.color || TEAM_COLORS[i % TEAM_COLORS.length], score: 0
    }));
    const diff = ['easy', 'medium', 'hard'].includes(config && config.difficulty) ? config.difficulty : 'medium';
    const secs = [60, 90, 120, 180].includes(parseInt(config && config.roundSeconds)) ? parseInt(config.roundSeconds) : 120;

    const room = {
      roomCode,
      hostSocketId: null,
      teams: builtTeams,
      players: (roster || []).map(r => ({
        socketId: null, playerId: r.playerId, name: r.name, teamIndex: r.teamIndex,
        connected: false, lockedUntil: 0
      })),
      phase: 'lobby',
      mode: gameMode,
      difficulty: diff,
      roundSeconds: secs,
      secondsLeft: null,
      round: 0,
      puzzle: null,
      letters: null,
      found: {},
      roundPoints: {},
      usedSources: new Set(),
      roundTimer: null,
      lastRoundResult: null,
      tournament: true,
      tournamentLength: Math.min(Math.max(parseInt(length) || 3, 1), 20),
      onComplete,
      concluded: false
    };
    rooms.set(roomCode, room);
    console.log('[text-twist] tournament room', roomCode, '| rounds:', room.tournamentLength, '| players:', room.players.length);
    return { roomCode };
  });
};
