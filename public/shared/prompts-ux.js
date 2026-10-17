/* COCKPIT KW — Fin des fenêtres grises « prompt » et « confirm » du navigateur (public/shared/prompts-ux.js)
   Additif : une seule ligne <script> dans index.html, APRÈS dialogs.js (et avant session-restore.js). Retour arrière : retirer la ligne.
   PRINCIPE (aucune logique d'origine n'est réécrite) : pour chaque fonction concernée, on la lance une première fois en lisant ses questions (prompt) ou sa
   demande de confirmation (confirm) SANS rien exécuter ; on affiche alors un vrai formulaire (tous les champs d'un coup, champs nommés, liste pour les choix) ou une
   vraie fenêtre de confirmation ; puis on relance la fonction d'origine en lui « soufflant » vos réponses. Elle fait donc EXACTEMENT ce qu'elle faisait avant.
   Si dialogs.js n'est pas chargé, rien n'est modifié.
   PROMPT remplacés (13 fonctions) : plan de route technique (ajout, modification, sous-étape), jalons de projet, missions du plan de charge (ajout, affectation d'un consultant
   par e-mail), consultants et compétences de la matrice, éléments de la bibliothèque (ajout, renommage), prospects Humetria (ajout, modification), flèche entre blocs.
   CONFIRM remplacés (23 fonctions) : toutes les suppressions et retraits simples. Laissés tels quels, volontairement : ceux où une action a lieu AVANT la question
   (fin de la visite guidée Humetria, initialisation de l'Obeya Humetria), l'envoi des relances par mail et l'ajout de charges prévisionnelles. */
(function(){
  'use strict';
  if (window.__kwPrx) return; window.__kwPrx = true;
  var ABORT = { kwAbort:true };
  function swallow(r){ if (r && typeof r.then === 'function') r.then(null, function(e){ if (e !== ABORT) setTimeout(function(){ throw e; }); }); }
  var STAT = [{ value:'a_contacter', label:'À contacter' }, { value:'en_discussion', label:'En discussion' }, { value:'proposition', label:'Proposition' }, { value:'gagne', label:'Gagné' }, { value:'perdu', label:'Perdu' }];

  /* ---- formulaires : une entrée par fonction ; 'n' = nombre de questions posées, 'fields' décrit chaque question (reconnue par son texte) ---- */
  var PROMPTS = {
    roadmapAdd:{ n:3, title:'Nouveau chantier', ok:'Ajouter', fields:[
      { m:/Titre du chantier/i, label:'Titre du chantier', required:true },
      { m:/Cat[ée]gorie/i, label:'Catégorie', type:'select', options:['Cockpit', 'Clap!', 'Humetria', 'Infra', 'Sécurité', 'Data', 'Autre'] },
      { m:/Trimestre/i, label:'Trimestre', placeholder:'2026-Q1' } ] },
    roadmapEdit:{ n:5, title:'Modifier le chantier', ok:'Enregistrer', fields:[
      { m:/^Titre/i, label:'Titre', required:true }, { m:/Description/i, label:'Description', type:'textarea' },
      { m:/Cat[ée]gorie/i, label:'Catégorie', type:'select', options:['Cockpit', 'Clap!', 'Humetria', 'Infra', 'Sécurité', 'Data', 'Autre'] },
      { m:/Trimestre/i, label:'Trimestre', placeholder:'2026-Q1' },
      { m:/Priorit/i, label:'Priorité', type:'select', options:[{ value:'1', label:'1 — haute' }, { value:'2', label:'2 — moyenne' }, { value:'3', label:'3 — basse' }] } ] },
    roadmapAddStep:{ n:1, title:'Nouvelle sous-étape', ok:'Ajouter', fields:[{ m:/./, label:'Libellé de la sous-étape', required:true }] },
    addJalon:{ n:2, title:'Nouveau jalon', ok:'Ajouter', fields:[{ m:/jalon/i, label:'Libellé du jalon', required:true }, { m:/ch[ée]ance/i, label:'Échéance', placeholder:'ex. 15 juil.' }] },
    pdccAddMission:{ n:3, title:'Nouvelle mission', ok:'Créer', fields:[
      { m:/Code/i, label:'Code de la mission', required:true, hint:'Identifiant unique, sans espace.' }, { m:/Intitul/i, label:'Intitulé de la mission' }, { m:/Client/i, label:'Client' } ] },
    addConsultant:{ n:1, title:'Ajouter un consultant', ok:'Ajouter', fields:[{ m:/./, label:'Nom du consultant', required:true }] },
    addSkill:{ n:1, title:'Ajouter une compétence', ok:'Ajouter', fields:[{ m:/./, label:'Nom de la compétence', required:true }] },
    addItemBiblio:{ n:1, title:'Ajouter un élément', ok:'Ajouter', fields:[{ m:/./, required:true }] },
    renameLivrable:{ n:1, title:'Renommer', ok:'Renommer', fields:[{ m:/./, label:'Nouveau nom', required:true }] },
    humetriaAddProspect:{ n:1, title:'Nouveau prospect', ok:'Ajouter', fields:[{ m:/./, label:'Nom du prospect', required:true }] },
    humetriaEditProspect:{ n:5, title:'Modifier le prospect', ok:'Enregistrer', fields:[
      { m:/^Nom/i, label:'Nom', required:true }, { m:/^Contact/i, label:'Contact' }, { m:/^Statut/i, label:'Statut', type:'select', options:STAT },
      { m:/^Note/i, label:'Note', type:'textarea' }, { m:/Prochaine/i, label:'Prochaine action' } ] },
    humAddConnector:{ n:1, title:'Flèche entre deux blocs', ok:'Créer la flèche', fields:[{ m:/./, label:'Libellé de la flèche (facultatif)', hint:'Exemples : « bloque », « alimente ».' }] }
  };
  function mkField(spec, a, i){
    var s = null; for (var k = 0; k < spec.fields.length; k++){ if (spec.fields[k].m.test(a.msg)){ s = spec.fields[k]; break; } }
    s = s || { m:/./ };
    var f = { name:'f' + i, label:s.label || a.msg.replace(/\s*[:?]\s*$/, ''), type:s.type || 'text', value:a.def, required:!!s.required, placeholder:s.placeholder, hint:s.hint };
    if (f.type === 'select'){
      var opts = (s.options || []).slice(), has = opts.some(function(o){ return String((o && typeof o === 'object') ? o.value : o) === String(a.def); });
      if (!has && a.def !== '') opts.unshift(a.def); f.options = opts;
    }
    return f;
  }
  function viaPrompt(name, spec){
    var orig = window[name]; if (typeof orig !== 'function' || orig.__kwPrx || typeof window.kwDialog !== 'function') return false;
    var w = function(){
      var self = this, args = [].slice.call(arguments), asked = [], real = window.prompt, realAlert = window.alert, held = [];
      window.alert = function(m){ held.push(m); };                                   /* 1er passage : alertes mises de côté (une fonction qui attrape elle-même l'interruption afficherait un faux message) */
      window.prompt = function(msg, def){ asked.push({ msg:String(msg == null ? '' : msg), def:def == null ? '' : String(def) }); if (asked.length >= spec.n) throw ABORT; return def == null ? 'x' : String(def); };
      try { swallow(orig.apply(self, args)); } catch(e){ window.prompt = real; window.alert = realAlert; if (e !== ABORT) throw e; } finally { window.prompt = real; window.alert = realAlert; }
      if (!asked.length){ held.forEach(function(m){ window.alert(m); }); return; }   /* la fonction n'a rien à demander (garde atteinte) : ce qu'elle voulait dire est dit */
      var fields = asked.map(function(a, i){ return mkField(spec, a, i); });
      return window.kwDialog({ title:spec.title, message:spec.message, fields:fields, confirmLabel:spec.ok || 'Valider' }).then(function(res){
        if (!res) return;                                                             /* Annuler = prompt() qui renvoie null : la fonction d'origine ne fait rien */
        var ans = fields.map(function(f){ return res[f.name]; }), k = 0;
        window.prompt = function(){ var v = ans[k++]; return v == null ? '' : String(v); };
        try { return orig.apply(self, args); } finally { window.prompt = real; }
      });
    };
    w.__kwPrx = true; window[name] = w; return true;
  }
  /* ---- confirmations ---- */
  var CONFIRMS = { removePanelRow:'Retirer cette ligne', pdcResetOne:'Réinitialiser', finMarkSelectedPaye:'Marquer comme payées', finMarkPaye:'Marquer comme payée', removeObj:'Supprimer cet objectif', removeMyObj:'Supprimer mon objectif',
    refuserObj:'Refuser cet objectif', removeConsultant:'Retirer le consultant', removeSkill:'Retirer la compétence', removeLivrable:'Supprimer cet élément', removeProjet:'Supprimer le projet',
    integrerBPStandard:'Intégrer comme standard', ecarterBPSuggestion:'Écarter la suggestion', pdccDelMission:'Supprimer la mission', pdccDelConsultant:'Retirer le consultant', archiveCandidat:'Archiver le candidat',
    finProjDelete:'Supprimer cette ligne', roadmapDel:'Supprimer le chantier', humetriaDelBloc:'Supprimer le bloc', humetriaDelFile:'Supprimer le fichier', humetriaDelProspect:'Supprimer le prospect',
    humDelConnector:'Supprimer la flèche', humCmtDel:'Supprimer le commentaire' };
  var SOFT = { finMarkSelectedPaye:1, finMarkPaye:1, integrerBPStandard:1, ecarterBPSuggestion:1, archiveCandidat:1, pdcResetOne:1 };   /* non destructifs : bouton non rouge */
  function viaConfirm(name, title){
    var orig = window[name]; if (typeof orig !== 'function' || orig.__kwPrx || typeof window.kwConfirm !== 'function') return false;
    var w = function(){
      var self = this, args = [].slice.call(arguments), msg = null, real = window.confirm, realAlert = window.alert, held = [];
      window.alert = function(m){ held.push(m); };
      window.confirm = function(m){ msg = String(m == null ? '' : m); throw ABORT; };
      try { swallow(orig.apply(self, args)); } catch(e){ window.confirm = real; window.alert = realAlert; if (e !== ABORT) throw e; } finally { window.confirm = real; window.alert = realAlert; }
      if (msg === null){ held.forEach(function(m){ window.alert(m); }); return; }   /* aucune question posée : la fonction s'est déroulée comme avant */
      return window.kwConfirm({ title:title, message:msg, confirmLabel:title.split(' ')[0], danger:!SOFT[name] }).then(function(yes){
        if (!yes) return;
        window.confirm = function(){ return true; };
        try { return orig.apply(self, args); } finally { window.confirm = real; }
      });
    };
    w.__kwPrx = true; window[name] = w; return true;
  }
  /* ---- affectation d'un consultant par e-mail (menu « nouveau… ») : cas particulier, la question dépend du menu ---- */
  function wrapAffPick(){
    var orig = window.pdccAffPick; if (typeof orig !== 'function' || orig.__kwPrx || typeof window.kwDialog !== 'function') return;
    var w = function(mission, sel){
      if (sel && sel.value === '__new__'){
        sel.value = '';
        return window.kwDialog({ title:'Affecter un consultant', fields:[{ name:'email', label:'E-mail du consultant', type:'email', required:true, placeholder:'prenom.nom@kaizen-way.com' }], confirmLabel:'Affecter' })
          .then(function(r){ if (r && r.email && typeof window.pdccAddAff === 'function') return window.pdccAddAff(mission, r.email.trim().toLowerCase()); });
      }
      return orig.apply(this, arguments);
    };
    w.__kwPrx = true; window.pdccAffPick = w;
  }
  /* ---- addItemBiblio : la question nomme l'élément et la phase ; on la reprend dans le titre du formulaire ---- */
  function install(){
    var done = { prompt:[], confirm:[] };
    Object.keys(PROMPTS).forEach(function(n){ if (viaPrompt(n, PROMPTS[n])) done.prompt.push(n); });
    Object.keys(CONFIRMS).forEach(function(n){ if (viaConfirm(n, CONFIRMS[n])) done.confirm.push(n); });
    wrapAffPick(); window.kwPromptsUx = done; return done;
  }
  install();
})();
