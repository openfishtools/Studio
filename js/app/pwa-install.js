/**
 * OpenFishTools Studio - PWA Installation & Service Worker Manager
 * Direct Browser Install API Trigger (No Pop-up Modals)
 */

(function () {
  'use strict';

  var isInstalled = false;

  // 1. Detect Standalone / Native App Display Mode (macOS, Windows, Android APK, PWA)
  function checkIsInstalled() {
    var proto = (window.location && window.location.protocol) || '';
    var host = (window.location && window.location.hostname) || '';
    var href = (window.location && window.location.href) || '';
    return (
      proto === 'file:' ||
      proto === 'tauri:' ||
      proto === 'asset:' ||
      host === 'tauri.localhost' ||
      href.indexOf('android_asset') !== -1 ||
      !!window.__TAURI_INTERNALS__ ||
      !!window.__TAURI__ ||
      !!window.__OFT_APP__ ||
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

  // 2. Retired Service Worker self-cleanup (sw.js deleted from repo).
  function purgeStaleServiceWorkers() {
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          (regs || []).forEach(function (reg) {
            try { reg.unregister(); } catch (_) {}
          });
        }).catch(function () {});
      }
      if (window.caches && window.caches.keys) {
        window.caches.keys().then(function (names) {
          (names || []).forEach(function (name) {
            try { window.caches.delete(name); } catch (_) {}
          });
        }).catch(function () {});
      }
    } catch (_) {}
  }

  // 3. Register Service Worker
  function registerServiceWorker() {
    purgeStaleServiceWorkers();
    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        fetch('./sw.js', { method: 'HEAD', cache: 'no-store' }).then(function (res) {
          if (!res || !res.ok) return;
          navigator.serviceWorker
            .register('./sw.js')
            .then(function (reg) {
              console.log('[PWA] Service Worker registered with scope:', reg.scope);
            })
            .catch(function (err) {
              console.warn('[PWA] Service Worker registration failed:', err);
            });
        }).catch(function () {});
      });
    }
  }

  registerServiceWorker();

  var STANDALONE_REPO = 'openfishtools/Standalone';
  var latestReleaseUrl = 'https://github.com/' + STANDALONE_REPO + '/releases/tag/v1.0.1';

  function resolveLatestStandaloneReleaseUrl() {
    if (isInstalled) return;
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
      btn.style.display = 'inline-flex';
      btn.removeAttribute('hidden');
    }
  }

  // 5. Redirect to Latest Standalone GitHub Release Tag
  function promptInstall() {
    var targetUrl = latestReleaseUrl || ('https://github.com/' + STANDALONE_REPO + '/releases/latest');
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  }

  if (window.matchMedia) {
    var mediaMatch = window.matchMedia('(display-mode: standalone)');
    if (mediaMatch.addEventListener) {
      mediaMatch.addEventListener('change', function (e) {
        isInstalled = e.matches;
        updateInstallButton();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateInstallButton);
  } else {
    updateInstallButton();
  }

  // Expose global controller & helper
  window.PWAInstall = {
    prompt: promptInstall,
    handleInstallRequest: promptInstall,
    getLatestReleaseUrl: function () {
      return latestReleaseUrl;
    },
    isInstalled: function () {
      return isInstalled;
    },
    isInstallable: function () {
      return !isInstalled;
    }
  };
  window.triggerPWAInstall = promptInstall;
})();
