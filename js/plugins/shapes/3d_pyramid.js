/**
 * SHAPES: 3D Pyramid (3D Triangle)
 * Modular shape plugin for OpenFishTools Studio
 * Registered strictly under id: '3d_pyramid'
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: '3d_pyramid',
    aliases: ['3d_triangle', 'pyramid_3d', 'piramida_3d'],
    name: '3D Pyramid',
    title: '3D Pyramid',
    category: '3d',
    iconSvg: '<path d="M12 2L3 18l9 4 9-4-9-16z M12 2v20 M3 18l9-7 9 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
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
        { x: rx, y: ry },
        { x: -rx, y: ry }
      ];
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0, sx = 300, sy = 300) {
      const rx = sx / 2;
      const ry = sy / 2;
      ctx.moveTo(cx, cy - ry);
      ctx.lineTo(cx + rx, cy + ry);
      ctx.lineTo(cx - rx, cy + ry);
      ctx.closePath();
    }
  });
})();
