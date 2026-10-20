/**
 * OpenFishTools Studio — Canvas Overlay Engine
 * Draws UI overlays (grid, wireframe, motion path, snap guides)
 * onto a dedicated transparent overlay canvas layered ABOVE the main render canvas.
 * These overlays are NEVER cached, NEVER exported — pure UI feedback.
 */
(function() {
  'use strict';

  const CanvasOverlay = {
    _canvas: null,
    _ctx: null,
    _rafId: null,
    _dirty: false,

    /**
     * Initialize overlay canvas — call once after DOM ready.
     * overlayCanvas: the <canvas id="editor-overlay-canvas"> element
     */
    init(overlayCanvas) {
      if (!overlayCanvas) return;
      this._canvas = overlayCanvas;
      this._ctx = overlayCanvas.getContext('2d', { alpha: true });
      // Sync size to match main canvas physical size
      this.syncSize();
      window.addEventListener('resize', () => this.syncSize(), { passive: true });
    },

    _lastTheme: null,
    _cachedPrimary: null,
    _cachedBgCanvas: null,
    _dprScale: 1,

    _getThemeColors() {
      const curTheme = (document.documentElement && document.documentElement.getAttribute('data-theme')) || 'default';
      if (this._lastTheme !== curTheme || !this._cachedPrimary || !this._cachedBgCanvas) {
        this._lastTheme = curTheme;
        const style = getComputedStyle(document.documentElement);
        this._cachedPrimary = style.getPropertyValue('--color-primary').trim() || '#98ce7b';
        this._cachedBgCanvas = style.getPropertyValue('--bg-canvas').trim() || '#0d1109';
      }
      return { primary: this._cachedPrimary, bg: this._cachedBgCanvas };
    },

    syncSize() {
      if (!this._canvas) return;
      const main = document.getElementById('editor-active-canvas');
      if (!main) return;
      if (this._canvas.width !== main.width || this._canvas.height !== main.height || !this._dprScale) {
        this._canvas.width = main.width;
        this._canvas.height = main.height;
        const rect = this._canvas.getBoundingClientRect ? this._canvas.getBoundingClientRect() : null;
        this._dprScale = (rect && rect.width > 0) ? (this._canvas.width / rect.width) : (window.devicePixelRatio || 1);
      }
    },

    /** Request a redraw on next rAF — debounced */
    scheduleRedraw() {
      this._dirty = true;
      if (this._rafId) return;
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        if (this._dirty) {
          this._dirty = false;
          this.redraw();
        }
      });
    },

    /** Immediate synchronous clear of overlay elements (preserving grid if enabled) */
    clear() {
      if (!this._ctx || !this._canvas) return;
      this.syncSize();
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      this._drawGrid(this._ctx, this._canvas.width, this._canvas.height);
    },

    /** Immediate synchronous redraw */
    redraw() {
      if (!this._ctx || !this._canvas) return;
      this.syncSize();
      const ctx = this._ctx;
      const w = this._canvas.width;
      const h = this._canvas.height;
      if (!w || !h) return;

      ctx.clearRect(0, 0, w, h);

      this._drawGrid(ctx, w, h);
      this._drawWireframes(ctx, w, h);
      this._drawVectorEditorOverlay(ctx, w, h);
      this._drawMotionPath(ctx, w, h);
      this._drawSnapGuides(ctx, w, h);
    },

    _drawGrid(ctx, w, h) {
      const gridBtn = document.getElementById('editor-icon-grid');
      if (!gridBtn || !gridBtn.classList.contains('is-active')) return;

      ctx.save();
      const cx = w / 2;
      const cy = h / 2;
      const baseLineWidth = Math.max(1, Math.round(w / 1200));
      const themePrimary = this._getThemeColors().primary;

      // Quarter grid lines
      ctx.lineWidth = baseLineWidth;
      ctx.strokeStyle = themePrimary;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.moveTo(w * 0.25, 0); ctx.lineTo(w * 0.25, h);
      ctx.moveTo(w * 0.75, 0); ctx.lineTo(w * 0.75, h);
      ctx.moveTo(0, h * 0.25); ctx.lineTo(w, h * 0.25);
      ctx.moveTo(0, h * 0.75); ctx.lineTo(w, h * 0.75);
      ctx.stroke();

      // Center axes
      ctx.lineWidth = Math.max(1.5, baseLineWidth * 1.6);
      ctx.strokeStyle = themePrimary;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
      ctx.moveTo(0, cy); ctx.lineTo(w, cy);
      ctx.stroke();

      // Center crosshair
      const crossSize = Math.max(12, Math.round(Math.min(w, h) * 0.035));
      ctx.lineWidth = Math.max(2, baseLineWidth * 2.2);
      ctx.strokeStyle = themePrimary;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(cx - crossSize, cy); ctx.lineTo(cx + crossSize, cy);
      ctx.moveTo(cx, cy - crossSize); ctx.lineTo(cx, cy + crossSize);
      ctx.stroke();

      ctx.restore();
    },

    _getProjectBaseDims(fallbackW, fallbackH) {
      const proj = window.currentProjectState || {};
      const aspect = proj.aspectRatio || '16:9';
      const res = proj.resolution || '1080p';
      let baseDims = window.getProjectDimensions(res, aspect);
      if (window.currentActivePrecomp) {
        const cw = Math.round(Math.abs(window.currentActivePrecomp.mediaWidth || window.currentActivePrecomp.scaleW || baseDims[0]));
        const ch = Math.round(Math.abs(window.currentActivePrecomp.mediaHeight || window.currentActivePrecomp.scaleH || baseDims[1]));
        baseDims = [cw, ch];
      }
      const baseW = proj._baseW || proj.width || baseDims[0] || fallbackW;
      const baseH = proj._baseH || proj.height || baseDims[1] || fallbackH;
      return { baseW, baseH };
    },

    _drawSnapGuides(ctx, w, h) {
      if (!window.activeSnapGuides) return;
      const { baseW, baseH } = this._getProjectBaseDims(w, h);
      const themePrimary = this._getThemeColors().primary;

      ctx.save();
      ctx.strokeStyle = themePrimary;
      ctx.setLineDash([8, 4]);
      ctx.lineWidth = 1;

      if (window.activeSnapGuides.x != null) {
        const gx = window.activeSnapGuides.x * (w / baseW);
        ctx.beginPath();
        ctx.moveTo(gx, 0); ctx.lineTo(gx, h);
        ctx.stroke();
      }
      if (window.activeSnapGuides.y != null) {
        const gy = window.activeSnapGuides.y * (h / baseH);
        ctx.beginPath();
        ctx.moveTo(0, gy); ctx.lineTo(w, gy);
        ctx.stroke();
      }
      ctx.restore();
    },

    _drawMotionPath(ctx, w, h) {
      if (window.activeKeyframeProperty !== 'move') return;
      if (!(typeof window.isPropertyEditorActive === 'function' && window.isPropertyEditorActive())) return;
      const state = window.currentProjectState;
      if (!state) return;
      const selectedLayer = (state.layers || []).find(l => l.id === window.selectedLayerId);
      if (!selectedLayer || !selectedLayer.keyframes || !selectedLayer.keyframes.move || selectedLayer.keyframes.move.length < 2) return;
      if (!window.CanvasWireframe || typeof window.CanvasWireframe.drawMotionPath !== 'function') return;

      const colors = this._getThemeColors();
      const { baseW, baseH } = this._getProjectBaseDims(w, h);
      const bufferScale = (window._lastBufferScale) || (w / (baseW || 1920));
      const fps = (typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60;
      const currentSec = (typeof window.getCurrentPlayheadTime === 'function') ? window.getCurrentPlayheadTime() : 0;

      window.CanvasWireframe.drawMotionPath(ctx, selectedLayer, {
        bufferScale,
        baseW,
        baseH,
        fps,
        currentSec,
        color: colors.primary,
        bgColor: colors.bg,
        dprScale: this._dprScale || 1
      });
    },

    _drawWireframes(ctx, w, h) {
      if (!window.CanvasWireframe) return;
      if (window.currentDrawerSubview === 'vector') return;

      const allSelectedIds = (window.selectedLayerIds && window.selectedLayerIds.size > 0)
        ? Array.from(window.selectedLayerIds)
        : (window.selectedLayerId ? [window.selectedLayerId] : []);
      if (allSelectedIds.length === 0) return;

      const colors = this._getThemeColors();
      const dprScale = this._dprScale || 1;
      const isSelectionMode = allSelectedIds.length > 1;

      if (isSelectionMode) {
        const state = window.currentProjectState;
        allSelectedIds.forEach(id => {
          const l = (state && state.layers || []).find(layer => layer.id === id);
          if (!l || l.type === 'camera' || l.type === 'audio') return;
          const b = l._canvasBounds;
          if (b && (!b.isBehindCamera || (b.posZ || 0) < 950)) {
            window.CanvasWireframe.draw(ctx, b, {
              showAnchor: false,
              showHandles: false,
              isAnchorMode: false,
              color: colors.primary,
              bgColor: colors.bg,
              dprScale,
              hidden: !!l.hidden
            });
          }
        });
      } else {
        const state = window.currentProjectState;
        const selId = allSelectedIds[0];
        const selL = (state && state.layers || []).find(l => l.id === selId);
        if (selL && selL.type !== 'camera' && selL.type !== 'audio') {
          const b = selL._canvasBounds;
          if (b && (!b.isBehindCamera || (b.posZ || 0) < 950)) {
            const isAnchor = typeof window.isAnchorMode === 'function' ? window.isAnchorMode() : (window.moveAnchorSubmode === 'anchor');
            window.CanvasWireframe.draw(ctx, b, {
              showAnchor: true,
              showHandles: true,
              isAnchorMode: isAnchor,
              color: colors.primary,
              bgColor: colors.bg,
              dprScale,
              hidden: !!selL.hidden
            });
            this._drawRoundnessHandle(ctx, selL, w, h);
          }
        }
      }
    },

    getRoundnessHandle(layer, w, h) {
      if (!layer || layer.hidden || layer.locked) return null;
      if (window.currentDrawerSubview === 'vector') return null;

      const isShape = (layer.type === 'shape');
      const isMediaRoundable = (layer.type === 'image' || layer.type === 'video' || (layer.type === 'precomp' && !layer.collapseTransformations));
      if (!isShape && !isMediaRoundable) return null;

      if (isShape) {
        const shapeType = layer.shapeType || 'rectangle';
        if (shapeType === 'vector') return null;
        const shapeDef = (window.FishShapesRegistry && typeof window.FishShapesRegistry.get === 'function')
          ? window.FishShapesRegistry.get(shapeType)
          : null;
        const supportsRound = shapeDef ? !!shapeDef.controls.roundness : (shapeType === 'rectangle' || shapeType === 'triangle');
        if (!supportsRound) return null;
        if (shapeType === 'triangle' && (parseInt(layer.shapeProps?.step || layer.shapeProps?.steps, 10) || 3) > 3) return null;
      } else if (isMediaRoundable) {
        const hasRound = (Number(layer.roundness) || 0) > 0;
        if (window.currentDrawerSubview !== 'shape' && !hasRound) return null;
      }

      const b = layer._canvasBounds;
      if (!b || (b.isBehindCamera && (b.posZ || 0) >= 950)) return null;

      const dprScale = this._dprScale || 1;
      let corners = b.corners;
      if (!Array.isArray(corners) || corners.length !== 4) {
        const cx = b.cx !== undefined ? b.cx : (b.x + b.w / 2);
        const cy = b.cy !== undefined ? b.cy : (b.y + b.h / 2);
        const rad = ((b.rotation || 0) * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        const hw = (b.w || 0) / 2;
        const hh = (b.h || 0) / 2;
        const rotPt = (lx, ly) => ({
          x: cx + (lx * cosR - ly * sinR),
          y: cy + (lx * sinR + ly * cosR)
        });
        corners = [
          rotPt(-hw, -hh),
          rotPt(hw, -hh),
          rotPt(hw, hh),
          rotPt(-hw, hh)
        ];
      }

      const c0 = corners[0];
      const c1 = corners[1];
      const c3 = corners[3];
      const topEdgeX = c1.x - c0.x;
      const topEdgeY = c1.y - c0.y;
      const leftEdgeX = c3.x - c0.x;
      const leftEdgeY = c3.y - c0.y;
      const edgeW = Math.hypot(topEdgeX, topEdgeY) || b.w || 100;
      const edgeH = Math.hypot(leftEdgeX, leftEdgeY) || b.h || 100;
      if (Math.min(edgeW, edgeH) < 40 * dprScale) return null;

      const uTopX = topEdgeX / edgeW;
      const uTopY = topEdgeY / edgeW;
      const uLeftX = leftEdgeX / edgeH;
      const uLeftY = leftEdgeY / edgeH;

      const localW = isShape ? (Number(layer.shapeProps?.sizeX) || 300) : Math.abs(layer.scaleW || layer.mediaWidth || 300);
      const localH = isShape ? (Number(layer.shapeProps?.sizeY) || 300) : Math.abs(layer.scaleH || layer.mediaHeight || 300);
      const maxR = Math.max(1, Math.min(localW, localH) / 2);
      const curRound = Math.max(0, Math.min(maxR, isShape ? (Number(layer.shapeProps?.roundness) || 0) : (Number(layer.roundness) || 0)));
      const ratio = curRound / maxR;

      let originX, originY, dirX, dirY, maxInsetPx;
      if (isShape && layer.shapeType === 'triangle') {
        originX = (c0.x + c1.x) / 2;
        originY = (c0.y + c1.y) / 2;
        dirX = uLeftX;
        dirY = uLeftY;
        maxInsetPx = Math.max(24 * dprScale, edgeH * 0.44);
      } else {
        originX = c0.x;
        originY = c0.y;
        const bx = uTopX + uLeftX;
        const by = uTopY + uLeftY;
        const bLen = Math.hypot(bx, by) || 1;
        dirX = bx / bLen;
        dirY = by / bLen;
        maxInsetPx = Math.max(26 * dprScale, (Math.min(edgeW, edgeH) / 2) * 1.15 - 12 * dprScale);
      }

      const minInsetPx = Math.min(20 * dprScale, maxInsetPx * 0.35);
      const travelSpanPx = Math.max(10 * dprScale, maxInsetPx - minInsetPx);
      const curInsetPx = minInsetPx + ratio * travelSpanPx;
      const hx = originX + dirX * curInsetPx;
      const hy = originY + dirY * curInsetPx;

      return {
        type: 'roundness',
        x: hx,
        y: hy,
        originX,
        originY,
        dirX,
        dirY,
        minInsetPx,
        travelSpanPx,
        maxR,
        curRound,
        cursor: 'nwse-resize'
      };
    },

    hitTestRoundnessHandle(layer, canvasX, canvasY, hitTolerance = 14) {
      const cw = this._canvas ? this._canvas.width : 1920;
      const ch = this._canvas ? this._canvas.height : 1080;
      const rh = this.getRoundnessHandle(layer, cw, ch);
      if (!rh) return null;
      const dist = Math.hypot(canvasX - rh.x, canvasY - rh.y);
      return dist <= hitTolerance ? rh : null;
    },

    _drawRoundnessHandle(ctx, selL, w, h) {
      const rh = this.getRoundnessHandle(selL, w, h);
      if (!rh) return;

      const dprScale = this._dprScale || 1;
      const colors = this._getThemeColors();
      const accentTeal = '#14b8a6';
      const isDraggingRound = (window._activeCanvasOp === 'roundness');
      const rOuter = (isDraggingRound ? 6.5 : 5.2) * dprScale;
      const rInner = (isDraggingRound ? 2.6 : 2.0) * dprScale;

      ctx.save();
      // Subtle guide tick from corner toward roundness handle when active or rounded
      if (isDraggingRound || rh.curRound > 0) {
        ctx.beginPath();
        ctx.setLineDash([3 * dprScale, 3 * dprScale]);
        ctx.moveTo(rh.originX + rh.dirX * (6 * dprScale), rh.originY + rh.dirY * (6 * dprScale));
        ctx.lineTo(rh.x, rh.y);
        ctx.strokeStyle = accentTeal;
        ctx.lineWidth = 1.25 * dprScale;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.arc(rh.x, rh.y, rOuter, 0, Math.PI * 2);
      ctx.fillStyle = isDraggingRound ? accentTeal : colors.bg;
      ctx.fill();
      ctx.lineWidth = 1.8 * dprScale;
      ctx.strokeStyle = isDraggingRound ? '#ffffff' : accentTeal;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(rh.x, rh.y, rInner, 0, Math.PI * 2);
      ctx.fillStyle = isDraggingRound ? '#ffffff' : accentTeal;
      ctx.fill();
      ctx.restore();
    },

    getVectorTransform(layer, w, h) {
      if (!layer || layer.type !== 'shape' || layer.shapeType !== 'vector') return null;
      const cw = w || (this._canvas ? this._canvas.width : 1920);
      const ch = h || (this._canvas ? this._canvas.height : 1080);
      const shapeProps = layer.shapeProps || {};
      const { baseW, baseH } = this._getProjectBaseDims(cw, ch);
      const vBounds = (typeof window.getVectorLocalBounds === 'function') ? window.getVectorLocalBounds(shapeProps) : null;
      const pw = Math.max(1, vBounds ? vBounds.width : (Number(shapeProps.sizeX) || baseW));
      const ph = Math.max(1, vBounds ? vBounds.height : (Number(shapeProps.sizeY) || baseH));

      const b = layer._canvasBounds;
      const cx = b ? b.cx : (cw / 2);
      const cy = b ? b.cy : (ch / 2);
      const drawW = b ? (b.scaleW || b.w || cw) : cw;
      const drawH = b ? (b.scaleH || b.h || ch) : ch;
      const rotRad = ((b ? (b.rotation || 0) : (layer.rotZ || layer.rotation || 0)) * Math.PI) / 180;

      const sx = drawW / pw;
      const sy = drawH / ph;
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);

      return {
        cx,
        cy,
        sx,
        sy,
        rotRad,
        cosR,
        sinR,
        vBounds,
        toCanvas(vx, vy) {
          const lx = vx * sx;
          const ly = vy * sy;
          return {
            x: cx + (lx * cosR - ly * sinR),
            y: cy + (lx * sinR + ly * cosR)
          };
        },
        toLocal(canvasX, canvasY) {
          const dx = canvasX - cx;
          const dy = canvasY - cy;
          const lx = dx * cosR + dy * sinR;
          const ly = -dx * sinR + dy * cosR;
          return {
            x: Math.abs(sx) > 1e-5 ? (lx / sx) : 0,
            y: Math.abs(sy) > 1e-5 ? (ly / sy) : 0
          };
        }
      };
    },

    hitTestVectorOverlay(layer, canvasX, canvasY, hitTolerance = 14) {
      if (window.currentDrawerSubview !== 'vector') return null;
      if (!layer || layer.type !== 'shape' || layer.shapeType !== 'vector') return null;
      const cw = this._canvas ? this._canvas.width : 1920;
      const ch = this._canvas ? this._canvas.height : 1080;
      const vt = this.getVectorTransform(layer, cw, ch);
      if (!vt) return null;

      const shapeProps = layer.shapeProps || {};
      const pts = Array.isArray(shapeProps.points) ? shapeProps.points : [];
      const closed = !!shapeProps.closed;
      const vState = window._vectorEditorState || { target: 'new', tool: 'point', curveSubMode: 'both', cursorX: 0, cursorY: 0 };

      // 1. Check Bezier Tangent Handles (out / in) on visible curved points (selected point first)
      const checkOrder = [];
      if (typeof vState.target === 'number' && vState.target % 1 === 0 && vState.target >= 0 && vState.target < pts.length) {
        checkOrder.push(vState.target);
      }
      for (let i = 0; i < pts.length; i++) {
        if (!checkOrder.includes(i)) checkOrder.push(i);
      }

      for (const idx of checkOrder) {
        const pt = pts[idx];
        if (!pt) continue;
        const isSelected = (vState.target === idx);
        const inX = Number(pt.inX) || 0;
        const inY = Number(pt.inY) || 0;
        const outX = Number(pt.outX) || 0;
        const outY = Number(pt.outY) || 0;
        const hasOut = Math.hypot(outX, outY) > 0.5;
        const hasIn = Math.hypot(inX, inY) > 0.5;
        if (!isSelected && vState.tool !== 'curve' && !hasOut && !hasIn) continue;

        if (hasOut) {
          const cOut = vt.toCanvas((Number(pt.x) || 0) + outX, (Number(pt.y) || 0) + outY);
          if (Math.hypot(canvasX - cOut.x, canvasY - cOut.y) <= hitTolerance) {
            return { type: 'vector-handle-out', pointIndex: idx, cursor: 'grab' };
          }
        }
        if (hasIn) {
          const cIn = vt.toCanvas((Number(pt.x) || 0) + inX, (Number(pt.y) || 0) + inY);
          if (Math.hypot(canvasX - cIn.x, canvasY - cIn.y) <= hitTolerance) {
            return { type: 'vector-handle-in', pointIndex: idx, cursor: 'grab' };
          }
        }
      }

      // 2. Check Anchor Points (pts[i])
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const cPt = vt.toCanvas(Number(pt.x) || 0, Number(pt.y) || 0);
        if (Math.hypot(canvasX - cPt.x, canvasY - cPt.y) <= hitTolerance) {
          return { type: 'vector-point', pointIndex: i, cursor: 'move' };
        }
      }

      // 3. Check Active Segment Ghost Midpoint (when target is fractional i + t)
      if (typeof vState.target === 'number' && vState.target % 1 !== 0 && pts.length >= 2 && typeof window.evaluateVectorSegmentPoint === 'function') {
        const segStart = ((Math.floor(vState.target) % pts.length) + pts.length) % pts.length;
        const segEnd = (segStart + 1) % pts.length;
        const segT = Math.max(0.02, Math.min(0.98, vState.target - Math.floor(vState.target)));
        const mid = window.evaluateVectorSegmentPoint(pts[segStart], pts[segEnd], segT);
        const cMid = vt.toCanvas(mid.x, mid.y);
        if (Math.hypot(canvasX - cMid.x, canvasY - cMid.y) <= hitTolerance * 1.25) {
          return { type: 'vector-seg-mid', segStart, segEnd, t: segT, cursor: 'copy' };
        }
      }

      // 4. Check Path Segments (click/drag on any curve/line segment to insert point or bend curve)
      if (pts.length >= 2 && typeof window.evaluateVectorSegmentPoint === 'function') {
        const segCount = closed ? pts.length : pts.length - 1;
        let bestSeg = null;
        let bestDist = hitTolerance * 0.9;
        for (let i = 0; i < segCount; i++) {
          const p0 = pts[i];
          const p1 = pts[(i + 1) % pts.length];
          for (let s = 1; s < 20; s++) {
            const t = s / 20;
            const evalPt = window.evaluateVectorSegmentPoint(p0, p1, t);
            const cSeg = vt.toCanvas(evalPt.x, evalPt.y);
            const d = Math.hypot(canvasX - cSeg.x, canvasY - cSeg.y);
            if (d < bestDist) {
              bestDist = d;
              bestSeg = {
                type: 'vector-segment',
                segStart: i,
                segEnd: (i + 1) % pts.length,
                t: Number(t.toFixed(3)),
                cursor: vState.tool === 'curve' ? 'grab' : 'copy'
              };
            }
          }
        }
        if (bestSeg) return bestSeg;
      }

      // 5. If in '+ NEW' mode, clicking/dragging on the canvas places/aims a new point
      if (vState.target === 'new') {
        return { type: 'vector-new-point', cursor: 'crosshair' };
      }

      return null;
    },

    _drawVectorEditorOverlay(ctx, w, h) {
      if (window.currentDrawerSubview !== 'vector') return;
      const proj = window.currentProjectState;
      if (!proj || !window.selectedLayerId) return;
      const layer = (proj.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer || layer.type !== 'shape' || layer.shapeType !== 'vector') return;

      const shapeProps = layer.shapeProps || {};
      const pts = Array.isArray(shapeProps.points) ? shapeProps.points : [];
      const closed = !!shapeProps.closed;
      const vState = window._vectorEditorState || { target: 'new', tool: 'point', curveSubMode: 'both', cursorX: 0, cursorY: 0 };

      const { baseW, baseH } = this._getProjectBaseDims(w, h);
      const vBounds = (typeof window.getVectorLocalBounds === 'function') ? window.getVectorLocalBounds(shapeProps) : null;
      const pw = Math.max(1, vBounds ? vBounds.width : (Number(shapeProps.sizeX) || baseW));
      const ph = Math.max(1, vBounds ? vBounds.height : (Number(shapeProps.sizeY) || baseH));

      const b = layer._canvasBounds;
      const cx = b ? b.cx : (w / 2);
      const cy = b ? b.cy : (h / 2);
      const drawW = b ? (b.scaleW || b.w || w) : w;
      const drawH = b ? (b.scaleH || b.h || h) : h;
      const rotRad = ((b ? (b.rotation || 0) : (layer.rotZ || layer.rotation || 0)) * Math.PI) / 180;

      const sx = drawW / pw;
      const sy = drawH / ph;
      const uiScale = Math.max(1, Math.min(w, h) / 540);
      const accentTeal = '#14b8a6';
      const colors = this._getThemeColors();

      ctx.save();
      ctx.translate(cx, cy);
      if (rotRad !== 0) ctx.rotate(rotRad);

      // 1. Draw Vector Guide Path Outline
      if (pts.length >= 2) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo((Number(pts[0].x) || 0) * sx, (Number(pts[0].y) || 0) * sy);
        const segCount = closed ? pts.length : pts.length - 1;
        for (let i = 0; i < segCount; i++) {
          const p0 = pts[i];
          const p1 = pts[(i + 1) % pts.length];
          const p0x = (Number(p0.x) || 0) * sx;
          const p0y = (Number(p0.y) || 0) * sy;
          const p1x = (Number(p1.x) || 0) * sx;
          const p1y = (Number(p1.y) || 0) * sy;
          const outX = (Number(p0.outX) || 0) * sx;
          const outY = (Number(p0.outY) || 0) * sy;
          const inX = (Number(p1.inX) || 0) * sx;
          const inY = (Number(p1.inY) || 0) * sy;
          if (Math.abs(outX) < 0.01 && Math.abs(outY) < 0.01 && Math.abs(inX) < 0.01 && Math.abs(inY) < 0.01) {
            ctx.lineTo(p1x, p1y);
          } else {
            ctx.bezierCurveTo(p0x + outX, p0y + outY, p1x + inX, p1y + inY, p1x, p1y);
          }
        }
        ctx.lineWidth = 1.75 * uiScale;
        ctx.strokeStyle = accentTeal;
        ctx.globalAlpha = 0.85;
        ctx.stroke();
        ctx.restore();
      }

      // 2. If in '+ NEW' mode and >= 1 point exists, draw preview dashed line from last point to aiming crosshair
      if (vState.target === 'new') {
        const curX = (Number(vState.cursorX) || 0) * sx;
        const curY = (Number(vState.cursorY) || 0) * sy;

        if (pts.length > 0) {
          const lastPt = pts[pts.length - 1];
          const lx = (Number(lastPt.x) || 0) * sx;
          const ly = (Number(lastPt.y) || 0) * sy;
          ctx.save();
          ctx.beginPath();
          ctx.setLineDash([5 * uiScale, 4 * uiScale]);
          ctx.moveTo(lx, ly);
          ctx.lineTo(curX, curY);
          ctx.lineWidth = 1.5 * uiScale;
          ctx.strokeStyle = accentTeal;
          ctx.globalAlpha = 0.7;
          ctx.stroke();
          ctx.restore();
        }

        // Draw Aiming Crosshair at (curX, curY)
        const arm = 12 * uiScale;
        const ringR = 6.5 * uiScale;
        ctx.save();
        ctx.strokeStyle = accentTeal;
        ctx.lineWidth = 2 * uiScale;
        ctx.beginPath();
        ctx.moveTo(curX - arm, curY); ctx.lineTo(curX + arm, curY);
        ctx.moveTo(curX, curY - arm); ctx.lineTo(curX, curY + arm);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(curX, curY, ringR, 0, Math.PI * 2);
        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.75 * uiScale;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(curX, curY, 2.5 * uiScale, 0, Math.PI * 2);
        ctx.fillStyle = accentTeal;
        ctx.fill();
        ctx.restore();
      }

      // 3. Draw Segment Ghost Point when scrubber is at fractional (i + t) along segment i -> i+1
      if (typeof vState.target === 'number' && vState.target % 1 !== 0 && pts.length >= 2) {
        const segStart = ((Math.floor(vState.target) % pts.length) + pts.length) % pts.length;
        const segEnd = (segStart + 1) % pts.length;
        const segT = Math.max(0.02, Math.min(0.98, vState.target - Math.floor(vState.target)));
        const p0 = pts[segStart];
        const p1 = pts[segEnd];
        if (p0 && p1 && typeof window.evaluateVectorSegmentPoint === 'function') {
          const mid = window.evaluateVectorSegmentPoint(p0, p1, segT);
          const mx = mid.x * sx;
          const my = mid.y * sy;
          const r = 7.5 * uiScale;

          ctx.save();
          ctx.beginPath();
          ctx.arc(mx, my, r * 1.45, 0, Math.PI * 2);
          ctx.strokeStyle = accentTeal;
          ctx.lineWidth = 1.5 * uiScale;
          ctx.setLineDash([3 * uiScale, 3 * uiScale]);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.beginPath();
          ctx.arc(mx, my, r, 0, Math.PI * 2);
          ctx.fillStyle = accentTeal;
          ctx.fill();
          ctx.lineWidth = 2 * uiScale;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          // Draw '+' inside midpoint dot
          const plusArm = 3.5 * uiScale;
          ctx.beginPath();
          ctx.moveTo(mx - plusArm, my); ctx.lineTo(mx + plusArm, my);
          ctx.moveTo(mx, my - plusArm); ctx.lineTo(mx, my + plusArm);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.75 * uiScale;
          ctx.stroke();
          ctx.restore();
        }
      }

      // 4. Draw Anchor Points & Bezier Tangent Handles
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const px = (Number(pt.x) || 0) * sx;
        const py = (Number(pt.y) || 0) * sy;
        const isSelected = (vState.target === i);
        const inX = (Number(pt.inX) || 0) * sx;
        const inY = (Number(pt.inY) || 0) * sy;
        const outX = (Number(pt.outX) || 0) * sx;
        const outY = (Number(pt.outY) || 0) * sy;
        const hasHandles = Math.abs(inX) > 0.5 || Math.abs(inY) > 0.5 || Math.abs(outX) > 0.5 || Math.abs(outY) > 0.5;

        // Draw Bezier handles if point is selected or (in curve mode / has handles)
        if ((isSelected && (hasHandles || vState.tool === 'curve')) || (hasHandles && vState.tool === 'curve')) {
          ctx.save();
          ctx.globalAlpha = isSelected ? 1.0 : 0.65;
          ctx.strokeStyle = isSelected ? '#ffffff' : accentTeal;
          ctx.lineWidth = (isSelected ? 1.5 : 1.2) * uiScale;
          ctx.beginPath();
          ctx.moveTo(px + inX, py + inY);
          ctx.lineTo(px, py);
          ctx.lineTo(px + outX, py + outY);
          ctx.stroke();

          const hRadius = (isSelected ? 5.0 : 4.0) * uiScale;
          // In handle circle
          ctx.beginPath();
          ctx.arc(px + inX, py + inY, hRadius, 0, Math.PI * 2);
          ctx.fillStyle = (isSelected && vState.tool === 'curve' && (vState.curveSubMode === 'in' || vState.curveSubMode === 'both')) ? accentTeal : colors.bg;
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.6 * uiScale;
          ctx.stroke();

          // Out handle circle
          ctx.beginPath();
          ctx.arc(px + outX, py + outY, hRadius, 0, Math.PI * 2);
          ctx.fillStyle = (isSelected && vState.tool === 'curve' && (vState.curveSubMode === 'out' || vState.curveSubMode === 'both')) ? accentTeal : colors.bg;
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.6 * uiScale;
          ctx.stroke();
          ctx.restore();
        }

        // Draw Anchor Node Square
        const boxSize = (isSelected ? 10 : 7.5) * uiScale;
        ctx.save();
        ctx.fillStyle = isSelected ? accentTeal : colors.bg;
        ctx.strokeStyle = isSelected ? '#ffffff' : accentTeal;
        ctx.lineWidth = (isSelected ? 2.2 : 1.75) * uiScale;
        ctx.beginPath();
        ctx.rect(px - boxSize / 2, py - boxSize / 2, boxSize, boxSize);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }
  };

  window.CanvasOverlay = CanvasOverlay;
})();
