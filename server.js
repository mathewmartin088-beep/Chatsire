const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ---------- storage: one JSON file (swap for a database later) ---------- */
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const db = { users: Object.create(null), sessions: Object.create(null), chats: Object.create(null) };
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const part of Object.keys(db)) Object.assign(db[part], saved[part]);
} catch {}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), (err) => !err && fs.rename(tmp, DATA_FILE, () => {}));
  }, 300);
}

/* ---------- helpers ---------- */
const NAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const key = (n) => String(n || '').trim().toLowerCase();
const chatKey = (a, b) => [a, b].sort().join('|');
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const passwordOk = (u, pw) => {
  const a = Buffer.from(hash(pw, u.salt), 'hex');
  const b = Buffer.from(u.hash, 'hex');
  return crypto.timingSafeEqual(a, b);
};
const newSession = (k) => {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = k;
  save();
  return token;
};
const displayName = (k) => (db.users[k] ? db.users[k].name : k);
const isOnline = (k) => (io.sockets.adapter.rooms.get('user:' + k)?.size || 0) > 0;
const without = (list, k) => list.filter((x) => x !== k);

function push(k) {
  const u = db.users[k];
  if (!u) return;
  io.to('user:' + k).emit('state', {
    friends: u.friends.map((f) => ({ name: displayName(f), online: isOnline(f) })),
    incoming: u.incoming.map(displayName),
    outgoing: u.outgoing.map(displayName),
  });
}
function makeFriends(a, b) {
  const [ua, ub] = [db.users[a], db.users[b]];
  ua.incoming = without(ua.incoming, b); ua.outgoing = without(ua.outgoing, b);
  ub.incoming = without(ub.incoming, a); ub.outgoing = without(ub.outgoing, a);
  if (!ua.friends.includes(b)) ua.friends.push(b);
  if (!ub.friends.includes(a)) ub.friends.push(a);
  save(); push(a); push(b);
}

/* ---------- accounts ---------- */
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const password = String(req.body?.password || '');
  if (!NAME_RE.test(name))
    return res.status(400).json({ error: 'Use 3–20 letters, numbers or underscores for your username.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Your password needs at least 6 characters.' });
  const k = key(name);
  if (db.users[k]) return res.status(409).json({ error: `“${name}” is taken. Pick another username.` });
  const salt = crypto.randomBytes(16).toString('hex');
  db.users[k] = { name, salt, hash: hash(password, salt), friends: [], incoming: [], outgoing: [] };
  res.json({ name, token: newSession(k) });
});

app.post('/api/login', (req, res) => {
  const k = key(req.body?.name);
  const u = db.users[k];
  if (!u || !passwordOk(u, String(req.body?.password || '')))
    return res.status(401).json({ error: 'Wrong username or password.' });
  res.json({ name: u.name, token: newSession(k) });
});

app.post('/api/logout', (req, res) => {
  if (typeof req.body?.token === 'string') delete db.sessions[req.body.token];
  save();
  res.json({ ok: true });
});

/* ---------- real-time ---------- */
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const k = typeof token === 'string' ? db.sessions[token] : null;
  if (!k || !db.users[k]) return next(new Error('auth'));
  socket.data.k = k;
  next();
});

io.on('connection', (socket) => {
  const me = socket.data.k;
  const user = db.users[me];
  const areFriends = (o) => user.friends.includes(o);

  socket.join('user:' + me);
  push(me);
  user.friends.forEach(push); // tell friends I’m online

  socket.on('friend:request', (name, ack = () => {}) => {
    const o = key(name);
    const target = db.users[o];
    if (!target) return ack({ error: `No one is named “${String(name).trim()}”. Check the spelling.` });
    if (o === me) return ack({ error: 'That’s you. Add someone else.' });
    if (areFriends(o)) return ack({ error: `You’re already friends with ${target.name}.` });
    if (user.outgoing.includes(o)) return ack({ error: `You already sent ${target.name} a request.` });
    if (user.incoming.includes(o)) {
      makeFriends(me, o);
      return ack({ message: `You’re now friends with ${target.name}.` });
    }
    user.outgoing.push(o);
    target.incoming.push(me);
    save(); push(me); push(o);
    ack({ message: `Request sent to ${target.name}.` });
  });

  socket.on('friend:accept', (name) => {
    const o = key(name);
    if (db.users[o] && user.incoming.includes(o)) makeFriends(me, o);
  });

  socket.on('friend:decline', (name) => {
    const o = key(name);
    const other = db.users[o];
    if (!other) return;
    user.incoming = without(user.incoming, o);
    other.outgoing = without(other.outgoing, me);
    save(); push(me); push(o);
  });

  socket.on('friend:remove', (name) => {
    const o = key(name);
    const other = db.users[o];
    if (!other || !areFriends(o)) return;
    user.friends = without(user.friends, o);
    other.friends = without(other.friends, me);
    delete db.chats[chatKey(me, o)];
    save(); push(me); push(o);
  });

  socket.on('history', (name, ack = () => {}) => {
    const o = key(name);
    if (!areFriends(o)) return ack({ error: 'Not friends' });
    ack({ ok: true, history: db.chats[chatKey(me, o)] || [] });
  });

  socket.on('message', ({ to, text } = {}) => {
    const o = key(to);
    text = String(text || '').trim().slice(0, 2000);
    if (!text || !areFriends(o)) return;
    const msg = { id: crypto.randomUUID(), from: user.name, to: displayName(o), text, ts: Date.now() };
    const ck = chatKey(me, o);
    const list = (db.chats[ck] ||= []);
    list.push(msg);
    if (list.length > 200) list.splice(0, list.length - 200);
    save();
    io.to('user:' + me).to('user:' + o).emit('message', msg);
  });

  socket.on('typing', ({ to, isTyping } = {}) => {
    const o = key(to);
    if (areFriends(o)) io.to('user:' + o).emit('typing', { from: user.name, isTyping: !!isTyping });
  });

  socket.on('disconnect', () => {
    user.friends.forEach((f) => {
      io.to('user:' + f).emit('typing', { from: user.name, isTyping: false });
      push(f);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Relay running at http://localhost:${PORT}`));
