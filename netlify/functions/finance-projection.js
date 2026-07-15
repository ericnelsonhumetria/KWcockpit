// netlify/functions/finance-charges-proj.js
// Persistance de la projection des charges (3 leviers) — cross-device.
// Stockage : table public.finance_charges_proj (clé service ; RLS fermée, tout passe par ici).
// Aligné sur finance-projection.js : SUPABASE_URL + SUPABASE_SERVICE_KEY, garde requireDirection.
// GET  ?annee=YYYY            -> { data: <jsonb|null> }
// POST { annee, data:{...} }  -> { ok:true }

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
    // -------- Lecture --------
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
      const src = (payload.data && typeof payload.data === 'object') ? payload.data : {};
      const VALID_SC = ['facture', 'signe', 'p75', 'p50'];
      // whiteliste : les 3 leviers + le scénario d'atterrissage
      const clean = {
        salaires: Array.isArray(src.salaires) ? src.salaires : [],
        soustraitants: Array.isArray(src.soustraitants) ? src.soustraitants : [],
        reste: Array.isArray(src.reste) ? src.reste : [],
        scenario: VALID_SC.includes(src.scenario) ? src.scenario : 'signe',
      };
      const { error } = await db
        .from('finance_charges_proj')
        .upsert({ annee, data: clean, updated_at: new Date().toISOString(), updated_by: guard.email }, { onConflict: 'annee' });
      if (error) throw error;
      return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: jsonHeaders, body: JSON.stringify({ error: 'Méthode non supportée' }) };
  } catch (e) {
    return { statusCode: 502, headers: jsonHeaders, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
