/**
 * OpenFishTools Studio - WebAssembly Effects Runtime Core & Silent Watermark Guard
 *
 * All modular effects are compiled and encrypted directly into effects/effects.wasm.
 * Decoded and registered strictly in memory at runtime with domain verification.
 */
(function (global) {
  'use strict';

  var isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (!isBrowser) return;

  var host = (window.location && window.location.hostname) || '';

  // 1. Synchronously fetch effects/effects.wasm
  var wasmBytes = null;
  try {
    var xhr = new XMLHttpRequest();
    var wasmUrl = 'effects/effects.wasm';
    if (window.OFT_VERSION) wasmUrl += '?v=' + encodeURIComponent(window.OFT_VERSION);
    xhr.open('GET', wasmUrl, false);
    xhr.overrideMimeType('text/plain; charset=x-user-defined');
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
      var text = xhr.responseText;
      wasmBytes = new Uint8Array(text.length);
      for (var i = 0; i < text.length; i++) {
        wasmBytes[i] = text.charCodeAt(i) & 0xff;
      }
    }
  } catch (e) {
    console.warn('[FishEffectsLoader] Synchronous WASM fetch failed:', e);
  }

  if (!wasmBytes) {
    console.error('[FishEffectsLoader] Critical: failed to load effects/effects.wasm');
    return;
  }

  // 2. Synchronously instantiate WASM module
  var wasmInstance = null;
  var wasmExports = null;
  try {
    var mod = new WebAssembly.Module(wasmBytes);
    wasmInstance = new WebAssembly.Instance(mod, {});
    wasmExports = wasmInstance.exports;
  } catch (err) {
    console.error('[FishEffectsLoader] WASM instantiation failed:', err);
    return;
  }

  // 3. Verify Domain Authorization via WASM Security Engine
  var enc = new TextEncoder();
  var hostBytes = enc.encode(host);
  var mem = new Uint8Array(wasmExports.memory.buffer);
  var tempPtr = 10000;
  mem.set(hostBytes, tempPtr);
  wasmExports.verify_domain(tempPtr, hostBytes.length);
  var isAuthorized = wasmExports.is_authorized() === 1;

  var watermarkImg = null;
  if (!isAuthorized) {
    try {
      var svgPtr = wasmExports.get_watermark_svg_ptr();
      var svgLen = wasmExports.get_watermark_svg_len();
      var svgSlice = new Uint8Array(wasmExports.memory.buffer, svgPtr, svgLen);
      var svgText = new TextDecoder('utf-8').decode(svgSlice);
      var blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      watermarkImg = new Image();
      watermarkImg.onload = function () {
        if (typeof window.redrawComposition === 'function') {
          window.redrawComposition('wasmWatermarkLoaded');
        }
      };
      watermarkImg.src = URL.createObjectURL(blob);
    } catch (_) {}
  }

  // Share WASM instance globally for fluid_fish and universal effects guard
  global.__FISH_WASM__ = {
    instance: wasmInstance,
    exports: wasmExports,
    isAuthorized: isAuthorized,
    watermarkImg: watermarkImg
  };

  // 4. Unpack bundled effects from WASM binary
  try {
    wasmExports.unpack_effects_bundle();
    var ptr = wasmExports.get_effects_bundle_ptr();
    var len = wasmExports.get_effects_bundle_len();
    var slice = new Uint8Array(wasmExports.memory.buffer, ptr, len);
    var jsonStr = new TextDecoder('utf-8').decode(slice);
    var bundle = JSON.parse(jsonStr);

    // 5. Evaluate and register each effect into FishEffectsRegistry
    for (var file in bundle) {
      if (Object.prototype.hasOwnProperty.call(bundle, file)) {
        try {
          (0, eval)(bundle[file]);
        } catch (evalErr) {
          console.error('[FishEffectsLoader] Error executing effect ' + file + ':', evalErr);
        }
      }
    }
  } catch (unpackErr) {
    console.error('[FishEffectsLoader] Failed to unpack effects from WASM:', unpackErr);
  }

  // 6. Pre-warm WASM engine & GPU effects during loading for instantaneous editing
  global.prewarmWasmEffects = async function() {
    try {
      if (!global.__FISH_WASM__) return;
      var exp = global.__FISH_WASM__.exports;
      if (!exp) return;

      // Warm-up WASM JIT & CPU cache execution path
      if (typeof exp.compute_mesh === 'function') {
        try {
          exp.compute_mesh(0.5, 0, 0, 0.0, 0.0, 100.0, 100.0, 0.0, 50.0, 50.0, 100.0, 100.0, 0.0, 0.0);
        } catch (_) {}
      }

      // Pre-warm GPU WebGL effects (Fluid Fish shaders, textures, buffers)
      if (global.FishEffectsRegistry) {
        var all = global.FishEffectsRegistry.getAll();
        for (var i = 0; i < all.length; i++) {
          if (all[i] && typeof all[i].prewarm === 'function') {
            try { all[i].prewarm(); } catch (_) {}
          }
        }
      }

      global.__FISH_WASM_PREWARMED__ = true;
    } catch (e) {
      console.warn('[WASM Prewarm] Notice:', e);
    }
  };

  // Automatically start background prewarm immediately
  if (typeof setTimeout === 'function') {
    setTimeout(function() {
      if (typeof global.prewarmWasmEffects === 'function') {
        global.prewarmWasmEffects();
      }
    }, 10);
  }
})(typeof window !== 'undefined' ? window : this);
