/**
 * OpenFishTools Studio - Editor Extension Bridge & Action Router
 * Handles tool dispatches from .jsx extension cards (editorExecuteFishTool, executeFishTool),
 * anchor point adjustments, layer alignment/distribution, and procedural 3D layout bridges.
 */
(function() {
      // -------------------------------------------------------------
      // OPENFISHTOOLS UNIVERSAL EXTENSION TOOL DISPATCH BRIDGE
      // Handles extension tool calls from .jsx cards (Anchor, Align, Cut/Trim, Actions, Toolbox, Effects, Velocity, Format)
      // -------------------------------------------------------------
      function getSelectedLayersForFishTool() {
        let targets = [];
        if (typeof getSelectedLayersForOperation === 'function') {
          targets = getSelectedLayersForOperation() || [];
        }
        if (!targets || targets.length === 0) {
          const lId = window.selectedLayerId;
          const layers = (currentProjectState && currentProjectState.layers) || [];
          if (lId) {
            const l = layers.find(x => x.id === lId);
            if (l) targets = [l];
          }
        }
        return targets;
      }

      // -------------------------------------------------------------
      // AUTHENTIC BEAT EFFECTS ENGINE (NULL PARENT & ADJUSTMENT ARCHITECTURE)
      // Faithful reproduction of OpenFishTools CEP animation.jsx algorithms
      // -------------------------------------------------------------
      function applyNullBeatEffect(toolName, targets) {
        if (typeof window.applyBeatNullTool === 'function') {
          return window.applyBeatNullTool(toolName);
        }
        if (!targets || !targets.length) {
          const msg = `Pilih layer terlebih dahulu untuk ${toolName}`;
          showEditorToast(msg, 2400, 'error');
          return { error: true, message: msg };
        }
        const targetLayer = targets[0];
        const pps = window.currentPixelsPerSecond || 80;
        const inPoint = targetLayer.startSec !== undefined ? targetLayer.startSec : ((targetLayer.startPx || 0) / pps);
        const durationSec = targetLayer.durationSec !== undefined ? targetLayer.durationSec : ((targetLayer.widthPx || 320) / pps);

        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        const nullLayer = addNullLayer(true, {
          startSec: inPoint,
          durationSec: durationSec
        });
        if (!nullLayer) {
          showEditorToast('Gagal membuat Null Layer', 2400, 'error');
          return false;
        }

        nullLayer.scaleW = 100;
        nullLayer.scaleH = 100;
        nullLayer.posX = targetLayer.posX !== undefined ? targetLayer.posX : nullLayer.posX;
        nullLayer.posY = targetLayer.posY !== undefined ? targetLayer.posY : nullLayer.posY;

        targets.forEach(t => {
          if (typeof window.linkLayer === 'function') {
            window.linkLayer(t, nullLayer, true);
          } else {
            t.parentId = nullLayer.id;
          }
          if (t.parentBind) {
            t.parentBind.parentScaleW = 100;
            t.parentBind.parentScaleH = 100;
          }
        });

        nullLayer.effects = nullLayer.effects || [];
        nullLayer.expressions = nullLayer.expressions || {};

        function addSlider(layer, name, val) {
          const reg = (window.FishEffects && window.FishEffects.registry) || window.FishEffectsRegistry;
          let fx = reg && typeof reg.createInstance === 'function' ? reg.createInstance('slider-control', name) : null;
          if (!fx) {
            fx = {
              id: 'fx_slider_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              type: 'slider-control',
              name: name,
              isExpanded: true,
              disabled: false
            };
          }
          fx.name = name;
          fx.slider = val;
          layer.effects.push(fx);
          return fx;
        }

        if (toolName === 'Y_BEAT') {
          nullLayer.name = 'Y BEAT';
          addSlider(nullLayer, 'Amp', 500);
          addSlider(nullLayer, 'Decay', 20);
          nullLayer.expressions.move = [
            'amp = effect("Amp")("ADBE Slider Control-0001");',
            'decay = effect("Decay")("ADBE Slider Control-0001");',
            '',
            'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            '',
            'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
            '    value;',
            '}else{',
            '    n = m.nearestKey(time).index;',
            '    if (m.key(n).time > time) {',
            '        t2 = m.key(n).time;',
            '        t1 = (n > 1) ? m.key(n-1).time : -99999;',
            '    } else {',
            '        t1 = m.key(n).time;',
            '        t2 = (n < m.numKeys) ? m.key(n+1).time : 99999;',
            '    }',
            '',
            '    val1 = 0;',
            '    if (t1 >= inPoint && t1 <= outPoint) {',
            '        val1 = amp / Math.exp((time - t1) * decay);',
            '    }',
            '',
            '    val2 = 0;',
            '    if (t2 >= inPoint && t2 <= outPoint) {',
            '        val2 = amp / Math.exp((t2 - time) * decay);',
            '    }',
            '',
            '    val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
            '    value + [0, val];',
            '}'
          ].join('\n');
        } else if (toolName === 'X_BEAT') {
          nullLayer.name = 'X BEAT';
          addSlider(nullLayer, 'Amp', 500);
          addSlider(nullLayer, 'Decay', 20);
          nullLayer.expressions.move = [
            'amp = effect("Amp")("ADBE Slider Control-0001");',
            'decay = effect("Decay")("ADBE Slider Control-0001");',
            '',
            'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            '',
            'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
            '    value;',
            '}else{',
            '    n = m.nearestKey(time).index;',
            '    if (m.key(n).time > time) {',
            '        t2 = m.key(n).time;',
            '        t1 = (n > 1) ? m.key(n-1).time : -99999;',
            '    } else {',
            '        t1 = m.key(n).time;',
            '        t2 = (n < m.numKeys) ? m.key(n+1).time : 99999;',
            '    }',
            '',
            '    val1 = 0;',
            '    if (t1 >= inPoint && t1 <= outPoint) {',
            '        val1 = amp / Math.exp((time - t1) * decay);',
            '    }',
            '',
            '    val2 = 0;',
            '    if (t2 >= inPoint && t2 <= outPoint) {',
            '        val2 = amp / Math.exp((t2 - time) * decay);',
            '    }',
            '',
            '    val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
            '    value + [val, 0];',
            '}'
          ].join('\n');
        } else if (toolName === 'Y_FLIP') {
          nullLayer.name = 'Y FLIP';
          addSlider(nullLayer, 'Amp', 500);
          addSlider(nullLayer, 'Decay', 15);
          nullLayer.expressions.move = [
            'amp = effect("Amp")("ADBE Slider Control-0001");',
            'decay = effect("Decay")("ADBE Slider Control-0001");',
            '',
            'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            '',
            'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
            '    value;',
            '}else{',
            '    validKeys = [];',
            '    for (i = 1; i <= m.numKeys; i++){',
            '        kt = m.key(i).time;',
            '        if (kt >= inPoint && kt <= outPoint){',
            '            validKeys.push(i);',
            '        }',
            '    }',
            '',
            '    if (validKeys.length === 0){',
            '        value;',
            '    }else{',
            '        activeIdx = -1;',
            '        for (k = 0; k < validKeys.length; k++){',
            '            if (m.key(validKeys[k]).time <= time){',
            '                activeIdx = k;',
            '            }else{',
            '                break;',
            '            }',
            '        }',
            '',
            '        if (activeIdx === -1){',
            '            tNext = m.key(validKeys[0]).time;',
            '            dir = -1;',
            '            val = -dir * amp / Math.exp((tNext - time) * decay);',
            '            value + [0, val];',
            '        }else{',
            '            t1 = m.key(validKeys[activeIdx]).time;',
            '            hasNext = (activeIdx + 1 < validKeys.length);',
            '            t2 = hasNext ? m.key(validKeys[activeIdx + 1]).time : (outPoint + 9999);',
            '            dir = (activeIdx % 2 === 0) ? -1 : 1;',
            '            val1 = dir * amp / Math.exp((time - t1) * decay);',
            '            val2 = hasNext ? (dir * amp / Math.exp((t2 - time) * decay)) : 0;',
            '            val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
            '            value + [0, val];',
            '        }',
            '    }',
            '}'
          ].join('\n');
          nullLayer.expressions.scale = [
            'if (time < inPoint || time > outPoint){',
            '    value;',
            '}else{',
            '    m = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            '    if (!m || m.numKeys === 0){',
            '        value;',
            '    }else{',
            '        validKeys = [];',
            '        for (i = 1; i <= m.numKeys; i++){',
            '            kt = m.key(i).time;',
            '            if (kt >= inPoint && kt <= outPoint){',
            '                validKeys.push(i);',
            '            }',
            '        }',
            '',
            '        if (validKeys.length === 0){',
            '            value;',
            '        }else{',
            '            activeIdx = -1;',
            '            for (k = 0; k < validKeys.length; k++){',
            '                if (m.key(validKeys[k]).time <= time){',
            '                    activeIdx = k;',
            '                }else{',
            '                    break;',
            '                }',
            '            }',
            '',
            '            if (activeIdx === -1){',
            '                value;',
            '            }else{',
            '                sY = (activeIdx % 2 === 0) ? -100 : 100;',
            '                [value[0], sY];',
            '            }',
            '        }',
            '    }',
            '}'
          ].join('\n');
        } else if (toolName === 'X_FLIP') {
          nullLayer.name = 'X FLIP';
          addSlider(nullLayer, 'Amp', 500);
          addSlider(nullLayer, 'Decay', 15);
          nullLayer.expressions.move = [
            'amp = effect("Amp")("ADBE Slider Control-0001");',
            'decay = effect("Decay")("ADBE Slider Control-0001");',
            '',
            'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            '',
            'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
            '    value;',
            '}else{',
            '    validKeys = [];',
            '    for (i = 1; i <= m.numKeys; i++){',
            '        kt = m.key(i).time;',
            '        if (kt >= inPoint && kt <= outPoint){',
            '            validKeys.push(i);',
            '        }',
            '    }',
            '',
            '    if (validKeys.length === 0){',
            '        value;',
            '    }else{',
            '        activeIdx = -1;',
            '        for (k = 0; k < validKeys.length; k++){',
            '            if (m.key(validKeys[k]).time <= time){',
            '                activeIdx = k;',
            '            }else{',
            '                break;',
            '            }',
            '        }',
            '',
            '        if (activeIdx === -1){',
            '            tNext = m.key(validKeys[0]).time;',
            '            dir = -1;',
            '            val = -dir * amp / Math.exp((tNext - time) * decay);',
            '            value + [val, 0];',
            '        }else{',
            '            t1 = m.key(validKeys[activeIdx]).time;',
            '            hasNext = (activeIdx + 1 < validKeys.length);',
            '            t2 = hasNext ? m.key(validKeys[activeIdx + 1]).time : (outPoint + 9999);',
            '            dir = (activeIdx % 2 === 0) ? -1 : 1;',
            '            val1 = dir * amp / Math.exp((time - t1) * decay);',
            '            val2 = hasNext ? (dir * amp / Math.exp((t2 - time) * decay)) : 0;',
            '            val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
            '            value + [val, 0];',
            '        }',
            '    }',
            '}'
          ].join('\n');
          nullLayer.expressions.scale = [
            'if (time < inPoint || time > outPoint){',
            '    value;',
            '}else{',
            '    m = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            '    if (!m || m.numKeys === 0){',
            '        value;',
            '    }else{',
            '        validKeys = [];',
            '        for (i = 1; i <= m.numKeys; i++){',
            '            kt = m.key(i).time;',
            '            if (kt >= inPoint && kt <= outPoint){',
            '                validKeys.push(i);',
            '            }',
            '        }',
            '',
            '        if (validKeys.length === 0){',
            '            value;',
            '        }else{',
            '            activeIdx = -1;',
            '            for (k = 0; k < validKeys.length; k++){',
            '                if (m.key(validKeys[k]).time <= time){',
            '                    activeIdx = k;',
            '                }else{',
            '                    break;',
            '                }',
            '            }',
            '',
            '            if (activeIdx === -1){',
            '                value;',
            '            }else{',
            '                sX = (activeIdx % 2 === 0) ? -100 : 100;',
            '                [sX, value[1]];',
            '            }',
            '        }',
            '    }',
            '}'
          ].join('\n');
        } else if (toolName === 'SCALE_BEAT') {
          nullLayer.name = 'SCALE BEAT';
          addSlider(nullLayer, 'Amp', 500);
          addSlider(nullLayer, 'Decay', 20);
          nullLayer.expressions.scale = [
            'amp = effect("Amp")("ADBE Slider Control-0001");',
            'decay = effect("Decay")("ADBE Slider Control-0001");',
            '',
            'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            '',
            'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
            '    value;',
            '}else{',
            '    n = m.nearestKey(time).index;',
            '    if (m.key(n).time > time) {',
            '        t2 = m.key(n).time;',
            '        t1 = (n > 1) ? m.key(n-1).time : -99999;',
            '    } else {',
            '        t1 = m.key(n).time;',
            '        t2 = (n < m.numKeys) ? m.key(n+1).time : 99999;',
            '    }',
            '',
            '    val1 = 0;',
            '    if (t1 >= inPoint && t1 <= outPoint) {',
            '        val1 = amp / Math.exp((time - t1) * decay);',
            '    }',
            '',
            '    val2 = 0;',
            '    if (t2 >= inPoint && t2 <= outPoint) {',
            '        val2 = amp / Math.exp((t2 - time) * decay);',
            '    }',
            '',
            '    val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
            '    value + [val, val];',
            '}'
          ].join('\n');
        } else if (toolName === 'OSCILLATE') {
          nullLayer.name = 'OSCILLATE';
          addSlider(nullLayer, 'Freq', 3);
          addSlider(nullLayer, 'Amp', 30);
          addSlider(nullLayer, 'Decay', 2.7);
          addSlider(nullLayer, 'Attack', 40);
          nullLayer.expressions.move = [
            'freq = effect("Freq")("ADBE Slider Control-0001");',
            'amp = effect("Amp")("ADBE Slider Control-0001");',
            'decay = effect("Decay")("ADBE Slider Control-0001");',
            'attack = effect("Attack")("ADBE Slider Control-0001");',
            '',
            'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            '',
            'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
            '    value;',
            '}else{',
            '    n = 0;',
            '    if (m.numKeys > 0){',
            '        n = m.nearestKey(time).index;',
            '        if (m.key(n).time > time) n--;',
            '    }',
            '',
            '    if (n > 0){',
            '        markerTime = m.key(n).time;',
            '        if (markerTime >= inPoint && markerTime <= outPoint){',
            '            t = time - markerTime;',
            '            env = (attack > 0) ? (1 - Math.exp(-t * attack)) : 1;',
            '            currAmp = amp * env / Math.exp(t * decay);',
            '            x = Math.sin(t * freq * Math.PI * 2) * currAmp;',
            '            y = (1 - Math.cos(t * freq * Math.PI * 2)) * currAmp;',
            '            value + [x, y];',
            '        }else{',
            '            value;',
            '        }',
            '    }else{',
            '        value;',
            '    }',
            '}'
          ].join('\n');
        } else if (toolName === 'SWING') {
          nullLayer.name = 'Swing_Null';
          addSlider(nullLayer, 'Freq', 1);
          addSlider(nullLayer, 'Amp', 4);
          addSlider(nullLayer, 'Decay', 1.5);
          nullLayer.expressions.rotate = [
            'freq = effect("Freq")("ADBE Slider Control-0001");',
            'amp = effect("Amp")("ADBE Slider Control-0001");',
            'decay = effect("Decay")("ADBE Slider Control-0001");',
            '',
            'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            '',
            'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
            '    value;',
            '}else{',
            '    n = 0;',
            '    if (m.numKeys > 0){',
            '        n = m.nearestKey(time).index;',
            '        if (m.key(n).time > time) n--;',
            '    }',
            '',
            '    if (n > 0){',
            '        markerTime = m.key(n).time;',
            '        if (markerTime >= inPoint && markerTime <= outPoint){',
            '            t = time - markerTime;',
            '            r = amp * Math.sin(t * freq * Math.PI * 2) / Math.exp(t * decay);',
            '            value + r;',
            '        }else{',
            '            value;',
            '        }',
            '    }else{',
            '        value;',
            '    }',
            '}'
          ].join('\n');
        } else if (toolName === 'SCALE_OVERLAP') {
          nullLayer.name = 'SCALE OVER';
          addSlider(nullLayer, 'Scale In', 0);
          addSlider(nullLayer, 'Scale Out', 20);
          addSlider(nullLayer, 'Overshoot', 20);
          nullLayer.expressions.scale = [
            'function bezier(x1, y1, x2, y2, t) {',
            '    if (t <= 0) return 0;',
            '    if (t >= 1) return 1;',
            '    var p = t;',
            '    for (var i = 0; i < 8; i++) {',
            '        var omP = 1 - p;',
            '        var f = 3 * omP * omP * p * x1 + 3 * omP * p * p * x2 + p * p * p - t;',
            '        var df = 3 * omP * omP * x1 + 6 * omP * p * (x2 - x1) + 3 * p * p * (1 - x2);',
            '        if (Math.abs(df) < 1e-6) break;',
            '        p -= f / df;',
            '        p = Math.max(0, Math.min(1, p));',
            '    }',
            '    var omP = 1 - p;',
            '    return 3 * omP * omP * p * y1 + 3 * omP * p * p * y2 + p * p * p;',
            '}',
            '',
            'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            'scaleIn = effect("Scale In")("ADBE Slider Control-0001");',
            'scaleOut = effect("Scale Out")("ADBE Slider Control-0001");',
            'overshoot = effect("Overshoot")("ADBE Slider Control-0001");',
            '',
            'if (time < inPoint || time > outPoint) {',
            '    value;',
            '} else if (m && m.numKeys > 0) {',
            '    n = 0;',
            '    if (m.numKeys > 0) {',
            '        n = m.nearestKey(time).index;',
            '        if (m.key(n).time > time) n--;',
            '    }',
            '    if (n > 0 && n < m.numKeys) {',
            '        t1 = m.key(n).time;',
            '        t2 = m.key(n+1).time;',
            '        dur = t2 - t1;',
            '        startVal = (n % 2 !== 0) ? scaleIn : scaleOut;',
            '        endVal = (n % 2 !== 0) ? scaleOut : scaleIn;',
            '        t = time - t1;',
            '        progress = Math.max(0, Math.min(1, t / dur));',
            '        yMult = overshoot / 20;',
            '        eased = bezier(0.4, -0.5 * yMult, 0.8, -0.5 * yMult, progress);',
            '        val = startVal + (endVal - startVal) * eased;',
            '        value + [val, val];',
            '    } else if (n >= m.numKeys) {',
            '        finalVal = (m.numKeys % 2 !== 0) ? scaleOut : scaleIn;',
            '        value + [finalVal, finalVal];',
            '    } else {',
            '        value + [scaleIn, scaleIn];',
            '    }',
            '} else {',
            '    value;',
            '}'
          ].join('\n');
        } else if (toolName.startsWith('PANNING_')) {
          const isMixPR = (toolName === 'PANNING_MIX_PR');
          const isMixAll = (toolName === 'PANNING_MIX_ALL');
          const hasPos = (toolName === 'PANNING_POS' || isMixPR || isMixAll);
          const hasRot = (toolName === 'PANNING_ROT' || isMixPR || isMixAll);
          const hasScale = (toolName === 'PANNING_SCALE' || isMixAll);

          const nullNames = {
            'PANNING_POS': 'PANNING Position',
            'PANNING_ROT': 'PANNING Rotation',
            'PANNING_SCALE': 'PANNING Scale',
            'PANNING_MIX_PR': 'PANNING Mix PR',
            'PANNING_MIX_ALL': 'PANNING Mix All'
          };
          nullLayer.name = nullNames[toolName] || 'PANNING';

          const defaultFreq = isMixPR ? 7 : 1.5;
          const defaultPos = isMixPR ? 10 : 30;
          const defaultRot = isMixPR ? 1 : 5;
          const defaultScale = 10;

          addSlider(nullLayer, 'Freq', defaultFreq);
          if (hasPos) addSlider(nullLayer, 'Position', defaultPos);
          if (hasRot) addSlider(nullLayer, 'Rotation', defaultRot);
          if (hasScale) addSlider(nullLayer, 'Scale', defaultScale);

          if (hasPos) {
            nullLayer.expressions.move = [
              'freq = effect("Freq")("ADBE Slider Control-0001");',
              'posAmp = effect("Position")("ADBE Slider Control-0001");',
              'if (time < inPoint || time > outPoint){',
              '    value;',
              '}else{',
              '    t = time * freq;',
              '    x = (Math.sin(t * 1.2) * 0.7 + Math.sin(t * 2.3) * 0.3) * posAmp;',
              '    y = (Math.cos(t * 0.9) * 0.7 + Math.sin(t * 1.7) * 0.3) * posAmp;',
              '    value + [x, y];',
              '}'
            ].join('\n');
          }
          if (hasRot) {
            nullLayer.expressions.rotate = [
              'freq = effect("Freq")("ADBE Slider Control-0001");',
              'rotAmp = effect("Rotation")("ADBE Slider Control-0001");',
              'if (time < inPoint || time > outPoint){',
              '    value;',
              '}else{',
              '    t = time * freq;',
              '    r = (Math.sin(t * 0.8 + 1.5) * 0.7 + Math.cos(t * 1.5) * 0.3) * rotAmp;',
              '    value + r;',
              '}'
            ].join('\n');
          }
          if (hasScale) {
            nullLayer.expressions.scale = [
              'freq = effect("Freq")("ADBE Slider Control-0001");',
              'scaleAmp = effect("Scale")("ADBE Slider Control-0001");',
              'if (time < inPoint || time > outPoint){',
              '    value;',
              '}else{',
              '    t = time * freq;',
              '    s = (Math.sin(t * 1.1) * 0.7 + Math.cos(t * 2.1) * 0.3) * scaleAmp;',
              '    value + [s, s];',
              '}'
            ].join('\n');
          }
        } else if (typeof toolName === 'string' && toolName.indexOf('IDLE_MOVE_') === 0) {
          const scaleP1 = '[0, 55.8333, 0, 55.8333, 0, 55.8333, 0]';
          const glideP1 = 'bezier(0.343, -2.0 * yMult, 0.511, 1 + 1.0 * yMult, progress)';
          const scaleP2 = '[0, 19.1667, 59.1667, -19.9167, 52.5, -43.3333, 59.1667]';
          const glideP2 = 'bezier(0.532, -0.436 * yMult, 0.379, 1 + 0.415 * yMult, progress)';

          const idleSpecs = {
            IDLE_MOVE_1: {
              name: 'IDLE MOVE 1',
              scaleSteps: scaleP1,
              glideEase: glideP1
            },
            IDLE_MOVE_2: {
              name: 'IDLE MOVE 2',
              scaleSteps: scaleP2,
              glideEase: glideP2
            },
            IDLE_MOVE_3: {
              name: 'IDLE MOVE 3',
              scaleSteps: scaleP1,
              glideEase: glideP1,
              posDefault: 45,
              stepX: '[0, -0.6, 0.55, -0.5, 0.6, -0.35]',
              stepY: '[0, -0.35, 0.4, 0.45, -0.35, -0.45]'
            },
            IDLE_MOVE_4: {
              name: 'IDLE MOVE 4',
              scaleSteps: scaleP1,
              glideEase: glideP1,
              rotDefault: 5,
              stepRot: '[0, 1.0, -1.0, 0.75]'
            },
            IDLE_MOVE_5: {
              name: 'IDLE MOVE 5',
              scaleSteps: scaleP2,
              glideEase: glideP2,
              posDefault: 45,
              stepX: '[0, 0.55, -0.6, 0.45, -0.5, 0.35]',
              stepY: '[0, -0.4, 0.35, -0.45, 0.4, -0.3]',
              rotDefault: 5,
              stepRot: '[0, -1.0, 1.0, -0.75]'
            },
            IDLE_MOVE_6: {
              name: 'IDLE MOVE 6',
              scaleSteps: scaleP1,
              glideEase: glideP1,
              posDefault: 45,
              stepX: '[0, -0.6, 0.55, -0.5, 0.6, -0.35]',
              stepY: '[0, -0.35, 0.4, 0.45, -0.35, -0.45]',
              rotDefault: 5,
              stepRot: '[0, 1.0, -1.0, 0.75]'
            }
          };
          const spec = idleSpecs[toolName] || idleSpecs.IDLE_MOVE_1;
          nullLayer.name = spec.name;

          addSlider(nullLayer, 'Amp', 100);
          if (spec.posDefault !== undefined) {
            addSlider(nullLayer, 'Position', spec.posDefault);
          }
          if (spec.rotDefault !== undefined) {
            addSlider(nullLayer, 'Rotation', spec.rotDefault);
          }
          addSlider(nullLayer, 'Overshoot', 100);
          addSlider(nullLayer, 'Skip Beats', 4);

          const bezierFnBlock = [
            'function bezier(x1, y1, x2, y2, t) {',
            '    if (t <= 0) return 0;',
            '    if (t >= 1) return 1;',
            '    var p = t;',
            '    for (var i = 0; i < 8; i++) {',
            '        var omP = 1 - p;',
            '        var f = 3 * omP * omP * p * x1 + 3 * omP * p * p * x2 + p * p * p - t;',
            '        var df = 3 * omP * omP * x1 + 6 * omP * p * (x2 - x1) + 3 * p * p * (1 - x2);',
            '        if (Math.abs(df) < 1e-6) break;',
            '        p -= f / df;',
            '        p = Math.max(0, Math.min(1, p));',
            '    }',
            '    var omP = 1 - p;',
            '    return 3 * omP * omP * p * y1 + 3 * omP * p * p * y2 + p * p * p;',
            '}'
          ];

          // Scale expression: untouched original Pattern 1 / Pattern 2 beat-skipping graph
          nullLayer.expressions.scale = [
            ...bezierFnBlock,
            '',
            'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            'amp = effect("Amp")("ADBE Slider Control-0001") / 100;',
            'overshoot = effect("Overshoot")("ADBE Slider Control-0001");',
            'skipBeats = Math.max(0, Math.round(effect("Skip Beats")("ADBE Slider Control-0001")));',
            'yMult = overshoot / 100;',
            'cycleBeats = 6 + skipBeats;',
            'stepVals = ' + spec.scaleSteps + ';',
            '',
            'if (time < inPoint || time > outPoint) {',
            '    value;',
            '} else if (m && m.numKeys > 0) {',
            '    n = m.nearestKey(time).index;',
            '    if (m.key(n).time > time) n--;',
            '    if (n <= 0) {',
            '        value;',
            '    } else {',
            '        bIdx = n - 1;',
            '        cycleIdx = Math.floor(bIdx / cycleBeats);',
            '        rem = bIdx % cycleBeats;',
            '        stepIdx = (rem < 5) ? rem : 5;',
            '        startKey = 1 + cycleIdx * cycleBeats + stepIdx;',
            '        endKey = (stepIdx < 5) ? (startKey + 1) : (1 + (cycleIdx + 1) * cycleBeats);',
            '        if (startKey <= m.numKeys) {',
            '            t1 = m.key(startKey).time;',
            '            s0 = ((cycleIdx > 0 && stepIdx === 0) ? stepVals[6] : stepVals[stepIdx]) * amp;',
            '            s1 = stepVals[stepIdx + 1] * amp;',
            '            if (startKey >= m.numKeys) {',
            '                val = s0;',
            '            } else {',
            '                t2 = (endKey <= m.numKeys) ? m.key(endKey).time : m.key(m.numKeys).time;',
            '                dur = Math.max(0.0001, t2 - t1);',
            '                if (t2 <= t1 + 0.0001) {',
            '                    val = s0;',
            '                } else if (time >= t2) {',
            '                    val = s1;',
            '                } else {',
            '                    progress = Math.max(0, Math.min(1, (time - t1) / dur));',
            '                    eased = (stepIdx < 5)',
            '                        ? bezier(0.229, -0.924 * yMult, 0.77, -0.839 * yMult, progress)',
            '                        : ' + spec.glideEase + ';',
            '                    val = s0 + (s1 - s0) * eased;',
            '                }',
            '            }',
            '            value + [val, val];',
            '        } else {',
            '            value;',
            '        }',
            '    }',
            '} else {',
            '    value;',
            '}'
          ].join('\n');

          // Spaced Easy Ease builder (triggers on odd beatmarks 1, 3, 5, 7... with smooth Easy Ease graph)
          const buildSpacedEasyEaseExpr = (headerLines, calcLines, outExpr) => [
            ...bezierFnBlock,
            '',
            'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
            ...headerLines,
            '',
            'if (time < inPoint || time > outPoint) {',
            '    value;',
            '} else if (m && m.numKeys > 0) {',
            '    n = m.nearestKey(time).index;',
            '    if (m.key(n).time > time) n--;',
            '    if (n <= 0) {',
            '        value;',
            '    } else {',
            '        slotIdx = Math.floor((n - 1) / 2);',
            '        startKey = 1 + slotIdx * 2;',
            '        endKey = startKey + 2;',
            '        t1 = m.key(startKey).time;',
            '        canAnim = (startKey < m.numKeys);',
            '        t2 = (endKey <= m.numKeys) ? m.key(endKey).time : (canAnim ? m.key(m.numKeys).time : outPoint);',
            '        dur = Math.max(0.0001, t2 - t1);',
            '        progress = canAnim ? Math.max(0, Math.min(1, (time - t1) / dur)) : 0;',
            '        eased = bezier(0.42, 0.0, 0.58, 1.0, progress);',
            ...calcLines,
            '        ' + outExpr + ';',
            '    }',
            '} else {',
            '    value;',
            '}'
          ].join('\n');

          if (spec.stepX && spec.stepY) {
            nullLayer.expressions.move = buildSpacedEasyEaseExpr(
              [
                'posAmp = effect("Position")("ADBE Slider Control-0001");',
                'stepX = ' + spec.stepX + ';',
                'stepY = ' + spec.stepY + ';'
              ],
              [
                '        idx0 = slotIdx % stepX.length;',
                '        idx1 = (slotIdx + 1) % stepX.length;',
                '        x0 = stepX[idx0] * posAmp; x1 = stepX[idx1] * posAmp;',
                '        y0 = stepY[idx0] * posAmp; y1 = stepY[idx1] * posAmp;',
                '        dx = x0 + (x1 - x0) * eased;',
                '        dy = y0 + (y1 - y0) * eased;'
              ],
              'value + [dx, dy]'
            );
          }

          if (spec.stepRot) {
            nullLayer.expressions.rotate = buildSpacedEasyEaseExpr(
              [
                'rotAmp = effect("Rotation")("ADBE Slider Control-0001");',
                'stepRot = ' + spec.stepRot + ';'
              ],
              [
                '        idx0 = slotIdx % stepRot.length;',
                '        idx1 = (slotIdx + 1) % stepRot.length;',
                '        r0 = stepRot[idx0] * rotAmp;',
                '        r1 = stepRot[idx1] * rotAmp;',
                '        rotVal = r0 + (r1 - r0) * eased;'
              ],
              'value + rotVal'
            );
          }
        }

        selectTimelineLayer(nullLayer.id, false);
        if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
        if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(nullLayer);
        if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(targetLayer);
        if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
        if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
        if (typeof redrawComposition === 'function') redrawComposition('beat-null');
        showEditorToast(`Beat Effect: ${nullLayer.name} dibuat (Null Parent)`);
        return true;
      }

      function applyAdjustmentBeatEffect(toolName, targets, args = []) {
        if (toolName === 'GHST' && typeof window.applyBeatGhostEffect === 'function') return window.applyBeatGhostEffect();
        if (toolName === 'WARP' && typeof window.applyBeatWarpEffect === 'function') return window.applyBeatWarpEffect();
        if (toolName === 'FISHEYE' && typeof window.applyBeatFisheyeEffect === 'function') return window.applyBeatFisheyeEffect();
        if (toolName === 'MIDWAVE' && typeof window.applyBeatMidwaveEffect === 'function') return window.applyBeatMidwaveEffect();
        if (toolName === 'HUESPIN' && typeof window.applyBeatHuespinEffect === 'function') return window.applyBeatHuespinEffect();
        if ((toolName === 'EXPO' || toolName === 'FLASH') && typeof window.applyBeatFlashEffect === 'function') return window.applyBeatFlashEffect();
        if ((toolName === 'LENS' || toolName === 'BLUR') && typeof window.applyBeatBlurEffect === 'function') {
          return window.applyBeatBlurEffect(args && (args[0] === true || args[0] === 'lens' || args[0] === 'right'));
        }
        if ((toolName === 'SHAKY' || toolName === 'SHKE') && typeof window.applyBeatNullTool === 'function') return window.applyBeatNullTool('SHAKY');
        if (!targets || !targets.length) {
          const msg = `Pilih layer terlebih dahulu untuk ${toolName}`;
          showEditorToast(msg, 2400, 'error');
          return { error: true, message: msg };
        }
        const targetLayer = targets[0];
        const pps = window.currentPixelsPerSecond || 80;
        const inPoint = targetLayer.startSec !== undefined ? targetLayer.startSec : ((targetLayer.startPx || 0) / pps);
        const durationSec = targetLayer.durationSec !== undefined ? targetLayer.durationSec : ((targetLayer.widthPx || 320) / pps);
        const fps = (currentProjectState && currentProjectState.fps) || 60;
        const fd = 1 / fps;
        const curTime = (typeof getCurrentPlayheadTime === 'function') ? getCurrentPlayheadTime() : (Math.abs(window.timelinePanX || 0) / pps);

        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        const reg = (window.FishEffects && window.FishEffects.registry) || window.FishEffectsRegistry;

        function addSlider(layer, name, val) {
          let fx = reg && typeof reg.createInstance === 'function' ? reg.createInstance('slider-control', name) : null;
          if (!fx) {
            fx = {
              id: 'fx_slider_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              type: 'slider-control',
              name: name,
              isExpanded: true,
              disabled: false
            };
          }
          fx.name = name;
          fx.slider = val;
          layer.effects.push(fx);
          return fx;
        }

        let adjLayer = null;

        if (toolName === 'EXPO') {
          adjLayer = addAdjustmentLayer(durationSec, inPoint);
          if (!adjLayer) return false;
          adjLayer.name = 'Exposure Flash Beat';
          adjLayer.effects = adjLayer.effects || [];
          adjLayer.expressions = adjLayer.expressions || {};
          addSlider(adjLayer, 'Max Exposure', 50);
          addSlider(adjLayer, 'Decay', 5.0);
          const expoFx = reg ? reg.createInstance('exposure-gamma', 'Exposure / Gamma') : null;
          if (expoFx) {
            adjLayer.effects.push(expoFx);
            adjLayer.expressions[`${expoFx.id}:exposure`] = [
              'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
              'maxExpo = effect("Max Exposure")("ADBE Slider Control-0001");',
              'decay = effect("Decay")("ADBE Slider Control-0001");',
              'if (m && m.numKeys > 0) {',
              '    n = 0;',
              '    n = m.nearestKey(time).index;',
              '    if (m.key(n).time > time) n--;',
              '    if (n > 0) {',
              '        t = time - m.key(n).time;',
              '        maxExpo / Math.exp(t * decay);',
              '    } else {',
              '        0;',
              '    }',
              '} else {',
              '    0;',
              '}'
            ].join('\n');
          }
        } else if (toolName === 'LENS' || toolName === 'BLUR') {
          const isLensBlur = args && (args[0] === true || args[0] === 'lens' || args[0] === 'right');
          adjLayer = addAdjustmentLayer(durationSec, inPoint);
          if (!adjLayer) return false;
          adjLayer.name = isLensBlur ? 'Lens Blur Beat' : 'Fast Box Blur Beat';
          adjLayer.effects = adjLayer.effects || [];
          adjLayer.expressions = adjLayer.expressions || {};
          const maxBlur = isLensBlur ? 2.5 : 4;
          addSlider(adjLayer, 'Max Blur', maxBlur);
          addSlider(adjLayer, 'Decay', 5.0);
          const blurFx = reg ? (isLensBlur ? reg.createInstance('camera-lens-blur', 'Camera Lens Blur') : reg.createInstance('fast-box-blur', 'Fast Box Blur')) : null;
          if (blurFx) {
            adjLayer.effects.push(blurFx);
            adjLayer.expressions[`${blurFx.id}:radius`] = [
              'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
              'maxBlur = effect("Max Blur")("ADBE Slider Control-0001");',
              'decay = effect("Decay")("ADBE Slider Control-0001");',
              'if (m && m.numKeys > 0) {',
              '    n = 0;',
              '    n = m.nearestKey(time).index;',
              '    if (m.key(n).time > time) n--;',
              '    if (n > 0) {',
              '        t = time - m.key(n).time;',
              '        if (t >= 0) {',
              '            maxBlur / Math.exp(t * decay);',
              '        } else {',
              '            0;',
              '        }',
              '    } else {',
              '        0;',
              '    }',
              '} else {',
              '    0;',
              '}'
            ].join('\n');
          }
        } else if (toolName === 'SHAKY' || toolName === 'SHKE') {
          adjLayer = addAdjustmentLayer(durationSec, inPoint);
          if (!adjLayer) return false;
          adjLayer.name = 'Shake Adjust';
          adjLayer.effects = adjLayer.effects || [];
          adjLayer.expressions = adjLayer.expressions || {};
          addSlider(adjLayer, 'Max Amplitude', 1.0);
          addSlider(adjLayer, 'Decay', 4.0);
          const shakeFx = reg ? reg.createInstance('shake', 'Shake') : null;
          if (shakeFx) {
            adjLayer.effects.push(shakeFx);
            adjLayer.expressions[`${shakeFx.id}:amplitude`] = [
              'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
              'maxAmp = effect("Max Amplitude")("ADBE Slider Control-0001");',
              'decay = effect("Decay")("ADBE Slider Control-0001");',
              'if (m && m.numKeys > 0) {',
              '    n = 0;',
              '    n = m.nearestKey(time).index;',
              '    if (m.key(n).time > time) n--;',
              '    if (n > 0) {',
              '        t = time - m.key(n).time;',
              '        maxAmp / Math.exp(t * decay);',
              '    } else {',
              '        0;',
              '    }',
              '} else {',
              '    0;',
              '}'
            ].join('\n');
          }
        } else if (toolName === 'GHST') {
          const dur = 25 * fd;
          adjLayer = addAdjustmentLayer(dur, curTime);
          if (!adjLayer) return false;
          adjLayer.name = 'Ghost Effect';
          adjLayer.effects = adjLayer.effects || [];
          const tfFx = reg ? reg.createInstance('transform', 'Transform') : null;
          if (tfFx) adjLayer.effects.push(tfFx);
          addEffectParamKeyframe(adjLayer, tfFx || { id: 'tf' }, 'scale', curTime, 100, [0.0, 0.1, 0.0, 0.95]);
          addEffectParamKeyframe(adjLayer, tfFx || { id: 'tf' }, 'scale', curTime + dur, 250, [0.0, 0.1, 0.0, 0.95]);
          addLayerPropKeyframe(adjLayer, 'opacity', curTime, { opacity: 1.0 }, [0.0, 0.1, 0.0, 0.95]);
          addLayerPropKeyframe(adjLayer, 'opacity', curTime + dur, { opacity: 0.0 }, [0.0, 0.1, 0.0, 0.95]);
        } else if (toolName === 'WARP') {
          const dur = 8 * fd;
          adjLayer = addAdjustmentLayer(dur, curTime);
          if (!adjLayer) return false;
          adjLayer.name = 'Warp Effect';
          adjLayer.effects = adjLayer.effects || [];
          const warpFx = reg ? reg.createInstance('wave-warp', 'Wave Warp') : null;
          if (warpFx) {
            warpFx.waveType = 'smooth-noise';
            warpFx.waveWidth = 109;
            warpFx.direction = 0;
            warpFx.speed = 0.2;
            warpFx.pinning = 'all';
            warpFx.phase = 1;
            warpFx.waveHeight = 228;
            warpFx.tile = 1;
            adjLayer.effects.push(warpFx);
            addEffectParamKeyframe(adjLayer, warpFx, 'waveHeight', curTime, 228, [0.0, -5.0, 0.1, 1.0]);
            addEffectParamKeyframe(adjLayer, warpFx, 'waveHeight', curTime + dur, 0, [0.0, -5.0, 0.1, 1.0]);
          }
        } else if (toolName === 'FISHEYE') {
          const start = Math.max(0, curTime - 6 * fd);
          const dur = 29 * fd;
          adjLayer = addAdjustmentLayer(dur, start);
          if (!adjLayer) return false;
          adjLayer.name = 'Fish Eye Ripple';
          adjLayer.effects = adjLayer.effects || [];
          const warpFx = reg ? reg.createInstance('warp', 'Warp') : null;
          if (warpFx) {
            warpFx.style = 'fisheye';
            warpFx.warpStyle = 'fisheye';
            warpFx.tile = 1;
            adjLayer.effects.push(warpFx);
            const f9 = [0.33, 0.0, 0.67, 1.0];
            addEffectParamKeyframe(adjLayer, warpFx, 'bend', curTime - 6 * fd, 0, f9);
            addEffectParamKeyframe(adjLayer, warpFx, 'bend', curTime - 2 * fd, 15, f9);
            addEffectParamKeyframe(adjLayer, warpFx, 'bend', curTime, -80, f9);
            addEffectParamKeyframe(adjLayer, warpFx, 'bend', curTime + 6 * fd, 15, f9);
            addEffectParamKeyframe(adjLayer, warpFx, 'bend', curTime + 14 * fd, -4, f9);
            addEffectParamKeyframe(adjLayer, warpFx, 'bend', curTime + 22 * fd, 0, f9);
          }
        } else if (toolName === 'MIDWAVE') {
          const start = Math.max(0, curTime - 15 * fd);
          const dur = 36 * fd;
          adjLayer = addAdjustmentLayer(dur, start);
          if (!adjLayer) return false;
          adjLayer.name = 'Mid-Wave';
          adjLayer.effects = adjLayer.effects || [];
          const tileFx = reg ? reg.createInstance('tile', 'Tile') : null;
          if (tileFx) {
            tileFx.scale = 150;
            tileFx.mirror = 1;
            adjLayer.effects.push(tileFx);
          }
          const ww1 = reg ? reg.createInstance('wave-warp', 'Wave Warp 1') : null;
          if (ww1) {
            ww1.waveType = 'sine';
            ww1.waveWidth = 1200;
            ww1.direction = 45;
            ww1.speed = 1.3;
            ww1.pinning = 'horizontal';
            ww1.phase = 90;
            adjLayer.effects.push(ww1);
            addEffectParamKeyframe(adjLayer, ww1, 'waveHeight', curTime - 15 * fd, 0, [0.17, 0.75, 0.001, 0.001]);
            addEffectParamKeyframe(adjLayer, ww1, 'waveHeight', curTime, 100, [0.001, 0.001, 0.75, 0.17]);
            addEffectParamKeyframe(adjLayer, ww1, 'waveHeight', curTime + 20 * fd, 0, [0.75, 0.17, 1.0, 1.0]);
          }
          const ww2 = reg ? reg.createInstance('wave-warp', 'Wave Warp 2') : null;
          if (ww2) {
            ww2.waveType = 'sine';
            ww2.waveWidth = 1200;
            ww2.direction = -45;
            ww2.speed = 1.3;
            ww2.pinning = 'horizontal';
            ww2.phase = 90;
            adjLayer.effects.push(ww2);
            addEffectParamKeyframe(adjLayer, ww2, 'waveHeight', curTime - 15 * fd, 0, [0.17, 0.75, 0.001, 0.001]);
            addEffectParamKeyframe(adjLayer, ww2, 'waveHeight', curTime, 100, [0.001, 0.001, 0.75, 0.17]);
            addEffectParamKeyframe(adjLayer, ww2, 'waveHeight', curTime + 20 * fd, 0, [0.75, 0.17, 1.0, 1.0]);
          }
        } else if (toolName === 'HUESPIN') {
          const dur = 25 * fd;
          adjLayer = addAdjustmentLayer(dur, curTime);
          if (!adjLayer) return false;
          adjLayer.name = 'Hue Spin';
          adjLayer.effects = adjLayer.effects || [];
          const hueFx = reg ? reg.createInstance('hue-shift', 'Hue Shift') : null;
          if (hueFx) {
            adjLayer.effects.push(hueFx);
            addEffectParamKeyframe(adjLayer, hueFx, 'hue', curTime, 0, [0.0, 0.0, 1.0, 1.0]);
            addEffectParamKeyframe(adjLayer, hueFx, 'hue', curTime + dur, 360, [0.0, 0.0, 1.0, 1.0]);
          }
        }

        if (adjLayer) {
          selectTimelineLayer(adjLayer.id, false);
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(adjLayer);
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          if (typeof redrawComposition === 'function') redrawComposition('beat-adj');
          showEditorToast(`Beat Effect: ${adjLayer.name} dibuat (Adjustment Layer)`);
          return true;
        }
        return false;
      }

      function purgeExistingPresetLayers(curTime, toleranceSec = 0.5) {
        if (!currentProjectState || !Array.isArray(currentProjectState.layers)) return;
        const pps = window.currentPixelsPerSecond || 80;
        const presetNames = new Set(['Warp Effect', 'Hue Spin', 'Ghost Effect', 'Mid-Wave', 'Fish Eye Ripple']);
        const beforeCount = currentProjectState.layers.length;
        currentProjectState.layers = currentProjectState.layers.filter(l => {
          if (l && l.type === 'adjustment' && presetNames.has(l.name)) {
            const start = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
            const dur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 320) / pps);
            const end = start + dur;
            if ((curTime >= start - 0.05 && curTime <= end + 0.05) || Math.abs(start - curTime) < toleranceSec) {
              return false;
            }
          }
          return true;
        });
        if (currentProjectState.layers.length !== beforeCount) {
          if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
        }
      }

      function addEffectParamKeyframe(layer, fx, paramId, time, value, easing = [0.33, 0.0, 0.67, 1.0]) {
        layer.keyframes = layer.keyframes || {};
        const scopedKey = `${fx.id}:${paramId}`;
        if (!Array.isArray(layer.keyframes[scopedKey])) layer.keyframes[scopedKey] = [];
        layer.keyframes[scopedKey].push({
          time: Number(time.toFixed(4)),
          value: { [paramId]: value },
          easing: easing
        });
        if (!Array.isArray(layer.keyframes[paramId])) layer.keyframes[paramId] = [];
        layer.keyframes[paramId].push({
          time: Number(time.toFixed(4)),
          value: { [paramId]: value },
          easing: easing
        });
      }

      function addLayerPropKeyframe(layer, prop, time, valObj, easing = [0.33, 0.0, 0.67, 1.0]) {
        layer.keyframes = layer.keyframes || {};
        if (!Array.isArray(layer.keyframes[prop])) layer.keyframes[prop] = [];
        layer.keyframes[prop].push({
          time: Number(time.toFixed(4)),
          value: valObj,
          easing: easing
        });
      }

      function applyWarpPreset(toolName, targets) {
        if (toolName === 'PRESET_WARP1' || toolName === 'WARP1') {
          if (typeof window.applyPresetWarp1 === 'function') return window.applyPresetWarp1();
        }
        if (toolName === 'PRESET_WARP2' || toolName === 'WARP2' || toolName === 'PRESET_WARP3' || toolName === 'WARP3') {
          if (typeof window.applyPresetWarp2 === 'function') return window.applyPresetWarp2();
        }
        if (!targets || !targets.length) {
          const msg = `Pilih layer terlebih dahulu untuk ${toolName}`;
          showEditorToast(msg, 2400, 'error');
          return { error: true, message: msg };
        }
        const pps = window.currentPixelsPerSecond || 80;
        const curTime = (typeof window.currentSec === 'number') ? window.currentSec : (Math.abs(window.timelinePanX || 0) / pps);
        const fd = 1 / ((currentProjectState && currentProjectState.fps) || 60);
        const reg = (window.FishEffects && window.FishEffects.registry) || window.FishEffectsRegistry;

        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        purgeExistingPresetLayers(curTime);

        if (toolName === 'PRESET_WARP1') {
          const dur = 63 * fd;
          const adj = addAdjustmentLayer(dur, curTime);
          if (!adj) return false;
          adj.name = 'Warp Effect';
          adj.effects = adj.effects || [];
          const warpFx = reg ? reg.createInstance('wave-warp', 'Wave Warp') : null;
          if (warpFx) {
            warpFx.waveType = 'smooth-noise';
            warpFx.waveWidth = 109;
            warpFx.direction = 0;
            warpFx.speed = 0.2;
            warpFx.pinning = 'all';
            warpFx.phase = 1;
            warpFx.waveHeight = 228;
            adj.effects.push(warpFx);
            addEffectParamKeyframe(adj, warpFx, 'waveHeight', curTime, 228, [0.0, -5.0, 0.1, 1.0]);
            addEffectParamKeyframe(adj, warpFx, 'waveHeight', curTime + dur, 0, [0.0, -5.0, 0.1, 1.0]);
          }
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(adj);
          selectTimelineLayer(adj.id, false);
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          if (typeof redrawComposition === 'function') redrawComposition('warp-preset');
          showEditorToast('Warp Preset 1 diterapkan (Warp Effect, 63 frames)');
          return true;
        }

        if (toolName === 'PRESET_WARP2' || toolName === 'PRESET_WARP3') {
          // 4-layer stacked combo: Mid-Wave (145f), Warp Effect (63f), Ghost Effect (125f), Hue Spin (70f)
          const mwStart = Math.max(0, curTime - 60 * fd);
          const mwDur = 145 * fd;
          const mwAdj = addAdjustmentLayer(mwDur, mwStart);
          if (mwAdj) {
            mwAdj.name = 'Mid-Wave';
            mwAdj.effects = mwAdj.effects || [];
            const tileFx = reg ? reg.createInstance('tile', 'Tile') : null;
            if (tileFx) { tileFx.scale = 150; tileFx.mirror = 1; mwAdj.effects.push(tileFx); }
            const ww1 = reg ? reg.createInstance('wave-warp', 'Wave Warp 1') : null;
            if (ww1) {
              ww1.waveType = 'sine'; ww1.waveWidth = 1200; ww1.direction = 45; ww1.speed = 1.3; ww1.pinning = 'horizontal'; ww1.phase = 90;
              mwAdj.effects.push(ww1);
              addEffectParamKeyframe(mwAdj, ww1, 'waveHeight', mwStart, 0, [0.17, 0.75, 0.001, 0.001]);
              addEffectParamKeyframe(mwAdj, ww1, 'waveHeight', curTime, 100, [0.001, 0.001, 0.75, 0.17]);
              addEffectParamKeyframe(mwAdj, ww1, 'waveHeight', mwStart + mwDur, 0, [0.75, 0.17, 1.0, 1.0]);
            }
            const ww2 = reg ? reg.createInstance('wave-warp', 'Wave Warp 2') : null;
            if (ww2) {
              ww2.waveType = 'sine'; ww2.waveWidth = 1200; ww2.direction = -45; ww2.speed = 1.3; ww2.pinning = 'horizontal'; ww2.phase = 90;
              mwAdj.effects.push(ww2);
              addEffectParamKeyframe(mwAdj, ww2, 'waveHeight', mwStart, 0, [0.17, 0.75, 0.001, 0.001]);
              addEffectParamKeyframe(mwAdj, ww2, 'waveHeight', curTime, 100, [0.001, 0.001, 0.75, 0.17]);
              addEffectParamKeyframe(mwAdj, ww2, 'waveHeight', mwStart + mwDur, 0, [0.75, 0.17, 1.0, 1.0]);
            }
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(mwAdj);
          }

          const wpDur = 63 * fd;
          const wpAdj = addAdjustmentLayer(wpDur, curTime);
          if (wpAdj) {
            wpAdj.name = 'Warp Effect';
            wpAdj.effects = wpAdj.effects || [];
            const warpFx = reg ? reg.createInstance('wave-warp', 'Wave Warp') : null;
            if (warpFx) {
              warpFx.waveType = 'smooth-noise'; warpFx.waveWidth = 109; warpFx.direction = 0; warpFx.speed = 0.2; warpFx.pinning = 'all'; warpFx.phase = 1;
              wpAdj.effects.push(warpFx);
              addEffectParamKeyframe(wpAdj, warpFx, 'waveHeight', curTime, 228, [0.0, -5.0, 0.1, 1.0]);
              addEffectParamKeyframe(wpAdj, warpFx, 'waveHeight', curTime + wpDur, 0, [0.0, -5.0, 0.1, 1.0]);
            }
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(wpAdj);
          }

          const ghDur = 125 * fd;
          const ghAdj = addAdjustmentLayer(ghDur, curTime);
          if (ghAdj) {
            ghAdj.name = 'Ghost Effect';
            ghAdj.effects = ghAdj.effects || [];
            const tfFx = reg ? reg.createInstance('transform', 'Transform') : null;
            if (tfFx) ghAdj.effects.push(tfFx);
            addEffectParamKeyframe(ghAdj, tfFx || { id: 'tf' }, 'scale', curTime, 100, [0.0, 0.1, 0.0, 0.95]);
            addEffectParamKeyframe(ghAdj, tfFx || { id: 'tf' }, 'scale', curTime + ghDur, 250, [0.0, 0.1, 0.0, 0.95]);
            addLayerPropKeyframe(ghAdj, 'opacity', curTime, { opacity: 1.0 }, [0.0, 0.1, 0.0, 0.95]);
            addLayerPropKeyframe(ghAdj, 'opacity', curTime + ghDur, { opacity: 0.0 }, [0.0, 0.1, 0.0, 0.95]);
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(ghAdj);
          }

          const hsDur = 70 * fd;
          const hsAdj = addAdjustmentLayer(hsDur, curTime);
          if (hsAdj) {
            hsAdj.name = 'Hue Spin';
            hsAdj.effects = hsAdj.effects || [];
            const hueFx = reg ? reg.createInstance('hue-shift', 'Hue Shift') : null;
            if (hueFx) {
              hsAdj.effects.push(hueFx);
              addEffectParamKeyframe(hsAdj, hueFx, 'hue', curTime, 0, [0.0, 0.0, 1.0, 1.0]);
              addEffectParamKeyframe(hsAdj, hueFx, 'hue', curTime + hsDur, 360, [0.0, 0.0, 1.0, 1.0]);
            }
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(hsAdj);
          }

          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          if (typeof redrawComposition === 'function') redrawComposition('warp-preset');
          showEditorToast('Warp Preset 2 diterapkan (4-Layer Adjustment Stack)');
          return true;
        }

        return false;
      }

      function applyTransitionEffect(toolName, targets) {
        if (typeof window.applyTransitionKeyframes === 'function') {
          return window.applyTransitionKeyframes(toolName);
        }
        if (!targets || !targets.length) {
          const msg = `Pilih layer terlebih dahulu untuk ${toolName}`;
          showEditorToast(msg, 2400, 'error');
          return { error: true, message: msg };
        }
        const pps = window.currentPixelsPerSecond || 80;
        const fd = 1 / ((currentProjectState && currentProjectState.fps) || 60);
        const dur = 15 * fd;
        const f9 = [0.33, 0.0, 0.67, 1.0];

        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        targets.forEach(layer => {
          const inP = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
          const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
          const outP = inP + durSec;
          const origScaleW = layer.scaleW !== undefined ? layer.scaleW : 100;
          const origScaleH = layer.scaleH !== undefined ? layer.scaleH : 100;

          if (toolName === 'TRANS_FADE_IN') {
            addLayerPropKeyframe(layer, 'opacity', inP, { opacity: 0.0 }, f9);
            addLayerPropKeyframe(layer, 'opacity', inP + dur, { opacity: 1.0 }, f9);
          } else if (toolName === 'TRANS_FADE_OUT') {
            addLayerPropKeyframe(layer, 'opacity', Math.max(inP, outP - dur), { opacity: 1.0 }, f9);
            addLayerPropKeyframe(layer, 'opacity', outP, { opacity: 0.0 }, f9);
          } else if (toolName === 'TRANS_SCALE_IN') {
            addLayerPropKeyframe(layer, 'scale', inP, { scaleW: 0, scaleH: 0 }, f9);
            addLayerPropKeyframe(layer, 'scale', inP + dur, { scaleW: origScaleW, scaleH: origScaleH }, f9);
          } else if (toolName === 'TRANS_SCALE_OUT') {
            addLayerPropKeyframe(layer, 'scale', Math.max(inP, outP - dur), { scaleW: origScaleW, scaleH: origScaleH }, f9);
            addLayerPropKeyframe(layer, 'scale', outP, { scaleW: 0, scaleH: 0 }, f9);
          }
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
        });

        if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
        if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
        if (typeof redrawComposition === 'function') redrawComposition('trans');
        showEditorToast(`Transisi: ${toolName.replace('TRANS_', '').replace('_', ' ')} diterapkan`);
        return true;
      }

      function applyCutefishEffect(toolName, targets) {
        if (!targets || !targets.length) {
          const msg = `Pilih layer terlebih dahulu untuk Cutefish ${toolName}`;
          showEditorToast(msg, 2400, 'error');
          return { error: true, message: msg };
        }
        const targetLayer = targets[0];
        const pps = window.currentPixelsPerSecond || 80;
        const inPoint = targetLayer.startSec !== undefined ? targetLayer.startSec : ((targetLayer.startPx || 0) / pps);
        const durationSec = targetLayer.durationSec !== undefined ? targetLayer.durationSec : ((targetLayer.widthPx || 320) / pps);
        const reg = (window.FishEffects && window.FishEffects.registry) || window.FishEffectsRegistry;

        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        switch (toolName) {
          case 'CF_COLORIZE': {
            const adj = addAdjustmentLayer(durationSec, inPoint);
            if (adj) {
              adj.name = 'CF Colorize';
              adj.effects = adj.effects || [];
              const tintFx = reg ? reg.createInstance('tint', 'Tint') : null;
              if (tintFx) {
                const randomHex = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
                tintFx.mapWhiteTo = randomHex;
                adj.effects.push(tintFx);
              }
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(adj);
              showEditorToast('CF Colorize dibuat (Adjustment Layer)');
            }
            break;
          }
          case 'CF_SCANLINE': {
            const adj = addAdjustmentLayer(durationSec, inPoint);
            if (adj) {
              adj.name = 'CF Scanline';
              adj.effects = adj.effects || [];
              const scanFx = reg ? reg.createInstance('scanline', 'Scanline') : null;
              if (scanFx) adj.effects.push(scanFx);
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(adj);
              showEditorToast('CF Scanline dibuat (Adjustment Layer)');
            }
            break;
          }
          case 'CF_MONO': {
            const adj = addAdjustmentLayer(durationSec, inPoint);
            if (adj) {
              adj.name = 'CF Mono';
              adj.effects = adj.effects || [];
              const monoFx = reg ? reg.createInstance('mono', 'Black & White') : null;
              if (monoFx) adj.effects.push(monoFx);
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(adj);
              showEditorToast('CF Mono dibuat (Adjustment Layer)');
            }
            break;
          }
          case 'CF_STARBURST': {
            const sol = (typeof addSolidLayer === 'function') ? addSolidLayer(durationSec, inPoint) : null;
            if (sol) {
              sol.name = 'CF Starburst';
              sol.effects = sol.effects || [];
              const sbFx = reg ? reg.createInstance('star_burst', 'Star Burst') : null;
              if (sbFx) sol.effects.push(sbFx);
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(sol);
              showEditorToast('CF Starburst dibuat (Solid Layer)');
            }
            break;
          }
          case 'CF_GRID': {
            const sol = (typeof addSolidLayer === 'function') ? addSolidLayer(durationSec, inPoint) : null;
            if (sol) {
              sol.name = 'CF Grid';
              sol.effects = sol.effects || [];
              const gridFx = reg ? reg.createInstance('grid', 'Grid') : null;
              if (gridFx) sol.effects.push(gridFx);
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(sol);
              showEditorToast('CF Grid dibuat (Solid Layer)');
            }
            break;
          }
          case 'CF_RADIO': {
            const sol = (typeof addSolidLayer === 'function') ? addSolidLayer(durationSec, inPoint) : null;
            if (sol) {
              sol.name = 'CF Radio';
              sol.blendMode = 'screen';
              sol.effects = sol.effects || [];
              const radFx = reg ? reg.createInstance('radio_waves', 'Radio Waves') : null;
              if (radFx) sol.effects.push(radFx);
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(sol);
              showEditorToast('CF Radio dibuat (Solid Layer)');
            }
            break;
          }
          case 'CF_GLOW_AURA': {
            targets.forEach(l => {
              l.effects = l.effects || [];
              const fx = reg ? reg.createInstance('glow_aura', 'Glow Aura') : null;
              if (fx) l.effects.push(fx);
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(l);
            });
            showEditorToast('CF Glow Aura diterapkan pada layer');
            break;
          }
          case 'CF_SOLID_AURA': {
            targets.forEach(l => {
              l.effects = l.effects || [];
              const fx = reg ? reg.createInstance('solid_aura', 'Solid Aura') : null;
              if (fx) l.effects.push(fx);
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(l);
            });
            showEditorToast('CF Solid Aura diterapkan pada layer');
            break;
          }
          case 'CF_SHATTER_SIMPLE': {
            targets.forEach(l => {
              l.effects = l.effects || [];
              const fx = reg ? reg.createInstance('shatter', 'Shatter') : null;
              if (fx) l.effects.push(fx);
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(l);
            });
            showEditorToast('CF Shatter Simple diterapkan');
            break;
          }
          case 'CF_SHATTER_SLOW': {
            targets.forEach(l => {
              l.effects = l.effects || [];
              const fx = reg ? reg.createInstance('shatter', 'Shatter') : null;
              if (fx) {
                fx.gravity = 0;
                l.effects.push(fx);
              }
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(l);
            });
            showEditorToast('CF Shatter Slow diterapkan');
            break;
          }
          case 'CF_DROP_BEVEL': {
            targets.forEach(l => {
              l.effects = l.effects || [];
              const bev = reg ? reg.createInstance('bevel', 'Bevel') : null;
              if (bev) l.effects.push(bev);
              const drop = reg ? reg.createInstance('drop_shadow', 'Drop Shadow') : null;
              if (drop) l.effects.push(drop);
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(l);
            });
            showEditorToast('CF Drop Bevel diterapkan');
            break;
          }
          default:
            return false;
        }

        if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
        if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
        if (typeof redrawComposition === 'function') redrawComposition('cutefish');
        return true;
      }

      function _editorExecuteFishToolInternal(toolName, ...args) {
        if (!toolName) return false;

        let baseW = (currentProjectState && (currentProjectState._baseW || currentProjectState.baseW || currentProjectState.width)) || 0;
        let baseH = (currentProjectState && (currentProjectState._baseH || currentProjectState.baseH || currentProjectState.height)) || 0;

        if (window.currentActivePrecomp) {
          baseW = Math.round(Math.abs(window.currentActivePrecomp.mediaWidth || window.currentActivePrecomp.scaleW || baseW || 0));
          baseH = Math.round(Math.abs(window.currentActivePrecomp.mediaHeight || window.currentActivePrecomp.scaleH || baseH || 0));
        }

        if (!baseW || !baseH) {
          const res = (currentProjectState && currentProjectState.resolution) || '1080p';
          const aspect = (currentProjectState && currentProjectState.aspectRatio) || '16:9';
          const baseDims = window.getProjectDimensions ? window.getProjectDimensions(res, aspect) : [1920, 1080];
          baseW = (baseDims && (baseDims.width || baseDims[0])) || 1920;
          baseH = (baseDims && (baseDims.height || baseDims[1])) || 1080;
        }

        switch (toolName) {
          // --- ANCHOR POINT (9-POINT GRID) ---
          case 'setAnchorPoint': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk mengubah anchor point';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }

            const pos = parseInt(args[0], 10) || 5;
            const col = (pos - 1) % 3; // 0: left, 1: center, 2: right
            const row = Math.floor((pos - 1) / 3); // 0: top, 1: middle, 2: bottom

            const posNames = [
              'Top Left', 'Top Center', 'Top Right',
              'Middle Left', 'Center', 'Middle Right',
              'Bottom Left', 'Bottom Center', 'Bottom Right'
            ];
            const posName = posNames[pos - 1] || 'Center';

            if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
              window.UndoRedoManager.recordSnapshot();
            }

            targets.forEach(layer => {
              if (typeof syncLayerWithEffectiveProps === 'function') {
                syncLayerWithEffectiveProps(layer);
              }

              let rawW = layer.scaleW;
              let rawH = layer.scaleH;
              if (rawW === undefined || rawH === undefined) {
                if (layer.type === 'text' && window.FishTextEngine && typeof window.FishTextEngine.getNaturalSize === 'function') {
                  const nat = window.FishTextEngine.getNaturalSize(layer);
                  const sx = (typeof layer.transformScaleX === 'number' && !isNaN(layer.transformScaleX)) ? layer.transformScaleX : 1.0;
                  const sy = (typeof layer.transformScaleY === 'number' && !isNaN(layer.transformScaleY)) ? layer.transformScaleY : 1.0;
                  if (rawW === undefined) rawW = (nat.width || 320) * sx;
                  if (rawH === undefined) rawH = (nat.height || 100) * sy;
                } else if (layer.type === 'shape' && layer.shapeProps) {
                  const sx = (typeof layer.transformScaleX === 'number' && !isNaN(layer.transformScaleX)) ? layer.transformScaleX : 1.0;
                  const sy = (typeof layer.transformScaleY === 'number' && !isNaN(layer.transformScaleY)) ? layer.transformScaleY : 1.0;
                  if (rawW === undefined) rawW = (Number(layer.shapeProps.sizeX) || 300) * sx;
                  if (rawH === undefined) rawH = (Number(layer.shapeProps.sizeY) || 300) * sy;
                }
              }

              const w = rawW !== undefined ? Math.abs(rawW) : (layer.normW !== undefined ? Math.abs(layer.normW * baseW) : (layer.mediaWidth || 300));
              const h = rawH !== undefined ? Math.abs(rawH) : (layer.normH !== undefined ? Math.abs(layer.normH * baseH) : (layer.mediaHeight || 300));
              const signX = (rawW !== undefined && rawW < 0) ? -1 : 1;
              const signY = (rawH !== undefined && rawH < 0) ? -1 : 1;

              let newAx = 0;
              let newAy = 0;
              if (col === 0) newAx = -w / 2;
              else if (col === 1) newAx = 0;
              else if (col === 2) newAx = w / 2;

              if (row === 0) newAy = -h / 2;
              else if (row === 1) newAy = 0;
              else if (row === 2) newAy = h / 2;

              const oldAx = layer.anchorX || 0;
              const oldAy = layer.anchorY || 0;
              const dAx = (newAx - oldAx) * signX;
              const dAy = (newAy - oldAy) * signY;

              const curRot = layer.rotZ !== undefined ? layer.rotZ : (layer.rotation || 0);
              const rad = (curRot * Math.PI) / 180;
              const cos = Math.cos(rad);
              const sin = Math.sin(rad);

              const curPosX = layer.posX !== undefined ? layer.posX : (baseW / 2);
              const curPosY = layer.posY !== undefined ? layer.posY : (baseH / 2);

              const newPosX = curPosX - (dAx * (1 - cos) + dAy * sin);
              const newPosY = curPosY - (dAy * (1 - cos) - dAx * sin);
              const deltaPosX = newPosX - curPosX;
              const deltaPosY = newPosY - curPosY;

              layer.anchorX = Number(newAx.toFixed(2));
              layer.anchorY = Number(newAy.toFixed(2));
              layer.posX = Number(newPosX.toFixed(2));
              layer.posY = Number(newPosY.toFixed(2));

              if (layer.keyframes && Array.isArray(layer.keyframes.move) && layer.keyframes.move.length > 0) {
                layer.keyframes.move.forEach(kf => {
                  if (kf && kf.value && typeof kf.value === 'object') {
                    kf.value.anchorX = layer.anchorX;
                    kf.value.anchorY = layer.anchorY;
                    if (kf.value.posX !== undefined) kf.value.posX = Number((kf.value.posX + deltaPosX).toFixed(2));
                    if (kf.value.posY !== undefined) kf.value.posY = Number((kf.value.posY + deltaPosY).toFixed(2));
                  }
                });
              }

              if (layer.normW) layer.normX = (layer.posX - (layer.normW * baseW) / 2) / baseW;
              if (layer.normH) layer.normY = (layer.posY - (layer.normH * baseH) / 2) / baseH;

              if (typeof invalidatePreviewCacheForLayer === 'function') {
                invalidatePreviewCacheForLayer(layer);
              }
            });

            if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
            if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
            if (typeof window.syncInspectorState === 'function') window.syncInspectorState();
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            if (typeof redrawComposition === 'function') redrawComposition('setAnchorPoint');
            if (window.CanvasOverlay && typeof window.CanvasOverlay.redraw === 'function') window.CanvasOverlay.redraw();

            showEditorToast(`Anchor Point: ${posName}`);
            return true;
          }

          // --- 6-WAY ALIGNMENT ---
          case 'ALIGN_LEFT':
          case 'ALIGN_HCENTER':
          case 'ALIGN_RIGHT':
          case 'ALIGN_TOP':
          case 'ALIGN_VCENTER':
          case 'ALIGN_BOTTOM': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk perataan (Align)';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }

            if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
              window.UndoRedoManager.recordSnapshot();
            }

            const alignLabels = {
              'ALIGN_LEFT': 'Align Left',
              'ALIGN_HCENTER': 'Align Horizontal Center',
              'ALIGN_RIGHT': 'Align Right',
              'ALIGN_TOP': 'Align Top',
              'ALIGN_VCENTER': 'Align Vertical Center',
              'ALIGN_BOTTOM': 'Align Bottom'
            };

            targets.forEach(layer => {
              if (typeof syncLayerWithEffectiveProps === 'function') {
                syncLayerWithEffectiveProps(layer);
              }

              const w = layer.scaleW !== undefined ? Math.abs(layer.scaleW) : (layer.normW !== undefined ? Math.abs(layer.normW * baseW) : (layer.mediaWidth || 300));
              const h = layer.scaleH !== undefined ? Math.abs(layer.scaleH) : (layer.normH !== undefined ? Math.abs(layer.normH * baseH) : (layer.mediaHeight || 300));

              if (toolName === 'ALIGN_LEFT') layer.posX = Number((w / 2).toFixed(2));
              else if (toolName === 'ALIGN_HCENTER') layer.posX = Number((baseW / 2).toFixed(2));
              else if (toolName === 'ALIGN_RIGHT') layer.posX = Number((baseW - w / 2).toFixed(2));
              else if (toolName === 'ALIGN_TOP') layer.posY = Number((h / 2).toFixed(2));
              else if (toolName === 'ALIGN_VCENTER') layer.posY = Number((baseH / 2).toFixed(2));
              else if (toolName === 'ALIGN_BOTTOM') layer.posY = Number((baseH - h / 2).toFixed(2));

              if (layer.normW) layer.normX = (layer.posX - (layer.normW * baseW) / 2) / baseW;
              if (layer.normH) layer.normY = (layer.posY - (layer.normH * baseH) / 2) / baseH;

              if (typeof recordLayerPropertyChange === 'function') {
                recordLayerPropertyChange(layer, 'move');
              }
              if (typeof invalidatePreviewCacheForLayer === 'function') {
                invalidatePreviewCacheForLayer(layer);
              }
            });

            if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
            if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
            if (typeof window.syncInspectorState === 'function') window.syncInspectorState();
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            if (typeof redrawComposition === 'function') redrawComposition('align');
            if (window.CanvasOverlay && typeof window.CanvasOverlay.redraw === 'function') window.CanvasOverlay.redraw();

            showEditorToast(alignLabels[toolName] || 'Layer diratakan');
            return true;
          }

          // --- CUT & TRIM ---
          case 'CUT_FRONT':
          case 'CUT_LEFT': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk memotong (Cut Front)';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            if (typeof executeCutLeft === 'function') executeCutLeft();
            else if (typeof executeTrimIn === 'function') executeTrimIn();
            showEditorToast('Cut Front');
            return true;
          }
          case 'CUT_MID': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk membagi (Cut Mid)';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            if (typeof executeCutMid === 'function') executeCutMid();
            showEditorToast('Split Layer');
            return true;
          }
          case 'CUT_BACK':
          case 'CUT_RIGHT': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk memotong (Cut Back)';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            if (typeof executeCutRight === 'function') executeCutRight();
            else if (typeof executeTrimOut === 'function') executeTrimOut();
            showEditorToast('Cut Back');
            return true;
          }

          // --- QUICK ACTIONS ---
          case 'PRECOMP': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk membuat Precompose';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            if (typeof precomposeSelectedLayers === 'function') {
              precomposeSelectedLayers(false, 'normal');
              showEditorToast('Precompose dibuat');
            }
            return true;
          }
          case 'CENTER':
          case 'CENTERINCOMP': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk memusatkan posisi';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
              window.UndoRedoManager.recordSnapshot();
            }
            targets.forEach(layer => {
              layer.posX = Number((baseW / 2).toFixed(2));
              layer.posY = Number((baseH / 2).toFixed(2));
              if (layer.normW) layer.normX = (layer.posX - (layer.normW * baseW) / 2) / baseW;
              if (layer.normH) layer.normY = (layer.posY - (layer.normH * baseH) / 2) / baseH;
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            });
            if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
            if (typeof window.syncInspectorState === 'function') window.syncInspectorState();
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            if (typeof redrawComposition === 'function') redrawComposition('center');
            showEditorToast('Layer dipusatkan ke tengah viewport');
            return true;
          }
          case 'OVERLAP': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk menerapkan Overlap';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            if (typeof applyKeyframeOverlap === 'function') {
              const res = applyKeyframeOverlap();
              if (res && res.error) {
                showEditorToast(res.message || 'Gagal menerapkan Overlap', 2400, 'error');
                return res;
              }
            }
            return true;
          }
          case 'SCREENSHOT':
          case 'PNG': {
            const canvas = document.getElementById('editor-active-canvas');
            if (!canvas) {
              showEditorToast('Canvas tidak ditemukan untuk screenshot', 2400, 'error');
              return { error: true, message: 'Canvas tidak ditemukan' };
            }
            try {
              const dataUrl = canvas.toDataURL('image/png');
              const a = document.createElement('a');
              a.download = `snapshot_${Date.now()}.png`;
              a.href = dataUrl;
              a.click();
              showEditorToast('Frame snapshot berhasil disimpan!');
              return true;
            } catch (err) {
              showEditorToast('Gagal mengambil screenshot: ' + err.message, 2400, 'error');
              return { error: true, message: err.message };
            }
          }
          case 'DUP_COMP':
          case 'DUP': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk menduplikasi';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            const isPrecomp = targets.some(l => l.type === 'precomp');
            if (isPrecomp && typeof duplicatePrecompLayer === 'function') {
              duplicatePrecompLayer();
              showEditorToast('Precompose berhasil diduplikasi');
            } else if (typeof duplicateSelectedLayers === 'function') {
              duplicateSelectedLayers();
              showEditorToast('Layer berhasil diduplikasi');
            }
            return true;
          }

          // --- TOOLBOX: LAYER ---
          case 'FRZ': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk Freeze Frame';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            const playheadSec = (typeof getPlayheadSecForOperation === 'function') ? getPlayheadSecForOperation() : 0;
            targets.forEach(layer => {
              layer.freezeTime = playheadSec;
              layer.isFrozen = true;
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            });
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            if (typeof redrawComposition === 'function') redrawComposition('freeze');
            showEditorToast('Freeze Frame diterapkan');
            return true;
          }
          case 'FIT': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk Fit to Comp';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
              window.UndoRedoManager.recordSnapshot();
            }
            targets.forEach(layer => {
              layer.scaleW = baseW;
              layer.scaleH = baseH;
              layer.posX = Number((baseW / 2).toFixed(2));
              layer.posY = Number((baseH / 2).toFixed(2));
              layer.anchorX = 0;
              layer.anchorY = 0;
              layer.normW = 1.0;
              layer.normH = 1.0;
              layer.normX = 0;
              layer.normY = 0;
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            });
            if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
            if (typeof window.syncInspectorState === 'function') window.syncInspectorState();
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            if (typeof redrawComposition === 'function') redrawComposition('fit');
            showEditorToast('Layer disesuaikan ke ukuran komposisi (Fit)');
            return true;
          }
          case 'DSH': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk efek Drop Shadow';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            if (typeof addEffectToLayer === 'function') {
              addEffectToLayer('drop-shadow');
              showEditorToast('Efek Drop Shadow ditambahkan');
            }
            return true;
          }
          case 'MIR': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = 'Pilih layer terlebih dahulu untuk Mirror / Flip';
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
              window.UndoRedoManager.recordSnapshot();
            }
            targets.forEach(layer => {
              const curW = layer.scaleW !== undefined ? layer.scaleW : 300;
              layer.scaleW = -curW;
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            });
            if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
            if (typeof window.syncInspectorState === 'function') window.syncInspectorState();
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            if (typeof redrawComposition === 'function') redrawComposition('mirror');
            showEditorToast('Layer dibalik secara horizontal (Mirror)');
            return true;
          }

          // --- TOOLBOX: CREATE ---
          case 'SHA': {
            if (typeof addShapeLayer === 'function') {
              const timing = (typeof getSelectedLayerTiming === 'function') ? getSelectedLayerTiming() : {};
              addShapeLayer('rectangle', { durationSec: timing.durationSec, startSec: timing.startSec });
              showEditorToast('Shape Layer baru dibuat');
            }
            return true;
          }
          case 'SOL': {
            if (typeof addSolidLayer === 'function') {
              const timing = (typeof getSelectedLayerTiming === 'function') ? getSelectedLayerTiming() : {};
              addSolidLayer(timing.durationSec, timing.startSec, args[0]);
              showEditorToast('Solid Layer baru dibuat');
            }
            return true;
          }
          case 'NUL': {
            if (typeof addNullLayer === 'function') {
              const timing = (typeof getSelectedLayerTiming === 'function') ? getSelectedLayerTiming() : {};
              addNullLayer(args[0] === true, { durationSec: timing.durationSec, startSec: timing.startSec });
              showEditorToast('Null Object baru dibuat');
            }
            return true;
          }
          case 'CAM': {
            if (typeof addCameraLayer === 'function') {
              const timing = (typeof getSelectedLayerTiming === 'function') ? getSelectedLayerTiming() : {};
              addCameraLayer(timing.durationSec, timing.startSec);
              showEditorToast('Camera Layer baru dibuat');
            }
            return true;
          }
          case 'ADJ': {
            if (typeof addAdjustmentLayer === 'function') {
              const timing = (typeof getSelectedLayerTiming === 'function') ? getSelectedLayerTiming() : {};
              addAdjustmentLayer(timing.durationSec, timing.startSec);
              showEditorToast('Adjustment Layer baru dibuat');
            }
            return true;
          }

          // --- TOOLBOX: EFFECTS ---
          case 'FILL':
          case 'TINT':
          case 'BLUR':
          case 'LUM':
          case 'CURV':
          case 'HUE': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = `Pilih layer terlebih dahulu untuk efek ${toolName}`;
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            const fxMap = {
              'FILL': 'fill',
              'TINT': 'tint',
              'BLUR': 'fast-box-blur',
              'LUM': 'lumia',
              'CURV': 'curve',
              'HUE': 'hue-shift'
            };
            const fxId = fxMap[toolName];
            if (typeof addEffectToLayer === 'function' && fxId) {
              addEffectToLayer(fxId);
              showEditorToast(`Efek ${toolName} ditambahkan`);
            }
            return true;
          }

          // --- BEAT EFFECTS & PRESETS (AUTHENTIC NULL-PARENT & ADJUSTMENT ARCHITECTURE) ---
          case 'Y_BEAT':
          case 'X_BEAT':
          case 'Y_FLIP':
          case 'X_FLIP':
          case 'SCALE_BEAT':
          case 'SCALE_OVERLAP':
          case 'OSCILLATE':
          case 'SWING':
          case 'PANNING_POS':
          case 'PANNING_ROT':
          case 'PANNING_SCALE':
          case 'PANNING_MIX_PR':
          case 'PANNING_MIX_ALL':
          case 'IDLE_MOVE_1':
          case 'IDLE_MOVE_2':
          case 'IDLE_MOVE_3':
          case 'IDLE_MOVE_4':
          case 'IDLE_MOVE_5':
          case 'IDLE_MOVE_6': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = `Pilih layer terlebih dahulu untuk ${toolName}`;
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            return applyNullBeatEffect(toolName, targets);
          }

          case 'EXPO':
          case 'LENS':
          case 'BLUR':
          case 'SHAKY':
          case 'GHST':
          case 'WARP':
          case 'FISHEYE':
          case 'MIDWAVE':
          case 'HUESPIN': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = `Pilih layer terlebih dahulu untuk ${toolName}`;
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            return applyAdjustmentBeatEffect(toolName, targets, args);
          }

          case 'PRESET_WARP1':
          case 'PRESET_WARP2':
          case 'PRESET_WARP3': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = `Pilih layer terlebih dahulu untuk ${toolName}`;
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            return applyWarpPreset(toolName, targets);
          }

          // --- TRANSITIONS ---
          case 'TRANS_FADE_IN':
          case 'TRANS_FADE_OUT':
          case 'TRANS_SCALE_IN':
          case 'TRANS_SCALE_OUT': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = `Pilih layer terlebih dahulu untuk ${toolName.replace('TRANS_', '').replace('_', ' ')}`;
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            return applyTransitionEffect(toolName, targets);
          }

          // --- CUTEFISH STYLE ---
          case 'CF_COLORIZE':
          case 'CF_SCANLINE':
          case 'CF_MONO':
          case 'CF_STARBURST':
          case 'CF_GRID':
          case 'CF_RADIO':
          case 'CF_GLOW_AURA':
          case 'CF_SOLID_AURA':
          case 'CF_SHATTER_SIMPLE':
          case 'CF_SHATTER_SLOW':
          case 'CF_DROP_BEVEL': {
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const msg = `Pilih layer terlebih dahulu untuk Cutefish ${toolName.replace('CF_', '').replace('_', ' ')}`;
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            return applyCutefishEffect(toolName, targets);
          }

          // --- VELOCITY ---
          case 'TWIX':
          case 'TMRE': {
            if (toolName === 'TWIX' && typeof window.applyTwixtorVelocity === 'function') {
              return window.applyTwixtorVelocity();
            }
            if (toolName === 'TMRE' && typeof window.applyTimeRemapVelocity === 'function') {
              return window.applyTimeRemapVelocity();
            }
            const targets = getSelectedLayersForFishTool();
            if (!targets.length) {
              const label = toolName === 'TWIX' ? 'Twixtor' : 'Time Remapping';
              const msg = `Pilih layer terlebih dahulu untuk menggunakan ${label}`;
              showEditorToast(msg, 2400, 'error');
              return { error: true, message: msg };
            }
            const targetLayer = targets[0];
            if (toolName === 'TMRE') {
              targetLayer.timeRemapEnabled = true;
              showEditorToast('Time Remapping diaktifkan');
            } else {
              showEditorToast('Twixtor Speed Ramping diterapkan');
            }
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(targetLayer);
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            if (typeof redrawComposition === 'function') redrawComposition('velocity');
            return true;
          }

          // --- FORMAT & FPS ---
          case 'setCompositionFormat': {
            const w = parseInt(args[0], 10) || 1920;
            const h = parseInt(args[1], 10) || 1080;
            let ratioStr = `${w}:${h}`;
            if (w === 1920 && h === 1080) ratioStr = '16:9';
            else if (w === 1080 && h === 1920) ratioStr = '9:16';
            else if (w === 1080 && h === 1080) ratioStr = '1:1';
            else if (w === 1080 && h === 1440) ratioStr = '3:4';
            else if (w === 1440 && h === 1080) ratioStr = '4:3';

            if (typeof updatePreviewCanvas === 'function') {
              updatePreviewCanvas(ratioStr, currentProjectState.resolution || '1080p', currentProjectState.fps || 60, currentProjectState.bgColor || 'transparent');
              showEditorToast(`Format Komposisi: ${ratioStr} (${w}×${h})`);
            }
            return true;
          }
          case 'setCompositionFPS': {
            const fps = parseInt(args[0], 10) || 60;
            if (typeof updatePreviewCanvas === 'function') {
              updatePreviewCanvas(currentProjectState.aspectRatio || '16:9', currentProjectState.resolution || '1080p', fps, currentProjectState.bgColor || 'transparent');
              showEditorToast(`Frame Rate: ${fps} FPS`);
            }
            return true;
          }

          // --- 3D GENERATOR & CUBE GENERATOR ---
          case 'CUBE':
          case 'CREATE_CUBE': {
            return createProceduralCube(args[0], args[1], args[2], args[3]);
          }
          case 'GEN_3D_3SPLIT':
          case 'GEN_3D_2SPLIT':
          case 'GEN_3D_TUNNEL':
          case 'GEN_3D_PHONE':
          case 'GEN_3D_ZFLIP':
          case 'GEN_3D_ZFOLD':
          case 'GEN_3D_TABLET':
          case 'GEN_3D_LAPTOP':
          case 'GEN_3D_MONITOR':
          case 'GEN_3D_PC':
          case 'GEN_3D_CRT':
          case 'GEN_3D_ROOM':
          case 'GEN_3D_DOOR':
          case 'GEN_3D_WINDOW':
          case 'GEN_3D_TABLE':
          case 'GEN_3D_DESK':
          case 'GEN_3D_CABINET':
          case 'GEN_3D_BOX':
          case 'GEN_3D_BOOK':
          case 'GEN_3D_BINDER':
          case 'GEN_3D_GLASSES':
          case 'GEN_3D_MC': {
            return createProcedural3D(toolName.replace('GEN_3D_', ''));
          }

          // --- AUTO MARK / BEATMARK GENERATOR ---
          case 'AUTO_MARK':
          case 'AUTO_BEATMARK': {
            return generateAutoBeatmarks(args[0]);
          }

          default: {
            console.warn('[executeFishTool] Unhandled tool:', toolName, args);
            showEditorToast(`Tool: ${toolName}`);
            return true;
          }
        }
      }

      function createProceduralCube(arg0) {
        const opts = (arg0 && typeof arg0 === 'object') ? arg0 : {};
        if (opts.useLayer) {
          const targets = getSelectedLayersForFishTool();
          if (!targets.length) {
            const msg = 'Pilih layer terlebih dahulu untuk membuat kubus dari layer';
            showEditorToast(msg, 2400, 'error');
            return { error: true, message: msg };
          }
        }
        const targets = getSelectedLayersForFishTool();
        if (targets.length && typeof addEffectToLayer === 'function') {
          addEffectToLayer('box_3d');
          showEditorToast('Kubus 3D diterapkan pada layer');
          return true;
        }
        if (typeof addSolidLayer === 'function') {
          addSolidLayer();
          if (typeof addEffectToLayer === 'function') addEffectToLayer('box_3d');
          showEditorToast('Kubus 3D baru dibuat');
          return true;
        }
        showEditorToast('Kubus 3D dibuat');
        return true;
      }

      function createProcedural3D(sceneType = 'CUBE') {
        const label = String(sceneType || '3D').replace(/^GEN_3D_/i, '');
        const targets = getSelectedLayersForFishTool();
        if (targets.length) {
          if (typeof addEffectToLayer === 'function') addEffectToLayer('box_3d');
          showEditorToast(`3D Scene: ${label} diterapkan`);
        } else if (typeof addSolidLayer === 'function') {
          addSolidLayer();
          if (typeof addEffectToLayer === 'function') addEffectToLayer('box_3d');
          showEditorToast(`3D Scene: ${label} dibuat`);
        } else {
          showEditorToast('Pilih layer terlebih dahulu untuk membuat scene 3D', 2400, 'error');
        }
        return true;
      }

      function createProcedural2Split() { return createProcedural3D('2SPLIT'); }
      function createProcedural3Split() { return createProcedural3D('3SPLIT'); }
      function createProceduralTunnel() { return createProcedural3D('TUNNEL'); }
      function createProceduralMC() { return createProcedural3D('MC'); }

      // -------------------------------------------------------------
      // AUTO MARK: AUTOMATIC BEATMARK MAKER ENGINE (BASS & BPM)
      // -------------------------------------------------------------
      async function getAudioBufferForLayer(layer) {
        if (!layer) return null;
        if (layer.audioBuffer && typeof layer.audioBuffer.getChannelData === 'function') {
          return layer.audioBuffer;
        }
        let audioSrc = layer.dataUrl || layer.url || layer.src;
        let blobToRevoke = null;

        if (!audioSrc && layer.blob) {
          try {
            blobToRevoke = URL.createObjectURL(layer.blob);
            audioSrc = blobToRevoke;
          } catch (_) {}
        }

        if (!audioSrc && window.layerMediaCache) {
          const entry = window.layerMediaCache.get(layer.id) || window.layerMediaCache.get(layer.mediaId);
          if (entry && entry.el && entry.el.src && !entry.el.src.startsWith('data:,')) {
            audioSrc = entry.el.src;
          }
        }

        if (!audioSrc && window._activeMediaMap && layer.mediaId && window._activeMediaMap.has(layer.mediaId)) {
          const item = window._activeMediaMap.get(layer.mediaId);
          if (item) {
            if (item.dataUrl) audioSrc = item.dataUrl;
            else if (item.blob) {
              blobToRevoke = URL.createObjectURL(item.blob);
              audioSrc = blobToRevoke;
            }
          }
        }

        if (!audioSrc && layer.mediaId && window.FishDatabase && typeof window.FishDatabase.getMedia === 'function') {
          try {
            const item = await window.FishDatabase.getMedia(layer.mediaId);
            if (item) {
              if (item.dataUrl) audioSrc = item.dataUrl;
              else if (item.blob) {
                blobToRevoke = URL.createObjectURL(item.blob);
                audioSrc = blobToRevoke;
              } else if (item.buffer) {
                const b = new Blob([item.buffer], { type: item.mimeType || 'audio/mp3' });
                blobToRevoke = URL.createObjectURL(b);
                audioSrc = blobToRevoke;
              }
            }
          } catch (_) {}
        }

        if (!audioSrc) return null;

        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) return null;
          const actx = new AudioCtx();
          let arrayBuffer;
          if (typeof audioSrc === 'string' && audioSrc.startsWith('data:')) {
            const commaIdx = audioSrc.indexOf(',');
            const base64Str = commaIdx !== -1 ? audioSrc.slice(commaIdx + 1) : audioSrc;
            const binaryStr = atob(base64Str);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            arrayBuffer = bytes.buffer;
          } else {
            const res = await fetch(audioSrc);
            arrayBuffer = await res.arrayBuffer();
          }
          const buf = await actx.decodeAudioData(arrayBuffer);
          try { if (actx.state !== 'closed') actx.close(); } catch (_) {}
          return buf;
        } catch (err) {
          console.warn('[AutoMark] Audio decode warning:', err);
          return null;
        } finally {
          if (blobToRevoke) {
            try { URL.revokeObjectURL(blobToRevoke); } catch (_) {}
          }
        }
      }

      function detectBassFromAudioBuffer(audioBuffer, sensitivity = 65, durationLimit = null) {
        if (!audioBuffer) return [];
        const sampleRate = audioBuffer.sampleRate;
        const channelData = audioBuffer.getChannelData(0);
        const totalSamples = durationLimit ? Math.min(channelData.length, Math.floor(durationLimit * sampleRate)) : channelData.length;

        // 2nd Order Butterworth Low-Pass Filter at 160Hz for sub-bass & kick drum
        const cutoff = 160;
        const w0 = 2 * Math.PI * cutoff / sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * 0.707);

        const b0 = (1 - cosw0) / 2;
        const b1 = 1 - cosw0;
        const b2 = (1 - cosw0) / 2;
        const a0 = 1 + alpha;
        const a1 = -2 * cosw0;
        const a2 = 1 - alpha;

        const nb0 = b0 / a0;
        const nb1 = b1 / a0;
        const nb2 = b2 / a0;
        const na1 = a1 / a0;
        const na2 = a2 / a0;

        const hopSize = Math.max(128, Math.floor(sampleRate * 0.012));
        const numHops = Math.floor(totalSamples / hopSize);

        let x1 = 0;
        let x2 = 0;
        let y1 = 0;
        let y2 = 0;
        const hopEnergies = new Float32Array(numHops);
        let hopIdx = 0;
        let currentHopSum = 0;
        let hopSampleCount = 0;

        for (let i = 0; i < totalSamples; i++) {
          const x0 = channelData[i];
          const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
          x2 = x1;
          x1 = x0;
          y2 = y1;
          y1 = y0;

          currentHopSum += y0 * y0;
          hopSampleCount++;

          if (hopSampleCount >= hopSize) {
            hopEnergies[hopIdx] = Math.sqrt(currentHopSum / hopSampleCount);
            currentHopSum = 0;
            hopSampleCount = 0;
            hopIdx++;
            if (hopIdx >= numHops) break;
          }
        }

        const flux = new Float32Array(numHops);
        let maxFlux = 0;
        for (let i = 1; i < numHops; i++) {
          const diff = hopEnergies[i] - hopEnergies[i - 1];
          flux[i] = diff > 0 ? diff : 0;
          if (flux[i] > maxFlux) maxFlux = flux[i];
        }

        if (maxFlux <= 0) return [];

        const winHalf = Math.max(3, Math.floor((sampleRate * 0.20) / hopSize));
        const sensFactor = 0.45 + (100 - Math.max(1, Math.min(100, sensitivity))) * 0.024;
        const minIntervalSec = 0.17;
        const minHopDist = Math.max(2, Math.floor((sampleRate * minIntervalSec) / hopSize));

        const beatTimes = [];
        let lastBeatHop = -minHopDist;

        for (let i = 2; i < numHops - 2; i++) {
          if (i - lastBeatHop < minHopDist) continue;
          if (flux[i] <= flux[i - 1] || flux[i] < flux[i + 1]) continue;
          if (flux[i] < maxFlux * 0.06) continue;

          let sum = 0;
          let count = 0;
          const startW = Math.max(0, i - winHalf);
          const endW = Math.min(numHops, i + winHalf);
          for (let k = startW; k < endW; k++) {
            sum += flux[k];
            count++;
          }
          const localMean = count > 0 ? (sum / count) : 0;
          const thresh = localMean * (1.0 + sensFactor);

          if (flux[i] > thresh) {
            beatTimes.push((i * hopSize) / sampleRate);
            lastBeatHop = i;
          }
        }
        return beatTimes;
      }

      function detectBassFromWaveformPeaks(peaks, durationSec, sensitivity = 65) {
        if (!peaks || peaks.length === 0) return [];
        const numBars = peaks.length;
        const barDur = durationSec / numBars;
        const flux = new Float32Array(numBars);
        let maxFlux = 0;
        for (let i = 1; i < numBars; i++) {
          const diff = peaks[i] - peaks[i - 1];
          flux[i] = diff > 0 ? diff : 0;
          if (flux[i] > maxFlux) maxFlux = flux[i];
        }
        const sensFactor = 0.35 + (100 - Math.max(1, Math.min(100, sensitivity))) * 0.022;
        const minIntervalBars = Math.max(2, Math.floor(0.17 / barDur));
        const winHalf = Math.max(2, Math.floor(0.25 / barDur));
        const result = [];
        let lastBar = -minIntervalBars;

        for (let i = 1; i < numBars - 1; i++) {
          if (i - lastBar < minIntervalBars) continue;
          if (flux[i] <= flux[i - 1] || flux[i] < flux[i + 1]) continue;
          if (flux[i] < maxFlux * 0.06) continue;

          let sum = 0;
          const startW = Math.max(0, i - winHalf);
          const endW = Math.min(numBars, i + winHalf);
          for (let k = startW; k < endW; k++) sum += flux[k];
          const mean = sum / (endW - startW);

          if (flux[i] > mean * (1.0 + sensFactor)) {
            result.push(i * barDur);
            lastBar = i;
          }
        }
        return result;
      }

      function estimateBPMFromAudio(beatTimes) {
        if (!beatTimes || beatTimes.length < 3) return 120;
        const intervals = [];
        for (let i = 1; i < beatTimes.length; i++) {
          const dt = beatTimes[i] - beatTimes[i - 1];
          if (dt >= 0.25 && dt <= 1.5) {
            intervals.push(dt);
          }
        }
        if (intervals.length === 0) return 120;

        const bpmCounts = new Map();
        intervals.forEach(dt => {
          let bpm = Math.round(60 / dt);
          while (bpm < 75) bpm *= 2;
          while (bpm > 165) bpm /= 2;
          bpm = Math.round(bpm);
          bpmCounts.set(bpm, (bpmCounts.get(bpm) || 0) + 1);
        });

        let bestBpm = 120;
        let maxCount = -1;
        bpmCounts.forEach((count, bpm) => {
          if (count > maxCount) {
            maxCount = count;
            bestBpm = bpm;
          }
        });
        return bestBpm;
      }

      async function generateAutoBeatmarks(arg0) {
        const opts = (arg0 && typeof arg0 === 'object') ? arg0 : {};
        const targets = getSelectedLayersForFishTool();
        if (!targets || targets.length === 0) {
          const msg = 'Please select an audio layer first';
          showEditorToast(msg, 2400, 'error');
          return { error: true, message: msg };
        }

        const layer = targets[0];
        const isAudio = layer && (layer.type === 'audio' || layer.mediaType === 'audio' || layer.isAudioTrack === true);
        if (!isAudio) {
          const msg = 'Selected layer is not an audio layer';
          showEditorToast(msg, 2400, 'error');
          return { error: true, message: msg };
        }

        const fps = (currentProjectState && currentProjectState.fps) || (window.currentTimelineFps) || 60;
        const pps = window.currentPixelsPerSecond || 80;
        const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const durSec = layer.durationSec !== undefined ? layer.durationSec : (layer.mediaDuration || 5);
        const endSec = startSec + durSec;

        const mode = opts.mode || 'bass';
        const sensitivity = typeof opts.sensitivity === 'number' ? opts.sensitivity : 65;
        const bpm = Math.max(40, Math.min(240, opts.bpm || 120));
        const division = opts.division || '1/1';
        const clearExisting = opts.clearExisting !== false;

        let detectedOffsets = [];

        if (mode === 'bpm') {
          let interval = 60 / bpm;
          if (division === '1/2') interval /= 2;
          else if (division === '1/4') interval /= 4;

          let t = startSec;
          while (t <= endSec + 0.001) {
            detectedOffsets.push(t);
            t += interval;
          }
        } else {
          let audioBuffer = null;
          try {
            audioBuffer = await getAudioBufferForLayer(layer);
          } catch (_) {}

          if (audioBuffer) {
            const relOffsets = detectBassFromAudioBuffer(audioBuffer, sensitivity, durSec);
            detectedOffsets = relOffsets.map(t => startSec + t);
          } else {
            let peaks = null;
            if (typeof window.getAudioPeaksForLayer === 'function') {
              try { peaks = await window.getAudioPeaksForLayer(layer, 800); } catch (_) {}
            }
            if (peaks && peaks.length > 0) {
              const relOffsets = detectBassFromWaveformPeaks(peaks, durSec, sensitivity);
              detectedOffsets = relOffsets.map(t => startSec + t);
            } else {
              let interval = 0.5;
              let t = startSec;
              while (t <= endSec + 0.001) {
                detectedOffsets.push(t);
                t += interval;
              }
            }
          }
        }

        const finalMarks = detectedOffsets
          .filter(t => t >= startSec - 0.001 && t <= endSec + 0.001)
          .map(t => Math.round(t * fps) / fps);

        if (!currentProjectState) {
          showEditorToast('Active project composition not found', 2400, 'error');
          return { error: true, message: 'No active project' };
        }

        currentProjectState.beatmarks = currentProjectState.beatmarks || [];
        let updated = [];
        if (clearExisting) {
          updated = currentProjectState.beatmarks.filter(b => b < startSec - 0.005 || b > endSec + 0.005);
        } else {
          updated = currentProjectState.beatmarks.slice();
        }

        finalMarks.forEach(m => {
          if (!updated.some(u => Math.abs(u - m) <= (0.5 / fps))) {
            updated.push(m);
          }
        });

        updated.sort((a, b) => a - b);
        currentProjectState.beatmarks = updated;
        if (window.currentProjectState) {
          window.currentProjectState.beatmarks = updated;
        }

        layer.markers = finalMarks.map(t => Number(t.toFixed(4)));

        if (typeof renderTimelineBeatmarks === 'function') renderTimelineBeatmarks();
        if (typeof window.renderTimelineBeatmarks === 'function') window.renderTimelineBeatmarks();
        if (typeof saveCurrentProjectBeatmarks === 'function') saveCurrentProjectBeatmarks(true);
        if (typeof window.saveCurrentProjectBeatmarks === 'function') window.saveCurrentProjectBeatmarks(true);
        if (typeof updateTimeBadgeBeatmarkState === 'function') updateTimeBadgeBeatmarkState();
        if (typeof window.updateTimeBadgeBeatmarkState === 'function') window.updateTimeBadgeBeatmarkState();
        if (typeof syncDesktopMarkerLabels === 'function') syncDesktopMarkerLabels();
        if (typeof window.syncDesktopMarkerLabels === 'function') window.syncDesktopMarkerLabels();
        if (typeof window.syncBeatmarkDrawerUI === 'function') window.syncBeatmarkDrawerUI();

        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function' && !window.UndoRedoManager.isApplying) {
          window.UndoRedoManager.recordSnapshot();
        }

        showEditorToast(`Generated ${finalMarks.length} beatmarks`, 2400, 'info');
        return { success: true, count: finalMarks.length, beatmarks: finalMarks };
      }

      window.createProceduralCube = createProceduralCube;
      window.createProcedural3D = createProcedural3D;
      window.createProcedural2Split = createProcedural2Split;
      window.createProcedural3Split = createProcedural3Split;
      window.createProceduralTunnel = createProceduralTunnel;
      window.createProceduralMC = createProceduralMC;
      window.generateAutoBeatmarks = generateAutoBeatmarks;
      window.getAudioBufferForLayer = getAudioBufferForLayer;
      window.detectBassFromAudioBuffer = detectBassFromAudioBuffer;
      window.detectBassFromWaveformPeaks = detectBassFromWaveformPeaks;
      window.estimateBPMFromAudio = estimateBPMFromAudio;

      function executeFishTool(toolName, ...args) {
        if (!toolName) return false;
        const pcm = window.PreviewCacheManager;
        const beforeSnap = (pcm && typeof pcm.captureStateSnapshot === 'function') ? pcm.captureStateSnapshot() : null;
        const result = _editorExecuteFishToolInternal(toolName, ...args);
        if (pcm && beforeSnap && typeof pcm.invalidateSmartDiff === 'function') {
          const changed = pcm.invalidateSmartDiff(beforeSnap);
          if (changed) {
            if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
            if (typeof redrawComposition === 'function') redrawComposition('smartCache:' + String(toolName));
          }
        }
        return result;
      }
      window.editorExecuteFishTool = executeFishTool;
      if (typeof window.executeFishTool !== 'function') {
        window.executeFishTool = executeFishTool;
      }
      window.setAnchorPointForSelectedLayers = (pos) => executeFishTool('setAnchorPoint', pos);
      window.alignSelectedLayers = (mode) => executeFishTool(mode);
      window.applyCutefishEffect = applyCutefishEffect;
      window.getSelectedLayersForFishTool = getSelectedLayersForFishTool;

})();
