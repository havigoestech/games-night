// Integration test for Family Feud's round timers + the reopen-once face-off.
// The face-off / play countdowns are server-authoritative and AUTO-COUNT when
// they run out (face-off = miss, play = strike). When both face-off answers miss
// the buzzers reopen ONCE; a second double-miss resolves to the team that buzzed
// in first — no endless loop. Spawns the real server, drives a host + 2 players.
// Run: node test/family-feud-timers.test.js
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3101;
const BASE = `http://localhost:${PORT}/family-feud`;
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('  ✅', l); } else { failed++; console.log('  ❌', l); } };
const conn = () => io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
const once = (s, ev, ms = 6000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout: ' + ev)), ms); s.once(ev, d => { clearTimeout(t); res(d); }); });
const onceWhere = (s, ev, pred, ms = 6000) => new Promise((res, rej) => {
  const t = setTimeout(() => { s.off(ev, h); rej(new Error('timeout: ' + ev)); }, ms);
  const h = d => { if (pred(d)) { clearTimeout(t); s.off(ev, h); res(d); } };
  s.on(ev, h);
});
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
    // 3s face-off, 8s play — the shortest configurable values, to keep the test quick.
    host.emit('create-room', { teamNames: ['Reds', 'Blues'], familyFriendly: true, faceoffSeconds: 3, playSeconds: 8 });
    const { roomCode } = await once(host, 'room-created');

    const players = {};
    for (const [name, team, pid] of [['Ada', 0, 'pa'], ['Ben', 1, 'pb']]) {
      const s = track(conn()); await once(s, 'connect');
      s.emit('join-room', { roomCode, playerName: name, teamIndex: team, playerId: pid });
      await once(s, 'joined'); players[name] = s;
    }
    await sleep(150);

    // ── A buzz starts the face-off timer ──
    const qs = once(host, 'question-start');
    host.emit('start-question');
    await qs;
    await once(host, 'faceoff-open');

    const ft = onceWhere(host, 'feud-timer', d => d.kind === 'faceoff');
    const fb = once(host, 'faceoff-buzz');
    players.Ada.emit('buzz');                        // Ada (Reds) buzzes first
    await fb;
    const t1 = await ft;
    ok(t1.kind === 'faceoff' && t1.secondsLeft === 3, `a buzz starts a 3s face-off timer (got ${t1.kind}/${t1.secondsLeft})`);

    // ── It runs out on its own → auto-miss → counter (no host action) ──
    const fcd = await once(host, 'faceoff-counter');
    ok(fcd.firstAnswer.answerIndex === null, 'the face-off timer running out auto-counts the buzzer as a miss → counter');

    // ── Counter times out too → both missed → buzzers reopen ONCE ──
    const fod = await once(host, 'faceoff-open');
    ok(fod.rebuzz === true, 'the counter timing out too (both missed) reopens the buzzers once');

    // ── A SECOND double-miss resolves to the first buzzer's team — no endless loop ──
    const fb2 = once(host, 'faceoff-buzz');
    players.Ben.emit('buzz');                         // Ben (Blues) buzzes the re-open
    await fb2;
    const fc2 = once(host, 'faceoff-counter');
    host.emit('host-wrong');                          // buzzer missed → counter
    await fc2;
    const won = once(host, 'faceoff-won');
    host.emit('host-wrong');                          // counter missed → both missed AGAIN
    const w = await won;
    ok(w.winnerTeamIndex === 0, `a second double-miss resolves to the team that buzzed in first (Reds=0), not another reopen (got ${w.winnerTeamIndex})`);

    // ── Play timer starts on team-play and auto-strikes on expiry ──
    const tps = once(host, 'team-play-start');
    const ptimer = onceWhere(host, 'feud-timer', d => d.kind === 'play');
    host.emit('choose-play-or-pass', { choice: 'play' });
    await tps;
    const pt = await ptimer;
    ok(pt.kind === 'play' && pt.secondsLeft === 8, `team-play starts an 8s play timer (got ${pt.kind}/${pt.secondsLeft})`);

    const w1 = await once(host, 'wrong-answer', 11000);   // no host action — the play timer expires
    ok(w1.strikes === 1, 'the play timer running out auto-counts a strike');
  } finally {
    sockets.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }
  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
