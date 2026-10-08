// netlify/functions/cerebro-watch.js  (v1)
// Tâche PLANIFIÉE (voir netlify.toml) : chaque lundi, déclenche la veille Cerebro côté serveur.
// Une tâche planifiée Netlify est limitée à 30 s : elle se contente de lancer la fonction
// d'arrière-plan cerebro-watch-background (jusqu'à 15 min), authentifiée par un secret partagé.
// Peut aussi être lancée à la main : Netlify → Functions → cerebro-watch → « Run now ».

exports.handler = async () => {
  const base = process.env.URL || 'https://kwcockpit.netlify.app';
  const secret = process.env.CEREBRO_WATCH_SECRET;
  if (!secret) { console.error('[cerebro-watch] CEREBRO_WATCH_SECRET absente : veille non lancée'); return { statusCode: 500 }; }
  const r = await fetch(base + '/.netlify/functions/cerebro-watch-background', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cerebro-secret': secret }, body: '{}',
  });
  console.log('[cerebro-watch] veille lancée, HTTP', r.status);   // 202 attendu
  return { statusCode: 200 };
};
