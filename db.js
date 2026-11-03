// SQLite storage for users, devices, sessions, settings and login history.
// Local:  uses a SQLite file (DB_FILE, default ./db/app.db)
// Render: set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN so data survives restarts (Render's disk is temporary)
const { createClient } = require('@libsql/client');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let url = process.env.TURSO_DATABASE_URL;
if (!url) {
  const file = process.env.DB_FILE || path.join(__dirname, 'db', 'app.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  url = 'file:' + file;
}
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const isRemote = !url.startsWith('file:');

const now = () => Date.now();
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const one = async (sql, args = []) => (await q(sql, args))[0] || null;
const run = async (sql, args = []) => db.execute({ sql, args });

// ---------- password hashing (scrypt) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${h}`;
}
function checkPassword(pw, stored) {
  if (!stored || typeof pw !== 'string') return false;
  const [, salt, h] = stored.split('$');
  const a = crypto.scryptSync(pw, salt, 64), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- schema ----------
async function init() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      pass_hash TEXT NOT NULL,
      full_name TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      max_devices INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_login INTEGER)`,
    `CREATE TABLE IF NOT EXISTS devices(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_key TEXT NOT NULL,
      label TEXT,
      ip TEXT,
      blocked INTEGER NOT NULL DEFAULT 0,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      UNIQUE(user_id, device_key))`,
    `CREATE TABLE IF NOT EXISTS sessions(
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS login_log(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL, username TEXT, ok INTEGER, reason TEXT, ip TEXT, device TEXT)`
  ], 'write');
  await run(`INSERT OR IGNORE INTO settings(key,value) VALUES('idle_minutes','10')`);
  await run(`INSERT OR IGNORE INTO settings(key,value) VALUES('default_max_devices','1')`);

  // seed / repair the admin account from env
  const au = process.env.ADMIN_USERNAME || 'admin';
  const ap = process.env.ADMIN_PASSWORD;
  const admin = await one(`SELECT * FROM users WHERE role='admin' LIMIT 1`);
  if (!admin) {
    if (!ap) console.error('No admin account yet: set ADMIN_PASSWORD (and optionally ADMIN_USERNAME) and restart.');
    else {
      await run(`INSERT INTO users(username,pass_hash,full_name,role,max_devices,active,created_at) VALUES(?,?,?,?,?,1,?)`,
        [au, hashPassword(ap), 'Administrator', 'admin', 5, now()]);
      console.log(`Admin account "${au}" created.`);
    }
  } else if (process.env.ADMIN_RESET === '1' && ap) {
    await run(`UPDATE users SET pass_hash=?, active=1 WHERE id=?`, [hashPassword(ap), admin.id]);
    console.log('Admin password reset from ADMIN_PASSWORD (remove ADMIN_RESET now).');
  }
  console.log(`Database: ${isRemote ? 'Turso (persistent)' : url}`);
  if (!isRemote && process.env.RENDER) console.warn('WARNING: local SQLite on Render is wiped on every restart/sleep. Set TURSO_DATABASE_URL.');
}

async function getSetting(k, d) { const r = await one(`SELECT value FROM settings WHERE key=?`, [k]); return r ? r.value : d; }
async function setSetting(k, v) { await run(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [k, String(v)]); }

const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');

module.exports = { db, q, one, run, init, now, hashPassword, checkPassword, getSetting, setSetting, tokenHash, isRemote };
