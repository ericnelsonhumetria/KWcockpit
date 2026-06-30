// netlify/functions/qonto.js
// Récupère soldes + transactions Qonto côté SERVEUR.
// Les clés ne quittent jamais ce fichier serverless — jamais exposées au navigateur.
// Accès réservé au rôle "direction" (vérifié via le token Supabase).
//
// Transposé de services/qonto_service.py (Nelson Management).

const { createClient } = require('@supabase/supabase-js');

// --- Garde d'accès : seul un utilisateur direction authentifié passe ---
async function requireDirection(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY // clé service, côté serveur uniquement
  );

  // Vérifie le token → identité de l'appelant
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, code: 401, msg: 'Token invalide' };

  const email = (userData.user.email || '').toLowerCase();

  // Vérifie le rôle dans user_access
  const { data: access } = await supabase
    .from('user_access')
    .select('is_admin, role')
    .eq('email', email)
    .single();

  const isDirection = access && (access.is_admin === true || access.role === 'direction' || access.role === 'eric');
  if (!isDirection) return { ok: false, code: 403, msg: 'Accès réservé à la direction' };

  return { ok: true, email };
}

// fetch avec timeout pour ne jamais rester bloqué
async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getQontoTransactions(entity, startDate) {
  const slug = process.env.QONTO_LOGIN;
  const secret = process.env.QONTO_SECRET;
  if (!slug || !secret) throw new Error('Clés Qonto absentes côté serveur');

  const headers = {
    Authorization: `${slug.trim()}:${secret.trim()}`,
    Accept: 'application/json',
  };

  // 1. Comptes bancaires → IBAN + soldes
  const accRes = await fetchWithTimeout(`https://thirdparty.qonto.com/v2/bank_accounts?slug=${encodeURIComponent(slug)}`, { headers }, 8000);
  if (!accRes.ok) throw new Error(`Qonto bank_accounts ${accRes.status}`);
  const accJson = await accRes.json();
  const accounts = accJson.bank_accounts || [];
  if (!accounts.length) return { solde: 0, transactions: [], comptes: [] };

  const comptes = accounts.map(a => ({
    nom: a.name || 'Compte',
    iban: a.iban,
    solde: Number(a.balance || 0),
  }));
  const soldeTotal = comptes.reduce((s, c) => s + c.solde, 0);
  const iban = accounts[0].iban;

  // 2. Transactions (pagination bornée + budget de temps global)
  const allTx = [];
  let page = 1;
  const MAX_PAGES = 5;            // 5 × 100 = 500 transactions max (largement assez pour la synthèse)
  const deadline = Date.now() + 18000; // budget total 18s, en deçà de la limite Netlify
  while (page <= MAX_PAGES && Date.now() < deadline) {
    const params = new URLSearchParams({
      slug, iban, per_page: '100', page: String(page),
      'status[]': 'completed',
      settled_at_from: `${startDate}T00:00:00.000Z`,
    });
    let res;
    try {
      res = await fetchWithTimeout(`https://thirdparty.qonto.com/v2/transactions?${params}`, { headers }, 8000);
    } catch (e) {
      break; // timeout sur une page : on s'arrête avec ce qu'on a
    }
    if (!res.ok) throw new Error(`Qonto transactions ${res.status}`);
    const data = await res.json();
    const txs = data.transactions || [];
    if (!txs.length) break;

    for (const t of txs) {
      const raw = Number(t.amount || 0);
      const side = String(t.side || '').toLowerCase();
      const amount = side === 'debit' ? -Math.abs(raw) : Math.abs(raw);
      allTx.push({
        id: String(t.id),
        label: t.label || 'Sans libellé',
        contrepartie: t.counterparty_name || '',
        amount,
        date: (t.settled_at || '').slice(0, 10),
        categorie: t.category || 'Exploitation',
      });
    }
    if (txs.length < 100) break;
    page += 1;
  }

  return { solde: soldeTotal, comptes, transactions: allTx };
}

exports.handler = async (event) => {
  // CORS pour appel depuis le front Netlify
  const cors = {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  // Garde d'accès
  const guard = await requireDirection(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers: cors, body: JSON.stringify({ error: guard.msg }) };

  try {
    const params = event.queryStringParameters || {};
    const entity = params.entite || 'Kaizen Way';
    const startDate = (params.start || '2024-01-01').slice(0, 10);

    const result = await getQontoTransactions(entity, startDate);

    // Agrégats utiles au tableau de bord (on ne renvoie que l'essentiel)
    const encaissements = result.transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const decaissements = result.transactions.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entite: entity,
        solde: result.solde,
        comptes: result.comptes,
        encaissements,
        decaissements,
        flux_net: encaissements + decaissements,
        nb_transactions: result.transactions.length,
        dernieres_transactions: result.transactions.slice(-15).reverse(),
      }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
