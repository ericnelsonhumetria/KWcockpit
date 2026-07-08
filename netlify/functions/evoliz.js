// netlify/functions/evoliz.js
// Recupere le CA et les factures depuis Evoliz, cote SERVEUR.
// Cles jamais exposees au navigateur. Acces reserve a la direction.
//
// Transpose de services/evoliz_service.py (Nelson Management).
// CORRECTION IMPAYES : aligne sur la logique Nelson —
//   - "paye" = status_code == 1 (statut Evoliz "payee"), fallback reste-a-payer nul ;
//   - factures ANNULEES (cancelled) exclues de l'encours et du CA ;
//   - encours = reste DU (net_to_pay) et non le TTC plein (gere les paiements partiels) ;
//   - "echu" = impayes dont la date d'echeance est depassee.

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
  // Finance : direction + Najoua (proprietaire du processus finance/tresorerie)
  const isDirection = access && (access.is_admin === true || access.role === 'direction' || access.role === 'eric' || access.role === 'najoua');
  if (!isDirection) return { ok: false, code: 403, msg: 'Accès réservé à la direction / finance' };
  return { ok: true, email };
}

async function evolizLogin() {
  const pub = process.env.EVOLIZ_PUBLIC_KEY;
  const sec = process.env.EVOLIZ_SECRET_KEY;
  if (!pub || !sec) throw new Error('Clés Evoliz absentes côté serveur');
  const res = await fetch('https://www.evoliz.io/api/login', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'CockpitKW/1.0' },
    body: JSON.stringify({ public_key: pub, secret_key: sec }),
  });
  if (!res.ok) throw new Error(`Evoliz login ${res.status}`);
  const json = await res.json();
  return json.access_token;
}

// fetch avec timeout
async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

const TODAY_ISO = new Date().toISOString().slice(0, 10);

function normStatus(inv) {
  // status_code numerique (fait foi cote Nelson : 1 = payee) + statut texte de secours
  const code = Number(inv.status_code != null ? inv.status_code
    : (inv.status && typeof inv.status === 'object' ? inv.status.code : NaN));
  const txt = String((inv.status && typeof inv.status === 'string') ? inv.status
    : (inv.status && inv.status.label) || inv.status_label || '').toLowerCase();
  return { code, txt };
}

function isCancelled(inv, txt) {
  return inv.cancelled === true || inv.canceled === true
    || txt.includes('cancel') || txt.includes('annul');
}

async function getInvoices(token, startDate) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'CockpitKW/1.0', Authorization: `Bearer ${token}` };
  const all = [];
  let page = 1;
  let lastPage = 1;
  const dMin = startDate || '2024-01-01';
  const today = new Date();
  const dMax = `${today.getFullYear()}-12-31`;
  do {
    const qs = new URLSearchParams({
      per_page: '100', page: String(page),
      period: 'custom', date_min: dMin, date_max: dMax,
    });
    const url = `https://www.evoliz.io/api/v1/invoices?${qs}`;
    let res;
    try { res = await fetchWithTimeout(url, { headers }, 9000); }
    catch (e) { break; }
    if (!res.ok) break;
    const data = await res.json();
    const items = data.data || [];
    lastPage = data.last_page || 1;
    if (!items.length) break;
    for (const inv of items) {
      const total = inv.total || {};
      // HT : untaxed (Nelson) ou vat_exclude ; TTC : ttc (Nelson) ou vat_include
      const ht = Number(total.untaxed != null ? total.untaxed : (total.vat_exclude || 0));
      const ttc = Number(total.ttc != null ? total.ttc : (total.vat_include || 0));
      const reste = Number(total.net_to_pay != null ? total.net_to_pay : ttc); // reste a payer
      const { code, txt } = normStatus(inv);
      const annule = isCancelled(inv, txt);
      // paye : statut Evoliz "payee" (status_code 1) OU reste a payer nul
      const paye = (code === 1) || (ttc > 0 && reste === 0) || txt.includes('pay');
      const echeance = inv.due_date || inv.duedate || inv.date_echeance || '';
      all.push({
        numero: inv.document_number || inv.reference || '',
        client: (inv.client && inv.client.name) || '',
        date: inv.documentdate || inv.date || '',
        echeance: echeance ? String(echeance).slice(0, 10) : '',
        ht, ttc,
        reste_du: paye ? 0 : (reste > 0 ? reste : ttc),
        statut: txt || (inv.status_code != null ? ('code ' + inv.status_code) : ''),
        annule,
        paye,
      });
    }
    page += 1;
  } while (page <= lastPage && page <= 50);
  return all;
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  const params = event.queryStringParameters || {};

  const guard = await requireDirection(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers: cors, body: JSON.stringify({ error: guard.msg }) };

  try {
    const startDate = (params.start || '2024-01-01').slice(0, 10);

    const token = await evolizLogin();
    const invoices = await getInvoices(token, startDate);

    // On ne compte JAMAIS les factures annulees (ni en CA, ni en impayes).
    const actives = invoices.filter(i => !i.annule);
    const impayees = actives.filter(i => !i.paye);
    const echues = impayees.filter(i => i.echeance && i.echeance < TODAY_ISO);

    const caTotal = actives.reduce((s, i) => s + i.ht, 0);
    const caPaye = actives.filter(i => i.paye).reduce((s, i) => s + i.ht, 0);
    const encours = impayees.reduce((s, i) => s + i.reste_du, 0);   // reste DU, pas le TTC plein
    const echu = echues.reduce((s, i) => s + i.reste_du, 0);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ca_ht: caTotal,
        ca_paye_ht: caPaye,
        encours_ttc: encours,       // total du (non paye, hors annulees)
        echu_ttc: echu,             // sous-ensemble : impayes dont l'echeance est depassee
        nb_factures: actives.length,
        nb_impayees: impayees.length,
        nb_echues: echues.length,
        nb_annulees: invoices.length - actives.length,
        dernieres_factures: actives.slice(-15).reverse(),
        impayees_detail: impayees
          .sort((a, b) => (a.echeance || '').localeCompare(b.echeance || ''))
          .map(i => ({ numero: i.numero, client: i.client, echeance: i.echeance, reste_du: i.reste_du, echu: !!(i.echeance && i.echeance < TODAY_ISO) })),
      }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
