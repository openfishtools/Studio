/**
 * OpenFishTools Extension - Velocity Card (.js)
 * 100% Self-Contained Extension (UI + Twixtor & Time Remap Beat-Synchronized Velocity Engine)
 *
 * Cara Edit Parameter Kecepatan:
 * - Ubah `VELOCITY_CONFIG.TWIXTOR_PEAK_SPEED` (default `1.0`) atau `TWIXTOR_VALLEY_SPEED` (default `0.2`)
 *   untuk mengatur seberapa cepat/lambat efek slow-mo di antara beat.
 * - Ubah `VELOCITY_CONFIG.TIME_REMAP_EASING` untuk mengatur kurva bezier Time Remap.
 */
(function() {
  'use strict';

  const VELOCITY_CONFIG = {
    FALLBACK_BEAT_STEP_SEC: 0.6,
    TWIXTOR_PEAK_SPEED: 1.0,
    TWIXTOR_VALLEY_SPEED: 0.2,
    TWIXTOR_EASING: [0.42, 0.0, 0.58, 1.0],
    TIME_REMAP_EASING: [0.20, 0.70, 0.80, 0.30]
  };

  function getSelectedOrFallbackLayers(ctx) {
    let selected = ctx.layers.getSelected();
    if (selected.length === 0) {
      const all = ctx.layers.getAll();
      const fallback = all.find(l => l && !l.hidden && l.type !== 'audio') || all[0];
      if (fallback) selected = [fallback];
    }
    return selected;
  }

  function getActiveBeatMarkers(ctx, layer, clipStart, clipEnd) {
    let markers = [];
    if (layer && Array.isArray(layer.markers) && layer.markers.length > 0) {
      markers = layer.markers.map(m => (typeof m === 'number' ? m : (m.time || 0)));
    }
    const compMarkers = ctx.timeline.getMarkers();
    if (compMarkers.length > 0) {
      const inRange = compMarkers.filter(b => b >= clipStart - 0.02 && b <= clipEnd + 0.02);
      markers = markers.concat(inRange);
    }

    let unique = Array.from(new Set(markers.map(m => Number(m.toFixed(3))))).sort((a, b) => a - b);
    unique = unique.filter(t => t >= clipStart - 0.02 && t <= clipEnd + 0.02);

    if (unique.length < 2) {
      unique = [];
      const step = VELOCITY_CONFIG.FALLBACK_BEAT_STEP_SEC;
      for (let t = clipStart; t <= clipEnd - 0.05; t += step) {
        unique.push(Number(t.toFixed(3)));
      }
      if (unique.length < 2) {
        unique = [
          Number(clipStart.toFixed(3)),
          Number(((clipStart + clipEnd) / 2).toFixed(3)),
          Number(clipEnd.toFixed(3))
        ];
      }
    }
    return unique;
  }

  function syncSpeedUI(ctx, activeProp, reason) {
    const host = ctx.getHost();
    if (host) {
      host.activeKeyframeProperty = activeProp;
      if (typeof host.syncSpeedControllerValues === 'function') host.syncSpeedControllerValues();
      if (typeof host.updateSpeedKeyframeBtnState === 'function') host.updateSpeedKeyframeBtnState();
      if (typeof host.updateTimelineKeyframeMarkersHighlight === 'function') host.updateTimelineKeyframeMarkersHighlight();
      if (typeof host.updateAllGraphBtnStates === 'function') host.updateAllGraphBtnStates();
    }
    ctx.project.commit(reason);
  }

  function applyTwixtorVelocity(ctx) {
    const selected = getSelectedOrFallbackLayers(ctx);
    if (selected.length === 0) {
      const msg = 'Please select at least one layer to apply Twixtor velocity.';
      ctx.showToast(msg, true);
      return { error: true, tool: 'Twixtor', type: 'warn', message: msg };
    }

    ctx.history.snapshot();
    const { pps } = ctx.project.getDimensions();

    selected.forEach(layer => {
      layer.speedMode = 'speed';
      layer.speedInterpolation = 'optical_flow';
      layer.speed = VELOCITY_CONFIG.TWIXTOR_PEAK_SPEED;

      const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
      const clipEnd = clipStart + clipDur;
      const markers = getActiveBeatMarkers(ctx, layer, clipStart, clipEnd);

      if (!layer.keyframes) layer.keyframes = {};
      const kfs = [];

      if (markers[0] > clipStart + 0.05) {
        kfs.push({
          time: Number(clipStart.toFixed(3)),
          value: { speed: VELOCITY_CONFIG.TWIXTOR_PEAK_SPEED },
          easing: [...VELOCITY_CONFIG.TWIXTOR_EASING]
        });
      }

      for (let i = 0; i < markers.length; i++) {
        const t = markers[i];
        kfs.push({
          time: Number(t.toFixed(3)),
          value: { speed: VELOCITY_CONFIG.TWIXTOR_PEAK_SPEED },
          easing: [...VELOCITY_CONFIG.TWIXTOR_EASING]
        });
        if (i < markers.length - 1) {
          const nextT = markers[i + 1];
          const midT = (t + nextT) / 2;
          kfs.push({
            time: Number(midT.toFixed(3)),
            value: { speed: VELOCITY_CONFIG.TWIXTOR_VALLEY_SPEED },
            easing: [...VELOCITY_CONFIG.TWIXTOR_EASING]
          });
        }
      }

      if (markers[markers.length - 1] < clipEnd - 0.05) {
        kfs.push({
          time: Number(clipEnd.toFixed(3)),
          value: { speed: VELOCITY_CONFIG.TWIXTOR_PEAK_SPEED },
          easing: [...VELOCITY_CONFIG.TWIXTOR_EASING]
        });
      }

      kfs.sort((a, b) => a.time - b.time);
      layer.keyframes.speed = kfs;
      ctx.invalidateCache(layer);
    });

    syncSpeedUI(ctx, 'speed', 'twixtor-velocity');
    ctx.showToast(`Twixtor Velocity Applied (${selected.length} layer${selected.length > 1 ? 's' : ''})`);
    return { error: false, message: 'Twixtor velocity applied' };
  }

  function applyTimeRemapVelocity(ctx) {
    const selected = getSelectedOrFallbackLayers(ctx);
    if (selected.length === 0) {
      const msg = 'Please select at least one layer to apply Time Remap velocity.';
      ctx.showToast(msg, true);
      return { error: true, tool: 'Time Remap', type: 'warn', message: msg };
    }

    ctx.history.snapshot();
    const { pps } = ctx.project.getDimensions();

    selected.forEach(layer => {
      layer.speedMode = 'time_remap';
      layer.speedInterpolation = 'optical_flow';

      const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
      const clipEnd = clipStart + clipDur;
      const srcOffset = layer.sourceOffsetSec || 0;
      const markers = getActiveBeatMarkers(ctx, layer, clipStart, clipEnd);

      if (!layer.keyframes) layer.keyframes = {};
      const kfs = [];
      const ease = VELOCITY_CONFIG.TIME_REMAP_EASING;

      if (markers[0] > clipStart + 0.05) {
        kfs.push({
          time: Number(clipStart.toFixed(3)),
          value: { timeRemap: Number(srcOffset.toFixed(3)) },
          easing: [...ease]
        });
      }

      for (let i = 0; i < markers.length; i++) {
        const t = markers[i];
        const sourceTime = srcOffset + (t - clipStart);
        kfs.push({
          time: Number(t.toFixed(3)),
          value: { timeRemap: Number(sourceTime.toFixed(3)) },
          easing: [...ease]
        });
      }

      if (markers[markers.length - 1] < clipEnd - 0.05) {
        kfs.push({
          time: Number(clipEnd.toFixed(3)),
          value: { timeRemap: Number((srcOffset + clipDur).toFixed(3)) },
          easing: [...ease]
        });
      }

      kfs.sort((a, b) => a.time - b.time);
      layer.keyframes.timeRemap = kfs;
      layer.timeRemap = srcOffset;
      ctx.invalidateCache(layer);
    });

    syncSpeedUI(ctx, 'timeRemap', 'timeremap-velocity');
    ctx.showToast(`Time Remap Velocity Applied (${selected.length} layer${selected.length > 1 ? 's' : ''})`);
    return { error: false, message: 'Time Remap velocity applied' };
  }

  Card({
    id: 'velocity',
    name: 'Velocity',
    icon: 'speed',
    description: 'TWIXTOR and Time Remapping (T-REMAP) speed workflows.',
    category: 'Tools',
    defaultEnabled: true,

    tools: {
      TWIX: applyTwixtorVelocity,
      TMRE: applyTimeRemapVelocity
    },

    build(ui, ctx) {
      ui.section('Speed Ramping');
      ui.grid({ cols: 2 }, [
        ui.button({
          label: 'TWIXTOR',
          icon: 'speed',
          title: 'Apply Twixtor speed effect setup',
          onClick() { applyTwixtorVelocity(ctx); }
        }),
        ui.button({
          label: 'T-REMAP',
          icon: 'update',
          title: 'Enable & Configure Time Remapping',
          onClick() { applyTimeRemapVelocity(ctx); }
        })
      ]);
    }
  });
})();
