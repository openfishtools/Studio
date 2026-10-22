/**
 * OpenFishTools Studio - Editor Animation & Graph Editor
 * Manages easing curves (Cubic Bezier, Elastic, Bounce, Cyclic), expression evaluation & AST compilation,
 * property interpolation, effective props cache, and Graph Editor Bezier curve editor.
 */
(function() {

  function createExpressionDummy() {
    const dummy = function() { return 0; };
    dummy.value = 0;
    dummy.slider = 0;
    dummy.valueOf = () => 0;
    dummy.toString = () => '0';
    return dummy;
  }


    window.activeKeyframeProperty = 'move'; // 'move', 'rotate', 'scale', 'skew', etc.
    window.selectedLayerId = window.selectedLayerId || null;
    let isGraphOvershootEnabled = false;

    // Hoisted Horner curve evaluators — 0 closure allocations per call
    function _sampleCurveX(ax, bx, cx, s) {
      return ((ax * s + bx) * s + cx) * s;
    }
    function _sampleCurveY(ay, by, cy, s) {
      return ((ay * s + by) * s + cy) * s;
    }
    function _sampleCurveDerivativeX(ax, bx, cx, s) {
      return (3.0 * ax * s + 2.0 * bx) * s + cx;
    }

    // High-performance Cubic Bezier Solver (Alight Motion CubicBezierEasing Horner + binary subdivision)
    function evaluateCubicBezier(x1, y1, x2, y2, t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      if ((x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1) || (x1 === y1 && x2 === y2)) return t;

      const cx = 3.0 * x1;
      const bx = 3.0 * (x2 - x1) - cx;
      const ax = 1.0 - cx - bx;

      const cy = 3.0 * y1;
      const by = 3.0 * (y2 - y1) - cy;
      const ay = 1.0 - cy - by;

      let s = t;
      for (let i = 0; i < 8; i++) {
        const currentX = _sampleCurveX(ax, bx, cx, s) - t;
        if (Math.abs(currentX) < 1e-5) return _sampleCurveY(ay, by, cy, s);
        const dX = _sampleCurveDerivativeX(ax, bx, cx, s);
        if (Math.abs(dX) < 1e-5) break;
        const nextS = s - currentX / dX;
        if (nextS < 0.0 || nextS > 1.0) break;
        s = nextS;
      }

      let low = 0.0, high = 1.0;
      s = Math.max(0.0, Math.min(1.0, s));
      for (let j = 0; j < 12; j++) {
        const currentX = _sampleCurveX(ax, bx, cx, s);
        if (Math.abs(currentX - t) < 1e-5) return _sampleCurveY(ay, by, cy, s);
        if (t > currentX) low = s;
        else high = s;
        s = (high - low) * 0.5 + low;
      }
      return _sampleCurveY(ay, by, cy, s);
    }
    window.evaluateCubicBezier = evaluateCubicBezier;

    function _elasticBasic(time, sL, exp) {
      const omega = (Math.PI * time) / sL;
      const tC = Math.max(0.005, Math.min(1.0, time));
      const env = Math.abs(Math.pow(1.0 - tC, exp));
      return Math.cos(omega) * env;
    }

    // 1. Elastic Easing (com.alightcreative.app.motion.easing.ElasticEasing bytecode reproduction)
    function evalElasticEasing(t, stepLength, decay, magnitude) {
      if (t <= 0) return 0.0;
      if (t >= 1) return 1.0;
      const sL = (typeof stepLength === 'number' && !isNaN(stepLength)) ? Math.max(0.05, Math.min(0.95, stepLength)) : 0.35;
      const d = (typeof decay === 'number' && !isNaN(decay)) ? Math.max(0.0, Math.min(0.95, decay)) : 0.45;
      const mag = (typeof magnitude === 'number' && !isNaN(magnitude)) ? Math.max(0.0, Math.min(1.0, magnitude)) : 0.5;
      const exp = 1.0 + 15.0 * (d * d);

      if (t < sL) {
        const v0 = 1.0 - (_elasticBasic(sL, sL, exp) * mag);
        const v1 = (1.0 - Math.cos((Math.PI * t) / sL)) / 2.0;
        const normT = t / sL;
        const powVal = 1.0 - Math.pow(normT, 3.0);
        const baseVal = 1.0 - (_elasticBasic(t, sL, exp) * mag);
        return (v1 * v0 * powVal) + (baseVal * (1.0 - powVal));
      }
      return 1.0 - (_elasticBasic(t, sL, exp) * mag);
    }
    window.evalElasticEasing = evalElasticEasing;

    // 2. Bounce Easing (com.alightcreative.app.motion.easing.BounceEasing bytecode reproduction)
    function evalBounceEasing(t, firstStepLength, bounciness) {
      const fStep = (typeof firstStepLength === 'number' && !isNaN(firstStepLength)) ? Math.max(0.05, Math.min(0.95, firstStepLength)) : 0.45;
      const bnc = (typeof bounciness === 'number' && !isNaN(bounciness)) ? Math.max(0.05, Math.min(0.95, bounciness)) : 0.65;

      if (fStep <= 0) return 1.0;
      if (t <= 0) return 0.0;
      if (t >= 1) return 1.0;

      const tShifted = t + (fStep / 2.0);
      let step = fStep;
      let height = 1.0;
      let start = 0.0;

      while (tShifted > start + step && step > 0.002) {
        start += step;
        step *= bnc;
        height *= bnc;
        if (height < 0.005) return 1.0;
      }

      const norm = (tShifted - start) / Math.max(0.002, step);
      const x = Math.abs((norm - 0.5) * 2.0);
      return (1.0 - height) + (x * x) * height;
    }
    window.evalBounceEasing = evalBounceEasing;

    function _cyclicPctInStep(time, sL) {
      const rem = ((time % sL) + sL) % sL;
      return rem / sL;
    }

    function _cyclicSkewInterp(time, sL, skw) {
      const pct = _cyclicPctInStep(time, sL);
      let factor;
      if (pct < skw) {
        factor = 0.5 * (pct / skw);
      } else if (pct > skw) {
        factor = 0.5 + 0.5 * ((pct - skw) / (1.0 - skw));
      } else {
        factor = 0.5;
      }
      const stepBase = time - (pct * sL);
      return stepBase + (factor * sL);
    }

    function _cyclicCosInterp(time, sL) {
      const phase = (time / sL) * (Math.PI * 2.0);
      return 1.0 - (Math.cos(phase) + 1.0) / 2.0;
    }

    function _cyclicSawInterp(time, sL) {
      return 1.0 - (Math.abs(_cyclicPctInStep(time, sL) - 0.5) * 2.0);
    }

    // 3. Cyclic Easing (com.alightcreative.app.motion.easing.CyclicEasing bytecode reproduction)
    function evalCyclicEasing(t, stepLength, sharpness, skew, decay) {
      if (t <= 0) return 0.0;
      if (t >= 1) return 1.0;
      const sL = (typeof stepLength === 'number' && !isNaN(stepLength)) ? Math.max(0.005, Math.min(0.95, stepLength)) : 0.35;
      const shp = (typeof sharpness === 'number' && !isNaN(sharpness)) ? Math.max(0.0, Math.min(1.0, sharpness)) : 0.0;
      const skw = (typeof skew === 'number' && !isNaN(skew)) ? Math.max(0.001, Math.min(0.999, skew)) : 0.5;
      const dcy = (typeof decay === 'number' && !isNaN(decay)) ? Math.max(0.0, Math.min(0.9, decay)) : 0.0;

      const skewedT = _cyclicSkewInterp(t, sL, skw);
      const cosV = _cyclicCosInterp(skewedT, sL);
      const sawV = _cyclicSawInterp(skewedT, sL);
      let v = cosV * (1.0 - shp) + sawV * shp;

      const base = t - (t % sL);
      if (base + sL / 4.0 > 1.0) {
        v = 0.0;
      } else if (base + sL / 2.0 < 1.0) {
        if (base + sL * 3.0 / 4.0 > 1.0 && _cyclicPctInStep(t, sL) > skw) {
          v = 1.0;
        }
      }

      return v * (1.0 - t * dcy) + (t * dcy);
    }
    window.evalCyclicEasing = evalCyclicEasing;

    function speedParamsToBezier(outSpeed, outInfl, inSpeed, inInfl) {
      const i1 = Math.max(0.005, Math.min(1.0, (typeof outInfl === 'number' ? outInfl : 33.33) / 100));
      const i2 = Math.max(0.005, Math.min(1.0, (typeof inInfl === 'number' ? inInfl : 33.33) / 100));
      const s1 = Math.max(0, (typeof outSpeed === 'number' ? outSpeed : 0)) / 100;
      const s2 = Math.max(0, (typeof inSpeed === 'number' ? inSpeed : 0)) / 100;
      return [
        Number(i1.toFixed(3)),
        Number((s1 * i1).toFixed(3)),
        Number((1.0 - i2).toFixed(3)),
        Number((1.0 - s2 * i2).toFixed(3))
      ];
    }
    window.speedParamsToBezier = speedParamsToBezier;

    function bezierToSpeedParams(easing) {
      const eas = (Array.isArray(easing) && easing.length === 4) ? easing : [0.42, 0.0, 0.58, 1.0];
      const x1 = Math.max(0.005, Math.min(1.0, Number(eas[0]) || 0.33));
      const y1 = Number(eas[1]) || 0;
      const x2 = Math.max(0.0, Math.min(0.995, Number(eas[2]) !== undefined ? Number(eas[2]) : 0.67));
      const y2 = Number(eas[3]) !== undefined ? Number(eas[3]) : 1.0;
      const i2 = Math.max(0.005, 1.0 - x2);
      const outInfl = Math.round(Math.max(1, Math.min(100, x1 * 100)));
      const inInfl = Math.round(Math.max(1, Math.min(100, i2 * 100)));
      const outSpeed = Math.round(Math.max(0, Math.min(300, (y1 / x1) * 100)));
      const inSpeed = Math.round(Math.max(0, Math.min(300, ((1.0 - y2) / i2) * 100)));
      return { outInfl, outSpeed, inInfl, inSpeed };
    }
    window.bezierToSpeedParams = bezierToSpeedParams;

    function cloneEasingConfig(cfg) {
      if (!cfg || typeof cfg !== 'object') return null;
      const copy = Object.assign({}, cfg);
      if (Array.isArray(cfg.easing)) copy.easing = [...cfg.easing];
      if (cfg.params && typeof cfg.params === 'object') copy.params = Object.assign({}, cfg.params);
      return copy;
    }
    window.cloneEasingConfig = cloneEasingConfig;

    // Unified evaluator supporting Value (Bezier), Speed, Elastic, Bounce, and Cyclic keyframes
    function evaluateKeyframeEasing(kfOrConfig, t, fallbackBezier) {
      if (t <= 0) return 0.0;
      if (t >= 1) return 1.0;

      let cfg = null;
      let bez = null;

      if (Array.isArray(kfOrConfig)) {
        bez = kfOrConfig;
      } else if (kfOrConfig && typeof kfOrConfig === 'object') {
        if (kfOrConfig.easingConfig && typeof kfOrConfig.easingConfig === 'object') {
          cfg = kfOrConfig.easingConfig;
        } else if (kfOrConfig.type && (kfOrConfig.type === 'elastic' || kfOrConfig.type === 'bounce' || kfOrConfig.type === 'cyclic' || kfOrConfig.type === 'speed' || kfOrConfig.type === 'value')) {
          cfg = kfOrConfig;
        }
        if (Array.isArray(kfOrConfig.easing) && kfOrConfig.easing.length === 4) {
          bez = kfOrConfig.easing;
        }
      }

      if (cfg && cfg.type) {
        const p = (cfg.params && typeof cfg.params === 'object') ? Object.assign({}, cfg, cfg.params) : cfg;
        const isReverse = Boolean(p.reverse || cfg.mode === 'out');
        if (cfg.type === 'cyclic') {
          const raw = evalCyclicEasing(isReverse ? 1.0 - t : t, p.stepLength, p.sharpness, p.skew, p.decay);
          return isReverse ? 1.0 - raw : raw;
        }
        if (cfg.type === 'elastic') {
          const raw = evalElasticEasing(isReverse ? 1.0 - t : t, p.stepLength, p.decay, p.magnitude);
          return isReverse ? 1.0 - raw : raw;
        }
        if (cfg.type === 'bounce') {
          const raw = evalBounceEasing(isReverse ? 1.0 - t : t, p.firstStepLength, p.bounciness);
          return isReverse ? 1.0 - raw : raw;
        }
        if (cfg.type === 'speed' && p.outInfl !== undefined) {
          const spBez = speedParamsToBezier(p.outSpeed, p.outInfl, p.inSpeed, p.inInfl);
          return evaluateCubicBezier(spBez[0], spBez[1], spBez[2], spBez[3], t);
        }
      }

      const e = (Array.isArray(bez) && bez.length === 4)
        ? bez
        : ((Array.isArray(fallbackBezier) && fallbackBezier.length === 4) ? fallbackBezier : [0.0, 0.0, 1.0, 1.0]);
      return evaluateCubicBezier(e[0], e[1], e[2], e[3], t);
    }
    window.evaluateKeyframeEasing = evaluateKeyframeEasing;

    // Get layer property value snapshot for keyframing
    function getLayerPropertyValue(layer, prop) {
      if (!layer) return {};
      const pps = window.currentPixelsPerSecond || 80;
      const currentPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
      const currentSec = Number((Math.abs(currentPanX) / pps).toFixed(3));
      const isParented = !!(layer && layer.parentId);
      const eff = (typeof getLayerEffectivePropsAtTime === 'function')
        ? getLayerEffectivePropsAtTime(layer, currentSec, null, null, isParented)
        : layer;

      if (prop === 'move') {
        return {
          posX: layer.posX !== undefined ? layer.posX : (eff.posX !== undefined ? eff.posX : 540),
          posY: layer.posY !== undefined ? layer.posY : (eff.posY !== undefined ? eff.posY : 960),
          posZ: layer.posZ !== undefined ? layer.posZ : (eff.posZ !== undefined ? eff.posZ : 0),
          anchorX: layer.anchorX !== undefined ? layer.anchorX : (eff.anchorX !== undefined ? eff.anchorX : 0),
          anchorY: layer.anchorY !== undefined ? layer.anchorY : (eff.anchorY !== undefined ? eff.anchorY : 0),
          anchorZ: layer.anchorZ !== undefined ? layer.anchorZ : (eff.anchorZ !== undefined ? eff.anchorZ : 0)
        };
      }
      if (prop === 'rotate') {
        return {
          rotZ: layer.rotZ !== undefined ? layer.rotZ : (layer.rotation !== undefined ? layer.rotation : (eff.rotZ !== undefined ? eff.rotZ : 0)),
          rotX: layer.rotX !== undefined ? layer.rotX : (eff.rotX !== undefined ? eff.rotX : 0),
          rotY: layer.rotY !== undefined ? layer.rotY : (eff.rotY !== undefined ? eff.rotY : 0)
        };
      }
      if (prop === 'scale') {
        const defaultZ = Math.round(Math.min(Math.abs(layer.scaleW || 300), Math.abs(layer.scaleH || 300)));
        return {
          scaleW: layer.scaleW !== undefined ? layer.scaleW : (eff.scaleW !== undefined ? eff.scaleW : (layer.mediaWidth || 500)),
          scaleH: layer.scaleH !== undefined ? layer.scaleH : (eff.scaleH !== undefined ? eff.scaleH : (layer.mediaHeight || 500)),
          scaleZ: layer.scaleZ !== undefined ? layer.scaleZ : (eff.scaleZ !== undefined ? eff.scaleZ : defaultZ)
        };
      }
      if (prop === 'skew') {
        return {
          skewX: layer.skewX !== undefined ? layer.skewX : (eff.skewX !== undefined ? eff.skewX : 0),
          skewY: layer.skewY !== undefined ? layer.skewY : (eff.skewY !== undefined ? eff.skewY : 0)
        };
      }
      if (prop === 'opacity') {
        return {
          opacity: layer.opacity !== undefined ? layer.opacity : (eff.opacity !== undefined ? eff.opacity : 1.0)
        };
      }
      if (prop === 'volume') {
        return {
          volume: layer.volume !== undefined ? layer.volume : (eff.volume !== undefined ? eff.volume : 1.0)
        };
      }
      if (prop === 'speed') {
        return {
          speed: layer.speed !== undefined ? layer.speed : (eff.speed !== undefined ? eff.speed : 1.0)
        };
      }
      if (prop === 'timeRemap') {
        return {
          timeRemap: layer.timeRemap !== undefined ? layer.timeRemap : (eff.timeRemap !== undefined ? eff.timeRemap : 0)
        };
      }
      if (prop.includes(':')) {
        const colonIdx = prop.indexOf(':');
        const fxId = prop.slice(0, colonIdx);
        const pName = prop.slice(colonIdx + 1);
        const fx = Array.isArray(layer.effects) ? layer.effects.find(f => f.id === fxId) : null;
        if (fx && fx[pName] !== undefined) {
          return { [pName]: fx[pName] };
        }
        let effVal = undefined;
        if (eff && Array.isArray(eff.effects)) {
          const effFx = eff.effects.find(f => f.id === fxId);
          if (effFx && effFx[pName] !== undefined) effVal = effFx[pName];
        }
        if (effVal !== undefined) {
          return { [pName]: effVal };
        }
        if (fx && window.FishEffectsRegistry) {
          const def = window.FishEffectsRegistry.get(fx.type);
          if (def && Array.isArray(def.params)) {
            const pDef = def.params.find(p => p.id === pName);
            if (pDef && pDef.default !== undefined) {
              return { [pName]: pDef.default };
            }
          }
        }
        return {
          [pName]: 0
        };
      }
      if (prop === 'brightness') {
        const fallback = (layer.effects && layer.effects[0] && layer.effects[0].brightness !== undefined) ? layer.effects[0].brightness : 0;
        return {
          brightness: layer.brightness !== undefined ? layer.brightness : (eff.brightness !== undefined ? eff.brightness : fallback)
        };
      }
      if (prop === 'contrast') {
        const fallback = (layer.effects && layer.effects[0] && layer.effects[0].contrast !== undefined) ? layer.effects[0].contrast : 0;
        return {
          contrast: layer.contrast !== undefined ? layer.contrast : (eff.contrast !== undefined ? eff.contrast : fallback)
        };
      }
      if (prop === 'cameraLens') {
        return { cameraLens: layer.cameraLens !== undefined ? layer.cameraLens : (eff.cameraLens !== undefined ? eff.cameraLens : 50) };
      }
      if (prop === 'cameraZoom') {
        return { cameraZoom: layer.cameraZoom !== undefined ? layer.cameraZoom : (eff.cameraZoom !== undefined ? eff.cameraZoom : 100) };
      }
      if (prop === 'cameraFocusDistance') {
        return { cameraFocusDistance: layer.cameraFocusDistance !== undefined ? layer.cameraFocusDistance : (eff.cameraFocusDistance !== undefined ? eff.cameraFocusDistance : 0) };
      }
      if (prop === 'cameraBlurNearFar') {
        return { cameraBlurNearFar: layer.cameraBlurNearFar !== undefined ? layer.cameraBlurNearFar : (eff.cameraBlurNearFar !== undefined ? eff.cameraBlurNearFar : 600) };
      }
      if (prop === 'cameraBlurAmount') {
        return { cameraBlurAmount: layer.cameraBlurAmount !== undefined ? layer.cameraBlurAmount : (eff.cameraBlurAmount !== undefined ? eff.cameraBlurAmount : 20) };
      }
      if (prop === 'cameraBlurBalance') {
        return { cameraBlurBalance: layer.cameraBlurBalance !== undefined ? layer.cameraBlurBalance : (eff.cameraBlurBalance !== undefined ? eff.cameraBlurBalance : 0) };
      }
      if (prop === 'vectorPoints') {
        const rawPts = (layer.shapeProps && Array.isArray(layer.shapeProps.points))
          ? layer.shapeProps.points
          : (eff && Array.isArray(eff.vectorPoints) ? eff.vectorPoints : []);
        return {
          vectorPoints: rawPts.map(pt => ({
            x: Number(pt.x) || 0,
            y: Number(pt.y) || 0,
            inX: Number(pt.inX) || 0,
            inY: Number(pt.inY) || 0,
            outX: Number(pt.outX) || 0,
            outY: Number(pt.outY) || 0
          }))
        };
      }
      return {};
    }
    window.getLayerPropertyValue = getLayerPropertyValue;

    // Interpolate between two value objects (supports optional in-place writing to outTarget)
    function interpolatePropertyValues(prop, v0, v1, factor, outTarget = null) {
      if (!v0 || !v1) {
        const fallback = v0 || v1 || {};
        if (outTarget) {
          Object.assign(outTarget, fallback);
          return outTarget;
        }
        return fallback;
      }
      const res = outTarget || {};
      for (const k of Object.keys(v0)) {
        const n0 = v0[k];
        const n1 = (v1[k] !== undefined) ? v1[k] : n0;
        if (typeof n0 === 'number' && typeof n1 === 'number') {
          res[k] = Number((n0 + (n1 - n0) * factor).toFixed(3));
        } else if (k === 'vectorPoints' && Array.isArray(n0) && Array.isArray(n1)) {
          const maxLen = Math.max(n0.length, n1.length);
          const morphed = [];
          for (let i = 0; i < maxLen; i++) {
            const p0 = n0[i] || n0[n0.length - 1] || { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 };
            const p1 = n1[i] || n1[n1.length - 1] || p0;
            morphed.push({
              x: Number(((Number(p0.x) || 0) + ((Number(p1.x) || 0) - (Number(p0.x) || 0)) * factor).toFixed(2)),
              y: Number(((Number(p0.y) || 0) + ((Number(p1.y) || 0) - (Number(p0.y) || 0)) * factor).toFixed(2)),
              inX: Number(((Number(p0.inX) || 0) + ((Number(p1.inX) || 0) - (Number(p0.inX) || 0)) * factor).toFixed(2)),
              inY: Number(((Number(p0.inY) || 0) + ((Number(p1.inY) || 0) - (Number(p0.inY) || 0)) * factor).toFixed(2)),
              outX: Number(((Number(p0.outX) || 0) + ((Number(p1.outX) || 0) - (Number(p0.outX) || 0)) * factor).toFixed(2)),
              outY: Number(((Number(p0.outY) || 0) + ((Number(p1.outY) || 0) - (Number(p0.outY) || 0)) * factor).toFixed(2))
            });
          }
          res[k] = morphed;
        } else {
          res[k] = (factor >= 0.5) ? n1 : n0;
        }
      }
      return res;
    }
    window.interpolatePropertyValues = interpolatePropertyValues;

    // ======================================================================
    // LAYER EXPRESSION EVALUATOR & EFFECT CONTROLLER BINDINGS
    // ======================================================================
    function wrapSelectParamValue(val, pDef) {
      const rawOpts = (pDef && Array.isArray(pDef.options)) ? pDef.options : ['Item 1', 'Item 2', 'Item 3'];
      const opts = rawOpts.map(o => {
        if (typeof o === 'object' && o !== null) {
          return { value: String(o.value !== undefined ? o.value : ''), label: String(o.label || o.value || '') };
        }
        const s = String(o);
        return { value: s, label: s };
      });
      const curStr = String(val !== undefined && val !== null ? val : (opts[0] ? opts[0].value : ''));
      const idx = opts.findIndex(o => o.value.toLowerCase() === curStr.toLowerCase() || o.label.toLowerCase() === curStr.toLowerCase());
      const index1 = (idx >= 0) ? (idx + 1) : 1;
      const matchedOpt = (idx >= 0) ? opts[idx] : opts[0];
      const nameStr = matchedOpt ? matchedOpt.label : curStr;

      const obj = {
        value: index1,
        index: index1,
        name: nameStr,
        valueOf: function() { return index1; },
        toString: function() { return nameStr; }
      };
      if (typeof Symbol !== 'undefined' && Symbol.toPrimitive) {
        obj[Symbol.toPrimitive] = function(hint) {
          return hint === 'string' ? nameStr : index1;
        };
      }
      return obj;
    }

    function createEffectProxy(fx) {
      if (!fx) {
        return createExpressionDummy();
      }
      const isPoint = (fx.type === 'point-control' || fx.id === 'point-control' || (fx.point_x !== undefined && fx.point_y !== undefined));
      const isDropdown = (fx.type === 'dropdown-control' || fx.id === 'dropdown-control' || fx.menu !== undefined);

      const proxyFn = function(paramNameOrIdx) {
        if (isPoint) {
          if (paramNameOrIdx === undefined || paramNameOrIdx === 'point' || paramNameOrIdx === 'Point' || paramNameOrIdx === 'value') {
            return [Number(fx.point_x) || 0, Number(fx.point_y) || 0];
          }
        }
        if (isDropdown) {
          if (paramNameOrIdx === undefined || paramNameOrIdx === 'menu' || paramNameOrIdx === 'Menu' || paramNameOrIdx === 'value' || paramNameOrIdx === 1) {
            const def = window.FishEffectsRegistry ? window.FishEffectsRegistry.get(fx.type || 'dropdown-control') : null;
            const pDef = def && Array.isArray(def.params) ? def.params.find(p => p.id === 'menu') : null;
            return wrapSelectParamValue(fx.menu, pDef);
          }
        }
        if (typeof paramNameOrIdx === 'number') {
          const pIds = (typeof getEffectParamIds === 'function') ? getEffectParamIds(fx) : [];
          const pId = pIds[paramNameOrIdx - 1] || pIds[paramNameOrIdx];
          const def = window.FishEffectsRegistry ? window.FishEffectsRegistry.get(fx.type) : null;
          const pDef = def && Array.isArray(def.params) ? def.params.find(p => p.id === pId) : null;
          if (pDef && pDef.type === 'select') {
            return wrapSelectParamValue(fx[pId], pDef);
          }
          return (pId && fx[pId] !== undefined) ? fx[pId] : (fx.slider !== undefined ? fx.slider : (fx.value !== undefined ? fx.value : 0));
        }
        if (typeof paramNameOrIdx === 'string') {
          const cleanKey = paramNameOrIdx.toLowerCase().replace(/[\s_-]/g, '');
          if (cleanKey.includes('slider') || cleanKey.includes('adbeslidercontrol')) {
            return fx.slider !== undefined ? fx.slider : (fx.value !== undefined ? fx.value : 0);
          }
          if (isDropdown && (cleanKey === 'menu' || cleanKey.includes('dropdown') || cleanKey === 'value')) {
            const def = window.FishEffectsRegistry ? window.FishEffectsRegistry.get(fx.type || 'dropdown-control') : null;
            const pDef = def && Array.isArray(def.params) ? def.params.find(p => p.id === 'menu') : null;
            return wrapSelectParamValue(fx.menu, pDef);
          }
          for (const key of Object.keys(fx)) {
            if (key.toLowerCase().replace(/[\s_-]/g, '') === cleanKey) {
              const def = window.FishEffectsRegistry ? window.FishEffectsRegistry.get(fx.type) : null;
              const pDef = def && Array.isArray(def.params) ? def.params.find(p => p.id === key) : null;
              if (pDef && pDef.type === 'select') {
                return wrapSelectParamValue(fx[key], pDef);
              }
              return fx[key];
            }
          }
          const def = window.FishEffectsRegistry ? window.FishEffectsRegistry.get(fx.type) : null;
          if (def && Array.isArray(def.params)) {
            const pDef = def.params.find(p => (p.label && p.label.toLowerCase().replace(/[\s_-]/g, '') === cleanKey) || p.id.toLowerCase().replace(/[\s_-]/g, '') === cleanKey);
            if (pDef && fx[pDef.id] !== undefined) {
              if (pDef.type === 'select') {
                return wrapSelectParamValue(fx[pDef.id], pDef);
              }
              return fx[pDef.id];
            }
          }
          // Check for coordinate pair (e.g. "Offset" -> [offset_x, offset_y], "Position" -> [posX, posY])
          const pairKeys = [
            [cleanKey + '_x', cleanKey + '_y'],
            [cleanKey + '-x', cleanKey + '-y'],
            [cleanKey + 'x', cleanKey + 'y']
          ];
          for (const [kX, kY] of pairKeys) {
            const foundX = Object.keys(fx).find(k => k.toLowerCase().replace(/[\s_-]/g, '') === kX);
            const foundY = Object.keys(fx).find(k => k.toLowerCase().replace(/[\s_-]/g, '') === kY);
            if (foundX && foundY && fx[foundX] !== undefined && fx[foundY] !== undefined) {
              return [Number(fx[foundX]) || 0, Number(fx[foundY]) || 0];
            }
          }
          if (def && Array.isArray(def.params)) {
            const pX = def.params.find(p => (p.label || p.id).toLowerCase().replace(/\s*([_ -]?[Xx])\b.*$/, '').replace(/[\s_-]/g, '') === cleanKey && (p.id.endsWith('_x') || p.id.endsWith('-x') || (p.id.endsWith('X') && p.id.length > 1)));
            if (pX) {
              const yId = pX.id.endsWith('_x') ? pX.id.slice(0, -2) + '_y' : (pX.id.endsWith('-x') ? pX.id.slice(0, -2) + '-y' : pX.id.slice(0, -1) + 'Y');
              if (fx[pX.id] !== undefined && fx[yId] !== undefined) {
                return [Number(fx[pX.id]) || 0, Number(fx[yId]) || 0];
              }
            }
          }
        }
        const pIds = (typeof getEffectParamIds === 'function') ? getEffectParamIds(fx) : [];
        return (pIds[0] && fx[pIds[0]] !== undefined) ? fx[pIds[0]] : (fx.slider !== undefined ? fx.slider : (fx.value !== undefined ? fx.value : 0));
      };

      Object.keys(fx).forEach(k => {
        proxyFn[k] = fx[k];
        proxyFn[k.toLowerCase()] = fx[k];
      });

      if (isPoint) {
        proxyFn.point = [Number(fx.point_x) || 0, Number(fx.point_y) || 0];
      }

      if (isDropdown) {
        const def = window.FishEffectsRegistry ? window.FishEffectsRegistry.get(fx.type || 'dropdown-control') : null;
        const pDef = def && Array.isArray(def.params) ? def.params.find(p => p.id === 'menu') : null;
        const wrappedMenu = wrapSelectParamValue(fx.menu, pDef);
        proxyFn.menu = wrappedMenu;
        proxyFn.value = wrappedMenu.value;
        proxyFn.name = wrappedMenu.name;
        proxyFn.valueOf = function() { return wrappedMenu.value; };
        proxyFn.toString = function() { return wrappedMenu.name; };
        if (typeof Symbol !== 'undefined' && Symbol.toPrimitive) {
          proxyFn[Symbol.toPrimitive] = function(hint) { return hint === 'string' ? wrappedMenu.name : wrappedMenu.value; };
        }
      } else {
        const pIds = (typeof getEffectParamIds === 'function') ? getEffectParamIds(fx) : [];
        const defaultVal = (pIds[0] && fx[pIds[0]] !== undefined) ? fx[pIds[0]] : (fx.slider !== undefined ? fx.slider : (fx.value !== undefined ? fx.value : 0));
        proxyFn.value = defaultVal;
        proxyFn.slider = fx.slider !== undefined ? fx.slider : defaultVal;
        proxyFn.valueOf = function() { return Number(defaultVal) || 0; };
        proxyFn.toString = function() { return String(defaultVal); };
      }
      return proxyFn;
    }

    function createMarkerObject(markerTimes) {
      const rawList = Array.isArray(markerTimes) ? markerTimes : [];
      const list = rawList.map(m => (typeof m === 'number' ? m : (m && m.time !== undefined ? m.time : 0))).sort((a, b) => a - b);
      return {
        numKeys: list.length,
        key: function(n) {
          const idx = (typeof n === 'number') ? n : 1;
          if (idx < 1 || idx > list.length) {
            return { time: (idx <= 0 ? (list[0] !== undefined ? list[0] : 0) : (list[list.length - 1] !== undefined ? list[list.length - 1] : 0)), index: idx };
          }
          return { time: list[idx - 1], index: idx };
        },
        nearestKey: function(t) {
          if (list.length === 0) return { index: 0, time: 0 };
          let bestIdx = 1;
          let bestDist = Math.abs(t - list[0]);
          for (let i = 1; i < list.length; i++) {
            const dist = Math.abs(t - list[i]);
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = i + 1;
            }
          }
          return { index: bestIdx, time: list[bestIdx - 1] };
        }
      };
    }

    const _compiledExpressionCache = new Map();
    let _cachedCompBeatmarksRef = null;
    let _cachedCompBeatmarksLen = -1;
    let _cachedCompBeatmarksLast = null;
    let _cachedCompMarkerObj = null;
    let _cachedEmptyMarkerObj = null;

    function getCompMarkerObject() {
      const bm = (currentProjectState && Array.isArray(currentProjectState.beatmarks))
        ? currentProjectState.beatmarks
        : (typeof window !== 'undefined' && Array.isArray(window.beatmarks) ? window.beatmarks : []);
      const len = bm.length;
      const lastVal = len > 0 ? bm[len - 1] : null;
      if (_cachedCompMarkerObj && _cachedCompBeatmarksRef === bm && _cachedCompBeatmarksLen === len && _cachedCompBeatmarksLast === lastVal) {
        return _cachedCompMarkerObj;
      }
      _cachedCompBeatmarksRef = bm;
      _cachedCompBeatmarksLen = len;
      _cachedCompBeatmarksLast = lastVal;
      _cachedCompMarkerObj = createMarkerObject(bm);
      return _cachedCompMarkerObj;
    }

    function getLayerMarkerObject(layer) {
      if (!layer) return getCompMarkerObject();
      const markers = layer.markers;
      if (Array.isArray(markers) && markers.length > 0) {
        const len = markers.length;
        const lastVal = markers[len - 1];
        if (layer._cachedMarkerObj && layer._cachedMarkerLen === len && layer._cachedMarkerLast === lastVal) {
          return layer._cachedMarkerObj;
        }
        layer._cachedMarkerLen = len;
        layer._cachedMarkerLast = lastVal;
        layer._cachedMarkerObj = createMarkerObject(markers);
        return layer._cachedMarkerObj;
      }
      return getCompMarkerObject();
    }

    function evaluateLayerExpression(code, prop, baseProps, layer, currentSec, visited = null, layerPool = null) {
      if (!code || typeof code !== 'string') return;
      const trimmed = code.trim();
      if (!trimmed) return;

      const time = currentSec;

      let val;
      if (prop === 'move') {
        val = [baseProps.posX !== undefined ? baseProps.posX : 540, baseProps.posY !== undefined ? baseProps.posY : 960, baseProps.posZ || 0];
      } else if (prop === 'rotate') {
        val = baseProps.rotZ !== undefined ? baseProps.rotZ : (baseProps.rotation || 0);
      } else if (prop === 'scale') {
        val = [baseProps.scaleW !== undefined ? baseProps.scaleW : 500, baseProps.scaleH !== undefined ? baseProps.scaleH : 500];
      } else if (prop === 'skew') {
        val = [baseProps.skewX || 0, baseProps.skewY || 0];
      } else if (prop === 'opacity') {
        val = baseProps.opacity !== undefined ? baseProps.opacity : 1.0;
      } else {
        val = 0;
      }

      function wiggle(freq, amp) {
        const f = Number(freq) || 1;
        const a = Number(amp) || 10;
        const t = time * f;
        const noise1 = Math.sin(t * 6.28318) * 0.7 + Math.sin(t * 11.623) * 0.3;
        const noise2 = Math.cos(t * 6.28318) * 0.7 + Math.sin(t * 14.137) * 0.3;
        if (Array.isArray(val)) {
          return [val[0] + noise1 * a, val[1] + noise2 * a, (val[2] || 0) + (noise1 + noise2) * 0.5 * a];
        }
        return val + noise1 * a;
      }

      function effect(nameOrIndex) {
        const effectsList = (baseProps && Array.isArray(baseProps.effects)) ? baseProps.effects : (layer && Array.isArray(layer.effects) ? layer.effects : []);
        let targetFx = null;
        if (typeof nameOrIndex === 'number') {
          targetFx = effectsList[nameOrIndex - 1] || effectsList[nameOrIndex];
        } else if (typeof nameOrIndex === 'string') {
          const q = nameOrIndex.trim().toLowerCase();
          targetFx = effectsList.find(fx => {
            const n = (fx.name || fx.type || '').toLowerCase();
            const t = (fx.type || '').toLowerCase();
            return n === q || t === q || n.replace(/[\s_-]/g, '') === q.replace(/[\s_-]/g, '');
          });
          if (!targetFx) {
            targetFx = effectsList.find(fx => (fx.name || '').toLowerCase().includes(q) || (fx.type || '').toLowerCase().includes(q));
          }
        }
        if (!targetFx) {
          return createExpressionDummy();
        }
        return createEffectProxy(targetFx);
      }

      function linear(t, tMin, tMax, vMin, vMax) {
        if (t <= tMin) return vMin;
        if (t >= tMax) return vMax;
        const norm = (t - tMin) / (tMax - tMin);
        return vMin + (vMax - vMin) * norm;
      }

      function clamp(v, minVal, maxVal) {
        return Math.max(minVal, Math.min(maxVal, v));
      }

      function addVec(a, b) {
        if (Array.isArray(a) && Array.isArray(b)) {
          return [a[0] + b[0], a[1] + (b[1] !== undefined ? b[1] : b[0]), (a[2] || 0) + (b[2] || 0)];
        }
        if (Array.isArray(a) && typeof b === 'number') {
          return [a[0] + b, a[1] + b, (a[2] || 0) + b];
        }
        if (typeof a === 'number' && Array.isArray(b)) {
          return [a + b[0], a + (b[1] !== undefined ? b[1] : b[0]), a + (b[2] || 0)];
        }
        return a + b;
      }

      const pool = (Array.isArray(layerPool) && layerPool.length > 0) ? layerPool : (currentProjectState.layers || []);
      const layerIdx = pool.findIndex(l => l.id === layer.id);
      const index = (layerIdx >= 0) ? (layerIdx + 1) : 1;

      const pps = window.currentPixelsPerSecond || 80;
      const inPoint = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const durationSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
      const outPoint = Number((inPoint + durationSec).toFixed(4));

      const compMarkerObj = getCompMarkerObject();
      const layerMarkerObj = getLayerMarkerObject(layer);

      const thisLayer = {
        effect,
        width: layer.mediaWidth || layer.widthPx || 1920,
        height: layer.mediaHeight || layer.heightPx || 1080,
        index: index,
        name: layer.name || 'Layer',
        inPoint,
        outPoint,
        marker: layerMarkerObj,
        time
      };

      const thisComp = {
        numLayers: pool.length,
        marker: compMarkerObj,
        layer: function(nameOrIndex) {
          let otherLayer = null;
          if (typeof nameOrIndex === 'number') {
            // In AE, layer indices are 1-based: layer(1) is first layer in pool
            otherLayer = pool[nameOrIndex - 1];
          } else if (typeof nameOrIndex === 'string') {
            const q = nameOrIndex.trim().toLowerCase();
            otherLayer = pool.find(l => (l.name || '').toLowerCase() === q);
          }
          if (!otherLayer) {
            if (!_cachedEmptyMarkerObj) _cachedEmptyMarkerObj = createMarkerObject([]);
            return {
              marker: _cachedEmptyMarkerObj,
              inPoint: 0,
              outPoint: 100,
              effect: () => createEffectProxy(null),
              transform: { position: [0, 0, 0], rotation: 0, scale: [100, 100], opacity: 100 }
            };
          }
          const otherInPoint = otherLayer.startSec !== undefined ? otherLayer.startSec : ((otherLayer.startPx || 0) / pps);
          const otherDur = otherLayer.durationSec !== undefined ? otherLayer.durationSec : ((otherLayer.widthPx || 320) / pps);
          const otherOutPoint = Number((otherInPoint + otherDur).toFixed(4));

          let otherMarkerObj;
          if (otherLayer.type !== 'null' && Array.isArray(otherLayer.markers) && otherLayer.markers.length > 0) {
            otherMarkerObj = getLayerMarkerObject(otherLayer);
          } else {
            if (!_cachedEmptyMarkerObj) _cachedEmptyMarkerObj = createMarkerObject([]);
            otherMarkerObj = _cachedEmptyMarkerObj;
          }

          let _otherEff = null;
          function getOtherEff() {
            if (!_otherEff) {
              _otherEff = (typeof getLayerEffectivePropsAtTime === 'function')
                ? getLayerEffectivePropsAtTime(otherLayer, currentSec, visited, pool)
                : otherLayer;
            }
            return _otherEff;
          }

          return {
            marker: otherMarkerObj,
            inPoint: otherInPoint,
            outPoint: otherOutPoint,
            effect: function(fxName) {
              const eff = getOtherEff();
              const fxList = eff.effects || otherLayer.effects || [];
              let target = null;
              if (typeof fxName === 'number') {
                target = fxList[fxName - 1] || fxList[fxName];
              } else if (typeof fxName === 'string') {
                const q = fxName.trim().toLowerCase();
                target = fxList.find(f => {
                  const n = (f.name || f.type || '').toLowerCase();
                  return n === q || n.replace(/[\s_-]/g, '') === q.replace(/[\s_-]/g, '') || n.includes(q);
                });
              }
              return createEffectProxy(target);
            },
            get transform() {
              const eff = getOtherEff();
              return {
                position: [eff.posX || 0, eff.posY || 0, eff.posZ || 0],
                rotation: eff.rotZ || 0,
                scale: [eff.scaleW || 100, eff.scaleH || 100],
                opacity: (eff.opacity !== undefined ? eff.opacity : 1) * 100
              };
            }
          };
        },
        width: 1920,
        height: 1080,
        frameRate: currentProjectState.fps || 60,
        duration: currentProjectState.durationSec || 5
      };

      let compiledFn = _compiledExpressionCache.get(trimmed);
      if (!compiledFn) {
        let script = trimmed.replace(/\b([a-zA-Z0-9_$]+)\s*\+\s*\[([^\]]+)\]/g, (m, g1, g2) => `addVec(${g1}, [${g2}])`);
        try {
          compiledFn = new Function(
            'time', 'value', 'effect', 'wiggle', 'linear', 'clamp', 'thisLayer', 'thisComp',
            'inPoint', 'outPoint', 'index', 'addVec',
            'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'sqrt', 'PI', 'min', 'max', 'random',
            'return eval(' + JSON.stringify(script) + ');'
          );
        } catch (_) {
          try {
            let fallbackScript = trimmed;
            if (!fallbackScript.includes('return ') && !fallbackScript.includes('return\n')) {
              const lines = fallbackScript.split('\n');
              const lastIdx = lines.length - 1;
              lines[lastIdx] = 'return (' + lines[lastIdx].replace(/;$/, '') + ');';
              fallbackScript = lines.join('\n');
            }
            compiledFn = new Function(
              'time', 'value', 'effect', 'wiggle', 'linear', 'clamp', 'thisLayer', 'thisComp',
              'inPoint', 'outPoint', 'index', 'addVec',
              'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'sqrt', 'PI', 'min', 'max', 'random',
              fallbackScript
            );
          } catch (e) {
            compiledFn = () => undefined;
          }
        }
        if (_compiledExpressionCache.size > 200) {
          _compiledExpressionCache.clear();
        }
        _compiledExpressionCache.set(trimmed, compiledFn);
      }

      let result;
      try {
        result = compiledFn(
          time, val, effect, wiggle, linear, clamp, thisLayer, thisComp,
          inPoint, outPoint, index, addVec,
          Math.sin, Math.cos, Math.tan, Math.abs, Math.floor, Math.ceil, Math.round, Math.sqrt, Math.PI, Math.min, Math.max, Math.random
        );
      } catch (e) {
        return;
      }

      if (result === undefined || result === null || (typeof result === 'number' && isNaN(result))) return;

      if (prop === 'move') {
        if (Array.isArray(result)) {
          if (result[0] !== undefined && !isNaN(result[0])) baseProps.posX = Number(result[0]);
          if (result[1] !== undefined && !isNaN(result[1])) baseProps.posY = Number(result[1]);
          if (result[2] !== undefined && !isNaN(result[2])) baseProps.posZ = Number(result[2]);
        } else if (typeof result === 'object' && result !== null) {
          if (result.x !== undefined && !isNaN(result.x)) baseProps.posX = Number(result.x);
          if (result.y !== undefined && !isNaN(result.y)) baseProps.posY = Number(result.y);
          if (result.z !== undefined && !isNaN(result.z)) baseProps.posZ = Number(result.z);
        } else if (typeof result === 'number' && !isNaN(result)) {
          baseProps.posX = result;
        }
      } else if (prop === 'rotate') {
        const r = Number(Array.isArray(result) ? result[0] : result);
        if (!isNaN(r)) {
          baseProps.rotZ = r;
          baseProps.rotation = r;
        }
      } else if (prop === 'scale') {
        if (Array.isArray(result)) {
          if (result[0] !== undefined && !isNaN(result[0])) baseProps.scaleW = Number(result[0]);
          if (result[1] !== undefined && !isNaN(result[1])) baseProps.scaleH = Number(result[1]);
        } else if (typeof result === 'number' && !isNaN(result)) {
          baseProps.scaleW = result;
          baseProps.scaleH = result;
        }
      } else if (prop === 'skew') {
        if (Array.isArray(result)) {
          if (result[0] !== undefined && !isNaN(result[0])) baseProps.skewX = Number(result[0]);
          if (result[1] !== undefined && !isNaN(result[1])) baseProps.skewY = Number(result[1]);
        }
      } else if (prop === 'opacity') {
        const op = Number(result);
        if (!isNaN(op)) {
          baseProps.opacity = (op > 1.0) ? (op / 100) : Math.max(0, Math.min(1, op));
        }
      }
    }
    window.evaluateLayerExpression = evaluateLayerExpression;

    function evaluateEffectParamExpression(code, paramId, fxEff, paramDef, baseProps, layer, currentSec, visited = null, layerPool = null) {
      if (!code || typeof code !== 'string') return;
      const trimmed = code.trim();
      if (!trimmed) return;

      const time = currentSec;
      const type = paramDef ? (paramDef.type || 'number') : 'number';

      // Determine initial value & coordinate pair context
      let val;
      let partnerId = null;
      let isYComponent = false;
      if (paramId.endsWith('_x')) partnerId = paramId.slice(0, -2) + '_y';
      else if (paramId.endsWith('-x')) partnerId = paramId.slice(0, -2) + '-y';
      else if (paramId.endsWith('X') && paramId.length > 1) partnerId = paramId.slice(0, -1) + 'Y';
      else if (paramId.endsWith('_y')) { partnerId = paramId.slice(0, -2) + '_x'; isYComponent = true; }
      else if (paramId.endsWith('-y')) { partnerId = paramId.slice(0, -2) + '-x'; isYComponent = true; }
      else if (paramId.endsWith('Y') && paramId.length > 1) { partnerId = paramId.slice(0, -1) + 'X'; isYComponent = true; }

      if (type === 'color') {
        const rawColor = String(fxEff[paramId] || (paramDef && paramDef.default) || '#ffffff').trim();
        let hex = rawColor.startsWith('#') ? rawColor : ('#' + rawColor);
        if (hex.length === 4) {
          hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        let r = 255, g = 255, b = 255, a = 1.0;
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
          r = parseInt(hex.slice(1, 3), 16);
          g = parseInt(hex.slice(3, 5), 16);
          b = parseInt(hex.slice(5, 7), 16);
        }
        val = [Number((r / 255).toFixed(4)), Number((g / 255).toFixed(4)), Number((b / 255).toFixed(4)), a];
        val.hex = hex;
        val.valueOf = () => hex;
        val.toString = () => hex;
      } else if (type === 'select') {
        val = wrapSelectParamValue(fxEff[paramId], paramDef);
      } else if (type === 'switch' || type === 'boolean') {
        const raw = fxEff[paramId];
        val = (raw === 1 || raw === true || raw === '1' || raw === 'true' || raw === 'on') ? 1 : 0;
      } else if (partnerId && fxEff[partnerId] !== undefined) {
        val = isYComponent
          ? [Number(fxEff[partnerId]) || 0, Number(fxEff[paramId]) || 0]
          : [Number(fxEff[paramId]) || 0, Number(fxEff[partnerId]) || 0];
        val.valueOf = () => Number(fxEff[paramId]) || 0;
      } else {
        val = Number(fxEff[paramId]) || 0;
      }

      function wiggle(freq, amp) {
        const f = Number(freq) || 1;
        const a = Number(amp) || 10;
        const t = time * f;
        const noise1 = Math.sin(t * 6.28318) * 0.7 + Math.sin(t * 11.623) * 0.3;
        const noise2 = Math.cos(t * 6.28318) * 0.7 + Math.sin(t * 14.137) * 0.3;
        const noise3 = Math.sin(t * 8.412) * 0.7 + Math.cos(t * 13.2) * 0.3;
        if (type === 'color' && Array.isArray(val)) {
          const factor = a / 100;
          return [
            Math.max(0, Math.min(1, val[0] + noise1 * factor)),
            Math.max(0, Math.min(1, val[1] + noise2 * factor)),
            Math.max(0, Math.min(1, val[2] + noise3 * factor)),
            val[3] !== undefined ? val[3] : 1
          ];
        }
        if (Array.isArray(val)) {
          return [val[0] + noise1 * a, val[1] + noise2 * a];
        }
        return val + noise1 * a;
      }

      function effect(nameOrIndex) {
        const effectsList = (baseProps && Array.isArray(baseProps.effects)) ? baseProps.effects : (layer && Array.isArray(layer.effects) ? layer.effects : []);
        let targetFx = null;
        if (typeof nameOrIndex === 'number') {
          targetFx = effectsList[nameOrIndex - 1] || effectsList[nameOrIndex];
        } else if (typeof nameOrIndex === 'string') {
          const q = nameOrIndex.trim().toLowerCase();
          targetFx = effectsList.find(fx => {
            const n = (fx.name || fx.type || '').toLowerCase();
            const t = (fx.type || '').toLowerCase();
            return n === q || t === q || n.replace(/[\s_-]/g, '') === q.replace(/[\s_-]/g, '');
          });
          if (!targetFx) {
            targetFx = effectsList.find(fx => (fx.name || '').toLowerCase().includes(q) || (fx.type || '').toLowerCase().includes(q));
          }
        }
        if (!targetFx) {
          return createExpressionDummy();
        }
        return createEffectProxy(targetFx);
      }

      function linear(t, tMin, tMax, vMin, vMax) {
        if (t <= tMin) return vMin;
        if (t >= tMax) return vMax;
        const norm = (t - tMin) / (tMax - tMin);
        if (Array.isArray(vMin) && Array.isArray(vMax)) {
          return vMin.map((vm, idx) => vm + ((vMax[idx] !== undefined ? vMax[idx] : vm) - vm) * norm);
        }
        return vMin + (vMax - vMin) * norm;
      }

      function clamp(v, minVal, maxVal) {
        return Math.max(minVal, Math.min(maxVal, v));
      }

      function addVec(a, b) {
        if (Array.isArray(a) && Array.isArray(b)) {
          return [a[0] + b[0], a[1] + (b[1] !== undefined ? b[1] : b[0]), (a[2] || 0) + (b[2] || 0)];
        }
        if (Array.isArray(a) && typeof b === 'number') {
          return [a[0] + b, a[1] + b, (a[2] || 0) + b];
        }
        if (typeof a === 'number' && Array.isArray(b)) {
          return [a + b[0], a + (b[1] !== undefined ? b[1] : b[0]), a + (b[2] || 0)];
        }
        return a + b;
      }

      const pool = (Array.isArray(layerPool) && layerPool.length > 0) ? layerPool : (currentProjectState.layers || []);
      const layerIdx = pool.findIndex(l => l.id === layer.id);
      const index = (layerIdx >= 0) ? (layerIdx + 1) : 1;
      const pps = window.currentPixelsPerSecond || 80;
      const inPoint = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const durationSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
      const outPoint = Number((inPoint + durationSec).toFixed(4));
      const compMarkerObj = getCompMarkerObject();
      const layerMarkerObj = getLayerMarkerObject(layer);

      const thisLayer = {
        effect,
        width: layer.mediaWidth || layer.widthPx || 1920,
        height: layer.mediaHeight || layer.heightPx || 1080,
        index: index,
        name: layer.name || 'Layer',
        inPoint,
        outPoint,
        marker: layerMarkerObj,
        time
      };

      const thisComp = {
        numLayers: pool.length,
        marker: compMarkerObj,
        layer: function(nameOrIndex) {
          let otherLayer = null;
          if (typeof nameOrIndex === 'number') {
            otherLayer = pool[nameOrIndex - 1];
          } else if (typeof nameOrIndex === 'string') {
            const q = nameOrIndex.trim().toLowerCase();
            otherLayer = pool.find(l => (l.name || '').toLowerCase() === q);
          }
          if (!otherLayer) {
            if (!_cachedEmptyMarkerObj) _cachedEmptyMarkerObj = createMarkerObject([]);
            return {
              marker: _cachedEmptyMarkerObj,
              inPoint: 0,
              outPoint: 100,
              effect: () => createEffectProxy(null),
              transform: { position: [0, 0, 0], rotation: 0, scale: [100, 100], opacity: 100 }
            };
          }
          const otherInPoint = otherLayer.startSec !== undefined ? otherLayer.startSec : ((otherLayer.startPx || 0) / pps);
          const otherDur = otherLayer.durationSec !== undefined ? otherLayer.durationSec : ((otherLayer.widthPx || 320) / pps);
          const otherOutPoint = Number((otherInPoint + otherDur).toFixed(4));
          const otherMarkerObj = (otherLayer.type !== 'null' && Array.isArray(otherLayer.markers) && otherLayer.markers.length > 0)
            ? getLayerMarkerObject(otherLayer)
            : (_cachedEmptyMarkerObj || (_cachedEmptyMarkerObj = createMarkerObject([])));

          let _otherEff = null;
          function getOtherEff() {
            if (!_otherEff) {
              _otherEff = (typeof getLayerEffectivePropsAtTime === 'function')
                ? getLayerEffectivePropsAtTime(otherLayer, currentSec, visited, pool)
                : otherLayer;
            }
            return _otherEff;
          }

          return {
            marker: otherMarkerObj,
            inPoint: otherInPoint,
            outPoint: otherOutPoint,
            effect: function(fxName) {
              const eff = getOtherEff();
              const fxList = eff.effects || otherLayer.effects || [];
              let target = null;
              if (typeof fxName === 'number') {
                target = fxList[fxName - 1] || fxList[fxName];
              } else if (typeof fxName === 'string') {
                const q = fxName.trim().toLowerCase();
                target = fxList.find(f => {
                  const n = (f.name || f.type || '').toLowerCase();
                  return n === q || n.replace(/[\s_-]/g, '') === q.replace(/[\s_-]/g, '') || n.includes(q);
                });
              }
              return createEffectProxy(target);
            },
            get transform() {
              const eff = getOtherEff();
              return {
                position: [eff.posX || 0, eff.posY || 0, eff.posZ || 0],
                rotation: eff.rotZ || 0,
                scale: [eff.scaleW || 100, eff.scaleH || 100],
                opacity: (eff.opacity !== undefined ? eff.opacity : 1) * 100
              };
            }
          };
        },
        width: 1920,
        height: 1080,
        frameRate: currentProjectState.fps || 60,
        duration: currentProjectState.durationSec || 5
      };

      let compiledFn = _compiledExpressionCache.get(trimmed);
      if (!compiledFn) {
        let script = trimmed.replace(/\b([a-zA-Z0-9_$]+)\s*\+\s*\[([^\]]+)\]/g, (m, g1, g2) => `addVec(${g1}, [${g2}])`);
        try {
          compiledFn = new Function(
            'time', 'value', 'effect', 'wiggle', 'linear', 'clamp', 'thisLayer', 'thisComp',
            'inPoint', 'outPoint', 'index', 'addVec',
            'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'sqrt', 'PI', 'min', 'max', 'random',
            'return eval(' + JSON.stringify(script) + ');'
          );
        } catch (_) {
          try {
            let fallbackScript = trimmed;
            if (!fallbackScript.includes('return ') && !fallbackScript.includes('return\n')) {
              const lines = fallbackScript.split('\n');
              const lastIdx = lines.length - 1;
              lines[lastIdx] = 'return (' + lines[lastIdx].replace(/;$/, '') + ');';
              fallbackScript = lines.join('\n');
            }
            compiledFn = new Function(
              'time', 'value', 'effect', 'wiggle', 'linear', 'clamp', 'thisLayer', 'thisComp',
              'inPoint', 'outPoint', 'index', 'addVec',
              'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'sqrt', 'PI', 'min', 'max', 'random',
              fallbackScript
            );
          } catch (e) {
            compiledFn = () => undefined;
          }
        }
        if (_compiledExpressionCache.size > 200) {
          _compiledExpressionCache.clear();
        }
        _compiledExpressionCache.set(trimmed, compiledFn);
      }

      let result;
      try {
        result = compiledFn(
          time, val, effect, wiggle, linear, clamp, thisLayer, thisComp,
          inPoint, outPoint, index, addVec,
          Math.sin, Math.cos, Math.tan, Math.abs, Math.floor, Math.ceil, Math.round, Math.sqrt, Math.PI, Math.min, Math.max, Math.random
        );
      } catch (e) {
        return;
      }

      if (result === undefined || result === null || (typeof result === 'number' && isNaN(result))) return;

      // Coerce result according to parameter type
      if (type === 'color') {
        if (typeof result === 'string') {
          let s = result.trim();
          if (s.startsWith('rgb')) {
            const m = s.match(/\d+/g);
            if (m && m.length >= 3) {
              const rHex = Math.max(0, Math.min(255, parseInt(m[0], 10))).toString(16).padStart(2, '0');
              const gHex = Math.max(0, Math.min(255, parseInt(m[1], 10))).toString(16).padStart(2, '0');
              const bHex = Math.max(0, Math.min(255, parseInt(m[2], 10))).toString(16).padStart(2, '0');
              fxEff[paramId] = '#' + rHex + gHex + bHex;
              return;
            }
          }
          if (!s.startsWith('#')) s = '#' + s;
          if (/^#[0-9a-fA-F]{3,8}$/.test(s)) {
            if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
            fxEff[paramId] = s.slice(0, 7);
          }
        } else if (Array.isArray(result)) {
          const rRaw = Number(result[0]) || 0;
          const gRaw = Number(result[1]) || 0;
          const bRaw = Number(result[2]) || 0;
          const isNorm = (rRaw <= 1.0 && gRaw <= 1.0 && bRaw <= 1.0 && rRaw >= 0 && gRaw >= 0 && bRaw >= 0);
          const r = Math.max(0, Math.min(255, Math.round(isNorm ? rRaw * 255 : rRaw)));
          const g = Math.max(0, Math.min(255, Math.round(isNorm ? gRaw * 255 : gRaw)));
          const b = Math.max(0, Math.min(255, Math.round(isNorm ? bRaw * 255 : bRaw)));
          fxEff[paramId] = '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
        }
      } else if (type === 'select') {
        const rawOpts = (paramDef && Array.isArray(paramDef.options)) ? paramDef.options : [];
        const opts = rawOpts.map(o => {
          if (typeof o === 'object' && o !== null) {
            return { value: String(o.value !== undefined ? o.value : ''), label: String(o.label || o.value || '') };
          }
          const str = String(o);
          return { value: str, label: str };
        });
        if (typeof result === 'number') {
          const idx = Math.round(result) - 1; // 1-based index (AE)
          const targetOpt = (idx >= 0 && idx < opts.length) ? opts[idx] : (opts[Math.round(result)] || opts[0]);
          if (targetOpt) fxEff[paramId] = targetOpt.value;
        } else if (typeof result === 'string') {
          const q = result.trim().toLowerCase();
          const targetOpt = opts.find(o => o.value.toLowerCase() === q || o.label.toLowerCase() === q);
          if (targetOpt) {
            fxEff[paramId] = targetOpt.value;
          } else {
            fxEff[paramId] = result;
          }
        } else if (typeof result === 'object' && result !== null) {
          if (result.name !== undefined) fxEff[paramId] = String(result.name);
          else if (result.value !== undefined) {
            if (typeof result.value === 'number') {
              const idx = Math.round(result.value) - 1;
              const targetOpt = (idx >= 0 && idx < opts.length) ? opts[idx] : opts[0];
              if (targetOpt) fxEff[paramId] = targetOpt.value;
            } else {
              fxEff[paramId] = String(result.value);
            }
          }
        }
      } else if (type === 'switch' || type === 'boolean') {
        const truthy = (result === true || result === 1 || result === '1' || result === 'true' || result === 'on');
        fxEff[paramId] = truthy ? 1 : 0;
      } else if (partnerId && fxEff[partnerId] !== undefined) {
        if (Array.isArray(result)) {
          const xVal = Number(result[0]);
          const yVal = Number(result[1]);
          if (!isNaN(xVal)) fxEff[isYComponent ? partnerId : paramId] = xVal;
          if (!isNaN(yVal)) fxEff[isYComponent ? paramId : partnerId] = yVal;
        } else if (typeof result === 'object' && result !== null) {
          const xVal = result.x !== undefined ? Number(result.x) : (result[0] !== undefined ? Number(result[0]) : NaN);
          const yVal = result.y !== undefined ? Number(result.y) : (result[1] !== undefined ? Number(result[1]) : NaN);
          if (!isNaN(xVal)) fxEff[isYComponent ? partnerId : paramId] = xVal;
          if (!isNaN(yVal)) fxEff[isYComponent ? paramId : partnerId] = yVal;
        } else if (typeof result === 'number' && !isNaN(result)) {
          fxEff[paramId] = result;
        }
      } else {
        let num = Number(Array.isArray(result) ? result[0] : result);
        if (!isNaN(num)) {
          if (paramDef && paramDef.min !== undefined && paramDef.max !== undefined) {
            num = Math.max(paramDef.min, Math.min(paramDef.max, num));
          }
          fxEff[paramId] = num;
        }
      }
    }
    window.evaluateEffectParamExpression = evaluateEffectParamExpression;

    const _effectivePropsCache = new Map();

    function invalidateEffectivePropsCache(targetLayerId = null) {
      if (!targetLayerId) {
        _effectivePropsCache.clear();
        return;
      }
      const prefix = String(targetLayerId) + ':';
      for (const k of _effectivePropsCache.keys()) {
        if (k.startsWith(prefix)) {
          _effectivePropsCache.delete(k);
        }
      }
    }
    window.invalidateEffectivePropsCache = invalidateEffectivePropsCache;

    // Get effective animated properties of layer at given time (with hierarchical parenting)
    function getLayerEffectivePropsAtTime(layer, currentSec, visited = null, layerPool = null, skipParenting = false) {
      if (!layer) return {};
      if (visited && visited.has(layer.id)) return {};

      const cacheKey = layer.id + ':' + currentSec + ':' + (skipParenting ? '1' : '0');
      const cached = _effectivePropsCache.get(cacheKey);
      if (cached) {
        return Object.assign({}, cached);
      }

      if (!visited) visited = new Set();
      visited.add(layer.id);

      const baseProps = {
        _currentSec: currentSec,
        _timeInClip: Math.max(0, currentSec - (layer.startSec !== undefined ? layer.startSec : 0)),
        is3D: !!layer.is3D,
        posX: layer.posX !== undefined ? layer.posX : 540,
        posY: layer.posY !== undefined ? layer.posY : 960,
        posZ: layer.posZ !== undefined ? layer.posZ : 0,
        anchorX: layer.anchorX || 0,
        anchorY: layer.anchorY || 0,
        anchorZ: layer.anchorZ || 0,
        rotZ: layer.rotZ !== undefined ? layer.rotZ : (layer.rotation || 0),
        rotX: layer.rotX || 0,
        rotY: layer.rotY || 0,
        rotation: layer.rotZ !== undefined ? layer.rotZ : (layer.rotation || 0),
        scaleW: layer.scaleW !== undefined ? layer.scaleW : 500,
        scaleH: layer.scaleH !== undefined ? layer.scaleH : 500,
        scaleZ: layer.scaleZ !== undefined ? layer.scaleZ : Math.round(Math.min(Math.abs(layer.scaleW || 300), Math.abs(layer.scaleH || 300))),
        skewX: layer.skewX || 0,
        skewY: layer.skewY || 0,
        opacity: (layer.opacity !== undefined && layer.opacity !== null) ? (Number(layer.opacity) > 1.0 ? Math.max(0, Math.min(1, Number(layer.opacity) / 100)) : Math.max(0, Math.min(1, Number(layer.opacity)))) : 1.0,
        volume: layer.volume !== undefined ? layer.volume : 1.0,
        speed: layer.speed !== undefined ? layer.speed : 1.0,
        timeRemap: layer.timeRemap !== undefined ? layer.timeRemap : 0,
        cameraLens: layer.cameraLens !== undefined ? layer.cameraLens : (layer.cameraLensPreset === 'wide' ? 24 : (layer.cameraLensPreset === 'tele' ? 85 : 50)),
        cameraZoom: layer.cameraZoom !== undefined ? layer.cameraZoom : 100,
        cameraBlurEnabled: layer.cameraBlurEnabled !== undefined ? layer.cameraBlurEnabled : false,
        cameraFocusMode: layer.cameraFocusMode || 'manual',
        cameraFocusTargetLayerId: layer.cameraFocusTargetLayerId || null,
        cameraFocusDistance: layer.cameraFocusDistance !== undefined ? layer.cameraFocusDistance : 0,
        cameraBlurNearFar: layer.cameraBlurNearFar !== undefined ? layer.cameraBlurNearFar : 600,
        cameraBlurAmount: layer.cameraBlurAmount !== undefined ? layer.cameraBlurAmount : 20,
        cameraBlurBalance: layer.cameraBlurBalance !== undefined ? layer.cameraBlurBalance : 0,
        cameraLensPreset: layer.cameraLensPreset || 'standard',
        brightness: layer.brightness !== undefined ? layer.brightness : (layer.effects && layer.effects[0] && layer.effects[0].brightness !== undefined ? layer.effects[0].brightness : 0),
        contrast: layer.contrast !== undefined ? layer.contrast : (layer.effects && layer.effects[0] && layer.effects[0].contrast !== undefined ? layer.effects[0].contrast : 0)
      };

      if (Array.isArray(layer.effects)) {
        baseProps.effects = layer.effects.map(fx => Object.assign({}, fx));
      }

      if (layer.keyframes) {
        const propKeys = ['move', 'rotate', 'scale', 'skew', 'opacity', 'volume', 'speed', 'timeRemap', 'cameraLens', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurNearFar', 'cameraBlurAmount', 'cameraBlurBalance', 'vectorPoints'];
        for (const prop of propKeys) {
          const list = layer.keyframes[prop];
          if (!list || list.length === 0) continue;

          // Sort ascending by time (cached via _isSorted)
          if (!list._isSorted) {
            list.sort((a, b) => a.time - b.time);
            list._isSorted = true;
          }

          // Overlap Camera & Overlap Null: Additive blended motion intervals with Bezier curves from Graph Panel
          // During keyframe drag, bypass leapfrog → use normal interpolation so preview snaps to destination keyframe value.
          if ((layer.isOverlapCamera || layer.isOverlapNull) && list.length >= 2 && !window.isTransformInteracting) {
            const M = list.length - 1;
            const t0 = list[0].time;
            const tM = list[M].time;

            if (currentSec <= t0) {
              Object.assign(baseProps, list[0].value);
              if (prop === 'rotate') {
                if (list[0].value.rotZ !== undefined) {
                  baseProps.rotZ = list[0].value.rotZ;
                  baseProps.rotation = list[0].value.rotZ;
                } else if (list[0].value.rotation !== undefined) {
                  baseProps.rotZ = list[0].value.rotation;
                  baseProps.rotation = list[0].value.rotation;
                }
              }
              continue;
            }

            // OpenFishTools Lite Authentic Leapfrog Overlap:
            // Each transition i (Ki -> Ki+1) spans from list[i].time all the way to list[i+2].time
            // (or Ki+1 + duration for the final transition), allowing keyframes to leapfrog and overlap concurrently!
            const lastIntervalDur = Math.max(0.001, list[M].time - list[M - 1].time);
            const tEndFinal = list[M].time + lastIntervalDur;

            if (currentSec >= tEndFinal) {
              Object.assign(baseProps, list[M].value);
              if (prop === 'rotate') {
                if (list[M].value.rotZ !== undefined) {
                  baseProps.rotZ = list[M].value.rotZ;
                  baseProps.rotation = list[M].value.rotZ;
                } else if (list[M].value.rotation !== undefined) {
                  baseProps.rotZ = list[M].value.rotation;
                  baseProps.rotation = list[M].value.rotation;
                }
              }
              continue;
            }

            // Leapfrog Overlap: Start from K0, each transition i contributes RELATIVE delta
            // finalValue = K0 + Σ (K_{i+1} - K_i) * progress_i
            // This mirrors the null-rig architecture in applyKeyframeOverlap (_OVERLAP from JSX).
            // Each transition owns its own delta (relative motion), summed additively on top of K0.
            const initialVal = list[0].value || {};
            const accumulated = Object.assign({}, initialVal);

            for (let i = 0; i < M; i++) {
              const kStart = list[i];
              const kEnd = list[i + 1];

              const tStart = kStart.time;
              const tEnd = (i + 2 < list.length)
                ? list[i + 2].time
                : kEnd.time + (kEnd.time - kStart.time);

              const transitionDuration = Math.max(0.001, tEnd - tStart);
              const ratio = (transitionDuration > 0) ? (kEnd.time - tStart) / transitionDuration : 0.5;
              const baseInfluence = 0.85;
              const influenceOut = Math.max(0.33, Math.min(1.0, ratio * 2 * baseInfluence));
              const influenceIn = Math.max(0.33, Math.min(1.0, (1 - ratio) * 2 * baseInfluence));
              const defaultLeapfrogEasing = [
                Number(influenceOut.toFixed(3)),
                0.0,
                Number((1.0 - influenceIn).toFixed(3)),
                1.0
              ];

              const easing = (kStart && Array.isArray(kStart.easing) && kStart.easing.length === 4)
                ? kStart.easing
                : (layer._defaultEasing && layer._defaultEasing[prop] ? layer._defaultEasing[prop] : defaultLeapfrogEasing);
              const easingSource = (kStart && kStart.easingConfig)
                ? kStart
                : ((layer._defaultEasingConfig && layer._defaultEasingConfig[prop]) ? layer._defaultEasingConfig[prop] : easing);

              let u = 0;
              if (currentSec <= tStart) u = 0;
              else if (currentSec >= tEnd) u = 1;
              else u = (currentSec - tStart) / transitionDuration;

              if (u <= 0) continue;
              const progress = (u >= 1) ? 1.0 : evaluateKeyframeEasing(easingSource, u, easing);

              // Relative delta: only the CHANGE from Ki to Ki+1, applied additively
              const v0 = kStart.value || {};
              const v1 = kEnd.value || {};
              const allKeys = new Set([...Object.keys(v0), ...Object.keys(v1)]);
              for (const k of allKeys) {
                const n0 = (typeof v0[k] === 'number') ? v0[k] : ((typeof v1[k] === 'number') ? v1[k] : 0);
                const n1 = (typeof v1[k] === 'number') ? v1[k] : n0;
                if (typeof n0 === 'number' && typeof n1 === 'number') {
                  // Relative delta = (K_{i+1} - K_i) * progress — add to accumulated (starts at K0)
                  const relativeDelta = (n1 - n0) * progress;
                  accumulated[k] = (typeof accumulated[k] === 'number' ? accumulated[k] : n0) + relativeDelta;
                } else if (progress >= 0.5 && v1[k] !== undefined) {
                  accumulated[k] = v1[k];
                }
              }
            }

            Object.assign(baseProps, accumulated);
            if (prop === 'rotate') {
              if (accumulated.rotZ !== undefined) {
                baseProps.rotZ = accumulated.rotZ;
                baseProps.rotation = accumulated.rotZ;
              } else if (accumulated.rotation !== undefined) {
                baseProps.rotZ = accumulated.rotation;
                baseProps.rotation = accumulated.rotation;
              }
            }
            continue;
          }

          if (currentSec <= list[0].time) {
            Object.assign(baseProps, list[0].value);
            if (prop === 'rotate' && list[0].value.rotZ !== undefined) {
              baseProps.rotation = list[0].value.rotZ;
            }
            continue;
          }

          const lastKf = list[list.length - 1];
          if (currentSec >= lastKf.time) {
            Object.assign(baseProps, lastKf.value);
            if (prop === 'rotate' && lastKf.value.rotZ !== undefined) {
              baseProps.rotation = lastKf.value.rotZ;
            }
            continue;
          }

          // Find surrounding keyframes
          for (let i = 0; i < list.length - 1; i++) {
            const k0 = list[i];
            const k1 = list[i + 1];
            if (currentSec >= k0.time && currentSec <= k1.time) {
              const span = k1.time - k0.time;
              const tNorm = span > 0 ? ((currentSec - k0.time) / span) : 0;
              const easing = k0.easing || [0.0, 0.0, 1.0, 1.0];
              const easedFactor = evaluateKeyframeEasing(k0, tNorm, easing);
              const interpolated = interpolatePropertyValues(prop, k0.value, k1.value, easedFactor, baseProps);
              if (prop === 'rotate' && interpolated.rotZ !== undefined) {
                baseProps.rotation = interpolated.rotZ;
              }
              break;
            }
          }
        }

        // Animate each effect instance independently
        if (Array.isArray(baseProps.effects)) {
          baseProps.effects.forEach((fxEff, idx) => {
            getEffectParamIds(fxEff).forEach(pId => {
              const scopedKey = `${fxEff.id}:${pId}`;
              if (window.activeScrubbingParam === scopedKey) {
                const liveFx = layer.effects && layer.effects.find(f => f && f.id === fxEff.id);
                if (liveFx && liveFx[pId] !== undefined) {
                  fxEff[pId] = liveFx[pId];
                  return;
                }
              }
              const builtInProps = ['move', 'scale', 'rotate', 'rotation', 'opacity', 'volume', 'origin', 'skew', 'speed', 'timeRemap', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurAmount'];
              const list = layer.keyframes[scopedKey] || (idx === 0 && !builtInProps.includes(pId) && layer.keyframes[pId] ? layer.keyframes[pId] : null);
              if (!list || list.length === 0) return;

              if (!list._isSorted) {
                list.sort((a, b) => a.time - b.time);
                list._isSorted = true;
              }
              if (currentSec <= list[0].time) {
                if (list[0].value && list[0].value[pId] !== undefined) {
                  fxEff[pId] = list[0].value[pId];
                }
                return;
              }
              const lastKf = list[list.length - 1];
              if (currentSec >= lastKf.time) {
                if (lastKf.value && lastKf.value[pId] !== undefined) {
                  fxEff[pId] = lastKf.value[pId];
                }
                return;
              }
              for (let i = 0; i < list.length - 1; i++) {
                const k0 = list[i];
                const k1 = list[i + 1];
                if (currentSec >= k0.time && currentSec <= k1.time) {
                  const span = k1.time - k0.time;
                  const tNorm = span > 0 ? ((currentSec - k0.time) / span) : 0;
                  const easing = k0.easing || [0.0, 0.0, 1.0, 1.0];
                  const easedFactor = evaluateKeyframeEasing(k0, tNorm, easing);
                  const interpolated = interpolatePropertyValues(pId, k0.value, k1.value, easedFactor);
                  if (interpolated && interpolated[pId] !== undefined) {
                    fxEff[pId] = interpolated[pId];
                  }
                  break;
                }
              }
            });
          });

          if (baseProps.effects[0]) {
            if (baseProps.effects[0].brightness !== undefined) baseProps.brightness = baseProps.effects[0].brightness;
            if (baseProps.effects[0].contrast !== undefined) baseProps.contrast = baseProps.effects[0].contrast;
          }
        }
      }

      // Apply expressions on effect parameters (overriding keyframes / manual values)
      if (Array.isArray(baseProps.effects) && layer.expressions && typeof layer.expressions === 'object') {
        const poolRef = (Array.isArray(layerPool) && layerPool.length > 0) ? layerPool : (currentProjectState.layers || []);
        baseProps.effects.forEach((fxEff, idx) => {
          const pIds = (typeof getEffectParamIds === 'function') ? getEffectParamIds(fxEff) : Object.keys(fxEff);
          const def = (window.FishEffectsRegistry && typeof window.FishEffectsRegistry.get === 'function') ? window.FishEffectsRegistry.get(fxEff.type) : null;
          pIds.forEach(pId => {
            const scopedKey = `${fxEff.id}:${pId}`;
            const builtInProps = ['move', 'scale', 'rotate', 'rotation', 'opacity', 'volume', 'origin', 'skew', 'speed', 'timeRemap', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurAmount'];
            const code = layer.expressions[scopedKey] || (idx === 0 && !builtInProps.includes(pId) && layer.expressions[pId] ? layer.expressions[pId] : null);
            if (code && typeof code === 'string' && code.trim().length > 0) {
              try {
                const pDef = def && Array.isArray(def.params) ? def.params.find(p => p.id === pId) : null;
                evaluateEffectParamExpression(code, pId, fxEff, pDef, baseProps, layer, currentSec, visited, poolRef);
              } catch (_) {}
            }
          });
        });

        if (baseProps.effects[0]) {
          if (baseProps.effects[0].brightness !== undefined) baseProps.brightness = baseProps.effects[0].brightness;
          if (baseProps.effects[0].contrast !== undefined) baseProps.contrast = baseProps.effects[0].contrast;
        }
      }

      const pool = (Array.isArray(layerPool) && layerPool.length > 0) ? layerPool : (currentProjectState.layers || []);

      // Apply expressions on layer properties (overriding keyframes / manual values)
      if (layer.expressions && typeof layer.expressions === 'object') {
        const propMappings = [
          { target: 'move', keys: ['move', 'position', 'pos', 'adbe position', 'adbeposition'] },
          { target: 'rotate', keys: ['rotate', 'rotation', 'rotz', 'adbe rotate z', 'adberotatez'] },
          { target: 'scale', keys: ['scale', 'adbe scale', 'adbescale'] },
          { target: 'skew', keys: ['skew'] },
          { target: 'opacity', keys: ['opacity', 'adbe opacity', 'adbeopacity'] }
        ];
        for (const mapping of propMappings) {
          let code = null;
          for (const k of mapping.keys) {
            const raw = layer.expressions[k];
            if (raw && typeof raw === 'string' && raw.trim().length > 0) {
              code = raw;
              break;
            }
          }
          if (code) {
            try {
              evaluateLayerExpression(code, mapping.target, baseProps, layer, currentSec, visited, pool);
            } catch (err) {
              // Silently catch frame evaluation errors
            }
          }
        }
      }

      // Hierarchical Transform Parenting: recursively resolve parent movement, 3D rotation, scale, posZ
      if (layer.parentId && !skipParenting) {
        const parent = pool.find(l => l.id === layer.parentId);
        if (parent && !visited.has(parent.id)) {
          const parentEff = getLayerEffectivePropsAtTime(parent, currentSec, visited, pool);
          const aspect = currentProjectState.aspectRatio || '16:9';
          const res = currentProjectState.resolution || '1080p';
          const baseDims = window.getProjectDimensions(res, aspect);
          const baseW = (currentProjectState.width && currentProjectState.width > 0) ? currentProjectState.width : baseDims[0];
          const baseH = (currentProjectState.height && currentProjectState.height > 0) ? currentProjectState.height : baseDims[1];

          let bind = layer.parentBind;
          if (!bind) {
            const pps = (typeof window.currentPixelsPerSecond === 'number' && window.currentPixelsPerSecond > 0) ? window.currentPixelsPerSecond : 80;
            const pInitSec = parent.startSec !== undefined ? parent.startSec : ((parent.startPx || 0) / pps);
            const parentInit = getLayerEffectivePropsAtTime(parent, pInitSec, visited, pool);
            bind = {
              parentPosX: parentInit.posX !== undefined ? parentInit.posX : (baseW / 2),
              parentPosY: parentInit.posY !== undefined ? parentInit.posY : (baseH / 2),
              parentPosZ: parentInit.posZ || 0,
              parentRotX: parentInit.rotX || 0,
              parentRotY: parentInit.rotY || 0,
              parentRotZ: parentInit.rotZ !== undefined ? parentInit.rotZ : (parentInit.rotation || 0),
              parentScaleW: parentInit.scaleW || 500,
              parentScaleH: parentInit.scaleH || 500
            };
            layer.parentBind = bind;
          }

          const pCurRotX = parentEff.rotX || 0;
          const pCurRotY = parentEff.rotY || 0;
          const pCurRotZ = parentEff.rotZ !== undefined ? parentEff.rotZ : (parentEff.rotation || 0);
          const deltaRotX = pCurRotX - (bind.parentRotX || 0);
          const deltaRotY = pCurRotY - (bind.parentRotY || 0);
          const deltaRotZ = pCurRotZ - (bind.parentRotZ || 0);
          const scaleRatioW = bind.parentScaleW ? (parentEff.scaleW / bind.parentScaleW) : 1;
          const scaleRatioH = bind.parentScaleH ? (parentEff.scaleH / bind.parentScaleH) : 1;
          const isCamera = (layer.type === 'camera');
          const camDist = 1000 * ((baseProps.cameraLens !== undefined ? baseProps.cameraLens : 50) / 50);

          let vx, vy, vz;
          if (isCamera) {
            // Camera eye position in world space: (baseW/2 + posX, baseH/2 + posY, D + posZ)
            vx = (baseW / 2 + (baseProps.posX || 0)) - bind.parentPosX;
            vy = (baseH / 2 + (baseProps.posY || 0)) - bind.parentPosY;
            vz = (camDist + (baseProps.posZ || 0)) - (bind.parentPosZ || 0);
          } else {
            vx = (baseProps.posX !== undefined ? baseProps.posX : (baseW / 2)) - bind.parentPosX;
            vy = (baseProps.posY !== undefined ? baseProps.posY : (baseH / 2)) - bind.parentPosY;
            vz = (baseProps.posZ || 0) - (bind.parentPosZ || 0);
          }

          vx *= scaleRatioW;
          vy *= scaleRatioH;

          // 3D Rotation of offset vector around parent
          if (isCamera) {
            // Camera inverse rotation matching engine view matrix: Pitch (X) -> Yaw (Y) -> Roll (Z)
            if (deltaRotX !== 0) {
              const radX = (deltaRotX * Math.PI) / 180;
              const cX = Math.cos(radX), sX = Math.sin(radX);
              const nvy = vy * cX - vz * sX, nvz = vy * sX + vz * cX;
              vy = nvy; vz = nvz;
            }
            if (deltaRotY !== 0) {
              const radY = (deltaRotY * Math.PI) / 180;
              const cY = Math.cos(radY), sY = Math.sin(radY);
              const nvx = vx * cY + vz * sY, nvz = -vx * sY + vz * cY;
              vx = nvx; vz = nvz;
            }
            if (deltaRotZ !== 0) {
              const radZ = (deltaRotZ * Math.PI) / 180;
              const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
              const nvx = vx * cZ - vy * sZ, nvy = vx * sZ + vy * cZ;
              vx = nvx; vy = nvy;
            }

            baseProps.posX = (parentEff.posX + vx) - (baseW / 2);
            baseProps.posY = (parentEff.posY + vy) - (baseH / 2);
            baseProps.posZ = (parentEff.posZ + vz) - camDist;
            baseProps.rotX = (baseProps.rotX || 0) - deltaRotX;
            baseProps.rotY = (baseProps.rotY || 0) - deltaRotY;
            baseProps.rotZ = (baseProps.rotZ !== undefined ? baseProps.rotZ : (baseProps.rotation || 0)) + deltaRotZ;
            baseProps.rotation = baseProps.rotZ;
          } else {
            // Standard layer forward rotation: Pitch (X) -> Yaw (Y) -> Roll (Z)
            if (deltaRotX !== 0) {
              const radX = (deltaRotX * Math.PI) / 180;
              const cX = Math.cos(radX), sX = Math.sin(radX);
              const nvy = vy * cX - vz * sX, nvz = vy * sX + vz * cX;
              vy = nvy; vz = nvz;
            }
            if (deltaRotY !== 0) {
              const radY = (deltaRotY * Math.PI) / 180;
              const cY = Math.cos(radY), sY = Math.sin(radY);
              const nvx = vx * cY + vz * sY, nvz = -vx * sY + vz * cY;
              vx = nvx; vz = nvz;
            }
            if (deltaRotZ !== 0) {
              const radZ = (deltaRotZ * Math.PI) / 180;
              const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
              const nvx = vx * cZ - vy * sZ, nvy = vx * sZ + vy * cZ;
              vx = nvx; vy = nvy;
            }

            baseProps.posX = parentEff.posX + vx;
            baseProps.posY = parentEff.posY + vy;
            baseProps.posZ = parentEff.posZ + vz;

            const cBaseRotX = baseProps.rotX || 0;
            const cBaseRotY = baseProps.rotY || 0;
            const cBaseRotZ = baseProps.rotZ !== undefined ? baseProps.rotZ : (baseProps.rotation || 0);
            const compRot = composeEulerRotations(deltaRotX, deltaRotY, deltaRotZ, cBaseRotX, cBaseRotY, cBaseRotZ);
            baseProps.rotX = compRot.rotX;
            baseProps.rotY = compRot.rotY;
            baseProps.rotZ = compRot.rotZ;
            baseProps.rotation = baseProps.rotZ;
          }

          baseProps.scaleW = (baseProps.scaleW !== undefined ? baseProps.scaleW : 500) * scaleRatioW;
          baseProps.scaleH = (baseProps.scaleH !== undefined ? baseProps.scaleH : 500) * scaleRatioH;
        }
      }

      if (layer.type === 'adjustment') {
        baseProps.posZ = 0;
        baseProps.rotX = 0;
        baseProps.rotY = 0;
        baseProps.anchorZ = 0;
      }

      if (layer.type === 'text' && window.FishTextEngine) {
        const pps = (typeof window.currentPixelsPerSecond === 'number' && window.currentPixelsPerSecond > 0) ? window.currentPixelsPerSecond : 80;
        const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
        const localSec = Math.max(0, currentSec - clipStart);

        const nat = window.FishTextEngine.getNaturalSize(layer);
        const animTf = window.FishTextEngine.getAnimTransform(layer, localSec, clipDur);

        const uScaleX = (typeof layer.transformScaleX === 'number' && !isNaN(layer.transformScaleX) && layer.transformScaleX > 0) ? layer.transformScaleX : 1.0;
        const uScaleY = (typeof layer.transformScaleY === 'number' && !isNaN(layer.transformScaleY) && layer.transformScaleY > 0) ? layer.transformScaleY : 1.0;
        const hasScaleKeyframes = !!(layer.keyframes && layer.keyframes.scale && layer.keyframes.scale.length > 0);
        const baseW = hasScaleKeyframes ? (baseProps.scaleW || nat.width) : (nat.width * uScaleX);
        const baseH = hasScaleKeyframes ? (baseProps.scaleH || nat.height) : (nat.height * uScaleY);

        baseProps.scaleW = baseW * animTf.scaleX;
        baseProps.scaleH = baseH * animTf.scaleY;
        baseProps.posX = (baseProps.posX !== undefined ? baseProps.posX : 540) + animTf.offX;
        baseProps.posY = (baseProps.posY !== undefined ? baseProps.posY : 960) + animTf.offY;
        if (animTf.alpha !== undefined && animTf.alpha < 1.0) {
          baseProps.opacity = (baseProps.opacity !== undefined ? baseProps.opacity : 1.0) * animTf.alpha;
        }
      }

      if (_effectivePropsCache.size > 512) {
        const iter = _effectivePropsCache.keys();
        for (let i = 0; i < 128; i++) {
          const next = iter.next();
          if (next.done) break;
          _effectivePropsCache.delete(next.value);
        }
      }
      _effectivePropsCache.set(cacheKey, baseProps);

      return baseProps;
    }
    window.getLayerEffectivePropsAtTime = getLayerEffectivePropsAtTime;

    // Helper: Fast numerical integration for cubic bezier / multi-mode speed curve
    // Guarantees strictly monotonic forward progress and eliminates deceleration backward jitter
    function integrateBezierSpeedSegment(s0, s1, easingOrKf, span, currentDt) {
      if (currentDt <= 0) return 0;
      const clampedDt = Math.min(span, currentDt);
      const steps = 16;
      const dt = clampedDt / steps;
      let sum = 0;
      const fallbackE = (Array.isArray(easingOrKf) && easingOrKf.length === 4)
        ? easingOrKf
        : ((easingOrKf && Array.isArray(easingOrKf.easing)) ? easingOrKf.easing : [0.42, 0.0, 0.58, 1.0]);
      for (let j = 0; j < steps; j++) {
        const tA = (j * dt) / span;
        const tB = ((j + 1) * dt) / span;
        const vA = s0 + (s1 - s0) * evaluateKeyframeEasing(easingOrKf, tA, fallbackE);
        const vB = s0 + (s1 - s0) * evaluateKeyframeEasing(easingOrKf, tB, fallbackE);
        sum += (vA + vB) * 0.5 * dt;
      }
      return sum;
    }

    // Helper: Compute forward-only integrated source time from speed keyframes (eliminates maju-mundur in Twixtor)
    function getLayerIntegratedSpeedTime(layer, currentSec) {
      if (!layer) return 0;
      const pps = (typeof window.currentPixelsPerSecond === 'number' && window.currentPixelsPerSecond > 0) ? window.currentPixelsPerSecond : 80;
      const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const srcOffset = layer.sourceOffsetSec || 0;

      const kfs = (layer.keyframes && Array.isArray(layer.keyframes.speed)) ? layer.keyframes.speed : null;
      if (!kfs || kfs.length === 0) {
        const spd = (layer.speed !== undefined && layer.speed !== 0) ? layer.speed : 1.0;
        if (spd < 0) {
          const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
          const elapsed = Math.max(0, currentSec - start);
          return Math.max(0, srcOffset + Math.max(0, (dur - elapsed) * Math.abs(spd)));
        }
        if (currentSec <= start) return Math.max(0, srcOffset);
        return Math.max(0, srcOffset + (currentSec - start) * spd);
      }

      if (currentSec <= start) return Math.max(0, srcOffset);

      let sorted = kfs._sorted;
      if (!sorted || kfs._sortedLen !== kfs.length) {
        sorted = [...kfs].sort((a, b) => a.time - b.time);
        kfs._sorted = sorted;
        kfs._sortedLen = kfs.length;
      }
      if (currentSec <= sorted[0].time) {
        const firstSpd = (sorted[0].value && sorted[0].value.speed !== undefined) ? sorted[0].value.speed : (layer.speed || 1.0);
        return Math.max(0, srcOffset + (currentSec - start) * firstSpd);
      }

      let accumulated = (sorted[0].time - start) * ((sorted[0].value && sorted[0].value.speed !== undefined) ? sorted[0].value.speed : (layer.speed || 1.0));
      if (accumulated < 0) accumulated = 0;

      for (let i = 0; i < sorted.length - 1; i++) {
        const k0 = sorted[i];
        const k1 = sorted[i + 1];
        const s0 = (k0.value && k0.value.speed !== undefined) ? k0.value.speed : (layer.speed || 1.0);
        const s1 = (k1.value && k1.value.speed !== undefined) ? k1.value.speed : (layer.speed || 1.0);
        const span = k1.time - k0.time;
        if (span <= 0) continue;

        if (currentSec >= k1.time) {
          if (k0._cachedIntegratedSpan === undefined || k0._cachedSpan !== span || k0._cachedS0 !== s0 || k0._cachedS1 !== s1) {
            k0._cachedSpan = span;
            k0._cachedS0 = s0;
            k0._cachedS1 = s1;
            k0._cachedIntegratedSpan = integrateBezierSpeedSegment(s0, s1, k0, span, span);
          }
          accumulated += k0._cachedIntegratedSpan;
        } else {
          const partialDt = currentSec - k0.time;
          accumulated += integrateBezierSpeedSegment(s0, s1, k0, span, partialDt);
          return Math.max(0, srcOffset + accumulated);
        }
      }

      const lastKf = sorted[sorted.length - 1];
      const lastSpd = (lastKf.value && lastKf.value.speed !== undefined) ? lastKf.value.speed : (layer.speed || 1.0);
      accumulated += (currentSec - lastKf.time) * lastSpd;
      return Math.max(0, srcOffset + accumulated);
    }
    window.getLayerIntegratedSpeedTime = getLayerIntegratedSpeedTime;

    // Helper to find keyframe at given time within tolerance
    function getKeyframeAtTime(layer, prop, time, tolerance = 0.05) {
      if (!layer || !layer.keyframes || !layer.keyframes[prop]) return null;
      return layer.keyframes[prop].find(k => Math.abs(k.time - time) <= tolerance) || null;
    }
    window.getKeyframeAtTime = getKeyframeAtTime;

    // Helper to get surrounding keyframe pair for active property
    function getSurroundingKeyframes(layer, prop, time) {
      if (!layer || !layer.keyframes || !layer.keyframes[prop]) return { prevKf: null, nextKf: null };
      const list = [...layer.keyframes[prop]].sort((a, b) => a.time - b.time);
      if (list.length < 2) return { prevKf: null, nextKf: null };

      const fps = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
      const tol = Math.max(0.04, 0.5 / fps);

      // 1. If playhead is on or near a specific keyframe (within frame tolerance)
      const exactKf = list.find(k => Math.abs(k.time - time) <= tol);
      if (exactKf) {
        const idx = list.indexOf(exactKf);
        if (idx < list.length - 1) {
          // At keyframe 1: edits 1 -> 2; at keyframe 2: edits 2 -> 3
          return { prevKf: list[idx], nextKf: list[idx + 1] };
        } else if (list.length >= 2) {
          // At the last keyframe: edits preceding segment (e.g. 2 -> 3)
          return { prevKf: list[idx - 1], nextKf: list[idx] };
        }
      }

      // 2. If playhead is before the first keyframe (beyond tolerance)
      if (time < list[0].time - tol) {
        return { prevKf: null, nextKf: null };
      }

      // 3. If playhead is past the last keyframe (beyond tolerance)
      if (time > list[list.length - 1].time + tol) {
        return { prevKf: null, nextKf: null };
      }

      // 4. If playhead is between two keyframes
      for (let i = 0; i < list.length - 1; i++) {
        if (time >= list[i].time && time <= list[i + 1].time) {
          return { prevKf: list[i], nextKf: list[i + 1] };
        }
      }

      return { prevKf: null, nextKf: null };
    }
    window.getSurroundingKeyframes = getSurroundingKeyframes;

    // Update Transform Keyframe & Graph Button active state
    function updateTransformKeyframeBtnState() {
      const btn = document.getElementById('btn-transform-keyframe');
      const btnGraph = document.getElementById('btn-transform-graph');
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer) {
        if (btn) btn.classList.remove('is-active');
        if (btnGraph) {
          btnGraph.disabled = true;
          btnGraph.classList.add('is-disabled');
        }
        return;
      }
      const pps = window.currentPixelsPerSecond || 80;
      const currentSec = Math.abs(window.timelinePanX || 0) / pps;
      const prop = window.activeTransformTool || window.activeKeyframeProperty || 'move';
      const kf = getKeyframeAtTime(layer, prop, currentSec);
      if (btn) btn.classList.toggle('is-active', !!kf);

      if (btnGraph) {
        const kfList = (layer.keyframes && layer.keyframes[prop]) || [];
        const canOpen = kfList.length >= 2;
        btnGraph.disabled = !canOpen;
        btnGraph.classList.toggle('is-disabled', !canOpen);
      }
    }
    window.updateTransformKeyframeBtnState = updateTransformKeyframeBtnState;

    // Update Effects Keyframe & Graph Button active state
    function updateEffectsKeyframeAndGraphBtnStates() {
      const btnKf = document.getElementById('btn-effects-keyframe');
      const btnGraph = document.getElementById('btn-effects-graph');
      const btnExpr = document.getElementById('btn-effects-expression');
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      const effects = layer && Array.isArray(layer.effects) ? layer.effects : [];
      const curProp = window.activeKeyframeProperty;
      const isValidParam = !!(curProp && curProp.includes(':') && effects.some(f => curProp.startsWith(f.id + ':')));

      if (!isValidParam || !layer) {
        if (btnKf) {
          btnKf.disabled = true;
          btnKf.classList.add('is-disabled');
          btnKf.classList.remove('is-active');
        }
        if (btnGraph) {
          btnGraph.disabled = true;
          btnGraph.classList.add('is-disabled');
        }
        if (btnExpr) {
          btnExpr.disabled = true;
          btnExpr.classList.add('is-disabled');
          btnExpr.classList.remove('is-active', 'has-expression');
        }
        return;
      }

      if (btnKf) {
        btnKf.disabled = false;
        btnKf.classList.remove('is-disabled');
        const pps = window.currentPixelsPerSecond || 80;
        const currentSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
        const kf = getKeyframeAtTime(layer, curProp, currentSec);
        btnKf.classList.toggle('is-active', !!kf);
      }

      if (btnGraph) {
        const kfList = (layer.keyframes && layer.keyframes[curProp]) || [];
        const canOpen = kfList.length >= 2;
        btnGraph.disabled = !canOpen;
        btnGraph.classList.toggle('is-disabled', !canOpen);
      }

      if (btnExpr) {
        btnExpr.disabled = false;
        btnExpr.classList.remove('is-disabled');
        const hasExpr = !!(layer.expressions && layer.expressions[curProp] && typeof layer.expressions[curProp] === 'string' && layer.expressions[curProp].trim().length > 0);
        btnExpr.classList.toggle('has-expression', hasExpr);
        btnExpr.classList.toggle('is-active', hasExpr);
      }
    }
    window.updateEffectsKeyframeAndGraphBtnStates = updateEffectsKeyframeAndGraphBtnStates;

    // Unified Graph Button State Updater across all property views
    function updateAllGraphBtnStates() {
      if (typeof updateTransformKeyframeBtnState === 'function') updateTransformKeyframeBtnState();
      if (typeof updateEffectsKeyframeAndGraphBtnStates === 'function') updateEffectsKeyframeAndGraphBtnStates();
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      const checkBtn = (btnId, propKey) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const kfList = (layer && layer.keyframes && layer.keyframes[propKey]) || [];
        const canOpen = kfList.length >= 2;
        btn.disabled = !canOpen;
        btn.classList.toggle('is-disabled', !canOpen);
      };
      checkBtn('btn-blend-graph', 'opacity');
      checkBtn('btn-volume-graph', 'volume');
      const btnSpeed = document.getElementById('btn-speed-graph');
      if (btnSpeed) {
        const activeSpeedProp = (layer && layer.speedMode === 'time_remap') ? 'timeRemap' : 'speed';
        const activeKf = (layer && layer.keyframes && layer.keyframes[activeSpeedProp]) || [];
        const canOpen = activeKf.length >= 2;
        btnSpeed.disabled = !canOpen;
        btnSpeed.classList.toggle('is-disabled', !canOpen);
      }
      const camProp = window.activeKeyframeProperty || 'cameraZoom';
      checkBtn('btn-camera-graph', camProp);
      checkBtn('btn-vector-graph', 'vectorPoints');
    }
    window.updateAllGraphBtnStates = updateAllGraphBtnStates;

    // Toggle Keyframe at current playhead time
    function toggleKeyframeAtCurrentTime(optLayer = null, optProp = null) {
      const layer = optLayer || (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer) return;

      const pps = window.currentPixelsPerSecond || 80;
      const currentSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
      const prop = optProp || window.activeKeyframeProperty || 'move';

      if (prop.includes(':')) {
        const effects = layer && Array.isArray(layer.effects) ? layer.effects : [];
        const isValid = effects.some(f => prop.startsWith(f.id + ':'));
        if (!isValid) return;
      }

      if (!prop.includes(':') && typeof syncLayerWithEffectiveProps === 'function') {
        syncLayerWithEffectiveProps(layer);
      }
      if (typeof invalidatePreviewCacheForLayer === 'function') {
        invalidatePreviewCacheForLayer(layer);
      }

      if (!layer.keyframes) layer.keyframes = {};
      if (!layer.keyframes[prop]) layer.keyframes[prop] = [];

      const existingKf = getKeyframeAtTime(layer, prop, currentSec);
      if (existingKf) {
        // Remove keyframe
        layer.keyframes[prop] = layer.keyframes[prop].filter(k => k !== existingKf);
      } else {
        // Add keyframe with current effective values
        const currentVal = getLayerPropertyValue(layer, prop);
        const defaultEasing = (layer._defaultEasing && layer._defaultEasing[prop])
          ? layer._defaultEasing[prop]
          : ((layer.isOverlapCamera || layer.isOverlapNull) ? [0.85, 0.0, 0.15, 1.0] : [0.0, 0.0, 1.0, 1.0]);
        layer.keyframes[prop].push({
          time: currentSec,
          value: currentVal,
          easing: [...defaultEasing]
        });
        layer.keyframes[prop].sort((a, b) => a.time - b.time);
      }

      if (typeof invalidatePreviewCacheForLayer === 'function') {
        invalidatePreviewCacheForLayer(layer);
      }

      if (typeof updateTransformKeyframeBtnState === 'function') updateTransformKeyframeBtnState();
      if (typeof updateBlendKeyframeBtnState === 'function') updateBlendKeyframeBtnState();
      if (typeof updateVolumeKeyframeBtnState === 'function') updateVolumeKeyframeBtnState();
      if (typeof updateSpeedKeyframeBtnState === 'function') updateSpeedKeyframeBtnState();
      if (typeof updateVectorKeyframeBtnState === 'function') updateVectorKeyframeBtnState();
      if (typeof updateAllGraphBtnStates === 'function') updateAllGraphBtnStates();
      if (typeof syncSpeedControllerValues === 'function') syncSpeedControllerValues();
      if (typeof syncEffectsKeyframeState === 'function') syncEffectsKeyframeState(layer);
      if (typeof syncLayerKeyframeMarkersInPlace === 'function') {
        syncLayerKeyframeMarkersInPlace(layer);
      } else if (typeof renderTimelineLayers === 'function') {
        renderTimelineLayers();
      }
      if (typeof redrawComposition === 'function') redrawComposition('toggleKeyframe');
      if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
      if (typeof updateGraphEditorUI === 'function') updateGraphEditorUI();
    }
    window.toggleKeyframeAtCurrentTime = toggleKeyframeAtCurrentTime;

    // Automatic Keyframing on Property Value Change
    // STRICT RULE: ONLY creates/records keyframes if keyframes already exist for this property on this layer!
    // If no keyframes exist yet, strictly does NOT auto-create keyframes.
    function recordLayerPropertyChange(layer, prop) {
      if (!layer || !prop) return false;
      if (typeof invalidatePreviewCacheForLayer === 'function') {
        invalidatePreviewCacheForLayer(layer);
      }

      let targetPropKey = prop;
      let kfList = (layer.keyframes && Array.isArray(layer.keyframes[prop])) ? layer.keyframes[prop] : null;
      if ((!kfList || kfList.length === 0) && prop.includes(':') && layer.effects && layer.effects[0] && prop.startsWith(layer.effects[0].id + ':')) {
        const pName = prop.split(':')[1];
        const builtInProps = ['move', 'scale', 'rotate', 'rotation', 'opacity', 'volume', 'origin', 'skew', 'speed', 'timeRemap', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurAmount', 'vectorPoints'];
        if (!builtInProps.includes(pName) && layer.keyframes && Array.isArray(layer.keyframes[pName]) && layer.keyframes[pName].length > 0) {
          kfList = layer.keyframes[pName];
          targetPropKey = pName;
        }
      }
      if (!kfList || kfList.length === 0) {
        return false; // NO keyframes exist: strictly DO NOT auto-create!
      }

      const pps = window.currentPixelsPerSecond || 80;
      const currentSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
      const currentVal = getLayerPropertyValue(layer, prop);
      const fps = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
      const frameTol = Math.max(0.04, 0.5 / fps);

      let kf = (typeof getKeyframeAtTime === 'function') ? getKeyframeAtTime(layer, targetPropKey, currentSec, frameTol) : null;
      if (kf) {
        kf.value = currentVal;
      } else if (!isAnyPlaybackActive()) {
        // Stepped away from existing keyframe and changed value: auto-create new keyframe (only when stopped/paused)!
        const defaultEasing = (layer._defaultEasing && layer._defaultEasing[targetPropKey])
          ? layer._defaultEasing[targetPropKey]
          : ((layer.isOverlapCamera || layer.isOverlapNull) ? [0.85, 0.0, 0.15, 1.0] : [0.0, 0.0, 1.0, 1.0]);
        kfList.push({
          time: currentSec,
          value: currentVal,
          easing: [...defaultEasing]
        });
        kfList.sort((a, b) => a.time - b.time);
        if (typeof updateTransformKeyframeBtnState === 'function') updateTransformKeyframeBtnState();
        if (typeof updateBlendKeyframeBtnState === 'function') updateBlendKeyframeBtnState();
        if (typeof updateVolumeKeyframeBtnState === 'function') updateVolumeKeyframeBtnState();
        if (typeof updateSpeedKeyframeBtnState === 'function') updateSpeedKeyframeBtnState();
        if (typeof updateVectorKeyframeBtnState === 'function') updateVectorKeyframeBtnState();
        if (typeof updateAllGraphBtnStates === 'function') updateAllGraphBtnStates();
        if (typeof syncEffectsKeyframeState === 'function') syncEffectsKeyframeState(layer);
        if (typeof syncLayerKeyframeMarkersInPlace === 'function') {
          syncLayerKeyframeMarkersInPlace(layer);
        } else if (typeof renderTimelineLayers === 'function') {
          renderTimelineLayers();
        }
        if (typeof updateGraphEditorUI === 'function') updateGraphEditorUI();
      }
      if (typeof invalidatePreviewCacheForLayer === 'function') {
        invalidatePreviewCacheForLayer(layer);
      }
      return true;
    }
    window.recordLayerPropertyChange = recordLayerPropertyChange;

    // Subview switching inside #timeline-layer-drawer: Main -> Transform -> Graph

    function initGraphEditor() {
      const graphFrame = document.getElementById('graph-canvas-frame');
      const dashedRect = document.getElementById('graph-dashed-boundary-rect');
      const svgLayer = document.getElementById('graph-svg-layer');
      const speedFillPath = document.getElementById('graph-speed-fill-path');
      const guidelinePath = document.getElementById('graph-guideline-path');
      const tangent1 = document.getElementById('graph-tangent-1');
      const tangent2 = document.getElementById('graph-tangent-2');
      const stemDot1 = document.getElementById('graph-stem-dot-1');
      const stemDot2 = document.getElementById('graph-stem-dot-2');
      const curvePath = document.getElementById('graph-curve-path');
      const anchorStart = document.getElementById('graph-anchor-start');
      const anchorEnd = document.getElementById('graph-anchor-end');
      const timeLine = document.getElementById('graph-time-line');
      const handle1 = document.getElementById('graph-handle-1');
      const handle2 = document.getElementById('graph-handle-2');
      const handle3 = document.getElementById('graph-handle-3');
      const handle4 = document.getElementById('graph-handle-4');
      const handle1Hit = document.getElementById('graph-handle-1-hit');
      const handle2Hit = document.getElementById('graph-handle-2-hit');
      const handle3Hit = document.getElementById('graph-handle-3-hit');
      const handle4Hit = document.getElementById('graph-handle-4-hit');

      const btnGraphMode = document.getElementById('btn-graph-mode');
      const popoverGraphMode = document.getElementById('popover-graph-mode');
      const graphModeBtnIconPath = document.getElementById('graph-mode-btn-icon-path');
      const graphModeBtnDot1 = document.getElementById('graph-mode-btn-dot-1');
      const graphModeBtnDot2 = document.getElementById('graph-mode-btn-dot-2');

      const btnGraphReverse = document.getElementById('btn-graph-reverse');
      const btnGraphSnap = document.getElementById('btn-graph-snap');
      const btnGraphMore = document.getElementById('btn-graph-more');
      const btnToggleOvershoot = document.getElementById('btn-toggle-overshoot');
      const btnGraphCopy = document.getElementById('btn-graph-copy');
      const btnGraphPaste = document.getElementById('btn-graph-paste');
      const btnCopyToAll = document.getElementById('btn-graph-copy-to-all');
      const chkOvershoot = document.getElementById('chk-graph-overshoot');
      const svgChkOvershoot = document.getElementById('svg-chk-graph-overshoot');
      const btnSavePreset = document.getElementById('btn-graph-save-preset');
      const customPresetsContainer = document.getElementById('graph-custom-presets-container');
      const presetsCol = document.getElementById('graph-presets-col');

      let isGraphSnapEnabled = false;
      let activeGraphMode = 'value'; // 'value' | 'speed' | 'elastic' | 'bounce' | 'cyclic'

      const DEFAULT_MODE_CONFIGS = {
        value: { type: 'value', easing: [0.42, 0.0, 0.58, 1.0] },
        speed: { type: 'speed', outSpeed: 0, outInfl: 75, inSpeed: 0, inInfl: 75, easing: [0.75, 0.0, 0.25, 1.0] },
        elastic: { type: 'elastic', stepLength: 0.35, attack: 1.0, decay: 0.45, magnitude: 0.50, reverse: false },
        bounce: { type: 'bounce', firstStepLength: 0.45, bounciness: 0.65, reverse: false },
        cyclic: { type: 'cyclic', stepLength: 0.35, sharpness: 0.0, skew: 0.50, decay: 0.0, reverse: false }
      };

      const MODE_PRESETS = {
        value: [
          { id: 'linear', name: 'LINEAR', easing: [0.0, 0.0, 1.0, 1.0], config: { type: 'value', easing: [0.0, 0.0, 1.0, 1.0] } },
          { id: 'ease-in', name: 'EASE IN', easing: [0.42, 0.0, 1.0, 1.0], config: { type: 'value', easing: [0.42, 0.0, 1.0, 1.0] } },
          { id: 'ease-out', name: 'EASE OUT', easing: [0.0, 0.0, 0.58, 1.0], config: { type: 'value', easing: [0.0, 0.0, 0.58, 1.0] } },
          { id: 'ease-in-out', name: 'EASE IN OUT', easing: [0.42, 0.0, 0.58, 1.0], config: { type: 'value', easing: [0.42, 0.0, 0.58, 1.0] } },
          { id: 'z-graph', name: 'Z-GRAPH', easing: [0.85, 0.0, 0.15, 1.0], config: { type: 'value', easing: [0.85, 0.0, 0.15, 1.0] } }
        ],
        speed: [
          { id: 'linear', name: 'SOFT VELOCITY', easing: [0.33, 0.0, 0.67, 1.0], config: { type: 'speed', outSpeed: 0, outInfl: 33, inSpeed: 0, inInfl: 33 } },
          { id: 'ease-in', name: 'EASE IN', easing: [0.33, 0.0, 0.0, 1.0], config: { type: 'speed', outSpeed: 0, outInfl: 33, inSpeed: 0, inInfl: 100 } },
          { id: 'ease-out', name: 'EASE OUT', easing: [1.0, 0.0, 0.67, 1.0], config: { type: 'speed', outSpeed: 0, outInfl: 100, inSpeed: 0, inInfl: 33 } },
          { id: 'ease-in-out', name: 'FAST PEAK', easing: [0.80, 0.0, 0.20, 1.0], config: { type: 'speed', outSpeed: 0, outInfl: 80, inSpeed: 0, inInfl: 80 } },
          { id: 'z-graph', name: 'EXTREME SPIKE', easing: [0.95, 0.0, 0.05, 1.0], config: { type: 'speed', outSpeed: 0, outInfl: 95, inSpeed: 0, inInfl: 95 } }
        ],
        elastic: [
          { id: 'linear', name: 'SMOOTH ELASTIC', easing: [0.2, 1.35, 0.4, 1.0], config: { type: 'elastic', stepLength: 0.35, attack: 1.0, decay: 0.45, magnitude: 0.50, reverse: false } },
          { id: 'ease-in', name: 'SNAPPY SPRING', easing: [0.15, 1.45, 0.35, 1.0], config: { type: 'elastic', stepLength: 0.22, attack: 1.0, decay: 0.65, magnitude: 0.40, reverse: false } },
          { id: 'ease-out', name: 'HIGH OVERSHOOT', easing: [0.2, 1.5, 0.4, 1.0], config: { type: 'elastic', stepLength: 0.28, attack: 1.0, decay: 0.35, magnitude: 0.85, reverse: false } },
          { id: 'ease-in-out', name: 'BOUNCY SPRING', easing: [0.1, 1.6, 0.3, 1.0], config: { type: 'elastic', stepLength: 0.16, attack: 1.0, decay: 0.82, magnitude: 0.32, reverse: false } },
          { id: 'z-graph', name: 'ELASTIC OUT', easing: [0.6, 0.0, 0.8, -0.4], config: { type: 'elastic', stepLength: 0.30, attack: 1.0, decay: 0.50, magnitude: 0.60, reverse: true } }
        ],
        bounce: [
          { id: 'linear', name: 'NATURAL BOUNCE', easing: [0.25, 1.0, 0.5, 1.0], config: { type: 'bounce', firstStepLength: 0.45, bounciness: 0.65, reverse: false } },
          { id: 'ease-in', name: 'HEAVY DROP', easing: [0.3, 1.0, 0.6, 1.0], config: { type: 'bounce', firstStepLength: 0.55, bounciness: 0.40, reverse: false } },
          { id: 'ease-out', name: 'SUPER RUBBER', easing: [0.2, 1.0, 0.4, 1.0], config: { type: 'bounce', firstStepLength: 0.35, bounciness: 0.82, reverse: false } },
          { id: 'ease-in-out', name: 'HEAVY THUD', easing: [0.4, 1.0, 0.7, 1.0], config: { type: 'bounce', firstStepLength: 0.68, bounciness: 0.38, reverse: false } },
          { id: 'z-graph', name: 'BOUNCE OUT', easing: [0.5, 0.0, 0.75, 0.0], config: { type: 'bounce', firstStepLength: 0.45, bounciness: 0.65, reverse: true } }
        ],
        cyclic: [
          { id: 'linear', name: 'HARMONIC SINE', easing: [0.42, 0.0, 0.58, 1.0], config: { type: 'cyclic', stepLength: 0.3333333, sharpness: 0.0, skew: 0.50, decay: 0.0, reverse: false } },
          { id: 'ease-in', name: 'SHARP SAWTOOTH', easing: [0.0, 0.0, 1.0, 1.0], config: { type: 'cyclic', stepLength: 0.30, sharpness: 1.0, skew: 0.20, decay: 0.0, reverse: false } },
          { id: 'ease-out', name: 'DECAYING PULSE', easing: [0.85, 0.0, 0.15, 1.0], config: { type: 'cyclic', stepLength: 0.25, sharpness: 0.20, skew: 0.50, decay: 0.45, reverse: false } },
          { id: 'ease-in-out', name: 'TRIANGLE WAVE', easing: [0.25, 1.0, 0.5, 1.0], config: { type: 'cyclic', stepLength: 0.50, sharpness: 1.0, skew: 0.50, decay: 0.0, reverse: false } },
          { id: 'z-graph', name: 'DAMPED SHAKE', easing: [0.7, 0.0, 0.9, 1.0], config: { type: 'cyclic', stepLength: 0.32, sharpness: 0.50, skew: 0.50, decay: 0.55, reverse: false } }
        ]
      };

      function getActiveModePresets() {
        return MODE_PRESETS[activeGraphMode] || MODE_PRESETS.value;
      }

      function syncModeButtonUI() {
        if (graphModeBtnIconPath) {
          if (activeGraphMode === 'value') {
            graphModeBtnIconPath.setAttribute('d', 'M 3 13 C 7 13, 9 3, 13 3');
            if (graphModeBtnDot1) { graphModeBtnDot1.style.display = ''; graphModeBtnDot1.setAttribute('cx', '3'); graphModeBtnDot1.setAttribute('cy', '13'); }
            if (graphModeBtnDot2) { graphModeBtnDot2.style.display = ''; graphModeBtnDot2.setAttribute('cx', '13'); graphModeBtnDot2.setAttribute('cy', '3'); }
          } else if (activeGraphMode === 'speed') {
            graphModeBtnIconPath.setAttribute('d', 'M 2 13 C 5 13, 6 3, 8 3 C 10 3, 11 13, 14 13');
            if (graphModeBtnDot1) { graphModeBtnDot1.style.display = ''; graphModeBtnDot1.setAttribute('cx', '2'); graphModeBtnDot1.setAttribute('cy', '13'); }
            if (graphModeBtnDot2) { graphModeBtnDot2.style.display = ''; graphModeBtnDot2.setAttribute('cx', '14'); graphModeBtnDot2.setAttribute('cy', '13'); }
          } else if (activeGraphMode === 'elastic') {
            graphModeBtnIconPath.setAttribute('d', 'M 2 12 C 4 12, 4.5 2, 6 2 C 7.5 2, 8 9, 9.5 5 C 11 3, 12 6, 14 5');
            if (graphModeBtnDot1) graphModeBtnDot1.style.display = 'none';
            if (graphModeBtnDot2) graphModeBtnDot2.style.display = 'none';
          } else if (activeGraphMode === 'bounce') {
            graphModeBtnIconPath.setAttribute('d', 'M 2 13 Q 4.5 2, 7 3 Q 9 9, 10.5 3 Q 12 6, 14 3');
            if (graphModeBtnDot1) graphModeBtnDot1.style.display = 'none';
            if (graphModeBtnDot2) graphModeBtnDot2.style.display = 'none';
          } else if (activeGraphMode === 'cyclic') {
            graphModeBtnIconPath.setAttribute('d', 'M 2 8 Q 5 1, 8 8 T 14 8');
            if (graphModeBtnDot1) graphModeBtnDot1.style.display = 'none';
            if (graphModeBtnDot2) graphModeBtnDot2.style.display = 'none';
          }
        }
        if (popoverGraphMode) {
          popoverGraphMode.querySelectorAll('[data-graph-mode], .graph-mode-menu-item').forEach(btn => {
            const m = btn.getAttribute('data-graph-mode');
            const active = (m === activeGraphMode);
            btn.classList.toggle('is-active', active);
            const checkEl = btn.querySelector('.graph-mode-check');
            if (checkEl) checkEl.classList.toggle('is-checked', active);
          });
        }
      }

      if (btnGraphSnap) {
        btnGraphSnap.addEventListener('click', (e) => {
          e.stopPropagation();
          isGraphSnapEnabled = !isGraphSnapEnabled;
          btnGraphSnap.classList.toggle('is-active', isGraphSnapEnabled);
        });
      }

      if (presetsCol) {
        presetsCol.addEventListener('wheel', (e) => {
          const isRow = (typeof window !== 'undefined' && window.getComputedStyle(presetsCol).flexDirection === 'row');
          if (isRow && Math.abs(e.deltaY) > Math.abs(e.deltaX) && presetsCol.scrollWidth > presetsCol.clientWidth) {
            presetsCol.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        }, { passive: false });
      }

      const presetBtns = {
        'linear': document.getElementById('btn-graph-preset-linear'),
        'ease-in': document.getElementById('btn-graph-preset-ease-in'),
        'ease-out': document.getElementById('btn-graph-preset-ease-out'),
        'ease-in-out': document.getElementById('btn-graph-preset-ease-in-out'),
        'z-graph': document.getElementById('btn-graph-preset-z-graph')
      };

      const BASE_SVG_H = 170;
      let svgW = 260;
      const PAD_X = 16;
      const BASE_Y_END = 16;    // 1.0 top of 0..1 reference zone
      const BASE_Y_START = 154; // 0.0 bottom of 0..1 reference zone
      const BASE_RANGE_Y = BASE_Y_START - BASE_Y_END; // 138
      let lockedDragViewBox = null;

      function updateSvgDimensions(customViewH) {
        if (!graphFrame) return;
        const rect = graphFrame.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const ratio = rect.width / rect.height;
          const h = customViewH || BASE_SVG_H;
          svgW = Math.max(170, Math.round(h * ratio));
        }
      }

      function getCurrentViewBox(easing, cfgOverride) {
        if (lockedDragViewBox) {
          return lockedDragViewBox;
        }
        if (activeGraphMode === 'elastic') {
          const activeCfg = cfgOverride || getActiveEasingConfig() || DEFAULT_MODE_CONFIGS.elastic;
          const isRev = Boolean(activeCfg && activeCfg.reverse);
          const HANDLE_PAD = 14;
          const maxNy = isRev ? 1.25 : 2.02;
          const minNy = isRev ? -1.02 : -0.25;
          const topSy = BASE_Y_START - maxNy * BASE_RANGE_Y;
          const bottomSy = BASE_Y_START - minNy * BASE_RANGE_Y;
          const viewY = Math.min(0, topSy - HANDLE_PAD);
          const viewBottom = Math.max(BASE_SVG_H, bottomSy + HANDLE_PAD);
          const viewH = viewBottom - viewY;
          return { viewY, viewH, extraTop: -viewY, extraBottom: viewBottom - BASE_SVG_H };
        }
        if (activeGraphMode === 'bounce') {
          const HANDLE_PAD = 14;
          const topSy = BASE_Y_START - 1.18 * BASE_RANGE_Y;
          const bottomSy = BASE_Y_START - (-0.18) * BASE_RANGE_Y;
          const viewY = Math.min(0, topSy - HANDLE_PAD);
          const viewBottom = Math.max(BASE_SVG_H, bottomSy + HANDLE_PAD);
          const viewH = viewBottom - viewY;
          return { viewY, viewH, extraTop: -viewY, extraBottom: viewBottom - BASE_SVG_H };
        }
        if (activeGraphMode === 'cyclic') {
          const HANDLE_PAD = 14;
          const topSy = BASE_Y_START - 1.45 * BASE_RANGE_Y;
          const bottomSy = BASE_Y_START - (-0.22) * BASE_RANGE_Y;
          const viewY = Math.min(0, topSy - HANDLE_PAD);
          const viewBottom = Math.max(BASE_SVG_H, bottomSy + HANDLE_PAD);
          const viewH = viewBottom - viewY;
          return { viewY, viewH, extraTop: -viewY, extraBottom: viewBottom - BASE_SVG_H };
        }
        if (activeGraphMode !== 'value') {
          return { viewY: 0, viewH: BASE_SVG_H, extraTop: 0, extraBottom: 0 };
        }
        const eas = easing || getActiveEasing() || [0.42, 0.0, 0.58, 1.0];
        if (!isGraphOvershootEnabled) {
          return { viewY: 0, viewH: BASE_SVG_H, extraTop: 0, extraBottom: 0 };
        }
        // Alight Motion EasingCurveView provides overshoot headroom (~0.45) when overshoot is enabled
        // so handles can be dragged directly outside [0..1] with 1:1 cursor tracking.
        const minBy = Math.min(-0.42, eas[1], eas[3]);
        const maxBy = Math.max(1.42, eas[1], eas[3]);

        const HANDLE_PAD = 16;
        const topSy = BASE_Y_START - maxBy * BASE_RANGE_Y;
        const viewY = Math.min(0, topSy - HANDLE_PAD);

        const bottomSy = BASE_Y_START - minBy * BASE_RANGE_Y;
        const viewBottom = Math.max(BASE_SVG_H, bottomSy + HANDLE_PAD);

        const viewH = viewBottom - viewY;
        const extraTop = -viewY;
        const extraBottom = viewBottom - BASE_SVG_H;
        return { viewY, viewH, extraTop, extraBottom };
      }

      function getBounds() {
        const minX = PAD_X;
        const maxX = svgW - PAD_X;
        const yStart = BASE_Y_START;
        const yEnd = BASE_Y_END;
        const rangeY = BASE_RANGE_Y;
        return { minX, maxX, yStart, yEnd, rangeY };
      }

      function bezierToSvg(bx, by) {
        const { minX, maxX, yStart, rangeY } = getBounds();
        const sx = minX + bx * (maxX - minX);
        const sy = yStart - by * rangeY;
        return { sx, sy };
      }

      function ensureKeyframeDefaultEasing(kf, layer, prop) {
        if (!kf) return;
        if (!kf.easing || !Array.isArray(kf.easing) || kf.easing.length !== 4) {
          const defEas = (layer && (layer.defaultEasing || layer._defaultEasing) && (layer.defaultEasing || layer._defaultEasing)[prop])
            ? (layer.defaultEasing || layer._defaultEasing)[prop]
            : (layer && (layer.isOverlapCamera || layer.isOverlapNull) ? [0.85, 0.0, 0.15, 1.0] : [0.42, 0.0, 0.58, 1.0]);
          kf.easing = [...defEas];
        }
      }

      function resolveTargetKeyframeHolder() {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!layer) return null;
        const prop = window.activeKeyframeProperty || 'move';
        const pps = window.currentPixelsPerSecond || 80;
        const currentSec = Math.abs(window.timelinePanX || 0) / pps;
        const fps = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
        const tol = Math.max(0.04, 0.5 / fps);

        // 1. Primary: active segment surrounding playhead
        const { prevKf, nextKf } = getSurroundingKeyframes(layer, prop, currentSec);
        if (prevKf && nextKf) {
          ensureKeyframeDefaultEasing(prevKf, layer, prop);
          return { kf: prevKf, nextKf, layer, prop };
        }

        // 2. Fallback: selected keyframe on the active layer & property (even if playhead didn't seek on desktop)
        const hasSelectedKfs = Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0;
        if (hasSelectedKfs) {
          const matched = window.selectedKeyframes.find(it => it.layerId === window.selectedLayerId && (it.prop === prop || !prop))
            || window.selectedKeyframes[0];
          if (matched) {
            const l = matched.layer || (currentProjectState.layers || []).find(ly => ly.id === matched.layerId) || layer;
            const targetProp = matched.prop || prop;
            const rawList = (l && l.keyframes && Array.isArray(l.keyframes[targetProp])) ? l.keyframes[targetProp] : null;
            if (rawList && rawList.length >= 2) {
              const sorted = [...rawList].sort((a, b) => a.time - b.time);
              let idx = sorted.indexOf(matched.kf);
              if (idx === -1 && Number.isFinite(matched.time)) {
                idx = sorted.findIndex(k => Math.abs(k.time - matched.time) <= tol * 2);
              }
              if (idx === -1) idx = 0;
              const segIdx = (idx >= sorted.length - 1) ? Math.max(0, sorted.length - 2) : idx;
              const targetKf = sorted[segIdx];
              ensureKeyframeDefaultEasing(targetKf, l, targetProp);
              return { kf: targetKf, nextKf: sorted[segIdx + 1] || null, layer: l, prop: targetProp };
            }
          }
        }

        // 3. Fallback: nearest keyframe pair on the active layer & property when playhead is outside first/last keyframe
        const rawList = (layer.keyframes && Array.isArray(layer.keyframes[prop])) ? layer.keyframes[prop] : null;
        if (rawList && rawList.length >= 2) {
          const sorted = [...rawList].sort((a, b) => a.time - b.time);
          const segIdx = (currentSec <= sorted[0].time) ? 0 : (sorted.length - 2);
          const targetKf = sorted[segIdx];
          ensureKeyframeDefaultEasing(targetKf, layer, prop);
          return { kf: targetKf, nextKf: sorted[segIdx + 1] || null, layer, prop };
        }

        return null;
      }

      function getActiveEasing() {
        const resolved = resolveTargetKeyframeHolder();
        if (!resolved || !resolved.kf) return null;
        if (resolved.kf.easing && Array.isArray(resolved.kf.easing) && resolved.kf.easing.length === 4) {
          return resolved.kf.easing;
        }
        return [0.42, 0.0, 0.58, 1.0];
      }
      window.getActiveEasing = getActiveEasing;

      function getActiveEasingConfig() {
        const resolved = resolveTargetKeyframeHolder();
        if (!resolved || !resolved.kf) return null;
        const kf = resolved.kf;
        const eas = (Array.isArray(kf.easing) && kf.easing.length === 4) ? kf.easing : [0.42, 0.0, 0.58, 1.0];
        if (kf.easingConfig && typeof kf.easingConfig === 'object' && kf.easingConfig.type) {
          if (activeGraphMode === 'speed' && kf.easingConfig.type === 'value') {
            const sp = bezierToSpeedParams(eas);
            return { type: 'speed', ...sp, easing: [...eas] };
          }
          if (activeGraphMode === 'value' && kf.easingConfig.type === 'speed') {
            return { type: 'value', easing: [...eas] };
          }
          return kf.easingConfig;
        }
        if (activeGraphMode === 'speed') {
          const sp = bezierToSpeedParams(eas);
          return { type: 'speed', ...sp, easing: [...eas] };
        }
        return { type: 'value', easing: [...eas] };
      }
      window.getActiveEasingConfig = getActiveEasingConfig;

      function applyEasingAndConfigToKeyframes(newEasing, newConfig) {
        const targetId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size > 0 ? [...window.selectedLayerIds][0] : null);
        const layer = (currentProjectState.layers || []).find(l => l.id === targetId) || (currentProjectState.layers && currentProjectState.layers[0]);
        if (!layer) return;
        const prop = window.activeKeyframeProperty || 'move';
        const pps = window.currentPixelsPerSecond || 80;
        const currentSec = Math.abs(window.timelinePanX || 0) / pps;
        const safeEasing = Array.isArray(newEasing) && newEasing.length === 4 ? newEasing : [0.42, 0.0, 0.58, 1.0];
        const rounded = [
          Number(safeEasing[0].toFixed(3)),
          Number(safeEasing[1].toFixed(3)),
          Number(safeEasing[2].toFixed(3)),
          Number(safeEasing[3].toFixed(3))
        ];
        const clonedCfg = (newConfig && newConfig.type && newConfig.type !== 'value')
          ? cloneEasingConfig({ ...newConfig, easing: [...rounded] })
          : null;

        if (layer.isOverlapCamera || layer.isOverlapNull) {
          if (!layer.defaultEasing) layer.defaultEasing = {};
          layer.defaultEasing[prop] = [...rounded];
          layer._defaultEasing = layer.defaultEasing;
          if (!layer.defaultEasingConfig) layer.defaultEasingConfig = {};
          if (clonedCfg) layer.defaultEasingConfig[prop] = cloneEasingConfig(clonedCfg);
          else delete layer.defaultEasingConfig[prop];

          if (layer.keyframes && Array.isArray(layer.keyframes[prop])) {
            layer.keyframes[prop].forEach(kf => {
              kf.easing = [...rounded];
              if (clonedCfg) kf.easingConfig = cloneEasingConfig(clonedCfg);
              else delete kf.easingConfig;
            });
          }
          if (typeof invalidatePreviewCacheForLayer === 'function') {
            invalidatePreviewCacheForLayer(layer);
          }
          saveCurrentProjectLayers();
          if (typeof redrawComposition === 'function') redrawComposition('setActiveEasing:overlap');
          return;
        }

        const affectedLayers = new Set();
        let didUpdateAnyKf = false;

        function writeKf(kfObj, ownerLayer) {
          if (!kfObj) return;
          kfObj.easing = [...rounded];
          if (clonedCfg) kfObj.easingConfig = cloneEasingConfig(clonedCfg);
          else delete kfObj.easingConfig;
          didUpdateAnyKf = true;
          if (ownerLayer) affectedLayers.add(ownerLayer);
        }

        // Always update the primary resolved keyframe holder (what the Graph Editor is displaying!)
        const resolved = resolveTargetKeyframeHolder();
        if (resolved && resolved.kf) {
          writeKf(resolved.kf, resolved.layer || layer);
        }

        // Also ensure surrounding prevKf at playhead is synced
        const { prevKf } = getSurroundingKeyframes(layer, prop, currentSec);
        if (prevKf) {
          writeKf(prevKf, layer);
        }

        // Also sync any selected keyframes at the playhead or when no surrounding segment exists
        const fps = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
        const tol = Math.max(0.04, 0.5 / fps);
        const relevantSelectedKfs = Array.isArray(window.selectedKeyframes)
          ? window.selectedKeyframes.filter(it => it && it.layerId === window.selectedLayerId && (it.prop === prop || !prop) && (!prevKf || Math.abs(it.time - currentSec) <= tol * 2))
          : [];
        relevantSelectedKfs.forEach(item => {
          const l = item.layer || (currentProjectState.layers || []).find(ly => ly.id === item.layerId) || layer;
          const targetProp = item.prop || prop;
          if (item.kf) writeKf(item.kf, l);
          if (l && l.keyframes && Array.isArray(l.keyframes[targetProp]) && l.keyframes[targetProp].length >= 2) {
            const sorted = [...l.keyframes[targetProp]].sort((a, b) => a.time - b.time);
            let idx = sorted.indexOf(item.kf);
            if (idx === -1 && Number.isFinite(item.time)) {
              idx = sorted.findIndex(k => Math.abs(k.time - item.time) <= tol * 2);
            }
            if (idx !== -1) {
              const segIdx = (idx >= sorted.length - 1) ? Math.max(0, sorted.length - 2) : idx;
              writeKf(sorted[segIdx], l);
            }
          }
        });

        if (didUpdateAnyKf) {
          affectedLayers.forEach(l => {
            if (typeof invalidatePreviewCacheForLayer === 'function') {
              invalidatePreviewCacheForLayer(l);
            }
          });
          saveCurrentProjectLayers();
          if (typeof redrawComposition === 'function') redrawComposition('setActiveEasing:keyframe');
        } else {
          if (!layer.defaultEasing) layer.defaultEasing = {};
          layer.defaultEasing[prop] = rounded;
          layer._defaultEasing = layer.defaultEasing;
          if (!layer.defaultEasingConfig) layer.defaultEasingConfig = {};
          if (clonedCfg) layer.defaultEasingConfig[prop] = cloneEasingConfig(clonedCfg);
          else delete layer.defaultEasingConfig[prop];
          if (typeof invalidatePreviewCacheForLayer === 'function') {
            invalidatePreviewCacheForLayer(layer);
          }
          saveCurrentProjectLayers();
          if (typeof redrawComposition === 'function') redrawComposition('setActiveEasing:defaultEasing');
        }
      }

      function setActiveEasing(newEasing) {
        applyEasingAndConfigToKeyframes(newEasing, null);
      }
      window.setActiveEasing = setActiveEasing;

      function setActiveEasingConfig(newConfig, fallbackEasing) {
        if (!newConfig || newConfig.type === 'value') {
          const eas = (newConfig && Array.isArray(newConfig.easing)) ? newConfig.easing : (fallbackEasing || [0.42, 0.0, 0.58, 1.0]);
          applyEasingAndConfigToKeyframes(eas, null);
          return;
        }
        let eas = fallbackEasing;
        if (newConfig.type === 'speed') {
          eas = speedParamsToBezier(newConfig.outSpeed ?? 0, newConfig.outInfl ?? 33.33, newConfig.inSpeed ?? 0, newConfig.inInfl ?? 33.33);
        } else if (!Array.isArray(eas) || eas.length !== 4) {
          eas = getActiveEasing() || [0.42, 0.0, 0.58, 1.0];
        }
        applyEasingAndConfigToKeyframes(eas, newConfig);
      }
      window.setActiveEasingConfig = setActiveEasingConfig;

      function isConfigMatching(cfgA, easA, cfgB, easB) {
        const tol = 0.05;
        const typeA = (cfgA && cfgA.type) ? cfgA.type : 'value';
        const typeB = (cfgB && cfgB.type) ? cfgB.type : 'value';
        if (typeA !== typeB) return false;
        if (typeA === 'value') {
          if (!Array.isArray(easA) || !Array.isArray(easB)) return false;
          return Math.abs(easA[0] - easB[0]) < tol &&
                 Math.abs(easA[1] - easB[1]) < tol &&
                 Math.abs(easA[2] - easB[2]) < tol &&
                 Math.abs(easA[3] - easB[3]) < tol;
        }
        if (typeA === 'speed') {
          return Math.abs((cfgA.outSpeed || 0) - (cfgB.outSpeed || 0)) < 12 &&
                 Math.abs((cfgA.outInfl || 33) - (cfgB.outInfl || 33)) < 5 &&
                 Math.abs((cfgA.inSpeed || 0) - (cfgB.inSpeed || 0)) < 12 &&
                 Math.abs((cfgA.inInfl || 33) - (cfgB.inInfl || 33)) < 5;
        }
        if (typeA === 'elastic') {
          return Boolean(cfgA.reverse) === Boolean(cfgB.reverse) &&
                 Math.abs((cfgA.stepLength ?? 0.25) - (cfgB.stepLength ?? 0.25)) < tol &&
                 Math.abs((cfgA.decay ?? 0.70) - (cfgB.decay ?? 0.70)) < tol &&
                 Math.abs((cfgA.magnitude ?? 0.25) - (cfgB.magnitude ?? 0.25)) < tol;
        }
        if (typeA === 'bounce') {
          return Boolean(cfgA.reverse) === Boolean(cfgB.reverse) &&
                 Math.abs((cfgA.firstStepLength ?? 0.40) - (cfgB.firstStepLength ?? 0.40)) < tol &&
                 Math.abs((cfgA.bounciness ?? 0.70) - (cfgB.bounciness ?? 0.70)) < tol;
        }
        if (typeA === 'cyclic') {
          return Boolean(cfgA.reverse) === Boolean(cfgB.reverse) &&
                 Math.abs((cfgA.stepLength ?? 0.40) - (cfgB.stepLength ?? 0.40)) < tol &&
                 Math.abs((cfgA.sharpness ?? 0.50) - (cfgB.sharpness ?? 0.50)) < 0.08 &&
                 Math.abs((cfgA.skew ?? 0.50) - (cfgB.skew ?? 0.50)) < tol &&
                 Math.abs((cfgA.decay ?? 0.50) - (cfgB.decay ?? 0.50)) < tol;
        }
        return false;
      }

      function getMatchingPreset(easing, config) {
        const presets = getActiveModePresets();
        return presets.find(p => isConfigMatching(p.config, p.easing, config, easing)) || null;
      }

      let _lastGraphSegmentKey = null;
      let activeDragHandleIndex = null;

      function setElVisible(el, vis) {
        if (!el) return;
        el.style.display = vis ? '' : 'none';
      }

      function updateGraphUI() {
        if (!svgLayer) return;
        const resolved = resolveTargetKeyframeHolder();
        const segLayerId = resolved && resolved.layer ? resolved.layer.id : (window.selectedLayerId || '');
        const segProp = resolved && resolved.prop ? resolved.prop : (window.activeKeyframeProperty || 'move');
        const segTime = (resolved && resolved.kf && Number.isFinite(resolved.kf.time)) ? resolved.kf.time.toFixed(4) : 'none';
        const segKey = `${segLayerId}_${segProp}_${segTime}`;
        const didSegmentChange = (segKey !== _lastGraphSegmentKey);
        _lastGraphSegmentKey = segKey;

        if (didSegmentChange && resolved && resolved.kf && activeDragHandleIndex === null) {
          const kfType = (resolved.kf.easingConfig && resolved.kf.easingConfig.type) ? resolved.kf.easingConfig.type : 'value';
          if (kfType !== activeGraphMode) {
            if (kfType !== 'value' || (activeGraphMode !== 'value' && activeGraphMode !== 'speed')) {
              activeGraphMode = kfType;
              syncModeButtonUI();
              renderDefaultPresetThumbs();
              renderCustomPresetsUI();
            }
          }
        }

        const rawEasing = getActiveEasing();
        const canvasFrame = document.getElementById('graph-canvas-frame');

        if (!rawEasing) {
          if (canvasFrame) canvasFrame.classList.add('is-no-keyframe');
          Object.values(presetBtns).forEach(btn => { if (btn) btn.classList.remove('is-active'); });
          if (customPresetsContainer) {
            customPresetsContainer.querySelectorAll('.graph-preset-btn').forEach(b => b.classList.remove('is-active'));
          }
          if (btnGraphReverse) btnGraphReverse.setAttribute('disabled', 'true');
          if (btnGraphSnap) btnGraphSnap.setAttribute('disabled', 'true');
          if (btnSavePreset) btnSavePreset.setAttribute('disabled', 'true');
        } else {
          if (canvasFrame) canvasFrame.classList.remove('is-no-keyframe');
          if (btnGraphReverse) btnGraphReverse.removeAttribute('disabled');
          if (btnGraphSnap) btnGraphSnap.removeAttribute('disabled');
          if (btnSavePreset) btnSavePreset.removeAttribute('disabled');
        }

        const easing = rawEasing || [0.42, 0.0, 0.58, 1.0];
        const activeConfig = rawEasing
          ? (getActiveEasingConfig() || { type: activeGraphMode, easing })
          : (DEFAULT_MODE_CONFIGS[activeGraphMode] || { type: activeGraphMode, easing });
        const { viewY, viewH } = getCurrentViewBox(easing, activeConfig);
        updateSvgDimensions(viewH);
        const { minX, maxX, yStart, yEnd, rangeY } = getBounds();

        svgLayer.setAttribute('viewBox', `0 ${viewY.toFixed(1)} ${svgW} ${viewH.toFixed(1)}`);

        const zoomRatio = viewH / BASE_SVG_H;
        const isMobile = (typeof window !== 'undefined' && window.innerWidth <= 600);
        const baseHandleRadius = isMobile ? 11.5 : 9.5;
        const handleRadius = (baseHandleRadius * zoomRatio).toFixed(1);
        const hitRadius = (28 * zoomRatio).toFixed(1);
        const tangentWidth = (2.4 * zoomRatio).toFixed(1);
        const anchorRadius = (4.2 * zoomRatio).toFixed(1);
        const curveWidth = (3.0 * zoomRatio).toFixed(1);
        const dashedWidth = (1.4 * zoomRatio).toFixed(1);

        if (dashedRect) {
          dashedRect.setAttribute('x', minX);
          dashedRect.setAttribute('y', yEnd);
          dashedRect.setAttribute('width', maxX - minX);
          dashedRect.setAttribute('height', yStart - yEnd);
          dashedRect.setAttribute('stroke-width', dashedWidth);
        }

        const gridClipRect = document.getElementById('graph-grid-clip-rect');
        if (gridClipRect) {
          const expandClip = (activeGraphMode === 'value' && isGraphOvershootEnabled);
          gridClipRect.setAttribute('x', minX);
          gridClipRect.setAttribute('y', expandClip ? viewY : yEnd);
          gridClipRect.setAttribute('width', maxX - minX);
          gridClipRect.setAttribute('height', expandClip ? viewH : (yStart - yEnd));
        }

        function placeHandle(hEl, hitEl, sx, sy, visible) {
          setElVisible(hEl, visible);
          setElVisible(hitEl, visible);
          if (!visible) return;
          if (hEl) {
            hEl.setAttribute('cx', sx.toFixed(1));
            hEl.setAttribute('cy', sy.toFixed(1));
            hEl.setAttribute('r', handleRadius);
          }
          if (hitEl) {
            hitEl.setAttribute('cx', sx.toFixed(1));
            hitEl.setAttribute('cy', sy.toFixed(1));
            hitEl.setAttribute('r', hitRadius);
          }
        }

        function placeLine(lEl, x1, y1, x2, y2, visible) {
          setElVisible(lEl, visible);
          if (!visible || !lEl) return;
          lEl.setAttribute('x1', x1.toFixed(1));
          lEl.setAttribute('y1', y1.toFixed(1));
          lEl.setAttribute('x2', x2.toFixed(1));
          lEl.setAttribute('y2', y2.toFixed(1));
          lEl.setAttribute('stroke-width', tangentWidth);
        }

        function placeDot(dEl, cx, cy, visible) {
          setElVisible(dEl, visible);
          if (!visible || !dEl) return;
          dEl.setAttribute('cx', cx.toFixed(1));
          dEl.setAttribute('cy', cy.toFixed(1));
          dEl.setAttribute('r', anchorRadius);
        }

        if (activeGraphMode === 'value') {
          setElVisible(speedFillPath, false);
          setElVisible(guidelinePath, false);
          placeDot(stemDot1, 0, 0, false);
          placeDot(stemDot2, 0, 0, false);
          placeHandle(handle3, handle3Hit, 0, 0, false);
          placeHandle(handle4, handle4Hit, 0, 0, false);

          const p1 = bezierToSvg(easing[0], easing[1]);
          const p2 = bezierToSvg(easing[2], easing[3]);

          placeDot(anchorStart, minX, yStart, true);
          placeDot(anchorEnd, maxX, yEnd, true);
          placeLine(tangent1, minX, yStart, p1.sx, p1.sy, true);
          placeLine(tangent2, maxX, yEnd, p2.sx, p2.sy, true);
          placeHandle(handle1, handle1Hit, p1.sx, p1.sy, true);
          placeHandle(handle2, handle2Hit, p2.sx, p2.sy, true);

          if (curvePath) {
            curvePath.setAttribute('d', `M ${minX} ${yStart} C ${p1.sx.toFixed(1)} ${p1.sy.toFixed(1)}, ${p2.sx.toFixed(1)} ${p2.sy.toFixed(1)}, ${maxX} ${yEnd}`);
            curvePath.setAttribute('stroke-width', curveWidth);
          }
        } else if (activeGraphMode === 'speed') {
          setElVisible(guidelinePath, false);
          placeDot(stemDot1, 0, 0, false);
          placeDot(stemDot2, 0, 0, false);
          placeHandle(handle3, handle3Hit, 0, 0, false);
          placeHandle(handle4, handle4Hit, 0, 0, false);

          const spCfg = (activeConfig.type === 'speed') ? activeConfig : { type: 'speed', ...bezierToSpeedParams(easing) };
          const outSpeed = Math.max(0, Math.min(300, Number(spCfg.outSpeed) || 0));
          const outInfl = Math.max(0.5, Math.min(100, Number(spCfg.outInfl) || 33.33));
          const inSpeed = Math.max(0, Math.min(300, Number(spCfg.inSpeed) || 0));
          const inInfl = Math.max(0.5, Math.min(100, Number(spCfg.inInfl) || 33.33));
          const [bx1, by1, bx2, by2] = speedParamsToBezier(outSpeed, outInfl, inSpeed, inInfl);

          // Dynamic auto-scaling matching CEP GraphModule.drawSpeedCurveOnCanvas so extreme spikes never flatten/clip
          const SAMPLES = 150;
          const rawPts = [];
          let peakSpeed = Math.max(outSpeed, inSpeed, 1);
          for (let i = 0; i <= SAMPLES; i++) {
            const s = i / SAMPLES;
            const inv = 1 - s;
            const tx = 3 * inv * inv * s * bx1 + 3 * inv * s * s * bx2 + s * s * s;
            const dxdt = 3 * inv * inv * bx1 + 6 * inv * s * (bx2 - bx1) + 3 * s * s * (1 - bx2);
            const dydt = 3 * inv * inv * by1 + 6 * inv * s * (by2 - by1) + 3 * s * s * (1 - by2);
            const vel = (dxdt < 0.001) ? (s < 0.5 ? outSpeed : inSpeed) : Math.max(0, (dydt / dxdt) * 100);
            if (Math.abs(vel) > peakSpeed) peakSpeed = Math.abs(vel);
            rawPts.push({ t: tx, v: vel });
          }

          const maxSpeed = Math.max(100, peakSpeed * 1.08);
          const graphW = maxX - minX;
          const points = rawPts.map(rp => ({
            x: minX + rp.t * graphW,
            y: yStart - (Math.abs(rp.v) / maxSpeed) * rangeY
          })).sort((a, b) => a.x - b.x);

          // Smooth quadratic curve interpolation matching CEP drawSpeedCurveOnCanvas
          let dCurve = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
          for (let i = 1; i < points.length - 2; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            dCurve += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}, ${xc.toFixed(1)} ${yc.toFixed(1)}`;
          }
          if (points.length > 2) {
            const pen = points[points.length - 2];
            const last = points[points.length - 1];
            dCurve += ` Q ${pen.x.toFixed(1)} ${pen.y.toFixed(1)}, ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
          } else if (points.length === 2) {
            dCurve += ` L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
          }

          if (curvePath) {
            curvePath.setAttribute('d', dCurve);
            curvePath.setAttribute('stroke-width', curveWidth);
          }
          if (speedFillPath) {
            setElVisible(speedFillPath, true);
            speedFillPath.setAttribute('d', `M ${points[0].x.toFixed(1)} ${yStart} L ${dCurve.slice(2)} L ${points[points.length - 1].x.toFixed(1)} ${yStart} Z`);
          }

          // Keep handles on a stable 300 vertical scale during drag or proportional to maxSpeed
          // Speed influence handle reaches maximum at center (50% of width = 100% influence), exactly matching CEP getSpeedPos
          const FIXED_VEL_SCALE = 300;
          const startSy = yStart - (outSpeed / FIXED_VEL_SCALE) * rangeY;
          const endSy = yStart - (inSpeed / FIXED_VEL_SCALE) * rangeY;
          const h1x = minX + graphW * (outInfl / 100) * 0.5;
          const h2x = maxX - graphW * (inInfl / 100) * 0.5;

          placeDot(anchorStart, minX, startSy, true);
          placeDot(anchorEnd, maxX, endSy, true);
          placeLine(tangent1, minX, startSy, h1x, startSy, true);
          placeLine(tangent2, maxX, endSy, h2x, endSy, true);
          placeHandle(handle1, handle1Hit, h1x, startSy, true);
          placeHandle(handle2, handle2Hit, h2x, endSy, true);
        } else if (activeGraphMode === 'elastic') {
          setElVisible(speedFillPath, false);
          placeHandle(handle3, handle3Hit, 0, 0, false);
          placeHandle(handle4, handle4Hit, 0, 0, false);
          placeLine(tangent2, 0, 0, 0, 0, false);
          placeDot(stemDot2, 0, 0, false);

          const cfg = (activeConfig.type === 'elastic') ? activeConfig : DEFAULT_MODE_CONFIGS.elastic;
          const rev = Boolean(cfg.reverse);
          const sL = Math.max(0.06, Math.min(0.95, Number(cfg.stepLength) || 0.35));
          const dcy = Math.max(0.0, Math.min(0.96, Number(cfg.decay !== undefined ? cfg.decay : 0.45)));
          const mag = Math.max(0.0, Math.min(0.95, Number(cfg.magnitude ?? 0.50)));
          const atk = Number(cfg.attack ?? 1.0);

          const SAMPLES = 300;
          let dCurve = '';
          for (let i = 0; i <= SAMPLES; i++) {
            const u = i / SAMPLES;
            const v = evaluateKeyframeEasing(cfg, u, easing);
            const pt = bezierToSvg(u, v);
            dCurve += (i === 0 ? `M ${pt.sx.toFixed(1)} ${pt.sy.toFixed(1)}` : ` L ${pt.sx.toFixed(1)} ${pt.sy.toFixed(1)}`);
          }
          if (curvePath) {
            curvePath.setAttribute('d', dCurve);
            curvePath.setAttribute('stroke-width', curveWidth);
          }

          // CEP ElasticGraphModule exact handle placement:
          // Handle 1 (main): stepLength*(attack+1) on X, decay on Y; stem anchored onto the elastic curve at inHX1
          const inHX1 = Math.max(0.10, Math.min(0.96, sL * (atk + 1.0)));
          const inHY1 = dcy;
          const inCurveY1 = evalElasticEasing(inHX1, sL, dcy, mag);
          const hX1 = rev ? (1.0 - inHX1) : inHX1;
          const hY1 = rev ? (1.0 - inHY1) : inHY1;
          const aX1 = hX1;
          const aY1 = rev ? (1.0 - inCurveY1) : inCurveY1;

          // Handle 2 (magnitude): ceiling knob on border + horizontal guideline across (no vertical stem line)
          const hX2 = rev ? 1.0 : 0.0;
          const hY2 = rev ? (1.0 - (1.0 + mag)) : (1.0 + mag);

          const pMain = bezierToSvg(hX1, hY1);
          const pStemBase = bezierToSvg(aX1, aY1);
          const pMag = bezierToSvg(hX2, hY2);
          const pGuideL = bezierToSvg(0, hY2);
          const pGuideR = bezierToSvg(1, hY2);

          if (guidelinePath) {
            setElVisible(guidelinePath, true);
            guidelinePath.setAttribute('x1', pGuideL.sx.toFixed(1));
            guidelinePath.setAttribute('y1', pGuideL.sy.toFixed(1));
            guidelinePath.setAttribute('x2', pGuideR.sx.toFixed(1));
            guidelinePath.setAttribute('y2', pGuideR.sy.toFixed(1));
            guidelinePath.setAttribute('stroke-width', dashedWidth);
          }

          placeDot(anchorStart, minX, yStart, true);
          placeDot(anchorEnd, maxX, yEnd, true);
          placeLine(tangent1, pStemBase.sx, pStemBase.sy, pMain.sx, pMain.sy, true);
          placeDot(stemDot1, pStemBase.sx, pStemBase.sy, true);
          placeHandle(handle1, handle1Hit, pMain.sx, pMain.sy, true);
          placeHandle(handle2, handle2Hit, pMag.sx, pMag.sy, true);
        } else if (activeGraphMode === 'bounce') {
          setElVisible(speedFillPath, false);
          setElVisible(guidelinePath, false);
          placeHandle(handle2, handle2Hit, 0, 0, false);
          placeHandle(handle3, handle3Hit, 0, 0, false);
          placeHandle(handle4, handle4Hit, 0, 0, false);
          placeLine(tangent2, 0, 0, 0, 0, false);
          placeDot(stemDot2, 0, 0, false);

          const cfg = (activeConfig.type === 'bounce') ? activeConfig : DEFAULT_MODE_CONFIGS.bounce;
          const rev = Boolean(cfg.reverse);
          const fStep = Math.max(0.10, Math.min(0.90, Number(cfg.firstStepLength) || 0.45));
          const bnc = Math.max(0.08, Math.min(0.92, Number(cfg.bounciness) || 0.65));

          const SAMPLES = 300;
          let dCurve = '';
          for (let i = 0; i <= SAMPLES; i++) {
            const u = i / SAMPLES;
            const v = evaluateKeyframeEasing(cfg, u, easing);
            const pt = bezierToSvg(u, v);
            dCurve += (i === 0 ? `M ${pt.sx.toFixed(1)} ${pt.sy.toFixed(1)}` : ` L ${pt.sx.toFixed(1)} ${pt.sy.toFixed(1)}`);
          }
          if (curvePath) {
            curvePath.setAttribute('d', dCurve);
            curvePath.setAttribute('stroke-width', curveWidth);
          }

          // CEP ElasticGraphModule Bounce handle placement:
          // Handle 1 sits directly on the apex of the first rebound arch with stem to first impact floor
          const inHX = (fStep + fStep * bnc) / 2.0;
          const inHY = 1.0 - bnc;
          const inAX = fStep / 2.0;
          const inAY = 0.0;

          const pApex = bezierToSvg(rev ? (1.0 - inHX) : inHX, rev ? (1.0 - inHY) : inHY);
          const pFloor = bezierToSvg(rev ? (1.0 - inAX) : inAX, rev ? (1.0 - inAY) : inAY);

          placeDot(anchorStart, minX, yStart, true);
          placeDot(anchorEnd, maxX, yEnd, true);
          placeLine(tangent1, pFloor.sx, pFloor.sy, pApex.sx, pApex.sy, true);
          placeDot(stemDot1, pFloor.sx, pFloor.sy, true);
          placeHandle(handle1, handle1Hit, pApex.sx, pApex.sy, true);
        } else if (activeGraphMode === 'cyclic') {
          setElVisible(speedFillPath, false);
          setElVisible(guidelinePath, false);
          placeLine(tangent2, 0, 0, 0, 0, false);
          placeDot(stemDot2, 0, 0, false);

          const cfg = (activeConfig.type === 'cyclic') ? activeConfig : DEFAULT_MODE_CONFIGS.cyclic;
          const rev = Boolean(cfg.reverse);
          const sL = Math.max(0.05, Math.min(0.95, Number(cfg.stepLength) || 0.35));
          const skw = Math.max(0.05, Math.min(0.95, Number(cfg.skew ?? 0.50)));
          const shp = Math.max(0.0, Math.min(1.0, Number(cfg.sharpness ?? 0.0)));
          const dcy = Math.max(0.0, Math.min(0.90, Number(cfg.decay ?? 0.0)));

          const SAMPLES = 300;
          let dCurve = '';
          for (let i = 0; i <= SAMPLES; i++) {
            const u = i / SAMPLES;
            const v = evaluateKeyframeEasing(cfg, u, easing);
            const pt = bezierToSvg(u, v);
            dCurve += (i === 0 ? `M ${pt.sx.toFixed(1)} ${pt.sy.toFixed(1)}` : ` L ${pt.sx.toFixed(1)} ${pt.sy.toFixed(1)}`);
          }
          if (curvePath) {
            curvePath.setAttribute('d', dCurve);
            curvePath.setAttribute('stroke-width', curveWidth);
          }

          // CEP ElasticGraphModule Cyclic 4-handle layout:
          // Handle 1 (skew): at first wave peak (skw * sL, 1.0)
          // Handle 2 (sharpness): above wave peak (shp * sL, 1.25), connected by stem to Handle 1
          // Handle 3 (stepLength): at end of first cycle on baseline (sL, 0.0)
          // Handle 4 (decay): on right boundary (1.0, dcy) with no extra vertical line on border
          const inHX_skew = skw * sL;
          const inHY_skew = 1.0;
          const inHX_shp = shp * sL;
          const inHY_shp = 1.25;
          const inHX_step = sL;
          const inHY_step = 0.0;
          const inHX_dcy = 1.0;
          const inHY_dcy = dcy;

          const pSkew = bezierToSvg(rev ? (1.0 - inHX_skew) : inHX_skew, rev ? (1.0 - inHY_skew) : inHY_skew);
          const pSharp = bezierToSvg(rev ? (1.0 - inHX_shp) : inHX_shp, rev ? (1.0 - inHY_shp) : inHY_shp);
          const pStep = bezierToSvg(rev ? (1.0 - inHX_step) : inHX_step, rev ? (1.0 - inHY_step) : inHY_step);
          const pDecay = bezierToSvg(rev ? (1.0 - inHX_dcy) : inHX_dcy, rev ? (1.0 - inHY_dcy) : inHY_dcy);

          placeDot(anchorStart, minX, yStart, true);
          placeDot(anchorEnd, maxX, yEnd, true);
          placeLine(tangent1, pSkew.sx, pSkew.sy, pSharp.sx, pSharp.sy, true);
          placeDot(stemDot1, pSkew.sx, pSkew.sy, true);

          placeHandle(handle1, handle1Hit, pSkew.sx, pSkew.sy, true);
          placeHandle(handle2, handle2Hit, pSharp.sx, pSharp.sy, true);
          placeHandle(handle3, handle3Hit, pStep.sx, pStep.sy, true);
          placeHandle(handle4, handle4Hit, pDecay.sx, pDecay.sy, true);
        }

        if (rawEasing) {
          const matched = getMatchingPreset(easing, activeConfig);
          Object.entries(presetBtns).forEach(([pId, btn]) => {
            if (!btn) return;
            btn.classList.toggle('is-active', !!(matched && matched.id === pId));
          });

          if (customPresetsContainer) {
            const customBtns = customPresetsContainer.querySelectorAll('.graph-preset-btn.is-custom');
            const list = getCustomPresets();
            customBtns.forEach((btn) => {
              const idx = parseInt(btn.dataset.customIdx, 10);
              const item = list[idx];
              if (!item) return;
              const itemCfg = item.config || { type: item.type || 'value', easing: item.easing };
              const isMatch = isConfigMatching(itemCfg, item.easing, activeConfig, easing);
              btn.classList.toggle('is-active', isMatch);
            });
          }
        }

        updatePlayheadTimeLine();
      }
      window.updateGraphEditorUI = updateGraphUI;

      function updatePlayheadTimeLine() {
        if (!timeLine) return;
        const resolved = resolveTargetKeyframeHolder();
        const segLayerId = resolved && resolved.layer ? resolved.layer.id : (window.selectedLayerId || '');
        const segProp = resolved && resolved.prop ? resolved.prop : (window.activeKeyframeProperty || 'move');
        const segTime = (resolved && resolved.kf && Number.isFinite(resolved.kf.time)) ? resolved.kf.time.toFixed(4) : 'none';
        const segKey = `${segLayerId}_${segProp}_${segTime}`;
        if (segKey !== _lastGraphSegmentKey) {
          updateGraphUI();
          return;
        }

        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        const prop = window.activeKeyframeProperty || 'move';
        const pps = window.currentPixelsPerSecond || 80;
        const currentSec = Math.abs(window.timelinePanX || 0) / pps;
        const { prevKf, nextKf } = getSurroundingKeyframes(layer, prop, currentSec);

        const { minX, maxX } = getBounds();
        const { viewY, viewH } = getCurrentViewBox();

        let u = 0;
        if (prevKf && nextKf && nextKf.time > prevKf.time) {
          u = (currentSec - prevKf.time) / (nextKf.time - prevKf.time);
        } else if (resolved && resolved.kf && resolved.nextKf && resolved.nextKf.time > resolved.kf.time) {
          u = (currentSec - resolved.kf.time) / (resolved.nextKf.time - resolved.kf.time);
        } else if (layer) {
          const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
          const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
          if (dur > 0) u = (currentSec - start) / dur;
        }
        u = Math.max(0, Math.min(1, u));

        const timeX = minX + u * (maxX - minX);
        timeLine.setAttribute('x1', timeX.toFixed(1));
        timeLine.setAttribute('x2', timeX.toFixed(1));
        timeLine.setAttribute('y1', (viewY + 4).toFixed(1));
        timeLine.setAttribute('y2', (viewY + viewH - 4).toFixed(1));
      }
      window.updateGraphPlayheadLine = updatePlayheadTimeLine;

      function getCustomPresets() {
        try {
          const raw = localStorage.getItem('fishtool_custom_easing_presets');
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch (_) {}
        if (window.currentProjectState && Array.isArray(window.currentProjectState.customEasingPresets) && window.currentProjectState.customEasingPresets.length > 0) {
          return window.currentProjectState.customEasingPresets;
        }
        return [];
      }

      function saveCustomPresets(list) {
        if (!Array.isArray(list)) return;
        try {
          localStorage.setItem('fishtool_custom_easing_presets', JSON.stringify(list));
        } catch (_) {}
        if (window.FishDatabase && typeof window.FishDatabase.saveCustomEasingPresets === 'function') {
          window.FishDatabase.saveCustomEasingPresets(list).catch(() => {});
        }
        if (window.currentProjectState) {
          window.currentProjectState.customEasingPresets = list;
          if (typeof saveCurrentProjectLayers === 'function') {
            saveCurrentProjectLayers();
          }
        }
      }

      let pendingDeleteCustomIdx = null;
      const popoverDeleteTitle = document.getElementById('popover-graph-delete-title');
      const btnDeleteConfirm = document.getElementById('btn-graph-delete-confirm');
      const btnDeleteCancel = document.getElementById('btn-graph-delete-cancel');

      if (btnDeleteConfirm) {
        btnDeleteConfirm.addEventListener('click', (e) => {
          e.stopPropagation();
          if (pendingDeleteCustomIdx !== null) {
            const currentList = getCustomPresets();
            currentList.splice(pendingDeleteCustomIdx, 1);
            saveCustomPresets(currentList);
            pendingDeleteCustomIdx = null;
            renderCustomPresetsUI();
            updateGraphUI();
          }
          if (window.Popover) window.Popover.close(false);
        });
      }

      if (btnDeleteCancel) {
        btnDeleteCancel.addEventListener('click', (e) => {
          e.stopPropagation();
          pendingDeleteCustomIdx = null;
          if (window.Popover) window.Popover.close(false);
        });
      }

      function requestDeleteCustomPreset(anchorEl, idx, displayName) {
        pendingDeleteCustomIdx = idx;
        if (popoverDeleteTitle) {
          popoverDeleteTitle.textContent = `Delete "${displayName}"?`;
        }
        if (window.Popover) {
          window.Popover.open(anchorEl, 'popover-graph-delete-confirm');
        }
      }

      function easingThumbSVG(p1x, p1y, p2x, p2y) {
        const xs = [0, 1, p1x, p2x], ys = [0, 1, p1y, p2y];
        const overX = xs.some((v) => v < 0 || v > 1);
        const overY = ys.some((v) => v < 0 || v > 1);
        let X, Y;
        if (!overX && !overY) {
          X = (v) => 4 + v * 28;
          Y = (v) => 32 - v * 28;
        } else {
          const lox = Math.min(...xs), hix = Math.max(...xs), px = 0.08 * Math.max(hix - lox, 1);
          const loy = Math.min(...ys), hiy = Math.max(...ys), py = 0.08 * Math.max(hiy - loy, 1);
          X = (v) => 4 + ((v - lox + px) / (hix - lox + 2 * px)) * 28;
          Y = (v) => 32 - ((v - loy + py) / (hiy - loy + 2 * py)) * 28;
        }
        const f = (n) => n.toFixed(1);
        const c1x = f(X(p1x)), c1y = f(Y(p1y)), c2x = f(X(p2x)), c2y = f(Y(p2y));
        const x0 = f(X(0)), x1 = f(X(1)), ya = f(Y(0)), yb = f(Y(1));
        const bx = Math.min(x0, x1), by = Math.min(ya, yb);
        const bw = Math.abs(x1 - x0), bh = Math.abs(ya - yb);
        return `<svg class="preset-thumb-svg" viewBox="0 0 36 36" aria-hidden="true">
              <rect class="preset-thumb-boundary" x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="2"/>
              <line class="preset-thumb-tangent" x1="${x0}" y1="${ya}" x2="${c1x}" y2="${c1y}"/>
              <circle class="preset-thumb-handle" cx="${c1x}" cy="${c1y}" r="2"/>
              <line class="preset-thumb-tangent" x1="${x1}" y1="${yb}" x2="${c2x}" y2="${c2y}"/>
              <circle class="preset-thumb-handle" cx="${c2x}" cy="${c2y}" r="2"/>
              <path class="preset-thumb-curve" d="M ${x0} ${ya} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x1} ${yb}"/>
              <circle class="preset-thumb-dot" cx="${x0}" cy="${ya}" r="2.2"/>
              <circle class="preset-thumb-dot" cx="${x1}" cy="${yb}" r="2.2"/>
            </svg>`;
      }

      function easingConfigThumbSVG(cfg, fallbackEasing) {
        const type = (cfg && cfg.type) ? cfg.type : 'value';
        if (type === 'value') {
          const eas = (cfg && Array.isArray(cfg.easing) && cfg.easing.length === 4) ? cfg.easing : (fallbackEasing || [0.42, 0.0, 0.58, 1.0]);
          return easingThumbSVG(eas[0], eas[1], eas[2], eas[3]);
        }
        if (type === 'speed') {
          const outSpeed = Math.max(0, Math.min(300, Number(cfg.outSpeed) || 0));
          const outInfl = Math.max(0.5, Math.min(100, Number(cfg.outInfl) || 33.33));
          const inSpeed = Math.max(0, Math.min(300, Number(cfg.inSpeed) || 0));
          const inInfl = Math.max(0.5, Math.min(100, Number(cfg.inInfl) || 33.33));
          const [bx1, by1, bx2, by2] = speedParamsToBezier(outSpeed, outInfl, inSpeed, inInfl);
          const N = 60;
          const rawPts = [];
          let peak = Math.max(outSpeed, inSpeed, 1);
          for (let i = 0; i <= N; i++) {
            const s = i / N;
            const inv = 1 - s;
            const tx = 3 * inv * inv * s * bx1 + 3 * inv * s * s * bx2 + s * s * s;
            const dxdt = 3 * inv * inv * bx1 + 6 * inv * s * (bx2 - bx1) + 3 * s * s * (1 - bx2);
            const dydt = 3 * inv * inv * by1 + 6 * inv * s * (by2 - by1) + 3 * s * s * (1 - by2);
            const vel = (dxdt < 0.001) ? (s < 0.5 ? outSpeed : inSpeed) : Math.max(0, (dydt / dxdt) * 100);
            if (Math.abs(vel) > peak) peak = Math.abs(vel);
            rawPts.push({ t: tx, v: vel });
          }
          const maxV = Math.max(100, peak * 1.1);
          const points = rawPts.map(p => ({
            x: 4 + p.t * 28,
            y: 32 - Math.min(1, Math.abs(p.v) / maxV) * 26
          })).sort((a, b) => a.x - b.x);
          let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
          for (let i = 1; i < points.length - 2; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            d += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}, ${xc.toFixed(1)} ${yc.toFixed(1)}`;
          }
          if (points.length > 2) {
            const pen = points[points.length - 2];
            const last = points[points.length - 1];
            d += ` Q ${pen.x.toFixed(1)} ${pen.y.toFixed(1)}, ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
          }
          return `<svg class="preset-thumb-svg" viewBox="0 0 36 36" aria-hidden="true">
              <rect class="preset-thumb-boundary" x="4" y="4" width="28" height="28" rx="2"/>
              <path class="preset-thumb-fill" d="M 4.0 32.0 L ${d.slice(2)} L 32.0 32.0 Z"/>
              <path class="preset-thumb-curve" d="${d}"/>
            </svg>`;
        }
        const N = 120;
        const vals = [];
        let minV = 0;
        let maxV = 1;
        for (let i = 0; i <= N; i++) {
          const u = i / N;
          const v = evaluateKeyframeEasing(cfg, u, fallbackEasing);
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
          vals.push({ u, v });
        }
        const span = Math.max(0.5, maxV - minV);
        const pad = span * 0.08;
        const lo = minV - pad;
        const hi = maxV + pad;
        let d = '';
        vals.forEach((p, idx) => {
          const sx = (4 + p.u * 28).toFixed(1);
          const sy = (32 - ((p.v - lo) / (hi - lo)) * 28).toFixed(1);
          d += (idx === 0 ? `M ${sx} ${sy}` : ` L ${sx} ${sy}`);
        });
        return `<svg class="preset-thumb-svg" viewBox="0 0 36 36" aria-hidden="true">
            <rect class="preset-thumb-boundary" x="4" y="4" width="28" height="28" rx="2"/>
            <path class="preset-thumb-curve" d="${d}"/>
          </svg>`;
      }

      function renderCustomPresetsUI() {
        if (!customPresetsContainer) return;
        customPresetsContainer.innerHTML = '';
        const list = getCustomPresets();
        const activeEasing = getActiveEasing();
        const activeConfig = getActiveEasingConfig();

        list.forEach((item, idx) => {
          if (!item || !Array.isArray(item.easing) || item.easing.length !== 4) return;
          const itemType = (item.config && item.config.type) ? item.config.type : (item.type || 'value');
          if (itemType !== activeGraphMode) return;
          const itemCfg = item.config || { type: itemType, easing: item.easing };

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'graph-preset-btn is-custom';
          btn.dataset.customIdx = String(idx);
          const displayName = item.name || `Curve ${idx + 1}`;
          btn.title = `${displayName} (Click to apply, right-click to delete)`;
          btn.setAttribute('aria-label', displayName);

          const isMatched = activeEasing && isConfigMatching(itemCfg, item.easing, activeConfig, activeEasing);
          if (isMatched) btn.classList.add('is-active');

          btn.innerHTML = `
            ${easingConfigThumbSVG(itemCfg, item.easing)}
            <button type="button" class="graph-preset-delete-btn" title="Delete preset" aria-label="Delete preset">
              <i class='fticon fticon-close-3' aria-hidden='true'></i>
            </button>
          `;

          const deleteBtn = btn.querySelector('.graph-preset-delete-btn');
          if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              e.preventDefault();
              requestDeleteCustomPreset(deleteBtn, idx, displayName);
            });
          }

          let holdTimer = null;
          let holdStartX = 0;
          let holdStartY = 0;
          let holdTriggered = false;

          btn.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.graph-preset-delete-btn')) return;
            holdTriggered = false;
            holdStartX = e.clientX;
            holdStartY = e.clientY;
            holdTimer = setTimeout(() => {
              holdTriggered = true;
              if (navigator.vibrate) navigator.vibrate(40);
              requestDeleteCustomPreset(btn, idx, displayName);
            }, 550);
          });

          btn.addEventListener('pointermove', (e) => {
            if (!holdTimer) return;
            if (Math.hypot(e.clientX - holdStartX, e.clientY - holdStartY) > 10) {
              clearTimeout(holdTimer);
              holdTimer = null;
            }
          });

          btn.addEventListener('pointerup', () => {
            if (holdTimer) {
              clearTimeout(holdTimer);
              holdTimer = null;
            }
          });

          btn.addEventListener('pointercancel', () => {
            if (holdTimer) {
              clearTimeout(holdTimer);
              holdTimer = null;
            }
          });

          btn.addEventListener('click', (e) => {
            if (holdTriggered) {
              e.stopPropagation();
              e.preventDefault();
              holdTriggered = false;
              return;
            }
            e.stopPropagation();
            applyEasingPreset(item.easing, itemCfg);
          });

          btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            requestDeleteCustomPreset(btn, idx, displayName);
          });

          customPresetsContainer.appendChild(btn);
        });
      }

      if (btnGraphMode) {
        btnGraphMode.addEventListener('click', (e) => {
          e.stopPropagation();
          syncModeButtonUI();
          if (window.Popover) {
            window.Popover.open(btnGraphMode, 'popover-graph-mode');
          }
        });
      }

      if (popoverGraphMode) {
        popoverGraphMode.querySelectorAll('[data-graph-mode], .graph-mode-menu-item').forEach(itemBtn => {
          itemBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const chosenMode = itemBtn.getAttribute('data-graph-mode');
            if (!chosenMode) return;
            activeGraphMode = chosenMode;
            syncModeButtonUI();

            const curEasing = getActiveEasing();
            if (curEasing) {
              if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
                window.UndoRedoManager.recordSnapshot();
              }
              if (chosenMode === 'value') {
                setActiveEasingConfig({ type: 'value', easing: [...curEasing] }, curEasing);
              } else if (chosenMode === 'speed') {
                const sp = bezierToSpeedParams(curEasing);
                const newEas = speedParamsToBezier(sp.outSpeed, sp.outInfl, sp.inSpeed, sp.inInfl);
                setActiveEasingConfig({ type: 'speed', ...sp, easing: newEas }, newEas);
              } else {
                const existingCfg = getActiveEasingConfig();
                const cfgToUse = (existingCfg && existingCfg.type === chosenMode)
                  ? cloneEasingConfig(existingCfg)
                  : cloneEasingConfig(DEFAULT_MODE_CONFIGS[chosenMode]);
                setActiveEasingConfig(cfgToUse, curEasing);
              }
              if (typeof saveCurrentProjectLayers === 'function') {
                saveCurrentProjectLayers(true);
              }
            }

            renderDefaultPresetThumbs();
            renderCustomPresetsUI();
            updateGraphUI();
            if (window.Popover) window.Popover.close(false);
          });
        });
      }

      if (btnGraphReverse) {
        btnGraphReverse.addEventListener('click', (e) => {
          e.stopPropagation();
          const easing = getActiveEasing();
          if (!easing) return;
          if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
            window.UndoRedoManager.recordSnapshot();
          }
          const cfg = getActiveEasingConfig() || { type: activeGraphMode, easing };
          if (activeGraphMode === 'value') {
            const reversed = [
              Number((1 - easing[2]).toFixed(3)),
              Number((1 - easing[3]).toFixed(3)),
              Number((1 - easing[0]).toFixed(3)),
              Number((1 - easing[1]).toFixed(3))
            ];
            setActiveEasing(reversed);
          } else if (activeGraphMode === 'speed') {
            const sp = (cfg.type === 'speed') ? cfg : bezierToSpeedParams(easing);
            const nextCfg = {
              type: 'speed',
              outSpeed: sp.inSpeed ?? 0,
              outInfl: sp.inInfl ?? 33.33,
              inSpeed: sp.outSpeed ?? 0,
              inInfl: sp.outInfl ?? 33.33
            };
            const revEas = speedParamsToBezier(nextCfg.outSpeed, nextCfg.outInfl, nextCfg.inSpeed, nextCfg.inInfl);
            setActiveEasingConfig(nextCfg, revEas);
          } else {
            const baseCfg = (cfg.type === activeGraphMode) ? cloneEasingConfig(cfg) : cloneEasingConfig(DEFAULT_MODE_CONFIGS[activeGraphMode]);
            baseCfg.reverse = !baseCfg.reverse;
            setActiveEasingConfig(baseCfg, easing);
          }
          updateGraphUI();
          if (typeof saveCurrentProjectLayers === 'function') {
            saveCurrentProjectLayers(true);
          }
        });
      }

      if (btnGraphMore) {
        btnGraphMore.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.Popover) {
            window.Popover.open(btnGraphMore, 'popover-graph-more');
          }
        });
      }

      function applyEasingPreset(presetEasing, presetConfig) {
        const easing = getActiveEasing();
        if (!easing) return;
        if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
          window.UndoRedoManager.recordSnapshot();
        }
        if (presetConfig && presetConfig.type && presetConfig.type !== 'value') {
          setActiveEasingConfig(cloneEasingConfig(presetConfig), presetEasing);
        } else {
          setActiveEasing(presetEasing);
        }
        updateGraphUI();
        if (typeof saveCurrentProjectLayers === 'function') {
          saveCurrentProjectLayers(true);
        }
        if (window.Popover) window.Popover.close();
      }

      Object.entries(presetBtns).forEach(([pId, btn]) => {
        if (!btn) return;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const presets = getActiveModePresets();
          const target = presets.find(p => p.id === pId);
          if (target) applyEasingPreset(target.easing, target.config);
        });
      });

      function renderDefaultPresetThumbs() {
        const presets = getActiveModePresets();
        Object.entries(presetBtns).forEach(([pId, btn]) => {
          if (!btn) return;
          const target = presets.find(p => p.id === pId);
          if (!target) return;
          btn.title = target.name;
          btn.setAttribute('aria-label', target.name);
          btn.innerHTML = easingConfigThumbSVG(target.config, target.easing);
        });
      }
      syncModeButtonUI();
      renderDefaultPresetThumbs();

      if (btnSavePreset) {
        btnSavePreset.addEventListener('click', (e) => {
          e.stopPropagation();
          const easing = getActiveEasing();
          if (!easing) return;
          const cfg = getActiveEasingConfig();
          const list = getCustomPresets();
          const defaultName = `Curve ${list.length + 1}`;
          const savedEasing = [
            Number(easing[0].toFixed(3)),
            Number(easing[1].toFixed(3)),
            Number(easing[2].toFixed(3)),
            Number(easing[3].toFixed(3))
          ];
          list.push({
            name: defaultName,
            type: activeGraphMode,
            easing: savedEasing,
            config: cfg ? cloneEasingConfig(cfg) : { type: activeGraphMode, easing: savedEasing }
          });
          saveCustomPresets(list);
          renderCustomPresetsUI();
          updateGraphUI();
          if (presetsCol) {
            setTimeout(() => {
              const isRow = (typeof window !== 'undefined' && window.getComputedStyle(presetsCol).flexDirection === 'row');
              if (isRow) {
                presetsCol.scrollTo({ left: presetsCol.scrollWidth, behavior: 'smooth' });
              } else {
                presetsCol.scrollTo({ top: presetsCol.scrollHeight, behavior: 'smooth' });
              }
            }, 40);
          }
        });
      }

      if (btnToggleOvershoot) {
        btnToggleOvershoot.addEventListener('click', (e) => {
          e.stopPropagation();
          isGraphOvershootEnabled = !isGraphOvershootEnabled;
          if (chkOvershoot) chkOvershoot.classList.toggle('is-checked', isGraphOvershootEnabled);
          if (svgChkOvershoot) svgChkOvershoot.style.display = isGraphOvershootEnabled ? '' : 'none';
          if (graphFrame) graphFrame.classList.toggle('is-overshoot', isGraphOvershootEnabled);
          updateGraphUI();
          if (window.Popover) window.Popover.close(false);
        });
      }

      function serializeGraphForClipboard(easing, cfg) {
        const type = (cfg && cfg.type) ? cfg.type : 'value';
        if (type === 'elastic') {
          const rev = cfg.reverse ? 'reverse ' : '';
          return `${rev}elastic ${Number(cfg.stepLength ?? 0.25).toFixed(2)} ${Number(cfg.attack ?? 1.0).toFixed(2)} ${Number(cfg.decay ?? 0.70).toFixed(2)} ${Number(cfg.magnitude ?? 0.25).toFixed(2)}`;
        }
        if (type === 'bounce') {
          const rev = cfg.reverse ? 'reverse ' : '';
          return `${rev}bounce ${Number(cfg.firstStepLength ?? 0.40).toFixed(2)} ${Number(cfg.bounciness ?? 0.70).toFixed(2)}`;
        }
        if (type === 'cyclic') {
          const rev = cfg.reverse ? 'reverse ' : '';
          return `${rev}cyclic ${Number(cfg.stepLength ?? 0.40).toFixed(2)} ${Number(cfg.sharpness ?? 0.50).toFixed(2)} ${Number(cfg.skew ?? 0.50).toFixed(2)} ${Number(cfg.decay ?? 0.50).toFixed(2)}`;
        }
        if (type === 'speed') {
          return JSON.stringify({
            type: 'speed',
            outSpeed: Number((cfg.outSpeed ?? 0).toFixed(2)),
            outInfl: Number((cfg.outInfl ?? 33.33).toFixed(2)),
            inSpeed: Number((cfg.inSpeed ?? 0).toFixed(2)),
            inInfl: Number((cfg.inInfl ?? 33.33).toFixed(2)),
            easing
          });
        }
        return JSON.stringify(easing);
      }

      function parseClipboardGraphString(rawText) {
        if (!rawText || typeof rawText !== 'string') return null;
        const text = rawText.trim();
        if (!text) return null;

        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed) && parsed.length === 4 && parsed.every(n => Number.isFinite(Number(n)))) {
            const eas = parsed.map(n => Number(Number(n).toFixed(3)));
            return { easing: eas, config: { type: 'value', easing: eas } };
          }
          if (parsed && typeof parsed === 'object' && parsed.type) {
            const eas = Array.isArray(parsed.easing) && parsed.easing.length === 4
              ? parsed.easing.map(n => Number(Number(n).toFixed(3)))
              : [0.42, 0.0, 0.58, 1.0];
            return { easing: eas, config: cloneEasingConfig(parsed) };
          }
        } catch (_) {}

        const elasticMatch = text.match(/^(reverse\s+)?elastic\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)$/i);
        if (elasticMatch) {
          return {
            easing: [0.15, 1.45, 0.35, 1.0],
            config: {
              type: 'elastic',
              reverse: Boolean(elasticMatch[1]),
              stepLength: parseFloat(elasticMatch[2]),
              attack: parseFloat(elasticMatch[3]),
              decay: parseFloat(elasticMatch[4]),
              magnitude: parseFloat(elasticMatch[5])
            }
          };
        }

        const bounceMatch = text.match(/^(reverse\s+)?bounce\s+([\d.-]+)\s+([\d.-]+)$/i);
        if (bounceMatch) {
          return {
            easing: [0.25, 1.0, 0.5, 1.0],
            config: {
              type: 'bounce',
              reverse: Boolean(bounceMatch[1]),
              firstStepLength: parseFloat(bounceMatch[2]),
              bounciness: parseFloat(bounceMatch[3])
            }
          };
        }

        const cyclicMatch = text.match(/^(reverse\s+)?cyclic\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)$/i);
        if (cyclicMatch) {
          return {
            easing: [0.42, 0.0, 0.58, 1.0],
            config: {
              type: 'cyclic',
              reverse: Boolean(cyclicMatch[1]),
              stepLength: parseFloat(cyclicMatch[2]),
              sharpness: parseFloat(cyclicMatch[3]),
              skew: parseFloat(cyclicMatch[4]),
              decay: parseFloat(cyclicMatch[5])
            }
          };
        }

        const cepPairMatch = text.match(/^([\d.-]+)\s*,\s*([\d.-]+)\s*;\s*([\d.-]+)\s*,\s*([\d.-]+)$/);
        if (cepPairMatch) {
          const a = parseFloat(cepPairMatch[1]);
          const b = parseFloat(cepPairMatch[2]);
          const c = parseFloat(cepPairMatch[3]);
          const d = parseFloat(cepPairMatch[4]);
          if (b > 1.5 || d > 1.5) {
            const inSpeed = a, inInfl = b, outSpeed = c, outInfl = d;
            const eas = speedParamsToBezier(outSpeed, outInfl, inSpeed, inInfl);
            return {
              easing: eas,
              config: { type: 'speed', outSpeed, outInfl, inSpeed, inInfl, easing: eas }
            };
          }
          const eas = [Number(a.toFixed(3)), Number(b.toFixed(3)), Number(c.toFixed(3)), Number(d.toFixed(3))];
          return { easing: eas, config: { type: 'value', easing: eas } };
        }

        return null;
      }

      // Copy Graph Curve
      if (btnGraphCopy) {
        btnGraphCopy.addEventListener('click', (e) => {
          e.stopPropagation();
          const currentEasing = getActiveEasing();
          if (!currentEasing) return;
          const currentConfig = getActiveEasingConfig();
          const rounded = [
            Number(currentEasing[0].toFixed(3)),
            Number(currentEasing[1].toFixed(3)),
            Number(currentEasing[2].toFixed(3)),
            Number(currentEasing[3].toFixed(3))
          ];
          window._copiedGraphEasing = [...rounded];
          window._copiedGraphEasingConfig = currentConfig ? cloneEasingConfig(currentConfig) : { type: 'value', easing: [...rounded] };
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              const clipText = serializeGraphForClipboard(rounded, window._copiedGraphEasingConfig);
              navigator.clipboard.writeText(clipText).catch(() => {});
            }
          } catch (_) {}
          if (window.Popover) window.Popover.close(false);
          if (navigator.vibrate) try { navigator.vibrate(30); } catch (_) {}
          if (typeof showEffectsRackToast === 'function') {
            showEffectsRackToast('Graph curve copied');
          }
        });
      }

      function applyPastedGraphPayload(payload) {
        if (!payload || !payload.easing) return false;
        if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
          window.UndoRedoManager.recordSnapshot();
        }
        const cfg = payload.config || { type: 'value', easing: payload.easing };
        if (cfg.type && cfg.type !== activeGraphMode) {
          activeGraphMode = cfg.type;
          syncModeButtonUI();
          renderDefaultPresetThumbs();
          renderCustomPresetsUI();
        }
        setActiveEasingConfig(cfg, payload.easing);
        saveCurrentProjectLayers(true);
        updateGraphUI();
        if (typeof redrawComposition === 'function') {
          redrawComposition('paste-easing');
        }
        if (window.Popover) window.Popover.close(false);
        if (navigator.vibrate) try { navigator.vibrate(30); } catch (_) {}
        if (typeof showEffectsRackToast === 'function') {
          showEffectsRackToast('Graph curve pasted');
        }
        return true;
      }

      // Paste Graph Curve
      if (btnGraphPaste) {
        btnGraphPaste.addEventListener('click', async (e) => {
          e.stopPropagation();
          let payload = null;
          try {
            if (navigator.clipboard && navigator.clipboard.readText) {
              const clipText = await navigator.clipboard.readText();
              payload = parseClipboardGraphString(clipText);
            }
          } catch (_) {}

          if (!payload && window._copiedGraphEasing && Array.isArray(window._copiedGraphEasing) && window._copiedGraphEasing.length === 4) {
            payload = {
              easing: [...window._copiedGraphEasing],
              config: window._copiedGraphEasingConfig ? cloneEasingConfig(window._copiedGraphEasingConfig) : { type: 'value', easing: [...window._copiedGraphEasing] }
            };
          }

          if (!payload) {
            if (window.Popover) window.Popover.close(false);
            if (typeof showEffectsRackToast === 'function') {
              showEffectsRackToast('No curve copied');
            }
            return;
          }
          applyPastedGraphPayload(payload);
        });
      }

      // Paste to all keyframes
      if (btnCopyToAll) {
        btnCopyToAll.addEventListener('click', (e) => {
          e.stopPropagation();
          const sourceEasing = (window._copiedGraphEasing && Array.isArray(window._copiedGraphEasing) && window._copiedGraphEasing.length === 4)
            ? window._copiedGraphEasing
            : getActiveEasing();
          if (!sourceEasing) return;
          const sourceCfg = window._copiedGraphEasingConfig
            ? cloneEasingConfig(window._copiedGraphEasingConfig)
            : getActiveEasingConfig();

          if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
            window.UndoRedoManager.recordSnapshot();
          }
          const rounded = [
            Number(sourceEasing[0].toFixed(3)),
            Number(sourceEasing[1].toFixed(3)),
            Number(sourceEasing[2].toFixed(3)),
            Number(sourceEasing[3].toFixed(3))
          ];
          const clonedCfg = (sourceCfg && sourceCfg.type && sourceCfg.type !== 'value')
            ? cloneEasingConfig({ ...sourceCfg, easing: [...rounded] })
            : null;

          const prop = window.activeKeyframeProperty || 'move';
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          const targetLayers = (window.selectedLayerIds && window.selectedLayerIds.size > 0)
            ? (currentProjectState.layers || []).filter(l => window.selectedLayerIds.has(l.id))
            : (layer ? [layer] : []);

          targetLayers.forEach(tgtL => {
            if (tgtL.keyframes) {
              if (Array.isArray(tgtL.keyframes[prop])) {
                tgtL.keyframes[prop].forEach(kf => {
                  kf.easing = [...rounded];
                  if (clonedCfg) kf.easingConfig = cloneEasingConfig(clonedCfg);
                  else delete kf.easingConfig;
                });
              }
              if (prop.includes(':')) {
                const parts = prop.split(':');
                const rawParam = parts[1];
                if (rawParam && Array.isArray(tgtL.keyframes[rawParam])) {
                  tgtL.keyframes[rawParam].forEach(kf => {
                    kf.easing = [...rounded];
                    if (clonedCfg) kf.easingConfig = cloneEasingConfig(clonedCfg);
                    else delete kf.easingConfig;
                  });
                }
              }
            }
            if (typeof invalidatePreviewCacheForLayer === 'function') {
              invalidatePreviewCacheForLayer(tgtL);
            }
          });

          if (Array.isArray(window.selectedKeyframes)) {
            window.selectedKeyframes.forEach(item => {
              if (item.prop === prop && item.kf) {
                item.kf.easing = [...rounded];
                if (clonedCfg) item.kf.easingConfig = cloneEasingConfig(clonedCfg);
                else delete item.kf.easingConfig;
              }
            });
          }

          saveCurrentProjectLayers(true);
          updateGraphUI();
          if (typeof redrawComposition === 'function') {
            redrawComposition('paste-easing-to-all-keyframes');
          }
          if (window.Popover) window.Popover.close(false);
          if (navigator.vibrate) try { navigator.vibrate(30); } catch (_) {}
          if (typeof showEffectsRackToast === 'function') {
            showEffectsRackToast('Pasted to all keyframes');
          }
        });
      }

      const handleMap = {
        1: { el: handle1, hit: handle1Hit },
        2: { el: handle2, hit: handle2Hit },
        3: { el: handle3, hit: handle3Hit },
        4: { el: handle4, hit: handle4Hit }
      };

      function startHandleDrag(handleIndex, e) {
        if (activeDragHandleIndex !== null) return;
        const eas = getActiveEasing();
        if (!eas) return;
        activeDragHandleIndex = handleIndex;

        if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
          window.UndoRedoManager.recordSnapshot();
        }
        const pair = handleMap[handleIndex] || handleMap[1];
        const handleEl = pair.el;
        const hitEl = pair.hit;
        const captureTarget = graphFrame || svgLayer || handleEl;
        try { captureTarget.setPointerCapture(e.pointerId); } catch (_) {}
        if (handleEl) handleEl.classList.add('is-dragging');
        if (hitEl) hitEl.classList.add('is-dragging');
        window.isTransformInteracting = true;
        const curLayer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (curLayer && typeof invalidatePreviewCacheForLayer === 'function') {
          invalidatePreviewCacheForLayer(curLayer);
        }

        let isDragging = true;
        let currentEasing = [...eas];
        const initCfg = getActiveEasingConfig();
        let currentCfg = (initCfg && initCfg.type === activeGraphMode)
          ? cloneEasingConfig(initCfg)
          : cloneEasingConfig(DEFAULT_MODE_CONFIGS[activeGraphMode] || { type: 'value', easing: currentEasing });

        if (activeGraphMode === 'speed' && (!initCfg || initCfg.type !== 'speed')) {
          currentCfg = { type: 'speed', ...bezierToSpeedParams(currentEasing), easing: [...currentEasing] };
        }

        // Lock the viewBox during drag so pointer-to-normalized coordinate conversion never shifts under the cursor
        lockedDragViewBox = null;
        lockedDragViewBox = { ...getCurrentViewBox(currentEasing, currentCfg) };
        updateSvgDimensions(lockedDragViewBox.viewH);

        function clientToNorm(clientX, clientY) {
          const svgRect = (svgLayer || graphFrame).getBoundingClientRect();
          const rW = (svgRect.width > 0) ? svgRect.width : 260;
          const rH = (svgRect.height > 0) ? svgRect.height : 170;
          const vb = lockedDragViewBox || getCurrentViewBox(currentEasing, currentCfg);
          const { minX, maxX, yStart, rangeY } = getBounds();
          const svgX = ((clientX - svgRect.left) / rW) * svgW;
          const svgY = vb.viewY + ((clientY - svgRect.top) / rH) * vb.viewH;
          const nx = (svgX - minX) / Math.max(1, maxX - minX);
          const ny = (yStart - svgY) / Math.max(1, rangeY);
          return { nx, ny, svgRect };
        }

        const { minX: bMinX, maxX: bMaxX, yStart: bYStart, rangeY: bRangeY } = getBounds();
        const initCx = handleEl ? parseFloat(handleEl.getAttribute('cx')) : bMinX;
        const initCy = handleEl ? parseFloat(handleEl.getAttribute('cy')) : bYStart;
        const initHandleNx = Number.isFinite(initCx) ? (initCx - bMinX) / Math.max(1, bMaxX - bMinX) : 0;
        const initHandleNy = Number.isFinite(initCy) ? (bYStart - initCy) / Math.max(1, bRangeY) : 0;
        const startPt = clientToNorm(e.clientX, e.clientY);
        const grabOffsetNx = initHandleNx - startPt.nx;
        const grabOffsetNy = initHandleNy - startPt.ny;

        const bxIdx = (handleIndex === 1) ? 0 : 2;
        const byIdx = (handleIndex === 1) ? 1 : 3;

        function onPointerMove(ev) {
          if (!isDragging) return;

          const pt = clientToNorm(ev.clientX, ev.clientY);
          const targetNx = pt.nx + grabOffsetNx;
          const targetNy = pt.ny + grabOffsetNy;

          if (activeGraphMode === 'value') {
            let finalBx = Math.max(0, Math.min(1, targetNx));
            let finalBy = isGraphOvershootEnabled
              ? Math.max(-2.0, Math.min(2.0, targetNy))
              : Math.max(0, Math.min(1, targetNy));

            if (isGraphSnapEnabled) {
              const SNAP_STEP = 0.05;
              finalBx = Math.round(finalBx / SNAP_STEP) * SNAP_STEP;
              finalBy = Math.round(finalBy / SNAP_STEP) * SNAP_STEP;
            }
            currentEasing[bxIdx] = Number(finalBx.toFixed(3));
            currentEasing[byIdx] = Number(finalBy.toFixed(3));

            setActiveEasing(currentEasing);
            updateGraphUI();
          } else if (activeGraphMode === 'speed') {
            const FIXED_VEL_SCALE = 300;
            if (handleIndex === 1) {
              // 50% width = 100% influence, matching CEP ((mx - padX) / graphW) * 200
              let outInfl = Math.max(1.0, Math.min(100, targetNx * 200));
              let outSpeed = Math.max(0, Math.min(300, targetNy * FIXED_VEL_SCALE));
              if (outSpeed < 8) outSpeed = 0;
              if (isGraphSnapEnabled) {
                outInfl = Math.round(outInfl / 5) * 5;
                outSpeed = Math.round(outSpeed / 15) * 15;
              }
              currentCfg.outInfl = Number(outInfl.toFixed(2));
              currentCfg.outSpeed = Number(outSpeed.toFixed(2));
            } else {
              // 50% width = 100% influence, matching CEP ((graphW - mx) / graphW) * 200
              let inInfl = Math.max(1.0, Math.min(100, (1.0 - targetNx) * 200));
              let inSpeed = Math.max(0, Math.min(300, targetNy * FIXED_VEL_SCALE));
              if (inSpeed < 8) inSpeed = 0;
              if (isGraphSnapEnabled) {
                inInfl = Math.round(inInfl / 5) * 5;
                inSpeed = Math.round(inSpeed / 15) * 15;
              }
              currentCfg.inInfl = Number(inInfl.toFixed(2));
              currentCfg.inSpeed = Number(inSpeed.toFixed(2));
            }
            currentEasing = speedParamsToBezier(currentCfg.outSpeed, currentCfg.outInfl, currentCfg.inSpeed, currentCfg.inInfl);
            currentCfg.easing = [...currentEasing];
            setActiveEasingConfig(currentCfg, currentEasing);
            updateGraphUI();
          } else if (activeGraphMode === 'elastic') {
            const rev = Boolean(currentCfg.reverse);
            const inNx = rev ? (1.0 - targetNx) : targetNx;
            const inNy = rev ? (1.0 - targetNy) : targetNy;
            if (handleIndex === 1) {
              const atk = Number(currentCfg.attack ?? 1.0);
              let stepVal = Math.max(0.08, Math.min(0.95, inNx / (atk + 1.0)));
              let decayVal = Math.max(0.0, Math.min(0.95, inNy));
              if (isGraphSnapEnabled) {
                stepVal = Math.round(stepVal / 0.05) * 0.05;
                decayVal = Math.round(decayVal / 0.05) * 0.05;
              }
              currentCfg.stepLength = Number(stepVal.toFixed(3));
              currentCfg.decay = Number(decayVal.toFixed(3));
            } else if (handleIndex === 2) {
              let magVal = Math.max(0.0, Math.min(0.95, inNy - 1.0));
              if (isGraphSnapEnabled) {
                magVal = Math.round(magVal / 0.05) * 0.05;
              }
              currentCfg.magnitude = Number(magVal.toFixed(3));
            }
            setActiveEasingConfig(currentCfg, currentEasing);
            updateGraphUI();
          } else if (activeGraphMode === 'bounce') {
            const rev = Boolean(currentCfg.reverse);
            const inNx = rev ? (1.0 - targetNx) : targetNx;
            const inNy = rev ? (1.0 - targetNy) : targetNy;
            let bVal = Math.max(0.10, Math.min(0.92, 1.0 - inNy));
            let fsVal = Math.max(0.10, Math.min(0.90, (inNx * 2.0) / (1.0 + bVal)));
            if (isGraphSnapEnabled) {
              bVal = Math.round(bVal / 0.05) * 0.05;
              fsVal = Math.round(fsVal / 0.05) * 0.05;
            }
            currentCfg.bounciness = Number(bVal.toFixed(3));
            currentCfg.firstStepLength = Number(fsVal.toFixed(3));
            setActiveEasingConfig(currentCfg, currentEasing);
            updateGraphUI();
          } else if (activeGraphMode === 'cyclic') {
            const rev = Boolean(currentCfg.reverse);
            const inNx = rev ? (1.0 - targetNx) : targetNx;
            const inNy = rev ? (1.0 - targetNy) : targetNy;
            const sL = Math.max(0.05, Math.min(0.95, Number(currentCfg.stepLength) || 0.35));
            if (handleIndex === 1) {
              let skVal = Math.max(0.05, Math.min(0.95, inNx / sL));
              if (isGraphSnapEnabled) skVal = Math.round(skVal / 0.05) * 0.05;
              currentCfg.skew = Number(skVal.toFixed(3));
            } else if (handleIndex === 2) {
              let shVal = Math.max(0.0, Math.min(1.0, inNx / sL));
              if (isGraphSnapEnabled) shVal = Math.round(shVal / 0.05) * 0.05;
              currentCfg.sharpness = Number(shVal.toFixed(3));
            } else if (handleIndex === 3) {
              let stVal = Math.max(0.05, Math.min(0.95, inNx));
              if (isGraphSnapEnabled) stVal = Math.round(stVal / 0.05) * 0.05;
              currentCfg.stepLength = Number(stVal.toFixed(3));
            } else if (handleIndex === 4) {
              let dcVal = Math.max(0.0, Math.min(0.90, inNy));
              if (isGraphSnapEnabled) dcVal = Math.round(dcVal / 0.05) * 0.05;
              currentCfg.decay = Number(dcVal.toFixed(3));
            }
            setActiveEasingConfig(currentCfg, currentEasing);
            updateGraphUI();
          }
        }

        function onPointerUp(ev) {
          if (!isDragging) return;
          isDragging = false;
          activeDragHandleIndex = null;
          lockedDragViewBox = null;
          window.isTransformInteracting = false;
          try { captureTarget.releasePointerCapture(ev.pointerId); } catch (_) {}
          if (handleEl) handleEl.classList.remove('is-dragging');
          if (hitEl) hitEl.classList.remove('is-dragging');
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          window.removeEventListener('pointercancel', onPointerUp);
          updateGraphUI();
          const curLayer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (curLayer && typeof invalidatePreviewCacheForLayer === 'function') {
            invalidatePreviewCacheForLayer(curLayer);
          }
          if (typeof saveCurrentProjectLayers === 'function') {
            saveCurrentProjectLayers(true);
          }
          if (typeof redrawComposition === 'function') {
            redrawComposition('graph-handle-pointerup');
          }
        }

        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', onPointerUp, { passive: false });
        window.addEventListener('pointercancel', onPointerUp, { passive: false });
      }

      function attachHandlePointerDown(el, idx) {
        if (!el) return;
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          startHandleDrag(idx, e);
        });
      }

      attachHandlePointerDown(handle1, 1);
      attachHandlePointerDown(handle1Hit, 1);
      attachHandlePointerDown(handle2, 2);
      attachHandlePointerDown(handle2Hit, 2);
      attachHandlePointerDown(handle3, 3);
      attachHandlePointerDown(handle3Hit, 3);
      attachHandlePointerDown(handle4, 4);
      attachHandlePointerDown(handle4Hit, 4);

      if (svgLayer) {
        svgLayer.addEventListener('pointerdown', (e) => {
          if (activeDragHandleIndex !== null) return;
          const candidates = [
            { idx: 1, el: handle1 },
            { idx: 2, el: handle2 },
            { idx: 3, el: handle3 },
            { idx: 4, el: handle4 }
          ].filter(item => item.el && item.el.style.display !== 'none');
          if (candidates.length === 0) return;

          let bestIdx = null;
          let bestDist = Infinity;
          candidates.forEach(item => {
            const r = item.el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const d = Math.hypot(e.clientX - cx, e.clientY - cy);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = item.idx;
            }
          });

          const PROXIMITY_LIMIT = 52;
          if (bestIdx !== null && bestDist <= PROXIMITY_LIMIT) {
            e.stopPropagation();
            e.preventDefault();
            startHandleDrag(bestIdx, e);
          }
        });
      }
      renderCustomPresetsUI();

      if (window.FishDatabase && typeof window.FishDatabase.getCustomEasingPresets === 'function') {
        window.FishDatabase.getCustomEasingPresets().then(dbList => {
          if (Array.isArray(dbList) && dbList.length > 0) {
            const localList = getCustomPresets();
            const merged = [...localList];
            dbList.forEach(item => {
              if (!merged.some(m => m.name === item.name && JSON.stringify(m.easing) === JSON.stringify(item.easing) && JSON.stringify(m.config || null) === JSON.stringify(item.config || null))) {
                merged.push(item);
              }
            });
            try { localStorage.setItem('fishtool_custom_easing_presets', JSON.stringify(merged)); } catch (_) {}
            renderCustomPresetsUI();
            updateGraphUI();
          }
        }).catch(() => {});
      }

      if (graphFrame) {
        graphFrame.addEventListener('wheel', (e) => {
          e.preventDefault();
          e.stopPropagation();
        }, { passive: false });
      }

      if (typeof ResizeObserver !== 'undefined' && graphFrame) {
        const ro = new ResizeObserver(() => {
          updateGraphUI();
        });
        ro.observe(graphFrame);
      }
      window.addEventListener('resize', () => {
        if (graphFrame && graphFrame.offsetParent !== null) {
          updateGraphUI();
        }
      });
    }
    window.initGraphEditor = initGraphEditor;
})();
