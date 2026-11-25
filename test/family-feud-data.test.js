// Data-integrity test for the Family Feud question bank.
// Pure assertions over games/family-feud/questions.js — no server, no sockets.
// Mirrors the "puzzle bank integrity" pattern in text-twist.test.js.
//
// Run with: npm run test:ff-data

const mod = require('../games/family-feud/questions.js');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✅', label); }
  else      { failed++; console.log('  ❌', label); }
}

console.log('── Family Feud question-bank integrity ──');

ok(mod && Array.isArray(mod.QUESTIONS), 'module exports { QUESTIONS: [...] }');
const QUESTIONS = (mod && mod.QUESTIONS) || [];

ok(QUESTIONS.length > 1000, `bank is large (${QUESTIONS.length} questions)`);

let badQ = 0, badAnswers = 0, badClean = 0, dupAnswer = 0, countOutOfRange = 0;
let minA = Infinity, maxA = 0, minP = Infinity, maxP = -Infinity;
const seenQ = new Map();
let dupQuestion = 0;

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

for (const q of QUESTIONS) {
  if (!q || typeof q.q !== 'string' || !q.q.trim()) { badQ++; continue; }

  // unique question text across the whole bank
  const key = norm(q.q);
  if (seenQ.has(key)) dupQuestion++; else seenQ.set(key, true);

  if (!Array.isArray(q.a)) { badAnswers++; continue; }
  if (q.a.length < 3 || q.a.length > 8) countOutOfRange++;
  minA = Math.min(minA, q.a.length);
  maxA = Math.max(maxA, q.a.length);

  const seenA = new Set();
  for (const a of q.a) {
    if (!a || typeof a.t !== 'string' || !a.t.trim()) { badAnswers++; break; }
    if (!Number.isFinite(a.p) || a.p < 0) { badAnswers++; break; }
    minP = Math.min(minP, a.p);
    maxP = Math.max(maxP, a.p);
    const ak = a.t.toLowerCase().trim();
    if (seenA.has(ak)) { dupAnswer++; break; }
    seenA.add(ak);
  }

  if (typeof q.clean !== 'boolean') badClean++;
}

ok(badQ === 0, `every question has a non-empty string prompt (${badQ} bad)`);
ok(badAnswers === 0, `every question has valid { t, p } answers (${badAnswers} bad)`);
ok(countOutOfRange === 0, `every question has 3–8 answers (min ${minA}, max ${maxA}; ${countOutOfRange} out of range)`);
ok(dupAnswer === 0, `no duplicate answer text within a question (${dupAnswer} offenders)`);
ok(dupQuestion === 0, `no duplicate question across the bank (${dupQuestion} dupes)`);
ok(badClean === 0, `every question has a boolean 'clean' flag (${badClean} missing)`);

const cleanCount = QUESTIONS.filter(q => q.clean).length;
const rudeCount = QUESTIONS.length - cleanCount;
ok(cleanCount > 0 && rudeCount > 0, `filter is meaningful: ${cleanCount} clean / ${rudeCount} rude`);
ok(cleanCount > rudeCount, 'clean questions are the majority');

console.log(`\n  points range: ${minP}–${maxP} | answer-count range: ${minA}–${maxA}`);
console.log(`  clean ${cleanCount} / rude ${rudeCount} (${(100 * rudeCount / QUESTIONS.length).toFixed(1)}% rude)`);
console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
process.exit(failed ? 1 : 0);
