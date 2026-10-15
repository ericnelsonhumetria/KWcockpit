// netlify/functions/cerebro-linkedin-weekly.js  (v1)
// Tâche PLANIFIÉE (voir netlify.toml) : chaque lundi, relance la synchronisation LinkedIn de tous les utilisateurs connectés.
// Se contente de lancer la fonction d'arrière-plan (limite de 30 s des tâches planifiées), authentifiée par le secret partagé.
// Peut aussi être lancée à la main : Netlify → Functions → cerebro-linkedin-weekly → « Run now ».

exports.handler = async () => {
  const base = process.env.URL || 'https://kwcockpit.netlify.app';
  const secret = process.env.CEREBRO_WATCH_SECRET;
  if (!secret) { console.error('[cerebro-linkedin-weekly] CEREBRO_WATCH_SECRET absente : synchronisation non lancée'); return { statusCode: 500 }; }
  const r = await fetch(base + '/.netlify/functions/cerebro-linkedin-sync-background', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cerebro-secret': secret }, body: '{}',
  });
  console.log('[cerebro-linkedin-weekly] synchronisation lancée, HTTP', r.status);   // 202 attendu
  return { statusCode: 200 };
};
