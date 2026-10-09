/* COCKPIT KW — Module AIC · Brique 2 (public/shared/aic-espaces.js)
   CONFIGURATION (Admin, CEO seul) : clients, missions, sites (AIC 3), membres.
   EXPLOITATION (onglet AIC) : liste des espaces accessibles + tableau de bord par espace, en lecture.
   Additif : enrobe render() et renderTab() sans les modifier. Aucune suppression : archivage / désactivation.
   Le cloisonnement et le droit « CEO seul » sont garantis par la RLS (aic_brique2.sql) ; l'interface ne fait que les refléter. */
(function(){
  if (typeof renderTab !== 'function' || typeof render !== 'function') return;

  var X = { missions:[], espaces:[], membres:[], users:[], ceo:false, access:null, email:'', showArch:false,
            open:null, openMem:null, ref:null, acts:null, msg:'' };
  var ACCES = [['lecture','Lecture'], ['contribution','Contribution'], ['animation','Animation']];
  var NIV_LBL = { 1:'AIC 1 · CEO', 2:'AIC 2 · Resp. programme', 3:'AIC 3 · Chef de projet site' };
  var INP = 'height:34px;padding:0 8px;border:1px solid rgba(86,10,15,.25);border-radius:6px;font-size:13px;box-sizing:border-box;';

  function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function db(){ return (typeof SB !== 'undefined' && SB) ? SB : null; }
  function val(id){ var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function me(){ return String((typeof CURRENT_EMAIL !== 'undefined' && CURRENT_EMAIL) || '').toLowerCase(); }
  function flash(id, ok, txt){ var el = document.getElementById(id); if(!el) return; el.style.color = ok ? '#1e7d34' : '#9a3412'; el.textContent = txt; if(ok) setTimeout(function(){ if(el.textContent === txt) el.textContent = ''; }, 2500); }
  function fdate(d){ if(!d) return ''; var p = String(d).slice(0,10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d; }
  function byId(list, id){ for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function view(){ return document.getElementById('view'); }

  /* ---------- Accès : CEO (fonction SQL aic_is_ceo), ou membre actif d'au moins un espace ---------- */
  var _accP = null, _accEmail = '';
  function aicxAccess(){
    var em = me();
    if (_accP && _accEmail === em) return _accP;   /* une seule résolution partagée, même si appelée en parallèle */
    _accEmail = em; X.email = em; X.access = false; X.ceo = false;
    _accP = (async function(){
      try {
        var r = await db().rpc('aic_is_ceo');
        X.ceo = !!(r && !r.error && r.data === true);
        if (X.ceo) X.access = true;
        else { var m = await db().from('aic_membres').select('id').eq('email', em).eq('actif', true).limit(1); X.access = !!(m && m.data && m.data.length); }
      } catch(e){ X.access = false; }
      return X.access;
    })();
    return _accP;
  }

  /* ---------- Onglet AIC (ajouté après render(), sans modifier index.html) ---------- */
  var _renderX = render;
  render = function(role){
    _renderX.apply(this, arguments);
    aicxTab().catch(function(){});
  };
  async function aicxTab(){
    var tabs = document.getElementById('tabs'); if (!tabs || !db()) return;
    var ok = await aicxAccess();
    var old = tabs.querySelector('[data-tab="aic"]'); if (old) old.remove();
    if (!ok) return;
    var b = document.createElement('button');
    b.className = 'tab'; b.dataset.tab = 'aic'; b.setAttribute('onclick', "switchTab('aic')"); b.innerHTML = 'AIC';
    var adm = tabs.querySelector('[data-tab="admin"]');
    if (adm) tabs.insertBefore(b, adm); else tabs.appendChild(b);
    if (typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB === 'aic') b.classList.add('active');
  }

  var _rtX = renderTab;
  renderTab = function(){
    _rtX.apply(this, arguments);
    if (typeof CURRENT_TAB === 'undefined') return;
    if (CURRENT_TAB === 'aic') aicxMain();
    else if (CURRENT_TAB === 'admin') aicxStructMount();
  };

  /* ---------- Admin : configuration des structures AIC (CEO seul) ---------- */
  function aicxStructMount(){
    if (document.getElementById('aicStruct')) return;
    var anchor = document.getElementById('aicAdmin') || document.getElementById('adminZone'); if (!anchor) return;
    var d = document.createElement('div'); d.id = 'aicStruct'; d.style.marginTop = '22px';
    anchor.insertAdjacentElement('afterend', d);
    aicxStructLoad();
  }
  function structHead(){
    return '<div class="sec-eyebrow">AIC</div><div class="sec-title">Structures AIC : clients, missions, sites, membres</div>'
      + '<div class="sec-note">Réservé au CEO. Une mission = un AIC 1 + un AIC 2 + un AIC 3 par site accompagné. Rien n\u2019est supprimé : on archive.</div>';
  }
  async function aicxStructLoad(){
    var d = document.getElementById('aicStruct'); if (!d) return;
    d.innerHTML = structHead() + '<div class="panel" style="padding:14px 16px;">Chargement des structures AIC…</div>';
    try {
      await aicxAccess();
      if (!X.ceo){ d.innerHTML = '<div class="sec-eyebrow">AIC</div><div class="sec-title">Structures AIC</div><div class="panel" style="padding:12px 16px;">La configuration des structures AIC est réservée au CEO.</div>'; return; }
      await aicxLoad(); X.msg = '';
      if (!X.users.length) { try { var u = await db().from('user_access').select('email,role').order('email'); if (!u.error) X.users = u.data || []; } catch(_){} }
    } catch(e){
      var m = (e && e.message) || String(e);
      X.msg = 'Structures AIC indisponibles : ' + m + (/relation|does not exist|schema cache|function/i.test(m) ? ' — exécutez d\u2019abord le SQL de la brique 2.' : '');
    }
    aicxStructRender();
  }
  function aicxStructRender(){
    var d = document.getElementById('aicStruct'); if (!d) return;
    if (X.msg){ d.innerHTML = structHead() + '<div class="panel" style="padding:14px 16px;color:var(--signal);">' + esc(X.msg) + '</div>'; return; }
    var ms = X.missions.filter(visibleArch), h = structHead();
    h += '<div class="panel" style="padding:12px 16px 14px;"><div class="field-label">Nouvelle mission (nouveau client ou client existant)</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'
      + '<input id="nm_client" list="nm_clients" placeholder="Client" aria-label="Client" style="' + INP + 'width:170px;"><datalist id="nm_clients">' + clients().map(function(c){ return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>'
      + '<input id="nm_intitule" placeholder="Intitulé de la mission" aria-label="Intitulé" style="' + INP + 'width:240px;">'
      + '<input id="nm_perim" placeholder="Périmètre (sites, lignes…)" aria-label="Périmètre" style="' + INP + 'width:240px;">'
      + '<input id="nm_debut" type="date" aria-label="Début" style="' + INP + '"><input id="nm_fin" type="date" aria-label="Fin" style="' + INP + '">'
      + '<button type="button" class="add-btn sm" onclick="aicxNewMission()">+ Créer (AIC 1 et AIC 2 inclus)</button> <span id="nm_msg" role="status" style="font-size:12px;"></span></div></div>';
    h += '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;margin-top:12px;"><input type="checkbox" ' + (X.showArch ? 'checked ' : '') + 'onchange="aicxToggleArch(this.checked)" style="width:auto;margin:0;">Afficher les archives</label>';
    var last = null;
    h += ms.length ? ms.map(function(m){ var t = ''; if (m.client !== last){ last = m.client; t = '<div class="field-label" style="margin-top:16px;">' + esc(m.client) + '</div>'; } return t + missionBlock(m, true); }).join('')
                   : '<div class="panel" style="padding:14px 16px;margin-top:12px;">Aucune mission. Créez la première ci-dessus.</div>';
    d.innerHTML = h;
  }
  function clients(){ var seen = {}, out = []; X.missions.forEach(function(m){ if (m.client && !seen[m.client]){ seen[m.client] = 1; out.push(m.client); } }); return out; }
  function aicxRerender(){ if (document.getElementById('aicStruct')) aicxStructRender(); else aicxRender(); }

  /* ---------- Chargement ---------- */
  async function aicxLoad(){
    if (!db()) throw new Error('Supabase non initialisé');
    var a = await db().from('aic_missions').select('*').order('client', { ascending:true }).order('created_at', { ascending:true }); if (a.error) throw a.error;
    var b = await db().from('aic_espaces').select('*').order('niveau', { ascending:true }).order('libelle', { ascending:true }); if (b.error) throw b.error;
    var c = await db().from('aic_membres').select('*').order('email', { ascending:true }); if (c.error) throw c.error;
    X.missions = a.data || []; X.espaces = b.data || []; X.membres = c.data || [];
  }
  async function aicxMain(){
    var v = view(); if (!v) return;
    v.innerHTML = head() + '<div class="panel" style="padding:14px 16px;">Chargement des espaces AIC…</div>';
    try {
      await aicxAccess(); await aicxLoad(); X.msg = '';
    } catch(e){
      var m = (e && e.message) || String(e);
      X.msg = 'Espaces AIC indisponibles : ' + m + (/relation|does not exist|schema cache|function/i.test(m) ? ' — exécutez d\u2019abord le SQL de la brique 2.' : '');
    }
    aicxRender();
  }
  function aicxRender(){ if (X.msg){ view().innerHTML = head() + '<div class="panel" style="padding:14px 16px;color:var(--signal);">' + esc(X.msg) + '</div>'; return; } if (X.open && byId(X.espaces, X.open)) aicxDashboard(); else { X.open = null; aicxList(); } }
  function head(){
    return '<div class="sec-eyebrow">AIC</div><div class="sec-title">Espaces par mission</div>'
      + '<div class="sec-note">Un espace par niveau et par mission, strictement cloisonnés : vous ne voyez que les espaces dont vous êtes membre (et ceux placés sous eux).' + (X.ceo ? ' Configuration : Admin › Structures AIC.' : '') + '</div>';
  }

  /* ---------- Liste : missions > cascade ---------- */
  function membresDe(eid, tous){ return X.membres.filter(function(m){ return m.espace_id === eid && (tous || m.actif); }); }
  function espDe(mid){ return X.espaces.filter(function(e){ return e.mission_id === mid; }); }
  function visibleArch(o){ return X.showArch || !o.archived_at; }

  function espRow(e, depth, cfg){
    var n = membresDe(e.id).length, arch = !!e.archived_at;
    var ind = (depth - 1) * 22;
    var h = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 0 7px ' + ind + 'px;border-bottom:1px solid rgba(86,10,15,.08);' + (arch ? 'opacity:.55;' : '') + '">'
      + '<span style="color:rgba(86,10,15,.45);">' + (depth > 1 ? '└' : '') + '</span>'
      + '<b style="font-size:13px;">' + esc(e.libelle) + '</b>'
      + '<span class="sub-cell">' + esc(NIV_LBL[e.niveau]) + ' · ' + n + ' membre(s)</span>' + (arch ? '<span class="pill p-grey">archivé</span>' : '')
      + '<span style="margin-left:auto;white-space:nowrap;">'
      + (cfg ? '' : '<button type="button" class="add-btn sm" onclick="aicxOpen(\'' + e.id + '\')">Ouvrir</button> ')
      + (cfg ? '<button type="button" class="add-btn sm ghost" onclick="aicxToggleMem(\'' + e.id + '\')">Membres</button> ' : '')
      + (cfg && e.niveau === 3 ? '<button type="button" class="add-btn sm ghost" onclick="aicxArchive(\'esp\',\'' + e.id + '\',' + (arch ? 'false' : 'true') + ')">' + (arch ? 'Réactiver' : 'Archiver') + '</button>' : '')
      + '</span></div>';
    if (cfg && X.openMem === e.id) h += memPanel(e);
    return h;
  }
  function memPanel(e){
    var list = membresDe(e.id, true);
    var opts = X.users.map(function(u){ return '<option value="' + esc(u.email) + '">' + esc(u.role || '') + '</option>'; }).join('');
    return '<div style="margin:6px 0 10px ' + ((e.niveau - 1) * 22 + 14) + 'px;padding:10px 12px;background:rgba(86,10,15,.04);border-radius:8px;">'
      + (list.length ? list.map(function(m){
          return '<div style="display:flex;align-items:center;gap:8px;font-size:13px;padding:3px 0;' + (m.actif ? '' : 'opacity:.5;') + '"><span>' + esc(m.email) + '</span><span class="sub-cell">' + esc(m.acces) + (m.actif ? '' : ' · retiré') + '</span>'
            + '<button type="button" class="add-btn sm ghost" style="margin-left:auto;" onclick="aicxMemberToggle(\'' + m.id + '\',' + (m.actif ? 'false' : 'true') + ')">' + (m.actif ? 'Retirer' : 'Réactiver') + '</button></div>';
        }).join('') : '<div class="sub-cell">Aucun membre.</div>')
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center;">'
      + '<input id="mb_' + e.id + '" list="mbl_' + e.id + '" placeholder="e-mail du compte Cockpit" aria-label="E-mail" style="' + INP + 'width:240px;"><datalist id="mbl_' + e.id + '">' + opts + '</datalist>'
      + '<select id="ma_' + e.id + '" aria-label="Accès" style="' + INP + '">' + ACCES.map(function(a){ return '<option value="' + a[0] + '"' + (a[0] === 'contribution' ? ' selected' : '') + '>' + a[1] + '</option>'; }).join('') + '</select>'
      + '<button type="button" class="add-btn sm" onclick="aicxMemberAdd(\'' + e.id + '\')">+ Ajouter</button> <span id="mm_' + e.id + '" role="status" style="font-size:12px;"></span></div></div>';
  }
  function missionBlock(m, cfg){
    var arch = !!m.archived_at, es = espDe(m.id).filter(visibleArch);
    /* Arbre construit sur ce qui est visible : un espace dont le parent n'est pas visible devient une racine
       (ex. un membre d'un seul AIC 3 voit son site au premier niveau). */
    var ids = {}; es.forEach(function(e){ ids[e.id] = 1; });
    var tree = '';
    function walk(list, depth){ list.forEach(function(e){ tree += espRow(e, depth, cfg); walk(es.filter(function(c){ return c.parent_id === e.id; }), depth + 1); }); }
    walk(es.filter(function(e){ return !e.parent_id || !ids[e.parent_id]; }), 1);
    if (!es.length) tree = '<div class="sub-cell" style="padding:8px 0;">Aucun espace visible pour vous dans cette mission.</div>';
    var dates = (m.date_debut || m.date_fin) ? (fdate(m.date_debut) + ' → ' + fdate(m.date_fin)) : '';
    var add = '';
    if (cfg && !arch) {
      var p2 = espDe(m.id).filter(function(e){ return e.niveau === 2 && !e.archived_at; })[0];
      add = p2 ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;align-items:center;"><input id="s_' + m.id + '" placeholder="Nouveau site (ex. Usine de Lyon)" aria-label="Site" style="' + INP + 'width:280px;"><button type="button" class="add-btn sm" onclick="aicxAddSite(\'' + m.id + '\',\'' + p2.id + '\')">+ Ajouter un site (AIC 3)</button> <span id="sm_' + m.id + '" role="status" style="font-size:12px;"></span></div>' : '';
    }
    return '<div class="panel" style="padding:12px 16px 14px;margin-top:12px;' + (arch ? 'opacity:.65;' : '') + '">'
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b>' + esc(m.client) + ' · ' + esc(m.intitule) + '</b>'
      + (dates ? '<span class="sub-cell">' + esc(dates) + '</span>' : '') + (arch ? '<span class="pill p-grey">archivée</span>' : '')
      + (cfg ? '<button type="button" class="add-btn sm ghost" style="margin-left:auto;" onclick="aicxArchive(\'mis\',\'' + m.id + '\',' + (arch ? 'false' : 'true') + ')">' + (arch ? 'Réactiver la mission' : 'Archiver la mission') + '</button>' : '') + '</div>'
      + (m.perimetre ? '<div class="sub-cell" style="margin:4px 0 6px;">Périmètre : ' + esc(m.perimetre) + '</div>' : '')
      + tree + add + '</div>';
  }
  function aicxList(){
    var ms = X.missions.filter(visibleArch);
    var h = head();
    h += '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;margin-top:12px;"><input type="checkbox" ' + (X.showArch ? 'checked ' : '') + 'onchange="aicxToggleArch(this.checked)" style="width:auto;margin:0;">Afficher les archives</label>';
    h += ms.length ? ms.map(function(m){ return missionBlock(m, false); }).join('') : '<div class="panel" style="padding:14px 16px;margin-top:12px;">' + (X.ceo ? 'Aucune mission. Créez-en une dans Admin › Structures AIC.' : 'Vous n\u2019êtes membre d\u2019aucun espace AIC actif.') + '</div>';
    view().innerHTML = h;
  }

  /* ---------- Actions de configuration (appelées depuis Admin ; la RLS impose « CEO seul ») ---------- */
  window.aicxToggleArch = function(on){ X.showArch = !!on; aicxRerender(); };
  window.aicxToggleMem = function(id){ X.openMem = (X.openMem === id) ? null : id; aicxRerender(); };
  window.aicxNewMission = async function(){
    var client = val('nm_client'), intitule = val('nm_intitule');
    if (!client || !intitule){ flash('nm_msg', false, 'Client et intitulé obligatoires.'); return; }
    var row = { client:client, intitule:intitule, perimetre:val('nm_perim') || null, date_debut:val('nm_debut') || null, date_fin:val('nm_fin') || null };
    try { var r = await db().from('aic_missions').insert(row); if (r.error) throw r.error; await aicxLoad(); aicxRerender(); flash('nm_msg', true, '✓ Mission créée'); }
    catch(e){ flash('nm_msg', false, 'Refusé : ' + ((e && e.message) || e)); }
  };
  window.aicxAddSite = async function(mid, parentId){
    var site = val('s_' + mid), m = byId(X.missions, mid);
    if (!site){ flash('sm_' + mid, false, 'Nom du site obligatoire.'); return; }
    var lib = 'AIC 3 · ' + (m ? m.client : '') + ' · ' + site;
    if (X.espaces.some(function(e){ return e.mission_id === mid && e.niveau === 3 && !e.archived_at && e.libelle.toLowerCase() === lib.toLowerCase(); })){ flash('sm_' + mid, false, 'Ce site existe déjà.'); return; }
    try { var r = await db().from('aic_espaces').insert({ mission_id:mid, niveau:3, libelle:lib, parent_id:parentId }); if (r.error) throw r.error; await aicxLoad(); aicxRerender(); flash('sm_' + mid, true, '✓ Site ajouté'); }
    catch(e){ flash('sm_' + mid, false, 'Refusé : ' + ((e && e.message) || e)); }
  };
  window.aicxArchive = async function(kind, id, on){
    var ts = on ? new Date().toISOString() : null;
    if (on && !confirm(kind === 'mis' ? 'Archiver cette mission et tous ses espaces ? (réversible, rien n\u2019est supprimé)' : 'Archiver ce site ? (réversible, rien n\u2019est supprimé)')) return;
    try {
      var r;
      if (kind === 'mis'){
        r = await db().from('aic_missions').update({ archived_at:ts, statut:on ? 'archivee' : 'active', updated_at:new Date().toISOString() }).eq('id', id); if (r.error) throw r.error;
        r = await db().from('aic_espaces').update({ archived_at:ts, updated_at:new Date().toISOString() }).eq('mission_id', id); if (r.error) throw r.error;
      } else {
        r = await db().from('aic_espaces').update({ archived_at:ts, updated_at:new Date().toISOString() }).eq('id', id); if (r.error) throw r.error;
      }
      await aicxLoad(); aicxRerender();
    } catch(e){ alert('Archivage refusé : ' + ((e && e.message) || e)); }
  };
  window.aicxMemberAdd = async function(eid){
    var em = val('mb_' + eid).toLowerCase(), ac = val('ma_' + eid) || 'contribution', mid = 'mm_' + eid;
    if (!em || em.indexOf('@') < 1){ flash(mid, false, 'E-mail invalide.'); return; }
    try {
      var r = await db().from('aic_membres').upsert({ espace_id:eid, email:em, acces:ac, actif:true, updated_at:new Date().toISOString() }, { onConflict:'espace_id,email' });
      if (r.error) throw r.error;
      await aicxLoad(); aicxRerender(); flash('mm_' + eid, true, '✓ Ajouté');
    } catch(e){ flash(mid, false, 'Refusé : ' + ((e && e.message) || e)); }
  };
  window.aicxMemberToggle = async function(id, on){
    try { var r = await db().from('aic_membres').update({ actif:!!on, updated_at:new Date().toISOString() }).eq('id', id); if (r.error) throw r.error; await aicxLoad(); aicxRerender(); }
    catch(e){ alert('Refusé : ' + ((e && e.message) || e)); }
  };

  /* ---------- Tableau de bord d'un espace ---------- */
  window.aicxOpen = async function(id){
    X.open = id; X.ref = null; X.acts = null;
    view().innerHTML = head() + '<div class="panel" style="padding:14px 16px;">Chargement de l\u2019espace…</div>';
    var e = byId(X.espaces, id); if (!e) { aicxRender(); return; }
    try {
      var a = await db().from('aic_thematiques').select('*').order('ordre', { ascending:true }); if (a.error) throw a.error;
      var b = await db().from('aic_indicateurs').select('*').order('ordre', { ascending:true }); if (b.error) throw b.error;
      X.ref = { them:a.data || [], ind:b.data || [] };
    } catch(err){ X.ref = { err:(err && err.message) || String(err) }; }
    try {
      var q = await db().from('actions').select('libelle,statut,echeance').eq('routine', e.libelle).is('archived_at', null).limit(100);
      X.acts = q.error ? { err:q.error.message } : { list:q.data || [] };
    } catch(err2){ X.acts = { err:(err2 && err2.message) || String(err2) }; }
    window.scrollTo(0, 0); aicxDashboard();
  };
  window.aicxBack = function(){ X.open = null; aicxRender(); };

  function aicxDashboard(){
    var e = byId(X.espaces, X.open); if (!e) { aicxList(); return; }
    var m = byId(X.missions, e.mission_id) || {};
    var chain = [], cur = e; while (cur) { chain.unshift(cur); cur = cur.parent_id ? byId(X.espaces, cur.parent_id) : null; }
    var crumb = esc(m.client || '') + ' · ' + esc(m.intitule || '') + chain.map(function(c){ return ' › ' + esc(NIV_LBL[c.niveau]); }).join('');
    var h = head() + '<div style="margin:6px 0 10px;"><button type="button" class="add-btn sm ghost" onclick="aicxBack()">← Tous les espaces</button></div>'
      + '<div class="panel" style="padding:14px 16px;"><div class="sub-cell">' + crumb + '</div><div class="sec-title" style="font-size:20px;margin:4px 0 6px;">' + esc(e.libelle) + (e.archived_at ? ' <span class="pill p-grey">archivé</span>' : '') + '</div>'
      + '<div class="sub-cell">Membres : ' + (membresDe(e.id).map(function(x){ return esc(x.email); }).join(', ') || 'aucun') + '</div></div>';

    var fils = X.espaces.filter(function(x){ return x.parent_id === e.id && visibleArch(x); });
    if (e.niveau < 3) {
      h += '<div class="field-label" style="margin-top:16px;">' + (e.niveau === 1 ? 'Espace AIC 2' : 'Sites (AIC 3)') + '</div>';
      h += fils.length ? '<div style="display:flex;gap:10px;flex-wrap:wrap;">' + fils.map(function(f){
          return '<div class="panel" style="padding:10px 14px;min-width:220px;"><b style="font-size:13px;">' + esc(f.libelle) + '</b><div class="sub-cell" style="margin:3px 0 8px;">' + membresDe(f.id).length + ' membre(s)</div><button type="button" class="add-btn sm" onclick="aicxOpen(\'' + f.id + '\')">Ouvrir</button></div>';
        }).join('') + '</div>' : '<div class="panel" style="padding:12px 16px;">Aucun espace en dessous pour le moment.</div>';
    }

    h += '<div class="field-label" style="margin-top:16px;">Indicateurs attendus à ce niveau</div>';
    if (!X.ref || X.ref.err) h += '<div class="panel" style="padding:12px 16px;color:var(--signal);">Référentiel indisponible' + (X.ref ? ' : ' + esc(X.ref.err) : '') + '.</div>';
    else {
      var them = X.ref.them.filter(function(t){ return t.actif && (t.niveaux || []).indexOf(e.niveau) >= 0; }), any = false;
      them.forEach(function(t){
        var ind = X.ref.ind.filter(function(x){ return x.actif && x.thematique_id === t.id && (x.niveaux || []).indexOf(e.niveau) >= 0; });
        if (!ind.length) return; any = true;
        h += '<div class="panel" style="padding:10px 16px 12px;margin-top:10px;overflow-x:auto;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="width:12px;height:12px;border-radius:3px;background:' + esc(t.couleur) + ';display:inline-block;"></span><b>' + esc(t.code) + ' · ' + esc(t.libelle) + '</b></div>'
          + '<table style="width:100%;"><thead><tr><th>Indicateur</th><th>Unité</th><th>Cible</th><th>Sens</th><th>Fréquence</th><th>Dernière valeur</th></tr></thead><tbody>'
          + ind.map(function(x){ return '<tr><td>' + esc(x.libelle) + '</td><td>' + esc(x.unite) + '</td><td>' + (x.cible != null ? esc(x.cible) : '—') + '</td><td>' + (x.sens === 'bas' ? '↓ plus bas = mieux' : '↑ plus haut = mieux') + '</td><td>' + esc(x.frequence) + '</td><td class="sub-cell">—</td></tr>'; }).join('')
          + '</tbody></table></div>';
      });
      if (!any) h += '<div class="panel" style="padding:12px 16px;">Aucun indicateur actif défini pour ce niveau (Admin › Référentiel AIC).</div>';
    }

    h += '<div class="field-label" style="margin-top:16px;">Actions Clap! rattachées (routine « ' + esc(e.libelle) + ' »)</div>';
    if (!X.acts || X.acts.err) h += '<div class="panel" style="padding:12px 16px;color:var(--signal);">Actions indisponibles' + (X.acts ? ' : ' + esc(X.acts.err) : '') + '.</div>';
    else if (!X.acts.list.length) h += '<div class="panel" style="padding:12px 16px;">Aucune action rattachée. Dans « Réunions & Rituels et Actions », renseignez le champ Routine avec le libellé ci-dessus.</div>';
    else h += '<div class="panel" style="padding:8px 16px;">' + X.acts.list.map(function(a){ return '<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid rgba(86,10,15,.08);font-size:13px;"><span>' + esc(a.libelle) + '</span><span class="sub-cell" style="margin-left:auto;white-space:nowrap;">' + esc(a.statut || '') + (a.echeance ? ' · ' + esc(fdate(a.echeance)) : '') + '</span></div>'; }).join('') + '</div>';

    view().innerHTML = h;
  }

  window.aicxReload = function(){ return document.getElementById('aicStruct') ? aicxStructLoad() : aicxMain(); };
})();
