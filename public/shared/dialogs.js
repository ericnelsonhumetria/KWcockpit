/* COCKPIT KW — Ergonomie, étape 2 : vrais dialogues + Admin (public/shared/dialogs.js)
   Additif : une seule ligne <script> dans index.html, après ux.js et avant session-restore.js. Retour arrière : retirer la ligne.
   FOURNIT (réutilisable par tous les modules, et par les prochaines pages à reprendre) :
     kwConfirm({title, message, confirmLabel, cancelLabel, danger})  → Promise<boolean>
     kwDialog({title, message, fields:[{name,label,type,value,options,required,placeholder,hint}], confirmLabel, cancelLabel}) → Promise<{…}|null>
   Accessibles : rôle « dialog », focus piégé dans la fenêtre puis rendu à l'élément d'origine, Échap annule, Entrée valide, validation en place.
   ADMIN : « ↻ MDP », « ✉ Renvoyer » et « Désactiver » passent par ces dialogues ; le mot de passe généré peut être copié. « + Nouvel utilisateur » (2 prompt, rôle
   saisi À LA MAIN : une faute donnait un rôle inconnu, traité comme « Commerce ») est RETIRÉ au profit de « Inviter un utilisateur » (la personne choisit son mot de passe).
   Dans le tableau des utilisateurs, les boutons n'insèrent plus l'adresse dans du code (les adresses avec apostrophe fonctionnent) ; les colonnes
   ajoutées par les autres modules (« Fonctions en plus », « Membre Codir ») sont conservées telles quelles.
   Les appels au serveur (adminCall) et les messages sont strictement ceux d'avant. */
(function(){
  'use strict';
  if (window.__kwDlg) return; window.__kwDlg = true;
  function el(tag, props, kids){
    var e = document.createElement(tag); props = props || {};
    Object.keys(props).forEach(function(k){ if (k === 'text') e.textContent = props[k]; else if (k === 'style') e.style.cssText = props[k]; else e.setAttribute(k, props[k]); });
    (kids || []).forEach(function(c){ if (c) e.appendChild(c); }); return e;
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  var CSS = ''
    + '#kwDlgOv{position:fixed;inset:0;background:rgba(30,10,12,.5);z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;}'
    + '.kwDlg{background:#fff;color:#2b1a1a;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.35);width:100%;max-width:440px;padding:20px 22px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;max-height:calc(100vh - 32px);overflow:auto;border-top:5px solid #560A0F;}'
    + '.kwDlg.danger{border-top-color:#c0392b;}'
    + '.kwDlg h2{margin:0 0 6px;font-size:17px;color:#560A0F;}.kwDlg .kwMsg{margin:0 0 12px;color:#4a3a38;white-space:pre-line;}'
    + '.kwDlg label{display:block;font-size:12px;font-weight:600;color:#6b5b58;margin:10px 0 3px;}'
    + '.kwDlg input,.kwDlg select{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:8px 10px;border:1px solid rgba(86,10,15,.35);border-radius:8px;background:#fff;color:#2b1a1a;}'
    + '.kwDlg .kwHint{font-size:12px;color:#6b5b58;margin-top:3px;}.kwDlg .kwErr{font-size:13px;color:#c0392b;font-weight:600;margin-top:10px;min-height:1px;}'
    + '.kwDlg .kwBtns{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;flex-wrap:wrap;}'
    + '.kwDlg .kwBtn{font:600 14px system-ui,sans-serif;padding:9px 16px;border-radius:8px;border:1px solid #560A0F;background:#560A0F;color:#fff;cursor:pointer;}'
    + '.kwDlg .kwBtn.ghost{background:#fff;color:#560A0F;}.kwDlg.danger .kwBtn:not(.ghost){background:#c0392b;border-color:#c0392b;}'
    + '.kwDlg .kwBtn:disabled{opacity:.55;cursor:default;}';
  function addCss(){ if (document.getElementById('kwDlgCss')) return; var s = el('style', { id:'kwDlgCss' }); s.textContent = CSS; document.head.appendChild(s); }

  var current = null;
  function open(opt){
    addCss(); if (current) current.close(null);
    return new Promise(function(resolve){
      var fields = opt.fields || [], prev = document.activeElement, uid = 'kwd' + Date.now();
      var ov = el('div', { id:'kwDlgOv' });
      var box = el('div', { 'class':'kwDlg' + (opt.danger ? ' danger' : ''), role:'dialog', 'aria-modal':'true', 'aria-labelledby':uid + 't' });
      box.appendChild(el('h2', { id:uid + 't', text:opt.title || '' }));
      if (opt.message) box.appendChild(el('p', { 'class':'kwMsg', text:opt.message }));
      var inputs = {};
      fields.forEach(function(f, i){
        var id = uid + 'f' + i; box.appendChild(el('label', { 'for':id, text:f.label + (f.required ? ' *' : '') }));
        var inp;
        if (f.type === 'select'){ inp = el('select', { id:id }); (f.options || []).forEach(function(o){ var op = el('option', { value:o, text:o }); if (o === f.value) op.selected = true; inp.appendChild(op); }); }
        else { inp = el('input', { id:id, type:f.type || 'text' }); if (f.value != null) inp.value = f.value; if (f.placeholder) inp.setAttribute('placeholder', f.placeholder); inp.setAttribute('autocomplete', 'off'); }
        if (f.required) inp.setAttribute('aria-required', 'true');
        inputs[f.name] = inp; box.appendChild(inp);
        if (f.hint) box.appendChild(el('div', { 'class':'kwHint', text:f.hint }));
      });
      var err = el('div', { 'class':'kwErr', role:'alert' }); box.appendChild(err);
      var ok = el('button', { type:'button', 'class':'kwBtn', text:opt.confirmLabel || 'Valider' });
      var ko = el('button', { type:'button', 'class':'kwBtn ghost', text:opt.cancelLabel || 'Annuler' });
      box.appendChild(el('div', { 'class':'kwBtns' }, [ko, ok])); ov.appendChild(box); document.body.appendChild(ov);
      function close(v){
        document.removeEventListener('keydown', onKey, true); if (ov.parentNode) ov.parentNode.removeChild(ov); current = null;
        try { if (prev && prev.focus) prev.focus(); } catch(e){}
        resolve(v);
      }
      function submit(){
        var vals = {};
        for (var i = 0; i < fields.length; i++){
          var f = fields[i], v = inputs[f.name].value; if (f.type !== 'select') v = v.trim();
          if (f.required && !v){ err.textContent = f.label + ' : champ obligatoire.'; inputs[f.name].focus(); return; }
          if (f.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)){ err.textContent = 'Adresse e-mail invalide.'; inputs[f.name].focus(); return; }
          vals[f.name] = v;
        }
        close(fields.length ? vals : true);
      }
      function onKey(ev){
        if (ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); close(fields.length ? null : false); return; }
        if (ev.key === 'Enter' && ev.target && ev.target.tagName === 'INPUT'){ ev.preventDefault(); submit(); return; }
        if (ev.key === 'Tab'){
          var f = [].slice.call(box.querySelectorAll('input,select,button')).filter(function(x){ return !x.disabled; }); if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (ev.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))){ ev.preventDefault(); last.focus(); }
          else if (!ev.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))){ ev.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      ok.addEventListener('click', submit); ko.addEventListener('click', function(){ close(fields.length ? null : false); });
      if (!fields.length) ov.addEventListener('mousedown', function(ev){ if (ev.target === ov) close(false); });   /* confirmation : clic à côté = annuler ; formulaire : jamais (on ne perd pas la saisie) */
      current = { close: close };
      var firstField = fields.length ? inputs[fields[0].name] : (opt.danger ? ko : ok); setTimeout(function(){ try { firstField.focus(); } catch(e){} }, 0);
    });
  }
  window.kwDialog = function(opt){ return open(opt || {}); };
  window.kwConfirm = function(opt){ if (typeof opt === 'string') opt = { message:opt }; return open({ title:opt.title || 'Confirmer', message:opt.message, confirmLabel:opt.confirmLabel || 'Confirmer', cancelLabel:opt.cancelLabel, danger:!!opt.danger }); };

  /* Copier un texte (mot de passe généré) */
  window.kwCopy = function(btn){
    var t = btn && btn.getAttribute('data-copy') || '';
    function done(){ if (window.kwToast) window.kwToast('Copié dans le presse-papiers ✓', 'ok'); }
    try { if (navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(done, function(){ fallback(); }); return false; } } catch(e){}
    fallback();
    function fallback(){ try { var ta = el('textarea', { style:'position:fixed;left:-9999px;' }); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch(e){} }
    return false;
  };
  function pwdBox(pwd){ return '<code style="background:#fff;padding:2px 8px;border-radius:4px;">' + esc(pwd) + '</code> <button type="button" class="add-btn sm" data-copy="' + esc(pwd) + '" onclick="return kwCopy(this)">Copier</button>'; }

  /* ---------- Admin ---------- */
  function admin(){
    if (typeof adminCall !== 'function' || typeof adminMsg !== 'function') return;
    window.adminReset = async function(id, email){
      var yes = await kwConfirm({ title:'Réinitialiser le mot de passe', message:'Un nouveau mot de passe sera généré pour ' + email + '. L\u2019ancien ne fonctionnera plus.', confirmLabel:'Réinitialiser', danger:true });
      if (!yes) return;
      var res = await adminCall({ action:'reset_password', id:id }), data = res.data || {};
      if (res.ok && data.nouveauMotDePasse){ adminMsg('✓ Nouveau mot de passe pour <b>' + esc(email) + '</b> : ' + pwdBox(data.nouveauMotDePasse) + '<br><span style="font-weight:400;">Transmettez-le à la personne — il ne sera plus affiché. Elle pourra le changer ensuite.</span>'); }
      else { adminMsg('⚠ Échec de la réinitialisation'); }
    };
    window.adminRecovery = async function(email){
      var yes = await kwConfirm({ title:'Renvoyer un e-mail', message:'Envoyer à ' + email + ' un e-mail pour réinitialiser son mot de passe ?', confirmLabel:'Envoyer' });
      if (!yes) return;
      var res = await adminCall({ action:'recovery', email:email }), data = res.data || {};
      if (res.ok) adminMsg('✓ E-mail de réinitialisation envoyé à <b>' + esc(email) + '</b>.');
      else adminMsg('✗ Échec de l\u2019envoi' + (data.error ? ' : ' + esc(data.error) : ''));
    };
    window.adminToggle = async function(id, desactiver){
      if (desactiver){
        var yes = await kwConfirm({ title:'Désactiver ce compte', message:'La personne ne pourra plus se connecter. Vous pourrez le réactiver à tout moment.', confirmLabel:'Désactiver', danger:true });
        if (!yes) return;
      }
      var res = await adminCall({ action:'toggle_active', id:id, desactiver:desactiver });
      if (res.ok){ if (typeof loadAdmin === 'function') loadAdmin(); } else adminMsg('⚠ Échec');
    };

    /* « + Nouvel utilisateur » (mot de passe à transmettre) est retiré : on invite par e-mail, la personne choisit elle-même son mot de passe. */
    function goInvite(){ var f = document.getElementById('invEmail'); if (!f) return; try { f.scrollIntoView({ behavior:'smooth', block:'center' }); } catch(e){} f.focus(); }
    window.adminNouveau = goInvite;       /* tout appel résiduel mène au formulaire d'invitation (et ne crée plus de compte avec mot de passe initial) */

    /* Tableau des utilisateurs : on NE le reconstruit PAS (d'autres modules y ajoutent des colonnes : « Fonctions en plus », « Membre Codir »).
       On remplace seulement les gestionnaires écrits dans le HTML (onclick="adminReset('id','o'neil@…')", où une apostrophe cassait le code) par des
       écouteurs qui reçoivent l'identifiant et l'adresse tels quels. Les lignes suivent l'ordre de la liste des utilisateurs. Idempotent. */
    function rebindUsers(users){
      var zone = document.getElementById('adminZone'); if (!zone) return;
      [].slice.call(zone.querySelectorAll('table tbody tr')).forEach(function(tr, i){
        var u = (users || [])[i]; if (!u) return;
        var b = tr.querySelector('td b'); if (b && b.textContent !== String(u.email)) b.textContent = u.email;      /* texte, jamais du code */
        var sel = tr.querySelector('select'), chk = tr.querySelector('.adm-admin');
        if (sel && !sel.__kwb){ sel.__kwb = true; sel.removeAttribute('onchange'); sel.setAttribute('aria-label', 'Rôle de ' + u.email);
          sel.addEventListener('change', function(){ window.adminSetRole(u.email, sel.value, chk ? chk.checked : false); }); }
        if (chk && !chk.__kwb){ chk.__kwb = true; chk.removeAttribute('onchange');
          chk.addEventListener('change', function(){ window.adminSetRole(u.email, sel ? sel.value : '', chk.checked); }); }
        [].slice.call(tr.querySelectorAll('button')).forEach(function(btn){
          var code = btn.getAttribute('onclick') || '', fn = /adminReset\(/.test(code) ? 'reset' : /adminRecovery\(/.test(code) ? 'rec' : /adminToggle\(/.test(code) ? 'tog' : '';
          if (!fn || btn.__kwb) return; btn.__kwb = true; btn.removeAttribute('onclick');
          btn.addEventListener('click', function(){
            if (fn === 'reset') window.adminReset(u.id, u.email); else if (fn === 'rec') window.adminRecovery(u.email); else window.adminToggle(u.id, !u.desactive);
          });
        });
      });
      var old = zone.querySelector('button[onclick="adminNouveau()"]');
      if (old){ var nb = el('button', { type:'button', 'class':'add-btn', text:'+ Inviter un utilisateur' }); nb.addEventListener('click', goInvite); old.parentNode.replaceChild(nb, old); }
    }
    window.kwRebindUsers = rebindUsers;
    if (typeof renderAdmin === 'function' && !renderAdmin.__kwDlg){
      var _ra = renderAdmin;
      renderAdmin = function(users){ var r = _ra.apply(this, arguments); try { rebindUsers(users); } catch(e){ if (window.console) console.error('rebindUsers', e); } return r; };
      renderAdmin.__kwDlg = true;
    }
  }
  admin();
  window.kwDialogsReady = true;
})();
