// netlify/functions/action-relance.js
// Relance manuelle : un e-mail par pilote (actions en cours + échéances) via BREVO (API HTTP).
// POST { send:false } -> décompte. POST { send:true, pilote_ids:[...] } -> envoie aux pilotes ciblés.
// POST { diag:true } -> teste la clé Brevo (sans envoyer). Accès : utilisateurs internes.
// Env pour l'envoi : BREVO_API_KEY, MAIL_FROM (expéditeur vérifié dans Brevo), MAIL_FROM_NAME (optionnel).

const { createClient } = require('@supabase/supabase-js');

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

async function sendBrevo(apiKey, from, fromName, toEmail, subject, text, html) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      sender: { email: from, name: fromName || 'Kaizen Way' },
      to: [{ email: toEmail }],
      subject, textContent: text, htmlContent: html,
    }),
  });
  if (!res.ok) {
    let detail = ''; try { detail = await res.text(); } catch (e) {}
    throw new Error('Brevo ' + res.status + (detail ? (' : ' + detail.slice(0, 250)) : ''));
  }
  return true;
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

  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM;
  const fromName = process.env.MAIL_FROM_NAME || 'Kaizen Way';

  // Diagnostic : valide la clé Brevo sans envoyer
  if (body && body.diag === true) {
    const cfg = { BREVO_API_KEY: !!apiKey, MAIL_FROM: from || null };
    if (!apiKey) return { statusCode: 200, headers, body: JSON.stringify({ diag: true, ok: false, config: cfg, error: 'BREVO_API_KEY manquante' }) };
    if (!from) return { statusCode: 200, headers, body: JSON.stringify({ diag: true, ok: false, config: cfg, error: 'MAIL_FROM manquant (expéditeur)' }) };
    try {
      const r = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': apiKey, 'Accept': 'application/json' } });
      if (!r.ok) { let d = ''; try { d = await r.text(); } catch (e) {} return { statusCode: 200, headers, body: JSON.stringify({ diag: true, ok: false, config: cfg, error: 'Cle refusee (' + r.status + ') ' + d.slice(0, 200) }) }; }
      const acc = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify({ diag: true, ok: true, config: cfg, compte: (acc && acc.email) || null }) };
    } catch (e) { return { statusCode: 200, headers, body: JSON.stringify({ diag: true, ok: false, config: cfg, error: (e && (e.message || String(e))) }) }; }
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

  const groups = {};
  (actions || []).forEach(a => { (groups[a.pilote_id] = groups[a.pilote_id] || []).push(a); });

  const targets = [], skipped = [];
  Object.keys(groups).forEach(pid => {
    const p = pmap[pid]; const list = groups[pid];
    if (p && p.email) targets.push({ pilote_id: pid, nom: p.nom, email: p.email, actions: list });
    else skipped.push({ nom: p ? p.nom : '(inconnu)', count: list.length });
  });
  const totalActions = targets.reduce((s, t) => s + t.actions.length, 0);

  if (!send) {
    return { statusCode: 200, headers, body: JSON.stringify({
      pilotes: targets.length, actions: totalActions, skipped,
      breakdown: targets.map(t => ({ pilote_id: t.pilote_id, nom: t.nom, email: t.email, count: t.actions.length })),
    }) };
  }

  if (!apiKey || !from) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Envoi non configuré (BREVO_API_KEY / MAIL_FROM manquants).' }) };

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
      await sendBrevo(apiKey, from, fromName, t.email, `Rappel de vos actions (${t.actions.length}) — Kaizen Way`, text, html);
      sent++;
    } catch (e) {
      console.error('[relance] echec envoi', t.email, e && (e.message || e));
      errors.push({ email: t.email, error: (e && (e.message || String(e))) });
    }
  }

  await Promise.all(list.map(sendOne));

  return { statusCode: 200, headers, body: JSON.stringify({ sent, actions: sentActions, errors, skipped }) };
};
