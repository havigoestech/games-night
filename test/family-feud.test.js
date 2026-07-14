// Integration test for the Family Feud server state machine.
// Spawns the real server on port 3100, drives full rounds with simulated
// host + 4 phone players over socket.io, and asserts the TV-show flow:
// face-off buzz race → judging → counter → play-or-pass → team play →
// strikes → steal, plus the reconnect model and anti-cheat answer split.
//
// Run with: npm run test:ff

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3100;
const BASE = `http://localhost:${PORT}/family-feud`;

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✅', label); }
  else      { failed++; console.log('  ❌', label); }
}

function conn() {
  return io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
}

function once(sock, ev, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for '${ev}'`)), timeout);
    sock.once(ev, d => { clearTimeout(t); resolve(d); });
  });
}

// Collects every emission of an event into an array (assert after a sleep).
function collect(sock, ev) {
  const arr = [];
  sock.on(ev, d => arr.push(d));
  return arr;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stderr.on('data', d => process.stderr.write(d));
    let up = false;
    child.stdout.on('data', d => {
      if (!up && String(d).includes('running at')) { up = true; resolve(child); }
    });
    child.on('exit', code => { if (!up) reject(new Error('server exited early: ' + code)); });
    setTimeout(() => { if (!up) reject(new Error('server did not start in 8s')); }, 8000);
  });
}

async function main() {
  const server = await startServer();
  const sockets = [];
  const track = s => { sockets.push(s); return s; };

  try {
    // ── Setup: host + 4 players (A1, A2 team 0 · B1, B2 team 1) ──
    console.log('\n── 1: Setup — 2-team lock, roster ──');
    const host = track(conn());
    await once(host, 'connect');
    host.emit('create-room', { teamCount: 5, teamNames: ['Alpha', 'Beta'] });
    const created = await once(host, 'room-created');
    const CODE = created.roomCode;
    ok(created.teams.length === 2, `room forces exactly 2 teams (asked for 5): ${CODE}`);

    const roster = { latest: null };
    host.on('players-update', d => { roster.latest = d; });

    const players = {};
    for (const [name, team, pid] of [['A1', 0, 'pid-a1'], ['A2', 0, 'pid-a2'], ['B1', 1, 'pid-b1'], ['B2', 1, 'pid-b2']]) {
      const s = track(conn());
      await once(s, 'connect');
      s.emit('join-room', { roomCode: CODE, playerName: name, teamIndex: team, playerId: pid });
      const j = await once(s, 'joined');
      ok(j.teamIndex === team && j.phase === 'lobby', `${name} joined team ${team}`);
      players[name] = s;
    }
    await sleep(200);
    ok(roster.latest && roster.latest.allPlayers.length === 4 &&
       roster.latest.allPlayers.every(p => p.connected), 'host roster: 4 connected players');

    let t0Score = 0, t1Score = 0;

    // ── 2: Anti-cheat split + face-off open ──
    console.log('\n── 2: Anti-cheat answer split ──');
    let hostQS = once(host, 'question-start');
    let playerQS = once(players.A1, 'question-start');
    let foOpen = once(players.B2, 'faceoff-open');
    host.emit('start-question');
    const [hq, pq, fo] = await Promise.all([hostQS, playerQS, foOpen]);
    ok(Array.isArray(hq.answers) && hq.answers.length === 6 &&
       typeof hq.answers[0].t === 'string' && typeof hq.answers[0].p === 'number',
       'host copy has the full answer key (6 answers, text + points)');
    ok(pq.answers === undefined && pq.answerCount === 6, 'player copy has NO answers, only the count');
    ok(fo.rebuzz === false, 'faceoff-open reaches players');
    const q1 = hq.answers;

    // ── 3: Buzz race ──
    console.log('\n── 3: Face-off buzz race ──');
    const buzzes = collect(host, 'faceoff-buzz');
    players.A1.emit('buzz');
    players.B1.emit('buzz');
    await sleep(300);
    ok(buzzes.length === 1 && buzzes[0].playerName === 'A1' && buzzes[0].teamIndex === 0,
       'exactly one faceoff-buzz — A1 won the race');
    host.emit('request-sync');
    let snap = await once(host, 'sync');
    ok(snap.phase === 'faceoff-judging' && snap.faceoff.buzzer.playerId === 'pid-a1',
       'phase is faceoff-judging with A1 as buzzer');

    // ── 4: #1-answer shortcut → play → board-clear bank ──
    console.log('\n── 4: Top answer wins face-off outright → play → board clear ──');
    let won = once(host, 'faceoff-won');
    let revealed = once(host, 'answer-revealed');
    host.emit('reveal-answer', { answerIndex: 0 });
    const [rv0, w1] = await Promise.all([revealed, won]);
    ok(rv0.context === 'faceoff' && rv0.pot === q1[0].p, `faceoff reveal: pot = ${rv0.pot}`);
    ok(w1.winnerTeamIndex === 0, 'team 0 wins face-off outright with the #1 answer');

    let tps = once(host, 'team-play-start');
    host.emit('choose-play-or-pass', { choice: 'play' });
    const tp1 = await tps;
    ok(tp1.controllingTeamIndex === 0 && tp1.choice === 'play', 'team 0 chose to play');

    let rc = once(host, 'round-complete');
    for (let i = 1; i < 6; i++) host.emit('reveal-answer', { answerIndex: i });
    const rc1 = await rc;
    const q1Total = q1.reduce((s, a) => s + a.p, 0);
    t0Score += q1Total;
    ok(rc1.reason === 'board-clear' && rc1.winnerTeamIndex === 0 && rc1.pot === q1Total,
       `board clear: team 0 banks the full pot (${q1Total})`);
    ok(rc1.scores[0].score === t0Score, 'score ledger matches');

    // ── 5: Counter outranks first answer → pass → 3 strikes → steal success ──
    console.log('\n── 5: Counter win → pass → strikes → steal success ──');
    hostQS = once(host, 'question-start');
    host.emit('start-question');
    const q2 = (await hostQS).answers;

    let fb = once(host, 'faceoff-buzz');
    players.B1.emit('buzz');
    await fb;
    let fc = once(host, 'faceoff-counter');
    host.emit('reveal-answer', { answerIndex: 2 });
    const fc1 = await fc;
    ok(fc1.counterTeamIndex === 0 && fc1.firstAnswer.teamIndex === 1 && fc1.firstAnswer.answerIndex === 2,
       'B1 revealed #3 → counter goes to team 0');
    won = once(host, 'faceoff-won');
    host.emit('reveal-answer', { answerIndex: 0 });
    const w2 = await won;
    ok(w2.winnerTeamIndex === 0, 'counter revealed higher-ranked answer → team 0 wins face-off');

    tps = once(host, 'team-play-start');
    host.emit('choose-play-or-pass', { choice: 'pass' });
    const tp2 = await tps;
    ok(tp2.controllingTeamIndex === 1 && tp2.choice === 'pass', 'team 0 passed → team 1 plays');

    const strikes = collect(host, 'wrong-answer');
    let stealMode = once(host, 'steal-mode');
    host.emit('host-wrong');
    host.emit('host-wrong');
    host.emit('host-wrong');
    const sm = await stealMode;
    ok(strikes.length === 3 && strikes[2].strikes === 3, 'three strikes recorded');
    ok(sm.stealTeamIndex === 0 && sm.pot === q2[2].p + q2[0].p, `steal mode: team 0 can steal ${sm.pot}`);

    rc = once(host, 'round-complete');
    host.emit('reveal-answer', { answerIndex: 1 });
    const rc2 = await rc;
    const q2Pot = q2[2].p + q2[0].p + q2[1].p;
    t0Score += q2Pot;
    ok(rc2.reason === 'steal' && rc2.winnerTeamIndex === 0 && rc2.pot === q2Pot,
       `steal success: team 0 takes the pot (${q2Pot})`);
    ok(rc2.scores[0].score === t0Score, 'score ledger matches after steal');

    // ── 6: First-buzz miss → counter any-answer wins → steal fail ──
    console.log('\n── 6: Face-off miss → counter wins → steal fail ──');
    hostQS = once(host, 'question-start');
    host.emit('start-question');
    const q3 = (await hostQS).answers;

    fb = once(host, 'faceoff-buzz');
    players.A2.emit('buzz');
    await fb;
    const strikeEvents = collect(host, 'wrong-answer');
    let fm = once(host, 'faceoff-miss');
    fc = once(host, 'faceoff-counter');
    host.emit('host-wrong');
    const [fm1, fc2] = await Promise.all([fm, fc]);
    ok(fm1.isCounter === false && fm1.reopen === false, 'A2 missed — faceoff-miss (not a strike)');
    ok(fc2.firstAnswer.answerIndex === null && fc2.counterTeamIndex === 1, 'counter to team 1, first answer recorded as miss');
    ok(strikeEvents.length === 0, 'no wrong-answer strike event during face-off');

    won = once(host, 'faceoff-won');
    host.emit('reveal-answer', { answerIndex: 4 });
    const w3 = await won;
    ok(w3.winnerTeamIndex === 1, 'counter team wins with ANY answer after a first-buzz miss');

    tps = once(host, 'team-play-start');
    host.emit('choose-play-or-pass', { choice: 'play' });
    await tps;
    stealMode = once(host, 'steal-mode');
    host.emit('host-wrong'); host.emit('host-wrong'); host.emit('host-wrong');
    await stealMode;
    rc = once(host, 'round-complete');
    host.emit('host-wrong'); // steal attempt missed
    const rc3 = await rc;
    t1Score += q3[4].p;
    ok(rc3.reason === 'steal-failed' && rc3.winnerTeamIndex === 1 && rc3.pot === q3[4].p,
       `steal failed: team 1 keeps the pot (${q3[4].p})`);

    // ── 7: Pre-buzz reveal blocked + both-miss rebuzz ──
    console.log('\n── 7: Pre-buzz reveal blocked · both-miss rebuzz ──');
    hostQS = once(host, 'question-start');
    host.emit('start-question');
    await hostQS;

    const preBuzzReveals = collect(host, 'answer-revealed');
    host.emit('reveal-answer', { answerIndex: 0 });
    await sleep(300);
    ok(preBuzzReveals.length === 0, 'reveal before any buzz is blocked');

    fb = once(host, 'faceoff-buzz');
    players.B2.emit('buzz');
    await fb;
    fc = once(host, 'faceoff-counter');
    host.emit('host-wrong');           // B2 missed
    await fc;
    fm = once(host, 'faceoff-miss');
    foOpen = once(host, 'faceoff-open');
    host.emit('host-wrong');           // counter missed too → both missed
    const [fm2, fo2] = await Promise.all([fm, foOpen]);
    ok(fm2.reopen === true && fo2.rebuzz === true, 'both missed → buzzers reopen');
    host.emit('request-sync');
    snap = await once(host, 'sync');
    ok(snap.phase === 'faceoff' && snap.strikes === 0 && snap.pot === 0, 'rebuzz state clean: no strikes, empty pot');

    fb = once(host, 'faceoff-buzz');
    players.B2.emit('buzz');
    const reB = await fb;
    ok(reB.playerName === 'B2', 'same player may buzz again after a rebuzz');

    // ── 8: End-round mid-face-off scraps the round ──
    console.log('\n── 8: End round mid-face-off ──');
    rc = once(host, 'round-complete');
    host.emit('end-round');
    const rc4 = await rc;
    ok(rc4.winnerTeamIndex === null && rc4.reason === 'host-ended', 'round scrapped: no winner');
    ok(rc4.scores[0].score === t0Score && rc4.scores[1].score === t1Score, 'scores unchanged');

    // ── 9: Reconnect mid-judging ──
    console.log('\n── 9: Reconnect mid-face-off-judging ──');
    hostQS = once(host, 'question-start');
    host.emit('start-question');
    const q5 = (await hostQS).answers;
    fb = once(host, 'faceoff-buzz');
    players.A1.emit('buzz');
    await fb;

    players.A1.disconnect();
    await sleep(200);
    ok(roster.latest.allPlayers.length === 4 &&
       roster.latest.allPlayers.find(p => p.name === 'A1').connected === false,
       'A1 kept in roster, marked away (not kicked)');

    const a1b = track(conn());
    await once(a1b, 'connect');
    a1b.emit('rejoin-room', { roomCode: CODE, playerId: 'pid-a1' });
    const rj = await once(a1b, 'joined');
    ok(rj.phase === 'faceoff-judging' && rj.faceoff.buzzer.playerId === 'pid-a1' && rj.question,
       'rejoin snapshot: still judging, A1 still the buzzer');
    await sleep(200);
    ok(roster.latest.allPlayers.length === 4 &&
       roster.latest.allPlayers.find(p => p.name === 'A1').connected === true,
       'no duplicate after rejoin, marked connected');

    // ── 10: Cleanup reveals + game over ──
    console.log('\n── 10: Round-over cleanup reveals + game over ──');
    won = once(host, 'faceoff-won');
    host.emit('reveal-answer', { answerIndex: 0 });
    await won;
    rc = once(host, 'round-complete');
    host.emit('end-round');            // from play-or-pass → face-off winner banks pot
    const rc5 = await rc;
    t0Score += q5[0].p;
    ok(rc5.winnerTeamIndex === 0 && rc5.pot === q5[0].p, 'end-round from play-or-pass banks pot to face-off winner');

    const cleanup = once(host, 'answer-revealed');
    host.emit('reveal-answer', { answerIndex: 3 });
    const cl = await cleanup;
    ok(cl.context === 'cleanup' && cl.pot === q5[0].p, 'cleanup reveal flips tile without touching the pot');
    host.emit('request-sync');
    snap = await once(host, 'sync');
    ok(snap.scores[0].score === t0Score && snap.scores[1].score === t1Score, 'cleanup reveal did not change scores');

    const over = once(host, 'game-over');
    host.emit('end-game');
    const go = await over;
    ok(go.scores[0].score >= go.scores[1].score, 'game over: leaderboard sorted');
    ok(go.scores.find(s => s.name === 'Alpha').score === t0Score &&
       go.scores.find(s => s.name === 'Beta').score === t1Score, 'final scores match the ledger');

    const late = track(conn());
    await once(late, 'connect');
    const lateErr = once(late, 'join-error');
    late.emit('join-room', { roomCode: CODE, playerName: 'Zed', teamIndex: 0, playerId: 'pid-z' });
    const le = await lateErr;
    ok(/ended/i.test(le.message), 'joining an ended game is rejected');

  } finally {
    sockets.forEach(s => { try { s.disconnect(); } catch (e) {} });
    server.kill();
  }

  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\n💥 Test crashed:', e.message); process.exit(1); });
