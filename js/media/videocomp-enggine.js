/**
 * Studio/js/media/videocomp-enggine.js
 * OpenFishTools Studio - Video & Composition Engine
 * 
 * Centralized video hardware acceleration, single-slot coalesced seeking,
 * playback rate & pitch management, idle-cache protection, and adaptive draft scaling.
 */
(function(window) {
  'use strict';

  if (typeof window !== 'undefined' && !window.VideoFrameExtractor && typeof require === 'function') {
    try { require('./frame-extractor.js'); } catch (_) {}
  }

  class VideoCompEngine {
    constructor() {
      this.name = 'VideoCompEngine';
    }

    /**
     * Calculate playback or scrub time within a layer's media clip.
     * @param {Object} layer
     * @param {number} currentSec
     * @param {number} [pps=80]
     * @returns {number}
     */
    computeLayerClipTime(layer, currentSec, ppsOrOptions = 80, speed = null, sourceOffsetSec = null) {
      if (!layer) return 0;
      let effectivePps = 80;
      let rootStartSec = null;
      let overrideSpeed = speed;
      let overrideOffset = sourceOffsetSec;

      if (typeof ppsOrOptions === 'object' && ppsOrOptions !== null) {
        effectivePps = ppsOrOptions.pps || ((typeof window !== 'undefined' && window.currentPixelsPerSecond) ? window.currentPixelsPerSecond : 80);
        if (ppsOrOptions.rootStartSec !== undefined) rootStartSec = ppsOrOptions.rootStartSec;
        if (ppsOrOptions.speed !== undefined) overrideSpeed = ppsOrOptions.speed;
        if (ppsOrOptions.sourceOffsetSec !== undefined) overrideOffset = ppsOrOptions.sourceOffsetSec;
      } else if ((overrideSpeed !== null && overrideSpeed !== undefined) || (overrideOffset !== null && overrideOffset !== undefined)) {
        rootStartSec = ppsOrOptions;
      } else if (typeof ppsOrOptions === 'number') {
        effectivePps = ppsOrOptions;
      } else {
        effectivePps = (typeof window !== 'undefined' && window.currentPixelsPerSecond) ? window.currentPixelsPerSecond : 80;
      }

      const start = rootStartSec !== null
        ? Number(rootStartSec) || 0
        : (layer.startSec !== undefined
          ? Number(layer.startSec) || 0
          : (parseFloat(layer.startPx ?? layer.left) || 0) / effectivePps);

      const effProps = (typeof window !== 'undefined' && typeof window.getLayerEffectivePropsAtTime === 'function')
        ? window.getLayerEffectivePropsAtTime(layer, currentSec)
        : layer;

      const effSpeed = overrideSpeed !== null
        ? Math.max(0.01, Number(overrideSpeed) || 1.0)
        : Math.max(0.01, (effProps && effProps.speed !== undefined)
          ? effProps.speed
          : (layer.speed !== undefined && layer.speed > 0 ? layer.speed : 1.0));

      const effOffset = overrideOffset !== null
        ? (Number(overrideOffset) || 0)
        : (Number(layer.sourceOffsetSec) || 0);

      let timeInClip = 0;
      if (layer.speedMode === 'time_remap') {
        timeInClip = Math.max(0, (effProps && effProps.timeRemap !== undefined)
          ? effProps.timeRemap
          : (effOffset + (currentSec - start) * (layer.speed || 1.0)));
      } else if (typeof window !== 'undefined' && typeof window.getLayerIntegratedSpeedTime === 'function') {
        timeInClip = window.getLayerIntegratedSpeedTime(layer, currentSec);
      } else {
        timeInClip = Math.max(0, effOffset + (currentSec - start) * effSpeed);
      }

      return isFinite(timeInClip) ? Math.max(0, timeInClip) : 0;
    }

    /**
     * Legacy helper retained for backward-compatible unit tests only.
     * Active editor playback & scrubbing exclusively use VideoFrameExtractor ImageBitmap sequences.
     */
    seekVideoElementCoalesced(videoEl, targetTime, isPlaying = false, isPausedStepping = false) {
      if (!videoEl || !isFinite(targetTime) || videoEl.readyState < 1) return;
      const playing = typeof isPlaying === 'boolean' ? isPlaying : false;
      const pausedStepping = typeof isPausedStepping === 'boolean' ? isPausedStepping : false;

      const maxSeek = (videoEl.duration && !isNaN(videoEl.duration) && videoEl.duration > 0)
        ? Math.max(0, videoEl.duration - 0.01)
        : Infinity;
      const targetSeek = Math.min(Math.max(0, targetTime), maxSeek);

      if (!playing) {
        if (Math.abs((videoEl.currentTime || 0) - targetSeek) > 0.012) {
          if (videoEl.seeking) {
            videoEl._pendingScrubTime = targetSeek;
          } else {
            videoEl._pendingScrubTime = null;
            try { videoEl.currentTime = targetSeek; } catch (_) {}
          }
        } else {
          videoEl._pendingScrubTime = null;
        }
      } else if (pausedStepping || videoEl.paused) {
        if (!videoEl.seeking && Math.abs((videoEl.currentTime || 0) - targetSeek) > 0.025) {
          try { videoEl.currentTime = targetSeek; } catch (_) {}
        }
      }
    }

    /**
     * Legacy helper retained for backward-compatible unit tests only.
     */
    handleVideoSeeked(videoEl, entry) {
      if (!videoEl) return;
      if (entry) entry.isReady = true;
      if (typeof window !== 'undefined' && window.isExporting) return;

      const isTimelinePlaying = typeof window !== 'undefined' && !!window.isTimelinePlaying;
      if (!isTimelinePlaying && videoEl._pendingScrubTime !== null && videoEl._pendingScrubTime !== undefined) {
        const nextTime = videoEl._pendingScrubTime;
        videoEl._pendingScrubTime = null;
        const maxSeek = (videoEl.duration && !isNaN(videoEl.duration) && videoEl.duration > 0)
          ? Math.max(0, videoEl.duration - 0.01)
          : Infinity;
        const targetSeek = Math.min(Math.max(0, nextTime), maxSeek);
        if (Math.abs((videoEl.currentTime || 0) - targetSeek) > 0.012) {
          try {
            videoEl.currentTime = targetSeek;
            return;
          } catch (_) {}
        }
      }

      if (entry && !entry.hasFreezeFrame && typeof entry.snapshotFreezeCanvas === 'function' && videoEl.readyState >= 2) {
        entry.snapshotFreezeCanvas();
      }

      if (!isTimelinePlaying && typeof window !== 'undefined' && typeof window.redrawComposition === 'function') {
        window.redrawComposition('video:onseeked');
      }
    }

    /**
     * Resolve video frame for rendering exclusively from VideoFrameExtractor ImageBitmap sequences.
     * Never creates or seeks live DOM <video> elements during timeline playback or scrubbing.
     * @param {Object} layer
     * @param {Object} media
     * @param {Object} [options={}]
     * @returns {{ el: ImageBitmap|HTMLCanvasElement|HTMLElement|null, timeInClip: number, hasUnreadyMedia: boolean }}
     */
    resolveLayerVideoElement(layer, media, options = {}) {
      if (!layer) {
        return { el: null, timeInClip: 0, hasUnreadyMedia: false };
      }

      const opts = (typeof options === 'number') ? { currentSec: options } : (options || {});
      const {
        isExport = false,
        isIdleCache = false,
        currentSec = 0,
        pixelsPerSecond = 80
      } = opts;

      layer._renderedExactVideoFrame = false;
      if (layer._lastDataUrl && layer._lastDataUrl !== layer.dataUrl) {
        layer._lastRenderedFrame = null;
      }
      layer._lastDataUrl = layer.dataUrl || null;

      const timeInClip = this.computeLayerClipTime(layer, currentSec, pixelsPerSecond);
      const isExporting = isExport || (typeof window !== 'undefined' && !!window.isExporting);
      const extractor = (typeof window !== 'undefined') ? window.VideoFrameExtractor : null;

      let el = null;
      let hasUnreadyMedia = true;

      if (extractor) {
        const sourceKey = extractor._getSourceKey(layer);
        const source = extractor.getSourceCache(sourceKey);

        if (source && source.frames && source.frames.size > 0) {
          const fIdx = Math.round(timeInClip * (source.fps || 60));
          const interpMode = layer.speedInterpolation || 'none';
          const extractedFrame = extractor.getInterpolatedFrame(
            source,
            timeInClip,
            interpMode,
            layer.mediaWidth || 960,
            layer.mediaHeight || 540
          );

          if (extractedFrame) {
            el = extractedFrame;
            layer._lastRenderedFrame = extractedFrame;
            layer._renderedExactVideoFrame = true;
            hasUnreadyMedia = false;
          } else {
            if (source.cachedFrameIndices && source.cachedFrameIndices.has(fIdx)) {
              extractor.fetchFrameFromDB(source, fIdx);
            }
            if (!isExporting && !isIdleCache && !source.isExtracting) {
              extractor.extractLayerRange(layer);
            }

            if (!isExporting && !isIdleCache) {
              let bestNearest = null;
              let minDist = Infinity;
              const maxHoldDist = Math.round((source.fps || 60) * 1.5);
              for (const [kIdx, bmp] of source.frames.entries()) {
                const dist = Math.abs(kIdx - fIdx);
                if (dist < minDist) {
                  minDist = dist;
                  bestNearest = bmp;
                  if (dist <= 1) break;
                }
              }
              if (bestNearest && minDist <= maxHoldDist) {
                el = bestNearest;
              } else if (layer._lastRenderedFrame && layer._lastRenderedFrame !== (media && media.poster)) {
                el = layer._lastRenderedFrame;
              }
            }
          }
        } else if (!isExporting && !isIdleCache && (layer.dataUrl || layer.mediaId)) {
          extractor.extractLayerRange(layer);
        }
      }

      if (isIdleCache && !layer._renderedExactVideoFrame) {
        return { el: null, timeInClip, hasUnreadyMedia: true };
      }

      // Fallback only for unit tests passing a mock HTMLVideoElement without dataUrl/mediaId
      if (!el && !layer.dataUrl && !layer.mediaId && media) {
        const isHtmlEl = (typeof HTMLElement !== 'undefined' && media instanceof HTMLElement) || !!(media && media.tagName);
        const mockEl = (media && media.el) ? media.el : (isHtmlEl ? media : null);
        if (mockEl && mockEl.videoWidth > 0 && mockEl.readyState >= 2) {
          el = mockEl;
          layer._renderedExactVideoFrame = true;
          layer._lastRenderedFrame = mockEl;
          hasUnreadyMedia = false;
        }
      }

      if (!el && !isExporting && !isIdleCache) {
        if (layer._lastRenderedFrame && layer._lastRenderedFrame !== (media && media.poster)) {
          el = layer._lastRenderedFrame;
        } else {
          const placeholderW = layer.mediaWidth || 1920;
          const placeholderH = layer.mediaHeight || 1080;
          const placeholderFn = (typeof window !== 'undefined' && typeof window.getMediaNotReadyPlaceholder === 'function')
            ? window.getMediaNotReadyPlaceholder
            : null;
          if (placeholderFn) {
            el = placeholderFn(placeholderW, placeholderH, layer._extractProgress || 0);
            if (el) el._isPlaceholder = true;
          }
        }
      }

      return {
        el,
        timeInClip,
        hasUnreadyMedia
      };
    }

    /**
     * Resolve pre-extracted ImageBitmap frame for a Precomp layer from VideoFrameExtractor.
     * Falls back to live renderPrecompToCanvas when dirty, during export, or while frames are still extracting.
     */
    resolvePrecompElement(precompLayer, options = {}) {
      if (!precompLayer || precompLayer.type !== 'precomp') {
        return { el: null, innerSec: 0, fromSequence: false, hasUnreadyMedia: false };
      }
      const {
        isExport = false,
        isIdleCache = false,
        currentSec = 0,
        pixelsPerSecond = 80,
        targetW = 960,
        targetH = 540
      } = options;

      const innerSec = this.computeLayerClipTime(precompLayer, currentSec, pixelsPerSecond);
      const isExporting = isExport || (typeof window !== 'undefined' && !!window.isExporting);
      const extractor = (typeof window !== 'undefined') ? window.VideoFrameExtractor : null;

      if (!isExporting && !precompLayer._dirty && extractor) {
        const sourceKey = extractor._getSourceKey(precompLayer);
        const source = extractor.getSourceCache(sourceKey);
        if (source && source.frames && source.frames.size > 0) {
          const interpMode = precompLayer.speedInterpolation || 'none';
          const bmp = extractor.getInterpolatedFrame(source, innerSec, interpMode, targetW, targetH);
          if (bmp) {
            precompLayer._lastRenderedFrame = bmp;
            precompLayer._renderedExactVideoFrame = true;
            return { el: bmp, innerSec, fromSequence: true, hasUnreadyMedia: false };
          }
        }
        if (!isIdleCache && !source?.isExtracting) {
          extractor.extractLayerRange(precompLayer);
        }
      }

      return { el: null, innerSec, fromSequence: false, hasUnreadyMedia: true };
    }

    /**
     * Fast-playback rate and pitch stretching calculations.
     * Disables pitch time-stretching above 1.35x.
     * Pauses and steps <video> elements above 2.0x to avoid hardware decoder choke.
     * @param {HTMLMediaElement} el
     * @param {number} currentSpeed
     * @param {number} timelineSpeedMult
     * @param {Object} layer
     * @param {boolean} [isFreezeOrReverse=false]
     * @returns {{ rawRate: number, tooFastForVideoEl: boolean, finalPlaybackRate: number, wantPreservePitch: boolean }}
     */
    computePlaybackRates(el, currentSpeed, timelineSpeedMult, layer, isFreezeOrReverse = false) {
      const speedMult = (typeof timelineSpeedMult === 'number' && timelineSpeedMult > 0) ? timelineSpeedMult : 1.0;
      const rawRate = (currentSpeed || 1.0) * speedMult;
      const isVideoEl = el && el.tagName === 'VIDEO';

      // HTML5 <video> elements running above 2.0x on 60fps 1080p H.264 choke hardware decoders (>120fps continuous decode).
      // Above 2.0x, pause the <video> and step frames cleanly via non-blocking seeks.
      const tooFastForVideoEl = isVideoEl && rawRate > 2.0;
      const finalPlaybackRate = (isFreezeOrReverse || tooFastForVideoEl)
        ? 1.0
        : Math.max(0.0625, Math.min(isVideoEl ? 2.0 : 8.0, rawRate));

      // Disable pitch time-stretching on <video> when fast-playing (>1.35x) to avoid WSOLA audio/video lock contention
      const wantPreservePitch = (isVideoEl && rawRate > 1.35)
        ? false
        : (layer && layer.preservePitch !== false);

      return {
        rawRate,
        tooFastForVideoEl,
        finalPlaybackRate,
        wantPreservePitch
      };
    }

    /**
     * Enforce pitch preservation attribute on media elements.
     * @param {HTMLMediaElement} el
     * @param {boolean} preservePitch
     */
    applyPitchPreserve(el, preservePitch) {
      if (!el) return;
      try {
        if (el.preservesPitch !== preservePitch) {
          el.preservesPitch = preservePitch;
          if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = preservePitch;
          if ('mozPreservesPitch' in el) el.mozPreservesPitch = preservePitch;
        }
      } catch (_) {}
    }

    /**
     * Step or pause video element during fast or reversed playback.
     * @param {HTMLMediaElement} el
     * @param {number} targetTime
     */
    stepOrPauseVideoElement(el, targetTime) {
      if (!el) return;
      if (!el.paused) {
        try { el.pause(); } catch (_) {}
      }
      if (el.tagName === 'VIDEO' && !el.seeking && isFinite(targetTime) && el.readyState >= 1) {
        const maxSeek = (el.duration && !isNaN(el.duration) && el.duration > 0)
          ? Math.max(0, el.duration - 0.01)
          : Infinity;
        const clampedTarget = Math.min(Math.max(0, targetTime), maxSeek);
        if (Math.abs((el.currentTime || 0) - clampedTarget) > 0.025) {
          try { el.currentTime = clampedTarget; } catch (_) {}
        }
      }
    }

    /**
     * Enforce playback drift correction.
     * @param {HTMLMediaElement} el
     * @param {number} targetTime
     * @param {number} currentSpeed
     * @param {number} nowMs
     * @param {Function} [onHardSeekAudioCallback]
     * @returns {boolean} Whether a hard seek was initiated
     */
    correctPlaybackDrift(el, targetTime, currentSpeed, nowMs, onHardSeekAudioCallback = null) {
      if (!el || el.seeking || !isFinite(targetTime)) return false;
      const isVid = el.tagName === 'VIDEO';
      const drift = (el.currentTime || 0) - targetTime;
      const absDrift = Math.abs(drift);
      const driftThreshold = isVid ? Math.max(0.22, 0.14 * currentSpeed) : 2.5;
      const seekCooldownMs = isVid ? 250 : 1000;

      if (absDrift > driftThreshold && (!el._lastHardSeekTime || (nowMs - el._lastHardSeekTime > seekCooldownMs))) {
        try {
          el._lastHardSeekTime = nowMs;
          if (!isVid && typeof onHardSeekAudioCallback === 'function') {
            onHardSeekAudioCallback(el);
          }
          const maxSeek = (el.duration && !isNaN(el.duration) && el.duration > 0)
            ? Math.max(0, el.duration - 0.01)
            : Infinity;
          el.currentTime = Math.min(Math.max(0, targetTime), maxSeek);
          el.playbackRate = Math.max(0.0625, Math.min(8.0, currentSpeed));
          return true;
        } catch (_) {}
      }
      return false;
    }

    /**
     * Dynamically adjust adaptive draft resolution budget based on frame render time.
     * @param {number} currentRenderElapsed
     * @param {number} fps
     * @param {Object} adState
     */
    adjustAdaptiveDraftBudget(currentRenderElapsed, fps, adState) {
      if (!adState) return;
      const targetBudgetMs = Math.max(10, Math.min(20, (1000 / Math.max(24, Math.min(60, fps || 60))) * 0.85));
      adState.emaMs = (adState.emaMs || currentRenderElapsed) * 0.6 + currentRenderElapsed * 0.4;
      if (currentRenderElapsed > targetBudgetMs * 2.2) {
        adState.scale = Math.max(0.25, adState.scale * 0.65);
        adState.fastStreak = 0;
      } else if (currentRenderElapsed > targetBudgetMs * 1.4) {
        adState.scale = Math.max(0.28, adState.scale * 0.78);
        adState.fastStreak = 0;
      } else if (currentRenderElapsed > targetBudgetMs) {
        adState.scale = Math.max(0.32, adState.scale * 0.88);
        adState.fastStreak = 0;
      } else if (currentRenderElapsed < targetBudgetMs * 0.42 && adState.emaMs < targetBudgetMs * 0.50) {
        adState.fastStreak = (adState.fastStreak || 0) + 1;
        if (adState.fastStreak >= 8) {
          adState.scale = Math.min(0.50, adState.scale + 0.08);
          adState.fastStreak = 4;
        }
      }
    }

    /**
     * Composition Speed Draft resolution scaling.
     * Computes adaptive scale (0.5x base, 0.38x under heavy effects).
     * @param {Array|number} activeLayersOrElapsed
     * @param {Object|number} [optionsOrFps={}]
     * @param {Object} [adState=null]
     * @returns {number}
     */
    computeAdaptiveDraftScale(activeLayersOrElapsed, optionsOrFps = {}, adState = null) {
      if (typeof activeLayersOrElapsed === 'number') {
        const state = adState || (typeof optionsOrFps === 'object' && optionsOrFps !== null && optionsOrFps.scale !== undefined ? optionsOrFps : null);
        if (state) {
          const fps = typeof optionsOrFps === 'number' ? optionsOrFps : ((optionsOrFps && optionsOrFps.fps) || 60);
          this.adjustAdaptiveDraftBudget(activeLayersOrElapsed, fps, state);
          return state.scale;
        }
        return 1.0;
      }

      const activeLayers = activeLayersOrElapsed;
      const options = optionsOrFps || {};
      const {
        canUseAdaptiveDraft = false,
        isInteractiveMotion = false,
        currentScale = 1.0
      } = options;

      if (!canUseAdaptiveDraft) {
        return 1.0;
      }

      let heavyPassCount = 0;
      const layers = Array.isArray(activeLayers) ? activeLayers : [];
      for (let li = 0; li < layers.length; li++) {
        const al = layers[li];
        if (!al || al.hidden) continue;
        if (al.type === 'adjustment' && Array.isArray(al.effects) && al.effects.some(f => f && !f.disabled)) {
          heavyPassCount += 1.5;
        } else if (Array.isArray(al.effects) && al.effects.length > 0) {
          for (let fi = 0; fi < al.effects.length; fi++) {
            const fx = al.effects[fi];
            if (fx && !fx.disabled) {
              heavyPassCount += (
                fx.type === 'deep-glow' ||
                fx.type === 'shatter' ||
                fx.type === 'particle-engine' ||
                fx.type === 'fluid-fish' ||
                fx.type === 'gaussian-blur'
              ) ? 1.5 : 0.5;
            }
          }
        }
      }

      // Speed Draft enforces 0.5x base resolution immediately (and 0.38x under heavy effects)
      const draftCap = (heavyPassCount >= 2.0 || (isInteractiveMotion && heavyPassCount >= 1.5)) ? 0.38 : 0.50;
      return Math.max(0.25, Math.min(draftCap, currentScale !== undefined ? currentScale : draftCap));
    }
  }

  const engine = new VideoCompEngine();
  window.VideoCompEngine = engine;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = engine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
