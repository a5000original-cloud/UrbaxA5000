/* ═══════════════════════════════════════════════════════════
   URBaxA5000 · Service Worker · A5000 Labs
   ═══════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v11';
const CACHE_NAME    = `urbaxa-${CACHE_VERSION}`;
const RUNTIME_CACHE = `urbaxa-runtime-${CACHE_VERSION}`;
const TILES_CACHE   = `urbaxa-tiles-${CACHE_VERSION}`;
const FONTS_CACHE   = `urbaxa-fonts-${CACHE_VERSION}`;
const IMAGES_CACHE  = `urbaxa-images-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
];

const TILES_MAX = 220;
const IMAGES_MAX = 60;

/* ═══ INSTALL ═══ */
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        PRECACHE.map(url =>
          cache.add(url).catch(err => {
            console.warn('⚠ precache fail:', url, err);
            return null;
          })
        )
      )
    )
  );
});

/* ═══ ACTIVATE ═══ */
self.addEventListener('activate', (e) => {
  const KEEP = [CACHE_NAME, RUNTIME_CACHE, TILES_CACHE, FONTS_CACHE, IMAGES_CACHE];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !KEEP.includes(k)).map(k => {
          console.log('🗑 delete cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

/* ═══ FETCH ═══ */
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Weather — always network, offline → JSON error
  if (url.hostname.includes('open-meteo')) {
    e.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ error: 'offline' }),
        { headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Map tiles — SWR with limit
  if (url.hostname.includes('cartocdn') || url.hostname.includes('arcgisonline') || url.hostname.includes('basemaps')) {
    e.respondWith(staleWhileRevalidate(request, TILES_CACHE, TILES_MAX));
    return;
  }

  // Fonts — cache-first
  if (url.hostname.includes('fonts.googleapis') || url.hostname.includes('fonts.gstatic')) {
    e.respondWith(cacheFirst(request, FONTS_CACHE));
    return;
  }

  // CDN — cache-first
  if (url.hostname.includes('unpkg') || url.hostname.includes('cdnjs') || url.hostname.includes('jsdelivr')) {
    e.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Images — cache-first with limit
  if (request.destination === 'image' || url.pathname.match(/\.(png|jpe?g|webp|gif|svg|ico)$/i)) {
    e.respondWith(cacheFirst(request, IMAGES_CACHE, IMAGES_MAX));
    return;
  }

  // HTML/JS/CSS/JSON — network-first with cache fallback
  if (request.mode === 'navigate' || url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.js') || url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.json')) {
    e.respondWith(networkFirst(request, CACHE_NAME));
    return;
  }

  // Default — network with runtime cache
  e.respondWith(
    fetch(request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const clone = res.clone();
        caches.open(RUNTIME_CACHE).then(c => c.put(request, clone));
      }
      return res;
    }).catch(() => caches.match(request))
  );
});

/* ═══ STRATEGIES ═══ */
async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request);
    if (res && res.status === 200) {
      const clone = res.clone();
      caches.open(cacheName).then(c => c.put(request, clone));
    }
    return res;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(request, cacheName, maxItems) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.status === 200) {
      const clone = res.clone();
      const cache = await caches.open(cacheName);
      await cache.put(request, clone);
      if (maxItems) trimCache(cacheName, maxItems);
    }
    return res;
  } catch (err) {
    return new Response('', { status: 408, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request, cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(res => {
    if (res && res.status === 200) {
      cache.put(request, res.clone());
      if (maxItems) trimCache(cacheName, maxItems);
    }
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    trimCache(cacheName, maxItems);
  }
}

/* ═══ PUSH ═══ */
self.addEventListener('push', (e) => {
  let data = {
    title: 'UrbaxA5000',
    body: 'Что-то новое',
    icon: './icon.svg',
    badge: './icon.svg',
    tag: 'urbaxa',
    url: './'
  };
  try { if (e.data) data = { ...data, ...e.data.json() }; }
  catch (err) { if (e.data) data.body = e.data.text(); }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      vibrate: [100, 50, 100],
      data: { url: data.url },
      actions: data.actions || [
        { action: 'open',  title: 'Открыть' },
        { action: 'close', title: 'Закрыть' }
      ]
    })
  );
});

/* ═══ NOTIFICATION CLICK ═══ */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'close') return;
  const urlToOpen = e.notification.data?.url || './';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        for (const c of list) {
          if (c.url.includes('index.html') && 'focus' in c) return c.focus();
        }
        if (clients.openWindow) return clients.openWindow(urlToOpen);
      })
  );
});

/* ═══ MESSAGE ═══ */
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'clearCache') caches.keys().then(k => Promise.all(k.map(n => caches.delete(n))));
});
