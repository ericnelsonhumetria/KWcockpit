// netlify/functions/cerebro-linkedin-weekly.js  (v1)
// Tâche PLANIFIÉE QUOTIDIENNE (voir netlify.toml). Le lundi : synchronisation de tous les utilisateurs connectés. Les autres jours : seulement ceux dont
// la dernière synchronisation est « en attente » (LinkedIn prépare les données, 20 min environ après la connexion) ou « en erreur » : nouvel essai rapide.
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
