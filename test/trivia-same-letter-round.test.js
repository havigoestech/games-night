// Integration test for the "Same Letter · Round" mode (one fixed letter for the
// whole round), plus the dictionary gibberish FLAG (regression: the require path
// was broken so nothing was ever flagged) and the host skip-question/skip-round
// controls. Spawns the real server, drives a host + 2 players.
// Run: npm run test:trivia-slr
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3108;
const BASE = `http://localhost:${PORT}/trivia`;
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
      playlist: [
        { mode: 'same-letter-round', count: 3, seconds: 30 },
        { mode: 'fastest-finger', count: 1, seconds: 20 }
      ] });
    const { roomCode } = await once(host, 'room-created');

    const players = {};
    for (const [name, team, pid] of [['Ada', 0, 'pa'], ['Ben', 1, 'pb']]) {
      const s = track(conn()); await once(s, 'connect');
      s.emit('join-room', { roomCode, playerName: name, teamIndex: team, playerId: pid });
      await once(s, 'joined'); players[name] = s;
    }
    await sleep(120);

    // ── Round 0: Same Letter · Round ──
    const intro = (host.emit('start-game'), await once(host, 'round-intro'));
    ok(/Same Letter · Round/.test(intro.modeName), 'round-intro: mode is "Same Letter · Round"');
    ok(intro.totalRounds === 2, 'two rounds in the playlist');
    ok(typeof intro.roundNote === 'string' && /starts with [A-Z]/.test(intro.roundNote), `round-intro announces the round letter ("${intro.roundNote}")`);
    const roundLetter = intro.roundNote.match(/starts with ([A-Z])/)[1];

    // Q1
    const q1 = (host.emit('advance'), await once(host, 'question'));
    ok(q1.mode === 'same-letter', 'question renders with the Same Letter screen (mode:same-letter)');
    ok(q1.modeName === 'Same Letter · Round', 'question carries the mode badge name');
    ok(q1.letter === roundLetter, `Q1 uses the round letter ${roundLetter}`);
    ok(q1.qCount === 3, 'round has 3 questions');

    // Ada submits a gibberish answer (starts with the letter but is not a word).
    const gib = roundLetter + 'qzzx';
    players.Ada.emit('submit', { answer: gib });
    players.Ada.emit('submit', { answer: roundLetter + 'at' });   // may or may not be a word; fine
    await sleep(200);

    const rev1 = (host.emit('advance'), await once(host, 'question-reveal'));
    const gibGroup = (rev1.groups || []).find(g => g.text === gib);
    ok(gibGroup && gibGroup.flagged === true, 'REGRESSION: gibberish answer is flagged by the dictionary');
    ok(rev1.modeName === 'Same Letter · Round', 'reveal carries the mode badge name');

    // Q2 — must reuse the SAME round letter.
    const q2 = (host.emit('advance'), await once(host, 'question'));
    ok(q2.letter === roundLetter, `Q2 reuses the round letter ${roundLetter}`);
    ok(q2.qNumber === 2, 'Q2 is question 2 of the round');

    // ── Skip question: from Q2 jump straight to Q3 (no scoring, same letter) ──
    const q3 = (host.emit('skip-question'), await once(host, 'question'));
    ok(q3.qNumber === 3 && q3.letter === roundLetter, 'skip-question advances to Q3, still the round letter');

    // ── Skip round: from mid-Q3 jump to round 1 (Fastest Finger) ──
    const intro2 = (host.emit('skip-round'), await once(host, 'round-intro'));
    ok(intro2.roundIndex === 1 && /Fastest Finger/.test(intro2.modeName), 'skip-round jumps to the next round (Fastest Finger)');
    ok(!intro2.roundNote, 'Fastest Finger round has no round-letter note');

    // FF question, then skip it (last in round) → round-over.
    await (host.emit('advance'), once(host, 'question'));
    const ro = (host.emit('skip-question'), await once(host, 'round-over'));
    ok(ro.roundIndex === 1, 'skip-question on the last question ends the round (round-over)');

    // Last round over → game over.
    const go = (host.emit('advance'), await once(host, 'game-over'));
    ok(go.scores.length === 2, 'game over with final scores');
  } finally {
    sockets.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }
  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
