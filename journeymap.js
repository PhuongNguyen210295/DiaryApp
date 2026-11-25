// Draws a month as a star chart: a route through space where every day is a stop.
// Days you wrote are planets in your mood's colour, missed days are faint stars,
// and consecutive days light up a glowing streak lane. Day 1 launches at the bottom;
// the route ends at a planet on the last day of the month.
const JourneyMap = (() => {
  const W = 360;
  const COLS = [54, 138, 222, 306];
  const PER_ROW = COLS.length;
  const ROW_H = 92;
  const TOP = 132;
  const BOTTOM = 96;

  // each season gets its own nebula colours
  const NEBULAE = {
    winter: ['#3a6dff', '#6ee7ff', '#8f7bff'],
    spring: ['#21c79a', '#6ee7ff', '#5d8bff'],
    summer: ['#ff9f43', '#ff6bd5', '#ffd84d'],
    autumn: ['#ff5f6d', '#ff6bd5', '#8f7bff'],
  };
  const seasonOf = month => (month === 12 || month <= 2) ? 'winter' : month <= 5 ? 'spring' : month <= 8 ? 'summer' : 'autumn';
  const DECO = ['🛰️', '☄️', '🛸', '🌠', '✨'];

  // Seeded random numbers so each month's sky looks the same every time.
  function rng(seed) {
    let s = seed % 2147483647 || 1;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = n => n.toFixed(1);

  /**
   * opts: { month: 'YYYY-MM', byDay: {key: [entries]}, today: 'YYYY-MM-DD', selected, level: {level, icon},
   *         moodColor(id), moodEmoji(id), monthLabel }
   */
  function render(opts) {
    const [year, month] = opts.month.split('-').map(Number);
    const daysIn = new Date(year, month, 0).getDate();
    const rows = Math.ceil(daysIn / PER_ROW);
    const H = TOP + (rows - 1) * ROW_H + BOTTOM;
    const nebula = NEBULAE[seasonOf(month)];
    const rand = rng(year * 100 + month);
    // unique ids, so two maps on the page (home panel + full map) don't share gradients
    const P = opts.idPrefix || 'jm-';

    const pos = i => {
      const r = Math.floor(i / PER_ROW), c = i % PER_ROW;
      return { x: COLS[r % 2 === 0 ? c : PER_ROW - 1 - c], y: H - BOTTOM - r * ROW_H };
    };
    const key = i => `${opts.month}-${String(i + 1).padStart(2, '0')}`;
    const written = i => i >= 0 && i < daysIn && (opts.byDay[key(i)] || []).length > 0;

    const seg = (p, q) => {
      if (p.y === q.y) return `M${p.x} ${p.y} L${q.x} ${q.y}`;
      const side = p.x > W / 2 ? 1 : -1;
      return `M${p.x} ${p.y} C${p.x + side * 56} ${p.y} ${q.x + side * 56} ${q.y} ${q.x} ${q.y}`;
    };

    let svg = `<svg class="jm" viewBox="0 0 ${W} ${H}" role="group" aria-label="Star map for ${xmlEsc(opts.monthLabel)}">
      <defs>
        <radialGradient id="${P}shade" cx="35%" cy="30%" r="75%">
          <stop offset="0" stop-color="#fff" stop-opacity=".55"/>
          <stop offset=".45" stop-color="#fff" stop-opacity="0"/>
          <stop offset="1" stop-color="#050820" stop-opacity=".55"/>
        </radialGradient>
        <filter id="${P}blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="28"/></filter>
      </defs>
      <rect width="${W}" height="${H}" fill="#070b26"/>`;

    // nebula clouds
    for (let i = 0; i < 5; i++) {
      const cx = rand() * W, cy = 40 + rand() * (H - 80);
      svg += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(90 + rand() * 70)}" ry="${f(55 + rand() * 50)}"
        fill="${nebula[i % nebula.length]}" opacity="${f(.18 + rand() * .16)}" filter="url(#${P}blur)"/>`;
    }
    // background stars
    for (let i = 0; i < 110; i++) {
      const r = .35 + rand() * rand() * 1.4;
      svg += `<circle cx="${f(rand() * W)}" cy="${f(rand() * H)}" r="${f(r)}" fill="${rand() > .8 ? '#bfe9ff' : '#fff'}" opacity="${f(.25 + rand() * .65)}"/>`;
    }
    // a few passing craft between the rows, kept clear of the route
    for (let r = 0; r < rows; r += 2) {
      const y = H - BOTTOM - r * ROW_H - ROW_H / 2;
      svg += `<text x="${f(90 + rand() * 180)}" y="${f(y + 16)}" class="jm-deco" font-size="${f(15 + rand() * 5)}" opacity=".85">${DECO[Math.floor(rand() * DECO.length)]}</text>`;
    }

    // route: travelled lane, future lane, glowing streak lane where consecutive days are both written
    const todayIdx = opts.today.startsWith(opts.month) ? Number(opts.today.slice(8)) - 1
      : opts.today > opts.month ? daysIn : -1;
    let lane = '', future = '', streak = '';
    for (let i = 0; i < daysIn; i++) {
      const d = seg(pos(i), pos(i + 1));
      if (i + 1 > todayIdx) future += d; else lane += d;
      if (written(i) && written(i + 1)) streak += d;
    }
    svg += `<path d="${lane}" class="jm-lane"/><path d="${future}" class="jm-lane future"/>
            ${streak ? `<path d="${streak}" class="jm-streak"/>` : ''}`;

    // launch pad and destination planet
    const p0 = pos(0), goal = pos(daysIn);
    svg += `<g class="jm-launch" transform="translate(${p0.x - 32} ${p0.y + 44})">
        <rect width="64" height="20" rx="4"/><text x="32" y="14" text-anchor="middle">Launch</text></g>
      <circle cx="${goal.x}" cy="${goal.y}" r="30" fill="#9d8cff" opacity=".16"/>
      <text x="${goal.x}" y="${goal.y + 13}" text-anchor="middle" font-size="36" class="jm-deco">🪐</text>
      <text x="${goal.x}" y="${goal.y + 38}" text-anchor="middle" class="jm-goal-label">Day ${daysIn}</text>`;

    // day stops
    for (let i = 0; i < daysIn; i++) {
      const { x, y } = pos(i);
      const k = key(i);
      const list = opts.byDay[k] || [];
      const isFuture = k > opts.today;
      const label = `${i + 1} ${opts.monthLabel}${list.length ? `, ${list.length} entr${list.length > 1 ? 'ies' : 'y'}` : ''}`;
      svg += `<g class="jm-stop${isFuture ? ' future' : ''}" data-day="${k}" role="button" tabindex="0" aria-label="${xmlEsc(label)}">
        <circle cx="${x}" cy="${y}" r="26" class="jm-hit"/>`;
      if (k === opts.selected) svg += `<circle cx="${x}" cy="${y}" r="${list.length ? 27 : 14}" class="jm-sel"/>`;
      if (k === opts.today) svg += `<circle cx="${x}" cy="${y}" r="22" class="jm-pulse"/>`;
      if (list.length) {
        const mood = list[0].mood;
        const c = opts.moodColor(mood);
        svg += `<circle cx="${x}" cy="${y}" r="25" fill="${c}" opacity=".16"/>
          <g class="jm-planet">
            <circle cx="${x}" cy="${y}" r="18" fill="${c}"/>
            <circle cx="${x}" cy="${y}" r="18" fill="url(#${P}shade)"/>
          </g>
          <text x="${x}" y="${y + 5.5}" text-anchor="middle" font-size="15" pointer-events="none">${mood ? opts.moodEmoji(mood) : '✏️'}</text>
          <text x="${x}" y="${y + 35}" text-anchor="middle" class="jm-num">${i + 1}</text>`;
        if (list.length > 1) {
          svg += `<ellipse cx="${x}" cy="${y}" rx="27" ry="7" fill="none" stroke="${c}" stroke-width="1.4" opacity=".75" transform="rotate(-18 ${x} ${y})"/>
            <circle cx="${x + 17}" cy="${y - 16}" r="8" class="jm-count"/>
            <text x="${x + 17}" y="${y - 12.6}" text-anchor="middle" class="jm-count-t">${list.length}</text>`;
        }
      } else if (isFuture) {
        svg += `<circle cx="${x}" cy="${y}" r="2.5" fill="none" stroke="rgba(201,209,255,.45)" stroke-width="1"/>
          <text x="${x}" y="${y + 18}" text-anchor="middle" class="jm-num">${i + 1}</text>`;
      } else {
        svg += `<circle cx="${x}" cy="${y}" r="7" fill="#c9d1ff" opacity=".12"/>
          <circle cx="${x}" cy="${y}" r="3.2" fill="#e3e8ff"/>
          <text x="${x}" y="${y + 19}" text-anchor="middle" class="jm-num">${i + 1}</text>`;
      }
      svg += '</g>';
    }

    // your ship: level badge hovering over today
    if (opts.today.startsWith(opts.month)) {
      const { x, y } = pos(todayIdx);
      const hex = r => [0, 60, 120, 180, 240, 300].map(a => `${f(r * Math.cos(a * Math.PI / 180))},${f(r * Math.sin(a * Math.PI / 180))}`).join(' ');
      svg += `<g class="jm-avatar" transform="translate(${x} ${y - 46})" pointer-events="none">
          <g class="jm-bob">
            <path d="M-6 15 L0 23 L6 15 Z" fill="#6ee7ff"/>
            <polygon points="${hex(21)}" fill="#6ee7ff"/>
            <polygon points="${hex(19)}" fill="#151c4e"/>
            <text y="7" text-anchor="middle" font-size="19">${opts.level.icon}</text>
            <rect x="-17" y="-33" width="34" height="15" rx="4" class="jm-lv"/>
            <text y="-22" text-anchor="middle" class="jm-lv-t">Lv ${opts.level.level}</text>
          </g></g>`;
    }
    return svg + '</svg>';
  }

  return { render };
})();
