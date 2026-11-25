// Trivia mode: The Big Bluff — a two-stage round.
//   Stage 'bluff': everyone invents a convincing FAKE answer to the prompt.
//   Stage 'vote' : the real answer + all the fakes are shown shuffled; everyone
//                  votes for the one they think is TRUE (can't pick their own).
// Scoring: +500 for finding the truth (or for accidentally writing it), and
// +250 for every player your fake fools.
//
// Uses the engine's multi-stage hooks: nextStage() drives bluff → vote → score,
// and progressCount() reports the right per-stage count.
let BANK = [];
try { BANK = require('../data/bluff.js').QUESTIONS || []; } catch (e) { BANK = []; }

const FIND_TRUTH = 500;
const FOOL = 250;
const VOTE_SECONDS = 30;
const MAX_LEN = 60;

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Display every option starting with a capital, so the real answer (which may be
// stored lowercase) can't be spotted next to players' phone-autocapitalised fakes.
const capFirst = s => { const t = String(s == null ? '' : s); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

module.exports = {
  meta: { key: 'the-big-bluff', name: 'The Big Bluff', icon: '🎭', defaultSeconds: 45 },

  pickAndStart(room, cfg) {
    let pool = BANK.filter(q => !room.usedQuestions.has('bluff:' + norm(q.prompt)));
    if (!pool.length) pool = BANK.slice();
    const q = pool[Math.floor(Math.random() * pool.length)];
    room.usedQuestions.add('bluff:' + norm(q.prompt));
    room.currentQuestion = q;
    room.modeState = { prompt: q.prompt, truth: q.answer, truthNorm: norm(q.answer), stage: 'bluff',
      fakes: new Map(), options: null, votes: new Map(), truthWriters: [] };
  },

  publicQuestion(room) {
    return { mode: 'the-big-bluff', stage: 'bluff', prompt: room.modeState.prompt };
  },

  progressCount(room) {
    const m = room.modeState;
    return m ? (m.stage === 'bluff' ? m.fakes.size : m.votes.size) : 0;
  },

  submit(room, player, payload) {
    const m = room.modeState;
    if (!m) return { ok: false };
    const connected = room.players.filter(p => p.connected).length;
    if (m.stage === 'bluff') {
      const text = String((payload && payload.answer) || '').trim().slice(0, MAX_LEN);
      if (!text) return { ok: false };
      m.fakes.set(player.playerId, { text, norm: norm(text), name: player.name, teamIndex: player.teamIndex });  // revisable
      return { ok: true, ack: { stage: 'bluff', accepted: true, text }, allAnswered: connected > 0 && m.fakes.size >= connected };
    }
    // vote stage
    const opt = (m.options || []).find(o => o.id === String(payload && payload.optionId));
    if (!opt) return { ok: true, ack: { stage: 'vote', accepted: false } };
    if ((opt.sources || []).includes(player.playerId)) return { ok: true, ack: { stage: 'vote', accepted: false, reason: 'own' } };
    m.votes.set(player.playerId, opt.id);
    return { ok: true, ack: { stage: 'vote', accepted: true, optionId: opt.id }, allAnswered: connected > 0 && m.votes.size >= connected };
  },

  nextStage(room) {
    const m = room.modeState;
    if (m.stage !== 'bluff') return null;   // vote stage finished → engine scores
    // Build the vote options: the truth + each unique fake (merged), folding any
    // fake that matches the truth into "they found it".
    const byNorm = new Map();
    for (const [pid, f] of m.fakes) {
      if (f.norm === m.truthNorm) { m.truthWriters.push(pid); continue; }
      if (!byNorm.has(f.norm)) byNorm.set(f.norm, { text: f.text, sources: [] });
      byNorm.get(f.norm).sources.push(pid);
    }
    let idc = 0;
    const options = [{ id: 'o' + (idc++), text: capFirst(m.truth), isTruth: true, sources: [] }];
    for (const [, info] of byNorm) options.push({ id: 'o' + (idc++), text: capFirst(info.text), isTruth: false, sources: info.sources });
    m.options = shuffle(options);
    m.stage = 'vote';
    return { mode: 'the-big-bluff', stage: 'vote', prompt: m.prompt, options: m.options.map(o => ({ id: o.id, text: o.text })), seconds: VOTE_SECONDS };
  },

  score(room) {
    const m = room.modeState;
    const truthOpt = m.options.find(o => o.isTruth);
    const votesByOpt = {};
    for (const [voterId, optId] of m.votes) { (votesByOpt[optId] = votesByOpt[optId] || []).push(voterId); }

    const players = new Map();
    const ensure = (pid, name, teamIndex) => { if (!players.has(pid)) players.set(pid, { playerId: pid, name, teamIndex, foundTruth: false, fooled: 0, points: 0 }); return players.get(pid); };
    for (const [pid, f] of m.fakes) ensure(pid, f.name, f.teamIndex);
    for (const [voterId] of m.votes) { if (!players.has(voterId)) { const p = room.players.find(x => x.playerId === voterId); if (p) ensure(voterId, p.name, p.teamIndex); } }

    // finding the truth (by voting it, or by having written it)
    for (const voterId of (votesByOpt[truthOpt.id] || [])) { const p = players.get(voterId); if (p) { p.foundTruth = true; p.points += FIND_TRUTH; } }
    for (const pid of m.truthWriters) { const p = players.get(pid); if (p) { p.foundTruth = true; p.points += FIND_TRUTH; } }
    // fooling: every vote on a fake rewards that fake's author(s)
    for (const opt of m.options) {
      if (opt.isTruth) continue;
      const voters = votesByOpt[opt.id] || [];
      for (const src of (opt.sources || [])) { const p = players.get(src); if (p) { p.fooled += voters.length; p.points += voters.length * FOOL; } }
    }
    const perTeam = {};
    for (const p of players.values()) {
      if (room.teams[p.teamIndex]) room.teams[p.teamIndex].score += p.points;
      perTeam[p.teamIndex] = (perTeam[p.teamIndex] || 0) + p.points;
    }
    const nameOf = pid => (m.fakes.get(pid) || (players.get(pid) || {})).name;
    const revealOptions = m.options.map(o => ({
      text: o.text, isTruth: o.isTruth,
      authors: (o.sources || []).map(pid => nameOf(pid)).filter(Boolean),
      votes: (votesByOpt[o.id] || []).map(vid => (players.get(vid) || {}).name).filter(Boolean)
    }));
    const results = [...players.values()].sort((a, b) => b.points - a.points);
    return { mode: 'the-big-bluff', prompt: m.prompt, truth: capFirst(m.truth), options: revealOptions, results, roundPoints: perTeam };
  },

  youState(room, playerId) {
    const m = room.modeState;
    if (!m) return {};
    if (m.stage === 'bluff') { const f = m.fakes.get(playerId); return { stage: 'bluff', fake: f ? f.text : null }; }
    return { stage: 'vote', vote: m.votes.get(playerId) || null, yourFake: (m.fakes.get(playerId) || {}).text || null };
  }
};
