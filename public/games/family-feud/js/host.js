const socket = io('/family-feud');

// Launched as part of a tournament? Adopt the pre-created room and return when done.
const TOURNEY = (() => {
  const p = new URLSearchParams(location.search);
  const room = p.get('room'), t = p.get('t');
  return (room && t) ? { room: room.toUpperCase(), t: t.toUpperCase() } : null;
})();
if (TOURNEY) socket.on('connect', () => socket.emit('claim-host', { roomCode: TOURNEY.room }));

const TEAM_COLORS = ['#FF2D55', '#5856D6'];

let allPlayers = [];
let currentScores = [];
let answers = [];          // the full answer key — host only
let answerCount = 0;
let revealedIndices = [];
let revealedBy = {};       // answerIndex → teamIndex | null
let pot = 0;
let phase = 'lobby';
let faceoffBuzzer = null;
let counterTeamIndex = null;
let firstAnswer = null;
let faceoffWinnerTeamIndex = null;
let controllingTeamIndex = null;
let stealTeamIndex = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function dbg(msg) {
  const el = document.getElementById('debug-log');
  if (el) el.textContent = msg;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Setup (always exactly 2 teams — it's a head-to-head game) ──
const teamNameInputs = document.getElementById('team-name-inputs');
['Team 1', 'Team 2'].forEach((placeholder, i) => {
  const row = document.createElement('div');
  row.className = 'team-input-row';
  row.innerHTML = `
    <div class="team-dot" style="background:${TEAM_COLORS[i]}"></div>
    <input type="text" placeholder="${placeholder}" maxlength="20" id="team-name-${i}">
  `;
  teamNameInputs.appendChild(row);
});

document.getElementById('btn-create').addEventListener('click', () => {
  Sounds.unlockAudio();
  const btn = document.getElementById('btn-create');
  btn.textContent = 'Creating...';
  btn.disabled = true;
  dbg('Connecting...');

  const teamNames = [0, 1].map(i => {
    const el = document.getElementById(`team-name-${i}`);
    return el ? el.value.trim() : '';
  });
  socket.emit('create-room', { teamNames, baseUrl: `${location.protocol}//${location.host}` });

  setTimeout(() => { btn.textContent = 'Create Room'; btn.disabled = false; dbg(''); }, 8000);
});

// ── Lobby ──────────────────────────────────────────────────────
socket.on('room-created', ({ roomCode, joinUrl, localIP, port, teams }) => {
  document.getElementById('btn-create').textContent = 'Create Room';
  document.getElementById('btn-create').disabled = false;
  dbg('');

  currentScores = teams.map((t, i) => ({ index: i, name: t.name, color: t.color, score: 0 }));
  allPlayers = [];

  document.getElementById('lobby-room-code').textContent = roomCode;
  document.getElementById('lobby-join-url').textContent = joinUrl;
  const ipEl = document.getElementById('lobby-player-address');
  if (ipEl) ipEl.innerHTML = `Players go to: <strong>http://${localIP}:${port}</strong>`;

  renderPlayerGroups();
  showScreen('screen-lobby');
});

socket.on('qr-ready', ({ qrDataUrl }) => {
  if (qrDataUrl) {
    document.getElementById('lobby-qr-img').src = qrDataUrl;
    document.getElementById('lobby-qr').style.display = 'block';
  }
});

// Tournament: adopt the pre-created room, hide the join code/QR, just start.
socket.on('host-attached', (data) => {
  currentScores = (data.teams || []).map((t, i) => ({ index: i, name: t.name, color: t.color, score: 0 }));
  allPlayers = [];
  const codeSec = document.querySelector('#screen-lobby .lobby-code-section');
  if (codeSec) codeSec.style.display = 'none';
  const startBtn = document.getElementById('btn-start-game');
  if (startBtn) startBtn.textContent = `Start (${data.tournamentLength} questions)`;
  const endBtn = document.getElementById('btn-end-game-lobby');
  if (endBtn) endBtn.style.display = 'none';
  renderPlayerGroups();
  showScreen('screen-lobby');
});

socket.on('create-room-error', ({ message }) => {
  document.getElementById('btn-create').textContent = 'Create Room';
  document.getElementById('btn-create').disabled = false;
  dbg('Error: ' + message);
});

// Single source of truth for the roster — join, rejoin, and disconnect.
// Disconnected players stay listed (marked away) rather than vanishing.
socket.on('players-update', ({ allPlayers: players, scores }) => {
  allPlayers = players;
  if (scores) currentScores = scores;
  document.getElementById('player-count').textContent = players.length;
  renderPlayerGroups();
});

function renderPlayerGroups() {
  const container = document.getElementById('player-groups');
  container.innerHTML = '';
  currentScores.forEach((team, i) => {
    const members = allPlayers.filter(p => p.teamIndex === i);
    const list = members.length
      ? members.map(p => `<span${p.connected === false ? ' style="opacity:0.45"' : ''}>${escapeHtml(p.name)}${p.connected === false ? ' (away)' : ''}</span>`).join(', ')
      : 'No players yet';
    const div = document.createElement('div');
    div.className = 'player-group';
    div.innerHTML = `
      <div class="player-group-header" style="color:${team.color}">${escapeHtml(team.name)}</div>
      <div class="player-group-members">${list}</div>
    `;
    container.appendChild(div);
  });
}

document.getElementById('btn-start-game').addEventListener('click', () => socket.emit('start-question'));
document.getElementById('btn-end-game-lobby').addEventListener('click', () => {
  if (confirm('End the game now?')) socket.emit('end-game');
});

// ── Team bar ───────────────────────────────────────────────────
function renderTeamsBar() {
  const bar = document.getElementById('ff-teams-bar');
  bar.innerHTML = '';
  currentScores.forEach((team, i) => {
    const isGold = team.color === '#FFD60A';
    let badge = '';
    let cls = 'ff-team-card';

    if (phase === 'faceoff' || phase === 'faceoff-judging' || phase === 'faceoff-counter') {
      badge = '<div class="ff-team-badge-label">FACE-OFF</div>';
      if (phase === 'faceoff-counter' && i === counterTeamIndex) {
        badge = '<div class="ff-team-badge-label">COUNTER</div>';
        cls += ' active-team';
      } else if (phase === 'faceoff-judging' && faceoffBuzzer && i === faceoffBuzzer.teamIndex) {
        badge = '<div class="ff-team-badge-label">BUZZED</div>';
        cls += ' active-team';
      }
    } else if (phase === 'play-or-pass' && i === faceoffWinnerTeamIndex) {
      badge = '<div class="ff-team-badge-label">WON FACE-OFF</div>';
      cls += ' active-team';
    } else if (phase === 'team-play' && i === controllingTeamIndex) {
      badge = '<div class="ff-team-badge-label">PLAYING</div>';
      cls += ' active-team';
    } else if (phase === 'steal' && i === stealTeamIndex) {
      badge = '<div class="ff-team-badge-label steal-badge">STEAL!</div>';
      cls += ' steal-team';
    }

    const card = document.createElement('div');
    card.className = cls;
    card.style.cssText = `background:${team.color};color:${isGold ? '#111' : '#fff'}`;
    card.innerHTML = `
      ${badge}
      <div class="ff-team-name-label">${escapeHtml(team.name)}</div>
      <div class="ff-team-score-num">${team.score}</div>
    `;
    bar.appendChild(card);
  });
}

// ── Board (mirrors what players see) ───────────────────────────
function buildBoard(count) {
  const board = document.getElementById('ff-board');
  board.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const tile = document.createElement('div');
    tile.className = 'ff-tile';
    tile.id = `tile-${i}`;
    tile.innerHTML = `
      <div class="ff-tile-inner">
        <div class="ff-tile-front">${i + 1}</div>
        <div class="ff-tile-back">
          <span class="ff-answer-text" id="tile-text-${i}"></span>
          <span class="ff-answer-pts"  id="tile-pts-${i}"></span>
        </div>
      </div>
    `;
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

// ── Answer key (host only — text + points visible from round start) ──
function buildAnswerKey() {
  const key = document.getElementById('ff-answer-key');
  key.innerHTML = '';
  answers.forEach((a, i) => {
    const row = document.createElement('div');
    row.className = 'ff-key-row';
    row.id = `key-row-${i}`;
    row.innerHTML = `
      <div class="ff-key-rank">#${i + 1}</div>
      <div class="ff-key-text">${escapeHtml(a.t)}</div>
      <div class="ff-key-pts">${a.p}</div>
      <button class="btn-key-reveal" id="key-btn-${i}">Reveal</button>
    `;
    row.querySelector(`#key-btn-${i}`).addEventListener('click', () => {
      socket.emit('reveal-answer', { answerIndex: i });
    });
    key.appendChild(row);
  });
  refreshKeyButtons();
}

function markKeyRevealed(index, teamIndex) {
  const row = document.getElementById(`key-row-${index}`);
  if (!row) return;
  row.classList.add('revealed');
  const btn = document.getElementById(`key-btn-${index}`);
  if (btn) {
    const chip = document.createElement('div');
    chip.className = 'ff-key-got';
    if (teamIndex == null) {
      chip.style.background = 'rgba(255,255,255,0.15)';
      chip.textContent = 'Not said';
    } else {
      const team = currentScores[teamIndex];
      const isGold = team.color === '#FFD60A';
      chip.style.background = team.color;
      chip.style.color = isGold ? '#111' : '#fff';
      chip.textContent = team.name;
    }
    btn.replaceWith(chip);
  }
}

// One place decides which controls are live — so a mid-game reconnect
// can never leave the host with a stuck button.
const REVEAL_PHASES = ['faceoff-judging', 'faceoff-counter', 'team-play', 'steal', 'round-over'];

function refreshKeyButtons() {
  const canReveal = REVEAL_PHASES.includes(phase);
  answers.forEach((_, i) => {
    const btn = document.getElementById(`key-btn-${i}`);
    if (!btn) return;                       // already revealed → replaced by a chip
    btn.disabled = !canReveal;
    btn.textContent = phase === 'round-over' ? 'Show' : 'Reveal';
  });
}

const WRONG_LABELS = {
  'faceoff-judging': 'Not on the Board ❌',
  'faceoff-counter': 'Not on the Board ❌',
  'team-play':       'Strike ❌',
  'steal':           'Steal Failed ❌'
};

function setPhase(p) {
  phase = p;
  const wrongBtn = document.getElementById('btn-wrong');
  const label = WRONG_LABELS[p];
  wrongBtn.disabled = !label;
  wrongBtn.textContent = label || 'Not on the Board ❌';

  const endRoundBtn = document.getElementById('btn-end-round');
  endRoundBtn.disabled = ['lobby', 'round-over', 'game-over'].includes(p);

  document.getElementById('ff-pop-row').style.display = p === 'play-or-pass' ? 'flex' : 'none';

  refreshKeyButtons();
  renderTeamsBar();
}

// ── Status strip ───────────────────────────────────────────────
function setStatus(main, sub, color) {
  document.getElementById('ff-status-main').innerHTML = main;
  document.getElementById('ff-status-sub').textContent = sub || '';
  const strip = document.getElementById('ff-status');
  strip.style.borderColor = color || 'rgba(255,255,255,0.1)';
  strip.style.background  = color ? `${color}22` : 'rgba(255,255,255,0.05)';
}

function setPot(p) {
  pot = p || 0;
  document.getElementById('ff-pot').textContent = `Round pot: ${pot}`;
}

function renderStrikes(n) {
  document.getElementById('ff-strikes').textContent = '❌'.repeat(n || 0);
}

// ── Question start ─────────────────────────────────────────────
socket.on('question-start', (d) => {
  Sounds.wordReveal();
  answers = d.answers || [];       // host-only payload
  answerCount = d.answerCount;
  revealedIndices = [];
  revealedBy = {};
  faceoffBuzzer = null;
  counterTeamIndex = null;
  firstAnswer = null;
  faceoffWinnerTeamIndex = null;
  controllingTeamIndex = null;
  stealTeamIndex = null;
  if (d.scores) currentScores = d.scores;

  document.getElementById('ff-question').textContent = d.question;
  buildBoard(answerCount);
  buildAnswerKey();
  renderStrikes(0);
  setPot(0);
  showScreen('screen-game');
});

socket.on('faceoff-open', ({ rebuzz }) => {
  Sounds.go();
  faceoffBuzzer = null;
  setPhase('faceoff');
  setStatus(
    '🔔 FACE-OFF — waiting for a buzz…',
    rebuzz ? 'Both teams missed — buzzers are open again' : 'Everyone can buzz. First in gets to answer.'
  );
});

socket.on('faceoff-buzz', ({ playerName, teamIndex, teamName, teamColor }) => {
  Sounds.buzz();
  faceoffBuzzer = { playerName, teamIndex, teamName, teamColor };
  setPhase('faceoff-judging');
  setStatus(
    `<span class="ff-status-buzzer-dot" style="background:${teamColor}"></span><strong>${escapeHtml(playerName)}</strong> buzzed first &nbsp;·&nbsp; ${escapeHtml(teamName)}`,
    'Judge their answer: hit Reveal on the matching row, or Not on the Board',
    teamColor
  );
});

socket.on('faceoff-counter', ({ counterTeamIndex: ct, counterTeamName, counterTeamColor, firstAnswer: fa }) => {
  counterTeamIndex = ct;
  firstAnswer = fa;
  setPhase('faceoff-counter');
  const context = fa.answerIndex === null
    ? 'The first team missed — any answer wins them the face-off'
    : `First answer was #${fa.answerIndex + 1} (${answers[fa.answerIndex].p} pts) — they must beat it`;
  setStatus(
    `<strong>${escapeHtml(counterTeamName)}</strong>'s counter — ONE answer`,
    context,
    counterTeamColor
  );
});

socket.on('faceoff-won', ({ winnerTeamIndex, winnerTeamName, winnerTeamColor }) => {
  Sounds.pointAwarded();
  faceoffWinnerTeamIndex = winnerTeamIndex;
  setPhase('play-or-pass');
  setStatus(
    `<strong>${escapeHtml(winnerTeamName)}</strong> won the face-off!`,
    'Ask them: play the board, or pass it to the other team?',
    winnerTeamColor
  );
});

document.getElementById('btn-play').addEventListener('click', () => socket.emit('choose-play-or-pass', { choice: 'play' }));
document.getElementById('btn-pass').addEventListener('click', () => socket.emit('choose-play-or-pass', { choice: 'pass' }));

socket.on('team-play-start', ({ controllingTeamIndex: c, teamName, teamColor, choice }) => {
  Sounds.go();
  controllingTeamIndex = c;
  renderStrikes(0);
  setPhase('team-play');
  setStatus(
    `<strong>${escapeHtml(teamName)}</strong> is playing the board`,
    choice === 'pass'
      ? 'They were passed the board. Ask each player in turn.'
      : 'Ask each player in turn — 3 strikes and the other team can steal.',
    teamColor
  );
});

socket.on('answer-revealed', ({ answerIndex, text, pts, pot: newPot, teamIndex, context }) => {
  Sounds.pointAwarded();
  revealedIndices.push(answerIndex);
  revealedBy[answerIndex] = teamIndex;
  flipTile(answerIndex, text, pts);
  setPot(newPot);
  if (context === 'cleanup') {
    updateRoundOverTile(answerIndex, text, pts);
  } else {
    markKeyRevealed(answerIndex, teamIndex);
  }
});

socket.on('wrong-answer', ({ strikes }) => {
  Sounds.noPoint();
  renderStrikes(strikes);
});

socket.on('faceoff-miss', () => {
  Sounds.noPoint();
});

socket.on('steal-mode', ({ stealTeamIndex: st, stealTeamName, stealTeamColor, pot: p }) => {
  Sounds.timeUp();
  stealTeamIndex = st;
  setPot(p);
  setPhase('steal');
  setStatus(
    `🚨 <strong>${escapeHtml(stealTeamName)}</strong> can STEAL ${p} points`,
    'They confer and give ONE answer. Right = they take the pot. Wrong = the other team keeps it.',
    '#FF9500'
  );
});

document.getElementById('btn-wrong').addEventListener('click', () => socket.emit('host-wrong'));
document.getElementById('btn-end-round').addEventListener('click', () => {
  const scrapped = ['faceoff', 'faceoff-judging', 'faceoff-counter'].includes(phase);
  const msg = scrapped
    ? 'End this round now? No points will be awarded — the round is scrapped.'
    : 'End this round now? The playing team banks the current pot.';
  if (confirm(msg)) socket.emit('end-round');
});
document.getElementById('btn-end-game-game').addEventListener('click', () => {
  if (confirm('End the game now?')) socket.emit('end-game');
});

// ── Round over ─────────────────────────────────────────────────
socket.on('round-complete', (rc) => {
  if (rc.winnerTeamIndex != null) Sounds.pointAwarded(); else Sounds.noPoint();
  currentScores = rc.scores;
  setPhase('round-over');

  const badge = document.getElementById('ro-winner-badge');
  if (rc.winnerTeamIndex != null) {
    const isGold = rc.winnerTeamColor === '#FFD60A';
    badge.textContent = rc.winnerTeamName;
    badge.style.cssText = `background:${rc.winnerTeamColor};color:${isGold ? '#111' : '#fff'}`;
  } else {
    badge.textContent = 'No winner';
    badge.style.cssText = 'background:rgba(255,255,255,0.1);color:#fff';
  }

  const reasons = {
    'board-clear':  `Cleared the whole board — ${rc.pot} points banked!`,
    'steal':        `STOLEN! ${rc.winnerTeamName} takes all ${rc.pot} points`,
    'steal-failed': `Steal failed — ${rc.winnerTeamName} keeps ${rc.pot} points`,
    'host-ended':   rc.winnerTeamIndex != null
      ? `Round ended — ${rc.winnerTeamName} banks ${rc.pot} points`
      : 'Round scrapped — no points awarded'
  };
  document.getElementById('ro-points-gained').textContent = reasons[rc.reason] || `${rc.pot} points`;

  renderRoundOverBoard(rc.revealed || [], rc.answerCount);
  renderScoreCards('ro-scores', rc.scores);
  showScreen('screen-round-over');
});

// Revealed answers show; the rest get a Show button so the host can flip
// them for the room ("let's see what else was up there").
function renderRoundOverBoard(revealed, count) {
  const board = document.getElementById('ro-reveal-board');
  board.innerHTML = '';
  const byIndex = new Map(revealed.map(r => [r.index, r]));
  for (let i = 0; i < (count || answerCount); i++) {
    const r = byIndex.get(i);
    const tile = document.createElement('div');
    tile.id = `ro-tile-${i}`;
    if (r) {
      tile.className = 'ff-ro-tile';
      tile.innerHTML = `<span class="ff-ro-tile-text">${escapeHtml(r.text)}</span><span class="ff-ro-tile-pts">${r.pts}</span>`;
    } else {
      // Host still sees the answer text (they always do) — the Show button
      // is what reveals it on everyone else's screen.
      tile.className = 'ff-ro-tile hidden-tile';
      tile.innerHTML = `
        <span class="ff-ro-tile-text">${escapeHtml(answers[i] ? answers[i].t : '???')}</span>
        <button class="btn-ro-show" id="ro-show-${i}">Show</button>
      `;
      const btn = tile.querySelector(`#ro-show-${i}`);
      if (btn) btn.addEventListener('click', () => socket.emit('reveal-answer', { answerIndex: i }));
    }
    board.appendChild(tile);
  }
}

function updateRoundOverTile(index, text, pts) {
  const tile = document.getElementById(`ro-tile-${index}`);
  if (!tile) return;
  tile.className = 'ff-ro-tile';
  tile.innerHTML = `<span class="ff-ro-tile-text">${escapeHtml(text)}</span><span class="ff-ro-tile-pts">${pts}</span>`;
}

document.getElementById('btn-next-question').addEventListener('click', () => socket.emit('start-question'));
document.getElementById('btn-end-game-roundover').addEventListener('click', () => {
  if (confirm('End the game now?')) socket.emit('end-game');
});

// ── Game over ──────────────────────────────────────────────────
socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
  setPhase('game-over');
  renderLeaderboard('final-leaderboard', scores);
  showScreen('screen-game-over');
  if (TOURNEY) setTimeout(() => { location.href = `/games/tournament/host.html?room=${TOURNEY.t}`; }, 3500);
});

// ── Helpers ────────────────────────────────────────────────────
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
