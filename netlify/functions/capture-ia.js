// netlify/functions/capture-ia.js
// Formalisation d'un QUICK WIN à partir du récit de terrain (texte écrit ou dicté) : range le récit en Avant / Action / Après,
// propose le domaine et les gains à chiffrer, et pose les questions qui manquent. N'écrit RIEN en base.
// RÈGLE ABSOLUE : aucun chiffre inventé. Un nombre n'est repris que s'il figure dans le récit ; sinon null + question.
//
// POST { texte, domaines:[{code,libelle}], types:[{k,l,u}] }
//  -> { avant, action, apres, domaine|null, gains:[{type, unite, avant, apres, freq_jour, jours_an, nature, source}], questions:[] }
// Accès : tout utilisateur interne (ligne user_access). Clé Anthropic côté serveur (ANTHROPIC_API_KEY).
'use strict';
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

function systemPrompt(domaines, types) {
  return `Tu aides un consultant ou un manager de terrain (cabinet Kaizen Way, transformation industrielle) à FORMALISER un quick win : une amélioration rapide, peu coûteuse, dont le gain est visible.
À partir de son récit (écrit ou dicté, souvent oral et désordonné), tu produis une fiche factuelle :
- "avant" : la situation de départ, concrète (1 à 2 phrases).
- "action" : ce qui a été fait, par qui si c'est dit (1 à 2 phrases).
- "apres" : le résultat observé (1 à 2 phrases).
- "domaine" : UN code parmi ${JSON.stringify(domaines.map(d => d.code))} (${domaines.map(d => d.code + ' = ' + d.libelle).join(', ')}), ou null si ce n'est pas clair.
- "gains" : 0 à 3 gains, chacun d'un type parmi ${JSON.stringify(types.map(t => t.k))} (${types.map(t => t.k + ' = ' + t.l + ' en ' + t.u).join(' ; ')}).
  Pour chaque gain : "avant" et "apres" (quantité par occurrence, dans l'unité du type), "freq_jour" (occurrences par jour), "jours_an",
  "unite" (pour consommation seulement, ex. kWh, kg, L), "nature" ("mesure" si chronométré/compté/relevé, "constate" si observé sur une période, "estime" sinon), "source" (comment c'est mesuré, si dit).
- "questions" : 1 à 4 questions COURTES pour obtenir ce qui manque (ex. « Combien de minutes avant ? », « Combien de fois par jour ? », « Comment l'avez-vous mesuré ? », « Qu'est-ce qui garantit que ça tiendra ? »).

RÈGLES ABSOLUES :
- N'INVENTE AUCUN CHIFFRE. Un nombre n'est repris que s'il figure dans le récit. Sinon : null, et une question pour l'obtenir.
- Ne reformule pas en jargon : phrases simples, vocabulaire de l'atelier.
- Si le récit ne décrit pas un gain mesurable, "gains": [] et des questions.

Réponds UNIQUEMENT en JSON valide, sans texte ni Markdown :
{"avant":"","action":"","apres":"","domaine":null,"gains":[{"type":"temps","unite":"min","avant":null,"apres":null,"freq_jour":null,"jours_an":null,"nature":"estime","source":""}],"questions":[]}`;
}

function parseJSON(t) {
  t = String(t || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('JSON absent');
  return JSON.parse(t.slice(a, b + 1));
}
const numOrNull = v => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : Number(v);
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n || 600) : '');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non supportée' }) };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY manquante côté serveur' }) };
  const guard = await requireInternal(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers, body: JSON.stringify({ error: guard.msg }) };

  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps invalide' }) }; }
  const texte = str(body.texte, 6000);
  if (texte.length < 10) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Récit trop court' }) };
  const domaines = (Array.isArray(body.domaines) ? body.domaines : []).filter(d => d && d.code).slice(0, 12).map(d => ({ code: String(d.code).slice(0, 10), libelle: String(d.libelle || '').slice(0, 60) }));
  const types = (Array.isArray(body.types) ? body.types : []).filter(t => t && t.k).slice(0, 8).map(t => ({ k: String(t.k), l: String(t.l || ''), u: String(t.u || '') }));
  if (!types.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Types de gain manquants' }) };

  const controller = new AbortController(); const tid = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.CAPTURE_IA_MODEL || process.env.ACTION_IA_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 1200,
        system: systemPrompt(domaines, types), messages: [{ role: 'user', content: 'Récit de terrain :\n"""\n' + texte + '\n"""' }] }),
    });
    clearTimeout(tid);
    const raw = await res.text(); let data = null; try { data = JSON.parse(raw); } catch (e) {}
    if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify({ error: (data && data.error && (data.error.message || JSON.stringify(data.error))) || raw.slice(0, 200) }) };
    const txt = ((data && data.content) || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    let o; try { o = parseJSON(txt); } catch (e) { return { statusCode: 502, headers, body: JSON.stringify({ error: 'Réponse illisible' }) }; }
    // Normalisation stricte + garde-fou « aucun chiffre inventé » : un nombre absent du récit est remis à null
    const MOTS = { 1:'un|une', 2:'deux', 3:'trois', 4:'quatre', 5:'cinq', 6:'six', 7:'sept', 8:'huit', 9:'neuf', 10:'dix', 11:'onze', 12:'douze', 13:'treize', 14:'quatorze', 15:'quinze|quart d.heure', 16:'seize', 20:'vingt', 30:'trente|demi.heure|demi heure', 40:'quarante', 45:'quarante.cinq|trois quarts? d.heure', 50:'cinquante', 60:'soixante|une heure', 100:'cent' };
    const low = texte.toLowerCase();
    const inText = n => { if (n === null) return true; const s = String(n).replace('.', '[.,]'); if (new RegExp('(^|[^0-9])' + s + '([^0-9]|$)').test(texte)) return true; return !!(MOTS[n] && new RegExp('(^|[^a-zà-ü])(' + MOTS[n] + ')([^a-zà-ü]|$)').test(low)); };
    const codes = domaines.map(d => d.code), tk = types.map(t => t.k);
    const gains = (Array.isArray(o.gains) ? o.gains : []).filter(g => g && tk.includes(g.type)).slice(0, 3).map(g => {
      const out = { type: g.type, unite: str(g.unite, 20) || null, nature: ['mesure', 'constate', 'estime'].includes(g.nature) ? g.nature : 'estime', source: str(g.source, 160) };
      ['avant', 'apres', 'freq_jour', 'jours_an'].forEach(k => { const v = numOrNull(g[k]); out[k] = inText(v) ? v : null; });
      return out;
    });
    const questions = (Array.isArray(o.questions) ? o.questions : []).map(q => str(q, 160)).filter(Boolean).slice(0, 4);
    return { statusCode: 200, headers, body: JSON.stringify({ avant: str(o.avant), action: str(o.action), apres: str(o.apres), domaine: codes.includes(o.domaine) ? o.domaine : null, gains, questions }) };
  } catch (e) {
    clearTimeout(tid);
    return { statusCode: 504, headers, body: JSON.stringify({ error: e && e.name === 'AbortError' ? 'Délai dépassé, réessaie' : ((e && e.message) || 'erreur') }) };
  }
};
