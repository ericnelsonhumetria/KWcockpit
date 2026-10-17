/* COCKPIT KW — Page Admin en pavés par thématique (public/shared/admin-ux.js) — v2
   Additif : une seule ligne <script> dans index.html, APRÈS dialogs.js (et avant session-restore.js). Retour arrière : remettre la v1 (?v=1).
   RIEN n'est supprimé : aucun bouton, champ ni enregistrement ne change de fonctionnement. Les blocs existants sont seulement RANGÉS.
   1. ACCUEIL EN PAVÉS : l'Admin s'ouvre sur une grille de pavés, un par thématique, chacun avec son état en un coup d'œil :
        Utilisateurs (comptes, invitations) · Droits d'accès (matrice par fonction, profil Membre Codir, options Obeya) ·
        AIC (référentiel QCDP, structures, bilans et sujets) · Relances & e-mails · Finance (objectif de CA) · Dojo — résultats (lien).
      Un clic ouvre la thématique ; un rail (ou une barre sur mobile) permet de passer de l'une à l'autre ; « ← Administration » ramène aux pavés.
      La thématique ouverte est mémorisée pour la session. Un bloc inconnu (ajouté plus tard par un autre module) tombe dans « Autres » : rien ne se perd.
   2. Les utilisateurs se chargent dès l'ouverture d'Admin (plus de bouton « Charger les utilisateurs » à cliquer).
   3. UTILISATEURS : recherche (e-mail, fonction), filtres Tous / Actifs / Non confirmés / Désactivés, résumé chiffré (inchangé depuis la v1).
   4. ACCÈS : les trois colonnes Obeya restent repliables (inchangé depuis la v1).
   Sûreté : si l'installation échoue, tout reste affiché comme avant (aucun bloc masqué). */
(function(){
  'use strict';
  if (window.__kwAdmUx) return; window.__kwAdmUx = true;
  var B = '#560A0F', O = '#EFB810';
  var THEMES = [
    { k:'users',    ico:'👥', t:'Utilisateurs',        d:'Comptes, fonctions, mots de passe, invitations.' },
    { k:'access',   ico:'🔐', t:'Droits d’accès',  d:'Onglets ouverts par fonction, profil Membre Codir, cartes Obeya.' },
    { k:'aic',      ico:'🎯', t:'AIC',                  d:'Référentiel des thématiques et indicateurs, structures, bilans et sujets.' },
    { k:'relances', ico:'✉️', t:'Relances & e-mails',   d:'Rappel par mail des actions en cours, test d’envoi.' },
    { k:'finance',  ico:'💶', t:'Finance',              d:'Objectif de CA annuel (barre de progression, synthèse direction).' },
    { k:'autres',   ico:'🧩', t:'Autres réglages',      d:'Blocs ajoutés par d’autres modules.' }
  ];
  var KEYS = THEMES.map(function(x){ return x.k; });
  var STATE = { theme:'home', q:'', st:'all' }, LS_OB = 'kw:adm:obeya', INFO = { them:null, missions:null, at:0 };
  try { var t0 = sessionStorage.getItem('kw:adm:theme'); if (t0 && (t0 === 'home' || KEYS.indexOf(t0) >= 0)) STATE.theme = t0; } catch(e){}
  function el(tag, props, kids){
    var e = document.createElement(tag); props = props || {};
    Object.keys(props).forEach(function(k){ if (k === 'text') e.textContent = props[k]; else if (k === 'html') e.innerHTML = props[k]; else e.setAttribute(k, props[k]); });
    (kids || []).forEach(function(c){ if (c) e.appendChild(c); }); return e;
  }
  function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function view(){ return document.getElementById('view'); }
  function onAdmin(){ try { return typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB === 'admin'; } catch(e){ return false; } }

  var hide = KEYS.map(function(k){ return '#view[data-kwadm="' + k + '"] [data-kwtab]:not([data-kwtab="' + k + '"])'; }).join(',');
  var CSS = ''
    + hide + '{display:none !important;}'
    + '#view[data-kwadm="home"] [data-kwtab],#view[data-kwadm="home"] #adminZone{display:none !important;}'
    + '#view[data-kwadm]:not([data-kwadm="home"]) .kwAdmGrid{display:none;}'
    + '#view[data-kwadm="home"] .kwAdmShell{display:none;}'
    + '#view[data-kwadm]:not([data-kwadm="home"]) > .sec-note{display:none;}'
    /* pavés */
    + '.kwAdmGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr));gap:14px;margin:16px 0 8px;}'
    + '.kwAdmTile{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:8px;min-height:150px;padding:18px 18px 16px;background:#fff;border:1px solid rgba(86,10,15,.14);border-radius:14px;box-shadow:0 1px 2px rgba(26,20,22,.05);transition:border-color .15s,box-shadow .15s,transform .15s;position:relative;}'
    + '.kwAdmTile:hover{border-color:' + B + ';box-shadow:0 8px 24px rgba(86,10,15,.12);transform:translateY(-1px);}'
    + '.kwAdmTile:focus-visible{outline:3px solid ' + O + ';outline-offset:2px;}'
    + '.kwAdmTile .kwTop{display:flex;align-items:center;gap:12px;}'
    + '.kwAdmTile .kwIco{width:42px;height:42px;border-radius:11px;background:rgba(239,184,16,.16);display:flex;align-items:center;justify-content:center;font-size:21px;flex:0 0 auto;}'
    + '.kwAdmTile .kwT{font-weight:800;font-size:17px;line-height:1.2;color:' + B + ';}'
    + '.kwAdmTile .kwD{font-size:13px;line-height:1.45;color:#5c4e4b;}'
    + '.kwAdmTile .kwS{margin-top:auto;padding-top:10px;border-top:1px solid rgba(86,10,15,.08);display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12.5px;color:#4a3d40;min-height:30px;}'
    + '.kwAdmTile .kwGo{position:absolute;top:18px;right:16px;color:rgba(86,10,15,.35);font-size:18px;transition:color .15s,transform .15s;}'
    + '.kwAdmTile:hover .kwGo{color:' + B + ';transform:translateX(2px);}'
    + '.kwBadge{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;background:#f4efe8;font-weight:600;font-size:12px;color:#4a3d40;white-space:nowrap;}'
    + '.kwBadge.warn{background:#fff3d1;color:#7a5600;}.kwBadge.off{background:#f3e3e3;color:#7d1f1f;}.kwBadge.ok{background:#e3efe6;color:#25603a;}'
    + '.kwLet{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 5px;border-radius:6px;color:#fff;font-weight:800;font-size:12px;}'
    /* thématique ouverte : rail + contenu */
    + '.kwAdmShell{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 10px;}'
    + '.kwAdmBack{all:unset;cursor:pointer;font-weight:600;font-size:13.5px;color:' + B + ';padding:7px 12px 7px 8px;border-radius:8px;}'
    + '.kwAdmBack:hover{background:rgba(86,10,15,.07);}'
    + '.kwAdmCrumb{font-weight:800;font-size:19px;line-height:1.2;color:#1a1416;display:flex;align-items:center;gap:9px;}'
    + '.kwAdmRail{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto;}'
    + '.kwAdmRail button{all:unset;cursor:pointer;font-weight:600;font-size:13px;padding:6px 12px;border-radius:999px;border:1px solid rgba(86,10,15,.22);color:' + B + ';background:#fff;white-space:nowrap;}'
    + '.kwAdmRail button:hover{border-color:' + B + ';}'
    + '.kwAdmRail button[aria-current="true"]{background:' + B + ';border-color:' + B + ';color:#fff;}'
    + '.kwAdmRail button:focus-visible,.kwAdmBack:focus-visible{outline:3px solid ' + O + ';outline-offset:2px;}'
    + '@media (max-width:760px){.kwAdmRail{margin-left:0;width:100%;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;}.kwAdmGrid{grid-template-columns:1fr;}.kwAdmTile{min-height:0;}}'
    /* blocs de la thématique : espacement régulier */
    + '#view[data-kwadm] #adminZone > [data-kwtab],#view[data-kwadm] #adminPilotesZone > [data-kwtab]{margin-top:14px;}'
    + '#view[data-kwadm] #aicAdmin,#view[data-kwadm] #aicStruct,#view[data-kwadm] #aicAdm2{margin-top:18px !important;}'
    /* utilisateurs (v1) */
    + '.kwUsrBar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0 4px;}'
    + '.kwUsrBar input[type=search]{font:inherit;font-size:14px;padding:7px 11px;border:1px solid rgba(86,10,15,.3);border-radius:8px;min-width:240px;}'
    + '.kwChip{all:unset;cursor:pointer;font:600 12.5px system-ui,sans-serif;padding:5px 12px;border-radius:999px;border:1px solid rgba(86,10,15,.3);color:' + B + ';background:#fff;}'
    + '.kwChip[aria-pressed="true"]{background:' + B + ';color:#fff;border-color:' + B + ';}'
    + '.kwUsrSum{font-size:12.5px;color:#6b5b58;margin-left:auto;}'
    + '#adminZone table td{padding-top:7px;padding-bottom:7px;vertical-align:middle;}'
    + '#adminZone table select{padding:5px 8px;font-size:13px;min-height:32px;}'
    + '@media (max-width:760px){#adminZone table select{min-width:140px;}#adminZone table td b{white-space:nowrap;}}'
    + '.kwObOpt{display:flex;align-items:center;gap:8px;margin:6px 0 8px;font-size:13px;color:#4a3d40;}';
  function addCss(){ if (document.getElementById('kwAdmCss')) return; var s = el('style', { id:'kwAdmCss' }); s.textContent = CSS; document.head.appendChild(s); }

  /* ---------- rangement des blocs par thématique ---------- */
  function tagOf(c){
    var id = c.id || '', ti = c.querySelector && c.querySelector('.sec-title'), txt = ti ? ti.textContent : '';
    if (id === 'adminAccessZone' || id === 'adminCodirZone') return 'access';
    if (id === 'caObjZone') return 'finance';
    if (id === 'aicAdmin' || id === 'aicStruct' || id === 'aicAdm2' || /^aic/i.test(id)) return 'aic';
    if (/Relance/i.test(txt)) return 'relances';
    if (/Inviter|Utilisateur/i.test(txt)) return 'users';
    if (c.classList && c.classList.contains('panel') && c.querySelector('table')) return 'users';
    if (!ti) return 'users';   /* message de chargement, d'erreur, etc. */
    return 'autres';
  }
  function retag(){
    var v = view(), zone = document.getElementById('adminZone'); if (!v || !zone) return;
    [].slice.call(zone.children).forEach(function(c){
      if (c.id === 'adminPilotesZone'){ [].slice.call(c.children).forEach(function(p){ p.setAttribute('data-kwtab', tagOf(p)); }); return; }
      c.setAttribute('data-kwtab', tagOf(c));
    });
    [].slice.call(v.children).forEach(function(c){
      if (c === zone || c.classList.contains('sec-eyebrow') || c.classList.contains('sec-title') || c.classList.contains('sec-note') || c.classList.contains('footer-note')
          || c.classList.contains('kwAdmGrid') || c.classList.contains('kwAdmShell') || c.tagName === 'STYLE' || c.tagName === 'SCRIPT') return;
      if (!c.hasAttribute('data-kwtab')) c.setAttribute('data-kwtab', tagOf(c));
    });
  }
  function hasTheme(k){
    var v = view(); if (!v) return false;
    if (k === 'users' || k === 'access' || k === 'relances' || k === 'finance') return true;   /* présents dès que la liste est chargée */
    var list = v.querySelectorAll('[data-kwtab="' + k + '"]');
    return [].some.call(list, function(x){ return x.innerHTML.trim() !== ''; });
  }

  /* ---------- état en un coup d'œil ---------- */
  function badge(txt, cls){ return '<span class="kwBadge' + (cls ? ' ' + cls : '') + '">' + txt + '</span>'; }
  function plural(n, s, p){ return n + ' ' + (n > 1 ? (p || s + 's') : s); }
  function status(k){
    var U = (typeof ADMIN_USERS !== 'undefined' && ADMIN_USERS) ? ADMIN_USERS : [];
    if (k === 'users'){
      if (!U.length) return badge('Chargement…');
      var on = U.filter(function(u){ return !u.desactive && u.confirme; }).length, pend = U.filter(function(u){ return !u.desactive && !u.confirme; }).length, off = U.filter(function(u){ return u.desactive; }).length;
      return badge(plural(U.length, 'compte')) + badge(plural(on, 'actif'), 'ok') + (pend ? badge(plural(pend, 'non confirmé'), 'warn') : '') + (off ? badge(plural(off, 'désactivé'), 'off') : '');
    }
    if (k === 'access'){
      var cod = U.filter(function(u){ return u.codir === true; }).length, roles = 0;
      try { roles = document.querySelectorAll('#adminAccessZone tbody tr').length; } catch(e){}
      return (roles ? badge(plural(roles, 'fonction')) : '') + badge(plural(cod, 'membre Codir', 'membres Codir')) + badge('effet à la prochaine connexion');
    }
    if (k === 'aic'){
      var h = '';
      if (INFO.them && INFO.them.length) h += INFO.them.map(function(t){ return '<span class="kwLet" title="' + esc(t.libelle || '') + '" style="background:' + esc(t.couleur || B) + ';">' + esc(t.code) + '</span>'; }).join('');
      else if (INFO.them) h += badge('aucune thématique active', 'warn');
      if (INFO.missions != null) h += badge(plural(INFO.missions, 'mission active', 'missions actives'));
      return h || badge('Référentiel, structures, bilans');
    }
    if (k === 'relances') return badge('un mail par pilote') + badge('aperçu avant envoi');
    if (k === 'finance'){
      var v = Number(window.FINANCE_OBJECTIF) || 0;
      return v ? badge('Objectif ' + new Date().getFullYear() + ' : ' + v.toLocaleString('fr-FR') + ' € HT', 'ok') : badge('objectif non défini', 'warn');
    }
    if (k === 'dojo') return badge('simulations des consultants') + badge('import, suppression');
    var n = view() ? view().querySelectorAll('[data-kwtab="autres"]').length : 0; return badge(plural(n, 'bloc'));
  }
  function loadInfo(){
    if (Date.now() - INFO.at < 60000) return Promise.resolve();
    INFO.at = Date.now();
    var db = null; try { db = (typeof SB !== 'undefined' && SB) ? SB : null; } catch(e){}
    if (!db) return Promise.resolve();
    var a = Promise.resolve(db.from('aic_thematiques').select('code,libelle,couleur,actif,ordre').eq('actif', true).order('ordre', { ascending:true }))
      .then(function(r){ if (r && !r.error) INFO.them = (r.data || []).filter(function(t){ return t.actif !== false; }); }, function(){});
    var b = Promise.resolve(db.from('aic_missions').select('id,archived_at'))
      .then(function(r){ if (r && !r.error) INFO.missions = (r.data || []).filter(function(m){ return !m.archived_at; }).length; }, function(){});
    return Promise.all([a, b]);
  }
  function dojoTile(){ try { return !!(window.kwDojoAcces && window.kwDojoAcces().resultats); } catch(e){ return false; } }

  /* ---------- accueil en pavés ---------- */
  function tiles(){
    var list = THEMES.filter(function(t){ return t.k !== 'autres' || hasTheme('autres'); }).map(function(t){ return t; });
    if (dojoTile()) list.splice(list.length - (hasTheme('autres') ? 1 : 0), 0, { k:'dojo', ico:'🥋', t:'Dojo — résultats', d:'Simulations de coaching des consultants : notes, transcriptions, import de l’historique.', link:true });
    return list;
  }
  function renderGrid(){
    var v = view(); if (!v) return; var g = v.querySelector('.kwAdmGrid');
    if (!g){ g = el('div', { 'class':'kwAdmGrid', role:'list', 'aria-label':'Thématiques d’administration' }); var z = document.getElementById('adminZone'); v.insertBefore(g, z); }
    g.innerHTML = tiles().map(function(t){
      return '<button type="button" class="kwAdmTile" role="listitem" data-theme="' + t.k + '"' + (t.link ? ' data-link="1"' : '') + '>'
        + '<span class="kwGo" aria-hidden="true">' + (t.link ? '↗' : '→') + '</span>'
        + '<span class="kwTop"><span class="kwIco" aria-hidden="true">' + t.ico + '</span><span class="kwT">' + esc(t.t) + '</span></span>'
        + '<span class="kwD">' + esc(t.d) + '</span>'
        + '<span class="kwS">' + status(t.k) + '</span></button>';
    }).join('');
    [].forEach.call(g.querySelectorAll('.kwAdmTile'), function(b){
      b.addEventListener('click', function(){
        var k = b.getAttribute('data-theme');
        if (k === 'dojo'){ try { switchTab('dojo'); var f = document.getElementById('dojoFrame'); if (f) f.src = '/dojo/resultats.html'; } catch(e){} return; }
        go(k, true);
      });
    });
  }
  function renderShell(){
    var v = view(); if (!v) return; var s = v.querySelector('.kwAdmShell');
    if (!s){ s = el('div', { 'class':'kwAdmShell' }); var z = document.getElementById('adminZone'); v.insertBefore(s, z); }
    var cur = THEMES.filter(function(t){ return t.k === STATE.theme; })[0] || THEMES[0];
    s.innerHTML = '<button type="button" class="kwAdmBack">← Administration</button>'
      + '<span class="kwAdmCrumb"><span aria-hidden="true">' + cur.ico + '</span>' + esc(cur.t) + '</span>'
      + '<nav class="kwAdmRail" aria-label="Autres thématiques">' + THEMES.filter(function(t){ return t.k !== 'autres' || hasTheme('autres'); }).map(function(t){
          return '<button type="button" data-theme="' + t.k + '"' + (t.k === STATE.theme ? ' aria-current="true"' : '') + '>' + esc(t.t) + '</button>'; }).join('') + '</nav>';
    s.querySelector('.kwAdmBack').addEventListener('click', function(){ go('home', true); });
    [].forEach.call(s.querySelectorAll('.kwAdmRail button'), function(b){ b.addEventListener('click', function(){ go(b.getAttribute('data-theme'), true); }); });
  }
  function go(k, user){
    var v = view(); if (!v) return;
    if (k !== 'home' && KEYS.indexOf(k) < 0) k = 'home';
    STATE.theme = k; try { sessionStorage.setItem('kw:adm:theme', k); } catch(e){}
    retag();
    if (k === 'home'){ renderGrid(); } else { renderShell(); }
    v.setAttribute('data-kwadm', k);
    if (user){
      try { window.scrollTo({ top: Math.max(0, v.getBoundingClientRect().top + window.pageYOffset - 140), behavior:'smooth' }); } catch(e){}
      var f = k === 'home' ? v.querySelector('.kwAdmTile') : v.querySelector('.kwAdmBack'); if (f) try { f.focus({ preventScroll:true }); } catch(e){}
    }
    if (k === 'users') applyFilter();
  }

  /* ---------- utilisateurs : recherche, filtres, résumé (v1) ---------- */
  function usersPanel(zone){ return [].filter.call(zone.children, function(c){ return c.classList && c.classList.contains('panel') && c.querySelector('table'); })[0]; }
  function rowInfo(tr){
    var b = tr.querySelector('td b'), sel = tr.querySelector('select'), pill = tr.querySelector('.pill');
    return { email:b ? b.textContent : '', role:sel ? sel.value : '', status:pill ? pill.textContent.trim() : '' };
  }
  function stKey(s){ return /désactiv/i.test(s) ? 'off' : /non confirm/i.test(s) ? 'pending' : 'on'; }
  function applyFilter(){
    var zone = document.getElementById('adminZone'); if (!zone) return; var p = usersPanel(zone); if (!p) return;
    var rows = [].filter.call(p.querySelectorAll('table tbody tr'), function(r){ return r.querySelector('td b'); }), q = STATE.q.trim().toLowerCase(), shown = 0, c = { on:0, pending:0, off:0 };
    rows.forEach(function(r){
      var i = rowInfo(r), k = stKey(i.status); c[k]++;
      var okQ = !q || (i.email + ' ' + i.role).toLowerCase().indexOf(q) >= 0, okS = STATE.st === 'all' || STATE.st === k, vis = okQ && okS;
      r.style.display = vis ? '' : 'none'; if (vis) shown++;
    });
    var sum = p.querySelector('.kwUsrSum');
    if (sum) sum.textContent = rows.length + ' utilisateur' + (rows.length > 1 ? 's' : '') + ' · ' + c.on + ' actif' + (c.on > 1 ? 's' : '') + (c.pending ? ' · ' + c.pending + ' non confirmé' + (c.pending > 1 ? 's' : '') : '') + (c.off ? ' · ' + c.off + ' désactivé' + (c.off > 1 ? 's' : '') : '') + (shown !== rows.length ? ' — ' + shown + ' affiché' + (shown > 1 ? 's' : '') : '');
  }
  function buildUsersBar(){
    var zone = document.getElementById('adminZone'); if (!zone) return;
    var p = usersPanel(zone); if (!p || p.querySelector('.kwUsrBar')) return; var table = p.querySelector('table');
    var inp = el('input', { type:'search', placeholder:'Rechercher (e-mail, fonction)…', 'aria-label':'Rechercher un utilisateur' }); inp.value = STATE.q;
    inp.addEventListener('input', function(){ STATE.q = inp.value; applyFilter(); });
    var bar = el('div', { 'class':'kwUsrBar' }, [inp]);
    [['all', 'Tous'], ['on', 'Actifs'], ['pending', 'Non confirmés'], ['off', 'Désactivés']].forEach(function(c){
      var b = el('button', { type:'button', 'class':'kwChip', 'data-st':c[0], 'aria-pressed':STATE.st === c[0] ? 'true' : 'false', text:c[1] });
      b.addEventListener('click', function(){ STATE.st = c[0]; [].forEach.call(bar.querySelectorAll('.kwChip'), function(x){ x.setAttribute('aria-pressed', x.getAttribute('data-st') === STATE.st ? 'true' : 'false'); }); applyFilter(); });
      bar.appendChild(b);
    });
    bar.appendChild(el('span', { 'class':'kwUsrSum', role:'status' })); p.insertBefore(bar, table); applyFilter();
  }

  /* ---------- accès : colonnes Obeya repliables (v1) ---------- */
  function obeyaShown(){ try { return localStorage.getItem(LS_OB) === '1'; } catch(e){ return false; } }
  function applyObeya(){
    var az = document.getElementById('adminAccessZone'), table = az && az.querySelector('table'); if (!table) return;
    var heads = [].slice.call(table.querySelectorAll('thead th')), idx = [];
    heads.forEach(function(th, i){ if (/^\s*(Carte Obeya|Nom de la carte|Responsable carte)\s*$/i.test(th.textContent)) idx.push(i); });
    if (!idx.length) return;
    var show = obeyaShown();
    [].slice.call(table.querySelectorAll('tr')).forEach(function(tr){ idx.forEach(function(i){ var c = tr.children[i]; if (c) c.style.display = show ? '' : 'none'; }); });
    if (!az.querySelector('.kwObOpt')){
      var id = 'kwObChk', chk = el('input', { type:'checkbox', id:id }); chk.checked = show;
      chk.addEventListener('change', function(){ try { localStorage.setItem(LS_OB, chk.checked ? '1' : '0'); } catch(e){} applyObeya(); });
      var lab = el('label', { 'for':id, text:'Afficher les options Obeya (carte, nom de la carte, responsable)' });
      var box = el('div', { 'class':'kwObOpt' }, [chk, lab]); table.parentNode.insertBefore(box, table);
    } else { var c0 = az.querySelector('.kwObOpt input'); if (c0) c0.checked = show; }
  }

  /* ---------- installation ---------- */
  var obs = null, timer = null, loading = false;
  function refresh(){
    if (!onAdmin()) return;
    try { retag(); applyObeya(); buildUsersBar(); } catch(e){}
    var v = view(); if (!v) return;
    if (STATE.theme === 'home'){ var g = v.querySelector('.kwAdmGrid'); if (g) { var focused = g.contains(document.activeElement) ? document.activeElement.getAttribute('data-theme') : null; renderGrid(); if (focused){ var f = g.querySelector('[data-theme="' + focused + '"]'); if (f) f.focus({ preventScroll:true }); } } }
  }
  function setup(){
    var v = view(), zone = document.getElementById('adminZone'); if (!v || !zone) return;
    try {
      addCss();
      var t = v.querySelector('.sec-title'), n = v.querySelector('.sec-note');
      if (t && /Utilisateurs/.test(t.textContent)) t.textContent = 'Administration';
      if (n && /Réservé/.test(n.textContent)) n.textContent = 'Réservé au SI et à la direction · choisissez une thématique.';
      var e0 = v.querySelector('.sec-eyebrow'); if (e0 && /Administration/.test(e0.textContent)) e0.textContent = 'Cockpit KW';
      go(STATE.theme, false);
      if (obs) obs.disconnect();
      if (window.MutationObserver){
        obs = new MutationObserver(function(muts){
          if (muts.every(function(m){ var t0 = m.target; return t0.closest && (t0.closest('.kwAdmGrid') || t0.closest('.kwAdmShell')); })) return;
          clearTimeout(timer); timer = setTimeout(refresh, 60);
        });
        obs.observe(v, { childList:true, subtree:true });
      }
      loadInfo().then(function(){ if (onAdmin() && STATE.theme === 'home') renderGrid(); });
    } catch(e){
      try { v.removeAttribute('data-kwadm'); [].forEach.call(v.querySelectorAll('[data-kwtab]'), function(x){ x.removeAttribute('data-kwtab'); }); [].forEach.call(v.querySelectorAll('.kwAdmGrid,.kwAdmShell'), function(x){ x.remove(); }); } catch(_){}
      if (window.console) console.error('admin-ux', e);
    }
  }
  /* À l'ouverture d'Admin : pavés tout de suite, utilisateurs chargés sans clic */
  if (typeof renderTab === 'function' && !renderTab.__kwAdmUx){
    var _rt = renderTab;
    renderTab = function(){
      var r = _rt.apply(this, arguments);
      if (onAdmin()){
        setTimeout(function(){
          setup();
          var z = document.getElementById('adminZone');
          if (!loading && z && z.querySelector('button[onclick^="loadAdmin"]') && typeof loadAdmin === 'function'){
            loading = true; Promise.resolve(loadAdmin()).then(function(){ loading = false; }, function(){ loading = false; });
          }
        }, 0);
      } else if (obs){ obs.disconnect(); obs = null; }
      return r;
    };
    renderTab.__kwAdmUx = true;
  }
  if (typeof renderAdmin === 'function' && !renderAdmin.__kwAdmUx){
    var _ra = renderAdmin;
    renderAdmin = function(){ var r = _ra.apply(this, arguments); var after = function(){ try { if (!view().getAttribute('data-kwadm')) setup(); else refresh(); } catch(e){} };
      after(); Promise.resolve(r).then(function(){ setTimeout(after, 0); }, function(){}); return r; };
    renderAdmin.__kwAdmUx = true;
  }
  window.kwAdminUx = { setup:setup, go:go, state:STATE };
})();
