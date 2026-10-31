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
      this._compVisualIntervals = new Map();
      this._compVoidIntervals = new Map();
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
      let totalDur = 0;
      if (typeof window !== 'undefined') {
        if (typeof window.getProjectTotalDuration === 'function') {
          totalDur = window.getProjectTotalDuration();
        } else if (window.currentProjectState && typeof window.currentProjectState.duration === 'number') {
          totalDur = window.currentProjectState.duration;
        }
      }
      const projectFrames = totalDur > 0 ? Math.ceil(totalDur * fps) : Math.round(60 * fps);
      // Adapt dynamically to project duration so entire timeline can be cached without premature eviction,
      // adding buffer headroom so boundary frames are never pruned.
      return Math.max(projectFrames + 120, Math.round(60 * fps));
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
        this.rebuildOccupancyIntervals(null, target);
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
      this._bindBakingListeners();
      const savedIdle = typeof localStorage !== 'undefined' ? localStorage.getItem('oft_idle_cache') === 'true' : false;
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

    /**
     * Determine if a layer produces visual output on canvas.
     */
    isVisualLayer(layer) {
      if (!layer || layer.hidden) return false;
      const t = (layer.type || layer.mediaType || '').toLowerCase();
      if (t === 'audio' || t === 'null' || layer.isNull) return false;
      if (t === 'camera') return false;
      if (t === 'precomp') {
        let childLayers = layer.layers;
        if ((!Array.isArray(childLayers) || childLayers.length === 0) && layer.mediaId) {
          const ps = this._resolveProjectState();
          if (ps && Array.isArray(ps.layers)) {
            const sibling = ps.layers.find(l => l && l.id !== layer.id && l.mediaId === layer.mediaId && Array.isArray(l.layers) && l.layers.length > 0);
            if (sibling) childLayers = sibling.layers;
          }
        }
        if (!Array.isArray(childLayers) || childLayers.length === 0) return false;
        return childLayers.some(child => this.isVisualLayer(child));
      }
      return true;
    }

    _purgeAudioOnlyEntries(compId = null) {
      const targetComp = compId || this.activeCompId || 'root';
      const pool = this.getPool(targetComp);
      let purged = false;
      for (const [fIdx, entry] of pool.entries()) {
        if (entry && entry.isAudioOnly) {
          pool.delete(fIdx);
          purged = true;
        }
      }
      if (purged) {
        this._lastAudioOnlyCacheKey = null;
      }
      return purged;
    }

    _resolveProjectState(projectState = null) {
      if (projectState) return projectState;
      const winPs = (typeof window !== 'undefined') ? window.currentProjectState : null;
      if (winPs && Array.isArray(winPs.layers) && winPs.layers.length > 0) {
        return winPs;
      }
      if (winPs && winPs !== this._lastWindowProjectState) {
        return winPs;
      }
      return this._lastProjectState || winPs || null;
    }

    _computeOccupancyKey(projectState = null, compId = null) {
      const ps = this._resolveProjectState(projectState);
      const targetComp = compId || this.activeCompId || 'root';
      const totalDur = (typeof window !== 'undefined' && typeof window.getProjectTotalDuration === 'function')
        ? window.getProjectTotalDuration()
        : ((ps && typeof ps.duration === 'number' && ps.duration > 0) ? ps.duration : 60);
      if (!ps || !Array.isArray(ps.layers) || ps.layers.length === 0) {
        return `empty|${totalDur}`;
      }
      const layers = (targetComp === 'root' || !targetComp)
        ? (ps.layers || [])
        : ((typeof window !== 'undefined' && window.currentActivePrecomp && Array.isArray(window.currentActivePrecomp.layers))
          ? window.currentActivePrecomp.layers
          : (ps.layers || []));
      const pps = (typeof window !== 'undefined' && window.currentPixelsPerSecond) ? window.currentPixelsPerSecond : 80;
      let key = `${layers.length}|${totalDur}|${pps}`;
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        if (!l) continue;
        const vis = this.isVisualLayer(l) ? 1 : 0;
        const hid = l.hidden ? 1 : 0;
        const s = l.startSec !== undefined ? l.startSec : '';
        const d = l.durationSec !== undefined ? l.durationSec : '';
        const spx = l.startPx !== undefined ? l.startPx : '';
        const wpx = l.widthPx !== undefined ? l.widthPx : '';
        key += `;${l.id || i}:${vis}:${hid}:${s}:${d}:${spx}:${wpx}`;
      }
      return key;
    }

    _ensureOccupancySynced(projectState = null, compId = null) {
      const targetComp = compId || this.activeCompId || 'root';
      if (!this._compOccupancyKeys) this._compOccupancyKeys = new Map();
      const key = this._computeOccupancyKey(projectState, targetComp);
      if (
        this._compOccupancyKeys.get(targetComp) !== key ||
        !this._compVisualIntervals ||
        !this._compVisualIntervals.has(targetComp) ||
        !this._compVoidIntervals ||
        !this._compVoidIntervals.has(targetComp)
      ) {
        this.rebuildOccupancyIntervals(projectState, targetComp);
      }
    }

    /**
     * Compute disjoint visual intervals and complementary void intervals for the composition.
     */
    rebuildOccupancyIntervals(projectState = null, compId = null) {
      const ps = this._resolveProjectState(projectState);
      const targetComp = compId || this.activeCompId || 'root';
      if (!this._compVisualIntervals) this._compVisualIntervals = new Map();
      if (!this._compVoidIntervals) this._compVoidIntervals = new Map();
      if (!this._compOccupancyKeys) this._compOccupancyKeys = new Map();
      this._compOccupancyKeys.set(targetComp, this._computeOccupancyKey(ps, targetComp));

      const totalDur = (typeof window !== 'undefined' && typeof window.getProjectTotalDuration === 'function')
        ? window.getProjectTotalDuration()
        : ((ps && typeof ps.duration === 'number' && ps.duration > 0) ? ps.duration : 60);

      if (!ps || !Array.isArray(ps.layers) || ps.layers.length === 0) {
        this._compVisualIntervals.set(targetComp, []);
        this._compVoidIntervals.set(targetComp, []);
        return;
      }

      const layers = (targetComp === 'root' || !targetComp)
        ? (ps.layers || [])
        : ((typeof window !== 'undefined' && window.currentActivePrecomp && Array.isArray(window.currentActivePrecomp.layers))
          ? window.currentActivePrecomp.layers
          : (ps.layers || []));

      const currentFps = this.fps || 60;
      const seamMergeTolerance = 3.0 / currentFps;
      const minVoidSpanSec = 3.0 / currentFps;
      const pps = (typeof window !== 'undefined' && window.currentPixelsPerSecond) ? window.currentPixelsPerSecond : 80;
      const rawIntervals = [];
      let hasActiveAudio = false;

      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        if (!l || l.hidden) continue;
        const t = (l.type || l.mediaType || '').toLowerCase();
        if (t === 'audio') {
          hasActiveAudio = true;
          continue;
        }
        if (!this.isVisualLayer(l)) continue;
        const b = this.getLayerBounds(l, pps);
        if (b.endSec > b.startSec) {
          let vStart = Math.max(0, b.startSec);
          let vEnd = Math.max(0, b.endSec);
          if (l.startPx !== undefined && l.widthPx !== undefined && pps > 0) {
            const pxS = Number(l.startPx) / pps;
            const pxE = (Number(l.startPx) + Number(l.widthPx)) / pps;
            if (Math.abs(pxS - b.startSec) < 0.1) vStart = Math.max(0, Math.min(vStart, pxS));
            if (Math.abs(pxE - b.endSec) < 0.1) vEnd = Math.max(vEnd, pxE);
          }
          rawIntervals.push([vStart, vEnd]);
        }
      }

      if (rawIntervals.length === 0) {
        this._compVisualIntervals.set(targetComp, []);
        this._compVoidIntervals.set(targetComp, hasActiveAudio ? [[0, Math.max(0.1, totalDur)]] : []);
        return;
      }

      // As soon as any visual layer exists in this composition, purge any full-timeline audio-only entries
      this._purgeAudioOnlyEntries(targetComp);

      // Merge overlapping or adjacent visual intervals (including <= 3-frame cut/snap seams)
      rawIntervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const mergedVisual = [];
      let cur = [rawIntervals[0][0], rawIntervals[0][1]];

      for (let i = 1; i < rawIntervals.length; i++) {
        const next = rawIntervals[i];
        if (next[0] <= cur[1] + seamMergeTolerance) {
          cur[1] = Math.max(cur[1], next[1]);
        } else {
          mergedVisual.push(cur);
          cur = [next[0], next[1]];
        }
      }
      mergedVisual.push(cur);
      this._compVisualIntervals.set(targetComp, mergedVisual);

      // Compute complement void intervals across [0, totalDur] where no visual layer exists
      const voidIntervals = [];
      let cursor = 0;

      for (let i = 0; i < mergedVisual.length; i++) {
        const span = mergedVisual[i];
        if (span[0] - cursor >= minVoidSpanSec) {
          voidIntervals.push([cursor, span[0]]);
        }
        cursor = Math.max(cursor, span[1]);
      }
      if (totalDur - cursor >= minVoidSpanSec) {
        voidIntervals.push([cursor, totalDur]);
      }
      this._compVoidIntervals.set(targetComp, voidIntervals);

      // Purge any stale rendered frames sitting strictly inside newly exposed void intervals
      const framePad = 1.5 / currentFps;
      const pool = this.getPool(targetComp);
      if (pool && pool.size > 0 && voidIntervals.length > 0) {
        for (const fIdx of Array.from(pool.keys())) {
          const fSec = fIdx / currentFps;
          for (let i = 0; i < voidIntervals.length; i++) {
            const vStart = voidIntervals[i][0] > 0 ? voidIntervals[i][0] + framePad : 0;
            const vEnd = voidIntervals[i][1] < totalDur - 0.001 ? voidIntervals[i][1] - framePad : voidIntervals[i][1];
            if (vEnd > vStart && fSec >= vStart && fSec <= vEnd) {
              const entry = pool.get(fIdx);
              if (entry && !entry.shared && entry.bitmap && typeof entry.bitmap.close === 'function') {
                try { entry.bitmap.close(); } catch (_) {}
              }
              pool.delete(fIdx);
              break;
            }
          }
        }
      }
    }

    /**
     * Fast check if a timestamp has active visual content in the active composition.
     */
    hasActiveVisualContentAt(sec, compId = null) {
      const targetComp = compId || this.activeCompId || 'root';
      this._ensureOccupancySynced(null, targetComp);
      const intervals = this._compVisualIntervals.get(targetComp);
      if (!intervals || intervals.length === 0) return false;
      for (let i = 0; i < intervals.length; i++) {
        const span = intervals[i];
        if (sec >= span[0] && sec < span[1]) {
          return true;
        }
        if (span[0] > sec) break;
      }
      return false;
    }

    /**
     * Fast check if a timestamp falls within a genuine void interval (empty canvas / audio-only span),
     * keeping a 1.5-frame safety margin away from any visual clip's start/end boundary ("di ujung-ujung").
     */
    isTimeInVoidSpan(sec, compId = null) {
      const targetComp = compId || this.activeCompId || 'root';
      this._ensureOccupancySynced(null, targetComp);
      const voids = this._compVoidIntervals ? this._compVoidIntervals.get(targetComp) : null;
      if (!voids || voids.length === 0) return false;
      const currentFps = this.fps || 60;
      const framePad = 1.5 / currentFps;
      const ps = this._resolveProjectState();
      const totalDur = (typeof window !== 'undefined' && typeof window.getProjectTotalDuration === 'function')
        ? window.getProjectTotalDuration()
        : ((ps && typeof ps.duration === 'number' && ps.duration > 0) ? ps.duration : 60);
      for (let i = 0; i < voids.length; i++) {
        const span = voids[i];
        const effStart = span[0] > 0 ? span[0] + framePad : 0;
        const effEnd = span[1] < totalDur - 0.001 ? span[1] - framePad : span[1];
        if (effEnd > effStart && sec >= effStart && sec <= effEnd) {
          return true;
        }
        if (span[0] > sec) break;
      }
      return false;
    }

    hasFrame(frameIndex, expectedWidth = null, expectedHeight = null, compId = null) {
      const targetComp = compId || this.activeCompId;
      if (this.isAudioOnlyComposition(null, targetComp)) {
        return true;
      }
      const currentFps = this.fps || 60;
      if (this.isTimeInVoidSpan(frameIndex / currentFps, targetComp)) {
        return true;
      }
      const pool = this.getPool(targetComp);
      const entry = pool.get(frameIndex);
      if (!entry) return false;
      if (entry.isAudioOnly) {
        pool.delete(frameIndex);
        return false;
      }
      let expW = expectedWidth;
      let expH = expectedHeight;
      if ((!expW || !expH) && typeof document !== 'undefined') {
        const activeCanvas = document.getElementById('editor-active-canvas');
        if (activeCanvas && activeCanvas.width > 0 && activeCanvas.height > 0) {
          expW = activeCanvas.width;
          expH = activeCanvas.height;
        }
      }
      if (expW && expH && entry.width && entry.height) {
        if (Math.abs(entry.width - expW) > 2 || Math.abs(entry.height - expH) > 2) {
          this.deleteFrame(frameIndex, false, targetComp);
          return false;
        }
      }
      return true;
    }

    getFrame(frameIndex, expectedWidth = null, expectedHeight = null, compId = null) {
      const targetComp = compId || this.activeCompId;
      if (this.isAudioOnlyComposition(null, targetComp)) {
        return this._getAudioOnlyCanvas(expectedWidth, expectedHeight);
      }
      const currentFps = this.fps || 60;
      if (this.isTimeInVoidSpan(frameIndex / currentFps, targetComp)) {
        return this._getAudioOnlyCanvas(expectedWidth, expectedHeight);
      }
      const pool = this.getPool(targetComp);
      const entry = pool.get(frameIndex);
      if (!entry) return null;
      if (entry.isAudioOnly) {
        pool.delete(frameIndex);
        return null;
      }
      let expW = expectedWidth;
      let expH = expectedHeight;
      if ((!expW || !expH) && typeof document !== 'undefined') {
        const activeCanvas = document.getElementById('editor-active-canvas');
        if (activeCanvas && activeCanvas.width > 0 && activeCanvas.height > 0) {
          expW = activeCanvas.width;
          expH = activeCanvas.height;
        }
      }
      if (expW && expH && entry.width && entry.height) {
        if (Math.abs(entry.width - expW) > 2 || Math.abs(entry.height - expH) > 2) {
          this.deleteFrame(frameIndex, false, targetComp);
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
      const ps = this._resolveProjectState(projectState);
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
      const effectiveBg = (bg && bg !== 'transparent') ? bg : '#0a0d07';

      if (!this._audioOnlyCanvas) {
        this._audioOnlyCanvas = document.createElement('canvas');
      }
      if (this._audioOnlyCanvas.width !== w || this._audioOnlyCanvas.height !== h || this._audioOnlyBg !== effectiveBg) {
        this._audioOnlyCanvas.width = w;
        this._audioOnlyCanvas.height = h;
        this._audioOnlyBg = effectiveBg;
        const ctx = this._audioOnlyCanvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = effectiveBg;
          ctx.fillRect(0, 0, w, h);
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
      if (!this.isAudioOnlyComposition(projectState, targetComp)) {
        if (this._purgeAudioOnlyEntries(targetComp)) {
          this.updateRulerUI();
        }
        return false;
      }

      const totalDur = (typeof window !== 'undefined' && typeof window.getProjectTotalDuration === 'function')
        ? window.getProjectTotalDuration()
        : 0;
      if (totalDur <= 0) return false;

      const currentFps = this.fps || 60;
      const totalFrames = Math.ceil(totalDur * currentFps);
      const pool = this.getPool(targetComp);
      const ps = this._resolveProjectState(projectState);
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
      const memCap = this.maxFrames || Math.round(5 * currentFps);
      const effectiveMax = memCap;
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
      const targetComp = this.activeCompId || 'root';
      if (this.isAudioOnlyComposition(null, targetComp)) return true;
      const currentFps = this.fps || 60;
      if (this.isTimeInVoidSpan(frameIndex / currentFps, targetComp)) return true;
      if (!this.frames.has(frameIndex)) return false;
      const totalDur = (typeof window !== 'undefined' && typeof window.getProjectTotalDuration === 'function')
        ? window.getProjectTotalDuration()
        : 0;
      const effectiveMinRun = totalDur > 0 ? Math.min(minRun, Math.max(1, Math.ceil(totalDur * currentFps))) : minRun;

      let count = 0;
      let f = frameIndex;
      while (this.frames.has(f) || this.isTimeInVoidSpan(f / currentFps, targetComp)) {
        count++;
        if (count >= effectiveMinRun) return true;
        f--;
      }
      f = frameIndex + 1;
      while (this.frames.has(f) || this.isTimeInVoidSpan(f / currentFps, targetComp)) {
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
      const delay = (typeof window !== 'undefined' && window.isTimelinePlaying) ? 40 : 25;
      setTimeout(() => {
        this._rulerUpdatePending = false;
        this.updateRulerUI();
      }, delay);
    }

    async setFrameFromCanvas(frameIndex, sourceCanvas, isDraft = this.isDraftMode, compId = null) {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) return;
      const targetComp = compId || this.activeCompId;
      const currentFps = this.fps || 60;
      const targetSec = frameIndex / currentFps;
      if (this.isTimeBaking(targetSec)) return;
      if (this.ensureAudioOnlyFullCache(null, targetComp)) return;
      if (this.isTimeInVoidSpan(targetSec, targetComp)) return;
      const targetPool = this.getPool(targetComp);
      if (this.hasFrame(frameIndex, sourceCanvas.width, sourceCanvas.height, targetComp)) return;

      if (!this._pendingFrames) this._pendingFrames = new Set();
      if (!this._inFlightFrames) this._inFlightFrames = new Set();
      if (!this._frameGen) this._frameGen = new Map();
      const inFlightKey = `${targetComp}:${frameIndex}`;
      if (this._inFlightFrames.has(inFlightKey)) return;
      const maxInFlight = (this._isMobile || (this._devMem && this._devMem <= 4)) ? 8 : 16;
      if (this._inFlightFrames.size >= maxInFlight) {
        if (!this._missedPlaybackFrames) this._missedPlaybackFrames = new Set();
        this._missedPlaybackFrames.add(frameIndex);
        return;
      }
      const gen = (this._frameGen.get(inFlightKey) || 0) + 1;
      this._frameGen.set(inFlightKey, gen);
      this._pendingFrames.add(inFlightKey);
      this._inFlightFrames.add(inFlightKey);
      try {
        const srcW = sourceCanvas.width;
        const srcH = sourceCanvas.height;
        let stagingCanvas = sourceCanvas;
        if (sourceCanvas.id === 'editor-active-canvas' && typeof document !== 'undefined') {
          if (!this._idleCanvasPool) {
            this._idleCanvasPool = [];
            const poolSize = this._isMobile ? 8 : 16;
            for (let i = 0; i < poolSize; i++) {
              this._idleCanvasPool.push(document.createElement('canvas'));
            }
            this._idlePoolIdx = 0;
          }
          stagingCanvas = this._idleCanvasPool[this._idlePoolIdx % this._idleCanvasPool.length];
          this._idlePoolIdx++;
          if (stagingCanvas.width !== srcW || stagingCanvas.height !== srcH) {
            stagingCanvas.width = srcW;
            stagingCanvas.height = srcH;
          }
          const sCtx = stagingCanvas._cachedCtx || (stagingCanvas._cachedCtx = stagingCanvas.getContext('2d'));
          if (sCtx) {
            sCtx.clearRect(0, 0, srcW, srcH);
            sCtx.drawImage(sourceCanvas, 0, 0);
          }
        }

        this.deleteFrame(frameIndex, false, targetComp);
        this._frameGen.set(inFlightKey, gen);
        this._pendingFrames.add(inFlightKey);
        this._inFlightFrames.add(inFlightKey);

        // Immediately register provisional canvas in pool so next rAF tick gets a 0ms cache hit
        const provisionalEntry = {
          bitmap: stagingCanvas,
          isDraft,
          isPendingBitmap: true,
          width: srcW,
          height: srcH
        };
        targetPool.set(frameIndex, provisionalEntry);
        if (this._missedPlaybackFrames) {
          this._missedPlaybackFrames.delete(frameIndex);
        }
        this._evictIfNeeded(targetComp);
        this._scheduleRulerUpdate();

        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(stagingCanvas);
          if (!this._inFlightFrames.has(inFlightKey) || this._frameGen.get(inFlightKey) !== gen || this.isTimeBaking(targetSec)) {
            if (bitmap && typeof bitmap.close === 'function') {
              try { bitmap.close(); } catch (_) {}
            }
            return;
          }
          const currentEntry = targetPool.get(frameIndex);
          if (currentEntry === provisionalEntry) {
            provisionalEntry.bitmap = bitmap;
            provisionalEntry.isPendingBitmap = false;
          } else if (bitmap && typeof bitmap.close === 'function') {
            try { bitmap.close(); } catch (_) {}
          }
        } else {
          provisionalEntry.isPendingBitmap = false;
        }
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
      if (this._missedPlaybackFrames) {
        this._missedPlaybackFrames.delete(frameIndex);
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
      this.rebuildOccupancyIntervals(null, targetComp);
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
      if (this._missedPlaybackFrames) {
        for (let f = startFrame; f <= endFrame; f++) {
          this._missedPlaybackFrames.delete(f);
        }
      }
      if (this.ensureAudioOnlyFullCache(null, targetComp)) {
        return;
      }
      if (!compId || compId === this.activeCompId) {
        this.updateRulerUI(true);
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
        : ((parseFloat(layer.widthPx ?? layer.width) || 400) / effectivePps);
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

      const kfs = (layer.keyframes && typeof layer.keyframes === 'object') ? layer.keyframes : null;
      const hasMoveKf = !!(kfs && Array.isArray(kfs.move) && kfs.move.length > 0);
      const hasRotKf = !!(kfs && Array.isArray(kfs.rotate) && kfs.rotate.length > 0);
      const hasScaleKf = !!(kfs && Array.isArray(kfs.scale) && kfs.scale.length > 0);
      const hasSkewKf = !!(kfs && Array.isArray(kfs.skew) && kfs.skew.length > 0);
      const hasOpacityKf = !!(kfs && Array.isArray(kfs.opacity) && kfs.opacity.length > 0);
      const hasVecKf = !!(kfs && Array.isArray(kfs.vectorPoints) && kfs.vectorPoints.length > 0);
      const hasSpeedKf = !!(kfs && Array.isArray(kfs.speed) && kfs.speed.length > 0);

      let shapePropsToSig = layer.shapeProps;
      if (hasVecKf && layer.shapeProps && typeof layer.shapeProps === 'object') {
        const shallow = { ...layer.shapeProps };
        delete shallow.points;
        delete shallow.sizeX;
        delete shallow.sizeY;
        shapePropsToSig = shallow;
      }
      const shapeSig = (shapePropsToSig && typeof shapePropsToSig === 'object') ? this._fastObjectSig(shapePropsToSig) : '';
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
        startSec.toFixed(3),
        endSec.toFixed(3),
        Number(layer.durationSec || (endSec - startSec) || 0).toFixed(3),
        Number(layer.sourceOffsetSec || 0).toFixed(3),
        hasMoveKf ? 'kf_move' : (hasVecKf ? 'kf_vec' : Number(layer.posX ?? layer.x ?? 0).toFixed(2)),
        hasMoveKf ? 'kf_move' : (hasVecKf ? 'kf_vec' : Number(layer.posY ?? layer.y ?? 0).toFixed(2)),
        hasMoveKf ? 'kf_move' : Number(layer.posZ ?? layer.z ?? 0).toFixed(2),
        hasScaleKf ? 'kf_scale' : (hasVecKf ? 'kf_vec' : Number(layer.scaleW ?? layer.scaleX ?? layer.scale ?? 100).toFixed(2)),
        hasScaleKf ? 'kf_scale' : (hasVecKf ? 'kf_vec' : Number(layer.scaleH ?? layer.scaleY ?? layer.scale ?? 100).toFixed(2)),
        hasScaleKf ? 'kf_scale' : Number(layer.scaleZ ?? 100).toFixed(2),
        hasRotKf ? 'kf_rot' : Number(layer.rotZ ?? layer.rotationZ ?? layer.rotation ?? 0).toFixed(2),
        hasRotKf ? 'kf_rot' : Number(layer.rotX ?? layer.rotationX ?? 0).toFixed(2),
        hasRotKf ? 'kf_rot' : Number(layer.rotY ?? layer.rotationY ?? 0).toFixed(2),
        hasRotKf ? 'kf_rot' : Number(layer.rotation ?? layer.rotZ ?? 0).toFixed(2),
        hasSkewKf ? 'kf_skew' : Number(layer.skewX ?? 0).toFixed(2),
        hasSkewKf ? 'kf_skew' : Number(layer.skewY ?? 0).toFixed(2),
        Number(layer.anchorX ?? 0).toFixed(2),
        Number(layer.anchorY ?? 0).toFixed(2),
        Number(layer.anchorZ ?? 0).toFixed(2),
        hasOpacityKf ? 'kf_op' : Number(layer.opacity ?? 1).toFixed(3),
        Number(layer.roundness ?? (layer.shapeProps && layer.shapeProps.roundness) ?? 0).toFixed(2),
        hasSpeedKf ? 'kf_spd' : Number(layer.speed ?? 1).toFixed(3),
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
          if (l.type !== 'precomp' && l._precompBufferCanvas) l._precompBufferCanvas._lastRenderKey = null;
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
      if (this._missedPlaybackFrames) {
        this._missedPlaybackFrames.clear();
      }
      const closedBitmaps = new Set();
      if (scope === 'all') {
        if (this._compVisualIntervals) this._compVisualIntervals.clear();
        if (this._compVoidIntervals) this._compVoidIntervals.clear();
        if (this._compOccupancyKeys) this._compOccupancyKeys.clear();
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
      this.rebuildOccupancyIntervals(null, compId || this.activeCompId);
      if (this.ensureAudioOnlyFullCache(null, compId || this.activeCompId)) {
        return;
      }
      this.updateRulerUI(true);
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
      const winPs = (typeof window !== 'undefined') ? window.currentProjectState : null;
      const ps = projectState || winPs;
      if (!ps || !Array.isArray(ps.layers)) return false;
      this._lastProjectState = ps;
      this._lastWindowProjectState = winPs;
      const targetComp = compId || this.activeCompId || 'root';
      this.rebuildOccupancyIntervals(ps, targetComp);

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
        this.rebuildOccupancyIntervals(ps, targetComp);
        this.ensureAudioOnlyFullCache(ps, targetComp);
        return compChanged;
      }

      const diffInvalidated = this.invalidateSmartDiff(prevSnapshot, layers, targetComp, currentSnapshot);
      if (compChanged || diffInvalidated) {
        if (this._unreadyFrames) this._unreadyFrames.clear();
      }
      this.rebuildOccupancyIntervals(ps, targetComp);
      this.ensureAudioOnlyFullCache(ps, targetComp);
      return compChanged || diffInvalidated;
    }

    /**
     * Refresh the baseline fingerprint and layer snapshot without invalidating existing cached frames.
     * Called right after playback pauses so lazy property normalization during playback never wipes out cached frames.
     */
    refreshBaselineSnapshot(projectState = null, compId = null) {
      const ps = projectState || (typeof window !== 'undefined' ? window.currentProjectState : null);
      if (!ps || !Array.isArray(ps.layers)) return;
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

      this._lastKnownCompFingerprints.set(targetComp, compFingerprint);
      this._lastKnownLayerSnapshots.set(targetComp, this.captureStateSnapshot(layers));
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

    updateRulerUI(immediate = false) {
      if (immediate) {
        this._rulerRafScheduled = false;
        this._renderRuler();
        return;
      }
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
      if (!this.rulerCanvas || !this.rulerCanvas.isConnected) {
        this.rulerCanvas = typeof document !== 'undefined' ? document.getElementById('timeline-cache-ruler-bar') : null;
        if (this.rulerCanvas) this.rulerCtx = this.rulerCanvas.getContext('2d');
      }
      if (!this.rulerCanvas || !this.rulerCtx) return;

      const pps = (typeof window !== 'undefined' && window.currentPixelsPerSecond) || 80;
      const totalDur = (typeof window !== 'undefined' && typeof window.getProjectTotalDuration === 'function') ? window.getProjectTotalDuration() : 0;
      const trackWidth = Math.ceil(totalDur * pps);

      if (this.rulerCanvas.width !== trackWidth || this.rulerCanvas.height !== 3) {
        this.rulerCanvas.width = Math.max(1, trackWidth);
        this.rulerCanvas.height = 3;
        this.rulerCanvas.style.width = trackWidth + 'px';
        this.rulerCanvas.style.height = '3px';
      }

      this.rulerCtx.clearRect(0, 0, this.rulerCanvas.width, 3);
      if (totalDur <= 0 || (typeof window !== 'undefined' && window.isPreviewCacheEnabled === false)) return;

      const targetComp = this.activeCompId || 'root';
      this._ensureOccupancySynced(null, targetComp);
      const isAudioOnlyComp = this.isAudioOnlyComposition(null, targetComp);
      if (!isAudioOnlyComp) {
        this._purgeAudioOnlyEntries(targetComp);
      }
      const voidIntervals = this._compVoidIntervals ? this._compVoidIntervals.get(targetComp) : null;
      const hasVoidSpans = Array.isArray(voidIntervals) && voidIntervals.length > 0;

      if (this.frames.size === 0 && !isAudioOnlyComp && !hasVoidSpans) return;

      const totalFrames = Math.ceil(totalDur * this.fps);

      // Prune orphan frames outside project duration so shrinking project duration removes zombie frames
      for (const f of this.frames.keys()) {
        if (f < 0 || f > totalFrames) {
          this.deleteFrame(f, false);
        }
      }

      if (!this._cachedPrimaryColor || (Date.now() - (this._lastColorQuery || 0) > 3000)) {
        this._cachedPrimaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#98ce7b';
        this._lastColorQuery = Date.now();
      }
      this.rulerCtx.fillStyle = this._cachedPrimaryColor;

      // 1. Auto-paint full green bar when the ENTIRE composition is audio-only
      if (isAudioOnlyComp) {
        this.rulerCtx.fillRect(0, 0, this.rulerCanvas.width, 3);
        return;
      }

      // 2. Auto-paint genuine void intervals (e.g. right-hand audio-only tail after all visual layers end)
      if (hasVoidSpans) {
        const currentFps = this.fps || 60;
        const framePad = 1.5 / currentFps;
        for (let i = 0; i < voidIntervals.length; i++) {
          const span = voidIntervals[i];
          const effStart = span[0] > 0 ? span[0] + framePad : 0;
          const effEnd = span[1] < totalDur - 0.001 ? span[1] - framePad : span[1];
          if (effEnd > effStart) {
            const x = Math.ceil(effStart * pps);
            const xEnd = Math.floor(effEnd * pps);
            if (xEnd > x) {
              this.rulerCtx.fillRect(x, 0, xEnd - x, 3);
            }
          }
        }
      }

      // 3. Paint contiguous runs of raster cached frames
      if (this.frames.size > 0) {
        const pxPerFrame = pps / this.fps;

        let runStart = -1;
        for (let f = 0; f <= totalFrames; f++) {
          // Strict cache check: only paint real cached frames to prevent false-green stutter
          const isCached = this.frames.has(f);
          if (isCached) {
            if (runStart === -1) runStart = f;
          } else {
            if (runStart !== -1) {
              const x = Math.round(runStart * pxPerFrame);
              const xEnd = Math.max(x + 1, Math.floor(f * pxPerFrame));
              const w = Math.max(1, xEnd - x);
              this.rulerCtx.fillRect(x, 0, w, 3);
              runStart = -1;
            }
          }
        }
        if (runStart !== -1) {
          const x = Math.round(runStart * pxPerFrame);
          const xEnd = Math.ceil(totalFrames * pxPerFrame);
          const w = Math.max(1, xEnd - x);
          this.rulerCtx.fillRect(x, 0, w, 3);
        }
      }
    }

    setupUserActivityListeners() {
      const onActivity = (e) => {
        if (e && e.target && typeof e.target.closest === 'function') {
          if (e.target.closest('#editor-btn-play, .ctrl-btn[title*="Play"], .ctrl-btn[title*="Pause"]')) {
            return;
          }
        }
        if (e && e.type === 'keydown' && e.code === 'Space') {
          return;
        }
        this.lastUserActivity = Date.now();
        if (this.isIdleRunning) {
          this.stopIdleWorker();
        }
        if (this.idleCacheEnabled) {
          this.scheduleIdleCheck();
        }
      };

      let _lastPointerYield = 0;
      const onPointerMove = (e) => {
        // Pause idle caching during active drag/scrubbing or any mouse movement so UI stays 100% responsive
        if (!e) return;
        const now = Date.now();
        if (e.buttons > 0 || window.isTimelineScrubbing || window.isTimelinePanning || window.isTransformInteracting) {
          onActivity(e);
        } else if (this.isIdleRunning && (now - _lastPointerYield > 100)) {
          _lastPointerYield = now;
          this.stopIdleWorker();
          if (this.idleCacheEnabled) {
            this.scheduleIdleCheck();
          }
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
      this._bindBakingListeners();
      this.pruneBakingFrames();
      if (!this.idleCacheEnabled) return;
      if (this.idleTimer) clearTimeout(this.idleTimer);
      const delay = immediate ? 32 : 180;
      this.idleTimer = setTimeout(() => {
        if (typeof window !== 'undefined' && window.isExporting) return;
        if (this.ensureAudioOnlyFullCache()) return;
        if (!this.idleCacheEnabled) return;
        if (window.isTimelinePlaying || window.isTransformInteracting || window.isTimelineScrubbing || window.isTimelinePanning) return;
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
      this._scheduleNextIdleTick(0);
    }

    stopIdleWorker() {
      const wasRunning = this.isIdleRunning;
      this.isIdleRunning = false;
      if (this.idleWorkerId) {
        if (this._idleUsedRAF && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(this.idleWorkerId);
        } else if (this._idleUsedRIC && typeof cancelIdleCallback === 'function') {
          cancelIdleCallback(this.idleWorkerId);
        } else {
          clearTimeout(this.idleWorkerId);
        }
        this.idleWorkerId = null;
        this._idleUsedRAF = false;
        this._idleUsedRIC = false;
      }
      if (wasRunning && typeof window !== 'undefined' && window.currentProjectState) {
        this.refreshBaselineSnapshot(window.currentProjectState);
      }
    }

    _scheduleNextIdleTick(delayMs = 0) {
      if (!this.isIdleRunning) return;
      if (this.idleWorkerId) {
        if (this._idleUsedRAF && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(this.idleWorkerId);
        } else if (this._idleUsedRIC && typeof cancelIdleCallback === 'function') {
          cancelIdleCallback(this.idleWorkerId);
        } else {
          clearTimeout(this.idleWorkerId);
        }
        this.idleWorkerId = null;
        this._idleUsedRAF = false;
        this._idleUsedRIC = false;
      }
      const safeDelay = Math.max(delayMs, 60);
      if (typeof requestIdleCallback === 'function') {
        this._idleUsedRIC = true;
        this.idleWorkerId = requestIdleCallback(() => {
          if (!this.isIdleRunning) return;
          this.runIdleStep(null);
        }, { timeout: 350 });
      } else {
        this.idleWorkerId = setTimeout(() => {
          if (!this.isIdleRunning) return;
          this.runIdleStep(null);
        }, safeDelay);
      }
    }

    _bindBakingListeners() {
      if (this._bakingListenersBound) return;
      if (typeof window === 'undefined') return;

      if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.addProgressListener === 'function') {
        let lastTaskSig = '';
        window.VideoFrameExtractor.addProgressListener((tasks) => {
          const activeTasks = Array.isArray(tasks) ? tasks.filter(t => !t.cancelled && (t.percent === undefined || t.percent < 100)) : [];
          const taskSig = activeTasks.map(t => `${t.id || t.sourceKey}:${t.percent === 100}`).join('|');
          if (taskSig !== lastTaskSig) {
            lastTaskSig = taskSig;
            this.pruneBakingFrames();
          }
          if (activeTasks.length === 0 && this.idleCacheEnabled) {
            this.scheduleIdleCheck(true);
          }
        });
        this._bakingListenersBound = true;
      }

      if (window.FishBgRemovalEngine && typeof window.FishBgRemovalEngine.addProgressListener === 'function') {
        let lastBgSig = '';
        window.FishBgRemovalEngine.addProgressListener((tasks) => {
          const activeTasks = Array.isArray(tasks) ? tasks.filter(t => !t.cancelled && (t.percent === undefined || t.percent < 100)) : [];
          const bgSig = activeTasks.map(t => `${t.id || t.sourceKey}:${t.percent === 100}`).join('|');
          if (bgSig !== lastBgSig) {
            lastBgSig = bgSig;
            this.pruneBakingFrames();
          }
          if (activeTasks.length === 0 && this.idleCacheEnabled) {
            this.scheduleIdleCheck(true);
          }
        });
      }
    }

    isLayerBaking(layer) {
      if (!layer || layer.hidden) return false;

      if (typeof window !== 'undefined' && window.VideoFrameExtractor && typeof window.VideoFrameExtractor.isLayerBaking === 'function') {
        if (window.VideoFrameExtractor.isLayerBaking(layer)) return true;
      } else if (layer.type === 'video' || layer.mediaType === 'video') {
        if (!layer._extractComplete) return true;
      } else if (layer.type === 'precomp') {
        return false;
      }

      if (typeof window !== 'undefined' && window.FishBgRemovalEngine) {
        const bg = window.FishBgRemovalEngine;
        if (typeof bg.isLayerMattingActive === 'function' && bg.isLayerMattingActive(layer)) {
          if (typeof bg.getActiveTasks === 'function') {
            const bgTasks = bg.getActiveTasks();
            const sourceKey = (layer.mediaId || layer.dataUrl || layer.id);
            if (bgTasks.some(t => !t.cancelled && (t.percent === undefined || t.percent < 100) && t.status !== 'done' && (t.layerId === layer.id || (sourceKey && t.sourceKey === sourceKey)))) {
              return true;
            }
          }
          if (layer.type !== 'video' && typeof bg.getPhotoCutout === 'function' && !bg.getPhotoCutout(layer)) {
            return true;
          }
        }
      }

      return false;
    }

    getBakingTimeRanges(projectState = null) {
      const ps = projectState || ((typeof window !== 'undefined' && window.currentProjectState) ? window.currentProjectState : null);
      if (!ps || !Array.isArray(ps.layers)) return [];
      const targetComp = this.activeCompId || 'root';
      const layers = (targetComp === 'root' || !targetComp)
        ? (ps.layers || [])
        : ((window.currentActivePrecomp && Array.isArray(window.currentActivePrecomp.layers))
          ? window.currentActivePrecomp.layers
          : (ps.layers || []));
      const pps = (typeof window !== 'undefined' && window.currentPixelsPerSecond) ? window.currentPixelsPerSecond : 80;

      const ranges = [];
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        if (!l || l.hidden) continue;
        const start = l.startSec !== undefined ? Number(l.startSec) : ((l.startPx || 0) / pps);
        const dur = l.durationSec !== undefined ? Number(l.durationSec) : ((l.widthPx || 400) / pps);
        if (l.type === 'precomp' && Array.isArray(l.layers)) {
          if (this.isLayerBaking(l)) {
            ranges.push([Math.max(0, start), Math.max(0, start + dur)]);
          } else {
            const speed = l.speed || 1.0;
            const offset = l.sourceOffsetSec || 0;
            for (let j = 0; j < l.layers.length; j++) {
              const sub = l.layers[j];
              if (!sub || sub.hidden) continue;
              if (this.isLayerBaking(sub)) {
                const subStart = sub.startSec !== undefined ? Number(sub.startSec) : 0;
                const subDur = sub.durationSec !== undefined ? Number(sub.durationSec) : 5;
                const mappedStart = Math.max(start, start + (subStart - offset) / speed);
                const mappedEnd = Math.min(start + dur, start + (subStart + subDur - offset) / speed);
                if (mappedEnd > mappedStart) {
                  ranges.push([Math.max(0, mappedStart), Math.max(0, mappedEnd)]);
                }
              }
            }
          }
        } else if (this.isLayerBaking(l)) {
          ranges.push([Math.max(0, start), Math.max(0, start + dur)]);
        }
      }
      return ranges;
    }

    isTimeBaking(sec, projectState = null) {
      if (typeof sec !== 'number' || isNaN(sec) || sec < 0) return false;
      const ranges = this.getBakingTimeRanges(projectState);
      if (!ranges || ranges.length === 0) return false;
      const fps = this.fps || 60;
      const targetFrame = Math.round(sec * fps);
      for (let i = 0; i < ranges.length; i++) {
        const [rStart, rEnd] = ranges[i];
        const startFrame = Math.max(0, Math.floor(rStart * fps));
        const endFrame = Math.ceil(rEnd * fps);
        if (targetFrame >= startFrame && targetFrame < endFrame) {
          return true;
        }
      }
      return false;
    }

    hasActiveBakingTasks() {
      if (typeof window !== 'undefined') {
        if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.getAllBakingTasks === 'function') {
          const tasks = window.VideoFrameExtractor.getAllBakingTasks();
          if (tasks.some(t => !t.cancelled && (t.percent === undefined || t.percent < 100) && t.status !== 'done')) {
            return true;
          }
        }
        if (window.FishBgRemovalEngine && typeof window.FishBgRemovalEngine.getActiveTasks === 'function') {
          const bgTasks = window.FishBgRemovalEngine.getActiveTasks();
          if (bgTasks.some(t => !t.cancelled && (t.percent === undefined || t.percent < 100) && t.status !== 'done')) {
            return true;
          }
        }
      }
      return false;
    }

    pruneBakingFrames(projectState = null, compId = null) {
      const ranges = this.getBakingTimeRanges(projectState);
      if (!ranges || ranges.length === 0) return false;
      const targetComp = compId || this.activeCompId || 'root';
      const pool = this.getPool(targetComp);
      if (!pool || pool.size === 0) return false;

      let anyPruned = false;
      const fps = this.fps || 60;
      for (let r = 0; r < ranges.length; r++) {
        const [startSec, endSec] = ranges[r];
        const startFrame = Math.max(0, Math.floor(startSec * fps));
        const endFrame = Math.ceil(endSec * fps);
        for (let f = startFrame; f <= endFrame; f++) {
          if (pool.has(f)) {
            const entry = pool.get(f);
            if (entry && !entry.shared && entry.bitmap && typeof entry.bitmap.close === 'function') {
              try { entry.bitmap.close(); } catch (_) {}
            }
            pool.delete(f);
            const inFlightKey = `${targetComp}:${f}`;
            if (this._inFlightFrames) this._inFlightFrames.delete(inFlightKey);
            if (this._pendingFrames) this._pendingFrames.delete(inFlightKey);
            anyPruned = true;
          }
        }
      }

      if (anyPruned) {
        this.scheduleRulerUpdate();
      }
      return anyPruned;
    }

    isTimeReadyToCache(sec, projectState = null) {
      if (this.isTimeBaking(sec, projectState)) return false;
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
        const dur = l.durationSec !== undefined ? Number(l.durationSec) : ((l.widthPx || 400) / pps);
        if (sec >= start && sec < start + dur) {
          if (this.isLayerBaking(l)) return false;
          if (l.type === 'image' || l.mediaType === 'image') {
            const mKey = l.mediaId || l.id;
            const mEntry = (typeof window !== 'undefined' && window.layerMediaCache)
              ? (window.layerMediaCache.get(mKey) || window.layerMediaCache.get(l.id))
              : null;
            if (mEntry && mEntry.el && mEntry.el.tagName === 'IMG' && (mEntry.el.complete === false || mEntry.el.naturalWidth === 0)) {
              return false;
            }
          }
          if (l.type === 'video' || l.mediaType === 'video') {
            if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.isVideoFrameReady === 'function') {
              if (!window.VideoFrameExtractor.isVideoFrameReady(l, sec)) return false;
            } else {
              return false;
            }
          }
          if (l.type === 'precomp' && Array.isArray(l.layers)) {
            const precompTime = (sec - start) * (l.speed || 1.0) + (l.sourceOffsetSec || 0);
            for (let j = 0; j < l.layers.length; j++) {
              const sub = l.layers[j];
              if (!sub || sub.hidden) continue;
              const subStart = sub.startSec !== undefined ? Number(sub.startSec) : 0;
              const subDur = sub.durationSec !== undefined ? Number(sub.durationSec) : 5;
              if (precompTime >= subStart && precompTime < subStart + subDur) {
                if (this.isLayerBaking(sub)) return false;
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
          if (typeof window !== 'undefined' && window.FishBgRemovalEngine && typeof window.FishBgRemovalEngine.isLayerMattingActive === 'function') {
            if (window.FishBgRemovalEngine.isLayerMattingActive(l)) {
              if (l.type === 'video') {
                const sourceKey = (l.mediaId || l.dataUrl || l.id);
                const fps = this.fps || 60;
                const fIdx = Math.round((sec - start) * fps);
                if (typeof window.FishBgRemovalEngine.getVideoCutoutFrame === 'function') {
                  if (!window.FishBgRemovalEngine.getVideoCutoutFrame(sourceKey, fIdx)) return false;
                }
              } else {
                if (typeof window.FishBgRemovalEngine.getPhotoCutout === 'function') {
                  if (!window.FishBgRemovalEngine.getPhotoCutout(l)) return false;
                }
              }
            }
          }
        }
      }
      return true;
    }

    runIdleStep(deadline = null) {
      this.idleWorkerId = null;
      this._idleUsedRAF = false;
      this._idleUsedRIC = false;
      if (typeof window !== 'undefined' && window.isExporting) {
        this.stopIdleWorker();
        return;
      }
      if (!this.isIdleRunning || !this.idleCacheEnabled || window.isTimelinePlaying || window.isTransformInteracting || window.isTimelineScrubbing || window.isTimelinePanning) {
        this.stopIdleWorker();
        return;
      }
      if (typeof document !== 'undefined' && document.hidden) {
        this._scheduleNextIdleTick(250);
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

      // Rotating scratch offscreen canvas pool (prevents in-flight createImageBitmap corruption/overwrites during batch caching)
      if (!this._idleCanvasPool) {
        this._idleCanvasPool = [];
        const poolSize = this._isMobile ? 8 : 16;
        for (let i = 0; i < poolSize; i++) {
          this._idleCanvasPool.push(document.createElement('canvas'));
        }
        this._idlePoolIdx = 0;
      }

      const targetW = activeCanvas.width;
      const targetH = activeCanvas.height;

      const tStart = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      const budgetMs = this._isMobile ? 3.0 : 5.0;
      const maxBatch = this._isMobile ? 2 : 3;
      let cachedInBatch = 0;
      let sawUnready = false;

      this.pruneBakingFrames();

      while (this.isIdleRunning && cachedInBatch < maxBatch) {
        if (((typeof performance !== 'undefined') ? performance.now() : Date.now()) - tStart >= budgetMs) {
          break;
        }

        const maxInFlight = (this._isMobile || (this._devMem && this._devMem <= 4)) ? 16 : 32;
        if (this._inFlightFrames && this._inFlightFrames.size >= maxInFlight) {
          break;
        }

        if (this.frames.size >= effectiveMax) {
          this.stopIdleWorker();
          return;
        }

        let targetFrame = -1;

        // Priority 0: Missed playback frames (highest priority)
        if (this._missedPlaybackFrames && this._missedPlaybackFrames.size > 0) {
          for (const mf of this._missedPlaybackFrames) {
            this._missedPlaybackFrames.delete(mf);
            const mSec = mf / currentFps;
            if (!this.frames.has(mf) && !this.isTimeInVoidSpan(mSec, targetComp)) {
              const inFlightKey = `${targetComp}:${mf}`;
              const isInFlight = !!(this._inFlightFrames && this._inFlightFrames.has(inFlightKey));
              if (!isInFlight && !this.isTimeBaking(mSec) && this.isTimeReadyToCache(mSec)) {
                targetFrame = mf;
                break;
              }
            }
          }
        }

        // Pass 1: Contiguous forward from playhead to end of active window (same direction as playback)
        if (targetFrame === -1) {
          for (let f = currentFrame; f <= winEnd; f++) {
            const targetSec = f / currentFps;
            if (this.isTimeInVoidSpan(targetSec, targetComp)) continue;
            if (!this.frames.has(f)) {
              const inFlightKey = `${targetComp}:${f}`;
              const isInFlight = !!(this._inFlightFrames && this._inFlightFrames.has(inFlightKey));
              const isMarkedUnready = !!(this._unreadyFrames && this._unreadyFrames.has(inFlightKey));
              if (!isInFlight && !isMarkedUnready) {
                if (!this.isTimeBaking(targetSec) && this.isTimeReadyToCache(targetSec)) {
                  targetFrame = f;
                  break;
                } else {
                  sawUnready = true;
                  if (!this._unreadyFrames) this._unreadyFrames = new Set();
                  this._unreadyFrames.add(inFlightKey);
                  break;
                }
              }
            }
          }
        }

        // Pass 2: Contiguous from winStart up to playhead
        if (targetFrame === -1) {
          for (let f = winStart; f < currentFrame; f++) {
            const targetSec = f / currentFps;
            if (this.isTimeInVoidSpan(targetSec, targetComp)) continue;
            if (!this.frames.has(f)) {
              const inFlightKey = `${targetComp}:${f}`;
              const isInFlight = !!(this._inFlightFrames && this._inFlightFrames.has(inFlightKey));
              const isMarkedUnready = !!(this._unreadyFrames && this._unreadyFrames.has(inFlightKey));
              if (!isInFlight && !isMarkedUnready) {
                if (!this.isTimeBaking(targetSec) && this.isTimeReadyToCache(targetSec)) {
                  targetFrame = f;
                  break;
                } else {
                  sawUnready = true;
                  if (!this._unreadyFrames) this._unreadyFrames = new Set();
                  this._unreadyFrames.add(inFlightKey);
                  break;
                }
              }
            }
          }
        }

        if (targetFrame === -1) {
          if (sawUnready) {
            const delay = this.hasActiveBakingTasks() ? 350 : 100;
            if (this._unreadyFrames) this._unreadyFrames.clear();
            this._scheduleNextIdleTick(delay);
            return;
          }
          this.stopIdleWorker();
          return;
        }

        const inFlightKey = `${targetComp}:${targetFrame}`;
        const targetSec = targetFrame / currentFps;
        const offscreen = this._idleCanvasPool[this._idlePoolIdx % this._idleCanvasPool.length];
        this._idlePoolIdx++;

        if (offscreen.width !== targetW || offscreen.height !== targetH) {
          offscreen.width = targetW;
          offscreen.height = targetH;
        }

        let isFrameReady = true;
        if (typeof window.renderCanvasFrame === 'function') {
          const res = window.renderCanvasFrame(
            offscreen,
            window.currentProjectState ? window.currentProjectState.bgColor : 'transparent',
            targetW,
            targetH,
            'idle-cache',
            targetSec
          );
          if (res === false) isFrameReady = false;
        }

        if (isFrameReady) {
          this.setFrameFromCanvas(targetFrame, offscreen, this.isDraftMode);
          cachedInBatch++;
        } else {
          if (!this._unreadyFrames) this._unreadyFrames = new Set();
          this._unreadyFrames.add(inFlightKey);
          sawUnready = true;
        }
      }

      if (cachedInBatch > 0 && typeof window !== 'undefined' && window.currentProjectState) {
        this.refreshBaselineSnapshot(window.currentProjectState, this.activeCompId);
      }

      if (this.isIdleRunning) {
        this._scheduleNextIdleTick(60);
      }
    }

    /**
     * Precomposition background prebake removed to eliminate severe playback and timeline lag.
     */
    prebakePrecomp(layer) {}

    cancelPrecompPrebake(layerId) {}

    prebakeAllPrecomps(layers) {}

    /**
     * Synchronously bake a single frame offscreen into the preview cache pool.
     * Used by playback catch-up so the visible viewer canvas is never rendered twice per tick.
     */
    bakeSingleFrameOffscreen(frameIndex, targetSec, compId = null) {
      if (typeof window !== 'undefined' && window.isExporting) return false;
      const targetComp = compId || this.activeCompId || 'root';
      if (this.isTimeInVoidSpan(targetSec, targetComp)) return true;
      if (this.isTimeBaking(targetSec) || !this.isTimeReadyToCache(targetSec)) return false;
      const pool = this.getPool(targetComp);
      if (pool.has(frameIndex)) return true;

      const activeCanvas = (typeof document !== 'undefined') ? document.getElementById('editor-active-canvas') : null;
      if (!activeCanvas || activeCanvas.width === 0 || activeCanvas.height === 0) return false;

      if (!this._idleCanvasPool) {
        this._idleCanvasPool = [];
        const poolSize = this._isMobile ? 8 : 16;
        for (let i = 0; i < poolSize; i++) {
          this._idleCanvasPool.push(document.createElement('canvas'));
        }
        this._idlePoolIdx = 0;
      }

      const targetW = activeCanvas.width;
      const targetH = activeCanvas.height;
      const offscreen = this._idleCanvasPool[this._idlePoolIdx % this._idleCanvasPool.length];
      this._idlePoolIdx++;

      if (offscreen.width !== targetW || offscreen.height !== targetH) {
        offscreen.width = targetW;
        offscreen.height = targetH;
      }

      if (typeof window.renderCanvasFrame === 'function') {
        const res = window.renderCanvasFrame(
          offscreen,
          window.currentProjectState ? window.currentProjectState.bgColor : 'transparent',
          targetW,
          targetH,
          'lookahead-cache',
          targetSec
        );
        if (res !== false) {
          this.setFrameFromCanvas(frameIndex, offscreen, this.isDraftMode, targetComp);
          return true;
        }
      }
      return false;
    }

    /**
     * Immediately pre-bake frames right when user hits Play.
     * Bakes 4 to 8 frames in an instant micro-burst so the upcoming frames are
     * ALREADY cached before requestAnimationFrame(stepPlay) fires its next tick.
     */
    primePlaybackLookahead(fromSec, fps = this.fps) {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (this.ensureAudioOnlyFullCache()) return;
      if (!this.idleCacheEnabled || window.isPreviewCacheEnabled === false) return;
      this.bakePlaybackLookahead(fromSec, fps, this._isMobile ? 6.0 : 12.0);
    }

    /**
     * High-Speed Playback Lookahead Cache Engine
     * Bakes upcoming frames ahead of the current playhead into RAM preview cache
     * during active playback using the rotating offscreen canvas pool.
     * Keeps the green cache bar ahead of the playhead so playback is 100% 60fps real-time with zero slow-mo.
     * @param {number} fromSec - current playhead timestamp in seconds
     * @param {number} fps - project fps
     * @param {number} budgetMs - max time to spend baking ahead in this tick (default 7ms desktop, 4ms mobile)
     */
    bakePlaybackLookahead(fromSec, fps = this.fps, budgetMs = null) {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (!this.idleCacheEnabled || window.isPreviewCacheEnabled === false) return;
      if (typeof document === 'undefined') return;

      const tStart = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (budgetMs === null) {
        if (!window._lastFrameWasCached) return;
        if (typeof window._lastFrameRenderDuration === 'number' && window._lastFrameRenderDuration > 4.0) return;
        if (this._lookaheadHeavyCooldownUntil && tStart < this._lookaheadHeavyCooldownUntil) return;
      }

      const activeCanvas = document.getElementById('editor-active-canvas');
      if (!activeCanvas || activeCanvas.width === 0 || activeCanvas.height === 0) return;

      const totalDur = (typeof window.getProjectTotalDuration === 'function') ? window.getProjectTotalDuration() : 0;
      if (totalDur <= 0) return;

      if (this.ensureAudioOnlyFullCache()) return;

      const currentFps = fps || this.fps || 60;
      const totalFrames = Math.ceil(totalDur * currentFps);
      const currentFrame = Math.max(0, Math.min(totalFrames, Math.round(fromSec * currentFps)));

      const targetComp = this.activeCompId || 'root';
      const pool = this.getPool(targetComp);
      const memCap = this.maxFrames || Math.round(60 * currentFps);
      if (pool.size >= Math.min(memCap, totalFrames + 1)) return;

      const maxInFlight = budgetMs === null
        ? (this._isMobile ? 4 : 8)
        : ((this._isMobile || (this._devMem && this._devMem <= 4)) ? 8 : 16);
      if (this._inFlightFrames && this._inFlightFrames.size >= maxInFlight) return;

      if (!this._idleCanvasPool) {
        this._idleCanvasPool = [];
        const poolSize = this._isMobile ? 8 : 16;
        for (let i = 0; i < poolSize; i++) {
          this._idleCanvasPool.push(document.createElement('canvas'));
        }
        this._idlePoolIdx = 0;
      }

      const targetW = activeCanvas.width;
      const targetH = activeCanvas.height;
      const effectiveBudget = budgetMs !== null ? budgetMs : (this._isMobile ? 1.8 : 2.5);
      const maxBatch = budgetMs === null ? 1 : (this._isMobile ? 2 : 3);

      // Lookahead range: from nextFrame up to nextFrame + 60 (up to 1.5 seconds ahead of playhead)
      const lookaheadLimit = Math.min(totalFrames, currentFrame + Math.round(currentFps * 1.5));
      let bakedCount = 0;

      for (let f = currentFrame + 1; f <= lookaheadLimit; f++) {
        if (bakedCount >= maxBatch) break;
        if (((typeof performance !== 'undefined') ? performance.now() : Date.now()) - tStart >= effectiveBudget) break;
        if (this._inFlightFrames && this._inFlightFrames.size >= maxInFlight) break;

        if (pool.has(f)) continue; // already cached!

        const inFlightKey = `${targetComp}:${f}`;
        if (this._inFlightFrames && this._inFlightFrames.has(inFlightKey)) continue;
        if (this._unreadyFrames && this._unreadyFrames.has(inFlightKey)) continue;

        const targetSec = f / currentFps;
        if (this.isTimeInVoidSpan(targetSec, targetComp)) continue;
        if (this.isTimeBaking(targetSec) || !this.isTimeReadyToCache(targetSec)) continue;

        const offscreen = this._idleCanvasPool[this._idlePoolIdx % this._idleCanvasPool.length];
        this._idlePoolIdx++;

        if (offscreen.width !== targetW || offscreen.height !== targetH) {
          offscreen.width = targetW;
          offscreen.height = targetH;
        }

        let isFrameReady = true;
        const tFrame0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        if (typeof window.renderCanvasFrame === 'function') {
          const res = window.renderCanvasFrame(
            offscreen,
            window.currentProjectState ? window.currentProjectState.bgColor : 'transparent',
            targetW,
            targetH,
            'lookahead-cache',
            targetSec
          );
          if (res === false) isFrameReady = false;
        }
        const tFrame1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

        if (isFrameReady) {
          this.setFrameFromCanvas(f, offscreen, this.isDraftMode, targetComp);
          bakedCount++;
        } else {
          if (!this._unreadyFrames) this._unreadyFrames = new Set();
          this._unreadyFrames.add(inFlightKey);
        }

        if (budgetMs === null && (tFrame1 - tFrame0) > 10.0) {
          this._lookaheadHeavyCooldownUntil = tFrame1 + 500;
          break;
        }
      }

      if (bakedCount > 0 && typeof window !== 'undefined' && window.currentProjectState) {
        this.refreshBaselineSnapshot(window.currentProjectState, targetComp);
      }
    }

    startLookaheadWorker(fromSec, fps) {
      this.bakePlaybackLookahead(fromSec, fps);
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