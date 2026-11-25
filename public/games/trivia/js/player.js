const socket = io('/trivia');
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// Shared games-night device id (same key as the other games) so a screen-lock
// or QR re-scan re-binds us to our slot.
const playerId = (() => {
  try {
    let id = localStorage.getItem('gtm-pid');
    if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('gtm-pid', id); }
    return id;
  } catch (e) { return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
})();

// Launched as part of a tournament? Rejoin the pre-created room and return when done.
const TOURNEY = (() => {
  const p = new URLSearchParams(location.search);
  const room = p.get('room'), t = p.get('t');
  return (room && t) ? { room: room.toUpperCase(), t: t.toUpperCase() } : null;
})();

let myTeamIndex = -1, myTeamColor = '#5856D6', teamNames = [], teamColors = [];
let joinedRoomCode = null, pendingName = '', pendingRoom = '';
let answered = false, myChoice = null, currentOptions = [];
let slAnswers = [], slLetter = '', curMode = '', myBluff = '';

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const P_QUESTION_SCREENS = new Set(['screen-question', 'screen-question-sl', 'screen-question-cw', 'screen-question-bluff', 'screen-question-vote']);
function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); const el = document.getElementById(id); if (el) el.classList.add('active'); const bar = document.getElementById('p-topbar'); if (bar) bar.style.display = P_QUESTION_SCREENS.has(id) ? 'block' : 'none'; }
function setPlayerMode(d) { const mb = document.getElementById('p-topbar-mode'); if (mb && d && d.modeName) mb.textContent = `${d.modeIcon || ''} ${d.modeName}`.trim(); }
function savedSession() { try { return JSON.parse(sessionStorage.getItem('trivia-session') || 'null'); } catch (e) { return null; } }
function saveSession(rc) { try { sessionStorage.setItem('trivia-session', JSON.stringify({ roomCode: rc })); } catch (e) {} }
function clearSession() { joinedRoomCode = null; try { sessionStorage.removeItem('trivia-session'); } catch (e) {} }

// ── Reconnect ──
socket.on('connect', () => { const sess = savedSession(); const rc = (TOURNEY && TOURNEY.room) || joinedRoomCode || (sess && sess.roomCode); if (rc) socket.emit('rejoin-room', { roomCode: rc, playerId }); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && joinedRoomCode && socket.connected) socket.emit('request-sync'); });
socket.on('rejoin-failed', ({ message }) => { clearSession(); document.getElementById('join-error').textContent = message || 'Please join again.'; showScreen('screen-join'); });

// ── Join ──
const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) document.getElementById('input-room').value = roomFromUrl.toUpperCase();
document.getElementById('input-room').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
document.getElementById('btn-join').addEventListener('click', doJoin);
['input-name', 'input-room'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); }));
function doJoin() {
  Sounds.unlockAudio();
  const name = document.getElementById('input-name').value.trim();
  const room = document.getElementById('input-room').value.trim().toUpperCase();
  const err = document.getElementById('join-error');
  if (!name) { err.textContent = 'Please enter your name.'; return; }
  if (room.length !== 4) { err.textContent = 'Room code must be 4 characters.'; return; }
  err.textContent = ''; pendingName = name; pendingRoom = room;
  socket.emit('check-room', { roomCode: room });
}
socket.on('room-check-result', ({ found, message, teamMode, teams }) => {
  if (!found) { document.getElementById('join-error').textContent = message; return; }
  if (teamMode === 'individual') { socket.emit('join-room', { roomCode: pendingRoom, playerName: pendingName, teamIndex: -1, playerId }); return; }
  teamColors = teams.map(t => t.color); teamNames = teams.map(t => t.name);
  const box = document.getElementById('team-buttons'); box.innerHTML = '';
  teams.forEach((team, i) => {
    const btn = document.createElement('button');
    btn.className = `team-btn${team.color === '#FFD60A' ? ' dark-text' : ''}`;
    btn.style.background = team.color; btn.textContent = team.name;
    btn.addEventListener('click', () => socket.emit('join-room', { roomCode: pendingRoom, playerName: pendingName, teamIndex: i, playerId }));
    box.appendChild(btn);
  });
  showScreen('screen-team-select');
});
socket.on('join-error', ({ message }) => { document.getElementById('join-error').textContent = message; showScreen('screen-join'); });

socket.on('joined', (snap) => {
  myTeamIndex = snap.teamIndex; teamNames = snap.teamNames; teamColors = snap.teamColors;
  myTeamColor = teamColors[myTeamIndex] || '#5856D6';
  joinedRoomCode = snap.roomCode; saveSession(snap.roomCode);
  const badge = document.getElementById('waiting-team-badge');
  const gold = myTeamColor === '#FFD60A';
  badge.textContent = teamNames[myTeamIndex] || 'You';
  badge.style.cssText = `background:${myTeamColor};color:${gold ? '#111' : '#fff'}`;
  applySnapshot(snap);
});
socket.on('sync', applySnapshot);

// ── Question / answering ──
function renderOptions(options, { locked, chosen, correctIndex } = {}) {
  currentOptions = options;
  const box = document.getElementById('p-options'); box.innerHTML = '';
  options.forEach((opt, i) => {
    const div = document.createElement('div');
    div.className = 'p-option';
    if (correctIndex != null) { if (i === correctIndex) div.classList.add('correct'); else if (i === chosen) div.classList.add('wrong'); div.classList.add('locked'); }
    else if (locked) { div.classList.add('locked'); if (i === chosen) div.classList.add('chosen'); }
    div.innerHTML = `<div class="p-option-letter">${LETTERS[i]}</div><div class="p-option-text">${escapeHtml(opt)}</div>`;
    if (correctIndex == null && !locked) div.addEventListener('click', () => choose(i));
    box.appendChild(div);
  });
}
function choose(i) {
  if (answered) return;
  answered = true; myChoice = i;
  Sounds.buzz();
  socket.emit('submit', { choice: i });
  renderOptions(currentOptions, { locked: true, chosen: i });
  const lb = document.getElementById('p-locked'); lb.style.display = 'block'; lb.textContent = `Locked in: ${LETTERS[i]} — nice!`;
}
socket.on('you-submitted', (ack) => {
  if (curMode === 'same-letter') {
    if (!ack || !('accepted' in ack)) return;
    const fb = document.getElementById('p-sl-feedback');
    if (ack.accepted) { slAnswers = ack.yourAnswers || slAnswers; fb.textContent = ''; renderSLList(); Sounds.pointAwarded(); }
    else {
      if (ack.reason === 'letter') fb.textContent = `Must start with ${ack.letter} 🙂`;
      else if (ack.reason === 'dup') fb.textContent = 'You already got that one!';
      else fb.textContent = 'Try again…';
      Sounds.noPoint();
    }
  } else if (curMode === 'closest-wins') {
    const el = document.getElementById('p-cw-your');
    if (ack && ack.accepted) { el.textContent = `Your guess: ${ack.value} ✓`; Sounds.pointAwarded(); }
    else el.textContent = 'Enter a number!';
  } else if (curMode === 'the-big-bluff') {
    if (!ack) return;
    if (ack.stage === 'bluff') {
      if (ack.accepted) { myBluff = ack.text; document.getElementById('p-bb-your').textContent = `Your bluff: ${ack.text} ✓`; Sounds.pointAwarded(); }
    } else {
      const st = document.getElementById('p-vote-status');
      if (ack.accepted) { markVoteChosen(ack.optionId); st.textContent = 'Vote locked in ✓'; Sounds.pointAwarded(); }
      else if (ack.reason === 'own') st.textContent = "That's your own bluff! 😏";
    }
  }
  // Fastest Finger: nothing to show
});

socket.on('question', (d) => {
  setPlayerMode(d);
  if (d.mode === 'same-letter') showSLQuestion(d);
  else if (d.mode === 'closest-wins') showCWQuestion(d);
  else if (d.mode === 'the-big-bluff') showBBQuestion(d);
  else showFFQuestion(d);
});
function markVoteChosen(optId) {
  document.querySelectorAll('#p-vote-options .bb-vote-opt').forEach(el => { el.classList.add('locked'); if (el.dataset.optid === optId) el.classList.add('chosen'); });
}
function showBBQuestion(d) {
  curMode = 'the-big-bluff';
  if (d.stage === 'vote') {
    document.getElementById('p-vote-prompt').textContent = d.prompt;
    document.getElementById('p-vote-timer').textContent = d.seconds != null ? d.seconds : '';
    document.getElementById('p-vote-status').textContent = 'Tap the answer you think is TRUE';
    const box = document.getElementById('p-vote-options'); box.innerHTML = '';
    const nrm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const myNorm = nrm(myBluff);
    (d.options || []).forEach(o => {
      const el = document.createElement('div');
      const isMine = myNorm && nrm(o.text) === myNorm;
      el.className = 'bb-vote-opt' + (isMine ? ' mine' : '');
      el.dataset.optid = o.id;
      el.textContent = o.text + (isMine ? '  (your bluff)' : '');
      if (!isMine) el.addEventListener('click', () => socket.emit('submit', { optionId: o.id }));
      box.appendChild(el);
    });
    showScreen('screen-question-vote');
  } else {
    myBluff = '';
    document.getElementById('p-bb-prompt').textContent = d.prompt;
    document.getElementById('p-bb-timer').textContent = d.seconds != null ? d.seconds : '';
    document.getElementById('p-bb-input').value = '';
    document.getElementById('p-bb-your').textContent = '';
    showScreen('screen-question-bluff');
    setTimeout(() => { const el = document.getElementById('p-bb-input'); if (el) el.focus(); }, 60);
  }
}
function bbSubmit() { const inp = document.getElementById('p-bb-input'); const v = inp.value.trim(); if (!v) return; socket.emit('submit', { answer: v }); }
document.getElementById('p-bb-add').addEventListener('click', bbSubmit);
document.getElementById('p-bb-input').addEventListener('keydown', e => { if (e.key === 'Enter') bbSubmit(); });
function showCWQuestion(d) {
  curMode = 'closest-wins';
  document.getElementById('p-cw-meta').textContent = `Question ${d.qNumber} of ${d.qCount}`;
  document.getElementById('p-cw-question').textContent = d.question + (d.unit ? ` (${d.unit})` : '');
  document.getElementById('p-cw-timer').textContent = d.seconds != null ? d.seconds : '';
  document.getElementById('p-cw-input').value = '';
  document.getElementById('p-cw-your').textContent = '';
  showScreen('screen-question-cw');
  setTimeout(() => { const el = document.getElementById('p-cw-input'); if (el) el.focus(); }, 60);
}
function cwSubmit() {
  const inp = document.getElementById('p-cw-input'); const v = inp.value.trim();
  if (v === '') return;
  socket.emit('submit', { value: v });
}
document.getElementById('p-cw-add').addEventListener('click', cwSubmit);
document.getElementById('p-cw-input').addEventListener('keydown', e => { if (e.key === 'Enter') cwSubmit(); });
function showFFQuestion(d) {
  curMode = 'fastest-finger';
  answered = false; myChoice = null;
  document.getElementById('p-qmeta').textContent = `${d.category || ''} · Q${d.qNumber} of ${d.qCount}`;
  document.getElementById('p-question').textContent = d.question;
  document.getElementById('p-locked').style.display = 'none';
  renderOptions(d.options, {});
  showScreen('screen-question');
}
function showSLQuestion(d) {
  curMode = 'same-letter'; slAnswers = []; slLetter = d.letter;
  document.getElementById('p-sl-meta').textContent = `Prompt ${d.qNumber} of ${d.qCount}`;
  document.getElementById('p-sl-letter').textContent = d.letter;
  document.getElementById('p-sl-cat').textContent = `${d.category} starting with “${d.letter}”`;
  document.getElementById('p-sl-timer').textContent = d.seconds != null ? d.seconds : '';
  document.getElementById('p-sl-input').value = '';
  document.getElementById('p-sl-feedback').textContent = '';
  renderSLList();
  showScreen('screen-question-sl');
  setTimeout(() => { const el = document.getElementById('p-sl-input'); if (el) el.focus(); }, 60);
}
function renderSLList() {
  const box = document.getElementById('p-sl-list'); box.innerHTML = '';
  slAnswers.forEach(a => { const c = document.createElement('div'); c.className = 'sl-your-chip'; c.textContent = a; box.appendChild(c); });
}
function slSubmit() {
  const inp = document.getElementById('p-sl-input'); const v = inp.value.trim();
  if (!v) return;
  socket.emit('submit', { answer: v });
  inp.value = ''; inp.focus();
}
document.getElementById('p-sl-add').addEventListener('click', slSubmit);
document.getElementById('p-sl-input').addEventListener('keydown', e => { if (e.key === 'Enter') slSubmit(); });
socket.on('timer', ({ secondsLeft }) => {
  ['p-sl-timer', 'p-cw-timer', 'p-bb-timer', 'p-vote-timer'].forEach(id => { const t = document.getElementById(id); if (t) { t.textContent = secondsLeft; t.classList.toggle('low', secondsLeft <= 5); } });
});

socket.on('question-reveal', (d) => {
  if (d.mode === 'same-letter') showSLReveal(d, slAnswers);
  else if (d.mode === 'closest-wins') showCWReveal(d);
  else if (d.mode === 'the-big-bluff') showBBReveal(d);
  else showFFReveal(d);
});
function showBBReveal(d) {
  const mine = (d.results || []).find(r => r.playerId === playerId);
  const res = document.getElementById('p-bb-result');
  if (mine && mine.points > 0) {
    const bits = [];
    if (mine.foundTruth) bits.push('Found the truth!');
    if (mine.fooled) bits.push(`Fooled ${mine.fooled}!`);
    res.textContent = `${bits.join(' ')} +${mine.points}`;
    res.className = 'p-result win'; Sounds.pointAwarded();
  } else { res.textContent = 'Bluffed out — 0'; res.className = 'p-result lose'; Sounds.noPoint(); }
  document.getElementById('p-bb-truth').textContent = d.truth;
  renderScoreCards('p-bb-scores', d.scores);
  showScreen('screen-reveal-bluff');
}
function showCWReveal(d) {
  const mine = (d.results || []).find(r => r.playerId === playerId);
  document.getElementById('p-cw-answer').textContent = `${d.answer}${d.unit ? ' ' + d.unit : ''}`;
  const res = document.getElementById('p-cw-result');
  if (mine) { res.textContent = `You guessed ${mine.value} · +${mine.points}`; res.className = 'p-result ' + (mine.points >= 500 ? 'win' : (mine.points > 0 ? '' : 'lose')); }
  else { res.textContent = 'No guess this time'; res.className = 'p-result lose'; }
  (mine && mine.points > 0) ? Sounds.pointAwarded() : Sounds.noPoint();
  renderScoreCards('p-cw-scores', d.scores);
  showScreen('screen-reveal-cw');
}
function showFFReveal(d) {
  const mine = (d.results || []).find(r => r.playerId === playerId);
  const res = document.getElementById('p-result');
  if (mine && mine.correct) { res.textContent = `Correct! +${mine.points}`; res.className = 'p-result win'; Sounds.pointAwarded(); }
  else if (mine) { res.textContent = 'Not quite 😬'; res.className = 'p-result lose'; Sounds.noPoint(); }
  else { res.textContent = "Time's up ⏱"; res.className = 'p-result lose'; Sounds.noPoint(); }
  document.getElementById('p-correct').textContent = d.correct;
  renderScoreCards('p-scores', d.scores);
  showScreen('screen-reveal');
}
function showSLReveal(d, myAnswers) {
  const mine = (d.results || []).find(r => r.playerId === playerId);
  const pts = mine ? mine.points : 0;
  const res = document.getElementById('p-sl-result');
  res.textContent = pts > 0 ? `+${pts} points!` : 'No points this time';
  res.className = 'p-result ' + (pts > 0 ? 'win' : 'lose');
  pts > 0 ? Sounds.pointAwarded() : Sounds.noPoint();
  const nrm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const scored = new Set(), cancelled = new Set();
  (d.groups || []).forEach(g => (g.scored ? scored : cancelled).add(nrm(g.text)));
  const box = document.getElementById('p-sl-mine'); box.innerHTML = '';
  (myAnswers || []).forEach(a => { const c = document.createElement('div'); const n = nrm(a); c.className = 'sl-your-chip ' + (scored.has(n) ? 'scored' : (cancelled.has(n) ? 'cancelled' : '')); c.textContent = a; box.appendChild(c); });
  if (!(myAnswers || []).length) box.innerHTML = '<div style="color:var(--text-muted)">No answers this round</div>';
  renderScoreCards('p-sl-scores', d.scores);
  showScreen('screen-reveal-sl');
}

socket.on('round-over', (d) => { Sounds.go(); renderLeaderboard('p-ro-leaderboard', d.scores); showScreen('screen-round-over'); });
socket.on('game-over', ({ scores }) => { Sounds.gameOver(); clearSession(); renderLeaderboard('p-final-leaderboard', scores); showScreen('screen-game-over'); if (TOURNEY) setTimeout(() => { location.href = `/games/tournament/player.html?room=${TOURNEY.t}`; }, 3500); });
socket.on('host-disconnected', () => { clearSession(); showScreen('screen-host-gone'); });

// ── Snapshot router (reconnect) ──
function applySnapshot(s) {
  if (!s) return;
  if (s.teamNames) teamNames = s.teamNames;
  if (s.teamColors) { teamColors = s.teamColors; myTeamColor = teamColors[myTeamIndex] || myTeamColor; }
  if (s.roundMeta) setPlayerMode(s.roundMeta);
  switch (s.phase) {
    case 'question': {
      if (s.question && s.question.mode === 'same-letter') {
        showSLQuestion({ ...s.question, qNumber: s.qNumber, qCount: s.qCount, seconds: s.secondsLeft });
        slAnswers = (s.you && s.you.answers) || [];
        renderSLList();
      } else if (s.question && s.question.mode === 'closest-wins') {
        showCWQuestion({ ...s.question, qNumber: s.qNumber, qCount: s.qCount, seconds: s.secondsLeft });
        if (s.you && s.you.value != null) { document.getElementById('p-cw-input').value = s.you.value; document.getElementById('p-cw-your').textContent = `Your guess: ${s.you.value} ✓`; }
      } else if (s.question && s.question.mode === 'the-big-bluff') {
        if (s.you && s.you.stage === 'vote' && s.you.yourFake) myBluff = s.you.yourFake;
        showBBQuestion({ ...s.question, qNumber: s.qNumber, qCount: s.qCount, seconds: s.secondsLeft });
        if (s.you && s.you.stage === 'bluff' && s.you.fake) { myBluff = s.you.fake; document.getElementById('p-bb-input').value = s.you.fake; document.getElementById('p-bb-your').textContent = `Your bluff: ${s.you.fake} ✓`; }
        else if (s.you && s.you.stage === 'vote' && s.you.vote) { markVoteChosen(s.you.vote); document.getElementById('p-vote-status').textContent = 'Vote locked in ✓'; }
      } else {
        answered = !!(s.you && s.you.answered);
        myChoice = s.you ? s.you.choice : null;
        if (s.question) {
          document.getElementById('p-qmeta').textContent = `${s.question.category || ''} · Q${s.qNumber} of ${s.qCount}`;
          document.getElementById('p-question').textContent = s.question.question;
          renderOptions(s.question.options, answered ? { locked: true, chosen: myChoice } : {});
          const lb = document.getElementById('p-locked'); lb.style.display = answered ? 'block' : 'none'; if (answered) lb.textContent = `Locked in: ${LETTERS[myChoice]}`;
        }
        showScreen('screen-question');
      }
      break;
    }
    case 'question-reveal': {
      if (s.reveal && s.reveal.mode === 'same-letter') {
        showSLReveal(s.reveal, (s.you && s.you.answers) || slAnswers);
      } else if (s.reveal && s.reveal.mode === 'closest-wins') {
        showCWReveal(s.reveal);
      } else if (s.reveal && s.reveal.mode === 'the-big-bluff') {
        showBBReveal(s.reveal);
      } else if (s.reveal) {
        const mine = (s.reveal.results || []).find(r => r.playerId === playerId);
        const res = document.getElementById('p-result');
        if (mine && mine.correct) { res.textContent = `Correct! +${mine.points}`; res.className = 'p-result win'; }
        else if (mine) { res.textContent = 'Not quite 😬'; res.className = 'p-result lose'; }
        else { res.textContent = "Time's up ⏱"; res.className = 'p-result lose'; }
        document.getElementById('p-correct').textContent = s.reveal.correct;
        renderScoreCards('p-scores', s.reveal.scores || s.scores);
        showScreen('screen-reveal');
      } else { showScreen('screen-reveal'); }
      break;
    }
    case 'round-over': renderLeaderboard('p-ro-leaderboard', s.scores); showScreen('screen-round-over'); break;
    case 'game-over': renderLeaderboard('p-final-leaderboard', s.scores); showScreen('screen-game-over'); break;
    default: showScreen('screen-waiting');
  }
}

// ── Shared renderers ──
function renderScoreCards(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  scores.forEach(s => { const gold = s.color === '#FFD60A'; const card = document.createElement('div'); card.className = 'score-card'; card.style.cssText = `background:${s.color};color:${gold ? '#111' : '#fff'}`; card.innerHTML = `<div class="team-name">${escapeHtml(s.name)}</div><div class="score-num">${s.score}</div>`; c.appendChild(card); });
}
function renderLeaderboard(id, scores) {
  const c = document.getElementById(id); if (!c || !scores) return; c.innerHTML = '';
  [...scores].sort((a, b) => b.score - a.score).forEach((s, i) => { const w = i === 0; const row = document.createElement('div'); row.className = `lb-row${w ? ' winner' : ''}`; if (w) row.style.cssText = `background:${s.color}22;border-color:${s.color}`; row.innerHTML = `<div class="lb-rank">${w ? '👑' : i + 1}</div><div class="lb-name" style="color:${s.color}">${escapeHtml(s.name)}</div><div class="lb-score">${s.score}</div>`; c.appendChild(row); });
}
