/**
 * SHAPES: 3D Cylinder (Tabung)
 * Modular shape plugin for OpenFishTools Studio
 * Registered strictly under id: '3d_cylinder'
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: '3d_cylinder',
    aliases: ['cylinder_3d', 'tabung_3d'],
    name: '3D Cylinder',
    title: '3D Cylinder',
    category: '3d',
    iconSvg: '<ellipse cx="12" cy="6" rx="8" ry="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 6v12c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V6" fill="none" stroke="currentColor" stroke-width="1.8"/><ellipse cx="12" cy="18" rx="8" ry="3.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/>',
    defaultProps: {
      sizeX: 300,
      sizeY: 300,
      depth: 300
    },
    controls: {
      size: true,
      depth: true,
      roundness: false,
      step: false,
      star: false
    },
    getContour(shapeProps = {}, sx = 300, sy = 300) {
      const rx = sx / 2;
      const ry = sy / 2;
      return [
        { x: -rx, y: -ry },
        { x:  rx, y: -ry },
        { x:  rx, y:  ry },
        { x: -rx, y:  ry }
      ];
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0, sx = 300, sy = 300) {
      const rx = sx / 2;
      const ry = sy / 2;
      const capH = Math.min(ry * 0.4, 24);
      ctx.moveTo(cx - rx, cy - ry + capH);
      ctx.lineTo(cx - rx, cy + ry - capH);
      ctx.quadraticCurveTo(cx, cy + ry, cx + rx, cy + ry - capH);
      ctx.lineTo(cx + rx, cy - ry + capH);
      ctx.quadraticCurveTo(cx, cy - ry, cx - rx, cy - ry + capH);
      ctx.closePath();
    }
  });
})();
