
    (function initTimelineSplitResizer() {
      function syncTimelineAfterSplitResize() {
        fitPreviewCanvasBox();
        const layersVp = document.getElementById('timeline-layers-viewport');
        if (layersVp && layersVp.scrollLeft !== 0) {
          layersVp.scrollLeft = 0;
        }
        if (typeof window.updateTimelinePosition === 'function') {
          window.updateTimelinePosition(window.timelinePanX || 0, true);
        }
        if (window.PreviewCacheManager) {
          window.PreviewCacheManager.updateRulerUI();
        }
      }
      window.syncTimelineAfterSplitResize = syncTimelineAfterSplitResize;

      const handle = document.getElementById('timeline-split-handle');
      const mobileHandle = document.getElementById('preview-split-handle');
      const mainBody = document.querySelector('.editor-main-body');
      const leftPane = document.querySelector('.editor-left-pane');
      if (!mainBody) return;

      function isStackedMobileLayout() {
        return window.innerWidth <= 600 ||
          document.documentElement.classList.contains('force-mobile-view') ||
          (document.body && document.body.classList.contains('force-mobile-view'));
      }

      try {
        const savedWidth = localStorage.getItem('oft_left_pane_width');
        if (savedWidth && !isStackedMobileLayout()) {
          mainBody.style.setProperty('--left-pane-width', savedWidth);
          document.documentElement.style.setProperty('--left-pane-width', savedWidth);
        }
        const savedMobileH = localStorage.getItem('oft_mobile_preview_height');
        if (savedMobileH && isStackedMobileLayout()) {
          mainBody.style.setProperty('--mobile-preview-height', savedMobileH);
        }
        syncTimelineAfterSplitResize();
      } catch (_) {}

      // --- Desktop Vertical Split Handle (>= 601px when not in Always Mobile) ---
      if (handle) {
        let isDragging = false;
        let mainBodyW = 0;
        let mainBodyLeft = 0;
        let currentPercent = 50;
        let desktopRAF = null;

        function onPointerDown(e) {
          if (isStackedMobileLayout()) return; // Handled by mobileHandle
          isDragging = true;
          const rect = mainBody.getBoundingClientRect();
          mainBodyW = rect.width || 1;
          mainBodyLeft = rect.left || 0;
          handle.classList.add('is-dragging');
          handle.setPointerCapture(e.pointerId);
          document.body.style.cursor = 'col-resize';
          e.preventDefault();
        }

        function onPointerMove(e) {
          if (!isDragging) return;
          const offsetX = e.clientX - mainBodyLeft;
          currentPercent = Math.max(20, Math.min(80, (offsetX / mainBodyW) * 100));

          if (!desktopRAF) {
            desktopRAF = requestAnimationFrame(() => {
              desktopRAF = null;
              if (!isDragging) return;
              const wStr = currentPercent.toFixed(2) + '%';
              mainBody.style.setProperty('--left-pane-width', wStr);
              document.documentElement.style.setProperty('--left-pane-width', wStr);
            });
          }
        }

        function onPointerUp(e) {
          if (!isDragging) return;
          isDragging = false;
          if (desktopRAF) {
            cancelAnimationFrame(desktopRAF);
            desktopRAF = null;
          }
          handle.classList.remove('is-dragging');
          try {
            handle.releasePointerCapture(e.pointerId);
          } catch (_) {}
          document.body.style.cursor = '';

          const wStr = currentPercent.toFixed(2) + '%';
          mainBody.style.setProperty('--left-pane-width', wStr);
          document.documentElement.style.setProperty('--left-pane-width', wStr);
          try {
            localStorage.setItem('oft_left_pane_width', wStr);
          } catch (_) {}
          syncTimelineAfterSplitResize();
        }

        handle.addEventListener('pointerdown', onPointerDown);
        handle.addEventListener('pointermove', onPointerMove, { passive: true });
        handle.addEventListener('pointerup', onPointerUp);
        handle.addEventListener('pointercancel', onPointerUp);

        // Keyboard arrow key support for accessibility
        handle.addEventListener('keydown', (e) => {
          if (isStackedMobileLayout()) return;
          const currentStyle = getComputedStyle(mainBody).getPropertyValue('--left-pane-width').trim();
          let currentPercent = parseFloat(currentStyle) || 50;

          if (e.key === 'ArrowLeft') {
            currentPercent = Math.max(20, currentPercent - 5);
            const wStr = currentPercent + '%';
            mainBody.style.setProperty('--left-pane-width', wStr);
            document.documentElement.style.setProperty('--left-pane-width', wStr);
            try {
              localStorage.setItem('oft_left_pane_width', wStr);
            } catch (_) {}
            syncTimelineAfterSplitResize();
            e.preventDefault();
          } else if (e.key === 'ArrowRight') {
            currentPercent = Math.min(80, currentPercent + 5);
            const wStr = currentPercent + '%';
            mainBody.style.setProperty('--left-pane-width', wStr);
            document.documentElement.style.setProperty('--left-pane-width', wStr);
            try {
              localStorage.setItem('oft_left_pane_width', wStr);
            } catch (_) {}
            syncTimelineAfterSplitResize();
            e.preventDefault();
          }
        });
      }

      // --- Mobile Horizontal Preview Split Handle (<= 600px or Always Mobile) ---
      if (mobileHandle) {
        let isMobileDragging = false;
        let startY = 0;
        let startH = 0;
        let mainBodyH = 0;
        let currentPercent = 55;
        let mobileRAF = null;

        function onMobilePointerDown(e) {
          if (!isStackedMobileLayout()) return;
          isMobileDragging = true;
          startY = e.clientY;
          const bodyRect = mainBody.getBoundingClientRect();
          mainBodyH = bodyRect.height || 1;
          const currentRect = leftPane ? leftPane.getBoundingClientRect() : null;
          startH = currentRect ? currentRect.height : (mainBodyH * 0.55);
          mobileHandle.classList.add('is-dragging');
          mobileHandle.setPointerCapture(e.pointerId);
          document.body.style.cursor = 'row-resize';
          e.preventDefault();
        }

        function onMobilePointerMove(e) {
          if (!isMobileDragging) return;
          const deltaY = e.clientY - startY;
          const minH = 120;
          const maxH = Math.max(minH, mainBodyH - 140);
          const clampedH = Math.max(minH, Math.min(maxH, startH + deltaY));
          currentPercent = (clampedH / mainBodyH) * 100;

          if (!mobileRAF) {
            mobileRAF = requestAnimationFrame(() => {
              mobileRAF = null;
              if (!isMobileDragging) return;
              mainBody.style.setProperty('--mobile-preview-height', currentPercent.toFixed(2) + '%');
            });
          }
        }

        function onMobilePointerUp(e) {
          if (!isMobileDragging) return;
          isMobileDragging = false;
          if (mobileRAF) {
            cancelAnimationFrame(mobileRAF);
            mobileRAF = null;
          }
          mobileHandle.classList.remove('is-dragging');
          try {
            mobileHandle.releasePointerCapture(e.pointerId);
          } catch (_) {}
          document.body.style.cursor = '';

          // Apply final height & commit to localStorage once
          mainBody.style.setProperty('--mobile-preview-height', currentPercent.toFixed(2) + '%');
          try {
            localStorage.setItem('oft_mobile_preview_height', currentPercent.toFixed(2) + '%');
          } catch (_) {}

          // Final sync of canvas buffers and timeline layout
          syncTimelineAfterSplitResize();
        }

        mobileHandle.addEventListener('pointerdown', onMobilePointerDown);
        mobileHandle.addEventListener('pointermove', onMobilePointerMove, { passive: true });
        mobileHandle.addEventListener('pointerup', onMobilePointerUp);
        mobileHandle.addEventListener('pointercancel', onMobilePointerUp);

        // Keyboard arrow key support for mobile handle
        mobileHandle.addEventListener('keydown', (e) => {
          if (!isStackedMobileLayout()) return;
          const currentStyle = getComputedStyle(mainBody).getPropertyValue('--mobile-preview-height').trim();
          let currentPercent = parseFloat(currentStyle) || 55;

          if (e.key === 'ArrowDown') {
            currentPercent = Math.min(78, currentPercent + 5);
            mainBody.style.setProperty('--mobile-preview-height', currentPercent + '%');
            try {
              localStorage.setItem('oft_mobile_preview_height', currentPercent + '%');
            } catch (_) {}
            syncTimelineAfterSplitResize();
            e.preventDefault();
          } else if (e.key === 'ArrowUp') {
            currentPercent = Math.max(22, currentPercent - 5);
            mainBody.style.setProperty('--mobile-preview-height', currentPercent + '%');
            try {
              localStorage.setItem('oft_mobile_preview_height', currentPercent + '%');
            } catch (_) {}
            syncTimelineAfterSplitResize();
            e.preventDefault();
          }
        });
      }

      // Restore layout on viewport change
      window.addEventListener('resize', () => {
        if (!isStackedMobileLayout()) {
          const savedWidth = localStorage.getItem('oft_left_pane_width');
          if (savedWidth) {
            mainBody.style.setProperty('--left-pane-width', savedWidth);
          }
        } else {
          const savedMobileH = localStorage.getItem('oft_mobile_preview_height');
          if (savedMobileH) {
            mainBody.style.setProperty('--mobile-preview-height', savedMobileH);
          }
        }
        syncTimelineAfterSplitResize();
      });
    })();

    function initTimelineRulerAndPan() {
      let rulerTrack = document.getElementById('timeline-ruler-track');
      let layersTrack = document.getElementById('timeline-layers-track');
      let timecodeEl = document.getElementById('playhead-current-time');
      let rulerViewport = document.getElementById('timeline-ruler-viewport');
      let layersViewport = document.getElementById('timeline-layers-viewport');

      if (!rulerTrack || !layersTrack || !timecodeEl) {
        if (typeof document !== 'undefined') {
          if (!rulerTrack) rulerTrack = document.getElementById('timeline-ruler') || document.createElement('div');
          if (!layersTrack) layersTrack = document.getElementById('timeline-tracks') || document.createElement('div');
          if (!timecodeEl) timecodeEl = document.getElementById('timecode-display') || document.createElement('div');
          if (!rulerViewport) rulerViewport = document.getElementById('timeline-ruler') || document.createElement('div');
          if (!layersViewport) layersViewport = document.getElementById('timeline-tracks') || document.createElement('div');
        }
      }

      let _playTickCount = 0;
      let _lastBeatmarkNearState = null;
      let _cachedIsDesktop = null;
      let _parkAudioTimer = null;
      pixelsPerSecond = 80; // Default 80px per second, dynamically scalable
      window.currentPixelsPerSecond = 80;
      let currentFps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState.fps, 10) || 60);
      window.currentTimelineFps = currentFps;
      panX = 0;
      let lastRenderedPanX = null;
      let lastDisplayedMs = -1;
      let rafScheduled = false;
      const maxPanX = 0;

      // Dynamic timeline duration based strictly on maximum layer length
      function getProjectTotalDuration() {
        const layers = currentProjectState.layers || [];
        let maxEndSec = 0;
        for (let i = 0; i < layers.length; i++) {
          const l = layers[i];
          const start = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pixelsPerSecond);
          const dur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 320) / pixelsPerSecond);
          const end = start + dur;
          if (end > maxEndSec) {
            maxEndSec = end;
          }
        }
        if (currentActivePrecomp && currentActivePrecomp.durationSec > maxEndSec) {
          return currentActivePrecomp.durationSec;
        }
        return maxEndSec;
      }
      window.getProjectTotalDuration = getProjectTotalDuration;

      // 1. Dynamic Ruler Scale and Subdivisions Matching Selected FPS & Duration
      lastGeneratedDuration = -1;
      let lastGeneratedFps = 0;
      let lastGeneratedPps = 0;
      window.lastGeneratedDuration = lastGeneratedDuration;

      function getRulerTickConfig(fps, pps) {
        const safeFps = Math.max(1, parseInt(fps, 10) || 60);
        const framePx = pps / safeFps;
        let majorUnitFrames = safeFps;
        let subTicks = 10;

        // Level of Detail (LOD) Adaptive Density (After Effects / Premiere Pro standard)
        if (framePx >= 35) {
          // Ultra Zoom: 1 frame per major mark (e.g. 00:00:00, 01f, 02f, 03f...)
          majorUnitFrames = 1;
          subTicks = 1;
        } else if (framePx >= 16) {
          // Very High Zoom: 2 frames per major mark (or 5 if fps > 30)
          majorUnitFrames = (safeFps <= 30) ? 2 : 5;
          subTicks = majorUnitFrames;
        } else if (framePx >= 6) {
          // High Zoom: 5 frames per major mark (or 10 if fps > 30)
          majorUnitFrames = (safeFps <= 30) ? 5 : 10;
          subTicks = majorUnitFrames;
        } else if (framePx >= 2.5) {
          // Medium Zoom: 10/15 frames per major mark (quarter / half second)
          majorUnitFrames = (safeFps % 15 === 0) ? 15 : ((safeFps % 10 === 0) ? 10 : Math.max(1, Math.round(safeFps / 2)));
          subTicks = Math.max(2, Math.round(majorUnitFrames / 2));
        } else if (pps >= 55) {
          // Standard 1-second timeline
          majorUnitFrames = safeFps;
          subTicks = (safeFps <= 30) ? (safeFps % 5 === 0 ? 5 : 6) : 10;
        } else if (pps >= 25) {
          // Zoomed out: 2 seconds per major mark
          majorUnitFrames = safeFps * 2;
          subTicks = 4;
        } else if (pps >= 10) {
          // Far Zoom out: 5 seconds per major mark
          majorUnitFrames = safeFps * 5;
          subTicks = 5;
        } else if (pps >= 4) {
          // Very far Zoom out: 10 seconds per major mark
          majorUnitFrames = safeFps * 10;
          subTicks = 5;
        } else {
          // Extreme macro: 30 seconds per major mark
          majorUnitFrames = safeFps * 30;
          subTicks = 6;
        }

        const markWidthPx = majorUnitFrames * framePx;
        return {
          majorUnitFrames,
          subTicks,
          framePx,
          markWidthPx
        };
      }

      // Format waktu singkat untuk Ruler: 0s, 1s, 2s, 1m, 1m 30s, atau ms saat zoom sub-detik
      function formatCompactRulerTime(frames, safeFps) {
        if (frames <= 0) return '0s';
        if (frames % safeFps === 0) {
          const totalSec = Math.floor(frames / safeFps);
          if (totalSec < 60) {
            return `${totalSec}s`;
          }
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
        }
        const totalSec = Math.floor(frames / safeFps);
        const remFrames = frames % safeFps;
        const ms = Math.round((remFrames / safeFps) * 1000);
        if (totalSec === 0) {
          return `${ms}ms`;
        }
        if (totalSec < 60) {
          const decSec = (frames / safeFps).toFixed(2).replace(/\.?0+$/, '');
          return (ms % 100 === 0 || ms === 250 || ms === 750) ? `${decSec}s` : `${totalSec}s ${ms}ms`;
        }
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        return `${mins}m ${secs}s`;
      }

      function generateRulerTicks(fps, force = false) {
        const totalDur = getProjectTotalDuration();
        const safeFps = Math.max(1, parseInt(fps, 10) || 60);

        if (!force && totalDur === lastGeneratedDuration && safeFps === lastGeneratedFps && pixelsPerSecond === lastGeneratedPps) {
          return;
        }
        lastGeneratedDuration = totalDur;
        window.lastGeneratedDuration = lastGeneratedDuration;
        lastGeneratedFps = safeFps;
        lastGeneratedPps = pixelsPerSecond;

        const config = getRulerTickConfig(safeFps, pixelsPerSecond);
        const { majorUnitFrames, subTicks, framePx } = config;

        rulerTrack.style.setProperty('--ruler-ticks-count', subTicks);

        let rulerMarks = rulerTrack.querySelector('#timeline-ruler-marks');
        if (!rulerMarks) {
          rulerMarks = document.createElement('div');
          rulerMarks.id = 'timeline-ruler-marks';
          rulerMarks.className = 'timeline-ruler-marks';
          rulerTrack.appendChild(rulerMarks);
        }

        let cacheCanvas = rulerTrack.querySelector('#timeline-cache-ruler-bar');
        if (!cacheCanvas) {
          cacheCanvas = document.createElement('canvas');
          cacheCanvas.id = 'timeline-cache-ruler-bar';
          cacheCanvas.className = 'timeline-cache-ruler-bar';
          rulerTrack.appendChild(cacheCanvas);
        }

        // Jika tidak ada layer, durasi timeline murni 0 detik (tidak ada tick berjalan)
        if (totalDur <= 0) {
          rulerMarks.innerHTML = `
            <div class="ruler-second-mark" style="width: 0px; flex-basis: 0px;">
              <span class="ruler-second-text">0s</span>
              <div class="ruler-ticks-row" style="width: 0px; grid-template-columns: 1fr;">
                <div class="ruler-tick-cell"><div class="ruler-tick major"></div></div>
              </div>
            </div>
          `;
          if (window.PreviewCacheManager) {
            window.PreviewCacheManager.updateRulerUI();
          }
          return;
        }

        const totalFrames = Math.max(1, Math.round(totalDur * safeFps));
        let rulerHtml = '';

        for (let f = 0; f < totalFrames; f += majorUnitFrames) {
          const curMarkFrames = Math.min(majorUnitFrames, totalFrames - f);
          const markWidth = curMarkFrames * framePx;

          const timeStr = formatCompactRulerTime(f, safeFps);

          const curTicksCount = Math.max(1, Math.round((curMarkFrames / majorUnitFrames) * subTicks));
          let ticksHtml = '';
          for (let i = 0; i < curTicksCount; i++) {
            let tickClass = 'minor';
            if (i === 0) {
              tickClass = 'major';
            } else if (curTicksCount >= 4 && i === Math.floor(curTicksCount / 2)) {
              tickClass = 'medium';
            }
            ticksHtml += `
              <div class="ruler-tick-cell">
                <div class="ruler-tick ${tickClass}"></div>
              </div>
            `;
          }

          rulerHtml += `
            <div class="ruler-second-mark" style="width: ${markWidth.toFixed(2)}px; flex-basis: ${markWidth.toFixed(2)}px;">
              <span class="ruler-second-text">${timeStr}</span>
              <div class="ruler-ticks-row" style="grid-template-columns: repeat(${curTicksCount}, 1fr);">
                ${ticksHtml}
              </div>
            </div>
          `;
        }

        // Tanda akhir tepat di ujung durasi layer (width: 0px, tidak ada ruler tambahan lagi setelahnya)
        const endTimeStr = formatCompactRulerTime(totalFrames, safeFps);

        rulerHtml += `
          <div class="ruler-second-mark" style="width: 0px; flex-basis: 0px;">
            <span class="ruler-second-text">${endTimeStr}</span>
            <div class="ruler-ticks-row" style="width: 0px; grid-template-columns: 1fr;">
              <div class="ruler-tick-cell"><div class="ruler-tick major"></div></div>
            </div>
          </div>
        `;

        rulerMarks.innerHTML = rulerHtml;
        if (typeof renderTimelineBeatmarks === 'function') {
          renderTimelineBeatmarks();
        }
        if (window.PreviewCacheManager) {
          window.PreviewCacheManager.updateRulerUI();
        }
      }
      window.generateRulerTicks = generateRulerTicks;

      function updateTimelineDuration(force = false) {
        generateRulerTicks(currentFps, force);
        if (window.PreviewCacheManager) {
          window.PreviewCacheManager.updateRulerUI();
        }
        const bounds = getTimelineBounds();
        if (panX < bounds.min) {
          updateTimelinePosition(bounds.min, true);
        }
      }
      window.updateTimelineDuration = updateTimelineDuration;

      generateRulerTicks(currentFps, true);

      // Dynamic Timeline Scale Zoom Function (Zoom In / Out on Ruler)
      function setTimelineZoom(targetPps, anchorSec = null) {
        const oldPps = pixelsPerSecond;
        const newPps = Math.max(20, Math.min(1800, Math.round(targetPps)));
        if (newPps === oldPps) return;

        const isDesktop = (typeof isDesktopLayout === 'function') ? isDesktopLayout() : false;
        const totalDur = getProjectTotalDuration();
        const layers = (currentProjectState && currentProjectState.layers) || [];

        // 1. Determine anchor second and old scroll / pan state
        let currentSec = 0;
        let oldScrollX = 0;
        let viewW = 800;
        const playheadTime = (typeof getCurrentPlayheadTime === 'function') ? getCurrentPlayheadTime() : (typeof window.getCurrentPlayheadTime === 'function' ? window.getCurrentPlayheadTime() : 0);

        if (isDesktop) {
          const rulerVp = document.getElementById('timeline-ruler-viewport');
          const layersVp = document.getElementById('timeline-layers-viewport');
          viewW = (rulerVp && rulerVp.clientWidth > 0) ? rulerVp.clientWidth : ((layersVp && layersVp.clientWidth > 0) ? layersVp.clientWidth : 800);
          oldScrollX = (typeof window.getDesktopScrollX === 'function') ? window.getDesktopScrollX() : 0;
          
          // User requirement: Desktop timeline zoom anchors strictly to current duration (playheadTime)
          currentSec = (anchorSec !== null && anchorSec !== undefined)
            ? anchorSec
            : playheadTime;
        } else {
          currentSec = (anchorSec !== null && anchorSec !== undefined)
            ? anchorSec
            : playheadTime;
        }

        // 2. Commit new PPS
        pixelsPerSecond = newPps;
        window.currentPixelsPerSecond = newPps;

        // 3. Keep all layer clip models synchronized with new scale
        layers.forEach(layer => {
          if (layer.startSec === undefined) layer.startSec = (layer.startPx || 0) / oldPps;
          if (layer.durationSec === undefined) layer.durationSec = (layer.widthPx || 320) / oldPps;
          layer.startPx = Math.round(layer.startSec * newPps);
          const endPx = Math.round((layer.startSec + layer.durationSec) * newPps);
          layer.widthPx = Math.max(16, endPx - layer.startPx);
        });

        // 4. FAST IN-PLACE TIMELINE CLIPS UPDATE (avoids full DOM rebuild lag)
        const layersTrackEl = document.getElementById('timeline-layers-track');
        const rulerTrackEl = document.getElementById('timeline-ruler-track');
        const newTrackW = Math.max(viewW * 3, Math.ceil(totalDur * newPps) + viewW * 2);
        if (rulerTrackEl) rulerTrackEl.style.width = `${newTrackW}px`;
        if (layersTrackEl) layersTrackEl.style.width = `${Math.max(20000, newTrackW)}px`;

        const existingClips = layersTrackEl ? layersTrackEl.querySelectorAll('.timeline-clip-block') : [];
        if (existingClips.length > 0) {
          // Direct in-place updates for existing DOM clips
          existingClips.forEach(clipEl => {
            const layerId = clipEl.dataset.layerId;
            const layer = layers.find(l => l.id === layerId);
            if (!layer) return;
            clipEl.style.left = `${layer.startPx}px`;
            clipEl.style.width = `${layer.widthPx}px`;

            // Text animation markers / zones in-place update
            if (layer.type === 'text') {
              const tp = layer.textProps || {};
              const animInDur = Math.max(0.1, Number(tp.animInDuration || tp.animDuration) || 0.8);
              const animOutDur = Math.max(0.1, Number(tp.animOutDuration) || 0.6);
              const inPx = Math.min(layer.widthPx * 0.48, Math.round(animInDur * newPps));
              const outPx = Math.min(layer.widthPx * 0.48, Math.round(animOutDur * newPps));

              const zoneIn = clipEl.querySelector('.zone-in');
              if (zoneIn) zoneIn.style.width = `${inPx}px`;
              const markerIn = clipEl.querySelector('.marker-in');
              if (markerIn) markerIn.style.left = `${Math.max(2, inPx - 42)}px`;

              const zoneOut = clipEl.querySelector('.zone-out');
              if (zoneOut) zoneOut.style.width = `${outPx}px`;
              const markerOut = clipEl.querySelector('.marker-out');
              if (markerOut) markerOut.style.right = `${Math.max(2, outPx - 48)}px`;
            }

            // Keyframes inside clip block in-place update
            const clipKfMarkers = clipEl.querySelectorAll('.timeline-keyframe-marker');
            clipKfMarkers.forEach(m => {
              const kfTime = parseFloat(m.dataset.time);
              if (!isNaN(kfTime)) {
                const relPx = (kfTime - layer.startSec) * newPps;
                m.style.left = `${Math.max(0, Math.min(layer.widthPx, relPx)).toFixed(1)}px`;
              }
            });
          });

          // Expanded desktop keyframe tracks diamond in-place update
          const desktopDiamonds = layersTrackEl.querySelectorAll('.desktop-kf-diamond');
          desktopDiamonds.forEach(d => {
            const kfTime = parseFloat(d.dataset.time);
            if (!isNaN(kfTime)) {
              d.style.left = `${(kfTime * newPps).toFixed(1)}px`;
            }
          });
        } else {
          // If no clips rendered yet, trigger full render
          if (typeof renderTimelineLayers === 'function') {
            renderTimelineLayers();
          }
        }

        // 5. SMART RULER UPDATE: In-place mark update if LOD subdivision unchanged, full generate only when LOD changes
        const safeFps = Math.max(1, parseInt(currentFps, 10) || 60);
        const oldLOD = getRulerTickConfig(safeFps, oldPps);
        const newLOD = getRulerTickConfig(safeFps, newPps);
        const rulerMarks = rulerTrackEl ? rulerTrackEl.querySelector('#timeline-ruler-marks') : null;

        if (rulerMarks && oldLOD.majorUnitFrames === newLOD.majorUnitFrames && oldLOD.subTicks === newLOD.subTicks) {
          // Fast path: major unit frames and tick count per block are identical, just resize existing .ruler-second-mark divs
          const marks = rulerMarks.querySelectorAll('.ruler-second-mark');
          const totalFrames = Math.max(1, Math.round(totalDur * safeFps));
          const majorFrames = newLOD.majorUnitFrames;
          const framePx = newPps / safeFps;
          let f = 0;
          marks.forEach((m, idx) => {
            if (f < totalFrames) {
              const curMarkFrames = Math.min(majorFrames, totalFrames - f);
              const w = (curMarkFrames * framePx).toFixed(2);
              m.style.width = `${w}px`;
              m.style.flexBasis = `${w}px`;
              f += majorFrames;
            }
          });
        } else {
          // LOD changed: re-generate ruler ticks
          generateRulerTicks(currentFps, true);
        }

        // Fast Beatmarks update
        const rulerBm = rulerTrackEl ? rulerTrackEl.querySelectorAll('.timeline-beatmark-item') : [];
        if (rulerBm.length > 0) {
          rulerBm.forEach(el => {
            const t = parseFloat(el.dataset.time);
            if (!isNaN(t)) el.style.left = `${(t * newPps).toFixed(1)}px`;
          });
          const layersBm = layersTrackEl ? layersTrackEl.querySelectorAll('.timeline-layers-beatmark-line') : [];
          layersBm.forEach(el => {
            const t = parseFloat(el.dataset.time);
            if (!isNaN(t)) el.style.left = `${(t * newPps).toFixed(1)}px`;
          });
        } else if (Array.isArray(currentProjectState.beatmarks) && currentProjectState.beatmarks.length > 0) {
          if (typeof renderTimelineBeatmarks === 'function') {
            renderTimelineBeatmarks();
          }
        }

        // 6. VIEWPORT & PLAYHEAD SYNCHRONIZATION
        if (isDesktop) {
          // Strictly anchor to current duration (playheadTime)
          const curPlaySec = playheadTime;
          panX = -curPlaySec * newPps;
          window.timelinePanX = panX;
          window.currentPlaybackSec = curPlaySec;
          window.currentSec = curPlaySec;

          const currentMs = Math.round(curPlaySec * 1000);
          const timecodeEl = document.getElementById('timeline-timecode');
          if (timecodeEl && typeof formatTimecode === 'function') {
            timecodeEl.textContent = formatTimecode(currentMs);
          }

          // Anchor formula: keep the anchor second at its exact screen position
          const targetScrollX = oldScrollX + currentSec * (newPps - oldPps);
          const clampedScrollX = Math.max(0, targetScrollX);

          if (typeof window.setDesktopScrollX === 'function') {
            window.setDesktopScrollX(clampedScrollX);
          }
          if (typeof window.syncDesktopPlayhead === 'function') {
            window.syncDesktopPlayhead(true);
          }
        } else {
          updateTimelinePosition(-currentSec * newPps, true);
        }

        // 7. Update Preview Cache Manager Ruler UI if available
        if (window.PreviewCacheManager) {
          window.PreviewCacheManager.updateRulerUI();
        }
      }
      window.setTimelineZoom = setTimelineZoom;

      window.setTimelineFps = function(newFps) {
        currentFps = parseInt(newFps, 10) || 60;
        window.currentTimelineFps = currentFps;
        if (currentProjectState) currentProjectState.fps = currentFps;
        if (window.PreviewCacheManager) {
          window.PreviewCacheManager.setFps(currentFps);
        }
        if (window.VideoFrameExtractor) {
          window.VideoFrameExtractor.setFps(currentFps);
        }
        const fpsDropdown = document.getElementById('dropdown-fps');
        if (fpsDropdown) {
          fpsDropdown.dataset.value = String(currentFps);
          const label = fpsDropdown.querySelector('.custom-dropdown-label');
          if (label) label.textContent = `${currentFps} FPS`;
          fpsDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.classList.toggle('is-selected', item.dataset.val === String(currentFps));
          });
        }
        // Re-quantize existing beatmarks to newly selected FPS and deduplicate
        if (currentProjectState && Array.isArray(currentProjectState.beatmarks) && currentProjectState.beatmarks.length > 0) {
          const fps = currentFps;
          const seen = new Set();
          currentProjectState.beatmarks = currentProjectState.beatmarks.map(b => Math.round(b * fps) / fps).filter(b => {
            const key = Math.round(b * fps);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).sort((a, b) => a - b);
          if (typeof renderTimelineBeatmarks === 'function') {
            renderTimelineBeatmarks();
          }
        }
        generateRulerTicks(currentFps, true);
        const currentMs = Math.round((Math.max(0, -panX) / pixelsPerSecond) * 1000);
        timecodeEl.textContent = formatTimecode(currentMs);
        if (typeof redrawComposition === 'function') {
          redrawComposition('setTimelineFps');
        }
      };

      // 2. High-Performance GPU-Accelerated Motion beneath Fixed Center Playhead

      // Returns current allowable timeline bounds (from 0s to total project duration)
      function getTimelineBounds() {
        const totalDur = getProjectTotalDuration();
        if (totalDur <= 0) {
          return { min: 0, max: 0 };
        }
        return {
          min: -Math.round(totalDur * pixelsPerSecond),
          max: 0
        };
      }
      window.getTimelineBounds = getTimelineBounds;

      // SMPTE Timecode Formatter: 00:MM:SS:FF (Where FF counts 00..FPS-1)
      function formatTimecode(ms) {
        const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (window.currentTimelineFps || currentFps || 60);
        const frameDurationMs = 1000 / fps;
        const totalFrames = Math.max(0, Math.floor((ms + (frameDurationMs * 0.1)) / frameDurationMs));
        const frame = totalFrames % fps;
        const totalSec = Math.floor(totalFrames / fps);
        const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const secs = String(totalSec % 60).padStart(2, '0');
        const ff = String(frame).padStart(2, '0');
        return `00:${mins}:${secs}:${ff}`;
      }
      window.formatTimecode = formatTimecode;

      function getCurrentPlayheadTime() {
        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        const curPan = window.timelinePanX !== undefined ? window.timelinePanX : (typeof panX !== 'undefined' ? panX : 0);
        return Math.max(0, -curPan / pps);
      }
      window.getCurrentPlayheadTime = getCurrentPlayheadTime;
      window.getTimelineCurrentSec = getCurrentPlayheadTime;

      function isAnyPlaybackActive() {
        return !!(
          (typeof isPlaying !== 'undefined' && isPlaying) ||
          window.isTimelinePlaying ||
          (window.FishTemplateEditor && window.FishTemplateEditor.isPlaying)
        );
      }

      _cachedIsDesktop = null;
      window.addEventListener('resize', () => { _cachedIsDesktop = null; }, { passive: true });

      function renderTimeline(force = false) {
        rafScheduled = false;
        if (!force && panX === lastRenderedPanX) return;
        lastRenderedPanX = panX;
        window.timelinePanX = panX;
        const curSec = Math.max(0, -panX / pixelsPerSecond);
        window.currentPlaybackSec = curSec;
        window.currentSec = curSec;

        const isDesktop = (_cachedIsDesktop !== null)
          ? _cachedIsDesktop
          : (_cachedIsDesktop = Boolean(document.querySelector('.desktop-workstation, .desktop-viewport')));
        if (!isDesktop) {
          const panStr = `translate3d(${panX.toFixed(2)}px, 0, 0)`;
          rulerTrack.style.transform = panStr;
          layersTrack.style.transform = panStr;
        } else if (typeof window.syncDesktopPlayhead === 'function') {
          window.syncDesktopPlayhead();
        }

        // Calculate current timecode in exact milliseconds
        const currentMs = Math.round((Math.max(0, -panX) / pixelsPerSecond) * 1000);
        const isActivelyPlaying = isAnyPlaybackActive();
        if (currentMs !== lastDisplayedMs && (!isActivelyPlaying || Math.abs(currentMs - lastDisplayedMs) >= 40)) {
          lastDisplayedMs = currentMs;
          timecodeEl.textContent = formatTimecode(currentMs);
          if (!isActivelyPlaying && typeof updateTimeBadgeBeatmarkState === 'function') {
            updateTimeBadgeBeatmarkState();
          }
        }

        const isScrubOrPan = !!(window.isTimelineScrubbing || window.isTimelinePanning);
        const syncDrawers = !isActivelyPlaying && (!isScrubOrPan || ((_playTickCount || 0) % 10 === 0));
        if (syncDrawers) {
          if (typeof updateTransformKeyframeBtnState === 'function') {
            updateTransformKeyframeBtnState();
          }
          if (!isActivelyPlaying && typeof updateGraphEditorUI === 'function' && typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview === 'graph') {
            updateGraphEditorUI();
          }
          if (typeof syncTransformControllerValues === 'function' && typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview === 'transform') {
            syncTransformControllerValues();
          }
          if (typeof syncBlendOverlayValues === 'function' && typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview === 'blend') {
            syncBlendOverlayValues();
            if (typeof updateBlendKeyframeBtnState === 'function') updateBlendKeyframeBtnState();
          }
          if (!isActivelyPlaying && typeof syncEffectsRackUI === 'function' && typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview === 'effects') {
            try {
              syncEffectsRackUI();
            } catch (err) {
              console.error('[syncEffectsRackUI error]', err);
            }
          }
          if (typeof syncCameraSettingsUI === 'function' && typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview === 'camera') {
            syncCameraSettingsUI();
            if (typeof updateCameraKeyframeBtnState === 'function') updateCameraKeyframeBtnState();
          }
          if (typeof syncVolumeControllerValues === 'function' && typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview === 'volume') {
            syncVolumeControllerValues();
            if (typeof updateVolumeKeyframeBtnState === 'function') updateVolumeKeyframeBtnState();
          }
          if (typeof syncSpeedControllerValues === 'function' && typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview === 'speed') {
            syncSpeedControllerValues();
            if (typeof updateSpeedKeyframeBtnState === 'function') updateSpeedKeyframeBtnState();
          }
          // Only update cut bar row when timeline is paused/scrubbing (prevents DOM mutation thrash at 60fps)
          if (!isActivelyPlaying && typeof updateCutBarRowState === 'function') {
            updateCutBarRowState();
          }
        }
        if (typeof updateGraphPlayheadLine === 'function' && typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview === 'graph') {
          updateGraphPlayheadLine();
        }
        if (typeof updateBeatmarkPlayheadNeedle === 'function' && typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview === 'beatmark') {
          updateBeatmarkPlayheadNeedle();
        }

        // Only update reorder handles contrast when not playing or scrubbing to eliminate forced synchronous reflow (vp.clientWidth)
        if (!isActivelyPlaying && !window.isTimelineScrubbing && !window.isTimelinePanning && typeof updateReorderHandlesContrast === 'function') {
          updateReorderHandlesContrast();
        }

        // Live refresh canvas preview to show/hide layers matching playhead timecode
        if (!isActivelyPlaying) {
          redrawComposition('renderTimeline');
        }
      }

      function scheduleRender() {
        if (!rafScheduled) {
          rafScheduled = true;
          requestAnimationFrame(renderTimeline);
        }
      }

      _parkAudioTimer = null;
      function scheduleParkAudio(sec) {
        if (isAnyPlaybackActive()) return;
        if (_parkAudioTimer) clearTimeout(_parkAudioTimer);
        _parkAudioTimer = setTimeout(() => {
          _parkAudioTimer = null;
          if (isAnyPlaybackActive()) return;
          if (window.FishAudioEngine && typeof window.FishAudioEngine.parkPlayback === 'function') {
            const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
            window.FishAudioEngine.parkPlayback(currentProjectState.layers || [], sec, pps);
          }
        }, 16);
      }

      function updateTimelinePosition(newPanX, immediate = false) {
        const bounds = getTimelineBounds();
        panX = Math.max(bounds.min, Math.min(bounds.max, newPanX));
        const pps = (window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80));
        let curSec = Math.max(0, -panX / pps);
        if (!isAnyPlaybackActive()) {
          const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState.fps, 10) || 60);
          curSec = Math.round(curSec * fps) / fps;
          panX = -curSec * pps;
        }
        window.timelinePanX = panX;
        window.currentPlaybackSec = curSec;
        window.currentSec = curSec;
        if (immediate) {
          renderTimeline(true);
        } else {
          scheduleRender();
        }
        if (!isAnyPlaybackActive()) {
          scheduleParkAudio(curSec);
        }
        if (typeof updateGraphEditorUI === 'function' && typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview === 'graph') {
          updateGraphEditorUI();
        }
      }
      window.updateTimelinePosition = updateTimelinePosition;

      // Multi-Keyframe Selection State & Helpers
      window.selectedKeyframes = [];
      window.clearSelectedKeyframes = function() {
        window.selectedKeyframes = [];
        document.querySelectorAll('.timeline-keyframe-marker.is-selected-kf, .desktop-kf-diamond.is-selected-kf').forEach(m => {
          m.classList.remove('is-selected-kf');
        });
      };

      window.deleteSelectedKeyframes = function() {
        if (!Array.isArray(window.selectedKeyframes) || window.selectedKeyframes.length === 0) return;
        const targets = [...window.selectedKeyframes];
        window.clearSelectedKeyframes();

        let didMutate = false;
        const mutatedLayers = new Set();
        targets.forEach(item => {
          const layer = (currentProjectState.layers || []).find(l => l.id === item.layerId) || item.layer;
          if (!layer || !layer.keyframes || !Array.isArray(layer.keyframes[item.prop])) return;
          const origLen = layer.keyframes[item.prop].length;
          layer.keyframes[item.prop] = layer.keyframes[item.prop].filter(k => 
            Math.abs(k.time - item.time) >= 0.002
          );
          if (layer.keyframes[item.prop].length !== origLen) {
            didMutate = true;
            mutatedLayers.add(layer);
          }
        });

        if (didMutate) {
          if (typeof invalidatePreviewCacheForLayer === 'function') {
            mutatedLayers.forEach(l => invalidatePreviewCacheForLayer(l));
          }
          mutatedLayers.forEach(l => {
            if (typeof syncLayerKeyframeMarkersInPlace === 'function') {
              syncLayerKeyframeMarkersInPlace(l);
            }
          });
          saveCurrentProjectLayers();
          renderTimelineLayers();
          if (typeof updateTransformKeyframeBtnState === 'function') updateTransformKeyframeBtnState();
          if (typeof updateBlendKeyframeBtnState === 'function') updateBlendKeyframeBtnState();
          if (typeof syncEffectsKeyframeState === 'function') {
            mutatedLayers.forEach(l => syncEffectsKeyframeState(l));
          }
          if (typeof updateGraphEditorUI === 'function') updateGraphEditorUI();
          if (typeof redrawComposition === 'function') redrawComposition('delete-selected-keyframes');
        }
      };

      function seekTimelineToTime(sec, immediate = true) {
        const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const targetPanX = - (sec * pps);
        updateTimelinePosition(targetPanX, immediate);
        if (window.FishAudioEngine && typeof window.FishAudioEngine.parkPlayback === 'function' && !isAnyPlaybackActive()) {
          window.FishAudioEngine.parkPlayback(currentProjectState.layers || [], sec, pps);
        }
        if (typeof updateTimeBadgeBeatmarkState === 'function') {
          updateTimeBadgeBeatmarkState();
        }
      }
      window.seekTimelineToTime = seekTimelineToTime;

      // --- Beatmark Engine & UI Controller ---
      _lastBeatmarkNearState = null;
      function updateTimeBadgeBeatmarkState() {
        const badge = document.getElementById('timeline-time-badge');
        if (!badge) return;
        // Avoid style/attribute invalidations during active 60fps playback
        if (isPlaying) {
          if (_lastBeatmarkNearState !== false) {
            _lastBeatmarkNearState = false;
            badge.classList.remove('has-beatmark');
          }
          return;
        }
        const currentSec = Math.max(0, -panX / pixelsPerSecond);
        const beatmarks = currentProjectState.beatmarks || [];
        const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || currentFps || 60);
        const tolerance = 0.5 / fps;
        const isNear = beatmarks.some(b => Math.abs(b - currentSec) <= tolerance);
        if (isNear !== _lastBeatmarkNearState) {
          _lastBeatmarkNearState = isNear;
          badge.classList.toggle('has-beatmark', isNear);
          badge.setAttribute('title', isNear ? 'Playhead on Beatmark. Click to delete Beatmark.' : 'Click to add Beatmark at current time');
        }
      }
      window.updateTimeBadgeBeatmarkState = updateTimeBadgeBeatmarkState;

      function getMarkerNameForTime(bm) {
        const markerNames = (currentProjectState && currentProjectState.markerNames) ||
                            (window.currentProjectState && window.currentProjectState.markerNames) || {};
        const timeVal = parseFloat(bm);
        if (isNaN(timeVal)) return '';
        if (markerNames[timeVal] !== undefined && markerNames[timeVal] !== '') return markerNames[timeVal];
        if (markerNames[String(timeVal)] !== undefined && markerNames[String(timeVal)] !== '') return markerNames[String(timeVal)];
        const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || currentFps || 60);
        const tolerance = 0.5 / fps;
        const key = Object.keys(markerNames).find(k => Math.abs(parseFloat(k) - timeVal) <= tolerance);
        if (key && markerNames[key]) return markerNames[key];
        return '';
      }

      function createBeatmarkItemEl(bm, pps) {
        const leftPx = Math.round(bm * pps);
        const timeStr = formatTimecode(Math.round(bm * 1000));
        const name = getMarkerNameForTime(bm);
        const isNamed = !!name;
        const item = document.createElement('div');
        item.className = `timeline-beatmark-item ${isNamed ? '' : 'is-beatmark'}`;
        item.dataset.time = String(bm);
        item.style.left = `${leftPx}px`;

        if (isNamed) {
          item.title = `Marker: ${name} (${Number(bm).toFixed(2)}s) — Hold to move, tap to edit`;
          item.setAttribute('aria-label', `Marker ${name} at ${timeStr}`);
          item.innerHTML = `
            <div class="timeline-beatmark-pin">
              <i class='fticon fticon-icon-31 timeline-beatmark-svg' style='width:10px;height:12px;font-size:12px;line-height:1;' aria-hidden='true'></i>
            </div>
            <div class="timeline-beatmark-stem"></div>
            <span class="timeline-beatmark-label">${name}</span>
          `;
        } else {
          item.title = `Beatmark: ${Number(bm).toFixed(2)}s — Hold to move, tap to edit`;
          item.setAttribute('aria-label', `Beatmark at ${timeStr}`);
          item.innerHTML = `
            <div class="timeline-beatmark-pin">
              <i class='fticon fticon-icon-31 timeline-beatmark-svg' style='width:10px;height:12px;font-size:12px;line-height:1;' aria-hidden='true'></i>
            </div>
            <div class="timeline-beatmark-stem"></div>
          `;
        }
        return item;
      }

      function createBeatmarkLineEl(bm, pps) {
        const leftPx = Math.round(bm * pps);
        const name = getMarkerNameForTime(bm);
        const isNamed = !!name;
        const line = document.createElement('div');
        line.className = `timeline-layers-beatmark-line ${isNamed ? '' : 'is-beatmark'}`;
        line.dataset.time = String(bm);
        line.style.left = `${leftPx}px`;
        return line;
      }

      function addBeatmarkDOM(bm, pps) {
        let rulerBeatmarks = rulerTrack.querySelector('#timeline-ruler-beatmarks');
        let layersBeatmarks = layersTrack.querySelector('#timeline-layers-beatmarks');
        if (!rulerBeatmarks || !layersBeatmarks) {
          renderTimelineBeatmarks();
          return;
        }
        rulerBeatmarks.appendChild(createBeatmarkItemEl(bm, pps));
        layersBeatmarks.appendChild(createBeatmarkLineEl(bm, pps));
        if (typeof window.syncDesktopMarkerLabels === 'function') {
          window.syncDesktopMarkerLabels();
        }
      }

      function renderTimelineBeatmarks() {
        let rulerBeatmarks = rulerTrack.querySelector('#timeline-ruler-beatmarks');
        if (!rulerBeatmarks) {
          rulerBeatmarks = document.createElement('div');
          rulerBeatmarks.id = 'timeline-ruler-beatmarks';
          rulerBeatmarks.className = 'timeline-ruler-beatmarks';
          rulerTrack.appendChild(rulerBeatmarks);
        }

        let layersBeatmarks = layersTrack.querySelector('#timeline-layers-beatmarks');
        if (!layersBeatmarks) {
          layersBeatmarks = document.createElement('div');
          layersBeatmarks.id = 'timeline-layers-beatmarks';
          layersBeatmarks.className = 'timeline-layers-beatmarks';
          layersTrack.insertBefore(layersBeatmarks, layersTrack.firstChild);
        }

        const beatmarks = Array.isArray(currentProjectState.beatmarks) ? currentProjectState.beatmarks : [];
        if (beatmarks.length === 0) {
          rulerBeatmarks.innerHTML = '';
          layersBeatmarks.innerHTML = '';
          updateTimeBadgeBeatmarkState();
          if (typeof window.syncDesktopMarkerLabels === 'function') {
            window.syncDesktopMarkerLabels();
          }
          return;
        }

        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        const rulerFrag = document.createDocumentFragment();
        const layersFrag = document.createDocumentFragment();

        for (let i = 0; i < beatmarks.length; i++) {
          const bm = beatmarks[i];
          rulerFrag.appendChild(createBeatmarkItemEl(bm, pps));
          layersFrag.appendChild(createBeatmarkLineEl(bm, pps));
        }

        rulerBeatmarks.replaceChildren(rulerFrag);
        layersBeatmarks.replaceChildren(layersFrag);
        updateTimeBadgeBeatmarkState();
        if (typeof window.syncDesktopMarkerLabels === 'function') {
          window.syncDesktopMarkerLabels();
        }
      }
      window.renderTimelineBeatmarks = renderTimelineBeatmarks;

      let saveBeatmarksDebounceTimer = null;
      function saveCurrentProjectBeatmarks(immediate = false) {
        if (saveBeatmarksDebounceTimer) {
          clearTimeout(saveBeatmarksDebounceTimer);
          saveBeatmarksDebounceTimer = null;
        }
        const doSave = async () => {
          if (!window.FishDatabase || !currentProjectState.id) return;
          try {
            const prj = await window.FishDatabase.getProject(currentProjectState.id);
            if (prj) {
              prj.beatmarks = Array.isArray(currentProjectState.beatmarks) ? [...currentProjectState.beatmarks] : [];
              await window.FishDatabase.saveProject(prj);
            }
          } catch (_) {}
        };

        if (immediate) {
          doSave();
          return;
        }

        // During playback, debounce longer (1500ms) so rapid beat taps don't trigger IndexedDB/localStorage writes during 60fps playback
        const delay = isPlaying ? 1500 : 250;
        saveBeatmarksDebounceTimer = setTimeout(() => {
          saveBeatmarksDebounceTimer = null;
          doSave();
        }, delay);
      }
      window.saveCurrentProjectBeatmarks = saveCurrentProjectBeatmarks;

      function toggleBeatmarkAtCurrentTime(mode = 'toggle') {
        if (!Array.isArray(currentProjectState.beatmarks)) {
          currentProjectState.beatmarks = [];
        }
        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        const currentSec = (typeof getCurrentPlayheadTime === 'function')
          ? getCurrentPlayheadTime()
          : (typeof window.getCurrentPlayheadTime === 'function'
            ? window.getCurrentPlayheadTime()
            : Math.max(0, -(window.timelinePanX !== undefined ? window.timelinePanX : panX) / pps));

        // Strictly quantize beatmark timestamp to project FPS frame boundary
        const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || currentFps || 60);
        const targetFrame = Math.round(currentSec * fps);
        const quantizedSec = Math.max(0, targetFrame / fps);
        const tolerance = 0.5 / fps;

        const existingIdx = currentProjectState.beatmarks.findIndex(b => Math.abs(b - quantizedSec) <= tolerance);
        if (existingIdx !== -1) {
          // If explicitly adding or actively playing, keep existing beatmark and do not delete
          if (mode === 'add' || isPlaying) {
            return currentProjectState.beatmarks[existingIdx];
          }
          // Playhead is at beatmark and user toggles while paused -> delete it
          const removed = currentProjectState.beatmarks.splice(existingIdx, 1)[0];
          const rulerBm = rulerTrack.querySelector(`.timeline-beatmark-item[data-time="${removed}"]`);
          if (rulerBm) rulerBm.remove();
          const layerLine = layersTrack.querySelector(`.timeline-layers-beatmark-line[data-time="${removed}"]`);
          if (layerLine) layerLine.remove();
          if (!rulerBm || !layerLine) renderTimelineBeatmarks();
          updateTimeBadgeBeatmarkState();
          if (typeof window.syncDesktopMarkerLabels === 'function') {
            window.syncDesktopMarkerLabels();
          }
          if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
            window.UndoRedoManager.recordSnapshot();
          }
          saveCurrentProjectBeatmarks();
          return null;
        } else {
          // Playhead not on beatmark -> add it
          currentProjectState.beatmarks.push(quantizedSec);
          currentProjectState.beatmarks.sort((a, b) => a - b);
          addBeatmarkDOM(quantizedSec, pps);
        }

        updateTimeBadgeBeatmarkState();
        if (typeof window.syncDesktopMarkerLabels === 'function') {
          window.syncDesktopMarkerLabels();
        }

        // Defer heavy Undo snapshot during playback to prevent dropping frames on tablets/touch devices
        if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
          if (isPlaying) {
            if (window._pendingBeatmarkUndoTimer) {
              clearTimeout(window._pendingBeatmarkUndoTimer);
            }
            window._pendingBeatmarkUndoTimer = setTimeout(() => {
              window._pendingBeatmarkUndoTimer = null;
              if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
                window.UndoRedoManager.recordSnapshot();
              }
            }, 600);
          } else {
            window.UndoRedoManager.recordSnapshot();
          }
        }
        saveCurrentProjectBeatmarks();
        return quantizedSec;
      }
      window.toggleBeatmarkAtCurrentTime = toggleBeatmarkAtCurrentTime;

      function deleteBeatmark(sec) {
        if (!Array.isArray(currentProjectState.beatmarks)) return;
        const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || currentFps || 60);
        const tolerance = 0.5 / fps;
        const idx = currentProjectState.beatmarks.findIndex(b => Math.abs(b - sec) <= tolerance);
        if (idx !== -1) {
          const removed = currentProjectState.beatmarks.splice(idx, 1)[0];
          const rulerBm = rulerTrack.querySelector(`.timeline-beatmark-item[data-time="${removed}"]`);
          if (rulerBm) rulerBm.remove();
          const layerLine = layersTrack.querySelector(`.timeline-layers-beatmark-line[data-time="${removed}"]`);
          if (layerLine) layerLine.remove();
          if (!rulerBm || !layerLine) renderTimelineBeatmarks();
          updateTimeBadgeBeatmarkState();
          if (typeof window.syncDesktopMarkerLabels === 'function') {
            window.syncDesktopMarkerLabels();
          }
          if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
            window.UndoRedoManager.recordSnapshot();
          }
          saveCurrentProjectBeatmarks();
        }
      }
      window.deleteBeatmark = deleteBeatmark;

      // Gather unified timeline stops (Layer Keyframes + Timeline Beatmarks) with intelligent deduplication
      function getUnifiedTimelineStops() {
        const rawKfTimes = [];

        // 1. Gather all keyframes on selected layer(s)
        let targetLayers = [];
        if (selectedLayerIds && selectedLayerIds.size > 0) {
          const allLayers = currentProjectState.layers || [];
          targetLayers = allLayers.filter(l => selectedLayerIds.has(l.id));
        } else if (selectedLayerId || window.selectedLayerId) {
          const sId = selectedLayerId || window.selectedLayerId;
          const allLayers = currentProjectState.layers || [];
          const found = allLayers.find(l => l.id === sId);
          if (found) targetLayers = [found];
        }

        targetLayers.forEach(layer => {
          if (layer && layer.keyframes && typeof layer.keyframes === 'object') {
            Object.values(layer.keyframes).forEach(list => {
              if (Array.isArray(list)) {
                list.forEach(kf => {
                  if (typeof kf.time === 'number' && !isNaN(kf.time)) {
                    rawKfTimes.push(kf.time);
                  }
                });
              }
            });
          }
        });

        // 2. Deduplicate keyframes within epsilon tolerance (half-frame tolerance)
        const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || currentFps || 60);
        const DEDUP_EPSILON = 0.5 / fps;
        rawKfTimes.sort((a, b) => a - b);
        const uniqueKfTimes = [];
        for (const t of rawKfTimes) {
          if (!uniqueKfTimes.some(existing => Math.abs(existing - t) <= DEDUP_EPSILON)) {
            uniqueKfTimes.push(t);
          }
        }

        // 3. Gather timeline markers (beatmarks) and filter out any near keyframes to avoid double-detection
        const rawBeatmarks = (Array.isArray(currentProjectState.beatmarks) ? currentProjectState.beatmarks : [])
          .filter(bm => typeof bm === 'number' && !isNaN(bm));
        rawBeatmarks.sort((a, b) => a - b);

        const uniqueMarkers = [];
        for (const bm of rawBeatmarks) {
          const isNearKf = uniqueKfTimes.some(kf => Math.abs(kf - bm) <= DEDUP_EPSILON);
          const isNearExistingMarker = uniqueMarkers.some(m => Math.abs(m - bm) <= DEDUP_EPSILON);
          if (!isNearKf && !isNearExistingMarker) {
            uniqueMarkers.push(bm);
          }
        }

        // 4. Merge and sort chronologically (whichever comes first in timeline: keyframe or marker)
        return [...uniqueKfTimes, ...uniqueMarkers].sort((a, b) => a - b);
      }
      window.getUnifiedTimelineStops = getUnifiedTimelineStops;

      // ======================================================================
      // MODULAR TIMELINE SNAPPING SYSTEM
      // Snaps to: Beatmarks, Start/End of adjacent layers (depan / belakang), and Playhead
      // ======================================================================
      window.isTimelineSnapEnabled = true;

      function getTimelineSnapTargets(excludeLayerId = null, includePlayhead = false) {
        const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const targets = [];
        const addedPx = new Set();

        function addTarget(sec, type, layerName = '') {
          if (typeof sec !== 'number' || isNaN(sec) || sec < 0) return;
          const px = Math.round(sec * pps);
          if (!addedPx.has(px)) {
            addedPx.add(px);
            targets.push({ sec, px, type, layerName });
          }
        }

        // 0. Project boundaries (start at 0s and project total duration)
        addTarget(0, 'project-start');
        const totalDur = (typeof getProjectTotalDuration === 'function') ? getProjectTotalDuration() : 0;
        if (totalDur > 0) {
          addTarget(totalDur, 'project-end');
        }

        // 1. Snap ke beat mark kalau ada beatmark
        const beatmarks = Array.isArray(currentProjectState.beatmarks) ? currentProjectState.beatmarks : [];
        for (let i = 0; i < beatmarks.length; i++) {
          addTarget(beatmarks[i], 'beatmark');
        }

        // 2. Snap ke awal / akhir layer depan / belakang
        const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || currentFps || 60);
        const layers = Array.isArray(currentProjectState.layers) ? currentProjectState.layers : [];
        for (let i = 0; i < layers.length; i++) {
          const l = layers[i];
          if (excludeLayerId && l.id === excludeLayerId) continue;
          const rawStartSec = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
          const rawDurSec = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 320) / pps);
          const startSec = Math.round(rawStartSec * safeFps) / safeFps;
          const durSec = Math.max(1 / safeFps, Math.round(rawDurSec * safeFps) / safeFps);
          const endSec = Math.round((startSec + durSec) * safeFps) / safeFps;

          addTarget(startSec, 'layer-start', l.name);
          addTarget(endSec, 'layer-end', l.name);
        }

        // 3. Current Playhead position (for layer slide & trim)
        if (includePlayhead) {
          const curPan = window.timelinePanX !== undefined ? window.timelinePanX : (panX || 0);
          const rawPlayheadSec = Math.max(0, -curPan / pps);
          const playheadSec = Math.round(rawPlayheadSec * safeFps) / safeFps;
          addTarget(playheadSec, 'playhead');
        }

        return targets;
      }
      window.getTimelineSnapTargets = getTimelineSnapTargets;

      function findTimelineSnap(testPx, targets, thresholdPx = 10) {
        if (!window.isTimelineSnapEnabled || !targets || targets.length === 0) return null;
        let closest = null;
        let minDiff = Infinity;

        for (let i = 0; i < targets.length; i++) {
          const target = targets[i];
          const diff = Math.abs(testPx - target.px);
          if (diff <= thresholdPx && diff < minDiff) {
            minDiff = diff;
            closest = target;
          }
        }

        return closest;
      }
      window.findTimelineSnap = findTimelineSnap;

      function showTimelineSnapGuide(px) {
        if (!layersTrack) return;
        let guide = layersTrack.querySelector('.timeline-snap-guide-line');
        if (!guide) {
          guide = document.createElement('div');
          guide.className = 'timeline-snap-guide-line';
          layersTrack.appendChild(guide);
        }
        guide.style.left = `${px}px`;
        guide.style.display = 'block';
      }
      window.showTimelineSnapGuide = showTimelineSnapGuide;

      function hideTimelineSnapGuide() {
        if (layersTrack) {
          const guide = layersTrack.querySelector('.timeline-snap-guide-line');
          if (guide) guide.style.display = 'none';
        }
        const needle = document.getElementById('timeline-center-needle');
        if (needle) needle.classList.remove('is-snapped');
      }
      window.hideTimelineSnapGuide = hideTimelineSnapGuide;

      // Unified Timeline Navigation (Jump between Keyframes & Markers, or Frame Step at boundaries)
      function navigateBeatmark(direction) {
        if (isPlaying) pausePlayback();
        const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const currentSec = Math.max(0, -panX / pps);
        const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || currentFps || 60);
        const currentFrame = Math.round(currentSec * fps);
        const stops = getUnifiedTimelineStops();

        if (stops.length === 0) {
          stepFrame(direction);
          return;
        }

        if (direction > 0) {
          // Next stop: find first stop ahead of playhead's current frame
          const target = stops.find(s => Math.round(s * fps) > currentFrame);
          if (target !== undefined && target !== null) {
            const targetSec = Math.round(target * fps) / fps;
            seekTimelineToTime(targetSec, true);
          } else {
            stepFrame(1);
          }
        } else {
          // Previous stop: find nearest stop behind playhead's current frame
          const target = stops.filter(s => Math.round(s * fps) < currentFrame).pop();
          if (target !== undefined && target !== null) {
            const targetSec = Math.round(target * fps) / fps;
            seekTimelineToTime(targetSec, true);
          } else {
            stepFrame(-1);
          }
        }
      }
      window.navigateBeatmark = navigateBeatmark;
      window.navigateTimelineStops = navigateBeatmark;

      // Event Listeners for Badge & Beatmarks
      const timeBadgeEl = document.getElementById('timeline-time-badge');
      if (timeBadgeEl) {
        let lastBadgeTime = 0;
        let lastBadgePointerDownTime = 0;
        const triggerBadgeBeatmark = (e) => {
          const now = performance.now();
          if (e.type === 'click' && (now - lastBadgePointerDownTime < 800)) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (now - lastBadgeTime < 45) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            return;
          }
          lastBadgeTime = now;
          if (e.type === 'pointerdown') {
            lastBadgePointerDownTime = now;
          }
          if (e.cancelable) e.preventDefault();
          e.stopPropagation();
          toggleBeatmarkAtCurrentTime();
        };
        timeBadgeEl.addEventListener('pointerdown', triggerBadgeBeatmark);
        timeBadgeEl.addEventListener('click', triggerBadgeBeatmark);
        timeBadgeEl.addEventListener('keydown', (e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
            triggerBadgeBeatmark(e);
          }
        });
      }

      rulerTrack.addEventListener('click', (e) => {
        const item = e.target.closest('.timeline-beatmark-item');
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        const bm = parseFloat(item.dataset.time);
        if (isNaN(bm)) return;
        if (e.shiftKey || e.altKey) {
          deleteBeatmark(bm);
        } else {
          seekTimelineToTime(bm, true);
        }
      });

      rulerTrack.addEventListener('contextmenu', (e) => {
        const item = e.target.closest('.timeline-beatmark-item');
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        const bm = parseFloat(item.dataset.time);
        if (!isNaN(bm)) {
          deleteBeatmark(bm);
        }
      });

      // Playback Controller State & Logic
      isPlaying = false;
      let playAnimationId = null;
      let lastTime = 0;

      const playBtn = document.getElementById('editor-btn-play') || document.querySelector('.ctrl-btn[title="Play"]');
      const prevBtn = document.getElementById('editor-btn-prev') || document.querySelector('.ctrl-btn[title*="Previous"]');
      const nextBtn = document.getElementById('editor-btn-next') || document.querySelector('.ctrl-btn[title*="Next"]');

      function updatePlayButtonUI() {
        if (!playBtn) return;
        playBtn.classList.toggle('is-playing', isPlaying);
        if (window.isExporting) {
          playBtn.classList.add('is-disabled');
          playBtn.setAttribute('disabled', 'true');
          playBtn.setAttribute('title', 'Export in progress (Playback locked)');
          playBtn.setAttribute('aria-label', 'Export in progress (Playback locked)');
        } else {
          playBtn.classList.remove('is-disabled');
          playBtn.removeAttribute('disabled');
          playBtn.setAttribute('title', isPlaying ? 'Pause (Space)' : 'Play (Space)');
          playBtn.setAttribute('aria-label', isPlaying ? 'Pause (Space)' : 'Play (Space)');
        }
      }
      window.updatePlayButtonUI = updatePlayButtonUI;

      function pausePlayback(returnToStart = true) {
        if (!isPlaying && !playAnimationId && !window.isTimelinePlaying) {
          if (window.isExporting) {
            if (window.FishAudioEngine) {
              try { window.FishAudioEngine.pauseAll(); } catch (_) {}
            }
            const stopMediaTree = (list) => {
              (list || []).forEach(layer => {
                if (!layer) return;
                if (layer.type === 'video' || layer.type === 'audio') {
                  const media = getOrLoadLayerMedia(layer);
                  if (media && media.el && !media.el.paused) {
                    try { media.el.pause(); } catch (_) {}
                  }
                }
                if (Array.isArray(layer.layers)) stopMediaTree(layer.layers);
              });
            };
            stopMediaTree(currentProjectState && currentProjectState.layers);
          }
          return;
        }
        const curSecAtPause = Math.max(0, -panX / pixelsPerSecond);
        window.lastPausePlaybackSec = curSecAtPause;
        isPlaying = false;
        window.isTimelinePlaying = false;
        updatePlayButtonUI();
        if (playAnimationId) {
          cancelAnimationFrame(playAnimationId);
          playAnimationId = null;
        }
        lastTime = 0;
        if (window.PreviewCacheManager && typeof window.PreviewCacheManager.stopLookaheadWorker === 'function') {
          window.PreviewCacheManager.stopLookaheadWorker();
        }
        if (window.FishAudioEngine) {
          window.FishAudioEngine.pauseAll();
          if (typeof window.FishAudioEngine.suppressMediaSession === 'function') {
            window.FishAudioEngine.suppressMediaSession();
          }
        }
        const pauseLayerMediaTree = (layerList) => {
          (layerList || []).forEach(layer => {
            if (!layer) return;
            if (layer.type === 'video' || layer.type === 'audio') {
              const media = getOrLoadLayerMedia(layer);
              if (media && media.el) {
                media.el._pauseTime = media.el.currentTime;
                media.el._lastPlaybackStopTime = media.el.currentTime;
                media.el._lastMasterSec = null;
                media.el._lastReportedTime = undefined;
                media.el._lastAdvanceWallTime = undefined;
                if (!media.el.paused) {
                  try { media.el.pause(); } catch (_) {}
                }
                // Snapshot fresh frame to freezeCanvas once on pause
                if (layer.type === 'video' && media.el.readyState >= 2 && media.el.videoWidth > 0) {
                  if (!media.freezeCanvas) media.freezeCanvas = document.createElement('canvas');
                  if (media.freezeCanvas.width !== media.el.videoWidth || media.freezeCanvas.height !== media.el.videoHeight) {
                    media.freezeCanvas.width = media.el.videoWidth;
                    media.freezeCanvas.height = media.el.videoHeight;
                  }
                  const fctx = media.freezeCanvas.getContext('2d', { alpha: false });
                  if (fctx) {
                    try {
                      fctx.drawImage(media.el, 0, 0);
                      media.hasFreezeFrame = true;
                    } catch (_) {}
                  }
                }
              }
            }
            if (Array.isArray(layer.layers)) {
              pauseLayerMediaTree(layer.layers);
            }
          });
        };
        pauseLayerMediaTree(currentProjectState.layers || []);
        if (typeof saveCurrentProjectBeatmarks === 'function') {
          saveCurrentProjectBeatmarks(true);
        }
        if (typeof updateTimeBadgeBeatmarkState === 'function') {
          updateTimeBadgeBeatmarkState();
        }
        if (returnToStart && window.playbackPlayFromMode === 'last_pause' && typeof window.playbackPlayStartSec === 'number' && !isNaN(window.playbackPlayStartSec)) {
          if (typeof seekTimelineToTime === 'function') {
            seekTimelineToTime(window.playbackPlayStartSec, true);
          }
        }
        if (window._adaptiveDraftState) {
          window._adaptiveDraftState.scale = 1.0;
          window._currentAdaptiveDraftScale = 1.0;
        }

        if (!window.isExporting) {
          renderTimeline(true);
          if (typeof updateCutBarRowState === 'function') updateCutBarRowState();
          if (typeof updateReorderHandlesContrast === 'function') updateReorderHandlesContrast();
        }

        // Refresh layer state snapshot AFTER renderTimeline(true) and UI sync so any lazy property initialization
        // during playback or pause UI sync (e.g. fitLayerToComposition, scaleZ, text/shape default dimensions)
        // never triggers false-positive cache invalidation
        if (window.PreviewCacheManager && typeof window.PreviewCacheManager.refreshBaselineSnapshot === 'function') {
          window.PreviewCacheManager.refreshBaselineSnapshot(currentProjectState);
        }

        // Trigger immediate idle cache fill after pause — continues filling remaining uncached frames smoothly like playback
        if (window.PreviewCacheManager && window.isPreviewCacheEnabled !== false && !window.isExporting) {
          window.PreviewCacheManager.scheduleIdleCheck(true);
        }
      }
      window.pausePlayback = pausePlayback;

      // Step Forward / Backward by Exactly 1 Frame
      function stepFrame(delta) {
        if (isPlaying) pausePlayback();
        const frameDurationMs = 1000 / currentFps;
        const currentMs = (Math.max(0, -panX) / pixelsPerSecond) * 1000;
        const currentFrame = Math.round(currentMs / frameDurationMs);
        const totalDur = getProjectTotalDuration();
        const targetFrame = Math.max(0, Math.min(Math.round(totalDur * currentFps), currentFrame + delta));
        const targetMs = targetFrame * frameDurationMs;
        const targetPanX = -(targetMs / 1000) * pixelsPerSecond;
        updateTimelinePosition(targetPanX, true);
      }

      // Track latest pointer device & button to accurately isolate physical mouse right-click from mobile touch hold
      window.addEventListener('pointerdown', (e) => {
        window._lastPointerDownType = e.pointerType || (e.touches ? 'touch' : 'mouse');
        window._lastPointerDownButton = e.button;
      }, true);

      function isTrueRightClick(e) {
        if (e && (e.pointerType === 'touch' || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents))) {
          return false;
        }
        if (window._lastPointerDownType === 'touch') {
          return false;
        }
        if (typeof isDesktopLayout === 'function' && isDesktopLayout()) {
          return true;
        }
        return window._lastPointerDownType === 'mouse' && window._lastPointerDownButton === 2;
      }

      lastContextClickSec = null;
      window.lastContextClickSec = lastContextClickSec;

      function triggerEmptyTimelineContextMenu(clickX, clickY, e = null) {
        if (!isTrueRightClick(e)) return;
        const trackRect = layersTrack ? layersTrack.getBoundingClientRect() : layersViewport.getBoundingClientRect();
        const offsetX = clickX - trackRect.left;
        const clickSec = Math.max(0, offsetX / pixelsPerSecond);
        lastContextClickSec = clickSec;
        window.lastContextClickSec = lastContextClickSec;

        if (typeof updateLayerActionsPopoverState === 'function') {
          updateLayerActionsPopoverState(null, true);
        }

        if (window.Popover) {
          const mouseAnchor = {
            isVirtual: true,
            isContextMenu: true,
            getBoundingClientRect: () => ({
              left: clickX,
              top: clickY,
              right: clickX,
              bottom: clickY,
              width: 0,
              height: 0
            }),
            dataset: {}
          };
          window.Popover.open(mouseAnchor, 'popover-layer-actions');
        }
      }

      function triggerClipContextMenu(layer, clickX, clickY, e = null) {
        if (!isTrueRightClick(e)) return;
        if (!layer) return;
        const hasKeyframesSelected = Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0;
        if (!selectedLayerIds || !selectedLayerIds.has(layer.id)) {
          if (!hasKeyframesSelected) {
            selectTimelineLayer(layer.id, false);
          } else {
            window.selectedLayerId = layer.id;
            if (window.selectedLayerIds) {
              window.selectedLayerIds.clear();
              window.selectedLayerIds.add(layer.id);
            }
          }
        }

        if (typeof updateLayerActionsPopoverState === 'function') {
          updateLayerActionsPopoverState(layer);
        }
        if (window.Popover) {
          const mouseAnchor = {
            isVirtual: true,
            isContextMenu: true,
            getBoundingClientRect: () => ({
              left: clickX,
              top: clickY,
              right: clickX,
              bottom: clickY,
              width: 0,
              height: 0
            }),
            dataset: {}
          };
          window.Popover.open(mouseAnchor, 'popover-layer-actions');
        }
      }
      window.triggerClipContextMenu = triggerClipContextMenu;

      // Pointer drag scrubbing & vertical layer panning & multi-directional ruler gesture
      let isPanning = false;
      let panPointerId = null;
      let startX = 0;
      let startY = 0;
      let startPanX = 0;
      let startScrollTop = 0;
      let isLayersDrag = false;
      let isRulerDrag = false;
      let rulerStartZoomPps = 80;
      let rulerAnchorSec = 0;
      let timelineEmptyLpTimer = null;
      let hasTimelineEmptyLpFired = false;
      let timelineTweenRaf = null;

      // Touch 2-finger timeline 2D pinch-to-zoom state (Horizontal + Vertical)
      let isTimelinePinching = false;
      let timelinePinchStartDist = 0;
      let timelinePinchStartSpanX = 0;
      let timelinePinchStartSpanY = 0;
      let timelinePinchStartPps = 80;
      let timelinePinchStartVScale = 1.0;
      let timelinePinchAnchorSec = 0;
      let timelinePinchEndTime = 0;
      window.isTimelinePinching = false;
      window.timelinePinchEndTime = 0;
      if (typeof window.currentTimelineVerticalScale !== 'number') {
        window.currentTimelineVerticalScale = 1.0;
      }

      function getTimelineRowPitch() {
        const track = document.getElementById('timeline-layers-track');
        if (track) {
          const lanes = track.querySelectorAll('.timeline-track-lane');
          if (lanes.length >= 2) {
            const diff = lanes[1].offsetTop - lanes[0].offsetTop;
            if (diff > 16) return diff;
          }
          if (lanes.length === 1 && lanes[0].offsetHeight > 12) {
            const vScale = window.currentTimelineVerticalScale || 1.0;
            const isCompact = !window.isDesktop && !document.querySelector('.desktop-viewport');
            const gap = isCompact ? Math.max(3, Math.round(6 * vScale)) : 10;
            return lanes[0].offsetHeight + gap;
          }
        }
        const isCompactVp = !window.isDesktop && !document.querySelector('.desktop-viewport');
        if (!isCompactVp) return 54;
        const vScale = window.currentTimelineVerticalScale || 1.0;
        return Math.round(34 * vScale) + Math.max(3, Math.round(6 * vScale));
      }
      window.getTimelineRowPitch = getTimelineRowPitch;

      function setTimelineVerticalZoom(newVScale, anchorClientY) {
        if (document.querySelector('.desktop-workstation, .desktop-viewport')) return;
        const clampedScale = Math.max(0.68, Math.min(2.25, Number(newVScale) || 1.0));
        const prevScale = window.currentTimelineVerticalScale || 1.0;
        if (Math.abs(clampedScale - prevScale) < 0.008) return;

        const prevPitch = getTimelineRowPitch();
        window.currentTimelineVerticalScale = clampedScale;

        const timelineContainer = document.getElementById('main-editor-timeline');
        if (timelineContainer) {
          const laneH = Math.round(34 * clampedScale);
          const clipH = Math.round(30 * clampedScale);
          const gapH = Math.max(3, Math.round(6 * clampedScale));
          const childLaneH = Math.round(26 * clampedScale);
          const childClipH = Math.round(22 * clampedScale);
          timelineContainer.style.setProperty('--tl-mobile-lane-height', `${laneH}px`);
          timelineContainer.style.setProperty('--tl-mobile-clip-height', `${clipH}px`);
          timelineContainer.style.setProperty('--tl-mobile-lane-gap', `${gapH}px`);
          timelineContainer.style.setProperty('--tl-mobile-child-lane-height', `${childLaneH}px`);
          timelineContainer.style.setProperty('--tl-mobile-child-clip-height', `${childClipH}px`);
        }

        if (typeof window._invalidateTimelineLanePitchCache === 'function') {
          window._invalidateTimelineLanePitchCache();
        }

        if (layersViewport && prevPitch > 0) {
          const newPitch = Math.round(34 * clampedScale) + Math.max(3, Math.round(6 * clampedScale));
          const vpRect = layersViewport.getBoundingClientRect();
          const localAnchorY = (typeof anchorClientY === 'number' && vpRect.height > 0)
            ? Math.max(0, Math.min(vpRect.height, anchorClientY - vpRect.top))
            : (vpRect.height * 0.5);
          const contentYBefore = layersViewport.scrollTop + localAnchorY;
          const contentYAfter = contentYBefore * (newPitch / prevPitch);
          const maxScroll = Math.max(0, layersViewport.scrollHeight - layersViewport.clientHeight);
          layersViewport.scrollTop = Math.max(0, Math.min(maxScroll, Math.round(contentYAfter - localAnchorY)));
        }

        if (typeof renderTimelineLinkConnectors === 'function') {
          renderTimelineLinkConnectors();
        }
        if (window._activeTimelineItemDrag && typeof window._activeTimelineItemDrag.onViewportChanged === 'function') {
          window._activeTimelineItemDrag.onViewportChanged();
        }
      }
      window.setTimelineVerticalZoom = setTimelineVerticalZoom;

      // Shared helper for smooth vertical layer lane reordering (used by both reorder pill & clip hold-drag)
      window._TimelineVerticalReorderHelper = {
        createSession(primaryLayerId, startClientY) {
          const curLayers = (currentProjectState && currentProjectState.layers) ? currentProjectState.layers : [];
          const originalIndex = curLayers.findIndex(l => l.id === primaryLayerId);
          if (originalIndex < 0) return null;

          const isMulti = selectedLayerIds && selectedLayerIds.has(primaryLayerId) && selectedLayerIds.size > 1;
          const movingIdSet = isMulti ? new Set(selectedLayerIds) : new Set([primaryLayerId]);
          const movingLayers = curLayers.filter(l => movingIdSet.has(l.id));
          const movingIndices = movingLayers.map(l => curLayers.findIndex(x => x.id === l.id)).sort((a, b) => a - b);
          const movingCount = movingLayers.length;

          const reorderOverlay = document.getElementById('timeline-lane-reorder-overlay');
          const overlayContainer = document.getElementById('timeline-lane-heads-overlay');
          const trackEl = document.getElementById('timeline-layers-track');
          if (!trackEl) return null;

          const movingPills = [];
          const movingLanes = [];
          const movingLeftSlots = [];
          movingIdSet.forEach(id => {
            const p = reorderOverlay ? reorderOverlay.querySelector(`.timeline-layer-reorder-pill[data-layer-id="${id}"]`) : null;
            const l = trackEl.querySelector(`.timeline-track-lane[data-layer-id="${id}"]`);
            const s = overlayContainer ? overlayContainer.querySelector(`.timeline-lane-pill-slot[data-layer-id="${id}"]`) : null;
            if (p) movingPills.push(p);
            if (l) movingLanes.push(l);
            if (s) movingLeftSlots.push(s);
          });

          const allLanes = Array.from(trackEl.querySelectorAll('.timeline-track-lane'));
          const allLeftSlots = overlayContainer ? Array.from(overlayContainer.querySelectorAll('.timeline-lane-pill-slot')) : [];
          const allRightSlots = reorderOverlay ? Array.from(reorderOverlay.querySelectorAll('.timeline-lane-reorder-slot')) : [];

          let lastClientY = startClientY;
          const startScrollTopVal = layersViewport ? layersViewport.scrollTop : 0;
          let currentDropIdx = originalIndex;
          let isActiveVertical = false;

          return {
            get isActive() { return isActiveVertical; },
            get currentDropIdx() { return currentDropIdx; },
            movingIdSet,
            movingLayers,
            update(clientY, activateThresholdPx = 0) {
              if (typeof clientY === 'number') lastClientY = clientY;
              const scrollDelta = layersViewport ? (layersViewport.scrollTop - startScrollTopVal) : 0;
              const rawDeltaY = (lastClientY - startClientY) + scrollDelta;

              if (!isActiveVertical) {
                if (Math.abs(rawDeltaY) < activateThresholdPx) return false;
                isActiveVertical = true;
                movingPills.forEach(p => p.classList.add('is-dragging'));
                movingLanes.forEach(l => l.classList.add('is-dragging'));
                movingLeftSlots.forEach(s => s.classList.add('is-dragging'));
              }

              const rowPitch = getTimelineRowPitch();
              const minMovingIdx = movingIndices.length > 0 ? movingIndices[0] : originalIndex;
              const maxMovingIdx = movingIndices.length > 0 ? movingIndices[movingIndices.length - 1] : originalIndex;
              const minDeltaY = -minMovingIdx * rowPitch;
              const maxDeltaY = (curLayers.length - 1 - maxMovingIdx) * rowPitch;
              const clampedDeltaY = Math.max(minDeltaY - 10, Math.min(maxDeltaY + 10, rawDeltaY));

              movingPills.forEach(p => { p.style.transform = `translateY(${clampedDeltaY}px)`; });
              movingLanes.forEach(l => { l.style.transform = `translateY(${clampedDeltaY}px)`; });
              movingLeftSlots.forEach(s => { s.style.transform = `translateY(${clampedDeltaY}px)`; });

              const vpRect = layersViewport ? layersViewport.getBoundingClientRect() : { top: 0 };
              const vpY = lastClientY - vpRect.top + (layersViewport ? layersViewport.scrollTop : 0);
              currentDropIdx = Math.max(0, Math.min(curLayers.length, Math.round(vpY / rowPitch)));

              const remainingLayers = curLayers.filter(l => !movingIdSet.has(l.id));
              let insertIdx = remainingLayers.length;
              for (let j = currentDropIdx; j < curLayers.length; j++) {
                if (!movingIdSet.has(curLayers[j].id)) {
                  const rIdx = remainingLayers.indexOf(curLayers[j]);
                  if (rIdx !== -1) {
                    insertIdx = rIdx;
                    break;
                  }
                }
              }

              allLanes.forEach((otherLane, idx) => {
                const lObj = curLayers[idx];
                if (!lObj || movingIdSet.has(lObj.id)) return;
                const movingAbove = movingIndices.filter(mIdx => mIdx < idx).length;
                const remIdx = idx - movingAbove;
                const shiftRows = (remIdx < insertIdx) ? -movingAbove : (movingCount - movingAbove);
                const shift = shiftRows * rowPitch;
                otherLane.style.transform = shift ? `translateY(${shift}px)` : '';
                if (allLeftSlots[idx]) allLeftSlots[idx].style.transform = shift ? `translateY(${shift}px)` : '';
                if (allRightSlots[idx]) allRightSlots[idx].style.transform = shift ? `translateY(${shift}px)` : '';
              });
              return true;
            },
            finish(commit) {
              movingPills.forEach(p => { p.classList.remove('is-dragging'); p.style.transform = ''; });
              movingLanes.forEach(l => { l.classList.remove('is-dragging'); l.style.transform = ''; });
              movingLeftSlots.forEach(s => { s.classList.remove('is-dragging'); s.style.transform = ''; });
              allLanes.forEach(l => { l.style.transform = ''; });
              allLeftSlots.forEach(s => { s.style.transform = ''; });
              allRightSlots.forEach(s => { s.style.transform = ''; });

              if (!commit || !isActiveVertical || !currentProjectState.layers || currentDropIdx < 0) return false;
              const reorderFn = window.reorderLayersBatch || (typeof reorderLayersBatch === 'function' ? reorderLayersBatch : null);
              if (!reorderFn) return false;
              const reordered = reorderFn(currentProjectState.layers, movingIdSet, currentDropIdx);
              const changed = reordered.some((l, idx) => l.id !== currentProjectState.layers[idx].id);
              if (changed) {
                currentProjectState.layers = reordered;
                movingLayers.forEach(movedItem => {
                  if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(movedItem);
                });
              }
              return changed;
            }
          };
        }
      };

      function onPanStart(e) {
        // On desktop workstation, timeline scrubbing is handled by ruler seek / playhead drag and marquee
        if (document.querySelector('.desktop-workstation, .desktop-viewport')) return;
        if (isTimelinePinching || window.isTimelinePinching || (timelinePinchEndTime && Date.now() - timelinePinchEndTime < 250)) return;
        if (isPanning) return; // Already panning with another pointer
        if (isPlaying) {
          pausePlayback();
        }
        if (timelineTweenRaf) {
          cancelAnimationFrame(timelineTweenRaf);
          timelineTweenRaf = null;
        }
        if (e.button !== undefined && e.button !== 0) return;

        // Multi-touch support: if Finger 1 is already dragging a layer/clip/handle/pill,
        // allow Finger 2 (different pointerId) to pan/scroll the timeline anywhere!
        const hasOtherActiveItemDrag = Boolean(
          window._activeTimelineItemDrag &&
          window._activeTimelineItemDrag.pointerId !== undefined &&
          window._activeTimelineItemDrag.pointerId !== e.pointerId
        );

        if (!hasOtherActiveItemDrag) {
          if (e.target.closest('.timeline-clip-block') || e.target.closest('.timeline-layer-ctrl-pill') || e.target.closest('.timeline-layer-reorder-pill') || e.target.closest('.timeline-beatmark-item')) return; // Allow clip and pill interactions
        }

        isPanning = true;
        panPointerId = e.pointerId !== undefined ? e.pointerId : null;
        window.isTimelinePanning = true;
        window.isTimelineScrubbing = true;
        startX = e.clientX;
        startY = e.clientY;
        startPanX = panX;
        startScrollTop = layersViewport ? layersViewport.scrollTop : 0;
        isLayersDrag = !!e.target.closest('#timeline-layers-viewport');
        isRulerDrag = !!e.target.closest('.timeline-header-ruler') || !!e.target.closest('#timeline-ruler-viewport');

        if (isRulerDrag) {
          rulerStartZoomPps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
          rulerAnchorSec = getCurrentPlayheadTime();
        }

        // Long-press timer on empty timeline space (450ms hold -> open context menu popover like right click)
        if (isLayersDrag && !hasOtherActiveItemDrag) {
          hasTimelineEmptyLpFired = false;
          const lpX = e.clientX;
          const lpY = e.clientY;
          timelineEmptyLpTimer = setTimeout(() => {
            hasTimelineEmptyLpFired = true;
            if (isPanning) {
              isPanning = false;
              panPointerId = null;
              if (window.FishAudioEngine) window.FishAudioEngine.stopScrub();
              if (rulerViewport) rulerViewport.classList.remove('is-dragging');
              if (layersViewport) layersViewport.classList.remove('is-dragging');
            }
            if (navigator.vibrate) navigator.vibrate(25);
            triggerEmptyTimelineContextMenu(lpX, lpY);
          }, 450);
        }

        if (window.FishAudioEngine) {
          window.FishAudioEngine.startScrub();
        }

        if (rulerViewport) rulerViewport.classList.add('is-dragging');
        if (layersViewport) layersViewport.classList.add('is-dragging');

        // Mute video/audio during scrub to eliminate clicks/crackles
        const layers = currentProjectState.layers || [];
        layers.forEach(layer => {
          if (layer.type === 'video' || layer.type === 'audio') {
            const media = getOrLoadLayerMedia(layer);
            if (media && media.el) {
              try { media.el.pause(); } catch (_) {}
            }
          }
        });
      }

      function onPanMove(e) {
        if (!isPanning || isTimelinePinching || window.isTimelinePinching) return;
        if (panPointerId !== null && e.pointerId !== undefined && e.pointerId !== panPointerId) return;

        // Safari coalesces pointermove events between frames, adding ~16ms latency.
        // getCoalescedEvents() recovers intermediate positions for silky-smooth scrubbing.
        // We use the LAST coalesced event as the most up-to-date position.
        const coalescedEvents = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : null;
        const lastEvent = (coalescedEvents && coalescedEvents.length > 0) ? coalescedEvents[coalescedEvents.length - 1] : e;

        const deltaX = lastEvent.clientX - startX;
        const deltaY = lastEvent.clientY - startY;

        // Cancel empty timeline long-press if user moves pointer beyond slight jitter threshold
        if (timelineEmptyLpTimer && (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6)) {
          clearTimeout(timelineEmptyLpTimer);
          timelineEmptyLpTimer = null;
        }

        // Multi-directional Ruler Gesture:
        // - Slide Up/Down: dynamic zoom in (renggangkan) / zoom out (rapatkan)
        // - Slide Left/Right: timeline scrub
        if (isRulerDrag) {
          let activePps = rulerStartZoomPps;
          if (Math.abs(deltaY) > 3) {
            // Slide up (deltaY < 0): zoom in (renggang)
            // Slide down (deltaY > 0): zoom out (rapat)
            const zoomRatio = Math.pow(1.008, -deltaY);
            const targetPps = Math.max(20, Math.min(1800, Math.round(rulerStartZoomPps * zoomRatio)));
            if (targetPps !== pixelsPerSecond) {
              setTimelineZoom(targetPps, rulerAnchorSec);
            }
            activePps = window.currentPixelsPerSecond || pixelsPerSecond;
          }

          const targetSec = Math.max(0, rulerAnchorSec - (deltaX / activePps));
          const totalDur = getProjectTotalDuration();
          const clampedSec = Math.min(totalDur, targetSec);
          // Snap playhead to exact frame boundary when scrubbing on ruler
          const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (window.currentTimelineFps || currentFps || 60);
          const snappedSec = Math.round(clampedSec * safeFps) / safeFps;
          const targetPanX = -snappedSec * activePps;

          const bounds = getTimelineBounds();
          const finalPanX = Math.max(bounds.min, Math.min(bounds.max, targetPanX));

          const needle = document.getElementById('timeline-center-needle');
          if (needle) needle.classList.remove('is-snapped');
          window._lastScrubSnapPx = null;

          updateTimelinePosition(finalPanX);
          if (window._activeTimelineItemDrag && typeof window._activeTimelineItemDrag.onViewportChanged === 'function') {
            window._activeTimelineItemDrag.onViewportChanged();
          }
          return;
        }

        const bounds = getTimelineBounds();
        let targetPanX = startPanX + deltaX;

        // Constrain targetPanX within timeline bounds first (prevent overshoot beyond 0 or max length)
        if (targetPanX > 0) {
          targetPanX = 0;
        } else if (targetPanX < bounds.min) {
          targetPanX = bounds.min;
        }

        // Quantize scrubbing to exact project FPS frame boundary
        const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (window.currentTimelineFps || currentFps || 60);
        const activePps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const rawSec = Math.max(0, -targetPanX / activePps);
        const snappedSec = Math.round(rawSec * safeFps) / safeFps;
        targetPanX = -snappedSec * activePps;

        // Pure smooth playhead scrubbing without snapping to beatmarks or layer start/end
        const needle = document.getElementById('timeline-center-needle');
        if (needle) needle.classList.remove('is-snapped');
        window._lastScrubSnapPx = null;

        // Scrub timeline horizontally
        updateTimelinePosition(targetPanX);

        // Pan layers vertically if scrubbing inside layers viewport
        if (isLayersDrag && layersViewport) {
          layersViewport.scrollTop = startScrollTop - deltaY;
        }

        // Notify any active Finger 1 drag (reorder / clip slide / trim / pill select) so it updates live
        if (window._activeTimelineItemDrag && typeof window._activeTimelineItemDrag.onViewportChanged === 'function') {
          window._activeTimelineItemDrag.onViewportChanged();
        }
      }

      function onPanEnd(e) {
        if (panPointerId !== null && e && e.pointerId !== undefined && e.pointerId !== panPointerId) {
          return;
        }
        if (timelineEmptyLpTimer) {
          clearTimeout(timelineEmptyLpTimer);
          timelineEmptyLpTimer = null;
        }

        const needle = document.getElementById('timeline-center-needle');
        if (needle) needle.classList.remove('is-snapped');
        window._lastScrubSnapPx = null;

        if (isTimelinePinching || window.isTimelinePinching || (timelinePinchEndTime && Date.now() - timelinePinchEndTime < 250)) {
          isPanning = false;
          panPointerId = null;
          window.isTimelinePanning = false;
          window.isTimelineScrubbing = false;
          if (rulerViewport) rulerViewport.classList.remove('is-dragging');
          if (layersViewport) layersViewport.classList.remove('is-dragging');
          return;
        }

        if (hasTimelineEmptyLpFired) {
          hasTimelineEmptyLpFired = false;
          if (isPanning) {
            isPanning = false;
            panPointerId = null;
            if (window.FishAudioEngine) window.FishAudioEngine.stopScrub();
            if (rulerViewport) rulerViewport.classList.remove('is-dragging');
            if (layersViewport) layersViewport.classList.remove('is-dragging');
          }
          return;
        }

        if (!isPanning) return;
        isPanning = false;
        panPointerId = null;
        window.isTimelinePanning = false;
        window.isTimelineScrubbing = false;

        if (window.FishAudioEngine) {
          window.FishAudioEngine.stopScrub();
        }

        // Align exactly to nearest project FPS frame when parking (for both ruler drag and layers drag)
        const rawSec = getCurrentPlayheadTime();
        const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (window.currentTimelineFps || currentFps || 60);
        const finalSnappedSec = Math.round(rawSec * safeFps) / safeFps;
        const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
        updateTimelinePosition(-finalSnappedSec * pps, true);

        isRulerDrag = false;

        const curSec = getCurrentPlayheadTime();

        if (rulerViewport) rulerViewport.classList.remove('is-dragging');
        if (layersViewport) layersViewport.classList.remove('is-dragging');

        // Precise park seek on active unmuted audio streams + frame extractor priority for video/precomp
        const layers = currentProjectState.layers || [];
        layers.forEach(layer => {
          if (layer.type === 'video' || layer.type === 'precomp') {
            const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
            const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pixelsPerSecond);
            if (curSec >= start && curSec < start + dur && window.VideoFrameExtractor) {
              window.VideoFrameExtractor.extractLayerRange(layer);
            }
          }
          if ((layer.type === 'audio' || layer.type === 'video') && !layer.isMuted) {
            const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
            const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pixelsPerSecond);
            if (curSec >= start && curSec < start + dur) {
              const timeInClip = window.VideoCompEngine.computeLayerClipTime(layer, curSec, pixelsPerSecond);
              const media = getOrLoadLayerMedia(layer);
              if (media && media.el) {
                window.VideoCompEngine.seekVideoElementCoalesced(media.el, timeInClip, false);
              }
            }
          }
        });
        if (window.FishAudioEngine && typeof window.FishAudioEngine.parkPlayback === 'function' && !isAnyPlaybackActive()) {
          window.FishAudioEngine.parkPlayback(layers, curSec, pixelsPerSecond);
        }
        if (typeof updateReorderHandlesContrast === 'function') {
          updateReorderHandlesContrast();
        }
        redrawComposition('scrubEnd');
        if (window.PreviewCacheManager && typeof window.PreviewCacheManager.refreshBaselineSnapshot === 'function') {
          window.PreviewCacheManager.refreshBaselineSnapshot(currentProjectState);
        }

        // Stationary tap on empty timeline space (not a drag scrub and no active item drag): deselect active layer
        const moveDist = Math.hypot((e ? e.clientX : startX) - startX, (e ? e.clientY : startY) - startY);
        const targetEl = (e && e.target && e.target.nodeType === 1)
          ? e.target
          : (e && e.target && e.target.parentElement ? e.target.parentElement : null);
        const isInsideTimelineInteractive = targetEl && typeof targetEl.closest === 'function' && (
          targetEl.closest('.timeline-clip-block') ||
          targetEl.closest('.timeline-layer-ctrl-pill') ||
          targetEl.closest('.timeline-layer-reorder-pill')
        );

        if (e && moveDist < 4 && isLayersDrag && !isInsideTimelineInteractive && !window._activeTimelineItemDrag) {
          if (typeof deselectTimelineLayer === 'function' && (window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size > 0) || isSelectorMode)) {
            deselectTimelineLayer();
          }
        }
      }

      [rulerViewport, layersViewport].forEach(vp => {
        if (!vp) return;
        vp.addEventListener('pointerdown', onPanStart);
      });

      window.addEventListener('pointermove', onPanMove, { passive: true });
      window.addEventListener('pointerup', onPanEnd);
      window.addEventListener('pointercancel', onPanEnd);

      // Wheel on Ruler Viewport: Zoom In / Out Timeline Scale
      if (rulerViewport) {
        rulerViewport.addEventListener('wheel', (e) => {
          if (document.querySelector('.desktop-workstation, .desktop-viewport')) return;
          e.preventDefault();
          const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
          if (delta === 0) return;
          // Zoom in when scrolling up (delta < 0), zoom out when scrolling down (delta > 0)
          const zoomFactor = delta < 0 ? 1.15 : 0.87;
          setTimelineZoom(pixelsPerSecond * zoomFactor);
        }, { passive: false });

        // Double-click on Ruler Viewport: Reset timeline zoom to default (80 pps & 1.0x vertical scale)
        rulerViewport.addEventListener('dblclick', () => {
          if (document.querySelector('.desktop-workstation, .desktop-viewport')) return;
          setTimelineZoom(80);
          setTimelineVerticalZoom(1.0);
        });
      }

      // Touch 2-Finger 2D Pinch-to-Zoom Gesture on Timeline (Horizontal + Vertical)
      function onTimelineTouchStart(e) {
        if (e.touches && e.touches.length === 2) {
          // If Finger 1 is actively dragging a layer/clip/handle/pill, DO NOT enter pinch-to-zoom!
          // This lets Finger 2 freely pan/scroll the timeline simultaneously (multi-touch workflow).
          if (window._activeTimelineItemDrag) {
            return;
          }
          isTimelinePinching = true;
          window.isTimelinePinching = true;
          if (isPanning) {
            isPanning = false;
            panPointerId = null;
            window.isTimelinePanning = false;
            window.isTimelineScrubbing = false;
            if (timelineEmptyLpTimer) {
              clearTimeout(timelineEmptyLpTimer);
              timelineEmptyLpTimer = null;
            }
            if (window.FishAudioEngine) window.FishAudioEngine.stopScrub();
            if (rulerViewport) rulerViewport.classList.remove('is-dragging');
            if (layersViewport) layersViewport.classList.remove('is-dragging');
          }
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const dx = Math.abs(t1.clientX - t2.clientX);
          const dy = Math.abs(t1.clientY - t2.clientY);
          timelinePinchStartDist = Math.hypot(dx, dy);
          timelinePinchStartSpanX = dx;
          timelinePinchStartSpanY = dy;
          timelinePinchStartPps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
          timelinePinchStartVScale = window.currentTimelineVerticalScale || 1.0;
          timelinePinchAnchorSec = (typeof getCurrentPlayheadTime === 'function')
            ? getCurrentPlayheadTime()
            : (window.currentPlaybackSec || 0);
          if (e.cancelable) e.preventDefault();
        }
      }

      function onTimelineTouchMove(e) {
        if (isTimelinePinching && e.touches && e.touches.length === 2) {
          if (window._activeTimelineItemDrag) {
            isTimelinePinching = false;
            window.isTimelinePinching = false;
            return;
          }
          if (e.cancelable) e.preventDefault();
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const dx = Math.abs(t1.clientX - t2.clientX);
          const dy = Math.abs(t1.clientY - t2.clientY);
          const currDist = Math.hypot(dx, dy);
          const midY = (t1.clientY + t2.clientY) * 0.5;

          const deltaSpanX = Math.abs(dx - timelinePinchStartSpanX);
          const deltaSpanY = Math.abs(dy - timelinePinchStartSpanY);

          // 1. Horizontal Zoom (kanan-kiri): when horizontal finger spread changes
          if (timelinePinchStartSpanX >= 22 && deltaSpanX > 4) {
            const zoomRatioX = dx / timelinePinchStartSpanX;
            const targetPps = Math.max(20, Math.min(1800, Math.round(timelinePinchStartPps * zoomRatioX)));
            if (targetPps !== pixelsPerSecond) {
              setTimelineZoom(targetPps, timelinePinchAnchorSec);
            }
          } else if (timelinePinchStartDist > 10 && deltaSpanX >= deltaSpanY * 1.15) {
            const zoomRatio = currDist / timelinePinchStartDist;
            const targetPps = Math.max(20, Math.min(1800, Math.round(timelinePinchStartPps * zoomRatio)));
            if (targetPps !== pixelsPerSecond) {
              setTimelineZoom(targetPps, timelinePinchAnchorSec);
            }
          }

          // 2. Vertical Zoom (atas-bawah): when vertical finger spread changes
          if (timelinePinchStartSpanY >= 22 && deltaSpanY > 4) {
            const zoomRatioY = dy / timelinePinchStartSpanY;
            const targetVScale = timelinePinchStartVScale * zoomRatioY;
            setTimelineVerticalZoom(targetVScale, midY);
          } else if (timelinePinchStartDist > 10 && deltaSpanY > deltaSpanX * 1.35) {
            const zoomRatio = currDist / timelinePinchStartDist;
            const targetVScale = timelinePinchStartVScale * zoomRatio;
            setTimelineVerticalZoom(targetVScale, midY);
          }
        }
      }

      function onTimelineTouchEnd(e) {
        if (isTimelinePinching) {
          if (!e.touches || e.touches.length < 2) {
            isTimelinePinching = false;
            window.isTimelinePinching = false;
            timelinePinchEndTime = Date.now();
            window.timelinePinchEndTime = timelinePinchEndTime;
          }
        }
      }

      const timelineEl = document.getElementById('main-editor-timeline') || (rulerViewport && rulerViewport.parentElement);
      if (timelineEl) {
        timelineEl.addEventListener('touchstart', onTimelineTouchStart, { passive: false });
        timelineEl.addEventListener('touchmove', onTimelineTouchMove, { passive: false });
        timelineEl.addEventListener('touchend', onTimelineTouchEnd, { passive: true });
        timelineEl.addEventListener('touchcancel', onTimelineTouchEnd, { passive: true });
      }

      // Wheel on Layers Viewport: Vertical scroll for layers, or Shift+Wheel for horizontal pan
      if (layersViewport) {
        layersViewport.addEventListener('scroll', () => {
          if (layersViewport.scrollLeft !== 0) {
            layersViewport.scrollLeft = 0;
          }
          if (window._activeTimelineItemDrag && typeof window._activeTimelineItemDrag.onViewportChanged === 'function') {
            window._activeTimelineItemDrag.onViewportChanged();
          }
        }, { passive: true });

        layersViewport.addEventListener('wheel', (e) => {
          if (document.querySelector('.desktop-workstation, .desktop-viewport') || (typeof isDesktopLayout === 'function' && isDesktopLayout())) return;
          // Trackpad pinch-to-zoom on timeline
          if (e.ctrlKey) {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.05 : 0.95;
            setTimelineZoom(pixelsPerSecond * zoomFactor);
            return;
          }
          // Shift + Wheel or horizontal trackpad wheel scrubs timeline horizontally
          if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            e.preventDefault();
            if (isPlaying) pausePlayback();
            const delta = e.deltaX !== 0 ? -e.deltaX : -e.deltaY;
            updateTimelinePosition(panX + delta);
            if (layersViewport.scrollLeft !== 0) layersViewport.scrollLeft = 0;
          } else {
            if (layersViewport.scrollLeft !== 0) layersViewport.scrollLeft = 0;
          }
          // Otherwise, native vertical scroll scrolls layers up and down smoothly
        }, { passive: false });
      }

      // Contextmenu on Empty Timeline (Viewport / Track Background)
      if (layersViewport) {
        layersViewport.addEventListener('contextmenu', (e) => {
          // If right-clicked on a clip or pill slot, their dedicated contextmenu listener handled it
          if (e.target.closest('.timeline-clip-block') || e.target.closest('.timeline-lane-pill-slot') || e.target.closest('.timeline-layer-ctrl-pill')) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          triggerEmptyTimelineContextMenu(e.clientX, e.clientY, e);
        });
      }

      const laneHeadsOverlay = document.getElementById('timeline-lane-heads-overlay');
      if (laneHeadsOverlay) {
        laneHeadsOverlay.addEventListener('contextmenu', (e) => {
          if (e.target.closest('.timeline-lane-pill-slot') || e.target.closest('.timeline-layer-ctrl-pill')) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          triggerEmptyTimelineContextMenu(e.clientX, e.clientY, e);
        });
      }

      function stepPlay(timestamp) {
        if (window.isExporting) {
          pausePlayback(false);
          return;
        }
        if (!isPlaying) return;

        // Safari (and all browsers) throttle rAF on hidden tabs — pause gracefully
        // and reset the time anchor so playback resumes without a jump.
        if (document.hidden) {
          lastTime = 0;
          playAnimationId = requestAnimationFrame(stepPlay);
          return;
        }

        if (!lastTime) lastTime = timestamp;
        const rawDeltaSec = (timestamp - lastTime) / 1000;

        const bounds = getTimelineBounds();
        if (bounds.min >= bounds.max) {
          pausePlayback();
          return;
        }

        const fps = (typeof getProjectFps === 'function')
          ? getProjectFps()
          : ((window.PreviewCacheManager && window.PreviewCacheManager.fps)
            || window.currentTimelineFps
            || (currentProjectState && currentProjectState.fps ? parseInt(currentProjectState.fps, 10) : 60)
            || 60);
        const frameDuration = 1 / fps;
        const pixelsPerFrame = pixelsPerSecond / fps;

        const isFirstTick = (_playTickCount === 0);
        const currentSec = Math.max(0, -panX / pixelsPerSecond);
        const layers = currentProjectState.layers || [];
        const currentFrameIdx = Math.round(currentSec * fps);
        const nextFrameIdx = currentFrameIdx + 1;

        const isCacheEnabled = !!(window.PreviewCacheManager && window.isPreviewCacheEnabled !== false);
        const isNextFrameCached = isCacheEnabled && window.PreviewCacheManager.hasFrame(nextFrameIdx);
        const isCurrentAndNextCached = isNextFrameCached && window.PreviewCacheManager.hasFrame(currentFrameIdx);

        // Adaptive Refresh Throttle:
        // Only throttle sub-frame rAF ticks when project FPS is lower than display refresh rate (e.g. 24fps/30fps on 60Hz/120Hz).
        // Never throttle at >= 50fps so 60fps rAF ticks are never dropped due to 1-2ms browser scheduling jitter!
        if (!isFirstTick && fps < 50 && rawDeltaSec < frameDuration * 0.72 && !isCurrentAndNextCached) {
          playAnimationId = requestAnimationFrame(stepPlay);
          return;
        }
        lastTime = timestamp;

        // Background tab throttling protection: reset anchor if tab was backgrounded > 1s
        if (rawDeltaSec > 1.0) {
          playAnimationId = requestAnimationFrame(stepPlay);
          return;
        }

        const playbackSpeed = (typeof window.timelinePlaybackSpeed === 'number' && window.timelinePlaybackSpeed > 0)
          ? window.timelinePlaybackSpeed
          : 1.0;

        // 1. After Effects Real-Time + Gapless RAM Preview Clock:
        // Never double-render on a single rAF tick when uncached; step 1 contiguous frame at a time.
        const canMultiStepCatchUp = false;

        let effectiveDeltaSec;
        if (isFirstTick) {
          effectiveDeltaSec = Math.max(frameDuration, Math.min(frameDuration * 2.0, rawDeltaSec || frameDuration)) * playbackSpeed;
        } else if (isCacheEnabled && !isNextFrameCached) {
          effectiveDeltaSec = frameDuration * playbackSpeed;
        } else {
          effectiveDeltaSec = Math.min(Math.max(frameDuration * 2.5, 0.05), Math.max(0, rawDeltaSec)) * playbackSpeed;
        }

        let nextSec = currentSec + effectiveDeltaSec;
        let masterSlaved = false;
        if (isFirstTick) {
          // Anchor for audio-clock settle window (play start and every loop restart reset _playTickCount)
          window._nlePlayAnchorMs = timestamp;
        }
        const msSinceAnchor = timestamp - (window._nlePlayAnchorMs || 0);
        const audioSched = window.FishAudioScheduler;
        const schedRunning = !!(audioSched && audioSched.isClockRunning && audioSched.isClockRunning());
        let schedSlaved = false;
        if (isCacheEnabled && !isNextFrameCached && Math.abs(playbackSpeed - 1.0) < 0.01) {
          // Contiguous frame stepping (1 frame at a time so zero frames are skipped while building cache)
          nextSec = nextFrameIdx / fps;
        } else if (schedRunning && (isCurrentAndNextCached || !isCacheEnabled) && Math.abs(playbackSpeed - 1.0) < 0.01) {
          // Web Audio scheduler clock (AudioContext time, output-latency compensated) drives the playhead:
          // picture and sound share ONE sample-accurate clock, so they cannot drift and never stall after seek/loop.
          const schedSec = audioSched.getTimelineSec();
          if (schedSec !== null && isFinite(schedSec) && Math.abs(schedSec - nextSec) < 0.25) {
            nextSec = Math.max(currentSec, schedSec);
            schedSlaved = true;
          }
        } else if (_playTickCount >= 3 && msSinceAnchor >= 450 && (isCurrentAndNextCached || !isCacheEnabled) && Math.abs(playbackSpeed - 1.0) < 0.01 && window.FishAudioEngine && typeof window.FishAudioEngine.getMasterAudioTime === 'function') {
          // Keep the playhead in sync with the hardware audio clock, but SOFTLY.
          // Hard-snapping to the audio time froze the playhead whenever the audio clock stalled or updated coarsely
          // (always right after a seek, e.g. loop restart) => cached playback looked like it was "re-rendering".
          // Wall-clock drives motion; audio only pulls it gently, so long-term sync is kept without stutter.
          const masterAudioSec = window.FishAudioEngine.getMasterAudioTime(layers, nextSec, pixelsPerSecond);
          if (masterAudioSec !== null && isFinite(masterAudioSec) && Math.abs(masterAudioSec - nextSec) < 0.12) {
            const pulled = nextSec + (masterAudioSec - nextSec) * 0.15;
            nextSec = Math.max(currentSec + effectiveDeltaSec * 0.5, pulled);
            masterSlaved = true;
          }
        }
        if (!masterSlaved && window.FishAudioEngine) {
          // Master audio is exempt from drift correction. If we are NOT slaved to it (lagging, uncached, or drift too large),
          // release it so correctPlaybackDrift keeps audio locked to the timeline (otherwise drift grows unchecked = "kadang sync kadang tidak").
          window.FishAudioEngine._masterAudioElement = null;
        }

        if (isCacheEnabled && isCurrentAndNextCached) {
          const targetFrameIdx = Math.round(nextSec * fps);
          if (targetFrameIdx > nextFrameIdx) {
            let maxContiguousFrame = nextFrameIdx;
            while (maxContiguousFrame < targetFrameIdx && window.PreviewCacheManager.hasFrame(maxContiguousFrame + 1)) {
              maxContiguousFrame++;
            }
            if (maxContiguousFrame < targetFrameIdx) {
              nextSec = maxContiguousFrame / fps;
            }
          }
        }

        // 2. Measured Slow-Mo Audio Ratio:
        // Audio rate must follow the timeline's REAL achieved speed (timeline advance / wall clock), not a lagging
        // frame-time guess, otherwise audio runs ahead during lag (drift -> hard seek stutter) or falls behind after.
        if (isFirstTick || window._nleSpeedEma === undefined) {
          window._nleSmoothedFrameSec = frameDuration;
          window._nleSpeedEma = 1.0;
          window._nleSteppedAudioRatio = 1.0;
          window._nleLastAudioStepMs = timestamp;
        } else if (rawDeltaSec > 0 && rawDeltaSec <= 0.12) {
          // Ignore >120ms hitches (GC / tab stall): those are not sustained effect lag
          const advancedSec = Math.max(0, nextSec - currentSec);
          const instRatio = Math.max(0, Math.min(1.25, advancedSec / (Math.max(0.004, rawDeltaSec) * playbackSpeed)));
          window._nleSpeedEma = window._nleSpeedEma * 0.80 + instRatio * 0.20;
          window._nleSmoothedFrameSec = frameDuration / Math.max(0.05, window._nleSpeedEma);
        }

        let effectiveAudioSpeed = playbackSpeed;
        {
          const speedEma = window._nleSpeedEma;
          const heldRatio = window._nleSteppedAudioRatio || 1.0;
          if (speedEma >= 0.97) {
            // Full speed (cached / light frames): release to normal immediately
            window._nleSteppedAudioRatio = 1.0;
            window._nleLastAudioStepMs = timestamp;
          } else {
            const targetRatio = speedEma >= 0.93 ? 1.0 : Math.max(0.25, Math.round(speedEma * 20) / 20);
            const sinceStepMs = timestamp - (window._nleLastAudioStepMs || 0);
            // Short 120ms plateau hold keeps audio smooth while still tracking the real slow-mo within one step (0.05)
            if (sinceStepMs >= 120 && Math.abs(targetRatio - heldRatio) >= 0.05) {
              window._nleSteppedAudioRatio = targetRatio;
              window._nleLastAudioStepMs = timestamp;
            }
          }
          effectiveAudioSpeed = playbackSpeed * (window._nleSteppedAudioRatio || 1.0);
        }

        if (audioSched && audioSched.playing) {
          if (schedSlaved) {
            audioSched.setRate(playbackSpeed);
          } else {
            // Timeline drives (uncached slow-mo, non-1x speed, or clock diverged): follow its speed and
            // trim proportionally to drift; reseek only on large drift (with cooldown) to avoid clicks.
            const schedSec = audioSched.getTimelineSec();
            const drift = (schedSec !== null && isFinite(schedSec)) ? (schedSec - nextSec) : 0;
            const nowMsSched = timestamp;
            if (Math.abs(drift) > 0.3 && (!window._schedLastReseekMs || nowMsSched - window._schedLastReseekMs > 600)) {
              window._schedLastReseekMs = nowMsSched;
              audioSched.seek(nextSec);
              audioSched.setRate(effectiveAudioSpeed);
            } else if (!window._schedLastRateMs || nowMsSched - window._schedLastRateMs > 150) {
              window._schedLastRateMs = nowMsSched;
              const trim = Math.max(0.8, Math.min(1.2, 1.0 - (drift / Math.max(0.25, effectiveAudioSpeed)) * 0.9));
              audioSched.setRate(effectiveAudioSpeed * (Math.abs(drift) > 0.03 ? trim : 1.0));
            }
          }
        }

        let nextPan = -(nextSec * pixelsPerSecond);
        if (nextPan <= bounds.min) {
          if (window.isPlaybackLoopEnabled !== false) {
            nextPan = bounds.max;
            nextSec = Math.abs(bounds.max) / pixelsPerSecond;
            lastTime = timestamp;
            _playTickCount = 0;
            window._nleSmoothedFrameSec = frameDuration;
            window._nleSteppedAudioRatio = 1.0;
            window._nleLastAudioStepMs = timestamp;
            if (audioSched && audioSched.playing) {
              audioSched.seek(nextSec);
            }
            if (window.FishAudioEngine && typeof window.FishAudioEngine.handleLoopReset === 'function') {
              window.FishAudioEngine.handleLoopReset(layers, nextSec, pixelsPerSecond, playbackSpeed);
            } else if (window.FishAudioEngine) {
              window.FishAudioEngine.syncPlayback(layers, nextSec, pixelsPerSecond, playbackSpeed);
            }
          } else {
            pausePlayback(true);
            if (window.playbackPlayFromMode !== 'last_pause') {
              updateTimelinePosition(bounds.min, true);
              const canvas = document.getElementById('editor-active-canvas');
              if (canvas) {
                renderCanvasFrame(canvas, currentProjectState.bgColor, canvas.width, canvas.height, 'playbackStep', Math.abs(bounds.min) / pixelsPerSecond);
              }
            }
            return;
          }
        } else if (window.FishAudioEngine) {
          // 3. Slave all active audio/video tracks directly to NLE timeline position nextSec and stepped slow-mo speed
          window.FishAudioEngine.syncPlayback(layers, nextSec, pixelsPerSecond, effectiveAudioSpeed);
        }
        updateTimelinePosition(nextPan, true);

        // 4. Render synchronous canvas frame for the new playhead position
        const canvas = document.getElementById('editor-active-canvas');
        if (canvas) {
          renderCanvasFrame(canvas, currentProjectState.bgColor, canvas.width, canvas.height, 'playbackStep', nextSec);
        }

        // 5. High-speed playback lookahead: only bake ahead when current playback tick was a fast cache hit
        if (window.PreviewCacheManager && window.isPreviewCacheEnabled !== false && isCurrentAndNextCached && window._lastFrameWasCached) {
          window.PreviewCacheManager.bakePlaybackLookahead(nextSec, fps);
        }

        _playTickCount++;

        playAnimationId = requestAnimationFrame(stepPlay);
      }

      if (playBtn) {
        let playLongPressTimer = null;
        let isPlayLongPress = false;
        let playDownX = 0;
        let playDownY = 0;

        function openPlaySettingsPopover() {
          if (!window.Popover) return;
          syncPlaySettingsUI();
          window.Popover.open(playBtn, 'popover-play-settings');
        }

        playBtn.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          isPlayLongPress = false;
          playDownX = e.clientX;
          playDownY = e.clientY;
          if (playLongPressTimer) clearTimeout(playLongPressTimer);
          playLongPressTimer = setTimeout(() => {
            isPlayLongPress = true;
            if (navigator.vibrate) {
              try { navigator.vibrate(35); } catch (_) {}
            }
            openPlaySettingsPopover();
          }, 450);
        });

        playBtn.addEventListener('pointermove', (e) => {
          if (!playLongPressTimer) return;
          const dist = Math.hypot(e.clientX - playDownX, e.clientY - playDownY);
          if (dist > 8) {
            clearTimeout(playLongPressTimer);
            playLongPressTimer = null;
          }
        }, { passive: true });

        const cancelPlayLongPress = () => {
          if (playLongPressTimer) {
            clearTimeout(playLongPressTimer);
            playLongPressTimer = null;
          }
        };

        playBtn.addEventListener('pointerup', cancelPlayLongPress);
        playBtn.addEventListener('pointercancel', cancelPlayLongPress);

        playBtn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          cancelPlayLongPress();
          openPlaySettingsPopover();
        });

        playBtn.addEventListener('click', (e) => {
          if (window.isExporting) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
              e.stopImmediatePropagation();
            }
            return;
          }
          if (isPlayLongPress) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
              e.stopImmediatePropagation();
            }
            isPlayLongPress = false;
            return;
          }
          if (window.FishAudioEngine && !window.FishAudioEngine.isUnlocked) {
            window.FishAudioEngine.unlock(e);
          }
          if (isPlaying) {
            pausePlayback(true);
          } else {
            const bounds = getTimelineBounds();
            if (panX <= bounds.min + 0.5) {
              updateTimelinePosition(bounds.max, true);
            }
            // Record starting timestamp where user clicked play
            const startSec = Math.max(0, -panX / pixelsPerSecond);
            window.playbackPlayStartSec = startSec;

            if (window.PreviewCacheManager) {
              window.PreviewCacheManager.stopIdleWorker();
              window.PreviewCacheManager.syncStateWithProject(currentProjectState);
              if (typeof window.PreviewCacheManager.ensureAudioOnlyFullCache === 'function') {
                window.PreviewCacheManager.ensureAudioOnlyFullCache(currentProjectState);
              }
            }

            isPlaying = true;
            window.isTimelinePlaying = true;
            if (window.FishAudioEngine && typeof window.FishAudioEngine.suppressMediaSession === 'function') {
              window.FishAudioEngine.suppressMediaSession();
            }
            updatePlayButtonUI();
            if (timelineTweenRaf) {
              cancelAnimationFrame(timelineTweenRaf);
              timelineTweenRaf = null;
            }
            // Clear any stale targetTime from past scrubbing
            const layers = currentProjectState.layers || [];
            layers.forEach(layer => {
              if (layer.type === 'video') {
                const media = getOrLoadLayerMedia(layer);
                if (media) media._targetTime = undefined;
              }
            });
            lastTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            _playTickCount = 0;
            // Synchronously prime audio playback inside direct user activation gesture
            const initialPlaybackSpeed = (typeof window.timelinePlaybackSpeed === 'number' && window.timelinePlaybackSpeed > 0)
              ? window.timelinePlaybackSpeed
              : 1.0;
            if (window.FishAudioScheduler && typeof window.FishAudioScheduler.start === 'function') {
              window.FishAudioScheduler.start(layers, startSec, pixelsPerSecond, initialPlaybackSpeed);
            }
            if (window.FishAudioEngine) {
              window.FishAudioEngine.syncPlayback(layers, startSec, pixelsPerSecond, initialPlaybackSpeed);
            }
            playAnimationId = requestAnimationFrame(stepPlay);
          }
        });
      }

      if (window.FishAudioEngine && typeof window.FishAudioEngine.suppressMediaSession === 'function') {
        window.FishAudioEngine.suppressMediaSession();
      }
      document.addEventListener('visibilitychange', () => {
        if (window.FishAudioEngine && typeof window.FishAudioEngine.suppressMediaSession === 'function') {
          window.FishAudioEngine.suppressMediaSession();
        }
      }, { passive: true });

      // =========================================================================
      // Playback Settings Popover Wiring (Loop, Speed, Cache)
      // =========================================================================
      function syncPlaySettingsUI() {
        const pop = document.getElementById('popover-play-settings');
        if (!pop) return;

        // 1. Loop
        const isLoop = window.isPlaybackLoopEnabled !== false;
        const loopBtns = pop.querySelectorAll('#play-settings-loop-group .effects-segmented-btn');
        loopBtns.forEach(btn => {
          btn.classList.toggle('is-active', (btn.dataset.val === 'on' && isLoop) || (btn.dataset.val === 'off' && !isLoop));
        });

        // 2. Speed
        const speed = (typeof window.timelinePlaybackSpeed === 'number' && window.timelinePlaybackSpeed > 0)
          ? window.timelinePlaybackSpeed
          : 1.0;
        const speedBtns = pop.querySelectorAll('#play-settings-speed-group .effects-segmented-btn');
        speedBtns.forEach(btn => {
          const val = parseFloat(btn.dataset.speed) || 1.0;
          btn.classList.toggle('is-active', Math.abs(val - speed) < 0.05);
        });

        // 3. Cache
        const isCache = window.isPreviewCacheEnabled !== false;
        const cacheBtns = pop.querySelectorAll('#play-settings-cache-group .effects-segmented-btn');
        cacheBtns.forEach(btn => {
          btn.classList.toggle('is-active', (btn.dataset.val === 'on' && isCache) || (btn.dataset.val === 'off' && !isCache));
        });

        // 4. Play From (Current Time vs Last Pause)
        const playFromMode = window.playbackPlayFromMode || 'current';
        const playFromBtns = pop.querySelectorAll('#play-settings-playfrom-group .effects-segmented-btn');
        playFromBtns.forEach(btn => {
          btn.classList.toggle('is-active', btn.dataset.val === playFromMode);
        });
      }

      // Initialize Playback Settings Listeners
      const playSettingsPop = document.getElementById('popover-play-settings');
      if (playSettingsPop) {
        // Loop buttons
        const loopBtns = playSettingsPop.querySelectorAll('#play-settings-loop-group .effects-segmented-btn');
        loopBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            window.isPlaybackLoopEnabled = (btn.dataset.val === 'on');
            syncPlaySettingsUI();
          });
        });

        // Speed buttons
        const speedBtns = playSettingsPop.querySelectorAll('#play-settings-speed-group .effects-segmented-btn');
        speedBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const speed = parseFloat(btn.dataset.speed) || 1.0;
            window.timelinePlaybackSpeed = speed;
            syncPlaySettingsUI();
            if (window.FishAudioEngine && window.isTimelinePlaying) {
              const pps = (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
              const curSec = Math.max(0, -panX / pps);
              const layers = currentProjectState.layers || [];
              window.FishAudioEngine.syncPlayback(layers, curSec, pps, speed);
            }
          });
        });

        // Cache buttons
        const cacheBtns = playSettingsPop.querySelectorAll('#play-settings-cache-group .effects-segmented-btn');
        cacheBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const enabled = (btn.dataset.val === 'on');
            window.isPreviewCacheEnabled = enabled;
            syncPlaySettingsUI();
            if (window.PreviewCacheManager) {
              window.PreviewCacheManager.setIdleCacheEnabled(enabled);
              if (!enabled) {
                // Instantly clear ruler display when cache is turned off
                window.PreviewCacheManager.stopIdleWorker();
                window.PreviewCacheManager.updateRulerUI();
              } else {
                // Re-enable and fill cache in background
                window.PreviewCacheManager.updateRulerUI();
                window.PreviewCacheManager.scheduleIdleCheck(true);
              }
            }
          });
        });

        // Play From buttons
        const playFromBtns = playSettingsPop.querySelectorAll('#play-settings-playfrom-group .effects-segmented-btn');
        playFromBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            window.playbackPlayFromMode = btn.dataset.val || 'current';
            syncPlaySettingsUI();
          });
        });

        syncPlaySettingsUI();
      }

      // Backward navigation on "Previous" button (beatmark jump or frame step)
      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          navigateBeatmark(-1);
        });
      }

      // Forward navigation on "Next" button (beatmark jump or frame step)
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          navigateBeatmark(1);
        });
      }

      // 4. Dynamic Timeline Layers & Clips System (Supports Single & Multi-Selector Mode)
      selectedLayerIds = new Set();
      isSelectorMode = false;
      selectedLayerId = null;
      window.selectedLayerIds = selectedLayerIds;

      function isLayerSelected(layerId) {
        return selectedLayerIds.has(layerId) || selectedLayerId === layerId;
      }
      window.isLayerSelected = isLayerSelected;

      function centerSelectedTimelineLayer(smooth = true, targetLayerId = null) {
        const layerId = targetLayerId || window.selectedLayerId;
        if (!layerId) return;

        const viewport = document.getElementById('timeline-layers-viewport');
        if (!viewport) return;

        const slot = document.querySelector(`.timeline-lane-pill-slot[data-layer-id="${layerId}"]`) ||
                     document.querySelector(`.timeline-track-lane[data-layer-id="${layerId}"]`) ||
                     document.querySelector(`.timeline-clip-block[data-layer-id="${layerId}"]`);

        const isDesktop = Boolean(document.querySelector('.desktop-workstation, .desktop-viewport'));
        const drawerContainer = document.getElementById('timeline-layer-drawer');
        const drawerCard = document.querySelector('#timeline-layer-drawer .drawer-card');
        // On desktop, layer drawer is docked inside the right inspector panel and NEVER overlays timeline
        const isDrawerOpen = !isDesktop && Boolean(
          (window.Drawer && typeof window.Drawer.isOpen === 'function' && window.Drawer.isOpen('timeline-layer-drawer')) ||
          (drawerContainer && drawerContainer.classList.contains('is-active'))
        );

        const vpRect = viewport.getBoundingClientRect();
        if (!vpRect || vpRect.height === 0) return;

        const timelineEl = document.getElementById('main-editor-timeline');
        const tlBottom = timelineEl ? timelineEl.getBoundingClientRect().bottom : vpRect.bottom;
        const cardRect = drawerCard ? drawerCard.getBoundingClientRect() : null;
        let cardHeight = 242;
        if (drawerCard) {
          if (drawerCard._targetHeight && drawerCard.style.transition) {
            cardHeight = drawerCard._targetHeight;
          } else {
            cardHeight = Math.max(drawerCard.offsetHeight, drawerCard.scrollHeight, (cardRect ? cardRect.height : 0), 242);
          }
        }
        const cardRestingTop = tlBottom - cardHeight;
        const drawerTop = (isDrawerOpen && drawerCard) ? cardRestingTop : vpRect.bottom;

        const drawerH = isDrawerOpen ? Math.max(0, Math.round(tlBottom - drawerTop)) : 0;
        if (timelineEl && drawerH > 0) {
          timelineEl.style.setProperty('--timeline-drawer-height', `${drawerH}px`);
        }

        const visibleTop = vpRect.top;
        const visibleBottom = isDrawerOpen ? drawerTop : vpRect.bottom;
        const visibleHeight = visibleBottom - visibleTop;
        const targetCenterY = visibleTop + (visibleHeight / 2);

        let targetScrollTop = 0;
        const maxScrollY = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        if (slot) {
          const slotRect = slot.getBoundingClientRect();
          // On desktop, if slot is already fully visible in viewport, do NOT shift/scroll timeline
          if (isDesktop && slotRect.top >= vpRect.top && slotRect.bottom <= vpRect.bottom) {
            return;
          }
          const slotCenterY = slotRect.top + (slotRect.height / 2);
          const deltaY = slotCenterY - targetCenterY;
          targetScrollTop = Math.max(0, Math.min(maxScrollY, Math.round(viewport.scrollTop + deltaY)));
        } else {
          const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
          const idx = layers.findIndex(l => l.id === layerId);
          if (idx < 0) return;
          const isCompactVp = !window.isDesktop && !document.querySelector('.desktop-viewport');
          const topPad = isCompactVp ? 8 : 12;
          const rowPitch = isCompactVp ? getTimelineRowPitch() : 54;
          const vScale = window.currentTimelineVerticalScale || 1.0;
          const halfLane = isCompactVp ? Math.round(17 * vScale) : 22;
          const layerCenterInContent = topPad + (idx * rowPitch) + halfLane;
          const targetCenterInVp = targetCenterY - visibleTop;
          targetScrollTop = Math.max(0, Math.min(maxScrollY, Math.round(layerCenterInContent - targetCenterInVp)));
        }

        if (viewport._centerScrollTimer) {
          clearTimeout(viewport._centerScrollTimer);
          viewport._centerScrollTimer = null;
        }

        try {
          if (smooth) {
            viewport.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
          } else {
            viewport.scrollTop = targetScrollTop;
          }
        } catch (_) {
          viewport.scrollTop = targetScrollTop;
        }

        if (!smooth) {
          viewport._centerScrollTimer = setTimeout(() => {
            if (Math.abs(viewport.scrollTop - targetScrollTop) > 2) {
              viewport.scrollTop = targetScrollTop;
            }
          }, 60);
        }
      }
      window.centerSelectedTimelineLayer = centerSelectedTimelineLayer;

      function renderLayerKeyframes(layer, clipEl) {
        if (!clipEl) return;
        const kfContainer = clipEl.querySelector('.timeline-clip-keyframes');
        if (!kfContainer) return;
        kfContainer.innerHTML = '';
        if (!layer || !layer.keyframes) return;

        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        const clipStartSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const clipW = layer.widthPx || 320;
        const clipDurSec = layer.durationSec !== undefined ? layer.durationSec : (clipW / pps);
        const activeProp = window.activeKeyframeProperty || 'move';
        const isPropActive = (typeof window.isPropertyEditorActive === 'function') ? window.isPropertyEditorActive() : false;
        const isSelectedLayer = (layer.id === window.selectedLayerId);

        Object.entries(layer.keyframes).forEach(([prop, list]) => {
          if (!Array.isArray(list)) return;
          const isActiveProp = isPropActive && isSelectedLayer && (prop === activeProp);

          list.forEach(kf => {
            const relSec = kf.time - clipStartSec;
            const relPx = relSec * pps;
            const isOutOfBounds = (relSec < -0.001) || (relSec > clipDurSec + 0.001);

            const marker = document.createElement('div');
            marker.className = `timeline-keyframe-marker ${isActiveProp ? 'is-active-prop' : 'is-other-prop'}${isOutOfBounds ? ' is-out-of-bounds' : ''}`;
            marker.style.left = `${relPx.toFixed(1)}px`;
            const propLabel = prop.includes(':') ? prop.split(':')[1].toUpperCase() : prop.toUpperCase();
            marker.title = `${propLabel} Keyframe: ${kf.time.toFixed(2)}s`;
            marker.dataset.prop = prop;
            marker.dataset.time = kf.time;
            marker._kf = kf;
            marker._layer = layer;
            marker._prop = prop;

            if (isActiveProp && Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.some(it => it.layerId === layer.id && it.prop === prop && Math.abs(it.time - kf.time) < 0.001)) {
              marker.classList.add('is-selected-kf');
              const found = window.selectedKeyframes.find(it => it.layerId === layer.id && it.prop === prop && Math.abs(it.time - kf.time) < 0.001);
              if (found) { found.marker = marker; found.kf = kf; found.layer = layer; }
            }

            marker.addEventListener('pointerdown', (e) => {
              const currentActiveProp = window.activeKeyframeProperty;
              const isPropActiveNow = (typeof window.isPropertyEditorActive === 'function') ? window.isPropertyEditorActive() : false;
              const isOobNow = marker.classList.contains('is-out-of-bounds');
              const canDrag = (layer.id === window.selectedLayerId) && (
                (isPropActiveNow && !!(currentActiveProp && prop === currentActiveProp)) ||
                (isOobNow && (!isPropActiveNow || !currentActiveProp || prop === currentActiveProp))
              );

              // Strictly ignore if not the active keyframe mode/prop (and not an out-of-bounds keyframe on selected layer) - let pointer event bubble cleanly to clip
              if (!canDrag) return;

              e.stopPropagation();
              e.preventDefault();
              if (e.button !== undefined && e.button !== 0) return;

              let isDragging = false;
              let holdTimer = null;
              const startX = e.clientX;
              const startY = e.clientY;
              const kfInitialTime = kf.time;
              let multiDragItems = null;

              function startDrag(pointerId) {
                if (isDragging) return;
                clearTimeout(holdTimer);
                isDragging = true;
                window.isTransformInteracting = true;
                marker.classList.add('is-dragging');
                try { marker.setPointerCapture(pointerId); } catch (_) {}
                if (navigator.vibrate) try { navigator.vibrate(25); } catch (_) {}

                // Snapshot initial times for multi-selected keyframes
                if (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.some(it => it.kf === kf)) {
                  multiDragItems = window.selectedKeyframes.map(it => ({
                    item: it,
                    initTime: it.kf ? it.kf.time : it.time
                  }));
                  window.selectedKeyframes.forEach(it => {
                    if (it.marker) it.marker.classList.add('is-dragging');
                  });
                } else {
                  if (!e.shiftKey) {
                    if (typeof window.clearSelectedKeyframes === 'function') window.clearSelectedKeyframes();
                  }
                  marker.classList.add('is-selected-kf');
                  window.selectedKeyframes = [{ layerId: layer.id, layer, prop, time: kf.time, kf, marker }];
                  multiDragItems = [{ item: window.selectedKeyframes[0], initTime: kf.time }];
                }
              }

              holdTimer = setTimeout(() => {
                startDrag(e.pointerId);
              }, 200);

              let cachedClipLeft = null;

              function onMarkerPointerMove(ev) {
                if (!isDragging) {
                  const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
                  if (dist > 4) {
                    startDrag(ev.pointerId);
                  } else {
                    return;
                  }
                }

                ev.stopPropagation();
                ev.preventDefault();

                if (cachedClipLeft === null) {
                  cachedClipLeft = clipEl.getBoundingClientRect().left;
                }
                const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
                const fps = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
                const curClipStartSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
                const curClipDurSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);

                const currentZoom = window.__OFT_ZOOM || (typeof window.oftUiScaleFactor === 'function' ? window.oftUiScaleFactor() : 1) || parseFloat(document.documentElement.style.zoom) || 1;
                const relPx = (ev.clientX - cachedClipLeft) / currentZoom;
                let targetRelSec = relPx / pps;
                let absTime = curClipStartSec + targetRelSec;

                if (window.isTimelineSnapEnabled !== false) {
                  const curP = (typeof window.getCurrentPlayheadTime === 'function') ? window.getCurrentPlayheadTime() : (window.currentSec || 0);
                  let snapped = false;
                  if (Math.abs(absTime - curP) * pps < 6) {
                    absTime = curP;
                    snapped = true;
                  }
                  if (!snapped) {
                    const snapTargets = [];
                    if (window.currentProjectState) {
                      if (window.currentProjectState.beatmarks) snapTargets.push(...window.currentProjectState.beatmarks);
                      (window.currentProjectState.layers || []).forEach(l => {
                        if (l.markers) snapTargets.push(...l.markers.map(m => typeof m === 'number' ? m : m.time));
                        if (l.keyframes) Object.values(l.keyframes).forEach(kList => {
                          if (Array.isArray(kList)) snapTargets.push(...kList.map(k => k.time));
                        });
                      });
                    }
                    for (let t of snapTargets) {
                      if (Math.abs(absTime - t) * pps < 6) {
                        absTime = t;
                        break;
                      }
                    }
                  }
                  targetRelSec = absTime - curClipStartSec;
                }

                // Snap to frame
                targetRelSec = Math.round(targetRelSec * fps) / fps;
                // Allow dragging inside or outside clip freely (only clamp at timeline 0s)
                targetRelSec = Math.max(-curClipStartSec, targetRelSec);

                const newTime = Number(Math.max(0, curClipStartSec + targetRelSec).toFixed(4));
                const deltaTime = newTime - kfInitialTime;

                if (multiDragItems && multiDragItems.length > 1) {
                  multiDragItems.forEach(({ item, initTime }) => {
                    const shifted = Number(Math.max(0, initTime + deltaTime).toFixed(4));
                    if (item.kf) item.kf.time = shifted;
                    item.time = shifted;
                    if (item.marker) {
                      item.marker.dataset.time = shifted;
                      const targetLayer = item.layer || layer;
                      const tStartSec = targetLayer.startSec !== undefined ? targetLayer.startSec : ((targetLayer.startPx || 0) / pps);
                      const tDurSec = targetLayer.durationSec !== undefined ? targetLayer.durationSec : ((targetLayer.widthPx || 320) / pps);
                      const rSec = shifted - tStartSec;
                      const rPx = rSec * pps;
                      item.marker.style.left = `${rPx.toFixed(1)}px`;
                      item.marker.classList.toggle('is-out-of-bounds', rSec < -0.001 || rSec > tDurSec + 0.001);
                      const pl = item.prop.includes(':') ? item.prop.split(':')[1].toUpperCase() : item.prop.toUpperCase();
                      item.marker.title = `${pl} Keyframe: ${shifted.toFixed(2)}s`;
                    }
                  });
                } else {
                  kf.time = newTime;
                  marker.dataset.time = newTime;
                  const rPx = targetRelSec * pps;
                  marker.style.left = `${rPx.toFixed(1)}px`;
                  marker.classList.toggle('is-out-of-bounds', targetRelSec < -0.001 || targetRelSec > curClipDurSec + 0.001);
                  const pl = prop.includes(':') ? prop.split(':')[1].toUpperCase() : prop.toUpperCase();
                  marker.title = `${pl} Keyframe: ${newTime.toFixed(2)}s`;
                  if (window.selectedKeyframes) {
                    const sItem = window.selectedKeyframes.find(it => it.kf === kf);
                    if (sItem) sItem.time = newTime;
                  }
                }

                if (typeof invalidatePreviewCacheForLayer === 'function') {
                  invalidatePreviewCacheForLayer(layer);
                }
                if (typeof updateGraphEditorUI === 'function') {
                  updateGraphEditorUI();
                }
                if (typeof redrawComposition === 'function') {
                  redrawComposition('dragKeyframe');
                }
              }

              function onMarkerPointerUp(ev) {
                cachedClipLeft = null;
                clearTimeout(holdTimer);
                try { marker.releasePointerCapture(ev.pointerId); } catch (_) {}
                window.removeEventListener('pointermove', onMarkerPointerMove);
                window.removeEventListener('pointerup', onMarkerPointerUp);
                window.removeEventListener('pointercancel', onMarkerPointerUp);

                if (isDragging) {
                  marker.classList.remove('is-dragging');
                  window.isTransformInteracting = false;
                  const affectedLayers = new Set();
                  if (multiDragItems && multiDragItems.length > 1) {
                    multiDragItems.forEach(({ item }) => {
                      if (item.marker) item.marker.classList.remove('is-dragging');
                      const l = item.layer || (currentProjectState.layers || []).find(ly => ly.id === item.layerId);
                      if (l && l.keyframes && Array.isArray(l.keyframes[item.prop])) {
                        l.keyframes[item.prop].sort((a, b) => a.time - b.time);
                        l.keyframes[item.prop]._isSorted = true;
                        affectedLayers.add(l);
                      }
                    });
                  } else {
                    if (Array.isArray(layer.keyframes[prop])) {
                      layer.keyframes[prop].sort((a, b) => a.time - b.time);
                      layer.keyframes[prop]._isSorted = true;
                    }
                    affectedLayers.add(layer);
                  }
                  if (typeof invalidatePreviewCacheForLayer === 'function') {
                    affectedLayers.forEach(l => invalidatePreviewCacheForLayer(l));
                  }
                  saveCurrentProjectLayers();
                  renderTimelineLayers();
                  if (typeof updateTransformKeyframeBtnState === 'function') updateTransformKeyframeBtnState();
                  if (typeof updateSpeedKeyframeBtnState === 'function') updateSpeedKeyframeBtnState();
                  if (typeof syncSpeedControllerValues === 'function') syncSpeedControllerValues();
                  if (typeof syncEffectsKeyframeState === 'function') syncEffectsKeyframeState(layer);
                  if (typeof updateGraphEditorUI === 'function') updateGraphEditorUI();
                  if (typeof redrawComposition === 'function') redrawComposition('keyframe-drag-end');
                } else {
                  if (!ev.shiftKey) {
                    if (typeof window.clearSelectedKeyframes === 'function') window.clearSelectedKeyframes();
                  }
                  marker.classList.add('is-selected-kf');
                  if (!window.selectedKeyframes) window.selectedKeyframes = [];
                  if (!window.selectedKeyframes.some(it => it.kf === kf)) {
                    window.selectedKeyframes.push({ layerId: layer.id, layer, prop, time: kf.time, kf, marker });
                  }
                  if (typeof seekTimelineToTime === 'function') {
                    seekTimelineToTime(kf.time, true);
                  }
                  if (typeof updateTransformKeyframeBtnState === 'function') updateTransformKeyframeBtnState();
                  if (typeof updateSpeedKeyframeBtnState === 'function') updateSpeedKeyframeBtnState();
                  if (typeof syncSpeedControllerValues === 'function') syncSpeedControllerValues();
                  if (typeof syncEffectsKeyframeState === 'function') syncEffectsKeyframeState(layer);
                }
              }

              window.addEventListener('pointermove', onMarkerPointerMove);
              window.addEventListener('pointerup', onMarkerPointerUp);
              window.addEventListener('pointercancel', onMarkerPointerUp);
            });

            marker.addEventListener('contextmenu', (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (!isTrueRightClick(e)) return;

              const isAlreadySelected = Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.some(it => it.kf === kf || (it.layerId === layer.id && it.prop === prop && Math.abs(it.time - kf.time) < 0.002));
              if (!isAlreadySelected) {
                if (!e.shiftKey) {
                  if (typeof window.clearSelectedKeyframes === 'function') window.clearSelectedKeyframes();
                }
                marker.classList.add('is-selected-kf');
                if (!window.selectedKeyframes) window.selectedKeyframes = [];
                window.selectedKeyframes.push({ layerId: layer.id, layer, prop, time: kf.time, kf, marker });
              }

              if (window.selectedLayerId !== layer.id) {
                selectTimelineLayer(layer.id);
              }
              if (window.Popover) {
                const mouseAnchor = {
                  isVirtual: true,
                  isContextMenu: true,
                  getBoundingClientRect: () => ({
                    left: e.clientX,
                    top: e.clientY,
                    right: e.clientX,
                    bottom: e.clientY,
                    width: 0,
                    height: 0
                  }),
                  dataset: {}
                };
                window.Popover.open(mouseAnchor, 'popover-layer-actions');
              }
            });

            kfContainer.appendChild(marker);
          });
        });
      }
      window.renderLayerKeyframes = renderLayerKeyframes;

      function syncLayerKeyframeMarkersInPlace(layer) {
        if (!layer || !layersTrack) {
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          return;
        }
        const isDesktop = isDesktopLayout();
        if (isDesktop && layer._kfExpanded) {
          if (typeof toggleLayerKeyframeExpansion === 'function') {
            toggleLayerKeyframeExpansion(layer.id, true, layer._kfExpandedOnlyKeyframed);
            return;
          }
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          return;
        }
        const lane = layersTrack.querySelector(`.timeline-track-lane[data-layer-id="${layer.id}"]`);
        if (!lane) {
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          return;
        }
        const clipEl = lane.querySelector('.timeline-clip-block');
        if (!clipEl) {
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          return;
        }
        renderLayerKeyframes(layer, clipEl);
      }
      window.syncLayerKeyframeMarkersInPlace = syncLayerKeyframeMarkersInPlace;

      function getLayerCategorizedKeyframeRows(layer, onlyKeyframed = false) {
        if (!layer) return [];
        const categories = [];
        // Solo prop via shortcut (S/P/R/T/A): bila aktif dan bukan mode keyframed,
        // hanya prop itu yang tampil (kategori lain disembunyikan).
        const soloProp = (!onlyKeyframed && layer._kfSoloProp) || null;

        function formatValText(prop, val) {
          if (val === undefined || val === null) return '';
          if (typeof val === 'number') {
            if (prop === 'opacity') return `${Math.round(val <= 1.0 && val >= 0 ? val * 100 : val)}%`;
            if (prop === 'rotate') return `${val.toFixed(1)}°`;
            return val.toFixed(1);
          }
          if (typeof val === 'object') {
            if (val.scaleW !== undefined && val.scaleH !== undefined) {
              // scaleW/scaleH can be stored as % (e.g. 100) or px (e.g. 1080)
              // If values look like px (>400), try to normalize to %
              let w = val.scaleW, h = val.scaleH;
              const pw = (window.currentProjectState && window.currentProjectState.width) || 1080;
              const ph = (window.currentProjectState && window.currentProjectState.height) || 1920;
              if (w > 400 && pw > 0) w = Math.round((w / pw) * 100);
              if (h > 400 && ph > 0) h = Math.round((h / ph) * 100);
              return `${Math.round(w)}%, ${Math.round(h)}%`;
            }
            if (val.rotZ !== undefined) {
              if (layer && layer.is3D) {
                return `${(val.rotX || 0).toFixed(1)}°, ${(val.rotY || 0).toFixed(1)}°, ${val.rotZ.toFixed(1)}°`;
              }
              const deg = val.rotZ;
              const rev = Math.trunc(deg / 360);
              const rem = deg - rev * 360;
              return `${rev}x${rem >= 0 ? '+' : ''}${rem.toFixed(1)}°`;
            }
            if (val.posX !== undefined && val.posY !== undefined) {
              if (layer && layer.is3D) {
                return `${Math.round(val.posX)}, ${Math.round(val.posY)}, ${Math.round(val.posZ || 0)}`;
              }
              return `${Math.round(val.posX)}, ${Math.round(val.posY)}`;
            }
            if (val.opacity !== undefined) {
              const o = val.opacity;
              return `${Math.round(o <= 1.0 && o >= 0 ? o * 100 : o)}%`;
            }
            if (val.volume !== undefined) {
              return `${Math.round(val.volume * 100)}%`;
            }
            if (val.anchorX !== undefined && val.anchorY !== undefined) {
              if (layer && layer.is3D) {
                return `${Math.round(val.anchorX)}, ${Math.round(val.anchorY)}, ${Math.round(val.anchorZ || 0)}`;
              }
              return `${Math.round(val.anchorX)}, ${Math.round(val.anchorY)}`;
            }
            if (val.skewX !== undefined) {
              return `${val.skewX.toFixed(1)}°`;
            }
            if (val.x !== undefined && val.y !== undefined) {
              return `${Math.round(val.x)}, ${Math.round(val.y)}`;
            }
            // Effect params — single key object {paramId: value}
            const keys = Object.keys(val);
            if (keys.length === 1) {
              const v = val[keys[0]];
              if (typeof v === 'number') return v.toFixed(1);
              return String(v);
            }
          }
          return String(val);
        }

        const builtInProps = ['move', 'scale', 'rotate', 'rotation', 'opacity', 'volume', 'origin', 'skew', 'speed', 'timeRemap', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurAmount'];

        // 1. Transform Category
        const isVisual = !['audio'].includes(layer.type);
        if (isVisual) {
          const transformDefs = [
            { prop: 'move', label: 'Position' },
            { prop: 'scale', label: 'Scale' },
            { prop: 'rotate', label: 'Rotation' },
            { prop: 'opacity', label: 'Opacity' }
          ];
          if (layer.skew !== undefined || (layer.keyframes && layer.keyframes.skew)) {
            transformDefs.push({ prop: 'skew', label: 'Skew' });
          }
          if (layer.origin !== undefined || (layer.keyframes && layer.keyframes.origin)) {
            transformDefs.push({ prop: 'origin', label: 'Anchor Point' });
          }

          const keyframedProps = transformDefs.filter(d => {
            const list = layer.keyframes && layer.keyframes[d.prop];
            return Array.isArray(list) && list.length > 0;
          });

          const activeProps = onlyKeyframed ? keyframedProps : transformDefs;
          const shownProps = soloProp ? activeProps.filter(d => d.prop === soloProp) : activeProps;

          if (shownProps.length > 0) {
            categories.push({
              id: 'transform',
              title: 'Transform',
              props: shownProps.map(d => {
                const kfs = (layer.keyframes && layer.keyframes[d.prop]) || [];
                const rawVal = (typeof getLayerPropertyValue === 'function') ? getLayerPropertyValue(layer, d.prop) : null;
                return {
                  prop: d.prop,
                  label: d.label,
                  keyframes: Array.isArray(kfs) ? [...kfs].sort((a, b) => a.time - b.time) : [],
                  curValue: formatValText(d.prop, rawVal)
                };
              })
            });
          }
        }

        // 2. Effects Category (disembunyikan saat solo prop)
        if (!soloProp && Array.isArray(layer.effects) && layer.effects.length > 0) {
          layer.effects.forEach((fx, fxIdx) => {
            const def = (window.FishEffectsRegistry && typeof window.FishEffectsRegistry.get === 'function')
              ? window.FishEffectsRegistry.get(fx.type)
              : null;
            const fxTitle = fx.name || (def ? def.name : `Effect ${fxIdx + 1}`);
            const fxProps = [];
            const params = (def && Array.isArray(def.params)) ? def.params : [];

            params.forEach(param => {
              const scopedKey = `${fx.id}:${param.id}`;
              let kfs = (layer.keyframes && layer.keyframes[scopedKey]) || [];
              if ((!kfs || kfs.length === 0) && fxIdx === 0 && !builtInProps.includes(param.id) && layer.keyframes && layer.keyframes[param.id]) {
                kfs = layer.keyframes[param.id];
              }
              const hasKf = Array.isArray(kfs) && kfs.length > 0;
              if (hasKf) {
                const curVal = (typeof getLayerPropertyValue === 'function') ? getLayerPropertyValue(layer, scopedKey) : fx[param.id];
                fxProps.push({
                  prop: scopedKey,
                  label: param.name || param.id,
                  keyframes: [...kfs].sort((a, b) => a.time - b.time),
                  curValue: formatValText(param.id, curVal !== undefined ? curVal : fx[param.id])
                });
              }
            });

            // If no keyframes on this effect yet, show first 3 params ONLY when NOT in onlyKeyframed mode
            if (!onlyKeyframed && fxProps.length === 0 && params.length > 0) {
              params.slice(0, 3).forEach(param => {
                const scopedKey = `${fx.id}:${param.id}`;
                const curVal = fx[param.id] !== undefined ? fx[param.id] : param.default;
                fxProps.push({
                  prop: scopedKey,
                  label: param.name || param.id,
                  keyframes: (layer.keyframes && layer.keyframes[scopedKey]) || [],
                  curValue: formatValText(param.id, curVal)
                });
              });
            }

            if (fxProps.length > 0) {
              categories.push({
                id: `fx_${fx.id || fxIdx}`,
                title: `Effects: ${fxTitle}`,
                props: fxProps
              });
            }
          });
        }

        // 3. Camera Options (disembunyikan saat solo prop)
        if (!soloProp && layer.type === 'camera') {
          const camDefs = [
            { prop: 'cameraZoom', label: 'Zoom' },
            { prop: 'cameraFocusDistance', label: 'Focus Distance' },
            { prop: 'cameraBlurAmount', label: 'Aperture Blur' }
          ];
          const keyframedCam = camDefs.filter(d => {
            const list = layer.keyframes && layer.keyframes[d.prop];
            return Array.isArray(list) && list.length > 0;
          });
          const activeCam = onlyKeyframed ? keyframedCam : camDefs;
          if (activeCam.length > 0) {
            categories.push({
              id: 'camera',
              title: 'Camera Options',
              props: activeCam.map(d => {
                const kfs = (layer.keyframes && layer.keyframes[d.prop]) || [];
                const rawVal = layer[d.prop];
                return {
                  prop: d.prop,
                  label: d.label,
                  keyframes: Array.isArray(kfs) ? [...kfs].sort((a, b) => a.time - b.time) : [],
                  curValue: formatValText(d.prop, rawVal)
                };
              })
            });
          }
        }

        // 4. Audio
        if (!soloProp && (layer.type === 'audio' || layer.audioUrl)) {
          const kfs = (layer.keyframes && layer.keyframes.volume) || [];
          if (!onlyKeyframed || (Array.isArray(kfs) && kfs.length > 0)) {
            categories.push({
              id: 'audio',
              title: 'Audio',
              props: [{
                prop: 'volume',
                label: 'Audio Levels',
                keyframes: Array.isArray(kfs) ? [...kfs].sort((a, b) => a.time - b.time) : [],
                curValue: `${Math.round((layer.volume !== undefined ? layer.volume : 1) * 100)}%`
              }]
            });
          }
        }

        // 5. Time Remap
        if (!soloProp && layer.keyframes && (layer.keyframes.timeRemap || layer.keyframes.speed)) {
          const timeProps = [];
          if (layer.keyframes.timeRemap) {
            timeProps.push({
              prop: 'timeRemap',
              label: 'Time Remap',
              keyframes: [...layer.keyframes.timeRemap].sort((a, b) => a.time - b.time),
              curValue: ''
            });
          }
          if (layer.keyframes.speed) {
            timeProps.push({
              prop: 'speed',
              label: 'Speed',
              keyframes: [...layer.keyframes.speed].sort((a, b) => a.time - b.time),
              curValue: ''
            });
          }
          if (timeProps.length > 0) {
            categories.push({
              id: 'timeremap',
              title: 'Time Remap',
              props: timeProps
            });
          }
        }

        return categories;
      }
      window.getLayerCategorizedKeyframeRows = getLayerCategorizedKeyframeRows;

      function buildDesktopKfPropertyTree(layer, onlyKeyframed = false) {
        const catRows = getLayerCategorizedKeyframeRows(layer, onlyKeyframed);
        const treeEl = document.createElement('div');
        treeEl.className = 'desktop-kf-property-tree';

        function getPlayheadSec() {
          if (typeof getTimelineCurrentSec === 'function') return getTimelineCurrentSec();
          if (typeof getCurrentPlayheadTime === 'function') return getCurrentPlayheadTime();
          if (typeof window.getCurrentPlayheadTime === 'function') return window.getCurrentPlayheadTime();
          const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
          const pan = (typeof window.timelinePanX !== 'undefined') ? window.timelinePanX : ((typeof panX !== 'undefined') ? panX : 0);
          return Math.max(0, -pan / pps);
        }

        function getLayerPropEasing(l, propName) {
          const easObj = (l && (l.defaultEasing || l._defaultEasing));
          if (easObj && Array.isArray(easObj[propName]) && easObj[propName].length === 4) {
            return [...easObj[propName]];
          }
          return [0.0, 0.0, 1.0, 1.0];
        }

        catRows.forEach(cat => {
          const catRow = document.createElement('div');
          catRow.className = 'desktop-kf-cat-row';
          catRow.innerHTML = `<span class="desktop-kf-cat-icon">▾</span><span class="desktop-kf-cat-title">${cat.title}</span>`;
          treeEl.appendChild(catRow);

          cat.props.forEach(p => {
            const pRow = document.createElement('div');
            pRow.className = 'desktop-kf-prop-row';
            pRow.dataset.prop = p.prop;

            // --- Stopwatch icon (SVG outline = no KF, solid = has KF at playhead) ---
            const swBtn = document.createElement('span');
            swBtn.className = 'desktop-kf-prop-stopwatch';
            swBtn.title = 'Add / remove keyframe at playhead';

            function hasKfAtPlayhead() {
              const t = getPlayheadSec();
              const kfs = layer.keyframes && layer.keyframes[p.prop];
              return Array.isArray(kfs) && kfs.some(k => Math.abs(k.time - t) < 0.025);
            }

            function updateStopwatchState() {
              const active = hasKfAtPlayhead();
              swBtn.classList.toggle('is-active', active);
              swBtn.innerHTML = active
                ? `<i class="fticon fticon-icon-32" style="width:12px;height:12px;font-size:12px;line-height:1;" aria-hidden="true"></i>`
                : `<i class="fticon fticon-icon-33" style="width:12px;height:12px;font-size:12px;line-height:1;" aria-hidden="true"></i>`;
            }
            updateStopwatchState();

            swBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const t = Number(getPlayheadSec().toFixed(3));
              if (!layer.keyframes) layer.keyframes = {};
              if (!Array.isArray(layer.keyframes[p.prop])) layer.keyframes[p.prop] = [];
              const kfs = layer.keyframes[p.prop];
              const existIdx = kfs.findIndex(k => Math.abs(k.time - t) < 0.025);
              if (existIdx >= 0) {
                kfs.splice(existIdx, 1);
                if (kfs.length === 0) delete layer.keyframes[p.prop];
              } else {
                let curVal;
                if (typeof getLayerPropertyValue === 'function') {
                  curVal = getLayerPropertyValue(layer, p.prop);
                } else {
                  curVal = layer[p.prop];
                }
                const defEasing = getLayerPropEasing(layer, p.prop);
                kfs.push({ time: t, value: curVal, easing: defEasing });
                kfs.sort((a, b) => a.time - b.time);
              }
              if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
              if (typeof invalidatePreviewCacheForLayer === 'function') {
                invalidatePreviewCacheForLayer(layer);
              } else if (typeof window.invalidatePreviewCacheForLayer === 'function') {
                window.invalidatePreviewCacheForLayer(layer);
              }
              if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
              if (typeof redrawComposition === 'function') redrawComposition();

              // Update track lane markers in-place without destroying property tree DOM
              const lane = layersTrack ? layersTrack.querySelector(`.timeline-track-lane[data-layer-id="${layer.id}"]`) : null;
              if (lane) {
                const oldTracks = lane.querySelector('.desktop-kf-tracks-wrapper');
                if (oldTracks) oldTracks.remove();
                const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
                const tracksEl = buildDesktopKfTracksWrapper(layer, pps, layer._kfExpandedOnlyKeyframed);
                lane.appendChild(tracksEl);
              }
              updateStopwatchState();
            });

            // --- Prop name ---
            const nameSpan = document.createElement('span');
            nameSpan.className = 'desktop-kf-prop-name';
            nameSpan.title = p.label;
            nameSpan.textContent = p.label;

            // --- Per-component value container ---
            const valContainer = document.createElement('span');
            valContainer.className = 'desktop-kf-prop-val-group';

            function getLive() {
              return (window.currentProjectState && window.currentProjectState.layers)
                ? (window.currentProjectState.layers.find(l => l.id === layer.id) || layer)
                : layer;
            }

            function commitMutation(rl) {
              if (rl.keyframes && Array.isArray(rl.keyframes[p.prop]) && rl.keyframes[p.prop].length > 0) {
                const t = Number(getPlayheadSec().toFixed(3));
                const kfs = rl.keyframes[p.prop];
                const existIdx = kfs.findIndex(k => Math.abs(k.time - t) < 0.025);
                const curVal = typeof getLayerPropertyValue === 'function' ? getLayerPropertyValue(rl, p.prop) : rl[p.prop];
                const defEasing = getLayerPropEasing(rl, p.prop);
                if (existIdx >= 0) {
                  kfs[existIdx].value = curVal;
                } else {
                  kfs.push({ time: t, value: curVal, easing: defEasing });
                  kfs.sort((a, b) => a.time - b.time);
                }
              }
              if (typeof invalidatePreviewCacheForLayer === 'function') {
                invalidatePreviewCacheForLayer(rl);
              } else if (typeof window.invalidatePreviewCacheForLayer === 'function') {
                window.invalidatePreviewCacheForLayer(rl);
              }
              if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
              if (typeof redrawComposition === 'function') redrawComposition();
            }

            function buildComponents(prop) {
              const pw = (window.currentProjectState && window.currentProjectState.width) || 1080;
              const ph = (window.currentProjectState && window.currentProjectState.height) || 1920;
              const rl = getLive();
              if (prop === 'move') {
                const is3D = !!getLive().is3D;
                const comps = [
                  { getVal: () => (getLive().posX ?? pw/2).toFixed(1),
                    scrub: (dx) => { const r = getLive(); r.posX = Number(((r.posX ?? pw/2) + dx).toFixed(2)); },
                    set: (v) => { getLive().posX = parseFloat(v) || 0; } },
                  { getVal: () => (getLive().posY ?? ph/2).toFixed(1),
                    scrub: (dx) => { const r = getLive(); r.posY = Number(((r.posY ?? ph/2) + dx).toFixed(2)); },
                    set: (v) => { getLive().posY = parseFloat(v) || 0; } }
                ];
                if (is3D) {
                  comps.push({
                    getVal: () => (getLive().posZ ?? 0).toFixed(1),
                    scrub: (dx) => { const r = getLive(); r.posZ = Number(((r.posZ ?? 0) + dx).toFixed(2)); },
                    set: (v) => { getLive().posZ = parseFloat(v) || 0; }
                  });
                }
                return comps;
              }
              if (prop === 'scale') {
                const normW = (v) => v > 400 ? (v/pw*100).toFixed(1) : Number(v).toFixed(1);
                const normH = (v) => v > 400 ? (v/ph*100).toFixed(1) : Number(v).toFixed(1);
                const denormW = (pct) => { const r = getLive(); return (r.scaleW > 400) ? (pct/100*pw) : pct; };
                const denormH = (pct) => { const r = getLive(); return (r.scaleH > 400) ? (pct/100*ph) : pct; };
                return [
                  { getVal: () => normW(getLive().scaleW ?? rl.mediaWidth ?? 100),
                    scrub: (dx) => { const r = getLive(); const cW = r.scaleW ?? r.mediaWidth ?? 100; const cH = r.scaleH ?? r.mediaHeight ?? 100; const nW = Math.max(1, cW + dx*0.3); r.scaleW = Number(nW.toFixed(2)); if (r.scaleLinked !== false) r.scaleH = Number((nW * (cH/Math.max(1,cW))).toFixed(2)); },
                    set: (v) => { const r = getLive(); r.scaleW = denormW(parseFloat(v) || 100); } },
                  { getVal: () => normH(getLive().scaleH ?? rl.mediaHeight ?? 100) + '%',
                    scrub: (dx) => { const r = getLive(); const cW = r.scaleW ?? r.mediaWidth ?? 100; const cH = r.scaleH ?? r.mediaHeight ?? 100; const nH = Math.max(1, cH + dx*0.3); r.scaleH = Number(nH.toFixed(2)); if (r.scaleLinked !== false) r.scaleW = Number((nH * (cW/Math.max(1,cH))).toFixed(2)); },
                    set: (v) => { const r = getLive(); r.scaleH = denormH(parseFloat(v) || 100); } }
                ];
              }
              if (prop === 'rotate') {
                const is3D = !!getLive().is3D;
                if (!is3D) {
                  return [
                    { getVal: () => { const deg = getLive().rotation ?? getLive().rotZ ?? 0; const rev = Math.trunc(deg / 360); const rem = deg - rev * 360; return `${rev}x${rem >= 0 ? '+' : ''}${rem.toFixed(1)}°`; },
                      getEditVal: () => (getLive().rotation ?? getLive().rotZ ?? 0).toFixed(1),
                      scrub: (dx) => { const r = getLive(); r.rotation = Number(((r.rotation ?? 0) + dx*0.5).toFixed(2)); r.rotZ = r.rotation; },
                      set: (v) => { const r = getLive(); r.rotation = parseFloat(v) || 0; r.rotZ = r.rotation; } }
                  ];
                }
                return [
                  { getVal: () => (getLive().rotX ?? 0).toFixed(1) + '°',
                    getEditVal: () => (getLive().rotX ?? 0).toFixed(1),
                    scrub: (dx) => { const r = getLive(); r.rotX = Number(((r.rotX ?? 0) + dx*0.5).toFixed(2)); },
                    set: (v) => { getLive().rotX = parseFloat(v) || 0; } },
                  { getVal: () => (getLive().rotY ?? 0).toFixed(1) + '°',
                    getEditVal: () => (getLive().rotY ?? 0).toFixed(1),
                    scrub: (dx) => { const r = getLive(); r.rotY = Number(((r.rotY ?? 0) + dx*0.5).toFixed(2)); },
                    set: (v) => { getLive().rotY = parseFloat(v) || 0; } },
                  { getVal: () => (getLive().rotZ ?? 0).toFixed(1) + '°',
                    getEditVal: () => (getLive().rotZ ?? 0).toFixed(1),
                    scrub: (dx) => { const r = getLive(); r.rotZ = Number(((r.rotZ ?? 0) + dx*0.5).toFixed(2)); },
                    set: (v) => { getLive().rotZ = parseFloat(v) || 0; } }
                ];
              }
              if (prop === 'opacity') return [
                { getVal: () => { const o = getLive().opacity ?? 1; return Math.round(o <= 1.0 && o >= 0 ? o * 100 : o) + '%'; },
                  scrub: (dx) => { const r = getLive(); const cur = r.opacity ?? 1; r.opacity = Math.max(0, Math.min(1, Number((cur + dx * 0.005).toFixed(3)))); },
                  set: (v) => { const r = getLive(); const parsed = parseFloat(v); r.opacity = isNaN(parsed) ? 1 : (parsed > 1 ? parsed / 100 : parsed); } }
              ];
              if (prop === 'origin') {
                const is3D = !!getLive().is3D;
                const comps = [
                  { getVal: () => (getLive().anchorX ?? 0).toFixed(1),
                    scrub: (dx) => { const r = getLive(); r.anchorX = Number(((r.anchorX ?? 0) + dx).toFixed(2)); },
                    set: (v) => { getLive().anchorX = parseFloat(v) || 0; } },
                  { getVal: () => (getLive().anchorY ?? 0).toFixed(1),
                    scrub: (dx) => { const r = getLive(); r.anchorY = Number(((r.anchorY ?? 0) + dx).toFixed(2)); },
                    set: (v) => { getLive().anchorY = parseFloat(v) || 0; } }
                ];
                if (is3D) {
                  comps.push({
                    getVal: () => (getLive().anchorZ ?? 0).toFixed(1),
                    scrub: (dx) => { const r = getLive(); r.anchorZ = Number(((r.anchorZ ?? 0) + dx).toFixed(2)); },
                    set: (v) => { getLive().anchorZ = parseFloat(v) || 0; }
                  });
                }
                return comps;
              }
              if (prop === 'skew') return [
                { getVal: () => (getLive().skew ?? getLive().skewX ?? 0).toFixed(1) + '°',
                  scrub: (dx) => { const r = getLive(); r.skew = Number(((r.skew ?? 0) + dx*0.5).toFixed(2)); r.skewX = r.skew; },
                  set: (v) => { const r = getLive(); r.skew = parseFloat(v) || 0; r.skewX = r.skew; } }
              ];
              if (prop === 'volume') return [
                { getVal: () => Math.round((getLive().volume ?? 1) * 100) + '%',
                  scrub: (dx) => { const r = getLive(); r.volume = Math.max(0, Math.min(4, (r.volume ?? 1) + dx*0.005)); },
                  set: (v) => { getLive().volume = Math.max(0, Math.min(4, parseFloat(v)/100)); } }
              ];
              if (prop.includes(':')) {
                const [fxId, pName] = prop.split(':');
                return [
                  { getVal: () => { const r = getLive(); const fx = Array.isArray(r.effects) ? r.effects.find(f => f.id === fxId) : null; const v = fx ? (fx[pName] ?? 0) : 0; return typeof v === 'number' ? v.toFixed(2) : String(v); },
                    scrub: (dx) => { const r = getLive(); const fx = Array.isArray(r.effects) ? r.effects.find(f => f.id === fxId) : null; if (fx && typeof fx[pName] === 'number') fx[pName] = Number((fx[pName] + dx).toFixed(3)); },
                    set: (v) => { const r = getLive(); const fx = Array.isArray(r.effects) ? r.effects.find(f => f.id === fxId) : null; if (fx) fx[pName] = parseFloat(v) || 0; } }
                ];
              }
              return [
                { getVal: () => { const v = getLive()[prop]; return typeof v === 'number' ? v.toFixed(1) : String(v ?? ''); },
                  scrub: (dx) => { const r = getLive(); if (typeof r[prop] === 'number') r[prop] = Number((r[prop] + dx).toFixed(2)); },
                  set: (v) => { getLive()[prop] = parseFloat(v) || 0; } }
              ];
            }

            const components = buildComponents(p.prop);
            const compSpans = [];

            components.forEach((comp, idx) => {
              if (idx > 0) {
                const sep = document.createElement('span');
                sep.className = 'desktop-kf-prop-val-sep';
                sep.textContent = ',';
                valContainer.appendChild(sep);
              }

              const cs = document.createElement('span');
              cs.className = 'desktop-kf-prop-val-comp';
              cs.textContent = String(comp.getVal());
              cs.title = 'Drag to scrub, click to edit';

              let dragOccurred = false;

              cs.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                cs.setPointerCapture(e.pointerId);
                let startX = e.clientX;
                dragOccurred = false;
                cs.classList.add('is-scrubbing');

                function onCompMove(ev) {
                  if (!cs.hasPointerCapture(ev.pointerId)) return;
                  const dx = ev.clientX - startX;
                  if (Math.abs(dx) >= 1) dragOccurred = true;
                  startX = ev.clientX;
                  comp.scrub(dx);
                  compSpans.forEach((s, i) => { s.textContent = String(components[i].getVal()); });
                  commitMutation(getLive());
                }

                function onCompUp(ev) {
                  cs.classList.remove('is-scrubbing');
                  cs.removeEventListener('pointermove', onCompMove);
                  cs.removeEventListener('pointerup', onCompUp);
                  cs.removeEventListener('pointercancel', onCompUp);
                  if (!dragOccurred) {
                    openInlineEdit(cs, comp, idx);
                  } else {
                    if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
                    if (typeof toggleLayerKeyframeExpansion === 'function') {
                      toggleLayerKeyframeExpansion(layer.id, true, layer._kfExpandedOnlyKeyframed);
                    } else if (typeof renderTimelineLayers === 'function') {
                      renderTimelineLayers();
                    }
                  }
                }

                cs.addEventListener('pointermove', onCompMove, { passive: true });
                cs.addEventListener('pointerup', onCompUp);
                cs.addEventListener('pointercancel', onCompUp);
              });

              valContainer.appendChild(cs);
              compSpans.push(cs);
            });

            function openInlineEdit(cs, comp, idx) {
              const editVal = typeof comp.getEditVal === 'function' ? comp.getEditVal() : String(comp.getVal()).replace(/[°%]/g, '').trim();
              const inp = document.createElement('input');
              inp.type = 'text';
              inp.className = 'desktop-kf-prop-val-input';
              inp.value = String(editVal);
              cs.replaceWith(inp);
              inp.focus();
              inp.select();

              function applyEdit() {
                comp.set(inp.value);
                compSpans.forEach((s, i) => { s.textContent = String(components[i].getVal()); });
                inp.replaceWith(cs);
                cs.textContent = String(comp.getVal());
                commitMutation(getLive());
                if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
                if (typeof toggleLayerKeyframeExpansion === 'function') {
                  toggleLayerKeyframeExpansion(layer.id, true, layer._kfExpandedOnlyKeyframed);
                } else if (typeof renderTimelineLayers === 'function') {
                  renderTimelineLayers();
                }
              }
              inp.addEventListener('blur', applyEdit);
              inp.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
                if (ev.key === 'Escape') { inp.replaceWith(cs); }
              });
            }

            pRow.appendChild(swBtn);
            pRow.appendChild(nameSpan);

            if (p.prop === 'scale') {
              const linkBtn = document.createElement('span');
              linkBtn.className = 'desktop-kf-scale-link';
              linkBtn.title = 'Constrain proportions';
              const syncLinkIcon = () => {
                const linked = getLive().scaleLinked !== false;
                linkBtn.innerHTML = linked
                  ? `<i class="fticon fticon-icon-34" style="width:10px;height:10px;font-size:10px;line-height:1;" aria-hidden="true"></i>`
                  : `<i class="fticon fticon-icon-35" style="width:10px;height:10px;font-size:10px;line-height:1;" aria-hidden="true"></i>`;
                linkBtn.classList.toggle('is-linked', linked);
              };
              syncLinkIcon();
              linkBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
              linkBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const r = getLive();
                r.scaleLinked = r.scaleLinked === false ? true : false;
                syncLinkIcon();
                compSpans.forEach((s, i) => { s.textContent = String(components[i].getVal()); });
                if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
              });
              pRow.appendChild(linkBtn);
            }

            pRow.appendChild(valContainer);

            // Click prop row (not on stopwatch or val) = select all KFs for this prop
            pRow.addEventListener('click', (e) => {
              if (e.target === swBtn || swBtn.contains(e.target)) return;
              if (e.target === valContainer || valContainer.contains(e.target)) return;
              e.stopPropagation();
              window.activeKeyframeProperty = p.prop;
              if (typeof window.syncDesktopInspectorProperty === 'function') {
                window.syncDesktopInspectorProperty(layer, p.prop);
              }
              if (window.selectedLayerId !== layer.id && typeof selectTimelineLayer === 'function') {
                selectTimelineLayer(layer.id, false, true);
              }
              if (Array.isArray(p.keyframes) && p.keyframes.length > 0) {
                const isShift = !!(e.shiftKey || e.metaKey || e.ctrlKey);
                if (!isShift && typeof window.clearSelectedKeyframes === 'function') {
                  window.clearSelectedKeyframes();
                }
                if (!window.selectedKeyframes) window.selectedKeyframes = [];
                p.keyframes.forEach(kf => {
                  const dm = document.querySelector(`.desktop-kf-diamond[data-prop="${p.prop}"][data-time="${kf.time}"]`);
                  if (dm) dm.classList.add('is-selected-kf');
                  if (!window.selectedKeyframes.some(it => it.kf === kf || (it.layerId === layer.id && it.prop === p.prop && Math.abs(it.time - kf.time) < 0.002))) {
                    window.selectedKeyframes.push({
                      layerId: layer.id,
                      layer: layer,
                      prop: p.prop,
                      time: kf.time,
                      kf: kf,
                      marker: dm
                    });
                  }
                });
              }
            });

            treeEl.appendChild(pRow);
          });
        });

        return treeEl;
      }
      window.buildDesktopKfPropertyTree = buildDesktopKfPropertyTree;

      function buildDesktopKfTracksWrapper(layer, pps, onlyKeyframed = false) {
        const catRows = getLayerCategorizedKeyframeRows(layer, onlyKeyframed);
        const tracksEl = document.createElement('div');
        tracksEl.className = 'desktop-kf-tracks-wrapper';

        tracksEl.addEventListener('click', (ev) => {
          if (ev.target.closest('.desktop-kf-diamond')) return;
          if (!ev.shiftKey && !ev.metaKey && !ev.ctrlKey) {
            if (typeof window.clearSelectedKeyframes === 'function') {
              window.clearSelectedKeyframes();
            }
          }
        });

        const clipStartSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const clipDurSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
        const clipEndSec = clipStartSec + clipDurSec;

        catRows.forEach(cat => {
          const catTrack = document.createElement('div');
          catTrack.className = 'desktop-kf-track-cat-row';
          tracksEl.appendChild(catTrack);

          cat.props.forEach(p => {
            const pTrack = document.createElement('div');
            pTrack.className = 'desktop-kf-track-row';
            pTrack.dataset.prop = p.prop;

            // Track line click: deselect keyframes if no modifier held; STRICTLY NO SEEKING PLAYHEAD
            pTrack.addEventListener('click', (ev) => {
              if (ev.target.closest('.desktop-kf-diamond')) return;
              if (!ev.shiftKey && !ev.metaKey && !ev.ctrlKey) {
                if (typeof window.clearSelectedKeyframes === 'function') {
                  window.clearSelectedKeyframes();
                }
              }
              // STRICT REQUIREMENT: Only the ruler changes current time/duration in desktop mode!
            });

            // Render diamond keyframes
            (p.keyframes || []).forEach(kf => {
              const isOutOfBounds = (kf.time < clipStartSec - 0.001) || (kf.time > clipEndSec + 0.001);
              const diamond = document.createElement('div');
              diamond.className = `desktop-kf-diamond${isOutOfBounds ? ' is-out-of-bounds' : ''}`;
              const leftPx = kf.time * pps;
              diamond.style.left = `${leftPx.toFixed(1)}px`;
              diamond.dataset.time = kf.time;
              diamond.dataset.prop = p.prop;
              diamond.dataset.layerId = layer.id;
              diamond.title = `${p.label}: ${kf.time.toFixed(2)}s\nValue: ${typeof p.curValue === 'string' ? p.curValue : ''}`;

              const isSelected = Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.some(it => 
                (it.marker === diamond) || (it.layerId === layer.id && it.prop === p.prop && Math.abs(it.time - kf.time) < 0.002)
              );
              if (isSelected) {
                diamond.classList.add('is-selected-kf');
                const matchItem = window.selectedKeyframes.find(it => 
                  (it.layerId === layer.id && it.prop === p.prop && Math.abs(it.time - kf.time) < 0.002)
                );
                if (matchItem) {
                  matchItem.marker = diamond;
                  matchItem.kf = kf;
                  matchItem.layer = layer;
                }
              }

              diamond.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();

                const isShift = !!(e.shiftKey || e.metaKey || e.ctrlKey);
                const wasAlreadySelected = Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.some(it => 
                  it.kf === kf || (it.layerId === layer.id && it.prop === p.prop && Math.abs(it.time - kf.time) < 0.002)
                );

                if (window.selectedLayerId !== layer.id && typeof selectTimelineLayer === 'function') {
                  selectTimelineLayer(layer.id, false, true);
                }

                if (!wasAlreadySelected) {
                  if (!isShift) {
                    if (typeof window.clearSelectedKeyframes === 'function') window.clearSelectedKeyframes();
                  }
                  diamond.classList.add('is-selected-kf');
                  if (!window.selectedKeyframes) window.selectedKeyframes = [];
                  window.selectedKeyframes.push({ layerId: layer.id, layer, prop: p.prop, time: kf.time, kf, marker: diamond });
                }

                const startX = e.clientX;
                const startY = e.clientY;
                const kfInitialTime = kf.time;
                let hasMoved = false;

                try { diamond.setPointerCapture(e.pointerId); } catch (_) {}

                const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
                const multiDragSnapshots = (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0)
                  ? window.selectedKeyframes.map(it => {
                      const targetLayer = it.layer || layers.find(l => l.id === it.layerId);
                      const targetKf = it.kf || (targetLayer && targetLayer.keyframes && targetLayer.keyframes[it.prop] ? targetLayer.keyframes[it.prop].find(k => Math.abs(k.time - it.time) < 0.002) : null);
                      const targetDiamond = it.marker || document.querySelector(`.desktop-kf-diamond[data-prop="${it.prop}"][data-time="${it.time}"]`);
                      return {
                        item: it,
                        layer: targetLayer,
                        kf: targetKf,
                        prop: it.prop,
                        origTime: (targetKf ? targetKf.time : it.time),
                        marker: targetDiamond
                      };
                    })
                  : [{
                      item: { layerId: layer.id, layer, prop: p.prop, time: kf.time, kf, marker: diamond },
                      layer: layer,
                      kf: kf,
                      prop: p.prop,
                      origTime: kf.time,
                      marker: diamond
                    }];

                function onDiamondMove(ev) {
                  const currentZoom = window.__OFT_ZOOM || (typeof window.oftUiScaleFactor === 'function' ? window.oftUiScaleFactor() : 1) || parseFloat(document.documentElement.style.zoom) || 1;
                  const dx = (ev.clientX - startX) / currentZoom;
                  const dy = (ev.clientY - startY) / currentZoom;
                  if (!hasMoved && Math.hypot(dx, dy) > 3) {
                    hasMoved = true;
                    window.isTransformInteracting = true;
                    multiDragSnapshots.forEach(s => {
                      if (s.marker) s.marker.classList.add('is-dragging');
                    });
                  }
                  if (!hasMoved) return;

                  ev.stopPropagation();
                  ev.preventDefault();

                  const fps = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
                  let rawLeaderTime = Math.max(0, kfInitialTime + dx / pps);

                  if (window.isTimelineSnapEnabled !== false) {
                    const curP = (typeof window.getCurrentPlayheadTime === 'function') ? window.getCurrentPlayheadTime() : (window.currentSec || 0);
                    let snapped = false;
                    if (Math.abs(rawLeaderTime - curP) * pps < 6) {
                      rawLeaderTime = curP;
                      snapped = true;
                    }
                    if (!snapped) {
                      const snapTargets = [];
                      if (window.currentProjectState) {
                        if (window.currentProjectState.beatmarks) snapTargets.push(...window.currentProjectState.beatmarks);
                        (window.currentProjectState.layers || []).forEach(l => {
                          if (l.markers) snapTargets.push(...l.markers.map(m => typeof m === 'number' ? m : m.time));
                          if (l.keyframes) Object.values(l.keyframes).forEach(kList => {
                            if (Array.isArray(kList)) snapTargets.push(...kList.map(k => k.time));
                          });
                          // Ujung layer (in/out) ikut magnet bila magnet nyala
                          const lin = (l.startSec !== undefined) ? l.startSec : ((l.startPx || 0) / pps);
                          snapTargets.push(Number(lin.toFixed(4)));
                          const ldur = (l.durationSec !== undefined) ? l.durationSec : 0;
                          if (ldur > 0) snapTargets.push(Number((lin + ldur).toFixed(4)));
                        });
                      }
                      for (let t of snapTargets) {
                        if (Math.abs(rawLeaderTime - t) * pps < 6) {
                          rawLeaderTime = t;
                          break;
                        }
                      }
                    }
                  }

                  rawLeaderTime = Math.round(rawLeaderTime * fps) / fps;
                  const deltaTime = rawLeaderTime - kfInitialTime;

                  multiDragSnapshots.forEach(s => {
                    const shifted = Math.max(0, Number((s.origTime + deltaTime).toFixed(4)));
                    if (s.kf) s.kf.time = shifted;
                    if (s.item) s.item.time = shifted;
                    if (s.marker) {
                      s.marker.style.left = `${(shifted * pps).toFixed(1)}px`;
                      s.marker.dataset.time = shifted;
                      s.marker.title = `${s.prop}: ${shifted.toFixed(2)}s`;
                      const tLayer = s.layer || layer;
                      if (tLayer) {
                        const tStart = tLayer.startSec !== undefined ? tLayer.startSec : ((tLayer.startPx || 0) / pps);
                        const tDur = tLayer.durationSec !== undefined ? tLayer.durationSec : ((tLayer.widthPx || 320) / pps);
                        s.marker.classList.toggle('is-out-of-bounds', shifted < tStart - 0.001 || shifted > tStart + tDur + 0.001);
                      }
                    }
                  });

                  if (typeof redrawComposition === 'function') {
                    redrawComposition('keyframe-drag');
                  }
                }

                function onDiamondUp(ev) {
                  try { diamond.releasePointerCapture(ev.pointerId); } catch (_) {}
                  window.isTransformInteracting = false;
                  multiDragSnapshots.forEach(s => {
                    if (s.marker) s.marker.classList.remove('is-dragging');
                  });
                  window.removeEventListener('pointermove', onDiamondMove, true);
                  window.removeEventListener('pointerup', onDiamondUp, true);
                  window.removeEventListener('pointercancel', onDiamondUp, true);

                  if (hasMoved) {
                    const affectedLayers = new Set();
                    multiDragSnapshots.forEach(s => {
                      if (s.layer && s.layer.keyframes && Array.isArray(s.layer.keyframes[s.prop])) {
                        // Merge: keyframe yang di-drop tepat di waktu keyframe lain -> gantikan
                        const list = s.layer.keyframes[s.prop];
                        for (let i = list.length - 1; i >= 0; i--) {
                          if (list[i] !== s.kf && Math.abs(list[i].time - s.kf.time) < 0.001) {
                            list.splice(i, 1);
                          }
                        }
                        list.sort((a, b) => a.time - b.time);
                        affectedLayers.add(s.layer);
                      }
                    });

                    affectedLayers.forEach(l => {
                      if (typeof invalidatePreviewCacheForLayer === 'function') {
                        invalidatePreviewCacheForLayer(l);
                      }
                      if (typeof syncLayerKeyframeMarkersInPlace === 'function') {
                        syncLayerKeyframeMarkersInPlace(l);
                      }
                    });

                    if (typeof saveCurrentProjectLayers === 'function') {
                      saveCurrentProjectLayers();
                    }
                    if (typeof redrawComposition === 'function') {
                      redrawComposition('keyframe-drag-end');
                    }
                    if (typeof updateTransformKeyframeBtnState === 'function') updateTransformKeyframeBtnState();
                    if (typeof updateBlendKeyframeBtnState === 'function') updateBlendKeyframeBtnState();
                    if (typeof syncEffectsKeyframeState === 'function') syncEffectsKeyframeState(layer);
                  } else {
                    if (isShift) {
                      if (wasAlreadySelected) {
                        diamond.classList.remove('is-selected-kf');
                        window.selectedKeyframes = window.selectedKeyframes.filter(it => 
                          !(it.kf === kf || (it.layerId === layer.id && it.prop === p.prop && Math.abs(it.time - kf.time) < 0.002))
                        );
                      }
                    } else {
                      const wasSoleSelected = wasAlreadySelected && 
                        Array.isArray(window.selectedKeyframes) && 
                        window.selectedKeyframes.length === 1 && 
                        (window.selectedKeyframes[0].kf === kf || (window.selectedKeyframes[0].layerId === layer.id && window.selectedKeyframes[0].prop === p.prop && Math.abs(window.selectedKeyframes[0].time - kf.time) < 0.002));

                      if (wasSoleSelected) {
                        if (typeof window.clearSelectedKeyframes === 'function') window.clearSelectedKeyframes();
                      } else {
                        if (typeof window.clearSelectedKeyframes === 'function') window.clearSelectedKeyframes();
                        diamond.classList.add('is-selected-kf');
                        window.selectedKeyframes = [{ layerId: layer.id, layer, prop: p.prop, time: kf.time, kf, marker: diamond }];
                        // Strictly DO NOT seek timeline on keyframe diamond click on desktop
                      }
                    }
                  }
                }

                window.addEventListener('pointermove', onDiamondMove, true);
                window.addEventListener('pointerup', onDiamondUp, true);
                window.addEventListener('pointercancel', onDiamondUp, true);
              });

              diamond.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (window.selectedLayerId !== layer.id && typeof selectTimelineLayer === 'function') {
                  selectTimelineLayer(layer.id, false, true);
                }
                const isAlreadySelected = Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.some(it => 
                  it.kf === kf || (it.layerId === layer.id && it.prop === p.prop && Math.abs(it.time - kf.time) < 0.002)
                );
                if (!isAlreadySelected) {
                  if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
                    if (typeof window.clearSelectedKeyframes === 'function') window.clearSelectedKeyframes();
                  }
                  diamond.classList.add('is-selected-kf');
                  if (!window.selectedKeyframes) window.selectedKeyframes = [];
                  window.selectedKeyframes.push({ layerId: layer.id, layer, prop: p.prop, time: kf.time, kf, marker: diamond });
                }
                if (window.Popover) {
                  const mouseAnchor = {
                    isVirtual: true,
                    isContextMenu: true,
                    getBoundingClientRect: () => ({
                      left: e.clientX,
                      top: e.clientY,
                      right: e.clientX,
                      bottom: e.clientY,
                      width: 0,
                      height: 0
                    }),
                    dataset: {}
                  };
                  window.Popover.open(mouseAnchor, 'popover-layer-actions');
                }
              });

              pTrack.appendChild(diamond);
            });

            tracksEl.appendChild(pTrack);
          });
        });

        return tracksEl;
      }
      window.buildDesktopKfTracksWrapper = buildDesktopKfTracksWrapper;

      function toggleLayerKeyframeExpansion(layerId, forceState, onlyKeyframed = false) {
        const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
        const layer = layers.find(l => String(l.id) === String(layerId));
        if (!layer) return;

        const isDesktop = (typeof isDesktopLayout === 'function') ? isDesktopLayout() : false;
        if (layer.type === 'precomp' && isDesktop) {
          const willExpand = (typeof forceState === 'boolean') ? forceState : !layer._precompExpanded;
          layer._precompExpanded = willExpand;
          layer._kfExpanded = willExpand;
          if (typeof renderTimelineLayers === 'function') {
            renderTimelineLayers();
          }
          return;
        }

        const willExpand = (typeof forceState === 'boolean') ? forceState : !layer._kfExpanded;
        layer._kfExpanded = willExpand;
        layer._kfExpandedOnlyKeyframed = willExpand ? !!onlyKeyframed : false;
        // Solo prop (shortcut S/P/R/T/A): hanya berlaku bila expand semua.
        // Collapse atau mode keyframed-only (U) selalu bersihkan solo.
        if (!willExpand || onlyKeyframed) layer._kfSoloProp = null;

        const overlayContainer = document.getElementById('timeline-lane-heads-overlay');
        const pillSlot = overlayContainer ? overlayContainer.querySelector(`.timeline-lane-pill-slot[data-layer-id="${layer.id}"]`) : null;
        const lane = layersTrack ? layersTrack.querySelector(`.timeline-track-lane[data-layer-id="${layer.id}"]`) : null;

        if (!pillSlot || !lane) {
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          return;
        }

        const twistie = pillSlot.querySelector('.desktop-layer-twistie-btn');
        if (willExpand) {
          pillSlot.classList.add('is-kf-expanded');
          lane.classList.add('is-kf-expanded');
          if (twistie) {
            twistie.classList.add('is-expanded');
            twistie.title = 'Collapse Keyframes (U)';
            twistie.setAttribute('aria-label', twistie.title);
          }
          const oldTree = pillSlot.querySelector('.desktop-kf-property-tree');
          if (oldTree) oldTree.remove();
          const oldTracks = lane.querySelector('.desktop-kf-tracks-wrapper');
          if (oldTracks) oldTracks.remove();

          const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
          const treeEl = buildDesktopKfPropertyTree(layer, layer._kfExpandedOnlyKeyframed);
          const tracksEl = buildDesktopKfTracksWrapper(layer, pps, layer._kfExpandedOnlyKeyframed);
          pillSlot.appendChild(treeEl);
          lane.appendChild(tracksEl);
        } else {
          pillSlot.classList.remove('is-kf-expanded');
          lane.classList.remove('is-kf-expanded');
          if (twistie) {
            twistie.classList.remove('is-expanded');
            twistie.title = 'Expand Keyframes (U)';
            twistie.setAttribute('aria-label', twistie.title);
          }
          const oldTree = pillSlot.querySelector('.desktop-kf-property-tree');
          if (oldTree) oldTree.remove();
          const oldTracks = lane.querySelector('.desktop-kf-tracks-wrapper');
          if (oldTracks) oldTracks.remove();

          const clipEl = lane.querySelector('.timeline-clip-block');
          if (clipEl) {
            renderLayerKeyframes(layer, clipEl);
          }
        }

        if (typeof window.syncDesktopPlayhead === 'function') {
          window.syncDesktopPlayhead();
        }
      }
      window.toggleLayerKeyframeExpansion = toggleLayerKeyframeExpansion;

      function toggleKeyframeExpansionForSelection(selectedIds, onlyKeyframed = true) {
        const currentLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
        const targetLayers = currentLayers.filter(l => selectedIds.includes(l.id));
        if (targetLayers.length === 0) return;

        if (onlyKeyframed) {
          const hasAnyKf = targetLayers.some(l => {
            if (!l || !l.keyframes) return false;
            return Object.values(l.keyframes).some(list => Array.isArray(list) && list.length > 0);
          });

          if (!hasAnyKf) {
            if (typeof window.showEffectsRackToast === 'function') {
              window.showEffectsRackToast('No keyframes on selected layer(s)');
            }
            return;
          }
        }

        const anyExpanded = targetLayers.some(l => l && l._kfExpanded);
        const willExpand = !anyExpanded;

        targetLayers.forEach(l => {
          toggleLayerKeyframeExpansion(l.id, willExpand, onlyKeyframed);
        });
      }
      window.toggleKeyframeExpansionForSelection = toggleKeyframeExpansionForSelection;
  }
  window.initTimelineRulerAndPan = initTimelineRulerAndPan;
  initTimelineRulerAndPan();

    (function initEditorZoomStepper() {
      const zoomLevels = [50, 75, 100, 125, 150, 175, 200];
      let currentIdx = 2; // Default 100%

      const plusBtn = document.getElementById('editor-zoom-plus');
      const minusBtn = document.getElementById('editor-zoom-minus');
      const valEl = document.getElementById('editor-zoom-val');
      const previewBox = document.getElementById('editor-preview-canvas');
      const previewContainer = document.getElementById('editor-preview-container');

      let panX = 0;
      let panY = 0;

      function applyTransform() {
        if (!previewBox) return;
        const scale = zoomLevels[currentIdx] / 100;
        if (scale === 1) {
          panX = 0;
          panY = 0;
          previewBox.style.transform = 'scale(1)';
        } else {
          previewBox.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        }
      }

      function updateZoom() {
        if (valEl) {
          valEl.textContent = `${zoomLevels[currentIdx]}%`;
        }
        applyTransform();
      }

      if (plusBtn) {
        plusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentIdx < zoomLevels.length - 1) {
            currentIdx++;
            updateZoom();
          }
        });
      }

      if (minusBtn) {
        minusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentIdx > 0) {
            currentIdx--;
            updateZoom();
          }
        });
      }

      if (valEl) {
        valEl.addEventListener('click', (e) => {
          e.stopPropagation();
          currentIdx = 2; // Reset to default 100%
          panX = 0;
          panY = 0;
          updateZoom();
        });
      }

      // Ctrl + Wheel to Zoom In / Out over Preview Viewport
      if (previewContainer) {
        previewContainer.addEventListener('wheel', (e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.deltaY < 0 && currentIdx < zoomLevels.length - 1) {
              currentIdx++;
              updateZoom();
            } else if (e.deltaY > 0 && currentIdx > 0) {
              currentIdx--;
              updateZoom();
            }
          }
        }, { passive: false });

        // Pan capability when zoomed in (> 100%) or holding Space / Middle Mouse
        let isPanning = false;
        let startX = 0;
        let startY = 0;
        let startPanX = 0;
        let startPanY = 0;
        previewContainer.addEventListener('pointerdown', (e) => {
          const isZoomed = zoomLevels[currentIdx] > 100;
          const isMiddleBtn = e.button === 1;
          const isCanvasTarget = e.target.id === 'editor-active-canvas';

          // Allow panning if middle-click, or zoomed and clicking canvas background / container (or Shift held)
          if (isMiddleBtn || (isZoomed && (!isCanvasTarget || e.shiftKey))) {
            isPanning = true;
            startX = e.clientX;
            startY = e.clientY;
            startPanX = panX;
            startPanY = panY;
            previewContainer.setPointerCapture(e.pointerId);
            previewContainer.style.cursor = 'grabbing';
            e.preventDefault();
          }
        });

        previewContainer.addEventListener('pointermove', (e) => {
          if (!isPanning) return;
          panX = startPanX + (e.clientX - startX);
          panY = startPanY + (e.clientY - startY);
          applyTransform();
        }, { passive: true });

        const stopPan = (e) => {
          if (isPanning) {
            isPanning = false;
            try { previewContainer.releasePointerCapture(e.pointerId); } catch (_) {}
            previewContainer.style.cursor = window.isSpacePressed ? 'grab' : '';
          }
        };

        previewContainer.addEventListener('pointerup', stopPan);
        previewContainer.addEventListener('pointercancel', stopPan);

        let containerDownPos = null;
        previewContainer.addEventListener('pointerdown', (e) => {
          if (e.button === 0 && (e.target === previewContainer || e.target.id === 'editor-preview-canvas')) {
            containerDownPos = { x: e.clientX, y: e.clientY };
          } else {
            containerDownPos = null;
          }
        });
        previewContainer.addEventListener('pointerup', (e) => {
          if (containerDownPos && e.button === 0 && (e.target === previewContainer || e.target.id === 'editor-preview-canvas')) {
            const dist = Math.hypot(e.clientX - containerDownPos.x, e.clientY - containerDownPos.y);
            containerDownPos = null;
            if (dist <= 5) {
              const isAdditive = !!(e.shiftKey || e.metaKey || e.ctrlKey);
              if (!isAdditive) {
                if (typeof window.deselectAllDesktopLayers === 'function') {
                  window.deselectAllDesktopLayers();
                } else if (typeof window.deselectTimelineLayer === 'function') {
                  window.deselectTimelineLayer();
                } else if (typeof deselectTimelineLayer === 'function') {
                  deselectTimelineLayer();
                }
              }
            }
          }
        });

        previewContainer.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const targetId = window.selectedLayerId || (window.selectedLayerIds ? Array.from(window.selectedLayerIds)[0] : null);
          const layer = (currentProjectState.layers || []).find(l => l.id === targetId);
          if (layer && typeof window.triggerClipContextMenu === 'function') {
            window.triggerClipContextMenu(layer, e.clientX, e.clientY, e);
          }
        });
      }

      // Initialize default 100%
      updateZoom();

      // Expose helper globally
      window.setPreviewZoomLevel = function(idx) {
        if (idx >= 0 && idx < zoomLevels.length) {
          currentIdx = idx;
          updateZoom();
        }
      };
      window.getPreviewZoomLevel = function() {
        return zoomLevels[currentIdx];
      };
    })();
