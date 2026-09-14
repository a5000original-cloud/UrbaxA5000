/* URBaxA5000 — Service Worker · A5000 Labs · v2 */
const CACHE_NAME = 'urbaxa-v4';
const RUNTIME_CACHE = 'urbaxa-runtime-v3';
const PRECACHE = ['./','./index.html','./manifest.json','./icon.svg'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.includes('cartocdn') || url.hostname.includes('arcgisonline') || url.hostname.includes('open-meteo')) return;

  if (url.hostname.includes('fonts.googleapis') || url.hostname.includes('fonts.gstatic') || url.hostname.includes('unpkg') || url.hostname.includes('cdnjs')){
    e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(RUNTIME_CACHE).then(cc => cc.put(e.request, clone));
      return res;
    })));
    return;
  }

  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic'){
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
  );
});

self.addEventListener('push', (e) => {
  let data = { title: 'UrbaxA5000', body: 'Что-то новое' };
  try { if (e.data) data = e.data.json(); } catch(err){}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: './icon.svg', badge: './icon.svg',
    tag: data.tag || 'urbaxa', vibrate: [100, 50, 100],
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) if (c.url.includes('index.html') && 'focus' in c) return c.focus();
    if (clients.openWindow) return clients.openWindow(e.notification.data.url || './');
  }));
});
