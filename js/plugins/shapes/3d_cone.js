/**
 * SHAPES: 3D Cone (Kerucut)
 * Modular shape plugin for OpenFishTools Studio
 * Registered strictly under id: '3d_cone'
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: '3d_cone',
    aliases: ['cone_3d', 'kerucut_3d'],
    name: '3D Cone',
    title: '3D Cone',
    category: '3d',
    iconSvg: '<path d="M12 3L4 18.5c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5L12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><ellipse cx="12" cy="18.5" rx="8" ry="3" fill="none" stroke="currentColor" stroke-width="1.5"/>',
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
        { x: 0, y: -ry },
        { x: rx, y: ry * 0.7 },
        { x: 0, y: ry },
        { x: -rx, y: ry * 0.7 }
      ];
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0, sx = 300, sy = 300) {
      const rx = sx / 2;
      const ry = sy / 2;
      ctx.moveTo(cx, cy - ry);
      ctx.lineTo(cx + rx, cy + ry * 0.7);
      ctx.quadraticCurveTo(cx, cy + ry, cx - rx, cy + ry * 0.7);
      ctx.closePath();
    }
  });
})();
