const socket = io('/family-feud');

const TEAM_COLORS = ['#FF2D55','#5856D6','#FF9500','#34C759','#00C7BE','#FF375F','#BF5AF2','#FFD60A'];

let teamCount = 4;
let allPlayers = [];
let currentScores = [];
let currentQuestion = null;
let revealedAnswers = [];
let activeTeamIndex = 0;
let stealTeamIndex = -1;
let strikes = 0;
let roundPot = 0;

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
    baseUrl: `${location.protocol}//${location.host}`
  });

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

socket.on('player-joined', ({ allPlayers: players }) => {
  allPlayers = players;
  document.getElementById('player-count').textContent = players.length;
  renderPlayerGroups(currentScores.map(s => ({ name: s.name, color: s.color })));
  document.getElementById('btn-end-game-lobby').style.display = 'block';
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

document.getElementById('btn-start-game').addEventListener('click', () => {
  socket.emit('start-question');
});
document.getElementById('btn-end-game-lobby').addEventListener('click', () => {
  if (confirm('End the game now?')) socket.emit('end-game');
});

// ── Game: question start ───────────────────────────────────────
socket.on('question-start', (data) => {
  Sounds.wordReveal();

  currentQuestion = { q: data.question, answerCount: data.answerCount };
  activeTeamIndex = data.activeTeamIndex;
  revealedAnswers = [];
  strikes = 0;
  roundPot = 0;
  stealTeamIndex = -1;

  currentScores = data.scores;

  document.getElementById('ff-question').textContent = data.question;
  document.getElementById('ff-strikes').textContent = '';

  hideBuzzedDisplay();
  hideStealBanner();

  buildBoard(data.answerCount);
  buildRevealButtons(data.answerCount);
  renderTeamsBars(data.scores, data.activeTeamIndex, -1);

  showScreen('screen-game');
});

function buildBoard(count) {
  const board = document.getElementById('ff-board');
  board.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const tile = document.createElement('div');
    tile.className = 'ff-tile';
    tile.id = `ff-tile-${i}`;
    tile.innerHTML = `
      <div class="ff-tile-inner">
        <div class="ff-tile-front">${i + 1}</div>
        <div class="ff-tile-back">
          <span class="ff-answer-text" id="ff-tile-text-${i}"></span>
          <span class="ff-answer-pts" id="ff-tile-pts-${i}"></span>
        </div>
      </div>
    `;
    board.appendChild(tile);
  }
}

function buildRevealButtons(count) {
  // Buttons will be filled in when question data arrives via answer-revealed
  // but we pre-build them as unknown (no text yet) from the question bank
  // Actually we need the answer texts. We'll use a placeholder and fill from server events.
  // Since the host has no answer text until reveal, we build numbered placeholders
  // that get updated on reveal. However, host needs to be able to click them to reveal.
  // We store the answer list when we build buttons and populate from the question data
  // passed in question-start. Unfortunately question-start only passes count, not answers.
  // So we build numbered buttons; text fills in on reveal. Host clicks by number.
  const container = document.getElementById('ff-reveal-btns');
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const btn = document.createElement('button');
    btn.className = 'ff-reveal-answer-btn';
    btn.id = `ff-reveal-btn-${i}`;
    btn.textContent = `Answer ${i + 1}`;
    btn.dataset.index = i;
    btn.addEventListener('click', () => {
      socket.emit('reveal-answer', { answerIndex: i });
    });
    container.appendChild(btn);
  }
}

function renderTeamsBars(scores, activeIdx, stealIdx) {
  const bar = document.getElementById('ff-teams-bar');
  bar.innerHTML = '';
  scores.forEach(s => {
    const isGold = s.color === '#FFD60A';
    const isActive = s.index === activeIdx;
    const isSteal  = s.index === stealIdx;
    const card = document.createElement('div');
    card.className = 'ff-team-card' +
      (isActive && stealIdx < 0 ? ' active-team' : '') +
      (isSteal ? ' steal-team' : '');
    card.style.cssText = `background:${s.color}22;color:${s.color}`;

    let badge = '';
    if (isActive && stealIdx < 0) {
      badge = `<span class="ff-team-badge-label">PLAYING</span>`;
    } else if (isSteal) {
      badge = `<span class="ff-team-badge-label steal-badge">STEAL!</span>`;
    }

    card.innerHTML = `
      ${badge}
      <div class="ff-team-name-label" style="color:${isGold ? '#111' : '#fff'}">${s.name}</div>
      <div class="ff-team-score-num" style="color:${s.color}">${s.score}</div>
    `;
    bar.appendChild(card);
  });
}

function hideBuzzedDisplay() {
  const el = document.getElementById('ff-buzzed-display');
  if (el) el.classList.remove('visible');
}

function hideStealBanner() {
  const el = document.getElementById('ff-steal-banner');
  if (el) el.classList.remove('visible');
}

// ── Game: answer revealed ──────────────────────────────────────
socket.on('answer-revealed', ({ answerIndex, text, pts, revealedAnswers: revealed }) => {
  Sounds.pointAwarded();

  revealedAnswers = revealed;

  // Update tile
  const tile = document.getElementById(`ff-tile-${answerIndex}`);
  if (tile) {
    document.getElementById(`ff-tile-text-${answerIndex}`).textContent = text;
    document.getElementById(`ff-tile-pts-${answerIndex}`).textContent = pts;
    tile.classList.add('revealed');
  }

  // Update reveal button text and mark used
  const btn = document.getElementById(`ff-reveal-btn-${answerIndex}`);
  if (btn) {
    btn.textContent = `${text} (${pts})`;
    btn.classList.add('used');
  }

  hideBuzzedDisplay();
});

// ── Game: wrong answer ─────────────────────────────────────────
socket.on('wrong-answer', ({ strikes: s, stealMode }) => {
  Sounds.noPoint();
  strikes = s;
  document.getElementById('ff-strikes').textContent = '❌'.repeat(strikes);
  hideBuzzedDisplay();

  if (stealMode) {
    // steal-mode event will follow
  }
});

// ── Game: steal mode ───────────────────────────────────────────
socket.on('steal-mode', ({ stealTeamIndex: si, stealTeamName, stealTeamColor, roundPot: pot }) => {
  Sounds.timeUp();
  stealTeamIndex = si;
  roundPot = pot;

  renderTeamsBars(currentScores, activeTeamIndex, stealTeamIndex);

  const banner = document.getElementById('ff-steal-banner');
  document.getElementById('ff-steal-banner-title').textContent = `STEAL: ${stealTeamName}`;
  document.getElementById('ff-steal-banner-sub').textContent =
    `${stealTeamName} can steal ${pot} points with one answer!`;
  banner.classList.add('visible');
});

// ── Game: player buzzed ────────────────────────────────────────
socket.on('player-buzzed', ({ playerName, teamName, teamColor, isSteal }) => {
  Sounds.buzz();

  const display = document.getElementById('ff-buzzed-display');
  const dot = document.getElementById('ff-buzzed-dot');
  const nameEl = document.getElementById('ff-buzzed-name');
  const teamEl = document.getElementById('ff-buzzed-team-label');

  dot.style.background = teamColor;
  nameEl.textContent = playerName;
  teamEl.textContent = isSteal ? `${teamName} (STEAL)` : teamName;
  display.classList.add('visible');
});

// ── Game: buzzers live ─────────────────────────────────────────
socket.on('buzzers-live', ({ activeTeamIndex: ati }) => {
  activeTeamIndex = ati;
  hideBuzzedDisplay();
  renderTeamsBars(currentScores, activeTeamIndex, stealTeamIndex);
});

// ── Round complete ─────────────────────────────────────────────
socket.on('round-complete', ({ scores, roundPot: pot, winnerTeamName, winnerTeamColor, allAnswers, stealSuccess, stealFailed }) => {
  currentScores = scores;
  stealTeamIndex = -1;

  // Reveal any unrevealed tiles
  if (allAnswers) {
    allAnswers.forEach((ans, i) => {
      const tile = document.getElementById(`ff-tile-${i}`);
      if (tile && !tile.classList.contains('revealed')) {
        const textEl = document.getElementById(`ff-tile-text-${i}`);
        const ptsEl  = document.getElementById(`ff-tile-pts-${i}`);
        if (textEl) textEl.textContent = ans.t;
        if (ptsEl)  ptsEl.textContent  = ans.p;
        tile.classList.add('revealed');
      }
    });
  }

  if (stealSuccess) {
    Sounds.pointAwarded();
  } else if (stealFailed) {
    Sounds.noPoint();
  } else {
    Sounds.pointAwarded();
  }

  // Build round-over screen after a short delay so tiles can flip
  setTimeout(() => {
    buildRoundOverScreen(scores, pot, winnerTeamName, winnerTeamColor, allAnswers, stealSuccess, stealFailed);
    showScreen('screen-round-over');
  }, 1500);
});

function buildRoundOverScreen(scores, pot, winnerTeamName, winnerTeamColor, allAnswers, stealSuccess, stealFailed) {
  const badge = document.getElementById('ro-winner-badge');
  const isGold = winnerTeamColor === '#FFD60A';
  badge.textContent = winnerTeamName;
  badge.style.cssText = `background:${winnerTeamColor};color:${isGold ? '#111' : '#fff'}`;

  const pointsEl = document.getElementById('ro-points-gained');
  if (stealSuccess) {
    pointsEl.textContent = `Steal successful! ${winnerTeamName} wins ${pot} points`;
  } else if (stealFailed) {
    pointsEl.textContent = `Steal failed. ${winnerTeamName} keeps ${pot} points`;
  } else {
    pointsEl.textContent = `${winnerTeamName} wins ${pot} points this round`;
  }

  const roBoard = document.getElementById('ro-reveal-board');
  roBoard.innerHTML = '';
  if (allAnswers) {
    allAnswers.forEach(ans => {
      const tile = document.createElement('div');
      tile.className = 'ff-ro-tile';
      tile.innerHTML = `
        <span class="ff-ro-tile-text">${ans.t}</span>
        <span class="ff-ro-tile-pts">${ans.p}</span>
      `;
      roBoard.appendChild(tile);
    });
  }

  renderScoreCards('ro-scores', scores);
}

// ── Game over ──────────────────────────────────────────────────
socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
  renderLeaderboard('final-leaderboard', scores);
  showScreen('screen-game-over');
});

// ── Host control buttons ───────────────────────────────────────
document.getElementById('btn-wrong').addEventListener('click', () => {
  socket.emit('host-wrong');
});

document.getElementById('btn-end-round').addEventListener('click', () => {
  if (confirm('End this round? The active team gets all points revealed so far.')) {
    socket.emit('end-round');
  }
});

document.getElementById('btn-end-game-game').addEventListener('click', () => {
  if (confirm('End the game now?')) socket.emit('end-game');
});

document.getElementById('btn-next-question').addEventListener('click', () => {
  socket.emit('start-question');
});

document.getElementById('btn-end-game-roundover').addEventListener('click', () => {
  if (confirm('End the game now?')) socket.emit('end-game');
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
    card.innerHTML = `<div class="team-name">${s.name}</div><div class="score-num">${s.score}</div>`;
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
      <div class="lb-name" style="color:${s.color}">${s.name}</div>
      <div class="lb-score">${s.score}</div>
    `;
    container.appendChild(row);
  });
}
