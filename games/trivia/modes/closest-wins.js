// Trivia mode: Closest Wins — a numeric question; everyone guesses a number and
// points scale with how close you are (exact = 1000, fading to 0 as you drift
// past ~1.5× the answer away). The closest guess tops the round. Same pluggable
// interface as the other modes; timer-driven (host can cut it short).
let BANK = [];
try { BANK = require('../data/numeric.js').QUESTIONS || []; } catch (e) { BANK = []; }

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function pickQuestion(room) {
  let pool = BANK.filter(q => !room.usedQuestions.has('cw:' + norm(q.q)));
  if (!pool.length) pool = BANK.slice();
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
  meta: { key: 'closest-wins', name: 'Closest Wins', icon: '🎯', defaultSeconds: 30 },

  pickAndStart(room, cfg) {
    const q = pickQuestion(room);
    room.usedQuestions.add('cw:' + norm(q.q));
    room.currentQuestion = q;
    room.modeState = { answer: q.answer, unit: q.unit || '', guesses: new Map(), startedAt: Date.now() };
  },

  publicQuestion(room) {
    const q = room.currentQuestion;
    return { mode: 'closest-wins', question: q.q, unit: q.unit || '' };
  },

  // The engine reads this for the host's "N of M guessing" counter (our state
  // is keyed under `guesses`, not the default `answers`).
  progressCount(room) {
    return room.modeState ? room.modeState.guesses.size : 0;
  },

  submit(room, player, payload) {
    const m = room.modeState;
    if (!m) return { ok: false };
    const raw = String((payload && payload.value) != null ? payload.value : '').replace(/[^0-9.\-]/g, '');
    const v = Number(raw);
    if (raw === '' || !isFinite(v)) return { ok: true, ack: { accepted: false } };
    m.guesses.set(player.playerId, { value: v, name: player.name, teamIndex: player.teamIndex });  // last guess wins
    return { ok: true, ack: { accepted: true, value: v }, allAnswered: false };
  },

  score(room) {
    const m = room.modeState;
    const answer = m.answer;
    const denom = Math.max(Math.abs(answer) * 1.5, 10);
    const perTeam = {}, perPlayer = {};
    const results = [];
    for (const [pid, g] of m.guesses) {
      const error = Math.abs(g.value - answer);
      const points = Math.round(1000 * Math.max(0, 1 - error / denom));
      if (room.teams[g.teamIndex]) room.teams[g.teamIndex].score += points;
      perTeam[g.teamIndex] = (perTeam[g.teamIndex] || 0) + points;
      perPlayer[pid] = points;
      results.push({ playerId: pid, name: g.name, teamIndex: g.teamIndex, value: g.value, error, points });
    }
    results.sort((a, b) => a.error - b.error);   // closest first
    return { mode: 'closest-wins', question: room.currentQuestion.q, answer, unit: m.unit, results, roundPoints: perTeam };
  },

  youState(room, playerId) {
    const m = room.modeState;
    const g = m && m.guesses.get(playerId);
    return { value: g ? g.value : null };
  }
};
