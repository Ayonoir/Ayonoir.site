import { sb, BRAND, applyBrand, configured, toast, photoUrl, fmtDate, esc, pad3 } from './common.js';

applyBrand();

const $ = (s) => document.querySelector(s);
const slug = (new URLSearchParams(location.search).get('g') || '').trim();
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

let pin = '';
let data = null;      // { gallery, photos }
let filter = 'all';
let vis = [];         // indexes (into data.photos) currently shown
let lbPos = -1;

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.3C1.2 8.4 3 5 6.4 5c2 0 3.6 1.1 5.6 3.2C14 6.1 15.6 5 17.6 5 21 5 22.800 8.400 21.500 11.700 19.500 16.400 12 21 12 21z"/></svg>';
const DL = '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';

function show(name) {
  ['landing', 'pin', 'gallery'].forEach((n) => ($('#v-' + n).hidden = n !== name));
  window.scrollTo(0, 0);
}

/* ---------------- PIN entry ---------------- */
const boxes = [...document.querySelectorAll('#pin-boxes input')];
const pinError = $('#pin-error');

function pinValue() { return boxes.map((b) => b.value).join(''); }
function clearPin() { boxes.forEach((b) => (b.value = '')); boxes[0].focus(); }

boxes.forEach((b, i) => {
  b.addEventListener('input', () => {
    b.value = b.value.replace(/\D/g, '').slice(-1);
    if (b.value && i < 5) boxes[i + 1].focus();
    if (pinValue().length === 6) submitPin();
  });
  b.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !b.value && i > 0) { boxes[i - 1].focus(); boxes[i - 1].value = ''; }
  });
  b.addEventListener('paste', (e) => {
    const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!t) return;
    e.preventDefault();
    t.split('').forEach((c, k) => (boxes[k].value = c));
    (boxes[Math.min(t.length, 5)]).focus();
    if (t.length === 6) submitPin();
  });
});

$('#pin-form').addEventListener('submit', (e) => { e.preventDefault(); submitPin(); });

let busy = false;
async function submitPin() {
  const p = pinValue();
  if (p.length !== 6) { pinError.textContent = 'Please enter all six digits.'; return; }
  await tryOpen(p, false);
}

async function tryOpen(p, silent) {
  if (busy) return;
  busy = true;
  $('#pin-submit').disabled = true;
  pinError.textContent = '';
  try {
    const { data: res, error } = await sb.rpc('client_open', { p_slug: slug, p_pin: p });
    if (error) throw error;
    if (!res || !res.ok) { handleFail(res && res.reason, silent); return; }
    pin = p;
    data = res;
    sessionStorage.setItem('pin:' + slug, p);
    renderGallery();
  } catch (e) {
    pinError.textContent = 'Something went wrong. Please check your connection and try again.';
  } finally {
    busy = false;
    $('#pin-submit').disabled = false;
  }
}

function handleFail(reason, silent) {
  sessionStorage.removeItem('pin:' + slug);
  if (reason === 'expired') {
    $('#pin-form').hidden = true;
    $('#expired-box').hidden = false;
    if (BRAND.contactEmail) $('#expired-msg').textContent = 'Please contact ' + BRAND.contactEmail + ' if you would like it reopened.';
    return;
  }
  if (silent) { boxes[0].focus(); return; }
  if (reason === 'locked') pinError.textContent = 'Too many attempts. Please wait 15 minutes and try again.';
  else pinError.textContent = "That PIN isn't right. Please check it and try again.";
  const wrap = $('#pin-boxes');
  wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake');
  clearPin();
}

/* ---------------- Gallery ---------------- */
function renderGallery() {
  const g = data.gallery;
  $('#g-kicker').textContent = g.event_date ? fmtDate(g.event_date) : 'Private gallery';
  $('#g-title').textContent = g.title;
  $('#g-client').textContent = g.client_name;
  $('#g-expiry').textContent = 'Available until ' + fmtDate(g.expires_at);
  document.title = g.title + ' · ' + BRAND.name;
  $('#btn-dl-all').hidden = !g.downloads_enabled;
  $('#btn-dl-favs').hidden = !g.downloads_enabled;
  renderGrid();
  updateCounts();
  show('gallery');
}

function visible() {
  const out = [];
  data.photos.forEach((p, i) => { if (filter === 'all' || p.fav) out.push(i); });
  return out;
}

function renderGrid() {
  const grid = $('#grid');
  vis = visible();
  grid.innerHTML = '';
  if (!vis.length) {
    grid.innerHTML = '<div class="empty">' + (filter === 'favs' ? 'Tap the heart on any photo to add it to your favourites.' : 'Photos are being added. Please check back soon.') + '</div>';
    return;
  }
  const canDl = data.gallery.downloads_enabled;
  vis.forEach((i, k) => {
    const p = data.photos[i];
    const fig = document.createElement('figure');
    fig.className = 'tile';
    fig.style.setProperty('--d', (k % 6) * 70 + 'ms');
    const ratio = p.w && p.h ? p.w + ' / ' + p.h : '3 / 4';
    fig.innerHTML =
      '<button class="tile-img" style="aspect-ratio:' + esc(ratio) + '" data-open="' + k + '" aria-label="Open photo ' + (i + 1) + '">' +
      '<img loading="lazy" alt="Photo ' + (i + 1) + '" src="' + esc(photoUrl(p.thumb || p.path)) + '"></button>' +
      '<figcaption><span class="no">' + pad3(i + 1) + '</span><span>' +
      '<button class="icon-btn' + (p.fav ? ' on' : '') + '" data-heart="' + i + '" aria-label="Favourite" aria-pressed="' + !!p.fav + '">' + HEART + '</button>' +
      (canDl ? '<button class="icon-btn" data-dl="' + i + '" aria-label="Download photo">' + DL + '</button>' : '') +
      '</span></figcaption>';
    const img = fig.querySelector('img');
    img.addEventListener('load', () => img.classList.add('loaded'));
    if (img.complete) img.classList.add('loaded');
    grid.appendChild(fig);
  });
}

function updateCounts() {
  const n = data.photos.filter((p) => p.fav).length;
  $('#tab-favs').textContent = 'Favourites · ' + n;
  $('#btn-dl-favs').disabled = n === 0;
}

$('#grid').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.open !== undefined) openLightbox(Number(t.dataset.open));
  else if (t.dataset.heart !== undefined) setFav(Number(t.dataset.heart), !data.photos[Number(t.dataset.heart)].fav);
  else if (t.dataset.dl !== undefined) downloadPhoto(Number(t.dataset.dl));
});

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    filter = t.dataset.filter;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
    renderGrid();
  })
);

$('#btn-exit').addEventListener('click', () => {
  sessionStorage.removeItem('pin:' + slug);
  data = null; pin = '';
  clearPin();
  show('pin');
});

/* ---------------- Favourites ---------------- */
function refreshHearts(i) {
  const fav = data.photos[i].fav;
  document.querySelectorAll('[data-heart="' + i + '"]').forEach((b) => {
    b.classList.toggle('on', fav);
    b.setAttribute('aria-pressed', String(fav));
  });
  if (lbPos >= 0 && vis[lbPos] === i) {
    $('#lb-fav').classList.toggle('on', fav);
    $('#lb-fav').setAttribute('aria-pressed', String(fav));
  }
}

async function setFav(i, val) {
  const p = data.photos[i];
  const prev = p.fav;
  p.fav = val;
  refreshHearts(i);
  updateCounts();
  const { data: res, error } = await sb.rpc('client_set_fav', { p_slug: slug, p_pin: pin, p_photo: p.id, p_fav: val });
  if (error || !res || !res.ok) {
    p.fav = prev;
    refreshHearts(i);
    updateCounts();
    toast(res && res.reason === 'expired' ? 'This gallery has expired.' : 'Could not save that. Please try again.');
    return;
  }
  if (filter === 'favs' && lbPos < 0) renderGrid();
}

/* ---------------- Lightbox ---------------- */
const lb = $('#lightbox');
const lbImg = $('#lb-img');

function openLightbox(k) {
  lbPos = k;
  lb.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#lb-dl').hidden = !data.gallery.downloads_enabled;
  showLb(true);
}
function closeLightbox() {
  lb.hidden = true;
  document.body.style.overflow = '';
  lbPos = -1;
  if (filter === 'favs') renderGrid();
}
function showLb(first) {
  const i = vis[lbPos];
  const p = data.photos[i];
  const apply = () => {
    lbImg.src = photoUrl(p.path);
    lbImg.alt = 'Photo ' + (i + 1);
    lbImg.onload = () => lbImg.classList.remove('fading');
  };
  if (first) apply(); else { lbImg.classList.add('fading'); setTimeout(apply, 160); }
  $('#lb-count').textContent = pad3(i + 1) + ' / ' + pad3(data.photos.length);
  $('#lb-fav').classList.toggle('on', !!p.fav);
  $('#lb-fav').setAttribute('aria-pressed', String(!!p.fav));
  $('#lb-prev').hidden = lbPos === 0;
  $('#lb-next').hidden = lbPos === vis.length - 1;
  [lbPos + 1, lbPos - 1].forEach((n) => { if (vis[n] !== undefined) new Image().src = photoUrl(data.photos[vis[n]].path); });
}
function step(d) {
  const n = lbPos + d;
  if (n < 0 || n >= vis.length) return;
  lbPos = n;
  showLb(false);
}
$('#lb-close').addEventListener('click', closeLightbox);
$('#lb-prev').addEventListener('click', () => step(-1));
$('#lb-next').addEventListener('click', () => step(1));
$('#lb-fav').addEventListener('click', () => { const i = vis[lbPos]; setFav(i, !data.photos[i].fav); });
$('#lb-dl').addEventListener('click', () => downloadPhoto(vis[lbPos]));
document.addEventListener('keydown', (e) => {
  if (lb.hidden) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
});
let touchX = null;
$('#lb-stage').addEventListener('touchstart', (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
$('#lb-stage').addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
}, { passive: true });

/* ---------------- Downloads ---------------- */
const baseName = () => (data.gallery.title || 'gallery').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gallery';
const fileName = (i) => baseName() + '-' + pad3(i + 1) + '.jpg';

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

async function downloadPhoto(i) {
  if (!data.gallery.downloads_enabled) return;
  const p = data.photos[i];
  try {
    const blob = await (await fetch(photoUrl(p.path))).blob();
    const file = new File([blob], fileName(i), { type: blob.type || 'image/jpeg' });
    if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });   // lets the client tap "Save Image"
      return;
    }
    saveBlob(blob, fileName(i));
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    window.open(photoUrl(p.path), '_blank');
  }
}

async function downloadMany(indexes, label) {
  if (!indexes.length) return;
  const note = $('#dl-progress');
  const btns = [$('#btn-dl-all'), $('#btn-dl-favs')];
  btns.forEach((b) => (b.disabled = true));
  try {
    note.textContent = 'Preparing your download…';
    const mod = await import('https://esm.sh/jszip@3.10.1');
    const JSZip = mod.default;
    const zip = new JSZip();
    let n = 0;
    for (const i of indexes) {
      const blob = await (await fetch(photoUrl(data.photos[i].path))).blob();
      zip.file(fileName(i), blob);
      n++;
      note.textContent = 'Preparing ' + n + ' of ' + indexes.length + '…';
    }
    note.textContent = 'Almost ready…';
    const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    saveBlob(out, baseName() + '-' + label + '.zip');
    note.textContent = 'Your download is ready.';
    setTimeout(() => (note.textContent = ''), 5000);
  } catch (e) {
    note.textContent = '';
    toast('Download failed. Try fewer photos or download one at a time.');
  } finally {
    btns.forEach((b) => (b.disabled = false));
    updateCounts();
  }
}

$('#btn-dl-all').addEventListener('click', () => downloadMany(data.photos.map((_, i) => i), 'all'));
$('#btn-dl-favs').addEventListener('click', () => downloadMany(data.photos.map((p, i) => (p.fav ? i : -1)).filter((i) => i >= 0), 'favourites'));

/* ---------------- Start ---------------- */
(async function init() {
  if (!configured()) {
    show('landing');
    $('#landing-msg').textContent = 'This site is not connected to its database yet.';
    return;
  }
  if (!slug) { show('landing'); return; }
  show('pin');
  const saved = sessionStorage.getItem('pin:' + slug);
  if (saved) await tryOpen(saved, true);
  else boxes[0].focus();
})();
