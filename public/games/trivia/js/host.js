const socket = io('/trivia');

// Launched as part of a tournament? Adopt the pre-created room and return when done.
const TOURNEY = (() => {
  const p = new URLSearchParams(location.search);
  const room = p.get('room'), t = p.get('t');
  return (room && t) ? { room: room.toUpperCase(), t: t.toUpperCase() } : null;
})();
if (TOURNEY) socket.on('connect', () => socket.emit('claim-host', { roomCode: TOURNEY.room }));

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
let teamMode = 'teams';
let categories = [];
let modes = [];
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
socket.on('trivia-meta', ({ categories: cats, modes: m }) => { categories = cats || []; modes = m || []; renderPlaylist(); });

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
function secondsOptions(r, vals) { return vals.map(v => `<option value="${v}"${r.seconds == v ? ' selected' : ''}>${v}s</option>`).join(''); }
function renderPlaylist() {
  const box = document.getElementById('playlist');
  box.innerHTML = '';
  const modeOpts = r => modes.map(m => `<option value="${m.key}"${r.mode === m.key ? ' selected' : ''}>${m.icon} ${m.name}</option>`).join('');
  playlist.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'trv-round-card';
    let fields;
    if (r.mode === 'fastest-finger') {
      const catOpts = ['<option value="any">Any category</option>'].concat(categories.map(c => `<option value="${escapeHtml(c)}"${r.category === c ? ' selected' : ''}>${escapeHtml(c)}</option>`)).join('');
      fields = `
        <div><label>Category</label><select data-f="category" data-i="${i}">${catOpts}</select></div>
        <div><label>Difficulty</label><select data-f="difficulty" data-i="${i}">
          <option value="any"${r.difficulty === 'any' ? ' selected' : ''}>Any</option>
          <option value="easy"${r.difficulty === 'easy' ? ' selected' : ''}>Easy</option>
          <option value="medium"${r.difficulty === 'medium' ? ' selected' : ''}>Medium</option>
          <option value="hard"${r.difficulty === 'hard' ? ' selected' : ''}>Hard</option></select></div>
        <div><label>Questions</label><input type="number" data-f="count" data-i="${i}" min="1" max="20" value="${r.count}"></div>
        <div><label>Seconds each</label><select data-f="seconds" data-i="${i}">${secondsOptions(r, [10, 15, 20, 30])}</select></div>`;
    } else {
      const sl = r.mode === 'same-letter';
      const note = sl ? 'Random category + letter each prompt. Type as many as you can — duplicates cancel.'
                      : 'A numeric question each time — closest guess wins the most points.';
      fields = `
        <div><label>${sl ? 'Prompts' : 'Questions'}</label><input type="number" data-f="count" data-i="${i}" min="1" max="12" value="${r.count}"></div>
        <div><label>Seconds each</label><select data-f="seconds" data-i="${i}">${secondsOptions(r, sl ? [45, 60, 90, 120] : [15, 20, 30, 45])}</select></div>
        <div style="grid-column:1/-1;font-size:0.72rem;color:var(--text-muted)">${note}</div>`;
    }
    card.innerHTML = `
      <div class="trv-round-head">
        <span>Round ${i + 1}</span>
        <select data-f="mode" data-i="${i}" style="flex:1;margin:0 10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:9px;color:#fff;font-family:'Fredoka',sans-serif;font-weight:600;padding:6px 8px">${modeOpts(r)}</select>
        ${playlist.length > 1 ? `<button class="trv-round-del" data-i="${i}">✕</button>` : ''}
      </div>
      <div class="trv-round-grid">${fields}</div>`;
    box.appendChild(card);
  });
  box.querySelectorAll('[data-f]').forEach(el => el.addEventListener('change', e => {
    const i = +e.target.dataset.i, f = e.target.dataset.f;
    let v = e.target.value;
    if (f === 'count') v = Math.min(Math.max(parseInt(v) || 5, 1), 20);
    if (f === 'seconds') v = parseInt(v);
    if (f === 'mode') {
      playlist[i].mode = v;
      const md = modes.find(m => m.key === v);
      if (md) playlist[i].seconds = md.defaultSeconds;
      renderPlaylist();
      return;
    }
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
document.getElementById('btn-end-game-lobby').addEventListener('click', () => socket.emit('end-game'));

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
  if (d.mode === 'same-letter') showSLQuestion(d);
  else if (d.mode === 'closest-wins') showCWQuestion(d);
  else if (d.mode === 'the-big-bluff') showBBQuestion(d);
  else showFFQuestion(d);
});
function showBBQuestion(d) {
  Sounds.wordReveal();
  if (d.stage === 'vote') {
    document.getElementById('q-vote-num').textContent = `Question ${d.qNumber} of ${d.qCount}`;
    document.getElementById('q-vote-prompt').textContent = d.prompt;
    const box = document.getElementById('q-vote-options'); box.innerHTML = '';
    (d.options || []).forEach(o => { const el = document.createElement('div'); el.className = 'bb-option'; el.textContent = o.text; box.appendChild(el); });
    const t = document.getElementById('q-vote-timer'); t.textContent = d.seconds; t.classList.remove('low');
    document.getElementById('q-vote-progress').textContent = 'Players are voting…';
    showScreen('screen-question-vote');
  } else {
    document.getElementById('q-bb-num').textContent = `Question ${d.qNumber} of ${d.qCount}`;
    document.getElementById('q-bb-prompt').textContent = d.prompt;
    const t = document.getElementById('q-bb-timer'); t.textContent = d.seconds; t.classList.remove('low');
    document.getElementById('q-bb-progress').textContent = 'Players are writing their bluffs…';
    showScreen('screen-question-bluff');
  }
}
function showCWQuestion(d) {
  Sounds.wordReveal();
  document.getElementById('q-cw-num').textContent = `Question ${d.qNumber} of ${d.qCount}`;
  document.getElementById('q-cw-question').textContent = d.question + (d.unit ? ` (${d.unit})` : '');
  const t = document.getElementById('q-cw-timer'); t.textContent = d.seconds; t.classList.remove('low');
  document.getElementById('q-cw-progress').textContent = 'Players are guessing…';
  showScreen('screen-question-cw');
}
function showFFQuestion(d) {
  Sounds.wordReveal();
  document.getElementById('q-cat').textContent = d.category || '';
  document.getElementById('q-number').textContent = `Question ${d.qNumber} of ${d.qCount}`;
  document.getElementById('q-question').textContent = d.question;
  renderOptions(document.getElementById('q-options'), d.options);
  const timer = document.getElementById('q-timer'); timer.textContent = d.seconds; timer.classList.remove('low');
  document.getElementById('q-progress').textContent = `0 / ${allPlayers.filter(p => p.connected).length} answered`;
  showScreen('screen-question');
}
function showSLQuestion(d) {
  Sounds.wordReveal();
  document.getElementById('q-sl-cat').textContent = `${d.category} · Prompt ${d.qNumber} of ${d.qCount}`;
  document.getElementById('q-sl-letter').textContent = d.letter;
  const t = document.getElementById('q-sl-timer'); t.textContent = d.seconds; t.classList.remove('low');
  document.getElementById('q-sl-progress').textContent = 'Players are typing…';
  showScreen('screen-question-sl');
}
socket.on('timer', ({ secondsLeft }) => {
  ['q-timer', 'q-sl-timer', 'q-cw-timer', 'q-bb-timer', 'q-vote-timer'].forEach(id => { const t = document.getElementById(id); if (t) { t.textContent = secondsLeft; t.classList.toggle('low', secondsLeft <= 5); } });
  if (secondsLeft <= 5 && secondsLeft > 0) Sounds.tick();
});
socket.on('answer-progress', ({ answered, total }) => {
  const ff = document.getElementById('q-progress'); if (ff) ff.textContent = `${answered} / ${total} answered`;
  const sl = document.getElementById('q-sl-progress'); if (sl) sl.textContent = `${answered} of ${total} players answering…`;
  const cw = document.getElementById('q-cw-progress'); if (cw) cw.textContent = `${answered} of ${total} players guessing…`;
  const bb = document.getElementById('q-bb-progress'); if (bb) bb.textContent = `${answered} of ${total} wrote a bluff`;
  const vote = document.getElementById('q-vote-progress'); if (vote) vote.textContent = `${answered} of ${total} voted`;
});
document.getElementById('btn-reveal').addEventListener('click', () => socket.emit('advance'));
document.getElementById('btn-reveal-sl').addEventListener('click', () => socket.emit('advance'));
document.getElementById('btn-reveal-cw').addEventListener('click', () => socket.emit('advance'));
document.getElementById('btn-bb-to-vote').addEventListener('click', () => socket.emit('advance'));
document.getElementById('btn-vote-reveal').addEventListener('click', () => socket.emit('advance'));

// ── Reveal ──
socket.on('question-reveal', (d) => {
  if (d.mode === 'same-letter') showSLReveal(d);
  else if (d.mode === 'closest-wins') showCWReveal(d);
  else if (d.mode === 'the-big-bluff') showBBReveal(d);
  else showFFReveal(d);
});
function showBBReveal(d) {
  Sounds.pointAwarded();
  const box = document.getElementById('reveal-bb-options'); box.innerHTML = '';
  (d.options || []).forEach(o => {
    const el = document.createElement('div');
    el.className = 'bb-option' + (o.isTruth ? ' truth' : '');
    const meta = o.isTruth
      ? (o.votes.length ? `✅ THE TRUTH — found by ${o.votes.join(', ')}` : '✅ THE TRUTH — nobody found it!')
      : `🎭 ${o.authors.join(', ') || '?'}${o.votes.length ? ` — fooled ${o.votes.join(', ')}` : ' — fooled nobody'}`;
    el.innerHTML = `<div>${escapeHtml(o.text)}</div><div class="bb-meta">${escapeHtml(meta)}</div>`;
    box.appendChild(el);
  });
  renderScorers('reveal-bb-scorers', d.results, r => { const b = []; if (r.foundTruth) b.push('found truth'); if (r.fooled) b.push(`fooled ${r.fooled}`); return b.join(' · ') || 'bluffed out'; });
  currentScores = d.scores;
  renderScoreCards('reveal-bb-scores', d.scores);
  showScreen('screen-reveal-bluff');
}
function showFFReveal(d) {
  Sounds.pointAwarded();
  const top = (d.results || []).find(r => r.correct);
  document.getElementById('reveal-sub').innerHTML = top ? `✅ <strong>${escapeHtml(d.correct)}</strong> — fastest: ${escapeHtml(top.name)}` : `✅ <strong>${escapeHtml(d.correct)}</strong>`;
  document.getElementById('reveal-question').textContent = d.question;
  renderOptions(document.getElementById('reveal-options'), d.options, { correctIndex: d.correctIndex, distribution: d.distribution });
  renderScorers('reveal-ff-scorers', d.results, r => r.correct ? 'got it' : 'missed');
  currentScores = d.scores;
  renderScoreCards('reveal-scores', d.scores);
  showScreen('screen-reveal');
}
function showSLReveal(d) {
  Sounds.pointAwarded();
  document.getElementById('reveal-sl-sub').innerHTML = `🔤 ${escapeHtml(d.category)} · starting with <span class="sl-letter">${escapeHtml(d.letter)}</span> &nbsp;·&nbsp; <span style="font-size:0.72rem;color:var(--text-muted);font-weight:600">tap an answer to disqualify it</span>`;
  const box = document.getElementById('reveal-sl-groups'); box.innerHTML = '';
  (d.groups || []).forEach(g => {
    const chip = document.createElement('div');
    chip.className = 'sl-chip ' + (g.struck ? 'struck' : (g.scored ? 'scored' : 'cancelled')) + (g.flagged ? ' flagged' : '');
    chip.style.cursor = 'pointer';
    chip.innerHTML = `<span class="txt">${escapeHtml(g.text)}</span>${g.flagged ? '<span class="who" title="not a dictionary word">⚠️</span>' : ''}${g.count > 1 ? `<span class="who">×${g.count}</span>` : ''}`;
    chip.addEventListener('click', () => socket.emit('host-action', { type: 'strike', text: g.text }));
    box.appendChild(chip);
  });
  if (!(d.groups || []).length) box.innerHTML = '<div style="color:var(--text-muted)">No answers this round!</div>';
  renderScorers('reveal-sl-scorers', d.results, r => `${r.unique} unique of ${r.total}`);
  currentScores = d.scores;
  renderScoreCards('reveal-sl-scores', d.scores);
  showScreen('screen-reveal-sl');
}
function showCWReveal(d) {
  Sounds.pointAwarded();
  document.getElementById('reveal-cw-q').textContent = d.question;
  document.getElementById('reveal-cw-answer').textContent = `${d.answer}${d.unit ? ' ' + d.unit : ''}`;
  const box = document.getElementById('reveal-cw-guesses'); box.innerHTML = '';
  (d.results || []).forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'cw-guess-row' + (i === 0 ? ' closest' : '');
    row.innerHTML = `<span class="cw-guess-name">${i === 0 ? '🎯 ' : ''}${escapeHtml(r.name)}</span><span class="cw-guess-val">${r.value}</span><span class="cw-guess-pts">+${r.points}</span>`;
    box.appendChild(row);
  });
  if (!(d.results || []).length) box.innerHTML = '<div style="color:var(--text-muted)">No guesses this round!</div>';
  currentScores = d.scores;
  renderScoreCards('reveal-cw-scores', d.scores);
  showScreen('screen-reveal-cw');
}
document.getElementById('btn-next').addEventListener('click', () => socket.emit('advance'));
document.getElementById('btn-next-sl').addEventListener('click', () => socket.emit('advance'));
document.getElementById('btn-next-cw').addEventListener('click', () => socket.emit('advance'));
document.getElementById('btn-next-bb').addEventListener('click', () => socket.emit('advance'));

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
socket.on('game-over', ({ scores }) => {
  Sounds.gameOver();
  renderLeaderboard('final-leaderboard', scores);
  showScreen('screen-game-over');
  if (TOURNEY) setTimeout(() => { location.href = `/games/tournament/host.html?room=${TOURNEY.t}`; }, 3500);
});

// Tournament: adopt the pre-created room — hide the join code/QR, just start.
socket.on('host-attached', (data) => {
  teamMode = data.teamMode || 'teams';
  currentScores = (data.teams || []).map((t, i) => ({ index: i, name: t.name, color: t.color, score: t.score || 0 }));
  allPlayers = [];
  const codeSec = document.querySelector('#screen-lobby .lobby-code-section');
  if (codeSec) codeSec.style.display = 'none';
  // An escape hatch: a host who'd rather skip this game ends it (concludes a tie)
  // and the tournament moves on to the next game.
  const endBtn = document.getElementById('btn-end-game-lobby');
  if (endBtn) endBtn.style.display = 'inline-flex';
  renderPlayerGroups();
  showScreen('screen-lobby');
});

// ── Shared renderers (copied convention) ──
function renderScoreCards(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  scores.forEach(s => { const gold = s.color === '#FFD60A'; const card = document.createElement('div'); card.className = 'score-card'; card.style.cssText = `background:${s.color};color:${gold ? '#111' : '#fff'}`; card.innerHTML = `<div class="team-name">${escapeHtml(s.name)}</div><div class="score-num">${s.score}</div>`; c.appendChild(card); });
}
function renderLeaderboard(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  [...scores].sort((a, b) => b.score - a.score).forEach((s, i) => { const w = i === 0; const row = document.createElement('div'); row.className = `lb-row${w ? ' winner' : ''}`; if (w) row.style.cssText = `background:${s.color}22;border-color:${s.color}`; row.innerHTML = `<div class="lb-rank">${w ? '👑' : i + 1}</div><div class="lb-name" style="color:${s.color}">${escapeHtml(s.name)}</div><div class="lb-score">${s.score}</div>`; c.appendChild(row); });
}
// Per-player points for a single question/round, so the maths is visible.
function renderScorers(id, results, detailFn) {
  const c = document.getElementById(id); if (!c) return; c.innerHTML = '';
  if (!results || !results.length) { c.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">No points this round</div>'; return; }
  results.forEach(r => {
    const row = document.createElement('div'); row.className = 'trv-scorer';
    const detail = detailFn ? detailFn(r) : '';
    row.innerHTML = `<span class="trv-scorer-name">${escapeHtml(r.name)}</span>${detail ? `<span class="trv-scorer-detail">${escapeHtml(detail)}</span>` : ''}<span class="trv-scorer-pts${r.points > 0 ? '' : ' zero'}">+${r.points}</span>`;
    c.appendChild(row);
  });
}
