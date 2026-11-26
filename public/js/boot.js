// ── Display controls (readability + light/dark + themes) ───────
// The app is dark-first and its vivid palette blooms on a mini-LED TV, and the
// UI can be small / narrow / heavy on a big screen. These controls — a
// light/dark toggle with five accessible LIGHT colour themes, manual saturation
// + brightness, a text-size scale (bigger TEXT, not a geometric zoom — scales
// rem type so the layout reflows), a text-weight control (the bold display font
// reads heavy when big), a "fill the screen" toggle and a Full-screen button —
// are saved per device and applied to <html> before paint. Light mode is a root
// invert + hue-rotate (works across every game, preserves the dark theme's
// contrast ratios); the themes are warmth/hue variations layered on it, with a
// cream (easiest on tired eyes) and a high-contrast mono as the accessibility
// standouts. <img> (QR codes) are flipped back in style.css. The control shows
// on host / TV / hub pages, not player phones (a buzz tap could hit it).
(function () {
  var ls = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var num = function (k, d) { var n = parseFloat(ls.get(k, String(d))); return isNaN(n) ? d : n; };
  var TEXT = [100, 115, 130, 150, 170, 190];
  var WEIGHTS = [['light', 'Light'], ['medium', 'Medium'], ['bold', 'Bold']];
  // Light-mode colour themes (layered on the root invert). sw = approx swatch.
  var LIGHT_THEMES = [
    { name: 'Paper', hue: 0,   extra: '',                              sw: '#edeff3' },
    { name: 'Cream', hue: 12,  extra: 'sepia(0.35) ',                  sw: '#f2e7d2' },
    { name: 'Slate', hue: 38,  extra: '',                              sw: '#d8e2ef' },
    { name: 'Ocean', hue: -26, extra: '',                              sw: '#d4ece7' },
    { name: 'Mono',  hue: 0,   extra: 'saturate(0.12) contrast(1.07) ', sw: '#e7e7e7' }
  ];

  function apply() {
    var html = document.documentElement;
    var light = ls.get('gn-light', '0') === '1';
    var sat = num('gn-sat', 70), bright = num('gn-bright', 92), text = num('gn-text', 100);
    var fill = ls.get('gn-fill', '1') === '1';
    var weight = ls.get('gn-weight', 'bold');
    var lt = LIGHT_THEMES[parseInt(ls.get('gn-lt', '0'), 10)] || LIGHT_THEMES[0];
    html.style.filter = (light ? 'invert(1) hue-rotate(' + (180 + lt.hue) + 'deg) ' + lt.extra : '') +
                        'saturate(' + (sat / 100) + ') brightness(' + (bright / 100) + ')';
    html.style.fontSize = (16 * text / 100).toFixed(2) + 'px';   // scales rem-based text
    html.setAttribute('data-gn-fill', fill ? '1' : '0');
    html.setAttribute('data-gn-light', light ? '1' : '0');
    html.setAttribute('data-gn-weight', weight);
  }
  apply();   // runs in <head>, before the body paints

  function buildControl() {
    if (document.getElementById('gn-display-ctl')) return;
    // Panel chrome uses fixed px (never the app's scalable rem) so the control
    // stays a comfortable, stable size even when the app text is cranked to 190%.
    var lbl = 'font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.5)';
    var valS = 'float:right;font-weight:800;font-size:12px;color:rgba(255,255,255,0.85)';
    var sec = 'padding:14px 16px;border-top:1px solid rgba(255,255,255,0.07)';
    var rng = 'width:100%;accent-color:#5AC8FA;margin:10px 0 2px';
    var modeBtn = 'flex:1;padding:11px 8px;border-radius:10px;border:1.5px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:#fff;font-weight:700;font-size:13px;cursor:pointer';
    var sBtn = 'width:38px;height:34px;border:none;border-radius:9px;background:rgba(255,255,255,0.1);color:#fff;font-weight:800;font-size:15px;cursor:pointer';
    var wrap = document.createElement('div');
    wrap.id = 'gn-display-ctl';
    wrap.style.cssText = 'position:fixed;top:10px;right:10px;z-index:3000;font-family:Nunito,system-ui,sans-serif';
    wrap.innerHTML =
      '<button type="button" id="gn-ctl-btn" aria-label="Display settings" style="width:42px;height:42px;border:none;border-radius:12px;background:rgba(20,20,34,0.78);color:#fff;font-size:20px;line-height:1;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.45)">🎨</button>' +
      '<div id="gn-ctl-panel" style="display:none;margin-top:8px;width:272px;max-height:calc(100vh - 78px);overflow-y:auto;background:rgba(16,16,28,0.985);border:1px solid rgba(255,255,255,0.13);border-radius:16px;box-shadow:0 18px 40px rgba(0,0,0,0.6);font-size:14px;line-height:1.3">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px 12px">' +
          '<span style="font-size:15px;font-weight:800;color:#fff">Display</span>' +
          '<button type="button" id="gn-ctl-close" aria-label="Close" style="width:26px;height:26px;border:none;border-radius:8px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7);font-size:13px;cursor:pointer;line-height:1">✕</button>' +
        '</div>' +
        '<div style="' + sec + '">' +
          '<div style="' + lbl + ';margin-bottom:9px">Appearance</div>' +
          '<div style="display:flex;gap:8px"><button type="button" id="gn-dark" style="' + modeBtn + '">🌙 Dark</button><button type="button" id="gn-light-btn" style="' + modeBtn + '">☀️ Light</button></div>' +
          '<div id="gn-lt-row" style="display:none;gap:7px;margin-top:9px"></div>' +
        '</div>' +
        '<div style="' + sec + '">' +
          '<div style="' + lbl + '">Colour <span id="gn-sat-v" style="' + valS + '"></span></div>' +
          '<input type="range" id="gn-sat" min="0" max="100" style="' + rng + '">' +
          '<div style="' + lbl + ';margin-top:13px">Brightness <span id="gn-bright-v" style="' + valS + '"></span></div>' +
          '<input type="range" id="gn-bright" min="55" max="105" style="' + rng + '">' +
        '</div>' +
        '<div style="' + sec + '">' +
          '<div style="display:flex;align-items:center;justify-content:space-between"><span style="' + lbl + '">Text size</span><span style="display:flex;gap:8px;align-items:center"><button type="button" id="gn-td" style="' + sBtn + '">A−</button><span id="gn-text-v" style="min-width:48px;text-align:center;font-weight:800;font-size:13px;color:#fff"></span><button type="button" id="gn-tu" style="' + sBtn + '">A+</button></span></div>' +
          '<div style="' + lbl + ';margin:14px 0 7px">Text weight</div>' +
          '<div id="gn-weight-row" style="display:flex;gap:7px"></div>' +
        '</div>' +
        '<div style="' + sec + '">' +
          '<label style="display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;font-size:13px;font-weight:700;color:#fff"><span>Fill the screen</span><input type="checkbox" id="gn-fill" style="width:21px;height:21px;accent-color:#34C759;cursor:pointer"></label>' +
          '<button type="button" id="gn-fs" style="width:100%;margin-top:11px;padding:10px;border:none;border-radius:10px;background:rgba(255,255,255,0.1);color:#fff;font-weight:700;font-size:13px;cursor:pointer">⛶ Full screen</button>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(wrap);

    var panel = document.getElementById('gn-ctl-panel');
    var btn = document.getElementById('gn-ctl-btn');
    ['click', 'pointerdown', 'mousedown', 'touchstart'].forEach(function (ev) { wrap.addEventListener(ev, function (e) { e.stopPropagation(); }, ev === 'touchstart' ? { passive: true } : false); });
    btn.addEventListener('click', function () { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
    document.getElementById('gn-ctl-close').addEventListener('click', function () { panel.style.display = 'none'; });
    document.addEventListener('click', function () { panel.style.display = 'none'; });

    var sat = document.getElementById('gn-sat'), bright = document.getElementById('gn-bright');
    function paintMode() {
      var light = ls.get('gn-light', '0') === '1';
      var on = function (el, is) { el.style.borderColor = is ? '#5AC8FA' : 'rgba(255,255,255,0.14)'; el.style.background = is ? 'rgba(90,200,250,0.18)' : 'rgba(255,255,255,0.05)'; };
      on(document.getElementById('gn-light-btn'), light);
      on(document.getElementById('gn-dark'), !light);
      document.getElementById('gn-lt-row').style.display = light ? 'flex' : 'none';   // themes are a light-mode thing
    }
    function renderThemes() {
      var row = document.getElementById('gn-lt-row'); row.innerHTML = ''; row.style.flexWrap = 'wrap';
      var cur = parseInt(ls.get('gn-lt', '0'), 10);
      LIGHT_THEMES.forEach(function (th, i) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = th.name;
        var o = i === cur;
        b.style.cssText = 'flex:1 0 29%;padding:8px 4px;border-radius:8px;cursor:pointer;color:#fff;font-size:12px;font-weight:700;white-space:nowrap;border:1.5px solid ' + (o ? '#5AC8FA' : 'rgba(255,255,255,0.14)') + ';background:' + (o ? 'rgba(90,200,250,0.18)' : 'rgba(255,255,255,0.05)');
        b.addEventListener('click', function () { ls.set('gn-lt', String(i)); apply(); renderThemes(); });
        row.appendChild(b);
      });
    }
    function renderWeight() {
      var row = document.getElementById('gn-weight-row'); row.innerHTML = '';
      var cur = ls.get('gn-weight', 'bold');
      WEIGHTS.forEach(function (w) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = w[1];
        var o = cur === w[0];
        b.style.cssText = 'flex:1;padding:9px 4px;border-radius:9px;border:1.5px solid ' + (o ? '#5AC8FA' : 'rgba(255,255,255,0.14)') + ';background:' + (o ? 'rgba(90,200,250,0.18)' : 'rgba(255,255,255,0.05)') + ';color:#fff;font-size:12px;cursor:pointer;font-weight:' + (w[0] === 'light' ? '400' : w[0] === 'medium' ? '600' : '800');
        b.addEventListener('click', function () { ls.set('gn-weight', w[0]); apply(); renderWeight(); });
        row.appendChild(b);
      });
    }
    function sync() {
      sat.value = num('gn-sat', 70); document.getElementById('gn-sat-v').textContent = sat.value + '%';
      bright.value = num('gn-bright', 92); document.getElementById('gn-bright-v').textContent = bright.value + '%';
      document.getElementById('gn-text-v').textContent = num('gn-text', 100) + '%';
      document.getElementById('gn-fill').checked = ls.get('gn-fill', '1') === '1';
      paintMode(); renderThemes(); renderWeight();
    }
    document.getElementById('gn-dark').addEventListener('click', function () { ls.set('gn-light', '0'); apply(); paintMode(); });
    document.getElementById('gn-light-btn').addEventListener('click', function () { ls.set('gn-light', '1'); apply(); paintMode(); });
    sat.addEventListener('input', function () { ls.set('gn-sat', sat.value); document.getElementById('gn-sat-v').textContent = sat.value + '%'; apply(); });
    bright.addEventListener('input', function () { ls.set('gn-bright', bright.value); document.getElementById('gn-bright-v').textContent = bright.value + '%'; apply(); });
    document.getElementById('gn-fill').addEventListener('change', function (e) { ls.set('gn-fill', e.target.checked ? '1' : '0'); apply(); });
    function step(d) { var c = num('gn-text', 100), i = TEXT.indexOf(c); if (i < 0) i = 0; i = Math.max(0, Math.min(TEXT.length - 1, i + d)); ls.set('gn-text', String(TEXT[i])); document.getElementById('gn-text-v').textContent = TEXT[i] + '%'; apply(); }
    document.getElementById('gn-td').addEventListener('click', function () { step(-1); });
    document.getElementById('gn-tu').addEventListener('click', function () { step(1); });
    // Full screen (the host shares a desktop; Esc exits — the browser's own behaviour).
    var fsBtn = document.getElementById('gn-fs');
    function fsLabel() { fsBtn.textContent = document.fullscreenElement ? '⛶ Exit full screen' : '⛶ Full screen'; }
    fsBtn.addEventListener('click', function () {
      if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen(); }
      else { var el = document.documentElement, rf = el.requestFullscreen || el.webkitRequestFullscreen; if (rf) { try { rf.call(el); } catch (e) {} } }
    });
    document.addEventListener('fullscreenchange', fsLabel);
    fsLabel();
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
