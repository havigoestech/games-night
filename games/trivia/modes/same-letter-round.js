// Trivia mode: Same Letter · Round — a "version 2" of Same Letter where ONE
// letter is fixed for the whole round. The round announces it ("Every answer
// starts with M"), then each question is a different category but every answer
// must start with that same letter. Count (questions in the round) comes from
// the setup screen.
//
// Reuses all of Same Letter's collection, duplicate-cancel scoring, dictionary
// flagging and host tap-to-strike — the ONLY differences are: the letter is
// chosen once per round (startRound) instead of per question, and the category
// still varies each question. It reports mode:'same-letter' from publicQuestion
// and score (inherited), so the client renders it with the Same Letter screens.
const base = require('./same-letter.js');
const { CATEGORIES, LETTERS } = require('../data/categories.js');

module.exports = {
  ...base,
  meta: { key: 'same-letter-round', name: 'Same Letter · Round', icon: '🔠', defaultSeconds: 60 },

  // Called once when the round begins (engine hook): fix ONE letter for every
  // question this round, and hand the engine a line to announce at round-intro.
  startRound(room, round) {
    round._letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    round._roundNote = 'Every answer this round starts with ' + round._letter;
  },

  // Each question keeps the round's letter; only the category changes.
  pickAndStart(room, cfg) {
    const letter = cfg._letter || LETTERS[Math.floor(Math.random() * LETTERS.length)];
    let category, key, tries = 0;
    do {
      category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
      key = 'slr:' + category + ':' + letter;
    } while (room.usedQuestions.has(key) && ++tries < 24);
    room.usedQuestions.add(key);
    room.currentQuestion = { category, letter };
    room.modeState = { category, letter, answers: new Map(), startedAt: Date.now() };
  }
};
