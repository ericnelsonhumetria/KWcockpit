/* COCKPIT KW — Tableau de bord plus lisible (public/shared/dashboard-ux.js)
   Additif : une seule ligne <script> dans index.html, APRÈS admin-ux.js (et avant session-restore.js). Retour arrière : retirer la ligne.
   Aucune donnée ni aucun calcul ne change : seulement la mise en page et l'affichage.
   1. ALIGNEMENT : l'en-tête, les onglets, le bandeau « cycle de vie » et la barre « Mettre à jour… » étaient limités à 1 100 px, le contenu à rien :
      sur un écran large ils ne tombaient jamais sur les mêmes bords. Tout partage maintenant la même largeur (1 600 px au plus, centrée).
   2. ÉCRANS LARGES : cette largeur maximale évite les lignes de 2 000 px ; les textes d'aide sont plafonnés à une largeur de lecture confortable.
   3. BOUTON « + Action » : devient une pastille « + » (52 px) qui s'élargit au survol ou au clavier ; la page garde de la marge en bas pour qu'il ne cache plus la fin du contenu.
   4. CHARGEMENTS : les cartes en attente (CA, EBITDA, Trésorerie, Charge salariés, Vitalité) montrent une ligne qui « respire » au lieu d'un « … » figé ;
      si la réponse tarde (15 s), un bouton « Réessayer » apparaît.
   5. DOUBLON : « Synthèse financière · Indicateurs clés » répétait CA, EBITDA et trésorerie déjà affichés en haut. Les cartes « Réalisé » et « Atterrissage » sont
      repliées dans un bloc « détail » dont le résumé garde les 4 chiffres clés (un clic les déplie ; le choix est mémorisé). Trésorerie et encours restent visibles.
   6. AVERTISSEMENTS : les « ⚠ … ligne(s) carnet échue(s) … exclue(s) » et « ⚠ données vieilles de N j » sortent du paragraphe et deviennent un encadré visible,
      toujours affiché, même quand le détail est replié.
   7. STABILITÉ : la page redessinait la synthèse financière ~5 fois par SECONDE en permanence (son propre observateur réagissait à ses propres modifications).
      Invisible tant que le contenu était identique, mais chaque redessin remplaçait les éléments (clics perdus) et faisait sauter l'écran dès qu'un bloc était replié.
      Le repli se fait donc dans le même instant que le redessin (jamais d'état « déplié » affiché), et un redessin n'est refait que si quelque chose a réellement changé. */
(function(){
  'use strict';
  if (window.__kwDashUx) return; window.__kwDashUx = true;
  var LS_DET = 'kw:dash:det', SLOW_MS = 15000;
  var CSS = ''
    + ':root{--kw-max:1600px;}'
    + '.head-inner,.tabs,.lc-inner,.wrap{max-width:var(--kw-max) !important;}'
    + '#kwGlobalRefreshBar{max-width:var(--kw-max) !important;padding:0 20px !important;box-sizing:border-box;}'
    + '.wrap{padding-bottom:96px !important;}'
    + '.sec-note{max-width:110ch;}div.edit-hint{max-width:120ch;}'
    + '#paFab{width:52px !important;height:52px !important;padding:0 !important;font-size:0 !important;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;}'
    + '#paFab:not([style*="display: none"]){display:inline-flex !important;}'
    + '#paFab::before{content:"+";font-size:30px;line-height:1;font-weight:400;}'
    + '#paFab:hover,#paFab:focus-visible{width:auto !important;padding:0 18px 0 16px !important;}'
    + '#paFab:hover::after,#paFab:focus-visible::after{content:"Action";font-size:14px;font-weight:600;margin-left:8px;}'
    + '@keyframes kwSk{0%{background-position:200% 0;}100%{background-position:-200% 0;}}'
    + '[data-kwsk="1"] div[style*="font-size:26px"]{color:transparent !important;border-radius:6px;max-width:150px;background:linear-gradient(90deg,#ece7df 25%,#f6f2ec 50%,#ece7df 75%);background-size:200% 100%;animation:kwSk 1.3s linear infinite;}'
    + '.kwRetry{all:unset;cursor:pointer;margin-left:8px;font:600 12px system-ui,sans-serif;color:#560A0F;text-decoration:underline;}'
    + '.kwWarn{margin:12px 0;padding:10px 14px;background:rgba(178,34,34,.07);border-left:4px solid var(--signal,#b22222);border-radius:6px;font-size:13.5px;line-height:1.45;font-weight:700;color:#8a1f14;}'
    + 'details.kwDet{margin-top:14px;border:1px solid var(--line,#ddd);border-radius:8px;background:#fff;}'
    + 'details.kwDet>summary{cursor:pointer;padding:12px 14px;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;list-style:none;}'
    + 'details.kwDet>summary::-webkit-details-marker{display:none;}'
    + 'details.kwDet>summary::before{content:"\\25B8";color:#560A0F;}details.kwDet[open]>summary::before{content:"\\25BE";}'
    + '.kwDetT{font-weight:700;color:#560A0F;}.kwDetS{font-size:13px;color:#6b5b58;}'
    + 'details.kwDet>*:not(summary){margin-left:14px;margin-right:14px;}details.kwDet>*:last-child{margin-bottom:14px;}';
  function addCss(){ if (document.getElementById('kwDashCss')) return; var s = document.createElement('style'); s.id = 'kwDashCss'; s.textContent = CSS; document.head.appendChild(s); }

  /* ---------- 3. bouton « + Action » ---------- */
  function fab(){ var f = document.getElementById('paFab'); if (f && !f.getAttribute('aria-label')) f.setAttribute('aria-label', 'Nouvelle action'); }

  /* ---------- 4. chargements ---------- */
  var seen = {};
  function retryBtn(fn){
    var b = document.createElement('button'); b.type = 'button'; b.className = 'kwRetry'; b.textContent = '↻ Réessayer';
    b.addEventListener('click', function(){ try { if (typeof window[fn] === 'function') window[fn](); } catch(e){} }); return b;
  }
  function tick(now){
    now = now || Date.now();
    [['csCA', 'loadCockpitSynth'], ['csEbitda', 'loadCockpitSynth'], ['csTreso', 'loadCockpitSynth'], ['csCharge', 'loadCockpitSynth']].forEach(function(p){
      var z = document.getElementById(p[0]); if (!z){ delete seen[p[0]]; return; }
      var slow = !!z.querySelector('.kwRetry'), loading = /chargement/i.test(z.textContent) && !slow;
      if (loading){
        z.setAttribute('data-kwsk', '1'); if (!seen[p[0]]) seen[p[0]] = now;
        if (now - seen[p[0]] > SLOW_MS){
          var sub = z.querySelector('div > div:last-child'); if (sub) sub.textContent = 'Réponse lente…'; (sub || z).appendChild(retryBtn(p[1])); z.removeAttribute('data-kwsk');
        }
      } else if (!slow){ z.removeAttribute('data-kwsk'); delete seen[p[0]]; }
    });
    var v = document.getElementById('csVitalite');
    if (v){
      var hint = [].filter.call(v.querySelectorAll('.edit-hint'), function(h){ return /Chargement RingOver/i.test(h.textContent); })[0];
      if (hint && !hint.querySelector('.kwRetry')){
        if (!seen.vit) seen.vit = now;
        if (now - seen.vit > SLOW_MS){ hint.appendChild(retryBtn('loadVitalite')); }
      } else if (!hint){ delete seen.vit; }
    }
  }

  /* ---------- 5 + 6. synthèse financière : détail replié, avertissements en encadré ---------- */
  function reshape(){
    var sy = document.getElementById('finSynthZone'); if (!sy || sy.querySelector('details.kwDet')) return;
    var start = [].filter.call(sy.children, function(c){ return c.classList && c.classList.contains('sec-eyebrow') && /^\s*Réalisé/i.test(c.textContent); })[0];
    if (!start) return;
    var nodes = []; for (var n = start; n; n = n.nextElementSibling) nodes.push(n);
    var warns = []; nodes.forEach(function(nd){ [].forEach.call(nd.querySelectorAll('b'), function(b){ if (/^\s*\u26a0/.test(b.textContent)) warns.push(b); }); });
    function val(label){
      var res = ''; nodes.forEach(function(nd){ [].forEach.call(nd.querySelectorAll('.kpi'), function(k){
        var l = k.querySelector('.k-label'), v = k.querySelector('.k-val'); if (l && v && l.textContent.trim().toLowerCase() === label.toLowerCase()) res = v.textContent.trim(); }); });
      return res;
    }
    var parts = [['CA HT commandé', 'CA commandé'], ['EBITDA', 'EBITDA'], ['Atterrissage CA', 'Atterrissage CA'], ['Atterr. EBITDA', 'Atterr. EBITDA']]
      .map(function(p){ var v = val(p[0]); return v && v !== '—' ? p[1] + ' ' + v : ''; }).filter(Boolean);
    var det = document.createElement('details'); det.className = 'kwDet';
    try { if (localStorage.getItem(LS_DET) === '1') det.open = true; } catch(e){}
    var sum = document.createElement('summary'), t = document.createElement('span'), s = document.createElement('span');
    t.className = 'kwDetT'; t.textContent = 'Réalisé et atterrissage — détail'; s.className = 'kwDetS'; s.textContent = parts.join(' · ');
    sum.appendChild(t); sum.appendChild(s); det.appendChild(sum);
    sy.insertBefore(det, start); nodes.forEach(function(nd){ det.appendChild(nd); });
    det.addEventListener('toggle', function(){ try { localStorage.setItem(LS_DET, det.open ? '1' : '0'); } catch(e){} });
    warns.forEach(function(b){
      var w = document.createElement('div'); w.className = 'kwWarn'; w.setAttribute('role', 'note'); w.textContent = b.textContent.trim();
      sy.insertBefore(w, det); if (b.parentNode) b.parentNode.removeChild(b);
    });
  }

  /* ---------- 7. stabilité : repli immédiat + arrêt du rebouclage ---------- */
  var foreign = 0, lastAt = 0, lastSig = '', lastZone = null, mo = null, WRAPPED = false;
  function sig(){
    try { return JSON.stringify([window.FIN_CA_REALISE, window.FIN_PROJ_SCENARIO, window.FINANCE_OBJECTIF, (window.FIN_PROJ_ROWS || []).length, window.FIN_DIAG && window.FIN_DIAG.opex_ebitda]); }
    catch(e){ return String(Math.random()); }
  }
  function wrapRepaint(){
    if (WRAPPED || typeof window.finSynthRepaint !== 'function' || window.finSynthRepaint.__kwDash) return WRAPPED;
    var orig = window.finSynthRepaint, view = document.getElementById('view');
    if (window.MutationObserver && view){ mo = new MutationObserver(function(r){ foreign += r.length; }); mo.observe(view, { childList:true, subtree:true }); }
    var w = function(){
      if (mo) foreign += mo.takeRecords().length;                        /* modifications déjà faites dans ce même instant par l'appelant */
      var zone = document.getElementById('finSynthZone'), now = Date.now(), s = sig();
      /* Rien n'a changé hors du redessin lui-même (ni page, ni données) depuis moins de 1,5 s : c'est l'écho de son propre observateur -> on ne redessine pas. */
      if (mo && zone && zone === lastZone && foreign === 0 && s === lastSig && now - lastAt < 1500) return;
      foreign = 0; var r;
      try { r = orig.apply(this, arguments); }
      finally {
        try { reshape(); } catch(e){}                                      /* replié dans le même instant : l'écran ne montre jamais l'état déplié */
        if (mo) mo.takeRecords();                                          /* les modifications du redessin ne comptent pas comme des changements extérieurs */
        lastZone = document.getElementById('finSynthZone'); lastAt = Date.now(); lastSig = sig();
      }
      return r;
    };
    w.__kwDash = true; window.finSynthRepaint = w; WRAPPED = true; return true;
  }

  /* ---------- installation ---------- */
  var timer = null;
  function run(){ try { fab(); wrapRepaint(); if (!WRAPPED) reshape(); tick(); } catch(e){ if (window.console) console.error('dashboard-ux', e); } }
  function init(){
    addCss(); wrapRepaint(); run();
    if (window.MutationObserver){
      var v = document.getElementById('view');
      if (v) new MutationObserver(function(){ clearTimeout(timer); timer = setTimeout(run, 80); }).observe(v, { childList:true, subtree:true });
      new MutationObserver(function(){ fab(); }).observe(document.body, { childList:true });
    }
    setInterval(function(){ try { tick(); } catch(e){} }, 2000);
  }
  addCss();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.kwDashUx = { reshape:reshape, tick:tick, run:run, wrap:wrapRepaint };
})();
