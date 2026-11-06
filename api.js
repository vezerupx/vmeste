// Слой данных. Два варианта с одинаковым набором методов:
// supabaseApi — настоящая общая база, demoApi — localStorage для проверки без сервера.
import { CONFIG } from './config.js';

export const DEMO = !CONFIG.SUPABASE_URL;

async function supabaseApi() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  let uid = null;

  return {
    async init() {
      const { data: { session } } = await sb.auth.getSession();
      uid = session?.user.id ?? null;
      return !!uid;
    },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      uid = data.user.id;
    },
    async signOut() { await sb.auth.signOut(); uid = null; },
    get uid() { return uid; },

    profiles: async () => ok(await sb.from('profiles').select('*')),
    saveProfile: async (p) => ok(await sb.from('profiles').upsert({ id: uid, ...p })),

    weights: async (from) => ok(await sb.from('weights').select('*').gte('day', from).order('day')),
    setWeight: async (day, kg) => ok(await sb.from('weights').upsert({ user_id: uid, day, kg })),
    deleteWeight: async (day) => ok(await sb.from('weights').delete().eq('user_id', uid).eq('day', day)),

    water: async (from) => ok(await sb.from('water').select('*').gte('day', from).order('created_at')),
    addWater: async (day, ml) => ok(await sb.from('water').insert({ user_id: uid, day, ml })),
    deleteWater: async (id) => ok(await sb.from('water').delete().eq('id', id)),

    steps: async (from) => ok(await sb.from('steps').select('*').gte('day', from).order('day')),
    setSteps: async (day, steps) => ok(await sb.from('steps').upsert({ user_id: uid, day, steps })),
    deleteSteps: async (day) => ok(await sb.from('steps').delete().eq('user_id', uid).eq('day', day)),

    // Postgres отдаёт время как «23:30:00» — оставляем «23:30»; wake пустой, пока подъём не отмечен
    sleep: async (from) => ok(await sb.from('sleep').select('*').gte('day', from).order('day'))
      .map((s) => ({ ...s, bed: s.bed.slice(0, 5), wake: s.wake?.slice(0, 5) ?? null })),
    setSleep: async (day, bed, wake) => ok(await sb.from('sleep').upsert({ user_id: uid, day, bed, wake })),
    deleteSleep: async (day) => ok(await sb.from('sleep').delete().eq('user_id', uid).eq('day', day)),

    // Чистки только добавляются: удалять их база не даёт
    brushing: async (from) => ok(await sb.from('brushing').select('*').gte('day', from).order('started_at')),
    addBrushing: async (day, startedAt, seconds) => ok(await sb.from('brushing').insert({ user_id: uid, day, started_at: startedAt, seconds })),

    savePush: async (sub) => ok(await sb.from('push_subs').upsert({ endpoint: sub.endpoint, user_id: uid, sub })),
    testPush: async () => ok(await sb.functions.invoke('reminders', { body: { test: true } })),
  };
}

function demoApi() {
  const KEY = 'demo-db-v1';
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) ?? null; } catch { return null; }
  };
  const db = load() ?? {
    uid: 'u1',
    profiles: [
      { id: 'u1', name: 'Я', color: null, tz: 'Europe/Moscow' },
      { id: 'u2', name: 'Жена', color: null, tz: 'Europe/Moscow' },
    ],
    weights: [], water: [], steps: [], seq: 1,
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* приватный режим */ } };
  const byDay = (a, b) => a.day.localeCompare(b.day);

  return {
    init: async () => true,
    signIn: async () => {},
    signOut: async () => {},
    get uid() { return db.uid; },
    switchUser() { db.uid = db.uid === 'u1' ? 'u2' : 'u1'; save(); },

    profiles: async () => db.profiles,
    saveProfile: async (p) => { Object.assign(db.profiles.find((x) => x.id === db.uid), p); save(); },

    weights: async (from) => db.weights.filter((w) => w.day >= from).sort(byDay),
    setWeight: async (day, kg) => {
      db.weights = db.weights.filter((w) => !(w.user_id === db.uid && w.day === day));
      db.weights.push({ user_id: db.uid, day, kg }); save();
    },
    deleteWeight: async (day) => { db.weights = db.weights.filter((w) => !(w.user_id === db.uid && w.day === day)); save(); },

    water: async (from) => db.water.filter((w) => w.day >= from),
    addWater: async (day, ml) => { db.water.push({ id: db.seq++, user_id: db.uid, day, ml, created_at: new Date().toISOString() }); save(); },
    deleteWater: async (id) => { db.water = db.water.filter((w) => w.id !== id); save(); },

    steps: async (from) => db.steps.filter((s) => s.day >= from).sort(byDay),
    setSteps: async (day, steps) => {
      db.steps = db.steps.filter((s) => !(s.user_id === db.uid && s.day === day));
      db.steps.push({ user_id: db.uid, day, steps }); save();
    },
    deleteSteps: async (day) => { db.steps = db.steps.filter((s) => !(s.user_id === db.uid && s.day === day)); save(); },

    sleep: async (from) => (db.sleep ??= []).filter((s) => s.day >= from).sort(byDay),
    setSleep: async (day, bed, wake) => {
      db.sleep = (db.sleep ?? []).filter((s) => !(s.user_id === db.uid && s.day === day));
      db.sleep.push({ user_id: db.uid, day, bed, wake }); save();
    },
    deleteSleep: async (day) => { db.sleep = (db.sleep ?? []).filter((s) => !(s.user_id === db.uid && s.day === day)); save(); },

    brushing: async (from) => (db.brushing ??= []).filter((b) => b.day >= from)
      .sort((a, b) => a.started_at.localeCompare(b.started_at)),
    addBrushing: async (day, startedAt, seconds) => {
      (db.brushing ??= []).push({ id: db.seq++, user_id: db.uid, day, started_at: startedAt, seconds }); save();
    },

    savePush: async () => {},
    testPush: async () => { throw new Error('В демо-режиме уведомления не отправляются'); },
  };
}

export const api = DEMO ? demoApi() : await supabaseApi();
