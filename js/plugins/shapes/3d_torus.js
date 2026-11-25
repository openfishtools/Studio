/**
 * SHAPES: 3D Torus (Donut / Ring)
 * Modular shape plugin for OpenFishTools Studio
 * Registered strictly under id: '3d_torus'
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: '3d_torus',
    aliases: ['torus_3d', 'donut_3d'],
    name: '3D Torus',
    title: '3D Torus',
    category: '3d',
    iconSvg: '<ellipse cx="12" cy="12" rx="9" ry="6" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="12" cy="12" rx="4" ry="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    defaultProps: {
      sizeX: 300,
      sizeY: 300,
      depth: 150
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
      const segs = 36;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
      }
      return pts;
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0, sx = 300, sy = 300) {
      const rx = Math.max(0.1, sx / 2);
      const ry = Math.max(0.1, sy / 2);
      const innerRx = rx * 0.45;
      const innerRy = ry * 0.45;
      // Outer ellipse clockwise
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2, false);
      // Inner ellipse counter-clockwise
      ctx.ellipse(cx, cy, innerRx, innerRy, 0, Math.PI * 2, 0, true);
    }
  });
})();
