/* ═══════════════════════════════════════════════════════════
   URBaxA5000 · Service Worker
   A5000 Labs · v9
   ═══════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v9';
const CACHE_NAME = `urbaxa-${CACHE_VERSION}`;
const RUNTIME_CACHE = `urbaxa-runtime-${CACHE_VERSION}`;
const IMAGES_CACHE = `urbaxa-images-${CACHE_VERSION}`;
const TILES_CACHE = `urbaxa-tiles-${CACHE_VERSION}`;
const FONTS_CACHE = `urbaxa-fonts-${CACHE_VERSION}`;

// Файлы, которые кэшируем сразу при установке
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
];

// Лимиты для кэшей (чтобы не забивать память)
const TILES_MAX = 200;
const IMAGES_MAX = 60;

/* ═══ УСТАНОВКА ═══ */
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        PRECACHE.map(url =>
          cache.add(url).catch(err => {
            console.warn('⚠ Не удалось закэшировать:', url, err);
            return null;
          })
        )
      )
    )
  );
});

/* ═══ АКТИВАЦИЯ ═══ */
self.addEventListener('activate', (e) => {
  const KEEP = [CACHE_NAME, RUNTIME_CACHE, IMAGES_CACHE, TILES_CACHE, FONTS_CACHE];
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => !KEEP.includes(k))
            .map(k => {
              console.log('🗑 Удаляю старый кэш:', k);
              return caches.delete(k);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ═══ FETCH ═══ */
self.addEventListener('fetch', (e) => {
  const { request } = e;

  // Только GET
  if (request.method !== 'GET') return;

  // Skip chrome extensions и разные схемы
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // ═══ ПОГОДА — только сеть (всегда свежая), офлайн — отдаём ошибку ═══
  if (url.hostname.includes('open-meteo')) {
    e.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // ═══ ТАЙЛЫ КАРТЫ — stale-while-revalidate + лимит ═══
  if (url.hostname.includes('cartocdn') || url.hostname.includes('arcgisonline') || url.hostname.includes('basemaps')) {
    e.respondWith(staleWhileRevalidate(request, TILES_CACHE, TILES_MAX));
    return;
  }

  // ═══ ШРИФТЫ — cache-first (не меняются) ═══
  if (url.hostname.includes('fonts.googleapis') || url.hostname.includes('fonts.gstatic')) {
    e.respondWith(cacheFirst(request, FONTS_CACHE));
    return;
  }

  // ═══ CDN (Leaflet и т.д.) — cache-first ═══
  if (url.hostname.includes('unpkg') || url.hostname.includes('cdnjs') || url.hostname.includes('jsdelivr')) {
    e.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // ═══ КАРТИНКИ — cache-first + лимит ═══
  if (request.destination === 'image' || url.pathname.match(/\.(png|jpe?g|webp|gif|svg|ico)$/i)) {
    e.respondWith(cacheFirst(request, IMAGES_CACHE, IMAGES_MAX));
    return;
  }

  // ═══ HTML/JS/CSS — network-first с fallback на кэш ═══
  if (request.mode === 'navigate' || url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.js') || url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.json')) {
    e.respondWith(networkFirst(request, CACHE_NAME));
    return;
  }

  // ═══ Остальное — network с fallback ═══
  e.respondWith(
    fetch(request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});

/* ═══ СТРАТЕГИИ КЭШИРОВАНИЯ ═══ */

// Network-first: свежий контент, при офлайне — из кэша
async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request);
    if (res && res.status === 200) {
      const clone = res.clone();
      const cache = await caches.open(cacheName);
      cache.put(request, clone);
    }
    return res;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Fallback на главную страницу для навигационных запросов
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

// Cache-first: сначала кэш, потом сеть
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

// Stale-while-revalidate: сразу из кэша, параллельно обновляем
async function staleWhileRevalidate(request, cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(res => {
      if (res && res.status === 200) {
        cache.put(request, res.clone());
        if (maxItems) trimCache(cacheName, maxItems);
      }
      return res;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

// Обрезаем кэш до лимита (FIFO)
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    trimCache(cacheName, maxItems);
  }
}

/* ═══ PUSH-УВЕДОМЛЕНИЯ ═══ */
self.addEventListener('push', (e) => {
  let data = {
    title: 'UrbaxA5000',
    body: 'Что-то новое',
    icon: './icon.svg',
    badge: './icon.svg',
    tag: 'urbaxa',
    url: './'
  };

  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch (err) {
    if (e.data) data.body = e.data.text();
  }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      vibrate: [100, 50, 100],
      data: { url: data.url },
      actions: data.actions || [
        { action: 'open', title: 'Открыть' },
        { action: 'close', title: 'Закрыть' }
      ]
    })
  );
});

/* ═══ КЛИК ПО УВЕДОМЛЕНИЮ ═══ */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  if (e.action === 'close') return;

  const urlToOpen = e.notification.data?.url || './';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Если уже есть открытое окно — фокусируемся
        for (const client of clientList) {
          if (client.url.includes('index.html') && 'focus' in client) {
            return client.focus();
          }
        }
        // Иначе открываем новое
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

/* ═══ BACKGROUND SYNC ═══ */
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-urbex-data') {
    e.waitUntil(
      // Здесь можно синхронизировать данные с сервером,
      // когда вернётся интернет (пока не используется)
      Promise.resolve()
    );
  }
});

/* ═══ СООБЩЕНИЯ ОТ ПРИЛОЖЕНИЯ ═══ */
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (e.data === 'clearCache') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
  if (e.data?.type === 'notification') {
    self.registration.showNotification(e.data.title || 'UrbaxA5000', {
      body: e.data.body || '',
      icon: './icon.svg',
      badge: './icon.svg',
      tag: 'urbex-' + Date.now(),
      vibrate: [100, 50, 100]
    });
  }
});
