// Data-integrity test for the No Say Am card bank.
// No server needed — just validates the shape and quality of every card.
// Run: npm run test:nsa-data
const { CARDS } = require('../games/no-say-am/data/cards.js');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('  ✅', l); } else { failed++; console.log('  ❌', l); } };
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

console.log('\n── No Say Am card bank ──');
ok(Array.isArray(CARDS) && CARDS.length >= 120, `card bank has a healthy size (${CARDS.length})`);

let badShape = 0, wordInOwnTaboo = 0, dupTabooInCard = 0;
const seenWords = new Set();
let dupWords = 0;
for (const c of CARDS) {
  if (!c || typeof c.word !== 'string' || !c.word.trim() || !Array.isArray(c.taboo) || c.taboo.length !== 5 || c.taboo.some(t => typeof t !== 'string' || !t.trim())) { badShape++; continue; }
  const w = norm(c.word);
  if (seenWords.has(w)) dupWords++;
  seenWords.add(w);
  const tset = new Set();
  for (const t of c.taboo) {
    const nt = norm(t);
    if (nt === w) wordInOwnTaboo++;          // the answer must never be its own taboo word
    if (tset.has(nt)) dupTabooInCard++;      // no duplicate taboo words within one card
    tset.add(nt);
  }
}
ok(badShape === 0, `every card is { word, taboo:[5 non-empty strings] } (bad: ${badShape})`);
ok(dupWords === 0, `no duplicate answer words (dups: ${dupWords})`);
ok(wordInOwnTaboo === 0, `no card lists its own answer as a taboo word (violations: ${wordInOwnTaboo})`);
ok(dupTabooInCard === 0, `no card repeats a taboo word (violations: ${dupTabooInCard})`);

const naija = CARDS.filter(c => c.naija).length;
ok(naija >= 20, `has a solid Nigerian/African layer (${naija} cards)`);
ok(CARDS.length - naija >= 80, `and a broad general layer (${CARDS.length - naija} cards)`);

console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
process.exit(failed ? 1 : 0);
