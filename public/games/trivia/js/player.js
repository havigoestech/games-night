const socket = io('/trivia');
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// Shared games-night device id (same key as the other games) so a screen-lock
// or QR re-scan re-binds us to our slot.
const playerId = (() => {
  try {
    let id = localStorage.getItem('gtm-pid');
    if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('gtm-pid', id); }
    return id;
  } catch (e) { return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
})();

let myTeamIndex = -1, myTeamColor = '#5856D6', teamNames = [], teamColors = [];
let joinedRoomCode = null, pendingName = '', pendingRoom = '';
let answered = false, myChoice = null, currentOptions = [];

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); const el = document.getElementById(id); if (el) el.classList.add('active'); }
function savedSession() { try { return JSON.parse(sessionStorage.getItem('trivia-session') || 'null'); } catch (e) { return null; } }
function saveSession(rc) { try { sessionStorage.setItem('trivia-session', JSON.stringify({ roomCode: rc })); } catch (e) {} }
function clearSession() { joinedRoomCode = null; try { sessionStorage.removeItem('trivia-session'); } catch (e) {} }

// ── Reconnect ──
socket.on('connect', () => { const sess = savedSession(); const rc = joinedRoomCode || (sess && sess.roomCode); if (rc) socket.emit('rejoin-room', { roomCode: rc, playerId }); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && joinedRoomCode && socket.connected) socket.emit('request-sync'); });
socket.on('rejoin-failed', ({ message }) => { clearSession(); document.getElementById('join-error').textContent = message || 'Please join again.'; showScreen('screen-join'); });

// ── Join ──
const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) document.getElementById('input-room').value = roomFromUrl.toUpperCase();
document.getElementById('input-room').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
document.getElementById('btn-join').addEventListener('click', doJoin);
['input-name', 'input-room'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); }));
function doJoin() {
  Sounds.unlockAudio();
  const name = document.getElementById('input-name').value.trim();
  const room = document.getElementById('input-room').value.trim().toUpperCase();
  const err = document.getElementById('join-error');
  if (!name) { err.textContent = 'Please enter your name.'; return; }
  if (room.length !== 4) { err.textContent = 'Room code must be 4 characters.'; return; }
  err.textContent = ''; pendingName = name; pendingRoom = room;
  socket.emit('check-room', { roomCode: room });
}
socket.on('room-check-result', ({ found, message, teamMode, teams }) => {
  if (!found) { document.getElementById('join-error').textContent = message; return; }
  if (teamMode === 'individual') { socket.emit('join-room', { roomCode: pendingRoom, playerName: pendingName, teamIndex: -1, playerId }); return; }
  teamColors = teams.map(t => t.color); teamNames = teams.map(t => t.name);
  const box = document.getElementById('team-buttons'); box.innerHTML = '';
  teams.forEach((team, i) => {
    const btn = document.createElement('button');
    btn.className = `team-btn${team.color === '#FFD60A' ? ' dark-text' : ''}`;
    btn.style.background = team.color; btn.textContent = team.name;
    btn.addEventListener('click', () => socket.emit('join-room', { roomCode: pendingRoom, playerName: pendingName, teamIndex: i, playerId }));
    box.appendChild(btn);
  });
  showScreen('screen-team-select');
});
socket.on('join-error', ({ message }) => { document.getElementById('join-error').textContent = message; showScreen('screen-join'); });

socket.on('joined', (snap) => {
  myTeamIndex = snap.teamIndex; teamNames = snap.teamNames; teamColors = snap.teamColors;
  myTeamColor = teamColors[myTeamIndex] || '#5856D6';
  joinedRoomCode = snap.roomCode; saveSession(snap.roomCode);
  const badge = document.getElementById('waiting-team-badge');
  const gold = myTeamColor === '#FFD60A';
  badge.textContent = teamNames[myTeamIndex] || 'You';
  badge.style.cssText = `background:${myTeamColor};color:${gold ? '#111' : '#fff'}`;
  applySnapshot(snap);
});
socket.on('sync', applySnapshot);

// ── Question / answering ──
function renderOptions(options, { locked, chosen, correctIndex } = {}) {
  currentOptions = options;
  const box = document.getElementById('p-options'); box.innerHTML = '';
  options.forEach((opt, i) => {
    const div = document.createElement('div');
    div.className = 'p-option';
    if (correctIndex != null) { if (i === correctIndex) div.classList.add('correct'); else if (i === chosen) div.classList.add('wrong'); div.classList.add('locked'); }
    else if (locked) { div.classList.add('locked'); if (i === chosen) div.classList.add('chosen'); }
    div.innerHTML = `<div class="p-option-letter">${LETTERS[i]}</div><div class="p-option-text">${escapeHtml(opt)}</div>`;
    if (correctIndex == null && !locked) div.addEventListener('click', () => choose(i));
    box.appendChild(div);
  });
}
function choose(i) {
  if (answered) return;
  answered = true; myChoice = i;
  Sounds.buzz();
  socket.emit('submit', { choice: i });
  renderOptions(currentOptions, { locked: true, chosen: i });
  const lb = document.getElementById('p-locked'); lb.style.display = 'block'; lb.textContent = `Locked in: ${LETTERS[i]} — nice!`;
}
socket.on('you-submitted', () => {});

socket.on('question', (d) => {
  answered = false; myChoice = null;
  document.getElementById('p-qmeta').textContent = `${d.category || ''} · Q${d.qNumber} of ${d.qCount}`;
  document.getElementById('p-question').textContent = d.question;
  document.getElementById('p-locked').style.display = 'none';
  renderOptions(d.options, {});
  showScreen('screen-question');
});

socket.on('question-reveal', (d) => {
  const mine = (d.results || []).find(r => r.playerId === playerId);
  const res = document.getElementById('p-result');
  if (mine && mine.correct) { res.textContent = `Correct! +${mine.points}`; res.className = 'p-result win'; Sounds.pointAwarded(); }
  else if (mine) { res.textContent = 'Not quite 😬'; res.className = 'p-result lose'; Sounds.noPoint(); }
  else { res.textContent = "Time's up ⏱"; res.className = 'p-result lose'; Sounds.noPoint(); }
  document.getElementById('p-correct').textContent = d.correct;
  renderScoreCards('p-scores', d.scores);
  showScreen('screen-reveal');
});

socket.on('round-over', (d) => { Sounds.go(); renderLeaderboard('p-ro-leaderboard', d.scores); showScreen('screen-round-over'); });
socket.on('game-over', ({ scores }) => { Sounds.gameOver(); clearSession(); renderLeaderboard('p-final-leaderboard', scores); showScreen('screen-game-over'); });
socket.on('host-disconnected', () => { clearSession(); showScreen('screen-host-gone'); });

// ── Snapshot router (reconnect) ──
function applySnapshot(s) {
  if (!s) return;
  if (s.teamNames) teamNames = s.teamNames;
  if (s.teamColors) { teamColors = s.teamColors; myTeamColor = teamColors[myTeamIndex] || myTeamColor; }
  switch (s.phase) {
    case 'question': {
      answered = !!(s.you && s.you.answered);
      myChoice = s.you ? s.you.choice : null;
      if (s.question) {
        document.getElementById('p-qmeta').textContent = `${s.question.category || ''} · Q${s.qNumber} of ${s.qCount}`;
        document.getElementById('p-question').textContent = s.question.question;
        renderOptions(s.question.options, answered ? { locked: true, chosen: myChoice } : {});
        const lb = document.getElementById('p-locked'); lb.style.display = answered ? 'block' : 'none'; if (answered) lb.textContent = `Locked in: ${LETTERS[myChoice]}`;
      }
      showScreen('screen-question'); break;
    }
    case 'question-reveal': {
      if (s.reveal) {
        const mine = (s.reveal.results || []).find(r => r.playerId === playerId);
        const res = document.getElementById('p-result');
        if (mine && mine.correct) { res.textContent = `Correct! +${mine.points}`; res.className = 'p-result win'; }
        else if (mine) { res.textContent = 'Not quite 😬'; res.className = 'p-result lose'; }
        else { res.textContent = "Time's up ⏱"; res.className = 'p-result lose'; }
        document.getElementById('p-correct').textContent = s.reveal.correct;
        renderScoreCards('p-scores', s.reveal.scores || s.scores);
      }
      showScreen('screen-reveal'); break;
    }
    case 'round-over': renderLeaderboard('p-ro-leaderboard', s.scores); showScreen('screen-round-over'); break;
    case 'game-over': renderLeaderboard('p-final-leaderboard', s.scores); showScreen('screen-game-over'); break;
    default: showScreen('screen-waiting');
  }
}

// ── Shared renderers ──
function renderScoreCards(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  scores.forEach(s => { const gold = s.color === '#FFD60A'; const card = document.createElement('div'); card.className = 'score-card'; card.style.cssText = `background:${s.color};color:${gold ? '#111' : '#fff'}`; card.innerHTML = `<div class="team-name">${escapeHtml(s.name)}</div><div class="score-num">${s.score}</div>`; c.appendChild(card); });
}
function renderLeaderboard(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  [...scores].sort((a, b) => b.score - a.score).forEach((s, i) => { const w = i === 0; const row = document.createElement('div'); row.className = `lb-row${w ? ' winner' : ''}`; if (w) row.style.cssText = `background:${s.color}22;border-color:${s.color}`; row.innerHTML = `<div class="lb-rank">${w ? '👑' : i + 1}</div><div class="lb-name" style="color:${s.color}">${escapeHtml(s.name)}</div><div class="lb-score">${s.score}</div>`; c.appendChild(row); });
}
