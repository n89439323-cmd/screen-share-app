const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create a new room → redirect host to viewer page
app.get('/create', (req, res) => {
  const roomId = crypto.randomBytes(4).toString('hex');
  res.redirect(`/host/${roomId}`);
});

// HOST page (you - the viewer who receives the stream)
app.get('/host/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

// GUEST page (the person who shares their screen - auto-triggered)
app.get('/join/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'guest.html'));
});

// Track rooms
const rooms = {};

io.on('connection', (socket) => {
  console.log(`✅ Connecté: ${socket.id}`);

  socket.on('join-room', ({ roomId, role }) => {
    socket.join(roomId);
    socket.data.role = role;
    socket.data.roomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = { host: null, guests: [] };
    }

    if (role === 'host') {
      rooms[roomId].host = socket.id;
      console.log(`🏠 HÔTE ${socket.id} dans room ${roomId}`);

      // Notify any guests already waiting that the host arrived
      if (rooms[roomId].guests.length > 0) {
        rooms[roomId].guests.forEach(guestId => {
          io.to(guestId).emit('host-joined', socket.id);
        });
      }
    } else {
      rooms[roomId].guests.push(socket.id);
      console.log(`👤 INVITÉ ${socket.id} dans room ${roomId}`);

      // Notify host that a guest joined
      if (rooms[roomId].host) {
        io.to(rooms[roomId].host).emit('guest-joined', socket.id);
      }

      // Tell the guest who the host is so they can connect
      socket.emit('host-info', { hostId: rooms[roomId].host });
    }
  });

  // WebRTC Signaling
  socket.on('offer', ({ offer, to }) => {
    console.log(`📡 Offre: ${socket.id} → ${to}`);
    socket.to(to).emit('offer', { offer, from: socket.id });
  });

  socket.on('answer', ({ answer, to }) => {
    console.log(`📡 Réponse: ${socket.id} → ${to}`);
    socket.to(to).emit('answer', { answer, from: socket.id });
  });

  socket.on('ice-candidate', ({ candidate, to }) => {
    socket.to(to).emit('ice-candidate', { candidate, from: socket.id });
  });

  socket.on('sharing-stopped', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId] && rooms[roomId].host) {
      io.to(rooms[roomId].host).emit('sharing-stopped', socket.id);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Déconnecté: ${socket.id}`);
    for (const roomId in rooms) {
      if (rooms[roomId].host === socket.id) {
        rooms[roomId].host = null;
      }
      const gIdx = rooms[roomId].guests.indexOf(socket.id);
      if (gIdx !== -1) {
        rooms[roomId].guests.splice(gIdx, 1);
        // Notify host
        if (rooms[roomId].host) {
          io.to(rooms[roomId].host).emit('guest-left', socket.id);
        }
      }
      // Cleanup
      if (!rooms[roomId].host && rooms[roomId].guests.length === 0) {
        delete rooms[roomId];
        console.log(`🗑️ Room ${roomId} supprimée`);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        🖥️  SCREEN SHARE APP - ACTIF                 ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  📍 Local:  http://localhost:${PORT}                   ║`);
  console.log('║                                                      ║');
  console.log('║  📋 Pour partager sur internet (accès distance):     ║');
  console.log('║     1. Installez ngrok: npm install -g ngrok         ║');
  console.log('║     2. Lancez: ngrok http 3000                       ║');
  console.log('║     3. Partagez le lien /join/ROOMID à la cible      ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});
