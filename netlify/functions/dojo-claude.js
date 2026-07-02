// netlify/functions/dojo-claude.js
// Proxy sécurisé vers l'API Anthropic pour le KW-Dojo.
// Aligné sur la sécurité du Cockpit : vérifie le token Supabase de l'appelant,
// la clé API reste côté serveur, aucune clé acceptée depuis le navigateur.
// Utilise Haiku (rapide, sous la limite de temps Netlify).

const { createClient } = require('@supabase/supabase-js');

async function requireAuth(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return { ok: false, code: 401, msg: 'Token invalide' };
  return { ok: true, email: data.user.email };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY manquante côté serveur' }) };

  // Authentification obligatoire (protège le crédit API)
  const guard = await requireAuth(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers, body: JSON.stringify({ error: guard.msg }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps de requête invalide' }) }; }

  // Le modèle est imposé côté serveur — on ignore tout ce que le front demande.
  // Haiku : rapide (~3-5s), largement sous la limite Netlify.
  const payload = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: body.max_tokens && body.max_tokens <= 4000 ? body.max_tokens : 1500,
    messages: Array.isArray(body.messages) ? body.messages : [],
  };
  if (body.system) payload.system = body.system;
  if (typeof body.temperature === 'number') payload.temperature = body.temperature;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 24000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { error: text.slice(0, 300) }; }
    if (!res.ok && data.error) {
      data = { error: typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : String(data.error) };
    }
    return { statusCode: res.status, headers, body: JSON.stringify(data) };
  } catch (e) {
    clearTimeout(tid);
    const msg = e.name === 'AbortError' ? 'Délai dépassé — réessayez.' : 'Erreur réseau : ' + e.message;
    return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
  }
};
