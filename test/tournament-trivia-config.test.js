// Proves a tournament Trivia round honours its per-game config — the mode,
// category, difficulty, timer and question count the host picks in the builder
// actually reach the launched Trivia room (not the old hardcoded Fastest Finger
// at 20s). Spawns the real server, builds a one-game tournament, and checks the
// round-intro the launched game emits. Run: node test/tournament-trivia-config.test.js
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3112;
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('  ✅', l); } else { failed++; console.log('  ❌', l); } };
const connNs = ns => io(`http://localhost:${PORT}${ns}`, { transports: ['websocket'], forceNew: true, reconnection: false });
const once = (s, ev, ms = 12000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout: ' + ev)), ms); s.once(ev, d => { clearTimeout(t); res(d); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', d => process.stderr.write(d));
    let up = false;
    child.stdout.on('data', d => { if (!up && String(d).includes('running at')) { up = true; resolve(child); } });
    child.on('exit', c => { if (!up) reject(new Error('server exited early: ' + c)); });
    setTimeout(() => { if (!up) reject(new Error('server did not start')); }, 10000);
  });
}

async function main() {
  const server = await startServer();
  const socks = [];
  const track = s => { socks.push(s); return s; };
  try {
    const host = track(connNs('/tournament'));
    await once(host, 'connect');

    // The builder also fetches trivia's modes + categories on connect.
    const meta = await once(host, 'tournament-meta');
    ok(Array.isArray(meta.triviaModes) && meta.triviaModes.some(m => m.key === 'closest-wins'), 'server sends trivia modes to the builder');
    ok(Array.isArray(meta.triviaCategories) && meta.triviaCategories.length > 0, 'server sends trivia categories to the builder');

    host.emit('create-tournament', {
      mode: 'teams', teamCount: 2, teamNames: ['Reds', 'Blues'],
      plan: [{ slug: 'trivia', length: 4, config: { mode: 'closest-wins', category: 'any', difficulty: 'hard', seconds: 45 } }],
      placement: [10, 5], hostId: 'host-cfg'
    });
    const T = (await once(host, 'tournament-created')).roomCode;

    for (const r of [{ name: 'Ada', teamIndex: 0, playerId: 'pid-ada' }, { name: 'Cy', teamIndex: 1, playerId: 'pid-cy' }]) {
      const s = track(connNs('/tournament'));
      await once(s, 'connect');
      s.emit('join-room', { roomCode: T, playerName: r.name, teamIndex: r.teamIndex, playerId: r.playerId });
      await once(s, 'joined');
    }

    const goto = once(host, 'goto-game');
    host.emit('start-tournament');
    const g = await goto;
    const gameRoom = g.playerUrl.match(/room=([A-Z0-9]{4})/)[1];

    const gHost = track(connNs('/trivia'));
    await once(gHost, 'connect');
    gHost.emit('claim-host', { roomCode: gameRoom });
    await once(gHost, 'host-attached');

    const introP = once(gHost, 'round-intro');
    gHost.emit('start-game');
    const intro = await introP;
    ok(/Closest Wins/.test(intro.modeName), `configured mode reaches the round (got "${intro.modeName}")`);
    ok(intro.count === 4, `configured question count reaches the round (got ${intro.count})`);

    // The question itself should be a Closest Wins numeric prompt, at the 45s timer.
    const qP = once(gHost, 'question');
    gHost.emit('advance');
    const q = await qP;
    ok(q.mode === 'closest-wins', `the live question runs in the configured mode (got "${q.mode}")`);
    ok(q.seconds === 45, `the configured 45s timer is applied (got ${q.seconds})`);
  } finally {
    socks.forEach(s => { try { s.disconnect(); } catch (e) {} });
    await sleep(100);
    server.kill();
  }
  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
