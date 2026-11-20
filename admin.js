import { sb, BRAND, DEFAULTS, applyBrand, configured, toast, photoUrl, fmtDate, esc, pad3 } from './common.js';

applyBrand();

const main = document.getElementById('main');
const nav = document.getElementById('nav');
let session = null;

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.3C1.2 8.4 3 5 6.4 5c2 0 3.6 1.1 5.6 3.2C14 6.1 15.6 5 17.6 5 21 5 22.8 8.4 21.5 11.7 19.5 16.4 12 21 12 21z"/></svg>';
const TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

/* ---------------- helpers ---------------- */
function randomSlug(len) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < len) {
    const arr = new Uint8Array(len * 2);
    crypto.getRandomValues(arr);
    for (const b of arr) { if (b < limit && out.length < len) out += alphabet[b % alphabet.length]; }
  }
  return out;
}
function randomPin() {
  const a = new Uint32Array(1);
  do { crypto.getRandomValues(a); } while (a[0] >= 4294000000);
  return String(a[0] % 1000000).padStart(6, '0');
}
const galleryUrl = (slug) => new URL('index.html', location.href).href.split('#')[0] + '?g=' + slug;
const dateInput = (iso) => {
  const d = new Date(iso);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const endOfDay = (yyyy_mm_dd) => new Date(yyyy_mm_dd + 'T23:59:59').toISOString();
function statusOf(g) {
  const ms = new Date(g.expires_at) - Date.now();
  if (ms < 0) return 'expired';
  if (ms < 14 * 86400000) return 'expiring';
  return 'active';
}
const pill = (s) => ({ active: '<span class="pill ok">Active</span>', expiring: '<span class="pill warn">Expiring soon</span>', expired: '<span class="pill off">Expired</span>' }[s]);
function inviteText(g) {
  return 'Hello ' + g.client_name + ',\n\nYour private gallery from ' + BRAND.name + ' is ready.\n\nLink: ' + galleryUrl(g.slug) + '\nPIN: ' + g.pin + '\n\nIt is available until ' + fmtDate(g.expires_at) + '.';
}
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg || 'Copied'); }
  catch { window.prompt('Copy this:', text); }
}
async function shareInvite(g) {
  const text = inviteText(g);
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copy(text, 'Invite copied');
}
function fail(error) {
  main.innerHTML = '<div class="page"><p class="err">Something went wrong: ' + esc(error.message || error) + '</p></div>';
}
function setNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
}

/* ---------------- boot & auth ---------------- */
async function boot() {
  nav.hidden = true;
  if (!session) return viewLogin();
  const { data: ok } = await sb.rpc('is_admin');
  if (ok !== true) return viewNotAdmin();
  nav.hidden = false;
  route();
}

if (!configured()) {
  main.innerHTML = '<div class="page"><div class="login"><h1>Almost there</h1><p class="note">Open <b>config.js</b> and paste your Supabase Project URL and anon key, then reload this page.</p></div></div>';
} else {
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((_evt, s) => {
    const was = !!session;
    session = s;
    if (!!s !== was) boot();
  });
  boot();
}

document.getElementById('signout').addEventListener('click', async () => { await sb.auth.signOut(); });
window.addEventListener('hashchange', () => { if (session && !nav.hidden) route(); });

function viewLogin() {
  main.innerHTML = `
    <div class="page"><form id="login" class="login">
      <div class="kicker">Administrator</div>
      <h1>Sign in</h1>
      <div class="field"><label for="em">Email</label><input id="em" class="input" type="email" autocomplete="email" autocapitalize="none" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" class="input" type="password" autocomplete="current-password" required></div>
      <p id="lerr" class="err"></p>
      <button class="btn primary" style="min-height:54px" type="submit">Sign in</button>
    </form></div>`;
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: document.getElementById('em').value.trim(), password: document.getElementById('pw').value });
    btn.disabled = false;
    if (error) document.getElementById('lerr').textContent = (error.message || 'Sign-in failed') + (error.status ? ' (' + error.status + ')' : '');
  });
}
function viewNotAdmin() {
  nav.hidden = false;
  nav.querySelectorAll('a').forEach((a) => (a.hidden = true));
  main.innerHTML = '<div class="page"><div class="login"><h1>No access</h1><p class="note">This account is not the studio administrator. Sign out and use the account you created first in Supabase.</p></div></div>';
}

/* ---------------- router ---------------- */
function route() {
  nav.querySelectorAll('a').forEach((a) => (a.hidden = false));
  const h = location.hash || '#/';
  window.scrollTo(0, 0);
  if (h === '#/new') { setNav('new'); return viewNew(); }
  const m = h.match(/^#\/g\/([0-9a-f-]{36})$/);
  if (m) { setNav('list'); return viewDetail(m[1]); }
  setNav('list');
  viewList();
}

/* ---------------- list ---------------- */
let galleries = [];
let listFilter = 'all';
let listQuery = '';

async function viewList() {
  main.innerHTML = '<div class="page muted">Loading…</div>';
  const { data, error } = await sb.from('galleries').select('*, photos(count), favourites(count)').order('created_at', { ascending: false });
  if (error) return fail(error);
  galleries = data.map((g) => ({
    ...g,
    nPhotos: (g.photos && g.photos[0] && g.photos[0].count) || 0,
    nFavs: (g.favourites && g.favourites[0] && g.favourites[0].count) || 0,
    status: statusOf(g),
  }));
  const count = (s) => galleries.filter((g) => g.status === s).length;
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><div class="kicker" style="margin-bottom:10px">Administrator</div><h1>Galleries</h1></div>
        <a class="btn primary" href="#/new">+ New gallery</a>
      </div>
      <div class="stats">
        <div class="stat"><div class="label">Active</div><div class="n">${count('active') + count('expiring')}</div></div>
        <div class="stat"><div class="label">Expiring in 14 days</div><div class="n" style="color:var(--accent)">${count('expiring')}</div></div>
        <div class="stat"><div class="label">Photos</div><div class="n">${galleries.reduce((a, g) => a + g.nPhotos, 0)}</div></div>
        <div class="stat"><div class="label">Favourites chosen</div><div class="n">${galleries.reduce((a, g) => a + g.nFavs, 0)}</div></div>
      </div>
      <div class="filters">
        <input id="q" class="input" type="search" placeholder="Search client or title" value="${esc(listQuery)}" aria-label="Search galleries">
        ${['all', 'active', 'expiring', 'expired'].map((f) => `<button class="chip${listFilter === f ? ' on' : ''}" data-f="${f}">${f}</button>`).join('')}
      </div>
      <div id="rows" class="rows"></div>
    </div>`;
  paintRows();
  document.getElementById('q').addEventListener('input', (e) => { listQuery = e.target.value; paintRows(); });
  main.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    listFilter = b.dataset.f;
    main.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
    paintRows();
  }));
}

function paintRows() {
  const q = listQuery.trim().toLowerCase();
  const list = galleries.filter((g) =>
    (listFilter === 'all' || g.status === listFilter) &&
    (!q || (g.title + ' ' + g.client_name).toLowerCase().includes(q)));
  const box = document.getElementById('rows');
  if (!list.length) {
    box.innerHTML = '<div class="row muted">' + (galleries.length ? 'No galleries match.' : 'No galleries yet. Tap “+ New gallery” to create your first.') + '</div>';
    return;
  }
  box.innerHTML = list.map((g) => `
    <div class="row">
      <a class="row-link" href="#/g/${g.id}">
        <div><div class="row-title">${esc(g.title)}</div><div class="row-sub">${esc(g.client_name)}</div></div>
        <div class="row-meta">
          <span>${g.nPhotos} photos</span><span>♥ ${g.nFavs}</span>
          <span>PIN ${esc(g.pin)}</span><span>Expires ${esc(fmtDate(g.expires_at))}</span>${pill(g.status)}
        </div>
      </a>
      <div class="row-actions">
        <button class="btn small" data-invite="${g.id}">Copy invite</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('[data-invite]').forEach((b) => b.addEventListener('click', () => {
    const g = galleries.find((x) => x.id === b.dataset.invite);
    copy(inviteText(g), 'Invite copied');
  }));
}

/* ---------------- new gallery ---------------- */
function viewNew() {
  const def = new Date(Date.now() + DEFAULTS.expiryDays * 86400000);
  main.innerHTML = `
    <div class="page">
      <a class="back" href="#/">← All galleries</a>
      <div class="page-head"><h1>New gallery</h1></div>
      <form id="nf" class="card" style="max-width:640px">
        <div style="display:flex;flex-direction:column;gap:20px">
          <div class="field"><label for="cn">Client name</label><input id="cn" class="input" required placeholder="e.g. Adaeze &amp; Tobi"></div>
          <div class="field"><label for="gt">Gallery title</label><input id="gt" class="input" required placeholder="e.g. Wedding"></div>
          <div class="field"><label for="ed">Event date (optional)</label><input id="ed" class="input" type="date"></div>
          <div class="field"><label for="ex">Expiry date</label><input id="ex" class="input" type="date" required value="${dateInput(def)}"></div>
          <label class="check"><input id="dl" type="checkbox" checked> Allow client downloads</label>
          <p id="nerr" class="err"></p>
          <button class="btn primary" style="min-height:54px" type="submit">Create gallery</button>
          <p class="note">A private link and a 6-digit PIN are created automatically. You’ll add photos on the next screen.</p>
        </div>
      </form>
    </div>`;
  document.getElementById('nf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    const row = {
      slug: randomSlug(12),
      pin: randomPin(),
      client_name: document.getElementById('cn').value.trim(),
      title: document.getElementById('gt').value.trim(),
      event_date: document.getElementById('ed').value || null,
      expires_at: endOfDay(document.getElementById('ex').value),
      downloads_enabled: document.getElementById('dl').checked,
    };
    const { data, error } = await sb.from('galleries').insert(row).select().single();
    if (error) { btn.disabled = false; document.getElementById('nerr').textContent = error.message; return; }
    toast('Gallery created');
    location.hash = '#/g/' + data.id;
  });
}

/* ---------------- gallery detail ---------------- */
async function viewDetail(id) {
  main.innerHTML = '<div class="page muted">Loading…</div>';
  const [g, ph, fv] = await Promise.all([
    sb.from('galleries').select('*').eq('id', id).single(),
    sb.from('photos').select('*').eq('gallery_id', id).order('position').order('created_at'),
    sb.from('favourites').select('photo_id').eq('gallery_id', id),
  ]);
  if (g.error) return fail(g.error);
  if (ph.error) return fail(ph.error);
  const gal = g.data;
  const photos = ph.data;
  const favIds = new Set((fv.data || []).map((f) => f.photo_id));
  let favOnly = false;

  const render = () => {
    const status = statusOf(gal);
    main.innerHTML = `
    <div class="page">
      <a class="back" href="#/">← All galleries</a>
      <div class="page-head">
        <div><div class="kicker" style="margin-bottom:10px">${esc(gal.client_name)}</div><h1>${esc(gal.title)}</h1></div>
        ${pill(status)}
      </div>

      <section class="card">
        <h2>Share with client</h2>
        <div class="grid2">
          <div class="field"><span class="label">Private link</span><input id="lnk" class="copybox" readonly value="${esc(galleryUrl(gal.slug))}"></div>
          <div class="field"><span class="label">PIN</span><div class="pin-big">${esc(gal.pin)}</div></div>
        </div>
        <div class="btn-row">
          <button id="b-share" class="btn primary">Share invite</button>
          <button id="b-copyinv" class="btn">Copy invite</button>
          <button id="b-copylink" class="btn">Copy link</button>
          <button id="b-newpin" class="btn">New PIN</button>
          <a class="btn" href="${esc(galleryUrl(gal.slug))}" target="_blank" rel="noopener">Preview</a>
        </div>
      </section>

      <section class="card">
        <h2>Photos <span class="muted" style="font-size:20px">· ${photos.length} · ♥ ${favIds.size}</span></h2>
        <input id="file" type="file" accept="image/*" multiple hidden>
        <div class="btn-row" style="margin-top:0">
          <button id="b-upload" class="btn primary">+ Add photos</button>
          <button id="b-favonly" class="btn${favOnly ? ' primary' : ''}">${favOnly ? 'Showing favourites' : 'Show favourites only'}</button>
          <button id="b-favcopy" class="btn" ${favIds.size ? '' : 'disabled'}>Copy favourite numbers</button>
        </div>
        <div id="upstat" class="progress-note" aria-live="polite"></div>
        <div class="bar" id="upbar" hidden><i></i></div>
        <div class="agrid">
          ${photos.map((p, i) => ({ p, i })).filter(({ p }) => !favOnly || favIds.has(p.id)).map(({ p, i }) => `
            <div class="athumb">
              <img loading="lazy" alt="Photo ${i + 1}" src="${esc(photoUrl(p.thumb_path || p.path))}">
              <span class="tag">${pad3(i + 1)}</span>
              ${favIds.has(p.id) ? '<span class="heart">' + HEART + '</span>' : ''}
              <button class="del" data-del="${p.id}" aria-label="Delete photo ${i + 1}">${TRASH}</button>
            </div>`).join('') || '<p class="muted">' + (favOnly ? 'No favourites yet.' : 'No photos yet. Tap “+ Add photos”.') + '</p>'}
        </div>
      </section>

      <section class="card">
        <h2>Settings</h2>
        <div class="grid2">
          <div class="field"><label for="s-client">Client name</label><input id="s-client" class="input" value="${esc(gal.client_name)}"></div>
          <div class="field"><label for="s-title">Gallery title</label><input id="s-title" class="input" value="${esc(gal.title)}"></div>
          <div class="field"><label for="s-date">Event date</label><input id="s-date" class="input" type="date" value="${esc(gal.event_date || '')}"></div>
          <div class="field"><label for="s-exp">Expiry date</label><input id="s-exp" class="input" type="date" value="${dateInput(gal.expires_at)}"></div>
        </div>
        <label class="check"><input id="s-dl" type="checkbox" ${gal.downloads_enabled ? 'checked' : ''}> Allow client downloads</label>
        <div class="btn-row">
          <button id="b-save" class="btn primary">Save changes</button>
          <button id="b-ext" class="btn">Extend 30 days</button>
        </div>
      </section>

      <section class="card" style="border-color:rgba(232,151,143,.35)">
        <h2>Delete gallery</h2>
        <p class="note">Permanently removes this gallery, its photos and the client’s favourites.</p>
        <div class="btn-row"><button id="b-del" class="btn danger">Delete gallery</button></div>
      </section>
    </div>`;
    wire();
  };

  const reload = () => viewDetail(id);

  function wire() {
    const $ = (s) => document.getElementById(s);
    $('lnk').addEventListener('focus', (e) => e.target.select());
    $('b-share').addEventListener('click', () => shareInvite(gal));
    $('b-copyinv').addEventListener('click', () => copy(inviteText(gal), 'Invite copied'));
    $('b-copylink').addEventListener('click', () => copy(galleryUrl(gal.slug), 'Link copied'));
    $('b-newpin').addEventListener('click', async () => {
      if (!confirm('Create a new PIN? The old PIN will stop working.')) return;
      const { error } = await sb.from('galleries').update({ pin: randomPin() }).eq('id', gal.id);
      if (error) return toast(error.message);
      toast('New PIN created');
      reload();
    });
    $('b-favonly').addEventListener('click', () => { favOnly = !favOnly; render(); });
    $('b-favcopy').addEventListener('click', () => {
      const nums = photos.map((p, i) => (favIds.has(p.id) ? pad3(i + 1) : null)).filter(Boolean);
      copy(gal.client_name + ' — favourites: ' + nums.join(', '), 'Favourite numbers copied');
    });
    $('b-save').addEventListener('click', async () => {
      const upd = {
        client_name: $('s-client').value.trim(),
        title: $('s-title').value.trim(),
        event_date: $('s-date').value || null,
        expires_at: endOfDay($('s-exp').value),
        downloads_enabled: $('s-dl').checked,
      };
      if (!upd.client_name || !upd.title || !$('s-exp').value) return toast('Please fill in name, title and expiry.');
      const { error } = await sb.from('galleries').update(upd).eq('id', gal.id);
      if (error) return toast(error.message);
      toast('Saved');
      reload();
    });
    $('b-ext').addEventListener('click', async () => {
      const base = Math.max(Date.now(), new Date(gal.expires_at).getTime());
      const next = new Date(base + 30 * 86400000);
      const { error } = await sb.from('galleries').update({ expires_at: endOfDay(dateInput(next.toISOString())) }).eq('id', gal.id);
      if (error) return toast(error.message);
      toast('Extended by 30 days');
      reload();
    });
    $('b-upload').addEventListener('click', () => $('file').click());
    $('file').addEventListener('change', (e) => upload([...e.target.files]));
    main.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this photo?')) return;
      const p = photos.find((x) => x.id === b.dataset.del);
      await sb.storage.from('photos').remove([p.path, p.thumb_path].filter(Boolean));
      const { error } = await sb.from('photos').delete().eq('id', p.id);
      if (error) return toast(error.message);
      toast('Photo deleted');
      reload();
    }));
    $('b-del').addEventListener('click', async () => {
      if (!confirm('Delete "' + gal.title + '" and all of its photos? This cannot be undone.')) return;
      const paths = photos.flatMap((p) => [p.path, p.thumb_path]).filter(Boolean);
      for (let i = 0; i < paths.length; i += 100) await sb.storage.from('photos').remove(paths.slice(i, i + 100));
      const { error } = await sb.from('galleries').delete().eq('id', gal.id);
      if (error) return toast(error.message);
      toast('Gallery deleted');
      location.hash = '#/';
    });
  }

  async function toJpeg(bmp, edge, quality) {
    const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not process the image');
    return { blob, w, h };
  }

  async function upload(files) {
    if (!files.length) return;
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const stat = document.getElementById('upstat');
    const bar = document.getElementById('upbar');
    const fill = bar.querySelector('i');
    document.getElementById('b-upload').disabled = true;
    bar.hidden = false;
    let ok = 0, bad = 0;
    const basePos = photos.length ? Math.max(...photos.map((p) => p.position)) + 1 : 0;
    for (let n = 0; n < files.length; n++) {
      stat.textContent = 'Uploading ' + (n + 1) + ' of ' + files.length + '… keep this screen open';
      fill.style.width = (n / files.length) * 100 + '%';
      try {
        let bmp;
        try { bmp = await createImageBitmap(files[n], { imageOrientation: 'from-image' }); }
        catch { bmp = await createImageBitmap(files[n]); }
        const full = await toJpeg(bmp, DEFAULTS.maxImageEdge, DEFAULTS.jpegQuality);
        const thumb = await toJpeg(bmp, DEFAULTS.thumbEdge, 0.78);
        if (bmp.close) bmp.close();
        const key = crypto.randomUUID();
        const path = gal.id + '/' + key + '.jpg';
        const tpath = gal.id + '/' + key + '_t.jpg';
        const opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
        let r = await sb.storage.from('photos').upload(path, full.blob, opts);
        if (r.error) throw r.error;
        r = await sb.storage.from('photos').upload(tpath, thumb.blob, opts);
        if (r.error) throw r.error;
        const ins = await sb.from('photos').insert({ gallery_id: gal.id, path, thumb_path: tpath, width: full.w, height: full.h, position: basePos + n });
        if (ins.error) throw ins.error;
        ok++;
      } catch (err) {
        bad++;
        console.error(err);
      }
    }
    fill.style.width = '100%';
    toast(bad ? ok + ' uploaded, ' + bad + ' failed' : ok + ' photos uploaded');
    reload();
  }

  render();
}
