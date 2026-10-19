/**
 * Studio/js/media/videocomp-enggine.js
 * OpenFishTools Studio - Video & Composition Engine
 * 
 * Centralized video hardware acceleration, single-slot coalesced seeking,
 * playback rate & pitch management, idle-cache protection, and adaptive draft scaling.
 */
(function(window) {
  'use strict';

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
        // 5-argument signature: computeLayerClipTime(layer, currentSec, rootStartSec, speed, sourceOffsetSec)
        rootStartSec = ppsOrOptions;
      } else if (typeof ppsOrOptions === 'number') {
        // 3-argument signature: computeLayerClipTime(layer, currentSec, pixelsPerSecond)
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
          : ((currentSec - start) * (layer.speed || 1.0)));
      } else if (typeof window !== 'undefined' && typeof window.getLayerIntegratedSpeedTime === 'function') {
        timeInClip = window.getLayerIntegratedSpeedTime(layer, currentSec);
      } else {
        timeInClip = Math.max(0, effOffset + (currentSec - start) * effSpeed);
      }

      return isFinite(timeInClip) ? Math.max(0, timeInClip) : 0;
    }

    /**
     * Single-slot coalesced seeking during scrubbing and parking.
     * Ensures preview never twitches or moves on its own after scrubbing stops.
     * @param {HTMLVideoElement|HTMLMediaElement} videoEl
     * @param {number} targetTime
     * @param {boolean} [isPlaying=false]
     * @param {boolean} [isPausedStepping=false]
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
        // During fast/stepped playback (>2.0x, time_remap, or reverse/freeze), step videoEl without overlapping seeks
        if (!videoEl.seeking && Math.abs((videoEl.currentTime || 0) - targetSeek) > 0.025) {
          try { videoEl.currentTime = targetSeek; } catch (_) {}
        }
      }
    }

    /**
     * Handle video seek completion event (video.onseeked).
     * @param {HTMLVideoElement} videoEl
     * @param {Object} [entry]
     */
    handleVideoSeeked(videoEl, entry) {
      if (!videoEl) return;
      if (entry) entry.isReady = true;

      // Skip heavy freeze frame & UI preview redraws during active export
      if (typeof window !== 'undefined' && window.isExporting) return;

      const isTimelinePlaying = typeof window !== 'undefined' && !!window.isTimelinePlaying;

      // Process any queued scrub seek smoothly
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
     * Resolve hardware <video> element and current frame for rendering.
     * Enforces idle-cache guard so background idle caching never seeks active <video> elements.
     * @param {Object} layer
     * @param {Object} media
     * @param {Object} [options={}]
     * @returns {{ el: HTMLElement|HTMLCanvasElement|null, timeInClip: number, hasUnreadyMedia: boolean }}
     */
    resolveLayerVideoElement(layer, media, options = {}) {
      if (!layer || !media) {
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

      // Background idle-cache guard: never seek shared <video> elements from background idle-cache worker
      if (isIdleCache) {
        return { el: null, timeInClip: 0, hasUnreadyMedia: true };
      }

      const timeInClip = this.computeLayerClipTime(layer, currentSec, pixelsPerSecond);
      const isHtmlEl = (typeof HTMLElement !== 'undefined' && media instanceof HTMLElement) || !!(media && media.tagName);
      const videoEl = (media && media.el)
        ? media.el
        : (isHtmlEl ? media : null);

      const isExporting = isExport || (typeof window !== 'undefined' && !!window.isExporting);
      const isTimelinePlaying = typeof window !== 'undefined' && !!window.isTimelinePlaying;

      if (videoEl && !isExporting && isFinite(timeInClip) && videoEl.readyState >= 1) {
        this.seekVideoElementCoalesced(videoEl, timeInClip, isTimelinePlaying, videoEl.paused);
      }

      let el = null;
      if (videoEl && videoEl.videoWidth > 0 && videoEl.readyState >= 2) {
        el = videoEl;
        layer._renderedExactVideoFrame = true;
        layer._lastRenderedFrame = videoEl;
      } else if (media && media.freezeCanvas && media.hasFreezeFrame) {
        el = media.freezeCanvas;
      } else if (layer._lastRenderedFrame && layer._lastRenderedFrame !== (media && media.poster)) {
        el = layer._lastRenderedFrame;
      } else if (media && media.poster && media.poster.naturalWidth > 0) {
        el = media.poster;
      } else {
        const placeholderW = layer.mediaWidth || (videoEl && videoEl.videoWidth > 0 ? videoEl.videoWidth : 1920);
        const placeholderH = layer.mediaHeight || (videoEl && videoEl.videoHeight > 0 ? videoEl.videoHeight : 1080);
        const placeholderFn = (typeof window !== 'undefined' && typeof window.getMediaNotReadyPlaceholder === 'function')
          ? window.getMediaNotReadyPlaceholder
          : null;
        if (placeholderFn) {
          el = placeholderFn(placeholderW, placeholderH, 0);
        }
      }

      return {
        el,
        timeInClip,
        hasUnreadyMedia: (layer.type === 'video' && (!videoEl || videoEl.readyState < 2))
      };
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
