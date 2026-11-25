// Integration test for the Trivia Closest Wins mode (numeric guess, closeness
// scoring). Spawns the real server, drives a host + 2 players. Run: npm run test:trivia-cw
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3107;
const BASE = `http://localhost:${PORT}/trivia`;
const BANK = require('../games/trivia/data/numeric.js').QUESTIONS;
const answerByQ = new Map(BANK.map(q => [q.q, q.answer]));

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
    host.emit('create-room', { teamMode: 'teams', teamCount: 2, teamNames: ['Reds', 'Blues'],
      playlist: [{ mode: 'closest-wins', count: 1, seconds: 30 }] });
    const { roomCode } = await once(host, 'room-created');

    const players = {};
    for (const [name, team, pid] of [['Ada', 0, 'pa'], ['Ben', 1, 'pb']]) {
      const s = track(conn()); await once(s, 'connect');
      s.emit('join-room', { roomCode, playerName: name, teamIndex: team, playerId: pid });
      await once(s, 'joined'); players[name] = s;
    }
    await sleep(120);

    const intro = (host.emit('start-game'), await once(host, 'round-intro'));
    ok(/Closest Wins/.test(intro.modeName), 'round-intro: Closest Wins');

    const qH = once(host, 'question'); const qA = once(players.Ada, 'question');
    host.emit('advance');
    const [q] = await Promise.all([qH, qA]);
    ok(q.mode === 'closest-wins' && typeof q.question === 'string' && q.answer === undefined, 'question has no answer (no leak)');
    const answer = answerByQ.get(q.question);

    players.Ada.emit('submit', { value: answer });                        // exact
    players.Ben.emit('submit', { value: answer + Math.max(50, answer * 3) }); // far off
    await sleep(200);

    const revP = once(host, 'question-reveal');
    host.emit('advance');
    const rev = await revP;
    ok(rev.mode === 'closest-wins' && rev.answer === answer, 'reveal exposes the numeric answer');
    ok(rev.results[0].name === 'Ada' && rev.results[0].error === 0, 'results sorted closest-first (Ada exact)');
    const reds = rev.scores.find(s => s.name === 'Reds').score;
    const blues = rev.scores.find(s => s.name === 'Blues').score;
    ok(reds === 1000, `exact guess scores 1000 (Reds ${reds})`);
    ok(blues < reds, `far guess scores less (Blues ${blues})`);

    const roP = once(host, 'round-over'); host.emit('advance'); await roP;
    const goP = once(host, 'game-over'); host.emit('advance'); const go = await goP;
    ok(go.scores[0].score >= go.scores[1].score, 'game over leaderboard sorted');
  } finally {
    sockets.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }
  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
