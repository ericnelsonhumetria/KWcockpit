// netlify/functions/hubspot.js
// Récupère les KPI commerciaux depuis HubSpot (pipeline de deals), côté SERVEUR.
// Le token reste côté serveur. Accès réservé à la direction ET au commerce (Paul).
//
// Mesure, sur la base de la correspondance validée avec Eric :
//   R1                      -> étape "R1"
//   R2 (qualification)      -> étape "Évaluation des besoins"
//   Proposition             -> étape "Présentation de solutions"
//   Gagné / Perdu           -> "Fermées gagnées" / "Fermé perdu"
//
// Renvoie : stock (deals par étape), flux (R1 des 7 derniers jours),
// et taux de transformation vs cibles (R1->R2 33%, R2->proposition 50%).

const { createClient } = require('@supabase/supabase-js');

// Autorise la direction ET le rôle commerce (Paul) à voir les KPI commerciaux
async function requireCommerceOrDirection(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, code: 401, msg: 'Token invalide' };
  const email = (userData.user.email || '').toLowerCase();
  const { data: access } = await supabase
    .from('user_access').select('is_admin, role').eq('email', email).maybeSingle();
  const role = access && access.role;
  const autorise = access && (access.is_admin === true || role === 'direction' || role === 'eric' || role === 'paul');
  if (!autorise) return { ok: false, code: 403, msg: 'Accès réservé à la direction et au commerce' };
  return { ok: true, email };
}

async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// Normalise un libellé d'étape pour comparaison souple (sans accents/casse)
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// Récupère la carte { stageId -> label } du pipeline de prospects
async function getStages(headers) {
  const res = await fetchWithTimeout('https://api.hubapi.com/crm/v3/pipelines/deals', { headers }, 9000);
  if (!res.ok) throw new Error(`HubSpot pipelines ${res.status}`);
  const data = await res.json();
  const pipelines = data.results || [];
  // On cherche le pipeline "Pipeline de prospects" ; sinon on prend le premier
  let pipeline = pipelines.find(p => norm(p.label).includes('prospect')) || pipelines[0];
  const stages = {};
  (pipeline.stages || []).forEach(s => { stages[s.id] = s.label; });
  return { pipelineId: pipeline.id, stages, allPipelines: pipelines };
}

// Récupère tous les deals du pipeline (paginé, borné)
async function getDeals(headers, pipelineId) {
  const all = [];
  let after = null;
  let pages = 0;
  const deadline = Date.now() + 18000;
  do {
    const url = new URL('https://api.hubapi.com/crm/v3/objects/deals');
    url.searchParams.set('limit', '100');
    url.searchParams.set('properties', 'dealstage,pipeline,createdate,amount,dealname');
    if (after) url.searchParams.set('after', after);
    let res;
    try { res = await fetchWithTimeout(url.toString(), { headers }, 9000); }
    catch (e) { break; }
    if (!res.ok) throw new Error(`HubSpot deals ${res.status}`);
    const data = await res.json();
    (data.results || []).forEach(d => {
      if (!pipelineId || (d.properties && d.properties.pipeline === pipelineId)) {
        all.push({
          stage: d.properties && d.properties.dealstage,
          createdate: d.properties && d.properties.createdate,
          amount: Number((d.properties && d.properties.amount) || 0),
        });
      }
    });
    after = data.paging && data.paging.next ? data.paging.next.after : null;
    pages += 1;
  } while (after && pages < 20 && Date.now() < deadline);
  return all;
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  const params = event.queryStringParameters || {};
  const token = process.env.HUBSPOT_TOKEN;
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };

  // ===== DIAGNOSTIC TEMPORAIRE (sans auth) : ?debug=kw2027 =====
  // À RETIRER après validation des correspondances d'étapes.
  if (params.debug === 'kw2027') {
    const out = {};
    try {
      out.token_present = Boolean(token);
      out.token_longueur = token ? token.length : 0;
      const { pipelineId, stages, allPipelines } = await getStages(headers);
      out.pipeline_retenu_id = pipelineId;
      out.etapes_du_pipeline = stages; // { id -> label } : c'est ce qu'on veut voir
      out.tous_les_pipelines = allPipelines.map(p => ({ id: p.id, label: p.label }));
      const deals = await getDeals(headers, pipelineId);
      out.nb_deals_pipeline = deals.length;
      // compte par étape (par id)
      const parEtape = {};
      deals.forEach(d => { parEtape[d.stage] = (parEtape[d.stage] || 0) + 1; });
      out.deals_par_etape_id = parEtape;
    } catch (e) {
      out.erreur = String(e.message || e);
    }
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(out, null, 2) };
  }
  // ===== FIN DIAGNOSTIC TEMPORAIRE =====

  const guard = await requireCommerceOrDirection(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers: cors, body: JSON.stringify({ error: guard.msg }) };

  if (!token) return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Token HubSpot absent côté serveur' }) };

  try {
    const { pipelineId, stages } = await getStages(headers);
    const deals = await getDeals(headers, pipelineId);

    // Retrouve l'id d'étape à partir d'un libellé (correspondance souple)
    function stageIdFor(labelPart) {
      const entry = Object.entries(stages).find(([id, label]) => norm(label).includes(norm(labelPart)));
      return entry ? entry[0] : null;
    }
    const idR1 = stageIdFor('R1');
    const idR2 = stageIdFor('evaluation des besoins');
    const idProp = stageIdFor('presentation de solutions');
    const idGagne = stageIdFor('gagnee');
    const idPerdu = stageIdFor('perdu');

    // STOCK : nombre de deals par étape (libellé lisible)
    const stock = {};
    Object.entries(stages).forEach(([id, label]) => {
      stock[label] = deals.filter(d => d.stage === id).length;
    });

    // FLUX : deals créés dans les 7 derniers jours ET actuellement en R1
    const now = Date.now();
    const septJours = 7 * 24 * 3600 * 1000;
    const fluxR1 = deals.filter(d =>
      d.stage === idR1 && d.createdate && (now - new Date(d.createdate).getTime()) <= septJours
    ).length;

    // Volumes pour les taux (stock actuel par étape clé)
    const nbR1 = idR1 ? deals.filter(d => d.stage === idR1).length : 0;
    const nbR2 = idR2 ? deals.filter(d => d.stage === idR2).length : 0;
    const nbProp = idProp ? deals.filter(d => d.stage === idProp).length : 0;

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stock,                        // { "R1": 11, "Évaluation des besoins": 11, ... }
        flux_r1_7j: fluxR1,           // R1 des 7 derniers jours
        cible_r1_hebdo: 8,
        volumes: { r1: nbR1, r2: nbR2, proposition: nbProp },
        // taux indicatifs sur le stock (à interpréter avec prudence, cf. note)
        taux_r1_vers_r2: nbR1 > 0 ? Math.round((nbR2 / nbR1) * 100) : null,
        taux_r2_vers_proposition: nbR2 > 0 ? Math.round((nbProp / nbR2) * 100) : null,
        cible_r1_vers_r2: 33,
        cible_r2_vers_proposition: 50,
        gagnees: idGagne ? deals.filter(d => d.stage === idGagne).length : 0,
        perdues: idPerdu ? deals.filter(d => d.stage === idPerdu).length : 0,
      }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
