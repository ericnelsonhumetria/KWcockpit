// netlify/functions/parcours-resultat.js
// Enregistre le résultat d'une épreuve pour un candidat, APRÈS validation du jeton.
// Le candidat_id est déduit du jeton côté serveur : le client ne peut pas écrire ailleurs.
// Corps attendu : { token, epreuve, statut?, score?, detail? }
//   epreuve ∈ dojo|brasserie|qpm|lean   statut ∈ a_faire|en_cours|termine (défaut termine)
// Env : SUPABASE_SERVICE_ROLE_KEY (et éventuellement SUPABASE_URL).

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://omftqlvkmjlxoinruayr.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EPREUVES = ['dojo', 'brasserie', 'qpm', 'lean'];   // valeurs acceptées en écriture
const STATUTS  = ['a_faire', 'en_cours', 'termine'];

function json(code, obj){
  return {
    statusCode: code,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST')   return json(405, { ok:false, error:'Method Not Allowed' });
  if (!SERVICE_KEY) return json(500, { ok:false, error:'config' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch(e) { return json(400, { ok:false, error:'Corps invalide' }); }

  const token = String(body.token || '').trim();
  if (!UUID_RE.test(token)) return json(400, { ok:false, error:'lien invalide' });

  const epreuve = String(body.epreuve || '').trim();
  if (EPREUVES.indexOf(epreuve) < 0) return json(400, { ok:false, error:'épreuve inconnue' });

  let statut = String(body.statut || 'termine').trim();
  if (STATUTS.indexOf(statut) < 0) statut = 'termine';

  let score = (body.score == null) ? null : Number(body.score);
  if (score != null && isNaN(score)) score = null;

  const detail = (body.detail && typeof body.detail === 'object') ? body.detail : null;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false } });

  // valider le jeton -> candidat (+ config des épreuves)
  const { data: cand, error: e1 } = await sb
    .from('parcours_candidats').select('id, statut, expires_at, epreuves_config').eq('token', token).maybeSingle();
  if (e1) return json(500, { ok:false, error:'erreur' });
  if (!cand) return json(404, { ok:false, error:'introuvable' });
  if (cand.statut === 'archive') return json(403, { ok:false, error:'archivé' });
  if (cand.expires_at && new Date(cand.expires_at) < new Date()) return json(403, { ok:false, error:'expiré' });

  const now = new Date().toISOString();

  // préserver started_at si la ligne existe déjà
  const { data: prev } = await sb
    .from('parcours_resultats').select('id, started_at')
    .eq('candidat_id', cand.id).eq('epreuve', epreuve).maybeSingle();

  const row = {
    candidat_id: cand.id,
    epreuve: epreuve,
    statut: statut,
    score: score,
    detail: detail,
    started_at: (prev && prev.started_at) ? prev.started_at : now,
    updated_at: now
  };
  if (statut === 'termine') row.completed_at = now;

  const { error: e2 } = await sb
    .from('parcours_resultats')
    .upsert(row, { onConflict: 'candidat_id,epreuve' });
  if (e2) return json(500, { ok:false, error:'écriture impossible' });

  // Candidat "terminé" quand toutes les épreuves ACTIVES sont finies (best effort).
  // Fallback (config absente) = les 4 épreuves, comme avant.
  try {
    let actives = Array.isArray(cand.epreuves_config)
      ? cand.epreuves_config
          .filter(function(x){ return x && x.active !== false && EPREUVES.indexOf(x.epreuve) >= 0; })
          .map(function(x){ return x.epreuve; })
      : EPREUVES.slice();
    if (!actives.length) actives = EPREUVES.slice();

    const { data: all } = await sb
      .from('parcours_resultats').select('epreuve, statut').eq('candidat_id', cand.id);
    const done = (all || []).filter(function(r){ return r.statut === 'termine'; }).map(function(r){ return r.epreuve; });
    const toutFini = actives.every(function(e){ return done.indexOf(e) >= 0; });
    if (toutFini && cand.statut !== 'termine' && cand.statut !== 'archive') {
      await sb.from('parcours_candidats').update({ statut:'termine' }).eq('id', cand.id);
    }
  } catch(e) { /* best effort */ }

  return json(200, { ok:true });
};
