// Shared pause overlay + host button. Each game calls GNPause.init(socket) once,
// right after it creates its socket. The host page (…/host.html) gets a floating
// ⏸ button that emits `toggle-pause`; every page (host, TV board, player phones)
// shows a full-screen "Paused" veil while the game is frozen, driven by the
// server's game-paused / game-resumed broadcasts. The veil also blocks input, so
// nobody can tap through it while paused.
(function () {
  var socket = null, paused = false;
  // Only the host page gets the pause control; boards/phones only show the veil.
  var canPause = /host\.html$/.test(location.pathname);
  var overlay = null, btn = null;

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'gn-pause-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:4000;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(6,6,14,0.84);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);font-family:Fredoka,Nunito,system-ui,sans-serif;color:#fff;text-align:center;padding:24px';
    overlay.innerHTML =
      '<div style="font-size:64px;line-height:1">⏸</div>' +
      '<div style="font-size:34px;font-weight:700">Paused</div>' +
      '<div id="gn-pause-sub" style="font-size:16px;color:rgba(255,255,255,0.65);font-weight:600;max-width:320px"></div>' +
      (canPause ? '<button id="gn-pause-resume" type="button" style="margin-top:12px;border:none;border-radius:14px;padding:14px 34px;background:#34C759;color:#fff;font-family:inherit;font-weight:700;font-size:18px;cursor:pointer">▶ Resume</button>' : '');
    (document.body || document.documentElement).appendChild(overlay);
    var sub = document.getElementById('gn-pause-sub');
    if (sub) sub.textContent = canPause ? 'The game is on hold. Tap resume when you\'re ready.' : 'The host paused the game.';
    var r = document.getElementById('gn-pause-resume');
    if (r) r.addEventListener('click', function () { if (socket) socket.emit('toggle-pause'); });
  }

  function buildButton() {
    if (btn || !canPause) return;
    btn = document.createElement('button');
    btn.id = 'gn-pause-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Pause game');
    btn.style.cssText = 'position:fixed;top:10px;left:10px;z-index:3000;height:42px;padding:0 14px;border:none;border-radius:12px;background:rgba(20,20,34,0.78);color:#fff;font-size:15px;font-weight:700;line-height:1;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.45);font-family:Nunito,system-ui,sans-serif';
    btn.textContent = '⏸ Pause';
    btn.addEventListener('click', function () { if (socket) socket.emit('toggle-pause'); });
    (document.body || document.documentElement).appendChild(btn);
  }

  function setPaused(p) {
    paused = !!p;
    buildOverlay();
    overlay.style.display = paused ? 'flex' : 'none';
    if (btn) btn.textContent = paused ? '▶ Resume' : '⏸ Pause';
  }

  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }

  window.GNPause = {
    init: function (s) {
      socket = s || socket;
      ready(buildButton);
      if (!s) return;
      s.on('game-paused', function () { setPaused(true); });
      s.on('game-resumed', function () { setPaused(false); });
      s.on('game-over', function () { setPaused(false); });       // never strand the veil
      s.on('host-disconnected', function () { setPaused(false); });
    },
    setPaused: setPaused
  };
})();
