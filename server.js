// Ganapavaram voter search - simple Node server for Railway
// Env: PORT (host sets it), APP_PASSWORD (login password), SESSION_SECRET (optional),
//      IDLE_MINUTES (auto logout after this many minutes without activity, default 5)
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('voter:' + PASSWORD).digest('hex');
const IDLE_MIN = Math.max(1, parseInt(process.env.IDLE_MINUTES, 10) || 5);
const IDLE_MS = IDLE_MIN * 60 * 1000;

// Session cookie = "<last-activity-time>.<signature>". The server refuses it once it is older than
// IDLE_MINUTES, so every device is logged out after that much inactivity, and refreshes it on activity.
const sign = ts => crypto.createHmac('sha256', SECRET).update('authorized:' + ts).digest('hex');
const makeToken = () => { const ts = Date.now(); return `${ts}.${sign(ts)}`; };

if (!PASSWORD) console.warn('WARNING: APP_PASSWORD is not set - the app is open to anyone with the link.');

app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}
function setAuthCookie(req, res, value, maxAgeSec) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `vs_auth=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`);
}
// returns 'ok', 'idle' (expired) or '' (no / bad cookie)
function session(req) {
  if (!PASSWORD) return 'ok';
  const c = getCookie(req, 'vs_auth');
  const m = /^(\d{13})\.([a-f0-9]{64})$/.exec(c);
  if (!m) return '';
  const good = sign(m[1]);
  if (!crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(good))) return '';
  const age = Date.now() - Number(m[1]);
  if (age < -60000) return '';
  return age > IDLE_MS ? 'idle' : 'ok';
}

app.get('/healthz', (req, res) => res.send('ok'));
app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));

app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), { maxAge: '30d' }));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.post('/login', (req, res) => {
  const ok = PASSWORD && typeof req.body.password === 'string' &&
    crypto.timingSafeEqual(crypto.createHash('sha256').update(req.body.password).digest(),
                           crypto.createHash('sha256').update(PASSWORD).digest());
  if (!ok) return res.redirect('/login?e=1');
  setAuthCookie(req, res, makeToken(), IDLE_MIN * 60);
  res.redirect('/');
});
app.get('/logout', (req, res) => {
  setAuthCookie(req, res, '', 0);
  res.redirect('/login' + (req.query.r === 'idle' ? '?e=idle' : ''));
});

// everything below needs login
app.use((req, res, next) => {
  const st = session(req);
  if (st === 'ok') {
    // activity: slide the 5-minute window forward (at most every 20 s to keep it cheap)
    if (PASSWORD) {
      const ts = Number(getCookie(req, 'vs_auth').split('.')[0]);
      if (Date.now() - ts > 20000) setAuthCookie(req, res, makeToken(), IDLE_MIN * 60);
    }
    return next();
  }
  if (st === 'idle') setAuthCookie(req, res, '', 0);
  if (req.path.startsWith('/data/') || req.path.startsWith('/api/')) return res.status(401).json({ error: 'login', reason: st });
  return res.redirect('/login' + (st === 'idle' ? '?e=idle' : ''));
});

// small API used by the page: idle time, and a ping that keeps the session alive while the user is active
app.get('/api/session', (req, res) => res.json({ idleMinutes: IDLE_MIN }));
app.post('/api/ping', (req, res) => res.json({ ok: true }));

app.use('/data', express.static(path.join(__dirname, 'data'), { maxAge: '7d', index: false }));
// app files: always revalidate so a new deploy shows up immediately (fonts can be cached long)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => {
    if (/\.(woff2)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=2592000');
    else res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.listen(PORT, () => console.log(`Voter search running on port ${PORT}`));
