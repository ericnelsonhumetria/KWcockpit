// netlify/functions/ringover.js
// Indicateurs "avant R1" pour les vues Commerce et Direction, via l'API RingOver.
// Sur une periode (7j / 30j / depuis le 1er janvier), pour les appels SORTANTS par defaut :
//   - appels     : nombre d'appels
//   - decroches  : vraies conversations (ANSWERED et incall_duration >= 30 s)
//   - pitchs     : appels avec conversation >= 90 s (1 min 30)
// Renvoie aussi une ventilation mois par mois (byMonth).
// La cle API RingOver reste cote serveur.
//
// PROFILS : chaque appel est attribue a l'agent RingOver qui l'a passe. Le meme bloc
// d'indicateurs est calcule pour Equipe / Paul INGRASSIA / Aurelie LOPEZ, expose dans `profils`.
// Le niveau racine = Equipe (retrocompatible avec loadRespCommerce et l'ancien front).
// `diag` liste les agents reellement detectes (outil de reglage, supprimable ensuite).
//
// Appel (GET) : /api/ringover?period=7d|30d|ytd&direction=out
// Sortie : { periode, appels, decroches, pitchs, taux_decroche, taux_pitch_sur_decroche,
//            byMonth:[...], profils:{equipe,paul,aurelie}, diag:{agents, sample_keys, has_user} }
//
// Prerequis : RINGOVER_API_KEY (droits sur les appels), scope Functions.
// API : base https://public-api.ringover.com/v2 , auth header Authorization: <cle> (sans "Bearer").
// Limite API : plage <= 15 j par requete -> on decoupe en fenetres.

const { createClient } = require('@supabase/supabase-js');

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
function isConversation(c) { return isAnswered(c) && inCall(c) >= 30; }
function monthOf(c) {
  var d = c.start_time || c.start || c.creation_date || c.date || c.answered_time || '';
  var dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2);
}
function windows(start, end, maxDays) {
  var res = [], cur = new Date(start), span = maxDays * 86400000;
  while (cur < end) {
    var w2 = new Date(Math.min(cur.getTime() + span, end.getTime()));
    res.push([new Date(cur), w2]);
    cur = new Date(w2.getTime() + 1000);
  }
  return res.length ? res : [[new Date(start), new Date(end)]];
}

// --- Attribution par agent RingOver ---
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }

// Nom lisible de l'agent, en testant les emplacements possibles d'un appel RingOver.
function agentName(c) {
  var u = c.user || c.agent || c.owner || c.from_user || c.member || null;
  if (u && typeof u === 'object') {
    var nm = u.concat_name
      || ((u.firstname || u.first_name || '') + ' ' + (u.lastname || u.last_name || '')).trim()
      || u.name || u.email || (u.user_id != null ? ('user ' + u.user_id) : '');
    if (nm) return String(nm).trim();
  }
  var flat = c.user_name || c.agent_name || c.username || c.owner_name || c.member_name || null;
  if (flat) return String(flat).trim();
  var id = (c.user_id != null) ? c.user_id : (u && u.user_id != null ? u.user_id : null);
  return id != null ? ('user ' + id) : '';
}
// Correspondance sur le nom de famille (INGRASSIA / LOPEZ) puis le prénom.
function bucketOf(name) {
  var n = norm(name);
  if (!n) return 'autre';
  if (n.indexOf('ingrassia') >= 0 || n.indexOf('paul') >= 0) return 'paul';
  if (n.indexOf('lopez') >= 0 || n.indexOf('aurelie') >= 0) return 'aurelie';
  return 'autre';
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
  var direction = (q.direction === 'in' || q.direction === 'all') ? q.direction : 'out';
  var period = (q.period === '30d' || q.period === 'ytd') ? q.period : '7d';
  var end = new Date();
  var start;
  if (period === 'ytd') start = new Date(end.getFullYear(), 0, 1);
  else if (period === '30d') start = new Date(end.getTime() - 30 * 86400000);
  else start = new Date(end.getTime() - 7 * 86400000);

  var calls = [];
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);
  try {
    var wins = windows(start, end, 15);
    for (var wi = 0; wi < wins.length; wi++) {
      var ws = wins[wi][0], we = wins[wi][1];
      var offset = 0, pageSize = 1000, pages = 0, maxPages = 20;
      while (pages < maxPages) {
        pages++;
        var url = 'https://public-api.ringover.com/v2/calls'
          + '?start_date=' + encodeURIComponent(ws.toISOString())
          + '&end_date=' + encodeURIComponent(we.toISOString())
          + '&limit_count=' + pageSize + '&limit_offset=' + offset;
        var res = await fetch(url, { headers: { 'Authorization': key }, signal: controller.signal });
        if (res.status === 204) break;
        var raw = await res.text();
        var data; try { data = JSON.parse(raw); } catch (e) { data = null; }
        if (!res.ok) {
          clearTimeout(tid);
          var detail = '';
          if (data && typeof data === 'object') detail = data.detail || data.message || data.error || data.title || JSON.stringify(data);
          else if (data) detail = String(data);
          else detail = raw.slice(0, 200);
          var upstreamAuth = (res.status === 401 || res.status === 403);
          var code = upstreamAuth ? 502 : res.status;
          var hint = upstreamAuth ? ' \u2014 la cl\u00e9 API RingOver n\'a pas les droits sur les appels, ou ne couvre pas les utilisateurs concern\u00e9s.' : '';
          return { statusCode: code, headers, body: JSON.stringify({ error: 'RingOver (' + res.status + ') : ' + detail + hint }) };
        }
        var list = (data && (data.call_list || data.calls || data.list)) || [];
        calls = calls.concat(list);
        var total = data ? (data.total_call_count != null ? data.total_call_count : data.call_list_count) : null;
        offset += pageSize;
        if (list.length < pageSize || (total != null && (offset >= total))) break;
      }
    }
    clearTimeout(tid);
  } catch (e) {
    clearTimeout(tid);
    var m = e.name === 'AbortError' ? 'Délai dépassé — réduisez la période (l\'historique annuel peut être volumineux).' : ('RingOver injoignable : ' + e.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: m }) };
  }

  var scoped = (direction === 'all') ? calls : calls.filter(function (c) {
    var d = dirOf(c);
    return direction === 'out' ? (d.indexOf('out') >= 0) : (d.indexOf('in') >= 0);
  });

  // attribution par agent
  scoped.forEach(function (c) { c._bucket = bucketOf(agentName(c)); });

  // Bloc d'indicateurs pour un sous-ensemble d'appels (structure identique à l'ancienne réponse)
  function kpi(sub) {
    var appels = sub.length;
    var decroches = sub.filter(isConversation).length;
    var pitchs = sub.filter(function (c) { return inCall(c) >= 90; }).length;
    var bm = {};
    sub.forEach(function (c) {
      var ym = monthOf(c);
      if (!ym) return;
      if (!bm[ym]) bm[ym] = { ym: ym, appels: 0, decroches: 0, pitchs: 0 };
      bm[ym].appels++;
      if (isConversation(c)) bm[ym].decroches++;
      if (inCall(c) >= 90) bm[ym].pitchs++;
    });
    var byMonth = Object.keys(bm).sort().map(function (k) { return bm[k]; });
    return {
      appels: appels,
      decroches: decroches,
      pitchs: pitchs,
      taux_decroche: appels ? Math.round(decroches / appels * 100) : 0,
      taux_pitch_sur_decroche: decroches ? Math.round(pitchs / decroches * 100) : 0,
      byMonth: byMonth,
    };
  }

  var equipe = kpi(scoped);
  var paul = kpi(scoped.filter(function (c) { return c._bucket === 'paul'; }));
  var aurelie = kpi(scoped.filter(function (c) { return c._bucket === 'aurelie'; }));

  // Diagnostic : agents réellement détectés (pour vérifier/ajuster le mapping)
  var agents = {};
  scoped.forEach(function (c) { var nm = agentName(c) || 'inconnu'; agents[nm] = (agents[nm] || 0) + 1; });
  var sampleKeys = scoped.length ? Object.keys(scoped[0]) : [];

  return {
    statusCode: 200, headers, body: JSON.stringify({
      periode: { start: start.toISOString(), end: end.toISOString(), period: period, direction: direction },
      appels: equipe.appels,                 // niveau racine = Équipe (rétrocompatible)
      decroches: equipe.decroches,
      pitchs: equipe.pitchs,
      taux_decroche: equipe.taux_decroche,
      taux_pitch_sur_decroche: equipe.taux_pitch_sur_decroche,
      byMonth: equipe.byMonth,
      profils: { equipe: equipe, paul: paul, aurelie: aurelie },
      diag: { agents: agents, sample_keys: sampleKeys, has_user: !!(scoped[0] && scoped[0].user) },
    }),
  };
};
