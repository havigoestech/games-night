// Proves No Say Am runs correctly as a tournament game: launched pre-seeded with
// the host's config (turn timer + rounds), players auto-join by device id, it
// plays through a full round, and the finishing order is reported back to the
// tournament as placement points.
//
// Run with: npm run test:tourney-nsa
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3114;
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('  ✅', l); } else { failed++; console.log('  ❌', l); } };
const connNs = ns => io(`http://localhost:${PORT}${ns}`, { transports: ['websocket'], forceNew: true, reconnection: false });
const once = (sock, ev, timeout = 12000) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`timeout waiting for '${ev}'`)), timeout); sock.once(ev, d => { clearTimeout(t); resolve(d); }); });
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
    console.log('\n── No Say Am as a tournament game ──');
    const host = track(connNs('/tournament'));
    await once(host, 'connect');
    host.emit('create-tournament', {
      mode: 'teams', teamCount: 2, teamNames: ['Reds', 'Blues'],
      plan: [{ slug: 'no-say-am', length: 1, config: { turnSeconds: 45 } }],   // 1 round, 45s turns
      placement: [10, 5], hostId: 'host-nsa'
    });
    const created = await once(host, 'tournament-created');
    const T = created.roomCode;
    ok(!!T, `tournament ${T} created with No Say Am in the line-up`);

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

    console.log('\n── Launch → No Say Am room, pre-seeded with the host config ──');
    const goto = once(host, 'goto-game');
    host.emit('start-tournament');
    const g = await goto;
    ok(g.slug === 'no-say-am', 'tournament launches No Say Am');
    ok(/\/games\/no-say-am\/player\.html/.test(g.playerUrl), 'player URL points at the No Say Am page');
    const gameRoom = g.playerUrl.match(/room=([A-Z0-9]{4})/)[1];

    const gHost = track(connNs('/no-say-am'));
    await once(gHost, 'connect');
    gHost.emit('claim-host', { roomCode: gameRoom });
    const ha = await once(gHost, 'host-attached');
    ok(ha.turnSeconds === 45 && ha.totalRounds === 1, `config carried through: 45s turns, 1 round (got ${ha.turnSeconds}s / ${ha.totalRounds})`);

    const gPlayers = {};
    for (const r of roster) {
      const s = track(connNs('/no-say-am'));
      await once(s, 'connect');
      s.emit('rejoin-room', { roomCode: gameRoom, playerId: r.playerId });
      const j = await once(s, 'joined');
      ok(j.teamIndex === r.teamIndex, `${r.name} auto-joined No Say Am on team ${r.teamIndex}`);
      gPlayers[r.name] = s;
    }

    console.log('\n── Play the round: Reds get one, Blues skip ──');
    const ti0 = once(gHost, 'turn-intro');
    gHost.emit('start-game');
    const t0 = await ti0;
    ok(t0.teamIndex === 0 && t0.describerId === 'pid-ada', 'first turn: Reds up, Ada describes');

    const card0P = once(gPlayers.Ada, 'card');
    gHost.emit('start-turn');
    const card0 = await card0P;
    const prog0 = once(gHost, 'turn-progress');
    gPlayers.Ada.emit('mark', { result: 'got', serial: card0.serial });
    await prog0;
    const to0 = once(gHost, 'turn-over');
    gHost.emit('end-turn');
    const over0 = await to0;
    ok(over0.scores.find(s => s.name === 'Reds').score === 1, 'Reds score a point');

    const ti1 = once(gHost, 'turn-intro');
    gHost.emit('next');
    const t1 = await ti1;
    ok(t1.teamIndex === 1 && t1.describerId === 'pid-cy', 'second turn: Blues up, Cy describes');

    const card1P = once(gPlayers.Cy, 'card');
    gHost.emit('start-turn');
    const card1 = await card1P;
    const prog1 = once(gHost, 'turn-progress');
    gPlayers.Cy.emit('mark', { result: 'skip', serial: card1.serial });
    await prog1;

    // End the last turn of the last round → game-over + onComplete back to the tournament.
    const to1P = once(gHost, 'turn-over');
    const goP = once(gHost, 'game-over', 9000);
    gHost.emit('end-turn');
    await to1P;
    gHost.emit('next');
    const go = await goP;
    ok(go.scores.find(s => s.name === 'Reds').score === 1 && go.scores.find(s => s.name === 'Blues').score === 0,
       'game-over: Reds 1, Blues 0');

    [gHost, ...Object.values(gPlayers)].forEach(s => s.disconnect());
    await sleep(400);

    console.log('\n── Back to the tournament → placement points applied ──');
    const back = track(connNs('/tournament'));
    await once(back, 'connect');
    back.emit('reclaim-host', { roomCode: T, hostId: 'host-nsa' });
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
