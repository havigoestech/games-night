const socket = io('/kill-and-injury');

// Shared games-night device id (same localStorage key as the other games) —
// survives screen locks, refreshes and QR re-scans, so the server re-binds us
// to our existing slot instead of creating a duplicate player.
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
let myTeamColor = '#FF2D55';
let teamNames = [];
let teamColors = [];
let pendingRoomCode = '';
let joinedRoomCode = null;
let codeLength = 4;
let myCode = null;
let myNotes = {};
let iAmLocked = false;

function savedSession() {
  try { return JSON.parse(sessionStorage.getItem('ki-session') || 'null'); } catch (e) { return null; }
}
function saveSession(roomCode, name) {
  try { sessionStorage.setItem('ki-session', JSON.stringify({ roomCode, name })); } catch (e) {}
}
function clearSession() {
  joinedRoomCode = null;
  try { sessionStorage.removeItem('ki-session'); } catch (e) {}
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

// ── Keep the phone awake ──────────────────────────────────────
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
  myName = name;
  pendingRoomCode = room;
  socket.emit('check-room', { roomCode: room });
}

socket.on('room-check-result', ({ found, message, teams }) => {
  if (!found) { document.getElementById('join-error').textContent = message; return; }
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

// ── Joined (fresh join AND reconnect — payload is a full snapshot) ──
socket.on('joined', (snap) => {
  myTeamIndex = snap.teamIndex;
  teamNames = snap.teamNames;
  teamColors = snap.teamColors;
  myTeamColor = teamColors[myTeamIndex] || '#FF2D55';
  joinedRoomCode = snap.roomCode;
  saveSession(snap.roomCode, myName);
  requestWakeLock();

  ['waiting-badge', 'code-badge'].forEach(id => {
    const b = document.getElementById(id);
    b.textContent = teamNames[myTeamIndex] || '';
    b.style.cssText = `background:${myTeamColor};color:#fff`;
  });
  document.getElementById('screen-waiting').style.background =
    `radial-gradient(ellipse at center, ${myTeamColor}33 0%, var(--bg) 65%)`;
  document.getElementById('m-mycode').style.cssText = `background:${myTeamColor};color:#fff`;

  applySnapshot(snap);
});

socket.on('sync', applySnapshot);

// Land on whatever the game is actually doing — a phone that slept through half
// a match wakes straight back into it, clock and boards intact.
function applySnapshot(s) {
  if (!s) return;
  if (s.teamNames) teamNames = s.teamNames;
  if (s.teamColors) { teamColors = s.teamColors; myTeamColor = teamColors[myTeamIndex] || myTeamColor; }
  if (s.codeLength) codeLength = s.codeLength;
  if (s.scores) renderScoreCards('waiting-scores', s.scores);
  if (s.myNotes) { myNotes = s.myNotes; renderNotepad(); }
  if (s.myCode) { myCode = s.myCode; showYourCode(s.myCode, s.myCodeBy); }

  switch (s.phase) {
    case 'set-codes':
      setCodeHint();
      renderCodeStatus(s.codeReady);
      showScreen('screen-code');
      break;

    case 'guessing':
    case 'round-reveal': {
      document.getElementById('m-round').textContent = `Round ${s.round}`;
      document.getElementById('m-mycode').textContent = s.myCode || '----';
      renderTimer(s.secondsLeft);
      // Clear any stale result banner from before the reconnect; the boards
      // themselves are redrawn fresh from the snapshot just below.
      document.getElementById('guess-msg').textContent = '';
      renderBoards(s.boards);
      iAmLocked = !!s.myGuess;
      setGuessLocked(iAmLocked, s.myGuess);
      setOppLock(s.locked[1 - myTeamIndex]);
      showScreen('screen-match');
      break;
    }

    case 'match-over':
      if (s.lastMatchResult) renderMatchOver(s.lastMatchResult, s.scores);
      else showScreen('screen-waiting');
      break;

    case 'game-over':
      renderLeaderboard('final-leaderboard', s.scores);
      showScreen('screen-game-over');
      break;

    default:
      setWaiting('Waiting for the host to start...');
      showScreen('screen-waiting');
  }
}

function setWaiting(text) {
  document.getElementById('waiting-label').textContent = text;
}

// ── Code phase ────────────────────────────────────────────────
function setCodeHint() {
  document.getElementById('code-hint').textContent =
    `${codeLength} digits, all different. The other side has to crack it.`;
  const inp = document.getElementById('input-code');
  inp.maxLength = codeLength;
  inp.placeholder = '1234'.slice(0, codeLength);
}

socket.on('code-phase', ({ codeLength: len, scores }) => {
  Sounds.wordReveal();
  codeLength = len;
  myCode = null;
  iAmLocked = false;
  document.getElementById('your-code-box').style.display = 'none';
  document.getElementById('input-code').value = '';
  document.getElementById('code-msg').textContent = '';
  // Wipe the previous match's guess boards so they don't linger behind the
  // code-setting screen into the new match's first round.
  renderBoards([[], []]);
  document.getElementById('guess-msg').textContent = '';
  renderScoreCards('waiting-scores', scores);
  setCodeHint();
  renderCodeStatus([false, false]);
  showScreen('screen-code');
});

const codeInput = document.getElementById('input-code');
codeInput.addEventListener('input', function () {
  this.value = this.value.replace(/\D/g, '').slice(0, codeLength);
});
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitCode(); });
document.getElementById('btn-set-code').addEventListener('click', submitCode);

function submitCode() {
  const code = codeInput.value.trim();
  if (!code) return;
  socket.emit('set-code', { code });
}

socket.on('code-rejected', ({ message }) => {
  Sounds.noPoint();
  const m = document.getElementById('code-msg');
  m.textContent = message;
  m.className = 'msg bad';
  codeInput.classList.remove('shake');
  void codeInput.offsetWidth;
  codeInput.classList.add('shake');
});

// Only ever sent to our own side — the opponent and the host never receive this.
socket.on('your-code', ({ code, by }) => {
  Sounds.pointAwarded();
  myCode = code;
  showYourCode(code, by);
  const m = document.getElementById('code-msg');
  m.textContent = by === myName ? 'Locked in!' : `${by} set the code`;
  m.className = 'msg good';
  codeInput.value = '';
});

function showYourCode(code, by) {
  document.getElementById('your-code-box').style.display = 'block';
  document.getElementById('your-code').textContent = code;
  document.getElementById('your-code-by').textContent = by ? `set by ${by} — anyone can change it` : '';
  document.getElementById('m-mycode').textContent = code;
}

socket.on('code-status', ({ ready }) => renderCodeStatus(ready));

function renderCodeStatus(ready) {
  if (!ready) return;
  const el = document.getElementById('code-status');
  const label = i => `${ready[i] ? '✓' : '…'} ${escapeHtml(teamNames[i] || '')}`;
  el.innerHTML = `${label(0)} &nbsp;·&nbsp; ${label(1)}`;
  el.style.color = ready[0] && ready[1] ? '#34C759' : 'rgba(255,255,255,0.4)';
}

// ── Match ─────────────────────────────────────────────────────
socket.on('match-start', ({ codeLength: len }) => {
  codeLength = len;
  const g = document.getElementById('input-guess');
  g.maxLength = len;
  g.placeholder = 'GUESS';
  // Fresh match — clear the previous match's boards and result banner. The
  // server only resends boards on the first round-result, so without this the
  // old kills/injuries rows show through Round 1.
  renderBoards([[], []]);
  document.getElementById('guess-msg').textContent = '';
});

socket.on('round-start', ({ round, secondsLeft }) => {
  Sounds.go();
  document.getElementById('m-round').textContent = `Round ${round}`;
  renderTimer(secondsLeft);
  iAmLocked = false;
  setGuessLocked(false, null);
  setOppLock(false);
  document.getElementById('guess-msg').textContent = '';
  document.getElementById('input-guess').value = '';
  showScreen('screen-match');
  document.getElementById('input-guess').focus();
});

function renderTimer(secs) {
  const el = document.getElementById('m-timer');
  if (secs == null) { el.textContent = '--'; el.className = 'm-timer'; return; }
  const m = Math.floor(secs / 60), s = secs % 60;
  el.textContent = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(s);
  el.className = 'm-timer' + (secs <= 10 ? ' danger' : secs <= 20 ? ' warning' : '');
}

socket.on('timer', ({ secondsLeft }) => {
  if (secondsLeft <= 10 && secondsLeft > 0 && !iAmLocked) Sounds.tick(secondsLeft <= 5);
  renderTimer(secondsLeft);
});

const guessInput = document.getElementById('input-guess');
guessInput.addEventListener('input', function () {
  this.value = this.value.replace(/\D/g, '').slice(0, codeLength);
});
guessInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitGuess(); });
document.getElementById('btn-guess').addEventListener('click', submitGuess);

function submitGuess() {
  const g = guessInput.value.trim();
  if (!g || iAmLocked) return;
  socket.emit('submit-guess', { guess: g });
}

socket.on('guess-rejected', ({ message }) => {
  Sounds.noPoint();
  const m = document.getElementById('guess-msg');
  m.textContent = message;
  m.className = 'msg bad';
  guessInput.classList.remove('shake');
  void guessInput.offsetWidth;
  guessInput.classList.add('shake');
});

// Our own side locked in (possibly by a teammate).
socket.on('your-guess-locked', ({ guess, by }) => {
  Sounds.tick(false);
  iAmLocked = true;
  setGuessLocked(true, guess);
  const m = document.getElementById('guess-msg');
  m.textContent = by === myName ? `Locked in ${guess}` : `${by} locked in ${guess}`;
  m.className = 'msg good';
});

function setGuessLocked(locked, guess) {
  const btn = document.getElementById('btn-guess');
  guessInput.disabled = locked;
  btn.disabled = locked;
  btn.textContent = locked ? `Locked: ${guess || ''}` : 'Lock In Guess';
  if (locked) guessInput.value = '';
}

// The opponent committing while you're still deliberating — the pressure.
socket.on('guess-locked', ({ teamIndex, by }) => {
  if (teamIndex === myTeamIndex) return;
  setOppLock(true, by);
});

function setOppLock(locked, by) {
  const el = document.getElementById('opp-lock');
  const opp = teamNames[1 - myTeamIndex] || 'They';
  if (locked) {
    el.textContent = `🔒 ${opp} ARE LOCKED IN${by ? ' (' + by + ')' : ''}`;
    el.classList.add('locked');
  } else {
    el.textContent = `${opp} are still thinking...`;
    el.classList.remove('locked');
  }
}

// ── Round result ──────────────────────────────────────────────
socket.on('round-result', ({ results, boards, closeCall, cracked }) => {
  renderBoards(boards);
  const mine = results.find(r => r.teamIndex === myTeamIndex);
  const m = document.getElementById('guess-msg');

  if (cracked[myTeamIndex]) {
    Sounds.gameOver();
    m.textContent = '🎉 CRACKED IT!';
    m.className = 'msg good';
  } else if (closeCall[myTeamIndex]) {
    Sounds.timeUp();
    m.textContent = `🔥 ONE AWAY! ${mine.kills} kills, ${mine.injuries} injuries`;
    m.className = 'msg warn';
  } else if (mine.forfeit) {
    Sounds.noPoint();
    m.textContent = '⏰ Too slow — no guess this round!';
    m.className = 'msg bad';
  } else if (mine.kills === 0 && mine.injuries === 0) {
    Sounds.noPoint();
    m.textContent = `${mine.guess} — nothing. Rule those digits out.`;
    m.className = 'msg bad';
  } else {
    Sounds.pointAwarded();
    m.textContent = `${mine.guess} → ${mine.kills} kills, ${mine.injuries} injuries`;
    m.className = 'msg good';
  }
});

function renderBoards(boards) {
  if (!boards) return;
  document.getElementById('head-mine').textContent = 'Your guesses';
  document.getElementById('head-mine').style.color = myTeamColor;
  document.getElementById('head-theirs').textContent = `${teamNames[1 - myTeamIndex] || 'Them'}'s guesses`;
  document.getElementById('head-theirs').style.color = teamColors[1 - myTeamIndex] || '#fff';
  drawBoard('board-mine', boards[myTeamIndex]);
  drawBoard('board-theirs', boards[1 - myTeamIndex]);
}

function drawBoard(id, rows) {
  const c = document.getElementById(id);
  c.innerHTML = '';
  (rows || []).forEach(r => {
    const row = document.createElement('div');
    if (r.forfeit) {
      row.className = 'brow forfeit';
      row.textContent = '— no guess —';
    } else {
      const crack = r.kills === codeLength;
      const close = r.kills === codeLength - 1;
      row.className = 'brow' + (crack ? ' crack' : close ? ' close' : '');
      row.innerHTML = `<span class="g">${escapeHtml(r.guess)}</span><span class="k">${r.kills}K</span><span class="i">${r.injuries}I</span>`;
    }
    c.appendChild(row);
  });
}

// ── Shared notepad ────────────────────────────────────────────
const CYCLE = { unknown: 'out', out: 'in', in: 'unknown' };

function renderNotepad() {
  const pad = document.getElementById('notepad');
  pad.innerHTML = '';
  for (let d = 0; d <= 9; d++) {
    const state = myNotes[d] || 'unknown';
    const cell = document.createElement('div');
    cell.className = `note ${state}`;
    cell.textContent = d;
    cell.addEventListener('click', () => {
      const next = CYCLE[myNotes[d] || 'unknown'];
      socket.emit('update-note', { digit: String(d), state: next });
    });
    pad.appendChild(cell);
  }
}

// Only ever reaches our own side — the opponent never sees our working.
socket.on('notes-update', ({ notes }) => {
  Sounds.tick(false);
  myNotes = notes;
  renderNotepad();
});

// ── Match over — the reveal ───────────────────────────────────
socket.on('match-over', (r) => {
  renderMatchOver(r, r.scores);
});

function renderMatchOver(r, scores) {
  const won = r.winnerTeamIndex === myTeamIndex;
  const draw = r.reason === 'draw';

  if (won || draw) Sounds.gameOver(); else Sounds.noPoint();

  document.getElementById('over-emoji').textContent =
    draw ? '🤝' : won ? '🎉' : r.reason === 'stalemate' ? '😐' : '💀';

  const badge = document.getElementById('over-badge');
  if (draw) {
    badge.textContent = 'DRAW — you both cracked it!';
    badge.style.cssText = 'background:rgba(255,214,10,0.25);color:#FFD60A';
  } else if (r.winnerTeamIndex != null) {
    badge.textContent = won ? 'YOU CRACKED IT!' : `${teamNames[r.winnerTeamIndex]} cracked it`;
    badge.style.cssText = `background:${teamColors[r.winnerTeamIndex]};color:#fff`;
  } else {
    badge.textContent = r.reason === 'stalemate' ? 'Nobody cracked it' : 'Match ended';
    badge.style.cssText = 'background:rgba(255,255,255,0.1);color:#fff';
  }

  const pts = (r.points || [0, 0])[myTeamIndex] || 0;
  document.getElementById('over-sub').textContent =
    pts > 0 ? `Round ${r.rounds} — +${pts} points` : `Round ${r.rounds} — no points this match`;

  const row = document.getElementById('reveal-row');
  row.innerHTML = '';
  (r.secrets || []).forEach((code, i) => {
    const card = document.createElement('div');
    card.className = 'reveal-card';
    card.style.cssText = `background:${teamColors[i]}22;border:1px solid ${teamColors[i]}`;
    card.innerHTML = `
      <div class="lbl" style="color:${teamColors[i]}">${escapeHtml(teamNames[i])}</div>
      <div class="code" style="color:${teamColors[i]}">${escapeHtml(code || '----')}</div>
    `;
    row.appendChild(card);
  });

  if (scores) {
    renderScoreCards('over-scores', scores);
    renderScoreCards('waiting-scores', scores);
  }
  showScreen('screen-over');
}

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
    const card = document.createElement('div');
    card.className = 'score-card';
    card.style.cssText = `background:${s.color};color:#fff`;
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

renderNotepad();
