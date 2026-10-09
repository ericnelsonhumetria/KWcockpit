/* COCKPIT KW — Module AIC (public/shared/aic.js)
   Brique 1 : référentiel des thématiques et indicateurs par niveau, dans l'onglet Admin.
   Additif : enrobe renderTab() sans le modifier. Aucune suppression : un élément est désactivé, jamais effacé. */
(function(){
  if (typeof renderTab !== 'function') return;

  var NIVEAUX = [1, 2, 3];
  var NIV_LBL = { 1:'AIC 1 · CEO', 2:'AIC 2 · Resp. programme', 3:'AIC 3 · Chef de projet site' };
  var FREQ = [['quotidien','Quotidien'], ['hebdo','Hebdomadaire'], ['mensuel','Mensuel']];
  var AIC = { them:[], ind:[], msg:'' };

  function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function db(){ return (typeof SB !== 'undefined' && SB) ? SB : null; }
  function val(id){ var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function chk(id){ var el = document.getElementById(id); return !!(el && el.checked); }
  function niveauxDe(prefix){ return NIVEAUX.filter(function(n){ return chk(prefix + n); }); }
  /* Une modification bloquée par la RLS renvoie 0 ligne SANS erreur : on exige au moins une ligne touchée. */
  function touched(r, table){
    if (r && r.error) throw r.error;
    if (!r || !r.data || !r.data.length) throw new Error('aucune ligne modifiée : droit d\u2019écriture refusé par la base (' + table + ')');
    return r;
  }
  function flash(id, ok, txt){ var el = document.getElementById(id); if(!el) return; el.style.color = ok ? '#1e7d34' : '#9a3412'; el.textContent = txt; if(ok) setTimeout(function(){ if(el.textContent === txt) el.textContent = ''; }, 2500); }

  /* ---------- Montage dans l'onglet Admin ---------- */
  var _rtAic = renderTab;
  renderTab = function(){
    _rtAic.apply(this, arguments);
    try { if (typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB === 'admin') aicMountAdmin(); } catch(e){}
  };
  function aicMountAdmin(){
    var z = document.getElementById('adminZone');
    if (!z || document.getElementById('aicAdmin')) return;
    var d = document.createElement('div'); d.id = 'aicAdmin'; d.style.marginTop = '22px';
    z.insertAdjacentElement('afterend', d);
    aicLoad();
  }

  async function aicLoad(){
    var d = document.getElementById('aicAdmin'); if (!d) return;
    d.innerHTML = head() + '<div class="panel" style="padding:14px 16px;">Chargement du référentiel AIC…</div>';
    try {
      if (!db()) throw new Error('Supabase non initialisé');
      var a = await db().from('aic_thematiques').select('*').order('ordre', { ascending:true }).order('libelle', { ascending:true });
      if (a.error) throw a.error;
      var b = await db().from('aic_indicateurs').select('*').order('ordre', { ascending:true }).order('libelle', { ascending:true });
      if (b.error) throw b.error;
      AIC.them = a.data || []; AIC.ind = b.data || []; AIC.msg = '';
    } catch(e){
      var m = (e && e.message) || String(e);
      AIC.msg = 'Référentiel AIC indisponible : ' + m + (/relation|does not exist|schema cache/i.test(m) ? ' — exécutez d\u2019abord le SQL de la brique 1.' : '');
    }
    render();
  }

  /* ---------- Rendu ---------- */
  function head(){
    return '<div class="sec-eyebrow">AIC</div><div class="sec-title">Référentiel des thématiques et indicateurs</div>'
      + '<div class="sec-note">Standards proposés dans les espaces AIC, par niveau. Un élément désactivé n\u2019est plus proposé mais reste visible dans les archives.</div>';
  }
  function nivBoxes(prefix, niveaux){
    var cur = Array.isArray(niveaux) ? niveaux : NIVEAUX;
    return NIVEAUX.map(function(n){
      return '<label title="' + esc(NIV_LBL[n]) + '" style="display:inline-flex;align-items:center;gap:3px;margin-right:8px;font-size:12px;white-space:nowrap;">'
        + '<input type="checkbox" id="' + prefix + n + '"' + (cur.indexOf(n) >= 0 ? ' checked' : '') + ' style="width:auto;margin:0;">AIC ' + n + '</label>';
    }).join('');
  }
  var INP = 'height:34px;padding:0 8px;border:1px solid rgba(86,10,15,.25);border-radius:6px;font-size:13px;box-sizing:border-box;';

  function themRow(t, i, n){
    var id = t ? t.id : 'new';
    var dis = (t && !t.actif) ? 'opacity:.55;' : '';
    return '<tr style="' + dis + '">'
      + '<td style="white-space:nowrap;">' + (t ? ('<button type="button" class="add-btn sm ghost" onclick="aicThemMove(\'' + id + '\',-1)"' + (i === 0 ? ' disabled' : '') + ' aria-label="Monter">&#9650;</button> <button type="button" class="add-btn sm ghost" onclick="aicThemMove(\'' + id + '\',1)"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="Descendre">&#9660;</button>') : '') + '</td>'
      + '<td><input id="tc_' + id + '" value="' + esc(t ? t.code : '') + '" placeholder="ex. S" maxlength="8" aria-label="Code" style="' + INP + 'width:70px;text-transform:uppercase;"></td>'
      + '<td><input id="tl_' + id + '" value="' + esc(t ? t.libelle : '') + '" placeholder="ex. Sécurité" aria-label="Libellé" style="' + INP + 'width:100%;min-width:140px;"></td>'
      + '<td><input id="tk_' + id + '" type="color" value="' + esc(t ? t.couleur : '#560A0F') + '" aria-label="Couleur" style="width:44px;height:34px;padding:2px;border:1px solid rgba(86,10,15,.25);border-radius:6px;"></td>'
      + '<td>' + nivBoxes('tn_' + id + '_', t ? t.niveaux : NIVEAUX) + '</td>'
      + '<td>' + (t ? ('<label style="font-size:12px;"><input type="checkbox" id="ta_' + id + '"' + (t.actif ? ' checked' : '') + ' style="width:auto;margin:0 4px 0 0;">actif</label>') : '') + '</td>'
      + '<td style="white-space:nowrap;"><button type="button" class="add-btn sm" onclick="aicThemSave(\'' + id + '\')">' + (t ? 'Enregistrer' : '+ Ajouter') + '</button>' + (t ? ' <button type="button" class="add-btn sm ghost" onclick="aicPaveOpen(\'' + id + '\')" title="Choisir le contenu du pavé SQCDP de cette thématique">🎛 Pavé</button>' : '') + ' <span id="tm_' + id + '" role="status" style="font-size:12px;"></span></td>'
      + '</tr>';
  }

  function indRow(x, th, i, n){
    var id = x ? x.id : ('new_' + th.id);
    var dis = (x && !x.actif) ? 'opacity:.55;' : '';
    var sens = x ? x.sens : 'haut', freq = x ? x.frequence : 'hebdo';
    return '<tr style="' + dis + '">'
      + '<td style="white-space:nowrap;">' + (x ? ('<button type="button" class="add-btn sm ghost" onclick="aicIndMove(\'' + id + '\',-1)"' + (i === 0 ? ' disabled' : '') + ' aria-label="Monter">&#9650;</button> <button type="button" class="add-btn sm ghost" onclick="aicIndMove(\'' + id + '\',1)"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="Descendre">&#9660;</button>') : '') + '</td>'
      + '<td><input id="il_' + id + '" value="' + esc(x ? x.libelle : '') + '" placeholder="ex. Taux de fréquence accidents" aria-label="Libellé" style="' + INP + 'width:100%;min-width:180px;"></td>'
      + '<td><input id="iu_' + id + '" value="' + esc(x ? x.unite : '') + '" placeholder="%, nb, €…" aria-label="Unité" style="' + INP + 'width:80px;"></td>'
      + '<td><input id="ic_' + id + '" value="' + esc(x && x.cible != null ? x.cible : '') + '" placeholder="cible" inputmode="decimal" aria-label="Cible" style="' + INP + 'width:80px;"></td>'
      + '<td><select id="is_' + id + '" aria-label="Sens" style="' + INP + '"><option value="haut"' + (sens !== 'bas' ? ' selected' : '') + '>↑ plus haut = mieux</option><option value="bas"' + (sens === 'bas' ? ' selected' : '') + '>↓ plus bas = mieux</option></select></td>'
      + '<td><select id="if_' + id + '" aria-label="Fréquence" style="' + INP + '">' + FREQ.map(function(f){ return '<option value="' + f[0] + '"' + (freq === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select></td>'
      + '<td>' + nivBoxes('in_' + id + '_', x ? x.niveaux : (th.niveaux || NIVEAUX)) + '</td>'
      + '<td>' + (x ? ('<label style="font-size:12px;"><input type="checkbox" id="ia_' + id + '"' + (x.actif ? ' checked' : '') + ' style="width:auto;margin:0 4px 0 0;">actif</label>') : '') + '</td>'
      + '<td style="white-space:nowrap;"><button type="button" class="add-btn sm" onclick="aicIndSave(\'' + id + '\',\'' + th.id + '\')">' + (x ? 'Enregistrer' : '+ Ajouter') + '</button> <span id="im_' + id + '" role="status" style="font-size:12px;"></span></td>'
      + '</tr>';
  }

  function render(){
    var d = document.getElementById('aicAdmin'); if (!d) return;
    if (AIC.msg){ d.innerHTML = head() + '<div class="panel" style="padding:14px 16px;color:var(--signal);">' + esc(AIC.msg) + '</div>'; return; }
    var them = AIC.them;
    var thead = '<thead><tr><th></th><th>Code</th><th>Libellé</th><th>Couleur</th><th>Niveaux</th><th>État</th><th></th></tr></thead>';
    var tTable = '<div class="panel" style="padding:10px 16px 16px;overflow-x:auto;"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div class="field-label">Thématiques</div><button type="button" class="add-btn" onclick="aicThemSaveAll()">✓ Valider les modifications</button><span id="tm_all" role="status" style="font-size:12px;"></span></div><table style="width:100%;">' + thead + '<tbody>'
      + them.map(function(t, i){ return themRow(t, i, them.length); }).join('') + themRow(null, 0, 0) + '</tbody></table></div>';
    var blocks = them.map(function(th){
      var list = AIC.ind.filter(function(x){ return x.thematique_id === th.id; });
      var ih = '<thead><tr><th></th><th>Indicateur</th><th>Unité</th><th>Cible</th><th>Sens</th><th>Fréquence</th><th>Niveaux</th><th>État</th><th></th></tr></thead>';
      return '<div class="panel" style="padding:10px 16px 16px;margin-top:12px;overflow-x:auto;' + (th.actif ? '' : 'opacity:.6;') + '">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="width:12px;height:12px;border-radius:3px;background:' + esc(th.couleur) + ';display:inline-block;"></span><b>' + esc(th.code) + ' · ' + esc(th.libelle) + '</b><span class="sub-cell">' + list.length + ' indicateur(s)</span>' + (th.actif ? '' : '<span class="pill p-grey">désactivée</span>') + '<button type="button" class="add-btn sm" style="margin-left:auto;" onclick="aicIndSaveAll(\'' + th.id + '\')">✓ Valider les modifications</button><span id="ia_all_' + th.id + '" role="status" style="font-size:12px;"></span></div>'
        + '<table style="width:100%;">' + ih + '<tbody>' + list.map(function(x, i){ return indRow(x, th, i, list.length); }).join('') + indRow(null, th, 0, 0) + '</tbody></table></div>';
    }).join('');
    d.innerHTML = head() + tTable + '<div id="aicPave"></div>' + (them.length ? '<div class="field-label" style="margin-top:18px;">Indicateurs par thématique</div>' + blocks : '');
    if (AIC.paveId) aicPaveRender(AIC.paveId);
  }

  /* ---------- Thématiques ---------- */
  function soft(msg){ var e = new Error(msg); e.soft = true; return e; }                 /* erreur de saisie, sans préfixe « Refusé » */
  function errTxt(e){ return (e && e.soft) ? e.message : ('Refusé : ' + ((e && e.message) || e)); }
  function sameNiv(a, b){ return JSON.stringify((a || []).slice().sort()) === JSON.stringify((b || []).slice().sort()); }

  /* La ligne a-t-elle été modifiée par rapport à ce qui est en base ? */
  function themDirty(id){
    if (id === 'new') return !!(val('tc_new') || val('tl_new'));
    var t = AIC.them.filter(function(x){ return x.id === id; })[0]; if (!t) return false;
    return val('tc_' + id).toUpperCase() !== t.code || val('tl_' + id) !== t.libelle || (val('tk_' + id) || '#560A0F').toLowerCase() !== String(t.couleur || '').toLowerCase()
      || !sameNiv(niveauxDe('tn_' + id + '_'), t.niveaux) || chk('ta_' + id) !== !!t.actif;
  }
  /* Valide et écrit UNE ligne ; lève une erreur sinon. Ne recharge pas. */
  async function themSaveOne(id){
    var code = val('tc_' + id).toUpperCase(), lib = val('tl_' + id), col = val('tk_' + id) || '#560A0F', niv = niveauxDe('tn_' + id + '_');
    if (!code || !lib) throw soft('Code et libellé obligatoires.');
    if (!niv.length) throw soft('Cochez au moins un niveau.');
    if (AIC.them.some(function(t){ return t.code === code && t.id !== id; })) throw soft('Ce code existe déjà.');
    var row = { code:code, libelle:lib, couleur:col, niveaux:niv, updated_at:new Date().toISOString() }, r;
    if (id === 'new'){ row.ordre = (AIC.them.length + 1) * 10; r = await db().from('aic_thematiques').insert(row); if (r.error) throw r.error; }
    else { row.actif = chk('ta_' + id); touched(await db().from('aic_thematiques').update(row).eq('id', id).select('id'), 'aic_thematiques'); }
  }
  window.aicThemSave = async function(id){
    try { await themSaveOne(id); await aicLoad(); flash('tm_' + id, true, '✓ Enregistré'); }
    catch(e){ flash('tm_' + id, false, errTxt(e)); }
  };
  /* Bouton « Valider » : enregistre toutes les lignes modifiées, puis recharge une seule fois.
     En cas d'erreur sur une ligne, rien n'est rechargé : les saisies restent à l'écran. */
  window.aicThemSaveAll = async function(){
    var ids = AIC.them.map(function(t){ return t.id; }).filter(themDirty); if (themDirty('new')) ids.push('new');
    if (!ids.length){ flash('tm_all', true, 'Aucune modification à valider.'); return; }
    var ok = 0, errs = [];
    for (var i = 0; i < ids.length; i++){
      try { await themSaveOne(ids[i]); ok++; }
      catch(e){ var t = AIC.them.filter(function(x){ return x.id === ids[i]; })[0]; errs.push((t ? t.code : (val('tc_new').toUpperCase() || 'nouvelle ligne')) + ' : ' + errTxt(e)); }
    }
    if (errs.length){ flash('tm_all', false, ok + ' enregistrée(s), ' + errs.length + ' en erreur — ' + errs.join(' | ')); return; }
    await aicLoad(); flash('tm_all', true, '✓ ' + ok + ' ligne(s) validée(s)');
  };
  window.aicThemMove = async function(id, dir){
    var L = AIC.them.slice(), i = L.findIndex(function(t){ return t.id === id; }), j = i + dir;
    if (i < 0 || j < 0 || j >= L.length) return;
    var tmp = L[i]; L[i] = L[j]; L[j] = tmp;
    try { for (var k = 0; k < L.length; k++){ var r = touched(await db().from('aic_thematiques').update({ ordre:(k + 1) * 10 }).eq('id', L[k].id).select('id'), 'aic_thematiques'); } await aicLoad(); }
    catch(e){ alert('Réordonnancement refusé : ' + ((e && e.message) || e)); }
  };

  /* ---------- Indicateurs ---------- */
  function indDirty(id, thId){
    if (id.indexOf('new_') === 0) return !!val('il_' + id);
    var x = AIC.ind.filter(function(y){ return y.id === id; })[0]; if (!x) return false;
    var ct = val('ic_' + id).replace(',', '.'), cx = (x.cible == null ? '' : String(x.cible));
    return val('il_' + id) !== x.libelle || val('iu_' + id) !== (x.unite || '') || (ct !== '' ? parseFloat(ct) : '') !== (cx !== '' ? parseFloat(cx) : '')
      || (val('is_' + id) || 'haut') !== x.sens || (val('if_' + id) || 'hebdo') !== x.frequence || !sameNiv(niveauxDe('in_' + id + '_'), x.niveaux) || chk('ia_' + id) !== !!x.actif;
  }
  async function indSaveOne(id, thId){
    var lib = val('il_' + id), unite = val('iu_' + id), cibleTxt = val('ic_' + id).replace(',', '.');
    var sens = val('is_' + id) || 'haut', freq = val('if_' + id) || 'hebdo', niv = niveauxDe('in_' + id + '_');
    if (!lib) throw soft('Libellé obligatoire.');
    if (!niv.length) throw soft('Cochez au moins un niveau.');
    var cible = null; if (cibleTxt !== ''){ cible = parseFloat(cibleTxt); if (isNaN(cible)) throw soft('Cible : nombre attendu.'); }
    var row = { libelle:lib, unite:unite, cible:cible, sens:sens, frequence:freq, niveaux:niv, updated_at:new Date().toISOString() }, r;
    if (id.indexOf('new_') === 0){ row.thematique_id = thId; row.ordre = (AIC.ind.filter(function(x){ return x.thematique_id === thId; }).length + 1) * 10; r = await db().from('aic_indicateurs').insert(row); if (r.error) throw r.error; }
    else { row.actif = chk('ia_' + id); touched(await db().from('aic_indicateurs').update(row).eq('id', id).select('id'), 'aic_indicateurs'); }
  }
  window.aicIndSave = async function(id, thId){
    try { await indSaveOne(id, thId); await aicLoad(); flash('im_' + id, true, '✓ Enregistré'); }
    catch(e){ flash('im_' + id, false, errTxt(e)); }
  };
  window.aicIndSaveAll = async function(thId){
    var ids = AIC.ind.filter(function(x){ return x.thematique_id === thId; }).map(function(x){ return x.id; }).filter(function(i){ return indDirty(i, thId); });
    if (indDirty('new_' + thId, thId)) ids.push('new_' + thId);
    var mid = 'ia_all_' + thId;
    if (!ids.length){ flash(mid, true, 'Aucune modification à valider.'); return; }
    var ok = 0, errs = [];
    for (var i = 0; i < ids.length; i++){
      try { await indSaveOne(ids[i], thId); ok++; }
      catch(e){ var x = AIC.ind.filter(function(y){ return y.id === ids[i]; })[0]; errs.push((x ? x.libelle : (val('il_' + ids[i]) || 'nouvelle ligne')) + ' : ' + errTxt(e)); }
    }
    if (errs.length){ flash(mid, false, ok + ' enregistré(s), ' + errs.length + ' en erreur — ' + errs.join(' | ')); return; }
    await aicLoad(); flash(mid, true, '✓ ' + ok + ' ligne(s) validée(s)');
  };
  window.aicIndMove = async function(id, dir){
    var cur = AIC.ind.find(function(x){ return x.id === id; }); if (!cur) return;
    var L = AIC.ind.filter(function(x){ return x.thematique_id === cur.thematique_id; }), i = L.findIndex(function(x){ return x.id === id; }), j = i + dir;
    if (i < 0 || j < 0 || j >= L.length) return;
    var tmp = L[i]; L[i] = L[j]; L[j] = tmp;
    try { for (var k = 0; k < L.length; k++){ var r = touched(await db().from('aic_indicateurs').update({ ordre:(k + 1) * 10 }).eq('id', L[k].id).select('id'), 'aic_indicateurs'); } await aicLoad(); }
    catch(e){ alert('Réordonnancement refusé : ' + ((e && e.message) || e)); }
  };

  /* ---------- Pavé SQCDP : contenu affiché par thématique (défini ici, appliqué à tous les espaces) ---------- */
  function paveNorm(c){
    c = (c && typeof c === 'object') ? c : {}; var p = c.pave || {}, k = c.courbe || {};
    return { pave:{ statut:p.statut !== false, indic:p.indic !== false, tend:p.tend !== false, courbe:p.courbe !== false, bande:p.bande !== false },
             ind:c.ind_principal || '', courbe:{ metric:k.metric || 'auto', jours:[7, 30, 90].indexOf(k.jours) >= 0 ? k.jours : 30, cible:k.cible !== false, moyenne:!!k.moyenne } };
  }
  function pvFace(st, size){ var col = st === 'vert' ? '#2e7d46' : st === 'orange' ? '#e08a00' : st === 'rouge' ? '#c0392b' : '#bdb5ad', m = st === 'vert' ? 'M30 62 Q50 84 70 62' : st === 'orange' ? 'M32 68 L68 68' : 'M30 76 Q50 54 70 76'; return '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="' + col + '"/><circle cx="34" cy="40" r="6" fill="#fff"/><circle cx="66" cy="40" r="6" fill="#fff"/><path d="' + m + '" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/></svg>'; }
  function pvArrow(size){ return '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '" aria-hidden="true"><g transform="rotate(45 50 50)"><path d="M16 50 H80 M54 24 L82 50 L54 76" stroke="#2e7d46" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></svg>'; }
  function pvSpark(col){ var v = [5, 4.2, 4.6, 3.4, 3.8, 2.6, 2.9, 1.8, 2.1, 1.3], pts = v.map(function(y, i){ return (4 + 152 * i / 9).toFixed(1) + ',' + (4 + 28 * (1 - (y - 1) / 4)).toFixed(1); }); return '<svg viewBox="0 0 160 36" width="160" height="36" aria-hidden="true"><polyline fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linejoin="round" points="' + pts.join(' ') + '"/><circle cx="' + pts[9].split(',')[0] + '" cy="' + pts[9].split(',')[1] + '" r="3.5" fill="' + col + '"/></svg>'; }
  window.aicPaveOpen = function(id){ AIC.paveId = id; aicPaveRender(id); var z = document.getElementById('aicPave'); if (z && z.scrollIntoView) z.scrollIntoView({ behavior:'smooth', block:'nearest' }); };
  window.aicPaveClose = function(){ AIC.paveId = null; var z = document.getElementById('aicPave'); if (z) z.innerHTML = ''; };
  function aicPaveRender(id){
    var z = document.getElementById('aicPave'); if (!z) return;
    var t = AIC.them.filter(function(x){ return x.id === id; })[0]; if (!t){ AIC.paveId = null; z.innerHTML = ''; return; }
    var c = paveNorm(t.config), inds = AIC.ind.filter(function(x){ return x.thematique_id === id && x.actif; });
    function opt(v, l, sel){ return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>'; }
    function cb(i, l, on){ return '<label style="display:inline-flex;gap:6px;align-items:center;font-size:13px;margin:4px 16px 4px 0;"><input type="checkbox" id="' + i + '"' + (on ? ' checked' : '') + ' onchange="aicPavePreview()" style="width:auto;margin:0;">' + l + '</label>'; }
    var SEL = INP + 'min-width:230px;';
    z.innerHTML = '<div class="panel" style="padding:12px 16px 16px;margin-top:12px;border-left:5px solid ' + esc(t.couleur) + ';">'
      + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><b>🎛 Pavé SQCDP · ' + esc(t.code) + ' · ' + esc(t.libelle) + '</b><button type="button" class="add-btn sm ghost" style="margin-left:auto;" onclick="aicPaveClose()">Fermer</button></div>'
      + '<div class="sec-note" style="margin:4px 0 8px;">Choisissez ce que le pavé de cette thématique affiche dans le tableau SQCDP de tous les espaces. Chaque utilisateur peut ajuster la courbe pour lui seul ; « ↺ Réglage Admin » rétablit ce défaut.</div>'
      + '<div style="display:flex;gap:28px;flex-wrap:wrap;"><div style="flex:1;min-width:300px;">'
      + '<div class="field-label">Blocs affichés dans le pavé</div>' + cb('pv_statut', 'Statut du jour (smiley + couleur)', c.pave.statut) + cb('pv_indic', 'Indicateur principal (valeur + cible)', c.pave.indic) + cb('pv_tend', 'Tendance (flèche)', c.pave.tend) + cb('pv_courbe', 'Mini-courbe', c.pave.courbe) + cb('pv_bande', 'Bande du mois', c.pave.bande)
      + '<div class="field-label" style="margin-top:10px;">Indicateur principal</div><select id="pv_ind" onchange="aicPavePreview()" aria-label="Indicateur principal" style="' + SEL + '">' + opt('', 'Premier de la liste (automatique)', !c.ind) + inds.map(function(x){ return opt(x.id, x.libelle + (x.unite ? ' (' + x.unite + ')' : ''), c.ind === x.id); }).join('') + '</select>'
      + '<div class="field-label" style="margin-top:10px;">Contenu de la courbe</div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><select id="pv_cm" onchange="aicPavePreview()" aria-label="Contenu de la courbe" style="' + SEL + '">' + opt('auto', 'Indicateur principal', c.courbe.metric === 'auto') + opt('statut', 'Statut SQCDP (vert / orange / rouge)', c.courbe.metric === 'statut') + inds.map(function(x){ return opt(x.id, x.libelle, c.courbe.metric === x.id); }).join('') + '</select>'
      + '<select id="pv_jours" onchange="aicPavePreview()" aria-label="Période" style="' + INP + '">' + [7, 30, 90].map(function(n){ return opt(String(n), n + ' jours', c.courbe.jours === n); }).join('') + '</select></div>'
      + '<div style="margin-top:4px;">' + cb('pv_cible', 'Afficher la cible', c.courbe.cible) + cb('pv_avg', 'Moyenne sur 7 jours', c.courbe.moyenne) + '</div>'
      + '</div><div style="min-width:230px;"><div class="field-label">Aperçu du pavé</div><div id="pv_prev"></div></div></div>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px;"><button type="button" class="add-btn" onclick="aicPaveSave(\'' + id + '\')">✓ Valider le pavé</button><button type="button" class="add-btn sm ghost" onclick="aicPaveReset(\'' + id + '\')">Rétablir le défaut</button><span id="pv_msg" role="status" style="font-size:12px;"></span></div></div>';
    aicPavePreview();
  }
  window.aicPavePreview = function(){
    var box = document.getElementById('pv_prev'), t = AIC.them.filter(function(x){ return x.id === AIC.paveId; })[0]; if (!box || !t) return;
    var inds = AIC.ind.filter(function(x){ return x.thematique_id === t.id && x.actif; }), pick = val('pv_ind'), pr = inds.filter(function(x){ return x.id === pick; })[0] || inds[0] || null, col = esc(t.couleur || '#560A0F'), cm = val('pv_cm'), body = '';
    var cmLabel = cm === 'statut' ? 'Statut SQCDP' : (inds.filter(function(x){ return x.id === cm; })[0] || pr || { libelle:'Statut SQCDP' }).libelle;
    if (chk('pv_statut')) body += '<div style="display:flex;gap:10px;align-items:center;padding:10px 12px;">' + pvFace('orange', 40) + '<div style="font-size:12px;line-height:1.3;"><b style="font-size:14px;">Orange</b><br><span style="opacity:.7;">Aujourd\u2019hui</span></div></div>';
    if (chk('pv_indic')) body += '<div style="padding:8px 12px;border-top:1px solid rgba(86,10,15,.07);"><div style="font-size:24px;font-weight:800;line-height:1.1;">1,2<small style="font-size:12px;opacity:.7;margin-left:3px;">' + esc(pr ? pr.unite : '') + '</small></div><div style="font-size:12px;opacity:.7;">' + (pr ? esc(pr.libelle) + (pr.cible != null ? ' · cible ' + (pr.sens === 'bas' ? '≤ ' : '≥ ') + String(pr.cible).replace('.', ',') : '') : 'Aucun indicateur défini') + '</div></div>';
    if (chk('pv_tend')) body += '<div style="display:flex;gap:10px;align-items:center;padding:8px 12px;border-top:1px solid rgba(86,10,15,.07);">' + pvArrow(30) + '<div style="font-size:12px;line-height:1.3;"><b style="font-size:13px;">En baisse (−8 %)</b><br><span style="opacity:.7;">favorable</span></div></div>';
    if (chk('pv_courbe')) body += '<div style="padding:6px 12px;border-top:1px solid rgba(86,10,15,.07);" title="' + esc(cmLabel) + '">' + pvSpark(col) + '<div style="font-size:11px;opacity:.65;">' + esc(cmLabel) + ' · ' + val('pv_jours') + ' j' + (chk('pv_cible') && cm !== 'statut' ? ' · cible' : '') + (chk('pv_avg') && cm !== 'statut' ? ' · moy. 7 j' : '') + '</div></div>';
    if (chk('pv_bande')) body += '<div style="display:flex;flex-wrap:wrap;gap:2px;padding:6px 12px 10px;">' + '1111211131111211111113111211112'.split('').map(function(g){ return '<i style="display:block;width:8px;height:8px;border-radius:2px;background:' + (g === '1' ? '#2e7d46' : g === '2' ? '#e08a00' : '#c0392b') + ';"></i>'; }).join('') + '</div>';
    if (!body) body = '<div style="padding:14px 12px;font-size:12px;color:var(--signal);">Aucun bloc : cochez au moins un bloc.</div>';
    box.innerHTML = '<div style="width:220px;background:#fff;border:2px solid rgba(86,10,15,.12);border-radius:12px;overflow:hidden;"><div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:' + col + ';color:#fff;"><span style="font-size:30px;font-weight:800;line-height:1;">' + esc(t.code) + '</span><span style="font-size:13px;font-weight:600;">' + esc(t.libelle) + '</span></div>' + body + '</div><div class="sub-cell" style="margin-top:6px;">Valeurs d\u2019exemple.</div>';
  };
  function paveCfgFromForm(){
    return { pave:{ statut:chk('pv_statut'), indic:chk('pv_indic'), tend:chk('pv_tend'), courbe:chk('pv_courbe'), bande:chk('pv_bande') }, ind_principal:val('pv_ind') || null,
             courbe:{ metric:val('pv_cm') || 'auto', jours:parseInt(val('pv_jours'), 10) || 30, cible:chk('pv_cible'), moyenne:chk('pv_avg') } };
  }
  async function pavePersist(id, cfg, okMsg){
    try { touched(await db().from('aic_thematiques').update({ config:cfg, updated_at:new Date().toISOString() }).eq('id', id).select('id'), 'aic_thematiques'); await aicLoad(); flash('pv_msg', true, okMsg); }
    catch(e){ var m = (e && e.message) || String(e); flash('pv_msg', false, /column|schema cache/i.test(m) ? 'Exécutez d\u2019abord aic_brique3c_pave.sql.' : 'Refusé : ' + m); }
  }
  window.aicPaveSave = function(id){ var c = paveCfgFromForm(); if (!(c.pave.statut || c.pave.indic || c.pave.tend || c.pave.courbe || c.pave.bande)){ flash('pv_msg', false, 'Cochez au moins un bloc.'); return; } return pavePersist(id, c, '✓ Pavé enregistré pour tous les espaces'); };
  window.aicPaveReset = function(id){ return pavePersist(id, {}, '✓ Défaut rétabli'); };

  /* ---------- Accès pour les briques suivantes ---------- */
  window.aicReferentiel = function(niveau){
    var n = parseInt(niveau, 10);
    var them = AIC.them.filter(function(t){ return t.actif && (!n || (t.niveaux || []).indexOf(n) >= 0); });
    var ids = them.map(function(t){ return t.id; });
    return { thematiques: them, indicateurs: AIC.ind.filter(function(x){ return x.actif && ids.indexOf(x.thematique_id) >= 0 && (!n || (x.niveaux || []).indexOf(n) >= 0); }) };
  };
  window.aicReloadReferentiel = aicLoad;
})();
