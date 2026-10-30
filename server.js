// Ganapavaram voter search - simple Node server for Railway
// Env: PORT (Railway sets it), APP_PASSWORD (login password), SESSION_SECRET (optional)
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('voter:' + PASSWORD).digest('hex');
const TOKEN = crypto.createHmac('sha256', SECRET).update('authorized').digest('hex');

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
function authed(req) {
  if (!PASSWORD) return true;
  const c = getCookie(req, 'vs_auth');
  return c.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(TOKEN));
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
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `vs_auth=${TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${secure}`);
  res.redirect('/');
});
app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'vs_auth=; HttpOnly; Path=/; Max-Age=0');
  res.redirect('/login');
});

// everything below needs login
app.use((req, res, next) => {
  if (authed(req)) return next();
  if (req.path.startsWith('/data/')) return res.status(401).send('Login required');
  return res.redirect('/login');
});

app.use('/data', express.static(path.join(__dirname, 'data'), { maxAge: '7d', index: false }));
// app files: always revalidate so a new deploy shows up immediately (fonts can be cached long)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => {
    if (/\.(woff2)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=2592000');
    else res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.listen(PORT, () => console.log(`Voter search running on port ${PORT}`));
