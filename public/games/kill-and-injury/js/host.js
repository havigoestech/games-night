const socket = io('/kill-and-injury');

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
let codeLength = 4;
let selectedLen = 4;
let selectedSeconds = 60;
let boards = [[], []];
let locked = [false, false];

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

// ── Setup — always exactly two sides ───────────────────────────
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

function bindSelector(containerId, onSelect) {
  document.querySelectorAll(`#${containerId} .opt-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${containerId} .opt-btn`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(btn);
    });
  });
}
bindSelector('len-selector', b => { selectedLen = parseInt(b.dataset.len); });
bindSelector('timer-selector', b => { selectedSeconds = parseInt(b.dataset.seconds); });

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
  socket.emit('create-room', {
    teamNames,
    codeLength: selectedLen,
    roundSeconds: selectedSeconds,
    baseUrl: `${location.protocol}//${location.host}`
  });

  setTimeout(() => { btn.textContent = 'Create Room'; btn.disabled = false; dbg(''); }, 8000);
});

// ── Lobby ──────────────────────────────────────────────────────
socket.on('room-created', ({ roomCode, joinUrl, localIP, port, teams, codeLength: len }) => {
  document.getElementById('btn-create').textContent = 'Create Room';
  document.getElementById('btn-create').disabled = false;
  dbg('');

  codeLength = len;
  currentScores = teams.map((t, i) => ({ index: i, name: t.name, color: t.color, score: 0 }));
  allPlayers = [];

  document.getElementById('lobby-room-code').textContent = roomCode;
  document.getElementById('lobby-join-url').textContent = joinUrl;
  const ipEl = document.getElementById('lobby-player-address');
  if (ipEl) ipEl.innerHTML = `Players go to: <strong>http://${localIP}:${port}</strong>`;
  document.getElementById('codes-hint').textContent =
    `${len} digits, all different — on their own phones.`;

  renderPlayerGroups();
  showScreen('screen-lobby');
});

// Tournament: adopt the pre-created room, hide the join code/QR, just start.
socket.on('host-attached', (data) => {
  codeLength = data.codeLength || 4;
  currentScores = (data.teams || []).map((t, i) => ({ index: i, name: t.name, color: t.color, score: 0 }));
  allPlayers = [];
  const codeSec = document.querySelector('#screen-lobby .lobby-code-section');
  if (codeSec) codeSec.style.display = 'none';
  document.getElementById('codes-hint').textContent = `${codeLength} digits, all different — on their own phones.`;
  const startBtn = document.getElementById('btn-start-codes');
  if (startBtn) startBtn.textContent = `Set The Codes (best of ${data.tournamentLength})`;
  // The host needs a way out of a game they'd rather not play: ending it here
  // concludes 0-0 (a tie) and the tournament moves on to the next game.
  const endBtn = document.getElementById('btn-end-game-lobby');
  if (endBtn) endBtn.style.display = 'block';
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

document.getElementById('btn-start-codes').addEventListener('click', () => socket.emit('start-codes'));
document.getElementById('btn-next-match').addEventListener('click', () => socket.emit('start-codes'));
document.getElementById('btn-start-match').addEventListener('click', () => socket.emit('start-match'));
document.getElementById('btn-end-match').addEventListener('click', () => {
  if (confirm('End this match now? Nobody scores.')) socket.emit('end-match');
});
['btn-end-game-lobby', 'btn-end-game-codes', 'btn-end-game'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => { if (confirm('End the game now?')) socket.emit('end-game'); });
});

// ── Code phase — the host sees ticks, never the codes ──────────
socket.on('code-phase', ({ codeLength: len, scores }) => {
  Sounds.wordReveal();
  codeLength = len;
  if (scores) currentScores = scores;
  document.getElementById('codes-hint').textContent = `${len} digits, all different — on their own phones.`;
  renderReady([false, false]);
  document.getElementById('btn-start-match').disabled = true;
  showScreen('screen-codes');
});

socket.on('code-status', ({ ready }) => {
  renderReady(ready);
  const both = ready[0] && ready[1];
  document.getElementById('btn-start-match').disabled = !both;
  if (both) Sounds.go();
});

function renderReady(ready) {
  const row = document.getElementById('ready-row');
  row.innerHTML = '';
  currentScores.forEach((team, i) => {
    const isReady = !!ready[i];
    const card = document.createElement('div');
    card.className = 'ready-card' + (isReady ? ' ready' : '');
    card.innerHTML = `
      <div class="nm" style="color:${team.color}">${escapeHtml(team.name)}</div>
      <div class="dots">${isReady ? '✓' : '• • • •'}</div>
      <div class="st">${isReady ? 'CODE LOCKED IN' : 'still deciding...'}</div>
    `;
    row.appendChild(card);
  });
}

// ── Match — the TV. Both boards, neither code. ─────────────────
socket.on('match-start', ({ codeLength: len, scores }) => {
  codeLength = len;
  if (scores) currentScores = scores;
  boards = [[], []];
  locked = [false, false];
  renderBoards();
  showScreen('screen-match');
});

socket.on('round-start', ({ round, secondsLeft, maxRounds }) => {
  Sounds.go();
  document.getElementById('m-round').textContent = `Round ${round} of ${maxRounds}`;
  renderTimer(secondsLeft);
  locked = [false, false];
  document.getElementById('one-away').classList.remove('visible');
  renderBoards();
  showScreen('screen-match');
});

function renderTimer(secs) {
  const el = document.getElementById('m-timer');
  const m = Math.floor(secs / 60), s = secs % 60;
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.className = 'm-timer' + (secs <= 10 ? ' danger' : secs <= 20 ? ' warning' : '');
}

socket.on('timer', ({ secondsLeft }) => {
  if (secondsLeft <= 10 && secondsLeft > 0) Sounds.tick(secondsLeft <= 5);
  if (secondsLeft === 0) Sounds.timeUp();
  renderTimer(secondsLeft);
});

// A side committing — everyone sees THAT, never WHAT.
socket.on('guess-locked', ({ teamIndex }) => {
  Sounds.tick(false);
  locked[teamIndex] = true;
  renderBoards();
});

socket.on('round-result', ({ results, boards: b, closeCall, cracked }) => {
  boards = b;
  locked = [false, false];
  renderBoards();

  if (cracked.some(Boolean)) {
    Sounds.gameOver();
  } else if (closeCall.some(Boolean)) {
    Sounds.timeUp();
    const who = closeCall[0] ? currentScores[0] : currentScores[1];
    const el = document.getElementById('one-away');
    el.textContent = `🔥 ${who.name.toUpperCase()} ARE ONE AWAY!`;
    el.classList.add('visible');
  } else {
    Sounds.pointAwarded();
  }
});

function renderBoards() {
  const container = document.getElementById('boards');
  container.innerHTML = '';
  currentScores.forEach((team, i) => {
    const opp = currentScores[1 - i];
    const wrap = document.createElement('div');
    wrap.className = 'board';

    const rows = (boards[i] || []).map(r => {
      if (r.forfeit) {
        return `<div class="brow forfeit">
          <span class="n">${r.round}</span><span class="g">— no guess —</span><span></span><span></span>
        </div>`;
      }
      const crack = r.kills === codeLength;
      const close = r.kills === codeLength - 1;
      return `<div class="brow${crack ? ' crack' : close ? ' close' : ''}">
        <span class="n">${r.round}</span>
        <span class="g">${escapeHtml(r.guess)}</span>
        <span class="k">${r.kills} ${r.kills === 1 ? 'kill' : 'kills'}</span>
        <span class="i">${r.injuries} ${r.injuries === 1 ? 'injury' : 'injuries'}</span>
      </div>`;
    }).join('');

    wrap.innerHTML = `
      <div class="board-head" style="border-color:${team.color};background:${team.color}22">
        <span class="board-name" style="color:${team.color}">${escapeHtml(team.name)}</span>
        <span class="board-lock${locked[i] ? ' locked' : ''}">${locked[i] ? '🔒 LOCKED IN' : 'thinking…'}</span>
      </div>
      <div class="board-body" style="border-color:${team.color}">
        ${rows || `<div class="board-empty">cracking ${escapeHtml(opp.name)}'s code…</div>`}
      </div>
    `;
    container.appendChild(wrap);
  });
}

// ── Match over — the reveal ────────────────────────────────────
socket.on('match-over', ({ reason, winnerTeamIndex, rounds, points, secrets, boards: b, scores }) => {
  Sounds.gameOver();
  currentScores = scores;
  boards = b;

  document.getElementById('over-emoji').textContent =
    reason === 'draw' ? '🤝' : reason === 'stalemate' ? '😐' : winnerTeamIndex != null ? '🎉' : '🛑';

  const h = document.getElementById('over-headline');
  if (reason === 'draw') {
    h.textContent = `🤝 A DRAW — both sides cracked it in round ${rounds}!`;
  } else if (reason === 'cracked' && winnerTeamIndex != null) {
    const w = scores[winnerTeamIndex];
    h.innerHTML = `<span style="color:${w.color}">${escapeHtml(w.name)}</span> cracked the code in ${rounds} rounds — +${points[winnerTeamIndex]}`;
  } else if (reason === 'stalemate') {
    h.textContent = `Nobody cracked it in ${rounds} rounds. No points.`;
  } else {
    h.textContent = 'Match ended by the host — no points.';
  }

  const row = document.getElementById('reveal-row');
  row.innerHTML = '';
  (secrets || []).forEach((code, i) => {
    const team = scores[i];
    const card = document.createElement('div');
    card.className = 'reveal-card';
    card.style.cssText = `background:${team.color}22;border:2px solid ${team.color}`;
    card.innerHTML = `
      <div class="lbl" style="color:${team.color}">${escapeHtml(team.name)}</div>
      <div class="code" style="color:${team.color}">${escapeHtml(code || '----')}</div>
    `;
    row.appendChild(card);
  });

  renderScoreCards('over-scores', scores);
  document.getElementById('lobby-scores-section').style.display = 'block';
  renderScoreCards('lobby-scores', scores);
  document.getElementById('btn-end-game-lobby').style.display = 'block';

  showScreen('screen-over');
});

// ── Game over ──────────────────────────────────────────────────
socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
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
