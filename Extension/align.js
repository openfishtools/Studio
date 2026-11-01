/**
 * OpenFishTools Extension - Align Card (.js)
 * 100% Self-Contained Extension (UI + 6-Way Layer Alignment Algorithm)
 *
 * Cara Edit:
 * - Tambahkan atau modifikasi mode perataan di `ALIGN_MODES` dan fungsi `alignLayers(ctx, mode)`.
 */
(function() {
  'use strict';

  const ALIGN_LABELS = {
    ALIGN_LEFT: 'Align Left',
    ALIGN_HCENTER: 'Align Horizontal Center',
    ALIGN_RIGHT: 'Align Right',
    ALIGN_TOP: 'Align Top',
    ALIGN_VCENTER: 'Align Vertical Center',
    ALIGN_BOTTOM: 'Align Bottom'
  };

  function alignLayers(ctx, mode) {
    const host = ctx.getHost();
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = 'Pilih layer terlebih dahulu untuk perataan (Align)';
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }

    const { width: baseW, height: baseH } = ctx.project.getDimensions();
    ctx.history.snapshot();

    targets.forEach(layer => {
      if (host && typeof host.syncLayerWithEffectiveProps === 'function') {
        host.syncLayerWithEffectiveProps(layer);
      }

      const w = layer.scaleW !== undefined ? Math.abs(layer.scaleW) : (layer.normW !== undefined ? Math.abs(layer.normW * baseW) : (layer.mediaWidth || 300));
      const h = layer.scaleH !== undefined ? Math.abs(layer.scaleH) : (layer.normH !== undefined ? Math.abs(layer.normH * baseH) : (layer.mediaHeight || 300));

      if (mode === 'ALIGN_LEFT') layer.posX = Number((w / 2).toFixed(2));
      else if (mode === 'ALIGN_HCENTER') layer.posX = Number((baseW / 2).toFixed(2));
      else if (mode === 'ALIGN_RIGHT') layer.posX = Number((baseW - w / 2).toFixed(2));
      else if (mode === 'ALIGN_TOP') layer.posY = Number((h / 2).toFixed(2));
      else if (mode === 'ALIGN_VCENTER') layer.posY = Number((baseH / 2).toFixed(2));
      else if (mode === 'ALIGN_BOTTOM') layer.posY = Number((baseH - h / 2).toFixed(2));

      if (layer.normW) layer.normX = (layer.posX - (layer.normW * baseW) / 2) / baseW;
      if (layer.normH) layer.normY = (layer.posY - (layer.normH * baseH) / 2) / baseH;

      if (host && typeof host.recordLayerPropertyChange === 'function') {
        host.recordLayerPropertyChange(layer, 'move');
      }
      ctx.invalidateCache(layer);
    });

    ctx.project.commit('align');
    ctx.showToast(ALIGN_LABELS[mode] || 'Layer diratakan');
    return true;
  }

  Card({
    id: 'align',
    name: 'Align',
    icon: 'format_align_center',
    description: '6 tombol perataan layer (LEFT, H-MID, RIGHT, TOP, V-MID, BOTTOM).',
    category: 'Tools',
    defaultEnabled: true,

    tools: {
      ALIGN_LEFT: (ctx) => alignLayers(ctx, 'ALIGN_LEFT'),
      ALIGN_HCENTER: (ctx) => alignLayers(ctx, 'ALIGN_HCENTER'),
      ALIGN_RIGHT: (ctx) => alignLayers(ctx, 'ALIGN_RIGHT'),
      ALIGN_TOP: (ctx) => alignLayers(ctx, 'ALIGN_TOP'),
      ALIGN_VCENTER: (ctx) => alignLayers(ctx, 'ALIGN_VCENTER'),
      ALIGN_BOTTOM: (ctx) => alignLayers(ctx, 'ALIGN_BOTTOM')
    },

    build(ui, ctx) {
      ui.section('Layer Alignment');

      ui.grid({ cols: 3 }, [
        ui.button({
          label: 'LEFT',
          icon: 'align_horizontal_left',
          title: 'Align Left',
          onClick() { alignLayers(ctx, 'ALIGN_LEFT'); }
        }),
        ui.button({
          label: 'H-MID',
          icon: 'align_horizontal_center',
          title: 'Align Horizontal Center',
          onClick() { alignLayers(ctx, 'ALIGN_HCENTER'); }
        }),
        ui.button({
          label: 'RIGHT',
          icon: 'align_horizontal_right',
          title: 'Align Right',
          onClick() { alignLayers(ctx, 'ALIGN_RIGHT'); }
        }),
        ui.button({
          label: 'TOP',
          icon: 'align_vertical_top',
          title: 'Align Top',
          onClick() { alignLayers(ctx, 'ALIGN_TOP'); }
        }),
        ui.button({
          label: 'V-MID',
          icon: 'align_vertical_center',
          title: 'Align Vertical Center',
          onClick() { alignLayers(ctx, 'ALIGN_VCENTER'); }
        }),
        ui.button({
          label: 'BOTTOM',
          icon: 'align_vertical_bottom',
          title: 'Align Bottom',
          onClick() { alignLayers(ctx, 'ALIGN_BOTTOM'); }
        })
      ]);
    }
  });
})();
