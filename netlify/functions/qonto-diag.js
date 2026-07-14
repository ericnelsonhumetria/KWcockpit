// netlify/functions/qonto-diag.js
// DIAGNOSTIC (lecture seule) des charges Qonto de l'année : débits groupés par
// contrepartie avec une catégorie PROPOSÉE (règles Nelson). Ne modifie rien,
// ne calcule aucun EBITDA figé — sert uniquement à caler le mapping des libellés
// réels (URSSAF, retraite, mutuelle, sous-traitance…) avant la couche EBITDA.
// Réservé direction / finance. Clone de l'auth + pagination de qonto.js.

const { createClient } = require('@supabase/supabase-js');

async function requireDirection(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, code: 401, msg: 'Token invalide' };
  const email = (userData.user.email || '').toLowerCase();
  const { data: access } = await supabase.from('user_access').select('is_admin, role').eq('email', email).single();
  const isDirection = access && (access.is_admin === true || access.role === 'direction' || access.role === 'eric' || access.role === 'najoua');
  if (!isDirection) return { ok: false, code: 403, msg: 'Accès réservé à la direction / finance' };
  return { ok: true, email };
}

async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function getTransactions(startDate) {
  const slug = process.env.QONTO_LOGIN;
  const secret = process.env.QONTO_SECRET;
  if (!slug || !secret) throw new Error('Clés Qonto absentes côté serveur');
  const headers = { Authorization: `${slug.trim()}:${secret.trim()}`, Accept: 'application/json' };

  const accRes = await fetchWithTimeout(`https://thirdparty.qonto.com/v2/bank_accounts?slug=${encodeURIComponent(slug)}`, { headers }, 8000);
  if (!accRes.ok) throw new Error(`Qonto bank_accounts ${accRes.status}`);
  const accJson = await accRes.json();
  const accounts = accJson.bank_accounts || [];
  if (!accounts.length) return { transactions: [], tronque: false };
  const iban = accounts[0].iban;

  const allTx = [];
  let page = 1, tronque = false;
  const MAX_PAGES = 30;
  const deadline = Date.now() + 18000;
  while (page <= MAX_PAGES && Date.now() < deadline) {
    const params = new URLSearchParams({
      slug, iban, per_page: '100', page: String(page),
      'status[]': 'completed', sort_by: 'settled_at:desc',
      settled_at_from: `${startDate}T00:00:00.000Z`,
    });
    let res;
    try { res = await fetchWithTimeout(`https://thirdparty.qonto.com/v2/transactions?${params}`, { headers }, 8000); }
    catch (e) { break; }
    if (!res.ok) break;
    const data = await res.json();
    const txs = data.transactions || [];
    if (!txs.length) break;
    for (const t of txs) {
      const raw = Number(t.amount || 0);
      const side = String(t.side || '').toLowerCase();
      const amount = side === 'debit' ? -Math.abs(raw) : Math.abs(raw);
      allTx.push({
        label: t.label || 'Sans libellé',
        contrepartie: t.counterparty_name || '',
        amount,
        date: (t.settled_at || '').slice(0, 10),
      });
    }
    const totalPages = (data.meta && data.meta.total_pages) || page;
    if (page >= totalPages) break;
    if (page >= MAX_PAGES) { tronque = true; break; }
    page += 1;
  }
  return { transactions: allTx, tronque };
}

// Catégorie proposée (règles Nelson). PRIORITÉ descendante.
function classify(label, contrepartie, absAmount) {
  const s = ((contrepartie || '') + ' ' + (label || '')).toLowerCase();
  const toks = s.split(/[^a-z0-9']+/).filter(Boolean);
  const hasTok = (t) => toks.indexOf(t) >= 0;
  if (s.indexOf('nelson management') >= 0 || s.indexOf('eric nelson kw') >= 0) return 'inter';
  if (s.indexOf('nelson') >= 0 && absAmount > 6500) return 'perso';
  if (hasTok('tva') || hasTok('is') || s.indexOf('impot') >= 0 || s.indexOf('impôt') >= 0 || s.indexOf('taxe') >= 0 || hasTok('cfe') || s.indexOf('dgfip') >= 0 || s.indexOf('sips') >= 0) return 'fiscalite';
  if (s.indexOf('urssaf') >= 0 || s.indexOf('ursaf') >= 0) return 'social';
  if (s.indexOf('capital') >= 0 || s.indexOf('emprunt') >= 0 || hasTok('pret') || s.indexOf('prêt') >= 0 || s.indexOf('remboursement') >= 0 || s.indexOf('interet') >= 0 || s.indexOf('intérêt') >= 0) return 'bilan';
  if (hasTok('vrt') || s.indexOf('transfert') >= 0 || s.indexOf('hsbc') >= 0 || s.indexOf('virement interne') >= 0) return 'treso';
  const st = ['selfy', 'louhrmi', 'surcouf', 'demeaux', 'ingrassia', 'couturier', 'bienvenu', 'itg', 'leray', 'hachemi', 'hmp', 'plantain', 'mt transition', "ad'missions", 'admissions'];
  for (let i = 0; i < st.length; i++) { if (s.indexOf(st[i]) >= 0) return 'soustraitance'; }
  return 'opex';
}

const IN_EBITDA = { opex: true, social: true, soustraitance: true, fiscalite: false, treso: false, bilan: false, perso: false, inter: false };

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  const guard = await requireDirection(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers: cors, body: JSON.stringify({ error: guard.msg }) };

  try {
    const params = event.queryStringParameters || {};
    const startDate = (params.start || (new Date().getFullYear() + '-01-01')).slice(0, 10);
    const annee = Number(startDate.slice(0, 4));

    const { transactions, tronque } = await getTransactions(startDate);
    const debits = transactions.filter(t => t.amount < 0);

    const catTotals = {}, catCounts = {};
    const groups = {}; // key -> { contrepartie, total, count, labels:Set, catAmounts:{} }
    let totalDebits = 0;

    for (const t of debits) {
      const abs = Math.abs(t.amount);
      totalDebits += abs;
      const cat = classify(t.label, t.contrepartie, abs);
      catTotals[cat] = (catTotals[cat] || 0) + abs;
      catCounts[cat] = (catCounts[cat] || 0) + 1;
      const key = (t.contrepartie && t.contrepartie.trim()) ? t.contrepartie.trim() : (t.label || 'Sans libellé').trim();
      const g = groups[key] || (groups[key] = { contrepartie: key, total: 0, count: 0, labels: new Set(), catAmounts: {} });
      g.total += abs;
      g.count += 1;
      if (g.labels.size < 3 && t.label) g.labels.add(t.label);
      g.catAmounts[cat] = (g.catAmounts[cat] || 0) + abs;
    }

    const categories = Object.keys(catTotals).map(c => ({
      cat: c, total: catTotals[c], count: catCounts[c], in_ebitda: !!IN_EBITDA[c],
    })).sort((a, b) => b.total - a.total);

    let opexEbitda = 0, exclus = 0;
    categories.forEach(c => { if (c.in_ebitda) opexEbitda += c.total; else exclus += c.total; });

    const groupes = Object.values(groups).map(g => {
      let best = 'opex', bestv = -1;
      for (const c in g.catAmounts) { if (g.catAmounts[c] > bestv) { bestv = g.catAmounts[c]; best = c; } }
      return { contrepartie: g.contrepartie, cat: best, total: g.total, count: g.count, labels: Array.from(g.labels) };
    }).sort((a, b) => b.total - a.total).slice(0, 60);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        annee, nb_debits: debits.length, total_debits: totalDebits,
        opex_ebitda: opexEbitda, exclus, categories, groupes, tronque: !!tronque,
      }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
