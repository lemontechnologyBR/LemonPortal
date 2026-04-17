const CACHE = 'lemon-v99';
const ASSETS = [
  '/',
  '/css/style.css',
  '/css/admin.css',
  '/js/portal-app.js',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  '/images/regiao-edificios.svg',
  '/images/bourroul-edificios.svg',
  '/images/cingapura-building-blocks.svg',
  '/images/cingapura-house-searching.svg',
  '/images/realparque-paper-map.svg',
  '/images/portal-tablet-login.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/portal/')) return; // API sempre da rede
  if (e.request.url.includes('allorigins.win')) return; // RSS proxy — não cachear
  if (e.request.url.includes('rss2json.com')) return;
  if (e.request.url.includes('open-meteo.com')) return; // clima — sempre rede
  if (e.request.url.includes('nominatim.openstreetmap.org')) return; // cidade (reverse) — não cachear
  if (e.request.url.includes('economia.awesomeapi.com.br')) return; // cotação — sempre rede
  if (e.request.url.includes('date.nager.at')) return; // feriados — sempre rede

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Lemon', body: '', url: '/' };
  try {
    const j = event.data ? event.data.json() : null;
    if (j && typeof j === 'object') data = { ...data, ...j };
  } catch (_) {
    try {
      const t = event.data?.text();
      if (t) data.body = t.slice(0, 500);
    } catch (_) {}
  }
  event.waitUntil(
    self.registration.showNotification(String(data.title || 'Lemon').slice(0, 120), {
      body: String(data.body || '').slice(0, 500),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: typeof data.url === 'string' ? data.url : '/' },
      tag: 'lemon-' + Date.now(),
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification?.data?.url || '/';
  const base = self.location?.origin || self.registration.scope.replace(/\/$/, '');
  const url = /^https?:\/\//i.test(raw) ? raw : new URL(raw.startsWith('/') ? raw : `/${raw}`, base).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const c = list[0];
      if (c && typeof c.navigate === 'function') {
        return c.navigate(url).then(() => c.focus()).catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    })
  );
});
