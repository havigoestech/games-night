// Integration test for No Say Am (Taboo-style describing game).
// Spawns the real server, drives a host + 2 describers through a full game and
// asserts: the turn/round state machine, that the word is dealt ONLY to the
// describer (never to a guesser's snapshot), got/skip scoring, the serial guard
// against a double-tap, host striking a wrongly-awarded word, and game-over.
//
// Run: npm run test:no-say-am
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3112;
const BASE = `http://localhost:${PORT}/no-say-am`;
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
    setTimeout(() => { if (!up) reject(new Error('server did not start')); }, 9000);
  });
}

async function main() {
  const server = await startServer();
  const socks = [];
  const track = s => { socks.push(s); return s; };
  try {
    console.log('\n── Setup: host + 2 teams, 1 round, 45s ──');
    const host = track(conn()); await once(host, 'connect');
    host.emit('create-room', { mode: 'teams', teamCount: 2, teamNames: ['Reds', 'Blues'], turnSeconds: 45, totalRounds: 1 });
    const created = await once(host, 'room-created');
    const CODE = created.roomCode;
    ok(created.teams.length === 2 && created.totalRounds === 1 && created.turnSeconds === 45, `room ${CODE}: 2 teams, 1 round, 45s`);

    const players = {};
    for (const [name, team, pid] of [['Ada', 0, 'pa'], ['Ben', 1, 'pb']]) {
      const s = track(conn()); await once(s, 'connect');
      s.emit('join-room', { roomCode: CODE, playerName: name, teamIndex: team, playerId: pid });
      await once(s, 'joined');
      players[name] = s;
    }
    await sleep(120);

    console.log('\n── Start game → team 0 turn-intro ──');
    const ti0p = once(host, 'turn-intro');
    host.emit('start-game');
    const ti0 = await ti0p;
    ok(ti0.teamIndex === 0 && ti0.describerId === 'pa' && ti0.round === 0, 'turn-intro: Reds up, Ada describes, round 0');

    console.log('\n── Start turn → card goes only to the describer ──');
    const cardP = once(players.Ada, 'card');       // Ada is the describer
    const tsP = once(host, 'turn-started');
    host.emit('start-turn');
    const [card0] = await Promise.all([cardP, tsP]);
    ok(typeof card0.word === 'string' && Array.isArray(card0.taboo) && card0.taboo.length === 5, `describer got a card ("${card0.word}") with 5 taboo words`);

    // Ben (a guesser on the other team) must NOT be able to see the word.
    const benSyncP = once(players.Ben, 'sync');
    players.Ben.emit('request-sync');
    const benSync = await benSyncP;
    ok(benSync.phase === 'in-turn' && !benSync.card && benSync.isDescriber === false, 'a guesser\'s snapshot carries NO card (word stays hidden)');

    console.log('\n── Got / serial-guard / skip ──');
    // Ada marks GOT on card0 → +1, new card dealt.
    const card1P = once(players.Ada, 'card');
    const prog1P = once(host, 'turn-progress');
    players.Ada.emit('mark', { result: 'got', serial: card0.serial });
    const [card1, prog1] = await Promise.all([card1P, prog1P]);
    ok(prog1.got === 1, 'GOT scored: got count = 1');
    ok(card1.serial !== card0.serial, 'a fresh card (new serial) is dealt after a mark');

    // Double-tap the OLD serial → must be ignored (no extra point).
    players.Ada.emit('mark', { result: 'got', serial: card0.serial });
    await sleep(150);
    // Skip card1.
    players.Ada.emit('mark', { result: 'skip', serial: card1.serial });
    await sleep(150);

    console.log('\n── End turn → turn-over with the log ──');
    const toP = once(host, 'turn-over');
    host.emit('end-turn');
    const to = await toP;
    const gotEntries = to.turnLog.filter(e => e.result === 'got');
    const skipEntries = to.turnLog.filter(e => e.result === 'skipped');
    ok(to.got === 1 && gotEntries.length === 1, 'turn-over: exactly ONE got (stale double-tap was ignored)');
    ok(skipEntries.length === 1, 'turn-over: the skip is logged');
    ok(to.scores.find(s => s.name === 'Reds').score === 1, 'Reds have 1 point going into the strike');

    console.log('\n── Host strikes the got word → point removed ──');
    const gotIndex = gotEntries[0].index;
    const toStruckP = once(host, 'turn-over');
    host.emit('strike', { index: gotIndex });
    const toStruck = await toStruckP;
    ok(toStruck.got === 0 && toStruck.turnLog[gotIndex].struck === true, 'striking marks the word struck and got drops to 0');
    ok(toStruck.scores.find(s => s.name === 'Reds').score === 0, 'Reds back to 0 after the strike');

    console.log('\n── Next → team 1 turn, then round ends → game-over ──');
    const ti1P = once(host, 'turn-intro');
    host.emit('next');
    const ti1 = await ti1P;
    ok(ti1.teamIndex === 1 && ti1.describerId === 'pb', 'next turn: Blues up, Ben describes');

    const card2P = once(players.Ben, 'card');
    host.emit('start-turn');
    const card2 = await card2P;
    const prog2P = once(host, 'turn-progress');
    players.Ben.emit('mark', { result: 'got', serial: card2.serial });
    await prog2P;

    const toBP = once(host, 'turn-over');
    host.emit('end-turn');
    await toBP;

    const goP = once(host, 'game-over', 8000);
    host.emit('next');            // last team of the last round → game-over
    const go = await goP;
    ok(go.scores.length === 2, 'game-over carries final scores for both teams');
    ok(go.scores.find(s => s.name === 'Blues').score === 1, 'Blues finished with their 1 point');
    ok(go.scores[0].score >= go.scores[1].score, 'final scores are sorted');

  } finally {
    socks.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }
  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
