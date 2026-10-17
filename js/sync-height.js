(function() {
  function syncAppHeight() {
    // innerHeight reports visual px; --app-height sizes layout boxes, so
    // divide by UI-scale zoom (1 at 100% = no behavior change).
    var z = (typeof window.oftUiScaleFactor === 'function' ? window.oftUiScaleFactor() : 1) || 1;
    if (!(z > 0)) z = 1;
    // db.js may load after this script: fall back to the cached factor.
    if (z === 1 && typeof window.__OFT_ZOOM === 'number' && window.__OFT_ZOOM > 0) z = window.__OFT_ZOOM;
    var h = window.innerHeight / z;
    document.documentElement.style.setProperty('--app-height', h + 'px');
  }
  syncAppHeight();
  window.addEventListener('resize', syncAppHeight, { passive: true });
  window.addEventListener('orientationchange', syncAppHeight, { passive: true });
  window.addEventListener('oft-ui-scale-changed', syncAppHeight);
})();
