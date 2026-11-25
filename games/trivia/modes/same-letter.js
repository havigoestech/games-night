// Trivia mode: Same Letter — a category + a letter; players type as many valid
// answers as they can in the time. An answer scores only if it starts with the
// letter AND nobody else said it (duplicates cancel — Scattergories-style).
// Reuses the engine's timer + submit plumbing; same mode interface as the others.
const { CATEGORIES, LETTERS } = require('../data/categories.js');

const POINTS_PER = 120;   // per unique valid answer
const MAX_LEN = 40;

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Reuse Text Twist's English dictionary to FLAG likely-gibberish answers for the
// host (we flag, not reject — tons of valid answers are names/brands/places that
// aren't in a dictionary). The host's tap-to-strike is the real gate.
let DICT = null;
try { DICT = require('../../text-twist/puzzles').dictionary; } catch (e) { DICT = null; }
function isFlagged(text) {
  if (!DICT) return false;
  const words = norm(text).split(' ').filter(Boolean);
  return words.length > 0 && !words.some(w => DICT.has(w));   // flagged only if NO word is a real word
}

module.exports = {
  meta: { key: 'same-letter', name: 'Same Letter', icon: '🔤', defaultSeconds: 60 },

  pickAndStart(room, cfg) {
    // Random category + letter each question; avoid an immediate repeat.
    let category, letter, key, tries = 0;
    do {
      category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
      letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
      key = 'sl:' + category + ':' + letter;
    } while (room.usedQuestions.has(key) && ++tries < 12);
    room.usedQuestions.add(key);
    room.currentQuestion = { category, letter };
    room.modeState = { category, letter, answers: new Map(), startedAt: Date.now() };
  },

  publicQuestion(room) {
    const q = room.currentQuestion;
    return { mode: 'same-letter', category: q.category, letter: q.letter };
  },

  submit(room, player, payload) {
    const m = room.modeState;
    if (!m) return { ok: false };
    let text = String((payload && payload.answer) || '').trim().slice(0, MAX_LEN);
    if (!text) return { ok: false };
    const firstAlnum = (text.match(/[a-z0-9]/i) || [''])[0].toUpperCase();
    if (firstAlnum !== m.letter) return { ok: true, ack: { accepted: false, reason: 'letter', answer: text, letter: m.letter } };
    const key = norm(text);
    if (!key) return { ok: true, ack: { accepted: false, reason: 'short', answer: text } };
    let entry = m.answers.get(player.playerId);
    if (!entry) { entry = { name: player.name, teamIndex: player.teamIndex, list: [] }; m.answers.set(player.playerId, entry); }
    if (entry.list.some(a => a.norm === key)) return { ok: true, ack: { accepted: false, reason: 'dup', answer: text, yourAnswers: entry.list.map(a => a.text) } };
    entry.list.push({ norm: key, text });
    return { ok: true, ack: { accepted: true, answer: text, yourAnswers: entry.list.map(a => a.text) }, allAnswered: false };
  },

  score(room) {
    const m = room.modeState;
    // Tally every answer across all players by its normalised form.
    const tally = new Map();   // norm -> [{ playerId, name, teamIndex, text }]
    for (const [pid, entry] of m.answers) {
      for (const a of entry.list) {
        if (!tally.has(a.norm)) tally.set(a.norm, []);
        tally.get(a.norm).push({ playerId: pid, name: entry.name, teamIndex: entry.teamIndex, text: a.text });
      }
    }
    const perTeam = {}, perPlayer = {};
    const groups = [];
    for (const [, subs] of tally) {
      const scored = subs.length === 1;              // unique → scores; shared → cancelled
      const g = { text: subs[0].text, count: subs.length, names: subs.map(s => s.name), scored, struck: false, flagged: isFlagged(subs[0].text) };
      if (scored) { g.scoredTeam = subs[0].teamIndex; g.scoredPlayerId = subs[0].playerId; }
      groups.push(g);
      if (scored) {
        const s = subs[0];
        if (room.teams[s.teamIndex]) room.teams[s.teamIndex].score += POINTS_PER;
        perTeam[s.teamIndex] = (perTeam[s.teamIndex] || 0) + POINTS_PER;
        perPlayer[s.playerId] = (perPlayer[s.playerId] || 0) + POINTS_PER;
      }
    }
    const results = [];
    for (const [pid, entry] of m.answers) {
      const unique = entry.list.filter(a => tally.get(a.norm).length === 1).length;
      results.push({ playerId: pid, name: entry.name, teamIndex: entry.teamIndex, total: entry.list.length, unique, points: perPlayer[pid] || 0 });
    }
    results.sort((a, b) => b.points - a.points);
    groups.sort((a, b) => (b.scored - a.scored) || (a.count - b.count) || a.text.localeCompare(b.text));
    return { mode: 'same-letter', category: m.category, letter: m.letter, groups, results, roundPoints: perTeam };
  },

  // Host tap-to-strike at the reveal: toggles an answer in/out and adjusts the
  // scoring player's team score + per-player points. Operates on the live reveal.
  hostAction(room, payload) {
    if (!payload || payload.type !== 'strike' || !room.currentReveal) return false;
    const rev = room.currentReveal;
    const g = rev.groups.find(x => x.text === payload.text);
    if (!g) return false;
    g.struck = !g.struck;
    if (g.scoredTeam != null && room.teams[g.scoredTeam]) {
      const delta = g.struck ? -POINTS_PER : POINTS_PER;
      room.teams[g.scoredTeam].score += delta;
      const pr = (rev.results || []).find(r => r.playerId === g.scoredPlayerId);
      if (pr) { pr.points += delta; pr.unique += g.struck ? -1 : 1; }
    }
    return true;
  },

  youState(room, playerId) {
    const m = room.modeState;
    const entry = m && m.answers.get(playerId);
    return { answers: entry ? entry.list.map(a => a.text) : [] };
  }
};
