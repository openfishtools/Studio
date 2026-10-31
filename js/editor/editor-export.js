/**
 * OpenFishTools Studio - Editor Export Engine
 * Manages full-resolution offscreen canvas frame rendering, PNG snapshots, ZIP image sequences,
 * MP4 WebCodecs export with Mp4Muxer / FFmpeg, Web Audio API offline mixdown, OFTS project package exporter,
 * QR modal sharing, welcome modal, and preview matting widget.
 */
(function() {
  async function getFFmpeg() {
    if (window._cachedFFmpegInstance) return window._cachedFFmpegInstance;
    if (typeof createFFmpeg === 'function') {
      window._cachedFFmpegInstance = createFFmpeg({ log: false });
      await window._cachedFFmpegInstance.load();
      return window._cachedFFmpegInstance;
    }
    return null;
  }
  window.getFFmpeg = getFFmpeg;

  (function initExportSubsystem() {
    (function initEditorExportEngine() {
      let isExportCancelled = false;
      let ffmpegInstance = null;

      // 1. Progress Overlay Helpers
      function drawExportProgressPreview(sourceCanvas) {
        try {
          const previewCanvas = document.getElementById('export-progress-preview-canvas');
          if (!previewCanvas) return;
          const src = sourceCanvas || document.getElementById('editor-active-canvas');
          if (!src || !src.width || !src.height) return;
          const maxDim = 420;
          const ratio = src.width / src.height;
          let tw = maxDim;
          let th = Math.max(1, Math.round(maxDim / ratio));
          if (src.height > src.width) {
            th = maxDim;
            tw = Math.max(1, Math.round(maxDim * ratio));
          }
          if (previewCanvas.width !== tw || previewCanvas.height !== th) {
            previewCanvas.width = tw;
            previewCanvas.height = th;
          }
          const ctx = previewCanvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, tw, th);
            ctx.drawImage(src, 0, 0, tw, th);
          }
        } catch (_) {}
      }
      window.drawExportProgressPreview = drawExportProgressPreview;

      function showExportProgress(title, percent = 0, stage = '') {
        window.isExporting = true;
        if (typeof document !== 'undefined') document.body.classList.add('is-exporting');
        // Stop playback immediately across both timeline and template editor!
        if (typeof pausePlayback === 'function') {
          try { pausePlayback(false); } catch (_) {}
        }
        if (window.FishTemplateEditor && typeof window.FishTemplateEditor.pause === 'function') {
          try { window.FishTemplateEditor.pause(); } catch (_) {}
        }
        if (typeof updatePlayButtonUI === 'function') {
          try { updatePlayButtonUI(); } catch (_) {}
        }

        if (window.PreviewCacheManager && typeof window.PreviewCacheManager.stopIdleWorker === 'function') {
          window.PreviewCacheManager.stopIdleWorker();
        }
        const overlay = document.getElementById('editor-export-progress-overlay');
        const titleEl = document.getElementById('export-progress-title');
        const fillEl = document.getElementById('export-progress-fill');
        const percentEl = document.getElementById('export-progress-percent');
        const stageEl = document.getElementById('export-progress-stage');

        if (titleEl) titleEl.textContent = title || 'Exporting video';
        if (fillEl) fillEl.style.width = `${Math.min(100, Math.max(0, percent))}%`;
        if (percentEl) percentEl.textContent = `${Math.round(percent)}%`;
        if (stageEl) stageEl.textContent = stage || '';
        if (typeof window.updateExportPreviewAndSpecs === 'function') {
          try { window.updateExportPreviewAndSpecs(); } catch (_) {}
        }
        drawExportProgressPreview(null);
        if (overlay) overlay.style.display = 'flex';

        isExportCancelled = false;
      }

      function updateExportProgress(percent, stage = null) {
        const fillEl = document.getElementById('export-progress-fill');
        const percentEl = document.getElementById('export-progress-percent');
        const stageEl = document.getElementById('export-progress-stage');

        const clamped = Math.min(100, Math.max(0, percent));
        if (fillEl) fillEl.style.width = `${clamped}%`;
        if (percentEl) percentEl.textContent = `${Math.round(clamped)}%`;
        if (stage && stageEl) stageEl.textContent = stage;
      }

      function hideExportProgress() {
        window.isExporting = false;
        if (typeof document !== 'undefined') document.body.classList.remove('is-exporting');
        const overlay = document.getElementById('editor-export-progress-overlay');
        if (overlay) overlay.style.display = 'none';
        if (typeof updatePlayButtonUI === 'function') {
          try { updatePlayButtonUI(); } catch (_) {}
        }
      }

      // Unified Cancel Handler (for Image Sequence, Video, and any ongoing render)
      function cancelExport() {
        console.warn('[FishExport] 🛑 User requested export cancellation');
        isExportCancelled = true;
        window.isExportCancelled = true;
        window.isExporting = false;
        if (typeof document !== 'undefined') document.body.classList.remove('is-exporting');
        if (typeof updatePlayButtonUI === 'function') {
          try { updatePlayButtonUI(); } catch (_) {}
        }

        // Cancel video export in FishExportEngine if running
        if (window.FishExportEngine && typeof window.FishExportEngine.cancel === 'function') {
          if (!window.FishExportEngine._isCancelling) {
            window.FishExportEngine._isCancelling = true;
            try { window.FishExportEngine.cancel(); } catch (_) {}
            window.FishExportEngine._isCancelling = false;
          }
        }

        // Full purge of all non-essential caches (timeline preview, extracted video frames, freeze canvases)
        if (typeof window.cleanupAllStudioCaches === 'function') {
          window.cleanupAllStudioCaches('export_cancelled').catch(() => {});
        }

        updateExportProgress(0, 'Cancelling export...');
        setTimeout(hideExportProgress, 250);
        restoreVideoPreviewAfterExport();
      }
      window._cancelEditorExport = cancelExport;

      // Cancel button
      const cancelBtn = document.getElementById('btn-export-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', cancelExport);
      }

      // 1.5 Video Cache & Preview Restoration Helpers
      function restoreVideoPreviewAfterExport() {
        try {
          if (typeof window.redrawComposition === 'function') {
            window.redrawComposition('exportFinished');
          }
        } catch (_) {}
      }

      async function ensureAllVideosCached() {
        if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.ensureLayersCached === 'function') {
          return await window.VideoFrameExtractor.ensureLayersCached(
            currentProjectState.layers || [],
            (pct, label) => updateExportProgress(Math.round(pct * 0.15), label || 'Extracting frames...'),
            () => isExportCancelled || window.isExportCancelled
          );
        }
        return true;
      }

      async function prepareVideoFramesForTime(t, videoLayers, pps) {
        if (!window.VideoFrameExtractor) return;
        const allLayers = (videoLayers && videoLayers.length > 0) ? videoLayers : (currentProjectState.layers || []);
        const frameFetches = [];
        for (const vl of allLayers) {
          if (!vl || vl.hidden) continue;
          if (vl.type !== 'video' && vl.type !== 'precomp') continue;
          const start = vl.startSec !== undefined ? vl.startSec : ((vl.startPx || 0) / pps);
          const dur = vl.durationSec !== undefined ? vl.durationSec : ((vl.widthPx || 400) / pps);
          if (t >= start && t < start + dur) {
            const vlEff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(vl, t) : vl;
            const effSpeed = (vlEff && vlEff.speed !== undefined) ? vlEff.speed : (vl.speed !== undefined && vl.speed > 0 ? vl.speed : 1);
            let timeInClip = 0;
            if (window.VideoCompEngine && typeof window.VideoCompEngine.computeLayerClipTime === 'function') {
              timeInClip = window.VideoCompEngine.computeLayerClipTime(vl, t, start, effSpeed, vl.sourceOffsetSec || 0);
            } else if (vl.speedMode === 'time_remap') {
              timeInClip = Math.max(0, vlEff && vlEff.timeRemap !== undefined ? vlEff.timeRemap : ((t - start) * effSpeed));
            } else if (typeof getLayerIntegratedSpeedTime === 'function') {
              timeInClip = getLayerIntegratedSpeedTime(vl, t);
            } else {
              timeInClip = Math.max(0, (vl.sourceOffsetSec || 0) + (t - start) * effSpeed);
            }
            if (!window.VideoFrameExtractor.getFrame(vl, timeInClip)) {
              frameFetches.push(window.VideoFrameExtractor.fetchFrameFromDBAsync(vl, timeInClip));
            }
            if (vl.type === 'precomp' && Array.isArray(vl.layers)) {
              frameFetches.push(prepareVideoFramesForTime(timeInClip, vl.layers, pps));
            }
          }
        }
        if (frameFetches.length > 0) {
          await Promise.all(frameFetches);
        }
      }

      // 3. Web Audio API Offline Audio Mixdown Helper
      async function mixProjectAudioBuffer(totalDurationSec) {
        const layers = currentProjectState.layers || [];
        const pps = window.currentPixelsPerSecond || 80;
        const audioLayers = [];

        for (const l of layers) {
          if (l.hidden) continue;
          if (l.type === 'audio') {
            audioLayers.push(l);
          } else if (l.type === 'video' && !l.isMuted) {
            audioLayers.push(l);
          }
        }

        if (audioLayers.length === 0 || totalDurationSec <= 0) {
          return null;
        }

        const sampleRate = 44100;
        const length = Math.ceil(totalDurationSec * sampleRate);
        const AudioCtxClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!AudioCtxClass) return null;

        const offlineCtx = new AudioCtxClass(2, length, sampleRate);
        let scheduledCount = 0;

        for (const layer of audioLayers) {
          let tempBlobUrl = null;
          let arrayBuf = null;
          try {
            let dataUrl = layer.dataUrl;
            if (!dataUrl && layer.mediaId && window.FishDatabase) {
              const item = await window.FishDatabase.getMedia(layer.mediaId);
              if (item && item.blob) {
                tempBlobUrl = URL.createObjectURL(item.blob);
                dataUrl = tempBlobUrl;
              }
            }
            if (!dataUrl) continue;

            const resp = await fetch(dataUrl);
            arrayBuf = await resp.arrayBuffer();

            let decodedBuffer = null;
            try {
              // Pass arrayBuf directly without duplicate .slice(0) cloning
              decodedBuffer = await offlineCtx.decodeAudioData(arrayBuf);
            } catch (decErr) {
              console.warn('[AudioMix] Note: layer audio could not be decoded (silent, no audio track, or codec format):', layer.name, decErr && decErr.message);
            }

            if (!decodedBuffer) continue;

            const source = offlineCtx.createBufferSource();
            source.buffer = decodedBuffer;

            const gain = offlineCtx.createGain();
            const vol = (layer.volume !== undefined && layer.volume !== null) ? Number(layer.volume) : 1.0;
            gain.gain.value = isFinite(vol) ? vol : 1.0;
            source.connect(gain);
            gain.connect(offlineCtx.destination);

            const startSec = Math.max(0, layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps));
            const offsetSec = Math.max(0, layer.sourceOffsetSec || 0);
            const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);

            source.start(startSec, offsetSec, durSec);
            scheduledCount++;
          } catch (err) {
            console.warn('[AudioMix] Failed to mix layer:', layer.name, err && err.message);
          } finally {
            arrayBuf = null;
            if (tempBlobUrl) {
              try { URL.revokeObjectURL(tempBlobUrl); } catch (_) {}
            }
          }
        }

        if (scheduledCount === 0) {
          return null;
        }

        return await offlineCtx.startRendering();
      }

      async function mixProjectAudio(totalDurationSec) {
        const renderedBuffer = await mixProjectAudioBuffer(totalDurationSec);
        if (!renderedBuffer) return null;
        const encoder = window.audioBufferToWav || (typeof audioBufferToWav === 'function' ? audioBufferToWav : null);
        if (encoder) {
          return encoder(renderedBuffer);
        }
        return null;
      }

      // 4. FFmpeg Instance Lazy Loader
      async function getFFmpeg() {
        if (ffmpegInstance && ffmpegInstance.isLoaded()) {
          return ffmpegInstance;
        }
        if (!window.FFmpeg || typeof window.FFmpeg.createFFmpeg !== 'function') {
          throw new Error('FFmpeg library is not loaded');
        }

        // Clear any previous in-memory or contaminated createFFmpegCore
        try {
          delete window.createFFmpegCore;
        } catch (_) {}

        const { createFFmpeg } = window.FFmpeg;
        const coreUrl = new URL('vendor/ffmpeg/ffmpeg-core.js?v=' + Date.now(), document.baseURI || window.location.href).href;

        ffmpegInstance = createFFmpeg({
          mainName: 'main',
          corePath: coreUrl,
          log: true
        });

        await ffmpegInstance.load();
        return ffmpegInstance;
      }

      // 5. EXPORT ACTION: Single Frame as .PNG
      async function exportCurrentFrameAsPNG(options = {}) {
        if (!options || !options.keepPopoverOpen) {
          if (window.Popover) window.Popover.close();
        }

        const aspect = currentProjectState.aspectRatio || '16:9';
        const res = currentProjectState.resolution || '1080p';
        const baseDims = window.getProjectDimensions(res, aspect);
        const [baseW, baseH] = baseDims;

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = baseW;
        exportCanvas.height = baseH;

        const pixelsPerSec = window.currentPixelsPerSecond || 80;
        const currentPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
        const currentSec = Math.abs(currentPanX) / pixelsPerSec;

        // Prepare active video frames at currentSec from cache without video element seek
        const layers = currentProjectState.layers || [];
        const videoLayers = layers.filter(l => l.type === 'video' && !l.hidden);
        await prepareVideoFramesForTime(currentSec, videoLayers, pixelsPerSec);

        renderCanvasFrame(exportCanvas, currentProjectState.bgColor, baseW, baseH, 'export-png', currentSec);

        const sanitizedName = (currentProjectState.name || 'Project').replace(/[^a-zA-Z0-9_-]/g, '_');
        const d = new Date();
        const filename = (options && options.filename) || `${sanitizedName}_SS_${d.getTime()}.png`;

        exportCanvas.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 2000);
        }, 'image/png');
      }
      window.exportCurrentFrameAsPNG = exportCurrentFrameAsPNG;

      // 6. EXPORT ACTION: Full Image Sequence as .ZIP
      async function exportImageSequenceZIP() {
        if (window.Popover) window.Popover.close();
        if (typeof JSZip === 'undefined') {
          alert('JSZip library not available.');
          return;
        }

        if (window.isExporting) {
          console.warn('[FishExport] Export already in progress. Aborting duplicate request.');
          return;
        }

        showExportProgress('Exporting image sequence', 0, 'Preparing sequence...');
        isExportCancelled = false;
        window.isExportCancelled = false;
        window.isExporting = true;

        const cacheOk = await ensureAllVideosCached();
        if (!cacheOk || isExportCancelled || window.isExportCancelled || !window.isExporting) {
          hideExportProgress();
          return;
        }

        let exportCanvas = null;
        let zip = null;

        try {
          const fps = parseInt(currentProjectState.fps || 60, 10);
          const totalDur = Math.max(0.5, (typeof window.getProjectTotalDuration === 'function' ? window.getProjectTotalDuration() : (currentProjectState.defaultDuration || 5)));
          const totalFrames = Math.max(1, Math.round(totalDur * fps));

          const aspect = currentProjectState.aspectRatio || '16:9';
          const res = currentProjectState.resolution || '1080p';
          const baseDims = window.getProjectDimensions(res, aspect);
          const [baseW, baseH] = baseDims;

          exportCanvas = document.createElement('canvas');
          exportCanvas.width = baseW;
          exportCanvas.height = baseH;

          zip = new JSZip();
          const videoLayers = (currentProjectState.layers || []).filter(l => l.type === 'video' && !l.hidden);
          const pps = window.currentPixelsPerSecond || 80;

          for (let i = 0; i < totalFrames; i++) {
            if (isExportCancelled || window.isExportCancelled || !window.isExporting) {
              console.warn(`[Export:Sequence] Cancelled at frame ${i}/${totalFrames}`);
              return;
            }

            const t = i / fps;

            // Prepare active video frames from cache without video element seek
            await prepareVideoFramesForTime(t, videoLayers, pps);
            if (isExportCancelled || window.isExportCancelled || !window.isExporting) {
              return;
            }

            renderCanvasFrame(exportCanvas, currentProjectState.bgColor, baseW, baseH, 'export-sequence', t);
            if (i === 0 || i % 3 === 0 || i === totalFrames - 1) {
              drawExportProgressPreview(exportCanvas);
            }

            const frameBlob = await new Promise(res => exportCanvas.toBlob(res, 'image/png'));
            if (isExportCancelled || window.isExportCancelled || !window.isExporting) {
              return;
            }
            const frameBytes = await frameBlob.arrayBuffer();
            const filename = `frame_${String(i).padStart(5, '0')}.png`;
            zip.file(filename, frameBytes);

            const pct = Math.round((i / totalFrames) * 85);
            updateExportProgress(pct, `Frame ${i + 1} / ${totalFrames}`);

            if (i % 4 === 0) {
              await new Promise(r => setTimeout(r, 0));
            }
          }

          if (isExportCancelled || window.isExportCancelled || !window.isExporting) {
            console.warn('[Export:Sequence] Cancelled before ZIP generation');
            return;
          }

          updateExportProgress(88, 'Packing ZIP archive...');
          let abortedZip = false;
          const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
            if (isExportCancelled || window.isExportCancelled || !window.isExporting) {
              abortedZip = true;
              return;
            }
            const zipPct = 88 + Math.round((meta.percent || 0) * 0.11);
            updateExportProgress(zipPct, `Compressing ZIP (${Math.round(meta.percent)}%)...`);
          });

          if (abortedZip || isExportCancelled || window.isExportCancelled || !window.isExporting) {
            console.warn('[Export:Sequence] Cancelled during/after ZIP compression');
            return;
          }

          updateExportProgress(100, 'Download starting...');
          const sanitizedName = (currentProjectState.name || 'Project').replace(/[^a-zA-Z0-9_-]/g, '_');
          const filename = `${sanitizedName}_sequence_${res}_${fps}fps.zip`;
          const dlUrl = URL.createObjectURL(zipBlob);
          const a = document.createElement('a');
          a.href = dlUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(dlUrl);
          }, 2000);

          setTimeout(hideExportProgress, 600);
        } finally {
          window.isExporting = false;
          if (exportCanvas) {
            exportCanvas.width = 1;
            exportCanvas.height = 1;
            if (exportCanvas.parentNode) exportCanvas.parentNode.removeChild(exportCanvas);
            exportCanvas = null;
          }
          if (zip && zip.files) {
            for (const k in zip.files) {
              try { delete zip.files[k]; } catch (_) {}
            }
            zip = null;
          }
          if (isExportCancelled || window.isExportCancelled) {
            if (typeof window.cleanupAllStudioCaches === 'function') {
              window.cleanupAllStudioCaches('export_cancelled').catch(() => {});
            }
            hideExportProgress();
          }
          restoreVideoPreviewAfterExport();
          try {
            if (typeof window.redrawComposition === 'function') window.redrawComposition('exportFinished');
          } catch (_) {}
        }
      }

      // 7. EXPORT ACTION: True Framerate Frame-by-Frame GPU Video Exporter (WebCodecs + Mp4Muxer)
      async function exportVideoWebCodecs(preset = 'normal', customName = '') {
        if (typeof VideoEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') {
          return false;
        }

        const aspect = currentProjectState.aspectRatio || '16:9';
        const res = currentProjectState.resolution || '1080p';
        const baseDims = window.getProjectDimensions(res, aspect);
        let baseW = baseDims[0];
        let baseH = baseDims[1];
        // Enforce even dimensions for H.264
        baseW = baseW - (baseW % 2);
        baseH = baseH - (baseH % 2);

        const fps = parseInt(currentProjectState.fps || 60, 10);
        const totalDur = Math.max(0.5, (typeof window.getProjectTotalDuration === 'function' ? window.getProjectTotalDuration() : (currentProjectState.defaultDuration || 5)));
        const totalFrames = Math.max(1, Math.round(totalDur * fps));
        const pps = window.currentPixelsPerSecond || 80;

        // Adaptive bitrate (scales with resolution/fps; shared helper in fish-export-engine.js)
        const _pixelRate = baseW * baseH * fps;
        const _lvl = _pixelRate <= 1.33e8 ? '2a' : (_pixelRate <= 2.5e8 ? '33' : '34');
        let videoBps;
        if (typeof window.computeExportVideoBitrate === 'function') {
          videoBps = window.computeExportVideoBitrate(preset, baseW, baseH, fps, totalDur, 'avc');
        } else {
          const _base = preset === 'light' ? 6000000 : (preset === 'detail' ? 20000000 : 10000000);
          videoBps = Math.round(Math.max(2000000, Math.min(100000000,
            _base * Math.max(0.05, (baseW * baseH) / (1920 * 1080)) * Math.pow(Math.max(12, Math.min(120, fps)) / 30, 0.6))));
        }
        const chosenBitrateMode = 'variable';

        // Best compression first (High profile), probed so unsupported ones fall through safely
        const candidateCodecs = [
          { codec: 'avc1.6400' + _lvl, muxerCodec: 'avc' }, // High
          { codec: 'avc1.4d40' + _lvl, muxerCodec: 'avc' }, // Main
          { codec: 'avc1.42e0' + _lvl, muxerCodec: 'avc' }, // Constrained Baseline
          { codec: 'avc1.4200' + _lvl, muxerCodec: 'avc' }, // Baseline
          { codec: 'vp09.00.10.08', muxerCodec: 'vp9' }, // VP9 Profile 0 8-bit
          { codec: 'vp09.02.10.10', muxerCodec: 'vp9' }  // VP9 Profile 2 10-bit
        ];

        // Active probe helper to verify VideoEncoder actually configures and encodes without throwing DOMException
        // (Fixes Firefox and Hackintosh VideoToolbox false-positive isConfigSupported bugs)
        async function probeEncoderConfig(config) {
          if (typeof VideoEncoder === 'undefined') return false;
          return new Promise(resolve => {
            let settled = false;
            let testEnc = null;
            let testFrame = null;
            const cleanup = () => {
              if (testFrame) {
                try { testFrame.close(); } catch (_) {}
                testFrame = null;
              }
              if (testEnc) {
                try { testEnc.close(); } catch (_) {}
                testEnc = null;
              }
            };
            const finish = (ok) => {
              if (settled) return;
              settled = true;
              cleanup();
              resolve(ok);
            };

            try {
              testEnc = new VideoEncoder({
                output: () => finish(true),
                error: () => finish(false)
              });
              testEnc.configure(config);

              const probeCanvas = document.createElement('canvas');
              probeCanvas.width = config.width;
              probeCanvas.height = config.height;
              const pctx = probeCanvas.getContext('2d');
              if (pctx) pctx.fillRect(0, 0, 1, 1);
              testFrame = new VideoFrame(probeCanvas, { timestamp: 0, duration: 16666 });
              testEnc.encode(testFrame, { keyFrame: true });
              testEnc.flush().then(() => finish(true)).catch(() => finish(false));
            } catch (_) {
              finish(false);
            }

            setTimeout(() => finish(false), 1000);
          });
        }

        let chosenCodec = null;
        let chosenConfig = null;
        const hwModes = ['no-preference', 'prefer-hardware', 'prefer-software'];
        const brModes = chosenBitrateMode === 'variable' ? ['variable'] : [chosenBitrateMode, 'variable'];
        const latencyModes = ['quality', 'realtime'];

        codecLoop:
        for (const candidate of candidateCodecs) {
          for (const hwMode of hwModes) {
            for (const brMode of brModes) {
              for (const latMode of latencyModes) {
                const testCfg = {
                  codec: candidate.codec,
                  width: baseW,
                  height: baseH,
                  bitrate: videoBps,
                  bitrateMode: brMode,
                  framerate: fps,
                  latencyMode: latMode,
                  hardwareAcceleration: hwMode
                };
                if (candidate.codec.startsWith('avc1')) {
                  testCfg.avc = { format: 'avc' };
                }
                try {
                  const check = await VideoEncoder.isConfigSupported(testCfg);
                  if (check && check.supported) {
                    const verified = await probeEncoderConfig(testCfg);
                    if (verified) {
                      chosenCodec = candidate;
                      chosenConfig = testCfg;
                      break codecLoop;
                    }
                  }
                } catch (_) {}
              }
            }
          }
        }

        if (!chosenCodec || !chosenConfig) {
          console.info('[Export:WebCodecs] No working VideoEncoder supported on this system/browser. Graceful fallback to MediaRecorder.');
          return false;
        }

        showExportProgress('Exporting video...', 0, 'Preparing...');

        const cacheOk = await ensureAllVideosCached();
        if (!cacheOk) return false;

        isExportCancelled = false;
        window.isExporting = true;

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = baseW;
        exportCanvas.height = baseH;

        try {
          // 1. Prepare Audio Mixdown in parallel
          updateExportProgress(3, 'Preparing...');
          let wavBlob = null;
          try {
            wavBlob = await mixProjectAudio(totalDur);
          } catch (aErr) {
            console.warn('[Export:Audio] Mix error:', aErr);
          }

          if (isExportCancelled) {
            hideExportProgress();
            return true;
          }

          // 2. Initialize Mp4Muxer with firstTimestampBehavior offset
          const muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.ArrayBufferTarget(),
            video: {
              codec: chosenCodec.muxerCodec,
              width: baseW,
              height: baseH
            },
            firstTimestampBehavior: 'offset',
            fastStart: 'in-memory'
          });

          // 3. Initialize VideoEncoder (latencyMode: realtime forbids B-frame reordering)
          const frameDurationMicros = Math.round(1_000_000 / fps);
          let encoderError = null;
          const videoEncoder = new VideoEncoder({
            output: (chunk, meta) => {
              try {
                const data = new Uint8Array(chunk.byteLength);
                chunk.copyTo(data);
                // Trust chunk.timestamp — derived from VideoFrame.timestamp = (i/fps)*1e6, deterministic & monotonic
                const ts  = (Number.isFinite(chunk.timestamp) && chunk.timestamp >= 0) ? chunk.timestamp : 0;
                const dur = (Number.isFinite(chunk.duration)  && chunk.duration  >  0) ? chunk.duration  : frameDurationMicros;
                muxer.addVideoChunkRaw(data, chunk.type, ts, dur, meta);
              } catch (muxErr) {
                console.error('[Export:Muxer] addVideoChunkRaw error:', muxErr);
                encoderError = muxErr;
              }
            },
            error: (err) => {
              console.error('[Export:VideoEncoder] Error:', err);
              encoderError = err;
            }
          });

          videoEncoder.configure(chosenConfig);

          const videoLayers = (currentProjectState.layers || []).filter(l => l.type === 'video' && !l.hidden);

          // Pause all video layers and reset playback state to ensure exact frame seeking without playback drift
          for (const vl of videoLayers) {
            const media = getOrLoadLayerMedia(vl);
            if (media && media.el && media.el.tagName === 'VIDEO') {
              try {
                media.el.pause();
                media.el.playbackRate = 1.0;
              } catch (_) {}
            }
          }

          // 4. Frame-by-Frame True 60 FPS Seek & GPU Encode
          for (let i = 0; i < totalFrames; i++) {
            if (isExportCancelled || encoderError) {
              try { videoEncoder.close(); } catch (_) {}
              hideExportProgress();
              return true;
            }

            const t = i / fps;

            // Prepare active video frames from cache without video element seek
            await prepareVideoFramesForTime(t, videoLayers, pps);

            // Draw full project resolution frame
            renderCanvasFrame(exportCanvas, currentProjectState.bgColor, baseW, baseH, 'export-video', t);
            if (i === 0 || i % 4 === 0 || i === totalFrames - 1) {
              drawExportProgressPreview(exportCanvas);
            }

            // Backpressure: wait for encoder to process queued frames so GPU BGRA surface buffer pool never exhausts
            while (videoEncoder.encodeQueueSize > 2) {
              await new Promise(resolve => {
                let settled = false;
                const onDequeue = () => {
                  if (!settled) {
                    settled = true;
                    videoEncoder.removeEventListener('dequeue', onDequeue);
                    resolve();
                  }
                };
                videoEncoder.addEventListener('dequeue', onDequeue);
                setTimeout(onDequeue, 8);
              });
            }

            // Create VideoFrame with exact timestamp & duration (microseconds) with allocation resilience
            let vFrame = null;
            const frameTs = Math.round((i / fps) * 1_000_000);
            try {
              vFrame = new VideoFrame(exportCanvas, {
                timestamp: frameTs,
                duration: frameDurationMicros
              });
            } catch (vfErr) {
              // Surface pool or memory pressure: drain encoder queue and retry
              if (videoEncoder.encodeQueueSize > 0) {
                await new Promise(r => {
                  let d = false;
                  const onDeq = () => { if (!d) { d = true; videoEncoder.removeEventListener('dequeue', onDeq); r(); } };
                  videoEncoder.addEventListener('dequeue', onDeq);
                  setTimeout(onDeq, 40);
                });
              }
              try {
                vFrame = new VideoFrame(exportCanvas, {
                  timestamp: frameTs,
                  duration: frameDurationMicros
                });
              } catch (vfErr2) {
                // Secondary fallback: allocate via ImageBitmap to bypass direct canvas BGRA surface lock
                const bmp = await createImageBitmap(exportCanvas);
                vFrame = new VideoFrame(bmp, {
                  timestamp: frameTs,
                  duration: frameDurationMicros
                });
                bmp.close();
              }
            }

            const isKey = (i % (fps * 2)) === 0;
            videoEncoder.encode(vFrame, { keyFrame: isKey });
            vFrame.close();


            const pct = 5 + Math.round((i / totalFrames) * 88);
            updateExportProgress(pct, `Frame ${i + 1} / ${totalFrames}`);

            if (i % 6 === 0) {
              await new Promise(r => setTimeout(r, 0));
            }
          }

          if (isExportCancelled || encoderError) {
            try { videoEncoder.close(); } catch (_) {}
            hideExportProgress();
            return true;
          }

          updateExportProgress(95, 'Saving video...');
          await videoEncoder.flush();
          muxer.finalize();

          const videoBuffer = muxer.target.buffer;
          let finalBlob = null;

          // 5. Merge Audio via Fast Stream Copy (0.2s) if project has sound
          if (wavBlob && wavBlob.size > 100) {
            try {
              const ffmpeg = await getFFmpeg();
              try { ffmpeg.FS('unlink', 'v_temp.mp4'); } catch (_) {}
              try { ffmpeg.FS('unlink', 'a_temp.wav'); } catch (_) {}
              try { ffmpeg.FS('unlink', 'out_merged.mp4'); } catch (_) {}
              ffmpeg.FS('writeFile', 'v_temp.mp4', new Uint8Array(videoBuffer));
              ffmpeg.FS('writeFile', 'a_temp.wav', new Uint8Array(await wavBlob.arrayBuffer()));
              await ffmpeg.run('-i', 'v_temp.mp4', '-i', 'a_temp.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-strict', '-2', '-shortest', 'out_merged.mp4');
              const mergedData = ffmpeg.FS('readFile', 'out_merged.mp4');
              finalBlob = new Blob([mergedData.buffer], { type: 'video/mp4' });
              try { ffmpeg.FS('unlink', 'v_temp.mp4'); } catch (_) {}
              try { ffmpeg.FS('unlink', 'a_temp.wav'); } catch (_) {}
              try { ffmpeg.FS('unlink', 'out_merged.mp4'); } catch (_) {}
            } catch (mergeErr) {
              console.warn('[Export:AudioMerge] Fast stream copy failed, fallback to video only:', mergeErr);
              finalBlob = new Blob([videoBuffer], { type: 'video/mp4' });
            }
          } else {
            finalBlob = new Blob([videoBuffer], { type: 'video/mp4' });
          }

          updateExportProgress(100, 'Complete!');

          const rawBaseName = customName || currentProjectState.name || 'New_Project';
          const sanitizedName = rawBaseName.trim().replace(/\.mp4$/i, '').replace(/[/\\?%*:|"<>]/g, '_') || 'New_Project';
          const filename = `${sanitizedName}.mp4`;
          const dlUrl = URL.createObjectURL(finalBlob);
          const a = document.createElement('a');
          a.href = dlUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(dlUrl);
          }, 2000);

          setTimeout(hideExportProgress, 600);
          return true;
        } catch (err) {
          console.error('[Export:WebCodecs] Fatal error during WebCodecs export:', err);
          return false;
        } finally {
          window.isExporting = false;
          restoreVideoPreviewAfterExport();
        }
      }

      // 8. EXPORT ACTION: Hardware-Accelerated Video Exporter (Native GPU MediaRecorder Fallback)
      async function exportVideoHardware(preset = 'normal', customName = '', format = 'mp4') {
        if (window.Popover) window.Popover.close();
        if (window.isExporting) return;

        // 1. Ensure all active video layers are 100% cached at full native quality before export
        const cacheOk = await ensureAllVideosCached();
        if (!cacheOk) return;

        // Try Frame-by-Frame True 60 FPS WebCodecs GPU Exporter first (only when targeting MP4)
        if (format === 'mp4') {
          try {
            const webcodecsHandled = await exportVideoWebCodecs(preset, customName);
            if (webcodecsHandled) return;
          } catch (wcErr) {
            console.warn('[Export:WebCodecs] Fallback to MediaRecorder:', wcErr);
          }
        }

        // 1. Strict Resolution & Dimensions Enforcement (100% Native 1080p/4K - Never Downscaled)
        const aspect = currentProjectState.aspectRatio || '16:9';
        const res = currentProjectState.resolution || '1080p';
        const baseDims = window.getProjectDimensions(res, aspect);
        const [baseW, baseH] = baseDims;
        const fps = parseInt(currentProjectState.fps || 60, 10);
        const totalDur = Math.max(0.5, (typeof window.getProjectTotalDuration === 'function' ? window.getProjectTotalDuration() : (currentProjectState.defaultDuration || 5)));
        const pps = window.currentPixelsPerSecond || 80;

        showExportProgress('Exporting video', 0, 'Preparing...');
        isExportCancelled = false;
        window.isExporting = true;

        let exportCanvas = null;
        let audioCtx = null;
        let audioSourceNode = null;
        const savedMuted = new Map();
        const videoLayers = (currentProjectState.layers || []).filter(l => l.type === 'video' && !l.hidden);

        try {
          // Verify MediaRecorder support
          if (typeof MediaRecorder === 'undefined') {
            console.warn('[Export:Hardware] MediaRecorder unsupported in this browser, falling back to FFmpeg.');
            return await exportVideoFFmpeg(preset, customName);
          }

          // 2. Offline Stereo Audio Mixdown (Web Audio API Offline Context)
          updateExportProgress(3, 'Preparing...');
          let renderedAudioBuffer = null;
          try {
            renderedAudioBuffer = await mixProjectAudioBuffer(totalDur);
          } catch (audioErr) {
            console.warn('[Export:Hardware] Audio mixdown error:', audioErr);
          }

          if (isExportCancelled) {
            hideExportProgress();
            return;
          }

          // 3. Dedicated Offscreen Canvas (Exact 1:1 Project Dimensions: 1080x1920 or 1920x1080)
          exportCanvas = document.createElement('canvas');
          exportCanvas.width = baseW;
          exportCanvas.height = baseH;
          exportCanvas.style.cssText = 'position:fixed;left:-99999px;top:-99999px;pointer-events:none;opacity:0;z-index:-1;';
          document.body.appendChild(exportCanvas);

          // Capture stream directly from native 1080p canvas
          const stream = exportCanvas.captureStream(fps);
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
            await videoTrack.applyConstraints({ frameRate: { ideal: fps, max: fps } }).catch(() => {});
          }

          // 4. Attach silent mixed audio track to MediaStream
          if (renderedAudioBuffer) {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) {
              audioCtx = new AudioCtxClass({ sampleRate: renderedAudioBuffer.sampleRate || 44100 });
              if (audioCtx.state === 'suspended') {
                try { await audioCtx.resume(); } catch (_) {}
              }
              const dest = audioCtx.createMediaStreamDestination();
              audioSourceNode = audioCtx.createBufferSource();
              audioSourceNode.buffer = renderedAudioBuffer;
              audioSourceNode.connect(dest);
              const track = dest.stream.getAudioTracks()[0];
              if (track) {
                stream.addTrack(track);
              }
            }
          }

          // 5. Codec Negotiation & High-Bitrate Quality Allocation (Crisp 1080p Guaranteed)
          const mimeCandidates = [
            'video/mp4;codecs=avc1.64002a,mp4a.40.2',
            'video/mp4;codecs=avc1.4d402a,mp4a.40.2',
            'video/mp4;codecs=avc1',
            'video/mp4',
            'video/webm;codecs=h264,opus',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm'
          ];
          let selectedMime = '';
          for (const mime of mimeCandidates) {
            if (MediaRecorder.isTypeSupported(mime)) {
              selectedMime = mime;
              break;
            }
          }
          if (!selectedMime) selectedMime = 'video/webm';

          const _recDims = window.getProjectDimensions(currentProjectState.resolution || '1080p', currentProjectState.aspectRatio || '16:9');
          const _recFps = parseInt(currentProjectState.fps || 60, 10);
          const _recDur = Math.max(0.5, (typeof window.getProjectTotalDuration === 'function' ? window.getProjectTotalDuration() : 5));
          let videoBps;
          if (typeof window.computeExportVideoBitrate === 'function') {
            videoBps = window.computeExportVideoBitrate(preset, _recDims[0], _recDims[1], _recFps, _recDur, /webm|vp/i.test(selectedMime) ? 'vp9' : 'avc');
          } else {
            videoBps = preset === 'light' ? 8000000 : (preset === 'detail' ? 25000000 : 14000000);
          }

          const recorderOptions = {
            mimeType: selectedMime,
            videoBitsPerSecond: videoBps,
            audioBitsPerSecond: 192000
          };

          const mediaRecorder = new MediaRecorder(stream, recorderOptions);
          const recordedChunks = [];
          mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              recordedChunks.push(e.data);
            }
          };

          // 6. Pre-roll: Mute direct speakers, seek initial clips & warm up video decoders (Zero Delay)
          updateExportProgress(6, 'Rendering video...');
          for (const vl of videoLayers) {
            const media = getOrLoadLayerMedia(vl);
            if (media && media.el) {
              savedMuted.set(media.el, media.el.muted);
              media.el.muted = true; // Prevent sound echoing out of speakers during export
              media.el._preSeeked = false;
            }
          }

          const initialVideos = [];
          for (const vl of videoLayers) {
            const start = vl.startSec !== undefined ? vl.startSec : ((vl.startPx || 0) / pps);
            const dur = vl.durationSec !== undefined ? vl.durationSec : ((vl.widthPx || 400) / pps);
            if (start <= 0 && dur > 0) {
              const media = getOrLoadLayerMedia(vl);
              if (media && media.el && media.el.tagName === 'VIDEO') {
                initialVideos.push({ layer: vl, el: media.el });
              }
            }
          }

          // Seek initial videos to exact starting offset
          for (const item of initialVideos) {
            try {
              item.el.currentTime = item.layer.sourceOffsetSec || 0;
              item.el.playbackRate = 1.0;
            } catch (_) {}
          }

          // Wait until video decoders are ready with data
          await Promise.all(initialVideos.map(item => new Promise(resolve => {
            if (item.el.readyState >= 2 && !item.el.seeking) return resolve();
            const onReady = () => {
              item.el.removeEventListener('canplay', onReady);
              item.el.removeEventListener('seeked', onReady);
              resolve();
            };
            item.el.addEventListener('canplay', onReady, { once: true });
            item.el.addEventListener('seeked', onReady, { once: true });
            setTimeout(resolve, 600);
          })));

          // Pre-render frame 0 to canvas so the very first frame is ready
          renderCanvasFrame(exportCanvas, currentProjectState.bgColor, baseW, baseH, 'export-video', 0);
          drawExportProgressPreview(exportCanvas);

          // Warm up and start playing initial videos FIRST before recording starts (eliminates 300ms video startup lag)
          await Promise.all(initialVideos.map(item => item.el.play().catch(() => {})));

          // Wait 1 animation frame to ensure hardware decoders are actively presenting frames
          await new Promise(r => requestAnimationFrame(r));

          if (isExportCancelled) {
            hideExportProgress();
            return;
          }

          // 7. Execute Hardware GPU Recording Loop in Atomic Sync (Zero Delay, Zero Stutter)
          await new Promise((resolve, reject) => {
            let rafId = null;
            let finished = false;
            let recStep = 0;

            const onFinish = () => {
              if (finished) return;
              finished = true;
              if (rafId) cancelAnimationFrame(rafId);
              resolve();
            };

            mediaRecorder.onstop = onFinish;
            mediaRecorder.onerror = (err) => {
              if (finished) return;
              finished = true;
              if (rafId) cancelAnimationFrame(rafId);
              reject(err);
            };

            // Start hardware recorder and mixed audio at the exact same instant video is rolling
            mediaRecorder.start(250);
            if (audioSourceNode) {
              try { audioSourceNode.start(0); } catch (_) {}
            }

            const startTime = performance.now();

            function recordFrame() {
              if (isExportCancelled) {
                onFinish();
                return;
              }

              const elapsedSec = (performance.now() - startTime) / 1000;

              if (elapsedSec >= totalDur) {
                updateExportProgress(98, 'Saving video...');
                renderCanvasFrame(exportCanvas, currentProjectState.bgColor, baseW, baseH, 'export-video', totalDur);
                drawExportProgressPreview(exportCanvas);
                setTimeout(() => {
                  try { mediaRecorder.stop(); } catch (_) { onFinish(); }
                }, 80);
                return;
              }

              // Update progress bar
              const pct = 6 + Math.min(92, Math.round((elapsedSec / totalDur) * 92));
              updateExportProgress(pct, 'Rendering video...');

              // Sync active video layers with gentle clock slewing (Zero Seeking = Zero Stutter & Zero Flicker)
              for (const vl of videoLayers) {
                const start = vl.startSec !== undefined ? vl.startSec : ((vl.startPx || 0) / pps);
                const dur = vl.durationSec !== undefined ? vl.durationSec : ((vl.widthPx || 400) / pps);
                const media = getOrLoadLayerMedia(vl);
                if (!media || !media.el) continue;
                const el = media.el;

                const vlEff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(vl, elapsedSec) : vl;
                const layerSpeed = (vlEff && vlEff.speed !== undefined && vlEff.speed > 0) ? vlEff.speed : ((vl.speed !== undefined && vl.speed > 0) ? vl.speed : 1.0);
                if (elapsedSec >= start && elapsedSec < start + dur) {
                  const targetTime = Math.max(0, (vl.sourceOffsetSec || 0) + (elapsedSec - start) * layerSpeed);
                  if (el.paused) {
                    try {
                      el.currentTime = targetTime;
                      el.playbackRate = layerSpeed;
                      if ('preservesPitch' in el) el.preservesPitch = vl.preservePitch !== false;
                      el.play().catch(() => {});
                    } catch (_) {}
                  } else {
                    // Smooth clock slewing: gently adjust playbackRate by ±5% to stay in sync
                    // NEVER hard-seek el.currentTime during playback!
                    const drift = el.currentTime - targetTime;
                    if (drift < -0.04) {
                      const slewFast = layerSpeed * 1.05;
                      if (el.playbackRate !== slewFast) el.playbackRate = slewFast;
                    } else if (drift > 0.04) {
                      const slewSlow = layerSpeed * 0.95;
                      if (el.playbackRate !== slewSlow) el.playbackRate = slewSlow;
                    } else if (el.playbackRate !== layerSpeed) {
                      el.playbackRate = layerSpeed;
                    }
                  }
                } else {
                  if (!el.paused) {
                    try {
                      el.playbackRate = 1.0;
                      el.pause();
                    } catch (_) {}
                  }
                  // Pre-seek upcoming clip 0.5s before start to avoid transition stutter
                  if (elapsedSec < start && (start - elapsedSec) <= 0.5 && !el._preSeeked) {
                    el._preSeeked = true;
                    try { el.currentTime = vl.sourceOffsetSec || 0; } catch (_) {}
                  }
                }
              }

              // Draw full-resolution frame directly to canvas
              renderCanvasFrame(exportCanvas, currentProjectState.bgColor, baseW, baseH, 'export-video', elapsedSec);
              if (recStep % 4 === 0) {
                drawExportProgressPreview(exportCanvas);
              }
              recStep++;

              rafId = requestAnimationFrame(recordFrame);
            }

            rafId = requestAnimationFrame(recordFrame);
          });

          if (isExportCancelled) {
            hideExportProgress();
            return;
          }

          // 8. Download Output File
          updateExportProgress(100, 'Complete!');

          const isMp4 = selectedMime.toLowerCase().includes('mp4');
          const outBlob = new Blob(recordedChunks, { type: selectedMime });
          let finalBlob = outBlob;

          // If user requested WebM, skip FFmpeg transcode completely (instant 0s export)
          if (format === 'webm') {
            finalBlob = outBlob;
          } else if (!isMp4) {
            try {
              updateExportProgress(95, 'Preparing MP4 package...');
              const ffmpeg = await getFFmpeg();

              try { ffmpeg.FS('unlink', 'rec_in.webm'); } catch (_) {}
              try { ffmpeg.FS('unlink', 'rec_out.mp4'); } catch (_) {}

              ffmpeg.FS('writeFile', 'rec_in.webm', new Uint8Array(await outBlob.arrayBuffer()));

              const isH264 = selectedMime.toLowerCase().includes('h264') || selectedMime.toLowerCase().includes('avc');
              let remuxOk = false;

              // Fast stream copy ONLY when recorded stream is already H.264
              if (isH264) {
                try {
                  updateExportProgress(97, 'Packaging MP4 container...');
                  await ffmpeg.run('-i', 'rec_in.webm', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', 'rec_out.mp4');
                  const testBytes = ffmpeg.FS('readFile', 'rec_out.mp4');
                  if (testBytes && testBytes.length > 0) {
                    finalBlob = new Blob([testBytes.buffer], { type: 'video/mp4' });
                    remuxOk = true;
                  }
                } catch (copyErr) {
                  console.warn('[Export:Hardware] Fast remux copy failed, falling back to full transcode:', copyErr);
                  try { ffmpeg.FS('unlink', 'rec_out.mp4'); } catch (_) {}
                }
              }

              // VP8/VP9 cannot be copied into MP4 directly. Full transcode to standard H.264 + AAC:
              if (!remuxOk) {
                updateExportProgress(96, 'Transcoding video to MP4 (H.264)...');
                ffmpeg.setProgress(({ ratio }) => {
                  if (ratio >= 0 && ratio <= 1) {
                    const p = 95 + Math.round(ratio * 4);
                    updateExportProgress(p, `Converting to MP4 (${Math.round(ratio * 100)}%)...`);
                  }
                });

                const crfVal = (preset === 'detail') ? '18' : ((preset === 'light') ? '23' : '20');
                await ffmpeg.run(
                  '-i', 'rec_in.webm',
                  '-c:v', 'libx264',
                  '-preset', 'ultrafast',
                  '-tune', 'fastdecode',
                  '-pix_fmt', 'yuv420p',
                  '-crf', crfVal,
                  '-c:a', 'aac',
                  '-b:a', '192k',
                  'rec_out.mp4'
                );

                const mp4Bytes = ffmpeg.FS('readFile', 'rec_out.mp4');
                finalBlob = new Blob([mp4Bytes.buffer], { type: 'video/mp4' });
              }

              try { ffmpeg.FS('unlink', 'rec_in.webm'); } catch (_) {}
              try { ffmpeg.FS('unlink', 'rec_out.mp4'); } catch (_) {}
            } catch (convErr) {
              console.warn('[Export:Hardware] FFmpeg conversion failed, using direct recording stream:', convErr);
            }
          }

          const rawBaseName = customName || currentProjectState.name || 'New_Project';
          const sanitizedName = rawBaseName.trim().replace(/\.(mp4|webm)$/i, '').replace(/[/\\?%*:|"<>]/g, '_') || 'New_Project';
          const isRealMp4 = format === 'mp4' && (finalBlob.type === 'video/mp4' || (!finalBlob.type.includes('webm') && isMp4));
          const ext = isRealMp4 ? 'mp4' : 'webm';
          const filename = `${sanitizedName}.${ext}`;
          const dlUrl = URL.createObjectURL(finalBlob);
          const a = document.createElement('a');
          a.href = dlUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(dlUrl);
          }, 2000);

          setTimeout(hideExportProgress, 600);
        } catch (exportErr) {
          console.error('[Export:Hardware] Hardware export error, falling back to FFmpeg:', exportErr);
          return await exportVideoFFmpeg(preset, customName);
        } finally {
          window.isExporting = false;
          if (exportCanvas && exportCanvas.parentNode) {
            try { exportCanvas.parentNode.removeChild(exportCanvas); } catch (_) {}
          }
          savedMuted.forEach((wasMuted, el) => {
            try { el.muted = wasMuted; } catch (_) {}
            try { el.pause(); } catch (_) {}
          });
          if (audioSourceNode) {
            try { audioSourceNode.stop(); } catch (_) {}
          }
          if (audioCtx) {
            try { audioCtx.close(); } catch (_) {}
          }
          restoreVideoPreviewAfterExport();
        }
      }

      // Fallback: Video (.MP4 via FFmpeg.wasm)
      async function exportVideoFFmpeg(preset = 'normal', customName = '') {
        if (window.Popover) window.Popover.close();

        showExportProgress('Exporting video', 0, 'Initializing...');

        const cacheOk = await ensureAllVideosCached();
        if (!cacheOk) return;

        try {
          let ffmpeg;
          try {
            ffmpeg = await getFFmpeg();
          } catch (err) {
            console.error('[Export:FFmpeg] Failed to initialize ffmpeg.wasm:', err);
            hideExportProgress();
            alert('Failed to load FFmpeg WebAssembly. Check network or local vendor files.');
            return;
          }

          if (isExportCancelled) {
            hideExportProgress();
            return;
          }

          const fps = parseInt(currentProjectState.fps || 60, 10);
          const totalDur = Math.max(0.5, (typeof window.getProjectTotalDuration === 'function' ? window.getProjectTotalDuration() : (currentProjectState.defaultDuration || 5)));
          const totalFrames = Math.max(1, Math.round(totalDur * fps));

          // 1. Mix Audio (0% -> 10%)
          updateExportProgress(5, 'Mixing audio tracks...');
          let wavBlob = null;
          try {
            wavBlob = await mixProjectAudio(totalDur);
          } catch (audioErr) {
            console.warn('[Export:Audio] Audio mixdown error:', audioErr);
          }

          if (isExportCancelled) {
            hideExportProgress();
            return;
          }

          let hasAudio = false;
          if (wavBlob && wavBlob.size > 100) {
            try {
              const audioBytes = new Uint8Array(await wavBlob.arrayBuffer());
              ffmpeg.FS('writeFile', 'audio.wav', audioBytes);
              hasAudio = true;
            } catch (writeErr) {
              console.warn('[Export:Audio] Error writing audio.wav to virtual FS:', writeErr);
            }
          }

          // 2. Offscreen Canvas Frame Rendering (10% -> 70%)
          const aspect = currentProjectState.aspectRatio || '16:9';
          const res = currentProjectState.resolution || '1080p';
          const baseDims = window.getProjectDimensions(res, aspect);
          const [baseW, baseH] = baseDims;

          const exportCanvas = document.createElement('canvas');
          exportCanvas.width = baseW;
          exportCanvas.height = baseH;

          const createdFiles = [];
          const videoLayers = (currentProjectState.layers || []).filter(l => l.type === 'video' && !l.hidden);
          const pps = window.currentPixelsPerSecond || 80;

          for (let i = 0; i < totalFrames; i++) {
            if (isExportCancelled) {
              createdFiles.forEach(f => { try { ffmpeg.FS('unlink', f); } catch (_) {} });
              if (hasAudio) { try { ffmpeg.FS('unlink', 'audio.wav'); } catch (_) {} }
              hideExportProgress();
              return;
            }

            const t = i / fps;

            // Prepare active video frames from cache without video element seek
            await prepareVideoFramesForTime(t, videoLayers, pps);

            renderCanvasFrame(exportCanvas, currentProjectState.bgColor, baseW, baseH, 'export-video', t);
            if (i === 0 || i % 3 === 0 || i === totalFrames - 1) {
              drawExportProgressPreview(exportCanvas);
            }

            let frameBlob = await new Promise(res => exportCanvas.toBlob(res, 'image/jpeg', 0.90));
            let frameBytes = new Uint8Array(await frameBlob.arrayBuffer());
            const filename = `frame_${String(i).padStart(5, '0')}.jpg`;
            ffmpeg.FS('writeFile', filename, frameBytes);
            createdFiles.push(filename);
            frameBlob = null;
            frameBytes = null;

            const framePercent = 10 + Math.round((i / totalFrames) * 60);
            updateExportProgress(framePercent, `Frame ${i + 1} / ${totalFrames}`);

            if (i % 3 === 0) {
              await new Promise(r => setTimeout(r, 0));
            }
          }

          if (isExportCancelled) {
            createdFiles.forEach(f => { try { ffmpeg.FS('unlink', f); } catch (_) {} });
            if (hasAudio) { try { ffmpeg.FS('unlink', 'audio.wav'); } catch (_) {} }
            hideExportProgress();
            return;
          }

          // 3. Encode MP4 via FFmpeg (70% -> 95%)
          updateExportProgress(71, 'Encoding MP4 video stream (FFmpeg)...');
          await new Promise(r => setTimeout(r, 150));

          const ffmpegArgs = [
            '-framerate', String(fps),
            '-i', 'frame_%05d.jpg'
          ];

          if (hasAudio) {
            ffmpegArgs.push('-i', 'audio.wav');
          }

          if (preset === 'light') {
            ffmpegArgs.push('-c:v', 'libx264', '-r', String(fps), '-vsync', 'cfr', '-crf', '22', '-b:v', '16M', '-maxrate', '20M', '-bufsize', '20M', '-preset', 'ultrafast', '-tune', 'fastdecode', '-pix_fmt', 'yuv420p');
          } else if (preset === 'detail') {
            ffmpegArgs.push('-c:v', 'libx264', '-r', String(fps), '-vsync', 'cfr', '-b:v', '50M', '-maxrate', '50M', '-bufsize', '50M', '-preset', 'ultrafast', '-tune', 'fastdecode', '-pix_fmt', 'yuv420p');
          } else {
            ffmpegArgs.push('-c:v', 'libx264', '-r', String(fps), '-vsync', 'cfr', '-crf', '18', '-b:v', '25M', '-maxrate', '30M', '-bufsize', '30M', '-preset', 'ultrafast', '-tune', 'fastdecode', '-pix_fmt', 'yuv420p');
          }

          if (hasAudio) {
            ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
          }

          ffmpegArgs.push('output.mp4');

          ffmpeg.setProgress(({ ratio }) => {
            if (ratio >= 0 && ratio <= 1) {
              const encPct = 72 + Math.round(ratio * 24);
              updateExportProgress(encPct, `Encoding MP4 (${Math.round(ratio * 100)}%)...`);
            }
          });

          try {
            await ffmpeg.run(...ffmpegArgs);
          } catch (encodeErr) {
            const isExitZero = encodeErr && (encodeErr.status === 0 || encodeErr.name === 'ExitStatus' || String(encodeErr).includes('exit(0)'));
            let hasOutput = false;
            try {
              const testOut = ffmpeg.FS('readFile', 'output.mp4');
              if (testOut && testOut.length > 0) hasOutput = true;
            } catch (_) {}

            if (!isExitZero && !hasOutput) {
              console.warn('[Export:FFmpeg] Encode error with primary preset:', encodeErr);
              throw encodeErr;
            }
          }

          if (isExportCancelled) {
            createdFiles.forEach(f => { try { ffmpeg.FS('unlink', f); } catch (_) {} });
            if (hasAudio) { try { ffmpeg.FS('unlink', 'audio.wav'); } catch (_) {} }
            try { ffmpeg.FS('unlink', 'output.mp4'); } catch (_) {}
            hideExportProgress();
            return;
          }

          updateExportProgress(98, 'Finalizing download...');

          const outputData = ffmpeg.FS('readFile', 'output.mp4');
          const outBlob = new Blob([outputData.buffer], { type: 'video/mp4' });

          createdFiles.forEach(f => { try { ffmpeg.FS('unlink', f); } catch (_) {} });
          if (hasAudio) { try { ffmpeg.FS('unlink', 'audio.wav'); } catch (_) {} }
          try { ffmpeg.FS('unlink', 'output.mp4'); } catch (_) {}

          updateExportProgress(100, 'Complete!');

          const rawBaseName = customName || currentProjectState.name || 'New_Project';
          const sanitizedName = rawBaseName.trim().replace(/\.mp4$/i, '').replace(/[/\\?%*:|"<>]/g, '_') || 'New_Project';
          const filename = `${sanitizedName}.mp4`;
          const dlUrl = URL.createObjectURL(outBlob);
          const a = document.createElement('a');
          a.href = dlUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(dlUrl);
          }, 2000);

          setTimeout(hideExportProgress, 600);
        } catch (fatalErr) {
          console.error('[Export:Video] Fatal export error:', fatalErr);
          hideExportProgress();
          alert('Export failed: ' + (fatalErr.message || fatalErr));
        } finally {
          window.isExporting = false;
          restoreVideoPreviewAfterExport();
        }
      }

      // Export entry: delegates to FishExportEngine (offline deterministic render) for MP4.
      // Falls back to legacy exportVideoHardware if engine not loaded.
      async function exportVideoMP4(preset, customName, format) {
        if (typeof pausePlayback === 'function') {
          try { pausePlayback(false); } catch (_) {}
        }
        format = format || 'mp4';
        if (format === 'mp4' && window.FishExportEngine && typeof window.FishExportEngine.export === 'function') {
          await window.FishExportEngine.export({ preset: preset, customName: customName, format: 'mp4' });
        } else {
          await exportVideoHardware(preset, customName, format);
        }
      }
      window.exportVideoMP4 = exportVideoMP4;
      window.exportVideoHardware = exportVideoHardware;
      window.exportVideoFFmpeg = exportVideoFFmpeg;
      // 8. Bind Events — Fullscreen Export Overlay

      // ---- Minimal QR Code canvas generator (no external dependency) ----
      // Uses qr-creator algorithm via inline Reed-Solomon + data matrix generator.
      // For simplicity, integrates a CDN-loaded qrcode.js or falls back to SVG placeholder.
      function generateQRToElement(url, container) {
        container.innerHTML = '';
        // Try QRCode library if present (loaded dynamically below)
        if (window.QRCode) {
          try {
            new window.QRCode(container, {
              text: url,
              width: container.offsetWidth || 200,
              height: container.offsetHeight || 200,
              colorDark: '#000000',
              colorLight: '#ffffff',
              correctLevel: window.QRCode.CorrectLevel.H
            });
            return;
          } catch (_) {}
        }
        // Fallback: plain canvas checkerboard placeholder
        const c = document.createElement('canvas');
        c.width = 200; c.height = 200;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 200, 200);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('QR: ' + url.slice(-14), 100, 105);
        container.appendChild(c);
      }

      // Load QRCode.js dynamically (MIT, qrcodejs)
      if (!window.QRCode) {
        const s = document.createElement('script');
        s.src = 'vendor/qrcode.min.js';
        document.head.appendChild(s);
      }

      // ---- Fullscreen Export Overlay Controller ----
      const _exportOverlay = document.getElementById('export-fs-overlay');
      const _exportBtnEditor = document.getElementById('btn-editor-export');
      const _exportCloseBtn = document.getElementById('export-fs-close-btn');
      const _exportNextBtn = document.getElementById('export-fs-next-btn');
      const _exportNextLabel = document.getElementById('export-fs-next-label');
      const _exportSubtitle = document.getElementById('export-fs-subtitle');

      let _currentExportType = null; // unselected initially

      const _exportTypeLabels = {
        video:    'Export Video',
        frame:    'Current Frame',
        sequence: 'Image Sequence',
        project:  'Project File',
        link:     'Project Link'
      };

      const _exportBackdrop = document.getElementById('export-drawer-backdrop');

      function formatExportBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '~0.1 MB';
        const mb = bytes / (1024 * 1024);
        if (mb < 1) {
          const kb = Math.max(10, Math.round(bytes / 1024));
          return `~${kb} KB`;
        }
        if (mb >= 100) {
          return `~${Math.round(mb)} MB`;
        }
        return `~${mb.toFixed(1)} MB`;
      }

      function formatExportDurationBadge(sec) {
        const total = Math.max(0, Math.round(sec || 0));
        const mins = Math.floor(total / 60);
        const rem = total % 60;
        return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
      }

      function getSettingsResolutionAndFps(prefix) {
        const ps = window.currentProjectState || {};
        const grid = document.getElementById(`${prefix}-aspect-grid`);
        const selectedRatio = grid?.querySelector('.aspect-ratio-frame.is-selected')?.dataset.val || ps.aspectRatio || '16:9';
        let resLabel = ps.resolution || '1080p';
        let w = 1920, h = 1080;

        if (selectedRatio === 'Custom') {
          const cw = parseInt(document.getElementById(`${prefix}-custom-res-w`)?.value, 10);
          const ch = parseInt(document.getElementById(`${prefix}-custom-res-h`)?.value, 10);
          if (cw > 0 && ch > 0) {
            w = cw;
            h = ch;
            resLabel = `${cw}×${ch}`;
          } else if (typeof window.getProjectDimensions === 'function') {
            const d = window.getProjectDimensions(ps.resolution || '1080p', ps.aspectRatio || '16:9');
            w = d[0];
            h = d[1];
            resLabel = `${w}×${h}`;
          }
        } else {
          const dd = document.getElementById(`dropdown-${prefix}-resolution`);
          resLabel = dd?.dataset.value || ps.resolution || '1080p';
          if (typeof window.getProjectDimensions === 'function') {
            const d = window.getProjectDimensions(resLabel, selectedRatio);
            w = d[0];
            h = d[1];
          }
        }

        const fpsEl = document.getElementById(`${prefix}-fps`);
        const rawFps = fpsEl ? parseInt(fpsEl.value, 10) : parseInt(ps.fps || 60, 10);
        const fps = Math.max(1, Math.min(240, Number.isFinite(rawFps) ? rawFps : 60));

        return { w, h, resLabel, fps, aspectRatio: selectedRatio };
      }

      function updateExportPreviewAndSpecs() {
        const ps = window.currentProjectState || {};
        const totalDur = Math.max(0.5, typeof window.getProjectTotalDuration === 'function' ? window.getProjectTotalDuration() : (ps.defaultDuration || 5));

        // 1. Update Preview Canvas from #editor-active-canvas
        try {
          const previewCanvas = document.getElementById('export-preview-canvas');
          const activeCanvas = document.getElementById('editor-active-canvas');
          if (previewCanvas && activeCanvas && activeCanvas.width > 0 && activeCanvas.height > 0) {
            const maxDim = 420;
            const ratio = activeCanvas.width / activeCanvas.height;
            let tw = maxDim;
            let th = Math.max(1, Math.round(maxDim / ratio));
            if (activeCanvas.height > activeCanvas.width) {
              th = maxDim;
              tw = Math.max(1, Math.round(maxDim * ratio));
            }
            if (previewCanvas.width !== tw || previewCanvas.height !== th) {
              previewCanvas.width = tw;
              previewCanvas.height = th;
            }
            const ctx = previewCanvas.getContext('2d');
            if (ctx) {
              ctx.clearRect(0, 0, tw, th);
              ctx.drawImage(activeCanvas, 0, 0, tw, th);
            }
          }
        } catch (_) {}

        // 2. Compute Video Settings Specs
        const vCfg = getSettingsResolutionAndFps('export-video');
        const bitrateBtn = document.querySelector('[data-video-bitrate].is-active');
        const preset = bitrateBtn ? bitrateBtn.dataset.videoBitrate : 'normal';
        const presetLabel = preset === 'light' ? 'Light' : (preset === 'detail' ? 'Detail' : 'Normal');
        const includeAudio = document.getElementById('export-video-audio') ? document.getElementById('export-video-audio').checked : true;

        let baseBps = 25000000;
        let vbrFactor = 0.72;
        if (preset === 'light') {
          baseBps = 16000000;
          vbrFactor = 0.68;
        } else if (preset === 'detail') {
          baseBps = 50000000;
          vbrFactor = 0.90;
        }
        if (totalDur > 60) {
          const durScale = Math.max(0.32, Math.min(1.0, 90 / totalDur));
          baseBps = Math.max(6000000, Math.round(baseBps * durScale));
        }
        const pixelScale = Math.max(0.25, Math.min(3.2, (vCfg.w * vCfg.h) / (1920 * 1080)));
        const fpsScale = Math.max(0.5, Math.min(1.6, Math.pow(vCfg.fps / 60, 0.45)));
        const effectiveVideoBps = baseBps * vbrFactor * Math.pow(pixelScale, 0.65) * fpsScale;
        const audioBps = includeAudio ? 192000 : 0;
        const estVideoBytes = ((effectiveVideoBps + audioBps) / 8) * totalDur;
        const estVideoSizeStr = formatExportBytes(estVideoBytes);

        // Update Video Settings Summary Bar
        const vSumRes = document.getElementById('export-video-summary-res');
        const vSumFps = document.getElementById('export-video-summary-fps');
        const vSumQual = document.getElementById('export-video-summary-quality');
        const vSumSize = document.getElementById('export-video-summary-size');
        if (vSumRes) vSumRes.textContent = `${vCfg.w}×${vCfg.h}`;
        if (vSumFps) vSumFps.textContent = `${vCfg.fps} FPS`;
        if (vSumQual) vSumQual.textContent = presetLabel;
        if (vSumSize) vSumSize.textContent = estVideoSizeStr;

        // 3. Compute Sequence Settings Specs
        const sCfg = getSettingsResolutionAndFps('export-seq');
        const seqFmtBtn = document.querySelector('[data-seq-format].is-active');
        const seqFormat = seqFmtBtn ? seqFmtBtn.dataset.seqFormat : 'zip';
        const seqFmtLabel = seqFormat === 'webp' ? 'WebP' : (seqFormat === 'gif' ? 'GIF' : 'ZIP');
        const seqTotalFrames = Math.max(1, Math.round(totalDur * sCfg.fps));
        const perFrameFactor = seqFormat === 'webp' ? 0.14 : 0.38;
        const estSeqBytes = seqTotalFrames * (sCfg.w * sCfg.h * perFrameFactor);
        const estSeqSizeStr = formatExportBytes(estSeqBytes);

        // Update Sequence Settings Summary Bar
        const sSumRes = document.getElementById('export-seq-summary-res');
        const sSumFps = document.getElementById('export-seq-summary-fps');
        const sSumQual = document.getElementById('export-seq-summary-quality');
        const sSumSize = document.getElementById('export-seq-summary-size');
        if (sSumRes) sSumRes.textContent = `${sCfg.w}×${sCfg.h}`;
        if (sSumFps) sSumFps.textContent = `${sCfg.fps} FPS`;
        if (sSumQual) sSumQual.textContent = seqFmtLabel;
        if (sSumSize) sSumSize.textContent = estSeqSizeStr;

        // 4. Update Option Card Descriptions
        const cardDescVideo = document.getElementById('export-card-desc-video');
        const cardDescFrame = document.getElementById('export-card-desc-frame');
        const cardDescSeq = document.getElementById('export-card-desc-sequence');
        const projDims = typeof window.getProjectDimensions === 'function'
          ? window.getProjectDimensions(ps.resolution || '1080p', ps.aspectRatio || '16:9')
          : [1920, 1080];
        const estFrameBytes = projDims[0] * projDims[1] * 0.42;
        const estFrameSizeStr = formatExportBytes(estFrameBytes);

        if (cardDescVideo) cardDescVideo.textContent = `MP4 · ${vCfg.resLabel} · ${presetLabel} · ${vCfg.fps} FPS`;
        if (cardDescFrame) cardDescFrame.textContent = `PNG · ${projDims[0]}×${projDims[1]} · ${estFrameSizeStr}`;
        if (cardDescSeq) cardDescSeq.textContent = `${seqFmtLabel} · ${sCfg.resLabel} · ${sCfg.fps} FPS`;

        // 5. Update Top Preview Card Specs & Progress Modal Specs based on active export type
        const activeType = _currentExportType || 'video';
        const specSizeEl = document.getElementById('export-spec-size');
        const specQualEl = document.getElementById('export-spec-quality');
        const specFpsEl = document.getElementById('export-spec-fps');
        const badgeEl = document.getElementById('export-preview-badge');

        const progQualEl = document.getElementById('export-progress-spec-quality');
        const progFpsEl = document.getElementById('export-progress-spec-fps');
        const progSizeEl = document.getElementById('export-progress-spec-size');

        let displaySize = estVideoSizeStr;
        let displayQual = `${vCfg.resLabel} · ${presetLabel}`;
        let displayFps = `${vCfg.fps} FPS`;
        let displayBadge = `${formatExportDurationBadge(totalDur)} · ${vCfg.w}×${vCfg.h}`;

        if (activeType === 'frame') {
          displaySize = estFrameSizeStr;
          displayQual = `${ps.resolution || '1080p'} · PNG`;
          displayFps = '1 Frame';
          displayBadge = `PNG · ${projDims[0]}×${projDims[1]}`;
        } else if (activeType === 'sequence') {
          displaySize = estSeqSizeStr;
          displayQual = `${sCfg.resLabel} · ${seqFmtLabel}`;
          displayFps = `${sCfg.fps} FPS`;
          displayBadge = `${seqTotalFrames}f · ${sCfg.w}×${sCfg.h}`;
        } else if (activeType === 'project') {
          const layerCount = Array.isArray(ps.layers) ? ps.layers.length : 0;
          displaySize = '.ofts Bundle';
          displayQual = `${ps.resolution || '1080p'} · Project`;
          displayFps = `${ps.fps || 60} FPS`;
          displayBadge = `${layerCount} Layer${layerCount === 1 ? '' : 's'}`;
        } else if (activeType === 'link') {
          displaySize = 'Max 15 MB';
          displayQual = 'Cloud + QR';
          displayFps = `${ps.fps || 60} FPS`;
          displayBadge = `${formatExportDurationBadge(totalDur)}`;
        }

        if (specSizeEl) specSizeEl.textContent = displaySize;
        if (specQualEl) specQualEl.textContent = displayQual;
        if (specFpsEl) specFpsEl.textContent = displayFps;
        if (badgeEl) badgeEl.textContent = displayBadge;

        if (progQualEl) progQualEl.textContent = displayQual;
        if (progFpsEl) progFpsEl.textContent = displayFps;
        if (progSizeEl) progSizeEl.textContent = `Est. ${displaySize}`;
      }
      window.updateExportPreviewAndSpecs = updateExportPreviewAndSpecs;

      function openExportOverlay() {
        if (!_exportOverlay) return;
        if (typeof pausePlayback === 'function') {
          try { pausePlayback(false); } catch (_) {}
        }
        if (_exportBackdrop) _exportBackdrop.classList.add('is-active');
        _exportOverlay.classList.add('is-active');

        // Default to 'video' if not previously chosen so specs & Render button are immediately ready
        if (!_currentExportType) {
          _currentExportType = (currentProjectState && currentProjectState.exportType) ? currentProjectState.exportType : 'video';
        }
        if (_currentExportType) {
          _exportOverlay.querySelectorAll('.export-option-card').forEach(c => {
            const isMatch = c.dataset.exportType === _currentExportType;
            c.classList.toggle('is-selected', isMatch);
            c.setAttribute('aria-checked', isMatch ? 'true' : 'false');
          });
          if (_exportNextBtn) _exportNextBtn.disabled = false;
        } else {
          _exportOverlay.querySelectorAll('.export-option-card').forEach(c => {
            c.classList.remove('is-selected');
            c.setAttribute('aria-checked', 'false');
          });
          if (_exportNextBtn) _exportNextBtn.disabled = true;
        }
        if (_exportNextLabel) _exportNextLabel.textContent = 'Render';
        if (_exportSubtitle) _exportSubtitle.textContent = 'Export';
        // Sync filename in video settings panel
        const fnInput = document.getElementById('export-video-filename');
        if (fnInput && currentProjectState) fnInput.value = currentProjectState.name || 'New_Project';

        function syncExportSettingsPanel(prefix) {
          const grid = document.getElementById(`${prefix}-aspect-grid`);
          const dd = document.getElementById(`dropdown-${prefix}-resolution`);
          const wrap = document.getElementById(`${prefix}-custom-res-wrap`);
          const wInput = document.getElementById(`${prefix}-custom-res-w`);
          const hInput = document.getElementById(`${prefix}-custom-res-h`);
          const btnId = `${prefix}-btn-link-res`;
          const fpsInput = document.getElementById(`${prefix}-fps`);

          const projAspect = currentProjectState && currentProjectState.aspectRatio ? currentProjectState.aspectRatio : '16:9';
          const projRes = currentProjectState && currentProjectState.resolution ? currentProjectState.resolution : '1080p';
          const projFps = parseInt(currentProjectState && currentProjectState.fps ? currentProjectState.fps : 60, 10);
          const isCustom = projAspect === 'Custom' || String(projRes).includes('x');

          // Sync FPS input
          if (fpsInput) fpsInput.value = String(projFps);

          // Sync Aspect Ratio grid selection
          if (grid) {
            grid.querySelectorAll('.aspect-ratio-frame').forEach(f => {
              f.classList.toggle('is-selected', isCustom ? f.dataset.val === 'Custom' : f.dataset.val === projAspect);
            });
          }

          // Sync Resolution Dropdown or Custom Inputs
          if (isCustom) {
            if (dd) dd.style.display = 'none';
            if (wrap) wrap.style.display = 'flex';
            const dims = window.getProjectDimensions(projRes, projAspect);
            if (wInput) wInput.value = dims[0];
            if (hInput) hInput.value = dims[1];
          } else {
            if (dd) {
              dd.style.display = 'block';
              dd.dataset.value = projRes;
              const label = dd.querySelector('.custom-dropdown-label');
              if (label) label.textContent = projRes;
              dd.querySelectorAll('.custom-dropdown-item').forEach(item => {
                item.classList.toggle('is-selected', item.dataset.val === projRes);
              });
            }
            if (wrap) wrap.style.display = 'none';
          }

          // Bind aspect ratio grid clicks
          if (grid && !grid._exportBound) {
            grid._exportBound = true;
            grid.addEventListener('click', (e) => {
              const frame = e.target.closest('.aspect-ratio-frame');
              if (!frame) return;
              grid.querySelectorAll('.aspect-ratio-frame').forEach(f => f.classList.remove('is-selected'));
              frame.classList.add('is-selected');

              const val = frame.dataset.val;
              if (val === 'Custom') {
                if (dd) dd.style.display = 'none';
                if (wrap) wrap.style.display = 'flex';
                if (wInput && (!wInput.value || wInput.value === '1920')) {
                  const dims = window.getProjectDimensions(currentProjectState?.resolution || '1080p', currentProjectState?.aspectRatio || '16:9');
                  wInput.value = dims[0];
                  if (hInput) hInput.value = dims[1];
                }
              } else {
                if (dd) {
                  dd.style.display = 'block';
                  if (!dd.dataset.value) {
                    dd.dataset.value = '1080p';
                    const label = dd.querySelector('.custom-dropdown-label');
                    if (label) label.textContent = '1080p';
                  }
                }
                if (wrap) wrap.style.display = 'none';
              }
              updateExportPreviewAndSpecs();
            });
          }

          if (dd && !dd._exportSpecsBound) {
            dd._exportSpecsBound = true;
            dd.addEventListener('click', () => {
              setTimeout(updateExportPreviewAndSpecs, 0);
            });
          }
          if (wInput && !wInput._exportSpecsBound) {
            wInput._exportSpecsBound = true;
            wInput.addEventListener('input', updateExportPreviewAndSpecs);
          }
          if (hInput && !hInput._exportSpecsBound) {
            hInput._exportSpecsBound = true;
            hInput.addEventListener('input', updateExportPreviewAndSpecs);
          }
          if (fpsInput && !fpsInput._exportSpecsBound) {
            fpsInput._exportSpecsBound = true;
            fpsInput.addEventListener('input', updateExportPreviewAndSpecs);
            fpsInput.addEventListener('change', updateExportPreviewAndSpecs);
          }

          if (typeof setupEditorResLink === 'function') {
            setupEditorResLink(btnId, `${prefix}-custom-res-w`, `${prefix}-custom-res-h`, prefix);
          }
        }

        syncExportSettingsPanel('export-video');
        syncExportSettingsPanel('export-seq');
        updateExportPreviewAndSpecs();
      }

      function closeExportOverlay() {
        if (!_exportOverlay) return;
        if (_exportBackdrop) _exportBackdrop.classList.remove('is-active');
        _exportOverlay.classList.remove('is-active');
        // Close any open settings panel too
        document.querySelectorAll('.export-settings-panel.is-active').forEach(p => p.classList.remove('is-active'));
      }
      window.openExportOverlay = openExportOverlay;
      window.closeExportOverlay = closeExportOverlay;

      // Backdrop click/tap closes drawer
      if (_exportBackdrop) {
        _exportBackdrop.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeExportOverlay();
        });
        _exportBackdrop.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeExportOverlay();
        });
      }

      // Escape key closes drawer
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _exportOverlay && _exportOverlay.classList.contains('is-active')) {
          closeExportOverlay();
        }
      });

      // Open overlay when export button clicked (override popover)
      if (_exportBtnEditor) {
        _exportBtnEditor.removeAttribute('data-popover-target');
        _exportBtnEditor.removeAttribute('data-popover-placement');
        _exportBtnEditor.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (window.Popover) window.Popover.close(false);

          if (window.FishBgRemovalEngine) {
            let isPending = (typeof window.FishBgRemovalEngine.hasPendingTasks === 'function')
              ? window.FishBgRemovalEngine.hasPendingTasks()
              : (window.FishBgRemovalEngine.getActiveTasks ? window.FishBgRemovalEngine.getActiveTasks().some(t => !t.cancelled && t.status !== 'done') : false);

            if (!isPending && currentProjectState && currentProjectState.layers) {
              const checkLayers = (layers, visited = new Set()) => {
                for (let l of layers) {
                  if (!l || visited.has(l) || (l.id && visited.has(l.id))) continue;
                  visited.add(l);
                  if (l.id) visited.add(l.id);
                  if (window.FishBgRemovalEngine.isLayerMattingActive(l)) {
                    if (l.type === 'video') {
                      if (!l._extractComplete) {
                        window.FishBgRemovalEngine.processLayer(l);
                        return true;
                      }
                    } else if (!window.FishBgRemovalEngine.getPhotoCutout(l)) {
                      window.FishBgRemovalEngine.processLayer(l);
                      return true;
                    }
                  }
                  if (Array.isArray(l.layers) && checkLayers(l.layers, visited)) return true;
                }
                return false;
              };
              isPending = checkLayers(currentProjectState.layers);
            }

            if (isPending) {
              showEditorToast('Please wait until all layers are processed');
              return;
            }
          }

          openExportOverlay();
        });
      }

      if (_exportCloseBtn) {
        _exportCloseBtn.addEventListener('click', () => closeExportOverlay());
      }

      // Radio card selection & second-click to settings
      if (_exportOverlay) {
        _exportOverlay.querySelectorAll('.export-option-card').forEach(card => {
          card.addEventListener('click', (e) => {
            const isAlreadySelected = card.classList.contains('is-selected');
            const type = card.dataset.exportType || null;
            const chevron = card.querySelector('.export-option-chevron[data-settings-panel]');
            const panelId = chevron ? chevron.dataset.settingsPanel : null;

            if (isAlreadySelected) {
              // Second click on already selected card -> open settings panel if available
              if (panelId) {
                const panel = document.getElementById(panelId);
                if (panel) {
                  panel.classList.add('is-active');
                }
              }
              return;
            }

            // First click: select the card
            _exportOverlay.querySelectorAll('.export-option-card').forEach(c => {
              c.classList.remove('is-selected');
              c.setAttribute('aria-checked', 'false');
            });
            card.classList.add('is-selected');
            card.setAttribute('aria-checked', 'true');
            _currentExportType = type;
            if (currentProjectState) currentProjectState.exportType = type;
            if (_exportNextBtn) _exportNextBtn.disabled = false;
            if (_exportNextLabel) _exportNextLabel.textContent = 'Render';
            updateExportPreviewAndSpecs();
          });
        });

        // Chevron click → directly opens settings panel (and ensures card is selected)
        _exportOverlay.querySelectorAll('.export-option-chevron[data-settings-panel]').forEach(chevron => {
          chevron.addEventListener('click', (e) => {
            e.stopPropagation();
            const panelId = chevron.dataset.settingsPanel;
            if (!panelId) return;
            const card = chevron.closest('.export-option-card');
            if (card) {
              _exportOverlay.querySelectorAll('.export-option-card').forEach(c => {
                c.classList.remove('is-selected');
                c.setAttribute('aria-checked', 'false');
              });
              card.classList.add('is-selected');
              card.setAttribute('aria-checked', 'true');
              _currentExportType = card.dataset.exportType || null;
              if (currentProjectState) currentProjectState.exportType = _currentExportType;
              if (_exportNextBtn) _exportNextBtn.disabled = false;
              if (_exportNextLabel) _exportNextLabel.textContent = 'Render';
              updateExportPreviewAndSpecs();
            }
            const panel = document.getElementById(panelId);
            if (panel) {
              panel.classList.add('is-active');
            }
          });
        });
      }

      // Close settings panel via back button inside panel
      document.querySelectorAll('[data-close-settings]').forEach(btn => {
        btn.addEventListener('click', () => {
          const panelId = btn.dataset.closeSettings;
          const panel = document.getElementById(panelId);
          if (panel) panel.classList.remove('is-active');
          updateExportPreviewAndSpecs();
        });
      });

      // Bitrate pill selection in video settings
      document.querySelectorAll('[data-video-bitrate]').forEach(pill => {
        pill.addEventListener('click', () => {
          document.querySelectorAll('[data-video-bitrate]').forEach(p => p.classList.remove('is-active'));
          pill.classList.add('is-active');
          updateExportPreviewAndSpecs();
        });
      });

      const _exportAudioToggle = document.getElementById('export-video-audio');
      if (_exportAudioToggle) {
        _exportAudioToggle.addEventListener('change', updateExportPreviewAndSpecs);
      }

      // Image sequence format pill selection
      document.querySelectorAll('[data-seq-format]').forEach(pill => {
        pill.addEventListener('click', () => {
          document.querySelectorAll('[data-seq-format]').forEach(p => p.classList.remove('is-active'));
          pill.classList.add('is-active');
          updateExportPreviewAndSpecs();
        });
      });

      // Next button: close overlay and trigger export
      if (_exportNextBtn) {
        _exportNextBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          if (typeof pausePlayback === 'function') {
            try { pausePlayback(false); } catch (_) {}
          }

          if (window.FishBgRemovalEngine) {
            let isPending = (typeof window.FishBgRemovalEngine.hasPendingTasks === 'function')
              ? window.FishBgRemovalEngine.hasPendingTasks()
              : (window.FishBgRemovalEngine.getActiveTasks ? window.FishBgRemovalEngine.getActiveTasks().some(t => !t.cancelled && t.status !== 'done') : false);

            if (!isPending && currentProjectState && currentProjectState.layers) {
              const checkLayers = (layers, visited = new Set()) => {
                for (let l of layers) {
                  if (!l || visited.has(l) || (l.id && visited.has(l.id))) continue;
                  visited.add(l);
                  if (l.id) visited.add(l.id);
                  if (window.FishBgRemovalEngine.isLayerMattingActive(l)) {
                    if (l.type === 'video') {
                      if (!l._extractComplete) {
                        window.FishBgRemovalEngine.processLayer(l);
                        return true;
                      }
                    } else if (!window.FishBgRemovalEngine.getPhotoCutout(l)) {
                      window.FishBgRemovalEngine.processLayer(l);
                      return true;
                    }
                  }
                  if (Array.isArray(l.layers) && checkLayers(l.layers, visited)) return true;
                }
                return false;
              };
              isPending = checkLayers(currentProjectState.layers);
            }

            if (isPending) {
              showEditorToast('Please wait until all layers are processed');
              return;
            }
          }

          if (!_currentExportType || _exportNextBtn?.disabled) {
            return;
          }

          closeExportOverlay();

          switch (_currentExportType) {
            case 'video': {
              // Read settings
              const aspectGrid = document.getElementById('export-video-aspect-grid');
              const selectedRatio = aspectGrid?.querySelector('.aspect-ratio-frame.is-selected')?.dataset.val || currentProjectState.aspectRatio || '16:9';
              let res = '';
              if (selectedRatio === 'Custom') {
                const cw = parseInt(document.getElementById('export-video-custom-res-w')?.value, 10);
                const ch = parseInt(document.getElementById('export-video-custom-res-h')?.value, 10);
                if (!cw || !ch || cw <= 0 || ch <= 0 || isNaN(cw) || isNaN(ch)) {
                  if (typeof showEditorToast === 'function') {
                    showEditorToast('Resolusi video kustom tidak valid! Masukkan angka lebar dan tinggi yang benar.', 3000, 'error');
                  }
                  return;
                }
                res = `${cw}x${ch}`;
              } else {
                const dd = document.getElementById('dropdown-export-video-resolution');
                res = dd?.dataset.value;
                if (!res) {
                  if (typeof showEditorToast === 'function') {
                    showEditorToast('Pilih resolusi video yang valid!', 3000, 'error');
                  }
                  return;
                }
              }

              const fpsEl = document.getElementById('export-video-fps');
              const fps = fpsEl ? parseInt(fpsEl.value, 10) : (currentProjectState.fps || 60);
              const bitrateBtn = document.querySelector('[data-video-bitrate].is-active');
              const preset = bitrateBtn ? bitrateBtn.dataset.videoBitrate : 'normal';
              const fnInput = document.getElementById('export-video-filename');
              const customName = fnInput ? fnInput.value.trim() : '';

              // Temporarily override resolution/fps on project state for this export while preserving authored native space
              const _origRes = currentProjectState.resolution;
              const _origFps = currentProjectState.fps;
              const _origAspect = currentProjectState.aspectRatio;
              const _origBaseW = currentProjectState._baseW;
              const _origBaseH = currentProjectState._baseH;

              const targetAspect = selectedRatio || _origAspect || '16:9';
              const baseRes = _origRes || '1080p';
              const authoredDims = (window.getProjectDimensions ? window.getProjectDimensions(baseRes, _origAspect || targetAspect) : [1920, 1080]);
              const nativeBaseW = _origBaseW || authoredDims[0];
              const nativeBaseH = _origBaseH || authoredDims[1];

              currentProjectState._nativeBaseW = nativeBaseW;
              currentProjectState._nativeBaseH = nativeBaseH;
              currentProjectState._nativeRes = baseRes;
              currentProjectState._nativeAspect = targetAspect;

              currentProjectState._baseW = nativeBaseW;
              currentProjectState._baseH = nativeBaseH;

              currentProjectState.resolution = res;
              currentProjectState.fps = fps;
              currentProjectState.aspectRatio = targetAspect;

              try {
                await exportVideoMP4(preset, customName, 'mp4');
              } finally {
                currentProjectState.resolution = _origRes;
                currentProjectState.fps = _origFps;
                currentProjectState.aspectRatio = _origAspect;
                if (_origBaseW !== undefined) currentProjectState._baseW = _origBaseW; else delete currentProjectState._baseW;
                if (_origBaseH !== undefined) currentProjectState._baseH = _origBaseH; else delete currentProjectState._baseH;
                delete currentProjectState._nativeBaseW;
                delete currentProjectState._nativeBaseH;
                delete currentProjectState._nativeRes;
                delete currentProjectState._nativeAspect;
              }
              break;
            }

            case 'frame': {
              await exportCurrentFrameAsPNG();
              break;
            }

            case 'sequence': {
              // Read sequence settings
              const seqAspectGrid = document.getElementById('export-seq-aspect-grid');
              const seqSelectedRatio = seqAspectGrid?.querySelector('.aspect-ratio-frame.is-selected')?.dataset.val || currentProjectState.aspectRatio || '16:9';
              let seqRes = '';
              if (seqSelectedRatio === 'Custom') {
                const cw = parseInt(document.getElementById('export-seq-custom-res-w')?.value, 10);
                const ch = parseInt(document.getElementById('export-seq-custom-res-h')?.value, 10);
                if (!cw || !ch || cw <= 0 || ch <= 0 || isNaN(cw) || isNaN(ch)) {
                  if (typeof showEditorToast === 'function') {
                    showEditorToast('Resolusi image sequence kustom tidak valid! Masukkan angka lebar dan tinggi yang benar.', 3000, 'error');
                  }
                  return;
                }
                seqRes = `${cw}x${ch}`;
              } else {
                const dd = document.getElementById('dropdown-export-seq-resolution');
                seqRes = dd?.dataset.value;
                if (!seqRes) {
                  if (typeof showEditorToast === 'function') {
                    showEditorToast('Pilih resolusi image sequence yang valid!', 3000, 'error');
                  }
                  return;
                }
              }

              const seqFpsEl = document.getElementById('export-seq-fps');
              const seqFps = seqFpsEl ? parseInt(seqFpsEl.value, 10) : (currentProjectState.fps || 60);
              const formatBtn = document.querySelector('[data-seq-format].is-active');
              const seqFormat = formatBtn ? formatBtn.dataset.seqFormat : 'zip';

              const _origRes2 = currentProjectState.resolution;
              const _origFps2 = currentProjectState.fps;
              const _origAspect2 = currentProjectState.aspectRatio;
              const _origBaseW2 = currentProjectState._baseW;
              const _origBaseH2 = currentProjectState._baseH;

              const seqTargetAspect = seqSelectedRatio || _origAspect2 || '16:9';
              const seqBaseRes = _origRes2 || '1080p';
              const seqAuthoredDims = (window.getProjectDimensions ? window.getProjectDimensions(seqBaseRes, _origAspect2 || seqTargetAspect) : [1920, 1080]);
              const seqNativeBaseW = _origBaseW2 || seqAuthoredDims[0];
              const seqNativeBaseH = _origBaseH2 || seqAuthoredDims[1];

              currentProjectState._nativeBaseW = seqNativeBaseW;
              currentProjectState._nativeBaseH = seqNativeBaseH;
              currentProjectState._nativeRes = seqBaseRes;
              currentProjectState._nativeAspect = seqTargetAspect;

              currentProjectState._baseW = seqNativeBaseW;
              currentProjectState._baseH = seqNativeBaseH;

              currentProjectState.resolution = seqRes;
              currentProjectState.fps = seqFps;
              currentProjectState.aspectRatio = seqTargetAspect;

              try {
                if (seqFormat === 'zip') {
                  await exportImageSequenceZIP();
                } else if (seqFormat === 'gif') {
                  // GIF: use existing ZIP flow, fallback message for now
                  await exportImageSequenceGIF();
                } else if (seqFormat === 'webp') {
                  await exportImageSequenceWebP();
                }
              } finally {
                currentProjectState.resolution = _origRes2;
                currentProjectState.fps = _origFps2;
                currentProjectState.aspectRatio = _origAspect2;
                if (_origBaseW2 !== undefined) currentProjectState._baseW = _origBaseW2; else delete currentProjectState._baseW;
                if (_origBaseH2 !== undefined) currentProjectState._baseH = _origBaseH2; else delete currentProjectState._baseH;
                delete currentProjectState._nativeBaseW;
                delete currentProjectState._nativeBaseH;
                delete currentProjectState._nativeRes;
                delete currentProjectState._nativeAspect;
              }
              break;
            }

            case 'project': {
              if (typeof exportCurrentProjectOFTSAction === 'function') {
                await exportCurrentProjectOFTSAction();
              }
              break;
            }

            case 'link': {
              await exportProjectToShareLinkAction();
              break;
            }
          }
        });
      }

      // Capture compressed thumbnail (~3-5KB) specifically for cloud storage
      function captureCompressedShareThumbnail() {
        try {
          const canvas = document.getElementById('editor-active-canvas');
          if (!canvas || !canvas.width || !canvas.height) return '';
          const maxDim = 200;
          let w = maxDim;
          let h = Math.max(1, Math.round(maxDim * (canvas.height / canvas.width)));
          if (canvas.height > canvas.width) {
            h = maxDim;
            w = Math.max(1, Math.round(maxDim * (canvas.width / canvas.height)));
          }
          const off = document.createElement('canvas');
          off.width = w; off.height = h;
          const ctx = off.getContext('2d');
          ctx.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim() || 'transparent');
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(canvas, 0, 0, w, h);
          return off.toDataURL('image/jpeg', 0.55) || '';
        } catch (_) {
          return '';
        }
      }

      async function compressThumbnailForShare(thumbDataUrl, maxDim = 200, quality = 0.55) {
        if (!thumbDataUrl || typeof thumbDataUrl !== 'string') return '';
        if (thumbDataUrl.length < 8000 && (thumbDataUrl.startsWith('data:image/jpeg;base64,') || thumbDataUrl.startsWith('data:image/webp;base64,'))) {
          return thumbDataUrl;
        }
        return new Promise((resolve) => {
          try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              try {
                const w = img.naturalWidth || img.width || 200;
                const h = img.naturalHeight || img.height || 112;
                let targetW = maxDim;
                let targetH = Math.max(1, Math.round(maxDim * (h / w)));
                if (h > w) {
                  targetH = maxDim;
                  targetW = Math.max(1, Math.round(maxDim * (w / h)));
                }
                const canvas = document.createElement('canvas');
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim() || 'transparent');
                ctx.fillRect(0, 0, targetW, targetH);
                ctx.drawImage(img, 0, 0, targetW, targetH);
                const compressed = canvas.toDataURL('image/jpeg', quality);
                resolve(compressed || (thumbDataUrl.length <= 30000 ? thumbDataUrl : ''));
              } catch (_) {
                resolve(thumbDataUrl.length <= 30000 ? thumbDataUrl : '');
              }
            };
            img.onerror = () => resolve(thumbDataUrl.length <= 30000 ? thumbDataUrl : '');
            img.src = thumbDataUrl;
          } catch (_) {
            resolve('');
          }
        });
      }
      window.compressThumbnailForShare = compressThumbnailForShare;
      /**
       * Captures an HD 3:4 (900x1200) portrait cropped thumbnail specifically for QR card & Catbox upload
       */
      function captureProjectQRThumbnailHD() {
        try {
          const canvas = document.getElementById('editor-active-canvas');
          if (!canvas || !canvas.width || !canvas.height) return null;
          const W = 900, H = 1200;
          const off = document.createElement('canvas');
          off.width = W;
          off.height = H;
          const ctx = off.getContext('2d');

          ctx.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim() || 'transparent');
          ctx.fillRect(0, 0, W, H);

          const cW = canvas.width;
          const cH = canvas.height;
          const scale = Math.max(W / cW, H / cH);
          const sW = W / scale;
          const sH = H / scale;
          const sX = (cW - sW) / 2;
          const sY = (cH - sH) / 2;

          ctx.drawImage(canvas, sX, sY, sW, sH, 0, 0, W, H);
          return off.toDataURL('image/jpeg', 0.85);
        } catch (_) {
          return null;
        }
      }
      window.captureProjectQRThumbnailHD = captureProjectQRThumbnailHD;

      function dataUrlToBlobHelper(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
        try {
          const arr = dataUrl.split(',');
          const mime = arr[0].match(/:(.*?);/)[1];
          const bstr = atob(arr[1]);
          let n = bstr.length;
          const u8arr = new Uint8Array(n);
          while (n--) u8arr[n] = bstr.charCodeAt(n);
          return new Blob([u8arr], { type: mime });
        } catch (_) {
          return null;
        }
      }

      async function exportProjectToShareLinkAction() {
        if (!window.FishDatabase) {
          alert('Database module not ready.');
          return;
        }

        const showOFTSProgress = (typeof window.showOFTSProgressModal === 'function' ? window.showOFTSProgressModal : (window.FishDatabase && window.FishDatabase.showOFTSProgressModal));
        const updateOFTSProg = (typeof window.updateOFTSProgress === 'function' ? window.updateOFTSProgress : (window.FishDatabase && window.FishDatabase.updateOFTSProgress));
        const hideOFTSProgress = (typeof window.hideOFTSProgressModal === 'function' ? window.hideOFTSProgressModal : (window.FishDatabase && window.FishDatabase.hideOFTSProgressModal));

        // Save current changes first
        if (typeof saveCurrentProjectLayers === 'function') {
          await saveCurrentProjectLayers(true);
        }

        try {
          if (typeof showOFTSProgress === 'function') {
            showOFTSProgress('Sharing Project', 0, 'Packing .ofts bundle...');
          }

          // Pre-capture HD 3:4 (900x1200) thumbnail for archive and Catbox
          const hdThumbDataUrl = captureProjectQRThumbnailHD();
          const hdThumbBlob = hdThumbDataUrl ? dataUrlToBlobHelper(hdThumbDataUrl) : null;

          // 1. Generate package keeping progress modal open (0% - 50%)
          const zipBlob = await window.FishDatabase.exportProjectToOFTS(currentProjectState.id, {
            skipDownload: true,
            keepProgressOpen: true,
            thumbnailBlob: hdThumbBlob
          });

          if (!zipBlob) {
            if (typeof hideOFTSProgress === 'function') hideOFTSProgress();
            return;
          }

          // Check project size limit (15MB)
          const MAX_SHARE_SIZE = 15 * 1024 * 1024; // 15MB
          if (zipBlob.size > MAX_SHARE_SIZE) {
            if (typeof hideOFTSProgress === 'function') hideOFTSProgress();
            const formattedSize = window.FishDatabase ? window.FishDatabase.formatBytes(zipBlob.size) : `${(zipBlob.size / (1024 * 1024)).toFixed(1)} MB`;
            const shouldSaveLocal = confirm(
              `Project size (${formattedSize}) exceeds the 15MB share limit.\n\n` +
              `Cloud link sharing is limited to 15MB. Please save the project directly to your local device (.ofts).\n\n` +
              `Download project to your device now?`
            );
            if (shouldSaveLocal) {
              if (window.FishDatabase && typeof window.FishDatabase.exportProjectToOFTS === 'function') {
                await window.FishDatabase.exportProjectToOFTS(currentProjectState.id);
              }
            }
            return;
          }

          if (typeof updateOFTSProg === 'function') {
            updateOFTSProg(50, 'Package prepared. Connecting to cloud storage...');
          }

          // 2. Guarantee ultra-compressed fallback thumbnail (~3-5KB)
          let thumb = captureCompressedShareThumbnail();
          if (!thumb && currentProjectState.thumbnail) {
            if (typeof window.compressThumbnailForShare === 'function') {
              thumb = await window.compressThumbnailForShare(currentProjectState.thumbnail);
            } else {
              thumb = currentProjectState.thumbnail.slice(0, 30000);
            }
          }

          // 3. Send to API (/api/share) with live upload progress (50% - 95%)
          const fd = new FormData();
          fd.append('file', zipBlob, (currentProjectState.name || 'Project') + '.ofts');
          if (hdThumbBlob) {
            fd.append('thumbnailFile', hdThumbBlob, `${(currentProjectState.name || 'Project').replace(/[^a-zA-Z0-9_-]/g, '_')}_thumb.jpg`);
          }
          fd.append('name', currentProjectState.name || 'Untitled Project');
          fd.append('specs', `${currentProjectState.resolution || '1080p'} • ${currentProjectState.fps || 60} fps`);
          fd.append('aspectRatio', currentProjectState.aspectRatio || '16:9');
          fd.append('size', window.FishDatabase ? window.FishDatabase.formatBytes(zipBlob.size) : '1.0 MB');
          fd.append('thumbnail', thumb);

          const json = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const shareEndpoint = (window.location.protocol === 'file:' || (window.location.hostname && window.location.hostname !== 'studio.cutefish.my.id' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'))
              ? 'https://studio.cutefish.my.id/api/share'
              : '/api/share';
            xhr.open('POST', shareEndpoint, true);
            const shareToken = localStorage.getItem('oft_share_token');
            if (shareToken) {
              xhr.setRequestHeader('x-share-token', shareToken);
            }
            xhr.timeout = 20000; // 20 seconds timeout prevents hanging

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable && e.total > 0) {
                const uploadPct = 50 + Math.round((e.loaded / e.total) * 45); // 50% -> 95%
                const pctUploadOnly = Math.round((e.loaded / e.total) * 100);
                if (typeof updateOFTSProg === 'function') {
                  updateOFTSProg(uploadPct, `Uploading to storage (${pctUploadOnly}%)...`);
                }
              }
            };

            xhr.onload = () => {
              if (xhr.status !== 200) {
                let errText = `Server returned status ${xhr.status}`;
                try {
                  const errJson = JSON.parse(xhr.responseText);
                  if (errJson && errJson.error) errText = errJson.error;
                } catch (_) {}
                reject(new Error(errText));
                return;
              }

              try {
                if (typeof updateOFTSProg === 'function') {
                  updateOFTSProg(98, 'Generating QR code & short link...');
                }
                const res = JSON.parse(xhr.responseText);
                resolve(res);
              } catch (err) {
                reject(new Error('Invalid response from server'));
              }
            };

            xhr.ontimeout = () => {
              reject(new Error('Cloud upload timed out (20s). Storage service is slow or unresponsive.'));
            };

            xhr.onerror = () => reject(new Error('Network error connecting to share service'));
            xhr.send(fd);
          });

          if (!json.success || !json.shareUrl) {
            if (typeof hideOFTSProgress === 'function') hideOFTSProgress();
            alert('Share upload failed: ' + (json.error || 'Server error'));
            return;
          }

          if (typeof updateOFTSProg === 'function') {
            updateOFTSProg(100, 'Ready!');
          }
          await new Promise(r => setTimeout(r, 280));

          if (typeof hideOFTSProgress === 'function') {
            hideOFTSProgress();
          }

          // Save to persistent uploaded projects storage
          if (window.FishDatabase && typeof window.FishDatabase.saveUploadedProject === 'function') {
            const rec = json.record || {};
            window.FishDatabase.saveUploadedProject({
              id: String(json.id || rec.id),
              name: rec.name || currentProjectState.name || 'Untitled Project',
              specs: rec.specs || `${currentProjectState.resolution || '1080p'} • ${currentProjectState.fps || 60} fps`,
              size: rec.size || (window.FishDatabase ? window.FishDatabase.formatBytes(zipBlob.size) : '1.0 MB'),
              aspectRatio: rec.aspectRatio || currentProjectState.aspectRatio || '16:9',
              thumbnail: rec.thumbnail || thumb || '',
              shareUrl: json.shareUrl,
              fileUrl: rec.fileUrl || json.catboxUrl || '',
              createdAt: rec.createdAt || Date.now()
            });
          }

          // 4. Open QR Share Modal with real shortlink and metadata
          await openQRShareModal(json.shareUrl, json.record || json);
        } catch (err) {
          console.error('[FishExport:Link]', err);
          const errMsg = err && (err.message || String(err));
          if (errMsg && errMsg.includes('15MB')) {
            const shouldSaveLocal = confirm(
              `${errMsg}\n\nDownload project to your device (.ofts) now?`
            );
            if (shouldSaveLocal) {
              if (window.FishDatabase && typeof window.FishDatabase.exportProjectToOFTS === 'function') {
                await window.FishDatabase.exportProjectToOFTS(currentProjectState.id);
              }
            }
          } else if (errMsg && errMsg.includes('Token tidak ada')) {
            if (typeof showEditorToast === 'function') {
              showEditorToast('Token tidak ada, cek .env mu');
            } else {
              alert('Token tidak ada, cek .env mu');
            }
          } else {
            alert('Failed to generate project link: ' + errMsg);
          }
        } finally {
          window.isExporting = false;
          if (typeof document !== 'undefined') {
            document.body.classList.remove('is-exporting');
            const progModal = document.getElementById('modal-ofts-progress');
            if (progModal) progModal.classList.remove('is-active');
          }
          if (typeof hideOFTSProgress === 'function') {
            hideOFTSProgress();
          }
          if (typeof updatePlayButtonUI === 'function') {
            try { updatePlayButtonUI(); } catch (_) {}
          }
        }
      }
      window.exportProjectToShareLinkAction = exportProjectToShareLinkAction;

      // ---- Image Sequence: GIF export (animated GIF via canvas) ----
      async function exportImageSequenceGIF() {
        // GIF export requires external library; fallback to ZIP with notice
        showExportProgress('GIF export', 0, 'Exporting sequence as ZIP...');
        await new Promise(r => setTimeout(r, 800));
        hideExportProgress();
        await exportImageSequenceZIP();
      }

      // ---- Image Sequence: animated WebP export ----
      async function exportImageSequenceWebP() {
        // Animated WebP: export frames as individual webp blobs → zip for now
        if (window.isExporting) return;
        if (typeof JSZip === 'undefined') { alert('JSZip not available.'); return; }

        showExportProgress('Exporting WebP sequence', 0, 'Preparing sequence...');
        isExportCancelled = false;
        window.isExportCancelled = false;
        window.isExporting = true;

        const cacheOk = await ensureAllVideosCached();
        if (!cacheOk || isExportCancelled || !window.isExporting) { hideExportProgress(); return; }

        try {
          const fps = parseInt(currentProjectState.fps || 60, 10);
          const totalDur = Math.max(0.5, typeof window.getProjectTotalDuration === 'function' ? window.getProjectTotalDuration() : (currentProjectState.defaultDuration || 5));
          const totalFrames = Math.max(1, Math.round(totalDur * fps));
          const aspect = currentProjectState.aspectRatio || '16:9';
          const res = currentProjectState.resolution || '1080p';
          const baseDims = window.getProjectDimensions(res, aspect);
          const [baseW, baseH] = baseDims;

          const exportCanvas = document.createElement('canvas');
          exportCanvas.width = baseW;
          exportCanvas.height = baseH;
          const zip = new JSZip();
          const videoLayers = (currentProjectState.layers || []).filter(l => l.type === 'video' && !l.hidden);
          const pps = window.currentPixelsPerSecond || 80;

          for (let i = 0; i < totalFrames; i++) {
            if (isExportCancelled || !window.isExporting) return;
            const t = i / fps;
            await prepareVideoFramesForTime(t, videoLayers, pps);
            renderCanvasFrame(exportCanvas, currentProjectState.bgColor, baseW, baseH, 'export-seq', t);
            if (i === 0 || i % 3 === 0 || i === totalFrames - 1) {
              drawExportProgressPreview(exportCanvas);
            }
            const blob = await new Promise(r => exportCanvas.toBlob(r, 'image/webp', 0.92));
            if (!blob) continue;
            const buf = await blob.arrayBuffer();
            zip.file(`frame_${String(i).padStart(6, '0')}.webp`, buf);
            updateExportProgress(Math.round(((i + 1) / totalFrames) * 100), `Frame ${i + 1} / ${totalFrames}`);
            await new Promise(r => setTimeout(r, 0));
          }

          if (!isExportCancelled && window.isExporting) {
            updateExportProgress(99, 'Compressing...');
            const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${(currentProjectState.name || 'Project').replace(/[^a-zA-Z0-9_-]/g, '_')}_webp_sequence.zip`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
          }
        } catch (err) {
          console.error('[Export:WebP]', err);
        } finally {
          window.isExporting = false;
          hideExportProgress();
        }
      }

      // ---- QR Share Modal ----
      let _qrShareUrl = '';
      let _cachedQRCardDataUrl = '';

      function drawImageCover(ctx, img, targetX, targetY, targetW, targetH) {
        const imgW = img.videoWidth || img.naturalWidth || img.width;
        const imgH = img.videoHeight || img.naturalHeight || img.height;
        if (!imgW || !imgH) return;
        const imgRatio = imgW / imgH;
        const targetRatio = targetW / targetH;
        let sX = 0, sY = 0, sW = imgW, sH = imgH;
        if (imgRatio > targetRatio) {
          sW = imgH * targetRatio;
          sX = (imgW - sW) / 2;
        } else {
          sH = imgW / targetRatio;
          sY = (imgH - sH) / 2;
        }
        ctx.drawImage(img, sX, sY, sW, sH, targetX, targetY, targetW, targetH);
      }

      async function generateQRCardCanvas(shareUrl, record) {
        const W = 900, H = 1200;
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d');

        // 1. Base dark background
        ctx.fillStyle = '#0d1109';
        ctx.fillRect(0, 0, W, H);

        // 2. Background thumbnail (COVER aspect ratio, NEVER stretched)
        let thumbSrc = (record && record.thumbnail) || null;
        if (!thumbSrc && typeof captureProjectQRThumbnailHD === 'function') {
          try { thumbSrc = captureProjectQRThumbnailHD(); } catch (_) {}
        }
        if (!thumbSrc && currentProjectState && currentProjectState.thumbnail) {
          thumbSrc = currentProjectState.thumbnail;
        }

        if (thumbSrc && typeof thumbSrc === 'string') {
          try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            await new Promise((res, rej) => {
              img.onload = res;
              img.onerror = rej;
              img.src = thumbSrc;
            });
            ctx.save();
            ctx.globalAlpha = 0.40;
            drawImageCover(ctx, img, 0, 0, W, H);
            ctx.restore();
          } catch (_) {}
        }

        // Dark gradient-free overlay on thumbnail to guarantee high contrast
        ctx.fillStyle = 'rgba(13, 17, 9, 0.75)';
        ctx.fillRect(0, 0, W, H);

        // Card border inside canvas
        ctx.strokeStyle = '#222d1b';
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, W - 6, H - 6);

        // 3. Header: Project Name (Centered, Cal Sans, truncated with ellipsis if long)
        ctx.fillStyle = '#98ce7b';
        ctx.font = 'bold 46px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let pName = (record && record.name) || (currentProjectState && currentProjectState.name) || 'Untitled Project';
        pName = String(pName).trim();
        if (ctx.measureText(pName).width > 740) {
          while (pName.length > 3 && ctx.measureText(pName + '…').width > 740) {
            pName = pName.slice(0, -1);
          }
          pName += '…';
        }
        ctx.fillText(pName, W / 2, 95);

        // Header Subtitle: Specs & Resolution metadata
        let specsText = '';
        if (record && (record.specs || record.size)) {
          specsText = [record.specs, record.size].filter(Boolean).join(' • ');
        } else if (currentProjectState) {
          specsText = `${currentProjectState.resolution || '1080p'} • ${currentProjectState.fps || 60} fps`;
        }
        if (specsText) {
          ctx.fillStyle = '#8fa886';
          ctx.font = '500 23px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
          ctx.fillText(specsText, W / 2, 145);
        }

        // 4. QR Code Box (White container card with rounded corners, prominent & scannable)
        const qrBoxSize = 640;
        const qrBoxX = (W - qrBoxSize) / 2; // 130
        const qrBoxY = 195;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 32);
        } else {
          ctx.rect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize);
        }
        ctx.fill();

        // Draw QR code from scratch element
        const qrWrap = document.getElementById('qr-share-qr-wrap');
        const qrCanvas = qrWrap ? qrWrap.querySelector('canvas') : null;
        const qrImg = qrWrap ? qrWrap.querySelector('img') : null;
        const pad = 36;
        const qrInnerSize = qrBoxSize - pad * 2; // 568

        if (qrCanvas) {
          ctx.drawImage(qrCanvas, qrBoxX + pad, qrBoxY + pad, qrInnerSize, qrInnerSize);
        } else if (qrImg && qrImg.complete && qrImg.naturalWidth > 0) {
          ctx.drawImage(qrImg, qrBoxX + pad, qrBoxY + pad, qrInnerSize, qrInnerSize);
        } else {
          ctx.fillStyle = '#000000';
          ctx.font = 'bold 22px monospace';
          ctx.fillText(shareUrl, W / 2, qrBoxY + qrBoxSize / 2);
        }

        // 5. Action Instruction Prompt
        ctx.fillStyle = '#c0dbc0';
        ctx.font = '600 23px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Scan with camera to import project', W / 2, 905);

        // 6. Branding Footer: Premium Capsule Pill Badge (App Icon + "FishTools Studio")
        let iconLoaded = false;
        const appIcon = new Image();
        try {
          await new Promise((res, rej) => {
            appIcon.onload = res;
            appIcon.onerror = rej;
            appIcon.src = 'assets/icon-192.png';
          });
          iconLoaded = true;
        } catch (_) {
          try {
            await new Promise((res, rej) => {
              appIcon.onload = res;
              appIcon.onerror = rej;
              appIcon.src = 'assets/icon.svg';
            });
            iconLoaded = true;
          } catch (_) {}
        }

        const brandPillY = 1015;
        const brandPillH = 72;
        const iconSize = 44;
        const gap = 16;
        const brandText = 'FishTools Studio';

        ctx.font = 'bold 30px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
        const textW = ctx.measureText(brandText).width;
        const innerW = (iconLoaded ? iconSize + gap : 0) + textW;
        const pillPaddingX = 32;
        const pillW = innerW + pillPaddingX * 2;
        const pillX = (W - pillW) / 2;
        const pillY = brandPillY - brandPillH / 2;

        // Draw pill container
        ctx.fillStyle = '#151c12';
        ctx.strokeStyle = '#2d3e26';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(pillX, pillY, pillW, brandPillH, brandPillH / 2);
        } else {
          ctx.rect(pillX, pillY, pillW, brandPillH);
        }
        ctx.fill();
        ctx.stroke();

        // Draw icon & text inside pill
        const contentStartX = pillX + pillPaddingX;
        if (iconLoaded) {
          ctx.save();
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(contentStartX, brandPillY - iconSize / 2, iconSize, iconSize, 10);
          } else {
            ctx.rect(contentStartX, brandPillY - iconSize / 2, iconSize, iconSize);
          }
          ctx.clip();
          ctx.drawImage(appIcon, contentStartX, brandPillY - iconSize / 2, iconSize, iconSize);
          ctx.restore();
        }

        const textStartX = iconLoaded ? contentStartX + iconSize + gap : contentStartX;
        ctx.fillStyle = '#98ce7b';
        ctx.font = 'bold 30px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(brandText, textStartX, brandPillY);

        return c;
      }

      async function openQRShareModal(shareUrl, record) {
        window.isExporting = false;
        if (typeof document !== 'undefined') document.body.classList.remove('is-exporting');
        if (typeof updatePlayButtonUI === 'function') {
          try { updatePlayButtonUI(); } catch (_) {}
        }
        const backdrop = document.getElementById('qr-share-backdrop');
        if (!backdrop) return;

        _qrShareUrl = shareUrl || `${window.location.origin}/1`;

        // 1. Generate QR code in hidden container with 500px resolution
        const qrWrap = document.getElementById('qr-share-qr-wrap');
        if (qrWrap) {
          if (!window.QRCode) {
            await new Promise(r => setTimeout(r, 400));
          }
          generateQRToElement(_qrShareUrl, qrWrap, 500);
          await new Promise(r => setTimeout(r, 80));
        }

        const cardContainer = backdrop.querySelector('.qr-share-card');
        const renderedImg = document.getElementById('qr-share-rendered-img');
        if (cardContainer) cardContainer.classList.add('skeleton-loading');
        if (renderedImg) renderedImg.classList.add('is-hidden');

        backdrop.classList.add('is-active');

        // 2. Render pixel-perfect WYSIWYG canvas and bind directly to image preview
        try {
          const cardCanvas = await generateQRCardCanvas(_qrShareUrl, record);
          _cachedQRCardDataUrl = cardCanvas.toDataURL('image/png');
          if (renderedImg) {
            renderedImg.src = _cachedQRCardDataUrl;
            renderedImg.onload = () => {
              if (cardContainer) cardContainer.classList.remove('skeleton-loading');
              renderedImg.classList.remove('is-hidden');
            };
            if (renderedImg.complete) {
              if (cardContainer) cardContainer.classList.remove('skeleton-loading');
              renderedImg.classList.remove('is-hidden');
            }
          }
        } catch (err) {
          console.error('[FishExport:QRCard]', err);
          if (cardContainer) cardContainer.classList.remove('skeleton-loading');
          if (renderedImg) renderedImg.classList.remove('is-hidden');
        }
      }

      // QR close button & backdrop outside click
      const _qrCloseBtn = document.getElementById('qr-btn-close');
      if (_qrCloseBtn) {
        _qrCloseBtn.addEventListener('click', () => {
          const backdrop = document.getElementById('qr-share-backdrop');
          if (backdrop) backdrop.classList.remove('is-active');
        });
      }

      const _qrBackdropEl = document.getElementById('qr-share-backdrop');
      if (_qrBackdropEl) {
        _qrBackdropEl.addEventListener('click', (e) => {
          if (e.target === _qrBackdropEl) {
            _qrBackdropEl.classList.remove('is-active');
          }
        });
      }

      // Editor Toast Notification
      let _editorToastTimer = null;
      function showEditorToast(text, duration = 2200, type = 'info') {
        let toast = document.querySelector('.editor-toast');
        if (!toast) {
          toast = document.createElement('div');
          toast.className = 'editor-toast';
          document.body.appendChild(toast);
        }
        toast.textContent = text;
        if (type === 'error' || type === 'warn') {
          toast.classList.add('toast-error');
        } else {
          toast.classList.remove('toast-error');
        }
        toast.classList.add('is-visible');
        if (_editorToastTimer) clearTimeout(_editorToastTimer);
        _editorToastTimer = setTimeout(() => {
          toast.classList.remove('is-visible');
          toast.classList.remove('toast-error');
        }, duration);
      }
      window.showEditorToast = showEditorToast;
      if (typeof window.showDashboardToast !== 'function') {
        window.showDashboardToast = showEditorToast;
      }


      // QR Copy button
      const _qrCopyBtn = document.getElementById('qr-btn-copy');
      if (_qrCopyBtn) {
        _qrCopyBtn.addEventListener('click', async () => {
          if (_qrShareUrl) {
            const cleanUrl = _qrShareUrl.replace(/^https?:\/\//i, '');
            try {
              await navigator.clipboard.writeText(cleanUrl);
              const origTitle = _qrCopyBtn.title;
              _qrCopyBtn.title = 'Copied!';
              showEditorToast('Link copied to clipboard!');
              setTimeout(() => { _qrCopyBtn.title = origTitle; }, 1800);
            } catch (_) {
              try {
                const ta = document.createElement('textarea');
                ta.value = cleanUrl;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                showEditorToast('Link copied to clipboard!');
              } catch (_) {}
            }
          }
        });
      }

      // QR Download button — directly downloads the rendered canvas image
      const _qrDownloadBtn = document.getElementById('qr-btn-download');
      if (_qrDownloadBtn) {
        _qrDownloadBtn.addEventListener('click', () => {
          if (!_cachedQRCardDataUrl) return;
          const a = document.createElement('a');
          a.href = _cachedQRCardDataUrl;
          const name = (currentProjectState && currentProjectState.name) || 'Project';
          a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_QR.png`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { document.body.removeChild(a); }, 1000);
        });
      }

      // Legacy backward-compat: btn-export-png still works if exists
      const btnExportPNGLegacy = document.getElementById('btn-export-png');
      if (btnExportPNGLegacy) {
        btnExportPNGLegacy.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          exportCurrentFrameAsPNG();
        });
      }

      // Legacy backward-compat: btn-export-video still works if exists
      const btnExportVideoLegacy = document.getElementById('btn-export-video');
      if (btnExportVideoLegacy) {
        btnExportVideoLegacy.addEventListener('click', (e) => {
          e.preventDefault();
          exportVideoMP4('normal');
        });
      }
    })();
  })();


    // Global UI Protection: Disable Ctrl + Wheel Browser Zoom to avoid distorting editor panes & preview canvas
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey && !e.target.closest('#editor-preview-container')) {
        e.preventDefault();
      }
    }, { passive: false });

    // Welcome and Donate modal helpers in editor
    window.closeWelcomeModal = function() {
      const checkbox = document.getElementById('welcome-dismiss-checkbox');
      if (checkbox && checkbox.checked) {
        try { localStorage.setItem('oft_seen_welcome_v1', '1'); } catch (_) {}
      }
      if (window.Modal) window.Modal.close();
    };

    window.openDonateFromWelcome = function() {
      const checkbox = document.getElementById('welcome-dismiss-checkbox');
      if (checkbox && checkbox.checked) {
        try { localStorage.setItem('oft_seen_welcome_v1', '1'); } catch (_) {}
      }
      if (window.Modal) window.Modal.open('modal-donate');
    };

    window.toggleQrisDisplay = function() {
      const content = document.getElementById('donate-qris-content');
      const arrow = document.getElementById('qris-arrow-icon');
      if (!content) return;
      const isHidden = content.style.display === 'none' || !content.style.display;
      if (isHidden) {
        content.style.display = 'flex';
        if (arrow) arrow.classList.add('is-open');
      } else {
        content.style.display = 'none';
        if (arrow) arrow.classList.remove('is-open');
      }
    };

    // =========================================================================
    // Preview AI Matting Progress Single Morphing Widget (Circle -> Card)
    // =========================================================================
    function initPreviewMattingWidget() {
      const widget = document.getElementById('preview-matting-widget');
      const percentEl = document.getElementById('preview-matting-percent');
      const ringFill = document.getElementById('preview-matting-ring-fill');
      const list = document.getElementById('matting-widget-list');
      const closeBtn = document.getElementById('matting-widget-close');

      if (!widget) return;

      let isExpanded = false;

      function expandWidget() {
        if (isExpanded) return;
        isExpanded = true;
        widget.classList.add('is-expanded');
      }

      function collapseWidget() {
        isExpanded = false;
        widget.classList.remove('is-expanded');
      }

      widget.addEventListener('click', (e) => {
        if (!isExpanded) {
          e.stopPropagation();
          expandWidget();
        }
      });

      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
          }
          collapseWidget();
          widget.classList.add('hidden');
        });
      }

      document.addEventListener('click', (e) => {
        if (isExpanded && !widget.contains(e.target)) {
          collapseWidget();
        }
      });

      let hideTimeout = null;

      function getAllActiveTasks() {
        const bgTasks = (window.FishBgRemovalEngine && typeof window.FishBgRemovalEngine.getActiveTasks === 'function')
          ? window.FishBgRemovalEngine.getActiveTasks().filter(t => !t.cancelled)
          : [];
        const bakeTasks = (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.getAllBakingTasks === 'function')
          ? window.VideoFrameExtractor.getAllBakingTasks().filter(t => !t.cancelled)
          : ((window.VideoFrameExtractor && typeof window.VideoFrameExtractor.getActiveTasks === 'function')
            ? window.VideoFrameExtractor.getActiveTasks().filter(t => !t.cancelled)
            : []);
        return [...bakeTasks, ...bgTasks];
      }

      function updateUI() {
        const activeTasks = getAllActiveTasks();
        const inProgressTasks = activeTasks.filter(t => {
          return !t.cancelled && t.percent < 100 && t.status !== 'done' && t.status !== 'Ready' && !String(t.status).includes('100% Ready');
        });

        if (activeTasks.length === 0) {
          widget.classList.add('hidden');
          if (isExpanded) collapseWidget();
          return;
        }

        // If no tasks in progress and widget is already hidden, keep it hidden
        if (inProgressTasks.length === 0 && widget.classList.contains('hidden')) {
          return;
        }

        // Auto-dismiss when everything is 100% complete
        if (inProgressTasks.length === 0) {
          if (!hideTimeout) {
            hideTimeout = setTimeout(() => {
              collapseWidget();
              widget.classList.add('hidden');
              hideTimeout = null;
            }, 3000);
          }
        } else {
          if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
          }
          widget.classList.remove('hidden');
        }

        const displayPct = inProgressTasks.length > 0
          ? Math.round(inProgressTasks.reduce((sum, t) => sum + (t.percent || 0), 0) / inProgressTasks.length)
          : 100;

        if (percentEl) {
          percentEl.textContent = `${displayPct}%`;
        }

        if (ringFill) {
          const circumference = 84.823;
          const offset = circumference * (1 - Math.max(0, Math.min(100, displayPct)) / 100);
          ringFill.style.strokeDashoffset = offset;
        }

        widget.title = `${activeTasks.length} task(s) (${displayPct}%) - Click to expand`;

        if (!list) return;
        list.innerHTML = '';

        activeTasks.forEach(task => {
          const row = document.createElement('div');
          row.className = 'matting-task-row';

          const isDone = (task.percent >= 100 || task.status === 'done' || task.status === 'Ready' || String(task.status).includes('100% Ready'));
          let statusText = '';

          if (task.status && task.status.startsWith('Downloading model')) {
            statusText = task.status;
          } else if (task.status === 'downloading_model') {
            statusText = 'Downloading model...';
          } else if (task.type === 'baking' || task.type === 'video_bake') {
            statusText = isDone ? 'Video Baked (100% Ready)' : (task.status || `Baking frames: ${task.currentFrame || 0}/${task.totalFrames || 0} (${task.percent || 0}%)`);
          } else if (task.type === 'video') {
            statusText = task.status && task.status.includes('Waiting')
              ? task.status
              : (isDone ? 'Background Removed (100% Ready)' : `Removing BG: Frame ${task.currentFrame || 0}/${task.totalFrames || 0} (${task.percent || 0}%)`);
          } else {
            statusText = isDone ? 'Background Removed (100% Ready)' : `Processing (${task.percent || 0}%)`;
          }

          const actionHtml = isDone
            ? `<span class="matting-task-done-badge" style="color:var(--color-primary);font-size:12px;display:flex;align-items:center;" title="Complete">
                 <i class='fticon fticon-check' aria-hidden='true'></i>
               </span>`
            : `<button type="button" class="matting-task-cancel" title="Cancel" data-task-id="${task.id}">
                 <i class='fticon fticon-close' style='width:12px;height:12px;font-size:12px;line-height:1;' aria-hidden='true'></i>
               </button>`;

          row.innerHTML = `
            <div class="matting-task-meta">
              <span class="matting-task-name">${task.layerName || 'Media'}</span>
              ${actionHtml}
            </div>
            <div class="matting-task-status">${statusText}</div>
            <div class="matting-task-bar">
              <div class="matting-task-fill" style="width: ${isDone ? 100 : (task.percent || 0)}%;"></div>
            </div>
          `;

          const cancelBtn = row.querySelector('.matting-task-cancel');
          if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (task.type === 'baking' || task.type === 'video_bake') {
                if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.cancelTask === 'function') {
                  window.VideoFrameExtractor.cancelTask(task.id);
                }
              } else if (window.FishBgRemovalEngine) {
                window.FishBgRemovalEngine.cancelTask(task.id);
              }
            });
          }

          list.appendChild(row);
        });
      }

      if (window.FishBgRemovalEngine && typeof window.FishBgRemovalEngine.addProgressListener === 'function') {
        window.FishBgRemovalEngine.addProgressListener(updateUI);
      }
      if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.addProgressListener === 'function') {
        window.VideoFrameExtractor.addProgressListener(updateUI);
      }
      updateUI();
    }
    window.initPreviewMattingWidget = initPreviewMattingWidget;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initPreviewMattingWidget);
    } else {
      initPreviewMattingWidget();
    }
})();
