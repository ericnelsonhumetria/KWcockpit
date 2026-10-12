// netlify/functions/cr-ia-background.js
// Fonction d'ARRIÈRE-PLAN pour les comptes rendus : synthèse (transcription → compte rendu + actions) et préparation.
// Le suffixe « -background » suffit à Netlify pour l'exécuter en arrière-plan (jusqu'à 15 min) : la page reçoit immédiatement
// un 202, puis lit le résultat dans la table Supabase cr_ia_jobs. Aucune limite de 10 à 30 s, donc plus de « 502 » sur une
// réunion longue (par exemple un Codir d'une heure).
//
// Même IA, mêmes consignes, mêmes règles de nettoyage que cr-ia.js (les consignes sont importées de ce fichier) :
// le résultat a EXACTEMENT la même forme que la réponse de cr-ia.js.
//   synthese : { compte_rendu, actions_decidees:[{libelle, pilote_nom, thematique, echeance, priorite}], langue }
//   prep     : { preparation, langue }
//
// Flux : page → insère cr_ia_jobs {request, status:'pending'} → POST {job_id} ici (Bearer JWT)
//        ici  → vérifie la session, que le travail appartient à l'appelant, qu'il est utilisateur interne → 'running'
//             → appel Anthropic → 'done' + résultat, ou 'error' + message lisible par la page.
// Variables d'environnement : les mêmes que cr-ia.js (SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, CR_IA_MODEL).
// La clé de service est aussi lue sous le nom SUPABASE_SERVICE_ROLE_KEY (les deux noms existent dans le projet).

const H = require('./cr-ia.js').helpers;

const MODEL_DEFAULT = 'claude-haiku-4-5-20251001';
const ANTHROPIC_TIMEOUT_MS = 10 * 60 * 1000;     // marge sous la limite de 15 min
const RETENTION_DAYS = 7;
const MAX_TOKENS_PREP = 1800;
const MAX_TOKENS_SYNTHESE = 6000;                // 3500 dans cr-ia.js (limité par le délai) : une réunion longue donne un CR plus long

async function callAnthropic(doFetch, key, payload) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const res = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload), signal: ctrl.signal,
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
  } catch (e) {
    clearTimeout(tid);
    return { ok: false, status: 502, msg: e && e.name === 'AbortError' ? 'délai IA dépassé (10 min)' : ('appel IA impossible : ' + ((e && e.message) || 'réseau')) };
  }
}

// Construit la réponse : { ok:true, result } ou { ok:false, error }
async function generate(req, key, model, doFetch) {
  const mode = req.mode;
  const today = (req && /^\d{4}-\d{2}-\d{2}$/.test(req.today)) ? req.today : new Date().toISOString().slice(0, 10);
  const interlocuteur = (typeof req.interlocuteur === 'string') ? req.interlocuteur : '';
  const langue = (req.langue === 'en' || req.langue === 'fr') ? req.langue : (H.detectLang(String(req.transcription || '') + ' ' + String(req.contexte || '')) || 'fr');

  if (mode === 'prep') {
    const contexte = (typeof req.contexte === 'string') ? req.contexte.trim() : '';
    if (!contexte) return { ok: false, error: 'Contexte / ordre du jour manquant' };
    const actions = Array.isArray(req.actions) ? req.actions : [];
    const userMsg = 'Contexte / ordre du jour / objectif :\n' + contexte + '\n\nActions en cours (JSON) :\n' + JSON.stringify(actions, null, 2);
    const r = await callAnthropic(doFetch, key, { model, max_tokens: MAX_TOKENS_PREP, system: H.prepPrompt(interlocuteur) + H.langDirective(langue), messages: [{ role: 'user', content: userMsg }] });
    if (!r.ok) return { ok: false, error: 'API ' + r.status + ' : ' + r.msg };
    if (!r.txt) return { ok: false, error: 'Réponse vide du modèle' };
    return { ok: true, result: { preparation: r.txt, langue } };
  }

  if (mode === 'synthese') {
    const transcription = (typeof req.transcription === 'string') ? req.transcription.trim() : '';
    if (!transcription) return { ok: false, error: 'Transcription vide' };
    const pilotes = Array.isArray(req.pilotes) ? req.pilotes : [];
    const thematiques = Array.isArray(req.thematiques) ? req.thematiques : [];
    const contexte = (typeof req.contexte === 'string') ? req.contexte : '';
    const userMsg = (contexte ? ('Contexte de la réunion :\n' + contexte + '\n\n') : '') + 'Transcription des échanges :\n' + transcription;
    const r = await callAnthropic(doFetch, key, { model, max_tokens: MAX_TOKENS_SYNTHESE, system: H.synthPrompt(interlocuteur, thematiques, pilotes, today) + H.langDirective(langue), messages: [{ role: 'user', content: userMsg }] });
    if (!r.ok) return { ok: false, error: 'API ' + r.status + ' : ' + r.msg };
    if (!r.txt) return { ok: false, error: 'Réponse vide du modèle' };
    let out; try { out = H.parseJSON(r.txt); } catch (e) { return { ok: false, error: 'Synthèse illisible — ' + ((e && e.message) || 'JSON invalide') }; }
    const codes = thematiques.map(t => t.code);
    const noms = pilotes.map(p => p.nom);
    const cr = (typeof out.compte_rendu === 'string') ? out.compte_rendu : '';
    const list = Array.isArray(out.actions_decidees) ? out.actions_decidees : [];
    const clean = list.map(a => {
      let prio = parseInt(a.priorite, 10); if (!(prio === 1 || prio === 2 || prio === 3)) prio = 2;
      const ech = (typeof a.echeance === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.echeance)) ? a.echeance : null;
      return {
        libelle: (typeof a.libelle === 'string' && a.libelle.trim()) ? a.libelle.trim() : '',
        pilote_nom: noms.includes(a.pilote_nom) ? a.pilote_nom : null,
        thematique: codes.includes(a.thematique) ? a.thematique : 'autre',
        echeance: ech, priorite: prio,
      };
    }).filter(a => a.libelle);
    return { ok: true, result: { compte_rendu: cr, actions_decidees: clean, langue } };
  }

  return { ok: false, error: 'Mode inconnu (prep | synthese)' };
}

exports.generate = generate;   // exposé pour les tests

exports.handler = async (event, context, deps) => {
  deps = deps || {};
  const createClient = deps.createClient || require('@supabase/supabase-js').createClient;
  const doFetch = deps.fetch || fetch;
  const url = process.env.SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!event || event.httpMethod !== 'POST' || !url || !svc) return { statusCode: 400 };
  const sb = createClient(url, svc, { auth: { persistSession: false } });

  // 1) Auth : jeton de session Supabase du Cockpit
  const authH = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = String(authH).replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401 };
  let user = null;
  try { const u = await sb.auth.getUser(token); user = u && u.data && u.data.user; } catch (e) {}
  if (!user) return { statusCode: 401 };

  // 2) Travail : doit exister, appartenir à l'appelant et être en attente (évite tout double traitement)
  let jobId = null;
  try { jobId = JSON.parse(event.body || '{}').job_id; } catch (e) {}
  if (!jobId) return { statusCode: 400 };
  const claim = await sb.from('cr_ia_jobs')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', jobId).eq('user_id', user.id).eq('status', 'pending')
    .select('id, request').maybeSingle();
  if (!claim || claim.error || !claim.data) return { statusCode: 404 };

  async function finish(fields) {
    fields.updated_at = new Date().toISOString();
    try { await sb.from('cr_ia_jobs').update(fields).eq('id', jobId); } catch (e) {}
  }

  try {
    // 3) Utilisateur interne (même règle que cr-ia.js : présent dans user_access)
    const email = String(user.email || '').toLowerCase();
    const acc = await sb.from('user_access').select('role').eq('email', email).maybeSingle();
    if (!acc || !acc.data) { await finish({ status: 'error', error: 'Accès réservé aux utilisateurs internes' }); return { statusCode: 403 }; }
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) { await finish({ status: 'error', error: 'ANTHROPIC_API_KEY manquante côté serveur' }); return { statusCode: 500 }; }

    // 4) Génération
    const model = process.env.CR_IA_MODEL || MODEL_DEFAULT;
    const g = await generate(claim.data.request || {}, key, model, doFetch);
    if (g.ok) await finish({ status: 'done', result: g.result });
    else await finish({ status: 'error', error: g.error });
  } catch (e) {
    await finish({ status: 'error', error: 'erreur interne : ' + ((e && e.message) || 'inconnue') });
  }

  // 5) Ménage : travaux de plus de 7 jours de cet utilisateur
  try {
    await sb.from('cr_ia_jobs').delete().eq('user_id', user.id).lt('created_at', new Date(Date.now() - RETENTION_DAYS * 864e5).toISOString());
  } catch (e) {}
  return { statusCode: 202 };
};
