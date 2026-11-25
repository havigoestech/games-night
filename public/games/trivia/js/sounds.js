let _ctx = null;

function ctx() {
  if (!_ctx) {
    try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function tone(freq, type, vol, t0, dur, endFreq) {
  const c = ctx(); if (!c) return;
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.connect(g); g.connect(c.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur * 0.9);
  g.gain.setValueAtTime(0.001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const Sounds = {
  // Call this inside the first user interaction to unlock audio on iOS/Safari
  unlockAudio() { ctx(); },

  // Harsh game-show buzzer
  buzz() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    tone(160, 'sawtooth', 0.9, t,        0.5,  55);
    tone(80,  'square',   0.5, t + 0.04, 0.45, 40);
  },

  // Metronome tick — danger=true gives a sharper, louder click
  tick(danger) {
    const c = ctx(); if (!c) return;
    tone(danger ? 1000 : 660, 'sine', danger ? 0.35 : 0.18, c.currentTime, 0.07);
  },

  // Rising 3-note fanfare when buzzers go live
  go() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    tone(523, 'sine', 0.35, t,        0.18);
    tone(659, 'sine', 0.35, t + 0.15, 0.18);
    tone(784, 'sine', 0.55, t + 0.30, 0.35);
  },

  // Quick upward sweep on word reveal
  wordReveal() {
    const c = ctx(); if (!c) return;
    tone(350, 'sine', 0.28, c.currentTime, 0.22, 850);
  },

  // Triple alarm when singing time runs out
  timeUp() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    [0, 0.2, 0.4].forEach(d => {
      tone(900, 'square', 0.5, t + d,        0.15);
      tone(450, 'square', 0.4, t + d + 0.1,  0.1);
    });
  },

  // Ascending 4-note fanfare for point awarded
  pointAwarded() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 'sine', 0.5, t + i * 0.11, 0.35));
  },

  // Descending wah-wah for no point
  noPoint() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    tone(440, 'sawtooth', 0.4, t,        0.2,  300);
    tone(300, 'sawtooth', 0.4, t + 0.18, 0.3,  140);
  },

  // Big ascending fanfare for game over
  gameOver() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    [523, 659, 523, 784, 659, 1047].forEach((f, i) => tone(f, 'sine', 0.55, t + i * 0.14, 0.38));
  }
};
