const socket = io('/trivia');

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
let teamMode = 'teams';
let categories = [];
let currentScores = [];
let allPlayers = [];
let playlist = [{ mode: 'fastest-finger', category: 'any', difficulty: 'any', count: 5, seconds: 20 }];

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function dbg(m) { const el = document.getElementById('debug-log'); if (el) el.textContent = m; }

socket.on('connect', () => socket.emit('get-meta'));
socket.on('trivia-meta', ({ categories: cats }) => { categories = cats || []; renderPlaylist(); });

// ── Setup: teams/solo toggle ──
document.querySelectorAll('#seg-mode button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#seg-mode button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  teamMode = b.dataset.mode;
  document.getElementById('teams-setup').style.display = teamMode === 'teams' ? 'block' : 'none';
}));

// ── Team count stepper ──
let teamCount = 2;
function renderTeamInputs() {
  const box = document.getElementById('team-name-inputs');
  box.innerHTML = '';
  for (let i = 0; i < teamCount; i++) {
    const row = document.createElement('div');
    row.className = 'team-input-row';
    row.innerHTML = `<div class="team-dot" style="background:${['#FF2D55','#5856D6','#FF9500','#34C759','#00C7BE','#FF375F','#BF5AF2','#FFD60A'][i]}"></div>
      <input type="text" placeholder="Team ${i + 1}" maxlength="20" id="team-name-${i}">`;
    box.appendChild(row);
  }
}
document.getElementById('team-count').textContent = teamCount;
renderTeamInputs();
document.getElementById('team-minus').addEventListener('click', () => { if (teamCount > 2) { teamCount--; document.getElementById('team-count').textContent = teamCount; renderTeamInputs(); } });
document.getElementById('team-plus').addEventListener('click', () => { if (teamCount < 8) { teamCount++; document.getElementById('team-count').textContent = teamCount; renderTeamInputs(); } });

// ── Playlist builder ──
function renderPlaylist() {
  const box = document.getElementById('playlist');
  box.innerHTML = '';
  playlist.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'trv-round-card';
    const catOpts = ['<option value="any">Any category</option>'].concat(categories.map(c => `<option value="${escapeHtml(c)}"${r.category === c ? ' selected' : ''}>${escapeHtml(c)}</option>`)).join('');
    card.innerHTML = `
      <div class="trv-round-head"><span>⚡ Round ${i + 1} · Fastest Finger</span>${playlist.length > 1 ? `<button class="trv-round-del" data-i="${i}">✕</button>` : ''}</div>
      <div class="trv-round-grid">
        <div><label>Category</label><select data-f="category" data-i="${i}">${catOpts}</select></div>
        <div><label>Difficulty</label><select data-f="difficulty" data-i="${i}">
          <option value="any"${r.difficulty==='any'?' selected':''}>Any</option>
          <option value="easy"${r.difficulty==='easy'?' selected':''}>Easy</option>
          <option value="medium"${r.difficulty==='medium'?' selected':''}>Medium</option>
          <option value="hard"${r.difficulty==='hard'?' selected':''}>Hard</option></select></div>
        <div><label>Questions</label><input type="number" data-f="count" data-i="${i}" min="1" max="20" value="${r.count}"></div>
        <div><label>Seconds each</label><select data-f="seconds" data-i="${i}">
          <option value="10"${r.seconds==10?' selected':''}>10s</option>
          <option value="15"${r.seconds==15?' selected':''}>15s</option>
          <option value="20"${r.seconds==20?' selected':''}>20s</option>
          <option value="30"${r.seconds==30?' selected':''}>30s</option></select></div>
      </div>`;
    box.appendChild(card);
  });
  box.querySelectorAll('[data-f]').forEach(el => el.addEventListener('change', e => {
    const i = +e.target.dataset.i, f = e.target.dataset.f;
    let v = e.target.value;
    if (f === 'count') v = Math.min(Math.max(parseInt(v) || 5, 1), 20);
    if (f === 'seconds') v = parseInt(v);
    playlist[i][f] = v;
  }));
  box.querySelectorAll('.trv-round-del').forEach(b => b.addEventListener('click', e => { playlist.splice(+e.target.dataset.i, 1); renderPlaylist(); }));
}
document.getElementById('btn-add-round').addEventListener('click', () => {
  playlist.push({ mode: 'fastest-finger', category: 'any', difficulty: 'any', count: 5, seconds: 20 });
  renderPlaylist();
});

// ── Create room ──
document.getElementById('btn-create').addEventListener('click', () => {
  Sounds.unlockAudio();
  const btn = document.getElementById('btn-create');
  btn.textContent = 'Creating...'; btn.disabled = true; dbg('Connecting...');
  const teamNames = Array.from({ length: teamCount }, (_, i) => { const el = document.getElementById(`team-name-${i}`); return el ? el.value.trim() : ''; });
  socket.emit('create-room', {
    teamMode, teamCount, teamNames,
    playlist,
    familyFriendly: document.getElementById('clean-toggle').checked,
    baseUrl: `${location.protocol}//${location.host}`
  });
  setTimeout(() => { btn.textContent = 'Create Room'; btn.disabled = false; dbg(''); }, 8000);
});

// ── Lobby ──
socket.on('room-created', ({ roomCode, joinUrl, localIP, port, teams }) => {
  const btn = document.getElementById('btn-create'); btn.textContent = 'Create Room'; btn.disabled = false; dbg('');
  currentScores = teams; allPlayers = [];
  document.getElementById('lobby-room-code').textContent = roomCode;
  document.getElementById('lobby-join-url').textContent = joinUrl;
  document.getElementById('lobby-player-address').innerHTML = `Players go to: <strong>http://${localIP}:${port}</strong>`;
  renderPlayerGroups();
  showScreen('screen-lobby');
});
socket.on('qr-ready', ({ qrDataUrl }) => { if (qrDataUrl) { document.getElementById('lobby-qr-img').src = qrDataUrl; document.getElementById('lobby-qr').style.display = 'block'; } });
socket.on('create-room-error', ({ message }) => { const btn = document.getElementById('btn-create'); btn.textContent = 'Create Room'; btn.disabled = false; dbg('Error: ' + message); });

socket.on('players-update', ({ allPlayers: players, scores }) => { allPlayers = players; if (scores) currentScores = scores; document.getElementById('player-count').textContent = players.length; renderPlayerGroups(); });
function renderPlayerGroups() {
  const box = document.getElementById('player-groups'); box.innerHTML = '';
  currentScores.forEach((team, i) => {
    const members = allPlayers.filter(p => p.teamIndex === i);
    const list = members.length ? members.map(p => `<span${p.connected === false ? ' style="opacity:0.45"' : ''}>${escapeHtml(p.name)}</span>`).join(', ') : 'No players yet';
    const div = document.createElement('div'); div.className = 'player-group';
    div.innerHTML = `<div class="player-group-header" style="color:${team.color}">${escapeHtml(team.name)}</div><div class="player-group-members">${list}</div>`;
    box.appendChild(div);
  });
}
document.getElementById('btn-start-game').addEventListener('click', () => socket.emit('start-game'));

// ── Round intro ──
socket.on('round-intro', (d) => {
  Sounds.go();
  document.getElementById('intro-round').textContent = `Round ${d.roundIndex + 1} of ${d.totalRounds}`;
  document.getElementById('intro-badge').textContent = `${d.modeIcon} ${d.modeName}`;
  const bits = [];
  if (d.category && d.category !== 'any') bits.push(d.category);
  if (d.difficulty && d.difficulty !== 'any') bits.push(d.difficulty);
  bits.push(`${d.count} questions`);
  document.getElementById('intro-detail').textContent = bits.join(' · ');
  document.getElementById('btn-start-round').textContent = d.roundIndex === 0 ? 'Start Round' : 'Start Round';
  showScreen('screen-round-intro');
});
document.getElementById('btn-start-round').addEventListener('click', () => socket.emit('advance'));

// ── Question ──
function renderOptions(container, options, opts = {}) {
  container.innerHTML = '';
  options.forEach((opt, i) => {
    const div = document.createElement('div');
    div.className = 'trv-option';
    if (opts.correctIndex != null) div.classList.add(i === opts.correctIndex ? 'correct' : 'dim');
    const count = opts.distribution ? `<span class="trv-option-count">${opts.distribution[i]}</span>` : '';
    div.innerHTML = `<div class="trv-option-letter">${LETTERS[i]}</div><div class="trv-option-text">${escapeHtml(opt)}</div>${count}`;
    container.appendChild(div);
  });
}
socket.on('question', (d) => {
  Sounds.wordReveal();
  document.getElementById('q-cat').textContent = d.category || '';
  document.getElementById('q-number').textContent = `Question ${d.qNumber} of ${d.qCount}`;
  document.getElementById('q-question').textContent = d.question;
  renderOptions(document.getElementById('q-options'), d.options);
  const timer = document.getElementById('q-timer'); timer.textContent = d.seconds; timer.classList.remove('low');
  document.getElementById('q-progress').textContent = `0 / ${allPlayers.filter(p=>p.connected).length} answered`;
  showScreen('screen-question');
});
socket.on('timer', ({ secondsLeft }) => {
  const t = document.getElementById('q-timer'); t.textContent = secondsLeft;
  t.classList.toggle('low', secondsLeft <= 5);
  if (secondsLeft <= 5 && secondsLeft > 0) Sounds.tick();
});
socket.on('answer-progress', ({ answered, total }) => { document.getElementById('q-progress').textContent = `${answered} / ${total} answered`; });
document.getElementById('btn-reveal').addEventListener('click', () => socket.emit('advance'));

// ── Reveal ──
socket.on('question-reveal', (d) => {
  Sounds.pointAwarded();
  const top = (d.results || []).find(r => r.correct);
  document.getElementById('reveal-sub').innerHTML = top ? `✅ <strong>${escapeHtml(d.correct)}</strong> — fastest: ${escapeHtml(top.name)}` : `✅ <strong>${escapeHtml(d.correct)}</strong>`;
  document.getElementById('reveal-question').textContent = d.question;
  renderOptions(document.getElementById('reveal-options'), d.options, { correctIndex: d.correctIndex, distribution: d.distribution });
  currentScores = d.scores;
  renderScoreCards('reveal-scores', d.scores);
  showScreen('screen-reveal');
});
document.getElementById('btn-next').addEventListener('click', () => socket.emit('advance'));

// ── Round over ──
socket.on('round-over', (d) => {
  Sounds.go();
  document.getElementById('ro-title').textContent = `Round ${d.roundIndex + 1} complete`;
  currentScores = d.scores;
  renderLeaderboard('ro-leaderboard', d.scores);
  const last = d.roundIndex + 1 >= d.totalRounds;
  document.getElementById('btn-next-round').textContent = last ? 'See Final Scores' : 'Next Round';
  showScreen('screen-round-over');
});
document.getElementById('btn-next-round').addEventListener('click', () => socket.emit('advance'));

// ── Game over ──
socket.on('game-over', ({ scores }) => { Sounds.gameOver(); renderLeaderboard('final-leaderboard', scores); showScreen('screen-game-over'); });

// ── Shared renderers (copied convention) ──
function renderScoreCards(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  scores.forEach(s => { const gold = s.color === '#FFD60A'; const card = document.createElement('div'); card.className = 'score-card'; card.style.cssText = `background:${s.color};color:${gold ? '#111' : '#fff'}`; card.innerHTML = `<div class="team-name">${escapeHtml(s.name)}</div><div class="score-num">${s.score}</div>`; c.appendChild(card); });
}
function renderLeaderboard(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  [...scores].sort((a, b) => b.score - a.score).forEach((s, i) => { const w = i === 0; const row = document.createElement('div'); row.className = `lb-row${w ? ' winner' : ''}`; if (w) row.style.cssText = `background:${s.color}22;border-color:${s.color}`; row.innerHTML = `<div class="lb-rank">${w ? '👑' : i + 1}</div><div class="lb-name" style="color:${s.color}">${escapeHtml(s.name)}</div><div class="lb-score">${s.score}</div>`; c.appendChild(row); });
}
