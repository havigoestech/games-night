// Stage 3b — the squad auto-split for two-sided games in an INDIVIDUALS
// tournament. Four individuals play Kill & Injury; the tournament splits them
// into two squads, and the winning squad's members each earn 1st-place points
// while the losing squad's earn 2nd — mapped back to each individual.
//
// Run with: npm run test:tourney-squad

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
    console.log('\n── Squad split: 4 individuals play Kill & Injury ──');
    const host = track(connNs('/tournament'));
    await once(host, 'connect');
    host.emit('create-tournament', {
      mode: 'individual',
      plan: [{ slug: 'kill-and-injury', length: 1 }],   // 1 match
      placement: [10, 4], hostId: 'host-sq'
    });
    const created = await once(host, 'tournament-created');
    const T = created.roomCode;

    const people = [['Ada', 'pid-ada'], ['Ben', 'pid-ben'], ['Cy', 'pid-cy'], ['Di', 'pid-di']];
    for (const [name, pid] of people) {
      const s = track(connNs('/tournament'));
      await once(s, 'connect');
      s.emit('join-room', { roomCode: T, playerName: name, teamIndex: -1, playerId: pid });
      await once(s, 'joined');
    }

    const goto = once(host, 'goto-game');
    host.emit('start-tournament');
    const g = await goto;
    ok(g.slug === 'kill-and-injury', 'a two-sided game launches for an individuals tournament');
    const gameRoom = g.playerUrl.match(/room=([A-Z0-9]{4})/)[1];

    // Host adopts the game; its two teams should be the squads.
    const gHost = track(connNs('/kill-and-injury'));
    await once(gHost, 'connect');
    gHost.emit('claim-host', { roomCode: gameRoom });
    const attached = await once(gHost, 'host-attached');
    ok(attached.teams.length === 2 && /squad/i.test(attached.teams[0].name),
       `the field was split into two squads (${attached.teams.map(t => t.name).join(' vs ')})`);

    // Players hop in; each learns their squad from the join snapshot.
    const gp = {};
    const squadOf = {};
    for (const [name, pid] of people) {
      const s = track(connNs('/kill-and-injury'));
      await once(s, 'connect');
      s.emit('rejoin-room', { roomCode: gameRoom, playerId: pid });
      const j = await once(s, 'joined');
      gp[name] = s; squadOf[name] = j.teamIndex;
    }
    const sizes = [0, 1].map(sq => people.filter(([n]) => squadOf[n] === sq).length);
    ok(sizes[0] === 2 && sizes[1] === 2, `balanced squads of 2 and 2 (got ${sizes[0]} / ${sizes[1]})`);

    const squadMembers = sq => people.map(([n]) => n).filter(n => squadOf[n] === sq);
    const [a0, a1] = squadMembers(0);   // squad 0 members
    const [b0] = squadMembers(1);        // a squad 1 member

    // Open the code phase, then each squad sets its secret.
    gHost.emit('start-codes');
    await once(gp[a0], 'code-phase', 8000);
    gp[a0].emit('set-code', { code: '1234' });   // squad 0's secret
    gp[b0].emit('set-code', { code: '5678' });   // squad 1's secret
    await sleep(400);
    gHost.emit('start-match');
    await once(gHost, 'round-start', 8000);

    // Squad 0 cracks squad 1's code (5678) → squad 0 wins the match. With
    // length 1, the game then auto-finishes.
    gp[a0].emit('submit-guess', { guess: '5678' });
    gp[b0].emit('submit-guess', { guess: '9012' });   // squad 1 misses (valid, distinct digits)
    await once(gHost, 'match-over', 10000);
    ok(true, 'the match resolves (squad 0 cracks squad 1)');
    await once(gHost, 'game-over', 9000);
    [gHost, ...Object.values(gp)].forEach(s => s.disconnect());
    await sleep(400);

    // Back to the tournament — placement points mapped to individuals.
    const back = track(connNs('/tournament'));
    await once(back, 'connect');
    back.emit('reclaim-host', { roomCode: T, hostId: 'host-sq' });
    const snap = await once(back, 'host-reclaimed');
    const scoreOf = name => snap.standings.find(s => s.name === name).score;
    const winners = squadMembers(0), losers = squadMembers(1);
    ok(winners.every(n => scoreOf(n) === 10), `winning squad members each got 10 (${winners.map(n => n + ':' + scoreOf(n)).join(', ')})`);
    ok(losers.every(n => scoreOf(n) === 4), `losing squad members each got 4 (${losers.map(n => n + ':' + scoreOf(n)).join(', ')})`);
    ok(snap.results[0].squadded === true, 'the result is flagged as a squad game');
  } finally {
    socks.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }
  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
