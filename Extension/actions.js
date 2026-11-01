/**
 * OpenFishTools Extension - Actions Card (.js)
 * 100% Self-Contained Extension (UI + Precompose, Center, Overlap, Screenshot, Duplicate Logic)
 *
 * Cara Edit:
 * - Semua aksi cepat (Precomp, Center in Comp, Overlap, Screenshot PNG, Duplicate)
 *   berada langsung di dalam file ini dan dapat dimodifikasi dengan mudah.
 */
(function() {
  'use strict';

  function precomposeAction(ctx, autoCrop = false) {
    const host = ctx.getHost();
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = 'Pilih layer terlebih dahulu untuk membuat Precompose';
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }
    if (host && typeof host.precomposeSelectedLayers === 'function') {
      host.precomposeSelectedLayers(!!autoCrop, 'normal');
      ctx.showToast(autoCrop ? 'Precompose (Auto-Crop) dibuat' : 'Precompose dibuat');
    }
    return true;
  }

  function centerInCompAction(ctx) {
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = 'Pilih layer terlebih dahulu untuk memusatkan posisi';
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }
    const { width: baseW, height: baseH } = ctx.project.getDimensions();
    ctx.history.snapshot();

    targets.forEach(layer => {
      layer.posX = Number((baseW / 2).toFixed(2));
      layer.posY = Number((baseH / 2).toFixed(2));
      if (layer.normW) layer.normX = (layer.posX - (layer.normW * baseW) / 2) / baseW;
      if (layer.normH) layer.normY = (layer.posY - (layer.normH * baseH) / 2) / baseH;
      ctx.invalidateCache(layer);
    });

    ctx.project.commit('center');
    ctx.showToast('Layer dipusatkan ke tengah viewport');
    return true;
  }

  function overlapAction(ctx) {
    const host = ctx.getHost();
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = 'Pilih layer terlebih dahulu untuk menerapkan Overlap';
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }
    if (host && typeof host.applyKeyframeOverlap === 'function') {
      const res = host.applyKeyframeOverlap();
      if (res && res.error) {
        ctx.showToast(res.message || 'Gagal menerapkan Overlap', true);
        return res;
      }
    }
    return true;
  }

  function screenshotAction(ctx) {
    const host = ctx.getHost();
    if (host && typeof host.exportCurrentFrameAsPNG === 'function') {
      return host.exportCurrentFrameAsPNG();
    }
    const doc = (host && host.document) || (typeof document !== 'undefined' ? document : null);
    const canvas = doc && doc.getElementById('editor-active-canvas');
    if (!canvas) {
      ctx.showToast('Canvas tidak ditemukan untuk screenshot', true);
      return { error: true, message: 'Canvas tidak ditemukan' };
    }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = doc.createElement('a');
      a.download = `snapshot_${Date.now()}.png`;
      a.href = dataUrl;
      a.click();
      ctx.showToast('Frame snapshot berhasil disimpan!');
      return true;
    } catch (err) {
      ctx.showToast('Gagal mengambil screenshot: ' + err.message, true);
      return { error: true, message: err.message };
    }
  }

  function duplicateAction(ctx, deepArg) {
    const host = ctx.getHost();
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = 'Pilih layer terlebih dahulu untuk menduplikasi';
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }
    const isPrecomp = targets.some(l => l.type === 'precomp');
    if (isPrecomp && host && typeof host.duplicatePrecompLayer === 'function') {
      host.duplicatePrecompLayer(deepArg);
      ctx.showToast('Precompose berhasil diduplikasi');
    } else if (host && typeof host.duplicateSelectedLayers === 'function') {
      host.duplicateSelectedLayers();
      ctx.showToast('Layer berhasil diduplikasi');
    }
    return true;
  }

  Card({
    id: 'actions',
    name: 'Actions',
    icon: 'layers',
    description: 'PRECOMP, CENTER, OVERLAP, SHOT, DUP shortcut actions.',
    category: 'Tools',
    defaultEnabled: true,

    tools: {
      PRECOMP: (ctx) => precomposeAction(ctx, false),
      PRECOMP_AUTOCROP: (ctx) => precomposeAction(ctx, true),
      CENTER: centerInCompAction,
      CENTERINCOMP: centerInCompAction,
      OVERLAP: overlapAction,
      SCREENSHOT: screenshotAction,
      PNG: screenshotAction,
      DUP_COMP: duplicateAction,
      DUP: duplicateAction
    },

    build(ui, ctx) {
      ui.section('Quick Actions');

      ui.grid({ cols: 5 }, [
        ui.button({
          label: 'PRECOMP',
          icon: 'layers',
          title: 'Precompose selected layer(s)',
          rightTitle: 'Precompose & Auto-Crop to Bounds',
          onClick() { precomposeAction(ctx, false); },
          onContextMenu() { precomposeAction(ctx, true); }
        }),
        ui.button({
          label: 'CENTER',
          icon: 'filter_center_focus',
          title: 'Center Layer to Comp Viewport',
          onClick() { centerInCompAction(ctx); }
        }),
        ui.button({
          label: 'OVERLAP',
          icon: 'auto_awesome_motion',
          title: 'Sequence / Stagger Overlapping Layers',
          onClick() { overlapAction(ctx); }
        }),
        ui.button({
          label: 'SHOT',
          icon: 'camera_alt',
          title: 'Take frame snapshot screenshot',
          onClick() { screenshotAction(ctx); }
        }),
        ui.button({
          label: 'DUP',
          icon: 'file_copy',
          title: 'Duplicate composition with hierarchy',
          onClick() { duplicateAction(ctx); }
        })
      ]);
    }
  });
})();
