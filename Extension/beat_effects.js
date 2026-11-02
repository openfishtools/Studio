/**
 * OpenFishTools Extension - Beat Effects Card (.js)
 * 100% Self-Contained Extension: UI + Current Beat, Continuous Motion, Panning, Idle Movement, Warp Presets, and Transitions.
 */
Card({
  id: 'beat_effects',
  name: 'Beat Effects',
  icon: 'graphic_eq',
  description: 'Current, Continuous, Panning, Idle Movement, and WARP1/2 beat-synchronized effects.',
  category: 'Tools',
  defaultEnabled: true,

  // ============================================================================
  // 1. LOGIKA ALGORITMA CURRENT BEAT EFFECTS (GHOST, WARP, FISHEYE, MIDWAVE, HUESPIN)
  // ============================================================================
  positionAboveSelectedLayer(ctx, adj, selId) {
    if (selId && selId !== adj.id) {
      const layers = ctx.layers.getAll();
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }
  },

  applyBeatGhostEffect(ctx) {
    const pps = ctx.timeline.getPps();
    const curSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
    const startSec = curSec;
    const durationSec = 0.7714;
    const t1 = Number((startSec + 0.0598).toFixed(4));
    const t2 = Number((startSec + 0.7733).toFixed(4));
    const selId = window.selectedLayerId;

    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Ghost Effect';
    adj.isDurationExplicit = true;

    const transformFx = {
      id: 'fx_transform_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
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

    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[`${transformFx.id}:scale`] = [...easeGhost];
    adj.defaultEasing[`${transformFx.id}:opacity`] = [...easeGhost];
    adj.defaultEasing['opacity'] = [...easeGhost];
    adj._defaultEasing = adj.defaultEasing;

    this.positionAboveSelectedLayer(ctx, adj, selId);
    ctx.layers.select(adj.id);
    window.activeKeyframeProperty = `${transformFx.id}:scale`;
    ctx.project.commit('applyBeatGhostEffect', adj);
    ctx.toast('Ghost Effect applied');
    return JSON.stringify({ error: false, message: 'Ghost Effect applied', layerId: adj.id });
  },

  applyBeatWarpEffect(ctx, customFrames = 8) {
    const pps = ctx.timeline.getPps();
    const fps = ctx.timeline.getFps();
    const curSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
    const frames = (typeof customFrames === 'number' && customFrames > 0) ? customFrames : 8;
    const durationSec = Number((frames / fps).toFixed(3));
    const selId = window.selectedLayerId;

    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, curSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Warp Effect';

    const fx = ctx.effects.createInstance('wave-warp');
    const waveWarpFx = fx || {
      id: 'fx_wave_warp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
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
    waveWarpFx.waveType = 'smooth-noise';
    waveWarpFx.waveHeight = 19;
    waveWarpFx.waveWidth = 10;
    waveWarpFx.direction = 90;
    waveWarpFx.speed = 0;
    waveWarpFx.tile = 1;
    adj.effects = [waveWarpFx];

    const easeOut = [0.0, 0.0, 0.2, 1.0];
    const endTime = Number((curSec + durationSec).toFixed(3));

    adj.keyframes = {
      [`${waveWarpFx.id}:waveHeight`]: [
        { time: curSec, value: { waveHeight: 19 }, easing: [...easeOut] },
        { time: endTime, value: { waveHeight: 0 }, easing: [...easeOut] }
      ]
    };

    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[`${waveWarpFx.id}:waveHeight`] = [...easeOut];
    adj._defaultEasing = adj.defaultEasing;

    this.positionAboveSelectedLayer(ctx, adj, selId);
    ctx.layers.select(adj.id);
    window.activeKeyframeProperty = `${waveWarpFx.id}:waveHeight`;
    ctx.project.commit('applyBeatWarpEffect', adj);
    ctx.toast('Warp Effect applied');
    return JSON.stringify({ error: false, message: 'Warp Effect applied', layerId: adj.id });
  },

  applyBeatFisheyeEffect(ctx, scaleFactor = 2) {
    const pps = ctx.timeline.getPps();
    const fps = ctx.timeline.getFps();
    const curSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
    const fd = 1 / fps;

    const sf = (typeof scaleFactor === 'number' && scaleFactor > 0) ? scaleFactor : 2;
    const rawOffsets = [-6, -2, 0, 6, 14, 22].map(v => Math.round(v * sf));
    const rawValues = [0, 15, -80, 15, -4, 0];

    const preFrames = Math.abs(rawOffsets[0]);
    const postFrames = rawOffsets[rawOffsets.length - 1] + 4;
    const totalFrames = preFrames + postFrames;

    const startSec = Math.max(0, Number((curSec - preFrames * fd).toFixed(3)));
    const durationSec = Number((totalFrames * fd).toFixed(3));
    const selId = window.selectedLayerId;

    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Fish Eye Ripple';

    const fx = ctx.effects.createInstance('warp');
    const warpFx = fx || {
      id: 'fx_warp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'warp',
      name: 'Warp',
      isExpanded: true,
      disabled: false,
      warpStyle: 'fisheye',
      bend: -80,
      distortH: 0,
      distortV: 0,
      tile: 1
    };
    warpFx.warpStyle = 'fisheye';
    warpFx.bend = -80;
    warpFx.tile = 1;
    adj.effects = [warpFx];

    const easyEase = [0.33, 0.0, 0.67, 1.0];
    const kfList = [];
    for (let i = 0; i < rawOffsets.length; i++) {
      const t = Math.max(0, Number((curSec + rawOffsets[i] * fd).toFixed(3)));
      if (kfList.length > 0 && Math.abs(kfList[kfList.length - 1].time - t) < 0.001) continue;
      kfList.push({
        time: t,
        value: { bend: rawValues[i] },
        easing: [...easyEase]
      });
    }

    adj.keyframes = { [`${warpFx.id}:bend`]: kfList };
    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[`${warpFx.id}:bend`] = [...easyEase];
    adj._defaultEasing = adj.defaultEasing;

    this.positionAboveSelectedLayer(ctx, adj, selId);
    ctx.layers.select(adj.id);
    window.activeKeyframeProperty = `${warpFx.id}:bend`;
    ctx.project.commit('applyBeatFisheyeEffect', adj);
    ctx.toast('Fish Eye Ripple applied');
    return JSON.stringify({ error: false, message: 'Fish Eye Ripple applied', layerId: adj.id });
  },

  applyBeatMidwaveEffect(ctx) {
    const pps = ctx.timeline.getPps();
    const curSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));

    const startSec = curSec;
    const durationSec = 1.5914;
    const t1 = Number(startSec.toFixed(4));
    const t2 = Number((startSec + 0.3667).toFixed(4));
    const t3 = Number((startSec + 1.5914).toFixed(4));
    const selId = window.selectedLayerId;

    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Mid-Wave';
    adj.isDurationExplicit = true;
    adj.direction = 45;
    adj.waveHeight = 85;
    adj.waveWidth = 1797;
    adj.speed = 1.6;

    const ww1 = {
      id: 'fx_wave_warp_' + Date.now() + '_1_' + Math.random().toString(36).substring(2, 6),
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
      id: 'fx_wave_warp_' + Date.now() + '_2_' + Math.random().toString(36).substring(2, 6),
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

    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[`${ww1.id}:waveWidth`] = [0, 0, 1, 1];
    adj.defaultEasing[`${ww1.id}:waveHeight`] = [0.002, 1, 0.224, 1];
    adj.defaultEasing[`${ww2.id}:waveHeight`] = [0.002, 1, 0.138, 1];
    adj._defaultEasing = adj.defaultEasing;

    this.positionAboveSelectedLayer(ctx, adj, selId);
    ctx.layers.select(adj.id);
    window.activeKeyframeProperty = `${ww1.id}:waveHeight`;
    ctx.project.commit('applyBeatMidwaveEffect', adj);
    ctx.toast('Mid-Wave applied');
    return JSON.stringify({ error: false, message: 'Mid-Wave applied', layerId: adj.id });
  },

  applyBeatHuespinEffect(ctx) {
    const pps = ctx.timeline.getPps();
    const fps = ctx.timeline.getFps();
    const curSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
    const fd = 1 / fps;

    const durationSec = Number((25 * fd).toFixed(3));
    const startSec = curSec;
    const endSec = Number((curSec + durationSec).toFixed(3));
    const selId = window.selectedLayerId;

    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Hue Spin';

    const hueFx = {
      id: 'fx_hue_shift_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
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
        { time: startSec, value: { hue: 0 }, easing: [...linearEase] },
        { time: endSec, value: { hue: 360 }, easing: [...linearEase] }
      ]
    };

    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[`${hueFx.id}:hue`] = [...linearEase];
    adj._defaultEasing = adj.defaultEasing;

    this.positionAboveSelectedLayer(ctx, adj, selId);
    ctx.layers.select(adj.id);
    window.activeKeyframeProperty = `${hueFx.id}:hue`;
    ctx.project.commit('applyBeatHuespinEffect', adj);
    ctx.toast('Hue Spin applied');
    return JSON.stringify({ error: false, message: 'Hue Spin applied', layerId: adj.id });
  },

  // ============================================================================
  // 2. LOGIKA ALGORITMA WARP PRESETS (WARP 1 & WARP 2)
  // ============================================================================
  applyPresetWarp1(ctx) {
    ctx.history.snapshot();
    const pps = ctx.timeline.getPps();
    const fps = ctx.timeline.getFps();

    const curPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
    const rawPlayheadSec = (typeof window.getCurrentPlayheadTime === 'function')
      ? window.getCurrentPlayheadTime()
      : (typeof window.getTimelineCurrentSec === 'function')
        ? window.getTimelineCurrentSec()
        : Math.max(0, -curPanX / pps);

    const curFrame = Math.round(rawPlayheadSec * fps);
    const curSec = Number((curFrame / fps).toFixed(4));
    const selId = window.selectedLayerId;
    const createdLayers = [];
    const uid = (prefix) => prefix + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    // 1. Mid-Wave
    const midwavePreFrames = Math.round((20 / 60) * fps);
    const midwaveStartFrame = Math.max(0, curFrame - midwavePreFrames);
    const midwaveStart = Number((midwaveStartFrame / fps).toFixed(4));
    const midwaveDur = Number((145 / fps).toFixed(4));
    const mwT1 = midwaveStart;
    const mwT2 = Number((curSec + (2 / fps)).toFixed(4));
    const mwT3 = Number((midwaveStart + midwaveDur).toFixed(4));

    const adjMidwave = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(midwaveDur, midwaveStart) : null;
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

    // 2. Warp Effect
    const warpPreFrames = Math.round((16 / 60) * fps);
    const warpStartFrame = Math.max(0, curFrame - warpPreFrames);
    const warpStart = Number((warpStartFrame / fps).toFixed(4));
    const warpDur = Number((63 / fps).toFixed(4));
    const warpSourceOffset = Number((28 / fps).toFixed(4));
    const warpT1 = warpStart;
    const warpT2 = curSec;
    const warpT3 = Number((warpStart + warpDur).toFixed(4));

    const adjWarp = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(warpDur, warpStart) : null;
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

    // 3. Ghost Effect
    const ghostStart = curSec;
    const ghostDur = Number((125 / fps).toFixed(4));
    const ghT1 = curSec;
    const ghT2 = Number((curSec + ghostDur).toFixed(4));
    const ghOpT2 = Number((curSec + (65 / fps)).toFixed(4));

    const adjGhost = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(ghostDur, ghostStart) : null;
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

    // 4. Hue Spin
    const hueStart = curSec;
    const hueDur = Number((43 / fps).toFixed(4));
    const hueT1 = curSec;
    const hueT2 = Number((curSec + (25 / fps)).toFixed(4));

    const adjHue = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(hueDur, hueStart) : null;
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

    const stackInOrder = [adjMidwave, adjWarp, adjGhost, adjHue].filter(Boolean);
    const layers = ctx.layers.getAll();
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
    ctx.layers.select(topLayer.id);
    if (window.selectedLayerIds) {
      window.selectedLayerIds.clear();
      createdLayers.forEach(l => window.selectedLayerIds.add(l.id));
    }
    window.selectedLayerId = topLayer.id;

    ctx.project.commit('applyPresetWarp1', createdLayers);
    ctx.toast('Preset Warp1 applied');
    return JSON.stringify({ error: false, message: 'Preset Warp1 applied', layerIds: createdLayers.map(l => l.id) });
  },

  applyPresetWarp2(ctx) {
    ctx.history.snapshot();
    const pps = ctx.timeline.getPps();
    const fps = ctx.timeline.getFps();

    const curPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
    const rawPlayheadSec = (typeof window.getCurrentPlayheadTime === 'function')
      ? window.getCurrentPlayheadTime()
      : (typeof window.getTimelineCurrentSec === 'function')
        ? window.getTimelineCurrentSec()
        : Math.max(0, -curPanX / pps);

    const curFrame = Math.round(rawPlayheadSec * fps);
    const curSec = Number((curFrame / fps).toFixed(4));
    const selId = window.selectedLayerId;
    const createdLayers = [];
    const uid = (prefix) => prefix + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    // 1. Mid-Wave
    const midwavePreFrames = Math.round((20 / 60) * fps);
    const midwaveStartFrame = Math.max(0, curFrame - midwavePreFrames);
    const midwaveStart = Number((midwaveStartFrame / fps).toFixed(4));
    const midwaveDur = Number(((145 / 60) * (60 / fps)).toFixed(4));
    const mwT1 = midwaveStart;
    const mwT2 = Number((curSec + (2 / fps)).toFixed(4));
    const mwT3 = Number((midwaveStart + midwaveDur).toFixed(4));

    const adjMidwave = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(midwaveDur, midwaveStart) : null;
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

    // 2. Warp Effect
    const warpPreFrames = Math.round((16 / 60) * fps);
    const warpStartFrame = Math.max(0, curFrame - warpPreFrames);
    const warpStart = Number((warpStartFrame / fps).toFixed(4));
    const warpDur = Number(((63 / 60) * (60 / fps)).toFixed(4));
    const warpT1 = warpStart;
    const warpT2 = curSec;
    const warpT3 = Number((warpStart + warpDur).toFixed(4));

    const adjWarp = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(warpDur, warpStart) : null;
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

    // 3. Ghost Effect
    const ghostStart = curSec;
    const ghostDur = Number(((125 / 60) * (60 / fps)).toFixed(4));
    const ghT1 = curSec;
    const ghT2 = Number((curSec + ghostDur).toFixed(4));
    const ghOpT2 = Number((curSec + ((65 / 60) * (60 / fps))).toFixed(4));

    const adjGhost = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(ghostDur, ghostStart) : null;
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

    // 4. Hue Spin
    const hueStart = curSec;
    const hueDur = Number(((70 / 60) * (60 / fps)).toFixed(4));
    const hueT1 = curSec;
    const hueT2 = Number((curSec + hueDur).toFixed(4));

    const adjHue = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(hueDur, hueStart) : null;
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
    const layers = ctx.layers.getAll();
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
    ctx.layers.select(topLayer.id);
    if (window.selectedLayerIds) {
      window.selectedLayerIds.clear();
      createdLayers.forEach(l => window.selectedLayerIds.add(l.id));
    }
    window.selectedLayerId = topLayer.id;

    ctx.project.commit('applyPresetWarp2', createdLayers);
    ctx.toast('Preset Warp2 applied');
    return JSON.stringify({ error: false, message: 'Preset Warp2 applied', layerIds: createdLayers.map(l => l.id) });
  },

  // ============================================================================
  // 3. LOGIKA ALGORITMA EXPOSURE FLASH & LENS/BOX BLUR BEAT
  // ============================================================================
  applyBeatFlashEffect(ctx) {
    const selLayer = ctx.layers.getActive();
    if (!selLayer) {
      const msg = 'Please select a layer first to apply Flash.';
      ctx.toast(msg);
      return JSON.stringify({ error: true, tool: 'EXPO', type: 'warn', message: msg });
    }

    const { startSec, durationSec } = ctx.layers.getTiming(selLayer);
    const rawMarkers = ctx.timeline.getBeatmarks(selLayer);
    if (rawMarkers.length === 0) {
      const msg = 'Please place beatmarks on the timeline or selected layer first.';
      ctx.toast(msg);
      return JSON.stringify({ error: true, tool: 'EXPO', type: 'warn', message: msg });
    }

    ctx.history.snapshot();
    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Exposure Flash Beat';

    const fx = ctx.effects.createInstance('exposure-gamma');
    const expoFx = fx || {
      id: 'fx_exposure_gamma_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'exposure-gamma',
      name: 'Exposure / Gamma',
      isExpanded: true,
      disabled: false,
      exposure: 0,
      gamma: 0,
      offset: 0
    };
    expoFx.exposure = 0;
    expoFx.gamma = 0;
    expoFx.offset = 0;

    const ampSlider = ctx.layers.createSlider('Amp', 50, 0, 200, 1, '%');
    const decaySlider = ctx.layers.createSlider('Decay', 18, 0.1, 100, 0.5, '');
    const attackSlider = ctx.layers.createSlider('Attack', 0, 0, 100, 1, '');

    adj.effects = [expoFx, ampSlider, decaySlider, attackSlider];

    const flashExpr = [
      '// OpenFishTools Lite - Exposure Flash Beat Expression',
      'amp = effect("Amp")("ADBE Slider Control-0001");',
      'decay = effect("Decay")("ADBE Slider Control-0001");',
      'attack = effect("Attack")("ADBE Slider Control-0001");',
      '',
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

    const scopedKey = `${expoFx.id}:exposure`;
    adj.keyframes = {};
    adj.expressions = adj.expressions || {};
    adj.expressions[scopedKey] = flashExpr;
    adj.expressions['exposure'] = flashExpr;

    this.positionAboveSelectedLayer(ctx, adj, selLayer.id);
    ctx.layers.select(adj.id);
    window.activeKeyframeProperty = scopedKey;
    window.activeExpressionProperty = scopedKey;
    ctx.project.commit('applyBeatFlashEffect', adj);
    ctx.toast('Exposure Flash Beat applied');
    return JSON.stringify({ error: false, message: 'Exposure Flash Beat applied', layerId: adj.id });
  },

  applyBeatBlurEffect(ctx, isRightClick) {
    const isLensBlur = (isRightClick === true);
    const selLayer = ctx.layers.getActive();
    if (!selLayer) {
      const msg = 'Please select a layer first to apply Blur.';
      ctx.toast(msg);
      return JSON.stringify({ error: true, tool: 'LENS', type: 'warn', message: msg });
    }

    const { startSec, durationSec } = ctx.layers.getTiming(selLayer);
    const rawMarkers = ctx.timeline.getBeatmarks(selLayer);
    if (rawMarkers.length === 0) {
      const msg = 'Please place beatmarks on the timeline or selected layer first.';
      ctx.toast(msg);
      return JSON.stringify({ error: true, tool: 'LENS', type: 'warn', message: msg });
    }

    ctx.history.snapshot();
    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = isLensBlur ? 'Lens Blur Beat' : 'Fast Box Blur Beat';

    let blurFx = null;
    const maxBlur = isLensBlur ? 2.5 : 4;

    if (isLensBlur) {
      const fx = ctx.effects.createInstance('camera-lens-blur');
      blurFx = fx || {
        id: 'fx_camera_lens_blur_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        type: 'camera-lens-blur',
        name: 'Camera Lens Blur',
        isExpanded: true,
        disabled: false,
        radius: 0,
        aspectRatio: 100,
        bloom: 0
      };
      blurFx.radius = 0;
      blurFx.bloom = 0;
      blurFx.aspectRatio = 100;
    } else {
      const fx = ctx.effects.createInstance('fast-box-blur');
      blurFx = fx || {
        id: 'fx_fast_box_blur_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        type: 'fast-box-blur',
        name: 'Fast Box Blur',
        isExpanded: true,
        disabled: false,
        radius: 0,
        iterations: 1
      };
      blurFx.radius = 0;
      blurFx.iterations = 1;
    }

    const ampSlider = ctx.layers.createSlider('Amp', maxBlur, 0, 100, isLensBlur ? 0.5 : 1, ' px');
    const decaySlider = ctx.layers.createSlider('Decay', 5.0, 0.1, 100, 0.5, '');
    const attackSlider = ctx.layers.createSlider('Attack', 0, 0, 100, 1, '');

    adj.effects = [blurFx, ampSlider, decaySlider, attackSlider];

    const blurExpr = [
      '// OpenFishTools Lite - Blur Beat Expression',
      'amp = effect("Amp")("ADBE Slider Control-0001");',
      'decay = effect("Decay")("ADBE Slider Control-0001");',
      'attack = effect("Attack")("ADBE Slider Control-0001");',
      '',
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
      '            if (t >= 0) {',
      '                env = (attack > 0) ? (1 - Math.exp(-t * attack)) : 1;',
      '                res = value + (amp * env) / Math.exp(t * decay);',
      '            }',
      '        }',
      '    }',
      '}',
      'res;'
    ].join('\n');

    const scopedKey = `${blurFx.id}:radius`;
    adj.keyframes = {};
    adj.expressions = adj.expressions || {};
    adj.expressions[scopedKey] = blurExpr;
    adj.expressions['radius'] = blurExpr;

    this.positionAboveSelectedLayer(ctx, adj, selLayer.id);
    ctx.layers.select(adj.id);
    window.activeKeyframeProperty = scopedKey;
    window.activeExpressionProperty = scopedKey;
    ctx.project.commit('applyBeatBlurEffect', adj);
    const effectLabel = isLensBlur ? 'Lens Blur Beat' : 'Fast Box Blur Beat';
    ctx.toast(`${effectLabel} applied`);
    return JSON.stringify({ error: false, message: `${effectLabel} applied`, layerId: adj.id });
  },

  // ============================================================================
  // 4. LOGIKA ALGORITMA TRANSITIONS (FADE IN/OUT, SCALE IN/OUT)
  // ============================================================================
  applyTransitionKeyframes(ctx, toolName) {
    const selected = ctx.layers.getSelected();
    if (selected.length === 0) {
      const msg = 'Please select at least one layer to apply a transition.';
      ctx.toast(msg);
      return JSON.stringify({ error: true, tool: 'Transition', type: 'warn', message: msg });
    }

    const pps = ctx.timeline.getPps();
    const fps = ctx.timeline.getFps();
    const fd = 1 / fps;
    const defaultDur = Number((15 * fd).toFixed(4));
    const [baseW, baseH] = ctx.project.getDimensions();

    ctx.history.snapshot();

    const easeOut = [0.16, 1.0, 0.3, 1.0];
    const easeIn = [0.4, 0.0, 0.2, 1.0];
    let activeProp = 'opacity';
    let label = 'Transition';

    selected.forEach(layer => {
      const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
      const clipEnd = Number((clipStart + clipDur).toFixed(4));
      const dur = Math.min(defaultDur, Math.max(fd, clipDur * 0.45));

      if (!layer.keyframes) layer.keyframes = {};
      if (!layer.defaultEasing) layer.defaultEasing = {};

      const baseOpacity = layer.opacity !== undefined ? layer.opacity : 1.0;
      const origScaleW = layer.scaleW !== undefined ? layer.scaleW : (layer.mediaWidth || baseW);
      const origScaleH = layer.scaleH !== undefined ? layer.scaleH : (layer.mediaHeight || baseH);

      if (toolName === 'TRANS_FADE_IN') {
        label = 'Fade In';
        activeProp = 'opacity';
        const t1 = Number(clipStart.toFixed(4));
        const t2 = Number((clipStart + dur).toFixed(4));
        const existing = Array.isArray(layer.keyframes.opacity)
          ? layer.keyframes.opacity.filter(k => k.time < t1 - 0.005 || k.time > t2 + 0.005)
          : [];
        existing.push({ time: t1, value: { opacity: 0.0 }, easing: [...easeOut] });
        existing.push({ time: t2, value: { opacity: baseOpacity }, easing: [...easeOut] });
        existing.sort((a, b) => a.time - b.time);
        layer.keyframes.opacity = existing;
        layer.defaultEasing.opacity = [...easeOut];
      } else if (toolName === 'TRANS_FADE_OUT') {
        label = 'Fade Out';
        activeProp = 'opacity';
        const t1 = Number((clipEnd - dur).toFixed(4));
        const t2 = Number(clipEnd.toFixed(4));
        const existing = Array.isArray(layer.keyframes.opacity)
          ? layer.keyframes.opacity.filter(k => k.time < t1 - 0.005 || k.time > t2 + 0.005)
          : [];
        existing.push({ time: t1, value: { opacity: baseOpacity }, easing: [...easeIn] });
        existing.push({ time: t2, value: { opacity: 0.0 }, easing: [...easeIn] });
        existing.sort((a, b) => a.time - b.time);
        layer.keyframes.opacity = existing;
        layer.defaultEasing.opacity = [...easeIn];
      } else if (toolName === 'TRANS_SCALE_IN') {
        label = 'Scale In';
        activeProp = 'scale';
        const t1 = Number(clipStart.toFixed(4));
        const t2 = Number((clipStart + dur).toFixed(4));
        const existing = Array.isArray(layer.keyframes.scale)
          ? layer.keyframes.scale.filter(k => k.time < t1 - 0.005 || k.time > t2 + 0.005)
          : [];
        existing.push({ time: t1, value: { scaleW: 0, scaleH: 0 }, easing: [...easeOut] });
        existing.push({ time: t2, value: { scaleW: origScaleW, scaleH: origScaleH }, easing: [...easeOut] });
        existing.sort((a, b) => a.time - b.time);
        layer.keyframes.scale = existing;
        layer.defaultEasing.scale = [...easeOut];
      } else if (toolName === 'TRANS_SCALE_OUT') {
        label = 'Scale Out';
        activeProp = 'scale';
        const t1 = Number((clipEnd - dur).toFixed(4));
        const t2 = Number(clipEnd.toFixed(4));
        const existing = Array.isArray(layer.keyframes.scale)
          ? layer.keyframes.scale.filter(k => k.time < t1 - 0.005 || k.time > t2 + 0.005)
          : [];
        existing.push({ time: t1, value: { scaleW: origScaleW, scaleH: origScaleH }, easing: [...easeIn] });
        existing.push({ time: t2, value: { scaleW: 0, scaleH: 0 }, easing: [...easeIn] });
        existing.sort((a, b) => a.time - b.time);
        layer.keyframes.scale = existing;
        layer.defaultEasing.scale = [...easeIn];
      }
      layer._defaultEasing = layer.defaultEasing;
    });

    window.activeKeyframeProperty = activeProp;
    ctx.project.commit('applyTransitionKeyframes', selected);
    ctx.toast(`${label} applied`);
    return JSON.stringify({ error: false, message: `${label} applied`, count: selected.length });
  },

  // ============================================================================
  // 5. LOGIKA ALGORITMA NULL LAYER RIG (CONTINUOUS MOTION, PANNING, IDLE MOVEMENT)
  // ============================================================================
  applyBeatNullTool(ctx, toolName) {
    const layers = ctx.layers.getAll();
    const targetLayer = ctx.layers.getActive();
    if (!targetLayer) {
      const msg = 'Please select a layer first.';
      ctx.toast(msg);
      return JSON.stringify({ error: true, tool: toolName, type: 'warn', message: msg });
    }

    const { startSec, durationSec, pps } = ctx.layers.getTiming(targetLayer);
    const allMarkers = ctx.timeline.getBeatmarks(targetLayer);
    const isPanning = toolName.indexOf('PANNING') === 0;
    if (!isPanning && allMarkers.length === 0) {
      const msg = `Please place beat markers on the timeline first to apply ${toolName}.`;
      ctx.toast(msg);
      return JSON.stringify({ error: true, tool: toolName, type: 'warn', message: msg });
    }

    ctx.history.snapshot();
    const [baseW, baseH] = ctx.project.getDimensions();
    const targetX = targetLayer.posX !== undefined ? targetLayer.posX : Math.round(baseW / 2);
    const targetY = targetLayer.posY !== undefined ? targetLayer.posY : Math.round(baseH / 2);

    const nullNames = {
      OSCILLATE: 'OSCILLATE',
      SHAKY: 'SHAKY',
      Y_BEAT: 'Y BEAT',
      Y_FLIP: 'Y FLIP',
      X_BEAT: 'X BEAT',
      X_FLIP: 'X FLIP',
      SCALE_BEAT: 'SCALE BEAT',
      SCALE_OVERLAP: 'SCALE OVER',
      SWING: 'Swing_Null',
      PANNING_POS: 'PANNING Position',
      PANNING_ROT: 'PANNING Rotation',
      PANNING_SCALE: 'PANNING Scale',
      PANNING_MIX_PR: 'PANNING Mix PR',
      PANNING_MIX_ALL: 'PANNING Mix All',
      IDLE_MOVE_1: 'IDLE MOVE 1',
      IDLE_MOVE_2: 'IDLE MOVE 2',
      IDLE_MOVE_3: 'IDLE MOVE 3',
      IDLE_MOVE_4: 'IDLE MOVE 4',
      IDLE_MOVE_5: 'IDLE MOVE 5',
      IDLE_MOVE_6: 'IDLE MOVE 6'
    };
    const nullName = nullNames[toolName] || 'Null';
    const isIdleMove = (typeof toolName === 'string' && toolName.indexOf('IDLE_MOVE_') === 0);

    const nullLayer = {
      id: 'layer_null_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: nullName,
      type: 'null',
      startPx: Math.round(startSec * pps),
      startSec,
      durationSec,
      widthPx: Math.max(40, Math.round(durationSec * pps)),
      posX: targetX,
      posY: targetY,
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
      parentPosX: targetX,
      parentPosY: targetY,
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

    let activeProp = 'move';
    const createSlider = (name, val, min, max, step, unit) => ctx.layers.createSlider(name, val, min, max, step, unit);

    if (toolName === 'OSCILLATE') {
      activeProp = 'move';
      nullLayer.effects.push(createSlider('Freq', 3, 0.1, 20, 0.1, ' Hz'));
      nullLayer.effects.push(createSlider('Amp', 30, 0, 500, 1, ' px'));
      nullLayer.effects.push(createSlider('Decay', 2.7, 0, 20, 0.1, ''));
      nullLayer.effects.push(createSlider('Attack', 40, 0, 100, 1, ''));

      nullLayer.expressions.move = [
        'freq = effect("Freq")("ADBE Slider Control-0001");',
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'attack = effect("Attack")("ADBE Slider Control-0001");',
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    n = 0;',
        '    if (m.numKeys > 0){',
        '        n = m.nearestKey(time).index;',
        '        if (m.key(n).time > time) n--;',
        '    }',
        '    if (n > 0){',
        '        markerTime = m.key(n).time;',
        '        if (markerTime >= inPoint && markerTime <= outPoint){',
        '            t = time - markerTime;',
        '            env = (attack > 0) ? (1 - Math.exp(-t * attack)) : 1;',
        '            currAmp = amp * env / Math.exp(t * decay);',
        '            x = Math.sin(t * freq * Math.PI * 2) * currAmp;',
        '            y = (1 - Math.cos(t * freq * Math.PI * 2)) * currAmp;',
        '            value + [x, y];',
        '        }else{ value; }',
        '    }else{ value; }',
        '}'
      ].join('\n');
    } else if (toolName === 'SHAKY') {
      activeProp = 'move';
      nullLayer.effects.push(createSlider('Freq', 5, 0.1, 20, 0.1, ' Hz'));
      nullLayer.effects.push(createSlider('X Amp', 50, 0, 500, 1, ' px'));
      nullLayer.effects.push(createSlider('Y Amp', 50, 0, 500, 1, ' px'));
      nullLayer.effects.push(createSlider('Rot Amp', 15, 0, 180, 1, ' deg'));
      nullLayer.effects.push(createSlider('Decay', 3.0, 0, 20, 0.1, ''));
      nullLayer.effects.push(createSlider('Attack', 40, 0, 100, 1, ''));

      const shakeExpr = [
        'freq = effect("Freq")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'attack = effect("Attack")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    n = 0;',
        '    if (m.numKeys > 0){',
        '        n = m.nearestKey(time).index;',
        '        if (m.key(n).time > time) n--;',
        '    }',
        '    if (n > 0){',
        '        markerTime = m.key(n).time;',
        '        if (markerTime >= inPoint && markerTime <= outPoint){',
        '            t = time - markerTime;',
        '            env = (attack > 0) ? (1 - Math.exp(-t * attack)) : 1;',
        '            mult = env / Math.exp(t * decay);'
      ];

      nullLayer.expressions.move = [
        ...shakeExpr,
        '            ampX = effect("X Amp")("ADBE Slider Control-0001");',
        '            ampY = effect("Y Amp")("ADBE Slider Control-0001");',
        '            wg = wiggle(freq, 1);',
        '            nX = (wg[0] - value[0]) * ampX * mult;',
        '            nY = (wg[1] - value[1]) * ampY * mult;',
        '            value + [nX, nY];',
        '        }else{ value; }',
        '    }else{ value; }',
        '}'
      ].join('\n');

      nullLayer.expressions.rotate = [
        ...shakeExpr,
        '            ampRot = effect("Rot Amp")("ADBE Slider Control-0001");',
        '            wg = wiggle(freq, 1);',
        '            nR = (wg - value) * ampRot * mult;',
        '            value + nR;',
        '        }else{ value; }',
        '    }else{ value; }',
        '}'
      ].join('\n');
    } else if (toolName === 'SWING') {
      activeProp = 'rotate';
      nullLayer.effects.push(createSlider('Freq', 1, 0.1, 20, 0.1, ' Hz'));
      nullLayer.effects.push(createSlider('Amp', 4, 0, 180, 0.5, '°'));
      nullLayer.effects.push(createSlider('Decay', 1.5, 0, 20, 0.1, ''));

      nullLayer.expressions.rotate = [
        'freq = effect("Freq")("ADBE Slider Control-0001");',
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    n = 0;',
        '    if (m.numKeys > 0){',
        '        n = m.nearestKey(time).index;',
        '        if (m.key(n).time > time) n--;',
        '    }',
        '    if (n > 0){',
        '        markerTime = m.key(n).time;',
        '        if (markerTime >= inPoint && markerTime <= outPoint){',
        '            t = time - markerTime;',
        '            currAmp = amp / Math.exp(t * decay);',
        '            r = currAmp * Math.sin(t * freq * Math.PI * 2);',
        '            value + r;',
        '        }else{ value; }',
        '    }else{ value; }',
        '}'
      ].join('\n');
    } else if (toolName === 'Y_BEAT' || toolName === 'X_BEAT') {
      activeProp = 'move';
      nullLayer.effects.push(createSlider('Amp', 500, -2000, 2000, 10, ' px'));
      nullLayer.effects.push(createSlider('Decay', 20, 1, 100, 1, ''));
      const vecOut = (toolName === 'Y_BEAT') ? '[0, val]' : '[val, 0]';

      nullLayer.expressions.move = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    n = m.nearestKey(time).index;',
        '    if (m.key(n).time > time) {',
        '        t2 = m.key(n).time;',
        '        t1 = (n > 1) ? m.key(n-1).time : -99999;',
        '    } else {',
        '        t1 = m.key(n).time;',
        '        t2 = (n < m.numKeys) ? m.key(n+1).time : 99999;',
        '    }',
        '    val1 = (t1 >= inPoint && t1 <= outPoint) ? (amp / Math.exp((time - t1) * decay)) : 0;',
        '    val2 = (t2 >= inPoint && t2 <= outPoint) ? (amp / Math.exp((t2 - time) * decay)) : 0;',
        '    val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '    value + ' + vecOut + ';',
        '}'
      ].join('\n');
    } else if (toolName === 'Y_FLIP' || toolName === 'X_FLIP') {
      activeProp = 'move';
      nullLayer.effects.push(createSlider('Amp', 500, -2000, 2000, 10, ' px'));
      nullLayer.effects.push(createSlider('Decay', 15, 1, 100, 1, ''));
      const vecOut = (toolName === 'Y_FLIP') ? '[0, val]' : '[val, 0]';
      const scaleOut = (toolName === 'Y_FLIP') ? '[value[0], sFlip]' : '[sFlip, value[1]]';

      nullLayer.expressions.move = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    validKeys = [];',
        '    for (i = 1; i <= m.numKeys; i++){',
        '        kt = m.key(i).time;',
        '        if (kt >= inPoint && kt <= outPoint) validKeys.push(i);',
        '    }',
        '    if (validKeys.length === 0){',
        '        value;',
        '    }else{',
        '        activeIdx = -1;',
        '        for (k = 0; k < validKeys.length; k++){',
        '            if (m.key(validKeys[k]).time <= time) activeIdx = k;',
        '            else break;',
        '        }',
        '        if (activeIdx === -1){',
        '            tNext = m.key(validKeys[0]).time;',
        '            dir = -1;',
        '            val = -dir * amp / Math.exp((tNext - time) * decay);',
        '            value + ' + vecOut + ';',
        '        }else{',
        '            t1 = m.key(validKeys[activeIdx]).time;',
        '            hasNext = (activeIdx + 1 < validKeys.length);',
        '            t2 = hasNext ? m.key(validKeys[activeIdx + 1]).time : (outPoint + 9999);',
        '            dir = (activeIdx % 2 === 0) ? -1 : 1;',
        '            val1 = dir * amp / Math.exp((time - t1) * decay);',
        '            val2 = hasNext ? (dir * amp / Math.exp((t2 - time) * decay)) : 0;',
        '            val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '            value + ' + vecOut + ';',
        '        }',
        '    }',
        '}'
      ].join('\n');

      nullLayer.expressions.scale = [
        'if (time < inPoint || time > outPoint){',
        '    value;',
        '}else{',
        '    m = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '    if (!m || m.numKeys === 0){',
        '        value;',
        '    }else{',
        '        validKeys = [];',
        '        for (i = 1; i <= m.numKeys; i++){',
        '            kt = m.key(i).time;',
        '            if (kt >= inPoint && kt <= outPoint) validKeys.push(i);',
        '        }',
        '        if (validKeys.length === 0){',
        '            value;',
        '        }else{',
        '            activeIdx = -1;',
        '            for (k = 0; k < validKeys.length; k++){',
        '                if (m.key(validKeys[k]).time <= time) activeIdx = k;',
        '                else break;',
        '            }',
        '            if (activeIdx === -1){',
        '                value;',
        '            }else{',
        '                sFlip = (activeIdx % 2 === 0) ? -100 : 100;',
        '                ' + scaleOut + ';',
        '            }',
        '        }',
        '    }',
        '}'
      ].join('\n');
    } else if (toolName === 'SCALE_BEAT') {
      activeProp = 'scale';
      nullLayer.effects.push(createSlider('Amp', 500, 0, 2000, 10, '%'));
      nullLayer.effects.push(createSlider('Decay', 20, 1, 100, 1, ''));

      nullLayer.expressions.scale = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    n = m.nearestKey(time).index;',
        '    if (m.key(n).time > time) {',
        '        t2 = m.key(n).time;',
        '        t1 = (n > 1) ? m.key(n-1).time : -99999;',
        '    } else {',
        '        t1 = m.key(n).time;',
        '        t2 = (n < m.numKeys) ? m.key(n+1).time : 99999;',
        '    }',
        '    val1 = (t1 >= inPoint && t1 <= outPoint) ? (amp / Math.exp((time - t1) * decay)) : 0;',
        '    val2 = (t2 >= inPoint && t2 <= outPoint) ? (amp / Math.exp((t2 - time) * decay)) : 0;',
        '    val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '    value + [val, val];',
        '}'
      ].join('\n');
    } else if (toolName === 'SCALE_OVERLAP') {
      activeProp = 'scale';
      nullLayer.effects.push(createSlider('Scale In', 0, -200, 500, 1, '%'));
      nullLayer.effects.push(createSlider('Scale Out', 20, -200, 500, 1, '%'));
      nullLayer.effects.push(createSlider('Overshoot', 20, 0, 100, 1, '%'));

      nullLayer.expressions.scale = [
        'function bezier(x1, y1, x2, y2, t) {',
        '    if (t <= 0) return 0;',
        '    if (t >= 1) return 1;',
        '    var p = t;',
        '    for (var i = 0; i < 8; i++) {',
        '        var omP = 1 - p;',
        '        var f = 3 * omP * omP * p * x1 + 3 * omP * p * p * x2 + p * p * p - t;',
        '        var df = 3 * omP * omP * x1 + 6 * omP * p * (x2 - x1) + 3 * p * p * (1 - x2);',
        '        if (Math.abs(df) < 1e-6) break;',
        '        p -= f / df;',
        '        p = Math.max(0, Math.min(1, p));',
        '    }',
        '    var omP = 1 - p;',
        '    return 3 * omP * omP * p * y1 + 3 * omP * p * p * y2 + p * p * p;',
        '}',
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'scaleIn = effect("Scale In")("ADBE Slider Control-0001");',
        'scaleOut = effect("Scale Out")("ADBE Slider Control-0001");',
        'overshoot = effect("Overshoot")("ADBE Slider Control-0001");',
        '',
        'if (time < inPoint || time > outPoint) {',
        '    value;',
        '} else if (m && m.numKeys > 0) {',
        '    n = m.nearestKey(time).index;',
        '    if (m.key(n).time > time) n--;',
        '    if (n > 0 && n < m.numKeys) {',
        '        t1 = m.key(n).time;',
        '        t2 = m.key(n+1).time;',
        '        dur = t2 - t1;',
        '        startVal = (n % 2 !== 0) ? scaleIn : scaleOut;',
        '        endVal = (n % 2 !== 0) ? scaleOut : scaleIn;',
        '        t = time - t1;',
        '        progress = Math.max(0, Math.min(1, t / dur));',
        '        yMult = overshoot / 20;',
        '        eased = bezier(0.4, -0.5 * yMult, 0.8, -0.5 * yMult, progress);',
        '        val = startVal + (endVal - startVal) * eased;',
        '        value + [val, val];',
        '    } else if (n >= m.numKeys) {',
        '        finalVal = (m.numKeys % 2 !== 0) ? scaleOut : scaleIn;',
        '        value + [finalVal, finalVal];',
        '    } else {',
        '        value + [scaleIn, scaleIn];',
        '    }',
        '} else {',
        '    value;',
        '}'
      ].join('\n');
    } else if (isPanning) {
      const isPos = (toolName === 'PANNING_POS' || toolName === 'PANNING_MIX_PR' || toolName === 'PANNING_MIX_ALL' || toolName === 'PANNING');
      const isRot = (toolName === 'PANNING_ROT' || toolName === 'PANNING_MIX_PR' || toolName === 'PANNING_MIX_ALL');
      const isScale = (toolName === 'PANNING_SCALE' || toolName === 'PANNING_MIX_ALL');

      const isMixPR = (toolName === 'PANNING_MIX_PR');
      const defaultFreq = isMixPR ? 7 : 1.5;
      const defaultPos = isMixPR ? 10 : 30;
      const defaultRot = isMixPR ? 1 : 5;
      const defaultScale = 10;

      nullLayer.effects.push(createSlider('Freq', defaultFreq, 0.1, 30, 0.1, ' Hz'));

      if (isPos) {
        nullLayer.effects.push(createSlider('Position', defaultPos, 0, 500, 1, ' px'));
        nullLayer.expressions.move = [
          'freq = effect("Freq")("ADBE Slider Control-0001");',
          'posAmp = effect("Position")("ADBE Slider Control-0001");',
          'if (time < inPoint || time > outPoint){',
          '    value;',
          '}else{',
          '    t = time * freq;',
          '    x = (Math.sin(t * 1.2) * 0.7 + Math.sin(t * 2.3) * 0.3) * posAmp;',
          '    y = (Math.cos(t * 0.9) * 0.7 + Math.sin(t * 1.7) * 0.3) * posAmp;',
          '    value + [x, y];',
          '}'
        ].join('\n');
        activeProp = 'move';
      }

      if (isRot) {
        nullLayer.effects.push(createSlider('Rotation', defaultRot, 0, 180, 0.5, '°'));
        nullLayer.expressions.rotate = [
          'freq = effect("Freq")("ADBE Slider Control-0001");',
          'rotAmp = effect("Rotation")("ADBE Slider Control-0001");',
          'if (time < inPoint || time > outPoint){',
          '    value;',
          '}else{',
          '    t = time * freq;',
          '    r = (Math.sin(t * 0.8 + 1.5) * 0.7 + Math.cos(t * 1.5) * 0.3) * rotAmp;',
          '    value + r;',
          '}'
        ].join('\n');
        if (!isPos) activeProp = 'rotate';
      }

      if (isScale) {
        nullLayer.effects.push(createSlider('Scale', defaultScale, 0, 200, 1, '%'));
        nullLayer.expressions.scale = [
          'freq = effect("Freq")("ADBE Slider Control-0001");',
          'scaleAmp = effect("Scale")("ADBE Slider Control-0001");',
          'if (time < inPoint || time > outPoint){',
          '    value;',
          '}else{',
          '    t = time * freq;',
          '    s = (Math.sin(t * 1.1) * 0.7 + Math.cos(t * 2.1) * 0.3) * scaleAmp;',
          '    value + [s, s];',
          '}'
        ].join('\n');
        if (!isPos && !isRot) activeProp = 'scale';
      }
    } else if (isIdleMove) {
      const scaleP1 = '[0, 55.8333, 0, 55.8333, 0, 55.8333, 0]';
      const glideP1 = 'bezier(0.343, -2.0 * yMult, 0.511, 1 + 1.0 * yMult, progress)';
      const scaleP2 = '[0, 19.1667, 59.1667, -19.9167, 52.5, -43.3333, 59.1667]';
      const glideP2 = 'bezier(0.532, -0.436 * yMult, 0.379, 1 + 0.415 * yMult, progress)';

      const idleSpecs = {
        IDLE_MOVE_1: { scaleSteps: scaleP1, glideEase: glideP1 },
        IDLE_MOVE_2: { scaleSteps: scaleP2, glideEase: glideP2 },
        IDLE_MOVE_3: {
          scaleSteps: scaleP1,
          glideEase: glideP1,
          posDefault: 45,
          stepX: '[0, -0.6, 0.55, -0.5, 0.6, -0.35]',
          stepY: '[0, -0.35, 0.4, 0.45, -0.35, -0.45]'
        },
        IDLE_MOVE_4: {
          scaleSteps: scaleP1,
          glideEase: glideP1,
          rotDefault: 5,
          stepRot: '[0, 1.0, -1.0, 0.75]'
        },
        IDLE_MOVE_5: {
          scaleSteps: scaleP2,
          glideEase: glideP2,
          posDefault: 45,
          stepX: '[0, 0.55, -0.6, 0.45, -0.5, 0.35]',
          stepY: '[0, -0.4, 0.35, -0.45, 0.4, -0.3]',
          rotDefault: 5,
          stepRot: '[0, -1.0, 1.0, -0.75]'
        },
        IDLE_MOVE_6: {
          scaleSteps: scaleP1,
          glideEase: glideP1,
          posDefault: 45,
          stepX: '[0, -0.6, 0.55, -0.5, 0.6, -0.35]',
          stepY: '[0, -0.35, 0.4, 0.45, -0.35, -0.45]',
          rotDefault: 5,
          stepRot: '[0, 1.0, -1.0, 0.75]'
        }
      };
      const spec = idleSpecs[toolName] || idleSpecs.IDLE_MOVE_1;
      activeProp = 'scale';

      nullLayer.effects.push(createSlider('Amp', 100, 0, 300, 1, '%'));
      if (spec.posDefault !== undefined) {
        nullLayer.effects.push(createSlider('Position', spec.posDefault, 0, 500, 1, ' px'));
      }
      if (spec.rotDefault !== undefined) {
        nullLayer.effects.push(createSlider('Rotation', spec.rotDefault, -45, 45, 0.5, '°'));
      }
      nullLayer.effects.push(createSlider('Overshoot', 100, 0, 200, 1, '%'));
      nullLayer.effects.push(createSlider('Skip Beats', 4, 0, 16, 1, ''));

      const bezierFnBlock = [
        'function bezier(x1, y1, x2, y2, t) {',
        '    if (t <= 0) return 0;',
        '    if (t >= 1) return 1;',
        '    var p = t;',
        '    for (var i = 0; i < 8; i++) {',
        '        var omP = 1 - p;',
        '        var f = 3 * omP * omP * p * x1 + 3 * omP * p * p * x2 + p * p * p - t;',
        '        var df = 3 * omP * omP * x1 + 6 * omP * p * (x2 - x1) + 3 * p * p * (1 - x2);',
        '        if (Math.abs(df) < 1e-6) break;',
        '        p -= f / df;',
        '        p = Math.max(0, Math.min(1, p));',
        '    }',
        '    var omP = 1 - p;',
        '    return 3 * omP * omP * p * y1 + 3 * omP * p * p * y2 + p * p * p;',
        '}'
      ];

      nullLayer.expressions.scale = [
        ...bezierFnBlock,
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'amp = effect("Amp")("ADBE Slider Control-0001") / 100;',
        'overshoot = effect("Overshoot")("ADBE Slider Control-0001");',
        'skipBeats = Math.max(0, Math.round(effect("Skip Beats")("ADBE Slider Control-0001")));',
        'yMult = overshoot / 100;',
        'cycleBeats = 6 + skipBeats;',
        'stepVals = ' + spec.scaleSteps + ';',
        '',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0) {',
        '    value;',
        '} else {',
        '    validKeys = [];',
        '    for (i = 1; i <= m.numKeys; i++) {',
        '        kt = m.key(i).time;',
        '        if (kt >= inPoint && kt <= outPoint) validKeys.push(i);',
        '    }',
        '    if (validKeys.length === 0) {',
        '        value;',
        '    } else {',
        '        beatTimes = [];',
        '        if (m.key(validKeys[0]).time > inPoint + 0.001) {',
        '            beatTimes.push(inPoint);',
        '        }',
        '        for (k = 0; k < validKeys.length; k++) {',
        '            beatTimes.push(m.key(validKeys[k]).time);',
        '        }',
        '        if (outPoint > beatTimes[beatTimes.length - 1] + 0.001) {',
        '            beatTimes.push(outPoint);',
        '        }',
        '        if (beatTimes.length < 2) {',
        '            beatTimes.push(outPoint);',
        '        }',
        '        bIdx = -1;',
        '        for (k = 0; k < beatTimes.length; k++) {',
        '            if (beatTimes[k] <= time) bIdx = k;',
        '            else break;',
        '        }',
        '        if (bIdx < 0) bIdx = 0;',
        '        cycleIdx = Math.floor(bIdx / cycleBeats);',
        '        rem = bIdx % cycleBeats;',
        '        stepIdx = (rem < 5) ? rem : 5;',
        '        startIdx = cycleIdx * cycleBeats + stepIdx;',
        '        endIdx = (stepIdx < 5) ? (startIdx + 1) : ((cycleIdx + 1) * cycleBeats);',
        '        if (startIdx < beatTimes.length) {',
        '            t1 = beatTimes[startIdx];',
        '            s0 = ((cycleIdx > 0 && stepIdx === 0) ? stepVals[6] : stepVals[stepIdx]) * amp;',
        '            s1 = stepVals[stepIdx + 1] * amp;',
        '            if (startIdx >= beatTimes.length - 1) {',
        '                val = s0;',
        '            } else {',
        '                t2 = (endIdx < beatTimes.length) ? beatTimes[endIdx] : beatTimes[beatTimes.length - 1];',
        '                dur = Math.max(0.0001, t2 - t1);',
        '                if (t2 <= t1 + 0.0001) {',
        '                    val = s0;',
        '                } else if (time >= t2) {',
        '                    val = s1;',
        '                } else {',
        '                    progress = Math.max(0, Math.min(1, (time - t1) / dur));',
        '                    eased = (stepIdx < 5)',
        '                        ? bezier(0.229, -0.924 * yMult, 0.77, -0.839 * yMult, progress)',
        '                        : ' + spec.glideEase + ';',
        '                    val = s0 + (s1 - s0) * eased;',
        '                }',
        '            }',
        '            value + [val, val];',
        '        } else {',
        '            value;',
        '        }',
        '    }',
        '}'
      ].join('\n');

      const buildSpacedEasyEaseExpr = (headerLines, calcLines, outExpr) => [
        ...bezierFnBlock,
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        ...headerLines,
        '',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0) {',
        '    value;',
        '} else {',
        '    validKeys = [];',
        '    for (i = 1; i <= m.numKeys; i++) {',
        '        kt = m.key(i).time;',
        '        if (kt >= inPoint && kt <= outPoint) validKeys.push(i);',
        '    }',
        '    if (validKeys.length === 0) {',
        '        value;',
        '    } else {',
        '        beatTimes = [];',
        '        if (m.key(validKeys[0]).time > inPoint + 0.001) {',
        '            beatTimes.push(inPoint);',
        '        }',
        '        for (k = 0; k < validKeys.length; k++) {',
        '            beatTimes.push(m.key(validKeys[k]).time);',
        '        }',
        '        if (outPoint > beatTimes[beatTimes.length - 1] + 0.001) {',
        '            beatTimes.push(outPoint);',
        '        }',
        '        if (beatTimes.length < 2) {',
        '            beatTimes.push(outPoint);',
        '        }',
        '        bIdx = -1;',
        '        for (k = 0; k < beatTimes.length; k++) {',
        '            if (beatTimes[k] <= time) bIdx = k;',
        '            else break;',
        '        }',
        '        if (bIdx < 0) bIdx = 0;',
        '        slotIdx = Math.floor(bIdx / 2);',
        '        startIdx = slotIdx * 2;',
        '        endIdx = startIdx + 2;',
        '        if (startIdx < beatTimes.length) {',
        '            t1 = beatTimes[startIdx];',
        '            canAnim = (startIdx < beatTimes.length - 1);',
        '            t2 = (endIdx < beatTimes.length) ? beatTimes[endIdx] : (canAnim ? beatTimes[beatTimes.length - 1] : outPoint);',
        '            dur = Math.max(0.0001, t2 - t1);',
        '            progress = canAnim ? Math.max(0, Math.min(1, (time - t1) / dur)) : 0;',
        '            eased = bezier(0.42, 0.0, 0.58, 1.0, progress);',
        ...calcLines,
        '            ' + outExpr + ';',
        '        } else {',
        '            value;',
        '        }',
        '    }',
        '}'
      ].join('\n');

      if (spec.stepX && spec.stepY) {
        const posExpr = buildSpacedEasyEaseExpr(
          [
            'posAmp = effect("Position")("ADBE Slider Control-0001");',
            'stepX = ' + spec.stepX + ';',
            'stepY = ' + spec.stepY + ';'
          ],
          [
            '        idx0 = slotIdx % stepX.length;',
            '        idx1 = (slotIdx + 1) % stepX.length;',
            '        x0 = stepX[idx0] * posAmp; x1 = stepX[idx1] * posAmp;',
            '        y0 = stepY[idx0] * posAmp; y1 = stepY[idx1] * posAmp;',
            '        dx = x0 + (x1 - x0) * eased;',
            '        dy = y0 + (y1 - y0) * eased;'
          ],
          'value + [dx, dy]'
        );
        nullLayer.expressions.move = posExpr;
        nullLayer.expressions.position = posExpr;
      }

      if (spec.stepRot) {
        const rotExpr = buildSpacedEasyEaseExpr(
          [
            'rotAmp = effect("Rotation")("ADBE Slider Control-0001");',
            'stepRot = ' + spec.stepRot + ';'
          ],
          [
            '        idx0 = slotIdx % stepRot.length;',
            '        idx1 = (slotIdx + 1) % stepRot.length;',
            '        r0 = stepRot[idx0] * rotAmp;',
            '        r1 = stepRot[idx1] * rotAmp;',
            '        rotVal = r0 + (r1 - r0) * eased;'
          ],
          'value + rotVal'
        );
        nullLayer.expressions.rotate = rotExpr;
        nullLayer.expressions.rotation = rotExpr;
        nullLayer.expressions.rotZ = rotExpr;
      }
    }

    nullLayer._defaultEasing = nullLayer.defaultEasing;
    ctx.layers.select(nullLayer.id);
    window.activeKeyframeProperty = activeProp;
    if (typeof window.invalidateEffectivePropsCache === 'function') {
      window.invalidateEffectivePropsCache();
    }
    ctx.project.commit('applyBeatNullTool', [nullLayer, targetLayer]);
    if (typeof window.switchLayerDrawerSubview === 'function') window.switchLayerDrawerSubview('effects');
    ctx.toast(`${nullName} applied`);

    return JSON.stringify({ error: false, message: `${nullName} applied`, nullLayerId: nullLayer.id, targetLayerId: targetLayer.id });
  },

  tools: {
    GHST(ctx) { return this.applyBeatGhostEffect(ctx); },
    WARP(ctx, customFrames) { return this.applyBeatWarpEffect(ctx, customFrames); },
    FISHEYE(ctx, scaleFactor) { return this.applyBeatFisheyeEffect(ctx, scaleFactor); },
    MIDWAVE(ctx) { return this.applyBeatMidwaveEffect(ctx); },
    HUESPIN(ctx) { return this.applyBeatHuespinEffect(ctx); },
    EXPO(ctx) { return this.applyBeatFlashEffect(ctx); },
    FLASH(ctx) { return this.applyBeatFlashEffect(ctx); },
    LENS(ctx, isRightClick) { return this.applyBeatBlurEffect(ctx, isRightClick); },
    BLUR(ctx, isRightClick) { return this.applyBeatBlurEffect(ctx, isRightClick); },
    PRESET_WARP1(ctx) { return this.applyPresetWarp1(ctx); },
    WARP1(ctx) { return this.applyPresetWarp1(ctx); },
    PRESET_WARP2(ctx) { return this.applyPresetWarp2(ctx); },
    WARP2(ctx) { return this.applyPresetWarp2(ctx); },
    PRESET_WARP3(ctx) { return this.applyPresetWarp2(ctx); },
    WARP3(ctx) { return this.applyPresetWarp2(ctx); },
    TRANS_FADE_IN(ctx) { return this.applyTransitionKeyframes(ctx, 'TRANS_FADE_IN'); },
    TRANS_FADE_OUT(ctx) { return this.applyTransitionKeyframes(ctx, 'TRANS_FADE_OUT'); },
    TRANS_SCALE_IN(ctx) { return this.applyTransitionKeyframes(ctx, 'TRANS_SCALE_IN'); },
    TRANS_SCALE_OUT(ctx) { return this.applyTransitionKeyframes(ctx, 'TRANS_SCALE_OUT'); },
    OSCILLATE(ctx) { return this.applyBeatNullTool(ctx, 'OSCILLATE'); },
    SHAKY(ctx) { return this.applyBeatNullTool(ctx, 'SHAKY'); },
    SWING(ctx) { return this.applyBeatNullTool(ctx, 'SWING'); },
    Y_BEAT(ctx) { return this.applyBeatNullTool(ctx, 'Y_BEAT'); },
    Y_FLIP(ctx) { return this.applyBeatNullTool(ctx, 'Y_FLIP'); },
    X_BEAT(ctx) { return this.applyBeatNullTool(ctx, 'X_BEAT'); },
    X_FLIP(ctx) { return this.applyBeatNullTool(ctx, 'X_FLIP'); },
    SCALE_BEAT(ctx) { return this.applyBeatNullTool(ctx, 'SCALE_BEAT'); },
    SCALE_OVERLAP(ctx) { return this.applyBeatNullTool(ctx, 'SCALE_OVERLAP'); },
    PANNING_POS(ctx) { return this.applyBeatNullTool(ctx, 'PANNING_POS'); },
    PANNING_ROT(ctx) { return this.applyBeatNullTool(ctx, 'PANNING_ROT'); },
    PANNING_SCALE(ctx) { return this.applyBeatNullTool(ctx, 'PANNING_SCALE'); },
    PANNING_MIX_PR(ctx) { return this.applyBeatNullTool(ctx, 'PANNING_MIX_PR'); },
    PANNING_MIX_ALL(ctx) { return this.applyBeatNullTool(ctx, 'PANNING_MIX_ALL'); },
    IDLE_MOVE_1(ctx) { return this.applyBeatNullTool(ctx, 'IDLE_MOVE_1'); },
    IDLE_MOVE_2(ctx) { return this.applyBeatNullTool(ctx, 'IDLE_MOVE_2'); },
    IDLE_MOVE_3(ctx) { return this.applyBeatNullTool(ctx, 'IDLE_MOVE_3'); },
    IDLE_MOVE_4(ctx) { return this.applyBeatNullTool(ctx, 'IDLE_MOVE_4'); },
    IDLE_MOVE_5(ctx) { return this.applyBeatNullTool(ctx, 'IDLE_MOVE_5'); },
    IDLE_MOVE_6(ctx) { return this.applyBeatNullTool(ctx, 'IDLE_MOVE_6'); }
  },

  // ============================================================================
  // 6. TAMPILAN UI EXTENSION CARD
  // ============================================================================
  build(ui, ctx) {
    const self = this;

    ui.section('Current Beat');
    ui.grid({ cols: 5 }, [
      ui.button({ label: 'GHOST', icon: 'auto_awesome_motion', title: 'Ghost Trail Effect', onClick() { self.applyBeatGhostEffect(ctx); } }),
      ui.button({ label: 'WARP', icon: 'waves', title: 'Wave Warp Hit', onClick() { self.applyBeatWarpEffect(ctx); } }),
      ui.button({ label: 'FISHEYE', icon: 'remove_red_eye', title: 'Fish Eye Ripple', onClick() { self.applyBeatFisheyeEffect(ctx); } }),
      ui.button({ label: 'MIDWAVE', icon: 'water_drop', title: 'Mid-Wave Impact', onClick() { self.applyBeatMidwaveEffect(ctx); } }),
      ui.button({ label: 'HUESPIN', icon: 'palette', title: 'Hue Spin Beat', onClick() { self.applyBeatHuespinEffect(ctx); } })
    ]);

    ui.section('Continuous Motion');
    ui.grid({ cols: 5 }, [
      ui.button({ label: 'FLASH', icon: 'flash_on', title: 'Exposure Flash', onClick() { self.applyBeatFlashEffect(ctx); } }),
      ui.button({ label: 'SHAKY', icon: 'vibration', title: 'Continuous Shaky Beat', onClick() { self.applyBeatNullTool(ctx, 'SHAKY'); } }),
      ui.button({
        label: 'BLUR',
        icon: 'blur_on',
        title: 'Fast Box Blur Beat (Left Click)',
        rightTitle: 'Lens Blur Beat (Right Click / Hold 2s)',
        onClick() { self.applyBeatBlurEffect(ctx, false); },
        onContextMenu() { self.applyBeatBlurEffect(ctx, true); }
      }),
      ui.button({ label: 'OSCILLATE', icon: 'wifi', title: 'Oscillate Bounce', onClick() { self.applyBeatNullTool(ctx, 'OSCILLATE'); } }),
      ui.button({ label: 'Y BEAT', icon: 'south', title: 'Vertical Y Beat', onClick() { self.applyBeatNullTool(ctx, 'Y_BEAT'); } }),
      ui.button({ label: 'Y FLIP', icon: 'swap_vert', title: 'Alternating Y Flip', onClick() { self.applyBeatNullTool(ctx, 'Y_FLIP'); } }),
      ui.button({ label: 'X BEAT', icon: 'east', title: 'Horizontal X Beat', onClick() { self.applyBeatNullTool(ctx, 'X_BEAT'); } }),
      ui.button({ label: 'X FLIP', icon: 'flip', title: 'Alternating X Flip', onClick() { self.applyBeatNullTool(ctx, 'X_FLIP'); } }),
      ui.button({ label: 'SCALE', icon: 'zoom_in', title: 'Scale Pulse Beat', onClick() { self.applyBeatNullTool(ctx, 'SCALE_BEAT'); } }),
      ui.button({ label: 'SWING', icon: '360', title: '360° Dynamic Swing', onClick() { self.applyBeatNullTool(ctx, 'SWING'); } })
    ]);

    ui.section('Panning');
    ui.grid({ cols: 5 }, [
      ui.button({ label: 'POSITION', icon: 'open_with', title: 'Panning Position', onClick() { self.applyBeatNullTool(ctx, 'PANNING_POS'); } }),
      ui.button({ label: 'ROTATION', icon: 'autorenew', title: 'Panning Rotation', onClick() { self.applyBeatNullTool(ctx, 'PANNING_ROT'); } }),
      ui.button({ label: 'SCALE', icon: 'aspect_ratio', title: 'Panning Scale', onClick() { self.applyBeatNullTool(ctx, 'PANNING_SCALE'); } }),
      ui.button({ label: 'MIX PR', icon: 'tune', title: 'Mix Pos & Rot', onClick() { self.applyBeatNullTool(ctx, 'PANNING_MIX_PR'); } }),
      ui.button({ label: 'MIX ALL', icon: 'widgets', title: 'Mix All (Pos, Rot, Scale)', onClick() { self.applyBeatNullTool(ctx, 'PANNING_MIX_ALL'); } })
    ]);

    ui.section('Idle Movement');
    ui.grid({ cols: 3 }, [
      ui.button({ label: 'PATTERN 1', icon: 'animation', title: 'Idle Movement 1: Scale Bounce', onClick() { self.applyBeatNullTool(ctx, 'IDLE_MOVE_1'); } }),
      ui.button({ label: 'PATTERN 2', icon: 'motion_photos_on', title: 'Idle Movement 2: Dynamic Scale', onClick() { self.applyBeatNullTool(ctx, 'IDLE_MOVE_2'); } }),
      ui.button({ label: 'SCALE + POS', icon: 'open_with', title: 'Idle Movement 3: Scale + Position 2D Drift', onClick() { self.applyBeatNullTool(ctx, 'IDLE_MOVE_3'); } }),
      ui.button({ label: 'SCALE + ROT', icon: 'rotate_right', title: 'Idle Movement 4: Scale + Rotation Swing', onClick() { self.applyBeatNullTool(ctx, 'IDLE_MOVE_4'); } }),
      ui.button({ label: 'POS + ROT', icon: 'explore', title: 'Idle Movement 5: Position 2D + Rotation Sway + Scale', onClick() { self.applyBeatNullTool(ctx, 'IDLE_MOVE_5'); } }),
      ui.button({ label: 'FULL COMBO', icon: 'auto_awesome_motion', title: 'Idle Movement 6: Dynamic Scale + Position 2D + Rotation', onClick() { self.applyBeatNullTool(ctx, 'IDLE_MOVE_6'); } })
    ]);

    ui.section('Presets');
    ui.grid({ cols: 2 }, [
      ui.button({ label: 'WARP 1', icon: 'waves', title: 'Warp Preset 1', onClick() { self.applyPresetWarp1(ctx); } }),
      ui.button({ label: 'WARP 2', icon: 'waves', title: 'Warp Preset 2', onClick() { self.applyPresetWarp2(ctx); } })
    ]);
  }
});
