// Builds the Text Twist puzzle bank once, at boot (~225ms).
//
// Puzzles can't be hand-picked: the number of words hidden in a jumble swings
// wildly with the source word (MONKEY yields 5, STARLING yields 111). So we
// generate every candidate and keep only the ones whose answer count lands in
// a playable range for their difficulty.

const fs = require('fs');
const path = require('path');

const MIN_LEN = 4;   // 3-letter words are mostly filler nobody would guess
const MAX_LEN = 10;

const WORDLIST_DIR = path.dirname(require.resolve('wordlist-english/package.json'));

// SCOWL frequency bands: lower number = more common word.
// Validation dictionary is deliberately wider than the source list — a player
// should never have a legitimate word rejected, but the source word has to be
// something everyone recognises, since it IS the top word.
const VALIDATION_BANDS = ['10', '20', '35'];
const SOURCE_BANDS     = ['10', '20'];
const DIALECTS         = ['english', 'british'];

const TIERS = {
  easy:   { lengths: [5],        min: 10, max: 20 },
  medium: { lengths: [7],        min: 18, max: 32 },
  hard:   { lengths: [8, 9, 10], min: 30, max: 55 }
};

function loadBands(bands) {
  const set = new Set();
  for (const band of bands) {
    for (const dialect of DIALECTS) {
      const file = path.join(WORDLIST_DIR, `${dialect}-words-${band}.json`);
      if (!fs.existsSync(file)) continue;
      for (const word of JSON.parse(fs.readFileSync(file, 'utf8'))) set.add(word);
    }
  }
  return set;
}

const sortLetters = w => w.split('').sort().join('');

// Every distinct sub-multiset of `letters` with at least MIN_LEN members,
// as sorted-letter keys. A 10-letter rack yields ~850 of these — cheap.
function subKeys(letters) {
  const chars = letters.split('').sort();
  const n = chars.length;
  const keys = new Set();
  for (let mask = 1; mask < (1 << n); mask++) {
    let sub = '';
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sub += chars[i];
    if (sub.length >= MIN_LEN) keys.add(sub);
  }
  return keys;
}

function build() {
  const t0 = Date.now();

  const dictionary = new Set();
  for (const w of loadBands(VALIDATION_BANDS)) {
    if (w.length >= MIN_LEN && w.length <= MAX_LEN && /^[a-z]+$/.test(w)) dictionary.add(w);
  }

  // sorted-letters -> every dictionary word made of exactly those letters
  const byLetters = new Map();
  for (const w of dictionary) {
    const k = sortLetters(w);
    if (!byLetters.has(k)) byLetters.set(k, []);
    byLetters.get(k).push(w);
  }

  const answersFor = source => {
    const out = [];
    for (const k of subKeys(source)) {
      const hit = byLetters.get(k);
      if (hit) out.push(...hit);
    }
    return [...new Set(out)];
  };

  const bank = { easy: [], medium: [], hard: [] };
  for (const source of loadBands(SOURCE_BANDS)) {
    if (!/^[a-z]+$/.test(source)) continue;
    // Plurals spawn a long tail of -s variants that bloats the answer list.
    if (source.endsWith('s')) continue;

    const tier = Object.keys(TIERS).find(t => TIERS[t].lengths.includes(source.length));
    if (!tier) continue;

    const words = answersFor(source);
    // The source must be reachable as the top word, or there's nothing to chase.
    if (!words.includes(source)) continue;
    if (words.length < TIERS[tier].min || words.length > TIERS[tier].max) continue;

    bank[tier].push({
      source,
      words: words.sort((a, b) => b.length - a.length || a.localeCompare(b))
    });
  }

  console.log(
    `[text-twist] puzzle bank ready in ${Date.now() - t0}ms — ` +
    `${bank.easy.length} easy / ${bank.medium.length} medium / ${bank.hard.length} hard ` +
    `(dictionary: ${dictionary.size} words)`
  );

  return { bank, dictionary };
}

const { bank, dictionary } = build();

// Points climb steeply with length, so spamming short guesses is a losing
// strategy — that's the real deterrent against random guessing.
const POINTS = { 4: 20, 5: 40, 6: 70, 7: 120, 8: 200, 9: 300, 10: 450 };

function scoreWord(word, rackLength) {
  const base = POINTS[word.length] || 0;
  return word.length === rackLength ? base * 2 : base;   // top word scores double
}

function randomPuzzle(difficulty) {
  const tier = bank[difficulty] ? difficulty : 'medium';
  const list = bank[tier];
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = { bank, dictionary, randomPuzzle, scoreWord, POINTS, MIN_LEN, TIERS };
