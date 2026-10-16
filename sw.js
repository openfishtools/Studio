/**
 * OpenFishTools Studio - Service Worker
 * Version: 0.6.0
 *
 * Offline-First + Online Auto-Update Strategy:
 * - Once studio.cutefish.my.id is accessed, all pages (index, desktop, editor)
 *   and all core engines, WASM effects, scripts, styles, and fonts are cached locally.
 * - When OFFLINE: serves 100% of the Studio app instantly from local CacheStorage.
 * - When ONLINE: fetches fresh updates from studio.cutefish.my.id and updates cache automatically.
 */

const CACHE_NAME = 'oft-studio-v0.6.0';

const CORE_ASSETS = [
  './',
  'index.html',
  'desktop.html',
  'editor.html',
  'version.json',
  'manifest.webmanifest',
  // CSS
  'css/theme.css',
  'css/layout.css',
  'css/editor.css',
  'css/desktop.css',
  'css/modal.css',
  'css/popover.css',
  'css/drawer.css',
  'css/switch.css',
  'css/context-menu.css',
  'css/text-format.css',
  'css/segmented-button.css',
  'css/wireframe.css',
  'css/transform-controller.css',
  'css/effects-rack.css',
  'css/color-picker.css',
  'css/template-editor.css',
  'css/safari.css',
  'css/extensions.css',
  'fticons/fticons.css',
  'fticons/fticons.woff2',
  // Core JS
  'js/sync-height.js',
  'js/jszip.min.js',
  'js/db.js',
  'js/modal.js',
  'js/popover.js',
  'js/drawer.js',
  'js/switch.js',
  'js/context-menu.js',
  'js/folderanim.js',
  'js/pwa-install.js',
  'js/main.js',
  'js/wireframe.js',
  'js/canvas-overlay.js',
  'js/shapes.js',
  'js/effects.js',
  'js/color-picker.js',
  'js/fishtool-engine.js',
  'js/fish-audio-engine.js',
  'js/frame-extractor.js',
  'js/preview-cache.js',
  'js/video-stream-manager.js',
  'js/video-decoder-worker.js',
  'js/bg-removal-engine.js',
  'js/template-editor.js',
  'js/text-engine.js',
  'js/motion-blur-engine.js',
  'js/FishExport-Enggine.js',
  'js/editor.js',
  'js/desktop.js',
  'js/attributes-clipboard.js',
  'js/extensions.js',
  'js/extension-manager.js',
  'js/fishtools-adapter.js',
  'js/openfishtools-generators3d.js',
  'js/openfishtools-controller.js',
  'js/JSX-Translator.js',
  // Effects & WASM
  'effects/loader.js',
  'effects/effects.wasm',
  'effects/manifest.json',
  // UI Elements & Shapes & Text
  'element/number-input.js',
  'element/slider.js',
  'element/dropdown.js',
  'element/segmented.js',
  'element/color-input.js',
  'element/index.js',
  'element/card-builder.js',
  'shapes/rectangle.js',
  'shapes/triangle.js',
  'shapes/circle.js',
  'shapes/star.js',
  'shapes/polygon.js',
  'shapes/capsule.js',
  'shapes/heart.js',
  'text/default.js',
  // Vendors
  'vendor/mp4-muxer.js',
  'vendor/lamejs/lame.min.js',
  'vendor/ffmpeg/ffmpeg.min.js',
  'vendor/ffmpeg/ffmpeg-core.js',
  'vendor/ffmpeg/ffmpeg-core.wasm',
  'vendor/ffmpeg/ffmpeg-core.worker.js',
  // Core Fonts & Icons
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/doodles.svg',
  'assets/grid.svg',
  'assets/handles.svg',
  'assets/checkerboard.svg',
  'assets/watermark.svg',
  'assets/fonts/CalSans-SemiBold.woff2',
  'assets/fonts/MaterialIcons-Regular.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        CORE_ASSETS.map(async (assetPath) => {
          try {
            const req = new Request(assetPath, { cache: 'reload' });
            const res = await fetch(req);
            if (res && res.ok) {
              await cache.put(assetPath, res);
            }
          } catch (_) {}
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('oft-studio-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

async function matchFromCache(req) {
  const direct = await caches.match(req);
  if (direct) return direct;
  const ignoreQuery = await caches.match(req, { ignoreSearch: true });
  if (ignoreQuery) return ignoreQuery;
  try {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '') {
      return (await caches.match('index.html', { ignoreSearch: true })) ||
             (await caches.match('./index.html', { ignoreSearch: true }));
    }
    const cleanName = url.pathname.replace(/^\//, '');
    if (cleanName) {
      const byName = await caches.match(cleanName, { ignoreSearch: true });
      if (byName) return byName;
    }
  } catch (_) {}
  return null;
}

function fetchWithTimeout(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Network timeout')), timeoutMs);
    fetch(req)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Bypass API endpoints, live reload, and range requests
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('__live_reload') ||
    url.pathname.includes('__config') ||
    url.protocol.startsWith('chrome-extension') ||
    req.headers.has('range')
  ) {
    return;
  }

  // 1. HTML Navigation (index.html, desktop.html, editor.html, /<presetId>):
  // Network-first when online (auto-updates cache), instant cache fallback when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkRes = await fetchWithTimeout(req, 4000);
          if (networkRes && networkRes.ok) {
            const cache = await caches.open(CACHE_NAME);
            // Store clean pathname for offline navigation (e.g. desktop.html without ?id=...)
            const cleanPath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
            if (['index.html', 'desktop.html', 'editor.html'].includes(cleanPath)) {
              cache.put(cleanPath, networkRes.clone()).catch(() => {});
            }
            cache.put(req, networkRes.clone()).catch(() => {});
            return networkRes;
          }
        } catch (_) {}

        const cached = await matchFromCache(req);
        if (cached) return cached;

        return (await caches.match('index.html', { ignoreSearch: true })) ||
               (await caches.match('./', { ignoreSearch: true })) ||
               new Response('Offline - Please connect to the internet once to initialize FishTools Studio.', {
                 status: 503,
                 headers: { 'Content-Type': 'text/plain; charset=utf-8' }
               });
      })()
    );
    return;
  }

  // 2. Same-origin Studio assets (JS, CSS, WASM, Fonts, SVGs):
  // Network-first when online to guarantee auto-update, fallback to cached copy when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        try {
          const networkRes = await fetchWithTimeout(req, 5000);
          if (networkRes && networkRes.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, networkRes.clone()).catch(() => {});
            const cleanAsset = url.pathname.replace(/^\//, '');
            if (cleanAsset) {
              cache.put(cleanAsset, networkRes.clone()).catch(() => {});
            }
            return networkRes;
          }
        } catch (_) {}

        const cached = await matchFromCache(req);
        if (cached) return cached;

        return new Response('', { status: 408, statusText: 'Offline Asset Unavailable' });
      })()
    );
    return;
  }

  // 3. External assets (CDN fonts/thumbnails): Cache-first with network fallback
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      } catch (_) {
        return new Response('', { status: 408, statusText: 'Offline' });
      }
    })()
  );
});
