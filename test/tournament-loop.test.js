// Stage 2a — the tournament orchestration loop, end to end, headless.
//
// This is the load-bearing test: it proves the tournament can launch a game
// pre-seeded with its roster (in a DIFFERENT namespace), have players auto-join
// by their device id with no team pick, play it, auto-finish after the set
// number of rounds, and fold the finishing order into placement points on the
// running standings — then do it again for the next game. Navigation between
// pages is a browser concern (Stage 2b); here each "hop" is simulated by opening
// a fresh socket to the next namespace, exactly as a page load would.
//
// Run with: npm run test:tourney-loop

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const puzzles = require('../games/text-twist/puzzles');

const PORT = 3100;
let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✅', label); }
  else      { failed++; console.log('  ❌', label); }
}
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
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stderr.on('data', d => process.stderr.write(d));
    let up = false;
    child.stdout.on('data', d => { if (!up && String(d).includes('running at')) { up = true; resolve(child); } });
    child.on('exit', c => { if (!up) reject(new Error('server exited early: ' + c)); });
    setTimeout(() => { if (!up) reject(new Error('server did not start')); }, 10000);
  });
}

// Resolve a Text Twist puzzle from its dealt letters, so we can submit real words.
function puzzleFromLetters(letters) {
  const key = letters.split('').sort().join('');
  return Object.values(puzzles.bank).flat().find(p => p.source.split('').sort().join('') === key);
}

async function main() {
  const server = await startServer();
  const socks = [];
  const track = s => { socks.push(s); return s; };

  // Play one launched Text Twist game to completion, letting the Reds (team 0)
  // outscore the Blues so the finishing order is deterministic.
  async function playGame(gameRoom, roster) {
    // Host claims the pre-created room.
    const gHost = track(connNs('/text-twist'));
    await once(gHost, 'connect');
    gHost.emit('claim-host', { roomCode: gameRoom });
    const attached = await once(gHost, 'host-attached');

    // Players hop in by re-joining with their device id — no name, no team pick.
    const gPlayers = {};
    for (const r of roster) {
      const s = track(connNs('/text-twist'));
      await once(s, 'connect');
      s.emit('rejoin-room', { roomCode: gameRoom, playerId: r.playerId });
      const j = await once(s, 'joined');
      ok(j.teamIndex === r.teamIndex, `${r.name} auto-joined the game on team ${r.teamIndex} (no team pick)`);
      gPlayers[r.name] = s;
    }

    const length = attached.tournamentLength;
    let sawFinalFlag = false;
    for (let round = 1; round <= length; round++) {
      const rs = once(gHost, 'round-start');
      gHost.emit('start-round');
      const r = await rs;
      const puz = puzzleFromLetters(r.letters);
      // A Reds player finds one word → Reds lead.
      const reds = roster.find(x => x.teamIndex === 0).name;
      const word = puz.words.find(w => w.length === 4) || puz.words[0];
      const rc = once(gHost, 'round-complete');
      gPlayers[reds].emit('submit-word', { word });
      await sleep(120);
      gHost.emit('end-round');
      const done = await rc;
      if (done.tournamentFinalRound) sawFinalFlag = true;
    }
    ok(sawFinalFlag, `the final round is flagged so the game knows to wrap up (after ${length})`);

    // The final round schedules an automatic game-over → onComplete. Wait it out.
    await once(gHost, 'game-over', 9000);
    [gHost, ...Object.values(gPlayers)].forEach(s => s.disconnect());
  }

  try {
    console.log('\n── 1: Create + roster ──');
    const host = track(connNs('/tournament'));
    await once(host, 'connect');
    host.emit('create-tournament', {
      mode: 'teams', teamCount: 2, teamNames: ['Reds', 'Blues'],
      plan: [{ slug: 'text-twist', length: 1 }, { slug: 'text-twist', length: 1 }],
      placement: [10, 6], hostId: 'host-1'
    });
    const created = await once(host, 'tournament-created');
    const TCODE = created.roomCode;
    ok(created.plan.length === 2, `tournament ${TCODE}: 2-game plan (Text Twist ×2)`);

    const roster = [
      { name: 'Ada', teamIndex: 0, playerId: 'pid-ada' },
      { name: 'Ben', teamIndex: 0, playerId: 'pid-ben' },
      { name: 'Cy',  teamIndex: 1, playerId: 'pid-cy'  },
      { name: 'Di',  teamIndex: 1, playerId: 'pid-di'  }
    ];
    const tPlayers = {};
    for (const r of roster) {
      const s = track(connNs('/tournament'));
      await once(s, 'connect');
      s.emit('join-room', { roomCode: TCODE, playerName: r.name, teamIndex: r.teamIndex, playerId: r.playerId });
      await once(s, 'joined');
      tPlayers[r.name] = s;
    }
    ok(true, 'four players joined the tournament');

    // ── 2: Start → launch game 1 ──
    console.log('\n── 2: Start launches game 1 ──');
    const gotoP = once(tPlayers.Ada, 'goto-game');
    const gotoH = once(host, 'goto-game');
    host.emit('start-tournament');
    const [gp, gh] = await Promise.all([gotoP, gotoH]);
    ok(gp.slug === 'text-twist' && gp.playerUrl.includes(`t=${TCODE}`),
       'players are told to hop into game 1 with the tournament code in the URL');
    ok(gh.hostUrl.includes('/games/text-twist/host.html') && gh.hostUrl.includes('room='),
       'host gets a host URL for the pre-created game room');
    const game1Room = gp.playerUrl.match(/room=([A-Z0-9]{4})/)[1];

    // The tournament sockets drop as everyone "navigates" away.
    Object.values(tPlayers).forEach(s => s.disconnect());
    host.disconnect();
    await sleep(200);

    // ── 3: Play game 1 (auto-finishes) ──
    console.log('\n── 3: Play game 1 ──');
    await playGame(game1Room, roster);
    await sleep(300);

    // ── 4: Host returns → placement points applied ──
    console.log('\n── 4: Back to the tournament — placement points ──');
    const back1 = track(connNs('/tournament'));
    await once(back1, 'connect');
    back1.emit('reclaim-host', { roomCode: TCODE, hostId: 'host-1' });
    const snap1 = await once(back1, 'host-reclaimed');
    ok(snap1.phase === 'between', 'the tournament is between games when the host returns');
    const reds1 = snap1.standings.find(s => s.name === 'Reds');
    const blues1 = snap1.standings.find(s => s.name === 'Blues');
    ok(reds1.score === 10 && blues1.score === 6,
       `game 1 folded into placement points: Reds 10 (1st), Blues 6 (2nd) — got ${reds1.score}/${blues1.score}`);
    ok(snap1.results.length === 1 && snap1.results[0].awarded.length === 2, 'the game result is recorded with per-team awards');
    ok(snap1.nextGameIndex === 1, 'there is a next game queued');

    // ── 5: Next game → cumulative standings ──
    console.log('\n── 5: Next game + cumulative ──');
    // Players return to the tournament so they can be told about game 2.
    const tP2 = {};
    for (const r of roster) {
      const s = track(connNs('/tournament'));
      await once(s, 'connect');
      s.emit('rejoin-room', { roomCode: TCODE, playerId: r.playerId });
      await once(s, 'joined');
      tP2[r.name] = s;
    }
    const goto2 = once(tP2.Cy, 'goto-game');
    back1.emit('next-game');
    const gp2 = await goto2;
    const game2Room = gp2.playerUrl.match(/room=([A-Z0-9]{4})/)[1];
    ok(game2Room !== game1Room, 'game 2 spins up a fresh room');
    Object.values(tP2).forEach(s => s.disconnect());
    back1.disconnect();
    await sleep(200);

    await playGame(game2Room, roster);
    await sleep(300);

    const back2 = track(connNs('/tournament'));
    await once(back2, 'connect');
    back2.emit('reclaim-host', { roomCode: TCODE, hostId: 'host-1' });
    const snap2 = await once(back2, 'host-reclaimed');
    const reds2 = snap2.standings.find(s => s.name === 'Reds');
    const blues2 = snap2.standings.find(s => s.name === 'Blues');
    ok(reds2.score === 20 && blues2.score === 12,
       `standings accumulate across games: Reds 20, Blues 12 — got ${reds2.score}/${blues2.score}`);
    ok(snap2.nextGameIndex === null, 'no next game after the last one');
    ok(snap2.results.length === 2, 'both game results are recorded');

    // ── 6: Finish ──
    console.log('\n── 6: Finish ──');
    const over = once(back2, 'tournament-over');
    back2.emit('end-tournament');
    const fin = await over;
    ok(fin.standings[0].name === 'Reds' && fin.standings[0].score === 20, 'final standings crown the Reds champion');

  } finally {
    socks.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }

  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
