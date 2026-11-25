// Data-integrity test for the Trivia multiple-choice bank.
// Pure assertions over games/trivia/data/questions-mc.js — no server.
// Run: npm run test:trivia-data

const mod = require('../games/trivia/data/questions-mc.js');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('  ✅', l); } else { failed++; console.log('  ❌', l); } };

console.log('── Trivia MC bank integrity ──');
ok(mod && Array.isArray(mod.QUESTIONS), 'module exports { QUESTIONS: [...] }');
const Q = (mod && mod.QUESTIONS) || [];
ok(Q.length > 500, `bank is sizeable (${Q.length} questions)`);

let bad = 0, badWrong = 0, badClean = 0, dupe = 0, badCat = 0;
const seen = new Set();
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
for (const q of Q) {
  if (!q || typeof q.q !== 'string' || !q.q.trim() || typeof q.correct !== 'string' || !q.correct.trim()) { bad++; continue; }
  if (!Array.isArray(q.wrong) || q.wrong.length !== 3 || q.wrong.some(w => typeof w !== 'string' || !w.trim())) badWrong++;
  if (q.wrong && q.wrong.map(norm).includes(norm(q.correct))) badWrong++;   // a wrong answer equals the correct one
  if (typeof q.clean !== 'boolean') badClean++;
  if (typeof q.cat !== 'string' || !q.cat.trim()) badCat++;
  const k = norm(q.q); if (seen.has(k)) dupe++; else seen.add(k);
}
ok(bad === 0, `every question has a prompt + correct answer (${bad} bad)`);
ok(badWrong === 0, `every question has exactly 3 distinct wrong answers (${badWrong} bad)`);
ok(badCat === 0, `every question has a category (${badCat} missing)`);
ok(badClean === 0, `every question has a boolean clean flag (${badClean} missing)`);
ok(dupe === 0, `no duplicate questions (${dupe} dupes)`);

const clean = Q.filter(q => q.clean).length;
const cats = new Set(Q.map(q => q.cat)).size;
ok(clean > 0 && clean <= Q.length, `clean filter is meaningful: ${clean} clean / ${Q.length - clean} flagged`);
console.log(`\n  ${cats} categories · ${clean} clean / ${Q.length - clean} flagged`);
console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
process.exit(failed ? 1 : 0);
