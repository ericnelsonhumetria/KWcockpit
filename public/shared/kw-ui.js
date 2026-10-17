/* COCKPIT KW — Finitions d'interface communes au Cockpit et à Clap! (public/shared/kw-ui.js)
   Additif : une seule ligne <script> (index.html ET clap/index.html), après les autres modules, avant session-restore.js.
   Retour arrière : retirer la ligne. Aucune donnée, aucun droit, aucun enregistrement n'est touché : présentation seulement.
   1. FRISE « CYCLE DE VIE » : dépliée sur le Tableau de bord (selon votre choix « Réduire / Afficher », comme avant), repliée sur une seule ligne
      dans les autres onglets et sur smartphone, où elle repoussait le contenu de 200 à 900 px. « Afficher » la déplie pour la session.
   2. EN-TÊTE QUI SE COMPACTE au défilement (Cockpit) : logo, photo et sous-titre réduits ; sur smartphone l'identité se replie. Il reste collant.
   3. CONTRÔLES HOMOGÈNES : boutons, champs, listes, cases et tableaux ont la même hauteur, les mêmes angles, un survol et un état « focus » nets ;
      chiffres alignés dans les tableaux ; lignes de tableau surlignées au survol.
   4. SMARTPHONE : les tableaux trop larges défilent dans leur cadre (au lieu d'élargir toute la page) ; filtres et tuiles chiffrées en grille ;
      cibles tactiles d'au moins 36 px.
   5. CONFORT : marge basse pour que le bouton rond « + » ne cache plus la dernière ligne ; bouton « ↑ Haut de page » sur les pages longues. */
(function(){
  'use strict';
  if (window.__kwUi) return; window.__kwUi = true;
  var B = '#560A0F', O = '#EFB810', CLAP = !!document.querySelector('.clap-bar') || /\/clap\//.test(location.pathname);
  var CSS = ''
    /* 3. contrôles */
    + 'html{scroll-behavior:smooth;}'
    + '::selection{background:rgba(239,184,16,.35);}'
    + '#view .panel{border-radius:12px;border-color:rgba(86,10,15,.12);box-shadow:0 1px 2px rgba(26,20,22,.04);}'
    + '.add-btn{border-radius:8px;min-height:34px;transition:background-color .15s,box-shadow .15s,transform .05s,filter .15s;display:inline-flex;align-items:center;justify-content:center;gap:6px;line-height:1.2;vertical-align:middle;}'
    + '.add-btn:hover:not(:disabled){filter:brightness(1.12);box-shadow:0 2px 8px rgba(86,10,15,.18);}'
    + '.add-btn.ghost:hover:not(:disabled){filter:none;background:#faf6f0;border-color:' + B + ';box-shadow:none;}'
    + '.add-btn:active:not(:disabled){transform:translateY(1px);}'
    + '.add-btn:disabled,.add-btn[aria-disabled="true"]{opacity:.5;cursor:not-allowed;box-shadow:none;}'
    + '.add-btn.sm{min-height:28px;border-radius:7px;}'
    + '#view input[type=text],#view input[type=email],#view input[type=number],#view input[type=date],#view input[type=search],#view input[type=time],#view input:not([type]),#view select,#view textarea'
    +   '{border:1px solid rgba(86,10,15,.22);border-radius:8px;background-color:#fff;font-family:inherit;transition:border-color .15s,box-shadow .15s;}'
    + '#view input:hover:not(:disabled):not([type=checkbox]):not([type=radio]):not([type=range]),#view select:hover:not(:disabled),#view textarea:hover:not(:disabled){border-color:rgba(86,10,15,.45);}'
    + '#view input:focus:not([type=checkbox]):not([type=radio]):not([type=range]),#view select:focus,#view textarea:focus{outline:none;border-color:' + B + ';box-shadow:0 0 0 3px rgba(239,184,16,.35);}'
    + '#view select{min-height:34px;cursor:pointer;}'
    + '#view [style*="display:flex"] > select,#view [style*="display: flex"] > select,#view [style*="display:flex"] > label > select{margin-bottom:0;}'
    + '#view input[type=checkbox],#view input[type=radio]{accent-color:' + B + ';width:16px;height:16px;vertical-align:-3px;cursor:pointer;}'
    + '#view td{font-variant-numeric:tabular-nums;}'
    + '#view table tbody tr:hover > td{background-color:rgba(239,184,16,.07);}'
    + '#view .pill{border-radius:999px;}'
    + '#view .sec-note{max-width:900px;}'
    /* 5. confort */
    + (CLAP ? '#view{padding-bottom:110px;}' : '#app .wrap{padding-bottom:110px;}')
    + '#kwTop{all:unset;box-sizing:border-box;position:fixed;left:16px;bottom:18px;z-index:9000;cursor:pointer;background:#fff;color:' + B + ';border:1px solid rgba(86,10,15,.25);border-radius:999px;padding:8px 14px;font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 4px 14px rgba(26,20,22,.14);opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .2s,transform .2s;}'
    + '#kwTop.on{opacity:1;transform:none;pointer-events:auto;}'
    + '#kwTop:hover{background:' + B + ';color:#fff;}'
    + '#kwTop:focus-visible{outline:3px solid ' + O + ';outline-offset:2px;}'
    /* 1. frise repliée : une ligne fine */
    + '#lifecycle.lc-collapsed .lc-inner{padding-top:6px;padding-bottom:6px;}'
    + '#lifecycle.lc-collapsed .lc-head-label{font-size:10.5px;opacity:.9;}'
    + '#lifecycle .lc-toggle{min-height:28px;}'
    + '#lifecycle.lc-collapsed .kwLcMine{display:inline;}'
    + '.kwLcMine{display:none;margin-left:10px;font-weight:600;font-size:11.5px;letter-spacing:0;text-transform:none;color:rgba(255,255,255,.85);}'
    /* 2. en-tête compact au défilement (Cockpit) */
    + '#app header .head-inner,#app header .kw-logo.sm,#app header .kw-avatar{transition:padding .2s,width .2s,height .2s;}'
    + 'body.kw-scrolled #app header .head-inner{padding-top:5px;padding-bottom:4px;}'
    + 'body.kw-scrolled #app header .kw-logo.sm,body.kw-scrolled #app header .kw-avatar{width:36px;height:36px;}'
    + 'body.kw-scrolled #app header .kw-avatar-initials{font-size:14px;}'
    + 'body.kw-scrolled #app header .kw-avatar-edit{display:none;}'
    + 'body.kw-scrolled #app header .brand .sub,body.kw-scrolled #app header .head-home{display:none;}'
    /* 4. smartphone */
    + '.kw-tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;}'
    + '.kw-tscroll > table{min-width:100%;}'
    + '@media (max-width:640px){'
    +   '.add-btn{min-height:36px;}'
    +   '#view select{max-width:100%;}'
    +   'body.kw-scrolled #app header .head-right{display:none;}'
    +   '#app header .brand .sub{display:none;}'
    +   '#kwTop{left:12px;bottom:14px;}'
    +   '.kwLcMine{display:none !important;}'
    +   '#view div[style*="min-width:118px"],#view div[style*="min-width:100px"][style*="background:#560A0F"]{flex:1 1 calc(50% - 4px) !important;min-width:0 !important;}'   /* tuiles chiffrées des actions : 2 × 2 */
    + '}';
  function addCss(){ if (document.getElementById('kwUiCss')) return; var s = document.createElement('style'); s.id = 'kwUiCss'; s.textContent = CSS; document.head.appendChild(s); }

  /* ---------- 1. frise Cycle de vie ---------- */
  var SS = 'kw:lc:open';   /* « Afficher » hors Tableau de bord ou sur smartphone : vaut pour la session */
  function mobile(){ return window.matchMedia ? window.matchMedia('(max-width:640px)').matches : window.innerWidth <= 640; }
  function tab(){ try { return typeof CURRENT_TAB !== 'undefined' ? CURRENT_TAB : 'dash'; } catch(e){ return 'dash'; } }
  function compactCtx(){ return tab() !== 'dash' || mobile(); }
  function prefDash(){ try { return localStorage.getItem('kw:lifecycle:collapsed') === '1'; } catch(e){ return false; } }
  function openSession(){ try { return sessionStorage.getItem(SS) === '1'; } catch(e){ return false; } }
  function mineLabel(){
    var lc = document.getElementById('lifecycle'); if (!lc) return;
    var head = lc.querySelector('.lc-head-label'); if (!head) return;
    var span = head.querySelector('.kwLcMine'); if (!span){ span = document.createElement('span'); span.className = 'kwLcMine'; head.appendChild(span); }
    var mine = [].map.call(lc.querySelectorAll('.lc-step.mine .lc-name'), function(x){ return x.textContent.trim(); });
    span.textContent = mine.length ? '· vous : ' + mine.slice(0, 3).join(', ') + (mine.length > 3 ? '…' : '') : '';
  }
  function applyLc(){
    var lc = document.getElementById('lifecycle'); if (!lc) return;
    var collapsed = compactCtx() ? !openSession() : prefDash();
    lc.classList.toggle('lc-collapsed', collapsed);
    try { if (typeof kwLifecycleSyncBtn === 'function') kwLifecycleSyncBtn(); } catch(e){}
    mineLabel();
  }
  function hookLc(){
    if (typeof kwLifecycleToggle === 'function' && !kwLifecycleToggle.__kwUi){
      var _t = kwLifecycleToggle;
      kwLifecycleToggle = function(){
        if (!compactCtx()) return _t.apply(this, arguments);   /* Tableau de bord sur ordinateur : choix mémorisé, comme avant */
        var lc = document.getElementById('lifecycle'); if (!lc) return;
        var collapsed = lc.classList.toggle('lc-collapsed');
        try { sessionStorage.setItem(SS, collapsed ? '0' : '1'); } catch(e){}
        try { if (typeof kwLifecycleSyncBtn === 'function') kwLifecycleSyncBtn(); } catch(e){}
      };
      kwLifecycleToggle.__kwUi = true; window.kwLifecycleToggle = kwLifecycleToggle;
    }
    if (typeof renderTab === 'function' && !renderTab.__kwUi){
      var _r = renderTab;
      renderTab = function(){ var out = _r.apply(this, arguments); try { applyLc(); } catch(e){} return out; };
      renderTab.__kwUi = true;
    }
  }

  /* ---------- 2. en-tête compact + 5. haut de page ---------- */
  var topBtn = null, ticking = false;
  function onScroll(){
    if (ticking) return; ticking = true;
    (window.requestAnimationFrame || setTimeout)(function(){
      ticking = false; var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      if (!CLAP) document.body.classList.toggle('kw-scrolled', y > 60);
      if (!topBtn){
        topBtn = document.createElement('button'); topBtn.id = 'kwTop'; topBtn.type = 'button'; topBtn.textContent = '↑ Haut de page'; topBtn.setAttribute('aria-label', 'Revenir en haut de la page');
        topBtn.addEventListener('click', function(){ try { window.scrollTo({ top:0, behavior:'smooth' }); } catch(e){ window.scrollTo(0, 0); } var f = document.querySelector('#tabs .tab.active, #clapNav .kw-subtab.on'); if (f) try { f.focus({ preventScroll:true }); } catch(e){} });
        document.body.appendChild(topBtn);
      }
      topBtn.classList.toggle('on', y > window.innerHeight * 1.5);
    });
  }

  /* ---------- 4. tableaux larges sur petit écran ---------- */
  var tmr = null;
  function wrapTables(){
    if (window.innerWidth > 900) return;
    var v = document.getElementById('view'); if (!v) return;
    [].forEach.call(v.querySelectorAll('table'), function(t){
      var p = t.parentElement; if (!p || p.classList.contains('kw-tscroll')) return;
      if (t.closest('.kw-tscroll')) return;
      var n = 0, hr = t.querySelector('thead tr') || t.querySelector('tr'); if (hr) [].forEach.call(hr.children, function(c){ if (c.offsetParent !== null || c.style.display !== 'none') n += (c.colSpan || 1); });
      var need = n >= 5 ? n * 105 : 0;   /* au moins ~105 px par colonne : sinon les listes et cases s'écrasent */
      if (t.scrollWidth <= p.clientWidth + 2 && need <= p.clientWidth) return;
      if (need > p.clientWidth) t.style.minWidth = need + 'px';
      if (/(auto|scroll)/.test(window.getComputedStyle(p).overflowX)) return;   /* déjà dans un cadre défilant */
      var w = document.createElement('div'); w.className = 'kw-tscroll'; p.insertBefore(w, t); w.appendChild(t);
    });
  }
  function watch(){
    var v = document.getElementById('view'); if (!v || !window.MutationObserver) return;
    new MutationObserver(function(){ clearTimeout(tmr); tmr = setTimeout(function(){ try { wrapTables(); mineLabel(); } catch(e){} }, 150); }).observe(v, { childList:true, subtree:true });
  }

  function init(){
    addCss(); hookLc(); applyLc(); watch(); wrapTables();
    window.addEventListener('scroll', onScroll, { passive:true });
    window.addEventListener('resize', function(){ clearTimeout(tmr); tmr = setTimeout(function(){ applyLc(); wrapTables(); }, 200); });
    onScroll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.kwUi = { lifecycle:applyLc, tables:wrapTables };
})();
