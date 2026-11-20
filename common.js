import { BRAND, DEFAULTS, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export { BRAND, DEFAULTS };

export const configured = () =>
  !!(/^https:\/\/.+\.supabase\.co/.test(SUPABASE_URL) && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('PASTE'));

export const sb = configured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

export function applyBrand() {
  document.documentElement.style.setProperty('--accent', BRAND.accent);
  document.querySelectorAll('[data-brand]').forEach((e) => (e.textContent = BRAND.name));
  document.querySelectorAll('[data-tagline]').forEach((e) => (e.textContent = BRAND.tagline));
  document.querySelectorAll('[data-year]').forEach((e) => (e.textContent = new Date().getFullYear()));
  const t = document.body.dataset.title;
  document.title = (t ? t + ' · ' : '') + BRAND.name;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function photoUrl(path) {
  const base = SUPABASE_URL.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/photos/${String(path).split('/').map(encodeURIComponent).join('/')}`;
}

export function fmtDate(v) {
  if (!v) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00') : new Date(v);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export const pad3 = (n) => String(n).padStart(3, '0');
