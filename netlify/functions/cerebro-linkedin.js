// netlify/functions/cerebro-linkedin.js  (v1)
// Connexion LinkedIn de CEREBRO PEOPLE (OAuth 2.0 officiel, API de portabilité des données) :
//   POST ?action=start       (session Cockpit) → { url } : adresse d'autorisation LinkedIn (la page l'ouvre dans un nouvel onglet)
//   GET  ?code=…&state=…     retour de LinkedIn (c'est l'URL de redirection à déclarer dans l'application LinkedIn) : enregistre le jeton
//                            CHIFFRÉ, lance la première synchronisation, affiche une page de confirmation
//   POST ?action=sync        (session Cockpit) → lance la synchronisation maintenant
//   POST ?action=disconnect  (session Cockpit) → supprime le jeton (et le révoque chez LinkedIn si possible)
// Le jeton n'est JAMAIS renvoyé au navigateur. L'identité de la personne qui autorise est portée par un « state » signé (HMAC, 10 min).

const crypto = require('crypto');
const LIB = require('./cerebro-linkedin-sync-background.js')._lib;
const SCOPE = 'r_dma_portability_self_serve';

const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const page = (ok, title, text, C) => ({ statusCode: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cerebro · LinkedIn</title>
<body style="margin:0;background:#0c0a0b;color:#F2ECE3;font-family:Inter,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:480px;padding:28px;border:1px solid ${ok ? '#3FB68B' : '#C15B57'};border-radius:12px;background:#171214">
<div style="font-size:12px;letter-spacing:.12em;color:#E0A63C;font-weight:bold">CEREBRO · PEOPLE</div>
<h2 style="margin:8px 0 10px">${ok ? '✓ ' : '⚠ '}${title}</h2><p style="line-height:1.5">${text}</p>
<p style="color:#9c8f88;font-size:13px">Vous pouvez fermer cet onglet et revenir dans le Cockpit → Cerebro → People.</p>
<a href="${C.SITE}" style="color:#E0A63C">Retour au Cockpit</a></div></body>` });

const b64 = b => Buffer.from(b).toString('base64url');
function signState(C, uid) { const p = b64(JSON.stringify({ uid, ts: Date.now() })); return p + '.' + crypto.createHmac('sha256', C.SECRET).update(p).digest('base64url'); }
function readState(C, st) {
  try {
    const [p, sig] = String(st).split('.'); const good = crypto.createHmac('sha256', C.SECRET).update(p).digest('base64url');
    if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return Date.now() - o.ts < 10 * 60 * 1000 && o.uid ? o : null;
  } catch (_) { return null; }
}
const redirectUri = C => process.env.LINKEDIN_REDIRECT_URI || (C.SITE + '/.netlify/functions/cerebro-linkedin');

async function triggerSync(C, doFetch, userId) {
  try {
    const r = await doFetch(C.SITE + '/.netlify/functions/cerebro-linkedin-sync-background', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cerebro-secret': C.SECRET }, body: JSON.stringify({ user_id: userId }) });
    return { ok: r.status === 202 || !!r.ok, status: r.status };
  } catch (e) { return { ok: false, status: 0, error: (e && e.message) || 'réseau' }; }
}

exports.handler = async (event, context, deps) => {
  deps = deps || {};
  const C = LIB.cfg(), doFetch = deps.fetch || fetch;
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (!C.SERVICE) return json(500, { error: 'config serveur incomplète' });
  const sb = (deps.createClient || require('@supabase/supabase-js').createClient)(C.SUPABASE_URL, C.SERVICE, { auth: { persistSession: false } });
  const qs = event.queryStringParameters || {};

  // ── Retour de LinkedIn (navigateur, sans session : l'identité vient du « state » signé) ──
  if (event.httpMethod === 'GET') {
    if (!C.SECRET || !C.TOKEN_KEY || !C.LI_ID || !C.LI_SECRET) return page(false, 'Connexion non configurée', 'Le serveur n’est pas configuré pour LinkedIn (variables LINKEDIN_CLIENT_ID et LINKEDIN_CLIENT_SECRET).', C);
    if (qs.error) return page(false, 'Autorisation refusée', LIB_esc(qs.error_description || qs.error), C);
    const st = readState(C, qs.state); if (!st) return page(false, 'Lien invalide ou expiré', 'La demande d’autorisation a plus de 10 minutes ou n’est pas reconnue. Relancez « Connecter LinkedIn » depuis Cerebro → People.', C);
    if (!qs.code) return page(false, 'Réponse incomplète', 'LinkedIn n’a pas renvoyé de code d’autorisation.', C);
    let tok;
    try {
      const r = await doFetch('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: qs.code, client_id: C.LI_ID, client_secret: C.LI_SECRET, redirect_uri: redirectUri(C) }).toString() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) return page(false, 'LinkedIn a refusé l’échange', LIB_esc(j.error_description || j.error || ('HTTP ' + r.status)), C);
      tok = j;
    } catch (e) { return page(false, 'LinkedIn injoignable', LIB_esc((e && e.message) || 'réseau'), C); }
    const now = new Date();
    const row = { user_id: st.uid, access_token: LIB.encrypt(C, tok.access_token), expires_at: new Date(now.getTime() + (Number(tok.expires_in) || 5184000) * 1000).toISOString(), scope: tok.scope || SCOPE,
      connected_at: now.toISOString(), last_status: 'pending', last_error: null, expired_notified: false, updated_at: now.toISOString() };
    const w = await sb.from('cerebro_linkedin').upsert(row, { onConflict: 'user_id' });
    if (w && w.error) return page(false, 'Enregistrement impossible', LIB_esc(w.error.message), C);
    await triggerSync(C, doFetch, st.uid);
    return page(true, 'LinkedIn connecté', 'Vos relations vont être synchronisées automatiquement, puis chaque lundi. La première synchronisation démarre maintenant ; LinkedIn peut mettre une vingtaine de minutes à préparer vos données.', C);
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  const h = event.headers || {};
  const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'non authentifié (session Cockpit requise)' });
  let user = null; try { const u = await sb.auth.getUser(token); user = u && u.data && u.data.user; } catch (_) {}
  if (!user) return json(401, { error: 'session invalide' });
  const action = qs.action;

  if (action === 'start') {
    try {
      const r = await doFetch(C.SUPABASE_URL + '/rest/v1/rpc/cerebro_can', { method: 'POST', headers: { apikey: C.PUB, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'cerebro_talents' }) });
      if (!(r.ok && (await r.json()) === true)) return json(403, { error: 'Accès réservé aux personnes qui ont Cerebro People' });
    } catch (_) { return json(403, { error: 'Droits non vérifiables' }); }
    if (!C.LI_ID || !C.LI_SECRET) return json(503, { error: 'Connexion LinkedIn non configurée côté serveur (LINKEDIN_CLIENT_ID et LINKEDIN_CLIENT_SECRET manquants)' });
    if (!C.SECRET || !C.TOKEN_KEY) return json(503, { error: 'Connexion LinkedIn non configurée côté serveur (CEREBRO_WATCH_SECRET manquant)' });
    const url = 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({ response_type: 'code', client_id: C.LI_ID, redirect_uri: redirectUri(C), state: signState(C, user.id), scope: SCOPE }).toString();
    return json(200, { url });
  }
  if (action === 'sync') {
    const r = await sb.from('cerebro_linkedin').select('user_id').eq('user_id', user.id).maybeSingle();
    if (!(r && r.data)) return json(409, { error: 'LinkedIn n’est pas connecté' });
    const t = await triggerSync(C, doFetch, user.id);
    return t.ok ? json(202, { ok: true }) : json(502, { error: 'lancement de la synchronisation impossible (' + (t.status ? 'HTTP ' + t.status + ' de la fonction cerebro-linkedin-sync-background : vérifiez qu’elle est déployée et que CEREBRO_WATCH_SECRET est identique' : 'erreur réseau : ' + t.error) + ')' });
  }
  if (action === 'disconnect') {
    const r = await sb.from('cerebro_linkedin').select('access_token').eq('user_id', user.id).maybeSingle();
    const plain = r && r.data ? LIB.decrypt(C, r.data.access_token) : null;
    await sb.from('cerebro_linkedin').delete().eq('user_id', user.id);
    if (plain && C.LI_ID) { try { await doFetch('https://www.linkedin.com/oauth/v2/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: C.LI_ID, client_secret: C.LI_SECRET, token: plain }).toString() }); } catch (_) {} }
    return json(200, { ok: true });
  }
  return json(400, { error: 'action inconnue (start | sync | disconnect)' });
};
function LIB_esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
exports._t = { signState, readState, redirectUri };
