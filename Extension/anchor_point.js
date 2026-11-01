/**
 * OpenFishTools Extension - Anchor Point (9-Point Grid) Card (.js)
 * 100% Self-Contained Extension (UI + Trigonometric Anchor Repositioning Algorithm)
 *
 * Cara Edit:
 * - Ubah daftar nama posisi di `ANCHOR_NAMES` jika ingin mengganti label notifikasi.
 * - Fungsi `applyAnchorPoint(ctx, posId)` menghitung titik tumpu baru (-w/2, 0, +w/2)
 *   dan mengkompensasi posisi X/Y berdasarkan sudut rotasi (cos/sin) agar layer tidak bergeser di layar.
 */
(function() {
  'use strict';

  const ANCHOR_NAMES = [
    'Top Left', 'Top Center', 'Top Right',
    'Middle Left', 'Center', 'Middle Right',
    'Bottom Left', 'Bottom Center', 'Bottom Right'
  ];

  function applyAnchorPoint(ctx, posId = 5) {
    const host = ctx.getHost();
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = 'Pilih layer terlebih dahulu untuk mengubah anchor point';
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }

    const pos = parseInt(posId, 10) || 5;
    const col = (pos - 1) % 3;            // 0: left, 1: center, 2: right
    const row = Math.floor((pos - 1) / 3); // 0: top, 1: middle, 2: bottom
    const posName = ANCHOR_NAMES[pos - 1] || 'Center';

    const { width: baseW, height: baseH } = ctx.project.getDimensions();
    ctx.history.snapshot();

    targets.forEach(layer => {
      if (host && typeof host.syncLayerWithEffectiveProps === 'function') {
        host.syncLayerWithEffectiveProps(layer);
      }

      let rawW = layer.scaleW;
      let rawH = layer.scaleH;
      if (rawW === undefined || rawH === undefined) {
        if (layer.type === 'text' && host && host.FishTextEngine && typeof host.FishTextEngine.getNaturalSize === 'function') {
          const nat = host.FishTextEngine.getNaturalSize(layer);
          const sx = (typeof layer.transformScaleX === 'number' && !isNaN(layer.transformScaleX)) ? layer.transformScaleX : 1.0;
          const sy = (typeof layer.transformScaleY === 'number' && !isNaN(layer.transformScaleY)) ? layer.transformScaleY : 1.0;
          if (rawW === undefined) rawW = (nat.width || 320) * sx;
          if (rawH === undefined) rawH = (nat.height || 100) * sy;
        } else if (layer.type === 'shape' && layer.shapeProps) {
          const sx = (typeof layer.transformScaleX === 'number' && !isNaN(layer.transformScaleX)) ? layer.transformScaleX : 1.0;
          const sy = (typeof layer.transformScaleY === 'number' && !isNaN(layer.transformScaleY)) ? layer.transformScaleY : 1.0;
          if (rawW === undefined) rawW = (Number(layer.shapeProps.sizeX) || 300) * sx;
          if (rawH === undefined) rawH = (Number(layer.shapeProps.sizeY) || 300) * sy;
        }
      }

      const w = rawW !== undefined ? Math.abs(rawW) : (layer.normW !== undefined ? Math.abs(layer.normW * baseW) : (layer.mediaWidth || 300));
      const h = rawH !== undefined ? Math.abs(rawH) : (layer.normH !== undefined ? Math.abs(layer.normH * baseH) : (layer.mediaHeight || 300));
      const signX = (rawW !== undefined && rawW < 0) ? -1 : 1;
      const signY = (rawH !== undefined && rawH < 0) ? -1 : 1;

      let newAx = 0;
      let newAy = 0;
      if (col === 0) newAx = -w / 2;
      else if (col === 1) newAx = 0;
      else if (col === 2) newAx = w / 2;

      if (row === 0) newAy = -h / 2;
      else if (row === 1) newAy = 0;
      else if (row === 2) newAy = h / 2;

      const oldAx = layer.anchorX || 0;
      const oldAy = layer.anchorY || 0;
      const dAx = (newAx - oldAx) * signX;
      const dAy = (newAy - oldAy) * signY;

      const curRot = layer.rotZ !== undefined ? layer.rotZ : (layer.rotation || 0);
      const rad = (curRot * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const curPosX = layer.posX !== undefined ? layer.posX : (baseW / 2);
      const curPosY = layer.posY !== undefined ? layer.posY : (baseH / 2);

      const newPosX = curPosX - (dAx * (1 - cos) + dAy * sin);
      const newPosY = curPosY - (dAy * (1 - cos) - dAx * sin);
      const deltaPosX = newPosX - curPosX;
      const deltaPosY = newPosY - curPosY;

      layer.anchorX = Number(newAx.toFixed(2));
      layer.anchorY = Number(newAy.toFixed(2));
      layer.posX = Number(newPosX.toFixed(2));
      layer.posY = Number(newPosY.toFixed(2));

      if (layer.keyframes && Array.isArray(layer.keyframes.move) && layer.keyframes.move.length > 0) {
        layer.keyframes.move.forEach(kf => {
          if (kf && kf.value && typeof kf.value === 'object') {
            kf.value.anchorX = layer.anchorX;
            kf.value.anchorY = layer.anchorY;
            if (kf.value.posX !== undefined) kf.value.posX = Number((kf.value.posX + deltaPosX).toFixed(2));
            if (kf.value.posY !== undefined) kf.value.posY = Number((kf.value.posY + deltaPosY).toFixed(2));
          }
        });
      }

      if (layer.normW) layer.normX = (layer.posX - (layer.normW * baseW) / 2) / baseW;
      if (layer.normH) layer.normY = (layer.posY - (layer.normH * baseH) / 2) / baseH;

      ctx.invalidateCache(layer);
    });

    ctx.project.commit('setAnchorPoint');
    ctx.showToast(`Anchor Point: ${posName}`);
    return true;
  }

  Card({
    id: 'anchor_point',
    name: 'Anchor Point',
    icon: 'control_camera',
    description: 'Memindahkan titik tumpu layer secara instan (9-Point Grid) tanpa menggeser layer.',
    category: 'Tools',
    defaultEnabled: true,

    tools: {
      setAnchorPoint: applyAnchorPoint
    },

    build(ui, ctx) {
      ui.section('Anchor Position', '9-Point Grid');
      ui.anchorGrid({
        onSelect(posId) {
          applyAnchorPoint(ctx, posId);
        }
      });
    }
  });
})();
