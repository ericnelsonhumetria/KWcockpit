/* COCKPIT KW — Captures terrain (public/shared/capture.js)
   Additif : une ligne <script> dans index.html ET clap/index.html (après cr-actions.js). Prérequis : sql/captures.sql.
   1. CLAP! › feuille « Capture » (tout le monde) : photo, vidéo ou enregistrement audio d'une situation, horodatés et géolocalisés,
      classés Succès / Problème / Opportunité / Risque, avec sujet, projet et commentaire. « Mes dernières captures » en dessous.
   2. COCKPIT › onglet « Captures » (droit « Captures » de la matrice Admin ; par défaut direction et CTO) : toutes les captures,
      organisées par Utilisateur / Date / Sujet / Projet, filtres, fiche détaillée (médias, carte), « traité », création d'action, export CSV.
   Fichiers : dossier privé « captures » de Supabase (liens temporaires d'une heure). Les photos sont réduites à 2000 px avant envoi. */
(function(){
  'use strict';
  if (window.__kwCapture) return; window.__kwCapture = true;
  var B = '#560A0F', O = '#EFB810', BUCKET = 'captures', MAXB = 50 * 1024 * 1024;
  var CATS = [
    { k:'succes', l:'Succès', c:'#2e7d46', i:'✓' },
    { k:'probleme', l:'Problème', c:'#c0392b', i:'!' },
    { k:'opportunite', l:'Opportunité', c:'#4F749B', i:'↗' },
    { k:'risque', l:'Risque', c:'#CF5C36', i:'⚠' }
  ];
  function cat(k){ return CATS.filter(function(x){ return x.k === k; })[0] || { k:k, l:k, c:'#6b5b58', i:'•' }; }
  function db(){ try { return (typeof SB !== 'undefined' && SB) ? SB : null; } catch(e){ return null; } }
  function sess(){ try { return (typeof SB_SESSION !== 'undefined' && SB_SESSION) ? SB_SESSION : null; } catch(e){ return null; } }
  function uid(){ var s = sess(); return s && s.user && s.user.id; }
  function myEmail(){ var s = sess(); return String((s && s.user && s.user.email) || '').toLowerCase(); }
  function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function toast(m, k){ try { if (window.kwToast) return window.kwToast(m, k || 'info', 6000); } catch(e){} try { console.log(m); } catch(e){} }
  function $(id){ return document.getElementById(id); }
  function fmtDT(iso){ try { return new Date(iso).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); } catch(e){ return ''; } }
  function fmtDay(iso){ try { return new Date(iso).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' }); } catch(e){ return ''; } }
  function nameOf(email){ return String(email || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(function(x){ return x.charAt(0).toUpperCase() + x.slice(1); }).join(' ') || 'Inconnu'; }
  function mapUrl(c){ return 'https://www.openstreetmap.org/?mlat=' + c.lat + '&mlon=' + c.lng + '#map=17/' + c.lat + '/' + c.lng; }
  function missing(m){ return /relation .*captures|does not exist|schema cache|bucket not found|Bucket not found/i.test(m || ''); }

  var CSS = ''
    + '.cap-wrap{max-width:760px;}'
    + '.cap-big{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0 6px;}'
    + '.cap-big button{all:unset;box-sizing:border-box;cursor:pointer;text-align:center;padding:16px 8px;border-radius:14px;background:' + B + ';color:#fff;font-weight:700;font-size:15px;box-shadow:0 2px 8px rgba(86,10,15,.18);}'
    + '.cap-big button span{display:block;font-size:26px;line-height:1.1;margin-bottom:4px;}'
    + '.cap-big button:active{transform:translateY(1px);}.cap-big button:focus-visible,.cap-cats button:focus-visible{outline:3px solid ' + O + ';outline-offset:2px;}'
    + '.cap-big button.rec{background:#c0392b;animation:capPulse 1.2s infinite;}@keyframes capPulse{50%{opacity:.75;}}'
    + '.cap-medias{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;}'
    + '.cap-m{position:relative;width:96px;height:96px;border-radius:10px;overflow:hidden;background:#f1ece4;display:flex;align-items:center;justify-content:center;font-size:30px;border:1px solid rgba(86,10,15,.12);}'
    + '.cap-m img,.cap-m video{width:100%;height:100%;object-fit:cover;}'
    + '.cap-m .x{all:unset;cursor:pointer;position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;text-align:center;line-height:22px;font-size:14px;}'
    + '.cap-m .t{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);color:#fff;font-size:11px;padding:2px 4px;text-align:center;}'
    + '.cap-meta{font-size:13px;color:#4a3d40;display:flex;flex-direction:column;gap:2px;margin:6px 0 10px;}'
    + '.cap-cats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:6px 0 12px;}'
    + '.cap-cats button{all:unset;box-sizing:border-box;cursor:pointer;text-align:center;padding:10px 4px;border-radius:12px;border:2px solid var(--cc);color:var(--cc);font-weight:700;font-size:13.5px;background:#fff;}'
    + '.cap-cats button b{display:block;font-size:18px;}'
    + '.cap-cats button[aria-pressed="true"]{background:var(--cc);color:#fff;}'
    + '.cap-f label{display:block;font-size:12px;color:#6b5b58;margin:8px 0 3px;}'
    + '.cap-f input,.cap-f textarea{width:100%;box-sizing:border-box;font:inherit;font-size:15px;padding:9px 11px;border:1px solid rgba(86,10,15,.25);border-radius:9px;background:#fff;}'
    + '.cap-save{all:unset;box-sizing:border-box;cursor:pointer;display:block;width:100%;text-align:center;margin-top:14px;padding:14px;border-radius:12px;background:' + B + ';color:#fff;font-weight:800;font-size:16px;}'
    + '.cap-save[disabled]{opacity:.45;cursor:not-allowed;}'
    + '.cap-rec{display:flex;align-items:center;gap:10px;background:#fff3f1;border:1px solid #f0c4bd;border-radius:10px;padding:10px 12px;margin:6px 0;font-weight:600;color:#c0392b;}'
    + '.cap-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:700;color:#fff;white-space:nowrap;}'
    + '.cap-list .it{display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid rgba(86,10,15,.08);}'
    + '.cap-list .th{width:56px;height:56px;border-radius:9px;background:#f1ece4;flex:0 0 auto;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:22px;}'
    + '.cap-list .th img{width:100%;height:100%;object-fit:cover;}'
    /* base du Cockpit */
    + '.capb-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:12px 0;}'
    + '.capb-kpi{all:unset;box-sizing:border-box;cursor:pointer;background:#fff;border:1px solid rgba(86,10,15,.12);border-left:5px solid var(--cc);border-radius:12px;padding:10px 12px;}'
    + '.capb-kpi b{display:block;font-size:24px;line-height:1.1;color:var(--cc);}.capb-kpi span{font-size:12.5px;color:#6b5b58;}'
    + '.capb-kpi[aria-pressed="true"]{box-shadow:0 0 0 2px var(--cc);}'
    + '.capb-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0 10px;}'
    + '.capb-bar select{width:auto !important;margin:0 !important;min-width:150px;font-size:13.5px;padding:7px 10px;border:1px solid rgba(86,10,15,.25);border-radius:9px;background:#fff;}'
    + '.capb-bar input[type=search]{font:inherit;font-size:13.5px;padding:8px 11px;border:1px solid rgba(86,10,15,.25);border-radius:9px;background:#fff;}'
    + '.capb-seg{display:inline-flex;border:1px solid rgba(86,10,15,.25);border-radius:9px;overflow:hidden;}'
    + '.capb-seg button{all:unset;cursor:pointer;padding:7px 12px;font-size:13px;font-weight:600;color:' + B + ';background:#fff;}'
    + '.capb-seg button[aria-pressed="true"]{background:' + B + ';color:#fff;}'
    + '.capb-g{margin:14px 0 6px;}'
    + '.capb-gh{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:10px;width:100%;padding:8px 4px;border-bottom:2px solid rgba(86,10,15,.12);font-weight:800;color:#1a1416;font-size:15px;}'
    + '.capb-gh .n{font-weight:600;color:#6b5b58;font-size:13px;}.capb-gh .dots{margin-left:auto;display:flex;gap:4px;}'
    + '.capb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-top:10px;}'
    + '.capb-card{all:unset;box-sizing:border-box;cursor:pointer;background:#fff;border:1px solid rgba(86,10,15,.12);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;}'
    + '.capb-card:hover{box-shadow:0 6px 18px rgba(86,10,15,.12);}.capb-card:focus-visible{outline:3px solid ' + O + ';outline-offset:2px;}'
    + '.capb-card .img{height:130px;background:#f1ece4;display:flex;align-items:center;justify-content:center;font-size:34px;position:relative;}'
    + '.capb-card .img img{width:100%;height:100%;object-fit:cover;}'
    + '.capb-card .img .cap-chip{position:absolute;top:8px;left:8px;}'
    + '.capb-card .bd{padding:9px 11px 11px;font-size:12.5px;color:#4a3d40;display:flex;flex-direction:column;gap:2px;}'
    + '.capb-card .bd b{font-size:14px;color:#1a1416;}'
    + '.capb-ov{position:fixed;inset:0;background:rgba(20,10,12,.55);z-index:100002;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px;}'
    + '.capb-dlg{background:#fff;border-radius:14px;max-width:760px;width:100%;padding:16px 18px;box-shadow:0 20px 60px rgba(0,0,0,.35);}'
    + '.capb-dlg img,.capb-dlg video{max-width:100%;max-height:60vh;border-radius:10px;display:block;margin:6px 0;}'
    + '.capb-dlg audio{width:100%;margin:6px 0;}'
    + '@media (max-width:640px){.cap-cats{grid-template-columns:repeat(2,1fr);}.capb-grid{grid-template-columns:repeat(2,1fr);}.capb-card .img{height:100px;}}';
  function addCss(){ if ($('kwCapCss')) return; var s = document.createElement('style'); s.id = 'kwCapCss'; s.textContent = CSS; document.head.appendChild(s); }

  /* ---------- liens temporaires vers les fichiers ---------- */
  var URLS = {};
  async function signed(paths){
    var need = paths.filter(function(p){ var u = URLS[p]; return p && !(u && u.exp > Date.now()); });
    if (need.length){
      try {
        var r = await db().storage.from(BUCKET).createSignedUrls(need, 3600);
        ((r && r.data) || []).forEach(function(x){ if (x && x.signedUrl) URLS[x.path] = { url:x.signedUrl, exp:Date.now() + 3500 * 1000 }; });
      } catch(e){}
    }
    var o = {}; paths.forEach(function(p){ if (URLS[p]) o[p] = URLS[p].url; }); return o;
  }
  function icon(t){ return t === 'video' ? '🎥' : t === 'audio' ? '🎙️' : t === 'photo' ? '📷' : '📝'; }

  /* =====================================================================
     1. CLAP! — feuille « Capture »
     ===================================================================== */
  var C = { host:null, medias:[], when:null, geo:null, geoState:'', lieu:'', cat:'', busy:false, rec:null, recent:[], refs:null, msg:'' };
  function reset(){ C.medias.forEach(function(m){ try { URL.revokeObjectURL(m.url); } catch(e){} }); C.medias = []; C.when = null; C.cat = ''; C.msg = ''; }

  function locate(force){
    if (!navigator.geolocation){ C.geoState = 'indisponible'; return; }
    if (C.geoState === 'cours' && !force) return;
    C.geoState = 'cours'; paintMeta();
    navigator.geolocation.getCurrentPosition(function(p){
      C.geo = { lat:+p.coords.latitude.toFixed(6), lng:+p.coords.longitude.toFixed(6), acc:Math.round(p.coords.accuracy || 0) }; C.geoState = 'ok'; C.lieu = '';
      paintMeta(); reverse(C.geo);
    }, function(err){ C.geoState = err && err.code === 1 ? 'refus' : 'echec'; paintMeta(); }, { enableHighAccuracy:true, timeout:15000, maximumAge:60000 });
  }
  async function reverse(g){
    try {
      var r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=fr&lat=' + g.lat + '&lon=' + g.lng);
      var j = await r.json(), a = (j && j.address) || {};
      var parts = [a.road || a.pedestrian || a.industrial || a.amenity, a.city || a.town || a.village || a.municipality, a.postcode].filter(Boolean);
      if (C.geo === g){ C.lieu = parts.join(', ') || (j && j.display_name) || ''; paintMeta(); }
    } catch(e){}
  }
  function paintMeta(){
    var m = $('capMeta'); if (!m) return;
    var g = C.geo, st = C.geoState;
    var pos = st === 'ok' && g ? '📍 ' + (C.lieu ? esc(C.lieu) + ' · ' : '') + g.lat.toFixed(5) + ', ' + g.lng.toFixed(5) + ' (± ' + g.acc + ' m) <a href="' + mapUrl(g) + '" target="_blank" rel="noopener">carte ↗</a>'
      : st === 'cours' ? '📍 Recherche de la position…'
      : st === 'refus' ? '📍 Position refusée : autorise la localisation pour ce site dans le navigateur. <a href="#" data-geo="1">Réessayer</a>'
      : st ? '📍 Position indisponible. <a href="#" data-geo="1">Réessayer</a>' : '';
    m.innerHTML = '<span>🕒 ' + esc(fmtDT((C.when || new Date()).toISOString())) + (C.when ? '' : ' <span style="color:#8b8578">(heure de la première prise)</span>') + '</span><span>' + pos + '</span>';
    var a = m.querySelector('[data-geo]'); if (a) a.addEventListener('click', function(e){ e.preventDefault(); locate(true); });
  }
  function paintMedias(){
    var z = $('capMedias'); if (!z) return;
    z.innerHTML = C.medias.map(function(m, i){
      var inner = m.type === 'photo' ? '<img src="' + m.url + '" alt="">' : m.type === 'video' ? '<video src="' + m.url + '" muted playsinline></video>' : '🎙️';
      var lab = m.type === 'audio' ? Math.round(m.duree || 0) + ' s' : (m.type === 'video' ? 'vidéo · ' + (m.blob.size / 1048576).toFixed(1) + ' Mo' : '');
      return '<div class="cap-m">' + inner + (lab ? '<span class="t">' + lab + '</span>' : '') + '<button class="x" type="button" data-rm="' + i + '" aria-label="Retirer">×</button></div>';
    }).join('');
    [].forEach.call(z.querySelectorAll('[data-rm]'), function(b){ b.addEventListener('click', function(){ var i = +b.getAttribute('data-rm'); var m = C.medias.splice(i, 1)[0]; try { URL.revokeObjectURL(m.url); } catch(e){} paintMedias(); paintSave(); }); });
  }
  function canSave(){ var d = $('capDesc'); return !C.busy && !!C.cat && (C.medias.length > 0 || (d && d.value.trim().length > 2)); }
  function paintSave(){
    var b = $('capSave'); if (!b) return;
    b.disabled = !canSave();
    b.textContent = C.busy ? 'Enregistrement…' : (!C.cat ? 'Choisis une catégorie' : (C.medias.length || ($('capDesc') && $('capDesc').value.trim()) ? 'Enregistrer la capture' : 'Ajoute une photo, une vidéo, un audio ou un texte'));
  }
  async function shrink(file){
    try {
      if (!/^image\//.test(file.type) || !window.createImageBitmap) return file;
      var bmp = await createImageBitmap(file, { imageOrientation:'from-image' });
      var k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      if (k >= 1 && file.size < 1.5 * 1048576) return file;
      var cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      var blob = await new Promise(function(res){ cv.toBlob(res, 'image/jpeg', 0.85); });
      return blob && blob.size < file.size ? blob : file;
    } catch(e){ return file; }
  }
  async function addFile(file, type){
    if (!file) return;
    if (!C.when) C.when = new Date();
    if (!C.geo && C.geoState !== 'cours') locate();
    var blob = type === 'photo' ? await shrink(file) : file;
    if (blob.size > MAXB){ toast((type === 'video' ? 'Vidéo' : 'Fichier') + ' trop lourd(e) : ' + (blob.size / 1048576).toFixed(0) + ' Mo (50 Mo maximum). Filme plus court.', 'err'); return; }
    C.medias.push({ type:type, blob:blob, mime:blob.type || file.type || (type === 'photo' ? 'image/jpeg' : 'video/mp4'), url:URL.createObjectURL(blob) });
    paintMedias(); paintMeta(); paintSave();
  }
  function pick(type){
    var inp = document.createElement('input'); inp.type = 'file';
    inp.accept = type === 'photo' ? 'image/*' : 'video/*'; inp.setAttribute('capture', 'environment');
    inp.addEventListener('change', function(){ var f = inp.files && inp.files[0]; addFile(f, type); });
    inp.click();
  }
  async function audio(){
    if (C.rec){ try { C.rec.mr.stop(); } catch(e){} return; }
    if (!navigator.mediaDevices || !window.MediaRecorder){ toast('Enregistrement audio impossible sur ce navigateur.', 'err'); return; }
    var stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio:true }); }
    catch(e){ toast('Micro refusé : autorise le micro pour ce site dans le navigateur.', 'err'); return; }
    var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function(m){ try { return MediaRecorder.isTypeSupported(m); } catch(e){ return false; } })[0] || '';
    var mr = new MediaRecorder(stream, mime ? { mimeType:mime } : undefined), chunks = [], t0 = Date.now();
    if (!C.when) C.when = new Date();
    if (!C.geo && C.geoState !== 'cours') locate();
    C.rec = { mr:mr, t0:t0, tick:setInterval(function(){ var s = Math.round((Date.now() - t0) / 1000), z = $('capRecT'); if (z) z.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); if (s >= 300) { try { mr.stop(); } catch(e){} } }, 500) };
    mr.ondataavailable = function(e){ if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = function(){
      clearInterval(C.rec.tick); stream.getTracks().forEach(function(t){ t.stop(); });
      var blob = new Blob(chunks, { type:(mr.mimeType || mime || 'audio/webm').split(';')[0] }), d = (Date.now() - t0) / 1000; C.rec = null;
      if (blob.size) C.medias.push({ type:'audio', blob:blob, mime:blob.type, url:URL.createObjectURL(blob), duree:Math.round(d * 10) / 10 });
      paintRec(); paintMedias(); paintSave();
    };
    mr.start(1000); paintRec();
  }
  function paintRec(){
    var z = $('capRec'), b = document.querySelector('.cap-big [data-k="audio"]');
    if (b){ b.classList.toggle('rec', !!C.rec); b.innerHTML = C.rec ? '<span>⏹</span>Arrêter' : '<span>🎙️</span>Audio'; }
    if (z) z.innerHTML = C.rec ? '<div class="cap-rec" role="status">● Enregistrement en cours <span id="capRecT">0:00</span><span style="font-weight:400;color:#6b5b58;font-size:12.5px;">(5 min max)</span></div>' : '';
  }
  async function loadRefs(){
    if (C.refs) return C.refs;
    var s = new Set(), p = new Set();
    try { var a = await db().from('captures').select('sujet,projet').order('capture_le', { ascending:false }).limit(300); ((a && a.data) || []).forEach(function(x){ if (x.sujet) s.add(x.sujet); if (x.projet) p.add(x.projet); }); } catch(e){}
    try { var b = await db().from('actions').select('projet').is('archived_at', null).limit(1000); ((b && b.data) || []).forEach(function(x){ if (x.projet) p.add(x.projet); }); } catch(e){}
    C.refs = { sujets:[].concat(Array.from(s)).sort(), projets:[].concat(Array.from(p)).sort() }; return C.refs;
  }
  async function save(){
    if (!canSave()) return;
    C.busy = true; paintSave();
    var id = (crypto.randomUUID && crypto.randomUUID()) || ('c' + Date.now() + Math.random().toString(16).slice(2)), u = uid(), done = [], medias = [];
    try {
      for (var i = 0; i < C.medias.length; i++){
        var m = C.medias[i], ext = (m.mime.split('/')[1] || 'bin').split(';')[0].replace('quicktime', 'mov').replace('jpeg', 'jpg').replace('x-m4a', 'm4a');
        var path = u + '/' + id + '/' + (i + 1) + '.' + ext;
        var r = await db().storage.from(BUCKET).upload(path, m.blob, { contentType:m.mime, upsert:false });
        if (r && r.error) throw r.error;
        done.push(path); medias.push({ path:path, type:m.type, mime:m.mime, taille:m.blob.size, duree:m.duree || null });
      }
      var row = { id:id, categorie:C.cat, sujet:($('capSujet').value || '').trim() || null, projet:($('capProjet').value || '').trim() || null,
        description:($('capDesc').value || '').trim() || null, medias:medias, capture_le:(C.when || new Date()).toISOString(),
        lat:C.geo ? C.geo.lat : null, lng:C.geo ? C.geo.lng : null, precision_m:C.geo ? C.geo.acc : null, lieu:C.lieu || null, auteur_nom:nameOf(myEmail()) };
      var ins = await db().from('captures').insert(row).select('id').single();
      if (ins && ins.error) throw ins.error;
      reset(); C.refs = null;
      toast('Capture enregistrée (' + cat(row.categorie).l + ').', 'ok');
      renderSheet();
    } catch(e){
      if (done.length) try { await db().storage.from(BUCKET).remove(done); } catch(_){}
      var msg = (e && e.message) || String(e);
      toast(missing(msg) ? 'Captures pas encore installées : exécuter sql/captures.sql dans Supabase.' : 'Enregistrement impossible : ' + msg, 'err');
    } finally { C.busy = false; paintSave(); }
  }
  async function loadRecent(){
    try {
      var r = await db().from('captures').select('*').eq('user_id', uid()).order('capture_le', { ascending:false }).limit(15);
      if (r && r.error) throw r.error; C.recent = r.data || []; C.msg = '';
    } catch(e){ C.recent = []; C.msg = missing(e && e.message) ? 'Captures pas encore installées : exécuter sql/captures.sql dans Supabase.' : ''; }
  }
  async function paintRecent(){
    var z = $('capRecent'); if (!z) return;
    if (C.msg){ z.innerHTML = '<div class="edit-hint" style="color:#c0392b;">' + esc(C.msg) + '</div>'; return; }
    if (!C.recent.length){ z.innerHTML = '<div class="edit-hint">Aucune capture pour l’instant.</div>'; return; }
    var firsts = C.recent.map(function(c){ var m = (c.medias || []).filter(function(x){ return x.type === 'photo'; })[0]; return m && m.path; }).filter(Boolean);
    var urls = await signed(firsts);
    z.innerHTML = '<div class="cap-list">' + C.recent.map(function(c){
      var k = cat(c.categorie), ph = (c.medias || []).filter(function(x){ return x.type === 'photo'; })[0], m0 = (c.medias || [])[0];
      var th = ph && urls[ph.path] ? '<img src="' + esc(urls[ph.path]) + '" alt="">' : icon(m0 ? m0.type : '');
      return '<div class="it"><div class="th">' + th + '</div><div style="flex:1;min-width:0;"><span class="cap-chip" style="background:' + k.c + '">' + k.i + ' ' + k.l + '</span> '
        + '<b style="font-size:14px;">' + esc(c.sujet || '(sans sujet)') + '</b><div class="edit-hint">' + esc([fmtDT(c.capture_le), c.projet, c.lieu].filter(Boolean).join(' · ')) + ((c.medias || []).length ? ' · ' + (c.medias || []).map(function(x){ return icon(x.type); }).join('') : '') + (c.statut === 'traite' ? ' · ✔ traité' : '') + '</div></div>'
        + '<button type="button" class="add-btn sm ghost" data-del="' + esc(c.id) + '" title="Supprimer">✕</button></div>';
    }).join('') + '</div>';
    [].forEach.call(z.querySelectorAll('[data-del]'), function(b){ b.addEventListener('click', function(){ removeCapture(C.recent.filter(function(x){ return x.id === b.getAttribute('data-del'); })[0], function(){ renderSheet(); }); }); });
  }
  async function removeCapture(c, after){
    if (!c) return;
    var ok = true;
    try { ok = typeof window.kwConfirm === 'function' ? await window.kwConfirm({ title:'Supprimer cette capture ?', message:'La capture et ses fichiers sont supprimés définitivement.', confirmLabel:'Supprimer', cancelLabel:'Annuler' }) : window.confirm('Supprimer définitivement cette capture et ses fichiers ?'); } catch(e){}
    if (!ok) return;
    try {
      var paths = (c.medias || []).map(function(m){ return m.path; }).filter(Boolean);
      var r = await db().from('captures').delete().eq('id', c.id).select('id'); if (r && r.error) throw r.error;
      if (!r || !r.data || !r.data.length) throw new Error('suppression refusée');
      if (paths.length) await db().storage.from(BUCKET).remove(paths);
      toast('Capture supprimée.', 'ok'); if (after) after();
    } catch(e){ toast('Suppression impossible : ' + ((e && e.message) || e), 'err'); }
  }
  async function renderSheet(){
    var h = C.host && $(C.host); if (!h) return;
    addCss();
    var refs = await loadRefs();
    h.innerHTML = '<div class="cap-wrap"><div class="sec-eyebrow">Terrain</div><div class="sec-title">Capture</div>'
      + '<div class="sec-note">Une situation vue sur le terrain : prends-la en photo, en vidéo ou à l’oral, classe-la, enregistre. Heure et position sont ajoutées automatiquement.</div>'
      + '<div class="panel" style="padding:14px 16px;margin-top:10px;">'
      +   '<div class="cap-big"><button type="button" data-k="photo"><span>📷</span>Photo</button><button type="button" data-k="video"><span>🎥</span>Vidéo</button><button type="button" data-k="audio"><span>🎙️</span>Audio</button></div>'
      +   '<div id="capRec"></div><div class="cap-medias" id="capMedias"></div><div class="cap-meta" id="capMeta"></div>'
      +   '<div style="font-size:12px;color:#6b5b58;margin:6px 0 4px;">Cette situation est…</div>'
      +   '<div class="cap-cats" role="group" aria-label="Catégorie">' + CATS.map(function(k){ return '<button type="button" data-cat="' + k.k + '" aria-pressed="' + (C.cat === k.k) + '" style="--cc:' + k.c + '"><b>' + k.i + '</b>' + k.l + '</button>'; }).join('') + '</div>'
      +   '<div class="cap-f"><label for="capSujet">Sujet</label><input id="capSujet" list="capSujets" placeholder="Ex : poste d’emballage ligne 2" autocomplete="off">'
      +   '<datalist id="capSujets">' + refs.sujets.map(function(x){ return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>'
      +   '<label for="capProjet">Projet</label><input id="capProjet" list="capProjets" placeholder="Ex : Andros 2026" autocomplete="off">'
      +   '<datalist id="capProjets">' + refs.projets.map(function(x){ return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>'
      +   '<label for="capDesc">Commentaire</label><textarea id="capDesc" rows="3" placeholder="Ce qui se passe, ce que ça montre, ce qu’il faudrait faire…"></textarea></div>'
      +   '<button type="button" class="cap-save" id="capSave">Choisis une catégorie</button>'
      + '</div>'
      + '<div class="sec-title" style="font-size:16px;margin-top:22px;">Mes dernières captures</div><div id="capRecent"><div class="edit-hint">Chargement…</div></div></div>';
    [].forEach.call(h.querySelectorAll('.cap-big button'), function(b){ b.addEventListener('click', function(){ var k = b.getAttribute('data-k'); if (k === 'audio') audio(); else pick(k); }); });
    [].forEach.call(h.querySelectorAll('.cap-cats button'), function(b){ b.addEventListener('click', function(){ C.cat = b.getAttribute('data-cat'); [].forEach.call(h.querySelectorAll('.cap-cats button'), function(x){ x.setAttribute('aria-pressed', String(x === b)); }); paintSave(); }); });
    $('capDesc').addEventListener('input', paintSave);
    $('capSave').addEventListener('click', save);
    paintMedias(); paintRec(); paintMeta(); paintSave();
    if (!C.geo && C.geoState !== 'cours') locate();
    await loadRecent(); paintRecent();
  }
  window.clapCapture = { mount:function(hostId){ C.host = hostId; return renderSheet(); } };

  /* =====================================================================
     2. COCKPIT — onglet « Captures » (toutes les captures)
     ===================================================================== */
  var K = { rows:[], by:'user', cat:'', st:'', per:'30', q:'', who:'', closed:{}, err:'', ok:null };
  try { var sv = JSON.parse(sessionStorage.getItem('kw:capb') || '{}'); ['by', 'per'].forEach(function(k){ if (sv[k]) K[k] = sv[k]; }); } catch(e){}
  function keep(){ try { sessionStorage.setItem('kw:capb', JSON.stringify({ by:K.by, per:K.per })); } catch(e){} }
  async function canSeeAll(){
    if (K.ok !== null) return K.ok;
    try { var r = await db().rpc('capture_voit_tout'); K.ok = !!(r && r.data === true); } catch(e){ K.ok = false; }
    return K.ok;
  }
  function filtered(){
    var lim = K.per === 'tout' ? 0 : Date.now() - Number(K.per) * 864e5, q = K.q.trim().toLowerCase();
    return K.rows.filter(function(c){
      if (K.cat && c.categorie !== K.cat) return false;
      if (K.st === 'nouveau' && c.statut === 'traite') return false;
      if (K.st === 'traite' && c.statut !== 'traite') return false;
      if (K.who && c.auteur_email !== K.who) return false;
      if (lim && new Date(c.capture_le).getTime() < lim) return false;
      if (q && [c.sujet, c.projet, c.description, c.lieu, c.auteur_nom, c.auteur_email].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function groupKey(c){
    if (K.by === 'date'){ var d = new Date(c.capture_le); return { k:d.toISOString().slice(0, 10), l:fmtDay(c.capture_le) }; }
    if (K.by === 'sujet') return { k:(c.sujet || '').toLowerCase() || '~', l:c.sujet || 'Sans sujet' };
    if (K.by === 'projet') return { k:(c.projet || '').toLowerCase() || '~', l:c.projet || 'Sans projet' };
    return { k:c.auteur_email || '~', l:c.auteur_nom || nameOf(c.auteur_email) };
  }
  async function loadBase(){
    try {
      var r = await db().from('captures').select('*').order('capture_le', { ascending:false }).limit(2000);
      if (r && r.error) throw r.error; K.rows = r.data || []; K.err = '';
    } catch(e){ K.rows = []; var m = (e && e.message) || String(e); K.err = missing(m) ? 'Captures pas encore installées : exécuter sql/captures.sql dans Supabase.' : m; }
  }
  async function renderBase(){
    var v = $('view'); if (!v) return;
    addCss();
    var rows = filtered(), all = K.rows;
    var cnt = function(k){ return all.filter(function(c){ return c.categorie === k; }).length; };
    var todo = all.filter(function(c){ return c.statut !== 'traite' && (c.categorie === 'probleme' || c.categorie === 'risque'); }).length;
    var who = {}; all.forEach(function(c){ who[c.auteur_email] = c.auteur_nom || nameOf(c.auteur_email); });
    var h = '<div class="sec-eyebrow">Terrain</div><div class="sec-title">Captures</div>'
      + '<div class="sec-note">Toutes les situations capturées dans Clap! (photo, vidéo, audio), horodatées et géolocalisées. ' + all.length + ' capture' + (all.length > 1 ? 's' : '') + (todo ? ' · <b style="color:#c0392b">' + todo + ' problème' + (todo > 1 ? 's' : '') + ' ou risque' + (todo > 1 ? 's' : '') + ' à traiter</b>' : '') + '.</div>';
    if (K.err){ v.innerHTML = h + '<div class="panel" style="padding:14px 16px;color:#c0392b;">' + esc(K.err) + '</div>'; return; }
    h += '<div class="capb-kpis">' + CATS.map(function(k){ return '<button type="button" class="capb-kpi" data-kcat="' + k.k + '" aria-pressed="' + (K.cat === k.k) + '" style="--cc:' + k.c + '"><b>' + cnt(k.k) + '</b><span>' + k.i + ' ' + k.l + '</span></button>'; }).join('') + '</div>';
    h += '<div class="capb-bar">'
      + '<span style="font-size:13px;color:#6b5b58;">Organiser par</span><span class="capb-seg" role="group">' + [['user', 'Utilisateur'], ['date', 'Date'], ['sujet', 'Sujet'], ['projet', 'Projet']].map(function(x){ return '<button type="button" data-by="' + x[0] + '" aria-pressed="' + (K.by === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</span>'
      + '<select id="capbPer" aria-label="Période">' + [['7', '7 derniers jours'], ['30', '30 derniers jours'], ['90', '3 derniers mois'], ['tout', 'Tout']].map(function(x){ return '<option value="' + x[0] + '"' + (K.per === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>'
      + '<select id="capbSt" aria-label="Statut"><option value="">Tous statuts</option><option value="nouveau"' + (K.st === 'nouveau' ? ' selected' : '') + '>À traiter</option><option value="traite"' + (K.st === 'traite' ? ' selected' : '') + '>Traités</option></select>'
      + '<select id="capbWho" aria-label="Utilisateur"><option value="">Tout le monde</option>' + Object.keys(who).sort(function(a, b){ return who[a].localeCompare(who[b]); }).map(function(e){ return '<option value="' + esc(e) + '"' + (K.who === e ? ' selected' : '') + '>' + esc(who[e]) + '</option>'; }).join('') + '</select>'
      + '<input id="capbQ" type="search" placeholder="Rechercher (sujet, projet, lieu, texte…)" value="' + esc(K.q) + '" style="min-width:220px;flex:1;">'
      + '<button type="button" class="add-btn ghost" id="capbCsv">⬇ Export CSV</button></div>';
    h += '<div class="edit-hint">' + rows.length + ' capture' + (rows.length > 1 ? 's' : '') + ' affichée' + (rows.length > 1 ? 's' : '') + (K.cat ? ' · ' + cat(K.cat).l + ' <a href="#" id="capbClr">(tout afficher)</a>' : '') + '</div>';
    var groups = [], idx = {};
    rows.forEach(function(c){ var g = groupKey(c); if (!idx[g.k]){ idx[g.k] = { k:g.k, l:g.l, items:[] }; groups.push(idx[g.k]); } idx[g.k].items.push(c); });
    if (K.by === 'date') groups.sort(function(a, b){ return b.k.localeCompare(a.k); });
    else groups.sort(function(a, b){ return (a.k === '~') - (b.k === '~') || b.items.length - a.items.length || a.l.localeCompare(b.l); });
    var firsts = []; rows.forEach(function(c){ var m = (c.medias || []).filter(function(x){ return x.type === 'photo'; })[0]; if (m) firsts.push(m.path); });
    var urls = await signed(firsts.slice(0, 400));
    h += groups.length ? groups.map(function(g){
      var open = !K.closed[K.by + ':' + g.k];
      var dots = CATS.map(function(k){ var n = g.items.filter(function(c){ return c.categorie === k.k; }).length; return n ? '<span class="cap-chip" style="background:' + k.c + '">' + k.i + ' ' + n + '</span>' : ''; }).join('');
      return '<div class="capb-g"><button type="button" class="capb-gh" data-g="' + esc(g.k) + '" aria-expanded="' + open + '">' + (open ? '▾' : '▸') + ' ' + esc(g.l) + ' <span class="n">' + g.items.length + '</span><span class="dots">' + dots + '</span></button>'
        + (open ? '<div class="capb-grid">' + g.items.map(function(c){ return card(c, urls); }).join('') + '</div>' : '') + '</div>';
    }).join('') : '<div class="panel" style="padding:14px 16px;margin-top:10px;">Aucune capture pour ces filtres.</div>';
    v.innerHTML = h;
    [].forEach.call(v.querySelectorAll('[data-kcat]'), function(b){ b.addEventListener('click', function(){ var k = b.getAttribute('data-kcat'); K.cat = K.cat === k ? '' : k; renderBase(); }); });
    [].forEach.call(v.querySelectorAll('[data-by]'), function(b){ b.addEventListener('click', function(){ K.by = b.getAttribute('data-by'); keep(); renderBase(); }); });
    [].forEach.call(v.querySelectorAll('[data-g]'), function(b){ b.addEventListener('click', function(){ var k = K.by + ':' + b.getAttribute('data-g'); K.closed[k] = !K.closed[k]; renderBase(); }); });
    [].forEach.call(v.querySelectorAll('[data-cap]'), function(b){ b.addEventListener('click', function(){ detail(K.rows.filter(function(c){ return c.id === b.getAttribute('data-cap'); })[0]); }); });
    $('capbPer').addEventListener('change', function(e){ K.per = e.target.value; keep(); renderBase(); });
    $('capbSt').addEventListener('change', function(e){ K.st = e.target.value; renderBase(); });
    $('capbWho').addEventListener('change', function(e){ K.who = e.target.value; renderBase(); });
    var tq = null; $('capbQ').addEventListener('input', function(e){ K.q = e.target.value; clearTimeout(tq); tq = setTimeout(function(){ var pos = e.target.selectionStart; renderBase().then(function(){ var q = $('capbQ'); if (q){ q.focus(); try { q.setSelectionRange(pos, pos); } catch(_){} } }); }, 300); });
    $('capbCsv').addEventListener('click', function(){ csv(rows); });
    var clr = $('capbClr'); if (clr) clr.addEventListener('click', function(e){ e.preventDefault(); K.cat = ''; renderBase(); });
  }
  function card(c, urls){
    var k = cat(c.categorie), ph = (c.medias || []).filter(function(x){ return x.type === 'photo'; })[0], m0 = (c.medias || [])[0];
    var img = ph && urls[ph.path] ? '<img loading="lazy" src="' + esc(urls[ph.path]) + '" alt="">' : icon(m0 ? m0.type : '');
    return '<button type="button" class="capb-card" data-cap="' + esc(c.id) + '"><div class="img">' + img + '<span class="cap-chip" style="background:' + k.c + '">' + k.i + ' ' + k.l + '</span></div>'
      + '<div class="bd"><b>' + esc(c.sujet || '(sans sujet)') + '</b><span>' + esc([c.projet, c.auteur_nom || nameOf(c.auteur_email)].filter(Boolean).join(' · ')) + '</span>'
      + '<span>🕒 ' + esc(fmtDT(c.capture_le)) + ((c.medias || []).length ? ' · ' + (c.medias || []).map(function(x){ return icon(x.type); }).join('') : '') + '</span>'
      + (c.lieu || c.lat ? '<span>📍 ' + esc(c.lieu || (c.lat + ', ' + c.lng)) + '</span>' : '')
      + (c.statut === 'traite' ? '<span style="color:#2e7d46;font-weight:700;">✔ Traité' + (c.action_id ? ' (action créée)' : '') + '</span>' : '') + '</div></button>';
  }
  async function detail(c){
    if (!c) return;
    var urls = await signed((c.medias || []).map(function(m){ return m.path; }));
    var k = cat(c.categorie);
    var ov = document.createElement('div'); ov.className = 'capb-ov';
    var media = (c.medias || []).map(function(m){ var u = urls[m.path]; if (!u) return '<div class="edit-hint">Fichier indisponible.</div>';
      return m.type === 'photo' ? '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="Photo"></a>' : m.type === 'video' ? '<video src="' + esc(u) + '" controls playsinline preload="metadata"></video>' : '<audio src="' + esc(u) + '" controls preload="metadata"></audio>'; }).join('');
    ov.innerHTML = '<div class="capb-dlg" role="dialog" aria-modal="true" aria-label="Capture">'
      + '<div style="display:flex;align-items:center;gap:10px;"><span class="cap-chip" style="background:' + k.c + ';font-size:13px;">' + k.i + ' ' + k.l + '</span><b style="font-size:17px;">' + esc(c.sujet || '(sans sujet)') + '</b><button type="button" data-x="1" class="add-btn sm ghost" style="margin-left:auto;">Fermer</button></div>'
      + '<div class="edit-hint" style="margin:6px 0;">' + esc([c.projet ? 'Projet : ' + c.projet : '', 'Par ' + (c.auteur_nom || nameOf(c.auteur_email)), 'le ' + fmtDT(c.capture_le)].filter(Boolean).join(' · ')) + '</div>'
      + (c.lat ? '<div style="font-size:13.5px;">📍 ' + esc(c.lieu || '') + ' (' + c.lat + ', ' + c.lng + (c.precision_m ? ', ± ' + Math.round(c.precision_m) + ' m' : '') + ') <a href="' + mapUrl(c) + '" target="_blank" rel="noopener">Voir sur la carte ↗</a></div>' : '<div class="edit-hint">Position non disponible.</div>')
      + (c.description ? '<p style="white-space:pre-wrap;margin:10px 0;font-size:14.5px;">' + esc(c.description) + '</p>' : '')
      + media
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">'
      +   '<button type="button" class="add-btn" data-st="1">' + (c.statut === 'traite' ? '↺ Remettre à traiter' : '✔ Marquer traité') + '</button>'
      +   (c.action_id ? '<span class="edit-hint" style="align-self:center;">Action déjà créée.</span>' : '<button type="button" class="add-btn ghost" data-act="1">＋ Créer une action</button>')
      +   '<button type="button" class="add-btn ghost" data-del="1" style="margin-left:auto;color:#c0392b;">Supprimer</button></div>'
      + (c.statut === 'traite' && c.traite_par ? '<div class="edit-hint" style="margin-top:6px;">Traité par ' + esc(nameOf(c.traite_par)) + (c.traite_le ? ' le ' + esc(fmtDT(c.traite_le)) : '') + '.</div>' : '')
      + '</div>';
    document.body.appendChild(ov);
    function close(){ ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e){ if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', async function(e){
      var t = e.target;
      if (t === ov || t.getAttribute('data-x')){ close(); return; }
      if (t.getAttribute('data-st')){
        var ns = c.statut === 'traite' ? 'nouveau' : 'traite';
        var r = await db().from('captures').update({ statut:ns }).eq('id', c.id).select('*').single();
        if (r && r.error){ toast('Refusé : ' + r.error.message, 'err'); return; }
        Object.assign(c, r.data); close(); renderBase(); return;
      }
      if (t.getAttribute('data-act')){ t.disabled = true; await createAction(c); close(); renderBase(); return; }
      if (t.getAttribute('data-del')){ close(); removeCapture(c, async function(){ await loadBase(); renderBase(); }); }
    });
  }
  async function createAction(c){
    var k = cat(c.categorie), lib = k.l + ' terrain : ' + (c.sujet || (c.description || '').slice(0, 80) || 'à préciser');
    var txt = [c.description, c.lieu ? 'Lieu : ' + c.lieu : '', 'Capture du ' + fmtDT(c.capture_le) + ' par ' + (c.auteur_nom || nameOf(c.auteur_email))].filter(Boolean).join('\n');
    var row = { libelle:lib.slice(0, 180), texte_brut:txt, thematique:'autre', projet:c.projet || null, statut:'a_faire', priorite:c.categorie === 'risque' || c.categorie === 'probleme' ? 1 : 2, pilote_id:null, tags:['capture'], commentaire:txt };
    try {
      var r = await db().from('actions').insert(row).select('id,numero').single();
      if (r && r.error){ var r2 = Object.assign({}, row); delete r2.tags; delete r2.commentaire; r = await db().from('actions').insert(r2).select('id,numero').single(); }
      if (r && r.error) throw r.error;
      var u = await db().from('captures').update({ action_id:r.data.id, statut:'traite' }).eq('id', c.id).select('*').single();
      if (u && !u.error) Object.assign(c, u.data);
      toast('Action #' + (r.data.numero || '') + ' créée dans Clap! (à attribuer à un pilote).', 'ok');
    } catch(e){ toast('Création de l’action impossible : ' + ((e && e.message) || e), 'err'); }
  }
  function csv(rows){
    var head = ['date', 'heure', 'auteur', 'email', 'categorie', 'sujet', 'projet', 'commentaire', 'lieu', 'latitude', 'longitude', 'precision_m', 'medias', 'statut', 'action_creee'];
    var q = function(v){ v = v == null ? '' : String(v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [head.join(';')].concat(rows.map(function(c){ var d = new Date(c.capture_le);
      return [d.toLocaleDateString('fr-FR'), d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }), c.auteur_nom || nameOf(c.auteur_email), c.auteur_email, cat(c.categorie).l, c.sujet, c.projet, c.description, c.lieu, c.lat, c.lng, c.precision_m,
        (c.medias || []).map(function(m){ return m.type; }).join('+'), c.statut === 'traite' ? 'traité' : 'à traiter', c.action_id ? 'oui' : 'non'].map(q).join(';'); }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'captures_' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- onglet du Cockpit et case de la matrice Admin ---------- */
  var COCKPIT = (typeof renderTab === 'function' && typeof render === 'function');
  if (COCKPIT){
    try { if (typeof tabDefault === 'function' && !tabDefault.__cap){ var _td = tabDefault; tabDefault = function(r, tab){ if (tab === 'capture') return r === 'eric' || r === 'cto'; return _td.apply(this, arguments); }; tabDefault.__cap = true; } } catch(e){}
    var _r = render;
    render = function(){ var out = _r.apply(this, arguments); K.ok = null; tabBtn(); return out; };
    var _rt = renderTab;
    renderTab = function(){
      var out = _rt.apply(this, arguments);
      try { if (typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB === 'capture'){ var v = $('view'); if (v) v.innerHTML = '<div class="panel" style="padding:14px 16px;margin-top:20px;">Chargement des captures…</div>'; loadBase().then(renderBase); } } catch(e){}
      return out;
    };
    if (typeof renderAdmin === 'function' && !renderAdmin.__cap){
      var _ra = renderAdmin;
      renderAdmin = function(){ var r = _ra.apply(this, arguments); var again = function(){ try { patchMatrix(); } catch(e){} }; Promise.resolve(r).then(function(){ setTimeout(again, 0); }, again); setTimeout(again, 350); return r; };
      renderAdmin.__cap = true;
    }
  }
  async function tabBtn(){
    var tabs = $('tabs'); if (!tabs || !db()) return;
    var ok = await canSeeAll(), old = tabs.querySelector('[data-tab="capture"]'); if (old) old.remove();
    if (!ok) return;
    var b = document.createElement('button'); b.className = 'tab'; b.dataset.tab = 'capture'; b.setAttribute('onclick', "switchTab('capture')"); b.textContent = 'Captures';
    var adm = tabs.querySelector('[data-tab="admin"]'); if (adm) tabs.insertBefore(b, adm); else tabs.appendChild(b);
    if (typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB === 'capture') b.classList.add('active');
  }
  function patchMatrix(){
    var zone = $('adminAccessZone'), table = zone && zone.querySelector('table'); if (!table) return;
    var head = table.querySelector('tr'), rows = [].slice.call(table.querySelectorAll('tr')).filter(function(tr){ return tr.querySelector('input[id^="acc_"][id$="_plandaction"]'); });
    if (!head || !rows.length) return;
    var idx = [].indexOf.call(rows[0].children, rows[0].querySelector('input[id$="_plandaction"]').closest('td'));
    if (!head.querySelector('[data-kw-cap]')){ var ref = head.children[idx]; if (!ref) return; var th = ref.cloneNode(false); th.textContent = 'Captures (tout voir)'; th.setAttribute('data-kw-cap', '1'); th.title = 'Onglet « Captures » du Cockpit : voir les captures de tout le monde (chacun voit toujours les siennes dans Clap!)'; ref.parentNode.insertBefore(th, ref.nextSibling); }
    rows.forEach(function(tr){
      var cb = tr.querySelector('input[id$="_plandaction"]'), m = /^acc_([a-z]+)_plandaction$/.exec(cb.id); if (!m || $('acc_' + m[1] + '_capture')) return;
      var td = cb.closest('td'), n = td.cloneNode(false), on = false; try { on = !!tabAllowed(m[1], 'capture'); } catch(e){}
      n.innerHTML = '<input type="checkbox" id="acc_' + m[1] + '_capture"' + (on ? ' checked' : '') + '>'; td.parentNode.insertBefore(n, td.nextSibling);
    });
  }
  window.kwCaptures = { reload:function(){ return loadBase().then(renderBase); }, state:K, clap:C };
})();
