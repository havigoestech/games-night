const socket = io('/text-twist');

const TEAM_COLORS = ['#FF2D55','#5856D6','#FF9500','#34C759','#00C7BE','#FF375F','#BF5AF2','#FFD60A'];

let teamCount = 2;
let allPlayers = [];
let currentScores = [];
let selectedMode = 'teams';
let selectedDifficulty = 'medium';
let selectedSeconds = 120;
let nextDifficulty = 'medium';
let totalWords = 0;
let letters = '';

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

// ── Setup ──────────────────────────────────────────────────────
const countDisplay = document.getElementById('team-count-display');
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
renderTeamInputs();

document.getElementById('count-down').addEventListener('click', () => {
  if (teamCount > 2) { teamCount--; countDisplay.textContent = teamCount; renderTeamInputs(); }
});
document.getElementById('count-up').addEventListener('click', () => {
  if (teamCount < 8) { teamCount++; countDisplay.textContent = teamCount; renderTeamInputs(); }
});

function bindSelector(containerId, onSelect) {
  document.querySelectorAll(`#${containerId} .opt-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${containerId} .opt-btn`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(btn);
    });
  });
}

bindSelector('mode-selector', b => {
  selectedMode = b.dataset.mode;
  document.getElementById('teams-setup').style.display = selectedMode === 'individual' ? 'none' : 'flex';
});
bindSelector('difficulty-selector', b => {
  selectedDifficulty = b.dataset.difficulty;
  nextDifficulty = selectedDifficulty;
  syncDifficultyPickers();
});
bindSelector('timer-selector', b => { selectedSeconds = parseInt(b.dataset.seconds); });

// The lobby and round-over screens each carry a difficulty picker, so the host
// can crank it up mid-game. Keep them in step with each other.
['lobby-difficulty', 'ro-difficulty'].forEach(id =>
  bindSelector(id, b => { nextDifficulty = b.dataset.difficulty; syncDifficultyPickers(); })
);

function syncDifficultyPickers() {
  ['lobby-difficulty', 'ro-difficulty'].forEach(id => {
    document.querySelectorAll(`#${id} .opt-btn`).forEach(b => {
      b.classList.toggle('active', b.dataset.difficulty === nextDifficulty);
    });
  });
}

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
    mode: selectedMode,
    teamCount,
    teamNames,
    difficulty: selectedDifficulty,
    roundSeconds: selectedSeconds,
    baseUrl: `${location.protocol}//${location.host}`
  });

  setTimeout(() => { btn.textContent = 'Create Room'; btn.disabled = false; dbg(''); }, 8000);
});

// ── Lobby ──────────────────────────────────────────────────────
socket.on('room-created', ({ roomCode, joinUrl, localIP, port, teams, difficulty }) => {
  document.getElementById('btn-create').textContent = 'Create Room';
  document.getElementById('btn-create').disabled = false;
  dbg('');

  currentScores = teams.map((t, i) => ({ index: i, name: t.name, color: t.color, score: 0 }));
  allPlayers = [];
  nextDifficulty = difficulty;
  syncDifficultyPickers();

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

socket.on('create-room-error', ({ message }) => {
  document.getElementById('btn-create').textContent = 'Create Room';
  document.getElementById('btn-create').disabled = false;
  dbg('Error: ' + message);
});

socket.on('players-update', ({ allPlayers: players, scores }) => {
  allPlayers = players;
  if (scores) currentScores = scores;
  document.getElementById('player-count').textContent = players.length;
  renderPlayerGroups();
});

function renderPlayerGroups() {
  const container = document.getElementById('player-groups');
  container.innerHTML = '';
  const member = p =>
    `<span${p.connected === false ? ' style="opacity:0.45"' : ''}>${escapeHtml(p.name)}${p.connected === false ? ' (away)' : ''}</span>`;

  if (selectedMode === 'individual') {
    const div = document.createElement('div');
    div.className = 'player-group';
    div.innerHTML = `
      <div class="player-group-header" style="color:#00C7BE">Players</div>
      <div class="player-group-members">${allPlayers.length ? allPlayers.map(member).join(', ') : 'No players yet — scan the QR to join'}</div>
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
      <div class="player-group-members">${members.length ? members.map(member).join(', ') : 'No players yet'}</div>
    `;
    container.appendChild(div);
  });
}

document.getElementById('btn-start-round').addEventListener('click',
  () => socket.emit('start-round', { difficulty: nextDifficulty }));
document.getElementById('btn-next-round').addEventListener('click',
  () => socket.emit('start-round', { difficulty: nextDifficulty }));
document.getElementById('btn-end-round').addEventListener('click', () => {
  if (confirm('End this round now?')) socket.emit('end-round');
});
[['btn-end-game-lobby'], ['btn-end-game']].forEach(([id]) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => { if (confirm('End the game now?')) socket.emit('end-game'); });
});

// ── Round (the TV: letters, clock, progress — never a word) ────
socket.on('round-start', (d) => {
  Sounds.wordReveal();
  letters = d.letters;
  totalWords = d.totalWords;
  currentScores = d.scores;

  renderRack(letters);
  renderTimer(d.secondsLeft);
  document.getElementById('tt-meta').textContent =
    `Round ${d.round} · ${d.difficulty.toUpperCase()} · ${d.totalWords} words hidden in these letters`;
  progKey = '';                 // fresh rows — don't animate out of last round's order
  renderProgress(d.progress);
  showScreen('screen-round');
});

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

function renderTimer(secs) {
  const el = document.getElementById('tt-timer');
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.className = 'tt-timer-big' + (secs <= 10 ? ' danger' : secs <= 30 ? ' warning' : '');
}

socket.on('timer', ({ secondsLeft }) => {
  if (secondsLeft <= 10 && secondsLeft > 0) Sounds.tick(secondsLeft <= 5);
  if (secondsLeft === 0) Sounds.timeUp();
  renderTimer(secondsLeft);
});

// Counts and points only — the room can read this screen, so it must never
// carry word text or the teams would just copy each other.
socket.on('team-progress', ({ progress }) => renderProgress(progress));

// Rows are created once and then kept — re-sorting reuses the same elements so
// they can be animated between positions. Rebuilding the list every tick (the
// obvious approach) would make overtakes teleport instead of glide.
let progRows = new Map();
let progKey = '';

function buildProgressRows(progress) {
  const container = document.getElementById('tt-progress');
  container.innerHTML = '';
  progRows = new Map();
  progress.forEach(p => {
    const team = currentScores[p.teamIndex];
    if (!team) return;
    const row = document.createElement('div');
    row.className = 'tt-prog-row';
    row.innerHTML = `
      <div class="tt-prog-rank">–</div>
      <div class="tt-prog-name" style="color:${team.color}">${escapeHtml(team.name)}</div>
      <div class="tt-prog-bar"><div class="tt-prog-fill" style="width:0%;background:${team.color}"></div></div>
      <div class="tt-prog-count">0/${p.total}</div>
      <div class="tt-prog-pts" style="color:${team.color}">0</div>
    `;
    container.appendChild(row);
    progRows.set(p.teamIndex, row);
  });
}

function renderProgress(progress) {
  const container = document.getElementById('tt-progress');
  if (!container || !progress || !progress.length) return;

  // Roster changed (e.g. a latecomer joined an individuals game) → start fresh.
  const key = progress.map(p => p.teamIndex).join(',');
  if (key !== progKey) {
    progKey = key;
    buildProgressRows(progress);
  }

  // FIRST — where does every row sit right now?
  const before = new Map();
  progRows.forEach((row, ti) => before.set(ti, row.getBoundingClientRect().top));

  // Update each row's numbers in place.
  progress.forEach(p => {
    const row = progRows.get(p.teamIndex);
    if (!row) return;
    const pct = p.total ? Math.round((p.wordCount / p.total) * 100) : 0;
    row.querySelector('.tt-prog-fill').style.width = pct + '%';
    row.querySelector('.tt-prog-count').textContent = `${p.wordCount}/${p.total}`;
    row.querySelector('.tt-prog-pts').textContent = p.points;
  });

  // Points decide the winner, so points decide the order. Word count breaks ties.
  const ranked = [...progress].sort((a, b) =>
    b.points - a.points || b.wordCount - a.wordCount || a.teamIndex - b.teamIndex);

  // LAST — re-append in rank order, which moves the rows.
  const scoring = ranked.some(p => p.points > 0);
  ranked.forEach((p, i) => {
    const row = progRows.get(p.teamIndex);
    if (!row) return;
    row.querySelector('.tt-prog-rank').textContent = scoring ? (i + 1) : '–';
    row.classList.toggle('leader', scoring && i === 0);
    container.appendChild(row);
  });

  // INVERT + PLAY — snap each row back to where it was, then let it slide to
  // its new home. This is what you actually see as "overtaking".
  progRows.forEach((row, ti) => {
    const delta = before.get(ti) - row.getBoundingClientRect().top;
    if (!delta) return;
    row.style.transition = 'none';
    row.style.transform = `translateY(${delta}px)`;
    if (delta > 0) {                       // moved up the board — flash it
      row.classList.remove('climbing');
      void row.offsetWidth;
      row.classList.add('climbing');
    }
    requestAnimationFrame(() => {
      row.style.transition = 'transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)';
      row.style.transform = '';
    });
  });
}

socket.on('board-cleared', ({ teamName }) => {
  Sounds.pointAwarded();
  document.getElementById('tt-meta').textContent = `🎉 ${teamName} cleared the board!`;
});

// ── Round over — the only moment word text goes on screen ──────
socket.on('round-complete', ({ reason, winnerTeamIndex, bonus, topWord, allWords, roundPoints, scores }) => {
  Sounds.pointAwarded();
  currentScores = scores;

  const headline = document.getElementById('ro-headline');
  if (reason === 'board-clear') {
    headline.innerHTML = `🎉 <span style="color:${scores[winnerTeamIndex].color}">${escapeHtml(scores[winnerTeamIndex].name)}</span> cleared the board! +${bonus} bonus`;
  } else if (reason === 'timer') {
    headline.textContent = "⏰ Time's up!";
  } else {
    headline.textContent = '🛑 Round ended';
  }

  document.getElementById('ro-topword').textContent = topWord;

  // Scores with this round's haul appended
  const grid = document.getElementById('ro-scores');
  grid.innerHTML = '';
  scores.forEach((s, i) => {
    const isGold = s.color === '#FFD60A';
    const card = document.createElement('div');
    card.className = 'score-card';
    card.style.cssText = `background:${s.color};color:${isGold ? '#111' : '#fff'}`;
    card.innerHTML = `
      <div class="team-name">${escapeHtml(s.name)}</div>
      <div class="score-num">${s.score}</div>
      <div style="font-size:0.7rem;font-weight:700;opacity:0.8">+${roundPoints[i] || 0} this round</div>
    `;
    grid.appendChild(card);
  });

  // Every word, grouped by length, tagged with who found it
  const groups = document.getElementById('ro-groups');
  groups.innerHTML = '';
  const byLen = new Map();
  allWords.forEach(w => {
    if (!byLen.has(w.length)) byLen.set(w.length, []);
    byLen.get(w.length).push(w);
  });
  // How many teams/individuals are in play decides how we show attribution:
  // dots don't scale (and the palette only has 8 colours), so past 6 we switch
  // to an "X/N found" count — which for a big group is the more useful view
  // anyway, showing at a glance which words were easy vs obscure.
  const N = scores.length;
  const useDots = N <= 6;

  [...byLen.keys()].sort((a, b) => b - a).forEach(len => {
    const words = byLen.get(len).sort((a, b) => a.word.localeCompare(b.word));
    const wrap = document.createElement('div');
    wrap.className = 'ro-len-group';
    const chips = words.map(w => {
      const found = w.foundBy.length;
      let tail;
      if (found === 0) {
        tail = '<span class="ro-nobody">MISSED</span>';
      } else if (useDots) {
        tail = w.foundBy.map(ti =>
          `<span class="ro-dot" style="background:${currentScores[ti] ? currentScores[ti].color : '#fff'}" title="${escapeHtml(currentScores[ti] ? currentScores[ti].name : '')}"></span>`
        ).join('');
      } else {
        const pct = Math.round((found / N) * 100);
        tail = `<span class="ro-count" style="background:linear-gradient(90deg, rgba(52,199,89,0.55) ${pct}%, rgba(255,255,255,0.08) ${pct}%)">${found}/${N}</span>`;
      }
      return `<div class="ro-word${found ? ' found' : ''}${w.isTopWord ? ' top' : ''}">
        <span>${escapeHtml(w.word)}</span><span class="pts">${w.pts}</span>${tail}
      </div>`;
    }).join('');
    wrap.innerHTML = `
      <div class="ro-len-label">${len} letters${len === letters.length ? ' — top word' : ''}</div>
      <div class="ro-words">${chips}</div>
    `;
    groups.appendChild(wrap);
  });

  document.getElementById('lobby-scores-section').style.display = 'block';
  renderScoreCards('lobby-scores', scores);
  document.getElementById('btn-end-game-lobby').style.display = 'block';

  showScreen('screen-round-over');
});

// ── Game over ──────────────────────────────────────────────────
socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
  renderLeaderboard('final-leaderboard', scores);
  showScreen('screen-game-over');
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
