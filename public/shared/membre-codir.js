/* COCKPIT KW — Profil complémentaire « Membre Codir » (public/shared/membre-codir.js)
   Une personne garde son rôle initial ; le profil AJOUTE à ses droits les onglets cochés pour lui dans Admin. Droits effectifs = rôle + profil.
   Le profil ne retire jamais rien. Il ne peut jamais accorder « Admin », « Tableau de bord » ni « Objectifs ».
   Module ADDITIF : aucune ligne de index.html n'est modifiée ; s'enregistre après obeya-admin.js (et après finance-bar.js).
   Prérequis base : membre_codir.sql (colonne user_access.codir + contrôle d'accès de Cerebro). Sans lui, tout reste comme avant (profil faux pour tous). */
(function(){
  if (window.__kwMembreCodir) return;                                   /* idempotent */
  if (typeof window.tabAllowed !== 'function' || typeof window.loadTabAccess !== 'function') return;   /* rien n'est modifié si l'app d'origine n'est pas là */
  window.__kwMembreCodir = true;

  /* Onglets que le profil peut accorder (pas Admin, pas Tableau de bord, pas Objectifs : jamais). */
  var GRANTABLE = [['cerebro_business','Cerebro Business'], ['cerebro_events','Cerebro Events'], ['cerebro_talents','Cerebro Talents'], ['capbp','Bonnes pratiques'],
                   ['dojo','Dojo'], ['parcours','Parcours candidats'], ['plandaction','Réunions & Rituels et Actions'], ['humetria','Humetria']];
  var KEYS = GRANTABLE.map(function(a){ return a[0]; });
  var CEREBRO_SUBS = ['cerebro_business','cerebro_events','cerebro_talents'];
  window.CURRENT_CODIR = false;                                          /* la personne connectée porte-t-elle le profil ? (lu à chaque connexion) */

  function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function grants(){ var g = (typeof TAB_ACCESS === 'object' && TAB_ACCESS) ? TAB_ACCESS.codir : null; return (g && typeof g === 'object') ? g : {}; }
  function granted(tab){                                                 /* seules les valeurs strictement VRAIES comptent */
    var g = grants();
    if (tab === 'cerebro') return CEREBRO_SUBS.some(function(k){ return g[k] === true; });
    return KEYS.indexOf(tab) >= 0 && g[tab] === true;
  }

  /* 1) Droits effectifs : rôle + profil — et SEULEMENT pour la personne connectée (jamais pour une ligne de la matrice des rôles). */
  var _ta = window.tabAllowed;
  window.tabAllowed = function(role, tab){
    if (_ta.apply(this, arguments)) return true;
    return window.CURRENT_CODIR === true && typeof CURRENT_ROLE !== 'undefined' && role === CURRENT_ROLE && granted(tab);
  };

  /* 2) Le drapeau de la personne : relu à chaque chargement des droits (connexion). Colonne absente ou erreur : profil faux, rien ne casse. */
  async function loadFlag(){
    window.CURRENT_CODIR = false;
    try {
      if (typeof SB === 'undefined' || !SB || typeof CURRENT_EMAIL === 'undefined' || !CURRENT_EMAIL) return;
      var r = await SB.from('user_access').select('codir').eq('email', CURRENT_EMAIL).maybeSingle();
      window.CURRENT_CODIR = !!(r && r.data && r.data.codir === true);
    } catch(e){ window.CURRENT_CODIR = false; }
  }
  var _lta = window.loadTabAccess;
  window.loadTabAccess = async function(){
    var out; try { out = await _lta.apply(this, arguments); } finally { await loadFlag(); }
    return out;
  };

  /* 3) Admin : une case « Membre Codir » par utilisateur, et le panneau des onglets du profil. */
  function msg(html){ if (typeof adminMsg === 'function') adminMsg(html); }
  function usersList(){ try { return (typeof ADMIN_USERS !== 'undefined' && Array.isArray(ADMIN_USERS)) ? ADMIN_USERS : []; } catch(e){ return []; } }

  async function onToggle(cb, email){
    var tr = cb.closest('tr'), sel = tr && tr.querySelector('select'), adm = tr && tr.querySelector('.adm-admin'), want = cb.checked;
    if (!sel || !sel.value){ cb.checked = !want; msg('⚠ Rôle introuvable pour ' + esc(email) + ' : rien n’a été modifié.'); return; }   /* jamais d'écriture sans le rôle (il serait effacé) */
    cb.disabled = true;
    try {
      var r = await adminCall({ action:'set_role', email:email, role:sel.value, is_admin:!!(adm && adm.checked), codir:want });
      if (r && r.ok){
        usersList().forEach(function(u){ if (String(u.email).toLowerCase() === String(email).toLowerCase()) u.codir = want; });
        renderPanel();
        msg('✓ Profil « Membre Codir » ' + (want ? 'attribué à ' : 'retiré à ') + esc(email) + ' (effet à sa prochaine connexion).');
      } else {
        cb.checked = !want; msg('⚠ ' + esc((r && r.data && r.data.error) || 'Échec de la mise à jour'));
      }
    } catch(e){ cb.checked = !want; msg('⚠ ' + esc((e && e.message) || e)); }
    cb.disabled = false;
  }

  function augmentUsers(users){
    var zone = document.getElementById('adminZone'); if (!zone) return;
    [].slice.call(zone.querySelectorAll('tbody tr')).forEach(function(tr){
      var adm = tr.querySelector('.adm-admin'), b = tr.querySelector('td b'); if (!adm || !b || tr.querySelector('.adm-codir')) return;
      var email = (b.textContent || '').trim(), u = (users || []).filter(function(x){ return String(x.email).toLowerCase() === email.toLowerCase(); })[0] || {};
      var cell = adm.closest('td'); if (!cell) return;
      var lab = document.createElement('label'); lab.style.cssText = 'font-size:12px;margin-left:10px;white-space:nowrap;';
      lab.title = 'Profil complémentaire : ajoute à son rôle les onglets cochés dans « Profil Membre Codir » ci-dessous';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'adm-codir'; cb.checked = u.codir === true; cb.setAttribute('aria-label', 'Membre Codir : ' + email);
      cb.addEventListener('change', function(){ onToggle(cb, email); });
      lab.appendChild(cb); lab.appendChild(document.createTextNode(' Membre Codir')); cell.appendChild(lab);
    });
  }

  function renderPanel(){
    var host = document.getElementById('adminAccessZone'); if (!host || !host.parentNode) return;
    var zone = document.getElementById('adminCodirZone');
    if (!zone){ zone = document.createElement('div'); zone.id = 'adminCodirZone'; host.parentNode.insertBefore(zone, host.nextSibling); }
    var g = grants(), members = usersList().filter(function(u){ return u.codir === true; }).map(function(u){ return u.email; });
    var boxes = GRANTABLE.map(function(t){
      return '<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 18px 4px 0;font-size:13px;"><input type="checkbox" id="codir_tab_' + t[0] + '"' + (g[t[0]] === true ? ' checked' : '') + '> ' + esc(t[1]) + '</label>';
    }).join('');
    zone.innerHTML = '<div class="panel" style="padding:12px 16px 16px;margin-top:16px;">'
      + '<div class="sec-title" style="font-size:16px;">Profil « Membre Codir » : droits complémentaires</div>'
      + '<div class="sec-note">Ce profil s’<b>ajoute</b> au rôle de chaque personne qui le porte (case « Membre Codir » dans la liste des utilisateurs) : elle garde les onglets de son rôle et gagne ceux cochés ici. Rien n’est retiré. <b>Aucun onglet n’est coché par défaut.</b> Admin, Tableau de bord et Objectifs ne peuvent pas être accordés par ce profil. Il ne donne accès ni à l’Obeya (régi par les cartes) ni aux données financières. L’accès à un onglet est celui de l’onglet (consultation et saisie). Effet à la prochaine connexion.</div>'
      + '<div style="margin:8px 0 10px;">' + boxes + '</div>'
      + '<div class="edit-bar"><button class="add-btn" type="button" onclick="codirSave()">Enregistrer le profil</button><span id="codirMsg" class="edit-hint" role="status" style="margin-left:10px;"></span></div>'
      + '<div class="sub-cell" style="margin-top:8px;" id="codirMembers">' + (members.length ? members.length + ' membre(s) : ' + members.map(esc).join(', ') : 'Aucun membre pour l’instant.') + '</div>'
      + '</div>';
  }

  window.codirSave = async function(){
    var m = document.getElementById('codirMsg');
    function say(ok, t){ if (m){ m.style.color = ok === null ? 'var(--muted)' : (ok ? '#2e7d46' : 'var(--signal)'); m.textContent = t; } }
    var tabs = {}; KEYS.forEach(function(k){ var cb = document.getElementById('codir_tab_' + k); tabs[k] = !!(cb && cb.checked); });
    say(null, 'Enregistrement…');
    try {
      var r = await SB.from('role_access').upsert({ role:'codir', tabs:tabs }, { onConflict:'role' }); if (r && r.error) throw r.error;
      await loadTabAccess();
      say(true, 'Profil enregistré (effet à la prochaine connexion des membres).');
    } catch(e){ say(false, 'Refusé : ' + ((e && e.message) || e)); }
  };

  var _ra = window.renderAdmin;
  if (typeof _ra === 'function') window.renderAdmin = function(users){
    var saved = window.CURRENT_CODIR; window.CURRENT_CODIR = false;       /* la matrice des rôles montre les droits des RÔLES, sans le complément du profil de l'administrateur connecté */
    try { return _ra.apply(this, arguments); }
    finally {
      window.CURRENT_CODIR = saved;
      try { augmentUsers(users); } catch(e){ console.error('membre-codir (utilisateurs)', e); }
      try { renderPanel(); } catch(e){ console.error('membre-codir (panneau)', e); }
    }
  };
})();
