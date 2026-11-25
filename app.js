'use strict';

// Self-repair: if the page layout and this script come from different releases
// (a stale saved copy), clear the saved copies and reload once.
(function checkSameRelease() {
  const required = ['app', 'cal-map', 'level-card', 'levelup', 'editor', 'view-progress', 'stardate', 'today-date', 'clock', 'milestones', 'lu-milestone', 'map-panel', 'mp-map', 'map-unpin', 'cal-collapse', 'checkin'];
  if (required.every(id => document.getElementById(id))) {
    try { sessionStorage.removeItem('diary.repairing'); } catch { /* ignore */ }
    return;
  }
  let tried = false;
  try { tried = sessionStorage.getItem('diary.repairing') === '1'; sessionStorage.setItem('diary.repairing', '1'); } catch { /* ignore */ }
  if (!tried) {
    Promise.resolve(window.caches ? caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))) : null)
      .finally(() => location.reload());
  } else {
    document.body.innerHTML = '<p style="padding:24px;font:16px system-ui">The app was just updated. Please close it and open it again.</p>';
  }
  throw new Error('Stale page; repairing');
})();

/* ---------- constants & helpers ---------- */
const MOODS = [
  { id: 'great', emoji: '😄', label: 'Great', color: '#ffd84d' },
  { id: 'good',  emoji: '🙂', label: 'Good',  color: '#5dffa8' },
  { id: 'okay',  emoji: '😐', label: 'Okay',  color: '#5ec8ff' },
  { id: 'low',   emoji: '😔', label: 'Low',   color: '#b28cff' },
  { id: 'awful', emoji: '😢', label: 'Awful', color: '#ff6b9a' },
];
const moodById = Object.fromEntries(MOODS.map(m => [m.id, m]));
const NO_MOOD_COLOR = '#8fa3ff';
const moodColor = id => (id && moodById[id] ? moodById[id].color : NO_MOOD_COLOR);

// How you felt on a day: your moods scored Awful 1 … Great 5, averaged over that day's entries.
const MOOD_LEVEL = { awful: 1, low: 2, okay: 3, good: 4, great: 5 };
const LEVEL_MOOD = ['awful', 'low', 'okay', 'good', 'great'];
function dayFeeling(list) {
  const levels = (list || []).map(e => MOOD_LEVEL[e.mood]).filter(Boolean);
  if (!levels.length) return null;
  const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
  const level = Math.round(avg);
  const mood = moodById[LEVEL_MOOD[level - 1]];
  return { level, avg, count: levels.length, color: mood.color, label: mood.label, emoji: mood.emoji };
}
function feelingBar(f) {
  return `<span class="feel-bar" aria-hidden="true">${[1, 2, 3, 4, 5].map(i => `<i${i <= f.level ? ` style="background:${f.color};box-shadow:0 0 6px ${f.color}"` : ''}></i>`).join('')}</span>`;
}

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
  for (const id of ['list', 'editor', 'settings', 'calendar', 'progress']) $('#view-' + id).hidden = id !== view;
  window.scrollTo(0, 0);
}

async function route() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/entry/')) {
    const id = decodeURIComponent(hash.slice(8));
    const entry = entries.find(e => e.id === id);
    if (!entry) { location.replace('#/'); return; }
    openEditor(entry);
  } else if (hash.startsWith('#/new')) {
    openEditor(null, hash.slice(6) || null);
  } else if (hash === '#/map' || hash === '#/calendar') {
    await leaveEditor();
    renderCalendar();
    show('calendar');
    const you = document.querySelector('#cal-map .jm-avatar');
    if (you) you.scrollIntoView({ block: 'center' });
  } else if (hash === '#/progress') {
    await leaveEditor();
    renderProgress();
    show('progress');
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

function renderLevelCard() {
  const info = Levels.levelInfo(xpNow());
  $('#level-card').innerHTML = `
    <div class="lc-badge">${info.icon}<span>${info.level}</span></div>
    <div class="lc-main">
      <b class="lc-title">${esc(info.title)}</b>
      <div class="xpbar"><i style="width:${Math.round(info.pct * 100)}%"></i></div>
      <span class="lc-xp">${info.into} / ${info.need} XP to level ${info.level + 1}</span>
    </div>
    <svg class="lc-chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>`;
}

function entryCard(e) {
  const d = parseStamp(e.date);
  const snippet = e.body.replace(/\s+/g, ' ').slice(0, 140);
  const mood = e.mood ? moodById[e.mood].emoji : '';
  const thumb = e.photos && e.photos.length ? `<img class="thumb" src="${e.photos[0]}" alt="" loading="lazy">` : '';
  return `
      <a class="entry" href="#/entry/${encodeURIComponent(e.id)}" style="--mood:${moodColor(e.mood)}">
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

// Stardate: year, then day of the year (e.g. 2026.329)
function stardate(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  const day = Math.floor((d - start + (start.getTimezoneOffset() - d.getTimezoneOffset()) * 60000) / 864e5);
  return `${d.getFullYear()}.${String(day).padStart(3, '0')}`;
}

// Today's date in the header and the browser tab, in the phone's own language.
function showToday() {
  const now = new Date();
  const el = $('#today-date');
  el.textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  el.dateTime = localStamp(now).slice(0, 10);
  $('#stardate').textContent = `Stardate ${stardate(now)}`;
  document.title = `Diary – ${now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
}
// Live clock in the phone's own time zone. Ticks on the second; also rolls the date over at midnight.
// 12-hour clocks read "9:05 PM"; 24-hour clocks keep the leading zero, "09:05".
const uses12h = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: uses12h ? 'numeric' : '2-digit', minute: '2-digit', second: '2-digit' });
let shownDay = '';
function tick() {
  const now = new Date();
  const clock = $('#clock');
  clock.textContent = clockFmt.format(now);
  clock.dateTime = now.toISOString();
  const day = localStamp(now).slice(0, 10);
  if (day !== shownDay) {
    shownDay = day;
    showToday();
    let zone = '';
    try {
      zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'shortOffset' }).formatToParts(now)
        .find(p => p.type === 'timeZoneName')?.value || '';
    } catch { /* older browsers */ }
    const tz = $('#tz');
    tz.textContent = zone;
    tz.title = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  }
}
(function loop() {
  tick();
  setTimeout(loop, 1000 - (Date.now() % 1000) + 5);   // line up with the start of each second
})();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { shownDay = ''; tick(); } });

function render() {
  showToday();
  applyMapMode();
  renderCheckin();
  renderLevelCard();
  renderStats();
  renderMoodFilter();
  const list = filtered();
  const el = $('#entries');
  if (!entries.length) {
    el.innerHTML = `<div class="empty"><div class="empty-art">🪐</div>
      <h2>Your log is empty</h2><p class="muted">Tap <b>+</b> to write your first entry.</p></div>`;
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
    html += entryCard(e);
  }
  el.innerHTML = html;
}

$('#btn-new').addEventListener('click', () => { location.hash = '#/new'; });
$('#btn-settings').addEventListener('click', () => { location.hash = '#/settings'; });
$('#btn-calendar').addEventListener('click', () => { location.hash = '#/map'; });
document.querySelectorAll('.js-home').forEach(b => b.addEventListener('click', () => { location.hash = '#/'; }));
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
let xpAtOpen = 0;

let pendingPrefill = null;   // { title, body } to start a new entry with (from the daily check-in)

function openEditor(entry, onDay) {
  xpAtOpen = xpNow();
  let date = localStamp();
  if (onDay && /^\d{4}-\d{2}-\d{2}$/.test(onDay)) date = onDay + date.slice(10);
  current = entry ? { ...entry, photos: [...(entry.photos || [])] }
    : { id: uid(), date, title: '', body: '', mood: null, photos: [], tags: [], isNew: true };
  if (!entry && pendingPrefill) {
    // remember the starting text so an untouched entry isn't saved
    current.title = current._pt = pendingPrefill.title;
    current.body = current._pb = pendingPrefill.body;
  }
  pendingPrefill = null;
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

const isEmpty = e => (!e.title.trim() || e.title === e._pt) && (!e.body.trim() || e.body === e._pb) && !e.photos.length && !e.mood;

function scheduleSave() {
  $('#save-state').textContent = 'Editing…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

let saveChain = Promise.resolve();

// Saves run one at a time, so an autosave and a "Back" tap can't overlap.
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const editing = current;
  saveChain = saveChain.then(() => saveEntry(editing)).catch(() => toast('Could not save. Is storage full?'));
  return saveChain;
}

async function saveEntry(editing) {
  if (!editing || isEmpty(editing)) return;
  const { isNew, _pt, _pb, ...data } = editing;
  editing.isNew = false;
  data.tags = extractTags(data.title + ' ' + data.body);
  data.updatedAt = Date.now();
  if (isNew) data.createdAt = editing.createdAt = Date.now();
  await DB.put(data);
  const i = entries.findIndex(e => e.id === data.id);
  if (i >= 0) entries[i] = data; else entries.push(data);
  if (editing !== current) return;            // editor already closed
  $('#btn-delete').hidden = false;
  $('#save-state').textContent = 'Saved ✓';
  if (isNew && location.hash.startsWith('#/new')) history.replaceState(null, '', '#/entry/' + encodeURIComponent(data.id));
}

async function leaveEditor() {
  if (!current) return;
  await flushSave();
  current = null;
  const gained = xpNow() - xpAtOpen;
  if (gained > 0) toast(`+${gained} XP ✨`);
  checkLevelUp();
}

/* ---------- level up ---------- */
function checkLevelUp() {
  const info = Levels.levelInfo(xpNow());
  const seen = settings.get('seenLevel', null);
  settings.set('seenLevel', info.level);
  if (seen === null || info.level <= seen) return;   // first launch, or no change
  $('#lu-icon').textContent = info.icon;
  $('#lu-level').textContent = `Level ${info.level}`;
  $('#lu-title').textContent = info.title;
  $('#lu-text').textContent = info.nextTitle
    ? `Reach level ${info.nextTitle.level} to become ${info.nextTitle.icon} ${info.nextTitle.title}.`
    : 'You have reached the highest title. Legendary!';
  const ms = Levels.milestoneBetween(seen, info.level);
  $('#lu-milestone').hidden = !ms;
  if (ms) {
    $('#lu-ms-icon').textContent = ms.icon;
    $('#lu-ms-name').textContent = ms.name;
  }
  setTimeout(() => { $('#levelup').showModal(); confetti(); }, 250);
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('#confetti');
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = [...MOODS.map(m => m.color), NO_MOOD_COLOR];
  const bits = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .4,
    vx: (Math.random() - .5) * 12, vy: -Math.random() * 14 - 4,
    r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
    w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, color: colors[Math.floor(Math.random() * colors.length)],
  }));
  c.hidden = false;
  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vy += .35; b.vx *= .99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.fillStyle = b.color; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    }
    if (t - start < 3000) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, innerWidth, innerHeight); c.hidden = true; }
  })(start);
}

/* ---------- journey map (month view) ---------- */
const today = () => localStamp().slice(0, 10);
let calMonth = today().slice(0, 7);     // "YYYY-MM"
let calDay = today();

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function entriesByDay() {
  const byDay = {};
  for (const e of entries) (byDay[dayKey(e.date)] ||= []).push(e);
  for (const k in byDay) byDay[k].sort((a, b) => b.date.localeCompare(a.date));
  return byDay;
}

function renderCalendar() {
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const byDay = entriesByDay();

  $('#cal-month').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#cal-map').innerHTML = JourneyMap.render({
    month: calMonth, byDay, today: today(), selected: calDay,
    level: Levels.levelInfo(xpNow()),
    moodColor, moodEmoji: id => moodById[id]?.emoji || '✏️', feeling: dayFeeling,
    monthLabel: first.toLocaleDateString(undefined, { month: 'long' }),
    idPrefix: 'full-',
  });
  $('#cal-legend').innerHTML = MOODS.map(mo => `<span><i style="background:${mo.color}"></i>${mo.label}</span>`).join('') +
    `<span><i style="background:${NO_MOOD_COLOR}"></i>No mood</span>` +
    `<span><i class="lg-gold"></i>Streak lane</span><span><i class="lg-empty"></i>Missed day</span>`;

  const t = today();

  // month summary
  const monthEntries = entries.filter(e => e.date.startsWith(calMonth));
  const daysWritten = new Set(monthEntries.map(e => dayKey(e.date))).size;
  const counts = MOODS.map(mo => ({ ...mo, n: monthEntries.filter(e => e.mood === mo.id).length })).filter(x => x.n);
  const total = counts.reduce((s, x) => s + x.n, 0);
  $('#cal-summary').innerHTML = monthEntries.length ? `
    <div class="cal-sum-row"><span><b>${daysWritten}</b> day${daysWritten === 1 ? '' : 's'} written</span>
      <span><b>${monthEntries.length}</b> entr${monthEntries.length === 1 ? 'y' : 'ies'}</span></div>
    ${total ? `<div class="moodbar">${counts.map(x => `<i style="flex:${x.n};background:${x.color}" title="${x.label}: ${x.n}"></i>`).join('')}</div>
      <div class="moodbar-key">${counts.map(x => `<span>${x.emoji} ${x.n}</span>`).join('')}</div>` : ''}` : '';

  // selected day
  const sel = parseStamp(calDay + 'T12:00');
  $('#cal-day-title').textContent = sel.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const dayList = byDay[calDay] || [];
  const feel = dayFeeling(dayList);
  const feelRow = feel ? `<div class="feel-row" role="img" aria-label="Feeling ${feel.level} out of 5: ${feel.label}">
      <span class="muted small">Feeling</span>${feelingBar(feel)}<b>${feel.emoji} ${esc(feel.label)}</b>
      ${feel.count > 1 ? `<span class="muted small">avg of ${feel.count} entries</span>` : ''}</div>` : '';
  $('#cal-day').innerHTML = feelRow + dayList.map(entryCard).join('') +
    (calDay <= t ? `<a class="cal-add" href="#/new/${calDay}">＋ Write for this day</a>` : '<p class="muted center small">This day hasn\'t happened yet.</p>');
}

$('#cal-prev').addEventListener('click', () => { calMonth = shiftMonth(calMonth, -1); renderCalendar(); });
$('#cal-next').addEventListener('click', () => { calMonth = shiftMonth(calMonth, 1); renderCalendar(); });
$('#cal-month').addEventListener('click', () => { calMonth = today().slice(0, 7); calDay = today(); renderCalendar(); });
// Full map page: "Hide map" closes the map and goes back to the home screen.
$('#cal-collapse').addEventListener('click', () => { location.hash = '#/'; });

function pickDay(stop) {
  calDay = stop.dataset.day;
  renderCalendar();
  $('#cal-day-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#cal-map').addEventListener('click', e => {
  const stop = e.target.closest('.jm-stop');
  if (stop) pickDay(stop);
});
$('#cal-map').addEventListener('keydown', e => {
  const stop = e.target.closest('.jm-stop');
  if (stop && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickDay(stop); }
});
// Change month only on a quick, clearly sideways swipe. Any up/down movement means you're
// scrolling, so the month never changes by accident.
let swipe = null;
$('#cal-map').addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { swipe = null; return; }
  swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
}, { passive: true });
$('#cal-map').addEventListener('touchmove', e => {
  if (swipe && Math.abs(e.touches[0].clientY - swipe.y) > 12) swipe = null;   // it's a scroll
}, { passive: true });
$('#cal-map').addEventListener('touchend', e => {
  if (!swipe) return;
  const dx = e.changedTouches[0].clientX - swipe.x;
  const dy = e.changedTouches[0].clientY - swipe.y;
  const quick = Date.now() - swipe.t < 600;
  swipe = null;
  if (quick && Math.abs(dx) > 70 && Math.abs(dy) < 30 && Math.abs(dx) > 3 * Math.abs(dy)) {
    calMonth = shiftMonth(calMonth, dx < 0 ? 1 : -1);
    renderCalendar();
  }
});
$('#cal-map').addEventListener('touchcancel', () => { swipe = null; });

/* ---------- star map panel on the home screen ---------- */
// 'panel': collapsible map on the home screen. 'button': an icon in the top bar instead.
// The star map lives in the top bar by default (it was briefly a home-screen panel by default).
if (!settings.get('mapModeV2', false)) { settings.set('mapMode', 'button'); settings.set('mapModeV2', true); }
settings.remove('fullMapOpen');   // retired: the map page always shows the map now
const mapMode = () => settings.get('mapMode', 'button');

// Top-bar planet: coloured by today's mood (pale until you write), with a count of days written this month.
function renderMapLauncher() {
  const btn = $('#btn-calendar');
  const day = today();
  const todays = entries.filter(e => dayKey(e.date) === day).sort((a, b) => b.date.localeCompare(a.date));
  const feel = dayFeeling(todays);
  const color = todays.length ? (feel ? feel.color : moodColor(null)) : '#c9d1ff';
  btn.style.setProperty('--planet', color);
  btn.classList.toggle('written', todays.length > 0);
  const month = day.slice(0, 7);
  const days = new Set(entries.filter(e => e.date.startsWith(month)).map(e => dayKey(e.date))).size;
  const count = $('#ml-count');
  count.hidden = days === 0;
  count.textContent = days;
  btn.setAttribute('aria-label', `Star map: ${days} day${days === 1 ? '' : 's'} written this month${todays.length ? '' : ', nothing written today yet'}`);
  btn.title = 'Star map';
}

function applyMapMode() {
  const panel = mapMode() === 'panel';
  renderMapLauncher();
  $('#btn-calendar').hidden = panel;
  $('#map-panel').hidden = !panel;
  $('#map-unpin').style.visibility = panel ? 'hidden' : 'visible';
  document.querySelectorAll('input[name=mapmode]').forEach(r => { r.checked = r.value === mapMode(); });
  renderMapPanel();
}

function renderMapPanel() {
  if (mapMode() !== 'panel') return;
  const open = settings.get('mapOpen', true);
  const now = new Date();
  $('#mp-toggle').setAttribute('aria-expanded', String(open));
  $('#mp-month').textContent = now.toLocaleDateString(undefined, { month: 'long' });
  $('#mp-body').hidden = !open;
  if (!open) { $('#mp-map').innerHTML = ''; return; }
  $('#mp-map').innerHTML = JourneyMap.render({
    month: today().slice(0, 7), byDay: entriesByDay(), today: today(), selected: null,
    level: Levels.levelInfo(xpNow()),
    moodColor, moodEmoji: id => moodById[id]?.emoji || '✏️', feeling: dayFeeling,
    monthLabel: now.toLocaleDateString(undefined, { month: 'long' }),
    idPrefix: 'mini-',
  });
  // centre today's stop in the panel once it's on screen
  requestAnimationFrame(() => {
    const box = $('#mp-map'), you = box.querySelector('.jm-avatar');
    if (!you || !box.clientHeight) return;
    const offset = you.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTop += offset - box.clientHeight / 2 + 30;
  });
}

$('#mp-toggle').addEventListener('click', () => {
  settings.set('mapOpen', !settings.get('mapOpen', true));
  renderMapPanel();
});
$('#mp-pin').addEventListener('click', () => {
  settings.set('mapMode', 'button');
  applyMapMode();
  toast('Star map moved to the top bar');
});
$('#map-unpin').addEventListener('click', () => {
  settings.set('mapMode', 'panel');
  settings.set('mapOpen', true);
  applyMapMode();
  toast('Star map is back on the home screen');
  location.hash = '#/';
});
document.querySelectorAll('input[name=mapmode]').forEach(r => r.addEventListener('change', () => {
  settings.set('mapMode', r.value);
  applyMapMode();
}));
// tapping a day in the panel opens it on the full map
$('#mp-map').addEventListener('click', e => {
  const stop = e.target.closest('.jm-stop');
  if (!stop) return;
  calDay = stop.dataset.day;
  calMonth = calDay.slice(0, 7);
  location.hash = '#/map';
});
$('#mp-map').addEventListener('keydown', e => {
  const stop = e.target.closest('.jm-stop');
  if (stop && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); stop.click(); }
});

/* ---------- daily health check-in ---------- */
// Answers live on this device only: { 'YYYY-MM-DD': { q: questionId, a: answer | null (skipped), t: time } }
const CHECKIN_XP = 5;
function getCheckins() { return settings.get('checkins', {}) || {}; }
function saveCheckins(c) { settings.set('checkins', c); }
const answeredCount = () => Object.values(getCheckins()).filter(c => c && c.a !== null && c.a !== undefined).length;
function xpNow() { return Levels.totalXP(entries) + CHECKIN_XP * answeredCount(); }

let checkinEditing = false;
function renderCheckin() {
  const el = $('#checkin');
  const day = today();
  const rec = getCheckins()[day];
  // keep the question asked when you answered, even if the question bank changes later
  const q = (rec && CheckIn.byId[rec.q]) || CheckIn.questionFor(day);
  const streak = CheckIn.streak(getCheckins(), day);
  const head = `<div class="ci-head"><span class="ci-icon" aria-hidden="true">${q.icon}</span>
      <span class="ci-kicker">Daily check-in</span>
      ${streak > 1 ? `<span class="ci-streak" title="Days in a row">${streak} days 🔥</span>` : ''}</div>`;

  if (!rec || checkinEditing) {
    let answers;
    if (q.type === 'scale') {
      answers = `<div class="ci-scale">${q.faces.map((f, i) => `
        <button type="button" class="ci-opt ci-face ${rec && rec.a === i + 1 ? 'on' : ''}" data-a="${i + 1}" aria-label="${i + 1} of 5">
          <span>${f}</span><small>${i + 1}</small></button>`).join('')}</div>
        <div class="ci-ends"><span>${esc(q.low)}</span><span>${esc(q.high)}</span></div>`;
    } else {
      answers = `<div class="ci-choices">${q.options.map(o => `
        <button type="button" class="ci-opt ${rec && rec.a === o ? 'on' : ''}" data-a="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    }
    el.className = 'checkin ask';
    el.innerHTML = `${head}<p class="ci-q">${esc(q.q)}</p>${answers}
      <div class="ci-foot">${rec ? '<button type="button" class="ci-link" data-act="cancel">Cancel</button>' : '<button type="button" class="ci-link" data-act="skip">Skip today</button>'}
      <span class="muted small">+${CHECKIN_XP} XP</span></div>`;
    return;
  }

  if (rec.a === null || rec.a === undefined) {
    el.className = 'checkin done skipped';
    el.innerHTML = `<div class="ci-row"><span class="ci-icon" aria-hidden="true">${q.icon}</span>
      <span class="muted small">You skipped today's check-in.</span>
      <button type="button" class="ci-link" data-act="change">Answer now</button></div>`;
    return;
  }

  const concern = CheckIn.isConcern(q, rec.a);
  el.className = 'checkin done';
  el.innerHTML = `${head}
    <p class="ci-done-q">${esc(q.q)}</p>
    <p class="ci-answer"><span class="ci-check" aria-hidden="true">✓</span> ${esc(CheckIn.answerLabel(q, rec.a))}</p>
    ${concern ? `<p class="ci-care">Sorry today is tough. Be gentle with yourself, and if this keeps up, consider talking to someone you trust or a health professional.</p>` : ''}
    <div class="ci-foot"><button type="button" class="ci-link" data-act="write">Write about it</button>
      <button type="button" class="ci-link" data-act="change">Change answer</button></div>`;
}

function answerCheckin(a) {
  const day = today();
  const all = getCheckins();
  const before = xpNow();
  const q = (all[day] && CheckIn.byId[all[day].q]) || CheckIn.questionFor(day);
  all[day] = { q: q.id, a, t: Date.now() };
  saveCheckins(all);
  checkinEditing = false;
  renderCheckin();
  renderLevelCard();
  const gained = xpNow() - before;
  if (gained > 0) toast(`Checked in. +${gained} XP ✨`);
  checkLevelUp();
}

$('#checkin').addEventListener('click', e => {
  const opt = e.target.closest('.ci-opt');
  if (opt) {
    const q = CheckIn.questionFor(today());
    const rec = getCheckins()[today()];
    const type = ((rec && CheckIn.byId[rec.q]) || q).type;
    answerCheckin(type === 'scale' ? Number(opt.dataset.a) : opt.dataset.a);
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'skip') answerCheckin(null);
  if (act === 'change') { checkinEditing = true; renderCheckin(); }
  if (act === 'cancel') { checkinEditing = false; renderCheckin(); }
  if (act === 'write') {
    const rec = getCheckins()[today()];
    const q = CheckIn.byId[rec.q];
    pendingPrefill = { title: 'Health check-in', body: `${q.q}\n${CheckIn.answerLabel(q, rec.a)}\n\n` };
    location.hash = '#/new';
  }
});

function renderCheckinHistory() {
  const all = getCheckins();
  const days = Object.keys(all).filter(k => all[k] && all[k].a !== null && all[k].a !== undefined).sort().reverse();
  const streak = CheckIn.streak(all, today());
  $('#checkin-history').innerHTML = !days.length
    ? '<p class="muted small">Answer the daily check-in on the home screen to start your health history.</p>'
    : `<div class="ci-stats"><span><b>${days.length}</b>check-ins</span><span><b>${streak}</b>day streak</span></div>` +
      days.slice(0, 14).map(k => {
        const q = CheckIn.byId[all[k].q];
        if (!q) return '';
        const d = parseStamp(k + 'T12:00');
        return `<div class="ci-hist"><span class="ci-hist-date">${esc(d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</span>
          <span class="ci-hist-q">${q.icon} ${esc(q.q)}</span><b>${esc(CheckIn.answerLabel(q, all[k].a))}</b></div>`;
      }).join('');
}

/* ---------- progress ---------- */
function renderProgress() {
  const info = Levels.levelInfo(xpNow());
  const words = entries.reduce((s, e) => s + Levels.wordCount(e), 0);
  $('#progress-hero').innerHTML = `
    <div class="hero-badge">${info.icon}</div>
    <p class="hero-level">Level ${info.level}</p>
    <h2 class="hero-title">${esc(info.title)}</h2>
    <div class="xpbar big"><i style="width:${Math.round(info.pct * 100)}%"></i></div>
    <p class="small hero-xp">${info.into} / ${info.need} XP to level ${info.level + 1}</p>
    ${info.nextTitle ? `<p class="small hero-next">Next title at level ${info.nextTitle.level}: ${info.nextTitle.icon} ${esc(info.nextTitle.title)}</p>` : ''}
    <div class="hero-stats">
      <span><b>${info.xp.toLocaleString()}</b>total XP</span>
      <span><b>${entries.length}</b>entries</span>
      <span><b>${words.toLocaleString()}</b>words</span>
    </div>`;
  const ms = Levels.milestones(info.level);
  const msDone = ms.filter(b => b.done).length;
  $('#milestones').innerHTML = `<p class="muted small badges-count">${msDone} unlocked. You earn a new one every 10 levels.</p>` + ms.map(b => `
    <div class="badge milestone ${b.done ? 'done' : ''}">
      <div class="badge-icon">${b.icon}</div>
      <div><b>${esc(b.name)}</b><span>${esc(b.desc)}</span>
        ${!b.done ? `<em>${esc(b.progress)}</em>` : ''}</div>
      ${b.done ? '<span class="badge-check">✓</span>' : ''}
    </div>`).join('');
  const list = Levels.badges(entries);
  const done = list.filter(b => b.done).length;
  $('#badges').innerHTML = `<p class="muted small badges-count">${done} of ${list.length} unlocked</p>` + list.map(b => `
    <div class="badge ${b.done ? 'done' : ''}">
      <div class="badge-icon">${b.icon}</div>
      <div><b>${esc(b.name)}</b><span>${esc(b.desc)}</span>
        ${!b.done && b.progress ? `<em>${esc(b.progress)}</em>` : ''}</div>
      ${b.done ? '<span class="badge-check">✓</span>' : ''}
    </div>`).join('');
  const X = Levels.XP;
  $('#xp-rules').innerHTML = `
    <div><span>Write an entry</span><b>+${X.entry}</b></div>
    <div><span>First entry of the day</span><b>+${X.newDay}</b></div>
    <div><span>Wrote yesterday too (streak)</span><b>+${X.streakDay}</b></div>
    <div><span>Every 10 words</span><b>+${X.per10Words} <small>(up to ${X.wordsCap})</small></b></div>
    <div><span>Pick a mood</span><b>+${X.mood}</b></div>
    <div><span>Add a photo</span><b>+${X.photo}</b></div>
    <div><span>Answer the daily health check-in</span><b>+${CHECKIN_XP}</b></div>`;
  renderCheckinHistory();
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
  const t = settings.get('theme', 'dark');
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
  const theme = settings.get('theme', 'dark');
  document.querySelectorAll('input[name=theme]').forEach(r => { r.checked = r.value === theme; });
  document.querySelectorAll('input[name=mapmode]').forEach(r => { r.checked = r.value === mapMode(); });
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
  const blob = new Blob([JSON.stringify({ app: 'diary', version: 1, exportedAt: new Date().toISOString(), entries: all, checkins: getCheckins() }, null, 1)],
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
    if (data && data.checkins && typeof data.checkins === 'object') saveCheckins({ ...data.checkins, ...getCheckins() });
    settings.set('seenLevel', Levels.levelInfo(xpNow()).level);
    toast(`Imported ${valid.length} entries`);
  } catch {
    toast('That file is not a valid diary backup');
  }
});

$('#btn-wipe').addEventListener('click', async () => {
  const ok = await dialog({ title: 'Delete ALL entries?', text: 'All entries and health check-ins will be erased from this device. Export a backup first if you might want them back.', okLabel: 'Delete everything', danger: true });
  if (!ok) return;
  await DB.clear();
  entries = [];
  saveCheckins({});
  toast('All entries deleted');
  location.hash = '#/';
});

/* ---------- invite friends ---------- */
// Shares only the app's address, never any entries.
function appLink() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}
async function invite() {
  const url = appLink();
  const text = "I'm keeping a diary with this app. It's private, works offline, and you level up as you write. Try it:";
  if (navigator.share) {
    try { await navigator.share({ title: 'Diary', text, url }); toast('Invite sent'); return; }
    catch (err) { if (err.name === 'AbortError') return; }   // closed the share menu
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Invite link copied. Paste it in a message');
  } catch {
    await dialog({ title: 'Invite friends', text: `Copy this link and send it to a friend: ${url}`, okLabel: 'Done' });
  }
}
document.querySelectorAll('.js-invite').forEach(b => b.addEventListener('click', invite));

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
  if (settings.get('seenLevel', null) === null) settings.set('seenLevel', Levels.levelInfo(xpNow()).level);
  if (!showLock()) $('#app').hidden = false;
  applyMapMode();
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
