// netlify/functions/parcours-claude.js
// Proxy IA du PARCOURS CANDIDAT.
// Clone de claude.js (mêmes headers, même timeout, force Haiku, même forme de réponse)
// MAIS valide d'abord le jeton candidat : sans jeton valide, aucun appel Anthropic.
// Env : ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY (et éventuellement SUPABASE_URL).

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://omftqlvkmjlxoinruayr.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function validerJeton(token){
  if(!SERVICE_KEY) return { ok:false, code:500, reason:'config' };
  token = String(token || '').trim();
  if(!UUID_RE.test(token)) return { ok:false, code:400, reason:'lien invalide' };
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });
  const { data: cand, error } = await sb
    .from('parcours_candidats')
    .select('id, statut, expires_at')
    .eq('token', token)
    .maybeSingle();
  if(error) return { ok:false, code:500, reason:'erreur' };
  if(!cand)  return { ok:false, code:404, reason:'introuvable' };
  if(cand.statut === 'archive') return { ok:false, code:403, reason:'archivé' };
  if(cand.expires_at && new Date(cand.expires_at) < new Date()) return { ok:false, code:403, reason:'expiré' };
  return { ok:true, cand };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY manquante' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps de requête invalide' }) }; }

  // --- validation du jeton candidat AVANT tout appel Anthropic ---
  const token = body.token || (event.queryStringParameters && event.queryStringParameters.c);
  const v = await validerJeton(token);
  if (!v.ok) return { statusCode: v.code, headers, body: JSON.stringify({ error: 'Accès refusé (' + v.reason + ')' }) };
  delete body.token; // ne jamais transmettre à Anthropic

  // Haiku sur TOUS les appels (comme claude.js) — évite aussi tout souci de modèle déprécié côté sims
  body.model = 'claude-haiku-4-5-20251001';
  if (!body.max_tokens) body.max_tokens = 1500;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 24000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(tid);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { data = { error: text.slice(0, 300) }; }
    if (!res.ok && data.error) {
      data = { error: typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : String(data.error) };
    }
    return { statusCode: res.status, headers, body: JSON.stringify(data) };
  } catch(e) {
    clearTimeout(tid);
    const msg = e.name === 'AbortError' ? 'Délai dépassé — réessayez.' : 'Erreur réseau : ' + e.message;
    return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
  }
};
