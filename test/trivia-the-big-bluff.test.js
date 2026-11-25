// Integration test for the Trivia "The Big Bluff" mode: the two-stage round
// (submit a fake → vote for the truth) and its scoring. Spawns the real server,
// drives a host + 3 players. Run: npm run test:trivia-bb
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3108;
const BASE = `http://localhost:${PORT}/trivia`;
const BANK = require('../games/trivia/data/bluff.js').QUESTIONS;
const ansByPrompt = new Map(BANK.map(q => [q.prompt, q.answer]));

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('  ✅', l); } else { failed++; console.log('  ❌', l); } };
const conn = () => io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
const once = (s, ev, ms = 6000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout: ' + ev)), ms); s.once(ev, d => { clearTimeout(t); res(d); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    host.emit('create-room', { teamMode: 'individual', playlist: [{ mode: 'the-big-bluff', count: 1, seconds: 30 }] });
    const { roomCode } = await once(host, 'room-created');

    const players = {};
    for (const [name, pid] of [['Ada', 'pa'], ['Ben', 'pb'], ['Cal', 'pc']]) {
      const s = track(conn()); await once(s, 'connect');
      s.emit('join-room', { roomCode, playerName: name, teamIndex: -1, playerId: pid });
      await once(s, 'joined'); players[name] = s;
    }
    await sleep(150);

    const intro = (host.emit('start-game'), await once(host, 'round-intro'));
    ok(/Big Bluff/.test(intro.modeName), 'round-intro: The Big Bluff');

    // Stage 1 — bluff
    const q1H = once(host, 'question'); const q1A = once(players.Ada, 'question');
    host.emit('advance');
    const [q1] = await Promise.all([q1H, q1A]);
    ok(q1.mode === 'the-big-bluff' && q1.stage === 'bluff' && typeof q1.prompt === 'string' && q1.answer === undefined && q1.truth === undefined, 'stage 1 is "bluff", prompt only (no answer leaked)');
    const truth = ansByPrompt.get(q1.prompt);

    // listen for the vote stage (a second 'question' with stage 'vote')
    const voteH = once(host, 'question');
    players.Ada.emit('submit', { answer: 'Zebra fib' });
    players.Ben.emit('submit', { answer: 'Yak yarn' });
    players.Cal.emit('submit', { answer: truth });        // writes the real answer
    const vote = await voteH;                              // all 3 in → auto-advances to the vote
    ok(vote.stage === 'vote' && Array.isArray(vote.options) && vote.options.length >= 3, 'stage 2 is "vote" with the truth + fakes shuffled in');
    const truthOpt = vote.options.find(o => o.text === truth);
    const adaOpt = vote.options.find(o => o.text === 'Zebra fib');
    const benOpt = vote.options.find(o => o.text === 'Yak yarn');
    ok(truthOpt && adaOpt && benOpt, 'options contain the truth and both fakes');

    // can't vote your own fake
    const ackOwn = once(players.Ada, 'you-submitted');
    players.Ada.emit('submit', { optionId: adaOpt.id });
    const ao = await ackOwn;
    ok(ao && ao.accepted === false && ao.reason === 'own', 'voting your own bluff is rejected');

    const revH = once(host, 'question-reveal');
    players.Ada.emit('submit', { optionId: truthOpt.id });   // Ada finds the truth (+500)
    players.Ben.emit('submit', { optionId: adaOpt.id });     // Ben fooled by Ada (+250 Ada)
    players.Cal.emit('submit', { optionId: benOpt.id });     // Cal fooled by Ben (+250 Ben)
    const rev = await revH;                                  // all 3 voted → auto-scores
    ok(rev.mode === 'the-big-bluff' && rev.truth === truth, 'reveal exposes the truth');
    const adaRes = rev.results.find(r => r.name === 'Ada');
    ok(adaRes && adaRes.foundTruth && adaRes.points === 750, `Ada: found truth + fooled 1 = 750 (got ${adaRes && adaRes.points})`);
    const calRes = rev.results.find(r => r.name === 'Cal');
    ok(calRes && calRes.foundTruth && calRes.points === 500, `Cal: wrote the truth = 500 (got ${calRes && calRes.points})`);

    const roP = once(host, 'round-over'); host.emit('advance'); await roP;
    const goP = once(host, 'game-over'); host.emit('advance'); const go = await goP;
    ok(go.scores.length === 3, 'game over with all three players scored');
  } finally {
    sockets.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }
  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
