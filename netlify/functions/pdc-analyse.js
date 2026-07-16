// netlify/functions/pdc-analyse.js
// Extraction IA d'un planning importe -> lignes de charge, cote SERVEUR.
// Appelee par pdcAnalyser() (onglet Plan de charge) pour un consultant (soi)
// ou, pour un manager, au nom d'un tiers. La cle Anthropic reste cote serveur.
// Calque : requireAuth (pdc-conseil.js) + appel Anthropic + reparation JSON (finance-analyse.js).
//
// Entree (POST JSON) :
//   { missions:[{code,intitule,client}], activites:[{code,libelle}],
//     fileText?:string | (fileBase64?:string + mediaType?:string) }
// Sortie :
//   { entries:[{date:'YYYY-MM-DD', mission_code, activite|null, etat, jours}], parse_ok:true }
//   ou { parse_ok:false }  ou { error:'...' } (status != 200)
//
// Modele : Haiku par defaut (rapide, gere la vision). Pour une extraction plus fine
// sur images/PDF, definir la variable d'env PDC_ANALYSE_MODEL (ex. un Sonnet)
// sans toucher au code.

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

function systemPrompt() {
  return `Tu es un assistant d'extraction de planning pour un cabinet de conseil (Kaizen Way). On te fournit le planning d'UN SEUL consultant (sous forme de texte, CSV, tableur converti, image ou PDF) et la liste de ses missions et activités. Ta seule tâche : en extraire, ligne par ligne, les jours de charge, et les rattacher aux codes de mission fournis.

RÈGLES ABSOLUES :
- Chaque entrée = une charge sur UNE mission, à UNE date précise. Date au format ISO strict AAAA-MM-JJ. N'invente jamais une date : si une case n'a pas de date exploitable, ignore-la.
- "jours" vaut 1 (journée pleine) ou 0,5 (demi-journée). Convertis toute autre notation : une croix / "X" / "1" / journée = 1 ; "½", "0,5", "AM", "PM", "matin", "après-midi" = 0,5. Ignore les cases vides, "0", congés, week-ends sans charge.
- "mission_code" DOIT être exactement l'un des codes de la liste fournie. Le planning peut nommer la mission par son intitulé ou son client : rattache-le au bon code. Si aucune correspondance fiable n'existe, OMETS la ligne (ne devine pas un code).
- "activite" = un code d'activité de la liste si le planning le précise, sinon null.
- "etat" = "planifie" par défaut (un planning importé est prévisionnel), sauf mention explicite de temps déjà réalisé -> "realise".
- N'invente aucune charge. Extrais uniquement ce qui figure réellement dans le document.
- Limite-toi à 200 entrées maximum ; concentre-toi sur les données réelles.

Réponds UNIQUEMENT en JSON valide, sans texte ni Markdown autour, structure EXACTE :
{"entries":[{"date":"AAAA-MM-JJ","mission_code":"code exact","activite":null,"etat":"planifie","jours":1}]}
Si le document ne contient aucune charge exploitable, renvoie {"entries":[]}.`;
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

// Tolère : objet {entries:[...]}, tableau nu [...], ou JSON tronqué.
function parseEntries(text) {
  let t = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  // Cas objet en premier
  if (firstObj >= 0 && (firstArr < 0 || firstObj < firstArr)) {
    const body = t.slice(firstObj);
    const e = body.lastIndexOf('}');
    if (e > 0) { try { const o = JSON.parse(body.slice(0, e + 1)); return o.entries || []; } catch (_) {} }
    try { const o = JSON.parse(closeTruncatedJSON(body)); return o.entries || []; } catch (_) {}
  }
  // Cas tableau nu
  if (firstArr >= 0) {
    const body = t.slice(firstArr);
    const e = body.lastIndexOf(']');
    if (e > 0) { try { const a = JSON.parse(body.slice(0, e + 1)); if (Array.isArray(a)) return a; } catch (_) {} }
    try { const a = JSON.parse(closeTruncatedJSON(body)); if (Array.isArray(a)) return a; } catch (_) {}
  }
  throw new Error('JSON introuvable dans la réponse du modèle');
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

  const guard = await requireAuth(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers, body: JSON.stringify({ error: guard.msg }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps de requête invalide' }) }; }

  const missions = Array.isArray(body.missions) ? body.missions : [];
  const activites = Array.isArray(body.activites) ? body.activites : [];
  if (!missions.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Aucune mission de référence — le consultant doit être affecté à au moins une mission.' }) };

  const hasText = typeof body.fileText === 'string' && body.fileText.trim();
  const hasFile = typeof body.fileBase64 === 'string' && body.fileBase64.length > 0;
  if (!hasText && !hasFile) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Aucun contenu de planning reçu' }) };

  const refMissions = missions.map(m => `- code "${m.code}" : ${m.intitule || m.code}${m.client ? ' (client : ' + m.client + ')' : ''}`).join('\n');
  const refActivites = activites.length
    ? activites.map(a => `- code "${a.code}" : ${a.libelle || a.code}`).join('\n')
    : '(aucune activité définie — mets toujours activite=null)';

  const consigne = `MISSIONS de ce consultant (rattache chaque charge à l'un de ces codes) :\n${refMissions}\n\nACTIVITÉS disponibles :\n${refActivites}\n\nExtrais maintenant les jours de charge du planning ci-dessous.`;

  // Contenu utilisateur : texte, ou document/image en base64.
  const content = [];
  if (hasFile) {
    const mt = body.mediaType || 'image/png';
    if (mt === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.fileBase64 } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: body.fileBase64 } });
    }
    content.push({ type: 'text', text: consigne });
  } else {
    content.push({ type: 'text', text: consigne + '\n\n--- PLANNING ---\n' + body.fileText });
  }

  const payload = {
    model: process.env.PDC_ANALYSE_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    system: systemPrompt(),
    messages: [{ role: 'user', content }],
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
    let entries;
    try { entries = parseEntries(txt); }
    catch (e) { return { statusCode: 200, headers, body: JSON.stringify({ parse_ok: false }) }; }
    if (!Array.isArray(entries)) entries = [];
    return { statusCode: 200, headers, body: JSON.stringify({ entries, parse_ok: true }) };
  } catch (e) {
    clearTimeout(tid);
    const msg = e.name === 'AbortError' ? 'Délai dépassé — réessaie avec un fichier plus court.' : 'Erreur réseau : ' + e.message;
    return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
  }
};
