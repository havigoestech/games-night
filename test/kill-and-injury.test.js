// Integration test for Kill & Injury.
// Boots the real server and drives a host + four phone players through code
// setting, simultaneous guessing, the shared notepad, and the reveal.
//
// The load-bearing assertions are the anti-leak ones: a side's secret must
// never reach the opponent OR the host before the match is over, because the
// host screen sits on a TV the whole room can see.
//
// Run with: npm run test:ki

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const ki = require('../games/kill-and-injury/game.js');

const PORT = 3100;
const BASE = `http://localhost:${PORT}/kill-and-injury`;

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✅', label); }
  else      { failed++; console.log('  ❌', label); }
}

const conn = () => io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });

function once(sock, ev, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for '${ev}'`)), timeout);
    sock.once(ev, d => { clearTimeout(t); resolve(d); });
  });
}
function collect(sock, ev) {
  const arr = [];
  sock.on(ev, d => arr.push(d));
  return arr;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stderr.on('data', d => process.stderr.write(d));
    let up = false;
    child.stdout.on('data', d => { if (!up && String(d).includes('running at')) { up = true; resolve(child); } });
    child.on('exit', c => { if (!up) reject(new Error('server exited early: ' + c)); });
    setTimeout(() => { if (!up) reject(new Error('server did not start in 10s')); }, 10000);
  });
}

const CODE_A = '1234';   // Reds' secret
const CODE_B = '5678';   // Blues' secret

async function main() {
  const server = await startServer();
  const sockets = [];
  const track = s => { sockets.push(s); return s; };

  try {
    // ── 1: judge() — the user's own worked examples ──
    console.log('\n── 1: The judge ──');
    const j1 = ki.judge('1234', '4567');
    ok(j1.kills === 0 && j1.injuries === 1, '1234 vs 4567 → 0 kills, 1 injury (the 4 is misplaced)');
    const j2 = ki.judge('1234', '1832');
    ok(j2.kills === 2 && j2.injuries === 1, '1234 vs 1832 → 2 kills, 1 injury (1 and 3 placed; 2 misplaced)');
    const j3 = ki.judge('1234', '1234');
    ok(j3.kills === 4 && j3.injuries === 0, 'an exact match is 4 kills, 0 injuries');
    const j4 = ki.judge('1234', '5678');
    ok(j4.kills === 0 && j4.injuries === 0, 'a total miss is 0 and 0');
    const j5 = ki.judge('1123', '1111');
    ok(j5.kills === 2 && j5.injuries === 0, 'repeat-safe counting: 1123 vs 1111 → 2 kills, 0 injuries');

    ok(ki.validCode('1234', 4) && !ki.validCode('1123', 4) && !ki.validCode('123', 4) && !ki.validCode('12a4', 4),
       'codes must be N digits, all different');
    ok(ki.winPoints(1) === 1000 && ki.winPoints(2) === 900 && ki.winPoints(5) === 600 && ki.winPoints(20) === 300,
       'points scale down per round and floor at 300');

    // ── 2: Room + roster ──
    console.log('\n── 2: Room + roster ──');
    const host = track(conn());
    await once(host, 'connect');
    host.emit('create-room', { teamNames: ['Reds', 'Blues'], codeLength: 4, roundSeconds: 30 });
    const created = await once(host, 'room-created');
    const ROOM = created.roomCode;
    ok(created.teams.length === 2 && created.codeLength === 4 && created.roundSeconds === 30,
       `room ${ROOM}: exactly 2 sides, 4-digit codes, 30s rounds`);

    const roster = { latest: null };
    host.on('players-update', d => { roster.latest = d; });

    const P = {};
    for (const [name, team, pid] of [['Ada', 0, 'pid-ada'], ['Ben', 0, 'pid-ben'], ['Cy', 1, 'pid-cy'], ['Di', 1, 'pid-di']]) {
      const s = track(conn());
      await once(s, 'connect');
      s.emit('join-room', { roomCode: ROOM, playerName: name, teamIndex: team, playerId: pid });
      await once(s, 'joined');
      P[name] = s;
    }
    await sleep(200);
    ok(roster.latest.allPlayers.length === 4, 'host roster shows all 4 players');

    // Every payload the host or the opponent receives gets scanned for a secret.
    const hostFeed = [];
    const oppFeed = [];   // Blues' view — must never contain Reds' code (and vice versa)
    ['joined', 'sync', 'code-phase', 'code-status', 'match-start', 'round-start', 'timer',
     'guess-locked', 'round-result', 'notes-update', 'players-update', 'your-code'].forEach(ev => {
      host.on(ev, d => hostFeed.push([ev, JSON.stringify(d)]));
      P.Cy.on(ev, d => oppFeed.push([ev, JSON.stringify(d)]));
    });

    // ── 3: Setting the codes ──
    console.log('\n── 3: Setting the codes ──');
    const cp = once(P.Ada, 'code-phase');
    host.emit('start-codes');
    await cp;
    ok(true, 'host opened the code-setting phase');

    // Bad codes are refused
    const badRepeat = once(P.Ada, 'code-rejected');
    P.Ada.emit('set-code', { code: '1123' });
    ok(/different digits/i.test((await badRepeat).message), 'a code with a repeated digit is refused');
    const badLen = once(P.Ada, 'code-rejected');
    P.Ada.emit('set-code', { code: '123' });
    ok(/different digits/i.test((await badLen).message), 'a code of the wrong length is refused');

    // Ada sets Reds' code — Ben (teammate) should see it
    const benSeesCode = once(P.Ben, 'your-code');
    P.Ada.emit('set-code', { code: CODE_A });
    const bc = await benSeesCode;
    ok(bc.code === CODE_A && bc.by === 'Ada', `Ada set ${CODE_A} and teammate Ben can see it`);

    // Collect rather than once() — Ada's "ready" event already fired, so a bare
    // once() here can catch hers instead of Cy's.
    const statuses = collect(host, 'code-status');
    P.Cy.emit('set-code', { code: CODE_B });
    await sleep(250);
    const st = statuses[statuses.length - 1];
    ok(st && st.ready[0] === true && st.ready[1] === true, 'host sees BOTH sides ready — but not the codes');

    await sleep(150);
    const secretLeakToHost = hostFeed.filter(([, blob]) => blob.includes(CODE_A) || blob.includes(CODE_B));
    ok(secretLeakToHost.length === 0,
       'ANTI-LEAK: no payload to the host contains either code (the TV is safe)');
    const secretLeakToOpp = oppFeed.filter(([, blob]) => blob.includes(CODE_A));
    ok(secretLeakToOpp.length === 0, "ANTI-LEAK: Blues never receive Reds' code");

    // ── 4: Simultaneous round ──
    console.log('\n── 4: Simultaneous guessing ──');
    const ms = once(P.Ada, 'match-start');
    host.emit('start-match');
    await ms;
    const r1 = await once(host, 'round-start');
    ok(r1.round === 1 && r1.secondsLeft === 30, 'round 1 opens with the 30s clock');

    // Reds lock in first — Blues must SEE that (but not what)
    const blueSeesLock = once(P.Cy, 'guess-locked');
    P.Ada.emit('submit-guess', { guess: '4567' });     // vs Blues' 5678
    const lock = await blueSeesLock;
    ok(lock.teamIndex === 0 && lock.by === 'Ada' && lock.guess === undefined,
       'Blues see that Reds have locked in — but not the guess itself');

    // A teammate can't overwrite the locked guess
    const dbl = once(P.Ben, 'guess-rejected');
    P.Ben.emit('submit-guess', { guess: '1111' });
    ok(/already locked/i.test((await dbl).message), 'once a side has locked in, a teammate cannot overwrite it');

    const t0 = Date.now();
    const rr = once(host, 'round-result');
    P.Cy.emit('submit-guess', { guess: '1832' });      // vs Reds' 1234
    const res1 = await rr;
    const elapsed = Date.now() - t0;
    ok(elapsed < 5000, `the round resolved EARLY (${elapsed}ms) — nobody waited out the 30s clock`);

    const redRes  = res1.results.find(r => r.teamIndex === 0);
    const blueRes = res1.results.find(r => r.teamIndex === 1);
    // 4567 against 5678: nothing is in the right slot, but 5, 6 and 7 are all
    // present — three injuries. (The user's "1 injury" figure was for secret 1234.)
    ok(redRes.guess === '4567' && redRes.kills === 0 && redRes.injuries === 3,
       "Reds' 4567 vs 5678 → 0 kills, 3 injuries");
    ok(blueRes.guess === '1832' && blueRes.kills === 2 && blueRes.injuries === 1,
       "Blues' 1832 vs 1234 → 2 kills, 1 injury");
    ok(res1.boards[0].length === 1 && res1.boards[1].length === 1, 'both boards are public and populated');

    // ── 5: Guess validation ──
    console.log('\n── 5: Guess validation ──');
    await once(host, 'round-start');                   // round 2
    const dup = once(P.Ada, 'guess-rejected');
    P.Ada.emit('submit-guess', { guess: '4567' });     // already tried in round 1
    ok(/already tried/i.test((await dup).message), 'repeating a guess your side already made is refused');
    const rep = once(P.Ada, 'guess-rejected');
    P.Ada.emit('submit-guess', { guess: '1122' });
    ok(/different digits/i.test((await rep).message), 'a guess with repeated digits is refused');

    // ── 6: Shared notepad ──
    console.log('\n── 6: Shared team notepad ──');
    const benNote = once(P.Ben, 'notes-update');
    const cyNotes = collect(P.Cy, 'notes-update');
    P.Ada.emit('update-note', { digit: '7', state: 'out' });
    const nb = await benNote;
    ok(nb.notes['7'] === 'out' && nb.by === 'Ada',
       "Ada ruling out a 7 greys it out on teammate Ben's phone instantly");
    await sleep(150);
    ok(cyNotes.length === 0, "ANTI-LEAK: the opposing side never sees Reds' working");

    // ── 7: Forfeit on the clock ──
    console.log('\n── 7: Forfeit ──');
    const rr2 = once(host, 'round-result', 40000);
    P.Ada.emit('submit-guess', { guess: '5670' });     // Reds guess; Blues dally
    const res2 = await rr2;
    const blueRow = res2.results.find(r => r.teamIndex === 1);
    ok(blueRow.forfeit === true && blueRow.guess === null,
       'a side that never submits gets a visible forfeit row when the clock runs out');

    // ── 8: Reconnect mid-match ──
    console.log('\n── 8: Reconnect mid-match ──');
    await once(host, 'round-start');                   // round 3
    await sleep(1200);
    P.Ada.disconnect();
    await sleep(250);
    ok(roster.latest.allPlayers.find(p => p.name === 'Ada').connected === false &&
       roster.latest.allPlayers.length === 4,
       'a dropped player is kept in the roster, marked away (not kicked)');

    const ada2 = track(conn());
    await once(ada2, 'connect');
    ada2.emit('rejoin-room', { roomCode: ROOM, playerId: 'pid-ada' });
    const rj = await once(ada2, 'joined');
    ok(rj.phase === 'guessing' && rj.round === 3, 'rejoin restores the live match at the right round');
    ok(rj.secondsLeft > 0 && rj.secondsLeft < 30, `rejoin restores a LIVE clock (${rj.secondsLeft}s, not 30)`);
    ok(rj.myCode === CODE_A, "rejoin restores the player's OWN code");
    ok(rj.myNotes['7'] === 'out', 'rejoin restores the shared notepad');
    ok(rj.boards[0].length === 2 && rj.boards[1].length === 2, 'rejoin restores both public boards');
    await sleep(200);
    ok(roster.latest.allPlayers.length === 4 &&
       roster.latest.allPlayers.find(p => p.name === 'Ada').connected === true,
       'no duplicate roster entry after rejoin');
    P.Ada = ada2;

    // ── 9: Cracking it ──
    console.log('\n── 9: Cracking the code ──');
    // Mark the feed here. Everything the host saw BEFORE anyone guessed correctly
    // must be free of both codes. (Once a code is correctly guessed it appears in
    // the public round-result by definition — that IS cracking it, not a leak.)
    const feedMark = hostFeed.length;

    const cracked = once(host, 'match-over', 40000);
    P.Ada.emit('submit-guess', { guess: CODE_B });     // Reds crack Blues' code in round 3
    P.Cy.emit('submit-guess', { guess: '1235' });      // Blues fall short
    const mo = await cracked;
    ok(mo.reason === 'cracked' && mo.winnerTeamIndex === 0, 'Reds crack the code and win the match');
    ok(mo.rounds === 3 && mo.points[0] === ki.winPoints(3) && mo.points[1] === 0,
       `cracked in round 3 → ${ki.winPoints(3)} points to Reds, 0 to Blues (winner takes all)`);
    ok(mo.secrets[0] === CODE_A && mo.secrets[1] === CODE_B,
       'match-over is the ONLY moment both codes are revealed');
    ok(mo.scores[0].score === ki.winPoints(3), 'the win is banked into the running score');

    const leakBefore = hostFeed.slice(0, feedMark)
      .filter(([, blob]) => blob.includes(CODE_A) || blob.includes(CODE_B));
    ok(leakBefore.length === 0,
       `ANTI-LEAK (final): across ${feedMark} payloads before anyone guessed right, the host never saw a code`);

    // And the winning guess IS public — that's cracking it, not a leak.
    const winRow = mo.boards[0][mo.boards[0].length - 1];
    ok(winRow.guess === CODE_B && winRow.kills === 4,
       'the cracking guess is public, as it must be — 4 kills');

    const oppLeak = oppFeed.filter(([, blob]) => blob.includes(CODE_A));
    ok(oppLeak.length === 0, "ANTI-LEAK (final): Blues never received Reds' code at any point");

    // ── 10: Next match resets everything ──
    console.log('\n── 10: Next match + game over ──');
    const cp2 = once(P.Ben, 'code-phase');
    host.emit('start-codes');
    const cp2d = await cp2;
    ok(cp2d.match === 2, 'host starts match 2');
    P.Ben.emit('request-sync');
    const s2 = await once(P.Ben, 'sync');
    ok(s2.boards[0].length === 0 && s2.boards[1].length === 0 && s2.myCode === null &&
       s2.myNotes['7'] === 'unknown',
       'a new match resets the boards, the codes and the notepads');

    const over = once(host, 'game-over');
    host.emit('end-game');
    const go = await over;
    ok(go.scores[0].score >= go.scores[1].score, 'game over: leaderboard sorted high to low');

    const late = track(conn());
    await once(late, 'connect');
    const le = once(late, 'join-error');
    late.emit('join-room', { roomCode: ROOM, playerName: 'Late', teamIndex: 0, playerId: 'pid-late' });
    ok(/ended/i.test((await le).message), 'joining an ended game is rejected');

  } finally {
    sockets.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }

  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
