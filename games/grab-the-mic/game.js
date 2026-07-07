const QRCode = require('qrcode');

const TEAM_COLORS = [
  '#FF2D55', '#5856D6', '#FF9500', '#34C759',
  '#00C7BE', '#FF375F', '#BF5AF2', '#FFD60A'
];
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const WORDS = [...new Set([
  // Original 100
  'Love', 'Baby', 'Heart', 'Fire', 'Dance', 'Night', 'Dream', 'Sun', 'Rain', 'Star',
  'Home', 'World', 'Money', 'Time', 'Road', 'Sky', 'Girl', 'Boy', 'King', 'Queen',
  'Light', 'Dark', 'City', 'Angel', 'Devil', 'Gold', 'River', 'Ocean', 'Moon', 'Crazy',
  'Rock', 'Party', 'Sweet', 'Wild', 'Cold', 'Hot', 'Young', 'Broken', 'Beautiful', 'Lonely',
  'Happy', 'Cry', 'Smile', 'Kiss', 'Run', 'Jump', 'Fly', 'Fall', 'High', 'Low',
  'Thunder', 'Magic', 'Power', 'Glory', 'Freedom', 'War', 'Peace', 'Believe', 'Forever', 'Alive',
  'Shake', 'Down', 'Up', 'Blue', 'Red', 'Black', 'White', 'Green', 'Somebody', 'Nothing',
  'Tomorrow', 'Yesterday', 'Sunshine', 'Midnight', 'Trouble', 'Radio', 'Telephone', 'Mountain', 'Summer', 'Winter',
  'Diamonds', 'Burn', 'Breathe', 'Stronger', 'Closer', 'Walking', 'Waiting', 'Falling', 'Champion', 'Survivor',
  'Sunrise', 'Honey', 'Sugar', 'Ride', 'Karma', 'Story', 'Heaven', 'Hands', 'Fever', 'Saturday',

  // Extended 220
  'Africa', 'Together', 'Alone', 'Missing', 'Praying', 'Rising', 'Shining', 'Mother', 'Father', 'Brother',
  'Sister', 'Friend', 'Soldier', 'Warrior', 'Fighter', 'Winner', 'Tears', 'Laughter', 'Sorrow', 'Pain',
  'Joy', 'Faith', 'Healing', 'Tonight', 'Always', 'Never', 'Someday', 'Perfect', 'Simple', 'Special',
  'Better', 'Higher', 'Deeper', 'Church', 'Gospel', 'Praise', 'Worship', 'Blessing', 'Mercy', 'Holy',
  'Rhythm', 'Melody', 'Harmony', 'Chorus', 'Real', 'Pure', 'Valley', 'Desert', 'Forest', 'Storm',
  'Lightning', 'Highway', 'Journey', 'Distance', 'Wine', 'Shadow', 'Prince', 'Princess', 'Crown', 'Kingdom',
  'Legend', 'Hero', 'Spring', 'Morning', 'Evening', 'Dawn', 'Dusk', 'Silver', 'Pearl', 'Crystal',
  'Dust', 'Sand', 'Heartbeat', 'Soulmate', 'Destiny', 'Miracle', 'Mystery', 'Wonder', 'Celebration', 'Victory',
  'Triumph', 'Defeat', 'Struggle', 'Beginning', 'Hustle', 'Shine', 'Climb', 'Touch', 'Hold', 'Move',
  'Come', 'Stay', 'Leave', 'Know', 'Feel', 'See', 'Hear', 'Say', 'Think', 'Want',
  'Need', 'Stop', 'Change', 'Grow', 'Lead', 'Follow', 'Build', 'Save', 'Lose', 'Find',
  'Give', 'Take', 'Make', 'Sing', 'Wake', 'Sleep', 'Live', 'Die', 'Fight', 'Win',
  'Brave', 'Strong', 'Tired', 'Ready', 'Gone', 'Somewhere', 'Wonderful', 'Amazing', 'Incredible', 'Impossible',
  'Unstoppable', 'Unforgettable', 'Extraordinary', 'Memories', 'Promises', 'Chances', 'Mistakes', 'Lessons', 'Blessings', 'Wings',
  'Voice', 'Eyes', 'Soul', 'Mind', 'Body', 'Spirit', 'Grace', 'Seconds', 'Years', 'Lifetime',
  'Anger', 'Passion', 'Desire', 'Hunger', 'Thirst', 'Orange', 'Purple', 'Pink', 'Golden', 'Waves',
  'Shore', 'Tide', 'Wide', 'Fast', 'Slow', 'Loud', 'Quiet', 'Soft', 'Electric', 'Free',
  'Apart', 'Near', 'Far', 'Lost', 'Found', 'Hope', 'Wish', 'Prayer', 'Truth', 'Lies',
  'Friday', 'Sunday', 'Weekend', 'Midnight', 'Daylight', 'Spotlight', 'Streetlight', 'Firelight', 'Moonlight', 'Starlight',
  'Runway', 'Rooftop', 'Downtown', 'Uptown', 'Backstreet', 'Crossroad', 'Borderline', 'Deadline', 'Lifeline', 'Shoreline',
  'Wildfire', 'Earthquake', 'Hurricane', 'Avalanche', 'Volcano', 'Tornado', 'Waterfall', 'Rainbow', 'Thunderstorm', 'Blizzard',
  'Superstar', 'Rockstar', 'Popstar', 'Megastar', 'Allstar', 'Legend',

  // New 200 — added July 2026 after the July 4 playtest
  'Jealous', 'Sorry', 'Fearless', 'Careless', 'Hopeless', 'Thankful', 'Lucky', 'Silly', 'Angry', 'Sad',
  'Shy', 'Darling', 'Lover', 'Enemy', 'Heartbreaker', 'Heartache', 'Goodbye', 'Welcome', 'Forget', 'Trust',
  'Maybe', 'Daddy', 'Human', 'Crowd', 'Preacher', 'Doctor', 'Pirate', 'Rebel', 'Sinner', 'Ghost',
  'Alien', 'Robot', 'Superhero', 'Witch', 'Mermaid', 'Believer', 'Genius', 'London', 'America', 'Hollywood',
  'Beach', 'Paradise', 'Village', 'Avenue', 'Tunnel', 'Airport', 'School', 'College', 'Hotel', 'Carnival',
  'Playground', 'Palace', 'Horizon', 'Airplane', 'Rocket', 'Bus', 'Car', 'Wheels', 'Ship', 'Anchor',
  'Music', 'Groove', 'Boogie', 'Jazz', 'Funk', 'Bass', 'Guitar', 'Violin', 'Microphone', 'Applause',
  'Encore', 'Lullaby', 'Symphony', 'Hymn', 'Rose', 'Sunflower', 'Leaves', 'Roots', 'Seed', 'Field',
  'Snow', 'Frost', 'Fog', 'Breeze', 'Sunset', 'Eclipse', 'Universe', 'Mars', 'Comet', 'Oxygen',
  'Tiger', 'Butterfly', 'Wolf', 'Fox', 'Dragon', 'Dove', 'Coffee', 'Chocolate', 'Cherry', 'Strawberry',
  'Watermelon', 'Champagne', 'Lemonade', 'Cake', 'Butter', 'Salt', 'Spice', 'Cinnamon', 'Cream', 'Window',
  'Key', 'Chains', 'Necklace', 'Perfume', 'Dress', 'Shoes', 'Boots', 'Umbrella', 'Letter', 'Photograph',
  'Camera', 'Movie', 'Treasure', 'Compass', 'Candle', 'Torch', 'Ashes', 'Spark', 'Balloon', 'Carousel',
  'Sword', 'Shield', 'Blanket', 'Bed', 'September', 'October', 'June', 'Monday', 'Minute', 'Hour',
  'Century', 'Autumn', 'Vacation', 'Wedding', 'Christmas', 'Festival', 'Wisdom', 'Justice', 'Pride', 'Regret',
  'Redemption', 'Hallelujah', 'Glorious', 'Majesty', 'Faithful', 'Overcome', 'Jericho', 'Surrender', 'Illusion', 'Electricity',
  'Scream', 'Laugh', 'Swim', 'Float', 'Crawl', 'Spin', 'Bounce', 'Rush', 'Chase', 'Seek',
  'Steal', 'Gentle', 'Fragile', 'Empty', 'Heavy', 'Drunk', 'Honest', 'Guilty', 'Dangerous', 'Toxic',
  'Royal', 'Rich', 'Humble', 'Pretty', 'Gorgeous', 'Invincible', 'Bulletproof', 'Brown', 'Violet', 'Crimson',
  'Echo', 'Noise', 'Message', 'Number', 'Dynamite', 'Fireball', 'Halo', 'Seven', 'Hundred', 'Zero'
])];

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

function clearRoomTimer(room) {
  if (room.countdownTimer) { clearInterval(room.countdownTimer); room.countdownTimer = null; }
  if (room.singingTimer)   { clearInterval(room.singingTimer);   room.singingTimer = null;   }
  room.countdownSecondsLeft = null;
  room.singingSecondsLeft = null;
}

function publicPlayers(room) {
  return room.players.map(p => ({ name: p.name, teamIndex: p.teamIndex, connected: p.connected }));
}

// Everything a client needs to render the current moment of the game.
// Sent on join, rejoin, and request-sync so phones that slept mid-game
// land on the correct screen instead of a stale one.
function snapshot(room) {
  const buzzerTeam = room.buzzer ? room.teams[room.buzzer.teamIndex] : null;
  return {
    phase: room.phase,
    currentWord: room.currentWord,
    round: room.round,
    mode: room.mode,
    scoreGoal: room.scoreGoal,
    singingTime: room.singingTime,
    buzzCountdown: room.buzzCountdown,
    countdownSecondsLeft: room.countdownSecondsLeft,
    singingSecondsLeft: room.singingSecondsLeft,
    scores: getScores(room),
    teamNames: room.teams.map(t => t.name),
    teamColors: room.teams.map(t => t.color),
    buzzer: room.buzzer ? {
      playerId: room.buzzer.playerId,
      playerName: room.buzzer.playerName,
      teamIndex: room.buzzer.teamIndex,
      teamName: buzzerTeam?.name,
      teamColor: buzzerTeam?.color
    } : null
  };
}

module.exports = function registerGrabTheMic(namespace, localIP, port) {

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

  namespace.on('connection', (socket) => {

    socket.on('create-room', ({ teamCount, teamNames, baseUrl, singingTime, buzzCountdown, scoreGoal, mode }) => {
      try {
        console.log('[grab-the-mic] create-room from', socket.id);
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

        const validTimes = [8, 10, 12, 15];
        const singTime = validTimes.includes(parseInt(singingTime)) ? parseInt(singingTime) : 10;
        const validBuzz = [3, 5, 8, 10];
        const buzzTime = validBuzz.includes(parseInt(buzzCountdown)) ? parseInt(buzzCountdown) : 3;
        const goalInt = parseInt(scoreGoal);
        const goal = (!isNaN(goalInt) && goalInt >= 3 && goalInt <= 100) ? goalInt : null;

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
          countdownTimer: null,
          singingTimer: null,
          singingTime: singTime,
          buzzCountdown: buzzTime,
          scoreGoal: goal,
          mode: gameMode,
          countdownSecondsLeft: null,
          singingSecondsLeft: null
        };

        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;

        // Host might have opened the page on localhost — players on phones
        // can't reach that, so swap localhost/127.0.0.1 for the LAN IP.
        const isLocalhost = baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(baseUrl);
        const playerBaseUrl = (!baseUrl || isLocalhost) ? `http://${localIP}:${port}` : baseUrl;
        const joinUrl = `${playerBaseUrl}/games/grab-the-mic/player.html?room=${roomCode}`;

        console.log('[grab-the-mic] Room created:', roomCode,
          '| mode:', gameMode, '| singing:', singTime + 's', '| buzz-in:', buzzTime + 's', '| goal:', goal ?? 'none');

        socket.emit('room-created', {
          roomCode, joinUrl, localIP, port,
          teams: room.teams, singingTime: singTime, buzzCountdown: buzzTime,
          scoreGoal: goal, mode: gameMode, qrDataUrl: null
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

      // A player whose phone slept (or who re-scanned the QR) comes back with
      // the same playerId — re-bind them to their existing slot instead of
      // creating a duplicate entry.
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

    socket.on('reveal-word', () => {
      const roomCode = socket.roomCode;
      const room = rooms.get(roomCode);
      if (!room || !socket.isHost) return;
      if (room.phase !== 'lobby' && room.phase !== 'results') return;

      clearRoomTimer(room);

      if (room.wordIndex >= room.wordList.length) { room.wordList = shuffle(WORDS); room.wordIndex = 0; }

      const word = room.wordList[room.wordIndex++];
      room.currentWord = word;
      room.phase = 'countdown';
      room.buzzLocked = false;
      room.buzzer = null;
      room.round++;

      let seconds = room.buzzCountdown;
      room.countdownSecondsLeft = seconds;
      namespace.to(roomCode).emit('word-reveal', { word, round: room.round, countdownFrom: seconds });
      namespace.to(roomCode).emit('countdown', { seconds });

      room.countdownTimer = setInterval(() => {
        seconds--;
        room.countdownSecondsLeft = seconds;
        if (seconds > 0) {
          namespace.to(roomCode).emit('countdown', { seconds });
        } else {
          clearInterval(room.countdownTimer);
          room.countdownTimer = null;
          room.countdownSecondsLeft = null;
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
      room.buzzer = {
        socketId: socket.id,
        playerId: socket.playerId,
        playerName: socket.playerName,
        teamIndex: socket.teamIndex
      };
      const team = room.teams[socket.teamIndex];

      namespace.to(room.hostSocketId).emit('player-buzzed', {
        teamIndex: socket.teamIndex, playerName: socket.playerName,
        teamName: team?.name, teamColor: team?.color,
        singingTime: room.singingTime
      });
      socket.emit('you-buzzed', {
        teamIndex: socket.teamIndex, teamName: team?.name,
        teamColor: team?.color, singingTime: room.singingTime
      });
      socket.broadcast.to(roomCode).emit('someone-buzzed', {
        teamIndex: socket.teamIndex, playerName: socket.playerName,
        teamName: team?.name, teamColor: team?.color
      });

      // Start the singing countdown
      let secondsLeft = room.singingTime;
      room.singingSecondsLeft = secondsLeft;
      namespace.to(roomCode).emit('singing-timer', { secondsLeft });

      room.singingTimer = setInterval(() => {
        secondsLeft--;
        room.singingSecondsLeft = secondsLeft;
        if (secondsLeft > 0) {
          namespace.to(roomCode).emit('singing-timer', { secondsLeft });
        } else {
          clearInterval(room.singingTimer);
          room.singingTimer = null;
          room.singingSecondsLeft = null;

          if (room.phase === 'judging') {
            namespace.to(roomCode).emit('singing-timeout', {});
          }
        }
      }, 1000);
    });

    socket.on('judge', ({ awarded, verdict }) => {
      const roomCode = socket.roomCode;
      const room = rooms.get(roomCode);
      if (!room || !socket.isHost || room.phase !== 'judging') return;

      let v = verdict;
      if (v !== 'award' && v !== 'none' && v !== 'deduct') v = awarded ? 'award' : 'none';

      if (room.singingTimer) { clearInterval(room.singingTimer); room.singingTimer = null; }
      room.singingSecondsLeft = null;

      if (room.buzzer) {
        if (v === 'award') room.teams[room.buzzer.teamIndex].score++;
        else if (v === 'deduct') room.teams[room.buzzer.teamIndex].score--;
      }

      room.phase = 'results';
      const winnerTeam = room.buzzer ? room.teams[room.buzzer.teamIndex] : null;

      const goalReached = (v === 'award' && room.scoreGoal && winnerTeam && winnerTeam.score >= room.scoreGoal)
        ? {
            teamIndex: room.buzzer.teamIndex,
            teamName: winnerTeam.name,
            teamColor: winnerTeam.color,
            score: winnerTeam.score,
            goal: room.scoreGoal
          }
        : null;

      namespace.to(roomCode).emit('round-complete', {
        scores: getScores(room),
        verdict: v,
        awarded: v === 'award',
        winnerTeamIndex: room.buzzer?.teamIndex ?? null,
        winnerName: room.buzzer?.playerName ?? null,
        winnerTeamName: winnerTeam?.name ?? null,
        winnerTeamColor: winnerTeam?.color ?? null,
        goalReached,
        timedOut: false
      });
    });

    // Host chose to keep playing after the score goal was hit — raise it by 5.
    socket.on('extend-goal', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || !room.scoreGoal) return;
      room.scoreGoal += 5;
      namespace.to(room.roomCode).emit('goal-extended', { scoreGoal: room.scoreGoal });
    });

    // Back to the lobby between rounds so latecomers can scan the QR and join.
    socket.on('pause-game', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost || room.phase !== 'results') return;
      room.phase = 'lobby';
      namespace.to(room.roomCode).emit('game-paused', {});
    });

    socket.on('end-game', () => {
      const roomCode = socket.roomCode;
      const room = rooms.get(roomCode);
      if (!room || !socket.isHost) return;
      clearRoomTimer(room);
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
        clearRoomTimer(room);
        namespace.to(roomCode).emit('host-disconnected', {});
        rooms.delete(roomCode);
      } else {
        // Keep the player in the room — phones lock all the time mid-game.
        // They're marked away and re-bound on rejoin, keeping their team and score.
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          player.connected = false;
          emitPlayers(room);
        }
      }
    });
  });
};
