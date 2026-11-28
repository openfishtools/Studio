/**
 * FishTool Studio - VideoStreamManager
 * Main-thread coordinator for WebCodecs continuous sliding-window video streams.
 *
 * - Zero-allocation synchronous getFrameSync(mediaId, timeSec, opts) for 60fps render loops
 * - Continuous lookahead streaming: keeps >= 1.2s buffered ahead of playhead without decoder reset stalls
 * - Directional LRU eviction: evicts behind-playhead frames first, protecting upcoming frames
 * - Immediate warm-up decode of frame 0 right on init_ok (eliminates 'Video is not ready' flash)
 * - Auto-Proxy (>1080p desktop / >720p mobile) for preview; full-res decode for export
 * - Tags every frame with _streamKey = 'vsm_' + mediaId for FishToolEngine.dynamicTexturePool
 */

(function(window) {
  'use strict';

  function _getSafariMajorVersion() {
    if (typeof navigator === 'undefined' || !navigator.userAgent) return 0;
    const ua = navigator.userAgent;
    if (!/Safari\//.test(ua) || /Chrome\/|Chromium\/|EdgA\/|FxiOS\//.test(ua)) return 0;
    const m = ua.match(/Version\/(\d+)\./);
    return m ? parseInt(m[1], 10) : 0;
  }

  function _detectMobile() {
    if (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) {
      return true;
    }
    if (typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth > 0 && window.innerWidth <= 900) {
      return true;
    }
    return false;
  }

  function _closeFrameSafe(frame) {
    if (frame && typeof frame.close === 'function') {
      try { frame.close(); } catch (_) {}
    }
  }

  class VideoStreamManager {
    constructor() {
      const safariVer = _getSafariMajorVersion();
      const safariWebCodecsOk = safariVer === 0 || safariVer >= 17;
      this.isSupported = safariWebCodecsOk &&
        typeof window !== 'undefined' &&
        typeof window.VideoDecoder !== 'undefined' &&
        typeof window.Worker !== 'undefined';

      this.isMobile = _detectMobile();
      this.maxPreviewW = this.isMobile ? 1280 : 1920;
      this.maxPreviewH = this.isMobile ? 720 : 1080;
      this.maxCacheFrames = this.isMobile ? 72 : 180;
      this.streamBatchCount = this.isMobile ? 20 : 30;

      this.worker = null;
      this.requestId = 0;
      this.pendingRequests = new Map();
      this.streams = new Map();
      this._totalCachedFrames = 0;
      this._redrawScheduled = false;

      // Pre-allocated scratch result object for zero-GC getFrameSync calls
      this._syncResult = {
        frame: null,
        exact: false,
        isProxy: false,
        status: 'unloaded'
      };

      this.stats = {
        hits: 0,
        misses: 0,
        evictions: 0,
        gopDecodes: 0
      };

      if (this.isSupported) {
        this._initWorker();
        this._bindLifecycleCleanup();
      } else if (safariVer > 0 && safariVer < 17) {
        console.info('[VideoStreamManager] Safari ' + safariVer + ' detected — WebCodecs disabled, using fallback.');
      }
    }

    _initWorker() {
      try {
        this.worker = new Worker('js/media/video-decoder-worker.js');
        this.worker.onmessage = (e) => this._onWorkerMessage(e);
        this.worker.onerror = (err) => {
          console.warn('[VideoStreamManager] Worker error, falling back:', err);
          this.isSupported = false;
        };
      } catch (err) {
        console.warn('[VideoStreamManager] Could not instantiate worker:', err);
        this.isSupported = false;
      }
    }

    _bindLifecycleCleanup() {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
      const cleanup = () => this.releaseAll();
      window.addEventListener('pagehide', cleanup);
      window.addEventListener('beforeunload', cleanup);
    }

    _scheduleRedraw() {
      if (this._redrawScheduled) return;
      if (typeof window === 'undefined' || window.isExporting || window.isTimelinePlaying) return;
      if (typeof window.redrawComposition !== 'function') return;
      this._redrawScheduled = true;
      const flush = () => {
        this._redrawScheduled = false;
        if (!window.isExporting && typeof window.redrawComposition === 'function') {
          window.redrawComposition('videoStreamReady');
        }
      };
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(flush);
      } else {
        setTimeout(flush, 0);
      }
    }

    _onWorkerMessage(e) {
      const data = e.data;
      if (!data) return;

      const { type, id, mediaId } = data;

      if (type === 'init_ok') {
        const streamInfo = this.streams.get(mediaId);
        if (streamInfo) {
          streamInfo.ready = true;
          streamInfo.failed = false;
          streamInfo.duration = data.duration || 0;
          streamInfo.width = data.width || 1920;
          streamInfo.height = data.height || 1080;
          streamInfo.fps = data.fps || 30;
          streamInfo.sampleCount = data.sampleCount || 0;
          streamInfo.gops = Array.isArray(data.gops) ? data.gops : [];
          streamInfo.isProxy = (streamInfo.width > this.maxPreviewW || streamInfo.height > this.maxPreviewH);
          if (streamInfo.resolveInit) {
            streamInfo.resolveInit(streamInfo);
            streamInfo.resolveInit = null;
            streamInfo.rejectInit = null;
          }
          // Immediately warm up the initial playback window so frame 0 is ready in ~20ms
          const startSec = Math.max(0, streamInfo.lastRequestedSec || 0);
          this._dispatchStreamAhead(streamInfo, startSec, false, 'seek');
        }
      } else if (type === 'init_error') {
        console.warn(`[VideoStreamManager] Init failed for mediaId=${mediaId}: ${data.error}`);
        const streamInfo = this.streams.get(mediaId);
        if (streamInfo) {
          streamInfo.ready = false;
          streamInfo.failed = true;
          streamInfo.error = data.error;
          if (streamInfo.resolveInit) {
            streamInfo.resolveInit(null);
            streamInfo.resolveInit = null;
            streamInfo.rejectInit = null;
          }
        }
      } else if (type === 'frames_batch' || type === 'gop_result') {
        const streamInfo = this.streams.get(mediaId);
        const isDone = (type === 'gop_result') ? true : !!data.done;
        if (streamInfo) {
          if (typeof data.cursorPts === 'number' && isFinite(data.cursorPts)) {
            streamInfo.cursorPts = data.cursorPts;
          }
          const frames = Array.isArray(data.frames) ? data.frames : [];
          if (frames.length > 0) {
            this._ingestFrames(streamInfo, frames, !!data.isProxy);
            this._scheduleRedraw();
          }
          if (isDone) {
            streamInfo.isDecoding = false;
            if (streamInfo.pendingRequest) {
              const nextReq = streamInfo.pendingRequest;
              streamInfo.pendingRequest = null;
              // Skip stale coalesced seek if the just-finished batch already covers nextReq.timeSec
              const alreadyCovered = (
                nextReq.mode !== 'continue' &&
                !nextReq.isExport &&
                streamInfo.cursorPts >= nextReq.timeSec &&
                Math.abs(streamInfo.cursorPts - nextReq.timeSec) <= 1.2
              );
              if (!alreadyCovered) {
                this._dispatchStreamAhead(streamInfo, nextReq.timeSec, nextReq.isExport, nextReq.mode);
              }
            }
          }
        } else if (Array.isArray(data.frames)) {
          for (let i = 0; i < data.frames.length; i++) {
            _closeFrameSafe(data.frames[i] && data.frames[i].bitmap);
          }
        }
      } else if (type === 'seek_result') {
        const streamInfo = this.streams.get(mediaId);
        if (streamInfo) {
          streamInfo.isSeekingWorker = false;
        }
        const req = this.pendingRequests.get(id);
        const bitmap = data.bitmap || null;
        if (req) {
          this.pendingRequests.delete(id);
          if (req.noCache) {
            // Caller owns this bitmap exclusively (AI matting / export): never enters the playback LRU
            req.resolve(bitmap);
          } else {
            if (bitmap) bitmap._streamKey = 'vsm_' + mediaId;
            if (bitmap && streamInfo) {
              this._storeSingleFrame(streamInfo, data.timeSec || 0, bitmap, !!req.isProxy);
              req.resolve(bitmap);
            } else {
              if (bitmap) _closeFrameSafe(bitmap);
              req.resolve(null);
            }
          }
        } else if (bitmap) {
          _closeFrameSafe(bitmap);
        }

        if (streamInfo && streamInfo.pendingSeekTime !== null && streamInfo.pendingSeekTime !== undefined) {
          const nextTime = streamInfo.pendingSeekTime;
          const nextOpts = streamInfo.pendingSeekOpts || {};
          const nextResolves = streamInfo.pendingResolves || [];
          streamInfo.pendingSeekTime = null;
          streamInfo.pendingSeekOpts = null;
          streamInfo.pendingResolves = null;
          this.seekFrame(mediaId, nextTime, nextOpts).then(bmp => {
            for (let i = 0; i < nextResolves.length; i++) nextResolves[i](bmp);
          });
        }
      }
    }

    _ingestFrames(streamInfo, frames, isProxy) {
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      const streamKey = 'vsm_' + streamInfo.mediaId;

      for (let i = 0; i < frames.length; i++) {
        const item = frames[i];
        if (!item || !item.bitmap) continue;
        item.bitmap._streamKey = streamKey;
        const ptsKey = Math.round(item.pts * 1000);
        const existing = streamInfo.frames.get(ptsKey);
        if (existing) {
          if (existing.bitmap !== item.bitmap) {
            _closeFrameSafe(existing.bitmap);
          }
          existing.bitmap = item.bitmap;
          existing.pts = item.pts;
          existing.isProxy = isProxy;
          existing.lastUsed = now;
        } else {
          streamInfo.frames.set(ptsKey, {
            key: ptsKey,
            pts: item.pts,
            bitmap: item.bitmap,
            isProxy: isProxy,
            lastUsed: now
          });
          this._totalCachedFrames++;
        }
      }

      streamInfo.sortedDirty = true;
      this._evictIfNeeded(streamInfo.mediaId);
    }

    _storeSingleFrame(streamInfo, ptsSec, bitmap, isProxy) {
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      bitmap._streamKey = 'vsm_' + streamInfo.mediaId;
      const ptsKey = Math.round(ptsSec * 1000);
      const existing = streamInfo.frames.get(ptsKey);
      if (existing) {
        if (existing.bitmap !== bitmap) {
          _closeFrameSafe(existing.bitmap);
        }
        existing.bitmap = bitmap;
        existing.pts = ptsSec;
        existing.isProxy = isProxy;
        existing.lastUsed = now;
      } else {
        streamInfo.frames.set(ptsKey, {
          key: ptsKey,
          pts: ptsSec,
          bitmap: bitmap,
          isProxy: isProxy,
          lastUsed: now
        });
        this._totalCachedFrames++;
      }
      streamInfo.sortedDirty = true;
      this._evictIfNeeded(streamInfo.mediaId);
    }

    /**
     * Directional LRU eviction: always evicts frames BEHIND the playhead first so
     * newly prefetched ahead-of-playhead frames are never discarded prematurely!
     */
    _evictIfNeeded(activeMediaId) {
      while (this._totalCachedFrames > this.maxCacheFrames) {
        let victimStream = null;
        let victimEntry = null;
        let lowestScore = Infinity;

        for (const stream of this.streams.values()) {
          const playSec = stream.lastRequestedSec || 0;
          const reverse = (stream.lastSpeed || 1) < 0;
          for (const entry of stream.frames.values()) {
            const delta = entry.pts - playSec;
            const isBehind = reverse ? (delta > 0.12) : (delta < -0.12);
            const isUpcoming = reverse ? (delta <= 0.12 && delta >= -2.5) : (delta >= -0.12 && delta <= 2.5);

            // Lowest score gets evicted first:
            // Behind playhead -> 0..1e6 (furthest behind first)
            // Far away -> 1e7 + lastUsed
            // Active upcoming window -> 1e12 + lastUsed (protected!)
            let score;
            if (isBehind) {
              score = entry.lastUsed - Math.abs(delta) * 10000;
            } else if (isUpcoming && stream.mediaId === activeMediaId) {
              score = 1e12 + entry.lastUsed;
            } else {
              score = 1e7 + entry.lastUsed;
            }

            if (score < lowestScore) {
              lowestScore = score;
              victimStream = stream;
              victimEntry = entry;
            }
          }
        }

        if (!victimStream || !victimEntry) break;

        _closeFrameSafe(victimEntry.bitmap);
        victimStream.frames.delete(victimEntry.key);
        victimStream.sortedDirty = true;
        this._totalCachedFrames = Math.max(0, this._totalCachedFrames - 1);
        this.stats.evictions++;
      }
    }

    _ensureSortedFrames(streamInfo) {
      if (!streamInfo.sortedDirty) return streamInfo.sortedFrames;
      const arr = streamInfo.sortedFrames;
      arr.length = 0;
      for (const entry of streamInfo.frames.values()) {
        arr.push(entry);
      }
      arr.sort((a, b) => a.pts - b.pts);
      streamInfo.sortedDirty = false;
      return arr;
    }

    _findClosestIndex(sortedFrames, targetSec) {
      const len = sortedFrames.length;
      if (len === 0) return -1;
      if (targetSec <= sortedFrames[0].pts) return 0;
      if (targetSec >= sortedFrames[len - 1].pts) return len - 1;

      let lo = 0;
      let hi = len - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const p = sortedFrames[mid].pts;
        if (p === targetSec) return mid;
        if (p < targetSec) lo = mid + 1;
        else hi = mid - 1;
      }

      const rightIdx = Math.min(len - 1, lo);
      const leftIdx = Math.max(0, lo - 1);
      return (Math.abs(sortedFrames[leftIdx].pts - targetSec) <= Math.abs(sortedFrames[rightIdx].pts - targetSec))
        ? leftIdx
        : rightIdx;
    }

    /**
     * Measure contiguous buffered duration ahead of `fromIdx` in sortedFrames.
     */
    _measureContiguousAhead(sortedFrames, fromIdx, maxGapSec) {
      let endPts = sortedFrames[fromIdx].pts;
      for (let i = fromIdx + 1; i < sortedFrames.length; i++) {
        const p = sortedFrames[i].pts;
        if (p - endPts > maxGapSec) break;
        endPts = p;
      }
      return endPts;
    }

    _dispatchStreamAhead(streamInfo, timeSec, isExport, mode = 'auto') {
      if (!this.worker || !streamInfo || !streamInfo.ready) return;

      // Reset stale cursorPts when jumping backwards (e.g. loop 18s -> 0s) or far forwards
      if (mode !== 'continue' && streamInfo.cursorPts >= 0 && (timeSec < streamInfo.cursorPts - 0.5 || timeSec > streamInfo.cursorPts + 2.0)) {
        streamInfo.cursorPts = -1;
      }

      if (streamInfo.isDecoding) {
        // Coalesce latest request while worker is busy
        streamInfo.pendingRequest = { timeSec, isExport, mode };
        return;
      }

      streamInfo.isDecoding = true;
      this.stats.gopDecodes++;

      const id = ++this.requestId;
      const isPlaying = (typeof window !== 'undefined' && !!window.isTimelinePlaying);
      const batchCount = isPlaying ? this.streamBatchCount : Math.min(10, this.streamBatchCount);
      this.worker.postMessage({
        type: 'stream_ahead',
        id: id,
        mediaId: streamInfo.mediaId,
        timeSec: timeSec,
        count: batchCount,
        mode: mode,
        isExport: !!isExport,
        maxW: this.maxPreviewW,
        maxH: this.maxPreviewH
      });
    }

    ensureLoaded(mediaId, dataUrlOrBlob) {
      if (!this.isSupported || !this.worker || !mediaId || !dataUrlOrBlob) {
        return Promise.resolve(false);
      }
      const existing = this.streams.get(mediaId);
      if (existing) {
        if (existing.ready) return Promise.resolve(true);
        if (existing.failed) return Promise.resolve(false);
        if (existing.initPromise) return existing.initPromise;
      }

      const streamInfo = {
        mediaId: mediaId,
        ready: false,
        failed: false,
        error: null,
        width: 1920,
        height: 1080,
        duration: 0,
        fps: 30,
        sampleCount: 0,
        gops: [],
        isProxy: false,
        frames: new Map(),
        sortedFrames: [],
        sortedDirty: false,
        isDecoding: false,
        cursorPts: -1,
        pendingRequest: null,
        isSeekingWorker: false,
        pendingSeekTime: null,
        pendingSeekOpts: null,
        pendingResolves: null,
        lastRequestedSec: 0,
        lastSpeed: 1.0,
        resolveInit: null,
        rejectInit: null,
        initPromise: null
      };
      this.streams.set(mediaId, streamInfo);

      streamInfo.initPromise = this._fetchAndInitStream(streamInfo, dataUrlOrBlob);
      return streamInfo.initPromise;
    }

    async _fetchAndInitStream(streamInfo, dataUrlOrBlob) {
      try {
        let arrayBuffer = null;
        if (dataUrlOrBlob instanceof ArrayBuffer) {
          arrayBuffer = dataUrlOrBlob.slice(0);
        } else if (dataUrlOrBlob instanceof Blob) {
          arrayBuffer = await dataUrlOrBlob.arrayBuffer();
        } else if (typeof dataUrlOrBlob === 'string') {
          if (dataUrlOrBlob.startsWith('data:')) {
            try {
              const res = await fetch(dataUrlOrBlob);
              arrayBuffer = await res.arrayBuffer();
            } catch (_) {
              const commaIdx = dataUrlOrBlob.indexOf(',');
              const base64 = commaIdx !== -1 ? dataUrlOrBlob.substring(commaIdx + 1) : dataUrlOrBlob;
              const binary = atob(base64);
              const len = binary.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              arrayBuffer = bytes.buffer;
            }
          } else {
            const res = await fetch(dataUrlOrBlob);
            arrayBuffer = await res.arrayBuffer();
          }
        }

        if (!arrayBuffer || arrayBuffer.byteLength < 16) {
          streamInfo.failed = true;
          streamInfo.error = 'Empty buffer';
          return false;
        }

        if (this.streams.get(streamInfo.mediaId) !== streamInfo) {
          return false;
        }

        const result = await new Promise((resolve) => {
          streamInfo.resolveInit = resolve;
          const id = ++this.requestId;
          this.worker.postMessage(
            { type: 'init', id: id, mediaId: streamInfo.mediaId, buffer: arrayBuffer },
            [arrayBuffer]
          );
        });
        return !!(result && result.ready);
      } catch (err) {
        streamInfo.failed = true;
        streamInfo.error = String(err);
        return false;
      }
    }

    async loadMedia(mediaId, dataUrlOrBlob) {
      const ok = await this.ensureLoaded(mediaId, dataUrlOrBlob);
      return ok ? this.streams.get(mediaId) : false;
    }

    /**
     * Synchronous 0ms frame lookup for 60fps requestAnimationFrame render loop.
     * Continuously keeps >= 1.2s buffered ahead of playhead for freeze-free playback.
     */
    getFrameSync(mediaId, timeSec, opts = {}) {
      const out = this._syncResult;
      out.frame = null;
      out.exact = false;
      out.isProxy = false;
      out.status = 'unloaded';

      if (!this.isSupported || !this.worker) return out;
      const stream = this.streams.get(mediaId);
      if (!stream) return out;
      if (stream.failed) {
        out.status = 'failed';
        return out;
      }

      const isExport = !!opts.isExport;
      const noDecode = !!opts.noDecode;
      const speed = (typeof opts.speed === 'number' && isFinite(opts.speed)) ? opts.speed : 1.0;
      const reqSec = Math.max(0, timeSec || 0);
      const prevSec = stream.lastRequestedSec;
      const isContinuousMotion = !noDecode && ((typeof window !== 'undefined' && !!window.isTimelinePlaying) || (Math.abs(reqSec - prevSec) > 0.0001 && Math.abs(reqSec - prevSec) <= 0.25));
      if (!noDecode) {
        stream.lastRequestedSec = reqSec;
        stream.lastSpeed = speed;
      }

      if (!stream.ready) {
        out.status = 'loading';
        return out;
      }

      const maxTime = stream.duration > 0 ? Math.max(0, stream.duration - 0.001) : reqSec;
      const clampedSec = Math.max(0, Math.min(maxTime, reqSec));
      if (!noDecode) {
        stream.lastRequestedSec = clampedSec;
      }

      const sorted = this._ensureSortedFrames(stream);
      const closestIdx = this._findClosestIndex(sorted, clampedSec);
      const closest = closestIdx >= 0 ? sorted[closestIdx] : null;
      const frameDur = 1 / Math.max(15, stream.fps || 30);
      const tolerance = Math.max(0.04, frameDur * 1.65);

      if (closest && Math.abs(closest.pts - clampedSec) <= tolerance && (!isExport || !closest.isProxy)) {
        closest.lastUsed = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        this.stats.hits++;

        // Continuous forward lookahead: keep >= 1.2s buffered ahead during playback / continuous motion
        if (!isExport && !noDecode && !stream.isDecoding && isContinuousMotion) {
          const maxGap = Math.max(0.08, frameDur * 2.5);
          if (speed >= 0) {
            const bufferedEndPts = this._measureContiguousAhead(sorted, closestIdx, maxGap);
            const cursorValid = (stream.cursorPts >= bufferedEndPts && stream.cursorPts <= bufferedEndPts + 1.5);
            const effectiveFrontier = cursorValid ? stream.cursorPts : bufferedEndPts;
            const aheadSec = effectiveFrontier - clampedSec;
            const lookaheadTarget = Math.min(1.5, Math.max(0.95, 1.0 * Math.max(1, speed)));
            if (aheadSec < lookaheadTarget && effectiveFrontier < (stream.duration - frameDur * 1.5)) {
              const useContinue = (stream.cursorPts >= clampedSec - 0.1 && stream.cursorPts <= effectiveFrontier + 1.0);
              this._dispatchStreamAhead(
                stream,
                effectiveFrontier + frameDur,
                false,
                useContinue ? 'continue' : 'auto'
              );
            }
          } else {
            // Reverse playback lookahead: keep >= 0.8s buffered behind playhead
            let bufferedStartPts = closest.pts;
            for (let i = closestIdx - 1; i >= 0; i--) {
              if (bufferedStartPts - sorted[i].pts > maxGap) break;
              bufferedStartPts = sorted[i].pts;
            }
            const behindSec = clampedSec - bufferedStartPts;
            if (behindSec < 0.8 && bufferedStartPts > frameDur) {
              this._dispatchStreamAhead(stream, Math.max(0, bufferedStartPts - 0.9), false, 'auto');
            }
          }
        }

        out.frame = closest.bitmap;
        out.exact = true;
        out.isProxy = !!closest.isProxy;
        out.status = 'hit';
        return out;
      }

      if (noDecode) {
        out.status = 'miss_readonly';
        return out;
      }

      // Cache miss -> request continuous stream from clampedSec immediately
      this.stats.misses++;
      this._dispatchStreamAhead(stream, clampedSec, isExport);

      // Return nearest cached frame so scrubbing/playback never flashes black
      if (closest && !isExport && Math.abs(closest.pts - clampedSec) <= 2.5) {
        out.frame = closest.bitmap;
        out.exact = false;
        out.isProxy = !!closest.isProxy;
        out.status = 'nearest';
        return out;
      }

      out.status = 'decoding';
      return out;
    }

    seekFrame(mediaId, timeSec, opts = {}) {
      if (!this.isSupported || !this.worker) return Promise.resolve(null);
      const stream = this.streams.get(mediaId);
      if (!stream || !stream.ready) return Promise.resolve(null);

      const isExport = !!opts.isExport;
      const ownCopy = !!opts.ownCopy;
      const clampedSec = Math.max(0, Math.min(stream.duration > 0 ? stream.duration : timeSec, timeSec || 0));
      const sorted = this._ensureSortedFrames(stream);
      const closestIdx = this._findClosestIndex(sorted, clampedSec);
      const closest = closestIdx >= 0 ? sorted[closestIdx] : null;
      // Exact consumers (AI matting) need the true frame, not a neighbour within the playback tolerance
      const tolerance = ownCopy
        ? Math.max(0.004, 0.55 / Math.max(15, stream.fps || 30))
        : Math.max(0.04, 1.65 / Math.max(15, stream.fps || 30));

      if (closest && Math.abs(closest.pts - clampedSec) <= tolerance && (!isExport || !closest.isProxy)) {
        closest.lastUsed = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        this.stats.hits++;
        if (ownCopy) {
          // Private copy: the LRU may close the shared bitmap at any time
          const shared = closest.bitmap;
          return (typeof createImageBitmap === 'function')
            ? createImageBitmap(shared).catch(() => null)
            : Promise.resolve(null);
        }
        return Promise.resolve(closest.bitmap);
      }

      if (stream.isSeekingWorker) {
        stream.pendingSeekTime = clampedSec;
        stream.pendingSeekOpts = opts;
        return new Promise((resolve) => {
          if (!stream.pendingResolves) stream.pendingResolves = [];
          stream.pendingResolves.push(resolve);
        });
      }

      stream.isSeekingWorker = true;
      const id = ++this.requestId;
      const isProxy = !isExport && (stream.width > this.maxPreviewW || stream.height > this.maxPreviewH);
      return new Promise((resolve) => {
        this.pendingRequests.set(id, { resolve, isProxy, noCache: ownCopy });
        this.worker.postMessage({
          type: 'seek',
          id: id,
          mediaId: mediaId,
          timeSec: clampedSec,
          isExport: isExport,
          maxW: this.maxPreviewW,
          maxH: this.maxPreviewH
        });
      });
    }

    getFrameAsync(mediaId, timeSec, opts = {}) {
      return this.seekFrame(mediaId, timeSec, opts);
    }

    getSourceKey(layer) {
      if (!layer) return '';
      if (layer.mediaId) return String(layer.mediaId);
      if (layer.dataUrl) return String(layer.dataUrl);
      return layer.id ? String(layer.id) : '';
    }

    async ensureLayersLoaded(layers, isCancelled = null) {
      if (!this.isSupported || !Array.isArray(layers) || layers.length === 0) return true;
      const videoLayers = [];
      const collect = (list) => {
        for (let i = 0; i < list.length; i++) {
          const l = list[i];
          if (!l || l.hidden) continue;
          if (l.type === 'video') {
            videoLayers.push(l);
          } else if (l.type === 'precomp' && Array.isArray(l.layers)) {
            collect(l.layers);
          }
        }
      };
      collect(layers);
      if (videoLayers.length === 0) return true;

      let dbMedias = null;
      if (typeof window !== 'undefined' && window.FishDatabase && window.currentProjectState && window.currentProjectState.id) {
        try {
          dbMedias = await window.FishDatabase.getProjectMedia(window.currentProjectState.id);
        } catch (_) {}
      }

      for (let i = 0; i < videoLayers.length; i++) {
        if (isCancelled && isCancelled()) return false;
        const vl = videoLayers[i];
        let mediaBlob = null;
        if (Array.isArray(dbMedias) && dbMedias.length > 0) {
          let m = vl.mediaId ? dbMedias.find(item => item.id === vl.mediaId) : null;
          if (!m && vl.name) m = dbMedias.find(item => item.name === vl.name && (item.type === 'video' || !item.type));
          if (m) {
            if (m.id && !vl.mediaId) vl.mediaId = m.id;
            if (m.blob) mediaBlob = m.blob;
            if (!vl.dataUrl && m.dataUrl) {
              vl.dataUrl = m.dataUrl;
            } else if (!vl.dataUrl && m.blob) {
              try { vl.dataUrl = URL.createObjectURL(m.blob); } catch (_) {}
            }
            if (m.duration && !vl.mediaDuration) vl.mediaDuration = m.duration;
          }
        }

        const key = this.getSourceKey(vl);
        const lowerName = (vl.name || '').toLowerCase();
        const lowerUrl = (typeof vl.dataUrl === 'string') ? vl.dataUrl.slice(0, 64).toLowerCase() : '';
        if (!key || lowerName.endsWith('.webm') || lowerUrl.startsWith('data:video/webm')) continue;
        const src = mediaBlob || vl.dataUrl;
        if (src && !this.hasStream(key) && !this.isFailed(key)) {
          await this.ensureLoaded(key, src);
        }
      }
      return true;
    }

    hasStream(mediaId) {
      const s = this.streams.get(mediaId);
      return !!(s && s.ready && !s.failed);
    }

    /**
     * Read-only check: returns true only if an exact decoded frame for timeSec is already resident in RAM.
     * Never mutates cursor state or triggers worker decodes (safe for PreviewCacheManager idle checks).
     */
    /**
     * Proactively warm VideoStreamManager for video layers active at targetSec.
     * Called from PreviewCacheManager's early-hit fast path when approaching an uncached boundary
     * so Cached -> Uncached transitions never stall the hardware decoder.
     */
    warmAheadForLayers(layers, targetSec, pps = 80) {
      if (!this.isSupported || !this.worker || !Array.isArray(layers) || !layers.length) return;
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        if (!l || l.hidden) continue;
        if (l.type === 'video') {
          const start = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
          const dur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 400) / pps);
          if (targetSec >= start && targetSec < start + dur) {
            const key = this.getSourceKey(l);
            const stream = key ? this.streams.get(key) : null;
            if (stream && stream.ready && !stream.failed && !stream.isDecoding) {
              const clipTime = (typeof window !== 'undefined' && window.VideoCompEngine && typeof window.VideoCompEngine.computeLayerClipTime === 'function')
                ? window.VideoCompEngine.computeLayerClipTime(l, targetSec, pps)
                : Math.max(0, (l.sourceOffsetSec || 0) + (targetSec - start) * (l.speed || 1.0));
              if (!this.hasExactFrame(key, clipTime)) {
                const useContinue = (stream.cursorPts >= clipTime - 0.5 && stream.cursorPts <= clipTime + 0.5);
                this._dispatchStreamAhead(stream, clipTime, false, useContinue ? 'continue' : 'auto');
              }
            }
          }
        } else if (l.type === 'precomp' && Array.isArray(l.layers)) {
          const start = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
          const dur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 400) / pps);
          if (targetSec >= start && targetSec < start + dur) {
            const innerSec = Math.max(0, (l.sourceOffsetSec || 0) + (targetSec - start) * (l.speed || 1.0));
            this.warmAheadForLayers(l.layers, innerSec, pps);
          }
        }
      }
    }

    hasExactFrame(mediaId, timeSec) {
      if (!this.isSupported) return false;
      const stream = this.streams.get(mediaId);
      if (!stream || !stream.ready || stream.failed) return false;
      const sorted = this._ensureSortedFrames(stream);
      if (!sorted.length) return false;
      const maxTime = stream.duration > 0 ? Math.max(0, stream.duration - 0.001) : (timeSec || 0);
      const clampedSec = Math.max(0, Math.min(maxTime, timeSec || 0));
      const idx = this._findClosestIndex(sorted, clampedSec);
      if (idx < 0) return false;
      const frameDur = 1 / Math.max(15, stream.fps || 30);
      const tolerance = Math.max(0.04, frameDur * 1.65);
      return Math.abs(sorted[idx].pts - clampedSec) <= tolerance;
    }

    isFailed(mediaId) {
      const s = this.streams.get(mediaId);
      return !!(s && s.failed);
    }

    releaseMedia(mediaId) {
      if (this.worker) {
        this.worker.postMessage({ type: 'release', id: ++this.requestId, mediaId: mediaId });
      }
      const stream = this.streams.get(mediaId);
      if (stream) {
        for (const entry of stream.frames.values()) {
          _closeFrameSafe(entry.bitmap);
          this._totalCachedFrames = Math.max(0, this._totalCachedFrames - 1);
        }
        stream.frames.clear();
        stream.sortedFrames.length = 0;
        this.streams.delete(mediaId);
      }
    }

    releaseAll() {
      const ids = Array.from(this.streams.keys());
      for (let i = 0; i < ids.length; i++) {
        this.releaseMedia(ids[i]);
      }
      this._totalCachedFrames = 0;
    }

    getStats() {
      const totalLookups = this.stats.hits + this.stats.misses;
      return {
        supported: this.isSupported,
        isMobile: this.isMobile,
        activeStreams: this.streams.size,
        cachedFrames: this._totalCachedFrames,
        maxCacheFrames: this.maxCacheFrames,
        maxPreviewDims: [this.maxPreviewW, this.maxPreviewH],
        hits: this.stats.hits,
        misses: this.stats.misses,
        hitRate: totalLookups > 0 ? Math.round((this.stats.hits / totalLookups) * 1000) / 10 : 0,
        evictions: this.stats.evictions,
        gopDecodes: this.stats.gopDecodes
      };
    }
  }

  window.VideoStreamManager = new VideoStreamManager();
})(typeof window !== 'undefined' ? window : globalThis);
