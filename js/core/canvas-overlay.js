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
      this._canvas.style.imageRendering = 'auto';
      this._sizeDirty = true;
      // Sync size to match main canvas physical size
      this.syncSize(true);
      window.addEventListener('resize', () => {
        this._sizeDirty = true;
        this.syncSize(true);
      }, { passive: true });
      if (typeof ResizeObserver === 'function') {
        try {
          if (this._resizeObserver) this._resizeObserver.disconnect();
          this._resizeObserver = new ResizeObserver(() => {
            this._sizeDirty = true;
          });
          this._resizeObserver.observe(overlayCanvas);
        } catch (_) {}
      }
    },

    _lastTheme: null,
    _cachedPrimary: null,
    _cachedBgCanvas: null,
    _dprScale: 1,
    _sizeDirty: true,
    _resizeObserver: null,

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

    syncSize(force) {
      if (!this._canvas) return;
      if (!force && !this._sizeDirty && this._canvas.width > 0 && this._canvas.height > 0 && this._dprScale) {
        return;
      }
      const main = document.getElementById('editor-active-canvas');
      if (!main) return;
      const rect = this._canvas.getBoundingClientRect ? this._canvas.getBoundingClientRect() : null;
      const isMobileDevice = (typeof window !== 'undefined' && (window.innerWidth <= 600 || ('ontouchstart' in window && window.innerWidth <= 900)));
      const dpr = isMobileDevice ? 1.0 : Math.min(2, window.devicePixelRatio || 1);
      const targetW = (rect && rect.width > 0) ? Math.max(1, Math.round(rect.width * dpr)) : (main.width || 1920);
      const targetH = (rect && rect.height > 0) ? Math.max(1, Math.round(rect.height * dpr)) : (main.height || 1080);
      if (this._canvas.width !== targetW || this._canvas.height !== targetH || !this._dprScale) {
        this._canvas.width = targetW;
        this._canvas.height = targetH;
        this._dprScale = (rect && rect.width > 0) ? (this._canvas.width / rect.width) : dpr;
      }
      if (rect && rect.width > 0 && rect.height > 0) {
        this._sizeDirty = false;
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

      // UI Guidelines (Grid, Snap Guides, Motion Path):
      // These are strictly UI overlays, always drawn at physical display resolution (never pixelated/burik).
      this._drawGrid(ctx, w, h);
      this._drawSnapGuides(ctx, w, h);
      this._drawMotionPath(ctx, w, h);

      // Layer Wireframes & Vector overlay:
      // Rendered directly at native 1:1 physical resolution, completely isolated from Speed Draft burik scale
      const main = document.getElementById('editor-active-canvas');
      const scaleX = (main && main.width > 0) ? (w / main.width) : 1;
      const scaleY = (main && main.height > 0) ? (h / main.height) : 1;

      this._drawWireframes(ctx, w, h, scaleX, scaleY);
      this._drawCameraFrustumOverlay(ctx, w, h, scaleX, scaleY);
      this._drawVectorEditorOverlay(ctx, w, h, scaleX, scaleY);
    },

    _drawGrid(ctx, w, h) {
      const gridBtn = document.getElementById('editor-icon-grid');
      if (!gridBtn || !gridBtn.classList.contains('is-active')) return;

      ctx.save();
      const themePrimary = this._getThemeColors().primary;

      // Uniform, clean UI grid lines (1px razor-sharp, uniform opacity, no center thickening, no crosshair)
      ctx.lineWidth = 1;
      ctx.strokeStyle = themePrimary;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();

      const xs = [Math.round(w * 0.25) + 0.5, Math.round(w * 0.5) + 0.5, Math.round(w * 0.75) + 0.5];
      for (let i = 0; i < xs.length; i++) {
        ctx.moveTo(xs[i], 0);
        ctx.lineTo(xs[i], h);
      }

      const ys = [Math.round(h * 0.25) + 0.5, Math.round(h * 0.5) + 0.5, Math.round(h * 0.75) + 0.5];
      for (let i = 0; i < ys.length; i++) {
        ctx.moveTo(0, ys[i]);
        ctx.lineTo(w, ys[i]);
      }

      ctx.stroke();
      ctx.restore();
    },

    _getProjectBaseDims(fallbackW, fallbackH) {
      const proj = window.currentProjectState || {};
      if (window.currentActivePrecomp) {
        const cw = Math.round(Math.abs(window.currentActivePrecomp.mediaWidth || window.currentActivePrecomp.scaleW || 0));
        const ch = Math.round(Math.abs(window.currentActivePrecomp.mediaHeight || window.currentActivePrecomp.scaleH || 0));
        if (cw > 0 && ch > 0) return { baseW: cw, baseH: ch };
      }
      let baseW = proj._baseW || proj.baseW || proj.width || 0;
      let baseH = proj._baseH || proj.baseH || proj.height || 0;
      if (!baseW || !baseH) {
        if (typeof window.getProjectDimensions === 'function' && proj.resolution && proj.aspectRatio) {
          const dims = window.getProjectDimensions(proj.resolution, proj.aspectRatio);
          if (dims && dims.length >= 2) {
            baseW = dims[0];
            baseH = dims[1];
          }
        }
      }
      return { baseW: baseW || fallbackW || 1, baseH: baseH || fallbackH || 1 };
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
      const bufferScale = (window._lastBufferScale) || (baseW > 0 ? (w / baseW) : 1);
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

    _scaleBoundsForOverlay(b, scaleX, scaleY) {
      if (!b) return null;
      if (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) return b;
      const sb = {
        ...b,
        x: (b.x || 0) * scaleX,
        y: (b.y || 0) * scaleY,
        w: (b.w || 0) * scaleX,
        h: (b.h || 0) * scaleY,
        cx: (b.cx !== undefined ? b.cx : ((b.x || 0) + (b.w || 0) / 2)) * scaleX,
        cy: (b.cy !== undefined ? b.cy : ((b.y || 0) + (b.h || 0) / 2)) * scaleY,
        scaleW: (b.scaleW !== undefined ? b.scaleW : (b.w || 0)) * scaleX,
        scaleH: (b.scaleH !== undefined ? b.scaleH : (b.h || 0)) * scaleY
      };
      if (typeof b.aabbW === 'number') sb.aabbW = b.aabbW * scaleX;
      if (typeof b.aabbH === 'number') sb.aabbH = b.aabbH * scaleY;
      if (typeof b.anchorX === 'number') sb.anchorX = b.anchorX * scaleX;
      if (typeof b.anchorY === 'number') sb.anchorY = b.anchorY * scaleY;
      if (typeof b.radius === 'number') sb.radius = b.radius * ((scaleX + scaleY) * 0.5);
      if (Array.isArray(b.corners)) {
        sb.corners = b.corners.map(pt => pt ? { x: pt.x * scaleX, y: pt.y * scaleY, isBehind: !!pt.isBehind } : pt);
      }
      if (Array.isArray(b.backCorners)) {
        sb.backCorners = b.backCorners.map(pt => pt ? { x: pt.x * scaleX, y: pt.y * scaleY, isBehind: !!pt.isBehind } : pt);
      }
      if (b.apexPoint) {
        sb.apexPoint = { x: b.apexPoint.x * scaleX, y: b.apexPoint.y * scaleY, isBehind: !!b.apexPoint.isBehind };
      }
      if (Array.isArray(b.shapeContour)) {
        sb.shapeContour = b.shapeContour.map(pt => pt ? { x: pt.x * scaleX, y: pt.y * scaleY, isBehind: !!pt.isBehind } : pt);
      }
      if (Array.isArray(b.shapeContourLocal)) {
        sb.shapeContourLocal = b.shapeContourLocal.map(pt => pt ? { x: pt.x * scaleX, y: pt.y * scaleY } : pt);
      }
      if (b.anchor) {
        sb.anchor = { x: b.anchor.x * scaleX, y: b.anchor.y * scaleY };
      }
      if (Array.isArray(b.handles)) {
        sb.handles = b.handles.map(h => h ? { ...h, x: h.x * scaleX, y: h.y * scaleY } : h);
      }
      if (b.light3D) {
        const scalePt = (pt) => pt ? { x: pt.x * scaleX, y: pt.y * scaleY, isBehind: !!pt.isBehind } : pt;
        const l3 = b.light3D;
        sb.light3D = {
          axisX: Array.isArray(l3.axisX) ? l3.axisX.map(scalePt) : null,
          axisY: Array.isArray(l3.axisY) ? l3.axisY.map(scalePt) : null,
          axisZ: Array.isArray(l3.axisZ) ? l3.axisZ.map(scalePt) : null,
          rayTip: l3.rayTip ? scalePt(l3.rayTip) : null,
          rings: Array.isArray(l3.rings) ? l3.rings.map(r => Array.isArray(r) ? r.map(scalePt) : r) : null
        };
      }
      return sb;
    },

    _drawWireframes(ctx, w, h, scaleX = 1, scaleY = 1) {
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
          const b = this._scaleBoundsForOverlay(l._canvasBounds, scaleX, scaleY);
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
          const b = this._scaleBoundsForOverlay(selL._canvasBounds, scaleX, scaleY);
          if (b && (!b.isBehindCamera || (b.posZ || 0) < 950)) {
            const isAnchor = typeof window.isAnchorMode === 'function' ? window.isAnchorMode() : (window.moveAnchorSubmode === 'anchor');
            window.CanvasWireframe.draw(ctx, b, {
              showAnchor: true,
              showHandles: selL.shapeType !== '3d_model',
              isAnchorMode: isAnchor,
              color: colors.primary,
              bgColor: colors.bg,
              dprScale,
              hidden: !!selL.hidden
            });
            this._drawRoundnessHandle(ctx, selL, w, h, scaleX, scaleY);
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
        if (shapeType === 'vector' || shapeType === '3d_model') return null;
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
      const main = document.getElementById('editor-active-canvas');
      const cw = main ? main.width : (this._canvas ? this._canvas.width : 1920);
      const ch = main ? main.height : (this._canvas ? this._canvas.height : 1080);
      const rh = this.getRoundnessHandle(layer, cw, ch);
      if (!rh) return null;
      const dist = Math.hypot(canvasX - rh.x, canvasY - rh.y);
      return dist <= hitTolerance ? rh : null;
    },

    _drawRoundnessHandle(ctx, selL, w, h, scaleX = 1, scaleY = 1) {
      const main = document.getElementById('editor-active-canvas');
      const cw = main ? main.width : (this._canvas ? this._canvas.width : 1920);
      const ch = main ? main.height : (this._canvas ? this._canvas.height : 1080);
      const rh = this.getRoundnessHandle(selL, cw, ch);
      if (!rh) return;

      const dprScale = this._dprScale || 1;
      const colors = this._getThemeColors();
      const accentTeal = '#14b8a6';
      const isDraggingRound = (window._activeCanvasOp === 'roundness');
      const rOuter = (isDraggingRound ? 6.5 : 5.2) * dprScale;
      const rInner = (isDraggingRound ? 2.6 : 2.0) * dprScale;

      const hx = rh.x * scaleX;
      const hy = rh.y * scaleY;
      const ox = rh.originX * scaleX;
      const oy = rh.originY * scaleY;

      ctx.save();
      // Subtle guide tick from corner toward roundness handle when active or rounded
      if (isDraggingRound || rh.curRound > 0) {
        ctx.beginPath();
        ctx.setLineDash([3 * dprScale, 3 * dprScale]);
        ctx.moveTo(ox + rh.dirX * (6 * dprScale), oy + rh.dirY * (6 * dprScale));
        ctx.lineTo(hx, hy);
        ctx.strokeStyle = accentTeal;
        ctx.lineWidth = 1.25 * dprScale;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.arc(hx, hy, rOuter, 0, Math.PI * 2);
      ctx.fillStyle = isDraggingRound ? accentTeal : colors.bg;
      ctx.fill();
      ctx.lineWidth = 1.8 * dprScale;
      ctx.strokeStyle = isDraggingRound ? '#ffffff' : accentTeal;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(hx, hy, rInner, 0, Math.PI * 2);
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
      const main = document.getElementById('editor-active-canvas');
      const cw = main ? main.width : (this._canvas ? this._canvas.width : 1920);
      const ch = main ? main.height : (this._canvas ? this._canvas.height : 1080);
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

    _drawVectorEditorOverlay(ctx, w, h, scaleX = 1, scaleY = 1) {
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
      const cx = (b ? b.cx : (w / 2 / scaleX)) * scaleX;
      const cy = (b ? b.cy : (h / 2 / scaleY)) * scaleY;
      const drawW = (b ? (b.scaleW || b.w || (w / scaleX)) : (w / scaleX)) * scaleX;
      const drawH = (b ? (b.scaleH || b.h || (h / scaleY)) : (h / scaleY)) * scaleY;
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
    },

    // Pre-allocated scratch buffers for Blender-style Camera Frustum wireframes (zero per-frame GC)
    _frustumProjParams: {
      cx: 0, cy: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0,
      bufferScale: 1, vw: 0, vh: 0, camera: null
    },
    _frustumCamScaleScratch: { x: 1, y: 1 },
    _frustumPts: [
      { x: 0, y: 0, isBehind: false }, // 0: Eye apex
      { x: 0, y: 0, isBehind: false }, // 1: Near TL
      { x: 0, y: 0, isBehind: false }, // 2: Near TR
      { x: 0, y: 0, isBehind: false }, // 3: Near BR
      { x: 0, y: 0, isBehind: false }, // 4: Near BL
      { x: 0, y: 0, isBehind: false }, // 5: Far TL (composition plane)
      { x: 0, y: 0, isBehind: false }, // 6: Far TR
      { x: 0, y: 0, isBehind: false }, // 7: Far BR
      { x: 0, y: 0, isBehind: false }, // 8: Far BL
      { x: 0, y: 0, isBehind: false }, // 9: Up-arrow apex (Blender top triangle)
      { x: 0, y: 0, isBehind: false }, // 10: Up-arrow base left
      { x: 0, y: 0, isBehind: false }, // 11: Up-arrow base right
      { x: 0, y: 0, isBehind: false }, // 12: Focus plane TL (when DOF enabled)
      { x: 0, y: 0, isBehind: false }, // 13: Focus plane TR
      { x: 0, y: 0, isBehind: false }, // 14: Focus plane BR
      { x: 0, y: 0, isBehind: false }  // 15: Focus plane BL
    ],

    _drawCameraFrustumOverlay(ctx, w, h, scaleX, scaleY) {
      const info = window._activeCameraFrustumInfo;
      if (!info || !info.viewerCamera || !Array.isArray(info.cameras) || info.cameras.length === 0) return;
      const engine = window.FishToolEngine || window.LayerTransform;
      if (!engine || typeof engine.projectPoint !== 'function') return;

      const viewerCam = info.viewerCamera;
      const bScale = info.bufferScale || 1;
      const vw = info.w || w;
      const vh = info.h || h;
      if (!vw || !vh) return;

      const colors = this._getThemeColors();
      const uiScale = this._dprScale || 1;
      const projParams = this._frustumProjParams;
      projParams.bufferScale = bScale;
      projParams.vw = vw;
      projParams.vh = vh;
      projParams.camera = viewerCam;

      const pts = this._frustumPts;
      const drawSeg = (a, b) => {
        if (pts[a].isBehind || pts[b].isBehind) return;
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      };

      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      for (let ci = 0; ci < info.cameras.length; ci++) {
        const realCam = info.cameras[ci];
        if (!realCam) continue;
        const isPrimary = !info.activeCameraId || realCam.id === info.activeCameraId || (realCam._rawCamera && realCam._rawCamera.id === info.activeCameraId);

        // Dynamic camera intrinsics: Focal Length (lens mm), Zoom %, and Camera Scale
        const realLens = Math.max(1, realCam.cameraLens !== undefined ? realCam.cameraLens : 50);
        const realZoom = Math.max(1, realCam.cameraZoom !== undefined ? realCam.cameraZoom : 100);
        const lensFactor = Math.max(0.01, realLens / 50);
        const totalZoom = Math.max(0.05, lensFactor * (realZoom / 100));
        const D_cam = 1000.0 * lensFactor * bScale;

        let camInvX = 1;
        let camInvY = 1;
        if (typeof engine._getCameraInverseScale === 'function') {
          const inv = engine._getCameraInverseScale(realCam, vw, vh, bScale, this._frustumCamScaleScratch);
          camInvX = Math.max(0.05, Math.abs(inv.x || 1));
          camInvY = Math.max(0.05, Math.abs(inv.y || 1));
        }

        const eyeX = vw * 0.5 + (realCam.posX || 0) * bScale;
        const eyeY = vh * 0.5 + (realCam.posY || 0) * bScale;
        const eyeZ = (realCam.posZ || 0) * bScale + D_cam;

        // Inverse of FishToolEngine camera rotation: Rz(+rotZ) * Ry(-rotY) * Rx(-rotX)
        const radX = -((realCam.rotX || 0) * Math.PI) / 180;
        const radY = -((realCam.rotY || 0) * Math.PI) / 180;
        const radZ = ((realCam.rotZ !== undefined ? realCam.rotZ : (realCam.rotation || 0)) * Math.PI) / 180;
        const cX = Math.cos(radX), sX = Math.sin(radX);
        const cY = Math.cos(radY), sY = Math.sin(radY);
        const cZ = Math.cos(radZ), sZ = Math.sin(radZ);

        const projectLocalCamPt = (idx, vx, vy, vz) => {
          const y1 = vy * cX - vz * sX;
          const z1 = vy * sX + vz * cX;
          const x1 = vx;
          const x2 = x1 * cY + z1 * sY;
          const z2 = -x1 * sY + z1 * cY;
          const y2 = y1;
          const wx = eyeX + (x2 * cZ - y2 * sZ);
          const wy = eyeY + (x2 * sZ + y2 * cZ);
          const wz = eyeZ + z2;
          const p = engine.projectPoint(wx, wy, wz, projParams);
          pts[idx].x = p.x * scaleX;
          pts[idx].y = p.y * scaleY;
          pts[idx].isBehind = !!p.isBehind;
        };

        // Frustum geometry scales dynamically with focal length (D_cam) & zoom (totalZoom)
        const dFar = D_cam;
        const dNear = Math.max(60 * bScale, Math.min(D_cam * 0.22, 220 * bScale * lensFactor));
        const farHalfW = (vw * 0.5) * (dFar / (D_cam * totalZoom * camInvX));
        const farHalfH = (vh * 0.5) * (dFar / (D_cam * totalZoom * camInvY));
        const nearHalfW = (vw * 0.5) * (dNear / (D_cam * totalZoom * camInvX));
        const nearHalfH = (vh * 0.5) * (dNear / (D_cam * totalZoom * camInvY));

        // 0: Eye apex
        projectLocalCamPt(0, 0, 0, 0);
        // 1..4: Near camera lens-hood rectangle (Blender camera body)
        projectLocalCamPt(1, -nearHalfW, -nearHalfH, -dNear);
        projectLocalCamPt(2,  nearHalfW, -nearHalfH, -dNear);
        projectLocalCamPt(3,  nearHalfW,  nearHalfH, -dNear);
        projectLocalCamPt(4, -nearHalfW,  nearHalfH, -dNear);
        // 5..8: Far composition viewport rectangle
        projectLocalCamPt(5, -farHalfW, -farHalfH, -dFar);
        projectLocalCamPt(6,  farHalfW, -farHalfH, -dFar);
        projectLocalCamPt(7,  farHalfW,  farHalfH, -dFar);
        projectLocalCamPt(8, -farHalfW,  farHalfH, -dFar);
        // 9..11: Iconic Blender UP-orientation triangle above near lens-hood
        const triBaseY = -nearHalfH * 1.14;
        const triHalfW = nearHalfW * 0.52;
        const triApexY = -nearHalfH * 1.72;
        projectLocalCamPt(9,   0,        triApexY, -dNear);
        projectLocalCamPt(10, -triHalfW, triBaseY, -dNear);
        projectLocalCamPt(11,  triHalfW, triBaseY, -dNear);

        const baseAlpha = isPrimary ? 1.0 : 0.65;

        // 1. Dashed frustum sightlines (Near corners -> Far composition frame)
        ctx.beginPath();
        ctx.strokeStyle = colors.primary;
        ctx.globalAlpha = 0.45 * baseAlpha;
        ctx.lineWidth = 1.15 * uiScale;
        ctx.setLineDash([5 * uiScale, 4 * uiScale]);
        drawSeg(1, 5);
        drawSeg(2, 6);
        drawSeg(3, 7);
        drawSeg(4, 8);
        ctx.stroke();

        // 2. Far composition frame rectangle (solid)
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.globalAlpha = 0.78 * baseAlpha;
        ctx.lineWidth = 1.35 * uiScale;
        drawSeg(5, 6);
        drawSeg(6, 7);
        drawSeg(7, 8);
        drawSeg(8, 5);
        ctx.stroke();

        // 3. Blender-style camera pyramid body (Eye -> Near hood + Near rect)
        ctx.beginPath();
        ctx.globalAlpha = 0.95 * baseAlpha;
        ctx.lineWidth = 1.75 * uiScale;
        drawSeg(0, 1);
        drawSeg(0, 2);
        drawSeg(0, 3);
        drawSeg(0, 4);
        drawSeg(1, 2);
        drawSeg(2, 3);
        drawSeg(3, 4);
        drawSeg(4, 1);
        ctx.stroke();

        // 4. Blender UP triangle (filled for active camera, outlined for secondary cameras)
        if (!pts[9].isBehind && !pts[10].isBehind && !pts[11].isBehind) {
          ctx.beginPath();
          ctx.moveTo(pts[9].x, pts[9].y);
          ctx.lineTo(pts[10].x, pts[10].y);
          ctx.lineTo(pts[11].x, pts[11].y);
          ctx.closePath();
          if (isPrimary) {
            ctx.fillStyle = colors.primary;
            ctx.globalAlpha = 0.95;
            ctx.fill();
          } else {
            ctx.strokeStyle = colors.primary;
            ctx.globalAlpha = 0.85;
            ctx.lineWidth = 1.5 * uiScale;
            ctx.stroke();
          }
        }

        // 5. Optional DOF focus distance plane rectangle (when cameraBlurEnabled is active)
        if (realCam.cameraBlurEnabled && (realCam.cameraBlurAmount || 0) > 0) {
          const focusDist = Math.max(dNear * 1.1, D_cam - ((realCam.cameraFocusDistance || 0) * bScale));
          if (focusDist > dNear * 1.05 && focusDist < D_cam * 4) {
            const focHalfW = (vw * 0.5) * (focusDist / (D_cam * totalZoom * camInvX));
            const focHalfH = (vh * 0.5) * (focusDist / (D_cam * totalZoom * camInvY));
            projectLocalCamPt(12, -focHalfW, -focHalfH, -focusDist);
            projectLocalCamPt(13,  focHalfW, -focHalfH, -focusDist);
            projectLocalCamPt(14,  focHalfW,  focHalfH, -focusDist);
            projectLocalCamPt(15, -focHalfW,  focHalfH, -focusDist);
            ctx.beginPath();
            ctx.strokeStyle = colors.primary;
            ctx.globalAlpha = 0.5 * baseAlpha;
            ctx.lineWidth = 1.1 * uiScale;
            ctx.setLineDash([3 * uiScale, 3 * uiScale]);
            drawSeg(12, 13);
            drawSeg(13, 14);
            drawSeg(14, 15);
            drawSeg(15, 12);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }

      ctx.restore();
    }
  };

  window.CanvasOverlay = CanvasOverlay;
})();
