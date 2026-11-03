# ఓటరు శోధన · Ganapavaram Voter Search

Search the Ganapavaram GP voter list (2026, 3,126 voters, 12 wards) by **Telugu, English or voice**.
Click a result and the original PDF page opens with that voter's box highlighted.

## Features
- Type in **English** ("srinivasa rao", "kandula srinivas") or **Telugu** (శ్రీనివాసరావు): both are matched by sound,
  so spelling variations (Sreenivas / Srinivas, Reddy / Redi, Venkateswara / Venkateshwar) and words in any order work.
- English words are shown converted to **Telugu spellings found in the list** (tap one to search with it).
- **Voice search** (🎤) in Telugu or English, using the browser's speech recognition (Chrome / Edge / Android Chrome).
- Search by **voter ID** (SDS1805753), **house number** (1-2/A) or **serial number**.
- Search in voter name, father/husband name, or both. Filters: ward, gender, age.
- **Same house** button lists the whole household.
- **User accounts** stored in SQLite: an admin creates users and sets how many devices each can use.
- **Device control**: each browser/phone is registered on first login; over the limit, login is refused until the
  admin removes an old device or raises the limit. Admin can block a device, log a user out everywhere, disable or delete users.
- **Auto logout** after 10 minutes without activity (warning in the last minute). The admin can change the minutes.
- **Login history** (who, when, which device, IP, success/failure). Pages are marked `noindex`.

## Environment variables
| Variable | Purpose |
|---|---|
| `ADMIN_USERNAME` | Admin login name (default `admin`) |
| `ADMIN_PASSWORD` | Creates the admin account on first start |
| `ADMIN_RESET` | Set to `1` once to reset the admin password to `ADMIN_PASSWORD`, then remove it |
| `TURSO_DATABASE_URL` | `libsql://…` – hosted SQLite so users/devices survive restarts (needed on Render Free) |
| `TURSO_AUTH_TOKEN` | Token for the Turso database |

`APP_PASSWORD` and `SESSION_SECRET` from the earlier version are no longer used – delete them.

## Database (important on Render Free)
Render Free wipes local files on every restart, redeploy and sleep, so a local SQLite file would lose all users.
Use **Turso** (free hosted SQLite):
1. Sign up at https://turso.tech (GitHub login) → **Create Database** (pick the region closest to India, e.g. Mumbai).
2. Open the database → copy the **URL** (`libsql://...`) → **Create Token** and copy it.
3. In Render → service → **Environment**: add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, plus `ADMIN_PASSWORD`.
4. Redeploy. Logs should say `Database: Turso (persistent)` and `Admin account "admin" created.`

Without Turso the app still runs locally with `db/app.db` (ignored by git).

## Deploy on Render
New → Web Service → repo → Runtime **Node**, Build `npm install`, Start `npm start`, Health check `/healthz`,
then add the environment variables above.

## Admin panel
Log in as admin → **⚙ అడ్మిన్** (or open `/admin`):
- **Users**: add users (username, password, max devices), +/− device limit, reset password, log out everywhere, disable/enable, delete.
- **📱 Devices** under each user: see phone/browser, IP, last used; **Remove** (frees a slot, e.g. new phone) or **Block**.
- **Settings**: auto-logout minutes, default device limit for new users.
- **Logins**: last 200 login attempts.

## Run locally
```bash
npm install
ADMIN_PASSWORD=yourpass npm start   # Windows PowerShell: $env:ADMIN_PASSWORD="yourpass"; npm start
```
Open http://localhost:3000

## Folder layout
```
server.js            Express server, login, admin API
db.js                SQLite (local file or Turso)
public/              Web app (index.html, app.js, phonetic.js, style.css, fonts)
data/voters.json     Extracted voter records with box positions
data/pages/N.webp    Page images used for the highlighted view
tools/               Python scripts to rebuild data from a new PDF
```

## Updating with a new / another village PDF
```bash
pip install -r tools/requirements.txt
python tools/extract.py NEW.pdf data          # writes data/voters.json
python tools/render_pages.py NEW.pdf data/pages
```
Check the count printed by `extract.py`. The extractor expects the same AP SEC GP voter-list layout
(3 × 9 boxes per page). Also update the village name in `public/index.html` and `public/login.html`.

## Privacy
This list contains personal data and photos. Keep the repo private, use strong passwords,
and share the link only with people who are authorised to use the roll.
