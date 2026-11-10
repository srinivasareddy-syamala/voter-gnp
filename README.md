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
- **Password protected** (set `APP_PASSWORD`). Pages are marked `noindex`.

## Duplicate voters
Tap **👥 నకిలీ ఓటర్లు · Duplicate voters** to see entries that may be the same person listed more than once:
- **ఎక్కువ అవకాశం · Very likely** – same name and same father/husband name (spelling variants count), same gender, age within 2 years
- **మధ్యస్థ · Likely** – same as above but the ages differ by 3–15 years
- **పరిశీలించండి · Check** – same name, gender and age (±1) but a different father/husband name, or a large age gap

Each group shows the voters' cards from the PDF (with photos) side by side; tap one to open it on the page.
Filters (ward, gender, age) also apply. **⬇ Excel (CSV)** downloads the list. These are only suspected
duplicates – confirm with the photos, house numbers and a field check before acting on them.

## Auto logout
Every device (phone, laptop) is logged out after **5 minutes without activity** (typing, tapping, scrolling).
A countdown warning with a "Stay logged in" button appears in the last minute. The server also refuses any
session idle for longer than that, so closed tabs and phones in a pocket are logged out too.
To change the time, set the environment variable `IDLE_MINUTES` (e.g. `10`).

## Deploy on Railway
1. Push this folder to a **private** GitHub repo (or run `railway up` from this folder with the Railway CLI).
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo. Railway detects Node and runs `npm start`.
3. In the service's **Variables**, add:
   - `APP_PASSWORD` = the password you want users to type
   - `SESSION_SECRET` = any long random text (optional; changing it logs everyone out)
4. **Settings → Networking → Generate Domain**. Open the URL (it's HTTPS, which voice search needs).

## Run locally
```bash
npm install
APP_PASSWORD=yourpass npm start     # Windows PowerShell: $env:APP_PASSWORD="yourpass"; npm start
```
Open http://localhost:3000

## Folder layout
```
server.js            Express server + login
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
This list contains personal data and photos. Keep the repo private, use a strong `APP_PASSWORD`,
and share the link only with people who are authorised to use the roll.
