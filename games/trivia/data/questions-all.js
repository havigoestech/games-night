// The full trivia bank = the harvested Open Trivia DB questions (questions-mc.js)
// plus the hand-written "Naija & Black Culture" set (questions-naija.js). Every
// consumer (the MC modes, the category list, the tournament builder meta, the
// answer-lookup tests) reads THIS so the hand-written set is never lost when the
// harvested file is regenerated.
const mc    = (() => { try { return require('./questions-mc.js').QUESTIONS    || []; } catch (e) { return []; } })();
const naija = (() => { try { return require('./questions-naija.js').QUESTIONS || []; } catch (e) { return []; } })();
module.exports = { QUESTIONS: mc.concat(naija) };
