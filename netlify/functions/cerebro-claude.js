// netlify/functions/cerebro-claude.js  (v3)
// Proxy IA pour CEREBRO (onglet Cockpit). Authentifié par la SESSION Supabase du
// Cockpit (JWT Bearer). Clé Anthropic gardée côté serveur.
//
// Réglages par variables d'env (Netlify, scope All) — AUCUNE obligatoire :
//   CEREBRO_MODEL       (défaut "claude-sonnet-5")
//   CEREBRO_WEB_SEARCH  ("on" pour autoriser l'outil web_search ; sinon il est retiré)
//     -> laissé sur OFF par défaut : garantit une réponse texte. À passer "on"
//        une fois que tu as confirmé que web_search est activé sur ta clé Anthropic.
// Après toute modif de variable : redéploiement Netlify nécessaire.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://omftqlvkmjlxoinruayr.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL         = process.env.CEREBRO_MODEL || 'claude-sonnet-5';
const WEB_SEARCH_ON = (process.env.CEREBRO_WEB_SEARCH || '').toLowerCase() === 'on';
const ANTHROPIC_VERSION = '2023-06-01';

function json(code, obj){
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST')   return json(405, { error: 'Method Not Allowed' });
  if (!SERVICE_KEY || !ANTHROPIC_KEY) return json(500, { error: 'config serveur incomplète' });

  // 1) Auth : JWT de session Supabase du Cockpit
  var auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  var token = String(auth).replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'non authentifié (session Cockpit requise)' });
  try {
    var sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    var u = await sb.auth.getUser(token);
    if (u.error || !u.data || !u.data.user) return json(401, { error: 'session invalide' });
  } catch (e) { return json(401, { error: 'session invalide' }); }

  // 2) Corps
  var body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'corps invalide' }); }

  // Plancher relevé : Sonnet 5 compte le "thinking" dans max_tokens ; on garde de la marge.
  var max_tokens = Math.max(2048, Math.min(8192, Number(body.max_tokens) || 2048));
  var payload = {
    model: MODEL,
    max_tokens: max_tokens,
    messages: Array.isArray(body.messages) ? body.messages : []
  };
  if (body.system) payload.system = body.system;
  // NB : pas de temperature/top_p/top_k -> Sonnet 5 renvoie 400 sur valeurs non-défaut.

  if (WEB_SEARCH_ON && Array.isArray(body.tools) && body.tools.length) {
    // Recherche activée : on laisse le raisonnement adaptatif (utile pour l'usage d'outils)
    payload.tools = body.tools;
    payload.max_tokens = Math.max(payload.max_tokens, 4096);
  } else {
    // Sans recherche : on COUPE le raisonnement, sinon Sonnet 5 le fait par défaut
    // et épuise max_tokens en réflexion -> réponse sans texte ("réponse vide").
    payload.thinking = { type: 'disabled' };
  }

  // 3) Appel Anthropic
  var r, txt;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(payload)
    });
    txt = await r.text();
  } catch (e) {
    return json(502, { error: 'appel IA impossible : ' + (e && e.message ? e.message : 'réseau') });
  }

  // Erreur Anthropic : remonter le message réel (fini le "réponse vide" opaque)
  if (!r.ok) {
    var msg = 'Erreur API ' + r.status;
    try { var j = JSON.parse(txt); if (j && j.error && j.error.message) msg = 'API ' + r.status + ' : ' + j.error.message; } catch (e) {}
    return json(r.status, { error: msg, model: MODEL });
  }

  // Succès : renvoyer la réponse Anthropic telle quelle (forme data.content attendue par le front)
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: txt
  };
};
