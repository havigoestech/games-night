// Shared pause / resume for every game.
//
// The host toggles pause; the server flips `room.paused` and broadcasts
// `game-paused` / `game-resumed` to the room. Each game's timer loop begins with
// `if (room.paused) return;`, so while paused the interval keeps firing but does
// nothing — the clock freezes in place and resumes from exactly where it left
// off (no recreated intervals, no drift). The client overlay (public/js/
// pause-ui.js) covers the screen so nobody can act while paused.
//
// Usage: call `require('../shared/pause.js')(namespace, rooms);` inside a game's
// register function. It adds its own connection listener (Socket.IO allows many)
// and keys off the same `socket.isHost` / `socket.roomCode` every game already
// sets, so it needs no per-game glue beyond the timer guards.
module.exports = function attachPause(namespace, rooms) {
  namespace.on('connection', (socket) => {
    function toggle(want) {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      const next = typeof want === 'boolean' ? want : !room.paused;
      if (!!room.paused === next) return;
      room.paused = next;
      namespace.to(room.roomCode).emit(next ? 'game-paused' : 'game-resumed', {});
    }
    socket.on('toggle-pause', () => toggle());
    socket.on('pause', () => toggle(true));
    socket.on('resume', () => toggle(false));
    // A client that reconnects mid-pause asks for a sync; re-assert the overlay.
    socket.on('request-sync', () => {
      const room = rooms.get(socket.roomCode);
      if (room && room.paused) socket.emit('game-paused', {});
    });
  });
};
