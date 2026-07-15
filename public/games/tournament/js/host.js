const socket = io('/tournament');

const TEAM_COLORS = ['#FF2D55','#5856D6','#FF9500','#34C759','#00C7BE','#FF375F','#BF5AF2','#FFD60A'];

// Mirror of the server's GAME_CATALOG — what can go in a line-up.
const CATALOG = [
  { slug: 'grab-the-mic',    name: 'Grab the Mic', icon: '🎤', twoSided: false, lengthLabel: 'Play to',   lengthDefault: 10 },
  { slug: 'family-feud',     name: 'Family Feud',  icon: '🎯', twoSided: true,  lengthLabel: 'Questions', lengthDefault: 5 },
  { slug: 'text-twist',      name: 'Text Twist',   icon: '🔤', twoSided: false, lengthLabel: 'Rounds',    lengthDefault: 3 },
  { slug: 'kill-and-injury', name: 'Kill & Injury',icon: '🕵️', twoSided: true,  lengthLabel: 'Matches',   lengthDefault: 3 }
];

let teamCount = 2;
let selectedMode = 'teams';
let lineup = [];   // [{ slug, name, icon, twoSided, length }]
let allPlayers = [];
let standings = [];

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}
function dbg(msg) { const el = document.getElementById('debug-log'); if (el) el.textContent = msg; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Mode + teams ───────────────────────────────────────────────
document.querySelectorAll('#mode-selector .opt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#mode-selector .opt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMode = btn.dataset.mode;
    document.getElementById('teams-setup').style.display = selectedMode === 'individual' ? 'none' : 'flex';
    renderPlacement();
  });
});

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
document.getElementById('count-down').addEventListener('click', () => {
  if (teamCount > 2) { teamCount--; countDisplay.textContent = teamCount; renderTeamInputs(); renderPlacement(); }
});
document.getElementById('count-up').addEventListener('click', () => {
  if (teamCount < 8) { teamCount++; countDisplay.textContent = teamCount; renderTeamInputs(); renderPlacement(); }
});
renderTeamInputs();

// ── Game picker + line-up ──────────────────────────────────────
function renderGamePicker() {
  const container = document.getElementById('game-pick');
  container.innerHTML = '';
  CATALOG.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'game-pick-btn';
    btn.innerHTML = `
      <span class="gi">${g.icon}</span>
      <span class="gn">${g.name}</span>
      ${g.twoSided ? '<span class="two">2 sides</span>' : ''}
      <span class="add">+</span>
    `;
    btn.addEventListener('click', () => {
      lineup.push({ slug: g.slug, name: g.name, icon: g.icon, twoSided: g.twoSided, length: g.lengthDefault, lengthLabel: g.lengthLabel });
      renderLineup();
    });
    container.appendChild(btn);
  });
}

function renderLineup() {
  const container = document.getElementById('lineup');
  container.innerHTML = '';
  lineup.forEach((g, i) => {
    const item = document.createElement('div');
    item.className = 'lineup-item';
    item.innerHTML = `
      <span class="num">${i + 1}</span>
      <span class="gi">${g.icon}</span>
      <span class="gn">${escapeHtml(g.name)}</span>
      <span class="len-wrap">${g.lengthLabel}
        <input type="number" class="len" min="1" max="50" value="${g.length}" id="len-${i}">
      </span>
      <span class="rm" title="Remove" data-i="${i}">×</span>
    `;
    item.querySelector('.len').addEventListener('input', e => {
      const v = parseInt(e.target.value);
      g.length = isNaN(v) ? g.length : Math.min(Math.max(v, 1), 50);
    });
    item.querySelector('.rm').addEventListener('click', () => { lineup.splice(i, 1); renderLineup(); });
    container.appendChild(item);
  });
}
renderGamePicker();
renderLineup();

// ── Placement points ───────────────────────────────────────────
const DEFAULT_PLACE = [10, 7, 5, 3, 1];
let placeValues = [...DEFAULT_PLACE];

function renderPlacement() {
  // Show enough positions to cover the field: teams mode → team count; individuals → 5.
  const positions = selectedMode === 'teams' ? teamCount : 5;
  const row = document.getElementById('placement');
  row.innerHTML = '';
  const ORD = ['1st','2nd','3rd','4th','5th','6th','7th','8th'];
  for (let i = 0; i < positions; i++) {
    if (placeValues[i] == null) placeValues[i] = Math.max(1, (placeValues[i - 1] || 3) - 2);
    const cell = document.createElement('div');
    cell.className = 'place-cell';
    cell.innerHTML = `<div class="pl">${ORD[i]}</div><input type="number" min="0" max="100" value="${placeValues[i]}" id="place-${i}">`;
    cell.querySelector('input').addEventListener('input', e => {
      const v = parseInt(e.target.value);
      placeValues[i] = isNaN(v) ? 0 : Math.min(Math.max(v, 0), 100);
    });
    row.appendChild(cell);
  }
}
renderPlacement();

// ── Create ─────────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  Sounds.unlockAudio();
  if (!lineup.length) { dbg('Add at least one game to the line-up.'); return; }

  const btn = document.getElementById('btn-create');
  btn.textContent = 'Creating...';
  btn.disabled = true;
  dbg('');

  const positions = selectedMode === 'teams' ? teamCount : 5;
  const teamNames = Array.from({ length: teamCount }, (_, i) => {
    const el = document.getElementById(`team-name-${i}`);
    return el ? el.value.trim() : '';
  });

  socket.emit('create-tournament', {
    mode: selectedMode,
    teamCount,
    teamNames,
    plan: lineup.map(g => ({ slug: g.slug, length: g.length, config: {} })),
    placement: placeValues.slice(0, positions),
    baseUrl: `${location.protocol}//${location.host}`
  });

  setTimeout(() => { btn.textContent = 'Create Tournament'; btn.disabled = false; }, 8000);
});

// ── Lobby ──────────────────────────────────────────────────────
socket.on('tournament-created', ({ roomCode, joinUrl, localIP, port, teams, plan }) => {
  document.getElementById('btn-create').textContent = 'Create Tournament';
  document.getElementById('btn-create').disabled = false;

  standings = teams;
  allPlayers = [];

  document.getElementById('lobby-room-code').textContent = roomCode;
  document.getElementById('lobby-join-url').textContent = joinUrl;
  const ipEl = document.getElementById('lobby-player-address');
  if (ipEl) ipEl.innerHTML = `Players go to: <strong>http://${localIP}:${port}</strong>`;

  renderPlanStrip('lobby-plan', plan);
  renderPlanStrip('ready-plan', plan);
  renderPlayerGroups();
  showScreen('screen-lobby');
});

socket.on('qr-ready', ({ qrDataUrl }) => {
  if (qrDataUrl) {
    document.getElementById('lobby-qr-img').src = qrDataUrl;
    document.getElementById('lobby-qr').style.display = 'block';
  }
});

socket.on('create-tournament-error', ({ message }) => {
  document.getElementById('btn-create').textContent = 'Create Tournament';
  document.getElementById('btn-create').disabled = false;
  dbg(message);
});

function renderPlanStrip(containerId, plan) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  plan.forEach((g, i) => {
    const chip = document.createElement('div');
    chip.className = 'plan-chip';
    chip.innerHTML = `<span class="n">${i + 1}</span> ${g.icon} ${escapeHtml(g.name)} <span style="color:rgba(255,255,255,0.4);font-size:0.75rem">·&nbsp;${g.length}</span>`;
    el.appendChild(chip);
  });
}

socket.on('players-update', ({ allPlayers: players, standings: st }) => {
  allPlayers = players;
  if (st) standings = st;
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
      <div class="player-group-header" style="color:#FFD60A">Players</div>
      <div class="player-group-members">${allPlayers.length ? allPlayers.map(member).join(', ') : 'No players yet — scan the QR to join'}</div>
    `;
    container.appendChild(div);
    return;
  }
  standings.forEach((team) => {
    const members = allPlayers.filter(p => p.teamIndex === team.index);
    const div = document.createElement('div');
    div.className = 'player-group';
    div.innerHTML = `
      <div class="player-group-header" style="color:${team.color}">${escapeHtml(team.name)}</div>
      <div class="player-group-members">${members.length ? members.map(member).join(', ') : 'No players yet'}</div>
    `;
    container.appendChild(div);
  });
}

document.getElementById('btn-start').addEventListener('click', () => socket.emit('start-tournament'));

socket.on('start-blocked', ({ message }) => alert(message));

// Stage 1 stub — confirms the plan + roster are wired. Stage 2 launches games.
socket.on('tournament-ready', () => {
  Sounds.go();
  showScreen('screen-ready');
});
