const QRCode = require('qrcode');

const TEAM_COLORS = [
  '#FF2D55', '#5856D6', '#FF9500', '#34C759',
  '#00C7BE', '#FF375F', '#BF5AF2', '#FFD60A'
];
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WORDS = [
  'Love', 'Baby', 'Heart', 'Fire', 'Dance', 'Night', 'Dream', 'Sun', 'Rain', 'Star',
  'Home', 'World', 'Money', 'Time', 'Road', 'Sky', 'Girl', 'Boy', 'King', 'Queen',
  'Light', 'Dark', 'City', 'Angel', 'Devil', 'Gold', 'River', 'Ocean', 'Moon', 'Crazy',
  'Rock', 'Party', 'Sweet', 'Wild', 'Cold', 'Hot', 'Young', 'Broken', 'Beautiful', 'Lonely',
  'Happy', 'Cry', 'Smile', 'Kiss', 'Run', 'Jump', 'Fly', 'Fall', 'High', 'Low',
  'Thunder', 'Magic', 'Power', 'Glory', 'Freedom', 'War', 'Peace', 'Believe', 'Forever', 'Alive',
  'Shake', 'Down', 'Up', 'Blue', 'Red', 'Black', 'White', 'Green', 'Somebody', 'Nothing',
  'Tomorrow', 'Yesterday', 'Sunshine', 'Midnight', 'Trouble', 'Radio', 'Telephone', 'Mountain', 'Summer', 'Winter',
  'Diamonds', 'Burn', 'Breathe', 'Stronger', 'Closer', 'Walking', 'Waiting', 'Falling', 'Champion', 'Survivor',
  'Sunrise', 'Honey', 'Sugar', 'Ride', 'Karma', 'Story', 'Heaven', 'Hands', 'Fever', 'Saturday'
];

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

module.exports = function registerGrabTheMic(namespace, localIP, port) {

  namespace.on('connection', (socket) => {

    socket.on('create-room', ({ teamCount, teamNames, baseUrl }) => {
      try {
        console.log('[grab-the-mic] create-room from', socket.id);
        const count = Math.min(Math.max(parseInt(teamCount) || 2, 2), 8);
        const teams = Array.from({ length: count }, (_, i) => ({
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
          currentWord: null,
          wordList: shuffle(WORDS),
          wordIndex: 0,
          buzzLocked: false,
          buzzer: null,
          round: 0,
          countdownTimer: null
        };

        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;

        const playerBaseUrl = baseUrl || `http://${localIP}:${port}`;
        const joinUrl = `${playerBaseUrl}/games/grab-the-mic/player.html?room=${roomCode}`;

        console.log('[grab-the-mic] Room created:', roomCode);

        socket.emit('room-created', {
          roomCode, joinUrl, localIP, port, teams: room.teams, qrDataUrl: null
        });

        QRCode.toDataURL(joinUrl, { width: 200, margin: 1, color: { dark: '#ffffff', light: '#0a0a18' } })
          .then(qrDataUrl => socket.emit('qr-ready', { qrDataUrl }))
          .catch(e => console.error('[grab-the-mic] QR error:', e.message));

      } catch (err) {
        console.error('[grab-the-mic] create-room error:', err);
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
      socket.emit('room-check-result', { found: true, teams: room.teams.map(t => ({ name: t.name, color: t.color })) });
    });

    socket.on('join-room', ({ roomCode, playerName, teamIndex }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.phase === 'game-over') {
        socket.emit('join-error', { message: room ? 'This game has ended.' : 'Room not found.' });
        return;
      }
      const name = (playerName || '').trim() || 'Anonymous';
      const idx = parseInt(teamIndex);
      if (isNaN(idx) || idx < 0 || idx >= room.teams.length) {
        socket.emit('join-error', { message: 'Invalid team.' });
        return;
      }
      socket.join(code);
      socket.roomCode = code;
      socket.playerName = name;
      socket.teamIndex = idx;
      socket.isHost = false;
      room.players.push({ socketId: socket.id, name, teamIndex: idx });
      socket.emit('joined', {
        teamIndex: idx,
        teamNames: room.teams.map(t => t.name),
        teamColors: room.teams.map(t => t.color),
        scores: getScores(room),
        phase: room.phase,
        currentWord: room.currentWord
      });
      namespace.to(room.hostSocketId).emit('player-joined', { playerName: name, teamIndex: idx, allPlayers: room.players });
    });

    socket.on('reveal-word', () => {
      const roomCode = socket.roomCode;
      const room = rooms.get(roomCode);
      if (!room || !socket.isHost) return;
      if (room.phase !== 'lobby' && room.phase !== 'results') return;

      if (room.countdownTimer) { clearInterval(room.countdownTimer); room.countdownTimer = null; }

      if (room.wordIndex >= room.wordList.length) { room.wordList = shuffle(WORDS); room.wordIndex = 0; }

      const word = room.wordList[room.wordIndex++];
      room.currentWord = word;
      room.phase = 'countdown';
      room.buzzLocked = false;
      room.buzzer = null;
      room.round++;

      namespace.to(roomCode).emit('word-reveal', { word, round: room.round });
      let seconds = 3;
      namespace.to(roomCode).emit('countdown', { seconds });

      room.countdownTimer = setInterval(() => {
        seconds--;
        if (seconds > 0) {
          namespace.to(roomCode).emit('countdown', { seconds });
        } else {
          clearInterval(room.countdownTimer);
          room.countdownTimer = null;
          room.phase = 'buzzers-live';
          namespace.to(roomCode).emit('buzzers-live', {});
        }
      }, 1000);
    });

    socket.on('buzz', () => {
      const roomCode = socket.roomCode;
      const room = rooms.get(roomCode);
      if (!room || room.phase !== 'buzzers-live' || room.buzzLocked) return;
      room.buzzLocked = true;
      room.phase = 'judging';
      room.buzzer = { socketId: socket.id, playerName: socket.playerName, teamIndex: socket.teamIndex };
      const team = room.teams[socket.teamIndex];
      namespace.to(room.hostSocketId).emit('player-buzzed', {
        teamIndex: socket.teamIndex, playerName: socket.playerName, teamName: team?.name, teamColor: team?.color
      });
      socket.emit('you-buzzed', { teamIndex: socket.teamIndex, teamName: team?.name, teamColor: team?.color });
      socket.broadcast.to(roomCode).emit('someone-buzzed', {
        teamIndex: socket.teamIndex, playerName: socket.playerName, teamName: team?.name, teamColor: team?.color
      });
    });

    socket.on('judge', ({ awarded }) => {
      const roomCode = socket.roomCode;
      const room = rooms.get(roomCode);
      if (!room || !socket.isHost || room.phase !== 'judging') return;
      if (awarded && room.buzzer) room.teams[room.buzzer.teamIndex].score++;
      room.phase = 'results';
      const scores = getScores(room);
      const winnerTeam = room.buzzer ? room.teams[room.buzzer.teamIndex] : null;
      namespace.to(roomCode).emit('round-complete', {
        scores, awarded,
        winnerTeamIndex: room.buzzer?.teamIndex ?? null,
        winnerName: room.buzzer?.playerName ?? null,
        winnerTeamName: winnerTeam?.name ?? null,
        winnerTeamColor: winnerTeam?.color ?? null
      });
    });

    socket.on('end-game', () => {
      const roomCode = socket.roomCode;
      const room = rooms.get(roomCode);
      if (!room || !socket.isHost) return;
      if (room.countdownTimer) { clearInterval(room.countdownTimer); room.countdownTimer = null; }
      room.phase = 'game-over';
      const scores = getScores(room).sort((a, b) => b.score - a.score);
      namespace.to(roomCode).emit('game-over', { scores });
    });

    socket.on('disconnect', () => {
      const roomCode = socket.roomCode;
      if (!roomCode) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      if (socket.isHost) {
        if (room.countdownTimer) clearInterval(room.countdownTimer);
        namespace.to(roomCode).emit('host-disconnected', {});
        rooms.delete(roomCode);
      } else {
        room.players = room.players.filter(p => p.socketId !== socket.id);
        if (room.hostSocketId) {
          namespace.to(room.hostSocketId).emit('player-left', {
            playerName: socket.playerName, teamIndex: socket.teamIndex, allPlayers: room.players
          });
        }
      }
    });
  });
};
