const QRCode = require('qrcode');

const TEAM_COLORS = ['#FF2D55', '#5856D6'];
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const MAX_ROUNDS = 12;        // stalemate insurance — a match must land eventually
const REVEAL_MS = 4000;       // beat between a round resolving and the next one opening
const WIN_BASE = 1000;
const WIN_STEP = 100;
const WIN_FLOOR = 300;

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

function getScores(room) {
  return room.teams.map((t, i) => ({ index: i, name: t.name, color: t.color, score: t.score }));
}

function publicPlayers(room) {
  return room.players.map(p => ({ name: p.name, teamIndex: p.teamIndex, connected: p.connected }));
}

// A kill is a right digit in the right slot; an injury is a right digit in the
// wrong slot. Written to be correct even with repeated digits (we disallow them,
// but the multiset counting is the part people get wrong, so do it properly).
//   1234 vs 4567 → 0 kills, 1 injury
//   1234 vs 1832 → 2 kills, 1 injury
function judge(secret, guess) {
  let kills = 0;
  const sRest = [], gRest = [];
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) kills++;
    else { sRest.push(secret[i]); gRest.push(guess[i]); }
  }
  const pool = {};
  for (const c of sRest) pool[c] = (pool[c] || 0) + 1;
  let injuries = 0;
  for (const c of gRest) if (pool[c]) { injuries++; pool[c]--; }
  return { kills, injuries };
}

// Codes and guesses are both "all digits, all different".
function validCode(str, len) {
  if (typeof str !== 'string') return false;
  if (!new RegExp(`^\\d{${len}}$`).test(str)) return false;
  return new Set(str).size === len;
}

function freshNotes() {
  const n = {};
  for (let d = 0; d <= 9; d++) n[d] = 'unknown';
  return n;
}

function clearTimers(room) {
  if (room.roundTimer) { clearInterval(room.roundTimer); room.roundTimer = null; }
  if (room.revealTimer) { clearTimeout(room.revealTimer); room.revealTimer = null; }
}

function winPoints(round) {
  return Math.max(WIN_BASE - (round - 1) * WIN_STEP, WIN_FLOOR);
}

// Everything a client needs to render the current moment.
// `teamIndex === null` means the HOST — who deliberately never receives either
// secret or either notepad, so the screen is safe to put on a TV.
function snapshot(room, teamIndex) {
  const mine = typeof teamIndex === 'number';
  return {
    phase: room.phase,
    match: room.match,
    round: room.round,
    codeLength: room.codeLength,
    roundSeconds: room.roundSeconds,
    secondsLeft: room.secondsLeft,
    maxRounds: MAX_ROUNDS,
    scores: getScores(room),
    teamNames: room.teams.map(t => t.name),
    teamColors: room.teams.map(t => t.color),
    codeReady: [!!room.secrets[0], !!room.secrets[1]],
    boards: room.boards,                                   // both public — that's the drama
    locked: [!!room.pending[0], !!room.pending[1]],
    myCode: mine ? (room.secrets[teamIndex] || null) : null,
    myCodeBy: mine ? (room.codeBy[teamIndex] || null) : null,
    myNotes: mine ? room.notes[teamIndex] : null,
    myGuess: mine && room.pending[teamIndex] ? room.pending[teamIndex].guess : null,
    lastMatchResult: room.lastMatchResult
  };
}

module.exports = function registerKillAndInjury(namespace, localIP, port) {

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

  const teamSockets = (room, teamIndex) =>
    room.players.filter(p => p.teamIndex === teamIndex && p.connected).map(p => p.socketId);

  function toTeam(room, teamIndex, event, payload) {
    for (const sid of teamSockets(room, teamIndex)) namespace.to(sid).emit(event, payload);
  }

  function startRound(room) {
    room.round++;
    room.phase = 'guessing';
    room.pending = [null, null];

    let secondsLeft = room.roundSeconds;
    room.secondsLeft = secondsLeft;

    namespace.to(room.roomCode).emit('round-start', {
      round: room.round,
      secondsLeft,
      maxRounds: MAX_ROUNDS
    });

    clearTimers(room);
    room.roundTimer = setInterval(() => {
      secondsLeft--;
      room.secondsLeft = secondsLeft;      // mirrored so a reconnect gets a LIVE clock
      if (secondsLeft > 0) {
        namespace.to(room.roomCode).emit('timer', { secondsLeft });
      } else {
        namespace.to(room.roomCode).emit('timer', { secondsLeft: 0 });
        resolveRound(room);                // whoever didn't submit forfeits
      }
    }, 1000);
  }

  function resolveRound(room) {
    if (room.phase !== 'guessing') return;
    clearTimers(room);
    room.phase = 'round-reveal';

    const results = [0, 1].map(i => {
      const pending = room.pending[i];
      if (!pending) {
        // Dallied past the clock — a visible forfeit row, and the round is gone.
        const row = { round: room.round, forfeit: true, guess: null, kills: 0, injuries: 0, by: null };
        room.boards[i].push(row);
        return { teamIndex: i, ...row };
      }
      const { kills, injuries } = judge(room.secrets[1 - i], pending.guess);
      const row = { round: room.round, forfeit: false, guess: pending.guess, kills, injuries, by: pending.by };
      room.boards[i].push(row);
      return { teamIndex: i, ...row };
    });

    const cracked = results.map(r => !r.forfeit && r.kills === room.codeLength);
    const closeCall = results.map(r => !r.forfeit && r.kills === room.codeLength - 1);

    namespace.to(room.roomCode).emit('round-result', {
      round: room.round,
      results,
      boards: room.boards,
      closeCall,
      cracked
    });

    if (cracked[0] || cracked[1]) {
      const winner = (cracked[0] && cracked[1]) ? null : (cracked[0] ? 0 : 1);
      room.revealTimer = setTimeout(() =>
        endMatch(room, cracked[0] && cracked[1] ? 'draw' : 'cracked', winner), 1500);
      return;
    }

    if (room.round >= MAX_ROUNDS) {
      room.revealTimer = setTimeout(() => endMatch(room, 'stalemate', null), 1500);
      return;
    }

    // A beat to absorb the feedback, then the next round opens.
    room.revealTimer = setTimeout(() => startRound(room), REVEAL_MS);
  }

  // reason: 'cracked' | 'draw' | 'stalemate' | 'host-ended'
  function endMatch(room, reason, winnerTeamIndex) {
    clearTimers(room);
    room.phase = 'match-over';

    const points = [0, 0];
    if (reason === 'cracked' && winnerTeamIndex != null) {
      points[winnerTeamIndex] = winPoints(room.round);
    } else if (reason === 'draw') {
      points[0] = points[1] = winPoints(room.round);   // both cracked it — both score
    }
    room.teams.forEach((t, i) => { t.score += points[i]; });

    room.lastMatchResult = {
      reason,
      winnerTeamIndex: winnerTeamIndex ?? null,
      rounds: room.round,
      points,
      secrets: [room.secrets[0], room.secrets[1]]       // the reveal — and only here
    };

    namespace.to(room.roomCode).emit('match-over', {
      reason,
      winnerTeamIndex: winnerTeamIndex ?? null,
      rounds: room.round,
      points,
      secrets: [room.secrets[0], room.secrets[1]],
      boards: room.boards,
      scores: getScores(room)
    });
  }

  function beginCodePhase(room) {
    clearTimers(room);
    room.match++;
    room.round = 0;
    room.phase = 'set-codes';
    room.secrets = [null, null];
    room.codeBy = [null, null];
    room.boards = [[], []];
    room.notes = [freshNotes(), freshNotes()];
    room.pending = [null, null];
    room.secondsLeft = null;
    room.lastMatchResult = null;

    namespace.to(room.roomCode).emit('code-phase', {
      match: room.match,
      codeLength: room.codeLength,
      scores: getScores(room)
    });
    [0, 1].forEach(i => toTeam(room, i, 'notes-update', { notes: room.notes[i] }));
  }

  namespace.on('connection', (socket) => {

    socket.on('create-room', ({ teamNames, codeLength, roundSeconds, baseUrl }) => {
      try {
        console.log('[kill-and-injury] create-room from', socket.id);
        // Always exactly two sides. A side of one person is simply a 1v1.
        const teams = Array.from({ length: 2 }, (_, i) => ({
          name: ((teamNames || [])[i] || `Team ${i + 1}`).trim() || `Team ${i + 1}`,
          color: TEAM_COLORS[i],
          score: 0
        }));

        const len = [3, 4, 5].includes(parseInt(codeLength)) ? parseInt(codeLength) : 4;
        const secs = [30, 45, 60, 90].includes(parseInt(roundSeconds)) ? parseInt(roundSeconds) : 60;

        const roomCode = generateRoomCode();
        const room = {
          roomCode,
          hostSocketId: socket.id,
          teams,
          players: [],
          phase: 'lobby',
          codeLength: len,
          roundSeconds: secs,
          secondsLeft: null,
          match: 0,
          round: 0,
          secrets: [null, null],
          codeBy: [null, null],
          boards: [[], []],
          notes: [freshNotes(), freshNotes()],
          pending: [null, null],
          roundTimer: null,
          revealTimer: null,
          lastMatchResult: null
        };

        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;

        // Host might have opened the page on localhost — players on phones
        // can't reach that, so swap localhost/127.0.0.1 for the LAN IP.
        const isLocalhost = baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(baseUrl);
        const playerBaseUrl = (!baseUrl || isLocalhost) ? `http://${localIP}:${port}` : baseUrl;
        const joinUrl = `${playerBaseUrl}/games/kill-and-injury/player.html?room=${roomCode}`;

        console.log('[kill-and-injury] Room created:', roomCode, '| code length:', len, '|', secs + 's rounds');

        socket.emit('room-created', {
          roomCode, joinUrl, localIP, port,
          teams: room.teams, codeLength: len, roundSeconds: secs, qrDataUrl: null
        });

        QRCode.toDataURL(joinUrl, { width: 200, margin: 1, color: { dark: '#ffffff', light: '#0a0a18' } })
          .then(qrDataUrl => socket.emit('qr-ready', { qrDataUrl }))
          .catch(e => console.error('[kill-and-injury] QR error:', e.message));

      } catch (err) {
        console.error('[kill-and-injury] create-room error:', err);
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

      // Same playerId = the same phone coming back (screen-locked, or re-scanned
      // the QR). Re-bind to the existing slot rather than creating a duplicate.
      const existing = pid ? room.players.find(p => p.playerId === pid) : null;
      if (existing) {
        existing.name = name;
        const idx = parseInt(teamIndex);
        if (!isNaN(idx) && idx >= 0 && idx < 2) existing.teamIndex = idx;
        bindPlayer(socket, room, existing);
        return;
      }

      const idx = parseInt(teamIndex);
      if (isNaN(idx) || idx < 0 || idx > 1) {
        socket.emit('join-error', { message: 'Invalid team.' });
        return;
      }

      room.players.push({ socketId: socket.id, playerId: pid, name, teamIndex: idx, connected: true });
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

    // Host: open the code-setting phase (first match, or the next one).
    socket.on('start-codes', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      if (room.phase !== 'lobby' && room.phase !== 'match-over') return;
      beginCodePhase(room);
    });

    // Player: set (or overwrite) their side's secret. Teammates see it; the
    // opponent and the host never do.
    socket.on('set-code', ({ code }) => {
      const room = rooms.get(socket.roomCode);
      if (!room || socket.isHost || room.phase !== 'set-codes') return;
      const t = socket.teamIndex;
      if (typeof t !== 'number') return;

      const c = String(code || '').replace(/\D/g, '');
      if (!validCode(c, room.codeLength)) {
        socket.emit('code-rejected', {
          message: `Use ${room.codeLength} different digits — no repeats.`
        });
        return;
      }

      room.secrets[t] = c;
      room.codeBy[t] = socket.playerName;

      toTeam(room, t, 'your-code', { code: c, by: socket.playerName });
      namespace.to(room.roomCode).emit('code-status', {
        ready: [!!room.secrets[0], !!room.secrets[1]]
      });
    });

    // Host: both codes in → start the duel.
    socket.on('start-match', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'set-codes') return;
      if (!room.secrets[0] || !room.secrets[1]) return;

      room.round = 0;
      namespace.to(room.roomCode).emit('match-start', {
        match: room.match,
        codeLength: room.codeLength,
        roundSeconds: room.roundSeconds,
        maxRounds: MAX_ROUNDS,
        scores: getScores(room)
      });
      startRound(room);
    });

    // Player: submit their side's guess for this round. First submission from a
    // side locks it in — so teammates have to actually talk to each other.
    socket.on('submit-guess', ({ guess }) => {
      const room = rooms.get(socket.roomCode);
      if (!room || socket.isHost || room.phase !== 'guessing') return;
      const t = socket.teamIndex;
      if (typeof t !== 'number') return;
      if (room.pending[t]) {
        socket.emit('guess-rejected', { message: 'Your team has already locked in this round.' });
        return;
      }

      const g = String(guess || '').replace(/\D/g, '');
      if (!validCode(g, room.codeLength)) {
        socket.emit('guess-rejected', {
          message: `Use ${room.codeLength} different digits — no repeats.`
        });
        return;
      }
      if (room.boards[t].some(r => r.guess === g)) {
        socket.emit('guess-rejected', { message: `You already tried ${g} — that would waste the round.` });
        return;
      }

      room.pending[t] = { guess: g, by: socket.playerName };

      // Everyone sees THAT a side has committed (not what they guessed) — it
      // puts the pressure on whoever is still deliberating.
      namespace.to(room.roomCode).emit('guess-locked', { teamIndex: t, by: socket.playerName });
      toTeam(room, t, 'your-guess-locked', { guess: g, by: socket.playerName });

      // Both in — resolve early rather than making anyone wait out the clock.
      if (room.pending[0] && room.pending[1]) resolveRound(room);
    });

    // Player: tap a digit on the team's shared notepad.
    socket.on('update-note', ({ digit, state }) => {
      const room = rooms.get(socket.roomCode);
      if (!room || socket.isHost) return;
      const t = socket.teamIndex;
      if (typeof t !== 'number' || !room.notes[t]) return;

      const d = String(digit);
      if (!/^[0-9]$/.test(d)) return;
      if (!['unknown', 'out', 'in'].includes(state)) return;

      room.notes[t][d] = state;
      // Only the owning side — the opponent must never see their working.
      toTeam(room, t, 'notes-update', { notes: room.notes[t], by: socket.playerName });
    });

    socket.on('end-match', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      if (room.phase !== 'guessing' && room.phase !== 'round-reveal') return;
      endMatch(room, 'host-ended', null);
    });

    socket.on('end-game', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      clearTimers(room);
      room.phase = 'game-over';
      const scores = getScores(room).sort((a, b) => b.score - a.score);
      namespace.to(room.roomCode).emit('game-over', { scores });
    });

    socket.on('disconnect', () => {
      const roomCode = socket.roomCode;
      if (!roomCode) return;
      const room = rooms.get(roomCode);
      if (!room) return;

      if (socket.isHost) {
        clearTimers(room);
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
};

module.exports.judge = judge;
module.exports.validCode = validCode;
module.exports.winPoints = winPoints;
module.exports.MAX_ROUNDS = MAX_ROUNDS;
