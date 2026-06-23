const socket = io('/grab-the-mic');

let myTeamIndex = -1;
let myTeamColor = '#5856D6';
let teamColors  = [];
let teamNames   = [];
let pendingRoomCode   = '';
let pendingPlayerName = '';
let buzzerFired = false;
let buzzersLiveTimeout = null;

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

// Pre-fill room code from URL (QR code scan)
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

  if (phase === 'buzzers-live') showBuzzer();
  else showScreen('screen-waiting');
});

// ── Game flow ─────────────────────────────────────────────────
socket.on('word-reveal', ({ word }) => {
  Sounds.wordReveal();
  document.getElementById('player-word').textContent = word;
  const numEl = document.getElementById('player-countdown');
  numEl.className = 'countdown-num';
  numEl.textContent = '3';
  showScreen('screen-word-countdown');
});

socket.on('countdown', ({ seconds }) => {
  Sounds.tick(false);
  const numEl = document.getElementById('player-countdown');
  numEl.className = 'countdown-num';
  void numEl.offsetWidth;
  numEl.textContent = seconds;
});

socket.on('buzzers-live', () => {
  Sounds.go();
  const numEl = document.getElementById('player-countdown');
  numEl.className = 'countdown-num go';
  numEl.textContent = 'GO!';
  if (buzzersLiveTimeout) clearTimeout(buzzersLiveTimeout);
  buzzersLiveTimeout = setTimeout(() => { buzzersLiveTimeout = null; showBuzzer(); }, 400);
});

// ── Buzzer (instant on tap) ───────────────────────────────────
document.getElementById('buzzer-fullscreen').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (buzzerFired) return;
  buzzerFired = true;
  Sounds.buzz();
  // Stay on buzzer screen — go pending. Only navigate once server confirms who won.
  const buzzer = document.getElementById('buzzer-fullscreen');
  buzzer.classList.add('buzzer-pending');
  const hintEl = document.getElementById('buzz-hint-text');
  if (hintEl) hintEl.textContent = 'Buzzing...';
  socket.emit('buzz');
  // Safety reset: if server never responds within 2 s, unlock the buzzer
  setTimeout(() => {
    if (buzzerFired && buzzer.classList.contains('buzzer-pending')) {
      buzzer.classList.remove('buzzer-pending');
      if (hintEl) hintEl.textContent = 'Tap anywhere';
      buzzerFired = false;
    }
  }, 2000);
}, { passive: false });

socket.on('you-buzzed', ({ singingTime }) => {
  // Server confirmed — we won the race
  const buzzer = document.getElementById('buzzer-fullscreen');
  buzzer.classList.remove('buzzer-pending');
  const subEl = document.getElementById('buzzed-sub-text');
  if (subEl) subEl.textContent = 'Sing it now!';
  const el = document.getElementById('buzz-countdown');
  if (el) { el.textContent = singingTime || 10; el.className = 'buzz-countdown'; }
  showScreen('screen-buzzed');
});

socket.on('singing-timer', ({ secondsLeft }) => {
  if (secondsLeft <= 5) Sounds.tick(secondsLeft <= 3);
  const el = document.getElementById('buzz-countdown');
  if (!el) return;
  el.textContent = secondsLeft;
  el.className = 'buzz-countdown' + (secondsLeft <= 3 ? ' danger' : secondsLeft <= 5 ? ' warning' : '');
});

socket.on('singing-timeout', () => {
  Sounds.timeUp();
  const el = document.getElementById('buzz-countdown');
  if (el) { el.textContent = '0'; el.className = 'buzz-countdown danger'; }
  const subEl = document.getElementById('buzzed-sub-text');
  if (subEl) subEl.textContent = "Time's up! Waiting for host...";
});

socket.on('someone-buzzed', ({ teamName, teamColor, playerName }) => {
  // If a buzz beat us during our own 'GO!' transition, cancel the pending
  // showBuzzer so we jump straight to the someone-buzzed screen instead of
  // landing on a buzzer that the server will now reject.
  if (buzzersLiveTimeout) { clearTimeout(buzzersLiveTimeout); buzzersLiveTimeout = null; }
  const buzzer = document.getElementById('buzzer-fullscreen');
  const currentScreen = document.querySelector('.screen.active');
  const inCountdown = currentScreen && currentScreen.id === 'screen-word-countdown';
  // Render if we're on the buzzer (tapped or not) or still in the countdown→buzzer transition
  if (!buzzer.classList.contains('active') && !inCountdown) return;
  buzzer.classList.remove('buzzer-pending');
  document.getElementById('sb-team-name').textContent = teamName;
  document.getElementById('sb-team-name').style.color  = teamColor;
  document.getElementById('sb-player-name').textContent = playerName;
  showScreen('screen-someone-buzzed');
});

// ── Results ───────────────────────────────────────────────────
socket.on('round-complete', ({ scores, awarded, winnerTeamName, winnerTeamColor, winnerName }) => {
  if (awarded) Sounds.pointAwarded(); else Sounds.noPoint();
  renderScoreCards('result-scores', scores);

  const badge = document.getElementById('result-team-badge');
  const msg   = document.getElementById('result-msg');
  if (winnerTeamName) {
    const isGold = winnerTeamColor === '#FFD60A';
    badge.textContent = winnerTeamName;
    badge.style.cssText = `background:${winnerTeamColor};color:${isGold ? '#111' : '#fff'}`;
    msg.textContent = awarded
      ? `${winnerName} sang it — point awarded!`
      : `${winnerName} didn't make it — no point.`;
  } else {
    badge.textContent = 'No buzz';
    badge.style.cssText = 'background:rgba(255,255,255,0.1);color:#fff';
    msg.textContent = 'Nobody buzzed.';
  }
  showScreen('screen-result');

  // Auto-return to waiting after 4 seconds
  setTimeout(() => {
    if (document.getElementById('screen-result').classList.contains('active')) {
      renderScoreCards('waiting-scores', scores);
      showScreen('screen-waiting');
    }
  }, 4000);
});

socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
  renderLeaderboard('player-final-leaderboard', scores);
  showScreen('screen-game-over');
});

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
