/* COCKPIT KW — Synthèse et préparation des comptes rendus en arrière-plan (public/shared/cr-ia-async.js)
   Problème corrigé : « Le CR ne se génère pas » — /api/cr-ia répondait 502. Une fonction Netlify synchrone est coupée au bout de 10 à 30 s ;
   la synthèse d'une réunion longue (par exemple un Codir d'une heure) dépasse ce délai.
   Solution (la même que Cerebro) : la page crée un travail dans cr_ia_jobs, déclenche la fonction d'arrière-plan cr-ia-background (jusqu'à 15 min),
   puis relit le résultat. Le module cr-actions.js n'est PAS modifié : ce module intercepte uniquement les appels POST /api/cr-ia en mode
   « synthese » ou « prep », et rend à cr-actions.js une réponse de la même forme que celle de cr-ia.js.
   Repli : si la table cr_ia_jobs n'existe pas encore (SQL non exécuté), si la fonction d'arrière-plan n'est pas déployée, ou si le travail n'est
   jamais pris en charge, l'appel part comme avant vers /api/cr-ia. Rien ne peut donc être pire qu'avant.
   À charger APRÈS cr-actions.js (une ligne <script> dans index.html). */
(function(){
  if (window.__kwCrAsync) return;                                    /* idempotent : jamais deux enveloppes */
  window.__kwCrAsync = true;
  var CFG = window.KW_CR_ASYNC || {};
  var POLL_MS = CFG.pollMs || 2500, MAX_MS = CFG.maxMs || 8 * 60 * 1000, PENDING_MS = CFG.pendingMs || 25000;
  var _fetch = window.fetch;
  if (typeof _fetch !== 'function') return;

  function isCrIa(url, init){
    var u = String((url && url.url) || url || '');
    return /\/api\/cr-ia(\?|$)/.test(u) && !!init && String(init.method || 'GET').toUpperCase() === 'POST';
  }
  function resp(status, obj){ return new Response(JSON.stringify(obj), { status: status, headers: { 'Content-Type': 'application/json' } }); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  /* Retourne une Response (succès ou erreur lisible), ou null = « utiliser l'appel synchrone d'avant » */
  async function viaJob(init){
    var body; try { body = JSON.parse(init.body); } catch(e){ return null; }
    if (!body || (body.mode !== 'synthese' && body.mode !== 'prep')) return null;
    if (typeof SB === 'undefined' || !SB || typeof SB_SESSION === 'undefined' || !SB_SESSION || !SB_SESSION.access_token) return null;

    var ins; try { ins = await SB.from('cr_ia_jobs').insert({ request: body }).select('id').single(); } catch(e){ return null; }
    if (!ins || ins.error || !ins.data) return null;                 /* table absente (cr_ia_jobs.sql pas encore exécuté) */
    var id = ins.data.id, trig;
    try {
      trig = await _fetch.call(window, '/.netlify/functions/cr-ia-background', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SB_SESSION.access_token },
        body: JSON.stringify({ job_id: id })
      });
    } catch(e){ return null; }
    if (!trig || !(trig.status === 202 || trig.ok)) return null;     /* fonction d'arrière-plan pas déployée */

    var t0 = Date.now();
    while (Date.now() - t0 < MAX_MS){
      await sleep(POLL_MS);
      var q; try { q = await SB.from('cr_ia_jobs').select('status,result,error').eq('id', id).maybeSingle(); } catch(e){ continue; }
      if (!q || q.error || !q.data) continue;
      if (q.data.status === 'done') return resp(200, q.data.result || {});
      if (q.data.status === 'error') return resp(502, { error: q.data.error || 'travail en erreur' });
      if (q.data.status === 'pending' && Date.now() - t0 > PENDING_MS) return null;   /* jamais pris en charge : repli synchrone */
    }
    return resp(504, { error: 'délai dépassé (' + Math.round(MAX_MS / 60000) + ' min) — la fonction d\u2019arrière-plan n\u2019a pas répondu' });
  }

  /* Le signal d'annulation de cr-actions.js (45 s) n'est volontairement PAS appliqué au travail d'arrière-plan : c'est précisément ce délai
     qui empêchait une réunion longue d'aboutir. Il reste appliqué à l'appel synchrone de repli. */
  window.fetch = function(url, init){
    if (!isCrIa(url, init)) return _fetch.apply(this, arguments);
    var args = arguments, self = this;
    return viaJob(init).catch(function(){ return null; }).then(function(r){ return r || _fetch.apply(self, args); });
  };
})();
