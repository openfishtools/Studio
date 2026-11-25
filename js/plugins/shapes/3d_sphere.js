/**
 * SHAPES: 3D Sphere
 * Modular shape plugin for OpenFishTools Studio
 * Registered strictly under id: '3d_sphere'
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: '3d_sphere',
    aliases: ['sphere_3d', 'bola_3d'],
    name: '3D Sphere',
    title: '3D Sphere',
    category: '3d',
    iconSvg: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="12" cy="12" rx="9" ry="3.5" fill="none" stroke="currentColor" stroke-width="1.5"/><ellipse cx="12" cy="12" rx="3.5" ry="9" fill="none" stroke="currentColor" stroke-width="1.5"/>',
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
      const pts = [];
      const segs = 48;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
      }
      return pts;
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0, sx = 300, sy = 300) {
      const rx = Math.max(0.1, sx / 2);
      const ry = Math.max(0.1, sy / 2);
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    }
  });
})();
