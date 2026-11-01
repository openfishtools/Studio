/**
 * OpenFishTools Extension - Auto Mark Card (.js)
 * 100% Self-Contained Extension (UI + DSP Butterworth 160Hz Bass Detector & BPM Tempo Engine)
 *
 * Cara Edit Algoritma DSP:
 * - `DSP_CONFIG.BASS_CUTOFF_HZ` (default `160` Hz): Frekuensi low-pass filter untuk menangkap kick drum & sub-bass.
 * - `DSP_CONFIG.MIN_BEAT_INTERVAL_SEC` (default `0.17` detik): Jarak minimum antar ketukan agar tidak double-trigger.
 */
(function(global) {
  'use strict';

  const DSP_CONFIG = {
    BASS_CUTOFF_HZ: 160,
    HOP_DURATION_SEC: 0.012,
    MIN_BEAT_INTERVAL_SEC: 0.17,
    DEFAULT_BPM: 120
  };

  // =========================================================================
  // 1. AUDIO BUFFER DECODER & DSP BASS / BPM ENGINE
  // =========================================================================
  async function getAudioBufferForLayer(layer, hostWindow) {
    const win = hostWindow || (typeof window !== 'undefined' ? window : global);
    if (!layer) return null;
    if (layer.audioBuffer && typeof layer.audioBuffer.getChannelData === 'function') {
      return layer.audioBuffer;
    }
    let audioSrc = layer.dataUrl || layer.url || layer.src;
    let blobToRevoke = null;

    if (!audioSrc && layer.blob) {
      try {
        blobToRevoke = URL.createObjectURL(layer.blob);
        audioSrc = blobToRevoke;
      } catch (_) {}
    }

    if (!audioSrc && win && win.layerMediaCache) {
      const entry = win.layerMediaCache.get(layer.id) || win.layerMediaCache.get(layer.mediaId);
      if (entry && entry.el && entry.el.src && !entry.el.src.startsWith('data:,')) {
        audioSrc = entry.el.src;
      }
    }

    if (!audioSrc && win && win._activeMediaMap && layer.mediaId && win._activeMediaMap.has(layer.mediaId)) {
      const item = win._activeMediaMap.get(layer.mediaId);
      if (item) {
        if (item.dataUrl) audioSrc = item.dataUrl;
        else if (item.blob) {
          blobToRevoke = URL.createObjectURL(item.blob);
          audioSrc = blobToRevoke;
        }
      }
    }

    if (!audioSrc && layer.mediaId && win && win.FishDatabase && typeof win.FishDatabase.getMedia === 'function') {
      try {
        const item = await win.FishDatabase.getMedia(layer.mediaId);
        if (item) {
          if (item.dataUrl) audioSrc = item.dataUrl;
          else if (item.blob) {
            blobToRevoke = URL.createObjectURL(item.blob);
            audioSrc = blobToRevoke;
          } else if (item.buffer) {
            const b = new Blob([item.buffer], { type: item.mimeType || 'audio/mp3' });
            blobToRevoke = URL.createObjectURL(b);
            audioSrc = blobToRevoke;
          }
        }
      } catch (_) {}
    }

    if (!audioSrc) return null;

    try {
      const AudioCtx = (win && (win.AudioContext || win.webkitAudioContext)) || (typeof AudioContext !== 'undefined' ? AudioContext : null);
      if (!AudioCtx) return null;
      const actx = new AudioCtx();
      let arrayBuffer;
      if (typeof audioSrc === 'string' && audioSrc.startsWith('data:')) {
        const commaIdx = audioSrc.indexOf(',');
        const base64Str = commaIdx !== -1 ? audioSrc.slice(commaIdx + 1) : audioSrc;
        const binaryStr = atob(base64Str);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        arrayBuffer = bytes.buffer;
      } else {
        const res = await fetch(audioSrc);
        arrayBuffer = await res.arrayBuffer();
      }
      const buf = await actx.decodeAudioData(arrayBuffer);
      try { if (actx.state !== 'closed') actx.close(); } catch (_) {}
      return buf;
    } catch (err) {
      console.warn('[AutoMark] Audio decode warning:', err);
      return null;
    } finally {
      if (blobToRevoke) {
        try { URL.revokeObjectURL(blobToRevoke); } catch (_) {}
      }
    }
  }

  function detectBassFromAudioBuffer(audioBuffer, sensitivity = 65, durationLimit = null) {
    if (!audioBuffer) return [];
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = durationLimit ? Math.min(channelData.length, Math.floor(durationLimit * sampleRate)) : channelData.length;

    // 2nd Order Butterworth Low-Pass Filter at 160Hz for sub-bass & kick drum
    const cutoff = DSP_CONFIG.BASS_CUTOFF_HZ;
    const w0 = 2 * Math.PI * cutoff / sampleRate;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 / (2 * 0.707);

    const b0 = (1 - cosw0) / 2;
    const b1 = 1 - cosw0;
    const b2 = (1 - cosw0) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;

    const nb0 = b0 / a0;
    const nb1 = b1 / a0;
    const nb2 = b2 / a0;
    const na1 = a1 / a0;
    const na2 = a2 / a0;

    const hopSize = Math.max(128, Math.floor(sampleRate * DSP_CONFIG.HOP_DURATION_SEC));
    const numHops = Math.floor(totalSamples / hopSize);

    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const hopEnergies = new Float32Array(numHops);
    let hopIdx = 0;
    let currentHopSum = 0;
    let hopSampleCount = 0;

    for (let i = 0; i < totalSamples; i++) {
      const x0 = channelData[i];
      const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;

      currentHopSum += y0 * y0;
      hopSampleCount++;

      if (hopSampleCount >= hopSize) {
        hopEnergies[hopIdx] = Math.sqrt(currentHopSum / hopSampleCount);
        currentHopSum = 0;
        hopSampleCount = 0;
        hopIdx++;
        if (hopIdx >= numHops) break;
      }
    }

    const flux = new Float32Array(numHops);
    let maxFlux = 0;
    for (let i = 1; i < numHops; i++) {
      const diff = hopEnergies[i] - hopEnergies[i - 1];
      flux[i] = diff > 0 ? diff : 0;
      if (flux[i] > maxFlux) maxFlux = flux[i];
    }

    if (maxFlux <= 0) return [];

    const winHalf = Math.max(3, Math.floor((sampleRate * 0.20) / hopSize));
    const sensFactor = 0.45 + (100 - Math.max(1, Math.min(100, sensitivity))) * 0.024;
    const minHopDist = Math.max(2, Math.floor((sampleRate * DSP_CONFIG.MIN_BEAT_INTERVAL_SEC) / hopSize));

    const beatTimes = [];
    let lastBeatHop = -minHopDist;

    for (let i = 2; i < numHops - 2; i++) {
      if (i - lastBeatHop < minHopDist) continue;
      if (flux[i] <= flux[i - 1] || flux[i] < flux[i + 1]) continue;
      if (flux[i] < maxFlux * 0.06) continue;

      let sum = 0;
      let count = 0;
      const startW = Math.max(0, i - winHalf);
      const endW = Math.min(numHops, i + winHalf);
      for (let k = startW; k < endW; k++) {
        sum += flux[k];
        count++;
      }
      const localMean = count > 0 ? (sum / count) : 0;
      const thresh = localMean * (1.0 + sensFactor);

      if (flux[i] > thresh) {
        beatTimes.push((i * hopSize) / sampleRate);
        lastBeatHop = i;
      }
    }
    return beatTimes;
  }

  function detectBassFromWaveformPeaks(peaks, durationSec, sensitivity = 65) {
    if (!peaks || peaks.length === 0) return [];
    const numBars = peaks.length;
    const barDur = durationSec / numBars;
    const flux = new Float32Array(numBars);
    let maxFlux = 0;
    for (let i = 1; i < numBars; i++) {
      const diff = peaks[i] - peaks[i - 1];
      flux[i] = diff > 0 ? diff : 0;
      if (flux[i] > maxFlux) maxFlux = flux[i];
    }
    const sensFactor = 0.35 + (100 - Math.max(1, Math.min(100, sensitivity))) * 0.022;
    const minIntervalBars = Math.max(2, Math.floor(DSP_CONFIG.MIN_BEAT_INTERVAL_SEC / barDur));
    const winHalf = Math.max(2, Math.floor(0.25 / barDur));
    const result = [];
    let lastBar = -minIntervalBars;

    for (let i = 1; i < numBars - 1; i++) {
      if (i - lastBar < minIntervalBars) continue;
      if (flux[i] <= flux[i - 1] || flux[i] < flux[i + 1]) continue;
      if (flux[i] < maxFlux * 0.06) continue;

      let sum = 0;
      const startW = Math.max(0, i - winHalf);
      const endW = Math.min(numBars, i + winHalf);
      for (let k = startW; k < endW; k++) sum += flux[k];
      const mean = sum / (endW - startW);

      if (flux[i] > mean * (1.0 + sensFactor)) {
        result.push(i * barDur);
        lastBar = i;
      }
    }
    return result;
  }

  function estimateBPMFromAudio(beatTimes) {
    if (!beatTimes || beatTimes.length < 3) return DSP_CONFIG.DEFAULT_BPM;
    const intervals = [];
    for (let i = 1; i < beatTimes.length; i++) {
      const dt = beatTimes[i] - beatTimes[i - 1];
      if (dt >= 0.25 && dt <= 1.5) {
        intervals.push(dt);
      }
    }
    if (intervals.length === 0) return DSP_CONFIG.DEFAULT_BPM;

    const bpmCounts = new Map();
    intervals.forEach(dt => {
      let bpm = Math.round(60 / dt);
      while (bpm < 75) bpm *= 2;
      while (bpm > 165) bpm /= 2;
      bpm = Math.round(bpm);
      bpmCounts.set(bpm, (bpmCounts.get(bpm) || 0) + 1);
    });

    let bestBpm = DSP_CONFIG.DEFAULT_BPM;
    let maxCount = -1;
    bpmCounts.forEach((count, bpm) => {
      if (count > maxCount) {
        maxCount = count;
        bestBpm = bpm;
      }
    });
    return bestBpm;
  }

  async function detectAudioLayerBPM(ctx, layer, sensitivity = 65) {
    const host = ctx.getHost();
    const target = layer || ctx.layers.getActive();
    if (!target) return DSP_CONFIG.DEFAULT_BPM;

    let detected = DSP_CONFIG.DEFAULT_BPM;
    const durSec = target.durationSec || target.mediaDuration || 30;
    const audioBuffer = await getAudioBufferForLayer(target, host);
    if (audioBuffer) {
      const beats = detectBassFromAudioBuffer(audioBuffer, sensitivity, durSec);
      detected = estimateBPMFromAudio(beats);
    } else if (host && typeof host.getAudioPeaksForLayer === 'function') {
      const peaks = await host.getAudioPeaksForLayer(target, 800);
      const beats = detectBassFromWaveformPeaks(peaks, durSec, sensitivity);
      detected = estimateBPMFromAudio(beats);
    }
    return Math.round(detected);
  }

  async function generateAutoBeatmarks(ctx, arg0) {
    const opts = (arg0 && typeof arg0 === 'object') ? arg0 : {};
    const host = ctx.getHost();
    const targets = ctx.layers.getSelected();
    if (!targets || targets.length === 0) {
      const msg = 'Please select an audio layer first';
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }

    const layer = targets[0];
    if (!ctx.layers.isAudio(layer)) {
      const msg = 'Selected layer is not an audio layer';
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }

    const { fps, pps } = ctx.project.getDimensions();
    const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
    const durSec = layer.durationSec !== undefined ? layer.durationSec : (layer.mediaDuration || 5);
    const endSec = startSec + durSec;

    const mode = opts.mode || 'bass';
    const sensitivity = typeof opts.sensitivity === 'number' ? opts.sensitivity : 65;
    const bpm = Math.max(40, Math.min(240, opts.bpm || DSP_CONFIG.DEFAULT_BPM));
    const division = opts.division || '1/1';
    const clearExisting = opts.clearExisting !== false;

    let detectedOffsets = [];

    if (mode === 'bpm') {
      let interval = 60 / bpm;
      if (division === '1/2') interval /= 2;
      else if (division === '1/4') interval /= 4;

      let t = startSec;
      while (t <= endSec + 0.001) {
        detectedOffsets.push(t);
        t += interval;
      }
    } else {
      let audioBuffer = null;
      try {
        audioBuffer = await getAudioBufferForLayer(layer, host);
      } catch (_) {}

      if (audioBuffer) {
        const relOffsets = detectBassFromAudioBuffer(audioBuffer, sensitivity, durSec);
        detectedOffsets = relOffsets.map(t => startSec + t);
      } else {
        let peaks = null;
        if (host && typeof host.getAudioPeaksForLayer === 'function') {
          try { peaks = await host.getAudioPeaksForLayer(layer, 800); } catch (_) {}
        }
        if (peaks && peaks.length > 0) {
          const relOffsets = detectBassFromWaveformPeaks(peaks, durSec, sensitivity);
          detectedOffsets = relOffsets.map(t => startSec + t);
        } else {
          const interval = 0.5;
          let t = startSec;
          while (t <= endSec + 0.001) {
            detectedOffsets.push(t);
            t += interval;
          }
        }
      }
    }

    const finalMarks = detectedOffsets
      .filter(t => t >= startSec - 0.001 && t <= endSec + 0.001)
      .map(t => Math.round(t * fps) / fps);

    const state = ctx.getProjectState();
    if (!state) {
      ctx.showToast('Active project composition not found', true);
      return { error: true, message: 'No active project' };
    }

    const existingMarks = ctx.timeline.getMarkers();
    let updated = clearExisting
      ? existingMarks.filter(b => b < startSec - 0.005 || b > endSec + 0.005)
      : existingMarks.slice();

    finalMarks.forEach(m => {
      if (!updated.some(u => Math.abs(u - m) <= (0.5 / fps))) {
        updated.push(m);
      }
    });

    updated.sort((a, b) => a - b);
    layer.markers = finalMarks.map(t => Number(t.toFixed(4)));
    ctx.timeline.setMarkers(updated);

    ctx.showToast(`Generated ${finalMarks.length} beatmarks`);
    return { success: true, count: finalMarks.length, beatmarks: finalMarks };
  }

  // Expose DSP helpers on global for backward compatibility with audio utilities
  if (global) {
    global.getAudioBufferForLayer = getAudioBufferForLayer;
    global.detectBassFromAudioBuffer = detectBassFromAudioBuffer;
    global.detectBassFromWaveformPeaks = detectBassFromWaveformPeaks;
    global.estimateBPMFromAudio = estimateBPMFromAudio;
  }

  // =========================================================================
  // 2. CARD DEFINITION & UI
  // =========================================================================
  Card({
    id: 'auto_mark',
    name: 'Auto Mark',
    icon: 'music_note',
    description: 'Automatic beatmark generator based on Bass transients or BPM tempo grid.',
    category: 'Tools',
    defaultEnabled: true,

    tools: {
      AUTO_MARK: generateAutoBeatmarks,
      AUTO_BEATMARK: generateAutoBeatmarks
    },

    build(ui, ctx) {
      let currentMode = ctx.storage.get('auto_mark_mode', 'bass');
      let sensitivityVal = ctx.storage.get('auto_mark_sensitivity', 65);
      let bpmVal = ctx.storage.get('auto_mark_bpm', 120);
      let divisionVal = ctx.storage.get('auto_mark_division', '1/1');
      let clearExistingVal = ctx.storage.get('auto_mark_clear', true);

      ui.section('Detection Mode');

      ui.segmented({
        cols: 2,
        value: currentMode,
        options: [
          { id: 'bass', label: 'BASS', icon: 'graphic_eq', title: 'Detect kick drum and bass transients' },
          { id: 'bpm', label: 'BPM', icon: 'av_timer', title: 'Generate markers from tempo BPM grid' }
        ],
        onChange(mode) {
          currentMode = mode;
          ctx.storage.set('auto_mark_mode', currentMode);
          renderSettings();
        }
      });

      const settingsContainer = document.createElement('div');
      settingsContainer.className = 'auto-mark-settings-panel';
      ui.custom(settingsContainer);

      function validateSelectedAudioLayer() {
        const layer = ctx.layers ? ctx.layers.getActive() : ctx.getSelectedLayer();
        if (!layer) {
          ctx.showToast('Please select an audio layer first', true);
          return null;
        }
        const isAudio = ctx.audio ? ctx.audio.isAudioLayer(layer) : (layer.type === 'audio' || layer.mediaType === 'audio' || layer.isAudioTrack === true);
        if (!isAudio) {
          ctx.showToast('Selected layer is not an audio layer', true);
          return null;
        }
        return layer;
      }

      function renderSettings() {
        settingsContainer.innerHTML = '';
        const subUI = ui.createSubBuilder(settingsContainer);

        if (currentMode === 'bass') {
          subUI.slider({
            label: 'SENSITIVITY',
            min: 10,
            max: 100,
            step: 1,
            value: sensitivityVal,
            unit: '%',
            title: 'Drag to adjust bass detection sensitivity',
            onChange(val) {
              sensitivityVal = Math.round(val);
              ctx.storage.set('auto_mark_sensitivity', sensitivityVal);
            }
          });

          subUI.text({
            text: 'Higher sensitivity captures lighter hits; lower sensitivity captures prominent kicks only.',
            variant: 'label',
            style: { fontSize: '11px', opacity: '0.75', marginTop: '2px' }
          });
        } else {
          const bpmGroup = document.createElement('div');
          bpmGroup.className = 'form-group';
          bpmGroup.style.display = 'flex';
          bpmGroup.style.flexDirection = 'column';
          bpmGroup.style.gap = '4px';

          const bpmLabel = document.createElement('label');
          bpmLabel.className = 'status-label';
          bpmLabel.textContent = 'TEMPO (BPM)';
          bpmGroup.appendChild(bpmLabel);

          const bpmControlRow = document.createElement('div');
          bpmControlRow.className = 'auto-mark-bpm-row';

          const inputWrap = document.createElement('div');
          inputWrap.className = 'auto-mark-bpm-input-wrap';

          const bpmInput = subUI.input({
            type: 'number',
            min: 40,
            max: 240,
            step: 1,
            value: String(bpmVal),
            container: inputWrap,
            onChange(val) {
              bpmVal = parseInt(val, 10) || 120;
              ctx.storage.set('auto_mark_bpm', bpmVal);
            }
          });
          bpmControlRow.appendChild(inputWrap);

          const rowUI = ui.createSubBuilder(bpmControlRow);
          rowUI.button({
            label: 'DETECT BPM',
            icon: 'graphic_eq',
            title: 'Detect tempo BPM from selected audio layer',
            className: 'auto-mark-detect-btn',
            async onClick() {
              const layer = validateSelectedAudioLayer();
              if (!layer) return;

              ctx.showToast('Analyzing audio tempo...');
              try {
                const detected = await detectAudioLayerBPM(ctx, layer, 65);
                bpmVal = Math.round(detected);
                bpmInput.value = String(bpmVal);
                ctx.storage.set('auto_mark_bpm', bpmVal);
                ctx.showToast(`Detected tempo: ${bpmVal} BPM`);
              } catch (err) {
                ctx.showToast(`Failed to detect BPM: ${err.message}`, true);
              }
            }
          });

          bpmGroup.appendChild(bpmControlRow);
          settingsContainer.appendChild(bpmGroup);

          subUI.segmented({
            label: 'BEAT DIVISION',
            cols: 3,
            value: divisionVal,
            style: { marginTop: '4px' },
            options: [
              { id: '1/1', label: '1/1 BEAT', title: 'Every beat (Quarter note)' },
              { id: '1/2', label: '1/2 BEAT', title: 'Half beat (Eighth note)' },
              { id: '1/4', label: '1/4 BEAT', title: 'Quarter beat (Sixteenth note)' }
            ],
            onChange(div) {
              divisionVal = div;
              ctx.storage.set('auto_mark_division', divisionVal);
            }
          });
        }
      }

      renderSettings();

      ui.section('Options');
      ui.switch({
        label: 'Clear Existing Markers',
        checked: clearExistingVal,
        onChange(checked) {
          clearExistingVal = !!checked;
          ctx.storage.set('auto_mark_clear', clearExistingVal);
        }
      });

      ui.grid({ cols: 2 }, [
        ui.button({
          label: 'AUTO MARK',
          icon: 'auto_awesome',
          title: 'Generate beatmarks on selected audio layer',
          className: 'tool-btn-primary',
          onClick() {
            const layer = validateSelectedAudioLayer();
            if (!layer) return;

            ctx.showToast('Analyzing audio...');
            generateAutoBeatmarks(ctx, {
              mode: currentMode,
              sensitivity: sensitivityVal,
              bpm: bpmVal,
              division: divisionVal,
              clearExisting: clearExistingVal
            });
          }
        }),
        ui.button({
          label: 'CLEAR ALL',
          icon: 'delete_sweep',
          title: 'Clear all timeline beatmarks',
          onClick() {
            if (!ctx.timeline.clearMarkers()) {
              ctx.showToast('No beatmarks to clear');
              return;
            }
            ctx.showToast('All beatmarks cleared');
          }
        })
      ]);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
