// netlify/functions/finance-analyse.js
// Analyse IA des résultats financiers (direction). La clé Anthropic reste côté serveur.
// Aligné sur finance-projection.js (garde requireDirection) et dojo-claude.js (appel Anthropic).
// POST { contexte:{...} }  ->  { analyse:{ constat, leviers_situation[], leviers_action[], angles_morts[] } }
//
// Modèle : par défaut le même Haiku que dojo-claude (rapide, éprouvé dans ce compte).
// Pour une analyse plus fine, définir la variable d'env FINANCE_ANALYSE_MODEL (ex. un Sonnet).

const { createClient } = require('@supabase/supabase-js');

async function requireDirection(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error } = await sb.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, code: 401, msg: 'Token invalide' };
  const email = (userData.user.email || '').toLowerCase();
  const { data: access } = await sb
    .from('user_access').select('is_admin, role').eq('email', email).single();
  const isDirection = access && (access.is_admin === true || access.role === 'direction' || access.role === 'eric' || access.role === 'najoua');
  if (!isDirection) return { ok: false, code: 403, msg: 'Accès réservé à la direction / finance' };
  return { ok: true, email };
}

function systemPrompt() {
  return `Tu es l'expert-comptable et conseil de gestion de Kaizen Way. Tu analyses les chiffres comme en rendez-vous de bilan avec le dirigeant : lecture rigoureuse, dense, équilibrée, sans jargon gratuit ni sur-simplification. En français.

POSTURE :
- Praticien du chiffre : soldes intermédiaires de gestion, ratios, structure de coûts, levier opérationnel — jamais de généralités.
- Équilibré : d'abord ce qui est sain, puis les points de vigilance sans dramatiser, enfin le conseil. La valeur vient de la justesse, pas de l'inquiétude.

EXIGENCE DE PROFONDEUR (mobilise ce que les données permettent) :
- Décompose la marge (CA -> opex dont masse salariale, URSSAF, sous-traitance -> EBITDA -> marge) ; ne la résume pas.
- Effet ciseau CHIFFRÉ : dynamique du CA (réalisé + atterrissage) vs celle des charges vs 2025 — l'écart se creuse-t-il, de combien de points / d'euros ?
- Levier opérationnel : sensibilité de l'EBITDA à ±X % de CA compte tenu de la part vraisemblablement fixe.
- Rentabilité relative : marge d'atterrissage vs 26,1 % (2025) ; écart à l'objectif et rythme de facturation qu'il impose sur les mois restants.
- Make-or-buy : à partir de mix_realisation (CA et coût de sous-traitance des lignes freelance vs salarié), chiffre la marge brute captée sur le sous-traité et l'effet d'un rééquilibrage.
- Point mort implicite / zone de sécurité si les données le permettent.

RÈGLE SUR LES RECOMMANDATIONS (le cœur de ta valeur) :
Tu ne recommandes une décision QUE si tu peux poser, à partir des SEULES données fournies, un GAIN CHIFFRÉ (en € ou en points de marge) ET le RISQUE / la contrepartie que tu identifies (chiffré si les données le permettent, sinon nommé précisément).
- Formule chaque recommandation comme un ARBITRAGE : ce qu'on gagne vs ce qu'on expose. Jamais de conseil vague, jamais d'effet « à confirmer » sans chiffre.
- Une piste prometteuse mais non chiffrable faute de donnée ne devient PAS une recommandation : elle part en angles_morts avec la donnée manquante nommée.
- Exemple du niveau attendu : rééquilibrer freelance -> salarié — gain = sous-traitance économisée (chiffrée depuis mix_realisation) ; risque = coût fixe interne ajouté / capacité / engagement social (chiffré si possible, sinon nommé « coût jour salarié non fourni : à instruire »).

GARDE-FOUS ABSOLUS :
- « L'humain avant toute chose » : jamais de recommandation traitant les personnes comme des coûts à comprimer. Les leviers RH se formulent en taux d'activité / staffing / montée en compétence / internalisation — jamais licenciement, gel, ni compression.
- N'INVENTE AUCUN chiffre. Uniquement les données fournies ; un ratio non calculable ne se fabrique pas. Le coût jour d'un salarié n'est PAS fourni : ne le suppose pas, traite-le comme un risque à instruire.
- Mesuré : pas de superlatifs, pas de fausse urgence.

FORMAT : au plus 4 items par liste, phrases denses mais courtes. Réponds UNIQUEMENT en JSON valide, sans texte ni Markdown, structure EXACTE :
{"constat":"3 à 5 phrases, lecture de gestion équilibrée et chiffrée","points_forts":["≤4 forces réelles et chiffrées"],"leviers_situation":[{"levier":"nom court","constat":"analyse chiffrée, 1-3 phrases","impact":"fort|moyen|faible"}],"leviers_action":[{"levier":"nom court","action":"décision concrète, formulée en arbitrage","gain_chiffre":"gain en € ou en points de marge, calculé depuis les données","risque":"contrepartie / risque identifié, chiffré si possible sinon nommé","horizon":"court terme|moyen terme"}],"angles_morts":["≤4 éléments non visibles ou non chiffrables, avec la donnée manquante nommée"]}`;
}

function closeTruncatedJSON(t) {
  // Trouve le dernier separateur/fermeture hors chaine = point de coupe sur,
  // puis referme les structures ouvertes. Recupere un JSON tronque ou malforme.
  let inStr = false, esc = false, cut = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === ',' || c === '}' || c === ']') cut = i;
  }
  if (cut < 0) throw new Error('JSON irrécupérable');
  let out = t.slice(0, t[cut] === ',' ? cut : cut + 1);
  const st = []; inStr = false; esc = false;
  for (let j = 0; j < out.length; j++) {
    const d = out[j];
    if (inStr) { if (esc) esc = false; else if (d === '\\') esc = true; else if (d === '"') inStr = false; continue; }
    if (d === '"') inStr = true;
    else if (d === '{') st.push('}');
    else if (d === '[') st.push(']');
    else if (d === '}' || d === ']') st.pop();
  }
  while (st.length) out += st.pop();
  return out;
}
function parseAnalyse(text) {
  let t = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = t.indexOf('{');
  if (s < 0) throw new Error('JSON introuvable dans la réponse du modèle');
  t = t.slice(s);
  const e = t.lastIndexOf('}');
  if (e > 0) { try { return JSON.parse(t.slice(0, e + 1)); } catch (_) {} }
  return JSON.parse(closeTruncatedJSON(t));
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

  const guard = await requireDirection(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers, body: JSON.stringify({ error: guard.msg }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps de requête invalide' }) }; }

  const contexte = (body && body.contexte && typeof body.contexte === 'object') ? body.contexte : null;
  if (!contexte) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Contexte financier manquant' }) };

  const model = process.env.FINANCE_ANALYSE_MODEL || 'claude-haiku-4-5-20251001';
  const payload = {
    model: model,
    max_tokens: 2400,
    system: systemPrompt(),
    messages: [{
      role: 'user',
      content: 'Voici les données financières (JSON). Analyse-les selon ta mission.\n\n' + JSON.stringify(contexte, null, 2),
    }],
  };
  // Sonnet 5 : désactiver le raisonnement adaptatif sur cet appel standard (sinon il consomme tout le budget).
  if (/sonnet-5/.test(model)) payload.thinking = { type: 'disabled' };

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);
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
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!res.ok) {
      const msg = (data && data.error) ? (typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : String(data.error)) : raw.slice(0, 300);
      return { statusCode: res.status, headers, body: JSON.stringify({ error: msg }) };
    }
    const txt = ((data && data.content) || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!txt) return { statusCode: 502, headers, body: JSON.stringify({ error: 'Réponse vide du modèle' }) };
    let analyse;
    try { analyse = parseAnalyse(txt); }
    catch (e) { return { statusCode: 502, headers, body: JSON.stringify({ error: 'Analyse illisible — ' + (e.message || 'JSON invalide') }) }; }
    return { statusCode: 200, headers, body: JSON.stringify({ analyse }) };
  } catch (e) {
    clearTimeout(tid);
    const msg = e.name === 'AbortError' ? 'Délai dépassé — réessaie.' : 'Erreur réseau : ' + e.message;
    return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
  }
};
