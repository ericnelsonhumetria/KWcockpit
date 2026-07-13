// netlify/functions/cerebro-claude.js
// Proxy IA pour CEREBRO (onglet Cockpit). Authentifié par la SESSION Supabase
// du Cockpit (JWT Bearer) — PAS par jeton candidat comme parcours-claude.
// Autorise Sonnet + l'outil web_search. La clé Anthropic ne quitte jamais le serveur.
// Env : SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (et éventuellement SUPABASE_URL).

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://omftqlvkmjlxoinruayr.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-5';          // forcé serveur (neutralise le modèle envoyé par le front)
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
  if (!SERVICE_KEY || !ANTHROPIC_KEY) return json(500, { error: 'config' });

  // 1) Auth : vérifier le JWT de session Supabase du Cockpit
  var auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  var token = String(auth).replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'non authentifié' });
  try {
    var sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    var u = await sb.auth.getUser(token);
    if (u.error || !u.data || !u.data.user) return json(401, { error: 'session invalide' });
  } catch (e) { return json(401, { error: 'session invalide' }); }

  // 2) Corps
  var body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'corps invalide' }); }
  var max_tokens = Math.max(1, Math.min(4096, Number(body.max_tokens) || 1000));
  var payload = {
    model: MODEL,
    max_tokens: max_tokens,
    messages: Array.isArray(body.messages) ? body.messages : []
  };
  if (body.system) payload.system = body.system;
  if (body.temperature != null) payload.temperature = body.temperature;
  if (Array.isArray(body.tools)) payload.tools = body.tools;   // laisse passer web_search

  // 3) Appel Anthropic (clé serveur uniquement) — réponse renvoyée telle quelle
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(payload)
    });
    var txt = await r.text();
    return {
      statusCode: r.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: txt
    };
  } catch (e) { return json(502, { error: 'appel IA impossible' }); }
};
