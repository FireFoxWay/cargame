// Offline cache for the installed app. Game files are fetched network-first, so every push
// to the repo shows up on the next launch; the pinned three.js and fonts are cache-first.
const CACHE = 'afterglow-v2';
const CORE = [
  './',
  './index.html',
  './editor.html',
  './levels.json',
  './manifest.webmanifest',
  './icon.svg',
  './css/game.css',
  './assets/world-map.webp',
  './music/playlist.json',
  './js/audio/audio.js',
  './js/car/car.js',
  './js/car/physics.js',
  './js/core/config.js',
  './js/core/state.js',
  './js/core/util.js',
  './js/game/camera.js',
  './js/game/effects.js',
  './js/game/freeroam.js',
  './js/game/input.js',
  './js/game/race.js',
  './js/game/stage.js',
  './js/gfx/particles.js',
  './js/gfx/renderer.js',
  './js/gfx/shaders.js',
  './js/gfx/sky.js',
  './js/gfx/textures.js',
  './js/lib/three.js',
  './js/main.js',
  './js/ui/hud.js',
  './js/ui/menus.js',
  './js/ui/worldmap.js',
  './js/world/circuit.js',
  './js/world/course.js',
  './js/world/mapdata.js',
  './js/world/openworld.js',
  './js/world/props.js',
  './js/world/roadmat.js',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
const put = (req, res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((k) => k.put(req, c)); } return res; };
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then((r) => put(e.request, r)).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else if (/(^|\.)cdn\.jsdelivr\.net$|^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => put(e.request, r))));
  }
});
