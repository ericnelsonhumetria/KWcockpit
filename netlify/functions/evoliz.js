// netlify/functions/evoliz.js
// Récupère le CA et les factures depuis Evoliz, côté SERVEUR.
// Clés jamais exposées au navigateur. Accès réservé à la direction.
//
// Transposé de services/evoliz_service.py (Nelson Management) — volet API
// uniquement (le scan IMAP de Nelson n'est pas repris : hors périmètre).

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
  const isDirection = access && (access.is_admin === true || access.role === 'direction' || access.role === 'eric');
  if (!isDirection) return { ok: false, code: 403, msg: 'Accès réservé à la direction' };
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

async function getInvoices(token, startDate) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'CockpitKW/1.0', Authorization: `Bearer ${token}` };
  const all = [];
  let page = 1;
  let lastPage = 1;
  const dMin = startDate || '2024-01-01';
  const today = new Date();
  const dMax = `${today.getFullYear()}-12-31`;
  do {
    // mêmes paramètres que Nelson (qui fonctionne) : period custom + date_min/date_max
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
      const ht = Number(total.vat_exclude || 0);
      const ttc = Number(total.vat_include || 0);
      const netToPay = Number(total.net_to_pay != null ? total.net_to_pay : ttc);
      all.push({
        numero: inv.document_number || inv.reference || '',
        client: (inv.client && inv.client.name) || '',
        date: inv.documentdate || inv.date || '',
        ht: ht,
        ttc: ttc,
        statut: inv.status || inv.status_code || '',
        // payé si le reste à payer est nul (et qu'il y avait bien un montant)
        paye: (ttc > 0 && netToPay === 0),
      });
    }
    page += 1;
  } while (page <= lastPage && page <= 50);
  return all;
}

// fetch avec timeout
async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
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

    const caTotal = invoices.reduce((s, i) => s + i.ht, 0);
    const caPaye = invoices.filter(i => i.paye).reduce((s, i) => s + i.ht, 0);
    const encours = invoices.filter(i => !i.paye).reduce((s, i) => s + i.ttc, 0);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ca_ht: caTotal,
        ca_paye_ht: caPaye,
        encours_ttc: encours,
        nb_factures: invoices.length,
        nb_impayees: invoices.filter(i => !i.paye).length,
        dernieres_factures: invoices.slice(-15).reverse(),
      }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
