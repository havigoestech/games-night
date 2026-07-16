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
