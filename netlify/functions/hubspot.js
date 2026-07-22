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

// Récupère tous les deals du pipeline (paginé, borné).
// stageDateIds : ids d'étape dont on veut la DATE D'ENTREE (hs_date_entered_<id>) pour la cohorte.
// On demande aussi les appels associés (associations=calls) pour tracer les pitchs.
async function getDeals(headers, pipelineId, stageDateIds) {
  const all = [];
  let after = null;
  let pages = 0;
  const deadline = Date.now() + 18000;
  const props = ['dealstage', 'pipeline', 'createdate', 'amount', 'dealname'];
  (stageDateIds || []).forEach(id => { if (id) props.push('hs_date_entered_' + id); });
  do {
    const url = new URL('https://api.hubapi.com/crm/v3/objects/deals');
    url.searchParams.set('limit', '100');
    url.searchParams.set('properties', props.join(','));
    url.searchParams.set('associations', 'calls');
    url.searchParams.set('propertiesWithHistory', 'dealstage');
    if (after) url.searchParams.set('after', after);
    let res;
    try { res = await fetchWithTimeout(url.toString(), { headers }, 9000); }
    catch (e) { break; }
    if (!res.ok) throw new Error(`HubSpot deals ${res.status}`);
    const data = await res.json();
    (data.results || []).forEach(d => {
      if (!pipelineId || (d.properties && d.properties.pipeline === pipelineId)) {
        const p = d.properties || {};
        const entered = {};
        (stageDateIds || []).forEach(id => { if (id) entered[id] = p['hs_date_entered_' + id] || null; });
        const callIds = (d.associations && d.associations.calls && d.associations.calls.results)
          ? d.associations.calls.results.map(r => String(r.id)) : [];
        const hist = (d.propertiesWithHistory && d.propertiesWithHistory.dealstage) || [];
        const everStages = Array.from(new Set(
          hist.map(h => h.value).concat(p.dealstage ? [p.dealstage] : []).filter(Boolean)
        ));
        all.push({
          stage: p.dealstage,
          createdate: p.createdate,
          amount: Number(p.amount || 0),
          entered: entered,
          callIds: callIds,
          everStages: everStages,
        });
      }
    });
    after = data.paging && data.paging.next ? data.paging.next.after : null;
    pages += 1;
  } while (after && pages < 20 && Date.now() < deadline);
  return all;
}

// Ensemble des ids d'appels >= 90 s (pitchs), via l'API de recherche des calls.
// Best-effort : en cas d'echec, renvoie un set vide (l'entonnoir cohorte reste valide,
// seule la tracabilite du pitch est indisponible).
async function getPitchCallIds(headers) {
  const ids = new Set();
  let after = null, pages = 0;
  const deadline = Date.now() + 12000;
  do {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'hs_call_duration', operator: 'GTE', value: '90000' }] }],
      properties: ['hs_call_duration'],
      limit: 100,
    };
    if (after) body.after = after;
    let res;
    try {
      res = await fetchWithTimeout('https://api.hubapi.com/crm/v3/objects/calls/search',
        { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 9000);
    } catch (e) { break; }
    if (!res.ok) break;
    const data = await res.json();
    (data.results || []).forEach(c => ids.add(String(c.id)));
    after = data.paging && data.paging.next ? data.paging.next.after : null;
    pages += 1;
  } while (after && pages < 30 && Date.now() < deadline);
  return ids;
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

  const guard = await requireCommerceOrDirection(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers: cors, body: JSON.stringify({ error: guard.msg }) };

  if (!token) return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Token HubSpot absent côté serveur' }) };

  try {
    const { pipelineId, stages } = await getStages(headers);

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

    // deals avec dates d'entree de stade (cohorte) + appels associes (pitchs)
    const deals = await getDeals(headers, pipelineId, [idR1, idR2, idProp]);
    const pitchSet = await getPitchCallIds(headers);

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

    // R1 PRIS SUR UNE PERIODE (?period=7d|30d|ytd ou ?days=N) : un deal entre dans le
    // pipeline prospects (createdate) = un R1 pris, quel que soit son stage actuel.
    const qp = event.queryStringParameters || {};
    let periodStart = null;
    if (qp.period === 'ytd') periodStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    else if (qp.period === '30d') periodStart = now - 30 * 24 * 3600 * 1000;
    else if (qp.period === '7d') periodStart = now - 7 * 24 * 3600 * 1000;
    else if (qp.days) { const dd = parseInt(qp.days, 10); if (dd >= 1 && dd <= 400) periodStart = now - dd * 24 * 3600 * 1000; }
    let r1Periode = null;
    if (periodStart != null) {
      r1Periode = deals.filter(d => d.createdate && new Date(d.createdate).getTime() >= periodStart).length;
    }
    // R1 par mois (annee civile courante), sur createdate
    const anneeN = new Date().getFullYear();
    const r1ParMois = {};
    deals.forEach(d => {
      if (!d.createdate) return;
      const dt = new Date(d.createdate);
      if (isNaN(dt.getTime()) || dt.getFullYear() !== anneeN) return;
      const ym = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2);
      r1ParMois[ym] = (r1ParMois[ym] || 0) + 1;
    });

    // ENTONNOIR DE COHORTE (non fausse) : on suit les deals ENTRES EN R1 sur la periode
    // (hs_date_entered_R1), et on regarde combien sont ENSUITE entres en R2 puis en Offre
    // (dates d'entree de stade), quel que soit leur stade actuel. Le taux pitch->R1 mesure
    // la part des R1 tracables a un appel >= 90 s loggé sur le deal.
    // NB cohorte : ancrée sur createdate (= R1 pris chez KW). hs_date_entered_<R1>
    // n'est PAS enregistré dans ce CRM => createdate, signal fiable, cohérent avec
    // r1_periode/r1_par_mois. Progression R2/Offre via HISTORIQUE DE STADE
    // (propertiesWithHistory=dealstage) : "a déjà atteint le stade", robuste aux deals
    // aujourd'hui perdus/parkés — les dates d'entrée de stade étant mortes sur cette instance.
    let entonnoir = null;
    {
      const inPeriode = (ts) => {
        if (!ts) return false;
        const t = new Date(ts).getTime();
        if (isNaN(t)) return false;
        return periodStart == null ? true : t >= periodStart;
      };
      const cohorte = deals.filter(d => inPeriode(d.createdate));
      const cR1 = cohorte.length;
      const cR1Pitch = cohorte.filter(d => d.callIds.some(id => pitchSet.has(id))).length;
      // R2 / Offre : "a déjà atteint" via historique de stade
      const cR2 = idR2 ? cohorte.filter(d => d.everStages.includes(idR2)).length : null;
      const cOffre = idProp ? cohorte.filter(d => d.everStages.includes(idProp)).length : null;
      // Diagnostic (retirable une fois validé) :
      const ancienR1ViaEntree = idR1 ? deals.filter(d => inPeriode(d.entered[idR1])).length : null;
      const r2ViaDate = idR2 ? cohorte.filter(d => d.entered[idR2]).length : null;
      const offreViaDate = idProp ? cohorte.filter(d => d.entered[idProp]).length : null;
      const multiStade = cohorte.filter(d => (d.everStages || []).length > 1).length;
      entonnoir = {
        periode: qp.period || (qp.days ? (qp.days + 'd') : 'tout'),
        r1: cR1,
        r1_avec_pitch: cR1Pitch,
        r2: cR2,
        offre: cOffre,
        taux_pitch_r1: cR1 ? Math.round(cR1Pitch / cR1 * 100) : null,       // % des R1 tracés à un pitch loggé
        taux_r1_r2: cR1 ? Math.round((cR2 || 0) / cR1 * 100) : null,        // cohorte (rigoureux)
        taux_r2_offre: cR2 ? Math.round((cOffre || 0) / cR2 * 100) : null,  // cohorte (rigoureux)
        pitch_traceable: pitchSet.size > 0,                                 // false si l'API calls a échoué
        ancre: 'createdate',
        methode_progression: 'historique_stade',
        cible_r1_r2: 33,
        cible_r2_offre: 50,
        _diag: {
          r1_ancien_via_entree_stade: ancienR1ViaEntree,  // attendu ~0
          r2_via_date_entree: r2ViaDate,                  // ancienne méthode (attendu 0)
          offre_via_date_entree: offreViaDate,            // ancienne méthode (attendu 0)
          cohorte_multi_stade: multiStade,                // deals cohorte avec >1 stade en historique => historique exploitable
          cohorte_taille: cR1,
        },
      };
    }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stock,                        // { "R1": 11, "Évaluation des besoins": 11, ... }
        flux_r1_7j: fluxR1,           // R1 des 7 derniers jours
        cible_r1_hebdo: 8,
        r1_periode: r1Periode,        // R1 pris sur la periode demandee (createdate), null si non demandee
        r1_par_mois: r1ParMois,       // { "2026-01": 3, ... } annee civile courante
        entonnoir: entonnoir,         // cohorte R1->R2->Offre (dates d'entree) + tracabilite pitch
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
