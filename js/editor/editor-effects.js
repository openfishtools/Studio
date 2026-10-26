/**
 * OpenFishTools Studio - Editor Effects Rack & Gallery
 * Manages layer effects stack, effect cards scrubbing, parameter popover inputs,
 * effects gallery drawer, quick effects search, and audio effects rack.
 */
(function() {
    let quickEffectsFocusedIndex = 0;
    let quickEffectsFilteredList = [];

    function ensureLayerEffects(layer) {
      if (!layer) return [];
      if (!Array.isArray(layer.effects)) {
        layer.effects = [];
        if (layer.hasBrightnessContrast) {
          layer.effects.push({
            id: 'fx_1_' + Date.now(),
            type: 'brightness-contrast',
            name: 'Brightness / Contrast',
            isExpanded: true,
            disabled: !!layer.effectsDisabled,
            brightness: layer.brightness !== undefined ? layer.brightness : 0,
            contrast: layer.contrast !== undefined ? layer.contrast : 0
          });
        }
      }
      // Filter out null or non-object items in layer.effects to prevent corruption
      layer.effects = layer.effects.filter(f => f && typeof f === 'object');
      // Migrate legacy open-ios / open-mac to fluid-fish
      layer.effects.forEach(fx => {
        if (!fx) return;
        if (fx.type === 'open-ios' || fx.type === 'open_ios') {
          fx.type = 'fluid-fish';
          if (!fx.mode) fx.mode = 'morph';
          if (fx.name === 'Open iOS' || !fx.name) fx.name = 'Fluid Fish';
        } else if (fx.type === 'open-mac' || fx.type === 'open_mac') {
          fx.type = 'fluid-fish';
          if (!fx.mode) fx.mode = 'genie';
          if (fx.name === 'Open Mac' || !fx.name) fx.name = 'Fluid Fish';
        }
      });
      if (window.FishEffectsRegistry && typeof window.FishEffectsRegistry.get === 'function' && typeof window.FishEffectsRegistry.getAll === 'function' && window.FishEffectsRegistry.getAll().length > 0) {
        layer.effects = layer.effects.filter(fx => {
          if (!fx || !fx.type) return false;
          return !!window.FishEffectsRegistry.get(fx.type);
        });
      }
      const seenIds = new Set();
      layer.effects.forEach((fx, i) => {
        if (!fx.id || seenIds.has(fx.id)) {
          fx.id = `fx_${i + 1}_` + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        }
        seenIds.add(fx.id);

        // AUTO-HYDRATE: Fill missing params with registry defaults & normalize type
        // This ensures saved effects always have all current params populated,
        // even if new params were added to the definition after the project was saved
        if (fx.type && window.FishEffectsRegistry && typeof window.FishEffectsRegistry.get === 'function') {
          const def = window.FishEffectsRegistry.get(fx.type);
          if (def) {
            if (fx.type !== def.id) {
              fx.type = def.id;
            }
            if (!fx.name || fx.name === fx.type) {
              fx.name = def.name;
            }
            if (Array.isArray(def.params)) {
            def.params.forEach(p => {
              if (fx[p.id] === undefined) {
                // Hidden stores data blobs, button is action-only — skip hydration
                if (p.type === 'hidden' || p.type === 'button') return;
                if (p.type === 'switch' || p.type === 'boolean') {
                  fx[p.id] = (p.default !== undefined) ? p.default : 1;
                } else if (p.type === 'color') {
                  fx[p.id] = p.default || '#ffffff';
                } else if (p.type === 'select') {
                  fx[p.id] = p.default || (p.options && p.options[0] ? p.options[0] : 'normal');
                } else if (p.type === 'curve') {
                  fx[p.id] = p.default || null;
                } else if (p.type === 'layer') {
                  fx[p.id] = p.default || '';
                } else {
                  fx[p.id] = p.default !== undefined ? p.default : 0;
                }
              }
            });
            }
          }
        }
      });
      if (layer.keyframes && layer.effects.length > 0) {
        const firstFx = layer.effects[0];
        ['brightness', 'contrast'].forEach(p => {
          if (layer.keyframes[p]) {
            if (!layer.keyframes[`${firstFx.id}:${p}`]) {
              layer.keyframes[`${firstFx.id}:${p}`] = layer.keyframes[p];
            }
            delete layer.keyframes[p];
          }
        });
      }
      return layer.effects;
    }
    window.ensureLayerEffects = ensureLayerEffects;

    function showEffectsRackToast(msg) {
      const rackMain = document.querySelector('.effects-rack-main');
      if (!rackMain) return;
      const old = rackMain.querySelector('.effects-rack-toast');
      if (old) old.remove();
      const toast = document.createElement('div');
      toast.className = 'effects-rack-toast';
      toast.textContent = msg;
      rackMain.appendChild(toast);
      setTimeout(() => { toast.remove(); }, 1800);
    }
    window.showEffectsRackToast = showEffectsRackToast;

    function syncEffectsKeyframeState(layer) {
      if (typeof updateEffectsKeyframeAndGraphBtnStates === 'function') {
        updateEffectsKeyframeAndGraphBtnStates();
      }
    }
    window.syncEffectsKeyframeState = syncEffectsKeyframeState;

    function duplicateEffect(fx, layer) {
      const cloneFx = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(fx) : (Array.isArray(fx) ? [] : {}));
      cloneFx.id = 'fx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      cloneFx.isExpanded = true;
      cloneFx.disabled = !!fx.disabled;

      const idx = layer.effects.findIndex(f => f.id === fx.id || f === fx);
      if (idx >= 0) {
        layer.effects.splice(idx + 1, 0, cloneFx);
      } else {
        layer.effects.push(cloneFx);
      }
      if (layer.keyframes) {
        getEffectParamIds(fx).forEach(p => {
          const srcKey = `${fx.id}:${p}`;
          const fallbackKey = (fx === layer.effects[0]) ? p : null;
          const kfs = layer.keyframes[srcKey] || (fallbackKey ? layer.keyframes[fallbackKey] : null);
          if (kfs && kfs.length > 0) {
            layer.keyframes[`${cloneFx.id}:${p}`] = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(kfs) : (Array.isArray(kfs) ? [] : {}));
          }
        });
      }
      layer.hasBrightnessContrast = true;
      const firstParam = getEffectParamIds(cloneFx)[0] || 'param';
      window.activeKeyframeProperty = `${cloneFx.id}:${firstParam}`;
      syncEffectsRackUI();
      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
      if (typeof redrawComposition === 'function') redrawComposition('effect-duplicate');
      if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
      if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
      showEffectsRackToast('Effect duplicated');
    }

    function renderEffectCardHTML(fx, layer, currentSec) {
      if (window.FishEffects && typeof window.FishEffects.renderCardHTML === 'function') {
        return window.FishEffects.renderCardHTML(fx, layer, window.activeKeyframeProperty, currentSec);
      }
      return '';
    }

    function syncEffectsRackUI(force = false) {
      const isEffectsActive = (typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview === 'effects') ||
        Boolean(document.querySelector('#layer-drawer-effects-view.is-active, #effects-rack.is-active'));
      const rackList = document.getElementById('effects-rack-list');
      const rackEmpty = document.getElementById('effects-rack-empty');
      const btnEffectsKeyframe = document.getElementById('btn-effects-keyframe');

      if (!isEffectsActive && !force) {
        if (rackList) rackList.dataset.needsSync = 'true';
        return;
      }
      if (rackList) rackList.removeAttribute('data-needs-sync');

      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);

      if (!layer) {
        if (rackList) rackList.dataset.currentLayerId = '';
        if (rackEmpty) rackEmpty.style.display = 'flex';
        if (rackList) {
          rackList.style.display = 'none';
          rackList.innerHTML = '';
        }
        if (btnEffectsKeyframe) btnEffectsKeyframe.classList.remove('is-active');
        return;
      }

      const effects = ensureLayerEffects(layer);

      if (effects.length === 0) {
        if (rackList) rackList.dataset.currentLayerId = layer.id;
        if (rackEmpty) rackEmpty.style.display = 'flex';
        if (rackList) {
          rackList.style.display = 'none';
          rackList.innerHTML = '';
        }
        if (btnEffectsKeyframe) btnEffectsKeyframe.classList.remove('is-active');
        return;
      }

      if (rackEmpty) rackEmpty.style.display = 'none';
      if (rackList) rackList.style.display = 'flex';

      // Bulletproof delegated deletion handler on container (never misses clicks)
      if (rackList && !rackList._hasDeleteDelegation) {
        rackList._hasDeleteDelegation = true;
        rackList.addEventListener('click', (e) => {
          const delBtn = e.target.closest('.effects-card-delete-btn');
          const kebabDelItem = e.target.closest('.effects-kebab-item[data-action="delete"]');
          if (delBtn || kebabDelItem) {
            e.stopPropagation();
            const card = e.target.closest('.effects-card');
            if (card) {
              const fxId = card.dataset.effectId;
              const curLayer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
              card.style.display = 'none';
              deleteEffectFromLayer(fxId, curLayer);
            }
          }
        });
      }

      const pps = window.currentPixelsPerSecond || 80;
      const currentPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
      const currentSec = Number((Math.abs(currentPanX) / pps).toFixed(3));
      const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, currentSec) : null;

      // Check if rendered DOM cards match current effects IDs and active layer
      const domCards = [...rackList.querySelectorAll('.effects-card')];
      const domCardIds = domCards.map(c => c.dataset.effectId);
      const currentFxIds = effects.map(fx => fx.id);
      const layerChanged = rackList.dataset.currentLayerId !== layer.id;
      rackList.dataset.currentLayerId = layer.id;
      const hasDynamicChange = effects.some(fx => {
        const card = domCards.find(c => c.dataset.effectId === fx.id);
        return card && card.dataset.lastMode !== undefined && card.dataset.lastMode !== String(fx.mode || '');
      });
      const needsFullRebuild = force === true || layerChanged || hasDynamicChange || domCardIds.length !== currentFxIds.length || !domCardIds.every((id, i) => id === currentFxIds[i]);

      if (needsFullRebuild) {
        rackList.innerHTML = effects.map(fx => renderEffectCardHTML(fx, layer, currentSec)).join('');
        bindEffectsCardEventListeners();
      } else {
        // Fast path: update indicators, badges, toggle states, swatches, and param selection without rebuilding DOM
        effects.forEach(fx => {
          const card = rackList.querySelector(`.effects-card[data-effect-id="${fx.id}"]`);
          if (!card) return;

          card.classList.toggle('is-expanded', fx.isExpanded !== false);
          const eyeBtn = card.querySelector('.effects-card-eye-btn');
          if (eyeBtn) eyeBtn.classList.toggle('is-active', !fx.disabled);

          const effFx = (eff && Array.isArray(eff.effects)) ? eff.effects.find(f => f.id === fx.id) : null;
          const def = (window.FishEffectsRegistry && window.FishEffectsRegistry.get(fx.type)) || null;
          const paramsList = (def && Array.isArray(def.params) && def.params.length > 0) ? def.params : getEffectParamIds(fx).map(id => ({ id, type: 'number', min: -100, max: 100, unit: '%' }));

          paramsList.forEach(pDef => {
            const pId = pDef.id;
            const pType = pDef.type || 'number';
            const propKey = `${fx.id}:${pId}`;
            const builtInProps = ['move', 'scale', 'rotate', 'rotation', 'opacity', 'volume', 'origin', 'skew', 'speed', 'timeRemap', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurAmount'];
            const hasKf = layer.keyframes && (
              (layer.keyframes[propKey] && layer.keyframes[propKey].length > 0) ||
              (fx === layer.effects[0] && !builtInProps.includes(pId) && layer.keyframes[pId] && layer.keyframes[pId].length > 0)
            );

            // Skip hidden/button params — no sync needed
            if (pType === 'hidden' || pType === 'button') return;

            const isSelected = (window.activeKeyframeProperty === propKey);
            const paramRow = card.querySelector(`.effects-control-row[data-param*="${pId}"]`);
            if (paramRow) {
              if (paramRow.classList.contains('is-selected') !== isSelected) {
                paramRow.classList.toggle('is-selected', isSelected);
              }
              if (paramRow._lastHasKf !== hasKf) {
                paramRow._lastHasKf = hasKf;
                const labelEl = paramRow.querySelector('.effects-param-name, .effects-param-select-btn');
                if (labelEl) {
                  let kfIcon = labelEl.querySelector('.fx-param-kf-icon');
                  if (hasKf && !kfIcon) {
                    kfIcon = document.createElement('i');
                    kfIcon.className = 'fticon fticon-keyframe fx-param-kf-icon';
                    kfIcon.setAttribute('aria-hidden', 'true');
                    kfIcon.setAttribute('title', 'Has keyframes');
                    labelEl.insertBefore(kfIcon, labelEl.firstChild);
                  } else if (!hasKf && kfIcon) {
                    kfIcon.remove();
                  }
                }
              }
            }

            if (pType === 'switch' || pType === 'boolean') {
              const rawVal = (hasKf && effFx && effFx[pId] !== undefined)
                ? effFx[pId]
                : (fx[pId] !== undefined ? fx[pId] : (pDef.default !== undefined ? pDef.default : 1));
              const val = (rawVal === 1 || rawVal === true || rawVal === '1' || rawVal === 'true' || rawVal === 'on') ? '1' : '0';
              card.querySelectorAll(`.effects-segmented-btn[data-param="${pId}"]`).forEach(b => {
                b.classList.toggle('is-active', b.dataset.val === val);
              });
              return;
            }

            if (pType === 'select') {
              const val = (hasKf && effFx && effFx[pId] !== undefined)
                ? effFx[pId]
                : (fx[pId] !== undefined ? fx[pId] : (pDef.default || 'normal'));
              const dd = card.querySelector(`.custom-dropdown[data-param="${pId}"]`);
              if (dd) {
                dd.dataset.value = val;
                const items = Array.from(dd.querySelectorAll('.custom-dropdown-item'));
                const targetItem = dd.querySelector(`.custom-dropdown-item[data-val="${val}"]`) ||
                  items.find(it => String(it.dataset.val).toLowerCase() === String(val).toLowerCase());
                const label = dd.querySelector('.custom-dropdown-label');
                if (targetItem && label) {
                  label.textContent = targetItem.textContent;
                } else if (label) {
                  label.textContent = String(val).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                }
                items.forEach(item => {
                  item.classList.toggle('is-selected', String(item.dataset.val).toLowerCase() === String(val).toLowerCase());
                });
              }
              card.querySelectorAll(`.effects-segmented-btn[data-param="${pId}"]`).forEach(b => {
                b.classList.toggle('is-active', (b.dataset.val || '').toLowerCase() === String(val).toLowerCase());
              });
              return;
            }

            if (pType === 'color') {
              const val = (hasKf && effFx && effFx[pId] !== undefined)
                ? effFx[pId]
                : (fx[pId] !== undefined ? fx[pId] : (pDef.default || '#000000'));
              const preview = card.querySelector(`.fx-swatch-preview-${pId}`);
              if (preview) preview.style.backgroundColor = val;
              const hexInput = card.querySelector(`.fx-hex-${pId}`);
              if (hexInput && document.activeElement !== hexInput) hexInput.value = String(val).toUpperCase();
              return;
            }

            if (pType === 'curve') {
              return;
            }

            const min = fx.min !== undefined ? fx.min : (pDef.min !== undefined ? pDef.min : -100);
            const max = fx.max !== undefined ? fx.max : (pDef.max !== undefined ? pDef.max : 100);
            const step = fx.step !== undefined ? fx.step : (pDef.step !== undefined ? pDef.step : 1);
            const unit = fx.unit !== undefined ? fx.unit : (pDef.unit !== undefined ? pDef.unit : '');
            const valNum = (window.isTransformInteracting && fx[pId] !== undefined)
              ? fx[pId]
              : ((hasKf && effFx && effFx[pId] !== undefined)
                ? effFx[pId]
                : (fx[pId] !== undefined ? fx[pId] : (pDef.default || 0)));
            const isDecimal = (step < 1) || unit === 'x' || unit.includes('.');
            const val = isDecimal
              ? Math.max(min, Math.min(max, Number(parseFloat(valNum).toFixed(2))))
              : Math.max(min, Math.min(max, Math.round(valNum)));

            const paramBtn = card.querySelector(`.fx-param-btn-${pId}`);
            if (paramBtn) {
              paramBtn.classList.toggle('is-active', isSelected);
            }

            if (window.activeScrubbingParam === propKey) {
              // Actively dragging this param scrubber: preserve live drag visual without jitter
              return;
            }

            const ratio = (max > min) ? (val - min) / (max - min) : 0;
            const indicator = card.querySelector(`.fx-indicator-${pId}`);
            const badge = card.querySelector(`.fx-badge-${pId}`);

            if (indicator) indicator.style.left = (ratio * 100) + '%';
            const track = card.querySelector(`.fx-track-${pId}`);
            if (track) {
              if (pType === 'angle') {
                const normAngle = ((Math.round(val) % 360) + 360) % 360;
                track.style.width = ((normAngle / 360) * 100).toFixed(1) + '%';
              } else if (max > min) {
                const clampedRatio = Math.max(0, Math.min(1, ratio));
                track.style.width = (clampedRatio * 100).toFixed(1) + '%';
              }
            }
            const ticksEl = card.querySelector(`.fx-scrubber-${pId} .jog-wheel-ticks`);
            if (ticksEl && ticksEl.classList.contains('is-bounded-tape') && max > min) {
              const tapeW = parseFloat(ticksEl.dataset.tapeWidth) || parseFloat(getComputedStyle(ticksEl).getPropertyValue('--tape-width')) || 480;
              const clampedRatio = Math.max(0, Math.min(1, ratio));
              const offset = -clampedRatio * tapeW;
              ticksEl.style.setProperty('--tape-offset', `${offset.toFixed(1)}px`);
              ticksEl.style.transform = `translateX(${offset.toFixed(1)}px)`;
              ticksEl.style.clipPath = 'none';
            }
            if (pType === 'angle') {
              const turns = Math.trunc(val / 360);
              const rem = Math.round(val % 360);
              if (badge) badge.textContent = (turns !== 0) ? `${turns}x ${rem >= 0 ? '+' : ''}${rem}°` : `${rem >= 0 ? '+' : ''}${rem}°`;
            } else {
              const formattedVal = isDecimal ? val.toFixed(2) : val;
              if (badge) badge.textContent = (val >= 0 && min < 0 ? '+' : '') + formattedVal + unit;
            }
            const scrubber = card.querySelector(`.fx-scrubber-${pId}`);
            if (scrubber) scrubber.setAttribute('aria-valuenow', String(val));
          });
        });
      }

      // Keyframe button active indicator
      syncEffectsKeyframeState(layer);
    }
    window.syncEffectsRackUI = syncEffectsRackUI;

    function deleteEffectFromLayer(fxId, layer) {
      // 1. Safely resolve live layer from currentProjectState.layers
      let targetLayer = layer;
      if (!targetLayer || !targetLayer.effects || (targetLayer.id && currentProjectState.layers)) {
        const targetId = (targetLayer && targetLayer.id) || window.selectedLayerId;
        const found = (currentProjectState.layers || []).find(l => l.id === targetId);
        if (found) targetLayer = found;
      }
      if (!targetLayer && window.selectedLayerId) {
        targetLayer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      }

      // If targetLayer still doesn't have this effect, search all layers in currentProjectState
      if (!targetLayer || !Array.isArray(targetLayer.effects) || !targetLayer.effects.some(f => f && (f.id === fxId || String(f.id) === String(fxId)))) {
        const layerWithFx = (currentProjectState.layers || []).find(l => Array.isArray(l.effects) && l.effects.some(f => f && (f.id === fxId || String(f.id) === String(fxId))));
        if (layerWithFx) {
          targetLayer = layerWithFx;
        }
      }

      if (!targetLayer || !Array.isArray(targetLayer.effects)) return;

      // Safe index finding (handles nulls, string vs number, or fallback matching)
      let idx = targetLayer.effects.findIndex(f => f && (f.id === fxId || String(f.id) === String(fxId)));
      if (idx === -1 && fxId) {
        idx = targetLayer.effects.findIndex(f => f && (f.type === fxId || f.name === fxId));
      }
      if (idx === -1 && targetLayer.effects.length === 1) {
        idx = 0;
      }
      if (idx === -1) {
        console.warn('[deleteEffectFromLayer] Effect not found:', fxId, targetLayer);
        syncEffectsRackUI();
        return;
      }

      // Record undo snapshot before mutating
      if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
        window.UndoRedoManager.recordSnapshot();
      }

      const removedFx = targetLayer.effects.splice(idx, 1)[0];
      const realFxId = (removedFx && removedFx.id) || fxId;

      // Purge all keyframes belonging to this effect instance
      if (targetLayer.keyframes) {
        const keysToDelete = [realFxId, fxId].filter(Boolean);
        Object.keys(targetLayer.keyframes).forEach(k => {
          if (keysToDelete.some(id => k.startsWith(`${id}:`))) {
            delete targetLayer.keyframes[k];
          }
        });
      }

      // Update active keyframe property
      if (window.activeKeyframeProperty && (window.activeKeyframeProperty.startsWith(`${realFxId}:`) || (fxId && window.activeKeyframeProperty.startsWith(`${fxId}:`)))) {
        if (targetLayer.effects.length > 0) {
          const firstFx = targetLayer.effects[0];
          const firstParam = (window.FishEffects && typeof window.FishEffects.getParamIds === 'function')
            ? (window.FishEffects.getParamIds(firstFx)[0] || 'brightness')
            : 'brightness';
          window.activeKeyframeProperty = `${firstFx.id}:${firstParam}`;
        } else {
          window.activeKeyframeProperty = 'move';
        }
      }

      if (targetLayer.effects.length === 0) {
        delete targetLayer.hasBrightnessContrast;
        delete targetLayer.brightness;
        delete targetLayer.contrast;
        delete targetLayer.effectsDisabled;
        if (targetLayer.keyframes) {
          delete targetLayer.keyframes.brightness;
          delete targetLayer.keyframes.contrast;
        }
      } else {
        targetLayer.brightness = targetLayer.effects[0].brightness !== undefined ? targetLayer.effects[0].brightness : 0;
        targetLayer.contrast = targetLayer.effects[0].contrast !== undefined ? targetLayer.effects[0].contrast : 0;
        targetLayer.effectsDisabled = !!targetLayer.effects[0].disabled;
      }
      // Call effect onRemove lifecycle if defined (e.g. 3D Element WebGL disposal)
      const def = (window.FishEffects && window.FishEffects.registry)
        ? window.FishEffects.registry.get(removedFx.type)
        : ((window.FishEffectsRegistry) ? window.FishEffectsRegistry.get(removedFx.type) : null);
      if (def && typeof def.onRemove === 'function') {
        try { def.onRemove(removedFx); } catch (e) { console.warn('Error during effect onRemove:', e); }
      }

      if (removedFx && (removedFx.type === 'remove_bg' || removedFx.id === 'remove_bg' || (typeof removedFx.id === 'string' && removedFx.id.startsWith('fx_remove_bg')))) {
        if (window.FishBgRemovalEngine) {
          window.FishBgRemovalEngine.clearLayerCutouts(targetLayer);
        }
        delete targetLayer._lastRenderedCutoutFrame;
      }

      syncEffectsRackUI();
      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(targetLayer);
      showEffectsRackToast('Effect removed');

      // Defer heavy composition redraw and timeline DOM reconstruction to next animation frame
      // Prevents blocking the main thread so the effect card vanishes with zero latency
      requestAnimationFrame(() => {
        if (typeof redrawComposition === 'function') redrawComposition('effect-delete');
        if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
        if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
        if (typeof updateTimelineKeyframeMarkersHighlight === 'function') updateTimelineKeyframeMarkersHighlight();
      });
    }
    window.deleteEffectFromLayer = deleteEffectFromLayer;

    // ======================================================================
    // MODULAR NUMERIC VALUE INPUT POPOVER CONTROLLER (.is-value-input-popover)
    // ======================================================================
    function openValueInputPopover(anchorEl, options = {}) {
      const {
        value = 0,
        defaultValue = 0,
        min = -Infinity,
        max = Infinity,
        step = 1,
        onCommit = null
      } = options;

      const popover = document.getElementById('popover-value-input');
      const inputEl = document.getElementById('popover-value-input-field');
      const formEl = document.getElementById('popover-value-input-form');
      if (!popover || !inputEl || !anchorEl || !window.Popover) return;

      const parsedCurrent = parseFloat(value);
      const initialVal = !isNaN(parsedCurrent) ? parsedCurrent : (parseFloat(defaultValue) || 0);

      inputEl.step = step ? String(step) : 'any';
      if (Number.isFinite(min)) inputEl.min = min; else inputEl.removeAttribute('min');
      if (Number.isFinite(max)) inputEl.max = max; else inputEl.removeAttribute('max');
      inputEl.value = (step && step < 1) ? initialVal.toFixed(2) : initialVal;

      let isFinished = false;

      function parseLiveNumber(rawVal) {
        if (rawVal === '' || rawVal === '-' || rawVal === '+') return null;
        let num = parseFloat(rawVal);
        if (isNaN(num)) return null;
        if (Number.isFinite(max) && num > max) num = max;
        if (Number.isFinite(min) && num < min) num = min;
        if (step && step >= 1) {
          num = Math.round(num);
        } else if (step && step < 1) {
          const decimals = (step.toString().split('.')[1] || '').length || 2;
          num = parseFloat(num.toFixed(decimals));
        }
        return num;
      }

      function handleLiveInput() {
        if (isFinished) return;
        const num = parseLiveNumber(inputEl.value);
        if (num !== null && typeof onCommit === 'function') {
          onCommit(num);
        }
      }

      inputEl.oninput = handleLiveInput;
      inputEl.onchange = handleLiveInput;

      function commitValue(rawVal) {
        if (isFinished) return;
        isFinished = true;
        let num = parseFloat(rawVal);
        if (isNaN(num)) num = parseFloat(defaultValue) || 0;
        if (Number.isFinite(min)) num = Math.max(min, num);
        if (Number.isFinite(max)) num = Math.min(max, num);

        if (step && step >= 1) {
          num = Math.round(num);
        } else if (step && step < 1) {
          const decimals = (step.toString().split('.')[1] || '').length || 2;
          num = parseFloat(num.toFixed(decimals));
        }

        if (typeof onCommit === 'function') {
          onCommit(num);
        }
        if (window.Popover) window.Popover.close();
      }

      if (formEl) {
        formEl.onsubmit = (e) => {
          e.preventDefault();
          commitValue(inputEl.value);
        };
      }

      inputEl.onkeydown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          isFinished = true;
          if (typeof onCommit === 'function') onCommit(initialVal);
          if (window.Popover) window.Popover.close();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          commitValue(inputEl.value);
        }
      };

      inputEl.onblur = () => {
        if (!isFinished && window.Popover && typeof window.Popover.isOpen === 'function' && window.Popover.isOpen()) {
          commitValue(inputEl.value);
        }
      };

      window.Popover.open(anchorEl, popover);

      setTimeout(() => {
        if (inputEl) {
          inputEl.focus();
          inputEl.select();
        }
      }, 50);
    }
    window.openValueInputPopover = (window.FishElements && window.FishElements.openNumberInput) || openValueInputPopover;

    function selectEffectParam(fxId, paramName) {
      const rackList = document.getElementById('effects-rack-list');
      if (!rackList || !fxId || !paramName) return;
      const propKey = `${fxId}:${paramName}`;
      window.activeKeyframeProperty = propKey;
      rackList.querySelectorAll('.effects-control-row').forEach(row => {
        const rFxId = row.dataset.effectId || (row.closest('.effects-card') ? row.closest('.effects-card').dataset.effectId : '');
        const rParam = row.dataset.param || '';
        const isMatch = (rFxId === fxId && (rParam === paramName || rParam.split(',').includes(paramName)));
        row.classList.toggle('is-selected', isMatch);
      });
      rackList.querySelectorAll('.effects-param-select-btn').forEach(b => {
        const parent = b.closest('.effects-card');
        const bFxId = parent ? parent.dataset.effectId : '';
        b.classList.toggle('is-active', bFxId === fxId && b.dataset.param === paramName);
      });
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (layer && typeof syncEffectsKeyframeState === 'function') {
        syncEffectsKeyframeState(layer);
      }
      if (typeof updateTimelineKeyframeMarkersHighlight === 'function') {
        updateTimelineKeyframeMarkersHighlight();
      }
    }
    window.selectEffectParam = selectEffectParam;

    function bindEffectsCardEventListeners() {
      const rackList = document.getElementById('effects-rack-list');
      if (!rackList) return;

      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer || !Array.isArray(layer.effects)) return;

      rackList.querySelectorAll('.effects-card').forEach(card => {
        const fxId = card.dataset.effectId;
        const fx = layer.effects.find(f => f.id === fxId);
        if (!fx) return;

        const def = (window.FishEffects && window.FishEffects.registry)
          ? window.FishEffects.registry.get(fx.type)
          : ((window.FishEffectsRegistry) ? window.FishEffectsRegistry.get(fx.type) : null);

        // 1. Expand / Collapse & Swipe-to-Delete
        const header = card.querySelector('.effects-card-header');
        const caretBtn = card.querySelector('.effects-card-caret-btn');
        const titleEl = card.querySelector('.effects-card-title');
        const titleInput = card.querySelector('.effects-card-title-input');
        const kebabMenu = card.querySelector('.effects-kebab-menu');

        function toggleExpand(e) {
          if (header && header._justSwiped) return;
          e.stopPropagation();
          fx.isExpanded = !fx.isExpanded;
          card.classList.toggle('is-expanded', fx.isExpanded);
          if (kebabMenu) {
            kebabMenu.classList.remove('is-open');
            card.classList.remove('has-kebab-open');
          }
        }
        if (caretBtn) caretBtn.addEventListener('click', toggleExpand);
        if (header) {
          header.addEventListener('click', (e) => {
            if (e.target.closest('button, input, .effects-card-title, .effects-card-drag-handle, .effects-kebab-menu')) return;
            toggleExpand(e);
          });
        }

        // Inline Rename (After Effects Style: Click Title / Double Click / Enter Key / Kebab Menu)
        function startRename() {
          if (!titleEl || !titleInput) return;
          titleEl.style.display = 'none';
          titleInput.style.display = 'inline-block';
          titleInput.value = fx.name || (def ? def.name : 'Effect');
          titleInput.focus();
          titleInput.select();
        }

        function commitRename() {
          if (!titleInput || titleInput.style.display === 'none') return;
          const oldName = fx.name || (def ? def.name : 'Effect');
          const trimmed = titleInput.value.trim();
          const newName = trimmed.length > 0 ? trimmed : (def ? def.name : 'Effect');
          titleInput.style.display = 'none';
          if (titleEl) {
            titleEl.style.display = '';
            titleEl.textContent = newName;
          }
          if (newName !== oldName) {
            if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
              window.UndoRedoManager.recordSnapshot();
            }
            fx.name = newName;

            // Auto-update any expressions referencing effect("OldName")
            const allLayers = (window.currentProjectState && window.currentProjectState.layers) || [layer];
            allLayers.forEach(l => {
              if (l.expressions && typeof l.expressions === 'object') {
                const escOld = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`effect\\(\\s*(['"])${escOld}\\1\\s*\\)`, 'g');
                let exprChanged = false;
                Object.keys(l.expressions).forEach(k => {
                  if (typeof l.expressions[k] === 'string' && regex.test(l.expressions[k])) {
                    l.expressions[k] = l.expressions[k].replace(regex, `effect("$1${newName}$1")`);
                    exprChanged = true;
                  }
                });
              }
            });
            if (typeof window.invalidateEffectivePropsCache === 'function') {
              window.invalidateEffectivePropsCache();
            }

            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof redrawComposition === 'function') redrawComposition('effect-rename');
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            if (typeof showEffectsRackToast === 'function') showEffectsRackToast(`Renamed to "${newName}"`);
          }
        }

        function cancelRename() {
          if (!titleInput || titleInput.style.display === 'none') return;
          titleInput.style.display = 'none';
          if (titleEl) titleEl.style.display = '';
        }

        if (titleEl) {
          titleEl.addEventListener('click', (e) => {
            e.stopPropagation();
            startRename();
          });
          titleEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            startRename();
          });
          titleEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              startRename();
            }
          });
        }

        if (titleInput) {
          titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              commitRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cancelRename();
            }
          });
          titleInput.addEventListener('blur', () => {
            commitRename();
          });
          titleInput.addEventListener('click', (e) => {
            e.stopPropagation();
          });
          titleInput.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
          });
        }

        card.setAttribute('tabindex', '0');
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.target === card && (!titleInput || titleInput.style.display === 'none')) {
            e.preventDefault();
            startRename();
          }
        });

        // Horizontal Swipe-to-Delete Gesture on Unexpanded Card
        if (header) {
          let startX = 0;
          let startY = 0;
          let currentDeltaX = 0;
          let isSwiping = false;
          let isIntentDetermined = false;
          let startTime = 0;
          let activePointerId = null;

          function onHeaderPointerDown(e) {
            if (window.innerWidth > 600) return;
            if (card.classList.contains('is-expanded')) return;
            if (e.target.closest('button, .effects-card-drag-handle, .effects-kebab-menu')) return;

            startX = e.clientX;
            startY = e.clientY;
            currentDeltaX = 0;
            isSwiping = false;
            isIntentDetermined = false;
            startTime = Date.now();
            activePointerId = e.pointerId;
            header.style.transition = 'none';

            window.addEventListener('pointermove', onHeaderPointerMove);
            window.addEventListener('pointerup', onHeaderPointerUp);
            window.addEventListener('pointercancel', onHeaderPointerUp);
          }

          function onHeaderPointerMove(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (!isIntentDetermined) {
              if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 5) {
                // Vertical scrolling gesture: abort swipe
                cleanupPointerListeners();
                return;
              }
              if (dx < -6) {
                // Left swipe gesture confirmed
                isIntentDetermined = true;
                isSwiping = true;
                try { header.setPointerCapture(activePointerId); } catch (_) {}
              } else if (dx > 6) {
                // Right drag ignored
                isIntentDetermined = true;
                return;
              }
            }

            if (isSwiping) {
              e.preventDefault();
              currentDeltaX = Math.min(0, dx);
              header.style.transform = `translateX(${currentDeltaX}px)`;
              if (currentDeltaX < -70) {
                card.classList.add('is-swipe-active');
              } else {
                card.classList.remove('is-swipe-active');
              }
            }
          }

          function cleanupPointerListeners() {
            window.removeEventListener('pointermove', onHeaderPointerMove);
            window.removeEventListener('pointerup', onHeaderPointerUp);
            window.removeEventListener('pointercancel', onHeaderPointerUp);
          }

          function onHeaderPointerUp(e) {
            cleanupPointerListeners();
            if (activePointerId !== null) {
              try { header.releasePointerCapture(activePointerId); } catch (_) {}
              activePointerId = null;
            }

            if (!isSwiping) return;

            card.classList.remove('is-swipe-active');
            header._justSwiped = true;
            setTimeout(() => { header._justSwiped = false; }, 250);

            const elapsed = Date.now() - startTime;
            const velocity = currentDeltaX / Math.max(1, elapsed);
            const shouldDelete = currentDeltaX < -70 || (currentDeltaX < -35 && velocity < -0.35);

            if (shouldDelete) {
              // Smooth slide out then delete
              header.style.transition = 'transform 0.18s ease-out';
              header.style.transform = 'translateX(-100%)';
              setTimeout(() => {
                card.style.transition = 'max-height 0.18s ease, opacity 0.18s ease, margin 0.18s ease, padding 0.18s ease';
                card.style.maxHeight = `${card.offsetHeight}px`;
                requestAnimationFrame(() => {
                  card.style.maxHeight = '0px';
                  card.style.opacity = '0';
                  card.style.marginTop = '0px';
                  card.style.marginBottom = '0px';
                  card.style.paddingTop = '0px';
                  card.style.paddingBottom = '0px';
                  card.style.borderWidth = '0px';
                  setTimeout(() => {
                    const curFxId = card.dataset.effectId || fx.id;
                    const curLayer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId) || layer;
                    deleteEffectFromLayer(curFxId, curLayer);
                  }, 180);
                });
              }, 80);
            } else {
              // Snap back
              header.style.transition = 'transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1)';
              header.style.transform = 'translateX(0px)';
              setTimeout(() => {
                header.style.transition = '';
                header.style.transform = '';
              }, 190);
            }
          }

          header.addEventListener('pointerdown', onHeaderPointerDown);
        }

        // 2. Toggle Active / Bypass (Eye button in collapsed state)
        const eyeBtn = card.querySelector('.effects-card-eye-btn');
        if (eyeBtn) {
          eyeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fx.disabled = !fx.disabled;
            eyeBtn.classList.toggle('is-active', !fx.disabled);
            if (fx.type === 'remove_bg' || fx.id === 'remove_bg' || (typeof fx.id === 'string' && fx.id.startsWith('fx_remove_bg'))) {
              if (fx.disabled) {
                if (window.FishBgRemovalEngine) window.FishBgRemovalEngine.clearLayerCutouts(layer);
                delete layer._lastRenderedCutoutFrame;
              } else {
                if (window.FishBgRemovalEngine) window.FishBgRemovalEngine.processLayer(layer, true);
              }
            }
            if (fx === layer.effects[0]) layer.effectsDisabled = fx.disabled;
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof redrawComposition === 'function') redrawComposition('effect-toggle');
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
          });
        }

        // 3. Kebab Menu Button & Popover Actions (Both Collapsed & Expanded States)
        const kebabBtns = card.querySelectorAll('.effects-card-kebab-btn');
        if (kebabBtns.length > 0 && kebabMenu) {
          kebabBtns.forEach(kebabBtn => {
            kebabBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              rackList.querySelectorAll('.effects-kebab-menu').forEach(m => {
                if (m !== kebabMenu) {
                  m.classList.remove('is-open');
                  m.closest('.effects-card')?.classList.remove('has-kebab-open');
                }
              });
              const isOpen = kebabMenu.classList.toggle('is-open');
              card.classList.toggle('has-kebab-open', isOpen);
            });
          });

          kebabMenu.querySelectorAll('.effects-kebab-item').forEach(item => {
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              kebabMenu.classList.remove('is-open');
              card.classList.remove('has-kebab-open');
              const action = item.dataset.action;

              if (action === 'rename') {
                startRename();
              } else if (action === 'details') {
                const def = window.FishEffectsRegistry ? window.FishEffectsRegistry.get(fx.type) : null;
                showEffectsRackToast(`${fx.name || (def ? def.name : 'Effect')}: ${def ? def.description : 'Adjust parameters'}`);
              } else if (action === 'reset') {
                const def = window.FishEffectsRegistry ? window.FishEffectsRegistry.get(fx.type) : null;
                if (def && Array.isArray(def.params)) {
                  def.params.forEach(p => {
                    fx[p.id] = p.default !== undefined ? p.default : (p.type === 'color' ? '#ffffff' : (p.type === 'select' ? (p.options?.[0] || 'normal') : 0));
                  });
                } else {
                  fx.brightness = 0;
                  fx.contrast = 0;
                }
                if (fx === layer.effects[0]) {
                  layer.brightness = fx.brightness !== undefined ? fx.brightness : 0;
                  layer.contrast = fx.contrast !== undefined ? fx.contrast : 0;
                }
                syncEffectsRackUI();
                if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
                if (typeof redrawComposition === 'function') redrawComposition('effect-reset');
                if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
                showEffectsRackToast('Reset to defaults');
              } else if (action === 'duplicate') {
                duplicateEffect(fx, layer);
              } else if (action === 'copy') {
                try {
                  window._copiedEffect = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(fx) : (Array.isArray(fx) ? [] : {}));
                } catch (_) {}
                showEffectsRackToast('Effect copied');
              } else if (action === 'delete') {
                const curFxId = card.dataset.effectId || fx.id;
                const curLayer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId) || layer;
                card.style.display = 'none';
                deleteEffectFromLayer(curFxId, curLayer);
              }
            });
          });
        }

        // 4. Delete Effect Button (Expanded State)
        const delBtns = card.querySelectorAll('.effects-card-delete-btn');
        delBtns.forEach(delBtn => {
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const curFxId = card.dataset.effectId || fx.id;
            const curLayer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId) || layer;
            card.style.display = 'none';
            deleteEffectFromLayer(curFxId, curLayer);
          });
        });

        // 5. Drag Handle (Reorder)
        const handle = card.querySelector('.effects-card-drag-handle');
        if (handle) {
          handle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            card.classList.add('is-dragging');
            try { handle.setPointerCapture(e.pointerId); } catch (_) {}

            function onPointerMove(ev) {
              ev.stopPropagation();
              const cards = [...rackList.querySelectorAll('.effects-card')];
              const siblings = cards.filter(c => c !== card);
              for (const sib of siblings) {
                const rect = sib.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (ev.clientY < midY) {
                  rackList.insertBefore(card, sib);
                  return;
                }
              }
              if (siblings.length > 0) {
                const last = siblings[siblings.length - 1];
                const rect = last.getBoundingClientRect();
                if (ev.clientY > rect.top + rect.height / 2) {
                  rackList.appendChild(card);
                }
              }
            }

            function onPointerUp(ev) {
              ev.stopPropagation();
              try { handle.releasePointerCapture(ev.pointerId); } catch (_) {}
              card.classList.remove('is-dragging');
              window.removeEventListener('pointermove', onPointerMove);
              window.removeEventListener('pointerup', onPointerUp);
              window.removeEventListener('pointercancel', onPointerUp);

              // Reorder layer.effects array based on DOM order
              const newOrderIds = [...rackList.querySelectorAll('.effects-card')].map(c => c.dataset.effectId);
              layer.effects.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
              if (layer.effects.length > 0) {
                layer.brightness = layer.effects[0].brightness;
                layer.contrast = layer.effects[0].contrast;
              }
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
              if (typeof redrawComposition === 'function') redrawComposition('effect-reorder');
              if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            }

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
          });
        }

        // 6. Parameter Select Buttons, Ruler Scrubbers & Value Reset Badges
        getEffectParamIds(fx).forEach(paramName => {
          const paramBtn = card.querySelector(`.fx-param-btn-${paramName}`);
          if (paramBtn) {
            paramBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              selectEffectParam(fx.id, paramName);
            });
          }

          const badgeBtn = card.querySelector(`.fx-badge-${paramName}`);
          if (badgeBtn) {
            badgeBtn.title = `Click to edit ${paramName} value`;
            badgeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              selectEffectParam(fx.id, paramName);
              const defParam = (def && def.params) ? def.params.find(dp => dp.id === paramName) : null;
              const defaultVal = defParam ? (defParam.default !== undefined ? defParam.default : 0) : 0;
              const currentVal = fx[paramName] !== undefined ? fx[paramName] : defaultVal;
              const min = defParam && defParam.min !== undefined ? defParam.min : -100;
              const max = defParam && defParam.max !== undefined ? defParam.max : 100;
              const step = defParam && defParam.step !== undefined ? defParam.step : 1;
              const unit = defParam && defParam.unit !== undefined ? defParam.unit : '%';
              const label = defParam && defParam.label ? defParam.label : paramName;
              const isAngle = !!(defParam && defParam.type === 'angle');

              if (typeof window.openValueInputPopover === 'function') {
                window.openValueInputPopover(badgeBtn, {
                  title: label,
                  value: currentVal,
                  defaultValue: defaultVal,
                  min: isAngle ? -Infinity : min,
                  max: isAngle ? Infinity : max,
                  step: step,
                  unit: unit,
                  isAngle: isAngle,
                  onCommit: (newVal) => {
                    fx[paramName] = newVal;
                    if (fx && fx.type === 'brightness-contrast' && (paramName === 'brightness' || paramName === 'contrast')) {
                      layer[paramName] = newVal;
                    }

                    const ticksEl = card.querySelector(`.fx-scrubber-${paramName} .jog-wheel-ticks`);
                    if (ticksEl && ticksEl.classList.contains('is-bounded-tape') && max > min) {
                      const tapeW = parseFloat(ticksEl.dataset.tapeWidth) || parseFloat(getComputedStyle(ticksEl).getPropertyValue('--tape-width')) || 480;
                      const ratio = Math.max(0, Math.min(1, (newVal - min) / (max - min)));
                      const offset = -ratio * tapeW;
                      ticksEl.style.setProperty('--tape-offset', `${offset.toFixed(1)}px`);
                      ticksEl.style.transform = `translateX(${offset.toFixed(1)}px)`;
                      ticksEl.style.clipPath = 'none';
                    }

                    const track = card.querySelector(`.fx-track-${paramName}`);
                    if (track) {
                      if (isAngle) {
                        const normAngle = ((Math.round(newVal) % 360) + 360) % 360;
                        track.style.width = ((normAngle / 360) * 100).toFixed(1) + '%';
                      } else if (max > min) {
                        const ratio = Math.max(0, Math.min(1, (newVal - min) / (max - min)));
                        track.style.width = (ratio * 100).toFixed(1) + '%';
                      }
                    }

                    if (isAngle) {
                      const turns = Math.trunc(newVal / 360);
                      const rem = Math.round(newVal % 360);
                      badgeBtn.textContent = (turns !== 0) ? `${turns}x ${rem >= 0 ? '+' : ''}${rem}°` : `${rem >= 0 ? '+' : ''}${rem}°`;
                    } else {
                      const isDecimal = (step < 1) || unit === 'x';
                      const formatted = isDecimal ? Number(newVal).toFixed(2) : newVal;
                      badgeBtn.textContent = (newVal >= 0 && min < 0 ? '+' : '') + formatted + unit;
                    }

                    const propKey = `${fx.id}:${paramName}`;
                    if (typeof recordLayerPropertyChange === 'function') {
                      recordLayerPropertyChange(layer, propKey);
                    }
                    if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
                    if (typeof redrawComposition === 'function') redrawComposition('effect-value-input');
                    const curveWidget = card.querySelector('.effects-curve-editor');
                    if (curveWidget && typeof curveWidget._updateCurveSVG === 'function') curveWidget._updateCurveSVG();
                    if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
                    syncEffectsKeyframeState(layer);
                    if (typeof updateTimelineKeyframeMarkersHighlight === 'function') {
                      updateTimelineKeyframeMarkersHighlight();
                    }
                  }
                });
              }
            });
          }

          // Setup ruler scrubber
          setupCardScrubber(card, fx, layer, `.fx-scrubber-${paramName}`, paramName);
        });

        // 7. Segmented Select Controls (e.g. Blend Modes)
        card.querySelectorAll('.effects-segmented-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const param = btn.dataset.param;
            if (param) selectEffectParam(fx.id, param);
            let val = btn.dataset.val;
            if (val === '0' || val === '1') {
              val = parseInt(val, 10);
            }
            fx[param] = val;
            card.querySelectorAll(`.effects-segmented-btn[data-param="${param}"]`).forEach(b => {
              b.classList.toggle('is-active', b.dataset.val === String(btn.dataset.val));
            });

            if (param === 'mode') {
              syncEffectsRackUI(true);
            }

            const propKey = `${fx.id}:${param}`;
            if (typeof recordLayerPropertyChange === 'function') {
              recordLayerPropertyChange(layer, propKey);
            }

            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof redrawComposition === 'function') redrawComposition('effect-param-change');
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            if (typeof syncEffectsKeyframeState === 'function') syncEffectsKeyframeState(layer);
          });
        });

        // 7b. Custom Dropdown Select Controls (e.g. Wave Type, Warp Style)
        card.querySelectorAll('.effects-custom-dropdown, .effects-control-row .custom-dropdown').forEach(dropdown => {
          const trigger = dropdown.querySelector('.custom-dropdown-trigger');
          const label = dropdown.querySelector('.custom-dropdown-label');
          const items = dropdown.querySelectorAll('.custom-dropdown-item');
          const param = dropdown.dataset.param;

          if (trigger) {
            trigger.addEventListener('click', (e) => {
              e.stopPropagation();
              if (param) selectEffectParam(fx.id, param);
              // Close any other open dropdowns
              document.querySelectorAll('.custom-dropdown.is-open').forEach(other => {
                if (other !== dropdown) {
                  other.classList.remove('is-open');
                  const otherTrigger = other.querySelector('.custom-dropdown-trigger');
                  if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
                  const otherCard = other.closest('.effects-card');
                  if (otherCard) otherCard.classList.remove('has-dropdown-open');
                }
              });

              const isOpen = dropdown.classList.toggle('is-open');
              trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
              card.classList.toggle('has-dropdown-open', isOpen);
            });
          }

          items.forEach(item => {
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              if (param) selectEffectParam(fx.id, param);
              const val = item.dataset.val;
              dropdown.dataset.value = val;
              if (label) label.textContent = item.textContent;

              items.forEach(i => i.classList.remove('is-selected'));
              item.classList.add('is-selected');

              dropdown.classList.remove('is-open');
              if (trigger) trigger.setAttribute('aria-expanded', 'false');
              card.classList.remove('has-dropdown-open');

              if (param) {
                fx[param] = val;
                if (param === 'mode') {
                  syncEffectsRackUI(true);
                }
                if (fx && fx.type === 'brightness-contrast' && (param === 'brightness' || param === 'contrast')) {
                  layer[param] = val;
                }

                if (fx && fx.type === 'remove_bg' && param === 'model') {
                  delete layer._bgCutoutBitmap;
                  if (window.FishBgRemovalEngine) {
                    window.FishBgRemovalEngine.clearLayerCutouts(layer);
                    window.FishBgRemovalEngine.processLayer(layer, true);
                  }
                }

                if (fx && (fx.type === 'fluid-fish' || fx.type === 'open-ios' || fx.type === 'open-mac') && (param === 'firstLayer' || param === 'destLayer')) {
                  if (val && typeof currentProjectState !== 'undefined' && Array.isArray(currentProjectState.layers)) {
                    const targetL = currentProjectState.layers.find(l => l && String(l.id) === String(val));
                    if (targetL && String(targetL.id) !== String(layer.id)) {
                      targetL.hidden = true;
                      if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
                    }
                  }
                }

                const propKey = `${fx.id}:${param}`;
                if (typeof recordLayerPropertyChange === 'function') {
                  recordLayerPropertyChange(layer, propKey);
                }

                if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
                if (typeof redrawComposition === 'function') redrawComposition('effect-dropdown-change');
                if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
                if (typeof syncEffectsKeyframeState === 'function') syncEffectsKeyframeState(layer);
                // Link ke inspector: segarkan readout transform agar realtime ikut berubah
                if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
              }
            });
          });
        });

        // 8. Popover Color Picker Swatch & Hex Controls
        card.querySelectorAll('.effects-color-swatch-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const param = btn.dataset.param;
            if (param) selectEffectParam(fx.id, param);
            const currentVal = fx[param] || '#000000';

            if (window.FishColorPicker) {
              window.FishColorPicker.open({
                anchor: btn,
                color: currentVal,
                onChange: (hex, alpha, rgbaStr) => {
                  fx[param] = hex;
                  const preview = btn.querySelector('.effects-color-swatch-preview');
                  if (preview) preview.style.backgroundColor = hex;
                  const hexInput = card.querySelector(`.fx-hex-${param}`);
                  if (hexInput) hexInput.value = hex.toUpperCase();

                  if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
                  if (typeof redrawComposition === 'function') redrawComposition('effect-color-change');
                },
                onCommit: (hex, alpha) => {
                  fx[param] = hex;
                  if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
                  if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
                }
              });
            }
          });
        });

        card.querySelectorAll('.effects-color-hex-input').forEach(input => {
          input.addEventListener('focus', () => {
            const param = input.dataset.param;
            if (param) selectEffectParam(fx.id, param);
          });
          input.addEventListener('input', () => {
            const param = input.dataset.param;
            if (param) selectEffectParam(fx.id, param);
            let val = input.value.trim();
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
              fx[param] = val;
              const preview = card.querySelector(`.fx-swatch-preview-${param}`);
              if (preview) preview.style.backgroundColor = val;

              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
              if (typeof redrawComposition === 'function') redrawComposition('effect-color-change');
            }
          });
          input.addEventListener('change', () => {
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
          });
        });

        // 7. Curve Widget Interactive Binding
        if (window.FishEffects && typeof window.FishEffects.bindCurveWidget === 'function') {
          window.FishEffects.bindCurveWidget(card, fx, layer);
        }

        // 9. Action Button Params (e.g. Scene Editor — dispatches onButtonClick to effect def)
        card.querySelectorAll('.effects-action-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const param = btn.dataset.param;
            if (def && typeof def.onButtonClick === 'function') {
              def.onButtonClick(param, fx, layer);
            }
          });
        });

        // 10. Direct row-level selection
        card.querySelectorAll('.effects-control-row').forEach(row => {
          row.addEventListener('click', (e) => {
            if (e.target.closest('button, input, select, .custom-dropdown-trigger, .custom-dropdown-item')) return;
            const param = row.dataset.param;
            if (!param) return;
            const primaryParam = param.split(',')[0];
            selectEffectParam(fx.id, primaryParam);
          });
        });
      });
    }

    function setupCardScrubber(card, fx, layer, scrubberSelector, paramName) {
      const container = card.querySelector(scrubberSelector);
      if (!container) return;

      const def = (window.FishEffects && window.FishEffects.registry) ? window.FishEffects.registry.get(fx.type) : null;
      const defParam = def && def.params ? def.params.find(p => p.id === paramName) : null;
      const isAngle = (defParam && defParam.type === 'angle') || container.dataset.type === 'angle' || container.dataset.isAngle === 'true' || container.dataset.unit === '°';
      const isHue = (paramName && paramName.toLowerCase().includes('hue')) || isAngle || (defParam && defParam.unlimited);

      let currentVal = 0;
      let startVal = 0;
      let startPointerX = 0;
      let startPointerY = 0;
      let hasDragged = false;
      let isBadgeClick = false;
      let cachedRect = null;
      let cachedTapeW = 480;
      const propKey = `${fx.id}:${paramName}`;

      const ticksEl = container.querySelector('.jog-wheel-ticks');

      // Card closures can outlive the layer/effect objects they were built with (undo/redo, precomp
      // enter/exit, project reload). Re-point to the live objects so edits never land on orphans.
      const resolveLiveTargets = () => {
        const layers = (typeof currentProjectState !== 'undefined' && currentProjectState && currentProjectState.layers) || [];
        const liveLayer = layers.find(l => l && l.id === layer.id);
        if (liveLayer && liveLayer !== layer) layer = liveLayer;
        if (Array.isArray(layer.effects)) {
          const liveFx = layer.effects.find(f => f && f.id === fx.id);
          if (liveFx && liveFx !== fx) fx = liveFx;
        }
      };

      bindJogWheel(container, {
        onStart: (e) => {
          isBadgeClick = !!(e && e.target && e.target.closest('.effects-param-pill-val'));
          if (isBadgeClick) return false;
          startPointerX = e ? e.clientX : 0;
          startPointerY = e ? e.clientY : 0;
          hasDragged = false;
          resolveLiveTargets();
          cachedRect = container.getBoundingClientRect();
          window.activeScrubbingParam = propKey;
          window.isTransformInteracting = true;
          selectEffectParam(fx.id, paramName);

          startVal = fx[paramName] !== undefined ? Number(fx[paramName]) : (defParam && defParam.default !== undefined ? Number(defParam.default) : 0);
          currentVal = startVal;
          if (ticksEl) {
            cachedTapeW = parseFloat(ticksEl.dataset.tapeWidth) || parseFloat(getComputedStyle(ticksEl).getPropertyValue('--tape-width')) || 480;
          }
        },

        onMove: (rawDelta, e, step) => {
          if (e && (Math.abs(e.clientX - startPointerX) > 4 || Math.abs(e.clientY - startPointerY) > 4)) {
            hasDragged = true;
          }
          let consumedStep = 0;
          let badgeText = '';
          const liveCard = card.isConnected ? card : (document.querySelector(`.effects-card[data-effect-id="${fx.id}"]`) || card);

          // Bounded-tape rulers (e.g. number params with a ° unit like Direction/Phase) must use
          // the bounded branch, which is the only one that moves the tape.
          const tapeIsBounded = !!(ticksEl && ticksEl.classList.contains('is-bounded-tape'));
          if ((isHue || isAngle) && !tapeIsBounded) {
            // UNLIMITED ANGLE MODE (Continuous 360° rotation with turns)
            const speed = (e && e.shiftKey) ? 0.1 : ((e && e.altKey) ? 2.5 : 1.0);
            currentVal += step * speed;
            consumedStep = step;

            const val = Math.round(currentVal);
            const turns = Math.trunc(val / 360);
            const rem = Math.round(val % 360);
            badgeText = (turns !== 0)
              ? `${turns}x ${rem >= 0 ? '+' : ''}${rem}°`
              : `${rem >= 0 ? '+' : ''}${rem}°`;
            fx[paramName] = val;
            container.setAttribute('aria-valuenow', val);

            const track = card.querySelector(`.fx-track-${paramName}`);
            if (track) {
              const normAngle = ((val % 360) + 360) % 360;
              track.style.width = ((normAngle / 360) * 100).toFixed(1) + '%';
            }
          } else {
            // STRICT BOUNDED MODE (Wave Height, Wave Width, Blur, Size, Scale, etc.)
            const min = fx.min !== undefined ? fx.min : (defParam && defParam.min !== undefined ? defParam.min : (container.dataset.min !== undefined ? parseFloat(container.dataset.min) : 0));
            const max = fx.max !== undefined ? fx.max : (defParam && defParam.max !== undefined ? defParam.max : (container.dataset.max !== undefined ? parseFloat(container.dataset.max) : 100));
            const span = max - min;
            const unit = fx.unit !== undefined ? fx.unit : (defParam && defParam.unit ? defParam.unit : (container.dataset.unit || ''));
            const isDecimal = (fx.step !== undefined && fx.step < 1) || (defParam && defParam.step !== undefined && defParam.step < 1) || (container.dataset.step !== undefined && parseFloat(container.dataset.step) < 1) || unit === 'x' || unit.includes('.');
            const stepVal = (defParam && defParam.step) ? defParam.step : (container.dataset.step ? parseFloat(container.dataset.step) : (isDecimal ? 0.05 : 1));

            const tapeW = cachedTapeW;

            // Physical ruler reel mechanics:
            // Drag right (step > 0) pulls tape right, lower values from left move under needle -> value decreases
            // Drag left (step < 0) pulls tape left, higher values from right move under needle -> value increases
            const speed = (e && e.shiftKey) ? 0.2 : ((e && e.altKey) ? 2.5 : 1.0);
            const deltaVal = span > 0 ? (-step * (span / tapeW) * speed) : 0;
            const nextVal = currentVal + deltaVal;
            const prevVal = currentVal;
            currentVal = Math.max(min, Math.min(max, nextVal));

            const quantVal = isDecimal
              ? Number((Math.round(currentVal / stepVal) * stepVal).toFixed(2))
              : Math.round(currentVal);

            fx[paramName] = quantVal;
            container.setAttribute('aria-valuenow', quantVal);

            const formatted = isDecimal ? quantVal.toFixed(2) : quantVal;
            badgeText = (quantVal >= 0 && min < 0 ? '+' : '') + formatted + unit;

            // Physical ruler tape offset under stationary center needle:
            const ratio = span > 0 ? Math.max(0, Math.min(1, (currentVal - min) / span)) : 0;
            const offset = -ratio * tapeW;

            const liveTicks = liveCard.querySelector(`.fx-scrubber-${paramName} .jog-wheel-ticks`) || ticksEl;
            if (liveTicks) {
              liveTicks.style.setProperty('--tape-offset', `${offset.toFixed(1)}px`);
              // Inline transform guarantees a repaint even if the var()-driven transform is not re-evaluated
              liveTicks.style.transform = `translateX(${offset.toFixed(1)}px)`;
              liveTicks.style.clipPath = 'none';
            }

            const track = liveCard.querySelector(`.fx-track-${paramName}`);
            if (track) {
              track.style.width = (ratio * 100).toFixed(1) + '%';
            }

            const consumedVal = currentVal - prevVal;
            consumedStep = (span > 0 && speed > 0 && (span / tapeW * speed) > 0) ? (-consumedVal / ((span / tapeW) * speed)) : 0;
          }

          // The card's fx reference can go stale (rack rebuilt / layers reloaded); always write to the live effect too.
          if (Array.isArray(layer.effects)) {
            const liveFxTarget = layer.effects.find(f => f && f.id === fx.id);
            if (liveFxTarget && liveFxTarget !== fx && fx[paramName] !== undefined) liveFxTarget[paramName] = fx[paramName];
          }

          if (fx && fx.type === 'brightness-contrast' && (paramName === 'brightness' || paramName === 'contrast')) {
            layer[paramName] = fx[paramName];
          }

          const badge = liveCard.querySelector(`.fx-badge-${paramName}`);
          if (badge) badge.textContent = badgeText;

          // If property is keyframed and a keyframe exists at the current playhead, update its value in-place without heavy cache thrashing
          if (layer.keyframes && Array.isArray(layer.keyframes[propKey])) {
            const pps = window.currentPixelsPerSecond || 80;
            const curSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
            const fps = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
            const frameTol = Math.max(0.04, 0.5 / fps);
            const kf = (typeof getKeyframeAtTime === 'function') ? getKeyframeAtTime(layer, propKey, curSec, frameTol) : null;
            if (kf) {
              kf.value = fx[paramName];
            }
          }

          if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
          if (typeof redrawComposition === 'function') {
            redrawComposition('effect-scrubber');
          }

          return { consumedStep };
        },

        onEnd: () => {
          window.isTransformInteracting = false;
          window.activeScrubbingParam = null;
          cachedRect = null;
          if (fx[paramName] !== undefined) {
            currentVal = Number(fx[paramName]);
            // Tape remains exactly where it was dragged; no visual jump on release.
          }
          if (typeof recordLayerPropertyChange === 'function') {
            recordLayerPropertyChange(layer, propKey);
          }
          // Selectively invalidate RAM preview cache ONLY for the affected layer range (never invalidateAll)
          if (typeof invalidatePreviewCacheForLayer === 'function') {
            invalidatePreviewCacheForLayer(layer);
          }
          if (!isAnyPlaybackActive() && typeof redrawComposition === 'function') {
            redrawComposition('effect-scrubber-end');
          }
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
          if (typeof syncEffectsKeyframeState === 'function') syncEffectsKeyframeState(layer);
          if (typeof updateTimelineKeyframeMarkersHighlight === 'function') {
            updateTimelineKeyframeMarkersHighlight();
          }
          const curveWidget = card.querySelector('.effects-curve-editor');
          if (curveWidget && typeof curveWidget._updateCurveSVG === 'function') curveWidget._updateCurveSVG();
          if (!hasDragged && isBadgeClick) {
            const badgeBtn = card.querySelector(`.fx-badge-${paramName}`);
            if (badgeBtn) badgeBtn.click();
          }
        }
      });
    }

    (function initEffectsControllers() {
      // 1. Open Effects Rack from Layer Action Button
      const btnLayerEffects = document.getElementById('btn-layer-effects');
      if (btnLayerEffects) {
        btnLayerEffects.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('effects');
        });
      }

      // 2. Back button: Effects Rack -> Main Layer Actions
      const btnEffectsBack = document.getElementById('btn-effects-back');
      if (btnEffectsBack) {
        btnEffectsBack.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('main');
        });
      }

      // 3. Keyframe button: Left navigation column
      const btnEffectsKeyframe = document.getElementById('btn-effects-keyframe');
      if (btnEffectsKeyframe) {
        btnEffectsKeyframe.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          const effects = layer && Array.isArray(layer.effects) ? layer.effects : [];
          const curProp = window.activeKeyframeProperty;
          const isValid = !!(curProp && curProp.includes(':') && effects.some(f => curProp.startsWith(f.id + ':')));
          if (!isValid) return;
          if (typeof toggleKeyframeAtCurrentTime === 'function') {
            toggleKeyframeAtCurrentTime();
          }
          syncEffectsRackUI();
        });
      }

      // 4. Graph button: Left navigation column -> Graph Editor
      const btnEffectsGraph = document.getElementById('btn-effects-graph');
      if (btnEffectsGraph) {
        btnEffectsGraph.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          const effects = layer && Array.isArray(layer.effects) ? layer.effects : [];
          const curProp = window.activeKeyframeProperty;
          const isValid = !!(curProp && curProp.includes(':') && effects.some(f => curProp.startsWith(f.id + ':')));
          if (!isValid) return;
          const kfList = (layer.keyframes && layer.keyframes[curProp]) || [];
          if (kfList.length < 2) return;
          window.previousDrawerSubview = 'effects';
          switchLayerDrawerSubview('graph');
        });
      }

      // 5. "Add Effects" Button: Opens Effects Category Gallery
      const btnAddEffect = document.getElementById('btn-add-effect');
      if (btnAddEffect) {
        btnAddEffect.addEventListener('click', (e) => {
          e.stopPropagation();
          openEffectsGalleryDrawer();
        });
      }

      // 5b. More Options (Copy All Effects / Paste Effects)
      const btnEffectsMore = document.getElementById('btn-effects-more');
      const btnCopyAll = document.getElementById('btn-effects-copy-all');
      const btnPasteAll = document.getElementById('btn-effects-paste-all');

      if (btnEffectsMore) {
        btnEffectsMore.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.Popover) {
            window.Popover.open(btnEffectsMore, 'popover-effects-more');
          }
        });
      }

      if (btnCopyAll) {
        btnCopyAll.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.Popover) window.Popover.close(false);
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          const effects = ensureLayerEffects(layer);
          if (effects.length === 0) {
            showEffectsRackToast('No effects to copy');
            return;
          }
          const clonedEffects = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(effects) : (Array.isArray(effects) ? [] : {}));
          const keyframesData = {};
          if (layer.keyframes) {
            effects.forEach(fx => {
              getEffectParamIds(fx).forEach(p => {
                const k = `${fx.id}:${p}`;
                if (layer.keyframes[k]) {
                  keyframesData[k] = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.keyframes[k]) : (Array.isArray(layer.keyframes[k]) ? [] : {}));
                } else if (fx === layer.effects[0] && !['move', 'scale', 'rotate', 'rotation', 'opacity', 'volume', 'origin', 'skew', 'speed', 'timeRemap'].includes(p) && layer.keyframes[p]) {
                  keyframesData[k] = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.keyframes[p]) : (Array.isArray(layer.keyframes[p]) ? [] : {}));
                }
              });
            });
          }
          window._copiedEffectsRack = {
            effects: clonedEffects,
            keyframes: keyframesData
          };
          try {
            navigator.clipboard.writeText(JSON.stringify(window._copiedEffectsRack));
          } catch (_) {}
          showEffectsRackToast(`Copied ${clonedEffects.length} effect${clonedEffects.length > 1 ? 's' : ''}`);
        });
      }

      function sanitizeLayer3DEffects(layer) {
        if (!layer || !Array.isArray(layer.effects)) return;
        const is3DDef = (type) => {
          const d = window.FishEffectsRegistry ? window.FishEffectsRegistry.get(type) : null;
          return !!(d && (d.isExclusive3D || (d.category && d.category.toLowerCase() === '3d')));
        };

        const has3DFx = layer.effects.some(fx => fx && is3DDef(fx.type));
        if (has3DFx) {
          layer.is3D = true;
          const btn3D = document.getElementById('btn-layer-header-3d');
          if (btn3D && window.selectedLayerId === layer.id) {
            btn3D.classList.add('is-active');
            btn3D.setAttribute('aria-pressed', 'true');
          }
          if (typeof syncTransform3DVisibility === 'function') syncTransform3DVisibility();

          // Keep only the latest 3D effect if multiple exist
          let last3DIdx = -1;
          for (let i = layer.effects.length - 1; i >= 0; i--) {
            if (layer.effects[i] && is3DDef(layer.effects[i].type)) {
              if (last3DIdx === -1) {
                last3DIdx = i;
              } else {
                layer.effects.splice(i, 1);
                last3DIdx--;
              }
            }
          }
        }
      }
      window.sanitizeLayer3DEffects = sanitizeLayer3DEffects;

      if (btnPasteAll) {
        btnPasteAll.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (window.Popover) window.Popover.close(false);
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;

          let dataToPaste = window._copiedEffectsRack;
          if (!dataToPaste) {
            try {
              const text = await navigator.clipboard.readText();
              if (text) {
                const parsed = JSON.parse(text);
                if (parsed && Array.isArray(parsed.effects)) {
                  dataToPaste = parsed;
                }
              }
            } catch (_) {}
          }

          if (!dataToPaste || !Array.isArray(dataToPaste.effects) || dataToPaste.effects.length === 0) {
            showEffectsRackToast('No effects to paste');
            return;
          }

          ensureLayerEffects(layer);

          dataToPaste.effects.forEach(fx => {
            const oldId = fx.id;
            const newFx = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(fx) : (Array.isArray(fx) ? [] : {}));
            newFx.id = 'fx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            newFx.name = fx.name; // Keep name exact
            layer.effects.push(newFx);

            if (dataToPaste.keyframes) {
              layer.keyframes = layer.keyframes || {};
              getEffectParamIds(fx).forEach(p => {
                const oldK = `${oldId}:${p}`;
                if (dataToPaste.keyframes[oldK]) {
                  layer.keyframes[`${newFx.id}:${p}`] = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(dataToPaste.keyframes[oldK]) : (Array.isArray(dataToPaste.keyframes[oldK]) ? [] : {}));
                } else if (dataToPaste.keyframes[p]) {
                  layer.keyframes[`${newFx.id}:${p}`] = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(dataToPaste.keyframes[p]) : (Array.isArray(dataToPaste.keyframes[p]) ? [] : {}));
                }
              });
            }
          });

          sanitizeLayer3DEffects(layer);

          layer.hasBrightnessContrast = true;
          if (layer.effects.length > 0) {
            layer.brightness = layer.effects[0].brightness;
            layer.contrast = layer.effects[0].contrast;
            layer.effectsDisabled = !!layer.effects[0].disabled;
          }

          syncEffectsRackUI();
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          if (typeof redrawComposition === 'function') redrawComposition('effect-paste-all');
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          if (typeof updateTimelineKeyframeMarkersHighlight === 'function') updateTimelineKeyframeMarkersHighlight();

          showEffectsRackToast(`Pasted ${dataToPaste.effects.length} effect${dataToPaste.effects.length > 1 ? 's' : ''}`);
        });
      }

      // 6. Gallery Navigation (Single back button handles: Category View -> Categories Grid, or Categories Grid -> Effects Rack)
      const btnEffectsGalleryBack = document.getElementById('btn-effects-gallery-back');
      const galleryHomeView = document.getElementById('effects-gallery-home-view');
      const favoritesSection = document.getElementById('effects-favorites-section');
      const favoritesList = document.getElementById('effects-favorites-list');
      const favoritesCountEl = document.getElementById('effects-favorites-count');
      const lastUsedSection = document.getElementById('effects-last-used-section');
      const lastUsedList = document.getElementById('effects-last-used-list');
      const categoryGrid = document.getElementById('effects-category-grid');
      const itemsView = document.getElementById('effects-items-view');
      const effectsItemsGrid = document.getElementById('effects-items-grid');
      const searchInput = document.getElementById('effects-search-input');
      const noResultsEl = document.getElementById('effects-gallery-no-results');

      // Category presentation: known categories get a stable order + label; any NEW category introduced
      // by a plugin is picked up automatically (appended alphabetically, Title Case label).
      const GALLERY_CATEGORY_ORDER = ['lightning', 'color', 'warp', 'movement', 'layer', 'wipe', 'background', 'artificial intelligence', 'expression', '3d'];
      const GALLERY_CATEGORY_LABELS = { '3d': '3D', 'expression': 'Expression', 'artificial intelligence': 'Artificial Intelligence' };
      const chipBar = document.getElementById('effects-chip-bar');
      const itemsCountEl = document.getElementById('effects-items-count');
      const itemsTitleEl = document.getElementById('effects-items-category-title');
      const galleryBodyEl = document.getElementById('effects-gallery-body');
      const FALLBACK_EFFECT_ICON = 'assets/FXPH.svg';

      // Favorite & Last Used Effects Storage
      const FAVORITES_STORAGE_KEY = 'fishtools_favorite_effects';
      const LAST_USED_STORAGE_KEY = 'fishtools_last_used_effects';

      function getFavoriteEffectIds() {
        try {
          const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
          if (!raw) return [];
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
          return [];
        }
      }

      function isFavoriteEffect(id) {
        if (!id) return false;
        return getFavoriteEffectIds().includes(id);
      }

      function toggleFavoriteEffect(id) {
        if (!id) return;
        const favs = getFavoriteEffectIds();
        const idx = favs.indexOf(id);
        const isAdding = (idx === -1);
        if (isAdding) {
          favs.unshift(id);
        } else {
          favs.splice(idx, 1);
        }
        try {
          localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favs));
        } catch (_) {}
        updateAllStarButtons(id, isAdding);
        syncFavoritesList();
      }

      function updateAllStarButtons(id, isFav) {
        const cards = document.querySelectorAll(`[data-effect-id="${id}"]`);
        cards.forEach(card => {
          const starBtn = card.querySelector('.effects-gallery-star-btn');
          if (starBtn) {
            starBtn.classList.toggle('is-favorite', isFav);
            starBtn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
            starBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
          }
        });
      }

      function getLastUsedEffectIds() {
        try {
          const raw = localStorage.getItem(LAST_USED_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
          }
        } catch (_) {}
        return [];
      }

      function recordLastUsedEffect(id) {
        if (!id) return;
        let list = getLastUsedEffectIds();
        list = list.filter(item => item !== id);
        list.unshift(id);
        if (list.length > 12) list = list.slice(0, 12);
        try {
          localStorage.setItem(LAST_USED_STORAGE_KEY, JSON.stringify(list));
        } catch (_) {}
        syncLastUsedList();
      }

      // activeCat: null = category home, 'all' = every effect, otherwise a category key
      const galleryUi = { activeCat: null, query: '', cards: new Map(), catSignature: '', searchRaf: 0, syncRaf: 0 };

      function galleryCatKey(def) {
        const c = String((def && def.category) || 'lightning').toLowerCase();
        return c === 'extension' ? 'expression' : c;
      }
      function galleryCatLabel(key) {
        return GALLERY_CATEGORY_LABELS[key] || key.replace(/\b\w/g, ch => ch.toUpperCase());
      }

      function buildGalleryCard(def) {
        const label = def.name || def.id;
        const card = document.createElement('div');
        card.className = 'effects-gallery-item-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.dataset.effectId = def.id;

        const thumb = document.createElement('div');
        thumb.className = 'effects-gallery-item-thumb';
        const img = document.createElement('img');
        img.className = 'effects-gallery-item-img';
        img.alt = label;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.draggable = false;
        img.src = 'assets/effects/thumbs/' + def.id + '.png';
        img.addEventListener('error', () => {
          const fb = def.icon || FALLBACK_EFFECT_ICON;
          if (!img.src.endsWith(fb)) img.src = fb;
        }, { once: true });
        thumb.appendChild(img);

        // Star button at top-right corner
        const isFav = isFavoriteEffect(def.id);
        const starBtn = document.createElement('button');
        starBtn.type = 'button';
        starBtn.className = 'effects-gallery-star-btn' + (isFav ? ' is-favorite' : '');
        starBtn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
        starBtn.setAttribute('aria-label', (isFav ? 'Remove from favorites: ' : 'Add to favorites: ') + label);
        starBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
        starBtn.innerHTML = '<svg class="effects-star-svg" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
        thumb.appendChild(starBtn);

        const nameEl = document.createElement('span');
        nameEl.className = 'effects-gallery-item-name';
        card.appendChild(thumb);
        card.appendChild(nameEl);
        return card;
      }

      function updateGalleryCard(card, def) {
        const label = def.name || def.id;
        const catKey = galleryCatKey(def);
        card.dataset.category = catKey;
        card.title = label;
        const nameEl = card.querySelector('.effects-gallery-item-name');
        if (nameEl && nameEl.textContent !== label) nameEl.textContent = label;

        const starBtn = card.querySelector('.effects-gallery-star-btn');
        if (starBtn) {
          const isFav = isFavoriteEffect(def.id);
          starBtn.classList.toggle('is-favorite', isFav);
          starBtn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
          starBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
        }

        // Search haystack: name, id, category label, description and optional plugin keywords
        const keywords = Array.isArray(def.keywords) ? def.keywords.join(' ') : '';
        const alias = /box|cube/i.test(def.id + ' ' + label) ? ' cube kubus' : '';
        card.dataset.search = (label + ' ' + def.id + ' ' + galleryCatLabel(catKey) + ' ' + (def.description || '') + ' ' + keywords + alias).toLowerCase();
      }

      function rebuildGalleryCategories(counts) {
        const keys = Array.from(counts.keys()).sort((a, b) => {
          const ia = GALLERY_CATEGORY_ORDER.indexOf(a);
          const ib = GALLERY_CATEGORY_ORDER.indexOf(b);
          if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
          return a.localeCompare(b);
        });

        if (categoryGrid) {
          categoryGrid.replaceChildren();
          keys.forEach(key => {
            const tile = document.createElement('div');
            tile.className = 'effects-category-card';
            tile.setAttribute('role', 'button');
            tile.setAttribute('tabindex', '0');
            tile.dataset.category = key;
            tile.title = galleryCatLabel(key);
            tile.style.backgroundImage = 'url("assets/effects/categories/' + key.replace(/\s+/g, '-') + '.png")';
            const name = document.createElement('span');
            name.className = 'effects-category-name';
            name.textContent = galleryCatLabel(key);
            const count = document.createElement('span');
            count.className = 'effects-category-count';
            count.textContent = String(counts.get(key));
            tile.appendChild(name);
            tile.appendChild(count);
            categoryGrid.appendChild(tile);
          });
        }

        if (chipBar) {
          chipBar.replaceChildren();
          const addChip = (key, label) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'effects-chip';
            chip.setAttribute('role', 'tab');
            chip.dataset.category = key;
            chip.textContent = label;
            chipBar.appendChild(chip);
          };
          addChip('all', 'All');
          keys.forEach(key => addChip(key, galleryCatLabel(key)));
        }
      }

      function syncFavoritesList() {
        if (!favoritesList || !favoritesSection) return;
        if (!window.FishEffectsRegistry || typeof window.FishEffectsRegistry.get !== 'function') return;

        const favIds = getFavoriteEffectIds();
        const validDefs = favIds.map(id => window.FishEffectsRegistry.get(id)).filter(d => !!d);

        if (validDefs.length === 0) {
          favoritesSection.style.display = 'none';
          favoritesList.replaceChildren();
          return;
        }

        favoritesSection.style.display = '';
        if (favoritesCountEl) {
          favoritesCountEl.textContent = validDefs.length + (validDefs.length === 1 ? ' effect' : ' effects');
        }

        favoritesList.replaceChildren();
        const frag = document.createDocumentFragment();
        validDefs.forEach(def => {
          const card = buildGalleryCard(def);
          updateGalleryCard(card, def);
          frag.appendChild(card);
        });
        favoritesList.appendChild(frag);
      }

      function syncLastUsedList() {
        if (!lastUsedList || !lastUsedSection) return;
        if (!window.FishEffectsRegistry || typeof window.FishEffectsRegistry.get !== 'function') return;

        const ids = getLastUsedEffectIds();
        const validDefs = ids.map(id => window.FishEffectsRegistry.get(id)).filter(d => !!d);

        lastUsedSection.style.display = '';
        lastUsedList.replaceChildren();

        if (validDefs.length === 0) {
          const emptyEl = document.createElement('div');
          emptyEl.className = 'effects-gallery-empty-state';
          emptyEl.textContent = 'No used effects';
          lastUsedList.appendChild(emptyEl);
          return;
        }

        const frag = document.createDocumentFragment();
        validDefs.forEach(def => {
          const card = buildGalleryCard(def);
          updateGalleryCard(card, def);
          frag.appendChild(card);
        });
        lastUsedList.appendChild(frag);
      }

      function renderGalleryView() {
        const q = galleryUi.query;
        const cat = galleryUi.activeCat;
        const atHome = (!q && cat === null);

        if (atHome) {
          if (galleryHomeView) {
            galleryHomeView.style.display = 'flex';
          } else if (categoryGrid) {
            categoryGrid.style.display = 'grid';
          }
          if (itemsView) itemsView.style.display = 'none';
          if (noResultsEl) noResultsEl.style.display = 'none';
          if (btnEffectsGalleryBack) btnEffectsGalleryBack.title = 'Back to Effects Rack';
          syncFavoritesList();
          syncLastUsedList();
          return;
        }

        let shown = 0;
        galleryUi.cards.forEach(card => {
          const match = q
            ? (card.dataset.search || '').includes(q)
            : (cat === 'all' || card.dataset.category === cat);
          card.style.display = match ? '' : 'none';
          if (match) shown++;
        });

        if (galleryHomeView) {
          galleryHomeView.style.display = 'none';
        } else if (categoryGrid) {
          categoryGrid.style.display = 'none';
        }
        if (btnEffectsGalleryBack) btnEffectsGalleryBack.title = 'Back to Categories';
        if (shown === 0) {
          if (itemsView) itemsView.style.display = 'none';
          if (noResultsEl) noResultsEl.style.display = 'flex';
          return;
        }
        if (noResultsEl) noResultsEl.style.display = 'none';
        if (itemsView) itemsView.style.display = 'flex';

        if (itemsTitleEl) itemsTitleEl.textContent = q ? 'Search Results' : (cat === 'all' ? 'All Effects' : galleryCatLabel(cat));
        if (itemsCountEl) itemsCountEl.textContent = shown + (shown === 1 ? ' effect' : ' effects');
        if (chipBar) {
          chipBar.style.display = q ? 'none' : '';
          chipBar.querySelectorAll('.effects-chip').forEach(chip => {
            const active = (chip.dataset.category === cat);
            chip.classList.toggle('is-active', active);
            chip.setAttribute('aria-selected', active ? 'true' : 'false');
            if (active && !q && typeof chip.scrollIntoView === 'function') {
              try { chip.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (_) {}
            }
          });
        }
      }

      function syncGalleryItemsFromRegistry() {
        if (!effectsItemsGrid || !window.FishEffectsRegistry || typeof window.FishEffectsRegistry.getAll !== 'function') return;
        const defs = window.FishEffectsRegistry.getAll().filter(d => d && d.id);
        defs.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));

        let added = false;
        const counts = new Map();
        defs.forEach(def => {
          let card = galleryUi.cards.get(def.id);
          if (!card) {
            card = buildGalleryCard(def);
            galleryUi.cards.set(def.id, card);
            added = true;
          }
          updateGalleryCard(card, def);
          const key = galleryCatKey(def);
          counts.set(key, (counts.get(key) || 0) + 1);
        });

        if (added) {
          const frag = document.createDocumentFragment();
          defs.forEach(def => frag.appendChild(galleryUi.cards.get(def.id)));
          effectsItemsGrid.appendChild(frag);
        }

        const signature = Array.from(counts.entries()).sort().map(e => e[0] + ':' + e[1]).join('|');
        if (signature !== galleryUi.catSignature) {
          galleryUi.catSignature = signature;
          rebuildGalleryCategories(counts);
        }
        if (added || signature) {
          renderGalleryView();
        } else {
          syncFavoritesList();
          syncLastUsedList();
        }
      }

      // Modular effects are compiled and loaded directly from effects/effects.wasm via effects/loader.js
      async function autoFetchAndLoadEffects() {
        if (typeof window.prewarmWasmEffects === 'function') {
          try { await window.prewarmWasmEffects(); } catch (_) {}
        }
      }
      window.autoFetchAndLoadEffects = autoFetchAndLoadEffects;

      function openGalleryCategory(catName, catId) {
        let cat = String(catId || catName || 'all').toLowerCase();
        if (cat === 'extension') cat = 'expression';
        galleryUi.activeCat = cat;
        galleryUi.query = '';
        if (searchInput) searchInput.value = '';
        syncGalleryItemsFromRegistry();
        renderGalleryView();
        if (galleryBodyEl) galleryBodyEl.scrollTop = 0;
      }

      function closeGalleryCategory() {
        galleryUi.activeCat = null;
        galleryUi.query = '';
        if (searchInput) searchInput.value = '';
        renderGalleryView();
        if (galleryBodyEl) galleryBodyEl.scrollTop = 0;
      }

      window.openGalleryCategory = openGalleryCategory;
      window.closeGalleryCategory = closeGalleryCategory;

      // Delegated interaction (tiles/chips are rebuilt dynamically, so no per-element listeners)
      const activateGalleryTarget = (e, selector, handler) => {
        const el = e.target.closest(selector);
        if (!el) return false;
        e.stopPropagation();
        handler(el);
        return true;
      };
      if (categoryGrid) {
        categoryGrid.addEventListener('click', (e) => {
          activateGalleryTarget(e, '.effects-category-card', el => openGalleryCategory(galleryCatLabel(el.dataset.category), el.dataset.category));
        });
        categoryGrid.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          if (activateGalleryTarget(e, '.effects-category-card', el => openGalleryCategory(galleryCatLabel(el.dataset.category), el.dataset.category))) e.preventDefault();
        });
      }
      if (chipBar) {
        chipBar.addEventListener('click', (e) => {
          activateGalleryTarget(e, '.effects-chip', el => openGalleryCategory(el.textContent, el.dataset.category));
        });
      }

      if (btnEffectsGalleryBack) {
        btnEffectsGalleryBack.addEventListener('click', (e) => {
          e.stopPropagation();
          if (galleryUi.activeCat !== null || galleryUi.query) {
            closeGalleryCategory();
          } else {
            closeEffectsGalleryDrawer();
            switchLayerDrawerSubview('effects');
          }
        });
      }

      // Initial registry sync + listen for runtime registrations (coalesced to one sync per frame)
      syncGalleryItemsFromRegistry();
      autoFetchAndLoadEffects();
      if (typeof window !== 'undefined') {
        window.addEventListener('fisheffects:registered', () => {
          if (galleryUi.syncRaf) return;
          galleryUi.syncRaf = requestAnimationFrame(() => {
            galleryUi.syncRaf = 0;
            syncGalleryItemsFromRegistry();
          });
        });
      }


      // 8. Add Effect: Universal Gallery Item Click (Stacking / Double supported!)
      function addEffectToLayer(effectTypeId = 'brightness-contrast') {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!layer) return;
        ensureLayerEffects(layer);

        // Guard: Check registry for canonical effect
        const reg = (window.FishEffects && window.FishEffects.registry) || window.FishEffectsRegistry;
        const incomingDef = reg && typeof reg.get === 'function' ? reg.get(effectTypeId) : null;
        if (!incomingDef) {
          console.warn(`[Effects] Efek "${effectTypeId}" tidak terdaftar dalam registry!`);
          if (typeof showEditorToast === 'function') {
            showEditorToast(`Efek "${effectTypeId}" tidak terdaftar`, 2400, 'error');
          }
          return;
        }

        const canonicalId = incomingDef.id;
        const incomingIs3D = !!(incomingDef.isExclusive3D || (incomingDef.category && incomingDef.category.toLowerCase() === '3d'));
        if (incomingIs3D) {
          // Automatic 3D Layer conversion on 3D effect addition
          layer.is3D = true;
          const lW = Math.round(layer.scaleW || layer.w || 300);
          const lH = Math.round(layer.scaleH || layer.h || 300);
          if (layer.scaleZ === undefined) {
            layer.scaleZ = Math.max(20, Math.round(Math.min(Math.abs(lW), Math.abs(lH))));
          }
          const btn3D = document.getElementById('btn-layer-header-3d');
          if (btn3D && window.selectedLayerId === layer.id) {
            btn3D.classList.add('is-active');
            btn3D.setAttribute('aria-pressed', 'true');
          }
          if (typeof syncTransform3DVisibility === 'function') syncTransform3DVisibility();
          if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();

          if (Array.isArray(layer.effects)) {
            const existing3DIdx = layer.effects.findIndex(fx => {
              const d = reg.get(fx.type);
              return d && (d.isExclusive3D || (d.category && d.category.toLowerCase() === '3d'));
            });
            if (existing3DIdx !== -1) {
              // Replace existing 3D effect instead of stacking to prevent conflict / bug
              if (typeof showEffectsRackToast === 'function') {
                showEffectsRackToast('Only one 3D effect allowed per layer. Replaced existing 3D effect.', 'warn');
              }
              // Remove old 3D effect and continue to insert new one
              layer.effects.splice(existing3DIdx, 1);
            }
          }
        }

        let newFx = null;
        if (reg && typeof reg.createInstance === 'function') {
          newFx = reg.createInstance(canonicalId);
        }
        if (!newFx) {
          console.warn(`[Effects] Gagal membuat instance untuk efek "${canonicalId}"`);
          return;
        }
        if (incomingIs3D && newFx) {
          const lW = Math.round(layer.scaleW || layer.w || 300);
          const lH = Math.round(layer.scaleH || layer.h || 300);
          const cubeDim = Math.max(20, Math.round(Math.min(Math.abs(lW), Math.abs(lH))));
          if (layer.scaleZ === undefined) layer.scaleZ = cubeDim;
        }
        layer.effects.push(newFx);

        if (incomingIs3D) {
          sanitizeLayer3DEffects(layer);
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          if (typeof syncTransform3DVisibility === 'function') syncTransform3DVisibility();
          if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
        }

        layer.hasBrightnessContrast = true;
        if (layer.effects[0]) {
          layer.brightness = layer.effects[0].brightness !== undefined ? layer.effects[0].brightness : 0;
          layer.contrast = layer.effects[0].contrast !== undefined ? layer.effects[0].contrast : 0;
          layer.effectsDisabled = !!layer.effects[0].disabled;
        }

        if (canonicalId === 'remove_bg') {
          if (window.FishBgRemovalEngine) {
            window.FishBgRemovalEngine.processLayer(layer, true);
          }
        }

        if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
        if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
        if (typeof redrawComposition === 'function') redrawComposition('add-effect');

        const params = getEffectParamIds(newFx);
        window.activeKeyframeProperty = `${newFx.id}:${params[0] || 'param'}`;
        recordLastUsedEffect(canonicalId);
        closeEffectsGalleryDrawer();
        switchLayerDrawerSubview('effects');
        syncEffectsRackUI();
      }
      window.addEffectToLayer = addEffectToLayer;
      window.applyBrightnessContrastToLayer = () => addEffectToLayer('brightness-contrast');
      window.syncGalleryHomeSections = () => {
        syncFavoritesList();
        syncLastUsedList();
      };

      // 8. Add Effect: Universal Gallery Item Click (Stacking / Double supported!)
      const attachCardClickDelegation = (container) => {
        if (!container) return;
        container.addEventListener('click', (e) => {
          if (e.target.closest('.effects-gallery-star-btn')) return;
          const card = e.target.closest('.effects-gallery-item-card');
          if (!card) return;
          e.stopPropagation();
          const fxId = card.dataset.effectId || 'brightness-contrast';
          addEffectToLayer(fxId);
        });
        container.addEventListener('keydown', (e) => {
          if (e.target.closest('.effects-gallery-star-btn')) return;
          if (e.key === 'Enter') {
            const card = e.target.closest('.effects-gallery-item-card');
            if (!card) return;
            e.preventDefault();
            const fxId = card.dataset.effectId || 'brightness-contrast';
            addEffectToLayer(fxId);
          }
        });
      };
      attachCardClickDelegation(effectsItemsGrid);
      attachCardClickDelegation(favoritesList);
      attachCardClickDelegation(lastUsedList);

      // Universal capture handler for Star Favorite buttons
      // Intercepts click during capture so it NEVER triggers card click
      document.addEventListener('click', (e) => {
        const starBtn = e.target.closest('.effects-gallery-star-btn');
        if (!starBtn) return;
        const card = starBtn.closest('.effects-gallery-item-card');
        const fxId = card ? card.dataset.effectId : null;
        if (!fxId) return;
        e.preventDefault();
        e.stopPropagation();
        toggleFavoriteEffect(fxId);
      }, true);

      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const starBtn = e.target.closest('.effects-gallery-star-btn');
        if (!starBtn) return;
        const card = starBtn.closest('.effects-gallery-item-card');
        const fxId = card ? card.dataset.effectId : null;
        if (!fxId) return;
        e.preventDefault();
        e.stopPropagation();
        toggleFavoriteEffect(fxId);
      }, true);

      // 9. Gallery Search Filter (frame-throttled; matches name, id, category, description, keywords)
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          if (galleryUi.searchRaf) cancelAnimationFrame(galleryUi.searchRaf);
          galleryUi.searchRaf = requestAnimationFrame(() => {
            galleryUi.searchRaf = 0;
            galleryUi.query = searchInput.value.trim().toLowerCase();
            syncGalleryItemsFromRegistry();
            renderGalleryView();
            if (galleryBodyEl) galleryBodyEl.scrollTop = 0;
          });
        });
      }

      // 10. Click Outside to Close Kebab Menus
      document.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('.effects-card-kebab-btn') && !e.target.closest('.effects-kebab-menu')) {
          document.querySelectorAll('.effects-kebab-menu.is-open').forEach(m => {
            m.classList.remove('is-open');
            m.closest('.effects-card')?.classList.remove('has-kebab-open');
          });
        }
      });
    })();

    /* ==========================================================================
       EFFECT PRESET GALLERY ENGINE & MODAL CONTROLLER
       - Save current layer effects & keyframes as reusable preset
       - Apply presets to active layer with unique IDs & cache invalidation
       - Search, category filter, import & export
       ========================================================================== */
    (function () {
      let activeCategoryFilter = 'all';

      // 1. Open Save Preset Modal
      const btnSavePreset = document.getElementById('btn-effects-save-preset');
      if (btnSavePreset) {
        btnSavePreset.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) {
            showEffectsRackToast('Select a layer first');
            return;
          }
          const effects = ensureLayerEffects(layer);
          if (effects.length === 0) {
            showEffectsRackToast('No effects to save');
            return;
          }

          const nameInput = document.getElementById('input-preset-name');
          if (nameInput) {
            nameInput.value = `${layer.name || 'Layer'} Preset`;
          }

          if (window.Modal) window.Modal.open('modal-save-effect-preset');
        });
      }

      // 2. Confirm Save Preset
      const btnConfirmSavePreset = document.getElementById('btn-confirm-save-preset');
      if (btnConfirmSavePreset) {
        btnConfirmSavePreset.addEventListener('click', async (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          const effects = ensureLayerEffects(layer);
          if (effects.length === 0) return;

          const nameInput = document.getElementById('input-preset-name');
          const presetName = (nameInput && nameInput.value.trim()) || 'Custom Preset';

          const clonedEffects = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(effects) : (Array.isArray(effects) ? [] : {}));
          const keyframesData = {};
          if (layer.keyframes) {
            clonedEffects.forEach(fx => {
              getEffectParamIds(fx).forEach(p => {
                const k = `${fx.id}:${p}`;
                if (layer.keyframes[k]) {
                  keyframesData[k] = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.keyframes[k]) : (Array.isArray(layer.keyframes[k]) ? [] : {}));
                }
              });
            });
          }

          const presetObj = {
            id: 'ep_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: presetName,
            createdAt: Date.now(),
            effects: clonedEffects,
            keyframes: keyframesData
          };

          if (window.FishDatabase && typeof window.FishDatabase.saveEffectPreset === 'function') {
            await window.FishDatabase.saveEffectPreset(presetObj);
          }

          if (window.Modal) window.Modal.close('modal-save-effect-preset');
          showEffectsRackToast(`Preset "${presetName}" saved`);
          renderEffectPresetsUI();
        });
      }

      // 3. Open Preset Gallery
      const btnPresets = document.getElementById('btn-effects-presets');
      if (btnPresets) {
        btnPresets.addEventListener('click', (e) => {
          e.stopPropagation();
          renderEffectPresetsUI();
          if (window.Modal) window.Modal.open('modal-effect-presets');
        });
      }

      // 4. Render Preset Gallery List
      async function renderEffectPresetsUI() {
        const listEl = document.getElementById('preset-gallery-list');
        if (!listEl) return;

        let presets = [];
        if (window.FishDatabase && typeof window.FishDatabase.getEffectPresets === 'function') {
          presets = await window.FishDatabase.getEffectPresets();
        }

        const searchInput = document.getElementById('preset-search-input');
        const query = (searchInput ? searchInput.value.trim().toLowerCase() : '');

        let filtered = presets;
        if (query) {
          filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(query));
        }

        if (filtered.length === 0) {
          listEl.innerHTML = `
            <div class="preset-gallery-empty">
              <i class='fticon fticon-icon-24' style='width:32px;height:32px;font-size:32px;line-height:1;' aria-hidden='true'></i>
              <span>No presets found. Save effects from the rack to create one!</span>
            </div>
          `;
          return;
        }

        listEl.innerHTML = filtered.map(p => {
          const fxCount = Array.isArray(p.effects) ? p.effects.length : 0;
          const fxNames = Array.isArray(p.effects) ? p.effects.map(fx => {
            const def = (window.FishEffectsRegistry && window.FishEffectsRegistry.get(fx.type)) || null;
            return def ? (def.name || def.id) : (fx.name || fx.id);
          }).join(', ') : '';

          return `
            <div class="preset-card-item" data-preset-id="${p.id}">
              <div class="preset-card-info">
                <div class="preset-card-title-row">
                  <span class="preset-card-name">${p.name || 'Untitled'}</span>
                </div>
                <span class="preset-card-desc" title="${fxNames}">${fxCount} effect${fxCount > 1 ? 's' : ''}: ${fxNames || 'None'}</span>
              </div>
              <div class="preset-card-actions">
                <button type="button" class="btn-preset-apply" data-preset-id="${p.id}">Apply</button>
                <button type="button" class="btn-preset-delete" data-preset-id="${p.id}" title="Delete Preset" aria-label="Delete Preset">
                  <i class='fticon fticon-delete-selected-layer' style='width:16px;height:16px;font-size:16px;line-height:1;' aria-hidden='true'></i>
                </button>
              </div>
            </div>
          `;
        }).join('');

        // Bind Apply & Delete
        listEl.querySelectorAll('.btn-preset-apply').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const pid = btn.dataset.presetId;
            const preset = presets.find(item => item.id === pid);
            if (!preset) return;
            await applyEffectPresetToActiveLayer(preset);
            if (window.Modal) window.Modal.close('modal-effect-presets');
          });
        });

        listEl.querySelectorAll('.btn-preset-delete').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const pid = btn.dataset.presetId;
            if (window.FishDatabase && typeof window.FishDatabase.deleteEffectPreset === 'function') {
              await window.FishDatabase.deleteEffectPreset(pid);
              showEffectsRackToast('Preset deleted');
              renderEffectPresetsUI();
            }
          });
        });
      }

      // 5. Apply Effect Preset to Active Layer
      async function applyEffectPresetToActiveLayer(preset) {
        if (!preset || !Array.isArray(preset.effects)) return;
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!layer) {
          showEffectsRackToast('Select a layer first');
          return;
        }

        ensureLayerEffects(layer);

        // Record Undo
        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        preset.effects.forEach(fx => {
          const oldId = fx.id;
          const newFx = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(fx) : (Array.isArray(fx) ? [] : {}));
          newFx.id = 'fx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          newFx.name = fx.name;
          layer.effects.push(newFx);

          if (preset.keyframes) {
            layer.keyframes = layer.keyframes || {};
            getEffectParamIds(fx).forEach(p => {
              const oldK = `${oldId}:${p}`;
              if (preset.keyframes[oldK]) {
                layer.keyframes[`${newFx.id}:${p}`] = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(preset.keyframes[oldK]) : (Array.isArray(preset.keyframes[oldK]) ? [] : {}));
              }
            });
          }
        });

        sanitizeLayer3DEffects(layer);

        layer.hasBrightnessContrast = true;
        if (layer.effects.length > 0) {
          layer.brightness = layer.effects[0].brightness;
          layer.contrast = layer.effects[0].contrast;
          layer.effectsDisabled = !!layer.effects[0].disabled;
        }

        syncEffectsRackUI();
        if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
        if (typeof redrawComposition === 'function') redrawComposition('apply-effect-preset');
        if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
        if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
        if (typeof updateTimelineKeyframeMarkersHighlight === 'function') updateTimelineKeyframeMarkersHighlight();

        showEffectsRackToast(`Applied preset "${preset.name}"`);
      }

      // 6. Search & Category Filter Listeners
      const presetSearch = document.getElementById('preset-search-input');
      if (presetSearch) {
        presetSearch.addEventListener('input', () => {
          renderEffectPresetsUI();
        });
      }

      const categoryPillsContainer = document.getElementById('preset-category-pills');
      if (categoryPillsContainer) {
        categoryPillsContainer.addEventListener('click', (e) => {
          const pill = e.target.closest('.preset-category-pill');
          if (!pill) return;
          categoryPillsContainer.querySelectorAll('.preset-category-pill').forEach(p => p.classList.remove('is-active'));
          pill.classList.add('is-active');
          activeCategoryFilter = pill.dataset.cat || 'all';
          renderEffectPresetsUI();
        });
      }

      // 7. Export & Import Presets JSON
      const btnExportPresets = document.getElementById('btn-export-all-presets');
      if (btnExportPresets) {
        btnExportPresets.addEventListener('click', async (e) => {
          e.stopPropagation();
          let presets = [];
          if (window.FishDatabase && typeof window.FishDatabase.getEffectPresets === 'function') {
            presets = await window.FishDatabase.getEffectPresets();
          }
          if (presets.length === 0) {
            showEffectsRackToast('No presets to export');
            return;
          }
          const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `fish_effect_presets_${Date.now()}.fishpreset`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
          showEffectsRackToast('Exported presets');
        });
      }

      const inputImportPresets = document.getElementById('input-import-presets');
      if (inputImportPresets) {
        inputImportPresets.addEventListener('change', async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          try {
            const text = await file.text();
            const data = JSON.parse(text);
            const list = Array.isArray(data) ? data : [data];
            let count = 0;
            for (const item of list) {
              if (item && item.name && Array.isArray(item.effects)) {
                if (window.FishDatabase && typeof window.FishDatabase.saveEffectPreset === 'function') {
                  await window.FishDatabase.saveEffectPreset(item);
                  count++;
                }
              }
            }
            showEffectsRackToast(`Imported ${count} preset${count > 1 ? 's' : ''}`);
            renderEffectPresetsUI();
          } catch (err) {
            showEffectsRackToast('Invalid preset file');
          }
          inputImportPresets.value = '';
        });
      }

      window.renderEffectPresetsUI = renderEffectPresetsUI;
      window.applyEffectPresetToActiveLayer = applyEffectPresetToActiveLayer;
    })();

    /* ==========================================================================
       ELEMENT GALLERY (SAVED LAYER TEMPLATES) CONTROLLER
       - Save full layer (type, transform, keyframes, styles, effects) as Element
       - Insert element at current timeline playhead as new active layer
       - Search, delete, category integration
       ========================================================================== */
    (function () {
      // 1. Save as Element Trigger from Layer Popover
      const popoverBtnSaveElement = document.getElementById('popover-btn-save-element');
      if (popoverBtnSaveElement) {
        popoverBtnSaveElement.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.Popover) window.Popover.close();
          openSaveElementModal();
        });
      }

      function getTargetLayersForSaveElement() {
        const layers = currentProjectState.layers || [];
        const ids = [];
        if (window.selectedLayerId) ids.push(window.selectedLayerId);
        if (typeof selectedLayerId !== 'undefined' && selectedLayerId && !ids.includes(selectedLayerId)) {
          ids.push(selectedLayerId);
        }
        if (typeof selectedLayerIds !== 'undefined' && selectedLayerIds && selectedLayerIds.size > 0) {
          selectedLayerIds.forEach(id => { if (!ids.includes(id)) ids.push(id); });
        }
        if (window.selectedLayerIds && window.selectedLayerIds.size > 0) {
          window.selectedLayerIds.forEach(id => { if (!ids.includes(id)) ids.push(id); });
        }
        return layers.filter(l => ids.includes(l.id));
      }

      function cleanLayerForElementSave(layer) {
        const clonedData = (window.UndoRedoManager && window.UndoRedoManager._safeClone)
          ? window.UndoRedoManager._safeClone(layer)
          : JSON.parse(JSON.stringify(layer));
        delete clonedData._shapeBufferCanvas;
        delete clonedData._precompBufferCanvas;
        delete clonedData._fillBufferCanvas;
        delete clonedData._fillMediaImg;
        delete clonedData._alphaHitCanvas;
        delete clonedData._alphaHitCtx;
        delete clonedData._canvasBounds;
        delete clonedData._textBufferCanvas;
        delete clonedData._textMbCanvas;
        delete clonedData._bgCutoutBitmap;
        delete clonedData._lastRenderedFrame;
        return clonedData;
      }

      function openSaveElementModal() {
        const targetLayers = getTargetLayersForSaveElement();
        if (!targetLayers || targetLayers.length === 0) {
          showEffectsRackToast('Select a layer to save');
          return;
        }

        const nameInput = document.getElementById('input-element-name');
        if (nameInput) {
          if (targetLayers.length === 1) {
            const layer = targetLayers[0];
            nameInput.value = layer.name || `${layer.type || 'Layer'} Element`;
          } else {
            nameInput.value = `${targetLayers.length} Layers Element`;
          }
        }

        if (window.Modal) window.Modal.open('modal-save-element');
      }
      window.openSaveElementModal = openSaveElementModal;

      // 2. Confirm Save Element
      const btnConfirmSaveElement = document.getElementById('btn-confirm-save-element');
      if (btnConfirmSaveElement) {
        btnConfirmSaveElement.addEventListener('click', async (e) => {
          e.stopPropagation();
          const targetLayers = getTargetLayersForSaveElement();
          if (!targetLayers || targetLayers.length === 0) return;

          const firstLayer = targetLayers[0];
          const nameInput = document.getElementById('input-element-name');
          const defaultName = targetLayers.length > 1 ? `${targetLayers.length} Layers Element` : (firstLayer.name || 'Untitled Element');
          const elemName = (nameInput && nameInput.value.trim()) || defaultName;

          const pps = window.currentPixelsPerSecond || 80;
          const currentPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
          const savePlayheadSec = (typeof getCurrentPlayheadTime === 'function')
            ? getCurrentPlayheadTime()
            : Math.max(0, -currentPanX / pps);

          const clonedLayers = targetLayers.map(l => cleanLayerForElementSave(l));
          const minStartSec = Math.min(...clonedLayers.map(l => (l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps))));
          const maxEndSec = Math.max(...clonedLayers.map(l => {
            const s = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
            const d = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 320) / pps);
            return s + d;
          }));

          // Capture 100% exact playhead anchor when playhead is inside the saved layer(s) span
          const anchorSec = (savePlayheadSec >= minStartSec - 0.001 && savePlayheadSec <= maxEndSec + 0.001)
            ? savePlayheadSec
            : minStartSec;

          const elemObj = {
            id: 'elem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: elemName,
            type: clonedLayers.length > 1 ? 'group' : (firstLayer.type || 'layer'),
            createdAt: Date.now(),
            layerData: clonedLayers[0],
            layersData: clonedLayers,
            layerCount: clonedLayers.length,
            anchorSec: Number(anchorSec.toFixed(4)),
            minStartSec: Number(minStartSec.toFixed(4)),
            maxEndSec: Number(maxEndSec.toFixed(4))
          };

          if (window.FishDatabase && typeof window.FishDatabase.saveSavedElement === 'function') {
            await window.FishDatabase.saveSavedElement(elemObj);
          }

          if (window.Modal) window.Modal.close('modal-save-element');
          showEffectsRackToast(clonedLayers.length > 1 ? `Saved ${clonedLayers.length} layers to "${elemName}"` : `Saved element "${elemName}"`);
          renderSavedElementsGrid();
        });
      }

      // 3. Render Saved Elements in Add Layer Drawer
      async function renderSavedElementsGrid() {
        const gridEl = document.getElementById('drawer-element-preset-grid');
        if (!gridEl) return;

        let elements = [];
        if (window.FishDatabase && typeof window.FishDatabase.getSavedElements === 'function') {
          elements = await window.FishDatabase.getSavedElements();
        }

        const searchInput = document.getElementById('drawer-element-search-input');
        const query = (searchInput ? searchInput.value.trim().toLowerCase() : '');

        let filtered = elements;
        if (query) {
          filtered = filtered.filter(item => (item.name || '').toLowerCase().includes(query) || (item.type || '').toLowerCase().includes(query));
        }

        if (filtered.length === 0) {
          gridEl.innerHTML = `
            <div style="grid-column: 1 / -1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 28px 12px; color: var(--text-muted); font-size: 12px; gap: 6px; text-align: center;">
              <span>No saved elements. Right-click a layer on timeline and click "Save as Element"!</span>
            </div>
          `;
          return;
        }

        const typeIconMap = {
          text: '<i class="fticon fticon-icon-25" aria-hidden="true"></i>',
          shape: '<i class="fticon fticon-icon-26" aria-hidden="true"></i>',
          video: '<i class="fticon fticon-icon-20" aria-hidden="true"></i>',
          image: '<i class="fticon fticon-icon-21" aria-hidden="true"></i>',
          audio: '<i class="fticon fticon-icon-18" aria-hidden="true"></i>',
          adjustment: '<i class="fticon fticon-icon-27" aria-hidden="true"></i>',
          group: '<i class="fticon fticon-icon-28" aria-hidden="true"></i>'
        };

        gridEl.innerHTML = filtered.map(item => {
          const lData = item.layerData || (Array.isArray(item.layersData) && item.layersData[0]) || {};
          const count = Array.isArray(item.layersData) ? item.layersData.length : (item.layerCount || 1);
          const type = (count > 1 ? 'group' : (item.type || lData.type || 'layer')).toLowerCase();
          const metaLabel = count > 1 ? `${count} layers` : type;
          const icon = typeIconMap[type] || typeIconMap.shape;

          return `
            <div class="element-gallery-card" data-element-id="${item.id}" title="Click to insert to timeline">
              <button type="button" class="element-gallery-card-delete" data-element-id="${item.id}" title="Delete Element" aria-label="Delete Element">
                <i class='fticon fticon-close-3' style='width:14px;height:14px;font-size:14px;line-height:1;' aria-hidden='true'></i>
              </button>
              <div class="element-gallery-card-icon">${icon}</div>
              <span class="element-gallery-card-title">${item.name || 'Untitled'}</span>
              <span class="element-gallery-card-meta">${metaLabel}</span>
            </div>
          `;
        }).join('');

        // Bind Insert & Delete
        gridEl.querySelectorAll('.element-gallery-card').forEach(card => {
          card.addEventListener('click', async (e) => {
            if (e.target.closest('.element-gallery-card-delete')) return;
            e.stopPropagation();
            const eid = card.dataset.elementId;
            const element = elements.find(item => item.id === eid);
            if (!element) return;
            insertSavedElementToTimeline(element);
          });
        });

        gridEl.querySelectorAll('.element-gallery-card-delete').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const eid = btn.dataset.elementId;
            if (window.FishDatabase && typeof window.FishDatabase.deleteSavedElement === 'function') {
              await window.FishDatabase.deleteSavedElement(eid);
              showEffectsRackToast('Element removed');
              renderSavedElementsGrid();
            }
          });
        });
      }

      // 4. Insert Element into Timeline at current playhead with 100% exact relative position
      function insertSavedElementToTimeline(element) {
        const sourceLayers = (element && Array.isArray(element.layersData) && element.layersData.length > 0)
          ? element.layersData
          : (element && element.layerData ? [element.layerData] : []);
        if (sourceLayers.length === 0) return;

        currentProjectState.layers = currentProjectState.layers || [];

        // Record Undo
        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        const pps = window.currentPixelsPerSecond || 80;
        const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60);
        const currentPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
        const playheadSec = (typeof getCurrentPlayheadTime === 'function')
          ? getCurrentPlayheadTime()
          : Math.max(0, -currentPanX / pps);

        const minStartSec = Math.min(...sourceLayers.map(l => (l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps))));
        const anchorSec = (typeof element.anchorSec === 'number' && isFinite(element.anchorSec))
          ? element.anchorSec
          : minStartSec;
        const rawDeltaSec = Math.max(-minStartSec, playheadSec - anchorSec);
        const deltaSec = Math.round(rawDeltaSec * safeFps) / safeFps;

        // Pass 1: build ID map for internal parentId hierarchy
        const idMap = new Map();
        sourceLayers.forEach((srcL, idx) => {
          const newId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5) + '_' + idx;
          if (srcL.id) idMap.set(srcL.id, newId);
        });

        const insertedLayers = [];
        const insertedIds = [];

        sourceLayers.forEach((srcL, idx) => {
          const base = (window.UndoRedoManager && window.UndoRedoManager._safeClone)
            ? window.UndoRedoManager._safeClone(srcL)
            : JSON.parse(JSON.stringify(srcL));
          const newLayerId = idMap.get(srcL.id) || ('layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5) + '_' + idx);
          const origStartSec = base.startSec !== undefined ? base.startSec : ((base.startPx || 0) / pps);
          const durationSec = base.durationSec !== undefined ? base.durationSec : (base.widthPx ? (base.widthPx / pps) : 4);
          const newStartSec = Math.max(0, Math.round((origStartSec + deltaSec) * safeFps) / safeFps);

          base.id = newLayerId;
          if (sourceLayers.length === 1) {
            base.name = `${element.name || base.name || 'Element'}`;
          } else {
            base.name = base.name || `${element.name || 'Element'} ${idx + 1}`;
          }
          base.startSec = newStartSec;
          base.startPx = Math.round(newStartSec * pps);
          base.durationSec = durationSec;
          base.widthPx = Math.round(durationSec * pps);
          base.parentId = (base.parentId && idMap.has(base.parentId)) ? idMap.get(base.parentId) : null;

          // Shift all keyframe times by deltaSec so animations match the imported position 100%
          if (base.keyframes && typeof base.keyframes === 'object' && Math.abs(deltaSec) > 0.0001) {
            Object.keys(base.keyframes).forEach(prop => {
              if (Array.isArray(base.keyframes[prop])) {
                base.keyframes[prop].forEach(kf => {
                  if (kf && typeof kf.time === 'number') {
                    kf.time = Number(Math.max(0, kf.time + deltaSec).toFixed(4));
                  }
                });
              }
            });
          }

          // Regenerate unique IDs for all nested effects & remap keyframes
          if (Array.isArray(base.effects)) {
            const oldEffects = base.effects;
            base.effects = [];
            const kfMap = {};

            oldEffects.forEach(fx => {
              const oldFxId = fx.id;
              const newFx = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(fx) : JSON.parse(JSON.stringify(fx)));
              newFx.id = 'fx_' + (fx.type || 'fx') + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
              base.effects.push(newFx);

              if (base.keyframes) {
                Object.keys(base.keyframes).forEach(k => {
                  if (k.startsWith(oldFxId + ':')) {
                    const paramName = k.slice(oldFxId.length + 1);
                    kfMap[`${newFx.id}:${paramName}`] = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(base.keyframes[k]) : JSON.parse(JSON.stringify(base.keyframes[k])));
                    delete base.keyframes[k];
                  }
                });
              }
            });

            if (base.keyframes) {
              Object.assign(base.keyframes, kfMap);
            }
          }

          if (Array.isArray(base.audioEffects)) {
            base.audioEffects.forEach(fx => {
              fx.id = 'fx_' + (fx.type || 'audio') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            });
          }

          if (typeof invalidatePreviewCacheForLayer === 'function') {
            invalidatePreviewCacheForLayer(base);
          }

          insertedLayers.push(base);
          insertedIds.push(newLayerId);
        });

        // Insert at top of timeline stack preserving exact original layer order
        currentProjectState.layers.unshift(...insertedLayers);

        if (insertedIds.length === 1) {
          window.selectedLayerId = insertedIds[0];
          if (window.selectedLayerIds) {
            window.selectedLayerIds.clear();
            window.selectedLayerIds.add(insertedIds[0]);
          }
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          if (typeof selectTimelineLayer === 'function') selectTimelineLayer(insertedIds[0], false);
        } else if (insertedIds.length > 1) {
          window.selectedLayerId = insertedIds[0];
          if (typeof selectedLayerId !== 'undefined') selectedLayerId = insertedIds[0];
          if (window.selectedLayerIds) {
            window.selectedLayerIds.clear();
            insertedIds.forEach(id => window.selectedLayerIds.add(id));
          }
          if (typeof selectedLayerIds !== 'undefined' && selectedLayerIds) {
            selectedLayerIds.clear();
            insertedIds.forEach(id => selectedLayerIds.add(id));
          }
          if (typeof isSelectorMode !== 'undefined') isSelectorMode = true;
          window.isSelectorMode = true;
          if (typeof updateEditorHeaderMode === 'function') updateEditorHeaderMode();
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
        }

        if (typeof redrawComposition === 'function') redrawComposition('insert-element');
        if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
        if (typeof updateTimelineDuration === 'function') updateTimelineDuration(true);

        // Close Add Drawer
        const drawer = document.getElementById('timeline-add-drawer');
        if (drawer && typeof window.closeDrawer === 'function') {
          window.closeDrawer(drawer);
        }

        showEffectsRackToast(`Inserted "${element.name}"`);
      }
      window.insertSavedElementToTimeline = insertSavedElementToTimeline;

      // 5. Search Filter in Drawer
      const elemSearch = document.getElementById('drawer-element-search-input');
      if (elemSearch) {
        elemSearch.addEventListener('input', () => {
          renderSavedElementsGrid();
        });
      }

      window.renderSavedElementsGrid = renderSavedElementsGrid;
      window.insertSavedElementToTimeline = insertSavedElementToTimeline;
    })();

    /* ==========================================================================
       QUICK EFFECTS SEARCH PALETTE (Ctrl + Space)
       ========================================================================== */
    function getSelectedTimelineLayers() {
      const ids = new Set();
      if (window.selectedLayerId) ids.add(String(window.selectedLayerId));
      if (window.selectedLayerIds) {
        if (typeof window.selectedLayerIds.forEach === 'function') {
          window.selectedLayerIds.forEach(id => { if (id) ids.add(String(id)); });
        } else if (Array.isArray(window.selectedLayerIds)) {
          window.selectedLayerIds.forEach(id => { if (id) ids.add(String(id)); });
        }
      }

      // DOM fallback if JS sets are empty
      if (ids.size === 0) {
        document.querySelectorAll('.timeline-clip.is-selected, .timeline-layer.is-selected, [data-layer-id].is-selected').forEach(el => {
          const lid = el.dataset.layerId || el.getAttribute('data-id');
          if (lid) ids.add(String(lid));
        });
      }

      if (ids.size === 0) return [];

      const layers = (currentProjectState && Array.isArray(currentProjectState.layers)) ? currentProjectState.layers : [];
      const matched = layers.filter(l => l && ids.has(String(l.id)));
      if (matched.length > 0) return matched;

      // Safe fallback: never drop selection
      return Array.from(ids).map(id => {
        const found = layers.find(l => String(l.id) === String(id));
        return found || { id: id, name: 'Selected Layer', effects: [] };
      });
    }
    window.getSelectedTimelineLayers = getSelectedTimelineLayers;

    function getAllAvailableEffects() {
      // Single source of truth: FishEffectsRegistry (populated by effects/loader.js auto-discovery)
      if (window.FishEffectsRegistry && typeof window.FishEffectsRegistry.getAll === 'function') {
        return window.FishEffectsRegistry.getAll();
      }
      return [];
    }
    window.getAllAvailableEffects = getAllAvailableEffects;

    function applyEffectToSelectedLayers(effectTypeId = 'brightness-contrast') {
      const targetLayers = getSelectedTimelineLayers();
      if (!targetLayers || targetLayers.length === 0) return;

      const incomingDef = (window.FishEffects && window.FishEffects.registry) ? window.FishEffects.registry.get(effectTypeId) : null;
      const incomingIs3D = !!(incomingDef && (incomingDef.isExclusive3D || (incomingDef.category && incomingDef.category.toLowerCase() === '3d'))) ||
        effectTypeId === 'box_3d' || effectTypeId === 'cube_3d' || effectTypeId === 'extrude_3d' || effectTypeId === 'pyramid_3d' || effectTypeId === 'sphere_3d';

      let lastNewFx = null;
      targetLayers.forEach(layer => {
        ensureLayerEffects(layer);

        if (incomingIs3D) {
          layer.is3D = true;
          const lW = Math.round(layer.scaleW || layer.w || 300);
          const lH = Math.round(layer.scaleH || layer.h || 300);
          if (layer.scaleZ === undefined) {
            layer.scaleZ = Math.max(20, Math.round(Math.min(Math.abs(lW), Math.abs(lH))));
          }
          const btn3D = document.getElementById('btn-layer-header-3d');
          if (btn3D && window.selectedLayerId === layer.id) {
            btn3D.classList.add('is-active');
            btn3D.setAttribute('aria-pressed', 'true');
          }
          if (Array.isArray(layer.effects)) {
            const existing3DIdx = layer.effects.findIndex(fx => {
              const d = window.FishEffectsRegistry ? window.FishEffectsRegistry.get(fx.type) : null;
              return d && (d.isExclusive3D || (d.category && d.category.toLowerCase() === '3d'));
            });
            if (existing3DIdx !== -1) {
              layer.effects.splice(existing3DIdx, 1);
            }
          }
        }

        let newFx = null;
        if (window.FishEffects && window.FishEffects.registry && typeof window.FishEffects.registry.createInstance === 'function') {
          newFx = window.FishEffects.registry.createInstance(effectTypeId);
        }
        if (!newFx) {
          newFx = {
            id: 'fx_' + effectTypeId.replace(/[^a-z0-9]/gi, '_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type: effectTypeId,
            name: effectTypeId,
            isExpanded: true,
            disabled: false
          };
        }
        if (incomingIs3D && newFx) {
          const lW = Math.round(layer.scaleW || layer.w || 300);
          const lH = Math.round(layer.scaleH || layer.h || 300);
          const cubeDim = Math.max(20, Math.round(Math.min(Math.abs(lW), Math.abs(lH))));
          if (layer.scaleZ === undefined) layer.scaleZ = cubeDim;
        }
        layer.effects.push(newFx);

        if (incomingIs3D && typeof sanitizeLayer3DEffects === 'function') {
          sanitizeLayer3DEffects(layer);
        }

        layer.hasBrightnessContrast = true;
        if (layer.effects[0]) {
          layer.brightness = layer.effects[0].brightness !== undefined ? layer.effects[0].brightness : 0;
          layer.contrast = layer.effects[0].contrast !== undefined ? layer.effects[0].contrast : 0;
          layer.effectsDisabled = !!layer.effects[0].disabled;
        }
        if (effectTypeId === 'remove_bg') {
          if (window.FishBgRemovalEngine) {
            window.FishBgRemovalEngine.processLayer(layer, true);
          }
        }
        if (typeof invalidatePreviewCacheForLayer === 'function') {
          invalidatePreviewCacheForLayer(layer);
        }
        lastNewFx = newFx;
      });

      if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
      if (typeof redrawComposition === 'function') redrawComposition('add-effect');
      if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
      if (incomingIs3D) {
        if (typeof syncTransform3DVisibility === 'function') syncTransform3DVisibility();
        if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
      }

      if (lastNewFx) {
        const params = (typeof getEffectParamIds === 'function') ? getEffectParamIds(lastNewFx) : ['param'];
        window.activeKeyframeProperty = `${lastNewFx.id}:${params[0] || 'param'}`;
      }

      if (typeof syncEffectsRackUI === 'function') {
        syncEffectsRackUI();
      }

      if (window.Modal && typeof window.Modal.close === 'function') {
        window.Modal.close();
      } else {
        const modal = document.getElementById('modal-quick-effects');
        if (modal) modal.classList.remove('is-active');
      }
    }
    window.applyEffectToSelectedLayers = applyEffectToSelectedLayers;

    quickEffectsFocusedIndex = 0;
    quickEffectsFilteredList = [];

    function openQuickEffectsSearch() {
      const selectedLayers = getSelectedTimelineLayers();
      if (!selectedLayers || selectedLayers.length === 0) return;

      const modal = document.getElementById('modal-quick-effects');
      if (!modal) return;

      const badge = document.getElementById('quick-effects-target-badge');
      if (badge) {
        if (selectedLayers.length === 1) {
          const name = selectedLayers[0].name || '1 Layer';
          badge.textContent = name.length > 18 ? name.slice(0, 18) + '...' : name;
        } else {
          badge.textContent = `${selectedLayers.length} Layers`;
        }
      }

      const input = document.getElementById('quick-effects-input');
      if (input) {
        input.value = '';
      }

      quickEffectsFocusedIndex = 0;
      renderQuickEffectsList('');

      if (window.Modal && typeof window.Modal.open === 'function') {
        window.Modal.open('modal-quick-effects');
      } else {
        modal.classList.add('is-active');
      }

      setTimeout(() => {
        if (input) {
          input.focus();
          input.select();
        }
      }, 50);
    }
    window.openQuickEffectsSearch = openQuickEffectsSearch;

    function renderQuickEffectsList(query = '') {
      const listContainer = document.getElementById('quick-effects-list');
      if (!listContainer) return;

      const allEffects = getAllAvailableEffects();
      const q = (query || '').trim().toLowerCase();

      quickEffectsFilteredList = allEffects.filter(fx => {
        if (!q) return true;
        const name = (fx.name || fx.id || '').toLowerCase();
        const cat = (fx.category || '').toLowerCase();
        const id = (fx.id || '').toLowerCase();
        const isCubeMatch = (id.includes('box') || id.includes('cube') || name.includes('box') || name.includes('cube')) && ('cube'.includes(q) || 'kubus'.includes(q));
        return name.includes(q) || cat.includes(q) || id.includes(q) || isCubeMatch;
      });

      if (quickEffectsFilteredList.length === 0) {
        const safeQ = q.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        listContainer.innerHTML = `<div class="quick-effects-empty">No effects matching "${safeQ}"</div>`;
        quickEffectsFocusedIndex = -1;
        return;
      }

      if (quickEffectsFocusedIndex < 0 || quickEffectsFocusedIndex >= quickEffectsFilteredList.length) {
        quickEffectsFocusedIndex = 0;
      }

      listContainer.innerHTML = quickEffectsFilteredList.map((fx, idx) => {
        const isFocused = idx === quickEffectsFocusedIndex;
        const safeName = (fx.name || fx.id || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeCat = (fx.category || 'effect').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `
          <button type="button" class="quick-effects-item ${isFocused ? 'is-focused' : ''}" data-effect-id="${fx.id}" data-idx="${idx}" role="option" aria-selected="${isFocused}">
            <span class="quick-effects-item-name">${safeName}</span>
            <span class="quick-effects-item-cat">${safeCat}</span>
          </button>
        `;
      }).join('');

      const focusedItem = listContainer.querySelector('.quick-effects-item.is-focused');
      if (focusedItem) {
        focusedItem.scrollIntoView({ block: 'nearest' });
      }
    }

    function updateQuickEffectsFocus(newIndex) {
      const listContainer = document.getElementById('quick-effects-list');
      if (!listContainer || quickEffectsFilteredList.length === 0) return;

      const items = listContainer.querySelectorAll('.quick-effects-item');
      if (items.length === 0) return;

      quickEffectsFocusedIndex = ((newIndex % items.length) + items.length) % items.length;

      items.forEach((item, idx) => {
        const isFocused = idx === quickEffectsFocusedIndex;
        item.classList.toggle('is-focused', isFocused);
        item.setAttribute('aria-selected', isFocused ? 'true' : 'false');
        if (isFocused) {
          item.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    const quickEffectsInput = document.getElementById('quick-effects-input');
    const quickEffectsList = document.getElementById('quick-effects-list');

    if (quickEffectsInput) {
      quickEffectsInput.addEventListener('input', () => {
        quickEffectsFocusedIndex = 0;
        renderQuickEffectsList(quickEffectsInput.value);
      });

      quickEffectsInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          updateQuickEffectsFocus(quickEffectsFocusedIndex + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          updateQuickEffectsFocus(quickEffectsFocusedIndex - 1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (quickEffectsFilteredList.length > 0 && quickEffectsFocusedIndex >= 0 && quickEffectsFocusedIndex < quickEffectsFilteredList.length) {
            const selectedFx = quickEffectsFilteredList[quickEffectsFocusedIndex];
            if (selectedFx && selectedFx.id) {
              applyEffectToSelectedLayers(selectedFx.id);
            }
          }
        }
      });
    }

    if (quickEffectsList) {
      quickEffectsList.addEventListener('click', (e) => {
        const item = e.target.closest('.quick-effects-item');
        if (!item) return;
        const effectId = item.dataset.effectId;
        if (effectId) {
          applyEffectToSelectedLayers(effectId);
        }
      });
    }

    // Global Dedicated Capture Listener for Ctrl + Space (Quick Effects Search)
    window.addEventListener('keydown', (e) => {
      const isSpace = (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.keyCode === 32);
      if ((e.ctrlKey || e.metaKey) && isSpace) {
        const qModal = document.getElementById('modal-quick-effects');
        if (qModal && qModal.classList.contains('is-active')) {
          return;
        }
        const otherModal = document.querySelector('.modal-backdrop.is-active:not(#modal-quick-effects)');
        if (otherModal) return;

        const targetLayers = (typeof getSelectedTimelineLayers === 'function') ? getSelectedTimelineLayers() : [];
        if (targetLayers && targetLayers.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          }
          openQuickEffectsSearch();
        }
      }
    }, true);
})();
