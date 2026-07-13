// netlify/functions/parcours-token.js
// Valide le jeton d'un lien candidat (/parcours/?c=<token>) CÔTÉ SERVEUR.
// Utilise la clé service Supabase (SECRÈTE) — jamais exposée au navigateur.
// Env requis : SUPABASE_SERVICE_ROLE_KEY  (et éventuellement SUPABASE_URL)

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://omftqlvkmjlxoinruayr.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ordre + activation par défaut (si le candidat n'a pas de config explicite).
// NB : nouvel ordre demandé -> QPM, Brasserie, Lean, Dojo.
const EPREUVES_VALIDES = ['dojo', 'brasserie', 'qpm', 'lean'];
const DEFAUT_CONFIG = [
  { epreuve: 'qpm',       ordre: 1, active: true },
  { epreuve: 'brasserie', ordre: 2, active: true },
  { epreuve: 'lean',      ordre: 3, active: true },
  { epreuve: 'dojo',      ordre: 4, active: true }
];

function json(statusCode, obj){
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  try {
    if(!SERVICE_KEY){ return json(500, { valid:false, reason:'config' }); }

    // jeton depuis ?c=... (GET) ou {token:...} (POST)
    let token = (event.queryStringParameters && event.queryStringParameters.c) || '';
    if(!token && event.body){ try { token = (JSON.parse(event.body).token) || ''; } catch(e){} }
    token = String(token || '').trim();
    if(!UUID_RE.test(token)){ return json(400, { valid:false, reason:'lien invalide' }); }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false } });

    const { data: cand, error } = await sb
      .from('parcours_candidats')
      .select('id, nom, poste, qpm_lien, statut, expires_at, epreuves_config')
      .eq('token', token)
      .maybeSingle();

    if(error) return json(500, { valid:false, reason:'erreur' });
    if(!cand) return json(404, { valid:false, reason:'introuvable' });
    if(cand.statut === 'archive') return json(403, { valid:false, reason:'archivé' });

    if(cand.expires_at && new Date(cand.expires_at) < new Date()){
      if(cand.statut !== 'expire'){ await sb.from('parcours_candidats').update({ statut:'expire' }).eq('id', cand.id); }
      return json(403, { valid:false, reason:'expiré' });
    }

    // Première ouverture d'un lien encore "invité" -> passe "en cours"
    if(cand.statut === 'invite'){
      await sb.from('parcours_candidats').update({ statut:'en_cours' }).eq('id', cand.id);
    }

    // Statut des épreuves déjà passées
    const { data: res } = await sb
      .from('parcours_resultats')
      .select('epreuve, statut, score')
      .eq('candidat_id', cand.id);
    const epreuves = { dojo:null, brasserie:null, qpm:null, lean:null };
    (res || []).forEach(function(r){ epreuves[r.epreuve] = { statut:r.statut, score:r.score }; });

    // Config du parcours : ordre + activation (fallback = 4 actives, nouvel ordre)
    let cfg = Array.isArray(cand.epreuves_config) ? cand.epreuves_config : DEFAUT_CONFIG;
    const parcours = cfg
      .filter(function(x){ return x && x.active !== false && EPREUVES_VALIDES.indexOf(x.epreuve) >= 0; })
      .sort(function(a,b){ return (a.ordre || 0) - (b.ordre || 0); })
      .map(function(x){
        return {
          epreuve: x.epreuve,
          ordre:   x.ordre,
          statut:  (epreuves[x.epreuve] && epreuves[x.epreuve].statut) || 'a_faire'
        };
      });

    // On n'expose QUE le strict nécessaire (pas d'email, d'id, de created_by…)
    // "epreuves" conservé pour compat ; "parcours" = liste ordonnée des actives (Brique 2).
    return json(200, {
      valid: true,
      candidat: { nom: cand.nom, poste: cand.poste, qpm_lien: cand.qpm_lien },
      epreuves: epreuves,
      parcours: parcours,
    });
  } catch(e){
    return json(500, { valid:false, reason:'erreur' });
  }
};
