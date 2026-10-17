// netlify/functions/push-actions-daily.js — FONCTION PLANIFIÉE (voir netlify.toml) : peu après minuit (heure de Paris), les actions
// dont l'échéance était la veille deviennent « en retard » sans que personne n'ait rien modifié. Ce passage met à jour tous les
// téléphones abonnés (seulement ceux dont la liste a changé). Un second passage le matin rattrape un éventuel échec de la nuit.
'use strict';
const { adminClient, readConfig, sync } = require('../lib/push-core');

exports.handler = async function () {
  try {
    const db = adminClient(), cfg = await readConfig(db);
    if (!cfg.vapid_public || !cfg.vapid_private) return { statusCode: 200, body: 'aucun abonnement encore (clés non créées)' };
    const r = await sync(db, cfg, { all: true });
    console.log('push-actions-daily', JSON.stringify(r));
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (e) { console.log('push-actions-daily', e && e.message); return { statusCode: 500, body: (e && e.message) || 'erreur' }; }
};
