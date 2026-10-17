/* COCKPIT KW — Dojo : identité et droits fournis par le Cockpit (public/shared/dojo-pont.js)
   Additif : une seule ligne <script> dans index.html, APRÈS identite.js, membre-codir.js et acces-strict.js, AVANT session-restore.js.
   CAUSE : le Dojo (dans l'onglet Dojo, en cadre) demandait de nouveau prénom et nom (« Identification du consultant »), et ses droits ne dépendaient
   que d'une session valide : n'importe quel compte pouvait l'ouvrir par son adresse directe, quelle que soit la matrice d'Admin.
   MAINTENANT :
   - le Dojo demande au Cockpit qui est connecté et ce qu'il peut faire (kwDojoAcces) : mêmes règles que les onglets (Admin → Accès par fonction,
     profil Membre Codir) ; nom = fiche Admin → Pilotes (comme le médaillon). Plus d'écran d'identification.
   - v2 : droit distinct « Dojo — résultats » (colonne ajoutée à la matrice d'Admin et au profil Membre Codir). Par défaut : direction et Méthodes.
     Il ouvre /dojo/resultats.html (reprise de l'admin de l'ancien Dojo) depuis le bouton « Résultats » du Dojo.
   - ouvert seul (/dojo/ ou /dojo/resultats.html), le Dojo renvoie vers /#dojo (ou /#dojo-resultats) : le Cockpit demande la connexion si besoin,
     puis ouvre l'onglet Dojo (si autorisé).
   - côté serveur : /api/dojo-claude applique les mêmes droits ; la base (dojo_acces.sql) ne montre à chacun que ses propres résultats,
     sauf droit « Dojo — résultats ». */
(function(){
  'use strict';
  var TAB_RES = 'dojo_resultats', LABEL_RES = 'Dojo — résultats';
  function role(){ try { return typeof CURRENT_ROLE !== 'undefined' ? CURRENT_ROLE : ''; } catch(e){ return ''; } }
  function email(){ try { return String(typeof CURRENT_EMAIL !== 'undefined' ? CURRENT_EMAIL : '').toLowerCase(); } catch(e){ return ''; } }
  function can(tab){ var r = role(); if (!r || r === 'aucun' || !email()) return false; try { return !!tabAllowed(r, tab); } catch(e){ return false; } }
  function nom(){
    var el = document.getElementById('whoName'), n = el ? String(el.textContent || '').trim() : '';
    if (n && !/^(CEO|CTO|Commerce|Méthodes|RH|PMO|Consultant|Communication|Transformation|Mktg et Produit|Administration des affaires|Sans accès)$/i.test(n)) return n;
    return email().split('@')[0].split(/[._-]+/).filter(Boolean).map(function(x){ return x.charAt(0).toUpperCase() + x.slice(1); }).join(' ');
  }
  window.kwDojoAcces = function(){ var ok = can('dojo'); return { ok: ok, resultats: ok && can(TAB_RES), nom: nom(), email: email() }; };

  /* Valeur par défaut du nouveau droit (tant que la matrice d'Admin ne dit rien) : direction et Méthodes */
  try { if (typeof tabDefault === 'function' && !tabDefault.__dojoRes){
    var g = tabDefault;
    tabDefault = function(r, tab){ if (tab === TAB_RES) return r === 'eric' || r === 'audrey'; return g.apply(this, arguments); };
    tabDefault.__dojoRes = true;
  } } catch(e){}

  /* Admin → « Accès aux fonctions par rôle » : colonne « Dojo — résultats » juste après « Dojo », pour chaque ligne (y compris PMO, Transformation).
     L'enregistrement lit toutes les cases de la matrice : rien d'autre à faire. */
  function patchMatrix(){
    var zone = document.getElementById('adminAccessZone'); if (!zone) return;
    var table = zone.querySelector('table'); if (!table) return;
    var head = table.querySelector('tr'); if (!head) return;
    var rows = [].slice.call(table.querySelectorAll('tr')).filter(function(tr){ return tr.querySelector('input[id^="acc_"][id$="_dojo"]'); });
    if (!rows.length) return;
    var idx = [].indexOf.call(rows[0].children, rows[0].querySelector('input[id$="_dojo"]').closest('td'));
    if (!head.querySelector('[data-kw-dojo-res]')){
      var ref = head.children[idx]; if (!ref) return;
      var th = ref.cloneNode(false); th.textContent = LABEL_RES; th.setAttribute('data-kw-dojo-res', '1');
      th.title = 'Voir les résultats de toutes les simulations du Dojo (onglet Résultats du Dojo)';
      ref.parentNode.insertBefore(th, ref.nextSibling);
    }
    rows.forEach(function(tr){
      var cb = tr.querySelector('input[id$="_dojo"]'), m = /^acc_([a-z]+)_dojo$/.exec(cb.id); if (!m) return;
      if (document.getElementById('acc_' + m[1] + '_' + TAB_RES)) return;
      var td = cb.closest('td'), n = td.cloneNode(false), on = false;
      try { on = !!tabAllowed(m[1], TAB_RES); } catch(e){}
      n.innerHTML = '<input type="checkbox" id="acc_' + m[1] + '_' + TAB_RES + '"' + (on ? ' checked' : '') + '>';
      td.parentNode.insertBefore(n, td.nextSibling);
    });
  }
  window.kwDojoPatchMatrix = patchMatrix;
  if (typeof renderAdmin === 'function' && !renderAdmin.__dojoRes){
    var _ra = renderAdmin;
    renderAdmin = function(){ var r = _ra.apply(this, arguments); var again = function(){ try { patchMatrix(); } catch(e){} };
      Promise.resolve(r).then(function(){ setTimeout(again, 0); }, again); setTimeout(again, 0); setTimeout(again, 300); return r; };
    renderAdmin.__dojoRes = true;
  }

  /* Lien direct /#dojo ou /#dojo-resultats : après la connexion ou la reconnexion, on ouvre l'onglet Dojo */
  var H = /^#dojo\b/.test(location.hash || '') ? location.hash : '';
  var FORMATEUR = /formateur=1/.test(H), RESULTATS = /^#dojo-resultats/.test(H);
  function openDojo(){
    if (!H) return; H = '';
    try { history.replaceState(null, '', location.pathname + location.search); } catch(e){}
    if (!can('dojo')){ if (window.kwToast) window.kwToast('Votre fonction n’a pas accès au Dojo (Admin → Accès par fonction).', 'err'); return; }
    try { switchTab('dojo'); } catch(e){ return; }
    var f = document.getElementById('dojoFrame'); if (!f) return;
    if (RESULTATS && can(TAB_RES)) f.src = '/dojo/resultats.html';
    else if (FORMATEUR) f.src = '/dojo/?formateur=1';
  }
  if (typeof render === 'function' && !render.__dojo){
    var _r = render;
    render = function(){ var out = _r.apply(this, arguments); if (H) setTimeout(openDojo, 0); return out; };
    render.__dojo = true;
  }
})();
