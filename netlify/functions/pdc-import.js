// netlify/functions/pdc-import.js
// Écriture serveur du plan de charge multi-consultants (clé service -> passe outre la RLS).
// Réservé à la direction. POST { items:[{ email, rows:[{date_jour, jours}] }] }
//  -> pour chaque consultant : (ré)écrit la mission PLANNING en état "planifie".
// Réponse : { results:[{ email, written, verified }|{ email, error }] }

const { createClient } = require('@supabase/supabase-js');

function svc() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Lecture paginée (contourne la limite PostgREST de 1000 lignes).
// Enchaîne des .range(from, from+999) jusqu'à épuisement, garde-fou 100 pages.
async function readAll(sb, table, columns) {
  const PAGE = 1000, MAX_PAGES = 100;
  let out = [], from = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data || [];
    out = out.concat(batch);
    if (batch.length < PAGE) break; // dernière page atteinte
    from += PAGE;
  }
  return out;
}

async function requireDirection(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const sb = svc();
  const { data: userData, error } = await sb.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, code: 401, msg: 'Token invalide' };
  const email = (userData.user.email || '').toLowerCase();
  const { data: access } = await sb.from('user_access').select('is_admin, role').eq('email', email).single();
  const ok = access && (access.is_admin === true || access.role === 'direction' || access.role === 'eric' || access.role === 'najoua');
  if (!ok) return { ok: false, code: 403, msg: 'Accès réservé à la direction' };
  return { ok: true, email, sb };
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

  const guard = await requireDirection(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers, body: JSON.stringify({ error: guard.msg }) };
  const sb = guard.sb;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps invalide' }) }; }

  // Lecture serveur (clé service) : renvoie tout le plan de charge, hors RLS.
  // pdc_charge et pdc_capacite peuvent dépasser 1000 lignes -> lecture paginée.
  if (body && body.action === 'read') {
    try {
      const [charge, capacite, mis, aff] = await Promise.all([
        readAll(sb, 'pdc_charge', 'email,date_jour,mission_code,etat,jours'),
        readAll(sb, 'pdc_capacite', 'email,annee,mois,jours_dispo'),
        sb.from('pdc_missions').select('code,intitule,client,jh_vendus,statut'),
        sb.from('pdc_affectations').select('email,mission_code'),
      ]);
      return { statusCode: 200, headers, body: JSON.stringify({
        charge,
        capacite,
        missions: mis.data || [],
        affectations: aff.data || [],
      }) };
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Lecture serveur : ' + ((e && e.message) || String(e)) }) };
    }
  }

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items) return { statusCode: 400, headers, body: JSON.stringify({ error: 'items manquant' }) };

  // Mission fourre-tout PLANNING (satisfait la FK pdc_charge.mission_code)
  const mm = await sb.from('pdc_missions').upsert(
    { code: 'PLANNING', intitule: 'Planning importé (multi-consultants)', client: '', statut: 'En cours' },
    { onConflict: 'code' });
  if (mm.error) return { statusCode: 502, headers, body: JSON.stringify({ error: 'Mission PLANNING : ' + mm.error.message }) };

  const results = [];
  for (const it of items) {
    const email = String((it && it.email) || '').toLowerCase().trim();
    if (!email) { results.push({ email: '(vide)', error: 'email manquant' }); continue; }
    const rows = (Array.isArray(it.rows) ? it.rows : [])
      .filter(r => r && r.date_jour)
      .map(r => ({
        email, mission_code: 'PLANNING', date_jour: r.date_jour, etat: 'planifie',
        jours: Number(r.jours) || 1, activite: null, saisi_par: guard.email, updated_at: new Date().toISOString(),
      }));
    try {
      const del = await sb.from('pdc_charge').delete().eq('email', email).eq('mission_code', 'PLANNING').eq('etat', 'planifie');
      if (del.error) throw del.error;
      for (let c = 0; c < rows.length; c += 400) {
        const up = await sb.from('pdc_charge').upsert(rows.slice(c, c + 400), { onConflict: 'email,date_jour,mission_code,etat' });
        if (up.error) throw up.error;
      }
      const chk = await sb.from('pdc_charge').select('date_jour', { count: 'exact', head: true })
        .eq('email', email).eq('mission_code', 'PLANNING').eq('etat', 'planifie');
      results.push({ email, written: rows.length, verified: chk.count || 0 });
    } catch (e) {
      results.push({ email, error: (e && e.message) || String(e) });
    }
  }
  return { statusCode: 200, headers, body: JSON.stringify({ results }) };
};
