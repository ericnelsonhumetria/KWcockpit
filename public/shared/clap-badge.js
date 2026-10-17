/* COCKPIT KW — Pastille rouge « actions en retard » sur Clap! (public/shared/clap-badge.js)
   Additif : une seule ligne <script> (index.html ET clap/index.html), après cr-actions.js, avant session-restore.js. Retour arrière : retirer la ligne.
   Sur le modèle de LinkedIn : un chiffre blanc sur fond rouge = le nombre de MES actions en retard (je suis pilote, échéance dépassée,
   statut À faire / En cours / En attente, non archivée). Rien ne s'affiche à 0. Au-delà de 99 : « 99+ ».
   Où : onglet Clap! du Cockpit · sous-onglet « Actions » (Cockpit et Clap!) · logo Clap! de l'application Clap! ·
        icône de l'application installée sur l'écran d'accueil / la barre des tâches, quand le navigateur le permet (API « App Badging »).
   Mise à jour : à la connexion, toutes les 3 minutes, au retour sur la page, et 2 s après une modification dans Clap!.
   Lecture seule : une requête de comptage sur « actions », dans la limite des droits de la base (RLS). */
(function(){
  'use strict';
  if (window.__kwClapBadge) return; window.__kwClapBadge = true;
  var RED = '#CC1016', COUNT = 0, MYPIL = null, MYUID = null, busy = false, last = 0, tmr = null;
  function db(){ try { return (typeof SB !== 'undefined' && SB) ? SB : null; } catch(e){ return null; } }
  function sess(){ try { return (typeof SB_SESSION !== 'undefined' && SB_SESSION) ? SB_SESSION : null; } catch(e){ return null; } }
  function today(){ var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  var CSS = ''
    /* l'attribut data-kwbadge porte le chiffre : le texte des onglets n'est jamais modifié (les autres modules le réécrivent) */
    + '[data-kwbadge]{position:relative;}'
    + '[data-kwbadge]::after{content:attr(data-kwbadge);position:absolute;top:2px;right:2px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:999px;'
    +   'background:' + RED + ';color:#fff;font:700 11px/18px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;letter-spacing:0;text-transform:none;'
    +   'box-shadow:0 0 0 2px #fff;pointer-events:none;animation:kwBadgeIn .25s ease-out;}'
    + '#tabs .tab[data-kwbadge]{padding-right:26px !important;}'
    + '.kw-subtab[data-kwbadge]{padding-right:28px !important;}'
    + '.clap-logo[data-kwbadge]{padding-right:24px;}'
    + '.clap-logo[data-kwbadge]::after{top:-4px;right:-2px;box-shadow:0 0 0 2px #560A0F;}'
    + '@keyframes kwBadgeIn{from{transform:scale(.4);opacity:0;}to{transform:none;opacity:1;}}';
  function addCss(){ if (document.getElementById('kwClapBadgeCss')) return; var s = document.createElement('style'); s.id = 'kwClapBadgeCss'; s.textContent = CSS; document.head.appendChild(s); }

  function targets(){
    return [].slice.call(document.querySelectorAll('#tabs .tab[data-tab="plandaction"], .kw-subtab[data-sheet="actions"], .clap-logo'));
  }
  function paint(){
    var txt = COUNT > 99 ? '99+' : String(COUNT), lab = COUNT + ' action' + (COUNT > 1 ? 's' : '') + ' en retard';
    targets().forEach(function(el){
      if (COUNT > 0){
        if (el.getAttribute('data-kwbadge') !== txt) el.setAttribute('data-kwbadge', txt);
        if (el.getAttribute('title') !== lab) el.setAttribute('title', lab + ' (dont tu es pilote)');
        el.setAttribute('aria-description', lab);
      } else if (el.hasAttribute('data-kwbadge')){ el.removeAttribute('data-kwbadge'); el.removeAttribute('aria-description'); if (/en retard/.test(el.getAttribute('title') || '')) el.removeAttribute('title'); }
    });
    try { if (navigator.setAppBadge){ if (COUNT > 0) navigator.setAppBadge(COUNT).catch(function(){}); else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(function(){}); } } catch(e){}
  }

  async function myPilote(){
    var s = sess(), uid = s && s.user && s.user.id, em = s && s.user && String(s.user.email || '').toLowerCase();
    if (!uid) return null;
    if (MYPIL && MYUID === uid) return MYPIL;
    MYUID = uid; MYPIL = null;
    var r = await db().from('action_pilotes').select('id,user_id,email');
    var rows = (r && r.data) || [];
    var p = rows.filter(function(x){ return x.user_id === uid; })[0] || rows.filter(function(x){ return em && String(x.email || '').toLowerCase() === em; })[0];
    MYPIL = p ? p.id : null; return MYPIL;
  }
  async function refresh(force){
    if (busy || !db() || !sess()) return;
    if (!force && Date.now() - last < 20000) return;
    busy = true; last = Date.now();
    try {
      var pid = await myPilote();
      if (!pid){ COUNT = 0; paint(); return; }
      var r = await db().from('actions').select('id,statut,echeance,archived_at,pilote_id').is('archived_at', null).eq('pilote_id', pid)
        .in('statut', ['a_faire', 'en_cours', 'en_attente']).lt('echeance', today());
      if (r && r.error) throw r.error;
      var t = today();
      COUNT = ((r && r.data) || []).filter(function(a){ return a && a.echeance && a.echeance < t && !a.archived_at && a.pilote_id === pid && /^(a_faire|en_cours|en_attente)$/.test(a.statut); }).length;
      paint();
    } catch(e){ /* silencieux : la pastille garde sa dernière valeur */ }
    finally { busy = false; }
  }
  function soon(){ clearTimeout(tmr); tmr = setTimeout(function(){ refresh(true); }, 2000); }

  function init(){
    addCss();
    /* les onglets sont redessinés souvent : on repose l'attribut à chaque fois (attribut seulement : aucune boucle avec les autres observateurs) */
    if (window.MutationObserver){
      var pt = null;
      new MutationObserver(function(){ clearTimeout(pt); pt = setTimeout(paint, 30); }).observe(document.body, { childList:true, subtree:true });
    }
    /* une modification dans Clap! (statut, échéance, archivage, enregistrement) : recompte 2 s plus tard */
    document.addEventListener('change', function(e){ if (e.target && e.target.closest && e.target.closest('#view')) soon(); }, true);
    document.addEventListener('click', function(e){ var b = e.target && e.target.closest && e.target.closest('#view button, .kw-dlg button, [role=dialog] button'); if (b) soon(); }, true);
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) refresh(false); });
    setInterval(function(){ refresh(true); }, 180000);
    /* attendre la connexion */
    var tries = 0, w = setInterval(function(){ tries++; if (sess() && db()){ clearInterval(w); refresh(true); } else if (tries > 600) clearInterval(w); }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.kwClapBadge = { refresh:function(){ return refresh(true); }, count:function(){ return COUNT; } };
})();
