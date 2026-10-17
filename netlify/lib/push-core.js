// netlify/lib/push-core.js — Notifications « actions en retard » de Clap! (Web Push), partagé par push-actions.js et push-actions-daily.js
// Principe : chaque téléphone abonné reçoit la LISTE de ses actions en retard ; le service worker de Clap! (public/clap/sw.js)
// affiche une notification silencieuse par action en retard et retire celles qui ne le sont plus. Sur Android, le chiffre de
// l'icône suit donc le nombre de notifications ; ailleurs, navigator.setAppBadge() est aussi appelé.
// On n'envoie que si la liste a CHANGÉ depuis le dernier envoi (colonne dernier_etat) : pas de notification inutile.
// Clés VAPID, secret du déclencheur SQL et adresse de la fonction : générés au premier appel et rangés dans push_config
// (table fermée à tous sauf la clé de service). Rien à saisir dans Netlify.
// Env requises (déjà présentes) : SUPABASE_URL, SUPABASE_SERVICE_KEY.
'use strict';
const crypto = require('crypto');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const OPEN = ['a_faire', 'en_cours', 'en_attente'];
const MAX_ITEMS = 20;

function adminClient() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY manquantes');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Date du jour à Paris (AAAA-MM-JJ) : une échéance d'hier est en retard, celle d'aujourd'hui ne l'est pas encore
function parisToday(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
}

async function readConfig(db) {
  const r = await db.from('push_config').select('cle,valeur');
  if (r.error) throw new Error('push_config illisible : ' + r.error.message + ' (exécuter sql/push_actions.sql)');
  const c = {}; (r.data || []).forEach(x => { c[x.cle] = x.valeur; }); return c;
}
// Crée les clés si besoin (sans jamais écraser des clés existantes) ; met à jour l'adresse appelée par le déclencheur SQL.
async function ensureConfig(db, host) {
  let c = await readConfig(db);
  if (!c.vapid_public || !c.vapid_private || !c.secret) {
    const k = webpush.generateVAPIDKeys();
    const rows = [];
    if (!c.vapid_public || !c.vapid_private) { rows.push({ cle: 'vapid_public', valeur: k.publicKey }, { cle: 'vapid_private', valeur: k.privateKey }); }
    if (!c.secret) rows.push({ cle: 'secret', valeur: crypto.randomBytes(24).toString('hex') });
    await db.from('push_config').upsert(rows, { onConflict: 'cle', ignoreDuplicates: true });
    c = await readConfig(db);
  }
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host) && !/^(localhost|127\.)/.test(host)) {
    const url = 'https://' + host + '/.netlify/functions/push-actions';
    if (c.url !== url) { await db.from('push_config').upsert({ cle: 'url', valeur: url }, { onConflict: 'cle' }); c.url = url; }
  }
  return c;
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Envoie l'état à jour aux abonnements choisis. which = { all:true } | { userIds:[…] } | { pilotes:[…] }
async function sync(db, cfg, which, opts) {
  opts = opts || {};
  const send = opts.send || ((sub, payload, o) => webpush.sendNotification(sub, payload, o));
  const today = opts.today || parisToday();
  const subj = 'mailto:' + (process.env.MAIL_FROM || 'contact@kaizenway.fr');

  const pr = await db.from('action_pilotes').select('id,user_id,email');
  if (pr.error) throw new Error('action_pilotes : ' + pr.error.message);
  const pilotes = pr.data || [];
  const low = s => String(s || '').trim().toLowerCase();

  let subs;
  { const sr = await db.from('push_abonnements').select('*'); if (sr.error) throw new Error('push_abonnements : ' + sr.error.message); subs = sr.data || []; }
  if (which && which.userIds) { const set = new Set(which.userIds.map(String)); subs = subs.filter(s => set.has(String(s.user_id))); }
  if (which && which.pilotes) {
    const ps = new Set(which.pilotes.map(String)), us = new Set(), es = new Set();
    pilotes.filter(p => ps.has(String(p.id))).forEach(p => { if (p.user_id) us.add(String(p.user_id)); if (p.email) es.add(low(p.email)); });
    subs = subs.filter(s => us.has(String(s.user_id)) || (s.email && es.has(low(s.email))));
  }
  if (!subs.length) return { abonnements: 0, envoyes: 0, inchanges: 0, supprimes: 0, erreurs: 0 };

  const pilotesOf = s => pilotes.filter(p => (p.user_id && String(p.user_id) === String(s.user_id)) || (p.email && s.email && low(p.email) === low(s.email))).map(p => String(p.id));
  const allP = [...new Set([].concat(...subs.map(pilotesOf)))];
  let late = [];
  if (allP.length) {
    const ar = await db.from('actions').select('id,numero,libelle,echeance,pilote_id,statut,archived_at')
      .is('archived_at', null).in('statut', OPEN).lt('echeance', today).in('pilote_id', allP);
    if (ar.error) throw new Error('actions : ' + ar.error.message);
    late = (ar.data || []).filter(a => a.echeance && a.echeance < today && !a.archived_at && OPEN.includes(a.statut));
  }

  webpush.setVapidDetails(subj, cfg.vapid_public, cfg.vapid_private);
  const out = { abonnements: subs.length, envoyes: 0, inchanges: 0, supprimes: 0, erreurs: 0 };
  for (const s of subs) {
    const mine = new Set(pilotesOf(s));
    const items = late.filter(a => mine.has(String(a.pilote_id)))
      .sort((a, b) => String(a.echeance).localeCompare(String(b.echeance)) || (a.numero || 0) - (b.numero || 0));
    const etat = items.map(a => a.id).sort().join(',') || '0';
    if ((!opts.force || etat === '0') && s.dernier_etat === etat) { out.inchanges++; continue; }   // à zéro, jamais de renvoi : pas de notification « plus rien » répétée
    const payload = JSON.stringify({ t: 'retards', n: items.length, d: today,
      items: items.slice(0, MAX_ITEMS).map(a => ({ id: a.id, no: a.numero || null, l: String(a.libelle || '').slice(0, 140), e: a.echeance })) });
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'normal', topic: 'clapretards' });
      await db.from('push_abonnements').update({ dernier_etat: etat, dernier_envoi: new Date().toISOString(), echecs: 0 }).eq('id', s.id);
      out.envoyes++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) { await db.from('push_abonnements').delete().eq('id', s.id); out.supprimes++; }   // téléphone désinstallé ou autorisation retirée
      else { await db.from('push_abonnements').update({ echecs: (s.echecs || 0) + 1 }).eq('id', s.id); out.erreurs++; console.log('push erreur', code, e && e.body ? String(e.body).slice(0, 200) : (e && e.message)); }
    }
  }
  return out;
}

module.exports = { adminClient, ensureConfig, readConfig, sameSecret, sync, parisToday };
