// netlify/functions/action-ia.js
// Reformulation IA d'une action dictée -> action structurée, en matchant contre les
// référentiels FERMÉS fournis par le front (thématiques, pilotes). N'écrit RIEN en base :
// renvoie un brouillon que l'utilisateur valide côté client (insert sous sa session).
//
// POST { texte, today:'YYYY-MM-DD', pilotes:[{nom,alias:[]}], thematiques:[{code,libelle}] }
//  -> { libelle, thematique, pilote_nom|null, echeance:'YYYY-MM-DD'|null, priorite:1|2|3 }
//
// Clé Anthropic côté serveur. Accès : tout utilisateur interne (ligne user_access).

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

function closeTruncatedJSON(t) {
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
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') st.push('}');
    else if (c === '[') st.push(']');
    else if (c === '}' || c === ']') st.pop();
  }
  while (st.length) out += st.pop();
  return out;
}
function parseJSON(text) {
  let t = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = t.indexOf('{');
  if (s < 0) throw new Error('JSON introuvable');
  t = t.slice(s);
  const e = t.lastIndexOf('}');
  if (e > 0) { try { return JSON.parse(t.slice(0, e + 1)); } catch (_) {} }
  return JSON.parse(closeTruncatedJSON(t));
}

function systemPrompt(pilotes, thematiques, today) {
  const listeThemes = thematiques.map(t => '- ' + t.code + ' : ' + t.libelle).join('\n');
  const listePilotes = pilotes.map(p => '- ' + p.nom + (p.alias && p.alias.length ? ' (alias : ' + p.alias.join(', ') + ')' : '')).join('\n');
  return `Tu structures une action dictée à l'oral par un dirigeant de Kaizen Way (cabinet de transformation industrielle). À partir du texte brut, tu produis une action claire et exploitable.

DATE DU JOUR : ${today} (pour résoudre les échéances relatives : "demain", "vendredi", "fin de semaine", "dans 15 jours", "fin de mois"…).

THÉMATIQUES AUTORISÉES (choisis EXACTEMENT un de ces codes, sinon "autre") :
${listeThemes}

PILOTES CONNUS (associe l'action à un pilote UNIQUEMENT si le texte le désigne clairement, via son nom ou un alias ; sinon null) :
${listePilotes}

RÈGLES :
- "libelle" : reformulation courte, actionnable, commençant par un verbe à l'infinitif (ex. "Relancer Andros sur le calendrier S2"). Fidèle au fond, sans inventer de détail absent.
- "thematique" : un code de la liste ci-dessus, ou "autre".
- "pilote_nom" : le NOM EXACT d'un pilote de la liste (pas l'alias), ou null si aucun n'est clairement désigné. N'invente jamais un pilote.
- "echeance" : "YYYY-MM-DD" si une date ou un délai est exprimé, calculé depuis la date du jour ; sinon null.
- "priorite" : 1 (haute/urgent), 2 (normale, défaut), 3 (basse).

FORMAT : réponds UNIQUEMENT en JSON valide, sans texte ni Markdown autour, sans virgule finale :
{"libelle":"...","thematique":"code","pilote_nom":null,"echeance":null,"priorite":2}`;
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

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps invalide' }) }; }
  const texte = (body && typeof body.texte === 'string') ? body.texte.trim() : '';
  if (!texte) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Texte vide' }) };
  const pilotes = Array.isArray(body.pilotes) ? body.pilotes : [];
  const thematiques = Array.isArray(body.thematiques) ? body.thematiques : [];
  const today = (body && /^\d{4}-\d{2}-\d{2}$/.test(body.today)) ? body.today : new Date().toISOString().slice(0, 10);

  const payload = {
    model: process.env.ACTION_IA_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: systemPrompt(pilotes, thematiques, today),
    messages: [{ role: 'user', content: 'Texte dicté :\n"' + texte + '"' }],
  };

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const raw = await res.text();
    let data; try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!res.ok) {
      const m = (data && data.error) ? (typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : String(data.error)) : raw.slice(0, 200);
      return { statusCode: res.status, headers, body: JSON.stringify({ error: m }) };
    }
    const txt = ((data && data.content) || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!txt) return { statusCode: 502, headers, body: JSON.stringify({ error: 'Réponse vide du modèle' }) };

    let out;
    try { out = parseJSON(txt); } catch (e) { return { statusCode: 502, headers, body: JSON.stringify({ error: 'Réponse illisible — ' + (e.message || 'JSON invalide') }) }; }

    // Normalisation stricte contre les référentiels fermés
    const codes = thematiques.map(t => t.code);
    const noms = pilotes.map(p => p.nom);
    const libelle = (typeof out.libelle === 'string' && out.libelle.trim()) ? out.libelle.trim() : texte;
    const thematique = codes.includes(out.thematique) ? out.thematique : 'autre';
    const pilote_nom = noms.includes(out.pilote_nom) ? out.pilote_nom : null;
    let echeance = null;
    if (typeof out.echeance === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(out.echeance)) {
      const d = new Date(out.echeance);
      if (!isNaN(d.getTime())) echeance = out.echeance;
    }
    let priorite = parseInt(out.priorite, 10);
    if (!(priorite === 1 || priorite === 2 || priorite === 3)) priorite = 2;

    return { statusCode: 200, headers, body: JSON.stringify({ libelle, thematique, pilote_nom, echeance, priorite }) };
  } catch (e) {
    clearTimeout(tid);
    const m = e.name === 'AbortError' ? 'Délai dépassé — réessaie.' : 'Erreur réseau : ' + e.message;
    return { statusCode: 502, headers, body: JSON.stringify({ error: m }) };
  }
};
