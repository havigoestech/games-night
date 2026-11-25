#!/usr/bin/env node
/*
 * build-questions.js — regenerates games/family-feud/questions.js
 *
 * Merges the original hand-written seed (questions.seed.js) with the public
 * "Family Feud Question Database" Google Sheet, cleans the data, tags each
 * question clean/rude for the host's family-friendly filter, and writes the
 * combined bank.
 *
 * Run:  node games/family-feud/build-questions.js
 *
 * Re-run any time to refresh from the sheet. Output is deterministic.
 */
const fs = require('fs');
const path = require('path');

const SHEET_ID = '1y5TtM4rXHfv_9BktCiJEW621939RzJucXxhJidJZbfQ';
// Tabs to import. Fast Money / No-Points / Sheet1 are deliberately skipped:
// the game has no Fast Money round and no-points rows are unusable.
const TABS = ['3 Answers', '4 Answers', '5 Answers', '6 Answers', '7 Answers'];
const MIN_ANSWERS = 3;   // a usable Feud question needs at least this many
const MAX_ANSWERS = 8;   // board is dynamic, but cap defensively

// ── Clean/rude classifier ──────────────────────────────────────────────
// Biased to HIDE: a wrongly-hidden clean question just shrinks the pool,
// but a rude one shown to kids is the failure we care about. The list
// targets clear adult/innuendo/profanity content and deliberately avoids
// ambiguous stems that cause silly false positives (e.g. bare "high"
// catching "high school", "drinking" catching "drinking fountain",
// "kiss"/"divorce"/"bedroom" which are usually innocent). Tune freely.
const RUDE = new RegExp('\\b(' + [
  // sexual / body
  'sex', 'sexy', 'sexier', 'sexiest', 'sexual', 'sexually', 'seduce', 'seductive',
  'naked', 'nude', 'nudist', 'topless', 'boob', 'boobs', 'breast', 'breasts',
  'nipple', 'nipples', 'cleavage', 'butt', 'booty', 'buttock', 'buttocks',
  'penis', 'vagina', 'genital', 'genitals', 'erection', 'boner', 'orgasm',
  'condom', 'condoms', 'viagra', 'porn', 'porno', 'pornography', 'stripper',
  'striptease', 'lingerie', 'thong', 'thongs', 'bra', 'bras', 'horny', 'kinky',
  'fetish', 'foreplay', 'orgy', 'brothel', 'hooker', 'hookers', 'prostitute',
  'prostitution', 'escort', 'threesome', 'dildo', 'vibrator', 'bdsm', 'hickey',
  'cougar', 'playboy', 'bikini', 'underwear', 'panties', 'cellulite',
  // romance / innuendo
  'lover', 'lovers', 'mistress', 'affair', 'affairs', 'adultery', 'raunchy',
  // substances
  'drunk', 'drunken', 'wasted', 'hungover', 'hangover', 'booze', 'boozy',
  'stoned', 'weed', 'marijuana', 'cocaine', 'heroin', 'meth', 'ecstasy',
  'drug', 'drugs', 'hookah', 'bong',
  // crude body
  'fart', 'farts', 'farting', 'poop', 'poops', 'pee', 'peeing', 'peed',
  'urine', 'urinal', 'diarrhea', 'diarrhoea',
  // mild profanity
  'damn', 'hell', 'crap', 'ass', 'asses', 'bastard', 'bitch', 'piss', 'pissed',
  'douche', 'slut', 'whore', 'hoe', 'skank',
].join('|') + ')\\b', 'i');

// Multi-word / phrase patterns (space-bearing innuendo).
const RUDE_PHRASES = [
  /one[\s-]night stand/i, /hook(ing|ed)? up/i, /hookup/i, /make out/i,
  /making out/i, /french kiss/i, /friends with benefits/i, /booty call/i,
  /sugar daddy/i, /netflix and chill/i, /get(ting)? laid/i, /get lucky/i,
  /sleep(ing)? with/i, /\bin bed\b/i, /sex symbol/i, /sex life/i, /love life/i,
  /cheat(ing|ed)? on/i, /get(ting)? high\b/i, /high as a kite/i, /turn[\s-]?on\b/i,
  /strip club/i, /adult (film|movie|store)/i, /\bg[\s-]?string\b/i,
];

// Manual overrides keyed by the normalised question text (see normQ).
// Add here to correct any miss the heuristic makes.
const FORCE_RUDE = new Set([]);
const FORCE_CLEAN = new Set([]);

function isClean(q, answers) {
  const blob = q + ' ' + answers.map(a => a.t).join(' ');
  const key = normQ(q);
  if (FORCE_RUDE.has(key)) return false;
  if (FORCE_CLEAN.has(key)) return true;
  if (RUDE.test(blob)) return false;
  for (const p of RUDE_PHRASES) if (p.test(blob)) return false;
  return true;
}

// ── CSV parsing (quote-aware, handles embedded commas/quotes/newlines) ──
function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c === '\r') { /* ignore */ }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function normQ(q) {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanRow(fields) {
  const q = (fields[0] || '').trim();
  if (!q || normQ(q) === 'question') return null;
  const answers = [];
  const seen = new Set();
  for (let i = 1; i + 1 < fields.length; i += 2) {
    const t = (fields[i] || '').trim();
    const p = parseInt((fields[i + 1] || '').trim(), 10);
    if (!t || !Number.isFinite(p)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) {           // dedupe duplicate answers within a question
      const prev = answers.find(a => a.t.toLowerCase() === key);
      if (prev && p > prev.p) prev.p = p;
      continue;
    }
    seen.add(key);
    answers.push({ t, p });
    if (answers.length >= MAX_ANSWERS) break;
  }
  if (answers.length < MIN_ANSWERS) return null;
  return { q, a: answers };
}

async function fetchTab(name) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for "${name}"`);
    return await res.text();
  } finally { clearTimeout(timer); }
}

(async () => {
  const seed = require('./questions.seed.js').map(q => ({ ...q, clean: true }));
  const byKey = new Map();
  for (const q of seed) byKey.set(normQ(q.q), q);  // seed wins over imports
  console.log(`Seed: ${seed.length} hand-written questions.`);

  let rawRows = 0, dropped = 0, dupes = 0, imported = 0;
  for (const tab of TABS) {
    const csv = await fetchTab(tab);
    const rows = parseCSV(csv);
    let tabCount = 0;
    for (let r = 0; r < rows.length; r++) {
      if (r === 0 && normQ(rows[r][0] || '') === 'question') continue;
      rawRows++;
      const cleaned = cleanRow(rows[r]);
      if (!cleaned) { dropped++; continue; }
      const key = normQ(cleaned.q);
      if (byKey.has(key)) { dupes++; continue; }
      cleaned.clean = isClean(cleaned.q, cleaned.a);
      byKey.set(key, cleaned);
      imported++; tabCount++;
    }
    console.log(`  ${tab}: +${tabCount}`);
  }

  const all = [...byKey.values()];
  const cleanCount = all.filter(q => q.clean).length;
  const rudeCount = all.length - cleanCount;

  const header =
    '// AUTO-GENERATED by build-questions.js — do not edit by hand.\n' +
    '// Source: hand-written seed (questions.seed.js) + public "Family Feud\n' +
    '// Question Database" Google Sheet. Regenerate: node games/family-feud/build-questions.js\n' +
    '// Shape: { q: string, a: [{ t: string, p: number }], clean: boolean }\n' +
    `// Totals: ${all.length} questions (${cleanCount} clean, ${rudeCount} rude).\n` +
    'module.exports = { QUESTIONS: [\n';
  const body = all.map(q => '  ' + JSON.stringify(q)).join(',\n');
  fs.writeFileSync(path.join(__dirname, 'questions.js'), header + body + '\n] };\n');

  console.log('\n──────────── summary ────────────');
  console.log(`raw rows scanned : ${rawRows}`);
  console.log(`dropped (bad/<${MIN_ANSWERS} answers): ${dropped}`);
  console.log(`duplicate questions skipped: ${dupes}`);
  console.log(`imported from sheet: ${imported}`);
  console.log(`TOTAL bank: ${all.length}  (clean ${cleanCount} / rude ${rudeCount}, ${(100*rudeCount/all.length).toFixed(1)}% rude)`);
  console.log('wrote games/family-feud/questions.js');
})().catch(e => { console.error('BUILD FAILED:', e); process.exit(1); });
