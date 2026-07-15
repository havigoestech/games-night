const socket = io('/grab-the-mic');

// Persistent identity — survives screen locks, refreshes, and re-scans of the
// QR code, so the server can re-bind us to our existing player slot.
const playerId = (() => {
  try {
    let id = localStorage.getItem('gtm-pid');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
         : 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('gtm-pid', id);
    }
    return id;
  } catch (e) {
    return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
})();

let myTeamIndex = -1;
let myTeamColor = '#5856D6';
let teamColors  = [];
let teamNames   = [];
let pendingRoomCode   = '';
let pendingPlayerName = '';
let roomMode = 'teams';
let buzzerFired = false;
let buzzersLiveTimeout = null;
let joinedRoomCode = null;

function savedSession() {
  try { return JSON.parse(sessionStorage.getItem('gtm-session') || 'null'); } catch (e) { return null; }
}
function saveSession(roomCode) {
  try { sessionStorage.setItem('gtm-session', JSON.stringify({ roomCode })); } catch (e) {}
}
function clearSession() {
  joinedRoomCode = null;
  try { sessionStorage.removeItem('gtm-session'); } catch (e) {}
}

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

function setWaitingLabel(text) {
  const el = document.getElementById('waiting-label');
  if (el) el.textContent = text;
}

// ── Keep the phone awake during the game ─────────────────────
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* not supported or denied — reconnect flow covers us */ }
}

// Launched from a tournament? Auto-join the pre-seeded room by device id.
const TOURNEY = (() => {
  const p = new URLSearchParams(location.search);
  const room = p.get('room'), t = p.get('t');
  return (room && t) ? { room: room.toUpperCase(), t: t.toUpperCase() } : null;
})();

// ── Reconnect / resync ────────────────────────────────────────
socket.on('connect', () => {
  const sess = savedSession();
  const roomCode = (TOURNEY && TOURNEY.room) || joinedRoomCode || (sess && sess.roomCode);
  if (roomCode) socket.emit('rejoin-room', { roomCode, playerId });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  requestWakeLock();
  if (joinedRoomCode && socket.connected) socket.emit('request-sync');
  // If the socket dropped while the screen was off, socket.io auto-reconnects
  // and the 'connect' handler above rejoins.
});

socket.on('rejoin-failed', ({ message }) => {
  clearSession();
  document.getElementById('join-error').textContent = message || 'Please join again.';
  showScreen('screen-join');
});

// ── Pre-fill room code from URL (QR code scan) ────────────────
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
  requestWakeLock();
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

socket.on('room-check-result', ({ found, message, teams, mode }) => {
  if (!found) { document.getElementById('join-error').textContent = message; return; }
  roomMode = mode || 'teams';

  // Individual mode: no team to pick — you are your own team.
  if (roomMode === 'individual') {
    selectTeam(-1);
    return;
  }

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
  socket.emit('join-room', { roomCode: pendingRoomCode, playerName: pendingPlayerName, teamIndex: idx, playerId });
}

socket.on('join-error', ({ message }) => {
  document.getElementById('join-error').textContent = message;
  showScreen('screen-join');
});

// ── Joined (fresh join AND reconnect — payload is a full snapshot) ──
socket.on('joined', (snap) => {
  myTeamIndex = snap.teamIndex;
  teamNames   = snap.teamNames;
  teamColors  = snap.teamColors;
  myTeamColor = teamColors[myTeamIndex] || '#5856D6';
  roomMode    = snap.mode || 'teams';
  joinedRoomCode = snap.roomCode;
  saveSession(snap.roomCode);
  requestWakeLock();

  const badge = document.getElementById('waiting-team-badge');
  const isGold = myTeamColor === '#FFD60A';
  badge.textContent = teamNames[myTeamIndex] || '';
  badge.style.cssText = `background:${myTeamColor};color:${isGold ? '#111' : '#fff'}`;

  document.getElementById('screen-waiting').style.background =
    `radial-gradient(ellipse at center, ${myTeamColor}33 0%, var(--bg) 65%)`;
  document.getElementById('screen-buzzed').style.background =
    `radial-gradient(ellipse at center, ${myTeamColor}44 0%, var(--bg) 70%)`;

  applySnapshot(snap);
});

socket.on('sync', applySnapshot);

// Land on the right screen for wherever the game currently is.
function applySnapshot(s) {
  if (!s) return;
  if (s.teamNames)  teamNames  = s.teamNames;
  if (s.teamColors) { teamColors = s.teamColors; myTeamColor = teamColors[myTeamIndex] || myTeamColor; }
  if (s.scores) renderScoreCards('waiting-scores', s.scores);

  if (s.phase === 'countdown') {
    document.getElementById('player-word').textContent = s.currentWord || '';
    const numEl = document.getElementById('player-countdown');
    numEl.className = 'countdown-num';
    numEl.textContent = s.countdownSecondsLeft ?? s.buzzCountdown ?? 3;
    showScreen('screen-word-countdown');
  } else if (s.phase === 'buzzers-live') {
    showBuzzer();
  } else if (s.phase === 'judging' && s.buzzer) {
    if (s.buzzer.playerId === playerId) {
      const el = document.getElementById('buzz-countdown');
      if (el && s.singingSecondsLeft != null) el.textContent = s.singingSecondsLeft;
      const subEl = document.getElementById('buzzed-sub-text');
      if (subEl) subEl.textContent = 'Sing it now!';
      showScreen('screen-buzzed');
    } else {
      document.getElementById('sb-team-name').textContent = s.buzzer.teamName || '';
      document.getElementById('sb-team-name').style.color = s.buzzer.teamColor || '#fff';
      document.getElementById('sb-player-name').textContent = s.buzzer.playerName || '';
      showScreen('screen-someone-buzzed');
    }
  } else {
    setWaitingLabel('Waiting for next word...');
    showScreen('screen-waiting');
  }
}

// ── Game flow ─────────────────────────────────────────────────
socket.on('word-reveal', ({ word, countdownFrom }) => {
  Sounds.wordReveal();
  document.getElementById('player-word').textContent = word;
  const numEl = document.getElementById('player-countdown');
  numEl.className = 'countdown-num';
  numEl.textContent = countdownFrom || 3;
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
socket.on('round-complete', ({ scores, verdict, awarded, winnerTeamName, winnerTeamColor, winnerName, goalReached }) => {
  if (awarded) Sounds.pointAwarded(); else Sounds.noPoint();
  renderScoreCards('result-scores', scores);

  const badge = document.getElementById('result-team-badge');
  const msg   = document.getElementById('result-msg');
  if (winnerTeamName) {
    const isGold = winnerTeamColor === '#FFD60A';
    badge.textContent = winnerTeamName;
    badge.style.cssText = `background:${winnerTeamColor};color:${isGold ? '#111' : '#fff'}`;
    if (verdict === 'award') {
      msg.textContent = `${winnerName} sang it — point awarded!`;
    } else if (verdict === 'deduct') {
      msg.textContent = `${winnerName} buzzed but didn't sing — point deducted!`;
    } else {
      msg.textContent = `${winnerName} didn't make it — no point.`;
    }
    if (goalReached) msg.textContent += ` 🏆 ${goalReached.teamName} reached ${goalReached.goal} points!`;
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
      setWaitingLabel('Waiting for next word...');
      showScreen('screen-waiting');
    }
  }, 4000);
});

// ── Pause ─────────────────────────────────────────────────────
socket.on('game-paused', () => {
  setWaitingLabel('Game paused — new players can join now!');
  showScreen('screen-waiting');
});

socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
  clearSession();
  renderLeaderboard('player-final-leaderboard', scores);
  showScreen('screen-game-over');
  if (TOURNEY) setTimeout(() => { location.href = `/games/tournament/player.html?room=${TOURNEY.t}`; }, 3500);
});

socket.on('host-disconnected', () => {
  clearSession();
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
    card.innerHTML = `<div class="team-name">${escapeHtml(s.name)}</div><div class="score-num">${s.score}</div>`;
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
      <div class="lb-name" style="color:${s.color}">${escapeHtml(s.name)}</div>
      <div class="lb-score">${s.score}</div>
    `;
    container.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
