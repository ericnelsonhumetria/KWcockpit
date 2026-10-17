/* COCKPIT KW — Ordre et mise en avant des onglets (public/shared/cockpit-tabs.js)
   Additif : une seule ligne <script> dans index.html, à placer APRÈS les autres modules (aic-espaces, obeya-admin, obeya).
   Il ne crée ni ne supprime aucun onglet : il les RÉORDONNE, MASQUE certains, RENOMME l'onglet « Réunions & Rituels et Actions » en « Clap! » (qui contient aussi l'AIC) et le met en avant.
   Les onglets sont ajoutés par plusieurs modules, parfois après coup (AIC, Obeya) : un observateur reclasse à chaque ajout.
   Pour réafficher un onglet masqué : le retirer de HIDDEN ci-dessous (les droits d'accès d'Admin ne sont pas modifiés). */
(function(){
  /* Ordre voulu, de gauche à droite. Un onglet absent pour un rôle (droits d'Admin) est simplement sauté. */
  var ORDER  = ['dash', 'obeya', 'plandaction', 'cerebro', 'parcours', 'dojo', 'objectifs'];
  var LAST   = ['admin'];                      /* toujours en dernier, tout à droite */
  var HIDDEN = ['humetria', 'capbp'];          /* masqués pour le moment : Humetria, Bonnes pratiques */
  var FOCUS  = 'plandaction';                  /* titre mis en avant par une couleur distinctive */
  var LABELS = { plandaction:'Clap!', dojo:'Dojo' };   /* Dojo : plus de « ↗ », il s'ouvre dans le Cockpit */        /* l'onglet Réunions & Rituels et Actions devient « Clap! » : Réunions & Rituels · Actions · AIC */

  /* v3 — Bandeau et têtes d'onglet (demande : « on doit voir dans le bandeau où l'on est ; Clap! mis en avant sans avoir l'air sélectionné »).
     · En-tête compact : logo, titre et « Accueil » sur une ligne ; photo, nom et fonction sur une ligne (le bandeau collant prenait ~270 px).
     · Barre d'onglets lisible : texte plus grand et plus contrasté, survol marqué ; trait bordeaux sur toute la largeur.
     · Onglet ACTIF sans ambiguïté : rempli bordeaux, texte blanc, filet or en haut ; il se raccorde au trait et à la frise bordeaux.
     · Clap! reste mis en avant par une pastille or et un texte bordeaux gras, SANS fond : il ne ressemble plus à l'onglet actif.
     · Accessibilité : aria-current="page" sur l'onglet actif, anneau de focus or ; le titre de la fenêtre indique l'onglet. */
  function css(){
    if (document.getElementById('kwTabsOrderStyle')) return;
    var B = '#560A0F', O = '#EFB810';
    var s = document.createElement('style'); s.id = 'kwTabsOrderStyle';
    s.textContent = '.tabs .tab[hidden]{display:none !important;}'
      /* en-tête compact */
      + '#app header{border-bottom:3px solid ' + B + ';box-shadow:0 2px 10px rgba(26,20,22,.06);}'
      + '#app header .head-inner{align-items:center;padding:10px 20px 8px;}'
      + '#app header .head-left{flex-direction:row;align-items:center;gap:16px;flex-wrap:wrap;}'
      + '#app header .head-home{align-self:center;}'
      + '#app header .kw-logo.sm{width:52px;height:52px;}'
      + '#app header .head-right{flex-direction:row;align-items:center;gap:12px;text-align:left;}'
      + '#app header .head-id{align-items:flex-start;}'
      + '#app header .kw-avatar{width:52px;height:52px;}'
      + '#app header .kw-avatar-initials{font-size:19px;}'
      + '#app header .kw-avatar-edit{width:19px;height:19px;line-height:19px;font-size:10px;}'
      /* barre d'onglets */
      + '#tabs{gap:2px;align-items:flex-end;padding-top:2px;}'
      + '#tabs .tab{font-size:14px;font-weight:600;color:#4a3d40;padding:11px 18px 10px;border:0;border-radius:9px 9px 0 0;margin-bottom:0;background:transparent;transition:background-color .15s,color .15s;}'
      + '#tabs .tab:hover{background:rgba(86,10,15,.08);color:' + B + ';}'
      + '#tabs .tab:focus-visible{outline:3px solid ' + O + ';outline-offset:-3px;}'
      + '#tabs .tab.active,#tabs .tab.active:hover{background:' + B + ';color:#fff;font-weight:700;box-shadow:inset 0 3px 0 ' + O + ';}'
      /* Clap! : mis en avant, sans fond */
      + '#tabs .tab[data-tab="' + FOCUS + '"]{color:' + B + ';font-weight:800;}'
      + '#tabs .tab[data-tab="' + FOCUS + '"]::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:' + O + ';margin-right:7px;vertical-align:1px;box-shadow:0 0 0 2px rgba(239,184,16,.25);}'
      + '#tabs .tab[data-tab="' + FOCUS + '"].active{color:' + O + ';}'
      + '#tabs .tab[data-tab="admin"]{margin-left:auto;}'
      + '@media (max-width:640px){#app header .head-inner{padding:8px 12px 6px;}#app header .kw-avatar{width:40px;height:40px;}#app header .kw-logo.sm{width:40px;height:40px;}#tabs{flex-wrap:nowrap;overflow-x:auto;}#tabs .tab{font-size:13px;padding:10px 13px 9px;flex:0 0 auto;}}';
    document.head.appendChild(s);
  }
  /* L'onglet actif est annoncé (lecteurs d'écran) et nommé dans le titre de la fenêtre */
  function mark(){
    var tabs = document.getElementById('tabs'); if (!tabs) return;
    var act = null;
    [].slice.call(tabs.querySelectorAll('.tab[data-tab]')).forEach(function(b){ var on = b.classList.contains('active'); if (on) act = b; if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    var t = act ? String(act.textContent || '').replace(/[↗✎]/g, '').trim() : '';
    document.title = t ? 'Cockpit KW · ' + t : 'Cockpit KW';
    if (act && tabs.scrollWidth > tabs.clientWidth + 4){ try { act.scrollIntoView({ block:'nearest', inline:'nearest' }); } catch(e){} }   /* mobile : l'onglet actif reste visible */
  }
  function rank(b){ var k = b.dataset.tab, i = ORDER.indexOf(k); if (i >= 0) return i; var j = LAST.indexOf(k); return j >= 0 ? 1000 + j : 100; }   /* inconnus : après les onglets listés, avant Admin */

  var obs = null, tmr = null;
  function watch(){ var t = document.getElementById('tabs'); if (t && window.MutationObserver){ if (!obs) obs = new MutationObserver(function(){ if (tmr) clearTimeout(tmr); tmr = setTimeout(apply, 0); }); obs.observe(t, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] }); } }
  function apply(){
    var tabs = document.getElementById('tabs'); if (!tabs) return;
    if (obs) obs.disconnect();                                             /* nos propres déplacements ne doivent pas nous rappeler */
    try {
      css();
      var btns = [].slice.call(tabs.querySelectorAll('.tab[data-tab]'));
      var want = btns.map(function(b, i){ return { b:b, i:i }; }).sort(function(a, c){ return rank(a.b) - rank(c.b) || a.i - c.i; }).map(function(x){ return x.b; });
      var same = want.every(function(b, i){ return b === btns[i]; });
      if (!same) want.forEach(function(b){ tabs.appendChild(b); });
      btns.forEach(function(b){ b.hidden = HIDDEN.indexOf(b.dataset.tab) >= 0; var l = LABELS[b.dataset.tab]; if (l && b.textContent !== l) b.textContent = l; });
      mark();
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
