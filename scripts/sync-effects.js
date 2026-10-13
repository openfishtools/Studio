/**
 * OpenFishTools Studio - Automated Effects Discovery
 *
 * Drop a new `effects/<name>.js` file that calls `FishEffectsRegistry.register({...})`
 * and it appears in the Effects panel automatically. No HTML edits required.
 *
 * Discovery pipeline:
 *   1. scanEffects()    -> executes every effects/*.js in a sandbox and captures the real
 *                          registered definitions (id, name, category, icon, params ...).
 *                          Results are cached per-file by mtime, so repeated calls are cheap.
 *   2. syncEffects()    -> writes effects/manifest.json (static hosts / offline) and
 *                          effects/loader.js (generated fallback file list).
 *   3. Runtime          -> effects/loader.js asks the dev server (/api/effects, live scan),
 *                          falls back to effects/manifest.json, then to its embedded list.
 *
 * Usage:
 *   node scripts/sync-effects.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const EFFECTS_DIR = path.join(ROOT, 'effects');
const LOADER_PATH = path.join(EFFECTS_DIR, 'loader.js');
const MANIFEST_PATH = path.join(EFFECTS_DIR, 'manifest.json');

const BACKUP_DIR = path.join(EFFECTS_DIR, 'backup');
const RESERVED_FILES = new Set(['loader.js', 'index.js']);

function getCustomEffectFiles() {
  if (!fs.existsSync(EFFECTS_DIR)) return [];
  return fs.readdirSync(EFFECTS_DIR)
    .filter(f => f.endsWith('.js') && !RESERVED_FILES.has(f) && !f.startsWith('.') && !f.startsWith('_'))
    .sort();
}

function getFileDir(file) {
  const directPath = path.join(EFFECTS_DIR, file);
  if (fs.existsSync(directPath)) return EFFECTS_DIR;
  if (fs.existsSync(path.join(BACKUP_DIR, file))) return BACKUP_DIR;
  return EFFECTS_DIR;
}

function listEffectFiles() {
  const direct = getCustomEffectFiles();
  const backup = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.js') && !RESERVED_FILES.has(f) && !f.startsWith('.') && !f.startsWith('_'))
    : [];
  return Array.from(new Set([...direct, ...backup])).sort();
}

/* ── Sandbox ─────────────────────────────────────────────────────────────── */

function makePermissiveStub() {
  const cache = new WeakMap();
  const make = () => {
    const target = function () {};
    const proxy = new Proxy(target, {
      get(t, key) {
        if (key === Symbol.toPrimitive) return () => 0;
        if (key === 'then') return undefined;
        if (key === 'length') return 0;
        if (!cache.has(t)) cache.set(t, new Map());
        const m = cache.get(t);
        if (!m.has(key)) m.set(key, make());
        return m.get(key);
      },
      apply() { return make(); },
      construct() { return make(); },
      set() { return true; },
      has() { return true; }
    });
    return proxy;
  };
  return make();
}

function loadEffectFile(file) {
  const defs = [];
  const registry = {
    register(def) { if (def && typeof def === 'object') defs.push(def); },
    get() { return null; },
    getAll() { return []; },
    getByCategory() { return []; }
  };

  const stub = makePermissiveStub();
  const win = {
    FishEffectsRegistry: registry,
    document: stub,
    navigator: { userAgent: 'node', platform: 'node' },
    location: { href: '', protocol: 'file:', hostname: '' },
    devicePixelRatio: 1,
    console,
    Math, JSON, Date, Number, String, Boolean, Array, Object, RegExp, Map, Set, WeakMap, Error,
    Float32Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, Float64Array,
    parseInt, parseFloat, isNaN, isFinite, Infinity, NaN, undefined,
    URL: typeof URL !== 'undefined' ? URL : stub,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    CustomEvent: function CustomEvent() {},
    Image: function Image() {}, OffscreenCanvas: function OffscreenCanvas() { return stub; },
    HTMLCanvasElement: function HTMLCanvasElement() {}, HTMLImageElement: function HTMLImageElement() {},
    HTMLVideoElement: function HTMLVideoElement() {}, ImageData: function ImageData() {},
    Path2D: function Path2D() {}, THREE: stub
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  win.global = win;

  const activeDir = getFileDir(file);
  const filePath = path.join(activeDir, file);
  const code = fs.readFileSync(filePath, 'utf8');
  let error = null;
  try {
    vm.createContext(win);
    new vm.Script(code, { filename: filePath }).runInContext(win, { timeout: 2000 });
  } catch (err) {
    error = err;
  }
  return { defs, error, code };
}

/* ── Scan (cached by mtime) ──────────────────────────────────────────────── */

const scanCache = new Map(); // file -> { mtimeMs, size, result }

function regexFallback(file, code) {
  const idMatch = code.match(/id:\s*['"]([^'"]+)['"]/);
  const nameMatch = code.match(/name:\s*['"]([^'"]+)['"]/);
  const catMatch = code.match(/category:\s*['"]([^'"]+)['"]/);
  const iconMatch = code.match(/icon:\s*['"]([^'"]+)['"]/);
  const id = idMatch ? idMatch[1] : file.replace(/\.js$/, '');
  return [{
    id,
    name: nameMatch ? nameMatch[1] : id,
    category: catMatch ? catMatch[1] : 'lightning',
    icon: iconMatch ? iconMatch[1] : 'assets/FXPH.svg',
    params: [],
    _fallback: true
  }];
}

function scanFile(file) {
  const activeDir = getFileDir(file);
  const full = path.join(activeDir, file);
  let stat;
  try { stat = fs.statSync(full); } catch (_) { return null; }
  const cached = scanCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.result;

  const loaded = loadEffectFile(file);
  let defs = loaded.defs;
  let usedFallback = false;
  if (defs.length === 0) {
    defs = regexFallback(file, loaded.code);
    usedFallback = true;
  }
  const result = { file, defs, error: loaded.error, usedFallback };
  scanCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, result });
  return result;
}

/**
 * Executes every effect plugin and returns detailed scan results.
 * @returns {Array<{file:string, defs:Object[], error:Error|null, usedFallback:boolean}>}
 */
function scanEffectsDetailed() {
  return listEffectFiles().map(scanFile).filter(Boolean);
}

/**
 * Lightweight manifest used by the runtime loader and the Effects panel.
 * One entry per registered effect (a file may register several effects).
 */
function scanEffects() {
  const manifest = [];
  scanEffectsDetailed().forEach(entry => {
    entry.defs.forEach(def => {
      manifest.push({
        file: entry.file,
        id: String(def.id),
        name: def.name ? String(def.name) : String(def.id),
        category: def.category ? String(def.category) : 'lightning',
        icon: def.icon ? String(def.icon) : 'assets/FXPH.svg'
      });
    });
  });
  return manifest;
}

/* ── Writers ─────────────────────────────────────────────────────────────── */

function writeIfChanged(filePath, content) {
  try {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return false;
  } catch (_) {}
  const tmp = filePath + '.tmp.' + Date.now() + Math.random().toString(36).slice(2, 6);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
  return true;
}

function buildLoaderSource(files, customFiles) {
  return `/**
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

  // 5b. Evaluate custom / contributor effects added directly into effects/
  var customFiles = ${JSON.stringify(customFiles || [])};
  for (var c = 0; c < customFiles.length; c++) {
    try {
      var cXhr = new XMLHttpRequest();
      var cUrl = 'effects/' + encodeURIComponent(customFiles[c]);
      if (window.OFT_VERSION) cUrl += '?v=' + encodeURIComponent(window.OFT_VERSION);
      cXhr.open('GET', cUrl, false);
      cXhr.send(null);
      if (cXhr.status >= 200 && cXhr.status < 300 && cXhr.responseText) {
        (0, eval)(cXhr.responseText);
      }
    } catch (cErr) {
      console.error('[FishEffectsLoader] Error executing custom effect ' + customFiles[c] + ':', cErr);
    }
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
`;
}

function syncEffects() {
  if (!fs.existsSync(EFFECTS_DIR)) return [];

  const manifest = scanEffects();
  const files = Array.from(new Set(manifest.map(m => m.file))).sort();
  const customFiles = getCustomEffectFiles();

  const manifestChanged = writeIfChanged(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  const loaderChanged = writeIfChanged(LOADER_PATH, buildLoaderSource(files, customFiles));

  console.log(
    `[SyncEffects] ${manifest.length} effects in ${files.length} files discovered (${customFiles.length} custom)` +
    (manifestChanged || loaderChanged ? ' (manifest/loader updated)' : ' (already up to date)')
  );
  return manifest;
}

if (require.main === module) {
  syncEffects();
}

module.exports = { syncEffects, scanEffects, scanEffectsDetailed, listEffectFiles, EFFECTS_DIR, ROOT };
