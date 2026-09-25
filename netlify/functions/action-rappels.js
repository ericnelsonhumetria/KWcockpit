// netlify/functions/action-rappels.js
// RAPPEL J-1 par e-mail : fonction PLANIFIÉE (cron quotidien) qui envoie un rappel
// pour chaque action arrivant à échéance DEMAIN, à son pilote (repli : le créateur).
// Idempotent : marque notif_j_at une fois le mail parti (pas de doublon). Le trigger
// SQL réarme notif_j_at si l'échéance change -> un nouveau rappel repartira.
//
// Déclenchement : voir netlify.toml -> [functions."action-rappels"] schedule = "0 6 * * *"
//   (06:00 UTC ≈ 07-08h Paris). Ne s'exécute que sur les déploiements PUBLIÉS.
// Env requises : SUPABASE_URL, SUPABASE_SERVICE_KEY (déjà là), RESEND_API_KEY, MAIL_FROM.

const { createClient } = require('@supabase/supabase-js');

function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Date de "demain" (UTC ; à 06:00 UTC la date Paris est identique)
function demainISO(){
  var d = new Date(); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function emailOf(admin, userId, cache){
  if(!userId) return null;
  if(Object.prototype.hasOwnProperty.call(cache, userId)) return cache[userId];
  try {
    var r = await admin.auth.admin.getUserById(userId);
    cache[userId] = (r && r.data && r.data.user && r.data.user.email) ? r.data.user.email : null;
  } catch(e){ cache[userId] = null; }
  return cache[userId];
}

async function sendEmail(to, subject, html){
  var key = process.env.RESEND_API_KEY;
  var from = process.env.MAIL_FROM || 'Kaizen Way <onboarding@resend.dev>';
  try {
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from, to: [to], subject: subject, html: html })
    });
    if(!res.ok){ var t = await res.text(); console.log('Resend KO', res.status, t.slice(0,200)); }
    return res.ok;
  } catch(e){ console.log('Resend erreur', e.message); return false; }
}

exports.handler = async function(){
  var url = process.env.SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_KEY;
  if(!url || !svc) return { statusCode: 500, body: 'SUPABASE_URL / SUPABASE_SERVICE_KEY manquantes' };
  if(!process.env.RESEND_API_KEY) return { statusCode: 500, body: 'RESEND_API_KEY manquante' };

  var admin = createClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } });
  var demain = demainISO();

  // Actions ouvertes, échéance = demain, pas encore notifiées (service key -> voit tout)
  var q = await admin.from('actions')
    .select('id, libelle, echeance, priorite, pilote_id, created_by')
    .is('archived_at', null)
    .in('statut', ['a_faire','en_cours'])
    .eq('echeance', demain)
    .is('notif_j_at', null);
  if(q.error) return { statusCode: 502, body: 'Lecture actions : ' + q.error.message };
  var actions = q.data || [];
  if(!actions.length) return { statusCode: 200, body: 'Aucune action à échéance ' + demain };

  // Résolution pilote -> user_id
  var piloteIds = Array.from(new Set(actions.map(function(a){return a.pilote_id;}).filter(Boolean)));
  var piloteUser = {};
  if(piloteIds.length){
    var pj = await admin.from('action_pilotes').select('id, user_id').in('id', piloteIds);
    (pj.data || []).forEach(function(p){ piloteUser[p.id] = p.user_id; });
  }

  // Regroupement par destinataire (pilote lié, sinon créateur)
  var emailCache = {}, byRecipient = {};
  for(var i=0;i<actions.length;i++){
    var a = actions[i];
    var uid = (a.pilote_id && piloteUser[a.pilote_id]) ? piloteUser[a.pilote_id] : a.created_by;
    var email = await emailOf(admin, uid, emailCache);
    if(!email) continue;
    (byRecipient[email] = byRecipient[email] || []).push(a);
  }

  // Envoi : un e-mail par destinataire (digest de ses actions dues demain)
  var sentIds = [];
  var recipients = Object.keys(byRecipient);
  for(var r=0;r<recipients.length;r++){
    var email2 = recipients[r], list = byRecipient[email2];
    var items = list.map(function(a){
      return '<li style="margin:6px 0;">' + escapeHtml(a.libelle) + (a.priorite===1 ? ' <b>(priorité haute)</b>' : '') + '</li>';
    }).join('');
    var html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5;">'
      + '<p>Bonjour,</p>'
      + '<p>Rappel \u2014 ' + (list.length>1 ? 'ces actions arrivent' : 'cette action arrive') + ' \u00e0 \u00e9ch\u00e9ance <b>demain (' + demain + ')</b> :</p>'
      + '<ul>' + items + '</ul>'
      + '<p style="color:#666;font-size:12px;margin-top:18px;">Kaizen Way \u2014 Plan d\u2019action (KWcockpit). Rappel automatique, ne pas r\u00e9pondre.</p>'
      + '</div>';
    var ok = await sendEmail(email2, 'Rappel : ' + list.length + ' action(s) \u00e0 \u00e9ch\u00e9ance demain', html);
    if(ok) list.forEach(function(a){ sentIds.push(a.id); });
  }

  // Marque les actions notifiées (idempotence)
  if(sentIds.length){
    var up = await admin.from('actions').update({ notif_j_at: new Date().toISOString() }).in('id', sentIds);
    if(up.error) console.log('MAJ notif_j_at KO', up.error.message);
  }
  return { statusCode: 200, body: 'Rappels ' + demain + ' : ' + sentIds.length + '/' + actions.length + ' action(s) notifi\u00e9e(s)' };
};
