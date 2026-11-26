const socket = io('/no-say-am');
if (window.GNPause) GNPause.init(socket);

// Launched as part of a tournament? Adopt the pre-created room and return when done.
const TOURNEY = (() => {
  const p = new URLSearchParams(location.search);
  const room = p.get('room'), t = p.get('t');
  return (room && t) ? { room: room.toUpperCase(), t: t.toUpperCase() } : null;
})();
if (TOURNEY) socket.on('connect', () => socket.emit('claim-host', { roomCode: TOURNEY.room }));

let teamMode = 'teams';
let teamCount = 2;
let selectedSeconds = 60;
let selectedRounds = 3;
let currentScores = [];
let allPlayers = [];

const TEAM_COLORS = ['#FF2D55', '#5856D6', '#FF9500', '#34C759', '#00C7BE', '#FF375F', '#BF5AF2', '#FFD60A'];

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function dbg(m) { const el = document.getElementById('debug-log'); if (el) el.textContent = m; }
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id); if (el) el.classList.add('active');
}

// ── Setup: teams/solo ──
document.querySelectorAll('#seg-mode button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#seg-mode button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  teamMode = b.dataset.mode;
  document.getElementById('teams-setup').style.display = teamMode === 'teams' ? 'block' : 'none';
}));

// ── Team stepper ──
function renderTeamInputs() {
  const box = document.getElementById('team-name-inputs'); box.innerHTML = '';
  for (let i = 0; i < teamCount; i++) {
    const row = document.createElement('div');
    row.className = 'team-input-row';
    row.innerHTML = `<div class="team-dot" style="background:${TEAM_COLORS[i]}"></div><input type="text" placeholder="Team ${i + 1}" maxlength="20" id="team-name-${i}">`;
    box.appendChild(row);
  }
}
document.getElementById('team-count').textContent = teamCount;
renderTeamInputs();
document.getElementById('team-minus').addEventListener('click', () => { if (teamCount > 2) { teamCount--; document.getElementById('team-count').textContent = teamCount; renderTeamInputs(); } });
document.getElementById('team-plus').addEventListener('click', () => { if (teamCount < 8) { teamCount++; document.getElementById('team-count').textContent = teamCount; renderTeamInputs(); } });

// ── Timer + rounds option chips ──
function buildChips(containerId, values, selected, fmt, onPick) {
  const box = document.getElementById(containerId); box.innerHTML = '';
  values.forEach(v => {
    const chip = document.createElement('div');
    chip.className = 'opt-chip' + (v === selected() ? ' active' : '');
    chip.textContent = fmt(v);
    chip.addEventListener('click', () => { onPick(v); box.querySelectorAll('.opt-chip').forEach(c => c.classList.remove('active')); chip.classList.add('active'); });
    box.appendChild(chip);
  });
}
buildChips('timer-opts', [45, 60, 90, 120], () => selectedSeconds, v => v + 's', v => selectedSeconds = v);
buildChips('rounds-opts', [1, 2, 3, 4, 5], () => selectedRounds, v => String(v), v => selectedRounds = v);

// ── Create room ──
document.getElementById('btn-create').addEventListener('click', () => {
  Sounds.unlockAudio();
  const btn = document.getElementById('btn-create');
  btn.textContent = 'Creating...'; btn.disabled = true; dbg('Connecting...');
  const teamNames = Array.from({ length: teamCount }, (_, i) => { const el = document.getElementById(`team-name-${i}`); return el ? el.value.trim() : ''; });
  socket.emit('create-room', {
    mode: teamMode, teamCount, teamNames,
    turnSeconds: selectedSeconds, totalRounds: selectedRounds,
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
document.getElementById('btn-end-game-lobby').addEventListener('click', () => socket.emit('end-game'));

// ── Turn intro ──
socket.on('turn-intro', (d) => {
  Sounds.go();
  document.getElementById('intro-round').textContent = `Round ${(d.round || 0) + 1} of ${d.totalRounds}`;
  const teamEl = document.getElementById('intro-team');
  teamEl.textContent = d.teamName || 'Team'; teamEl.style.color = d.teamColor || '#fff';
  document.getElementById('intro-describer').textContent = d.describerName || 'Someone';
  showScreen('screen-turn-intro');
});
document.getElementById('btn-start-turn').addEventListener('click', () => socket.emit('start-turn'));

// ── In turn ──
socket.on('turn-started', (d) => {
  document.getElementById('turn-team-label').textContent = d.teamName || '';
  document.getElementById('turn-team-label').style.color = d.teamColor || 'var(--text-muted)';
  document.getElementById('turn-describer').textContent = d.describerName || 'the describer';
  document.getElementById('turn-got').textContent = '0';
  document.getElementById('turn-skipped').textContent = '0';
  setClock(d.secondsLeft || selectedSeconds);
  renderScoreCards('turn-scores', currentScores);
  showScreen('screen-in-turn');
});
function setClock(secs) {
  const el = document.getElementById('turn-clock');
  const m = Math.floor(secs / 60), s = secs % 60;
  el.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
  el.classList.toggle('low', secs <= 10);
}
socket.on('timer', ({ secondsLeft }) => { setClock(secondsLeft); if (secondsLeft <= 5 && secondsLeft > 0) Sounds.tick(secondsLeft <= 3); });
socket.on('turn-progress', ({ got, skipped, scores, lastResult }) => {
  document.getElementById('turn-got').textContent = got;
  document.getElementById('turn-skipped').textContent = skipped;
  if (scores) { currentScores = scores; renderScoreCards('turn-scores', scores); }
  if (lastResult === 'got') Sounds.pointAwarded();
});
document.getElementById('btn-end-turn').addEventListener('click', () => socket.emit('end-turn'));

// ── End game — on every between-action host screen; two-tap safety so a stray
//    tap never kills the game mid-night. ──
document.querySelectorAll('.nsa-end-game').forEach(b => {
  let armed = false, timer = null;
  b.addEventListener('click', () => {
    if (!armed) {
      armed = true; b.textContent = 'Tap again to end'; b.style.color = '#FF6482'; b.style.borderColor = 'rgba(255,45,85,0.5)';
      clearTimeout(timer); timer = setTimeout(() => { armed = false; b.textContent = '⏹ End game'; b.style.color = ''; b.style.borderColor = ''; }, 3000);
      return;
    }
    socket.emit('end-game');
  });
});

// ── Turn over (with strike) ──
socket.on('turn-over', (d) => {
  if (currentScreen() !== 'screen-turn-over') Sounds.timeUp();
  if (d.scores) currentScores = d.scores;
  document.getElementById('over-title').textContent = `${d.teamName || 'Team'}'s turn is over`;
  document.getElementById('over-summary').innerHTML = `✅ <strong>${d.got}</strong> got &nbsp;·&nbsp; ⏭ ${d.skipped} skipped`;
  const box = document.getElementById('over-words'); box.innerHTML = '';
  (d.turnLog || []).forEach(e => {
    const effGot = e.result === 'got' ? !e.struck : !!e.struck;   // currently scoring?
    const chip = document.createElement('div');
    chip.className = 'nsa-chip ' + (effGot ? 'got' : 'skipped') + (e.struck ? ' corrected' : '');
    chip.innerHTML = `<span class="mark">${effGot ? '✓' : '⏭'}</span><span>${escapeHtml(e.word)}</span>`
      + (e.struck ? `<span class="nsa-tag">${effGot ? '+1' : '−1'}</span>` : '');
    chip.title = effGot ? 'Tap to take this point away' : 'Tap to award a point';
    chip.addEventListener('click', () => socket.emit('strike', { index: e.index }));
    box.appendChild(chip);
  });
  if (!(d.turnLog || []).length) box.innerHTML = '<div style="color:var(--text-muted)">No words this turn.</div>';
  showScreen('screen-turn-over');
});
document.getElementById('btn-next').addEventListener('click', () => socket.emit('next'));

// ── Round over ──
socket.on('round-over', (d) => {
  Sounds.go();
  document.getElementById('ro-title').textContent = `Round ${(d.round || 0) + 1} complete`;
  if (d.scores) currentScores = d.scores;
  renderLeaderboard('ro-leaderboard', d.scores || currentScores);
  showScreen('screen-round-over');
});
document.getElementById('btn-next-round').addEventListener('click', () => socket.emit('advance'));

// ── Game over ──
socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
  renderLeaderboard('final-leaderboard', scores);
  showScreen('screen-game-over');
  if (TOURNEY) setTimeout(() => { location.href = `/games/tournament/host.html?room=${TOURNEY.t}`; }, 3500);
});
document.getElementById('btn-play-again').addEventListener('click', () => location.reload());

// ── Tournament adoption ──
socket.on('host-attached', (data) => {
  teamMode = data.mode || 'teams';
  currentScores = (data.teams || []).map((t, i) => ({ index: i, name: t.name, color: t.color, score: t.score || 0 }));
  allPlayers = [];
  const codeSec = document.querySelector('#screen-lobby .lobby-code-section');
  if (codeSec) codeSec.style.display = 'none';
  const endBtn = document.getElementById('btn-end-game-lobby');
  if (endBtn) endBtn.style.display = 'inline-flex';
  renderPlayerGroups();
  showScreen('screen-lobby');
});

function currentScreen() { const el = document.querySelector('.screen.active'); return el ? el.id : null; }

// ── Shared renderers ──
function renderScoreCards(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  scores.forEach(s => { const gold = s.color === '#FFD60A'; const card = document.createElement('div'); card.className = 'score-card'; card.style.cssText = `background:${s.color};color:${gold ? '#111' : '#fff'}`; card.innerHTML = `<div class="team-name">${escapeHtml(s.name)}</div><div class="score-num">${s.score}</div>`; c.appendChild(card); });
}
function renderLeaderboard(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  [...scores].sort((a, b) => b.score - a.score).forEach((s, i) => { const w = i === 0; const row = document.createElement('div'); row.className = `lb-row${w ? ' winner' : ''}`; if (w) row.style.cssText = `background:${s.color}22;border-color:${s.color}`; row.innerHTML = `<div class="lb-rank">${w ? '👑' : i + 1}</div><div class="lb-name" style="color:${s.color}">${escapeHtml(s.name)}</div><div class="lb-score">${s.score}</div>`; c.appendChild(row); });
}
