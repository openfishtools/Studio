/**
 * OpenFishTools Studio - FishTextEngine
 * High-performance, modular canvas text rendering and animation engine.
 * Supports typography, outlines, long shadows, drop shadows, neon glow,
 * background badge pills, and deterministic character-level animations.
 */
(function(window) {
  'use strict';

  const DEFAULT_TEXT_PROPS = {
    text: 'FISH TOOL',
    fontFamily: 'Cal Sans, Inter, sans-serif',
    fontSize: 64,
    fontWeight: '700',
    fontStyle: 'normal',
    textAlign: 'center',       // 'left' | 'center' | 'right'
    textBaseline: 'middle',
    letterSpacing: 2,
    lineHeight: 1.2,
    boxWidth: 500,
    boxHeight: 180,
    fillColor: '#ffffff',
    strokeEnabled: false,
    strokeColor: '#000000',
    strokeWidth: 0,
    strokeJoin: 'round',
    shadowEnabled: false,
    shadowColor: 'rgba(0, 0, 0, 0.6)',
    shadowBlur: 8,
    shadowOffsetX: 4,
    shadowOffsetY: 4,
    longShadow: false,
    longShadowColor: 'rgba(0, 0, 0, 0.4)',
    longShadowLength: 24,
    longShadowAngle: 45,        // in degrees
    neonGlow: false,
    neonGlowColor: '#98ce7b',
    neonGlowBlur: 16,
    badgeEnabled: false,
    badgeColor: '#1a2215',
    badgePaddingX: 20,
    badgePaddingY: 10,
    badgeRadius: 12,
    animation: 'none',          // legacy alias for animIn
    animSpeed: 1.0,
    animDecay: 7.0,
    animFreq: 3,
    animAmplitude: 0.6,
    animStagger: 0.5,
    animTarget: 'character',    // 'character' | 'word' | 'line'
    animDuration: 0.8,          // legacy alias for animInDuration
    animIn: 'none',             // 'none' | 'bounce' | 'overshoot' | 'fade' | 'typewriter' | 'glitch'
    animInDuration: 0.8,        // in seconds
    animOut: 'none',            // 'none' | 'bounce' | 'overshoot' | 'fade' | 'typewriter' | 'glitch'
    animOutDuration: 0.6,       // in seconds
    // ── Text Animator ("Animate From", AE Range Selector style) ──
    // Neutral defaults = no effect. Applied per glyph on top of IN/OUT presets.
    animPosX: 0,                // px offset at start of IN / end of OUT
    animPosY: 0,                // px
    animRotation: 0,            // degrees
    animScale: 100,             // percent
    animOpacity: 100,           // percent
    animEase: 'ease_out',       // IN ease: 'ease_out' | 'ease_in_out' | 'back' | 'elastic' | 'linear'
    animInOrder: 'ltr',         // 'ltr' (starts at first glyph) | 'rtl' (starts at last glyph)
    // ── Text Animator OUT ("Animate To"): separate from the IN values above (animPos* = IN) ──
    animOutPosX: 0,             // px offset reached at end of OUT (positive Y = down)
    animOutPosY: 0,             // px
    animOutRotation: 0,         // degrees
    animOutScale: 100,          // percent
    animOutOpacity: 100,        // percent
    animOutEase: 'ease_out',
    animOutOrder: 'ltr',        // 'ltr' | 'rtl'
    presetId: 'default'
  };

  // ─── Text Preset Registry ─────────────────────────────────────────────────
  // Presets live in text/[name].js — each file calls FishTextEngine.registerPreset({...})
  // after text-engine.js loads. No presets are hardcoded here.
  const _textPresetRegistry = [];

  // ─── Animation Type Definitions ──────────────────────────────────────────
  // Legacy ids (bounce_1..4, pop/drop variants, shrink_drop, custom) all map to the single 'bounce'.
  const LEGACY_BOUNCE_IDS = {
    bounce_1: 1, bounce_2: 1, bounce_3: 1, bounce_4: 1,
    bounce_pop: 1, bounce_drop: 1, bounce_out: 1,
    pop_in: 1, pop_out: 1, shrink_drop: 1,
    overshoot_slide: 1, elastic_wobble: 1,
    wave_drop: 1, wave_pop: 1, wave_out: 1,
    custom: 1
  };

  function normalizeAnimIn(anim) {
    if (!anim || anim === 'none') return 'none';
    if (anim === 'bounce' || LEGACY_BOUNCE_IDS[anim]) return 'bounce';
    if (anim === 'overshoot' || anim === 'typewriter' || anim === 'glitch' || anim === 'fade') return anim;
    if (anim === 'fade_up' || anim === 'fade_down' || anim === 'wave' || anim === 'slide_out') return 'fade';
    return 'none';
  }

  function normalizeAnimOut(anim) {
    return normalizeAnimIn(anim);
  }

  const ANIMATION_IN_TYPES = [
    { id: 'none',       label: 'None',       desc: 'Static crisp typography' },
    { id: 'bounce',     label: 'Bounce',     desc: 'Spring settle driven by the Animator values' },
    { id: 'overshoot',  label: 'Overshoot',  desc: 'Ease with overshoot, driven by the Animator values' },
    { id: 'fade',       label: 'Fade',       desc: 'Pure opacity fade-in' },
    { id: 'typewriter', label: 'Typewriter', desc: 'Sequential character typing with cursor' },
    { id: 'glitch',     label: 'Glitch',     desc: 'Digital displacement that settles' }
  ];

  const ANIMATION_OUT_TYPES = [
    { id: 'none',       label: 'None',       desc: 'Static until end of clip' },
    { id: 'bounce',     label: 'Bounce',     desc: 'Spring exit driven by the Animator values' },
    { id: 'overshoot',  label: 'Overshoot',  desc: 'Windup then exit, driven by the Animator values' },
    { id: 'fade',       label: 'Fade',       desc: 'Pure opacity fade-out' },
    { id: 'typewriter', label: 'Typewriter', desc: 'Sequential character vanish' },
    { id: 'glitch',     label: 'Glitch',     desc: 'Digital displacement vanish' }
  ];

  const ANIMATION_TYPES = ANIMATION_IN_TYPES;

  // Range-based types: per-glyph IN/OUT window where the Text Animator applies
  const UNIT_IN_TYPES  = { bounce: 1, overshoot: 1, fade: 1 };
  const UNIT_OUT_TYPES = { bounce: 1, overshoot: 1, fade: 1 };

  // ─── Easing helpers (AE-style ease curves) ───────────────────────────────
  const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
  const smoothstep = (a, b, v) => {
    const x = clamp01((v - a) / (b - a));
    return x * x * (3 - 2 * x);
  };
  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
  const easeOutQuint = (x) => 1 - Math.pow(1 - x, 5);

  const TEXT_EASES = {
    linear:      (x) => x,
    ease_out:    (x) => easeOutQuint(x),                                  // AE expo-style ease out
    ease_in_out: (x) => x * x * x * (x * (x * 6 - 15) + 10),              // smootherstep (Easy Ease)
    back:        (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    elastic:     (x) => (x <= 0 ? 0 : (x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI) / 3) + 1))
  };

  /**
   * Extra padding (unscaled px) so stroke / shadow / glow / long shadow never clip at buffer edge.
   */
  function computeEffectPad(p) {
    const longPad   = p.longShadow ? (Number(p.longShadowLength) || 0) + 10 : 0;
    const shadowPad = p.shadowEnabled
      ? (Number(p.shadowBlur) || 0) + Math.max(Math.abs(Number(p.shadowOffsetX) || 0), Math.abs(Number(p.shadowOffsetY) || 0)) + 6
      : 0;
    const glowPad   = p.neonGlow ? (Number(p.neonGlowBlur) || 0) * 1.5 + 4 : 0;
    const isStrokeOn = p.strokeEnabled !== undefined ? Boolean(p.strokeEnabled) : ((Number(p.strokeWidth) || 0) > 0);
    const strokePad = (isStrokeOn && (Number(p.strokeWidth) || 0) > 0) ? (Number(p.strokeWidth) / 2 + 2) : 0;
    return Math.max(longPad, shadowPad, glowPad) + strokePad;
  }

  /**
   * Build timing config shared by every glyph in one render pass.
   * AE Range Selector model: total IN duration = spread (offset sweep) + per-unit duration.
   * Large per-unit duration vs small step => many glyphs animate simultaneously (smooth overlap).
   */
  function buildAnimConfig(p, normIn, normOut, inDur, outDur, outStartSec, totalUnits, fontSize, resScale = 1) {
    const animStagger = Number(p.animStagger) >= 0 ? Number(p.animStagger) : 0.5;
    const spreadRatio = Math.min(0.85, Math.max(0, animStagger));
    const inSpread = totalUnits > 1 ? inDur * spreadRatio : 0;
    const inUnitDur = Math.max(inDur * 0.15, inDur - inSpread);
    const inStep = totalUnits > 1 ? inSpread / (totalUnits - 1) : 0;

    const outSpread = totalUnits > 1 ? outDur * Math.min(0.55, spreadRatio) : 0;
    const outUnitDur = Math.max(0.24, outDur - outSpread);
    const outStep = totalUnits > 1 ? outSpread / (totalUnits - 1) : 0;

    const num = (v, d) => (v !== undefined && v !== '' && v !== null && isFinite(Number(v))) ? Number(v) : d;
    const mk = (px, py, rot, scl, op, ez) => {
      const o = { posX: num(px, 0), posY: num(py, 0), rot: num(rot, 0), scl: num(scl, 100), op: num(op, 100) };
      return {
        active: o.posX !== 0 || o.posY !== 0 || o.rot !== 0 || o.scl !== 100 || o.op !== 100,
        posX: o.posX * resScale, posY: o.posY * resScale, rot: o.rot,
        scl: o.scl / 100, op: clamp01(o.op / 100),
        ease: TEXT_EASES[ez] || TEXT_EASES.ease_out
      };
    };
    const aIn  = mk(p.animPosX, p.animPosY, p.animRotation, p.animScale, p.animOpacity, p.animEase);
    const aOut = mk(p.animOutPosX, p.animOutPosY, p.animOutRotation, p.animOutScale, p.animOutOpacity, p.animOutEase);

    return {
      normIn, normOut, inDur, outDur, outStartSec, fontSize, totalUnits,
      inRtl: p.animInOrder === 'rtl',
      outRtl: p.animOutOrder === 'rtl',
      inStep, inUnitDur,
      inFadeDur: Math.max(0.05, inUnitDur * 0.35),
      outStep, outUnitDur,
      decay: Number(p.animDecay) > 0 ? Number(p.animDecay) : 7.0,
      freq: Number(p.animFreq) > 0 ? Number(p.animFreq) : 3,
      amp: Number(p.animAmplitude) > 0 ? Number(p.animAmplitude) : 0.6,
      speed: Number(p.animSpeed) || 1.0,
      aIn, aOut
    };
  }

  /**
   * Evaluate one glyph's transform at absolute clip time `sec`.
   * Single source for main draw + motion blur ghosts (guaranteed identical motion).
   */
  function evalGlyphAnim(cfg, sec, animIndex, charIndex) {
    const st = { offX: 0, offY: 0, scaleX: 1, scaleY: 1, alpha: 1, rot: 0 };
    const { normIn, normOut, fontSize } = cfg;
    let amtIn = 0;  // 1 = full IN "Animate From" state, 0 = rest
    let amtOut = 0; // 0 = rest, 1 = full OUT "Animate To" state
    const idxIn  = cfg.inRtl  ? Math.max(0, cfg.totalUnits - 1 - animIndex) : animIndex;
    const idxOut = cfg.outRtl ? Math.max(0, cfg.totalUnits - 1 - animIndex) : animIndex;

    // ── IN ──────────────────────────────────────────────────────────────
    if (normIn === 'glitch') {
      if (sec < cfg.inDur) {
        const k = 1 - smoothstep(0.4, 1, sec / cfg.inDur); // intensity settles to 0
        const quant = Math.floor(sec * 18);
        const hash  = Math.sin(quant * 9999 + charIndex * 1337);
        const hash2 = Math.cos(quant * 4321 + charIndex * 777);
        if (Math.abs(hash) > 0.45) {
          st.offX = hash * fontSize * 0.15 * k;
          st.offY = hash2 * fontSize * 0.08 * k;
          st.alpha = 1 - (1 - (0.55 + Math.abs(hash) * 0.45)) * k;
          st.scaleX = 1.0 + hash * 0.08 * k;
        }
        st.alpha *= smoothstep(0, 0.15, sec / cfg.inDur);
      }
    } else if (UNIT_IN_TYPES[normIn]) {
      const t = sec - cfg.inStep * idxIn;
      const d = cfg.inUnitDur;
      if (cfg.aIn.active) {
        const ez = normIn === 'overshoot' ? TEXT_EASES.back : cfg.aIn.ease;
        amtIn = 1 - ez(clamp01(t / d));
      }
      if (t <= 0) {
        st.alpha = 0;
        return st;
      } else if (t < d) {
        const u = t / d;
        if (normIn === 'bounce') {
          // Spring drives ONLY the Animator state (1 -> 0 with overshoot); tapered to 0 at unit end.
          const tail = 1 - smoothstep(0.5, 1, u);
          const spring = Math.cos(cfg.freq * t * 2 * Math.PI) / Math.exp(cfg.decay * t);
          const k = spring >= 0 ? 1 : Math.min(2, cfg.amp / 0.6);
          amtIn = spring * k * tail;
        } else if (normIn === 'fade') {
          st.alpha = easeOutCubic(clamp01(u / 0.8));
        }
      }
    }

    // ── OUT (additive on top of IN, so no jump at outStart) ─────────────
    if (normOut !== 'none' && normOut !== 'typewriter' && sec >= cfg.outStartSec) {
      const tOut = (sec - cfg.outStartSec) - idxOut * cfg.outStep;
      const d = cfg.outUnitDur;
      if (tOut >= d) {
        st.alpha = 0;
        return st;
      }
      if (cfg.aOut.active && UNIT_OUT_TYPES[normOut] && tOut > 0) {
        // Mirror ease for exit: slow start -> fast end
        amtOut = 1 - (normOut === 'overshoot' ? TEXT_EASES.back : cfg.aOut.ease)(1 - clamp01(tOut / d));
      } else if (tOut > 0) {
        const prog = Math.min(1.0, tOut / d);

        if (normOut === 'fade') {
          st.alpha = Math.min(st.alpha, Math.max(0, 1.0 - Math.pow(prog, 1.4)));
        } else if (normOut === 'glitch') {
          const quant = Math.floor(tOut * 20);
          const hash = Math.sin(quant * 9999 + charIndex * 1337);
          const hash2 = Math.cos(quant * 4321 + charIndex * 777);
          if (Math.abs(hash) > 0.35) {
            st.offX += hash * fontSize * 0.2;
            st.offY += hash2 * fontSize * 0.12;
            st.scaleX *= 1.0 + hash * 0.1;
          }
          st.alpha = Math.min(st.alpha, Math.max(0, 1.0 - Math.pow(prog, 1.3)));
        }
      }
    }

    // ── Text Animator: IN = "Animate From", OUT = "Animate To" (independent values) ──
    const A = cfg.aIn, O = cfg.aOut;
    if (amtIn !== 0) {
      st.offX += A.posX * amtIn;
      st.offY += A.posY * amtIn;
      st.rot  += A.rot * amtIn;
      const sc = Math.max(0, 1 + (A.scl - 1) * amtIn);
      st.scaleX *= sc; st.scaleY *= sc;
      st.alpha *= clamp01(1 - (1 - A.op) * clamp01(amtIn));
    }
    if (amtOut !== 0) {
      st.offX += O.posX * amtOut;
      st.offY += O.posY * amtOut;
      st.rot  += O.rot * amtOut;
      const sc = Math.max(0, 1 + (O.scl - 1) * amtOut);
      st.scaleX *= sc; st.scaleY *= sc;
      st.alpha *= clamp01(1 - (1 - O.op) * clamp01(amtOut));
    }

    return st;
  }


  class FishTextEngine {
    // Registry access — consumed by editor.js renderTextPresetsGrid / addTextLayer
    static get PRESETS() { return _textPresetRegistry; }
    static get ANIMATIONS() { return ANIMATION_IN_TYPES; }
    static get ANIMATION_IN_TYPES() { return ANIMATION_IN_TYPES; }
    static get ANIMATION_OUT_TYPES() { return ANIMATION_OUT_TYPES; }
    static get DEFAULT_PROPS() { return DEFAULT_TEXT_PROPS; }

    /**
     * Register a text preset from an external text/[name].js plugin file.
     * @param {{ id:string, name:string, desc:string, props:object }} preset
     */
    static registerPreset(preset) {
      if (!preset || !preset.id) return;
      // Prevent duplicate registration
      const existing = _textPresetRegistry.findIndex(p => p.id === preset.id);
      if (existing >= 0) {
        _textPresetRegistry[existing] = preset;
      } else {
        _textPresetRegistry.push(preset);
      }
    }

    static getDefaultProps() {
      return Object.assign({}, DEFAULT_TEXT_PROPS);
    }

    static getPresets() {
      return _textPresetRegistry;
    }

    static getPreset(presetId) {
      return _textPresetRegistry.find(p => p.id === presetId) || _textPresetRegistry[0] || null;
    }

    /**
     * Measure text dimensions accurately across multiple lines.
     */
    static measureText(ctx, text, font, letterSpacing = 0, lineHeightMultiplier = 1.2) {
      ctx.save();
      ctx.font = font;
      const lines = String(text || '').split('\n');
      let maxWidth = 0;
      const match = String(font || '').match(/(\d+(?:\.\d+)?)\s*px/i);
      const fontSize = match ? parseFloat(match[1]) : (parseFloat(font) || 64);
      const mult = (Number.isFinite(lineHeightMultiplier) && lineHeightMultiplier > 0) ? lineHeightMultiplier : 1.2;
      const lineH = fontSize * mult;

      lines.forEach(line => {
        let w = 0;
        if (letterSpacing > 0) {
          for (let i = 0; i < line.length; i++) {
            w += ctx.measureText(line[i]).width + letterSpacing;
          }
        } else {
          w = ctx.measureText(line).width;
        }
        if (w > maxWidth) maxWidth = w;
      });

      ctx.restore();
      return {
        width: Math.ceil(maxWidth),
        height: Math.ceil(lines.length * lineH),
        lineHeight: lineH,
        lines
      };
    }

    /**
     * Calculate dynamic tight bounding dimensions for text layer (no fixed box locking).
     */
    static getNaturalSize(layer) {
      if (!layer) return { width: 320, height: 100 };
      const p = Object.assign({}, DEFAULT_TEXT_PROPS, layer.textProps || {});
      const font = (p.fontStyle || 'normal') + ' ' + (p.fontWeight || 'bold') + ' ' + (p.fontSize || 64) + 'px ' + (p.fontFamily || 'Cal Sans');
      
      if (!this._measureCanvas) {
        this._measureCanvas = document.createElement('canvas');
        this._measureCtx = this._measureCanvas.getContext('2d');
      }
      const ctx = this._measureCtx;
      const measure = this.measureText(ctx, p.text || 'Text', font, p.letterSpacing || 0, p.lineHeight || 1.15);

      const padX = p.badgeEnabled ? (p.badgePaddingX * 2 + 16) : 24;
      const padY = p.badgeEnabled ? (p.badgePaddingY * 2 + 16) : 16;
      const shadowPad = computeEffectPad(p);

      const w = Math.max(40, Math.ceil(measure.width + padX + shadowPad * 2));
      const h = Math.max(30, Math.ceil(measure.height + padY + shadowPad * 2));

      return {
        width: w,
        height: h,
        textWidth: measure.width,
        textHeight: measure.height,
        lines: measure.lines,
        lineHeight: measure.lineHeight
      };
    }

    /**
     * Authentic After Effects inertia decay bounce & spring expressions.
     * Evaluates live scale, squash & stretch, translation offset, and alpha at localSec.
     */
    static getAnimTransform(layer, localSec = 0, clipDur = 5) {
      // Staggered character-level animations are evaluated per-glyph inside renderTextToCanvas,
      // preserving layer layout and typography without whole-box distortion.
      return { scaleX: 1.0, scaleY: 1.0, offX: 0, offY: 0, alpha: 1.0 };
    }

    /**
     * Render Text to an offscreen buffer canvas with dynamic resolution.
     */
    static renderTextToCanvas(layer, canvas, targetW, targetH, localSec = 0, clipDur = 5, isSubSample = false) {
      if (!canvas || typeof canvas.getContext !== 'function' || !layer) return canvas;
      const ctx = canvas.getContext('2d');
      if (!ctx) return canvas;

      const p = Object.assign({}, DEFAULT_TEXT_PROPS, layer.textProps || {});

      const MAX_BUFFER_DIM = 4096;
      const baseFontSize = Number(p.fontSize) || 64;
      let resScale = Math.min(2.5, Math.max(1.0, Number(layer && layer._textResScale) || 1.0));

      // Guard: clamp effective font size to 240px to prevent buffer texture explosion
      if (baseFontSize * resScale > 240) {
        resScale = Math.max(1.0, 240 / baseFontSize);
      }

      const effectiveAnimIn = p.animIn || (p.animation && p.animation !== 'none' ? p.animation : 'none');
      const normIn = normalizeAnimIn(effectiveAnimIn);
      const inDur = Math.max(0.1, Number(p.animInDuration || p.animDuration) || 0.8);

      const effectiveAnimOut = p.animOut || 'none';
      const normOut = normalizeAnimOut(effectiveAnimOut);
      const outDur = Math.max(0.1, Number(p.animOutDuration) || 0.6);
      const outStartSec = Math.max(inDur, clipDur - outDur);

      // Fast-path: if text is static or resting in steady state and properties did not change, bypass re-rendering
      const isContinuous = (normIn === 'glitch' || normOut === 'glitch');
      const projFps = (typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60;
      const quant = Math.max(30, Math.round(projFps * 2));
      const timeKey = isSubSample
        ? ('sub_' + Math.round(localSec * 24000))
        : (isContinuous
            ? Math.round(localSec * quant)
            : (normIn === 'none' && normOut === 'none'
                ? 'static'
                : ((localSec >= inDur && (normOut === 'none' || localSec < outStartSec))
                    ? 'steady'
                    : Math.round(localSec * quant))));

      const pKey = JSON.stringify(p);
      const _mbE = (typeof window !== 'undefined') ? window.FishMotionBlurEngine : null;
      let mbSig = '0';
      if (_mbE && layer && typeof _mbE.isLayerActive === 'function' && _mbE.isLayerActive(layer)) {
        const c = _mbE.getConfig();
        mbSig = `${c.shutterAngle}_${c.shutterPhase}`;
      }
      const renderKey = `${pKey}_${resScale}_${targetW}_${targetH}_${timeKey}_mb${mbSig}`;
      const isStaticKey = (timeKey === 'static');

      const w = (typeof window !== 'undefined') ? window : {};
      const isExport = !!(w._isExportingVideo === true || w._isExportingSequence === true || w.isExporting === true);
      const isInteracting = !!(w.isTransformInteracting && !isExport);
      const mbEng = _mbE;
      const mbOn = !isInteracting && !isSubSample && !isStaticKey && mbEng && (typeof mbEng.isEffectBlurActive === 'function' ? mbEng.isEffectBlurActive(layer) : (typeof mbEng.isLayerActive === 'function' && mbEng.isLayerActive(layer)));

      const expectedRenderKey = renderKey + (mbOn ? '_mb' : '_crisp');
      if (!layer._textDirty && canvas._lastRenderKey === expectedRenderKey && canvas.width > 0 && canvas.height > 0) {
        return canvas;
      }

      let fontSize = baseFontSize * resScale;
      let letterSpacing = (p.letterSpacing || 0) * resScale;

      let font = (p.fontStyle || 'normal') + ' ' + (p.fontWeight || 'bold') + ' ' + fontSize + 'px ' + (p.fontFamily || 'Cal Sans');
      let measure = this.measureText(ctx, p.text || 'Text', font, letterSpacing, p.lineHeight);

      let padX = (p.badgeEnabled ? (p.badgePaddingX * 2 + 16) : 24) * resScale;
      let padY = (p.badgeEnabled ? (p.badgePaddingY * 2 + 16) : 16) * resScale;
      let shadowPad = computeEffectPad(p) * resScale;

      let contentW = Math.max(Math.ceil((targetW || 0) * resScale), Math.ceil(measure.width  + padX + shadowPad * 2));
      let contentH = Math.max(Math.ceil((targetH || 0) * resScale), Math.ceil(measure.height + padY + shadowPad * 2));

      // Extra canvas padding so characters can animate/bounce freely outside the text box without clipping (AE style)
      // Clamped to safe range to avoid GPU texture overflow
      const maxAnimOffsetY = Math.max(Math.abs(Number(p.animPosY) || 0), Math.abs(Number(p.animOutPosY) || 0));
      const maxAnimOffsetX = Math.max(Math.abs(Number(p.animPosX) || 0), Math.abs(Number(p.animOutPosX) || 0));
      const maxScale = Math.max(1, (Number(p.animScale) || 100) / 100, (Number(p.animOutScale) || 100) / 100);

      const baseAnimPadX = Math.ceil(Math.max(fontSize * maxScale * 0.75, 40 * resScale));
      const baseAnimPadY = Math.ceil(Math.max(fontSize * maxScale * 1.0, 60 * resScale));

      let animPadX = Math.ceil(baseAnimPadX + maxAnimOffsetX * resScale * 1.8);
      let animPadY = Math.ceil(baseAnimPadY + maxAnimOffsetY * resScale * 1.8);

      let reqW = contentW + animPadX * 2;
      let reqH = contentH + animPadY * 2;

      // Safe hardware texture clamp: automatically downscale resScale if buffer dimensions exceed MAX_BUFFER_DIM
      // For animated text during preview, enforce MAX_PIXELS <= 2.2 Megapixels to prevent 60fps drops
      const isAnim = (normIn !== 'none' || normOut !== 'none' || isContinuous || maxAnimOffsetY > 0 || maxAnimOffsetX > 0);
      const MAX_PIXELS = (isAnim && !isExport) ? (1920 * 1152) : (MAX_BUFFER_DIM * MAX_BUFFER_DIM);
      if (reqW > MAX_BUFFER_DIM || reqH > MAX_BUFFER_DIM || (reqW * reqH > MAX_PIXELS)) {
        let factor = Math.min(MAX_BUFFER_DIM / reqW, MAX_BUFFER_DIM / reqH);
        if (reqW * reqH > MAX_PIXELS) {
          factor = Math.min(factor, Math.sqrt(MAX_PIXELS / (reqW * reqH)));
        }
        resScale = Math.max(0.5, resScale * factor);
        fontSize = baseFontSize * resScale;
        letterSpacing = (p.letterSpacing || 0) * resScale;
        font = (p.fontStyle || 'normal') + ' ' + (p.fontWeight || 'bold') + ' ' + fontSize + 'px ' + (p.fontFamily || 'Cal Sans');
        measure = this.measureText(ctx, p.text || 'Text', font, letterSpacing, p.lineHeight);
        padX *= factor;
        padY *= factor;
        shadowPad *= factor;
        contentW = Math.max(Math.ceil((targetW || 0) * resScale), Math.ceil(measure.width + padX + shadowPad * 2));
        contentH = Math.max(Math.ceil((targetH || 0) * resScale), Math.ceil(measure.height + padY + shadowPad * 2));
        const bPadX = Math.ceil(Math.max(fontSize * maxScale * 0.75, 40 * resScale));
        const bPadY = Math.ceil(Math.max(fontSize * maxScale * 1.0, 60 * resScale));
        animPadX = Math.ceil(bPadX + maxAnimOffsetX * resScale * 1.8);
        animPadY = Math.ceil(bPadY + maxAnimOffsetY * resScale * 1.8);
        reqW = Math.min(MAX_BUFFER_DIM, contentW + animPadX * 2);
        reqH = Math.min(MAX_BUFFER_DIM, contentH + animPadY * 2);
      }

      if (layer) {
        layer._textPadX = animPadX;
        layer._textPadY = animPadY;
        layer._textNaturalW = contentW;
        layer._textNaturalH = contentH;
        layer._textResScaleApplied = resScale;
      }

      reqW = Math.max(1, Math.min(MAX_BUFFER_DIM, reqW));
      reqH = Math.max(1, Math.min(MAX_BUFFER_DIM, reqH));

      if (canvas.width !== reqW || canvas.height !== reqH) {
        canvas.width  = reqW;
        canvas.height = reqH;
      }

      ctx.clearRect(0, 0, reqW, reqH);
      ctx.save();

      const cx = reqW / 2;
      const cy = reqH / 2;

      const lines = measure.lines;
      const lineH = measure.lineHeight;
      const totalH = lines.length * lineH;
      const startY = cy - (totalH / 2) + (lineH / 2);

      let globalCharIndex = 0;
      const fullText = lines.join('');
      const totalChars = fullText.length || 1;

      // ── animTarget: precompute stagger unit index per glyph (character / word / line) ──
      const animTarget = p.animTarget || 'character';
      const unitIndexByChar = [];
      let totalUnits = totalChars;
      if (animTarget === 'line') {
        lines.forEach((line, li) => { for (let i = 0; i < line.length; i++) unitIndexByChar.push(li); });
        totalUnits = lines.length;
      } else if (animTarget === 'word') {
        let wCount = 0;
        let prevWs = false;
        lines.forEach((line, li) => {
          if (li > 0 && !prevWs) { wCount++; prevWs = true; } // line break acts as separator
          for (let i = 0; i < line.length; i++) {
            const ws = /\s/.test(line[i]);
            if (ws && !prevWs) wCount++;
            prevWs = ws;
            unitIndexByChar.push(wCount);
          }
        });
        totalUnits = (unitIndexByChar.length ? unitIndexByChar[unitIndexByChar.length - 1] : 0) + 1;
      } else {
        for (let i = 0; i < fullText.length; i++) unitIndexByChar.push(i);
      }

      const animCfg = buildAnimConfig(p, normIn, normOut, inDur, outDur, outStartSec, totalUnits, fontSize, resScale);

      // Full styled glyph (long shadow, glow, drop shadow, stroke, fill) at origin = glyph center.
      const paintGlyph = (g, ch, chW) => {
        g.font = font;
        g.textBaseline = 'middle';
        g.lineJoin = p.strokeJoin || 'round';
        if (p.longShadow && p.longShadowLength > 0) {
          g.save();
          g.fillStyle = p.longShadowColor || 'rgba(0, 0, 0, 0.4)';
          const rad = ((p.longShadowAngle !== undefined ? p.longShadowAngle : 45) * Math.PI) / 180;
          const cosA = Math.cos(rad);
          const sinA = Math.sin(rad);
          const steps = Math.min(80, Math.round(p.longShadowLength * resScale));
          for (let s = 1; s <= steps; s++) g.fillText(ch, -(chW / 2) + s * cosA, s * sinA);
          g.restore();
        }
        if (p.neonGlow) {
          g.save();
          g.shadowColor = p.neonGlowColor || '#98ce7b';
          g.shadowBlur = (p.neonGlowBlur || 16) * resScale;
          g.shadowOffsetX = 0;
          g.shadowOffsetY = 0;
          g.fillStyle = p.fillColor || '#ffffff';
          g.fillText(ch, -(chW / 2), 0);
          g.fillText(ch, -(chW / 2), 0); // Double pass for intense neon
          g.restore();
        }
        if (p.shadowEnabled) {
          g.save();
          g.shadowColor = p.shadowColor || 'rgba(0,0,0,0.6)';
          g.shadowBlur = (p.shadowBlur || 8) * resScale;
          g.shadowOffsetX = (p.shadowOffsetX || 4) * resScale;
          g.shadowOffsetY = (p.shadowOffsetY || 4) * resScale;
          g.fillStyle = p.fillColor || '#ffffff';
          g.fillText(ch, -(chW / 2), 0);
          g.restore();
        }
        const isStrokeOn = p.strokeEnabled !== undefined ? Boolean(p.strokeEnabled) : ((Number(p.strokeWidth) || 0) > 0);
        if (isStrokeOn && Number(p.strokeWidth) > 0) {
          g.save();
          g.strokeStyle = p.strokeColor || '#000000';
          g.lineWidth = p.strokeWidth * resScale;
          g.strokeText(ch, -(chW / 2), 0);
          g.restore();
        }
        g.fillStyle = p.fillColor || '#ffffff';
        g.fillText(ch, -(chW / 2), 0);
      };

      // Pre-rasterized glyph sprites (per layer, invalidated when style changes). Motion-blur
      // sub-samples just blit these → N samples cost ≈ N cheap drawImage, not N text rasterizations.
      const isStrokeOn = p.strokeEnabled !== undefined ? Boolean(p.strokeEnabled) : ((Number(p.strokeWidth) || 0) > 0);
      const spriteKey = `${font}|${resScale}|${p.fillColor}|${isStrokeOn}|${p.strokeColor}|${p.strokeWidth}|${p.strokeJoin}|${p.shadowEnabled}|${p.shadowColor}|${p.shadowBlur}|${p.shadowOffsetX}|${p.shadowOffsetY}|${p.neonGlow}|${p.neonGlowColor}|${p.neonGlowBlur}|${p.longShadow}|${p.longShadowColor}|${p.longShadowLength}|${p.longShadowAngle}`;
      if (!layer._glyphSprites || layer._glyphSprites.key !== spriteKey) {
        layer._glyphSprites = { key: spriteKey, map: new Map() };
      }
      const spriteMap = layer._glyphSprites.map;
      const strokePad = (isStrokeOn && (Number(p.strokeWidth) || 0) > 0) ? (Number(p.strokeWidth) || 0) : 0;
      const spritePad = Math.ceil((computeEffectPad(p) + strokePad + (p.longShadow ? (Number(p.longShadowLength) || 0) : 0)) * resScale + 4);
      const getGlyphSprite = (ch, chW) => {
        const safeChW = (Number.isFinite(chW) && chW > 0) ? chW : 10;
        const k = ch + '|' + safeChW.toFixed(2);
        let sp = spriteMap.get(k);
        if (sp && sp.c && sp.c.width > 0 && sp.c.height > 0) return sp;
        const c = document.createElement('canvas');
        const sw = Math.max(1, Math.min(4096, Math.ceil(safeChW + fontSize * 0.5 + spritePad * 2) || 1));
        const sh = Math.max(1, Math.min(4096, Math.ceil(fontSize * 1.5 + spritePad * 2) || 1));
        c.width = sw;
        c.height = sh;
        const g = c.getContext('2d');
        if (g) {
          g.translate(sw / 2, sh / 2);
          paintGlyph(g, ch, safeChW);
        }
        sp = { c, ox: sw / 2, oy: sh / 2 };
        spriteMap.set(k, sp);
        return sp;
      };

      // Per-line character advances are time-independent → measure once, reuse every sample.
      const lineAdvanceCache = [];

      // One full frame of glyphs at time `localSec` into `ctx` (shadowed params so the
      // same body serves the single pass and every motion-blur sub-sample).
      const drawFrame = (ctx, localSec, useSprites = false) => {
      globalCharIndex = 0;
      // Typewriter IN progress
      let isTypewriter = (normIn === 'typewriter' || p.animation === 'typewriter');
      let visibleChars = totalChars;
      if (isTypewriter) {
        const prog = Math.min(1.0, Math.max(0, localSec / inDur));
        visibleChars = Math.floor(prog * totalChars);
      }

      // Typewriter OUT: chars vanish right-to-left using global progress (no per-char stagger)
      let isTypewriterOut = (normOut === 'typewriter');
      let visibleCharsOut = totalChars;
      if (isTypewriterOut && localSec >= outStartSec) {
        const outProg = Math.min(1.0, (localSec - outStartSec) / outDur);
        visibleCharsOut = Math.floor((1 - outProg) * totalChars);
      }

      // 1. Draw Badge Background Pill / Box if enabled
      if (p.badgeEnabled) {
        ctx.save();
        const boxW = measure.width + p.badgePaddingX * 2 * resScale;
        const boxH = measure.height + p.badgePaddingY * 2 * resScale;
        const bx = cx - boxW / 2;
        const by = cy - boxH / 2;
        const rad = Math.min((p.badgeRadius !== undefined ? p.badgeRadius : 12) * resScale, boxH / 2);

        let badgeAlpha = 1.0;
        if (normIn !== 'none' && localSec < inDur) {
          badgeAlpha = Math.min(1.0, Math.max(0, localSec / Math.max(0.05, inDur * 0.4)));
        } else if (normOut !== 'none' && localSec >= outStartSec) {
          const outProg = Math.min(1.0, Math.max(0, (localSec - outStartSec) / outDur));
          badgeAlpha = Math.max(0, 1.0 - Math.pow(outProg, 1.6));
        }
        ctx.globalAlpha = badgeAlpha;

        ctx.fillStyle = p.badgeColor || '#1a2215';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(bx, by, boxW, boxH, rad);
        } else {
          ctx.rect(bx, by, boxW, boxH);
        }
        ctx.fill();
        ctx.restore();
      }

      // 2. Prepare text lines and layout
      ctx.font = font;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = p.strokeJoin || 'round';

      lines.forEach((line, lineIdx) => {
        const curY = startY + lineIdx * lineH;

        // Calculate line width for alignment
        let adv = lineAdvanceCache[lineIdx];
        if (!adv) {
          ctx.font = font;
          const ws = [];
          let tw = 0;
          for (let i = 0; i < line.length; i++) {
            const cw = ctx.measureText(line[i]).width + letterSpacing;
            ws.push(cw);
            tw += cw;
          }
          adv = lineAdvanceCache[lineIdx] = { ws, tw };
        }
        const charWidths = adv.ws;
        const lineWidth = adv.tw;

        let curX = cx - (lineWidth / 2);
        if (p.textAlign === 'left') curX = cx - (measure.width / 2);
        else if (p.textAlign === 'right') curX = cx + (measure.width / 2) - lineWidth;

        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          const chW = charWidths[i];
          const charIndex = globalCharIndex++;

          // Skip invisible characters in typewriter IN
          if (isTypewriter && charIndex > visibleChars) {
            continue;
          }
          // Typewriter OUT: hide chars from end
          if (isTypewriterOut && charIndex >= visibleCharsOut) {
            curX += chW;
            continue;
          }

          // ── Unified glyph animation (IN + OUT) — AE-style overlapping range ──
          const animIndex = unitIndexByChar[charIndex] !== undefined ? unitIndexByChar[charIndex] : charIndex;
          const anim = evalGlyphAnim(animCfg, localSec, animIndex, charIndex);
          const offX = anim.offX;
          const offY = anim.offY;
          const scaleX = anim.scaleX;
          const scaleY = anim.scaleY;
          const charAlpha = anim.alpha;
          const charRotation = anim.rot;

          if (charAlpha <= 0.001) {
            curX += chW;
            continue;
          }

          ctx.save();
          ctx.globalAlpha = charAlpha;

          const renderX = curX + (chW / 2) + offX;
          const renderY = curY + offY;

          ctx.translate(renderX, renderY);
          if (charRotation !== 0) ctx.rotate(charRotation * Math.PI / 180);
          if (scaleX !== 1.0 || scaleY !== 1.0) {
            ctx.scale(scaleX, scaleY);
          }

          if (useSprites) {
            const sp = getGlyphSprite(ch, chW);
            if (sp && sp.c && sp.c.width > 0 && sp.c.height > 0) {
              ctx.drawImage(sp.c, -sp.ox, -sp.oy);
            } else {
              paintGlyph(ctx, ch, chW);
            }
          } else {
            paintGlyph(ctx, ch, chW);
          }

          ctx.restore();

          curX += chW;
        }

        // Draw Typewriter cursor if still typing
        if ((normIn === 'typewriter' || p.animation === 'typewriter') && localSec < inDur) {
          const blink = Math.floor(localSec * 4) % 2 === 0;
          if (blink && lineIdx === lines.length - 1) {
            ctx.save();
            ctx.fillStyle = p.fillColor || '#98ce7b';
            ctx.fillRect(curX + 4 * resScale, curY - fontSize * 0.4, 4 * resScale, fontSize * 0.8);
            ctx.restore();
          }
        }
      });
      }; // end drawFrame

      // ── AE-style per-glyph motion blur ─────────────────────────────────────────
      // Every glyph is sampled across the shutter interval and averaged via running
      // mean (two-step: 'destination-in' scales old mean by i/(i+1), 'lighter' adds
      // new sample at 1/(i+1)). Transparent pixels dilute the mean, so trails stay
      // symmetric; buffer stays near full brightness, so no 8-bit hue shift.
      let drewBlur = false;
      if (mbOn) {
        try {
          const shutter = (typeof mbEng.getShutter === 'function')
            ? mbEng.getShutter(null, localSec)
            : { exposureTime: 0, tStart: localSec };
          const exposure = shutter.exposureTime;
          const t0 = shutter.tStart;
          const t1 = t0 + exposure;
          if (Number.isFinite(exposure) && exposure > 0.0001) {
            // Measure max glyph travel inside shutter window
            let maxTravel = 0;
            const probeN = Math.min(totalChars, 64);
            for (let ci = 0; ci < probeN; ci++) {
              const gi = Math.floor(ci * totalChars / probeN);
              const ui = unitIndexByChar[gi] !== undefined ? unitIndexByChar[gi] : gi;
              const a = evalGlyphAnim(animCfg, t0, ui, gi);
              const b = evalGlyphAnim(animCfg, (t0 + t1) / 2, ui, gi);
              const c = evalGlyphAnim(animCfg, t1, ui, gi);
              const seg = (g1, g2) => {
                const dx = Number.isFinite(g2.offX - g1.offX) ? (g2.offX - g1.offX) : 0;
                const dy = Number.isFinite(g2.offY - g1.offY) ? (g2.offY - g1.offY) : 0;
                const dr = Number.isFinite(g2.rot - g1.rot) ? Math.abs(g2.rot - g1.rot) : 0;
                const ds = Math.max(
                  Number.isFinite(g2.scaleX - g1.scaleX) ? Math.abs(g2.scaleX - g1.scaleX) : 0,
                  Number.isFinite(g2.scaleY - g1.scaleY) ? Math.abs(g2.scaleY - g1.scaleY) : 0
                );
                return Math.hypot(dx, dy) + dr * Math.PI / 180 * fontSize * 0.5 + ds * fontSize * 0.5;
              };
              const travel = seg(a, b) + seg(b, c);
              if (Number.isFinite(travel) && travel > maxTravel) maxTravel = travel;
            }
            if (Number.isFinite(maxTravel) && maxTravel > 0.75) {
              const q = (mbEng && typeof mbEng.getQuality === 'function') ? mbEng.getQuality() : null;
              const isMobileDev = (typeof window !== 'undefined' && window.innerWidth <= 600);
              const previewCap = isExport ? (q ? (q.isExport ? 64 : q.maxSamples) : 16) : (isMobileDev ? 6 : 8);
              const spacing = q ? (q.isExport ? 1.0 : q.spacing) : 2.0;
              const safeSpacing = Number.isFinite(spacing) && spacing > 0 ? spacing : 2.0;
              const safeCap = Number.isFinite(previewCap) && previewCap >= 2 ? previewCap : 8;
              const n = Math.max(3, Math.min(safeCap, Math.ceil(maxTravel / safeSpacing) || 3));

              if (!FishTextEngine._mbScratch || typeof FishTextEngine._mbScratch.getContext !== 'function') {
                FishTextEngine._mbScratch = document.createElement('canvas');
                FishTextEngine._mbScratchCtx = null;
              }
              const sc = FishTextEngine._mbScratch;
              const safeReqW = Math.max(1, Math.min(MAX_BUFFER_DIM, Math.round(reqW) || 1));
              const safeReqH = Math.max(1, Math.min(MAX_BUFFER_DIM, Math.round(reqH) || 1));
              if (sc.width !== safeReqW || sc.height !== safeReqH) {
                sc.width = safeReqW;
                sc.height = safeReqH;
                FishTextEngine._mbScratchCtx = sc.getContext('2d');
              }
              if (!FishTextEngine._mbScratchCtx) {
                FishTextEngine._mbScratchCtx = sc.getContext('2d');
              }
              const sctx = FishTextEngine._mbScratchCtx;
              if (sctx && sc.width > 0 && sc.height > 0) {
                ctx.save();
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = 1;
                for (let si = 0; si < n; si++) {
                  const ts = t0 + ((si + 0.5) / n) * exposure;
                  sctx.setTransform(1, 0, 0, 1, 0, 0);
                  sctx.clearRect(0, 0, safeReqW, safeReqH);
                  sctx.save();
                  drawFrame(sctx, ts, true);
                  sctx.restore();
                  if (si === 0) {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.globalAlpha = 1;
                    ctx.drawImage(sc, 0, 0);
                  } else {
                    const wgt = 1 / (si + 1);
                    ctx.globalCompositeOperation = 'destination-in';
                    ctx.globalAlpha = 1 - wgt;
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, safeReqW, safeReqH);
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.globalAlpha = wgt;
                    ctx.drawImage(sc, 0, 0);
                    ctx.globalAlpha = 1;
                  }
                }
                ctx.restore();
                drewBlur = true;
              }
            }
          }
        } catch (mbErr) {
          console.warn('[FishTextEngine] Motion blur sampling fallback:', mbErr);
          drewBlur = false;
        }
      }
      if (!drewBlur) drawFrame(ctx, localSec);

      ctx.restore();
      canvas._lastRenderKey = expectedRenderKey;
      canvas._contentVersion = (canvas._contentVersion || 0) + 1;
      if (layer && !isSubSample) layer._textDirty = false;
      return canvas;
    }
  }

  FishTextEngine.normalizeAnimIn = normalizeAnimIn;
  FishTextEngine.normalizeAnimOut = normalizeAnimOut;
  FishTextEngine.buildAnimConfig = buildAnimConfig;
  FishTextEngine.evalGlyphAnim = evalGlyphAnim;

  // Export to global window
  window.FishTextEngine = FishTextEngine;
})(typeof window !== 'undefined' ? window : this);
