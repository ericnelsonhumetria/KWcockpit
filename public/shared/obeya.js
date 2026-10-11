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
            pane:'board', crMounted:false, crId:null, poll:null, clock:null, tr:null, lastTr:null, redSeen:false, c2missing:false, err:'' };
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
    paintAll(); startTimers();
    if (isAnim() && liveSeance()){ mountCR().then(function(ok){ if (ok){ applyPane(); paintLive(); paintTr(); } }); }
  }
  async function refreshOnly(){ try { await load(); repaintLight(); paintTr(); } catch(e){} }
  function head0(){ return '<div class="sec-eyebrow">Codir KW</div><div class="sec-title">Obeya Codir</div>'; }

  /* ---------- Styles ---------- */
  function css(){
    return '<style>'
      + '.obx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px;align-items:start;}'
      + '.obx-card{background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(86,10,15,.12);padding:16px 18px;border-top:4px solid #cfc6bd;display:flex;flex-direction:column;gap:12px;}'
      + '.obx-sec{margin:22px 0 10px;} .obx-sec h3{margin:0;font-size:17px;color:var(--ink);} .obx-sec p{margin:4px 0 0;color:var(--muted);font-size:13px;max-width:78ch;}'
      + '.obx-chip{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;border:1px solid;white-space:nowrap;}'
      + '.obx-row{display:flex;gap:10px 14px;align-items:center;flex-wrap:wrap;}'
      + '.obx-ol{display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid #eee3dc;} .obx-ol:last-child{border-bottom:0;} .obx-ol b{min-width:20px;color:var(--muted);font-size:12px;}'
      + '.obx-box{border-radius:8px;padding:9px 12px;font-size:13px;} .obx-box .t{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px;}'
      + '.obx-risk{background:#fbe6e3;color:#4a1a14;} .obx-risk .t{color:#8a1f14;} .obx-opp{background:#e7f3ea;color:#173d27;} .obx-opp .t{color:#1e5b32;}'
      + '.obx-in{width:100%;box-sizing:border-box;min-height:38px;padding:6px 10px;border:1px solid rgba(86,10,15,.25);border-radius:6px;font-size:14px;font-family:inherit;}'
      + '.obx-fg{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;}'
      + '.obx-live{position:sticky;top:0;z-index:40;background:#fff;border:1px solid #eadfd8;border-radius:12px;box-shadow:0 3px 10px rgba(86,10,15,.15);padding:8px 14px;margin:10px 0;display:flex;gap:10px 18px;align-items:center;flex-wrap:wrap;}'
      + '.obx-clock{display:inline-flex;align-items:baseline;gap:10px;padding:4px 18px;border-radius:12px;border:2px solid #2e7d46;color:#1e5b32;background:#e7f3ea;font-variant-numeric:tabular-nums;}'
      + '.obx-clock b{font-size:34px;line-height:1.1;letter-spacing:.02em;} .obx-clock span{font-size:12px;font-weight:700;}'
      + '.obx-clock.red{border-color:#c0392b;background:#c0392b;color:#fff;}'
      + '.obx-dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;background:#c0392b;} .obx-dot.off{background:#9a8f88;}'
      + '.obx-tr{border:1px solid #eadfd8;border-radius:10px;background:#fbf8f2;} .obx-tr-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid #eadfd8;flex-wrap:wrap;}'
      + '.obx-tr-body{min-height:150px;max-height:280px;overflow-y:auto;padding:12px 14px;white-space:pre-wrap;font-size:15px;line-height:1.55;} .obx-tr-body.empty:before{content:attr(data-ph);color:#8b8578;font-size:13px;}'
      + '.obx-mx{display:grid;gap:4px;} .obx-mx button{min-height:40px;border-radius:6px;border:1px solid #e0d6cf;background:#fff;font-weight:700;cursor:pointer;} .obx-mx button:disabled{cursor:default;color:#aaa;}'
      + '.obx-opt{flex:1 1 250px;text-align:left;border:2px solid #e0d6cf;background:#fff;border-radius:10px;padding:9px 12px;cursor:pointer;font:inherit;display:flex;flex-direction:column;gap:3px;} .obx-opt:hover{border-color:#560A0F;} .obx-opt .e{font-size:12px;color:var(--muted);}'
      + '.obx-ov{position:fixed;inset:0;background:rgba(20,14,12,.55);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;} .obx-ov>div{background:#fff;border-radius:14px;max-width:760px;width:100%;max-height:88vh;overflow:auto;padding:20px 22px;}'
      + '@media (prefers-reduced-motion:no-preference){.obx-card{transition:box-shadow .12s;}}'
      + '</style>';
  }
  function chip(t, bg, fg, bd){ return '<span class="obx-chip" style="background:' + bg + ';color:' + fg + ';border-color:' + bd + ';">' + esc(t) + '</span>'; }
  function neutral(t){ return chip(t, '#f3eee6', '#5a4a46', '#d9cfc6'); }
  function stChip(k){ var s = SC[k]; return chip(s.l, s.bg, s.fg, s.c); }

  /* ---------- Données dérivées ---------- */
  function constatsLive(){ return ((O.c && O.c.constats) || []).filter(function(x){ return x.etat !== 'ecarte' && x.etat !== 'decide'; }); }
  function owedOf(role){ return constatsLive().filter(function(x){ return x.from_fn === role; }).length; }
  function waitsOf(role){ return constatsLive().filter(function(x){ return x.to_fn === role; }).length; }
  function statutCarte(c){ var o = owedOf(c.role); return o >= 2 ? 'rouge' : (o === 1 ? 'orange' : 'vert'); }
  function prepared(){ var s = seance(); return !!(s && s.prepare_le); }
  function codeLabel(code){ var m = byRole()[code]; return m ? m.carte : (code ? label(code) : ''); }

  /* ---------- Rendu ---------- */
  function paintAll(){
    var v = view(); if (!v) return;
    var keep = (O.crMounted && $('obxCR')) ? $('obxCR') : null; if (keep && keep.parentNode) keep.parentNode.removeChild(keep);
    v.innerHTML = css() + '<div id="obxHead"></div><div id="obxLive"></div><div id="obxBilan"></div>'
      + '<div id="obxBoard"><div id="obxPrep"></div><div id="obxForms"></div><div id="obxTour"></div><div id="obxTr"></div><div id="obxWall"></div><div id="obxIface"></div><div id="obxJournal"></div></div>'
      + '<div id="obxCR" style="display:none;"></div>';
    if (keep){ var ph = $('obxCR'); if (ph && ph.parentNode) ph.parentNode.replaceChild(keep, ph); }
    paintHead(); paintLive(); paintBilan(); paintPrep(); paintForms(); paintTour(); paintTr(); paintWall(); paintIface(); paintJournal(); applyPane();
  }
  function repaintLight(){ paintHead(); paintLive(); paintPrep(); paintTour(); paintWall(); paintIface(); paintJournal(); }

  function paintHead(){
    var el = $('obxHead'); if (!el) return; var s = seance(), live = liveSeance();
    var st = live ? chip('● En cours', '#fbe6e3', '#8a1f14', '#c0392b') : neutral('Préparation');
    var dateEd = (isAnim() && s && s.statut === 'prepa')
      ? '<span class="obx-row" style="gap:6px;"><label for="obxDate" class="sub-cell">Date</label><input id="obxDate" type="date" class="obx-in" style="width:auto;" value="' + esc(String(s.date_seance).slice(0,10)) + '"><button type="button" class="add-btn sm ghost" onclick="obxSetDate()">Changer</button></span>' : '';
    el.innerHTML = head0() + '<div class="sec-note">Une carte par fonction : trois sujets à aborder, et s’il y en a un risque et une opportunité prioritaires. Les fonctions et leurs titulaires sont définis dans Admin. Chacun prépare sa carte ; l’animateur prépare avec « Préparer l’Obeya ».</div>'
      + '<div class="obx-row" style="margin:8px 0;"><b style="font-size:16px;">Séance du ' + esc(s ? longDate(s.date_seance) : '') + '</b>' + st + dateEd + '<span id="obxHdrMsg" class="sub-cell"></span></div>';
  }
  window.obxSetDate = async function(){
    var v = inputVal('obxDate'); if (!v) return;
    try { await rpc('obeya_seance_date', { p_date: v }); await load(); repaintLight(); flash('obxHdrMsg', true, '✓ Date enregistrée'); }
    catch(e){ flash('obxHdrMsg', false, 'Refusé : ' + ((e && e.message) || e)); }
  };

  /* Barre de séance : horloge d'1 h (durée et seuil rouge réglés en base), rouge à 10 min de la fin */
  function clockInfo(){
    var s = seance(), cfg = (O.d && O.d.config) || { duree_min:60, rouge_min:10 };
    if (!s || s.statut !== 'live' || !s.lance_le) return null;
    var end = new Date(s.lance_le).getTime() + (s.duree_min || cfg.duree_min) * 60000, rem = end - nowSrv(), over = rem < 0, a = Math.abs(rem);
    var txt = (over ? '+' : '') + pad(Math.floor(a / 60000)) + ':' + pad(Math.floor((a % 60000) / 1000));
    var red = rem <= cfg.rouge_min * 60000;
    return { txt:txt, red:red, over:over, lbl: over ? 'Dépassement' : (red ? 'Dernières minutes' : 'Temps restant'),
             st: over ? 'Le temps prévu est dépassé' : (red ? 'Plus que ' + cfg.rouge_min + ' minutes' : 'Il reste plus de ' + cfg.rouge_min + ' minutes'),
             sub: 'Durée prévue : ' + (s.duree_min || cfg.duree_min) + ' min · fin à ' + hhmm(new Date(end).toISOString()) };
  }
  function paintLive(){
    var el = $('obxLive'); if (!el) return; var ci = clockInfo();
    if (!ci){ el.innerHTML = ''; return; }
    var anim = isAnim();
    el.innerHTML = '<div class="obx-live"><div id="obxClock" class="obx-clock' + (ci.red ? ' red' : '') + '" role="timer" aria-live="off"><b id="obxClockTxt">' + esc(ci.txt) + '</b><span id="obxClockLbl">' + esc(ci.lbl) + '</span></div>'
      + '<div style="flex:1 1 220px;min-width:0;"><div id="obxClockSt" role="status" style="font-weight:700;font-size:13px;">' + esc(ci.st) + '</div><div class="sub-cell" id="obxClockSub">' + esc(ci.sub) + '</div></div>'
      + '<div class="obx-row"><span style="font-size:13px;font-weight:700;"><span id="obxRecDot" class="obx-dot off"></span><span id="obxRecLbl">' + (anim ? 'Dictée arrêtée' : 'Séance en cours') + '</span></span>'
      + (anim && O.crMounted ? '<button type="button" class="add-btn sm ghost" id="obxPaneBtn" onclick="obxTogglePane()">' + (O.pane === 'cr' ? 'Tableau Obeya' : 'Compte-rendu') + '</button>' : '') + '</div>'
      + '<div class="sub-cell" style="flex:1 1 100%;">Cette séance peut être enregistrée et transcrite dans le compte-rendu : l’animateur vous en informe.</div></div>';
  }
  function tickClock(){
    var ci = clockInfo(); if (!ci){ if ($('obxClock')) paintLive(); return; }
    var c = $('obxClock'); if (!c){ paintLive(); return; }
    var t = $('obxClockTxt'); if (t) t.textContent = ci.txt;
    var l = $('obxClockLbl'); if (l) l.textContent = ci.lbl;
    c.classList.toggle('red', ci.red);
    var st = $('obxClockSt'); if (st && st.textContent !== ci.st) st.textContent = ci.st;
  }

  /* Panneau de préparation (mode ANIMATEUR) */
  function paintPrep(){
    var el = $('obxPrep'); if (!el) return; var s = seance();
    if (!isAnim()){ el.innerHTML = ''; return; }
    var prep = prepared(), live = liveSeance();
    var rows = '<div class="obx-ol"><b>•</b><div style="flex:1 1 240px;"><b style="color:var(--ink);font-size:13px;">Animateur de l’Obeya</b> <span class="sub-cell">prépare avec le bouton</span></div>'
      + (prep ? chip('Prête à ' + hhmm(s.prepare_le) + (later(s.prepare_le, s.lance_le) ? ' · après le lancement' : ''), SC.vert.bg, SC.vert.fg, SC.vert.c) : chip('À préparer', SC.rouge.bg, SC.rouge.fg, SC.rouge.c)) + '</div>';
    var prets = 0;
    cartes().forEach(function(c){
      var k = c.contenu; if (k) prets++;
      rows += '<div class="obx-ol"><b>•</b><div style="flex:1 1 240px;"><b style="color:var(--ink);font-size:13px;">' + esc(c.carte) + '</b> <span class="sub-cell">' + esc(names(c)) + ' · prépare en renseignant sa carte</span></div>'
        + (k ? chip((k.moment === 'apres' ? 'Tardive' : 'Prête') + ' · ' + hhmm(k.saisi_le), k.moment === 'apres' ? SC.orange.bg : SC.vert.bg, k.moment === 'apres' ? SC.orange.fg : SC.vert.fg, k.moment === 'apres' ? SC.orange.c : SC.vert.c) : chip('À préparer', SC.rouge.bg, SC.rouge.fg, SC.rouge.c)) + '</div>';
    });
    var btns = '';
    if (!live) btns += '<button type="button" class="add-btn" id="obxBtnPrep" onclick="obxPrepare()">' + (prep ? '↻ Relancer l’analyse du plan d’action' : 'Préparer l’Obeya') + '</button>'
                     + '<button type="button" class="add-btn" id="obxBtnGo" style="background:#c9a000;border-color:#c9a000;color:#1a1416;" onclick="obxLaunch()">▶ Lancer l’Obeya</button>';
    else btns += '<button type="button" class="add-btn" onclick="obxEnd()">■ Terminer l’Obeya</button>';
    el.innerHTML = '<div class="obx-sec"><h3>Préparation · mode animateur</h3><p>Vous ne renseignez pas de carte pour l’animation : « Préparer l’Obeya » crée le compte-rendu, fait analyser le plan d’action par l’IA (problèmes d’interface entre cartes) et génère l’ordre du jour. Le bilan vérifie que vous l’avez fait avant le lancement.</p></div>'
      + '<div class="obx-card" style="border-top-color:#c9a000;"><div class="obx-row"><b>' + prets + ' carte' + (prets > 1 ? 's' : '') + ' prête' + (prets > 1 ? 's' : '') + ' sur ' + cartes().length + '</b><span class="sub-cell">· animateur : ' + (prep ? 'prêt' : 'à faire') + '</span></div>' + rows
      + '<div class="obx-row">' + btns + '<span id="obxMsg" style="font-size:13px;"></span></div></div>';
  }

  /* Formulaires (mode RESPONSABLE DE CARTE) : un par carte dont on est responsable */
  function paintForms(){
    var el = $('obxForms'); if (!el) return; var mine = cartes().filter(function(c){ return c.mine; });
    if (!mine.length){ el.innerHTML = ''; return; }
    var html = '<div class="obx-sec"><h3>Ma préparation · responsable de carte</h3><p>Préparer l’Obeya, pour un responsable, c’est renseigner la carte : trois sujets à aborder, et s’il y en a un risque prioritaire et une opportunité prioritaire. Votre préparation est complète si elle est enregistrée avant le lancement.</p></div>';
    mine.forEach(function(c, i){
      var k = c.contenu, p = c.precedent, dr = O.drafts[c.role];
      var src = dr || (k ? { s:k.sujets, r:k.risque, o:k.opportunite } : (p ? { s:p.sujets, r:p.risque, o:p.opportunite } : { s:['','',''], r:'', o:'' }));
      var from = (!dr && !k && p) ? '<div class="sub-cell">Repris de la séance du ' + esc(fdate(p.date)) + ' : modifiez ou confirmez.</div>' : '';
      var stat = k ? chip((k.moment === 'apres' ? 'Préparée après le lancement' : 'Prête avant le lancement'), k.moment === 'apres' ? SC.orange.bg : SC.vert.bg, k.moment === 'apres' ? SC.orange.fg : SC.vert.fg, k.moment === 'apres' ? SC.orange.c : SC.vert.c) : chip('Non préparée', SC.rouge.bg, SC.rouge.fg, SC.rouge.c);
      function f(id, lab, v){ return '<div><label for="obx_' + id + '_' + i + '" class="field-label">' + lab + '</label><textarea id="obx_' + id + '_' + i + '" class="obx-in" rows="2" maxlength="300" style="resize:vertical;" oninput="obxDraft(\'' + esc(c.role) + '\',' + i + ')">' + esc(v || '') + '</textarea></div>'; }
      html += '<div class="obx-card" style="border-top-color:#c9a000;margin-bottom:12px;"><div class="obx-row"><b style="font-size:16px;">' + esc(c.carte) + '</b>' + stat + '<span class="sub-cell" id="obxFm_' + i + '">' + (k ? 'Enregistrée par ' + esc(nomDe(k.saisi_par, c)) + ' à ' + hhmm(k.saisi_le) : 'Pas encore enregistrée') + '</span></div>' + from
        + '<div class="obx-fg">' + f('s1', 'Sujet 1', src.s[0]) + f('s2', 'Sujet 2', src.s[1]) + f('s3', 'Sujet 3', src.s[2]) + f('r', 'Risque prioritaire (facultatif)', src.r) + f('o', 'Opportunité prioritaire (facultatif)', src.o) + '</div>'
        + '<div class="obx-row"><button type="button" class="add-btn" onclick="obxSaveCard(\'' + esc(c.role) + '\',' + i + ')">Enregistrer ma préparation</button><span class="sub-cell">Les trois sujets sont obligatoires.</span></div></div>';
    });
    el.innerHTML = html;
  }
  function readForm(i){ return { s:[inputVal('obx_s1_' + i), inputVal('obx_s2_' + i), inputVal('obx_s3_' + i)], r:inputVal('obx_r_' + i), o:inputVal('obx_o_' + i) }; }
  window.obxDraft = function(role, i){ O.drafts[role] = readForm(i); };
  window.obxSaveCard = async function(role, i){
    var f = readForm(i), mid = 'obxFm_' + i;
    if (!f.s[0].trim() || !f.s[1].trim() || !f.s[2].trim()){ flash(mid, false, 'Les trois sujets sont obligatoires.'); return; }
    flash(mid, true, 'Enregistrement…');
    try { var r = await rpc('obeya_carte_enregistrer', { p_role:role, p_s1:f.s[0], p_s2:f.s[1], p_s3:f.s[2], p_risque:f.r, p_opp:f.o });
      delete O.drafts[role]; await load(); paintForms(); repaintLight();
      flash('obxFm_' + i, true, '✓ Enregistrée à ' + hhmm(r.saisi_le) + (r.moment === 'apres' ? ' · après le lancement' : ' · avant le lancement')); }
    catch(e){ flash(mid, false, 'Refusé : ' + ((e && e.message) || e)); }
  };

  /* Tour par exception : cartes non vertes, problèmes d'interface bloquants ou retenus, cartes non préparées */
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
    return { T:T, greens:greens };
  }
  function paintTour(){
    var el = $('obxTour'); if (!el) return;
    if (!prepared()){ el.innerHTML = '<div class="obx-sec"><h3>Tour par exception</h3><p>L’ordre du jour est généré par « Préparer l’Obeya » : l’IA analyse d’abord le plan d’action.</p></div>'; return; }
    var r = tourItems(), tot = r.T.reduce(function(a, x){ return a + x.min; }, 0), dur = (O.d.config && O.d.config.duree_min) || 60;
    var rows = r.T.map(function(x, i){ var s = SC[x.tone] || SC.orange; return '<div class="obx-ol"><b>' + (i + 1) + '</b><span style="width:10px;height:10px;border-radius:50%;background:' + s.c + ';margin-top:5px;flex:none;"></span><div style="flex:1 1 260px;min-width:0;"><div style="font-size:13px;"><b style="color:var(--ink);">' + esc(x.k) + '</b> · ' + esc(x.who) + '</div><div style="color:var(--ink-soft);font-size:13px;">' + esc(x.why) + '</div></div><span class="sub-cell" style="white-space:nowrap;">' + x.min + ' min</span></div>'; }).join('');
    el.innerHTML = '<div class="obx-sec"><h3>Tour par exception</h3><p>On ne passe en revue que ce qui s’écarte : le reste, au vert, n’est pas abordé.</p></div><div class="obx-card" style="border-top-color:#560A0F;"><div class="obx-row"><b>' + r.T.length + ' point' + (r.T.length > 1 ? 's' : '') + ' · environ ' + tot + ' min sur ' + dur + '</b></div>'
      + (rows || '<div class="sub-cell">Rien à traiter : toutes les cartes sont au vert et préparées.</div>') + '<div class="sub-cell">Non abordées, car vertes (' + r.greens.length + ') : ' + (r.greens.length ? esc(r.greens.join(', ')) : 'aucune') + '.</div></div>';
  }

  /* Cartes par fonction */
  function paintWall(){
    var el = $('obxWall'); if (!el) return; var by = byRole();
    var html = '<div class="obx-sec"><h3>Les cartes du Codir</h3><p>Trois sujets par fonction ; un risque et une opportunité prioritaires s’il y en a. Le statut tient aussi compte des problèmes d’interface détectés par l’IA.</p></div><div class="obx-grid">';
    cartes().forEach(function(c){
      var k = c.contenu, st = k ? statutCarte(c) : null, S = st ? SC[st] : null, ow = owedOf(c.role), wa = waitsOf(c.role);
      var assoc = (c.associees || []).length ? '<div class="sub-cell">Alimentée aussi par : ' + esc(c.associees.map(label).join(', ')) + '</div>' : '';
      var body;
      if (!k) body = '<div class="obx-box" style="background:#f3eee6;color:var(--muted);">' + esc(names(c)) + ' renseigne la carte de cette fonction avant la séance.</div>';
      else body = '<div>' + [0,1,2].map(function(i){ return '<div class="obx-ol"><b>' + (i + 1) + '</b><span>' + esc(k.sujets[i]) + '</span></div>'; }).join('') + '</div>'
        + (k.risque ? '<div class="obx-box obx-risk"><div class="t">Risque prioritaire</div>' + esc(k.risque) + '</div>' : '')
        + (k.opportunite ? '<div class="obx-box obx-opp"><div class="t">Opportunité prioritaire</div>' + esc(k.opportunite) + '</div>' : '');
      html += '<div class="obx-card" style="border-top-color:' + (S ? S.c : '#cfc6bd') + ';"><div class="obx-row" style="justify-content:space-between;"><div><b style="font-size:17px;">' + esc(c.carte) + '</b><div class="sub-cell">Responsable : ' + esc(names(c)) + '</div>'
        + '<div class="sub-cell">' + (k ? 'Carte préparée par ' + esc(nomDe(k.saisi_par, c)) + ' à ' + hhmm(k.saisi_le) + (k.moment === 'apres' ? ' (après le lancement)' : '') : 'Carte non préparée') + '</div>' + assoc + '</div>' + (S ? stChip(st) : neutral('Non préparée')) + '</div>'
        + body + (k && O.c ? '<div class="sub-cell">' + (ow + wa === 0 ? 'Aucun problème d’interface détecté' : ow + ' à résoudre de votre côté · ' + wa + ' vous concernent côté autre carte') + '</div>' : '') + '</div>';
    });
    el.innerHTML = html + '</div>';
  }

  /* Problèmes d'interface entre cartes */
  function effectText(o){
    var m = byRole()[o.fonction], who = m ? names(m) : ((O.sit && (O.sit.fonctions || []).indexOf(o.fonction) >= 0) ? 'vous' : 'le titulaire de la fonction « ' + label(o.fonction) + ' »');
    return 'Crée l’action « ' + o.action_libelle + ' » pour ' + who + ', dans ' + (o.delai_jours || 3) + ' jours';
  }
  function paintIface(){
    var el = $('obxIface'); if (!el) return;
    if (O.c2missing){ el.innerHTML = '<div class="obx-sec"><h3>Problèmes d’interface entre cartes</h3><p>Analyse indisponible : exécutez obeya_brique2.sql dans Supabase.</p></div>'; return; }
    if (!prepared() || !O.c || !O.c.analyse){
      el.innerHTML = '<div class="obx-sec"><h3>Problèmes d’interface entre cartes</h3><p>L’analyse du plan d’action n’est pas encore lancée. L’animateur la déclenche avec « Préparer l’Obeya », avant la séance.</p></div>'; return;
    }
    var a = O.c.analyse, all = O.c.constats || [], live = all.filter(function(x){ return x.etat !== 'ecarte' && x.etat !== 'decide'; });
    var ecartes = all.filter(function(x){ return x.etat === 'ecarte'; }), decides = all.filter(function(x){ return x.etat === 'decide'; });
    var shown = live.filter(function(x){ return !O.filter || (x.from_fn === O.filter.from && x.to_fn === O.filter.to); });
    var bloq = live.filter(function(x){ return x.gravite === 'bloquant'; }).length, anim = isAnim();
    var html = '<div class="obx-sec"><h3>Problèmes d’interface entre cartes</h3><p>Analyse du plan d’action faite avant la séance : blocages, échéances incompatibles, sujets traités par deux cartes, actions sans porteur. Chaque problème cite les actions concernées.</p></div>'
      + '<div class="obx-card" style="border-top-color:#c9a000;margin-bottom:14px;"><div class="obx-row"><b>' + live.length + ' problème' + (live.length > 1 ? 's' : '') + ' · ' + bloq + ' bloquant' + (bloq > 1 ? 's' : '') + ' · ' + (live.length - bloq) + ' à clarifier</b></div>'
      + '<div class="sub-cell">Analyse du ' + esc(fts(a.genere_le)) + ' à ' + hhmm(a.genere_le) + ' sur ' + a.nb_actions + ' actions ouvertes (hors confidentielles) · ' + (a.ia ? 'IA (' + esc(a.modele || '') + ')' : 'règles simples, sans IA') + '</div>'
      + (a.resume ? '<div style="font-size:14px;">' + esc(a.resume) + '</div>' : '') + (a.ia ? '' : '<div class="sub-cell">Sans IA, seuls les liens écrits « #numéro » dans les actions, les doublons évidents et les actions sans porteur sont détectés.</div>') + '</div>';
    var cs = cartes();
    if (cs.length > 1){
      html += '<div class="obx-card" style="margin-bottom:14px;"><b>Où ça coince</b><div class="sub-cell">De la carte qui doit agir (ligne) vers celle qui attend (colonne). Cliquez une case pour filtrer.</div><div class="obx-mx" style="grid-template-columns:minmax(80px,1.2fr) repeat(' + cs.length + ',minmax(0,1fr));"><div></div>'
        + cs.map(function(c){ return '<div class="sub-cell" style="text-align:center;align-self:end;font-weight:700;">' + esc(c.carte.replace('Marketing & Communication', 'Mkt & Com')) + '</div>'; }).join('')
        + cs.map(function(r){ return '<div class="sub-cell" style="font-weight:700;display:flex;align-items:center;">' + esc(r.carte.replace('Marketing & Communication', 'Mkt & Com')) + '</div>' + cs.map(function(c){
            var l = live.filter(function(x){ return x.from_fn === r.role && x.to_fn === c.role; }), bl = l.filter(function(x){ return x.gravite === 'bloquant'; }).length, on = O.filter && O.filter.from === r.role && O.filter.to === c.role;
            return '<button type="button" ' + (l.length ? '' : 'disabled ') + 'aria-label="' + esc(r.carte + ' vers ' + c.carte + ' : ' + l.length + ' problème(s)') + '" onclick="obxFilter(\'' + esc(r.role) + '\',\'' + esc(c.role) + '\')" style="background:' + (on ? '#560A0F' : (bl ? SC.rouge.bg : (l.length ? SC.orange.bg : (r.role === c.role ? '#f3eee6' : '#fff')))) + ';color:' + (on ? '#fff' : 'inherit') + ';border-color:' + (bl ? SC.rouge.c : (l.length ? SC.orange.c : '#e0d6cf')) + ';">' + (l.length || (r.role === c.role ? '' : '·')) + '</button>'; }).join(''); }).join('')
        + '</div>' + (O.filter ? '<div style="margin-top:8px;"><button type="button" class="add-btn sm ghost" onclick="obxFilter()">Filtre : ' + esc(codeLabel(O.filter.from) + ' vers ' + codeLabel(O.filter.to)) + ' · effacer</button></div>' : '') + '</div>';
    }
    if (!shown.length) html += '<div class="obx-card"><div>' + (live.length ? 'Aucun problème dans ce filtre.' : 'Aucun problème d’interface à traiter. Le Codir peut s’en tenir aux cartes.') + '</div></div>';
    shown.forEach(function(x){
      var bl = x.gravite === 'bloquant', kept = x.etat === 'retenu' || bl;
      html += '<div class="obx-card" style="border-top-color:' + (bl ? SC.rouge.c : SC.orange.c) + ';margin-bottom:14px;"><div class="obx-row">' + chip(bl ? 'Bloquant' : 'À clarifier', bl ? SC.rouge.bg : SC.orange.bg, bl ? SC.rouge.fg : SC.orange.fg, bl ? SC.rouge.c : SC.orange.c)
        + '<b style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#560A0F;">' + esc(TYPE_LBL[x.type] || x.type) + '</b><span class="sub-cell" style="font-weight:600;">' + esc(codeLabel(x.from_fn)) + (x.to_fn ? ' vers ' + esc(codeLabel(x.to_fn)) : '') + '</span></div>'
        + '<div><div style="font-size:16px;font-weight:700;">' + esc(x.titre) + '</div><div style="font-size:14px;margin-top:2px;">' + esc(x.constat) + '</div></div>'
        + '<div class="obx-row">' + (x.actions || []).map(function(n){ return neutral('#' + n); }).join('') + '<span class="sub-cell">Actions du plan d’action concernées</span></div>'
        + (x.question ? '<div class="obx-box" style="background:#f8f1e8;"><div class="t" style="color:#560A0F;">Question au Codir</div>' + esc(x.question) + '</div>' : '');
      if (anim){
        html += '<div class="obx-row"><button type="button" class="add-btn sm' + (kept ? '' : ' ghost') + '" ' + (bl ? 'disabled ' : '') + 'aria-pressed="' + (kept ? 'true' : 'false') + '" onclick="obxEtat(\'' + esc(x.id) + '\',\'' + (x.etat === 'retenu' ? 'ouvert' : 'retenu') + '\')">' + (bl ? 'À traiter : bloquant' : (x.etat === 'retenu' ? 'Retenu pour la séance' : 'Retenir pour la séance')) + '</button>'
          + '<button type="button" class="add-btn sm ghost" onclick="obxEtat(\'' + esc(x.id) + '\',\'ecarte\')">Écarter</button></div>'
          + '<div><div class="field-label">Décider : la décision crée l’action dans le plan d’action</div><div class="obx-row" style="align-items:stretch;">' + (x.options || []).map(function(o, i){
              return '<button type="button" class="obx-opt" onclick="obxDecide(\'' + esc(x.id) + '\',' + i + ')"><b>' + esc(o.libelle) + '</b><span class="e">' + esc(effectText(o)) + '</span></button>'; }).join('') + '</div></div>';
      } else if (x.etat === 'retenu') html += '<div class="sub-cell">Retenu pour la séance par l’animateur.</div>';
      html += '</div>';
    });
    if (decides.length) html += '<div class="obx-card" style="border-top-color:#2e7d46;margin-bottom:14px;"><b>Décidés (' + decides.length + ')</b>' + decides.map(function(x){ var o = (x.options || [])[x.decide_option] || {};
      return '<div class="obx-ol"><b>✓</b><div style="flex:1 1 240px;"><div style="font-size:13px;"><b>' + esc(x.titre) + '</b></div><div class="sub-cell">' + esc(o.libelle || '') + (x.action_numero ? ' · action #' + x.action_numero + ' créée' : '') + '</div></div></div>'; }).join('') + '</div>';
    if (anim && ecartes.length) html += '<div class="obx-card" style="margin-bottom:14px;"><div class="obx-row"><b>Écartés (' + ecartes.length + ')</b><button type="button" class="add-btn sm ghost" onclick="obxToggleEcartes()">' + (O.showEcartes ? 'Masquer' : 'Afficher') + '</button></div>'
      + (O.showEcartes ? ecartes.map(function(x){ return '<div class="obx-ol"><span style="flex:1 1 240px;font-size:13px;">' + esc(x.titre) + '</span><button type="button" class="add-btn sm ghost" onclick="obxEtat(\'' + esc(x.id) + '\',\'ouvert\')">Rouvrir</button></div>'; }).join('') : '') + '</div>';
    el.innerHTML = html + '<div id="obxIfMsg" style="font-size:13px;min-height:18px;"></div>';
  }
  window.obxFilter = function(from, to){ O.filter = (from && !(O.filter && O.filter.from === from && O.filter.to === to)) ? { from:from, to:to } : null; paintIface(); };
  window.obxToggleEcartes = function(){ O.showEcartes = !O.showEcartes; paintIface(); };
  window.obxEtat = async function(id, etat){
    try { await rpc('obeya_constat_etat', { p_id:id, p_etat:etat }); O.c = await rpc('obeya_constats_lire'); paintTour(); paintWall(); paintIface(); }
    catch(e){ flash('obxIfMsg', false, 'Refusé : ' + ((e && e.message) || e)); }
  };
  window.obxDecide = async function(id, i){
    try { var r = await rpc('obeya_constat_decider', { p_id:id, p_option:i }); O.c = await rpc('obeya_constats_lire'); paintTour(); paintWall(); paintIface(); paintJournal();
      flash('obxIfMsg', true, r && r.deja ? 'Déjà décidé : action #' + r.action_numero : '✓ Action #' + r.action_numero + ' créée' + (r.pilote_nom ? ' pour ' + r.pilote_nom : '') + (r.sans_pilote ? ' — SANS porteur : à compléter dans le plan d’action' : '') + ' · décision inscrite au journal'); }
    catch(e){ flash('obxIfMsg', false, 'Refusé : ' + ((e && e.message) || e)); }
  };

  function paintJournal(){
    var el = $('obxJournal'); if (!el) return; var j = (O.c && O.c.decisions) || [];
    el.innerHTML = '<div class="obx-sec"><h3>Journal des décisions</h3><p>Chaque décision crée une action dans le plan d’action et reste consultable ici.</p></div><div class="obx-card">'
      + (j.length ? j.map(function(d){ return '<div class="obx-ol"><b>' + esc(fts(d.decide_le)) + '</b><div style="flex:1 1 260px;min-width:0;"><div style="font-size:13px;"><b>' + esc(d.libelle) + '</b></div><div class="sub-cell">' + esc(d.option_libelle) + (d.fonction ? ' · ' + esc(codeLabel(d.fonction)) : '') + (d.pilote_nom ? ' · ' + esc(d.pilote_nom) : '') + '</div></div>' + (d.action_numero ? neutral('Action #' + d.action_numero) : '') + '</div>'; }).join('') : '<div class="sub-cell">Aucune décision pour le moment.</div>') + '</div>';
  }

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
  window.obxPrepare = async function(){
    if (O.busy) return; O.busy = true; var b = $('obxBtnPrep'); if (b) b.disabled = true;
    try {
      flash('obxMsg', true, 'Préparation : compte-rendu…');
      var crId = await rpc('obeya_cr_creer', { p_contexte: buildAgenda() }); O.crId = crId;
      await rpc('obeya_seance_prepare');
      flash('obxMsg', true, '🧠 Analyse du plan d’action en cours…');
      var ia = null, iaErr = '';
      try { ia = await callIA(); } catch(e){ iaErr = (e && e.message) || String(e); }
      await load();
      try { await rpc('obeya_cr_contexte', { p_contexte: buildAgenda() }); } catch(e){}
      paintAll();
      flash('obxMsg', !iaErr, iaErr ? 'Analyse impossible : ' + iaErr + ' — le reste de la préparation est fait.' : '✓ Obeya préparée : ' + (ia ? ia.nb_constats + ' problème(s) d’interface · ' + (ia.ia ? 'analyse IA' : 'règles simples' + (ia.raison ? ' (' + (ia.raison === 'plan_vide' ? 'plan d’action vide' : String(ia.raison).replace(/\s*:?\s*analyse par règles simples/i, '')) + ')' : '')) : ''));
    } catch(e){ var m = (e && e.message) || String(e); flash('obxMsg', false, 'Refusé : ' + m + (missing(m) ? ' — exécutez obeya_brique3.sql.' : '')); }
    finally { O.busy = false; var b2 = $('obxBtnPrep'); if (b2) b2.disabled = false; }
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
  function applyPane(){ var b = $('obxBoard'), c = $('obxCR'); if (!b || !c) return; var cr = O.pane === 'cr' && O.crMounted; b.style.display = cr ? 'none' : ''; c.style.display = cr ? '' : 'none'; }

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
    if (O.busy) return; O.busy = true; var b = $('obxBtnGo'); if (b) b.disabled = true;
    try {
      flash('obxMsg', true, 'Lancement de l’Obeya…');
      if (!seance().cr_id){ await rpc('obeya_cr_creer', { p_contexte: buildAgenda() }); }
      var r = await rpc('obeya_seance_lancer'); setOffset(r.serveur);
      await load(); paintAll(); startTimers();
      var ok = await mountCR(); applyPane(); paintLive(); paintTr();
      if (ok){ setTimeout(function(){ try { if (!recording() && $('crTranscript') && typeof window.crDictate === 'function') window.crDictate(); } catch(e){} trTick(); }, 600); }   /* dictée lancée avec l'Obeya ; sinon, bouton « Démarrer la transcription » */
      flash('obxMsg', true, '✓ Obeya lancé');
    } catch(e){ var m = (e && e.message) || String(e); flash('obxMsg', false, 'Refusé : ' + m + (missing(m) ? ' — exécutez obeya_brique3.sql.' : '')); }
    finally { O.busy = false; }
  };
  window.obxEnd = async function(){
    if (O.busy) return; if (!window.confirm('Terminer l’Obeya ? L’horloge s’arrête et le bilan de préparation est enregistré.')) return; O.busy = true;
    try {
      try { if (recording() && typeof window.crDictate === 'function') window.crDictate(); } catch(e){}
      await saveCR();                                                       /* transcription enregistrée dans le compte-rendu AVANT de le fermer */
      var r = await rpc('obeya_seance_terminer'); setOffset(r.serveur); O.bilan = r.bilan; O.crMounted = false; O.pane = 'board'; O.dismissed = false;
      await load(); paintAll(); startTimers();
    } catch(e){ flash('obxMsg', false, 'Refusé : ' + ((e && e.message) || e)); }
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
  window.obeyaReset = function(){ leave(); _accP = null; _accEmail = ''; O.sit = null; O.d = null; O.c = null; O.drafts = {}; O.bilan = null; O.filter = null; O.crMounted = false; O.pane = 'board'; O.dismissed = false; O.busy = false; };
})();
