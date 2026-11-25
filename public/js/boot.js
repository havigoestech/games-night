// ── Theme + display size (TV-friendly colours + zoom) ──────────
// The vivid neon palette blooms on a mini-LED TV and the UI can be small on a
// big screen. This calms the colours and lets anyone enlarge everything. The
// choice is saved per device and applied to <html> before paint (so there's no
// flash); a small floating control (top-right) switches theme + size live.
(function () {
  var THEMES = {
    tv:       { label: '📺 TV · Calm', filter: 'saturate(0.8) brightness(0.92)',             bg: '#101019' },
    classic:  { label: '✨ Classic',   filter: '',                                           bg: '#0a0a18' },
    warm:     { label: '🔥 Warm',      filter: 'sepia(0.22) saturate(0.92) brightness(0.93)', bg: '#15110f' },
    midnight: { label: '🌙 Midnight',  filter: 'saturate(0.72) brightness(0.8)',             bg: '#06060e' }
  };
  var ORDER = ['tv', 'classic', 'warm', 'midnight'];
  var ZOOMS = [1, 1.15, 1.3, 1.5];
  var ls = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  function curTheme() { var t = ls.get('gn-theme', 'tv'); return THEMES[t] ? t : 'tv'; }
  function curZoom()  { var z = parseFloat(ls.get('gn-zoom', '1')); return ZOOMS.indexOf(z) >= 0 ? z : 1; }

  function apply() {
    var html = document.documentElement, t = THEMES[curTheme()], z = curZoom();
    html.style.filter = t.filter || '';            // recolours the whole document
    html.style.zoom = String(z);                   // scales everything
    html.style.setProperty('--gn-zoom', String(z)); // so .screen can keep one viewport tall
    html.style.setProperty('--bg', t.bg);
    html.setAttribute('data-gn-theme', curTheme());
  }
  apply();   // runs in <head>, before the body paints

  function buildControl() {
    if (document.getElementById('gn-display-ctl')) return;
    var wrap = document.createElement('div');
    wrap.id = 'gn-display-ctl';
    wrap.style.cssText = 'position:fixed;top:8px;right:8px;z-index:3000;font-family:Nunito,system-ui,sans-serif';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Display settings');
    btn.textContent = '🎨';
    btn.style.cssText = 'width:38px;height:38px;border:none;border-radius:11px;background:rgba(20,20,34,0.7);color:#fff;font-size:18px;line-height:1;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.35)';
    var panel = document.createElement('div');
    panel.style.cssText = 'display:none;margin-top:6px;width:214px;background:rgba(16,16,28,0.97);border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:12px;box-shadow:0 12px 32px rgba(0,0,0,0.5)';
    panel.innerHTML =
      '<div style="font-size:0.64rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-bottom:7px">Theme</div>' +
      '<div id="gn-theme-row" style="display:grid;grid-template-columns:1fr 1fr;gap:6px"></div>' +
      '<div style="font-size:0.64rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);margin:11px 0 7px">Text size</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<button type="button" id="gn-zoom-down" style="flex:1;padding:9px;border:none;border-radius:9px;background:rgba(255,255,255,0.1);color:#fff;font-size:1.1rem;font-weight:800;cursor:pointer">A−</button>' +
        '<div id="gn-zoom-label" style="min-width:52px;text-align:center;font-weight:800;font-size:0.9rem;color:#fff">100%</div>' +
        '<button type="button" id="gn-zoom-up" style="flex:1;padding:9px;border:none;border-radius:9px;background:rgba(255,255,255,0.1);color:#fff;font-size:1.1rem;font-weight:800;cursor:pointer">A+</button>' +
      '</div>';
    wrap.appendChild(btn); wrap.appendChild(panel);

    // Keep taps on the control from reaching the game (e.g. the full-screen buzzer).
    ['click', 'pointerdown', 'mousedown', 'touchstart'].forEach(function (ev) {
      wrap.addEventListener(ev, function (e) { e.stopPropagation(); }, ev === 'touchstart' ? { passive: true } : false);
    });
    btn.addEventListener('click', function () { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
    document.addEventListener('click', function () { panel.style.display = 'none'; });

    function renderThemes() {
      var row = panel.querySelector('#gn-theme-row'); row.innerHTML = '';
      ORDER.forEach(function (key) {
        var b = document.createElement('button'); b.type = 'button';
        var on = curTheme() === key;
        b.textContent = THEMES[key].label;
        b.style.cssText = 'padding:9px 6px;border-radius:9px;border:1.5px solid ' + (on ? '#5AC8FA' : 'rgba(255,255,255,0.12)') + ';background:' + (on ? 'rgba(90,200,250,0.18)' : 'rgba(255,255,255,0.05)') + ';color:#fff;font-size:0.76rem;font-weight:700;cursor:pointer;white-space:nowrap';
        b.addEventListener('click', function () { ls.set('gn-theme', key); apply(); renderThemes(); });
        row.appendChild(b);
      });
    }
    function renderZoom() { panel.querySelector('#gn-zoom-label').textContent = Math.round(curZoom() * 100) + '%'; }
    panel.querySelector('#gn-zoom-down').addEventListener('click', function () { var i = ZOOMS.indexOf(curZoom()); if (i > 0) { ls.set('gn-zoom', String(ZOOMS[i - 1])); apply(); renderZoom(); } });
    panel.querySelector('#gn-zoom-up').addEventListener('click', function () { var i = ZOOMS.indexOf(curZoom()); if (i < ZOOMS.length - 1) { ls.set('gn-zoom', String(ZOOMS[i + 1])); apply(); renderZoom(); } });

    (document.body || document.documentElement).appendChild(wrap);
    renderThemes(); renderZoom();
  }
  // Players tap "anywhere" to buzz, so keep the control off their phones (it
  // could swallow a buzz). It lives on the host / TV board — the screen that
  // actually needs calming and enlarging. Saved theme/size still apply to all.
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
