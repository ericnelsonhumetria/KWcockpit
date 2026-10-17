// netlify/functions/push-actions.js — Notifications « actions en retard » de Clap! (Web Push)
//   GET  (connecté)                       → { publicKey } : clé publique pour s'abonner (crée les clés au premier appel)
//   POST (connecté) { action:'sync' }     → renvoie l'état à ce compte (après abonnement ou ouverture de Clap!) ; force:true = même si inchangé
//   POST (déclencheur SQL, x-push-secret) { pilotes:[…] } → met à jour les téléphones des pilotes concernés, en temps réel
// Voir netlify/lib/push-core.js et sql/push_actions.sql.
'use strict';
const { adminClient, ensureConfig, readConfig, sameSecret, sync } = require('../lib/push-core');

const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

async function userOf(db, event) {
  const h = event.headers || {}, m = /^Bearer\s+(.+)$/i.exec(h.authorization || h.Authorization || '');
  if (!m) return null;
  const r = await db.auth.getUser(m[1]);
  return (r && r.data && r.data.user) || null;
}

exports.handler = async function (event) {
  try {
    const db = adminClient(), h = event.headers || {};
    const host = h['x-forwarded-host'] || h.host || '';
    if (event.httpMethod === 'GET') {
      const u = await userOf(db, event); if (!u) return json(401, { error: 'connexion requise' });
      const cfg = await ensureConfig(db, host);
      return json(200, { publicKey: cfg.vapid_public });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'méthode non permise' });
    let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (e) {}
    const secret = h['x-push-secret'];
    if (secret) {                                                   // appel du déclencheur SQL (pg_net)
      const cfg = await readConfig(db);
      if (!sameSecret(secret, cfg.secret)) return json(403, { error: 'secret invalide' });
      const p = Array.isArray(body.pilotes) ? body.pilotes.filter(Boolean).map(String).slice(0, 50) : [];
      if (!p.length) return json(200, { ok: true, rien: true });
      return json(200, Object.assign({ ok: true }, await sync(db, cfg, { pilotes: p })));
    }
    const u = await userOf(db, event); if (!u) return json(401, { error: 'connexion requise' });
    const cfg = await ensureConfig(db, host);
    if (body.action === 'sync') return json(200, Object.assign({ ok: true }, await sync(db, cfg, { userIds: [u.id] }, { force: body.force === true })));
    return json(400, { error: 'action inconnue' });
  } catch (e) {
    console.log('push-actions', e && e.message);
    return json(500, { error: (e && e.message) || 'erreur' });
  }
};
