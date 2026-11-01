/**
 * OpenFishTools Extension - Toolbox Card (.js)
 * 100% Self-Contained Extension (UI + Layer Operations, Layer Creators, Quick Effects & Cutefish Styles)
 *
 * Cara Edit:
 * - Bagian 1 (`freezeFrame`, `fitToComp`, `dropShadow`, `mirrorLayer`): Operasi transformasi & layer.
 * - Bagian 2 (`createLayer`): Pembuatan layer baru (Shape, Solid, Null, Camera, Adjustment, Text).
 * - Bagian 3 (`applyQuickEffect` & `applyCutefishStyle`): Penambahan efek instan pada layer terpilih.
 */
(function() {
  'use strict';

  // =========================================================================
  // 1. LAYER OPERATIONS (FREEZE, FIT, DROP SHADOW, MIRROR)
  // =========================================================================
  function freezeFrame(ctx) {
    const host = ctx.getHost();
    const selLayer = ctx.layers.getActive();
    if (!selLayer) {
      const msg = 'Please select a video or precompose layer first.';
      ctx.showToast(msg, true);
      return { error: true, tool: 'Freeze Frame', type: 'warn', message: msg };
    }
    if (selLayer.type !== 'video' && selLayer.type !== 'precomp') {
      const msg = 'Freeze Frame is only supported on video and precompose layers!';
      ctx.showToast(msg, true);
      return { error: true, tool: 'Freeze Frame', type: 'warn', message: msg };
    }
    if (host && typeof host.freezeFrameAtCurrentTime === 'function') {
      host.freezeFrameAtCurrentTime();
      return { error: false, message: 'Video frame frozen' };
    }
    const playheadSec = ctx.timeline.getCurrentTime();
    selLayer.freezeTime = playheadSec;
    selLayer.isFrozen = true;
    ctx.invalidateCache(selLayer);
    ctx.project.commit('freeze');
    ctx.showToast('Freeze Frame diterapkan');
    return { error: false, message: 'Video frame frozen' };
  }

  function fitToComp(ctx, stretchFull = false) {
    const selLayer = ctx.layers.getActive();
    if (!selLayer) {
      const msg = 'Pilih layer terlebih dahulu untuk Fit to Comp';
      ctx.showToast(msg, true);
      return { error: true, tool: 'Fit to Comp', type: 'warn', message: msg };
    }

    const { width: baseW, height: baseH } = ctx.project.getDimensions();
    ctx.history.snapshot();

    selLayer.posX = Math.round(baseW / 2);
    selLayer.posY = Math.round(baseH / 2);

    if (stretchFull) {
      // Right-click: Stretch full comp
      selLayer.scaleW = baseW;
      selLayer.scaleH = baseH;
    } else {
      // Left-click: Contain / preserve aspect ratio
      const natW = Math.abs(selLayer.mediaWidth || selLayer.scaleW || baseW);
      const natH = Math.abs(selLayer.mediaHeight || selLayer.scaleH || baseH);
      const fitScale = Math.min(baseW / natW, baseH / natH);
      selLayer.scaleW = Math.round(natW * fitScale);
      selLayer.scaleH = Math.round(natH * fitScale);
    }

    selLayer.normW = Number((Math.abs(selLayer.scaleW) / baseW).toFixed(4));
    selLayer.normH = Number((Math.abs(selLayer.scaleH) / baseH).toFixed(4));
    selLayer.normX = Number(((selLayer.posX - Math.abs(selLayer.scaleW) / 2) / baseW).toFixed(4));
    selLayer.normY = Number(((selLayer.posY - Math.abs(selLayer.scaleH) / 2) / baseH).toFixed(4));

    ctx.invalidateCache(selLayer);
    ctx.project.commit('fitToComp');
    ctx.showToast(stretchFull ? 'Fit to Comp (Stretch)' : 'Fit to Comp');
    return { error: false, message: 'Fitted to comp' };
  }

  function dropShadow(ctx) {
    const selLayer = ctx.layers.getActive();
    if (!selLayer) {
      const msg = 'Pilih layer terlebih dahulu untuk efek Drop Shadow';
      ctx.showToast(msg, true);
      return { error: true, tool: 'Drop Shadow', type: 'warn', message: msg };
    }

    ctx.effects.add('drop-shadow');
    if (Array.isArray(selLayer.effects)) {
      const dshFx = [...selLayer.effects].reverse().find(fx => fx.type === 'drop-shadow');
      if (dshFx) {
        dshFx.distance = 0;
        dshFx.blur = 25;
        dshFx.opacity = 75;
        dshFx.color = '#000000';
        dshFx.angle = 0;
      }
    }
    ctx.invalidateCache(selLayer);
    ctx.project.commit('dropShadow');
    ctx.showToast('Drop Shadow (Distance: 0)');
    return { error: false, message: 'Drop shadow applied' };
  }

  function mirrorLayer(ctx, isVertical = false) {
    const host = ctx.getHost();
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = 'Pilih layer terlebih dahulu untuk Mirror / Flip';
      ctx.showToast(msg, true);
      return { error: true, tool: 'Mirror', type: 'warn', message: msg };
    }

    const { width: baseW, height: baseH } = ctx.project.getDimensions();
    ctx.history.snapshot();

    targets.forEach(selLayer => {
      if (host && typeof host.setScaleLinked === 'function') {
        host.setScaleLinked(false, selLayer);
      } else {
        selLayer.isScaleLinked = false;
        selLayer.lockAspect = false;
      }

      if (selLayer.scaleW === undefined) {
        selLayer.scaleW = selLayer.normW !== undefined ? selLayer.normW * baseW : (selLayer.mediaWidth || baseW);
      }
      if (selLayer.scaleH === undefined) {
        selLayer.scaleH = selLayer.normH !== undefined ? selLayer.normH * baseH : (selLayer.mediaHeight || baseH);
      }

      selLayer._userResized = true;
      selLayer._userResizedManual = true;

      if (isVertical) {
        selLayer.scaleH = -selLayer.scaleH;
        if (selLayer.transformScaleY !== undefined) selLayer.transformScaleY = -selLayer.transformScaleY;
      } else {
        selLayer.scaleW = -selLayer.scaleW;
        if (selLayer.transformScaleX !== undefined) selLayer.transformScaleX = -selLayer.transformScaleX;
      }

      if (selLayer.keyframes && Array.isArray(selLayer.keyframes.scale) && selLayer.keyframes.scale.length > 0) {
        selLayer.keyframes.scale.forEach(kf => {
          if (kf && kf.value) {
            if (isVertical) {
              if (kf.value.scaleH !== undefined) kf.value.scaleH = -kf.value.scaleH;
            } else {
              if (kf.value.scaleW !== undefined) kf.value.scaleW = -kf.value.scaleW;
            }
          }
        });
      }

      ctx.invalidateCache(selLayer);
    });

    ctx.project.commit('mirror');
    const flipMsg = isVertical ? 'Mirror Vertical' : 'Mirror Horizontal';
    ctx.showToast(flipMsg);
    return { error: false, message: isVertical ? 'Flipped vertically' : 'Flipped horizontally' };
  }

  // =========================================================================
  // 2. LAYER CREATION SHORTCUTS (TXT, SHA, SOL, NUL, CAM, ADJ)
  // =========================================================================
  function getSelectedTimingOrNull(ctx) {
    const sel = ctx.layers.getActive();
    if (!sel) return { durationSec: null, startSec: null };
    return {
      durationSec: sel.durationSec !== undefined ? sel.durationSec : null,
      startSec: sel.startSec !== undefined ? sel.startSec : null
    };
  }

  function createLayer(ctx, type, extraArg = false) {
    const host = ctx.getHost();
    if (!host) return false;
    const timing = getSelectedTimingOrNull(ctx);

    switch (type) {
      case 'TXT':
        if (typeof host.addTextLayer === 'function') {
          return host.addTextLayer(timing.durationSec, timing.startSec);
        }
        break;
      case 'SHA':
        if (typeof host.addShapeLayer === 'function') {
          const l = host.addShapeLayer('rectangle', { durationSec: timing.durationSec, startSec: timing.startSec });
          ctx.showToast('Shape Layer baru dibuat');
          return l;
        }
        break;
      case 'SOL':
        if (typeof host.addSolidLayer === 'function') {
          const isBlack = extraArg === true;
          const newLayer = host.addSolidLayer(timing.durationSec, timing.startSec, isBlack);
          const msg = isBlack ? 'Black Solid created' : 'Solid created';
          ctx.showToast(msg);
          return newLayer;
        }
        break;
      case 'NUL':
        if (typeof host.addNullLayer === 'function') {
          const l = host.addNullLayer(extraArg === true, { durationSec: timing.durationSec, startSec: timing.startSec });
          ctx.showToast('Null Object baru dibuat');
          return l;
        }
        break;
      case 'CAM':
        if (typeof host.addCameraLayer === 'function') {
          const l = host.addCameraLayer(timing.durationSec, timing.startSec);
          ctx.showToast('Camera Layer baru dibuat');
          return l;
        }
        break;
      case 'ADJ':
        if (typeof host.addAdjustmentLayer === 'function') {
          const l = host.addAdjustmentLayer(timing.durationSec, timing.startSec);
          ctx.showToast('Adjustment Layer baru dibuat');
          return l;
        }
        break;
    }
    return true;
  }

  // =========================================================================
  // 3. QUICK EFFECTS & CUTEFISH STYLES
  // =========================================================================
  const QUICK_EFFECT_MAP = {
    FILL: 'fill',
    TINT: 'tint',
    BLUR: 'fast-box-blur',
    LUM: 'brightness-contrast',
    CURV: 'curve',
    HUE: 'hue-shift'
  };

  function applyQuickEffect(ctx, toolName, altMode = false) {
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = `Pilih layer terlebih dahulu untuk efek ${toolName}`;
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }
    let fxId = QUICK_EFFECT_MAP[toolName];
    if (toolName === 'BLUR' && altMode === true) {
      fxId = 'camera-lens-blur';
    }
    if (fxId) {
      ctx.effects.add(fxId);
      ctx.showToast(`Efek ${toolName} ditambahkan`);
    }
    return true;
  }

  function applyCutefishStyle(ctx, toolName) {
    const host = ctx.getHost();
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = `Pilih layer terlebih dahulu untuk Cutefish ${toolName}`;
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }

    const targetLayer = targets[0];
    const { startSec: inPoint, durationSec } = ctx.layers.getTiming(targetLayer);
    ctx.history.snapshot();

    switch (toolName) {
      case 'CF_COLORIZE': {
        const adj = (host && typeof host.addAdjustmentLayer === 'function') ? host.addAdjustmentLayer(durationSec, inPoint) : null;
        if (adj) {
          adj.name = 'CF Colorize';
          adj.effects = adj.effects || [];
          const tintFx = ctx.effects.createInstance('tint', 'Tint');
          if (tintFx) {
            tintFx.mapWhiteTo = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
            adj.effects.push(tintFx);
          }
          ctx.invalidateCache(adj);
          ctx.showToast('CF Colorize dibuat (Adjustment Layer)');
        }
        break;
      }
      case 'CF_SCANLINE': {
        const adj = (host && typeof host.addAdjustmentLayer === 'function') ? host.addAdjustmentLayer(durationSec, inPoint) : null;
        if (adj) {
          adj.name = 'CF Scanline';
          adj.effects = adj.effects || [];
          const scanFx = ctx.effects.createInstance('scanline', 'Scanline');
          if (scanFx) adj.effects.push(scanFx);
          ctx.invalidateCache(adj);
          ctx.showToast('CF Scanline dibuat (Adjustment Layer)');
        }
        break;
      }
      case 'CF_MONO': {
        const adj = (host && typeof host.addAdjustmentLayer === 'function') ? host.addAdjustmentLayer(durationSec, inPoint) : null;
        if (adj) {
          adj.name = 'CF Mono';
          adj.effects = adj.effects || [];
          const monoFx = ctx.effects.createInstance('mono', 'Black & White');
          if (monoFx) adj.effects.push(monoFx);
          ctx.invalidateCache(adj);
          ctx.showToast('CF Mono dibuat (Adjustment Layer)');
        }
        break;
      }
      case 'CF_STARBURST': {
        const sol = (host && typeof host.addSolidLayer === 'function') ? host.addSolidLayer(durationSec, inPoint) : null;
        if (sol) {
          sol.name = 'CF Starburst';
          sol.effects = sol.effects || [];
          const sbFx = ctx.effects.createInstance('star_burst', 'Star Burst');
          if (sbFx) sol.effects.push(sbFx);
          ctx.invalidateCache(sol);
          ctx.showToast('CF Starburst dibuat (Solid Layer)');
        }
        break;
      }
      case 'CF_GRID': {
        const sol = (host && typeof host.addSolidLayer === 'function') ? host.addSolidLayer(durationSec, inPoint) : null;
        if (sol) {
          sol.name = 'CF Grid';
          sol.effects = sol.effects || [];
          const gridFx = ctx.effects.createInstance('grid', 'Grid');
          if (gridFx) sol.effects.push(gridFx);
          ctx.invalidateCache(sol);
          ctx.showToast('CF Grid dibuat (Solid Layer)');
        }
        break;
      }
      case 'CF_RADIO': {
        const sol = (host && typeof host.addSolidLayer === 'function') ? host.addSolidLayer(durationSec, inPoint) : null;
        if (sol) {
          sol.name = 'CF Radio';
          sol.blendMode = 'screen';
          sol.effects = sol.effects || [];
          const radFx = ctx.effects.createInstance('radio_waves', 'Radio Waves');
          if (radFx) sol.effects.push(radFx);
          ctx.invalidateCache(sol);
          ctx.showToast('CF Radio dibuat (Solid Layer)');
        }
        break;
      }
      case 'CF_GLOW_AURA': {
        targets.forEach(l => {
          l.effects = l.effects || [];
          const fx = ctx.effects.createInstance('glow_aura', 'Glow Aura');
          if (fx) l.effects.push(fx);
          ctx.invalidateCache(l);
        });
        ctx.showToast('CF Glow Aura diterapkan pada layer');
        break;
      }
      case 'CF_SOLID_AURA': {
        targets.forEach(l => {
          l.effects = l.effects || [];
          const fx = ctx.effects.createInstance('solid_aura', 'Solid Aura');
          if (fx) l.effects.push(fx);
          ctx.invalidateCache(l);
        });
        ctx.showToast('CF Solid Aura diterapkan pada layer');
        break;
      }
      case 'CF_SHATTER_SIMPLE': {
        targets.forEach(l => {
          l.effects = l.effects || [];
          const fx = ctx.effects.createInstance('shatter', 'Shatter');
          if (fx) l.effects.push(fx);
          ctx.invalidateCache(l);
        });
        ctx.showToast('CF Shatter Simple diterapkan');
        break;
      }
      case 'CF_SHATTER_SLOW': {
        targets.forEach(l => {
          l.effects = l.effects || [];
          const fx = ctx.effects.createInstance('shatter', 'Shatter');
          if (fx) {
            fx.gravity = 0;
            l.effects.push(fx);
          }
          ctx.invalidateCache(l);
        });
        ctx.showToast('CF Shatter Slow diterapkan');
        break;
      }
      case 'CF_DROP_BEVEL': {
        targets.forEach(l => {
          l.effects = l.effects || [];
          const bev = ctx.effects.createInstance('bevel', 'Bevel');
          if (bev) l.effects.push(bev);
          const drop = ctx.effects.createInstance('drop_shadow', 'Drop Shadow');
          if (drop) l.effects.push(drop);
          ctx.invalidateCache(l);
        });
        ctx.showToast('CF Drop Bevel diterapkan');
        break;
      }
      default:
        return false;
    }

    ctx.project.commit('cutefish');
    return true;
  }

  Card({
    id: 'toolbox',
    name: 'Toolbox',
    icon: 'handyman',
    description: 'Layer (FRZ, FIT, DSH, MIR), Create (SHA, SOL, NUL, CAM, ADJ), Effects (FILL, TINT, BLUR, LUM, CURV, HUE).',
    category: 'Tools',
    defaultEnabled: true,

    tools: {
      FRZ: freezeFrame,
      FIT: fitToComp,
      DSH: dropShadow,
      MIR: mirrorLayer,
      TXT: (ctx) => createLayer(ctx, 'TXT'),
      SHA: (ctx) => createLayer(ctx, 'SHA'),
      SOL: (ctx, isBlack) => createLayer(ctx, 'SOL', isBlack),
      NUL: (ctx, linkSelected) => createLayer(ctx, 'NUL', linkSelected),
      CAM: (ctx) => createLayer(ctx, 'CAM'),
      ADJ: (ctx) => createLayer(ctx, 'ADJ'),
      FILL: (ctx) => applyQuickEffect(ctx, 'FILL'),
      TINT: (ctx) => applyQuickEffect(ctx, 'TINT'),
      BLUR: (ctx, lens) => applyQuickEffect(ctx, 'BLUR', lens),
      LUM: (ctx) => applyQuickEffect(ctx, 'LUM'),
      CURV: (ctx) => applyQuickEffect(ctx, 'CURV'),
      HUE: (ctx) => applyQuickEffect(ctx, 'HUE'),
      CF_COLORIZE: (ctx) => applyCutefishStyle(ctx, 'CF_COLORIZE'),
      CF_SCANLINE: (ctx) => applyCutefishStyle(ctx, 'CF_SCANLINE'),
      CF_MONO: (ctx) => applyCutefishStyle(ctx, 'CF_MONO'),
      CF_STARBURST: (ctx) => applyCutefishStyle(ctx, 'CF_STARBURST'),
      CF_GRID: (ctx) => applyCutefishStyle(ctx, 'CF_GRID'),
      CF_RADIO: (ctx) => applyCutefishStyle(ctx, 'CF_RADIO'),
      CF_GLOW_AURA: (ctx) => applyCutefishStyle(ctx, 'CF_GLOW_AURA'),
      CF_SOLID_AURA: (ctx) => applyCutefishStyle(ctx, 'CF_SOLID_AURA'),
      CF_SHATTER_SIMPLE: (ctx) => applyCutefishStyle(ctx, 'CF_SHATTER_SIMPLE'),
      CF_SHATTER_SLOW: (ctx) => applyCutefishStyle(ctx, 'CF_SHATTER_SLOW'),
      CF_DROP_BEVEL: (ctx) => applyCutefishStyle(ctx, 'CF_DROP_BEVEL')
    },

    build(ui, ctx) {
      ui.section('Layer');
      ui.grid({ cols: 4 }, [
        ui.button({ label: 'FRZ', icon: 'ac_unit', title: 'Freeze Frame', onClick() { freezeFrame(ctx); } }),
        ui.button({
          label: 'FIT',
          icon: 'fit_screen',
          title: 'Fit to Comp',
          rightTitle: 'Fit to Comp Width / Stretch',
          onClick() { fitToComp(ctx, false); },
          onContextMenu() { fitToComp(ctx, true); }
        }),
        ui.button({ label: 'DSH', icon: 'filter_drama', title: 'Drop Shadow', onClick() { dropShadow(ctx); } }),
        ui.button({
          label: 'MIR',
          icon: 'flip',
          title: 'Mirror Horizontal',
          rightTitle: 'Mirror Vertical',
          onClick() { mirrorLayer(ctx, false); },
          onContextMenu() { mirrorLayer(ctx, true); }
        })
      ]);

      ui.section('Create');
      ui.grid({ cols: 5 }, [
        ui.button({ label: 'SHA', icon: 'pentagon', title: 'New Shape Layer', onClick() { createLayer(ctx, 'SHA'); } }),
        ui.button({
          label: 'SOL',
          icon: 'rectangle',
          title: 'New Solid Layer (Random Color)',
          rightTitle: 'New Black Solid [0,0,0]',
          onClick() { createLayer(ctx, 'SOL', false); },
          onContextMenu() { createLayer(ctx, 'SOL', true); }
        }),
        ui.button({
          label: 'NUL',
          icon: 'control_camera',
          title: 'New Null Object',
          rightTitle: 'Create Null & Link Selected',
          onClick() { createLayer(ctx, 'NUL', false); },
          onContextMenu() { createLayer(ctx, 'NUL', true); }
        }),
        ui.button({ label: 'CAM', icon: 'videocam', title: 'New Camera', onClick() { createLayer(ctx, 'CAM'); } }),
        ui.button({ label: 'ADJ', icon: 'tune', title: 'New Adjustment Layer', onClick() { createLayer(ctx, 'ADJ'); } })
      ]);

      ui.section('Effects');
      ui.grid({ cols: 6 }, [
        ui.button({ label: 'FILL', icon: 'format_color_fill', title: 'Add Fill Effect', onClick() { applyQuickEffect(ctx, 'FILL'); } }),
        ui.button({ label: 'TINT', icon: 'gradient', title: 'Add Tint Effect', onClick() { applyQuickEffect(ctx, 'TINT'); } }),
        ui.button({
          label: 'BLUR',
          icon: 'blur_on',
          title: 'Add Fast Box Blur',
          rightTitle: 'Add Camera Lens Blur',
          onClick() { applyQuickEffect(ctx, 'BLUR', false); },
          onContextMenu() { applyQuickEffect(ctx, 'BLUR', true); }
        }),
        ui.button({ label: 'LUM', icon: 'contrast', title: 'Add Lumetri Color', onClick() { applyQuickEffect(ctx, 'LUM'); } }),
        ui.button({ label: 'CURV', icon: 'show_chart', title: 'Add Curves', onClick() { applyQuickEffect(ctx, 'CURV'); } }),
        ui.button({ label: 'HUE', icon: 'palette', title: 'Add Hue/Saturation', onClick() { applyQuickEffect(ctx, 'HUE'); } })
      ]);
    }
  });
})();
