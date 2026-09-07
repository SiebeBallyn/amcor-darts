const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'amcor-admin';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-before-production';

const db = new Database(path.join(__dirname, 'amcor-darts.db'));

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  score INTEGER NOT NULL,
  score_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(player_id, score_date),
  FOREIGN KEY(player_id) REFERENCES players(id)
);
`);

// Upgrade databases from the previous prototype.
try {
  db.prepare("ALTER TABLE players ADD COLUMN code TEXT NOT NULL DEFAULT ''").run();
} catch (_) {}

app.use(express.json());

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

// Website files are stored directly in the repository root.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'style.css'));
});

app.get('/app.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.js'));
});

app.get('/admin.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.js'));
});

app.get('/qr-placeholder.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'qr-placeholder.png'));
});

// Serve the assets folder if it exists.
app.use('/assets', express.static(path.join(__dirname, 'assets')));

function localDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekStart(dateStr = localDate()) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();

  d.setUTCDate(
    d.getUTCDate() + (day === 0 ? -6 : 1 - day)
  );

  return d.toISOString().slice(0, 10);
}

function weekEnd(start) {
  return shiftDate(start, 6);
}

function weekLabel(start) {
  return (
    new Intl.DateTimeFormat('nl-BE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Europe/Brussels'
    }).format(new Date(start + 'T12:00:00Z')) +
    ' – ' +
    new Intl.DateTimeFormat('nl-BE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Europe/Brussels'
    }).format(new Date(weekEnd(start) + 'T12:00:00Z'))
  );
}

function cleanName(v) {
  return String(v || '').trim().replace(/\s+/g, ' ');
}

function validCode(v) {
  return /^\d{4}$/.test(String(v || ''));
}

function requirePlayer(req, res, next) {
  if (!req.session.player) {
    return res.status(401).json({
      error: 'Kies eerst je naam en geef je persoonlijke code in.'
    });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: 'Admin login vereist.'
    });
  }

  next();
}

function getPlayer(id) {
  return db.prepare(
    'SELECT id,name,active FROM players WHERE id=?'
  ).get(id);
}

function leaderboard(start) {
  const end = weekEnd(start);

  return db.prepare(`
    SELECT
      p.id,
      p.name,
      MAX(s.score) best,
      COUNT(s.id) throws
    FROM players p
    LEFT JOIN scores s
      ON s.player_id = p.id
      AND s.score_date BETWEEN ? AND ?
    WHERE p.active = 1
    GROUP BY p.id
    HAVING COUNT(s.id) > 0
    ORDER BY best DESC,
             throws ASC,
             p.name COLLATE NOCASE ASC
  `).all(start, end);
}

// Public API
app.get('/api/config', (req, res) => {
  const start = weekStart();

  res.json({
    siteName: 'Amcor Darts Challenge',
    location: 'Roeselare',
    today: localDate(),
    weekStart: start,
    weekEnd: weekEnd(start)
  });
});

app.get('/api/public-players', (req, res) => {
  res.json({
    players: db.prepare(
      'SELECT name FROM players WHERE active=1 ORDER BY name COLLATE NOCASE'
    ).all()
  });
});

app.get('/api/me', (req, res) => {
  res.json({
    player: req.session.player || null,
    admin: !!req.session.admin,
    today: localDate()
  });
});

// Player login
app.post('/api/select-player', (req, res) => {
  const name = cleanName(req.body.name);
  const code = String(req.body.code || '').trim();

  if (!name || name.length > 60) {
    return res.status(400).json({
      error: 'Geef een geldige naam in.'
    });
  }

  if (!validCode(code)) {
    return res.status(400).json({
      error: 'Je persoonlijke code bestaat uit 4 cijfers.'
    });
  }

  const p = db.prepare(
    'SELECT id,name,code,active FROM players WHERE lower(name)=lower(?)'
  ).get(name);

  if (!p || !p.active) {
    return res.status(401).json({
      error: 'Deze naam staat niet in de deelnemerslijst. Vraag de organisatie om hulp.'
    });
  }

  if (p.code !== code) {
    return res.status(401).json({
      error: 'De code klopt niet. Probeer opnieuw.'
    });
  }

  req.session.player = {
    id: p.id,
    name: p.name
  };

  res.json({
    player: req.session.player
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Today's score
app.get('/api/today', requirePlayer, (req, res) => {
  const date = localDate();

  const row = db.prepare(
    'SELECT score FROM scores WHERE player_id=? AND score_date=?'
  ).get(req.session.player.id, date);

  res.json({
    submitted: !!row,
    score: row?.score ?? null,
    date
  });
});

// Submit score
app.post('/api/scores', requirePlayer, (req, res) => {
  const score = Number(req.body.score);
  const date = localDate();

  if (!Number.isInteger(score) || score < 0 || score > 180) {
    return res.status(400).json({
      error: 'Geef een volledige score tussen 0 en 180 in.'
    });
  }

  const player = getPlayer(req.session.player.id);

  if (!player?.active) {
    return res.status(403).json({
      error: 'Je deelname is gedeactiveerd.'
    });
  }

  try {
    db.prepare(`
      INSERT INTO scores(player_id,score,score_date)
      VALUES(?,?,?)
    `).run(player.id, score, date);

    res.json({
      ok: true,
      score,
      date
    });
  } catch (e) {
    res.status(409).json({
      error: 'Je hebt vandaag al een worp ingediend.'
    });
  }
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
  const start = req.query.week || weekStart();

  res.json({
    weekStart: start,
    weekEnd: weekEnd(start),
    label: weekLabel(start),
    rows: leaderboard(start)
  });
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  if (String(req.body.password || '') !== ADMIN_PASSWORD) {
    return res.status(401).json({
      error: 'Verkeerd admin-wachtwoord.'
    });
  }

  req.session.admin = true;

  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.admin = false;
  res.json({ ok: true });
});

// Admin players
app.get('/api/admin/players', requireAdmin, (req, res) => {
  res.json(
    db.prepare(`
      SELECT id,name,code,active
      FROM players
      ORDER BY active DESC,
               name COLLATE NOCASE
    `).all()
  );
});

app.post('/api/admin/players', requireAdmin, (req, res) => {
  const name = cleanName(req.body.name);
  const code = String(req.body.code || '').trim();

  if (!name || name.length > 60) {
    return res.status(400).json({
      error: 'Geef een geldige naam in.'
    });
  }

  if (!validCode(code)) {
    return res.status(400).json({
      error: 'Code moet uit exact 4 cijfers bestaan.'
    });
  }

  try {
    const info = db.prepare(`
      INSERT INTO players(name,code,active)
      VALUES(?,?,1)
    `).run(name, code);

    res.json({
      ok: true,
      id: info.lastInsertRowid
    });
  } catch (e) {
    res.status(409).json({
      error: 'Deze naam bestaat al.'
    });
  }
});

app.patch('/api/admin/players/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  const p = db.prepare(
    'SELECT id FROM players WHERE id=?'
  ).get(id);

  if (!p) {
    return res.status(404).json({
      error: 'Deelnemer niet gevonden.'
    });
  }

  const fields = [];
  const vals = [];

  if (req.body.name !== undefined) {
    const name = cleanName(req.body.name);

    if (!name || name.length > 60) {
      return res.status(400).json({
        error: 'Ongeldige naam.'
      });
    }

    fields.push('name=?');
    vals.push(name);
  }

  if (req.body.code !== undefined) {
    const code = String(req.body.code).trim();

    if (!validCode(code)) {
      return res.status(400).json({
        error: 'Code moet 4 cijfers zijn.'
      });
    }

    fields.push('code=?');
    vals.push(code);
  }

  if (req.body.active !== undefined) {
    fields.push('active=?');
    vals.push(req.body.active ? 1 : 0);
  }

  if (fields.length) {
    vals.push(id);

    try {
      db.prepare(`
        UPDATE players
        SET ${fields.join(',')}
        WHERE id=?
      `).run(...vals);
    } catch (e) {
      return res.status(409).json({
        error: 'Naam bestaat al.'
      });
    }
  }

  res.json({ ok: true });
});

app.delete('/api/admin/players/:id', requireAdmin, (req, res) => {
  db.prepare(
    'UPDATE players SET active=0 WHERE id=?'
  ).run(req.params.id);

  res.json({ ok: true });
});

// Admin winner
app.get('/api/admin/winner', requireAdmin, (req, res) => {
  const start = req.query.week || weekStart();
  const rows = leaderboard(start);

  res.json({
    weekStart: start,
    weekEnd: weekEnd(start),
    winner: rows[0] || null,
    final: start !== weekStart()
  });
});

// Admin scores
app.get('/api/admin/scores', requireAdmin, (req, res) => {
  const start = req.query.week || weekStart();
  const end = weekEnd(start);

  res.json(
    db.prepare(`
      SELECT
        s.id,
        p.name,
        s.score,
        s.score_date
      FROM scores s
      JOIN players p ON p.id=s.player_id
      WHERE s.score_date BETWEEN ? AND ?
      ORDER BY s.score_date DESC,
               s.id DESC
    `).all(start, end)
  );
});

app.listen(PORT, () => {
  console.log(
    `Amcor Darts draait op http://localhost:${PORT}`
  );
});
