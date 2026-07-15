const socket = io('/family-feud');

// Shared games-night device id (same localStorage key as grab-the-mic) —
// survives screen locks, refreshes, and QR re-scans so the server can
// re-bind us to our existing player slot.
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
let teamColors  = [];
let teamNames   = [];
let pendingRoomCode   = '';
let pendingPlayerName = '';
let buzzerFired = false;
let joinedRoomCode = null;
let answerCount = 0;
let currentPot = 0;

function savedSession() {
  try { return JSON.parse(sessionStorage.getItem('ff-session') || 'null'); } catch (e) { return null; }
}
function saveSession(roomCode) {
  try { sessionStorage.setItem('ff-session', JSON.stringify({ roomCode })); } catch (e) {}
}
function clearSession() {
  joinedRoomCode = null;
  try { sessionStorage.removeItem('ff-session'); } catch (e) {}
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

// ── Keep the phone awake during the game ─────────────────────
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* not supported or denied — the reconnect flow covers us */ }
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

// ── Pre-fill room code from URL (QR scan) ─────────────────────
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
    btn.addEventListener('click', () => {
      socket.emit('join-room', {
        roomCode: pendingRoomCode, playerName: pendingPlayerName, teamIndex: i, playerId
      });
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
  teamNames   = snap.teamNames;
  teamColors  = snap.teamColors;
  myTeamColor = teamColors[myTeamIndex] || '#FF2D55';
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

// ── Board ─────────────────────────────────────────────────────
function buildMiniBoard(count) {
  const board = document.getElementById('player-board');
  board.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const tile = document.createElement('div');
    tile.className = 'player-ff-tile';
    tile.id = `p-tile-${i}`;
    tile.innerHTML = `
      <div class="player-ff-tile-inner">
        <div class="player-ff-tile-front">${i + 1}</div>
        <div class="player-ff-tile-back">
          <span class="p-answer-text" id="p-tile-text-${i}"></span>
          <span class="p-answer-pts"  id="p-tile-pts-${i}"></span>
        </div>
      </div>
    `;
    board.appendChild(tile);
  }
}

function flipTile(index, text, pts) {
  const tile = document.getElementById(`p-tile-${index}`);
  if (!tile) return;
  const textEl = document.getElementById(`p-tile-text-${index}`);
  const ptsEl  = document.getElementById(`p-tile-pts-${index}`);
  if (textEl) textEl.textContent = text;
  if (ptsEl)  ptsEl.textContent  = pts;
  tile.classList.add('revealed');
}

function renderStrikes(n) {
  document.getElementById('player-strikes').textContent = '❌'.repeat(n || 0);
}

function setPot(pot) {
  currentPot = pot || 0;
  document.getElementById('player-pot').textContent = currentPot > 0 ? `Round pot: ${currentPot} pts` : '';
}

function setStatus(html, color) {
  const el = document.getElementById('player-status');
  el.innerHTML = html;
  if (color) {
    el.style.borderColor = color;
    el.style.background  = `${color}22`;
  } else {
    el.style.borderColor = 'rgba(255,255,255,0.12)';
    el.style.background  = 'rgba(255,255,255,0.06)';
  }
}

const sub = t => `<br><span style="font-weight:600;font-size:0.85rem;color:rgba(255,255,255,0.7)">${t}</span>`;

// Phase → status banner. Driven by both live events and snapshots, so a
// woken phone shows exactly what an in-the-room phone shows.
function renderPhaseStatus(s) {
  const mine = i => i === myTeamIndex;
  switch (s.phase) {
    case 'faceoff-counter': {
      const ct = s.faceoff.counterTeamIndex;
      if (mine(ct)) {
        setStatus(`YOUR TEAM'S COUNTER${sub('Decide together — ONE player answers out loud!')}`, teamColors[ct]);
      } else {
        setStatus(`${escapeHtml(teamNames[ct])} gets one counter answer${sub('If they beat your answer, they take the round')}`);
      }
      break;
    }
    case 'play-or-pass': {
      const w = s.faceoffWinnerTeamIndex;
      if (mine(w)) {
        setStatus(`YOU WON THE FACE-OFF! 🎉${sub('Tell the host — play the board, or pass it?')}`, teamColors[w]);
      } else {
        setStatus(`${escapeHtml(teamNames[w])} won the face-off${sub('Waiting for their play-or-pass call…')}`);
      }
      break;
    }
    case 'team-play': {
      const c = s.controllingTeamIndex;
      if (mine(c)) {
        setStatus(`YOUR TEAM IS PLAYING 🎤${sub('The host will ask you one at a time')}`, teamColors[c]);
      } else {
        setStatus(`GET READY TO STEAL 👀${sub('Three strikes and the pot is yours to take')}`);
      }
      break;
    }
    case 'steal': {
      const st = s.stealTeamIndex;
      if (mine(st)) {
        setStatus(`STEAL CHANCE! 🚨${sub('Confer as a team — ONE answer wins the whole pot')}`, teamColors[st]);
      } else {
        setStatus(`${escapeHtml(teamNames[st])} is trying to steal your ${currentPot} points!`, '#FF9500');
      }
      break;
    }
  }
}

// Land on the right screen for wherever the game currently is.
function applySnapshot(s) {
  if (!s) return;
  if (s.teamNames)  teamNames  = s.teamNames;
  if (s.teamColors) { teamColors = s.teamColors; myTeamColor = teamColors[myTeamIndex] || myTeamColor; }
  if (s.scores) {
    renderScoreCards('waiting-scores', s.scores);
    renderScoreCards('player-scores', s.scores);
  }

  if (s.question) {
    document.getElementById('player-question').textContent = s.question;
    answerCount = s.answerCount;
    buildMiniBoard(s.answerCount);
    (s.revealed || []).forEach(r => flipTile(r.index, r.text, r.pts));
    renderStrikes(s.strikes);
    setPot(s.pot);
  }

  switch (s.phase) {
    case 'faceoff':
      showBuzzer();
      break;

    case 'faceoff-judging': {
      const b = s.faceoff && s.faceoff.buzzer;
      if (!b) { showScreen('screen-game'); break; }
      if (b.playerId === playerId) {
        showScreen('screen-buzzed');
      } else {
        document.getElementById('sb-team-name').textContent  = b.teamName || '';
        document.getElementById('sb-team-name').style.color   = b.teamColor || '#fff';
        document.getElementById('sb-player-name').textContent = b.playerName || '';
        showScreen('screen-someone-buzzed');
      }
      break;
    }

    case 'faceoff-counter':
    case 'play-or-pass':
    case 'team-play':
    case 'steal':
      renderPhaseStatus(s);
      showScreen('screen-game');
      break;

    case 'round-over':
      renderRoundOver(s.lastRoundResult || {}, s.revealed || [], s.answerCount, s.scores);
      break;

    case 'game-over':
      renderLeaderboard('player-final-leaderboard', s.scores);
      showScreen('screen-game-over');
      break;

    default:
      showScreen('screen-waiting');
  }
}

// ── Live game events ──────────────────────────────────────────
socket.on('question-start', ({ question, answerCount: count, scores }) => {
  Sounds.wordReveal();
  document.getElementById('player-question').textContent = question;
  answerCount = count;
  buildMiniBoard(count);
  renderStrikes(0);
  setPot(0);
  setStatus('');
  renderScoreCards('player-scores', scores);
  // faceoff-open follows immediately and raises the buzzer.
});

socket.on('faceoff-open', ({ rebuzz }) => {
  Sounds.go();
  showBuzzer();
  if (rebuzz) {
    const hintEl = document.getElementById('buzz-hint-text');
    if (hintEl) hintEl.textContent = 'Both missed — buzz again!';
  }
});

// ── Buzzer (face-off only) ────────────────────────────────────
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
  // Safety reset: if the server never responds within 2s, unlock the buzzer
  setTimeout(() => {
    if (buzzerFired && buzzer.classList.contains('buzzer-pending')) {
      buzzer.classList.remove('buzzer-pending');
      if (hintEl) hintEl.textContent = 'Tap anywhere';
      buzzerFired = false;
    }
  }, 2000);
}, { passive: false });

socket.on('faceoff-buzz', ({ playerId: pid, playerName, teamName, teamColor }) => {
  document.getElementById('buzzer-fullscreen').classList.remove('buzzer-pending');
  if (pid === playerId) {
    showScreen('screen-buzzed');
  } else {
    document.getElementById('sb-team-name').textContent  = teamName;
    document.getElementById('sb-team-name').style.color   = teamColor;
    document.getElementById('sb-player-name').textContent = playerName;
    showScreen('screen-someone-buzzed');
  }
});

socket.on('faceoff-miss', () => {
  Sounds.noPoint();
  // The event that follows (faceoff-counter / faceoff-won / faceoff-open)
  // moves everyone to the right screen.
});

socket.on('faceoff-counter', ({ counterTeamIndex }) => {
  renderPhaseStatus({ phase: 'faceoff-counter', faceoff: { counterTeamIndex } });
  showScreen('screen-game');
});

socket.on('faceoff-won', ({ winnerTeamIndex }) => {
  Sounds.pointAwarded();
  renderPhaseStatus({ phase: 'play-or-pass', faceoffWinnerTeamIndex: winnerTeamIndex });
  showScreen('screen-game');
});

socket.on('team-play-start', ({ controllingTeamIndex }) => {
  Sounds.go();
  renderStrikes(0);
  renderPhaseStatus({ phase: 'team-play', controllingTeamIndex });
  showScreen('screen-game');
});

socket.on('answer-revealed', ({ answerIndex, text, pts, pot, context }) => {
  Sounds.pointAwarded();
  flipTile(answerIndex, text, pts);
  setPot(pot);
  if (context === 'cleanup') {
    updateRoundOverTile(answerIndex, text, pts);
  } else {
    // A reveal always resolves the buzzed/someone-buzzed screens.
    const onBuzzScreen = document.getElementById('screen-buzzed').classList.contains('active') ||
                         document.getElementById('screen-someone-buzzed').classList.contains('active');
    if (onBuzzScreen) showScreen('screen-game');
  }
});

socket.on('wrong-answer', ({ strikes }) => {
  Sounds.noPoint();
  renderStrikes(strikes);
});

socket.on('steal-mode', ({ stealTeamIndex, pot }) => {
  Sounds.timeUp();
  setPot(pot);
  renderPhaseStatus({ phase: 'steal', stealTeamIndex });
  showScreen('screen-game');
});

// ── Round over ────────────────────────────────────────────────
socket.on('round-complete', (rc) => {
  if (rc.winnerTeamIndex === myTeamIndex) Sounds.pointAwarded();
  else Sounds.noPoint();
  renderRoundOver(rc, rc.revealed || [], rc.answerCount, rc.scores);
  // Stay here until the host starts the next question — no auto-return.
});

function roundResultText(r) {
  if (r.winnerTeamIndex == null) return 'Round ended — no points awarded';
  switch (r.reason) {
    case 'board-clear':  return `Cleared the board — ${r.pot} points banked!`;
    case 'steal':        return `STOLEN! ${r.winnerTeamName} takes ${r.pot} points`;
    case 'steal-failed': return `Steal failed — ${r.winnerTeamName} keeps ${r.pot} points`;
    default:             return `${r.winnerTeamName} banks ${r.pot} points`;
  }
}

function renderRoundOver(result, revealed, count, scores) {
  const badge = document.getElementById('player-round-winner-badge');
  if (result.winnerTeamIndex != null) {
    const isGold = result.winnerTeamColor === '#FFD60A';
    badge.textContent = result.winnerTeamName;
    badge.style.cssText = `background:${result.winnerTeamColor};color:${isGold ? '#111' : '#fff'}`;
  } else {
    badge.textContent = 'No winner';
    badge.style.cssText = 'background:rgba(255,255,255,0.1);color:#fff';
  }
  document.getElementById('player-round-pts-text').textContent = roundResultText(result);

  // Revealed answers show; the rest stay hidden until the host flips them.
  const board = document.getElementById('player-reveal-board');
  board.innerHTML = '';
  const byIndex = new Map((revealed || []).map(r => [r.index, r]));
  const total = count || answerCount;
  for (let i = 0; i < total; i++) {
    const r = byIndex.get(i);
    const tile = document.createElement('div');
    tile.id = `p-ro-tile-${i}`;
    if (r) {
      tile.className = 'player-ro-tile';
      tile.innerHTML = `<span class="player-ro-tile-text">${escapeHtml(r.text)}</span><span class="player-ro-tile-pts">${r.pts}</span>`;
    } else {
      tile.className = 'player-ro-tile hidden-tile';
      tile.innerHTML = `<span class="player-ro-tile-text">? ? ?</span>`;
    }
    board.appendChild(tile);
  }

  if (scores) {
    renderScoreCards('player-ro-scores', scores);
    renderScoreCards('waiting-scores', scores);
  }
  showScreen('screen-round-over');
}

// Host flipping the leftovers after the round ("let's see what else was up there")
function updateRoundOverTile(index, text, pts) {
  const tile = document.getElementById(`p-ro-tile-${index}`);
  if (!tile) return;
  tile.className = 'player-ro-tile';
  tile.innerHTML = `<span class="player-ro-tile-text">${escapeHtml(text)}</span><span class="player-ro-tile-pts">${pts}</span>`;
}

// ── Game over / host gone ─────────────────────────────────────
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
