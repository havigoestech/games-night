// In-process bridge between the tournament and the games.
//
// All game modules and the tournament run in the same Node process but in
// separate Socket.IO namespaces with their own private `rooms` Maps. A game
// can't be created from outside its own socket handlers — so each game
// registers a `launch` function here (from inside its module closure, where it
// has `namespace`, `rooms`, etc.), and the tournament calls it to spin up a
// room pre-seeded with the roster and a completion callback.

const launchers = {};   // slug -> launch({ roster, teams, mode, config, length, onComplete }) -> { roomCode }

module.exports = {
  register(slug, launchFn) { launchers[slug] = launchFn; },
  isRegistered(slug) { return typeof launchers[slug] === 'function'; },
  registered() { return Object.keys(launchers); },
  launch(slug, opts) {
    const fn = launchers[slug];
    if (!fn) return null;
    return fn(opts);
  }
};
