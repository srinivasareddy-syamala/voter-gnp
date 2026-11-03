/* Admin panel: users, devices, settings, login history */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'voter-app' };
  const fmt = t => t ? new Date(+t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const ago = t => {
    if (!t) return 'ఎప్పుడూ లేదు · never';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'ఇప్పుడే · just now' : m < 60 ? `${m} ని. క్రితం` : m < 1440 ? `${Math.round(m / 60)} గం. క్రితం` : fmt(t);
  };

  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { location.href = '/login?e=removed'; throw new Error('auth'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
    return j;
  }
  function msg(el, text, ok) { el.innerHTML = `<span class="msg ${ok ? 'ok' : 'err'}">${esc(text)}</span>`; setTimeout(() => { if (el.textContent === text) el.innerHTML = ''; }, 5000); }

  // tabs
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    [...$('tabs').children].forEach(x => x.classList.toggle('on', x === b));
    ['users', 'log', 'settings', 'me'].forEach(t => $('t-' + t).hidden = t !== b.dataset.t);
    if (b.dataset.t === 'log') loadLog();
    if (b.dataset.t === 'settings') loadSettings();
  });

  // ---------- users ----------
  let users = [], openDevs = new Set();
  async function loadUsers() {
    users = await api('GET', '/api/admin/users');
    const act = users.filter(u => u.active).length, on = users.filter(u => u.online > 0).length;
    const devs = users.reduce((a, u) => a + Number(u.devices), 0);
    $('stats').innerHTML = [[users.length, 'మొత్తం యూజర్లు · Users'], [act, 'యాక్టివ్ · Active'], [on, 'ఇప్పుడు ఆన్‌లైన్ · Online now'], [devs, 'నమోదైన పరికరాలు · Devices']]
      .map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
    $('users').innerHTML = users.map(userCard).join('') || '<p class="note">యూజర్లు లేరు.</p>';
    for (const id of openDevs) loadDevices(id);
  }
  function userCard(u) {
    const isAdmin = u.role === 'admin';
    return `<div class="user ${u.active ? '' : 'off'}" data-id="${u.id}">
      <div class="uhead">
        <div>
          <div class="uname2"><span class="dot ${u.online > 0 ? 'on' : ''}" title="${u.online > 0 ? 'online' : 'offline'}"></span>${esc(u.full_name || u.username)}
            <small>@${esc(u.username)}</small>
            ${isAdmin ? '<span class="badge b-admin">ADMIN</span>' : ''}
            ${u.active ? '<span class="badge b-on">యాక్టివ్</span>' : '<span class="badge b-off">నిలిపివేయబడింది</span>'}
            ${u.me ? '<span class="badge b-on">మీరు · you</span>' : ''}
          </div>
          <div class="umeta">
            <span>పరికరాలు <b>${u.devices}${isAdmin ? '' : ' / ' + u.max_devices}</b>${Number(u.blocked) ? ` (+${u.blocked} బ్లాక్)` : ''}</span>
            <span>చివరి లాగిన్ <b>${ago(u.last_login)}</b></span>
            <span>సృష్టి ${fmt(u.created_at)}</span>
          </div>
        </div>
        ${isAdmin ? '<span class="note">అడ్మిన్‌కు పరికరాల పరిమితి లేదు</span>' : `
        <div class="stepper" title="Max devices"><span>గరిష్ఠ పరికరాలు</span>
          <button data-a="dec" aria-label="decrease">−</button><b>${u.max_devices}</b><button data-a="inc" aria-label="increase">+</button></div>`}
      </div>
      <div class="uacts">
        <button class="btn" data-a="devs">📱 పరికరాలు (${Number(u.devices) + Number(u.blocked)})</button>
        <button class="btn" data-a="pw">🔑 పాస్‌వర్డ్ రీసెట్</button>
        <button class="btn" data-a="kick">⏏ అన్ని చోట్ల లాగ్ అవుట్</button>
        ${u.me ? '' : `<button class="btn ${u.active ? 'warn' : ''}" data-a="toggle">${u.active ? '⛔ నిలిపివేయి · Disable' : '✅ ప్రారంభించు · Enable'}</button>
        <button class="btn warn" data-a="del">🗑 తొలగించు</button>`}
      </div>
      <div class="devs" id="devs-${u.id}" ${openDevs.has(u.id) ? '' : 'hidden'}></div>
    </div>`;
  }
  async function loadDevices(id) {
    const box = $('devs-' + id); if (!box) return;
    const ds = await api('GET', `/api/admin/users/${id}/devices`);
    box.hidden = false;
    box.innerHTML = ds.length ? ds.map(d => `<div class="dev ${d.blocked ? 'blocked' : ''}" data-dev="${d.id}" data-uid="${id}">
        <div><div class="dl"><span class="dot ${d.online > 0 ? 'on' : ''}"></span>${esc(d.label)} ${d.current ? '<span class="badge b-on">ఈ పరికరం</span>' : ''} ${d.blocked ? '<span class="badge b-off">బ్లాక్</span>' : ''}</div>
          <div class="dm">IP ${esc(d.ip || '-')} · మొదట ${fmt(d.first_seen)} · చివరిగా ${ago(d.last_seen)}</div></div>
        ${d.current ? '' : `<div style="display:flex;gap:6px">
          <button class="btn" data-d="${d.blocked ? 'unblock' : 'block'}">${d.blocked ? 'అన్‌బ్లాక్' : '🚫 బ్లాక్'}</button>
          <button class="btn warn" data-d="remove" title="Remove device and free a slot">తొలగించు</button></div>`}
      </div>`).join('') + `<p class="note">“తొలగించు” = ఆ పరికరం లాగ్ అవుట్ అయి, ఖాళీ ఏర్పడుతుంది (కొత్త ఫోన్ కోసం). “బ్లాక్” = ఆ పరికరం నుంచి మళ్ళీ లాగిన్ కాలేరు.</p>`
      : '<p class="note">ఇంకా ఏ పరికరం నుంచీ లాగిన్ కాలేదు · No devices yet.</p>';
  }

  $('users').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const card = b.closest('.user'), id = +card.dataset.id, u = users.find(x => x.id === id);
    try {
      if (b.dataset.d) {
        const dv = +b.closest('.dev').dataset.dev;
        if (b.dataset.d === 'remove') { if (!confirm('ఈ పరికరాన్ని తొలగించాలా? (Remove this device?)')) return; await api('DELETE', `/api/admin/devices/${dv}`); }
        else await api('PATCH', `/api/admin/devices/${dv}`, { blocked: b.dataset.d === 'block' });
        return loadUsers();
      }
      switch (b.dataset.a) {
        case 'devs':
          if (openDevs.has(id)) { openDevs.delete(id); $('devs-' + id).hidden = true; } else { openDevs.add(id); await loadDevices(id); }
          return;
        case 'inc': case 'dec': {
          const n = Math.max(1, Math.min(50, u.max_devices + (b.dataset.a === 'inc' ? 1 : -1)));
          if (n === u.max_devices) return;
          await api('PATCH', `/api/admin/users/${id}`, { max_devices: n }); break;
        }
        case 'pw': {
          const p = prompt(`@${u.username} కొత్త పాస్‌వర్డ్ (కనీసం 6 అక్షరాలు):`); if (!p) return;
          await api('PATCH', `/api/admin/users/${id}`, { password: p });
          alert('పాస్‌వర్డ్ మార్చబడింది. యూజర్ అన్ని పరికరాల నుంచి లాగ్ అవుట్ అయ్యారు.\nPassword changed; the user was logged out everywhere.'); break;
        }
        case 'kick': await api('POST', `/api/admin/users/${id}/logout`); alert('లాగ్ అవుట్ చేయబడింది · Logged out'); break;
        case 'toggle': await api('PATCH', `/api/admin/users/${id}`, { active: !u.active }); break;
        case 'del':
          if (!confirm(`@${u.username} ను పూర్తిగా తొలగించాలా? (Delete user?)`)) return;
          await api('DELETE', `/api/admin/users/${id}`); openDevs.delete(id); break;
      }
      await loadUsers();
    } catch (err) { if (err.message !== 'auth') alert(err.message); }
  });

  $('addForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api('POST', '/api/admin/users', f);
      msg($('addMsg'), `@${f.username} జోడించబడింది · added`, true);
      e.target.reset(); e.target.max_devices.value = defMax; loadUsers();
    } catch (err) { msg($('addMsg'), err.message, false); }
  });

  // ---------- settings ----------
  let defMax = 1;
  async function loadSettings() {
    const s = await api('GET', '/api/admin/settings');
    $('setForm').idle_minutes.value = s.idle_minutes; $('setForm').default_max_devices.value = s.default_max_devices;
    defMax = s.default_max_devices; $('addForm').max_devices.value = defMax;
    $('dbAlert').hidden = s.persistent;
  }
  $('setForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('PUT', '/api/admin/settings', Object.fromEntries(new FormData(e.target))); msg($('setMsg'), 'సేవ్ అయింది · Saved', true); loadSettings(); }
    catch (err) { msg($('setMsg'), err.message, false); }
  });

  // ---------- my password ----------
  $('meForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.password !== f.password2) return msg($('meMsg'), 'కొత్త పాస్‌వర్డ్‌లు సరిపోలలేదు · Passwords do not match', false);
    try { await api('POST', '/api/me/password', { current: f.current, password: f.password }); msg($('meMsg'), 'పాస్‌వర్డ్ మార్చబడింది · Changed', true); e.target.reset(); }
    catch (err) { msg($('meMsg'), err.message, false); }
  });

  // ---------- login log ----------
  async function loadLog() {
    const rows = await api('GET', '/api/admin/log');
    $('log').innerHTML = rows.map(r => `<tr><td>${fmt(r.at)}</td><td>${esc(r.username)}</td>
      <td>${r.ok ? '<span class="badge b-on">✓ విజయం</span>' : `<span class="badge b-off">✕</span> ${esc(r.reason)}`}</td>
      <td>${esc(r.device)}</td><td>${esc(r.ip)}</td></tr>`).join('') || '<tr><td colspan="5">—</td></tr>';
  }

  // ---------- start ----------
  api('GET', '/api/me').then(me => { $('who').textContent = '👤 ' + (me.fullName || me.username); }).catch(() => {});
  loadSettings().then(loadUsers).catch(err => alert(err.message));
  setInterval(() => { if (!$('t-users').hidden && !document.hidden) loadUsers().catch(() => {}); }, 30000);

  // keep the admin session alive while active; log out after the idle time like the main app
  let last = Date.now(), lastPing = Date.now(), act = false, idleMs = 10 * 60e3;
  api('GET', '/api/me').then(me => idleMs = me.idleMinutes * 60e3).catch(() => {});
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'].forEach(ev => document.addEventListener(ev, () => { last = Date.now(); act = true; }, { passive: true, capture: true }));
  setInterval(() => {
    if (Date.now() - last > idleMs) location.href = '/logout?r=idle';
    else if (act && Date.now() - lastPing > 60e3) { lastPing = Date.now(); act = false; fetch('/api/ping', { method: 'POST', headers: H }); }
  }, 5000);
})();
