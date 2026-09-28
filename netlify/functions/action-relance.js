// netlify/functions/action-relance.js
// Relance manuelle : un e-mail par pilote listant ses actions en cours + échéances.
// POST { send:false } -> décompte (mails + actions) sans envoyer.
// POST { send:true }  -> envoie réellement (SMTP M365). Accès : utilisateurs internes.

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const STATUT_LABEL = { a_faire: 'À faire', en_cours: 'En cours', en_attente: 'En attente' };
const PRIO_LABEL = { 1: 'Haute', 2: 'Normale', 3: 'Basse' };

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function requireInternal(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data || !data.user) return { ok: false, code: 401, msg: 'Token invalide' };
  const email = (data.user.email || '').toLowerCase();
  const { data: acc } = await sb.from('user_access').select('role').eq('email', email).maybeSingle();
  if (!acc) return { ok: false, code: 403, msg: 'Accès réservé aux utilisateurs internes' };
  return { ok: true, email };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non supportée' }) };

  const guard = await requireInternal(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers, body: JSON.stringify({ error: guard.msg }) };

  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps invalide' }) }; }
  const send = body.send === true;

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Actions ouvertes avec un pilote
  const { data: actions, error: e1 } = await sb
    .from('actions')
    .select('numero,libelle,echeance,priorite,statut,pilote_id')
    .is('archived_at', null)
    .in('statut', ['a_faire', 'en_cours', 'en_attente'])
    .not('pilote_id', 'is', null)
    .order('echeance', { ascending: true, nullsFirst: false });
  if (e1) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lecture actions : ' + e1.message }) };

  const { data: pilotes, error: e2 } = await sb.from('action_pilotes').select('id,nom,email');
  if (e2) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lecture pilotes : ' + e2.message }) };
  const pmap = {}; (pilotes || []).forEach(p => { pmap[p.id] = p; });

  // Grouper par pilote
  const groups = {};
  (actions || []).forEach(a => { (groups[a.pilote_id] = groups[a.pilote_id] || []).push(a); });

  const targets = [], skipped = [];
  Object.keys(groups).forEach(pid => {
    const p = pmap[pid]; const list = groups[pid];
    if (p && p.email) targets.push({ pilote_id: pid, nom: p.nom, email: p.email, actions: list });
    else skipped.push({ nom: p ? p.nom : '(inconnu)', count: list.length });
  });
  const totalActions = targets.reduce((s, t) => s + t.actions.length, 0);

  // Décompte à blanc
  if (!send) {
    return { statusCode: 200, headers, body: JSON.stringify({
      pilotes: targets.length,
      actions: totalActions,
      skipped,
      breakdown: targets.map(t => ({ pilote_id: t.pilote_id, nom: t.nom, email: t.email, count: t.actions.length })),
    }) };
  }

  // Envoi réel
  const SMTP_USER = process.env.SMTP_USER, SMTP_PASS = process.env.SMTP_PASS;
  if (!SMTP_USER || !SMTP_PASS) return { statusCode: 500, headers, body: JSON.stringify({ error: 'SMTP non configuré (SMTP_USER / SMTP_PASS manquants).' }) };
  const from = process.env.MAIL_FROM || SMTP_USER;
  const transporter = nodemailer.createTransport({ host: 'smtp.office365.com', port: 587, secure: false, pool: true, maxConnections: 5, maxMessages: 100, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000, auth: { user: SMTP_USER, pass: SMTP_PASS } });

  let list = targets;
  if (Array.isArray(body.pilote_ids) && body.pilote_ids.length) {
    const ids = new Set(body.pilote_ids.map(String));
    list = targets.filter(t => ids.has(String(t.pilote_id)));
  }
  const sentActions = list.reduce((s0, t) => s0 + t.actions.length, 0);

  const today = new Date().toISOString().slice(0, 10);
  let sent = 0; const errors = [];
  async function sendOne(t) {
    const textRows = t.actions.map(a => {
      const ech = a.echeance ? a.echeance : 'sans échéance';
      return `- #${a.numero} — ${a.libelle}  ·  échéance : ${ech}  ·  ${STATUT_LABEL[a.statut] || a.statut}  ·  priorité ${PRIO_LABEL[a.priorite] || a.priorite}`;
    }).join('\n');
    const htmlRows = t.actions.map(a => {
      const ech = a.echeance || '—';
      const late = a.echeance && a.echeance < today;
      return `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">#${a.numero}</td>`
        + `<td style="padding:4px 10px;border-bottom:1px solid #eee;">${escapeHtml(a.libelle)}</td>`
        + `<td style="padding:4px 10px;border-bottom:1px solid #eee;${late ? 'color:#c0392b;font-weight:bold;' : ''}">${ech}</td>`
        + `<td style="padding:4px 10px;border-bottom:1px solid #eee;">${STATUT_LABEL[a.statut] || a.statut}</td>`
        + `<td style="padding:4px 10px;border-bottom:1px solid #eee;">${PRIO_LABEL[a.priorite] || a.priorite}</td></tr>`;
    }).join('');
    const text = `Bonjour ${t.nom},\n\nRappel de vos actions en cours (${t.actions.length}) :\n\n${textRows}\n\nMerci de mettre à jour leur statut dans Clap! / le Cockpit KW.\n\n— Kaizen Way`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#333;font-size:14px;">`
      + `<p>Bonjour ${escapeHtml(t.nom)},</p>`
      + `<p>Rappel de vos <b>${t.actions.length}</b> action(s) en cours :</p>`
      + `<table style="border-collapse:collapse;font-size:13px;"><thead><tr style="color:#560A0F;text-align:left;">`
      + `<th style="padding:4px 10px;">N°</th><th style="padding:4px 10px;">Action</th><th style="padding:4px 10px;">Échéance</th><th style="padding:4px 10px;">Statut</th><th style="padding:4px 10px;">Priorité</th></tr></thead>`
      + `<tbody>${htmlRows}</tbody></table>`
      + `<p>Merci de mettre à jour leur statut dans Clap! / le Cockpit KW.</p>`
      + `<p style="color:#999;">— Kaizen Way</p></div>`;
    try {
      await transporter.sendMail({ from, to: t.email, subject: `Rappel de vos actions (${t.actions.length}) — Kaizen Way`, text, html });
      sent++;
    } catch (e) {
      errors.push({ email: t.email, error: e.message });
    }
  }

  await Promise.all(list.map(sendOne));
  try { transporter.close(); } catch (e) {}

  return { statusCode: 200, headers, body: JSON.stringify({ sent, actions: sentActions, errors, skipped }) };
};
