// Testing overlay — injected into every page, but ONLY by a dev server started
// with DEV_TOOLS=1 (see dev/index.js). Never reaches production.
//
// Point: when you spot something mid-game, hit 📌 and type one line. It pins the
// exact moment — which screen, what the server just sent, what was on screen —
// into dev-feedback/notes.jsonl, so the feedback doesn't decay into "the thing
// on the word screen looked off".
(() => {
  if (window.__devNotes) return;
  window.__devNotes = true;

  const MAX_EVENTS = 30;
  const events = [];

  // ---- record socket traffic ------------------------------------------------
  // Every game client declares a top-level `const socket = io('/ns')`, which
  // lives in the global lexical scope — reachable from this script by name.
  function currentSocket() {
    try { return typeof socket !== 'undefined' ? socket : window.socket; } catch (e) { return null; }
  }
  function trim(v) {
    try {
      let s = JSON.stringify(v);
      if (s === undefined) return '[undefined]';
      s = s.replace(/"data:image\/[^"]{40,}"/g, '"[image]"');   // QR payloads are noise
      return s.length > 600 ? s.slice(0, 600) + '…' : JSON.parse(s);
    } catch (e) { return '[unserializable]'; }
  }
  function record(dir, event, args) {
    events.push({ t: new Date().toISOString().slice(11, 23), dir, event, args: trim(args) });
    while (events.length > MAX_EVENTS) events.shift();
  }
  function hook() {
    const s = currentSocket();
    if (!s || s.__devHooked) return !!(s && s.__devHooked);
    s.__devHooked = true;
    if (s.onAny) s.onAny((event, ...args) => record('in', event, args));
    const emit = s.emit.bind(s);
    s.emit = (event, ...args) => { record('out', event, args); return emit(event, ...args); };
    return true;
  }
  if (!hook()) {
    const iv = setInterval(() => { if (hook()) clearInterval(iv); }, 200);
    setTimeout(() => clearInterval(iv), 15000);
  }

  // ---- what's on screen right now -------------------------------------------
  const qs = k => new URLSearchParams(location.search).get(k);

  // A host that created its own room has no ?room= — the code arrived over the
  // socket instead, so fall back to the most recent one seen on the wire.
  function roomCode() {
    if (qs('room')) return qs('room');
    for (let i = events.length - 1; i >= 0; i--) {
      const m = JSON.stringify(events[i].args || '').match(/roomCode.{2,4}([A-Z0-9]{4})/);
      if (m) return m[1];
    }
    return null;
  }

  function capture(note) {
    const active = document.querySelector('.screen.active');
    const text = (active?.innerText || '').replace(/\s+/g, ' ').trim();
    const html = active?.outerHTML || '';
    return {
      note,
      url: location.pathname + location.search,
      title: document.title,
      screen: active?.id || null,
      room: roomCode(),
      tournament: qs('t'),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      visibleText: text.length > 1500 ? text.slice(0, 1500) + '…' : text,
      html: html.length > 6000 ? html.slice(0, 6000) + '\n<!-- …truncated -->' : html,
      recentEvents: events.slice()
    };
  }

  // ---- overlay --------------------------------------------------------------
  const css = `
  .__dev-pill{position:fixed;bottom:10px;right:10px;z-index:2147483647;background:#111;color:#fff;
    border:1px solid #444;border-radius:999px;padding:7px 12px;font:600 13px/1 system-ui,sans-serif;
    cursor:pointer;opacity:.45;transition:opacity .15s}
  .__dev-pill:hover{opacity:1}
  .__dev-panel{position:fixed;bottom:52px;right:10px;z-index:2147483647;width:min(320px,calc(100vw - 20px));
    background:#151515;color:#eee;border:1px solid #444;border-radius:10px;padding:10px;
    font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.5);display:none}
  .__dev-panel.open{display:block}
  .__dev-panel textarea{width:100%;box-sizing:border-box;height:74px;background:#0b0b0b;color:#eee;
    border:1px solid #444;border-radius:6px;padding:7px;font:13px/1.4 system-ui,sans-serif;resize:vertical}
  .__dev-meta{opacity:.55;font-size:11px;margin:6px 0}
  .__dev-save{width:100%;margin-top:6px;background:#2d6cdf;color:#fff;border:0;border-radius:6px;
    padding:8px;font:600 13px system-ui,sans-serif;cursor:pointer}
  .__dev-save:active{transform:translateY(1px)}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const pill = document.createElement('button');
  pill.className = '__dev-pill';
  pill.textContent = '📌 Note';

  const panel = document.createElement('div');
  panel.className = '__dev-panel';
  panel.innerHTML = `
    <textarea placeholder="What do you want changed here?"></textarea>
    <div class="__dev-meta"></div>
    <button class="__dev-save">Pin this moment</button>`;

  const ta = panel.querySelector('textarea');
  const meta = panel.querySelector('.__dev-meta');
  const save = panel.querySelector('.__dev-save');

  function refreshMeta() {
    const c = capture('');
    meta.textContent = `${c.screen || 'no screen'} · ${c.room ? 'room ' + c.room : 'no room'} · ${events.length} events captured`;
  }
  function toggle(open) {
    const show = open ?? !panel.classList.contains('open');
    panel.classList.toggle('open', show);
    if (show) { refreshMeta(); ta.focus(); }
  }
  pill.addEventListener('click', () => toggle());
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle(); }
    if (e.key === 'Escape') toggle(false);
  });

  async function send() {
    const note = ta.value.trim();
    if (!note) { ta.focus(); return; }
    save.disabled = true; save.textContent = 'Pinning…';
    try {
      const res = await fetch('/__dev/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(capture(note))
      });
      const j = await res.json();
      ta.value = '';
      toggle(false);
      pill.textContent = `✓ pinned #${j.count}`;
      setTimeout(() => { pill.textContent = '📌 Note'; }, 1800);
    } catch (e) {
      save.textContent = 'Failed — retry';
    } finally {
      save.disabled = false;
      if (save.textContent === 'Pinning…') save.textContent = 'Pin this moment';
    }
  }
  save.addEventListener('click', send);
  ta.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(); });

  const mount = () => { document.body.appendChild(pill); document.body.appendChild(panel); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
