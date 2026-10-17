// netlify/functions/dojo-claude.js
// Proxy sécurisé vers l'API Anthropic pour le KW-Dojo.
// Aligné sur la sécurité du Cockpit : vérifie le token Supabase de l'appelant,
// la clé API reste côté serveur, aucune clé acceptée depuis le navigateur.
// Utilise Haiku (rapide, sous la limite de temps Netlify).

const { createClient } = require('@supabase/supabase-js');

// Droits : les MÊMES que l'onglet Dojo du Cockpit (Admin → Accès par fonction, profil Membre Codir). Un rôle inconnu n'a aucun accès.
const ROLE_MAP = {
  'direction':'eric','ceo':'eric','eric':'eric','cto':'cto','si':'eric','communication':'communication','comm':'communication',
  'commerce':'paul','paul':'paul',
  'mktg et produit':'juliette','marketing':'juliette','marketing & communication':'juliette','juliette':'juliette',
  'méthodes':'audrey','methodes':'audrey','réalisation & compétences':'audrey','realisation':'audrey','audrey':'audrey',
  'rh':'sabrine','sabrine':'sabrine',
  'administration des affaires':'najoua','administration':'najoua','finance & admin':'najoua','finance':'najoua','najoua':'najoua',
  'transformation':'transformation','consultant':'consultant','pmo':'pmo','project management officer':'pmo',
};
// Valeur par défaut de l'onglet Dojo quand la matrice d'Admin ne dit rien (copie de tabDefault du Cockpit, + PMO = Clap! seul)
function dojoDefault(code) {
  if (code === 'consultant' || code === 'communication' || code === 'pmo') return false;
  if (code === 'cto') return true;
  return code !== 'najoua' && code !== 'paul' && code !== 'juliette';
}

async function requireAuth(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return { ok: false, code: 401, msg: 'Token invalide' };
  const email = String(data.user.email || '').trim().toLowerCase();
  const refus = { ok: false, code: 403, msg: 'Accès au Dojo non autorisé pour votre fonction (Cockpit : Admin → Accès par fonction).' };

  let ua;
  try { ({ data: ua } = await sb.from('user_access').select('*').eq('email', email).maybeSingle()); } catch (e) { ua = null; }
  if (!ua) return refus;
  const code = ua.is_admin === true ? 'eric' : ROLE_MAP[String(ua.role || '').toLowerCase().trim()];
  if (!code) return refus;

  let tabs = {};
  try {
    const { data: ra } = await sb.from('role_access').select('role,tabs').in('role', [code, 'codir']);
    (ra || []).forEach((r) => { tabs[r.role] = r.tabs || {}; });
  } catch (e) { tabs = {}; }
  const own = tabs[code] && typeof tabs[code].dojo === 'boolean' ? tabs[code].dojo : dojoDefault(code);
  const codir = ua.codir === true && tabs.codir && tabs.codir.dojo === true;
  if (!own && !codir) return refus;
  return { ok: true, email };
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
