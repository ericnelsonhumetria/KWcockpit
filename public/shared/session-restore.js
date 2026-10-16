/* COCKPIT KW — Rester connecté après une actualisation de la page (public/shared/session-restore.js)
   Additif : une seule ligne <script> dans index.html, APRÈS tous les autres modules (en dernier).
   CAUSE : Supabase conserve bien la connexion dans le navigateur, mais le Cockpit n'en relisait rien au chargement : il affichait
   toujours l'écran de connexion. Ce module relit la session et rejoue la même séquence que le bouton « Connexion » (rôle, données, onglets).
   - Aucune session valide (jamais connecté, déconnexion volontaire, session expirée) : l'écran de connexion s'affiche comme avant.
   - Lien « mot de passe oublié » : jamais de reconnexion automatique (on laisse l'écran de réinitialisation faire son travail).
   - « Déconnexion » efface la session : l'actualisation suivante demande de nouveau le mot de passe. */
(function(){
  'use strict';
  var RECOVERY = /(^|[#?&])(type=recovery|access_token=|refresh_token=|token_hash=|code=|error_code=)/.test((location.hash || '') + '&' + (location.search || ''));
  if (RECOVERY) return;
  function $(id){ return document.getElementById(id); }
  var stored = false;
  try { stored = Object.keys(localStorage).some(function(k){ return /^sb-.*-auth-token$/.test(k); }); } catch(e){}
  if (!stored) return;                                  /* rien à restaurer : comportement d'avant, sans délai */

  var login = $('login'), app = $('app');
  if (!login || !app) return;
  login.classList.add('hidden');                        /* évite l'éclair de l'écran de connexion */
  var wait = document.createElement('div');
  wait.id = 'kwReconnect'; wait.setAttribute('role', 'status');
  wait.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f2efe9;color:#560A0F;font:600 15px system-ui,sans-serif;z-index:9999;';
  wait.textContent = 'Reconnexion…';
  document.body.appendChild(wait);
  function done(){ try { wait.remove(); } catch(e){} }
  function showLogin(){ done(); login.classList.remove('hidden'); }

  async function restore(){
    var sb = (typeof initSupabase === 'function') ? initSupabase() : null;
    if (!sb) return showLogin();
    var s = null;
    try { var r = await sb.auth.getSession(); s = r && r.data && r.data.session; } catch(e){}
    if (!s || !s.user || !s.user.email) return showLogin();
    try {
      SB_SESSION = s; CURRENT_EMAIL = String(s.user.email).trim().toLowerCase();
      try { if (!window.__kwAuthSub && sb.auth.onAuthStateChange){ window.__kwAuthSub = true; sb.auth.onAuthStateChange(function(ev, sess){ if (sess) SB_SESSION = sess; }); } } catch(e){}
      var role = 'paul';
      try { var a = await sb.from('user_access').select('is_admin, role').eq('email', CURRENT_EMAIL).maybeSingle(); role = roleFromAccess(a && a.data, CURRENT_EMAIL); }
      catch(e){ role = roleFromAccess(null, CURRENT_EMAIL); }
      await loadAllShared();
      await initSharedIfEmpty();
      try { await loadTabAccess(); } catch(e){}
      render(role);
      login.classList.add('hidden'); app.classList.remove('hidden');
      try { applyLogo(); } catch(e){}
      try { syncLifecycleOwners(); } catch(e){}
      done();
    } catch(e){ SB_SESSION = null; CURRENT_EMAIL = ''; showLogin(); }
  }
  var guard = setTimeout(function(){ if (!app.classList.contains('hidden')) return; showLogin(); }, 8000);   /* filet : jamais d'écran bloqué */
  function go(){ restore().then(function(){ clearTimeout(guard); }, function(){ clearTimeout(guard); showLogin(); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
