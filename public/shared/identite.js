/* COCKPIT KW — Médaillon : le NOM de la personne connectée, pas seulement sa fonction (public/shared/identite.js)
   Additif : une seule ligne <script> dans index.html, après les autres modules.
   CAUSE : le médaillon lisait NAMES[rôle], qui ne contient que des fonctions (« Commerce »). Deux personnes de la même fonction
   (ex. Aurélie Lopez et Paul, tous deux Commerce) étaient donc affichées « Commerce », sans nom.
   MAINTENANT : le nom vient de la fiche Admin → Pilotes de la personne (reconnue par son compte lié ou son e-mail). À défaut de fiche,
   il est déduit de l'e-mail (aurelie.lopez@… → « Aurelie Lopez »). La fonction s'affiche en dessous, comme prévu par le médaillon. */
(function(){
  'use strict';
  var WHO = { key:'', nom:'' };
  function $(id){ return document.getElementById(id); }
  function pretty(email){
    return String(email || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(function(x){ return x.charAt(0).toUpperCase() + x.slice(1); }).join(' ');
  }
  function curEmail(){ try { return String(CURRENT_EMAIL || '').toLowerCase(); } catch(e){ return ''; } }
  function fonction(){
    var n = ''; try { n = NAMES[CURRENT_ROLE] || ''; } catch(e){}
    return String(n).split(/\s+—\s+/).pop().trim();
  }
  function nomComplet(){ var em = curEmail(); return (WHO.key === em && WHO.nom) ? WHO.nom : pretty(em); }
  function initiales(){
    var n = nomComplet() || fonction() || curEmail(); var parts = String(n).trim().split(/[ .@_-]+/).filter(Boolean);
    return (((parts[0] || '').charAt(0) + (parts[1] || '').charAt(0)).toUpperCase()) || '·';
  }
  window.kwInitials = initiales;
  window.kwHeaderIdentity = function(){
    var nm = $('whoName'), fn = $('whoFunc'); if (!nm && !fn) return;
    if (nm) nm.textContent = nomComplet() || fonction();
    if (fn) fn.textContent = fonction();
    var ini = $('kwAvatarInitials'); if (ini) ini.textContent = initiales();
  };
  /* Nom depuis la fiche Pilote (la table est petite : on la lit et on rapproche par compte lié puis par e-mail) */
  async function resolve(){
    var em = curEmail(); if (!em || typeof SB === 'undefined' || !SB) return;
    try {
      var uid = null; try { var u = await SB.auth.getUser(); uid = u && u.data && u.data.user && u.data.user.id; } catch(e){}
      var r = await SB.from('action_pilotes').select('nom,email,user_id'); var list = (r && r.data) || [];
      var hit = list.filter(function(p){ return uid && p.user_id === uid; })[0]
             || list.filter(function(p){ return p.email && String(p.email).trim().toLowerCase() === em; })[0];
      WHO = { key:em, nom:(hit && hit.nom) ? String(hit.nom).trim() : '' };
    } catch(e){ WHO = { key:em, nom:'' }; }
    window.kwHeaderIdentity();
  }
  if (typeof loadTabAccess === 'function' && !loadTabAccess.__who){
    var _lta = loadTabAccess;
    loadTabAccess = async function(){ var r = await _lta.apply(this, arguments); resolve(); return r; };
    loadTabAccess.__who = true;
  }
  if (typeof render === 'function' && !render.__who){
    var _r = render;
    render = function(){ var r = _r.apply(this, arguments); try { window.kwHeaderIdentity(); } catch(e){} return r; };
    render.__who = true;
  }
  try { window.kwHeaderIdentity(); } catch(e){}
})();
