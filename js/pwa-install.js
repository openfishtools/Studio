/**
 * OpenFishTools Studio - PWA Installation, Service Worker & Standalone Resource Sync Manager
 * Ensures 100% of Studio components (204 files) are downloaded and persisted for offline use in Standalone App.
 */

(function () {
  'use strict';

  var CACHE_NAME = 'oft-studio-v0.6.2';
  var READY_STORAGE_KEY = 'oft_standalone_offline_ready_v062';

  // Complete manifest of all 204 Studio resources (0 files left behind)
  var ALL_STUDIO_ASSETS = [
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
    'vendor/lamejs/lame.min.js',
    'vendor/mp4-muxer.js',
    'vendor/qrcode.min.js',
    'vendor/ffmpeg/ffmpeg.min.js',
    'vendor/ffmpeg/ffmpeg-core.js',
    'vendor/ffmpeg/ffmpeg-core.worker.js',
    'vendor/ffmpeg/ffmpeg-core.wasm'
  ];

  var deferredPrompt = null;
  var isInstalled = false;

  // 1. Detect Standalone / Native App Display Mode (macOS, Windows, Android APK, PWA)
  function checkIsInstalled() {
    var proto = (window.location && window.location.protocol) || '';
    var host = (window.location && window.location.hostname) || '';
    var href = (window.location && window.location.href) || '';
    var ua = (window.navigator && window.navigator.userAgent) || '';
    return (
      proto === 'file:' ||
      proto === 'tauri:' ||
      proto === 'asset:' ||
      host === 'tauri.localhost' ||
      href.indexOf('android_asset') !== -1 ||
      ua.indexOf('FishToolsStudio/') !== -1 ||
      ua.indexOf('com.cutefishaep.ofts') !== -1 ||
      !!window.__TAURI_INTERNALS__ ||
      !!window.__TAURI__ ||
      !!window.__OFT_APP__ ||
      !!window.__OFT_NATIVE_APP__ ||
      window.self !== window.top ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
      (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) ||
      (window.matchMedia && window.matchMedia('(display-mode: window-controls-overlay)').matches) ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  isInstalled = checkIsInstalled();

  // 2. Simple Standalone Resource Loader UI (only in Standalone App when resources aren't 100% cached yet)
  function createStandaloneSyncOverlay() {
    var existing = document.getElementById('oft-standalone-sync-overlay');
    if (existing) return existing;

    var overlay = document.createElement('div');
    overlay.id = 'oft-standalone-sync-overlay';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483646',
      'background:rgba(14,18,11,0.96)',
      'backdrop-filter:blur(14px)',
      '-webkit-backdrop-filter:blur(14px)',
      'display:flex',
      ' flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'font-family:"Cal Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'color:#e6f4dc',
      'user-select:none',
      'transition:opacity 0.28s ease'
    ].join(';');

    overlay.innerHTML =
      '<div style="width:320px;max-width:86vw;background:#192014;border:1px solid #2b3723;border-radius:16px;padding:24px 22px;box-shadow:0 20px 50px rgba(0,0,0,0.55);text-align:center;">' +
        '<img src="assets/icon.svg" alt="FishTools Studio" width="44" height="44" style="margin-bottom:14px;display:inline-block;" onerror="this.style.display=\'none\'">' +
        '<div id="oft-sync-title" style="font-size:15px;font-weight:600;letter-spacing:0.2px;color:#eef8e6;margin-bottom:6px;">Preparing Offline Studio...</div>' +
        '<div id="oft-sync-sub" style="font-size:12px;color:#8fa680;margin-bottom:16px;">Downloading all components (0 / ' + ALL_STUDIO_ASSETS.length + ')</div>' +
        '<div style="width:100%;height:7px;background:#11160d;border-radius:999px;overflow:hidden;border:1px solid #25301e;">' +
          '<div id="oft-sync-bar" style="width:2%;height:100%;background:linear-gradient(90deg,#88d45e,#aef380);border-radius:999px;transition:width 0.15s ease;"></div>' +
        '</div>' +
        '<div id="oft-sync-pct" style="font-size:11px;color:#98ce7b;margin-top:8px;font-weight:600;">0%</div>' +
      '</div>';

    document.body.appendChild(overlay);
    return overlay;
  }

  function updateStandaloneSyncProgress(done, total) {
    var pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;
    var sub = document.getElementById('oft-sync-sub');
    var bar = document.getElementById('oft-sync-bar');
    var pctEl = document.getElementById('oft-sync-pct');
    if (sub) sub.textContent = 'Downloading all components (' + done + ' / ' + total + ')';
    if (bar) bar.style.width = Math.max(2, pct) + '%';
    if (pctEl) pctEl.textContent = pct + '%';
  }

  function dismissStandaloneSyncOverlay() {
    var ov = document.getElementById('oft-standalone-sync-overlay');
    if (!ov) return;
    ov.style.opacity = '0';
    setTimeout(function () {
      try { ov.remove(); } catch (_) {}
    }, 300);
  }

  async function ensureStandaloneOfflineResourcesCached() {
    if (!checkIsInstalled()) return;
    if (!('caches' in window) || window.location.protocol === 'file:') return;

    try {
      var cache = await caches.open(CACHE_NAME);
      var missing = [];

      // Check which of the 204 assets are not yet in CacheStorage
      for (var i = 0; i < ALL_STUDIO_ASSETS.length; i++) {
        var asset = ALL_STUDIO_ASSETS[i];
        var checkUrl = new URL(asset === './' ? '/' : '/' + asset.replace(/^\//, ''), window.location.origin).href;
        var matched = await cache.match(checkUrl, { ignoreSearch: true });
        if (!matched) {
          missing.push(asset);
        }
      }

      // If all 204 assets are already cached, ensure double-slash fticons alias exists and return immediately (0ms!)
      if (missing.length === 0) {
        try {
          var ftUrl = new URL('/fticons/fticons.woff2', window.location.origin).href;
          var ftFont = await cache.match(ftUrl, { ignoreSearch: true });
          if (ftFont) {
            var dblSlashUrl = new URL('/fticons//fticons.woff2', window.location.origin).href;
            var hasAlias = await cache.match(dblSlashUrl, { ignoreSearch: true });
            if (!hasAlias) {
              await cache.put(dblSlashUrl, ftFont.clone());
            }
          }
          localStorage.setItem(READY_STORAGE_KEY, CACHE_NAME);
        } catch (_) {}
        return;
      }

      // If offline on first-ever launch, cannot download missing files right now
      if (navigator.onLine === false) return;

      // Show simple loading screen in Standalone App while downloading remaining resources
      createStandaloneSyncOverlay();
      var total = ALL_STUDIO_ASSETS.length;
      var completed = total - missing.length;
      updateStandaloneSyncProgress(completed, total);

      var batchSize = 10;
      for (var b = 0; b < missing.length; b += batchSize) {
        var batch = missing.slice(b, b + batchSize);
        await Promise.allSettled(
          batch.map(async function (assetPath) {
            try {
              var absUrl = new URL(assetPath === './' ? '/' : '/' + assetPath.replace(/^\//, ''), window.location.origin).href;
              var req = new Request(absUrl, { cache: 'reload' });
              var res = await fetch(req);
              if (res && res.ok) {
                await cache.put(absUrl, res.clone());
                if (assetPath === 'fticons/fticons.woff2') {
                  var aliasUrl = new URL('/fticons//fticons.woff2', window.location.origin).href;
                  await cache.put(aliasUrl, res.clone());
                }
              }
            } catch (_) {}
            completed++;
            updateStandaloneSyncProgress(completed, total);
          })
        );
      }

      try {
        localStorage.setItem(READY_STORAGE_KEY, CACHE_NAME);
      } catch (_) {}

      dismissStandaloneSyncOverlay();
    } catch (err) {
      console.warn('[PWA] Standalone offline sync error:', err);
      dismissStandaloneSyncOverlay();
    }
  }

  // 3. Register Offline-First Service Worker (caches app for offline access, auto-updates when online)
  function registerServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
      var startRegistration = function () {
        navigator.serviceWorker
          .register('./sw.js', { updateViaCache: 'none' })
          .then(function (reg) {
            console.log('[PWA] Service Worker active (offline ready):', reg.scope);
            if (navigator.onLine) {
              try { reg.update(); } catch (_) {}
            }
            window.addEventListener('online', function () {
              try { reg.update(); } catch (_) {}
              ensureStandaloneOfflineResourcesCached();
            });
          })
          .catch(function (err) {
            console.warn('[PWA] Service Worker registration failed:', err);
          });

        // Request persistent storage so Gecko/Chromium never evicts offline CacheStorage or IndexedDB
        if (navigator.storage && typeof navigator.storage.persist === 'function') {
          navigator.storage.persist().catch(function () {});
        }

        // Run Standalone full resource check/download
        ensureStandaloneOfflineResourcesCached();
      };

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        startRegistration();
      } else {
        window.addEventListener('DOMContentLoaded', startRegistration);
      }
    }
  }

  registerServiceWorker();

  function showFeedback(text) {
    if (typeof window.showDashboardToast === 'function') {
      window.showDashboardToast(text, 3500);
    } else {
      console.log('[PWA]', text);
    }
  }

  var STANDALONE_REPO = 'openfishtools/Standalone';
  var latestReleaseUrl = 'https://github.com/' + STANDALONE_REPO + '/releases/tag/v1.0.3';

  function resolveLatestStandaloneReleaseUrl() {
    if (isInstalled || checkIsInstalled() || navigator.onLine === false) return;
    fetch('https://api.github.com/repos/' + STANDALONE_REPO + '/releases/latest', {
      cache: 'no-store'
    })
      .then(function (res) {
        if (!res || !res.ok) throw new Error('status ' + (res ? res.status : 0));
        return res.json();
      })
      .then(function (data) {
        if (data && data.tag_name) {
          var tag = String(data.tag_name).trim();
          if (tag.charAt(0) !== 'v') tag = 'v' + tag;
          latestReleaseUrl = 'https://github.com/' + STANDALONE_REPO + '/releases/tag/' + tag;
        } else if (data && data.html_url) {
          latestReleaseUrl = String(data.html_url);
        }
      })
      .catch(function () {
        fetch('https://raw.githubusercontent.com/' + STANDALONE_REPO + '/main/package.json?t=' + Date.now(), {
          cache: 'no-store'
        })
          .then(function (r) {
            return r && r.ok ? r.json() : null;
          })
          .then(function (pkg) {
            if (pkg && pkg.version) {
              var ver = String(pkg.version).trim().replace(/^v/i, '');
              latestReleaseUrl = 'https://github.com/' + STANDALONE_REPO + '/releases/tag/v' + ver;
            }
          })
          .catch(function () {});
      });
  }

  resolveLatestStandaloneReleaseUrl();

  // 4. Update Install Button Visibility
  function updateInstallButton() {
    var btn = document.getElementById('btn-install-app');
    if (!btn) return;

    if (isInstalled || checkIsInstalled()) {
      isInstalled = true;
      btn.style.setProperty('display', 'none', 'important');
      btn.setAttribute('hidden', 'hidden');
    } else {
      btn.style.removeProperty('display');
      btn.removeAttribute('hidden');
    }
  }

  // 5. Trigger Install / Redirect to Official Standalone Release on GitHub
  function triggerInstallPrompt() {
    if (isInstalled || checkIsInstalled()) {
      showFeedback('FishTools Studio sudah terpasang di perangkat ini.');
      return;
    }

    var targetUrl = latestReleaseUrl || ('https://github.com/' + STANDALONE_REPO + '/releases/latest');
    showFeedback('Membuka halaman unduhan resmi FishTools Studio...');
    var win = window.open(targetUrl, '_blank', 'noopener,noreferrer');
    if (!win) {
      window.location.href = targetUrl;
    }
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallButton();
  });

  window.addEventListener('appinstalled', function () {
    isInstalled = true;
    deferredPrompt = null;
    updateInstallButton();
    showFeedback('FishTools Studio berhasil diinstal!');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateInstallButton);
  } else {
    updateInstallButton();
  }

  window.PWAInstall = {
    prompt: triggerInstallPrompt,
    isInstalled: function () {
      return isInstalled || checkIsInstalled();
    },
    syncOfflineResources: ensureStandaloneOfflineResourcesCached
  };
})();
