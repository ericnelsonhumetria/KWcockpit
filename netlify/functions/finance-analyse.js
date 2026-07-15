// netlify/functions/finance-analyse.js
// Analyse IA des résultats financiers (direction). La clé Anthropic reste côté serveur.
// Aligné sur finance-projection.js (garde requireDirection) et dojo-claude.js (appel Anthropic).
// POST { contexte:{...} }  ->  { analyse:{ constat, leviers_situation[], leviers_action[], angles_morts[] } }
//
// Modèle : par défaut le même Haiku que dojo-claude (rapide, éprouvé dans ce compte).
// Pour une analyse plus fine, définir la variable d'env FINANCE_ANALYSE_MODEL (ex. un Sonnet).
//
// Robustesse JSON : Haiku tronque/malforme parfois sa sortie (cf. §9#4). parseAnalyse
// tente d'abord un parse strict, puis répare un JSON tronqué (closeTruncatedJSON, porté
// de humetria-radar.jsx) au lieu de renvoyer « Analyse illisible ».

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
  return `Tu es l'analyste financier de direction de Kaizen Way — cabinet de transformation industrielle (méthodologie Go Gemba®, ~1,6 M€ de CA, structure mixte : consultants salariés + freelances). Tu écris pour le dirigeant, en français, de façon dense, concrète et tranchée. Pas de langue de bois, pas de padding.

MODÈLE FINANCIER (à ne pas dériver) :
- EBITDA = CA HT (facturé) − charges d'exploitation.
- Les charges in-EBITDA se répartissent en : "opex" (charges d'exploitation, qui CONTIENT les salaires nets — non isolables ici), "social" (URSSAF uniquement), "soustraitance" (freelances productifs).
- Objectif CA 2026 = 1 800 000 €. Repères 2025 : CA 1 302 999,76 € ; EBITDA 181 663,66 € ; marge ~26,1 % ; sous-traitance ~14 % du CA.
- L'atterrissage est projeté par scénario (Facturé ⊂ Commandé ⊂ Pondéré 75 % ⊂ Pondéré 50 %) ; la base de charges est un run-rate (charges à date ÷ fraction d'année × facteur d'annualisation).

TA MISSION, à partir UNIQUEMENT des chiffres fournis :
1. Un CONSTAT lucide sur la situation CA / marge (vs objectif 2026 et vs repères 2025 : où se situe-t-on, l'écart se creuse-t-il ou se comble-t-il).
2. Les LEVIERS EXPLICATIFS qui mènent à cette situation. Cherche notamment, quand les données le permettent : le prix de vente / TJM implicite, le ratio de sous-traitance (vs ~14 %), la structure de charges (poids opex incluant masse salariale), le mix salarié/freelance, l'effet du facteur d'annualisation, la position de trésorerie / l'encours client. Pour chacun : impact "fort", "moyen" ou "faible".
3. Les LEVIERS D'ACTION recommandés, hiérarchisés, concrets et actionnables, pour améliorer CA et marge. Pour chacun : l'action, l'effet attendu, l'horizon ("court terme" / "moyen terme").

GARDE-FOUS ABSOLUS :
- Valeur fondatrice de Kaizen Way : « l'humain avant toute chose ». Ne recommande JAMAIS de traiter les personnes comme des coûts à comprimer. Tout levier RH se formule en développement des compétences, optimisation du taux d'activité / staffing, montée en charge — jamais en licenciement, gel ou compression de la masse humaine.
- N'invente AUCUN chiffre. Appuie-toi seulement sur les données fournies ; chiffre tes constats en comparant aux repères 2025 et à l'objectif quand c'est possible.
- Ce que les données NE montrent PAS (taux d'occupation par consultant, TJM par mission, pipeline commercial R1/R2, masse salariale isolée du reste de l'opex, saisonnalité fine) → mets-le en "angles_morts". Ne le devine pas, ne le présente pas comme un fait.

FORMAT DE SORTIE (impératif) :
- Réponds UNIQUEMENT en JSON valide, sans texte ni Markdown autour.
- JSON strict : pas de virgule finale, guillemets doubles, guillemets internes échappés.
- Sois concis : AU PLUS 4 éléments dans "leviers_situation", AU PLUS 4 dans "leviers_action", AU PLUS 4 dans "angles_morts". Chaque texte reste court.
- Structure EXACTE :
{"constat":"2 à 4 phrases","leviers_situation":[{"levier":"nom court","constat":"1-2 phrases chiffrées si possible","impact":"fort|moyen|faible"}],"leviers_action":[{"levier":"nom court","action":"quoi faire, concret","effet_attendu":"sur CA/marge","horizon":"court terme|moyen terme"}],"angles_morts":["éléments non visibles dans les données"]}`;
}

// Répare un JSON tronqué (coupé à max_tokens) : coupe au dernier séparateur sûr hors
// chaîne, retire une virgule finale, puis referme les structures restées ouvertes.
// Porté de humetria-radar.jsx (closeTruncatedJSON) — éprouvé sur Haiku.
function closeTruncatedJSON(t) {
  let inStr = false, esc = false, cut = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === ',' || c === '}' || c === ']') cut = i;
  }
  if (cut < 0) throw new Error('JSON irrécupérable');
  let out = t.slice(0, t[cut] === ',' ? cut : cut + 1); // si le point de coupe est une virgule, on l'enlève
  const st = []; inStr = false; esc = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') st.push('}');
    else if (c === '[') st.push(']');
    else if (c === '}' || c === ']') st.pop();
  }
  while (st.length) out += st.pop(); // ferme { et [ restés ouverts
  return out;
}

function parseAnalyse(text) {
  let t = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = t.indexOf('{');
  if (s < 0) throw new Error('JSON introuvable dans la réponse du modèle');
  t = t.slice(s);
  // 1) tentative stricte sur le plus grand bloc {...}
  const e = t.lastIndexOf('}');
  if (e > 0) { try { return JSON.parse(t.slice(0, e + 1)); } catch (_) {} }
  // 2) JSON tronqué (coupé à max_tokens) : on répare puis on reparse
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

  const payload = {
    model: process.env.FINANCE_ANALYSE_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    system: systemPrompt(),
    messages: [{
      role: 'user',
      content: 'Voici les données financières (JSON). Analyse-les selon ta mission.\n\n' + JSON.stringify(contexte, null, 2),
    }],
  };

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
