/* COCKPIT KW — Rôle PMO (Project Management Officer) (public/shared/pmo-role.js)
   Additif : une seule ligne <script> dans index.html, à placer APRÈS obeya-admin.js et membre-codir.js.
   POURQUOI : un rôle inconnu du Cockpit est traité comme « Commerce » (repli par défaut de roleFromAccess). Ce module déclare le PMO pour
   que cela n'arrive pas : le PMO n'a, par défaut, que l'onglet Clap! (comme un consultant) ; l'Admin peut lui en ouvrir d'autres.
   Il ajoute « PMO » à la liste des fonctions de l'Admin et une ligne « PMO » à la matrice « Accès aux fonctions par rôle ».
   Il affiche aussi « Clap! » dans les en-têtes de cette matrice (l'onglet « Réunions & Rituels et Actions » s'appelle désormais Clap!).
   Côté base : aic_pmo_niveaux.sql (visibilité des AIC, préparer / lancer / terminer chacune). */
(function(){
  'use strict';
  var CODE = 'pmo', LABEL = 'PMO';
  function isPmo(r){ r = String(r || '').toLowerCase().trim(); return r === 'pmo' || r === 'project management officer'; }

  function declare(){
    try { if (typeof roleFromAccess === 'function' && !roleFromAccess.__pmo){
      var f = roleFromAccess;
      roleFromAccess = function(access, email){ try { if (access && access.is_admin !== true && isPmo(access.role)) return CODE; } catch(e){} return f.apply(this, arguments); };
      roleFromAccess.__pmo = true;
    } } catch(e){}
    try { if (typeof tabDefault === 'function' && !tabDefault.__pmo){
      var g = tabDefault;
      tabDefault = function(role, tab){ if (role === CODE) return tab === 'plandaction'; return g.apply(this, arguments); };
      tabDefault.__pmo = true;
    } } catch(e){}
    try { if (typeof NAMES !== 'undefined' && !NAMES[CODE]) NAMES[CODE] = LABEL; } catch(e){}
    try { if (typeof ROLES_DISPO !== 'undefined' && ROLES_DISPO.indexOf(LABEL) < 0) ROLES_DISPO.push(LABEL); } catch(e){}
  }
  declare();

  /* Matrice « Accès aux fonctions par rôle » : ligne PMO + libellé Clap! */
  function roleOfRow(tr){ var cb = tr.querySelector('input[id^="acc_"]'); var m = cb && /^acc_([a-z]+)_/.exec(cb.id); return m ? m[1] : ''; }
  function patchMatrix(){
    var zone = document.getElementById('adminAccessZone'); if (!zone) return;
    var table = zone.querySelector('table'); if (!table) return;
    [].slice.call(table.querySelectorAll('th')).forEach(function(th){ if (/^\s*Réunions\s*(&|&amp;)\s*Rituels et Actions\s*$/.test(th.textContent)) th.textContent = 'Clap!'; });
    var body = table.querySelector('tbody') || table;
    if (body.querySelector('input[id^="acc_pmo_"]')) return;
    var rows = [].slice.call(body.querySelectorAll('tr')).filter(function(tr){ return roleOfRow(tr); });
    var model = rows.filter(function(tr){ return roleOfRow(tr) === 'consultant'; })[0] || rows[rows.length - 1]; if (!model) return;
    var tabs = [].slice.call(model.querySelectorAll('input[id^="acc_"]')).map(function(cb){ return cb.id.replace(/^acc_[a-z]+_/, ''); });
    var tr = document.createElement('tr'), first = model.children[0].cloneNode(false); first.textContent = LABEL; tr.appendChild(first);
    tabs.forEach(function(t){
      var on = false; try { on = !!tabAllowed(CODE, t); } catch(e){}
      var td = model.children[1].cloneNode(false); td.innerHTML = '<input type="checkbox" id="acc_pmo_' + t + '"' + (on ? ' checked' : '') + '>'; tr.appendChild(td);
    });
    model.parentNode.insertBefore(tr, model.nextSibling);
  }
  if (typeof renderAdmin === 'function' && !renderAdmin.__pmo){
    var _ra = renderAdmin;
    renderAdmin = function(){ var r = _ra.apply(this, arguments); var again = function(){ try { patchMatrix(); patchInvite(); } catch(e){} };
      Promise.resolve(r).then(again, again); setTimeout(again, 0); return r; };
    renderAdmin.__pmo = true;
  }
  /* Formulaire « Inviter un utilisateur » : sa liste de rôles est écrite en dur dans la page, sans PMO. On l'y ajoute. */
  function patchInvite(){
    var sel = document.getElementById('invRole'); if (!sel) return;
    if ([].some.call(sel.options, function(o){ return o.value === LABEL; })) return;
    var o = document.createElement('option'); o.value = LABEL; o.textContent = LABEL; sel.appendChild(o);
  }
  if (typeof renderAdminPilotes === 'function' && !renderAdminPilotes.__pmo){
    var _rp = renderAdminPilotes;
    renderAdminPilotes = function(){ var r = _rp.apply(this, arguments); try { patchInvite(); } catch(e){} return r; };
    renderAdminPilotes.__pmo = true;
  }
  window.kwPmoPatch = patchMatrix;
})();
