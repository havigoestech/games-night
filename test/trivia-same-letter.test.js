// Integration test for the Trivia Same Letter mode (typed answers, uniqueness
// scoring, duplicates cancel). Spawns the real server, drives a host + 2 players.
// Run: npm run test:trivia-sl
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3106;
const BASE = `http://localhost:${PORT}/trivia`;
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('  ✅', l); } else { failed++; console.log('  ❌', l); } };
const conn = () => io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
const once = (s, ev, ms = 6000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout: ' + ev)), ms); s.once(ev, d => { clearTimeout(t); res(d); }); });
const collect = (s, ev) => { const a = []; s.on(ev, d => a.push(d)); return a; };
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
    host.emit('create-room', { teamMode: 'teams', teamCount: 2, teamNames: ['Reds', 'Blues'],
      playlist: [{ mode: 'same-letter', count: 1, seconds: 30 }] });
    const { roomCode } = await once(host, 'room-created');

    const players = {};
    for (const [name, team, pid] of [['Ada', 0, 'pa'], ['Ben', 1, 'pb']]) {
      const s = track(conn()); await once(s, 'connect');
      s.emit('join-room', { roomCode, playerName: name, teamIndex: team, playerId: pid });
      await once(s, 'joined'); players[name] = s;
    }
    await sleep(120);

    const intro = (host.emit('start-game'), await once(host, 'round-intro'));
    ok(/Same Letter/.test(intro.modeName), 'round-intro: Same Letter');

    const qH = once(host, 'question'); const qA = once(players.Ada, 'question');
    host.emit('advance');
    const [q, qa] = await Promise.all([qH, qA]);
    ok(q.mode === 'same-letter' && typeof q.letter === 'string' && q.letter.length === 1 && typeof q.category === 'string', 'question has a category + a single letter');
    const L = q.letter;

    const ackA = collect(players.Ada, 'you-submitted');
    // Ada: one unique, one shared, one wrong-letter (xyz — X is never a prompt letter)
    players.Ada.emit('submit', { answer: L + 'pple' });
    players.Ada.emit('submit', { answer: L + 'anana' });
    players.Ada.emit('submit', { answer: 'xyz' });
    // Ben: the shared one + a unique one
    players.Ben.emit('submit', { answer: L + 'anana' });
    players.Ben.emit('submit', { answer: L + 'ear' });
    await sleep(250);
    ok(ackA.some(a => a.accepted === true) && ackA.some(a => a.accepted === false && a.reason === 'letter'), 'player gets accept + wrong-letter feedback');

    const revP = once(host, 'question-reveal');
    host.emit('advance');                 // host cuts the timer → score
    const rev = await revP;
    ok(rev.mode === 'same-letter', 'reveal is same-letter');
    const shared = rev.groups.find(g => g.count === 2);
    ok(shared && shared.scored === false, 'the shared answer is cancelled (not scored)');
    ok(rev.groups.filter(g => g.scored).length === 2, 'two unique answers scored');
    const reds = rev.scores.find(s => s.name === 'Reds').score;
    const blues = rev.scores.find(s => s.name === 'Blues').score;
    ok(reds === 120 && blues === 120, `each team scored 120 for one unique answer (Reds ${reds}, Blues ${blues})`);

    const roP = once(host, 'round-over'); host.emit('advance'); await roP;
    const goP = once(host, 'game-over'); host.emit('advance'); const go = await goP;
    ok(go.scores.length === 2, 'game over with final scores');
  } finally {
    sockets.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }
  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
