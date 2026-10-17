const express = require('express');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ROOMS = ['general', 'random', 'build'];
const HISTORY_LIMIT = 100;
const history = Object.fromEntries(ROOMS.map((r) => [r, []]));
const users = new Map(); // socket.id -> { name, room }

app.use(express.static(path.join(__dirname, 'public')));

const namesIn = (room) =>
  [...users.values()].filter((u) => u.room === room).map((u) => u.name);
const sendUsers = (room) => io.to(room).emit('users', namesIn(room));

io.on('connection', (socket) => {
  // Used both for the first join and for switching rooms.
  socket.on('join', ({ name, room } = {}, ack = () => {}) => {
    name = String(name || '').trim().slice(0, 24);
    if (!name) return ack({ error: 'Enter a name to join.' });

    const taken = [...users].some(
      ([id, u]) => id !== socket.id && u.name.toLowerCase() === name.toLowerCase()
    );
    if (taken) return ack({ error: `“${name}” is already in use. Pick another name.` });

    if (!ROOMS.includes(room)) room = ROOMS[0];

    const prev = users.get(socket.id);
    if (prev) {
      socket.leave(prev.room);
      socket.to(prev.room).emit('typing', { name: prev.name, isTyping: false });
    }
    users.set(socket.id, { name, room });
    socket.join(room);

    if (prev && prev.room !== room) sendUsers(prev.room);
    sendUsers(room);
    ack({ ok: true, rooms: ROOMS, room, history: history[room] });
  });

  socket.on('message', (text) => {
    const user = users.get(socket.id);
    text = String(text || '').trim().slice(0, 2000);
    if (!user || !text) return;

    const msg = { id: randomUUID(), name: user.name, text, ts: Date.now() };
    history[user.room].push(msg);
    if (history[user.room].length > HISTORY_LIMIT) history[user.room].shift();
    io.to(user.room).emit('message', msg);
  });

  socket.on('typing', (isTyping) => {
    const user = users.get(socket.id);
    if (user) socket.to(user.room).emit('typing', { name: user.name, isTyping: !!isTyping });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    users.delete(socket.id);
    if (user) {
      socket.to(user.room).emit('typing', { name: user.name, isTyping: false });
      sendUsers(user.room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Relay running at http://localhost:${PORT}`));
