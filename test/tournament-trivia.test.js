// Stage 3b — proves Trivia runs correctly as a tournament game: launched
// pre-seeded (a single Fastest Finger round whose length = the line-up length),
// players auto-join by device id, the host drives the round to the end, and the
// final standings are reported back as placement points.
//
// Run with: npm run test:tourney-trivia

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const { QUESTIONS } = require('../games/trivia/data/questions-mc.js');

const PORT = 3101;
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

// Given a live Fastest Finger question, find the index of the correct option by
// matching the question text against the public bank (deterministic win).
function correctIndexFor(question, options) {
  const bank = QUESTIONS.find(q => q.q === question);
  if (!bank) return 0;                       // fallback — shouldn't happen
  const idx = options.indexOf(bank.correct);
  return idx >= 0 ? idx : 0;
}

async function main() {
  const server = await startServer();
  const socks = [];
  const track = s => { socks.push(s); return s; };
  try {
    console.log('\n── Trivia as a tournament game ──');
    const host = track(connNs('/tournament'));
    await once(host, 'connect');
    host.emit('create-tournament', {
      mode: 'teams', teamCount: 2, teamNames: ['Reds', 'Blues'],
      plan: [{ slug: 'trivia', length: 1 }],   // one Fastest Finger question
      placement: [10, 5], hostId: 'host-trv'
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
    ok(g.slug === 'trivia', 'tournament launches Trivia');
    ok(/\/games\/trivia\/host\.html\?room=[A-Z0-9]{4}&t=[A-Z0-9]{4}/.test(g.hostUrl), 'host URL carries room + tournament id');
    const gameRoom = g.playerUrl.match(/room=([A-Z0-9]{4})/)[1];

    // Host adopts the pre-created Trivia room.
    const gHost = track(connNs('/trivia'));
    await once(gHost, 'connect');
    gHost.emit('claim-host', { roomCode: gameRoom });
    const attached = await once(gHost, 'host-attached');
    ok(attached.phase === 'lobby' && attached.teamMode === 'teams', 'host adopts the pre-created Trivia room (lobby)');
    ok(Array.isArray(attached.teams) && attached.teams.length === 2, 'host-attached carries the two tournament teams');

    // Players auto-join by device id (new sockets on /trivia).
    const gPlayers = {};
    for (const r of roster) {
      const s = track(connNs('/trivia'));
      await once(s, 'connect');
      s.emit('rejoin-room', { roomCode: gameRoom, playerId: r.playerId });
      const j = await once(s, 'joined');
      ok(j.teamIndex === r.teamIndex, `${r.name} auto-joined Trivia on team ${r.teamIndex}`);
      gPlayers[r.name] = s;
    }

    // Drive the one Fastest Finger question. round-intro → question.
    const qPromise = once(gHost, 'question');
    gHost.emit('start-game');          // lobby → round-intro
    await once(gHost, 'round-intro');
    gHost.emit('advance');             // round-intro → question
    const q = await qPromise;
    ok(q.mode === 'fastest-finger', 'the tournament Trivia round is Fastest Finger');

    // Ada answers correctly, Cy answers wrong → Reds should win the question.
    const correctIdx = correctIndexFor(q.question, q.options);
    const wrongIdx = (correctIdx + 1) % q.options.length;
    const revealP = once(gHost, 'question-reveal');
    gPlayers.Ada.emit('submit', { choice: correctIdx });
    gPlayers.Cy.emit('submit', { choice: wrongIdx });
    const reveal = await revealP;      // fires once both (both connected) have answered
    ok(reveal.correctIndex === correctIdx, 'reveal marks the right option');
    const redScore = reveal.scores.find(s => s.name === 'Reds').score;
    const blueScore = reveal.scores.find(s => s.name === 'Blues').score;
    ok(redScore > 0 && blueScore === 0, `Reds scored on the correct answer, Blues 0 — got ${redScore}/${blueScore}`);

    // reveal → round-over (only question) → game-over (only round).
    const gameOverP = once(gHost, 'game-over', 9000);
    gHost.emit('advance');             // question-reveal → round-over
    await once(gHost, 'round-over');
    gHost.emit('advance');             // round-over → game-over (+ onComplete)
    const over = await gameOverP;
    ok(over.scores[0].name === 'Reds', 'Trivia ends with Reds in the lead');
    [gHost, ...Object.values(gPlayers)].forEach(s => s.disconnect());
    await sleep(400);

    // Host returns to the tournament → placement points applied from the finish order.
    const back = track(connNs('/tournament'));
    await once(back, 'connect');
    back.emit('reclaim-host', { roomCode: T, hostId: 'host-trv' });
    const snap = await once(back, 'host-reclaimed');
    const reds = snap.standings.find(s => s.name === 'Reds');
    const blues = snap.standings.find(s => s.name === 'Blues');
    ok(reds.score === 10 && blues.score === 5,
       `finish order → placement: Reds 10 (1st), Blues 5 (2nd) — got ${reds.score}/${blues.score}`);
    ok(snap.phase === 'between' && snap.nextGameIndex === null, 'tournament is complete-ready after its one game');
  } finally {
    socks.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }
  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
