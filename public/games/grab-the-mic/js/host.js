const socket = io('/grab-the-mic');

const TEAM_COLORS = ['#FF2D55','#5856D6','#FF9500','#34C759','#00C7BE','#FF375F','#BF5AF2','#FFD60A'];

let teamCount = 4;
let allPlayers = [];
let currentScores = [];
let currentWord = '';

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

document.getElementById('btn-create').addEventListener('click', () => {
  const btn = document.getElementById('btn-create');
  btn.textContent = 'Creating...';
  btn.disabled = true;
  dbg('Connecting...');

  const teamNames = Array.from({ length: teamCount }, (_, i) => {
    const el = document.getElementById(`team-name-${i}`);
    return el ? el.value.trim() : '';
  });
  socket.emit('create-room', { teamCount, teamNames, baseUrl: `${location.protocol}//${location.host}` });

  setTimeout(() => { btn.textContent = 'Create Room'; btn.disabled = false; dbg(''); }, 8000);
});

renderTeamInputs();

// ── Lobby ──────────────────────────────────────────────────────
socket.on('room-created', (data) => {
  try {
    const { roomCode, joinUrl, localIP, port, teams } = data;
    document.getElementById('btn-create').textContent = 'Create Room';
    document.getElementById('btn-create').disabled = false;
    dbg('');

    currentScores = teams.map((t, i) => ({ index: i, name: t.name, color: t.color, score: 0 }));
    allPlayers = [];

    document.getElementById('lobby-room-code').textContent = roomCode;
    document.getElementById('lobby-join-url').textContent = joinUrl;

    const ipEl = document.getElementById('lobby-player-address');
    if (ipEl) ipEl.innerHTML = `Players go to: <strong>http://${localIP}:${port}</strong>`;

    renderPlayerGroups(teams);
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

socket.on('player-joined', ({ playerName, teamIndex, allPlayers: players }) => {
  allPlayers = players;
  document.getElementById('player-count').textContent = players.length;
  renderPlayerGroups(currentScores.map(s => ({ name: s.name, color: s.color })));
});

socket.on('player-left', ({ allPlayers: players }) => {
  allPlayers = players;
  document.getElementById('player-count').textContent = players.length;
  renderPlayerGroups(currentScores.map(s => ({ name: s.name, color: s.color })));
});

function renderPlayerGroups(teams) {
  const container = document.getElementById('player-groups');
  container.innerHTML = '';
  teams.forEach((team, i) => {
    const members = allPlayers.filter(p => p.teamIndex === i).map(p => p.name);
    const div = document.createElement('div');
    div.className = 'player-group';
    div.innerHTML = `
      <div class="player-group-header" style="color:${team.color}">${team.name}</div>
      <div class="player-group-members">${members.length ? members.join(', ') : 'No players yet'}</div>
    `;
    container.appendChild(div);
  });
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
    card.innerHTML = `<div class="team-name">${s.name}</div><div class="score-num">${s.score}</div>`;
    container.appendChild(card);
  });
}

document.getElementById('btn-reveal').addEventListener('click', () => socket.emit('reveal-word'));
document.getElementById('btn-end-game-lobby').addEventListener('click', () => {
  if (confirm('End the game now?')) socket.emit('end-game');
});

// ── Countdown ─────────────────────────────────────────────────
socket.on('word-reveal', ({ word }) => {
  currentWord = word;
  document.getElementById('countdown-word').textContent = word;
  const numEl = document.getElementById('countdown-num');
  numEl.className = 'countdown-num';
  numEl.textContent = '3';
  showScreen('screen-countdown');
});

socket.on('countdown', ({ seconds }) => {
  const numEl = document.getElementById('countdown-num');
  numEl.className = 'countdown-num';
  void numEl.offsetWidth;
  numEl.textContent = seconds;
});

socket.on('buzzers-live', () => {
  const numEl = document.getElementById('countdown-num');
  numEl.className = 'countdown-num go';
  numEl.textContent = 'GO!';
  setTimeout(() => {
    document.getElementById('live-word').textContent = currentWord;
    showScreen('screen-buzzers-live');
  }, 600);
});

// ── Judging ───────────────────────────────────────────────────
socket.on('player-buzzed', ({ teamName, teamColor, playerName }) => {
  const badge = document.getElementById('judging-badge');
  const isGold = teamColor === '#FFD60A';
  badge.textContent = teamName;
  badge.style.cssText = `background:${teamColor};color:${isGold ? '#111' : '#fff'};box-shadow:0 0 40px ${teamColor}88`;
  document.getElementById('judging-player').textContent = playerName;
  document.getElementById('judging-word').textContent = currentWord;
  showScreen('screen-judging');
});

document.getElementById('btn-yes').addEventListener('click',  () => socket.emit('judge', { awarded: true }));
document.getElementById('btn-nope').addEventListener('click', () => socket.emit('judge', { awarded: false }));

// ── Results ───────────────────────────────────────────────────
socket.on('round-complete', ({ scores, awarded, winnerTeamName }) => {
  currentScores = scores;

  const banner = document.getElementById('results-banner');
  banner.textContent = winnerTeamName
    ? (awarded ? `Point to ${winnerTeamName}!` : `No point — ${winnerTeamName} didn't make it.`)
    : 'Round complete';
  banner.className = `result-banner ${awarded ? 'awarded' : 'not-awarded'}`;

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

// ── Game over ─────────────────────────────────────────────────
socket.on('game-over', ({ scores }) => {
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
      <div class="lb-name" style="color:${s.color}">${s.name}</div>
      <div class="lb-score">${s.score}</div>
    `;
    container.appendChild(row);
  });
}
