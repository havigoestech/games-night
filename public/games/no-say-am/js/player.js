const socket = io('/no-say-am');
if (window.GNPause) GNPause.init(socket);

// Persistent identity — survives screen locks / refreshes / QR re-scans.
const playerId = (() => {
  try {
    let id = localStorage.getItem('nsa-pid');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('nsa-pid', id);
    }
    return id;
  } catch (e) { return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
})();

let myTeamIndex = -1;
let teamNames = [], teamColors = [];
let roomMode = 'teams';
let pendingRoomCode = '', pendingPlayerName = '';
let joinedRoomCode = null;
let currentSerial = -1;     // serial of the card currently shown to the describer
let amDescriber = false;

function savedSession() { try { return JSON.parse(sessionStorage.getItem('nsa-session') || 'null'); } catch (e) { return null; } }
function saveSession(roomCode) { try { sessionStorage.setItem('nsa-session', JSON.stringify({ roomCode })); } catch (e) {} }
function clearSession() { joinedRoomCode = null; try { sessionStorage.removeItem('nsa-session'); } catch (e) {} }

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}
function showTimer(on) { document.getElementById('player-timer').style.display = on ? 'block' : 'none'; }
function setTimerText(secs) {
  const el = document.getElementById('player-timer');
  const m = Math.floor(secs / 60), s = secs % 60;
  el.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
  el.classList.toggle('low', secs <= 10);
}

// ── Keep the phone awake ──
let wakeLock = null;
async function requestWakeLock() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }

// Launched from a tournament? Auto-join the pre-seeded room by device id.
const TOURNEY = (() => {
  const p = new URLSearchParams(location.search);
  const room = p.get('room'), t = p.get('t');
  return (room && t) ? { room: room.toUpperCase(), t: t.toUpperCase() } : null;
})();

// ── Reconnect / resync ──
socket.on('connect', () => {
  const sess = savedSession();
  const roomCode = (TOURNEY && TOURNEY.room) || joinedRoomCode || (sess && sess.roomCode);
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
  showScreen('screen-join'); showTimer(false);
});

// ── Pre-fill room code from URL (QR scan) ──
const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) document.getElementById('input-room').value = roomFromUrl.toUpperCase();

document.getElementById('input-room').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
document.getElementById('btn-join').addEventListener('click', doJoin);
['input-name', 'input-room'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); }));

function doJoin() {
  Sounds.unlockAudio(); requestWakeLock();
  const name = document.getElementById('input-name').value.trim();
  const room = document.getElementById('input-room').value.trim().toUpperCase();
  const err = document.getElementById('join-error');
  if (!name) { err.textContent = 'Please enter your name.'; return; }
  if (room.length !== 4) { err.textContent = 'Room code must be 4 characters.'; return; }
  err.textContent = '';
  pendingPlayerName = name; pendingRoomCode = room;
  socket.emit('check-room', { roomCode: room });
}

socket.on('room-check-result', ({ found, message, teams, mode }) => {
  if (!found) { document.getElementById('join-error').textContent = message; return; }
  roomMode = mode || 'teams';
  if (roomMode === 'individual') { selectTeam(-1); return; }
  teamColors = teams.map(t => t.color); teamNames = teams.map(t => t.name);
  const container = document.getElementById('team-buttons');
  container.innerHTML = '';
  teams.forEach((team, i) => {
    const btn = document.createElement('button');
    btn.className = 'btn w-full';
    btn.style.cssText = `background:${team.color};color:${team.color === '#FFD60A' ? '#111' : '#fff'};font-size:1.1rem`;
    btn.textContent = team.name;
    btn.addEventListener('click', () => selectTeam(i));
    container.appendChild(btn);
  });
  showScreen('screen-team-select');
});
function selectTeam(idx) { socket.emit('join-room', { roomCode: pendingRoomCode, playerName: pendingPlayerName, teamIndex: idx, playerId }); }
socket.on('join-error', ({ message }) => { document.getElementById('join-error').textContent = message; showScreen('screen-join'); });

// ── Joined / sync (full snapshot) ──
socket.on('joined', (snap) => {
  myTeamIndex = snap.teamIndex;
  teamNames = snap.teamNames; teamColors = snap.teamColors; roomMode = snap.mode || 'teams';
  joinedRoomCode = snap.roomCode; saveSession(snap.roomCode); requestWakeLock();
  applySnapshot(snap);
});
socket.on('sync', applySnapshot);

function teamName(i) { return teamNames[i] || `Team ${i + 1}`; }

function applySnapshot(s) {
  if (!s) return;
  if (s.teamNames) teamNames = s.teamNames;
  if (s.teamColors) teamColors = s.teamColors;
  if (s.scores) { renderScoreCards('waiting-scores', s.scores); }
  amDescriber = !!s.isDescriber || s.describerId === playerId;

  if (s.phase === 'in-turn') {
    showTimer(true); if (s.secondsLeft != null) setTimerText(s.secondsLeft);
    if (amDescriber) {
      if (s.card) renderCard(s.card);
      updateGot(s.gotCount || 0);
      showScreen('screen-describe');
    } else {
      showGuessScreen(s.describerTeamIndex, s.describerName, s.gotCount || 0);
    }
    return;
  }
  showTimer(false);
  if (s.phase === 'turn-intro') {
    if (amDescriber) {
      document.getElementById('ready-round').textContent = (s.round || 0) + 1;
      document.getElementById('ready-team').textContent = teamName(s.describerTeamIndex);
      showScreen('screen-get-ready');
    } else {
      showWaiting(`${teamName(s.describerTeamIndex)} is up`, myTeamIndex === s.describerTeamIndex ? `${escapeHtml(s.describerName || 'Your teammate')} is describing — get ready to guess!` : `${escapeHtml(s.describerName || '')} is describing. Watch the screen.`);
    }
  } else if (s.phase === 'turn-over') {
    showWaiting('Turn over', '');
  } else if (s.phase === 'round-over') {
    showWaiting(`Round ${s.round || 1} done`, 'Next round coming up…');
  } else if (s.phase === 'game-over') {
    renderLeaderboard('player-final-leaderboard', s.scores || []);
    showScreen('screen-game-over');
  } else {
    showWaiting('Waiting to start…', 'The host will kick things off.');
  }
}

function showWaiting(title, sub) {
  document.getElementById('waiting-title').textContent = title;
  document.getElementById('waiting-sub').textContent = sub || '';
  showScreen('screen-waiting');
}
function showGuessScreen(describerTeamIndex, describerName, got) {
  const mine = myTeamIndex === describerTeamIndex;
  document.getElementById('guess-emoji').textContent = mine ? '🗣️' : '👀';
  document.getElementById('guess-title').textContent = mine ? 'Shout your guesses!' : `${teamName(describerTeamIndex)} is describing`;
  document.getElementById('guess-sub').textContent = mine ? `${escapeHtml(describerName || 'Your teammate')} is describing — call out what you think it is!` : 'Watch the big screen.';
  document.getElementById('guess-got').textContent = got;
  showScreen('screen-guess');
}
function updateGot(n) { document.getElementById('describe-got').textContent = n; document.getElementById('guess-got').textContent = n; }

function renderCard(card) {
  currentSerial = card.serial;
  document.getElementById('card-word').textContent = card.word;
  const box = document.getElementById('card-taboo'); box.innerHTML = '';
  (card.taboo || []).forEach(t => { const d = document.createElement('div'); d.className = 'nsa-taboo'; d.textContent = t; box.appendChild(d); });
  document.getElementById('describe-team').textContent = teamName(myTeamIndex);
  setButtonsEnabled(true);
  showScreen('screen-describe');
}
function setButtonsEnabled(on) {
  document.getElementById('btn-got').disabled = !on;
  document.getElementById('btn-skip').disabled = !on;
  document.getElementById('btn-got').style.opacity = on ? '1' : '0.5';
  document.getElementById('btn-skip').style.opacity = on ? '1' : '0.5';
}

// ── Describer controls ──
document.getElementById('btn-start-turn').addEventListener('click', () => { Sounds.unlockAudio(); socket.emit('start-turn'); });
document.getElementById('btn-got').addEventListener('click', () => mark('got'));
document.getElementById('btn-skip').addEventListener('click', () => mark('skip'));
function mark(result) {
  if (!amDescriber) return;
  setButtonsEnabled(false);             // lock until the next card arrives
  if (result === 'got') Sounds.pointAwarded(); else Sounds.noPoint();
  socket.emit('mark', { result, serial: currentSerial });
}

// ── Flow events ──
socket.on('turn-intro', (d) => {
  amDescriber = d.describerId === playerId;
  showTimer(false);
  if (amDescriber) {
    document.getElementById('ready-round').textContent = (d.round || 0) + 1;
    document.getElementById('ready-team').textContent = d.teamName || '';
    showScreen('screen-get-ready');
  } else {
    showWaiting(`${d.teamName || 'Next team'} is up`, myTeamIndex === d.teamIndex ? `${escapeHtml(d.describerName || 'Your teammate')} is describing — get ready to guess!` : `${escapeHtml(d.describerName || '')} is describing. Watch the screen.`);
  }
});
socket.on('turn-started', (d) => {
  amDescriber = d.describerId === playerId;
  showTimer(true); setTimerText(d.secondsLeft || 0);
  if (!amDescriber) showGuessScreen(d.teamIndex != null ? d.teamIndex : myTeamIndex, d.describerName, 0);
  // the describer waits for the 'card' event
});
socket.on('card', (c) => { Sounds.wordReveal(); renderCard(c); });
socket.on('timer', ({ secondsLeft }) => {
  setTimerText(secondsLeft);
  if (secondsLeft <= 5 && secondsLeft > 0) Sounds.tick(secondsLeft <= 3);
});
socket.on('turn-progress', ({ got, scores }) => { updateGot(got); if (scores) renderScoreCards('waiting-scores', scores); });
socket.on('turn-over', (d) => {
  Sounds.timeUp();
  showTimer(false);
  if (d.scores) renderScoreCards('waiting-scores', d.scores);
  showWaiting('Turn over', `${escapeHtml(d.teamName || '')} got ${d.got} point${d.got === 1 ? '' : 's'} this turn.`);
});
socket.on('round-over', (d) => { showTimer(false); if (d.scores) renderScoreCards('waiting-scores', d.scores); showWaiting(`Round ${(d.round || 0) + 1} done`, 'Next round coming up…'); });
socket.on('game-over', ({ scores }) => {
  Sounds.gameOver(); clearSession(); showTimer(false);
  renderLeaderboard('player-final-leaderboard', scores);
  showScreen('screen-game-over');
  if (TOURNEY) setTimeout(() => { location.href = `/games/tournament/player.html?room=${TOURNEY.t}`; }, 3500);
});
socket.on('host-disconnected', () => { clearSession(); showTimer(false); showScreen('screen-host-disconnected'); });

// ── Helpers ──
function renderScoreCards(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  scores.forEach(s => { const gold = s.color === '#FFD60A'; const card = document.createElement('div'); card.className = 'score-card'; card.style.cssText = `background:${s.color};color:${gold ? '#111' : '#fff'}`; card.innerHTML = `<div class="team-name">${escapeHtml(s.name)}</div><div class="score-num">${s.score}</div>`; c.appendChild(card); });
}
function renderLeaderboard(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  [...scores].sort((a, b) => b.score - a.score).forEach((s, i) => { const w = i === 0; const row = document.createElement('div'); row.className = `lb-row${w ? ' winner' : ''}`; if (w) row.style.cssText = `background:${s.color}22;border-color:${s.color}`; row.innerHTML = `<div class="lb-rank">${w ? '👑' : i + 1}</div><div class="lb-name" style="color:${s.color}">${escapeHtml(s.name)}</div><div class="lb-score">${s.score}</div>`; c.appendChild(row); });
}
