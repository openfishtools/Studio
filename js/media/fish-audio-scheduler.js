/**
 * js/media/fish-audio-scheduler.js
 * Web Audio clip scheduler + sample-accurate timeline clock.
 *
 * Instead of chasing one <audio>/<video> element per layer every playback tick (seek / drift steering),
 * each playable clip (root or inside nested precompositions, forward or reverse, constant speed,
 * speed-keyframed, time-remapped, with or without audio effects) is decoded once into an AudioBuffer
 * and played with an AudioBufferSourceNode scheduled on the AudioContext clock.
 * The same clock drives the timeline playhead, so picture (VideoFrameExtractor frames rendered at
 * timeline time) and sound can never drift apart.
 *
 * Enabled by default.
 * Legacy fallback opt-in: localStorage.setItem('oft_audio_engine', 'legacy')
 */
(function (window) {
  'use strict';

  const LOOKAHEAD_SEC = 2.0;   // timeline seconds scheduled ahead of the playhead
  const TICK_MS = 250;         // scheduler tick
  const VOL_STEP_SEC = 0.05;   // volume & variable-speed keyframe automation resolution
  const START_LEAD_SEC = 0.02; // tiny lead so the first source starts in the future

  function perfNow() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function clampRate(r) {
    const v = Number(r);
    if (!isFinite(v) || v <= 0) return 1;
    return Math.max(0.0625, Math.min(8, v));
  }

  function decodeWithCtx(ctx, arrayBuffer) {
    return new Promise((resolve, reject) => {
      try {
        const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  class FishAudioScheduler {
    constructor() {
      this.buffers = new Map();   // mediaKey -> { buffer, reversedBuffer, bytes, lastUsed }
      this.pending = new Map();   // mediaKey -> Promise
      this.failed = new Map();    // mediaKey -> failure timestamp (ms)
      this.voices = new Map();    // voiceKey -> voice
      this.finished = new Set();  // voiceKeys that already played to their end in this run
      this.playing = false;
      this.rate = 1;
      this.anchorCtx = 0;
      this.anchorSec = 0;
      this.playStartSec = 0;
      this.pps = 80;
      this._timer = null;
      this._decodeQueue = [];
      this._decoding = false;
      const isMobile = (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''));
      this.budgetBytes = isMobile ? 192 * 1024 * 1024 : 640 * 1024 * 1024;
      this.maxFileBytes = isMobile ? 120 * 1024 * 1024 : 600 * 1024 * 1024;
    }

    isEnabled() {
      try {
        if (typeof localStorage !== 'undefined') {
          const mode = localStorage.getItem('oft_audio_engine');
          if (mode === 'legacy' || mode === 'off' || mode === 'false') return false;
        }
        return true;
      } catch (_) {
        return true;
      }
    }

    // ── AudioContext (shared with FishAudioEngine so unlock / scrub mute / master gain apply) ──
    _ctx() {
      const eng = window.FishAudioEngine;
      if (eng && typeof eng._ensureContext === 'function' && eng._ensureContext()) return eng.ctx;
      return null;
    }

    _out() {
      const eng = window.FishAudioEngine;
      if (eng && eng.masterGain) return eng.masterGain;
      const ctx = this._ctx();
      return ctx ? ctx.destination : null;
    }

    mediaKey(layer) {
      if (!layer) return '';
      return String(layer.mediaId || layer.dataUrl || layer.id || '');
    }

    _flatten(layers) {
      const eng = window.FishAudioEngine;
      if (!eng || typeof eng._flattenPlayableLayers !== 'function') return [];
      return eng._flattenPlayableLayers(layers || [], 0, 1.0, false, 1.0, this.pps) || [];
    }

    _isLayerExplicitlyMuted(layer, parentLayer = null) {
      if (!layer) return true;
      if (layer.hidden || layer.isMuted || layer.muted) return true;
      if (layer.speed === 0) return true;
      if (parentLayer) {
        if (parentLayer.hidden || parentLayer.isMuted || parentLayer.muted) return true;
        if (parentLayer.speed === 0) return true;
      }
      return false;
    }

    _isSupportedLayer(layer, parentLayer = null, item = null) {
      if (!layer) return false;
      if (layer.type !== 'audio' && layer.type !== 'video') return false;
      if (item && item.isExplicitlyMuted !== undefined) {
        if (item.isExplicitlyMuted) return false;
      } else if (this._isLayerExplicitlyMuted(layer, parentLayer)) {
        return false;
      }
      return true;
    }

    /**
     * True when this clip is played by the scheduler (legacy element path must skip it).
     */
    handles(layer, parentLayer = null) {
      if (!this.isEnabled()) return false;
      if (!this._isSupportedLayer(layer, parentLayer)) return false;
      return this.buffers.has(this.mediaKey(layer));
    }

    isClockRunning() {
      const ctx = this._ctx();
      return !!(this.playing && ctx && ctx.state === 'running');
    }

    // ── Clock ─────────────────────────────────────────────────────────────────
    timelineAtCtx(t) {
      return this.anchorSec + (t - this.anchorCtx) * this.rate;
    }

    ctxAtTimeline(sec) {
      return this.anchorCtx + (sec - this.anchorSec) / this.rate;
    }

    _latency(ctx) {
      const l = (Number(ctx.outputLatency) || 0) + (Number(ctx.baseLatency) || 0);
      return Math.max(0, Math.min(0.3, l));
    }

    /**
     * Timeline position of the sound that is audible right now (output latency compensated).
     */
    getTimelineSec() {
      if (!this.playing) return null;
      const ctx = this._ctx();
      if (!ctx) return null;
      const audibleCtx = ctx.currentTime - this._latency(ctx);
      return Math.max(this.playStartSec, this.timelineAtCtx(audibleCtx));
    }

    // ── Decoding / buffer cache / reverse buffer ──────────────────────────────
    async _getBlob(layer) {
      const exp = window.FishExportEngine;
      if (exp && typeof exp.getLayerBlob === 'function') {
        try {
          const b = await exp.getLayerBlob(layer);
          if (b) return b;
        } catch (_) {}
      }
      if (layer.dataUrl && typeof layer.dataUrl === 'string' && !layer.dataUrl.startsWith('data:image')) {
        try {
          const r = await fetch(layer.dataUrl);
          if (r.ok) return await r.blob();
        } catch (_) {}
      }
      const map = window._activeMediaMap;
      const item = (map && layer.mediaId) ? map.get(layer.mediaId) : null;
      if (item) {
        if (item.blob) return item.blob;
        if (item.buffer) return new Blob([item.buffer], { type: item.mimeType || '' });
      }
      return null;
    }

    async _decode(layer, key) {
      // Use a detached copy so the decoded buffer is never pinned on the project layer object
      const tmp = { id: layer.id, mediaId: layer.mediaId, name: layer.name, type: layer.type, dataUrl: layer.dataUrl };
      const blob = await this._getBlob(tmp);
      if (!blob) throw new Error('blob unavailable');
      if (blob.size > this.maxFileBytes) throw new Error('file too large for in-memory decode');

      let buf = null;
      if (typeof window.decodeAudioFromBlob === 'function') {
        try { buf = await window.decodeAudioFromBlob(blob); } catch (_) { buf = null; }
      }
      if (!buf || !buf.numberOfChannels) {
        const ctx = this._ctx();
        if (!ctx) throw new Error('no AudioContext');
        try {
          buf = await decodeWithCtx(ctx, await blob.arrayBuffer());
        } catch (_) {
          // Safari: recast container as audio/mp4
          const recast = new Blob([await blob.arrayBuffer()], { type: 'audio/mp4' });
          buf = await decodeWithCtx(ctx, await recast.arrayBuffer());
        }
      }
      if (!buf || !buf.numberOfChannels) throw new Error('decode failed');
      const bytes = buf.length * buf.numberOfChannels * 4;
      this.buffers.set(key, { buffer: buf, reversedBuffer: null, bytes, lastUsed: perfNow() });
      this._evict();
    }

    _getReversedBuffer(rec, ctx) {
      if (!rec || !rec.buffer) return null;
      if (rec.reversedBuffer) return rec.reversedBuffer;
      const buf = rec.buffer;
      const chCount = buf.numberOfChannels || 1;
      const len = buf.length || 0;
      const sr = buf.sampleRate || 48000;
      let rev = null;
      if (ctx && typeof ctx.createBuffer === 'function' && typeof buf.getChannelData === 'function') {
        try {
          rev = ctx.createBuffer(chCount, len, sr);
          for (let ch = 0; ch < chCount; ch++) {
            const src = buf.getChannelData(ch);
            const dst = rev.getChannelData(ch);
            for (let i = 0, j = len - 1; i < len; i++, j--) {
              dst[i] = src[j];
            }
          }
          try { rev._isReversed = true; } catch (_) {}
          rec.bytes += len * chCount * 4;
        } catch (_) {
          rev = null;
        }
      }
      if (!rev) {
        rev = Object.assign({}, buf, { _isReversed: true });
      }
      rec.reversedBuffer = rev;
      return rev;
    }

    _evict() {
      let total = 0;
      for (const rec of this.buffers.values()) total += rec.bytes;
      if (total <= this.budgetBytes) return;
      const inUse = new Set();
      for (const v of this.voices.values()) inUse.add(v.mediaKey);
      const ordered = Array.from(this.buffers.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (let i = 0; i < ordered.length && total > this.budgetBytes; i++) {
        const [k, rec] = ordered[i];
        if (inUse.has(k)) continue;
        this.buffers.delete(k);
        total -= rec.bytes;
      }
    }

    prefetch(layers) {
      if (!this.isEnabled()) return;
      const items = this._flatten(layers);
      const nowMs = Date.now();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const layer = item.layer;
        if (!this._isSupportedLayer(layer, item.parentLayer, item)) continue;
        const key = this.mediaKey(layer);
        if (!key || this.buffers.has(key) || this.pending.has(key)) continue;
        const failedAt = this.failed.get(key);
        if (failedAt && (nowMs - failedAt) < 60000) continue;
        if (this._decodeQueue.some(q => q.key === key)) continue;
        this._decodeQueue.push({ key, layer });
      }
      this._pumpDecodeQueue();
    }

    _pumpDecodeQueue() {
      // Sequential decode keeps peak memory (compressed + PCM) bounded
      if (this._decoding || this._decodeQueue.length === 0) return;
      const job = this._decodeQueue.shift();
      this._decoding = true;
      const p = this._decode(job.layer, job.key);
      this.pending.set(job.key, p);
      p.catch(() => { this.failed.set(job.key, Date.now()); })
        .then(() => {
          this.pending.delete(job.key);
          this._decoding = false;
          if (this.playing && this.buffers.has(job.key)) {
            this._tick();
          }
          this._pumpDecodeQueue();
        });
    }

    // ── Kinematics: Precomp + Time Remap + Speed Keyframes + Reverse ──────────
    _hasSpeedAutomation(item) {
      const layer = item && item.layer;
      const parent = item && item.parentLayer;
      if (!layer) return false;
      if (layer.speedMode === 'time_remap') return true;
      if (parent && parent.speedMode === 'time_remap') return true;
      if (layer.keyframes && Array.isArray(layer.keyframes.speed) && layer.keyframes.speed.length > 0) return true;
      if (parent && parent.keyframes && Array.isArray(parent.keyframes.speed) && parent.keyframes.speed.length > 0) return true;
      if (layer.expressions && (layer.expressions.speed || layer.expressions.timeRemap)) return true;
      return false;
    }

    _evalTimeRemapAt(layer, evalSec) {
      const eff = (typeof window.getLayerEffectivePropsAtTime === 'function')
        ? window.getLayerEffectivePropsAtTime(layer, evalSec)
        : null;
      const r0 = (eff && eff.timeRemap !== undefined)
        ? Number(eff.timeRemap)
        : (layer.timeRemap !== undefined ? Number(layer.timeRemap) : 0);
      const dt = 0.02;
      const t0 = Math.max(0, evalSec - dt);
      const t1 = evalSec + dt;
      const p0 = (typeof window.getLayerEffectivePropsAtTime === 'function')
        ? window.getLayerEffectivePropsAtTime(layer, t0)
        : null;
      const p1 = (typeof window.getLayerEffectivePropsAtTime === 'function')
        ? window.getLayerEffectivePropsAtTime(layer, t1)
        : null;
      const rPrev = (p0 && p0.timeRemap !== undefined) ? Number(p0.timeRemap) : r0;
      const rNext = (p1 && p1.timeRemap !== undefined) ? Number(p1.timeRemap) : r0;
      const hasRemapKfs = !!(layer.keyframes && Array.isArray(layer.keyframes.timeRemap) && layer.keyframes.timeRemap.length >= 2);
      const rawSlope = (t1 > t0) ? ((rNext - rPrev) / (t1 - t0)) : 1.0;
      const slope = (hasRemapKfs || Math.abs(rNext - rPrev) > 1e-7 || layer.freezeFrame)
        ? rawSlope
        : ((layer.speed !== undefined && layer.speed !== 0) ? Number(layer.speed) : 1.0);
      return { remapTime: Math.max(0, isFinite(r0) ? r0 : 0), slope: isFinite(slope) ? slope : 1.0 };
    }

    _evalKinematics(item, rootSec) {
      const layer = item.layer;
      const parentLayer = item.parentLayer || null;
      const parentOffsetSec = item.parentOffsetSec || 0;
      const parentSpeed = (item.parentSpeed !== undefined && item.parentSpeed !== 0) ? Number(item.parentSpeed) : 1.0;
      const rawRootStartSec = item.rawRootStartSec !== undefined ? item.rawRootStartSec : item.rootStartSec;
      const rawRootDurSec = item.rawRootDurSec !== undefined ? item.rawRootDurSec : Math.max(0, item.rootEndSec - item.rootStartSec);
      const rawSourceOffsetSec = item.rawSourceOffsetSec !== undefined ? item.rawSourceOffsetSec : (item.sourceOffsetSec || 0);

      let layerEvalTime = rootSec;
      let parentSlope = (parentLayer && parentLayer.speed !== undefined && parentLayer.speed !== 0)
        ? Number(parentLayer.speed)
        : parentSpeed;

      if (parentLayer && parentLayer.speedMode === 'time_remap') {
        const pRemap = this._evalTimeRemapAt(parentLayer, rootSec);
        layerEvalTime = pRemap.remapTime;
        parentSlope = pRemap.slope;
      } else if (parentOffsetSec !== 0 || parentSpeed !== 1.0) {
        layerEvalTime = (rootSec - parentOffsetSec) * parentSpeed;
      }

      let clipTime = 0;
      let signedSpeed = 1.0;

      if (layer.speedMode === 'time_remap') {
        const lRemap = this._evalTimeRemapAt(layer, layerEvalTime);
        clipTime = lRemap.remapTime;
        signedSpeed = lRemap.slope * parentSlope;
      } else if (parentLayer && parentLayer.speedMode === 'time_remap') {
        const childStart = layer.startSec !== undefined ? Number(layer.startSec) : ((layer.startPx || 0) / (this.pps || 80));
        const eff = (typeof window.getLayerEffectivePropsAtTime === 'function')
          ? window.getLayerEffectivePropsAtTime(layer, layerEvalTime)
          : null;
        const childSpeed = (eff && eff.speed !== undefined)
          ? Number(eff.speed)
          : ((layer.speed !== undefined && layer.speed !== 0) ? Number(layer.speed) : 1.0);
        signedSpeed = childSpeed * parentSlope;
        clipTime = Math.max(0, rawSourceOffsetSec + (layerEvalTime - childStart) * Math.abs(childSpeed));
      } else if (layer.keyframes && Array.isArray(layer.keyframes.speed) && layer.keyframes.speed.length > 0) {
        const eff = (typeof window.getLayerEffectivePropsAtTime === 'function')
          ? window.getLayerEffectivePropsAtTime(layer, layerEvalTime)
          : null;
        const localSpeed = (eff && eff.speed !== undefined)
          ? Number(eff.speed)
          : ((layer.speed !== undefined && layer.speed !== 0) ? Number(layer.speed) : 1.0);
        signedSpeed = localSpeed * parentSlope;
        if (typeof window.getLayerIntegratedSpeedTime === 'function') {
          clipTime = Math.max(0, Number(window.getLayerIntegratedSpeedTime(layer, layerEvalTime)) || 0);
        } else {
          clipTime = Math.max(0, (item.sourceOffsetSec || 0) + (rootSec - item.rootStartSec) * Math.abs(signedSpeed));
        }
      } else {
        const localSpeed = (layer.speed !== undefined && layer.speed !== 0) ? Number(layer.speed) : 1.0;
        const baseMag = (item.effectiveSpeed !== undefined && item.effectiveSpeed > 0)
          ? Number(item.effectiveSpeed)
          : (Math.abs(localSpeed) * Math.abs(parentSlope));
        const isNeg = ((localSpeed < 0) !== (parentSlope < 0)) || !!item.isReverse;
        signedSpeed = isNeg ? -baseMag : baseMag;
        if (isNeg) {
          const elapsed = Math.max(0, rootSec - rawRootStartSec);
          clipTime = Math.max(0, rawSourceOffsetSec + Math.max(0, (rawRootDurSec - elapsed) * baseMag));
        } else {
          clipTime = Math.max(0, (item.sourceOffsetSec || 0) + (rootSec - item.rootStartSec) * baseMag);
        }
      }

      const absSpeed = Math.abs(signedSpeed);
      const isFreeze = !isFinite(absSpeed) || absSpeed <= 0.005;
      const isReverse = !isFreeze && signedSpeed < 0;
      return {
        clipTime: isFinite(clipTime) ? Math.max(0, clipTime) : 0,
        signedSpeed: isFinite(signedSpeed) ? signedSpeed : 1,
        absSpeed: isFreeze ? 0.0625 : clampRate(absSpeed),
        isFreeze,
        isReverse
      };
    }

    // ── Volume & Audio Effects ────────────────────────────────────────────────
    _volAt(item, sec) {
      const layer = item.layer;
      const parentLayer = item.parentLayer || null;
      const parentOffsetSec = item.parentOffsetSec || 0;
      const parentSpeed = (item.parentSpeed !== undefined && item.parentSpeed !== 0) ? Number(item.parentSpeed) : 1.0;
      const layerEvalTime = (parentOffsetSec === 0 && parentSpeed === 1.0)
        ? sec
        : ((sec - parentOffsetSec) * parentSpeed);
      const eff = (typeof window.getLayerEffectivePropsAtTime === 'function')
        ? window.getLayerEffectivePropsAtTime(layer, layerEvalTime)
        : null;
      const base = (eff && eff.volume !== undefined) ? eff.volume : (layer.volume !== undefined ? layer.volume : 1.0);
      let parentGain = (item.effectiveGain !== undefined && layer.volume !== undefined && layer.volume > 0)
        ? (item.effectiveGain / layer.volume)
        : (parentLayer && parentLayer.volume !== undefined ? Number(parentLayer.volume) : 1.0);
      if (parentLayer && typeof window.getLayerEffectivePropsAtTime === 'function') {
        const pEff = window.getLayerEffectivePropsAtTime(parentLayer, sec);
        if (pEff && pEff.volume !== undefined) parentGain = Number(pEff.volume);
      }
      const v = Number(base) * (item.parentLayer ? parentGain : (item.effectiveGain !== undefined && layer.volume === undefined ? item.effectiveGain : 1.0));
      return isFinite(v) ? Math.max(0, Math.min(2, v)) : 1;
    }

    _hasVolumeAutomation(item) {
      const layer = item && item.layer;
      const parent = item && item.parentLayer;
      if (!layer) return false;
      if ((layer.keyframes && Array.isArray(layer.keyframes.volume) && layer.keyframes.volume.length > 0) ||
          (layer.expressions && layer.expressions.volume)) {
        return true;
      }
      if (parent && ((parent.keyframes && Array.isArray(parent.keyframes.volume) && parent.keyframes.volume.length > 0) ||
          (parent.expressions && parent.expressions.volume))) {
        return true;
      }
      return false;
    }

    _getEnabledEffects(item) {
      const list = [];
      if (item && item.layer && Array.isArray(item.layer.audioEffects)) {
        for (let i = 0; i < item.layer.audioEffects.length; i++) {
          const fx = item.layer.audioEffects[i];
          if (fx && !fx.disabled && (fx.type === 'reverb' || fx.type === 'delay')) list.push(fx);
        }
      }
      if (item && item.parentLayer && Array.isArray(item.parentLayer.audioEffects)) {
        for (let i = 0; i < item.parentLayer.audioEffects.length; i++) {
          const fx = item.parentLayer.audioEffects[i];
          if (fx && !fx.disabled && (fx.type === 'reverb' || fx.type === 'delay')) list.push(fx);
        }
      }
      return list;
    }

    _fxKey(item) {
      const fx = this._getEnabledEffects(item);
      if (fx.length === 0) return '';
      return fx.map(f => `${f.id || ''}:${f.type}`).join(',');
    }

    _createVoiceFxChain(ctx, effects) {
      if (!effects || effects.length === 0 || !ctx) return null;
      const eng = window.FishAudioEngine;
      if (eng && typeof eng.createEffectsChain === 'function') {
        try {
          const chain = eng.createEffectsChain(ctx, effects);
          if (chain) return chain;
        } catch (_) {}
      }
      // Fallback effect chain construction (supports minimal test AudioContext mocks too)
      const input = ctx.createGain();
      const output = ctx.createGain();
      const activeFxChains = [];
      let lastNode = input;
      for (let i = 0; i < effects.length; i++) {
        const fx = effects[i];
        let group = null;
        if (eng && fx.type === 'reverb' && typeof eng._createReverbNodeGroup === 'function') {
          try { group = eng._createReverbNodeGroup(fx, ctx); } catch (_) { group = null; }
        } else if (eng && fx.type === 'delay' && typeof eng._createDelayNodeGroup === 'function') {
          try { group = eng._createDelayNodeGroup(fx, ctx); } catch (_) { group = null; }
        }
        if (!group) {
          const gIn = ctx.createGain();
          const gOut = ctx.createGain();
          gIn.connect(gOut);
          group = {
            type: fx.type,
            params: Object.assign({}, fx),
            input: gIn,
            output: gOut,
            updateParams(p) { Object.assign(this.params, p); },
            disconnect() {
              try { gIn.disconnect(); } catch (_) {}
              try { gOut.disconnect(); } catch (_) {}
            }
          };
        }
        lastNode.connect(group.input);
        lastNode = group.output;
        activeFxChains.push(group);
      }
      lastNode.connect(output);
      return {
        input,
        output,
        activeFxChains,
        disconnect() {
          try { input.disconnect(); } catch (_) {}
          activeFxChains.forEach(g => { try { g.disconnect(); } catch (_) {} });
          try { output.disconnect(); } catch (_) {}
        }
      };
    }

    // ── Transport ─────────────────────────────────────────────────────────────
    start(layers, sec, pixelsPerSecond = 80, rate = 1) {
      if (!this.isEnabled()) return false;
      const ctx = this._ctx();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        try { ctx.resume().catch(() => {}); } catch (_) {}
      }
      this._stopVoices();
      this.pps = pixelsPerSecond || 80;
      this.rate = clampRate(rate);
      this.anchorCtx = ctx.currentTime + START_LEAD_SEC;
      this.anchorSec = Math.max(0, Number(sec) || 0);
      this.playStartSec = this.anchorSec;
      this.playing = true;
      this.prefetch(layers);
      this._tick();
      if (this._timer) clearInterval(this._timer);
      this._timer = setInterval(() => this._tick(), TICK_MS);
      return true;
    }

    seek(sec) {
      if (!this.playing) return;
      const ctx = this._ctx();
      if (!ctx) return;
      this._stopVoices();
      this.anchorCtx = ctx.currentTime + START_LEAD_SEC;
      this.anchorSec = Math.max(0, Number(sec) || 0);
      this.playStartSec = this.anchorSec;
      this._tick();
    }

    setRate(rate) {
      if (!this.playing) return;
      const r = clampRate(rate);
      if (Math.abs(r - this.rate) < 0.002) return;
      const ctx = this._ctx();
      if (!ctx) return;
      const t = ctx.currentTime;
      // Re-anchor so the clock stays continuous across the rate change
      this.anchorSec = this.timelineAtCtx(Math.max(t, this.anchorCtx));
      this.anchorCtx = Math.max(t, this.anchorCtx);
      this.rate = r;
      const nowSec = this.anchorSec;
      for (const [k, v] of Array.from(this.voices.entries())) {
        if (v.startCtx > t + 0.001) {
          // Not started yet: its start time was computed with the old rate, reschedule on next tick
          this._stopVoice(v, t);
          this.voices.delete(k);
          continue;
        }
        try {
          v.src.playbackRate.cancelScheduledValues(t);
          v.src.playbackRate.setValueAtTime(clampRate(v.speed * r), t);
          v.gain.gain.cancelScheduledValues(t);
          v.gain.gain.setValueAtTime(v.lastVol, t);
        } catch (_) {}
        v.automatedUntilSec = nowSec;
        v.endFadeSet = false;
      }
      this._tick();
    }

    stop() {
      this.playing = false;
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      this._stopVoices();
    }

    _stopVoice(v, t) {
      try {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setValueAtTime(v.gain.gain.value, t);
        v.gain.gain.linearRampToValueAtTime(0, t + 0.01);
        v.src.onended = null;
        v.src.stop(t + 0.015);
      } catch (_) {}
      setTimeout(() => {
        try { v.src.disconnect(); } catch (_) {}
        try { v.gain.disconnect(); } catch (_) {}
        if (v.fxChain) {
          try { v.fxChain.disconnect(); } catch (_) {}
        }
      }, 60);
    }

    _stopVoices() {
      const ctx = this._ctx();
      const t = ctx ? ctx.currentTime : 0;
      for (const v of this.voices.values()) this._stopVoice(v, t);
      this.voices.clear();
      this.finished.clear();
    }

    _voiceKey(item) {
      const layer = item.layer;
      const parentId = item.parentLayer ? item.parentLayer.id : '';
      const rawSpeed = (layer.speed !== undefined && layer.speed !== 0) ? Number(layer.speed) : 1;
      const speedSign = (item.isReverse || rawSpeed < 0) ? '-' : '+';
      const mode = `${layer.speedMode || 'std'}:${item.parentLayer ? (item.parentLayer.speedMode || 'std') : ''}`;
      return [
        parentId,
        layer.id,
        item.rootStartSec.toFixed(4),
        item.rootEndSec.toFixed(4),
        (item.sourceOffsetSec || 0).toFixed(4),
        speedSign + (item.effectiveSpeed || 1).toFixed(4),
        mode,
        this._fxKey(item),
        this.mediaKey(layer)
      ].join('|');
    }

    _tick() {
      if (!this.playing) return;
      const ctx = this._ctx();
      if (!ctx) return;
      const layers = (window.currentProjectState && Array.isArray(window.currentProjectState.layers))
        ? window.currentProjectState.layers
        : [];
      const items = this._flatten(layers);
      const nowCtx = ctx.currentTime;
      const nowSec = this.timelineAtCtx(Math.max(nowCtx, this.anchorCtx));
      const horizon = nowSec + LOOKAHEAD_SEC * this.rate;
      const live = new Set();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!this._isSupportedLayer(item.layer, item.parentLayer, item)) continue;
        const key = this.mediaKey(item.layer);
        if (!this.buffers.has(key)) continue;
        const vk = this._voiceKey(item);
        live.add(vk);
        if (item.rootEndSec <= nowSec || item.rootStartSec >= horizon) continue;
        let v = this.voices.get(vk);
        if (!v && !this.finished.has(vk)) v = this._startVoice(item, vk, key, nowSec, nowCtx);
        if (v) this._automate(v, item, vk, key, nowSec, horizon, nowCtx);
      }

      // Clips that were removed / moved / trimmed / muted since they were scheduled
      for (const [k, v] of Array.from(this.voices.entries())) {
        if (!live.has(k)) {
          this._stopVoice(v, nowCtx);
          this.voices.delete(k);
        }
      }

      // Keep decoding newly added clips while playing
      this.prefetch(layers);
    }

    _startVoice(item, vk, mediaKey, nowSec, nowCtx) {
      const rec = this.buffers.get(mediaKey);
      if (!rec) return null;
      rec.lastUsed = perfNow();
      const ctx = this._ctx();
      const out = this._out();
      if (!ctx || !out) return null;

      let t0 = Math.max(item.rootStartSec, nowSec);
      let when = this.ctxAtTimeline(t0);
      const minWhen = nowCtx + 0.005;
      if (when < minWhen) {
        when = minWhen;
        t0 = this.timelineAtCtx(when);
      }
      if (t0 >= item.rootEndSec) return null;

      const kin = this._evalKinematics(item, t0);
      const hasSpeedAuto = this._hasSpeedAutomation(item);
      const buf = kin.isReverse ? this._getReversedBuffer(rec, ctx) : rec.buffer;
      if (!buf || !buf.duration) return null;

      let offset = kin.isReverse ? (buf.duration - kin.clipTime) : kin.clipTime;
      if (kin.isReverse && offset < 0 && offset > -0.05) offset = 0;
      if (offset < 0 || offset >= buf.duration - 0.001) return null;

      const speed = kin.absSpeed;
      const maxBufRem = buf.duration - offset;
      const dur = hasSpeedAuto
        ? maxBufRem
        : Math.min(maxBufRem, (item.rootEndSec - t0) * speed);
      if (dur <= 0.002) return null;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = clampRate(speed * this.rate);
      try {
        src.playbackRate.setValueAtTime(clampRate(speed * this.rate), when);
      } catch (_) {}

      const gain = ctx.createGain();
      const v0 = kin.isFreeze ? 0 : this._volAt(item, t0);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(v0, when + 0.004); // de-click fade-in

      const enabledEffects = this._getEnabledEffects(item);
      const fxChain = this._createVoiceFxChain(ctx, enabledEffects);
      src.connect(gain);
      if (fxChain && fxChain.input && fxChain.output) {
        gain.connect(fxChain.input);
        fxChain.output.connect(out);
      } else {
        gain.connect(out);
      }

      try {
        src.start(when, offset, dur);
      } catch (_) {
        try { src.disconnect(); gain.disconnect(); } catch (__) {}
        if (fxChain) { try { fxChain.disconnect(); } catch (__) {} }
        return null;
      }

      const voice = {
        key: vk,
        mediaKey,
        src,
        gain,
        fxChain,
        speed,
        isReverse: kin.isReverse,
        startCtx: when,
        startTimelineSec: t0,
        automatedUntilSec: t0,
        lastClipTime: kin.clipTime,
        lastVol: v0,
        hasVolAuto: this._hasVolumeAutomation(item),
        hasSpeedAuto,
        endFadeSet: false
      };
      src.onended = () => {
        try { src.disconnect(); } catch (_) {}
        try { gain.disconnect(); } catch (_) {}
        if (fxChain) { try { fxChain.disconnect(); } catch (_) {} }
        if (this.voices.get(vk) === voice) {
          this.voices.delete(vk);
          this.finished.add(vk);
        }
      };
      this.voices.set(vk, voice);
      return voice;
    }

    _automate(v, item, vk, mediaKey, nowSec, horizon, nowCtx) {
      const g = v.gain.gain;
      const rParam = v.src.playbackRate;
      try {
        // Live update audio effect parameters if present
        if (v.fxChain && Array.isArray(v.fxChain.activeFxChains)) {
          const enabledFx = this._getEnabledEffects(item);
          for (let i = 0; i < enabledFx.length && i < v.fxChain.activeFxChains.length; i++) {
            const grp = v.fxChain.activeFxChains[i];
            if (grp && typeof grp.updateParams === 'function') {
              grp.updateParams(enabledFx[i]);
            }
          }
        }

        if (v.hasSpeedAuto && nowCtx >= v.startCtx) {
          const nowKin = this._evalKinematics(item, nowSec);
          if (!nowKin.isFreeze && nowKin.isReverse !== v.isReverse) {
            // Time-remap slope crossed zero and flipped direction (forward <-> reverse): swap buffer voice cleanly
            this._stopVoice(v, nowCtx);
            this.voices.delete(vk);
            this.finished.delete(vk);
            const nextV = this._startVoice(item, vk, mediaKey, nowSec, nowCtx);
            if (nextV) this._automate(nextV, item, vk, mediaKey, nowSec, horizon, nowCtx);
            return;
          }
        }

        if (v.hasVolAuto || v.hasSpeedAuto) {
          let t = v.automatedUntilSec;
          const until = Math.min(horizon, item.rootEndSec - 0.005);
          while (t + VOL_STEP_SEC <= until) {
            t += VOL_STEP_SEC;
            const ct = this.ctxAtTimeline(t);
            const kin = v.hasSpeedAuto ? this._evalKinematics(item, t) : null;
            const isFreeze = kin ? kin.isFreeze : false;
            const vol = isFreeze ? 0 : this._volAt(item, t);
            if (ct > nowCtx) {
              g.linearRampToValueAtTime(vol, ct);
              if (kin) {
                const targetRate = clampRate(kin.absSpeed * this.rate);
                if (typeof rParam.linearRampToValueAtTime === 'function') {
                  rParam.linearRampToValueAtTime(targetRate, ct);
                } else {
                  rParam.value = targetRate;
                }
                v.speed = kin.absSpeed;
                v.lastClipTime = kin.clipTime;
              }
            }
            v.lastVol = vol;
          }
          v.automatedUntilSec = t;
        } else {
          // Static volume edited live from the inspector: glide to the new value
          const vol = this._volAt(item, nowSec);
          if (Math.abs(vol - v.lastVol) > 0.005) {
            g.setTargetAtTime(vol, Math.max(nowCtx, v.startCtx + 0.005), 0.02);
            v.lastVol = vol;
          }
        }

        if (!v.endFadeSet && item.rootEndSec <= horizon) {
          const endCtx = this.ctxAtTimeline(item.rootEndSec);
          if (endCtx - 0.005 > nowCtx) {
            g.setValueAtTime(v.lastVol, endCtx - 0.005);
            g.linearRampToValueAtTime(0, endCtx);
            if (v.hasSpeedAuto) {
              try { v.src.stop(endCtx + 0.005); } catch (_) {}
            }
          }
          v.endFadeSet = true;
        }
      } catch (_) {}
    }
  }

  const scheduler = new FishAudioScheduler();
  window.FishAudioScheduler = scheduler;

  // Background prefetch while editing (not playing) so the first Play already has decoded buffers
  if (typeof setInterval === 'function') {
    setInterval(() => {
      if (scheduler.playing || !scheduler.isEnabled()) return;
      const ps = window.currentProjectState;
      if (ps && Array.isArray(ps.layers)) scheduler.prefetch(ps.layers);
    }, 2000);
  }
})(typeof window !== 'undefined' ? window : globalThis);
