/**
 * OpenFishTools Studio - PWA Installation & Service Worker Manager
 * Install App button is hidden globally.
 */

(function () {
  'use strict';

  var deferredPrompt = null;

  // Retired Service Worker self-cleanup
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

  function hideInstallButton() {
    var btn = document.getElementById('btn-install-app');
    if (btn) {
      btn.style.setProperty('display', 'none', 'important');
      btn.setAttribute('hidden', 'hidden');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideInstallButton);
  } else {
    hideInstallButton();
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    hideInstallButton();
  });

  function promptInstall() {
    if (deferredPrompt && typeof deferredPrompt.prompt === 'function') {
      try {
        deferredPrompt.prompt();
      } catch (_) {}
    }
  }

  window.PWAInstall = {
    prompt: promptInstall,
    handleInstallRequest: promptInstall,
    isInstalled: function () { return true; },
    isInstallable: function () { return false; }
  };
  window.triggerPWAInstall = promptInstall;
})();
