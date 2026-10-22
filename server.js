const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Body parsing middleware (handles both JSON and form submissions)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper function to extract credentials reliably
function getCredentials(req) {
  const body = req.body || {};
  const username = (body.username || body.user || body.uname || '').toString().trim();
  const password = (body.password || body.pass || body.passwd || '').toString().trim();
  return { username, password };
}

// Registration handler
const handleRegister = (req, res) => {
  const { username, password } = getCredentials(req);

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  db.createUser(username, password, (err, user) => {
    if (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'Username is already taken.' });
      }
      return res.status(500).json({ error: 'Failed to create account.' });
    }

    console.log(`User registered: ${user.username}`);
    return res.status(200).json({
      message: 'Account created successfully! You can now log in.',
      user: { username: user.username }
    });
  });
};

app.post('/register', handleRegister);
app.post('/api/register', handleRegister);

// Login handler
const handleLogin = (req, res) => {
  const { username, password } = getCredentials(req);

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  db.getUserByUsername(username, (err, user) => {
    if (err || !user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    console.log(`User logged in: ${user.username}`);
    return res.status(200).json({
      message: `Welcome back, ${user.username}!`,
      user: { id: user.id, username: user.username }
    });
  });
};

app.post('/login', handleLogin);
app.post('/api/login', handleLogin);

app.listen(PORT, () => {
  console.log(`Chatsire running on http://localhost:${PORT}`);
});
