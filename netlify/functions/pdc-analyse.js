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

function systemPrompt(anchorYear) {
  return `Tu es un assistant d'extraction de planning pour un cabinet de conseil (Kaizen Way). On te fournit le planning d'UN SEUL consultant (sous forme de texte, CSV, tableur converti, image ou PDF) et la liste de ses missions et activités. Ta seule tâche : en extraire, ligne par ligne, les jours de charge, et les rattacher aux codes de mission fournis.

ANNÉE DE RÉFÉRENCE : ${anchorYear}. Le planning couvre l'année ${anchorYear} et éventuellement l'année suivante (${anchorYear + 1}). C'est une information capitale :
- Si une date ne précise PAS son année (ex. "lun 13", "13/07", "S28", "juillet", "semaine 3"), tu DOIS l'interpréter dans l'année ${anchorYear}, ou ${anchorYear + 1} si le contexte du planning (mois qui repartent de janvier après décembre) l'impose clairement.
- Tu n'as ABSOLUMENT PAS le droit de produire une date antérieure à ${anchorYear}-01-01. Toute date que tu déduis est forcément >= ${anchorYear}. N'utilise jamais une année tirée de tes connaissances (${anchorYear - 1}, ${anchorYear - 2}, etc.) : elle serait fausse.
- Une année n'est reprise du document QUE si elle y est écrite noir sur blanc. Sinon, applique la règle ci-dessus.

FORMAT FRÉQUENT — MATRICE HEBDOMADAIRE (à reconnaître absolument) :
Beaucoup de plannings ne sont PAS des listes ligne par ligne mais une GRILLE. Repère cette structure :
- Les COLONNES sont des semaines : une ligne d'en-tête donne les numéros de semaine (ex. "S19", "S20"... qui peuvent dépasser 52 puis repartir à "S1"), une AUTRE ligne d'en-tête donne la date du lundi de chaque semaine (ex. "04/05", "11/05"...).
- Les LIGNES sont regroupées par BLOC. Chaque bloc correspond à un lot / une mission (souvent identifié par une colonne "N° lot" ou un intitulé comme "CE Valence", "L04"...). Sous chaque bloc, il y a jusqu'à 5 lignes de jour : "Lun", "Mar", "Mer", "Jeu", "Ven".
- Une CELLULE non vide à l'intersection (ligne = un jour de la semaine ; colonne = une semaine) signifie UNE JOURNÉE de présence sur la mission de ce bloc. Son contenu (codes comme "1,2", "J1", "13"...) décrit l'activité mais ne change pas le fait que c'est 1 jour.
Pour CHAQUE cellule non vide d'une ligne Lun/Mar/Mer/Jeu/Ven, produis une entrée :
- date = (date du lundi de la colonne) + décalage du jour (Lun=+0, Mar=+1, Mer=+2, Jeu=+3, Ven=+4), au format AAAA-MM-JJ en appliquant la règle d'année ci-dessus (les colonnes couvrent souvent deux années à la suite).
- mission_code = le code du bloc auquel appartient la ligne.
- jours = 1 (une cellule = une journée pleine, sauf indication explicite de demi-journée -> 0,5).
Ne saute AUCUN bloc, y compris ceux qui semblent repliés/masqués : traite TOUTES les lignes Lun-Ven de TOUS les blocs. Un planning de ce type contient couramment plus de 100 cellules : ne t'arrête pas trop tôt.

RÈGLES ABSOLUES :
- Date au format ISO strict AAAA-MM-JJ, année >= ${anchorYear}. Si une case n'a aucune date exploitable, ignore-la — jamais d'année du passé.
- Une croix / "X" / un code quelconque / une journée = 1 ; "½", "0,5", "AM", "PM", "matin", "après-midi" = 0,5. Ignore les cases vides, "0", congés, week-ends.
- Le code mission DOIT être exactement l'un des codes de la liste fournie. Le planning peut nommer la mission par son intitulé, son client, son lot ou son n° de lot : rattache-le au bon code. Si aucune correspondance fiable, OMETS la ligne.
- N'invente aucune charge. Extrais uniquement ce qui figure réellement dans le document.

FORMAT DE SORTIE — COMPACT ET OBLIGATOIRE (pour tenir toutes les entrées) :
Réponds UNIQUEMENT en JSON valide, sans texte ni Markdown. Chaque entrée est un TABLEAU positionnel [date, code_mission, jours] :
{"entries":[["AAAA-MM-JJ","code",1],["AAAA-MM-JJ","code",0.5]]}
N'utilise PAS d'objets à clés (pas de {"date":...}). N'ajoute ni activité ni état : ils seront déduits côté serveur. Ce format compact est impératif pour ne pas tronquer ta réponse.
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

  // Année d'ancrage : envoyée par le front (année de la semaine affichée),
  // sinon année courante. Empêche le modèle d'inventer des dates passées.
  let anchorYear = parseInt(body.anchorYear, 10);
  if (!anchorYear || anchorYear < 2000 || anchorYear > 2100) anchorYear = new Date().getFullYear();

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
    max_tokens: 8192,
    system: systemPrompt(anchorYear),
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
    // Normalise le format compact [date, code, jours] -> objet attendu par le front.
    // Tolère aussi l'ancien format objet, au cas où le modèle en renvoie.
    entries = entries.map(function (e) {
      if (Array.isArray(e)) {
        return { date: e[0], mission_code: e[1], activite: null, etat: 'planifie', jours: (e[2] === 0.5 || e[2] === '0.5') ? 0.5 : 1 };
      }
      if (e && typeof e === 'object') {
        return { date: e.date, mission_code: e.mission_code, activite: e.activite || null, etat: e.etat === 'realise' ? 'realise' : 'planifie', jours: (e.jours === 0.5 || e.jours === '0.5') ? 0.5 : 1 };
      }
      return null;
    }).filter(Boolean);
    // Garde-fou serveur : on écarte toute date antérieure à l'année d'ancrage
    // (le modèle ne doit jamais produire une année passée devinée).
    entries = entries.filter(function (e) {
      const d = String(e && e.date || '');
      return /^\d{4}-\d{2}-\d{2}$/.test(d) && parseInt(d.slice(0, 4), 10) >= anchorYear;
    });
    return { statusCode: 200, headers, body: JSON.stringify({ entries, parse_ok: true }) };
  } catch (e) {
    clearTimeout(tid);
    const msg = e.name === 'AbortError' ? 'Délai dépassé — réessaie avec un fichier plus court.' : 'Erreur réseau : ' + e.message;
    return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
  }
};
