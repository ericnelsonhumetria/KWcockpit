/* ============================================================
   KW — Module partagé CR & Actions (cockpit + Clap!)
   Dépendances fournies par l'hôte : SB, SB_SESSION, CURRENT_ROLE, initSupabase
   Ne pas éditer en double : ce fichier est la source unique des 2 apps.
   ============================================================ */
// ===== Module Plan d'action (onglet 'plandaction') =====
// Capture (vocal + texte) -> reformulation IA -> brouillon validé -> insert.
// Édition post-enregistrement (tous champs + commentaire + tags + confidentiel),
// recherche mots-clés, statut "En attente", numéro de référence, retard en rouge,
// vues Matrice / Liste / Kanban / Archivées, brouillon auto-sauvegardé, filtre pilote
// pour tous, mode confidentiel. CRUD via le client SB (RLS).
(function(){
  var PA_REFS=null, PA_LIST=[], PA_ARCHIVED=[], PA_DRAFT=null, PA_EDIT=null;
  var PA_FILTER={thematique:'',pilote:'',statut:'',quadrant:'',projet:''}, PA_SEARCH='';
  var PA_VIEW='matrice';           // matrice | liste | kanban | periode | archive
  var PA_ROOT='view';
  var PA_PERIOD={gran:'mois', from:'', to:''};
  var PA_SHEET='actions';          // 'actions' | 'cr'
  var PA_DRAG_ID=null;
  var PA_REC=null, PA_RECORDING=false, PA_DICT_FINAL='', PA_BUSY=false, PA_MSG='';
  var PA_AUTO_TIMER=null, PA_AUTODRAFT_ID=null;
  var PA_DRAFTTXT_KEY='kw:pa:brouillon:v1';
  var PA_URGENT_DAYS=7;
  var PA_STATUTS=[['brouillon','Brouillon'],['a_faire','À faire'],['en_attente','En attente'],['en_cours','En cours'],['fait','Fait'],['abandonne','Abandonné']];

  function paEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function paAuth(){ return {'Content-Type':'application/json', Authorization:'Bearer '+SB_SESSION.access_token}; }
  function paToday(){ return new Date().toISOString().slice(0,10); }
  function paSelStyle(){ return 'width:100%;box-sizing:border-box;font-size:13px;padding:7px 9px;border:1px solid rgba(86,10,15,.25);border-radius:8px;font-family:inherit;'; }
  function paThemeLib(code){ var t=((PA_REFS&&PA_REFS.thematiques)||[]).find(function(x){return x.code===code;}); return t?t.libelle:code; }
  function paPiloteNom(id){ if(!id) return 'non attribué'; var p=((PA_REFS&&PA_REFS.pilotes)||[]).find(function(x){return x.id===id;}); return p?p.nom:'—'; }
  function paPiloteId(nom){ var p=((PA_REFS&&PA_REFS.pilotes)||[]).find(function(x){return x.nom===nom;}); return p?p.id:null; }
  function paMyPiloteId(){ var uid=(SB_SESSION&&SB_SESSION.user&&SB_SESSION.user.id)||null; if(!uid) return null; var p=((PA_REFS&&PA_REFS.pilotes)||[]).find(function(x){return x.user_id===uid;}); return p?p.id:null; }
  function paIsDir(){ try { return (CURRENT_ROLE==='eric'||CURRENT_ROLE==='direction'); } catch(e){ return false; } }
  function paCanEdit(a){ return paIsDir() || (!!a.pilote_id && a.pilote_id===paMyPiloteId()); }
  function paCtrlsCompact(a){
    if(!paCanEdit(a)) return '<span class="edit-hint" style="flex:0 0 auto;align-self:center;">'+paStatutLabel(a.statut)+'</span>';
    return '<button onclick="paEdit(\''+a.id+'\')" draggable="false" onmousedown="event.stopPropagation()" type="button" class="add-btn sm" style="flex:0 0 auto;background:#fff;color:#560A0F;">Modifier</button>'
      + '<select onchange="paSetStatut(\''+a.id+'\',this.value)" draggable="false" onmousedown="event.stopPropagation()" style="font-size:10.5px;padding:2px 4px;border:1px solid rgba(86,10,15,.25);border-radius:6px;font-family:inherit;flex:0 0 auto;width:96px;">'+paStatutOptions(a.statut)+'</select>'
      + '<button onclick="paArchive(\''+a.id+'\')" draggable="false" onmousedown="event.stopPropagation()" title="Archiver" type="button" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;flex:0 0 auto;padding:2px;">\u2715</button>';
  }
  function paStatutLabel(s){ var f=PA_STATUTS.find(function(x){return x[0]===s;}); return f?f[1]:s; }
  function paStatutOptions(cur){ return PA_STATUTS.map(function(o){return '<option value="'+o[0]+'"'+(cur===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join(''); }
  function paOpen(a){ return a.statut==='a_faire'||a.statut==='en_cours'||a.statut==='en_attente'; }
  function paOverdue(a){ return a.echeance && a.echeance < paToday() && paOpen(a); }
  function paTags(a){ return Array.isArray(a.tags)?a.tags:[]; }
  function paSlug(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40); }

  var PA_MONTHS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  function paYmd(d){ return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
  function paD(dstr){ var d=new Date(dstr+'T00:00:00'); return isNaN(d.getTime())?null:d; }
  function paWeekInfo(d){ var x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); var day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); return {key:paYmd(x), lbl:'Semaine du '+x.getDate()+' '+PA_MONTHS[x.getMonth()]}; }
  function paMonthInfo(d){ return {key:d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2), lbl:PA_MONTHS[d.getMonth()]+' '+d.getFullYear()}; }
  function paIsUrgent(a){
    if(a.urgent_override===true) return true;
    if(a.urgent_override===false) return false;
    if(!a.echeance) return false;
    var t=new Date(a.echeance+'T00:00:00'); if(isNaN(t.getTime())) return false;
    var lim=new Date(); lim.setHours(0,0,0,0); lim.setDate(lim.getDate()+PA_URGENT_DAYS);
    return t<=lim;
  }
  function paIsImportant(a){ return (a.priorite||2)<=2; }
  function paQuadrantOf(prio,ech,ov){
    var a={priorite:prio,echeance:ech,urgent_override:ov};
    var imp=paIsImportant(a), urg=paIsUrgent(a);
    if(imp&&urg) return {n:'Q1',lbl:'Faire — important & urgent',col:'#c0392b'};
    if(imp&&!urg) return {n:'Q2',lbl:'Planifier — important, non urgent',col:'#EFB810'};
    if(!imp&&urg) return {n:'Q3',lbl:'Déléguer — non important, urgent',col:'#2e7d46'};
    return {n:'Q4',lbl:'Plus tard — non important, non urgent',col:'#2980b9'};
  }

  async function paLoadRefs(){
    var th=await SB.from('action_thematiques').select('code,libelle,ordre').eq('actif',true).order('ordre',{ascending:true});
    var pi=await SB.from('action_pilotes').select('id,nom,alias,actif,user_id').eq('actif',true).order('nom',{ascending:true});
    PA_REFS={thematiques:(th&&th.data)||[], pilotes:(pi&&pi.data)||[]};
  }
  async function paLoadList(){
    var q=await SB.from('actions').select('*').is('archived_at',null).order('numero',{ascending:false});
    PA_LIST=(q&&q.data)?q.data:[];
  }
  async function paLoadArchived(){
    var q=await SB.from('actions').select('*').not('archived_at','is',null).order('archived_at',{ascending:false});
    PA_ARCHIVED=(q&&q.data)?q.data:[];
  }
  async function paReclaimAuto(){
    var uid=(SB_SESSION&&SB_SESSION.user&&SB_SESSION.user.id)||null; if(!uid) return;
    try { var q=await SB.from('actions').select('id').is('archived_at',null).eq('statut','brouillon').eq('created_by',uid).contains('tags',['_auto']).order('numero',{ascending:false}).limit(1);
      if(q&&q.data&&q.data.length) PA_AUTODRAFT_ID=q.data[0].id; } catch(e){}
  }
  async function paAutoSave(){
    var ta=document.getElementById('paTexte'); var t=ta?ta.value.trim():''; if(!t) return;
    try {
      if(PA_AUTODRAFT_ID){ await SB.from('actions').update({texte_brut:t, libelle:t.slice(0,180)}).eq('id',PA_AUTODRAFT_ID); }
      else { var r=await SB.from('actions').insert({texte_brut:t, libelle:t.slice(0,180), statut:'brouillon', pilote_id:null, tags:['_auto']}).select('id').single();
        if(!r.error&&r.data){ PA_AUTODRAFT_ID=r.data.id; await paLoadList(); if(PA_VIEW!=='archive') paRenderResults(); } }
    } catch(e){}
  }

  // ---------- Shell + rendu ----------
  function paShell(inner){
    return '<div class="sec-eyebrow">Pilotage</div>'
      + '<div class="sec-title">Plan d\u2019action</div>'
      + '<div class="sec-note">Dicte ou saisis une action ; l\u2019IA la reformule et la classe ; tu valides avant enregistrement.</div>'
      + inner;
  }
  window.renderPlanAction=async function(rootId){
    PA_ROOT=rootId||'view';
    var v=document.getElementById(PA_ROOT); if(!v) return;
    v.innerHTML=paShell('<div class="edit-hint" style="padding:10px 2px;">Chargement\u2026</div>');
    PA_MSG='';
    try { await paLoadRefs(); await paLoadList(); } catch(e){ PA_MSG='Chargement impossible : '+(e.message||e); }
    try { await paReclaimAuto(); } catch(e){}
    if(!PA_AUTO_TIMER) PA_AUTO_TIMER=setInterval(paAutoSave,10000);
    paRepaint();
  };
  function paSheetToggle(){
    function chip(val,label){ var on=PA_SHEET===val; return '<button onclick="paSetSheet(\''+val+'\')" type="button" style="font-size:13px;padding:6px 16px;border-radius:999px;border:1px solid '+(on?'#560A0F':'rgba(86,10,15,.28)')+';background:'+(on?'#560A0F':'#fff')+';color:'+(on?'#fff':'#560A0F')+';cursor:pointer;font-family:inherit;font-weight:'+(on?'700':'500')+';margin-right:8px;">'+label+'</button>'; }
    return '<div style="display:flex;gap:4px;margin:2px 0 12px;">'+chip('cr','Réunions & Rituels')+chip('actions','Actions')+'</div>';
  }
  window.paSetSheet=function(v){ PA_SHEET=v; paRepaint(); };
  function paRepaint(){
    var v=document.getElementById(PA_ROOT); if(!v) return;
    if(PA_SHEET==='cr'){ v.innerHTML=paSheetToggle()+'<div id="crSheet"></div>'; if(window.renderCRSheet) window.renderCRSheet('crSheet'); return; }
    v.innerHTML=paSheetToggle()+paShell(paCaptureHtml() + paFormZoneHtml() + paControlsHtml() + '<div id="paResults"></div>');
    paRenderResults();
  }
  function paRenderResults(){
    var r=document.getElementById('paResults'); if(!r) return;
    if(PA_VIEW==='archive'){ r.innerHTML=paArchiveHtml(); return; }
    var stats=paStatsHtml(PA_LIST.filter(paMatch));
    r.innerHTML = stats + (PA_VIEW==='routine' ? paRoutineHtml() : (PA_VIEW==='projet' ? paProjetHtml() : (PA_VIEW==='periode' ? paPeriodeHtml() : (PA_VIEW==='kanban' ? paKanbanHtml() : (PA_VIEW==='liste' ? paListHtml() : paMatrixHtml())))));
  }

  // ---------- Capture (vocal + texte + IA) ----------
  function paCaptureHtml(){
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    var mic=SR?'<button class="add-btn" id="paMicBtn" onclick="paDictate()" type="button">\ud83c\udfa4 Dicter</button>':'';
    var saved=''; try{ saved=localStorage.getItem(PA_DRAFTTXT_KEY)||''; }catch(e){}
    return '<div class="panel" style="padding:14px 16px;margin-top:6px;">'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">'+mic
      + '<span class="edit-hint">'+(SR?'Clique, parle, reclique pour arrêter.':'Dictée vocale indisponible sur ce navigateur — saisis ci-dessous.')+'</span></div>'
      + '<textarea id="paTexte" rows="2" oninput="paSaveDraftTxt(this.value)" placeholder="Ex : rappeler à Paul de relancer Andros sur le calendrier S2 avant vendredi" style="width:100%;box-sizing:border-box;font-size:13px;padding:8px 10px;border:1px solid rgba(86,10,15,.25);border-radius:8px;resize:vertical;font-family:inherit;">'+paEsc(saved)+'</textarea>'
      + '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">'
      +   '<button class="add-btn" onclick="paReformulate()" type="button"'+(PA_BUSY?' disabled':'')+'>'+(PA_BUSY?'\u2026 analyse':'\u2728 Reformuler par l\u2019IA')+'</button>'
      +   '<button class="add-btn sm" onclick="paQuickSave()" type="button" style="background:#fff;color:#560A0F;">✍️ Saisie directe</button>'
      +   '<button class="add-btn sm" onclick="paQuickDraft()" type="button" style="background:#fff;color:#560A0F;">\ud83d\udcbe Brouillon</button>'
      + '</div>'
      + (PA_MSG?'<div class="edit-hint" style="color:var(--signal);margin-top:6px;">'+paEsc(PA_MSG)+'</div>':'')
      + '</div>';
  }
  window.paSaveDraftTxt=function(v){ try{ if(v) localStorage.setItem(PA_DRAFTTXT_KEY,v); else localStorage.removeItem(PA_DRAFTTXT_KEY); }catch(e){} };
  function paClearDraftTxt(){ try{ localStorage.removeItem(PA_DRAFTTXT_KEY); }catch(e){} }

  window.paDictate=function(){
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR) return;
    if(PA_RECORDING){ PA_RECORDING=false; if(PA_REC){ try{ PA_REC.stop(); }catch(e){} } var bs=document.getElementById('paMicBtn'); if(bs) bs.textContent='\ud83c\udfa4 Dicter'; return; }
    var ta0=document.getElementById('paTexte'); PA_DICT_FINAL=ta0?ta0.value.replace(/\s+$/,''):'';
    PA_RECORDING=true; var b1=document.getElementById('paMicBtn'); if(b1) b1.textContent='\u23f9 Arrêter';
    paStartRec(SR);
  };
  function paStartRec(SR){
    PA_REC=new SR(); PA_REC.lang='fr-FR'; PA_REC.interimResults=true; PA_REC.continuous=true;
    PA_REC.onresult=function(ev){
      var interim='';
      for(var i=ev.resultIndex;i<ev.results.length;i++){ var r=ev.results[i];
        if(r.isFinal){ var seg=(r[0].transcript||'').trim(); if(seg){ PA_DICT_FINAL+=(PA_DICT_FINAL&&!/\s$/.test(PA_DICT_FINAL)?' ':'')+seg; } }
        else interim+=r[0].transcript;
      }
      var ta=document.getElementById('paTexte');
      if(ta){ ta.value=PA_DICT_FINAL+(interim?(PA_DICT_FINAL?' ':'')+interim:''); paSaveDraftTxt(ta.value); }
    };
    PA_REC.onerror=function(e){ if(e&&(e.error==='not-allowed'||e.error==='service-not-allowed')){ PA_RECORDING=false; var b=document.getElementById('paMicBtn'); if(b) b.textContent='\ud83c\udfa4 Dicter'; } };
    PA_REC.onend=function(){ if(PA_RECORDING){ try{ paStartRec(SR); return; }catch(e){} } var b=document.getElementById('paMicBtn'); if(b) b.textContent='\ud83c\udfa4 Dicter'; };
    try{ PA_REC.start(); }catch(e){}
  }
  window.paReformulate=async function(){
    if(PA_BUSY) return;
    var ta=document.getElementById('paTexte'); var texte=ta?ta.value.trim():'';
    if(!texte){ PA_MSG='Dicte ou saisis d\u2019abord une action.'; paRepaint(); return; }
    PA_BUSY=true; PA_MSG=''; paRepaint();
    try {
      var res=await fetch('/api/action-ia',{method:'POST',headers:paAuth(),body:JSON.stringify({
        texte:texte, today:paToday(),
        pilotes:(PA_REFS.pilotes||[]).map(function(p){return {nom:p.nom,alias:p.alias||[]};}),
        thematiques:(PA_REFS.thematiques||[]).map(function(t){return {code:t.code,libelle:t.libelle};})
      })});
      var j=null; try{ j=await res.json(); }catch(e){}
      if(!res.ok) throw new Error((j&&j.error)?j.error:('HTTP '+res.status));
      PA_DRAFT={texte_brut:texte, libelle:j.libelle, thematique:j.thematique, projet:'', pilote_id:paPiloteId(j.pilote_nom), echeance:j.echeance, priorite:j.priorite, statut:'a_faire', tags:[], pieces_jointes:[], confidentiel:false, commentaire:'', justification:j.justification, urgent_override:null};
    } catch(e){ PA_MSG='Reformulation impossible : '+(e.message||e); }
    PA_BUSY=false; paRepaint();
  };
  window.paQuickSave=function(){
    var ta=document.getElementById('paTexte'); var texte=ta?ta.value.trim():'';
    PA_DRAFT={texte_brut:texte, libelle:texte, thematique:'autre', projet:'', source:null, pilote_id:null, echeance:null, priorite:2, statut:'a_faire', tags:[], pieces_jointes:[], confidentiel:false, commentaire:'', urgent_override:null};
    paRepaint();
  };

  window.paQuickDraft=async function(){
    var ta=document.getElementById('paTexte'); var texte=ta?ta.value.trim():'';
    if(!texte){ PA_MSG='Rien à enregistrer en brouillon.'; paRepaint(); return; }
    var row={texte_brut:texte, libelle:texte, thematique:'autre', projet:null, pilote_id:paMyPiloteId(), echeance:null, priorite:2, statut:'brouillon', tags:[], commentaire:null, confidentiel:false};
    try{ if(PA_AUTODRAFT_ID){ var ru=await SB.from('actions').update({libelle:texte, texte_brut:texte, tags:[], pilote_id:paMyPiloteId()}).eq('id',PA_AUTODRAFT_ID); if(ru.error) throw ru.error; PA_AUTODRAFT_ID=null; } else { var r=await SB.from('actions').insert(row); if(r.error) throw r.error; } if(ta) ta.value=''; paClearDraftTxt(); PA_MSG=''; await paLoadList(); paRepaint(); }catch(e){ PA_MSG='Brouillon refusé : '+(e.message||e); paRepaint(); }
  };
  // ---------- Formulaire (nouveau + édition) ----------
  function paFormZoneHtml(){
    if(PA_EDIT) return paFormHtml(PA_EDIT,'edit');
    if(PA_DRAFT) return paFormHtml(PA_DRAFT,'new');
    return '';
  }
  function paField(lbl,ctrl){ return '<label style="display:block;font-size:11px;color:var(--muted);flex:1;min-width:150px;">'+lbl+'<div style="margin-top:2px;">'+ctrl+'</div></label>'; }
  function paFormHtml(d,mode){
    var themeOpts=(PA_REFS.thematiques||[]).map(function(t){return '<option value="'+t.code+'"'+(t.code===d.thematique?' selected':'')+'>'+paEsc(t.libelle)+'</option>';}).join('');
    var piloteOpts='<option value="">— non attribué</option>'+(PA_REFS.pilotes||[]).map(function(p){return '<option value="'+p.id+'"'+(p.id===d.pilote_id?' selected':'')+'>'+paEsc(p.nom)+'</option>';}).join('');
    var prioOpts=[[1,'Haute'],[2,'Normale'],[3,'Basse']].map(function(o){return '<option value="'+o[0]+'"'+(o[0]===d.priorite?' selected':'')+'>'+o[1]+'</option>';}).join('');
    var q=paQuadrantOf(d.priorite,d.echeance,d.urgent_override);
    var classif = (mode==='new') ? ('<div style="font-size:12px;margin:0 0 6px;">Classement suggéré : <span style="color:'+q.col+';font-weight:700;">'+q.n+' · '+q.lbl+'</span></div>'+(d.justification?'<div class="edit-hint" style="margin:-2px 0 8px;">'+paEsc(d.justification)+'</div>':'')) : '';
    return '<div class="panel" style="padding:14px 16px;margin-top:12px;border:1px solid #EFB810;">'
      + '<div class="sec-eyebrow" style="margin:0 0 8px;">'+(mode==='edit'?('Modifier l\u2019action #'+(d.numero||'')):'Brouillon — valide ou corrige avant d\u2019enregistrer')+'</div>'
      + classif
      + paField('Libellé','<input id="pfLib" type="text" value="'+paEsc(d.libelle)+'" style="'+paSelStyle()+'">')
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">'
      +   paField('Thématique','<div style="display:flex;gap:4px;"><select id="pfTheme" style="'+paSelStyle()+'">'+themeOpts+'</select><button type="button" onclick="paNewTheme(\''+mode+'\')" title="Nouvelle thématique" class="add-btn sm" style="flex:0 0 auto;background:#fff;color:#560A0F;">+</button></div>')
      +   paField('Projet','<input id="pfProjet" type="text" value="'+paEsc(d.projet||'')+'" placeholder="(optionnel)" style="'+paSelStyle()+'">')
      +   paField('Source','<input id="pfSource" type="text" value="'+paEsc(d.source||'')+'" placeholder="(optionnel) origine / contexte de l\'action" style="'+paSelStyle()+'">')
      +   paField('Routine','<input id="pfRoutine" type="text" value="'+paEsc(d.routine||'')+'" placeholder="(optionnel) ex. AIC Ligne 3" style="'+paSelStyle()+'">')
      +   paField('Pilote','<select id="pfPilote" style="'+paSelStyle()+'">'+piloteOpts+'</select>')
      + '</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">'
      +   paField('Échéance','<input id="pfEch" type="date" value="'+(d.echeance||'')+'" style="'+paSelStyle()+'">')
      +   paField('Priorité','<select id="pfPrio" style="'+paSelStyle()+'">'+prioOpts+'</select>')
      +   paField('Statut','<select id="pfStatut" style="'+paSelStyle()+'">'+paStatutOptions(d.statut||'a_faire')+'</select>')
      + '</div>'
      + paField('Tags (séparés par des virgules)','<input id="pfTags" type="text" value="'+paEsc(paTags(d).join(', '))+'" placeholder="ex : andros, relance, s2" style="'+paSelStyle()+'">')
      + paField('Commentaire','<textarea id="pfComment" rows="2" style="'+paSelStyle()+'resize:vertical;">'+paEsc(d.commentaire||'')+'</textarea>')
      + '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#560A0F;margin-top:8px;cursor:pointer;"><input id="pfConf" type="checkbox"'+(d.confidentiel?' checked':'')+'> \ud83d\udd12 Confidentiel (visible seulement de l\u2019émetteur, du pilote et de la direction)</label>'
      + paFilesHtml(d,mode)
      + '<div style="display:flex;gap:8px;margin-top:10px;">'
      +   '<button class="add-btn" onclick="paSaveForm(\''+mode+'\')" type="button">\u2713 '+(mode==='edit'?'Enregistrer les modifications':'Enregistrer l\u2019action')+'</button>'
      +   (mode!=='edit' ? '<button class="add-btn sm" onclick="paSaveForm(\'draft\')" type="button" style="background:#fff;color:#560A0F;">\ud83d\udcbe Brouillon</button>' : '')
      +   '<button class="add-btn sm" onclick="paCancelForm()" type="button" style="background:#fff;color:#560A0F;">Annuler</button>'
      + '</div></div>';
  }
  function paFilesHtml(d,mode){
    var files=(d&&d.pieces_jointes)||[];
    var chips=files.map(function(f,i){
      var isImg=(/^image\//.test(f.type||''))||(/\.(png|jpe?g|gif|webp|svg)$/i.test(f.name||''));
      var thumb=isImg?'<img src="'+f.url+'" style="width:32px;height:32px;object-fit:cover;border-radius:6px;">':'<span style="font-size:16px;">📎</span>';
      return '<span style="display:inline-flex;align-items:center;gap:4px;background:#fff;border:1px solid rgba(86,10,15,.2);border-radius:8px;padding:3px 7px;margin:0 6px 6px 0;font-size:12px;">'+thumb+'<a href="'+f.url+'" target="_blank" rel="noopener" style="color:#560A0F;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+paEsc(f.name||'fichier')+'</a><button onclick="paRemoveFile(\''+mode+'\','+i+')" type="button" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;">✕</button></span>';
    }).join('');
    return '<div style="margin-top:8px;"><div style="font-size:11px;color:var(--muted);margin-bottom:3px;">Pièces jointes (image ou fichier)</div><div style="display:flex;flex-wrap:wrap;align-items:center;">'+chips+'<button class="add-btn sm" onclick="paAddFile(\''+mode+'\')" type="button" style="background:#fff;color:#560A0F;">📎 Joindre</button></div></div>';
  }
  window.paAddFile=function(mode){
    var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx';
    inp.onchange=function(){ var f=inp.files&&inp.files[0]; if(f) paUploadFile(f,mode); };
    inp.click();
  };
  async function paUploadFile(file,mode){
    var obj=(mode==='edit')?PA_EDIT:PA_DRAFT; if(!obj) return;
    var cur=paReadForm(); for(var k in cur){ if(k!=='pieces_jointes') obj[k]=cur[k]; }
    if(!obj.pieces_jointes) obj.pieces_jointes=[];
    try{
      if(file.size>10*1024*1024) throw new Error('fichier > 10 Mo');
      var safe=(file.name||'fichier').replace(/[^a-zA-Z0-9._-]/g,'_');
      var path='act/'+((mode==='edit'&&PA_EDIT&&PA_EDIT.id)?PA_EDIT.id:'new')+'/'+Date.now()+'_'+safe;
      var up=await SB.storage.from('action-files').upload(path,file,{upsert:true,contentType:file.type||'application/octet-stream'});
      if(up.error) throw up.error;
      var pub=SB.storage.from('action-files').getPublicUrl(path); var url=(pub&&pub.data)?pub.data.publicUrl:'';
      if(!url) throw new Error('URL indisponible');
      obj.pieces_jointes.push({name:file.name||safe, url:url, type:file.type||''});
      PA_MSG=''; paRepaint();
    }catch(err){ PA_MSG='Pièce jointe refusée : '+(err.message||err)+' (le bucket « action-files » doit exister et être public).'; paRepaint(); }
  }
  window.paRemoveFile=function(mode,i){ var obj=(mode==='edit')?PA_EDIT:PA_DRAFT; if(obj&&obj.pieces_jointes){ var cur=paReadForm(); for(var k in cur){ if(k!=='pieces_jointes') obj[k]=cur[k]; } obj.pieces_jointes.splice(i,1); paRepaint(); } };
  function paReadForm(){
    function val(id){ var e=document.getElementById(id); return e?e.value:''; }
    var tags=val('pfTags').split(',').map(function(x){return x.trim();}).filter(Boolean);
    return {
      libelle:val('pfLib').trim(),
      thematique:val('pfTheme')||'autre',
      projet:val('pfProjet').trim()||null,
      source:val('pfSource').trim()||null,
      routine:val('pfRoutine').trim()||null,
      pilote_id:val('pfPilote')||null,
      echeance:val('pfEch')||null,
      priorite:parseInt(val('pfPrio'),10)||2,
      statut:val('pfStatut')||'a_faire',
      tags:tags,
      pieces_jointes:((PA_EDIT||PA_DRAFT||{}).pieces_jointes)||[],
      commentaire:val('pfComment').trim()||null,
      confidentiel:(function(){ var e=document.getElementById('pfConf'); return !!(e&&e.checked); })()
    };
  }
  window.paCancelForm=function(){ PA_DRAFT=null; PA_EDIT=null; paRepaint(); };
  window.paNewTheme=async function(mode){
    var cur=paReadForm(); var obj=(mode==='edit')?PA_EDIT:PA_DRAFT; if(obj){ for(var k in cur) obj[k]=cur[k]; }
    var nom=window.prompt('Nom de la nouvelle thématique :',''); if(!nom||!nom.trim()) { paRepaint(); return; }
    nom=nom.trim(); var code=paSlug(nom)||('theme_'+Date.now());
    try {
      var r=await SB.from('action_thematiques').insert({code:code,libelle:nom,ordre:50}); if(r.error && r.error.code!=='23505') throw r.error;
      await paLoadRefs();
      if(obj) obj.thematique=code;
    } catch(e){ PA_MSG='Ajout thématique refusé : '+(e.message||e); }
    paRepaint();
  };
  window.paSaveForm=async function(mode){
    var f=paReadForm();
    if(!f.libelle){ PA_MSG='Le libellé est vide.'; paRepaint(); return; }
    if(mode==='draft') f.statut='brouillon';
    if(!f.pilote_id && mode!=='edit') f.pilote_id=paMyPiloteId();
    try {
      if(mode==='edit'){
        var r=await SB.from('actions').update(f).eq('id',PA_EDIT.id);
        if(r.error){ var f2={}; for(var kk in f){ if(kk!=='source'&&kk!=='pieces_jointes'&&kk!=='routine') f2[kk]=f[kk]; } r=await SB.from('actions').update(f2).eq('id',PA_EDIT.id); if(r.error) throw r.error; }
        PA_EDIT=null;
      } else {
        var row={texte_brut:PA_DRAFT.texte_brut, libelle:f.libelle, thematique:f.thematique, projet:f.projet, source:f.source, routine:f.routine, pilote_id:f.pilote_id, echeance:f.echeance, priorite:f.priorite, statut:f.statut, tags:f.tags, pieces_jointes:f.pieces_jointes, commentaire:f.commentaire, confidentiel:f.confidentiel};
        var r2=await SB.from('actions').insert(row);
        if(r2.error){ var row2={}; for(var kk in row){ if(kk!=='source'&&kk!=='pieces_jointes'&&kk!=='routine') row2[kk]=row[kk]; } r2=await SB.from('actions').insert(row2); if(r2.error) throw r2.error; }
        if(PA_AUTODRAFT_ID){ try{ await SB.from('actions').delete().eq('id',PA_AUTODRAFT_ID); }catch(x){} PA_AUTODRAFT_ID=null; }
        PA_DRAFT=null; var ta=document.getElementById('paTexte'); if(ta) ta.value=''; paClearDraftTxt();
      }
      PA_MSG=''; await paLoadList(); paRepaint();
    } catch(e){ PA_MSG='Enregistrement refusé : '+(e.message||e); paRepaint(); }
  };
  window.paEdit=function(id){
    var src=PA_LIST.find(function(x){return x.id===id;}) || PA_ARCHIVED.find(function(x){return x.id===id;});
    if(!src) return;
    PA_EDIT=JSON.parse(JSON.stringify(src)); PA_DRAFT=null;
    paRepaint();
    try{ window.scrollTo({top:0,behavior:'smooth'}); }catch(e){}
  };

  // ---------- Contrôles (vues + filtres + recherche) ----------
  function paControlsHtml(){ return paViewToggle()+paFiltersHtml()+paSearchHtml(); }
  window.paSetView=async function(v){ PA_VIEW=v; if(v==='archive'){ try{ await paLoadArchived(); }catch(e){ PA_MSG='Chargement des archives impossible : '+(e.message||e); } } paRepaint(); };
  function paViewToggle(){
    function chip(val,label){ var on=(PA_VIEW===val); return '<button onclick="paSetView(\''+val+'\')" style="font-size:12px;padding:5px 12px;border-radius:999px;border:1px solid '+(on?'#560A0F':'rgba(86,10,15,.28)')+';background:'+(on?'#560A0F':'#fff')+';color:'+(on?'#fff':'#560A0F')+';cursor:pointer;font-family:inherit;font-weight:'+(on?'600':'400')+';margin-right:6px;">'+label+'</button>'; }
    return '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;margin:16px 0 2px;"><span class="edit-hint" style="margin-right:4px;">Vue :</span>'+chip('matrice','Matrice')+chip('liste','Liste')+chip('kanban','Kanban')+chip('periode','Période')+chip('routine','Routine')+chip('projet','Projet')+chip('archive','Archivées')+'</div>';
  }
  function paFiltersHtml(){
    var themeF='<option value="">Toutes thématiques</option>'+(PA_REFS.thematiques||[]).map(function(t){return '<option value="'+t.code+'"'+(PA_FILTER.thematique===t.code?' selected':'')+'>'+paEsc(t.libelle)+'</option>';}).join('');
    var pilF='<option value="">Tous pilotes</option>'+(PA_REFS.pilotes||[]).map(function(p){return '<option value="'+p.id+'"'+(PA_FILTER.pilote===p.id?' selected':'')+'>'+paEsc(p.nom)+'</option>';}).join('');
    var statF='<option value="">Tous statuts</option>'+PA_STATUTS.map(function(s){return '<option value="'+s[0]+'"'+(PA_FILTER.statut===s[0]?' selected':'')+'>'+s[1]+'</option>';}).join('');
    var projs=Array.from(new Set(PA_LIST.map(function(a){return a.projet;}).filter(Boolean))).sort();
    var projF='<option value="">Tous projets</option>'+projs.map(function(p){return '<option value="'+paEsc(p)+'"'+(PA_FILTER.projet===p?' selected':'')+'>'+paEsc(p)+'</option>';}).join('');
    var quadF='<option value="">Tous quadrants</option>'+[['q1','Q1 · Faire'],['q2','Q2 · Planifier'],['q3','Q3 · Déléguer'],['q4','Q4 · Plus tard']].map(function(o){return '<option value="'+o[0]+'"'+(PA_FILTER.quadrant===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('');
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 4px;">'
      + '<select onchange="paSetFilter(\'thematique\',this.value)" style="'+paSelStyle()+'width:auto;">'+themeF+'</select>'
      + '<select onchange="paSetFilter(\'pilote\',this.value)" style="'+paSelStyle()+'width:auto;">'+pilF+'</select>'
      + '<select onchange="paSetFilter(\'statut\',this.value)" style="'+paSelStyle()+'width:auto;">'+statF+'</select>'
      + '<select onchange="paSetFilter(\'projet\',this.value)" style="'+paSelStyle()+'width:auto;">'+projF+'</select>'
      + '<select onchange="paSetFilter(\'quadrant\',this.value)" style="'+paSelStyle()+'width:auto;">'+quadF+'</select>'
      + '</div>';
  }
  window.paSetFilter=function(k,v){ PA_FILTER[k]=v; paRepaint(); };
  function paSearchHtml(){
    return '<div style="margin:4px 0 2px;"><input id="paSearch" type="search" value="'+paEsc(PA_SEARCH)+'" oninput="paSetSearch(this.value)" placeholder="Rechercher (n°, mot-clé, tag, projet, pilote…)" style="'+paSelStyle()+'"></div>';
  }
  window.paSetSearch=function(v){ PA_SEARCH=v; paRenderResults(); var el=document.getElementById('paSearch'); if(el){ try{ el.focus(); el.setSelectionRange(el.value.length,el.value.length); }catch(e){} } };
  function paQuadKey(a){ var imp=paIsImportant(a),urg=paIsUrgent(a); return imp&&urg?'q1':(imp&&!urg?'q2':(!imp&&urg?'q3':'q4')); }
  function paPct(n,t){ return t?Math.round(n/t*100):0; }
  function paStatsHtml(rows){
    var total=rows.length;
    var real=rows.filter(function(a){return a.statut==='fait';}).length;
    var wip=rows.filter(function(a){return a.statut==='en_cours'||a.statut==='en_attente';}).length;
    var late=rows.filter(paOverdue).length;
    function card(label,n,color){ return '<div style="flex:1;min-width:118px;background:#fff;border:1px solid rgba(86,10,15,.12);border-radius:10px;padding:8px 12px;">'
      +'<div style="font-size:20px;font-weight:800;color:'+color+';line-height:1.1;">'+n+' <span style="font-size:12px;font-weight:600;color:var(--muted);">('+paPct(n,total)+'%)</span></div>'
      +'<div class="edit-hint" style="margin-top:1px;">'+label+'</div></div>'; }
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px;">'
      +'<div style="flex:1;min-width:100px;background:#560A0F;border-radius:10px;padding:8px 12px;color:#fff;"><div style="font-size:20px;font-weight:800;line-height:1.1;">'+total+'</div><div style="font-size:11px;opacity:.85;margin-top:1px;">Total</div></div>'
      +card('Réalisées',real,'#2e7d46')
      +card('En cours / attente',wip,'#EFB810')
      +card('En retard',late,'#c0392b')
      +'</div>';
  }
  function paTextMatch(a){
    if(!PA_SEARCH) return true;
    var qy=PA_SEARCH.toLowerCase();
    var hay=('#'+(a.numero||'')+' '+(a.libelle||'')+' '+(a.commentaire||'')+' '+(a.projet||'')+' '+paTags(a).join(' ')+' '+paThemeLib(a.thematique)+' '+paPiloteNom(a.pilote_id)).toLowerCase();
    return hay.indexOf(qy)>=0;
  }
  function paMatch(a){
    if((a.tags||[]).some(function(t){return String(t).indexOf('_')===0;})) return false;
    if(PA_FILTER.thematique && a.thematique!==PA_FILTER.thematique) return false;
    if(PA_FILTER.pilote && a.pilote_id!==PA_FILTER.pilote) return false;
    if(PA_FILTER.statut && a.statut!==PA_FILTER.statut) return false;
    if(PA_FILTER.projet && a.projet!==PA_FILTER.projet) return false;
    if(PA_FILTER.quadrant && paQuadKey(a)!==PA_FILTER.quadrant) return false;
    if(!paTextMatch(a)) return false;
    return true;
  }

  // ---------- Fragments d'action ----------
  function paMetaLine(a){
    var over=paOverdue(a);
    var prioTxt=a.priorite===1?'Haute':(a.priorite===3?'Basse':'Normale');
    var prioCol=a.priorite===1?'#b3541e':(a.priorite===3?'var(--muted)':'#560A0F');
    var bits=[paEsc(paThemeLib(a.thematique))];
    if(a.projet) bits.push('📁 '+paEsc(a.projet));
    bits.push(paEsc(paPiloteNom(a.pilote_id)));
    bits.push('<span style="color:'+prioCol+';">'+prioTxt+'</span>');
    if(a.echeance) bits.push('<span style="'+(over?'color:var(--signal);font-weight:700;':'')+'">éch. '+paEsc(a.echeance)+(over?' — en retard':'')+'</span>');
    if(a.pieces_jointes&&a.pieces_jointes.length){ bits.push(a.pieces_jointes.map(function(f){ var im=(/^image\//.test(f.type||''))||(/\.(png|jpe?g|gif|webp)$/i.test(f.name||'')); return '<a href="'+f.url+'" target="_blank" rel="noopener" style="color:#560A0F;">'+(im?'🖼':'📎')+' '+paEsc(f.name||'fichier')+'</a>'; }).join(' ')); }
    var s=bits.join(' · ');
    var tags=paTags(a).filter(function(t){return t.indexOf('_')!==0;}); if(tags.length) s+= ' · '+tags.map(function(t){return '<span style="background:rgba(86,10,15,.08);border-radius:4px;padding:0 4px;font-size:10px;">#'+paEsc(t)+'</span>';}).join(' ');
    return s;
  }
  function paTitleLine(a,done){
    return '<span style="font-size:11px;color:var(--muted);">#'+(a.numero||'?')+'</span> '
      + (a.confidentiel?'<span title="Confidentiel">\ud83d\udd12</span> ':'')
      + '<span style="font-size:13px;font-weight:600;color:#560A0F;'+(done?'text-decoration:line-through;':'')+'">'+paEsc(a.libelle)+'</span>'
      + (a.commentaire?' <span title="Commentaire">\ud83d\udcac</span>':'');
  }
  function paActionButtons(a){
    if(!paCanEdit(a)) return '<span class="edit-hint" style="flex:0 0 auto;align-self:center;">'+paStatutLabel(a.statut)+'</span>';
    return '<select onchange="paSetStatut(\''+a.id+'\',this.value)" draggable="false" onmousedown="event.stopPropagation()" style="font-size:11px;padding:3px 5px;border:1px solid rgba(86,10,15,.25);border-radius:6px;font-family:inherit;flex:0 0 auto;width:104px;">'+paStatutOptions(a.statut)+'</select>'
      + '<button onclick="paEdit(\''+a.id+'\')" draggable="false" onmousedown="event.stopPropagation()" title="Modifier" type="button" class="add-btn sm" style="flex:0 0 auto;background:#fff;color:#560A0F;">Modifier</button>'
      + '<button onclick="paArchive(\''+a.id+'\')" draggable="false" onmousedown="event.stopPropagation()" title="Archiver" type="button" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;flex:0 0 auto;padding:2px;">\u2715</button>';
  }

  // ---------- Vue Liste ----------
  function paListHtml(){
    var rows=PA_LIST.filter(paMatch);
    var body=rows.length?rows.map(function(a){
      var done=(a.statut==='fait'||a.statut==='abandonne'); var over=paOverdue(a);
      return '<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 6px;border-bottom:1px solid rgba(86,10,15,.10);border-radius:6px;'+(over?'background:#fdecea;':'')+(done?'opacity:.55;':'')+'">'
        + '<div style="flex:1;min-width:0;">'+paTitleLine(a,done)+'<div class="edit-hint" style="margin-top:2px;">'+paMetaLine(a)+'</div></div>'
        + paActionButtons(a)
        + '</div>';
    }).join('') : '<div class="edit-hint" style="padding:12px 2px;">Aucune action pour ce filtre.</div>';
    return '<div class="edit-hint" style="margin:6px 0 2px;">'+rows.length+' action(s)</div><div>'+body+'</div>';
  }

  // ---------- Vue Matrice ----------
  function paCell(a){
    var done=(a.statut==='fait'||a.statut==='abandonne'); var over=paOverdue(a);
    return '<div draggable="'+(paCanEdit(a)?'true':'false')+'" ondragstart="paDragStart(event,\''+a.id+'\')" style="background:'+(over?'#fdecea':'#fff')+';border:1px solid rgba(0,0,0,.08);border-radius:8px;padding:7px 9px;margin-bottom:6px;cursor:grab;'+(done?'opacity:.5;':'')+'">'
      + '<div>'+paTitleLine(a,done)+'</div>'
      + '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">'
      +   '<span class="edit-hint" style="flex:1;min-width:0;">'+paMetaLine(a)+'</span>'
      +   paCtrlsCompact(a)
      + '</div></div>';
  }
  function paQuadrant(title,sub,color,actions,key){
    var body=actions.length?actions.map(paCell).join(''):'<div class="edit-hint" style="padding:4px 2px;">—</div>';
    return '<div ondragover="paDragOver(event)" ondragleave="paDragLeave(event)" ondrop="paDrop(event,\''+key+'\')" style="border:2px solid '+color+';border-radius:12px;padding:10px 12px;min-width:0;display:flex;flex-direction:column;">'
      + '<div style="font-weight:700;color:'+color+';font-size:13px;">'+title+' <span style="font-weight:400;color:var(--muted);font-size:11px;">('+actions.length+')</span></div>'
      + '<div class="edit-hint" style="margin:1px 0 8px;">'+sub+'</div>'
      + '<div style="overflow-y:auto;max-height:340px;">'+body+'</div></div>';
  }
  function paMatrixHtml(){
    var rows=PA_LIST.filter(paMatch); var q1=[],q2=[],q3=[],q4=[];
    rows.forEach(function(a){ var imp=paIsImportant(a),urg=paIsUrgent(a); if(imp&&urg)q1.push(a); else if(imp&&!urg)q2.push(a); else if(!imp&&urg)q3.push(a); else q4.push(a); });
    var grid='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      + paQuadrant('Q2 · Planifier','Important, non urgent','#EFB810',q2,'q2')
      + paQuadrant('Q1 · Faire','Important & urgent','#c0392b',q1,'q1')
      + paQuadrant('Q4 · Plus tard','Non important, non urgent','#2980b9',q4,'q4')
      + paQuadrant('Q3 · Déléguer','Non important, urgent','#2e7d46',q3,'q3')+'</div>';
    var vAxis='<div style="display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:4px 0;flex:0 0 22px;"><span style="font-size:13px;color:#560A0F;font-weight:700;">+</span><span style="writing-mode:vertical-rl;transform:rotate(180deg);font-weight:700;color:#560A0F;font-size:12px;letter-spacing:3px;white-space:nowrap;">IMPORTANT</span><span style="font-size:15px;color:var(--muted);font-weight:700;">\u2013</span></div>';
    var matrix='<div style="display:flex;gap:6px;align-items:stretch;margin-top:4px;">'+vAxis+'<div style="flex:1;min-width:0;">'+grid+'</div></div>';
    var hAxis='<div style="display:flex;gap:6px;margin-top:6px;"><div style="flex:0 0 22px;"></div><div style="flex:1;display:flex;justify-content:space-between;align-items:center;"><span style="font-size:11px;color:var(--muted);font-weight:700;">\u2013 non urgent</span><span style="font-weight:700;color:#560A0F;font-size:12px;letter-spacing:3px;">URGENT \u2192</span><span style="font-size:11px;color:#c0392b;font-weight:700;">urgent +</span></div></div>';
    var legend='<div class="edit-hint" style="margin-top:8px;">Glisse une action d\u2019un quadrant à l\u2019autre pour la reclasser (l\u2019échéance reste inchangée). Retard = fond rouge.</div>';
    return '<div class="edit-hint" style="margin:2px 0 2px;">'+rows.length+' action(s)</div>'+matrix+hAxis+legend;
  }

  // ---------- Vue Kanban ----------
  function paKanbanCard(a){
    var done=(a.statut==='fait'||a.statut==='abandonne'); var over=paOverdue(a);
    return '<div draggable="'+(paCanEdit(a)?'true':'false')+'" ondragstart="paDragStart(event,\''+a.id+'\')" style="background:'+(over?'#fdecea':'#fff')+';border:1px solid rgba(0,0,0,.08);border-radius:8px;padding:7px 9px;margin-bottom:6px;cursor:grab;'+(done?'opacity:.55;':'')+'">'
      + '<div>'+paTitleLine(a,done)+'</div>'
      + '<div class="edit-hint" style="margin-top:3px;">'+paEsc(paPiloteNom(a.pilote_id))+(a.echeance?(' · <span style="'+(over?'color:var(--signal);font-weight:700;':'')+'">'+paEsc(a.echeance)+'</span>'):'')+'</div>'
      + (paCanEdit(a) ? '<div style="margin-top:4px;"><button onclick="paEdit(\''+a.id+'\')" draggable="false" onmousedown="event.stopPropagation()" type="button" class="add-btn sm" style="background:#fff;color:#560A0F;">Modifier</button></div>' : '')
      + '</div>';
  }
  function paKanbanHtml(){
    var rows=PA_LIST.filter(paMatch);
    var cols=[['brouillon','Brouillon','#8a8a8a'],['a_faire','À faire','#560A0F'],['en_attente','En attente','#b3541e'],['en_cours','En cours','#EFB810'],['fait','Fait','#2e7d46']];
    var grid='<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:4px;">';
    cols.forEach(function(c){
      var items=rows.filter(function(a){return a.statut===c[0];});
      grid+='<div ondragover="paDragOver(event)" ondragleave="paDragLeave(event)" ondrop="paKanbanDrop(event,\''+c[0]+'\')" style="border:1px solid rgba(86,10,15,.12);border-top:3px solid '+c[2]+';border-radius:10px;padding:8px 8px;min-width:0;display:flex;flex-direction:column;">'
        + '<div style="font-weight:700;color:'+c[2]+';font-size:12.5px;margin-bottom:6px;">'+c[1]+' <span style="font-weight:400;color:var(--muted);font-size:11px;">('+items.length+')</span></div>'
        + '<div style="overflow-y:auto;max-height:420px;">'+(items.length?items.map(paKanbanCard).join(''):'<div class="edit-hint" style="padding:4px 2px;">—</div>')+'</div></div>';
    });
    grid+='</div>';
    return '<div class="edit-hint" style="margin:2px 0 2px;">'+rows.length+' action(s) · glisse une carte entre colonnes pour changer le statut</div>'+grid;
  }
  window.paKanbanDrop=async function(ev,statut){ ev.preventDefault(); ev.currentTarget.style.background=''; var id=''; try{ id=ev.dataTransfer.getData('text/plain'); }catch(e){} if(!id) id=PA_DRAG_ID; PA_DRAG_ID=null; if(!id) return; await window.paSetStatut(id,statut); };

  // ---------- Vue Archivées ----------
  function paArchiveHtml(){
    var nbFaites=PA_LIST.filter(function(a){return a.statut==='fait';}).length;
    var head='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0 8px;"><span class="edit-hint">'+PA_ARCHIVED.length+' action(s) archivée(s)</span>'
      +(nbFaites?'<button class="add-btn sm" onclick="paArchiveDone()" type="button" style="margin-left:auto;">Archiver les '+nbFaites+' action(s) faite(s)</button>':'')+'</div>';
    if(!PA_ARCHIVED.length) return head+'<div class="edit-hint" style="padding:12px 2px;">Aucune action archivée. Le bouton ✕ archive une action ; les actions « faites » peuvent être archivées en lot ci-dessus.</div>';
    var rows=PA_ARCHIVED.filter(paMatch).map(function(a){
      var when=a.archived_at?String(a.archived_at).slice(0,10):'';
      return '<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 4px;border-bottom:1px solid rgba(86,10,15,.10);opacity:.8;">'
        + '<div style="flex:1;min-width:0;">'+paTitleLine(a,true)+'<div class="edit-hint" style="margin-top:2px;">'+paEsc(paThemeLib(a.thematique))+' · '+paEsc(paPiloteNom(a.pilote_id))+' · '+paStatutLabel(a.statut)+(when?(' · archivée le '+when):'')+'</div></div>'
        + (paCanEdit(a) ? '<button onclick="paEdit(\''+a.id+'\')" type="button" class="add-btn sm" style="flex:0 0 auto;background:#fff;color:#560A0F;">Modifier</button><button onclick="paRestore(\''+a.id+'\')" type="button" class="add-btn sm" style="flex:0 0 auto;background:#fff;color:#560A0F;">Restaurer</button>' : '')+'</div>';
    }).join('');
    return head+'<div>'+rows+'</div>';
  }
  window.paRestore=async function(id){ try{ var r=await SB.from('actions').update({archived_at:null}).eq('id',id); if(r.error) throw r.error; PA_ARCHIVED=PA_ARCHIVED.filter(function(x){return x.id!==id;}); await paLoadList(); paRepaint(); }catch(e){ PA_MSG='Restauration refusée : '+(e.message||e); paRepaint(); } };
  window.paArchiveDone=async function(){ var ids=PA_LIST.filter(function(a){return a.statut==='fait';}).map(function(a){return a.id;}); if(!ids.length) return; try{ var r=await SB.from('actions').update({archived_at:new Date().toISOString()}).in('id',ids); if(r.error) throw r.error; await paLoadList(); await paLoadArchived(); paRepaint(); }catch(e){ PA_MSG='Archivage refusé : '+(e.message||e); paRepaint(); } };

  // ---------- Statut / archive / drag ----------
  function paGroupedHtml(list, keyFn, emptyMsg){
    if(!list.length) return '<div class="edit-hint" style="padding:10px 2px;">'+emptyMsg+'</div>';
    var groups={}, order=[];
    list.forEach(function(a){ var k=String(keyFn(a)); if(!groups[k]){ groups[k]=[]; order.push(k); } groups[k].push(a); });
    order.sort(function(x,y){return x.localeCompare(y);});
    var total=list.length;
    return '<div class="edit-hint" style="margin:2px 0;">'+order.length+' groupe(s) \u00b7 '+total+' action(s)</div>'+order.map(function(k){
      var items=groups[k].sort(function(a,b){return (a.echeance||'').localeCompare(b.echeance||'');});
      return '<div style="margin-bottom:12px;"><div style="font-weight:700;color:#560A0F;font-size:13px;margin:6px 0 4px;border-bottom:2px solid rgba(86,10,15,.15);padding-bottom:2px;">'+paEsc(k)+' <span style="font-weight:400;color:var(--muted);font-size:11px;">('+items.length+')</span></div>'+items.map(paPeriodRow).join('')+'</div>';
    }).join('');
  }
  function paRoutineHtml(){ var all=PA_LIST.filter(paMatch).filter(function(a){return a.routine && String(a.routine).trim();}); return paGroupedHtml(all, function(a){return a.routine;}, 'Aucune action rattachée à une routine. Coche « routine » dans un CR, ou renseigne le champ Routine d\'une action.'); }
  function paProjetHtml(){ var all=PA_LIST.filter(paMatch).filter(function(a){return a.projet && String(a.projet).trim();}); return paGroupedHtml(all, function(a){return a.projet;}, 'Aucune action rattachée à un projet. Renseigne le champ Projet d\'une action.'); }
  function paPeriodRow(a){
    var done=(a.statut==='fait'||a.statut==='abandonne'); var over=paOverdue(a);
    return '<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 6px;border-bottom:1px solid rgba(86,10,15,.08);border-radius:6px;'+(over?'background:#fdecea;':'')+(done?'opacity:.55;':'')+'">'
      +'<div style="flex:1;min-width:0;">'+paTitleLine(a,done)+'<div class="edit-hint" style="margin-top:2px;">'+paMetaLine(a)+'</div></div>'
      +paActionButtons(a)+'</div>';
  }
  function paPeriodeHtml(){
    var from=PA_PERIOD.from, to=PA_PERIOD.to, gran=PA_PERIOD.gran;
    var all=PA_LIST.filter(paMatch);
    function gchip(v,l){ var on=gran===v; return '<button onclick="paSetPeriodGran(\''+v+'\')" type="button" style="font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid '+(on?'#560A0F':'rgba(86,10,15,.28)')+';background:'+(on?'#560A0F':'#fff')+';color:'+(on?'#fff':'#560A0F')+';cursor:pointer;font-family:inherit;margin-right:6px;">'+l+'</button>'; }
    var ctrl='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 10px;">'
      +'<span class="edit-hint">Grouper par :</span>'+gchip('semaine','Semaine')+gchip('mois','Mois')
      +'<span class="edit-hint" style="margin-left:8px;">Du</span><input type="date" value="'+(from||'')+'" onchange="paSetPeriodRange(\'from\',this.value)" style="'+paSelStyle()+'width:auto;">'
      +'<span class="edit-hint">au</span><input type="date" value="'+(to||'')+'" onchange="paSetPeriodRange(\'to\',this.value)" style="'+paSelStyle()+'width:auto;">'
      +((from||to)?'<button class="add-btn sm" onclick="paClearPeriod()" type="button" style="background:#fff;color:#560A0F;">Effacer la plage</button>':'')
      +'</div>';
    var today=paToday(); var late=[], none=[], groups={}, order=[];
    all.forEach(function(a){
      if(!a.echeance){ none.push(a); return; }
      if(from && a.echeance<from) return;
      if(to && a.echeance>to) return;
      if(a.echeance<today && paOpen(a)){ late.push(a); return; }
      var d=paD(a.echeance); if(!d){ none.push(a); return; }
      var info=(gran==='semaine')?paWeekInfo(d):paMonthInfo(d);
      if(!groups[info.key]){ groups[info.key]={info:info,items:[]}; order.push(info.key); }
      groups[info.key].items.push(a);
    });
    order.sort();
    function grp(title,color,items){ if(!items.length) return ''; items.sort(function(a,b){return (a.echeance||'').localeCompare(b.echeance||'');}); return '<div style="margin-bottom:12px;"><div style="font-weight:700;color:'+color+';font-size:13px;margin:6px 0 4px;border-bottom:2px solid '+color+';padding-bottom:2px;">'+title+' <span style="font-weight:400;color:var(--muted);font-size:11px;">('+items.length+')</span></div>'+items.map(paPeriodRow).join('')+'</div>'; }
    var out=ctrl;
    out+=grp('En retard','#c0392b',late);
    order.forEach(function(k){ out+=grp(groups[k].info.lbl,'#560A0F',groups[k].items); });
    if(!from && !to) out+=grp('Sans échéance','#2980b9',none);
    var totalShown=late.length+none.length+order.reduce(function(x,k){return x+groups[k].items.length;},0);
    return '<div class="edit-hint" style="margin:2px 0 2px;">'+totalShown+' action(s)</div>'+out;
  }
  window.paSetPeriodGran=function(v){ PA_PERIOD.gran=v; paRenderResults(); };
  window.paSetPeriodRange=function(k,v){ PA_PERIOD[k]=v; paRenderResults(); };
  window.paClearPeriod=function(){ PA_PERIOD.from=''; PA_PERIOD.to=''; paRenderResults(); };
  window.paSetStatut=async function(id,statut){ try{ var r=await SB.from('actions').update({statut:statut}).eq('id',id); if(r.error) throw r.error; var a=PA_LIST.find(function(x){return x.id===id;}); if(a) a.statut=statut; paRenderResults(); }catch(e){ PA_MSG='Mise à jour refusée : '+(e.message||e); paRepaint(); } };
  window.paArchive=async function(id){ try{ var r=await SB.from('actions').update({archived_at:new Date().toISOString()}).eq('id',id); if(r.error) throw r.error; PA_LIST=PA_LIST.filter(function(x){return x.id!==id;}); paRenderResults(); }catch(e){ PA_MSG='Archivage refusé : '+(e.message||e); paRepaint(); } };
  window.paDragStart=function(ev,id){ PA_DRAG_ID=id; try{ ev.dataTransfer.setData('text/plain',id); ev.dataTransfer.effectAllowed='move'; }catch(e){} };
  window.paDragOver=function(ev){ ev.preventDefault(); try{ ev.dataTransfer.dropEffect='move'; }catch(e){} ev.currentTarget.style.background='rgba(86,10,15,.05)'; };
  window.paDragLeave=function(ev){ ev.currentTarget.style.background=''; };
  window.paDrop=async function(ev,quad){ ev.preventDefault(); ev.currentTarget.style.background=''; var id=''; try{ id=ev.dataTransfer.getData('text/plain'); }catch(e){} if(!id) id=PA_DRAG_ID; PA_DRAG_ID=null; if(!id) return; await paMoveTo(id,quad); };
  async function paMoveTo(id,quad){
    var a=PA_LIST.find(function(x){return x.id===id;}); if(!a) return;
    var imp=(quad==='q1'||quad==='q2'), urg=(quad==='q1'||quad==='q3');
    var patch={priorite:imp?(a.priorite<=2?a.priorite:2):3, urgent_override:urg};
    try{ var r=await SB.from('actions').update(patch).eq('id',id); if(r.error) throw r.error; Object.assign(a,patch); PA_MSG=''; paRenderResults(); }catch(e){ PA_MSG='Déplacement refusé : '+(e.message||e); paRepaint(); }
  }
  window.openPlanModal=function(){
    var ov=document.getElementById('paModalOverlay'); if(ov) ov.remove();
    ov=document.createElement('div'); ov.id='paModalOverlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto;';
    ov.onclick=function(e){ if(e.target===ov) window.closePlanModal(); };
    var box=document.createElement('div');
    box.style.cssText='background:#f6f1e7;max-width:1100px;width:100%;border-radius:14px;padding:18px 18px 26px;box-shadow:0 20px 60px rgba(0,0,0,.35);position:relative;';
    box.innerHTML='<button onclick="closePlanModal()" title="Fermer" type="button" style="position:absolute;top:10px;right:12px;background:#560A0F;color:#fff;border:none;border-radius:8px;padding:4px 11px;font-size:15px;cursor:pointer;z-index:2;">\u2715</button><div id="paModalBody"></div>';
    ov.appendChild(box); document.body.appendChild(ov);
    document.addEventListener('keydown', paModalEsc);
    renderPlanAction('paModalBody');
  };
  function paModalEsc(e){ if(e.key==='Escape') window.closePlanModal(); }
  window.closePlanModal=function(){ var ov=document.getElementById('paModalOverlay'); if(ov) ov.remove(); document.removeEventListener('keydown', paModalEsc); PA_ROOT='view'; };
})();

// ===== Module Compte-rendu (feuille CR de l'onglet "CR et Actions") =====
// Préparation IA (met en avant les actions de l'interlocuteur + questions), puis
// Réalisation/Synthèse : dictée des échanges -> CR prêt à copier + actions décidées
// créées dans la feuille Actions (avec n°, pilote, quadrant). CR historisés.
(function(){
  var CR_ROOT='view', CR_REFS=null, CR_LIST=[], CR_CUR=null, CR_BUSY=false, CR_MSG='';
  var CR_REC=null, CR_RECORDING=false, CR_DICT='';
  var CR_EDIT_PREP=false, CR_EDIT_SYNTH=false;

  function e(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function auth(){ return {'Content-Type':'application/json', Authorization:'Bearer '+SB_SESSION.access_token}; }
  function today(){ return new Date().toISOString().slice(0,10); }
  function sel(){ return 'width:100%;box-sizing:border-box;font-size:13px;padding:7px 9px;border:1px solid rgba(86,10,15,.25);border-radius:8px;font-family:inherit;'; }
  function piloteNom(id){ if(!id) return ''; var p=((CR_REFS&&CR_REFS.pilotes)||[]).find(function(x){return x.id===id;}); return p?p.nom:''; }
  function piloteId(nom){ var p=((CR_REFS&&CR_REFS.pilotes)||[]).find(function(x){return x.nom===nom;}); return p?p.id:null; }
  function crQuad(prio,ech){
    var imp=(prio||2)<=2, urg=false;
    if(ech){ var t=new Date(ech+'T00:00:00'); if(!isNaN(t.getTime())){ var lim=new Date(); lim.setHours(0,0,0,0); lim.setDate(lim.getDate()+7); urg=t<=lim; } }
    if(imp&&urg) return 'Q1 · Faire'; if(imp&&!urg) return 'Q2 · Planifier'; if(!imp&&urg) return 'Q3 · Déléguer'; return 'Q4 · Plus tard';
  }
  function md(txt){
    var raw=String(txt==null?'':txt);
    function inl(t){ return e(t).replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img alt="$1" src="$2" style="max-width:100%;border-radius:8px;margin:6px 0;display:block;">').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code style="background:rgba(86,10,15,.06);padding:1px 4px;border-radius:4px;">$1</code>'); }
    var lines=raw.split(/\r?\n/), out=[], i=0;
    var H={'#':'font-size:17px;font-weight:800;color:#560A0F;margin:14px 0 6px;','##':'font-size:15px;font-weight:800;color:#560A0F;margin:14px 0 6px;border-bottom:2px solid rgba(86,10,15,.15);padding-bottom:3px;','###':'font-size:13.5px;font-weight:700;color:#8a1a22;margin:10px 0 4px;'};
    while(i<lines.length){ var l=lines[i];
      if(/^\s*$/.test(l)){ i++; continue; }
      if(/^---+\s*$/.test(l)){ out.push('<hr style="border:none;border-top:1px solid rgba(86,10,15,.12);margin:12px 0;">'); i++; continue; }
      var hm=l.match(/^(#{1,3})\s+(.*)$/);
      if(hm){ out.push('<div style="'+(H[hm[1]]||H['###'])+'">'+inl(hm[2])+'</div>'); i++; continue; }
      if(/^\s*\|.*\|\s*$/.test(l) && i+1<lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i+1])){
        var head=l.trim().replace(/^\||\|$/g,'').split('|').map(function(c){return c.trim();}); i+=2; var rows=[];
        while(i<lines.length && /^\s*\|.*\|\s*$/.test(lines[i])){ rows.push(lines[i].trim().replace(/^\||\|$/g,'').split('|').map(function(c){return c.trim();})); i++; }
        var th='<tr>'+head.map(function(c){return '<th style="text-align:left;padding:5px 8px;border-bottom:2px solid rgba(86,10,15,.2);font-size:12px;color:#560A0F;">'+inl(c)+'</th>';}).join('')+'</tr>';
        var tr=rows.map(function(r){ return '<tr>'+r.map(function(c){return '<td style="padding:5px 8px;border-bottom:1px solid rgba(86,10,15,.08);font-size:12.5px;vertical-align:top;">'+inl(c)+'</td>';}).join('')+'</tr>'; }).join('');
        out.push('<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;margin:6px 0;">'+th+tr+'</table></div>'); continue;
      }
      if(/^\s*[-*]\s+/.test(l)){ var items=[]; while(i<lines.length && /^\s*[-*]\s+/.test(lines[i])){ items.push(lines[i].replace(/^\s*[-*]\s+/,'')); i++; }
        out.push('<ul style="margin:4px 0 8px;padding-left:20px;">'+items.map(function(it){return '<li style="margin:3px 0;font-size:13px;line-height:1.5;">'+inl(it)+'</li>';}).join('')+'</ul>'); continue; }
      out.push('<p style="margin:5px 0;font-size:13px;line-height:1.55;color:#333;">'+inl(l)+'</p>'); i++;
    }
    return '<div style="color:#333;">'+out.join('')+'</div>';
  }
  var CR_LOCK_TTL=25*60*1000;
  function crUid(){ return (SB_SESSION&&SB_SESSION.user&&SB_SESSION.user.id)||null; }
  function crLockName(uid){ if(!uid) return ''; var p=((CR_REFS&&CR_REFS.pilotes)||[]).find(function(x){return x.user_id===uid;}); return p?p.nom:'un autre utilisateur'; }
  function crLockFresh(c){ if(!c||!c.transcription_par||!c.transcription_le) return false; var age=Date.now()-new Date(c.transcription_le).getTime(); return age>=0 && age<CR_LOCK_TTL; }
  function crLockActiveOther(c){ return crLockFresh(c) && c.transcription_par!==crUid(); }
  function crLockHeure(c){ try{ return new Date(c.transcription_le).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }
  async function crAcquireLock(){ if(!CR_CUR||!CR_CUR.id) return; try{ var iso=new Date().toISOString(); var r=await SB.from('comptes_rendus').update({transcription_par:crUid(), transcription_le:iso}).eq('id',CR_CUR.id); if(!r.error){ CR_CUR.transcription_par=crUid(); CR_CUR.transcription_le=iso; } }catch(e){} }
  async function crReleaseLock(){ var c=CR_CUR; if(!c||!c.id||c.transcription_par!==crUid()) return; try{ await SB.from('comptes_rendus').update({transcription_par:null, transcription_le:null}).eq('id',c.id); }catch(e){} }
  window.crTakeOver=async function(){ await crAcquireLock(); crRepaint(); };

  async function crLoadRefs(){
    if(CR_REFS) return;
    var th=await SB.from('action_thematiques').select('code,libelle').eq('actif',true).order('ordre',{ascending:true});
    var pi=await SB.from('action_pilotes').select('id,nom,user_id,actif,email').eq('actif',true).order('nom',{ascending:true});
    CR_REFS={thematiques:(th&&th.data)||[], pilotes:(pi&&pi.data)||[]};
  }
  async function crLoadList(){
    var q=await SB.from('comptes_rendus').select('id,numero,titre,date_reunion,interlocuteur_id,statut,created_at,transcription_par,transcription_le').order('numero',{ascending:false});
    CR_LIST=(q&&q.data)?q.data:[];
  }

  window.renderCRSheet=async function(rootId){
    CR_ROOT=rootId||'view';
    var z=document.getElementById(CR_ROOT); if(!z) return;
    z.innerHTML='<div class="edit-hint" style="padding:10px 2px;">Chargement…</div>';
    CR_MSG='';
    try { await crLoadRefs(); await crLoadList(); } catch(err){ CR_MSG='Chargement impossible : '+(err.message||err); }
    crRepaint();
  };
  function crRepaint(){
    var z=document.getElementById(CR_ROOT); if(!z) return;
    z.innerHTML = CR_CUR ? crEditorHtml() : crListHtml();
  }

  // ---------- Liste des CR ----------
  function crListHtml(){
    var head='<div class="sec-eyebrow">Réunions</div><div class="sec-title">Réunions &amp; Rituels</div>'
      +'<div style="margin:8px 0 12px;"><button class="add-btn" onclick="crNew()" type="button">+ Nouveau compte-rendu</button></div>'
      +(CR_MSG?'<div class="edit-hint" style="color:var(--signal);margin-bottom:8px;">'+e(CR_MSG)+'</div>':'');
    if(!CR_LIST.length) return head+'<div class="edit-hint" style="padding:10px 2px;">Aucun compte-rendu. Crée le premier.</div>';
    var rows=CR_LIST.map(function(c){
      var st=c.statut==='cloture'?'clôturé':(c.statut==='tenue'?'tenue':'préparation');
      return '<div style="display:flex;gap:10px;align-items:center;padding:9px 6px;border-bottom:1px solid rgba(86,10,15,.10);">'
        +'<div style="flex:1;min-width:0;"><span style="font-size:11px;color:var(--muted);">CR #'+(c.numero||'?')+'</span> <span style="font-size:13px;font-weight:600;color:#560A0F;">'+e(c.titre||'(sans titre)')+'</span>'
        +'<div class="edit-hint" style="margin-top:2px;">'+(c.date_reunion||'')+(c.interlocuteur_id?(' · '+e(piloteNom(c.interlocuteur_id))):'')+' · '+st+(crLockFresh(c)?(' · <span style="color:#c0392b;font-weight:700;">🔴 transcription en cours'+(crLockName(c.transcription_par)?(' ('+e(crLockName(c.transcription_par))+')'):'')+'</span>'):'')+'</div></div>'
        +'<button class="add-btn sm" onclick="crOpen(\''+c.id+'\')" type="button" style="flex:0 0 auto;">Ouvrir</button></div>';
    }).join('');
    return head+'<div>'+rows+'</div>';
  }
  window.crNew=function(){ CR_CUR={ titre:'', date_reunion:today(), interlocuteur_id:'', contexte:'', preparation:'', transcription:'', synthese:'', actions_numeros:[], est_routine:false, statut:'prepa' }; CR_DICT=''; crRepaint(); };
  function crInsertLabel(lbl){ var ta=document.getElementById('crTranscript'); if(!ta) return; var cur=ta.value.replace(/\s+$/,''); ta.value=(cur?(cur+'\n\n'):'')+lbl; CR_DICT=ta.value; if(CR_CUR) CR_CUR.transcription=ta.value; ta.focus(); try{ ta.setSelectionRange(ta.value.length, ta.value.length); }catch(e){} }
  window.crAddMe=function(){ crInsertLabel('Moi : '); };
  window.crAddSpeaker=function(){ var ta=document.getElementById('crTranscript'); var txt=ta?ta.value:''; var max=0,m,re=/Interlocuteur\s+(\d+)/g; while((m=re.exec(txt))){ var n=parseInt(m[1],10); if(n>max) max=n; } crInsertLabel('Interlocuteur '+(max+1)+' : '); };
  window.crListInputs=async function(){
    try{
      var st=await navigator.mediaDevices.getUserMedia({audio:true});
      var devs=await navigator.mediaDevices.enumerateDevices();
      try{ st.getTracks().forEach(function(t){t.stop();}); }catch(e){}
      var ins=devs.filter(function(d){return d.kind==='audioinput';}).map(function(d){return d.label||'(entrée sans nom)';});
      var loop=ins.filter(function(l){return /mix|cable|voicemeeter|vb-audio|loopback|stereo/i.test(l);});
      var msg='Entrées audio détectées :\n- '+ins.join('\n- ')+'\n\n';
      msg += loop.length ? ('Entrée mix/loopback repérée : '+loop.join(', ')+'\n→ définis-la comme MICRO PAR DÉFAUT de Windows (Paramètres son) pour capter toutes les voix.') : 'Aucune entrée mix/loopback détectée.\n→ Solution simple : mets Teams sur HAUT-PARLEURS, le micro captera la salle et les voix distantes.';
      window.alert(msg);
    }catch(e){ window.alert('Impossible de lister les entrées audio : '+(e.message||e)); }
  };
  window.crOpen=async function(id){
    try { var q=await SB.from('comptes_rendus').select('*').eq('id',id).single(); if(q.error) throw q.error; CR_CUR=q.data; CR_DICT=CR_CUR.transcription||''; crRepaint(); }
    catch(err){ CR_MSG='Ouverture impossible : '+(err.message||err); crRepaint(); }
  };
  window.crBack=function(){ crReleaseLock(); CR_CUR=null; CR_MSG=''; crLoadList().then(crRepaint); };

  // ---------- Éditeur (prépa + réalisation) ----------
  function crReadHeader(){
    var g=function(id){ var el=document.getElementById(id); return el?el.value:''; };
    if(!CR_CUR) return;
    CR_CUR.titre=g('crTitre'); CR_CUR.date_reunion=g('crDate')||today(); CR_CUR.interlocuteur_id=g('crInter')||null; CR_CUR.contexte=g('crContexte');
    var cbR=document.getElementById('crRoutine'); if(cbR) CR_CUR.est_routine=!!cbR.checked;
    var parts=[]; var cbs=document.querySelectorAll('.crPart'); for(var k=0;k<cbs.length;k++){ if(cbs[k].checked) parts.push(cbs[k].value); } CR_CUR.participants=parts;
    var auths=[]; var cbs2=document.querySelectorAll('.crAuth'); for(var k2=0;k2<cbs2.length;k2++){ if(cbs2[k2].checked) auths.push(cbs2[k2].value); } CR_CUR.autorises=auths;
    var tr=document.getElementById('crTranscript'); if(tr) CR_CUR.transcription=tr.value;
  }
  function crEditorHtml(){
    var d=CR_CUR;
    var piloteOpts='<option value="">— interlocuteur (pilote) —</option>'+(CR_REFS.pilotes||[]).map(function(p){return '<option value="'+p.id+'"'+(p.id===d.interlocuteur_id?' selected':'')+'>'+e(p.nom)+'</option>';}).join('');
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    var lockedOther=crLockActiveOther(d);
    var mic=(SR&&!lockedOther)?'<button class="add-btn" id="crMic" onclick="crDictate()" type="button">🎤 Dicter les échanges</button>':'';
    var actionsBloc='';
    if(d.actions_numeros&&d.actions_numeros.length){ actionsBloc='<div class="edit-hint" style="margin-top:6px;">Actions créées dans la feuille Actions : '+d.actions_numeros.map(function(n){return '#'+n;}).join(', ')+'</div>'; }
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><button class="add-btn sm" onclick="crBack()" type="button" style="background:#fff;color:#560A0F;">← Liste</button>'
      +'<div class="sec-title" style="margin:0;">'+(d.id?('CR #'+(d.numero||'')):'Nouveau compte-rendu')+'</div></div>'
      +(CR_MSG?'<div class="edit-hint" style="color:var(--signal);margin-bottom:8px;">'+e(CR_MSG)+'</div>':'')
      // en-tête
      +'<div class="panel" style="padding:12px 16px;"><div style="display:flex;gap:10px;flex-wrap:wrap;">'
      +'<label style="flex:2;min-width:200px;font-size:11px;color:var(--muted);">Titre / objet<div style="margin-top:2px;"><input id="crTitre" type="text" value="'+e(d.titre||'')+'" style="'+sel()+'"></div></label>'
      +'<label style="flex:1;min-width:130px;font-size:11px;color:var(--muted);">Date<div style="margin-top:2px;"><input id="crDate" type="date" value="'+(d.date_reunion||today())+'" style="'+sel()+'"></div></label>'
      +'<label style="flex:1;min-width:160px;font-size:11px;color:var(--muted);">Interlocuteur<div style="margin-top:2px;"><select id="crInter" style="'+sel()+'">'+piloteOpts+'</select></div></label>'
      +'<label style="flex:1 1 100%;font-size:12.5px;color:#333;display:inline-flex;align-items:center;gap:6px;margin-top:6px;"><input type="checkbox" id="crRoutine"'+(d.est_routine?' checked':'')+'> C\'est une <b>routine (AIC)</b> \u2014 les actions décidées alimenteront la vue Routine du plan d\'action (sinon : réunion ponctuelle, pas de remontée)</label>'
      +'<div style="flex:1 1 100%;font-size:11px;color:var(--muted);margin-top:2px;">Participants (pour l\'envoi par mail)<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">'+((CR_REFS.pilotes||[]).filter(function(p){return p.email;}).map(function(p){ var on=(d.participants||[]).indexOf(p.id)>=0; return '<label style="font-size:12.5px;color:#333;display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" class="crPart" value="'+p.id+'"'+(on?' checked':'')+'> '+e(p.nom)+'</label>'; }).join('')||'<span class="edit-hint">Aucun pilote avec e-mail — renseigne-les dans Admin → Pilotes (liaison compte).</span>')+'</div></div>'
      +'<div style="flex:1 1 100%;font-size:11px;color:var(--muted);margin-top:6px;">Autorisés à consulter ce CR (en plus de l\'émetteur et des participants)<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">'+((CR_REFS.pilotes||[]).filter(function(p){return p.user_id;}).map(function(p){ var on=(d.autorises||[]).indexOf(p.id)>=0; return '<label style="font-size:12.5px;color:#333;display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" class="crAuth" value="'+p.id+'"'+(on?' checked':'')+'> '+e(p.nom)+'</label>'; }).join('')||'<span class="edit-hint">Aucun compte lié.</span>')+'</div></div>'
      +'</div></div>'
      // Préparation
      +'<div class="panel" style="padding:12px 16px;margin-top:12px;"><div class="sec-eyebrow" style="margin:0 0 6px;">1 · Préparation</div>'
      +'<div class="sec-note" style="margin:0 0 6px;">Colle le contexte, l\'ordre du jour et l\'objectif. L\'IA met en avant les actions de l\'interlocuteur, puis de l\'équipe, et suggère des questions.</div>'
      +'<textarea id="crContexte" rows="4" placeholder="Contexte / ordre du jour / objectif de la réunion…" style="'+sel()+'resize:vertical;">'+e(d.contexte||'')+'</textarea>'
      +'<div style="margin-top:8px;"><button class="add-btn" onclick="crPrep()" type="button"'+(CR_BUSY?' disabled':'')+'>'+(CR_BUSY?'… analyse':'🧠 Préparer avec l\'IA')+'</button></div>'
      +crPrepBlock(d)
      +'</div>'
      // Réalisation & synthèse
      +'<div class="panel" style="padding:12px 16px;margin-top:12px;"><div class="sec-eyebrow" style="margin:0 0 6px;">2 · Réalisation & synthèse</div>'
      +'<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">'+mic+'<span class="edit-hint">'+(SR?'Transcrit l\'entrée audio par défaut de Windows.':'Dictée indisponible sur ce navigateur — colle la transcription ci-dessous.')+'</span></div>'
      +(SR?'<div style="background:#f3ede1;border:1px solid rgba(86,10,15,.15);border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:12px;color:#560A0F;"><b>Capter toutes les voix (visio) :</b> Web Speech transcrit l\'entrée micro <b>par défaut de Windows</b> (l\'app ne peut pas la choisir). Deux options : <b>1)</b> mets Teams sur <b>haut-parleurs</b> — le micro capte alors la salle + les voix distantes. <b>2)</b> mets une entrée <b>« mix/loopback »</b> (Stereo Mix, VB-Audio, VoiceMeeter) comme <b>micro par défaut</b> de Windows. <button class="add-btn sm" onclick="crListInputs()" type="button" style="background:#fff;color:#560A0F;margin-left:4px;">🎧 Vérifier mes entrées audio</button></div>':'')
      +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center;"><span class="edit-hint">Marquer qui parle :</span><button class="add-btn sm" onclick="crAddMe()" type="button" style="background:#fff;color:#560A0F;">🙋 Moi</button><button class="add-btn sm" onclick="crAddSpeaker()" type="button" style="background:#fff;color:#560A0F;">🗣 + Interlocuteur</button></div>'
      +'<textarea id="crTranscript" rows="6" placeholder="Transcription des échanges (dictée ou saisie). Utilise les boutons ci-dessus pour marquer chaque intervenant." style="'+sel()+'resize:vertical;">'+e(d.transcription||'')+'</textarea>'
      +(lockedOther ? ('<div style="background:#fdecea;border:1px solid #c0392b;border-radius:8px;padding:8px 12px;margin-top:8px;color:#c0392b;font-size:12.5px;">⚠ Transcription en cours par <b>'+e(crLockName(d.transcription_par))+'</b> depuis '+crLockHeure(d)+'. <button class="add-btn sm" onclick="crTakeOver()" type="button" style="margin-left:6px;">Prendre la main</button></div>') : ('<div style="margin-top:8px;"><button class="add-btn" onclick="crSynth()" type="button"'+(CR_BUSY?' disabled':'')+'>'+(CR_BUSY?'… synthèse':'✨ Générer la synthèse + les actions')+'</button></div>'))
      +crSynthBlock(d)
      +'</div>'
      +'<div style="display:flex;gap:8px;margin-top:12px;"><button class="add-btn" onclick="crSave()" type="button">✓ Enregistrer le CR</button><button class="add-btn sm" onclick="crBack()" type="button" style="background:#fff;color:#560A0F;">Fermer</button></div>';
  }

  // ---------- Préparation IA ----------
  window.crPrep=async function(){
    if(CR_BUSY) return; crReadHeader();
    if(!CR_CUR.contexte || !CR_CUR.contexte.trim()){ CR_MSG='Renseigne le contexte / ordre du jour.'; crRepaint(); return; }
    CR_BUSY=true; CR_MSG=''; crRepaint();
    var ctrl=new AbortController(); var to=setTimeout(function(){ ctrl.abort(); }, 30000);
    try {
      var q=await SB.from('actions').select('numero,libelle,statut,echeance,priorite,pilote_id,source').is('archived_at',null).order('numero',{ascending:false}).limit(80);
      var acts=((q&&q.data)||[]).map(function(a){ return { numero:a.numero, libelle:a.libelle, statut:a.statut, echeance:a.echeance, priorite:a.priorite, pilote:piloteNom(a.pilote_id), source:a.source }; });
      var res=await fetch('/api/cr-ia',{method:'POST',headers:auth(),signal:ctrl.signal,body:JSON.stringify({ mode:'prep', contexte:CR_CUR.contexte, interlocuteur:piloteNom(CR_CUR.interlocuteur_id), today:today(), actions:acts })});
      var j=null; try{ j=await res.json(); }catch(x){}
      if(!res.ok) throw new Error((j&&j.error)?j.error:('le service a répondu '+res.status));
      CR_CUR.preparation=(j&&j.preparation)?j.preparation:'';
      if(!CR_CUR.preparation) throw new Error('réponse vide du modèle');
      try{ await crSaveSilent(); }catch(x){}
    } catch(err){ CR_MSG='Préparation impossible : '+((err&&err.name==='AbortError')?'délai dépassé (>30 s) — réessaie ou raccourcis le contexte.':(err.message||err)); }
    clearTimeout(to); CR_BUSY=false; crRepaint();
  };

  // ---------- Synthèse IA + création des actions ----------
  window.crSynth=async function(){
    if(CR_BUSY) return; crReadHeader();
    if(!CR_CUR.transcription || !CR_CUR.transcription.trim()){ CR_MSG='La transcription est vide.'; crRepaint(); return; }
    try{ if(!CR_CUR.id) await crSaveSilent(); await crAcquireLock(); }catch(x){}
    CR_BUSY=true; CR_MSG=''; crRepaint();
    try {
      var ctrlS=new AbortController(); var toS=setTimeout(function(){ ctrlS.abort(); }, 45000);
      var res=await fetch('/api/cr-ia',{method:'POST',headers:auth(),signal:ctrlS.signal,body:JSON.stringify({ mode:'synthese', transcription:CR_CUR.transcription, contexte:CR_CUR.contexte, interlocuteur:piloteNom(CR_CUR.interlocuteur_id), today:today(),
        pilotes:(CR_REFS.pilotes||[]).map(function(p){return {nom:p.nom};}), thematiques:(CR_REFS.thematiques||[]).map(function(t){return {code:t.code,libelle:t.libelle};}) })});
      var j=null; try{ j=await res.json(); }catch(x){}
      if(!res.ok) throw new Error((j&&j.error)?j.error:('HTTP '+res.status));
      CR_CUR.synthese=j.compte_rendu||'';
      CR_CUR.actions_draft=(Array.isArray(j.actions_decidees)?j.actions_decidees:[]).map(function(a){ return { libelle:a.libelle||'', pilote_id:(a.pilote_nom?piloteId(a.pilote_nom):null), thematique:a.thematique||'autre', echeance:a.echeance||'', priorite:a.priorite||2, include:true }; });
      CR_CUR.statut='tenue';
      await crSaveSilent();
      try{ clearTimeout(toS); }catch(x){}
    } catch(err){ try{ clearTimeout(toS); }catch(x){} CR_MSG='Synthèse impossible : '+((err&&err.name==='AbortError')?'délai dépassé (>45 s) — réessaie.':(err.message||err)); }
    CR_BUSY=false; CR_EDIT_SYNTH=false; crRepaint();
  };

  // ---------- Persistance ----------
  function crRow(){ return { titre:CR_CUR.titre||null, date_reunion:CR_CUR.date_reunion||null, interlocuteur_id:CR_CUR.interlocuteur_id||null, contexte:CR_CUR.contexte||null, preparation:CR_CUR.preparation||null, transcription:CR_CUR.transcription||null, synthese:CR_CUR.synthese||null, actions_numeros:CR_CUR.actions_numeros||[], participants:CR_CUR.participants||[], autorises:CR_CUR.autorises||[], est_routine:!!CR_CUR.est_routine, statut:CR_CUR.statut||'prepa' }; }
  async function crSaveSilent(){
    if(CR_CUR.id){ var r=await SB.from('comptes_rendus').update(crRow()).eq('id',CR_CUR.id); if(r.error) throw r.error; }
    else { var r2=await SB.from('comptes_rendus').insert(crRow()).select('id,numero').single(); if(r2.error) throw r2.error; CR_CUR.id=r2.data.id; CR_CUR.numero=r2.data.numero; }
  }
  window.crSave=async function(){ crReadHeader(); CR_MSG=''; try{ await crSaveSilent(); await crLoadList(); crRepaint(); }catch(err){ CR_MSG='Enregistrement refusé : '+(err.message||err); crRepaint(); } };
  window.crCopy=function(){ var t=CR_CUR&&CR_CUR.synthese?CR_CUR.synthese:''; try{ if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t); }catch(x){} window.prompt('Compte-rendu (Ctrl/Cmd+C pour copier) :', t); };
  window.crCopyPrep=function(){ var t=CR_CUR&&CR_CUR.preparation?CR_CUR.preparation:''; try{ if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t); }catch(x){} window.prompt('Préparation (Ctrl/Cmd+C pour copier) :', t); };
  window.crMail=function(kind){ crReadHeader(); var content=kind==='prep'?(CR_CUR.preparation||''):(CR_CUR.synthese||''); if(!content) return; var emails=(CR_CUR.participants||[]).map(function(id){ var p=((CR_REFS&&CR_REFS.pilotes)||[]).find(function(x){return x.id===id;}); return p?p.email:null; }).filter(Boolean); if(!emails.length){ window.alert('Aucun participant avec e-mail sélectionné. Coche des participants (leur e-mail se renseigne dans Admin → Pilotes, en les liant à un compte).'); return; } var subj=(kind==='prep'?'Préparation — ':'Compte-rendu — ')+(CR_CUR.titre||'réunion'); try{ if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(content); }catch(x){} var body=encodeURIComponent('Bonjour,\n\n'+(kind==='prep'?'Préparation':'Compte-rendu')+' de la réunion « '+(CR_CUR.titre||'')+' ».\n\nLe contenu complet a été copié dans le presse-papier : colle-le ici (Ctrl+V).\n'); window.location.href='mailto:'+encodeURIComponent(emails.join(','))+'?subject='+encodeURIComponent(subj)+'&body='+body; };

  // ---------- Dictée (transcription) ----------
  window.crDictate=function(){
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR) return;
    if(CR_RECORDING){ CR_RECORDING=false; if(CR_REC){ try{ CR_REC.stop(); }catch(x){} } var b0=document.getElementById('crMic'); if(b0) b0.textContent='🎤 Dicter les échanges'; return; }
    var ta0=document.getElementById('crTranscript'); CR_DICT=ta0?ta0.value.replace(/\s+$/,''):'';
    CR_RECORDING=true; var b1=document.getElementById('crMic'); if(b1) b1.textContent='⏹ Arrêter';
    if(CR_CUR&&CR_CUR.id) crAcquireLock();
    crStartRec(SR);
  };
  function crStartRec(SR){
    CR_REC=new SR(); CR_REC.lang='fr-FR'; CR_REC.interimResults=true; CR_REC.continuous=true;
    CR_REC.onresult=function(ev){ var interim='';
      for(var i=ev.resultIndex;i<ev.results.length;i++){ var r=ev.results[i]; if(r.isFinal){ var seg=(r[0].transcript||'').trim(); if(seg){ CR_DICT+=(CR_DICT&&!/\s$/.test(CR_DICT)?' ':'')+seg; } } else interim+=r[0].transcript; }
      var ta=document.getElementById('crTranscript'); if(ta) ta.value=CR_DICT+(interim?(CR_DICT?' ':'')+interim:'');
    };
    CR_REC.onerror=function(ev){ if(ev&&(ev.error==='not-allowed'||ev.error==='service-not-allowed')){ CR_RECORDING=false; var b=document.getElementById('crMic'); if(b) b.textContent='🎤 Dicter les échanges'; } };
    CR_REC.onend=function(){ if(CR_RECORDING){ try{ crStartRec(SR); return; }catch(x){} } var b=document.getElementById('crMic'); if(b) b.textContent='🎤 Dicter les échanges'; };
    try{ CR_REC.start(); }catch(x){}
  }
  // ===== Éditabilité (prépa / synthèse / actions) + images =====
  function crPrepBlock(d){
    if(!d.preparation && !CR_EDIT_PREP) return '';
    var body, btns;
    if(CR_EDIT_PREP){
      body='<textarea id="crPrepEdit" rows="14" style="'+sel()+'resize:vertical;font-family:inherit;line-height:1.5;">'+e(d.preparation||'')+'</textarea>'
        +'<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;"><button class="add-btn" onclick="crSavePrep()" type="button">✓ Enregistrer</button><button class="add-btn sm" onclick="crAddImage(\'prep\')" type="button" style="background:#fff;color:#560A0F;">🖼 Joindre une image</button><button class="add-btn sm" onclick="crCancelEdit()" type="button" style="background:#fff;color:#560A0F;">Annuler</button></div>';
      btns='';
    } else {
      body=md(d.preparation||'');
      btns='<button class="add-btn sm" onclick="crEditPrep()" type="button">✏️ Modifier</button> <button class="add-btn sm" onclick="crCopyPrep()" type="button">📋 Copier</button> <button class="add-btn sm" onclick="crMail(\'prep\')" type="button">📧 Envoyer</button>';
    }
    return '<div style="margin-top:10px;border-top:1px solid rgba(86,10,15,.12);padding-top:10px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px;"><b style="color:#560A0F;">Note de préparation</b><div>'+btns+'</div></div>'+body+'</div>';
  }

  function crSynthBlock(d){
    var draft=(d.actions_draft&&d.actions_draft.length)?crActionsReview(d):'';
    var recap=(d.actions_numeros&&d.actions_numeros.length)?('<div class="edit-hint" style="margin-top:8px;">Actions créées dans la feuille Actions : '+d.actions_numeros.map(function(n){return '#'+n;}).join(', ')+'</div>'):'';
    if(!d.synthese && !CR_EDIT_SYNTH) return draft;
    var body, btns;
    if(CR_EDIT_SYNTH){
      body='<textarea id="crSynthEdit" rows="16" style="'+sel()+'resize:vertical;font-family:inherit;line-height:1.5;">'+e(d.synthese||'')+'</textarea>'
        +'<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;"><button class="add-btn" onclick="crSaveSynth()" type="button">✓ Enregistrer</button><button class="add-btn sm" onclick="crAddImage(\'synthese\')" type="button" style="background:#fff;color:#560A0F;">🖼 Joindre une image</button><button class="add-btn sm" onclick="crCancelEdit()" type="button" style="background:#fff;color:#560A0F;">Annuler</button></div>';
      btns='';
    } else {
      body=md(d.synthese||'');
      btns='<button class="add-btn sm" onclick="crEditSynth()" type="button">✏️ Modifier</button> <button class="add-btn sm" onclick="crCopy()" type="button">📋 Copier</button> <button class="add-btn sm" onclick="crMail(\'synthese\')" type="button">📧 Envoyer</button>';
    }
    return '<div style="margin-top:10px;border-top:1px solid rgba(86,10,15,.12);padding-top:10px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px;"><b style="color:#560A0F;">Compte-rendu</b><div>'+btns+'</div></div>'+body+recap+draft+'</div>';
  }

  function crActionsReview(d){
    function themeOpts(s){ return (CR_REFS.thematiques||[]).map(function(t){return '<option value="'+t.code+'"'+(t.code===s?' selected':'')+'>'+e(t.libelle)+'</option>';}).join(''); }
    function pilOpts(s){ return '<option value="">— pilote —</option>'+(CR_REFS.pilotes||[]).map(function(p){return '<option value="'+p.id+'"'+(p.id===s?' selected':'')+'>'+e(p.nom)+'</option>';}).join(''); }
    function prioOpts(s){ return [[1,'Haute'],[2,'Normale'],[3,'Basse']].map(function(o){return '<option value="'+o[0]+'"'+(o[0]===s?' selected':'')+'>'+o[1]+'</option>';}).join(''); }
    var rows=d.actions_draft.map(function(a,i){
      return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid rgba(86,10,15,.08);">'
        +'<input type="checkbox" onchange="crDraftToggle('+i+')"'+(a.include?' checked':'')+' title="Inclure">'
        +'<input type="text" value="'+e(a.libelle||'')+'" onchange="crDraftField('+i+',\'libelle\',this.value)" placeholder="Action" style="flex:2;min-width:200px;'+sel()+'">'
        +'<select onchange="crDraftField('+i+',\'pilote_id\',this.value)" style="min-width:130px;'+sel()+'width:auto;">'+pilOpts(a.pilote_id)+'</select>'
        +'<select onchange="crDraftField('+i+',\'thematique\',this.value)" style="min-width:120px;'+sel()+'width:auto;">'+themeOpts(a.thematique)+'</select>'
        +'<input type="date" value="'+(a.echeance||'')+'" onchange="crDraftField('+i+',\'echeance\',this.value)" style="'+sel()+'width:auto;">'
        +'<select onchange="crDraftField('+i+',\'priorite\',this.value)" style="'+sel()+'width:auto;">'+prioOpts(a.priorite)+'</select>'
        +'<button class="add-btn sm" onclick="crDraftRemove('+i+')" type="button" style="background:#fff;color:#560A0F;">✕</button></div>';
    }).join('');
    return '<div style="margin-top:12px;background:rgba(239,184,16,.10);border:1px solid rgba(239,184,16,.45);border-radius:8px;padding:10px 12px;">'
      +'<div style="font-weight:700;color:#560A0F;margin-bottom:4px;">Actions décidées à créer <span class="edit-hint" style="font-weight:400;">— modifie, coche, supprime ou ajoute, puis crée-les</span></div>'
      +rows
      +'<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;"><button class="add-btn sm" onclick="crDraftAdd()" type="button" style="background:#fff;color:#560A0F;">+ Ajouter une action</button><button class="add-btn" onclick="crCreateActions()" type="button"'+(CR_BUSY?' disabled':'')+'>'+(CR_BUSY?'… création':'✓ Créer les actions cochées')+'</button></div></div>';
  }

  window.crEditPrep=function(){ CR_EDIT_PREP=true; crRepaint(); };
  window.crSavePrep=function(){ var t=document.getElementById('crPrepEdit'); if(t) CR_CUR.preparation=t.value; crReadHeader(); CR_EDIT_PREP=false; crSaveSilent().then(crRepaint).catch(function(err){ CR_MSG='Enregistrement refusé : '+(err.message||err); crRepaint(); }); };
  window.crEditSynth=function(){ CR_EDIT_SYNTH=true; crRepaint(); };
  window.crSaveSynth=function(){ var t=document.getElementById('crSynthEdit'); if(t) CR_CUR.synthese=t.value; crReadHeader(); CR_EDIT_SYNTH=false; crSaveSilent().then(crRepaint).catch(function(err){ CR_MSG='Enregistrement refusé : '+(err.message||err); crRepaint(); }); };
  window.crCancelEdit=function(){ CR_EDIT_PREP=false; CR_EDIT_SYNTH=false; crRepaint(); };

  window.crDraftField=function(i,f,v){ var a=CR_CUR&&CR_CUR.actions_draft&&CR_CUR.actions_draft[i]; if(!a) return; if(f==='priorite') a[f]=parseInt(v,10)||2; else if(f==='pilote_id') a[f]=v||null; else a[f]=v; };
  window.crDraftToggle=function(i){ var a=CR_CUR&&CR_CUR.actions_draft&&CR_CUR.actions_draft[i]; if(a){ a.include=!a.include; crRepaint(); } };
  window.crDraftRemove=function(i){ if(CR_CUR&&CR_CUR.actions_draft){ CR_CUR.actions_draft.splice(i,1); crRepaint(); } };
  window.crDraftAdd=function(){ if(!CR_CUR.actions_draft) CR_CUR.actions_draft=[]; CR_CUR.actions_draft.push({libelle:'',pilote_id:null,thematique:'autre',echeance:'',priorite:2,include:true}); crRepaint(); };
  window.crCreateActions=async function(){
    if(CR_BUSY) return; crReadHeader();
    var drafts=(CR_CUR.actions_draft||[]).filter(function(a){return a.include && a.libelle && a.libelle.trim();});
    if(!drafts.length){ CR_MSG='Aucune action cochée à créer.'; crRepaint(); return; }
    CR_BUSY=true; CR_MSG=''; crRepaint();
    var nums=CR_CUR.actions_numeros?CR_CUR.actions_numeros.slice():[], recap=[];
    for(var i=0;i<drafts.length;i++){ var a=drafts[i];
      var row={ texte_brut:'[CR] '+a.libelle.trim(), libelle:a.libelle.trim(), thematique:a.thematique||'autre', pilote_id:a.pilote_id||null, echeance:a.echeance||null, priorite:a.priorite||2, statut:'a_faire', tags:[], source:('CR'+((CR_CUR&&CR_CUR.titre)?(' : '+CR_CUR.titre):'')), routine:((CR_CUR&&CR_CUR.est_routine&&CR_CUR.titre)?CR_CUR.titre:null) };
      try { var r=await SB.from('actions').insert(row).select('numero,pilote_id,priorite,echeance').single();
        if(!r.error&&r.data){ nums.push(r.data.numero); recap.push('- #'+r.data.numero+' — '+a.libelle.trim()+(piloteNom(a.pilote_id)?(' — '+piloteNom(a.pilote_id)):'')+' — '+crQuad(r.data.priorite,r.data.echeance)); } } catch(x){}
    }
    if(recap.length){ CR_CUR.synthese=(CR_CUR.synthese||'')+'\n\n## Actions décidées\n'+recap.join('\n'); }
    CR_CUR.actions_numeros=nums; CR_CUR.actions_draft=[];
    try{ await crSaveSilent(); }catch(x){}
    CR_BUSY=false; CR_MSG=recap.length+' action(s) créée(s) dans la feuille Actions.'; crRepaint();
  };

  window.crAddImage=function(target){
    var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
    inp.onchange=function(){ var f=inp.files&&inp.files[0]; if(f) crUploadImage(f,target); };
    inp.click();
  };
  async function crUploadImage(file,target){
    try{
      if(!CR_CUR.id){ await crSaveSilent(); }
      if(file.size>5*1024*1024) throw new Error('image > 5 Mo');
      var ext=((file.name||'img').split('.').pop()||'png').toLowerCase().replace(/[^a-z0-9]/g,'')||'png';
      var path='cr/'+CR_CUR.id+'/'+Date.now()+'.'+ext;
      var up=await SB.storage.from('cr-images').upload(path,file,{upsert:true,contentType:file.type||'image/png'});
      if(up.error) throw up.error;
      var pub=SB.storage.from('cr-images').getPublicUrl(path);
      var url=(pub&&pub.data)?pub.data.publicUrl:'';
      if(!url) throw new Error('URL publique indisponible');
      var img='\n\n![image]('+url+')\n';
      if(target==='prep'){ var tp=document.getElementById('crPrepEdit'); if(tp){ tp.value+=img; CR_CUR.preparation=tp.value; } else CR_CUR.preparation=(CR_CUR.preparation||'')+img; }
      else { var ts=document.getElementById('crSynthEdit'); if(ts){ ts.value+=img; CR_CUR.synthese=ts.value; } else CR_CUR.synthese=(CR_CUR.synthese||'')+img; }
      await crSaveSilent(); crRepaint();
    }catch(err){ CR_MSG='Image refusée : '+(err.message||err)+' (le bucket « cr-images » doit exister et être public).'; crRepaint(); }
  }

})();

(function(){
  function showSetPassword(){
    if(document.getElementById('spOverlay')) return;
    var ov=document.createElement('div'); ov.id='spOverlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML='<div style="background:#f6f1e7;max-width:420px;width:100%;border-radius:14px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:inherit;">'
      +'<div style="font-weight:800;color:#560A0F;font-size:18px;margin-bottom:4px;">Bienvenue sur KW Cockpit</div>'
      +'<div style="font-size:13px;color:#555;margin-bottom:14px;">Définissez votre mot de passe pour activer votre accès.</div>'
      +'<input id="spPw" type="password" placeholder="Nouveau mot de passe (8+ caractères)" style="width:100%;box-sizing:border-box;font-size:14px;padding:9px 11px;border:1px solid rgba(86,10,15,.3);border-radius:9px;margin-bottom:8px;">'
      +'<input id="spPw2" type="password" placeholder="Confirmer" style="width:100%;box-sizing:border-box;font-size:14px;padding:9px 11px;border:1px solid rgba(86,10,15,.3);border-radius:9px;margin-bottom:10px;">'
      +'<div id="spMsg" style="font-size:12.5px;color:#c0392b;min-height:16px;margin-bottom:8px;"></div>'
      +'<button id="spBtn" type="button" style="width:100%;background:#560A0F;color:#fff;border:none;border-radius:9px;padding:11px;font-size:15px;font-weight:700;cursor:pointer;">Activer mon accès</button></div>';
    document.body.appendChild(ov);
    document.getElementById('spBtn').addEventListener('click', async function(){
      var pw=(document.getElementById('spPw')||{}).value||'', pw2=(document.getElementById('spPw2')||{}).value||'', m=document.getElementById('spMsg');
      if(pw.length<8){ m.style.color='#c0392b'; m.textContent='Mot de passe trop court (8 caractères min).'; return; }
      if(pw!==pw2){ m.style.color='#c0392b'; m.textContent='Les deux mots de passe ne correspondent pas.'; return; }
      m.style.color='#555'; m.textContent='Activation…';
      try{ var r=await SB.auth.updateUser({password:pw}); if(r.error) throw r.error; m.style.color='#2e7d46'; m.textContent='Mot de passe défini. Connectez-vous.'; try{ await SB.auth.signOut(); }catch(e){} try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){} setTimeout(function(){ ov.remove(); }, 1600); }
      catch(e){ m.style.color='#c0392b'; m.textContent='Échec : '+(e.message||e); }
    });
  }
  function boot(){
    try{
      var h=location.hash||'';
      if(!/type=(invite|recovery)/i.test(h)) return;
      var sb=(typeof initSupabase==='function')?initSupabase():null; if(!sb) return;
      setTimeout(function(){ sb.auth.getSession().then(function(s){ if(s&&s.data&&s.data.session) showSetPassword(); }).catch(function(){}); }, 500);
    }catch(e){}
  }
  if(document.readyState==='loading') window.addEventListener('DOMContentLoaded', boot); else boot();
})();
