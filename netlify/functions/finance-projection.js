// netlify/functions/finance-projection.js
// CRUD du carnet de projections (atterrissage CA). Accès direction / finance.
// Stockage : table public.finance_projection (clé service ; RLS fermée, tout passe par ici).
// Aligné sur evoliz.js / qonto.js : SUPABASE_URL + SUPABASE_SERVICE_KEY, garde requireDirection.

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
    // -------- Lecture du carnet --------
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const annee = Number(params.annee) || new Date().getFullYear();
      const { data, error } = await db
        .from('finance_projection')
        .select('*')
        .eq('annee', annee)
        .order('mois_facturation', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ rows: data || [] }) };
    }

    // -------- Écriture (save / delete) --------
    if (event.httpMethod === 'POST') {
      let payload = {};
      try { payload = JSON.parse(event.body || '{}'); } catch (e) { payload = {}; }
      const op = payload.op || 'save';

      if (op === 'delete') {
        if (!payload.id) return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: 'id manquant' }) };
        const { error } = await db.from('finance_projection').delete().eq('id', payload.id);
        if (error) throw error;
        return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ ok: true }) };
      }

      const r = payload.row || {};
      if (!r.intitule) return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: 'intitulé requis' }) };

      const clean = {
        annee: Number(r.annee) || new Date().getFullYear(),
        intitule: String(r.intitule),
        montant: (r.montant === null || r.montant === '' || r.montant === undefined) ? null : Number(r.montant),
        tjm: (r.tjm === null || r.tjm === '' || r.tjm === undefined) ? null : Number(r.tjm),
        jours: (r.jours === null || r.jours === '' || r.jours === undefined) ? null : Number(r.jours),
        mois_facturation: r.mois_facturation || null,
        probabilite: ['signe', 'p75', 'p50'].includes(r.probabilite) ? r.probabilite : 'signe',
        statut: r.statut || null,
        notes: r.notes || null,
        mode_livraison: (r.mode_livraison === 'freelance') ? 'freelance' : 'salarie',
        cout: (r.cout === null || r.cout === '' || r.cout === undefined) ? null : Number(r.cout),
        updated_at: new Date().toISOString(),
      };

      if (r.id) {
        const { data, error } = await db.from('finance_projection').update(clean).eq('id', r.id).select().single();
        if (error) throw error;
        return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ row: data }) };
      } else {
        clean.created_by = guard.email;
        const { data, error } = await db.from('finance_projection').insert(clean).select().single();
        if (error) throw error;
        return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ row: data }) };
      }
    }

    return { statusCode: 405, headers: jsonHeaders, body: JSON.stringify({ error: 'Méthode non supportée' }) };
  } catch (e) {
    return { statusCode: 502, headers: jsonHeaders, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
