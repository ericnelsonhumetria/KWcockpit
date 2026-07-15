// netlify/functions/finance-charges-proj.js
// Persistance des 3 leviers de charges + scénario + annualisation (blob par année).
// Accès direction / finance. Stockage : table public.finance_charges_proj
// (annee = clé ; RLS fermée, tout passe par ici via clé service).
// Aligné sur finance-projection.js : SUPABASE_URL + SUPABASE_SERVICE_KEY, garde requireDirection.
//
// Contrat front (public/index.html, cpFetchLoad/cpFetchSave) :
//   GET  /api/finance-charges-proj?annee=YYYY        -> { data: <blob> | null }
//   POST /api/finance-charges-proj                   body { annee, data:{...} } -> { ok:true }
//   blob data = { salaires:[], soustraitants:[], reste:[], scenario, annualisation }
//   ⚠ La whitelist DOIT inclure annualisation (l'ancienne version misfilée l'omettait).

const { createClient } = require('@supabase/supabase-js');

async function requireDirection(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, code: 401, msg: 'Token invalide' };
  const email = (userData.user.email || '').toLowerCase();
  const { data: access } = await supabase
    .from('user_access').select('is_admin, role').eq('email', email).single();
  const isDirection = access && (access.is_admin === true || access.role === 'direction' || access.role === 'eric' || access.role === 'najoua');
  if (!isDirection) return { ok: false, code: 403, msg: 'Accès réservé à la direction / finance' };
  return { ok: true, email };
}

function svc() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Mirroir serveur de cpAnnuClean (front) : virgule ou point, borne [0,50 ; 2,00], défaut 1.
function cleanAnnu(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  if (!isFinite(n) || n <= 0) return 1;
  return Math.max(0.5, Math.min(2, Math.round(n * 100) / 100));
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  const guard = await requireDirection(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers: cors, body: JSON.stringify({ error: guard.msg }) };

  const db = svc();
  const jsonHeaders = { ...cors, 'Content-Type': 'application/json' };

  try {
    // -------- Lecture du blob de l'année --------
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const annee = Number(params.annee) || new Date().getFullYear();
      const { data, error } = await db
        .from('finance_charges_proj')
        .select('data')
        .eq('annee', annee)
        .maybeSingle();
      if (error) throw error;
      return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ data: data ? data.data : null }) };
    }

    // -------- Écriture (upsert par année) --------
    if (event.httpMethod === 'POST') {
      let payload = {};
      try { payload = JSON.parse(event.body || '{}'); } catch (e) { payload = {}; }

      const annee = Number(payload.annee) || new Date().getFullYear();
      const d = payload.data || {};

      // Whitelist stricte du blob — annualisation INCLUSE (correctif du bug de l'ancienne version).
      const clean = {
        salaires: Array.isArray(d.salaires) ? d.salaires : [],
        soustraitants: Array.isArray(d.soustraitants) ? d.soustraitants : [],
        reste: Array.isArray(d.reste) ? d.reste : [],
        scenario: ['facture', 'signe', 'p75', 'p50'].includes(d.scenario) ? d.scenario : 'signe',
        annualisation: cleanAnnu(d.annualisation),
      };

      const row = {
        annee,
        data: clean,
        updated_at: new Date().toISOString(),
        updated_by: guard.email,
      };

      const { error } = await db
        .from('finance_charges_proj')
        .upsert(row, { onConflict: 'annee' });
      if (error) throw error;

      return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: jsonHeaders, body: JSON.stringify({ error: 'Méthode non supportée' }) };
  } catch (e) {
    return { statusCode: 502, headers: jsonHeaders, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
