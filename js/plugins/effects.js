/**
 * EFFECTS.JS - Modular Layer Effects Engine & Plugin Registry
 * Pure flat styling, zero blurs/gradients, 100% theme token binding.
 * Decoupled effect pipeline for FishTool Studio.
 * Loads and coordinates modular effects plugins from effects/*.js
 */

(function(global) {
  'use strict';

  // 1. Registry for modular effects plugins
  const registry = new Map();

  // ─── Universal WASM Anti-Piracy Security Guard ─────────────────────────
  let wasmGuardInstance = null;
  let wasmGuardExports = null;
  let wasmGuardLoadingPromise = null;
  let wasmWatermarkImg = null;
  let isWasmAuthorized = true;

  async function ensureWasmGuard() {
    if (wasmGuardExports) return wasmGuardExports;
    if (typeof window !== 'undefined' && window.__FISH_WASM__) {
      wasmGuardInstance = window.__FISH_WASM__.instance;
      wasmGuardExports = window.__FISH_WASM__.exports;
      isWasmAuthorized = window.__FISH_WASM__.isAuthorized;
      wasmWatermarkImg = window.__FISH_WASM__.watermarkImg;
      return wasmGuardExports;
    }
    if (wasmGuardLoadingPromise) return wasmGuardLoadingPromise;

    wasmGuardLoadingPromise = (async () => {
      try {
        const wasmCandidates = [
          'effects/effects.wasm',
          '/effects/effects.wasm'
        ];

        let res = null;
        for (const u of wasmCandidates) {
          try {
            const r = await fetch(u);
            if (r.ok) { res = r; break; }
          } catch (_) {}
        }

        if (!res || !res.ok) {
          throw new Error('Core WASM security module missing or blocked (' + (res ? res.status : 404) + ')');
        }

        const bytes = await res.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(bytes);
        wasmGuardInstance = instance;
        wasmGuardExports = instance.exports;

        // Strict Domain Verification via WASM Binary
        const isFileProto = typeof window !== 'undefined' && window.location && window.location.protocol === 'file:';
        const host = (typeof window !== 'undefined' && window.location && window.location.hostname) || (isFileProto ? 'file://' : '');
        const enc = new TextEncoder();
        const hostBytes = enc.encode(host);
        const mem = new Uint8Array(wasmGuardExports.memory.buffer);
        const tempPtr = 10000;
        mem.set(hostBytes, tempPtr);
        wasmGuardExports.verify_domain(tempPtr, hostBytes.length);
        isWasmAuthorized = wasmGuardExports.is_authorized() === 1;

        if (!isWasmAuthorized) {
          try {
            const svgPtr = wasmGuardExports.get_watermark_svg_ptr();
            const svgLen = wasmGuardExports.get_watermark_svg_len();
            const svgSlice = new Uint8Array(wasmGuardExports.memory.buffer, svgPtr, svgLen);
            const svgText = new TextDecoder().decode(svgSlice);
            const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
            wasmWatermarkImg = new Image();
            wasmWatermarkImg.onload = () => {
              if (typeof window !== 'undefined' && typeof window.redrawComposition === 'function') {
                window.redrawComposition('wasmWatermarkLoaded');
              }
            };
            wasmWatermarkImg.src = URL.createObjectURL(blob);
          } catch (_) {}
        }

        return wasmGuardExports;
      } catch (err) {
        console.warn('[FishEffects] Universal WASM Guard init error:', err);
        throw err;
      }
    })();

    return wasmGuardLoadingPromise;
  }

  // Pre-load universal WASM guard in background (skip fetch on file: where loader.js loads synchronously)
  if (typeof window !== 'undefined' && (!window.location || window.location.protocol !== 'file:')) {
    ensureWasmGuard().catch(() => {});
  }

  const FishEffectsRegistry = {
    /**
     * Register a new modular effect plugin definition
     * @param {Object} def - Effect plugin descriptor
     */
    register(def) {
      if (!def || !def.id) return;

      const originalRender = typeof def.render === 'function' ? def.render : null;
      let guardedRender = null;

      if (originalRender) {
        guardedRender = function(ctx, el, layer, bounds, fx, sec, opt) {
          try {
            originalRender.call(this, ctx, el, layer, bounds, fx, sec, opt);
          } catch (e) {
            console.warn('[Effect Render Error]', def.id, e);
          }

          if (typeof window !== 'undefined' && window.__FISH_WASM__) {
            isWasmAuthorized = window.__FISH_WASM__.isAuthorized;
            wasmWatermarkImg = window.__FISH_WASM__.watermarkImg;
          }

          // Poison Pill: If domain is unauthorized, burn embedded vector watermark onto frame
          if (!isWasmAuthorized && wasmWatermarkImg && wasmWatermarkImg.complete && ctx) {
            try {
              const targetCanvas = ctx.canvas;
              const compW = Math.max(1, targetCanvas ? targetCanvas.width : (bounds && bounds.w ? bounds.w : 1920));
              const compH = Math.max(1, targetCanvas ? targetCanvas.height : (bounds && bounds.h ? bounds.h : 1080));
              ctx.save();
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.drawImage(wasmWatermarkImg, 0, 0, compW, compH);
              ctx.restore();
            } catch (_) {}
          }
        };
      }

      const registeredDef = {
        ...def,
        id: def.id,
        name: def.name || def.id,
        category: def.category || 'lightning',
        icon: def.icon || 'assets/FXPH.svg',
        description: def.description || '',
        params: Array.isArray(def.params) ? def.params : [],
        filter: typeof def.filter === 'function' ? def.filter : null,
        render: guardedRender,
        renderPost: typeof def.renderPost === 'function' ? def.renderPost : null,
        onButtonClick: typeof def.onButtonClick === 'function' ? def.onButtonClick : null,
        isExpanding: !!def.isExpanding,
        isExclusive3D: !!def.isExclusive3D
      };
      registry.set(def.id, registeredDef);

      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
          window.dispatchEvent(new CustomEvent('fisheffects:registered', { detail: registeredDef }));
        } catch (_) {}
      }
    },

    get(id) {
      if (!id) return null;
      let def = registry.get(id);
      if (!def && typeof id === 'string') {
        if (id === 'open-ios' || id === 'open_ios' || id === 'open-mac' || id === 'open_mac') {
          return registry.get('fluid-fish') || registry.get('fluid_fish');
        }
        if (id.includes('_')) def = registry.get(id.replace(/_/g, '-'));
        else if (id.includes('-')) def = registry.get(id.replace(/-/g, '_'));
      }
      return def || null;
    },

    getAll() {
      return Array.from(registry.values());
    },

    getByCategory(cat) {
      return Array.from(registry.values()).filter(e => e.category === cat);
    },

    createInstance(id, customName) {
      const def = this.get(id);
      if (!def) return null;
      const canonicalId = def.id;
      const instance = {
        id: 'fx_' + canonicalId.replace(/[^a-z0-9]/gi, '_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: canonicalId,
        name: customName || def.name,
        isExpanded: true,
        disabled: false
      };
      def.params.forEach(p => {
        if (p.type === 'button' || p.type === 'action') {
          return;
        } else if (p.type === 'switch' || p.type === 'boolean') {
          instance[p.id] = (p.default !== undefined) ? p.default : 1;
        } else if (p.type === 'color') {
          instance[p.id] = p.default || '#ffffff';
        } else if (p.type === 'select') {
          instance[p.id] = p.default || (p.options && p.options[0] ? p.options[0] : 'normal');
        } else if (p.type === 'layer') {
          instance[p.id] = p.default || '';
        } else {
          instance[p.id] = p.default !== undefined ? p.default : 0;
        }
      });
      return instance;
    }
  };

  // Cache ruler tick marks vector SVG
  let cachedRulerTicksSVG = '';
  function getRulerTicksSVG() {
    if (cachedRulerTicksSVG) return cachedRulerTicksSVG;
    let lines = '';
    for (let i = 0; i <= 40; i++) {
      const pct = (i * 2.5).toFixed(1);
      const isMajor = i % 4 === 0;
      const isMid = i % 2 === 0;
      const y1 = isMajor ? 8 : (isMid ? 11 : 14);
      const y2 = isMajor ? 30 : (isMid ? 27 : 24);
      const opacity = isMajor ? '0.8' : (isMid ? '0.5' : '0.3');
      lines += `<line x1="${pct}%" y1="${y1}" x2="${pct}%" y2="${y2}" stroke="var(--border-panel)" stroke-width="1.2" opacity="${opacity}" vector-effect="non-scaling-stroke"/>`;
    }
    cachedRulerTicksSVG = `<svg class="effects-ruler-ticks" width="100%" height="100%">${lines}</svg>`;
    return cachedRulerTicksSVG;
  }

  // WebGL High-Performance Studio Blur Engine (GPU Accelerated, Safari & WebKit 100% Fidelity)
  let _blurGLCanvas = null;
  let _blurGL = null;
  let _blurGLProg = null;
  let _blurGLUniforms = null;
  let _blurGLPosBuf = null;
  let _blurGLUvBuf = null;
  let _blurGLTex0 = null;
  let _blurGLTex1 = null;
  let _blurGLFBO0 = null;
  let _blurGLFBO1 = null;
  let _blurGLW = 0;
  let _blurGLH = 0;
  let _blurGLFailed = false;
  let _blurScratchCanvas = null;
  let _blurScratchCtx = null;

  function initBlurGL() {
    if (_blurGL && _blurGLProg) return true;
    if (_blurGLFailed || typeof document === 'undefined') return false;
    try {
      if (!_blurGLCanvas) _blurGLCanvas = document.createElement('canvas');
      const opts = { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true };
      const gl = _blurGLCanvas.getContext('webgl2', opts) ||
                 _blurGLCanvas.getContext('webgl', opts) ||
                 _blurGLCanvas.getContext('experimental-webgl', opts);
      if (!gl) { _blurGLFailed = true; return false; }
      _blurGL = gl;

      const vs = [
        'attribute vec2 a_pos;',
        'attribute vec2 a_uv;',
        'varying vec2 v_uv;',
        'void main(void) {',
        '  v_uv = a_uv;',
        '  gl_Position = vec4(a_pos, 0.0, 1.0);',
        '}'
      ].join('\n');

      // 9-tap separable Gaussian blur with linear sampling (5 lookups)
      const fs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_texture;',
        'uniform vec2 u_delta;',
        'void main(void) {',
        '  vec4 col = texture2D(u_texture, v_uv) * 0.2270270270;',
        '  vec2 d1 = u_delta * 1.3846153846;',
        '  vec2 d2 = u_delta * 3.2307692308;',
        '  col += texture2D(u_texture, v_uv + d1) * 0.3162162162;',
        '  col += texture2D(u_texture, v_uv - d1) * 0.3162162162;',
        '  col += texture2D(u_texture, v_uv + d2) * 0.0702702703;',
        '  col += texture2D(u_texture, v_uv - d2) * 0.0702702703;',
        '  gl_FragColor = col;',
        '}'
      ].join('\n');

      function compile(t, s) {
        const sh = gl.createShader(t);
        gl.shaderSource(sh, s);
        gl.compileShader(sh);
        return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
      }

      const vShader = compile(gl.VERTEX_SHADER, vs);
      const fShader = compile(gl.FRAGMENT_SHADER, fs);
      if (!vShader || !fShader) { _blurGLFailed = true; return false; }

      const prog = gl.createProgram();
      gl.attachShader(prog, vShader);
      gl.attachShader(prog, fShader);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { _blurGLFailed = true; return false; }

      _blurGLProg = prog;
      _blurGLUniforms = {
        texture: gl.getUniformLocation(prog, 'u_texture'),
        delta: gl.getUniformLocation(prog, 'u_delta')
      };

      _blurGLPosBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _blurGLPosBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

      _blurGLUvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _blurGLUvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 0, 0, 1, 1, 1, 0]), gl.STATIC_DRAW);

      function createFBOTexture() {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const fbo = gl.createFramebuffer();
        return { tex, fbo };
      }

      const fbo0 = createFBOTexture();
      _blurGLTex0 = fbo0.tex;
      _blurGLFBO0 = fbo0.fbo;

      const fbo1 = createFBOTexture();
      _blurGLTex1 = fbo1.tex;
      _blurGLFBO1 = fbo1.fbo;

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      return true;
    } catch (_) {
      _blurGLFailed = true;
      return false;
    }
  }

  // 2. Effects Engine Coordinator
  const FishEffects = {
    registry: FishEffectsRegistry,

    getParamIds(fx) {
      if (!fx) return [];
      const def = FishEffectsRegistry.get(fx.type);
      if (def && Array.isArray(def.params)) {
        return def.params.filter(p => p.type !== 'button' && p.type !== 'action').map(p => p.id);
      }
      return Object.keys(fx).filter(k => !['id', 'type', 'name', 'isExpanded', 'disabled'].includes(k));
    },

    getLayerSnapshot(layerId, currentSec, renderBounds) {
      if (!layerId) return null;
      const compState = (typeof window !== 'undefined' && (window.currentActivePrecomp || window.currentProjectState)) || null;
      if (!compState || !Array.isArray(compState.layers)) return null;
      const targetLayer = compState.layers.find(l => l && String(l.id) === String(layerId));
      if (!targetLayer) return null;

      const sec = (typeof currentSec === 'number') ? currentSec : (typeof window !== 'undefined' ? (window.currentPlaybackSec || window.currentSec || 0) : 0);
      const effProps = (typeof window !== 'undefined' && typeof window.getLayerEffectivePropsAtTime === 'function')
        ? window.getLayerEffectivePropsAtTime(targetLayer, sec, null, compState.layers)
        : targetLayer;

      const animLayer = Object.assign({}, targetLayer, effProps);
      const engine = (typeof window !== 'undefined') ? (window.FishToolEngine || window.LayerTransform) : null;
      const activeCamera = (typeof window !== 'undefined' && typeof window.getActiveCameraLayer === 'function')
        ? window.getActiveCameraLayer()
        : null;

      // Determine base composition dimensions (unscaled project space)
      const aspect = (compState && compState.aspectRatio) || '16:9';
      const res = (compState && compState.resolution) || '1080p';
      let baseDims = (typeof window !== 'undefined' && typeof window.getProjectDimensions === 'function')
        ? window.getProjectDimensions(res, aspect)
        : [1920, 1080];
      if (window && window.currentActivePrecomp) {
        const cw = Math.round(Math.abs(window.currentActivePrecomp.mediaWidth || window.currentActivePrecomp.scaleW || baseDims[0]));
        const ch = Math.round(Math.abs(window.currentActivePrecomp.mediaHeight || window.currentActivePrecomp.scaleH || baseDims[1]));
        baseDims = [cw, ch];
      }
      const baseW = (renderBounds && renderBounds.baseW) || baseDims[0] || 1920;
      const baseH = (renderBounds && renderBounds.baseH) || baseDims[1] || 1080;

      // Determine current render canvas / viewport dimensions & bufferScale
      const targetCanvas = (typeof document !== 'undefined') ? (document.getElementById('editor-active-canvas') || document.querySelector('canvas')) : null;
      const compW = Math.max(1, (renderBounds && (renderBounds.w || renderBounds.width)) || (targetCanvas ? targetCanvas.width : baseW));
      const compH = Math.max(1, (renderBounds && (renderBounds.h || renderBounds.height)) || (targetCanvas ? targetCanvas.height : baseH));
      const bufferScale = (renderBounds && renderBounds.bufferScale > 0)
        ? renderBounds.bufferScale
        : (compW / Math.max(1, baseW));

      const bounds = engine && typeof engine.getBounds === 'function'
        ? engine.getBounds(animLayer, bufferScale, activeCamera, compW, compH)
        : null;

      let corners = null;
      let screenCenterX = 0;
      let screenCenterY = 0;
      let visualWidth = 0;
      let visualHeight = 0;
      let visualRotation = 0;

      if (bounds && Array.isArray(bounds.corners) && bounds.corners.length >= 4) {
        corners = bounds.corners.map(pt => ({ x: pt.x, y: pt.y, z: pt.z || 0, scale: pt.scale || 1, isBehind: !!pt.isBehind }));
        screenCenterX = (corners[0].x + corners[2].x) / 2;
        screenCenterY = (corners[0].y + corners[2].y) / 2;
        visualWidth = Math.max(2, Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y));
        visualHeight = Math.max(2, Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y));
        visualRotation = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180 / Math.PI;
      } else {
        screenCenterX = (animLayer.posX !== undefined ? animLayer.posX : (baseW / 2)) * bufferScale;
        screenCenterY = (animLayer.posY !== undefined ? animLayer.posY : (baseH / 2)) * bufferScale;
        visualWidth = Math.max(2, Math.abs(animLayer.scaleW !== undefined ? animLayer.scaleW : 300) * bufferScale);
        visualHeight = Math.max(2, Math.abs(animLayer.scaleH !== undefined ? animLayer.scaleH : 300) * bufferScale);
        visualRotation = animLayer.rotZ !== undefined ? animLayer.rotZ : (animLayer.rotation || 0);
        const halfW = visualWidth / 2;
        const halfH = visualHeight / 2;
        corners = [
          { x: screenCenterX - halfW, y: screenCenterY - halfH, z: 0, scale: 1, isBehind: false },
          { x: screenCenterX + halfW, y: screenCenterY - halfH, z: 0, scale: 1, isBehind: false },
          { x: screenCenterX + halfW, y: screenCenterY + halfH, z: 0, scale: 1, isBehind: false },
          { x: screenCenterX - halfW, y: screenCenterY + halfH, z: 0, scale: 1, isBehind: false }
        ];
      }

      let rawRoundness = undefined;
      if (animLayer.shapeProps && animLayer.shapeProps.roundness !== undefined) {
        rawRoundness = Number(animLayer.shapeProps.roundness);
      } else if (animLayer.roundness !== undefined) {
        rawRoundness = Number(animLayer.roundness);
      } else if (animLayer.cornerRadius !== undefined) {
        rawRoundness = Number(animLayer.cornerRadius);
      } else if (animLayer.shapeType === 'capsule' || animLayer.shapeType === 'circle') {
        rawRoundness = Math.min(Math.abs(animLayer.scaleW || 300), Math.abs(animLayer.scaleH || 300)) / 2;
      }
      if (typeof rawRoundness === 'number' && (isNaN(rawRoundness) || rawRoundness < 0)) {
        rawRoundness = undefined;
      }
      const scaleRatio = (animLayer.shapeProps && animLayer.shapeProps.sizeX)
        ? Math.abs((animLayer.scaleW !== undefined ? animLayer.scaleW : animLayer.shapeProps.sizeX) / animLayer.shapeProps.sizeX)
        : 1;
      const screenRoundness = typeof rawRoundness === 'number' ? (rawRoundness * bufferScale * scaleRatio) : 0;

      let el = null;
      if (targetLayer.type === 'shape') {
        if (!targetLayer._shapeBufferCanvas || !(targetLayer._shapeBufferCanvas instanceof HTMLCanvasElement)) {
          targetLayer._shapeBufferCanvas = document.createElement('canvas');
        }
        const pw = Math.max(1, Math.round(Math.abs((targetLayer.shapeProps && targetLayer.shapeProps.sizeX) || targetLayer.scaleW || 300)));
        const ph = Math.max(1, Math.round(Math.abs((targetLayer.shapeProps && targetLayer.shapeProps.sizeY) || targetLayer.scaleH || 300)));
        if (typeof window.renderShapeToCanvas === 'function') {
          window.renderShapeToCanvas(targetLayer, targetLayer._shapeBufferCanvas, pw, ph);
        }
        el = targetLayer._shapeBufferCanvas;
      } else if (targetLayer.type === 'text') {
        if (targetLayer._textBufferCanvas) {
          el = targetLayer._textBufferCanvas;
        } else if (window.FishTextEngine && typeof window.FishTextEngine.renderTextToCanvas === 'function') {
          if (!targetLayer._textBufferCanvas) targetLayer._textBufferCanvas = document.createElement('canvas');
          const nat = (window.FishTextEngine.getNaturalSize) ? window.FishTextEngine.getNaturalSize(targetLayer) : { width: 320, height: 100 };
          const pw = Math.max(1, Math.round(nat.width));
          const ph = Math.max(1, Math.round(nat.height));
          window.FishTextEngine.renderTextToCanvas(targetLayer, targetLayer._textBufferCanvas, pw, ph);
          el = targetLayer._textBufferCanvas;
        }
      } else if (targetLayer.type === 'precomp') {
        el = targetLayer._precompBufferCanvas || null;
      } else {
        const isNativeMedia = (targetLayer.type === 'video' || targetLayer.type === 'image');
        const effectiveFill = targetLayer.fillType || (isNativeMedia ? 'media' : (targetLayer.fillColor ? 'color' : 'none'));
        if (effectiveFill === 'color' || effectiveFill === 'gradient' || (!isNativeMedia && effectiveFill === 'media')) {
          if (typeof window.getOrUpdateLayerFillCanvas === 'function') {
            const pw = Math.max(1, Math.round(Math.abs(targetLayer.mediaWidth || targetLayer.scaleW || visualWidth || 300)));
            const ph = Math.max(1, Math.round(Math.abs(targetLayer.mediaHeight || targetLayer.scaleH || visualHeight || 300)));
            el = window.getOrUpdateLayerFillCanvas(targetLayer, pw, ph);
          }
        }
        if (!el && typeof window.getOrLoadLayerMedia === 'function') {
          const m = window.getOrLoadLayerMedia(targetLayer);
          if (m && m.el) el = m.el;
        }
        if (el && typeof HTMLImageElement !== 'undefined' && el instanceof HTMLImageElement && (!el.complete || el.naturalWidth === 0)) {
          if (!el._snapshotLoadBound) {
            el._snapshotLoadBound = true;
            el.addEventListener('load', () => {
              el._contentVersion = (el._contentVersion || 0) + 1;
              if (typeof window !== 'undefined' && typeof window.redrawComposition === 'function') {
                window.redrawComposition('snapshotImageLoaded');
              }
            }, { once: true });
          }
        }
      }
      if (!el && targetLayer._lastRenderedFrame) el = targetLayer._lastRenderedFrame;

      if (!el) {
        const fb = document.createElement('canvas');
        fb.width = Math.max(1, Math.round(visualWidth));
        fb.height = Math.max(1, Math.round(visualHeight));
        return {
          el: fb,
          canvas: fb,
          width: visualWidth,
          height: visualHeight,
          cx: screenCenterX,
          cy: screenCenterY,
          rotation: visualRotation,
          roundness: screenRoundness,
          rawRoundness: rawRoundness,
          corners: corners,
          bufferScale: bufferScale,
          bounds: { x: screenCenterX - visualWidth / 2, y: screenCenterY - visualHeight / 2, w: visualWidth, h: visualHeight, cx: screenCenterX, cy: screenCenterY },
          layer: animLayer
        };
      }

      return {
        el,
        canvas: el,
        width: visualWidth,
        height: visualHeight,
        cx: screenCenterX,
        cy: screenCenterY,
        rotation: visualRotation,
        roundness: screenRoundness,
        rawRoundness: rawRoundness,
        corners: corners,
        bufferScale: bufferScale,
        bounds: { x: screenCenterX - visualWidth / 2, y: screenCenterY - visualHeight / 2, w: visualWidth, h: visualHeight, cx: screenCenterX, cy: screenCenterY },
        layer: animLayer
      };
    },

    ensureLayerEffects(layer) {
      if (!layer) return [];
      if (!Array.isArray(layer.effects)) {
        layer.effects = [];
        if (layer.hasBrightnessContrast) {
          layer.effects.push({
            id: 'fx_bc_' + (layer.id || Date.now()),
            type: 'brightness-contrast',
            name: 'Brightness / Contrast',
            isExpanded: true,
            disabled: !!layer.effectsDisabled,
            brightness: layer.brightness !== undefined ? layer.brightness : 0,
            contrast: layer.contrast !== undefined ? layer.contrast : 0
          });
        }
      }
      return layer.effects;
    },

    _filterSupported: null,
    isCanvasFilterSupported() {
      if (this._filterSupported !== null) return this._filterSupported;
      if (typeof document === 'undefined') {
        this._filterSupported = false;
        return false;
      }
      try {
        const c = document.createElement('canvas');
        c.width = 2; c.height = 2;
        const ctx = c.getContext('2d');
        if (!ctx || !('filter' in ctx)) {
          this._filterSupported = false;
          return false;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 2, 2);
        const c2 = document.createElement('canvas');
        c2.width = 2; c2.height = 2;
        const ctx2 = c2.getContext('2d');
        ctx2.filter = 'invert(100%)';
        ctx2.drawImage(c, 0, 0);
        const p = ctx2.getImageData(0, 0, 1, 1).data;
        this._filterSupported = (p[0] === 0 && p[1] === 0 && p[2] === 0);
      } catch (_) {
        this._filterSupported = false;
      }
      return this._filterSupported;
    },

    _blurCanvases: [],
    _getBlurCanvas(index, w, h) {
      if (!this._blurCanvases[index]) {
        const c = document.createElement('canvas');
        this._blurCanvases[index] = { canvas: c, ctx: c.getContext('2d') };
      }
      const entry = this._blurCanvases[index];
      const nw = Math.max(1, Math.round(w));
      const nh = Math.max(1, Math.round(h));
      if (entry.canvas.width !== nw || entry.canvas.height !== nh) {
        entry.canvas.width = nw;
        entry.canvas.height = nh;
      }
      return entry;
    },

    drawBlurred(targetCtx, srcEl, w, h, radius, dx, dy) {
      if (!targetCtx || !srcEl) return;
      const r = Math.max(0, Number(radius) || 0);
      const dw = Math.max(1, Math.round(w));
      const dh = Math.max(1, Math.round(h));
      const ox = (dx !== undefined && !isNaN(dx)) ? Math.round(dx) : 0;
      const oy = (dy !== undefined && !isNaN(dy)) ? Math.round(dy) : 0;
      if (r <= 0.5) {
        try { targetCtx.drawImage(srcEl, ox, oy, dw, dh); } catch (_) {}
        return;
      }

      // 1. WebGL Fast GPU Separable Gaussian Blur (100% smooth, Safari & Chrome compatible)
      if (!_blurGLFailed && initBlurGL()) {
        try {
          const gl = _blurGL;
          const prog = _blurGLProg;
          const u = _blurGLUniforms;

          // Adaptive downscaling for massive radii:
          const downscale = r <= 4 ? 1 : (r <= 16 ? 2 : 4);
          const bw = Math.max(2, Math.round(dw / downscale));
          const bh = Math.max(2, Math.round(dh / downscale));

          if (_blurGLCanvas.width !== bw || _blurGLCanvas.height !== bh) {
            _blurGLCanvas.width = bw;
            _blurGLCanvas.height = bh;
          }

          gl.useProgram(prog);

          if (_blurGLW !== bw || _blurGLH !== bh) {
            _blurGLW = bw;
            _blurGLH = bh;

            gl.bindTexture(gl.TEXTURE_2D, _blurGLTex0);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, _blurGLFBO0);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _blurGLTex0, 0);

            gl.bindTexture(gl.TEXTURE_2D, _blurGLTex1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, _blurGLFBO1);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _blurGLTex1, 0);
          }

          // Upload source image to Tex0
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, _blurGLTex0);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          let uploaded = false;
          try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcEl);
            uploaded = true;
          } catch (_) {
            if (!_blurScratchCanvas) {
              _blurScratchCanvas = document.createElement('canvas');
              _blurScratchCtx = _blurScratchCanvas.getContext('2d');
            }
            const sw = Math.min(1920, srcEl.videoWidth || srcEl.naturalWidth || srcEl.width || bw);
            const sh = Math.min(1080, srcEl.videoHeight || srcEl.naturalHeight || srcEl.height || bh);
            if (_blurScratchCanvas.width !== sw || _blurScratchCanvas.height !== sh) {
              _blurScratchCanvas.width = sw;
              _blurScratchCanvas.height = sh;
            }
            _blurScratchCtx.clearRect(0, 0, sw, sh);
            _blurScratchCtx.drawImage(srcEl, 0, 0, sw, sh);
            try {
              gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, _blurScratchCanvas);
              uploaded = true;
            } catch (_) {}
          }

          if (uploaded) {
            gl.viewport(0, 0, bw, bh);

            const posLoc = gl.getAttribLocation(prog, 'a_pos');
            gl.bindBuffer(gl.ARRAY_BUFFER, _blurGLPosBuf);
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

            const uvLoc = gl.getAttribLocation(prog, 'a_uv');
            gl.bindBuffer(gl.ARRAY_BUFFER, _blurGLUvBuf);
            gl.enableVertexAttribArray(uvLoc);
            gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

            gl.uniform1i(u.texture, 0);

            const effRadius = r / downscale;
            const passes = downscale === 4 ? 2 : 1;
            const step = (effRadius / passes) * 0.70;

            let srcTex = _blurGLTex0;
            let dstFBO = _blurGLFBO1;
            let dstTex = _blurGLTex1;

            for (let p = 0; p < passes; p++) {
              // Horizontal Pass
              gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO);
              gl.bindTexture(gl.TEXTURE_2D, srcTex);
              gl.uniform2f(u.delta, step / bw, 0.0);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

              // Vertical Pass
              const isFinal = (p === passes - 1);
              if (isFinal) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.bindTexture(gl.TEXTURE_2D, dstTex);
                gl.uniform2f(u.delta, 0.0, step / bh);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              } else {
                gl.bindFramebuffer(gl.FRAMEBUFFER, srcTex === _blurGLTex0 ? _blurGLFBO0 : _blurGLFBO1);
                gl.bindTexture(gl.TEXTURE_2D, dstTex);
                gl.uniform2f(u.delta, 0.0, step / bh);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                // swap
                const tmp = srcTex; srcTex = dstTex; dstTex = tmp;
                dstFBO = (dstTex === _blurGLTex1) ? _blurGLFBO1 : _blurGLFBO0;
              }
            }

            targetCtx.save();
            targetCtx.imageSmoothingEnabled = true;
            targetCtx.imageSmoothingQuality = 'high';
            targetCtx.drawImage(_blurGLCanvas, ox, oy, dw, dh);
            targetCtx.restore();
            return;
          }
        } catch (_) {}
      }

      // 2. Native Canvas2D Filter fallback (if supported in Chrome/Firefox)
      if (this.isCanvasFilterSupported()) {
        targetCtx.save();
        targetCtx.filter = `blur(${r.toFixed(1)}px)`;
        try { targetCtx.drawImage(srcEl, ox, oy, dw, dh); } catch (_) {}
        targetCtx.restore();
        return;
      }

      // 3. Multi-Step Smooth Cascade Fallback (for non-WebGL environments)
      const steps = Math.min(3, Math.max(1, Math.round(Math.log2(1 + r * 0.2))));
      let curW = dw;
      let curH = dh;
      let prevCanvas = srcEl;

      for (let s = 0; s < steps; s++) {
        curW = Math.max(4, Math.round(curW * 0.5));
        curH = Math.max(4, Math.round(curH * 0.5));
        const entry = this._getBlurCanvas(s, curW, curH);
        entry.ctx.imageSmoothingEnabled = true;
        entry.ctx.imageSmoothingQuality = 'high';
        entry.ctx.clearRect(0, 0, curW, curH);
        entry.ctx.drawImage(prevCanvas, 0, 0, curW, curH);
        prevCanvas = entry.canvas;
      }

      targetCtx.save();
      targetCtx.imageSmoothingEnabled = true;
      targetCtx.imageSmoothingQuality = 'high';
      targetCtx.drawImage(prevCanvas, ox, oy, dw, dh);
      targetCtx.restore();
    },

    buildFilter(layer) {
      if (!layer || !this.isCanvasFilterSupported()) return '';
      const parts = [];

      if (Array.isArray(layer.effects) && layer.effects.length > 0) {
        for (let i = 0; i < layer.effects.length; i++) {
          const fx = layer.effects[i];
          if (!fx || fx.disabled === true) continue;
          const def = FishEffectsRegistry.get(fx.type);
          if (def && def.category === 'expression') continue;
          if (def && typeof def.render === 'function') continue;
          if (def && typeof def.filter === 'function') {
            const fStr = def.filter(fx);
            if (fStr) parts.push(fStr);
          }
        }
      } else if (layer.hasBrightnessContrast && layer.effectsDisabled !== true) {
        const def = FishEffectsRegistry.get('brightness-contrast');
        if (def && typeof def.render !== 'function' && typeof def.filter === 'function') {
          const fStr = def.filter(layer);
          if (fStr) parts.push(fStr);
        }
      }

      return parts.join(' ').trim();
    },

    applyToContext(ctx, layer) {
      if (!ctx || !layer || !this.isCanvasFilterSupported()) return;
      const filter = this.buildFilter(layer);
      if (filter) {
        ctx.filter = filter;
      }
    },

    renderRGBSplit(ctx, el, layer, bounds, fx) {
      const def = FishEffectsRegistry.get('rgb-split');
      if (def && typeof def.render === 'function') {
        def.render(ctx, el, layer, bounds, fx);
      } else if (ctx && el) {
        try { ctx.drawImage(el, bounds.x, bounds.y, bounds.w, bounds.h); } catch (_) {}
      }
    },

    renderTile(ctx, el, layer, bounds, fx, rgbSplitFx) {
      const def = FishEffectsRegistry.get('tile');
      if (def && typeof def.render === 'function') {
        def.render(ctx, el, layer, bounds, fx, rgbSplitFx);
      } else if (ctx && el) {
        try { ctx.drawImage(el, bounds.x, bounds.y, bounds.w, bounds.h); } catch (_) {}
      }
    },

    _pipelineCanvases: [],
    _getPipelineCanvas(index, w, h) {
      if (!this._pipelineCanvases[index]) {
        const c = document.createElement('canvas');
        this._pipelineCanvases[index] = { canvas: c, ctx: c.getContext('2d') };
      }
      const entry = this._pipelineCanvases[index];
      const nw = Math.max(1, Math.round(w));
      const nh = Math.max(1, Math.round(h));
      if (entry.canvas.width !== nw || entry.canvas.height !== nh) {
        entry.canvas.width = nw;
        entry.canvas.height = nh;
      }
      return entry;
    },

    /* ── Shared GPU helpers for warp-category effects ─────────────────────────────────────
     * 1) fxBindSourceTexture: skip texImage2D when the source is unchanged
     *    (IMG src / ImageBitmap identity / canvas._contentVersion — same convention as
     *    FishToolEngine). Unversioned sources (video, pipeline buffers) → return false → caller
     *    uploads as before.
     * 2) fxOutputDraw / fxOutputStore: identical inputs (source version, size, params,
     *    time-derived phase) reuse the previous result instead of re-running the shader.
     *    Hits: motion-blur sub-samples, paused redraws. Stores are skipped during plain
     *    playback (keys never repeat there) to avoid an extra copy.
     * 3) fxFitGLCanvas: grow-only GL canvas → no drawing-buffer realloc when size changes per
     *    sample. Returns the Y offset of the rendered region (GL origin is bottom-left).
     * Kill switch: window.OFT_FX_CACHE_OFF = true.
     */
    _fxObjIds: (typeof WeakMap !== 'undefined') ? new WeakMap() : null,
    _fxObjSeq: 0,
    _fxOut: new Map(),

    fxSourceKey(el) {
      if (!el || typeof el !== 'object' || !this._fxObjIds) return null;
      if (typeof window !== 'undefined' && window.OFT_FX_CACHE_OFF === true) return null;
      const tag = el.tagName;
      let ver = null;
      if (tag === 'IMG') {
        if (!el.complete || !el.naturalWidth) return null;
        const src = el.currentSrc || el.src || '';
        ver = 'i' + src.length + ':' + src.slice(-48);
      } else if (tag === 'CANVAS' || (typeof OffscreenCanvas !== 'undefined' && el instanceof OffscreenCanvas)) {
        if (typeof el._contentVersion !== 'number') return null;
        ver = 'c' + el._contentVersion + ':' + el.width + 'x' + el.height;
      } else if (typeof ImageBitmap !== 'undefined' && el instanceof ImageBitmap) {
        ver = 'b';
      } else {
        return null; // video / unknown → always fresh
      }
      let id = this._fxObjIds.get(el);
      if (!id) { id = ++this._fxObjSeq; this._fxObjIds.set(el, id); }
      return id + ':' + ver;
    },

    fxBindSourceTexture(gl, el) {
      if (!gl || (typeof gl.isContextLost === 'function' && gl.isContextLost())) {
        if (gl) gl.__fxTexCache = null;
        return false;
      }
      const key = this.fxSourceKey(el);
      if (!key) return false;
      let st = gl.__fxTexCache;
      if (!st) {
        st = gl.__fxTexCache = { list: [] };
        // Context loss invalidates texture objects; drop the cache (no per-hit gl.isTexture sync call).
        if (!gl.__fxLossHooked && gl.canvas && typeof gl.canvas.addEventListener === 'function') {
          gl.__fxLossHooked = true;
          gl.canvas.addEventListener('webglcontextlost', () => { gl.__fxTexCache = null; }, false);
        }
      }
      const list = st.list;
      for (let i = 0; i < list.length; i++) {
        if (list[i].key === key) {
          const hit = list[i];
          if (i !== list.length - 1) { list.splice(i, 1); list.push(hit); }
          gl.bindTexture(gl.TEXTURE_2D, hit.tex);
          return true;
        }
      }
      let entry;
      if (list.length >= 4) {
        entry = list.shift();
      } else {
        entry = { key: null, tex: gl.createTexture() };
        gl.bindTexture(gl.TEXTURE_2D, entry.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      } catch (_) {
        entry.key = null;
        list.unshift(entry); // keep the texture object for reuse
        return false;
      }
      entry.key = key;
      list.push(entry);
      return true;
    },

    fxOutputKey(el, rw, rh, paramSig) {
      const sk = this.fxSourceKey(el);
      return sk ? (sk + '|' + rw + 'x' + rh + '|' + paramSig) : null;
    },

    fxOutputDraw(effectId, key, ctx, x, y, w, h) {
      if (!key || !ctx) return false;
      const list = this._fxOut.get(effectId);
      if (!list) return false;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.key === key) {
          try { ctx.drawImage(e.canvas, 0, 0, e.w, e.h, x, y, w, h); } catch (_) { return false; }
          return true;
        }
      }
      return false;
    },

    fxOutputStore(effectId, key, src, sx, sy, sw, sh) {
      if (!key || !src || typeof document === 'undefined') return;
      const w = (typeof window !== 'undefined') ? window : {};
      const mb = w.FishMotionBlurEngine;
      const inSub = !!(mb && typeof mb.isInSubSample === 'function' && mb.isInSubSample());
      if (!inSub) {
        // Two-touch: outside a motion-blur pass only cache keys that actually repeat
        // (paused redraws). Scrubbing / playback keys are unique → no copy cost.
        if (w.isTimelinePlaying) return;
        const seen = this._fxSeen || (this._fxSeen = []);
        const sk = effectId + '#' + key;
        const idx = seen.indexOf(sk);
        if (idx < 0) { seen.push(sk); if (seen.length > 16) seen.shift(); return; }
        seen.splice(idx, 1);
      }
      if (sw * sh > 4194304) return; // > 4 MP: not worth the memory
      let list = this._fxOut.get(effectId);
      if (!list) { list = []; this._fxOut.set(effectId, list); }
      let e = null;
      for (let i = 0; i < list.length; i++) {
        if (list[i].key === key) { e = list.splice(i, 1)[0]; break; }
      }
      if (!e) {
        if (list.length >= 6) e = list.shift();
        else { const c = document.createElement('canvas'); e = { canvas: c, ctx: c.getContext('2d'), key: null, w: 0, h: 0 }; }
      }
      if (!e.ctx) return;
      if (e.canvas.width < sw || e.canvas.height < sh) {
        e.canvas.width = Math.max(e.canvas.width, sw);
        e.canvas.height = Math.max(e.canvas.height, sh);
      }
      e.ctx.setTransform(1, 0, 0, 1, 0, 0);
      e.ctx.globalAlpha = 1;
      e.ctx.globalCompositeOperation = 'copy';
      try {
        e.ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
      } catch (_) {
        e.ctx.globalCompositeOperation = 'source-over';
        return;
      }
      e.ctx.globalCompositeOperation = 'source-over';
      e.key = key; e.w = sw; e.h = sh;
      list.push(e);
    },

    fxFitGLCanvas(canvas, rw, rh) {
      if (!canvas) return 0;
      if (canvas.width < rw || canvas.height < rh) {
        // Headroom (1.25×, 64px-aligned) for small layers so gradual scale-ups don't realloc every
        // sample. Large (≥1 MP, e.g. adjustment / full-comp) renders get the exact size.
        const small = rw * rh < 1048576;
        const up = (v) => small ? Math.max(v, Math.min(8192, Math.ceil((v * 1.25) / 64) * 64)) : v;
        canvas.width = Math.max(canvas.width, canvas.width < rw ? up(rw) : 0);
        canvas.height = Math.max(canvas.height, canvas.height < rh ? up(rh) : 0);
        canvas.__fxOversize = 0;
      } else if (canvas.width * canvas.height > 4 * rw * rh && canvas.width * canvas.height > 1048576) {
        // Shrink only after a sustained run of much smaller renders (frees VRAM without thrashing).
        canvas.__fxOversize = (canvas.__fxOversize || 0) + 1;
        if (canvas.__fxOversize > 240) {
          canvas.width = rw;
          canvas.height = rh;
          canvas.__fxOversize = 0;
        }
      } else {
        canvas.__fxOversize = 0;
      }
      return canvas.height - rh;
    },

    /* ── GPU effect chain ────────────────────────────────────────────────────────────────
     * Consecutive effects that expose `def.gpu` (warp category) run in ONE WebGL context:
     *   upload source once → effect passes ping-pong between FBOs → read back once.
     * Before: every stacked effect = full-size texImage2D + shader + GPU→2D readback + 2D clear
     * (adjustment layers: full-canvas each time). The step-to-step semantics of the 2D pipeline
     * are kept: each step renders into its rect inside a pipe-size target, the next step samples
     * the whole target, and an un-premultiply pass reproduces the 2D-canvas round-trip.
     * def.gpu = { fs, supports(fx) → bool, setup(gl, U, fx, layer, info) }
     *   info = { w, h (float render size), rw, rh (int resolution), sec }; U(name) → location.
     * Draft mode renders the chain at half resolution (all pixel params scale with it).
     * Kill switch: window.OFT_FX_CHAIN_OFF = true.
     */
    _chain: null,
    _CHAIN_VS: [
      'attribute vec2 a_pos;',
      'attribute vec2 a_uv;',
      'varying vec2 v_uv;',
      'uniform float u_flipY;',
      'void main(void) {',
      '  v_uv = a_uv;',
      '  gl_Position = vec4(a_pos.x, a_pos.y * u_flipY, 0.0, 1.0);',
      '}'
    ].join('\n'),
    _CHAIN_UNPREMUL_FS: [
      'precision highp float;',
      'varying vec2 v_uv;',
      'uniform sampler2D u_image;',
      'void main(void) {',
      '  vec4 c = texture2D(u_image, v_uv);',
      '  gl_FragColor = c.a > 0.0 ? vec4(clamp(c.rgb / c.a, 0.0, 1.0), c.a) : vec4(0.0);',
      '}'
    ].join('\n'),

    _chainGet() {
      const w = (typeof window !== 'undefined') ? window : {};
      if (w.OFT_FX_CHAIN_OFF === true || typeof document === 'undefined') return null;
      if (this._chain) return this._chain.ok ? this._chain : null;
      const ch = this._chain = { ok: false };
      try {
        const canvas = document.createElement('canvas');
        const opts = { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false };
        const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
        if (!gl) return null;
        ch.canvas = canvas;
        ch.gl = gl;
        ch.progs = new Map();
        ch.badFx = new Set();
        const mkBuf = (arr) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); return b; };
        ch.pos = mkBuf([-1, 1, -1, -1, 1, 1, 1, -1]);
        ch.uv = mkBuf([0, 0, 0, 1, 1, 0, 1, 1]);
        const mkTex = () => {
          const t = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          return t;
        };
        ch.srcTex = mkTex();
        ch.srcKey = null;
        ch.fbo = [0, 1].map(() => ({ fb: gl.createFramebuffer(), tex: mkTex(), w: 0, h: 0 }));
        ch.mkTex = mkTex;
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); // same upload semantics as the per-effect paths
        ch.unpremul = this._chainProgram(ch, '__unpremul', this._CHAIN_UNPREMUL_FS);
        canvas.addEventListener('webglcontextlost', () => { this._chain = null; }, false);
        ch.ok = !!ch.unpremul;
        return ch.ok ? ch : null;
      } catch (e) {
        console.warn('[FishEffects] GPU chain unavailable:', e);
        return null;
      }
    },

    _chainProgram(ch, id, fs) {
      if (ch.progs.has(id)) return ch.progs.get(id);
      const gl = ch.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn('[FishEffects] GPU chain shader error (' + id + '):', gl.getShaderInfoLog(s));
          return null;
        }
        return s;
      };
      const vs = sh(gl.VERTEX_SHADER, this._CHAIN_VS);
      const f = sh(gl.FRAGMENT_SHADER, fs);
      let p = null;
      if (vs && f) {
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, f);
        gl.linkProgram(prog);
        if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          const locs = new Map();
          p = {
            prog,
            aPos: gl.getAttribLocation(prog, 'a_pos'),
            aUv: gl.getAttribLocation(prog, 'a_uv'),
            uFlip: gl.getUniformLocation(prog, 'u_flipY'),
            uImage: gl.getUniformLocation(prog, 'u_image'),
            U: (name) => { if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name)); return locs.get(name); }
          };
        } else {
          console.warn('[FishEffects] GPU chain link error (' + id + '):', gl.getProgramInfoLog(prog));
        }
      }
      ch.progs.set(id, p);
      return p;
    },

    _chainEnsureFbo(ch, f, w, h) {
      const gl = ch.gl;
      if (f.w !== w || f.h !== h) {
        gl.bindTexture(gl.TEXTURE_2D, f.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.tex, 0);
        f.w = w; f.h = h;
      }
    },

    _chainDraw(ch, p, tex, flipY) {
      const gl = ch.gl;
      gl.useProgram(p.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, ch.pos);
      gl.enableVertexAttribArray(p.aPos);
      gl.vertexAttribPointer(p.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, ch.uv);
      gl.enableVertexAttribArray(p.aUv);
      gl.vertexAttribPointer(p.aUv, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(p.uImage, 0);
      gl.uniform1f(p.uFlip, flipY);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    /** Can this effect run inside the GPU chain? */
    _chainCapable(fx) {
      if (!fx) return false;
      const def = FishEffectsRegistry.get(fx.type);
      const g = def && def.gpu;
      if (!g || typeof g.setup !== 'function' || !g.fs) return false;
      if (this._chain && this._chain.badFx && this._chain.badFx.has(fx.type)) return false;
      try { return typeof g.supports !== 'function' || !!g.supports(fx); } catch (_) { return false; }
    },

    _chainScale() {
      const w = (typeof window !== 'undefined') ? window : {};
      const mb = w.FishMotionBlurEngine;
      const q = (mb && typeof mb.getQuality === 'function') ? mb.getQuality() : null;
      return (q && q.isDraft && !q.isExport) ? 0.5 : 1;
    },

    /**
     * Run steps[] (each { fx, def, rect: {x,y,w,h} inside the pipe target, size: {w,h} render size })
     * on the GPU. Intermediate steps write into a pipe-size FBO (pipeW×pipeH); the last step renders
     * at `size` into the default framebuffer. Returns { canvas, oy, rw, rh } (region to blit) or null.
     */
    _chainRun(source, steps, layer, sec, pipeW, pipeH, s) {
      const ch = this._chainGet();
      if (!ch || !steps.length) return null;
      const gl = ch.gl;
      if (gl.isContextLost && gl.isContextLost()) { this._chain = null; return null; }

      // Upload source once (skip if unchanged & versioned)
      const sk = this.fxSourceKey(source);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ch.srcTex);
      if (!sk || sk !== ch.srcKey) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        ch.srcKey = sk;
      }

      const PW = Math.max(1, Math.round(pipeW * s));
      const PH = Math.max(1, Math.round(pipeH * s));
      const A = ch.fbo[0], B = ch.fbo[1];
      let inputTex = ch.srcTex;
      let out = null;

      for (let k = 0; k < steps.length; k++) {
        const st = steps[k];
        const p = this._chainProgram(ch, st.fx.type, st.def.gpu.fs);
        if (!p) { ch.badFx.add(st.fx.type); throw new Error('chain program failed: ' + st.fx.type); }
        const fw = st.size.w * s, fh = st.size.h * s;
        const rw = Math.max(1, Math.round(fw)), rh = Math.max(1, Math.round(fh));
        const isLastStep = (k === steps.length - 1);

        if (!isLastStep) {
          // Effect → A (pipe-size, cleared), drawn into its rect; orientation: image top = row 0
          this._chainEnsureFbo(ch, A, PW, PH);
          gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
          gl.viewport(0, 0, PW, PH);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.viewport(Math.round(st.rect.x * s), Math.round(st.rect.y * s), rw, rh);
          gl.useProgram(p.prog);
          st.def.gpu.setup(gl, p.U, st.fx, layer, { w: fw, h: fh, rw, rh, sec });
          this._chainDraw(ch, p, inputTex, -1.0);
          // A → B un-premultiply (mirrors 2D canvas store + texImage2D un-premultiply)
          this._chainEnsureFbo(ch, B, PW, PH);
          gl.bindFramebuffer(gl.FRAMEBUFFER, B.fb);
          gl.viewport(0, 0, PW, PH);
          this._chainDraw(ch, ch.unpremul, A.tex, -1.0);
          inputTex = B.tex;
        } else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          const oy = this.fxFitGLCanvas(ch.canvas, rw, rh);
          gl.viewport(0, 0, ch.canvas.width, ch.canvas.height);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.viewport(0, 0, rw, rh);
          gl.useProgram(p.prog);
          st.def.gpu.setup(gl, p.U, st.fx, layer, { w: fw, h: fh, rw, rh, sec });
          this._chainDraw(ch, p, inputTex, 1.0);
          out = { canvas: ch.canvas, oy, rw, rh };
        }
      }
      return out;
    },

    isEffectIdentity(fx) {
      if (!fx || fx.disabled) return true;
      const type = fx.type;
      if (type === 'wave-warp') {
        return Math.abs(fx.waveHeight !== undefined ? fx.waveHeight : 25) < 0.05;
      }
      if (type === 'hue-shift') {
        const rawHue = fx.hue !== undefined ? Number(fx.hue) : 0;
        const normAngle = ((rawHue % 360) + 360) % 360;
        return Math.abs(normAngle) < 0.1 || Math.abs(normAngle - 360) < 0.1;
      }
      if (type === 'transform') {
        const s = fx.scale !== undefined ? Number(fx.scale) : 100;
        const r = fx.rotation !== undefined ? Number(fx.rotation) : 0;
        const x = fx.posX !== undefined ? Number(fx.posX) : 0;
        const y = fx.posY !== undefined ? Number(fx.posY) : 0;
        const sk = fx.skew !== undefined ? Number(fx.skew) : 0;
        const op = fx.opacity !== undefined ? Number(fx.opacity) : 100;
        return s === 100 && r === 0 && x === 0 && y === 0 && sk === 0 && op === 100;
      }
      if (type === 'brightness-contrast' || type === 'brightness_contrast') {
        return (!fx.brightness) && (!fx.contrast);
      }
      if (type === 'fast-box-blur' || type === 'fast_box_blur') {
        return !fx.radius || fx.radius <= 0.1;
      }
      if (type === 'gaussian-blur' || type === 'gaussian_blur') {
        return !fx.blur || fx.blur <= 0.1;
      }
      if (type === 'drop-shadow') {
        const op = fx.opacity !== undefined ? fx.opacity : 75;
        const blur = fx.blur !== undefined ? fx.blur : 10;
        const dist = fx.distance !== undefined ? fx.distance : 15;
        return op <= 0 || (blur <= 0 && dist <= 0);
      }
      return false;
    },

    hasNonIdentityEffects(layer) {
      if (!layer || !Array.isArray(layer.effects) || layer.effects.length === 0) return false;
      return layer.effects.some(fx => !this.isEffectIdentity(fx));
    },

    renderLayer(ctx, el, layer, bounds, currentSec) {
      if (!ctx || !el) return;
      const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
      const by = bounds && bounds.y !== undefined ? bounds.y : 0;
      const bw = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const bh = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));
      const normBounds = { x: bx, y: by, w: bw, h: bh, bufferScale: (bounds && bounds.bufferScale) || 1, unitScale: (bounds && bounds.unitScale > 0) ? bounds.unitScale : ((bounds && bounds.bufferScale) || 1), baseW: bounds && bounds.baseW, baseH: bounds && bounds.baseH };

      const effectiveSec = (typeof currentSec === 'number' && !isNaN(currentSec))
        ? currentSec
        : (layer && typeof layer._currentSec === 'number'
          ? layer._currentSec
          : (typeof window !== 'undefined'
            ? (typeof window._currentRenderSec === 'number' && !isNaN(window._currentRenderSec)
              ? window._currentRenderSec
              : (window.currentPlaybackSec !== undefined ? window.currentPlaybackSec : window.currentSec))
            : 0));

      const effects = Array.isArray(layer && layer.effects) ? layer.effects.filter(f => f && !f.disabled) : [];
      if (effects.length === 0) {
        try { ctx.drawImage(el, bx, by, bw, bh); } catch (_) {}
        return;
      }

      // Check legacy combo: tile + rgb-split
      const tileFx = effects.find(f => f.type === 'tile');
      const rgbSplitFx = effects.find(f => f.type === 'rgb-split' && ((f.distance !== undefined ? f.distance : 8) > 0));

      const renderEffects = effects.filter(f => {
        const def = FishEffectsRegistry.get(f.type);
        if (!def || def.category === 'expression') return false;
        if (typeof def.render !== 'function') return false;
        return !this.isEffectIdentity(f);
      });

      if (renderEffects.length === 0) {
        try { ctx.drawImage(el, bx, by, bw, bh); } catch (_) {}
        return;
      }

      // If tile is present with optional rgbSplit, use existing optimized renderTile
      if (tileFx && renderEffects.length === (rgbSplitFx ? 2 : 1)) {
        this.renderTile(ctx, el, layer, normBounds, tileFx, rgbSplitFx);
        return;
      }

      const chainScale = this._chainScale();

      // Single custom render effect: draw straight into ctx
      if (renderEffects.length === 1) {
        const fx = renderEffects[0];
        const def = FishEffectsRegistry.get(fx.type);
        // Draft: run GPU-capable effect through the chain at half resolution
        if (chainScale < 1 && this._chainCapable(fx)) {
          try {
            const r = this._chainRun(el, [{ fx, def, rect: { x: 0, y: 0, w: bw, h: bh }, size: { w: bw, h: bh } }], layer, effectiveSec, bw, bh, chainScale);
            if (r) { ctx.drawImage(r.canvas, 0, r.oy, r.rw, r.rh, bx, by, bw, bh); return; }
          } catch (err) {
            console.warn('[FishEffects] GPU chain failed, using per-effect path:', err);
          }
        }
        try {
          def.render(ctx, el, layer, normBounds, fx, effectiveSec);
        } catch (err) {
          console.warn('[FishEffects] Render error on ' + fx.type + ':', err);
          try { ctx.drawImage(el, bx, by, bw, bh); } catch (_) {}
        }
        return;
      }

      // Multi-effect pipeline: chain through offscreen buffers
      const hasExpandingFx = renderEffects.some(f => {
        const d = FishEffectsRegistry.get(f.type);
        if ((d && (d.isExpanding || d.category === 'warp')) || f.type === 'transform' || f.type === 'tile' || f.type === 'fsmb') return true;
        if (f.type === 'deep-glow' && (f.outLayer === 1 || f.outLayer === true || f.outLayer === '1' || f.outLayer === 'true' || f.outLayer === 'on')) return true;
        return false;
      });
      let pipeW = bw;
      let pipeH = bh;
      let offX = 0;
      let offY = 0;

      if (hasExpandingFx) {
        const targetCanvas = ctx.canvas;
        const cw = targetCanvas ? targetCanvas.width : (bw * 2);
        const ch = targetCanvas ? targetCanvas.height : (bh * 2);
        pipeW = Math.max(bw, Math.min(cw, 3840));
        pipeH = Math.max(bh, Math.min(ch, 2160));
        offX = Math.round((pipeW - bw) / 2);
        offY = Math.round((pipeH - bh) / 2);
      }

      const lastIdx = renderEffects.length - 1;
      const finalBounds = hasExpandingFx
        ? { x: normBounds.x - offX, y: normBounds.y - offY, w: pipeW, h: pipeH, bufferScale: normBounds.bufferScale, unitScale: normBounds.unitScale, baseW: normBounds.baseW, baseH: normBounds.baseH }
        : normBounds;

      let currentSource = el;
      for (let i = 0; i < renderEffects.length; i++) {
        // GPU chain: consecutive GPU-capable effects run in one context (1 upload, 1 readback)
        if (this._chainCapable(renderEffects[i])) {
          let j = i;
          while (j + 1 <= lastIdx && this._chainCapable(renderEffects[j + 1])) j++;
          if (j > i || chainScale < 1) {
            const steps = [];
            for (let k = i; k <= j; k++) {
              const isFinal = (k === lastIdx);
              steps.push({
                fx: renderEffects[k],
                def: FishEffectsRegistry.get(renderEffects[k].type),
                rect: { x: offX, y: offY, w: bw, h: bh },
                size: isFinal ? { w: finalBounds.w, h: finalBounds.h } : { w: bw, h: bh }
              });
            }
            let r = null;
            try {
              r = this._chainRun(currentSource, steps, layer, effectiveSec, pipeW, pipeH, chainScale);
            } catch (err) {
              console.warn('[FishEffects] GPU chain failed, using per-effect path:', err);
              r = null;
            }
            if (r) {
              if (j === lastIdx) {
                try { ctx.drawImage(r.canvas, 0, r.oy, r.rw, r.rh, finalBounds.x, finalBounds.y, finalBounds.w, finalBounds.h); } catch (_) {}
                return;
              }
              const cbuf = this._getPipelineCanvas(j % 2, pipeW, pipeH);
              cbuf.ctx.clearRect(0, 0, pipeW, pipeH);
              cbuf.ctx.drawImage(r.canvas, 0, r.oy, r.rw, r.rh, offX, offY, bw, bh);
              currentSource = cbuf.canvas;
              i = j;
              continue;
            }
            // chain unavailable → fall through to the per-effect path for effect i
          }
        }

        const fx = renderEffects[i];
        const def = FishEffectsRegistry.get(fx.type);
        const isLast = (i === lastIdx);
        const buf = this._getPipelineCanvas(i % 2, pipeW, pipeH);
        const targetCtx = isLast ? ctx : buf.ctx;
        const targetBounds = isLast
          ? finalBounds
          : { x: offX, y: offY, w: bw, h: bh, bufferScale: normBounds.bufferScale, unitScale: normBounds.unitScale };

        if (!isLast) {
          buf.ctx.clearRect(0, 0, pipeW, pipeH);
        }

        try {
          def.render(targetCtx, currentSource, layer, targetBounds, fx, effectiveSec);
        } catch (err) {
          console.warn('[FishEffects] Multi-pipeline render error on ' + fx.type + ':', err);
          try { targetCtx.drawImage(currentSource, targetBounds.x, targetBounds.y, targetBounds.w, targetBounds.h); } catch (_) {}
        }

        if (!isLast) {
          currentSource = buf.canvas;
        }
      }

      // Poison Pill Final Pass: Stamp watermark if unauthorized
      if (!isWasmAuthorized && wasmWatermarkImg && wasmWatermarkImg.complete && ctx && renderEffects.length > 0) {
        try {
          const targetCanvas = ctx.canvas;
          const compW = Math.max(1, targetCanvas ? targetCanvas.width : 1920);
          const compH = Math.max(1, targetCanvas ? targetCanvas.height : 1080);
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(wasmWatermarkImg, 0, 0, compW, compH);
          ctx.restore();
        } catch (_) {}
      }
    },

    loadEffectFromXML(xmlText) {
      if (!xmlText || typeof DOMParser === 'undefined') return null;
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'text/xml');
        const effectEl = doc.querySelector('effect');
        if (!effectEl) return null;

        const id = effectEl.getAttribute('id');
        const name = effectEl.getAttribute('name') || id;
        const category = effectEl.getAttribute('category') || 'lightning';
        const icon = effectEl.getAttribute('icon') || 'assets/FXPH.svg';
        const descEl = effectEl.querySelector('description');
        const description = descEl ? descEl.textContent.trim() : '';

        const params = [];
        const paramEls = effectEl.querySelectorAll('params > param');
        paramEls.forEach(p => {
          const pId = p.getAttribute('id');
          const pLabel = p.getAttribute('label') || pId;
          const pType = p.getAttribute('type') || 'number';
          const pMin = p.hasAttribute('min') ? parseFloat(p.getAttribute('min')) : -100;
          const pMax = p.hasAttribute('max') ? parseFloat(p.getAttribute('max')) : 100;
          const pUnit = p.getAttribute('unit') || '';
          let pDef = p.getAttribute('default');
          if (pType === 'number') pDef = pDef !== null ? parseFloat(pDef) : 0;
          else if (pType === 'switch' || pType === 'boolean') pDef = pDef === '0' || pDef === 'false' ? 0 : 1;

          const paramObj = { id: pId, label: pLabel, type: pType, min: pMin, max: pMax, default: pDef, unit: pUnit };
          if (p.hasAttribute('step')) {
            paramObj.step = parseFloat(p.getAttribute('step'));
          }
          if (p.hasAttribute('options')) {
            paramObj.options = p.getAttribute('options').split(',').map(s => s.trim());
          }
          params.push(paramObj);
        });

        const existing = FishEffectsRegistry.get(id);
        const def = {
          id,
          name,
          category,
          icon,
          description,
          params,
          filter: existing ? existing.filter : null,
          render: existing ? existing.render : null,
          renderPost: existing ? existing.renderPost : null
        };
        FishEffectsRegistry.register(def);
        return def;
      } catch (e) {
        console.error('[FishEffects:XML] Error parsing effect XML:', e);
        return null;
      }
    },

    applyPostEffects(ctx, el, layer, bounds) {
      if (!ctx || !layer || !Array.isArray(layer.effects) || layer.effects.length === 0) return;
      for (let i = 0; i < layer.effects.length; i++) {
        const fx = layer.effects[i];
        if (!fx || fx.disabled === true) continue;
        const def = FishEffectsRegistry.get(fx.type);
        if (def && def.category === 'expression') continue;
        if (def && typeof def.renderPost === 'function') {
          def.renderPost(ctx, el, layer, bounds, fx);
        }
      }
    },

    renderCardHTML(fx, layer, activeProperty, currentSec) {
      const def = FishEffectsRegistry.get(fx.type) || {
        name: fx.name || 'Effect',
        params: [
          { id: 'param', label: 'Parameter', min: -100, max: 100, default: 0, unit: '%' }
        ]
      };
      const isExpanded = fx.isExpanded !== false;
      const isDisabled = !!fx.disabled;
      const selectedProp = activeProperty || (typeof window !== 'undefined' && window.activeKeyframeProperty) || '';
      const ticksMarkup = getRulerTicksSVG();

      // Mobile / editor.html layout lock: 3D Element requires desktop workstation
      const isMobileEditor = (typeof window !== 'undefined') && (
        (window.location && window.location.pathname && window.location.pathname.includes('editor.html')) ||
        (typeof document !== 'undefined' && !document.querySelector('.desktop-workstation, .desktop-viewport')) ||
        (typeof window.isDesktopLayout === 'function' && !window.isDesktopLayout()) ||
        (typeof window.innerWidth === 'number' && window.innerWidth <= 600)
      );
      const is3DElement = (fx.type === '3d-element' || def.id === '3d-element');

      if (isMobileEditor && is3DElement) {
        return `
        <div class="effects-card fx-${fx.id} ${isExpanded ? 'is-expanded' : ''} ${isDisabled ? 'is-disabled' : ''}" data-effect-id="${fx.id}" data-effect-type="${fx.type}">
          <div class="effects-card-header">
            <div class="effects-card-header-left">
              <button type="button" class="effects-card-caret-btn" title="Toggle Controls" aria-label="Toggle Controls">
                <i class="fticon fticon-toggle-controls effects-card-caret" aria-hidden="true"></i>
              </button>
              <span class="effects-card-title" title="Click to rename effect" tabindex="0">${fx.name || def.name}</span>
              <input type="text" class="effects-card-title-input" value="${fx.name || def.name}" style="display:none;" spellcheck="false" maxlength="50" aria-label="Rename effect">
            </div>
            <div class="effects-card-actions">
              <button type="button" class="effects-card-eye-btn ${isDisabled ? '' : 'is-active'}" title="Enable/Disable Effect" aria-label="Toggle Effect">
                <i class='fticon fticon-toggle-effect' aria-hidden='true'></i>
              </button>
              <button type="button" class="effects-card-delete-btn" title="Remove Effect" aria-label="Delete">
                <i class='fticon fticon-delete-beatmark' aria-hidden='true'></i>
              </button>
            </div>
          </div>
          <div class="effects-card-controls">
            <div class="effects-control-row effects-control-row-mobile-lock">
              <div class="fx-mobile-lock">Switch to desktop view to edit this effects</div>
            </div>
          </div>
        </div>
        `;
      }

      let eff = null;
      if (typeof window !== 'undefined' && typeof window.getLayerEffectivePropsAtTime === 'function' && layer) {
        const sec = (currentSec !== undefined && currentSec !== null) ? currentSec : ((Math.abs(window.timelinePanX || 0)) / (window.currentPixelsPerSecond || 80));
        eff = window.getLayerEffectivePropsAtTime(layer, sec);
      }

      const effFx = (eff && Array.isArray(eff.effects)) ? eff.effects.find(f => f.id === fx.id) : null;

      const processedParams = new Set();
      const controlsHTMLArr = [];
      const paramsList = def.params || [];
      const FishElements = (typeof window !== 'undefined' && window.FishElements) ? window.FishElements : undefined;
      const sec = (currentSec !== undefined && currentSec !== null) ? currentSec : 0;
      const tol = 0.04;

      for (let i = 0; i < paramsList.length; i++) {
        const p = paramsList[i];
        if (processedParams.has(p.id)) continue;

        // Dynamic visibility check: if p.visibleIf is defined, check if parameter should be displayed
        if (p.visibleIf) {
          let isVisible = true;
          if (typeof p.visibleIf === 'function') {
            try { isVisible = !!p.visibleIf(fx, layer); } catch (_) { isVisible = true; }
          } else if (typeof p.visibleIf === 'object' && p.visibleIf !== null) {
            const depParam = p.visibleIf.param;
            const expectedVal = p.visibleIf.value;
            const actualVal = fx[depParam] !== undefined ? fx[depParam] : (def && def.params ? (def.params.find(dp => dp.id === depParam)?.default) : undefined);
            if (Array.isArray(expectedVal)) {
              isVisible = expectedVal.map(String).includes(String(actualVal));
            } else {
              isVisible = String(actualVal) === String(expectedVal);
            }
          }
          if (!isVisible) continue;
        }

        const type = p.type || 'number';

        if (type === 'switch' || type === 'boolean') {
          processedParams.add(p.id);
          const propKey = `${fx.id}:${p.id}`;
          const builtInProps = ['move', 'scale', 'rotate', 'rotation', 'opacity', 'volume', 'origin', 'skew', 'speed', 'timeRemap', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurAmount'];
          const hasKf = !!(layer && layer.keyframes && (
            (layer.keyframes[propKey] && layer.keyframes[propKey].length > 0) ||
            (fx === layer.effects[0] && !builtInProps.includes(p.id) && layer.keyframes[p.id] && layer.keyframes[p.id].length > 0)
          ));
          const hasExpr = !!(layer && layer.expressions && (
            (layer.expressions[propKey] && String(layer.expressions[propKey]).trim().length > 0) ||
            (layer.effects && fx === layer.effects[0] && !builtInProps.includes(p.id) && layer.expressions[p.id] && String(layer.expressions[p.id]).trim().length > 0)
          ));
          const rawVal = (effFx && effFx[p.id] !== undefined)
            ? effFx[p.id]
            : (fx[p.id] !== undefined ? fx[p.id] : (p.default !== undefined ? p.default : 1));
          const switchVal = (rawVal === 1 || rawVal === true || rawVal === '1' || rawVal === 'true' || rawVal === 'on') ? 1 : 0;

          const kfIconHTML = hasKf ? `<i class="fticon fticon-keyframe fx-param-kf-icon" aria-hidden="true" title="Has keyframes"></i>` : '';
          const exprIconHTML = hasExpr ? `<i class="fticon fticon-expression fx-param-expr-icon" aria-hidden="true" title="Has expression"></i>` : '';
          const isParamActive = (selectedProp === propKey) || (selectedProp === p.id && (!layer.effects || fx === layer.effects[0]));

          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-switch ${isParamActive ? 'is-selected' : ''} ${hasExpr ? 'has-active-expression' : ''}" data-param="${p.id}" data-effect-id="${fx.id}">
              <div class="effects-param-label-col">
                <button type="button" class="effects-param-label effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" data-effect-id="${fx.id}" title="Select ${p.label || p.id} for keyframing">
                  ${kfIconHTML}${exprIconHTML}<span class="fx-param-name">${p.label || p.id}</span>
                </button>
              </div>
              <div class="effects-param-val-col">
                ${(typeof FishElements !== 'undefined' && FishElements.renderSegmentedHTML)
                  ? FishElements.renderSegmentedHTML({
                      param: p.id,
                      value: switchVal,
                      isBoolean: true,
                      className: 'effects-switch-group',
                      ariaLabel: `Toggle ${p.label || p.id}`
                    })
                  : `
                      <div class="effects-segmented-group effects-switch-group" data-param="${p.id}">
                        <button type="button" class="effects-segmented-btn ${switchVal === 0 ? 'is-active' : ''}" data-param="${p.id}" data-val="0" title="Off">Off</button>
                        <button type="button" class="effects-segmented-btn ${switchVal === 1 ? 'is-active' : ''}" data-param="${p.id}" data-val="1" title="On">On</button>
                      </div>
                    `.trim()}
              </div>
            </div>
          `);
          continue;
        }

        if (type === 'layer') {
          processedParams.add(p.id);
          const propKey = `${fx.id}:${p.id}`;
          const isParamActive = (selectedProp === propKey) || (selectedProp === p.id && (!layer.effects || fx === layer.effects[0]));
          const currentVal = (effFx && effFx[p.id] !== undefined) ? effFx[p.id] : (fx[p.id] !== undefined ? fx[p.id] : (p.default !== undefined ? p.default : ''));

          const compState = (typeof window !== 'undefined' && (window.currentActivePrecomp || window.currentProjectState)) || null;
          const allLayers = (compState && Array.isArray(compState.layers)) ? compState.layers : [];

          const opts = [{ value: '', label: 'None' }];
          allLayers.forEach((l, idx) => {
            if (!l || (layer && String(l.id) === String(layer.id))) return;
            const lName = l.name || (`Layer ${idx + 1}`);
            opts.push({ value: String(l.id), label: `${idx + 1}. ${lName}` });
          });

          const selectedOpt = opts.find(o => String(o.value) === String(currentVal)) || opts[0];
          const dropdownHTML = (typeof FishElements !== 'undefined' && FishElements.renderDropdownHTML)
            ? FishElements.renderDropdownHTML({
                param: p.id,
                value: String(currentVal),
                options: opts,
                title: `Select ${p.label || p.id}`
              })
            : `
                <div class="custom-dropdown effects-custom-dropdown" data-param="${p.id}" data-value="${currentVal}">
                  <button type="button" class="custom-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select ${p.label || p.id}">
                    <span class="custom-dropdown-label">${selectedOpt.label}</span>
                    <i class='fticon fticon-select-animation-target custom-dropdown-arrow' style='width:14px;height:14px;font-size:14px;line-height:1;' aria-hidden='true'></i>
                  </button>
                  <div class="custom-dropdown-menu" role="listbox">
                    ${opts.map(opt => `<div class="custom-dropdown-item ${String(opt.value) === String(currentVal) ? 'is-selected' : ''}" role="option" data-val="${opt.value}" title="${opt.label}">${opt.label}</div>`).join('')}
                  </div>
                </div>
              `.trim();

          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-select ${isParamActive ? 'is-selected' : ''}" data-param="${p.id}" data-effect-id="${fx.id}">
              <div class="effects-param-label-col">
                <button type="button" class="effects-param-label effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" data-effect-id="${fx.id}" title="Select ${p.label || p.id}">
                  <span class="fx-param-name">${p.label || p.id}</span>
                </button>
              </div>
              <div class="effects-param-val-col">
                ${dropdownHTML}
              </div>
            </div>
          `);
          continue;
        }

        if (type === 'select') {
          processedParams.add(p.id);
          const propKey = `${fx.id}:${p.id}`;
          const builtInProps = ['move', 'scale', 'rotate', 'rotation', 'opacity', 'volume', 'origin', 'skew', 'speed', 'timeRemap', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurAmount'];
          const hasKf = !!(layer && layer.keyframes && (
            (layer.keyframes[propKey] && layer.keyframes[propKey].length > 0) ||
            (layer.effects && fx === layer.effects[0] && !builtInProps.includes(p.id) && layer.keyframes[p.id] && layer.keyframes[p.id].length > 0)
          ));
          const hasExpr = !!(layer && layer.expressions && (
            (layer.expressions[propKey] && String(layer.expressions[propKey]).trim().length > 0) ||
            (layer.effects && fx === layer.effects[0] && !builtInProps.includes(p.id) && layer.expressions[p.id] && String(layer.expressions[p.id]).trim().length > 0)
          ));
          const kfIconHTML = hasKf ? `<i class="fticon fticon-keyframe fx-param-kf-icon" aria-hidden="true" title="Has keyframes"></i>` : '';
          const exprIconHTML = hasExpr ? `<i class="fticon fticon-expression fx-param-expr-icon" aria-hidden="true" title="Has expression"></i>` : '';
          const isParamActive = (selectedProp === propKey) || (selectedProp === p.id && (!layer.effects || fx === layer.effects[0]));
          const rawSelectVal = (effFx && effFx[p.id] !== undefined) ? effFx[p.id] : (fx[p.id] !== undefined ? fx[p.id] : (p.default !== undefined ? p.default : 'normal'));
          const selectVal = String(rawSelectVal).toLowerCase();
          const rawOpts = Array.isArray(p.options) && p.options.length > 0 ? p.options : ['normal', 'multiply', 'overlay'];
          const opts = rawOpts.map(o => {
            if (typeof o === 'object' && o !== null) {
              return { value: String(o.value !== undefined ? o.value : ''), label: String(o.label || o.value || '') };
            }
            const s = String(o);
            return { value: s, label: s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) };
          });

          if (p.display === 'segmented') {
            const segmentedHTML = (typeof FishElements !== 'undefined' && FishElements.renderSegmentedHTML)
              ? FishElements.renderSegmentedHTML({
                  param: p.id,
                  value: selectVal,
                  options: opts,
                  ariaLabel: `Select ${p.label || p.id}`
                })
              : `
                  <div class="effects-segmented-group" data-param="${p.id}">
                    ${opts.map(opt => `
                      <button type="button" class="effects-segmented-btn ${selectVal === opt.value.toLowerCase() ? 'is-active' : ''}" data-param="${p.id}" data-val="${opt.value}" title="${opt.label}">
                        ${opt.label}
                      </button>
                    `).join('')}
                  </div>
                `.trim();

            controlsHTMLArr.push(`
              <div class="effects-control-row effects-control-row-select ${isParamActive ? 'is-selected' : ''} ${hasExpr ? 'has-active-expression' : ''}" data-param="${p.id}" data-effect-id="${fx.id}">
                <div class="effects-param-label-col">
                  <button type="button" class="effects-param-label effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" data-effect-id="${fx.id}" title="Select ${p.label || p.id} for keyframing">
                    ${kfIconHTML}${exprIconHTML}<span class="fx-param-name">${p.label || p.id}</span>
                  </button>
                </div>
                <div class="effects-param-val-col">
                  ${segmentedHTML}
                </div>
              </div>
            `);
            continue;
          }

          const dropdownHTML = (typeof FishElements !== 'undefined' && FishElements.renderDropdownHTML)
            ? FishElements.renderDropdownHTML({
                param: p.id,
                value: selectVal,
                options: opts,
                title: `Select ${p.label || p.id}`
              })
            : `
                <div class="custom-dropdown effects-custom-dropdown" data-param="${p.id}" data-value="${selectVal}">
                  <button type="button" class="custom-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select ${p.label || p.id}">
                    <span class="custom-dropdown-label">${(opts.find(o => o.value.toLowerCase() === selectVal) || opts[0] || {}).label || selectVal}</span>
                    <i class='fticon fticon-select-animation-target custom-dropdown-arrow' style='width:14px;height:14px;font-size:14px;line-height:1;' aria-hidden='true'></i>
                  </button>
                  <div class="custom-dropdown-menu" role="listbox">
                    ${opts.map(opt => `<div class="custom-dropdown-item ${opt.value.toLowerCase() === selectVal ? 'is-selected' : ''}" role="option" data-val="${opt.value}" title="${opt.label}">${opt.label}</div>`).join('')}
                  </div>
                </div>
              `.trim();

          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-select ${isParamActive ? 'is-selected' : ''} ${hasExpr ? 'has-active-expression' : ''}" data-param="${p.id}" data-effect-id="${fx.id}">
              <div class="effects-param-label-col">
                <button type="button" class="effects-param-label effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" data-effect-id="${fx.id}" title="Select ${p.label || p.id} for keyframing">
                  ${kfIconHTML}${exprIconHTML}<span class="fx-param-name">${p.label || p.id}</span>
                </button>
              </div>
              <div class="effects-param-val-col">
                ${dropdownHTML}
              </div>
            </div>
          `);
          continue;
        }

        if (type === 'color') {
          processedParams.add(p.id);
          const propKey = `${fx.id}:${p.id}`;
          const builtInProps = ['move', 'scale', 'rotate', 'rotation', 'opacity', 'volume', 'origin', 'skew', 'speed', 'timeRemap', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurAmount'];
          const hasKf = !!(layer && layer.keyframes && (
            (layer.keyframes[propKey] && layer.keyframes[propKey].length > 0) ||
            (layer.effects && fx === layer.effects[0] && !builtInProps.includes(p.id) && layer.keyframes[p.id] && layer.keyframes[p.id].length > 0)
          ));
          const hasExpr = !!(layer && layer.expressions && (
            (layer.expressions[propKey] && String(layer.expressions[propKey]).trim().length > 0) ||
            (layer.effects && fx === layer.effects[0] && !builtInProps.includes(p.id) && layer.expressions[p.id] && String(layer.expressions[p.id]).trim().length > 0)
          ));
          const kfIconHTML = hasKf ? `<i class="fticon fticon-keyframe fx-param-kf-icon" aria-hidden="true" title="Has keyframes"></i>` : '';
          const exprIconHTML = hasExpr ? `<i class="fticon fticon-expression fx-param-expr-icon" aria-hidden="true" title="Has expression"></i>` : '';
          const isParamActive = (selectedProp === propKey) || (selectedProp === p.id && (!layer.effects || fx === layer.effects[0]));
          const colorVal = (effFx && effFx[p.id]) ? effFx[p.id] : ((fx[p.id] !== undefined && fx[p.id]) ? fx[p.id] : (p.default || '#000000'));
          const colorInputHTML = (typeof FishElements !== 'undefined' && FishElements.renderColorInputHTML)
            ? FishElements.renderColorInputHTML({
                param: p.id,
                value: colorVal,
                title: `Pick ${p.label || p.id}`
              })
            : `
                <div class="effects-color-picker-wrap">
                  <button type="button" class="effects-color-swatch-btn fx-swatch-btn-${p.id}" data-param="${p.id}" title="Pick ${p.label || p.id}">
                    <span class="effects-color-swatch-preview fx-swatch-preview-${p.id}" style="background-color: ${colorVal};"></span>
                  </button>
                  <input type="text" class="effects-color-hex-input fx-hex-${p.id}" data-param="${p.id}" value="${colorVal}" maxlength="7" spellcheck="false" title="Hex color">
                </div>
              `.trim();
          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-color ${isParamActive ? 'is-selected' : ''} ${hasExpr ? 'has-active-expression' : ''}" data-param="${p.id}" data-effect-id="${fx.id}">
              <div class="effects-param-label-col">
                <button type="button" class="effects-param-label effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" data-effect-id="${fx.id}" title="Select ${p.label || p.id} for keyframing">
                  ${kfIconHTML}${exprIconHTML}<span class="fx-param-name">${p.label || p.id}</span>
                </button>
              </div>
              <div class="effects-param-val-col">
                ${colorInputHTML}
              </div>
            </div>
          `);
          continue;
        }

        if (type === 'curve') {
          processedParams.add(p.id);
          const currentChan = fx.channel || 'rgb';
          let rawPts = null;
          if (currentChan === 'r') rawPts = fx.curveR;
          else if (currentChan === 'g') rawPts = fx.curveG;
          else if (currentChan === 'b') rawPts = fx.curveB;
          else rawPts = fx[p.id] || fx.points;

          if (!rawPts) rawPts = [[0, 0], [1, 1]];
          const pts = (Array.isArray(rawPts) ? rawPts : [[0, 0], [1, 1]])
            .map(pt => Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : [Number(pt.x || 0), Number(pt.y || 0)])
            .sort((a, b) => a[0] - b[0]);

          const curveDef = FishEffectsRegistry.get('curve');
          const spline = (curveDef && typeof curveDef.buildSpline === 'function')
            ? curveDef.buildSpline(pts)
            : function(x) { return x; };

          const contrast = (fx && fx.contrast !== undefined) ? Number(fx.contrast) : 0;
          const c = Math.max(-1, Math.min(1, contrast / 100.0));

          let pathD = '';
          const steps = 30;
          for (let s = 0; s <= steps; s++) {
            const u = s / steps;
            let vy = Math.max(0, Math.min(1, spline(u)));
            if (c !== 0) {
              vy = vy - c * 0.22 * Math.sin(Math.PI * 2 * vy);
              vy = Math.max(0, Math.min(1, vy));
            }
            const sx = (u * 200).toFixed(1);
            const sy = ((1.0 - vy) * 200).toFixed(1);
            pathD += (s === 0 ? `M ${sx} ${sy}` : ` L ${sx} ${sy}`);
          }

          let strokeColor = 'var(--color-primary)';
          if (currentChan === 'r') strokeColor = 'var(--color-danger)';
          else if (currentChan === 'g') strokeColor = 'var(--color-primary)';
          else if (currentChan === 'b') strokeColor = '#60a5fa';

          const pointsMarkup = pts.map((pt, idx) => {
            const cx = (pt[0] * 200).toFixed(1);
            const cy = ((1.0 - pt[1]) * 200).toFixed(1);
            return `<circle class="effects-curve-point" data-index="${idx}" cx="${cx}" cy="${cy}" r="5.5" fill="${strokeColor}"></circle>`;
          }).join('');

          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-curve" data-param="${p.id}">
              <div class="effects-curve-editor" data-effect-id="${fx.id}" data-param="${p.id}">
                <div class="effects-curve-header">
                  <div class="effects-curve-channels" data-effect-id="${fx.id}">
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'rgb' ? 'is-active' : ''}" data-channel="rgb" title="Master RGB">RGB</button>
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'r' ? 'is-active' : ''}" data-channel="r" title="Red Channel">R</button>
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'g' ? 'is-active' : ''}" data-channel="g" title="Green Channel">G</button>
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'b' ? 'is-active' : ''}" data-channel="b" title="Blue Channel">B</button>
                  </div>
                  <div class="effects-curve-presets-bar">
                    <button type="button" class="effects-curve-preset-pill" data-preset="s_curve" title="Smooth S-Curve Contrast">S-Curve</button>
                    <button type="button" class="effects-curve-preset-pill" data-preset="hard_contrast" title="Hard Contrast S-Curve">Hard S</button>
                    <button type="button" class="effects-curve-preset-pill" data-preset="lift_blacks" title="Lifted Blacks Film Tone">Film</button>
                    <button type="button" class="effects-curve-preset-pill" data-preset="linear" title="Reset to Flat Linear">Linear</button>
                  </div>
                </div>

                <div class="effects-curve-canvas-wrap">
                  <svg class="effects-curve-svg" viewBox="0 0 200 200" data-effect-id="${fx.id}" data-param="${p.id}">
                    <line x1="50" y1="0" x2="50" y2="200" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="100" y1="0" x2="100" y2="200" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="150" y1="0" x2="150" y2="200" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="0" y1="50" x2="200" y2="50" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="0" y1="100" x2="200" y2="100" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="0" y1="150" x2="200" y2="150" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="0" y1="200" x2="200" y2="0" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0.3"/>
                    <path class="effects-curve-path" d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round"/>
                    ${pointsMarkup}
                  </svg>
                </div>

                <div class="effects-curve-footer">
                  <span class="effects-curve-coord" data-effect-id="${fx.id}">In: 128 | Out: 128</span>
                  <div class="effects-curve-footer-actions">
                    <span class="effects-curve-tip">Double-click point to delete</span>
                    <button type="button" class="effects-curve-reset-btn" data-effect-id="${fx.id}" title="Reset Curve to Linear">Reset</button>
                  </div>
                </div>
              </div>
            </div>
          `);
          continue;
        }

        // Hidden params — skip UI rendering entirely (used for sceneData etc.)
        if (type === 'hidden') {
          processedParams.add(p.id);
          continue;
        }

        // Button params — render a clickable action button
        if (type === 'button') {
          processedParams.add(p.id);
          const btnLabel = p.buttonLabel || p.label || p.id;
          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-button" data-param="${p.id}">
              <div class="effects-param-val-col" style="width:100%">
                <button type="button" class="effects-action-btn fx-action-btn-${p.id}" data-param="${p.id}" data-effect-id="${fx.id}" title="${btnLabel}">${btnLabel}</button>
              </div>
            </div>
          `);
          continue;
        }

        // Coordinate pair detection (e.g. offset_x/offset_y, posX/posY, point_x/point_y, anchorX/anchorY)
        let pairY = null;
        if (p.id.endsWith('_x')) {
          const yId = p.id.slice(0, -2) + '_y';
          pairY = paramsList.find(o => o.id === yId);
        } else if (p.id.endsWith('-x')) {
          const yId = p.id.slice(0, -2) + '-y';
          pairY = paramsList.find(o => o.id === yId);
        } else if (p.id.endsWith('X') && p.id.length > 1) {
          const yId = p.id.slice(0, -1) + 'Y';
          pairY = paramsList.find(o => o.id === yId);
        }

        if (pairY && (p.type || 'number') === (pairY.type || 'number')) {
          processedParams.add(p.id);
          processedParams.add(pairY.id);

          const pairLabel = (p.label || p.id).replace(/\s*([_ -]?[Xx])\b.*$/, '').trim() || (p.label || p.id);

          // Values for X
          const minX = fx.min !== undefined ? fx.min : (p.min !== undefined ? p.min : -100);
          const maxX = fx.max !== undefined ? fx.max : (p.max !== undefined ? p.max : 100);
          const stepX = fx.step !== undefined ? fx.step : (p.step !== undefined ? p.step : 1);
          const unitX = fx.unit !== undefined ? fx.unit : (p.unit !== undefined ? p.unit : '');
          const isDecimalX = (stepX < 1) || unitX === 'x' || unitX.includes('.');
          const rawValX = (effFx && effFx[p.id] !== undefined) ? effFx[p.id] : (fx[p.id] !== undefined ? fx[p.id] : (p.default || 0));
          const numValX = isDecimalX
            ? Math.max(minX, Math.min(maxX, Number(parseFloat(rawValX).toFixed(2))))
            : Math.max(minX, Math.min(maxX, Math.round(rawValX)));
          const formattedValX = isDecimalX ? numValX.toFixed(2) : numValX;
          const badgeTextX = (numValX >= 0 && minX < 0 ? '+' : '') + formattedValX + unitX;

          // Values for Y
          const minY = fx.min !== undefined ? fx.min : (pairY.min !== undefined ? pairY.min : -100);
          const maxY = fx.max !== undefined ? fx.max : (pairY.max !== undefined ? pairY.max : 100);
          const stepY = fx.step !== undefined ? fx.step : (pairY.step !== undefined ? pairY.step : 1);
          const unitY = fx.unit !== undefined ? fx.unit : (pairY.unit !== undefined ? pairY.unit : '');
          const isDecimalY = (stepY < 1) || unitY === 'x' || unitY.includes('.');
          const rawValY = (effFx && effFx[pairY.id] !== undefined) ? effFx[pairY.id] : (fx[pairY.id] !== undefined ? fx[pairY.id] : (pairY.default || 0));
          const numValY = isDecimalY
            ? Math.max(minY, Math.min(maxY, Number(parseFloat(rawValY).toFixed(2))))
            : Math.max(minY, Math.min(maxY, Math.round(rawValY)));
          const formattedValY = isDecimalY ? numValY.toFixed(2) : numValY;
          const badgeTextY = (numValY >= 0 && minY < 0 ? '+' : '') + formattedValY + unitY;
          const spanX = maxX - minX;
          const tapeWidthX = 480;
          const ratioX = spanX > 0 ? Math.max(0, Math.min(1, (numValX - minX) / spanX)) : 0;
          const tapeOffsetX = -ratioX * tapeWidthX;

          const spanY = maxY - minY;
          const tapeWidthY = 480;
          const ratioY = spanY > 0 ? Math.max(0, Math.min(1, (numValY - minY) / spanY)) : 0;
          const tapeOffsetY = -ratioY * tapeWidthY;

          const propKeyX = `${fx.id}:${p.id}`;
          const propKeyY = `${fx.id}:${pairY.id}`;
          const builtInProps = ['move', 'scale', 'rotate', 'rotation', 'opacity', 'volume', 'origin', 'skew', 'speed', 'timeRemap', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurAmount'];
          const hasKfX = !!(layer && layer.keyframes && (
            (layer.keyframes[propKeyX] && layer.keyframes[propKeyX].length > 0) ||
            (layer.effects && fx === layer.effects[0] && !builtInProps.includes(p.id) && layer.keyframes[p.id] && layer.keyframes[p.id].length > 0)
          ));
          const hasKfY = !!(layer && layer.keyframes && (
            (layer.keyframes[propKeyY] && layer.keyframes[propKeyY].length > 0) ||
            (layer.effects && fx === layer.effects[0] && !builtInProps.includes(pairY.id) && layer.keyframes[pairY.id] && layer.keyframes[pairY.id].length > 0)
          ));
          const hasExprX = !!(layer && layer.expressions && (
            (layer.expressions[propKeyX] && String(layer.expressions[propKeyX]).trim().length > 0) ||
            (layer.effects && fx === layer.effects[0] && !builtInProps.includes(p.id) && layer.expressions[p.id] && String(layer.expressions[p.id]).trim().length > 0)
          ));
          const hasExprY = !!(layer && layer.expressions && (
            (layer.expressions[propKeyY] && String(layer.expressions[propKeyY]).trim().length > 0) ||
            (layer.effects && fx === layer.effects[0] && !builtInProps.includes(pairY.id) && layer.expressions[pairY.id] && String(layer.expressions[pairY.id]).trim().length > 0)
          ));
          const hasKf = hasKfX || hasKfY;
          const hasExpr = hasExprX || hasExprY;
          const kfIconHTML = hasKf ? `<i class="fticon fticon-keyframe fx-param-kf-icon" aria-hidden="true" title="Has keyframes"></i>` : '';
          const exprIconHTML = hasExpr ? `<i class="fticon fticon-expression fx-param-expr-icon" aria-hidden="true" title="Has expression"></i>` : '';
          const isParamActive = (selectedProp === propKeyX) || (selectedProp === propKeyY) ||
            (selectedProp === p.id && (!layer.effects || fx === layer.effects[0])) ||
            (selectedProp === pairY.id && (!layer.effects || fx === layer.effects[0]));

          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-pair ${isParamActive ? 'is-selected' : ''} ${hasExpr ? 'has-active-expression' : ''}" data-param="${p.id},${pairY.id}" data-effect-id="${fx.id}">
              <div class="effects-param-label-col">
                <button type="button" class="effects-param-label effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" data-effect-id="${fx.id}" title="Select ${pairLabel} for keyframing">
                  ${kfIconHTML}${exprIconHTML}<span class="fx-param-name">${pairLabel}</span>
                </button>
              </div>
              <div class="effects-param-val-col">
                <div class="effects-param-pair">
                  ${(typeof FishElements !== 'undefined' && FishElements.renderRulerScrubberHTML)
                    ? FishElements.renderRulerScrubberHTML({
                        className: `fx-scrubber-${p.id}`,
                        dataParam: p.id,
                        unit: unitX,
                        min: minX,
                        max: maxX,
                        step: p.step || 1,
                        value: numValX,
                        axisBadge: 'X',
                        tapeWidth: tapeWidthX,
                        ariaLabel: `${p.label || p.id} Scrubber`,
                        badgeClassName: `fx-badge-${p.id}`,
                        badgeTitle: `Click to edit ${p.label || p.id} value`
                      })
                    : `
                        <div class="effects-param-pill jog-wheel-container is-horizontal effects-ruler-scrubber fx-scrubber-${p.id}" data-param="${p.id}" data-unit="${unitX}" data-min="${minX}" data-max="${maxX}" ${p.step ? `data-step="${p.step}"` : ''} role="slider" aria-valuemin="${minX}" aria-valuemax="${maxX}" aria-valuenow="${numValX}" aria-label="${p.label || p.id} Scrubber">
                          <div class="jog-wheel-track-viewport">
                            <div class="jog-wheel-ticks is-bounded-tape" style="--tape-width: ${tapeWidthX}px; --tape-offset: ${tapeOffsetX.toFixed(1)}px;" data-tape-width="${tapeWidthX}"></div>
                          </div>
                          <div class="jog-wheel-needle"></div>
                          <span class="effects-axis-badge">X</span>
                          <span class="effects-param-pill-val fx-badge-${p.id}" data-param="${p.id}" title="Click to edit ${p.label || p.id} value">${badgeTextX}</span>
                        </div>
                      `.trim()}
                  ${(typeof FishElements !== 'undefined' && FishElements.renderRulerScrubberHTML)
                    ? FishElements.renderRulerScrubberHTML({
                        className: `fx-scrubber-${pairY.id}`,
                        dataParam: pairY.id,
                        unit: unitY,
                        min: minY,
                        max: maxY,
                        step: pairY.step || 1,
                        value: numValY,
                        axisBadge: 'Y',
                        tapeWidth: tapeWidthY,
                        ariaLabel: `${pairY.label || pairY.id} Scrubber`,
                        badgeClassName: `fx-badge-${pairY.id}`,
                        badgeTitle: `Click to edit ${pairY.label || pairY.id} value`
                      })
                    : `
                        <div class="effects-param-pill jog-wheel-container is-horizontal effects-ruler-scrubber fx-scrubber-${pairY.id}" data-param="${pairY.id}" data-unit="${unitY}" data-min="${minY}" data-max="${maxY}" ${pairY.step ? `data-step="${pairY.step}"` : ''} role="slider" aria-valuemin="${minY}" aria-valuemax="${maxY}" aria-valuenow="${numValY}" aria-label="${pairY.label || pairY.id} Scrubber">
                          <div class="jog-wheel-track-viewport">
                            <div class="jog-wheel-ticks is-bounded-tape" style="--tape-width: ${tapeWidthY}px; --tape-offset: ${tapeOffsetY.toFixed(1)}px;" data-tape-width="${tapeWidthY}"></div>
                          </div>
                          <div class="jog-wheel-needle"></div>
                          <span class="effects-axis-badge">Y</span>
                          <span class="effects-param-pill-val fx-badge-${pairY.id}" data-param="${pairY.id}" title="Click to edit ${pairY.label || pairY.id} value">${badgeTextY}</span>
                        </div>
                      `.trim()}
                </div>
              </div>
            </div>
          `);
          continue;
        }

        // Single number or angle parameter
        processedParams.add(p.id);
        const propKey = `${fx.id}:${p.id}`;
        const builtInProps = ['move', 'scale', 'rotate', 'rotation', 'opacity', 'volume', 'origin', 'skew', 'speed', 'timeRemap', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurAmount'];
        const hasKf = !!(layer && layer.keyframes && (
          (layer.keyframes[propKey] && layer.keyframes[propKey].length > 0) ||
          (layer.effects && fx === layer.effects[0] && !builtInProps.includes(p.id) && layer.keyframes[p.id] && layer.keyframes[p.id].length > 0)
        ));
        const hasExpr = !!(layer && layer.expressions && (
          (layer.expressions[propKey] && String(layer.expressions[propKey]).trim().length > 0) ||
          (layer.effects && fx === layer.effects[0] && !builtInProps.includes(p.id) && layer.expressions[p.id] && String(layer.expressions[p.id]).trim().length > 0)
        ));
        const kfIconHTML = hasKf ? `<i class="fticon fticon-keyframe fx-param-kf-icon" aria-hidden="true" title="Has keyframes"></i>` : '';
        const exprIconHTML = hasExpr ? `<i class="fticon fticon-expression fx-param-expr-icon" aria-hidden="true" title="Has expression"></i>` : '';
        const isParamActive = (selectedProp === propKey) ||
          (selectedProp === p.id && (!layer.effects || fx === layer.effects[0]));

        if (type === 'angle') {
          const rawVal = (effFx && effFx[p.id] !== undefined) ? effFx[p.id] : (fx[p.id] !== undefined ? fx[p.id] : (p.default || 0));
          const angleVal = Math.round(rawVal);
          const unit = p.unit || '°';
          const turns = Math.trunc(angleVal / 360);
          const rem = Math.round(angleVal % 360);
          const badgeText = (turns !== 0)
            ? `${turns}x ${rem >= 0 ? '+' : ''}${rem}°`
            : `${rem >= 0 ? '+' : ''}${rem}°`;
          const normAngle = ((angleVal % 360) + 360) % 360;
          const trackWidth = ((normAngle / 360) * 100).toFixed(1);

          const angleScrubberHTML = (typeof FishElements !== 'undefined' && FishElements.renderRulerScrubberHTML)
            ? FishElements.renderRulerScrubberHTML({
                className: `fx-scrubber-${p.id}`,
                dataParam: p.id,
                unit: unit,
                isAngle: true,
                value: angleVal,
                ariaLabel: `${p.label || p.id} Angle Scrubber`,
                badgeClassName: `fx-badge-${p.id}`,
                badgeTitle: `Click to edit ${p.label || p.id} value`
              })
            : `
                <div class="effects-param-pill jog-wheel-container is-horizontal effects-ruler-scrubber fx-scrubber-${p.id}" data-param="${p.id}" data-unit="${unit}" data-type="angle" data-is-angle="true" data-unlimited="true" role="slider" aria-valuenow="${angleVal}" aria-label="${p.label || p.id} Angle Scrubber">
                  <div class="jog-wheel-track-viewport">
                    <div class="jog-wheel-ticks"></div>
                  </div>
                  <div class="jog-wheel-needle"></div>
                  <span class="effects-param-pill-val fx-badge-${p.id}" data-param="${p.id}" title="Click to edit ${p.label || p.id} value">${badgeText}</span>
                </div>
              `.trim();

          controlsHTMLArr.push(`
            <div class="effects-control-row ${isParamActive ? 'is-selected' : ''} ${hasExpr ? 'has-active-expression' : ''}" data-param="${p.id}" data-effect-id="${fx.id}">
              <div class="effects-param-label-col">
                <button type="button" class="effects-param-label effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" data-effect-id="${fx.id}" title="Select ${p.label || p.id} for keyframing">
                  ${kfIconHTML}${exprIconHTML}<span class="fx-param-name">${p.label || p.id}</span>
                </button>
              </div>
              <div class="effects-param-val-col">
                ${angleScrubberHTML}
              </div>
            </div>
          `);
          continue;
        }

        // Standard number
        const min = fx.min !== undefined ? fx.min : (p.min !== undefined ? p.min : -100);
        const max = fx.max !== undefined ? fx.max : (p.max !== undefined ? p.max : 100);
        const step = fx.step !== undefined ? fx.step : (p.step !== undefined ? p.step : 1);
        const unit = fx.unit !== undefined ? fx.unit : (p.unit || '%');
        const isDecimal = (step < 1) || unit === 'x' || unit.includes('.');
        const rawVal = (effFx && effFx[p.id] !== undefined) ? effFx[p.id] : (fx[p.id] !== undefined ? fx[p.id] : (p.default || 0));
        const numVal = isDecimal
          ? Math.max(min, Math.min(max, Number(parseFloat(rawVal).toFixed(2))))
          : Math.max(min, Math.min(max, Math.round(rawVal)));
        const formattedVal = isDecimal ? numVal.toFixed(2) : numVal;
        const badgeText = (numVal >= 0 && min < 0 ? '+' : '') + formattedVal + unit;
        const span = max - min;
        const tapeWidth = 480;
        const ratio = span > 0 ? Math.max(0, Math.min(1, (numVal - min) / span)) : 0;
        const tapeOffset = -ratio * tapeWidth;

        const numScrubberHTML = (typeof FishElements !== 'undefined' && FishElements.renderRulerScrubberHTML)
          ? FishElements.renderRulerScrubberHTML({
              className: `fx-scrubber-${p.id}`,
              dataParam: p.id,
              unit: unit,
              min: min,
              max: max,
              step: step,
              value: numVal,
              tapeWidth: tapeWidth,
              ariaLabel: `${p.label || p.id} Scrubber`,
              badgeClassName: `fx-badge-${p.id}`,
              badgeTitle: `Click to edit ${p.label || p.id} value`
            })
          : `
              <div class="effects-param-pill jog-wheel-container is-horizontal effects-ruler-scrubber fx-scrubber-${p.id}" data-param="${p.id}" data-unit="${unit}" data-min="${min}" data-max="${max}" ${p.step ? `data-step="${p.step}"` : ''} role="slider" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${numVal}" aria-label="${p.label || p.id} Scrubber">
                <div class="jog-wheel-track-viewport">
                  <div class="jog-wheel-ticks is-bounded-tape" style="--tape-width: ${tapeWidth}px; --tape-offset: ${tapeOffset.toFixed(1)}px;" data-tape-width="${tapeWidth}"></div>
                </div>
                <div class="jog-wheel-needle"></div>
                <span class="effects-param-pill-val fx-badge-${p.id}" data-param="${p.id}" title="Click to edit ${p.label || p.id} value">${badgeText}</span>
              </div>
            `.trim();

        controlsHTMLArr.push(`
          <div class="effects-control-row ${isParamActive ? 'is-selected' : ''} ${hasExpr ? 'has-active-expression' : ''}" data-param="${p.id}" data-effect-id="${fx.id}">
            <div class="effects-param-label-col">
              <button type="button" class="effects-param-label effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" data-effect-id="${fx.id}" title="Select ${p.label || p.id} for keyframing">
                ${kfIconHTML}${exprIconHTML}<span class="fx-param-name">${p.label || p.id}</span>
              </button>
            </div>
            <div class="effects-param-val-col">
              ${numScrubberHTML}
            </div>
          </div>
        `);
      }
      const controlsHTML = controlsHTMLArr.join('');

      return `
        <div class="effects-card ${isExpanded ? 'is-expanded' : ''}" data-effect-id="${fx.id}" data-last-mode="${fx.mode || ''}">
          <div class="effects-card-swipe-bg" aria-hidden="true">
            <i class="fticon fticon-delete-beatmark effects-swipe-trash-icon" aria-hidden="true"></i>
            <span class="effects-swipe-label">Delete</span>
          </div>
          <div class="effects-card-header">
            <div class="effects-card-header-left">
              <button type="button" class="effects-card-caret-btn" title="Toggle Expand" aria-label="Toggle Expand">
                <i class="fticon fticon-toggle-controls effects-card-caret" aria-hidden="true"></i>
              </button>
              <span class="effects-card-title" title="Click to rename effect" tabindex="0">${fx.name || def.name}</span>
              <input type="text" class="effects-card-title-input" value="${fx.name || def.name}" style="display:none;" spellcheck="false" maxlength="50" aria-label="Rename effect">
            </div>

            <!-- Header Right Actions: Eye toggle, Kebab menu, Delete, and Drag handle (always visible) -->
            <div class="effects-card-actions">
              <button type="button" class="effects-card-eye-btn ${isDisabled ? '' : 'is-active'}" title="Enable/Disable Effect" aria-label="Toggle Effect">
                <i class='fticon fticon-toggle-effect' aria-hidden='true'></i>
              </button>
              <button type="button" class="effects-card-kebab-btn" title="Effect Options" aria-label="Effect Options">
                <i class='fticon fticon-effect-options' aria-hidden='true'></i>
              </button>
              <button type="button" class="effects-card-delete-btn" title="Remove Effect" aria-label="Delete">
                <i class='fticon fticon-delete-beatmark' aria-hidden='true'></i>
              </button>
              <span class="effects-card-drag-handle" title="Drag to reorder" aria-label="Drag to reorder">
                <i class='fticon fticon-drag-to-reorder' aria-hidden='true'></i>
              </span>
            </div>
          </div>

          <!-- Kebab Popover Dropdown -->
          <div class="effects-kebab-menu">
            <button type="button" class="effects-kebab-item" data-action="rename">Rename</button>
            <button type="button" class="effects-kebab-item" data-action="details">Effect Details</button>
            <button type="button" class="effects-kebab-item" data-action="reset">Reset to Defaults</button>
            <button type="button" class="effects-kebab-item" data-action="duplicate">Duplicate</button>
            <button type="button" class="effects-kebab-item" data-action="copy">Copy Effect</button>
            <button type="button" class="effects-kebab-item effects-kebab-item-danger" data-action="delete" style="color: var(--color-danger, #ff453a);">Delete Effect</button>
          </div>

          <div class="effects-card-controls">
            ${controlsHTML}
          </div>
        </div>
      `;
    },

    bindCurveWidget(card, fx, layer) {
      const widget = card.querySelector('.effects-curve-editor');
      if (!widget) return;
      const svg = widget.querySelector('.effects-curve-svg');
      if (!svg) return;

      const curveDef = FishEffectsRegistry.get('curve');
      const presets = (curveDef && curveDef.presets) || {
        linear: [[0, 0], [1, 1]],
        s_curve: [[0, 0], [0.25, 0.18], [0.75, 0.82], [1, 1]],
        hard_contrast: [[0, 0], [0.25, 0.10], [0.5, 0.5], [0.75, 0.90], [1, 1]],
        lift_blacks: [[0, 0.14], [0.25, 0.28], [0.75, 0.82], [1, 0.96]],
        invert: [[0, 1], [1, 0]]
      };

      function getCurrentPoints() {
        const chan = fx.channel || 'rgb';
        let pts = null;
        if (chan === 'r') pts = fx.curveR;
        else if (chan === 'g') pts = fx.curveG;
        else if (chan === 'b') pts = fx.curveB;
        else pts = fx.curve || fx.points;

        if (!Array.isArray(pts) || pts.length < 2) {
          pts = JSON.parse(JSON.stringify(presets.linear));
        }
        return pts;
      }

      function setCurrentPoints(pts) {
        const chan = fx.channel || 'rgb';
        if (chan === 'r') fx.curveR = pts;
        else if (chan === 'g') fx.curveG = pts;
        else if (chan === 'b') fx.curveB = pts;
        else {
          fx.curve = pts;
          fx.points = pts;
        }
      }

      function updateSVG() {
        const pts = getCurrentPoints();
        const spline = (curveDef && typeof curveDef.buildSpline === 'function')
          ? curveDef.buildSpline(pts)
          : function(x) { return x; };

        const contrast = (fx && fx.contrast !== undefined) ? Number(fx.contrast) : 0;
        const c = Math.max(-1, Math.min(1, contrast / 100.0));

        let pathD = '';
        const steps = 30;
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          let vy = Math.max(0, Math.min(1, spline(u)));
          if (c !== 0) {
            vy = vy - c * 0.22 * Math.sin(Math.PI * 2 * vy);
            vy = Math.max(0, Math.min(1, vy));
          }
          const sx = (u * 200).toFixed(1);
          const sy = ((1.0 - vy) * 200).toFixed(1);
          pathD += (s === 0 ? `M ${sx} ${sy}` : ` L ${sx} ${sy}`);
        }

        const chan = fx.channel || 'rgb';
        let strokeColor = 'var(--color-primary)';
        if (chan === 'r') strokeColor = 'var(--color-danger)';
        else if (chan === 'g') strokeColor = 'var(--color-primary)';
        else if (chan === 'b') strokeColor = '#60a5fa';

        const pathEl = svg.querySelector('.effects-curve-path');
        if (pathEl) {
          pathEl.setAttribute('d', pathD);
          pathEl.setAttribute('stroke', strokeColor);
        }

        const oldPoints = svg.querySelectorAll('.effects-curve-point');
        oldPoints.forEach(p => p.remove());

        pts.forEach((pt, idx) => {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('class', 'effects-curve-point');
          circle.setAttribute('data-index', idx);
          circle.setAttribute('cx', (pt[0] * 200).toFixed(1));
          circle.setAttribute('cy', ((1.0 - pt[1]) * 200).toFixed(1));
          circle.setAttribute('r', '5.5');
          circle.setAttribute('fill', strokeColor);
          svg.appendChild(circle);
        });

        // Highlight matching preset button
        widget.querySelectorAll('.effects-curve-preset-pill').forEach(pill => {
          const pName = pill.dataset.preset;
          const targetPts = presets[pName];
          if (targetPts && targetPts.length === pts.length) {
            const matches = targetPts.every((tp, i) => Math.abs(tp[0] - pts[i][0]) < 0.02 && Math.abs(tp[1] - pts[i][1]) < 0.02);
            pill.classList.toggle('is-active', matches);
          } else {
            pill.classList.remove('is-active');
          }
        });
      }

      widget._updateCurveSVG = updateSVG;

      // Channel Buttons
      widget.querySelectorAll('.effects-curve-chan-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const chan = btn.dataset.channel || 'rgb';
          fx.channel = chan;
          widget.querySelectorAll('.effects-curve-chan-btn').forEach(b => b.classList.toggle('is-active', b === btn));
          updateSVG();
          if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
          if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-channel');
        });
      });

      // Preset Pills
      widget.querySelectorAll('.effects-curve-preset-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          const pName = pill.dataset.preset;
          if (presets[pName]) {
            setCurrentPoints(JSON.parse(JSON.stringify(presets[pName])));
            updateSVG();
            if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
            if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-preset');
            if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
          }
        });
      });

      // Reset Button
      const resetBtn = widget.querySelector('.effects-curve-reset-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          setCurrentPoints(JSON.parse(JSON.stringify(presets.linear)));
          if (fx.contrast !== undefined) {
            fx.contrast = 0;
            const track = card.querySelector('.fx-track-contrast');
            const badge = card.querySelector('.fx-badge-contrast');
            if (track) track.style.width = '50%';
            if (badge) badge.textContent = '0%';
          }
          updateSVG();
          if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
          if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-reset');
          if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
        });
      }

      // Double-click to delete intermediate control points
      svg.addEventListener('dblclick', (e) => {
        const targetPt = e.target.closest('.effects-curve-point');
        if (!targetPt) return;
        const idx = parseInt(targetPt.dataset.index, 10);
        const pts = getCurrentPoints();
        if (pts.length > 2 && idx > 0 && idx < pts.length - 1) {
          e.stopPropagation();
          e.preventDefault();
          pts.splice(idx, 1);
          setCurrentPoints(pts);
          updateSVG();
          if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
          if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-point-delete');
          if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
        }
      });

      // Pointer Dragging on Points & Click to Add Point
      let activePointIdx = null;
      const coordEl = widget.querySelector('.effects-curve-coord');

      svg.addEventListener('pointerdown', (e) => {
        const targetPt = e.target.closest('.effects-curve-point');
        const pts = getCurrentPoints();
        const rect = svg.getBoundingClientRect();
        const rw = rect.width || 200;
        const rh = rect.height || 200;
        const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rw));
        const ny = Math.max(0, Math.min(1, 1.0 - (e.clientY - rect.top) / rh));

        if (targetPt) {
          activePointIdx = parseInt(targetPt.dataset.index, 10);
        } else {
          let closestIdx = 0;
          let minDist = Infinity;
          pts.forEach((pt, i) => {
            const d = Math.hypot(pt[0] - nx, pt[1] - ny);
            if (d < minDist) {
              minDist = d;
              closestIdx = i;
            }
          });
          if (minDist < 0.16) {
            activePointIdx = closestIdx;
          } else if (pts.length < 5 && nx > 0.04 && nx < 0.96) {
            // Click empty area to add a new point (max 5 points)
            pts.push([Number(nx.toFixed(3)), Number(ny.toFixed(3))]);
            pts.sort((a, b) => a[0] - b[0]);
            setCurrentPoints(pts);
            activePointIdx = pts.findIndex(p => Math.abs(p[0] - nx) < 0.005 && Math.abs(p[1] - ny) < 0.005);
            updateSVG();
            if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
            if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-add-point');
          } else {
            activePointIdx = closestIdx;
          }
        }

        if (activePointIdx !== null) {
          e.stopPropagation();
          e.preventDefault();
          window.isTransformInteracting = true;
          try { svg.setPointerCapture(e.pointerId); } catch (_) {}
          const cachedRect = svg.getBoundingClientRect();

          function onPointerMove(ev) {
            const r = cachedRect || svg.getBoundingClientRect();
            const rw_ = r.width || 200;
            const rh_ = r.height || 200;
            let x = Math.max(0, Math.min(1, (ev.clientX - r.left) / rw_));
            let y = Math.max(0, Math.min(1, 1.0 - (ev.clientY - r.top) / rh_));

            const curPts = getCurrentPoints();
            if (activePointIdx === 0) {
              x = 0;
            } else if (activePointIdx === curPts.length - 1) {
              x = 1;
            } else {
              const prevX = (curPts[activePointIdx - 1] ? curPts[activePointIdx - 1][0] : 0) + 0.02;
              const nextX = (curPts[activePointIdx + 1] ? curPts[activePointIdx + 1][0] : 1) - 0.02;
              x = Math.max(prevX, Math.min(nextX, x));
            }

            curPts[activePointIdx] = [Number(x.toFixed(3)), Number(y.toFixed(3))];
            setCurrentPoints(curPts);
            updateSVG();

            if (coordEl) {
              coordEl.textContent = `In: ${Math.round(x * 255)} | Out: ${Math.round(y * 255)}`;
            }

            const isPlaying = typeof window.isAnyPlaybackActive === 'function' ? window.isAnyPlaybackActive() : !!window.isTimelinePlaying;
            if (!isPlaying) {
              if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
              if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-drag');
            }
          }

          function onPointerUp(ev) {
            try { svg.releasePointerCapture(ev.pointerId); } catch (_) {}
            window.isTransformInteracting = false;
            svg.removeEventListener('pointermove', onPointerMove);
            svg.removeEventListener('pointerup', onPointerUp);
            svg.removeEventListener('pointercancel', onPointerUp);
            activePointIdx = null;
            if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
            if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-drag-end');
            if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
          }

          svg.addEventListener('pointermove', onPointerMove);
          svg.addEventListener('pointerup', onPointerUp);
          svg.addEventListener('pointercancel', onPointerUp);
        }
      });

      // Hover coordinates
      svg.addEventListener('pointermove', (e) => {
        if (activePointIdx !== null) return;
        const rect = svg.getBoundingClientRect();
        const rw = rect.width || 200;
        const rh = rect.height || 200;
        const hx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rw));
        const hy = Math.max(0, Math.min(1, 1.0 - (e.clientY - rect.top) / rh));
        if (coordEl) {
          coordEl.textContent = `In: ${Math.round(hx * 255)} | Out: ${Math.round(hy * 255)}`;
        }
      });

      // Initial SVG render
      updateSVG();
    }
  };

  global.FishEffectsRegistry = FishEffectsRegistry;
  global.FishEffects = FishEffects;
})(typeof window !== 'undefined' ? window : this);
