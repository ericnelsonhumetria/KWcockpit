/* COCKPIT KW — Obeya Codir (public/shared/obeya.js)
   Onglet « Obeya Codir » : une carte par fonction (3 sujets + 1 risque et 1 opportunité prioritaires s'il y en a), préparation en DEUX MODES,
   problèmes d'interface entre cartes détectés par l'IA dans le plan d'action, décisions qui créent les actions, « Lancer l'Obeya »
   (horloge d'1 h, rouge à 10 min de la fin, dictée vocale via le compte rendu de Réunions & Rituels), bilan de préparation.
   Additif : enrobe render(), renderTab() et switchTab() sans modifier index.html (une seule ligne <script>).
   L'onglet Humetria est INCHANGÉ : l'Obeya Codir s'ajoute à côté, on masquera Humetria depuis Admin le moment venu.
   Les FONCTIONS et leurs titulaires viennent d'Admin (obeya_admin.sql) : ce module ne définit aucun rôle.
   Les droits sont garantis par la base (RLS + fonctions SQL) ; l'interface ne fait que les refléter.
   SQL : obeya_brique1.sql, obeya_brique2.sql, obeya_brique3.sql. Fonction serveur : obeya-analyse-ia.js. */
(function(){
  var COCKPIT = (typeof renderTab === 'function' && typeof render === 'function');
  if (!COCKPIT) return;

  var O = { sit:null, d:null, c:null, off:0, dismissed:false, drafts:{}, bilan:null, filter:null, showEcartes:false, busy:false,
            pane:'board', fin:null, finState:null, finErr:'', tab:null, open:{}, formOpen:{}, helpOpen:false, confirm:null, confirmT:null, fcard:null, crMounted:false, crId:null, poll:null, clock:null, tr:null, lastTr:null, redSeen:false, c2missing:false, err:'' };
  var URL_IA = '/.netlify/functions/obeya-analyse-ia';
  var SC = { vert:{ l:'Vert', c:'#2e7d46', bg:'#e7f3ea', fg:'#1e5b32' }, orange:{ l:'À surveiller', c:'#e08a00', bg:'#fff1d6', fg:'#7a4a00' }, rouge:{ l:'Action requise', c:'#c0392b', bg:'#fbe6e3', fg:'#8a1f14' } };
  var TYPE_LBL = { blocage:'Blocage', echeances:'Échéances incompatibles', doublon:'Même sujet, deux cartes', zone_grise:'Zone grise', autre:'Autre problème d’interface' };

  /* ---------- utilitaires ---------- */
  function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function db(){ return (typeof SB !== 'undefined' && SB) ? SB : null; }
  function me(){ return String((typeof CURRENT_EMAIL !== 'undefined' && CURRENT_EMAIL) || '').toLowerCase(); }
  function view(){ return document.getElementById('view'); }
  function $(id){ return document.getElementById(id); }
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function hhmm(iso){ if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fdate(d){ if (!d) return ''; var p = String(d).slice(0,10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d; }
  function fts(iso){ if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function later(a, b){ return !!(a && b && new Date(a).getTime() > new Date(b).getTime()); }
  function nomDe(email, c){ var em = String(email || '').toLowerCase(), t = c && (c.titulaires || []).filter(function(x){ return String(x.email).toLowerCase() === em; })[0]; if (t) return t.nom; var l = em.split('@')[0].replace(/[._-]+/g, ' '); return l.replace(/\b\w/g, function(x){ return x.toUpperCase(); }); }
  function longDate(d){ if (!d) return ''; var p = String(d).slice(0,10).split('-'), x = new Date(+p[0], +p[1]-1, +p[2]); var j = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'][x.getDay()]; return j + ' ' + fdate(d); }
  function label(code){ try { return (typeof NAMES === 'object' && NAMES && NAMES[code]) || code; } catch(e){ return code; } }
  function missing(m){ return /function|schema cache|does not exist|could not find/i.test(String(m || '')); }
  async function rpc(name, args){
    var r = await db().rpc(name, args || {});
    if (r && r.error) throw new Error(r.error.message || String(r.error));
    return r ? r.data : null;
  }
  function flash(id, ok, txt){ var el = $(id); if (!el) return; el.style.color = ok ? '#1e7d34' : '#9a3412'; el.textContent = txt || ''; }
  function setOffset(serverIso){ if (serverIso){ var t = new Date(serverIso).getTime(); if (!isNaN(t)) O.off = t - Date.now(); } }
  function nowSrv(){ return Date.now() + O.off; }
  function seance(){ return O.d && O.d.seance || null; }
  function isAnim(){ return !!(O.sit && O.sit.est_animateur); }
  function cartes(){ return (O.d && O.d.cartes) || []; }
  function byRole(){ var m = {}; cartes().forEach(function(c){ m[c.role] = c; }); return m; }
  function names(c){ return (c.titulaires || []).map(function(t){ return t.nom; }).join(', ') || 'aucun titulaire'; }
  function liveSeance(){ var s = seance(); return !!(s && s.statut === 'live'); }
  function inputVal(id){ var el = $(id); return el ? String(el.value || '') : ''; }

  /* ---------- Accès : membre de l'Obeya = titulaire d'une fonction responsable de carte, ou animateur (règle appliquée par la base) ---------- */
  var _accP = null, _accEmail = '';
  function access(){
    var em = me(); if (_accP && _accEmail === em) return _accP;
    _accEmail = em; O.sit = null; O.err = '';
    _accP = (async function(){ try { O.sit = await rpc('obeya_ma_situation'); } catch(e){ O.sit = null; O.err = (e && e.message) || ''; } return !!(O.sit && O.sit.est_membre); })();
    return _accP;
  }

  /* ---------- Onglet (ajouté après render(), sans modifier index.html) ---------- */
  var _renderX = render;
  render = function(role){ _renderX.apply(this, arguments); tabBtn().catch(function(){}); };
  async function tabBtn(){
    var tabs = $('tabs'); if (!tabs || !db()) return;
    var ok = await access(), old = tabs.querySelector('[data-tab="obeya"]'); if (old) old.remove();
    if (!ok) return;
    var b = document.createElement('button');
    b.className = 'tab'; b.dataset.tab = 'obeya'; b.setAttribute('onclick', "switchTab('obeya')"); b.innerHTML = 'Obeya Codir';
    var hum = tabs.querySelector('[data-tab="humetria"]'), adm = tabs.querySelector('[data-tab="admin"]');
    if (hum) tabs.insertBefore(b, hum); else if (adm) tabs.insertBefore(b, adm); else tabs.appendChild(b);
    if (typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB === 'obeya') b.classList.add('active');
  }
  var _rtX = renderTab;
  renderTab = function(){
    _rtX.apply(this, arguments);
    if (typeof CURRENT_TAB === 'undefined') return;
    if (CURRENT_TAB === 'obeya'){ if (O.crMounted && $('obxCR') && $('obxBoard')) refreshOnly(); else main(); } else leave();
  };
  /* Séance en cours : on prévient avant de quitter l'onglet (l'horloge et la dictée s'y affichent). */
  var _swX = switchTab;
  switchTab = function(tab){
    if (typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB === 'obeya' && tab !== 'obeya' && isAnim() && liveSeance() && O.crMounted){
      if (!window.confirm('L’Obeya est en cours. Quitter cet onglet masque l’horloge et la transcription. Le compte-rendu sera enregistré et la dictée arrêtée. Quitter quand même ?')) return;
      saveCR();                                                           /* crBack arrête la dictée et ENREGISTRE le compte-rendu : rien ne s'enregistre tout seul */
    }
    return _swX.apply(this, arguments);
  };
  function saveCR(){ try { if (O.crMounted && typeof window.crBack === 'function') return Promise.resolve(window.crBack()).catch(function(){}); } catch(e){} return Promise.resolve(); }
  function leave(){ if (O.poll) clearInterval(O.poll); if (O.clock) clearInterval(O.clock); if (O.tr) clearInterval(O.tr); O.poll = O.clock = O.tr = null; O.crMounted = false; O.lastTr = null; }

  /* ---------- Chargement ---------- */
  async function load(){
    var d = await rpc('obeya_cartes_lire'); setOffset(d && d.serveur); O.d = d;
    try { O.c = await rpc('obeya_constats_lire'); O.c2missing = false; }
    catch(e){ if (!missing(e && e.message)) throw e; O.c = null; O.c2missing = true; }
  }
  async function main(){
    var v = view(); if (!v) return; leave();
    v.innerHTML = css() + head0() + '<div class="panel" style="padding:16px;">Chargement de l’Obeya Codir…</div>';
    var ok = await access();
    if (!ok){ v.innerHTML = css() + head0() + '<div class="panel" style="padding:16px;">' + (O.err && missing(O.err) ? 'L’Obeya Codir n’est pas encore installé : exécutez obeya_brique1.sql dans Supabase.' : 'Accès réservé aux membres de l’Obeya Codir : titulaires d’une fonction responsable d’une carte, et animateur. Les fonctions se définissent dans Admin.') + '</div>'; return; }
    try { await load(); }
    catch(e){ var m = (e && e.message) || String(e); v.innerHTML = css() + head0() + '<div class="panel" style="padding:16px;color:var(--signal);">Obeya indisponible : ' + esc(m) + (missing(m) ? ' — exécutez obeya_brique1.sql (puis 2 et 3).' : '') + '</div>'; return; }
    paintAll(); startTimers(); focusTop(); loadFin(false);
    if (isAnim() && liveSeance()){ mountCR().then(function(ok){ if (ok){ applyPane(); paintLive(); paintTr(); } }); }
  }
  /* Le bandeau du Cockpit occupe le haut de la page : on amène l'Obeya sous les yeux (toujours sur mobile ; sur ordinateur, en séance). */
  function focusTop(){ var v = view(); if (!v || !v.scrollIntoView) return; if ((window.innerWidth || 1200) <= 700 || liveSeance()) setTimeout(function(){ try { v.scrollIntoView({ block:'start' }); } catch(e){} }, 0); }
  async function refreshOnly(){ try { await load(); repaintLight(); paintTr(); } catch(e){} }
  function head0(){ return '<div class="sec-eyebrow">Codir KW</div><div class="sec-title">Obeya Codir</div>'; }

  /* ---------- Styles ---------- */
  function css(){
    return '<style>'
      + '.obx-root{--b:#560A0F;--g:#c9a000;--gold:#EFB810;--ink:#1a1416;--mut:#7a6a67;--ln:#eadfd8;--ok:#2e7d46;--wa:#e08a00;--ko:#c0392b;width:100%;max-width:none;}'
      + '.obx-root *{box-sizing:border-box;} .obx-root [hidden]{display:none !important;}'
      + '.obx-root button:focus-visible,.obx-root summary:focus-visible,.obx-root textarea:focus-visible,.obx-root input:focus-visible,.obx-root [role=tab]:focus-visible{outline:3px solid #c9a000;outline-offset:2px;}'
      /* boutons */
      + '.obx-btn.add-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:0 18px;border-radius:10px;font-size:14px;font-weight:700;border:1px solid var(--b);cursor:pointer;line-height:1.1;text-align:center;transition:background .12s,transform .12s;}'
      + '.obx-btn.pri{background:var(--b);color:#fff;} .obx-btn.pri:hover{background:#3d070b;}'
      + '.obx-btn.gold{background:var(--gold);border-color:var(--gold);color:#1a1416;} .obx-btn.gold:hover{background:#f3ca4b;}'
      + '.obx-btn.sec{background:#fff;color:var(--b);} .obx-btn.sec:hover{background:#faf3ec;}'
      + '.obx-btn.lnk{background:transparent;border-color:transparent;color:var(--b);text-decoration:underline;min-height:32px;padding:2px 0;font-weight:600;font-size:13px;justify-content:flex-start;text-align:left;line-height:1.35;}'
      + '.obx-btn.sm{min-height:36px;padding:0 12px;font-size:13px;}'
      + '.obx-btn:disabled{opacity:.55;cursor:default;} .obx-btn.is-busy{position:relative;color:transparent !important;} .obx-btn.is-busy:after{content:"";position:absolute;width:16px;height:16px;border:3px solid rgba(0,0,0,.2);border-top-color:#1a1416;border-radius:50%;animation:obxspin .8s linear infinite;}'
      + '@keyframes obxspin{to{transform:rotate(360deg);}} @media (prefers-reduced-motion:reduce){.obx-btn.is-busy:after{animation:none;}}'
      /* bandeau d'en-tête : titre, prochaine étape, indicateurs */
      + '.obx-hero{position:relative;overflow:hidden;border-radius:18px;margin:10px 0 16px;padding:22px 28px 24px;color:#fff;background:radial-gradient(900px 320px at 92% -30%,rgba(239,184,16,.30),transparent 62%),linear-gradient(120deg,#3a070b 0%,#560A0F 55%,#7d1b21 100%);box-shadow:0 10px 28px rgba(86,10,15,.28);}'
      + '.obx-hero:after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:linear-gradient(90deg,#EFB810,#f3ca4b 45%,rgba(239,184,16,0));}'
      + '.obx-hero .sec-eyebrow{color:#EFB810 !important;} .obx-title{display:flex;gap:10px 18px;align-items:flex-end;flex-wrap:wrap;margin:0 0 6px;} .obx-title h2{margin:0;font-size:32px;line-height:1.1;color:#fff;letter-spacing:-.01em;}'
      + '.obx-hero .obx-chip{background:rgba(255,255,255,.14) !important;color:#fff !important;border-color:rgba(255,255,255,.4) !important;} .obx-hero .obx-chip.live{background:#c0392b !important;border-color:#c0392b !important;}'
      + '.obx-sub{color:var(--mut);font-size:13px;} .obx-hero .obx-sub{color:rgba(255,255,255,.78);}'
      + '.obx-guide{background:transparent;border:0;box-shadow:none;padding:16px 0 0;margin:14px 0 0;border-top:1px solid rgba(255,255,255,.16);display:flex;flex-direction:column;gap:12px;} .obx-guide .row{display:flex;gap:14px 28px;align-items:center;flex-wrap:wrap;}'
      + '.obx-gk{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#EFB810;} .obx-gt{font-size:24px;font-weight:800;color:#fff;margin:2px 0 4px;line-height:1.2;} .obx-gd{font-size:14.5px;color:rgba(255,255,255,.88);max-width:78ch;line-height:1.55;}'
      + '.obx-gcta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-left:auto;}'
      + '.obx-hero .obx-btn.pri{background:var(--gold);border-color:var(--gold);color:#1a1416;} .obx-hero .obx-btn.pri:hover{background:#f3ca4b;}'
      + '.obx-hero .obx-btn.sec{background:transparent;color:#fff;border-color:rgba(255,255,255,.7);} .obx-hero .obx-btn.sec:hover{background:rgba(255,255,255,.14);}'
      + '.obx-hero .obx-btn.lnk{color:#f3ca4b;} .obx-hero .obx-btn.is-busy:after{border-color:rgba(0,0,0,.25);border-top-color:#1a1416;}'
      + '.obx-steps{display:flex;gap:6px 22px;list-style:none;margin:0;padding:0;flex-wrap:wrap;} .obx-steps li{display:flex;gap:8px;align-items:center;font-size:13px;color:rgba(255,255,255,.62);font-weight:600;} .obx-steps i{display:inline-flex;width:26px;height:26px;border-radius:50%;align-items:center;justify-content:center;font-style:normal;font-size:12px;font-weight:800;background:rgba(255,255,255,.16);color:#fff;}'
      + '.obx-steps li.cur{color:#fff;} .obx-steps li.cur i{background:var(--gold);color:#1a1416;} .obx-steps li.done{color:#9be0b0;} .obx-steps li.done i{background:#2e7d46;color:#fff;}'
      + '.obx-prog{list-style:none;margin:0;padding:10px 14px;background:#fff;color:var(--ink);border-radius:10px;display:flex;flex-direction:column;gap:6px;font-size:13px;} .obx-prog li{display:flex;gap:8px;align-items:center;color:var(--mut);} .obx-prog li.cur{color:var(--ink);font-weight:700;} .obx-prog li.done{color:var(--ok);}'
      + '.obx-msg{font-size:13px;} .obx-msg:empty{display:none;} .obx-msg:not(:empty){background:#fff;border-radius:10px;padding:8px 12px;display:inline-block;max-width:100%;}'
      + '.obx-help{font-size:13px;color:#4a3d40;} .obx-help summary{cursor:pointer;color:var(--b);font-weight:700;} .obx-help ul{margin:8px 0 0;padding-left:18px;line-height:1.6;} .obx-hero .obx-help,.obx-hero .obx-help summary{color:#f3ca4b;} .obx-hero .obx-help ul{color:rgba(255,255,255,.9);}'
      + '.obx-guide.compact{margin:8px 0 0;padding-top:10px;gap:6px;} .obx-guide.compact .obx-gt{font-size:19px;margin:0;} .obx-hero.compact{padding:14px 24px 16px;}'
      /* indicateurs financiers (en premier) */
      + '.obx-fin{margin:10px 0 0;} .obx-fin-h{display:flex;gap:6px 14px;align-items:center;flex-wrap:wrap;margin-bottom:10px;} .obx-fin-h b{font-size:17px;color:var(--ink);} .obx-fin-act{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}'
      + '.obx-fin-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:16px;}'
      + '.obx-ft{background:#fff;border-radius:16px;box-shadow:0 2px 10px rgba(86,10,15,.10);border-top:5px solid var(--gold);padding:16px 22px 18px;display:flex;flex-direction:column;gap:9px;}'
      + '.obx-ft .l{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--b);} .obx-ft .v{font-size:40px;font-weight:800;line-height:1.05;color:var(--ink);font-variant-numeric:tabular-nums;} .obx-ft .v small{font-size:15px;font-weight:700;color:var(--mut);margin-left:10px;}'
      + '.obx-gauge{display:flex;height:12px;border-radius:6px;background:#efe7de;overflow:hidden;} .obx-gauge i{display:block;height:100%;} .obx-gauge i.f{background:#560A0F;} .obx-gauge i.c{background:#c9a000;} .obx-gauge i.p75{background:#e9c968;} .obx-gauge i.p50{background:#f4e3b0;}'
      + '.obx-legend{display:flex;gap:4px 16px;flex-wrap:wrap;font-size:12px;color:var(--mut);} .obx-legend span:before{content:"";display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;background:var(--c);}'
      + '.obx-fin-err{background:#fff;border-radius:12px;padding:12px 16px;font-size:13px;color:#8a1f14;box-shadow:0 2px 10px rgba(86,10,15,.10);display:flex;gap:10px;align-items:center;flex-wrap:wrap;}'
      /* indicateurs */
      + '.obx-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:20px;}'
      + '.obx-kpi{display:flex;flex-direction:column;gap:5px;text-align:left;padding:14px 16px 13px;border-radius:14px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.09);color:#fff;cursor:pointer;font:inherit;transition:background .12s,transform .12s;} .obx-kpi:hover{background:rgba(255,255,255,.17);transform:translateY(-2px);}'
      + '.obx-kpi .l{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#EFB810;font-weight:800;} .obx-kpi .n{font-size:34px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums;} .obx-kpi .n small{font-size:16px;font-weight:700;opacity:.8;} .obx-kpi .s{font-size:12.5px;color:rgba(255,255,255,.82);line-height:1.35;}'
      + '.obx-kpi .n.ko{color:#ffb0a6;} .obx-kpi .n.ok{color:#9be0b0;} .obx-seg{display:flex;gap:4px;margin:2px 0 1px;} .obx-seg i{flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,.22);} .obx-seg i.on{background:#7be0a0;} .obx-seg i.late{background:#EFB810;}'
      /* onglets */
      + '.obx-sticky{position:sticky;top:0;z-index:40;background:#f3efe9;padding:6px 0 8px;margin:0 0 8px;}'
      + '.obx-tabs{display:flex;gap:4px;overflow-x:auto;background:#eadfd3;padding:5px;border-radius:14px;scrollbar-width:thin;}'
      + '.obx-tab{flex:0 0 auto;display:inline-flex;gap:8px;align-items:center;min-height:44px;padding:0 20px;border:0;border-radius:10px;background:transparent;color:#5a4a46;font-weight:700;font-size:15px;cursor:pointer;white-space:nowrap;font-family:inherit;} .obx-tab:hover{background:rgba(255,255,255,.55);} .obx-tab[aria-selected=true]{background:#fff;color:var(--b);box-shadow:0 2px 6px rgba(86,10,15,.2);}'
      + '.obx-bdg{display:inline-block;min-width:22px;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:800;text-align:center;background:#e3d9cf;color:#5a4a46;} .obx-bdg.ok{background:#dcefe2;color:#1e5b32;} .obx-bdg.warn{background:#ffe6b8;color:#7a4a00;} .obx-bdg.ko{background:var(--ko);color:#fff;}'
      /* sections */
      + '.obx-pane{padding-top:8px;} .obx-sec{margin:6px 0 14px;} .obx-sec h3{margin:0;font-size:20px;color:var(--ink);} .obx-sec p{margin:4px 0 0;color:var(--mut);font-size:13.5px;max-width:90ch;line-height:1.5;}'
      + '.obx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:18px;align-items:stretch;}'
      + '.obx-cols{column-width:480px;column-gap:30px;} .obx-cols>*{break-inside:avoid;}'
      + '.obx-card{background:#fff;border-radius:16px;box-shadow:0 2px 10px rgba(86,10,15,.10);padding:16px 18px;border-top:4px solid #cfc6bd;display:flex;flex-direction:column;gap:12px;} .obx-card.mine{box-shadow:0 0 0 2px var(--b),0 4px 14px rgba(86,10,15,.16);}'
      /* cartes de fonction */
      + '.obx-card.fn{padding:0;gap:0;overflow:hidden;border-top:5px solid #cfc6bd;transition:box-shadow .15s,transform .15s;} .obx-card.fn:hover{box-shadow:0 8px 22px rgba(86,10,15,.18);transform:translateY(-2px);}'
      + '.obx-fh{padding:16px 18px 14px;display:flex;gap:14px;align-items:flex-start;background:linear-gradient(180deg,var(--tint,#f6f1ea) 0%,#fff 100%);border-bottom:1px solid #f0e7df;}'
      + '.obx-ico{flex:none;width:50px;height:50px;border-radius:15px;display:flex;align-items:center;justify-content:center;font-size:26px;background:var(--tint2,#efe7de);}'
      + '.obx-fh .tt{flex:1 1 auto;min-width:0;} .obx-fh .tt b{font-size:20px;line-height:1.2;color:var(--ink);} .obx-trow{display:flex;gap:6px 10px;align-items:center;flex-wrap:wrap;} .obx-fb{padding:14px 18px 18px;display:flex;flex-direction:column;gap:12px;flex:1 1 auto;}'
      + '.obx-who{display:flex;flex-direction:column;align-items:flex-start;gap:5px;margin-top:7px;} .obx-avs{display:inline-flex;} .obx-av{display:inline-flex;width:28px;height:28px;border-radius:50%;background:var(--b);color:#fff;font-size:11px;font-weight:800;align-items:center;justify-content:center;border:2px solid #fff;margin-left:-5px;box-shadow:0 0 0 1px rgba(86,10,15,.15);} .obx-av:first-child{margin-left:0;} .obx-av.more{background:#8a7a76;}'
      + '.obx-chip{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;border:1px solid;white-space:nowrap;} .obx-row{display:flex;gap:8px 14px;align-items:center;flex-wrap:wrap;}'
      + '.obx-ol{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #f0e7df;} .obx-ol:last-child{border-bottom:0;} .obx-ol>b{flex:none;width:24px;height:24px;border-radius:50%;background:#f3eee6;color:#5a4a46;font-size:12px;display:inline-flex;align-items:center;justify-content:center;margin-top:1px;} .obx-ol span{line-height:1.4;font-size:15px;}'
      + '.obx-box{border-radius:12px;padding:10px 13px;font-size:13.5px;line-height:1.45;} .obx-box .t{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:3px;}'
      + '.obx-risk{background:#fbe6e3;color:#4a1a14;} .obx-risk .t{color:#8a1f14;} .obx-opp{background:#e7f3ea;color:#173d27;} .obx-opp .t{color:#1e5b32;}'
      /* formulaires */
      + '.obx-fc{background:#fff;border-radius:16px;box-shadow:0 2px 10px rgba(86,10,15,.10);border-top:5px solid var(--gold);margin:0 0 16px;} .obx-fc>summary{list-style:none;cursor:pointer;padding:15px 20px;display:flex;gap:10px 14px;align-items:center;flex-wrap:wrap;} .obx-fc>summary::-webkit-details-marker{display:none;} .obx-fc>summary:after{content:"▾";margin-left:auto;color:var(--mut);} .obx-fc[open]>summary:after{content:"▴";}'
      + '.obx-fc .in{padding:0 20px 20px;display:flex;flex-direction:column;gap:12px;} .obx-fg{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px;}'
      + '.obx-lb{display:block;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#5a4a46;margin-bottom:4px;} .obx-lb i{color:var(--ko);font-style:normal;}'
      + '.obx-in{width:100%;min-height:42px;padding:8px 12px;border:1px solid #cdbfb6;border-radius:10px;font-size:15px;font-family:inherit;line-height:1.4;background:#fff;} .obx-in:focus{border-color:var(--b);} .obx-in.bad{border-color:var(--ko);background:#fff7f6;}'
      + '.obx-meta{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--mut);min-height:16px;} .obx-err{color:var(--ko);font-weight:700;}'
      /* séance */
      + '.obx-live{background:#fff;border:1px solid var(--ln);border-radius:14px;box-shadow:0 3px 12px rgba(86,10,15,.16);padding:8px 16px;margin:0 0 6px;display:flex;gap:8px 18px;align-items:center;flex-wrap:wrap;}'
      + '.obx-clock{display:inline-flex;align-items:baseline;gap:10px;padding:2px 16px;border-radius:12px;border:2px solid var(--ok);color:#1e5b32;background:#e7f3ea;font-variant-numeric:tabular-nums;} .obx-clock b{font-size:30px;line-height:1.15;letter-spacing:.02em;} .obx-clock span{font-size:12px;font-weight:700;} .obx-clock.red{border-color:var(--ko);background:var(--ko);color:#fff;}'
      + '.obx-dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;background:var(--ko);} .obx-dot.off{background:#9a8f88;}'
      + '.obx-tr{border:1px solid var(--ln);border-radius:14px;background:#fbf8f2;} .obx-tr-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--ln);flex-wrap:wrap;}'
      + '.obx-tr-body{min-height:200px;max-height:52vh;overflow-y:auto;padding:14px 16px;white-space:pre-wrap;font-size:16px;line-height:1.6;} .obx-tr-body.empty:before{content:attr(data-ph);color:#8b8578;font-size:13px;}'
      /* interfaces */
      + '.obx-mx{display:grid;gap:4px;} .obx-mx button{min-height:40px;border-radius:8px;border:1px solid #e0d6cf;background:#fff;font-weight:700;cursor:pointer;} .obx-mx button:disabled{cursor:default;color:#aaa;}'
      + '.obx-flist{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,540px),1fr));gap:14px;align-items:start;margin-bottom:14px;}'
      + '.obx-find{background:#fff;border-radius:16px;box-shadow:0 2px 10px rgba(86,10,15,.10);border-top:5px solid var(--wa);} .obx-find.bl{border-top-color:var(--ko);}'
      + '.obx-find>summary{list-style:none;cursor:pointer;padding:14px 18px;display:flex;gap:6px 12px;align-items:center;flex-wrap:wrap;} .obx-find>summary::-webkit-details-marker{display:none;} .obx-find>summary:after{content:"▾";margin-left:auto;color:var(--mut);} .obx-find[open]>summary:after{content:"▴";}'
      + '.obx-find .ft{font-size:15.5px;font-weight:700;flex:1 1 280px;min-width:0;} .obx-find .in{padding:0 18px 18px;display:flex;flex-direction:column;gap:12px;}'
      + '.obx-opts{display:flex;gap:10px;flex-wrap:wrap;align-items:stretch;} .obx-opt{flex:1 1 240px;text-align:left;border:2px solid #e0d6cf;background:#fff;border-radius:12px;padding:10px 14px;cursor:pointer;font:inherit;display:flex;flex-direction:column;gap:3px;min-height:64px;} .obx-opt:hover{border-color:var(--b);} .obx-opt .e{font-size:12px;color:var(--mut);line-height:1.4;}'
      + '.obx-opt.conf{border-color:var(--b);background:#fdf3e6;box-shadow:0 0 0 2px rgba(201,160,0,.45);} .obx-opt.conf .e{color:#5a2d00;font-weight:600;}'
      + '.obx-chk{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:12px;border:1px solid transparent;} .obx-chk.cur{background:#fdf3e6;border-color:#ecd7a4;} .obx-chk.done{opacity:.55;} .obx-chk.done .tt{text-decoration:line-through;}'
      + '.obx-chk input{width:22px;height:22px;margin-top:2px;flex:none;accent-color:var(--b);cursor:pointer;} .obx-chk .tt{font-size:14px;line-height:1.4;}'
      + '.obx-toasts{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9400;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;} .obx-toast{pointer-events:auto;background:#1a1416;color:#fff;border-radius:12px;padding:10px 16px;font-size:14px;box-shadow:0 6px 20px rgba(0,0,0,.3);display:flex;gap:12px;align-items:center;max-width:min(92vw,560px);} .obx-toast.ko{background:#8a1f14;} .obx-toast button{background:transparent;border:0;color:#fff;font-size:18px;cursor:pointer;line-height:1;}'
      + '.obx-ov{position:fixed;inset:0;background:rgba(20,14,12,.55);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;} .obx-ov>div{background:#fff;border-radius:14px;max-width:760px;width:100%;max-height:88vh;overflow:auto;padding:20px 22px;}'
      + '@media (max-width:640px){.obx-hero{padding:18px 16px 20px;border-radius:14px;} .obx-gcta{margin-left:0;width:100%;} .obx-gcta .obx-btn{flex:1 1 100%;} .obx-title h2{font-size:26px;} .obx-gt{font-size:21px;} .obx-kpi .n{font-size:28px;} .obx-clock b{font-size:26px;} .obx-btn.add-btn{min-height:46px;} .obx-tab{padding:0 14px;}}'
      + '</style>';
  }
  function chip(t, bg, fg, bd){ return '<span class="obx-chip" style="background:' + bg + ';color:' + fg + ';border-color:' + bd + ';">' + esc(t) + '</span>'; }
  function neutral(t){ return chip(t, '#f3eee6', '#5a4a46', '#d9cfc6'); }
  function stChip(k){ var s = SC[k]; return chip(s.l, s.bg, s.fg, s.c); }
  function btn(cls, id, onclick, text, extra){ return '<button type="button" class="add-btn obx-btn ' + cls + '"' + (id ? ' id="' + id + '"' : '') + ' onclick="' + onclick + '"' + (extra || '') + '>' + text + '</button>'; }

  /* ---------- Données dérivées ---------- */
  function constatsAll(){ return (O.c && O.c.constats) || []; }
  function constatsLive(){ return constatsAll().filter(function(x){ return x.etat !== 'ecarte' && x.etat !== 'decide'; }); }
  function owedOf(role){ return constatsLive().filter(function(x){ return x.from_fn === role; }).length; }
  function waitsOf(role){ return constatsLive().filter(function(x){ return x.to_fn === role; }).length; }
  function statutCarte(c){ var o = owedOf(c.role); return o >= 2 ? 'rouge' : (o === 1 ? 'orange' : 'vert'); }
  function prepared(){ var s = seance(); return !!(s && s.prepare_le); }
  function codeLabel(code){ var m = byRole()[code]; return m ? m.carte : (code ? label(code) : ''); }
  function nbPrets(){ return cartes().filter(function(c){ return c.contenu; }).length; }
  function plural(n, a, b){ return n > 1 ? b : a; }

  /* ---------- Indicateurs financiers (EN PREMIER) : CA commandé et CA projeté pondéré 50 % ----------
     Mêmes sources et mêmes règles que « Atterrissage CA » du Tableau de bord : CA facturé HT (Evoliz) + carnet de commandes et opportunités.
       CA commandé            = facturé + carnet ferme (« Commandé »)
       CA projeté pondéré 50 % = commandé + affaires à 75 % + affaires à 50 % (cumulatif, comme dans le Tableau de bord)
     Ces données sont réservées à la direction / finance (fonctions serveur evoliz et finance-projection) : pour les autres membres de
     l'Obeya (réponse 403), le bandeau n'apparaît pas. Rien n'est élargi. */
  function fmtE(n){ return Number(n || 0).toLocaleString('fr-FR', { style:'currency', currency:'EUR', maximumFractionDigits:0 }); }
  function fmtM(n){ n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits:2 }) + ' M€' : fmtE(n); }
  /* Règle IDENTIQUE aux cartes « CA » du Tableau de bord (loadFinanceCards : montantLigneS / dansAnneeS / sommeProbaS) :
     une ligne du carnet compte « à venir » selon window.finAVenir (source unique du Tableau de bord) : mois de facturation STRICTEMENT postérieur
     au mois des données, même année ; non datée = présumée à venir. Les lignes échues sont exclues, et signalées comme dans le Tableau de bord. */
  function montantLigne(r){ if (r.montant != null && r.montant !== '' && !isNaN(Number(r.montant))) return Number(r.montant); return (Number(r.tjm) || 0) * (Number(r.jours) || 0); }
  function aVenir(r){ if (typeof window.finAVenir === 'function') return window.finAVenir(r); if (!r.mois_facturation) return true; return String(r.mois_facturation).slice(0, 4) === String(new Date().getFullYear()); }
  function somme(rows, p){ return rows.filter(function(r){ return r.probabilite === p && aVenir(r); }).reduce(function(a, r){ return a + montantLigne(r); }, 0); }
  /* Horodatage des données et mois de référence : même logique que dataTs() / refMonth() du Tableau de bord */
  function finDataTs(){ if (typeof window.FIN_DATA_TS === 'number') return window.FIN_DATA_TS; try { var sn = localStorage.getItem('kw:finance:snapshot:v1'); if (sn){ var o = JSON.parse(sn); if (o && o.ts) return o.ts; } } catch(e){} return Date.now(); }
  function finRef(){ var d = new Date(finDataTs()); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function enRetard(r){ if (!r || !r.mois_facturation) return false; var ym = String(r.mois_facturation).slice(0, 7), ref = finRef(); return ym.slice(0, 4) === ref.slice(0, 4) && ym <= ref; }
  var MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  async function loadFin(force){
    if (!db() || (!force && (O.finState === 'ok' || O.finState === 'denied' || O.finState === 'loading'))) { paintFin(); return; }
    O.finState = 'loading'; if (O.fin) paintFin();
    try {
      var tok = (typeof kwFreshToken === 'function') ? await kwFreshToken() : ((typeof SB_SESSION !== 'undefined' && SB_SESSION && SB_SESSION.access_token) || ''), h = { Authorization:'Bearer ' + tok }, y = new Date().getFullYear();
      var rs = await Promise.all([ fetch('/api/evoliz?start=' + y + '-01-01', { headers:h }), fetch('/api/finance-projection?annee=' + y, { headers:h }) ]);
      if (rs[0].status === 403 || rs[1].status === 403){ O.finState = 'denied'; O.fin = null; paintFin(); return; }
      if (!rs[0].ok || !rs[1].ok) throw new Error(!rs[0].ok ? 'Evoliz indisponible (' + rs[0].status + ')' : 'Carnet indisponible (' + rs[1].status + ')');
      var ev = await rs[0].json(), cd = await rs[1].json(), rows = Array.isArray(cd.rows) ? cd.rows : [];
      var base = Number(ev.ca_ht) || 0, sg = somme(rows, 'signe'), a = somme(rows, 'p75'), b = somme(rows, 'p50');
      var late = rows.filter(function(r){ return enRetard(r) && (r.probabilite === 'signe' || r.probabilite === 'p75' || r.probabilite === 'p50'); });
      var ref = finRef(), dts = finDataTs();
      O.fin = { base:base, signe:sg, p75:a, p50:b, commande:base + sg, projete:base + sg + a + b, ts:Date.now(), n:rows.length, ref:ref, dts:dts, ageJ:Math.floor((Date.now() - dts) / 86400000), lateN:late.length, lateMt:late.reduce(function(x, r){ return x + montantLigne(r); }, 0),
                 refAncien: ref < (new Date().getFullYear() + '-' + ('0' + (new Date().getMonth() + 1)).slice(-2)) }; O.finState = 'ok'; O.finErr = '';
    } catch(e){ O.finState = 'error'; O.finErr = (e && e.message) || String(e); O.fin = null; }
    paintFin();
  }
  function finTile(lab, val, parts, sub, obj){
    var tot = parts.reduce(function(a, p){ return a + p.v; }, 0), scale = Math.max(obj, tot) || 1, pct = obj > 0 ? Math.round(val / obj * 100) : null;
    return '<div class="obx-ft"><span class="l">' + esc(lab) + '</span><span class="v">' + esc(fmtE(val)) + (pct != null ? '<small>' + pct + ' % de l’objectif</small>' : '') + '</span>'
      + '<div class="obx-gauge" role="img" aria-label="' + esc(lab + ' : ' + parts.map(function(p){ return p.l + ' ' + fmtE(p.v); }).join(', ')) + '">' + parts.filter(function(p){ return p.v > 0; }).map(function(p){ return '<i class="' + p.c + '" style="width:' + (p.v / scale * 100) + '%"></i>'; }).join('') + '</div>'
      + '<div class="obx-legend">' + parts.map(function(p){ var col = { f:'#560A0F', c:'#c9a000', p75:'#e9c968', p50:'#f4e3b0' }[p.c]; return '<span style="--c:' + col + '">' + esc(p.l) + ' ' + esc(fmtE(p.v)) + '</span>'; }).join('') + '</div>'
      + '<div class="obx-sub">' + sub + '</div></div>';
  }
  function paintFin(){
    var el = $('obxFin'); if (!el) return; var st = O.finState;
    if (!st || st === 'denied' || (st === 'loading' && !O.fin)){ el.innerHTML = ''; return; }
    var y = new Date().getFullYear(), obj = Number(window.FINANCE_OBJECTIF) || 0;
    var head = '<div class="obx-fin-h"><b>Indicateurs financiers ' + y + '</b><span class="obx-sub">Evoliz + carnet · réservé à la direction' + (O.fin ? ' · mis à jour à ' + hhmm(new Date(O.fin.ts).toISOString()) : '') + '</span><span class="obx-fin-act">'
      + btn('lnk sm', '', 'obxFinRefresh()', '↻ Actualiser') + btn('sec sm', '', 'obxGoFinance()', '+ Ajouter une opportunité') + '</span></div>';
    if (st === 'error'){ el.innerHTML = head + '<div class="obx-fin-err"><b>Indicateurs financiers indisponibles</b> · ' + esc(O.finErr) + ' ' + btn('sec sm', '', 'obxFinRefresh()', 'Réessayer') + '</div>'; return; }
    var f = O.fin; if (!f) return;
    var refTxt = MOIS_FR[+f.ref.slice(5, 7) - 1] + ' ' + f.ref.slice(0, 4);
    var note = '<div class="obx-sub" style="margin-top:10px;">Mêmes règles que le Tableau de bord : réalisé Evoliz (' + esc(fts(new Date(f.ts).toISOString())) + ') + carnet <b>à venir</b> (mois de facturation postérieur à <b>' + esc(refTxt) + '</b>, mois des données).</div>';
    if (f.lateN > 0) note += '<div class="obx-sub" style="margin-top:4px;color:#8a1f14;font-weight:700;">⚠ ' + f.lateN + ' ligne' + plural(f.lateN, '', 's') + ' de carnet échue' + plural(f.lateN, '', 's') + ' (' + esc(fmtE(f.lateMt)) + ') exclue' + plural(f.lateN, '', 's') + ' : recalez la date, marquez-les facturées ou supprimez-les dans le carnet.</div>';
    if (f.refAncien || f.ageJ > 7) note += '<div class="obx-sub" style="margin-top:4px;color:#8a1f14;font-weight:700;">⚠ Les données financières du Tableau de bord datent du ' + esc(fts(new Date(f.dts).toISOString())) + ' (mois de référence : ' + esc(refTxt) + ') : relancez « Mettre à jour toutes les données financières » pour aligner le carnet sur le mois en cours.</div>';
    el.innerHTML = head + '<div class="obx-fin-g">'
      + finTile('CA commandé', f.commande, [{ l:'Réalisé (Evoliz)', v:f.base, c:'f' }, { l:'Carnet signé à venir', v:f.signe, c:'c' }], 'Réalisé Evoliz + carnet signé à venir. Objectif ' + esc(fmtM(obj)) + '.', obj)
      + finTile('CA projeté pondéré 50 %', f.projete, [{ l:'Réalisé (Evoliz)', v:f.base, c:'f' }, { l:'Carnet signé à venir', v:f.signe, c:'c' }, { l:'Affaires à 75 %', v:f.p75, c:'p75' }, { l:'Affaires à 50 %', v:f.p50, c:'p50' }], 'Commandé + affaires à 75 % et à 50 % (cumulatif : scénario « Pondéré 50 % » du Tableau de bord). ' + f.n + ' ligne' + plural(f.n, '', 's') + ' au carnet.', obj) + '</div>' + note;
  }
  window.obxFinRefresh = function(){ loadFin(true); };
  /* Où s'ajoutent les opportunités : Tableau de bord, « Ajout de commandes et opportunités » (carnet). On y amène l'utilisateur et on déplie la section. */
  window.obxGoFinance = async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    switchTab('dash');
    for (var i = 0; i < 50 && !document.getElementById('finZone'); i++) await sleep(100);
    var zone = function(){ var z = document.getElementById('finCarnetZone'); return z && /Ajout de commandes/.test(z.textContent) ? z : null; };
    for (var k = 0; k < 40 && !document.getElementById('finCarnetZone'); k++) await sleep(100);     /* la zone du carnet est créée un peu après le reste du Tableau de bord */
    try { if (!zone() && typeof window.loadFinanceProjection === 'function') await window.loadFinanceProjection(); } catch(e){}
    for (var j = 0; j < 30 && !zone(); j++) await sleep(100);
    var z = zone(), d = z && z.querySelector('details');
    if (d){ d.open = true; try { d.scrollIntoView({ behavior:'smooth', block:'start' }); } catch(e){} }
    else { var fz = document.getElementById('finZone'); if (fz && fz.scrollIntoView){ try { fz.scrollIntoView({ block:'start' }); } catch(e){} } alert('La saisie des opportunités apparaît après « Mettre à jour toutes les données financières » en haut du Tableau de bord.'); }
  };

  /* ---------- Squelette ---------- */
  function defaultTab(){ if (isAnim()) return liveSeance() ? 'ordre' : 'prep'; return liveSeance() ? 'ordre' : 'cartes'; }
  function tabsList(){
    var anim = isAnim(), live = liveSeance(), c = cartes(), L = constatsLive(), bl = L.filter(function(x){ return x.gravite === 'bloquant'; }).length, dec = (O.c && O.c.decisions || []).length;
    return [ { id:'prep', l:'Préparation', show:anim, b:prepared() ? '✓' : '!', t:prepared() ? 'ok' : 'warn' },
             { id:'cartes', l:'Cartes', show:true, b:nbPrets() + '/' + c.length, t:nbPrets() === c.length ? 'ok' : '' },
             { id:'ordre', l:'Ordre du jour', show:true, b:prepared() ? String(tourItems().T.length) : '', t:'' },
             { id:'iface', l:'Interfaces', show:true, b:(O.c && O.c.analyse) ? String(L.length) : '', t:bl ? 'ko' : (L.length ? 'warn' : 'ok') },
             { id:'journal', l:'Journal', show:true, b:dec ? String(dec) : '', t:'' },
             { id:'tr', l:'Transcription', show:anim && live, b:'●', t:'ko' } ].filter(function(x){ return x.show; });
  }
  function curTab(){ var l = tabsList(); if (O.tab && l.some(function(x){ return x.id === O.tab; })) return O.tab; return defaultTab(); }
  function paintAll(){
    var v = view(); if (!v) return;
    var keep = (O.crMounted && $('obxCR')) ? $('obxCR') : null; if (keep && keep.parentNode) keep.parentNode.removeChild(keep);
    v.innerHTML = css() + '<div class="obx-root"><div id="obxFin" class="obx-fin"></div><div class="obx-hero" id="obxHero"><div id="obxHead"></div><div id="obxGuide"></div><div id="obxKpis" class="obx-kpis"></div></div><div id="obxBilan"></div>'
      + '<div class="obx-sticky" id="obxSticky"><div id="obxLive"></div><div id="obxTabs" class="obx-tabs" role="tablist" aria-label="Sections de l’Obeya"></div></div>'
      + '<div id="obxBoard">'
      + '<section class="obx-pane" id="obxP_prep" role="tabpanel" aria-labelledby="obxT_prep"><div id="obxPrep"></div></section>'
      + '<section class="obx-pane" id="obxP_cartes" role="tabpanel" aria-labelledby="obxT_cartes"><div id="obxForms"></div><div id="obxWall"></div></section>'
      + '<section class="obx-pane" id="obxP_ordre" role="tabpanel" aria-labelledby="obxT_ordre"><div id="obxTour"></div></section>'
      + '<section class="obx-pane" id="obxP_iface" role="tabpanel" aria-labelledby="obxT_iface"><div id="obxIface"></div></section>'
      + '<section class="obx-pane" id="obxP_journal" role="tabpanel" aria-labelledby="obxT_journal"><div id="obxJournal"></div></section>'
      + '<section class="obx-pane" id="obxP_tr" role="tabpanel" aria-labelledby="obxT_tr"><div id="obxTr"></div></section>'
      + '</div><div id="obxCR" style="display:none;"></div><div id="obxToasts" class="obx-toasts" aria-live="polite"></div></div>';
    if (keep){ var ph = $('obxCR'); if (ph && ph.parentNode) ph.parentNode.replaceChild(keep, ph); }
    paintFin(); paintHead(); paintGuide(); paintKpis(); paintLive(); paintBilan(); paintPrep(); paintForms(); paintTour(); paintTr(); paintWall(); paintIface(); paintJournal(); paintTabs(); applyPane();
  }
  function repaintLight(){ paintHead(); paintGuide(); paintKpis(); paintLive(); paintPrep(); paintTour(); paintWall(); paintIface(); paintJournal(); paintTabs(); }

  function paintTabs(){
    var el = $('obxTabs'); if (!el) return; var cur = curTab(), list = tabsList();
    el.innerHTML = list.map(function(t){ var on = t.id === cur;
      return '<button type="button" role="tab" id="obxT_' + t.id + '" aria-selected="' + on + '" aria-controls="obxP_' + t.id + '" tabindex="' + (on ? 0 : -1) + '" class="obx-tab" onclick="obxTab(\'' + t.id + '\')" onkeydown="obxTabKey(event)">' + esc(t.l) + (t.b ? ' <span class="obx-bdg ' + t.t + '">' + esc(t.b) + '</span>' : '') + '</button>'; }).join('');
    ['prep','cartes','ordre','iface','journal','tr'].forEach(function(id){ var p = $('obxP_' + id); if (p) p.hidden = (id !== cur) || !list.some(function(x){ return x.id === id; }); });
  }
  window.obxTab = function(id){ O.tab = id; paintTabs(); var t = $('obxT_' + id); if (t && t.scrollIntoView) { try { t.scrollIntoView({ block:'nearest', inline:'nearest' }); } catch(e){} } };
  window.obxTabKey = function(e){
    var k = e.key; if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return;
    var list = tabsList(), cur = curTab(), i = list.findIndex(function(x){ return x.id === cur; });
    i = k === 'Home' ? 0 : (k === 'End' ? list.length - 1 : (i + (k === 'ArrowRight' ? 1 : -1) + list.length) % list.length);
    e.preventDefault(); obxTab(list[i].id); var t = $('obxT_' + list[i].id); if (t) t.focus();
  };

  function toast(txt, kind){
    var box = $('obxToasts'); if (!box) return; var d = document.createElement('div'); d.className = 'obx-toast' + (kind === 'ko' ? ' ko' : ''); d.setAttribute('role', kind === 'ko' ? 'alert' : 'status');
    d.innerHTML = '<span>' + esc(txt) + '</span><button type="button" aria-label="Fermer" onclick="this.parentNode.remove()">×</button>'; box.appendChild(d);
    setTimeout(function(){ if (d.parentNode) d.parentNode.removeChild(d); }, kind === 'ko' ? 9000 : 5500);
  }

  /* ---------- En-tête et carte « Prochaine étape » ---------- */
  function paintHead(){
    var el = $('obxHead'); if (!el) return; var s = seance(), live = liveSeance();
    el.innerHTML = '<div class="obx-title"><div><div class="sec-eyebrow">Codir KW</div><h2>Obeya Codir</h2></div><div class="obx-row" style="margin-left:auto;"><b style="font-size:15px;">Séance du ' + esc(s ? longDate(s.date_seance) : '') + '</b>'
      + (live ? '<span class="obx-chip live">● En cours</span>' : '<span class="obx-chip">Préparation</span>') + '</div></div>';
  }
  /* Indicateurs du bandeau : l'état de la séance en un coup d'œil, chaque tuile ouvre sa section */
  function paintKpis(){
    var el = $('obxKpis'), hero = $('obxHero'); if (!el) return; var live = liveSeance() && isAnim();
    if (hero) hero.classList.toggle('compact', live);
    if (live){ el.innerHTML = ''; el.hidden = true; return; } el.hidden = false;
    var cs = cartes(), n = cs.length, prets = nbPrets(), L = constatsLive(), bl = L.filter(function(x){ return x.gravite === 'bloquant'; }).length, dec = (O.c && O.c.decisions || []).length, prep = prepared(), has = !!(O.c && O.c.analyse);
    var dur = (O.d && O.d.config && O.d.config.duree_min) || 60, T = prep ? tourItems().T : [], mins = T.reduce(function(a, x){ return a + x.min; }, 0);
    var seg = cs.map(function(c){ return '<i class="' + (c.contenu ? (c.contenu.moment === 'apres' ? 'late' : 'on') : '') + '"></i>'; }).join('');
    var miss = cs.filter(function(c){ return !c.contenu; });
    function tile(tab, l, nHtml, nCls, sub, extra){ return '<button type="button" class="obx-kpi" onclick="obxTab(\'' + tab + '\')" aria-label="' + esc(l) + ' : ouvrir"><span class="l">' + esc(l) + '</span><span class="n ' + (nCls || '') + '">' + nHtml + '</span>' + (extra || '') + '<span class="s">' + sub + '</span></button>'; }
    el.innerHTML = tile('cartes', 'Cartes prêtes', prets + '<small>/' + n + '</small>', prets === n ? 'ok' : '', miss.length ? esc(miss.map(function(c){ return c.carte; }).join(', ')) + ' à obtenir' : 'Toutes les cartes sont prêtes', '<span class="obx-seg" aria-hidden="true">' + seg + '</span>')
      + tile('iface', 'Problèmes d’interface', has ? String(L.length) : '—', has ? (bl ? 'ko' : (L.length ? '' : 'ok')) : '', has ? bl + ' bloquant' + plural(bl, '', 's') + ' · ' + (L.length - bl) + ' à clarifier' : 'Analyse non lancée')
      + tile('ordre', 'Ordre du jour', prep ? T.length + '<small> point' + plural(T.length, '', 's') + '</small>' : '—', '', prep ? '≈ ' + mins + ' min sur ' + dur : 'Généré par « Préparer l’Obeya »')
      + tile('journal', 'Décisions', String(dec), '', dec ? 'inscrites au journal' : 'Aucune pour le moment');
  }
  function guideTexts(){
    var anim = isAnim(), live = liveSeance(), prep = prepared(), cs = cartes(), n = cs.length, prets = nbPrets(), miss = cs.filter(function(c){ return !c.contenu; }), mine = cs.filter(function(c){ return c.mine; });
    var bl = constatsLive().filter(function(x){ return x.gravite === 'bloquant'; }).length, g = { step:0, k:'', t:'', d:'', cta:'' };
    var ownTodo = mine.filter(function(c){ return !c.contenu; })[0];
    if (anim){
      if (live){ g.step = 3; g.k = 'Étape 3 sur 3'; g.t = 'L’Obeya est en cours'; g.d = 'Suivez l’ordre du jour. À la fin, terminez l’Obeya : le bilan de préparation est enregistré.'; g.cta = btn('sec', 'obxBtnEnd', 'obxEnd()', '■ Terminer l’Obeya'); }
      else if (prep){ g.step = 2; g.k = 'Étape 2 sur 3'; g.t = 'Lancez l’Obeya quand le Codir est réuni';
        g.d = (miss.length ? 'Carte' + plural(miss.length, '', 's') + ' à obtenir : ' + miss.map(function(c){ return c.carte + ' (' + names(c) + ')'; }).join(', ') + '. ' : 'Toutes les cartes sont prêtes. ') + (bl ? bl + ' problème' + plural(bl, '', 's') + ' d’interface bloquant' + plural(bl, '', 's') + ' à traiter en séance.' : 'Aucun problème d’interface bloquant.');
        g.cta = btn('sec', 'obxBtnPrep', 'obxPrepare()', '↻ Relancer l’analyse du plan d’action') + btn('gold', 'obxBtnGo', 'obxLaunch()', '▶ Lancer l’Obeya'); }
      else { g.step = 1; g.k = 'Étape 1 sur 3'; g.t = 'Préparez l’Obeya'; g.d = prets + ' carte' + plural(prets, '', 's') + ' sur ' + n + ' déjà prête' + plural(prets, '', 's') + '. L’IA analyse le plan d’action, repère les problèmes d’interface entre fonctions et génère l’ordre du jour.';
        g.cta = btn('lnk', 'obxBtnGo', 'obxLaunch()', 'Lancer sans préparer', ' title="Le bilan signalera que l’animateur n’a pas préparé"') + btn('pri', 'obxBtnPrep', 'obxPrepare()', 'Préparer l’Obeya'); }
    } else if (live){ g.k = 'En séance'; g.t = 'L’Obeya est en cours'; g.d = ownTodo ? 'Votre carte « ' + ownTodo.carte + ' » n’est pas renseignée : renseignez-la maintenant, elle sera notée « après le lancement ».' : 'Suivez l’ordre du jour avec le Codir.'; g.cta = ownTodo ? btn('pri', '', 'obxGoForm(\'' + esc(ownTodo.role) + '\')', 'Renseigner ma carte') : ''; }
    else if (ownTodo){ g.k = 'À faire'; g.t = 'Renseignez votre carte « ' + ownTodo.carte + ' »'; g.d = 'Trois sujets à aborder, et s’il y en a un risque prioritaire et une opportunité prioritaire. À enregistrer avant le lancement : le bilan en tient compte.'; g.cta = btn('pri', '', 'obxGoForm(\'' + esc(ownTodo.role) + '\')', 'Renseigner ma carte'); }
    else if (mine.length){ g.k = 'Prêt'; g.t = 'Votre carte « ' + mine[0].carte + ' » est prête ✓'; g.d = 'Rien d’autre à faire avant la séance. Vous pouvez encore la modifier jusqu’au lancement.'; g.cta = btn('sec', '', 'obxGoForm(\'' + esc(mine[0].role) + '\')', 'Modifier ma carte'); }
    g.ownTodo = ownTodo;
    return g;
  }
  function helpHtml(){
    return isAnim()
      ? '<li><b>Préparer l’Obeya</b> : crée le compte-rendu, fait analyser le plan d’action par l’IA et génère l’ordre du jour.</li><li><b>Lancer l’Obeya</b> : l’horloge d’1 h démarre (rouge à 10 min de la fin) et la dictée vocale du compte-rendu est lancée.</li><li><b>Terminer l’Obeya</b> : le bilan de préparation est enregistré. Chaque décision crée une action dans le plan d’action.</li>'
      : '<li>Chaque fonction du Codir a <b>une carte</b> : trois sujets à aborder, et s’il y en a un risque et une opportunité prioritaires.</li><li>Le <b>responsable de la carte</b> la renseigne avant la séance ; son bilan est enregistré.</li><li>En séance, l’ordre du jour ne reprend que ce qui s’écarte : <b>le reste, au vert, n’est pas abordé</b>.</li>';
  }
  function paintGuide(){
    var el = $('obxGuide'); if (!el) return; var g = guideTexts(), anim = isAnim();
    if (anim && liveSeance()){ el.innerHTML = '<div class="obx-guide compact" role="region" aria-label="Prochaine étape"><div class="row"><div style="flex:1 1 240px;min-width:0;"><div class="obx-gk">' + esc(g.k) + '</div><div class="obx-gt">' + esc(g.t) + '</div></div><div class="obx-gcta">' + g.cta + '</div></div><ol id="obxProg" class="obx-prog" hidden></ol><div id="obxMsg" class="obx-msg" role="status"></div></div>'; return; }
    var steps = anim ? '<ol class="obx-steps" aria-label="Étapes de l’animateur">' + ['Préparer', 'Lancer', 'Terminer'].map(function(t, i){ var st = (i + 1) < g.step ? 'done' : ((i + 1) === g.step ? 'cur' : ''); return '<li class="' + st + '"><i>' + ((i + 1) < g.step ? '✓' : (i + 1)) + '</i>' + t + '</li>'; }).join('') + '</ol>' : '';
    var own = (anim && g.ownTodo) ? '<div class="obx-sub">Votre carte « ' + esc(g.ownTodo.carte) + ' » est aussi à renseigner. ' + btn('lnk sm', '', 'obxGoForm(\'' + esc(g.ownTodo.role) + '\')', 'Renseigner ma carte') + '</div>' : '';
    el.innerHTML = '<div class="obx-guide" role="region" aria-label="Prochaine étape"><div class="row"><div style="flex:1 1 320px;min-width:0;"><div class="obx-gk">' + esc(g.k) + '</div><div class="obx-gt">' + esc(g.t) + '</div><div class="obx-gd">' + esc(g.d) + '</div></div><div class="obx-gcta">' + g.cta + '</div></div>'
      + steps + '<ol id="obxProg" class="obx-prog" hidden></ol><div id="obxMsg" class="obx-msg" role="status"></div>' + own
      + '<details class="obx-help"' + (O.helpOpen ? ' open' : '') + ' ontoggle="O_help(this.open)"><summary>Comment ça marche ?</summary><ul>' + helpHtml() + '</ul></details>'
      + (live_note() ? '<div class="obx-sub">' + live_note() + '</div>' : '') + '</div>';
  }
  window.O_help = function(o){ O.helpOpen = !!o; };
  function live_note(){ return liveSeance() ? 'Cette séance peut être enregistrée et transcrite dans le compte-rendu : l’animateur vous en informe.' : ''; }

  /* Barre de séance : horloge d'1 h (durée et seuil rouge réglés en base), rouge à 10 min de la fin */
  function clockInfo(){
    var s = seance(), cfg = (O.d && O.d.config) || { duree_min:60, rouge_min:10 };
    if (!s || s.statut !== 'live' || !s.lance_le) return null;
    var end = new Date(s.lance_le).getTime() + (s.duree_min || cfg.duree_min) * 60000, rem = end - nowSrv(), over = rem < 0, a = Math.abs(rem);
    var txt = (over ? '+' : '') + pad(Math.floor(a / 60000)) + ':' + pad(Math.floor((a % 60000) / 1000));
    var red = rem <= cfg.rouge_min * 60000;
    return { txt:txt, red:red, over:over, rem:rem, lbl: over ? 'Dépassement' : (red ? 'Dernières minutes' : 'Temps restant'),
             st: over ? 'Le temps prévu est dépassé' : (red ? 'Plus que ' + cfg.rouge_min + ' minutes' : 'Il reste plus de ' + cfg.rouge_min + ' minutes'),
             sub: 'Durée prévue : ' + (s.duree_min || cfg.duree_min) + ' min · fin à ' + hhmm(new Date(end).toISOString()) };
  }
  function paintLive(){
    var el = $('obxLive'); if (!el) return; var ci = clockInfo();
    if (!ci){ el.innerHTML = ''; return; }
    var anim = isAnim();
    el.innerHTML = '<div class="obx-live"><div id="obxClock" class="obx-clock' + (ci.red ? ' red' : '') + '" role="timer" aria-live="off"><b id="obxClockTxt">' + esc(ci.txt) + '</b><span id="obxClockLbl">' + esc(ci.lbl) + '</span></div>'
      + '<div style="flex:1 1 200px;min-width:0;"><div id="obxClockSt" role="status" style="font-weight:700;font-size:13px;">' + esc(ci.st) + '</div><div class="obx-sub" id="obxClockSub">' + esc(ci.sub) + '</div></div>'
      + '<div class="obx-row"><span style="font-size:13px;font-weight:700;"><span id="obxRecDot" class="obx-dot off"></span><span id="obxRecLbl">' + (anim ? 'Dictée arrêtée' : 'Séance en cours') + '</span></span>'
      + (anim && O.crMounted ? btn('sec sm', 'obxPaneBtn', 'obxTogglePane()', O.pane === 'cr' ? '← Tableau Obeya' : 'Compte-rendu') : '') + '</div></div>';
  }
  function tickClock(){
    var ci = clockInfo(); if (!ci){ if ($('obxClock')) { paintLive(); paintGuide(); } return; }
    var c = $('obxClock'); if (!c){ paintLive(); return; }
    var t = $('obxClockTxt'); if (t) t.textContent = ci.txt;
    var l = $('obxClockLbl'); if (l) l.textContent = ci.lbl;
    c.classList.toggle('red', ci.red);
    var st = $('obxClockSt'); if (st && st.textContent !== ci.st) st.textContent = ci.st;
    var tl = $('obxTourLeft'); if (tl){ var h = tourLeftHtml(); if (tl.innerHTML !== h) tl.innerHTML = h; }
  }

  /* ---------- Préparation (animateur) ---------- */
  function paintPrep(){
    var el = $('obxPrep'); if (!el) return; var s = seance();
    if (!isAnim()){ el.innerHTML = ''; return; }
    var prep = prepared(), live = liveSeance(), prets = 0;
    function row(name, sub, chipHtml){ return '<div class="obx-ol"><b>•</b><div style="flex:1 1 240px;"><b style="all:unset;font-weight:700;font-size:14px;">' + esc(name) + '</b> <span class="obx-sub" style="font-size:13px;">' + esc(sub) + '</span></div>' + chipHtml + '</div>'; }
    var rows = row('Animateur de l’Obeya', 'prépare avec le bouton', prep ? chip('Prête à ' + hhmm(s.prepare_le) + (later(s.prepare_le, s.lance_le) ? ' · après le lancement' : ''), SC.vert.bg, SC.vert.fg, SC.vert.c) : chip('À préparer', SC.rouge.bg, SC.rouge.fg, SC.rouge.c));
    cartes().forEach(function(c){ var k = c.contenu; if (k) prets++;
      rows += row(c.carte, names(c) + ' · prépare en renseignant sa carte', k ? chip((k.moment === 'apres' ? 'Tardive' : 'Prête') + ' · ' + hhmm(k.saisi_le), k.moment === 'apres' ? SC.orange.bg : SC.vert.bg, k.moment === 'apres' ? SC.orange.fg : SC.vert.fg, k.moment === 'apres' ? SC.orange.c : SC.vert.c) : chip('À préparer', SC.rouge.bg, SC.rouge.fg, SC.rouge.c)); });
    var dateEd = (s && s.statut === 'prepa') ? '<div class="obx-row"><label for="obxDate" class="obx-lb" style="margin:0;">Date de la séance</label><input id="obxDate" type="date" class="obx-in" style="width:auto;" value="' + esc(String(s.date_seance).slice(0, 10)) + '">' + btn('sec sm', '', 'obxSetDate()', 'Changer la date') + '<span id="obxHdrMsg" class="obx-sub"></span></div>' : '';
    var btns = live ? btn('sec', '', 'obxEnd()', '■ Terminer l’Obeya') : (btn('sec', '', 'obxPrepare()', prep ? '↻ Relancer l’analyse du plan d’action' : 'Préparer l’Obeya') + btn('gold', '', 'obxLaunch()', '▶ Lancer l’Obeya'));
    el.innerHTML = '<div class="obx-sec"><h3>Préparation · mode animateur</h3><p>Vous ne renseignez pas de carte pour l’animation : « Préparer l’Obeya » crée le compte-rendu, fait analyser le plan d’action par l’IA et génère l’ordre du jour. Le bilan vérifie que vous l’avez fait avant le lancement.</p></div>'
      + '<div class="obx-card" style="border-top-color:#c9a000;"><div class="obx-row"><b style="font-size:16px;">' + prets + ' carte' + plural(prets, '', 's') + ' prête' + plural(prets, '', 's') + ' sur ' + cartes().length + '</b><span class="obx-sub">· animateur : ' + (prep ? 'prêt' : 'à faire') + '</span></div>' + '<div class="obx-cols">' + rows + '</div><div class="obx-row">' + btns + '</div>' + dateEd + '</div>';
  }

  /* ---------- Ma carte (responsable de carte) ---------- */
  function readForm(i){ return { s:[inputVal('obx_s1_' + i), inputVal('obx_s2_' + i), inputVal('obx_s3_' + i)], r:inputVal('obx_r_' + i), o:inputVal('obx_o_' + i) }; }
  function paintForms(){
    var el = $('obxForms'); if (!el) return; var mine = cartes().filter(function(c){ return c.mine; });
    if (!mine.length){ el.innerHTML = ''; return; }
    var html = '<div class="obx-sec"><h3>Ma préparation · responsable de carte</h3><p>Préparer l’Obeya, pour un responsable, c’est renseigner la carte : trois sujets à aborder, et s’il y en a un risque prioritaire et une opportunité prioritaire. Votre préparation est complète si elle est enregistrée avant le lancement.</p></div>';
    mine.forEach(function(c, i){
      var k = c.contenu, p = c.precedent, dr = O.drafts[c.role];
      var src = dr || (k ? { s:k.sujets, r:k.risque, o:k.opportunite } : (p ? { s:p.sujets, r:p.risque, o:p.opportunite } : { s:['', '', ''], r:'', o:'' }));
      var from = (!dr && !k && p) ? '<div class="obx-box" style="background:#f8f1e8;">Repris de la séance du ' + esc(fdate(p.date)) + ' : modifiez ou confirmez.</div>' : '';
      var stat = k ? chip((k.moment === 'apres' ? 'Préparée après le lancement' : 'Prête avant le lancement'), k.moment === 'apres' ? SC.orange.bg : SC.vert.bg, k.moment === 'apres' ? SC.orange.fg : SC.vert.fg, k.moment === 'apres' ? SC.orange.c : SC.vert.c) : chip('Non préparée', SC.rouge.bg, SC.rouge.fg, SC.rouge.c);
      var open = O.formOpen[c.role] !== undefined ? O.formOpen[c.role] : !k;
      function f(id, lab, v, req){ var cnt = String(v || '').length; return '<div><label for="obx_' + id + '_' + i + '" class="obx-lb">' + lab + (req ? ' <i title="Obligatoire">*</i>' : '') + '</label><textarea id="obx_' + id + '_' + i + '" class="obx-in" rows="2" maxlength="300" oninput="obxDraft(\'' + esc(c.role) + '\',' + i + ')">' + esc(v || '') + '</textarea><div class="obx-meta"><span class="obx-err" id="obxE_' + id + '_' + i + '"></span><span id="obxC_' + id + '_' + i + '">' + cnt + '/300</span></div></div>'; }
      html += '<details class="obx-fc" id="obxFc_' + i + '"' + (open ? ' open' : '') + ' ontoggle="obxFormToggle(\'' + esc(c.role) + '\',this.open)"><summary><b style="font-size:16px;">Ma carte · ' + esc(c.carte) + '</b>' + stat + '<span class="obx-sub" id="obxFm_' + i + '">' + (k ? 'Enregistrée par ' + esc(nomDe(k.saisi_par, c)) + ' à ' + hhmm(k.saisi_le) : 'Pas encore enregistrée') + '</span></summary><div class="in">' + from
        + '<div class="obx-fg">' + f('s1', 'Sujet 1', src.s[0], true) + f('s2', 'Sujet 2', src.s[1], true) + f('s3', 'Sujet 3', src.s[2], true) + f('r', 'Risque prioritaire (facultatif)', src.r) + f('o', 'Opportunité prioritaire (facultatif)', src.o) + '</div>'
        + '<div class="obx-row">' + btn('pri', '', 'obxSaveCard(\'' + esc(c.role) + '\',' + i + ')', 'Enregistrer ma préparation') + '<span class="obx-sub">Les trois sujets sont obligatoires.</span></div></div></details>';
    });
    el.innerHTML = html;
  }
  window.obxFormToggle = function(role, o){ O.formOpen[role] = !!o; };
  window.obxDraft = function(role, i){ O.drafts[role] = readForm(i); ['s1', 's2', 's3', 'r', 'o'].forEach(function(id){ var t = $('obx_' + id + '_' + i), c = $('obxC_' + id + '_' + i), e = $('obxE_' + id + '_' + i); if (c && t) c.textContent = t.value.length + '/300'; if (t && t.value.trim()){ t.classList.remove('bad'); if (e) e.textContent = ''; } }); };
  window.obxGoForm = function(role){
    O.tab = 'cartes'; var idx = cartes().filter(function(c){ return c.mine; }).findIndex(function(c){ return c.role === role; }); O.formOpen[role] = true; paintTabs(); paintForms();
    var fc = $('obxFc_' + Math.max(0, idx)); if (fc){ try { fc.scrollIntoView({ behavior:'smooth', block:'start' }); } catch(e){} var first = $('obx_s1_' + Math.max(0, idx)); if (first) setTimeout(function(){ try { first.focus(); } catch(e){} }, 250); }
  };
  window.obxSaveCard = async function(role, i){
    var f = readForm(i), mid = 'obxFm_' + i, bad = false;
    [['s1', 0], ['s2', 1], ['s3', 2]].forEach(function(p){ var t = $('obx_' + p[0] + '_' + i), e = $('obxE_' + p[0] + '_' + i), empty = !f.s[p[1]].trim(); if (t) t.classList.toggle('bad', empty); if (e) e.textContent = empty ? 'Obligatoire' : ''; if (empty) bad = true; });
    if (bad){ flash(mid, false, 'Les trois sujets sont obligatoires.'); var firstBad = document.querySelector('#obxForms .obx-in.bad'); if (firstBad) firstBad.focus(); return; }
    flash(mid, true, 'Enregistrement…');
    try { var r = await rpc('obeya_carte_enregistrer', { p_role:role, p_s1:f.s[0], p_s2:f.s[1], p_s3:f.s[2], p_risque:f.r, p_opp:f.o });
      delete O.drafts[role]; O.formOpen[role] = false; await load(); paintForms(); repaintLight();
      flash('obxFm_' + i, true, '✓ Enregistrée à ' + hhmm(r.saisi_le) + (r.moment === 'apres' ? ' · après le lancement' : ' · avant le lancement'));
      toast('Carte enregistrée' + (r.moment === 'apres' ? ' (après le lancement)' : ' : merci, votre préparation est complète') + '.'); }
    catch(e){ flash(mid, false, 'Refusé : ' + ((e && e.message) || e)); toast('Enregistrement refusé : ' + ((e && e.message) || e), 'ko'); }
  };

  /* ---------- Ordre du jour : tour par exception, cochable en séance ---------- */
  function hash(str){ var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h >>> 0); }
  function doneKey(){ var s = seance(); return 'obx_done_' + (s ? s.id : ''); }
  function doneSet(){ try { return JSON.parse(sessionStorage.getItem(doneKey()) || '{}'); } catch(e){ return {}; } }
  function tourItems(){
    var T = [], greens = [];
    cartes().forEach(function(c){
      if (!c.contenu){ T.push({ k:'Préparation', who:c.carte + ' · ' + names(c), why:'Carte non préparée : à obtenir avant ou pendant la séance', min:2, tone:'orange' }); return; }
      var st = statutCarte(c); if (st === 'vert'){ greens.push(c.carte); return; }
      T.push({ k:'Carte', who:c.carte + ' · ' + names(c), why:'3 sujets à aborder' + (c.contenu.risque ? ' · risque prioritaire : ' + c.contenu.risque : ''), min: st === 'rouge' ? 5 : 3, tone:st });
    });
    constatsLive().filter(function(x){ return x.gravite === 'bloquant' || x.etat === 'retenu'; }).forEach(function(x){
      T.push({ k:'Interface', who:codeLabel(x.from_fn) + (x.to_fn ? ' vers ' + codeLabel(x.to_fn) : ''), why:x.titre, min:3, tone: x.gravite === 'bloquant' ? 'rouge' : 'orange' });
    });
    T.forEach(function(x){ x.key = hash(x.k + '|' + x.who + '|' + x.why); });
    return { T:T, greens:greens };
  }
  function tourLeftHtml(){
    var r = tourItems(), dn = doneSet(), left = r.T.filter(function(x){ return !dn[x.key]; }), mins = left.reduce(function(a, x){ return a + x.min; }, 0), ci = clockInfo();
    var base = '<b>' + left.length + ' point' + plural(left.length, '', 's') + ' à voir</b> · environ ' + mins + ' min';
    if (!ci) return base + ' sur ' + ((O.d && O.d.config && O.d.config.duree_min) || 60);
    var remMin = Math.max(0, Math.floor(ci.rem / 60000));
    return base + ' · temps restant ' + remMin + ' min' + (mins > remMin ? ' ' + chip('Plus de points que de temps : écartez ou reportez', SC.rouge.bg, SC.rouge.fg, SC.rouge.c) : (left.length ? ' ' + chip('Dans le temps', SC.vert.bg, SC.vert.fg, SC.vert.c) : ' ' + chip('Tout est vu', SC.vert.bg, SC.vert.fg, SC.vert.c)));
  }
  function paintTour(){
    var el = $('obxTour'); if (!el) return;
    if (!prepared()){ el.innerHTML = '<div class="obx-sec"><h3>Tour par exception</h3><p>L’ordre du jour est généré par « Préparer l’Obeya » : l’IA analyse d’abord le plan d’action.</p></div>'; return; }
    var r = tourItems(), dn = doneSet(), anim = isAnim(), live = liveSeance(), cur = -1;
    r.T.forEach(function(x, i){ if (cur < 0 && !dn[x.key]) cur = i; });
    var rows = r.T.map(function(x, i){ var s = SC[x.tone] || SC.orange, d = !!dn[x.key];
      return '<div class="obx-chk' + (d ? ' done' : (i === cur && anim ? ' cur' : '')) + '">' + (anim ? '<input type="checkbox" id="obxK_' + i + '" aria-label="Point traité : ' + esc(x.why) + '"' + (d ? ' checked' : '') + ' onchange="obxToggleDone(\'' + x.key + '\',this.checked)">' : '<span style="width:12px;height:12px;border-radius:50%;background:' + s.c + ';margin-top:6px;flex:none;"></span>')
        + '<div style="flex:1 1 260px;min-width:0;"><div class="tt"><b>' + esc(x.k) + '</b> · ' + esc(x.who) + '</div><div class="tt" style="color:#4a3d40;">' + esc(x.why) + '</div></div><span class="obx-sub" style="white-space:nowrap;">' + x.min + ' min</span></div>'; }).join('');
    el.innerHTML = '<div class="obx-sec"><h3>Tour par exception</h3><p>On ne passe en revue que ce qui s’écarte : le reste, au vert, n’est pas abordé.' + (anim ? ' Cochez chaque point au fil de la séance.' : '') + '</p></div><div class="obx-card" style="border-top-color:#560A0F;"><div class="obx-row" id="obxTourLeft">' + tourLeftHtml() + '</div>'
      + (r.T.length ? '' : '<div class="obx-sub">Rien à traiter : toutes les cartes sont au vert et préparées.</div>') + '<div class="obx-cols">' + rows + '</div>'
      + '<div class="obx-sub">Non abordées, car vertes (' + r.greens.length + ') : ' + (r.greens.length ? esc(r.greens.join(', ')) : 'aucune') + '.</div></div>';
  }
  window.obxToggleDone = function(key, on){ var d = doneSet(); if (on) d[key] = 1; else delete d[key]; try { sessionStorage.setItem(doneKey(), JSON.stringify(d)); } catch(e){} paintTour(); };

  /* ---------- Cartes du Codir ---------- */
  var ICONS = [[/commerce/i, '🤝'], [/transform/i, '🔄'], [/m[ée]thod/i, '📐'], [/\brh\b|ressources/i, '👥'], [/marketing|communication/i, '📣']];
  function iconOf(name){ for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(name)) return ICONS[i][1]; return '◆'; }
  var TINT = { vert:['#e9f5ed', '#d3ecdb'], orange:['#fff3dc', '#fde3b0'], rouge:['#fdeceb', '#f8cfcb'], none:['#f3eee6', '#e9dfd3'] };
  function initials(nom){ var p = String(nom || '?').trim().split(/\s+/); return ((p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : (p[0] || '').charAt(1))).toUpperCase(); }
  function avatars(c){ var t = c.titulaires || [], h = t.slice(0, 3).map(function(x){ return '<span class="obx-av" aria-hidden="true">' + esc(initials(x.nom)) + '</span>'; }).join(''); if (t.length > 3) h += '<span class="obx-av more" aria-hidden="true">+' + (t.length - 3) + '</span>'; return '<span class="obx-avs">' + h + '</span>'; }
  function paintWall(){
    var el = $('obxWall'); if (!el) return;
    var html = '<div class="obx-sec"><h3>Les cartes du Codir</h3><p>Trois sujets par fonction ; un risque et une opportunité prioritaires s’il y en a. Le statut tient aussi compte des problèmes d’interface détectés par l’IA.</p></div><div class="obx-grid">';
    cartes().forEach(function(c){
      var k = c.contenu, st = k ? statutCarte(c) : null, S = st ? SC[st] : null, ow = owedOf(c.role), wa = waitsOf(c.role), T = TINT[st || 'none'];
      var assoc = (c.associees || []).length ? '<div class="obx-sub">Alimentée aussi par : ' + esc(c.associees.map(label).join(', ')) + '</div>' : '';
      var body;
      if (!k) body = '<div class="obx-box" style="background:#f3eee6;color:var(--mut);">' + esc(names(c)) + ' renseigne la carte de cette fonction avant la séance.</div>' + (c.mine ? '<div>' + btn('pri', '', 'obxGoForm(\'' + esc(c.role) + '\')', 'Renseigner ma carte') + '</div>' : '');
      else body = '<div>' + [0, 1, 2].map(function(i){ return '<div class="obx-ol"><b>' + (i + 1) + '</b><span>' + esc(k.sujets[i]) + '</span></div>'; }).join('') + '</div>'
        + (k.risque ? '<div class="obx-box obx-risk"><div class="t">⚠ Risque prioritaire</div>' + esc(k.risque) + '</div>' : '')
        + (k.opportunite ? '<div class="obx-box obx-opp"><div class="t">✦ Opportunité prioritaire</div>' + esc(k.opportunite) + '</div>' : '');
      var foot = (k && O.c) ? (ow + wa === 0 ? '<div class="obx-sub">Aucun problème d’interface détecté</div>' : '<div>' + btn('lnk sm', '', 'obxGoIface(\'' + esc(c.role) + '\')', ow + ' à résoudre de votre côté · ' + wa + ' vous concernent côté autre carte →') + '</div>') : '';
      html += '<div class="obx-card fn' + (c.mine ? ' mine' : '') + '" style="border-top-color:' + (S ? S.c : '#cfc6bd') + ';--tint:' + T[0] + ';--tint2:' + T[1] + ';"><div class="obx-fh"><div class="obx-ico" aria-hidden="true">' + iconOf(c.carte) + '</div><div class="tt"><div class="obx-trow"><b>' + esc(c.carte) + '</b>' + (S ? stChip(st) : neutral('Non préparée')) + (c.mine ? chip('Votre carte', '#f6e7e8', '#560A0F', '#560A0F') : '') + '</div>'
        + '<div class="obx-who">' + avatars(c) + '<span class="obx-sub">Responsable : ' + esc(names(c)) + '</span></div>'
        + '<div class="obx-sub" style="margin-top:2px;">' + (k ? 'Carte préparée par ' + esc(nomDe(k.saisi_par, c)) + ' à ' + hhmm(k.saisi_le) + (k.moment === 'apres' ? ' (après le lancement)' : '') : 'Carte non préparée') + '</div>' + assoc + '</div>'
        + '</div><div class="obx-fb">' + body + foot + '</div></div>';
    });
    el.innerHTML = html + '</div>';
  }
  window.obxGoIface = function(role){ O.fcard = role; O.filter = null; O.tab = 'iface'; paintTabs(); paintIface(); };

  /* ---------- Problèmes d'interface entre cartes ---------- */
  function effectText(o){
    var m = byRole()[o.fonction], tt = m ? (m.titulaires || []) : [], who = m ? (tt.length > 1 ? tt[0].nom + ' (premier responsable ; réaffectable dans le plan d’action)' : names(m)) : ((O.sit && (O.sit.fonctions || []).indexOf(o.fonction) >= 0) ? 'vous' : 'le titulaire de la fonction « ' + label(o.fonction) + ' »');
    return 'Crée l’action « ' + o.action_libelle + ' » pour ' + who + ', dans ' + (o.delai_jours || 3) + ' jours';
  }
  function findOpen(x){ return O.open[x.id] !== undefined ? O.open[x.id] : (x.gravite === 'bloquant' || x.etat === 'retenu'); }
  function paintIface(){
    var el = $('obxIface'); if (!el) return;
    if (O.c2missing){ el.innerHTML = '<div class="obx-sec"><h3>Problèmes d’interface entre cartes</h3><p>Analyse indisponible : exécutez obeya_brique2.sql dans Supabase.</p></div>'; return; }
    if (!prepared() || !O.c || !O.c.analyse){
      el.innerHTML = '<div class="obx-sec"><h3>Problèmes d’interface entre cartes</h3><p>L’analyse du plan d’action n’est pas encore lancée. L’animateur la déclenche avec « Préparer l’Obeya », avant la séance.</p></div>'; return;
    }
    var a = O.c.analyse, all = constatsAll(), live = constatsLive();
    var ecartes = all.filter(function(x){ return x.etat === 'ecarte'; }), decides = all.filter(function(x){ return x.etat === 'decide'; });
    var shown = live.filter(function(x){ return (!O.filter || (x.from_fn === O.filter.from && x.to_fn === O.filter.to)) && (!O.fcard || x.from_fn === O.fcard || x.to_fn === O.fcard); });
    var bloq = live.filter(function(x){ return x.gravite === 'bloquant'; }).length, anim = isAnim();
    var html = '<div class="obx-sec"><h3>Problèmes d’interface entre cartes</h3><p>Analyse du plan d’action faite avant la séance : blocages, échéances incompatibles, sujets traités par deux cartes, actions sans porteur. Chaque problème cite les actions concernées.</p></div>'
      + '<div class="obx-card" style="border-top-color:#c9a000;margin-bottom:14px;"><div class="obx-row"><b style="font-size:16px;">' + live.length + ' problème' + plural(live.length, '', 's') + ' · ' + bloq + ' bloquant' + plural(bloq, '', 's') + ' · ' + (live.length - bloq) + ' à clarifier</b></div>'
      + '<div class="obx-sub">Analyse du ' + esc(fts(a.genere_le)) + ' à ' + hhmm(a.genere_le) + ' sur ' + a.nb_actions + ' actions ouvertes (hors confidentielles) · ' + (a.ia ? 'IA (' + esc(a.modele || '') + ')' : 'règles simples, sans IA') + '</div>'
      + (a.resume ? '<div style="font-size:14px;">' + esc(a.resume) + '</div>' : '') + (a.ia ? '' : '<div class="obx-sub">Sans IA, seuls les liens écrits « #numéro » dans les actions, les doublons évidents et les actions sans porteur sont détectés.</div>') + '</div>';
    var cs = cartes();
    if (cs.length > 1){
      html += '<details class="obx-help" style="margin-bottom:14px;"' + (O.filter ? ' open' : '') + '><summary>Où ça coince : matrice entre cartes</summary><div class="obx-card" style="margin-top:8px;"><div class="obx-sub">De la carte qui doit agir (ligne) vers celle qui attend (colonne). Cliquez une case pour filtrer.</div><div class="obx-mx" style="grid-template-columns:minmax(80px,1.2fr) repeat(' + cs.length + ',minmax(0,1fr));"><div></div>'
        + cs.map(function(c){ return '<div class="obx-sub" style="text-align:center;align-self:end;font-weight:700;">' + esc(c.carte.replace('Marketing & Communication', 'Mkt & Com')) + '</div>'; }).join('')
        + cs.map(function(r){ return '<div class="obx-sub" style="font-weight:700;display:flex;align-items:center;">' + esc(r.carte.replace('Marketing & Communication', 'Mkt & Com')) + '</div>' + cs.map(function(c){
            var l = live.filter(function(x){ return x.from_fn === r.role && x.to_fn === c.role; }), bl = l.filter(function(x){ return x.gravite === 'bloquant'; }).length, on = O.filter && O.filter.from === r.role && O.filter.to === c.role;
            return '<button type="button" ' + (l.length ? '' : 'disabled ') + 'aria-label="' + esc(r.carte + ' vers ' + c.carte + ' : ' + l.length + ' problème(s)') + '" onclick="obxFilter(\'' + esc(r.role) + '\',\'' + esc(c.role) + '\')" style="background:' + (on ? '#560A0F' : (bl ? SC.rouge.bg : (l.length ? SC.orange.bg : (r.role === c.role ? '#f3eee6' : '#fff')))) + ';color:' + (on ? '#fff' : 'inherit') + ';border-color:' + (bl ? SC.rouge.c : (l.length ? SC.orange.c : '#e0d6cf')) + ';">' + (l.length || (r.role === c.role ? '' : '·')) + '</button>'; }).join(''); }).join('')
        + '</div></div></details>';
    }
    if (O.filter || O.fcard) html += '<div class="obx-row" style="margin-bottom:10px;">' + (O.filter ? btn('sec sm', '', 'obxFilter()', 'Filtre : ' + esc(codeLabel(O.filter.from) + ' vers ' + codeLabel(O.filter.to)) + ' · effacer') : '') + (O.fcard ? btn('sec sm', '', 'obxGoIface()', 'Carte : ' + esc(codeLabel(O.fcard)) + ' · effacer') : '') + '</div>';
    if (!shown.length) html += '<div class="obx-card"><div>' + (live.length ? 'Aucun problème dans ce filtre.' : 'Aucun problème d’interface à traiter. Le Codir peut s’en tenir aux cartes.') + '</div></div>';
    html += '<div class="obx-flist">';
    shown.forEach(function(x){
      var bl = x.gravite === 'bloquant', kept = x.etat === 'retenu' || bl;
      html += '<details class="obx-find' + (bl ? ' bl' : '') + '" id="obxF_' + esc(x.id) + '"' + (findOpen(x) ? ' open' : '') + ' ontoggle="obxFindToggle(\'' + esc(x.id) + '\',this.open)"><summary>' + chip(bl ? 'Bloquant' : 'À clarifier', bl ? SC.rouge.bg : SC.orange.bg, bl ? SC.rouge.fg : SC.orange.fg, bl ? SC.rouge.c : SC.orange.c)
        + '<span class="ft">' + esc(x.titre) + '</span><span class="obx-sub" style="font-weight:600;">' + esc(codeLabel(x.from_fn)) + (x.to_fn ? ' vers ' + esc(codeLabel(x.to_fn)) : '') + '</span></summary><div class="in">'
        + '<div class="obx-row"><b style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#560A0F;">' + esc(TYPE_LBL[x.type] || x.type) + '</b>' + (x.actions || []).map(function(n){ return neutral('#' + n); }).join('') + '<span class="obx-sub">Actions du plan d’action concernées</span></div>'
        + '<div style="font-size:14px;line-height:1.5;">' + esc(x.constat) + '</div>'
        + (x.question ? '<div class="obx-box" style="background:#f8f1e8;"><div class="t" style="color:#560A0F;">Question au Codir</div>' + esc(x.question) + '</div>' : '');
      if (anim){
        html += '<div class="obx-row">' + (bl ? chip('Inscrit d’office à l’ordre du jour', SC.rouge.bg, SC.rouge.fg, SC.rouge.c) : btn((kept ? 'pri' : 'sec') + ' sm', '', 'obxEtat(\'' + esc(x.id) + '\',\'' + (x.etat === 'retenu' ? 'ouvert' : 'retenu') + '\')', x.etat === 'retenu' ? 'Retenu pour la séance' : 'Retenir pour la séance', ' aria-pressed="' + (kept ? 'true' : 'false') + '"'))
          + btn('sec sm', '', 'obxEtat(\'' + esc(x.id) + '\',\'ecarte\')', 'Écarter') + '</div>'
          + '<div><div class="obx-lb">Décider : la décision crée l’action dans le plan d’action</div><div class="obx-opts">' + (x.options || []).map(function(o, i){ var conf = O.confirm === x.id + ':' + i;
              return '<button type="button" class="obx-opt' + (conf ? ' conf' : '') + '" onclick="obxDecide(\'' + esc(x.id) + '\',' + i + ')"><b>' + esc(o.libelle) + '</b><span class="e">' + (conf ? 'Cliquez à nouveau pour confirmer · ' : '') + esc(effectText(o)) + '</span></button>'; }).join('') + '</div></div>';
      } else if (x.etat === 'retenu') html += '<div class="obx-sub">Retenu pour la séance par l’animateur.</div>';
      html += '</div></details>';
    });
    html += '</div>';
    if (decides.length) html += '<div class="obx-card" style="border-top-color:#2e7d46;margin-bottom:14px;"><b>Décidés (' + decides.length + ')</b>' + decides.map(function(x){ var o = (x.options || [])[x.decide_option] || {};
      return '<div class="obx-ol"><b>✓</b><div style="flex:1 1 240px;"><div style="font-size:13px;"><b>' + esc(x.titre) + '</b></div><div class="obx-sub">' + esc(o.libelle || '') + (x.action_numero ? ' · action #' + x.action_numero + ' créée' : '') + '</div></div></div>'; }).join('') + '</div>';
    if (anim && ecartes.length) html += '<div class="obx-card" style="margin-bottom:14px;"><div class="obx-row"><b>Écartés (' + ecartes.length + ')</b>' + btn('sec sm', '', 'obxToggleEcartes()', O.showEcartes ? 'Masquer' : 'Afficher') + '</div>'
      + (O.showEcartes ? ecartes.map(function(x){ return '<div class="obx-ol"><span style="flex:1 1 240px;font-size:13px;">' + esc(x.titre) + '</span>' + btn('sec sm', '', 'obxEtat(\'' + esc(x.id) + '\',\'ouvert\')', 'Rouvrir') + '</div>'; }).join('') : '') + '</div>';
    el.innerHTML = html + '<div id="obxIfMsg" class="obx-msg" role="status"></div>';
  }
  window.obxFindToggle = function(id, o){ O.open[id] = !!o; };
  window.obxFilter = function(from, to){ O.filter = (from && !(O.filter && O.filter.from === from && O.filter.to === to)) ? { from:from, to:to } : null; paintIface(); };
  window.obxToggleEcartes = function(){ O.showEcartes = !O.showEcartes; paintIface(); };
  window.obxEtat = async function(id, etat){
    try { await rpc('obeya_constat_etat', { p_id:id, p_etat:etat }); O.c = await rpc('obeya_constats_lire'); paintTour(); paintWall(); paintIface(); paintTabs(); }
    catch(e){ flash('obxIfMsg', false, 'Refusé : ' + ((e && e.message) || e)); }
  };
  /* Décider crée une action : on demande une confirmation (second clic), puis on avertit par une notification. */
  window.obxDecide = async function(id, i){
    var key = id + ':' + i;
    if (O.confirm !== key){ O.confirm = key; paintIface(); if (O.confirmT) clearTimeout(O.confirmT); O.confirmT = setTimeout(function(){ if (O.confirm === key){ O.confirm = null; paintIface(); } }, 8000); return; }
    O.confirm = null; if (O.confirmT) clearTimeout(O.confirmT);
    try { var r = await rpc('obeya_constat_decider', { p_id:id, p_option:i }); O.c = await rpc('obeya_constats_lire'); paintTour(); paintWall(); paintIface(); paintJournal(); paintTabs();
      var m = r && r.deja ? 'Déjà décidé : action #' + r.action_numero : '✓ Action #' + r.action_numero + ' créée' + (r.pilote_nom ? ' pour ' + r.pilote_nom : '') + (r.sans_pilote ? ' — SANS porteur : à compléter dans le plan d’action' : '') + ' · décision inscrite au journal';
      flash('obxIfMsg', true, m); toast(m, r && r.sans_pilote ? 'ko' : ''); }
    catch(e){ paintIface(); flash('obxIfMsg', false, 'Refusé : ' + ((e && e.message) || e)); toast('Décision refusée : ' + ((e && e.message) || e), 'ko'); }
  };

  function paintJournal(){
    var el = $('obxJournal'); if (!el) return; var j = (O.c && O.c.decisions) || [];
    el.innerHTML = '<div class="obx-sec"><h3>Journal des décisions</h3><p>Chaque décision crée une action dans le plan d’action et reste consultable ici.</p></div><div class="obx-card"><div class="obx-cols">'
      + (j.length ? j.map(function(d){ return '<div class="obx-ol"><b style="width:auto;border-radius:6px;padding:0 6px;">' + esc(fts(d.decide_le)) + '</b><div style="flex:1 1 260px;min-width:0;"><div style="font-size:14px;"><b>' + esc(d.libelle) + '</b></div><div class="obx-sub">' + esc(d.option_libelle) + (d.fonction ? ' · ' + esc(codeLabel(d.fonction)) : '') + (d.pilote_nom ? ' · ' + esc(d.pilote_nom) : '') + '</div></div>' + (d.action_numero ? neutral('Action #' + d.action_numero) : '') + '</div>'; }).join('') : '<div class="obx-sub">Aucune décision pour le moment.</div>') + '</div></div>';
  }

  window.obxSetDate = async function(){
    var v = inputVal('obxDate'); if (!v) return;
    try { await rpc('obeya_seance_date', { p_date: v }); await load(); repaintLight(); flash('obxHdrMsg', true, '✓ Date enregistrée'); }
    catch(e){ flash('obxHdrMsg', false, 'Refusé : ' + ((e && e.message) || e)); }
  };

  /* ---------- Ordre du jour (contexte du compte-rendu) ---------- */
  function buildAgenda(){
    var s = seance(), L = [], dur = (O.d.config && O.d.config.duree_min) || 60;
    L.push('OBEYA CODIR · ' + longDate(s.date_seance), 'Objectif : revoir les cartes de chaque fonction, lever les problèmes d’interface entre fonctions, décider (quoi, qui, quand). Durée prévue : ' + dur + ' min.', '', 'CARTES');
    cartes().forEach(function(c){
      var k = c.contenu; L.push('- ' + c.carte + ' (' + names(c) + ')' + (k ? ' : 1) ' + k.sujets[0] + ' · 2) ' + k.sujets[1] + ' · 3) ' + k.sujets[2] + (k.risque ? ' | Risque : ' + k.risque : '') + (k.opportunite ? ' | Opportunité : ' + k.opportunite : '') : ' : carte non préparée'));
    });
    var cs = (O.c && O.c.constats) || [];
    if (O.c && O.c.analyse){
      L.push('', 'PROBLÈMES D’INTERFACE (analyse du plan d’action du ' + fts(O.c.analyse.genere_le) + ')');
      var live = cs.filter(function(x){ return x.etat !== 'ecarte' && x.etat !== 'decide'; });
      if (!live.length) L.push('- Aucun problème d’interface détecté.');
      live.forEach(function(x){ L.push('- [' + (x.gravite === 'bloquant' ? 'BLOQUANT' : 'À CLARIFIER') + '] ' + codeLabel(x.from_fn) + (x.to_fn ? ' vers ' + codeLabel(x.to_fn) : '') + ' : ' + x.titre + ' — ' + x.constat + ' (actions ' + (x.actions || []).map(function(n){ return '#' + n; }).join(', ') + ')' + (x.question ? ' — Question : ' + x.question : '')); });
    }
    return L.join('\n');
  }

  /* ---------- Préparer l'Obeya (animateur) ---------- */
  async function callIA(){
    var tok = (typeof kwFreshToken === 'function') ? await kwFreshToken() : ((typeof SB_SESSION !== 'undefined' && SB_SESSION && SB_SESSION.access_token) || '');
    var res = await fetch(URL_IA, { method:'POST', headers:{ Authorization:'Bearer ' + tok, 'Content-Type':'application/json' }, body:'{}' });
    var j = null; try { j = await res.json(); } catch(e){}
    if (!res.ok) throw new Error((j && j.error) || ('Erreur ' + res.status));
    return j;
  }
  function setProg(step){
    var ol = $('obxProg'); if (!ol) return;
    if (step < 0){ ol.hidden = true; ol.innerHTML = ''; return; }
    var L = ['Compte-rendu de la séance', 'Analyse du plan d’action par l’IA (jusqu’à 30 secondes)', 'Ordre du jour'];
    ol.hidden = false; ol.innerHTML = L.map(function(t, i){ return '<li class="' + (i < step ? 'done' : (i === step ? 'cur' : '')) + '"><span>' + (i < step ? '✓' : (i === step ? '…' : '○')) + '</span>' + esc(t) + '</li>'; }).join('');
  }
  function busy(on, id){ ['obxBtnPrep', 'obxBtnGo', 'obxBtnEnd'].forEach(function(x){ var b = $(x); if (b){ b.disabled = !!on; if (x === id) b.classList.toggle('is-busy', !!on); } }); }
  window.obxPrepare = async function(){
    if (O.busy) return; O.busy = true; busy(true, 'obxBtnPrep');
    try {
      setProg(0); flash('obxMsg', true, 'Préparation : compte-rendu…');
      var crId = await rpc('obeya_cr_creer', { p_contexte: buildAgenda() }); O.crId = crId;
      await rpc('obeya_seance_prepare');
      setProg(1); flash('obxMsg', true, '🧠 Analyse du plan d’action en cours…');
      var ia = null, iaErr = '';
      try { ia = await callIA(); } catch(e){ iaErr = (e && e.message) || String(e); }
      setProg(2); await load();
      try { await rpc('obeya_cr_contexte', { p_contexte: buildAgenda() }); } catch(e){}
      O.tab = 'ordre'; paintAll();
      var msg = iaErr ? 'Analyse impossible : ' + iaErr + ' — le reste de la préparation est fait.' : '✓ Obeya préparée : ' + (ia ? ia.nb_constats + ' problème(s) d’interface · ' + (ia.ia ? 'analyse IA' : 'règles simples' + (ia.raison ? ' (' + (ia.raison === 'plan_vide' ? 'plan d’action vide' : String(ia.raison).replace(/\s*:?\s*analyse par règles simples/i, '')) + ')' : '')) : '');
      flash('obxMsg', !iaErr, msg); toast(iaErr ? 'Obeya préparée, mais l’analyse a échoué.' : 'Obeya préparée : ordre du jour et problèmes d’interface prêts.', iaErr ? 'ko' : '');
    } catch(e){ var m = (e && e.message) || String(e); setProg(-1); flash('obxMsg', false, 'Refusé : ' + m + (missing(m) ? ' — exécutez obeya_brique3.sql.' : '')); toast('Préparation refusée : ' + m, 'ko'); }
    finally { O.busy = false; busy(false); }
  };

  /* ---------- Compte-rendu de la séance (Réunions & Rituels) : dictée vocale ---------- */
  function crReady(){ return typeof window.renderCRSheet === 'function' && typeof window.crOpen === 'function'; }
  async function mountCR(){
    var s = seance(); if (!s || !s.cr_id) return false;
    if (!crReady()) { flash('obxMsg', false, 'Module Réunions & Rituels indisponible : compte-rendu non ouvert.'); return false; }
    var host = $('obxCR'); if (!host) return false;
    if (!O.crMounted){ try { await window.renderCRSheet('obxCR'); await window.crOpen(s.cr_id); O.crMounted = true; } catch(e){ flash('obxMsg', false, 'Compte-rendu indisponible : ' + ((e && e.message) || e)); return false; } }
    return true;
  }
  function recording(){ var mic = $('crMic'); return !!(mic && /Arrêter/i.test(mic.textContent || '')); }
  window.obxTrMic = function(){ if (typeof window.crDictate === 'function' && $('crTranscript')) window.crDictate(); };
  window.obxTogglePane = function(){ O.pane = O.pane === 'cr' ? 'board' : 'cr'; applyPane(); paintLive(); };
  function applyPane(){ var b = $('obxBoard'), c = $('obxCR'); if (!b || !c) return; var cr = O.pane === 'cr' && O.crMounted; b.style.display = cr ? 'none' : ''; c.style.display = cr ? '' : 'none'; var tb = $('obxTabs'); if (tb) tb.hidden = cr; }

  function paintTr(){
    var el = $('obxTr'); if (!el) return;
    if (!isAnim() || !liveSeance()){ el.innerHTML = ''; return; }
    el.innerHTML = '<div class="obx-sec"><h3>Transcription en direct</h3><p>Miroir de la dictée du compte-rendu (Réunions & Rituels).</p></div><div class="obx-tr"><div class="obx-tr-bar"><span id="obx_tr_state" class="sub-cell" role="status">⏸ Micro arrêté</span><span id="obx_tr_count" class="sub-cell"></span>'
      + '<button type="button" id="obx_tr_btn" class="add-btn sm" style="margin-left:auto;" onclick="obxTrMic()">🎤 Démarrer la transcription</button></div><div id="obx_tr_body" class="obx-tr-body empty" role="log" aria-label="Transcription en direct" tabindex="0" data-ph=""></div></div>';
    O.lastTr = null; trTick();
  }
  function trTick(){
    var body = $('obx_tr_body'); if (!body) return;
    var src = $('crTranscript'), rec = recording(), v = src ? String(src.value || '') : '', words = (v.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    var st = $('obx_tr_state'), btn = $('obx_tr_btn'), cnt = $('obx_tr_count');
    if (st) st.textContent = rec ? '● Transcription en cours' : (src ? '⏸ Micro arrêté' : '⏸ En attente du compte-rendu');
    if (cnt) cnt.textContent = words ? words + ' mot' + (words > 1 ? 's' : '') : '';
    if (btn){ btn.textContent = rec ? '⏹ Arrêter' : '🎤 Démarrer la transcription'; btn.disabled = !(src && typeof window.crDictate === 'function'); }
    var dot = $('obxRecDot'), lbl = $('obxRecLbl'); if (dot) dot.classList.toggle('off', !rec); if (lbl && isAnim()) lbl.textContent = rec ? 'Enregistrement en cours' : 'Dictée arrêtée';
    body.setAttribute('data-ph', !src ? 'Le compte-rendu n’est pas ouvert.' : (rec ? 'Écoute en cours…' : 'Prêt : « Démarrer la transcription », les échanges s’affichent ici en direct.'));
    if (v !== O.lastTr){ var stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 30; O.lastTr = v; body.textContent = v; body.classList.toggle('empty', !v.trim()); if (stick) body.scrollTop = body.scrollHeight; }
  }

  /* ---------- Lancer / terminer (animateur) ---------- */
  window.obxLaunch = async function(){
    if (O.busy) return; O.busy = true; busy(true, 'obxBtnGo');
    try {
      flash('obxMsg', true, 'Lancement de l’Obeya…');
      if (!seance().cr_id){ await rpc('obeya_cr_creer', { p_contexte: buildAgenda() }); }
      var r = await rpc('obeya_seance_lancer'); setOffset(r.serveur);
      O.tab = null; await load(); paintAll(); startTimers(); focusTop();
      var ok = await mountCR(); applyPane(); paintLive(); paintTr();
      if (ok){ setTimeout(function(){ try { if (!recording() && $('crTranscript') && typeof window.crDictate === 'function') window.crDictate(); } catch(e){} trTick(); }, 600); }   /* dictée lancée avec l'Obeya ; sinon, bouton « Démarrer la transcription » */
      flash('obxMsg', true, '✓ Obeya lancé'); toast('Obeya lancé : l’horloge tourne.' + (ok ? '' : ' Compte-rendu non ouvert.'), ok ? '' : 'ko');
    } catch(e){ var m = (e && e.message) || String(e); flash('obxMsg', false, 'Refusé : ' + m + (missing(m) ? ' — exécutez obeya_brique3.sql.' : '')); toast('Lancement refusé : ' + m, 'ko'); }
    finally { O.busy = false; busy(false); }
  };
  window.obxEnd = async function(){
    if (O.busy) return; if (!window.confirm('Terminer l’Obeya ? L’horloge s’arrête et le bilan de préparation est enregistré.')) return; O.busy = true;
    try {
      try { if (recording() && typeof window.crDictate === 'function') window.crDictate(); } catch(e){}
      await saveCR();                                                       /* transcription enregistrée dans le compte-rendu AVANT de le fermer */
      var r = await rpc('obeya_seance_terminer'); setOffset(r.serveur); O.bilan = r.bilan; O.crMounted = false; O.pane = 'board'; O.dismissed = false;
      O.tab = null; await load(); paintAll(); startTimers(); toast('Obeya terminée : bilan de préparation enregistré.');
    } catch(e){ flash('obxMsg', false, 'Refusé : ' + ((e && e.message) || e)); toast('Fin refusée : ' + ((e && e.message) || e), 'ko'); }
    finally { O.busy = false; }
  };
  function paintBilan(){
    var el = $('obxBilan'); if (!el) return; var b = O.bilan;
    if (!b || O.dismissed || !isAnim()){ el.innerHTML = ''; return; }
    var E = { avant:[ 'Prête avant le lancement', SC.vert ], apres:[ 'Préparée après le lancement', SC.orange ], non:[ 'Non préparée', SC.rouge ] };
    el.innerHTML = '<div class="obx-card" style="border-top-color:#2e7d46;margin:12px 0;"><div class="obx-row" style="justify-content:space-between;"><div><div class="sec-eyebrow">Bilan de préparation · deux modes</div><div class="sec-title" style="font-size:20px;margin:0;">' + b.avant + ' rôle' + (b.avant > 1 ? 's' : '') + ' sur ' + b.total + ' ont préparé avant le lancement</div></div><button type="button" class="add-btn sm ghost" onclick="obxBilanClose()">Fermer</button></div>'
      + '<div class="sub-cell">Animateur : « Préparer l’Obeya » cliqué avant le lancement. Responsables de carte : carte enregistrée avant le lancement.</div>'
      + (b.lignes || []).map(function(l){ var e = E[l.etat] || E.non; return '<div class="obx-ol"><div style="flex:1 1 240px;"><b style="font-size:13px;">' + esc(l.libelle) + '</b> <span class="sub-cell">' + esc((l.titulaires || []).join(', ')) + (l.role === 'anim' ? ' · bouton « Préparer l’Obeya »' : ' · carte') + '</span></div><span class="sub-cell">' + (l.le ? hhmm(l.le) : '—') + '</span>' + chip(e[0], e[1].bg, e[1].fg, e[1].c) + '</div>'; }).join('') + '</div>';
  }
  window.obxBilanClose = function(){ O.dismissed = true; paintBilan(); };

  /* ---------- Horloge, rafraîchissement ---------- */
  function startTimers(){
    leaveTimers();
    O.clock = setInterval(function(){ tickClock(); }, 1000);
    O.tr = setInterval(function(){ trTick(); }, 400);
    O.poll = setInterval(async function(){
      if (O.busy || (typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB !== 'obeya')) return;
      try { await load(); repaintLight(); paintTr(); } catch(e){}
    }, 20000);
  }
  function leaveTimers(){ if (O.poll) clearInterval(O.poll); if (O.clock) clearInterval(O.clock); if (O.tr) clearInterval(O.tr); O.poll = O.clock = O.tr = null; }

  /* Pour les tests et la déconnexion : rien ne reste d'un utilisateur à l'autre. */
  window.obeyaReset = function(){ leave(); _accP = null; _accEmail = ''; O.sit = null; O.d = null; O.c = null; O.drafts = {}; O.bilan = null; O.fin = null; O.finState = null; O.filter = null; O.fcard = null; O.tab = null; O.open = {}; O.formOpen = {}; O.confirm = null; O.crMounted = false; O.pane = 'board'; O.dismissed = false; O.busy = false; };
})();
