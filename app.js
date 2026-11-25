'use strict';

/* ---------- constants & helpers ---------- */
const MOODS = [
  { id: 'great', emoji: '😄', label: 'Great' },
  { id: 'good',  emoji: '🙂', label: 'Good' },
  { id: 'okay',  emoji: '😐', label: 'Okay' },
  { id: 'low',   emoji: '😔', label: 'Low' },
  { id: 'awful', emoji: '😢', label: 'Awful' },
];
const moodById = Object.fromEntries(MOODS.map(m => [m.id, m]));

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const localStamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = stamp => stamp.slice(0, 10);
const parseStamp = s => new Date(s.length === 16 ? s + ':00' : s);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const extractTags = text => [...new Set((text.match(/#[\p{L}\p{N}_-]+/gu) || []).map(t => t.slice(1).toLowerCase()))];

const settings = {
  get(key, fallback) {
    try { const v = localStorage.getItem('diary.' + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('diary.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
  remove(key) { try { localStorage.removeItem('diary.' + key); } catch { /* ignore */ } },
};

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

function dialog({ title, text = '', input = false, okLabel = 'OK', danger = false }) {
  const dlg = $('#dlg');
  $('#dlg-title').textContent = title;
  $('#dlg-text').textContent = text;
  const inp = $('#dlg-input');
  inp.hidden = !input;
  inp.value = '';
  const ok = $('#dlg-ok');
  ok.textContent = okLabel;
  ok.className = 'btn ' + (danger ? 'danger' : 'primary');
  return new Promise(resolve => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      resolve(input ? inp.value : true);
    }, { once: true });
    dlg.returnValue = '';
    dlg.showModal();
    if (input) inp.focus();
  });
}

/* ---------- state ---------- */
let entries = [];
let current = null;        // entry being edited
let query = '';
let moodFilter = null;

/* ---------- passcode (PBKDF2 hash, never stored in plain text) ---------- */
async function hashPin(pin, saltB64) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), c => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return { salt: b64(salt), hash: b64(bits) };
}

function showLock() {
  if (!settings.get('pin')) return false;
  $('#app').hidden = true;
  $('#lock').hidden = false;
  $('#lock-msg').textContent = 'Enter your passcode';
  $('#lock-input').value = '';
  setTimeout(() => $('#lock-input').focus(), 50);
  return true;
}

$('#lock-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pin = settings.get('pin');
  const { hash } = await hashPin($('#lock-input').value, pin.salt);
  if (hash === pin.hash) {
    $('#lock').hidden = true;
    $('#app').hidden = false;
    render();
  } else {
    $('#lock-msg').textContent = 'Wrong passcode — try again';
    $('#lock-input').value = '';
    $('#lock').classList.remove('shake');
    void $('#lock').offsetWidth;
    $('#lock').classList.add('shake');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && settings.get('autolock', true) && settings.get('pin')) {
    flushSave();
    showLock();
  }
});

/* ---------- routing ---------- */
function show(view) {
  for (const id of ['list', 'editor', 'settings']) $('#view-' + id).hidden = id !== view;
  window.scrollTo(0, 0);
}

async function route() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/entry/')) {
    const id = decodeURIComponent(hash.slice(8));
    const entry = entries.find(e => e.id === id);
    if (!entry) { location.replace('#/'); return; }
    openEditor(entry);
  } else if (hash === '#/new') {
    openEditor(null);
  } else if (hash === '#/settings') {
    await leaveEditor();
    renderSettings();
    show('settings');
  } else {
    await leaveEditor();
    render();
    show('list');
  }
}
window.addEventListener('hashchange', route);

/* ---------- list view ---------- */
function filtered() {
  const q = query.trim().toLowerCase();
  return entries
    .filter(e => !moodFilter || e.mood === moodFilter)
    .filter(e => {
      if (!q) return true;
      const mood = e.mood ? moodById[e.mood].label.toLowerCase() : '';
      if (q.startsWith('#')) return (e.tags || []).some(t => t.startsWith(q.slice(1)));
      return (e.title + ' ' + e.body + ' ' + mood).toLowerCase().includes(q);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function computeStreak() {
  const days = new Set(entries.map(e => dayKey(e.date)));
  const d = new Date();
  if (!days.has(dayKey(localStamp(d)))) d.setDate(d.getDate() - 1); // streak still alive if you wrote yesterday
  let streak = 0;
  while (days.has(dayKey(localStamp(d)))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function renderStats() {
  const monthKey = localStamp().slice(0, 7);
  const thisMonth = entries.filter(e => e.date.startsWith(monthKey)).length;
  const streak = computeStreak();
  $('#stats').innerHTML = entries.length ? `
    <div class="stat"><b>${entries.length}</b><span>entries</span></div>
    <div class="stat"><b>${thisMonth}</b><span>this month</span></div>
    <div class="stat"><b>${streak}${streak >= 3 ? ' 🔥' : ''}</b><span>day streak</span></div>` : '';
}

function renderMoodFilter() {
  const el = $('#mood-filter');
  if (!entries.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<button class="chip ${!moodFilter ? 'on' : ''}" data-mood="">All</button>` +
    MOODS.map(m => `<button class="chip ${moodFilter === m.id ? 'on' : ''}" data-mood="${m.id}" aria-label="${m.label}">${m.emoji}</button>`).join('');
}
$('#mood-filter').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  moodFilter = b.dataset.mood || null;
  render();
});

function render() {
  renderStats();
  renderMoodFilter();
  const list = filtered();
  const el = $('#entries');
  if (!entries.length) {
    el.innerHTML = `<div class="empty"><div class="empty-art">📖</div>
      <h2>Your diary is empty</h2><p class="muted">Tap <b>+</b> to write your first entry.</p></div>`;
    return;
  }
  if (!list.length) {
    el.innerHTML = `<div class="empty"><p class="muted">No entries match.</p></div>`;
    return;
  }
  let html = '';
  let lastMonth = '';
  for (const e of list) {
    const d = parseStamp(e.date);
    const month = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (month !== lastMonth) { html += `<h3 class="month">${esc(month)}</h3>`; lastMonth = month; }
    const snippet = e.body.replace(/\s+/g, ' ').slice(0, 140);
    const mood = e.mood ? moodById[e.mood].emoji : '';
    const thumb = e.photos && e.photos.length ? `<img class="thumb" src="${e.photos[0]}" alt="" loading="lazy">` : '';
    html += `
      <a class="entry" href="#/entry/${encodeURIComponent(e.id)}">
        <div class="entry-date">
          <span class="day">${d.getDate()}</span>
          <span class="wd">${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</span>
        </div>
        <div class="entry-main">
          <div class="entry-head">
            <span class="entry-title">${esc(e.title || 'Untitled')}</span>
            <span class="entry-mood">${mood}</span>
          </div>
          <p class="entry-snippet">${esc(snippet) || '<span class="muted">No text</span>'}</p>
          ${(e.tags || []).length ? `<div class="tags">${e.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
        ${thumb}
      </a>`;
  }
  el.innerHTML = html;
}

$('#btn-new').addEventListener('click', () => { location.hash = '#/new'; });
$('#btn-settings').addEventListener('click', () => { location.hash = '#/settings'; });
$('#btn-settings-back').addEventListener('click', () => history.length > 1 ? history.back() : (location.hash = '#/'));
$('#btn-search').addEventListener('click', () => {
  const bar = $('#search-bar');
  bar.hidden = !bar.hidden;
  if (!bar.hidden) $('#search-input').focus();
  else { query = ''; $('#search-input').value = ''; render(); }
});
$('#search-input').addEventListener('input', e => { query = e.target.value; render(); });
$('#entries').addEventListener('click', e => {
  const tag = e.target.closest('.tag');
  if (!tag) return;
  e.preventDefault();
  $('#search-bar').hidden = false;
  $('#search-input').value = query = tag.textContent;
  render();
});

/* ---------- editor ---------- */
let saveTimer = null;

function openEditor(entry) {
  current = entry ? { ...entry, photos: [...(entry.photos || [])] }
    : { id: uid(), date: localStamp(), title: '', body: '', mood: null, photos: [], tags: [], isNew: true };
  $('#ed-date').value = current.date;
  $('#ed-title').value = current.title;
  $('#ed-body').value = current.body;
  $('#btn-delete').hidden = !!current.isNew;
  $('#save-state').textContent = current.isNew ? 'New entry' : '';
  renderMoods();
  renderPhotos();
  updateCount();
  show('editor');
  autoGrow();
  if (current.isNew) setTimeout(() => $('#ed-body').focus(), 100);
}

function renderMoods() {
  $('#ed-moods').innerHTML = MOODS.map(m => `
    <button type="button" role="radio" aria-checked="${current.mood === m.id}" aria-label="${m.label}"
      class="mood ${current.mood === m.id ? 'on' : ''}" data-mood="${m.id}">
      <span>${m.emoji}</span><small>${m.label}</small></button>`).join('');
}

function renderPhotos() {
  $('#ed-photos').innerHTML = current.photos.map((src, i) => `
    <div class="photo"><img src="${src}" alt="Photo ${i + 1}">
      <button type="button" class="photo-x" data-i="${i}" aria-label="Remove photo">×</button></div>`).join('');
}

function updateCount() {
  const words = (current.body.match(/\S+/g) || []).length;
  $('#ed-count').textContent = words ? `${words} word${words === 1 ? '' : 's'}` : '';
}

function autoGrow() {
  const ta = $('#ed-body');
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight, 240) + 'px';
}

const isEmpty = e => !e.title.trim() && !e.body.trim() && !e.photos.length && !e.mood;

function scheduleSave() {
  $('#save-state').textContent = 'Editing…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

async function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!current || isEmpty(current)) return;
  const { isNew, ...data } = current;
  data.tags = extractTags(data.title + ' ' + data.body);
  data.updatedAt = Date.now();
  if (isNew) data.createdAt = Date.now();
  await DB.put(data);
  current.isNew = false;
  $('#btn-delete').hidden = false;
  const i = entries.findIndex(e => e.id === data.id);
  if (i >= 0) entries[i] = data; else entries.push(data);
  $('#save-state').textContent = 'Saved ✓';
  if (isNew && location.hash === '#/new') history.replaceState(null, '', '#/entry/' + encodeURIComponent(data.id));
}

async function leaveEditor() {
  if (!current) return;
  await flushSave();
  current = null;
}

$('#editor').addEventListener('input', e => {
  if (!current) return;
  if (e.target.id === 'ed-title') current.title = e.target.value;
  if (e.target.id === 'ed-body') { current.body = e.target.value; updateCount(); autoGrow(); }
  if (e.target.id === 'ed-date' && e.target.value) current.date = e.target.value;
  scheduleSave();
});
$('#editor').addEventListener('submit', e => e.preventDefault());
$('#ed-moods').addEventListener('click', e => {
  const b = e.target.closest('.mood');
  if (!b) return;
  current.mood = current.mood === b.dataset.mood ? null : b.dataset.mood;
  renderMoods();
  scheduleSave();
});
$('#ed-photos').addEventListener('click', e => {
  const b = e.target.closest('.photo-x');
  if (!b) return;
  current.photos.splice(Number(b.dataset.i), 1);
  renderPhotos();
  scheduleSave();
});
$('#ed-photo-input').addEventListener('change', async e => {
  for (const file of e.target.files) {
    try { current.photos.push(await resizeImage(file, 1280, 0.82)); }
    catch { toast('Could not add that photo'); }
  }
  e.target.value = '';
  renderPhotos();
  scheduleSave();
});

function resizeImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

$('#btn-back').addEventListener('click', async () => {
  await leaveEditor();
  location.hash = '#/';
});

$('#btn-delete').addEventListener('click', async () => {
  const ok = await dialog({ title: 'Delete this entry?', text: 'This cannot be undone.', okLabel: 'Delete', danger: true });
  if (!ok) return;
  clearTimeout(saveTimer);
  await DB.remove(current.id);
  entries = entries.filter(e => e.id !== current.id);
  current = null;
  toast('Entry deleted');
  location.hash = '#/';
});

/* ---------- settings ---------- */
function applyTheme() {
  const t = settings.get('theme', 'auto');
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function renderSettings() {
  const hasPin = !!settings.get('pin');
  $('#pin-status').textContent = hasPin ? 'A passcode is set. The app asks for it when opened.' : 'No passcode set. Anyone with your unlocked phone can open the diary.';
  $('#btn-set-pin').textContent = hasPin ? 'Change passcode' : 'Set passcode';
  $('#btn-remove-pin').hidden = !hasPin;
  $('#opt-autolock').checked = settings.get('autolock', true);
  $('#opt-autolock').closest('label').hidden = !hasPin;
  const theme = settings.get('theme', 'auto');
  document.querySelectorAll('input[name=theme]').forEach(r => { r.checked = r.value === theme; });
  const lb = settings.get('lastBackup');
  $('#last-backup').textContent = lb ? `Last backup: ${new Date(lb).toLocaleString()}` : 'No backup yet.';
}

document.querySelectorAll('input[name=theme]').forEach(r => r.addEventListener('change', () => {
  settings.set('theme', r.value);
  applyTheme();
}));
$('#opt-autolock').addEventListener('change', e => settings.set('autolock', e.target.checked));

$('#btn-set-pin').addEventListener('click', async () => {
  const existing = settings.get('pin');
  if (existing) {
    const old = await dialog({ title: 'Current passcode', input: true, okLabel: 'Next' });
    if (old === null) return;
    if ((await hashPin(old, existing.salt)).hash !== existing.hash) { toast('Wrong passcode'); return; }
  }
  const pin = await dialog({ title: 'New passcode', text: 'At least 4 characters.', input: true, okLabel: 'Next' });
  if (pin === null) return;
  if (pin.length < 4) { toast('Passcode too short'); return; }
  const again = await dialog({ title: 'Confirm passcode', input: true, okLabel: 'Save' });
  if (again === null) return;
  if (again !== pin) { toast("Passcodes don't match"); return; }
  settings.set('pin', await hashPin(pin));
  toast('Passcode set');
  renderSettings();
});

$('#btn-remove-pin').addEventListener('click', async () => {
  const pin = settings.get('pin');
  const entered = await dialog({ title: 'Enter passcode to remove it', input: true, okLabel: 'Remove', danger: true });
  if (entered === null) return;
  if ((await hashPin(entered, pin.salt)).hash !== pin.hash) { toast('Wrong passcode'); return; }
  settings.remove('pin');
  toast('Passcode removed');
  renderSettings();
});

$('#btn-export').addEventListener('click', async () => {
  const all = await DB.all();
  const blob = new Blob([JSON.stringify({ app: 'diary', version: 1, exportedAt: new Date().toISOString(), entries: all }, null, 1)],
    { type: 'application/json' });
  const name = `diary-backup-${localStamp().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  // On phones, the share sheet lets you save to Files / Drive / email it to yourself.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Diary backup' }); settings.set('lastBackup', Date.now()); renderSettings(); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  settings.set('lastBackup', Date.now());
  renderSettings();
});

$('#import-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(list)) throw new Error('format');
    const valid = list.filter(x => x && typeof x.id === 'string' && typeof x.date === 'string')
      .map(x => ({ title: '', body: '', mood: null, photos: [], ...x, tags: extractTags((x.title || '') + ' ' + (x.body || '')) }));
    const ok = await dialog({ title: `Import ${valid.length} entries?`, text: 'Entries with the same ID will be replaced. Others are kept.', okLabel: 'Import' });
    if (!ok) return;
    await DB.bulkPut(valid);
    entries = await DB.all();
    toast(`Imported ${valid.length} entries`);
  } catch {
    toast('That file is not a valid diary backup');
  }
});

$('#btn-wipe').addEventListener('click', async () => {
  const ok = await dialog({ title: 'Delete ALL entries?', text: 'Everything will be erased from this device. Export a backup first if you might want it back.', okLabel: 'Delete everything', danger: true });
  if (!ok) return;
  await DB.clear();
  entries = [];
  toast('All entries deleted');
  location.hash = '#/';
});

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  $('#btn-install').hidden = false;
});
$('#btn-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#btn-install').hidden = true;
});

/* ---------- boot ---------- */
(async function boot() {
  applyTheme();
  try {
    entries = await DB.all();
  } catch (err) {
    document.body.innerHTML = '<p style="padding:24px">Could not open storage. If you are in private browsing, open the diary in a normal tab.</p>';
    return;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (!showLock()) $('#app').hidden = false;
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
