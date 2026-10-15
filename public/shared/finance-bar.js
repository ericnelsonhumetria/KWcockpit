/* COCKPIT KW — Visibilité de la barre « Mettre à jour toutes les données financières » (public/shared/finance-bar.js)
   Problème corrigé : la barre s'affichait dans des onglets où elle n'a pas de sens (Parcours candidats, Cerebro, vue RH…).
   Cause : sa visibilité n'était réglée qu'au début de renderTab(), or plusieurs onglets sont affichés par des enveloppes de renderTab
   qui n'appellent jamais l'original : la barre gardait alors l'état de l'onglet précédent (visible si on venait du Tableau de bord).
   Règle unique, indépendante de l'ordre de chargement et de toute enveloppe : la barre est visible SEULEMENT si
     · la personne est de la direction (rôle « eric ») ET
     · la zone financière du Tableau de bord (#finZone) est affichée.
   C'est exactement l'usage du bouton : il rafraîchit cette zone (et, s'il est cliqué ailleurs, il vous y ramène : surprenant dans une autre vue).
   Partout ailleurs (autres onglets, vues RH et Finance du bandeau Cycle de vie, autres rôles) elle est masquée.
   Le réglage est refait à CHAQUE changement réel d'onglet ou de vue, observé dans le DOM : aucun onglet futur ne peut la réafficher à tort.
   À charger n'importe où après le HTML (une ligne <script> dans index.html). */
(function(){
  if (window.__kwFinanceBar) return;                    /* idempotent */
  window.__kwFinanceBar = true;

  function wanted(){
    if (typeof CURRENT_ROLE === 'undefined' || CURRENT_ROLE !== 'eric') return false;
    return !!document.getElementById('finZone');                       /* zone financière du Tableau de bord présente = bouton utile */
  }
  function sync(){
    var bar = document.getElementById('kwGlobalRefreshBar'); if (!bar) return;
    var show = wanted();
    var want = show ? '' : 'none';
    if (bar.style.display !== want) bar.style.display = want;
  }

  function start(){
    sync();                                                              /* masquée dès le chargement (écran de connexion) */
    if (!window.MutationObserver) return;
    var obs = new MutationObserver(sync);
    var tabs = document.getElementById('tabs'), view = document.getElementById('view');
    if (tabs) obs.observe(tabs, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });   /* onglet actif, onglets ajoutés */
    if (view) obs.observe(view, { childList: true });                                                                /* contenu remplacé : onglet, vue RH/Finance, retour direction */
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.kwFinanceBarSync = sync;
})();
