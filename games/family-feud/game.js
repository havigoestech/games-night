const QRCode = require('qrcode');
const orchestrator = require('../tournament/orchestrator');

const TEAM_COLORS = [
  '#FF2D55', '#5856D6', '#FF9500', '#34C759',
  '#00C7BE', '#FF375F', '#BF5AF2', '#FFD60A'
];
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const { QUESTIONS } = require('./questions');

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

// Build a room's shuffled question pool. When familyFriendly, only clean
// questions are served (rude/adult ones hidden); otherwise the whole bank.
function pickQuestions(familyFriendly) {
  const pool = familyFriendly ? QUESTIONS.filter(q => q.clean) : QUESTIONS;
  return shuffle(pool);
}

function getScores(room) {
  return room.teams.map((t, i) => ({ index: i, name: t.name, color: t.color, score: t.score }));
}

function publicPlayers(room) {
  return room.players.map(p => ({ name: p.name, teamIndex: p.teamIndex, connected: p.connected }));
}

function resetFaceoff(room) {
  room.faceoff = { buzzer: null, firstAnswer: null, counterTeamIndex: null };
  room.buzzLocked = false;
}

// Everything a client needs to render the current moment of the game.
// Sent on join, rejoin, and request-sync so phones that slept mid-game land
// on the correct screen. Unrevealed answer text is NEVER included — players
// must not see the board; only the host gets the full key, via their private
// copy of question-start.
function snapshot(room) {
  const buzzer = room.faceoff.buzzer;
  const buzzerTeam = buzzer ? room.teams[buzzer.teamIndex] : null;
  return {
    phase: room.phase,
    round: room.round,
    question: room.currentQuestion ? room.currentQuestion.q : null,
    answerCount: room.currentQuestion ? room.currentQuestion.a.length : 0,
    revealed: room.revealed.map(r => ({
      index: r.index,
      text: room.currentQuestion.a[r.index].t,
      pts: room.currentQuestion.a[r.index].p,
      teamIndex: r.teamIndex,
      context: r.context
    })),
    pot: room.pot,
    strikes: room.strikes,
    scores: getScores(room),
    teamNames: room.teams.map(t => t.name),
    teamColors: room.teams.map(t => t.color),
    faceoff: {
      buzzer: buzzer ? {
        playerId: buzzer.playerId,
        playerName: buzzer.playerName,
        teamIndex: buzzer.teamIndex,
        teamName: buzzerTeam?.name,
        teamColor: buzzerTeam?.color
      } : null,
      firstAnswer: room.faceoff.firstAnswer,
      counterTeamIndex: room.faceoff.counterTeamIndex
    },
    faceoffWinnerTeamIndex: room.faceoffWinnerTeamIndex,
    controllingTeamIndex: room.controllingTeamIndex,
    stealTeamIndex: room.stealTeamIndex,
    lastRoundResult: room.lastRoundResult
  };
}

module.exports = function registerFamilyFeud(namespace, localIP, port) {

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
    socket.emit('joined', { roomCode: room.roomCode, teamIndex: player.teamIndex, ...snapshot(room) });
    emitPlayers(room);
  }

  // Flip an answer for everyone. Adds to the pot unless it's a post-round
  // "let's see what else was up there" cleanup flip.
  function revealAnswer(room, index, teamIndex, context) {
    const answer = room.currentQuestion.a[index];
    room.revealed.push({ index, teamIndex, context });
    if (context !== 'cleanup') room.pot += answer.p;
    namespace.to(room.roomCode).emit('answer-revealed', {
      answerIndex: index,
      text: answer.t,
      pts: answer.p,
      pot: room.pot,
      teamIndex,
      context,
      revealedIndices: room.revealed.map(r => r.index)
    });
  }

  function faceoffWon(room, winnerTeamIndex) {
    room.faceoffWinnerTeamIndex = winnerTeamIndex;
    room.phase = 'play-or-pass';
    const t = room.teams[winnerTeamIndex];
    namespace.to(room.roomCode).emit('faceoff-won', {
      winnerTeamIndex,
      winnerTeamName: t.name,
      winnerTeamColor: t.color
    });
  }

  // winnerTeamIndex === null → round scrapped, pot discarded (host bailed
  // mid-face-off).
  function endRound(room, winnerTeamIndex, reason) {
    const winner = winnerTeamIndex != null ? room.teams[winnerTeamIndex] : null;
    if (winner) winner.score += room.pot;
    room.phase = 'round-over';
    room.lastRoundResult = {
      winnerTeamIndex: winnerTeamIndex ?? null,
      winnerTeamName: winner?.name ?? null,
      winnerTeamColor: winner?.color ?? null,
      pot: room.pot,
      reason
    };
    namespace.to(room.roomCode).emit('round-complete', {
      scores: getScores(room),
      pot: room.pot,
      winnerTeamIndex: winnerTeamIndex ?? null,
      winnerTeamName: winner?.name ?? null,
      winnerTeamColor: winner?.color ?? null,
      reason,
      revealed: snapshot(room).revealed,
      answerCount: room.currentQuestion ? room.currentQuestion.a.length : 0,
      tournamentFinalRound: !!room.tournament && room.round >= room.tournamentLength
    });

    // In a tournament this game runs for a fixed number of questions — after the
    // last one, wrap up automatically and report the result back.
    if (room.tournament && room.round >= room.tournamentLength) {
      setTimeout(() => concludeGame(room), 5000);
    }
  }

  // Ends the game once and, in a tournament, reports final standings back.
  function concludeGame(room) {
    if (room.concluded) return;
    room.concluded = true;
    room.phase = 'game-over';
    const scores = getScores(room).sort((a, b) => b.score - a.score);
    namespace.to(room.roomCode).emit('game-over', { scores });
    if (room.tournament && typeof room.onComplete === 'function') {
      try { room.onComplete(scores); } catch (e) { console.error('[family-feud] onComplete error:', e.message); }
    }
  }

  namespace.on('connection', (socket) => {

    socket.on('create-room', ({ teamNames, baseUrl, familyFriendly = true }) => {
      try {
        console.log('[family-feud] create-room from', socket.id);
        // Family Feud is a head-to-head game — always exactly 2 teams.
        const teams = Array.from({ length: 2 }, (_, i) => ({
          name: ((teamNames || [])[i] || `Team ${i + 1}`).trim() || `Team ${i + 1}`,
          color: TEAM_COLORS[i],
          score: 0
        }));

        const roomCode = generateRoomCode();
        const room = {
          roomCode,
          hostSocketId: socket.id,
          teams,
          players: [],
          phase: 'lobby',
          familyFriendly: !!familyFriendly,
          questions: pickQuestions(familyFriendly),
          questionIndex: 0,
          currentQuestion: null,
          round: 0,
          pot: 0,
          strikes: 0,
          revealed: [],
          buzzLocked: false,
          faceoff: { buzzer: null, firstAnswer: null, counterTeamIndex: null },
          faceoffWinnerTeamIndex: null,
          controllingTeamIndex: null,
          stealTeamIndex: null,
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
        const joinUrl = `${playerBaseUrl}/games/family-feud/player.html?room=${roomCode}`;

        console.log('[family-feud] Room created:', roomCode);

        socket.emit('room-created', {
          roomCode, joinUrl, localIP, port, teams: room.teams
        });

        QRCode.toDataURL(joinUrl, { width: 200, margin: 1, color: { dark: '#ffffff', light: '#0a0a18' } })
          .then(qrDataUrl => socket.emit('qr-ready', { qrDataUrl }))
          .catch(e => console.error('[family-feud] QR error:', e.message));

      } catch (err) {
        console.error('[family-feud] create-room error:', err);
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

      // A player whose phone slept (or who re-scanned the QR) comes back with
      // the same playerId — re-bind them to their existing slot instead of
      // creating a duplicate entry.
      const existing = pid ? room.players.find(p => p.playerId === pid) : null;
      if (existing) {
        existing.name = name;
        const idx = parseInt(teamIndex);
        if (!isNaN(idx) && idx >= 0 && idx < room.teams.length) existing.teamIndex = idx;
        bindPlayer(socket, room, existing);
        return;
      }

      const idx = parseInt(teamIndex);
      if (isNaN(idx) || idx < 0 || idx >= room.teams.length) {
        socket.emit('join-error', { message: 'Invalid team.' });
        return;
      }

      room.players.push({ socketId: socket.id, playerId: pid, name, teamIndex: idx, connected: true });
      bindPlayer(socket, room, room.players[room.players.length - 1]);
    });

    // Automatic reconnect after a phone screen-lock / network blip.
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

    // Client asks for a fresh snapshot (e.g. tab came back to foreground
    // without the socket dropping).
    socket.on('request-sync', () => {
      const room = rooms.get(socket.roomCode);
      if (!room) return;
      socket.emit('sync', snapshot(room));
    });

    // Host: start the next question → face-off
    socket.on('start-question', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      if (room.phase !== 'lobby' && room.phase !== 'round-over') return;

      if (room.questionIndex >= room.questions.length) {
        room.phase = 'game-over';
        const scores = getScores(room).sort((a, b) => b.score - a.score);
        namespace.to(room.roomCode).emit('game-over', { scores });
        return;
      }

      const q = room.questions[room.questionIndex++];
      room.currentQuestion = q;
      room.round = room.questionIndex;
      room.revealed = [];
      room.strikes = 0;
      room.pot = 0;
      room.faceoffWinnerTeamIndex = null;
      room.controllingTeamIndex = null;
      room.stealTeamIndex = null;
      room.lastRoundResult = null;
      resetFaceoff(room);
      room.phase = 'faceoff';

      const common = {
        question: q.q,
        answerCount: q.a.length,
        round: room.round,
        scores: getScores(room),
        pot: 0
      };

      // The host gets the full answer key (text + points) so they can judge
      // spoken answers; players only ever learn the count.
      namespace.to(room.hostSocketId).emit('question-start', { ...common, answers: q.a });
      namespace.to(room.roomCode).except(room.hostSocketId).emit('question-start', common);

      namespace.to(room.roomCode).emit('faceoff-open', { rebuzz: false });
    });

    // Player: buzz during the face-off — open to EVERY player on both teams.
    socket.on('buzz', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || socket.isHost) return;
      if (room.phase !== 'faceoff' || room.buzzLocked) return;
      if (typeof socket.teamIndex !== 'number' || !room.teams[socket.teamIndex]) return;

      room.buzzLocked = true;
      room.phase = 'faceoff-judging';
      room.faceoff.buzzer = {
        socketId: socket.id,
        playerId: socket.playerId,
        playerName: socket.playerName,
        teamIndex: socket.teamIndex
      };
      const team = room.teams[socket.teamIndex];

      namespace.to(room.roomCode).emit('faceoff-buzz', {
        playerId: socket.playerId,
        playerName: socket.playerName,
        teamIndex: socket.teamIndex,
        teamName: team.name,
        teamColor: team.color
      });
    });

    // Host: a spoken answer matched the board — phase decides what it means.
    socket.on('reveal-answer', ({ answerIndex }) => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || !room.currentQuestion) return;
      const i = parseInt(answerIndex);
      if (isNaN(i) || i < 0 || i >= room.currentQuestion.a.length) return;
      if (room.revealed.some(r => r.index === i)) return;

      switch (room.phase) {
        case 'faceoff-judging': {
          const bt = room.faceoff.buzzer.teamIndex;
          revealAnswer(room, i, bt, 'faceoff');
          if (i === 0) {
            // Top answer — face-off won outright.
            faceoffWon(room, bt);
          } else {
            room.faceoff.firstAnswer = { teamIndex: bt, answerIndex: i };
            room.faceoff.counterTeamIndex = 1 - bt;
            room.phase = 'faceoff-counter';
            const ct = room.teams[room.faceoff.counterTeamIndex];
            namespace.to(room.roomCode).emit('faceoff-counter', {
              counterTeamIndex: room.faceoff.counterTeamIndex,
              counterTeamName: ct.name,
              counterTeamColor: ct.color,
              firstAnswer: room.faceoff.firstAnswer
            });
          }
          break;
        }
        case 'faceoff-counter': {
          const ct = room.faceoff.counterTeamIndex;
          revealAnswer(room, i, ct, 'counter');
          const fa = room.faceoff.firstAnswer;
          // Counter wins if the first buzzer missed, or if this answer ranks
          // higher (lower index) than theirs.
          const counterWins = fa.answerIndex === null || i < fa.answerIndex;
          faceoffWon(room, counterWins ? ct : fa.teamIndex);
          break;
        }
        case 'team-play': {
          revealAnswer(room, i, room.controllingTeamIndex, 'team-play');
          if (room.revealed.length >= room.currentQuestion.a.length) {
            endRound(room, room.controllingTeamIndex, 'board-clear');
          }
          break;
        }
        case 'steal': {
          revealAnswer(room, i, room.stealTeamIndex, 'steal');
          endRound(room, room.stealTeamIndex, 'steal');
          break;
        }
        case 'round-over': {
          // "Let's see what else was up there" — no points.
          revealAnswer(room, i, null, 'cleanup');
          break;
        }
        // Blocked in faceoff (no attribution yet), play-or-pass, lobby, game-over.
        default: return;
      }
    });

    // Host: the spoken answer was not on the board — phase decides what it means.
    socket.on('host-wrong', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;

      switch (room.phase) {
        case 'faceoff-judging': {
          // Face-off miss — no strike; the other team gets a counter.
          const bt = room.faceoff.buzzer.teamIndex;
          room.faceoff.firstAnswer = { teamIndex: bt, answerIndex: null };
          room.faceoff.counterTeamIndex = 1 - bt;
          room.phase = 'faceoff-counter';
          const bTeam = room.teams[bt];
          const cTeam = room.teams[room.faceoff.counterTeamIndex];
          namespace.to(room.roomCode).emit('faceoff-miss', {
            teamIndex: bt, teamName: bTeam.name, isCounter: false, reopen: false
          });
          namespace.to(room.roomCode).emit('faceoff-counter', {
            counterTeamIndex: room.faceoff.counterTeamIndex,
            counterTeamName: cTeam.name,
            counterTeamColor: cTeam.color,
            firstAnswer: room.faceoff.firstAnswer
          });
          break;
        }
        case 'faceoff-counter': {
          const ct = room.faceoff.counterTeamIndex;
          const cTeam = room.teams[ct];
          const fa = room.faceoff.firstAnswer;
          if (fa.answerIndex !== null) {
            // Counter missed but the first team had an answer on the board.
            namespace.to(room.roomCode).emit('faceoff-miss', {
              teamIndex: ct, teamName: cTeam.name, isCounter: true, reopen: false
            });
            faceoffWon(room, fa.teamIndex);
          } else {
            // Both sides missed — reopen the buzzers for a fresh face-off.
            namespace.to(room.roomCode).emit('faceoff-miss', {
              teamIndex: ct, teamName: cTeam.name, isCounter: true, reopen: true
            });
            resetFaceoff(room);
            room.phase = 'faceoff';
            namespace.to(room.roomCode).emit('faceoff-open', { rebuzz: true });
          }
          break;
        }
        case 'team-play': {
          room.strikes++;
          namespace.to(room.roomCode).emit('wrong-answer', { strikes: room.strikes });
          if (room.strikes >= 3) {
            room.stealTeamIndex = 1 - room.controllingTeamIndex;
            room.phase = 'steal';
            const stealTeam = room.teams[room.stealTeamIndex];
            namespace.to(room.roomCode).emit('steal-mode', {
              stealTeamIndex: room.stealTeamIndex,
              stealTeamName: stealTeam.name,
              stealTeamColor: stealTeam.color,
              pot: room.pot
            });
          }
          break;
        }
        case 'steal': {
          // Steal failed — the playing team keeps the pot.
          endRound(room, room.controllingTeamIndex, 'steal-failed');
          break;
        }
        default: return;
      }
    });

    // Host: face-off winner's choice — play the board or pass it over.
    socket.on('choose-play-or-pass', ({ choice }) => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'play-or-pass') return;
      if (choice !== 'play' && choice !== 'pass') return;

      room.controllingTeamIndex = choice === 'play'
        ? room.faceoffWinnerTeamIndex
        : 1 - room.faceoffWinnerTeamIndex;
      room.strikes = 0;
      room.phase = 'team-play';
      const team = room.teams[room.controllingTeamIndex];
      namespace.to(room.roomCode).emit('team-play-start', {
        controllingTeamIndex: room.controllingTeamIndex,
        teamName: team.name,
        teamColor: team.color,
        choice
      });
    });

    // Host: escape hatch. Mid-face-off the round is scrapped (no winner, pot
    // discarded); once a controlling side exists they bank the pot.
    socket.on('end-round', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || !room.currentQuestion) return;
      if (room.phase === 'lobby' || room.phase === 'game-over' || room.phase === 'round-over') return;

      let winner = null;
      if (room.phase === 'team-play' || room.phase === 'steal') winner = room.controllingTeamIndex;
      else if (room.phase === 'play-or-pass') winner = room.faceoffWinnerTeamIndex;

      endRound(room, winner, 'host-ended');
    });

    socket.on('end-game', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      concludeGame(room);
    });

    // Tournament: adopt the pre-created (pre-seeded) game room as its host.
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
        tournamentLength: room.tournamentLength,
        ...snapshot(room)
      });
      emitPlayers(room);
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
        // Keep the player in the room — phones lock all the time mid-game.
        // They're marked away and re-bound on rejoin, keeping their team.
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          player.connected = false;
          emitPlayers(room);
        }
      }
    });
  });

  // ── Tournament integration (gated by room.tournament) ───────
  orchestrator.register('family-feud', ({ roster, teams, length, onComplete }) => {
    const roomCode = generateRoomCode();
    const builtTeams = (teams || []).slice(0, 2).map((t, i) => ({
      name: t.name, color: t.color || TEAM_COLORS[i], score: 0
    }));
    while (builtTeams.length < 2) builtTeams.push({ name: `Team ${builtTeams.length + 1}`, color: TEAM_COLORS[builtTeams.length], score: 0 });

    const room = {
      roomCode,
      hostSocketId: null,
      teams: builtTeams,
      players: (roster || []).map(r => ({ socketId: null, playerId: r.playerId, name: r.name, teamIndex: r.teamIndex, connected: false })),
      phase: 'lobby',
      familyFriendly: true,
      questions: pickQuestions(true), // tournament Feud defaults to family-friendly
      questionIndex: 0,
      currentQuestion: null,
      round: 0,
      pot: 0,
      strikes: 0,
      revealed: [],
      buzzLocked: false,
      faceoff: { buzzer: null, firstAnswer: null, counterTeamIndex: null },
      faceoffWinnerTeamIndex: null,
      controllingTeamIndex: null,
      stealTeamIndex: null,
      lastRoundResult: null,
      tournament: true,
      tournamentLength: Math.min(Math.max(parseInt(length) || 5, 1), 25),
      onComplete,
      concluded: false
    };
    rooms.set(roomCode, room);
    console.log('[family-feud] tournament room', roomCode, '| questions:', room.tournamentLength, '| players:', room.players.length);
    return { roomCode };
  });
};
