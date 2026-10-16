/* COCKPIT KW — Ergonomie, étape 1 (public/shared/ux.js)
   Additif : une seule ligne <script> (index.html ET clap/index.html), après les autres modules. Pour revenir en arrière : retirer la ligne.
   1. FOCUS CLAVIER VISIBLE : un anneau doré cerclé de bordeaux autour de l'élément atteint au clavier (Tab). Avant : 4 règles de focus pour
      tout le Cockpit, donc on ne voyait pas où l'on était.
   2. MESSAGES NON BLOQUANTS : les 65 alert() du Cockpit (boîte grise du navigateur qui fige la page) deviennent des messages discrets en bas à
      droite : se ferment seuls, au clic ou avec Échap, ne se superposent pas (4 au plus), restent lisibles par les lecteurs d'écran.
      confirm() et prompt() ne sont PAS touchés ici (ils attendent une réponse : ils seront remplacés page par page, en commençant par l'Admin).
      Disponible pour les autres modules : window.kwToast(message, 'ok' | 'err' | 'warn' | 'info', duréeMs).
   3. PLANCHER DE TEXTE À 11 px : tout texte écrit plus petit (8 à 10,5 px : 53 endroits dans les pages et 13 règles de la feuille de style) passe à 11 px.
   4. MOUVEMENTS RÉDUITS : respecte le réglage « réduire les animations » du système. */
(function(){
  'use strict';
  if (window.__kwUx) return; window.__kwUx = true;

  /* ---------- 1, 3 (balises), 4 + habillage des messages : feuille de style ---------- */
  var SMALL = ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5'], sel = [];
  SMALL.forEach(function(v){ sel.push('[style*="font-size:' + v + 'px"]'); sel.push('[style*="font-size: ' + v + 'px"]'); });
  var CSS = ''
    + ':focus-visible{outline:3px solid #E8A200 !important;outline-offset:2px !important;box-shadow:0 0 0 5px rgba(86,10,15,.45) !important;}'
    + '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important;scroll-behavior:auto !important;}}'
    + sel.join(',') + '{font-size:11px !important;}'
    + '#kwToasts{position:fixed;right:16px;bottom:16px;z-index:100000;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px));pointer-events:none;}'
    + '.kwToast{pointer-events:auto;display:flex;gap:10px;align-items:flex-start;background:#fff;color:#2b1a1a;border:1px solid rgba(86,10,15,.2);border-left:5px solid #560A0F;border-radius:8px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.18);font:500 13.5px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;white-space:pre-line;word-break:break-word;animation:kwToastIn .18s ease-out;}'
    + '.kwToast.err{border-left-color:#c0392b;}.kwToast.ok{border-left-color:#2e7d46;}.kwToast.warn{border-left-color:#e08a00;}'
    + '.kwToast .kwToastX{all:unset;cursor:pointer;margin-left:auto;padding:0 4px;font-size:18px;line-height:1;color:#6b5b58;}'
    + '.kwToast .kwToastX:hover{color:#560A0F;}'
    + '@keyframes kwToastIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}'
    + '@media (max-width:640px){#kwToasts{left:12px;right:12px;bottom:12px;max-width:none;}}';
  function addCss(){
    if (document.getElementById('kwUxCss')) return;
    var st = document.createElement('style'); st.id = 'kwUxCss'; st.textContent = CSS; (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- 3 (feuille de style) : les règles existantes sous 11 px sont relevées à 11 px ---------- */
  function floorSheets(){
    var out = [];
    function walk(rules){
      var o = [];
      for (var i = 0; i < rules.length; i++){
        var r = rules[i];
        if (r.type === 1 && r.style && r.style.fontSize){
          var m = /^([\d.]+)px$/.exec(r.style.fontSize);
          if (m && parseFloat(m[1]) < 11) o.push(r.selectorText + '{font-size:11px}');
        } else if (r.type === 4 && r.cssRules){
          var inner = walk(r.cssRules); if (inner.length) o.push('@media ' + r.media.mediaText + '{' + inner.join('') + '}');
        }
      }
      return o;
    }
    [].forEach.call(document.styleSheets, function(sh){
      if (sh.ownerNode && (sh.ownerNode.id === 'kwUxCss' || sh.ownerNode.id === 'kwUxFloor')) return;
      try { out = out.concat(walk(sh.cssRules || [])); } catch(e){}   /* feuilles d'un autre domaine : illisibles, ignorées */
    });
    var old = document.getElementById('kwUxFloor'); if (old) old.remove();
    if (!out.length) return;
    var st = document.createElement('style'); st.id = 'kwUxFloor'; st.textContent = out.join(''); (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- 2 : messages non bloquants ---------- */
  var box = null, MAX = 4;
  function ensureBox(){
    if (box && box.isConnected) return box;
    box = document.createElement('div'); box.id = 'kwToasts'; box.setAttribute('aria-live', 'polite'); box.setAttribute('aria-atomic', 'false');
    document.body.appendChild(box); return box;
  }
  function kind(m){
    var t = String(m).toLowerCase();
    if (/^\s*(⚠|&#9888)/.test(m) || /erreur|impossible|échec|echec|refus|expir|invalide|introuvable|interdit|non autoris|réservé/.test(t)) return 'err';
    if (/enregistr|✓|✔|succès|succes|terminé|copié|envoy|supprim|mis à jour|ajout/.test(t)) return 'ok';
    return 'info';
  }
  var queue = [];
  function show(msg, type, ms){
    if (!document.body){ queue.push([msg, type, ms]); return null; }
    var text = String(msg == null ? '' : msg).trim(); if (!text) return null;
    var t = type || kind(text), b = ensureBox();
    var dur = ms || Math.min(14000, (t === 'err' ? 8000 : 5000) + text.length * 35);
    var same = [].filter.call(b.children, function(c){ return c.getAttribute('data-msg') === text; })[0];
    if (same){ same.__restart && same.__restart(); return same; }                      /* même message déjà affiché : on ne l'empile pas */
    while (b.children.length >= MAX) b.removeChild(b.firstChild);                         /* 4 au plus : les plus anciens partent d'abord */
    var el = document.createElement('div'); el.className = 'kwToast ' + (t === 'err' ? 'err' : t === 'ok' ? 'ok' : t === 'warn' ? 'warn' : '');
    el.setAttribute('data-msg', text); if (t === 'err') el.setAttribute('role', 'alert');
    var span = document.createElement('span'); span.textContent = text;
    var x = document.createElement('button'); x.type = 'button'; x.className = 'kwToastX'; x.setAttribute('aria-label', 'Fermer le message'); x.textContent = '×';
    el.appendChild(span); el.appendChild(x); b.appendChild(el);
    var timer = null;
    function close(){ clearTimeout(timer); if (el.parentNode) el.parentNode.removeChild(el); }
    function start(n){ clearTimeout(timer); timer = setTimeout(close, n); }
    el.__restart = function(){ start(dur); };
    x.addEventListener('click', close);
    el.addEventListener('mouseenter', function(){ clearTimeout(timer); });             /* survol : on laisse le temps de lire */
    el.addEventListener('mouseleave', function(){ start(2500); });
    start(dur);
    return el;
  }
  window.kwToast = show;
  window.alert = function(m){ try { show(m); } catch(e){} };                          /* ne bloque plus la page ; ne renvoie rien, comme alert() */
  document.addEventListener('keydown', function(ev){
    if (ev.key !== 'Escape' || !box || !box.lastChild) return; box.removeChild(box.lastChild);
  });
  function flush(){ var q = queue.splice(0); q.forEach(function(a){ show(a[0], a[1], a[2]); }); }

  function init(){ addCss(); floorSheets(); flush(); }
  addCss();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', floorSheets);
  window.kwUx = { floor: floorSheets, toast: show };
})();
