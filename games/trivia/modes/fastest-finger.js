// Trivia mode: Fastest Finger — classic multiple choice with a speed bonus.
//
// Mode interface used by the engine (games/trivia/game.js):
//   meta                      — { key, name, icon, defaultSeconds }
//   pickAndStart(room, cfg)   — choose a question (respect category/difficulty/clean/no-repeat),
//                               store it on room.currentQuestion + init room.modeState
//   publicQuestion(room)      — the answer-LESS payload players/host see
//   submit(room, player, p)   — record a player's answer; returns { ok, allAnswered }
//   score(room)               — apply points to room.teams[i].score; return reveal data (no scores)
//   youState(room, playerId)  — per-player bit for snapshots (have they answered, what did they pick)

let BANK = [];
try { BANK = require('../data/questions-all.js').QUESTIONS || []; } catch (e) { BANK = []; }

const BASE_POINTS = 500;   // for any correct answer
const SPEED_BONUS = 500;   // extra, scaled by how fast (instant ≈ +500, buzzer ≈ +0)

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Fandom-heavy categories that make "Any" feel too niche — excluded from the
// default pool (still pickable on purpose by selecting the category).
const NICHE = new Set(['Japanese Anime & Manga', 'Cartoon & Animations', 'Video Games', 'Board Games', 'Comics']);

// Session-level no-repeat: remember recently served questions ACROSS rooms (not
// just within one game) so the same ones don't resurface game-after-game during
// a sitting. Picks are biased away from them; the oldest is evicted when full.
const RECENT = new Set();
const RECENT_ORDER = [];
const RECENT_MAX = 400;
function rememberServed(q) {
  const k = norm(q.q);
  if (RECENT.has(k)) return;
  RECENT.add(k); RECENT_ORDER.push(k);
  if (RECENT_ORDER.length > RECENT_MAX) RECENT.delete(RECENT_ORDER.shift());
}

function pickQuestion(room, cfg) {
  const wantCat = cfg.category && cfg.category !== 'any' ? cfg.category : null;
  const wantDiff = cfg.difficulty && cfg.difficulty !== 'any' ? cfg.difficulty : null;
  const match = q =>
    // "Any category" skips the nerdy fandom categories; a chosen category is honoured as-is.
    (wantCat ? q.cat === wantCat : !NICHE.has(q.cat)) &&
    // "Any difficulty" leans easier (drops hard) for a friendlier default; a chosen difficulty is honoured.
    (wantDiff ? q.diff === wantDiff : q.diff !== 'hard') &&
    (!room.familyFriendly || q.clean !== false);
  let pool = BANK.filter(q => match(q) && !room.usedQuestions.has(norm(q.q)) && !RECENT.has(norm(q.q)));
  if (!pool.length) pool = BANK.filter(q => match(q) && !room.usedQuestions.has(norm(q.q))); // allow recently-served
  if (!pool.length) pool = BANK.filter(match);                 // ran out — allow repeats
  if (!pool.length) pool = BANK.filter(q => !room.familyFriendly || q.clean !== false); // ignore cat/diff
  if (!pool.length) pool = BANK.slice();
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
  meta: { key: 'fastest-finger', name: 'Fastest Finger', icon: '⚡', defaultSeconds: 20 },

  pickAndStart(room, cfg) {
    const q = pickQuestion(room, cfg);
    room.usedQuestions.add(norm(q.q));
    rememberServed(q);
    const options = shuffle([q.correct, ...q.wrong.slice(0, 3)]);
    room.currentQuestion = q;
    room.modeState = {
      options,
      correctIndex: options.indexOf(q.correct),
      answers: new Map(),                 // playerId -> { choice, at, teamIndex, name }
      startedAt: Date.now(),
      totalMs: (cfg.seconds || this.meta.defaultSeconds) * 1000
    };
  },

  publicQuestion(room) {
    const q = room.currentQuestion, m = room.modeState;
    return { mode: 'fastest-finger', question: q.q, options: m.options, category: q.cat, difficulty: q.diff };
  },

  submit(room, player, payload) {
    const m = room.modeState;
    if (!m) return { ok: false };
    const choice = parseInt(payload && payload.choice, 10);
    if (isNaN(choice) || choice < 0 || choice >= m.options.length) return { ok: false };
    if (m.answers.has(player.playerId)) return { ok: true, already: true };  // first answer locks in
    m.answers.set(player.playerId, { choice, at: Date.now(), teamIndex: player.teamIndex, name: player.name });
    const connected = room.players.filter(p => p.connected).length;
    return { ok: true, choice, allAnswered: connected > 0 && m.answers.size >= connected };
  },

  score(room) {
    const m = room.modeState;
    const perTeam = {};
    const results = [];
    const distribution = m.options.map(() => 0);
    for (const [pid, a] of m.answers) {
      distribution[a.choice]++;
      const correct = a.choice === m.correctIndex;
      let pts = 0;
      if (correct) {
        const frac = Math.max(0, (m.totalMs - (a.at - m.startedAt)) / m.totalMs);
        pts = Math.round(BASE_POINTS + SPEED_BONUS * frac);
      }
      perTeam[a.teamIndex] = (perTeam[a.teamIndex] || 0) + pts;   // members add to their team
      results.push({ playerId: pid, name: a.name, teamIndex: a.teamIndex, choice: a.choice, correct, points: pts });
    }
    for (const ti of Object.keys(perTeam)) {
      if (room.teams[ti]) room.teams[ti].score += perTeam[ti];
    }
    results.sort((x, y) => y.points - x.points);
    return {
      mode: 'fastest-finger',
      question: room.currentQuestion.q,
      options: m.options,
      correctIndex: m.correctIndex,
      correct: m.options[m.correctIndex],
      distribution,
      results,
      roundPoints: perTeam
    };
  },

  youState(room, playerId) {
    const m = room.modeState;
    if (!m) return { answered: false };
    const a = m.answers.get(playerId);
    return a ? { answered: true, choice: a.choice } : { answered: false };
  }
};
