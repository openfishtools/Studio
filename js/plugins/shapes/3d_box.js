/**
 * SHAPES: 3D Box
 * Modular shape plugin for OpenFishTools Studio
 * Registered strictly under id: '3d_box' without aliases
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: '3d_box',
    aliases: [],
    name: '3D Box',
    title: '3D Box',
    category: '3d',
    iconSvg: '<path d="M12 2L3 7v10l9 5 9-5V7l-9-5z M12 4.2l6.8 3.8-3.4 1.9-6.8-3.8 3.4-1.9z M5 8.6l6 3.4v6.8l-6-3.4V8.6z M13 18.8v-6.8l6-3.4v6.8l-6 3.4z"/>',
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
      ctx.rect(cx - rx, cy - ry, sx, sy);
    }
  });
})();
