/* Clap! — service worker des notifications « actions en retard » (public/clap/sw.js, portée /clap/)
   Reçoit la liste à jour de MES actions en retard (envoyée par la fonction Netlify push-actions) et met les notifications en conformité :
   une notification silencieuse par action en retard (sur Android, le chiffre de l'icône = le nombre de notifications),
   retirée dès que l'action n'est plus en retard. À zéro : une seule notification discrète « plus aucune action en retard ».
   Aucun cache de pages : ce service worker ne sert QUE les notifications (le fonctionnement hors ligne n'est pas modifié). */
'use strict';
const PREFIX = 'clap-a-', OK = 'clap-ok', MORE = 'clap-plus', ICON = '/clap/icon-192.png', BADGE = '/clap/badge-96.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function frDate(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
function daysLate(iso, today) { const a = Date.parse(iso + 'T00:00:00Z'), b = Date.parse((today || '') + 'T00:00:00Z'); return isFinite(a) && isFinite(b) ? Math.round((b - a) / 864e5) : 0; }

async function apply(data) {
  const items = Array.isArray(data.items) ? data.items : [], n = Number(data.n) || items.length;
  const want = new Map(items.map((a) => [PREFIX + a.id, a]));
  const shown = await self.registration.getNotifications();
  const have = new Set();
  for (const nt of shown) {
    if (nt.tag && nt.tag.indexOf(PREFIX) === 0) { if (want.has(nt.tag)) have.add(nt.tag); else nt.close(); }
    else if (nt.tag === OK && n > 0) nt.close();
    else if (nt.tag === MORE && n <= items.length) nt.close();
  }
  const jobs = [];
  for (const [tag, a] of want) {
    if (have.has(tag)) continue;
    const d = daysLate(a.e, data.d);
    jobs.push(self.registration.showNotification((a.no ? 'Action #' + a.no : 'Action') + ' en retard' + (d > 0 ? ' · ' + d + ' j' : ''), {
      body: (a.l || '') + (a.e ? '\nÉchéance : ' + frDate(a.e) : ''),
      tag, icon: ICON, badge: BADGE, silent: true, renotify: false, timestamp: a.e ? Date.parse(a.e + 'T09:00:00') : Date.now(),
      data: { url: '/clap/', action: a.id },
    }));
  }
  if (n === 0 && !shown.some((nt) => nt.tag === OK)) {
    jobs.push(self.registration.showNotification('Clap! · plus aucune action en retard', {
      body: 'Bravo, tout est à jour.', tag: OK, icon: ICON, badge: BADGE, silent: true, data: { url: '/clap/' } }));
  }
  if (n > items.length) {   /* au-delà de 20, une notification récapitulative signale le reste */
    jobs.push(self.registration.showNotification('Clap! · ' + n + ' actions en retard', { body: 'Les ' + items.length + ' plus anciennes sont détaillées ; ouvre Clap! pour voir le reste.', tag: MORE, icon: ICON, badge: BADGE, silent: true, renotify: false, data: { url: '/clap/' } }));
  }
  await Promise.all(jobs);
  try { if (self.navigator.setAppBadge) { if (n > 0) await self.navigator.setAppBadge(n); else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge(); } } catch (e) {}
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  if (data.t !== 'retards') {
    event.waitUntil(self.registration.showNotification('Clap!', { body: (data && data.body) || 'Ouvre Clap! pour voir tes actions.', tag: 'clap-info', icon: ICON, badge: BADGE, silent: true, data: { url: '/clap/' } }));
    return;
  }
  event.waitUntil(apply(data));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/clap/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.indexOf('/clap/') >= 0 && 'focus' in c) { try { c.postMessage({ t: 'ouvrir-actions' }); } catch (e) {} return c.focus(); } }
    return self.clients.openWindow(url + (url.indexOf('?') < 0 ? '?feuille=actions' : ''));
  })());
});
