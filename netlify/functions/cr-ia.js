// netlify/functions/cr-ia.js
// IA des comptes-rendus de réunion. Deux modes :
//   - prep     : à partir du contexte/ODJ/objectif + des actions en cours, met en avant
//                les actions de l'interlocuteur (à mener / menées) puis celles de l'équipe,
//                et suggère des questions / actions à proposer. -> { preparation: markdown }
//   - synthese : à partir de la transcription des échanges, produit un CR prêt à copier
//                et la liste des actions décidées. -> { compte_rendu, actions_decidees:[...] }
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

function closeTruncatedJSON(t) {
  let inStr = false, esc = false, cut = -1;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === ',' || c === '}' || c === ']') cut = i; }
  if (cut < 0) throw new Error('JSON irrécupérable');
  let out = t.slice(0, t[cut] === ',' ? cut : cut + 1); const st = []; inStr = false; esc = false;
  for (let i = 0; i < out.length; i++) { const c = out[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') st.push('}'); else if (c === '[') st.push(']'); else if (c === '}' || c === ']') st.pop(); }
  while (st.length) out += st.pop(); return out;
}
function parseJSON(text) {
  let t = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = t.indexOf('{'); if (s < 0) throw new Error('JSON introuvable'); t = t.slice(s);
  const e = t.lastIndexOf('}'); if (e > 0) { try { return JSON.parse(t.slice(0, e + 1)); } catch (_) {} }
  return JSON.parse(closeTruncatedJSON(t));
}

function baseCabinet() {
  return `Kaizen Way — cabinet de transformation industrielle (méthodologie Go Gemba®). Tu assistes la préparation et le compte-rendu de réunions. Français, dense, concret, orienté résultat opérationnel.`;
}

function prepPrompt(interlocuteur) {
  return baseCabinet() + `

TÂCHE — PRÉPARATION de la réunion. On te fournit le contexte / ordre du jour / objectif, et la liste des actions en cours (avec pilote, statut, échéance, n°).
Interlocuteur principal : ${interlocuteur || '(non précisé)'}.

Produis une note de préparation claire, en Markdown, avec dans cet ORDRE :
1. **Actions de l'interlocuteur** (${interlocuteur || 'la personne concernée'}) : celles qu'il/elle devait mener (à faire / en cours / en retard) et celles réalisées récemment — cite le n° et l'échéance. Mets en tête les points chauds (en retard, priorité haute).
2. **Actions de l'équipe** pertinentes pour cette réunion (les autres pilotes) : synthétique.
3. **Questions à poser** : 3 à 6 questions précises pour faire avancer l'objectif.
4. **Actions à proposer** : 2 à 5 pistes d'actions concrètes à décider en réunion.

Appuie-toi UNIQUEMENT sur les actions fournies (n'invente pas d'action). Sois bref et opérationnel. Réponds directement en Markdown (pas de JSON).`;
}

function synthPrompt(interlocuteur, thematiques, pilotes, today) {
  const themes = thematiques.map(t => '- ' + t.code + ' : ' + t.libelle).join('\n');
  const nomsPilotes = pilotes.map(p => p.nom).join(', ');
  return baseCabinet() + `

TÂCHE — SYNTHÈSE de la réunion à partir de la transcription (dictée) des échanges.
Date du jour : ${today}. Interlocuteur principal : ${interlocuteur || '(non précisé)'}.

Produis :
1. "compte_rendu" : un compte-rendu Markdown prêt à envoyer — sections : Objet / participants, Points discutés, Décisions, Prochaines étapes. Fidèle à la transcription, sans inventer. N'énumère PAS les numéros d'action (l'application les ajoutera).
2. "actions_decidees" : la liste des actions DÉCIDÉES pendant la réunion. Pour chacune :
   - "libelle" : action claire, verbe à l'infinitif.
   - "pilote_nom" : le NOM EXACT d'un pilote parmi [${nomsPilotes}] si désigné/déductible, sinon null.
   - "thematique" : un code parmi la liste ci-dessous, sinon "autre".
   - "echeance" : "YYYY-MM-DD" si une date/délai est dit (calculée depuis la date du jour), sinon null.
   - "priorite" : 1 (haute), 2 (normale), 3 (basse).

THÉMATIQUES : 
${themes}

FORMAT : réponds UNIQUEMENT en JSON valide, sans texte ni Markdown autour, sans virgule finale :
{"compte_rendu":"...markdown...","actions_decidees":[{"libelle":"...","pilote_nom":null,"thematique":"autre","echeance":null,"priorite":2}]}`;
}

async function callAnthropic(key, payload) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 28000);
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
      const m = (data && data.error) ? (typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : String(data.error)) : raw.slice(0, 200);
      return { ok: false, status: res.status, msg: m };
    }
    const txt = ((data && data.content) || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return { ok: true, txt };
  } catch (e) { clearTimeout(tid); return { ok: false, status: 502, msg: e.name === 'AbortError' ? 'Délai dépassé — réessaie.' : ('Erreur réseau : ' + e.message) }; }
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
  const model = process.env.CR_IA_MODEL || 'claude-haiku-4-5-20251001';
  const today = (body && /^\d{4}-\d{2}-\d{2}$/.test(body.today)) ? body.today : new Date().toISOString().slice(0, 10);
  const interlocuteur = (typeof body.interlocuteur === 'string') ? body.interlocuteur : '';

  if (mode === 'prep') {
    const contexte = (typeof body.contexte === 'string') ? body.contexte.trim() : '';
    if (!contexte) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Contexte / ordre du jour manquant' }) };
    const actions = Array.isArray(body.actions) ? body.actions : [];
    const userMsg = 'Contexte / ordre du jour / objectif :\n' + contexte
      + '\n\nActions en cours (JSON) :\n' + JSON.stringify(actions, null, 2);
    const r = await callAnthropic(key, { model, max_tokens: 1800, system: prepPrompt(interlocuteur), messages: [{ role: 'user', content: userMsg }] });
    if (!r.ok) return { statusCode: r.status, headers, body: JSON.stringify({ error: r.msg }) };
    if (!r.txt) return { statusCode: 502, headers, body: JSON.stringify({ error: 'Réponse vide du modèle' }) };
    return { statusCode: 200, headers, body: JSON.stringify({ preparation: r.txt }) };
  }

  if (mode === 'synthese') {
    const transcription = (typeof body.transcription === 'string') ? body.transcription.trim() : '';
    if (!transcription) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Transcription vide' }) };
    const pilotes = Array.isArray(body.pilotes) ? body.pilotes : [];
    const thematiques = Array.isArray(body.thematiques) ? body.thematiques : [];
    const contexte = (typeof body.contexte === 'string') ? body.contexte : '';
    const userMsg = (contexte ? ('Contexte de la réunion :\n' + contexte + '\n\n') : '')
      + 'Transcription des échanges :\n' + transcription;
    const r = await callAnthropic(key, { model, max_tokens: 3500, system: synthPrompt(interlocuteur, thematiques, pilotes, today), messages: [{ role: 'user', content: userMsg }] });
    if (!r.ok) return { statusCode: r.status, headers, body: JSON.stringify({ error: r.msg }) };
    if (!r.txt) return { statusCode: 502, headers, body: JSON.stringify({ error: 'Réponse vide du modèle' }) };
    let out; try { out = parseJSON(r.txt); } catch (e) { return { statusCode: 502, headers, body: JSON.stringify({ error: 'Synthèse illisible — ' + (e.message || 'JSON invalide') }) }; }
    const codes = thematiques.map(t => t.code);
    const noms = pilotes.map(p => p.nom);
    const cr = (typeof out.compte_rendu === 'string') ? out.compte_rendu : '';
    const list = Array.isArray(out.actions_decidees) ? out.actions_decidees : [];
    const clean = list.map(a => {
      let prio = parseInt(a.priorite, 10); if (!(prio === 1 || prio === 2 || prio === 3)) prio = 2;
      let ech = (typeof a.echeance === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.echeance)) ? a.echeance : null;
      return {
        libelle: (typeof a.libelle === 'string' && a.libelle.trim()) ? a.libelle.trim() : '',
        pilote_nom: noms.includes(a.pilote_nom) ? a.pilote_nom : null,
        thematique: codes.includes(a.thematique) ? a.thematique : 'autre',
        echeance: ech, priorite: prio,
      };
    }).filter(a => a.libelle);
    return { statusCode: 200, headers, body: JSON.stringify({ compte_rendu: cr, actions_decidees: clean }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Mode inconnu (prep | synthese)' }) };
};
