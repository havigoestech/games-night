// Trivia mode: Same Letter · Round — a trivia-led round where ONE letter is
// fixed for the whole round and every question is a SPECIFIC trivia question
// whose single correct answer starts with that letter. The round announces it
// ("Every answer this round starts with L"), then serves `count` questions like
// "What is the most populated city in the UK?" → London.
//
// Players TYPE their answer (the letter is the recall hint). We auto-grade it
// against the known correct answer — tolerant of case, punctuation, a leading
// "the/a/an" and small typos — and the host can tap any answer at the reveal to
// accept one the auto-check missed (or un-accept one). Scoring is base + a speed
// bonus for a correct answer, exactly like Fastest Finger, so a mixed-mode
// leaderboard stays fair.
//
// Content: the existing Open Trivia DB multiple-choice bank, re-indexed by the
// first letter of each answer (we keep only recall-style questions with a short,
// alphabetic answer — no "which of these…" and no numeric/date answers).
const { QUESTIONS } = require('../data/questions-mc.js');

const BASE_POINTS = 500;   // any correct answer
const SPEED_BONUS = 500;   // extra, scaled by how fast (instant ≈ +500)
const MAX_LEN = 40;
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
// Fandom-heavy categories that make a general party round feel too niche —
// excluded here, same as Fastest Finger's default pool.
const NICHE = new Set(['Japanese Anime & Manga', 'Cartoon & Animations', 'Video Games', 'Board Games', 'Comics']);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Normalise for comparison: drop a leading article, lowercase, strip punctuation.
const stripArticle = s => String(s).trim().replace(/^(the|a|an)\s+/i, '');
const gnorm = s => stripArticle(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const firstLetter = a => { const w = stripArticle(a); return /^[a-z]/i.test(w) ? w[0].toUpperCase() : null; };
const wordCount = a => stripArticle(a).split(/\s+/).filter(Boolean).length;
// Questions that only make sense when you can see the options — not open recall.
const isBadQ = q => /(which of these|which of the following|of the following|of these|which one of|all of the(se)?|none of the(se)?|following is|following are)/i.test(q);

// Acceptable normalised forms for a correct answer (the whole thing, and the part
// before a comma — "Maine, United States" → also accept "Maine").
function acceptableForms(correct) {
  const forms = new Set();
  const base = gnorm(correct); if (base) forms.add(base);
  const beforeComma = gnorm(String(correct).split(',')[0]); if (beforeComma) forms.add(beforeComma);
  return forms;
}
function isCorrect(raw, correct) {
  const p = gnorm(raw);
  if (!p) return false;
  // Auto-accept ONLY on an exact match (ignoring case, punctuation and a leading
  // "the/a/an"). No fuzzy/typo tolerance — the answer is specific, so "quatrillion"
  // must NOT pass for "quadrillion". The host can still tap-to-accept a genuine
  // misspelling at the reveal.
  for (const f of acceptableForms(correct)) {
    if (p === f) return true;
  }
  return false;
}

// Build the letter index once at load: letter -> [{ q, correct, cat, diff, clean }].
const INDEX = (() => {
  const idx = {};
  for (const q of (QUESTIONS || [])) {
    if (isBadQ(q.q)) continue;
    if (NICHE.has(q.cat)) continue;         // no fandom trivia in a general round
    const L = firstLetter(q.correct);
    if (!L) continue;                       // numeric/date/symbol answer — skip
    if (wordCount(q.correct) > 2) continue; // keep answers short + typeable ("London", "Leo Tolstoy")
    (idx[L] = idx[L] || []).push({ q: q.q, correct: q.correct, cat: q.cat, diff: q.diff, clean: q.clean });
  }
  return idx;
})();

function computePts(at, startedAt, totalMs) {
  const frac = Math.max(0, (totalMs - (at - startedAt)) / (totalMs || 1));
  return Math.round(BASE_POINTS + SPEED_BONUS * frac);
}

module.exports = {
  meta: { key: 'same-letter-round', name: 'Same Letter · Round', icon: '🔠', defaultSeconds: 30 },

  // Engine hook, once per round: fix ONE letter that has enough questions for the
  // round, pre-pick that many distinct questions, and announce the letter.
  startRound(room, round) {
    const need = Math.max(1, Math.min(parseInt(round.count) || 3, 12));
    const clean = !!room.familyFriendly;
    const bucketFor = L => (INDEX[L] || []).filter(e => !clean || e.clean !== false);

    const usable = ALPHA.filter(L => bucketFor(L).length >= need);
    const pool = usable.length ? usable : ALPHA.filter(L => bucketFor(L).length > 0);
    const letter = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 'A';

    // Prefer short, single-word, easy/medium answers (the "London" sweet spot),
    // falling back to longer/harder ones; avoid questions already used this game.
    const bucket = bucketFor(letter);
    const nonHard = bucket.filter(e => e.diff !== 'hard');
    const ordered = shuffle(nonHard.filter(e => wordCount(e.correct) === 1))
      .concat(shuffle(nonHard.filter(e => wordCount(e.correct) >= 2)))
      .concat(shuffle(bucket.filter(e => e.diff === 'hard')));
    const fresh = ordered.filter(e => !room.usedQuestions.has('lt:' + e.q));
    const chosen = (fresh.length >= need ? fresh : ordered).slice(0, need);
    chosen.forEach(e => room.usedQuestions.add('lt:' + e.q));

    round._letter = letter;
    round._roundNote = 'Every answer this round starts with ' + letter;
    round._questions = chosen;
    round.count = chosen.length || 1;   // if a thin letter had fewer, shrink the round to match
  },

  // Each question = the next pre-picked question for the round (same letter).
  pickAndStart(room, cfg) {
    const qs = cfg._questions || [];
    const i = Math.max(0, room.qIndexInRound);
    const entry = qs[i] || qs[qs.length - 1] || { q: '—', correct: '—', cat: '', diff: '' };
    room.currentQuestion = { q: entry.q, correct: entry.correct, cat: entry.cat, diff: entry.diff };
    room.modeState = {
      correct: entry.correct,
      category: entry.cat,
      letter: cfg._letter || firstLetter(entry.correct) || '?',
      answers: new Map(),                 // playerId -> { raw, at, teamIndex, name }
      startedAt: Date.now(),
      totalMs: (parseInt(cfg.seconds) || this.meta.defaultSeconds) * 1000
    };
  },

  // Answer-LESS payload (never leaks `correct`).
  publicQuestion(room) {
    const q = room.currentQuestion, m = room.modeState;
    return { mode: 'letter-trivia', question: q.q, letter: m.letter, category: q.cat };
  },

  submit(room, player, payload) {
    const m = room.modeState;
    if (!m) return { ok: false };
    const text = String((payload && payload.answer) || '').trim().slice(0, MAX_LEN);
    if (!text) return { ok: false };
    const existing = m.answers.get(player.playerId);
    if (existing) return { ok: true, ack: { received: true, answer: existing.raw, already: true } }; // first answer locks in
    m.answers.set(player.playerId, { raw: text, at: Date.now(), teamIndex: player.teamIndex, name: player.name });
    const connected = room.players.filter(p => p.connected).length;
    return { ok: true, ack: { received: true, answer: text }, allAnswered: connected > 0 && m.answers.size >= connected };
  },

  score(room) {
    const m = room.modeState;
    const perTeam = {};
    const results = [];
    for (const [pid, a] of m.answers) {
      const auto = isCorrect(a.raw, m.correct);
      const pts = computePts(a.at, m.startedAt, m.totalMs);   // what it's worth IF correct
      if (auto && room.teams[a.teamIndex]) { room.teams[a.teamIndex].score += pts; perTeam[a.teamIndex] = (perTeam[a.teamIndex] || 0) + pts; }
      results.push({ playerId: pid, name: a.name, teamIndex: a.teamIndex, answer: a.raw, auto, accepted: auto, correct: auto, pts, points: auto ? pts : 0 });
    }
    results.sort((x, y) => (y.correct - x.correct) || (y.pts - x.pts));
    return { mode: 'letter-trivia', question: room.currentQuestion.q, correct: m.correct, letter: m.letter, category: m.category, results, roundPoints: perTeam };
  },

  // Host tap-to-accept at the reveal: toggle whether a player's typed answer counts
  // as correct, adjusting their team's score by the points it's worth. Toggle-safe.
  hostAction(room, payload) {
    if (!payload || payload.type !== 'accept' || !room.currentReveal) return false;
    const rev = room.currentReveal;
    const r = (rev.results || []).find(x => x.playerId === payload.playerId);
    if (!r) return false;
    r.accepted = !r.accepted;
    r.correct = r.accepted;
    const delta = r.accepted ? r.pts : -r.pts;
    if (room.teams[r.teamIndex]) room.teams[r.teamIndex].score += delta;
    r.points = r.accepted ? r.pts : 0;
    rev.roundPoints[r.teamIndex] = (rev.roundPoints[r.teamIndex] || 0) + delta;
    return true;
  },

  youState(room, playerId) {
    const m = room.modeState;
    const a = m && m.answers.get(playerId);
    return a ? { answered: true, answer: a.raw } : { answered: false };
  }
};
