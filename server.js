// Ganapavaram voter search - Node server (Render / Railway / local)
// Env:
//   PORT                      set by the host
//   ADMIN_USERNAME            admin login name (default "admin")
//   ADMIN_PASSWORD            admin password - used to create the admin account on first start
//   ADMIN_RESET=1             one-time: reset admin password to ADMIN_PASSWORD on start
//   TURSO_DATABASE_URL        libsql://... (recommended on Render so users/devices are not lost)
//   TURSO_AUTH_TOKEN          Turso token
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const D = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');

app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ---------- helpers ----------
function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}
function cookie(req, name, value, maxAgeSec) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`;
}
function deviceLabel(ua = '') {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /CrOS/i.test(ua) ? 'Chromebook' : /Linux/i.test(ua) ? 'Linux' : 'Unknown';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const model = (ua.match(/Android [\d.]+; ([^;)]+)/) || [])[1];
  return `${br} · ${os}${model && !/^K$|wv/.test(model) ? ' (' + model.trim() + ')' : ''}`;
}
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
let idleCache = { v: 10, at: 0 };
async function idleMinutes() {
  if (Date.now() - idleCache.at > 30000) idleCache = { v: Math.max(1, +(await D.getSetting('idle_minutes', '10')) || 10), at: Date.now() };
  return idleCache.v;
}

// ---------- login rate limit (per IP) ----------
const fails = new Map();
function rateLimited(ip) {
  const f = fails.get(ip); if (!f) return false;
  if (Date.now() - f.first > 15 * 60e3) { fails.delete(ip); return false; }
  return f.n >= 10;
}
function addFail(ip) { const f = fails.get(ip) || { n: 0, first: Date.now() }; f.n++; fails.set(ip, f); }

// ---------- session middleware ----------
async function loadSession(req) {
  const tok = getCookie(req, 'vs_sess');
  if (!tok) return null;
  const s = await D.one(`SELECT s.token_hash, s.last_seen, s.device_id, u.id uid, u.username, u.full_name, u.role, u.active, d.blocked
      FROM sessions s JOIN users u ON u.id=s.user_id JOIN devices d ON d.id=s.device_id WHERE s.token_hash=?`, [D.tokenHash(tok)]);
  if (!s) return { expired: 'removed' };
  const idle = (await idleMinutes()) * 60e3;
  if (!s.active || s.blocked) { await D.run(`DELETE FROM sessions WHERE token_hash=?`, [s.token_hash]); return { expired: s.blocked ? 'blocked' : 'inactive' }; }
  if (Date.now() - s.last_seen > idle) { await D.run(`DELETE FROM sessions WHERE token_hash=?`, [s.token_hash]); return { expired: 'idle' }; }
  return s;
}
async function touch(s) {
  if (Date.now() - s.last_seen < 20e3) return;
  const t = Date.now();
  await D.run(`UPDATE sessions SET last_seen=? WHERE token_hash=?`, [t, s.token_hash]);
  await D.run(`UPDATE devices SET last_seen=? WHERE id=?`, [t, s.device_id]);
}

// ---------- public routes ----------
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
app.use('/fonts', express.static(path.join(PUB, 'fonts'), { maxAge: '30d' }));
app.get('/login', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.sendFile(path.join(PUB, 'login.html')); });

app.post('/login', wrap(async (req, res) => {
  const ip = req.ip, ua = req.headers['user-agent'] || '';
  const username = String(req.body.username || '').trim(), password = String(req.body.password || '');
  const log = (ok, reason) => D.run(`INSERT INTO login_log(at,username,ok,reason,ip,device) VALUES(?,?,?,?,?,?)`, [Date.now(), username, ok ? 1 : 0, reason, ip, deviceLabel(ua)]);
  if (rateLimited(ip)) { await log(false, 'too many attempts'); return res.redirect('/login?e=rate'); }

  const u = username && await D.one(`SELECT * FROM users WHERE username=?`, [username]);
  if (!u || !D.checkPassword(password, u.pass_hash)) { addFail(ip); await log(false, 'wrong password'); return res.redirect('/login?e=bad'); }
  if (!u.active) { await log(false, 'account disabled'); return res.redirect('/login?e=inactive'); }

  // device: a random id kept in a long-lived cookie on this browser
  let devKey = getCookie(req, 'vs_dev');
  const cookies = [];
  if (!/^[a-f0-9]{48}$/.test(devKey)) { devKey = crypto.randomBytes(24).toString('hex'); }
  cookies.push(cookie(req, 'vs_dev', devKey, 60 * 60 * 24 * 730));
  const dk = D.tokenHash(devKey);
  let dev = await D.one(`SELECT * FROM devices WHERE user_id=? AND device_key=?`, [u.id, dk]);
  if (dev && dev.blocked) { await log(false, 'device blocked'); return res.redirect('/login?e=blocked'); }
  if (!dev) {
    if (u.role !== 'admin') {
      const c = await D.one(`SELECT COUNT(*) n FROM devices WHERE user_id=? AND blocked=0`, [u.id]);
      if (Number(c.n) >= Number(u.max_devices)) { await log(false, `device limit (${u.max_devices}) reached`); res.setHeader('Set-Cookie', cookies); return res.redirect('/login?e=limit&n=' + u.max_devices); }
    }
    const t = Date.now();
    await D.run(`INSERT INTO devices(user_id,device_key,label,ip,blocked,first_seen,last_seen) VALUES(?,?,?,?,0,?,?)`, [u.id, dk, deviceLabel(ua), ip, t, t]);
    dev = await D.one(`SELECT * FROM devices WHERE user_id=? AND device_key=?`, [u.id, dk]);
  } else {
    await D.run(`UPDATE devices SET label=?, ip=?, last_seen=? WHERE id=?`, [deviceLabel(ua), ip, Date.now(), dev.id]);
  }

  // one session per device
  await D.run(`DELETE FROM sessions WHERE device_id=?`, [dev.id]);
  const tok = crypto.randomBytes(32).toString('hex'), t = Date.now();
  await D.run(`INSERT INTO sessions(token_hash,user_id,device_id,created_at,last_seen) VALUES(?,?,?,?,?)`, [D.tokenHash(tok), u.id, dev.id, t, t]);
  await D.run(`UPDATE users SET last_login=? WHERE id=?`, [t, u.id]);
  await log(true, 'ok');
  fails.delete(ip);
  cookies.push(cookie(req, 'vs_sess', tok, 60 * 60 * 24));
  res.setHeader('Set-Cookie', cookies);
  res.redirect(u.role === 'admin' && req.body.next === 'admin' ? '/admin' : '/');
}));

async function logout(req, res) {
  const tok = getCookie(req, 'vs_sess');
  if (tok) await D.run(`DELETE FROM sessions WHERE token_hash=?`, [D.tokenHash(tok)]);
  res.setHeader('Set-Cookie', cookie(req, 'vs_sess', '', 0));
}
app.get('/logout', wrap(async (req, res) => { await logout(req, res); res.redirect('/login' + (req.query.r === 'idle' ? '?e=idle' : '')); }));
app.post('/api/logout', wrap(async (req, res) => { await logout(req, res); res.json({ ok: true }); }));

// ---------- everything below needs a valid session ----------
app.use(wrap(async (req, res, next) => {
  const s = await loadSession(req);
  if (s && !s.expired) { req.user = s; await touch(s); return next(); }
  const why = s && s.expired ? s.expired : '';
  if (why) res.setHeader('Set-Cookie', cookie(req, 'vs_sess', '', 0));
  if (req.path.startsWith('/api/') || req.path.startsWith('/data/')) return res.status(401).json({ error: 'login', reason: why });
  res.redirect('/login' + (why ? '?e=' + why : ''));
}));

// CSRF guard for state-changing API calls: browsers can't send this header cross-site without CORS
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'voter-app') return res.status(403).json({ error: 'bad request' });
  next();
});

app.get('/api/me', wrap(async (req, res) => {
  res.json({ username: req.user.username, fullName: req.user.full_name, role: req.user.role, idleMinutes: await idleMinutes() });
}));
app.post('/api/ping', (req, res) => res.json({ ok: true }));   // keeps the session alive while the user is active
app.post('/api/me/password', wrap(async (req, res) => {
  const { current, password } = req.body || {};
  const u = await D.one(`SELECT * FROM users WHERE id=?`, [req.user.uid]);
  if (!D.checkPassword(current, u.pass_hash)) return res.status(400).json({ error: 'ప్రస్తుత పాస్‌వర్డ్ తప్పు · Current password is wrong' });
  if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'కనీసం 6 అక్షరాలు · At least 6 characters' });
  await D.run(`UPDATE users SET pass_hash=? WHERE id=?`, [D.hashPassword(password), u.id]);
  res.json({ ok: true });
}));

// ---------- admin ----------
const adminOnly = (req, res, next) => req.user.role === 'admin' ? next()
  : (req.path.startsWith('/api/') || req.baseUrl.startsWith('/api') ? res.status(403).json({ error: 'admin only' }) : res.redirect('/'));
app.get(['/admin', '/admin.html'], adminOnly, (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(PUB, 'admin.html')); });
app.get('/admin.js', adminOnly, (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(PUB, 'admin.js')); });

const A = express.Router();
A.use(adminOnly);
const cleanUser = s => String(s || '').trim();
const validName = s => /^[A-Za-z0-9@._\-]{3,40}$/.test(s);

A.get('/users', wrap(async (req, res) => {
  const idle = (await idleMinutes()) * 60e3, t = Date.now();
  const users = await D.q(`SELECT u.id,u.username,u.full_name,u.role,u.max_devices,u.active,u.created_at,u.last_login,
      (SELECT COUNT(*) FROM devices d WHERE d.user_id=u.id AND d.blocked=0) devices,
      (SELECT COUNT(*) FROM devices d WHERE d.user_id=u.id AND d.blocked=1) blocked,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.last_seen>?) online
    FROM users u ORDER BY u.role='admin' DESC, u.username`, [t - idle]);
  res.json(users.map(u => ({ ...u, me: u.id === req.user.uid })));
}));
A.post('/users', wrap(async (req, res) => {
  const username = cleanUser(req.body.username), password = String(req.body.password || '');
  if (!validName(username)) return res.status(400).json({ error: 'యూజర్ పేరు 3–40 అక్షరాలు (A-Z, 0-9, @ . _ -)' });
  if (password.length < 6) return res.status(400).json({ error: 'పాస్‌వర్డ్ కనీసం 6 అక్షరాలు · Password min 6 chars' });
  if (await D.one(`SELECT id FROM users WHERE username=?`, [username])) return res.status(400).json({ error: 'ఈ యూజర్ పేరు ఇప్పటికే ఉంది · Username already exists' });
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const max = Math.max(1, Math.min(50, parseInt(req.body.max_devices, 10) || +(await D.getSetting('default_max_devices', '1'))));
  await D.run(`INSERT INTO users(username,pass_hash,full_name,role,max_devices,active,created_at) VALUES(?,?,?,?,?,1,?)`,
    [username, D.hashPassword(password), cleanUser(req.body.full_name).slice(0, 80), role, max, Date.now()]);
  res.json({ ok: true });
}));
A.patch('/users/:id', wrap(async (req, res) => {
  const id = +req.params.id, b = req.body || {};
  const u = await D.one(`SELECT * FROM users WHERE id=?`, [id]);
  if (!u) return res.status(404).json({ error: 'not found' });
  if (id === req.user.uid && (b.active === false || b.active === 0 || b.role === 'user')) return res.status(400).json({ error: 'మీ స్వంత అడ్మిన్ ఖాతాను నిలిపివేయలేరు · You cannot disable your own admin account' });
  if (b.password !== undefined) {
    if (String(b.password).length < 6) return res.status(400).json({ error: 'పాస్‌వర్డ్ కనీసం 6 అక్షరాలు' });
    await D.run(`UPDATE users SET pass_hash=? WHERE id=?`, [D.hashPassword(String(b.password)), id]);
    if (id !== req.user.uid) await D.run(`DELETE FROM sessions WHERE user_id=?`, [id]);
  }
  if (b.max_devices !== undefined) await D.run(`UPDATE users SET max_devices=? WHERE id=?`, [Math.max(1, Math.min(50, parseInt(b.max_devices, 10) || 1)), id]);
  if (b.full_name !== undefined) await D.run(`UPDATE users SET full_name=? WHERE id=?`, [cleanUser(b.full_name).slice(0, 80), id]);
  if (b.role !== undefined) await D.run(`UPDATE users SET role=? WHERE id=?`, [b.role === 'admin' ? 'admin' : 'user', id]);
  if (b.active !== undefined) {
    await D.run(`UPDATE users SET active=? WHERE id=?`, [b.active ? 1 : 0, id]);
    if (!b.active) await D.run(`DELETE FROM sessions WHERE user_id=?`, [id]);
  }
  res.json({ ok: true });
}));
A.delete('/users/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  if (id === req.user.uid) return res.status(400).json({ error: 'మీ స్వంత ఖాతాను తొలగించలేరు · You cannot delete yourself' });
  await D.run(`DELETE FROM sessions WHERE user_id=?`, [id]);
  await D.run(`DELETE FROM devices WHERE user_id=?`, [id]);
  await D.run(`DELETE FROM users WHERE id=?`, [id]);
  res.json({ ok: true });
}));
A.post('/users/:id/logout', wrap(async (req, res) => {
  await D.run(`DELETE FROM sessions WHERE user_id=?` + (+req.params.id === req.user.uid ? ` AND token_hash<>?` : ''),
    +req.params.id === req.user.uid ? [+req.params.id, req.user.token_hash] : [+req.params.id]);
  res.json({ ok: true });
}));
A.get('/users/:id/devices', wrap(async (req, res) => {
  const idle = (await idleMinutes()) * 60e3;
  res.json(await D.q(`SELECT d.id,d.label,d.ip,d.blocked,d.first_seen,d.last_seen,
      (SELECT COUNT(*) FROM sessions s WHERE s.device_id=d.id AND s.last_seen>?) online,
      (d.id=?) current
    FROM devices d WHERE d.user_id=? ORDER BY d.last_seen DESC`, [Date.now() - idle, req.user.device_id, +req.params.id]));
}));
A.patch('/devices/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  if (id === req.user.device_id && req.body.blocked) return res.status(400).json({ error: 'ఈ పరికరాన్ని మీరు ఇప్పుడు వాడుతున్నారు · This is your current device' });
  await D.run(`UPDATE devices SET blocked=? WHERE id=?`, [req.body.blocked ? 1 : 0, id]);
  if (req.body.blocked) await D.run(`DELETE FROM sessions WHERE device_id=?`, [id]);
  res.json({ ok: true });
}));
A.delete('/devices/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  if (id === req.user.device_id) return res.status(400).json({ error: 'ఈ పరికరాన్ని మీరు ఇప్పుడు వాడుతున్నారు · This is your current device' });
  await D.run(`DELETE FROM sessions WHERE device_id=?`, [id]);
  await D.run(`DELETE FROM devices WHERE id=?`, [id]);
  res.json({ ok: true });
}));
A.get('/settings', wrap(async (req, res) => {
  res.json({ idle_minutes: +(await D.getSetting('idle_minutes', '10')), default_max_devices: +(await D.getSetting('default_max_devices', '1')), persistent: D.isRemote });
}));
A.put('/settings', wrap(async (req, res) => {
  const im = parseInt(req.body.idle_minutes, 10), md = parseInt(req.body.default_max_devices, 10);
  if (im >= 1 && im <= 240) await D.setSetting('idle_minutes', im);
  if (md >= 1 && md <= 50) await D.setSetting('default_max_devices', md);
  idleCache.at = 0;
  res.json({ ok: true });
}));
A.get('/log', wrap(async (req, res) => {
  res.json(await D.q(`SELECT at,username,ok,reason,ip,device FROM login_log ORDER BY id DESC LIMIT 200`));
}));
app.use('/api/admin', A);

// ---------- app files ----------
app.use('/data/pages', express.static(path.join(__dirname, 'data', 'pages'), { maxAge: '7d', index: false }));
app.get('/data/voters.json', (req, res) => { res.setHeader('Cache-Control', 'private, no-cache'); res.sendFile(path.join(__dirname, 'data', 'voters.json')); });
app.use(express.static(PUB, {
  index: 'index.html',
  setHeaders: (res, file) => res.setHeader('Cache-Control', /\.woff2$/.test(file) ? 'public, max-age=2592000' : 'no-cache')
}));

app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'server error' });
  res.status(500).send('Server error');
});

D.init().then(() => app.listen(PORT, () => console.log(`Voter search running on port ${PORT}`)))
  .catch(e => { console.error('Database init failed:', e); process.exit(1); });
