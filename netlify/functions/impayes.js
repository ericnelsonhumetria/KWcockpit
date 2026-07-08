// netlify/functions/impayes.js
// IMPAYÉS RÉELS = factures Evoliz non réglées, déduites par RAPPROCHEMENT BANCAIRE.
// Contexte : les paiements clients ne sont PAS lettrés dans Evoliz (ils le sont côté
// banque Qonto). Evoliz seul croit donc que presque tout est impayé. On croise ici
// les factures Evoliz avec les virements reçus (crédits) Qonto pour déduire le payé.
//
// Port du moteur "cascade_reconcile" de modules/treso_page.py (Nelson Management) :
//   présélection montant (±1 €) + date (±90 j), puis scoring (n° facture, nom client
//   fuzzy, mots du client, montant quasi-exact, proximité date), seuil 35, plus un
//   repli "un seul virement au montant exact".

const { createClient } = require('@supabase/supabase-js');

const TODAY_ISO = new Date().toISOString().slice(0, 10);

// ---------- Accès : direction + finance (najoua) ----------
async function requireFinance(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, code: 401, msg: 'Token invalide' };
  const email = (userData.user.email || '').toLowerCase();
  const { data: access } = await supabase
    .from('user_access').select('is_admin, role').eq('email', email).single();
  const ok = access && (access.is_admin === true || ['direction', 'eric', 'najoua'].includes(access.role));
  if (!ok) return { ok: false, code: 403, msg: 'Accès réservé à la direction / finance' };
  return { ok: true, email };
}

async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ---------- Evoliz : factures actives (hors annulées) ----------
async function evolizLogin() {
  const pub = process.env.EVOLIZ_PUBLIC_KEY, sec = process.env.EVOLIZ_SECRET_KEY;
  if (!pub || !sec) throw new Error('Clés Evoliz absentes côté serveur');
  const res = await fetch('https://www.evoliz.io/api/login', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'CockpitKW/1.0' },
    body: JSON.stringify({ public_key: pub, secret_key: sec }),
  });
  if (!res.ok) throw new Error(`Evoliz login ${res.status}`);
  return (await res.json()).access_token;
}

async function getInvoices(token, startDate) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'CockpitKW/1.0', Authorization: `Bearer ${token}` };
  const all = [];
  let page = 1, lastPage = 1;
  const today = new Date();
  const dMax = `${today.getFullYear()}-12-31`;
  do {
    const qs = new URLSearchParams({ per_page: '100', page: String(page), period: 'custom', date_min: startDate, date_max: dMax });
    let res;
    try { res = await fetchWithTimeout(`https://www.evoliz.io/api/v1/invoices?${qs}`, { headers }, 9000); }
    catch (e) { break; }
    if (!res.ok) break;
    const data = await res.json();
    const items = data.data || [];
    lastPage = data.last_page || 1;
    if (!items.length) break;
    for (const inv of items) {
      const total = inv.total || {};
      const ttc = Number(total.ttc != null ? total.ttc : (total.vat_include || 0));
      const ht = Number(total.untaxed != null ? total.untaxed : (total.vat_exclude || 0));
      const code = Number(inv.status_code != null ? inv.status_code : NaN);
      const txt = String((typeof inv.status === 'string') ? inv.status : (inv.status && inv.status.label) || inv.status_label || '').toLowerCase();
      const annule = inv.cancelled === true || inv.canceled === true || txt.includes('cancel') || txt.includes('annul');
      if (annule) continue; // les annulées ne sont jamais un impayé
      const dateFact = (inv.documentdate || inv.date || '').slice(0, 10);
      let echeance = (inv.due_date || inv.duedate || inv.date_echeance || '');
      echeance = echeance ? String(echeance).slice(0, 10) : '';
      if (!echeance && dateFact) { const d = new Date(dateFact); d.setDate(d.getDate() + 30); echeance = d.toISOString().slice(0, 10); }
      all.push({
        numero: inv.document_number || inv.reference || '',
        client: (inv.client && inv.client.name) || '',
        dateFact, echeance, ht, ttc,
        paye: false, match: '',
      });
    }
    page += 1;
  } while (page <= lastPage && page <= 50);
  return all;
}

// ---------- Qonto : virements reçus (crédits) ----------
async function getQontoCredits(startDate) {
  const slug = process.env.QONTO_LOGIN, secret = process.env.QONTO_SECRET;
  if (!slug || !secret) throw new Error('Clés Qonto absentes côté serveur');
  const headers = { Authorization: `${slug.trim()}:${secret.trim()}`, Accept: 'application/json' };
  const accRes = await fetchWithTimeout(`https://thirdparty.qonto.com/v2/bank_accounts?slug=${encodeURIComponent(slug)}`, { headers }, 8000);
  if (!accRes.ok) throw new Error(`Qonto bank_accounts ${accRes.status}`);
  const accounts = (await accRes.json()).bank_accounts || [];
  const credits = [];
  const deadline = Date.now() + 16000;
  for (const acc of accounts) {
    const iban = acc.iban;
    let page = 1;
    while (page <= 5 && Date.now() < deadline) {
      const params = new URLSearchParams({
        slug, iban, per_page: '100', page: String(page),
        'status[]': 'completed', settled_at_from: `${startDate}T00:00:00.000Z`,
      });
      let res;
      try { res = await fetchWithTimeout(`https://thirdparty.qonto.com/v2/transactions?${params}`, { headers }, 8000); }
      catch (e) { break; }
      if (!res.ok) break;
      const txs = (await res.json()).transactions || [];
      if (!txs.length) break;
      for (const t of txs) {
        const side = String(t.side || '').toLowerCase();
        if (side === 'debit') continue; // on ne garde que les encaissements
        credits.push({
          date: (t.settled_at || '').slice(0, 10),
          amount: Math.abs(Number(t.amount || 0)),
          libelle: t.label || '',
          contrepartie: t.counterparty_name || '',
          used: false,
        });
      }
      if (txs.length < 100) break;
      page += 1;
    }
  }
  return credits;
}

// ---------- Utilitaires de rapprochement (port Nelson) ----------
function normalize(text) {
  let t = String(text || '').toLowerCase().trim();
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const suf of [' sas', ' sarl', ' eurl', ' sasu', ' ei', ' sci', ' s.a.s', ' s.a.r.l']) t = t.split(suf).join('');
  return t.replace(/\s+/g, ' ').trim();
}
function daysBetween(a, b) {
  const da = new Date(a), db = new Date(b);
  if (isNaN(da) || isNaN(db)) return 9999;
  return Math.abs((da - db) / 86400000);
}
// Ratio type SequenceMatcher, approximé par la plus longue sous-séquence commune
function lcsRatio(a, b) {
  a = a || ''; b = b || '';
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  const prev = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    let diag = 0;
    for (let j = 1; j <= m; j++) {
      const tmp = prev[j];
      prev[j] = (a[i - 1] === b[j - 1]) ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = tmp;
    }
  }
  return (2 * prev[m]) / (n + m);
}

function reconcile(invoices, credits) {
  invoices.sort((a, b) => (a.dateFact || '').localeCompare(b.dateFact || ''));
  let auto = 0;
  for (const inv of invoices) {
    const ttc = inv.ttc, ech = inv.echeance || inv.dateFact;
    // Étape 1 : présélection montant (±1 €) + date (±90 j) + crédit non utilisé
    const candidates = credits.filter(c => !c.used && Math.abs(c.amount - ttc) < 1.0 && daysBetween(c.date, ech) <= 90);
    if (!candidates.length) continue;
    const clientNorm = normalize(inv.client);
    const numFact = String(inv.numero || '').toLowerCase().trim();
    const clientWords = clientNorm.split(' ').filter(w => w.length >= 2);
    let best = 0, bestC = null;
    for (const c of candidates) {
      const lib = normalize(`${c.libelle} ${c.contrepartie}`);
      let score = 0;
      if (numFact.length >= 3 && lib.includes(numFact)) score = 100;               // n° facture décisif
      const sim = lcsRatio(clientNorm, lib);                                        // nom client fuzzy
      if (sim >= 0.55) score = Math.max(score, 65);
      else if (sim >= 0.35) score = Math.max(score, 35);
      if (clientWords.length) {                                                     // mots du client
        const matched = clientWords.filter(w => lib.includes(w)).length;
        if (matched > 0) {
          const ratio = matched / clientWords.length;
          if (ratio >= 0.5) score = Math.max(score, 60);
          else score = Math.max(score, Math.min(30 + matched * 10, 55));
        }
      }
      if (Math.abs(c.amount - ttc) < 0.10) score += 15;                            // montant quasi-exact
      const dd = daysBetween(c.date, ech);                                          // proximité date
      if (dd <= 15) score += 10; else if (dd <= 45) score += 5;
      if (score > best) { best = score; bestC = c; }
    }
    if (best >= 35 && bestC) { bestC.used = true; inv.paye = true; inv.match = 'auto'; auto++; continue; }
    // Repli : un seul virement au montant exact → très probablement le bon
    const exact = candidates.filter(c => Math.abs(c.amount - ttc) < 0.10);
    if (exact.length === 1) { exact[0].used = true; inv.paye = true; inv.match = 'exact'; auto++; }
  }
  return auto;
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  const guard = await requireFinance(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers: cors, body: JSON.stringify({ error: guard.msg }) };

  try {
    const params = event.queryStringParameters || {};
    const startDate = (params.start || '2024-01-01').slice(0, 10);

    const token = await evolizLogin();
    const [invoices, credits] = await Promise.all([getInvoices(token, startDate), getQontoCredits(startDate)]);

    const rapproches = reconcile(invoices, credits);

    const impayees = invoices.filter(i => !i.paye);
    const echues = impayees.filter(i => i.echeance && i.echeance < TODAY_ISO);
    const encours = impayees.reduce((s, i) => s + i.ttc, 0);
    const echu = echues.reduce((s, i) => s + i.ttc, 0);
    const creditsUtilises = credits.filter(c => c.used).length;

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        encours_ttc: encours,
        echu_ttc: echu,
        nb_impayees: impayees.length,
        nb_echues: echues.length,
        // transparence du rapprochement
        nb_factures: invoices.length,
        nb_rapprochees: rapproches,
        nb_credits: credits.length,
        nb_credits_utilises: creditsUtilises,
        impayees_detail: impayees
          .sort((a, b) => (a.echeance || '').localeCompare(b.echeance || ''))
          .map(i => ({ numero: i.numero, client: i.client, echeance: i.echeance, reste_du: i.ttc, echu: !!(i.echeance && i.echeance < TODAY_ISO) })),
      }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
