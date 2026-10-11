/* COCKPIT KW — Ordre et mise en avant des onglets (public/shared/cockpit-tabs.js)
   Additif : une seule ligne <script> dans index.html, à placer APRÈS les autres modules (aic-espaces, obeya-admin, obeya).
   Il ne crée ni ne supprime aucun onglet : il les RÉORDONNE, MASQUE certains, et met en avant « Réunions & Rituels et Actions ».
   Les onglets sont ajoutés par plusieurs modules, parfois après coup (AIC, Obeya) : un observateur reclasse à chaque ajout.
   Pour réafficher un onglet masqué : le retirer de HIDDEN ci-dessous (les droits d'accès d'Admin ne sont pas modifiés). */
(function(){
  /* Ordre voulu, de gauche à droite. Un onglet absent pour un rôle (droits d'Admin) est simplement sauté. */
  var ORDER  = ['dash', 'obeya', 'aic', 'plandaction', 'cerebro', 'parcours', 'dojo', 'objectifs'];
  var LAST   = ['admin'];                      /* toujours en dernier, tout à droite */
  var HIDDEN = ['humetria', 'capbp'];          /* masqués pour le moment : Humetria, Bonnes pratiques */
  var FOCUS  = 'plandaction';                  /* titre mis en avant par une couleur distinctive */

  function css(){
    if (document.getElementById('kwTabsOrderStyle')) return;
    var s = document.createElement('style'); s.id = 'kwTabsOrderStyle';
    s.textContent = '.tabs .tab[hidden]{display:none !important;}'
      + '.tabs .tab[data-tab="' + FOCUS + '"]{background:#EFB810;color:#560A0F;font-weight:800;border-radius:10px 10px 0 0;padding:10px 16px;border-bottom-color:#560A0F;}'
      + '.tabs .tab[data-tab="' + FOCUS + '"]:hover{background:#f3ca4b;color:#3a070b;}'
      + '.tabs .tab[data-tab="' + FOCUS + '"].active{background:#560A0F;color:#EFB810;border-bottom-color:#EFB810;}'
      + '.tabs .tab[data-tab="admin"]{margin-left:auto;}';
    document.head.appendChild(s);
  }
  function rank(b){ var k = b.dataset.tab, i = ORDER.indexOf(k); if (i >= 0) return i; var j = LAST.indexOf(k); return j >= 0 ? 1000 + j : 100; }   /* inconnus : après les onglets listés, avant Admin */

  var obs = null, tmr = null;
  function watch(){ var t = document.getElementById('tabs'); if (t && window.MutationObserver){ if (!obs) obs = new MutationObserver(function(){ if (tmr) clearTimeout(tmr); tmr = setTimeout(apply, 0); }); obs.observe(t, { childList:true }); } }
  function apply(){
    var tabs = document.getElementById('tabs'); if (!tabs) return;
    if (obs) obs.disconnect();                                             /* nos propres déplacements ne doivent pas nous rappeler */
    try {
      css();
      var btns = [].slice.call(tabs.querySelectorAll('.tab[data-tab]'));
      var want = btns.map(function(b, i){ return { b:b, i:i }; }).sort(function(a, c){ return rank(a.b) - rank(c.b) || a.i - c.i; }).map(function(x){ return x.b; });
      var same = want.every(function(b, i){ return b === btns[i]; });
      if (!same) want.forEach(function(b){ tabs.appendChild(b); });
      btns.forEach(function(b){ b.hidden = HIDDEN.indexOf(b.dataset.tab) >= 0; });
    } finally { watch(); }
  }

  /* L'ordre est (ré)appliqué après chaque render() du Cockpit ; les ajouts asynchrones des modules sont rattrapés par l'observateur. */
  if (typeof render === 'function'){
    var _render = render;
    render = function(){ var r = _render.apply(this, arguments); try { apply(); } catch(e){} return r; };
  }
  window.kwTabsApply = apply;
  try { apply(); } catch(e){}
})();
