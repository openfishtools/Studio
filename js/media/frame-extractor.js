/**
 * Studio/js/media/frame-extractor.js
 * FishTool Studio - Turbo Video & Precomp Frame Sequence Extractor
 *
 * Features:
 * 1. Global Source Cache: Keyed by mediaId / dataUrl / precompId. Duplicate layers share the exact same frames.
 * 2. Hardware WebCodecs Parallel Zero-Copy Pipeline: Direct parallel createImageBitmap(videoFrame) with GOP prioritization.
 * 3. Native Sample Deduplication: Shared ImageBitmaps across timeline frames mapping to the same video PTS sample.
 * 4. Deferred Idle IndexedDB Persistence: WebP encoding runs strictly after extraction finishes so 100% of CPU/GPU goes to extraction.
 * 5. Precomp Sequence Baking: Pre-extracts non-collapsed precomp layers and nested video layers into RAM ImageBitmaps.
 */

(function(window) {
  'use strict';

  const DB_NAME = 'FishFrameCacheDB';
  const DB_VERSION = 4;
  const STORE_NAME = 'frames';

  function openFrameCacheDB() {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        resolve(null);
        return;
      }
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (db.objectStoreNames.contains(STORE_NAME)) {
            db.deleteObjectStore(STORE_NAME);
          }
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('sourceKey', 'sourceKey', { unique: false });
          store.createIndex('sourceFpsKey', ['sourceKey', 'fps'], { unique: false });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  function yieldToUI(delayMs = 0) {
    if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function' && delayMs === 0) {
      return scheduler.yield();
    }
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }

  function getSafariMajorVersion() {
    if (typeof navigator === 'undefined' || !navigator.userAgent) return 0;
    const ua = navigator.userAgent;
    if (!/Safari\//.test(ua) || /Chrome\/|Chromium\/|EdgA\/|FxiOS\//.test(ua)) return 0;
    const m = ua.match(/Version\/(\d+)\./);
    return m ? parseInt(m[1], 10) : 0;
  }

  function isMobileOrLowMemDevice() {
    if (typeof window === 'undefined') return false;
    const isSmallScreen = window.innerWidth <= 768 || ('ontouchstart' in window && window.innerWidth <= 1024);
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    const devMem = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : 8;
    return isSmallScreen || isMobileUA || devMem <= 4;
  }

  function getDeviceRamTier() {
    const mobile = isMobileOrLowMemDevice();
    const devMem = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : (mobile ? 3 : 8);
    if (mobile || devMem <= 2) {
      return {
        isMobile: true,
        maxRamFramesPerSource: 210,
        maxTotalRamFrames: 360,
        maxTargetDim: 640,
        maxDecodeQueue: 6,
        maxPendingBitmaps: 4,
        dbBatchSize: 4
      };
    }
    if (devMem <= 4) {
      return {
        isMobile: false,
        maxRamFramesPerSource: 450,
        maxTotalRamFrames: 720,
        maxTargetDim: 800,
        maxDecodeQueue: 10,
        maxPendingBitmaps: 8,
        dbBatchSize: 6
      };
    }
    return {
      isMobile: false,
      maxRamFramesPerSource: 1200,
      maxTotalRamFrames: 2000,
      maxTargetDim: 960,
      maxDecodeQueue: 16,
      maxPendingBitmaps: 12,
      dbBatchSize: 10
    };
  }

  function retainBitmap(bmp, sourceKey) {
    if (!bmp) return bmp;
    bmp._refCount = (bmp._refCount || 0) + 1;
    if (sourceKey && !bmp._streamKey) {
      bmp._streamKey = sourceKey;
    }
    return bmp;
  }

  function releaseBitmap(bmp) {
    if (!bmp) return;
    bmp._refCount = Math.max(0, (bmp._refCount || 1) - 1);
    if (bmp._refCount <= 0 && !bmp._pendingDbEncode && typeof bmp.close === 'function') {
      try { bmp.close(); } catch (_) {}
    }
  }

  /**
   * Fast ISO-BMFF / MP4 / MOV Demuxer for WebCodecs Hardware Batch Extraction
   */
  class FastMP4Demuxer {
    constructor(arrayBuffer) {
      this.buffer = arrayBuffer;
      this.view = new DataView(arrayBuffer);
      this.videoTrack = null;
      this._parse();
    }

    _parse() {
      let offset = 0;
      const len = this.buffer.byteLength;
      while (offset + 8 <= len) {
        const size = this.view.getUint32(offset);
        const type = this._readString(offset + 4, 4);
        let boxSize = size;
        let headerSize = 8;
        if (size === 1) {
          if (offset + 16 > len) break;
          boxSize = Number(this.view.getBigUint64(offset + 8));
          headerSize = 16;
        } else if (size === 0) {
          boxSize = len - offset;
        }
        if (boxSize < headerSize || offset + boxSize > len) break;

        if (type === 'moov') {
          this._parseMoov(offset + headerSize, offset + boxSize);
          if (this.videoTrack) break;
        }
        offset += boxSize;
      }
    }

    _parseMoov(start, end) {
      for (const box of this._findSubBoxes(start, end)) {
        if (box.type === 'trak') {
          const track = this._parseTrak(box.start, box.end);
          if (track && track.isVideo && track.samples && track.samples.length > 0) {
            this.videoTrack = track;
            break;
          }
        }
      }
    }

    _parseTrak(start, end) {
      const trakBoxes = this._findSubBoxes(start, end);
      const mdiaBox = trakBoxes.find(b => b.type === 'mdia');
      if (!mdiaBox) return null;

      let timescale = 1000;
      let isVideo = false;
      let stblBox = null;

      for (const box of this._findSubBoxes(mdiaBox.start, mdiaBox.end)) {
        if (box.type === 'mdhd' && box.start + 16 <= box.end) {
          const version = this.view.getUint8(box.start);
          timescale = (version === 1 && box.start + 24 <= box.end)
            ? this.view.getUint32(box.start + 20)
            : this.view.getUint32(box.start + 12);
        } else if (box.type === 'hdlr' && box.start + 12 <= box.end) {
          const handlerType = this._readString(box.start + 8, 4);
          if (handlerType === 'vide') isVideo = true;
        } else if (box.type === 'minf') {
          const minfBoxes = this._findSubBoxes(box.start, box.end);
          stblBox = minfBoxes.find(b => b.type === 'stbl');
        }
      }

      if (!isVideo || !stblBox || !timescale) return null;
      return this._parseStbl(stblBox.start, stblBox.end, timescale);
    }

    _parseStbl(start, end, timescale) {
      const boxes = this._findSubBoxes(start, end);
      let codec = null;
      let width = 0, height = 0;
      let description = null;
      const sampleDurations = [];
      const compositionOffsets = [];
      let hasCtts = false;
      let keyframeIndexes = null;
      const sampleSizes = [];
      const chunkOffsets = [];
      const sampleToChunk = [];

      for (const box of boxes) {
        const p = box.start;
        if (box.type === 'stsd' && p + 8 <= box.end) {
          const entryCount = this.view.getUint32(p + 4);
          if (entryCount > 0 && p + 16 <= box.end) {
            const entryStart = p + 8;
            const entrySize = this.view.getUint32(entryStart);
            const format = this._readString(entryStart + 4, 4);
            if (entryStart + 36 <= box.end) {
              width = this.view.getUint16(entryStart + 32);
              height = this.view.getUint16(entryStart + 34);
            }
            const subBoxStart = entryStart + 86;
            const subBoxEnd = Math.min(box.end, entryStart + entrySize);
            if (subBoxStart + 8 <= subBoxEnd) {
              const subBoxes = this._findSubBoxes(subBoxStart, subBoxEnd);
              const codecBox = subBoxes.find(b => b.type === 'avcC' || b.type === 'hvcC' || b.type === 'vpcC' || b.type === 'av1C');
              if (codecBox && codecBox.end > codecBox.start) {
                description = new Uint8Array(this.buffer.slice(codecBox.start, codecBox.end));
                if (codecBox.type === 'avcC' && (codecBox.end - codecBox.start) >= 4) {
                  const profile = this.view.getUint8(codecBox.start + 1).toString(16).padStart(2, '0');
                  const compat = this.view.getUint8(codecBox.start + 2).toString(16).padStart(2, '0');
                  const level = this.view.getUint8(codecBox.start + 3).toString(16).padStart(2, '0');
                  codec = `avc1.${profile}${compat}${level}`;
                } else if (codecBox.type === 'hvcC') {
                  codec = format === 'hev1' ? 'hev1.1.6.L93.B0' : 'hvc1.1.6.L93.B0';
                } else if (codecBox.type === 'vpcC') {
                  codec = 'vp09.00.10.08';
                } else if (codecBox.type === 'av1C') {
                  codec = 'av01.0.04M.08';
                }
              }
            }
          }
        } else if (box.type === 'stts' && p + 8 <= box.end) {
          const count = this.view.getUint32(p + 4);
          let ptr = p + 8;
          for (let i = 0; i < count && ptr + 8 <= box.end; i++) {
            const sCount = this.view.getUint32(ptr);
            const sDelta = this.view.getUint32(ptr + 4);
            ptr += 8;
            for (let j = 0; j < sCount; j++) {
              sampleDurations.push(sDelta);
            }
          }
        } else if (box.type === 'ctts' && p + 8 <= box.end) {
          hasCtts = true;
          const version = this.view.getUint8(p);
          const count = this.view.getUint32(p + 4);
          let ptr = p + 8;
          for (let i = 0; i < count && ptr + 8 <= box.end; i++) {
            const sCount = this.view.getUint32(ptr);
            const sOffset = version === 1 ? this.view.getInt32(ptr + 4) : this.view.getUint32(ptr + 4);
            ptr += 8;
            for (let j = 0; j < sCount; j++) {
              compositionOffsets.push(sOffset);
            }
          }
        } else if (box.type === 'stss' && p + 8 <= box.end) {
          const count = this.view.getUint32(p + 4);
          keyframeIndexes = new Set();
          let ptr = p + 8;
          for (let i = 0; i < count && ptr + 4 <= box.end; i++) {
            keyframeIndexes.add(this.view.getUint32(ptr) - 1);
            ptr += 4;
          }
        } else if (box.type === 'stsz' && p + 12 <= box.end) {
          const uniformSize = this.view.getUint32(p + 4);
          const count = this.view.getUint32(p + 8);
          let ptr = p + 12;
          for (let i = 0; i < count; i++) {
            sampleSizes.push(uniformSize || (ptr + 4 <= box.end ? this.view.getUint32(ptr) : 0));
            if (!uniformSize) ptr += 4;
          }
        } else if (box.type === 'stsc' && p + 8 <= box.end) {
          const count = this.view.getUint32(p + 4);
          let ptr = p + 8;
          for (let i = 0; i < count && ptr + 12 <= box.end; i++) {
            sampleToChunk.push({
              firstChunk: this.view.getUint32(ptr),
              samplesPerChunk: this.view.getUint32(ptr + 4),
              sampleDescIdx: this.view.getUint32(ptr + 8)
            });
            ptr += 12;
          }
        } else if (box.type === 'stco' && p + 8 <= box.end) {
          const count = this.view.getUint32(p + 4);
          let ptr = p + 8;
          for (let i = 0; i < count && ptr + 4 <= box.end; i++) {
            chunkOffsets.push(this.view.getUint32(ptr));
            ptr += 4;
          }
        } else if (box.type === 'co64' && p + 8 <= box.end) {
          const count = this.view.getUint32(p + 4);
          let ptr = p + 8;
          for (let i = 0; i < count && ptr + 8 <= box.end; i++) {
            chunkOffsets.push(Number(this.view.getBigUint64(ptr)));
            ptr += 8;
          }
        }
      }

      if (!codec || sampleSizes.length === 0 || chunkOffsets.length === 0) return null;

      let curDts = 0;
      let minCts = Infinity;
      const rawCtsList = new Float64Array(sampleSizes.length);
      for (let i = 0; i < sampleSizes.length; i++) {
        const dur = sampleDurations[i] !== undefined ? sampleDurations[i] : (sampleDurations[0] || 1);
        const ctsOffset = hasCtts && compositionOffsets[i] !== undefined ? compositionOffsets[i] : 0;
        const cts = curDts + ctsOffset;
        rawCtsList[i] = cts;
        if (cts < minCts) minCts = cts;
        curDts += dur;
      }
      if (!isFinite(minCts)) minCts = 0;

      const samples = [];
      let chunkIdx = 0;
      let sampleInChunk = 0;
      let curChunkOffset = chunkOffsets[0] || 0;
      let stscIdx = 0;
      curDts = 0;

      for (let i = 0; i < sampleSizes.length; i++) {
        const isKey = keyframeIndexes ? keyframeIndexes.has(i) : (i === 0);
        const size = sampleSizes[i];
        const dur = sampleDurations[i] !== undefined ? sampleDurations[i] : (sampleDurations[0] || 1);
        const ptsSec = Math.max(0, (rawCtsList[i] - minCts) / timescale);
        const dtsSec = curDts / timescale;

        while (stscIdx + 1 < sampleToChunk.length && (chunkIdx + 1) >= sampleToChunk[stscIdx + 1].firstChunk) {
          stscIdx++;
        }
        const samplesPerChunk = sampleToChunk[stscIdx] ? sampleToChunk[stscIdx].samplesPerChunk : 1;

        if (curChunkOffset + size <= this.buffer.byteLength && size > 0) {
          samples.push({
            index: samples.length,
            offset: curChunkOffset,
            size: size,
            pts: ptsSec,
            dts: dtsSec,
            duration: dur / timescale,
            isKey: isKey
          });
        }

        curChunkOffset += size;
        sampleInChunk++;
        if (sampleInChunk >= samplesPerChunk) {
          chunkIdx++;
          sampleInChunk = 0;
          curChunkOffset = chunkOffsets[chunkIdx] || 0;
        }
        curDts += dur;
      }

      return {
        isVideo: true,
        codec: codec,
        width: width || 1920,
        height: height || 1080,
        description: description,
        timescale: timescale,
        duration: curDts / timescale,
        samples: samples
      };
    }

    _findSubBoxes(start, end) {
      const boxes = [];
      let offset = start;
      while (offset + 8 <= end) {
        const size = this.view.getUint32(offset);
        const type = this._readString(offset + 4, 4);
        let boxSize = size;
        let headerSize = 8;
        if (size === 1) {
          if (offset + 16 > end) break;
          boxSize = Number(this.view.getBigUint64(offset + 8));
          headerSize = 16;
        } else if (size === 0) {
          boxSize = end - offset;
        }
        if (boxSize < headerSize || offset + boxSize > end) break;
        boxes.push({ type, start: offset + headerSize, end: offset + boxSize });
        offset += boxSize;
      }
      return boxes;
    }

    _readString(offset, length) {
      let str = '';
      for (let i = 0; i < length; i++) {
        str += String.fromCharCode(this.view.getUint8(offset + i));
      }
      return str;
    }
  }

  class VideoFrameExtractor {
    constructor() {
      this.sources = new Map();
      this._targetFps = 60;
      this.isDraftMode = false;
      const tier = getDeviceRamTier();
      this._deviceTier = tier;
      this.maxRamFrames = tier.maxRamFramesPerSource;
      this.maxTotalRamFrames = tier.maxTotalRamFrames;
      this._activeTasks = new Map(); // taskId -> { id, layerId, sourceKey, layerName, type, percent, status }
      this._progressListeners = new Set();
      this._db = null;
      this._dbPromise = null;
      this._saveQueue = [];
      this._blobEncodeQueue = [];
      this._isDrainingBlobQueue = false;
      this._dbEncodeCanvas = null;
      this._dbEncodeCtx = null;
      this._flushTimer = null;
      this._rafProgressBarScheduled = false;
      this._extractionSourceQueue = [];
      this._isProcessingSourceQueue = false;

      this._interpCache = new Map();
      this._ofCanvas0 = null;
      this._ofCtx0 = null;
      this._ofCanvas1 = null;
      this._ofCtx1 = null;

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        const markInteraction = () => {
          window._lastUserInteractionTime = Date.now();
        };
        window.addEventListener('pointerdown', markInteraction, { passive: true, capture: true });
        window.addEventListener('pointermove', (e) => {
          if (e.buttons > 0) markInteraction();
        }, { passive: true, capture: true });
        window.addEventListener('wheel', markInteraction, { passive: true, capture: true });
        window.addEventListener('keydown', markInteraction, { passive: true, capture: true });

        window.addEventListener('beforeunload', () => {
          this._flushSaveQueue();
        });
      }
    }

    addProgressListener(fn) {
      if (typeof fn === 'function') {
        this._progressListeners.add(fn);
        try { fn(this.getActiveTasks()); } catch (_) {}
      }
    }

    removeProgressListener(fn) {
      this._progressListeners.delete(fn);
    }

    _notifyProgress() {
      const tasks = this.getActiveTasks();
      for (const fn of this._progressListeners) {
        try { fn(tasks); } catch (_) {}
      }
    }

    getAllBakingTasks() {
      const activeMap = this._activeTasks;
      const tasks = [];
      const seenSourceKeys = new Set();

      const validLayers = this._collectMatchingLayers(l => l && (l.type === 'video' || l.type === 'precomp') && !l.hidden);
      const validLayerIds = new Set(validLayers.map(l => l.id));
      const validSourceKeys = new Set(validLayers.map(l => this._getSourceKey(l)).filter(Boolean));

      // 1. Include active tasks currently in this._activeTasks, deduplicated by sourceKey
      for (const [key, t] of activeMap.entries()) {
        if (t.cancelled) {
          activeMap.delete(key);
          continue;
        }
        // Prune orphaned tasks created for non-layer media pool items or deleted layers
        if (validLayers.length > 0 && t.sourceKey && !validSourceKeys.has(t.sourceKey) && (!t.layerId || !validLayerIds.has(t.layerId))) {
          if (t._dismissTimer) clearTimeout(t._dismissTimer);
          activeMap.delete(key);
          continue;
        }
        const dedupeKey = t.sourceKey || t.layerId || t.id;
        if (seenSourceKeys.has(dedupeKey)) {
          if (t._dismissTimer) clearTimeout(t._dismissTimer);
          activeMap.delete(key);
          continue;
        }
        seenSourceKeys.add(dedupeKey);
        tasks.push(t);
      }

      // 2. If AI Background Removal is active on any layer, ensure its baking status is also present
      const activeBgLayerIds = new Set();
      if (typeof window !== 'undefined' && window.FishBgRemovalEngine && typeof window.FishBgRemovalEngine.getActiveTasks === 'function') {
        const bgTasks = window.FishBgRemovalEngine.getActiveTasks().filter(t => !t.cancelled && t.percent < 100);
        bgTasks.forEach(t => { if (t.layerId) activeBgLayerIds.add(t.layerId); });
      }

      if (activeBgLayerIds.size > 0 && validLayers.length > 0) {
        for (const layer of validLayers) {
          if (!activeBgLayerIds.has(layer.id)) continue;
          const sourceKey = this._getSourceKey(layer);
          const dedupeKey = sourceKey || layer.id;
          if (seenSourceKeys.has(dedupeKey)) continue;

          const source = sourceKey ? this.sources.get(sourceKey) : null;
          const { startIdx, endIdx, total } = this.getLayerFrameRange(layer);

          let cachedCount = 0;
          if (layer._extractComplete) {
            cachedCount = total;
          } else if (source) {
            for (let i = startIdx; i <= endIdx; i++) {
              if (source.frames.has(i) || (source.cachedFrameIndices && source.cachedFrameIndices.has(i))) {
                cachedCount++;
              }
            }
          }

          const isBaked = this.isLayerBaked(layer) || (total > 0 && cachedCount >= total);
          const pct = isBaked ? 100 : Math.round((cachedCount / total) * 100);

          tasks.push({
            id: `bake_${dedupeKey}`,
            layerId: layer.id,
            sourceKey: sourceKey,
            layerName: layer.name || (layer.type === 'precomp' ? 'Precomposition' : 'Video Clip'),
            type: 'baking',
            thumbUrl: layer.thumbUrl || layer.mediaUrl || layer.dataUrl || '',
            status: isBaked ? 'Video Baked (100% Ready)' : `Baking frames: ${cachedCount}/${total} (${pct}%)`,
            currentFrame: isBaked ? total : cachedCount,
            totalFrames: total,
            percent: pct,
            cancelled: false
          });
          seenSourceKeys.add(dedupeKey);
        }
      }

      return tasks;
    }

    getActiveTasks() {
      return this.getAllBakingTasks();
    }

    cancelTask(taskId) {
      let task = this._activeTasks.get(taskId);
      if (!task) {
        for (const [k, v] of this._activeTasks.entries()) {
          if (v.id === taskId || `bake_${v.layerId}` === taskId || `bake_${v.sourceKey}` === taskId) {
            task = v;
            taskId = k;
            break;
          }
        }
      }
      if (task) {
        task.cancelled = true;
        task.status = 'cancelled';
        if (task._dismissTimer) clearTimeout(task._dismissTimer);
        if (task.sourceKey && this.sources.has(task.sourceKey)) {
          const s = this.sources.get(task.sourceKey);
          s.isExtracting = false;
          s._queuedForExtraction = false;
          s._cachedArrayBuffer = null;
        }
        this._activeTasks.delete(taskId);
        this._notifyProgress();
      }
    }

    isLayerBaked(layer) {
      if (!layer) return true;
      if (layer.type !== 'video' && layer.type !== 'precomp') return true;
      const sourceKey = this._getSourceKey(layer);
      const source = this.sources.get(sourceKey);
      if (!source) return false;
      const { startIdx, endIdx, total } = this.getLayerFrameRange(layer);
      if (total <= 0) return true;
      let cached = 0;
      for (let i = startIdx; i <= endIdx; i++) {
        if (source.frames.has(i) || (source.cachedFrameIndices && source.cachedFrameIndices.has(i))) {
          cached++;
        }
      }
      return cached >= total;
    }

    init(options = {}) {
      if (options && options.defaultFps) {
        const parsed = parseInt(options.defaultFps, 10);
        if (!isNaN(parsed) && parsed > 0) {
          this._targetFps = parsed;
        }
      }
      if (options && options.maxRamFrames) {
        this.maxRamFrames = options.maxRamFrames;
      }
    }

    setDraftMode(isDraft) {
      this.isDraftMode = !!isDraft;
    }

    retainBitmap(bmp, sourceKey) {
      return retainBitmap(bmp, sourceKey);
    }

    releaseBitmap(bmp) {
      return releaseBitmap(bmp);
    }

    _isUserInteracting() {
      if (typeof window === 'undefined') return false;
      if (window.isTimelinePlaying) return true;
      if (window.isTimelineScrubbing || window.isTimelinePanning) return true;
      if (window.isUserInteracting || window.isTransformInteracting) return true;
      if (window._lastUserInteractionTime && (Date.now() - window._lastUserInteractionTime < 160)) {
        return true;
      }
      return false;
    }

    /**
     * Collect all layers (including layers inside precomps) that match a predicate
     */
    _collectMatchingLayers(predicate, rootLayers = null, out = []) {
      const list = rootLayers || ((typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) ? window.currentProjectState.layers : []);
      for (const l of list) {
        if (!l) continue;
        if (predicate(l)) out.push(l);
        if (l.type === 'precomp' && Array.isArray(l.layers)) {
          this._collectMatchingLayers(predicate, l.layers, out);
        }
      }
      return out;
    }

    /**
     * Compute current playhead's source-relative frame index for a specific source
     */
    _getVideoFrameForPlayhead(source) {
      if (!source || typeof window === 'undefined') return 0;
      const pps = window.currentPixelsPerSecond || 80;
      const curSec = (typeof window.getCurrentPlayheadTime === 'function')
        ? window.getCurrentPlayheadTime()
        : ((Math.abs(window.timelinePanX || 0)) / pps);

      const matchingLayers = this._collectMatchingLayers(l =>
        (l.type === 'video' || l.type === 'precomp') && !l.hidden && this._getSourceKey(l) === source.sourceKey
      );

      for (const l of matchingLayers) {
        const start = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
        const dur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 400) / pps);
        if (curSec >= start && curSec <= start + dur) {
          const effSpeed = (typeof window.getLayerEffectivePropsAtTime === 'function')
            ? (window.getLayerEffectivePropsAtTime(l, curSec).speed ?? l.speed ?? 1.0)
            : (l.speed !== undefined && l.speed !== 0 ? l.speed : 1.0);
          const timeInClip = effSpeed < 0
            ? Math.max(0, (l.sourceOffsetSec || 0) + Math.max(0, (dur - (curSec - start)) * Math.abs(effSpeed)))
            : Math.max(0, (l.sourceOffsetSec || 0) + (curSec - start) * effSpeed);
          return Math.round(timeInClip * (source.fps || 60));
        }
      }
      for (const l of matchingLayers) {
        const start = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
        const dur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 400) / pps);
        const targetSec = (curSec < start) ? 0 : dur;
        const effSpeed = (typeof window.getLayerEffectivePropsAtTime === 'function')
          ? (window.getLayerEffectivePropsAtTime(l, curSec).speed ?? l.speed ?? 1.0)
          : (l.speed !== undefined && l.speed !== 0 ? l.speed : 1.0);
        const timeInClip = effSpeed < 0
          ? Math.max(0, (l.sourceOffsetSec || 0) + Math.max(0, (dur - targetSec) * Math.abs(effSpeed)))
          : Math.max(0, (l.sourceOffsetSec || 0) + targetSec * effSpeed);
        return Math.round(timeInClip * (source.fps || 60));
      }
      return 0;
    }

    _getTotalRamFrameCount() {
      let total = 0;
      for (const s of this.sources.values()) {
        if (s && s.frames) total += s.frames.size;
      }
      return total;
    }

    _evictOldestFrame(source, protectIdx = null) {
      if (!source || !source.frames) return;
      const tier = this._deviceTier || getDeviceRamTier();
      const maxPerSource = this.maxRamFrames || tier.maxRamFramesPerSource;
      const maxGlobal = this.maxTotalRamFrames || tier.maxTotalRamFrames;

      if (source.frames.size > maxPerSource) {
        this._evictSingleFromSource(source, protectIdx, maxPerSource);
      }

      if (this._getTotalRamFrameCount() > maxGlobal) {
        let largestSource = null;
        let maxCount = 0;
        for (const s of this.sources.values()) {
          if (s && s.frames && s.frames.size > maxCount) {
            maxCount = s.frames.size;
            largestSource = s;
          }
        }
        if (largestSource) {
          this._evictSingleFromSource(largestSource, largestSource === source ? protectIdx : null, 30);
        }
      }
    }

    _isSourceReversePlayback(source) {
      if (!source || typeof window === 'undefined') return false;
      const pps = window.currentPixelsPerSecond || 80;
      const curSec = (typeof window.getCurrentPlayheadTime === 'function')
        ? window.getCurrentPlayheadTime()
        : ((Math.abs(window.timelinePanX || 0)) / pps);

      const matchingLayers = this._collectMatchingLayers(l =>
        (l.type === 'video' || l.type === 'precomp') && !l.hidden && this._getSourceKey(l) === source.sourceKey
      );
      for (const l of matchingLayers) {
        const start = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
        const dur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 400) / pps);
        if (curSec >= start && curSec <= start + dur) {
          const effSpeed = (typeof window.getLayerEffectivePropsAtTime === 'function')
            ? (window.getLayerEffectivePropsAtTime(l, curSec).speed ?? l.speed ?? 1.0)
            : (l.speed !== undefined && l.speed !== 0 ? l.speed : 1.0);
          return effSpeed < 0;
        }
      }
      return false;
    }

    _evictSingleFromSource(source, protectIdx = null, capThreshold = 100) {
      if (!source || !source.frames || source.frames.size <= 1) return;
      const curFIdx = this._getVideoFrameForPlayhead(source);
      const isReverse = this._isSourceReversePlayback(source);

      const pickVictim = (allowPendingEncode) => {
        let worstIdx = -1;
        let worstScore = -1;
        for (const [fIdx, bmp] of source.frames.entries()) {
          if (fIdx === protectIdx) continue;
          if (fIdx === 0 && source.frames.size > 1) continue;
          if (!allowPendingEncode && bmp && bmp._pendingDbEncode) continue;

          let score;
          if (!isReverse) {
            // Forward playback: curFIdx is advancing forward
            if (fIdx < curFIdx) {
              score = (curFIdx - fIdx) + 1000;
            } else {
              const aheadDist = fIdx - curFIdx;
              score = aheadDist > 180 ? (aheadDist + 100) : (aheadDist * 0.1);
            }
          } else {
            // Reverse playback: curFIdx is advancing backward towards 0
            if (fIdx > curFIdx) {
              score = (fIdx - curFIdx) + 1000;
            } else {
              const aheadDist = curFIdx - fIdx;
              score = aheadDist > 180 ? (aheadDist + 100) : (aheadDist * 0.1);
            }
          }

          if (score > worstScore) {
            worstScore = score;
            worstIdx = fIdx;
          }
        }
        return worstIdx;
      };

      let worstIdx = pickVictim(false);
      if (worstIdx === -1 && source.frames.size > capThreshold) {
        worstIdx = pickVictim(true);
      }

      if (worstIdx !== -1) {
        const bmp = source.frames.get(worstIdx);
        source.frames.delete(worstIdx);
        if (bmp && bmp._pendingDbEncode) {
          bmp._pendingDbEncode = false;
        }
        releaseBitmap(bmp);
      }
    }

    _cleanupSourceDecoders(source) {
      if (!source) return;
      if (source.activeDecoder) {
        try {
          if (source.activeDecoder.state !== 'closed') source.activeDecoder.close();
        } catch (_) {}
        source.activeDecoder = null;
      }
      const videosToClean = [];
      if (source.activeVideo) videosToClean.push(source.activeVideo);
      if (Array.isArray(source.activeVideos)) {
        for (const v of source.activeVideos) {
          if (v && !videosToClean.includes(v)) videosToClean.push(v);
        }
      }
      for (const v of videosToClean) {
        try {
          v.pause();
          v.removeAttribute('src');
          v.load();
          if (v.parentNode) v.parentNode.removeChild(v);
        } catch (_) {}
      }
      source.activeVideo = null;
      source.activeVideos = null;
      source._cachedArrayBuffer = null;
    }

    isAnySourceExtracting() {
      for (const s of this.sources.values()) {
        if (s.isExtracting || s._queuedForExtraction) return true;
      }
      return false;
    }

    get targetFps() {
      if (typeof window !== 'undefined') {
        if (typeof window.getProjectFps === 'function') {
          const pFps = window.getProjectFps();
          if (pFps && pFps > 0) return Math.max(1, pFps);
        }
        if (window.currentProjectState && window.currentProjectState.fps) {
          const pFps = parseInt(window.currentProjectState.fps, 10);
          if (pFps && pFps > 0) return Math.max(1, pFps);
        }
      }
      return Math.max(1, this._targetFps || 60);
    }

    set targetFps(val) {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed) && parsed > 0) {
        this.setFps(parsed);
      }
    }

    setFps(val) {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed) && parsed > 0) {
        const fpsChanged = (this._targetFps !== parsed);
        if (fpsChanged) {
          this._targetFps = parsed;
          this.clearAll();
        }
        if (typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
          window.currentProjectState.layers.forEach(l => {
            if (l.type === 'video' || l.type === 'precomp') {
              this.extractLayerRange(l);
            }
          });
        }
      }
    }

    clearAll() {
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
      this._saveQueue = [];
      this._blobEncodeQueue = [];
      this._extractionSourceQueue = [];
      this._isProcessingSourceQueue = false;
      for (const source of this.sources.values()) {
        source.isExtracting = false;
        source._queuedForExtraction = false;
        this._cleanupSourceDecoders(source);
        if (source.frames) {
          const closedSet = new Set();
          for (const bmp of source.frames.values()) {
            if (bmp && !closedSet.has(bmp) && typeof bmp.close === 'function') {
              closedSet.add(bmp);
              try { bmp.close(); } catch (_) {}
            }
          }
          source.frames.clear();
        }
        if (source.cachedFrameIndices) source.cachedFrameIndices.clear();
        if (source._fetchingFrames) source._fetchingFrames.clear();
        if (source.pendingFrames) source.pendingFrames.clear();
        source.isDbLoaded = false;
        source.dbLoadPromise = null;
      }
      this.sources.clear();
    }

    _getDB() {
      if (this._db) return Promise.resolve(this._db);
      if (this._dbPromise) return this._dbPromise;
      this._dbPromise = openFrameCacheDB().then(db => {
        this._db = db;
        return db;
      });
      return this._dbPromise;
    }

    /**
     * Queue an extracted ImageBitmap for deferred background WebP encoding and IndexedDB storage.
     * Never runs WebP compression while any source is actively extracting!
     */
    _queueBitmapForDB(sourceKey, frameIdx, bmp, fps = this.targetFps, isPrecomp = false) {
      if (!sourceKey || !bmp || isPrecomp) return;
      const tier = this._deviceTier || getDeviceRamTier();
      const maxQueue = tier.isMobile ? 240 : 1800;
      while (this._blobEncodeQueue.length >= maxQueue) {
        const dropped = this._blobEncodeQueue.shift();
        if (dropped && dropped.bmp) {
          dropped.bmp._pendingDbEncode = false;
          if (!dropped.bmp._refCount || dropped.bmp._refCount <= 0) {
            try { if (typeof dropped.bmp.close === 'function') dropped.bmp.close(); } catch (_) {}
          }
        }
      }
      bmp._pendingDbEncode = true;
      this._blobEncodeQueue.push({
        sourceKey,
        frameIdx,
        bmp,
        fps: fps || this.targetFps
      });
      if (!this.isAnySourceExtracting()) {
        this._scheduleBlobEncodeDrain();
      }
    }

    _scheduleBlobEncodeDrain() {
      if (this._isDrainingBlobQueue || this._blobEncodeQueue.length === 0) return;
      if (this.isAnySourceExtracting()) return;
      this._isDrainingBlobQueue = true;

      const processNextBatch = async () => {
        try {
          const tier = this._deviceTier || getDeviceRamTier();
          const batchSize = tier.dbBatchSize || 6;
          while (this._blobEncodeQueue.length > 0) {
            // Pause DB encoding immediately if new extraction starts or user interacts
            if (this.isAnySourceExtracting()) {
              break;
            }
            if (this._isUserInteracting()) {
              await new Promise(r => setTimeout(r, 120));
              if (this.isAnySourceExtracting()) break;
              if (this._isUserInteracting()) continue;
            }
            const batch = this._blobEncodeQueue.splice(0, batchSize);
            for (const item of batch) {
              const { sourceKey, frameIdx, bmp, fps } = item;
              if (!bmp) continue;
              const source = this.sources.get(sourceKey);
              if (!source) {
                bmp._pendingDbEncode = false;
                continue;
              }
              try {
                let blob = bmp._cachedWebpBlob || null;
                if (!blob) {
                  const w = bmp.width || source.width || 640;
                  const h = bmp.height || source.height || 360;
                  if (!this._dbEncodeCanvas) {
                    if (typeof OffscreenCanvas !== 'undefined') {
                      this._dbEncodeCanvas = new OffscreenCanvas(w, h);
                    } else if (typeof document !== 'undefined') {
                      this._dbEncodeCanvas = document.createElement('canvas');
                    }
                    if (this._dbEncodeCanvas) {
                      this._dbEncodeCtx = this._dbEncodeCanvas.getContext('2d', { alpha: false });
                    }
                  }
                  if (this._dbEncodeCanvas && (this._dbEncodeCanvas.width !== w || this._dbEncodeCanvas.height !== h)) {
                    this._dbEncodeCanvas.width = w;
                    this._dbEncodeCanvas.height = h;
                  }
                  if (this._dbEncodeCtx) {
                    this._dbEncodeCtx.drawImage(bmp, 0, 0, w, h);
                    if (typeof this._dbEncodeCanvas.convertToBlob === 'function') {
                      blob = await this._dbEncodeCanvas.convertToBlob({ type: 'image/webp', quality: 0.72 });
                    } else if (typeof this._dbEncodeCanvas.toBlob === 'function') {
                      blob = await new Promise(res => this._dbEncodeCanvas.toBlob(res, 'image/webp', 0.72));
                    }
                    if (blob && (bmp._refCount || 1) > 1) {
                      bmp._cachedWebpBlob = blob;
                    }
                  }
                }
                if (blob && this.sources.has(sourceKey)) {
                  this._queueFrameSave(sourceKey, frameIdx, blob, fps);
                }
              } catch (_) {
              } finally {
                bmp._pendingDbEncode = false;
                if (bmp._cachedWebpBlob && (bmp._refCount || 1) <= 1) {
                  delete bmp._cachedWebpBlob;
                }
                if (source && source.frames && !source.frames.has(frameIdx)) {
                  releaseBitmap(bmp);
                } else if (source && source.frames && source.frames.size > this.maxRamFrames) {
                  this._evictOldestFrame(source);
                }
              }
            }
            await yieldToUI(tier.isMobile ? 8 : 0);
          }
        } finally {
          this._isDrainingBlobQueue = false;
          this._flushSaveQueue();
        }
      };

      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => processNextBatch(), { timeout: 180 });
      } else {
        setTimeout(processNextBatch, 24);
      }
    }

    _queueFrameSave(sourceKey, frameIdx, blob, fps = this.targetFps) {
      if (!sourceKey || blob == null) return;
      const effectiveFps = fps || this.targetFps;
      this._saveQueue.push({
        key: `${sourceKey}_${effectiveFps}_${frameIdx}`,
        sourceKey: sourceKey,
        fps: effectiveFps,
        frameIdx: frameIdx,
        blob: blob
      });

      if (this._saveQueue.length >= 24) {
        this._flushSaveQueue();
      } else if (!this._flushTimer) {
        this._flushTimer = setTimeout(() => {
          this._flushTimer = null;
          this._flushSaveQueue();
        }, 100);
      }
    }

    _flushSaveQueue() {
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
      if (!this._saveQueue || this._saveQueue.length === 0) return;
      const batch = this._saveQueue.splice(0, this._saveQueue.length);

      this._getDB().then(db => {
        if (!db) return;
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          for (const item of batch) {
            store.put(item);
          }
        } catch (_) {}
      });
    }

    _getSourceKey(layer) {
      if (!layer) return '';
      if (layer.type === 'precomp') {
        return 'precomp_' + (layer.id || layer.name || 'default');
      }
      if (layer.mediaId) return layer.mediaId;
      if (layer.dataUrl && !layer.dataUrl.startsWith('blob:')) return layer.dataUrl;
      if (typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
        const matching = this._collectMatchingLayers(l =>
          (l.id === layer.id || (l.name === layer.name && l.type === layer.type)) && l.mediaId
        )[0];
        if (matching && matching.mediaId) {
          layer.mediaId = matching.mediaId;
          return layer.mediaId;
        }
      }
      if (layer.name && this.sources) {
        for (const [key, src] of this.sources.entries()) {
          if (src && src.name === layer.name && !src.isPrecomp) return key;
        }
      }
      if (layer.id) return 'src_' + layer.id;
      return layer.dataUrl || '';
    }

    getSourceCache(sourceKey) {
      return this.sources.get(sourceKey) || null;
    }

    async fetchFrameFromDB(source, frameIdx, callback = null) {
      if (!source || source.isPrecomp) {
        if (callback) callback(null);
        return;
      }
      if (source.frames.has(frameIdx)) {
        if (callback) callback(source.frames.get(frameIdx));
        return;
      }
      if (!source._fetchCallbacks) source._fetchCallbacks = new Map();
      if (callback) {
        const list = source._fetchCallbacks.get(frameIdx) || [];
        list.push(callback);
        source._fetchCallbacks.set(frameIdx, list);
      }
      if (source._fetchingFrames && source._fetchingFrames.has(frameIdx)) return;
      if (!source._fetchingFrames) source._fetchingFrames = new Set();
      source._fetchingFrames.add(frameIdx);

      const db = await this._getDB();
      if (!db) {
        source._fetchingFrames.delete(frameIdx);
        this._flushFetchCallbacks(source, frameIdx, null);
        return;
      }
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const effectiveFps = parseInt(source.fps || this.targetFps, 10) || 60;
        const key = `${source.sourceKey}_${effectiveFps}_${frameIdx}`;
        const req = store.get(key);
        req.onsuccess = async () => {
          source._fetchingFrames.delete(frameIdx);
          const rec = req.result;
          let loadedBmp = null;
          if (rec && rec.blob) {
            try {
              const bmp = await createImageBitmap(rec.blob);
              const fpsMatch = !rec.fps || !source.fps || parseInt(source.fps, 10) === parseInt(rec.fps, 10);
              if (this.sources.has(source.sourceKey) && fpsMatch) {
                retainBitmap(bmp, source.sourceKey);
                source.frames.set(frameIdx, bmp);
                this._evictOldestFrame(source, frameIdx);
                loadedBmp = bmp;
                const curPlayheadFIdx = this._getVideoFrameForPlayhead(source);
                if (Math.abs(frameIdx - curPlayheadFIdx) <= 15 && typeof window !== 'undefined' && typeof window.redrawComposition === 'function' && !window.isTimelinePlaying && !window.isExporting) {
                  window.redrawComposition('frameReady');
                }
              } else if (bmp && typeof bmp.close === 'function') {
                bmp.close();
              }
            } catch (_) {}
          }
          this._flushFetchCallbacks(source, frameIdx, loadedBmp);
        };
        req.onerror = () => {
          source._fetchingFrames.delete(frameIdx);
          this._flushFetchCallbacks(source, frameIdx, null);
        };
      } catch (_) {
        source._fetchingFrames.delete(frameIdx);
        this._flushFetchCallbacks(source, frameIdx, null);
      }
    }

    _flushFetchCallbacks(source, frameIdx, bmp) {
      if (source && source._fetchCallbacks && source._fetchCallbacks.has(frameIdx)) {
        const cbs = source._fetchCallbacks.get(frameIdx) || [];
        source._fetchCallbacks.delete(frameIdx);
        cbs.forEach(cb => {
          try { cb(bmp); } catch (_) {}
        });
      }
    }

    getFrame(layerOrSource, timeInClip = 0) {
      if (!layerOrSource) return null;
      let source = layerOrSource;
      let targetTime = timeInClip;
      if (!(layerOrSource.frames instanceof Map)) {
        source = this.getSourceCache(this._getSourceKey(layerOrSource));
      }
      if (!source || !source.frames) return null;
      const interpMode = (layerOrSource && layerOrSource.speedInterpolation) || 'none';
      return this.getInterpolatedFrame(source, targetTime, interpMode);
    }

    fetchFrameFromDBAsync(sourceOrLayer, frameIdxOrTime) {
      if (!sourceOrLayer) return Promise.resolve(null);
      let source = sourceOrLayer;
      let frameIdx = frameIdxOrTime;
      if (!(sourceOrLayer.frames instanceof Map)) {
        source = this.getSourceCache(this._getSourceKey(sourceOrLayer));
        if (!source) return Promise.resolve(null);
        const fps = source.fps || this.targetFps || 60;
        frameIdx = Math.round(Math.max(0, frameIdxOrTime || 0) * fps);
      }
      if (!source || (source.frames && source.frames.has(frameIdx))) {
        return Promise.resolve(source ? source.frames.get(frameIdx) : null);
      }
      return new Promise(resolve => {
        this.fetchFrameFromDB(source, frameIdx, resolve);
      });
    }

    async ensurePlaybackFrames(source, currentFIdx, windowSize = 180) {
      if (!source || source.isPrecomp || !source.cachedFrameIndices || source.cachedFrameIndices.size === 0) return;
      if (source._isStreamingPrefetch) return;

      const tier = this._deviceTier || getDeviceRamTier();
      const effectiveWin = tier.isMobile ? Math.min(90, windowSize) : windowSize;
      const isReverse = this._isSourceReversePlayback(source);
      const missing = [];
      let startFIdx, endFIdx;
      if (!isReverse) {
        startFIdx = Math.max(0, currentFIdx - Math.round(effectiveWin / 4));
        endFIdx = currentFIdx + effectiveWin;
      } else {
        startFIdx = Math.max(0, currentFIdx - effectiveWin);
        endFIdx = currentFIdx + Math.round(effectiveWin / 4);
      }
      for (let f = startFIdx; f <= endFIdx; f++) {
        if (source.cachedFrameIndices.has(f) && (!source.frames || !source.frames.has(f))) {
          if (!source._fetchingFrames || !source._fetchingFrames.has(f)) {
            missing.push(f);
          }
        }
      }

      if (missing.length === 0) return;

      if (!isReverse) {
        // Forward: prioritize upcoming frames (f >= currentFIdx) first
        missing.sort((a, b) => {
          const scoreA = a >= currentFIdx ? (a - currentFIdx) : ((currentFIdx - a) + 10000);
          const scoreB = b >= currentFIdx ? (b - currentFIdx) : ((currentFIdx - b) + 10000);
          return scoreA - scoreB;
        });
      } else {
        // Reverse: prioritize upcoming decreasing frames (f <= currentFIdx) first
        missing.sort((a, b) => {
          const scoreA = a <= currentFIdx ? (currentFIdx - a) : ((a - currentFIdx) + 10000);
          const scoreB = b <= currentFIdx ? (currentFIdx - b) : ((b - currentFIdx) + 10000);
          return scoreA - scoreB;
        });
      }

      source._isStreamingPrefetch = true;
      try {
        const db = await this._getDB();
        if (!db) return;

        const batchSize = Math.min(tier.isMobile ? 24 : 60, missing.length);
        const batch = missing.slice(0, batchSize);
        batch.forEach(idx => {
          if (!source._fetchingFrames) source._fetchingFrames = new Set();
          source._fetchingFrames.add(idx);
        });

        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const effectiveFps = parseInt(source.fps || this.targetFps, 10) || 60;

        await Promise.all(batch.map(idx => new Promise(res => {
          try {
            const key = `${source.sourceKey}_${effectiveFps}_${idx}`;
            const req = store.get(key);
            req.onsuccess = async () => {
              if (source._fetchingFrames) source._fetchingFrames.delete(idx);
              const rec = req.result;
              if (rec && rec.blob && (!source.frames || !source.frames.has(idx))) {
                try {
                  const bmp = await createImageBitmap(rec.blob);
                  if (!source.fps || parseInt(source.fps, 10) === effectiveFps) {
                    retainBitmap(bmp, source.sourceKey);
                    source.frames.set(idx, bmp);
                    this._evictOldestFrame(source, idx);
                  } else if (bmp && typeof bmp.close === 'function') {
                    bmp.close();
                  }
                } catch (_) {}
              }
              res();
            };
            req.onerror = () => {
              if (source._fetchingFrames) source._fetchingFrames.delete(idx);
              res();
            };
          } catch (_) {
            if (source._fetchingFrames) source._fetchingFrames.delete(idx);
            res();
          }
        })));
      } finally {
        source._isStreamingPrefetch = false;
        if (typeof window !== 'undefined' && typeof window.redrawComposition === 'function' && !window.isTimelinePlaying && !window.isExporting) {
          window.redrawComposition('playbackFramesBatchLoaded');
        }
      }
    }

    _getOrCreateSource(sourceKey, dataUrl, name = '', layerId = '', isPrecomp = false) {
      const currentFps = this.targetFps;
      if (this.sources.has(sourceKey)) {
        const existing = this.sources.get(sourceKey);
        if (name && !existing.name) existing.name = name;
        if (layerId && !existing.layerId) existing.layerId = layerId;
        if (isPrecomp) existing.isPrecomp = true;
        if (existing.fps !== currentFps) {
          if (existing.frames) {
            const closedSet = new Set();
            for (const bmp of existing.frames.values()) {
              if (bmp && !closedSet.has(bmp) && typeof bmp.close === 'function') {
                closedSet.add(bmp);
                try { bmp.close(); } catch (_) {}
              }
            }
            existing.frames.clear();
          }
          if (existing.cachedFrameIndices) existing.cachedFrameIndices.clear();
          if (existing._fetchingFrames) existing._fetchingFrames.clear();
          if (existing.pendingFrames) existing.pendingFrames.clear();
          existing.fps = currentFps;
          existing.isDbLoaded = isPrecomp ? true : false;
          existing.dbLoadPromise = null;
        }
      } else {
        this.sources.set(sourceKey, {
          sourceKey: sourceKey,
          name: name || '',
          layerId: layerId || '',
          dataUrl: dataUrl || '',
          isPrecomp: !!isPrecomp,
          frames: new Map(),
          cachedFrameIndices: new Set(),
          _fetchingFrames: new Set(),
          fps: currentFps,
          width: 480,
          height: 270,
          duration: 0,
          isExtracting: false,
          isDbLoaded: isPrecomp ? true : false,
          dbLoadPromise: null,
          activeVideo: null,
          pendingFrames: new Set()
        });
      }
      const source = this.sources.get(sourceKey);
      if (name && !source.name) source.name = name;
      if (layerId && !source.layerId) source.layerId = layerId;
      if (dataUrl && dataUrl !== source.dataUrl) {
        source.dataUrl = dataUrl;
      }
      return source;
    }

    async _loadFramesFromDB(source) {
      if (source.isPrecomp) {
        source.isDbLoaded = true;
        return;
      }
      const db = await this._getDB();
      if (!db) {
        source.isDbLoaded = true;
        return;
      }

      const currentFps = parseInt(source.fps || this.targetFps, 10) || 60;
      const prefix = `${source.sourceKey}_${currentFps}_`;
      const tier = this._deviceTier || getDeviceRamTier();

      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          let keyReq;
          if (store.indexNames.contains('sourceFpsKey') && typeof store.index('sourceFpsKey').getAllKeys === 'function') {
            keyReq = store.index('sourceFpsKey').getAllKeys(IDBKeyRange.only([source.sourceKey, currentFps]));
          } else if (store.indexNames.contains('sourceKey') && typeof store.index('sourceKey').getAllKeys === 'function') {
            keyReq = store.index('sourceKey').getAllKeys(IDBKeyRange.only(source.sourceKey));
          } else if (typeof store.getAllKeys === 'function') {
            keyReq = store.getAllKeys();
          }

          if (keyReq) {
            keyReq.onsuccess = async () => {
              const allKeys = keyReq.result || [];
              const frameIndices = [];
              for (let i = 0; i < allKeys.length; i++) {
                const k = String(allKeys[i]);
                if (k.startsWith(prefix)) {
                  const fIdx = parseInt(k.substring(prefix.length), 10);
                  if (!isNaN(fIdx)) frameIndices.push(fIdx);
                }
              }

              if (frameIndices.length > 0) {
                frameIndices.sort((a, b) => a - b);
                if (!source.cachedFrameIndices) source.cachedFrameIndices = new Set();
                let maxF = 0;
                for (let i = 0; i < frameIndices.length; i++) {
                  const fIdx = frameIndices[i];
                  source.cachedFrameIndices.add(fIdx);
                  if (fIdx > maxF) maxF = fIdx;
                }
                if (maxF > 0 && (!source.duration || source.duration === 0)) {
                  source.duration = Math.max(source.duration || 0, (maxF + 1) / currentFps);
                }

                const playheadFIdx = this._getVideoFrameForPlayhead(source);
                const initialCap = tier.isMobile ? 60 : 120;
                const sortedByPlayhead = frameIndices.slice().sort((a, b) => {
                  const da = a >= playheadFIdx ? (a - playheadFIdx) : (playheadFIdx - a) + 300;
                  const dbDist = b >= playheadFIdx ? (b - playheadFIdx) : (playheadFIdx - b) + 300;
                  return da - dbDist;
                });

                const initialIndices = sortedByPlayhead.slice(0, initialCap);
                source.isDbLoaded = true;
                this._notifyLayersForSource(source.sourceKey, true);

                // Hydrate playhead window in small non-blocking chunks without holding all Blobs in memory
                const chunkSize = tier.isMobile ? 15 : 30;
                for (let i = 0; i < initialIndices.length; i += chunkSize) {
                  if (!this.sources.has(source.sourceKey) || parseInt(source.fps, 10) !== currentFps) break;
                  const chunk = initialIndices.slice(i, i + chunkSize);
                  await this.ensurePlaybackFrames(source, chunk[0], chunk.length);
                  await yieldToUI();
                }

                resolve();
                this._startBackgroundKeyHydration(source, sortedByPlayhead.slice(initialCap), currentFps);
                return;
              }
              source.isDbLoaded = true;
              this._notifyLayersForSource(source.sourceKey, true);
              resolve();
            };
            keyReq.onerror = () => {
              source.isDbLoaded = true;
              resolve();
            };
            return;
          }

          source.isDbLoaded = true;
          resolve();
        } catch (_) {
          source.isDbLoaded = true;
          resolve();
        }
      });
    }

    _startBackgroundKeyHydration(source, remainingIndices, currentFps) {
      if (!remainingIndices || remainingIndices.length === 0) return;
      if (source._idleHydrationRunning) return;
      source._idleHydrationRunning = true;

      const tier = this._deviceTier || getDeviceRamTier();
      const maxPerSource = this.maxRamFrames || tier.maxRamFramesPerSource;
      let currentIndex = 0;

      const step = async () => {
        if (!this.sources.has(source.sourceKey) || parseInt(source.fps, 10) !== currentFps) {
          source._idleHydrationRunning = false;
          return;
        }
        if (currentIndex >= remainingIndices.length || (source.frames && source.frames.size >= maxPerSource) || this._getTotalRamFrameCount() >= (this.maxTotalRamFrames || tier.maxTotalRamFrames)) {
          source._idleHydrationRunning = false;
          return;
        }

        if (this._isUserInteracting() || this.isAnySourceExtracting()) {
          setTimeout(step, 250);
          return;
        }

        const chunkSize = tier.isMobile ? 8 : 16;
        const chunk = remainingIndices.slice(currentIndex, currentIndex + chunkSize);
        currentIndex += chunkSize;

        const db = await this._getDB();
        if (db) {
          try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            await Promise.all(chunk.map(fIdx => new Promise(res => {
              if (source.frames && source.frames.has(fIdx)) {
                res();
                return;
              }
              const key = `${source.sourceKey}_${currentFps}_${fIdx}`;
              const req = store.get(key);
              req.onsuccess = async () => {
                const rec = req.result;
                if (rec && rec.blob && (!source.frames || !source.frames.has(fIdx))) {
                  try {
                    const bmp = await createImageBitmap(rec.blob);
                    if (!source.fps || parseInt(source.fps, 10) === currentFps) {
                      retainBitmap(bmp, source.sourceKey);
                      source.frames.set(fIdx, bmp);
                      this._evictOldestFrame(source, fIdx);
                    } else if (bmp && typeof bmp.close === 'function') {
                      bmp.close();
                    }
                  } catch (_) {}
                }
                res();
              };
              req.onerror = () => res();
            })));
          } catch (_) {}
        }

        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(step, { timeout: 350 });
        } else {
          setTimeout(step, 80);
        }
      };

      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(step, { timeout: 350 });
      } else {
        setTimeout(step, 80);
      }
    }

    getLayerFrameRange(layer) {
      const fps = this.targetFps;
      const pixelsPerSec = (typeof window !== 'undefined' && window.currentPixelsPerSecond) || 80;
      const offsetSec = Math.max(0, layer.sourceOffsetSec || 0);
      const durSec = (layer.durationSec !== undefined && layer.durationSec > 0)
        ? layer.durationSec
        : ((layer.widthPx || 320) / pixelsPerSec);

      let minTimeSec = offsetSec;
      let maxTimeSec = offsetSec;

      if (layer.speedMode === 'time_remap') {
        if (layer.keyframes && Array.isArray(layer.keyframes.timeRemap) && layer.keyframes.timeRemap.length > 0) {
          const remapVals = layer.keyframes.timeRemap.map(k => (k.value && k.value.timeRemap !== undefined ? k.value.timeRemap : 0));
          minTimeSec = Math.min(...remapVals);
          maxTimeSec = Math.max(...remapVals);
        } else {
          minTimeSec = 0;
          maxTimeSec = durSec;
        }
      } else if (layer.keyframes && Array.isArray(layer.keyframes.speed) && layer.keyframes.speed.length > 0) {
        const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSec);
        if (typeof window !== 'undefined' && typeof window.getLayerIntegratedSpeedTime === 'function') {
          minTimeSec = window.getLayerIntegratedSpeedTime(layer, start);
          maxTimeSec = window.getLayerIntegratedSpeedTime(layer, start + durSec);
        } else {
          minTimeSec = offsetSec;
          maxTimeSec = offsetSec + durSec * 4.0;
        }
      } else {
        const effSpeed = (layer.speed !== undefined && layer.speed !== 0) ? Math.abs(layer.speed) : 1.0;
        const videoDurationConsumed = durSec * effSpeed;
        minTimeSec = offsetSec;
        maxTimeSec = offsetSec + videoDurationConsumed;
      }

      const sourceKey = this._getSourceKey(layer);
      const source = this.sources.get(sourceKey);

      if (layer.type === 'precomp') {
        const startIdx = Math.max(0, Math.floor(minTimeSec * fps));
        const endIdx = Math.max(startIdx, Math.ceil(maxTimeSec * fps));
        return { startIdx, endIdx, total: Math.max(1, endIdx - startIdx + 1) };
      }

      const trueMediaDur = (source && isFinite(source.duration) && source.duration > 0)
        ? source.duration
        : (layer.mediaDuration && isFinite(layer.mediaDuration) && layer.mediaDuration > 0 ? layer.mediaDuration : maxTimeSec);

      const startIdx = Math.max(0, Math.floor(minTimeSec * fps));
      let endIdx = Math.ceil(maxTimeSec * fps) + 2;
      if (trueMediaDur > 0) {
        const maxVideoFrame = Math.max(0, Math.floor(trueMediaDur * fps) - 1);
        endIdx = Math.min(endIdx, maxVideoFrame);
      }
      endIdx = Math.max(startIdx, endIdx);
      return { startIdx, endIdx, total: Math.max(1, endIdx - startIdx + 1) };
    }

    /**
     * Check whether the frame at a specific timeline second for a video or precomp layer is ready in RAM/DB cache
     */
    isVideoFrameReady(layer, currentSec) {
      if (!layer) return true;
      if (layer.type === 'precomp') {
        const isCollapsed = (typeof window !== 'undefined' && typeof window.isPrecompEffectivelyCollapsed === 'function')
          ? window.isPrecompEffectivelyCollapsed(layer)
          : !!layer.collapseTransformations;
        if (isCollapsed) {
          const children = Array.isArray(layer.layers) ? layer.layers : [];
          return children.every(c => (c.type === 'video' || c.type === 'precomp') ? this.isVideoFrameReady(c, currentSec) : true);
        }
        if (layer._dirty) return false;
      } else if (layer.type !== 'video') {
        return true;
      }

      const sourceKey = this._getSourceKey(layer);
      const source = this.sources.get(sourceKey);
      if (!source || !source.frames) return false;

      const pixelsPerSec = (typeof window !== 'undefined' && window.currentPixelsPerSecond) || 80;
      const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSec);
      let timeInClip = 0;
      if (layer.speedMode === 'time_remap') {
        const eff = (typeof window !== 'undefined' && typeof window.getLayerEffectivePropsAtTime === 'function')
          ? window.getLayerEffectivePropsAtTime(layer, currentSec)
          : layer;
        timeInClip = Math.max(0, eff.timeRemap !== undefined ? eff.timeRemap : ((currentSec - start) * (layer.speed || 1.0)));
      } else {
        timeInClip = (typeof window !== 'undefined' && typeof window.getLayerIntegratedSpeedTime === 'function')
          ? window.getLayerIntegratedSpeedTime(layer, currentSec)
          : (layer.speed !== undefined && layer.speed < 0
            ? Math.max(0, (layer.sourceOffsetSec || 0) + Math.max(0, (((layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pixelsPerSec))) - (currentSec - start)) * Math.abs(layer.speed)))
            : Math.max(0, (layer.sourceOffsetSec || 0) + (currentSec - start) * (layer.speed || 1.0)));
      }
      const rawFrame = timeInClip * (source.fps || this.targetFps);

      const interp = layer.speedInterpolation || 'none';
      if (interp === 'blend' || interp === 'optical_flow') {
        const f0 = Math.floor(rawFrame);
        const f1 = f0 + 1;
        const has0 = source.frames.has(f0) || (source.cachedFrameIndices && source.cachedFrameIndices.has(f0));
        const has1 = source.frames.has(f1) || (source.cachedFrameIndices && source.cachedFrameIndices.has(f1));
        return has0 && has1;
      }

      const fIdx = Math.round(rawFrame);
      return source.frames.has(fIdx) || (source.cachedFrameIndices && source.cachedFrameIndices.has(fIdx));
    }

    clearInterpolationCache() {
      if (this._interpCache) {
        this._interpCache.clear();
      }
    }

    getInterpolatedFrame(source, timeInClip, mode = 'none', targetW = null, targetH = null) {
      if (!source || !source.frames) return null;
      const fps = source.fps || 60;
      const rawFrame = Math.max(0, timeInClip * fps);
      const f0 = Math.floor(rawFrame);
      const f1 = f0 + 1;
      const alpha = rawFrame - f0;

      if (mode === 'none' || mode === 'nearest' || alpha < 0.02) {
        return source.frames.get(Math.round(rawFrame)) || source.frames.get(f0) || null;
      }
      if (alpha > 0.98) {
        return source.frames.get(f1) || source.frames.get(Math.round(rawFrame)) || null;
      }

      const frame0 = source.frames.get(f0);
      const frame1 = source.frames.get(f1);

      if (!frame0 && source.cachedFrameIndices && source.cachedFrameIndices.has(f0)) {
        this.fetchFrameFromDB(source, f0);
      }
      if (!frame1 && source.cachedFrameIndices && source.cachedFrameIndices.has(f1)) {
        this.fetchFrameFromDB(source, f1);
      }

      if (!frame0 && !frame1) return null;
      if (!frame0) return frame1;
      if (!frame1) return frame0;
      if (frame0 === frame1) return frame0;

      const stepAlpha = Math.round(alpha * 20) / 20;
      if (stepAlpha <= 0) return frame0;
      if (stepAlpha >= 1) return frame1;

      const cacheKey = `${source.sourceKey}_${f0}_${Math.round(stepAlpha * 100)}_${mode}`;
      if (!this._interpCache) this._interpCache = new Map();
      if (this._interpCache.has(cacheKey)) {
        return this._interpCache.get(cacheKey);
      }

      const fw = (frame0.width || targetW || 960);
      const fh = (frame0.height || targetH || 540);

      let resultCanvas = null;
      if (mode === 'optical_flow') {
        resultCanvas = this._synthesizeOpticalFlow(frame0, frame1, stepAlpha, fw, fh);
      } else {
        resultCanvas = this._synthesizeFrameBlend(frame0, frame1, stepAlpha, fw, fh);
      }

      if (resultCanvas) {
        if (this._interpCache.size >= 600) {
          const firstKey = this._interpCache.keys().next().value;
          this._interpCache.delete(firstKey);
        }
        this._interpCache.set(cacheKey, resultCanvas);
        return resultCanvas;
      }

      return frame0;
    }

    _synthesizeFrameBlend(frame0, frame1, alpha, fw, fh) {
      if (typeof document === 'undefined') return frame0;
      const canvas = document.createElement('canvas');
      canvas.width = fw;
      canvas.height = fh;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return frame0;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.globalAlpha = 1.0;
      try {
        ctx.drawImage(frame0, 0, 0, fw, fh);
      } catch (_) {
        return frame1;
      }

      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      try {
        ctx.drawImage(frame1, 0, 0, fw, fh);
      } catch (_) {}
      ctx.globalAlpha = 1.0;

      return canvas;
    }

    _synthesizeOpticalFlow(frame0, frame1, alpha, fw, fh) {
      if (typeof document === 'undefined') return frame0;
      const canvas = document.createElement('canvas');
      canvas.width = fw;
      canvas.height = fh;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return frame0;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.globalAlpha = 1.0;
      try {
        ctx.drawImage(frame0, 0, 0, fw, fh);
      } catch (_) {
        return frame1;
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      try {
        ctx.drawImage(frame1, 0, 0, fw, fh);
      } catch (_) {}
      ctx.globalAlpha = 1.0;

      const AW = 160;
      const AH = 90;
      if (!this._ofCanvas0) {
        this._ofCanvas0 = document.createElement('canvas');
        this._ofCanvas0.width = AW;
        this._ofCanvas0.height = AH;
        this._ofCtx0 = this._ofCanvas0.getContext('2d', { willReadFrequently: true });
      }
      if (!this._ofCanvas1) {
        this._ofCanvas1 = document.createElement('canvas');
        this._ofCanvas1.width = AW;
        this._ofCanvas1.height = AH;
        this._ofCtx1 = this._ofCanvas1.getContext('2d', { willReadFrequently: true });
      }

      const ctxA0 = this._ofCtx0;
      const ctxA1 = this._ofCtx1;
      if (!ctxA0 || !ctxA1) return canvas;

      try {
        ctxA0.drawImage(frame0, 0, 0, AW, AH);
        ctxA1.drawImage(frame1, 0, 0, AW, AH);
      } catch (_) {
        return canvas;
      }

      let imgData0, imgData1;
      try {
        imgData0 = ctxA0.getImageData(0, 0, AW, AH).data;
        imgData1 = ctxA1.getImageData(0, 0, AW, AH).data;
      } catch (_) {
        return canvas;
      }

      const totalPixels = AW * AH;
      const lum0 = new Uint8Array(totalPixels);
      const lum1 = new Uint8Array(totalPixels);
      for (let i = 0, p = 0; i < totalPixels; i++, p += 4) {
        lum0[i] = (imgData0[p] * 77 + imgData0[p + 1] * 150 + imgData0[p + 2] * 29) >> 8;
        lum1[i] = (imgData1[p] * 77 + imgData1[p + 1] * 150 + imgData1[p + 2] * 29) >> 8;
      }

      const BS = 16;
      const maxSearchX = 10;
      const maxSearchY = 6;
      const numBlocksX = Math.floor(AW / BS);
      const numBlocksY = Math.floor(AH / BS);

      const vx = new Int16Array(numBlocksX * numBlocksY);
      const vy = new Int16Array(numBlocksX * numBlocksY);
      const hasMotion = new Uint8Array(numBlocksX * numBlocksY);

      for (let by = 0; by < numBlocksY; by++) {
        for (let bx = 0; bx < numBlocksX; bx++) {
          const bIdx = by * numBlocksX + bx;
          const startX = bx * BS;
          const startY = by * BS;

          let sad00 = 0;
          for (let y = 0; y < BS; y++) {
            const row0 = (startY + y) * AW;
            for (let x = 0; x < BS; x++) {
              const idx = row0 + (startX + x);
              sad00 += Math.abs(lum0[idx] - lum1[idx]);
            }
          }

          if (sad00 < BS * BS * 3.5) continue;

          let bestSad = sad00;
          let bestDx = 0;
          let bestDy = 0;

          for (let dy = -maxSearchY; dy <= maxSearchY; dy += 2) {
            const targetY = startY + dy;
            if (targetY < 0 || targetY + BS > AH) continue;

            for (let dx = -maxSearchX; dx <= maxSearchX; dx += 2) {
              const targetX = startX + dx;
              if (targetX < 0 || targetX + BS > AW) continue;

              let curSad = 0;
              let earlyBreak = false;

              for (let y = 0; y < BS; y++) {
                const r0 = (startY + y) * AW + startX;
                const r1 = (targetY + y) * AW + targetX;
                for (let x = 0; x < BS; x++) {
                  curSad += Math.abs(lum0[r0 + x] - lum1[r1 + x]);
                }
                if (curSad >= bestSad) {
                  earlyBreak = true;
                  break;
                }
              }

              if (!earlyBreak && curSad < bestSad) {
                bestSad = curSad;
                bestDx = dx;
                bestDy = dy;
              }
            }
          }

          if ((bestDx !== 0 || bestDy !== 0) && bestSad < sad00 * 0.85) {
            vx[bIdx] = bestDx;
            vy[bIdx] = bestDy;
            hasMotion[bIdx] = 1;
          }
        }
      }

      const smoothVx = new Int16Array(vx);
      const smoothVy = new Int16Array(vy);

      for (let by = 0; by < numBlocksY; by++) {
        for (let bx = 0; bx < numBlocksX; bx++) {
          const bIdx = by * numBlocksX + bx;
          if (!hasMotion[bIdx]) continue;

          const neighborsX = [];
          const neighborsY = [];
          for (let ny = Math.max(0, by - 1); ny <= Math.min(numBlocksY - 1, by + 1); ny++) {
            for (let nx = Math.max(0, bx - 1); nx <= Math.min(numBlocksX - 1, bx + 1); nx++) {
              const nIdx = ny * numBlocksX + nx;
              if (hasMotion[nIdx]) {
                neighborsX.push(vx[nIdx]);
                neighborsY.push(vy[nIdx]);
              }
            }
          }

          if (neighborsX.length >= 3) {
            neighborsX.sort((a, b) => a - b);
            neighborsY.sort((a, b) => a - b);
            const mid = Math.floor(neighborsX.length / 2);
            smoothVx[bIdx] = neighborsX[mid];
            smoothVy[bIdx] = neighborsY[mid];
          }
        }
      }

      const scaleX = fw / AW;
      const scaleY = fh / AH;

      for (let by = 0; by < numBlocksY; by++) {
        for (let bx = 0; bx < numBlocksX; bx++) {
          const bIdx = by * numBlocksX + bx;
          if (!hasMotion[bIdx]) continue;

          const dx = smoothVx[bIdx];
          const dy = smoothVy[bIdx];
          if (dx === 0 && dy === 0) continue;

          const sx = Math.floor(bx * BS * scaleX);
          const sy = Math.floor(by * BS * scaleY);
          const sw = Math.ceil(BS * scaleX);
          const sh = Math.ceil(BS * scaleY);

          const shiftX0 = Math.round(dx * scaleX * alpha);
          const shiftY0 = Math.round(dy * scaleY * alpha);
          const shiftX1 = Math.round(-dx * scaleX * (1 - alpha));
          const shiftY1 = Math.round(-dy * scaleY * (1 - alpha));

          const dstX0 = Math.max(0, Math.min(fw - sw, sx + shiftX0));
          const dy0 = Math.max(0, Math.min(fh - sh, sy + shiftY0));
          const dstX1 = Math.max(0, Math.min(fw - sw, sx + shiftX1));
          const dy1 = Math.max(0, Math.min(fh - sh, sy + shiftY1));

          try {
            ctx.globalAlpha = 1.0 - alpha;
            ctx.drawImage(frame0, sx, sy, sw, sh, dstX0, dy0, sw, sh);
            ctx.globalAlpha = alpha;
            ctx.drawImage(frame1, sx, sy, sw, sh, dstX1, dy1, sw, sh);
          } catch (_) {}
        }
      }

      ctx.globalAlpha = 1.0;
      return canvas;
    }

    /**
     * Invalidate cached ImageBitmap sequence for a Precomp layer when its children or properties change
     */
    invalidatePrecomp(precompLayer) {
      if (!precompLayer) return;
      const sourceKey = (typeof precompLayer === 'string')
        ? (precompLayer.startsWith('precomp_') ? precompLayer : 'precomp_' + precompLayer)
        : this._getSourceKey(precompLayer);
      if (!sourceKey) return;

      const source = this.sources.get(sourceKey);
      if (source) {
        source.isExtracting = false;
        if (source.pendingFrames) source.pendingFrames.clear();
        if (source.frames) {
          const closedSet = new Set();
          for (const bmp of source.frames.values()) {
            if (bmp && !closedSet.has(bmp) && typeof bmp.close === 'function') {
              closedSet.add(bmp);
              try { bmp.close(); } catch (_) {}
            }
          }
          source.frames.clear();
        }
        if (source.cachedFrameIndices) source.cachedFrameIndices.clear();
      }
      if (typeof precompLayer === 'object') {
        precompLayer._extractProgress = 0;
        precompLayer._extractComplete = false;
        delete precompLayer._lastRenderedFrame;
        this.updateLayerProgressBar(precompLayer);
        this._schedulePrecompReExtract(precompLayer);
      }
    }

    _schedulePrecompReExtract(precompLayer) {
      if (!precompLayer || precompLayer.type !== 'precomp') return;
      if (precompLayer._reExtractTimer) clearTimeout(precompLayer._reExtractTimer);
      precompLayer._reExtractTimer = setTimeout(() => {
        precompLayer._reExtractTimer = null;
        if (this._isUserInteracting()) {
          this._schedulePrecompReExtract(precompLayer);
          return;
        }
        precompLayer._dirty = false;
        this.extractLayerRange(precompLayer);
      }, 280);
      if (precompLayer._reExtractTimer && typeof precompLayer._reExtractTimer.unref === 'function') {
        precompLayer._reExtractTimer.unref();
      }
    }

    /**
     * Extract a Precomp layer (and any nested video/precomp layers inside it) into RAM ImageBitmaps
     */
    async extractPrecompRange(precompLayer) {
      if (!precompLayer || precompLayer.type !== 'precomp') return;

      // 1. Always extract nested video & precomp children first
      const childLayers = Array.isArray(precompLayer.layers) ? precompLayer.layers : [];
      for (const child of childLayers) {
        if (child && (child.type === 'video' || child.type === 'precomp') && !child.hidden) {
          await this.extractLayerRange(child);
        }
      }

      // 2. If precomp has Collapse Transformations enabled, children render directly in 3D space
      const isCollapsed = (typeof window !== 'undefined' && typeof window.isPrecompEffectivelyCollapsed === 'function')
        ? window.isPrecompEffectivelyCollapsed(precompLayer)
        : !!precompLayer.collapseTransformations;
      if (isCollapsed) {
        precompLayer._extractProgress = 1;
        precompLayer._extractComplete = true;
        this.updateLayerProgressBar(precompLayer);
        return;
      }

      const sourceKey = this._getSourceKey(precompLayer);
      if (!sourceKey) return;

      if (precompLayer._dirty) {
        const existing = this.sources.get(sourceKey);
        if (existing) {
          existing.isExtracting = false;
          if (existing.pendingFrames) existing.pendingFrames.clear();
          if (existing.frames) {
            const closedSet = new Set();
            for (const bmp of existing.frames.values()) {
              if (bmp && !closedSet.has(bmp) && typeof bmp.close === 'function') {
                closedSet.add(bmp);
                try { bmp.close(); } catch (_) {}
              }
            }
            existing.frames.clear();
          }
          if (existing.cachedFrameIndices) existing.cachedFrameIndices.clear();
        }
        precompLayer._dirty = false;
      }

      const source = this._getOrCreateSource(sourceKey, '', precompLayer.name || 'Precomp', precompLayer.id, true);
      source.fps = this.targetFps;

      const { startIdx, endIdx } = this.getLayerFrameRange(precompLayer);
      source.duration = Math.max(source.duration || 0, (endIdx + 1) / source.fps);

      const missing = [];
      for (let i = startIdx; i <= endIdx; i++) {
        const hasRam = source.frames && source.frames.has(i);
        const hasCached = source.cachedFrameIndices && source.cachedFrameIndices.has(i);
        if (!hasRam && !hasCached) {
          missing.push(i);
        }
      }

      if (missing.length === 0) {
        precompLayer._extractProgress = 1;
        precompLayer._extractComplete = true;
        this.updateLayerProgressBar(precompLayer);
        return;
      }

      if (!source.pendingFrames) source.pendingFrames = new Set();
      missing.forEach(idx => source.pendingFrames.add(idx));

      if (source.isExtracting) return;
      source.isExtracting = true;

      this._runPrecompExtractionLoop(source, precompLayer).finally(() => {
        source.isExtracting = false;
        this._scheduleBlobEncodeDrain();
        this._notifyLayersForSource(source.sourceKey, true);
      });
    }

    async _runPrecompExtractionLoop(source, precompLayer) {
      if (typeof document === 'undefined' || typeof window === 'undefined' || typeof window.renderPrecompToCanvas !== 'function' || typeof createImageBitmap !== 'function') {
        return;
      }

      const childVideos = (precompLayer.layers || []).filter(c => c && c.type === 'video' && !c.hidden);
      // Wait briefly if child videos are still extracting their initial frames
      let waitLoops = 0;
      while (waitLoops < 40) {
        const anyChildExtracting = childVideos.some(cv => {
          const s = this.sources.get(this._getSourceKey(cv));
          return s && s.isExtracting;
        });
        if (!anyChildExtracting) break;
        waitLoops++;
        await new Promise(r => setTimeout(r, 50));
      }

      const baseW = Math.round(Math.abs(precompLayer.mediaWidth || precompLayer.scaleW || (window.currentProjectState && window.currentProjectState.baseW) || 1920));
      const baseH = Math.round(Math.abs(precompLayer.mediaHeight || precompLayer.scaleH || (window.currentProjectState && window.currentProjectState.baseH) || 1080));
      const tier = this._deviceTier || getDeviceRamTier();
      const maxDim = tier.maxTargetDim || 960;
      const scale = Math.min(1, maxDim / Math.max(baseW, baseH));
      const targetW = Math.max(160, Math.round(baseW * scale));
      const targetH = Math.max(90, Math.round(baseH * scale));
      source.width = targetW;
      source.height = targetH;

      const workCanvas = document.createElement('canvas');
      const testCtx = workCanvas && typeof workCanvas.getContext === 'function' ? workCanvas.getContext('2d') : null;
      if (!testCtx || typeof testCtx.save !== 'function') return;
      workCanvas.width = targetW;
      workCanvas.height = targetH;

      while (source.pendingFrames && source.pendingFrames.size > 0) {
        if (!this.sources.has(source.sourceKey) || !source.isExtracting || precompLayer._dirty) break;

        if ((window.isExporting && !source._forceExtraction) || this._isUserInteracting()) {
          await new Promise(r => setTimeout(r, 80));
          continue;
        }

        const batch = this._claimContiguousFrameBatch(source, tier.isMobile ? 8 : 12);
        if (batch.length === 0) break;

        const fps = source.fps || this.targetFps || 60;
        for (let i = 0; i < batch.length; i++) {
          const targetIdx = batch[i];
          if (!this.sources.has(source.sourceKey) || !source.isExtracting || precompLayer._dirty) break;
          if (source.frames.has(targetIdx) || (source.cachedFrameIndices && source.cachedFrameIndices.has(targetIdx))) {
            this._notifyLayersForSource(source.sourceKey, false, targetIdx);
            continue;
          }

          const innerSec = targetIdx / fps;
          workCanvas._lastRenderKey = null;
          window.renderPrecompToCanvas(precompLayer, workCanvas, innerSec, targetW, targetH, 'precomp-extract');

          try {
            const bmp = await createImageBitmap(workCanvas);
            if (bmp && this.sources.has(source.sourceKey) && !precompLayer._dirty) {
              retainBitmap(bmp, source.sourceKey);
              source.frames.set(targetIdx, bmp);
              if (!source.cachedFrameIndices) source.cachedFrameIndices = new Set();
              source.cachedFrameIndices.add(targetIdx);
              source._hasNewExtractedFrames = true;
              this._evictOldestFrame(source, targetIdx);
            } else if (bmp && typeof bmp.close === 'function') {
              bmp.close();
            }
          } catch (_) {}

          this._notifyLayersForSource(source.sourceKey, false, targetIdx);
          if (i % (tier.isMobile ? 2 : 3) === 1) {
            await yieldToUI(tier.isMobile ? 4 : 0);
          }
        }
        await yieldToUI(tier.isMobile ? 4 : 0);
      }
    }

    /**
     * Request frame extraction for a video or precomp layer's active range
     */
    async extractLayerRange(layer) {
      if (!layer) return;
      if (layer.type === 'precomp') {
        return this.extractPrecompRange(layer);
      }
      if (layer.type !== 'video') return;

      // Ignore raw media pool items (id starts with 'med_' and no mediaId) unless they are actual timeline layers
      if (layer.id && String(layer.id).startsWith('med_') && !layer.mediaId && layer.startSec === undefined && layer.startPx === undefined) {
        return;
      }

      if (layer._extractComplete) {
        const sourceKey = this._getSourceKey(layer);
        const source = this.sources.get(sourceKey);
        if (source && (source.frames.size > 0 || (source.cachedFrameIndices && source.cachedFrameIndices.size > 0))) {
          this.updateLayerProgressBar(layer);
          if (typeof window !== 'undefined' && window.FishBgRemovalEngine && window.FishBgRemovalEngine.isLayerMattingActive(layer)) {
            window.FishBgRemovalEngine.processLayer(layer);
          }
          return;
        }
      }

      if (typeof window !== 'undefined' && window.FishDatabase && window.currentProjectState && window.currentProjectState.id) {
        try {
          const medias = await window.FishDatabase.getProjectMedia(window.currentProjectState.id);
          if (Array.isArray(medias) && medias.length > 0) {
            let m = layer.mediaId ? medias.find(item => item.id === layer.mediaId) : null;
            if (!m && layer.name) {
              m = medias.find(item => item.name === layer.name && (item.type === 'video' || !item.type));
            }
            if (!m) {
              const videoMedias = medias.filter(item => item.type === 'video');
              if (videoMedias.length === 1) m = videoMedias[0];
            }
            if (m) {
              if (m.id && !layer.mediaId) layer.mediaId = m.id;
              if (m.dataUrl) {
                layer.dataUrl = m.dataUrl;
              } else if (m.blob) {
                try { layer.dataUrl = URL.createObjectURL(m.blob); } catch (_) {}
              }
              if (m.width && !layer.mediaWidth) layer.mediaWidth = m.width;
              if (m.height && !layer.mediaHeight) layer.mediaHeight = m.height;
              if (m.duration && !layer.mediaDuration) layer.mediaDuration = m.duration;
            }
          }
        } catch (_) {}
      }

      const sourceKey = this._getSourceKey(layer);
      if (!sourceKey) return;

      const source = this._getOrCreateSource(sourceKey, layer.dataUrl, layer.name, layer.id, false);
      if (layer.dataUrl && layer.dataUrl !== source.dataUrl) {
        source.dataUrl = layer.dataUrl;
      }
      if (layer.mediaDuration && (!source.duration || source.duration <= 0)) {
        source.duration = layer.mediaDuration;
      }
      const nativeFps = (layer.mediaFps && layer.mediaFps >= 10 && layer.mediaFps <= 240) ? layer.mediaFps : null;
      const effectiveFps = nativeFps || (parseInt(typeof window !== 'undefined' && window.currentProjectState && window.currentProjectState.fps, 10) || this.targetFps || 60);
      if (!source.fps || (nativeFps && source.fps !== nativeFps)) {
        source.fps = effectiveFps;
      }

      if (!source.isDbLoaded) {
        if (!source.dbLoadPromise) {
          source.dbLoadPromise = this._loadFramesFromDB(source);
        }
        await source.dbLoadPromise;
      }

      this.updateLayerProgressBar(layer);

      const { startIdx, endIdx } = this.getLayerFrameRange(layer);

      const missing = [];
      for (let i = startIdx; i <= endIdx; i++) {
        const hasRam = source.frames.has(i);
        const hasDb = source.cachedFrameIndices && source.cachedFrameIndices.has(i);
        if (!hasRam && !hasDb) {
          missing.push(i);
        }
      }

      const total = Math.max(1, endIdx - startIdx + 1);
      const taskKey = `bake_${sourceKey || layer.id}`;

      // Clean up any legacy per-layer task key for the same sourceKey so it never duplicates
      if (taskKey !== `bake_${layer.id}` && this._activeTasks.has(`bake_${layer.id}`)) {
        const legacy = this._activeTasks.get(`bake_${layer.id}`);
        if (legacy && legacy._dismissTimer) clearTimeout(legacy._dismissTimer);
        this._activeTasks.delete(`bake_${layer.id}`);
      }

      if (missing.length === 0) {
        layer._extractProgress = 1;
        layer._extractComplete = true;
        this.updateLayerProgressBar(layer);
        if (this._activeTasks.has(taskKey)) {
          const t = this._activeTasks.get(taskKey);
          t.percent = 100;
          t.status = 'Video Baked (100% Ready)';
          t.currentFrame = total;
          t.totalFrames = total;
          if (!t._dismissTimer) {
            t._dismissTimer = setTimeout(() => {
              this._activeTasks.delete(taskKey);
              this._notifyProgress();
            }, 3000);
          }
        }
        this._notifyProgress();
        if (typeof window !== 'undefined' && window.FishBgRemovalEngine && window.FishBgRemovalEngine.isLayerMattingActive(layer)) {
          window.FishBgRemovalEngine.processLayer(layer);
        }
        return;
      }

      // Register or update active baking task in background processing registry (1 task per video source)
      const cachedNow = Math.max(0, total - missing.length);
      const initialPct = Math.round((cachedNow / total) * 100);
      if (!this._activeTasks.has(taskKey)) {
        this._activeTasks.set(taskKey, {
          id: taskKey,
          layerId: layer.id,
          sourceKey: sourceKey,
          layerName: layer.name || 'Video Clip',
          type: 'baking',
          thumbUrl: layer.thumbUrl || layer.mediaUrl || layer.dataUrl || '',
          status: `Baking frames: ${cachedNow}/${total} (${initialPct}%)`,
          currentFrame: cachedNow,
          totalFrames: total,
          percent: initialPct,
          cancelled: false
        });
        this._notifyProgress();
      } else {
        const existingTask = this._activeTasks.get(taskKey);
        if (existingTask && !existingTask.cancelled && total > existingTask.totalFrames) {
          existingTask.totalFrames = total;
          existingTask.currentFrame = Math.min(total, Math.max(existingTask.currentFrame || 0, cachedNow));
          existingTask.percent = Math.round((existingTask.currentFrame / total) * 100);
          existingTask.status = `Baking frames: ${existingTask.currentFrame}/${total} (${existingTask.percent}%)`;
          this._notifyProgress();
        }
      }

      if (typeof window !== 'undefined' && window.PreviewCacheManager) {
        const pps = window.currentPixelsPerSecond || 80;
        const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
        window.PreviewCacheManager.invalidateRange(start, start + dur);
      }

      if (source.dataUrl) {
        this._startExtractionForSource(source, missing);
      }
    }

    extract(layer) {
      return this.extractLayerRange(layer);
    }

    /**
     * Ensure all frames required by the given video layers (including inside precomps) are 100% cached before export
     */
    async ensureLayersCached(layers, onProgress = null, isCancelled = null) {
      if (!layers || layers.length === 0) return true;

      const videoLayers = this._collectMatchingLayers(
        l => l.type === 'video' && !l.hidden && !(typeof window !== 'undefined' && window.FishBgRemovalEngine && window.FishBgRemovalEngine.isLayerMattingActive(l)),
        layers
      );
      if (videoLayers.length === 0) return true;

      if (typeof window !== 'undefined' && window.currentProjectState && window.currentProjectState.fps) {
        this.setFps(parseInt(window.currentProjectState.fps, 10) || 60);
      }

      const sourcesToExtract = new Map();

      for (const vl of videoLayers) {
        if (isCancelled && isCancelled()) return false;

        if (typeof window !== 'undefined' && window.FishDatabase && window.currentProjectState && window.currentProjectState.id) {
          try {
            const medias = await window.FishDatabase.getProjectMedia(window.currentProjectState.id);
            let m = vl.mediaId ? (medias || []).find(item => item.id === vl.mediaId) : null;
            if (!m && vl.name) m = (medias || []).find(item => item.name === vl.name && (item.type === 'video' || !item.type));
            if (!m) {
              const videoMedias = (medias || []).filter(item => item.type === 'video');
              if (videoMedias.length === 1) m = videoMedias[0];
            }
            if (m) {
              if (m.id && !vl.mediaId) vl.mediaId = m.id;
              if (!vl.dataUrl && m.dataUrl) {
                vl.dataUrl = m.dataUrl;
              } else if (!vl.dataUrl && m.blob) {
                try { vl.dataUrl = URL.createObjectURL(m.blob); } catch (_) {}
              }
              if (m.duration && !vl.mediaDuration) vl.mediaDuration = m.duration;
            }
          } catch (_) {}
        }

        const sourceKey = this._getSourceKey(vl);
        if (!sourceKey) continue;

        const source = this._getOrCreateSource(sourceKey, vl.dataUrl, vl.name, vl.id, false);
        if (vl.mediaDuration && (!source.duration || source.duration <= 0)) {
          source.duration = vl.mediaDuration;
        }
        const nativeFps = (vl.mediaFps && vl.mediaFps >= 10 && vl.mediaFps <= 240) ? vl.mediaFps : null;
        const effectiveFps = nativeFps || (parseInt(typeof window !== 'undefined' && window.currentProjectState && window.currentProjectState.fps, 10) || this.targetFps || 60);
        if (!source.fps || (nativeFps && source.fps !== nativeFps)) {
          source.fps = effectiveFps;
        }
        if (!source.isDbLoaded) {
          if (!source.dbLoadPromise) {
            source.dbLoadPromise = this._loadFramesFromDB(source);
          }
          await source.dbLoadPromise;
        }

        const { startIdx, endIdx } = this.getLayerFrameRange(vl);
        if (!sourcesToExtract.has(sourceKey)) {
          sourcesToExtract.set(sourceKey, {
            source,
            neededFrames: new Set(),
            missingFrames: new Set()
          });
        }
        const entry = sourcesToExtract.get(sourceKey);
        for (let idx = startIdx; idx <= endIdx; idx++) {
          entry.neededFrames.add(idx);
        }
      }

      let totalNeededCount = 0;
      let totalCachedCount = 0;

      for (const [, entry] of sourcesToExtract.entries()) {
        const source = entry.source;
        for (const idx of entry.neededFrames) {
          totalNeededCount++;
          const hasRam = source.frames && source.frames.has(idx);
          const hasDb = source.cachedFrameIndices && source.cachedFrameIndices.has(idx);
          if (hasRam || hasDb) {
            totalCachedCount++;
          } else {
            entry.missingFrames.add(idx);
          }
        }
      }

      if (totalCachedCount >= totalNeededCount || totalNeededCount === 0) {
        if (onProgress) onProgress(100, 'Video cache verified');
        return true;
      }

      for (const [, entry] of sourcesToExtract.entries()) {
        if (entry.missingFrames.size > 0 && entry.source.dataUrl) {
          entry.source._forceExtraction = true;
          this._startExtractionForSource(entry.source, Array.from(entry.missingFrames));
        }
      }

      while (true) {
        if (isCancelled && isCancelled()) {
          for (const entry of sourcesToExtract.values()) {
            delete entry.source._forceExtraction;
          }
          return false;
        }

        let currentCached = 0;
        let anyExtracting = false;

        for (const [, entry] of sourcesToExtract.entries()) {
          const source = entry.source;
          if (source.isExtracting || (this._extractionSourceQueue && this._extractionSourceQueue.includes(source.sourceKey))) {
            anyExtracting = true;
          }
          for (const idx of entry.neededFrames) {
            const hasRam = source.frames && source.frames.has(idx);
            const hasDb = source.cachedFrameIndices && source.cachedFrameIndices.has(idx);
            if (hasRam || hasDb) {
              currentCached++;
            }
          }
        }

        const pct = totalNeededCount > 0 ? Math.min(99, Math.round((currentCached / totalNeededCount) * 100)) : 100;
        if (onProgress) {
          onProgress(pct, `Caching video layers (${pct}% - ${currentCached}/${totalNeededCount} frames)...`);
        }

        if (currentCached >= totalNeededCount || !anyExtracting) {
          break;
        }

        await new Promise(r => setTimeout(r, 50));
      }

      for (const entry of sourcesToExtract.values()) {
        delete entry.source._forceExtraction;
        const matchingLayer = videoLayers.find(l => this._getSourceKey(l) === entry.source.sourceKey);
        if (matchingLayer) this.updateLayerProgressBar(matchingLayer);
      }

      this._scheduleBlobEncodeDrain();
      this._flushSaveQueue();

      if (onProgress) onProgress(100, 'Video cache complete');
      return true;
    }

    _seekVideo(video, targetTime) {
      return new Promise(resolve => {
        if (!video.seeking && Math.abs(video.currentTime - targetTime) < 0.003) {
          resolve(true);
          return;
        }

        let resolved = false;
        const cleanup = () => {
          video.removeEventListener('seeked', onSeek);
          video.removeEventListener('error', onError);
        };

        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(false);
          }
        }, 180);

        const onSeek = () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve(true);
        };

        const onError = () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve(false);
        };

        video.addEventListener('seeked', onSeek, { once: true });
        video.addEventListener('error', onError, { once: true });

        try {
          video.currentTime = targetTime;
        } catch (_) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            cleanup();
            resolve(false);
          }
        }
      });
    }

    _syncSourceDurationToLayers(source) {
      if (!source || source.isPrecomp || !(source.duration > 0) || typeof window === 'undefined' || !window.currentProjectState || !Array.isArray(window.currentProjectState.layers)) {
        return;
      }
      if (window._activeMediaMap && source.sourceKey && window._activeMediaMap.has(source.sourceKey)) {
        const mItem = window._activeMediaMap.get(source.sourceKey);
        mItem.duration = source.duration;
        mItem._durationVerified = true;
      }
      let layerChanged = false;
      const pps = window.currentPixelsPerSecond || 80;
      const allVideoLayers = this._collectMatchingLayers(l => l.type === 'video');
      allVideoLayers.forEach(l => {
        const matches = (this._getSourceKey(l) === source.sourceKey || l.mediaId === source.sourceKey || l.id === source.sourceKey || (l.name && source.name && l.name === source.name));
        if (matches) {
          l.mediaDuration = source.duration;
          const spd = (l.speed && l.speed !== 0) ? Math.abs(l.speed) : 1.0;
          const srcOff = l.sourceOffsetSec || 0;
          const targetDur = Math.max(0.05, (source.duration - srcOff) / spd);
          if (!l._userTrimmed && (!l.durationSec || Math.abs(l.durationSec - targetDur) > 0.01)) {
            l.durationSec = targetDur;
            l.widthPx = Math.max(10, Math.round(targetDur * pps));
            l.isDurationExplicit = true;
            layerChanged = true;
          } else if (l._userTrimmed && l.speedMode !== 'time_remap' && l.durationSec > targetDur + 0.01) {
            l.durationSec = targetDur;
            l.widthPx = Math.max(10, Math.round(targetDur * pps));
            layerChanged = true;
          }
        }
      });
      if (layerChanged) {
        if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
        if (typeof window.updateTimelineDuration === 'function') window.updateTimelineDuration(true);
        if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
      }
    }

    _getFramePriorityTier(source, idx, anchorFrame, lookahead, lookbehind) {
      if (source._forceExtraction) return 1;
      if (idx >= anchorFrame && idx <= anchorFrame + lookahead) return 1;
      if (idx >= anchorFrame - lookbehind && idx < anchorFrame) return 2;
      if (idx > anchorFrame + lookahead) return 3;
      return 4;
    }

    _claimContiguousFrameBatch(source, maxBatchSize = 24) {
      if (!source.pendingFrames || source.pendingFrames.size === 0) return [];

      for (const idx of source.pendingFrames) {
        if ((source.frames && source.frames.has(idx)) || (source.cachedFrameIndices && source.cachedFrameIndices.has(idx))) {
          source.pendingFrames.delete(idx);
          this._notifyLayersForSource(source.sourceKey, false, idx);
        }
      }
      if (source.pendingFrames.size === 0) return [];

      let seedIdx = -1;
      if (source._forceExtraction) {
        for (const idx of source.pendingFrames) {
          if (seedIdx === -1 || idx < seedIdx) seedIdx = idx;
        }
      } else {
        const anchorFrame = this._getVideoFrameForPlayhead(source);
        const fps = source.fps || 60;
        const lookahead = Math.round(fps * 2.0);
        const lookbehind = Math.round(fps * 0.75);
        let bestTier = 99;
        for (const idx of source.pendingFrames) {
          const tier = this._getFramePriorityTier(source, idx, anchorFrame, lookahead, lookbehind);
          if (tier < bestTier || (tier === bestTier && (seedIdx === -1 || idx < seedIdx))) {
            bestTier = tier;
            seedIdx = idx;
          }
        }
      }

      if (seedIdx === -1) return [];

      const candidates = [];
      for (const idx of source.pendingFrames) {
        if (idx >= seedIdx && idx <= seedIdx + maxBatchSize * 2) {
          candidates.push(idx);
        }
      }
      candidates.sort((a, b) => a - b);
      const batch = candidates.slice(0, maxBatchSize);
      for (const idx of batch) {
        source.pendingFrames.delete(idx);
      }
      return batch;
    }

    /**
     * Turbo Hardware-Accelerated WebCodecs Batch Stream Extractor (MP4 / MOV)
     * Uses two-phase Playhead-First GOP prioritization, zero-copy createImageBitmap(videoFrame),
     * sample deduplication, and device-aware backpressure so mobile phones never crash.
     */
    async _tryWebCodecsBatchExtract(source) {
      const safariVer = getSafariMajorVersion();
      if (safariVer > 0 && safariVer < 17) return false;
      if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') return false;
      if (!source || !source.dataUrl) return false;

      let arrayBuffer = source._cachedArrayBuffer || null;
      if (!arrayBuffer) {
        try {
          const res = await fetch(source.dataUrl);
          if (!res.ok) return false;
          arrayBuffer = await res.arrayBuffer();
        } catch (_) {
          return false;
        }
      }
      if (!arrayBuffer || arrayBuffer.byteLength < 64) return false;

      let demuxer;
      try {
        demuxer = new FastMP4Demuxer(arrayBuffer);
      } catch (_) {
        return false;
      }

      const track = demuxer.videoTrack;
      if (!track || !track.samples || track.samples.length === 0) return false;

      const config = {
        codec: track.codec,
        codedWidth: track.width,
        codedHeight: track.height,
        optimizeForLatency: true
      };
      if (track.description) {
        config.description = track.description;
      }

      try {
        const support = await VideoDecoder.isConfigSupported(config);
        if (!support || !support.supported) {
          return false;
        }
      } catch (_) {
        return false;
      }

      if (track.duration > 0) {
        source.duration = track.duration;
        source._durationVerified = true;
        this._syncSourceDurationToLayers(source);
      }

      const tier = this._deviceTier || getDeviceRamTier();
      const vw = track.width || 640;
      const vh = track.height || 360;
      const maxDim = tier.maxTargetDim || 960;
      const scale = Math.min(1, maxDim / Math.max(vw, vh));
      const targetW = Math.max(160, Math.round(vw * scale));
      const targetH = Math.max(90, Math.round(vh * scale));
      source.width = targetW;
      source.height = targetH;

      const samples = track.samples;
      const ptsSorted = samples.slice().sort((a, b) => a.pts - b.pts);
      const totalSamples = samples.length;

      const gops = [];
      let curGop = null;
      for (let i = 0; i < totalSamples; i++) {
        if (samples[i].isKey || !curGop) {
          curGop = { startIdx: i, endIdx: i };
          gops.push(curGop);
        } else {
          curGop.endIdx = i;
        }
      }

      const findSampleForTime = (targetTime) => {
        let lo = 0;
        let hi = ptsSorted.length - 1;
        let best = ptsSorted[0];
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const s = ptsSorted[mid];
          if (s.pts <= targetTime + 0.002) {
            best = s;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        return best;
      };

      let extractedAny = false;
      const maxDecodeQueue = tier.maxDecodeQueue || 12;
      const maxPendingBitmaps = tier.maxPendingBitmaps || 10;
      const drainThreshold = Math.max(2, Math.floor(maxDecodeQueue / 2));

      while (source.pendingFrames && source.pendingFrames.size > 0) {
        if (!this.sources.has(source.sourceKey) || !source.isExtracting) break;

        if (typeof window !== 'undefined' && window.isExporting && !source._forceExtraction) {
          await new Promise(r => setTimeout(r, 100));
          continue;
        }

        const fps = source.fps || 60;
        const maxDur = Math.max(0.01, (source.duration || track.duration || 3600) - 0.005);
        const anchorFrame = this._getVideoFrameForPlayhead(source);
        const lookahead = Math.round(fps * 2.0);
        const lookbehind = Math.round(fps * 0.75);

        const sampleTargets = new Map();
        const ptsUsToSampleIdx = new Map();

        for (const tIdx of Array.from(source.pendingFrames)) {
          if ((source.frames && source.frames.has(tIdx)) || (source.cachedFrameIndices && source.cachedFrameIndices.has(tIdx))) {
            source.pendingFrames.delete(tIdx);
            this._notifyLayersForSource(source.sourceKey, false, tIdx);
            continue;
          }
          const tSec = Math.min(maxDur, Math.max(0, tIdx / fps));
          const sample = findSampleForTime(tSec);
          if (!sample) continue;
          let list = sampleTargets.get(sample.index);
          if (!list) {
            list = [];
            sampleTargets.set(sample.index, list);
            ptsUsToSampleIdx.set(Math.round(sample.pts * 1000000), sample.index);
          }
          list.push(tIdx);
        }

        if (sampleTargets.size === 0) break;

        const playheadGops = [];
        const backgroundGops = [];
        for (const gop of gops) {
          let maxNeededDecodeIdx = -1;
          let bestTier = 99;
          let minTargetIdx = Infinity;

          for (let sIdx = gop.startIdx; sIdx <= gop.endIdx; sIdx++) {
            const targets = sampleTargets.get(sIdx);
            if (targets && targets.length > 0) {
              if (sIdx > maxNeededDecodeIdx) maxNeededDecodeIdx = sIdx;
              for (const tIdx of targets) {
                const fTier = this._getFramePriorityTier(source, tIdx, anchorFrame, lookahead, lookbehind);
                if (fTier < bestTier) bestTier = fTier;
                if (tIdx < minTargetIdx) minTargetIdx = tIdx;
              }
            }
          }

          if (maxNeededDecodeIdx !== -1) {
            const decodeEndIdx = Math.min(gop.endIdx, maxNeededDecodeIdx + 8);
            const gopItem = {
              startIdx: gop.startIdx,
              decodeEndIdx,
              bestTier,
              minTargetIdx
            };
            if (bestTier <= 2 && !source._forceExtraction) {
              playheadGops.push(gopItem);
            } else {
              backgroundGops.push(gopItem);
            }
          }
        }

        // Two-Phase Playhead-First GOP Order:
        // Phase 1: Playhead-adjacent GOPs sorted chronologically among themselves (instant preview!)
        // Phase 2: Remaining GOPs sorted chronologically
        playheadGops.sort((a, b) => a.startIdx - b.startIdx);
        backgroundGops.sort((a, b) => a.startIdx - b.startIdx);
        const activeGops = playheadGops.concat(backgroundGops);

        if (activeGops.length === 0) break;

        let decoderFailed = false;
        let passExtractedCount = 0;
        const pendingBitmapTasks = new Set();

        const handleVideoFrame = (videoFrame) => {
          if (!this.sources.has(source.sourceKey) || !source.isExtracting) {
            try { videoFrame.close(); } catch (_) {}
            return;
          }

          const ts = videoFrame.timestamp;
          let sIdx = ptsUsToSampleIdx.get(ts);
          if (sIdx === undefined) {
            for (const [kTs, valIdx] of ptsUsToSampleIdx.entries()) {
              if (Math.abs(kTs - ts) <= 45000) {
                sIdx = valIdx;
                break;
              }
            }
          }
          if (sIdx === undefined) {
            const nearSample = findSampleForTime((ts || 0) / 1000000);
            if (nearSample && sampleTargets.has(nearSample.index)) {
              sIdx = nearSample.index;
            }
          }

          const targets = sIdx !== undefined ? sampleTargets.get(sIdx) : null;
          if (!targets || targets.length === 0) {
            try { videoFrame.close(); } catch (_) {}
            return;
          }
          sampleTargets.delete(sIdx);

          const task = (async () => {
            let bmp = null;
            try {
              bmp = await createImageBitmap(videoFrame, {
                resizeWidth: targetW,
                resizeHeight: targetH,
                resizeQuality: 'low'
              });
            } catch (_) {
              try {
                bmp = await createImageBitmap(videoFrame);
              } catch (__) {}
            } finally {
              try { videoFrame.close(); } catch (_) {}
            }

            if (!bmp) return;
            if (!this.sources.has(source.sourceKey) || !source.isExtracting) {
              try { bmp.close(); } catch (_) {}
              return;
            }

            // Deduplicate: assign the single GPU ImageBitmap across all timeline frame indices mapping to this sample
            let assignedCount = 0;
            for (const tIdx of targets) {
              source.pendingFrames.delete(tIdx);
              if (source.frames.has(tIdx)) continue;
              retainBitmap(bmp, source.sourceKey);
              source.frames.set(tIdx, bmp);
              if (!source.cachedFrameIndices) source.cachedFrameIndices = new Set();
              source.cachedFrameIndices.add(tIdx);
              source._hasNewExtractedFrames = true;
              extractedAny = true;
              assignedCount++;
              passExtractedCount++;
              this._queueBitmapForDB(source.sourceKey, tIdx, bmp, source.fps, false);
              this._evictOldestFrame(source, tIdx);
              this._notifyLayersForSource(source.sourceKey, false, tIdx);
            }
            if (assignedCount === 0 && typeof bmp.close === 'function') {
              try { bmp.close(); } catch (_) {}
            }
          })();

          pendingBitmapTasks.add(task);
          task.finally(() => pendingBitmapTasks.delete(task));
        };

        const decoder = new VideoDecoder({
          output: handleVideoFrame,
          error: () => {
            decoderFailed = true;
          }
        });
        source.activeDecoder = decoder;

        try {
          decoder.configure(config);
        } catch (_) {
          try { decoder.close(); } catch (__) {}
          source.activeDecoder = null;
          return extractedAny;
        }

        let lastEndSampleIdx = -1;
        for (const gopSeg of activeGops) {
          if (!this.sources.has(source.sourceKey) || !source.isExtracting || decoderFailed) break;

          if (lastEndSampleIdx !== -1 && gopSeg.startIdx !== lastEndSampleIdx + 1) {
            try {
              await decoder.flush();
              if (pendingBitmapTasks.size > 0) {
                await Promise.all(Array.from(pendingBitmapTasks));
              }
              if (typeof decoder.reset === 'function') {
                decoder.reset();
                decoder.configure(config);
              }
            } catch (_) {
              decoderFailed = true;
              break;
            }
          }

          for (let sIdx = gopSeg.startIdx; sIdx <= gopSeg.decodeEndIdx; sIdx++) {
            if (!this.sources.has(source.sourceKey) || !source.isExtracting || decoderFailed) break;
            const s = samples[sIdx];
            const chunkData = new Uint8Array(arrayBuffer, s.offset, s.size);
            const chunk = new EncodedVideoChunk({
              type: s.isKey ? 'key' : 'delta',
              timestamp: Math.round(s.pts * 1000000),
              duration: Math.round(s.duration * 1000000),
              data: chunkData
            });
            decoder.decode(chunk);

            if (decoder.decodeQueueSize > maxDecodeQueue || pendingBitmapTasks.size > maxPendingBitmaps) {
              let backpressureWaits = 0;
              while ((decoder.decodeQueueSize > drainThreshold || pendingBitmapTasks.size > drainThreshold) && !decoderFailed && source.isExtracting && backpressureWaits < 25) {
                backpressureWaits++;
                await yieldToUI(tier.isMobile ? 6 : 3);
              }
            } else if ((sIdx - gopSeg.startIdx) % (tier.isMobile ? 10 : 20) === (tier.isMobile ? 9 : 19)) {
              await yieldToUI(tier.isMobile ? 2 : 0);
            }
          }
          lastEndSampleIdx = gopSeg.decodeEndIdx;
        }

        try {
          if (!decoderFailed && decoder.state === 'configured') {
            await decoder.flush();
          }
        } catch (_) {
          decoderFailed = true;
        }
        if (pendingBitmapTasks.size > 0) {
          await Promise.all(Array.from(pendingBitmapTasks));
        }

        try {
          if (decoder.state !== 'closed') decoder.close();
        } catch (_) {}
        source.activeDecoder = null;

        // If any frames were extracted in this pass, any remaining sample targets from this pass
        // that were dropped by the decoder can be safely filled from the nearest decoded frame
        if (passExtractedCount > 0 && sampleTargets.size > 0) {
          for (const [, remTargets] of sampleTargets.entries()) {
            for (const remTIdx of remTargets) {
              source.pendingFrames.delete(remTIdx);
              if (!source.frames.has(remTIdx)) {
                let bestBmp = null;
                let minDist = Infinity;
                for (const [kIdx, bmp] of source.frames.entries()) {
                  const dist = Math.abs(kIdx - remTIdx);
                  if (dist < minDist) {
                    minDist = dist;
                    bestBmp = bmp;
                    if (dist <= 1) break;
                  }
                }
                if (bestBmp) {
                  retainBitmap(bestBmp, source.sourceKey);
                  source.frames.set(remTIdx, bestBmp);
                  if (!source.cachedFrameIndices) source.cachedFrameIndices = new Set();
                  source.cachedFrameIndices.add(remTIdx);
                  this._queueBitmapForDB(source.sourceKey, remTIdx, bestBmp, source.fps, false);
                  this._notifyLayersForSource(source.sourceKey, false, remTIdx);
                } else {
                  if (!source.cachedFrameIndices) source.cachedFrameIndices = new Set();
                  source.cachedFrameIndices.add(remTIdx);
                  if (!source.failedFrameIndices) source.failedFrameIndices = new Set();
                  source.failedFrameIndices.add(remTIdx);
                }
              }
            }
          }
        }

        if (decoderFailed || passExtractedCount === 0) {
          break;
        }
      }

      // Free raw MP4 ArrayBuffer immediately after WebCodecs batch completes to save 50-200MB RAM on mobile!
      source._cachedArrayBuffer = null;

      return extractedAny && (!source.pendingFrames || source.pendingFrames.size === 0);
    }

    /**
     * Single-Stream Sequential Video Decoder Fallback with Bitmap Deduplication
     */
    async _extractWithVideoPool(source, primaryVideo, targetW, targetH) {
      if (typeof document === 'undefined') return;
      source.activeVideos = [primaryVideo];

      const tier = this._deviceTier || getDeviceRamTier();
      const failedAttempts = new Map();
      let offCanvas = null;
      let offCtx = null;
      let lastDecodedTime = -1;
      let lastCreatedBmp = null;
      let stepCounter = 0;

      while (source.pendingFrames && source.pendingFrames.size > 0) {
        if (!this.sources.has(source.sourceKey) || !source.isExtracting) break;

        if (typeof window !== 'undefined' && window.isExporting && !source._forceExtraction) {
          await new Promise(r => setTimeout(r, 100));
          continue;
        }

        const batch = this._claimContiguousFrameBatch(source, tier.isMobile ? 16 : 24);
        if (batch.length === 0) break;
        batch.sort((a, b) => a - b);

        for (const targetIdx of batch) {
          if (!this.sources.has(source.sourceKey) || !source.isExtracting) break;

          if (source.frames.has(targetIdx) || (source.cachedFrameIndices && source.cachedFrameIndices.has(targetIdx))) {
            this._notifyLayersForSource(source.sourceKey, false, targetIdx);
            continue;
          }

          if (!source._forceExtraction && this._isUserInteracting()) {
            await yieldToUI(16);
          }

          const targetTime = Math.min(Math.max(0, (source.duration || 3600) - 0.01), Math.max(0, targetIdx / source.fps));
          const seekOk = await this._seekVideo(primaryVideo, targetTime);
          const timeDiff = Math.abs(primaryVideo.currentTime - targetTime);
          const isAtEnd = (source.duration > 0 && Math.abs(primaryVideo.currentTime - source.duration) < 0.1 && targetTime >= source.duration - 0.1);

          if (!seekOk && timeDiff > 0.08 && !isAtEnd) {
            const attempts = (failedAttempts.get(targetIdx) || 0) + 1;
            failedAttempts.set(targetIdx, attempts);
            if (attempts < 3) {
              source.pendingFrames.add(targetIdx);
              await yieldToUI(4);
              continue;
            }
          }

          let bmp = null;
          if (primaryVideo.videoWidth > 0) {
            // Fast Sample Deduplication: if video landed on the exact same presentation timestamp, reuse lastCreatedBmp!
            if (lastCreatedBmp && Math.abs(primaryVideo.currentTime - lastDecodedTime) < 0.002) {
              bmp = lastCreatedBmp;
            } else {
              try {
                bmp = await createImageBitmap(primaryVideo, {
                  resizeWidth: targetW,
                  resizeHeight: targetH,
                  resizeQuality: 'low'
                });
              } catch (_) {
                try {
                  if (!offCanvas) {
                    if (typeof OffscreenCanvas !== 'undefined') {
                      offCanvas = new OffscreenCanvas(targetW, targetH);
                    } else {
                      offCanvas = document.createElement('canvas');
                      offCanvas.width = targetW;
                      offCanvas.height = targetH;
                    }
                    offCtx = offCanvas.getContext('2d', { alpha: false });
                  }
                  if (offCtx) {
                    offCtx.drawImage(primaryVideo, 0, 0, targetW, targetH);
                    bmp = await createImageBitmap(offCanvas);
                  } else {
                    bmp = await createImageBitmap(primaryVideo);
                  }
                } catch (__) {}
              }
              if (bmp) {
                lastDecodedTime = primaryVideo.currentTime;
                lastCreatedBmp = bmp;
              }
            }
          }

          if (!bmp) {
            if (lastCreatedBmp) {
              bmp = lastCreatedBmp;
            } else if (source.frames.size > 0) {
              let minDist = Infinity;
              for (const [kIdx, candBmp] of source.frames.entries()) {
                const dist = Math.abs(kIdx - targetIdx);
                if (dist < minDist) {
                  minDist = dist;
                  bmp = candBmp;
                }
              }
            }
          }

          if (bmp) {
            retainBitmap(bmp, source.sourceKey);
            source.frames.set(targetIdx, bmp);
            if (!source.cachedFrameIndices) source.cachedFrameIndices = new Set();
            source.cachedFrameIndices.add(targetIdx);
            source._hasNewExtractedFrames = true;
            this._queueBitmapForDB(source.sourceKey, targetIdx, bmp, source.fps, false);
            this._evictOldestFrame(source, targetIdx);
          } else {
            if (!source.cachedFrameIndices) source.cachedFrameIndices = new Set();
            source.cachedFrameIndices.add(targetIdx);
            if (!source.failedFrameIndices) source.failedFrameIndices = new Set();
            source.failedFrameIndices.add(targetIdx);
          }

          this._notifyLayersForSource(source.sourceKey, false, targetIdx);
          stepCounter++;
          if (tier.isMobile || stepCounter % 3 === 0) {
            await yieldToUI(tier.isMobile ? 2 : 0);
          }
        }
      }
    }

    _pumpNextQueuedSourceExtraction() {
      if (!this._extractionSourceQueue || this._extractionSourceQueue.length === 0) return;
      for (const s of this.sources.values()) {
        if (!s.isPrecomp && s.isExtracting) return;
      }
      while (this._extractionSourceQueue.length > 0) {
        const nextKey = this._extractionSourceQueue.shift();
        const nextSource = this.sources.get(nextKey);
        if (nextSource && nextSource.pendingFrames && nextSource.pendingFrames.size > 0 && !nextSource.isExtracting) {
          this._runSourceExtractionNow(nextSource);
          return;
        }
      }
    }

    _startExtractionForSource(source, newMissingIndices) {
      if (!source.dataUrl) return;

      if (typeof source.dataUrl === 'string' && source.dataUrl.startsWith('data:video')) {
        fetch(source.dataUrl).then(r => r.blob()).then(blob => {
          source.dataUrl = URL.createObjectURL(blob);
          source._blobUrlCreated = true;
          this._startExtractionForSource(source, newMissingIndices);
        }).catch(e => {
          console.warn('[VideoFrameExtractor] Failed to convert data URL to Blob URL:', e);
        });
        return;
      }

      if (!source.pendingFrames) source.pendingFrames = new Set();
      newMissingIndices.forEach(idx => source.pendingFrames.add(idx));

      if (source.isExtracting) return;

      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (source._lastExtractPassEnd && (now - source._lastExtractPassEnd) < 600 && (source._consecutivePasses || 0) >= 3) {
        console.warn(`[VideoFrameExtractor] Circuit breaker tripped for source ${source.sourceKey}: stopping rapid extraction loops.`);
        if (source.pendingFrames && source.pendingFrames.size > 0) {
          for (const fIdx of source.pendingFrames) {
            if (!source.cachedFrameIndices) source.cachedFrameIndices = new Set();
            source.cachedFrameIndices.add(fIdx);
          }
          source.pendingFrames.clear();
        }
        this._notifyLayersForSource(source.sourceKey, true);
        return;
      }

      // Serialize multi-source video hardware decoding so mobile SoCs never spawn parallel decoders and crash
      let otherVideoExtracting = false;
      for (const s of this.sources.values()) {
        if (!s.isPrecomp && s.isExtracting && s.sourceKey !== source.sourceKey) {
          otherVideoExtracting = true;
          break;
        }
      }
      if (otherVideoExtracting) {
        if (!this._extractionSourceQueue) this._extractionSourceQueue = [];
        if (!this._extractionSourceQueue.includes(source.sourceKey)) {
          this._extractionSourceQueue.push(source.sourceKey);
        }
        return;
      }

      this._runSourceExtractionNow(source);
    }

    _runSourceExtractionNow(source) {
      if (!source || source.isExtracting) return;
      source.isExtracting = true;
      source._consecutivePasses = (source._consecutivePasses || 0) + 1;

      this._tryWebCodecsBatchExtract(source).then(completedViaWebCodecs => {
        if (!this.sources.has(source.sourceKey) || !source.isExtracting) {
          this._cleanupSourceDecoders(source);
          this._pumpNextQueuedSourceExtraction();
          return;
        }
        if (completedViaWebCodecs && (!source.pendingFrames || source.pendingFrames.size === 0)) {
          source.isExtracting = false;
          source._lastExtractPassEnd = (typeof performance !== 'undefined') ? performance.now() : Date.now();
          this._cleanupSourceDecoders(source);
          this._scheduleBlobEncodeDrain();
          this._flushSaveQueue();
          this._notifyLayersForSource(source.sourceKey, true);
          this._pumpNextQueuedSourceExtraction();
          return;
        }
        this._startVideoElementExtraction(source);
      }).catch(() => {
        if (this.sources.has(source.sourceKey) && source.isExtracting) {
          this._startVideoElementExtraction(source);
        } else {
          this._pumpNextQueuedSourceExtraction();
        }
      });
    }

    _startVideoElementExtraction(source) {
      if (!this.sources.has(source.sourceKey) || !source.isExtracting || typeof document === 'undefined') {
        this._pumpNextQueuedSourceExtraction();
        return;
      }

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.style.cssText = 'position:fixed;bottom:0;right:0;width:32px;height:32px;opacity:0.01;pointer-events:none;z-index:-9999;';
      const mountPool = document.getElementById('editor-video-mount-pool') || document.body;
      mountPool.appendChild(video);
      source.activeVideo = video;

      let decodingStarted = false;
      const startDecoding = async () => {
        if (decodingStarted) return;
        decodingStarted = true;

        if (isFinite(video.duration) && video.duration > 0) {
          source.duration = video.duration;
          source._durationVerified = true;
        } else if (!source.duration || source.duration <= 0) {
          try {
            video.currentTime = 1e101;
            await new Promise(r => {
              const onSeek = () => { video.removeEventListener('seeked', onSeek); r(); };
              video.addEventListener('seeked', onSeek, { once: true });
              setTimeout(r, 200);
            });
            if (isFinite(video.currentTime) && video.currentTime > 0) {
              source.duration = video.currentTime;
              source._durationVerified = true;
            }
            video.currentTime = 0;
          } catch (_) {}
        }

        this._syncSourceDurationToLayers(source);

        const tier = this._deviceTier || getDeviceRamTier();
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 360;
        const maxDim = tier.maxTargetDim || 960;
        const scale = Math.min(1, maxDim / Math.max(vw, vh));
        const targetW = Math.max(160, Math.round(vw * scale));
        const targetH = Math.max(90, Math.round(vh * scale));
        source.width = targetW;
        source.height = targetH;

        await this._extractWithVideoPool(source, video, targetW, targetH);

        source.isExtracting = false;
        source._lastExtractPassEnd = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        this._cleanupSourceDecoders(source);
        this._scheduleBlobEncodeDrain();
        this._flushSaveQueue();
        this._notifyLayersForSource(source.sourceKey, true);
        this._pumpNextQueuedSourceExtraction();
      };

      const onVideoReady = () => {
        video.removeEventListener('loadedmetadata', onVideoReady);
        video.removeEventListener('loadeddata', onVideoReady);
        video.removeEventListener('canplay', onVideoReady);
        startDecoding();
      };
      video.addEventListener('loadedmetadata', onVideoReady, { once: true });
      video.addEventListener('loadeddata', onVideoReady, { once: true });
      video.addEventListener('canplay', onVideoReady, { once: true });

      video.onerror = async () => {
        if (typeof window !== 'undefined' && window.FishDatabase && window.currentProjectState && window.currentProjectState.id) {
          try {
            const medias = await window.FishDatabase.getProjectMedia(window.currentProjectState.id);
            let m = (medias || []).find(item => item.id === source.sourceKey);
            if (!m && source.name) {
              m = (medias || []).find(item => item.name === source.name);
            }
            if (!m) {
              const videoMedias = (medias || []).filter(item => item.type === 'video');
              if (videoMedias.length === 1) m = videoMedias[0];
            }

            if (m && m.blob) {
              const freshUrl = URL.createObjectURL(m.blob);
              source.dataUrl = freshUrl;
              source._cachedArrayBuffer = null;
              if (m.name && !source.name) source.name = m.name;
              if (m.id && source.sourceKey.startsWith('src_')) {
                this.sources.delete(source.sourceKey);
                source.sourceKey = m.id;
                this.sources.set(m.id, source);
              }
              const allVideoLayers = this._collectMatchingLayers(l => l.type === 'video');
              allVideoLayers.forEach(l => {
                if (l.mediaId === m.id || l.name === m.name || this._getSourceKey(l) === source.sourceKey) {
                  l.dataUrl = freshUrl;
                  l.mediaId = m.id;
                }
              });
              video.src = freshUrl;
              video.load();
              if (video.readyState >= 1) {
                startDecoding();
              } else {
                video.addEventListener('loadedmetadata', startDecoding, { once: true });
                video.addEventListener('canplay', startDecoding, { once: true });
              }
              return;
            }
          } catch (_) {}
        }
        source.isExtracting = false;
        source._lastExtractPassEnd = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        this._cleanupSourceDecoders(source);
        this._pumpNextQueuedSourceExtraction();
      };

      video.src = source.dataUrl;
      video.load();

      if (video.readyState >= 1) {
        startDecoding();
      }

      setTimeout(() => {
        if (!decodingStarted && video.readyState >= 1) {
          startDecoding();
        }
      }, 250);
    }

    /**
     * Update progress bar of a video or precomp layer on the timeline
     */
    updateLayerProgressBar(layer) {
      if (!layer || (layer.type !== 'video' && layer.type !== 'precomp')) return;
      if (typeof document === 'undefined') return;

      const sourceKey = this._getSourceKey(layer);
      let source = this.sources.get(sourceKey);
      if (!source && layer.type === 'video') {
        for (const [sKey, s] of this.sources.entries()) {
          if (sKey === layer.mediaId || (layer.name && s.name === layer.name && !s.isPrecomp)) {
            source = s;
            break;
          }
        }
      }

      const { startIdx, endIdx, total } = this.getLayerFrameRange(layer);

      let cached = 0;
      if (layer.type === 'precomp' && typeof window !== 'undefined' && typeof window.isPrecompEffectivelyCollapsed === 'function' && window.isPrecompEffectivelyCollapsed(layer)) {
        cached = total;
      } else if (source) {
        for (let i = startIdx; i <= endIdx; i++) {
          if (source.frames.has(i) || (source.cachedFrameIndices && source.cachedFrameIndices.has(i))) cached++;
        }
      }

      const progress = total > 0 ? Math.min(1, cached / total) : 1;
      layer._extractProgress = progress;
      layer._extractComplete = (cached >= total);

      if (typeof document.querySelector !== 'function') return;
      const clipBlock = document.querySelector(`.timeline-clip-block[data-layer-id="${layer.id}"]`);
      if (clipBlock) {
        let bar = clipBlock.querySelector('.timeline-clip-progress');
        let track = clipBlock.querySelector('.timeline-clip-progress-track');
        if (!track && !layer._extractComplete) {
          track = document.createElement('div');
          track.className = 'timeline-clip-progress-track';
          bar = document.createElement('div');
          bar.className = 'timeline-clip-progress';
          track.appendChild(bar);
          clipBlock.appendChild(track);
        }
        const pct = (progress * 100).toFixed(1);
        if (bar) bar.style.width = pct + '%';
        if (layer._extractComplete) {
          if (bar) bar.classList.add('is-complete');
          if (track) track.classList.add('is-complete');
        } else {
          if (bar) bar.classList.remove('is-complete');
          if (track) track.classList.remove('is-complete');
        }
      }
    }

    _notifyLayersForSource(sourceKey, isComplete = false, justExtractedIdx = null) {
      if (typeof window === 'undefined') return;

      const source = this.sources.get(sourceKey);
      const curPlayheadFIdx = source ? this._getVideoFrameForPlayhead(source) : 0;
      const isPlayheadFrame = justExtractedIdx !== null && (Math.abs(justExtractedIdx - curPlayheadFIdx) <= 2 || (source && source.frames.size <= 2));
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();

      // Throttle heavy O(N * F) layer progress scans during fast batch extraction unless complete or playhead frame
      if (!isComplete && !isPlayheadFrame && source && source._lastNotifyMs && (now - source._lastNotifyMs) < 65) {
        return;
      }
      if (source) {
        source._lastNotifyMs = now;
      }

      const allLayers = this._collectMatchingLayers(l => l.type === 'video' || l.type === 'precomp');
      if (allLayers.length > 0) {
        const matchingLayers = [];
        const neededFrames = new Set();

        allLayers.forEach(l => {
          const match = (this._getSourceKey(l) === sourceKey || l.mediaId === sourceKey || l.id === sourceKey || (l.name && source && l.name === source.name));
          if (match) {
            matchingLayers.push(l);
            const { startIdx, endIdx, total } = this.getLayerFrameRange(l);
            let cached = 0;
            if (l._extractComplete) {
              cached = total;
            } else if (source) {
              for (let i = startIdx; i <= endIdx; i++) {
                neededFrames.add(i);
                if (source.frames.has(i) || (source.cachedFrameIndices && source.cachedFrameIndices.has(i))) cached++;
              }
            } else {
              for (let i = startIdx; i <= endIdx; i++) neededFrames.add(i);
            }
            const progress = total > 0 ? Math.min(1, cached / total) : 1;
            l._extractProgress = progress;
            l._extractComplete = (cached >= total);

            // Clean up any legacy per-layer task key
            const legacyKey = `bake_${l.id}`;
            if (legacyKey !== `bake_${sourceKey}` && this._activeTasks.has(legacyKey)) {
              const lt = this._activeTasks.get(legacyKey);
              if (lt && lt._dismissTimer) clearTimeout(lt._dismissTimer);
              this._activeTasks.delete(legacyKey);
            }
          }
        });

        if (matchingLayers.length > 0) {
          const primaryLayer = matchingLayers[0];
          const taskKey = `bake_${sourceKey || primaryLayer.id}`;
          let task = this._activeTasks.get(taskKey);

          let totalSourceFrames = neededFrames.size;
          let cachedSourceFrames = 0;
          if (totalSourceFrames > 0 && source) {
            for (const fIdx of neededFrames) {
              if (source.frames.has(fIdx) || (source.cachedFrameIndices && source.cachedFrameIndices.has(fIdx))) {
                cachedSourceFrames++;
              }
            }
          } else {
            const r = this.getLayerFrameRange(primaryLayer);
            totalSourceFrames = r.total;
            cachedSourceFrames = Math.round((primaryLayer._extractProgress || 0) * r.total);
          }

          const allDone = isComplete || (totalSourceFrames > 0 && cachedSourceFrames >= totalSourceFrames) || matchingLayers.every(l => l._extractComplete);
          const overallPct = allDone ? 100 : (totalSourceFrames > 0 ? Math.round((cachedSourceFrames / totalSourceFrames) * 100) : 0);

          if (allDone) {
            if (source) source._consecutivePasses = 0;
            if (task) {
              task.percent = 100;
              task.status = 'Video Baked (100% Ready)';
              task.currentFrame = totalSourceFrames;
              task.totalFrames = totalSourceFrames;
              if (!task._dismissTimer) {
                task._dismissTimer = setTimeout(() => {
                  this._activeTasks.delete(taskKey);
                  this._notifyProgress();
                }, 3000);
              }
            }
            matchingLayers.forEach(l => {
              if (typeof window !== 'undefined' && window.FishBgRemovalEngine && window.FishBgRemovalEngine.isLayerMattingActive(l)) {
                window.FishBgRemovalEngine.processLayer(l);
              }
            });
          } else {
            if (!task) {
              task = {
                id: taskKey,
                layerId: primaryLayer.id,
                sourceKey: sourceKey,
                layerName: primaryLayer.name || 'Video Clip',
                type: 'baking',
                thumbUrl: primaryLayer.thumbUrl || primaryLayer.mediaUrl || primaryLayer.dataUrl || '',
                currentFrame: cachedSourceFrames,
                totalFrames: totalSourceFrames,
                percent: overallPct,
                cancelled: false
              };
              this._activeTasks.set(taskKey, task);
            }
            if (task._dismissTimer) {
              clearTimeout(task._dismissTimer);
              task._dismissTimer = null;
            }
            task.currentFrame = cachedSourceFrames;
            task.totalFrames = totalSourceFrames;
            task.percent = overallPct;
            task.status = `Baking frames: ${cachedSourceFrames}/${totalSourceFrames} (${overallPct}%)`;
          }
        }
        this._notifyProgress();
      }

      if (!this._rafProgressBarScheduled && typeof requestAnimationFrame === 'function') {
        this._rafProgressBarScheduled = true;
        requestAnimationFrame(() => {
          this._rafProgressBarScheduled = false;
          if (allLayers.length > 0) {
            allLayers.forEach(l => {
              const match = (this._getSourceKey(l) === sourceKey || l.mediaId === sourceKey || l.id === sourceKey || (l.name && source && l.name === source.name));
              if (match) {
                this.updateLayerProgressBar(l);
              }
            });
          }
        });
      }

      if (typeof window.redrawComposition === 'function' && !this._isUserInteracting()) {
        if (isComplete) {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
              if (typeof window.redrawComposition === 'function' && !this._isUserInteracting()) {
                window.redrawComposition('frameExtractorComplete');
              }
            });
          } else {
            setTimeout(() => {
              if (typeof window.redrawComposition === 'function' && !this._isUserInteracting()) {
                window.redrawComposition('frameExtractorComplete');
              }
            }, 16);
          }
        } else if (isPlayheadFrame) {
          window.redrawComposition('frameExtractorPlayheadReady');
        } else {
          if (!this._lastProgressRedrawTime || (now - this._lastProgressRedrawTime) >= 120) {
            this._lastProgressRedrawTime = now;
            window.redrawComposition('frameExtractorProgress');
          }
        }
      }

      if (window.PreviewCacheManager && isComplete && source && source._hasNewExtractedFrames) {
        source._hasNewExtractedFrames = false;
        const pps = window.currentPixelsPerSecond || 80;
        const matchingLayers = this._collectMatchingLayers(l => (l.type === 'video' || l.type === 'precomp') && !l.hidden && this._getSourceKey(l) === sourceKey);
        if (matchingLayers.length === 0) return;

        if (!window.isTimelinePlaying) {
          matchingLayers.forEach(l => {
            const start = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
            const dur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 320) / pps);
            window.PreviewCacheManager.invalidateRange(start, start + dur);
          });
          if (window.PreviewCacheManager.idleCacheEnabled) {
            window.PreviewCacheManager.scheduleIdleCheck();
          }
        } else {
          window._pendingVideoCacheInvalidation = true;
        }
      }
    }

    async abortAndRevertPartialSequence(target) {
      if (!target) return;
      let layer = null;
      let sourceKey = null;

      if (typeof target === 'object' && target !== null) {
        if (target.type === 'video' || target.type === 'precomp' || target.effects) {
          layer = target;
          sourceKey = this._getSourceKey(layer);
        } else if (target.sourceKey) {
          sourceKey = target.sourceKey;
        } else if (target.id) {
          sourceKey = target.id;
        }
      } else if (typeof target === 'string') {
        sourceKey = target;
      }

      if (!sourceKey && layer) sourceKey = layer.mediaId || layer.dataUrl || layer.id;
      if (!sourceKey) return;

      const source = this.sources.get(sourceKey);
      if (source) {
        source.isExtracting = false;
        this._cleanupSourceDecoders(source);
        if (source.pendingFrames) source.pendingFrames.clear();

        if (source.frames) {
          const closedSet = new Set();
          source.frames.forEach(bmp => {
            if (bmp && !closedSet.has(bmp) && typeof bmp.close === 'function') {
              closedSet.add(bmp);
              try { bmp.close(); } catch (_) {}
            }
          });
          source.frames.clear();
        }
        if (source.cachedFrameIndices) source.cachedFrameIndices.clear();
        if (source._fetchingFrames) source._fetchingFrames.clear();
        source._hasNewExtractedFrames = false;
      }

      if (this._blobEncodeQueue && this._blobEncodeQueue.length > 0) {
        this._blobEncodeQueue = this._blobEncodeQueue.filter(item => item.sourceKey !== sourceKey);
      }
      if (this._saveQueue && this._saveQueue.length > 0) {
        this._saveQueue = this._saveQueue.filter(item => item.sourceKey !== sourceKey);
      }

      await this._deleteFramesFromDB(sourceKey);

      const allLayers = this._collectMatchingLayers(l => l.type === 'video' || l.type === 'precomp');
      if (layer && !allLayers.includes(layer)) allLayers.push(layer);

      allLayers.forEach(l => {
        const matches = (this._getSourceKey(l) === sourceKey || l.mediaId === sourceKey || l.id === sourceKey || (source && l.name === source.name));
        if (matches) {
          l._extractProgress = 0;
          l._extractComplete = false;
          delete l._lastRenderedFrame;
          delete l._lastRenderedCutoutFrame;
          this.updateLayerProgressBar(l);
        }
      });

      if (typeof window !== 'undefined' && window.PreviewCacheManager && layer) {
        const pps = window.currentPixelsPerSecond || 80;
        const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
        window.PreviewCacheManager.invalidateRange(start, start + dur);
      }

      if (typeof window !== 'undefined' && typeof window.redrawComposition === 'function') {
        window.redrawComposition('abortAndRevertPartialSequence');
      }
    }

    async clearLayer(layer) {
      if (!layer) return;
      const sourceKey = this._getSourceKey(layer);
      const allLayers = this._collectMatchingLayers(l => l.id !== layer.id && this._getSourceKey(l) === sourceKey);
      if (allLayers.length === 0) {
        await this.clearSource(sourceKey);
      }
    }

    async clearSource(target) {
      if (!target) return;
      const keysToClear = new Set();
      if (typeof target === 'object' && target !== null) {
        if (target.type === 'precomp') keysToClear.add(this._getSourceKey(target));
        if (target.id) keysToClear.add(target.id);
        if (target.mediaId) keysToClear.add(target.mediaId);
        if (target.dataUrl) keysToClear.add(target.dataUrl);
        if (target.name) {
          keysToClear.add(target.name);
          for (const [k, s] of this.sources.entries()) {
            if (s && s.name === target.name) keysToClear.add(k);
          }
        }
      } else if (typeof target === 'string') {
        keysToClear.add(target);
        for (const [k, s] of this.sources.entries()) {
          if (s && (s.sourceKey === target || s.name === target || s.dataUrl === target || s.layerId === target)) {
            keysToClear.add(k);
          }
        }
      }

      if (this._blobEncodeQueue && this._blobEncodeQueue.length > 0) {
        this._blobEncodeQueue = this._blobEncodeQueue.filter(item => !keysToClear.has(item.sourceKey));
      }
      if (this._saveQueue && this._saveQueue.length > 0) {
        this._saveQueue = this._saveQueue.filter(item => !keysToClear.has(item.sourceKey));
      }

      for (const k of keysToClear) {
        const source = this.sources.get(k);
        if (source) {
          source.isExtracting = false;
          if (source.pendingFrames) source.pendingFrames.clear();
          this._cleanupSourceDecoders(source);
          source._cachedArrayBuffer = null;
          if (source.frames) {
            const closedSet = new Set();
            source.frames.forEach(bmp => {
              if (bmp && !closedSet.has(bmp) && typeof bmp.close === 'function') {
                closedSet.add(bmp);
                try { bmp.close(); } catch (_) {}
              }
            });
            source.frames.clear();
          }
          if (source.cachedFrameIndices) source.cachedFrameIndices.clear();
          if (source._fetchingFrames) source._fetchingFrames.clear();
          this.sources.delete(k);
        }
        await this._deleteFramesFromDB(k);
      }
    }

    async _deleteFramesFromDB(sourceKey) {
      const db = await this._getDB();
      if (!db) return;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
          if (store.indexNames.contains('sourceKey')) {
            const index = store.index('sourceKey');
            const req = index.openKeyCursor(IDBKeyRange.only(sourceKey));
            req.onsuccess = (e) => {
              const cursor = e.target.result;
              if (cursor) {
                store.delete(cursor.primaryKey);
                cursor.continue();
              } else {
                resolve();
              }
            };
            req.onerror = () => resolve();
          } else {
            const req = store.openCursor();
            req.onsuccess = (e) => {
              const cursor = e.target.result;
              if (cursor) {
                if (cursor.value && (cursor.value.sourceKey === sourceKey || (cursor.key && String(cursor.key).startsWith(sourceKey + '_')))) {
                  store.delete(cursor.primaryKey);
                }
                cursor.continue();
              } else {
                resolve();
              }
            };
            req.onerror = () => resolve();
          }
        } catch (_) {
          resolve();
        }
      });
    }

    async clearAllCache() {
      this.sources.forEach(source => {
        if (source.frames) {
          const closedSet = new Set();
          source.frames.forEach(bmp => {
            if (bmp && !closedSet.has(bmp) && typeof bmp.close === 'function') {
              closedSet.add(bmp);
              try { bmp.close(); } catch (_) {}
            }
          });
          source.frames.clear();
        }
      });
      this.sources.clear();
      const db = await this._getDB();
      if (db) {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).clear();
        } catch (_) {}
      }
    }

    clearSourceCache(target) {
      return this.clearSource(target);
    }
  }

  window.VideoFrameExtractor = new VideoFrameExtractor();
})(typeof window !== 'undefined' ? window : globalThis);
