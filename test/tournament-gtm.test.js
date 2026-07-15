// Stage 3a — proves Grab the Mic runs correctly as a tournament game:
// launched pre-seeded, players auto-join by device id, and it auto-finishes
// when a team reaches the score goal (= the line-up length), reporting the
// finishing order back as placement points.
//
// Run with: npm run test:tourney-gtm

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3100;
let passed = 0, failed = 0;
function ok(cond, label) { if (cond) { passed++; console.log('  ✅', label); } else { failed++; console.log('  ❌', label); } }
const connNs = ns => io(`http://localhost:${PORT}${ns}`, { transports: ['websocket'], forceNew: true, reconnection: false });
function once(sock, ev, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for '${ev}'`)), timeout);
    sock.once(ev, d => { clearTimeout(t); resolve(d); });
  });
}
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
    console.log('\n── Grab the Mic as a tournament game ──');
    const host = track(connNs('/tournament'));
    await once(host, 'connect');
    host.emit('create-tournament', {
      mode: 'teams', teamCount: 2, teamNames: ['Reds', 'Blues'],
      plan: [{ slug: 'grab-the-mic', length: 1 }],   // first to 1 point
      placement: [10, 5], hostId: 'host-gtm'
    });
    const created = await once(host, 'tournament-created');
    const T = created.roomCode;

    const roster = [
      { name: 'Ada', teamIndex: 0, playerId: 'pid-ada' },
      { name: 'Cy', teamIndex: 1, playerId: 'pid-cy' }
    ];
    for (const r of roster) {
      const s = track(connNs('/tournament'));
      await once(s, 'connect');
      s.emit('join-room', { roomCode: T, playerName: r.name, teamIndex: r.teamIndex, playerId: r.playerId });
      await once(s, 'joined');
    }

    const goto = once(host, 'goto-game');
    host.emit('start-tournament');
    const g = await goto;
    ok(g.slug === 'grab-the-mic', 'tournament launches Grab the Mic');
    const gameRoom = g.playerUrl.match(/room=([A-Z0-9]{4})/)[1];

    // Everyone hops into the game (new sockets on /grab-the-mic).
    const gHost = track(connNs('/grab-the-mic'));
    await once(gHost, 'connect');
    gHost.emit('claim-host', { roomCode: gameRoom });
    await once(gHost, 'host-attached');
    ok(true, 'host adopts the pre-created Grab the Mic room');

    const gPlayers = {};
    for (const r of roster) {
      const s = track(connNs('/grab-the-mic'));
      await once(s, 'connect');
      s.emit('rejoin-room', { roomCode: gameRoom, playerId: r.playerId });
      const j = await once(s, 'joined');
      ok(j.teamIndex === r.teamIndex, `${r.name} auto-joined Grab the Mic on team ${r.teamIndex}`);
      gPlayers[r.name] = s;
    }

    // One round: reveal → buzzers go live → Ada buzzes → host awards → Reds hit
    // the goal of 1 → the game should auto-finish.
    const live = once(gPlayers.Ada, 'buzzers-live');
    gHost.emit('reveal-word');
    await live;                            // waits out the ~3s countdown
    const buzzed = once(gHost, 'player-buzzed');
    gPlayers.Ada.emit('buzz');
    await buzzed;
    const rc = once(gHost, 'round-complete');
    gHost.emit('judge', { verdict: 'award' });
    const result = await rc;
    ok(result.scores[0].score === 1 && result.goalReached, 'Reds reach the score goal (1)');

    // Auto-conclude fires ~4.5s after the goal.
    await once(gHost, 'game-over', 9000);
    ok(true, 'the game auto-finishes once the goal is reached');
    [gHost, ...Object.values(gPlayers)].forEach(s => s.disconnect());
    await sleep(400);

    // Host returns → placement points applied.
    const back = track(connNs('/tournament'));
    await once(back, 'connect');
    back.emit('reclaim-host', { roomCode: T, hostId: 'host-gtm' });
    const snap = await once(back, 'host-reclaimed');
    const reds = snap.standings.find(s => s.name === 'Reds');
    const blues = snap.standings.find(s => s.name === 'Blues');
    ok(reds.score === 10 && blues.score === 5,
       `finishing order → placement: Reds 10 (1st), Blues 5 (2nd) — got ${reds.score}/${blues.score}`);
    ok(snap.phase === 'between' && snap.nextGameIndex === null, 'tournament is complete-ready after its one game');
  } finally {
    socks.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }
  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
