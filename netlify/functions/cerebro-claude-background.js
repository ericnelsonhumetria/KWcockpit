// netlify/functions/cerebro-claude-background.js  (v1)
// Fonction d'ARRIÈRE-PLAN pour CEREBRO : appels IA longs (recherche web), jusqu'à 15 min.
// Le suffixe « -background » du nom de fichier suffit à Netlify pour l'exécuter en arrière-plan :
// la page reçoit immédiatement un 202, puis lit le résultat dans la table Supabase cerebro_jobs.
//
// Flux : page → insère cerebro_jobs {request, status:'pending'} → POST {job_id} ici (Bearer JWT)
//        ici  → vérifie la session et que le job appartient à l'appelant → 'running'
//             → appel Anthropic (mêmes règles que cerebro-claude.js v3) → 'done' + résultat allégé
//               ou 'error' + message.
// Variables d'env : les mêmes que cerebro-claude.js (SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY,
// CEREBRO_MODEL, CEREBRO_WEB_SEARCH). Aucune nouvelle variable.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://omftqlvkmjlxoinruayr.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL         = process.env.CEREBRO_MODEL || 'claude-sonnet-5';
const WEB_SEARCH_ON = (process.env.CEREBRO_WEB_SEARCH || '').toLowerCase() === 'on';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_TIMEOUT_MS = 10 * 60 * 1000;   // marge sous la limite de 15 min
const JOBS_RETENTION_DAYS = 7;

// Même construction de requête que cerebro-claude.js (v3)
function buildPayload(body) {
  var max_tokens = Math.max(2048, Math.min(8192, Number(body.max_tokens) || 2048));
  var payload = { model: MODEL, max_tokens: max_tokens, messages: Array.isArray(body.messages) ? body.messages : [] };
  if (body.system) payload.system = body.system;
  if (WEB_SEARCH_ON && Array.isArray(body.tools) && body.tools.length) {
    payload.tools = body.tools;
    payload.max_tokens = Math.max(payload.max_tokens, 4096);
  } else {
    payload.thinking = { type: 'disabled' };
  }
  return payload;
}

// On ne stocke que ce dont la page a besoin (texte + traces de recherche + usage) :
// les résultats bruts de recherche web sont volumineux et inutiles côté page.
function slim(data) {
  return {
    content: (data.content || [])
      .filter(function (b) { return b.type === 'text' || b.type === 'server_tool_use'; })
      .map(function (b) { return b.type === 'text' ? { type: 'text', text: b.text } : { type: 'server_tool_use', name: b.name }; }),
    usage: data.usage || null,
    stop_reason: data.stop_reason || null,
    model: data.model || MODEL,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' || !SERVICE_KEY || !ANTHROPIC_KEY) return;
  var sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 1) Auth : JWT de session Supabase du Cockpit
  var auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  var token = String(auth).replace(/^Bearer\s+/i, '').trim();
  if (!token) return;
  var user;
  try { var u = await sb.auth.getUser(token); user = u && u.data && u.data.user; } catch (e) {}
  if (!user) return;

  // 2) Job : doit exister, appartenir à l'appelant et être en attente (évite tout double traitement)
  var jobId;
  try { jobId = JSON.parse(event.body || '{}').job_id; } catch (e) {}
  if (!jobId) return;
  var claim = await sb.from('cerebro_jobs')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', jobId).eq('user_id', user.id).eq('status', 'pending')
    .select('id, request').maybeSingle();
  if (claim.error || !claim.data) return;

  async function finish(fields) {
    fields.updated_at = new Date().toISOString();
    await sb.from('cerebro_jobs').update(fields).eq('id', jobId);
  }

  // 3) Appel Anthropic
  try {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ANTHROPIC_TIMEOUT_MS);
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify(buildPayload(claim.data.request || {})),
      signal: ctrl.signal,
    });
    var txt = await r.text();
    clearTimeout(timer);
    if (!r.ok) {
      var msg = 'API ' + r.status;
      try { var j = JSON.parse(txt); if (j && j.error && j.error.message) msg += ' : ' + j.error.message; } catch (e) {}
      await finish({ status: 'error', error: msg });
    } else {
      await finish({ status: 'done', result: slim(JSON.parse(txt)) });
    }
  } catch (e) {
    await finish({ status: 'error', error: (e && e.name === 'AbortError') ? 'délai IA dépassé (10 min)' : 'appel IA impossible : ' + ((e && e.message) || 'réseau') });
  }

  // 4) Ménage : travaux de plus de 7 jours de cet utilisateur
  try {
    await sb.from('cerebro_jobs').delete().eq('user_id', user.id)
      .lt('created_at', new Date(Date.now() - JOBS_RETENTION_DAYS * 864e5).toISOString());
  } catch (e) {}
};
