/* Ganapavaram voter search - front end */
(function () {
  const P = window.Phonetic;
  const $ = id => document.getElementById(id);
  const TE = /[ఀ-౿]/;
  const REL = { F: 'తండ్రి', H: 'భర్త', M: 'తల్లి', O: 'ఇతరులు', '': 'సంబంధి' };
  const GEN = { M: 'పు', F: 'స్త్రీ', '': '-' };
  const PAGE_SIZE = 40;

  let DB = [], PAGES = [], DICT = [], results = [], shown = 0, family = null;
  let DUPS = [], dupMode = false, dupLevel = '';
  const state = { field: 'name', voiceLang: 'te-IN' };

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const normHouse = s => String(s || '').toLowerCase().replace(/\s+/g, '');

  // ---------- load ----------
  fetch('/data/voters.json').then(r => {
    if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
    return r.json();
  }).then(d => {
    PAGES = d.pages;
    const dict = new Map();
    DB = d.voters.map(v => {
      for (const w of (v.name + ' ' + v.rel).split(/\s+/)) {
        if (!TE.test(w) || w.length < 2) continue;
        const e = dict.get(w) || { w, n: 0, k: P.key(w) };
        e.n++; dict.set(w, e);
      }
      return Object.assign(v, {
        _n: P.makeTarget(v.name), _r: P.makeTarget(v.rel),
        _nf: v.name.replace(/\s/g, ''), _rf: v.rel.replace(/\s/g, ''), _h: normHouse(v.house)
      });
    });
    DICT = [...dict.values()].filter(e => e.k);
    const wards = [...new Set(DB.map(v => v.ward))].sort((a, b) => a - b);
    $('ward').insertAdjacentHTML('beforeend', wards.map(w => `<option value="${w}">వార్డు ${w}</option>`).join(''));
    DUPS = findDuplicates(DB);
    $('dupCount').textContent = DUPS.length;
    run();
  }).catch(e => { if (e.message !== 'auth') $('meta').textContent = 'డేటా లోడ్ కాలేదు · Could not load data'; });

  // ---------- search ----------
  function filters() {
    const ward = $('ward').value, g = $('gender').value;
    const amin = +$('amin').value || 0, amax = +$('amax').value || 999;
    return v => (!ward || v.ward === ward) && (!g || v.g === g) && (v.age == null || (v.age >= amin && v.age <= amax));
  }

  function filtersActive() {
    return !!($('ward').value || $('gender').value || $('amin').value || $('amax').value);
  }
  function updateFilterBadge() {
    const n = ['ward', 'gender'].filter(id => $(id).value).length + (($('amin').value || $('amax').value) ? 1 : 0);
    $('fcount').textContent = n; $('fcount').hidden = !n;
  }

  function search(q) {
    const ok = filters();
    q = q.trim();
    if (family) return DB.filter(v => v._h === family && ok(v)).sort((a, b) => a.sl - b.sl).map(v => ({ v, s: 1 }));
    if (!q) return filtersActive() ? DB.filter(ok).sort((a, b) => a.sl - b.sl).map(v => ({ v, s: 1 })) : null;

    // voter ID / house number / serial number
    if (/\d/.test(q) && !TE.test(q)) {
      const u = q.toUpperCase().replace(/\s/g, ''), h = normHouse(q);
      const out = [];
      for (const v of DB) {
        if (!ok(v)) continue;
        let s = 0;
        if (v.epic === u) s = 3; else if (u.length >= 4 && v.epic.includes(u)) s = 2;
        if (v._h === h) s = Math.max(s, 2.5); else if (h.length >= 2 && v._h.startsWith(h)) s = Math.max(s, 1.5);
        if (/^\d+$/.test(u) && v.sl === +u) s = Math.max(s, 2.8);
        if (s) out.push({ v, s });
      }
      return out.sort((a, b) => b.s - a.s || a.v.sl - b.v.sl);
    }

    const qt = P.queryTokens(q);
    if (!qt.length) return [];
    const qte = TE.test(q) ? q.replace(/\s/g, '') : '';
    const out = [];
    for (const v of DB) {
      if (!ok(v)) continue;
      let total = 0, all = true;
      for (const t of qt) {
        let s = -1;
        if (state.field !== 'rel') s = P.tokenScore(t, v._n);
        if (state.field !== 'name') { const r = P.tokenScore(t, v._r); s = Math.max(s, r < 0 ? -1 : r * (state.field === 'both' ? 0.92 : 1)); }
        if (s < 0) { all = false; break; }
        total += s;
      }
      if (!all) continue;
      let s = total / qt.length;
      if (qte && ((state.field !== 'rel' && v._nf.includes(qte)) || (state.field !== 'name' && v._rf.includes(qte)))) s += 0.25;
      out.push({ v, s });
    }
    return out.sort((a, b) => b.s - a.s || a.v.sl - b.v.sl);
  }

  // English word -> likely Telugu spellings, taken from the names in this voter list
  function lev(a, b) {
    const m = a.length, n = b.length; let p = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
    return p[n];
  }
  function teluguFor(word) {
    const k = P.key(word); if (k.length < 2) return [];
    const lim = k.length <= 3 ? 0 : k.length <= 6 ? 1 : 2;
    const c = [];
    for (const e of DICT) {
      if (Math.abs(e.k.length - k.length) > lim) continue;
      const d = lev(k, e.k);
      if (d <= lim) c.push({ w: e.w, d, n: e.n });
    }
    return c.sort((a, b) => a.d - b.d || b.n - a.n).slice(0, 3).map(x => x.w);
  }
  function showTelugu(q) {
    const box = $('telugu');
    const words = q.trim().split(/\s+/).filter(w => /[a-zA-Z]{2,}/.test(w) && !/\d/.test(w));
    if (!words.length || family) { box.hidden = true; return; }
    const parts = words.map(w => {
      const s = teluguFor(w);
      return s.length ? s.map(t => `<span class="chip" data-from="${esc(w)}" data-to="${esc(t)}">${esc(t)}</span>`).join('')
                      : `<span class="chip" title="No Telugu match in list">${esc(w)}?</span>`;
    });
    box.innerHTML = `తెలుగులో: ${parts.join('<span style="margin:0 6px;color:#bbb">+</span>')}`;
    box.hidden = false;
  }
  $('telugu').addEventListener('click', e => {
    const c = e.target.closest('.chip[data-to]'); if (!c) return;
    const words = $('q').value.split(/(\s+)/);
    $('q').value = words.map(w => w === c.dataset.from ? c.dataset.to : w).join('');
    run();
  });

  // ---------- render ----------
  function markName(name, qt) {
    if (!qt || !qt.length) return esc(name);
    return name.split(/(\s+)/).map(w => {
      if (!w.trim()) return w;
      const k = P.key(w).replace(/ /g, '');
      const hit = k && qt.some(t => (t.length >= 3 && P.substrDist(t, k).d <= (t.length <= 6 ? 1 : 2) && k.length >= Math.min(3, t.length)) || (k.length >= 3 && t.includes(k)));
      return hit ? `<mark>${esc(w)}</mark>` : esc(w);
    }).join('');
  }

  function card(r, i, qt) {
    const v = r.v;
    const nq = state.field === 'rel' ? null : qt, rq = state.field === 'name' ? null : qt;
    return `<article class="card">
      <div><div class="nm">${markName(v.name || '(పేరు లేదు)', nq)}</div>
      <div class="rl"><i>${REL[v.rtype] || 'సంబంధి'}:</i> ${markName(v.rel, rq)}</div></div>
      <div class="sl">క్ర.సం. ${v.sl}</div>
      <div class="facts">
        <span>వయస్సు <b>${v.age ?? '-'}</b></span><span>లింగము <b>${GEN[v.g] || '-'}</b></span>
        <span>ఇంటి సం. <b>${esc(v.house)}</b></span><span>వార్డు <b>${esc(v.ward)}</b></span>
        <span class="epic">${esc(v.epic)}</span>
      </div>
      <div class="acts">
        <button class="btn pri" data-open="${i}">📄 పత్రంలో చూపించు</button>
        <button class="btn" data-house="${esc(v._h)}" data-hl="${esc(v.house)}">🏠 అదే ఇల్లు</button>
      </div>
    </article>`;
  }

  function render(more) {
    const q = $('q').value, qt = family ? [] : P.queryTokens(q);
    if (!more) shown = 0;
    const el = $('results');
    if (results === null) {
      el.innerHTML = `<div class="empty">పేరు టైప్ చేయండి లేదా 🎤 నొక్కి మాట్లాడండి.<br>
        <small>English లో టైప్ చేసినా తెలుగు పేర్లు దొరుకుతాయి – ఉదా: <i>srinivasa rao</i>, <i>lakshmi</i>, <i>SDS1805753</i></small></div>`;
      $('meta').textContent = `మొత్తం ${DB.length.toLocaleString('en-IN')} మంది ఓటర్లు · 12 వార్డులు`;
      $('more').hidden = true; return;
    }
    const banner = family ? `<div class="banner"><span>🏠 ఇంటి సంఖ్య <b>${esc(family_label)}</b> – ${results.length} మంది</span><button id="clearFam" aria-label="Clear">✕</button></div>` : '';
    const fdesc = [$('ward').value && `వార్డు ${$('ward').value}`, $('gender').value && ($('gender').value === 'F' ? 'స్త్రీలు' : 'పురుషులు'),
      ($('amin').value || $('amax').value) && `వయస్సు ${$('amin').value || 18}–${$('amax').value || '120'}`].filter(Boolean).join(' · ');
    $('meta').innerHTML = family ? '' : `${results.length} ఫలితాలు · results${fdesc ? ` <span style="color:var(--brand)">(${esc(fdesc)})</span>` : ''}`;
    if (!results.length) { el.innerHTML = banner + `<div class="empty">ఎవరూ దొరకలేదు. స్పెల్లింగ్ మార్చి / ఇంటిపేరు లేకుండా ప్రయత్నించండి.<br><small>No match – try a shorter or different spelling.</small></div>`; $('more').hidden = true; return; }
    const end = Math.min(results.length, shown + PAGE_SIZE);
    const html = results.slice(shown, end).map((r, k) => card(r, shown + k, qt)).join('');
    if (more) el.insertAdjacentHTML('beforeend', html); else el.innerHTML = banner + html;
    shown = end;
    $('more').hidden = shown >= results.length;
  }
  let family_label = '';

  let timer;
  function run() {
    if (!DB.length) return;
    if (dupMode) {
      results = dupResults(); renderDups(); $('telugu').hidden = true;
      if (isWide()) { if (results.length) openViewer(0); else closeViewer(); } else if (vi >= 0) closeViewer();
      return;
    }
    results = search($('q').value);
    render(false);
    showTelugu($('q').value);
    if (isWide()) { if (results && results.length) openViewer(0); else closeViewer(); }
    else if (vi >= 0) closeViewer();
  }
  $('q').addEventListener('input', () => { family = null; setDupMode(false); clearTimeout(timer); timer = setTimeout(run, 160); });
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(timer); run(); $('q').blur(); } });
  ['ward', 'gender', 'amin', 'amax'].forEach(id => $(id).addEventListener('change', () => { updateFilterBadge(); run(); }));
  $('fapply').addEventListener('click', () => {
    updateFilterBadge(); run();
    $('fbox').open = false;
    $('meta').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('fclear').addEventListener('click', () => {
    ['ward', 'gender', 'amin', 'amax'].forEach(id => { $(id).value = ''; });
    updateFilterBadge(); run();
  });
  $('more').addEventListener('click', () => render(true));
  // vnext may ask for more cards; in duplicate mode everything is already shown
  /* render(true) is a no-op in duplicate mode (all groups are rendered) */

  function seg(id, key) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      [...$(id).querySelectorAll('button')].forEach(x => x.classList.toggle('on', x === b));
      state[key] = b.dataset.v; if (key === 'field') run();
    });
  }
  seg('field', 'field'); seg('voiceLang', 'voiceLang');

  $('results').addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) return openViewer(+o.dataset.open);
    const h = e.target.closest('[data-house]');
    if (!h && isWide() && !e.target.closest('#clearFam')) {
      const c = e.target.closest('.card'); const b = c && c.querySelector('[data-open]');
      if (b) return openViewer(+b.dataset.open);
    }
    if (h) { setDupMode(false); family = h.dataset.house; family_label = h.dataset.hl; run(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    if (e.target.closest('#clearFam')) { family = null; run(); }
  });


  // ---------- duplicate voters ----------
  // Groups entries that look like the same person listed more than once:
  //  high   – same name + same father/husband name (spelling may differ), same gender, age within 2 years
  //  medium – same as above but age differs by 3–15 years
  //  check  – same name + relation but age differs a lot, OR same name + gender + age (±1) with a different relation
  const LEVELS = {
    high: { te: 'ఎక్కువ అవకాశం', en: 'Very likely', cls: 'lv-high' },
    medium: { te: 'మధ్యస్థ అవకాశం', en: 'Likely', cls: 'lv-med' },
    check: { te: 'పరిశీలించండి', en: 'Check', cls: 'lv-check' }
  };
  function findDuplicates(db) {
    const nk = v => P.key(v.name).replace(/ /g, ''), rk = v => P.key(v.rel).replace(/ /g, '');
    const groups = [], seenPair = new Set();
    const pairKey = g => g.map(v => v.sl).sort((a, b) => a - b).join('-');
    const byNR = new Map();
    for (const v of db) {
      if (!v.name || !v.rel) continue;
      const k = nk(v) + '|' + rk(v) + '|' + v.g;
      if (!byNR.has(k)) byNR.set(k, []); byNR.get(k).push(v);
    }
    for (const g of byNR.values()) {
      if (g.length < 2) continue;
      const ages = g.map(v => v.age ?? 0), diff = Math.max(...ages) - Math.min(...ages);
      const sameSpelling = new Set(g.map(v => v._nf + '|' + v._rf)).size === 1;
      const level = diff <= 2 ? 'high' : diff <= 15 ? 'medium' : 'check';
      groups.push({ level, members: g.sort((a, b) => a.sl - b.sl), diff,
        why: (sameSpelling ? 'ఒకే పేరు + ఒకే తండ్రి/భర్త పేరు' : 'ఒకే పేరు + ఒకే తండ్రి/భర్త పేరు (స్పెల్లింగ్ తేడా)') + ` · వయస్సు తేడా ${diff}`,
        whyEn: (sameSpelling ? 'Same name & relative' : 'Same name & relative (spelling differs)') + `, age gap ${diff}` });
      seenPair.add(pairKey(g));
    }
    // same name + gender + age (±1), different relative name
    const byN = new Map();
    for (const v of db) {
      if (!v.name || v.age == null) continue;
      const k = nk(v) + '|' + v.g;
      if (!byN.has(k)) byN.set(k, []); byN.get(k).push(v);
    }
    for (const g of byN.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => a.age - b.age);
      let cl = [g[0]];
      const flush = () => {
        if (cl.length > 1 && new Set(cl.map(rk)).size > 1 && !seenPair.has(pairKey(cl))) {
          const diff = cl[cl.length - 1].age - cl[0].age;
          groups.push({ level: 'check', members: cl.slice().sort((a, b) => a.sl - b.sl), diff,
            why: `ఒకే పేరు + ఒకే వయస్సు (${cl[0].age}${diff ? '±1' : ''}), తండ్రి/భర్త పేరు వేరు`,
            whyEn: 'Same name & age, different relative' });
        }
      };
      for (let i = 1; i < g.length; i++) { if (g[i].age - cl[cl.length - 1].age <= 1) cl.push(g[i]); else { flush(); cl = [g[i]]; } }
      flush();
    }
    const order = { high: 0, medium: 1, check: 2 };
    groups.sort((a, b) => order[a.level] - order[b.level] || a.diff - b.diff || a.members[0].sl - b.members[0].sl);
    groups.forEach((g, i) => g.no = i + 1);
    return groups;
  }
  function visibleDups() {
    const ok = filters();
    return DUPS.filter(g => (!dupLevel || g.level === dupLevel) && g.members.some(ok));
  }
  function dupResults() { return visibleDups().flatMap(g => g.members.map(v => ({ v, s: 1, g }))); }
  function setDupMode(on) {
    dupMode = on; $('dupBtn').classList.toggle('on', on);
    if (on) { family = null; $('q').value = ''; }
  }
  function cropCss(v) {
    const pg = PAGES[v.page - 1] || { w: 595, h: 842 }, [bx, by, bw, bh] = v.box, pad = 0.004;
    const cx = Math.max(0, bx - pad), cy = Math.max(0, by - pad), cw = Math.min(1 - cx, bw + 2 * pad), ch = Math.min(1 - cy, bh + 2 * pad);
    return `aspect-ratio:${(cw * pg.w).toFixed(1)}/${(ch * pg.h).toFixed(1)};background-size:${(100 / cw).toFixed(3)}% auto;` +
      `background-position:${((cx / (1 - cw)) * 100).toFixed(3)}% ${((cy / (1 - ch)) * 100).toFixed(3)}%`;
  }
  let thumbObs = null;
  function renderDups() {
    const el = $('results'), gs = visibleDups();
    const cnt = l => DUPS.filter(g => g.level === l).length;
    const people = gs.reduce((a, g) => a + g.members.length, 0);
    $('meta').innerHTML = `👥 ${gs.length} గుంపులు · ${people} ఎంట్రీలు <span style="color:var(--muted)">(duplicate groups · entries)</span>`;
    let i = 0;
    el.innerHTML = `<div class="dupbar">
        <div class="duptitle"><b>నకిలీ ఓటర్ల జాబితా</b> · Possible duplicate voters <button id="dupClose" class="dupx" aria-label="Close">✕</button></div>
        <div class="dupchips">
          <button data-lv="" class="${dupLevel ? '' : 'on'}">అన్నీ · All (${DUPS.length})</button>
          ${Object.entries(LEVELS).map(([k, L]) => `<button data-lv="${k}" class="${dupLevel === k ? 'on' : ''}"><span class="lvdot ${L.cls}"></span>${L.te} (${cnt(k)})</button>`).join('')}
        </div>
        <div class="dupacts"><button id="dupCsv" class="btn">⬇ Excel (CSV) డౌన్‌లోడ్</button>
          <span class="note">ఇవి అనుమానిత ఎంట్రీలు మాత్రమే – ఫోటోలు, ఇంటి సంఖ్య చూసి నిర్ధారించండి.</span></div>
      </div>` +
      (gs.length ? gs.map(g => `<div class="dgroup ${LEVELS[g.level].cls}">
        <div class="dhead"><span class="dno">#${g.no}</span><span class="lvbadge ${LEVELS[g.level].cls}">${LEVELS[g.level].te} · ${LEVELS[g.level].en}</span>
          <span class="dwhy">${esc(g.why)}</span></div>
        <div class="dmembers">${g.members.map(v => { const k = i++; return `<div class="dmem">
          <div class="thumb" data-thumb="${k}" style="${cropCss(v)}" title="పత్రంలో చూపించు"></div>${card({ v }, k, [])}</div>`; }).join('')}</div>
      </div>`).join('') : '<div class="empty">ఈ ఫిల్టర్‌తో నకిలీలు లేవు · No duplicates for this filter.</div>');
    shown = results.length; $('more').hidden = true;
    // load page images for the photo thumbnails only when they scroll into view
    if (thumbObs) thumbObs.disconnect();
    thumbObs = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return; const t = e.target, r = results[+t.dataset.thumb];
      if (r) t.style.backgroundImage = `url("/data/pages/${r.v.page}.webp")`; thumbObs.unobserve(t);
    }), { rootMargin: '300px' }) : null;
    el.querySelectorAll('.thumb').forEach(t => thumbObs ? thumbObs.observe(t) : (t.style.backgroundImage = `url("/data/pages/${results[+t.dataset.thumb].v.page}.webp")`));
  }
  function exportDupsCsv() {
    const rows = [['Group', 'Level', 'Reason', 'Serial No', 'Name', 'Relation', 'Relative name', 'Age', 'Gender', 'House No', 'Ward', 'Voter ID (EPIC)', 'Page']];
    for (const g of visibleDups()) for (const v of g.members)
      rows.push([g.no, LEVELS[g.level].en, g.whyEn, v.sl, v.name, REL[v.rtype] || '', v.rel, v.age ?? '', v.g === 'F' ? 'F' : v.g === 'M' ? 'M' : '', v.house, v.ward, v.epic, v.page]);
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `duplicate_voters_ganapavaram${dupLevel ? '_' + dupLevel : ''}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  $('dupBtn').addEventListener('click', () => { setDupMode(!dupMode); run(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('results').addEventListener('click', e => {
    if (!dupMode) return;
    const lv = e.target.closest('[data-lv]'); if (lv) { dupLevel = lv.dataset.lv; return run(); }
    if (e.target.closest('#dupClose')) { setDupMode(false); return run(); }
    if (e.target.closest('#dupCsv')) return exportDupsCsv();
    const t = e.target.closest('[data-thumb]'); if (t) return openViewer(+t.dataset.thumb);
  });

  // ---------- document viewer with highlight ----------
  // phones: full-screen viewer; laptops/desktops (>=1000px): fixed side panel on the right
  const wideMQ = window.matchMedia('(min-width:1000px)');
  const isWide = () => wideMQ.matches;
  let vi = -1, zoom = 1;
  function setEmpty(on) { $('viewer').classList.toggle('empty', on); }
  function scrollToHl(smooth) {
    const vb = $('vbody'), pw = $('pagewrap'), hl = $('hl');
    const hr = hl.getBoundingClientRect(), vr = vb.getBoundingClientRect(), pr = pw.getBoundingClientRect();
    vb.scrollTo({ top: vb.scrollTop + hr.top - vr.top - vb.clientHeight / 2 + hr.height / 2, behavior: smooth ? 'smooth' : 'auto' });
    pw.scrollLeft += hr.left - pr.left - pw.clientWidth / 2 + hr.width / 2;
  }
  function markActive(scrollList) {
    document.querySelectorAll('.card.active').forEach(c => c.classList.remove('active'));
    const b = document.querySelector(`[data-open="${vi}"]`);
    if (b) { const c = b.closest('.card'); c.classList.add('active'); if (scrollList && isWide()) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  function syncLayout() {
    if (isWide()) { $('viewer').hidden = false; document.body.style.overflow = ''; if (vi < 0) setEmpty(true); }
    else { setEmpty(false); if (vi < 0) $('viewer').hidden = true; }
  }
  wideMQ.addEventListener ? wideMQ.addEventListener('change', syncLayout) : wideMQ.addListener(syncLayout);
  function openViewer(i, scrollList) {
    if (!results || !results[i]) return;
    vi = i; setEmpty(false); const v = results[i].v; const pg = PAGES[v.page - 1] || { w: 595, h: 842 };
    const [bx, by, bw, bh] = v.box, src = `/data/pages/${v.page}.webp`;
    $('vname').textContent = v.name || '(పేరు లేదు)';
    $('vsub').textContent = `క్ర.సం. ${v.sl} · ${v.epic} · వార్డు ${v.ward}`;
    $('vpage').textContent = `పేజీ ${v.page} / ${PAGES.length}  ·  ఫలితం ${i + 1} / ${results.length}`;
    // zoomed crop of the voter's box
    const pad = 0.006, cx = Math.max(0, bx - pad), cy = Math.max(0, by - pad), cw = Math.min(1 - cx, bw + 2 * pad), ch = Math.min(1 - cy, bh + 2 * pad);
    const crop = $('crop');
    crop.style.aspectRatio = `${cw * pg.w} / ${ch * pg.h}`;
    crop.style.backgroundImage = `url("${src}")`;
    crop.style.backgroundSize = `${100 / cw}% auto`;
    crop.style.backgroundPosition = `${cw < 1 ? (cx / (1 - cw)) * 100 : 0}% ${ch < 1 ? (cy / (1 - ch)) * 100 : 0}%`;
    // full page with highlight rectangle
    const hl = $('hl');
    Object.assign(hl.style, { left: bx * 100 + '%', top: by * 100 + '%', width: bw * 100 + '%', height: bh * 100 + '%' });
    hl.style.animation = 'none'; void hl.offsetWidth; hl.style.animation = '';
    const img = $('pimg');
    img.onload = () => setTimeout(() => scrollToHl(true), 60);
    if (img.getAttribute('src') !== src) img.src = src; else img.onload();
    $('vprev').disabled = i <= 0; $('vnext').disabled = i >= results.length - 1;
    $('viewer').hidden = false;
    $('vbody').scrollTop = 0;
    markActive(scrollList);
    if (!isWide()) {
      document.body.style.overflow = 'hidden';
      if (!history.state || !history.state.viewer) history.pushState({ viewer: 1 }, '');
    }
  }
  function closeViewer() {
    vi = -1; document.body.style.overflow = '';
    document.querySelectorAll('.card.active').forEach(c => c.classList.remove('active'));
    if (isWide()) setEmpty(true); else $('viewer').hidden = true;
  }
  $('vclose').addEventListener('click', () => { if (!isWide() && history.state && history.state.viewer) history.back(); else closeViewer(); });
  window.addEventListener('popstate', () => { if (!isWide() && !$('viewer').hidden) closeViewer(); });
  $('vprev').addEventListener('click', () => vi > 0 && openViewer(vi - 1, true));
  $('vnext').addEventListener('click', () => {
    if (vi < results.length - 1) { if (!dupMode && vi + 1 >= shown) render(true); openViewer(vi + 1, true); }
  });
  function setZoom(z) { zoom = Math.max(1, Math.min(3, z)); $('page').style.width = `min(${900 * zoom}px, ${96 * zoom}vw)`; setTimeout(() => scrollToHl(false), 200); }
  $('zin').addEventListener('click', () => setZoom(zoom + 0.5));
  $('zout').addEventListener('click', () => setZoom(zoom - 0.5));
  document.addEventListener('keydown', e => {
    if (vi < 0 || e.target === $('q')) return;
    if (e.key === 'Escape') $('vclose').click();
    if (e.key === 'ArrowRight') $('vnext').click();
    if (e.key === 'ArrowLeft') $('vprev').click();
  });

  // ---------- voice search (Web Speech API) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('mic'), vs = $('voiceStatus');
  let rec = null, listening = false;
  function status(t) { vs.textContent = t; vs.hidden = !t; }
  mic.addEventListener('click', () => {
    if (!SR) { status('ఈ బ్రౌజర్‌లో వాయిస్ సపోర్ట్ లేదు – Android/Desktop లో Chrome వాడండి.'); return; }
    if (listening) { rec && rec.stop(); return; }
    rec = new SR();
    rec.lang = state.voiceLang; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    rec.onstart = () => { listening = true; mic.classList.add('listening'); status(state.voiceLang === 'te-IN' ? '🎤 వింటున్నాను… పేరు చెప్పండి' : '🎤 Listening… say the name'); };
    rec.onresult = e => {
      let t = ''; for (let k = 0; k < e.results.length; k++) t += e.results[k][0].transcript;
      $('q').value = t.replace(/[.,!?।]/g, ' ').trim(); family = null; run();
    };
    rec.onerror = e => status(e.error === 'not-allowed' ? 'మైక్ అనుమతి ఇవ్వండి (Allow microphone).' : e.error === 'no-speech' ? 'ఏమీ వినిపించలేదు – మళ్ళీ ప్రయత్నించండి.' : 'వాయిస్ లోపం: ' + e.error);
    rec.onend = () => { listening = false; mic.classList.remove('listening'); if (vs.textContent.startsWith('🎤')) status(''); };
    try { rec.start(); } catch (err) { status('వాయిస్ ప్రారంభం కాలేదు.'); }
  });
  syncLayout();
  if (!SR) mic.title = 'Voice search needs Chrome / Edge';

  // ---------- auto logout after inactivity (5 min by default, set by the server) ----------
  (function autoLogout() {
    let idleMs = 5 * 60e3, lastActive = Date.now(), lastPing = Date.now(), activeSincePing = false, warned = false;
    fetch('/api/session').then(r => r.ok ? r.json() : null).then(j => { if (j && j.idleMinutes) idleMs = j.idleMinutes * 60e3; }).catch(() => {});
    const activity = () => { if (warned) return; lastActive = Date.now(); activeSincePing = true; };
    ['pointerdown', 'keydown', 'touchstart', 'wheel', 'input'].forEach(ev => document.addEventListener(ev, activity, { passive: true, capture: true }));
    let mm = 0; document.addEventListener('mousemove', () => { const t = Date.now(); if (t - mm > 5000) { mm = t; activity(); } }, { passive: true });
    function ping() {
      lastPing = Date.now(); activeSincePing = false;
      fetch('/api/ping', { method: 'POST' }).then(r => { if (r.status === 401) location.href = '/login?e=idle'; }).catch(() => {});
    }
    function tick() {
      const left = idleMs - (Date.now() - lastActive);
      if (left <= 0) { location.href = '/logout?r=idle'; return; }
      if (left <= Math.min(60e3, idleMs / 4)) { warned = true; $('idleWarn').hidden = false; $('idleSec').textContent = Math.ceil(left / 1000); }
      if (activeSincePing && Date.now() - lastPing > Math.min(60e3, idleMs / 3)) ping();
    }
    $('idleStay').addEventListener('click', () => { warned = false; $('idleWarn').hidden = true; lastActive = Date.now(); ping(); });
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  })();
})();
