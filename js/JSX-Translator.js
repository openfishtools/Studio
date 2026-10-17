/**
 * OpenFishTools Studio - Universal JSX Translator & Runtime Engine
 * Single file translator: allows users in front-end to simply import or write .jsx files
 * without needing separate .js files for every single card or tool.
 *
 * Provides:
 * 1. Universal Tool Dispatcher (translates any ctx.runTool('TOOL_NAME') to native Web Studio layers & effects)
 * 2. 100% Precise Parameters for Warp Presets (WARP 1, 2, 3), Beat Effects, Null Rigs, Velocity, and Transitions
 * 3. ExtendScript DOM Mock/Shim (window.app.project.activeItem...) so traditional AE .jsx scripts run seamlessly
 * 4. Cross-Frame PostMessage Listener for Extension IFrames
 */

(function (global) {
  'use strict';

  // =========================================================================
  // UTILITY HELPERS
  // =========================================================================
  const uid = (prefix) => prefix + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

  function getProjectFps() {
    if (typeof global.getProjectFps === 'function') return global.getProjectFps();
    if (global.currentProjectState && global.currentProjectState.fps) {
      return parseInt(global.currentProjectState.fps, 10) || 60;
    }
    return 60;
  }

  function getPixelsPerSecond() {
    return global.currentPixelsPerSecond || 80;
  }

  function getPlayheadSec() {
    const pps = getPixelsPerSecond();
    if (typeof global.getCurrentPlayheadTime === 'function') return global.getCurrentPlayheadTime();
    if (typeof global.getTimelineCurrentSec === 'function') return global.getTimelineCurrentSec();
    const curPanX = global.timelinePanX !== undefined ? global.timelinePanX : 0;
    return Math.max(0, -curPanX / pps);
  }

  function getSelectedLayers() {
    const layers = (global.currentProjectState && global.currentProjectState.layers) || [];
    const ids = new Set();
    if (global.selectedLayerIds && global.selectedLayerIds.size > 0) {
      global.selectedLayerIds.forEach(id => ids.add(id));
    }
    if (global.selectedLayerId) ids.add(global.selectedLayerId);
    let selected = layers.filter(l => ids.has(l.id));
    if (selected.length === 0 && layers.length > 0) {
      const fallback = layers.find(l => !l.hidden) || layers[0];
      if (fallback) {
        if (typeof global.selectTimelineLayer === 'function') global.selectTimelineLayer(fallback.id, false);
        else global.selectedLayerId = fallback.id;
        selected = [fallback];
      }
    }
    return selected;
  }

  function getSelectedLayerTiming() {
    const pps = getPixelsPerSecond();
    const sel = getSelectedLayers();
    if (sel.length > 0) {
      const l = sel[0];
      const startSec = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
      const durationSec = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 320) / pps);
      return { startSec, durationSec };
    }
    return { startSec: getPlayheadSec(), durationSec: 5 };
  }

  function createSlider(name, val, min, max, step, unit) {
    return {
      id: uid('fx_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_')),
      type: 'slider-control',
      name: name,
      slider: val,
      value: val,
      min: min !== undefined ? min : -10000,
      max: max !== undefined ? max : 10000,
      step: step !== undefined ? step : 1,
      unit: unit || '',
      isExpanded: true
    };
  }

  function invalidateLayerRange(layer) {
    if (!layer) return;
    if (typeof global.invalidatePreviewCacheForLayer === 'function') {
      global.invalidatePreviewCacheForLayer(layer);
    } else if (global.PreviewCacheManager && typeof global.PreviewCacheManager.invalidateLayer === 'function') {
      global.PreviewCacheManager.invalidateLayer(layer);
    }
  }

  function notifyProjectChange(reason, toastMsg, affectedLayers) {
    if (Array.isArray(affectedLayers)) {
      affectedLayers.forEach(l => invalidateLayerRange(l));
    } else if (affectedLayers && typeof affectedLayers === 'object') {
      invalidateLayerRange(affectedLayers);
    }
    if (typeof global.saveCurrentProjectLayers === 'function') global.saveCurrentProjectLayers();
    if (typeof global.renderTimelineLayers === 'function') global.renderTimelineLayers();
    if (typeof global.redrawComposition === 'function') global.redrawComposition(reason);
    if (typeof global.syncEffectsRackUI === 'function') global.syncEffectsRackUI();
    if (typeof global.syncTransformControllerValues === 'function') global.syncTransformControllerValues();
    if (typeof global.updateTransformControllerValues === 'function') global.updateTransformControllerValues();
    if (toastMsg && typeof global.showEffectsRackToast === 'function') global.showEffectsRackToast(toastMsg);
    else if (toastMsg && typeof global.showEditorToast === 'function') global.showEditorToast(toastMsg);
  }

  // =========================================================================
  // WARP PRESETS (WARP 1, WARP 2, WARP 3) - 100% PRECISE MATCH
  // =========================================================================
  function applyPresetWarp1() {
    if (global.UndoRedoManager && typeof global.UndoRedoManager.recordSnapshot === 'function') {
      global.UndoRedoManager.recordSnapshot();
    }
    const fps = getProjectFps();
    const rawPlayheadSec = getPlayheadSec();
    const curFrame = Math.round(rawPlayheadSec * fps);
    const curSec = Number((curFrame / fps).toFixed(4));
    const selId = global.selectedLayerId;
    const createdLayers = [];

    // 1. Layer: Mid-Wave (145 frames)
    const midwavePreFrames = Math.round((20 / 60) * fps);
    const midwaveStartFrame = Math.max(0, curFrame - midwavePreFrames);
    const midwaveStart = Number((midwaveStartFrame / fps).toFixed(4));
    const midwaveDur = Number((145 / fps).toFixed(4));
    const mwT1 = midwaveStart;
    const mwT2 = Number((curSec + (2 / fps)).toFixed(4));
    const mwT3 = Number((midwaveStart + midwaveDur).toFixed(4));

    const adjMidwave = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(midwaveDur, midwaveStart) : null;
    if (!adjMidwave) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adjMidwave.name = 'Mid-Wave';
    adjMidwave.isDurationExplicit = true;
    adjMidwave.direction = 45;
    adjMidwave.waveHeight = 187;
    adjMidwave.waveWidth = 4000;
    adjMidwave.speed = 1.6;

    const ww1 = {
      id: uid('fx_wave_warp_1'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 187,
      waveWidth: 4000,
      direction: 45,
      speed: 1.6,
      phase: 0,
      tile: 1
    };
    const ww2 = {
      id: uid('fx_wave_warp_2'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 287,
      waveWidth: 4000,
      direction: -206,
      speed: -1.45,
      phase: 0,
      tile: 1
    };

    adjMidwave.effects = [ww1, ww2];
    adjMidwave.keyframes = {
      [`${ww1.id}:waveWidth`]: [],
      [`${ww1.id}:waveHeight`]: [
        { time: mwT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
        { time: mwT2, value: { waveHeight: 187 }, easing: [0.002, 1, 0.291, 1] },
        { time: mwT3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ],
      [`${ww2.id}:waveHeight`]: [
        { time: mwT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
        { time: mwT2, value: { waveHeight: 287 }, easing: [0.002, 1, 0.291, 1] },
        { time: mwT3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ]
    };
    adjMidwave.defaultEasing = {
      [`${ww1.id}:waveWidth`]: [0, 0, 1, 1],
      [`${ww1.id}:waveHeight`]: [0.002, 1, 0.224, 1],
      [`${ww2.id}:waveHeight`]: [0.002, 1, 0.138, 1]
    };
    adjMidwave._defaultEasing = adjMidwave.defaultEasing;
    createdLayers.push(adjMidwave);

    // 2. Layer: Warp Effect (63 frames)
    const warpPreFrames = Math.round((16 / 60) * fps);
    const warpStartFrame = Math.max(0, curFrame - warpPreFrames);
    const warpStart = Number((warpStartFrame / fps).toFixed(4));
    const warpDur = Number((63 / fps).toFixed(4));
    const warpSourceOffset = Number((28 / fps).toFixed(4));
    const warpT1 = warpStart;
    const warpT2 = curSec;
    const warpT3 = Number((warpStart + warpDur).toFixed(4));

    const adjWarp = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(warpDur, warpStart) : null;
    if (adjWarp) {
      adjWarp.name = 'Warp Effect';
      adjWarp.isDurationExplicit = true;
      adjWarp.sourceOffsetSec = warpSourceOffset;
      adjWarp.waveHeight = 0;
      adjWarp.waveWidth = 10;
      adjWarp.speed = 10;
      adjWarp.phase = 273;

      const warpWw1 = {
        id: uid('fx_wave_warp_1'),
        type: 'wave-warp',
        name: 'Wave Warp',
        isExpanded: true,
        disabled: false,
        waveType: 'smooth-noise',
        waveHeight: 0,
        waveWidth: 10,
        direction: 90,
        speed: 10,
        phase: 273,
        tile: 1
      };
      const warpWw2 = {
        id: uid('fx_wave_warp_2'),
        type: 'wave-warp',
        name: 'Wave Warp',
        isExpanded: true,
        disabled: false,
        waveType: 'smooth-noise',
        waveHeight: 0,
        waveWidth: 10,
        direction: 90,
        speed: 10,
        phase: 273,
        tile: 1
      };

      adjWarp.effects = [warpWw1, warpWw2];
      adjWarp.keyframes = {
        [`${warpWw1.id}:waveHeight`]: [
          { time: warpT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
          { time: warpT2, value: { waveHeight: 20 }, easing: [0, 1, 0, 1] },
          { time: warpT3, value: { waveHeight: 0 }, easing: [0, 0, 0.2, 1] }
        ],
        [`${warpWw1.id}:speed`]: [
          { time: warpT1, value: { speed: 10 }, easing: [0, 0, 1, 1] }
        ],
        [`${warpWw2.id}:waveHeight`]: [
          { time: warpT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
          { time: warpT2, value: { waveHeight: 20 }, easing: [0, 0, 0, 1] },
          { time: warpT3, value: { waveHeight: 0 }, easing: [0, 0, 0.2, 1] }
        ],
        [`${warpWw2.id}:speed`]: [
          { time: warpT1, value: { speed: 10 }, easing: [0, 0, 1, 1] }
        ]
      };
      adjWarp.defaultEasing = { [`${warpWw1.id}:waveHeight`]: [0, 0, 0.2, 1] };
      adjWarp._defaultEasing = adjWarp.defaultEasing;
      createdLayers.push(adjWarp);
    }

    // 3. Layer: Ghost Effect (125 frames)
    const ghostStart = curSec;
    const ghostDur = Number((125 / fps).toFixed(4));
    const ghT1 = curSec;
    const ghT2 = Number((curSec + ghostDur).toFixed(4));
    const ghOpT2 = Number((curSec + (65 / fps)).toFixed(4));

    const adjGhost = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(ghostDur, ghostStart) : null;
    if (adjGhost) {
      adjGhost.name = 'Ghost Effect';
      adjGhost.isDurationExplicit = true;

      const transformFx = {
        id: uid('fx_transform'),
        type: 'transform',
        name: 'Transform',
        isExpanded: true,
        disabled: false,
        posX: 0,
        posY: 0,
        scale: 100,
        rotation: 0,
        skew: 0,
        anchorX: 0,
        anchorY: 0,
        opacity: 100
      };
      adjGhost.effects = [transformFx];

      const easeGhost = [0, 0, 0.2, 1];
      adjGhost.keyframes = {
        [`${transformFx.id}:scale`]: [
          { time: ghT1, value: { scale: 100 }, easing: [...easeGhost] },
          { time: ghT2, value: { scale: 220 }, easing: [...easeGhost] }
        ],
        [`${transformFx.id}:opacity`]: [],
        opacity: [
          { time: ghT1, value: { opacity: 1 }, easing: [...easeGhost] },
          { time: ghOpT2, value: { opacity: 0 }, easing: [...easeGhost] }
        ]
      };
      adjGhost.defaultEasing = {
        [`${transformFx.id}:scale`]: [...easeGhost],
        [`${transformFx.id}:opacity`]: [...easeGhost],
        opacity: [...easeGhost]
      };
      adjGhost._defaultEasing = adjGhost.defaultEasing;
      createdLayers.push(adjGhost);
    }

    // 4. Layer: Hue Spin (43 frames)
    const hueStart = curSec;
    const hueDur = Number((43 / fps).toFixed(4));
    const hueT1 = curSec;
    const hueT2 = Number((curSec + (25 / fps)).toFixed(4));

    const adjHue = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(hueDur, hueStart) : null;
    if (adjHue) {
      adjHue.name = 'Hue Spin';
      adjHue.isDurationExplicit = true;

      const hueFx = {
        id: uid('fx_hue_shift'),
        type: 'hue-shift',
        name: 'Hue Shift',
        isExpanded: true,
        disabled: false,
        hue: 0
      };
      adjHue.effects = [hueFx];

      const linearEase = [0, 0, 1, 1];
      adjHue.keyframes = {
        [`${hueFx.id}:hue`]: [
          { time: hueT1, value: { hue: 0 }, easing: [...linearEase] },
          { time: hueT2, value: { hue: 360 }, easing: [...linearEase] }
        ]
      };
      adjHue.defaultEasing = { [`${hueFx.id}:hue`]: [...linearEase] };
      adjHue._defaultEasing = adjHue.defaultEasing;
      createdLayers.push(adjHue);
    }

    // Stack in order above selected layer
    const stackInOrder = [adjMidwave, adjWarp, adjGhost, adjHue].filter(Boolean);
    const layers = (global.currentProjectState && global.currentProjectState.layers) || [];

    const idsToRemove = new Set(createdLayers.map(l => l.id));
    for (let i = layers.length - 1; i >= 0; i--) {
      if (idsToRemove.has(layers[i].id)) layers.splice(i, 1);
    }

    if (selId) {
      const selIdx = layers.findIndex(l => l.id === selId);
      if (selIdx >= 0) layers.splice(selIdx, 0, ...stackInOrder);
      else layers.unshift(...stackInOrder);
    } else {
      layers.unshift(...stackInOrder);
    }

    const topLayer = adjMidwave || adjWarp;
    if (typeof global.selectTimelineLayer === 'function') global.selectTimelineLayer(topLayer.id, false);
    if (global.selectedLayerIds) {
      global.selectedLayerIds.clear();
      createdLayers.forEach(l => global.selectedLayerIds.add(l.id));
    }
    global.selectedLayerId = topLayer.id;

    createdLayers.forEach(l => {
      if (typeof global.invalidatePreviewCacheForLayer === 'function') global.invalidatePreviewCacheForLayer(l);
    });

    notifyProjectChange('applyPresetWarp1', 'Preset Warp1 applied');
    return JSON.stringify({ error: false, message: 'Preset Warp1 applied', layerIds: createdLayers.map(l => l.id) });
  }

  function applyPresetWarp2() {
    if (global.UndoRedoManager && typeof global.UndoRedoManager.recordSnapshot === 'function') {
      global.UndoRedoManager.recordSnapshot();
    }
    const fps = getProjectFps();
    const rawPlayheadSec = getPlayheadSec();
    const curFrame = Math.round(rawPlayheadSec * fps);
    const curSec = Number((curFrame / fps).toFixed(4));
    const selId = global.selectedLayerId;
    const createdLayers = [];

    // 1. Layer: Mid-Wave (145 frames)
    const midwavePreFrames = Math.round((20 / 60) * fps);
    const midwaveStartFrame = Math.max(0, curFrame - midwavePreFrames);
    const midwaveStart = Number((midwaveStartFrame / fps).toFixed(4));
    const midwaveDur = Number(((145 / 60) * (60 / fps)).toFixed(4));
    const mwT1 = midwaveStart;
    const mwT2 = Number((curSec + (2 / fps)).toFixed(4));
    const mwT3 = Number((midwaveStart + midwaveDur).toFixed(4));

    const adjMidwave = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(midwaveDur, midwaveStart) : null;
    if (!adjMidwave) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adjMidwave.name = 'Mid-Wave';
    adjMidwave.isDurationExplicit = true;
    adjMidwave.direction = 45;
    adjMidwave.waveHeight = 187;
    adjMidwave.waveWidth = 4000;
    adjMidwave.speed = 1.6;

    const mwWw1 = {
      id: uid('fx_wave_warp_1'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 187,
      waveWidth: 4000,
      direction: 45,
      speed: 1.5,
      phase: 0,
      tile: 1
    };
    const mwWw2 = {
      id: uid('fx_wave_warp_2'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 177,
      waveWidth: 4000,
      direction: -28,
      speed: 1.5,
      phase: -164,
      tile: 1
    };

    adjMidwave.effects = [mwWw1, mwWw2];
    adjMidwave.keyframes = {
      [`${mwWw1.id}:waveWidth`]: [],
      [`${mwWw1.id}:waveHeight`]: [
        { time: mwT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
        { time: mwT2, value: { waveHeight: 187 }, easing: [0.002, 1, 0.291, 1] },
        { time: mwT3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ],
      [`${mwWw2.id}:waveHeight`]: [
        { time: mwT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
        { time: mwT2, value: { waveHeight: 177 }, easing: [0.002, 1, 0.291, 1] },
        { time: mwT3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ]
    };
    adjMidwave.defaultEasing = {
      [`${mwWw1.id}:waveWidth`]: [0, 0, 1, 1],
      [`${mwWw1.id}:waveHeight`]: [0.002, 1, 0.224, 1],
      [`${mwWw2.id}:waveHeight`]: [0.002, 1, 0.138, 1]
    };
    adjMidwave._defaultEasing = adjMidwave.defaultEasing;
    createdLayers.push(adjMidwave);

    // 2. Layer: Warp Effect (63 frames)
    const warpPreFrames = Math.round((16 / 60) * fps);
    const warpStartFrame = Math.max(0, curFrame - warpPreFrames);
    const warpStart = Number((warpStartFrame / fps).toFixed(4));
    const warpDur = Number(((63 / 60) * (60 / fps)).toFixed(4));
    const warpT1 = warpStart;
    const warpT2 = curSec;
    const warpT3 = Number((warpStart + warpDur).toFixed(4));

    const adjWarp = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(warpDur, warpStart) : null;
    if (adjWarp) {
      adjWarp.name = 'Warp Effect';
      adjWarp.isDurationExplicit = true;
      adjWarp.sourceOffsetSec = 0.4667;
      adjWarp.waveHeight = 0;
      adjWarp.waveWidth = 10;
      adjWarp.speed = 10;
      adjWarp.phase = 273;

      const warpWw1 = {
        id: uid('fx_wave_warp_1'),
        type: 'wave-warp',
        name: 'Wave Warp',
        isExpanded: true,
        disabled: false,
        waveType: 'smooth-noise',
        waveHeight: 0,
        waveWidth: 10,
        direction: 90,
        speed: 10,
        phase: 273,
        tile: 1
      };
      const warpWw2 = {
        id: uid('fx_wave_warp_2'),
        type: 'wave-warp',
        name: 'Wave Warp',
        isExpanded: true,
        disabled: false,
        waveType: 'smooth-noise',
        waveHeight: 0,
        waveWidth: 10,
        direction: 90,
        speed: 10,
        phase: 273,
        tile: 1
      };

      adjWarp.effects = [warpWw1, warpWw2];
      const easeWarpOut = [0, 0, 0.2, 1];
      adjWarp.keyframes = {
        [`${warpWw1.id}:waveHeight`]: [
          { time: warpT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
          { time: warpT2, value: { waveHeight: 20 }, easing: [0, 1, 0, 1] },
          { time: warpT3, value: { waveHeight: 0 }, easing: [...easeWarpOut] }
        ],
        [`${warpWw1.id}:speed`]: [
          { time: warpT1, value: { speed: 10 }, easing: [0, 0, 1, 1] }
        ],
        [`${warpWw2.id}:waveHeight`]: [
          { time: warpT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
          { time: warpT2, value: { waveHeight: 20 }, easing: [0, 0, 0, 1] },
          { time: warpT3, value: { waveHeight: 0 }, easing: [...easeWarpOut] }
        ],
        [`${warpWw2.id}:speed`]: [
          { time: warpT1, value: { speed: 10 }, easing: [0, 0, 1, 1] }
        ]
      };
      adjWarp.defaultEasing = {
        [`${warpWw1.id}:waveHeight`]: [...easeWarpOut],
        [`${warpWw2.id}:waveHeight`]: [...easeWarpOut]
      };
      adjWarp._defaultEasing = adjWarp.defaultEasing;
      createdLayers.push(adjWarp);
    }

    // 3. Layer: Ghost Effect (125 frames)
    const ghostStart = curSec;
    const ghostDur = Number(((125 / 60) * (60 / fps)).toFixed(4));
    const ghT1 = curSec;
    const ghT2 = Number((curSec + ghostDur).toFixed(4));
    const ghOpT2 = Number((curSec + ((65 / 60) * (60 / fps))).toFixed(4));

    const adjGhost = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(ghostDur, ghostStart) : null;
    if (adjGhost) {
      adjGhost.name = 'Ghost Effect';
      adjGhost.isDurationExplicit = true;

      const transformFx = {
        id: uid('fx_transform'),
        type: 'transform',
        name: 'Transform',
        isExpanded: true,
        disabled: false,
        posX: 0,
        posY: 0,
        scale: 100,
        rotation: 0,
        skew: 0,
        anchorX: 0,
        anchorY: 0,
        opacity: 100
      };
      adjGhost.effects = [transformFx];

      const easeGhost = [0, 0, 0.2, 1];
      adjGhost.keyframes = {
        [`${transformFx.id}:scale`]: [
          { time: ghT1, value: { scale: 100 }, easing: [...easeGhost] },
          { time: ghT2, value: { scale: 220 }, easing: [...easeGhost] }
        ],
        [`${transformFx.id}:opacity`]: [],
        opacity: [
          { time: ghT1, value: { opacity: 1 }, easing: [...easeGhost] },
          { time: ghOpT2, value: { opacity: 0 }, easing: [...easeGhost] }
        ]
      };
      adjGhost.defaultEasing = {
        [`${transformFx.id}:scale`]: [...easeGhost],
        [`${transformFx.id}:opacity`]: [...easeGhost],
        opacity: [...easeGhost]
      };
      adjGhost._defaultEasing = adjGhost.defaultEasing;
      createdLayers.push(adjGhost);
    }

    // 4. Layer: Hue Spin (70 frames)
    const hueStart = curSec;
    const hueDur = Number(((70 / 60) * (60 / fps)).toFixed(4));
    const hueT1 = curSec;
    const hueT2 = Number((curSec + hueDur).toFixed(4));

    const adjHue = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(hueDur, hueStart) : null;
    if (adjHue) {
      adjHue.name = 'Hue Spin';
      adjHue.isDurationExplicit = true;

      const hueFx = {
        id: uid('fx_hue_shift'),
        type: 'hue-shift',
        name: 'Hue Shift',
        isExpanded: true,
        disabled: false,
        hue: 360
      };
      adjHue.effects = [hueFx];

      const hueEase = [0, 1, 0.58, 1];
      adjHue.keyframes = {
        [`${hueFx.id}:hue`]: [
          { time: hueT1, value: { hue: 0 }, easing: [...hueEase] },
          { time: hueT2, value: { hue: 360 }, easing: [...hueEase] }
        ]
      };
      adjHue.defaultEasing = { [`${hueFx.id}:hue`]: [0, 0, 1, 1] };
      adjHue._defaultEasing = adjHue.defaultEasing;
      createdLayers.push(adjHue);
    }

    const stackInOrder = [adjMidwave, adjWarp, adjGhost, adjHue].filter(Boolean);
    const layers = (global.currentProjectState && global.currentProjectState.layers) || [];

    const idsToRemove = new Set(createdLayers.map(l => l.id));
    for (let i = layers.length - 1; i >= 0; i--) {
      if (idsToRemove.has(layers[i].id)) layers.splice(i, 1);
    }

    if (selId) {
      const selIdx = layers.findIndex(l => l.id === selId);
      if (selIdx >= 0) layers.splice(selIdx, 0, ...stackInOrder);
      else layers.unshift(...stackInOrder);
    } else {
      layers.unshift(...stackInOrder);
    }

    const topLayer = stackInOrder[0];
    if (typeof global.selectTimelineLayer === 'function') global.selectTimelineLayer(topLayer.id, false);
    global.selectedLayerId = topLayer.id;

    createdLayers.forEach(l => {
      if (typeof global.invalidatePreviewCacheForLayer === 'function') global.invalidatePreviewCacheForLayer(l);
    });

    notifyProjectChange('applyPresetWarp2', 'Preset Warp2 applied');
    return JSON.stringify({ error: false, message: 'Preset Warp2 applied', layerIds: createdLayers.map(l => l.id) });
  }
  const applyPresetWarp3 = applyPresetWarp2;

  // =========================================================================
  // SINGLE BEAT ADJUSTMENT EFFECTS
  // =========================================================================
  function applyBeatGhostEffect() {
    const curSec = getPlayheadSec();
    const durationSec = 0.7714;
    const t1 = Number((curSec + 0.0598).toFixed(4));
    const t2 = Number((curSec + 0.7733).toFixed(4));
    const selId = global.selectedLayerId;

    const adj = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(durationSec, curSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Ghost Effect';
    adj.isDurationExplicit = true;

    const transformFx = {
      id: uid('fx_transform'),
      type: 'transform',
      name: 'Transform',
      isExpanded: true,
      disabled: false,
      posX: 0,
      posY: 0,
      scale: 100,
      rotation: 0,
      skew: 0,
      anchorX: 0,
      anchorY: 0,
      opacity: 100
    };
    adj.effects = [transformFx];

    const easeGhost = [0, 0, 0.2, 1];
    adj.keyframes = {
      [`${transformFx.id}:scale`]: [
        { time: t1, value: { scale: 100 }, easing: [...easeGhost] },
        { time: t2, value: { scale: 220 }, easing: [...easeGhost] }
      ],
      [`${transformFx.id}:opacity`]: [],
      opacity: [
        { time: t1, value: { opacity: 1 }, easing: [...easeGhost] },
        { time: t2, value: { opacity: 0 }, easing: [...easeGhost] }
      ]
    };
    adj.defaultEasing = {
      [`${transformFx.id}:scale`]: [...easeGhost],
      [`${transformFx.id}:opacity`]: [...easeGhost],
      opacity: [...easeGhost]
    };
    adj._defaultEasing = adj.defaultEasing;

    if (selId && selId !== adj.id) {
      const layers = (global.currentProjectState && global.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof global.selectTimelineLayer === 'function') global.selectTimelineLayer(adj.id, false);
    global.selectedLayerId = adj.id;
    notifyProjectChange('applyBeatGhostEffect', 'Ghost Effect applied', adj);
    return JSON.stringify({ error: false, message: 'Ghost Effect applied', layerId: adj.id });
  }

  function applyBeatWarpEffect(customFrames = 8) {
    const fps = getProjectFps();
    const curSec = getPlayheadSec();
    const frames = (typeof customFrames === 'number' && customFrames > 0) ? customFrames : 8;
    const durationSec = Number((frames / fps).toFixed(3));
    const selId = global.selectedLayerId;

    const adj = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(durationSec, curSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Warp Effect';

    const waveWarpFx = {
      id: uid('fx_wave_warp'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'smooth-noise',
      waveHeight: 19,
      waveWidth: 10,
      direction: 90,
      speed: 0,
      phase: 0,
      tile: 1
    };
    adj.effects = [waveWarpFx];

    const easeOut = [0.0, 0.0, 0.2, 1.0];
    const endTime = Number((curSec + durationSec).toFixed(3));

    adj.keyframes = {
      [`${waveWarpFx.id}:waveHeight`]: [
        { time: curSec, value: { waveHeight: 19 }, easing: [...easeOut] },
        { time: endTime, value: { waveHeight: 0 }, easing: [...easeOut] }
      ]
    };
    adj.defaultEasing = { [`${waveWarpFx.id}:waveHeight`]: [...easeOut] };
    adj._defaultEasing = adj.defaultEasing;

    if (selId && selId !== adj.id) {
      const layers = (global.currentProjectState && global.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof global.selectTimelineLayer === 'function') global.selectTimelineLayer(adj.id, false);
    global.selectedLayerId = adj.id;
    notifyProjectChange('applyBeatWarpEffect', 'Warp Effect applied', adj);
    return JSON.stringify({ error: false, message: 'Warp Effect applied', layerId: adj.id });
  }

  function applyBeatFisheyeEffect(scaleFactor = 2) {
    const fps = getProjectFps();
    const curSec = getPlayheadSec();
    const fd = 1 / fps;
    const sf = (typeof scaleFactor === 'number' && scaleFactor > 0) ? scaleFactor : 2;
    const rawOffsets = [-6, -2, 0, 6, 14, 22].map(v => Math.round(v * sf));
    const rawValues = [0, 15, -80, 15, -4, 0];

    const preFrames = Math.abs(rawOffsets[0]);
    const postFrames = rawOffsets[rawOffsets.length - 1] + 4;
    const totalFrames = preFrames + postFrames;

    const startSec = Math.max(0, Number((curSec - preFrames * fd).toFixed(3)));
    const durationSec = Number((totalFrames * fd).toFixed(3));
    const selId = global.selectedLayerId;

    const adj = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(durationSec, startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Fish Eye Ripple';

    const warpFx = {
      id: uid('fx_warp'),
      type: 'warp',
      name: 'Warp',
      isExpanded: true,
      disabled: false,
      warpStyle: 'fisheye',
      bend: -80,
      distortH: 0,
      distortV: 0
    };
    adj.effects = [warpFx];

    const easyEase = [0.33, 0.0, 0.67, 1.0];
    const kfList = [];
    for (let i = 0; i < rawOffsets.length; i++) {
      const t = Math.max(0, Number((curSec + rawOffsets[i] * fd).toFixed(3)));
      if (kfList.length > 0 && Math.abs(kfList[kfList.length - 1].time - t) < 0.001) continue;
      kfList.push({ time: t, value: { bend: rawValues[i] }, easing: [...easyEase] });
    }

    adj.keyframes = { [`${warpFx.id}:bend`]: kfList };
    adj.defaultEasing = { [`${warpFx.id}:bend`]: [...easyEase] };
    adj._defaultEasing = adj.defaultEasing;

    if (selId && selId !== adj.id) {
      const layers = (global.currentProjectState && global.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof global.selectTimelineLayer === 'function') global.selectTimelineLayer(adj.id, false);
    global.selectedLayerId = adj.id;
    notifyProjectChange('applyBeatFisheyeEffect', 'Fish Eye Ripple applied', adj);
    return JSON.stringify({ error: false, message: 'Fish Eye Ripple applied', layerId: adj.id });
  }

  function applyBeatMidwaveEffect() {
    const curSec = getPlayheadSec();
    const durationSec = 1.5914;
    const t1 = Number(curSec.toFixed(4));
    const t2 = Number((curSec + 0.3667).toFixed(4));
    const t3 = Number((curSec + 1.5914).toFixed(4));
    const selId = global.selectedLayerId;

    const adj = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(durationSec, curSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Mid-Wave';
    adj.isDurationExplicit = true;
    adj.direction = 45;
    adj.waveHeight = 85;
    adj.waveWidth = 1797;
    adj.speed = 1.6;

    const ww1 = {
      id: uid('fx_wave_warp_1'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 85,
      waveWidth: 1797,
      direction: 45,
      speed: 1.6,
      phase: 0,
      tile: 1
    };
    const ww2 = {
      id: uid('fx_wave_warp_2'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 85,
      waveWidth: 1797,
      direction: -216,
      speed: 1.6,
      phase: 0,
      tile: 1
    };

    adj.effects = [ww1, ww2];
    adj.keyframes = {
      [`${ww1.id}:waveWidth`]: [],
      [`${ww1.id}:waveHeight`]: [
        { time: t1, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] },
        { time: t2, value: { waveHeight: 85 }, easing: [0.002, 1, 0.224, 1] },
        { time: t3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ],
      [`${ww2.id}:waveHeight`]: [
        { time: t1, value: { waveHeight: 0 }, easing: [0.368, 0.37, 0.702, 0.682] },
        { time: t2, value: { waveHeight: 85 }, easing: [0.002, 1, 0.138, 1] },
        { time: t3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ]
    };
    adj.defaultEasing = {
      [`${ww1.id}:waveWidth`]: [0, 0, 1, 1],
      [`${ww1.id}:waveHeight`]: [0.002, 1, 0.224, 1],
      [`${ww2.id}:waveHeight`]: [0.002, 1, 0.138, 1]
    };
    adj._defaultEasing = adj.defaultEasing;

    if (selId && selId !== adj.id) {
      const layers = (global.currentProjectState && global.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof global.selectTimelineLayer === 'function') global.selectTimelineLayer(adj.id, false);
    global.selectedLayerId = adj.id;
    notifyProjectChange('applyBeatMidwaveEffect', 'Mid-Wave applied', adj);
    return JSON.stringify({ error: false, message: 'Mid-Wave applied', layerId: adj.id });
  }

  function applyBeatHuespinEffect() {
    const fps = getProjectFps();
    const curSec = getPlayheadSec();
    const fd = 1 / fps;
    const durationSec = Number((25 * fd).toFixed(3));
    const endSec = Number((curSec + durationSec).toFixed(3));
    const selId = global.selectedLayerId;

    const adj = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(durationSec, curSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Hue Spin';

    const hueFx = {
      id: uid('fx_hue_shift'),
      type: 'hue-shift',
      name: 'Hue Shift',
      isExpanded: true,
      disabled: false,
      hue: 0
    };
    adj.effects = [hueFx];

    const linearEase = [0.0, 0.0, 1.0, 1.0];
    adj.keyframes = {
      [`${hueFx.id}:hue`]: [
        { time: curSec, value: { hue: 0 }, easing: [...linearEase] },
        { time: endSec, value: { hue: 360 }, easing: [...linearEase] }
      ]
    };
    adj.defaultEasing = { [`${hueFx.id}:hue`]: [...linearEase] };
    adj._defaultEasing = adj.defaultEasing;

    if (selId && selId !== adj.id) {
      const layers = (global.currentProjectState && global.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof global.selectTimelineLayer === 'function') global.selectTimelineLayer(adj.id, false);
    global.selectedLayerId = adj.id;
    notifyProjectChange('applyBeatHuespinEffect', 'Hue Spin applied', adj);
    return JSON.stringify({ error: false, message: 'Hue Spin applied', layerId: adj.id });
  }

  function applyBeatFlashEffect() {
    const timing = getSelectedLayerTiming();
    const sel = getSelectedLayers();
    if (sel.length === 0) return JSON.stringify({ error: true, message: 'Please select a layer first' });
    const selLayer = sel[0];

    const adj = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(timing.durationSec, timing.startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Exposure Flash Beat';

    const expoFx = {
      id: uid('fx_exposure_gamma'),
      type: 'exposure-gamma',
      name: 'Exposure / Gamma',
      isExpanded: true,
      disabled: false,
      exposure: 0,
      gamma: 0,
      offset: 0
    };

    const ampSlider = createSlider('Amp', 0.5, 0, 5, 0.05, '');
    const decaySlider = createSlider('Decay', 18, 0.1, 100, 0.5, '');
    const attackSlider = createSlider('Attack', 0, 0, 100, 1, '');
    adj.effects = [expoFx, ampSlider, decaySlider, attackSlider];

    const flashExpr = [
      'amp = effect("Amp")("ADBE Slider Control-0001");',
      'decay = effect("Decay")("ADBE Slider Control-0001");',
      'attack = effect("Attack")("ADBE Slider Control-0001");',
      'm = (thisLayer.marker && thisLayer.marker.numKeys > 0) ? thisLayer.marker : ((index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker);',
      'res = value;',
      'if (time >= inPoint && time <= outPoint && m && m.numKeys > 0) {',
      '    n = 0;',
      '    if (m.numKeys > 0) {',
      '        n = m.nearestKey(time).index;',
      '        if (m.key(n).time > time) n--;',
      '    }',
      '    if (n > 0) {',
      '        markerTime = m.key(n).time;',
      '        if (markerTime >= inPoint && markerTime <= outPoint) {',
      '            t = time - markerTime;',
      '            if (t >= 0 && t <= 0.5) {',
      '                env = (attack > 0) ? (1 - Math.exp(-t * attack)) : 1;',
      '                res = value + (amp * env) / Math.exp(t * decay);',
      '            }',
      '        }',
      '    }',
      '}',
      'res;'
    ].join('\n');

    adj.expressions = {
      [`${expoFx.id}:exposure`]: flashExpr,
      'exposure': flashExpr
    };

    if (selLayer && selLayer.id !== adj.id) {
      const layers = (global.currentProjectState && global.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selLayer.id);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selLayer.id);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof global.selectTimelineLayer === 'function') global.selectTimelineLayer(adj.id, false);
    global.selectedLayerId = adj.id;
    notifyProjectChange('applyBeatFlashEffect', 'Exposure Flash Beat applied', adj);
    return JSON.stringify({ error: false, message: 'Exposure Flash Beat applied', layerId: adj.id });
  }

  function applyBeatBlurEffect(isRightClick = false) {
    const isLensBlur = (isRightClick === true);
    const timing = getSelectedLayerTiming();
    const sel = getSelectedLayers();
    if (sel.length === 0) return JSON.stringify({ error: true, message: 'Please select a layer first' });
    const selLayer = sel[0];

    const adj = (typeof global.addAdjustmentLayer === 'function') ? global.addAdjustmentLayer(timing.durationSec, timing.startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = isLensBlur ? 'Lens Blur Beat' : 'Fast Box Blur Beat';

    let blurFx = null;
    const maxBlur = isLensBlur ? 5 : 10;
    if (isLensBlur) {
      blurFx = {
        id: uid('fx_camera_lens_blur'),
        type: 'camera-lens-blur',
        name: 'Camera Lens Blur',
        isExpanded: true,
        disabled: false,
        radius: 0,
        aspectRatio: 100,
        bloom: 0
      };
    } else {
      blurFx = {
        id: uid('fx_fast_box_blur'),
        type: 'fast-box-blur',
        name: 'Fast Box Blur',
        isExpanded: true,
        disabled: false,
        radius: 0,
        iterations: 1
      };
    }

    const ampSlider = createSlider('Amp', maxBlur, 0, 100, 1, ' px');
    const decaySlider = createSlider('Decay', 16, 0.1, 100, 0.5, '');
    const attackSlider = createSlider('Attack', 0, 0, 100, 1, '');
    adj.effects = [blurFx, ampSlider, decaySlider, attackSlider];

    const blurExpr = [
      'amp = effect("Amp")("ADBE Slider Control-0001");',
      'decay = effect("Decay")("ADBE Slider Control-0001");',
      'attack = effect("Attack")("ADBE Slider Control-0001");',
      'm = (thisLayer.marker && thisLayer.marker.numKeys > 0) ? thisLayer.marker : ((index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker);',
      'res = value;',
      'if (time >= inPoint && time <= outPoint && m && m.numKeys > 0) {',
      '    n = 0;',
      '    if (m.numKeys > 0) {',
      '        n = m.nearestKey(time).index;',
      '        if (m.key(n).time > time) n--;',
      '    }',
      '    if (n > 0) {',
      '        markerTime = m.key(n).time;',
      '        if (markerTime >= inPoint && markerTime <= outPoint) {',
      '            t = time - markerTime;',
      '            if (t >= 0 && t <= 0.5) {',
      '                env = (attack > 0) ? (1 - Math.exp(-t * attack)) : 1;',
      '                res = value + (amp * env) / Math.exp(t * decay);',
      '            }',
      '        }',
      '    }',
      '}',
      'res;'
    ].join('\n');

    adj.expressions = {
      [`${blurFx.id}:radius`]: blurExpr,
      'radius': blurExpr
    };

    if (selLayer && selLayer.id !== adj.id) {
      const layers = (global.currentProjectState && global.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selLayer.id);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selLayer.id);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof global.selectTimelineLayer === 'function') global.selectTimelineLayer(adj.id, false);
    global.selectedLayerId = adj.id;
    const label = isLensBlur ? 'Lens Blur Beat' : 'Fast Box Blur Beat';
    notifyProjectChange('applyBeatBlurEffect', `${label} applied`, adj);
    return JSON.stringify({ error: false, message: `${label} applied`, layerId: adj.id });
  }

  // =========================================================================
  // NULL LAYER RIGS & MATHEMATICAL EXPRESSIONS (OPENFISHTOOLS CEP COMPLIANT)
  // =========================================================================
  function applyBeatNullTool(toolName) {
    const layers = (global.currentProjectState && global.currentProjectState.layers) || [];
    const sel = getSelectedLayers();
    if (sel.length === 0) {
      const msg = 'Please select a layer first.';
      if (typeof global.showEffectsRackToast === 'function') global.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: toolName, type: 'warn', message: msg });
    }
    const targetLayer = sel[0];
    const timing = getSelectedLayerTiming();
    const pps = getPixelsPerSecond();

    let nullName = 'Null';
    if (toolName === 'OSCILLATE') nullName = 'OSCILLATE';
    else if (toolName === 'SHAKY') nullName = 'SHAKY';
    else if (toolName === 'Y_BEAT') nullName = 'Y BEAT';
    else if (toolName === 'Y_FLIP') nullName = 'Y FLIP';
    else if (toolName === 'X_BEAT') nullName = 'X BEAT';
    else if (toolName === 'X_FLIP') nullName = 'X FLIP';
    else if (toolName === 'SCALE_BEAT') nullName = 'SCALE BEAT';
    else if (toolName === 'SCALE_OVERLAP') nullName = 'SCALE OVER';
    else if (toolName === 'SWING') nullName = 'Swing_Null';
    else if (toolName === 'PANNING_POS') nullName = 'PANNING Position';
    else if (toolName === 'PANNING_ROT') nullName = 'PANNING Rotation';
    else if (toolName === 'PANNING_SCALE') nullName = 'PANNING Scale';
    else if (toolName === 'PANNING_MIX_PR') nullName = 'PANNING Mix PR';
    else if (toolName === 'PANNING_MIX_ALL' || toolName === 'PANNING') nullName = 'PANNING Mix All';

    // Gather timeline beatmarks
    let rawMarkers = [];
    if (Array.isArray(targetLayer.markers) && targetLayer.markers.length > 0) {
      rawMarkers = rawMarkers.concat(targetLayer.markers.map(m => (typeof m === 'number' ? m : (m.time || 0))));
    }
    const pState = global.currentProjectState;
    if (pState && Array.isArray(pState.beatmarks) && pState.beatmarks.length > 0) {
      rawMarkers = rawMarkers.concat(pState.beatmarks);
    }
    if (Array.isArray(global.beatmarks) && global.beatmarks.length > 0) {
      rawMarkers = rawMarkers.concat(global.beatmarks);
    }
    const allMarkers = Array.from(new Set(rawMarkers.map(m => Number(m.toFixed(4))))).sort((a, b) => a - b);
    const isPanning = toolName.indexOf('PANNING') === 0;

    // Auto-create initial beatmark at playhead or layer start if none exist so expressions activate immediately
    const curSec = getPlayheadSec();
    if (!isPanning && allMarkers.length === 0) {
      const markTime = Number((curSec >= timing.startSec && curSec <= timing.startSec + timing.durationSec ? curSec : timing.startSec).toFixed(4));
      if (pState) {
        if (!Array.isArray(pState.beatmarks)) pState.beatmarks = [];
        pState.beatmarks.push(markTime);
      }
      if (!Array.isArray(targetLayer.markers)) targetLayer.markers = [];
      targetLayer.markers.push(markTime);
      if (typeof global.renderBeatmarks === 'function') global.renderBeatmarks();
      if (typeof global.syncBeatmarkDrawerUI === 'function') global.syncBeatmarkDrawerUI();
    }

    const nullLayer = {
      id: uid('layer_null'),
      name: nullName,
      type: 'null',
      startPx: Math.round(timing.startSec * pps),
      startSec: timing.startSec,
      durationSec: timing.durationSec,
      widthPx: Math.max(40, Math.round(timing.durationSec * pps)),
      posX: targetLayer.posX || 960,
      posY: targetLayer.posY || 540,
      posZ: 0,
      rotZ: 0,
      rotation: 0,
      scaleW: 100,
      scaleH: 100,
      keyframes: {},
      expressions: {},
      effects: [],
      defaultEasing: {}
    };

    const neutralBind = {
      parentPosX: targetLayer.posX || 960,
      parentPosY: targetLayer.posY || 540,
      parentPosZ: 0,
      parentRotX: 0,
      parentRotY: 0,
      parentRotZ: 0,
      parentScaleW: 100,
      parentScaleH: 100
    };

    let topOfChain = targetLayer;
    while (topOfChain.parentId) {
      const p = layers.find(l => l.id === topOfChain.parentId);
      if (!p) break;
      topOfChain = p;
    }

    if (topOfChain.id !== targetLayer.id) {
      nullLayer.parentId = topOfChain.parentId || null;
      nullLayer.parentBind = topOfChain.parentBind ? Object.assign({}, topOfChain.parentBind) : null;
      topOfChain.parentId = nullLayer.id;
      topOfChain.parentBind = Object.assign({}, neutralBind);

      const topIdx = layers.findIndex(l => l.id === topOfChain.id);
      if (topIdx >= 0) layers.splice(topIdx, 0, nullLayer);
      else layers.push(nullLayer);
    } else {
      const targetIdx = layers.findIndex(l => l.id === targetLayer.id);
      if (targetIdx >= 0) layers.splice(targetIdx, 0, nullLayer);
      else layers.push(nullLayer);
      targetLayer.parentId = nullLayer.id;
      targetLayer.parentBind = Object.assign({}, neutralBind);
    }

    // Attach authentic After Effects Expressions
    if (toolName === 'Y_BEAT') {
      nullLayer.effects.push(createSlider('Amp', 500, -2000, 2000, 10, ' px'));
      nullLayer.effects.push(createSlider('Decay', 20, 1, 100, 1, ''));
      const expr = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){ value; }else{',
        '    n = m.nearestKey(time).index;',
        '    if (m.key(n).time > time) { t2 = m.key(n).time; t1 = (n > 1) ? m.key(n-1).time : -99999; }',
        '    else { t1 = m.key(n).time; t2 = (n < m.numKeys) ? m.key(n+1).time : 99999; }',
        '    val1 = (t1 >= inPoint && t1 <= outPoint) ? (amp / Math.exp((time - t1) * decay)) : 0;',
        '    val2 = (t2 >= inPoint && t2 <= outPoint) ? (amp / Math.exp((t2 - time) * decay)) : 0;',
        '    val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '    value + [0, val];',
        '}'
      ].join('\n');
      nullLayer.expressions.move = expr;
      nullLayer.expressions.position = expr;
    } else if (toolName === 'X_BEAT') {
      nullLayer.effects.push(createSlider('Amp', 500, -2000, 2000, 10, ' px'));
      nullLayer.effects.push(createSlider('Decay', 20, 1, 100, 1, ''));
      const expr = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){ value; }else{',
        '    n = m.nearestKey(time).index;',
        '    if (m.key(n).time > time) { t2 = m.key(n).time; t1 = (n > 1) ? m.key(n-1).time : -99999; }',
        '    else { t1 = m.key(n).time; t2 = (n < m.numKeys) ? m.key(n+1).time : 99999; }',
        '    val1 = (t1 >= inPoint && t1 <= outPoint) ? (amp / Math.exp((time - t1) * decay)) : 0;',
        '    val2 = (t2 >= inPoint && t2 <= outPoint) ? (amp / Math.exp((t2 - time) * decay)) : 0;',
        '    val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '    value + [val, 0];',
        '}'
      ].join('\n');
      nullLayer.expressions.move = expr;
      nullLayer.expressions.position = expr;
    } else if (toolName === 'Y_FLIP') {
      nullLayer.effects.push(createSlider('Amp', 500, -2000, 2000, 10, ' px'));
      nullLayer.effects.push(createSlider('Decay', 15, 1, 100, 1, ''));
      const moveExpr = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){ value; }else{',
        '    validKeys = [];',
        '    for (i = 1; i <= m.numKeys; i++){ kt = m.key(i).time; if (kt >= inPoint && kt <= outPoint) validKeys.push(i); }',
        '    if (validKeys.length === 0){ value; }else{',
        '        activeIdx = -1;',
        '        for (k = 0; k < validKeys.length; k++){ if (m.key(validKeys[k]).time <= time) activeIdx = k; else break; }',
        '        if (activeIdx === -1){',
        '            tNext = m.key(validKeys[0]).time;',
        '            val = amp / Math.exp((tNext - time) * decay);',
        '            value + [0, val];',
        '        }else{',
        '            t1 = m.key(validKeys[activeIdx]).time;',
        '            hasNext = (activeIdx + 1 < validKeys.length);',
        '            t2 = hasNext ? m.key(validKeys[activeIdx + 1]).time : (outPoint + 9999);',
        '            dir = (activeIdx % 2 === 0) ? -1 : 1;',
        '            val1 = dir * amp / Math.exp((time - t1) * decay);',
        '            val2 = hasNext ? (dir * amp / Math.exp((t2 - time) * decay)) : 0;',
        '            val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '            value + [0, val];',
        '        }',
        '    }',
        '}'
      ].join('\n');
      const scaleExpr = [
        'if (time < inPoint || time > outPoint){ value; }else{',
        '    m = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '    if (!m || m.numKeys === 0){ value; }else{',
        '        validKeys = [];',
        '        for (i = 1; i <= m.numKeys; i++){ kt = m.key(i).time; if (kt >= inPoint && kt <= outPoint) validKeys.push(i); }',
        '        if (validKeys.length === 0){ value; }else{',
        '            activeIdx = -1;',
        '            for (k = 0; k < validKeys.length; k++){ if (m.key(validKeys[k]).time <= time) activeIdx = k; else break; }',
        '            if (activeIdx === -1){ value; }else{',
        '                sY = (activeIdx % 2 === 0) ? -100 : 100;',
        '                [value[0], sY];',
        '            }',
        '        }',
        '    }',
        '}'
      ].join('\n');
      nullLayer.expressions.move = moveExpr;
      nullLayer.expressions.position = moveExpr;
      nullLayer.expressions.scale = scaleExpr;
    } else if (toolName === 'X_FLIP') {
      nullLayer.effects.push(createSlider('Amp', 500, -2000, 2000, 10, ' px'));
      nullLayer.effects.push(createSlider('Decay', 15, 1, 100, 1, ''));
      const moveExpr = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){ value; }else{',
        '    validKeys = [];',
        '    for (i = 1; i <= m.numKeys; i++){ kt = m.key(i).time; if (kt >= inPoint && kt <= outPoint) validKeys.push(i); }',
        '    if (validKeys.length === 0){ value; }else{',
        '        activeIdx = -1;',
        '        for (k = 0; k < validKeys.length; k++){ if (m.key(validKeys[k]).time <= time) activeIdx = k; else break; }',
        '        if (activeIdx === -1){',
        '            tNext = m.key(validKeys[0]).time;',
        '            val = amp / Math.exp((tNext - time) * decay);',
        '            value + [val, 0];',
        '        }else{',
        '            t1 = m.key(validKeys[activeIdx]).time;',
        '            hasNext = (activeIdx + 1 < validKeys.length);',
        '            t2 = hasNext ? m.key(validKeys[activeIdx + 1]).time : (outPoint + 9999);',
        '            dir = (activeIdx % 2 === 0) ? -1 : 1;',
        '            val1 = dir * amp / Math.exp((time - t1) * decay);',
        '            val2 = hasNext ? (dir * amp / Math.exp((t2 - time) * decay)) : 0;',
        '            val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '            value + [val, 0];',
        '        }',
        '    }',
        '}'
      ].join('\n');
      const scaleExpr = [
        'if (time < inPoint || time > outPoint){ value; }else{',
        '    m = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '    if (!m || m.numKeys === 0){ value; }else{',
        '        validKeys = [];',
        '        for (i = 1; i <= m.numKeys; i++){ kt = m.key(i).time; if (kt >= inPoint && kt <= outPoint) validKeys.push(i); }',
        '        if (validKeys.length === 0){ value; }else{',
        '            activeIdx = -1;',
        '            for (k = 0; k < validKeys.length; k++){ if (m.key(validKeys[k]).time <= time) activeIdx = k; else break; }',
        '            if (activeIdx === -1){ value; }else{',
        '                sX = (activeIdx % 2 === 0) ? -100 : 100;',
        '                [sX, value[1]];',
        '            }',
        '        }',
        '    }',
        '}'
      ].join('\n');
      nullLayer.expressions.move = moveExpr;
      nullLayer.expressions.position = moveExpr;
      nullLayer.expressions.scale = scaleExpr;
    } else if (toolName === 'SHAKY') {
      nullLayer.effects.push(createSlider('Freq', 5, 0.1, 20, 0.1, ' Hz'));
      nullLayer.effects.push(createSlider('X Amp', 50, 0, 500, 1, ' px'));
      nullLayer.effects.push(createSlider('Y Amp', 50, 0, 500, 1, ' px'));
      nullLayer.effects.push(createSlider('Rot Amp', 15, 0, 180, 1, ' deg'));
      nullLayer.effects.push(createSlider('Decay', 3.0, 0, 20, 0.1, ''));
      nullLayer.effects.push(createSlider('Attack', 40, 0, 100, 1, ''));
      const shakeBase = [
        'freq = effect("Freq")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'attack = effect("Attack")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){ value; }else{',
        '    n = 0; if (m.numKeys > 0){ n = m.nearestKey(time).index; if (m.key(n).time > time) n--; }',
        '    if (n > 0){',
        '        markerTime = m.key(n).time;',
        '        if (markerTime >= inPoint && markerTime <= outPoint){',
        '            t = time - markerTime; env = (attack > 0) ? (1 - Math.exp(-t * attack)) : 1; mult = env / Math.exp(t * decay);'
      ];
      const moveExpr = [
        ...shakeBase,
        '            ampX = effect("X Amp")("ADBE Slider Control-0001"); ampY = effect("Y Amp")("ADBE Slider Control-0001");',
        '            wg = wiggle(freq, 1); value + [(wg[0]-value[0])*ampX*mult, (wg[1]-value[1])*ampY*mult];',
        '        }else{ value; } }else{ value; } }'
      ].join('\n');
      const rotExpr = [
        ...shakeBase,
        '            ampRot = effect("Rot Amp")("ADBE Slider Control-0001");',
        '            wg = wiggle(freq, 1); value + (wg-value)*ampRot*mult;',
        '        }else{ value; } }else{ value; } }'
      ].join('\n');
      nullLayer.expressions.move = moveExpr;
      nullLayer.expressions.position = moveExpr;
      nullLayer.expressions.rotate = rotExpr;
      nullLayer.expressions.rotation = rotExpr;
      nullLayer.expressions.rotZ = rotExpr;
    } else if (toolName === 'OSCILLATE') {
      nullLayer.effects.push(createSlider('Freq', 3, 0.1, 20, 0.1, ' Hz'));
      nullLayer.effects.push(createSlider('Amp', 30, 0, 500, 1, ' px'));
      nullLayer.effects.push(createSlider('Decay', 2.7, 0, 20, 0.1, ''));
      nullLayer.effects.push(createSlider('Attack', 40, 0, 100, 1, ''));
      const expr = [
        'freq = effect("Freq")("ADBE Slider Control-0001"); amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001"); attack = effect("Attack")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){ value; }else{',
        '    n = 0; if (m.numKeys > 0){ n = m.nearestKey(time).index; if (m.key(n).time > time) n--; }',
        '    if (n > 0){ markerTime = m.key(n).time; if (markerTime >= inPoint && markerTime <= outPoint){',
        '        t = time - markerTime; env = (attack > 0) ? (1 - Math.exp(-t * attack)) : 1;',
        '        currAmp = amp * env / Math.exp(t * decay);',
        '        value + [Math.sin(t * freq * Math.PI * 2) * currAmp, (1 - Math.cos(t * freq * Math.PI * 2)) * currAmp];',
        '    }else{ value; } }else{ value; } }'
      ].join('\n');
      nullLayer.expressions.move = expr;
      nullLayer.expressions.position = expr;
    } else if (toolName === 'SWING') {
      nullLayer.effects.push(createSlider('Freq', 1, 0.1, 20, 0.1, ' Hz'));
      nullLayer.effects.push(createSlider('Amp', 4, 0, 180, 0.5, '°'));
      nullLayer.effects.push(createSlider('Decay', 1.5, 0, 20, 0.1, ''));
      const expr = [
        'freq = effect("Freq")("ADBE Slider Control-0001"); amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){ value; }else{',
        '    n = 0; if (m.numKeys > 0){ n = m.nearestKey(time).index; if (m.key(n).time > time) n--; }',
        '    if (n > 0){ markerTime = m.key(n).time; if (markerTime >= inPoint && markerTime <= outPoint){',
        '        t = time - markerTime;',
        '        r = amp * Math.sin(t * freq * Math.PI * 2) / Math.exp(t * decay);',
        '        value + r;',
        '    }else{ value; } }else{ value; } }'
      ].join('\n');
      nullLayer.expressions.rotate = expr;
      nullLayer.expressions.rotation = expr;
      nullLayer.expressions.rotZ = expr;
    } else if (toolName === 'SCALE_BEAT') {
      nullLayer.effects.push(createSlider('Amp', 500, 0, 2000, 10, '%'));
      nullLayer.effects.push(createSlider('Decay', 20, 1, 100, 1, ''));
      nullLayer.expressions.scale = [
        'amp = effect("Amp")("ADBE Slider Control-0001"); decay = effect("Decay")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){ value; }else{',
        '    n = m.nearestKey(time).index; if (m.key(n).time > time) { t2 = m.key(n).time; t1 = (n > 1) ? m.key(n-1).time : -99999; }',
        '    else { t1 = m.key(n).time; t2 = (n < m.numKeys) ? m.key(n+1).time : 99999; }',
        '    val1 = (t1 >= inPoint && t1 <= outPoint) ? (amp / Math.exp((time - t1) * decay)) : 0;',
        '    val2 = (t2 >= inPoint && t2 <= outPoint) ? (amp / Math.exp((t2 - time) * decay)) : 0;',
        '    val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2; value + [val, val];',
        '}'
      ].join('\n');
    } else if (toolName === 'SCALE_OVERLAP') {
      nullLayer.effects.push(createSlider('Scale In', 0, -200, 500, 1, '%'));
      nullLayer.effects.push(createSlider('Scale Out', 20, -200, 500, 1, '%'));
      nullLayer.effects.push(createSlider('Overshoot', 20, 0, 100, 1, '%'));
      nullLayer.expressions.scale = [
        'function bezier(x1, y1, x2, y2, t) {',
        '    if (t <= 0) return 0; if (t >= 1) return 1; var p = t;',
        '    for (var i = 0; i < 8; i++) {',
        '        var omP = 1 - p; var f = 3 * omP * omP * p * x1 + 3 * omP * p * p * x2 + p * p * p - t;',
        '        var df = 3 * omP * omP * x1 + 6 * omP * p * (x2 - x1) + 3 * p * p * (1 - x2);',
        '        if (Math.abs(df) < 1e-6) break; p -= f / df; p = Math.max(0, Math.min(1, p));',
        '    }',
        '    var omP = 1 - p; return 3 * omP * omP * p * y1 + 3 * omP * p * p * y2 + p * p * p;',
        '}',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'scaleIn = effect("Scale In")("ADBE Slider Control-0001"); scaleOut = effect("Scale Out")("ADBE Slider Control-0001"); overshoot = effect("Overshoot")("ADBE Slider Control-0001");',
        'if (time < inPoint || time > outPoint){ value; }else if (m && m.numKeys > 0){',
        '    n = 0; if (m.numKeys > 0){ n = m.nearestKey(time).index; if (m.key(n).time > time) n--; }',
        '    if (n > 0 && n < m.numKeys){',
        '        t1 = m.key(n).time; t2 = m.key(n+1).time; dur = t2 - t1;',
        '        startVal = (n % 2 !== 0) ? scaleIn : scaleOut; endVal = (n % 2 !== 0) ? scaleOut : scaleIn;',
        '        t = time - t1; progress = Math.max(0, Math.min(1, t / dur)); yMult = overshoot / 20;',
        '        eased = bezier(0.4, -0.5 * yMult, 0.8, -0.5 * yMult, progress); val = startVal + (endVal - startVal) * eased; value + [val, val];',
        '    }else if (n >= m.numKeys){ finalVal = (m.numKeys % 2 !== 0) ? scaleOut : scaleIn; value + [finalVal, finalVal]; }else{ value + [scaleIn, scaleIn]; }',
        '}else{ value; }'
      ].join('\n');
    } else if (isPanning) {
      const isPos = (toolName === 'PANNING_POS' || toolName === 'PANNING_MIX_PR' || toolName === 'PANNING_MIX_ALL' || toolName === 'PANNING');
      const isRot = (toolName === 'PANNING_ROT' || toolName === 'PANNING_MIX_PR' || toolName === 'PANNING_MIX_ALL' || toolName === 'PANNING');
      const isScale = (toolName === 'PANNING_SCALE' || toolName === 'PANNING_MIX_ALL' || toolName === 'PANNING');
      const isMixPR = (toolName === 'PANNING_MIX_PR');
      const defaultFreq = isMixPR ? 7 : 1.5;
      const defaultPos = isMixPR ? 10 : 30;
      const defaultRot = isMixPR ? 1 : 5;
      const defaultScale = 10;

      nullLayer.effects.push(createSlider('Freq', defaultFreq, 0.1, 30, 0.1, ' Hz'));
      if (isPos) {
        nullLayer.effects.push(createSlider('Position', defaultPos, 0, 500, 1, ' px'));
        const posExpr = [
          'freq = effect("Freq")("ADBE Slider Control-0001"); posAmp = effect("Position")("ADBE Slider Control-0001");',
          'if (time < inPoint || time > outPoint){ value; }else{',
          '    t = time * freq; x = (Math.sin(t * 1.2) * 0.7 + Math.sin(t * 2.3) * 0.3) * posAmp; y = (Math.cos(t * 0.9) * 0.7 + Math.sin(t * 1.7) * 0.3) * posAmp;',
          '    value + [x, y];',
          '}'
        ].join('\n');
        nullLayer.expressions.move = posExpr;
        nullLayer.expressions.position = posExpr;
      }
      if (isRot) {
        nullLayer.effects.push(createSlider('Rotation', defaultRot, 0, 180, 0.5, '°'));
        const rotExpr = [
          'freq = effect("Freq")("ADBE Slider Control-0001"); rotAmp = effect("Rotation")("ADBE Slider Control-0001");',
          'if (time < inPoint || time > outPoint){ value; }else{',
          '    t = time * freq; r = (Math.sin(t * 0.8 + 1.5) * 0.7 + Math.cos(t * 1.5) * 0.3) * rotAmp;',
          '    value + r;',
          '}'
        ].join('\n');
        nullLayer.expressions.rotate = rotExpr;
        nullLayer.expressions.rotation = rotExpr;
        nullLayer.expressions.rotZ = rotExpr;
      }
      if (isScale) {
        nullLayer.effects.push(createSlider('Scale', defaultScale, 0, 200, 1, '%'));
        nullLayer.expressions.scale = [
          'freq = effect("Freq")("ADBE Slider Control-0001"); scaleAmp = effect("Scale")("ADBE Slider Control-0001");',
          'if (time < inPoint || time > outPoint){ value; }else{',
          '    t = time * freq; s = (Math.sin(t * 1.1) * 0.7 + Math.cos(t * 2.1) * 0.3) * scaleAmp;',
          '    value + [s, s];',
          '}'
        ].join('\n');
      }
    }

    if (typeof global.selectTimelineLayer === 'function') global.selectTimelineLayer(nullLayer.id, false);
    global.selectedLayerId = nullLayer.id;
    notifyProjectChange('applyBeatNullTool', `${nullName} applied`, [nullLayer, targetLayer]);
    return JSON.stringify({ error: false, message: `${nullName} applied`, nullLayerId: nullLayer.id, targetLayerId: targetLayer.id });
  }

  // =========================================================================
  // VELOCITY & TIME REMAPPING ENGINE
  // =========================================================================
  function getActiveBeatMarkers(layer, clipStart, clipEnd) {
    let markers = [];
    if (layer && Array.isArray(layer.markers) && layer.markers.length > 0) {
      markers = layer.markers.map(m => (typeof m === 'number' ? m : (m.time || 0)));
    }
    const pState = global.currentProjectState;
    if (pState && Array.isArray(pState.beatmarks) && pState.beatmarks.length > 0) {
      const inRange = pState.beatmarks.filter(b => b >= clipStart - 0.02 && b <= clipEnd + 0.02);
      markers = markers.concat(inRange);
    }

    let unique = Array.from(new Set(markers.map(m => Number(m.toFixed(3))))).sort((a, b) => a - b);
    unique = unique.filter(t => t >= clipStart - 0.02 && t <= clipEnd + 0.02);

    if (unique.length < 2) {
      unique = [];
      const step = 0.6;
      for (let t = clipStart; t <= clipEnd - 0.05; t += step) {
        unique.push(Number(t.toFixed(3)));
      }
      if (unique.length < 2) {
        unique = [Number(clipStart.toFixed(3)), Number(((clipStart + clipEnd) / 2).toFixed(3)), Number(clipEnd.toFixed(3))];
      }
    }
    return unique;
  }

  function applyTwixtorVelocity() {
    const selected = getSelectedLayers();
    if (selected.length === 0) {
      notifyProjectChange('velocity_twixtor_fail', 'Please select at least one layer to apply Twixtor velocity.');
      return JSON.stringify({ error: true, tool: 'Twixtor', type: 'warn', message: 'Please select at least one layer to apply Twixtor velocity.' });
    }

    if (global.UndoRedoManager && typeof global.UndoRedoManager.recordSnapshot === 'function') {
      global.UndoRedoManager.recordSnapshot();
    }

    const pps = getPixelsPerSecond();
    selected.forEach(layer => {
      layer.speedMode = 'speed';
      layer.speedInterpolation = 'optical_flow';
      layer.speed = 1.0;

      const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
      const clipEnd = clipStart + clipDur;
      const markers = getActiveBeatMarkers(layer, clipStart, clipEnd);

      if (!layer.keyframes) layer.keyframes = {};
      const kfs = [];

      if (markers[0] > clipStart + 0.05) {
        kfs.push({
          time: Number(clipStart.toFixed(3)),
          value: { speed: 1.0 },
          easing: [0.42, 0.0, 0.58, 1.0]
        });
      }

      for (let i = 0; i < markers.length; i++) {
        const t = markers[i];
        kfs.push({
          time: Number(t.toFixed(3)),
          value: { speed: 1.0 },
          easing: [0.42, 0.0, 0.58, 1.0]
        });
        if (i < markers.length - 1) {
          const nextT = markers[i + 1];
          const midT = (t + nextT) / 2;
          kfs.push({
            time: Number(midT.toFixed(3)),
            value: { speed: 0.2 },
            easing: [0.42, 0.0, 0.58, 1.0]
          });
        }
      }

      if (markers[markers.length - 1] < clipEnd - 0.05) {
        kfs.push({
          time: Number(clipEnd.toFixed(3)),
          value: { speed: 1.0 },
          easing: [0.42, 0.0, 0.58, 1.0]
        });
      }

      kfs.sort((a, b) => a.time - b.time);
      layer.keyframes.speed = kfs;

      if (typeof global.invalidatePreviewCacheForLayer === 'function') {
        global.invalidatePreviewCacheForLayer(layer);
      }
    });

    global.activeKeyframeProperty = 'speed';
    if (typeof global.syncSpeedControllerValues === 'function') global.syncSpeedControllerValues();
    if (typeof global.updateSpeedKeyframeBtnState === 'function') global.updateSpeedKeyframeBtnState();
    if (typeof global.updateTimelineKeyframeMarkersHighlight === 'function') global.updateTimelineKeyframeMarkersHighlight();
    if (typeof global.updateAllGraphBtnStates === 'function') global.updateAllGraphBtnStates();
    notifyProjectChange('velocity_twixtor', `Twixtor Velocity Applied (${selected.length} layer${selected.length > 1 ? 's' : ''})`);
    return JSON.stringify({ error: false, message: 'Twixtor velocity applied' });
  }

  function applyTimeRemapVelocity() {
    const selected = getSelectedLayers();
    if (selected.length === 0) {
      notifyProjectChange('velocity_timeremap_fail', 'Please select at least one layer to apply Time Remap velocity.');
      return JSON.stringify({ error: true, tool: 'Time Remap', type: 'warn', message: 'Please select at least one layer to apply Time Remap velocity.' });
    }

    if (global.UndoRedoManager && typeof global.UndoRedoManager.recordSnapshot === 'function') {
      global.UndoRedoManager.recordSnapshot();
    }

    const pps = getPixelsPerSecond();
    selected.forEach(layer => {
      layer.speedMode = 'time_remap';
      layer.speedInterpolation = 'optical_flow';

      const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
      const clipEnd = clipStart + clipDur;
      const srcOffset = layer.sourceOffsetSec || 0;
      const markers = getActiveBeatMarkers(layer, clipStart, clipEnd);

      if (!layer.keyframes) layer.keyframes = {};
      const kfs = [];

      const S_CURVE_EASE = [0.20, 0.70, 0.80, 0.30];

      if (markers[0] > clipStart + 0.05) {
        kfs.push({
          time: Number(clipStart.toFixed(3)),
          value: { timeRemap: Number(srcOffset.toFixed(3)) },
          easing: [...S_CURVE_EASE]
        });
      }

      for (let i = 0; i < markers.length; i++) {
        const t = markers[i];
        const sourceTime = srcOffset + (t - clipStart);
        kfs.push({
          time: Number(t.toFixed(3)),
          value: { timeRemap: Number(sourceTime.toFixed(3)) },
          easing: [...S_CURVE_EASE]
        });
      }

      if (markers[markers.length - 1] < clipEnd - 0.05) {
        kfs.push({
          time: Number(clipEnd.toFixed(3)),
          value: { timeRemap: Number((srcOffset + clipDur).toFixed(3)) },
          easing: [...S_CURVE_EASE]
        });
      }

      kfs.sort((a, b) => a.time - b.time);
      layer.keyframes.timeRemap = kfs;
      layer.timeRemap = srcOffset;

      if (typeof global.invalidatePreviewCacheForLayer === 'function') {
        global.invalidatePreviewCacheForLayer(layer);
      }
    });

    global.activeKeyframeProperty = 'timeRemap';
    if (typeof global.syncSpeedControllerValues === 'function') global.syncSpeedControllerValues();
    if (typeof global.updateSpeedKeyframeBtnState === 'function') global.updateSpeedKeyframeBtnState();
    if (typeof global.updateTimelineKeyframeMarkersHighlight === 'function') global.updateTimelineKeyframeMarkersHighlight();
    if (typeof global.updateAllGraphBtnStates === 'function') global.updateAllGraphBtnStates();
    notifyProjectChange('velocity_timeremap', `Time Remap Velocity Applied (${selected.length} layer${selected.length > 1 ? 's' : ''})`);
    return JSON.stringify({ error: false, message: 'Time Remap velocity applied' });
  }

  // =========================================================================
  // UNIVERSAL CENTRAL TRANSLATOR: executeFishTool
  // =========================================================================
  function _executeFishToolInternal(tool, ...args) {
    if (!tool) return false;

    // Check if openfishtools-controller.js has defined its own full method
    if (typeof global.openfishtoolsControllerExecute === 'function') {
      return global.openfishtoolsControllerExecute(tool, ...args);
    }

    switch (tool) {
      // Beat Presets
      case 'PRESET_WARP1':
      case 'WARP1':
        return applyPresetWarp1();
      case 'PRESET_WARP2':
      case 'WARP2':
        return applyPresetWarp2();
      case 'PRESET_WARP3':
      case 'WARP3':
        return applyPresetWarp3();

      // Beat Adjustment Effects
      case 'GHST':
        return applyBeatGhostEffect();
      case 'WARP':
        return applyBeatWarpEffect(args[0]);
      case 'FISHEYE':
        return applyBeatFisheyeEffect(args[0]);
      case 'MIDWAVE':
        return applyBeatMidwaveEffect();
      case 'HUESPIN':
        return applyBeatHuespinEffect();
      case 'EXPO':
      case 'FLASH':
        return applyBeatFlashEffect();
      case 'LENS':
        return applyBeatBlurEffect(args[0]);

      // Beat Null Tools
      case 'OSCILLATE':
      case 'SHAKY':
      case 'SWING':
      case 'Y_BEAT':
      case 'Y_FLIP':
      case 'X_BEAT':
      case 'X_FLIP':
      case 'SCALE_BEAT':
      case 'SCALE_OVERLAP':
      case 'PANNING':
      case 'PANNING_POS':
      case 'PANNING_ROT':
      case 'PANNING_SCALE':
      case 'PANNING_MIX_PR':
      case 'PANNING_MIX_ALL':
        return applyBeatNullTool(tool === 'PANNING' ? 'PANNING_MIX_ALL' : tool);

      // Velocity
      case 'TWIX':
        if (typeof global.applyTwixtorVelocity === 'function') return global.applyTwixtorVelocity();
        return applyTwixtorVelocity();
      case 'TMRE':
        if (typeof global.applyTimeRemapVelocity === 'function') return global.applyTimeRemapVelocity();
        return applyTimeRemapVelocity();

      // Actions
      case 'PRECOMP':
        if (typeof global.precomposeSelectedLayers === 'function') return global.precomposeSelectedLayers(false);
        break;
      case 'PRECOMP_AUTOCROP':
        if (typeof global.precomposeSelectedLayers === 'function') return global.precomposeSelectedLayers(true);
        break;
      case 'CENTER':
      case 'CENTERINCOMP':
        if (typeof global.alignSelectedLayers === 'function') return global.alignSelectedLayers('CENTERINCOMP');
        break;
      case 'OVERLAP':
        if (typeof global.applyKeyframeOverlap === 'function') return global.applyKeyframeOverlap();
        break;
      case 'SCREENSHOT':
      case 'PNG':
        if (typeof global.exportCurrentFrameAsPNG === 'function') return global.exportCurrentFrameAsPNG();
        break;
      case 'DUP_COMP':
      case 'DUP': {
        const layers = (global.currentProjectState && global.currentProjectState.layers) || [];
        const selId = global.selectedLayerId;
        const selLayer = layers.find(l => l.id === selId);
        if (selLayer && selLayer.type === 'precomp') {
          if (typeof global.duplicatePrecompLayer === 'function') return global.duplicatePrecompLayer(args[0]);
        } else {
          if (typeof global.duplicateSelectedLayers === 'function') return global.duplicateSelectedLayers();
        }
        break;
      }

      // Transitions
      case 'TRANS_FADE_IN':
      case 'TRANS_FADE_OUT':
      case 'TRANS_SCALE_IN':
      case 'TRANS_SCALE_OUT':
        if (typeof global.applyTransitionKeyframes === 'function') return global.applyTransitionKeyframes(tool);
        break;

      // Toolbox Layer Operations
      case 'FRZ':
        if (typeof global.applyToolboxFreezeFrame === 'function') return global.applyToolboxFreezeFrame();
        break;
      case 'FIT':
        if (typeof global.applyToolboxFitToComp === 'function') return global.applyToolboxFitToComp(args[0]);
        break;
      case 'DSH':
        if (typeof global.applyToolboxDropShadow === 'function') return global.applyToolboxDropShadow();
        break;
      case 'MIR':
        if (typeof global.applyToolboxMirror === 'function') return global.applyToolboxMirror(args[0]);
        break;

      // Toolbox Create
      case 'SHA': {
        const timing = getSelectedLayerTiming();
        if (typeof global.addShapeLayer === 'function') return global.addShapeLayer('rectangle', { durationSec: timing.durationSec, startSec: timing.startSec });
        break;
      }
      case 'SOL': {
        const timing = getSelectedLayerTiming();
        if (typeof global.addSolidLayer === 'function') return global.addSolidLayer(timing.durationSec, timing.startSec, args[0] === true);
        break;
      }
      case 'NUL': {
        const timing = getSelectedLayerTiming();
        if (typeof global.addNullLayer === 'function') return global.addNullLayer(args[0] === true, { durationSec: timing.durationSec, startSec: timing.startSec });
        break;
      }
      case 'CAM': {
        const timing = getSelectedLayerTiming();
        if (typeof global.addCameraLayer === 'function') return global.addCameraLayer(timing.durationSec, timing.startSec);
        break;
      }
      case 'ADJ': {
        const timing = getSelectedLayerTiming();
        if (typeof global.addAdjustmentLayer === 'function') return global.addAdjustmentLayer(timing.durationSec, timing.startSec);
        break;
      }

      // Toolbox Effects
      case 'FILL':
        if (typeof global.addEffectToLayer === 'function') return global.addEffectToLayer('fill');
        break;
      case 'TINT':
        if (typeof global.addEffectToLayer === 'function') return global.addEffectToLayer('tint');
        break;
      case 'BLUR':
        if (typeof global.addEffectToLayer === 'function') return global.addEffectToLayer(args[0] === true ? 'camera-lens-blur' : 'fast-box-blur');
        break;
      case 'LUM':
        if (typeof global.addEffectToLayer === 'function') return global.addEffectToLayer('brightness-contrast');
        break;
      case 'CURV':
        if (typeof global.addEffectToLayer === 'function') return global.addEffectToLayer('curve');
        break;
      case 'HUE':
        if (typeof global.addEffectToLayer === 'function') return global.addEffectToLayer('hue-shift');
        break;

      // 3D Procedural Generators & Cube
      case 'CUBE':
      case 'CREATE_CUBE':
        if (typeof global.createProceduralCube === 'function') {
          return global.createProceduralCube(args[0], args[1], args[2], args[3]);
        }
        break;
      case 'GEN_3D_2SPLIT':
        if (typeof global.createProcedural2Split === 'function') return global.createProcedural2Split();
        break;
      case 'GEN_3D_3SPLIT':
        if (typeof global.createProcedural3Split === 'function') return global.createProcedural3Split();
        break;
      case 'GEN_3D_TUNNEL':
        if (typeof global.createProceduralTunnel === 'function') return global.createProceduralTunnel();
        break;
      case 'GEN_3D_MC':
        if (typeof global.createProceduralMC === 'function') return global.createProceduralMC();
        break;
      case 'GEN_3D':
      case 'GEN_3D_PHONE':
      case 'GEN_3D_ZFLIP':
      case 'GEN_3D_ZFOLD':
      case 'GEN_3D_TABLET':
      case 'GEN_3D_LAPTOP':
      case 'GEN_3D_MONITOR':
      case 'GEN_3D_PC':
      case 'GEN_3D_CRT':
      case 'GEN_3D_ROOM':
      case 'GEN_3D_DOOR':
      case 'GEN_3D_WINDOW':
      case 'GEN_3D_TABLE':
      case 'GEN_3D_DESK':
      case 'GEN_3D_CABINET':
      case 'GEN_3D_BOX':
      case 'GEN_3D_BOOK':
      case 'GEN_3D_BINDER':
      case 'GEN_3D_GLASSES':
        if (typeof global.createProcedural3D === 'function') {
          return global.createProcedural3D(tool.replace('GEN_3D_', ''));
        }
        break;

      default:
        // CuteFish Style handler
        if (typeof global.applyCutefishEffect === 'function' && typeof tool === 'string' && tool.startsWith('CF_')) {
          const targets = getSelectedLayers();
          return global.applyCutefishEffect(tool, targets);
        }
        break;
    }
  }

  function executeFishTool(tool, ...args) {
    if (!tool) return false;
    const pcm = global.PreviewCacheManager;
    const beforeSnap = (pcm && typeof pcm.captureStateSnapshot === 'function') ? pcm.captureStateSnapshot() : null;
    const res = _executeFishToolInternal(tool, ...args);
    if (pcm && beforeSnap && typeof pcm.invalidateSmartDiff === 'function') {
      const changed = pcm.invalidateSmartDiff(beforeSnap);
      if (changed && typeof global.redrawComposition === 'function') {
        global.redrawComposition('smartCache:' + String(tool));
      }
    }
    return res;
  }

  // =========================================================================
  // ADOBE AFTER EFFECTS EXTENDSCRIPT DOM SHIM (app.project.activeItem...)
  // Allows traditional AE .jsx scripts to manipulate Web Studio layers directly!
  // =========================================================================
  function createPropertyWrapper(rawLayer, propName, parentFx) {
    const clean = (propName || '').toLowerCase().replace(/[\s_-]/g, '');
    return {
      name: propName,
      property(childName) {
        return createPropertyWrapper(rawLayer, childName, parentFx);
      },
      addProperty(matchName) {
        rawLayer.effects = rawLayer.effects || [];
        const isSlider = (matchName || '').toLowerCase().includes('slider');
        const fx = isSlider
          ? createSlider(matchName || 'Slider', 0)
          : { id: uid('fx'), name: matchName, type: (matchName || '').toLowerCase().replace(/[^a-z0-9]/g, '_') };
        rawLayer.effects.push(fx);
        invalidateLayerRange(rawLayer);
        return createPropertyWrapper(rawLayer, matchName, fx);
      },
      setValue(val) {
        if (parentFx) {
          if (parentFx.slider !== undefined) parentFx.slider = val;
          parentFx.value = val;
          invalidateLayerRange(rawLayer);
          return;
        }
        if (clean.includes('position') || clean.includes('pos')) {
          if (Array.isArray(val)) { rawLayer.posX = val[0]; rawLayer.posY = val[1]; }
        } else if (clean.includes('scale')) {
          if (Array.isArray(val)) { rawLayer.scaleW = val[0]; rawLayer.scaleH = val[1]; }
        } else if (clean.includes('opacity')) {
          rawLayer.opacity = val;
        } else if (clean.includes('rotate') || clean.includes('rotation')) {
          rawLayer.rotZ = val;
          rawLayer.rotation = val;
        }
        invalidateLayerRange(rawLayer);
      },
      setValueAtTime(time, val) {
        rawLayer.keyframes = rawLayer.keyframes || {};
        const key = propName.toLowerCase();
        if (!Array.isArray(rawLayer.keyframes[key])) rawLayer.keyframes[key] = [];
        rawLayer.keyframes[key].push({ time, value: val, easing: [0.33, 0, 0.67, 1] });
        invalidateLayerRange(rawLayer);
      },
      get expression() {
        const exprs = rawLayer.expressions || {};
        if (clean.includes('position') || clean.includes('pos')) return exprs.move || exprs.position || '';
        if (clean.includes('rotate') || clean.includes('rotation')) return exprs.rotate || exprs.rotation || exprs.rotZ || '';
        if (clean.includes('scale')) return exprs.scale || '';
        if (clean.includes('opacity')) return exprs.opacity || '';
        return exprs[propName.toLowerCase()] || '';
      },
      set expression(exprStr) {
        rawLayer.expressions = rawLayer.expressions || {};
        if (clean.includes('position') || clean.includes('pos')) {
          rawLayer.expressions.move = exprStr;
          rawLayer.expressions.position = exprStr;
        } else if (clean.includes('rotation') || clean.includes('rotate') || clean.includes('rotz')) {
          rawLayer.expressions.rotate = exprStr;
          rawLayer.expressions.rotation = exprStr;
          rawLayer.expressions.rotZ = exprStr;
        } else if (clean.includes('scale')) {
          rawLayer.expressions.scale = exprStr;
        } else if (clean.includes('opacity')) {
          rawLayer.expressions.opacity = exprStr;
        } else {
          rawLayer.expressions[propName.toLowerCase()] = exprStr;
        }
        invalidateLayerRange(rawLayer);
      }
    };
  }

  function createLayerWrapper(rawLayer) {
    if (!rawLayer) return null;
    return {
      _raw: rawLayer,
      get id() { return rawLayer.id; },
      get name() { return rawLayer.name; },
      set name(v) { rawLayer.name = v; },
      get inPoint() { return rawLayer.startSec || 0; },
      set inPoint(v) { rawLayer.startSec = v; invalidateLayerRange(rawLayer); },
      get outPoint() { return (rawLayer.startSec || 0) + (rawLayer.durationSec || 5); },
      get parent() {
        if (!rawLayer.parentId) return null;
        const layers = (global.currentProjectState && global.currentProjectState.layers) || [];
        const p = layers.find(l => l.id === rawLayer.parentId);
        return createLayerWrapper(p);
      },
      set parent(pLayer) {
        rawLayer.parentId = pLayer && (pLayer.id || pLayer._raw?.id);
        invalidateLayerRange(rawLayer);
      },
      property(propName) {
        return createPropertyWrapper(rawLayer, propName);
      },
      get Effects() {
        return {
          addProperty(matchName) {
            rawLayer.effects = rawLayer.effects || [];
            const isSlider = (matchName || '').toLowerCase().includes('slider');
            const fx = isSlider
              ? createSlider(matchName || 'Slider', 0)
              : { id: uid('fx'), name: matchName, type: (matchName || '').toLowerCase().replace(/[^a-z0-9]/g, '_') };
            rawLayer.effects.push(fx);
            invalidateLayerRange(rawLayer);
            return createPropertyWrapper(rawLayer, matchName, fx);
          }
        };
      }
    };
  }

  const appShim = {
    project: {
      get activeItem() {
        const pState = global.currentProjectState || {};
        return {
          get numLayers() { return (pState.layers && pState.layers.length) || 0; },
          get selectedLayers() {
            return getSelectedLayers().map(createLayerWrapper);
          },
          layer(idx) {
            const l = pState.layers && pState.layers[idx - 1];
            return createLayerWrapper(l);
          },
          layers: {
            addAdjustmentLayer(name, dur) {
              const d = dur || 5;
              const cur = getPlayheadSec();
              const adj = typeof global.addAdjustmentLayer === 'function' ? global.addAdjustmentLayer(d, cur) : null;
              if (adj && name) adj.name = name;
              if (adj) invalidateLayerRange(adj);
              return createLayerWrapper(adj);
            },
            addNull(name, dur) {
              const d = dur || 5;
              const cur = getPlayheadSec();
              const n = typeof global.addNullLayer === 'function' ? global.addNullLayer(false, { durationSec: d, startSec: cur }) : null;
              if (n && name) n.name = name;
              if (n) invalidateLayerRange(n);
              return createLayerWrapper(n);
            },
            addSolid(color, name, w, h, par, dur) {
              const d = dur || 5;
              const cur = getPlayheadSec();
              const s = typeof global.addSolidLayer === 'function' ? global.addSolidLayer(d, cur) : null;
              if (s && name) s.name = name;
              if (s) invalidateLayerRange(s);
              return createLayerWrapper(s);
            }
          }
        };
      }
    }
  };

  function executeJSX(codeOrFn) {
    const pcm = global.PreviewCacheManager;
    const beforeSnap = (pcm && typeof pcm.captureStateSnapshot === 'function') ? pcm.captureStateSnapshot() : null;
    let res = null;
    if (typeof codeOrFn === 'function') {
      res = codeOrFn(appShim);
    } else if (typeof codeOrFn === 'string') {
      try {
        const fn = new Function('app', 'window', 'globalThis', 'JSXTranslator', 'executeFishTool', codeOrFn);
        res = fn(appShim, global, global, global.JSXTranslator, executeFishTool);
      } catch (err) {
        console.error('[JSXTranslator] executeJSX error:', err);
        throw err;
      }
    }
    if (pcm && beforeSnap && typeof pcm.invalidateSmartDiff === 'function') {
      const changed = pcm.invalidateSmartDiff(beforeSnap);
      if (changed) {
        notifyProjectChange('executeJSX');
      }
    }
    return res;
  }

  const supportedTools = [
    'PRESET_WARP1', 'PRESET_WARP2', 'PRESET_WARP3',
    'GHST', 'WARP', 'FISHEYE', 'MIDWAVE', 'HUESPIN', 'EXPO', 'SHAKY', 'LENS', 'OSCILLATE',
    'Y_BEAT', 'Y_FLIP', 'X_BEAT', 'X_FLIP', 'SCALE_BEAT', 'SWING',
    'PANNING_POS', 'PANNING_ROT', 'PANNING_SCALE', 'PANNING_MIX_PR', 'PANNING_MIX_ALL',
    'TWIX', 'TMRE',
    'ALIGN_LEFT', 'ALIGN_HCENTER', 'ALIGN_RIGHT', 'ALIGN_TOP', 'ALIGN_VCENTER', 'ALIGN_BOTTOM',
    'CUT_FRONT', 'CUT_MID', 'CUT_BACK', 'CUT_LEFT', 'CUT_RIGHT',
    'PRECOMP', 'CENTER', 'CENTERINCOMP', 'OVERLAP', 'DUP_COMP', 'DUP', 'FRZ', 'FIT', 'DSH', 'MIR',
    'TXT', 'SHA', 'SOL', 'NUL', 'CAM', 'ADJ',
    'FILL', 'TINT', 'BLUR', 'LUM', 'CURV', 'HUE',
    'CUBE', 'CREATE_CUBE', 'GEN_3D_2SPLIT', 'GEN_3D_3SPLIT', 'GEN_3D_TUNNEL', 'GEN_3D_MC',
    'GEN_3D_PHONE', 'GEN_3D_ZFLIP', 'GEN_3D_ZFOLD', 'GEN_3D_TABLET', 'GEN_3D_LAPTOP', 'GEN_3D_MONITOR', 'GEN_3D_PC', 'GEN_3D_CRT'
  ];

  // =========================================================================
  // GLOBAL EXPORTS & CROSS-FRAME LISTENER
  // =========================================================================
  global.JSXTranslator = {
    version: '1.0.0',
    executeTool: executeFishTool,
    executeJSX,
    tools: supportedTools,
    supportedTools,
    applyPresetWarp1,
    applyPresetWarp2,
    applyPresetWarp3,
    applyBeatGhostEffect,
    applyBeatWarpEffect,
    applyBeatFisheyeEffect,
    applyBeatMidwaveEffect,
    applyBeatHuespinEffect,
    applyBeatFlashEffect,
    applyBeatBlurEffect,
    applyBeatNullTool,
    app: appShim
  };

  global.app = global.app || appShim;
  global.executeFishTool = executeFishTool;
  global.executeJSX = executeJSX;
  global.applyPresetWarp1 = applyPresetWarp1;
  global.applyPresetWarp2 = applyPresetWarp2;
  global.applyPresetWarp3 = applyPresetWarp3;
  global.applyBeatGhostEffect = applyBeatGhostEffect;
  global.applyBeatWarpEffect = applyBeatWarpEffect;
  global.applyBeatFisheyeEffect = applyBeatFisheyeEffect;
  global.applyBeatMidwaveEffect = applyBeatMidwaveEffect;
  global.applyBeatHuespinEffect = applyBeatHuespinEffect;
  global.applyBeatFlashEffect = applyBeatFlashEffect;
  global.applyBeatBlurEffect = applyBeatBlurEffect;
  global.applyBeatNullTool = applyBeatNullTool;

  // Cross-frame message listener for postMessage triggers from OpenFishTools panel iframe
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('message', (event) => {
      if (event && event.data && event.data.type === 'fishtools-run-tool' && event.data.tool) {
        const args = Array.isArray(event.data.args) ? event.data.args : [];
        executeFishTool(event.data.tool, ...args);
      }
    });
  }

})(typeof window !== 'undefined' ? window : this);
