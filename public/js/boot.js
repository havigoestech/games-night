// ── Display controls (readability + light/dark) ────────────────
// The app is dark-first and its vivid palette blooms on a mini-LED TV, and the
// UI can be small / narrow on a big screen. These controls — a light/dark
// toggle, manual saturation + brightness (calm the glare yourself), a text-size
// scale (bigger TEXT, not a geometric zoom: it scales rem-based type so the
// layout reflows instead of just magnifying) and a "fill the screen" toggle (use
// the full width instead of a centred column) — are saved per device and applied
// to <html> before paint. Light mode is a root invert+hue-rotate so it works
// across every game without per-screen surgery; <img> (QR codes) are flipped
// back in style.css. The floating control shows on host / TV / hub pages, not on
// player phones (where "tap anywhere to buzz" could hit it).
(function () {
  var ls = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var num = function (k, d) { var n = parseFloat(ls.get(k, String(d))); return isNaN(n) ? d : n; };
  var TEXT = [100, 115, 130, 150, 170, 190];

  function apply() {
    var html = document.documentElement;
    var light = ls.get('gn-light', '0') === '1';
    var sat = num('gn-sat', 70), bright = num('gn-bright', 92), text = num('gn-text', 100);
    var fill = ls.get('gn-fill', '1') === '1';
    html.style.filter = (light ? 'invert(1) hue-rotate(180deg) ' : '') + 'saturate(' + (sat / 100) + ') brightness(' + (bright / 100) + ')';
    html.style.fontSize = (16 * text / 100).toFixed(2) + 'px';   // scales all rem-based text
    html.setAttribute('data-gn-fill', fill ? '1' : '0');
    html.setAttribute('data-gn-light', light ? '1' : '0');
  }
  apply();   // runs in <head>, before the body paints

  function buildControl() {
    if (document.getElementById('gn-display-ctl')) return;
    var lbl = 'font-size:0.7rem;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:rgba(255,255,255,0.55)';
    var rng = 'width:100%;accent-color:#5AC8FA;margin:3px 0 11px';
    var modeBtn = 'flex:1;padding:8px;border-radius:8px;border:1.5px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:#fff;font-weight:700;font-size:0.85rem;cursor:pointer';
    var sBtn = 'width:34px;height:30px;border:none;border-radius:8px;background:rgba(255,255,255,0.1);color:#fff;font-weight:800;cursor:pointer';
    var wrap = document.createElement('div');
    wrap.id = 'gn-display-ctl';
    wrap.style.cssText = 'position:fixed;top:8px;right:8px;z-index:3000;font-family:Nunito,system-ui,sans-serif';
    wrap.innerHTML =
      '<button type="button" id="gn-ctl-btn" aria-label="Display settings" style="width:40px;height:40px;border:none;border-radius:11px;background:rgba(20,20,34,0.72);color:#fff;font-size:19px;line-height:1;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.4)">🎨</button>' +
      '<div id="gn-ctl-panel" style="display:none;margin-top:6px;width:236px;background:rgba(14,14,24,0.98);border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:13px;box-shadow:0 14px 34px rgba(0,0,0,0.55)">' +
        '<div style="' + lbl + ';margin-bottom:7px">Appearance</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:12px"><button type="button" id="gn-dark" style="' + modeBtn + '">🌙 Dark</button><button type="button" id="gn-light-btn" style="' + modeBtn + '">☀️ Light</button></div>' +
        '<div style="' + lbl + '">Colour <span id="gn-sat-v" style="float:right;color:rgba(255,255,255,0.8)"></span></div>' +
        '<input type="range" id="gn-sat" min="0" max="100" style="' + rng + '">' +
        '<div style="' + lbl + '">Brightness <span id="gn-bright-v" style="float:right;color:rgba(255,255,255,0.8)"></span></div>' +
        '<input type="range" id="gn-bright" min="55" max="105" style="' + rng + '">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:11px"><span style="' + lbl + '">Text size</span><span style="display:flex;gap:6px"><button type="button" id="gn-td" style="' + sBtn + '">A−</button><span id="gn-text-v" style="min-width:44px;text-align:center;align-self:center;font-weight:800;font-size:0.82rem;color:#fff"></span><button type="button" id="gn-tu" style="' + sBtn + '">A+</button></span></div>' +
        '<label style="display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;font-size:0.9rem;font-weight:700;color:#fff"><span>Fill the screen</span><input type="checkbox" id="gn-fill" style="width:20px;height:20px;accent-color:#34C759;cursor:pointer"></label>' +
      '</div>';
    (document.body || document.documentElement).appendChild(wrap);

    var panel = document.getElementById('gn-ctl-panel');
    var btn = document.getElementById('gn-ctl-btn');
    ['click', 'pointerdown', 'mousedown', 'touchstart'].forEach(function (ev) { wrap.addEventListener(ev, function (e) { e.stopPropagation(); }, ev === 'touchstart' ? { passive: true } : false); });
    btn.addEventListener('click', function () { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
    document.addEventListener('click', function () { panel.style.display = 'none'; });

    var sat = document.getElementById('gn-sat'), bright = document.getElementById('gn-bright');
    function paintMode() {
      var light = ls.get('gn-light', '0') === '1';
      var on = function (el, is) { el.style.borderColor = is ? '#5AC8FA' : 'rgba(255,255,255,0.14)'; el.style.background = is ? 'rgba(90,200,250,0.18)' : 'rgba(255,255,255,0.05)'; };
      on(document.getElementById('gn-light-btn'), light);
      on(document.getElementById('gn-dark'), !light);
    }
    function sync() {
      sat.value = num('gn-sat', 70); document.getElementById('gn-sat-v').textContent = sat.value + '%';
      bright.value = num('gn-bright', 92); document.getElementById('gn-bright-v').textContent = bright.value + '%';
      document.getElementById('gn-text-v').textContent = num('gn-text', 100) + '%';
      document.getElementById('gn-fill').checked = ls.get('gn-fill', '1') === '1';
      paintMode();
    }
    document.getElementById('gn-dark').addEventListener('click', function () { ls.set('gn-light', '0'); apply(); paintMode(); });
    document.getElementById('gn-light-btn').addEventListener('click', function () { ls.set('gn-light', '1'); apply(); paintMode(); });
    sat.addEventListener('input', function () { ls.set('gn-sat', sat.value); document.getElementById('gn-sat-v').textContent = sat.value + '%'; apply(); });
    bright.addEventListener('input', function () { ls.set('gn-bright', bright.value); document.getElementById('gn-bright-v').textContent = bright.value + '%'; apply(); });
    document.getElementById('gn-fill').addEventListener('change', function (e) { ls.set('gn-fill', e.target.checked ? '1' : '0'); apply(); });
    function step(d) { var c = num('gn-text', 100), i = TEXT.indexOf(c); if (i < 0) i = 0; i = Math.max(0, Math.min(TEXT.length - 1, i + d)); ls.set('gn-text', String(TEXT[i])); document.getElementById('gn-text-v').textContent = TEXT[i] + '%'; apply(); }
    document.getElementById('gn-td').addEventListener('click', function () { step(-1); });
    document.getElementById('gn-tu').addEventListener('click', function () { step(1); });
    sync();
  }
  if (!/\/player\.html$/.test(location.pathname)) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildControl);
    else buildControl();
  }
})();

// Stops the wrong screen painting for a few frames.
//
// Every page ships with its setup/join screen pre-marked `.active`. That's right
// for a normal visit, but wrong when we're attaching to a room that already
// exists — a game launched inside a tournament (?t=), or resuming the tournament
// host (?room=). There the default screen paints immediately, then gets swapped
// the moment the server's state lands ~milliseconds later. It reads as a glitch.
//
// This runs in <head>, before the body can paint: it veils the screens, then
// lifts the veil the instant the page activates the screen it actually wants.
// Under ~450ms nothing is visible at all (see .attaching in style.css), so the
// veil itself never becomes a new flash.
(function () {
  var params = new URLSearchParams(location.search);
  var isTournamentPage = /\/games\/tournament\//.test(location.pathname);

  // A game page carrying ?t= is inside a tournament: it auto-attaches and never
  // shows its own setup/join screen. The tournament's own pages always ask the
  // server which phase to show before deciding, so they veil whenever pointed at
  // a room — including a first-time joiner, who just resolves to the join screen
  // one round-trip later.
  var attaching = isTournamentPage ? params.has('room') : params.has('t');
  if (!attaching) return;

  var html = document.documentElement;
  html.classList.add('attaching');

  var done = false;
  function reveal() {
    if (done) return;
    done = true;
    html.classList.remove('attaching');
  }

  // showScreen() is the only thing that touches a .screen's class list, so the
  // first such mutation means the page has chosen — whatever it chose.
  document.addEventListener('DOMContentLoaded', function () {
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var t = records[i].target;
        if (t.classList && t.classList.contains('screen')) {
          mo.disconnect();
          reveal();
          return;
        }
      }
    });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });

  // Never strand anyone behind the veil: if state never lands, fall back to the
  // old behaviour rather than showing an indefinitely blank page.
  setTimeout(reveal, 5000);
})();
