import { api, DEMO } from './api.js';
import { CONFIG } from './config.js';

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const GOAL = CONFIG.WATER_GOAL_ML;
const DEFAULT_COLORS = ['#0f9b8e', '#e5487b'];
const COLOR_CHOICES = ['#0f9b8e', '#e5487b', '#3b82f6', '#f59e0b', '#8b5cf6', '#22a35a'];
const WATER_BUTTONS = [150, 250, 330, 500];
// Увеличивайте при каждом обновлении: телефон увидит новую версию и сбросит старый кэш.
// Номер виден внизу вкладки «Ещё».
const APP_VERSION = 4;

// ---------- даты и форматирование ----------
const dayStr = (d = new Date()) => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD по местному времени
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return dayStr(d); };
const fmtDay = (s, o = { day: 'numeric', month: 'long' }) => new Date(s + 'T12:00:00').toLocaleDateString('ru-RU', o);
const fmtNum = (n) => Number(n).toLocaleString('ru-RU');
const fmtKg = (n) => Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtDiff = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmtKg(Math.abs(n));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  tab: 'today', people: [], weights: [], water: [], steps: [], sleep: [], brushing: [],
  weightRange: 30, stepsRange: 7, sleepRange: 7,
};

const me = () => state.people.find((p) => p.id === api.uid);
const partner = () => state.people.find((p) => p.id !== api.uid);
const colorOf = (p) => p?.color || DEFAULT_COLORS[state.people.indexOf(p)] || DEFAULT_COLORS[0];
const nameOf = (p) => (p?.name || '').trim() || (p?.id === api.uid ? 'Я' : 'Партнёр');

// ---------- тема: светлая / тёмная / как в системе (хранится на каждом устройстве) ----------
const THEME_BG = { light: '#f4f6f5', dark: '#111514' };
const getTheme = () => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } };
function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  // Цвет полосы браузера/статус-бара: при ручной теме одинаковый для обеих схем
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.content = THEME_BG[t] ?? (m.media.includes('dark') ? THEME_BG.dark : THEME_BG.light);
  });
  try { if (t === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', t); } catch { /* приватный режим */ }
}
applyTheme(getTheme());

// ---------- загрузка ----------
async function loadAll() {
  const today = dayStr();
  const [people, weights, water, steps, sleep, brushing] = await Promise.all([
    api.profiles(), api.weights('2000-01-01'), api.water(today),
    api.steps(addDays(today, -120)), api.sleep(addDays(today, -120)), api.brushing(addDays(today, -30)),
  ]);
  // Я всегда первый, партнёр второй — так проще раскладывать
  people.sort((a, b) => (a.id === api.uid ? -1 : b.id === api.uid ? 1 : a.id.localeCompare(b.id)));
  Object.assign(state, { people, weights, water, steps, sleep, brushing, loadedDay: today });
}

async function refresh() {
  try { await loadAll(); render(); } catch (e) { toast(errText(e)); }
}

function errText(e) {
  const m = e?.message || String(e);
  if (/Invalid login/i.test(m)) return 'Неверная почта или пароль';
  if (/fetch|network/i.test(m)) return 'Нет связи с сервером';
  return m;
}

let toastTimer;
function toast(text) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.append(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- расчёты ----------
const waterTotal = (uid) => state.water.filter((w) => w.user_id === uid).reduce((s, w) => s + w.ml, 0);
const weightsOf = (uid) => state.weights.filter((w) => w.user_id === uid).map((w) => ({ ...w, kg: Number(w.kg) }));
const stepsOn = (uid, day) => state.steps.find((s) => s.user_id === uid && s.day === day)?.steps;
const sleepOn = (uid, day) => state.sleep.find((s) => s.user_id === uid && s.day === day);
// Только ночи с отмеченным подъёмом идут в графики, средние и оценки
const fullSleepOn = (uid, day) => { const s = sleepOn(uid, day); return s?.wake ? s : undefined; };
const nowHM = () => new Date().toTimeString().slice(0, 5);
// На какую ночь записать отбой: днём и вечером — на завтрашнее утро, после полуночи — на сегодняшнее
const bedNightDay = () => (new Date().getHours() >= 12 ? addDays(dayStr(), 1) : dayStr());

// Сон: время «ЧЧ:ММ» → минуты от полуночи; длительность считаем через полночь
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => { const r = Math.round(m) % 1440; return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`; };
const sleepMin = (s) => (toMin(s.wake) - toMin(s.bed) + 1440) % 1440 || 1440;
const fmtDur = (min) => `${Math.floor(min / 60)} ч${Math.round(min % 60) ? ` ${Math.round(min % 60)} мин` : ''}`;
// Среднее время отхода ко сну: «01:00» считаем как 25:00, чтобы не смешалось с вечером
const avgBed = (list) => fromMin(list.reduce((a, s) => { const m = toMin(s.bed); return a + (m < 720 ? m + 1440 : m); }, 0) / list.length);
const avgWake = (list) => fromMin(list.reduce((a, s) => a + toMin(s.wake), 0) / list.length);

// ---------- оценка: плохо / хорошо / отлично ----------
const RATINGS = ['Плохо', 'Хорошо', 'Отлично'];
// Зубы: сколько полных чисток за день; значение по умолчанию, если в config.js его нет
const RATING = { teeth: [1, 2], ...CONFIG.RATING };
const RATE_FMT = {
  water: (v) => `${fmtNum(v / 1000)} л`,
  steps: (v) => fmtNum(v),
  sleep: (v) => fmtDur(v),
};
// Подписи делений, где «меньше … / … и больше» звучит неестественно
const RATE_RANGES = { teeth: ['ни разу', '1 раз', '2 раза'] };
const rate = (kind, v) => {
  if (v == null) return null;
  const [ok, great] = RATING[kind];
  return v >= great ? 2 : v >= ok ? 1 : 0;
};
const badge = (kind, v) => { const r = rate(kind, v); return r == null ? '' : `<span class="rate r${r}">${RATINGS[r]}</span>`; };

// Шкала из трёх делений с границами; текущее значение подсвечено
function scale(kind, v) {
  const r = rate(kind, v);
  const [ok, great] = RATING[kind].map(RATE_FMT[kind] ?? String);
  const ranges = RATE_RANGES[kind] ?? [`меньше ${ok}`, `${ok} – ${great}`, `${great} и больше`];
  return `<div class="scale">${RATINGS.map((name, i) =>
    `<div class="r${i}${r === i ? ' on' : ''}"><b>${name}</b><span>${ranges[i]}</span></div>`).join('')}</div>`;
}

// «Отлично 3 · Хорошо 2 · Плохо 1» за период
function rateCounts(kind, values) {
  const n = [0, 0, 0];
  values.forEach((v) => n[rate(kind, v)]++);
  return [2, 1, 0].filter((i) => n[i]).map((i) => `<span class="rate r${i}">${RATINGS[i]} ${n[i]}</span>`).join(' ');
}

// ---------- графики (SVG) ----------
function ring(value, goal, color) {
  const r = 52, c = 2 * Math.PI * r, p = Math.min(value / goal, 1);
  return `<svg viewBox="0 0 120 120" class="ring" aria-hidden="true">
    <circle cx="60" cy="60" r="${r}" class="ring-bg"/>
    <circle cx="60" cy="60" r="${r}" stroke="${color}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}"
      transform="rotate(-90 60 60)" class="ring-fg"/>
  </svg>`;
}

function lineChart(points, color, fromDay, toDay) {
  if (points.length === 0) return '<div class="empty">Пока нет записей за этот период</div>';
  const W = 320, H = 150, L = 34, R = 10, T = 10, B = 22;
  const t0 = new Date(fromDay + 'T12:00:00').getTime(), t1 = new Date(toDay + 'T12:00:00').getTime();
  const span = Math.max(t1 - t0, 1);
  const kgs = points.map((p) => p.kg);
  let lo = Math.min(...kgs), hi = Math.max(...kgs);
  const pad = Math.max((hi - lo) * 0.15, 0.5); lo -= pad; hi += pad;
  const x = (d) => L + ((new Date(d + 'T12:00:00').getTime() - t0) / span) * (W - L - R);
  const y = (kg) => T + (1 - (kg - lo) / (hi - lo)) * (H - T - B);
  const grid = [0, 0.5, 1].map((f) => {
    const v = lo + (hi - lo) * f;
    return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${L - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v.toFixed(1)}</text>`;
  }).join('');
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ');
  const dots = points.length <= 60 ? points.map((p) => `<circle cx="${x(p.day)}" cy="${y(p.kg)}" r="3" fill="${color}"/>`).join('') : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="График веса">
    ${grid}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    <text x="${L}" y="${H - 6}" class="axis">${fmtDay(fromDay, { day: 'numeric', month: 'short' })}</text>
    <text x="${W - R}" y="${H - 6}" class="axis" text-anchor="end">${fmtDay(toDay, { day: 'numeric', month: 'short' })}</text>
  </svg>`;
}

// valueOf(person, day) → число или null; niceTop(max) → верх шкалы; label(v) → подпись оси
function barChart(days, people, { valueOf, niceTop, label, aria, guide }) {
  const W = 320, H = 160, L = 34, R = 6, T = 10, B = 22;
  const vals = days.flatMap((d) => people.map((p) => valueOf(p, d) || 0));
  const top = niceTop(Math.max(...vals));
  const slot = (W - L - R) / days.length;
  const bw = Math.max(Math.min((slot - 4) / people.length, 16), 2);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(top * f)}" y2="${y(top * f)}" class="grid"/>
    <text x="${L - 6}" y="${y(top * f) + 4}" class="axis" text-anchor="end">${label(top * f)}</text>`).join('');
  // Пунктир на границе «Отлично»
  const goalLine = guide != null && guide <= top
    ? `<line x1="${L}" x2="${W - R}" y1="${y(guide)}" y2="${y(guide)}" class="guide"/>` : '';
  const bars = days.map((d, i) => {
    const cx = L + slot * i + slot / 2;
    return people.map((p, j) => {
      const v = valueOf(p, d) || 0;
      const bx = cx - (bw * people.length) / 2 + bw * j;
      return v ? `<rect x="${bx}" y="${y(v)}" width="${bw - 1}" height="${y(0) - y(v)}" rx="2" fill="${colorOf(p)}"/>` : '';
    }).join('');
  }).join('');
  const every = Math.ceil(days.length / 7);
  const labels = days.map((d, i) => (days.length - 1 - i) % every === 0
    ? `<text x="${L + slot * i + slot / 2}" y="${H - 6}" class="axis" text-anchor="middle">${days.length <= 7 ? fmtDay(d, { weekday: 'short' }) : fmtDay(d, { day: 'numeric' })}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${aria}">${grid}${goalLine}${bars}${labels}</svg>`;
}

const legend = (people) => `<div class="legend">${people.map((p) =>
  `<span><i style="background:${colorOf(p)}"></i>${esc(nameOf(p))}</span>`).join('')}</div>`;

const lastDays = (n) => { const today = dayStr(); return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1)); };

const seg = (act, current, options) => `<div class="seg">${options.map(([v, l]) =>
  `<button data-act="${act}" data-v="${v}" class="${current === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;

// ---------- экраны ----------
function viewToday() {
  const today = dayStr();
  const m = me(), pt = partner();
  const myWater = waterTotal(m.id);
  const myEntries = state.water.filter((w) => w.user_id === m.id);
  const myWeight = weightsOf(m.id).find((w) => w.day === today);
  const mySteps = stepsOn(m.id, today);

  const weightRow = (p) => {
    const ws = weightsOf(p.id);
    const last = ws.at(-1), prev = ws.at(-2), first = ws[0];
    const isToday = last?.day === today;
    return `<div class="person-row">
      <span class="dot" style="background:${colorOf(p)}"></span>
      <span class="who">${esc(nameOf(p))}</span>
      <span class="val">${last ? fmtKg(last.kg) + ' кг' : '—'}</span>
      <span class="sub">${last ? (isToday ? 'сегодня' : fmtDay(last.day, { day: 'numeric', month: 'short' })) +
        (prev ? ` · ${fmtDiff(last.kg - prev.kg)}` : '') +
        (first && first !== last ? ` · всего ${fmtDiff(last.kg - first.kg)}` : '') : 'нет записей'}</span>
    </div>`;
  };

  return `
  <header class="top"><h1>Сегодня</h1><span class="date">${fmtDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}</span></header>

  <section class="card">
    <h2>💧 Вода ${myWater ? badge('water', myWater) : ''}</h2>
    <div class="water-main">
      <div class="ring-wrap">${ring(myWater, GOAL, colorOf(m))}
        <div class="ring-label"><b>${fmtNum(myWater)}</b><span>из ${fmtNum(GOAL)} мл</span></div>
      </div>
      <div class="water-btns">
        ${WATER_BUTTONS.map((ml) => `<button class="chip" data-act="water" data-ml="${ml}">+${ml}</button>`).join('')}
        <form data-form="water" class="water-custom">
          <input name="ml" type="number" inputmode="numeric" min="1" max="5000" placeholder="мл" required>
          <button class="chip solid">+</button>
        </form>
      </div>
    </div>
    ${myWater ? scale('water', myWater) : ''}
    ${myEntries.length ? `<div class="entries">${myEntries.map((w) => `<button class="entry" data-act="del-water" data-id="${w.id}"
      title="Удалить">${w.ml} мл · ${new Date(w.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} <span>×</span></button>`).join('')}</div>` : ''}
    ${pt ? `<div class="partner-bar">
      <span class="who">${esc(nameOf(pt))}</span>
      <div class="bar"><div style="width:${Math.min(waterTotal(pt.id) / GOAL, 1) * 100}%;background:${colorOf(pt)}"></div></div>
      <span class="sub">${fmtNum(waterTotal(pt.id))} / ${fmtNum(GOAL)} ${waterTotal(pt.id) ? badge('water', waterTotal(pt.id)) : ''}</span>
    </div>` : ''}
  </section>

  <section class="card">
    <h2>⚖️ Вес</h2>
    <form data-form="weight" class="inline-form">
      <input name="kg" type="number" inputmode="decimal" step="0.1" min="20" max="400" placeholder="Мой вес, кг"
        value="${myWeight ? myWeight.kg : ''}" required>
      <button class="btn">${myWeight ? 'Изменить' : 'Записать'}</button>
    </form>
    ${state.people.map(weightRow).join('')}
  </section>

  ${sleepCard(m, today)}

  ${teethCard(today)}

  <section class="card">
    <h2>👟 Шаги ${mySteps != null ? badge('steps', mySteps) : ''}</h2>
    <form data-form="steps" class="inline-form">
      <input name="steps" type="number" inputmode="numeric" min="0" max="199999" placeholder="Мои шаги за сегодня"
        value="${mySteps ?? ''}" required>
      <button class="btn">${mySteps != null ? 'Изменить' : 'Записать'}</button>
    </form>
    ${mySteps != null ? scale('steps', mySteps) : ''}
    ${state.people.map((p) => {
      const s = stepsOn(p.id, today);
      return `<div class="person-row"><span class="dot" style="background:${colorOf(p)}"></span>
        <span class="who">${esc(nameOf(p))}</span><span class="val">${s != null ? fmtNum(s) : '—'}</span>
        <span class="sub">${s != null ? `шагов ${badge('steps', s)}` : 'ещё не внесено'}</span></div>`;
    }).join('')}
    <p class="hint">Шаги смотрите в приложении «Здоровье» и вносите вечером, до 23:00.</p>
  </section>`;
}

// Сон в два шага: вечером записываем отбой, утром одной кнопкой отмечаем подъём.
// Ночь хранится на дату пробуждения: last — ночь, после которой проснулись сегодня,
// next — отбой, записанный на предстоящую ночь.
function sleepCard(m, today) {
  const hour = new Date().getHours();
  const afternoon = hour >= 12;
  const last = sleepOn(m.id, today);
  const next = sleepOn(m.id, addDays(today, 1));
  const lastForm = () => `<form data-form="sleep" class="form-grid">
      <label>Лёг<input name="bed" type="time" value="${last?.bed ?? ''}" required></label>
      <label>Встал<input name="wake" type="time" value="${last?.wake ?? ''}"></label>
      <button class="btn full">Сохранить</button>
    </form>`;

  let morning;
  if (last && !last.wake) {
    const greet = hour < 5 ? 'Утром отметьте подъём.' : afternoon ? 'Во сколько проснулись?' : 'Доброе утро!';
    morning = `<p class="row-text">🌙 Отбой был в <b>${last.bed}</b>. ${greet}</p>
      <form data-form="wake" class="inline-form">
        <input name="wake" type="time" value="${nowHM()}" required>
        <button class="btn">Проснулся</button>
      </form>`;
  } else if (last) {
    morning = `${scale('sleep', sleepMin(last))}
      <details class="edit"><summary>Прошлая ночь: ${last.bed} – ${last.wake} · изменить</summary>${lastForm()}</details>`;
  } else if (!afternoon) {
    morning = `<p class="row-text">Во сколько легли и проснулись? Если ещё не ложились, укажите только «Лёг».</p>${lastForm()}`;
  } else {
    morning = `<details class="edit"><summary>Внести прошлую ночь</summary>${lastForm()}</details>`;
  }

  const evening = afternoon ? `<div class="bedtime">
      <p class="row-text">${next ? `🌙 Сегодня отбой в <b>${next.bed}</b>` : 'Во сколько ложитесь сегодня?'}</p>
      <form data-form="bed" class="inline-form">
        <input name="bed" type="time" value="${next?.bed ?? ''}" required>
        <button class="btn">${next ? 'Изменить' : 'Записать'}</button>
      </form>
      ${next ? '' : '<button type="button" class="chip wide" data-act="bed-now">🌙 Ложусь прямо сейчас</button>'}
    </div>` : '';

  return `<section class="card">
    <h2>😴 Сон ${last?.wake ? badge('sleep', sleepMin(last)) : ''}</h2>
    ${morning}
    ${evening}
    ${state.people.map((p) => {
      const s = sleepOn(p.id, today), n = sleepOn(p.id, addDays(today, 1));
      const sub = s?.wake ? `${s.bed} – ${s.wake} ${badge('sleep', sleepMin(s))}`
        : s ? `отбой в ${s.bed}, подъём не отмечен` : 'ещё не внесено';
      return `<div class="person-row"><span class="dot" style="background:${colorOf(p)}"></span>
        <span class="who">${esc(nameOf(p))}</span><span class="val">${s?.wake ? fmtDur(sleepMin(s)) : '—'}</span>
        <span class="sub">${sub}${n ? ` · сегодня отбой в ${n.bed}` : ''}</span></div>`;
    }).join('')}
  </section>`;
}

// Зубы: в норму идут только полные чистки (2:00); остановленные раньше видны красным
const BRUSH_SEC = 120;
const brushingOn = (uid, day) => state.brushing.filter((b) => b.user_id === uid && b.day === day);
const fullBrushes = (uid, day) => brushingOn(uid, day).filter((b) => b.seconds >= BRUSH_SEC).length;
const fmtSec = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hm = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function teethCard(today) {
  const myCount = fullBrushes(api.uid, today);
  const week = lastDays(7);
  const session = (b) => b.seconds >= BRUSH_SEC
    ? `<span class="brush ok">${hm(b.started_at)} · 2:00 ✓</span>`
    : `<span class="brush short">${hm(b.started_at)} · ${fmtSec(b.seconds)} — остановлено раньше</span>`;
  const cell = (p, d) => {
    const n = fullBrushes(p.id, d);
    const short = brushingOn(p.id, d).some((b) => b.seconds < BRUSH_SEC);
    // Сегодняшний день ещё идёт — не красим его «плохо» заранее
    const cls = d === today && n < 2 ? 'now' : `r${rate('teeth', n)}`;
    return `<span class="wk ${cls}">${n}${short ? '<i>!</i>' : ''}</span>`;
  };

  return `<section class="card">
    <h2>🪥 Зубы ${myCount ? badge('teeth', myCount) : ''}</h2>
    <div class="teeth-main">
      <div class="teeth-count"><b>${myCount}</b><span>из 2 сегодня</span></div>
      <button class="btn" data-act="brush">${myCount >= 2 ? 'Почистить ещё раз' : 'Начать чистку · 2:00'}</button>
    </div>
    ${state.people.map((p) => {
      const list = brushingOn(p.id, today);
      return `<div class="person-row"><span class="dot" style="background:${colorOf(p)}"></span>
        <span class="who">${esc(nameOf(p))}</span><span class="val">${fullBrushes(p.id, today)} из 2</span>
        <span class="sub">${list.length ? list.map(session).join(' ') : 'сегодня чисток ещё не было'}</span></div>`;
    }).join('')}
    <div class="week">
      <span></span>${week.map((d) => `<span class="wk-day">${fmtDay(d, { weekday: 'short' })}</span>`).join('')}
      ${state.people.map((p) => `<span class="wk-who"><span class="dot" style="background:${colorOf(p)}"></span>${esc(nameOf(p))}</span>
        ${week.map((d) => cell(p, d)).join('')}`).join('')}
    </div>
    <p class="hint">Цифра — полные чистки за день, «!» — была чистка, остановленная раньше 2 минут.</p>
  </section>`;
}

function viewWeight() {
  const today = dayStr();
  const all = state.weights.map((w) => w.day).sort();
  const from = state.weightRange ? addDays(today, -state.weightRange + 1) : (all[0] || today);
  const myList = weightsOf(api.uid).slice().reverse().slice(0, 30);

  return `
  <header class="top"><h1>Вес</h1></header>
  ${seg('wrange', state.weightRange, [[30, '30 дней'], [90, '3 мес'], [365, 'Год'], [0, 'Всё']])}

  ${state.people.map((p) => {
    const ws = weightsOf(p.id);
    const inRange = ws.filter((w) => w.day >= from);
    const first = ws[0], last = ws.at(-1);
    const min = ws.length ? Math.min(...ws.map((w) => w.kg)) : null;
    return `<section class="card">
      <h2><span class="dot" style="background:${colorOf(p)}"></span>${esc(nameOf(p))}</h2>
      ${lineChart(inRange, colorOf(p), from, today)}
      <div class="stats">
        <div><span>Старт</span><b>${first ? fmtKg(first.kg) : '—'}</b></div>
        <div><span>Сейчас</span><b>${last ? fmtKg(last.kg) : '—'}</b></div>
        <div><span>Итого</span><b class="${last && first && last.kg < first.kg ? 'good' : ''}">${last && first ? fmtDiff(last.kg - first.kg) : '—'}</b></div>
        <div><span>Минимум</span><b>${min != null ? fmtKg(min) : '—'}</b></div>
      </div>
    </section>`;
  }).join('')}

  <section class="card">
    <h2>Мои записи</h2>
    <form data-form="weight-day" class="inline-form">
      <input name="day" type="date" max="${today}" value="${today}" required>
      <input name="kg" type="number" inputmode="decimal" step="0.1" min="20" max="400" placeholder="кг" required>
      <button class="btn">Сохранить</button>
    </form>
    ${myList.length ? `<ul class="list">${myList.map((w) => `<li><span>${fmtDay(w.day, { weekday: 'short', day: 'numeric', month: 'long' })}</span>
      <b>${fmtKg(w.kg)} кг</b><button class="x" data-act="del-weight" data-day="${w.day}" aria-label="Удалить">×</button></li>`).join('')}</ul>`
      : '<div class="empty">Записей пока нет</div>'}
  </section>`;
}

function viewSteps() {
  const today = dayStr();
  const days = lastDays(state.stepsRange);
  const myList = state.steps.filter((s) => s.user_id === api.uid).slice().reverse().slice(0, 30);

  return `
  <header class="top"><h1>Шаги</h1></header>
  ${seg('srange', state.stepsRange, [[7, 'Неделя'], [30, '30 дней']])}

  <section class="card">
    ${barChart(days, state.people, {
      valueOf: (p, d) => stepsOn(p.id, d),
      niceTop: (max) => Math.max(Math.ceil(max / 5000) * 5000, 5000),
      label: (v) => (v ? fmtNum(v / 1000) + 'к' : '0'),
      aria: 'График шагов',
      guide: RATING.steps[1],
    })}
    ${legend(state.people)}
    ${state.people.map((p) => {
      const vals = days.map((d) => stepsOn(p.id, d)).filter((v) => v != null);
      const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      return `<div class="person-stats">
        <div class="who"><span class="dot" style="background:${colorOf(p)}"></span>${esc(nameOf(p))}</div>
        <div class="stats">
          <div><span>В среднем</span><b>${avg != null ? fmtNum(avg) : '—'}</b></div>
          <div><span>Всего</span><b>${vals.length ? fmtNum(vals.reduce((a, b) => a + b, 0)) : '—'}</b></div>
        </div>
        ${vals.length ? `<div class="counts">${rateCounts('steps', vals)}</div>` : ''}
      </div>`;
    }).join('')}
  </section>

  <section class="card">
    <h2>Мои записи</h2>
    <form data-form="steps-day" class="inline-form">
      <input name="day" type="date" max="${today}" value="${today}" required>
      <input name="steps" type="number" inputmode="numeric" min="0" max="199999" placeholder="шаги" required>
      <button class="btn">Сохранить</button>
    </form>
    ${myList.length ? `<ul class="list">${myList.map((s) => `<li><span>${fmtDay(s.day, { weekday: 'short', day: 'numeric', month: 'long' })}</span>
      ${badge('steps', s.steps)}<b>${fmtNum(s.steps)}</b><button class="x" data-act="del-steps" data-day="${s.day}" aria-label="Удалить">×</button></li>`).join('')}</ul>`
      : '<div class="empty">Записей пока нет</div>'}
  </section>`;
}

function viewSleep() {
  const today = dayStr();
  const days = lastDays(state.sleepRange);
  const myList = state.sleep.filter((s) => s.user_id === api.uid).slice().reverse().slice(0, 30);

  return `
  <header class="top"><h1>Сон</h1></header>
  ${seg('slrange', state.sleepRange, [[7, 'Неделя'], [30, '30 дней']])}

  <section class="card">
    ${barChart(days, state.people, {
      valueOf: (p, d) => { const s = fullSleepOn(p.id, d); return s ? sleepMin(s) / 60 : null; },
      niceTop: (max) => Math.max(Math.ceil(max / 2) * 2, 10),
      label: (v) => (v ? `${v} ч` : '0'),
      aria: 'График сна',
      guide: RATING.sleep[1] / 60,
    })}
    ${legend(state.people)}
    ${state.people.map((p) => {
      const list = days.map((d) => fullSleepOn(p.id, d)).filter(Boolean);
      const mins = list.map(sleepMin);
      return `<div class="person-stats">
        <div class="who"><span class="dot" style="background:${colorOf(p)}"></span>${esc(nameOf(p))}</div>
        <div class="stats three">
          <div><span>В среднем</span><b>${list.length ? fmtDur(mins.reduce((a, b) => a + b, 0) / list.length) : '—'}</b></div>
          <div><span>Ложится</span><b>${list.length ? avgBed(list) : '—'}</b></div>
          <div><span>Встаёт</span><b>${list.length ? avgWake(list) : '—'}</b></div>
        </div>
        ${list.length ? `<div class="counts">${rateCounts('sleep', mins)}</div>` : ''}
      </div>`;
    }).join('')}
  </section>

  <section class="card">
    <h2>Мои записи</h2>
    <form data-form="sleep-day" class="form-grid">
      <label class="full">Дата пробуждения<input name="day" type="date" max="${today}" value="${today}" required></label>
      <label>Лёг<input name="bed" type="time" required></label>
      <label>Встал<input name="wake" type="time" required></label>
      <button class="btn full">Сохранить</button>
    </form>
    ${myList.length ? `<ul class="list">${myList.map((s) => `<li><span>${fmtDay(s.day, { weekday: 'short', day: 'numeric', month: 'long' })}<br>
      <small>${s.bed} – ${s.wake ?? 'подъём не отмечен'}</small></span>${s.wake ? `${badge('sleep', sleepMin(s))}<b>${fmtDur(sleepMin(s))}</b>` : '<b>—</b>'}
      <button class="x" data-act="del-sleep" data-day="${s.day}" aria-label="Удалить">×</button></li>`).join('')}</ul>`
      : '<div class="empty">Записей пока нет</div>'}
  </section>`;
}

function pushStatus() {
  if (DEMO) return { text: 'В демо-режиме уведомления не работают', can: false };
  if (!('Notification' in window) || !('PushManager' in window)) {
    return { text: 'Сначала добавьте приложение на экран «Домой» и откройте его оттуда', can: false };
  }
  if (Notification.permission === 'granted') return { text: 'Включены ✅', can: false, on: true };
  if (Notification.permission === 'denied') return { text: 'Запрещены. Разрешите в Настройках iPhone → Уведомления', can: false };
  return { text: 'Выключены', can: true };
}

function viewSettings() {
  const m = me();
  const ps = pushStatus();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `
  <header class="top"><h1>Настройки</h1></header>

  <section class="card">
    <h2>Профиль</h2>
    <form data-form="profile" class="stack">
      <label>Имя<input name="name" value="${esc(m.name)}" maxlength="30" placeholder="Как вас зовут" required></label>
      <div class="colors">${COLOR_CHOICES.map((c) => `<label class="swatch" style="--c:${c}">
        <input type="radio" name="color" value="${c}" ${colorOf(m) === c ? 'checked' : ''}><span></span></label>`).join('')}</div>
      <button class="btn">Сохранить</button>
    </form>
  </section>

  <section class="card">
    <h2>Тема</h2>
    ${seg('theme', getTheme(), [['light', '☀️ Светлая'], ['dark', '🌙 Тёмная'], ['auto', 'Как на iPhone']])}
  </section>

  <section class="card">
    <h2>Напоминания</h2>
    <p class="row-text">Статус: <b>${ps.text}</b></p>
    ${ps.can ? '<button class="btn" data-act="push-on">Включить уведомления</button>' : ''}
    ${ps.on ? '<button class="btn ghost" data-act="push-test">Проверить уведомление</button>' : ''}
    <ul class="plain">
      <li>08:00: взвеситься, если вес ещё не записан</li>
      <li>9, 11, 13, 15, 17, 19, 21 ч: выпить воды, пока не набрано ${fmtNum(GOAL)} мл</li>
      <li>23:00: внести шаги, если за сегодня их нет</li>
    </ul>
  </section>

  <section class="card">
    <h2>Оценка дня</h2>
    <p class="hint">💧 Вода</p>${scale('water', null)}
    <p class="hint">😴 Сон</p>${scale('sleep', null)}
    <p class="hint">👟 Шаги</p>${scale('steps', null)}
    <p class="hint">🪥 Зубы (полных чисток за день)</p>${scale('teeth', null)}
  </section>

  ${!standalone ? `<section class="card">
    <h2>Установка на iPhone</h2>
    <ol class="plain">
      <li>Откройте эту страницу в <b>Safari</b></li>
      <li>Нажмите «Поделиться» (квадрат со стрелкой)</li>
      <li>Выберите «На экран Домой» → «Добавить»</li>
      <li>Откройте приложение с иконки и войдите</li>
    </ol>
  </section>` : ''}

  <section class="card">
    ${DEMO
      ? `<p class="row-text">Демо-режим: данные хранятся только в этом браузере.</p>
         <button class="btn ghost" data-act="demo-switch">Войти как «${esc(nameOf(partner()))}»</button>`
      : '<button class="btn ghost danger" data-act="logout">Выйти</button>'}
  </section>
  <p class="hint version">Версия приложения: ${APP_VERSION}</p>`;
}

function viewLogin() {
  return `<div class="login">
    <div class="logo">💪</div>
    <h1>Вместе легче</h1>
    <form data-form="login" class="stack">
      <input name="email" type="email" autocomplete="username" placeholder="Почта" required>
      <input name="password" type="password" autocomplete="current-password" placeholder="Пароль" required>
      <button class="btn">Войти</button>
    </form>
  </div>`;
}

function viewOnboarding() {
  return `<div class="login">
    <div class="logo">👋</div>
    <h1>Как вас зовут?</h1>
    <form data-form="profile" class="stack">
      <input name="name" maxlength="30" placeholder="Имя" required autofocus>
      <button class="btn">Продолжить</button>
    </form>
  </div>`;
}

const TABS = [
  ['today', 'Сегодня', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'],
  ['weight', 'Вес', '<path d="M4 19h16M6 15l4-5 3 3 5-7"/>'],
  ['sleep', 'Сон', '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'],
  ['steps', 'Шаги', '<path d="M5 20V12M10 20V6M15 20v-9M20 20V9"/>'],
  ['settings', 'Ещё', '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'],
];

function render() {
  if (!api.uid) { app.innerHTML = viewLogin(); return; }
  if (!me()?.name?.trim() && !DEMO) { app.innerHTML = viewOnboarding(); return; }
  const views = { today: viewToday, weight: viewWeight, sleep: viewSleep, steps: viewSteps, settings: viewSettings };
  app.innerHTML = `<main>${views[state.tab]()}</main>
  <nav class="tabs">${TABS.map(([id, label, icon]) => `<button data-act="tab" data-tab="${id}" class="${state.tab === id ? 'on' : ''}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span></button>`).join('')}</nav>`;
}

// ---------- действия ----------
async function run(fn, okText) {
  try { await fn(); await loadAll(); render(); if (okText) toast(okText); } catch (e) { toast(errText(e)); }
}

app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const d = b.dataset;
  switch (d.act) {
    case 'tab': state.tab = d.tab; render(); scrollTo(0, 0); break;
    case 'brush': startBrushing(); break;
    case 'water': run(() => api.addWater(dayStr(), Number(d.ml)), `+${d.ml} мл`); break;
    case 'del-water': run(() => api.deleteWater(Number(d.id)), 'Удалено'); break;
    case 'del-weight': if (confirm('Удалить запись веса?')) run(() => api.deleteWeight(d.day), 'Удалено'); break;
    case 'del-steps': if (confirm('Удалить запись шагов?')) run(() => api.deleteSteps(d.day), 'Удалено'); break;
    case 'bed-now': run(() => api.setSleep(bedNightDay(), nowHM(), null), 'Спокойной ночи 🌙'); break;
    case 'del-sleep': if (confirm('Удалить запись сна?')) run(() => api.deleteSleep(d.day), 'Удалено'); break;
    case 'wrange': state.weightRange = Number(d.v); render(); break;
    case 'srange': state.stepsRange = Number(d.v); render(); break;
    case 'slrange': state.sleepRange = Number(d.v); render(); break;
    case 'theme': applyTheme(d.v); render(); break;
    case 'push-on': enablePush(); break;
    case 'push-test': api.testPush().then((r) => toast(r?.sent ? 'Отправлено, ждите уведомление' : 'Подписка не найдена, включите заново'), (er) => toast(errText(er))); break;
    case 'logout': api.signOut().then(() => { state.people = []; render(); }); break;
    case 'demo-switch': api.switchUser(); refresh(); break;
  }
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target, v = Object.fromEntries(new FormData(f));
  const num = (s) => Number(String(s).replace(',', '.'));
  switch (f.dataset.form) {
    case 'login':
      api.signIn(v.email.trim(), v.password).then(() => start(), (er) => toast(errText(er)));
      break;
    case 'water': run(() => api.addWater(dayStr(), Math.round(num(v.ml))), `+${v.ml} мл`); break;
    case 'weight': run(() => api.setWeight(dayStr(), Math.round(num(v.kg) * 10) / 10), 'Вес записан'); break;
    case 'weight-day': run(() => api.setWeight(v.day, Math.round(num(v.kg) * 10) / 10), 'Сохранено'); break;
    case 'steps': run(() => api.setSteps(dayStr(), Math.round(num(v.steps))), 'Шаги записаны'); break;
    case 'steps-day': run(() => api.setSteps(v.day, Math.round(num(v.steps))), 'Сохранено'); break;
    case 'sleep': run(() => api.setSleep(dayStr(), v.bed, v.wake || null), 'Сон записан'); break;
    case 'bed': run(() => api.setSleep(bedNightDay(), v.bed, null), 'Спокойной ночи 🌙'); break;
    case 'wake': run(() => api.setSleep(dayStr(), sleepOn(api.uid, dayStr()).bed, v.wake), 'Доброе утро ☀️'); break;
    case 'sleep-day': run(() => api.setSleep(v.day, v.bed, v.wake), 'Сохранено'); break;
    case 'profile': run(() => api.saveProfile({ name: v.name.trim(), ...(v.color ? { color: v.color } : {}) }), 'Сохранено'); break;
  }
});

// ---------- таймер чистки зубов ----------
// Время считаем от момента старта, а не тиками: если экран погас или приложение
// свернули, по возвращении таймер покажет правильное время. Старт хранится
// в localStorage, чтобы чистка продолжилась и после перезапуска приложения.
const BRUSH_MIN_SEC = 10; // короче — случайное нажатие, не записываем
const ZONES = ['Верх слева', 'Верх справа', 'Низ справа', 'Низ слева'];
let brush = null;   // { start, zone, confirming, timer, wake }
let brushSave = null; // несохранённая чистка (на случай ошибки сети)
let audioCtx;

function beep(freq = 880, ms = 150, times = 1) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      const t = audioCtx.currentTime + i * (ms / 1000 + 0.1);
      o.frequency.value = freq;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
      o.start(t); o.stop(t + ms / 1000);
    }
  } catch { /* без звука */ }
}

const brushElapsed = () => Math.min((Date.now() - brush.start) / 1000, BRUSH_SEC);

function startBrushing(start = Date.now()) {
  if (brush) return;
  try { localStorage.setItem('brush-start', String(start)); } catch { /* приватный режим */ }
  brush = { start, zone: -1, confirming: false };
  let el = $('#brush');
  if (!el) {
    el = document.createElement('div');
    el.id = 'brush'; el.className = 'overlay';
    el.addEventListener('click', onBrushClick);
    document.body.append(el);
  }
  // Не даём экрану погаснуть, пока идёт чистка (где поддерживается)
  navigator.wakeLock?.request('screen').then((l) => { if (brush) brush.wake = l; else l.release(); }).catch(() => {});
  beep(660, 120);
  renderBrush();
  brush.timer = setInterval(tickBrush, 250);
}

function resumeBrushing() {
  let start;
  try { start = Number(localStorage.getItem('brush-start')); } catch { return; }
  if (!start) return;
  // Брошенный давно таймер не восстанавливаем
  if (Date.now() - start > 3 * 3600e3) { try { localStorage.removeItem('brush-start'); } catch { /* */ } return; }
  startBrushing(start);
}

function renderBrush() {
  const el = $('#brush');
  el.innerHTML = `<div class="overlay-box">
    <h2>🪥 Чистим зубы</h2>
    <div class="ring-wrap big">${ring(0, BRUSH_SEC, colorOf(me()))}
      <div class="ring-label"><b id="brush-left">2:00</b><span id="brush-zone"></span></div>
    </div>
    ${brush.confirming
      ? `<p class="row-text">Прошло <b id="brush-done">0:00</b> из 2:00. Если остановить сейчас, чистка запишется
          как <b>неполная</b> и не пойдёт в норму, и это будет видно.</p>
        <div class="btn-col"><button class="btn" data-b="continue">Продолжить чистить</button>
          <button class="btn ghost danger" data-b="stop">Всё равно остановить</button></div>`
      : `<p class="hint">Каждые 30 секунд — сигнал и следующий участок.</p>
        <button class="btn ghost" data-b="ask-stop">Остановить</button>`}
  </div>`;
  tickBrush();
}

function tickBrush() {
  if (!brush) return;
  const t = brushElapsed();
  if (t >= BRUSH_SEC) { finishBrushing(BRUSH_SEC); return; }
  const zone = Math.min(ZONES.length - 1, Math.floor(t / 30));
  if (zone !== brush.zone) { if (brush.zone >= 0) beep(880, 150); brush.zone = zone; }
  const c = 2 * Math.PI * 52; // длина окружности кольца из ring()
  $('#brush .ring-fg')?.setAttribute('stroke-dashoffset', c * (1 - t / BRUSH_SEC));
  $('#brush-left').textContent = fmtSec(Math.ceil(BRUSH_SEC - t));
  $('#brush-zone').textContent = ZONES[zone];
  const done = $('#brush-done');
  if (done) done.textContent = fmtSec(t);
}

function finishBrushing(seconds) {
  const { start, timer, wake } = brush;
  clearInterval(timer);
  wake?.release().catch(() => {});
  brush = null;
  try { localStorage.removeItem('brush-start'); } catch { /* */ }
  if (seconds < BRUSH_MIN_SEC) { $('#brush')?.remove(); toast('Меньше 10 секунд — не записываем'); return; }
  if (seconds >= BRUSH_SEC) beep(990, 180, 3);
  brushSave = { day: dayStr(new Date(start)), startedAt: new Date(start).toISOString(), seconds: Math.round(seconds) };
  saveBrushing();
}

async function saveBrushing() {
  const el = $('#brush');
  const { seconds } = brushSave;
  const full = seconds >= BRUSH_SEC;
  const title = full ? 'Отлично, 2 минуты! ✨' : `Неполная чистка: ${fmtSec(seconds)}`;
  el.innerHTML = `<div class="overlay-box"><h2>${title}</h2><p class="hint">Сохраняю…</p></div>`;
  try {
    await api.addBrushing(brushSave.day, brushSave.startedAt, seconds);
    brushSave = null;
    await loadAll(); render();
    const n = fullBrushes(api.uid, dayStr());
    el.innerHTML = `<div class="overlay-box">
      <div class="logo">${full ? '😁' : '⏱'}</div><h2>${title}</h2>
      <p class="row-text">${full ? `Сегодня засчитано ${n} из 2.` : 'В норму не засчитано. Сегодня полных чисток: ' + n + ' из 2.'}</p>
      <button class="btn" data-b="close">Готово</button></div>`;
  } catch (e) {
    el.innerHTML = `<div class="overlay-box"><h2>${title}</h2>
      <p class="row-text">Не удалось сохранить: ${esc(errText(e))}</p>
      <div class="btn-col"><button class="btn" data-b="retry">Повторить</button>
        <button class="btn ghost danger" data-b="close">Не сохранять</button></div></div>`;
  }
}

function onBrushClick(e) {
  const b = e.target.closest('[data-b]')?.dataset.b;
  if (b === 'ask-stop') { brush.confirming = true; renderBrush(); }
  if (b === 'continue') { brush.confirming = false; renderBrush(); }
  if (b === 'stop') finishBrushing(brushElapsed());
  if (b === 'retry') saveBrushing();
  if (b === 'close') { brushSave = null; $('#brush')?.remove(); }
}

// ---------- push ----------
function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CONFIG.VAPID_PUBLIC_KEY) });
  await api.savePush(sub.toJSON());
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Уведомления не разрешены'); render(); return; }
    await subscribePush();
    toast('Уведомления включены');
  } catch (e) { toast(errText(e)); }
  render();
}

// ---------- запуск ----------
async function start() {
  try {
    if (!(await api.init())) { render(); return; }
    await loadAll();
    if (!DEMO) {
      // Часовой пояс нужен серверу, чтобы слать напоминания по вашему времени
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (me() ? me().tz !== tz : true) { await api.saveProfile({ tz, ...(me() ? {} : { name: '' }) }); await loadAll(); }
      if ('Notification' in window && Notification.permission === 'granted' && CONFIG.VAPID_PUBLIC_KEY) subscribePush().catch(() => {});
    }
    render();
    resumeBrushing();
  } catch (e) {
    app.innerHTML = `<div class="login"><div class="logo">⚠️</div><p>${esc(errText(e))}</p>
      <button class="btn" onclick="location.reload()">Повторить</button></div>`;
  }
}

// Вернулись в приложение: подтягиваем свежие данные партнёра, а после полуночи переходим на новый день
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && api.uid) refresh();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`).catch(() => {});
start();
