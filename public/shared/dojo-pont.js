/* COCKPIT KW — Dojo : identité et droits fournis par le Cockpit (public/shared/dojo-pont.js)
   Additif : une seule ligne <script> dans index.html, APRÈS identite.js et acces-strict.js, AVANT session-restore.js. Retour arrière : retirer la ligne
   (le Dojo affiche alors « Accès non autorisé » : remettre aussi l'ancien dojo/index.html).
   CAUSE : le Dojo (dans l'onglet Dojo, en cadre) demandait de nouveau prénom et nom (« Identification du consultant »), et ses droits ne dépendaient
   que d'une session valide : n'importe quel compte pouvait l'ouvrir par son adresse directe, quelle que soit la matrice d'Admin.
   MAINTENANT :
   - le Dojo demande au Cockpit qui est connecté et s'il a droit au Dojo (kwDojoAcces) : mêmes règles que l'onglet (Admin → Accès par fonction,
     profil Membre Codir) ; nom = fiche Admin → Pilotes (comme le médaillon). Plus d'écran d'identification.
   - ouvert seul (/dojo/), le Dojo renvoie vers /#dojo : le Cockpit demande la connexion si besoin, puis ouvre l'onglet Dojo (si autorisé).
   - côté serveur, /api/dojo-claude applique les mêmes droits (protège le crédit API). */
(function(){
  'use strict';
  function role(){ try { return typeof CURRENT_ROLE !== 'undefined' ? CURRENT_ROLE : ''; } catch(e){ return ''; } }
  function email(){ try { return String(typeof CURRENT_EMAIL !== 'undefined' ? CURRENT_EMAIL : '').toLowerCase(); } catch(e){ return ''; } }
  function allowed(){ var r = role(); if (!r || r === 'aucun' || !email()) return false; try { return !!tabAllowed(r, 'dojo'); } catch(e){ return false; } }
  function nom(){
    var el = document.getElementById('whoName'), n = el ? String(el.textContent || '').trim() : '';
    if (n && !/^(CEO|CTO|Commerce|Méthodes|RH|PMO|Consultant|Communication|Transformation|Mktg et Produit|Administration des affaires)$/i.test(n)) return n;
    return email().split('@')[0].split(/[._-]+/).filter(Boolean).map(function(x){ return x.charAt(0).toUpperCase() + x.slice(1); }).join(' ');
  }
  window.kwDojoAcces = function(){ return { ok: allowed(), nom: nom(), email: email() }; };

  /* Lien direct /#dojo (renvoi du Dojo ouvert seul) : après la connexion ou la reconnexion, on ouvre l'onglet Dojo */
  var H = /^#dojo\b/.test(location.hash || '') ? location.hash : '';
  var FORMATEUR = /formateur=1/.test(H);
  function openDojo(){
    if (!H) return; H = '';
    try { history.replaceState(null, '', location.pathname + location.search); } catch(e){}
    if (!allowed()){ if (window.kwToast) window.kwToast('Votre fonction n’a pas accès au Dojo (Admin → Accès par fonction).', 'err'); return; }
    try { switchTab('dojo'); } catch(e){ return; }
    if (FORMATEUR){ var f = document.getElementById('dojoFrame'); if (f) f.src = '/dojo/?formateur=1'; }
  }
  if (typeof render === 'function' && !render.__dojo){
    var _r = render;
    render = function(){ var out = _r.apply(this, arguments); if (H) setTimeout(openDojo, 0); return out; };
    render.__dojo = true;
  }
})();
