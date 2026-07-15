const socket = io('/tournament');

// Shared games-night device id — the same key every game uses, so a player is
// one identity across the tournament and every game it launches.
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
let myTeamColor = '#FFD60A';
let teamNames = [];
let teamColors = [];
let pendingRoomCode = '';
let joinedRoomCode = null;
let roomMode = 'teams';

function savedSession() {
  try { return JSON.parse(sessionStorage.getItem('tourney-session') || 'null'); } catch (e) { return null; }
}
function saveSession(roomCode, name) {
  try { sessionStorage.setItem('tourney-session', JSON.stringify({ roomCode, name })); } catch (e) {}
}
function clearSession() {
  joinedRoomCode = null;
  try { sessionStorage.removeItem('tourney-session'); } catch (e) {}
}
let myName = (savedSession() || {}).name || '';

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}

// ── Reconnect / resync ────────────────────────────────────────
socket.on('connect', () => {
  const sess = savedSession();
  const roomCode = joinedRoomCode || (sess && sess.roomCode);
  if (roomCode) socket.emit('rejoin-room', { roomCode, playerId });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  requestWakeLock();
  if (joinedRoomCode && socket.connected) socket.emit('request-sync');
});
socket.on('rejoin-failed', ({ message }) => {
  clearSession();
  document.getElementById('join-error').textContent = message || 'Please join again.';
  showScreen('screen-join');
});

// ── Join ──────────────────────────────────────────────────────
const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) document.getElementById('input-room').value = roomFromUrl.toUpperCase();

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
  const err = document.getElementById('join-error');
  if (!name) { err.textContent = 'Please enter your name.'; return; }
  if (room.length !== 4) { err.textContent = 'Code must be 4 characters.'; return; }
  err.textContent = '';
  myName = name;
  pendingRoomCode = room;
  socket.emit('check-room', { roomCode: room });
}

socket.on('room-check-result', ({ found, message, teams, mode }) => {
  if (!found) { document.getElementById('join-error').textContent = message; return; }
  roomMode = mode || 'teams';
  if (roomMode === 'individual') {
    socket.emit('join-room', { roomCode: pendingRoomCode, playerName: myName, teamIndex: -1, playerId });
    return;
  }
  teamNames = teams.map(t => t.name);
  teamColors = teams.map(t => t.color);
  const container = document.getElementById('team-buttons');
  container.innerHTML = '';
  teams.forEach((team, i) => {
    const btn = document.createElement('button');
    btn.className = 'team-btn';
    btn.style.background = team.color;
    btn.textContent = team.name;
    btn.addEventListener('click', () => {
      socket.emit('join-room', { roomCode: pendingRoomCode, playerName: myName, teamIndex: i, playerId });
    });
    container.appendChild(btn);
  });
  showScreen('screen-team-select');
});

socket.on('join-error', ({ message }) => {
  document.getElementById('join-error').textContent = message;
  showScreen('screen-join');
});

// ── Joined (fresh join AND reconnect — full snapshot) ──────────
socket.on('joined', (snap) => {
  myTeamIndex = snap.myTeamIndex;
  teamNames = snap.teamNames;
  teamColors = snap.teamColors;
  myTeamColor = teamColors[myTeamIndex] || '#FFD60A';
  roomMode = snap.mode || 'teams';
  joinedRoomCode = snap.roomCode;
  saveSession(snap.roomCode, myName);
  requestWakeLock();

  const badge = document.getElementById('waiting-badge');
  badge.textContent = teamNames[myTeamIndex] || myName;
  badge.style.cssText = `background:${myTeamColor};color:#fff`;
  document.getElementById('screen-waiting').style.background =
    `radial-gradient(ellipse at center, ${myTeamColor}33 0%, var(--bg) 65%)`;

  applySnapshot(snap);
});

socket.on('sync', applySnapshot);

function applySnapshot(s) {
  if (!s) return;
  if (s.teamNames) teamNames = s.teamNames;
  if (s.teamColors) { teamColors = s.teamColors; myTeamColor = teamColors[myTeamIndex] || myTeamColor; }
  if (s.plan) renderPlanList(s.plan);
  if (s.standings) renderStandings(s.standings);

  switch (s.phase) {
    case 'between':
      renderBetween(s);
      break;
    case 'complete':
      renderLeaderboard('final-leaderboard', s.standings);
      showScreen('screen-game-over');
      break;
    default:
      showScreen('screen-waiting');
  }
}

const ORDINAL = n => n + (['th','st','nd','rd'][(n % 100 - 20) % 10] || ['th','st','nd','rd'][n % 100] || 'th');

function renderBetween(s) {
  const last = (s.results && s.results.length) ? s.results[s.results.length - 1] : null;
  document.getElementById('between-title').textContent = last ? `${last.name} done!` : 'Game done!';
  if (last) {
    const mine = last.awarded.find(a => a.teamIndex === myTeamIndex);
    document.getElementById('between-sub').textContent =
      mine ? `You finished ${ORDINAL(mine.position)} — +${mine.points} points` : "Here's how it stands…";
  }
  renderLeaderboard('between-standings', s.standings);
  document.getElementById('between-next').textContent =
    s.nextGameIndex != null ? 'Waiting for the host to start the next game…' : 'Final game done — see the champion!';
  showScreen('screen-between');
}

// Launch: hop this phone into the game (it returns here with ?room= at the end).
socket.on('goto-game', ({ playerUrl, name, icon }) => {
  Sounds.go();
  document.getElementById('launching-icon').textContent = icon || '🎮';
  document.getElementById('launching-title').textContent = `Starting ${name}…`;
  showScreen('screen-launching');
  setTimeout(() => { location.href = playerUrl; }, 700);
});

function renderPlanList(plan) {
  const el = document.getElementById('plan-list');
  el.innerHTML = '';
  plan.forEach((g, i) => {
    const row = document.createElement('div');
    row.className = 'plan-row';
    row.innerHTML = `
      <span class="n">${i + 1}</span>
      <span class="gi">${g.icon}</span>
      <span class="gn">${escapeHtml(g.name)}</span>
      <span class="gl">${g.length}</span>
    `;
    el.appendChild(row);
  });
}

function renderStandings(standings) {
  renderScoreCards('waiting-standings', standings);
}

socket.on('tournament-over', ({ standings }) => {
  Sounds.gameOver();
  clearSession();
  renderLeaderboard('final-leaderboard', standings);
  showScreen('screen-game-over');
});

socket.on('host-disconnected', () => {
  clearSession();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-host-disconnected').classList.add('active');
});

// ── Helpers ───────────────────────────────────────────────────
function renderScoreCards(containerId, scores) {
  const container = document.getElementById(containerId);
  if (!container || !scores) return;
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
  if (!container || !scores) return;
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
