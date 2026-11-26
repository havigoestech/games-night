// Integration test for the trivia-led "Same Letter · Round" mode: ONE fixed
// letter for the whole round, and each question is a SPECIFIC trivia question
// whose single answer starts with that letter. Players TYPE their answer; it is
// auto-graded, and the host can tap an answer at the reveal to accept/un-accept.
// Also covers the host skip-question / skip-round controls.
// Spawns the real server, drives a host + 2 players. Run: npm run test:trivia-slr
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const { QUESTIONS } = require('../games/trivia/data/questions-all.js');

const PORT = 3108;
const BASE = `http://localhost:${PORT}/trivia`;
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('  ✅', l); } else { failed++; console.log('  ❌', l); } };
const conn = () => io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
const once = (s, ev, ms = 6000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout: ' + ev)), ms); s.once(ev, d => { clearTimeout(t); res(d); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const stripArticle = s => String(s).trim().replace(/^(the|a|an)\s+/i, '');
const firstLetterOf = s => { const w = stripArticle(s); const c = w.charAt(0); return /[a-z]/i.test(c) ? c.toUpperCase() : '?'; };
const answerFor = qText => { const e = QUESTIONS.find(x => x.q === qText); return e ? e.correct : null; };
const nearMiss = s => { const t = String(s); return t + (t.slice(-1).toLowerCase() === 'x' ? 'y' : 'x'); }; // one extra letter → edit distance 1, must NOT auto-pass

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', d => process.stderr.write(d));
    let up = false;
    child.stdout.on('data', d => { if (!up && String(d).includes('running at')) { up = true; resolve(child); } });
    child.on('exit', c => { if (!up) reject(new Error('server exited early: ' + c)); });
    setTimeout(() => { if (!up) reject(new Error('server did not start')); }, 8000);
  });
}

async function main() {
  const server = await startServer();
  const sockets = [];
  const track = s => { sockets.push(s); return s; };
  try {
    const host = track(conn()); await once(host, 'connect');
    host.emit('create-room', { teamMode: 'teams', teamCount: 2, teamNames: ['Reds', 'Blues'],
      playlist: [
        { mode: 'same-letter-round', count: 3, seconds: 30 },
        { mode: 'fastest-finger', count: 1, seconds: 20 }
      ] });
    const { roomCode } = await once(host, 'room-created');

    const players = {};
    for (const [name, team, pid] of [['Ada', 0, 'pa'], ['Ben', 1, 'pb']]) {
      const s = track(conn()); await once(s, 'connect');
      s.emit('join-room', { roomCode, playerName: name, teamIndex: team, playerId: pid });
      await once(s, 'joined'); players[name] = s;
    }
    await sleep(120);

    // ── Round 0: Same Letter · Round (trivia-led) ──
    const intro = (host.emit('start-game'), await once(host, 'round-intro'));
    ok(/Same Letter · Round/.test(intro.modeName), 'round-intro: mode is "Same Letter · Round"');
    ok(intro.totalRounds === 2, 'two rounds in the playlist');
    ok(typeof intro.roundNote === 'string' && /starts with [A-Z]/.test(intro.roundNote), `round-intro announces the round letter ("${intro.roundNote}")`);
    const roundLetter = intro.roundNote.match(/starts with ([A-Z])/)[1];
    ok(intro.count === 3, 'round has 3 questions');

    // Q1 — a real trivia question, answer-less, letter matches the round.
    const q1 = (host.emit('advance'), await once(host, 'question'));
    ok(q1.mode === 'letter-trivia', 'question renders with the trivia-led screen (mode:letter-trivia)');
    ok(q1.modeName === 'Same Letter · Round', 'question carries the mode badge name');
    ok(typeof q1.question === 'string' && q1.question.length > 5, `question is a specific trivia question ("${(q1.question || '').slice(0, 48)}…")`);
    ok(!('correct' in q1) && !('options' in q1), 'question never leaks the answer or options');
    ok(q1.letter === roundLetter, `Q1 uses the round letter ${roundLetter}`);
    const a1 = answerFor(q1.question);
    ok(!!a1, 'Q1 maps to a known answer in the bank');
    ok(firstLetterOf(a1) === roundLetter, `Q1's answer ("${a1}") starts with ${roundLetter}`);

    // Ada types the correct answer; Ben types gibberish. Both answered → auto-reveal.
    const revP = once(host, 'question-reveal');
    players.Ada.emit('submit', { answer: a1 });
    players.Ben.emit('submit', { answer: nearMiss(a1) });   // one letter off the real answer
    const rev1 = await revP;
    ok(rev1.mode === 'letter-trivia', 'reveal is the trivia-led reveal');
    ok(rev1.correct === a1, 'reveal shows the correct answer');
    const ada = (rev1.results || []).find(r => r.playerId === 'pa');
    const ben = (rev1.results || []).find(r => r.playerId === 'pb');
    ok(ada && ada.correct === true && ada.points > 0, 'typed-correct answer is auto-graded right and scores');
    ok(ben && ben.correct === false && ben.points === 0, 'a one-letter-off answer is auto-graded WRONG — exact match only, no fuzzy typo pass (quatrillion ≠ quadrillion)');
    const score = n => (rev1.scores.find(s => s.name === n) || {}).score;
    ok(score('Reds') > 0, "Ada's team (Reds) got the points");
    ok(score('Blues') === 0, 'Blues have nothing yet');

    // ── Host tap-to-accept: mark Ben's answer correct, then toggle it back ──
    const rev1b = (host.emit('host-action', { type: 'accept', playerId: 'pb' }), await once(host, 'question-reveal'));
    const benB = rev1b.results.find(r => r.playerId === 'pb');
    ok(benB && benB.correct === true && benB.points > 0, 'host tap-to-accept marks a wrong answer correct + awards points');
    ok((rev1b.scores.find(s => s.name === 'Blues') || {}).score > 0, 'Blues score goes up on accept');

    const rev1c = (host.emit('host-action', { type: 'accept', playerId: 'pb' }), await once(host, 'question-reveal'));
    const benC = rev1c.results.find(r => r.playerId === 'pb');
    ok(benC && benC.correct === false && benC.points === 0, 'tapping again un-accepts (toggle-safe)');
    ok((rev1c.scores.find(s => s.name === 'Blues') || {}).score === 0, 'Blues score returns to 0 on un-accept');

    // Q2 — must reuse the SAME round letter, and have a NEW question.
    const q2 = (host.emit('advance'), await once(host, 'question'));
    ok(q2.letter === roundLetter, `Q2 reuses the round letter ${roundLetter}`);
    ok(q2.qNumber === 2, 'Q2 is question 2 of the round');
    ok(q2.question !== q1.question, 'Q2 is a different question');
    const a2 = answerFor(q2.question);
    ok(a2 && firstLetterOf(a2) === roundLetter, `Q2's answer ("${a2}") also starts with ${roundLetter}`);

    // ── Skip question: from Q2 jump straight to Q3 (same letter) ──
    const q3 = (host.emit('skip-question'), await once(host, 'question'));
    ok(q3.qNumber === 3 && q3.letter === roundLetter, 'skip-question advances to Q3, still the round letter');

    // ── Skip round: from mid-Q3 jump to round 1 (Fastest Finger) ──
    const intro2 = (host.emit('skip-round'), await once(host, 'round-intro'));
    ok(intro2.roundIndex === 1 && /Fastest Finger/.test(intro2.modeName), 'skip-round jumps to the next round (Fastest Finger)');
    ok(!intro2.roundNote, 'Fastest Finger round has no round-letter note');

    // FF question, then skip it (last in round) → round-over.
    await (host.emit('advance'), once(host, 'question'));
    const ro = (host.emit('skip-question'), await once(host, 'round-over'));
    ok(ro.roundIndex === 1, 'skip-question on the last question ends the round (round-over)');

    // Last round over → game over.
    const go = (host.emit('advance'), await once(host, 'game-over'));
    ok(go.scores.length === 2, 'game over with final scores');
  } finally {
    sockets.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }
  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
