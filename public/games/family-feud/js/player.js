const socket = io('/family-feud');

const TEAM_COLORS = ['#FF2D55','#5856D6','#FF9500','#34C759','#00C7BE','#FF375F','#BF5AF2','#FFD60A'];

let myTeamIndex = -1;
let myTeamColor = '#5856D6';
let teamColors  = [];
let teamNames   = [];
let pendingRoomCode   = '';
let pendingPlayerName = '';
let buzzerFired = false;
let currentActiveTeam = -1;
let currentStealTeam  = -1;
let currentAnswerCount = 0;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('buzzer-fullscreen').classList.remove('active');
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function showBuzzer() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const buzzer = document.getElementById('buzzer-fullscreen');
  buzzer.style.background = myTeamColor;
  buzzer.style.color = myTeamColor === '#FFD60A' ? '#111' : '#fff';
  buzzer.classList.remove('buzzer-pending');
  buzzer.classList.add('active');
  const hintEl = document.getElementById('buzz-hint-text');
  if (hintEl) hintEl.textContent = 'Tap anywhere';
  buzzerFired = false;
}

// Pre-fill room code from URL
const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) document.getElementById('input-room').value = roomFromUrl.toUpperCase();

// ── Join ──────────────────────────────────────────────────────
document.getElementById('input-room').addEventListener('input', function () {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});

document.getElementById('btn-join').addEventListener('click', doJoin);
['input-name', 'input-room'].forEach(id =>
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); })
);

function doJoin() {
  Sounds.unlockAudio();
  const name = document.getElementById('input-name').value.trim();
  const room = document.getElementById('input-room').value.trim().toUpperCase();
  const err  = document.getElementById('join-error');
  if (!name)             { err.textContent = 'Please enter your name.';          return; }
  if (room.length !== 4) { err.textContent = 'Room code must be 4 characters.';  return; }
  err.textContent = '';
  pendingPlayerName = name;
  pendingRoomCode   = room;
  socket.emit('check-room', { roomCode: room });
}

socket.on('room-check-result', ({ found, message, teams }) => {
  if (!found) { document.getElementById('join-error').textContent = message; return; }
  teamColors = teams.map(t => t.color);
  teamNames  = teams.map(t => t.name);
  const container = document.getElementById('team-buttons');
  container.innerHTML = '';
  teams.forEach((team, i) => {
    const btn = document.createElement('button');
    btn.className = `team-btn${team.color === '#FFD60A' ? ' dark-text' : ''}`;
    btn.style.background = team.color;
    btn.textContent = team.name;
    btn.addEventListener('click', () => selectTeam(i));
    container.appendChild(btn);
  });
  showScreen('screen-team-select');
});

function selectTeam(idx) {
  socket.emit('join-room', { roomCode: pendingRoomCode, playerName: pendingPlayerName, teamIndex: idx });
}

socket.on('join-error', ({ message }) => {
  document.getElementById('join-error').textContent = message;
  showScreen('screen-join');
});

// ── Joined ────────────────────────────────────────────────────
socket.on('joined', ({ teamIndex, teamNames: names, teamColors: colors, scores, phase }) => {
  myTeamIndex = teamIndex;
  teamColors  = colors;
  teamNames   = names;
  myTeamColor = colors[teamIndex];

  const badge = document.getElementById('waiting-team-badge');
  const isGold = myTeamColor === '#FFD60A';
  badge.textContent = names[teamIndex];
  badge.style.cssText = `background:${myTeamColor};color:${isGold ? '#111' : '#fff'}`;

  document.getElementById('screen-waiting').style.background =
    `radial-gradient(ellipse at center, ${myTeamColor}33 0%, var(--bg) 65%)`;
  document.getElementById('screen-buzzed').style.background =
    `radial-gradient(ellipse at center, ${myTeamColor}44 0%, var(--bg) 70%)`;

  renderScoreCards('waiting-scores', scores);
  showScreen('screen-waiting');
});

// ── Question start ────────────────────────────────────────────
socket.on('question-start', ({ question, answerCount, activeTeamIndex, activeTeamName, activeTeamColor, scores }) => {
  Sounds.wordReveal();

  currentActiveTeam  = activeTeamIndex;
  currentStealTeam   = -1;
  currentAnswerCount = answerCount;
  buzzerFired = false;

  document.getElementById('player-question').textContent = question;

  const isMyTeamActive = activeTeamIndex === myTeamIndex;
  const activeColor = teamColors[activeTeamIndex] || '#fff';
  document.getElementById('player-active-team').innerHTML =
    `<span style="color:${activeColor};font-weight:800">${activeTeamName}</span> is playing`;

  buildMiniBoard(answerCount);
  document.getElementById('player-strikes').textContent = '';
  document.getElementById('player-steal-indicator').classList.remove('visible');

  renderScoreCards('player-scores', scores);

  // Hide buzz btn by default; buzzers-live event will show it
  document.getElementById('player-buzz-btn').classList.remove('visible');

  showScreen('screen-game');

  if (isMyTeamActive) {
    showBuzzer();
  }
});

function buildMiniBoard(count) {
  const board = document.getElementById('player-board');
  board.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const tile = document.createElement('div');
    tile.className = 'player-ff-tile';
    tile.id = `p-tile-${i}`;
    tile.innerHTML = `
      <div class="player-ff-tile-inner">
        <div class="player-ff-tile-front">?</div>
        <div class="player-ff-tile-back">
          <span class="p-answer-text" id="p-tile-text-${i}"></span>
          <span class="p-answer-pts"  id="p-tile-pts-${i}"></span>
        </div>
      </div>
    `;
    board.appendChild(tile);
  }
}

// ── Buzzers live ──────────────────────────────────────────────
socket.on('buzzers-live', ({ activeTeamIndex }) => {
  Sounds.go();
  currentActiveTeam = activeTeamIndex;
  currentStealTeam  = -1;
  buzzerFired = false;

  const activeColor = teamColors[activeTeamIndex] || '#fff';
  const activeTeamName = teamNames[activeTeamIndex] || `Team ${activeTeamIndex + 1}`;
  document.getElementById('player-active-team').innerHTML =
    `<span style="color:${activeColor};font-weight:800">${activeTeamName}</span> is playing`;

  if (activeTeamIndex === myTeamIndex) {
    showBuzzer();
  } else {
    // Make sure we're on the game screen
    if (!document.getElementById('screen-game').classList.contains('active')) {
      showScreen('screen-game');
    }
    document.getElementById('player-buzz-btn').classList.remove('visible');
  }
});

// ── Buzzer tap ────────────────────────────────────────────────
document.getElementById('buzzer-fullscreen').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (buzzerFired) return;
  buzzerFired = true;
  Sounds.buzz();
  const buzzer = document.getElementById('buzzer-fullscreen');
  buzzer.classList.add('buzzer-pending');
  const hintEl = document.getElementById('buzz-hint-text');
  if (hintEl) hintEl.textContent = 'Buzzing...';
  socket.emit('buzz');
  // Safety reset after 2s if no server response
  setTimeout(() => {
    if (buzzerFired && buzzer.classList.contains('buzzer-pending')) {
      buzzer.classList.remove('buzzer-pending');
      if (hintEl) hintEl.textContent = 'Tap anywhere';
      buzzerFired = false;
    }
  }, 2000);
}, { passive: false });

// Inline buzz button (fallback)
document.getElementById('player-buzz-btn').addEventListener('click', () => {
  if (buzzerFired) return;
  buzzerFired = true;
  Sounds.buzz();
  socket.emit('buzz');
});

// ── You buzzed ────────────────────────────────────────────────
socket.on('you-buzzed-ff', ({ teamName, teamColor, isSteal }) => {
  Sounds.buzz();
  const buzzer = document.getElementById('buzzer-fullscreen');
  buzzer.classList.remove('buzzer-pending');
  showScreen('screen-buzzed');
});

// ── Someone else buzzed ────────────────────────────────────────
socket.on('someone-buzzed', ({ playerName, teamName, teamColor, isSteal }) => {
  const buzzer = document.getElementById('buzzer-fullscreen');
  if (buzzer.classList.contains('active')) {
    buzzer.classList.remove('buzzer-pending');
    buzzerFired = false;
  }
  document.getElementById('sb-team-name').textContent = teamName;
  document.getElementById('sb-team-name').style.color  = teamColor;
  document.getElementById('sb-player-name').textContent = playerName;
  showScreen('screen-someone-buzzed');
});

// ── Answer revealed ────────────────────────────────────────────
socket.on('answer-revealed', ({ answerIndex, text, pts }) => {
  Sounds.tick(false);

  const tile = document.getElementById(`p-tile-${answerIndex}`);
  if (tile) {
    const textEl = document.getElementById(`p-tile-text-${answerIndex}`);
    const ptsEl  = document.getElementById(`p-tile-pts-${answerIndex}`);
    if (textEl) textEl.textContent = text;
    if (ptsEl)  ptsEl.textContent  = pts;
    tile.classList.add('revealed');
  }

  // Return to game screen if we're on buzzed/someone-buzzed
  const onBuzzedScreen = document.getElementById('screen-buzzed').classList.contains('active') ||
                         document.getElementById('screen-someone-buzzed').classList.contains('active');
  if (onBuzzedScreen) {
    showScreen('screen-game');
  }
});

// ── Wrong answer ───────────────────────────────────────────────
socket.on('wrong-answer', ({ strikes, stealMode }) => {
  Sounds.noPoint();
  document.getElementById('player-strikes').textContent = '❌'.repeat(strikes);

  const onBuzzedScreen = document.getElementById('screen-buzzed').classList.contains('active') ||
                         document.getElementById('screen-someone-buzzed').classList.contains('active');
  if (onBuzzedScreen) {
    showScreen('screen-game');
  }
});

// ── Steal mode ─────────────────────────────────────────────────
socket.on('steal-mode', ({ stealTeamIndex, stealTeamName, stealTeamColor, roundPot }) => {
  Sounds.timeUp();
  currentStealTeam = stealTeamIndex;
  buzzerFired = false;

  const indicator = document.getElementById('player-steal-indicator');
  document.getElementById('player-steal-label').textContent = `STEAL: ${stealTeamName}`;
  document.getElementById('player-steal-sub').textContent =
    `${stealTeamName} gets one chance to steal ${roundPot} points!`;
  indicator.classList.add('visible');

  document.getElementById('player-active-team').innerHTML =
    `<span style="color:#FF9500;font-weight:800">STEAL</span> by ${stealTeamName}`;

  if (stealTeamIndex === myTeamIndex) {
    showBuzzer();
  } else {
    if (!document.getElementById('screen-game').classList.contains('active')) {
      showScreen('screen-game');
    }
  }
});

// ── Round complete ─────────────────────────────────────────────
socket.on('round-complete', ({ scores, roundPot, winnerTeamName, winnerTeamColor, allAnswers, stealSuccess, stealFailed }) => {
  if (stealSuccess) {
    Sounds.pointAwarded();
  } else if (stealFailed) {
    Sounds.noPoint();
  } else {
    Sounds.pointAwarded();
  }

  // Reveal all tiles on mini board
  if (allAnswers) {
    allAnswers.forEach((ans, i) => {
      const tile = document.getElementById(`p-tile-${i}`);
      if (tile && !tile.classList.contains('revealed')) {
        const textEl = document.getElementById(`p-tile-text-${i}`);
        const ptsEl  = document.getElementById(`p-tile-pts-${i}`);
        if (textEl) textEl.textContent = ans.t;
        if (ptsEl)  ptsEl.textContent  = ans.p;
        tile.classList.add('revealed');
      }
    });
  }

  // Build round over screen
  const badge = document.getElementById('player-round-winner-badge');
  const isGold = winnerTeamColor === '#FFD60A';
  badge.textContent = winnerTeamName;
  badge.style.cssText = `background:${winnerTeamColor};color:${isGold ? '#111' : '#fff'}`;

  const ptsEl = document.getElementById('player-round-pts-text');
  if (stealSuccess) {
    ptsEl.textContent = `Steal! ${winnerTeamName} wins ${roundPot} points`;
  } else if (stealFailed) {
    ptsEl.textContent = `Steal failed. ${winnerTeamName} keeps ${roundPot} points`;
  } else {
    ptsEl.textContent = `${winnerTeamName} wins ${roundPot} points`;
  }

  const revBoard = document.getElementById('player-reveal-board');
  revBoard.innerHTML = '';
  if (allAnswers) {
    allAnswers.forEach(ans => {
      const tile = document.createElement('div');
      tile.className = 'player-ro-tile';
      tile.innerHTML = `
        <span class="player-ro-tile-text">${ans.t}</span>
        <span class="player-ro-tile-pts">${ans.p}</span>
      `;
      revBoard.appendChild(tile);
    });
  }

  renderScoreCards('player-ro-scores', scores);
  renderScoreCards('waiting-scores', scores);

  showScreen('screen-round-over');

  // Auto-return to waiting after 6s
  setTimeout(() => {
    if (document.getElementById('screen-round-over').classList.contains('active')) {
      showScreen('screen-waiting');
    }
  }, 6000);
});

// ── Game over ──────────────────────────────────────────────────
socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
  renderLeaderboard('player-final-leaderboard', scores);
  showScreen('screen-game-over');
});

// ── Host disconnected ──────────────────────────────────────────
socket.on('host-disconnected', () => {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('buzzer-fullscreen').classList.remove('active');
  document.getElementById('screen-host-disconnected').classList.add('active');
});

// ── Helpers ───────────────────────────────────────────────────
function renderScoreCards(containerId, scores) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  scores.forEach(s => {
    const isGold = s.color === '#FFD60A';
    const card = document.createElement('div');
    card.className = 'score-card';
    card.style.cssText = `background:${s.color};color:${isGold ? '#111' : '#fff'}`;
    card.innerHTML = `<div class="team-name">${s.name}</div><div class="score-num">${s.score}</div>`;
    container.appendChild(card);
  });
}

function renderLeaderboard(containerId, scores) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  [...scores].sort((a, b) => b.score - a.score).forEach((s, i) => {
    const isWinner = i === 0;
    const row = document.createElement('div');
    row.className = `lb-row${isWinner ? ' winner' : ''}`;
    if (isWinner) row.style.cssText = `background:${s.color}22;border-color:${s.color}`;
    row.innerHTML = `
      <div class="lb-rank">${isWinner ? '👑' : i + 1}</div>
      <div class="lb-name" style="color:${s.color}">${s.name}</div>
      <div class="lb-score">${s.score}</div>
    `;
    container.appendChild(row);
  });
}
