// Integration test for Tournament mode — Stage 1 (foundation).
// Covers the roster, the game plan + placement config, join/reconnect, and the
// teams-vs-individual roster models. Game launching arrives in Stage 2 and its
// tests will be added then.
//
// Run with: npm run test:tourney

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const t = require('../games/tournament/game.js');

const PORT = 3100;
const BASE = `http://localhost:${PORT}/tournament`;

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✅', label); }
  else      { failed++; console.log('  ❌', label); }
}

const conn = () => io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
function once(sock, ev, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for '${ev}'`)), timeout);
    sock.once(ev, d => { clearTimeout(timer); resolve(d); });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe']
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
    // ── 1: plan + placement sanitisers ──
    console.log('\n── 1: Sanitisers ──');
    const plan = t.sanitisePlan([
      { slug: 'text-twist', length: 3 },
      { slug: 'nope-not-a-game', length: 5 },       // dropped
      { slug: 'kill-and-injury', length: 999 },     // clamped to 50
      { slug: 'grab-the-mic' }                        // default length
    ]);
    ok(plan.length === 3, 'unknown game slugs are dropped from the plan');
    ok(plan[1].length === 50, 'over-long lengths are clamped to 50');
    ok(plan[2].length === 10, 'a game with no length gets its default (Grab the Mic → 10)');
    ok(plan[0].twoSided === false && plan[1].twoSided === true, 'twoSided flag comes from the catalog');
    ok(t.sanitisePlacement([]).join(',') === '10,7,5,3,1', 'empty placement falls back to 10/7/5/3/1');
    ok(t.sanitisePlacement(['8','x','4']).join(',') === '8,4', 'placement keeps valid numbers, drops junk');

    // ── 2: Create (teams) ──
    console.log('\n── 2: Create — teams ──');
    const host = track(conn());
    await once(host, 'connect');
    host.emit('create-tournament', {
      mode: 'teams', teamCount: 3, teamNames: ['Reds', 'Blues', 'Greens'],
      plan: [{ slug: 'grab-the-mic', length: 15 }, { slug: 'text-twist', length: 3 }, { slug: 'family-feud', length: 5 }],
      placement: [10, 6, 3]
    });
    const created = await once(host, 'tournament-created');
    const CODE = created.roomCode;
    ok(created.teams.length === 3 && created.mode === 'teams', `tournament ${CODE}: 3 teams`);
    ok(created.plan.length === 3 && created.plan[0].slug === 'grab-the-mic', 'plan stored in order');
    ok(created.placement.join(',') === '10,6,3', 'host-set placement points echoed');

    const roster = { latest: null };
    host.on('players-update', d => { roster.latest = d; });

    // ── 3: Empty plan rejected ──
    console.log('\n── 3: Validation ──');
    const badHost = track(conn());
    await once(badHost, 'connect');
    badHost.emit('create-tournament', { mode: 'teams', teamCount: 2, teamNames: ['A', 'B'], plan: [] });
    ok(/at least one game/i.test((await once(badHost, 'create-tournament-error')).message),
       'a tournament with no games is rejected');

    // ── 4: Join (teams) + roster ──
    console.log('\n── 4: Join — teams ──');
    const P = {};
    for (const [name, team, pid] of [['Ada', 0, 'pid-ada'], ['Ben', 0, 'pid-ben'], ['Cy', 1, 'pid-cy']]) {
      const s = track(conn());
      await once(s, 'connect');
      s.emit('join-room', { roomCode: CODE, playerName: name, teamIndex: team, playerId: pid });
      const j = await once(s, 'joined');
      ok(j.myTeamIndex === team && j.plan.length === 3, `${name} joined team ${team} with the plan in the snapshot`);
      P[name] = s;
    }
    await sleep(200);
    ok(roster.latest.allPlayers.length === 3, 'host roster shows all 3 players');
    ok(roster.latest.standings.every(s => s.score === 0), 'everyone starts on 0 tournament points');

    // ── 5: Reconnect ──
    console.log('\n── 5: Reconnect ──');
    P.Ada.disconnect();
    await sleep(200);
    ok(roster.latest.allPlayers.find(p => p.name === 'Ada').connected === false &&
       roster.latest.allPlayers.length === 3, 'a dropped player is kept, marked away (not kicked)');
    const ada2 = track(conn());
    await once(ada2, 'connect');
    ada2.emit('rejoin-room', { roomCode: CODE, playerId: 'pid-ada' });
    const rj = await once(ada2, 'joined');
    ok(rj.myTeamIndex === 0 && rj.plan.length === 3 && rj.standings.length === 3,
       'rejoin restores team, plan and standings');
    await sleep(150);
    ok(roster.latest.allPlayers.length === 3 &&
       roster.latest.allPlayers.find(p => p.name === 'Ada').connected === true,
       'no duplicate roster entry after rejoin');
    P.Ada = ada2;

    // ── 6: Start stub ──
    console.log('\n── 6: Start (Stage 1 stub) ──');
    const ready = once(P.Ben, 'tournament-ready');
    host.emit('start-tournament');
    ok((await ready).plan.length === 3, 'start-tournament signals the line-up is ready (launching is Stage 2)');

    // ── 7: Individual mode ──
    console.log('\n── 7: Individual mode ──');
    const host2 = track(conn());
    await once(host2, 'connect');
    host2.emit('create-tournament', {
      mode: 'individual',
      plan: [{ slug: 'text-twist', length: 4 }, { slug: 'kill-and-injury', length: 3 }],
      placement: [10, 7, 5, 3, 1]
    });
    const created2 = await once(host2, 'tournament-created');
    ok(created2.mode === 'individual' && created2.teams.length === 0, 'individual tournament starts with no preset teams');

    const solo = track(conn());
    await once(solo, 'connect');
    solo.emit('join-room', { roomCode: created2.roomCode, playerName: 'Zed', teamIndex: -1, playerId: 'pid-zed' });
    const sj = await once(solo, 'joined');
    ok(sj.myTeamIndex === 0 && sj.teamNames[0] === 'Zed', 'in individual mode each player becomes their own entry');

    const solo2 = track(conn());
    await once(solo2, 'connect');
    solo2.emit('join-room', { roomCode: created2.roomCode, playerName: 'Uma', teamIndex: -1, playerId: 'pid-uma' });
    await once(solo2, 'joined');
    const blocked = once(host2, 'start-blocked').then(() => false).catch(() => true);
    host2.emit('start-tournament');   // 2 players — should NOT be blocked
    const ready2 = await Promise.race([once(host2, 'tournament-ready').then(() => true), sleep(600).then(() => false)]);
    ok(ready2, 'an individuals tournament with 2+ players can start');

    // ── 8: Host disconnect tears down ──
    console.log('\n── 8: Teardown ──');
    host.disconnect();
    await sleep(200);
    const late = track(conn());
    await once(late, 'connect');
    late.emit('check-room', { roomCode: CODE });
    ok((await once(late, 'room-check-result')).found === false, 'host leaving deletes the tournament room');

  } finally {
    sockets.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }

  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
