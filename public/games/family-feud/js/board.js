// Family Feud — read-only TV board.
// Attaches to a room via `watch-room` and renders ONLY the public feed: hidden
// tiles that flip open on reveal, scores, strikes, face-off / round banners.
// It is never a player (can't buzz, not in the roster) and never receives the
// answer key — the server unicasts that to the host alone.
const socket = io('/family-feud');
if (window.GNPause) GNPause.init(socket);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ── State (public only) ──
let roomCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
let watching = false;
let currentScores = [];
let answerCount = 0;
let pot = 0;
let phase = 'lobby';
let faceoffBuzzer = null;
let counterTeamIndex = null;
let faceoffWinnerTeamIndex = null;
let controllingTeamIndex = null;
let stealTeamIndex = null;

function teamMeta(i) { const t = currentScores[i] || {}; return { name: t.name || '', color: t.color || '#fff' }; }

// ── Landing → attach ──
const roomInput = document.getElementById('board-room-input');
if (roomCode) roomInput.value = roomCode;
roomInput.addEventListener('input', function () {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});
roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') startWatching(); });
document.getElementById('btn-watch').addEventListener('click', startWatching);

function startWatching() {
  const code = roomInput.value.trim().toUpperCase();
  const err = document.getElementById('board-error');
  if (code.length !== 4) { err.textContent = 'Room code must be 4 characters.'; return; }
  err.textContent = '';
  roomCode = code;
  watching = true;
  if (typeof Sounds !== 'undefined') Sounds.unlockAudio();   // the tap also unlocks TV audio
  document.getElementById('board-join-hint').textContent = `Players join at ${location.host} · Room ${roomCode}`;
  if (socket.connected) socket.emit('watch-room', { roomCode });
}

// ── Connection / resync ──
socket.on('connect', () => { if (watching && roomCode) socket.emit('watch-room', { roomCode }); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && watching && socket.connected) socket.emit('request-sync');
});
socket.on('watch-error', ({ message }) => {
  watching = false;
  document.getElementById('board-error').textContent = message || 'Could not open that room.';
  showScreen('screen-landing');
});
socket.on('sync', applySnapshot);
socket.on('host-disconnected', () => showScreen('screen-host-gone'));

socket.on('feud-timer', ({ secondsLeft, kind }) => {
  const el = document.getElementById('ff-timer');
  if (!el) return;
  if (secondsLeft == null || !kind) { el.style.display = 'none'; return; }
  const color = secondsLeft <= 3 ? '#FF2D55' : (secondsLeft <= 5 ? '#FF9500' : '#34C759');
  el.style.display = '';
  el.style.color = color; el.style.borderColor = color; el.style.background = color + '22';
  const k = document.getElementById('ff-timer-kind');
  const n = document.getElementById('ff-timer-num');
  if (k) k.textContent = kind === 'play' ? 'Answer' : 'Face-off';
  if (n) n.textContent = secondsLeft;
  if (typeof Sounds !== 'undefined' && typeof Sounds.tick === 'function' && secondsLeft > 0 && secondsLeft <= 3) Sounds.tick(secondsLeft <= 2);
});

// ── Team bar ──
function renderTeamsBar() {
  const bar = document.getElementById('ff-teams-bar');
  bar.innerHTML = '';
  currentScores.forEach((team, i) => {
    const isGold = team.color === '#FFD60A';
    let badge = '';
    let cls = 'ff-team-card';
    if (phase === 'faceoff' || phase === 'faceoff-judging' || phase === 'faceoff-counter') {
      badge = '<div class="ff-team-badge-label">FACE-OFF</div>';
      if (phase === 'faceoff-counter' && i === counterTeamIndex) { badge = '<div class="ff-team-badge-label">COUNTER</div>'; cls += ' active-team'; }
      else if (phase === 'faceoff-judging' && faceoffBuzzer && i === faceoffBuzzer.teamIndex) { badge = '<div class="ff-team-badge-label">BUZZED</div>'; cls += ' active-team'; }
    } else if (phase === 'play-or-pass' && i === faceoffWinnerTeamIndex) { badge = '<div class="ff-team-badge-label">WON FACE-OFF</div>'; cls += ' active-team'; }
    else if (phase === 'team-play' && i === controllingTeamIndex) { badge = '<div class="ff-team-badge-label">PLAYING</div>'; cls += ' active-team'; }
    else if (phase === 'steal' && i === stealTeamIndex) { badge = '<div class="ff-team-badge-label steal-badge">STEAL!</div>'; cls += ' steal-team'; }
    const card = document.createElement('div');
    card.className = cls;
    card.style.cssText = `background:${team.color};color:${isGold ? '#111' : '#fff'}`;
    card.innerHTML = `${badge}<div class="ff-team-name-label">${escapeHtml(team.name)}</div><div class="ff-team-score-num">${team.score}</div>`;
    bar.appendChild(card);
  });
}

// ── Board tiles ──
function buildBoard(count) {
  const board = document.getElementById('ff-board');
  board.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const tile = document.createElement('div');
    tile.className = 'ff-tile';
    tile.id = `tile-${i}`;
    tile.innerHTML = `<div class="ff-tile-inner"><div class="ff-tile-front">${i + 1}</div><div class="ff-tile-back"><span class="ff-answer-text" id="tile-text-${i}"></span><span class="ff-answer-pts" id="tile-pts-${i}"></span></div></div>`;
    board.appendChild(tile);
  }
}
function flipTile(index, text, pts) {
  const tile = document.getElementById(`tile-${index}`);
  if (!tile) return;
  const t = document.getElementById(`tile-text-${index}`);
  const p = document.getElementById(`tile-pts-${index}`);
  if (t) t.textContent = text;
  if (p) p.textContent = pts;
  tile.classList.add('revealed');
}

// ── Status / pot / strikes ──
function setStatus(main, sub, color) {
  document.getElementById('ff-status-main').innerHTML = main;
  document.getElementById('ff-status-sub').textContent = sub || '';
  const strip = document.getElementById('ff-status');
  strip.style.borderColor = color || 'rgba(255,255,255,0.1)';
  strip.style.background = color ? `${color}22` : 'rgba(255,255,255,0.05)';
}
function setPot(p) { pot = p || 0; document.getElementById('ff-pot').textContent = `Round pot: ${pot}`; }
function renderStrikes(n) { document.getElementById('ff-strikes').textContent = '❌'.repeat(n || 0); }

// Audience-facing status for the phases that aren't tied to a single live event.
function renderPhaseStatus() {
  switch (phase) {
    case 'faceoff-counter': { const { name, color } = teamMeta(counterTeamIndex); setStatus(`<strong>${escapeHtml(name)}</strong>'s counter`, 'One answer to beat the leader', color); break; }
    case 'play-or-pass': { const { name, color } = teamMeta(faceoffWinnerTeamIndex); setStatus(`<strong>${escapeHtml(name)}</strong> won the face-off!`, 'Play the board, or pass?', color); break; }
    case 'team-play': { const { name, color } = teamMeta(controllingTeamIndex); setStatus(`<strong>${escapeHtml(name)}</strong> is playing the board`, '3 strikes and it can be stolen', color); break; }
    case 'steal': { const { name, color } = teamMeta(stealTeamIndex); setStatus(`🚨 <strong>${escapeHtml(name)}</strong> can STEAL ${pot} points`, 'One answer for the win', '#FF9500'); break; }
  }
}

// ── Round over (no key leak — hidden tiles stay "? ? ?" until a public cleanup reveal) ──
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
  const badge = document.getElementById('ro-winner-badge');
  if (result.winnerTeamIndex != null) {
    const isGold = result.winnerTeamColor === '#FFD60A';
    badge.textContent = result.winnerTeamName;
    badge.style.cssText = `background:${result.winnerTeamColor};color:${isGold ? '#111' : '#fff'}`;
  } else {
    badge.textContent = 'No winner';
    badge.style.cssText = 'background:rgba(255,255,255,0.1);color:#fff';
  }
  document.getElementById('ro-points-gained').textContent = roundResultText(result);

  const board = document.getElementById('ro-reveal-board');
  board.innerHTML = '';
  const byIndex = new Map((revealed || []).map(r => [r.index, r]));
  const total = count || answerCount;
  for (let i = 0; i < total; i++) {
    const r = byIndex.get(i);
    const tile = document.createElement('div');
    tile.id = `ro-tile-${i}`;
    if (r) {
      tile.className = 'ff-ro-tile';
      tile.innerHTML = `<span class="ff-ro-tile-text">${escapeHtml(r.text)}</span><span class="ff-ro-tile-pts">${r.pts}</span>`;
    } else {
      tile.className = 'ff-ro-tile hidden-tile';
      tile.innerHTML = `<span class="ff-ro-tile-text">? ? ?</span>`;
    }
    board.appendChild(tile);
  }
  if (scores) renderScoreCards('ro-scores', scores);
  showScreen('screen-round-over');
}
function updateRoundOverTile(index, text, pts) {
  const tile = document.getElementById(`ro-tile-${index}`);
  if (!tile) return;
  tile.className = 'ff-ro-tile';
  tile.innerHTML = `<span class="ff-ro-tile-text">${escapeHtml(text)}</span><span class="ff-ro-tile-pts">${pts}</span>`;
}

// ── Score cards / leaderboard ──
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
    row.innerHTML = `<div class="lb-rank">${isWinner ? '👑' : i + 1}</div><div class="lb-name" style="color:${s.color}">${escapeHtml(s.name)}</div><div class="lb-score">${s.score}</div>`;
    container.appendChild(row);
  });
}

// ── Hydrate from a snapshot (initial attach + mid-game resync) ──
function applySnapshot(s) {
  if (!s) return;
  watching = true;
  if (s.scores) currentScores = s.scores;
  phase = s.phase;
  faceoffBuzzer = (s.faceoff && s.faceoff.buzzer) || null;
  counterTeamIndex = s.faceoff ? s.faceoff.counterTeamIndex : null;
  faceoffWinnerTeamIndex = s.faceoffWinnerTeamIndex;
  controllingTeamIndex = s.controllingTeamIndex;
  stealTeamIndex = s.stealTeamIndex;
  renderTeamsBar();

  if (s.question) {
    document.getElementById('ff-question').textContent = s.question;
    answerCount = s.answerCount;
    buildBoard(answerCount);
    (s.revealed || []).forEach(r => flipTile(r.index, r.text, r.pts));
    renderStrikes(s.strikes);
    setPot(s.pot);
  }

  switch (s.phase) {
    case 'faceoff':
      setStatus('🔔 FACE-OFF — waiting for a buzz…', 'First to buzz gets to answer');
      showScreen('screen-game');
      break;
    case 'faceoff-judging': {
      const b = faceoffBuzzer;
      if (b) setStatus(`<span class="ff-status-buzzer-dot" style="background:${b.teamColor}"></span><strong>${escapeHtml(b.playerName)}</strong> buzzed first &nbsp;·&nbsp; ${escapeHtml(b.teamName)}`, 'Can they name a top answer?', b.teamColor);
      showScreen('screen-game');
      break;
    }
    case 'faceoff-counter':
    case 'play-or-pass':
    case 'team-play':
    case 'steal':
      renderPhaseStatus();
      showScreen('screen-game');
      break;
    case 'round-over':
      renderRoundOver(s.lastRoundResult || {}, s.revealed || [], s.answerCount, s.scores);
      break;
    case 'game-over':
      renderLeaderboard('final-leaderboard', s.scores);
      showScreen('screen-game-over');
      break;
    default:
      if (s.scores) renderScoreCards('waiting-scores', s.scores);
      showScreen('screen-waiting');
  }
}

// ── Live public events ──
socket.on('question-start', (d) => {
  Sounds.wordReveal();
  answerCount = d.answerCount;
  if (d.scores) currentScores = d.scores;
  faceoffBuzzer = null; counterTeamIndex = null; faceoffWinnerTeamIndex = null; controllingTeamIndex = null; stealTeamIndex = null;
  document.getElementById('ff-question').textContent = d.question;
  buildBoard(answerCount);
  renderStrikes(0);
  setPot(0);
  phase = 'faceoff';
  renderTeamsBar();
  showScreen('screen-game');
});

socket.on('faceoff-open', ({ rebuzz }) => {
  Sounds.go();
  faceoffBuzzer = null;
  phase = 'faceoff';
  renderTeamsBar();
  setStatus('🔔 FACE-OFF — waiting for a buzz…', rebuzz ? 'Both teams missed — buzzers are open again' : 'First to buzz gets to answer');
});

socket.on('faceoff-buzz', ({ playerName, teamIndex, teamName, teamColor }) => {
  Sounds.buzz();
  faceoffBuzzer = { playerName, teamIndex, teamName, teamColor };
  phase = 'faceoff-judging';
  renderTeamsBar();
  setStatus(`<span class="ff-status-buzzer-dot" style="background:${teamColor}"></span><strong>${escapeHtml(playerName)}</strong> buzzed first &nbsp;·&nbsp; ${escapeHtml(teamName)}`, 'Can they name a top answer?', teamColor);
});

socket.on('faceoff-counter', ({ counterTeamIndex: ct, counterTeamName, counterTeamColor, firstAnswer: fa }) => {
  counterTeamIndex = ct;
  phase = 'faceoff-counter';
  renderTeamsBar();
  const context = (fa && fa.answerIndex === null) ? 'The first team missed — any answer wins it' : 'One answer to beat the leader';
  setStatus(`<strong>${escapeHtml(counterTeamName)}</strong>'s counter`, context, counterTeamColor);
});

socket.on('faceoff-won', ({ winnerTeamIndex, winnerTeamName, winnerTeamColor }) => {
  Sounds.pointAwarded();
  faceoffWinnerTeamIndex = winnerTeamIndex;
  phase = 'play-or-pass';
  renderTeamsBar();
  setStatus(`<strong>${escapeHtml(winnerTeamName)}</strong> won the face-off!`, 'Play the board, or pass?', winnerTeamColor);
});

socket.on('team-play-start', ({ controllingTeamIndex: c, teamName, teamColor, choice }) => {
  Sounds.go();
  controllingTeamIndex = c;
  renderStrikes(0);
  phase = 'team-play';
  renderTeamsBar();
  setStatus(`<strong>${escapeHtml(teamName)}</strong> is playing the board`, choice === 'pass' ? 'Passed to them' : '3 strikes and it can be stolen', teamColor);
});

socket.on('answer-revealed', ({ answerIndex, text, pts, pot: newPot, context }) => {
  Sounds.pointAwarded();
  flipTile(answerIndex, text, pts);
  setPot(newPot);
  if (context === 'cleanup') updateRoundOverTile(answerIndex, text, pts);
});

socket.on('wrong-answer', ({ strikes }) => { Sounds.noPoint(); renderStrikes(strikes); });
socket.on('faceoff-miss', () => { Sounds.noPoint(); });

socket.on('steal-mode', ({ stealTeamIndex: st, stealTeamName, stealTeamColor, pot: p }) => {
  Sounds.timeUp();
  stealTeamIndex = st;
  setPot(p);
  phase = 'steal';
  renderTeamsBar();
  setStatus(`🚨 <strong>${escapeHtml(stealTeamName)}</strong> can STEAL ${p} points`, 'One answer for the win', '#FF9500');
});

socket.on('round-complete', (rc) => {
  if (rc.winnerTeamIndex != null) Sounds.pointAwarded(); else Sounds.noPoint();
  if (rc.scores) currentScores = rc.scores;
  phase = 'round-over';
  renderRoundOver(rc, rc.revealed || [], rc.answerCount, rc.scores);
});

socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
  phase = 'game-over';
  renderLeaderboard('final-leaderboard', scores);
  showScreen('screen-game-over');
});
