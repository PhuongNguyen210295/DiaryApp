// Level-up system. XP is always recomputed from your entries, so it stays
// correct after imports, edits and deletes.
const Levels = (() => {
  const XP = {
    entry: 10,          // every entry
    per10Words: 1,      // +1 per 10 words…
    wordsCap: 40,       // …up to +40 per entry
    mood: 3,            // picked a mood
    photo: 5,           // added at least one photo
    newDay: 10,         // first entry of a day
    streakDay: 5,       // wrote the day before too
  };

  const TITLES = [
    [1, 'Blank Page', '📄'],
    [3, 'Scribbler', '✏️'],
    [5, 'Note Keeper', '📝'],
    [8, 'Storyteller', '📖'],
    [12, 'Chronicler', '🪶'],
    [16, 'Wordsmith', '⚒️'],
    [21, 'Memoirist', '🌟'],
    [27, 'Sage of Pages', '🦉'],
    [35, 'Legendary Author', '👑'],
  ];

  const wordCount = e => ((e.title || '') + ' ' + (e.body || '')).match(/\S+/g)?.length || 0;
  const day = e => e.date.slice(0, 10);
  const prevDay = key => {
    const d = new Date(key + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function entryXP(e) {
    return XP.entry
      + Math.min(Math.floor(wordCount(e) / 10) * XP.per10Words, XP.wordsCap)
      + (e.mood ? XP.mood : 0)
      + (e.photos && e.photos.length ? XP.photo : 0);
  }

  function totalXP(entries) {
    const days = new Set(entries.map(day));
    let xp = entries.reduce((sum, e) => sum + entryXP(e), 0);
    for (const d of days) {
      xp += XP.newDay;
      if (days.has(prevDay(d))) xp += XP.streakDay;
    }
    return xp;
  }

  // XP needed to go from level n to n+1: 50, 75, 100, 125, …
  const stepFor = n => 25 + 25 * n;

  function levelInfo(xp) {
    let level = 1, floor = 0;
    while (xp >= floor + stepFor(level)) { floor += stepFor(level); level++; }
    const need = stepFor(level);
    const [, title, icon] = [...TITLES].reverse().find(([min]) => level >= min);
    const next = TITLES.find(([min]) => min > level);
    return { xp, level, title, icon, into: xp - floor, need, pct: (xp - floor) / need,
             nextTitle: next ? { level: next[0], title: next[1], icon: next[2] } : null };
  }

  function longestStreak(entries) {
    const days = [...new Set(entries.map(day))].sort();
    let best = 0, run = 0, prev = null;
    for (const d of days) {
      run = prev && prevDay(d) === prev ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    }
    return best;
  }

  function badges(entries) {
    const words = entries.reduce((s, e) => s + wordCount(e), 0);
    const streak = longestStreak(entries);
    const moods = new Set(entries.map(e => e.mood).filter(Boolean));
    const photos = entries.filter(e => e.photos && e.photos.length).length;
    const hours = entries.map(e => Number(e.date.slice(11, 13)));
    const months = new Set(entries.map(e => e.date.slice(0, 7))).size;
    const longest = Math.max(0, ...entries.map(wordCount));
    const b = (icon, name, desc, done, progress) => ({ icon, name, desc, done, progress });
    return [
      b('🌱', 'First Step', 'Write your first entry', entries.length >= 1),
      b('🔥', 'On a Roll', 'Write 3 days in a row', streak >= 3, `${Math.min(streak, 3)}/3`),
      b('📅', 'Week Warrior', 'Write 7 days in a row', streak >= 7, `${Math.min(streak, 7)}/7`),
      b('🏆', 'Monthly Master', 'Write 30 days in a row', streak >= 30, `${Math.min(streak, 30)}/30`),
      b('📚', 'Ten Tales', 'Write 10 entries', entries.length >= 10, `${Math.min(entries.length, 10)}/10`),
      b('🗂️', 'Half Century', 'Write 50 entries', entries.length >= 50, `${Math.min(entries.length, 50)}/50`),
      b('💯', 'Centurion', 'Write 100 entries', entries.length >= 100, `${Math.min(entries.length, 100)}/100`),
      b('✍️', 'Deep Thoughts', 'Write a 300-word entry', longest >= 300, `${Math.min(longest, 300)}/300`),
      b('📜', 'Novelist', 'Write 10,000 words in total', words >= 10000, `${Math.min(words, 10000).toLocaleString()}/10,000`),
      b('🌈', 'Full Spectrum', 'Use all 5 moods', moods.size >= 5, `${moods.size}/5`),
      b('📸', 'Snapshot', 'Add photos to 5 entries', photos >= 5, `${Math.min(photos, 5)}/5`),
      b('🌙', 'Night Owl', 'Write after 11 pm', hours.some(h => h >= 23)),
      b('🌅', 'Early Bird', 'Write before 7 am', hours.some(h => h < 7)),
      b('🗓️', 'Season', 'Write in 3 different months', months >= 3, `${Math.min(months, 3)}/3`),
    ];
  }

  return { XP, entryXP, totalXP, levelInfo, badges, wordCount };
})();
