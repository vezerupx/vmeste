// Заполняется по инструкции НАСТРОЙКА.md.
// Пока SUPABASE_URL пустой, приложение работает в демо-режиме: данные хранятся
// только в этом браузере, а между двумя тестовыми людьми можно переключаться.
export const CONFIG = {
  SUPABASE_URL: 'https://dttfzcyxuauoyfhtnoot.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_EAlTAq7QCBrciUHwnYBNyw_OU9SNNI7',
  VAPID_PUBLIC_KEY: 'BNFiP5b3b0AGDFu8tdr1lodn00Xg5VxnNvw563ODJz38hnfORGt6twOyRhGU50mP-Q0R4xPoPu7wjdY85YHpsPM',
  WATER_GOAL_ML: 2000,
  // Оценка дня: [с какого значения «Хорошо», с какого «Отлично»]; ниже первого — «Плохо»
  RATING: {
    water: [1500, 2000],   // мл
    steps: [5000, 10000],  // шагов
    sleep: [360, 420],     // минут сна (6 ч и 7 ч)
  },
};
