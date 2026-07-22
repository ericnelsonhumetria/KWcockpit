// netlify/functions/ringover.js
// Indicateurs "avant R1" pour les vues Commerce et Direction, via l'API RingOver.
// Calcule, sur une periode glissante, pour les appels (par defaut SORTANTS) :
//   - appels     : nombre d'appels
//   - decroches  : appels ayant donne lieu a une conversation (incall_duration > 0, ou is_answered)
//   - pitchs     : appels avec conversation >= 90 s (1 min 30)
// La cle API RingOver reste cote serveur (jamais exposee au front).
//
// Appel (GET) : /api/ringover?days=7&direction=out
//   days      : fenetre glissante en jours (1-31, defaut 7 — aligne sur "R1 cette semaine")
//   direction : 'out' (defaut) | 'in' | 'all'
// Sortie :
//   { periode:{start,end,days,direction}, appels, decroches, pitchs,
//     taux_decroche, taux_pitch_sur_decroche }
//
// Prerequis : variable d'env RINGOVER_API_KEY (Dashboard RingOver -> Developpeur -> cles API,
// droits sur les appels), scope Functions, puis redeploy.
// API RingOver : base https://public-api.ringover.com/v2 , auth par header Authorization: <cle> (sans "Bearer").

const { createClient } = require('@supabase/supabase-js');

// Garde robuste : l'utilisateur doit etre authentifie. Seuls les consultants (delivery)
// sont exclus des indicateurs commerciaux. Si la lecture du role echoue, on n'exclut
// pas un ayant-droit legitime (direction/commerce). Le bandeau n'apparait de toute facon
// que dans les vues paul/eric (role-gating cote front).
async function requireNonConsultant(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data || !data.user) return { ok: false, code: 401, msg: 'Token invalide' };
  const email = data.user.email;
  let role = '';
  try {
    const { data: ua } = await sb.from('user_access').select('role, is_admin').eq('email', email).maybeSingle();
    role = (ua && ua.role) || '';
    if (ua && ua.is_admin) return { ok: true, email: email, role: role };
  } catch (e) { /* lecture role indisponible : on ne bloque pas */ }
  if (role === 'consultant') return { ok: false, code: 403, msg: 'Indicateurs réservés aux fonctions commerce / direction' };
  return { ok: true, email: email, role: role };
}

// tolerance aux variantes de nommage de l'API
function dirOf(c) { return String(c.direction || c.type || c.way || '').toLowerCase(); }
function inCall(c) {
  var v = (c.incall_duration != null) ? c.incall_duration
        : (c.in_call_duration != null) ? c.in_call_duration
        : (c.incall_duration_seconds != null) ? c.incall_duration_seconds : 0;
  return Number(v) || 0;
}
function isAnswered(c) {
  if (c.is_answered != null) return !!c.is_answered;
  var ls = String(c.last_state || c.status || c.state || '').toUpperCase();
  if (ls) return ls === 'ANSWERED';
  return inCall(c) > 0;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non supportée' }) };
  }

  const key = process.env.RINGOVER_API_KEY;
  if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'RINGOVER_API_KEY manquante côté serveur' }) };

  const guard = await requireNonConsultant(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers, body: JSON.stringify({ error: guard.msg }) };

  const q = event.queryStringParameters || {};
  var days = parseInt(q.days, 10); if (!days || days < 1 || days > 31) days = 7;
  var direction = (q.direction === 'in' || q.direction === 'all') ? q.direction : 'out';
  var end = new Date();
  var start = new Date(end.getTime() - days * 86400000);

  // --- Mode diagnostic : /api/ringover?debug=1 ---
  // Teste plusieurs variantes de l'appel /calls et renvoie les reponses brutes de
  // RingOver, pour isoler la cause (endpoint, parametres, entete, perimetre de cle).
  if (q.debug) {
    var variantes = [
      { note: 'GET /calls (minimal, header Authorization seul)', url: 'https://public-api.ringover.com/v2/calls?limit_count=5', hdr: { 'Authorization': key } },
      { note: 'GET /calls avec Content-Type json', url: 'https://public-api.ringover.com/v2/calls?limit_count=5', hdr: { 'Authorization': key, 'Content-Type': 'application/json' } },
      { note: 'GET /calls avec dates', url: 'https://public-api.ringover.com/v2/calls?start_date=' + encodeURIComponent(start.toISOString()) + '&end_date=' + encodeURIComponent(end.toISOString()) + '&limit_count=5', hdr: { 'Authorization': key } },
      { note: 'GET /calls avec Bearer', url: 'https://public-api.ringover.com/v2/calls?limit_count=5', hdr: { 'Authorization': 'Bearer ' + key } }
    ];
    var out = [];
    for (var vi = 0; vi < variantes.length; vi++) {
      var v = variantes[vi];
      try {
        var rr = await fetch(v.url, { headers: v.hdr });
        var bb = await rr.text();
        out.push({ note: v.note, status: rr.status, body: bb.slice(0, 220) });
      } catch (e) { out.push({ note: v.note, error: (e && e.message) || 'err' }); }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ debug: true, key_len: (key || '').length, tests: out }, null, 2) };
  }

  // Pagination RingOver (max 1000 appels par page). Fenetre <= 31 j pour rester sous les limites de l'API.
  var calls = [];
  var offset = 0, pageSize = 1000, pages = 0, maxPages = 25;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);
  try {
    while (pages < maxPages) {
      pages++;
      var url = 'https://public-api.ringover.com/v2/calls'
        + '?start_date=' + encodeURIComponent(start.toISOString())
        + '&end_date=' + encodeURIComponent(end.toISOString())
        + '&limit_count=' + pageSize + '&limit_offset=' + offset;
      var res = await fetch(url, { headers: { 'Authorization': key, 'Content-Type': 'application/json' }, signal: controller.signal });
      if (res.status === 204) break; // aucun appel sur la periode
      var raw = await res.text();
      var data; try { data = JSON.parse(raw); } catch (e) { data = null; }
      if (!res.ok) {
        clearTimeout(tid);
        var detail = '';
        if (data && typeof data === 'object') detail = data.detail || data.message || data.error || data.title || JSON.stringify(data);
        else if (data) detail = String(data);
        else detail = raw.slice(0, 200);
        // On ne propage PAS 401/403 bruts de RingOver : le front les confondrait avec
        // la garde d'acces du Cockpit. Erreur amont -> 502, message explicite.
        var upstreamAuth = (res.status === 401 || res.status === 403);
        var code = upstreamAuth ? 502 : res.status;
        var hint = upstreamAuth ? ' \u2014 la cl\u00e9 API RingOver n\'a pas les droits sur les appels, ou ne couvre pas les utilisateurs concern\u00e9s.' : '';
        return { statusCode: code, headers, body: JSON.stringify({ error: 'RingOver (' + res.status + ') : ' + detail + hint }) };
      }
      var list = (data && (data.call_list || data.calls || data.list)) || [];
      calls = calls.concat(list);
      var total = data ? (data.total_call_count != null ? data.total_call_count : data.call_list_count) : null;
      offset += pageSize;
      if (list.length < pageSize || (total != null && calls.length >= total)) break;
    }
    clearTimeout(tid);
  } catch (e) {
    clearTimeout(tid);
    var m = e.name === 'AbortError' ? 'Délai dépassé (réduire la fenêtre)' : ('RingOver injoignable : ' + e.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: m }) };
  }

  var scoped = (direction === 'all') ? calls : calls.filter(function (c) {
    var d = dirOf(c);
    return direction === 'out' ? (d.indexOf('out') >= 0) : (d.indexOf('in') >= 0);
  });

  var appels = scoped.length;
  var decroches = scoped.filter(isAnswered).length;
  var pitchs = scoped.filter(function (c) { return inCall(c) >= 90; }).length;

  return {
    statusCode: 200, headers, body: JSON.stringify({
      periode: { start: start.toISOString(), end: end.toISOString(), days: days, direction: direction },
      appels: appels,
      decroches: decroches,
      pitchs: pitchs,
      taux_decroche: appels ? Math.round(decroches / appels * 100) : 0,
      taux_pitch_sur_decroche: decroches ? Math.round(pitchs / decroches * 100) : 0,
    }),
  };
};
