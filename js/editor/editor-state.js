/**
 * OpenFishTools Studio - Editor State & Project Persistence
 * Manages currentProjectState, resMap, UndoRedoManager, auto-save, IndexedDB persistence,
 * resolution math, project settings modal, and metadata inspection.
 */
(function() {
  function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }
  window.clamp = clamp;

// Resolution Matrix for All Supported Aspect Ratios
    let _resMap = {
      '4K':   { '16:9': [3840, 2160], '9:16': [2160, 3840], '1:1': [2160, 2160], '4:3': [2880, 2160], '21:9': [5120, 2160] },
      '2K':   { '16:9': [2560, 1440], '9:16': [1440, 2560], '1:1': [1440, 1440], '4:3': [1920, 1440], '21:9': [3440, 1440] },
      '1080p':{ '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '21:9': [2560, 1080] },
      '720p': { '16:9': [1280, 720],  '9:16': [720, 1280],  '1:1': [720, 720],   '4:3': [960, 720],   '21:9': [1680, 720] },
      '480p': { '16:9': [854, 480],   '9:16': [480, 854],   '1:1': [480, 480],   '4:3': [640, 480],   '21:9': [1120, 480] }
    };
    window.resMap = _resMap;
    window.getProjectDimensions = function(res, aspect) {
      if (aspect === 'Custom' || (typeof res === 'string' && res.includes('x'))) {
        const parts = String(res).split('x');
        if (parts.length === 2) {
          const w = parseInt(parts[0], 10);
          const h = parseInt(parts[1], 10);
          if (!isNaN(w) && !isNaN(h)) return [w, h];
        }
      }
      return (window.resMap && window.resMap[res] && window.resMap[res][aspect]) || [1920, 1080];
    };

    window.toggleResolutionUI = function(containerId, aspectVal) {
      let container = document.getElementById(containerId);
      if (!container) {
        container = document.getElementById('container-resolution') || document.getElementById('settings-container-resolution');
      }
      if (!container) return;
      const dropdown = container.querySelector('.custom-dropdown');
      const inputs = container.querySelector('#custom-resolution-inputs, #settings-custom-resolution-inputs, .custom-res-liquid-wrap, .custom-res-composite, .custom-resolution-inputs');
      if (aspectVal === 'Custom') {
        if (dropdown) dropdown.style.display = 'none';
        if (inputs) inputs.style.display = 'flex';
      } else {
        if (dropdown) dropdown.style.display = 'block';
        if (inputs) inputs.style.display = 'none';
      }
    };

    const editorResLocks = { new: 16/9, settings: 16/9 };
    function setupEditorResLink(btnId, wId, hId, type) {
      const btn = document.getElementById(btnId);
      const w = document.getElementById(wId);
      const h = document.getElementById(hId);
      if (!btn || !w || !h) return;

      function updateRatio() {
        const wv = parseFloat(w.value) || 1920;
        const hv = parseFloat(h.value) || 1080;
        if (hv > 0) editorResLocks[type] = wv / hv;
      }
      updateRatio();

      function syncLock() {
        const wrap = btn.closest('.custom-res-liquid-wrap');
        if (wrap) wrap.classList.toggle('is-locked', btn.classList.contains('is-locked'));
      }
      syncLock();

      if (btn._resLinkBound) return;
      btn._resLinkBound = true;

      btn.addEventListener('click', () => {
        btn.classList.toggle('is-locked');
        syncLock();
        if (btn.classList.contains('is-locked')) {
          updateRatio();
        }
      });

      w.addEventListener('input', () => {
        if (btn.classList.contains('is-locked')) {
          const wv = parseFloat(w.value);
          if (!isNaN(wv) && wv > 0 && editorResLocks[type] > 0) {
            h.value = Math.max(1, Math.round(wv / editorResLocks[type]));
          }
        }
      });

      h.addEventListener('input', () => {
        if (btn.classList.contains('is-locked')) {
          const hv = parseFloat(h.value);
          if (!isNaN(hv) && hv > 0 && editorResLocks[type] > 0) {
            w.value = Math.max(1, Math.round(hv * editorResLocks[type]));
          }
        }
      });
    }
    window.setupEditorResLink = setupEditorResLink;

    function initEditorResLinks() {
      setupEditorResLink('btn-link-res', 'custom-res-w', 'custom-res-h', 'new');
      setupEditorResLink('settings-btn-link-res', 'settings-custom-res-w', 'settings-custom-res-h', 'settings');
    }
    window.initEditorResLinks = initEditorResLinks;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initEditorResLinks);
    } else {
      initEditorResLinks();
    }

    // --- Unified Cross-Module Shared Mutable State Initialization ---
    // All 11 editor modules share live mutable bindings via window getters and setters.
    let _currentProjectState = {
      id: '',
      name: 'New_Project',
      aspectRatio: '16:9',
      resolution: '1080p',
      fps: 60,
      bgColor: 'transparent',
      defaultDuration: 5,
      beatmarks: []
    };
    let _compositionStack = [];
    let _currentActivePrecomp = null;
    let _isSelectorMode = false;
    let _selectedLayerIds = new Set();
    let _selectedLayerId = null;
    let _isPlaying = false;
    let _panX = 0;
    let _pixelsPerSecond = 80;
    let _currentDrawerSubview = 'main';
    let _currentRotateAxis = 'z';
    let _lastContextClickSec = null;
    let _lastGeneratedDuration = -1;
    let _layerMediaCache = (typeof window !== 'undefined' && window.layerMediaCache) || new Map();
    let _projectDirty = false;
    let _lastSaveTime = 0;

    try {
      Object.defineProperty(window, 'currentProjectState', {
        get() { return _currentProjectState; },
        set(v) { if (v && typeof v === 'object') _currentProjectState = v; },
        configurable: true
      });
      Object.defineProperty(window, 'beatmarks', {
        get() { return (_currentProjectState && Array.isArray(_currentProjectState.beatmarks)) ? _currentProjectState.beatmarks : []; },
        set(v) { if (_currentProjectState && Array.isArray(v)) _currentProjectState.beatmarks = v; },
        configurable: true
      });
      Object.defineProperty(window, 'compositionStack', {
        get() { return _compositionStack; },
        set(v) { if (Array.isArray(v)) _compositionStack = v; },
        configurable: true
      });
      Object.defineProperty(window, 'currentActivePrecomp', {
        get() { return _currentActivePrecomp; },
        set(v) { _currentActivePrecomp = v || null; },
        configurable: true
      });
      Object.defineProperty(window, 'isSelectorMode', {
        get() { return _isSelectorMode; },
        set(v) { _isSelectorMode = Boolean(v); },
        configurable: true
      });
      Object.defineProperty(window, 'selectedLayerIds', {
        get() { return _selectedLayerIds; },
        set(v) {
          if (v instanceof Set) _selectedLayerIds = v;
          else if (Array.isArray(v)) _selectedLayerIds = new Set(v);
          else if (!v) _selectedLayerIds.clear();
        },
        configurable: true
      });
      Object.defineProperty(window, 'selectedLayerId', {
        get() { return _selectedLayerId; },
        set(v) { _selectedLayerId = v || null; },
        configurable: true
      });
      Object.defineProperty(window, 'isPlaying', {
        get() { return _isPlaying; },
        set(v) {
          _isPlaying = Boolean(v);
          window.isTimelinePlaying = _isPlaying;
        },
        configurable: true
      });
      Object.defineProperty(window, 'panX', {
        get() {
          if (window.timelinePanX !== undefined && window.timelinePanX !== _panX) {
            _panX = window.timelinePanX;
          }
          return _panX;
        },
        set(v) {
          _panX = Number(v) || 0;
          window.timelinePanX = _panX;
        },
        configurable: true
      });
      Object.defineProperty(window, 'pixelsPerSecond', {
        get() {
          if (window.currentPixelsPerSecond !== undefined && window.currentPixelsPerSecond !== _pixelsPerSecond) {
            _pixelsPerSecond = window.currentPixelsPerSecond;
          }
          return _pixelsPerSecond;
        },
        set(v) {
          _pixelsPerSecond = Number(v) || 80;
          window.currentPixelsPerSecond = _pixelsPerSecond;
        },
        configurable: true
      });
      Object.defineProperty(window, 'currentDrawerSubview', {
        get() { return _currentDrawerSubview; },
        set(v) { _currentDrawerSubview = String(v || 'main'); },
        configurable: true
      });
      Object.defineProperty(window, 'currentRotateAxis', {
        get() { return _currentRotateAxis; },
        set(v) { _currentRotateAxis = String(v || 'z'); },
        configurable: true
      });
      Object.defineProperty(window, 'lastContextClickSec', {
        get() { return _lastContextClickSec; },
        set(v) { _lastContextClickSec = (v !== null && v !== undefined) ? Number(v) : null; },
        configurable: true
      });
      Object.defineProperty(window, 'lastGeneratedDuration', {
        get() { return _lastGeneratedDuration; },
        set(v) { _lastGeneratedDuration = Number(v); },
        configurable: true
      });
      Object.defineProperty(window, 'layerMediaCache', {
        get() { return _layerMediaCache; },
        set(v) { if (v instanceof Map) _layerMediaCache = v; },
        configurable: true
      });
      Object.defineProperty(window, 'resMap', {
        get() { return _resMap; },
        set(v) { if (v && typeof v === 'object') _resMap = v; },
        configurable: true
      });
    } catch (_) {}

    window.selectedLayerIds = _selectedLayerIds;
    window.selectedLayerId = _selectedLayerId;
    window.layerMediaCache = _layerMediaCache;
    window.compositionStack = _compositionStack;
    window.currentActivePrecomp = _currentActivePrecomp;
    window.isSelectorMode = _isSelectorMode;
    window.timelinePanX = _panX;
    window.currentPixelsPerSecond = _pixelsPerSecond;
    window.currentDrawerSubview = _currentDrawerSubview;
    window.currentRotateAxis = _currentRotateAxis;
    window.lastGeneratedDuration = _lastGeneratedDuration;
    window.lastContextClickSec = _lastContextClickSec;


    // Hierarchical Layer & Precompose Lookup Utilities
    function findLayerById(id, rootLayers = null) {
      if (!id) return null;
      const layers = rootLayers || (currentProjectState && currentProjectState.layers) || [];
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        if (l && (l.id === id || String(l.id) === String(id))) return l;
        if (l && l.type === 'precomp' && Array.isArray(l.layers)) {
          const child = findLayerById(id, l.layers);
          if (child) {
            if (!child._parentPrecomp) child._parentPrecomp = l;
            if (!child._parentPrecompId) child._parentPrecompId = l.id;
            return child;
          }
        }
      }
      return null;
    }
    window.findLayerById = findLayerById;
    window.getLayerById = findLayerById;

    function findLayerParentPrecomp(id, rootLayers = null) {
      if (!id) return null;
      const layers = rootLayers || (currentProjectState && currentProjectState.layers) || [];
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        if (l && l.type === 'precomp' && Array.isArray(l.layers)) {
          if (l.layers.some(child => child && (child.id === id || String(child.id) === String(id)))) {
            return l;
          }
          const deep = findLayerParentPrecomp(id, l.layers);
          if (deep) return deep;
        }
      }
      return null;
    }
    window.findLayerParentPrecomp = findLayerParentPrecomp;

    function attachRecursiveFind(arr) {
      if (!Array.isArray(arr)) return;
      if (!arr._hasRecursiveFind) {
        Object.defineProperty(arr, '_hasRecursiveFind', { value: true, configurable: true });
        const origFind = arr.find;
        arr.find = function(predicate, thisArg) {
          const res = origFind.call(this, predicate, thisArg);
          if (res !== undefined) return res;
          for (let i = 0; i < this.length; i++) {
            const l = this[i];
            if (l && l.type === 'precomp' && Array.isArray(l.layers)) {
              attachRecursiveFind(l.layers);
              const childRes = l.layers.find(predicate, thisArg);
              if (childRes !== undefined) {
                if (!childRes._parentPrecomp) childRes._parentPrecomp = l;
                if (!childRes._parentPrecompId) childRes._parentPrecompId = l.id;
                return childRes;
              }
            }
          }
          return undefined;
        };
      }
    }
    window.attachRecursiveFind = attachRecursiveFind;

    let _currentLayers = [];
    Object.defineProperty(currentProjectState, 'layers', {
      configurable: true,
      enumerable: true,
      get() { return _currentLayers; },
      set(val) {
        _currentLayers = Array.isArray(val) ? val : [];
        attachRecursiveFind(_currentLayers);
      }
    });
    currentProjectState.layers = [];
    window.currentProjectState = currentProjectState;

    try {
      const isEditorPage = !window.location.pathname.includes('desktop.html') && !window.location.pathname.includes('/desktop');
      const ua = navigator.userAgent || '';
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|SM-G/i.test(ua) ||
        (window.matchMedia && window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches) ||
        window.innerWidth < 900;
      if (isEditorPage && isMobileDevice) {
        localStorage.setItem('oft_preferred_view', 'mobile');
      }
    } catch (_) {}




    // Composition Hierarchy Stack, Active Precomp & Multi-Selector Mode already initialized at top


    // Global Unified Project FPS Resolver
    function getProjectFps() {
      if (typeof currentProjectState !== 'undefined' && currentProjectState && currentProjectState.fps) {
        const val = parseInt(currentProjectState.fps, 10);
        if (!isNaN(val) && val > 0) {
          if (window.currentTimelineFps !== val) {
            window.currentTimelineFps = val;
          }
          return val;
        }
      }
      if (typeof window.currentTimelineFps === 'number' && window.currentTimelineFps > 0) {
        return window.currentTimelineFps;
      }
      const fpsDropdown = document.getElementById('dropdown-fps');
      if (fpsDropdown && fpsDropdown.dataset && fpsDropdown.dataset.value) {
        const val = parseInt(fpsDropdown.dataset.value, 10);
        if (!isNaN(val) && val > 0) return val;
      }
      try {
        const params = new URLSearchParams(window.location.search);
        const fpsParam = params.get('fps');
        if (fpsParam) {
          const val = parseInt(fpsParam, 10);
          if (!isNaN(val) && val > 0) return val;
        }
      } catch (_) {}
      return 60;
    }
    window.getProjectFps = getProjectFps;

    // Global Playback State Helper
    function isAnyPlaybackActive() {
      return !!(
        window.isTimelinePlaying ||
        (typeof window.isPlaying !== 'undefined' && window.isPlaying) ||
        (window.FishTemplateEditor && window.FishTemplateEditor.isPlaying)
      );
    }
    window.isAnyPlaybackActive = isAnyPlaybackActive;

    // Universal Root Function Delegates (prevents lexical closure ReferenceErrors & circular self-calls)
    function renderTimelineLayers(...args) {
      if (typeof window.renderTimelineLayers === 'function' && window.renderTimelineLayers !== renderTimelineLayers) {
        return window.renderTimelineLayers.apply(this, args);
      }
    }
    function selectTimelineLayer(...args) {
      if (typeof window.selectTimelineLayer === 'function' && window.selectTimelineLayer !== selectTimelineLayer) {
        return window.selectTimelineLayer.apply(this, args);
      }
    }
    function deselectTimelineLayer(...args) {
      if (typeof window.deselectTimelineLayer === 'function' && window.deselectTimelineLayer !== deselectTimelineLayer) {
        return window.deselectTimelineLayer.apply(this, args);
      }
    }
    function centerSelectedTimelineLayer(...args) {
      if (typeof window.centerSelectedTimelineLayer === 'function' && window.centerSelectedTimelineLayer !== centerSelectedTimelineLayer) {
        return window.centerSelectedTimelineLayer.apply(this, args);
      }
    }
    function updateEditorHeaderMode(...args) {
      if (typeof window.updateEditorHeaderMode === 'function' && window.updateEditorHeaderMode !== updateEditorHeaderMode) {
        return window.updateEditorHeaderMode.apply(this, args);
      }
    }
    function updatePlayButtonUI(...args) {
      if (typeof window.updatePlayButtonUI === 'function' && window.updatePlayButtonUI !== updatePlayButtonUI) {
        return window.updatePlayButtonUI.apply(this, args);
      }
    }
    function updateGraphEditorUI(...args) {
      if (typeof window.updateGraphEditorUI === 'function' && window.updateGraphEditorUI !== updateGraphEditorUI) {
        return window.updateGraphEditorUI.apply(this, args);
      }
    }
    function syncLayerKeyframeMarkersInPlace(...args) {
      if (typeof window.syncLayerKeyframeMarkersInPlace === 'function' && window.syncLayerKeyframeMarkersInPlace !== syncLayerKeyframeMarkersInPlace) {
        return window.syncLayerKeyframeMarkersInPlace.apply(this, args);
      }
    }
    function syncBeatmarkDrawerUI(...args) {
      if (typeof window.syncBeatmarkDrawerUI === 'function' && window.syncBeatmarkDrawerUI !== syncBeatmarkDrawerUI) {
        return window.syncBeatmarkDrawerUI.apply(this, args);
      }
    }
    function navigateBeatmark(...args) {
      if (typeof window.navigateBeatmark === 'function' && window.navigateBeatmark !== navigateBeatmark) {
        return window.navigateBeatmark.apply(this, args);
      }
    }
    function renderAudioClipWaveform(...args) {
      if (typeof window.renderAudioClipWaveform === 'function' && window.renderAudioClipWaveform !== renderAudioClipWaveform) {
        return window.renderAudioClipWaveform.apply(this, args);
      }
    }
    function updateVolumeAndSpeedBtnState(...args) {
      if (typeof window.updateVolumeAndSpeedBtnState === 'function' && window.updateVolumeAndSpeedBtnState !== updateVolumeAndSpeedBtnState) {
        return window.updateVolumeAndSpeedBtnState.apply(this, args);
      }
    }
    function enterPrecompose(...args) {
      if (typeof window.enterPrecompose === 'function' && window.enterPrecompose !== enterPrecompose) {
        return window.enterPrecompose.apply(this, args);
      }
    }
    function exitPrecompose(...args) {
      if (typeof window.exitPrecompose === 'function' && window.exitPrecompose !== exitPrecompose) {
        return window.exitPrecompose.apply(this, args);
      }
    }
    function toggleBeatmarkAtCurrentTime(...args) {
      if (typeof window.toggleBeatmarkAtCurrentTime === 'function' && window.toggleBeatmarkAtCurrentTime !== toggleBeatmarkAtCurrentTime) {
        return window.toggleBeatmarkAtCurrentTime.apply(this, args);
      }
    }
    function seekTimelineToTime(...args) {
      if (typeof window.seekTimelineToTime === 'function' && window.seekTimelineToTime !== seekTimelineToTime) {
        return window.seekTimelineToTime.apply(this, args);
      }
    }
    function updateGraphPlayheadLine(...args) {
      if (typeof window.updateGraphPlayheadLine === 'function' && window.updateGraphPlayheadLine !== updateGraphPlayheadLine) {
        return window.updateGraphPlayheadLine.apply(this, args);
      }
    }
    function updateBeatmarkPlayheadNeedle(...args) {
      if (typeof window.updateBeatmarkPlayheadNeedle === 'function' && window.updateBeatmarkPlayheadNeedle !== updateBeatmarkPlayheadNeedle) {
        return window.updateBeatmarkPlayheadNeedle.apply(this, args);
      }
    }
    function pausePlayback(...args) {
      if (typeof window.pausePlayback === 'function' && window.pausePlayback !== pausePlayback) {
        return window.pausePlayback.apply(this, args);
      }
    }
    function formatTransformNumber(val) {
      if (typeof window.formatTransformNumber === 'function' && window.formatTransformNumber !== formatTransformNumber) {
        return window.formatTransformNumber(val);
      }
      if (val === null || val === undefined || isNaN(val)) return '0';
      const n = Number(val);
      if (Math.abs(n - Math.round(n)) < 0.01) return Math.round(n).toString();
      return n.toFixed(1);
    }
    window.formatTransformNumber = formatTransformNumber;
    function findSnapTarget(val, targets, threshold) {
      if (typeof window.findSnapTarget === 'function' && window.findSnapTarget !== findSnapTarget) {
        return window.findSnapTarget(val, targets, threshold);
      }
      if (!targets || !targets.length) return null;
      let closest = null;
      let minDiff = threshold;
      for (let i = 0; i < targets.length; i++) {
        const diff = Math.abs(val - targets[i]);
        if (diff < minDiff) {
          minDiff = diff;
          closest = targets[i];
        }
      }
      return closest;
    }
    window.findSnapTarget = findSnapTarget;
    function renderMediaGrid(...args) {
      if (typeof window.renderMediaGrid === 'function' && window.renderMediaGrid !== renderMediaGrid) {
        return window.renderMediaGrid.apply(this, args);
      }
    }
    function decodeAudioFromBlob(...args) {
      if (typeof window.decodeAudioFromBlob === 'function' && window.decodeAudioFromBlob !== decodeAudioFromBlob) {
        return window.decodeAudioFromBlob.apply(this, args);
      }
    }
    function audioBufferToMp3(...args) {
      if (typeof window.audioBufferToMp3 === 'function' && window.audioBufferToMp3 !== audioBufferToMp3) {
        return window.audioBufferToMp3.apply(this, args);
      }
    }
    

    // 100% Functional Undo / Redo Manager
    const UndoRedoManager = {
      stack: [],
      index: -1,
      maxSteps: 30,
      isApplying: false,
      _eventsBound: false,

      init(maxSteps = 30) {
        this.maxSteps = maxSteps;
        this.updateUI();
        this.bindEvents();
      },

      setMaxSteps(steps) {
        this.maxSteps = Math.max(5, parseInt(steps, 10) || 30);
        while (this.stack.length > this.maxSteps + 1) {
          this.stack.shift();
          this.index = Math.max(0, this.index - 1);
        }
        this.updateUI();
      },

      _safeClone(obj) {
        if (!obj) return obj;
        try {
          const seen = new WeakSet();
          return JSON.parse(JSON.stringify(obj, (k, v) => {
            if (typeof k === 'string' && k.startsWith('_') && k !== '_userResized' && k !== '_defaultEasing') return undefined;
            if (v !== null && typeof v === 'object') {
              if (typeof Element !== 'undefined' && v instanceof Element) return undefined;
              if (typeof Node !== 'undefined' && v instanceof Node) return undefined;
              if (typeof Window !== 'undefined' && v instanceof Window) return undefined;
              if (seen.has(v)) return undefined;
              seen.add(v);
            }
            if (typeof v === 'function') return undefined;
            return v;
          }));
        } catch (e) {
          console.warn('[UndoRedo] Clone failed:', e);
          return Array.isArray(obj) ? [] : {}; 
        }
      },

      _cloneLayersForSnapshot(layers, visited = new Set()) {
        if (!layers || !layers.length) return [];
        return layers.map(l => {
          if (!l || visited.has(l) || (l.id && visited.has(l.id))) return null;
          if (l.id) visited.add(l.id);
          visited.add(l);
          const c = {};
          for (const k in l) {
            if (typeof k === 'string' && k.startsWith('_') && k !== '_userResized' && k !== '_defaultEasing') continue;
            c[k] = l[k];
          }
          if (l.keyframes) c.keyframes = this._safeClone(l.keyframes);
          if (l.expressions) c.expressions = this._safeClone(l.expressions);
          if (l.defaultEasing) c.defaultEasing = this._safeClone(l.defaultEasing);
          if (l._defaultEasing) c._defaultEasing = this._safeClone(l._defaultEasing);
          if (l.effects) c.effects = this._safeClone(l.effects);
          if (l.shapeProps) c.shapeProps = this._safeClone(l.shapeProps);
          if (l.parentBind) c.parentBind = this._safeClone(l.parentBind);
          if (Array.isArray(l.layers)) c.layers = this._cloneLayersForSnapshot(l.layers, visited);
          return c;
        }).filter(Boolean);
      },

      _computeFingerprint(layers, beatmarks, markerNames = {}) {
        try {
          const lSig = (layers || []).filter(l => l && typeof l === 'object').map(l => {
            let kfCount = 0;
            let kfSig = '';
            if (l.keyframes) {
              for (const p in l.keyframes) {
                if (Array.isArray(l.keyframes[p])) {
                  kfCount += l.keyframes[p].length;
                  kfSig += p + ':' + l.keyframes[p].map(k => {
                    let vStr = '';
                    try { vStr = JSON.stringify(k.value); } catch(_) { vStr = 'err'; }
                    let cfgStr = '';
                    try { cfgStr = k.easingConfig ? JSON.stringify(k.easingConfig) : ''; } catch(_) {}
                    return `${k.time}:${vStr}:${(k.easing || []).join(',')}:${cfgStr}`;
                  }).join('|') + ';';
                }
              }
            }
            let exprSig = '';
            try { exprSig = (l.expressions && typeof l.expressions === 'object') ? JSON.stringify(l.expressions) : ''; } catch(_) {}
            let defEasSig = '';
            const defEas = l.defaultEasing || l._defaultEasing;
            if (defEas) {
              for (const dp in defEas) {
                if (Array.isArray(defEas[dp])) defEasSig += dp + ':' + defEas[dp].join(',') + ';';
              }
            }
            const fxSig = (Array.isArray(l.effects) ? l.effects : []).map(f => {
              if (!f || typeof f !== 'object') return '';
              let s = f.id || f.type || '';
              for (const k in f) {
                if (!k.startsWith('_') && typeof f[k] !== 'function') s += ',' + k + ':' + f[k];
              }
              return s;
            }).join(';');
            let childSig = '';
            if (Array.isArray(l.layers)) {
              childSig = this._computeFingerprint(l.layers, [], {});
            }
            return `${l.id}:${l.name || ''}:${l.startSec}:${l.durationSec}:${l.posX}:${l.posY}:${l.posZ || 0}:${l.anchorX || 0}:${l.anchorY || 0}:${l.scaleW}:${l.scaleH}:${l.rotation}:${l.rotZ || 0}:${l.skew || 0}:${l.opacity}:${l.volume !== undefined ? l.volume : 1}:${l.hidden ? 1 : 0}:${l.locked ? 1 : 0}:${l.blendMode || ''}:${l.parentId || ''}:${l.scaleLinked !== false ? 1 : 0}:${l.motionBlur ? 1 : 0}:${l.is3D ? 1 : 0}:${l.collapseTransformations ? 1 : 0}:${l.roundness || 0}:${kfCount}:${kfSig}:${fxSig}:${exprSig}:${defEasSig}:${childSig}`;
          }).join(';');
          const bSig = (Array.isArray(beatmarks) ? beatmarks : []).join(',');
          let mSig = '';
          try { mSig = (markerNames && typeof markerNames === 'object' && Object.keys(markerNames).length > 0) ? JSON.stringify(markerNames) : ''; } catch(_) {}
          return `${lSig}|${bSig}|${mSig}`;
        } catch (e) {
          console.warn('[UndoRedo] Fingerprint error:', e);
          return Date.now().toString(); // Fallback fingerprint
        }
      },

      recordSnapshot() {
        try {
          if (this.isApplying) return;
          const beatmarksCopy = Array.isArray(currentProjectState.beatmarks) ? [...currentProjectState.beatmarks] : [];
          const markerNamesCopy = (currentProjectState.markerNames && typeof currentProjectState.markerNames === 'object') ? { ...currentProjectState.markerNames } : {};
          const fingerprint = this._computeFingerprint(currentProjectState.layers || [], beatmarksCopy, markerNamesCopy);

          // Avoid duplicate consecutive states
          if (this.index >= 0 && this.index < this.stack.length) {
            if (this.stack[this.index].fingerprint === fingerprint) {
              return;
            }
          }

          const layersCopy = this._cloneLayersForSnapshot(currentProjectState.layers || []);

          // Cut off redo branch
          this.stack = this.stack.slice(0, this.index + 1);

          this.stack.push({
            layers: layersCopy,
            beatmarks: beatmarksCopy,
            markerNames: markerNamesCopy,
            fingerprint
          });

          // Enforce max undo limit (dropping oldest)
          if (this.stack.length > this.maxSteps + 1) {
            this.stack.shift();
          }
          this.index = this.stack.length - 1;
          this.updateUI();
        } catch (err) {
          console.warn('[UndoRedo] recordSnapshot failed:', err);
        }
      },

      canUndo() {
        return this.index > 0;
      },

      canRedo() {
        return this.index < this.stack.length - 1;
      },

      async undo() {
        if (!this.canUndo()) return;
        this.index--;
        await this.applySnapshot(this.stack[this.index]);
        this.updateUI();
      },

      async redo() {
        if (!this.canRedo()) return;
        this.index++;
        await this.applySnapshot(this.stack[this.index]);
        this.updateUI();
      },

      async applySnapshot(snapshot) {
        if (!snapshot) return;
        this.isApplying = true;
        try {
          currentProjectState.layers = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(snapshot.layers || []) : (Array.isArray(snapshot.layers || []) ? [] : {}));
          if (Array.isArray(snapshot.beatmarks)) {
            currentProjectState.beatmarks = [...snapshot.beatmarks];
          }
          if (snapshot.markerNames && typeof snapshot.markerNames === 'object') {
            currentProjectState.markerNames = { ...snapshot.markerNames };
          } else {
            currentProjectState.markerNames = {};
          }
          if (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0) {
            window.selectedKeyframes.forEach(item => {
              const freshLayer = (currentProjectState.layers || []).find(l => l.id === item.layerId);
              if (freshLayer) {
                item.layer = freshLayer;
                if (freshLayer.keyframes && Array.isArray(freshLayer.keyframes[item.prop])) {
                  const matchTime = (item.kf && item.kf.time !== undefined) ? item.kf.time : item.time;
                  const freshKf = freshLayer.keyframes[item.prop].find(k => Math.abs(k.time - matchTime) < 0.005);
                  if (freshKf) item.kf = freshKf;
                }
              }
            });
          }
          if (typeof window.renderTimelineBeatmarks === 'function') {
            window.renderTimelineBeatmarks();
          }
          if (typeof window.syncDesktopMarkerLabels === 'function') {
            window.syncDesktopMarkerLabels();
          }
          if (typeof window.renderTimelineLayers === 'function') {
            window.renderTimelineLayers();
          }
          if (typeof window.updateTimelineDuration === 'function') {
            window.updateTimelineDuration(true);
          }
          if (typeof window.syncTransformControllerValues === 'function') {
            window.syncTransformControllerValues();
          }
          if (typeof window.updateTransformKeyframeBtnState === 'function') {
            window.updateTransformKeyframeBtnState();
          }
          if (typeof window.updateSpeedKeyframeBtnState === 'function') {
            window.updateSpeedKeyframeBtnState();
          }
          if (typeof window.syncSpeedControllerValues === 'function') {
            window.syncSpeedControllerValues();
          }
          if (typeof window.updateGraphEditorUI === 'function') {
            window.updateGraphEditorUI();
          }
          if (window.PreviewCacheManager) {
            window.PreviewCacheManager.clearAll();
          }
          if (typeof window.invalidateEffectivePropsCache === 'function') {
            window.invalidateEffectivePropsCache();
          }
          // Layers/effects are brand-new objects now: force the effects rack to rebuild so cards and
          // scrubbers stop referencing the pre-undo (orphaned) layer/effect objects.
          const fxRackList = document.getElementById('effects-rack-list');
          if (fxRackList) fxRackList.dataset.currentLayerId = '';
          if (typeof window.syncEffectsRackUI === 'function') {
            window.syncEffectsRackUI();
          }
          if (typeof redrawComposition === 'function') {
            redrawComposition('undo-redo');
          }
          await saveCurrentProjectLayers(true);
        } finally {
          this.isApplying = false;
        }
      },

      updateUI() {
        const undoBtn = document.getElementById('editor-btn-undo');
        const redoBtn = document.getElementById('editor-btn-redo');

        const canU = this.canUndo();
        const canR = this.canRedo();

        if (undoBtn) {
          undoBtn.disabled = !canU;
          undoBtn.classList.toggle('is-disabled', !canU);
        }
        if (redoBtn) {
          redoBtn.disabled = !canR;
          redoBtn.classList.toggle('is-disabled', !canR);
        }
      },

      bindEvents() {
        if (this._eventsBound) return;
        this._eventsBound = true;

        const undoBtn = document.getElementById('editor-btn-undo');
        if (undoBtn) {
          undoBtn.addEventListener('click', () => this.undo());
        }
        const redoBtn = document.getElementById('editor-btn-redo');
        if (redoBtn) {
          redoBtn.addEventListener('click', () => this.redo());
        }

        window.addEventListener('keydown', (e) => {
          if (e.target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable)) {
            return;
          }
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            this.undo();
          } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            this.redo();
          }
        });
      }
    };
    window.UndoRedoManager = UndoRedoManager;

    // Interaction-session dedupe for preview cache invalidation.
    // During a drag (rotate dial, move pad, scrubbers...) pointermove fires 60-120x/s and every
    // handler calls invalidatePreviewCacheForLayer(). The cached RAM preview range only needs to be
    // purged ONCE per layer per drag (PreviewCacheManager never caches while interacting), plus a
    // final purge when the drag ends. Effective-props cache is still cleared on every call.
    const _interactionTouchedLayers = new Map();

    (function installTransformInteractionFlag() {
      try {
        const desc = Object.getOwnPropertyDescriptor(window, 'isTransformInteracting');
        if (desc && typeof desc.set === 'function') return;
        let flagValue = !!(desc && desc.value);
        Object.defineProperty(window, 'isTransformInteracting', {
          configurable: true,
          enumerable: true,
          get() { return flagValue; },
          set(v) {
            const next = !!v;
            const wasInteracting = flagValue;
            flagValue = next;
            if (wasInteracting && !next && _interactionTouchedLayers.size > 0) {
              const touched = Array.from(_interactionTouchedLayers.values());
              _interactionTouchedLayers.clear();
              touched.forEach(l => {
                try { invalidatePreviewCacheForLayer(l); } catch (_) {}
              });
            }
          }
        });
      } catch (_) {}
    })();

    // Fast selective preview cache invalidation for a specific layer's timeline range (or union with prior range)
    function invalidatePreviewCacheForLayer(layer, customStartSec = null, customEndSec = null) {
      if (!window.PreviewCacheManager) return;
      const pps = window.currentPixelsPerSecond || 80;
      const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState.fps, 10) || 60);

      // Drag fast path: range already purged this session and layer timing unchanged → skip heavy work
      if (window.isTransformInteracting && layer && layer.id !== undefined &&
          (customStartSec === null || customStartSec === undefined) &&
          (customEndSec === null || customEndSec === undefined)) {
        const curStartFast = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const curDurFast = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
        const timingUnchanged = (layer._cachedStartSec === curStartFast && layer._cachedEndSec === curStartFast + curDurFast);
        if (_interactionTouchedLayers.has(layer.id) && timingUnchanged) {
          const parentPrecomp = layer._parentPrecomp || (typeof findLayerParentPrecomp === 'function' ? findLayerParentPrecomp(layer.id) : null);
          if (parentPrecomp) {
            parentPrecomp._dirty = true;
            if (parentPrecomp._precompBufferCanvas) parentPrecomp._precompBufferCanvas._lastRenderKey = null;
            if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.invalidatePrecomp === 'function') {
              window.VideoFrameExtractor.invalidatePrecomp(parentPrecomp);
            }
          }
          if (layer.type === 'text') {
            layer._textDirty = true;
            if (layer._textBufferCanvas) layer._textBufferCanvas._lastRenderKey = null;
          }
          if (layer.type === 'precomp' && layer._forceBakeInvalidation) {
            layer._forceBakeInvalidation = false;
            layer._dirty = true;
            if (layer._precompBufferCanvas) layer._precompBufferCanvas._lastRenderKey = null;
            if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.invalidatePrecomp === 'function') {
              window.VideoFrameExtractor.invalidatePrecomp(layer);
            }
          }
          if (layer.type === 'shape') {
            layer._shapeDirty = true;
            layer._fillDirty = true;
            if (layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
            if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
          }
          if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
          return;
        }
        _interactionTouchedLayers.set(layer.id, layer);
      }

      let minStart = Infinity;
      let maxEnd = -Infinity;

      if (customStartSec !== null && customStartSec !== undefined && customEndSec !== null && customEndSec !== undefined) {
        minStart = Math.min(customStartSec, customEndSec);
        maxEnd = Math.max(customStartSec, customEndSec);
      }

      if (layer) {
        if (layer.type === 'audio') return; // Audio produces no canvas pixels — never invalidate canvas RAM preview cache!
        const parentPrecomp = layer._parentPrecomp || (typeof findLayerParentPrecomp === 'function' ? findLayerParentPrecomp(layer.id) : null);
        if (parentPrecomp) {
          parentPrecomp._dirty = true;
          if (parentPrecomp._precompBufferCanvas) parentPrecomp._precompBufferCanvas._lastRenderKey = null;
          if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.invalidatePrecomp === 'function') {
            window.VideoFrameExtractor.invalidatePrecomp(parentPrecomp);
          }
        }
        if (layer.type === 'text') {
          layer._textDirty = true;
          if (layer._textBufferCanvas) layer._textBufferCanvas._lastRenderKey = null;
        }
        if (layer.type === 'precomp' && layer._forceBakeInvalidation) {
          layer._forceBakeInvalidation = false;
          layer._dirty = true;
          if (layer._precompBufferCanvas) layer._precompBufferCanvas._lastRenderKey = null;
          if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.invalidatePrecomp === 'function') {
            window.VideoFrameExtractor.invalidatePrecomp(layer);
          }
        }
        if (layer.type === 'shape') {
          layer._shapeDirty = true;
          layer._fillDirty = true;
          if (layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
          if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
        }
        const curStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const curDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
        const curEnd = curStart + curDur;

        // Union with previously recorded cached span to guarantee trimmed-away or moved spans are purged
        const prevStart = (layer._cachedStartSec !== undefined) ? layer._cachedStartSec : curStart;
        const prevEnd = (layer._cachedEndSec !== undefined) ? layer._cachedEndSec : curEnd;

        minStart = Math.min(minStart, curStart, prevStart);
        maxEnd = Math.max(maxEnd, curEnd, prevEnd);

        layer._cachedStartSec = curStart;
        layer._cachedEndSec = curEnd;

        // If this layer has children (e.g. Null linked to camera or layers), include all descendants spans
        if (Array.isArray(currentProjectState.layers)) {
          const visitedDescendants = new Set([layer.id]);
          const findDescendants = (parentId) => {
            if (!parentId) return [];
            const list = [];
            currentProjectState.layers.forEach(l => {
              if (l && l.parentId === parentId && !visitedDescendants.has(l.id)) {
                visitedDescendants.add(l.id);
                list.push(l);
                list.push(...findDescendants(l.id));
              }
            });
            return list;
          };
          const descendants = findDescendants(layer.id);
          descendants.forEach(ch => {
            const chStart = ch.startSec !== undefined ? ch.startSec : ((ch.startPx || 0) / pps);
            const chDur = ch.durationSec !== undefined ? ch.durationSec : ((ch.widthPx || 400) / pps);
            minStart = Math.min(minStart, chStart);
            maxEnd = Math.max(maxEnd, chStart + chDur);
          });

          // Invalidate layers whose effects reference this layer (e.g. Fluid Fish firstLayer / destLayer)
          const lIdStr = String(layer.id);
          currentProjectState.layers.forEach(referencingLayer => {
            if (!referencingLayer || referencingLayer === layer) return;
            const hasRef = Array.isArray(referencingLayer.effects) && referencingLayer.effects.some(f => {
              if (!f || f.disabled) return false;
              return String(f.firstLayer || '') === lIdStr || String(f.destLayer || '') === lIdStr;
            });
            if (hasRef) {
              const refStart = referencingLayer.startSec !== undefined ? referencingLayer.startSec : ((referencingLayer.startPx || 0) / pps);
              const refDur = referencingLayer.durationSec !== undefined ? referencingLayer.durationSec : ((referencingLayer.widthPx || 400) / pps);
              minStart = Math.min(minStart, refStart);
              maxEnd = Math.max(maxEnd, refStart + refDur);
            }
          });
        }
      }

      if (isFinite(minStart) && isFinite(maxEnd) && minStart <= maxEnd) {
        window.PreviewCacheManager.invalidateRange(Math.max(0, minStart - 0.2), maxEnd + 0.2, fps);

        if (layer && layer.type === 'precomp') {
          const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
          window.PreviewCacheManager.invalidateRange(0, dur + 0.2, fps, layer.id);
        }

        // If inside precompose, selectively invalidate affected range in parent pool and current precomp pool
        if (currentActivePrecomp) {
          window.PreviewCacheManager.invalidateRange(Math.max(0, minStart - 0.2), maxEnd + 0.2, fps, currentActivePrecomp.id);
          if (compositionStack && compositionStack.length > 0) {
            const parentCompId = compositionStack[compositionStack.length - 1].parentPrecomp?.id || 'root';
            const pStart = (currentActivePrecomp.startSec || 0) + minStart - (currentActivePrecomp.sourceOffsetSec || 0);
            const pEnd = (currentActivePrecomp.startSec || 0) + maxEnd - (currentActivePrecomp.sourceOffsetSec || 0);
            window.PreviewCacheManager.invalidateRange(Math.max(0, pStart - 0.2), pEnd + 0.2, fps, parentCompId);
            currentActivePrecomp._precompBufferCanvas = null;
          }
        }
      }
      if (typeof invalidateEffectivePropsCache === 'function') {
        invalidateEffectivePropsCache();
      }
    }
    window.invalidatePreviewCacheForLayer = invalidatePreviewCacheForLayer;

    // Sync a layer's base properties with its current effective animated properties at currentSec
    function syncLayerWithEffectiveProps(layer) {
      if (!layer) return;
      const pps = window.currentPixelsPerSecond || 80;
      const currentPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
      const currentSec = Math.abs(currentPanX) / pps;
      const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, currentSec, null, null, true) : null;
      if (!eff) return;

      if (eff.posX !== undefined) layer.posX = eff.posX;
      if (eff.posY !== undefined) layer.posY = eff.posY;
      if (eff.posZ !== undefined) layer.posZ = eff.posZ;
      if (eff.anchorX !== undefined) layer.anchorX = eff.anchorX;
      if (eff.anchorY !== undefined) layer.anchorY = eff.anchorY;
      if (eff.anchorZ !== undefined) layer.anchorZ = eff.anchorZ;
      if (eff.rotZ !== undefined) {
        layer.rotZ = eff.rotZ;
        layer.rotation = eff.rotZ;
      }
      if (eff.rotX !== undefined) layer.rotX = eff.rotX;
      if (eff.rotY !== undefined) layer.rotY = eff.rotY;
      if (eff.scaleW !== undefined) layer.scaleW = eff.scaleW;
      if (eff.scaleH !== undefined) layer.scaleH = eff.scaleH;
      if (eff.scaleZ !== undefined) layer.scaleZ = eff.scaleZ;
      if (eff.skewX !== undefined) layer.skewX = eff.skewX;
      if (eff.skewY !== undefined) layer.skewY = eff.skewY;
      if (eff.opacity !== undefined) layer.opacity = eff.opacity;
      if (eff.volume !== undefined) layer.volume = eff.volume;
      if (eff.speed !== undefined) layer.speed = eff.speed;
      if (eff.timeRemap !== undefined) layer.timeRemap = eff.timeRemap;
      if (Array.isArray(eff.vectorPoints) && layer.type === 'shape' && layer.shapeType === 'vector') {
        if (!layer.shapeProps) layer.shapeProps = {};
        layer.shapeProps.points = eff.vectorPoints.map(pt => ({ ...pt }));
        if (typeof window.syncVectorLayerBounds === 'function') {
          window.syncVectorLayerBounds(layer, eff.scaleW === undefined && eff.scaleH === undefined);
        }
      }
      if (Array.isArray(eff.effects) && Array.isArray(layer.effects)) {
        layer.effects.forEach(fx => {
          const effFx = eff.effects.find(f => f.id === fx.id);
          if (effFx) {
            getEffectParamIds(fx).forEach(p => {
              if (effFx[p] !== undefined) fx[p] = effFx[p];
            });
          }
        });
        if (layer.effects[0]) {
          layer.brightness = layer.effects[0].brightness;
          layer.contrast = layer.effects[0].contrast;
        }
      }
    }
    function getEffectParamIds(fx) {
      if (!fx) return [];
      if (window.FishEffects && typeof window.FishEffects.getParamIds === 'function') {
        return window.FishEffects.getParamIds(fx);
      }
      return ['brightness', 'contrast'];
    }
    window.getEffectParamIds = getEffectParamIds;
    window.syncLayerWithEffectiveProps = syncLayerWithEffectiveProps;


    let saveLayersDebounceTimer = null;

    function captureProjectThumbnailPreview() {
      try {
        const canvas = document.getElementById('editor-active-canvas');
        if (!canvas || !canvas.width || !canvas.height) return null;
        const maxDim = 200;
        let thumbW = maxDim;
        let thumbH = Math.max(1, Math.round(maxDim * (canvas.height / canvas.width)));
        if (canvas.height > canvas.width) {
          thumbH = maxDim;
          thumbW = Math.max(1, Math.round(maxDim * (canvas.width / canvas.height)));
        }
        const off = document.createElement('canvas');
        off.width = thumbW;
        off.height = thumbH;
        const ctx = off.getContext('2d');
        ctx.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim() || 'transparent');
        ctx.fillRect(0, 0, thumbW, thumbH);
        ctx.drawImage(canvas, 0, 0, thumbW, thumbH);
        return off.toDataURL('image/jpeg', 0.55);
      } catch (e) {
        return null;
      }
    }
    window.captureProjectThumbnailPreview = captureProjectThumbnailPreview;

    function saveCurrentProjectLayers(immediate = false) {
      if (saveLayersDebounceTimer) {
        clearTimeout(saveLayersDebounceTimer);
        saveLayersDebounceTimer = null;
      }

      const doSave = async () => {
        if (window.UndoRedoManager && !window.UndoRedoManager.isApplying && !window.isTransformInteracting) {
          window.UndoRedoManager.recordSnapshot();
        }
        // Safety net: check all layers for timing/duration shifts against cached spans
        (currentProjectState.layers || []).forEach(l => {
          const pps = window.currentPixelsPerSecond || 80;
          const curStart = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
          const curDur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 400) / pps);
          const curEnd = curStart + curDur;
          if (l._cachedStartSec !== undefined && (Math.abs(l._cachedStartSec - curStart) > 0.001 || Math.abs(l._cachedEndSec - curEnd) > 0.001)) {
            invalidatePreviewCacheForLayer(l);
          }
        });

        // Break any circular or self-referencing parentId before saving
        if (Array.isArray(currentProjectState.layers)) {
          const layerMap = new Map();
          currentProjectState.layers.forEach(l => { if (l && l.id) layerMap.set(l.id, l); });
          currentProjectState.layers.forEach(l => {
            if (!l || !l.parentId) return;
            if (l.parentId === l.id) {
              l.parentId = null;
              return;
            }
            const seenParents = new Set([l.id]);
            let curr = layerMap.get(l.parentId);
            while (curr) {
              if (seenParents.has(curr.id)) {
                l.parentId = null;
                break;
              }
              seenParents.add(curr.id);
              curr = curr.parentId ? layerMap.get(curr.parentId) : null;
            }
          });
        }

        if (!window.FishDatabase) return;
        try {
          let prj = null;
          if (currentProjectState.id) {
            prj = await window.FishDatabase.getProject(currentProjectState.id);
          }
          if (!prj) {
            prj = {
              id: currentProjectState.id || ('prj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)),
              name: currentProjectState.name || 'New_Project',
              aspectRatio: currentProjectState.aspectRatio || '16:9',
              resolution: currentProjectState.resolution || '1080p',
              fps: String(currentProjectState.fps || 60),
              defaultDuration: currentProjectState.defaultDuration || 5,
              bgColor: currentProjectState.bgColor || 'transparent',
              motionBlur: currentProjectState.motionBlur ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(currentProjectState.motionBlur) : (Array.isArray(currentProjectState.motionBlur) ? [] : {})) : undefined,
              layers: []
            };
            currentProjectState.id = prj.id;
          }

          if (prj && prj.id) {
            prj.beatmarks = Array.isArray(currentProjectState.beatmarks) ? [...currentProjectState.beatmarks] : [];
            prj.markerNames = (currentProjectState.markerNames && typeof currentProjectState.markerNames === 'object') ? { ...currentProjectState.markerNames } : {};
            prj.pixelsPerSecond = window.currentPixelsPerSecond || 80;
            currentProjectState.pixelsPerSecond = prj.pixelsPerSecond;

            // Sync current active precomp layers if inside precomp
            if (currentActivePrecomp) {
              currentActivePrecomp.layers = currentProjectState.layers;
            }

            const layersToSave = (compositionStack && compositionStack.length > 0)
              ? compositionStack[0].layers
              : (currentProjectState.layers || []);

            const visitedSerialize = new Set();
            function serializeLayer(l) {
              if (!l || visitedSerialize.has(l) || (l.id && visitedSerialize.has(l.id))) return null;
              if (l.id) visitedSerialize.add(l.id);
              visitedSerialize.add(l);
              return {
                id: l.id,
                sourceLayerId: l.sourceLayerId || undefined,
                mediaId: l.mediaId,
                name: l.name,
                type: l.type,
                parentId: l.parentId || null,
                parentBind: l.parentBind ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.parentBind) : (Array.isArray(l.parentBind) ? [] : {})) : undefined,
                startPx: l.startPx,
                startSec: l.startSec,
                durationSec: l.durationSec,
                widthPx: l.widthPx,
                sourceOffsetSec: l.sourceOffsetSec || 0,
                mediaDuration: l.mediaDuration || null,
                isDurationExplicit: !!l.isDurationExplicit,
                isMuted: !!l.isMuted,
                normX: l.normX,
                normY: l.normY,
                normW: l.normW,
                normH: l.normH,
                posX: l.posX,
                posY: l.posY,
                posZ: l.posZ,
                anchorX: l.anchorX || 0,
                anchorY: l.anchorY || 0,
                anchorZ: l.anchorZ || 0,
                scaleW: l.scaleW,
                scaleH: l.scaleH,
                scaleZ: l.scaleZ !== undefined ? l.scaleZ : undefined,
                depth: l.depth !== undefined ? l.depth : undefined,
                rotation: l.rotation,
                rotX: l.rotX || 0,
                rotY: l.rotY || 0,
                rotZ: l.rotZ || 0,
                skewX: l.skewX,
                skewY: l.skewY,
                opacity: l.opacity !== undefined ? l.opacity : 1.0,
                blendMode: l.blendMode || 'normal',
                hasBrightnessContrast: !!l.hasBrightnessContrast,
                brightness: l.brightness !== undefined ? l.brightness : 0,
                contrast: l.contrast !== undefined ? l.contrast : 0,
                effectsDisabled: !!l.effectsDisabled,
                effects: Array.isArray(l.effects) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.effects) : (Array.isArray(l.effects) ? [] : {})) : undefined,
                thumbUrl: '',
                dataUrl: (l.mediaId ? '' : (l.dataUrl || '')),
                mediaWidth: l.mediaWidth || null,
                mediaHeight: l.mediaHeight || null,
                _userResized: !!l._userResized,
                hidden: !!l.hidden,
                motionBlur: !!l.motionBlur,
                is3D: !!l.is3D,
                collapseTransformations: !!l.collapseTransformations,
                keyframes: l.keyframes ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.keyframes) : (Array.isArray(l.keyframes) ? [] : {})) : undefined,
                expressions: (l.expressions && typeof l.expressions === 'object' && Object.keys(l.expressions).length > 0) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.expressions) : (Array.isArray(l.expressions) ? [] : {})) : undefined,
                defaultEasing: (l.defaultEasing || l._defaultEasing) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.defaultEasing || l._defaultEasing) : (Array.isArray(l.defaultEasing || l._defaultEasing) ? [] : {})) : undefined,
                _defaultEasing: (l.defaultEasing || l._defaultEasing) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.defaultEasing || l._defaultEasing) : (Array.isArray(l.defaultEasing || l._defaultEasing) ? [] : {})) : undefined,
                // Recursively serialize precompose child layers to prevent DataCloneError and strip temporary canvas buffers
                layers: Array.isArray(l.layers) ? l.layers.map(serializeLayer).filter(Boolean) : undefined,
                // Fill & Replaced Media properties
                fillType: l.fillType || undefined,
                fillColor: l.fillColor || undefined,
                fillGradType: l.fillGradType || undefined,
                fillGradAngle: l.fillGradAngle !== undefined ? l.fillGradAngle : undefined,
                fillGradColor1: l.fillGradColor1 || undefined,
                fillGradColor2: l.fillGradColor2 || undefined,
                fillGradStops: Array.isArray(l.fillGradStops) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.fillGradStops) : (Array.isArray(l.fillGradStops) ? [] : {})) : undefined,
                fillMediaId: l.fillMediaId || undefined,
                fillMediaName: l.fillMediaName || undefined,
                fillMediaUrl: l.fillMediaUrl || undefined,
                isSolid: !!l.isSolid,
                transformScaleX: (typeof l.transformScaleX === 'number' && !isNaN(l.transformScaleX)) ? l.transformScaleX : 1.0,
                transformScaleY: (typeof l.transformScaleY === 'number' && !isNaN(l.transformScaleY)) ? l.transformScaleY : 1.0,
                // Shape & Roundness settings
                shapeType: l.shapeType || undefined,
                shapeProps: l.shapeProps ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.shapeProps) : (Array.isArray(l.shapeProps) ? [] : {})) : undefined,
                roundness: l.roundness !== undefined ? l.roundness : undefined,
                // Text specific settings
                textProps: l.textProps ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.textProps) : (Array.isArray(l.textProps) ? [] : {})) : undefined,
                strokeColor: l.strokeColor || undefined,
                strokeWidth: l.strokeWidth !== undefined ? l.strokeWidth : undefined,
                // Camera specific settings
                cameraLens: l.cameraLens !== undefined ? l.cameraLens : undefined,
                cameraLensPreset: l.cameraLensPreset || undefined,
                cameraZoom: l.cameraZoom !== undefined ? l.cameraZoom : undefined,
                cameraBlurEnabled: !!l.cameraBlurEnabled,
                cameraFocusMode: l.cameraFocusMode || undefined,
                cameraFocusDistance: l.cameraFocusDistance !== undefined ? l.cameraFocusDistance : undefined,
                cameraFocusTargetLayerId: l.cameraFocusTargetLayerId || undefined,
                cameraBlurAmount: l.cameraBlurAmount !== undefined ? l.cameraBlurAmount : undefined,
                cameraBlurNearFar: l.cameraBlurNearFar !== undefined ? l.cameraBlurNearFar : undefined,
                cameraBlurBalance: l.cameraBlurBalance !== undefined ? l.cameraBlurBalance : undefined,
                // Overlap layer type flags — MUST be persisted or leapfrog behavior is lost on reload
                isOverlapCamera: l.isOverlapCamera ? true : undefined,
                isOverlapNull: l.isOverlapNull ? true : undefined,
                // Audio & Volume settings
                volume: l.volume !== undefined ? l.volume : 1.0,
                audioEffects: Array.isArray(l.audioEffects) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.audioEffects) : (Array.isArray(l.audioEffects) ? [] : {})) : undefined,
                // Speed & Video Interpolation settings
                speed: l.speed !== undefined ? l.speed : 1.0,
                speedInterpolation: l.speedInterpolation || 'none',
                preservePitch: l.preservePitch !== undefined ? l.preservePitch : true
              };
            }

            // Cleanly clone layers to prevent DataCloneError and keep IDB write ultra-lightweight (<2ms)
            prj.layers = (layersToSave || []).map(serializeLayer).filter(Boolean);
            if (typeof window.getProjectTotalDuration === 'function') {
              prj.duration = window.getProjectTotalDuration();
              currentProjectState.duration = prj.duration;
            }
            if (currentProjectState.motionBlur) {
              prj.motionBlur = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(currentProjectState.motionBlur) : (Array.isArray(currentProjectState.motionBlur) ? [] : {}));
            }
            if (currentProjectState.customEasingPresets) {
              prj.customEasingPresets = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(currentProjectState.customEasingPresets) : (Array.isArray(currentProjectState.customEasingPresets) ? [] : {}));
            }
            prj.isTemplate = !!currentProjectState.isTemplate;

            // Auto-capture project thumbnail from composition canvas
            const thumb = captureProjectThumbnailPreview();
            if (thumb) {
              prj.thumbnail = thumb;
              currentProjectState.thumbnail = thumb;
            } else if (currentProjectState.thumbnail) {
              prj.thumbnail = currentProjectState.thumbnail;
            }

            // Synchronous active project backup to ensure zero loss if tab unloads
            try {
              localStorage.setItem('oft_active_project_backup_' + prj.id, JSON.stringify(prj));
            } catch (_) {}

            await window.FishDatabase.saveProject(prj);

            _projectDirty = false;
            _lastSaveTime = Date.now();
            try { localStorage.removeItem('fishtool_emergency_layers'); } catch (_) {}

            // Guarantee URL always has project ID so F5 refresh never loses project
            if (prj.id) {
              try {
                const url = new URL(window.location.href);
                if (url.searchParams.get('id') !== prj.id) {
                  url.searchParams.set('id', prj.id);
                  window.history.replaceState({}, '', url.toString());
                }
              } catch (_) {}
            }
          }
        } catch (err) {
          console.warn('Failed saving project layers to DB:', err);
        }
      };

      if (immediate) {
        return doSave();
      } else {
        return new Promise(resolve => {
          saveLayersDebounceTimer = setTimeout(async () => {
            await doSave();
            resolve();
          }, 20);
        });
      }
    }
    // ──────────────── ROBUST AUTO-SAVE SYSTEM ────────────────
    // Tracks dirty state and ensures no data loss on refresh/close
    const _AUTO_SAVE_INTERVAL = 3000; // auto-save every 3s if dirty


    // Mark project dirty whenever saveCurrentProjectLayers is called
    const _origSave = saveCurrentProjectLayers;
    saveCurrentProjectLayers = function(immediate) {
      _projectDirty = true;
      return _origSave(immediate);
    };
    window.saveCurrentProjectLayers = saveCurrentProjectLayers;
    window.saveCurrentLayersToDb = saveCurrentProjectLayers;

    // After doSave completes successfully, mark clean
    const _origDoSaveRef = saveCurrentProjectLayers;

    // Emergency localStorage snapshot key
    const _EMERGENCY_KEY = 'fishtool_emergency_layers';

    function writeEmergencySnapshot() {
      if (!currentProjectState.id) return;
      try {
        const layers = currentProjectState.layers || [];
        const snapshot = {
          projectId: currentProjectState.id,
          timestamp: Date.now(),
          layers: (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layers) : (Array.isArray(layers) ? [] : {}))
        };
        localStorage.setItem(_EMERGENCY_KEY, JSON.stringify(snapshot));
        const activeProj = {
          id: currentProjectState.id,
          name: currentProjectState.name || 'New_Project',
          aspectRatio: currentProjectState.aspectRatio || '16:9',
          resolution: currentProjectState.resolution || '1080p',
          fps: String(currentProjectState.fps || 60),
          defaultDuration: currentProjectState.defaultDuration || 5,
          bgColor: currentProjectState.bgColor || 'transparent',
          layers: layers,
          beatmarks: currentProjectState.beatmarks || [],
          pixelsPerSecond: window.currentPixelsPerSecond || 80,
          updatedAt: new Date().toISOString()
        };
        localStorage.setItem('oft_active_project_backup_' + currentProjectState.id, JSON.stringify(activeProj));
      } catch (e) {
        // localStorage full or quota exceeded — silent fail
      }
    }
    window.writeEmergencySnapshot = writeEmergencySnapshot;

    function clearEmergencySnapshot() {
      try { localStorage.removeItem(_EMERGENCY_KEY); } catch (_) {}
    }
    window.clearEmergencySnapshot = clearEmergencySnapshot;

    // Patch doSave to clear dirty flag and emergency snapshot on successful DB write
    const _patchedDoSaveOrig = saveCurrentProjectLayers;

    // 1) VISIBILITY CHANGE: save when user switches tabs or minimizes
    // This is MORE reliable than beforeunload for async saves
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (saveLayersDebounceTimer) {
          clearTimeout(saveLayersDebounceTimer);
          saveLayersDebounceTimer = null;
        }
        // Fire immediate save + emergency snapshot
        writeEmergencySnapshot();
        _origSave(true).then(() => {
          _projectDirty = false;
          _lastSaveTime = Date.now();
          clearEmergencySnapshot();
        }).catch(() => {});
      }
    });

    // 2) BEFOREUNLOAD & PAGEHIDE: write synchronous localStorage snapshot as last resort
    // IndexedDB async can NOT complete during unload — localStorage CAN
    window.addEventListener('beforeunload', () => {
      if (saveLayersDebounceTimer) {
        clearTimeout(saveLayersDebounceTimer);
        saveLayersDebounceTimer = null;
      }
      writeEmergencySnapshot();
      _origSave(true);
    });

    window.addEventListener('pagehide', () => {
      if (saveLayersDebounceTimer) {
        clearTimeout(saveLayersDebounceTimer);
        saveLayersDebounceTimer = null;
      }
      writeEmergencySnapshot();
    });

    // 3) PERIODIC AUTO-SAVE: catch any missed saves every 3s
    if (window._editorAutoSaveIntervalId) {
      clearInterval(window._editorAutoSaveIntervalId);
    }
    window._editorAutoSaveIntervalId = setInterval(() => {
      if (_projectDirty && !saveLayersDebounceTimer) {
        const now = Date.now();
        if (now - _lastSaveTime > _AUTO_SAVE_INTERVAL) {
          _origSave(true).then(() => {
            _projectDirty = false;
            _lastSaveTime = now;
            clearEmergencySnapshot();
          }).catch(() => {});
        }
      }
    }, _AUTO_SAVE_INTERVAL);

    // 4) ON LOAD: Restore emergency snapshot if DB save was lost
    (async function restoreEmergencySnapshot() {
      try {
        const raw = localStorage.getItem(_EMERGENCY_KEY);
        if (!raw) return;
        const snapshot = JSON.parse(raw);
        if (!snapshot || !snapshot.projectId || !snapshot.timestamp) {
          clearEmergencySnapshot();
          return;
        }
        // Only restore if snapshot matches current project
        const age = Date.now() - snapshot.timestamp;
        if (age > 86400000) {
          clearEmergencySnapshot();
          return;
        }
        // Wait for project to initialize
        await new Promise(r => setTimeout(r, 400));

        if (currentProjectState.id && currentProjectState.id === snapshot.projectId) {
          const dbLayers = currentProjectState.layers || [];
          const snapLayers = snapshot.layers || [];
          let shouldRestore = false;

          if (snapLayers.length > dbLayers.length) {
            shouldRestore = true;
          } else if (snapLayers.length > 0 && dbLayers.length === 0) {
            shouldRestore = true;
          } else {
            for (let i = 0; i < Math.min(dbLayers.length, snapLayers.length); i++) {
              const dbL = dbLayers[i] || {};
              const snapL = snapLayers[i] || {};
              if (snapL.type === 'shape' && (!dbL.shapeProps || !dbL.shapeType)) {
                shouldRestore = true;
                break;
              }
              const dbFx = Array.isArray(dbL.effects) ? dbL.effects : [];
              const snapFx = Array.isArray(snapL.effects) ? snapL.effects : [];
              for (let j = 0; j < Math.min(dbFx.length, snapFx.length); j++) {
                const dbKeys = Object.keys(dbFx[j]).length;
                const snapKeys = Object.keys(snapFx[j]).length;
                if (snapKeys > dbKeys) {
                  shouldRestore = true;
                  break;
                }
              }
              if (shouldRestore) break;
            }
          }

          if (shouldRestore) {
            currentProjectState.layers = snapLayers;
            console.info('[AutoSave] Restored emergency snapshot — unsaved changes recovered');
            if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
            if (typeof syncEffectsRackUI === 'function') syncEffectsRackUI();
            if (typeof redrawComposition === 'function') redrawComposition('emergency-restore');
            // Immediately persist the recovered state to DB
            _origSave(true).then(() => {
              clearEmergencySnapshot();
            });
          } else {
            clearEmergencySnapshot();
          }
        } else {
          clearEmergencySnapshot();
        }
      } catch (_) {
        clearEmergencySnapshot();
      }
    })();

    // Save project as .ofts zip file
    async function exportCurrentProjectOFTSAction() {
      if (currentProjectState.id && window.FishDatabase) {
        await saveCurrentProjectLayers(true);
        if (window.Modal) {
          window.Modal.close();
        }
        await window.FishDatabase.exportProjectToOFTS(currentProjectState.id);
      }
    }
    window.exportCurrentProjectOFTSAction = exportCurrentProjectOFTSAction;

    // Proportional Media Fit: Adjusts layer scale and bounds to match natural media aspect ratio without stretching
    function fitLayerToComposition(layer, naturalW, naturalH) {
      if (!layer || !naturalW || !naturalH || layer.type === 'shape' || layer.type === 'text') return;

      let baseW = (window.currentProjectState && (window.currentProjectState._baseW || window.currentProjectState.baseW || window.currentProjectState.width)) || 0;
      let baseH = (window.currentProjectState && (window.currentProjectState._baseH || window.currentProjectState.baseH || window.currentProjectState.height)) || 0;

      if (window.currentActivePrecomp) {
        baseW = Math.round(Math.abs(window.currentActivePrecomp.mediaWidth || window.currentActivePrecomp.scaleW || baseW || 0));
        baseH = Math.round(Math.abs(window.currentActivePrecomp.mediaHeight || window.currentActivePrecomp.scaleH || baseH || 0));
      }

      if (!baseW || !baseH) {
        const aspect = (window.currentProjectState && window.currentProjectState.aspectRatio) || '16:9';
        const res = (window.currentProjectState && window.currentProjectState.resolution) || '1080p';
        const baseDims = window.getProjectDimensions ? window.getProjectDimensions(res, aspect) : [1920, 1080];
        baseW = baseDims[0];
        baseH = baseDims[1];
      }

      const canvasAspect = baseW / baseH;
      const mediaAspect = naturalW / naturalH;

      let dw, dh, dx, dy;
      if (canvasAspect > mediaAspect) {
        // Canvas is wider than media -> fit height, pillarbox horizontally
        dh = baseH;
        dw = baseH * mediaAspect;
        dx = (baseW - dw) / 2;
        dy = 0;
      } else {
        // Canvas is taller than media -> fit width, letterbox vertically
        dw = baseW;
        dh = baseW / mediaAspect;
        dx = 0;
        dy = (baseH - dh) / 2;
      }

      layer.normX = Number((dx / baseW).toFixed(4));
      layer.normY = Number((dy / baseH).toFixed(4));
      layer.normW = Number((dw / baseW).toFixed(4));
      layer.normH = Number((dh / baseH).toFixed(4));
      layer.posX = Number((baseW / 2).toFixed(2));
      layer.posY = Number((baseH / 2).toFixed(2));
      layer.scaleW = Number(dw.toFixed(1));
      layer.scaleH = Number(dh.toFixed(1));
    }
    window.fitLayerToComposition = fitLayerToComposition;

    // Layer Media Element Cache (mediaId/layerId -> { type, el, poster, isReady })

    function openProjectSettingsModal() {
      const modal = document.getElementById('modal-project-settings');
      if (!modal) return;

      const titleEl = document.getElementById('modal-project-settings-title');
      const rowUndo = document.getElementById('row-settings-max-undo');
      const rowIdle = document.getElementById('row-settings-idle-caching');
      const btnSaveOfts = document.getElementById('btn-settings-save-ofts');

      const isPrecomp = !!currentActivePrecomp;
      if (titleEl) {
        titleEl.textContent = isPrecomp ? `Composition Settings (${currentActivePrecomp.name || 'Pre-comp'})` : 'Composition Settings';
      }
      if (rowUndo) rowUndo.style.display = isPrecomp ? 'none' : '';
      if (rowIdle) rowIdle.style.display = isPrecomp ? 'none' : '';
      if (btnSaveOfts) btnSaveOfts.style.display = isPrecomp ? 'none' : '';

      const targetState = isPrecomp ? {
        aspectRatio: currentActivePrecomp.aspectRatio || currentProjectState.aspectRatio || '16:9',
        resolution: currentActivePrecomp.resolution || currentProjectState.resolution || '1080p',
        fps: currentActivePrecomp.fps || currentProjectState.fps || 60,
        defaultDuration: currentActivePrecomp.durationSec || currentProjectState.defaultDuration || 5,
        bgColor: currentActivePrecomp.bgColor || 'transparent',
        motionBlur: (currentActivePrecomp.motionBlur && typeof currentActivePrecomp.motionBlur === 'object') ? currentActivePrecomp.motionBlur : (currentProjectState.motionBlur || { enabled: false, shutterAngle: 180, shutterPhase: 0, samples: 16 })
      } : currentProjectState;

      // 1. Sync Aspect Ratio Frame selection
      modal.querySelectorAll('.aspect-ratio-frame').forEach(f => {
        f.classList.toggle('is-selected', f.dataset.val === targetState.aspectRatio);
      });

      // 2. Sync Resolution Dropdown / Custom Inputs
      const resVal = String(targetState.resolution || '1080p');
      const resDropdown = document.getElementById('dropdown-resolution');
      if (targetState.aspectRatio === 'Custom' || resVal.includes('x')) {
        const parts = resVal.split('x');
        const w = document.getElementById('custom-res-w') || document.getElementById('settings-custom-res-w');
        const h = document.getElementById('custom-res-h') || document.getElementById('settings-custom-res-h');
        if (w && parts[0]) w.value = parts[0];
        if (h && parts[1]) h.value = parts[1];
        if (typeof window.toggleResolutionUI === 'function') {
          window.toggleResolutionUI('container-resolution', 'Custom');
          window.toggleResolutionUI('settings-container-resolution', 'Custom');
        }
      } else {
        if (typeof window.toggleResolutionUI === 'function') {
          window.toggleResolutionUI('container-resolution', targetState.aspectRatio);
          window.toggleResolutionUI('settings-container-resolution', targetState.aspectRatio);
        }
        if (resDropdown) {
          resDropdown.dataset.value = resVal;
          const label = resDropdown.querySelector('.custom-dropdown-label');
          if (label) label.textContent = resVal;
          resDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.classList.toggle('is-selected', item.dataset.val === resVal);
          });
        }
      }

      // 3. Sync FPS Input
      const fpsInput = document.getElementById('input-fps') || document.getElementById('settings-input-fps');
      if (fpsInput) {
        fpsInput.value = String(targetState.fps || 60);
      }

      // 4. Sync Default Duration Dropdown
      const durDropdown = document.getElementById('dropdown-duration');
      if (durDropdown) {
        const durVal = targetState.defaultDuration || 5;
        durDropdown.dataset.value = String(durVal);
        const label = durDropdown.querySelector('.custom-dropdown-label');
        if (label) label.textContent = `${durVal}s`;
        durDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.classList.toggle('is-selected', parseFloat(item.dataset.val) === parseFloat(durVal));
        });
      }

      // 5. Sync Max Undo Steps Dropdown
      const maxUndoDropdown = document.getElementById('dropdown-max-undo');
      if (maxUndoDropdown && !isPrecomp) {
        const undoVal = currentProjectState.maxUndo || parseInt(localStorage.getItem('oft_max_undo') || '30', 10) || 30;
        maxUndoDropdown.dataset.value = String(undoVal);
        const label = maxUndoDropdown.querySelector('.custom-dropdown-label');
        if (label) label.textContent = `${undoVal} Steps`;
        maxUndoDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.classList.toggle('is-selected', parseInt(item.dataset.val, 10) === undoVal);
        });
      }

      // 6. Sync Background Idle Caching Dropdown
      const idleDropdown = document.getElementById('dropdown-idle-caching');
      if (idleDropdown && !isPrecomp) {
        const idleVal = currentProjectState.idleCache !== undefined ? currentProjectState.idleCache : (localStorage.getItem('oft_idle_cache') === 'true');
        idleDropdown.dataset.value = idleVal ? 'true' : 'false';
        const label = idleDropdown.querySelector('.custom-dropdown-label');
        if (label) label.textContent = idleVal ? 'Enabled' : 'Disabled';
        idleDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.classList.toggle('is-selected', (item.dataset.val === 'true') === idleVal);
        });
      }

      // 7. Sync Motion Blur Settings Dropdowns
      const mb = targetState.motionBlur || {};
      const mbAngle = (typeof mb.shutterAngle === 'number') ? mb.shutterAngle : 180;
      const mbPhase = (typeof mb.shutterPhase === 'number') ? mb.shutterPhase : 0;
      const mbSamples = (typeof mb.samples === 'number') ? mb.samples : 16;

      const angleDropdown = document.getElementById('dropdown-mb-shutter-angle');
      if (angleDropdown) {
        angleDropdown.dataset.value = String(mbAngle);
        const label = angleDropdown.querySelector('.custom-dropdown-label');
        const activeItem = angleDropdown.querySelector(`.custom-dropdown-item[data-val="${mbAngle}"]`);
        if (label) label.textContent = activeItem ? activeItem.textContent : `${mbAngle}°`;
        angleDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.classList.toggle('is-selected', parseFloat(item.dataset.val) === mbAngle);
        });
      }

      const phaseDropdown = document.getElementById('dropdown-mb-shutter-phase');
      if (phaseDropdown) {
        phaseDropdown.dataset.value = String(mbPhase);
        const label = phaseDropdown.querySelector('.custom-dropdown-label');
        const activeItem = phaseDropdown.querySelector(`.custom-dropdown-item[data-val="${mbPhase}"]`);
        if (label) label.textContent = activeItem ? activeItem.textContent : `${mbPhase}°`;
        phaseDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.classList.toggle('is-selected', parseFloat(item.dataset.val) === mbPhase);
        });
      }

      const samplesDropdown = document.getElementById('dropdown-mb-samples');
      if (samplesDropdown) {
        samplesDropdown.dataset.value = String(mbSamples);
        const label = samplesDropdown.querySelector('.custom-dropdown-label');
        const activeItem = samplesDropdown.querySelector(`.custom-dropdown-item[data-val="${mbSamples}"]`);
        if (label) label.textContent = activeItem ? activeItem.textContent : `${mbSamples}`;
        samplesDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.classList.toggle('is-selected', parseInt(item.dataset.val, 10) === mbSamples);
        });
      }

      // 8. Sync Background Color Swatches
      modal.querySelectorAll('.modal-color-swatch').forEach(s => {
        s.classList.toggle('is-selected', s.dataset.val === targetState.bgColor);
      });
      // Stored custom color: reflect it on the custom swatch when no preset matches
      if (!modal.querySelector('.modal-color-swatches .modal-color-swatch.is-selected') &&
          /^#[0-9a-f]{6}$/i.test(targetState.bgColor || '')) {
        const custom = modal.querySelector('.modal-color-swatches .swatch-custom');
        if (custom) {
          custom.dataset.val = targetState.bgColor;
          custom.style.backgroundColor = targetState.bgColor;
          custom.classList.add('is-selected', 'is-picked');
        }
      }

      // 9. Reset category accordion default collapsed states (Motion Blur unexpanded by default)
      const catCanvas = document.getElementById('cat-settings-canvas');
      const catMb = document.getElementById('cat-settings-motion-blur');
      const catAdvanced = document.getElementById('cat-settings-advanced');

      if (catCanvas) {
        catCanvas.classList.remove('is-collapsed');
        catCanvas.querySelector('.settings-category-header')?.setAttribute('aria-expanded', 'true');
      }
      if (catMb) {
        catMb.classList.add('is-collapsed');
        catMb.querySelector('.settings-category-header')?.setAttribute('aria-expanded', 'false');
      }
      if (catAdvanced) {
        catAdvanced.style.display = isPrecomp ? 'none' : '';
        catAdvanced.classList.add('is-collapsed');
        catAdvanced.querySelector('.settings-category-header')?.setAttribute('aria-expanded', 'false');
      }
      const catTheme = document.getElementById('cat-settings-theme');
      if (catTheme) {
        catTheme.classList.add('is-collapsed');
        catTheme.querySelector('.settings-category-header')?.setAttribute('aria-expanded', 'false');
      }
      renderEditorThemePicker();
      try { initEditorUiScaleSlider(); } catch (_) {}
      try { updateEditorStorageUI(); } catch (_) {}

      // Sync Tablet Split View state
      try {
        const isTabletSplitActive = !document.documentElement.classList.contains('force-mobile-view');
        const tabletViewDd = document.getElementById('dropdown-tablet-view');
        const tabletViewVal = document.getElementById('tablet-view-val');
        if (tabletViewDd) {
          tabletViewDd.dataset.value = isTabletSplitActive ? 'true' : 'false';
          const lbl = tabletViewDd.querySelector('.custom-dropdown-label');
          if (lbl) lbl.textContent = isTabletSplitActive ? 'Enabled' : 'Disabled';
          tabletViewDd.querySelectorAll('.custom-dropdown-item').forEach(it => {
            it.classList.toggle('is-selected', it.dataset.val === (isTabletSplitActive ? 'true' : 'false'));
          });
        }
        if (tabletViewVal) tabletViewVal.textContent = isTabletSplitActive ? 'Enabled' : 'Disabled';
        if (tabletViewDd && !tabletViewDd._tabletChangeBound) {
          tabletViewDd._tabletChangeBound = true;
          tabletViewDd.addEventListener('click', (e) => {
            const item = e.target.closest('.custom-dropdown-item');
            if (item) {
              const val = item.dataset.val !== 'false';
              if (tabletViewVal) tabletViewVal.textContent = val ? 'Enabled' : 'Disabled';
              applyTabletSplitViewSetting(val);
            }
          });
        }
      } catch (_) {}

      // 10. Update dynamic summaries on category headers
      updateProjectSettingsSummaries();

      if (window.Modal) {
        window.Modal.open('modal-project-settings');
      }
    }
    window.openProjectSettingsModal = openProjectSettingsModal;

    // Helper: Update dynamic summary indicators on composition settings categories
    function updateProjectSettingsSummaries() {
      const modal = document.getElementById('modal-project-settings');
      if (!modal) return;
      const ratio = modal.querySelector('.aspect-ratio-frame.is-selected')?.dataset.val || '16:9';
      const res = document.getElementById('dropdown-resolution')?.dataset.value || '1080p';
      const fps = document.getElementById('dropdown-fps')?.dataset.value || '60';
      const summaryCanvas = document.getElementById('summary-settings-canvas');
      if (summaryCanvas) {
        summaryCanvas.textContent = `${ratio} • ${res} • ${fps} FPS`;
      }

      const angle = document.getElementById('dropdown-mb-shutter-angle')?.dataset.value || '180';
      const samples = document.getElementById('dropdown-mb-samples')?.dataset.value || '16';
      const summaryMb = document.getElementById('summary-settings-mb');
      if (summaryMb) {
        summaryMb.textContent = `${angle}° • ${samples} Samples`;
      }

      const undo = document.getElementById('dropdown-max-undo')?.dataset.value || '30';
      const idle = document.getElementById('dropdown-idle-caching')?.dataset.value === 'true';
      const summaryAdv = document.getElementById('summary-settings-advanced');
      if (summaryAdv) {
        summaryAdv.textContent = `${undo} Steps • ${idle ? 'Cache On' : 'Cache Off'}`;
      }

      const curTheme = localStorage.getItem('oft_theme') || 'default';
      const summaryTheme = document.getElementById('summary-settings-theme');
      if (summaryTheme) {
        const themeNames = {
          'default': 'Matcha Tea',
          'sakura-milk': 'Sakura Milk',
          'lemon-soda': 'Lemon Soda',
          'sky-candy': 'Sky Candy',
          'mint-pop': 'Mint Pop',
          'peach-glow': 'Peach Glow'
        };
        summaryTheme.textContent = themeNames[curTheme] || 'Matcha Tea';
      }
    }
    window.updateProjectSettingsSummaries = updateProjectSettingsSummaries;

    function renderEditorThemePicker() {
      const grid = document.getElementById('editor-settings-theme-grid');
      if (!grid) return;
      const themes = [
        { id: 'default', name: 'Matcha Tea', desc: 'Default Brand', color: '#aef380', checkFill: '#12170e' },
        { id: 'sakura-milk', name: 'Sakura Milk', desc: 'Pastel Pink', color: '#ffb3d1', checkFill: '#2a121a' },
        { id: 'lemon-soda', name: 'Lemon Soda', desc: 'Bright Citrus', color: '#ffe45e', checkFill: '#241d05' },
        { id: 'sky-candy', name: 'Sky Candy', desc: 'Soft Cyan', color: '#8ee6ff', checkFill: '#0a1a22' },
        { id: 'mint-pop', name: 'Mint Pop', desc: 'Fresh Mint', color: '#7dfcc8', checkFill: '#0a2018' },
        { id: 'peach-glow', name: 'Peach Glow', desc: 'Warm Peach', color: '#ffc49b', checkFill: '#2a1a0e' }
      ];
      const cur = localStorage.getItem('oft_theme') || 'default';
      grid.innerHTML = themes.map(t => {
        const isSel = t.id === cur;
        return `
          <button type="button" class="theme-card-item ${isSel ? 'is-selected' : ''}" data-theme-val="${t.id}" title="${t.name}">
            <div class="theme-card-color-dot" style="background-color: ${t.color};">
              <svg class="theme-card-check" viewBox="0 0 24 24" width="14" height="14" fill="${t.checkFill}">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
            </div>
            <div class="theme-card-meta">
              <span class="theme-card-name">${t.name}</span>
              <span class="theme-card-desc">${t.desc}</span>
            </div>
          </button>
        `;
      }).join('');

      grid.querySelectorAll('.theme-card-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const val = btn.getAttribute('data-theme-val');
          if (!val) return;
          try {
            localStorage.setItem('oft_theme', val);
          } catch (_) {}
          try {
            if (window.FishDatabase && typeof window.FishDatabase.getSettings === 'function') {
              window.FishDatabase.getSettings().then(s => {
                s = s || {};
                s.config = s.config || {};
                s.config.accent = val;
                return window.FishDatabase.saveSettings(s);
              }).catch(() => {});
            }
          } catch (_) {}
          if (val && val !== 'default') {
            document.documentElement.setAttribute('data-theme', val);
          } else {
            document.documentElement.removeAttribute('data-theme');
          }
          grid.querySelectorAll('.theme-card-item').forEach(c => {
            c.classList.toggle('is-selected', c.getAttribute('data-theme-val') === val);
          });
          const summaryTheme = document.getElementById('summary-settings-theme');
          if (summaryTheme) {
            const found = themes.find(x => x.id === val);
            summaryTheme.textContent = found ? found.name : 'Matcha Tea';
          }
          window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: val } }));
        });
      });
    }

    // — UI Scale for Editor/Desktop (default 100%) + simple Storage bar —
    function detectEditorUiScalePage() {
      try {
        const p = (window.location && window.location.pathname) || '';
        if (p.indexOf('desktop') !== -1) return 'desktop';
        if (p.indexOf('editor') !== -1) return 'editor';
      } catch (_) {}
      return 'editor';
    }

    function clampEditorUiScale(v) {
      const n = parseInt(v, 10);
      if (isNaN(n)) return 100;
      return Math.max(80, Math.min(130, n));
    }

    function getEditorUiScale(page) {
      try {
        const raw = localStorage.getItem('oft_ui_scale_' + page);
        if (raw !== null && raw !== '') return clampEditorUiScale(raw);
      } catch (_) {}
      return 100;
    }

    function applyEditorUiScale(page, val) {
      const scale = clampEditorUiScale(val);
      try {
        document.documentElement.style.setProperty('--oft-ui-scale', String(scale / 100));
        if (scale === 100) {
          document.documentElement.style.zoom = '';
          document.documentElement.style.removeProperty('zoom');
        } else {
          document.documentElement.style.zoom = String(scale / 100);
          document.documentElement.style.setProperty('zoom', String(scale / 100));
        }
        window.__OFT_ZOOM = scale / 100;
        document.documentElement.classList.toggle('is-scaled', scale !== 100);

        const settingsCard = document.querySelector('#modal-project-settings .modal-card');
        if (settingsCard) {
          settingsCard.style.zoom = '';
          settingsCard.style.removeProperty('zoom');
        }

        window.dispatchEvent(new Event('oft-ui-scale-changed'));
        // Refit preview canvas to the rescaled layout viewport (ratios stay
        // valid, but available layout px changed).
        try {
          if (typeof fitPreviewCanvasBox === 'function') fitPreviewCanvasBox();
          else if (typeof window.fitPreviewCanvasBox === 'function') window.fitPreviewCanvasBox();
        } catch (_) {}
        try {
          if (typeof window.syncDesktopLayout === 'function') window.syncDesktopLayout();
        } catch (_) {}
      } catch (_) {}
      return scale;
    }

    function initEditorUiScaleSlider() {
      const page = detectEditorUiScalePage();
      const sliderId = page === 'desktop' ? 'ui-scale-desktop' : 'ui-scale-editor';
      const labelId = sliderId + '-val';
      const slider = document.getElementById(sliderId);
      const label = document.getElementById(labelId);
      const v = getEditorUiScale(page);

      function updateEditorTrackFill(sl) {
        if (!sl) return;
        const min = parseFloat(sl.min) || 80;
        const max = parseFloat(sl.max) || 130;
        const val = parseFloat(sl.value) || 100;
        const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
        sl.style.setProperty('--slider-fill', pct.toFixed(1) + '%');
      }

      if (slider) {
        updateEditorTrackFill(slider);
        if (!slider._oftWired) {
          slider._oftWired = true;
          try { slider.value = String(v); } catch (_) {}
          updateEditorTrackFill(slider);

          slider.addEventListener('input', () => {
            const nv = clampEditorUiScale(slider.value);
            if (label) label.textContent = nv + '%';
            updateEditorTrackFill(slider);
          });
          slider.addEventListener('change', () => {
            const nv = clampEditorUiScale(slider.value);
            try { localStorage.setItem('oft_ui_scale_' + page, String(nv)); } catch (_) {}
            try {
              if (window.FishDatabase && typeof window.FishDatabase.getSettings === 'function') {
                window.FishDatabase.getSettings().then(s => {
                  s = s || {};
                  s.config = s.config || {};
                  s.config['uiScale_' + page] = nv;
                  return window.FishDatabase.saveSettings(s);
                }).catch(() => {});
              }
            } catch (_) {}
            applyEditorUiScale(page, nv);
            updateEditorTrackFill(slider);
          });
        } else {
          try { slider.value = String(v); } catch (_) {}
          updateEditorTrackFill(slider);
        }
      }
      if (label) label.textContent = v + '%';
      // Migrate legacy accent ids to Matcha Tea once.
      try {
        const cur = localStorage.getItem('oft_theme') || 'default';
        const ok = ['default', 'sakura-milk', 'lemon-soda', 'sky-candy', 'mint-pop', 'peach-glow'];
        if (ok.indexOf(cur) === -1) {
          localStorage.setItem('oft_theme', 'default');
          document.documentElement.removeAttribute('data-theme');
        }
      } catch (_) {}
    }

    async function updateEditorStorageUI() {
      const statusEl = document.getElementById('editor-settings-storage-status');
      const fillEl = document.getElementById('editor-settings-storage-fill');
      if (!statusEl && !fillEl) return;
      function fmt(b) {
        if (typeof b !== 'number' || isNaN(b) || b <= 0) return '0 MB';
        const mb = b / (1024 * 1024);
        if (mb < 1024) return mb.toFixed(1) + ' MB';
        return (mb / 1024).toFixed(2) + ' GB';
      }
      try {
        if (!window.FishDatabase || typeof window.FishDatabase.checkStoragePersistence !== 'function') {
          if (statusEl) statusEl.textContent = 'Storage ready';
          if (fillEl) fillEl.style.width = '0%';
          return;
        }
        const info = await window.FishDatabase.checkStoragePersistence();
        if (info && info.usage && info.quota) {
          const pct = (info.usage / info.quota) * 100;
          if (statusEl) statusEl.textContent = fmt(info.usage) + ' of ' + fmt(info.quota) + ' • ' + pct.toFixed(1) + '%';
          if (fillEl) fillEl.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
        } else if (info && info.usage) {
          if (statusEl) statusEl.textContent = fmt(info.usage) + ' used';
          if (fillEl) fillEl.style.width = '0%';
        } else {
          if (statusEl) statusEl.textContent = 'Storage ready';
          if (fillEl) fillEl.style.width = '0%';
        }
      } catch (_) {
        if (statusEl) statusEl.textContent = 'Storage ready';
      }
    }
    function applyTabletSplitViewSetting(enabled) {
      const isEnabled = enabled !== false;
      const forceMobile = !isEnabled;
      document.documentElement.classList.toggle('force-mobile-view', forceMobile);
      if (document.body) document.body.classList.toggle('force-mobile-view', forceMobile);
      try {
        localStorage.setItem('oft_tablet_split_view', isEnabled ? 'true' : 'false');
        localStorage.setItem('oft_always_mobile', forceMobile ? 'true' : 'false');
      } catch (_) {}
      try {
        if (window.FishDatabase && typeof window.FishDatabase.getSettings === 'function') {
          window.FishDatabase.getSettings().then(s => {
            s = s || {};
            s.config = s.config || {};
            s.config.alwaysMobile = forceMobile;
            s.config.tabletSplitView = isEnabled;
            return window.FishDatabase.saveSettings(s);
          }).catch(() => {});
        }
      } catch (_) {}
      const valLabel = document.getElementById('tablet-view-val');
      if (valLabel) valLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
      const dd = document.getElementById('dropdown-tablet-view');
      if (dd) {
        dd.dataset.value = isEnabled ? 'true' : 'false';
        const labelSpan = dd.querySelector('.custom-dropdown-label');
        if (labelSpan) labelSpan.textContent = isEnabled ? 'Enabled' : 'Disabled';
        dd.querySelectorAll('.custom-dropdown-item').forEach(it => {
          it.classList.toggle('is-selected', it.dataset.val === (isEnabled ? 'true' : 'false'));
        });
      }
      window.dispatchEvent(new Event('resize'));
      if (typeof fitPreviewCanvasBox === 'function') {
        fitPreviewCanvasBox();
      }
    }
    window.applyTabletSplitViewSetting = applyTabletSplitViewSetting;

    // Initialize Always Mobile / Tablet Split View preference early
    try {
      const savedAlwaysMobile = localStorage.getItem('oft_always_mobile');
      const savedTabletPref = localStorage.getItem('oft_tablet_split_view');
      const shouldForceMobile = savedAlwaysMobile === 'true' || (savedAlwaysMobile === null && savedTabletPref === 'false');
      if (shouldForceMobile) {
        document.documentElement.classList.add('force-mobile-view');
        if (document.body) document.body.classList.add('force-mobile-view');
      } else if (savedAlwaysMobile === null && savedTabletPref === null && window.FishDatabase && typeof window.FishDatabase.getSettings === 'function') {
        window.FishDatabase.getSettings().then(s => {
          if (s && s.config) {
            const fm = s.config.alwaysMobile === true || s.config.tabletSplitView === false;
            if (fm) {
              applyTabletSplitViewSetting(false);
            }
          }
        }).catch(() => {});
      }
    } catch (_) {}

    window.renderEditorThemePicker = renderEditorThemePicker;
    window.detectEditorUiScalePage = detectEditorUiScalePage;
    window.clampEditorUiScale = clampEditorUiScale;
    window.getEditorUiScale = getEditorUiScale;
    window.applyEditorUiScale = applyEditorUiScale;
    window.initEditorUiScaleSlider = initEditorUiScaleSlider;
    window.updateEditorStorageUI = updateEditorStorageUI;

    // Save project settings action (persisting to FishDatabase & live updating Canvas and Timeline)
    async function saveProjectSettingsAction() {
      const modal = document.getElementById('modal-project-settings');
      if (!modal) return;

      const selectedRatio = modal.querySelector('.modal-aspect-grid .aspect-ratio-frame.is-selected')?.dataset.val || '16:9';
      let selectedRes = '1080p';
      if (selectedRatio === 'Custom') {
        const w = (document.getElementById('custom-res-w') || document.getElementById('settings-custom-res-w'))?.value || '1920';
        const h = (document.getElementById('custom-res-h') || document.getElementById('settings-custom-res-h'))?.value || '1080';
        selectedRes = `${w}x${h}`;
      } else {
        selectedRes = document.getElementById('dropdown-resolution')?.dataset.value || '1080p';
      }
      const selectedFps = parseInt(document.getElementById('input-fps')?.value || document.getElementById('settings-input-fps')?.value || document.getElementById('dropdown-fps')?.dataset.value || '60', 10);
      const selectedDur = parseFloat(document.getElementById('dropdown-duration')?.dataset.value || '5');
      const selectedBg = modal.querySelector('.modal-color-swatches .modal-color-swatch.is-selected')?.dataset.val || 'transparent';
      const selectedMbAngle = parseFloat(document.getElementById('dropdown-mb-shutter-angle')?.dataset.value || '180');
      const selectedMbPhase = parseFloat(document.getElementById('dropdown-mb-shutter-phase')?.dataset.value || '-90');
      const selectedMbSamples = parseInt(document.getElementById('dropdown-mb-samples')?.dataset.value || '16', 10);

      if (currentActivePrecomp) {
        currentActivePrecomp.aspectRatio = selectedRatio;
        currentActivePrecomp.resolution = selectedRes;
        currentActivePrecomp.fps = selectedFps;
        currentActivePrecomp.durationSec = selectedDur;
        currentActivePrecomp.bgColor = selectedBg;
        currentActivePrecomp.motionBlur = currentActivePrecomp.motionBlur || {};
        currentActivePrecomp.motionBlur.shutterAngle = selectedMbAngle;
        currentActivePrecomp.motionBlur.shutterPhase = selectedMbPhase;
        currentActivePrecomp.motionBlur.samples = selectedMbSamples;

        const baseDims = window.getProjectDimensions(selectedRes, selectedRatio);
        currentActivePrecomp.mediaWidth = baseDims[0];
        currentActivePrecomp.mediaHeight = baseDims[1];
        currentActivePrecomp.scaleW = baseDims[0];
        currentActivePrecomp.scaleH = baseDims[1];
        currentActivePrecomp._precompBufferCanvas = null;

        const pps = window.currentPixelsPerSecond || 80;
        currentActivePrecomp.widthPx = Math.round(selectedDur * pps);

        if (window.PreviewCacheManager) {
          window.PreviewCacheManager.clearCompCache(currentActivePrecomp.id);
          window.PreviewCacheManager.setFps(selectedFps);
        }

        window.currentTimelineFps = selectedFps;
        if (typeof window.setTimelineFps === 'function') {
          window.setTimelineFps(selectedFps);
        }
        if (typeof window.updateTimelineDuration === 'function') {
          window.updateTimelineDuration(true);
        }
        if (typeof fitPreviewCanvasBox === 'function') {
          fitPreviewCanvasBox();
        }
        if (typeof redrawComposition === 'function') {
          redrawComposition('savePrecompSettings');
        }
        if (typeof renderTimelineLayers === 'function') {
          renderTimelineLayers();
        }
        if (window.Modal) {
          window.Modal.close();
        }
        saveCurrentProjectLayers();
        return;
      }

      const selectedMaxUndo = parseInt(document.getElementById('dropdown-max-undo')?.dataset.value || '30', 10);
      const selectedIdle = document.getElementById('dropdown-idle-caching')?.dataset.value === 'true';

      currentProjectState.aspectRatio = selectedRatio;
      currentProjectState.resolution = selectedRes;
      currentProjectState.fps = selectedFps;
      currentProjectState.defaultDuration = selectedDur;
      currentProjectState.maxUndo = selectedMaxUndo;
      currentProjectState.idleCache = selectedIdle;
      currentProjectState.bgColor = selectedBg;
      currentProjectState.motionBlur = currentProjectState.motionBlur || {};
      currentProjectState.motionBlur.shutterAngle = selectedMbAngle;
      currentProjectState.motionBlur.shutterPhase = selectedMbPhase;
      currentProjectState.motionBlur.samples = selectedMbSamples;

      if (window.UndoRedoManager) {
        window.UndoRedoManager.setMaxSteps(selectedMaxUndo);
      }
      try {
        localStorage.setItem('oft_max_undo', String(selectedMaxUndo));
        localStorage.setItem('oft_idle_cache', selectedIdle ? 'true' : 'false');
        const tabletSplitDdVal = document.getElementById('dropdown-tablet-view')?.dataset.value;
        if (tabletSplitDdVal !== undefined) {
          applyTabletSplitViewSetting(tabletSplitDdVal !== 'false');
        }
      } catch (_) {}

      window.currentTimelineFps = selectedFps;
      if (window.PreviewCacheManager) {
        window.PreviewCacheManager.setFps(selectedFps);
        window.PreviewCacheManager.setIdleCacheEnabled(selectedIdle);
      }

      // 1. Close Modal immediately for instantaneous UX feedback
      if (window.Modal) {
        window.Modal.close();
      }

      // 2. Synchronize URL query params
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('aspect', selectedRatio);
        url.searchParams.set('resolution', selectedRes);
        url.searchParams.set('fps', String(selectedFps));
        url.searchParams.set('duration', String(selectedDur));
        url.searchParams.set('bg', selectedBg);
        window.history.replaceState({ modalOpen: false }, '', url.toString());
      } catch (_) {}

      setTimeout(() => {
        // 3. Apply to Preview Canvas
        if (typeof updatePreviewCanvas === 'function') {
          updatePreviewCanvas(selectedRatio, selectedRes, selectedFps, selectedBg);
        } else if (typeof window.updatePreviewCanvas === 'function') {
          window.updatePreviewCanvas(selectedRatio, selectedRes, selectedFps, selectedBg);
        }

        // 4. Apply to Timeline
        window.currentTimelineFps = selectedFps;
        if (typeof window.setTimelineFps === 'function') {
          window.setTimelineFps(selectedFps);
        }
        if (typeof window.updateTimelineDuration === 'function') {
          window.updateTimelineDuration(true);
        }
        if (typeof redrawComposition === 'function') {
          redrawComposition('saveProjectSettings');
        }

        // 5. Asynchronously persist to FishDatabase in background without blocking UI
        if (currentProjectState.id && window.FishDatabase) {
          window.FishDatabase.getProject(currentProjectState.id).then(proj => {
            if (proj) {
              proj.aspectRatio = selectedRatio;
              proj.resolution = selectedRes;
              proj.fps = String(selectedFps);
              proj.defaultDuration = selectedDur;
              proj.bgColor = selectedBg;
              if (currentProjectState.motionBlur) {
                proj.motionBlur = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(currentProjectState.motionBlur) : (Array.isArray(currentProjectState.motionBlur) ? [] : {}));
              }
              return window.FishDatabase.saveProject(proj);
            } else {
              return window.FishDatabase.saveProject(currentProjectState);
            }
          }).catch(() => {
            try { window.FishDatabase.saveProject(currentProjectState); } catch (_) {}
          });
        }
      }, 16);
    }
    window.saveProjectSettingsAction = saveProjectSettingsAction;

    // ── Debug State Helper: Multi-Layer Fetch & Duration Analysis ──────────────
    window.getSelectedLayerDebugState = function() {
      const host = window;
      const pState = host.currentProjectState || (window.parent && window.parent.currentProjectState);
      const layers = (pState && pState.layers) || [];

      // Collect all selected layer IDs (supports single & multi-selection)
      const selectedIds = new Set();
      const selIdsSource = host.selectedLayerIds || (window.parent && window.parent.selectedLayerIds);
      if (selIdsSource) {
        if (typeof selIdsSource.forEach === 'function') {
          selIdsSource.forEach(id => { if (id) selectedIds.add(id); });
        } else if (Array.isArray(selIdsSource)) {
          selIdsSource.forEach(id => { if (id) selectedIds.add(id); });
        }
      }
      const selIdSingle = host.selectedLayerId || (window.parent && window.parent.selectedLayerId);
      if (selIdSingle) {
        selectedIds.add(selIdSingle);
      }

      const selectedLayers = layers.filter(l => selectedIds.has(l.id));
      if (selectedLayers.length === 0) return null;

      // Project FPS & Timing
      const fps = (typeof host.getProjectFps === 'function')
        ? host.getProjectFps()
        : (window.parent && typeof window.parent.getProjectFps === 'function')
          ? window.parent.getProjectFps()
          : (parseInt(pState && pState.fps, 10) || 60);

      const pps = host.currentPixelsPerSecond || (window.parent && window.parent.currentPixelsPerSecond) || 80;
      const timelinePanX = (host.timelinePanX !== undefined)
        ? host.timelinePanX
        : (window.parent && window.parent.timelinePanX !== undefined ? window.parent.timelinePanX : 0);
      const currentPanX = Math.min(0, timelinePanX);

      const currentSecRaw = (typeof host.getCurrentPlayheadTime === 'function')
        ? host.getCurrentPlayheadTime()
        : (window.parent && typeof window.parent.getCurrentPlayheadTime === 'function')
          ? window.parent.getCurrentPlayheadTime()
          : (host.currentSec !== undefined)
            ? host.currentSec
            : Math.max(0, -currentPanX) / pps;

      const currentPlayheadSec = Number(currentSecRaw.toFixed(4));
      const currentPlayheadFrame = Math.round(currentPlayheadSec * fps);

      // Sort selected layers by timeline startSec ascending
      const sortedLayers = [...selectedLayers].sort((a, b) => {
        const startA = a.startSec !== undefined ? Number(a.startSec) : ((Number(a.startPx) || 0) / pps);
        const startB = b.startSec !== undefined ? Number(b.startSec) : ((Number(b.startPx) || 0) / pps);
        return startA - startB;
      });

      // Timecode helper
      function formatTimecode(frame, rate) {
        const totalSec = Math.max(0, Math.floor(frame / rate));
        const f = Math.max(0, frame % rate);
        const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
        const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
        const s = String(totalSec % 60).padStart(2, '0');
        return `${h}:${m}:${s}:${String(f).padStart(2, '0')}`;
      }

      // Compute sequential & span timing
      let concatenatedTotalSec = 0;
      let concatenatedTotalFrames = 0;
      let earliestSpanStartSec = Infinity;
      let latestSpanEndSec = -Infinity;

      const layersTimeline = sortedLayers.map((l, index) => {
        const startSec = l.startSec !== undefined ? Number(l.startSec) : ((Number(l.startPx) || 0) / pps);
        const durSec = l.durationSec !== undefined ? Number(l.durationSec) : ((Number(l.widthPx) || 400) / pps);
        const endSec = startSec + durSec;
        const startFrame = Math.round(startSec * fps);
        const durFrames = Math.round(durSec * fps);
        const endFrame = startFrame + durFrames;

        if (startSec < earliestSpanStartSec) earliestSpanStartSec = startSec;
        if (endSec > latestSpanEndSec) latestSpanEndSec = endSec;

        const seqStartSec = concatenatedTotalSec;
        const seqEndSec = seqStartSec + durSec;
        const seqStartFrame = concatenatedTotalFrames;
        const seqEndFrame = seqStartFrame + durFrames;

        concatenatedTotalSec += durSec;
        concatenatedTotalFrames += durFrames;

        const isCurrentInside = (currentPlayheadSec >= startSec && currentPlayheadSec <= endSec);
        const localSec = currentPlayheadSec - startSec;
        const localFrame = Math.round(localSec * fps);
        const localProgress = durSec > 0
          ? Math.max(0, Math.min(100, (localSec / durSec) * 100)).toFixed(2) + '%'
          : '0%';

        const width = Math.round(Math.abs(l.mediaWidth || l.scaleW || l.widthPx || 1920));
        const height = Math.round(Math.abs(l.mediaHeight || l.scaleH || 1080));

        const clampedLocalSec = Math.max(0, Math.min(durSec, localSec));
        const clampedLocalFrame = Math.max(0, Math.min(durFrames, localFrame));
        const posInConcatenatedSec = seqStartSec + clampedLocalSec;
        const posInConcatenatedFrame = seqStartFrame + clampedLocalFrame;
        const posInConcatenatedProgress = (concatenatedTotalSec + durSec) > 0
          ? ((posInConcatenatedSec / (seqEndSec || 1)) * 100).toFixed(2) + '%'
          : '0%';

        return {
          index,
          id: l.id,
          name: l.name || `Layer ${index + 1}`,
          type: l.type || 'unknown',
          dimensions: {
            width,
            height,
            scaleW: l.scaleW !== undefined ? l.scaleW : 1,
            scaleH: l.scaleH !== undefined ? l.scaleH : 1
          },
          timeline: {
            startSec: Number(startSec.toFixed(3)),
            durationSec: Number(durSec.toFixed(3)),
            endSec: Number(endSec.toFixed(3)),
            startFrame,
            durationFrames: durFrames,
            endFrame
          },
          concatenatedSequence: {
            seqStartSec: Number(seqStartSec.toFixed(3)),
            seqDurationSec: Number(durSec.toFixed(3)),
            seqEndSec: Number(seqEndSec.toFixed(3)),
            seqStartFrame,
            seqDurationFrames: durFrames,
            seqEndFrame
          },
          playhead: {
            isCurrentFrameInside: isCurrentInside,
            localSec: Number(localSec.toFixed(3)),
            localFrame,
            localProgressPercent: localProgress,
            positionInConcatenated: isCurrentInside ? {
              sec: Number(posInConcatenatedSec.toFixed(3)),
              frame: posInConcatenatedFrame,
              progressPercent: concatenatedTotalSec > 0
                ? ((posInConcatenatedSec / concatenatedTotalSec) * 100).toFixed(2) + '%'
                : '0%'
            } : null
          }
        };
      });

      if (earliestSpanStartSec === Infinity) earliestSpanStartSec = 0;
      if (latestSpanEndSec === -Infinity) latestSpanEndSec = 0;
      const spanDurationSec = Math.max(0, latestSpanEndSec - earliestSpanStartSec);
      const spanDurationFrames = Math.round(spanDurationSec * fps);
      const spanCurrentSec = currentPlayheadSec - earliestSpanStartSec;
      const spanCurrentFrame = currentPlayheadFrame - Math.round(earliestSpanStartSec * fps);
      const spanProgressPercent = spanDurationSec > 0
        ? Math.max(0, Math.min(100, (spanCurrentSec / spanDurationSec) * 100)).toFixed(2) + '%'
        : '0%';

      // Determine active layers and sequence playhead position
      const activeLayers = layersTimeline.filter(item => item.playhead.isCurrentFrameInside);
      let primaryActiveLayer = activeLayers.length > 0 ? activeLayers[activeLayers.length - 1] : null;
      let seqCurrentSec = 0;
      let seqCurrentFrame = 0;
      let playheadStatus = '';

      if (primaryActiveLayer) {
        const clampedLocalSec = Math.max(0, Math.min(primaryActiveLayer.timeline.durationSec, primaryActiveLayer.playhead.localSec));
        const clampedLocalFrame = Math.max(0, Math.min(primaryActiveLayer.timeline.durationFrames, primaryActiveLayer.playhead.localFrame));
        seqCurrentSec = primaryActiveLayer.concatenatedSequence.seqStartSec + clampedLocalSec;
        seqCurrentFrame = primaryActiveLayer.concatenatedSequence.seqStartFrame + clampedLocalFrame;
        const progressInSeq = concatenatedTotalSec > 0
          ? ((seqCurrentSec / concatenatedTotalSec) * 100).toFixed(1) + '%'
          : '0%';
        playheadStatus = `In "${primaryActiveLayer.name}" (layer ${primaryActiveLayer.index + 1}/${sortedLayers.length}), frame ${clampedLocalFrame}/${primaryActiveLayer.timeline.durationFrames} | Sequence: frame ${seqCurrentFrame}/${concatenatedTotalFrames} (${progressInSeq})`;
      } else if (currentPlayheadSec < earliestSpanStartSec) {
        seqCurrentSec = 0;
        seqCurrentFrame = 0;
        const offsetSec = (earliestSpanStartSec - currentPlayheadSec).toFixed(3);
        const offsetFrames = Math.round((earliestSpanStartSec - currentPlayheadSec) * fps);
        playheadStatus = `Before selected layers span (-${offsetSec}s / -${offsetFrames}f)`;
      } else if (currentPlayheadSec > latestSpanEndSec) {
        seqCurrentSec = concatenatedTotalSec;
        seqCurrentFrame = concatenatedTotalFrames;
        const offsetSec = (currentPlayheadSec - latestSpanEndSec).toFixed(3);
        const offsetFrames = Math.round((currentPlayheadSec - latestSpanEndSec) * fps);
        playheadStatus = `After selected layers span (+${offsetSec}s / +${offsetFrames}f)`;
      } else {
        let prev = null;
        for (const item of layersTimeline) {
          if (item.timeline.endSec <= currentPlayheadSec) prev = item;
        }
        if (prev) {
          seqCurrentSec = prev.concatenatedSequence.seqEndSec;
          seqCurrentFrame = prev.concatenatedSequence.seqEndFrame;
          playheadStatus = `In timeline gap after "${prev.name}"`;
        } else {
          seqCurrentSec = 0;
          seqCurrentFrame = 0;
          playheadStatus = 'In timeline gap before layers';
        }
      }

      const seqProgressPercent = concatenatedTotalSec > 0
        ? Math.max(0, Math.min(100, (seqCurrentSec / concatenatedTotalSec) * 100)).toFixed(2) + '%'
        : '0%';

      // Sanitize layer properties (strip heavy binary fields, keep all keyframes, effects, etc.)
      const SKIP_KEYS = new Set(['dataUrl', 'thumbUrl', 'audioPcmData', '_precompBufferCanvas',
                                  '_cachedImageBitmap', '_bitmapCache']);
      const cleanLayers = sortedLayers.map(layer => {
        const clone = {};
        for (const k of Object.keys(layer)) {
          if (SKIP_KEYS.has(k)) {
            clone[k] = '[omitted]';
          } else if (layer[k] && typeof layer[k] === 'object' && !Array.isArray(layer[k]) &&
                     !(layer[k] instanceof HTMLElement) &&
                     !(layer[k] instanceof HTMLCanvasElement)) {
            try { clone[k] = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer[k]) : (Array.isArray(layer[k]) ? [] : {})); } catch (_) { clone[k] = String(layer[k]); }
          } else if (Array.isArray(layer[k])) {
            try { clone[k] = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer[k]) : (Array.isArray(layer[k]) ? [] : {})); } catch (_) { clone[k] = '[array]'; }
          } else {
            clone[k] = layer[k];
          }
        }
        return clone;
      });

      const analysis = {
        selectedLayersCount: sortedLayers.length,
        projectFps: fps,
        currentPlayhead: {
          sec: currentPlayheadSec,
          frame: currentPlayheadFrame,
          timecode: formatTimecode(currentPlayheadFrame, fps)
        },
        concatenatedDuration: {
          totalDurationSec: Number(concatenatedTotalSec.toFixed(3)),
          totalDurationFrames: concatenatedTotalFrames,
          currentPositionSec: Number(seqCurrentSec.toFixed(3)),
          currentPositionFrame: seqCurrentFrame,
          progressPercent: seqProgressPercent,
          activeLayerIndex: primaryActiveLayer ? primaryActiveLayer.index : null,
          activeLayerName: primaryActiveLayer ? primaryActiveLayer.name : null,
          activeLayers: activeLayers.map(a => ({ index: a.index, name: a.name })),
          status: playheadStatus
        },
        timelineSpan: {
          earliestStartSec: Number(earliestSpanStartSec.toFixed(3)),
          latestEndSec: Number(latestSpanEndSec.toFixed(3)),
          totalDurationSec: Number(spanDurationSec.toFixed(3)),
          totalDurationFrames: spanDurationFrames,
          currentOffsetSec: Number(spanCurrentSec.toFixed(3)),
          currentOffsetFrame: spanCurrentFrame,
          progressPercent: spanProgressPercent
        },
        layersOverview: layersTimeline
      };

      const cleanPayload = {
        analysis,
        layers: cleanLayers
      };

      return {
        layer: sortedLayers[0],
        layers: sortedLayers,
        clean: cleanPayload,
        cleanLayers,
        analysis,
        playheadStatus
      };
    };

    // If debug card DOM elements exist locally in main window, bind them
    (function initDebugCard() {
      const fetchBtn = document.getElementById('btn-debug-fetch-layer');
      const copyBtn  = document.getElementById('btn-debug-copy-layer');
      const output   = document.getElementById('debug-layer-output');
      const status   = document.getElementById('debug-layer-status');
      if (!fetchBtn || !output) return;

      fetchBtn.addEventListener('click', () => {
        const res = window.getSelectedLayerDebugState();
        if (!res || !res.layers || res.layers.length === 0) {
          output.value = '';
          if (status) status.textContent = '⚠ No layer selected — select one or more layers on the timeline first.';
          return;
        }
        try {
          output.value = JSON.stringify(res.clean, null, 2);
          if (status) {
            const an = res.analysis;
            if (an && an.selectedLayersCount > 1) {
              status.textContent = `✓ Fetched ${an.selectedLayersCount} layers | Combined: ${an.concatenatedDuration.totalDurationSec}s (${an.concatenatedDuration.totalDurationFrames}f) | ${an.concatenatedDuration.status}`;
            } else if (an && an.selectedLayersCount === 1) {
              const l0 = an.layersOverview[0];
              status.textContent = `✓ Fetched: ${l0.name} (${l0.type}) | Dur: ${l0.timeline.durationSec}s (${l0.timeline.durationFrames}f) | Frame ${l0.playhead.localFrame}/${l0.timeline.durationFrames}`;
            } else {
              status.textContent = `✓ Fetched: ${res.layer.name || res.layer.id}`;
            }
          }
        } catch (e) {
          output.value = String(e);
          if (status) status.textContent = '✗ Serialization error';
        }
      });

      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          if (!output.value) {
            if (status) status.textContent = '⚠ Nothing to copy — fetch layer(s) first.';
            return;
          }
          try {
            navigator.clipboard.writeText(output.value).then(() => {
              if (status) status.textContent = '✓ Copied to clipboard!';
              copyBtn.style.color = 'var(--color-primary)';
              setTimeout(() => {
                if (status) status.textContent = '';
                copyBtn.style.color = '';
              }, 1800);
            });
          } catch (_) {
            output.select();
            document.execCommand('copy');
            if (status) status.textContent = '✓ Copied (fallback)';
          }
        });
      }
    })();
    // ─────────────────────────────────────────────────────────────────────────

    // URL Query Params & FishDatabase project loader
    (async function initEditorParams() {
      const params = new URLSearchParams(window.location.search);
      const idParam = params.get('id');
      const nameParam = params.get('name');
      const aspectParam = params.get('aspect');
      const resParam = params.get('resolution');
      const fpsParam = params.get('fps');
      const durParam = params.get('duration');
      const bgParam = params.get('bg');
      const nameInput = document.getElementById('editor-project-name');

      // Fast synchronous cache discovery to immediately show project title & prevent 30s placeholder freeze
      let fastProject = null;
      if (idParam) {
        try {
          const backupRaw = localStorage.getItem('oft_active_project_backup_' + idParam);
          if (backupRaw) fastProject = JSON.parse(backupRaw);
          if (!fastProject) {
            const rawProjects = localStorage.getItem('fishtools_projects');
            if (rawProjects) {
              const list = JSON.parse(rawProjects);
              if (Array.isArray(list)) {
                fastProject = list.find(p => p && p.id === idParam) || null;
              }
            }
          }
        } catch (_) {}
      }

      const initialProjectName = (fastProject && fastProject.name) || nameParam || '';
      if (nameInput && initialProjectName) {
        nameInput.value = initialProjectName;
        document.title = `${initialProjectName} - OpenFishTools Studio`;
      }
      const loadingTitleEl = document.getElementById('editor-loading-title');
      if (loadingTitleEl && initialProjectName) {
        loadingTitleEl.textContent = `Loading "${initialProjectName}"...`;
      }

      // Clean up all non-essential studio caches in background (non-blocking, deferred)
      if (typeof window.cleanupAllStudioCaches === 'function') {
        setTimeout(() => {
          window.cleanupAllStudioCaches('project_open').catch(() => {});
        }, 1000);
      }

      let currentProject = fastProject;
      if (idParam && window.FishDatabase) {
        try {
          const dbProj = await window.FishDatabase.getProject(idParam);
          if (dbProj) currentProject = dbProj;
        } catch (_) {}
        // Fallback 1: check active project backup in localStorage
        if (!currentProject && idParam) {
          try {
            const backupRaw = localStorage.getItem('oft_active_project_backup_' + idParam);
            if (backupRaw) {
              currentProject = JSON.parse(backupRaw);
            }
          } catch (_) {}
        }
        // Fallback 2: check emergency layers snapshot
        if (!currentProject && idParam) {
          try {
            const snapRaw = localStorage.getItem('fishtool_emergency_layers');
            if (snapRaw) {
              const snap = JSON.parse(snapRaw);
              if (snap && snap.projectId === idParam && Array.isArray(snap.layers)) {
                currentProject = {
                  id: idParam,
                  name: nameParam || 'Project',
                  aspectRatio: aspectParam || '16:9',
                  resolution: resParam || '1080p',
                  fps: fpsParam || '60',
                  bgColor: bgParam || 'transparent',
                  layers: snap.layers
                };
              }
            }
          } catch (_) {}
        }
        // Local project ID in URL but not found in DB
        if (!currentProject && idParam) {
          if (nameParam || aspectParam || resParam) {
            currentProject = {
              id: idParam,
              name: nameParam || 'New_Project',
              aspectRatio: aspectParam || '16:9',
              resolution: resParam || '1080p',
              fps: fpsParam || '60',
              bgColor: bgParam || 'transparent',
              layers: []
            };
            if (window.FishDatabase && typeof window.FishDatabase.saveProject === 'function') {
              window.FishDatabase.saveProject(currentProject).catch(() => {});
            }
          } else {
            currentProject = {
              id: idParam,
              name: 'Project',
              aspectRatio: '16:9',
              resolution: '1080p',
              fps: '60',
              bgColor: 'transparent',
              layers: []
            };
            if (window.FishDatabase && typeof window.FishDatabase.saveProject === 'function') {
              window.FishDatabase.saveProject(currentProject).catch(() => {});
            }
          }
        } else if (currentProject && window.FishDatabase && typeof window.FishDatabase.saveProject === 'function') {
          // Re-sync recovered project into database
          window.FishDatabase.saveProject(currentProject).catch(() => {});
        }
      }

      currentProjectState.id = idParam || (currentProject && currentProject.id) || '';
      currentProjectState.source = (currentProject && currentProject.source) || 'local';
      currentProjectState.isTemplate = !!(currentProject && currentProject.isTemplate);

      currentProjectState.name = (currentProject && currentProject.name) || nameParam || 'New_Project';
      currentProjectState.aspectRatio = (currentProject && currentProject.aspectRatio) || aspectParam || '16:9';
      currentProjectState.resolution = (currentProject && currentProject.resolution) || resParam || '1080p';
      currentProjectState.fps = parseInt((currentProject && currentProject.fps) || fpsParam || 60, 10);
      currentProjectState.defaultDuration = parseFloat((currentProject && currentProject.defaultDuration) || durParam || 5);
      currentProjectState.bgColor = (currentProject && currentProject.bgColor) || bgParam || 'transparent';
      currentProjectState.layers = (currentProject && Array.isArray(currentProject.layers)) ? currentProject.layers : [];
      currentProjectState.beatmarks = (currentProject && Array.isArray(currentProject.beatmarks)) ? currentProject.beatmarks.slice().sort((a, b) => a - b) : [];
      currentProjectState.markerNames = (currentProject && currentProject.markerNames && typeof currentProject.markerNames === 'object') ? { ...currentProject.markerNames } : {};
      currentProjectState.isTemplate = !!(currentProject && currentProject.isTemplate);
      const loadedPps = (currentProject && typeof currentProject.pixelsPerSecond === 'number' && currentProject.pixelsPerSecond > 0) ? currentProject.pixelsPerSecond : 80;
      currentProjectState.pixelsPerSecond = loadedPps;
      if (currentProject && currentProject.motionBlur) {
        currentProjectState.motionBlur = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(currentProject.motionBlur) : (Array.isArray(currentProject.motionBlur) ? [] : {}));
      } else {
        const storedGlobalMb = localStorage.getItem('oft_global_motion_blur') === 'true';
        if (!currentProjectState.motionBlur) {
          currentProjectState.motionBlur = {
            enabled: storedGlobalMb,
            shutterAngle: 180,
            shutterPhase: 0,
            samples: 16
          };
        } else if (storedGlobalMb) {
          currentProjectState.motionBlur.enabled = true;
        }
      }
      if (currentProject && Array.isArray(currentProject.customEasingPresets)) {
        currentProjectState.customEasingPresets = currentProject.customEasingPresets;
        try {
          const raw = localStorage.getItem('fishtool_custom_easing_presets');
          const localList = raw ? JSON.parse(raw) : [];
          const merged = Array.isArray(localList) ? [...localList] : [];
          currentProject.customEasingPresets.forEach(item => {
            if (!merged.some(m => m.name === item.name && JSON.stringify(m.easing) === JSON.stringify(item.easing))) {
              merged.push(item);
            }
          });
          localStorage.setItem('fishtool_custom_easing_presets', JSON.stringify(merged));
        } catch (_) {}
      }

      // Sanitize dangling parentId references to non-existent layers
      const existingLayerIdSet = new Set(currentProjectState.layers.map(l => l.id));
      currentProjectState.layers.forEach(l => {
        if (typeof l.opacity === 'number' && l.opacity > 1.0) {
          l.opacity = Number((l.opacity / 100).toFixed(2));
        }
        if (l.type === 'shape' || l.shapeType || l.shapeProps || (l.id && (l.id.startsWith('layer_shape_') || l.id.startsWith('layer_solid_')))) {
          l.type = 'shape';
          if (!l.fillType) l.fillType = 'color';
          if (!l.shapeType) l.shapeType = 'rectangle';
          if (!l.shapeProps) l.shapeProps = { sizeX: Number(l.scaleW) || 300, sizeY: Number(l.scaleH) || 300 };
          if (!l.fillColor) l.fillColor = '#98ce7b';
        }
        if (l.parentId && !existingLayerIdSet.has(l.parentId)) {
          l.parentId = null;
          delete l.parentBind;
        }
      });

      // Seed preview cache boundaries for all loaded layers and ensure unique effect IDs
      const initPps = currentProjectState.pixelsPerSecond || window.currentPixelsPerSecond || 80;
      currentProjectState.layers.forEach(l => {
        if (typeof ensureLayerEffects === 'function') ensureLayerEffects(l);
        if (l.startSec !== undefined) {
          l.startPx = Math.round(l.startSec * initPps);
        } else {
          l.startSec = (l.startPx || 0) / initPps;
          l.startPx = Math.round(l.startSec * initPps);
        }
        if (l.durationSec !== undefined) {
          l.widthPx = Math.max(16, Math.round(l.durationSec * initPps));
        } else {
          l.durationSec = Math.max(0.1, (l.widthPx || 320) / initPps);
          l.widthPx = Math.max(16, Math.round(l.durationSec * initPps));
        }
        l._cachedStartSec = l.startSec;
        l._cachedEndSec = l.startSec + l.durationSec;
      });

      // Background media pre-warming: pre-load and decode all project image media elements so scrubbing/playback has 0ms initial seek latency
      setTimeout(() => {
        if (Array.isArray(currentProjectState.layers)) {
          currentProjectState.layers.forEach(l => {
            if (l && (l.type === 'image' || l.type === 'video')) {
              getOrLoadLayerMedia(l);
            }
          });
        }
      }, 100);

      // Ensure valid project ID for media persistence
      if (!currentProjectState.id && window.FishDatabase) {
        try {
          const created = await window.FishDatabase.createProject({
            name: currentProjectState.name,
            aspectRatio: currentProjectState.aspectRatio,
            resolution: currentProjectState.resolution,
            fps: currentProjectState.fps,
            defaultDuration: currentProjectState.defaultDuration,
            bgColor: currentProjectState.bgColor,
            motionBlur: currentProjectState.motionBlur ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(currentProjectState.motionBlur) : (Array.isArray(currentProjectState.motionBlur) ? [] : {})) : undefined
          });
          if (created && created.id) {
            currentProjectState.id = created.id;
            const url = new URL(window.location.href);
            url.searchParams.set('id', created.id);
            window.history.replaceState({}, '', url.toString());
          }
        } catch (_) {}
      }

      if (nameInput) {
        nameInput.value = currentProjectState.name;
        document.title = `${currentProjectState.name} - OpenFishTools Studio`;
        if (!nameInput._renameWired) {
          nameInput._renameWired = true;
          nameInput.addEventListener('change', async () => {
            const updatedName = nameInput.value.trim() || 'Untitled_Project';
            nameInput.value = updatedName;
            currentProjectState.name = updatedName;
            document.title = `${updatedName} - OpenFishTools Studio`;
            if (currentProjectState.id && window.FishDatabase) {
              await window.FishDatabase.renameProject(currentProjectState.id, updatedName);
            }
          });
        }
      }

      // Synchronous Save & Exit Trapping on Back Button
      const projectBackBtn = document.getElementById('editor-project-back-btn');
      if (projectBackBtn && !projectBackBtn._backSaveWired) {
        projectBackBtn._backSaveWired = true;
        projectBackBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (typeof writeEmergencySnapshot === 'function') {
            writeEmergencySnapshot();
          }

          const exitThumb = (typeof captureProjectThumbnailPreview === 'function') ? captureProjectThumbnailPreview() : null;
          if (exitThumb) {
            currentProjectState.thumbnail = exitThumb;
          }

          if (currentProjectState.id) {
            try {
              const activeProj = {
                id: currentProjectState.id,
                name: currentProjectState.name || 'New_Project',
                aspectRatio: currentProjectState.aspectRatio || '16:9',
                resolution: currentProjectState.resolution || '1080p',
                fps: String(currentProjectState.fps || 60),
                defaultDuration: currentProjectState.defaultDuration || 5,
                bgColor: currentProjectState.bgColor || 'transparent',
                layers: currentProjectState.layers || [],
                beatmarks: currentProjectState.beatmarks || [],
                pixelsPerSecond: window.currentPixelsPerSecond || 80,
                thumbnail: currentProjectState.thumbnail || exitThumb || '',
                updatedAt: new Date().toISOString()
              };
              localStorage.setItem('oft_active_project_backup_' + currentProjectState.id, JSON.stringify(activeProj));
            } catch (_) {}
          }

          try {
            if (typeof window.teardownEditor === 'function') {
              window.teardownEditor({ flushSave: true, revokeAllObjectUrls: true });
            } else if (typeof saveCurrentProjectLayers === 'function') {
              await saveCurrentProjectLayers(true);
            }
          } catch (err) {
            console.warn('[Editor] Error flushing project before back navigation:', err);
          }

          window.location.href = 'index.html';
        });
      }

      // Restore More Settings toggle states (default: both disabled)
      let isDraftActive = false;
      try {
        const gridBtn = document.getElementById('editor-icon-grid');
        const draftBtn = document.getElementById('editor-icon-low-quality');
        const savedGrid = localStorage.getItem('oft_more_settings_grid');
        if (savedGrid === 'true') {
          gridBtn?.classList.add('is-active');
        } else {
          gridBtn?.classList.remove('is-active');
        }

        const savedDraft = localStorage.getItem('oft_more_settings_draft');
        if (savedDraft === 'true') {
          draftBtn?.classList.add('is-active');
          isDraftActive = true;
        } else {
          draftBtn?.classList.remove('is-active');
        }

        const globalMbBtn = document.getElementById('editor-icon-motion-blur');
        const targetCompState = currentActivePrecomp || currentProjectState;
        const isMbOn = !!(targetCompState && targetCompState.motionBlur && targetCompState.motionBlur.enabled);
        if (globalMbBtn) {
          globalMbBtn.classList.toggle('is-active', isMbOn);
        }
      } catch (e) {
        console.warn('Could not restore more settings from localStorage:', e);
      }

      // Initialize RAM Preview Cache BEFORE initial preview canvas rendering
      // Idle cache disabled by default (can be toggled in Project Settings)
      const savedIdleCache = localStorage.getItem('oft_idle_cache') === 'true'; // default FALSE
      currentProjectState.idleCache = savedIdleCache;
      const initialFps = currentProjectState.fps || 60;
      window.currentTimelineFps = initialFps;
      if (window.PreviewCacheManager) {
        window.PreviewCacheManager.clearAll('all');
        window.PreviewCacheManager.init({ defaultFps: initialFps });
        window.PreviewCacheManager.setDraftMode(isDraftActive);
        window.PreviewCacheManager.setIdleCacheEnabled(savedIdleCache);
      }
      if (window.VideoFrameExtractor) {
        window.VideoFrameExtractor.init({ defaultFps: initialFps });
        window.VideoFrameExtractor.setDraftMode(isDraftActive);
      }

      if (typeof updatePreviewCanvas === 'function') {
        updatePreviewCanvas(
          currentProjectState.aspectRatio,
          currentProjectState.resolution,
          currentProjectState.fps,
          currentProjectState.bgColor
        );
      } else if (typeof window.updatePreviewCanvas === 'function') {
        window.updatePreviewCanvas(
          currentProjectState.aspectRatio,
          currentProjectState.resolution,
          currentProjectState.fps,
          currentProjectState.bgColor
        );
      }

      if (typeof window.setTimelineFps === 'function') {
        window.setTimelineFps(currentProjectState.fps);
      }
      if (typeof window.setTimelineZoom === 'function' && currentProjectState.pixelsPerSecond) {
        window.setTimelineZoom(currentProjectState.pixelsPerSecond);
      }

      // Initialize project media pool
      if (typeof initProjectMediaPool === 'function') {
        initProjectMediaPool();
      } else if (typeof window.initProjectMediaPool === 'function') {
        window.initProjectMediaPool();
      }

      if (typeof window.renderTimelineLayers === 'function') {
        window.renderTimelineLayers();
      }
      if (typeof window.renderTimelineBeatmarks === 'function') {
        window.renderTimelineBeatmarks();
      }
      // Force-sync timeline CSS transform immediately after project load.
      if (typeof window.updateTimelinePosition === 'function') {
        window.updateTimelinePosition(window.timelinePanX || 0, true);
      }

      // Automatically sanitize 3D effects & start background frame extraction for existing project video/precomp layers
      if (Array.isArray(currentProjectState.layers)) {
        currentProjectState.layers.forEach(l => {
          if (typeof sanitizeLayer3DEffects === 'function') {
            sanitizeLayer3DEffects(l);
          }
          if ((l.type === 'video' || l.type === 'precomp') && window.VideoFrameExtractor) {
            window.VideoFrameExtractor.extractLayerRange(l);
          }
        });
      }

      // Initialize Undo/Redo Engine
      const savedMaxUndo = parseInt(localStorage.getItem('oft_max_undo') || '30', 10) || 30;
      currentProjectState.maxUndo = savedMaxUndo;
      if (window.UndoRedoManager) {
        window.UndoRedoManager.init(savedMaxUndo);
        window.UndoRedoManager.recordSnapshot();
      }

      if (typeof redrawComposition === 'function') {
        redrawComposition('initProjectLoaded');
      }

      // Pre-warm WASM effects engine during loading overlay so editing is instantaneous
      const loadingSubEl = document.getElementById('editor-loading-sub');
      if (loadingSubEl) {
        loadingSubEl.textContent = 'Pre-warming WASM effects engine...';
      }
      if (typeof window.prewarmWasmEffects === 'function') {
        try {
          await window.prewarmWasmEffects();
        } catch (_) {}
      }

      // Dismiss loading screen overlay cleanly as soon as initial project layout, canvas and WASM effects are ready
      if (typeof window._dismissLoadingOverlay === 'function') {
        window._dismissLoadingOverlay();
      }

      // Non-blocking layer media hydration from IndexedDB Media Pool
      if (typeof hydrateMediaFromPool === 'function') {
        hydrateMediaFromPool();
      }

      // Auto-open Template Editor for imported projects or templates
      const isTemplateParam = params.get('template') === '1';
      const isTemplateProject = isTemplateParam || (currentProject && currentProject.isTemplate) || (currentProjectState && currentProjectState.isTemplate);
      if (isTemplateProject) {
        const tryOpenTemplate = (attempts = 0) => {
          if (window.FishTemplateEditor && typeof window.FishTemplateEditor.open === 'function') {
            window.FishTemplateEditor.open();
          } else if (attempts < 30) {
            setTimeout(() => tryOpenTemplate(attempts + 1), 100);
          }
        };
        setTimeout(() => tryOpenTemplate(), 150);

        // Turn off isTemplate in project state and IndexedDB so it only opens once on initial import
        if (currentProject) {
          currentProject.isTemplate = false;
        }
        currentProjectState.isTemplate = false;

        if (window.FishDatabase && currentProjectState.id) {
          window.FishDatabase.getProject(currentProjectState.id).then(prj => {
            if (prj && prj.isTemplate) {
              prj.isTemplate = false;
              window.FishDatabase.saveProject(prj).catch(() => {});
            }
          }).catch(() => {});
        }

        // Clean up URL query param so refresh (F5/Cmd+R) won't re-trigger it
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.has('template')) {
            url.searchParams.delete('template');
            window.history.replaceState(window.history.state || {}, document.title, url.pathname + url.search);
          }
        } catch (_) {}
      }
    })();

    // MP4 ISO BMFF Binary Box Parser (Fast timescale, duration, and FPS extraction from mvhd/trak/mdhd/stts)
    function parseMp4Metadata(buffer) {
      if (!buffer || buffer.byteLength < 16) return null;
      const view = new DataView(buffer);
      const len = buffer.byteLength;
      let timescale = null;
      let duration = null;
      let fps = null;

      function findBox(start, end, targetType) {
        let p = start;
        while (p + 8 <= end) {
          const size = view.getUint32(p);
          const type = String.fromCharCode(
            view.getUint8(p + 4),
            view.getUint8(p + 5),
            view.getUint8(p + 6),
            view.getUint8(p + 7)
          );
          const boxSize = size === 1 ? Number(view.getBigUint64(p + 8)) : (size === 0 ? end - p : size);
          if (boxSize < 8) break;
          if (type === targetType) {
            const headerSize = size === 1 ? 16 : 8;
            return { start: p + headerSize, end: Math.min(end, p + boxSize), size: boxSize };
          }
          p += boxSize;
        }
        return null;
      }

      try {
        const moov = findBox(0, len, 'moov');
        if (!moov) return null;

        const mvhd = findBox(moov.start, moov.end, 'mvhd');
        if (mvhd) {
          const version = view.getUint8(mvhd.start);
          let mvhdTimescale = 0;
          let mvhdDuration = 0;
          if (version === 1) {
            if (mvhd.start + 28 <= mvhd.end) {
              mvhdTimescale = view.getUint32(mvhd.start + 20);
              mvhdDuration = Number(view.getBigUint64(mvhd.start + 24));
            }
          } else {
            if (mvhd.start + 20 <= mvhd.end) {
              mvhdTimescale = view.getUint32(mvhd.start + 12);
              mvhdDuration = view.getUint32(mvhd.start + 16);
            }
          }
          if (mvhdTimescale > 0 && mvhdDuration > 0) {
            timescale = mvhdTimescale;
            duration = mvhdDuration / mvhdTimescale;
          }
        }

        let trakP = moov.start;
        while (trakP + 8 <= moov.end) {
          const trak = findBox(trakP, moov.end, 'trak');
          if (!trak) break;
          trakP = trak.end;

          const mdia = findBox(trak.start, trak.end, 'mdia');
          if (mdia) {
            const mdhd = findBox(mdia.start, mdia.end, 'mdhd');
            let trakTimescale = 0;
            let trakDuration = 0;
            if (mdhd) {
              const version = view.getUint8(mdhd.start);
              if (version === 1) {
                if (mdhd.start + 28 <= mdhd.end) {
                  trakTimescale = view.getUint32(mdhd.start + 20);
                  trakDuration = Number(view.getBigUint64(mdhd.start + 24));
                }
              } else {
                if (mdhd.start + 20 <= mdhd.end) {
                  trakTimescale = view.getUint32(mdhd.start + 12);
                  trakDuration = view.getUint32(mdhd.start + 16);
                }
              }
              if (trakTimescale > 0 && trakDuration > 0 && !duration) {
                duration = trakDuration / trakTimescale;
              }
            }

            const minf = findBox(mdia.start, mdia.end, 'minf');
            if (minf) {
              const stbl = findBox(minf.start, minf.end, 'stbl');
              if (stbl) {
                const stts = findBox(stbl.start, stbl.end, 'stts');
                if (stts && stts.start + 16 <= stts.end) {
                  const entryCount = view.getUint32(stts.start + 4);
                  if (entryCount > 0) {
                    const sampleCount = view.getUint32(stts.start + 8);
                    const sampleDelta = view.getUint32(stts.start + 12);
                    const effectiveTimescale = trakTimescale || timescale;
                    if (effectiveTimescale > 0 && sampleDelta > 0) {
                      const rawFps = effectiveTimescale / sampleDelta;
                      if (rawFps >= 10 && rawFps <= 240) {
                        fps = rawFps;
                      }
                    }
                  }
                }
              }
            }
          }
          if (fps) break;
        }
      } catch (_) {}

      if (fps) {
        const standardFps = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
        for (const std of standardFps) {
          if (Math.abs(fps - std) < 0.15) {
            fps = Math.round(std);
            break;
          }
        }
        fps = Math.round(fps);
      }

      return { duration, fps, timescale };
    }
    window.parseMp4Metadata = parseMp4Metadata;

    // Comprehensive Video Metadata Inspector (Instant Duration, Native FPS, Dims, Poster)
    function inspectVideoMetadata(file, dataUrl) {
      return new Promise(async (resolve) => {
        let detectedDuration = null;
        let detectedFps = null;
        let width = 0;
        let height = 0;
        let thumbUrl = '';

        // 1. Fast binary MP4 header parsing if file/blob available (<1ms)
        if (file && file.size > 16) {
          try {
            const headChunk = await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer();
            let meta = parseMp4Metadata(headChunk);
            if ((!meta || !meta.duration) && file.size > 512 * 1024) {
              const tailStart = Math.max(0, file.size - 512 * 1024);
              const tailChunk = await file.slice(tailStart, file.size).arrayBuffer();
              meta = parseMp4Metadata(tailChunk) || meta;
            }
            if (meta) {
              if (meta.duration && meta.duration > 0) detectedDuration = meta.duration;
              if (meta.fps && meta.fps > 0) detectedFps = meta.fps;
            }
          } catch (_) {}
        }

        // 2. Offscreen hardware-accelerated video element for exact dimensions and thumbnail grab
        let resolved = false;
        let blobUrl = null;
        let timeoutTimer = null;

        // Use dataUrl if already provided to prevent duplicate blob URL collisions in Safari
        if (!dataUrl && file) {
          try { blobUrl = URL.createObjectURL(file); } catch (_) {}
        }
        const src = dataUrl || blobUrl;
        if (!src) {
          resolve({ duration: detectedDuration, fps: detectedFps, width: 0, height: 0, thumbUrl: '' });
          return;
        }

        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.style.cssText = 'position:fixed;bottom:0;right:0;width:16px;height:16px;opacity:0.001;pointer-events:none;z-index:-9999;';
        const mountPool = document.getElementById('editor-video-mount-pool') || document.body;
        mountPool.appendChild(video);

        function cleanup() {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          try {
            video.pause();
            video.src = '';
          } catch (_) {}
          if (video.parentNode) {
            try { video.parentNode.removeChild(video); } catch (_) {}
          }
          if (blobUrl) {
            setTimeout(() => {
              try { URL.revokeObjectURL(blobUrl); } catch (_) {}
            }, 10000);
          }
        }

        function finish() {
          if (resolved) return;
          resolved = true;
          cleanup();
          const vidDur = (isFinite(video.duration) && video.duration > 0) ? video.duration : null;
          const finalDur = vidDur || ((detectedDuration && isFinite(detectedDuration) && detectedDuration > 0) ? detectedDuration : null);
          const finalMeta = {
            duration: finalDur,
            fps: (detectedFps && isFinite(detectedFps) && detectedFps > 0) ? detectedFps : null,
            width: width || (video.videoWidth > 0 ? video.videoWidth : 0),
            height: height || (video.videoHeight > 0 ? video.videoHeight : 0),
            thumbUrl: thumbUrl || ''
          };
          window.lastCapturedVideoDims = finalMeta;
          resolve(finalMeta);
        }

        // Fast fail-safe timeout (max 1200ms so tablet/mobile decoders finish loadedmetadata)
        timeoutTimer = setTimeout(finish, 1200);

        function captureThumb() {
          if (thumbUrl) return;
          try {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            if (vw > 0 && vh > 0) {
              width = vw;
              height = vh;
              const canvas = document.createElement('canvas');
              canvas.width = 48;
              canvas.height = Math.max(1, Math.round(48 * (vh / vw)));
              const ctx = canvas.getContext('2d', { alpha: false });
              ctx.imageSmoothingQuality = 'low';
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const t = canvas.toDataURL('image/jpeg', 0.45);
              if (t && t.length > 50) thumbUrl = t;
            }
          } catch (_) {}
        }

        video.onloadedmetadata = () => {
          if (video.videoWidth > 0) width = video.videoWidth;
          if (video.videoHeight > 0) height = video.videoHeight;
          if (isFinite(video.duration) && video.duration > 0) {
            detectedDuration = video.duration;
          }
          captureThumb();
          if (thumbUrl) {
            finish();
          }
        };

        // As soon as first frame data is decoded (readyState >= 2), grab thumb and finish immediately!
        video.onloadeddata = () => {
          captureThumb();
          finish();
        };

        video.onerror = () => finish();

        video.src = src;
        video.load();
      });
    }
    window.inspectVideoMetadata = inspectVideoMetadata;

    // Comprehensive Editor Teardown Lifecycle
    function teardownEditor({ flushSave = true, revokeAllObjectUrls = true } = {}) {
      // 1. Flush pending save
      if (flushSave && typeof window.saveCurrentProjectLayers === 'function') {
        try { window.saveCurrentProjectLayers(true); } catch (_) {}
      }

      // 2. Stop transport playback
      if (typeof window.pausePlayback === 'function') {
        try { window.pausePlayback(false); } catch (_) {}
      }

      // 3. Clear auto-save interval
      if (window._editorAutoSaveIntervalId) {
        clearInterval(window._editorAutoSaveIntervalId);
        window._editorAutoSaveIntervalId = null;
      }

      // 4. Clear pending debounced timers
      if (saveLayersDebounceTimer) {
        clearTimeout(saveLayersDebounceTimer);
        saveLayersDebounceTimer = null;
      }
      if (window._saveLayersDebounceTimer) {
        clearTimeout(window._saveLayersDebounceTimer);
        window._saveLayersDebounceTimer = null;
      }
      if (window._parkAudioTimer) {
        clearTimeout(window._parkAudioTimer);
        window._parkAudioTimer = null;
      }
      if (window._saveBeatmarksDebounceTimer) {
        clearTimeout(window._saveBeatmarksDebounceTimer);
        window._saveBeatmarksDebounceTimer = null;
      }
      if (window._timelineEmptyLpTimer) {
        clearTimeout(window._timelineEmptyLpTimer);
        window._timelineEmptyLpTimer = null;
      }
      if (window._playLongPressTimer) {
        clearTimeout(window._playLongPressTimer);
        window._playLongPressTimer = null;
      }

      // 5. Cancel active animation frames
      if (window._canvasRedrawRaf) {
        cancelAnimationFrame(window._canvasRedrawRaf);
        window._canvasRedrawRaf = null;
      }
      if (window._desktopRAF) {
        cancelAnimationFrame(window._desktopRAF);
        window._desktopRAF = null;
      }
      if (window._mobileRAF) {
        cancelAnimationFrame(window._mobileRAF);
        window._mobileRAF = null;
      }
      if (window._playAnimationId) {
        cancelAnimationFrame(window._playAnimationId);
        window._playAnimationId = null;
      }

      // 6. Stop audio playback and pause all audio elements
      if (window.FishAudioEngine) {
        try { window.FishAudioEngine.pauseAll(); } catch (_) {}
      }

      // 7. Release all layer media elements and empty DOM video mount pool
      if (window.layerMediaCache) {
        for (const [key, media] of window.layerMediaCache.entries()) {
          if (media && media.el) {
            if (typeof media.el.pause === 'function') {
              try { media.el.pause(); } catch (_) {}
            }
            try { media.el.src = ''; } catch (_) {}
            if (window.FishAudioEngine) {
              try { window.FishAudioEngine.detachMediaElement(media.el); } catch (_) {}
            }
            if (media.el.parentNode) {
              try { media.el.parentNode.removeChild(media.el); } catch (_) {}
            }
            if (media.freezeCanvas) {
              media.freezeCanvas.width = 0;
              media.freezeCanvas.height = 0;
              media.freezeCanvas = null;
            }
          }
        }
        window.layerMediaCache.clear();
      }

      const mountPool = document.getElementById('editor-video-mount-pool');
      if (mountPool) mountPool.innerHTML = '';

      // 8. Release layer scratch canvas buffers
      const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
      const cleanLayerBuffers = (list) => {
        (list || []).forEach(l => {
          if (!l) return;
          if (l._textBufferCanvas) { l._textBufferCanvas.width = 0; l._textBufferCanvas.height = 0; l._textBufferCanvas = null; }
          if (l._shapeBufferCanvas) { l._shapeBufferCanvas.width = 0; l._shapeBufferCanvas.height = 0; l._shapeBufferCanvas = null; }
          if (l._precompBufferCanvas) { l._precompBufferCanvas.width = 0; l._precompBufferCanvas.height = 0; l._precompBufferCanvas = null; }
          if (l._fillBufferCanvas) { l._fillBufferCanvas.width = 0; l._fillBufferCanvas.height = 0; l._fillBufferCanvas = null; }
          if (Array.isArray(l.layers)) cleanLayerBuffers(l.layers);
        });
      };
      cleanLayerBuffers(layers);

      // 9. RAM Preview Cache & Video Frame Extractor Teardown
      if (window.PreviewCacheManager) {
        try {
          if (typeof window.PreviewCacheManager.stopIdleWorker === 'function') {
            window.PreviewCacheManager.stopIdleWorker();
          }
          if (window.PreviewCacheManager.idleTimer) {
            clearTimeout(window.PreviewCacheManager.idleTimer);
            window.PreviewCacheManager.idleTimer = null;
          }
          if (typeof window.PreviewCacheManager.clearAll === 'function') {
            window.PreviewCacheManager.clearAll('all');
          }
        } catch (_) {}
      }
      if (window.VideoFrameExtractor) {
        try {
          window.VideoFrameExtractor.clearAll();
        } catch (_) {}
      }

      // 10. Effective Props Cache Invalidation
      if (typeof window.invalidateEffectivePropsCache === 'function') {
        window.invalidateEffectivePropsCache();
      }

      // 11. Revoke all tracked Object URLs
      if (revokeAllObjectUrls && window._studioObjectUrls) {
        for (const url of window._studioObjectUrls) {
          try { URL.revokeObjectURL(url); } catch (_) {}
        }
        window._studioObjectUrls.clear();
      }
    }
    window.teardownEditor = teardownEditor;

    // Fast Video Thumbnail Capture Utility (Backwards-compatible wrapper)
    async function captureVideoThumbnail(file, dataUrl) {
      const meta = await inspectVideoMetadata(file, dataUrl);
      return (meta && meta.thumbUrl) || '';
    }
    window.captureVideoThumbnail = captureVideoThumbnail;

    // Non-blocking layer media hydration from IndexedDB Media Pool
    async function hydrateMediaFromPool() {
      if (!currentProjectState || !currentProjectState.id || !window.FishDatabase) return;
      try {
        const projectMedias = await window.FishDatabase.getProjectMedia(currentProjectState.id);
        if (Array.isArray(projectMedias) && projectMedias.length > 0) {
          const mediaMap = new Map(projectMedias.map(m => [m.id, m]));
          const hydrateLayer = (l) => {
            if (!l) return;
            let m = l.mediaId ? mediaMap.get(l.mediaId) : null;
            if (!m && (l.type === 'video' || l.type === 'image' || l.type === 'audio')) {
              m = projectMedias.find(item => item.name === l.name && item.type === l.type) ||
                  (projectMedias.filter(item => item.type === l.type).length === 1 ? projectMedias.find(item => item.type === l.type) : null);
              if (m) l.mediaId = m.id;
            }
            if (m) {
              if (!m.dataUrl && m.buffer) {
                try {
                  m.blob = new Blob([m.buffer], { type: m.mimeType || '' });
                  const blobUrl = URL.createObjectURL(m.blob);
                  m.dataUrl = (typeof window.trackStudioObjectUrl === 'function') ? window.trackStudioObjectUrl(blobUrl) : blobUrl;
                } catch (_) {}
              }
              if (m.dataUrl) {
                l.dataUrl = m.dataUrl;
              } else if (m.blob) {
                try {
                  const blobUrl = URL.createObjectURL(m.blob);
                  l.dataUrl = (typeof window.trackStudioObjectUrl === 'function') ? window.trackStudioObjectUrl(blobUrl) : blobUrl;
                } catch (_) {}
              }
              if (m.thumbUrl) {
                l.thumbUrl = m.thumbUrl;
              } else if (m.thumbBlob) {
                try {
                  const blobUrl = URL.createObjectURL(m.thumbBlob);
                  l.thumbUrl = (typeof window.trackStudioObjectUrl === 'function') ? window.trackStudioObjectUrl(blobUrl) : blobUrl;
                } catch (_) {}
              } else if (m.thumbBuffer) {
                try {
                  m.thumbBlob = new Blob([m.thumbBuffer], { type: 'image/jpeg' });
                  const blobUrl = URL.createObjectURL(m.thumbBlob);
                  l.thumbUrl = (typeof window.trackStudioObjectUrl === 'function') ? window.trackStudioObjectUrl(blobUrl) : blobUrl;
                } catch (_) {}
              }
              if (!l.mediaDuration && m.duration) l.mediaDuration = m.duration;
              if (!l.mediaWidth && m.width) l.mediaWidth = m.width;
              if (!l.mediaHeight && m.height) l.mediaHeight = m.height;

              // Sync with any media element already mounted in layerMediaCache
              const cacheKey = l.type === 'video' ? l.id : (l.mediaId || l.id);
              if (window.layerMediaCache && window.layerMediaCache.has(cacheKey)) {
                const entry = window.layerMediaCache.get(cacheKey);
                if (entry && entry.el && l.dataUrl && entry.el.src !== l.dataUrl) {
                  entry.el.src = l.dataUrl;
                  if (typeof entry.el.load === 'function') entry.el.load();
                }
              }
            }
            if (l.type === 'precomp' && m && Array.isArray(m.layers)) {
              if (!Array.isArray(l.layers) || l.layers.length === 0) {
                l.layers = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(m.layers) : (Array.isArray(m.layers) ? [] : {}));
              }
              if (l.collapseTransformations === undefined && m.collapseTransformations !== undefined) {
                l.collapseTransformations = !!m.collapseTransformations;
              }
              if (l.is3D === undefined && m.is3D !== undefined) {
                l.is3D = !!m.is3D;
              }
            }
            const targetFillMediaId = l.fillMediaId || (l.fillType === 'media' ? (l.mediaId || null) : null);
            let fm = targetFillMediaId ? mediaMap.get(targetFillMediaId) : null;
            if (!fm && l.fillType === 'media') {
              fm = projectMedias.find(item => item.id === l.fillMediaId || item.name === l.fillMediaName || item.name === l.name);
            }
            if (fm) {
              l.fillMediaId = fm.id;
              const freshUrl = fm.thumbUrl || fm.dataUrl;
              if (freshUrl) {
                l.fillMediaUrl = freshUrl;
                if (!l.dataUrl || l.dataUrl.startsWith('blob:')) l.dataUrl = fm.dataUrl || freshUrl;
                if (!l.thumbUrl || l.thumbUrl.startsWith('blob:')) l.thumbUrl = fm.thumbUrl || freshUrl;
              }
              if (fm.name) l.fillMediaName = fm.name;
              l._fillDirty = true;
              delete l._fillMediaImg;
              delete l._fillBufferCanvas;
              if (l._shapeBufferCanvas) l._shapeBufferCanvas._lastShapeKey = null;
            }
            if ((l.type === 'video' || l.type === 'precomp') && window.VideoFrameExtractor) {
              window.VideoFrameExtractor.extractLayerRange(l);
            }
            if (Array.isArray(l.layers)) {
              l.layers.forEach(hydrateLayer);
            }
          };
          if (Array.isArray(currentProjectState.layers)) {
            currentProjectState.layers.forEach(hydrateLayer);
          }
          if (window.layerMediaCache) window.layerMediaCache.clear();
          if (typeof saveCurrentProjectLayers === 'function' && Array.isArray(currentProjectState.layers) && currentProjectState.layers.length > 0) {
            saveCurrentProjectLayers();
          }
          if (typeof redrawComposition === 'function') {
            redrawComposition('mediaHydrated');
          }
          if (typeof window.renderTimelineLayers === 'function') {
            window.renderTimelineLayers();
          }
        }
      } catch (e) {
        console.warn('Hydrating layers from media pool warning:', e);
      }
    }
    window.hydrateMediaFromPool = hydrateMediaFromPool;
})();
