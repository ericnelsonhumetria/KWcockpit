/* COCKPIT KW — Clap! : notifications « actions en retard » sur le téléphone (public/shared/clap-push.js) — v2 : resynchronisation complète à chaque ouverture
   Additif : une seule ligne <script> dans clap/index.html, après clap-badge.js. Retour arrière : retirer la ligne.
   · Bouton cloche dans l'en-tête de Clap! : « Activer les notifications » → autorisation du navigateur, abonnement de CE téléphone.
   · Ensuite, chaque changement d'une de MES actions (statut, échéance, pilote, archivage) met à jour les notifications en quelques secondes,
     même Clap! fermée : une notification silencieuse par action en retard ; sur Android, le chiffre de l'icône suit (selon le téléphone :
     chiffre ou simple point). Passage automatique peu après minuit pour les échéances qui viennent d'expirer.
   · Toucher une notification ouvre Clap! sur la feuille Actions. La cloche permet aussi de désactiver.
   Prérequis : sql/push_actions.sql exécuté ; fonction netlify/functions/push-actions.js déployée. */
(function(){
  'use strict';
  if (window.__kwClapPush) return; window.__kwClapPush = true;
  var API = '/api/push-actions', SW = '/clap/sw.js', SCOPE = '/clap/', B = '#560A0F', O = '#EFB810';
  var ST = { reg:null, sub:null, busy:false, synced:false };
  function db(){ try { return (typeof SB !== 'undefined' && SB) ? SB : null; } catch(e){ return null; } }
  function sess(){ try { return (typeof SB_SESSION !== 'undefined' && SB_SESSION) ? SB_SESSION : null; } catch(e){ return null; } }
  function toast(m, k){ try { if (window.kwToast) return window.kwToast(m, k || 'info', 6000); } catch(e){} }
  function supported(){ return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext !== false; }
  function b64(s){ var p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  function tok(){ var s = sess(); return s && s.access_token; }
  async function api(method, body){
    var r = await fetch(API, { method: method, headers: Object.assign({ 'Authorization': 'Bearer ' + tok() }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await r.json(); } catch(e){}
    if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j || {};
  }

  /* ---------- bouton cloche ---------- */
  var CSS = '#kwPushBtn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:8px;'
    + 'border:1px solid rgba(255,255,255,.5);color:#fff;font:600 12.5px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin-right:8px;white-space:nowrap;}'
    + '#kwPushBtn:hover{background:rgba(255,255,255,.12);}#kwPushBtn:focus-visible{outline:3px solid ' + O + ';outline-offset:2px;}'
    + '#kwPushBtn[data-on="1"]{border-color:' + O + ';}#kwPushBtn svg{width:16px;height:16px;flex:0 0 auto;}'
    + '#kwPushBtn .s{display:none;}'
    + '@media (max-width:640px){#kwPushBtn .t{display:none;}#kwPushBtn[data-on="0"] .s{display:inline;}#kwPushBtn{padding:0 8px;}}';
  var BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  var BELL_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>';
  function button(){
    var b = document.getElementById('kwPushBtn'); if (b) return b;
    var out = [].slice.call(document.querySelectorAll('.clap-head button')).filter(function(x){ return /déconnecter/i.test(x.textContent); })[0];
    if (!out) return null;
    if (!document.getElementById('kwPushCss')){ var s = document.createElement('style'); s.id = 'kwPushCss'; s.textContent = CSS; document.head.appendChild(s); }
    b = document.createElement('button'); b.id = 'kwPushBtn'; b.type = 'button';
    b.addEventListener('click', toggle);
    out.parentNode.insertBefore(b, out);
    return b;
  }
  function paint(){
    var b = button(); if (!b) return;
    if (!supported()){ b.style.display = 'none'; return; }
    var on = !!ST.sub && Notification.permission === 'granted', denied = Notification.permission === 'denied';
    b.setAttribute('data-on', on ? '1' : '0');
    b.innerHTML = (on ? BELL : BELL_OFF) + '<span class="t">' + (on ? 'Notifications actives' : (denied ? 'Notifications bloquées' : 'Activer les notifications')) + '</span><span class="s">' + (denied ? 'Bloquées' : 'Activer') + '</span>';
    b.title = on ? 'Ce téléphone reçoit tes actions en retard (cliquer pour désactiver)' : (denied ? 'Le navigateur bloque les notifications de Clap! : à réautoriser dans ses réglages du site' : 'Recevoir sur ce téléphone tes actions en retard, mises à jour en temps réel');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  async function register(){
    if (ST.reg) return ST.reg;
    ST.reg = await navigator.serviceWorker.register(SW, { scope: SCOPE });
    return ST.reg;
  }
  async function save(sub){
    var j = sub.toJSON ? sub.toJSON() : sub, k = (j && j.keys) || {};
    var r = await db().rpc('push_abonner', { p_endpoint: j.endpoint, p_p256dh: k.p256dh, p_auth: k.auth, p_ua: navigator.userAgent.slice(0, 300) });
    if (r && r.error) throw new Error(r.error.message);
  }
  async function enable(){
    var perm = await Notification.requestPermission();
    if (perm !== 'granted'){ paint(); toast(perm === 'denied' ? 'Notifications refusées. Pour les réactiver : menu ⋮ de Chrome › Paramètres › Paramètres des sites › Notifications.' : 'Activation annulée.', 'warn'); return; }
    var reg = await register();
    var key = (await api('GET')).publicKey; if (!key) throw new Error('clé d’envoi indisponible');
    var sub = await reg.pushManager.getSubscription();
    if (sub && sub.options && sub.options.applicationServerKey){
      var cur = new Uint8Array(sub.options.applicationServerKey), want = b64(key);
      if (cur.length !== want.length || cur.some(function(v, i){ return v !== want[i]; })){ await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
    await save(sub); ST.sub = sub; paint();
    var r = await api('POST', { action: 'sync', force: true });
    toast('Notifications activées sur ce téléphone' + (r && r.envoyes ? ' : tes actions en retard s’affichent.' : '.'), 'ok');
  }
  async function disable(){
    var ok = true; try { ok = window.confirm('Ne plus recevoir les actions en retard sur ce téléphone ?'); } catch(e){}
    if (!ok) return;
    var sub = ST.sub, ep = sub && sub.endpoint;
    try { if (sub) await sub.unsubscribe(); } catch(e){}
    try { if (ep) await db().from('push_abonnements').delete().eq('endpoint', ep); } catch(e){}
    try { var reg = await register(); (await reg.getNotifications()).forEach(function(n){ if (/^clap-/.test(n.tag || '')) n.close(); }); } catch(e){}
    ST.sub = null; paint(); toast('Notifications désactivées sur ce téléphone.', 'info');
  }
  async function toggle(){
    if (ST.busy) return; ST.busy = true;
    try { if (ST.sub && Notification.permission === 'granted') await disable(); else await enable(); }
    catch(e){ toast('Notifications : ' + ((e && e.message) || e), 'err'); }
    finally { ST.busy = false; paint(); }
  }

  /* À l'ouverture : abonnement existant → on le re-déclare (il peut avoir été renouvelé par le navigateur) et on resynchronise */
  async function boot(){
    if (!supported()){ paint(); return; }
    try {
      var reg = await register();
      try { await reg.update(); } catch(e){}   /* prend tout de suite la dernière version du service worker */
      ST.sub = await reg.pushManager.getSubscription();
      try { (await reg.getNotifications({ tag: 'clap-ok' })).forEach(function(n){ n.close(); }); } catch(e){}   /* « plus aucune action en retard » : lue, on la retire */
      paint();
      if (ST.sub && Notification.permission === 'granted' && !ST.synced){ ST.synced = true; await save(ST.sub); await resync(); }
    } catch(e){ paint(); if (window.console) console.warn('clap-push', e); }
  }

  /* À chaque ouverture ou retour sur Clap! : on renvoie l'état complet au téléphone (force), pour rétablir une notification balayée
     et garder le chiffre de l'icône égal à la pastille de l'application. Au plus une fois par minute. */
  var lastSync = 0;
  async function resync(){
    if (!ST.sub || Notification.permission !== 'granted' || Date.now() - lastSync < 60000) return;
    lastSync = Date.now();
    try { await api('POST', { action: 'sync', force: true }); } catch(e){}
  }
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) resync(); });

  /* Toucher une notification : ouvrir la feuille Actions */
  function openActions(){ try { if (typeof window.paSetSheet === 'function') window.paSetSheet('actions'); } catch(e){} }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function(e){ if (e.data && e.data.t === 'ouvrir-actions') openActions(); });

  function init(){
    var tries = 0, w = setInterval(function(){
      tries++;
      if (sess() && db() && button()){
        clearInterval(w); boot();
        if (/[?&]feuille=actions\b/.test(location.search)){
          var n = 0, t = setInterval(function(){ n++; if (typeof window.paSetSheet === 'function' && document.querySelector('.kw-subtab')){ clearInterval(t); openActions(); try { history.replaceState(null, '', location.pathname); } catch(e){} } else if (n > 40) clearInterval(t); }, 250);
        }
      } else if (tries > 600) clearInterval(w);
    }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.kwClapPush = { state: ST, enable: enable, disable: disable, boot: boot };
})();
