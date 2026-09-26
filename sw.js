/* Service worker: la app funciona sin internet una vez cargada. */
const CACHE = 'pizzeria-v7';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/styles.css', './css/responsive.css', './img/icon.svg', './vendor/qrcode.js', './vendor/supabase.js', './js/config.js', './js/cloud.js', './js/seed.js', './js/views/negocio.js', './js/views/equipo.js', './js/views/gastos.js', './js/views/plataforma.js', './js/views/perfil.js',
  './js/core.js', './js/carta-core.js', './js/mp.js', './js/online.js', './js/views/online.js', './js/store.js', './js/auth.js', './js/ticket.js', './js/charts.js', './js/help.js', './js/app.js',
  './js/views/inicio.js', './js/views/vender.js', './js/views/pedidos.js', './js/views/caja.js', './js/views/historial.js',
  './js/views/clientes.js', './js/views/menu.js', './js/views/stock.js', './js/views/reportes.js', './js/views/config.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Red primero (para recibir actualizaciones), caché si no hay conexión
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Solo archivos propios de la app: las llamadas a Supabase van directo
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
