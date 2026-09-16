const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'streamverse-jwt-secret-change-in-production';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'channels.json');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ channels: [], streams: [], schedule: [] }, null, 2));
}

// ============ DATA LAYER ============
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { channels: [], streams: [], schedule: [] };
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to write data:', e);
  }
}

// ============ AUTH MIDDLEWARE ============
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

// ============ API ROUTES ============

// --- Auth ---
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (username !== ADMIN_USERNAME) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  // Verify password against hash stored in data file, or check against env default
  const data = readData();
  let storedHash = data.adminPasswordHash;

  if (!storedHash) {
    // Default setup — compare with env/default password directly
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
  } else {
    const valid = bcrypt.compareSync(password, storedHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
  }

  const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, username, role: 'admin' });
});

// --- Initialize / Setup (first run) ---
app.post('/api/setup', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  const data = readData();
  if (data.adminPasswordHash) {
    return res.status(400).json({ error: 'Already initialized.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  data.adminPasswordHash = hash;
  writeData(data);
  res.json({ message: 'Admin account created successfully.' });
});

// --- Channels (public) ---
app.get('/api/channels', (req, res) => {
  const data = readData();
  res.json(data.channels);
});

app.get('/api/channels/:id', (req, res) => {
  const data = readData();
  const channel = data.channels.find(c => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  res.json(channel);
});

// --- Channels (admin) ---
app.get('/api/admin/channels', authenticateToken, (req, res) => {
  const data = readData();
  res.json(data.channels);
});

app.post('/api/admin/channels', authenticateToken, (req, res) => {
  const data = readData();
  const { name, category, logo, streamTitle, description, link, quality, poster } = req.body;

  if (!name || !link) {
    return res.status(400).json({ error: 'Name and stream link are required.' });
  }

  const newChannel = {
    id: 'ch_' + uuidv4().substring(0, 8),
    name,
    category: category || 'General',
    logo: logo || '',
    streamTitle: streamTitle || name,
    description: description || '',
    link,
    viewers: '0',
    quality: quality || 'HD · 1080p',
    isLive: false,
    poster: poster || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  data.channels.push(newChannel);
  writeData(data);
  res.status(201).json(newChannel);
});

app.put('/api/admin/channels/:id', authenticateToken, (req, res) => {
  const data = readData();
  const idx = data.channels.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Channel not found.' });

  const updates = { ...req.body, id: data.channels[idx].id, updatedAt: new Date().toISOString() };
  delete updates.createdAt;

  data.channels[idx] = { ...data.channels[idx], ...updates };
  writeData(data);
  res.json(data.channels[idx]);
});

app.delete('/api/admin/channels/:id', authenticateToken, (req, res) => {
  const data = readData();
  const idx = data.channels.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Channel not found.' });

  const deleted = data.channels.splice(idx, 1);
  writeData(data);
  res.json({ message: 'Channel deleted.', channel: deleted[0] });
});

// --- Streams (public) ---
app.get('/api/streams', (req, res) => {
  const data = readData();
  res.json(data.streams);
});

// --- Streams (admin) ---
app.get('/api/admin/streams', authenticateToken, (req, res) => {
  const data = readData();
  res.json(data.streams);
});

app.post('/api/admin/streams', authenticateToken, (req, res) => {
  const data = readData();
  const { channelId, title, category, logo, img, live } = req.body;

  if (!channelId || !title) {
    return res.status(400).json({ error: 'Channel ID and title are required.' });
  }

  const foundChannel = data.channels.find(c => c.id === channelId);

  const newStream = {
    id: 'str_' + uuidv4().substring(0, 8),
    channelId,
    channel: foundChannel ? foundChannel.name : 'Unknown',
    title,
    category: category || 'General',
    live: live || false,
    viewers: '0',
    logo: logo || (foundChannel ? foundChannel.logo : ''),
    img: img || ''
  };

  data.streams.push(newStream);
  writeData(data);
  res.status(201).json(newStream);
});

app.put('/api/admin/streams/:id', authenticateToken, (req, res) => {
  const data = readData();
  const idx = data.streams.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Stream not found.' });

  const updates = { ...req.body, id: data.streams[idx].id, updatedAt: new Date().toISOString() };
  data.streams[idx] = { ...data.streams[idx], ...updates };
  writeData(data);
  res.json(data.streams[idx]);
});

app.delete('/api/admin/streams/:id', authenticateToken, (req, res) => {
  const data = readData();
  const idx = data.streams.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Stream not found.' });
  data.streams.splice(idx, 1);
  writeData(data);
  res.json({ message: 'Stream deleted.' });
});

// --- Schedule (public) ---
app.get('/api/schedule', (req, res) => {
  const data = readData();
  res.json(data.schedule);
});

// --- Schedule (admin) ---
app.get('/api/admin/schedule', authenticateToken, (req, res) => {
  const data = readData();
  res.json(data.schedule);
});

app.post('/api/admin/schedule', authenticateToken, (req, res) => {
  const data = readData();
  const { channelId, channel, title, date, hour, category, logo, live } = req.body;

  if (!channelId || !title) {
    return res.status(400).json({ error: 'Channel ID and title are required.' });
  }

  const ch = data.channels.find(c => c.id === channelId);

  const newItem = {
    id: 'sched_' + uuidv4().substring(0, 8),
    channelId,
    channel: ch ? ch.name : (channel || 'Unknown'),
    title,
    date: date || 'TBD',
    hour: hour || 'TBD',
    category: category || 'General',
    live: live || false,
    logo: logo || (ch ? ch.logo : '')
  };

  data.schedule.push(newItem);
  writeData(data);
  res.status(201).json(newItem);
});

app.put('/api/admin/schedule/:id', authenticateToken, (req, res) => {
  const data = readData();
  const idx = data.schedule.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Schedule item not found.' });
  const updates = { ...req.body, id: data.schedule[idx].id };
  data.schedule[idx] = { ...data.schedule[idx], ...updates };
  writeData(data);
  res.json(data.schedule[idx]);
});

app.delete('/api/admin/schedule/:id', authenticateToken, (req, res) => {
  const data = readData();
  const idx = data.schedule.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Schedule item not found.' });
  data.schedule.splice(idx, 1);
  writeData(data);
  res.json({ message: 'Schedule item deleted.' });
});

// --- Stats ---
app.get('/api/stats', (req, res) => {
  const data = readData();
  res.json({
    totalChannels: data.channels.length,
    liveChannels: data.channels.filter(c => c.isLive).length,
    totalStreams: data.streams.length,
    liveStreams: data.streams.filter(s => s.live).length,
    upcomingStreams: data.streams.filter(s => !s.live).length,
    scheduleItems: data.schedule.length
  });
});

// --- Admin page route ---
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// --- Fallback to index.html for SPA routing ---
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║       StreamVerse Server Running         ║
  ╠══════════════════════════════════════════╣
  ║  Local:    http://localhost:${PORT}          ║
  ║  Admin:    http://localhost:${PORT}/admin  ║
  ║  API:      http://localhost:${PORT}/api    ║
  ╚══════════════════════════════════════════╝
  `);
});
