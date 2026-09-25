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
//
// PROFILS : chaque deal porte son propriétaire (hubspot_owner_id), résolu en nom
// via /crm/v3/owners. Le même bloc d'indicateurs est calculé pour Équipe / Paul
// INGRASSIA / Aurélie LOPEZ, exposé dans `profils`. Le niveau racine = Équipe
// (rétrocompatible avec loadRespCommerce et l'ancien rendu).

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

// Normalise un libellé pour comparaison souple (sans accents/casse)
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

// Carte { ownerId -> { name (normalisé), email, display } } pour attribuer chaque deal.
async function getOwners(headers) {
  const map = {};
  let after = null, pages = 0;
  do {
    const url = new URL('https://api.hubapi.com/crm/v3/owners');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    let res;
    try { res = await fetchWithTimeout(url.toString(), { headers }, 9000); }
    catch (e) { break; }
    if (!res.ok) break;
    const data = await res.json();
    (data.results || []).forEach(o => {
      const display = ((o.firstName || '') + ' ' + (o.lastName || '')).trim();
      map[String(o.id)] = { name: norm(display), last: norm(o.lastName || ''), email: (o.email || '').toLowerCase(), display };
    });
    after = data.paging && data.paging.next ? data.paging.next.after : null;
    pages += 1;
  } while (after && pages < 10);
  return map;
}

// Attribue un deal à un profil à partir du nom du propriétaire.
// Correspondance sur le NOM DE FAMILLE (INGRASSIA / LOPEZ) — le plus fiable ;
// repli sur le prénom. Tout le reste -> 'autre' (non attribué).
function bucketFor(ownerId, owners) {
  const o = ownerId ? owners[String(ownerId)] : null;
  if (!o) return 'autre';
  const n = o.name, last = o.last;
  if (last === 'ingrassia' || last.includes('ingrassia') || n.includes('paul ingrassia')) return 'paul';
  if (last === 'lopez' || last.includes('lopez') || n.includes('aurelie lopez')) return 'aurelie';
  return 'autre';
}

// Récupère tous les deals du pipeline (paginé, borné).
async function getDeals(headers, pipelineId, stageDateIds) {
  const all = [];
  let after = null;
  let pages = 0;
  const deadline = Date.now() + 18000;
  const props = ['dealstage', 'pipeline', 'createdate', 'amount', 'dealname', 'hubspot_owner_id'];
  (stageDateIds || []).forEach(id => { if (id) props.push('hs_date_entered_' + id); });
  do {
    const url = new URL('https://api.hubapi.com/crm/v3/objects/deals');
    url.searchParams.set('limit', '100');
    url.searchParams.set('properties', props.join(','));
    url.searchParams.set('associations', 'calls');
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
        all.push({
          id: d.id,
          stage: p.dealstage,
          createdate: p.createdate,
          amount: Number(p.amount || 0),
          ownerId: p.hubspot_owner_id || null,
          entered: entered,
          callIds: callIds,
        });
      }
    });
    after = data.paging && data.paging.next ? data.paging.next.after : null;
    pages += 1;
  } while (after && pages < 20 && Date.now() < deadline);
  return all;
}

// Ensemble des ids d'appels >= 90 s (pitchs), via l'API de recherche des calls.
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
    const idObj = stageIdFor('traitement des objections');
    const idFinal = stageIdFor('finalisation des conditions');
    const idGagne = stageIdFor('gagnee');
    const idPerdu = stageIdFor('perdu');
    const depuisR2 = [idR2, idProp, idObj, idFinal, idGagne].filter(Boolean);
    const depuisOffre = [idProp, idObj, idFinal, idGagne].filter(Boolean);

    // deals + propriétaires + appels associés (pitchs)
    const owners = await getOwners(headers);
    const deals = await getDeals(headers, pipelineId, [idR1, idR2, idProp]);
    deals.forEach(d => { d.bucket = bucketFor(d.ownerId, owners); });

    // Fenêtre de période (createdate)
    const now = Date.now();
    const qp = event.queryStringParameters || {};
    let periodStart = null;
    if (qp.period === 'ytd') periodStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    else if (qp.period === '30d') periodStart = now - 30 * 24 * 3600 * 1000;
    else if (qp.period === '7d') periodStart = now - 7 * 24 * 3600 * 1000;
    else if (qp.days) { const dd = parseInt(qp.days, 10); if (dd >= 1 && dd <= 400) periodStart = now - dd * 24 * 3600 * 1000; }

    const pitchSet = await getPitchCallIds(headers);
    const septJours = 7 * 24 * 3600 * 1000;
    const anneeN = new Date().getFullYear();

    // ---- Bloc d'indicateurs calculé pour un sous-ensemble de deals (Équipe / Paul / Aurélie) ----
    // Structure IDENTIQUE à l'ancienne réponse : on conserve les indicateurs en place.
    function kpi(sub) {
      // STOCK : nombre de deals par étape (toutes les étapes du pipeline, même à 0)
      const stock = {};
      Object.entries(stages).forEach(([id, label]) => {
        stock[label] = sub.filter(d => d.stage === id).length;
      });

      const fluxR1 = sub.filter(d =>
        d.stage === idR1 && d.createdate && (now - new Date(d.createdate).getTime()) <= septJours
      ).length;

      const nbR1 = idR1 ? sub.filter(d => d.stage === idR1).length : 0;
      const nbR2 = idR2 ? sub.filter(d => d.stage === idR2).length : 0;
      const nbProp = idProp ? sub.filter(d => d.stage === idProp).length : 0;

      let r1Periode = null;
      if (periodStart != null) {
        r1Periode = sub.filter(d => d.createdate && new Date(d.createdate).getTime() >= periodStart).length;
      }

      const r1ParMois = {}, r2ParMois = {}, offreParMois = {};
      sub.forEach(d => {
        if (!d.createdate) return;
        const dt = new Date(d.createdate);
        if (isNaN(dt.getTime()) || dt.getFullYear() !== anneeN) return;
        const ym = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2);
        r1ParMois[ym] = (r1ParMois[ym] || 0) + 1;
        if (depuisR2.length && depuisR2.includes(d.stage)) r2ParMois[ym] = (r2ParMois[ym] || 0) + 1;
        if (depuisOffre.length && depuisOffre.includes(d.stage)) offreParMois[ym] = (offreParMois[ym] || 0) + 1;
      });

      let entonnoir = null;
      {
        const inPeriode = (ts) => {
          if (!ts) return false;
          const t = new Date(ts).getTime();
          if (isNaN(t)) return false;
          return periodStart == null ? true : t >= periodStart;
        };
        const cohorte = sub.filter(d => inPeriode(d.createdate));
        const cR1 = cohorte.length;
        const cR1Pitch = cohorte.filter(d => d.callIds.some(id => pitchSet.has(id))).length;
        const cR2 = depuisR2.length ? cohorte.filter(d => depuisR2.includes(d.stage)).length : null;
        const cOffre = depuisOffre.length ? cohorte.filter(d => depuisOffre.includes(d.stage)).length : null;
        const cPerdus = idPerdu ? cohorte.filter(d => d.stage === idPerdu).length : null;
        const cGagnes = idGagne ? cohorte.filter(d => d.stage === idGagne).length : null;
        entonnoir = {
          periode: qp.period || (qp.days ? (qp.days + 'd') : 'tout'),
          r1: cR1,
          r1_avec_pitch: cR1Pitch,
          r2: cR2,
          offre: cOffre,
          taux_pitch_r1: cR1 ? Math.round(cR1Pitch / cR1 * 100) : null,
          taux_r1_r2: (cR1 && cR2 != null) ? Math.round(cR2 / cR1 * 100) : null,
          taux_r2_offre: (cR2 && cOffre != null) ? Math.round(cOffre / cR2 * 100) : null,
          pitch_traceable: pitchSet.size > 0,
          ancre: 'createdate',
          methode_progression: 'stade_courant',
          borne: 'basse',
          cible_r1_r2: 33,
          cible_r2_offre: 50,
          _diag: { cohorte_taille: cR1, cohorte_perdus: cPerdus, cohorte_gagnes: cGagnes },
        };
      }

      return {
        stock,
        flux_r1_7j: fluxR1,
        cible_r1_hebdo: 8,
        r1_periode: r1Periode,
        r1_par_mois: r1ParMois,
        r2_par_mois: r2ParMois,
        offre_par_mois: offreParMois,
        entonnoir: entonnoir,
        volumes: { r1: nbR1, r2: nbR2, proposition: nbProp },
        taux_r1_vers_r2: nbR1 > 0 ? Math.round((nbR2 / nbR1) * 100) : null,
        taux_r2_vers_proposition: nbR2 > 0 ? Math.round((nbProp / nbR2) * 100) : null,
        cible_r1_vers_r2: 33,
        cible_r2_vers_proposition: 50,
        gagnees: idGagne ? sub.filter(d => d.stage === idGagne).length : 0,
        perdues: idPerdu ? sub.filter(d => d.stage === idPerdu).length : 0,
      };
    }

    const dealsPaul = deals.filter(d => d.bucket === 'paul');
    const dealsAurelie = deals.filter(d => d.bucket === 'aurelie');
    const nonAttribues = deals.filter(d => d.bucket === 'autre').length;

    const equipe = kpi(deals);

    // Noms d'affichage résolus (repli sur libellé par défaut si l'owner n'existe pas encore)
    const ownerDisplay = (last) => {
      const hit = Object.values(owners).find(o => o.last.includes(last));
      return hit ? hit.display : null;
    };

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...equipe, // niveau racine = Équipe (rétrocompatible)
        profils: {
          equipe: equipe,
          paul: kpi(dealsPaul),
          aurelie: kpi(dealsAurelie),
        },
        owners: {
          paul: ownerDisplay('ingrassia') || 'Paul INGRASSIA',
          aurelie: ownerDisplay('lopez') || 'Aurélie LOPEZ',
          non_attribues: nonAttribues,       // deals du pipeline sans propriétaire Paul/Aurélie
          total_deals: deals.length,
        },
      }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
