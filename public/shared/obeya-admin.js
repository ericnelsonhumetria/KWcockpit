/* COCKPIT KW — Admin : préparer l'Obeya Codir (public/shared/obeya-admin.js)
   Additif : enrobe renderAdmin() et remplace paSaveAccess(), sans modifier index.html (une seule ligne <script>).
   Trois évolutions, toutes décidées avec le CEO :
     1. la fonction « Transformation » existe dans Admin (liste des rôles, libellé, droits par fonction) ;
     2. une personne peut tenir PLUSIEURS fonctions : colonne « Fonctions en plus » dans la liste des utilisateurs
        (user_access.fonctions ; la fonction principale, user_access.role, reste inchangée) ;
     3. une case « Carte Obeya » et un « Nom de la carte » à côté de chaque fonction, dans le tableau
        « Accès aux fonctions par rôle » (table obeya_cartes). Deux fonctions qui portent le même nom partagent une carte :
        « Mktg et Produit » et « Communication » alimentent ensemble la carte « Marketing & Communication ».
   Rien n'est supprimé. Sans obeya_admin.sql / admin.js à jour, l'écran Admin fonctionne comme avant et le dit. */
(function(){
  if (typeof renderAdmin !== 'function' || typeof adminCall !== 'function') return;

  /* Ordre d'affichage des fonctions (codes d'Admin). « transformation » est la nouvelle. */
  var ORDER = ['eric', 'cto', 'paul', 'transformation', 'audrey', 'juliette', 'communication', 'sabrine', 'najoua', 'consultant'];
  var OBY = { ready:false, rows:{} };
  function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function label(code){ try { return (typeof NAMES === 'object' && NAMES && NAMES[code]) || code; } catch(e){ return code; } }
  function db(){ try { return (typeof SB !== 'undefined' && SB) ? SB : null; } catch(e){ return null; } }
  function defaultCard(code){ return (code === 'juliette' || code === 'communication') ? 'Marketing & Communication' : label(code); }

  /* ---------- 1. La fonction Transformation ---------- */
  try { if (typeof NAMES === 'object' && NAMES && !NAMES.transformation) NAMES.transformation = 'Transformation'; } catch(e){}
  try {
    if (typeof ROLES_DISPO !== 'undefined' && ROLES_DISPO.indexOf('Transformation') < 0){
      var i = ROLES_DISPO.indexOf('Commerce'); ROLES_DISPO.splice(i >= 0 ? i + 1 : ROLES_DISPO.length, 0, 'Transformation');
    }
  } catch(e){}
  /* À la connexion : le libellé d'Admin « Transformation » donne le code « transformation » (sinon, retombée sur « paul »). */
  if (typeof roleFromAccess === 'function'){
    var _rfa = roleFromAccess;
    roleFromAccess = function(access, email){
      if (access && access.is_admin !== true && String(access.role || '').toLowerCase().trim() === 'transformation') return 'transformation';
      return _rfa.apply(this, arguments);
    };
  }
  function primaryOf(u){ try { return roleFromAccess({ role:u.role, is_admin:u.is_admin }, u.email); } catch(e){ return ''; } }

  /* ---------- 2. Plusieurs fonctions par personne ---------- */
  function cellHtml(u){
    var prim = primaryOf(u), extra = (u.fonctions || []).filter(function(c){ return c !== prim; });
    var boxes = ORDER.map(function(c){
      var isPrim = c === prim;
      return '<label style="display:flex;gap:6px;align-items:center;font-size:12px;white-space:nowrap;"><input type="checkbox" value="' + c + '"' + (isPrim || extra.indexOf(c) >= 0 ? ' checked' : '') + (isPrim ? ' disabled' : '') + ' onchange="obeyaFonctions(this)" style="width:auto;margin:0;"> ' + esc(label(c)) + (isPrim ? ' <span class="sub-cell">(principale)</span>' : '') + '</label>';
    }).join('');
    return '<details class="obeya-f"><summary style="cursor:pointer;font-size:12px;">' + (extra.length ? esc(extra.map(label).join(' · ')) : '<span class="sub-cell">aucune</span>') + '</summary><div style="display:flex;flex-direction:column;gap:4px;padding:6px 0;">' + boxes + '</div></details>';
  }
  function userOfRow(tr){ var em = ((tr.querySelector('td b') || {}).textContent || '').trim(); for (var i = 0; i < ADMIN_USERS.length; i++) if (ADMIN_USERS[i].email === em) return ADMIN_USERS[i]; return null; }
  function augmentUsers(){
    var zone = document.getElementById('adminZone'); if (!zone) return;
    var table = zone.querySelector('table'); if (!table) return;
    var head = table.querySelector('thead tr'); if (!head || head.getAttribute('data-obeya')) return; head.setAttribute('data-obeya', '1');
    var th = document.createElement('th'); th.textContent = 'Fonctions en plus'; th.title = 'Une personne peut tenir plusieurs fonctions : la fonction principale est le rôle choisi à gauche'; head.insertBefore(th, head.children[2] || null);
    [].slice.call(table.querySelectorAll('tbody tr')).forEach(function(tr){
      var u = userOfRow(tr); if (!u) return;
      var td = document.createElement('td'); td.innerHTML = cellHtml(u); tr.insertBefore(td, tr.children[2] || null);
      var sel = tr.querySelector('select');
      if (sel) sel.addEventListener('change', function(){ setTimeout(function(){ syncCell(tr); }, 0); });   /* après l'enregistrement du rôle par adminSetRole */
    });
  }
  /* Le rôle principal change : sa case devient « principale », et il sort des fonctions en plus. */
  function syncCell(tr){
    var u = userOfRow(tr), sel = tr.querySelector('select'), cell = tr.querySelector('details.obeya-f'); if (!u || !sel || !cell) return;
    u.role = sel.value; var prim = primaryOf(u), changed = false;
    [].slice.call(cell.querySelectorAll('input[type=checkbox]')).forEach(function(cb){
      var isPrim = cb.value === prim, wasExtra = (u.fonctions || []).indexOf(cb.value) >= 0;
      if (isPrim && wasExtra) changed = true;                             /* l'ancienne fonction « en plus » devient la principale */
      if (!isPrim && cb.checked && !wasExtra) cb.checked = false;         /* l'ancienne principale est REMPLACÉE, pas ajoutée aux fonctions en plus */
      cb.disabled = isPrim; if (isPrim) cb.checked = true;
    });
    if (changed) persist(tr, null, true);                                /* l'ancien « en plus » est devenu la fonction principale : on l'enlève des fonctions en plus */
  }
  /* Enregistre les fonctions en plus d'une ligne. revertEl : la case à annuler si le serveur refuse (rien n'a été enregistré). */
  async function persist(tr, revertEl, silent){
    var u = userOfRow(tr); if (!u) return;
    var sel = tr.querySelector('select'), adm = tr.querySelector('.adm-admin'), prim = primaryOf(u);
    var codes = [].slice.call(tr.querySelectorAll('details.obeya-f input[type=checkbox]')).filter(function(c){ return c.checked && c.value !== prim; }).map(function(c){ return c.value; });
    var r; try { r = await adminCall({ action:'set_role', email:u.email, role: sel ? sel.value : (u.role || '—'), is_admin: !!(adm && adm.checked), fonctions: codes }); } catch(e){ r = { ok:false, data:{ error:'Connexion impossible' } }; }
    if (r && r.ok){
      u.fonctions = codes; var sm = tr.querySelector('details.obeya-f summary'); if (sm) sm.innerHTML = codes.length ? esc(codes.map(label).join(' · ')) : '<span class="sub-cell">aucune</span>';
      if (!silent && typeof adminMsg === 'function') adminMsg('✓ Fonctions mises à jour pour ' + esc(u.email));
    } else {
      if (revertEl) revertEl.checked = !revertEl.checked;
      if (typeof adminMsg === 'function') adminMsg('⚠ ' + esc((r && r.data && r.data.error) || 'Échec de la mise à jour'));
    }
  }
  window.obeyaFonctions = function(el){ var tr = el.closest('tr'); if (tr) return persist(tr, el, false); };

  /* ---------- 3. Cartes Obeya dans « Accès aux fonctions par rôle » ---------- */
  function roleOfRow(tr){ var cb = tr.querySelector('input[id^="acc_"]'); var m = cb && /^acc_([a-z]+)_/.exec(cb.id); return m ? m[1] : ''; }
  function ensureTransformationRow(table){
    var body = table.querySelector('tbody'); if (!body || body.querySelector('input[id^="acc_transformation_"]')) return;
    var rows = [].slice.call(body.querySelectorAll('tr')), model = rows.filter(function(tr){ return roleOfRow(tr) === 'paul'; })[0] || rows[0]; if (!model) return;
    var tabs = [].slice.call(model.querySelectorAll('input[id^="acc_"]')).map(function(cb){ return cb.id.replace(/^acc_[a-z]+_/, ''); });
    var tr = document.createElement('tr'), first = model.children[0].cloneNode(false); first.textContent = label('transformation'); tr.appendChild(first);
    tabs.forEach(function(t){
      var on = false; try { on = !!tabAllowed('transformation', t); } catch(e){}
      var td = model.children[1].cloneNode(false); td.innerHTML = '<input type="checkbox" id="acc_transformation_' + t + '"' + (on ? ' checked' : '') + '>'; tr.appendChild(td);
    });
    body.insertBefore(tr, model.nextSibling);
  }
  async function loadCartes(){
    var c = db(); OBY.ready = false; OBY.rows = {}; if (!c) return;
    try { var r = await c.from('obeya_cartes').select('role,carte,libelle,ordre'); if (r && !r.error){ OBY.ready = true; (r.data || []).forEach(function(x){ OBY.rows[x.role] = x; }); } } catch(e){}
  }
  async function augmentAccess(){
    var zone = document.getElementById('adminAccessZone'); if (!zone) return;
    var table = zone.querySelector('table'); if (!table || table.getAttribute('data-obeya')) return; table.setAttribute('data-obeya', '1');
    ensureTransformationRow(table);
    await loadCartes();
    if (!table.isConnected) return;                                    /* l'écran a été redessiné entre-temps */
    var panel = table.closest('.panel') || zone;
    if (!OBY.ready){
      var note = document.createElement('div'); note.className = 'sec-note'; note.style.cssText = 'margin-top:8px;color:var(--signal);';
      note.textContent = 'Cartes de l’Obeya indisponibles : exécutez d’abord obeya_admin.sql dans Supabase.'; panel.appendChild(note); return;
    }
    var hr = table.querySelector('thead tr');
    [['Carte Obeya', 'Cochez les fonctions qui ont une carte dans l’Obeya du Codir'], ['Nom de la carte', 'Deux fonctions avec le même nom partagent une seule carte']].forEach(function(h){
      var th = document.createElement('th'); th.style.cssText = 'padding:6px 8px;font-size:12px;'; th.textContent = h[0]; th.title = h[1]; hr.appendChild(th);
    });
    [].slice.call(table.querySelectorAll('tbody tr')).forEach(function(tr){
      var code = roleOfRow(tr); if (!code) return; var row = OBY.rows[code] || { carte:false, libelle:'' };
      var td1 = document.createElement('td'); td1.style.cssText = 'text-align:center;padding:6px 8px;';
      td1.innerHTML = '<input type="checkbox" id="obc_' + code + '" aria-label="Carte Obeya pour ' + esc(label(code)) + '"' + (row.carte ? ' checked' : '') + '>';
      var td2 = document.createElement('td'); td2.style.cssText = 'padding:6px 8px;';
      td2.innerHTML = '<input type="text" id="obn_' + code + '" value="' + esc(row.libelle || '') + '" placeholder="' + esc(defaultCard(code)) + '" maxlength="60" aria-label="Nom de la carte pour ' + esc(label(code)) + '"' + (row.carte ? '' : ' disabled') + ' style="min-width:190px;">';
      tr.appendChild(td1); tr.appendChild(td2);
      td1.firstChild.addEventListener('change', function(){ var inp = document.getElementById('obn_' + code); inp.disabled = !this.checked; if (this.checked && !inp.value.trim()) inp.value = defaultCard(code); });
    });
    var help = document.createElement('div'); help.className = 'sec-note'; help.style.marginTop = '8px';
    help.textContent = 'Carte Obeya : cochez les fonctions qui ont une carte dans l’Obeya du Codir. Deux fonctions qui portent le même nom de carte partagent une seule carte (par exemple Mktg et Produit et Communication).';
    panel.insertBefore(help, panel.querySelector('div[style*="margin-top:10px;display:flex"]') || null);
  }

  /* Enregistrer : les accès (comme avant, y compris Transformation) PUIS les cartes. Les cartes sont validées AVANT toute écriture. */
  window.paSaveAccess = async function(){
    var m = document.getElementById('accMsg'), c = db();
    function msg(ok, t){ if (m){ m.style.color = ok === null ? 'var(--muted)' : (ok ? '#2e7d46' : 'var(--signal)'); m.textContent = t; } }
    var byRole = {};
    [].slice.call(document.querySelectorAll('#adminAccessZone input[id^="acc_"]')).forEach(function(cb){
      var mm = /^acc_([a-z]+)_(.+)$/.exec(cb.id); if (!mm) return; (byRole[mm[1]] = byRole[mm[1]] || {})[mm[2]] = !!cb.checked;
    });
    var rows = Object.keys(byRole).map(function(role){ return { role:role, tabs:byRole[role] }; });
    var cartes = [];
    if (OBY.ready){
      var seen = {}, bad = null;
      [].slice.call(document.querySelectorAll('#adminAccessZone tbody tr')).forEach(function(tr, idx){
        var code = roleOfRow(tr); if (!code) return; var cb = document.getElementById('obc_' + code), nm = document.getElementById('obn_' + code); if (!cb) return;
        var libelle = (nm.value || '').replace(/\s+/g, ' ').trim();
        if (cb.checked && !libelle) bad = bad || label(code);
        if (cb.checked && libelle && seen[libelle.toLowerCase()] === undefined) seen[libelle.toLowerCase()] = (OBY.rows[code] && OBY.rows[code].ordre) || (idx + 1) * 10;
        cartes.push({ role:code, carte:cb.checked, libelle: cb.checked ? libelle : (libelle || null), key: libelle.toLowerCase() });
      });
      if (bad){ msg(false, 'Donnez un nom à la carte de la fonction « ' + bad + ' », ou décochez-la.'); return; }
      cartes.forEach(function(x){ x.ordre = x.carte ? seen[x.key] : ((OBY.rows[x.role] && OBY.rows[x.role].ordre) || 100); delete x.key; });
    }
    msg(null, 'Enregistrement…');
    try {
      var r = await c.from('role_access').upsert(rows, { onConflict:'role' }); if (r.error) throw r.error;
      if (typeof loadTabAccess === 'function') await loadTabAccess();
      if (OBY.ready && cartes.length){
        var r2 = await c.from('obeya_cartes').upsert(cartes, { onConflict:'role' }); if (r2.error) throw r2.error;
        cartes.forEach(function(x){ OBY.rows[x.role] = x; });
      }
      msg(true, 'Accès enregistrés' + (OBY.ready ? ' et cartes de l’Obeya mises à jour' : '') + ' (effet à la prochaine connexion).');
    } catch(e){ msg(false, 'Refusé : ' + ((e && e.message) || e)); }
  };

  /* ---------- Branchement : après l'affichage d'Admin ---------- */
  var _ra = renderAdmin;
  renderAdmin = function(users){
    try { return _ra.apply(this, arguments); }
    finally {
      try { augmentUsers(); } catch(e){ console.error('obeya-admin (utilisateurs)', e); }
      try { augmentAccess().catch(function(e){ console.error('obeya-admin (cartes)', e); }); } catch(e){ console.error('obeya-admin (accès)', e); }
    }
  };
})();
