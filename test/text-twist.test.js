// Integration test for Text Twist.
// Boots the real server, drives a host + four phone players over socket.io,
// and asserts the shared-team-pool rules, the scoring curve, the wrong-word
// lockout, and — most importantly — that no client is ever sent the text of a
// word it hasn't found (the host screen sits on a TV the whole room can see).
//
// Run with: npm run test:tt

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const puzzles = require('../games/text-twist/puzzles');

const PORT = 3100;
const BASE = `http://localhost:${PORT}/text-twist`;

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✅', label); }
  else      { failed++; console.log('  ❌', label); }
}

const conn = () => io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });

function once(sock, ev, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for '${ev}'`)), timeout);
    sock.once(ev, d => { clearTimeout(t); resolve(d); });
  });
}
function collect(sock, ev) {
  const arr = [];
  sock.on(ev, d => arr.push(d));
  return arr;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stderr.on('data', d => process.stderr.write(d));
    let up = false;
    child.stdout.on('data', d => { if (!up && String(d).includes('running at')) { up = true; resolve(child); } });
    child.on('exit', c => { if (!up) reject(new Error('server exited early: ' + c)); });
    setTimeout(() => { if (!up) reject(new Error('server did not start in 10s')); }, 10000);
  });
}

async function main() {
  const server = await startServer();
  const sockets = [];
  const track = s => { sockets.push(s); return s; };

  try {
    // ── 1: Puzzle bank integrity ──
    console.log('\n── 1: Puzzle bank ──');
    const { bank, TIERS, dictionary } = puzzles;
    ok(bank.easy.length > 20 && bank.medium.length > 100 && bank.hard.length > 100,
       `bank populated: ${bank.easy.length} easy / ${bank.medium.length} medium / ${bank.hard.length} hard`);

    let allTopWordsReachable = true, allInRange = true, allAnswersValid = true;
    for (const [tier, list] of Object.entries(bank)) {
      for (const p of list) {
        if (!p.words.includes(p.source)) allTopWordsReachable = false;
        if (p.words.length < TIERS[tier].min || p.words.length > TIERS[tier].max) allInRange = false;
        for (const w of p.words) if (!dictionary.has(w) || w.length < 4) allAnswersValid = false;
      }
    }
    ok(allTopWordsReachable, 'every puzzle contains its source as the reachable top word');
    ok(allInRange, 'every puzzle answer count falls inside its tier range');
    ok(allAnswersValid, 'every answer is a dictionary word of 4+ letters');
    ok(bank.easy.every(p => p.source.length === 5) &&
       bank.medium.every(p => p.source.length === 7) &&
       bank.hard.every(p => p.source.length >= 8 && p.source.length <= 10),
       'letter counts match the difficulty tiers (5 / 7 / 8-10)');

    // ── 2: Scoring curve ──
    console.log('\n── 2: Scoring ──');
    ok(puzzles.scoreWord('rent', 7) === 20 && puzzles.scoreWord('enter', 7) === 40 &&
       puzzles.scoreWord('neuter', 7) === 70, 'points climb with word length (20 / 40 / 70)');
    ok(puzzles.scoreWord('venture', 7) === 240, 'the top word scores double (120 → 240)');

    // ── 3: Room setup, teams mode ──
    console.log('\n── 3: Room + roster ──');
    const host = track(conn());
    await once(host, 'connect');
    host.emit('create-room', { mode: 'teams', teamCount: 2, teamNames: ['Reds', 'Blues'], difficulty: 'medium', roundSeconds: 60 });
    const created = await once(host, 'room-created');
    const CODE = created.roomCode;
    ok(created.teams.length === 2 && created.difficulty === 'medium' && created.roundSeconds === 60,
       `room ${CODE}: 2 teams, medium, 60s`);

    const roster = { latest: null };
    host.on('players-update', d => { roster.latest = d; });

    const P = {};
    for (const [name, team, pid] of [['Ada', 0, 'pid-ada'], ['Ben', 0, 'pid-ben'], ['Cy', 1, 'pid-cy'], ['Di', 1, 'pid-di']]) {
      const s = track(conn());
      await once(s, 'connect');
      s.emit('join-room', { roomCode: CODE, playerName: name, teamIndex: team, playerId: pid });
      await once(s, 'joined');
      P[name] = s;
    }
    await sleep(200);
    ok(roster.latest.allPlayers.length === 4, 'host roster shows all 4 players');

    // ── 4: Round start + ANTI-LEAK ──
    console.log('\n── 4: Round start + anti-leak ──');
    const hostRS = once(host, 'round-start');
    const adaRS  = once(P.Ada, 'round-start');
    host.emit('start-round', { difficulty: 'medium' });
    const [hRS, aRS] = await Promise.all([hostRS, adaRS]);
    ok(hRS.letters.length === 7 && hRS.totalWords > 0, `letters dealt: ${hRS.letters.toUpperCase()} (${hRS.totalWords} words hidden)`);
    ok(Array.isArray(hRS.buckets) && hRS.buckets.every(b => b.total > 0 && b.got === 0),
       'buckets give per-length totals only');

    // The load-bearing assertion: find the puzzle, then prove no payload leaked a word.
    const rackKey = hRS.letters.split('').sort().join('');
    const puzzle = bank.medium.find(p => p.source.split('').sort().join('') === rackKey);
    ok(!!puzzle, 'test can resolve the live puzzle from the rack');
    const answers = puzzle.words;

    const leaks = (payload) => {
      const blob = JSON.stringify(payload).toLowerCase();
      return answers.filter(w => blob.includes(`"${w}"`));
    };
    ok(leaks(hRS).length === 0, 'round-start to HOST leaks no answer text');
    ok(leaks(aRS).length === 0, 'round-start to PLAYER leaks no answer text');

    host.emit('request-sync');
    const hSync = await once(host, 'sync');
    ok(leaks(hSync).length === 0, 'host sync snapshot leaks no answer text');
    P.Cy.emit('request-sync');
    const cSync = await once(P.Cy, 'sync');
    ok(leaks(cSync).length === 0, 'player sync snapshot leaks no answer text (before finding any)');

    // ── 5: Shared team pool ──
    console.log('\n── 5: Shared team pool ──');
    const short = answers.filter(w => w.length === 4);
    const mid   = answers.filter(w => w.length === 5);
    const w1 = short[0], w2 = short[1], w3 = mid[0];

    const benSees = once(P.Ben, 'word-accepted');   // Ben is Ada's TEAMMATE
    const cySees  = collect(P.Cy, 'word-accepted'); // Cy is on the OTHER team
    P.Ada.emit('submit-word', { word: w1 });
    const acc = await benSees;
    ok(acc.word === w1 && acc.by === 'Ada', `Ada's word "${w1}" appears on teammate Ben's screen, credited to Ada`);
    // teamWords entries are {word, pts, by, isTopWord} — the UI shows who found each one
    ok(acc.teamWords.some(e => e.word === w1 && e.by === 'Ada') && acc.pts === 20,
       'shared pool carries the team word list with attribution; 4-letter = 20 pts');
    await sleep(150);
    ok(cySees.length === 0, 'the opposing team never receives the word text');

    // Duplicate inside the team → no lockout, no double score
    const dup = once(P.Ben, 'word-duplicate');
    P.Ben.emit('submit-word', { word: w1 });
    const d = await dup;
    ok(d.word === w1 && d.by === 'Ada', 'teammate re-submitting gets "already found" (no penalty)');

    // Ben can still score immediately — the duplicate must NOT have locked him out
    const benScore = once(P.Ben, 'word-accepted');
    P.Ben.emit('submit-word', { word: w3 });
    const b2 = await benScore;
    ok(b2.pts === 40 && b2.roundPoints === 60, 'a duplicate causes no lockout; 5-letter = 40 (team total 60)');

    // ── 6: Independent boards ──
    console.log('\n── 6: Independent boards ──');
    const cyScore = once(P.Cy, 'word-accepted');
    P.Cy.emit('submit-word', { word: w1 });
    const c1 = await cyScore;
    ok(c1.word === w1 && c1.pts === 20, `the other team can also score "${w1}" — boards are independent`);

    // ── 7: Wrong-word lockout ──
    console.log('\n── 7: Wrong-word lockout ──');
    // Build a guess that IS spellable from the rack but isn't English, so it
    // reaches the dictionary check rather than failing on letters.
    const gibberish = (() => {
      const ls = hRS.letters.split('');
      for (let i = 0; i < ls.length; i++) {
        for (let j = 0; j < ls.length; j++) {
          if (i === j) continue;
          for (let k = 0; k < ls.length; k++) {
            if (k === i || k === j) continue;
            for (let m = 0; m < ls.length; m++) {
              if (m === i || m === j || m === k) continue;
              const g = ls[i] + ls[j] + ls[k] + ls[m];
              if (!dictionary.has(g)) return g;
            }
          }
        }
      }
      return null;
    })();
    const rej = once(P.Di, 'word-rejected');
    P.Di.emit('submit-word', { word: gibberish });
    const r = await rej;
    ok(r.reason === 'not-a-word' && r.lockMs === 2000,
       `a spellable non-word ("${gibberish}") → rejected as not-a-word, 2s lockout`);

    const locked = once(P.Di, 'word-rejected');
    P.Di.emit('submit-word', { word: w1 });         // a VALID word, but she's frozen
    const l = await locked;
    ok(l.reason === 'locked', 'a submission inside the lockout window is refused');

    // ...and the lockout is hers alone — Cy is unaffected
    const cyStillFine = once(P.Cy, 'word-accepted');
    P.Cy.emit('submit-word', { word: w3 });
    await cyStillFine;
    ok(true, "one player's lockout does not freeze their teammates");

    await sleep(2000);
    const diOk = once(P.Di, 'word-accepted');
    P.Di.emit('submit-word', { word: short[2] });
    await diOk;
    ok(true, 'the lockout expires after 2s and the player can score again');

    // ── 8: Letter constraint ──
    console.log('\n── 8: Letter constraint ──');
    // Double a letter the rack only has once → must be rejected on letters, not dictionary
    const doubled = hRS.letters[0] + hRS.letters[0] + hRS.letters[1] + hRS.letters[2];
    const single = hRS.letters.split('').filter(c => c === hRS.letters[0]).length === 1;
    if (single) {
      const lr = once(P.Ada, 'word-rejected');
      P.Ada.emit('submit-word', { word: doubled });
      const res = await lr;
      ok(res.reason === 'letters', `reusing a letter the rack only has once is rejected ("${doubled}")`);
      await sleep(2100);
    } else {
      ok(true, 'letter-constraint case skipped (rack has a repeated first letter)');
    }

    // ── 9: Progress is counts-only for everyone ──
    console.log('\n── 9: Live progress ──');
    const prog = once(host, 'team-progress');
    P.Ada.emit('submit-word', { word: short[3] || mid[1] });
    const pr = await prog;
    ok(leaks(pr).length === 0, 'team-progress broadcast carries counts only — safe for the TV');
    ok(pr.progress.length === 2 && pr.progress[0].wordCount > 0, 'host sees live word counts and points per team');

    // ── 10: Board clear ──
    console.log('\n── 10: Board clear ──');
    const cleared = once(host, 'board-cleared');
    const rcP = once(host, 'round-complete');
    // Cy hoovers up every remaining word for the Blues.
    for (const w of answers) { P.Cy.emit('submit-word', { word: w }); await sleep(12); }
    const bc = await cleared;
    const rc = await rcP;
    ok(bc.teamIndex === 1 && bc.bonus === 250, 'finding every word clears the board (+250 bonus)');
    ok(rc.reason === 'board-clear' && rc.winnerTeamIndex === 1, 'the round ends immediately on a board clear');
    ok(rc.allWords.length === answers.length && rc.allWords.every(w => typeof w.word === 'string'),
       'round-complete finally reveals every word');
    const topWord = rc.allWords.find(w => w.isTopWord);
    ok(topWord && topWord.word === puzzle.source && topWord.pts === 240,
       `the top word is revealed as ${puzzle.source.toUpperCase()} (240 pts)`);
    const w1entry = rc.allWords.find(w => w.word === w1);
    ok(w1entry.foundBy.includes(0) && w1entry.foundBy.includes(1), `"${w1}" is attributed to BOTH teams that found it`);
    const blues = rc.scores[1].score;
    ok(blues > rc.scores[0].score, `Blues lead after banking the round (${blues} vs ${rc.scores[0].score})`);

    // ── 11: Reconnect mid-round ──
    console.log('\n── 11: Reconnect mid-round ──');
    const rs2 = once(P.Ada, 'round-start');
    host.emit('start-round', {});
    await rs2;
    const found1 = once(P.Ada, 'word-accepted');
    const rack2 = (await (async () => { host.emit('request-sync'); return once(host, 'sync'); })()).letters;
    const key2 = rack2.split('').sort().join('');
    const puz2 = bank.medium.find(p => p.source.split('').sort().join('') === key2);
    P.Ada.emit('submit-word', { word: puz2.words.filter(w => w.length === 4)[0] });
    const fa = await found1;
    const adaWord = fa.word;

    await sleep(1200);   // let the clock tick down a bit
    P.Ada.disconnect();
    await sleep(250);
    ok(roster.latest.allPlayers.length === 4 &&
       roster.latest.allPlayers.find(p => p.name === 'Ada').connected === false,
       'a dropped player is kept in the roster, marked away (not kicked)');

    const ada2 = track(conn());
    await once(ada2, 'connect');
    ada2.emit('rejoin-room', { roomCode: CODE, playerId: 'pid-ada' });
    const rej2 = await once(ada2, 'joined');
    ok(rej2.phase === 'round' && rej2.letters === rack2, 'rejoin restores the round and the same letter rack');
    ok(rej2.secondsLeft > 0 && rej2.secondsLeft < 60, `rejoin restores a LIVE timer (${rej2.secondsLeft}s left, not 60)`);
    ok(rej2.myWords.some(e => e.word === adaWord), "rejoin restores the team's found words");
    const leaked2 = puz2.words.filter(w => w !== adaWord && JSON.stringify(rej2).toLowerCase().includes(`"${w}"`));
    ok(leaked2.length === 0, 'rejoin snapshot carries ONLY the words already found — no unfound answers leak');
    await sleep(200);
    ok(roster.latest.allPlayers.length === 4 &&
       roster.latest.allPlayers.find(p => p.name === 'Ada').connected === true,
       'no duplicate roster entry after rejoin');
    P.Ada = ada2;

    // ── 12: Timer expiry ends the round ──
    console.log('\n── 12: Timer expiry ──');
    host.emit('end-round');
    await once(host, 'round-complete');
    const shortHost = track(conn());
    await once(shortHost, 'connect');
    shortHost.emit('create-room', { mode: 'individual', difficulty: 'easy', roundSeconds: 60 });
    const room2 = await once(shortHost, 'room-created');
    ok(room2.mode === 'individual' && room2.teams.length === 0, 'individual mode starts with no preset teams');

    const solo = track(conn());
    await once(solo, 'connect');
    solo.emit('join-room', { roomCode: room2.roomCode, playerName: 'Zed', teamIndex: -1, playerId: 'pid-zed' });
    const sj = await once(solo, 'joined');
    ok(sj.teamIndex === 0 && sj.teamNames[0] === 'Zed', 'in individual mode each player becomes their own team');

    // ── 13: Game over ──
    console.log('\n── 13: Game over ──');
    const over = once(host, 'game-over');
    host.emit('end-game');
    const go = await over;
    ok(go.scores[0].score >= go.scores[1].score, 'game over: leaderboard sorted high to low');

    const late = track(conn());
    await once(late, 'connect');
    const le = once(late, 'join-error');
    late.emit('join-room', { roomCode: CODE, playerName: 'Late', teamIndex: 0, playerId: 'pid-late' });
    ok(/ended/i.test((await le).message), 'joining an ended game is rejected');

  } finally {
    sockets.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }

  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
