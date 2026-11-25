// Daily health check-in: one question a day from a fixed bank.
// Every question is asked once before any repeats.
const CheckIn = (() => {
  const scale = (low, high, faces) => ({ type: 'scale', low, high, faces: faces || ['😣', '😕', '😐', '🙂', '😄'] });
  const yesNo = () => ({ type: 'choice', options: ['Yes', 'No'] });
  const choice = (...options) => ({ type: 'choice', options });

  // concern(answer) → true when the answer suggests it's worth looking after yourself a bit more.
  const QUESTIONS = [
    { id: 'sleep-hours', icon: '🛏️', q: 'How many hours did you sleep last night?', ...choice('Under 5', '5–6', '7–8', '9+'), concern: a => a === 'Under 5' },
    { id: 'sleep-quality', icon: '🌙', q: 'How well did you sleep?', ...scale('Badly', 'Great') },
    { id: 'energy', icon: '⚡', q: 'How is your energy today?', ...scale('Drained', 'Full of energy') },
    { id: 'water', icon: '💧', q: 'How many glasses of water have you had today?', ...choice('0–2', '3–5', '6–8', '9+') },
    { id: 'move', icon: '🏃', q: 'Did you move your body for at least 20 minutes today?', ...yesNo() },
    { id: 'stress', icon: '🌡️', q: 'How stressed do you feel right now?', ...scale('Calm', 'Very stressed', ['😌', '🙂', '😐', '😟', '😫']), concern: a => a === 5 },
    { id: 'pain', icon: '🩹', q: 'Are you feeling any pain or discomfort today?', ...choice('None', 'A little', 'Moderate', 'A lot'), concern: a => a === 'A lot' },
    { id: 'meals', icon: '🍲', q: 'How many proper meals have you eaten today?', ...choice('0', '1', '2', '3+'), concern: a => a === '0' },
    { id: 'veg', icon: '🥦', q: 'Did you eat fruit or vegetables today?', ...yesNo() },
    { id: 'outdoors', icon: '🌳', q: 'Did you spend some time outdoors today?', ...yesNo() },
    { id: 'screens', icon: '📱', q: 'How much time have you spent on screens outside work today?', ...choice('Under 1 h', '1–3 h', '3–5 h', '5 h+') },
    { id: 'mood', icon: '💭', q: 'Overall, how do you feel today?', ...scale('Very low', 'Great'), concern: a => a === 1 },
    { id: 'social', icon: '💬', q: 'Did you talk with a friend or family member today?', ...yesNo() },
    { id: 'headache', icon: '🤕', q: 'Have you had a headache today?', ...yesNo() },
    { id: 'caffeine', icon: '☕', q: 'How many caffeinated drinks have you had today?', ...choice('None', '1', '2', '3+') },
    { id: 'breaks', icon: '🧘', q: 'Did you take breaks to stretch or rest your eyes today?', ...yesNo() },
    { id: 'anxiety', icon: '🌊', q: 'How anxious or worried do you feel today?', ...scale('Not at all', 'Very', ['😌', '🙂', '😐', '😟', '😰']), concern: a => a === 5 },
    { id: 'bedtime', icon: '🕛', q: 'Did you go to bed before midnight last night?', ...yesNo() },
    { id: 'body', icon: '💪', q: 'How does your body feel today?', ...scale('Stiff and sore', 'Great') },
    { id: 'smile', icon: '😊', q: 'Did something make you smile today?', ...yesNo() },
    { id: 'alcohol', icon: '🍷', q: 'Did you have any alcohol today?', ...choice('None', '1–2 drinks', '3+ drinks') },
    { id: 'walk', icon: '👟', q: 'Roughly how much did you walk today?', ...choice('Barely', 'A little', 'A fair bit', 'A lot') },
    { id: 'focus', icon: '🎯', q: 'How well could you focus today?', ...scale('Not at all', 'Very well') },
    { id: 'appetite', icon: '🍽️', q: 'How is your appetite today?', ...choice('Low', 'Normal', 'High') },
    { id: 'relax', icon: '🛀', q: 'Did you do something relaxing just for yourself today?', ...yesNo() },
    { id: 'cold', icon: '🤧', q: 'Do you have any cold or flu symptoms today?', ...yesNo(), concern: a => a === 'Yes' },
    { id: 'sunlight', icon: '☀️', q: 'Did you get some daylight this morning?', ...yesNo() },
    { id: 'connected', icon: '🤝', q: 'How connected to other people do you feel today?', ...scale('Lonely', 'Very connected'), concern: a => a === 1 },
    { id: 'medicine', icon: '💊', q: 'Did you take the medicine or vitamins you need today?', ...choice('Yes', 'No', "I don't take any") },
    { id: 'physical', icon: '❤️', q: 'How would you rate your physical health today?', ...scale('Poor', 'Excellent'), concern: a => a === 1 },
  ];
  const byId = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));

  const dayNumber = key => Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 864e5);

  // One fixed shuffled order that loops: any 30 days in a row get 30 different questions.
  const ORDER = (() => {
    let s = 20261125;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const order = QUESTIONS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return order;
  })();
  function questionFor(dayKey) {
    const N = QUESTIONS.length;
    return QUESTIONS[ORDER[((dayNumber(dayKey) % N) + N) % N]];
  }

  function answerLabel(q, a) {
    if (a === null || a === undefined) return 'Skipped';
    if (q.type === 'scale') return `${q.faces[a - 1]} ${a}/5`;
    return String(a);
  }

  const isConcern = (q, a) => !!(q && q.concern && a !== null && q.concern(a));

  // Consecutive days (ending today, or yesterday if today isn't answered yet) with an answer.
  function streak(checkins, todayKey) {
    const answered = k => checkins[k] && checkins[k].a !== null && checkins[k].a !== undefined;
    const d = new Date(todayKey + 'T12:00:00');
    const key = () => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!answered(key())) d.setDate(d.getDate() - 1);
    let n = 0;
    while (answered(key())) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  return { QUESTIONS, byId, questionFor, answerLabel, isConcern, streak };
})();
