const socket = io('/grab-the-mic');

const TEAM_COLORS = ['#FF2D55','#5856D6','#FF9500','#34C759','#00C7BE','#FF375F','#BF5AF2','#FFD60A'];

let teamCount = 4;
let allPlayers = [];
let currentScores = [];
let currentWord = '';
let selectedSingingTime = 10;
let selectedBuzzCountdown = 3;
let selectedGoal = 0;
let selectedMode = 'teams';
let gameMode = 'teams';
let scoreGoal = null;
let buzzersLiveTimeout = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function dbg(msg) {
  const el = document.getElementById('debug-log');
  if (el) el.textContent = msg;
}

// ── Setup ──────────────────────────────────────────────────────
const countDisplay   = document.getElementById('team-count-display');
const teamNameInputs = document.getElementById('team-name-inputs');

function renderTeamInputs() {
  teamNameInputs.innerHTML = '';
  for (let i = 0; i < teamCount; i++) {
    const row = document.createElement('div');
    row.className = 'team-input-row';
    row.innerHTML = `
      <div class="team-dot" style="background:${TEAM_COLORS[i]}"></div>
      <input type="text" placeholder="Team ${i + 1}" maxlength="20" id="team-name-${i}">
    `;
    teamNameInputs.appendChild(row);
  }
}

document.getElementById('count-down').addEventListener('click', () => {
  if (teamCount > 2) { teamCount--; countDisplay.textContent = teamCount; renderTeamInputs(); }
});
document.getElementById('count-up').addEventListener('click', () => {
  if (teamCount < 8) { teamCount++; countDisplay.textContent = teamCount; renderTeamInputs(); }
});

function bindSelector(containerId, onSelect) {
  document.querySelectorAll(`#${containerId} .timer-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${containerId} .timer-btn`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(btn);
    });
  });
}

bindSelector('timer-selector', b => { selectedSingingTime = parseInt(b.dataset.seconds); });
bindSelector('buzz-selector',  b => { selectedBuzzCountdown = parseInt(b.dataset.seconds); });
bindSelector('goal-selector',  b => { selectedGoal = parseInt(b.dataset.goal) || 0; });
bindSelector('mode-selector',  b => {
  selectedMode = b.dataset.mode;
  document.getElementById('teams-setup').style.display = selectedMode === 'individual' ? 'none' : 'flex';
});

document.getElementById('btn-create').addEventListener('click', () => {
  Sounds.unlockAudio();
  const btn = document.getElementById('btn-create');
  btn.textContent = 'Creating...';
  btn.disabled = true;
  dbg('Connecting...');

  const teamNames = Array.from({ length: teamCount }, (_, i) => {
    const el = document.getElementById(`team-name-${i}`);
    return el ? el.value.trim() : '';
  });
  socket.emit('create-room', {
    teamCount,
    teamNames,
    baseUrl: `${location.protocol}//${location.host}`,
    singingTime: selectedSingingTime,
    buzzCountdown: selectedBuzzCountdown,
    scoreGoal: selectedGoal || null,
    mode: selectedMode
  });

  setTimeout(() => { btn.textContent = 'Create Room'; btn.disabled = false; dbg(''); }, 8000);
});

renderTeamInputs();

// ── Lobby ──────────────────────────────────────────────────────
function updateGoalChip() {
  const el = document.getElementById('lobby-goal');
  if (!el) return;
  if (scoreGoal) {
    el.textContent = `🎯 First to ${scoreGoal} points wins`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

socket.on('room-created', (data) => {
  try {
    const { roomCode, joinUrl, localIP, port, teams, mode, scoreGoal: goal } = data;
    document.getElementById('btn-create').textContent = 'Create Room';
    document.getElementById('btn-create').disabled = false;
    dbg('');

    gameMode = mode || 'teams';
    scoreGoal = goal || null;
    currentScores = teams.map((t, i) => ({ index: i, name: t.name, color: t.color, score: 0 }));
    allPlayers = [];

    document.getElementById('lobby-room-code').textContent = roomCode;
    document.getElementById('lobby-join-url').textContent = joinUrl;

    const ipEl = document.getElementById('lobby-player-address');
    if (ipEl) ipEl.innerHTML = `Players go to: <strong>http://${localIP}:${port}</strong>`;

    updateGoalChip();
    renderPlayerGroups();
    showScreen('screen-lobby');
  } catch (err) {
    dbg('Error: ' + err.message);
  }
});

socket.on('qr-ready', ({ qrDataUrl }) => {
  if (qrDataUrl) {
    document.getElementById('lobby-qr-img').src = qrDataUrl;
    document.getElementById('lobby-qr').style.display = 'block';
  }
});

socket.on('create-room-error', ({ message }) => {
  document.getElementById('btn-create').textContent = 'Create Room';
  document.getElementById('btn-create').disabled = false;
  dbg('Error: ' + message);
});

// Single source of truth for the roster — fired on join, rejoin, and
// disconnect. Disconnected players stay listed (marked away) instead of
// vanishing, and rejoiners never duplicate.
socket.on('players-update', ({ allPlayers: players, scores }) => {
  allPlayers = players;
  if (scores) currentScores = scores;
  document.getElementById('player-count').textContent = players.length;
  renderPlayerGroups();
  if (document.getElementById('lobby-scores-section').style.display !== 'none') {
    renderScoreCards('lobby-scores', currentScores);
  }
});

function renderPlayerGroups() {
  const container = document.getElementById('player-groups');
  container.innerHTML = '';

  const memberLabel = p => `<span${p.connected === false ? ' class="away"' : ''}>${escapeHtml(p.name)}${p.connected === false ? ' (away)' : ''}</span>`;

  if (gameMode === 'individual') {
    const div = document.createElement('div');
    div.className = 'player-group';
    div.innerHTML = `
      <div class="player-group-header" style="color:#BF5AF2">Players</div>
      <div class="player-group-members">${allPlayers.length ? allPlayers.map(memberLabel).join(', ') : 'No players yet — scan the QR to join'}</div>
    `;
    container.appendChild(div);
    return;
  }

  currentScores.forEach((team, i) => {
    const members = allPlayers.filter(p => p.teamIndex === i);
    const div = document.createElement('div');
    div.className = 'player-group';
    div.innerHTML = `
      <div class="player-group-header" style="color:${team.color}">${escapeHtml(team.name)}</div>
      <div class="player-group-members">${members.length ? members.map(memberLabel).join(', ') : 'No players yet'}</div>
    `;
    container.appendChild(div);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

document.getElementById('btn-reveal').addEventListener('click', () => socket.emit('reveal-word'));
document.getElementById('btn-end-game-lobby').addEventListener('click', () => {
  if (confirm('End the game now?')) socket.emit('end-game');
});

// ── Countdown ─────────────────────────────────────────────────
socket.on('word-reveal', ({ word, countdownFrom }) => {
  Sounds.wordReveal();
  currentWord = word;
  document.getElementById('countdown-word').textContent = word;
  const numEl = document.getElementById('countdown-num');
  numEl.className = 'countdown-num';
  numEl.textContent = countdownFrom || 3;
  showScreen('screen-countdown');
});

socket.on('countdown', ({ seconds }) => {
  Sounds.tick(false);
  const numEl = document.getElementById('countdown-num');
  numEl.className = 'countdown-num';
  void numEl.offsetWidth;
  numEl.textContent = seconds;
});

socket.on('buzzers-live', () => {
  Sounds.go();
  const numEl = document.getElementById('countdown-num');
  numEl.className = 'countdown-num go';
  numEl.textContent = 'GO!';
  if (buzzersLiveTimeout) clearTimeout(buzzersLiveTimeout);
  buzzersLiveTimeout = setTimeout(() => {
    buzzersLiveTimeout = null;
    document.getElementById('live-word').textContent = currentWord;
    showScreen('screen-buzzers-live');
  }, 600);
});

// ── Judging ───────────────────────────────────────────────────
socket.on('player-buzzed', ({ teamName, teamColor, playerName, singingTime }) => {
  // A fast buzz can arrive while the 'GO!' transition is still pending —
  // cancel it so the judging screen isn't overwritten back to buzzers-live.
  if (buzzersLiveTimeout) { clearTimeout(buzzersLiveTimeout); buzzersLiveTimeout = null; }
  Sounds.buzz();
  const badge = document.getElementById('judging-badge');
  const isGold = teamColor === '#FFD60A';
  badge.textContent = teamName;
  badge.style.cssText = `background:${teamColor};color:${isGold ? '#111' : '#fff'};box-shadow:0 0 40px ${teamColor}88`;
  document.getElementById('judging-player').textContent = playerName;
  document.getElementById('judging-word').textContent = currentWord;
  const countEl = document.getElementById('judging-countdown');
  if (countEl) { countEl.textContent = singingTime || 10; countEl.className = 'singing-countdown'; }
  const timeUpBanner = document.getElementById('time-up-banner');
  if (timeUpBanner) timeUpBanner.style.display = 'none';
  showScreen('screen-judging');
});

socket.on('singing-timer', ({ secondsLeft }) => {
  Sounds.tick(secondsLeft <= 3);
  const el = document.getElementById('judging-countdown');
  if (!el) return;
  el.textContent = secondsLeft;
  el.className = 'singing-countdown' + (secondsLeft <= 3 ? ' danger' : secondsLeft <= 5 ? ' warning' : '');
});

socket.on('singing-timeout', () => {
  Sounds.timeUp();
  const el = document.getElementById('judging-countdown');
  if (el) { el.textContent = '0'; el.className = 'singing-countdown danger'; }
  const banner = document.getElementById('time-up-banner');
  if (banner) banner.style.display = 'block';
});

document.getElementById('btn-yes').addEventListener('click',    () => { Sounds.pointAwarded(); socket.emit('judge', { verdict: 'award' }); });
document.getElementById('btn-nope').addEventListener('click',   () => { Sounds.noPoint();      socket.emit('judge', { verdict: 'none' }); });
document.getElementById('btn-deduct').addEventListener('click', () => { Sounds.noPoint();      socket.emit('judge', { verdict: 'deduct' }); });

// ── Results ───────────────────────────────────────────────────
socket.on('round-complete', ({ scores, verdict, winnerTeamName, goalReached }) => {
  currentScores = scores;

  const banner = document.getElementById('results-banner');
  if (winnerTeamName) {
    if (verdict === 'award') {
      banner.textContent = `Point to ${winnerTeamName}!`;
      banner.className = 'result-banner awarded';
    } else if (verdict === 'deduct') {
      banner.textContent = `−1 point from ${winnerTeamName}!`;
      banner.className = 'result-banner not-awarded';
    } else {
      banner.textContent = `No point — ${winnerTeamName} didn't make it.`;
      banner.className = 'result-banner not-awarded';
    }
  } else {
    banner.textContent = 'Round complete';
    banner.className = 'result-banner';
  }

  const goalBanner = document.getElementById('goal-banner');
  if (goalReached) {
    goalBanner.textContent = `🏆 ${goalReached.teamName} reached ${goalReached.goal} points!`;
    goalBanner.style.display = 'block';
    document.getElementById('results-actions').style.display = 'none';
    document.getElementById('goal-actions').style.display = 'flex';
  } else {
    goalBanner.style.display = 'none';
    document.getElementById('results-actions').style.display = 'flex';
    document.getElementById('goal-actions').style.display = 'none';
  }

  renderScoreCards('results-scores', scores);

  document.getElementById('lobby-scores-section').style.display = 'block';
  renderScoreCards('lobby-scores', scores);
  document.getElementById('btn-end-game-lobby').style.display = 'block';

  showScreen('screen-results');
});

document.getElementById('btn-next-word').addEventListener('click', () => {
  showScreen('screen-lobby');
  socket.emit('reveal-word');
});
document.getElementById('btn-end-game').addEventListener('click', () => {
  if (confirm('End the game now?')) socket.emit('end-game');
});

// ── Pause (back to lobby so new players can scan the QR) ─────
document.getElementById('btn-pause').addEventListener('click', () => socket.emit('pause-game'));
socket.on('game-paused', () => showScreen('screen-lobby'));

// ── Score goal reached ────────────────────────────────────────
document.getElementById('btn-goal-end').addEventListener('click', () => socket.emit('end-game'));
document.getElementById('btn-goal-continue').addEventListener('click', () => socket.emit('extend-goal'));

socket.on('goal-extended', ({ scoreGoal: goal }) => {
  scoreGoal = goal;
  updateGoalChip();
  document.getElementById('goal-banner').style.display = 'none';
  document.getElementById('results-actions').style.display = 'flex';
  document.getElementById('goal-actions').style.display = 'none';
  const banner = document.getElementById('results-banner');
  banner.textContent = `Game on — first to ${goal} now!`;
  banner.className = 'result-banner goal';
});

// ── Game over ─────────────────────────────────────────────────
socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
  renderLeaderboard('final-leaderboard', scores);
  showScreen('screen-game-over');
});

function renderLeaderboard(containerId, scores) {
  const container = document.getElementById(containerId);
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
