/**
 * js/preview-cache.js
 * After Effects-Style RAM Preview Cache Engine
 * High-performance hardware-accelerated frame caching, selective range invalidation,
 * background idle caching, and visual timeline ruler indicator.
 */
(function(window) {
  'use strict';

  class PreviewCacheManager {
    constructor() {
      // Map<compId, Map<frameIndex (number), { bitmap: ImageBitmap, isDraft: boolean, width: number, height: number }>>
      this.pools = new Map();
      this.pools.set('root', new Map());
      this.activeCompId = 'root';
      this._fps = 60;
      this.isDraftMode = false;
      this.idleCacheEnabled = false;
      this.isIdleRunning = false;
      this.idleTimer = null;
      this.idleWorkerId = null;
      this.lastUserActivity = Date.now();
      this.rulerCanvas = null;
      this.rulerCtx = null;
      this.offscreenCanvas = null;
      this._isCachingFrame = false;
      this._pendingFrames = new Set();
      // Tracks frames whose createImageBitmap is currently in-flight (prevents double-encode race)
      this._inFlightFrames = new Set();
      this._unreadyFrames = new Set();
      this._frameGen = new Map();
      this._lastKnownCompFingerprints = new Map();
      this._lastKnownLayerSnapshots = new Map();
      // Adaptive memory buffer: scale cache capacity to cover up to 1 minute (60s) based on project fps
      // Prevents premature eviction while adjusting for device memory tiers
      const isMobile = (typeof window !== 'undefined' && (
        window.innerWidth <= 768 ||
        ('ontouchstart' in window && window.innerWidth <= 1024) ||
        (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''))
      ));
      const devMem = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : (isMobile ? 4 : 8);
      this._devMem = devMem;
      this._isMobile = isMobile;
      this._lastSyncMs = 0;
    }

    get maxFrames() {
      const fps = this.fps || 60;
      const devMem = this._devMem || 4;
      // Device-aware RAM frame cap to prevent GPU/browser OOM crashes while holding up to 1 minute of 60fps preview
      if (devMem <= 2) {
        return Math.min(900, Math.max(450, Math.round(15 * fps)));
      }
      if (this._isMobile || devMem <= 4) {
        return Math.min(1800, Math.max(900, Math.round(30 * fps)));
      }
      return Math.min(3600, Math.max(1800, Math.round(60 * fps)));
    }

    get frames() {
      const key = this.activeCompId || 'root';
      if (!this.pools.has(key)) {
        this.pools.set(key, new Map());
      }
      return this.pools.get(key);
    }

    getActiveCompId() {
      return this.activeCompId || 'root';
    }

    getPool(compId) {
      const key = compId || this.activeCompId || 'root';
      if (!this.pools.has(key)) {
        this.pools.set(key, new Map());
      }
      return this.pools.get(key);
    }

    deletePool(compId) {
      if (!compId || compId === 'root') return;
      if (this.pools.has(compId)) {
        const pool = this.pools.get(compId);
        const closedBitmaps = new Set();
        for (const entry of pool.values()) {
          if (entry && entry.bitmap && !closedBitmaps.has(entry.bitmap) && typeof entry.bitmap.close === 'function') {
            closedBitmaps.add(entry.bitmap);
            try { entry.bitmap.close(); } catch (_) {}
          }
        }
        pool.clear();
        this.pools.delete(compId);
      }
    }

    setActiveComp(compId = 'root') {
      const target = compId || 'root';
      if (this.activeCompId !== target) {
        this.activeCompId = target;
        if (!this.pools.has(target)) {
          this.pools.set(target, new Map());
        }
        this.ensureAudioOnlyFullCache();
        this.updateRulerUI();
        if (this.idleCacheEnabled) {
          this.scheduleIdleCheck();
        }
      }
    }

    get fps() {
      if (typeof window !== 'undefined') {
        if (typeof window.getProjectFps === 'function') {
          const pFps = window.getProjectFps();
          if (pFps && pFps > 0) return pFps;
        }
        if (typeof window.currentTimelineFps === 'number' && window.currentTimelineFps > 0) {
          return window.currentTimelineFps;
        }
        if (window.currentProjectState && window.currentProjectState.fps) {
          const pFps = parseInt(window.currentProjectState.fps, 10);
          if (pFps && pFps > 0) return pFps;
        }
      }
      return this._fps || 60;
    }

    set fps(val) {
      const parsed = parseInt(val, 10);
      if (parsed && parsed > 0) {
        this._fps = parsed;
      }
    }

    init({ rulerCanvasId = 'timeline-cache-ruler-bar', defaultFps = 60 } = {}) {
      if (defaultFps) this._fps = defaultFps;
      this.rulerCanvas = document.getElementById(rulerCanvasId);
      if (this.rulerCanvas) {
        this.rulerCtx = this.rulerCanvas.getContext('2d');
      }
      this.setupUserActivityListeners();
      const savedIdle = typeof localStorage !== 'undefined' ? localStorage.getItem('oft_idle_cache') !== 'false' : true;
      this.idleCacheEnabled = (typeof window !== 'undefined' && window.isPreviewCacheEnabled !== false) && savedIdle;
    }

    setFps(fps) {
      const parsed = parseInt(fps, 10);
      if (parsed && parsed !== this._fps) {
        this._fps = parsed;
        this.clearAll('all');
      }
    }

    setDraftMode(isDraft) {
      const boolVal = !!isDraft;
      if (this.isDraftMode !== boolVal) {
        this.isDraftMode = boolVal;
        this.clearAll('all');
      }
    }

    setIdleCacheEnabled(enabled) {
      this.idleCacheEnabled = !!enabled;
      if (!this.idleCacheEnabled) {
        this.stopIdleWorker();
      } else {
        this.scheduleIdleCheck();
      }
    }

    hasFrame(frameIndex, expectedWidth = null, expectedHeight = null, compId = null) {
      const pool = this.getPool(compId || this.activeCompId);
      const entry = pool.get(frameIndex);
      if (!entry) return false;
      if (entry.isAudioOnly) return true;
      if (expectedWidth && expectedHeight && entry.width && entry.height) {
        const entryAspect = entry.width / entry.height;
        const expectedAspect = expectedWidth / expectedHeight;
        if (Math.abs(entryAspect - expectedAspect) > 0.15) {
          return false;
        }
      }
      return true;
    }

    getFrame(frameIndex, expectedWidth = null, expectedHeight = null, compId = null) {
      const pool = this.getPool(compId || this.activeCompId);
      const entry = pool.get(frameIndex);
      if (!entry) return null;
      if (entry.isAudioOnly) {
        return entry.bitmap || this._getAudioOnlyCanvas(expectedWidth, expectedHeight);
      }
      if (expectedWidth && expectedHeight && entry.width && entry.height) {
        const entryAspect = entry.width / entry.height;
        const expectedAspect = expectedWidth / expectedHeight;
        if (Math.abs(entryAspect - expectedAspect) > 0.15) {
          return null;
        }
      }
      return entry.bitmap;
    }

    /**
     * Check if the active composition only contains audio layers (and no visible visual layers).
     * When true, the entire timeline duration can be cached instantaneously using a single shared background frame.
     */
    isAudioOnlyComposition(projectState = null, compId = null) {
      const ps = projectState || (typeof window !== 'undefined' ? window.currentProjectState : null);
      if (!ps || !Array.isArray(ps.layers) || ps.layers.length === 0) return false;
      const targetComp = compId || this.activeCompId || 'root';
      const layers = (targetComp === 'root' || !targetComp)
        ? (ps.layers || [])
        : ((typeof window !== 'undefined' && window.currentActivePrecomp && Array.isArray(window.currentActivePrecomp.layers))
          ? window.currentActivePrecomp.layers
          : (ps.layers || []));
      if (layers.length === 0) return false;

      let hasActiveAudio = false;
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        if (!l || l.hidden) continue;
        const t = (l.type || l.mediaType || '').toLowerCase();
        if (t === 'audio') {
          hasActiveAudio = true;
        } else if (t === 'null' || l.isNull) {
          continue;
        } else {
          // Any visible visual layer (video, image, text, shape, precomp, adjustment, camera, etc.)
          return false;
        }
      }
      return hasActiveAudio;
    }

    _getAudioOnlyCanvas(width = null, height = null, bgColor = null) {
      if (typeof document === 'undefined') return null;
      const activeCanvas = document.getElementById('editor-active-canvas');
      const w = Math.max(16, Number(width) || (activeCanvas && activeCanvas.width) || 640);
      const h = Math.max(16, Number(height) || (activeCanvas && activeCanvas.height) || 360);
      const ps = (typeof window !== 'undefined' && window.currentProjectState) ? window.currentProjectState : null;
      const bg = bgColor || (ps && ps.bgColor) || '#0a0d07';

      if (!this._audioOnlyCanvas) {
        this._audioOnlyCanvas = document.createElement('canvas');
      }
      if (this._audioOnlyCanvas.width !== w || this._audioOnlyCanvas.height !== h || this._audioOnlyBg !== bg) {
        this._audioOnlyCanvas.width = w;
        this._audioOnlyCanvas.height = h;
        this._audioOnlyBg = bg;
        const ctx = this._audioOnlyCanvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, w, h);
          if (bg && bg !== 'transparent') {
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, w, h);
          }
        }
      }
      return this._audioOnlyCanvas;
    }

    /**
     * Instantly populate the full project duration cache when the timeline only has audio layer(s).
     * Uses a single shared entry across all frames (0 .. totalFrames) so memory usage is ~0 MB
     * and the green cache bar is immediately 100% full for adding beatmarks.
     */
    ensureAudioOnlyFullCache(projectState = null, compId = null) {
      if (typeof window !== 'undefined' && (window.isExporting || window.isPreviewCacheEnabled === false)) return false;
      const targetComp = compId || this.activeCompId || 'root';
      if (!this.isAudioOnlyComposition(projectState, targetComp)) return false;

      const totalDur = (typeof window !== 'undefined' && typeof window.getProjectTotalDuration === 'function')
        ? window.getProjectTotalDuration()
        : 0;
      if (totalDur <= 0) return false;

      const currentFps = this.fps || 60;
      const totalFrames = Math.ceil(totalDur * currentFps);
      const pool = this.getPool(targetComp);
      const ps = projectState || (typeof window !== 'undefined' ? window.currentProjectState : null);
      const bg = (ps && ps.bgColor) || '#0a0d07';

      // Fast check if already fully populated for this exact audio-only duration and background
      if (
        pool.size >= totalFrames + 1 &&
        this._lastAudioOnlyCacheKey === `${targetComp}:${totalFrames}:${currentFps}:${bg}:${this.isDraftMode ? 1 : 0}` &&
        pool.has(0) &&
        pool.has(totalFrames)
      ) {
        return true;
      }

      const bgCanvas = this._getAudioOnlyCanvas(null, null, bg);
      if (!bgCanvas) return false;

      const sharedEntry = {
        bitmap: bgCanvas,
        isDraft: this.isDraftMode,
        isAudioOnly: true,
        shared: true,
        width: bgCanvas.width,
        height: bgCanvas.height
      };

      for (let f = 0; f <= totalFrames; f++) {
        pool.set(f, sharedEntry);
      }
      this._lastAudioOnlyCacheKey = `${targetComp}:${totalFrames}:${currentFps}:${bg}:${this.isDraftMode ? 1 : 0}`;

      // Upgrade sharedEntry.bitmap to hardware ImageBitmap asynchronously if supported
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(bgCanvas).then((bmp) => {
          if (bmp && sharedEntry.bitmap === bgCanvas) {
            sharedEntry.bitmap = bmp;
          } else if (bmp && typeof bmp.close === 'function') {
            try { bmp.close(); } catch (_) {}
          }
        }).catch(() => {});
      }

      this.updateRulerUI();
      return true;
    }

    /**
     * Evict the single worst frame from the current pool when over maxFrames limit.
     * Frames outside project duration bounds are purged first; if pool exceeds device memory cap,
     * furthest frame from playhead is evicted so browser GPU memory never crashes.
     */
    _evictIfNeeded(compId = null) {
      const targetComp = compId || this.activeCompId;
      const pool = this.getPool(targetComp);
      const totalDur = (typeof window !== 'undefined' && typeof window.getProjectTotalDuration === 'function')
        ? window.getProjectTotalDuration()
        : 0;
      const currentFps = this.fps || 60;
      const totalProjectFrames = Math.ceil(totalDur * currentFps);
      const memCap = this.maxFrames || Math.round(60 * currentFps);
      const effectiveMax = Math.min(memCap, Math.max(60, totalProjectFrames + 15));
      if (pool.size <= effectiveMax) return;

      const pps = (typeof window !== 'undefined' && window.currentPixelsPerSecond) ? window.currentPixelsPerSecond : 80;
      const curSec = (typeof window !== 'undefined' && typeof window.getCurrentPlayheadTime === 'function')
        ? window.getCurrentPlayheadTime()
        : ((typeof window !== 'undefined' && window.timelinePanX !== undefined) ? Math.abs(window.timelinePanX) / pps : 0);
      const curFrame = Math.round(curSec * currentFps);

      let worstIdx = -1;
      let worstScore = -Infinity;

      for (const fIdx of pool.keys()) {
        const inFlightKey = `${targetComp}:${fIdx}`;
        if (this._inFlightFrames && this._inFlightFrames.has(inFlightKey)) continue; // never evict in-flight
        const dist = Math.abs(fIdx - curFrame);
        let score = dist;
        if (fIdx < 0 || fIdx > totalProjectFrames) {
          score += 100000;
        }
        if (score > worstScore) {
          worstScore = score;
          worstIdx = fIdx;
        }
      }

      if (worstIdx !== -1) {
        this.deleteFrame(worstIdx, false, targetComp);
      }
    }

    /**
     * Check if a frame is part of a contiguous cached sequence.
     * Prevents playback strobe/jitter when cache has gaps or isolated frames.
     * minRun=2: AE-like behavior — just 2 contiguous frames are enough to allow cache playback.
     */
    isContiguousPlaybackFrame(frameIndex, minRun = 2) {
      if (!this.frames.has(frameIndex)) return false;
      const totalDur = (typeof window !== 'undefined' && typeof window.getProjectTotalDuration === 'function')
        ? window.getProjectTotalDuration()
        : 0;
      const effectiveMinRun = totalDur > 0 ? Math.min(minRun, Math.max(1, Math.ceil(totalDur * this.fps))) : minRun;

      let count = 0;
      let f = frameIndex;
      while (this.frames.has(f)) {
        count++;
        if (count >= effectiveMinRun) return true;
        f--;
      }
      f = frameIndex + 1;
      while (this.frames.has(f)) {
        count++;
        if (count >= effectiveMinRun) return true;
        f++;
      }
      return count >= effectiveMinRun;
    }

    // Throttled ruler update: rapid batched updates to display green progress bar promptly
    _scheduleRulerUpdate() {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (this._rulerUpdatePending) return;
      this._rulerUpdatePending = true;
      const delay = (typeof window !== 'undefined' && window.isTimelinePlaying) ? 90 : 60;
      setTimeout(() => {
        this._rulerUpdatePending = false;
        this.updateRulerUI();
      }, delay);
    }

    async setFrameFromCanvas(frameIndex, sourceCanvas, isDraft = this.isDraftMode, compId = null) {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) return;
      const targetComp = compId || this.activeCompId;
      if (this.ensureAudioOnlyFullCache(null, targetComp)) return;
      const targetPool = this.getPool(targetComp);
      if (this.hasFrame(frameIndex, sourceCanvas.width, sourceCanvas.height, targetComp)) return;
      if (!this._pendingFrames) this._pendingFrames = new Set();
      if (!this._inFlightFrames) this._inFlightFrames = new Set();
      if (!this._frameGen) this._frameGen = new Map();
      const inFlightKey = `${targetComp}:${frameIndex}`;
      if (this._inFlightFrames.has(inFlightKey)) return;
      const maxInFlight = (this._isMobile || (this._devMem && this._devMem <= 4)) ? 12 : 24;
      if (this._inFlightFrames.size >= maxInFlight) return;
      const gen = (this._frameGen.get(inFlightKey) || 0) + 1;
      this._frameGen.set(inFlightKey, gen);
      this._pendingFrames.add(inFlightKey);
      this._inFlightFrames.add(inFlightKey);
      try {
        const srcW = sourceCanvas.width;
        const srcH = sourceCanvas.height;
        const maxDim = (this._isMobile || (this._devMem && this._devMem <= 4))
          ? (isDraft ? 540 : 720)
          : (isDraft ? 720 : 960);
        const maxSide = Math.max(srcW, srcH);
        let bitmap = null;
        if (maxSide > maxDim) {
          const scale = maxDim / maxSide;
          const targetW = Math.max(16, Math.round(srcW * scale));
          const targetH = Math.max(16, Math.round(srcH * scale));
          try {
            bitmap = await createImageBitmap(sourceCanvas, {
              resizeWidth: targetW,
              resizeHeight: targetH,
              resizeQuality: 'low'
            });
          } catch (_) {
            bitmap = await createImageBitmap(sourceCanvas);
          }
        } else {
          bitmap = await createImageBitmap(sourceCanvas);
        }
        // Re-check after await: frame may have been cleared/invalidated or superseded by a newer render
        if (!this._inFlightFrames.has(inFlightKey) || this._frameGen.get(inFlightKey) !== gen) {
          if (bitmap && typeof bitmap.close === 'function') {
            try { bitmap.close(); } catch (_) {}
          }
          return;
        }
        this.deleteFrame(frameIndex, false, targetComp);
        // Restore generation after deleteFrame
        this._frameGen.set(inFlightKey, gen);
        targetPool.set(frameIndex, {
          bitmap,
          isDraft,
          width: srcW,
          height: srcH
        });
        // Evict oldest frame if over limit (prevents browser OOM crash when full timeline is cached)
        this._evictIfNeeded(targetComp);
        // Throttled ruler update — updates green cache bar smoothly during playback & idle fill
        this._scheduleRulerUpdate();
      } catch (_) {}
      finally {
        if (this._frameGen && this._frameGen.get(inFlightKey) === gen) {
          if (this._pendingFrames) this._pendingFrames.delete(inFlightKey);
          if (this._inFlightFrames) this._inFlightFrames.delete(inFlightKey);
        }
      }
    }

    deleteFrame(frameIndex, updateUI = true, compId = null) {
      const targetComp = compId || this.activeCompId;
      const inFlightKey = `${targetComp}:${frameIndex}`;
      if (this._frameGen) {
        this._frameGen.set(inFlightKey, (this._frameGen.get(inFlightKey) || 0) + 1);
      }
      if (this._pendingFrames) {
        this._pendingFrames.delete(inFlightKey);
      }
      if (this._inFlightFrames) {
        this._inFlightFrames.delete(inFlightKey);
      }
      if (this._unreadyFrames) {
        this._unreadyFrames.delete(inFlightKey);
      }
      const pool = this.getPool(targetComp);
      const entry = pool.get(frameIndex);
      if (entry) {
        if (!entry.shared && entry.bitmap && typeof entry.bitmap.close === 'function') {
          try { entry.bitmap.close(); } catch (_) {}
        }
        pool.delete(frameIndex);
        if (updateUI && targetComp === this.activeCompId) {
          this.updateRulerUI();
        }
      }
    }

    /**
     * Selective Cache Invalidation (AE-style)
     * Invalidate only frames within [startSec, endSec] affected by a layer modification
     */
    invalidateRange(startSec, endSec, fps = this.fps, compId = null) {
      if (startSec === undefined || endSec === undefined) {
        this.clearAll('current', compId);
        return;
      }
      const targetComp = compId || this.activeCompId;
      this._lastAudioOnlyCacheKey = null;
      const pool = this.getPool(targetComp);
      const minSec = Math.max(0, Math.min(startSec, endSec));
      const maxSec = Math.max(startSec, endSec);
      const startFrame = Math.max(0, Math.floor(minSec * fps) - 1);
      const endFrame = Math.ceil(maxSec * fps) + 1;

      let changed = false;
      for (let f = startFrame; f <= endFrame; f++) {
        const inFlightKey = `${targetComp}:${f}`;
        if (this._frameGen) {
          this._frameGen.set(inFlightKey, (this._frameGen.get(inFlightKey) || 0) + 1);
        }
        if (this._pendingFrames && this._pendingFrames.has(inFlightKey)) {
          this._pendingFrames.delete(inFlightKey);
          changed = true;
        }
        if (this._inFlightFrames && this._inFlightFrames.has(inFlightKey)) {
          this._inFlightFrames.delete(inFlightKey);
          changed = true;
        }
        if (this._unreadyFrames && this._unreadyFrames.has(inFlightKey)) {
          this._unreadyFrames.delete(inFlightKey);
          changed = true;
        }
        if (pool.has(f)) {
          const entry = pool.get(f);
          if (entry && !entry.shared && entry.bitmap && typeof entry.bitmap.close === 'function') {
            try { entry.bitmap.close(); } catch (_) {}
          }
          pool.delete(f);
          changed = true;
        }
      }
      if (this.ensureAudioOnlyFullCache(null, targetComp)) {
        return;
      }
      if (!compId || compId === this.activeCompId) {
        this.updateRulerUI();
      }
      if (this.idleCacheEnabled) {
        this.scheduleIdleCheck();
      }
    }

    /**
     * Compute a layer's [startSec, endSec] timeline bounds reliably.
     */
    getLayerBounds(layer, pps = null) {
      if (!layer) return { startSec: 0, endSec: 5 };
      const effectivePps = pps || ((typeof window !== 'undefined' && window.currentPixelsPerSecond) ? window.currentPixelsPerSecond : 80);
      const startSec = layer.startSec !== undefined
        ? Number(layer.startSec) || 0
        : (parseFloat(layer.startPx ?? layer.left) || 0) / effectivePps;
      const durSec = layer.durationSec !== undefined
        ? Number(layer.durationSec) || 0
        : ((parseFloat(layer.widthPx ?? layer.width) || 240) / effectivePps);
      return {
        startSec: Math.max(0, startSec),
        endSec: Math.max(0, startSec + Math.max(0.01, durSec))
      };
    }

    /**
     * Invalidate cache specifically for a single layer (and any child layers if it is a parent/Null).
     */
    invalidateLayer(layer, compId = null) {
      if (!layer) {
        this.clearAll('current', compId);
        return;
      }
      if (!compId && typeof window !== 'undefined' && typeof window.invalidatePreviewCacheForLayer === 'function') {
        window.invalidatePreviewCacheForLayer(layer);
        return;
      }
      const { startSec, endSec } = this.getLayerBounds(layer);
      let minStart = startSec;
      let maxEnd = endSec;
      const layers = (typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers))
        ? window.currentProjectState.layers
        : [];
      if (layer.id && layers.length > 0) {
        const visited = new Set([layer.id]);
        let added = true;
        while (added) {
          added = false;
          for (let i = 0; i < layers.length; i++) {
            const l = layers[i];
            if (l && l.id && l.parentId && visited.has(l.parentId) && !visited.has(l.id)) {
              visited.add(l.id);
              const b = this.getLayerBounds(l);
              if (b.startSec < minStart) minStart = b.startSec;
              if (b.endSec > maxEnd) maxEnd = b.endSec;
              added = true;
            }
          }
        }
      }
      this.invalidateRange(minStart, maxEnd, this.fps, compId);
    }

    _fastObjectSig(obj) {
      if (!obj || typeof obj !== 'object') return String(obj ?? '');
      if (Array.isArray(obj)) {
        let s = '[' + obj.length + ':';
        for (let i = 0; i < obj.length; i++) {
          const item = obj[i];
          if (item && typeof item === 'object') {
            s += this._fastObjectSig(item) + ',';
          } else {
            s += String(item ?? '') + ',';
          }
        }
        return s + ']';
      }
      let s = '{';
      for (const k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        if (k.charCodeAt(0) === 95) continue;
        const v = obj[k];
        if (v && typeof v === 'object') {
          s += k + ':' + this._fastObjectSig(v) + ';';
        } else {
          s += k + ':' + String(v ?? '') + ';';
        }
      }
      return s + '}';
    }

    /**
     * Fast visual state signature for a layer to detect new layers, removed layers,
     * new effects, keyframe edits, expression changes, parenting, or transform changes.
     */
    getLayerSignature(layer, idx = 0) {
      if (!layer) return '';
      const { startSec, endSec } = this.getLayerBounds(layer);
      const fxSig = (Array.isArray(layer.effects) && layer.effects.length > 0) ? this._fastObjectSig(layer.effects) : '';
      const kfSig = (layer.keyframes && typeof layer.keyframes === 'object') ? this._fastObjectSig(layer.keyframes) : '';
      const exprSig = (layer.expressions && typeof layer.expressions === 'object') ? this._fastObjectSig(layer.expressions) : '';
      const trSig = (layer.timeRemap !== undefined) ? this._fastObjectSig(layer.timeRemap) : '';
      let subSig = '';
      if (Array.isArray(layer.subLayers) && layer.subLayers.length > 0) {
        subSig = `${layer.subLayers.length}:${layer.subLayers.map(s => s && s.id).join(',')}`;
      }
      const shapeSig = (layer.shapeProps && typeof layer.shapeProps === 'object') ? this._fastObjectSig(layer.shapeProps) : '';
      const textPropsSig = (layer.textProps && typeof layer.textProps === 'object') ? this._fastObjectSig(layer.textProps) : '';
      const maskSig = (layer.masks || layer.maskProps) ? (this._fastObjectSig(layer.masks) + '|' + this._fastObjectSig(layer.maskProps)) : '';

      return [
        idx,
        layer.id || '',
        layer.type || '',
        (layer.mediaId || layer.dataUrl || ''),
        layer.hidden ? 1 : 0,
        layer.locked ? 1 : 0,
        layer.aspectLocked ? 1 : 0,
        layer.isAdjustment ? 1 : 0,
        layer.isNull ? 1 : 0,
        layer.is3D ? 1 : 0,
        layer.blendMode || 'normal',
        layer.parentId || '',
        startSec.toFixed(4),
        endSec.toFixed(4),
        Number(layer.durationSec || (endSec - startSec) || 0).toFixed(4),
        Number(layer.sourceOffsetSec || 0).toFixed(4),
        Number(layer.posX ?? layer.x ?? 0).toFixed(2),
        Number(layer.posY ?? layer.y ?? 0).toFixed(2),
        Number(layer.posZ ?? layer.z ?? 0).toFixed(2),
        Number(layer.scaleW ?? layer.scaleX ?? layer.scale ?? 100).toFixed(2),
        Number(layer.scaleH ?? layer.scaleY ?? layer.scale ?? 100).toFixed(2),
        Number(layer.scaleZ ?? 100).toFixed(2),
        Number(layer.rotZ ?? layer.rotationZ ?? layer.rotation ?? 0).toFixed(2),
        Number(layer.rotX ?? layer.rotationX ?? 0).toFixed(2),
        Number(layer.rotY ?? layer.rotationY ?? 0).toFixed(2),
        Number(layer.rotation ?? layer.rotZ ?? 0).toFixed(2),
        Number(layer.skewX ?? 0).toFixed(2),
        Number(layer.skewY ?? 0).toFixed(2),
        Number(layer.anchorX ?? 0).toFixed(2),
        Number(layer.anchorY ?? 0).toFixed(2),
        Number(layer.anchorZ ?? 0).toFixed(2),
        Number(layer.opacity ?? 1).toFixed(3),
        Number(layer.roundness ?? (layer.shapeProps && layer.shapeProps.roundness) ?? 0).toFixed(2),
        Number(layer.speed ?? 1).toFixed(3),
        layer.speedMode || '',
        layer.fillType || (layer.shapeProps && layer.shapeProps.fillType) || '',
        layer.fillColor || layer.color || (layer.shapeProps && layer.shapeProps.fillColor) || '',
        layer.text || '',
        textPropsSig,
        shapeSig,
        maskSig,
        fxSig,
        kfSig,
        exprSig,
        trSig,
        subSig,
        layer.timeRemapEnabled ? 1 : 0,
        layer.isFrozen ? 1 : 0,
        Number(layer.freezeTime || 0).toFixed(3),
        (layer.motionBlur || layer.mblur) ? 1 : 0,
        layer.trackMatte || ''
      ].join('|');
    }

    /**
     * Capture a lightweight snapshot of all current layers before an extension/tool runs.
     */
    captureStateSnapshot(layers = null) {
      const list = Array.isArray(layers)
        ? layers
        : ((typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers))
            ? window.currentProjectState.layers
            : []);
      const map = new Map();
      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        if (!l) continue;
        const key = l.id || `__idx_${i}`;
        const bounds = this.getLayerBounds(l);
        map.set(key, {
          startSec: bounds.startSec,
          endSec: bounds.endSec,
          parentId: l.parentId || null,
          sig: this.getLayerSignature(l, i)
        });
      }
      return map;
    }

    /**
     * Compare a pre-action snapshot with current layers and selectively invalidate ONLY
     * the time ranges [startSec, endSec] where layers were added, removed, or modified
     * (new adjustment layer, new Null layer, new effect, keyframes, expressions, etc.).
     * Returns true if any range was invalidated.
     */
    invalidateSmartDiff(beforeSnapshot, afterLayers = null, compId = null, precomputedSnapshot = null) {
      const list = Array.isArray(afterLayers)
        ? afterLayers
        : ((typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers))
            ? window.currentProjectState.layers
            : []);
      if (!(beforeSnapshot instanceof Map)) {
        return false;
      }

      const ranges = [];
      const changedLayers = [];
      const changedLayerIds = new Set();
      const seenKeys = new Set();

      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        if (!l) continue;
        const key = l.id || `__idx_${i}`;
        seenKeys.add(key);
        const currentEntry = (precomputedSnapshot instanceof Map) ? precomputedSnapshot.get(key) : null;
        const nowBounds = currentEntry ? { startSec: currentEntry.startSec, endSec: currentEntry.endSec } : this.getLayerBounds(l);
        const nowSig = currentEntry ? currentEntry.sig : this.getLayerSignature(l, i);
        const prev = beforeSnapshot.get(key);
        if (!prev) {
          // Newly added layer (e.g., Adjustment layer, Null layer, Solid, Shape, Precomp)
          ranges.push({ startSec: nowBounds.startSec, endSec: nowBounds.endSec });
          changedLayers.push(l);
          if (l.id) changedLayerIds.add(l.id);
        } else if (prev.sig !== nowSig) {
          // Layer modified (e.g., new effect, keyframes, expressions, split, trim, parentId)
          ranges.push({
            startSec: Math.min(prev.startSec, nowBounds.startSec),
            endSec: Math.max(prev.endSec, nowBounds.endSec)
          });
          changedLayers.push(l);
          if (l.id) changedLayerIds.add(l.id);
        }
      }

      // Check removed layers
      for (const [key, prev] of beforeSnapshot.entries()) {
        if (!seenKeys.has(key)) {
          ranges.push({ startSec: prev.startSec, endSec: prev.endSec });
          changedLayerIds.add(key);
        }
      }

      // Propagate to child layers if a parent/Null layer was added or modified
      if (changedLayerIds.size > 0 && list.length > 0) {
        let added = true;
        while (added) {
          added = false;
          for (let i = 0; i < list.length; i++) {
            const l = list[i];
            if (l && l.id && l.parentId && changedLayerIds.has(l.parentId) && !changedLayerIds.has(l.id)) {
              changedLayerIds.add(l.id);
              changedLayers.push(l);
              const b = this.getLayerBounds(l);
              ranges.push({ startSec: b.startSec, endSec: b.endSec });
              added = true;
            }
          }
        }
      }

      if (ranges.length === 0) return false;

      for (let i = 0; i < changedLayers.length; i++) {
        const l = changedLayers[i];
        if (l) {
          l._shapeDirty = true;
          l._fillDirty = true;
          if (l._shapeBufferCanvas) l._shapeBufferCanvas._lastShapeKey = null;
          if (l._fillBufferCanvas) l._fillBufferCanvas._lastRenderKey = null;
          if (l._precompBufferCanvas) l._precompBufferCanvas._lastRenderKey = null;
          l._textDirty = true;
          if (l._textBufferCanvas) l._textBufferCanvas._lastRenderKey = null;
          if (l._textMbCanvas) l._textMbCanvas._lastRenderKey = null;
        }
      }

      if (!compId && typeof window !== 'undefined' && typeof window.invalidatePreviewCacheForLayer === 'function') {
        for (let i = 0; i < changedLayers.length; i++) {
          window.invalidatePreviewCacheForLayer(changedLayers[i]);
        }
      }

      for (let i = 0; i < ranges.length; i++) {
        this.invalidateRange(ranges[i].startSec, ranges[i].endSec, this.fps, compId);
      }
      if (typeof window !== 'undefined' && typeof window.invalidateEffectivePropsCache === 'function') {
        window.invalidateEffectivePropsCache();
      }
      return true;
    }

    clearAll(scope = 'current', compId = null) {
      this._lastAudioOnlyCacheKey = null;
      if (this._frameGen) {
        this._frameGen.clear();
      }
      if (this._pendingFrames) {
        this._pendingFrames.clear();
      }
      // Cancel all in-flight bitmap encodes so stale frames don't re-appear after clear
      if (this._inFlightFrames) {
        this._inFlightFrames.clear();
      }
      if (this._unreadyFrames) {
        this._unreadyFrames.clear();
      }
      const closedBitmaps = new Set();
      if (scope === 'all') {
        for (const pool of this.pools.values()) {
          for (const entry of pool.values()) {
            if (entry && entry.bitmap && !closedBitmaps.has(entry.bitmap) && typeof entry.bitmap.close === 'function') {
              closedBitmaps.add(entry.bitmap);
              try { entry.bitmap.close(); } catch (_) {}
            }
          }
          pool.clear();
        }
      } else {
        const pool = this.getPool(compId || this.activeCompId);
        for (const entry of pool.values()) {
          if (entry && entry.bitmap && !closedBitmaps.has(entry.bitmap) && typeof entry.bitmap.close === 'function') {
            closedBitmaps.add(entry.bitmap);
            try { entry.bitmap.close(); } catch (_) {}
          }
        }
        pool.clear();
      }
      if (this.ensureAudioOnlyFullCache(null, compId || this.activeCompId)) {
        return;
      }
      this.updateRulerUI();
      if (this.idleCacheEnabled) {
        this.scheduleIdleCheck();
      }
    }

    clearCompCache(compId = null) {
      this.clearAll('current', compId || this.activeCompId);
    }

    /**
     * Automatic state-change detection and cache synchronization with project state.
     * Detects project-level changes (dimensions, fps, bgColor) and layer-level modifications.
     */
    syncStateWithProject(projectState = null, compId = null) {
      const ps = projectState || (typeof window !== 'undefined' ? window.currentProjectState : null);
      if (!ps || !Array.isArray(ps.layers)) return false;
      const targetComp = compId || this.activeCompId || 'root';

      if (!this._lastKnownCompFingerprints) this._lastKnownCompFingerprints = new Map();
      if (!this._lastKnownLayerSnapshots) this._lastKnownLayerSnapshots = new Map();

      const fps = ps.fps || 60;
      const baseW = ps._baseW || ps.baseW || ps.width || (typeof window !== 'undefined' && typeof window.getProjectDimensions === 'function' && ps.resolution && ps.aspectRatio ? window.getProjectDimensions(ps.resolution, ps.aspectRatio)[0] : 0);
      const baseH = ps._baseH || ps.baseH || ps.height || (typeof window !== 'undefined' && typeof window.getProjectDimensions === 'function' && ps.resolution && ps.aspectRatio ? window.getProjectDimensions(ps.resolution, ps.aspectRatio)[1] : 0);
      const resolution = ps.resolution || `${baseW}x${baseH}`;
      const aspectRatio = ps.aspectRatio || '';
      const bgColor = ps.bgColor || '';
      const motionBlur = (ps.motionBlur && ps.motionBlur.enabled) ? 1 : 0;
      const layers = (targetComp === 'root' || !targetComp)
        ? (ps.layers || [])
        : ((window.currentActivePrecomp && Array.isArray(window.currentActivePrecomp.layers))
          ? window.currentActivePrecomp.layers
          : (ps.layers || []));

      const layerOrderSig = layers.map(l => (l && l.id) || '').join(',');
      const compFingerprint = `${fps}|${baseW}|${baseH}|${resolution}|${aspectRatio}|${bgColor}|${motionBlur}|${layers.length}|${layerOrderSig}`;
      const prevCompFingerprint = this._lastKnownCompFingerprints.get(targetComp);

      let compChanged = false;
      if (prevCompFingerprint && prevCompFingerprint !== compFingerprint) {
        this.clearAll('current', targetComp);
        compChanged = true;
      }
      this._lastKnownCompFingerprints.set(targetComp, compFingerprint);

      const prevSnapshot = this._lastKnownLayerSnapshots.get(targetComp);
      const currentSnapshot = this.captureStateSnapshot(layers);
      this._lastKnownLayerSnapshots.set(targetComp, currentSnapshot);

      if (!prevSnapshot) {
        this.ensureAudioOnlyFullCache(ps, targetComp);
        return compChanged;
      }

      const diffInvalidated = this.invalidateSmartDiff(prevSnapshot, layers, targetComp, currentSnapshot);
      if (compChanged || diffInvalidated) {
        if (this._unreadyFrames) this._unreadyFrames.clear();
      }
      this.ensureAudioOnlyFullCache(ps, targetComp);
      return compChanged || diffInvalidated;
    }

    invalidateAll() {
      return this.clearAll('all');
    }

    clearPool(compId) {
      if (compId) {
        this.deletePool(compId);
      }
      this.clearAll('all');
    }

    clear() {
      this.clearAll('all');
    }

    /**
     * Precompose frames are preserved in their own pool (PreviewCacheManager.getPool(layer.id))
     * and drawn directly via renderPrecompToCanvas without mass createImageBitmap cloning.
     */
    adoptPrecompFrames(precompLayer, parentCompId = 'root') {
      this.updateRulerUI();
    }

    adoptRootFrames(precompLayer, rootCompId = 'root') {
      this.updateRulerUI();
    }

    updateRulerUI() {
      if (this._rulerRafScheduled) return;
      this._rulerRafScheduled = true;
      const schedule = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
      schedule(() => {
        this._rulerRafScheduled = false;
        this._renderRuler();
      });
    }

    _renderRuler() {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (!this.rulerCanvas) {
        this.rulerCanvas = document.getElementById('timeline-cache-ruler-bar');
        if (this.rulerCanvas) this.rulerCtx = this.rulerCanvas.getContext('2d');
      }
      if (!this.rulerCanvas || !this.rulerCtx) return;

      const pps = window.currentPixelsPerSecond || 80;
      const totalDur = (typeof window.getProjectTotalDuration === 'function') ? window.getProjectTotalDuration() : 0;
      const trackWidth = Math.ceil(totalDur * pps);

      if (this.rulerCanvas.width !== trackWidth || this.rulerCanvas.height !== 3) {
        this.rulerCanvas.width = Math.max(1, trackWidth);
        this.rulerCanvas.height = 3;
        this.rulerCanvas.style.width = trackWidth + 'px';
        this.rulerCanvas.style.height = '3px';
      }

      this.rulerCtx.clearRect(0, 0, this.rulerCanvas.width, 3);
      if (totalDur <= 0 || this.frames.size === 0 || window.isPreviewCacheEnabled === false) return;

      if (!this._cachedPrimaryColor || (Date.now() - (this._lastColorQuery || 0) > 3000)) {
        this._cachedPrimaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#98ce7b';
        this._lastColorQuery = Date.now();
      }
      this.rulerCtx.fillStyle = this._cachedPrimaryColor;

      const pxPerFrame = pps / this.fps;
      const totalFrames = Math.ceil(totalDur * this.fps);

      let runStart = -1;
      for (let f = 0; f <= totalFrames; f++) {
        // Strict cache check: only paint real cached frames to prevent false-green stutter
        const isCached = this.frames.has(f);
        if (isCached) {
          if (runStart === -1) runStart = f;
        } else {
          if (runStart !== -1) {
            const x = Math.floor(runStart * pxPerFrame);
            const xEnd = Math.ceil(f * pxPerFrame);
            const w = Math.max(1, xEnd - x);
            this.rulerCtx.fillRect(x, 0, w, 3);
            runStart = -1;
          }
        }
      }
      if (runStart !== -1) {
        const x = Math.floor(runStart * pxPerFrame);
        const xEnd = Math.ceil(totalFrames * pxPerFrame);
        const w = Math.max(1, xEnd - x);
        this.rulerCtx.fillRect(x, 0, w, 3);
      }
    }

    setupUserActivityListeners() {
      const onActivity = () => {
        this.lastUserActivity = Date.now();
        if (this.isIdleRunning) {
          this.stopIdleWorker();
        }
        if (this.idleCacheEnabled) {
          this.scheduleIdleCheck();
        }
      };

      const onPointerMove = (e) => {
        // Only interrupt idle cache on active drag/scrubbing (buttons > 0), not passive mouse hover
        if (e && (e.buttons > 0 || window.isTimelineScrubbing || window.isTimelinePanning || window.isTransformInteracting)) {
          onActivity();
        }
      };

      window.addEventListener('pointerdown', onActivity, { passive: true });
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('keydown', onActivity, { passive: true });
      window.addEventListener('wheel', onActivity, { passive: true });
      window.addEventListener('scroll', onActivity, { passive: true });
    }

    scheduleIdleCheck(immediate = false) {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (this.ensureAudioOnlyFullCache()) return;
      if (!this.idleCacheEnabled) return;
      if (this.idleTimer) clearTimeout(this.idleTimer);
      const delay = immediate ? 40 : 280;
      this.idleTimer = setTimeout(() => {
        if (typeof window !== 'undefined' && window.isExporting) return;
        if (this.ensureAudioOnlyFullCache()) return;
        if (!this.idleCacheEnabled) return;
        if (window.isTimelinePlaying || window.isTransformInteracting) return;
        if (document.querySelector('.modal-backdrop.is-open, .modal-backdrop.active')) return;
        this.startIdleWorker();
      }, delay);
    }

    /**
     * Force immediate background recache for a specific time range or whole active composition
     */
    forceRecache(startSec = null, endSec = null) {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (startSec !== null && endSec !== null && isFinite(startSec) && isFinite(endSec)) {
        this.invalidateRange(startSec, endSec);
      } else {
        this.clearAll('current');
      }
      if (this.ensureAudioOnlyFullCache()) return;
      this.idleCacheEnabled = true;
      this.stopIdleWorker();
      this.scheduleIdleCheck(true);
    }

    startIdleWorker() {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (this.ensureAudioOnlyFullCache()) return;
      if (this.isIdleRunning || !this.idleCacheEnabled || window.isTimelinePlaying || window.isTransformInteracting) return;
      this.isIdleRunning = true;
      this.runIdleStep();
    }

    stopIdleWorker() {
      this.isIdleRunning = false;
      if (this.idleWorkerId) {
        clearTimeout(this.idleWorkerId);
        this.idleWorkerId = null;
      }
    }

    isTimeReadyToCache(sec, projectState = null) {
      const ps = projectState || ((typeof window !== 'undefined' && window.currentProjectState) ? window.currentProjectState : null);
      if (!ps || !Array.isArray(ps.layers)) return true;
      const targetComp = this.activeCompId || 'root';
      const layers = (targetComp === 'root' || !targetComp)
        ? (ps.layers || [])
        : ((window.currentActivePrecomp && Array.isArray(window.currentActivePrecomp.layers))
          ? window.currentActivePrecomp.layers
          : (ps.layers || []));
      const pps = (typeof window !== 'undefined' && window.currentPixelsPerSecond) ? window.currentPixelsPerSecond : 80;
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        if (!l || l.hidden) continue;
        const start = l.startSec !== undefined ? Number(l.startSec) : ((l.startPx || 0) / pps);
        const dur = l.durationSec !== undefined ? Number(l.durationSec) : ((l.widthPx || 240) / pps);
        if (sec >= start && sec < start + dur) {
          if (l.type === 'video' || l.mediaType === 'video') {
            if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.isVideoFrameReady === 'function') {
              if (!window.VideoFrameExtractor.isVideoFrameReady(l, sec)) return false;
            } else {
              return false;
            }
          }
          if (l.type === 'precomp' && Array.isArray(l.layers)) {
            if (!l.collapseTransformations && window.VideoFrameExtractor && typeof window.VideoFrameExtractor.isVideoFrameReady === 'function') {
              if (window.VideoFrameExtractor.isVideoFrameReady(l, sec)) continue;
            }
            const precompTime = (sec - start) * (l.speed || 1.0) + (l.sourceOffsetSec || 0);
            for (let j = 0; j < l.layers.length; j++) {
              const sub = l.layers[j];
              if (!sub || sub.hidden) continue;
              const subStart = sub.startSec !== undefined ? Number(sub.startSec) : 0;
              const subDur = sub.durationSec !== undefined ? Number(sub.durationSec) : 5;
              if (precompTime >= subStart && precompTime < subStart + subDur) {
                if (sub.type === 'video' || sub.mediaType === 'video') {
                  if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.isVideoFrameReady === 'function') {
                    if (!window.VideoFrameExtractor.isVideoFrameReady(sub, precompTime)) return false;
                  } else {
                    return false;
                  }
                }
              }
            }
          }
        }
      }
      return true;
    }

    runIdleStep() {
      if (typeof window !== 'undefined' && window.isExporting) {
        this.stopIdleWorker();
        return;
      }
      if (!this.isIdleRunning || !this.idleCacheEnabled || window.isTimelinePlaying || window.isTransformInteracting) {
        this.stopIdleWorker();
        return;
      }

      const totalDur = (typeof window.getProjectTotalDuration === 'function') ? window.getProjectTotalDuration() : 0;
      if (totalDur <= 0) {
        this.stopIdleWorker();
        return;
      }

      if (this.ensureAudioOnlyFullCache()) {
        this.stopIdleWorker();
        return;
      }

      const activeCanvas = (typeof document !== 'undefined') ? document.getElementById('editor-active-canvas') : null;
      if (!activeCanvas || activeCanvas.width === 0 || activeCanvas.height === 0) {
        this.stopIdleWorker();
        return;
      }

      const currentFps = this.fps || 60;
      const totalFrames = Math.ceil(totalDur * currentFps);
      const pps = window.currentPixelsPerSecond || 80;
      const currentPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
      const currentFrame = Math.max(0, Math.min(totalFrames, Math.round((Math.abs(currentPanX) / pps) * currentFps)));

      const targetComp = this.activeCompId || 'root';
      const memCap = this.maxFrames || Math.round(60 * currentFps);
      const effectiveMax = Math.min(memCap, totalFrames + 1);
      if (this.frames.size >= effectiveMax) {
        this.stopIdleWorker();
        return;
      }

      // Compute active window around playhead so idle worker never caches more frames than maxFrames
      let winStart = 0;
      let winEnd = totalFrames;
      if (totalFrames + 1 > memCap) {
        const fwdAllowance = Math.floor(memCap * 0.75);
        const bwdAllowance = memCap - fwdAllowance - 1;
        winStart = Math.max(0, currentFrame - bwdAllowance);
        winEnd = Math.min(totalFrames, winStart + memCap - 1);
        if (winEnd === totalFrames) {
          winStart = Math.max(0, totalFrames - memCap + 1);
        }
      }

      const maxInFlight = (this._isMobile || (this._devMem && this._devMem <= 4)) ? 8 : 16;
      if (this._inFlightFrames && this._inFlightFrames.size >= maxInFlight) {
        this.idleWorkerId = setTimeout(() => this.runIdleStep(), 16);
        return;
      }

      // Prepare offscreen canvas capped to preview cache resolution for rapid 60fps rendering
      if (!this.offscreenCanvas) {
        this.offscreenCanvas = document.createElement('canvas');
      }
      const maxDim = (this._isMobile || (this._devMem && this._devMem <= 4))
        ? (this.isDraftMode ? 540 : 720)
        : (this.isDraftMode ? 720 : 960);
      const srcW = activeCanvas.width;
      const srcH = activeCanvas.height;
      const maxSide = Math.max(srcW, srcH);
      const scale = maxSide > maxDim ? (maxDim / maxSide) : 1.0;
      const targetW = Math.max(16, Math.round(srcW * scale));
      const targetH = Math.max(16, Math.round(srcH * scale));
      if (this.offscreenCanvas.width !== targetW || this.offscreenCanvas.height !== targetH) {
        this.offscreenCanvas.width = targetW;
        this.offscreenCanvas.height = targetH;
      }

      const stepStartMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const timeBudgetMs = (this._isMobile || (this._devMem && this._devMem <= 4)) ? 4.5 : 7.5;
      const maxFramesPerStep = (this._isMobile || (this._devMem && this._devMem <= 4)) ? 2 : 4;
      let renderedInStep = 0;

      while (renderedInStep < maxFramesPerStep) {
        if (!this.isIdleRunning || !this.idleCacheEnabled || window.isTimelinePlaying || window.isTransformInteracting) {
          this.stopIdleWorker();
          return;
        }
        if (this._inFlightFrames && this._inFlightFrames.size >= maxInFlight) {
          break;
        }

        let targetFrame = -1;
        let sawUnreadyOrInFlight = false;

        // Pass 1: Contiguous forward from playhead to end of active window
        for (let f = currentFrame; f <= winEnd; f++) {
          if (!this.frames.has(f)) {
            const inFlightKey = `${targetComp}:${f}`;
            const isInFlight = !!(this._inFlightFrames && this._inFlightFrames.has(inFlightKey));
            const isMarkedUnready = !!(this._unreadyFrames && this._unreadyFrames.has(inFlightKey));
            if (!isInFlight && !isMarkedUnready && this.isTimeReadyToCache(f / currentFps)) {
              targetFrame = f;
              break;
            }
            sawUnreadyOrInFlight = true;
          }
        }

        // Pass 2: Contiguous from winStart up to playhead
        if (targetFrame === -1) {
          for (let f = winStart; f < currentFrame; f++) {
            if (!this.frames.has(f)) {
              const inFlightKey = `${targetComp}:${f}`;
              const isInFlight = !!(this._inFlightFrames && this._inFlightFrames.has(inFlightKey));
              const isMarkedUnready = !!(this._unreadyFrames && this._unreadyFrames.has(inFlightKey));
              if (!isInFlight && !isMarkedUnready && this.isTimeReadyToCache(f / currentFps)) {
                targetFrame = f;
                break;
              }
              sawUnreadyOrInFlight = true;
            }
          }
        }

        if (targetFrame === -1) {
          if (sawUnreadyOrInFlight) {
            if (this._unreadyFrames) this._unreadyFrames.clear();
            this.idleWorkerId = setTimeout(() => this.runIdleStep(), 80);
            return;
          }
          this.stopIdleWorker();
          return;
        }

        const inFlightKey = `${targetComp}:${targetFrame}`;
        const targetSec = targetFrame / currentFps;
        let isFrameReady = true;
        if (typeof window.renderCanvasFrame === 'function') {
          const res = window.renderCanvasFrame(
            this.offscreenCanvas,
            window.currentProjectState ? window.currentProjectState.bgColor : 'transparent',
            this.offscreenCanvas.width,
            this.offscreenCanvas.height,
            'idle-cache',
            targetSec
          );
          if (res === false) isFrameReady = false;
        }

        if (isFrameReady) {
          this.setFrameFromCanvas(targetFrame, this.offscreenCanvas, this.isDraftMode);
          renderedInStep++;
        } else {
          if (!this._unreadyFrames) this._unreadyFrames = new Set();
          this._unreadyFrames.add(inFlightKey);
        }

        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if ((nowMs - stepStartMs) >= timeBudgetMs) {
          break;
        }
      }

      if (this.isIdleRunning) {
        this.idleWorkerId = setTimeout(() => this.runIdleStep(), 4);
      }
    }

    /**
     * Precomposition background prebake removed to eliminate severe playback and timeline lag.
     */
    prebakePrecomp(layer) {}

    cancelPrecompPrebake(layerId) {}

    prebakeAllPrecomps(layers) {}

    /**
     * Look-Ahead Playback Caching
     * Pre-renders frames AHEAD of the current playhead into the cache during playback.
     * Triggered from stepPlay after each rendered frame.
     * @param {number} fromSec  - current playhead position in seconds
     * @param {number} fps      - project fps
     */
    startLookaheadWorker(fromSec, fps) {
      // Disabled during active playback: concurrent lookahead on single JS thread
      // starves requestAnimationFrame and causes severe stutter/dropped frames.
      // Caching is handled passively during playback and actively during idle/pause via runIdleStep().
      return;
    }

    stopLookaheadWorker() {
      this._lookaheadCancelled = true;
      this._lookaheadRunning   = false;
      if (this._lookaheadPort) {
        this._lookaheadPort.onmessage = null;
        this._lookaheadPort = null;
      }
      if (this._lookaheadTimer) {
        clearTimeout(this._lookaheadTimer);
        this._lookaheadTimer = null;
      }
    }
  }

  window.PreviewCacheManager = new PreviewCacheManager();
})(window);