/**
 * SHAPES: Vector (Pen / Bezier Path)
 * Modular plugin for OpenFishTools Studio
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  const KAPPA = 0.552284749831;

  function hasBezierHandles(p0, p1) {
    if (!p0 || !p1) return false;
    return (
      Math.abs(p0.outX || 0) > 0.01 ||
      Math.abs(p0.outY || 0) > 0.01 ||
      Math.abs(p1.inX || 0) > 0.01 ||
      Math.abs(p1.inY || 0) > 0.01
    );
  }

  /**
   * Evaluate a point at parameter t (0..1) along segment p0 -> p1
   */
  function evaluateVectorSegmentPoint(p0, p1, t = 0.5) {
    if (!p0 || !p1) return { x: 0, y: 0 };
    const u = 1 - t;
    if (!hasBezierHandles(p0, p1)) {
      return {
        x: Number((p0.x * u + p1.x * t).toFixed(2)),
        y: Number((p0.y * u + p1.y * t).toFixed(2))
      };
    }
    const x0 = p0.x || 0;
    const y0 = p0.y || 0;
    const x1 = x0 + (p0.outX || 0);
    const y1 = y0 + (p0.outY || 0);
    const x3 = p1.x || 0;
    const y3 = p1.y || 0;
    const x2 = x3 + (p1.inX || 0);
    const y2 = y3 + (p1.inY || 0);

    const uu = u * u;
    const uuu = uu * u;
    const tt = t * t;
    const ttt = tt * t;

    const x = uuu * x0 + 3 * uu * t * x1 + 3 * u * tt * x2 + ttt * x3;
    const y = uuu * y0 + 3 * uu * t * y1 + 3 * u * tt * y2 + ttt * y3;
    return {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2))
    };
  }

  /**
   * Subdivide segment p0 -> p1 at parameter t (0..1) using De Casteljau's algorithm.
   * Mutates p0.outX/Y and p1.inX/Y if curved, and returns the newly created midpoint.
   */
  function subdivideVectorSegment(p0, p1, t = 0.5) {
    if (!p0 || !p1) {
      const fallback = { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 };
      return { ...fallback, p0, p1, midPoint: fallback };
    }
    if (!hasBezierHandles(p0, p1)) {
      const mid = evaluateVectorSegmentPoint(p0, p1, t);
      const midPt = {
        x: mid.x,
        y: mid.y,
        inX: 0,
        inY: 0,
        outX: 0,
        outY: 0
      };
      return { ...midPt, p0, p1, midPoint: midPt };
    }

    const x0 = p0.x || 0, y0 = p0.y || 0;
    const x1 = x0 + (p0.outX || 0), y1 = y0 + (p0.outY || 0);
    const x3 = p1.x || 0, y3 = p1.y || 0;
    const x2 = x3 + (p1.inX || 0), y2 = y3 + (p1.inY || 0);

    const x01 = x0 + (x1 - x0) * t, y01 = y0 + (y1 - y0) * t;
    const x12 = x1 + (x2 - x1) * t, y12 = y1 + (y2 - y1) * t;
    const x23 = x2 + (x3 - x2) * t, y23 = y2 + (y3 - y2) * t;

    const x012 = x01 + (x12 - x01) * t, y012 = y01 + (y12 - y01) * t;
    const x123 = x12 + (x23 - x12) * t, y123 = y12 + (y23 - y12) * t;

    const mx = x012 + (x123 - x012) * t;
    const my = y012 + (y123 - y012) * t;

    p0.outX = Number((x01 - x0).toFixed(2));
    p0.outY = Number((y01 - y0).toFixed(2));
    p1.inX = Number((x23 - x3).toFixed(2));
    p1.inY = Number((y23 - y3).toFixed(2));

    const midPt = {
      x: Number(mx.toFixed(2)),
      y: Number(my.toFixed(2)),
      inX: Number((x012 - mx).toFixed(2)),
      inY: Number((y012 - my).toFixed(2)),
      outX: Number((x123 - mx).toFixed(2)),
      outY: Number((y123 - my).toFixed(2))
    };
    return { ...midPt, p0, p1, midPoint: midPt };
  }

  /**
   * Automatically generate smooth symmetric Bezier handles for a sharp point
   * when Curve Mode is activated so the point immediately becomes rounded.
   */
  function ensureVectorPointAutoCurve(points, pointIndex, closed = false) {
    const pts = Array.isArray(points) ? points : [];
    const n = pts.length;
    if (n === 0 || pointIndex < 0 || pointIndex >= n) return false;
    const pt = pts[pointIndex];
    if (!pt) return false;

    const hasExistingHandles =
      Math.hypot(Number(pt.inX) || 0, Number(pt.inY) || 0) > 0.5 ||
      Math.hypot(Number(pt.outX) || 0, Number(pt.outY) || 0) > 0.5;
    if (hasExistingHandles) return false;

    if (n === 1) {
      pt.outX = 48;
      pt.outY = 0;
      pt.inX = -48;
      pt.inY = 0;
      return true;
    }

    const hasPrev = (pointIndex > 0) || (closed && n >= 2);
    const hasNext = (pointIndex < n - 1) || (closed && n >= 2);
    const pPrev = hasPrev ? pts[(pointIndex - 1 + n) % n] : null;
    const pNext = hasNext ? pts[(pointIndex + 1) % n] : null;

    if (pPrev && pNext && n >= 3) {
      const vPrevX = (Number(pPrev.x) || 0) - (Number(pt.x) || 0);
      const vPrevY = (Number(pPrev.y) || 0) - (Number(pt.y) || 0);
      const vNextX = (Number(pNext.x) || 0) - (Number(pt.x) || 0);
      const vNextY = (Number(pNext.y) || 0) - (Number(pt.y) || 0);
      const dPrev = Math.hypot(vPrevX, vPrevY) || 80;
      const dNext = Math.hypot(vNextX, vNextY) || 80;
      const uPrevX = vPrevX / dPrev;
      const uPrevY = vPrevY / dPrev;
      const uNextX = vNextX / dNext;
      const uNextY = vNextY / dNext;

      let tx = uNextX - uPrevX;
      let ty = uNextY - uPrevY;
      const tLen = Math.hypot(tx, ty);
      if (tLen > 1e-3) {
        tx /= tLen;
        ty /= tLen;
      } else {
        tx = -uNextY;
        ty = uNextX;
      }

      const cross = uPrevX * uNextY - uPrevY * uNextX;
      if (Math.abs(cross) < 0.08) {
        // Collinear segment midpoint: angle handles ~35 deg so curve is immediately visible
        const cosA = 0.81915;
        const sinA = 0.57358;
        const rtx = tx * cosA - ty * sinA;
        const rty = tx * sinA + ty * cosA;
        tx = rtx;
        ty = rty;
      }

      const hLen = Math.max(20, Math.min(dPrev, dNext) * 0.38);
      pt.outX = Math.round(tx * hLen);
      pt.outY = Math.round(ty * hLen);
      pt.inX = -pt.outX;
      pt.inY = -pt.outY;
      return true;
    }

    const pOther = pNext || pPrev;
    if (!pOther) return false;
    const dirSign = pNext ? 1 : -1;
    const dx = ((Number(pOther.x) || 0) - (Number(pt.x) || 0)) * dirSign;
    const dy = ((Number(pOther.y) || 0) - (Number(pt.y) || 0)) * dirSign;
    const dist = Math.hypot(dx, dy) || 100;
    const ux = dx / dist;
    const uy = dy / dist;
    const nx = -uy;
    const ny = ux;
    const hLen = Math.max(24, dist * 0.38);
    const tx = ux * 0.7071 + nx * 0.7071;
    const ty = uy * 0.7071 + ny * 0.7071;
    pt.outX = Math.round(tx * hLen);
    pt.outY = Math.round(ty * hLen);
    pt.inX = -pt.outX;
    pt.inY = -pt.outY;
    return true;
  }

  /**
   * Convert any preset shape geometry into an array of editable VectorPoints
   */
  function buildVectorPointsFromPresetShape(shapeType, shapeProps = {}, sx = 300, sy = 300) {
    const rx = sx / 2;
    const ry = sy / 2;
    const type = String(shapeType || 'rectangle').toLowerCase();

    if (type === 'circle' || type === 'lingkaran') {
      const kx = Number((rx * KAPPA).toFixed(2));
      const ky = Number((ry * KAPPA).toFixed(2));
      return [
        { x: 0, y: -ry, inX: -kx, inY: 0, outX: kx, outY: 0 },
        { x: rx, y: 0, inX: 0, inY: -ky, outX: 0, outY: ky },
        { x: 0, y: ry, inX: kx, inY: 0, outX: -kx, outY: 0 },
        { x: -rx, y: 0, inX: 0, inY: ky, outX: 0, outY: -ky }
      ];
    }

    if (type === 'rectangle' || type === 'kotak' || type === 'capsule' || type === 'kapsul') {
      let r = (type === 'capsule' || type === 'kapsul')
        ? Math.min(rx, ry)
        : (Number(shapeProps.roundness) || 0);
      r = Math.max(0, Math.min(r, rx, ry));
      if (r <= 1) {
        return [
          { x: -rx, y: -ry, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: rx, y: -ry, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: rx, y: ry, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: -rx, y: ry, inX: 0, inY: 0, outX: 0, outY: 0 }
        ];
      }
      const kr = Number((r * KAPPA).toFixed(2));
      return [
        { x: -rx + r, y: -ry, inX: -kr, inY: 0, outX: 0, outY: 0 },
        { x: rx - r, y: -ry, inX: 0, inY: 0, outX: kr, outY: 0 },
        { x: rx, y: -ry + r, inX: 0, inY: -kr, outX: 0, outY: 0 },
        { x: rx, y: ry - r, inX: 0, inY: 0, outX: 0, outY: kr },
        { x: rx - r, y: ry, inX: kr, inY: 0, outX: 0, outY: 0 },
        { x: -rx + r, y: ry, inX: 0, inY: 0, outX: -kr, outY: 0 },
        { x: -rx, y: ry - r, inX: 0, inY: kr, outX: 0, outY: 0 },
        { x: -rx, y: -ry + r, inX: 0, inY: 0, outX: 0, outY: -kr }
      ];
    }

    if (type === 'triangle' || type === 'segitiga') {
      const step = Math.max(3, parseInt(shapeProps.step || shapeProps.steps, 10) || 3);
      if (step === 3) {
        return [
          { x: 0, y: -ry, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: rx, y: ry, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: -rx, y: ry, inX: 0, inY: 0, outX: 0, outY: 0 }
        ];
      }
      const pts = [];
      for (let i = 0; i < step; i++) {
        const a = -Math.PI / 2 + (i / step) * Math.PI * 2;
        pts.push({
          x: Number((Math.cos(a) * rx).toFixed(2)),
          y: Number((Math.sin(a) * ry).toFixed(2)),
          inX: 0, inY: 0, outX: 0, outY: 0
        });
      }
      return pts;
    }

    if (type === 'polygon' || type === 'poligon') {
      const sides = Math.max(3, parseInt(shapeProps.sides, 10) || 6);
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
        pts.push({
          x: Number((Math.cos(a) * rx).toFixed(2)),
          y: Number((Math.sin(a) * ry).toFixed(2)),
          inX: 0, inY: 0, outX: 0, outY: 0
        });
      }
      return pts;
    }

    if (type === 'star' || type === 'bintang') {
      const numPts = Math.max(3, parseInt(shapeProps.points, 10) || 5);
      let inR = Number(shapeProps.innerRadius);
      if (isNaN(inR) || inR <= 0) inR = 0.4;
      inR = Math.max(0.1, Math.min(0.9, inR));
      const total = numPts * 2;
      const pts = [];
      for (let i = 0; i < total; i++) {
        const a = -Math.PI / 2 + (i / total) * Math.PI * 2;
        const radRatio = (i % 2 === 0) ? 1.0 : inR;
        pts.push({
          x: Number((Math.cos(a) * rx * radRatio).toFixed(2)),
          y: Number((Math.sin(a) * ry * radRatio).toFixed(2)),
          inX: 0, inY: 0, outX: 0, outY: 0
        });
      }
      return pts;
    }

    if (type === 'heart' || type === 'hati') {
      return [
        { x: 0, y: Number((-ry * 0.42).toFixed(2)), inX: Number((-rx * 0.35).toFixed(2)), inY: Number((-ry * 0.55).toFixed(2)), outX: Number((rx * 0.35).toFixed(2)), outY: Number((-ry * 0.55).toFixed(2)) },
        { x: rx, y: Number((-ry * 0.22).toFixed(2)), inX: 0, inY: Number((-ry * 0.48).toFixed(2)), outX: 0, outY: Number((ry * 0.45).toFixed(2)) },
        { x: 0, y: Number((ry * 0.88).toFixed(2)), inX: Number((rx * 0.42).toFixed(2)), inY: Number((-ry * 0.28).toFixed(2)), outX: Number((-rx * 0.42).toFixed(2)), outY: Number((-ry * 0.28).toFixed(2)) },
        { x: -rx, y: Number((-ry * 0.22).toFixed(2)), inX: 0, inY: Number((ry * 0.45).toFixed(2)), outX: 0, outY: Number((-ry * 0.48).toFixed(2)) }
      ];
    }

    return [
      { x: -rx, y: -ry, inX: 0, inY: 0, outX: 0, outY: 0 },
      { x: rx, y: -ry, inX: 0, inY: 0, outX: 0, outY: 0 },
      { x: rx, y: ry, inX: 0, inY: 0, outX: 0, outY: 0 },
      { x: -rx, y: ry, inX: 0, inY: 0, outX: 0, outY: 0 }
    ];
  }

  function getVectorRawContourPoints(shapeProps = {}) {
    const pts = Array.isArray(shapeProps.points) ? shapeProps.points : [];
    if (pts.length === 0) return [];
    if (pts.length === 1) {
      const p0 = pts[0];
      return [{ x: Number(p0.x) || 0, y: Number(p0.y) || 0 }];
    }
    const contour = [];
    const segCount = (shapeProps.closed && pts.length >= 2) ? pts.length : (pts.length - 1);
    const stepsPerCurve = 12;

    for (let i = 0; i < segCount; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % pts.length];
      if (i === 0) {
        contour.push({ x: Number(p0.x) || 0, y: Number(p0.y) || 0 });
      }
      if (hasBezierHandles(p0, p1)) {
        for (let s = 1; s <= stepsPerCurve; s++) {
          const evalPt = evaluateVectorSegmentPoint(p0, p1, s / stepsPerCurve);
          contour.push({ x: evalPt.x, y: evalPt.y });
        }
      } else {
        contour.push({ x: Number(p1.x) || 0, y: Number(p1.y) || 0 });
      }
    }
    return contour;
  }

  function getVectorLocalBounds(shapeProps = {}) {
    const pts = Array.isArray(shapeProps.points) ? shapeProps.points : [];
    const rawStrokeW = (shapeProps.strokeWidth !== undefined) ? Number(shapeProps.strokeWidth) : 6;
    const strokeW = Math.max(0, isNaN(rawStrokeW) ? 6 : rawStrokeW);
    const halfStroke = strokeW / 2;

    if (pts.length === 0) {
      return {
        minX: -60,
        maxX: 60,
        minY: -60,
        maxY: 60,
        width: 120,
        height: 120,
        w: 120,
        h: 120,
        centerX: 0,
        centerY: 0,
        cx: 0,
        cy: 0,
        bufferW: 256,
        bufferH: 256
      };
    }

    const contour = getVectorRawContourPoints(shapeProps);
    let rawMinX = Infinity;
    let rawMaxX = -Infinity;
    let rawMinY = Infinity;
    let rawMaxY = -Infinity;
    for (let i = 0; i < contour.length; i++) {
      const cx = contour[i].x;
      const cy = contour[i].y;
      if (cx < rawMinX) rawMinX = cx;
      if (cx > rawMaxX) rawMaxX = cx;
      if (cy < rawMinY) rawMinY = cy;
      if (cy > rawMaxY) rawMaxY = cy;
    }

    let minX = rawMinX - halfStroke;
    let maxX = rawMaxX + halfStroke;
    let minY = rawMinY - halfStroke;
    let maxY = rawMaxY + halfStroke;

    if (maxX - minX < 16) {
      const midX = (minX + maxX) / 2;
      minX = midX - 8;
      maxX = midX + 8;
    }
    if (maxY - minY < 16) {
      const midY = (minY + maxY) / 2;
      minY = midY - 8;
      maxY = midY + 8;
    }

    const pad = Math.ceil(strokeW + 24);
    const maxAbsX = Math.max(Math.abs(minX), Math.abs(maxX)) + pad;
    const maxAbsY = Math.max(Math.abs(minY), Math.abs(maxY)) + pad;
    const bufferW = Math.max(64, Math.ceil(maxAbsX * 2));
    const bufferH = Math.max(64, Math.ceil(maxAbsY * 2));

    const w = Math.max(16, maxX - minX);
    const h = Math.max(16, maxY - minY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return {
      minX,
      maxX,
      minY,
      maxY,
      width: w,
      height: h,
      w,
      h,
      centerX: cx,
      centerY: cy,
      cx,
      cy,
      bufferW,
      bufferH
    };
  }

  function computeVectorPathTightBounds(shapeProps = {}) {
    return getVectorLocalBounds(shapeProps);
  }

  function syncVectorLayerBounds(layer, updateScale = true) {
    if (!layer || layer.type !== 'shape' || layer.shapeType !== 'vector') return null;
    if (!layer.shapeProps) layer.shapeProps = {};
    const vBounds = getVectorLocalBounds(layer.shapeProps);
    const signX = (layer.scaleW !== undefined && layer.scaleW < 0) ? -1 : 1;
    const signY = (layer.scaleH !== undefined && layer.scaleH < 0) ? -1 : 1;
    const tScaleX = (typeof layer.transformScaleX === 'number' && !isNaN(layer.transformScaleX) && Math.abs(layer.transformScaleX) > 0.0001)
      ? Math.abs(layer.transformScaleX)
      : 1.0;
    const tScaleY = (typeof layer.transformScaleY === 'number' && !isNaN(layer.transformScaleY) && Math.abs(layer.transformScaleY) > 0.0001)
      ? Math.abs(layer.transformScaleY)
      : 1.0;
    layer.transformScaleX = tScaleX;
    layer.transformScaleY = tScaleY;
    layer.shapeProps.sizeX = Math.max(16, Math.round(vBounds.width));
    layer.shapeProps.sizeY = Math.max(16, Math.round(vBounds.height));
    if (updateScale) {
      layer.scaleW = Number((vBounds.width * tScaleX * signX).toFixed(1));
      layer.scaleH = Number((vBounds.height * tScaleY * signY).toFixed(1));
    }
    layer.mediaWidth = layer.shapeProps.sizeX;
    layer.mediaHeight = layer.shapeProps.sizeY;
    layer._vectorBufferW = vBounds.bufferW;
    layer._vectorBufferH = vBounds.bufferH;
    return vBounds;
  }

  window.evaluateVectorSegmentPoint = evaluateVectorSegmentPoint;
  window.subdivideVectorSegment = subdivideVectorSegment;
  window.ensureVectorPointAutoCurve = ensureVectorPointAutoCurve;
  window.buildVectorPointsFromPresetShape = buildVectorPointsFromPresetShape;
  window.getVectorRawContourPoints = getVectorRawContourPoints;
  window.getVectorLocalBounds = getVectorLocalBounds;
  window.computeVectorPathTightBounds = computeVectorPathTightBounds;
  window.syncVectorLayerBounds = syncVectorLayerBounds;

  window.FishShapesRegistry.register({
    id: 'vector',
    aliases: ['vektor', 'pen', 'path'],
    name: 'Vector',
    title: 'Edit Vector',
    fticon: 'fticon-edit-vector',
    iconSvg:
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M10.5 3.5h3c.55 0 1 .45 1 1v3c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-3c0-.55.45-1 1-1zm.6 1.6v1.8h1.8V5.1h-1.8zm-8.6 11.4h3c.55 0 1 .45 1 1v3c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-3c0-.55.45-1 1-1zm.6 1.6v1.8h1.8v-1.8H3.1zm15.4-1.6h3c.55 0 1 .45 1 1v3c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-3c0-.55.45-1 1-1zm.6 1.6v1.8h1.8v-1.8h-1.8z"/>' +
      '<path d="M5.2 5.25H9.5v1.5H5.2v-1.5zm9.3 0h4.3v1.5h-4.3v-1.5z"/>' +
      '<circle cx="3.8" cy="6" r="2"/>' +
      '<circle cx="20.2" cy="6" r="2"/>' +
      '<path d="M3.15 16.5C3.6 10.6 6.8 6.6 9.5 5.65v1.9C7.55 8.4 5.25 11.65 4.85 16.5h-1.7zm17.7 0c-.45-5.9-3.65-9.9-6.35-10.85v1.9c1.95.85 4.25 4.1 4.65 8.95h1.7z"/>',
    defaultProps: {
      sizeX: 120,
      sizeY: 120,
      closed: false,
      points: []
    },
    controls: {
      size: false,
      roundness: false,
      step: false,
      star: false,
      vector: true
    },
    getContour(shapeProps = {}, sx = 120, sy = 120) {
      const pts = Array.isArray(shapeProps.points) ? shapeProps.points : [];
      const vBounds = getVectorLocalBounds(shapeProps);
      const scaleX = sx / Math.max(1, vBounds.width);
      const scaleY = sy / Math.max(1, vBounds.height);

      if (pts.length === 0 || pts.length === 1) {
        return [
          { x: vBounds.minX * scaleX, y: vBounds.minY * scaleY },
          { x: vBounds.maxX * scaleX, y: vBounds.minY * scaleY },
          { x: vBounds.maxX * scaleX, y: vBounds.maxY * scaleY },
          { x: vBounds.minX * scaleX, y: vBounds.maxY * scaleY }
        ];
      }

      const rawContour = getVectorRawContourPoints(shapeProps);
      return rawContour.map(pt => ({
        x: pt.x * scaleX,
        y: pt.y * scaleY
      }));
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0) {
      const pts = Array.isArray(shapeProps.points) ? shapeProps.points : [];
      if (pts.length === 0) return;

      if (pts.length === 1) {
        const p0 = pts[0];
        const px = cx + (Number(p0.x) || 0);
        const py = cy + (Number(p0.y) || 0);
        ctx.moveTo(px, py);
        ctx.lineTo(px + 0.01, py);
        return;
      }

      const first = pts[0];
      ctx.moveTo(cx + (Number(first.x) || 0), cy + (Number(first.y) || 0));

      const segCount = (shapeProps.closed && pts.length >= 2) ? pts.length : (pts.length - 1);
      for (let i = 0; i < segCount; i++) {
        const p0 = pts[i];
        const p1 = pts[(i + 1) % pts.length];
        const p1x = cx + (Number(p1.x) || 0);
        const p1y = cy + (Number(p1.y) || 0);

        if (hasBezierHandles(p0, p1)) {
          const cp1x = cx + (Number(p0.x) || 0) + (Number(p0.outX) || 0);
          const cp1y = cy + (Number(p0.y) || 0) + (Number(p0.outY) || 0);
          const cp2x = cx + (Number(p1.x) || 0) + (Number(p1.inX) || 0);
          const cp2y = cy + (Number(p1.y) || 0) + (Number(p1.inY) || 0);
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p1x, p1y);
        } else {
          ctx.lineTo(p1x, p1y);
        }
      }

      if (shapeProps.closed && pts.length >= 2) {
        ctx.closePath();
      }
    }
  });
})();
