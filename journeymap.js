// Draws a month as an adventure map: a winding trail where every day is a stop.
// Day 1 starts at the bottom; the trail snakes upward to a castle at month's end.
const JourneyMap = (() => {
  const W = 360;
  const COLS = [54, 138, 222, 306];
  const PER_ROW = COLS.length;
  const ROW_H = 92;
  const TOP = 132;
  const BOTTOM = 96;

  const SEASONS = {
    winter: { sky: '#eaf5ff', ground: '#d4e9fb', hill: '#f7fbff', deco: ['🌲', '⛄', '❄️', '🌲', '🏔️', '🦌'] },
    spring: { sky: '#eefbe8', ground: '#cdeec2', hill: '#e2f7d9', deco: ['🌸', '🌷', '🌳', '🦋', '🌼', '🐰'] },
    summer: { sky: '#fff7d6', ground: '#c9f0cf', hill: '#ffefb0', deco: ['🌻', '🌳', '🌴', '🐝', '🌼', '🍉'] },
    autumn: { sky: '#fff3e2', ground: '#ffdcbc', hill: '#ffe9cf', deco: ['🍁', '🍂', '🌳', '🍄', '🎃', '🦔'] },
  };
  const seasonOf = month => (month === 12 || month <= 2) ? 'winter' : month <= 5 ? 'spring' : month <= 8 ? 'summer' : 'autumn';

  // Small seeded random generator so each month's scenery is the same every time.
  function rng(seed) {
    let s = seed % 2147483647 || 1;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * opts: { month: 'YYYY-MM', byDay: {key: [entries]}, today: 'YYYY-MM-DD', selected, level: {level, icon},
   *         moodColor(id), moodEmoji(id), monthLabel }
   */
  function render(opts) {
    const [year, month] = opts.month.split('-').map(Number);
    const daysIn = new Date(year, month, 0).getDate();
    const rows = Math.ceil(daysIn / PER_ROW);
    const H = TOP + (rows - 1) * ROW_H + BOTTOM;
    const season = SEASONS[seasonOf(month)];
    const rand = rng(year * 100 + month);

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

    let svg = `<svg class="jm" viewBox="0 0 ${W} ${H}" role="group" aria-label="Journey map for ${xmlEsc(opts.monthLabel)}">
      <defs>
        <linearGradient id="jm-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${season.sky}"/><stop offset="1" stop-color="${season.ground}"/>
        </linearGradient>
        <filter id="jm-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#5a3a10" flood-opacity=".25"/>
        </filter>
      </defs>
      <rect class="jm-ground" width="${W}" height="${H}" rx="22" fill="url(#jm-bg)"/>`;

    // rolling hills
    for (let i = 0; i < 4; i++) {
      const cx = rand() * W, cy = TOP + rand() * (H - TOP - 40);
      svg += `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${(70 + rand() * 60).toFixed(0)}" ry="${(26 + rand() * 18).toFixed(0)}" fill="${season.hill}" opacity=".7"/>`;
    }
    // clouds
    svg += `<text x="${(40 + rand() * 60).toFixed(0)}" y="40" class="jm-deco" font-size="26" opacity=".85">☁️</text>
            <text x="${(250 + rand() * 60).toFixed(0)}" y="62" class="jm-deco" font-size="20" opacity=".7">☁️</text>`;
    // scenery between the rows, kept clear of the trail
    for (let r = 0; r < rows; r++) {
      const y = H - BOTTOM - r * ROW_H - ROW_H / 2;
      for (let k = 0; k < 2; k++) {
        const x = 78 + rand() * 210;
        const icon = season.deco[Math.floor(rand() * season.deco.length)];
        svg += `<text x="${x.toFixed(0)}" y="${(y + 17 + (rand() - .5) * 6).toFixed(0)}" class="jm-deco" font-size="${(17 + rand() * 6).toFixed(0)}">${icon}</text>`;
      }
    }

    // trail: sand path, dashed centre line, golden overlay where consecutive days are both written
    const todayIdx = opts.today.startsWith(opts.month) ? Number(opts.today.slice(8)) - 1
      : opts.today > opts.month ? daysIn : -1;
    let trail = '', future = '', gold = '';
    for (let i = 0; i < daysIn; i++) {
      const d = seg(pos(i), pos(i + 1));
      if (i + 1 > todayIdx) future += d; else trail += d;
      if (written(i) && written(i + 1)) gold += seg(pos(i), pos(i + 1));
    }
    svg += `<path d="${trail}" class="jm-trail"/><path d="${trail}" class="jm-trail-dash"/>
            <path d="${future}" class="jm-trail future"/>
            ${gold ? `<path d="${gold}" class="jm-gold"/>` : ''}`;

    // start sign and goal castle
    const p0 = pos(0), goal = pos(daysIn);
    svg += `<g class="jm-sign" transform="translate(${p0.x - 30} ${p0.y + 46})">
        <rect width="60" height="22" rx="6"/><text x="30" y="15.5" text-anchor="middle">Start</text></g>
      <text x="${goal.x}" y="${goal.y + 12}" text-anchor="middle" font-size="36" class="jm-deco">🏰</text>
      <text x="${goal.x}" y="${goal.y + 34}" text-anchor="middle" class="jm-goal-label">Day ${daysIn}</text>`;

    // stops
    for (let i = 0; i < daysIn; i++) {
      const { x, y } = pos(i);
      const k = key(i);
      const list = opts.byDay[k] || [];
      const isFuture = k > opts.today;
      const isToday = k === opts.today;
      const label = `${i + 1} ${opts.monthLabel}${list.length ? `, ${list.length} entr${list.length > 1 ? 'ies' : 'y'}` : ''}`;
      svg += `<g class="jm-stop${isFuture ? ' future' : ''}" data-day="${k}" role="button" tabindex="0" aria-label="${xmlEsc(label)}">`;
      if (k === opts.selected) svg += `<circle cx="${x}" cy="${y}" r="${list.length ? 28 : 21}" class="jm-sel"/>`;
      if (isToday) svg += `<circle cx="${x}" cy="${y}" r="24" class="jm-pulse"/>`;
      if (list.length) {
        const mood = list[0].mood;
        svg += `<circle cx="${x}" cy="${y}" r="21" fill="${opts.moodColor(mood)}" class="jm-done" filter="url(#jm-shadow)"/>
          <text x="${x}" y="${y + 6.5}" text-anchor="middle" font-size="19">${mood ? opts.moodEmoji(mood) : '✏️'}</text>
          <text x="${x}" y="${y + 36}" text-anchor="middle" class="jm-num">${i + 1}</text>`;
        if (list.length > 1) svg += `<circle cx="${x + 16}" cy="${y - 16}" r="8.5" class="jm-count"/>
          <text x="${x + 16}" y="${y - 12.5}" text-anchor="middle" class="jm-count-t">${list.length}</text>`;
      } else if (isFuture) {
        svg += `<circle cx="${x}" cy="${y}" r="12" class="jm-empty future"/>
          <text x="${x}" y="${y + 4}" text-anchor="middle" class="jm-num small">${i + 1}</text>`;
      } else {
        svg += `<circle cx="${x}" cy="${y}" r="14" class="jm-empty"/>
          <text x="${x}" y="${y + 4}" text-anchor="middle" class="jm-num small">${i + 1}</text>`;
      }
      svg += '</g>';
    }

    // you are here
    if (opts.today.startsWith(opts.month)) {
      const { x, y } = pos(todayIdx);
      svg += `<g class="jm-avatar" transform="translate(${x} ${y - 46})" pointer-events="none">
          <g class="jm-bob">
            <path d="M-7 15 L0 24 L7 15 Z" fill="#fff"/>
            <circle r="19" fill="#fff" filter="url(#jm-shadow)"/>
            <text y="7" text-anchor="middle" font-size="21">${opts.level.icon}</text>
            <rect x="-17" y="-31" width="34" height="15" rx="7.5" class="jm-lv"/>
            <text y="-20" text-anchor="middle" class="jm-lv-t">Lv ${opts.level.level}</text>
          </g></g>`;
    }
    return svg + '</svg>';
  }

  return { render };
})();
