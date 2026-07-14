const socket = io('/text-twist');

// Shared games-night device id (same localStorage key as the other games) —
// survives screen locks, refreshes and QR re-scans, so the server can re-bind
// us to our existing slot instead of creating a duplicate player.
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
let myTeamColor = '#00C7BE';
let teamColors = [];
let teamNames = [];
let pendingRoomCode = '';
let pendingPlayerName = '';
let joinedRoomCode = null;
let roomMode = 'teams';
let letters = '';
let lockTimer = null;

function savedSession() {
  try { return JSON.parse(sessionStorage.getItem('tt-session') || 'null'); } catch (e) { return null; }
}
function saveSession(roomCode, name) {
  try { sessionStorage.setItem('tt-session', JSON.stringify({ roomCode, name })); } catch (e) {}
}
function clearSession() {
  joinedRoomCode = null;
  try { sessionStorage.removeItem('tt-session'); } catch (e) {}
}

// My own display name, restored across a reload so "Ada got RENT" still knows
// which finds are mine after a reconnect.
let myName = (savedSession() || {}).name || '';

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Keep the phone awake mid-round ────────────────────────────
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* unsupported or denied — the reconnect flow covers us */ }
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
  if (room.length !== 4) { err.textContent = 'Room code must be 4 characters.'; return; }
  err.textContent = '';
  pendingPlayerName = name;
  myName = name;
  pendingRoomCode = room;
  socket.emit('check-room', { roomCode: room });
}

socket.on('room-check-result', ({ found, message, teams, mode }) => {
  if (!found) { document.getElementById('join-error').textContent = message; return; }
  roomMode = mode || 'teams';

  // Individual mode: no team to pick — you are your own team.
  if (roomMode === 'individual') {
    socket.emit('join-room', { roomCode: pendingRoomCode, playerName: pendingPlayerName, teamIndex: -1, playerId });
    return;
  }

  teamColors = teams.map(t => t.color);
  teamNames = teams.map(t => t.name);
  const container = document.getElementById('team-buttons');
  container.innerHTML = '';
  teams.forEach((team, i) => {
    const btn = document.createElement('button');
    btn.className = `team-btn${team.color === '#FFD60A' ? ' dark-text' : ''}`;
    btn.style.background = team.color;
    btn.textContent = team.name;
    btn.addEventListener('click', () => {
      socket.emit('join-room', { roomCode: pendingRoomCode, playerName: pendingPlayerName, teamIndex: i, playerId });
    });
    container.appendChild(btn);
  });
  showScreen('screen-team-select');
});

socket.on('join-error', ({ message }) => {
  document.getElementById('join-error').textContent = message;
  showScreen('screen-join');
});

// ── Joined (fresh join AND reconnect — payload is a full snapshot) ──
socket.on('joined', (snap) => {
  myTeamIndex = snap.teamIndex;
  teamNames = snap.teamNames;
  teamColors = snap.teamColors;
  myTeamColor = teamColors[myTeamIndex] || '#00C7BE';
  roomMode = snap.mode || 'teams';
  joinedRoomCode = snap.roomCode;
  saveSession(snap.roomCode, myName);
  requestWakeLock();

  const badge = document.getElementById('waiting-team-badge');
  const isGold = myTeamColor === '#FFD60A';
  badge.textContent = teamNames[myTeamIndex] || '';
  badge.style.cssText = `background:${myTeamColor};color:${isGold ? '#111' : '#fff'}`;
  document.getElementById('screen-waiting').style.background =
    `radial-gradient(ellipse at center, ${myTeamColor}33 0%, var(--bg) 65%)`;

  const pts = document.getElementById('tt-team-pts');
  pts.style.cssText = `background:${myTeamColor};color:${isGold ? '#111' : '#fff'}`;

  applySnapshot(snap);
});

socket.on('sync', applySnapshot);

// Land on whatever the game is actually doing right now — a phone that slept
// through half a round wakes straight back into it, timer and words intact.
function applySnapshot(s) {
  if (!s) return;
  if (s.teamNames) teamNames = s.teamNames;
  if (s.teamColors) { teamColors = s.teamColors; myTeamColor = teamColors[myTeamIndex] || myTeamColor; }
  if (s.scores) renderScoreCards('waiting-scores', s.scores);

  switch (s.phase) {
    case 'round':
      letters = s.letters || '';
      renderRack(letters);
      renderTimer(s.secondsLeft);
      renderBuckets(s.buckets || []);
      renderWords(s.myWords || []);
      setTeamPoints((s.myWords || []).reduce((sum, w) => sum + w.pts, 0));
      unlockInput();
      setFeedback('');
      showScreen('screen-round');
      break;

    case 'round-over':
      // The reveal payload only arrives with round-complete; if we reconnect
      // into the gap, park on the waiting screen with the latest scores.
      setWaitingLabel('Round over — waiting for the next jumble...');
      showScreen('screen-waiting');
      break;

    case 'game-over':
      renderLeaderboard('final-leaderboard', s.scores);
      showScreen('screen-game-over');
      break;

    default:
      setWaitingLabel('Waiting for the next jumble...');
      showScreen('screen-waiting');
  }
}

function setWaitingLabel(text) {
  const el = document.getElementById('waiting-label');
  if (el) el.textContent = text;
}

// ── Letter rack ───────────────────────────────────────────────
function renderRack(str) {
  const rack = document.getElementById('tt-rack');
  rack.innerHTML = '';
  for (const c of str) {
    const tile = document.createElement('div');
    tile.className = 'tt-letter';
    tile.textContent = c;
    rack.appendChild(tile);
  }
}

// The game's namesake — purely cosmetic, seeing the letters in a new order is
// what shakes a word loose. No server involvement.
document.getElementById('btn-twist').addEventListener('click', () => {
  const a = letters.split('');
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  letters = a.join('');
  renderRack(letters);
  document.getElementById('tt-input').focus();
});

// ── Timer ─────────────────────────────────────────────────────
function renderTimer(secs) {
  const el = document.getElementById('tt-timer');
  if (secs == null) { el.textContent = '--'; el.className = 'tt-timer'; return; }
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  el.textContent = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(s);
  el.className = 'tt-timer' + (secs <= 10 ? ' danger' : secs <= 30 ? ' warning' : '');
}

socket.on('timer', ({ secondsLeft }) => {
  if (secondsLeft <= 10 && secondsLeft > 0) Sounds.tick(secondsLeft <= 5);
  renderTimer(secondsLeft);
});

// ── Round start ───────────────────────────────────────────────
socket.on('round-start', ({ letters: L, secondsLeft, buckets, scores }) => {
  Sounds.wordReveal();
  letters = L;
  renderRack(letters);
  renderTimer(secondsLeft);
  renderBuckets(buckets);
  renderWords([]);
  setTeamPoints(0);
  setFeedback('');
  unlockInput();
  renderScoreCards('waiting-scores', scores);
  showScreen('screen-round');
  document.getElementById('tt-input').focus();
});

// ── Word submission ───────────────────────────────────────────
const input = document.getElementById('tt-input');
const inputRow = document.getElementById('tt-input-row');

input.addEventListener('input', function () {
  this.value = this.value.toUpperCase().replace(/[^A-Z]/g, '');
});
input.addEventListener('keydown', e => { if (e.key === 'Enter') submitWord(); });

function submitWord() {
  const word = input.value.trim();
  if (!word || input.disabled) return;
  socket.emit('submit-word', { word });
  input.value = '';
}

function setFeedback(text, kind) {
  const el = document.getElementById('tt-feedback');
  el.textContent = text;
  el.className = kind || '';
}

function setTeamPoints(pts) {
  document.getElementById('tt-team-pts').textContent = `${pts} pts`;
}

function unlockInput() {
  if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
  input.disabled = false;
  inputRow.classList.remove('bad');
  input.placeholder = 'TYPE A WORD';
}

// A wrong word freezes THIS player's input for a moment — teammates keep
// typing. The clock is the cost, so guessing wildly loses you the round.
function lockInput(ms) {
  input.disabled = true;
  inputRow.classList.add('bad');
  let left = Math.ceil(ms / 1000);
  input.placeholder = `LOCKED — ${left}`;
  if (lockTimer) clearInterval(lockTimer);
  lockTimer = setInterval(() => {
    left--;
    if (left > 0) {
      input.placeholder = `LOCKED — ${left}`;
    } else {
      unlockInput();
      input.focus();
    }
  }, 1000);
  setTimeout(() => { if (input.disabled) unlockInput(); }, ms + 120);
}

socket.on('word-accepted', ({ word, pts, isTopWord, by, teamWords, buckets, roundPoints }) => {
  Sounds.pointAwarded();
  renderWords(teamWords);
  renderBuckets(buckets);
  setTeamPoints(roundPoints);
  const mine = by === myName;
  setFeedback(
    isTopWord ? `⭐ TOP WORD! ${word.toUpperCase()} +${pts}`
              : `${mine ? '' : by + ' got '}${word.toUpperCase()} +${pts}`,
    'good'
  );
  input.value = '';
});

socket.on('word-duplicate', ({ word, by }) => {
  setFeedback(`${word.toUpperCase()} — ${by} already got that one`, 'warn');
  input.value = '';
});

const REJECT_MSG = {
  'too-short':  'Too short — 4 letters or more',
  'letters':    "You can't build that from these letters",
  'not-a-word': 'Not a word',
  'locked':     'Still locked...'
};

socket.on('word-rejected', ({ word, reason, lockMs }) => {
  Sounds.noPoint();
  setFeedback(`${word ? word.toUpperCase() + ' — ' : ''}${REJECT_MSG[reason] || 'Nope'}`, 'bad');
  inputRow.classList.remove('bad');
  void inputRow.offsetWidth;   // restart the shake
  inputRow.classList.add('bad');
  input.value = '';
  if (reason !== 'locked' && lockMs) lockInput(lockMs);
});

// ── Progress buckets ──────────────────────────────────────────
function renderBuckets(buckets) {
  const container = document.getElementById('tt-buckets');
  container.innerHTML = '';
  const rackLen = letters.length;
  buckets.forEach(b => {
    const isTop = b.length === rackLen;
    const row = document.createElement('div');
    row.className = 'tt-bucket' + (isTop ? ' top' : '');
    const slots = Array.from({ length: b.total }, (_, i) =>
      `<div class="tt-slot${i < b.got ? ' got' : ''}"></div>`).join('');
    row.innerHTML = `
      <div class="tt-bucket-label">${b.length} letter${b.length > 1 ? 's' : ''}</div>
      <div class="tt-bucket-slots">${slots}</div>
      <div class="tt-bucket-count">${b.got}/${b.total}</div>
    `;
    container.appendChild(row);
  });
}

// ── The team's shared word list ───────────────────────────────
function renderWords(words) {
  const container = document.getElementById('tt-words');
  container.innerHTML = '';
  const sorted = [...words].sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word));
  sorted.forEach(w => {
    const el = document.createElement('div');
    el.className = 'tt-word' + (w.isTopWord ? ' top' : '');
    el.innerHTML = `
      <span class="w">${escapeHtml(w.word)}</span>
      <span class="pts">${w.pts}</span>
      <span class="by">${escapeHtml(w.by)}</span>
    `;
    container.appendChild(el);
  });
  const label = document.getElementById('tt-words-label');
  label.textContent = words.length
    ? `Your team's words (${words.length})`
    : "Your team's words — nothing yet!";
}

// ── Board cleared ─────────────────────────────────────────────
socket.on('board-cleared', ({ teamIndex, teamName, bonus }) => {
  const mine = teamIndex === myTeamIndex;
  setFeedback(mine ? `🎉 BOARD CLEARED! +${bonus}` : `${teamName} cleared the board!`, mine ? 'good' : 'warn');
});

// ── Round over ────────────────────────────────────────────────
socket.on('round-complete', ({ reason, winnerTeamIndex, bonus, topWord, allWords, roundPoints, scores }) => {
  const myPts = roundPoints[myTeamIndex] || 0;
  const cleared = reason === 'board-clear' && winnerTeamIndex === myTeamIndex;
  if (myPts > 0) Sounds.pointAwarded(); else Sounds.timeUp();

  document.getElementById('ro-emoji').textContent =
    cleared ? '🎉' : reason === 'timer' ? '⏰' : '🛑';

  const badge = document.getElementById('ro-badge');
  const isGold = myTeamColor === '#FFD60A';
  badge.textContent = `+${myPts} points`;
  badge.style.cssText = `background:${myTeamColor};color:${isGold ? '#111' : '#fff'}`;

  const found = allWords.filter(w => w.foundBy.includes(myTeamIndex)).length;
  let sub = `You found ${found} of ${allWords.length} words.`;
  if (cleared) sub = `You cleared the whole board! +${bonus} bonus.`;
  else if (reason === 'board-clear') sub = `${teamNames[winnerTeamIndex]} cleared the board first. ` + sub;
  document.getElementById('ro-sub').textContent = sub;

  const container = document.getElementById('ro-words');
  container.innerHTML = '';
  allWords.forEach(w => {
    const mine = w.foundBy.includes(myTeamIndex);
    const el = document.createElement('div');
    el.className = 'ro-word' + (mine ? ' mine' : ' missed') + (w.isTopWord ? ' top' : '');
    el.textContent = w.word;
    el.title = `${w.pts} pts`;
    container.appendChild(el);
  });

  renderScoreCards('ro-scores', scores);
  renderScoreCards('waiting-scores', scores);
  showScreen('screen-round-over');
});

// ── Game over / host gone ─────────────────────────────────────
socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
  clearSession();
  renderLeaderboard('final-leaderboard', scores);
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
