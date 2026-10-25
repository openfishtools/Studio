(function() {
  var settleTimers = [];

  function clearSettleTimers() {
    while (settleTimers.length) {
      clearTimeout(settleTimers.pop());
    }
  }

  function getZoomFactor() {
    var z = (typeof window.oftUiScaleFactor === 'function' ? window.oftUiScaleFactor() : 1) || 1;
    if (!(z > 0)) z = 1;
    if (z === 1 && typeof window.__OFT_ZOOM === 'number' && window.__OFT_ZOOM > 0) {
      z = window.__OFT_ZOOM;
    }
    return z;
  }

  function isStandaloneMode() {
    try {
      if (window.navigator && window.navigator.standalone === true) return true;
      if (window.matchMedia && (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches
      )) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function syncAppHeight() {
    var z = getZoomFactor();
    var docEl = document.documentElement;
    if (!docEl) return;

    if (isStandaloneMode()) {
      docEl.classList.add('is-standalone');
    } else {
      docEl.classList.remove('is-standalone');
    }

    // Measure actual visible height. In mobile PWA / Home Screen shortcut mode,
    // window.innerHeight can initially report the full physical screen height
    // (including the Android/iOS bottom navigation bar) before settling, whereas
    // visualViewport.height and clientHeight reflect the true visible zone.
    var innerH = window.innerHeight || 0;
    var clientH = docEl.clientHeight ? (docEl.clientHeight * z) : 0;
    var vv = window.visualViewport;
    // Ignore transient keyboard shrink when an input is focused so the whole
    // editor layout does not collapse into a tiny strip, unless visualViewport
    // scale is 1 and within normal system-bar range.
    var vvH = (vv && vv.height > 0) ? (vv.height * (vv.scale || 1)) : 0;

    var candidates = [];
    if (innerH > 0) candidates.push(innerH);
    // Use visualViewport height when it isn't a massive virtual-keyboard shrink (> 25% drop)
    if (vvH > 0 && (!innerH || vvH >= innerH * 0.78)) {
      candidates.push(vvH);
    }
    if (clientH > 0 && (!innerH || clientH >= innerH * 0.78)) {
      candidates.push(clientH);
    }

    var rawH = candidates.length ? Math.min.apply(Math, candidates) : (innerH || clientH || 0);
    if (!(rawH > 0)) return;

    var h = Math.floor(rawH / z);
    docEl.style.setProperty('--app-height', h + 'px');

    var innerW = window.innerWidth || 0;
    var vvW = (vv && vv.width > 0) ? (vv.width * (vv.scale || 1)) : 0;
    var rawW = (vvW > 0 && innerW > 0) ? Math.min(innerW, vvW) : (innerW || vvW || 0);
    if (rawW > 0) {
      var w = Math.floor(rawW / z);
      docEl.style.setProperty('--app-width', w + 'px');
    }
  }

  function scheduleSettledSync() {
    clearSettleTimers();
    syncAppHeight();
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(syncAppHeight);
    }
    // Mobile WebAPK / Shortcut launches settle system status & gesture bars
    // asynchronously over the first 50-500ms.
    settleTimers.push(setTimeout(syncAppHeight, 60));
    settleTimers.push(setTimeout(syncAppHeight, 180));
    settleTimers.push(setTimeout(syncAppHeight, 400));
  }

  window.syncAppHeight = syncAppHeight;
  scheduleSettledSync();

  window.addEventListener('resize', scheduleSettledSync, { passive: true });
  window.addEventListener('orientationchange', scheduleSettledSync, { passive: true });
  window.addEventListener('pageshow', scheduleSettledSync, { passive: true });
  window.addEventListener('load', scheduleSettledSync, { passive: true });
  window.addEventListener('oft-ui-scale-changed', scheduleSettledSync);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleSettledSync, { once: true });
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncAppHeight, { passive: true });
    window.visualViewport.addEventListener('scroll', syncAppHeight, { passive: true });
  }

  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) scheduleSettledSync();
  }, { passive: true });
})();
