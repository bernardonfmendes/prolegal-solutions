// Prolegal Solutions: service worker. Guarda apenas a "casca" da app para abrir sem ligação.
// Os dados (reuniões, prazos) vêm sempre do Supabase e nunca são guardados em cache.
const CACHE = 'prolegal-app-v6';
const SHELL = [
  './',
  'index.html',
  'app.js?v=6',
  'config.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Só tratamos pedidos GET ao próprio site. Supabase e CDN seguem diretamente para a rede.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('index.html')))
  );
});

// ---------- Alertas (Web Push) ----------
// A notificação chega mesmo com a app fechada. O conteúdo vem da função no Supabase.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { corpo: event.data ? event.data.text() : '' }; }
  const titulo = d.titulo || 'Prolegal Solutions';
  event.waitUntil(self.registration.showNotification(titulo, {
    body: d.corpo || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.tag || undefined,          // um aviso novo do mesmo registo substitui o anterior
    renotify: !!d.tag,
    data: { dia: d.dia || null },
    requireInteraction: false
  }));
});

// Tocar na notificação abre a app, no dia do registo
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const dia = event.notification.data && event.notification.data.dia;
  const destino = dia ? ('index.html#dia=' + dia) : 'index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.includes('/app/') && 'focus' in c) {
          if (dia && 'navigate' in c) c.navigate(destino).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
