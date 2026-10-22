const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Account Registration (supports both /register and /api/register)
const handleRegister = (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  db.createUser(username, password, (err, user) => {
    if (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'Username is already taken.' });
      }
      return res.status(500).json({ error: 'Database error occurred.' });
    }
    return res.status(200).json({ message: 'Account created successfully! You can now log in.', user });
  });
};

app.post('/register', handleRegister);
app.post('/api/register', handleRegister);

// User Login (supports both /login and /api/login)
const handleLogin = (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  db.getUserByUsername(username, (err, user) => {
    if (err || !user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    return res.status(200).json({ message: `Welcome back, ${user.username}!`, user: { id: user.id, username: user.username } });
  });
};

app.post('/login', handleLogin);
app.post('/api/login', handleLogin);

app.listen(PORT, () => {
  console.log(`Chatsire running on http://localhost:${PORT}`);
});
