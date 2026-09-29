// netlify/functions/humetria-notify.js
// E-mail de mention Humetria (Brevo). Le client n'envoie que { comment_id } :
// la fonction relit le commentaire, vérifie que l'appelant en est l'auteur,
// et n'écrit qu'aux utilisateurs internes mentionnés (user_access). Max 10 destinataires.
// Env : SUPABASE_URL, SUPABASE_SERVICE_KEY, BREVO_API_KEY, MAIL_FROM, MAIL_FROM_NAME, APP_URL.

const { createClient } = require('@supabase/supabase-js');

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error('Brevo ' + res.status + ' ' + t.slice(0, 200)); }
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

  const auth = event.headers.authorization || event.headers.Authorization;
  if (!auth) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Non authentifié' }) };
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: ud, error: ue } = await sb.auth.getUser(auth.replace('Bearer ', '').trim());
  if (ue || !ud || !ud.user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token invalide' }) };
  const me = ud.user;
  const myEmail = (me.email || '').toLowerCase();
  const { data: acc } = await sb.from('user_access').select('role').eq('email', myEmail).maybeSingle();
  if (!acc) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Accès réservé aux utilisateurs internes' }) };

  const apiKey = process.env.BREVO_API_KEY, from = process.env.MAIL_FROM;
  const fromName = process.env.MAIL_FROM_NAME || 'Kaizen Way';
  const appUrl = (process.env.APP_URL || 'https://kwcockpit.netlify.app').replace(/\/+$/, '');
  if (!apiKey || !from) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Envoi non configuré (BREVO_API_KEY / MAIL_FROM)' }) };

  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps invalide' }) }; }
  const cid = typeof body.comment_id === 'string' ? body.comment_id : '';
  if (!cid) return { statusCode: 400, headers, body: JSON.stringify({ error: 'comment_id manquant' }) };

  const { data: cm } = await sb.from('humetria_comments').select('*').eq('id', cid).maybeSingle();
  if (!cm) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Commentaire introuvable' }) };
  if (cm.auteur !== me.id) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Seul l\'auteur peut notifier' }) };

  let mentions = Array.isArray(cm.mentions) ? cm.mentions.map(e => String(e || '').toLowerCase()).filter(Boolean) : [];
  mentions = [...new Set(mentions)].filter(e => e !== myEmail).slice(0, 10);
  if (!mentions.length) return { statusCode: 200, headers, body: JSON.stringify({ sent: 0 }) };

  const { data: internes } = await sb.from('user_access').select('email').in('email', mentions);
  const allowed = new Set((internes || []).map(r => String(r.email || '').toLowerCase()));
  const targets = mentions.filter(e => allowed.has(e));

  const { data: bloc } = await sb.from('humetria_blocs').select('titre').eq('id', cm.bloc_id).maybeSingle();
  const titre = (bloc && bloc.titre) || 'un bloc';
  const auteur = cm.auteur_nom || myEmail;
  const link = appUrl + '/?hbloc=' + encodeURIComponent(cm.bloc_id);
  const subject = auteur + ' vous a mentionné dans « ' + titre + ' » — Humetria';
  const text = auteur + ' vous a mentionné dans « ' + titre + ' » (Humetria) :\n\n' + (cm.texte || '') + '\n\nOuvrir : ' + link;
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2b1a1c;">'
    + '<div style="background:#560A0F;color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;font-weight:700;">Cockpit KW · Humetria</div>'
    + '<div style="border:1px solid #e6d9c6;border-top:none;padding:20px;border-radius:0 0 10px 10px;background:#fbf8f2;">'
    + '<p style="margin:0 0 12px;"><b>' + escapeHtml(auteur) + '</b> vous a mentionné dans <b style="color:#560A0F;">' + escapeHtml(titre) + '</b>.</p>'
    + '<div style="background:#fff;border-left:3px solid #EFB810;padding:10px 14px;margin:0 0 18px;white-space:pre-wrap;font-size:14px;line-height:1.5;">' + escapeHtml(cm.texte || '') + '</div>'
    + '<a href="' + escapeHtml(link) + '" style="display:inline-block;background:#560A0F;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700;">Ouvrir la discussion</a>'
    + '</div></div>';

  let sent = 0; const errors = [];
  for (const to of targets) {
    try { await sendBrevo(apiKey, from, fromName, to, subject, text, html); sent++; }
    catch (e) { errors.push(to + ' : ' + e.message); }
  }
  return { statusCode: 200, headers, body: JSON.stringify({ sent, skipped: mentions.length - targets.length, errors }) };
};
