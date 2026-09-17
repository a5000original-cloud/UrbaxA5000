const CACHE_NAME = 'urbaxa-v9';
const RUNTIME_CACHE = 'urbaxa-runtime-v9';
const PRECACHE = [
  './', './index.html', './manifest.json', './icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
];
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(cache =>
    Promise.all(PRECACHE.map(url => cache.add(url).catch(() => null)))
  ));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.includes('open-meteo')) return;
  if (url.hostname.includes('cartocdn') || url.hostname.includes('arcgisonline')) return;
  if (url.hostname.includes('fonts.googleapis') || url.hostname.includes('fonts.gstatic') || url.hostname.includes('unpkg') || url.hostname.includes('cdnjs')){
    e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(RUNTIME_CACHE).then(cc => cc.put(e.request, clone));
      return res;
    }).catch(() => c)));
    return;
  }
  e.respondWith(fetch(e.request).then(res => {
    if (res && res.status === 200 && res.type === 'basic'){
      const clone = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
    }
    return res;
  }).catch(() => caches.match(e.request).then(c => c || caches.match('./index.html'))));
});
