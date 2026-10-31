/**
 * js/media/fish-audio-scheduler.js
 * Web Audio clip scheduler + sample-accurate timeline clock.
 *
 * Instead of chasing one <audio>/<video> element per layer every playback tick (seek / drift steering),
 * each eligible clip is decoded once into an AudioBuffer and played with an AudioBufferSourceNode that is
 * scheduled on the AudioContext clock. The same clock drives the timeline playhead, so picture
 * (VideoFrameExtractor frames rendered at timeline time) and sound can never drift apart.
 *
 * Opt-in:   localStorage.setItem('oft_audio_engine', 'scheduler')
 * Disable:  localStorage.removeItem('oft_audio_engine')
 *
 * Clips the scheduler does not support (nested precomp children, time remap, speed keyframes, reverse,
 * audio effects, muted, or not yet decoded) keep playing through the legacy FishAudioEngine element path.
 */
(function (window) {
  'use strict';

  const LOOKAHEAD_SEC = 2.0;   // timeline seconds scheduled ahead of the playhead
  const TICK_MS = 250;         // scheduler tick
  const VOL_STEP_SEC = 0.05;   // volume keyframe automation resolution
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
      this.buffers = new Map();   // mediaKey -> { buffer, bytes, lastUsed }
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
        return typeof localStorage !== 'undefined' && localStorage.getItem('oft_audio_engine') === 'scheduler';
      } catch (_) {
        return false;
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

    _isSupportedLayer(layer, parentLayer) {
      if (!layer || parentLayer) return false;
      if (layer.type !== 'audio' && layer.type !== 'video') return false;
      if (layer.hidden || layer.isMuted || layer.muted) return false;
      if (layer.speedMode === 'time_remap') return false;
      if (layer.speed !== undefined && layer.speed <= 0) return false;
      if (layer.keyframes && Array.isArray(layer.keyframes.speed) && layer.keyframes.speed.length > 0) return false;
      if (Array.isArray(layer.audioEffects) && layer.audioEffects.some(fx => fx && !fx.disabled)) return false;
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

    // ── Decoding / buffer cache ───────────────────────────────────────────────
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
      this.buffers.set(key, { buffer: buf, bytes, lastUsed: perfNow() });
      this._evict();
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
        const layer = items[i].layer;
        if (!this._isSupportedLayer(layer, items[i].parentLayer)) continue;
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
          this._pumpDecodeQueue();
        });
    }

    // ── Volume ────────────────────────────────────────────────────────────────
    _volAt(item, sec) {
      const layer = item.layer;
      const eff = (typeof window.getLayerEffectivePropsAtTime === 'function')
        ? window.getLayerEffectivePropsAtTime(layer, sec)
        : null;
      // Same formula as the legacy element path so loudness does not change between engines
      const base = (eff && eff.volume !== undefined) ? eff.volume : (layer.volume !== undefined ? layer.volume : 1.0);
      const v = Number(base) * (item.effectiveGain || 1);
      return isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    }

    _hasVolumeAutomation(layer) {
      return !!((layer.keyframes && Array.isArray(layer.keyframes.volume) && layer.keyframes.volume.length > 0) ||
        (layer.expressions && layer.expressions.volume));
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
          v.src.playbackRate.setValueAtTime(v.speed * r, t);
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
      return [
        item.layer.id,
        item.rootStartSec.toFixed(4),
        item.rootEndSec.toFixed(4),
        (item.sourceOffsetSec || 0).toFixed(4),
        (item.effectiveSpeed || 1).toFixed(4),
        this.mediaKey(item.layer)
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
        if (!this._isSupportedLayer(item.layer, item.parentLayer)) continue;
        const key = this.mediaKey(item.layer);
        if (!this.buffers.has(key)) continue;
        const vk = this._voiceKey(item);
        live.add(vk);
        if (item.rootEndSec <= nowSec || item.rootStartSec >= horizon) continue;
        let v = this.voices.get(vk);
        if (!v && !this.finished.has(vk)) v = this._startVoice(item, vk, key, nowSec, nowCtx);
        if (v) this._automate(v, item, nowSec, horizon, nowCtx);
      }

      // Clips that were removed / moved / trimmed / became unsupported since they were scheduled
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
      const buf = rec.buffer;
      const speed = item.effectiveSpeed || 1;

      let t0 = Math.max(item.rootStartSec, nowSec);
      let when = this.ctxAtTimeline(t0);
      const minWhen = nowCtx + 0.005;
      if (when < minWhen) {
        when = minWhen;
        t0 = this.timelineAtCtx(when);
      }
      if (t0 >= item.rootEndSec) return null;
      const offset = (item.sourceOffsetSec || 0) + (t0 - item.rootStartSec) * speed;
      if (offset < 0 || offset >= buf.duration - 0.001) return null;
      const dur = Math.min(buf.duration - offset, (item.rootEndSec - t0) * speed);
      if (dur <= 0.002) return null;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = speed * this.rate;
      const gain = ctx.createGain();
      const v0 = this._volAt(item, t0);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(v0, when + 0.004); // de-click fade-in
      src.connect(gain);
      gain.connect(out);
      try {
        src.start(when, offset, dur);
      } catch (_) {
        try { src.disconnect(); gain.disconnect(); } catch (__) {}
        return null;
      }
      const voice = {
        key: vk,
        mediaKey,
        src,
        gain,
        speed,
        startCtx: when,
        automatedUntilSec: t0,
        lastVol: v0,
        hasAuto: this._hasVolumeAutomation(item.layer),
        endFadeSet: false
      };
      src.onended = () => {
        try { src.disconnect(); } catch (_) {}
        try { gain.disconnect(); } catch (_) {}
        if (this.voices.get(vk) === voice) {
          this.voices.delete(vk);
          this.finished.add(vk);
        }
      };
      this.voices.set(vk, voice);
      return voice;
    }

    _automate(v, item, nowSec, horizon, nowCtx) {
      const g = v.gain.gain;
      try {
        if (v.hasAuto) {
          let t = v.automatedUntilSec;
          const until = Math.min(horizon, item.rootEndSec - 0.005);
          while (t + VOL_STEP_SEC <= until) {
            t += VOL_STEP_SEC;
            const vol = this._volAt(item, t);
            const ct = this.ctxAtTimeline(t);
            if (ct > nowCtx) g.linearRampToValueAtTime(vol, ct);
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
