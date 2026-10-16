/**
 * OpenFishTools Studio - Service Worker
 * Version: 0.6.2
 *
 * 100% Offline-First + Online Background Auto-Update Strategy:
 * - Caches all 204 Studio resources (HTML, CSS, JS, WASM, Fonts, Icons, Shapes, Effect Thumbs, Vendors).
 * - Serves cached resources in 0ms (Instant Cache-First) so offline startup is instantaneous
 *   and zero components, icons, fonts, or WASM modules are ever missing.
 * - Automatically revalidates and updates cache in the background when online.
 */

const CACHE_NAME = 'oft-studio-v0.6.2';

const CORE_ASSETS = [
  './',
  'index.html',
  'desktop.html',
  'editor.html',
  'privacy.html',
  'terms.html',
  'version.json',
  'manifest.webmanifest',
  'CHANGELOG.md',
  'css/color-picker.css',
  'css/context-menu.css',
  'css/desktop.css',
  'css/drawer.css',
  'css/editor.css',
  'css/effects-rack.css',
  'css/extensions.css',
  'css/layout.css',
  'css/modal.css',
  'css/popover.css',
  'css/safari.css',
  'css/segmented-button.css',
  'css/switch.css',
  'css/template-editor.css',
  'css/text-format.css',
  'css/theme.css',
  'css/transform-controller.css',
  'css/wireframe.css',
  'fticons/cleaned.woff2',
  'fticons/fticons.css',
  'fticons/fticons.woff2',
  'fticons/names.json',
  'js/attributes-clipboard.js',
  'js/bg-removal-engine.js',
  'js/canvas-overlay.js',
  'js/color-picker.js',
  'js/context-menu.js',
  'js/db.js',
  'js/desktop.js',
  'js/drawer.js',
  'js/editor.js',
  'js/effects.js',
  'js/extension-manager.js',
  'js/extensions.js',
  'js/fish-audio-engine.js',
  'js/FishExport-Enggine.js',
  'js/fishtool-engine.js',
  'js/fishtools-adapter.js',
  'js/folderanim.js',
  'js/frame-extractor.js',
  'js/JSX-Translator.js',
  'js/jszip.min.js',
  'js/main.js',
  'js/modal.js',
  'js/motion-blur-engine.js',
  'js/openfishtools-controller.js',
  'js/openfishtools-generators3d.js',
  'js/popover.js',
  'js/preview-cache.js',
  'js/pwa-install.js',
  'js/shapes.js',
  'js/switch.js',
  'js/sync-height.js',
  'js/template-editor.js',
  'js/text-engine.js',
  'js/video-decoder-worker.js',
  'js/video-stream-manager.js',
  'js/wireframe.js',
  'effects/effects.wasm',
  'effects/loader.js',
  'effects/manifest.json',
  'element/card-builder.js',
  'element/color-input.js',
  'element/dropdown.js',
  'element/index.js',
  'element/number-input.js',
  'element/segmented.js',
  'element/slider.js',
  'shapes/capsule.js',
  'shapes/circle.js',
  'shapes/heart.js',
  'shapes/polygon.js',
  'shapes/rectangle.js',
  'shapes/star.js',
  'shapes/triangle.js',
  'text/default.js',
  'assets/checkerboard.svg',
  'assets/doodles.svg',
  'assets/effects/categories/3d.png',
  'assets/effects/categories/artificial-intelligence.png',
  'assets/effects/categories/background.png',
  'assets/effects/categories/expression.png',
  'assets/effects/categories/layer.png',
  'assets/effects/categories/lightning.png',
  'assets/effects/categories/movement.png',
  'assets/effects/categories/warp.png',
  'assets/effects/categories/wipe.png',
  'assets/effects/thumbs/anamorphic-flare.png',
  'assets/effects/thumbs/angle-control.png',
  'assets/effects/thumbs/bevel.png',
  'assets/effects/thumbs/box_3d.png',
  'assets/effects/thumbs/brightness-contrast.png',
  'assets/effects/thumbs/camera-lens-blur.png',
  'assets/effects/thumbs/checkbox-control.png',
  'assets/effects/thumbs/chromatic-aberration.png',
  'assets/effects/thumbs/color-balance.png',
  'assets/effects/thumbs/color-control.png',
  'assets/effects/thumbs/color-temperature.png',
  'assets/effects/thumbs/colorize.png',
  'assets/effects/thumbs/curve.png',
  'assets/effects/thumbs/deep-glow.png',
  'assets/effects/thumbs/diffusion.png',
  'assets/effects/thumbs/drop-shadow.png',
  'assets/effects/thumbs/dropdown-control.png',
  'assets/effects/thumbs/exposure-gamma.png',
  'assets/effects/thumbs/expression-controls.png',
  'assets/effects/thumbs/extrude_3d.png',
  'assets/effects/thumbs/fast-box-blur.png',
  'assets/effects/thumbs/fill.png',
  'assets/effects/thumbs/flicker.png',
  'assets/effects/thumbs/fluid-fish.png',
  'assets/effects/thumbs/fluid-fish.webp',
  'assets/effects/thumbs/fsmb.png',
  'assets/effects/thumbs/glow-aura.png',
  'assets/effects/thumbs/grad-exposure.png',
  'assets/effects/thumbs/gradient-overlay.png',
  'assets/effects/thumbs/grid.png',
  'assets/effects/thumbs/haze-flare.png',
  'assets/effects/thumbs/highlight-shadow.png',
  'assets/effects/thumbs/hue-shift.png',
  'assets/effects/thumbs/invert.png',
  'assets/effects/thumbs/linear_wipe.png',
  'assets/effects/thumbs/lumia.png',
  'assets/effects/thumbs/mono.png',
  'assets/effects/thumbs/optic-compensation.png',
  'assets/effects/thumbs/oscillate.png',
  'assets/effects/thumbs/particle-engine.png',
  'assets/effects/thumbs/point-control.png',
  'assets/effects/thumbs/pyramid_3d.png',
  'assets/effects/thumbs/radio-waves.png',
  'assets/effects/thumbs/rays.png',
  'assets/effects/thumbs/rgb-split.png',
  'assets/effects/thumbs/saturation-vibrant.png',
  'assets/effects/thumbs/scanline.png',
  'assets/effects/thumbs/shake.png',
  'assets/effects/thumbs/sharpen.png',
  'assets/effects/thumbs/shatter.png',
  'assets/effects/thumbs/slider-control.png',
  'assets/effects/thumbs/solid-aura.png',
  'assets/effects/thumbs/sphere_3d.png',
  'assets/effects/thumbs/star-burst.png',
  'assets/effects/thumbs/swing.png',
  'assets/effects/thumbs/tile.png',
  'assets/effects/thumbs/tint.png',
  'assets/effects/thumbs/transform.png',
  'assets/effects/thumbs/turbulent-displace.png',
  'assets/effects/thumbs/unsharp-mask.png',
  'assets/effects/thumbs/vignette.png',
  'assets/effects/thumbs/warp.png',
  'assets/effects/thumbs/wave-warp.png',
  'assets/effects/thumbs/wipe_jaws.png',
  'assets/fonts/CalSans-SemiBold.ttf',
  'assets/fonts/CalSans-SemiBold.woff',
  'assets/fonts/CalSans-SemiBold.woff2',
  'assets/fonts/MaterialIcons-Regular.ttf',
  'assets/fonts/MaterialIcons-Regular.woff',
  'assets/fonts/MaterialIcons-Regular.woff2',
  'assets/FXPH.svg',
  'assets/FXWipeJaws.webp',
  'assets/github.svg',
  'assets/grid.svg',
  'assets/handles.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-extension.svg',
  'assets/icon-motion-blur.svg',
  'assets/icon.svg',
  'assets/qris.png',
  'assets/Shape/bintang.svg',
  'assets/Shape/hati.svg',
  'assets/Shape/kapsul.svg',
  'assets/Shape/kotak.svg',
  'assets/Shape/lingkaran.svg',
  'assets/Shape/poligon.svg',
  'assets/Shape/segitiga.svg',
  'assets/star-outline.svg',
  'assets/star.svg',
  'assets/stock/stock-1170986.jpg',
  'assets/stock/stock-127028.jpg',
  'assets/stock/stock-1472999.jpg',
  'assets/stock/stock-1543793.jpg',
  'assets/stock/stock-156934.jpg',
  'assets/stock/stock-1741205.jpg',
  'assets/stock/stock-2061057.jpg',
  'assets/stock/stock-617278.jpg',
  'assets/stock/stock-774731.jpg',
  'assets/stock/stock-coding.jpg',
  'assets/watermark.svg',
  'vendor/ffmpeg/ffmpeg-core.js',
  'vendor/ffmpeg/ffmpeg-core.wasm',
  'vendor/ffmpeg/ffmpeg-core.worker.js',
  'vendor/ffmpeg/ffmpeg.min.js',
  'vendor/lamejs/lame.min.js',
  'vendor/mp4-muxer.js',
  'vendor/qrcode.min.js'
];

async function cacheAllAssetsInBatches(assets, batchSize = 8) {
  const cache = await caches.open(CACHE_NAME);
  for (let i = 0; i < assets.length; i += batchSize) {
    const chunk = assets.slice(i, i + batchSize);
    await Promise.allSettled(
      chunk.map(async (assetPath) => {
        try {
          const existing = await cache.match(assetPath, { ignoreSearch: true });
          if (existing) return;
          const res = await fetch(new Request(assetPath, { cache: 'reload' }));
          if (res && res.ok) {
            await cache.put(assetPath, res.clone());
          }
        } catch (_) {}
      })
    );
  }
}

self.addEventListener('install', (event) => {
  // Activate immediately so Service Worker controls the app right away,
  // while pre-caching essential shell HTML/CSS/Fonts first and remaining assets in batches.
  const criticalShell = [
    './',
    'index.html',
    'desktop.html',
    'editor.html',
    'css/theme.css',
    'css/layout.css',
    'css/editor.css',
    'css/desktop.css',
    'fticons/fticons.css',
    'fticons/fticons.woff2',
    'assets/fonts/CalSans-SemiBold.woff2',
    'assets/fonts/MaterialIcons-Regular.woff2',
    'effects/effects.wasm',
    'effects/loader.js'
  ];
  event.waitUntil(
    cacheAllAssetsInBatches(criticalShell, 7)
      .then(() => {
        // Continue caching the rest in background without blocking SW activation
        cacheAllAssetsInBatches(CORE_ASSETS, 8).catch(() => {});
        return self.skipWaiting();
      })
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
  const cache = await caches.open(CACHE_NAME);

  const direct = await cache.match(req);
  if (direct) return direct;

  const ignoreQuery = await cache.match(req, { ignoreSearch: true });
  if (ignoreQuery) return ignoreQuery;

  try {
    const url = new URL(req.url);
    // Collapse multiple slashes (e.g. /fticons//fticons.woff2 -> /fticons/fticons.woff2)
    const normPath = url.pathname.replace(/\/+/g, '/');

    if (normPath === '/' || normPath === '') {
      return (
        (await cache.match('index.html', { ignoreSearch: true })) ||
        (await cache.match('./index.html', { ignoreSearch: true })) ||
        (await cache.match('./', { ignoreSearch: true }))
      );
    }

    const cleanRel = normPath.replace(/^\//, '');
    if (cleanRel) {
      const byRel = await cache.match(cleanRel, { ignoreSearch: true });
      if (byRel) return byRel;
      const byNormUrl = await cache.match(new URL(normPath, self.location.origin).href, { ignoreSearch: true });
      if (byNormUrl) return byNormUrl;
    }

    // Also handle Cloudflare Pretty URLs (e.g. /desktop -> desktop.html, /editor -> editor.html)
    if (cleanRel === 'desktop' || cleanRel === 'editor' || cleanRel === 'index') {
      const htmlMatch = await cache.match(cleanRel + '.html', { ignoreSearch: true });
      if (htmlMatch) return htmlMatch;
    }
  } catch (_) {}

  // Fallback across any older cache bucket if present
  const anyDirect = await caches.match(req, { ignoreSearch: true });
  if (anyDirect) return anyDirect;

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

async function updateCacheInBackground(req, url) {
  if (!self.navigator || self.navigator.onLine === false) return;
  try {
    const res = await fetchWithTimeout(req, 4000);
    if (res && res.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      const normPath = url.pathname.replace(/\/+/g, '/');
      const cleanRel = normPath === '/' ? 'index.html' : normPath.replace(/^\//, '');
      await cache.put(req, res.clone());
      if (cleanRel) {
        await cache.put(cleanRel, res.clone());
      }
    }
  } catch (_) {}
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
  // Serve cached HTML immediately when offline (0ms wait), or revalidate in background when online.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cached = await matchFromCache(req);

        // If offline and cached exists, return immediately in 0ms
        if (cached && self.navigator && self.navigator.onLine === false) {
          return cached;
        }

        // If cached exists, return cached immediately for instant load and update in background!
        if (cached) {
          event.waitUntil(updateCacheInBackground(req, url));
          return cached;
        }

        // First-ever visit (not cached yet): fetch from network
        try {
          const networkRes = await fetchWithTimeout(req, 5000);
          if (networkRes && networkRes.ok) {
            const cache = await caches.open(CACHE_NAME);
            const cleanPath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
            if (['index.html', 'desktop.html', 'editor.html'].includes(cleanPath)) {
              cache.put(cleanPath, networkRes.clone()).catch(() => {});
            }
            cache.put(req, networkRes.clone()).catch(() => {});
            return networkRes;
          }
        } catch (_) {}

        return (
          (await matchFromCache(new Request(self.location.origin + '/index.html'))) ||
          new Response('Offline - Please connect to the internet once to initialize FishTools Studio.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          })
        );
      })()
    );
    return;
  }

  // 2. Same-origin Studio assets (JS, CSS, WASM, Fonts, SVGs, PNGs, WebP):
  // Instant Cache-First (0ms latency!) so synchronous WASM XHR, icons, fonts, and scripts NEVER stall offline,
  // with automatic background update when online.
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cached = await matchFromCache(req);
        if (cached) {
          if (self.navigator && self.navigator.onLine !== false) {
            event.waitUntil(updateCacheInBackground(req, url));
          }
          return cached;
        }

        try {
          const networkRes = await fetchWithTimeout(req, 8000);
          if (networkRes && networkRes.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, networkRes.clone()).catch(() => {});
            const cleanAsset = url.pathname.replace(/\/+/g, '/').replace(/^\//, '');
            if (cleanAsset) {
              cache.put(cleanAsset, networkRes.clone()).catch(() => {});
            }
            return networkRes;
          }
        } catch (_) {}

        return new Response('', { status: 408, statusText: 'Offline Asset Unavailable' });
      })()
    );
    return;
  }

  // 3. External assets (CDN fonts/thumbnails): Cache-first with network fallback
  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
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
