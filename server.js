const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send('Username and password are required.');
  }

  db.createUser(username, password, (err, user) => {
    if (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).send('Username already taken.');
      }
      return res.status(500).send('Database error.');
    }
    res.status(200).send('Account created successfully!');
  });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send('Username and password are required.');
  }

  db.getUserByUsername(username, (err, user) => {
    if (err || !user || user.password !== password) {
      return res.status(401).send('Invalid username or password.');
    }
    res.status(200).send(`Welcome back, ${user.username}!`);
  });
});

app.listen(PORT, () => {
  console.log(`Chatsire running on http://localhost:${PORT}`);
});
