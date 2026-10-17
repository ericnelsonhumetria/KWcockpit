/* COCKPIT KW — « Sans accès, aucun accès » (public/shared/acces-strict.js)
   Additif : une seule ligne <script> dans index.html, APRÈS pmo-role.js (et tous les modules qui enrichissent roleFromAccess),
   AVANT session-restore.js. Même ligne dans clap/index.html, après dialogs.js. Retour arrière : retirer la ligne.
   CAUSE : roleFromAccess retombait sur « paul » (Commerce) dans trois cas : aucune ligne user_access, rôle vide ou « — »
   (valeur posée par l'API admin quand aucun rôle n'est choisi), rôle inconnu ou mal orthographié. Il devinait aussi un rôle
   d'après le début de l'e-mail (paul…, audrey…). Résultat : une personne sans droits recevait ceux du Commerce.
   RÈGLE : seul un rôle reconnu (ou is_admin) ouvre l'application. Sinon : déconnexion, message, aucune donnée chargée.
   MÉCANISME (aucune logique d'origine réécrite) :
   - on sonde la chaîne roleFromAccess existante avec un e-mail vide : si elle répond « paul » alors que le rôle n'est ni
     « commerce » ni « paul », c'est le repli par défaut → « aucun ». Les rôles ajoutés par pmo-role.js / obeya-admin.js restent reconnus.
   - pour l'utilisateur qui se connecte (e-mail = CURRENT_EMAIL), « aucun » interrompt la connexion : doLogin, la restauration de
     session (Cockpit et Clap!) s'arrêtent AVANT loadAllShared / render ; l'écran de connexion reste affiché avec un message.
   - pour les autres appels (liste des utilisateurs dans Admin), « aucun » est simplement renvoyé (aucune déconnexion).
   - filet : tabDefault('aucun', …) = false pour tout onglet. */
(function(){
  'use strict';
  var CODE = 'aucun', LABEL = 'Sans accès', ERR = 'KW_SANS_ACCES';
  var MSG = 'Votre compte n’a pas (encore) d’accès au Cockpit, ou vos droits n’ont pas pu être vérifiés. Contactez l’administrateur.';

  function norm(s){ return String(s || '').toLowerCase().trim(); }
  function curEmail(){ try { return norm(typeof CURRENT_EMAIL !== 'undefined' ? CURRENT_EMAIL : ''); } catch(e){ return ''; } }
  function client(){ try { return (typeof SB !== 'undefined' && SB) ? SB : null; } catch(e){ return null; } }

  function block(){
    try { var sb = client(); if (sb && sb.auth) sb.auth.signOut(); } catch(e){}
    try { SB_SESSION = null; } catch(e){}
    /* CURRENT_EMAIL est volontairement conservé : le « catch » de l'appelant rappelle roleFromAccess(null, e-mail) et doit être bloqué aussi */
    var show = function(){
      ['app', 'capp'].forEach(function(id){ var x = document.getElementById(id); if (x) x.classList.add('hidden'); });
      ['login', 'clogin'].forEach(function(id){ var x = document.getElementById(id); if (x) x.classList.remove('hidden'); });
      ['err', 'cerr'].forEach(function(id){ var x = document.getElementById(id); if (x){ x.textContent = MSG; x.setAttribute('role', 'alert'); } });
      var w = document.getElementById('kwReconnect'); if (w) try { w.remove(); } catch(e){}
    };
    show(); setTimeout(show, 0);            /* après les éventuels « Connexion… » / showLogin() de l'appelant */
    var e = new Error(MSG); e.code = ERR; throw e;
  }

  /* Le rejet volontaire de doLogin ne doit pas polluer la console */
  window.addEventListener('unhandledrejection', function(ev){ try { if (ev.reason && ev.reason.code === ERR) ev.preventDefault(); } catch(e){} });

  if (typeof roleFromAccess === 'function' && !roleFromAccess.__strict){
    var f = roleFromAccess;
    roleFromAccess = function(access, email){
      var res = CODE;
      try {
        if (access && access.is_admin === true) res = f.apply(this, arguments);
        else if (access){
          var r = norm(access.role);
          var probe = f.call(this, { role: access.role, is_admin: false }, '');      /* sans e-mail : pas de devinette */
          if (r && !(probe === 'paul' && r !== 'commerce' && r !== 'paul')) res = probe;
        }
      } catch(e){ res = CODE; }
      if (res === CODE && email && norm(email) === curEmail()) block();
      return res;
    };
    roleFromAccess.__strict = true;
  }

  try { if (typeof tabDefault === 'function' && !tabDefault.__strict){
    var g = tabDefault;
    tabDefault = function(role, tab){ if (role === CODE) return false; return g.apply(this, arguments); };
    tabDefault.__strict = true;
  } } catch(e){}
  try { if (typeof NAMES !== 'undefined' && !NAMES[CODE]) NAMES[CODE] = LABEL; } catch(e){}

  /* Admin → « Inviter un utilisateur » : plus de « Commerce » présélectionné. Il faut choisir la fonction. */
  function patchInvite(){
    var sel = document.getElementById('invRole'); if (!sel || sel.__strict) return;
    sel.__strict = true;
    var o = document.createElement('option'); o.value = ''; o.textContent = '— Choisir —'; o.disabled = true;
    sel.insertBefore(o, sel.firstChild); sel.value = '';
  }
  document.addEventListener('click', function(ev){
    var b = ev.target && ev.target.closest && ev.target.closest('button[onclick*="paAdminInvite"]'); if (!b) return;
    var sel = document.getElementById('invRole'); if (!sel || sel.value) return;
    ev.preventDefault(); ev.stopPropagation();
    var m = document.getElementById('invMsg'); if (m){ m.style.color = 'var(--signal)'; m.textContent = 'Choisissez la fonction.'; }
    try { sel.focus(); } catch(e){}
  }, true);
  ['renderAdmin', 'renderAdminPilotes'].forEach(function(n){
    try {
      var h = window[n]; if (typeof h !== 'function' || h.__strict) return;
      var w = function(){ var r = h.apply(this, arguments); var again = function(){ try { patchInvite(); } catch(e){} };
        Promise.resolve(r).then(again, again); setTimeout(again, 0); return r; };
      w.__strict = true;
      if (n === 'renderAdmin') renderAdmin = w; else renderAdminPilotes = w;
    } catch(e){}
  });
})();
