// netlify/functions/humetria-ia.js
// IA de l'espace Humetria. Deux modes :
//   - conseil : analyse les blocs de l'espace + les actions Humetria, croise avec les
//               actualités du marché (recherche web) et propose des suggestions concrètes
//               pour améliorer la traction client. -> { conseil: markdown }
//   - news    : veille du secteur SaaS pour l'industrie (recherche web). -> { news: markdown }
// Clé Anthropic côté serveur. Accès : utilisateurs internes.

const { createClient } = require('@supabase/supabase-js');

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

async function callAnthropic(key, payload) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 26000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    clearTimeout(tid);
    const raw = await res.text();
    let data; try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!res.ok) {
      const m = (data && data.error) ? (typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : String(data.error)) : raw.slice(0, 300);
      return { ok: false, status: res.status, msg: m };
    }
    const txt = ((data && data.content) || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return { ok: true, txt };
  } catch (e) { clearTimeout(tid); return { ok: false, status: 502, msg: e.name === 'AbortError' ? 'Délai dépassé, réessaie.' : ('Erreur réseau : ' + e.message) }; }
}

function conseilPrompt(today) {
  return "Tu es le conseiller stratégique de Humetria, un SaaS B2B d'excellence managériale pour l'industrie "
    + "(mesure du comportement managérial via l'ICM®, équipement des managers et coachs internes, angle mort du COMEX). "
    + "Date du jour : " + today + ". "
    + "On te fournit les BLOCS de l'espace de pilotage Humetria (organisation, roadmap technique, plan marketing/communication, pitch & supports, prospects, etc.) "
    + "et les ACTIONS en cours rattachées à Humetria. "
    + "OBJECTIF : améliorer la TRACTION CLIENT de Humetria. "
    + "Utilise l'outil de recherche web pour identifier les actualités récentes et pertinentes du marché (SaaS industrie, excellence opérationnelle, management industriel, concurrents, tendances d'achat) puis CROISE ces signaux avec le contexte interne. "
    + "Rends un markdown concis et actionnable :\n"
    + "## Lecture rapide (2-3 lignes)\n## Signaux marché pertinents (puces courtes, avec la source entre parenthèses)\n## Suggestions priorisées pour la traction client (5 à 8 puces concrètes, chacune préfixée par [Rapide]/[Moyen]/[Structurant])\n## Idées à explorer (2-3 puces)\n"
    + "Sois précis, orienté résultat, pas de blabla. N'invente pas de chiffres.";
}
function newsPrompt(today) {
  return "Tu es la veille marché de Humetria (SaaS B2B d'excellence managériale pour l'industrie). "
    + "Date du jour : " + today + ". "
    + "Utilise la recherche web pour trouver les ACTUALITÉS RÉCENTES (idéalement des dernières semaines) du secteur : "
    + "SaaS pour l'industrie, excellence opérationnelle / lean, logiciels de management industriel et shopfloor, IA appliquée au management, levées de fonds et mouvements de concurrents, tendances d'achat des industriels. "
    + "Rends un digest markdown : 6 à 8 items, chacun sous la forme : **Titre court** — une phrase de fond, puis _Pertinence Humetria : …_ et la source entre parenthèses. "
    + "Priorise ce qui est utile à la traction client. N'invente rien ; si peu de résultats, dis-le.";
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
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY manquante côté serveur' }) };
  const guard = await requireInternal(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers, body: JSON.stringify({ error: guard.msg }) };

  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps invalide' }) }; }
  const mode = body.mode;
  const model = process.env.HUMETRIA_IA_MODEL || 'claude-haiku-4-5-20251001';
  const today = (body && /^\d{4}-\d{2}-\d{2}$/.test(body.today)) ? body.today : new Date().toISOString().slice(0, 10);
  const webTool = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];

  if (mode === 'conseil') {
    const blocs = Array.isArray(body.blocs) ? body.blocs : [];
    const actions = Array.isArray(body.actions) ? body.actions : [];
    const userMsg = 'BLOCS de l\'espace Humetria (JSON) :\n' + JSON.stringify(blocs, null, 2)
      + '\n\nACTIONS Humetria en cours (JSON) :\n' + JSON.stringify(actions, null, 2);
    const r = await callAnthropic(key, { model, max_tokens: 2600, system: conseilPrompt(today), tools: webTool, messages: [{ role: 'user', content: userMsg }] });
    if (!r.ok) return { statusCode: r.status, headers, body: JSON.stringify({ error: r.msg }) };
    if (!r.txt) return { statusCode: 502, headers, body: JSON.stringify({ error: 'Réponse vide du modèle' }) };
    return { statusCode: 200, headers, body: JSON.stringify({ conseil: r.txt }) };
  }

  if (mode === 'news') {
    const r = await callAnthropic(key, { model, max_tokens: 2200, system: newsPrompt(today), tools: webTool, messages: [{ role: 'user', content: 'Donne-moi le digest des actualités récentes du secteur SaaS pour l\'industrie et l\'excellence opérationnelle.' }] });
    if (!r.ok) return { statusCode: r.status, headers, body: JSON.stringify({ error: r.msg }) };
    if (!r.txt) return { statusCode: 502, headers, body: JSON.stringify({ error: 'Réponse vide du modèle' }) };
    return { statusCode: 200, headers, body: JSON.stringify({ news: r.txt }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Mode inconnu (conseil | news)' }) };
};
