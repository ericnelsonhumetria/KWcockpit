/* COCKPIT KW — Page Admin plus simple (public/shared/admin-ux.js)
   Additif : une seule ligne <script> dans index.html, APRÈS dialogs.js (et avant session-restore.js). Retour arrière : retirer la ligne.
   RIEN n'est supprimé ni déplacé hors de la page : aucun bouton, champ ni enregistrement ne change de fonctionnement.
   1. QUATRE ONGLETS au lieu d'une page unique de six blocs empilés :
        Utilisateurs (liste + invitation) · Accès par fonction (matrice + profil Membre Codir) · Relances · Finance (objectif de CA).
      L'onglet choisi est mémorisé pour la session. Un bloc inconnu (ajouté plus tard par un autre module) reste visible partout : rien ne se perd.
   2. UTILISATEURS : recherche (e-mail, fonction), filtres Tous / Actifs / Non confirmés / Désactivés, résumé chiffré, lignes plus compactes.
   3. ACCÈS : les trois colonnes propres à l'Obeya (carte, nom, responsable) sont repliées derrière une case « Afficher les options Obeya ».
      Leurs cases restent dans la page : « Enregistrer les accès » les enregistre comme avant.
   Sûreté : si l'installation des onglets échoue, tout reste affiché comme avant. */
(function(){
  'use strict';
  if (window.__kwAdmUx) return; window.__kwAdmUx = true;
  var TABS = [['users', 'Utilisateurs'], ['access', 'Accès par fonction'], ['relances', 'Relances'], ['finance', 'Finance']];
  var STATE = { tab:'users', q:'', st:'all' }, LS_OB = 'kw:adm:obeya';
  try { var t0 = sessionStorage.getItem('kw:adm:tab'); if (t0 && TABS.some(function(x){ return x[0] === t0; })) STATE.tab = t0; } catch(e){}
  function el(tag, props, kids){
    var e = document.createElement(tag); props = props || {};
    Object.keys(props).forEach(function(k){ if (k === 'text') e.textContent = props[k]; else e.setAttribute(k, props[k]); });
    (kids || []).forEach(function(c){ if (c) e.appendChild(c); }); return e;
  }
  var CSS = ''
    + '.kwAdmNav{display:flex;gap:4px;flex-wrap:wrap;margin:14px 0 6px;border-bottom:2px solid rgba(86,10,15,.15);}'
    + '.kwAdmNav button{all:unset;cursor:pointer;padding:10px 16px;font:600 14px system-ui,sans-serif;color:#6b5b58;border-bottom:3px solid transparent;margin-bottom:-2px;}'
    + '.kwAdmNav button:hover{color:#560A0F;}.kwAdmNav button[aria-selected="true"]{color:#560A0F;border-bottom-color:#E8A200;}'
    + '.kwAdmNav .kwN{font-weight:500;font-size:12px;color:#8a7a77;margin-left:5px;}'
    + '#adminZone[data-kwactive="users"] [data-kwtab]:not([data-kwtab="users"]),#adminZone[data-kwactive="access"] [data-kwtab]:not([data-kwtab="access"]),'
    + '#adminZone[data-kwactive="relances"] [data-kwtab]:not([data-kwtab="relances"]),#adminZone[data-kwactive="finance"] [data-kwtab]:not([data-kwtab="finance"]){display:none !important;}'
    + '.kwUsrBar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0 4px;}'
    + '.kwUsrBar input[type=search]{font:inherit;font-size:14px;padding:7px 11px;border:1px solid rgba(86,10,15,.3);border-radius:8px;min-width:240px;}'
    + '.kwChip{all:unset;cursor:pointer;font:600 12.5px system-ui,sans-serif;padding:5px 12px;border-radius:999px;border:1px solid rgba(86,10,15,.3);color:#560A0F;background:#fff;}'
    + '.kwChip[aria-pressed="true"]{background:#560A0F;color:#fff;border-color:#560A0F;}'
    + '.kwUsrSum{font-size:12.5px;color:#6b5b58;margin-left:auto;}'
    + '#adminZone table td{padding-top:7px;padding-bottom:7px;vertical-align:middle;}'
    + '#adminZone table select{padding:5px 8px;font-size:13px;min-height:32px;}'
    + '.kwObOpt{display:flex;align-items:center;gap:8px;margin:6px 0 8px;font-size:13px;color:#4a3a38;}';
  function addCss(){ if (document.getElementById('kwAdmCss')) return; var s = el('style', { id:'kwAdmCss' }); s.textContent = CSS; document.head.appendChild(s); }

  /* ---------- 1. onglets ---------- */
  function retag(zone){
    [].slice.call(zone.children).forEach(function(c){
      var tab = '';
      if (c.id === 'adminPilotesZone'){
        [].slice.call(c.children).forEach(function(p){ var t = p.querySelector('.sec-title'); p.setAttribute('data-kwtab', t && /Relance/i.test(t.textContent) ? 'relances' : 'users'); });
        return;
      }
      if (c.classList && c.classList.contains('panel') && c.querySelector('table')) tab = 'users';
      else if (c.id === 'adminAccessZone' || c.id === 'adminCodirZone') tab = 'access';
      else if (c.id === 'caObjZone') tab = 'finance';
      if (tab) c.setAttribute('data-kwtab', tab);
    });
  }
  function count(zone){
    var rows = zone.querySelectorAll('table tbody tr'); var n = {}; n.users = [].filter.call(rows, function(r){ return r.querySelector('td b'); }).length; return n;
  }
  function select(zone, tab, focus){
    STATE.tab = tab; zone.setAttribute('data-kwactive', tab); try { sessionStorage.setItem('kw:adm:tab', tab); } catch(e){}
    [].forEach.call(zone.querySelectorAll('.kwAdmNav button'), function(b){ var on = b.getAttribute('data-tab') === tab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
  }
  function buildNav(zone){
    var nav = el('div', { 'class':'kwAdmNav', role:'tablist', 'aria-label':'Sections de l\u2019administration' }), nUsers = count(zone).users;
    TABS.forEach(function(t, i){
      var b = el('button', { type:'button', role:'tab', 'data-tab':t[0], text:t[1] });
      if (t[0] === 'users' && nUsers){ var s = el('span', { 'class':'kwN', text:'(' + nUsers + ')' }); b.appendChild(s); }
      b.addEventListener('click', function(){ select(zone, t[0]); });
      b.addEventListener('keydown', function(ev){
        var k = ev.key, j = k === 'ArrowRight' ? i + 1 : k === 'ArrowLeft' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? TABS.length - 1 : -1;
        if (j < 0) return; ev.preventDefault(); select(zone, TABS[(j + TABS.length) % TABS.length][0], true);
      });
      nav.appendChild(b);
    });
    zone.insertBefore(nav, zone.firstChild);
  }

  /* ---------- 2. utilisateurs : recherche, filtres, résumé ---------- */
  function usersPanel(zone){ return [].filter.call(zone.children, function(c){ return c.classList && c.classList.contains('panel') && c.querySelector('table'); })[0]; }
  function rowInfo(tr){
    var b = tr.querySelector('td b'), sel = tr.querySelector('select'), pill = tr.querySelector('.pill');
    return { email:b ? b.textContent : '', role:sel ? sel.value : '', status:pill ? pill.textContent.trim() : '' };
  }
  function stKey(s){ return /désactiv/i.test(s) ? 'off' : /non confirm/i.test(s) ? 'pending' : 'on'; }
  function applyFilter(zone){
    var rows = [].filter.call(zone.querySelectorAll('table tbody tr'), function(r){ return r.querySelector('td b'); }), q = STATE.q.trim().toLowerCase(), shown = 0, c = { on:0, pending:0, off:0 };
    rows.forEach(function(r){
      var i = rowInfo(r), k = stKey(i.status); c[k]++;
      var okQ = !q || (i.email + ' ' + i.role).toLowerCase().indexOf(q) >= 0, okS = STATE.st === 'all' || STATE.st === k, vis = okQ && okS;
      r.style.display = vis ? '' : 'none'; if (vis) shown++;
    });
    var sum = zone.querySelector('.kwUsrSum');
    if (sum) sum.textContent = rows.length + ' utilisateur' + (rows.length > 1 ? 's' : '') + ' · ' + c.on + ' actif' + (c.on > 1 ? 's' : '') + (c.pending ? ' · ' + c.pending + ' non confirmé' + (c.pending > 1 ? 's' : '') : '') + (c.off ? ' · ' + c.off + ' désactivé' + (c.off > 1 ? 's' : '') : '') + (shown !== rows.length ? ' — ' + shown + ' affiché' + (shown > 1 ? 's' : '') : '');
  }
  function buildUsersBar(zone){
    var p = usersPanel(zone); if (!p || p.querySelector('.kwUsrBar')) return; var table = p.querySelector('table');
    var inp = el('input', { type:'search', placeholder:'Rechercher (e-mail, fonction)…', 'aria-label':'Rechercher un utilisateur' }); inp.value = STATE.q;
    inp.addEventListener('input', function(){ STATE.q = inp.value; applyFilter(zone); });
    var bar = el('div', { 'class':'kwUsrBar' }, [inp]);
    [['all', 'Tous'], ['on', 'Actifs'], ['pending', 'Non confirmés'], ['off', 'Désactivés']].forEach(function(c){
      var b = el('button', { type:'button', 'class':'kwChip', 'data-st':c[0], 'aria-pressed':STATE.st === c[0] ? 'true' : 'false', text:c[1] });
      b.addEventListener('click', function(){ STATE.st = c[0]; [].forEach.call(bar.querySelectorAll('.kwChip'), function(x){ x.setAttribute('aria-pressed', x.getAttribute('data-st') === STATE.st ? 'true' : 'false'); }); applyFilter(zone); });
      bar.appendChild(b);
    });
    bar.appendChild(el('span', { 'class':'kwUsrSum', role:'status' })); p.insertBefore(bar, table); applyFilter(zone);
  }

  /* ---------- 3. accès : colonnes Obeya repliables ---------- */
  function obeyaShown(){ try { return localStorage.getItem(LS_OB) === '1'; } catch(e){ return false; } }
  function applyObeya(zone){
    var az = zone.querySelector('#adminAccessZone'), table = az && az.querySelector('table'); if (!table) return;
    var heads = [].slice.call(table.querySelectorAll('thead th')), idx = [];
    heads.forEach(function(th, i){ if (/^\s*(Carte Obeya|Nom de la carte|Responsable carte)\s*$/i.test(th.textContent)) idx.push(i); });
    if (!idx.length) return;
    var show = obeyaShown();
    [].slice.call(table.querySelectorAll('tr')).forEach(function(tr){ idx.forEach(function(i){ var c = tr.children[i]; if (c) c.style.display = show ? '' : 'none'; }); });
    if (!az.querySelector('.kwObOpt')){
      var id = 'kwObChk', chk = el('input', { type:'checkbox', id:id }); chk.checked = show;
      chk.addEventListener('change', function(){ try { localStorage.setItem(LS_OB, chk.checked ? '1' : '0'); } catch(e){} applyObeya(zone); });
      var lab = el('label', { 'for':id, text:'Afficher les options Obeya (carte, nom de la carte, responsable)' });
      var box = el('div', { 'class':'kwObOpt' }, [chk, lab]); table.parentNode.insertBefore(box, table);   /* juste au-dessus du tableau, où qu'il soit imbriqué */
    } else { var c0 = az.querySelector('.kwObOpt input'); if (c0) c0.checked = show; }
  }

  /* ---------- installation ---------- */
  var obs = null, timer = null;
  function refresh(zone){ retag(zone); applyObeya(zone); }
  function setup(){
    var zone = document.getElementById('adminZone'); if (!zone) return;
    if (zone.querySelector('.kwAdmNav')) { refresh(zone); return; }
    try {
      addCss(); retag(zone); buildNav(zone); buildUsersBar(zone); applyObeya(zone); select(zone, STATE.tab);   /* l'attribut qui masque n'est posé qu'à la fin : en cas d'erreur, tout reste affiché */
      var v = document.getElementById('view'), t = v && v.querySelector('.sec-title'), n = v && v.querySelector('.sec-note');
      if (t && /Utilisateurs/.test(t.textContent)) t.textContent = 'Administration'; if (n && /Réservé/.test(n.textContent)) n.textContent = 'Réservé au SI et à la direction.';
      if (obs) obs.disconnect();
      if (window.MutationObserver){ obs = new MutationObserver(function(){ clearTimeout(timer); timer = setTimeout(function(){ try { refresh(zone); } catch(e){} }, 40); }); obs.observe(zone, { childList:true, subtree:true }); }
    } catch(e){ try { zone.removeAttribute('data-kwactive'); [].forEach.call(zone.querySelectorAll('[data-kwtab]'), function(x){ x.removeAttribute('data-kwtab'); }); var nv = zone.querySelector('.kwAdmNav'); if (nv) nv.remove(); } catch(_){} if (window.console) console.error('admin-ux', e); }
  }
  if (typeof renderAdmin === 'function' && !renderAdmin.__kwAdmUx){
    var _ra = renderAdmin;
    renderAdmin = function(){ var r = _ra.apply(this, arguments); try { setup(); } catch(e){} return r; };
    renderAdmin.__kwAdmUx = true;
  }
  window.kwAdminUx = { setup:setup, state:STATE };
})();
