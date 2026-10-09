/* COCKPIT KW — Module AIC · Brique 2 (public/shared/aic-espaces.js)
   CONFIGURATION (Admin, CEO seul) : clients, missions, sites (AIC 3), membres.
   EXPLOITATION (onglet AIC) : liste des espaces accessibles + tableau de bord par espace, en lecture.
   Additif : enrobe render() et renderTab() sans les modifier. Aucune suppression : archivage / désactivation.
   Le cloisonnement et le droit « CEO seul » sont garantis par la RLS (aic_brique2.sql) ; l'interface ne fait que les refléter. */
(function(){
  if (typeof renderTab !== 'function' || typeof render !== 'function') return;

  var X = { missions:[], espaces:[], membres:[], users:[], ceo:false, access:null, email:'', showArch:false,
            open:null, openMem:null, session:null, msg:'' };
  var ACCES = [['lecture','Lecture'], ['contribution','Contribution'], ['animation','Animation']];
  var NIV_LBL = { 1:'AIC 1 · CEO', 2:'AIC 2 · Resp. programme', 3:'AIC 3 · Chef de projet site' };
  var INP = 'height:34px;padding:0 8px;border:1px solid rgba(86,10,15,.25);border-radius:6px;font-size:13px;box-sizing:border-box;';

  function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function db(){ return (typeof SB !== 'undefined' && SB) ? SB : null; }
  function val(id){ var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function me(){ return String((typeof CURRENT_EMAIL !== 'undefined' && CURRENT_EMAIL) || '').toLowerCase(); }
  /* Une modification bloquée par la RLS renvoie 0 ligne SANS erreur : on exige au moins une ligne touchée. */
  function touched(r, table){
    if (r && r.error) throw r.error;
    if (!r || !r.data || !r.data.length) throw new Error('aucune ligne modifiée : droit d\u2019écriture refusé par la base (' + table + ')');
    return r;
  }
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
    h += '<div class="panel" style="padding:12px 16px 14px;margin-top:12px;"><div class="field-label">Importer des mesures ICM® (Humetria) · agrégées par site</div>'
      + '<div class="sub-cell" style="margin-bottom:6px;">Une ligne par mesure : <code>réf_site ; AAAA-MM-JJ ; ICM % ; nb managers [; M1 ; M2 ; M3 ; M4 ; M5 ; M6]</code>. Minimum 3 managers par site, aucun nom de manager. Renseignez d\u2019abord la « réf. Humetria » de chaque site ci-dessous. Humetria peut aussi envoyer ces mesures automatiquement (fonction <code>aic-icm-ingest</code>).</div>'
      + '<textarea id="icm_paste" rows="4" aria-label="Mesures ICM" placeholder="LYON-01 ; 2026-10-01 ; 62,5 ; 8 ; 60 ; 48 ; 70 ; 55 ; 66 ; 73" style="width:100%;box-sizing:border-box;border:1px solid rgba(86,10,15,.25);border-radius:8px;padding:8px;font:inherit;font-size:13px;"></textarea>'
      + '<div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><button type="button" class="add-btn sm" onclick="aicxImportIcm()">Importer</button><span id="icm_msg" role="status" style="font-size:12px;"></span></div></div>';
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
      if (X.open && byId(X.espaces, X.open)) await aicxLoadSpace();   /* données fraîches à chaque retour sur l'onglet */
    } catch(e){
      var m = (e && e.message) || String(e);
      X.msg = 'Espaces AIC indisponibles : ' + m + (/relation|does not exist|schema cache|function/i.test(m) ? ' — exécutez d\u2019abord le SQL de la brique 2.' : '');
    }
    aicxRender();
  }
  function aicxRender(){ if (!X.msg && X.session && byId(X.espaces, X.session.espaceId)){ aicxStartSession(X.session.crId, X.session.pane, true, X.session.mode, X.session.date); return; } if (X.msg){ view().innerHTML = head() + '<div class="panel" style="padding:14px 16px;color:var(--signal);">' + esc(X.msg) + '</div>'; return; } if (X.open && byId(X.espaces, X.open)) aicxDashboard(); else { X.open = null; aicxList(); } }
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
      + (cfg && e.niveau === 3 ? '<span style="display:inline-flex;gap:4px;align-items:center;"><input id="hr_' + e.id + '" value="' + esc(e.humetria_ref || '') + '" placeholder="réf. Humetria" aria-label="Référence du site dans Humetria" style="' + INP + 'width:150px;height:28px;"><button type="button" class="add-btn sm ghost" onclick="aicxSetRef(\'' + e.id + '\')">OK</button><span id="hs_' + e.id + '" role="status" style="font-size:12px;"></span></span>' : '')
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
  window.aicxSetRef = async function(id){
    var v = val('hr_' + id) || null, mid = 'hs_' + id;
    try { touched(await db().from('aic_espaces').update({ humetria_ref:v, updated_at:new Date().toISOString() }).eq('id', id).select('id'), 'aic_espaces'); await aicxLoad(); aicxRerender(); flash(mid, true, '✓ Enregistré'); }
    catch(e){ var m = (e && e.message) || String(e); flash(mid, false, /duplicate|unique/i.test(m) ? 'Cette référence est déjà utilisée par un autre site.' : (/column|schema cache/i.test(m) ? 'Exécutez d\u2019abord aic_brique3b_icm.sql.' : 'Refusé : ' + m)); }
  };
  /* Import collé : réf ; date ; ICM % ; nb managers [; M1..M6]. Mêmes règles que la fonction serveur. */
  window.aicxImportIcm = async function(){
    var raw = (document.getElementById('icm_paste') || {}).value || '', lines = raw.split(/\r?\n/), rows = [], rej = [], today1 = addDaysIso(1);
    function num(v){ v = String(v == null ? '' : v).trim().replace(',', '.'); return v === '' ? NaN : Number(v); }
    lines.forEach(function(ln, i){
      if (!ln.trim()) return; var c = ln.split(/;|\t/).map(function(x){ return x.trim(); });
      if (i === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(c[1] || '')) return;      /* ligne d'en-tête */
      var esp = X.espaces.filter(function(e){ return e.niveau === 3 && !e.archived_at && e.humetria_ref && e.humetria_ref === c[0]; })[0], pct = num(c[2]), nb = num(c[3]), why = '';
      if (!c[0]) why = 'réf. manquante'; else if (!esp) why = 'site inconnu (réf. « ' + c[0] + ' » à saisir dans la liste des sites)';
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(c[1] || '') || isNaN(Date.parse(c[1] + 'T00:00:00Z'))) why = 'date invalide (AAAA-MM-JJ)'; else if (c[1] > today1) why = 'date dans le futur';
      else if (!isFinite(pct) || pct < 0 || pct > 100) why = 'ICM % hors de 0 à 100'; else if (!Number.isInteger(nb)) why = 'nb managers manquant'; else if (nb < 3) why = 'moins de 3 managers (confidentialité)';
      var det = {}; if (!why) for (var k = 1; k <= 6; k++){ var raw6 = c[3 + k]; if (raw6 === undefined || raw6 === '') continue; var v6 = num(raw6); if (!isFinite(v6) || v6 < 0 || v6 > 100){ why = 'M' + k + ' hors de 0 à 100'; break; } det['M' + k] = Math.round(v6 * 100) / 100; }
      if (why) rej.push('ligne ' + (i + 1) + ' : ' + why); else rows.push({ espace_id:esp.id, mesure_le:c[1], icm_pct:Math.round(pct * 100) / 100, nb_managers:nb, detail:Object.keys(det).length ? det : null, source:'import' });
    });
    if (!rows.length && !rej.length){ flash('icm_msg', false, 'Rien à importer.'); return; }
    try {
      if (rows.length) touched(await db().from('aic_icm').upsert(rows, { onConflict:'espace_id,mesure_le' }).select('id'), 'aic_icm');
      var msg = '✓ ' + rows.length + ' mesure(s) importée(s)' + (rej.length ? ' · ' + rej.length + ' rejetée(s) — ' + rej.slice(0, 4).join(' | ') + (rej.length > 4 ? ' …' : '') : '');
      flash('icm_msg', !rej.length, msg); if (rows.length && !rej.length) document.getElementById('icm_paste').value = '';
    } catch(e){ var m = (e && e.message) || String(e); flash('icm_msg', false, /relation|schema cache|does not exist/i.test(m) ? 'Exécutez d\u2019abord aic_brique3b_icm.sql.' : 'Refusé : ' + m); }
  };
  function addDaysIso(n){ var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  window.aicxArchive = async function(kind, id, on){
    var ts = on ? new Date().toISOString() : null;
    if (on && !confirm(kind === 'mis' ? 'Archiver cette mission et tous ses espaces ? (réversible, rien n\u2019est supprimé)' : 'Archiver ce site ? (réversible, rien n\u2019est supprimé)')) return;
    try {
      var r;
      if (kind === 'mis'){
        r = touched(await db().from('aic_missions').update({ archived_at:ts, statut:on ? 'archivee' : 'active', updated_at:new Date().toISOString() }).eq('id', id).select('id'), 'aic_missions');
        r = touched(await db().from('aic_espaces').update({ archived_at:ts, updated_at:new Date().toISOString() }).eq('mission_id', id).select('id'), 'aic_espaces');
      } else {
        r = touched(await db().from('aic_espaces').update({ archived_at:ts, updated_at:new Date().toISOString() }).eq('id', id).select('id'), 'aic_espaces');
      }
      await aicxLoad(); aicxRerender();
    } catch(e){ alert('Archivage refusé : ' + ((e && e.message) || e)); }
  };
  window.aicxMemberAdd = async function(eid){
    var em = val('mb_' + eid).toLowerCase(), ac = val('ma_' + eid) || 'contribution', mid = 'mm_' + eid;
    if (!em || em.indexOf('@') < 1){ flash(mid, false, 'E-mail invalide.'); return; }
    try {
      touched(await db().from('aic_membres').upsert({ espace_id:eid, email:em, acces:ac, actif:true, updated_at:new Date().toISOString() }, { onConflict:'espace_id,email' }).select('id'), 'aic_membres');
      await aicxLoad(); aicxRerender(); flash('mm_' + eid, true, '✓ Ajouté');
    } catch(e){ flash(mid, false, 'Refusé : ' + ((e && e.message) || e)); }
  };
  window.aicxMemberToggle = async function(id, on){
    try { touched(await db().from('aic_membres').update({ actif:!!on, updated_at:new Date().toISOString() }).eq('id', id).select('id'), 'aic_membres'); await aicxLoad(); aicxRerender(); }
    catch(e){ alert('Refusé : ' + ((e && e.message) || e)); }
  };

  /* ---------- Tableau de bord SQCDP d'un espace ---------- */
  var SC = { vert:{ c:'#2e7d46', g:'✓', l:'Vert', d:'Objectif tenu' }, orange:{ c:'#e08a00', g:'!', l:'Orange', d:'Écart, à surveiller' }, rouge:{ c:'#c0392b', g:'✕', l:'Rouge', d:'Objectif non tenu, action requise' } };
  var RANK = { vert:1, orange:2, rouge:3 }, BYRANK = ['', 'vert', 'orange', 'rouge'];
  var MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  var JOURS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  var TOL = 0.10;                                   /* tolérance « orange » autour de la cible (10 %) */
  var SP = { ref:null, acts:null, st:[], val:[], stErr:'', valErr:'', seances:[], seErr:'', icm:[], vm:[], icmErr:'', icmOn:false, month:'', sel:null, edit:null, ind:{}, chart:{ days:30, target:true, avg:false, metric:{} } };
  SP.chart = { t:{} };       /* réglages PERSONNELS de courbe par thématique (navigateur) ; le défaut vient de l'Admin */
  try { var _cp = JSON.parse(localStorage.getItem('aicxChart2') || 'null'); if (_cp && typeof _cp === 'object' && _cp.t) SP.chart = { t:_cp.t }; } catch(_){}
  function saveChartPref(){ try { localStorage.setItem('aicxChart2', JSON.stringify(SP.chart)); } catch(_){} }

  function pad(n){ return n < 10 ? '0' + n : '' + n; }
  function iso(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayIso(){ return iso(new Date()); }
  function curMonth(){ return todayIso().slice(0, 7); }
  function addDays(j, n){ var p = j.split('-'); return iso(new Date(+p[0], +p[1] - 1, +p[2] + n)); }
  function bounds(m){ var p = m.split('-'), y = +p[0], mo = +p[1], n = new Date(y, mo, 0).getDate(); return { y:y, mo:mo, n:n, first:y + '-' + pad(mo) + '-01', last:y + '-' + pad(mo) + '-' + pad(n) }; }
  function longDate(j){ var p = j.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]); return JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()]; }
  function shortDate(j){ var p = j.split('-'); return p[2] + '/' + p[1]; }
  function fmt(n){ if (n == null || n === '' || isNaN(n)) return '—'; return String(Math.round(Number(n) * 100) / 100).replace('.', ','); }
  function leaves(e){ if (e.niveau === 3) return [e]; var out = []; (function walk(id){ X.espaces.filter(function(c){ return c.parent_id === id && !c.archived_at; }).forEach(function(c){ if (c.niveau === 3) out.push(c); else walk(c.id); }); })(e.id); return out; }
  function siteName(e){ return e && e.niveau === 3 ? e.libelle.split(' · ').slice(2).join(' · ') || null : null; }
  function themsFor(e){ return (SP.ref && !SP.ref.err) ? SP.ref.them.filter(function(t){ return t.actif && (t.niveaux || []).indexOf(e.niveau) >= 0; }) : []; }
  function indsFor(th, e){ return (SP.ref && !SP.ref.err) ? SP.ref.ind.filter(function(x){ return x.actif && x.thematique_id === th.id && (x.niveaux || []).indexOf(e.niveau) >= 0; }) : []; }
  function indexSt(){ var m = {}; SP.st.forEach(function(s){ m[s.espace_id + '|' + s.thematique_id + '|' + s.jour] = s; }); return m; }
  function indexVal(){ var m = {}; SP.val.forEach(function(s){ m[s.espace_id + '|' + s.indicateur_id + '|' + s.jour] = s; }); return m; }
  function memberAcces(e, accesList){ return X.membres.some(function(m){ return m.espace_id === e.id && m.actif && m.email === me() && accesList.indexOf(m.acces) >= 0; }); }
  function canWrite(e){ if (!e || e.niveau !== 3 || e.archived_at) return false; return X.ceo || memberAcces(e, ['contribution', 'animation']); }
  function canAnimate(e){ if (!e || e.archived_at) return false; return memberAcces(e, ['animation']); }   /* animateur de CET espace uniquement (le CEO doit en être membre « animation ») */

  /* Pire situation parmi les sites : rouge > orange > vert. n = nombre de sites ayant un relevé ce jour-là. */
  function agg(IX, thId, jour, ids){
    var best = 0, n = 0;
    ids.forEach(function(id){ var s = IX[id + '|' + thId + '|' + jour]; if (s && RANK[s.statut]){ n++; if (RANK[s.statut] > best) best = RANK[s.statut]; } });
    return { st:best ? BYRANK[best] : null, n:n };
  }
  function refDay(IX, thId, ids){
    var b = bounds(SP.month);
    if (SP.month === curMonth()) return todayIso();
    for (var d = b.n; d >= 1; d--){ var j = SP.month + '-' + pad(d); if (agg(IX, thId, j, ids).st) return j; }
    return null;
  }
  /* Valeur d'un indicateur un jour donné : moyenne des sites qui ont une valeur. */
  function valDay(IXV, indId, ids, j){
    var s = 0, n = 0; ids.forEach(function(id){ var r = IXV[id + '|' + indId + '|' + j]; if (r && r.valeur != null && r.valeur !== ''){ s += Number(r.valeur); n++; } });
    return n ? { v:s / n, n:n } : null;
  }
  function lastVal(IXV, indId, ids, ref){
    for (var k = 0; k < 90; k++){ var j = addDays(ref, -k), r = valDay(IXV, indId, ids, j); if (r) return { v:r.v, n:r.n, j:j }; }
    return null;
  }
  /* Tendance : moyenne des 7 derniers jours vs 7 jours précédents. fav = évolution favorable selon le sens de l'indicateur. */
  function trendOf(get, ref, sens){
    function mean(from){ var s = 0, n = 0; for (var k = 0; k < 7; k++){ var v = get(addDays(from, -k)); if (v != null){ s += v; n++; } } return n ? s / n : null; }
    var a = mean(ref), b = mean(addDays(ref, -7));
    if (a == null || b == null) return { dir:null };
    var d = a - b, pct = b !== 0 ? d / Math.abs(b) : null;
    if (d === 0 || (pct != null && Math.abs(pct) < 0.02)) return { dir:'flat', fav:null, pct:pct, a:a, b:b };
    return { dir:d > 0 ? 'up' : 'down', fav:(sens === 'bas') ? d < 0 : d > 0, pct:pct, a:a, b:b };
  }
  /* Couleur suggérée d'une valeur au regard de la cible. */
  function suggest(ind, v){
    if (ind.cible == null || v == null || isNaN(v)) return null; var c = Number(ind.cible);
    if (ind.sens === 'bas') return v <= c ? 'vert' : (v <= c * (1 + TOL) ? 'orange' : 'rouge');
    return v >= c ? 'vert' : (v >= c * (1 - TOL) ? 'orange' : 'rouge');
  }

  /* ----- Configuration du pavé SQCDP, définie par thématique dans Admin › Référentiel AIC ----- */
  function cfgOf(th){
    var c = (th && th.config && typeof th.config === 'object') ? th.config : {}, p = c.pave || {}, k = c.courbe || {};
    return { pave:{ statut:p.statut !== false, indic:p.indic !== false, tend:p.tend !== false, courbe:p.courbe !== false, bande:p.bande !== false },
             indPrincipal:c.ind_principal || null,
             courbe:{ metric:k.metric || 'auto', jours:[7, 30, 90].indexOf(k.jours) >= 0 ? k.jours : 30, cible:k.cible !== false, moyenne:!!k.moyenne } };
  }
  function principalInd(th, inds){ var pick = SP.ind[th.id]; return inds.filter(function(i){ return i.id === pick; })[0] || inds.filter(function(i){ return i.id === cfgOf(th).indPrincipal; })[0] || inds[0] || null; }
  function chartCfg(th){ var c = cfgOf(th).courbe, u = (SP.chart.t || {})[th.id] || {}; return { metric:u.metric || c.metric, days:u.days || c.jours, target:u.target !== undefined ? u.target : c.cible, avg:u.avg !== undefined ? u.avg : c.moyenne, custom:!!(u.metric || u.days || u.target !== undefined || u.avg !== undefined) }; }

  /* ----- SVG : smiley, flèche, courbe ----- */
  function face(st, size){
    var col = st ? SC[st].c : '#bdb5ad', mouth = st === 'vert' ? 'M30 62 Q50 84 70 62' : st === 'orange' ? 'M32 68 L68 68' : st === 'rouge' ? 'M30 76 Q50 54 70 76' : 'M38 68 L62 68';
    return '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '" role="img" aria-label="' + esc(st ? SC[st].l : 'Non renseigné') + '"><circle cx="50" cy="50" r="46" fill="' + col + '"/><circle cx="34" cy="40" r="6" fill="#fff"/><circle cx="66" cy="40" r="6" fill="#fff"/><path d="' + mouth + '" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/></svg>';
  }
  function arrow(dir, fav, size){
    var col = dir == null ? '#bdb5ad' : (dir === 'flat' ? '#7b6b63' : (fav ? SC.vert.c : SC.rouge.c)), rot = dir === 'up' ? -45 : (dir === 'down' ? 45 : 0);
    return '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '" role="img" aria-label="' + (dir === 'up' ? 'en hausse' : dir === 'down' ? 'en baisse' : dir === 'flat' ? 'stable' : 'tendance indisponible') + '"><g transform="rotate(' + rot + ' 50 50)"><path d="M16 50 H80 M54 24 L82 50 L54 76" stroke="' + col + '" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></svg>';
  }
  function chartEnd(){ return SP.month === curMonth() ? todayIso() : bounds(SP.month).last; }
  function chartHtml(IX, IXV, th, e, ids, inds){
    var cc = chartCfg(th), principal = principalInd(th, inds), cfg = { days:cc.days, target:cc.target, avg:cc.avg };
    var metric = cc.metric === 'auto' ? (principal ? principal.id : 'statut') : cc.metric;
    if (metric !== 'statut' && !inds.some(function(i){ return i.id === metric; })) metric = principal ? principal.id : 'statut';
    var isStat = metric === 'statut', ind = isStat ? null : inds.filter(function(i){ return i.id === metric; })[0];
    var end = chartEnd(), days = cfg.days, start = addDays(end, -(days - 1)), pts = [], k, j;
    for (k = 0; k < days; k++){ j = addDays(end, -(days - 1 - k));
      if (isStat){ var a = agg(IX, th.id, j, ids); if (a.st) pts.push({ k:k, j:j, y:4 - RANK[a.st], st:a.st }); }
      else { var r = valDay(IXV, metric, ids, j); if (r) pts.push({ k:k, j:j, y:r.v }); } }
    var opts = '<option value="statut"' + (isStat ? ' selected' : '') + '>Statut SQCDP (vert / orange / rouge)</option>' + inds.map(function(i){ return '<option value="' + i.id + '"' + (i.id === metric ? ' selected' : '') + '>' + esc(i.libelle) + (i.unite ? ' (' + esc(i.unite) + ')' : '') + '</option>'; }).join('');
    var ctl = '<div class="aicx-ctl"><label>Contenu de la courbe <select onchange="aicxChartMetric(\'' + th.id + '\',this.value)" aria-label="Contenu de la courbe">' + opts + '</select></label>'
      + '<span class="aicx-seg" role="group" aria-label="Période">' + [7, 30, 90].map(function(n){ return '<button type="button" class="' + (days === n ? 'on' : '') + '" aria-pressed="' + (days === n) + '" onclick="aicxChartDays(\'' + th.id + '\',' + n + ')">' + n + ' j</button>'; }).join('') + '</span>'
      + (isStat ? '' : '<label><input type="checkbox"' + (cfg.target ? ' checked' : '') + ' onchange="aicxChartOpt(\'' + th.id + '\',\'target\',this.checked)"> Cible</label><label><input type="checkbox"' + (cfg.avg ? ' checked' : '') + ' onchange="aicxChartOpt(\'' + th.id + '\',\'avg\',this.checked)"> Moyenne 7 j</label>')
      + (cc.custom ? '<button type="button" class="add-btn sm ghost" onclick="aicxChartReset(\'' + th.id + '\')" title="Revenir au réglage défini par l\u2019Admin">↺ Réglage Admin</button>' : '') + '</div>';
    if (!pts.length) return ctl + '<div class="sub-cell" style="padding:26px 6px;text-align:center;">Aucune ' + (isStat ? 'couleur' : 'valeur') + ' sur ces ' + days + ' jours' + (canWrite(e) ? ' : cliquez un jour du calendrier pour saisir.' : '.') + '</div>';
    var W = 640, H = 230, pl = 46, pr = 16, pt = 16, pb = 30, y0, y1, ys = pts.map(function(p){ return p.y; });
    if (isStat){ y0 = 0.5; y1 = 3.5; }
    else { var cib = (ind && ind.cible != null && cfg.target) ? [Number(ind.cible)] : []; var all = ys.concat(cib); y0 = Math.min.apply(null, all); y1 = Math.max.apply(null, all); if (y0 === y1){ y0 -= 1; y1 += 1; } var padv = (y1 - y0) * 0.1; y0 -= padv; y1 += padv; }
    function X_(k){ return pl + (W - pl - pr) * (days > 1 ? k / (days - 1) : 0.5); } function Y_(v){ return pt + (H - pt - pb) * (1 - (v - y0) / (y1 - y0)); }
    var col = esc(th.couleur || '#560A0F'), svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;" role="img" aria-label="Courbe ' + esc(th.libelle) + ' sur ' + days + ' jours">';
    if (isStat) [1, 2, 3].forEach(function(v){ svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y_(v) + '" y2="' + Y_(v) + '" stroke="#e6e0da"/><text x="' + (pl - 8) + '" y="' + (Y_(v) + 4) + '" text-anchor="end" font-size="13" fill="' + SC[BYRANK[4 - v]].c + '" font-weight="700">' + SC[BYRANK[4 - v]].g + '</text>'; });
    else [0, 0.5, 1].forEach(function(f){ var v = y0 + (y1 - y0) * f; svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y_(v) + '" y2="' + Y_(v) + '" stroke="#e6e0da"/><text x="' + (pl - 6) + '" y="' + (Y_(v) + 4) + '" text-anchor="end" font-size="11" fill="#7b6b63">' + fmt(v) + '</text>'; });
    [0, Math.floor((days - 1) / 2), days - 1].forEach(function(kk){ svg += '<text x="' + X_(kk) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#7b6b63">' + shortDate(addDays(end, -(days - 1 - kk))) + '</text>'; });
    if (!isStat && ind && ind.cible != null && cfg.target){ svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y_(Number(ind.cible)) + '" y2="' + Y_(Number(ind.cible)) + '" stroke="#2b1b1b" stroke-width="1.5" stroke-dasharray="6 4"/><text x="' + (W - pr) + '" y="' + (Y_(Number(ind.cible)) - 5) + '" text-anchor="end" font-size="11" fill="#2b1b1b" font-weight="700">Cible ' + (ind.sens === 'bas' ? '≤ ' : '≥ ') + fmt(ind.cible) + '</text>'; }
    var run = []; function flush(){ if (run.length > 1) svg += '<polyline fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linejoin="round" points="' + run.map(function(p){ return X_(p.k).toFixed(1) + ',' + Y_(p.y).toFixed(1); }).join(' ') + '"/>'; run = []; }
    pts.forEach(function(p, i){ if (run.length && p.k !== run[run.length - 1].k + 1) flush(); run.push(p); }); flush();
    if (!isStat && cfg.avg){ var av = []; for (k = 0; k < days; k++){ var w = pts.filter(function(p){ return p.k <= k && p.k > k - 7; }); if (w.length) av.push(X_(k).toFixed(1) + ',' + Y_(w.reduce(function(s, p){ return s + p.y; }, 0) / w.length).toFixed(1)); } if (av.length > 1) svg += '<polyline fill="none" stroke="#7b6b63" stroke-width="2" stroke-dasharray="2 4" points="' + av.join(' ') + '"/>'; }
    pts.forEach(function(p){ var fill = isStat ? SC[p.st].c : '#fff', stroke = isStat ? '#fff' : col; svg += '<circle cx="' + X_(p.k).toFixed(1) + '" cy="' + Y_(p.y).toFixed(1) + '" r="' + (days > 40 ? 3 : 4.5) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2"><title>' + esc(shortDate(p.j) + ' : ' + (isStat ? SC[p.st].l : fmt(p.y) + ' ' + (ind ? ind.unite : ''))) + '</title></circle>'; });
    return ctl + svg + '</svg>';
  }

  function aicxCss(){
    if (document.getElementById('aicxCss')) return;
    var st = document.createElement('style'); st.id = 'aicxCss';
    st.textContent =
      '.aicx-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 10px;}'
      + '.aicx-chip{display:inline-block;padding:2px 9px;border-radius:999px;background:rgba(86,10,15,.08);font-size:12px;}'
      + '.aicx-title{font-size:22px;font-weight:700;margin:2px 0 4px;}'
      + '.aicx-month{display:flex;align-items:center;gap:8px;margin:14px 0 4px;flex-wrap:wrap;}'
      + '.aicx-month b{font-size:16px;min-width:140px;text-align:center;text-transform:capitalize;}'
      + '.aicx-board{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:8px 0 14px;}'
      + '.aicx-tile{background:#fff;border:2px solid rgba(86,10,15,.12);border-radius:12px;overflow:hidden;cursor:pointer;text-align:left;padding:0;font:inherit;color:inherit;transition:box-shadow .15s,transform .15s;}'
      + '.aicx-tile:hover{box-shadow:0 4px 14px rgba(0,0,0,.14);transform:translateY(-1px);}'
      + '.aicx-tile:focus-visible{outline:3px solid #560A0F;outline-offset:2px;}'
      + '.aicx-tile.sel{border-color:var(--c);box-shadow:0 0 0 3px rgba(86,10,15,.15);}'
      + '.aicx-th{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--c);color:#fff;}'
      + '.aicx-let{font-size:30px;font-weight:800;line-height:1;}.aicx-tl{font-size:13px;font-weight:600;opacity:.95;}'
      + '.aicx-tb{display:flex;align-items:center;gap:10px;padding:12px;}'
      + '.aicx-cap{display:flex;flex-direction:column;font-size:12px;line-height:1.3;}.aicx-cap b{font-size:14px;}.aicx-cap span{opacity:.7;}'
      + '.aicx-dot{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:800;flex:none;}'
      + '.aicx-ival{font-size:24px;font-weight:800;line-height:1.1;}.aicx-ival small{font-size:12px;opacity:.7;margin-left:3px;font-weight:600;}.aicx-mini{padding:2px 12px 6px;}.aicx-tile .aicx-tb + .aicx-tb,.aicx-tile .aicx-tb + .aicx-mini{border-top:1px solid rgba(86,10,15,.07);}'
      + '.aicx-strip{display:flex;flex-wrap:wrap;gap:2px;padding:0 12px 12px;}.aicx-strip i{display:block;width:8px;height:8px;border-radius:2px;}'
      + '.aicx-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;max-width:460px;}'
      + '.aicx-dh{font-size:11px;text-align:center;opacity:.6;text-transform:uppercase;}'
      + '.aicx-day{height:46px;border:2px solid transparent;border-radius:8px;background:#f1ece7;font:inherit;font-size:13px;font-weight:600;color:#3b2b2b;cursor:pointer;position:relative;padding:0;}'
      + '.aicx-day.we{background:#f8f5f2;color:#a39890;}'
      + '.aicx-day:hover:not(:disabled){filter:brightness(.94);}.aicx-day:disabled{opacity:.35;cursor:default;}'
      + '.aicx-day.has{color:#fff;}.aicx-day.today{border-color:#560A0F;}.aicx-day.edit{box-shadow:0 0 0 3px rgba(86,10,15,.35);}'
      + '.aicx-day small{position:absolute;right:4px;bottom:1px;font-size:10px;}'
      + '.aicx-pick{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;}'
      + '.aicx-pbtn{flex:1 1 120px;border:2px solid transparent;border-radius:10px;padding:10px 8px;color:#fff;font:inherit;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;}'
      + '.aicx-pbtn span{font-size:11px;font-weight:500;opacity:.95;}.aicx-pbtn.on{border-color:#2b1b1b;box-shadow:0 0 0 2px #fff inset;}.aicx-pbtn.off{background:#ece6e0;color:#3b2b2b;}'
      + '.aicx-two{display:grid;grid-template-columns:minmax(300px,480px) 1fr;gap:18px;align-items:start;}'
      + '@media(max-width:820px){.aicx-two{grid-template-columns:1fr;}}'
      + '.aicx-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:8px 0 12px;}'
      + '.aicx-card{background:#fff;border:1px solid rgba(86,10,15,.14);border-radius:12px;padding:12px 14px;}'
      + '.aicx-card h4{margin:0 0 8px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7b6b63;font-weight:600;}'
      + '.aicx-big{font-size:34px;font-weight:800;line-height:1.05;}.aicx-unit{font-size:14px;font-weight:600;opacity:.7;margin-left:4px;}'
      + '.aicx-row{display:flex;align-items:center;gap:12px;}.aicx-sub{font-size:12px;color:#7b6b63;margin-top:4px;}'
      + '.aicx-ctl{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px;font-size:12px;}'
      + '.aicx-ctl select{height:30px;border:1px solid rgba(86,10,15,.25);border-radius:6px;padding:0 6px;font:inherit;font-size:12px;max-width:260px;}'
      + '.aicx-seg{display:inline-flex;border:1px solid rgba(86,10,15,.3);border-radius:8px;overflow:hidden;}.aicx-seg button{border:0;background:#fff;padding:6px 12px;font:inherit;font-size:12px;cursor:pointer;color:#560A0F;}.aicx-seg button.on{background:#560A0F;color:#fff;}'
      + '.aicx-ind{border:1px solid rgba(86,10,15,.15);border-radius:10px;padding:8px 12px;margin-bottom:8px;background:#fff;display:flex;gap:10px;align-items:center;}'
      + '.aicx-ind b{font-size:13px;}.aicx-ind .m{font-size:12px;opacity:.75;margin-top:2px;}'
      + '.aicx-val{display:grid;grid-template-columns:1fr 110px;gap:6px 10px;align-items:center;margin:8px 0;}'
      + '.aicx-val input{height:34px;border:1px solid rgba(86,10,15,.25);border-radius:6px;padding:0 8px;font:inherit;font-size:14px;width:100%;}'
      + '.aicx-mx{border-collapse:collapse;width:100%;}.aicx-mx th,.aicx-mx td{padding:6px 8px;text-align:center;border-bottom:1px solid rgba(86,10,15,.08);}'
      + '.aicx-mx td:first-child,.aicx-mx th:first-child{text-align:left;}.aicx-mx button{background:none;border:0;padding:0;cursor:pointer;}'
      + '.aicx-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;margin:6px 0 2px;}.aicx-leg span{display:inline-flex;align-items:center;gap:5px;}'
      + '.aicx-go{background:#2e7d46!important;}.aicx-sbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;margin:6px 0 10px;background:#fff;border:2px solid #c0392b;border-radius:12px;position:sticky;top:0;z-index:5;}'
      + '.aicx-live{color:#c0392b;font-weight:800;font-size:12px;letter-spacing:.08em;animation:aicxp 1.6s infinite;}.aicx-prep{color:#b26a00;}@keyframes aicxp{50%{opacity:.35}}'
      + '@media (prefers-reduced-motion:reduce){.aicx-live{animation:none}}';
    document.head.appendChild(st);
  }
  function dot(st, size, title){ var s = st ? SC[st] : null; return '<span class="aicx-dot" title="' + esc(title || (s ? s.l + ' · ' + s.d : 'Non renseigné')) + '" style="width:' + size + 'px;height:' + size + 'px;background:' + (s ? s.c : '#e6e0da') + ';font-size:' + Math.round(size * .5) + 'px;">' + (s ? s.g : '·') + '</span>'; }

  /* ----- Chargement (appelé à l'ouverture ET à chaque retour sur l'onglet : plus de cache périmé) ----- */
  async function pageAll(make){ var out = []; for (var i = 0; i < 40; i++){ var r = await make().range(i * 1000, i * 1000 + 999); if (r.error) throw r.error; var d = r.data || []; out = out.concat(d); if (d.length < 1000) break; } return out; }
  function missing(m){ return /relation|does not exist|schema cache|column/i.test(m || ''); }
  async function aicxLoadStatuts(){
    var e = byId(X.espaces, X.open); SP.st = []; SP.val = []; SP.stErr = ''; SP.valErr = ''; if (!e) return;
    var ids = leaves(e).map(function(x){ return x.id; }); if (!ids.length) return;
    var b = bounds(SP.month), lim = addDays(todayIso(), -100), from = b.first < lim ? b.first : lim, to = b.last > todayIso() ? b.last : todayIso();
    try { SP.st = await pageAll(function(){ return db().from('aic_statuts').select('*').in('espace_id', ids).gte('jour', from).lte('jour', to).order('jour', { ascending:false }).order('id'); }); }
    catch(err){ var m = (err && err.message) || String(err); SP.stErr = m + (missing(m) ? ' — exécutez d\u2019abord aic_brique2b_sqcdp.sql.' : ''); }
    try { SP.val = await pageAll(function(){ return db().from('aic_valeurs').select('*').in('espace_id', ids).gte('jour', from).lte('jour', to).order('jour', { ascending:false }).order('id'); }); }
    catch(err2){ var m2 = (err2 && err2.message) || String(err2); SP.valErr = m2 + (missing(m2) ? ' — exécutez d\u2019abord aic_brique3.sql.' : ''); }
  }
  /* Rattache à l'AIC les actions créées par ses séances (routine = rituel, site, espace). Idempotent. */
  async function tagActions(nums, e){
    if (!nums || !nums.length || !e) return 0;
    var m = byId(X.missions, e.mission_id) || {}, site = siteName(e), tags = ['AIC', 'AIC ' + e.niveau]; if (m.client) tags.push('client:' + m.client); if (site) tags.push('site:' + site);
    var r = await db().from('actions').update({ routine:e.libelle, aic_espace_id:e.id, site:site, tags:tags }).in('numero', nums).is('aic_espace_id', null).select('numero');
    if (r.error && missing(r.error.message)) r = await db().from('actions').update({ routine:e.libelle, tags:tags }).in('numero', nums).select('numero');
    if (r.error) throw r.error; return (r.data || []).length;
  }
  async function aicxLoadSpace(){
    var e = byId(X.espaces, X.open); if (!e) return;
    try {
      var a = await db().from('aic_thematiques').select('*').order('ordre', { ascending:true }); if (a.error) throw a.error;
      var b = await db().from('aic_indicateurs').select('*').order('ordre', { ascending:true }); if (b.error) throw b.error;
      SP.ref = { them:a.data || [], ind:b.data || [] };
    } catch(err){ SP.ref = { err:(err && err.message) || String(err) }; }
    try {
      var q = await db().from('actions').select('numero,libelle,statut,echeance').eq('routine', e.libelle).is('archived_at', null).limit(100);
      var list = q.error ? [] : (q.data || []), er = q.error ? q.error.message : '';
      var q2 = await db().from('actions').select('numero,libelle,statut,echeance').eq('aic_espace_id', e.id).is('archived_at', null).limit(100);
      if (!q2.error) (q2.data || []).forEach(function(x){ if (!list.some(function(y){ return y.numero === x.numero; })) list.push(x); });
      SP.acts = (er && !list.length) ? { err:er } : { list:list };
    } catch(err2){ SP.acts = { err:(err2 && err2.message) || String(err2) }; }
    SP.seances = []; SP.seErr = '';
    try {
      var s = await db().from('comptes_rendus').select('id,numero,titre,date_reunion,statut,actions_numeros').eq('aic_espace_id', e.id).order('date_reunion', { ascending:false }).limit(8);
      if (s.error) throw s.error; SP.seances = s.data || [];
      var nums = []; SP.seances.forEach(function(c){ (c.actions_numeros || []).forEach(function(n){ if (nums.indexOf(n) < 0) nums.push(n); }); });
      try { await tagActions(nums, e); } catch(_){}
    } catch(err3){ var m3 = (err3 && err3.message) || String(err3); SP.seErr = m3 + (missing(m3) ? ' — exécutez d\u2019abord aic_brique3.sql.' : ''); }
    await aicxLoadIcm(e);
    await aicxLoadStatuts();
  }
  function canSeeIcm(e){ if (X.ceo) return true; var cur = e; while (cur){ if (memberAcces(cur, ['animation'])) return true; cur = cur.parent_id ? byId(X.espaces, cur.parent_id) : null; } return false; }
  async function aicxLoadIcm(e){
    SP.icm = []; SP.vm = []; SP.icmErr = ''; SP.icmOn = canSeeIcm(e); if (!SP.icmOn) return;
    var ids = leaves(e).map(function(x){ return x.id; }); if (!ids.length) return; var from = addDays(todayIso(), -730);
    try { SP.icm = await pageAll(function(){ return db().from('aic_icm').select('*').in('espace_id', ids).gte('mesure_le', from).order('mesure_le', { ascending:false }).order('id'); }); }
    catch(err){ var m = (err && err.message) || String(err); SP.icmErr = missing(m) ? 'absent' : m; return; }
    try { SP.vm = await pageAll(function(){ return db().from('aic_verts_mensuel').select('*').in('espace_id', ids).gte('mois', from).order('mois', { ascending:true }).order('espace_id'); }); } catch(_){ SP.vm = []; }
  }
  window.aicxOpen = async function(id, thId){
    X.open = id; SP.month = curMonth(); SP.sel = thId || null; SP.edit = null;
    view().innerHTML = head() + '<div class="panel" style="padding:14px 16px;">Chargement de l\u2019espace…</div>';
    if (!byId(X.espaces, id)) { aicxRender(); return; }
    await aicxLoadSpace(); window.scrollTo(0, 0); aicxDashboard();
  };
  window.aicxBack = function(){ if (X.session) return; X.open = null; SP.edit = null; aicxRender(); };
  window.aicxRefresh = async function(){ if (X.session){ await aicxLoadSpace(); aicxDashboard(); return; } view().innerHTML = head() + '<div class="panel" style="padding:14px 16px;">Actualisation…</div>'; await aicxMain(); };
  window.aicxMonth = async function(delta){
    var b = bounds(SP.month), d = new Date(b.y, b.mo - 1 + delta, 1); SP.month = iso(d).slice(0, 7); SP.edit = null;
    await aicxLoadStatuts(); aicxDashboard();
  };
  window.aicxThisMonth = async function(){ SP.month = curMonth(); SP.edit = null; await aicxLoadStatuts(); aicxDashboard(); };
  window.aicxSelTheme = function(thId){ SP.sel = thId; SP.edit = null; aicxDashboard(); };
  window.aicxEditDay = function(thId, jour){ SP.sel = thId; SP.edit = { thId:thId, jour:jour }; aicxDashboard(); };
  window.aicxPickInd = function(thId, indId){ SP.ind[thId] = indId; aicxDashboard(); };
  function chartSet(thId, k, v){ SP.chart.t[thId] = SP.chart.t[thId] || {}; SP.chart.t[thId][k] = v; saveChartPref(); aicxDashboard(); }
  window.aicxChartMetric = function(thId, v){ chartSet(thId, 'metric', v); };
  window.aicxChartDays = function(thId, n){ chartSet(thId, 'days', n); };
  window.aicxChartOpt = function(thId, k, on){ chartSet(thId, k === 'target' ? 'target' : 'avg', !!on); };
  window.aicxChartReset = function(thId){ delete SP.chart.t[thId]; saveChartPref(); aicxDashboard(); };

  /* ----- Écriture d'un relevé : couleur + valeurs + commentaire (site uniquement ; la RLS impose les droits) ----- */
  window.aicxHint = function(){
    var e = byId(X.espaces, X.open), ed = SP.edit, box = document.getElementById('aicx_hint'); if (!e || !ed || !box) return;
    var th = themsFor(e).filter(function(t){ return t.id === ed.thId; })[0]; if (!th) return;
    var worst = 0, why = ''; indsFor(th, e).forEach(function(i){ var el = document.getElementById('aicx_v_' + i.id), raw = el ? el.value.trim().replace(',', '.') : ''; if (raw === '') return; var s = suggest(i, parseFloat(raw)); if (s && RANK[s] > worst){ worst = RANK[s]; why = i.libelle + ' : ' + fmt(parseFloat(raw)) + ' vs cible ' + (i.sens === 'bas' ? '≤ ' : '≥ ') + fmt(i.cible); } });
    box.innerHTML = worst ? '<span class="sub-cell">Suggestion d\u2019après la cible (' + esc(why) + ') : </span><button type="button" class="add-btn sm" style="background:' + SC[BYRANK[worst]].c + '" onclick="aicxSetStatut(\'' + BYRANK[worst] + '\')">Appliquer ' + SC[BYRANK[worst]].l + '</button>' : '';
  };
  window.aicxSetStatut = async function(statut){
    var e = byId(X.espaces, X.open), ed = SP.edit; if (!e || !ed) return;
    var cm = ((document.getElementById('aicx_cm') || {}).value || '').trim(), th = themsFor(e).filter(function(t){ return t.id === ed.thId; })[0], IX = indexSt(), IXV = indexVal();
    var cur = IX[e.id + '|' + ed.thId + '|' + ed.jour], vals = [];
    if (th) for (var i = 0, L = indsFor(th, e); i < L.length; i++){
      var el = document.getElementById('aicx_v_' + L[i].id); if (!el) continue; var raw = el.value.trim().replace(',', '.'), old = IXV[e.id + '|' + L[i].id + '|' + ed.jour];
      if (raw === ''){ if (old && old.valeur != null) vals.push({ espace_id:e.id, indicateur_id:L[i].id, jour:ed.jour, valeur:null }); continue; }
      var num = parseFloat(raw); if (isNaN(num)){ flash('aicx_fb', false, 'Valeur « ' + L[i].libelle + ' » : nombre attendu.'); return; }
      if (!old || Number(old.valeur) !== num) vals.push({ espace_id:e.id, indicateur_id:L[i].id, jour:ed.jour, valeur:num });
    }
    var st = statut || (cur && RANK[cur.statut] ? cur.statut : null);
    if (statut === null && cm && !st){ flash('aicx_fb', false, 'Choisissez d\u2019abord une couleur pour ce commentaire.'); return; }
    try {
      if (st || statut === 'neutre') touched(await db().from('aic_statuts').upsert({ espace_id:e.id, thematique_id:ed.thId, jour:ed.jour, statut:st || 'neutre', commentaire:cm || null }, { onConflict:'espace_id,thematique_id,jour' }).select('id'), 'aic_statuts');
      if (vals.length) touched(await db().from('aic_valeurs').upsert(vals, { onConflict:'espace_id,indicateur_id,jour' }).select('id'), 'aic_valeurs');
      await aicxLoadStatuts(); aicxDashboard(); flash('aicx_fb', true, statut === 'neutre' ? '✓ Relevé effacé' : '✓ Enregistré');
    } catch(err){ flash('aicx_fb', false, 'Refusé : ' + ((err && err.message) || err)); }
  };
  window.aicxSaveComment = function(){ return window.aicxSetStatut(null); };

  /* ----- Rendu ----- */
  /* Pavé SQCDP : blocs affichés choisis par l'Admin pour cette thématique (statut, indicateur, tendance, mini-courbe, bande du mois). */
  function tileHtml(IX, IXV, th, e, ids, sel){
    var cf = cfgOf(th), inds = indsFor(th, e), pr = principalInd(th, inds), cc = chartCfg(th);
    var rd = refDay(IX, th.id, ids), eff = rd || chartEnd(), a = rd ? agg(IX, th.id, rd, ids) : { st:null, n:0 }, s = a.st ? SC[a.st] : null, b = bounds(SP.month), body = '';
    var cap = SP.month === curMonth() ? 'Aujourd\u2019hui' : (rd ? 'Dernier relevé ' + fdate(rd) : 'Aucun relevé ce mois');
    if (ids.length > 1) cap += ' · ' + a.n + '/' + ids.length + ' sites';
    if (cf.pave.statut) body += '<div class="aicx-tb">' + face(a.st, 40) + '<div class="aicx-cap"><b>' + (s ? s.l : 'Non renseigné') + '</b><span>' + esc(cap) + '</span></div></div>';
    if (cf.pave.indic){
      var lv = pr ? lastVal(IXV, pr.id, ids, eff) : null, sg = (pr && lv) ? suggest(pr, lv.v) : null;
      body += '<div class="aicx-tb"><div><div class="aicx-ival" style="color:' + (sg ? SC[sg].c : 'inherit') + '">' + (lv ? fmt(lv.v) : '—') + (pr && pr.unite ? '<small>' + esc(pr.unite) + '</small>' : '') + '</div><div class="aicx-cap"><span>' + (pr ? esc(pr.libelle) + (pr.cible != null ? ' · cible ' + (pr.sens === 'bas' ? '≤ ' : '≥ ') + fmt(pr.cible) : '') : 'Aucun indicateur défini') + '</span></div></div></div>';
    }
    if (cf.pave.tend){
      var tr = pr ? trendOf(function(j){ var r = valDay(IXV, pr.id, ids, j); return r ? r.v : null; }, eff, pr.sens) : trendOf(function(j){ var x = agg(IX, th.id, j, ids).st; return x ? RANK[x] : null; }, eff, 'bas');
      body += '<div class="aicx-tb">' + arrow(tr.dir, tr.fav, 30) + '<div class="aicx-cap"><b>' + (tr.dir == null ? 'Tendance : pas assez de relevés' : tr.dir === 'flat' ? 'Stable' : (tr.dir === 'up' ? 'En hausse' : 'En baisse') + (tr.pct != null ? ' (' + (tr.pct > 0 ? '+' : '') + Math.round(tr.pct * 100) + ' %)' : '')) + '</b>' + (tr.fav === true ? '<span>favorable</span>' : tr.fav === false ? '<span>défavorable</span>' : '') + '</div></div>';
    }
    if (cf.pave.courbe){
      var metric = cc.metric === 'auto' ? (pr ? pr.id : 'statut') : cc.metric, isStat = metric === 'statut' || !inds.some(function(i){ return i.id === metric; }), vals = [], end = chartEnd();
      if (!inds.length && !isStat) isStat = true;
      for (var k = cc.days - 1; k >= 0; k--){ var j = addDays(end, -k); if (isStat){ var g = agg(IX, th.id, j, ids).st; if (g) vals.push(4 - RANK[g]); } else { var vv = valDay(IXV, metric, ids, j); if (vv) vals.push(vv.v); } }
      body += '<div class="aicx-mini" title="' + esc(isStat ? 'Statut SQCDP' : (inds.filter(function(i){ return i.id === metric; })[0] || {}).libelle || '') + ' · ' + cc.days + ' j">' + (vals.length > 1 ? spark(vals, 160, 36, esc(th.couleur || '#560A0F')) : '<div class="sub-cell" style="padding:8px 0;">Courbe : données insuffisantes</div>') + '</div>';
    }
    if (cf.pave.bande){ var strip = ''; for (var d = 1; d <= b.n; d++){ var gg = agg(IX, th.id, SP.month + '-' + pad(d), ids).st; strip += '<i style="background:' + (gg ? SC[gg].c : '#e6e0da') + '"></i>'; } body += '<div class="aicx-strip" aria-hidden="true">' + strip + '</div>'; }
    return '<button type="button" class="aicx-tile' + (sel ? ' sel' : '') + '" aria-pressed="' + (sel ? 'true' : 'false') + '" style="--c:' + esc(th.couleur || '#560A0F') + '" onclick="aicxSelTheme(\'' + th.id + '\')">'
      + '<div class="aicx-th"><span class="aicx-let">' + esc(th.code) + '</span><span class="aicx-tl">' + esc(th.libelle) + '</span></div>' + body + '</button>';
  }
  /* Les 3 zones d'une thématique : smiley, indicateur, tendance (+ courbe en dessous). */
  function zonesHtml(IX, IXV, th, e, ids){
    var inds = indsFor(th, e), rd = refDay(IX, th.id, ids) || chartEnd(), a = agg(IX, th.id, rd, ids);
    var ind = principalInd(th, inds), indId = ind ? ind.id : null;
    /* 1. Smiley */
    var smiley = '<div class="aicx-card"><h4>Humeur du jour</h4><div class="aicx-row">' + face(a.st, 64) + '<div><div style="font-weight:700;font-size:16px;">' + (a.st ? SC[a.st].l : 'Non renseigné') + '</div><div class="aicx-sub">' + (a.st ? esc(SC[a.st].d) : 'Aucun relevé') + '<br>' + esc(longDate(rd)) + (ids.length > 1 ? ' · ' + a.n + '/' + ids.length + ' sites' : '') + '</div></div></div></div>';
    /* 2. Indicateur */
    var lv = ind ? lastVal(IXV, ind.id, ids, rd) : null, ic;
    if (!ind) ic = '<div class="sub-cell">Aucun indicateur défini pour cette thématique à ce niveau (Admin › Référentiel AIC).</div>';
    else {
      var sug = lv ? suggest(ind, lv.v) : null, gap = (lv && ind.cible != null) ? lv.v - Number(ind.cible) : null;
      ic = (inds.length > 1 ? '<select aria-label="Indicateur" onchange="aicxPickInd(\'' + th.id + '\',this.value)" style="max-width:100%;margin-bottom:6px;height:28px;border:1px solid rgba(86,10,15,.25);border-radius:6px;font:inherit;font-size:12px;">' + inds.map(function(i){ return '<option value="' + i.id + '"' + (i.id === indId ? ' selected' : '') + '>' + esc(i.libelle) + '</option>'; }).join('') + '</select>' : '<div style="font-size:13px;font-weight:600;margin-bottom:4px;">' + esc(ind.libelle) + '</div>')
        + (lv ? '<div><span class="aicx-big" style="color:' + (sug ? SC[sug].c : 'inherit') + '">' + fmt(lv.v) + '</span><span class="aicx-unit">' + esc(ind.unite) + '</span></div>'
              + '<div class="aicx-sub">' + (ind.cible != null ? 'Cible ' + (ind.sens === 'bas' ? '≤ ' : '≥ ') + fmt(ind.cible) + (gap != null ? ' · écart ' + (gap > 0 ? '+' : '') + fmt(gap) : '') : 'Pas de cible définie') + '<br>au ' + esc(fdate(lv.j)) + (ids.length > 1 ? ' · moyenne de ' + lv.n + ' site(s)' : '') + '</div>'
              : '<div><span class="aicx-big" style="opacity:.35">—</span></div><div class="aicx-sub">Aucune valeur saisie' + (ind.cible != null ? ' · cible ' + (ind.sens === 'bas' ? '≤ ' : '≥ ') + fmt(ind.cible) : '') + '</div>');
    }
    var indic = '<div class="aicx-card"><h4>Indicateur</h4>' + ic + '</div>';
    /* 3. Tendance : sur l'indicateur choisi, sinon sur la couleur */
    var tr, lab;
    if (ind){ tr = trendOf(function(j){ var r = valDay(IXV, ind.id, ids, j); return r ? r.v : null; }, rd, ind.sens); lab = esc(ind.libelle); }
    else { tr = trendOf(function(j){ var s = agg(IX, th.id, j, ids).st; return s ? RANK[s] : null; }, rd, 'bas'); lab = 'couleur SQCDP'; }
    var ttxt = tr.dir == null ? 'Pas assez de relevés (il faut des données sur 2 semaines).' : (tr.dir === 'flat' ? 'Stable' : (tr.dir === 'up' ? 'En hausse' : 'En baisse')) + (tr.dir !== 'flat' && tr.pct != null ? ' (' + (tr.pct > 0 ? '+' : '') + Math.round(tr.pct * 100) + ' %)' : '') + (tr.fav === true ? ' · favorable' : tr.fav === false ? ' · défavorable' : '');
    var trend = '<div class="aicx-card"><h4>Tendance</h4><div class="aicx-row">' + arrow(tr.dir, tr.fav, 64) + '<div><div style="font-weight:700;">' + esc(ttxt) + '</div><div class="aicx-sub">7 derniers jours vs 7 jours précédents · ' + lab + '</div></div></div></div>';
    return '<div class="aicx-cards">' + smiley + indic + trend + '</div>'
      + '<div class="aicx-card" style="margin-bottom:12px;"><h4>Évolution</h4>' + chartHtml(IX, IXV, th, e, ids, inds) + '</div>';
  }
  function calendarHtml(IX, th, e, ids, interactive){
    var b = bounds(SP.month), first = new Date(b.y, b.mo - 1, 1), off = (first.getDay() + 6) % 7, today = todayIso();
    var h = '<div class="aicx-grid" role="grid" aria-label="Relevés de ' + esc(th.libelle) + '">' + ['lun','mar','mer','jeu','ven','sam','dim'].map(function(d){ return '<div class="aicx-dh">' + d + '</div>'; }).join('');
    for (var i = 0; i < off; i++) h += '<div></div>';
    for (var d = 1; d <= b.n; d++){
      var j = SP.month + '-' + pad(d), a = agg(IX, th.id, j, ids), s = a.st ? SC[a.st] : null, fut = j > today, dw = (off + d - 1) % 7;
      var one = (ids.length === 1) ? IX[ids[0] + '|' + th.id + '|' + j] : null;
      var tip = longDate(j) + ' — ' + (s ? s.l + ' · ' + s.d : 'non renseigné') + (one && one.commentaire ? ' — ' + one.commentaire : '') + (ids.length > 1 && a.n ? ' (' + a.n + '/' + ids.length + ' sites)' : '');
      h += '<button type="button" class="aicx-day' + (s ? ' has' : (dw >= 5 ? ' we' : '')) + (j === today ? ' today' : '') + (SP.edit && SP.edit.jour === j && SP.edit.thId === th.id ? ' edit' : '') + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '"'
        + (s ? ' style="background:' + s.c + '"' : '') + (fut || !interactive ? ' disabled' : ' onclick="aicxEditDay(\'' + th.id + '\',\'' + j + '\')"') + '>' + d + (s ? '<small>' + s.g + '</small>' : '') + '</button>';
    }
    return h + '</div>';
  }
  function editorHtml(IX, IXV, th, e){
    var ed = SP.edit; if (!ed || ed.thId !== th.id) return '<div class="sub-cell" style="margin-top:10px;">' + (canWrite(e) ? 'Cliquez sur un jour pour saisir son relevé (couleur, valeurs, commentaire).' : 'Cliquez sur un jour pour voir son détail.') + '</div>';
    var s = IX[e.id + '|' + th.id + '|' + ed.jour], w = canWrite(e), cur = s && RANK[s.statut] ? s.statut : null, inds = indsFor(th, e);
    var h = '<div class="panel" style="padding:12px 14px;margin-top:12px;"><div style="font-weight:700;">' + esc(longDate(ed.jour)) + ' · ' + esc(th.code) + ' ' + esc(th.libelle) + '</div>';
    if (w){
      h += '<div class="aicx-pick">' + ['vert','orange','rouge'].map(function(k){ return '<button type="button" class="aicx-pbtn' + (cur === k ? ' on' : (cur ? ' off' : '')) + '" style="' + (cur && cur !== k ? '' : 'background:' + SC[k].c) + '" onclick="aicxSetStatut(\'' + k + '\')" aria-pressed="' + (cur === k) + '">' + SC[k].g + ' ' + SC[k].l + '<span>' + SC[k].d + '</span></button>'; }).join('') + '</div>'
        + (inds.length ? '<div class="aicx-val">' + inds.map(function(i){ var o = IXV[e.id + '|' + i.id + '|' + ed.jour];
            return '<label for="aicx_v_' + i.id + '" style="font-size:13px;">' + esc(i.libelle) + '<div class="sub-cell">' + (i.cible != null ? 'cible ' + (i.sens === 'bas' ? '≤ ' : '≥ ') + fmt(i.cible) + ' ' : '') + esc(i.unite) + '</div></label><input id="aicx_v_' + i.id + '" inputmode="decimal" placeholder="valeur" value="' + (o && o.valeur != null ? esc(String(o.valeur).replace('.', ',')) : '') + '" oninput="aicxHint()">'; }).join('') + '</div><div id="aicx_hint" style="margin:4px 0 8px;"></div>' : '')
        + '<textarea id="aicx_cm" rows="2" placeholder="Commentaire (cause, décision, action…)" aria-label="Commentaire" style="width:100%;box-sizing:border-box;border:1px solid rgba(86,10,15,.25);border-radius:8px;padding:8px;font:inherit;font-size:13px;">' + esc(s ? s.commentaire : '') + '</textarea>'
        + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;"><button type="button" class="add-btn sm" onclick="aicxSaveComment()">✓ Valider le relevé</button>'
        + (cur ? '<button type="button" class="add-btn sm ghost" onclick="aicxSetStatut(\'neutre\')">Effacer la couleur</button>' : '') + '<span id="aicx_fb" role="status" style="font-size:12px;"></span></div>';
    } else {
      h += '<div style="margin:8px 0;display:flex;align-items:center;gap:10px;">' + face(cur, 40) + '<div>' + (cur ? '<b>' + SC[cur].l + '</b> · ' + SC[cur].d : 'Non renseigné') + (s && s.commentaire ? '<div class="sub-cell">' + esc(s.commentaire) + '</div>' : '') + '</div></div>'
        + inds.map(function(i){ var o = IXV[e.id + '|' + i.id + '|' + ed.jour]; return o && o.valeur != null ? '<div class="sub-cell">' + esc(i.libelle) + ' : <b>' + fmt(o.valeur) + '</b> ' + esc(i.unite) + '</div>' : ''; }).join('')
        + '<div class="sub-cell" style="margin-top:6px;">Lecture seule : seuls les membres « contribution » ou « animation » de ce site saisissent.</div>';
    }
    return h + '</div>';
  }
  function indicatorsHtml(IXV, th, e, ids, ref){
    if (!SP.ref || SP.ref.err) return '<div class="sub-cell">Référentiel indisponible.</div>';
    var ind = indsFor(th, e); if (!ind.length) return '<div class="sub-cell">Aucun indicateur défini pour cette thématique à ce niveau (Admin › Référentiel AIC).</div>';
    return ind.map(function(x){ var lv = lastVal(IXV, x.id, ids, ref), s = lv ? suggest(x, lv.v) : null;
      var tr = trendOf(function(j){ var r = valDay(IXV, x.id, ids, j); return r ? r.v : null; }, ref, x.sens);
      return '<div class="aicx-ind"><div style="flex:1;"><b>' + esc(x.libelle) + '</b><div class="m">Cible ' + (x.sens === 'bas' ? '≤ ' : '≥ ') + fmt(x.cible) + ' ' + esc(x.unite) + ' · ' + esc(x.frequence) + '</div></div><div style="text-align:right;"><b style="font-size:18px;color:' + (s ? SC[s].c : 'inherit') + '">' + (lv ? fmt(lv.v) : '—') + '</b><div class="m">' + (lv ? esc(shortDate(lv.j)) : 'aucune valeur') + '</div></div>' + arrow(tr.dir, tr.fav, 26) + '</div>'; }).join('');
  }
  function timelineHtml(th, ids){
    var rows = SP.st.filter(function(s){ return s.thematique_id === th.id && s.commentaire && String(s.commentaire).trim() && RANK[s.statut] && s.jour.slice(0, 7) === SP.month; }).slice(0, 6);
    if (!rows.length) return '<div class="sub-cell">Aucun commentaire ce mois-ci.</div>';
    return rows.map(function(s){ var sp = byId(X.espaces, s.espace_id);
      return '<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(86,10,15,.08);">' + dot(s.statut, 24) + '<div style="font-size:13px;"><b>' + esc(fdate(s.jour)) + '</b>' + (ids.length > 1 && sp ? ' · ' + esc(sp.libelle.replace(/^AIC 3 · /, '')) : '') + '<div>' + esc(s.commentaire) + '</div><div class="sub-cell">' + esc(String(s.saisi_par || '').split('@')[0]) + '</div></div></div>'; }).join('');
  }
  function sitesMatrixHtml(IX, thems, sites){
    if (!sites.length) return '<div class="panel" style="padding:12px 16px;">Aucun site rattaché pour le moment' + (X.ceo ? ' (Admin › Structures AIC).' : '.') + '</div>';
    var h = '<div class="panel" style="padding:8px 14px;overflow-x:auto;"><table class="aicx-mx"><thead><tr><th>Site</th>' + thems.map(function(t){ return '<th title="' + esc(t.libelle) + '"><span class="aicx-chip" style="background:' + esc(t.couleur || '#560A0F') + ';color:#fff;font-weight:700;">' + esc(t.code) + '</span></th>'; }).join('') + '<th></th></tr></thead><tbody>';
    sites.forEach(function(sx){
      h += '<tr><td><b style="font-size:13px;">' + esc(sx.libelle.replace(/^AIC 3 · /, '')) + '</b></td>' + thems.map(function(t){
        var rd = refDay(IX, t.id, [sx.id]), a = rd ? agg(IX, t.id, rd, [sx.id]) : { st:null };
        return '<td><button type="button" aria-label="' + esc(sx.libelle + ' · ' + t.libelle + ' : ' + (a.st ? SC[a.st].l : 'non renseigné')) + '" onclick="aicxOpen(\'' + sx.id + '\',\'' + t.id + '\')">' + dot(a.st, 28) + '</button></td>'; }).join('')
        + '<td><button type="button" class="add-btn sm ghost" onclick="aicxOpen(\'' + sx.id + '\')">Ouvrir</button></td></tr>';
    });
    return h + '</tbody></table></div>';
  }
  function seancesHtml(e){
    var h = '<div class="field-label" style="margin-top:18px;">Séances AIC</div>';
    if (SP.seErr) return h + '<div class="panel" style="padding:10px 14px;color:var(--signal);">Séances indisponibles : ' + esc(SP.seErr) + '</div>';
    if (!SP.seances.length) return h + '<div class="panel" style="padding:12px 16px;">Aucune séance enregistrée' + (canAnimate(e) ? ' — lancez la première avec « ▶ Lancer l\u2019AIC ».' : '.') + '</div>';
    return h + '<div class="panel" style="padding:6px 16px;">' + SP.seances.map(function(c){ var n = (c.actions_numeros || []).length;
      return '<div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(86,10,15,.08);font-size:13px;"><span class="sub-cell">CR #' + esc(c.numero || '?') + '</span><b>' + esc(c.titre || '(sans titre)') + '</b><span class="sub-cell">' + esc(fdate(c.date_reunion)) + ' · ' + esc(c.statut === 'cloture' ? 'clôturée' : c.statut === 'tenue' ? 'tenue' : 'préparation') + (n ? ' · ' + n + ' action(s)' : '') + '</span>'
        + (canAnimate(e) ? '<button type="button" class="add-btn sm ghost" style="margin-left:auto;" onclick="aicxOpenSeance(\'' + c.id + '\')">Ouvrir</button>' : '') + '</div>'; }).join('') + '</div>';
  }

  /* ----- ICM® (Humetria) : valeur, évolution, 6 missions managériales, comparaison avec la performance SQCDP ----- */
  var ICM_LBL = { M1:'Cap', M2:'Organisation', M3:'Compétences', M4:'Écarts & risques', M5:'Sens', M6:'Engagement' };
  function wmean(rows, f){ var s = 0, w = 0; rows.forEach(function(r){ var v = f(r); if (v != null && !isNaN(v)){ s += v * r.nb_managers; w += r.nb_managers; } }); return w ? s / w : null; }
  function pearson(a, b){ var n = a.length; if (n < 4) return null; var ma = a.reduce(function(x, y){ return x + y; }, 0) / n, mb = b.reduce(function(x, y){ return x + y; }, 0) / n, sa = 0, sb = 0, sab = 0; for (var i = 0; i < n; i++){ sa += (a[i] - ma) * (a[i] - ma); sb += (b[i] - mb) * (b[i] - mb); sab += (a[i] - ma) * (b[i] - mb); } return (sa === 0 || sb === 0) ? null : sab / Math.sqrt(sa * sb); }
  function lastTwoBySite(rows){ var by = {}; rows.forEach(function(r){ (by[r.espace_id] = by[r.espace_id] || []).push(r); }); var out = []; Object.keys(by).forEach(function(k){ var L = by[k].sort(function(x, y){ return x.mesure_le < y.mesure_le ? 1 : -1; }); out.push({ id:k, last:L[0], prev:L[1] || null, all:L }); }); return out; }
  function spark(vals, w, h, col){ if (vals.length < 2) return ''; var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals); if (mn === mx){ mn -= 1; mx += 1; } var pts = vals.map(function(v, i){ return (4 + (w - 8) * i / (vals.length - 1)).toFixed(1) + ',' + (4 + (h - 8) * (1 - (v - mn) / (mx - mn))).toFixed(1); }); return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"><polyline fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="' + pts.join(' ') + '"/><circle cx="' + pts[pts.length - 1].split(',')[0] + '" cy="' + pts[pts.length - 1].split(',')[1] + '" r="3.5" fill="' + col + '"/></svg>'; }
  function icmSummary(){ if (!SP.icmOn || !SP.icm.length) return null; var S = lastTwoBySite(SP.icm), cur = wmean(S.map(function(x){ return x.last; }), function(r){ return Number(r.icm_pct); }), prevRows = S.filter(function(x){ return x.prev; }).map(function(x){ return x.prev; }), prev = prevRows.length === S.length ? wmean(prevRows, function(r){ return Number(r.icm_pct); }) : null; return { cur:cur, prev:prev, S:S }; }
  function icmHtml(e, ids){
    if (!SP.icmOn) return ''; var h = '<div class="field-label" style="margin-top:18px;">ICM® · comportements managériaux (Humetria)</div>';
    if (SP.icmErr === 'absent') return X.ceo ? h + '<div class="panel" style="padding:10px 14px;color:var(--signal);">ICM indisponible : exécutez d\u2019abord aic_brique3b_icm.sql.</div>' : '';
    if (SP.icmErr) return h + '<div class="panel" style="padding:10px 14px;color:var(--signal);">ICM indisponible : ' + esc(SP.icmErr) + '</div>';
    if (!SP.icm.length) return h + '<div class="panel" style="padding:12px 16px;">Aucune mesure ICM® pour ' + (ids.length > 1 ? 'ces sites' : 'ce site') + '. ' + (X.ceo ? 'Renseignez la « réf. Humetria » dans Admin › Structures AIC, puis importez ou connectez Humetria.' : 'Elles apparaissent dès que Humetria les transmet.') + '</div>';
    var sm = icmSummary(), delta = (sm.prev != null) ? sm.cur - sm.prev : null, leaf = e.niveau === 3, lastRow = sm.S[0].last;
    var hist = leaf ? sm.S[0].all.slice(0, 12).reverse().map(function(r){ return Number(r.icm_pct); }) : [];
    var card = '<div class="aicx-card"><h4>ICM® ' + (leaf ? 'du site' : 'moyenne pondérée des sites') + '</h4><div class="aicx-row"><div><span class="aicx-big">' + fmt(sm.cur) + '</span><span class="aicx-unit">%</span></div>' + spark(hist, 110, 44, '#560A0F') + '</div>'
      + '<div class="aicx-sub">' + (delta != null ? '<b style="color:' + (delta > 0.05 ? SC.vert.c : delta < -0.05 ? SC.rouge.c : '#7b6b63') + '">' + (delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : '= ') + fmt(delta) + ' pt</b> depuis la mesure précédente · ' : '')
      + (leaf ? 'mesuré le ' + esc(fdate(lastRow.mesure_le)) + ' · ' + lastRow.nb_managers + ' managers' : sm.S.length + ' site(s) mesuré(s)') + '</div></div>';
    var det = '';
    if (leaf && lastRow.detail){ det = '<div class="aicx-card"><h4>Six missions managériales</h4>' + Object.keys(ICM_LBL).map(function(k){ var v = lastRow.detail[k]; return v == null ? '' : '<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin:3px 0;"><span style="width:104px;">' + k + ' ' + esc(ICM_LBL[k]) + '</span><span style="flex:1;background:#f1ece7;border-radius:5px;height:10px;overflow:hidden;"><span style="display:block;height:100%;width:' + Math.max(0, Math.min(100, v)) + '%;background:#560A0F;"></span></span><b style="width:42px;text-align:right;">' + fmt(v) + ' %</b></div>'; }).join('') + '</div>'; }
    else if (!leaf){ det = '<div class="aicx-card" style="grid-column:span 2;overflow-x:auto;"><h4>Par site</h4><table style="width:100%;font-size:12.5px;"><thead><tr><th style="text-align:left">Site</th><th>ICM %</th><th>Évolution</th><th>Mesuré le</th><th>Managers</th></tr></thead><tbody>' + sm.S.map(function(x){ var sp = byId(X.espaces, x.id), d = x.prev ? Number(x.last.icm_pct) - Number(x.prev.icm_pct) : null; return '<tr><td>' + esc(sp ? sp.libelle.replace(/^AIC 3 · /, '') : '') + '</td><td style="text-align:center"><b>' + fmt(x.last.icm_pct) + '</b></td><td style="text-align:center;color:' + (d == null ? '#7b6b63' : d > 0.05 ? SC.vert.c : d < -0.05 ? SC.rouge.c : '#7b6b63') + '">' + (d == null ? '—' : (d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= ') + fmt(d)) + '</td><td style="text-align:center">' + esc(fdate(x.last.mesure_le)) + '</td><td style="text-align:center">' + x.last.nb_managers + '</td></tr>'; }).join('') + '</tbody></table></div>'; }
    /* Comparaison mensuelle ICM ↔ part de relevés « vert » */
    var im = {}, vmM = {}; SP.icm.forEach(function(r){ (im[r.mesure_le.slice(0, 7)] = im[r.mesure_le.slice(0, 7)] || []).push(r); });
    SP.vm.forEach(function(r){ var k = String(r.mois).slice(0, 7); vmM[k] = vmM[k] || { v:0, n:0 }; vmM[k].v += Number(r.nb_verts); vmM[k].n += Number(r.nb_releves); });
    var months = Object.keys(im).concat(Object.keys(vmM)).filter(function(m, i, a){ return a.indexOf(m) === i; }).sort().slice(-12), A = [], B = [];
    var series = months.map(function(m){ var icm = im[m] ? wmean(im[m], function(r){ return Number(r.icm_pct); }) : null, vt = (vmM[m] && vmM[m].n >= 5) ? 100 * vmM[m].v / vmM[m].n : null; if (icm != null && vt != null){ A.push(icm); B.push(vt); } return { m:m, icm:icm, vt:vt }; });
    var r = pearson(A, B), W = 400, H = 150, pl = 30, pr = 10, pt = 10, pb = 22, cmp;
    if (months.length < 2) cmp = '<div class="sub-cell">Il faut au moins deux mois de données pour comparer.</div>';
    else {
      function Xp(i){ return pl + (W - pl - pr) * (months.length > 1 ? i / (months.length - 1) : .5); } function Yp(v){ return pt + (H - pt - pb) * (1 - v / 100); }
      function line(key, col){ var pts = series.map(function(x, i){ return x[key] == null ? null : Xp(i).toFixed(1) + ',' + Yp(x[key]).toFixed(1); }).filter(Boolean); return (pts.length > 1 ? '<polyline fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linejoin="round" points="' + pts.join(' ') + '"/>' : '') + series.map(function(x, i){ return x[key] == null ? '' : '<circle cx="' + Xp(i).toFixed(1) + '" cy="' + Yp(x[key]).toFixed(1) + '" r="3.5" fill="' + col + '"><title>' + esc(x.m + ' : ' + fmt(x[key]) + ' %') + '</title></circle>'; }).join(''); }
      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;" role="img" aria-label="ICM et part de relevés verts par mois">' + [0, 50, 100].map(function(v){ return '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Yp(v) + '" y2="' + Yp(v) + '" stroke="#e6e0da"/><text x="' + (pl - 5) + '" y="' + (Yp(v) + 4) + '" text-anchor="end" font-size="10" fill="#7b6b63">' + v + '</text>'; }).join('') + [0, months.length - 1].map(function(i){ return '<text x="' + Xp(i) + '" y="' + (H - 6) + '" text-anchor="' + (i ? 'end' : 'start') + '" font-size="10" fill="#7b6b63">' + esc(months[i].slice(5) + '/' + months[i].slice(2, 4)) + '</text>'; }).join('') + line('icm', '#560A0F') + line('vt', SC.vert.c) + '</svg>';
      cmp = svg + '<div class="aicx-sub"><span style="color:#560A0F;font-weight:700;">● ICM %</span> · <span style="color:' + SC.vert.c + ';font-weight:700;">● part de relevés verts (SQCDP)</span><br>' + (r != null ? '<b>r = ' + fmt(r) + '</b> sur ' + A.length + ' mois communs' : 'Corrélation affichée à partir de 4 mois communs (' + A.length + ' pour l\u2019instant)') + '. Indicatif : une corrélation n\u2019est pas une causalité (la référence r = 0,83 est établie sur 50+ sites).</div>';
    }
    return h + '<div class="aicx-cards">' + card + det + '</div><div class="aicx-card" style="margin-bottom:12px;"><h4>ICM® ↔ performance SQCDP</h4>' + cmp + '</div>';
  }
  function dashEl(){ return (X.session && document.getElementById('aicBoardPane')) || view(); }
  function aicxDashboard(){
    aicxCss();
    var e = byId(X.espaces, X.open); if (!e) { aicxList(); return; }
    var inSess = !!(X.session && X.session.espaceId === e.id);
    var m = byId(X.missions, e.mission_id) || {}, ids = leaves(e).map(function(x){ return x.id; }), IX = indexSt(), IXV = indexVal(), thems = themsFor(e), leaf = e.niveau === 3;
    var chain = [], cur = e; while (cur) { chain.unshift(cur); cur = cur.parent_id ? byId(X.espaces, cur.parent_id) : null; }
    var sel = thems.filter(function(t){ return t.id === SP.sel; })[0] || thems[0] || null; if (sel) SP.sel = sel.id;
    var b = bounds(SP.month);

    var h = (inSess ? '' : head()
      + '<div class="aicx-bar"><button type="button" class="add-btn sm ghost" onclick="aicxBack()">← Tous les espaces</button>'
      + '<span class="aicx-chip">' + esc(m.client || '') + ' · ' + esc(m.intitule || '') + '</span>' + chain.map(function(c){ return '<span class="aicx-chip">' + esc(NIV_LBL[c.niveau]) + '</span>'; }).join('') + '</div>'
      + '<div class="aicx-bar"><div class="aicx-title" style="margin:0;">' + esc(e.libelle) + (e.archived_at ? ' <span class="pill p-grey">archivé</span>' : '') + '</div>'
      + (canAnimate(e) ? '<span style="margin-left:auto;display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap;"><span id="aicx_lfb" role="status" style="font-size:12px;"></span><button type="button" class="add-btn ghost" style="font-size:15px;padding:10px 18px;" onclick="aicxPrepare()">🧠 Préparer l\u2019AIC</button><button type="button" class="add-btn aicx-go" style="font-size:15px;padding:10px 18px;" onclick="aicxLaunch()">▶ Lancer l\u2019AIC</button></span>' : '') + '</div>'
      + '<div class="sub-cell">Membres : ' + (membresDe(e.id).map(function(x){ return esc(x.email); }).join(', ') || 'aucun') + '</div>')
      + '<div class="aicx-month"><button type="button" class="add-btn sm ghost" onclick="aicxMonth(-1)" aria-label="Mois précédent">‹</button><b>' + MOIS[b.mo - 1] + ' ' + b.y + '</b><button type="button" class="add-btn sm ghost" onclick="aicxMonth(1)" aria-label="Mois suivant"' + (SP.month >= curMonth() ? ' disabled' : '') + '>›</button>'
      + (SP.month !== curMonth() ? '<button type="button" class="add-btn sm" onclick="aicxThisMonth()">Aujourd\u2019hui</button>' : '') + '<button type="button" class="add-btn sm ghost" onclick="aicxRefresh()" title="Recharger depuis la base" style="margin-left:auto;">↻ Actualiser</button></div>'
      + '<div class="aicx-leg"><span>' + dot('vert', 16) + ' Vert · objectif tenu</span><span>' + dot('orange', 16) + ' Orange · écart, à surveiller</span><span>' + dot('rouge', 16) + ' Rouge · non tenu, action requise</span><span>' + dot(null, 16) + ' Non renseigné</span>' + (!leaf ? '<span>· Vue consolidée : la <b>pire</b> situation des sites</span>' : '') + '</div>';

    if (SP.stErr) h += '<div class="panel" style="padding:10px 14px;color:var(--signal);margin-top:8px;">Relevés indisponibles : ' + esc(SP.stErr) + '</div>';
    if (SP.valErr) h += '<div class="panel" style="padding:10px 14px;color:var(--signal);margin-top:8px;">Valeurs indisponibles : ' + esc(SP.valErr) + '</div>';
    if (SP.ref && SP.ref.err) h += '<div class="panel" style="padding:10px 14px;color:var(--signal);margin-top:8px;">Référentiel indisponible : ' + esc(SP.ref.err) + '</div>';

    if (!thems.length) h += '<div class="panel" style="padding:14px 16px;margin-top:10px;">Aucune thématique active pour le niveau ' + e.niveau + '. Elles se configurent dans Admin › Référentiel AIC.</div>';
    else {
      h += '<div class="aicx-board">' + thems.map(function(t){ return tileHtml(IX, IXV, t, e, ids, sel && t.id === sel.id); }).join('') + '</div>';
      if (!leaf) h += '<div class="field-label">Vue d\u2019ensemble des sites · ' + (SP.month === curMonth() ? 'aujourd\u2019hui' : 'dernier relevé du mois') + '</div>' + sitesMatrixHtml(IX, thems, leaves(e));
      h += icmHtml(e, ids);
      if (sel){
        var rd = refDay(IX, sel.id, ids) || chartEnd();
        h += '<div class="field-label" style="margin-top:18px;">' + esc(sel.code) + ' · ' + esc(sel.libelle) + '</div>' + zonesHtml(IX, IXV, sel, e, ids)
          + '<div class="aicx-two"><div><div class="field-label">Relevés de ' + MOIS[b.mo - 1] + '</div>' + calendarHtml(IX, sel, e, ids, leaf) + (leaf ? editorHtml(IX, IXV, sel, e) : '<div class="sub-cell" style="margin-top:10px;">Consolidation en lecture seule. Ouvrez un site pour saisir ou corriger un relevé.</div>') + '</div>'
          + '<div><div class="field-label">Indicateurs de suivi</div>' + indicatorsHtml(IXV, sel, e, ids, rd) + '<div class="field-label" style="margin-top:14px;">Derniers commentaires</div>' + timelineHtml(sel, ids) + '</div></div>';
      }
    }

    var kids = X.espaces.filter(function(x){ return x.parent_id === e.id && visibleArch(x); });
    if (!inSess && !leaf && kids.length) h += '<div class="field-label" style="margin-top:18px;">' + (e.niveau === 1 ? 'Espace AIC 2' : 'Sites') + '</div><div style="display:flex;gap:8px;flex-wrap:wrap;">' + kids.map(function(f){ return '<button type="button" class="add-btn sm" onclick="aicxOpen(\'' + f.id + '\')">' + esc(f.libelle) + '</button>'; }).join('') + '</div>';
    if (!inSess) h += seancesHtml(e);

    h += '<div class="field-label" style="margin-top:18px;">Actions Clap! rattachées (rituel « ' + esc(e.libelle) + ' »)</div>';
    if (!SP.acts || SP.acts.err) h += '<div class="panel" style="padding:12px 16px;color:var(--signal);">Actions indisponibles' + (SP.acts ? ' : ' + esc(SP.acts.err) : '') + '.</div>';
    else if (!SP.acts.list.length) h += '<div class="panel" style="padding:12px 16px;">Aucune action rattachée. Les actions décidées pendant une séance AIC s\u2019y rattachent automatiquement (rituel et site).</div>';
    else h += '<div class="panel" style="padding:8px 16px;">' + SP.acts.list.map(function(a){ return '<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid rgba(86,10,15,.08);font-size:13px;"><span class="sub-cell">#' + esc(a.numero || '') + '</span><span>' + esc(a.libelle) + '</span><span class="sub-cell" style="margin-left:auto;white-space:nowrap;">' + esc(a.statut || '') + (a.echeance ? ' · ' + esc(fdate(a.echeance)) : '') + '</span></div>'; }).join('') + '</div>';
    dashEl().innerHTML = h;
  }

  /* ---------- Séance AIC : réutilise Réunions & Rituels (préparation IA, dictée, synthèse, actions, mail) ---------- */
  function crReady(){ return typeof window.renderCRSheet === 'function' && typeof window.crOpen === 'function'; }
  /* Ordre du jour prérempli : écarts du jour, indicateurs vs cibles, actions en cours, participants. */
  function buildAgenda(e){
    var IX = indexSt(), IXV = indexVal(), ids = leaves(e).map(function(x){ return x.id; }), ref = todayIso(), L = [];
    L.push('AIC ' + e.niveau + ' · ' + e.libelle + ' · ' + longDate(ref));
    L.push('Objectif : revoir les écarts SQCDP, décider des actions (quoi, qui, quand) et remonter les sujets non traités au niveau supérieur.', '');
    L.push('SITUATION SQCDP DU JOUR');
    themsFor(e).forEach(function(t){
      var a = agg(IX, t.id, ref, ids), line = '- ' + t.code + ' ' + t.libelle + ' : ' + (a.st ? SC[a.st].l.toUpperCase() : 'non renseigné') + (ids.length > 1 ? ' (' + a.n + '/' + ids.length + ' sites)' : '');
      var one = ids.length === 1 ? IX[ids[0] + '|' + t.id + '|' + ref] : null; if (one && one.commentaire) line += ' — ' + one.commentaire;
      var run = 0; for (var k = 0; k < 30; k++){ var s = agg(IX, t.id, addDays(ref, -k), ids).st; if (s && s !== 'vert') run++; else if (k > 0 || s) break; } if (a.st && a.st !== 'vert' && run > 1) line += ' — ' + run + ' jours consécutifs hors vert';
      L.push(line);
      indsFor(t, e).forEach(function(i){ var lv = lastVal(IXV, i.id, ids, ref); if (!lv) return; var tr = trendOf(function(j){ var r = valDay(IXV, i.id, ids, j); return r ? r.v : null; }, ref, i.sens);
        L.push('    · ' + i.libelle + ' : ' + fmt(lv.v) + ' ' + (i.unite || '') + (i.cible != null ? ' (cible ' + (i.sens === 'bas' ? '≤ ' : '≥ ') + fmt(i.cible) + ')' : '') + (tr.dir && tr.dir !== 'flat' ? ' · ' + (tr.dir === 'up' ? 'en hausse' : 'en baisse') + (tr.fav === true ? ' (favorable)' : ' (défavorable)') : '')); });
      if (ids.length > 1) leaves(e).forEach(function(sx){ var g = IX[sx.id + '|' + t.id + '|' + ref]; if (g && RANK[g.statut] && g.statut !== 'vert') L.push('    · ' + sx.libelle.replace(/^AIC 3 · /, '') + ' : ' + SC[g.statut].l + (g.commentaire ? ' — ' + g.commentaire : '')); });
    });
    var sm = icmSummary(); if (sm) L.push('', 'ICM® (Humetria) : ' + fmt(sm.cur) + ' %' + (sm.prev != null ? ' (' + (sm.cur - sm.prev >= 0 ? '+' : '') + fmt(sm.cur - sm.prev) + ' pt vs mesure précédente)' : '') + (ids.length > 1 ? ' · moyenne pondérée de ' + sm.S.length + ' site(s)' : ''));
    var open = (SP.acts && SP.acts.list || []).filter(function(a){ return !/fait|clos|termin|annul/i.test(a.statut || ''); });
    L.push('', 'ACTIONS EN COURS RATTACHÉES À CE RITUEL (' + open.length + ')'); open.slice(0, 15).forEach(function(a){ L.push('- #' + a.numero + ' ' + a.libelle + (a.echeance ? ' (échéance ' + fdate(a.echeance) + ')' : '') + (a.echeance && a.echeance < ref ? ' — EN RETARD' : '')); });
    L.push('', 'Rituel : ' + e.libelle + (siteName(e) ? ' · Site : ' + siteName(e) : ''));
    return L.join('\n');
  }
  async function pilotesFor(e){
    var emails = membresDe(e.id).map(function(m){ return m.email; }); if (me() && emails.indexOf(me()) < 0) emails.push(me());
    var r = await db().from('action_pilotes').select('id,email,actif'); var ids = [];
    ((r && r.data) || []).forEach(function(p){ if (p.email && p.actif !== false && emails.indexOf(String(p.email).toLowerCase()) >= 0) ids.push(p.id); }); return ids;
  }
  /* Séance du jour de cet espace : reprise si elle existe, sinon créée (ordre du jour prérempli). Réservé à l'animateur. */
  async function aicxEnsureSeance(e, fbId){
    if (!canAnimate(e)) throw new Error('Réservé à l\u2019animateur de cet AIC.');
    if (!crReady()) throw new Error('Module Réunions & Rituels indisponible.');
    var ex = await db().from('comptes_rendus').select('id,statut,preparation').eq('aic_espace_id', e.id).eq('date_reunion', todayIso()).neq('statut', 'cloture').order('created_at', { ascending:false }).limit(1);
    if (ex.error) throw ex.error;
    if (ex.data && ex.data.length) return { id:ex.data[0].id, prepared:!!(ex.data[0].preparation && String(ex.data[0].preparation).trim()), created:false };
    var pil = await pilotesFor(e);
    var row = { titre:'AIC · ' + e.libelle.replace(/^AIC \d · /, '') + ' · ' + fdate(todayIso()), date_reunion:todayIso(), contexte:buildAgenda(e), est_routine:true, statut:'prepa', participants:pil, autorises:pil, actions_numeros:[], aic_espace_id:e.id };
    var ins = await db().from('comptes_rendus').insert(row).select('id,numero').single(); if (ins.error) throw ins.error;
    return { id:ins.data.id, prepared:false, created:true };
  }
  /* 🧠 Préparer l'AIC : même préparation IA que Réunions & Rituels (actions de l'équipe, questions à poser) sur l'ordre du jour généré. */
  window.aicxPrepare = async function(){
    var e = byId(X.espaces, X.open); if (!e) return; flash('aicx_lfb', true, 'Préparation de la séance…');
    try {
      var s = await aicxEnsureSeance(e); await aicxStartSession(s.id, 'cr', false, 'prepa');
      if (!s.prepared && typeof window.crPrep === 'function'){ flash('aicx_sfb', true, '🧠 Préparation IA en cours…'); await window.crPrep(); flash('aicx_sfb', true, '✓ Préparation prête : relisez-la, puis « Lancer l\u2019AIC »'); }
      else if (s.prepared) flash('aicx_sfb', true, 'Préparation déjà générée aujourd\u2019hui : relancez-la depuis le compte-rendu si besoin.');
    } catch(err){ flash('aicx_lfb', false, 'Refusé : ' + ((err && err.message) || err)); }
  };
  window.aicxLaunch = async function(){
    var e = byId(X.espaces, X.open); if (!e) return; flash('aicx_lfb', true, 'Lancement de la séance…');
    try { var s = await aicxEnsureSeance(e); await aicxStartSession(s.id, 'board', false, 'live'); }
    catch(err){ flash('aicx_lfb', false, 'Refusé : ' + ((err && err.message) || err)); }
  };
  window.aicxGoLive = function(){ if (X.session) return aicxStartSession(X.session.crId, 'board', true, 'live'); };
  window.aicxOpenSeance = function(id){
    var c = SP.seances.filter(function(x){ return x.id === id; })[0], today = c && c.date_reunion === todayIso() && c.statut !== 'cloture';
    return aicxStartSession(id, 'cr', false, today ? 'live' : 'revue', c ? c.date_reunion : null);
  };
  async function aicxStartSession(crId, pane, resume, mode, dateSeance){
    var e = byId(X.espaces, X.open) || byId(X.espaces, X.session && X.session.espaceId); if (!e) return;
    var m = mode || (X.session && X.session.mode) || 'live', dt = dateSeance || (X.session && X.session.date) || null;
    X.open = e.id; X.session = { crId:crId, espaceId:e.id, pane:pane || 'board', mode:m, date:dt };
    var tag = m === 'prepa' ? '<span class="aicx-live aicx-prep">◐ PRÉPARATION DE L\u2019AIC</span>' : (m === 'revue' ? '<span class="aicx-prep" style="font-weight:800;font-size:12px;letter-spacing:.08em;">📄 SÉANCE DU ' + esc(dt ? fdate(dt) : '') + '</span>' : '<span class="aicx-live">● AIC EN COURS</span>');
    var btns = m === 'prepa' ? '<button type="button" class="add-btn sm aicx-go" style="margin-left:auto;" onclick="aicxGoLive()">▶ Lancer l\u2019AIC</button><button type="button" class="add-btn sm ghost" onclick="aicxEndSession()">Fermer</button>'
             : m === 'revue' ? '<button type="button" class="add-btn sm ghost" style="margin-left:auto;" onclick="aicxEndSession()">Fermer</button>'
             : '<button type="button" class="add-btn sm" style="margin-left:auto;" onclick="aicxEndSession()">■ Terminer l\u2019AIC</button>';
    view().innerHTML = '<div class="aicx-sbar" data-mode="' + m + '">' + tag + '<b>' + esc(e.libelle) + '</b>'
      + '<span class="aicx-seg" role="group" aria-label="Volet"><button type="button" id="aicx_pb" onclick="aicxPane(\'board\')">① Tableau SQCDP</button><button type="button" id="aicx_pc" onclick="aicxPane(\'cr\')">② Compte-rendu &amp; actions</button></span>'
      + btns + '<span id="aicx_sfb" role="status" style="font-size:12px;"></span></div>'
      + '<div id="aicBoardPane"></div><div id="aicSeanceCR" style="display:none;"></div>';
    aicxDashboard();
    try { await window.renderCRSheet('aicSeanceCR'); if (!resume) await window.crOpen(crId); } catch(err){ flash('aicx_sfb', false, 'Compte-rendu indisponible : ' + ((err && err.message) || err)); }
    aicxPane(X.session.pane);
  }
  window.aicxPane = function(p){
    if (!X.session) return; X.session.pane = p; var b = document.getElementById('aicBoardPane'), c = document.getElementById('aicSeanceCR');
    if (b) b.style.display = p === 'board' ? '' : 'none'; if (c) c.style.display = p === 'cr' ? '' : 'none';
    var pb = document.getElementById('aicx_pb'), pc = document.getElementById('aicx_pc'); if (pb) pb.className = p === 'board' ? 'on' : ''; if (pc) pc.className = p === 'cr' ? 'on' : '';
    window.scrollTo(0, 0);
  };
  async function aicxCloseSession(){ X.session = null; try { await aicxLoadSpace(); } catch(_){} aicxDashboard(); window.scrollTo(0, 0); }
  async function waitEditorGone(){ for (var i = 0; i < 15; i++){ await new Promise(function(r){ setTimeout(r, 100); }); if (!document.querySelector('#aicSeanceCR #crTitre')) return true; } return false; }
  window.aicxEndSession = async function(){ if (typeof window.crBack === 'function') await window.crBack(); };
  /* « Fermer » / « ← Liste » du compte-rendu (et notre bouton Terminer) : on revient au tableau de l'espace. */
  var _crBack = window.crBack;
  if (typeof _crBack === 'function') window.crBack = async function(){
    var r = await _crBack.apply(this, arguments);
    if (X.session && document.getElementById('aicSeanceCR')){ if (await waitEditorGone()) await aicxCloseSession(); }
    return r;
  };
  /* Actions décidées pendant l'AIC : rituel (routine) et site renseignés automatiquement dans Clap!. */
  var _crCreate = window.crCreateActions;
  if (typeof _crCreate === 'function') window.crCreateActions = async function(){
    var r = await _crCreate.apply(this, arguments);
    if (X.session){
      try {
        var e = byId(X.espaces, X.session.espaceId), q = await db().from('comptes_rendus').select('actions_numeros').eq('id', X.session.crId).maybeSingle();
        var nums = (q && q.data && q.data.actions_numeros) || [], n = await tagActions(nums, e);
        flash('aicx_sfb', true, n ? '✓ ' + n + ' action(s) rattachée(s) au rituel « ' + e.libelle + ' »' + (siteName(e) ? ' · site « ' + siteName(e) + ' »' : '') : '✓ Actions déjà rattachées');
      } catch(err){ flash('aicx_sfb', false, 'Actions créées mais non rattachées à l\u2019AIC : ' + ((err && err.message) || err)); }
    }
    return r;
  };

  window.aicxReload = function(){ return document.getElementById('aicStruct') ? aicxStructLoad() : aicxMain(); };
})();
