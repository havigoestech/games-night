const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Register each game as a Socket.IO namespace
require('./games/grab-the-mic/game.js')(io.of('/grab-the-mic'), LOCAL_IP, PORT);

server.listen(PORT, () => {
  console.log('Games Night hub running at:');
  console.log(`  This device:   http://localhost:${PORT}`);
  console.log(`  Other devices: http://${LOCAL_IP}:${PORT}`);
});
