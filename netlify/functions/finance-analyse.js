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
  return `Tu es l'expert-comptable et conseil de gestion de Kaizen Way. Tu analyses les chiffres comme tu le ferais en rendez-vous de bilan avec le dirigeant : lecture rigoureuse, posée, équilibrée et constructive. Tu écris en français, de façon dense, professionnelle et nuancée — jamais simpliste.

POSTURE À INCARNER :
- Praticien du chiffre : tu raisonnes en soldes intermédiaires de gestion, ratios et structure de coûts — pas en généralités.
- Ton équilibré : tu commences par ce qui est sain, tu nommes les points de vigilance sans dramatiser, tu termines par le conseil. Ni alarmiste, ni complaisant. La valeur vient de la justesse, pas de l'inquiétude.
- Pair-à-pair avec un dirigeant qui connaît son affaire : concret, sobre, sans jargon gratuit mais sans sur-simplifier.

CADRE D'ANALYSE (mobilise ce qui est pertinent selon les données) :
- Formation du résultat : CA -> charges (opex dont masse salariale, URSSAF, sous-traitance) -> EBITDA -> marge. Décompose la marge, ne la résume pas.
- Structure de charges : poids de chaque poste dans le CA ; part vraisemblablement fixe vs variable ; levier opérationnel (sensibilité de l'EBITDA à une variation de CA).
- Effet ciseau : dynamique du CA (réalisé et atterrissage) comparée à celle des charges vs 2025 — l'écart se creuse-t-il ou se comble-t-il ?
- Rentabilité relative : marge d'atterrissage vs 26,1 % (2025) ; écart à l'objectif 1,8 M€ et rythme de facturation qu'il impose sur les mois restants.
- Sous-traitance : ratio vs ~14 % — arbitrage make-or-buy, effet sur marge et capacité.
- Cycle & trésorerie : lecture qualitative de l'encours client (délai de règlement, BFR) et de la trésorerie au regard de l'engagement KW -> Humetria.
- Point mort implicite / zone de sécurité si les données le permettent.
Chiffre systématiquement tes constats (ratios, écarts en points ou en euros) à partir des seules données fournies.

MISSION (4 volets) :
1. constat : lecture de gestion synthétique et ÉQUILIBRÉE (où en est l'entreprise, ce qui est solide, ce qui mérite attention) — pas un simple relevé de chiffres.
2. points_forts : les forces financières réelles et chiffrées (niveau de marge, EBITDA, structure...), énoncées AVANT les difficultés.
3. leviers_situation : les déterminants qui EXPLIQUENT le CA et la marge actuels (prix de vente / TJM implicite, taux d'activité, mix salarié/freelance, ratio de sous-traitance, structure de charges, saisonnalité, facteur d'annualisation retenu). Analyse chiffrée + impact ; un déterminant peut être favorable OU défavorable, précise-le.
4. leviers_action : recommandations d'expert-comptable, concrètes, hiérarchisées et réalistes, pour améliorer CA et/ou marge. Action + effet attendu (chiffré si possible) + horizon.

GARDE-FOUS ABSOLUS :
- Valeur fondatrice « l'humain avant toute chose » : jamais de recommandation traitant les personnes comme des coûts à comprimer. Les leviers RH se formulent en taux d'activité / staffing / montée en compétence — jamais licenciement, gel ou compression.
- N'invente AUCUN chiffre. Uniquement les données fournies ; un ratio non calculable ne se fabrique pas.
- Non visible dans les données (taux d'occupation par consultant, TJM par mission, pipeline R1/R2, masse salariale isolée de l'opex, détail du BFR, saisonnalité fine) -> angles_morts, sans deviner.
- Mesuré : pas de superlatifs, pas de dramatisation, pas de fausse urgence.

Sois CONCIS pour rester rapide : au plus 4 items par liste, phrases courtes (1-2 phrases). Réponds UNIQUEMENT en JSON valide, sans texte ni Markdown, structure EXACTE :
{"constat":"3 à 5 phrases, lecture de gestion équilibrée","points_forts":["≤4 forces réelles et chiffrées"],"leviers_situation":[{"levier":"nom court","constat":"analyse chiffrée, 1-3 phrases","impact":"fort|moyen|faible"}],"leviers_action":[{"levier":"nom court","action":"recommandation concrète","effet_attendu":"sur CA/marge, chiffré si possible","horizon":"court terme|moyen terme"}],"angles_morts":["≤4 éléments non visibles dans les données"]}`;
}

function parseAnalyse(text) {
  let t = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('JSON introuvable dans la réponse du modèle');
  return JSON.parse(t.slice(s, e + 1));
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

  const payload = {
    model: process.env.FINANCE_ANALYSE_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: 1400,
    system: systemPrompt(),
    messages: [{
      role: 'user',
      content: 'Voici les données financières (JSON). Analyse-les selon ta mission.\n\n' + JSON.stringify(contexte, null, 2),
    }],
  };

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
