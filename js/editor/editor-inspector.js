/**
 * OpenFishTools Studio - Editor Inspector & Transform Controller
 * Manages property drawer navigation, rotary jog wheels (bindJogWheel), desktop rotation dials,
 * numeric steppers, touch swipe scrubbing, blend overlay, volume slider, and speed/time-remapping subviews.
 */
(function() {
    currentDrawerSubview = 'main';
    window.currentDrawerSubview = 'main';
    currentRotateAxis = 'z';
    window.currentRotateAxis = 'z';

    // Modular detector: true ONLY when drawer is open AND showing an active property editor (e.g. transform, graph)
    function isPropertyEditorActive() {
      const drawerEl = document.getElementById('timeline-layer-drawer');
      const isDrawerOpen = (window.Drawer && typeof window.Drawer.isOpen === 'function' && window.Drawer.isOpen('timeline-layer-drawer')) || (drawerEl && drawerEl.classList.contains('is-active'));
      if (!isDrawerOpen) return false;
      if (!window.selectedLayerId) return false;

      const currentView = window.currentDrawerSubview || currentDrawerSubview || 'main';
      const propertySubviews = ['transform', 'graph', 'opacity', 'effects', 'blend', 'camera', 'volume', 'speed', 'vector'];
      return propertySubviews.includes(currentView);
    }
    window.isPropertyEditorActive = isPropertyEditorActive;

    // Modular detector for desktop workstation layout
    function isDesktopLayout() {
      return Boolean(
        document.querySelector('.desktop-timeline-wrapper, .desktop-workstation, .desktop-viewport') ||
        (window.location && (window.location.pathname.includes('desktop.html') || window.location.pathname.includes('/desktop')))
      );
    }
    window.isDesktopLayout = isDesktopLayout;

    // Fast selective update of timeline diamond keyframe marker highlight classes without full redraw
    function updateTimelineKeyframeMarkersHighlight() {
      const isPropActive = isPropertyEditorActive();
      const activeProp = window.activeKeyframeProperty;
      const selLayerId = window.selectedLayerId;

      document.querySelectorAll('.timeline-clip-block').forEach(clipEl => {
        const layerId = clipEl.dataset.layerId;
        const isSelectedLayer = (layerId && layerId === selLayerId);

        clipEl.querySelectorAll('.timeline-keyframe-marker').forEach(marker => {
          const prop = marker.dataset.prop;
          const isActive = isPropActive && isSelectedLayer && !!(activeProp && prop === activeProp);
          marker.classList.toggle('is-active-prop', isActive);
          marker.classList.toggle('is-other-prop', !isActive);
          if (!isActive && !isDesktopLayout()) {
            marker.classList.remove('is-selected-kf', 'is-dragging');
          }
        });
      });

      if (Array.isArray(window.selectedKeyframes)) {
        document.querySelectorAll('.desktop-kf-diamond').forEach(diamond => {
          const prop = diamond.dataset.prop;
          const time = Number(diamond.dataset.time);
          const lane = diamond.closest('.timeline-track-lane');
          const layerId = lane ? lane.dataset.layerId : null;
          const isSelected = window.selectedKeyframes.some(it => 
            (it.marker === diamond) || (it.layerId === layerId && it.prop === prop && Math.abs(it.time - time) < 0.002)
          );
          diamond.classList.toggle('is-selected-kf', isSelected);
        });
      }
    }
    window.updateTimelineKeyframeMarkersHighlight = updateTimelineKeyframeMarkersHighlight;

    function openEffectsGalleryDrawer() {
      if (typeof window.closeGalleryCategory === 'function') {
        window.closeGalleryCategory();
      }
      if (typeof window.syncGalleryHomeSections === 'function') {
        window.syncGalleryHomeSections();
      }
      if (typeof window.autoFetchAndLoadEffects === 'function') {
        window.autoFetchAndLoadEffects();
      }
      const inlineGallery = document.getElementById('layer-drawer-effects-gallery-view');
      if (inlineGallery) {
        switchLayerDrawerSubview('effects-gallery');
        return;
      }
      if (window.Drawer && typeof window.Drawer.open === 'function') {
        window.Drawer.open('drawer-effects-gallery');
      } else {
        const el = document.getElementById('drawer-effects-gallery');
        if (el) {
          el.classList.add('is-active');
          el.setAttribute('aria-hidden', 'false');
        }
      }
    }
    window.openEffectsGalleryDrawer = openEffectsGalleryDrawer;

    function closeEffectsGalleryDrawer(triggerHistoryBack = true) {
      const inlineGallery = document.getElementById('layer-drawer-effects-gallery-view');
      if (inlineGallery && currentDrawerSubview === 'effects-gallery') {
        switchLayerDrawerSubview('effects');
        return;
      }
      if (window.Drawer && typeof window.Drawer.close === 'function') {
        if (window.Drawer.activeDrawer && window.Drawer.activeDrawer.id === 'drawer-effects-gallery') {
          window.Drawer.close(triggerHistoryBack);
          return;
        }
      }
      const el = document.getElementById('drawer-effects-gallery');
      if (el) {
        el.classList.remove('is-active');
        el.setAttribute('aria-hidden', 'true');
        const card = el.querySelector('.drawer-card');
        if (card) card.style.height = '';
      }
    }
    window.closeEffectsGalleryDrawer = closeEffectsGalleryDrawer;

    function switchLayerDrawerSubview(subviewName) {
      const inlineGallery = document.getElementById('layer-drawer-effects-gallery-view');
      if (subviewName === 'effects-gallery' && !inlineGallery) {
        openEffectsGalleryDrawer();
        return;
      }
      const validSubviews = ['main', 'transform', 'graph', 'blend', 'effects', 'effects-gallery', 'camera', 'fill', 'volume', 'speed', 'shape', 'vector', 'text', 'beatmark'];
      if (!validSubviews.includes(subviewName)) subviewName = 'main';

      // If drawer-effects-gallery is open when navigating to other subviews, close it
      const fxGal = document.getElementById('drawer-effects-gallery');
      if (fxGal && fxGal.classList.contains('is-active')) {
        closeEffectsGalleryDrawer(false);
      }

      const prevSubview = currentDrawerSubview || 'main';
      if (subviewName === 'graph' && prevSubview !== 'graph') {
        window.previousDrawerSubview = prevSubview;
      }
      currentDrawerSubview = subviewName;
      window.currentDrawerSubview = subviewName;

      const drawerEl = document.getElementById('timeline-layer-drawer');
      if (drawerEl) {
        drawerEl.setAttribute('data-subview', subviewName);
      }

      // Deselect any selected keyframes when switching or navigating back (preserve selection between transform and graph)
      if (subviewName !== 'graph' && prevSubview !== 'graph') {
        if (typeof window.clearSelectedKeyframes === 'function') {
          window.clearSelectedKeyframes();
        }
      }

      // Determine animation direction
      const isBackward = (subviewName === 'main') || ((subviewName === 'transform' || subviewName === 'vector') && prevSubview === 'graph') || (subviewName === 'effects' && prevSubview === 'effects-gallery');
      const animClass = isBackward ? 'is-entering-backward' : 'is-entering-forward';

      const allSubviews = {
        'main': document.getElementById('layer-drawer-main-view'),
        'transform': document.getElementById('layer-drawer-transform-view'),
        'graph': document.getElementById('layer-drawer-graph-view'),
        'blend': document.getElementById('layer-drawer-blend-view'),
        'effects': document.getElementById('layer-drawer-effects-view'),
        'effects-gallery': inlineGallery,
        'camera': document.getElementById('layer-drawer-camera-view'),
        'fill': document.getElementById('layer-drawer-fill-view'),
        'volume': document.getElementById('layer-drawer-volume-view'),
        'speed': document.getElementById('layer-drawer-speed-view'),
        'shape': document.getElementById('layer-drawer-shape-view'),
        'vector': document.getElementById('layer-drawer-vector-view'),
        'text': document.getElementById('layer-drawer-text-view'),
        'beatmark': document.getElementById('layer-drawer-beatmark-view')
      };

      const drawerCard = document.querySelector('#timeline-layer-drawer .drawer-card');

      Object.entries(allSubviews).forEach(([name, el]) => {
        if (!el) return;
        const isActive = (name === subviewName);
        el.classList.remove('is-entering-forward', 'is-entering-backward');
        if (isActive) {
          el.classList.add('is-active');
          if (prevSubview !== subviewName) {
            el.classList.add(animClass);
          }
        } else {
          el.classList.remove('is-active');
        }
      });

      if (drawerCard) {
        drawerCard.classList.remove('is-effects-gallery');

        if (drawerCard._subviewHeightTimer) {
          clearTimeout(drawerCard._subviewHeightTimer);
          delete drawerCard._subviewHeightTimer;
        }

        // Standard subviews render instantaneously at their native height without delay
        drawerCard.style.height = '';
        if (!drawerCard._closingFromDrag) {
          drawerCard.style.transition = '';
        }
        delete drawerCard._targetHeight;
      }

      if (subviewName === 'main' || subviewName === 'text' || subviewName === 'fill' || subviewName === 'shape') {
        window.activeKeyframeProperty = null;
      }

      if (subviewName === 'transform') {
        window.activeKeyframeProperty = window.activeTransformTool || 'move';
        syncTransformControllerValues();
        updateTransformKeyframeBtnState();
        try {
          history.pushState({ drawerSubview: 'transform' }, '');
        } catch (_) {}
      } else if (subviewName === 'camera') {
        window.activeKeyframeProperty = 'cameraZoom';
        if (typeof syncCameraSettingsUI === 'function') {
          syncCameraSettingsUI();
        }
        if (typeof updateCameraKeyframeBtnState === 'function') {
          updateCameraKeyframeBtnState();
        }
        try {
          history.pushState({ drawerSubview: 'camera' }, '');
        } catch (_) {}
      } else if (subviewName === 'blend') {
        window.activeKeyframeProperty = 'opacity';
        if (typeof syncBlendOverlayValues === 'function') {
          syncBlendOverlayValues();
        }
        if (typeof updateBlendKeyframeBtnState === 'function') {
          updateBlendKeyframeBtnState();
        }
        try {
          history.pushState({ drawerSubview: 'blend' }, '');
        } catch (_) {}
      } else if (subviewName === 'graph') {
        if (typeof updateGraphEditorUI === 'function') {
          updateGraphEditorUI();
        }
        try {
          history.pushState({ drawerSubview: 'graph' }, '');
        } catch (_) {}
      } else if (subviewName === 'effects') {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        const curProp = window.activeKeyframeProperty;
        const isValidFxProp = curProp && curProp.includes(':') && layer && Array.isArray(layer.effects) && layer.effects.some(f => curProp.startsWith(f.id + ':'));
        window.activeKeyframeProperty = isValidFxProp ? curProp : null;
        if (typeof syncEffectsRackUI === 'function') {
          syncEffectsRackUI(true);
        }
        if (typeof updateEffectsKeyframeAndGraphBtnStates === 'function') {
          updateEffectsKeyframeAndGraphBtnStates();
        }
        try {
          history.pushState({ drawerSubview: 'effects' }, '');
        } catch (_) {}
      } else if (subviewName === 'fill') {
        if (typeof syncFillControllerUI === 'function') {
          syncFillControllerUI();
        }
        try {
          history.pushState({ drawerSubview: 'fill' }, '');
        } catch (_) {}
      } else if (subviewName === 'volume') {
        window.activeKeyframeProperty = 'volume';
        if (typeof syncVolumeControllerValues === 'function') {
          syncVolumeControllerValues();
        }
        if (typeof updateVolumeKeyframeBtnState === 'function') {
          updateVolumeKeyframeBtnState();
        }
        const curL = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (typeof renderAudioEffectsRack === 'function') {
          renderAudioEffectsRack(curL);
        }
        try {
          history.pushState({ drawerSubview: 'volume' }, '');
        } catch (_) {}
      } else if (subviewName === 'speed') {
        const curL = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        window.activeKeyframeProperty = (curL && curL.speedMode === 'time_remap') ? 'timeRemap' : 'speed';
        if (typeof syncSpeedControllerValues === 'function') {
          syncSpeedControllerValues();
        }
        if (typeof updateSpeedKeyframeBtnState === 'function') {
          updateSpeedKeyframeBtnState();
        }
        try {
          history.pushState({ drawerSubview: 'speed' }, '');
        } catch (_) {}
      } else if (subviewName === 'shape') {
        if (typeof syncShapeControllerUI === 'function') {
          syncShapeControllerUI();
        }
        try {
          history.pushState({ drawerSubview: 'shape' }, '');
        } catch (_) {}
      } else if (subviewName === 'vector') {
        window.activeKeyframeProperty = 'vectorPoints';
        if (typeof syncVectorControllerUI === 'function') {
          syncVectorControllerUI();
        }
        if (typeof updateVectorKeyframeBtnState === 'function') {
          updateVectorKeyframeBtnState();
        }
        try {
          history.pushState({ drawerSubview: 'vector' }, '');
        } catch (_) {}
      } else if (subviewName === 'beatmark') {
        if (typeof syncBeatmarkDrawerUI === 'function') {
          syncBeatmarkDrawerUI();
        }
        try {
          history.pushState({ drawerSubview: 'beatmark' }, '');
        } catch (_) {}
      } else if (subviewName === 'effects-gallery') {
        if (typeof window.closeGalleryCategory === 'function') {
          window.closeGalleryCategory();
        }
        if (typeof window.syncGalleryHomeSections === 'function') {
          window.syncGalleryHomeSections();
        }
        if (typeof window.autoFetchAndLoadEffects === 'function') {
          window.autoFetchAndLoadEffects();
        }
        try {
          history.pushState({ drawerSubview: 'effects-gallery' }, '');
        } catch (_) {}
      }

      if (window.CanvasOverlay && typeof window.CanvasOverlay.scheduleRedraw === 'function') {
        window.CanvasOverlay.scheduleRedraw();
      }

      // Synchronously update keyframe markers on the timeline
      if (typeof updateTimelineKeyframeMarkersHighlight === 'function') {
        updateTimelineKeyframeMarkersHighlight();
      }
      if (typeof redrawComposition === 'function') {
        redrawComposition('switchLayerDrawerSubview');
      }
      if (typeof centerSelectedTimelineLayer === 'function') {
        centerSelectedTimelineLayer(true);
        setTimeout(() => centerSelectedTimelineLayer(false), 240);
      }
    }
    window.switchLayerDrawerSubview = switchLayerDrawerSubview;

    function syncInspectorState() {
      if (typeof window._desktopSyncInspectorState === 'function') {
        return window._desktopSyncInspectorState();
      }
      const hasActiveLayer = !!(
        (window.selectedLayerId && window.selectedLayerId !== '') ||
        (window.selectedLayerIds && window.selectedLayerIds.size > 0)
      );
      if (typeof window.updateClipboardButtonsVisibility === 'function') {
        window.updateClipboardButtonsVisibility();
      }
      if (typeof window.updateCutBarRowState === 'function') {
        window.updateCutBarRowState();
      }
      if (hasActiveLayer) {
        const currentLayer = window.selectedLayerId
          ? ((window.currentProjectState && window.currentProjectState.layers) || []).find(l => l.id === window.selectedLayerId)
          : null;
        if (typeof window.updateVolumeAndSpeedBtnState === 'function') {
          window.updateVolumeAndSpeedBtnState(currentLayer);
        }
      }
    }
    if (typeof window.syncInspectorState !== 'function') {
      window.syncInspectorState = syncInspectorState;
    }

    function syncDesktopInspectorProperty(layer, prop) {
      if (typeof syncTransformControllerValues === 'function') {
        syncTransformControllerValues();
      } else if (typeof window.syncTransformControllerValues === 'function') {
        window.syncTransformControllerValues();
      }
      if (typeof window.syncInspectorState === 'function') {
        window.syncInspectorState();
      }
    }
    window.syncDesktopInspectorProperty = syncDesktopInspectorProperty;

    function focusLayerTransformProperty(prop) {
      const hasSelected = !!(window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size > 0));
      if (!hasSelected) return;

      const drawerEl = document.getElementById('timeline-layer-drawer');
      if (window.Drawer && typeof window.Drawer.open === 'function') {
        const isDrawerOpen = window.Drawer.isOpen('timeline-layer-drawer') || (drawerEl && drawerEl.classList.contains('is-active'));
        if (!isDrawerOpen) window.Drawer.open('timeline-layer-drawer');
      }
      if (typeof window.syncInspectorState === 'function') {
        window.syncInspectorState();
      }

      if (prop === 'opacity') {
        if (typeof window.switchLayerDrawerSubview === 'function') {
          window.switchLayerDrawerSubview('blend');
        }
        const opBadge = document.getElementById('blend-opacity-badge');
        if (opBadge) {
          opBadge.classList.add('is-focused-prop');
          setTimeout(() => opBadge.classList.remove('is-focused-prop'), 600);
        }
        return;
      }

      if (typeof window.switchLayerDrawerSubview === 'function') {
        window.switchLayerDrawerSubview('transform');
      }

      // Reveal: solo prop di dropdown (S->Scale saja, dst) + scroll ke barisnya.
      // Twistie / U / collapse membersihkan solo (lihat toggleLayerKeyframeExpansion).
      try {
        const propRowMap = { scale: 'scale', rotation: 'rotate', position: 'move', opacity: 'opacity', anchor: 'origin' };
        const target = propRowMap[prop];
        const ids = (window.selectedLayerIds && window.selectedLayerIds.size > 0)
          ? Array.from(window.selectedLayerIds)
          : (window.selectedLayerId ? [window.selectedLayerId] : []);
        if (target && ids.length > 0 && typeof toggleLayerKeyframeExpansion === 'function') {
          const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
          const layer = layers.find(l => String(l.id) === String(ids[0]));
          if (layer) layer._kfSoloProp = target;
          toggleLayerKeyframeExpansion(ids[0], true, false);
          const row = document.querySelector(`.desktop-kf-prop-row[data-prop="${target}"]`);
          if (row) {
            row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            row.classList.add('is-shortcut-flash');
            setTimeout(() => row.classList.remove('is-shortcut-flash'), 900);
          }
        }
      } catch (_) {}

      if (prop === 'scale') {
        const btn = document.querySelector('.transform-tool-btn[data-tool="scale"]');
        if (btn) btn.click();
      } else if (prop === 'rotation') {
        const btn = document.querySelector('.transform-tool-btn[data-tool="rotate"]');
        if (btn) btn.click();
      } else if (prop === 'position') {
        const btn = document.querySelector('.transform-tool-btn[data-tool="move"]');
        if (btn) {
          if (!btn.classList.contains('is-active')) {
            btn.click();
          }
          if (window.moveAnchorSubmode === 'anchor') {
            btn.click();
          }
        }
      } else if (prop === 'anchor') {
        const btn = document.querySelector('.transform-tool-btn[data-tool="move"]');
        if (btn) {
          if (!btn.classList.contains('is-active')) {
            btn.click();
          }
          if (window.moveAnchorSubmode !== 'anchor') {
            btn.click();
          }
        }
      }
    }
    window.focusLayerTransformProperty = focusLayerTransformProperty;

    window.addEventListener('drawer-opened', () => {
      if (typeof syncRotateDialTrack === 'function') syncRotateDialTrack();
      if (typeof redrawComposition === 'function') redrawComposition('drawer-opened');
    });
    window.addEventListener('drawer-closed', () => {
      if (typeof redrawComposition === 'function') redrawComposition('drawer-closed');
    });

    function updateRotateTrail(deg) {
      const trailEl = document.getElementById('rotate-trail-arc');
      const trackEl = document.getElementById('track-path-rotate');
      const dial = document.getElementById('dial-transform-rotate');
      if (!trailEl || !trackEl) return;

      // Cap trail sweep between -360 and +360 (stop at 1 full turn)
      let sweep = deg;
      if (sweep > 360) sweep = 360;
      if (sweep < -360) sweep = -360;

      let totalLen = (dial && dial._totalLen) || 578.19;
      try {
        if (typeof trackEl.getTotalLength === 'function') {
          const measured = trackEl.getTotalLength();
          if (measured > 0) totalLen = measured;
        }
      } catch (_) {}

      if (Math.abs(sweep) < 0.5) {
        trailEl.style.strokeDasharray = `0 ${totalLen}`;
        trailEl.style.strokeDashoffset = '0';
      } else if (Math.abs(sweep) >= 359.5) {
        trailEl.style.strokeDasharray = `${totalLen} 0`;
        trailEl.style.strokeDashoffset = '0';
      } else {
        const trailLen = (Math.abs(sweep) / 360) * totalLen;
        if (sweep > 0) {
          trailEl.style.strokeDasharray = `${trailLen} ${totalLen}`;
          trailEl.style.strokeDashoffset = '0';
        } else {
          trailEl.style.strokeDasharray = `0 ${totalLen - trailLen} ${trailLen} ${totalLen}`;
          trailEl.style.strokeDashoffset = '0';
        }
      }
    }

    function getDialLayoutMetrics(dial, defaultW, defaultH) {
      if (!dial) return { w: defaultW, h: defaultH };
      const cw = dial.clientWidth;
      const ch = dial.clientHeight;
      if (cw > 0 && ch > 0) {
        return { w: cw, h: ch };
      }
      const rect = dial.getBoundingClientRect();
      const z = (typeof window.oftUiScaleFactor === 'function' ? window.oftUiScaleFactor() : 1) || 1;
      const w = Math.round((rect.width || (defaultW * z)) / z) || defaultW;
      const h = Math.round((rect.height || (defaultH * z)) / z) || defaultH;
      return { w, h };
    }

    function syncRotateDialTrack() {
      const dial = document.getElementById('dial-transform-rotate');
      if (!dial) return null;
      const trackEl = document.getElementById('track-path-rotate');
      const trailEl = document.getElementById('rotate-trail-arc');
      const svg = dial.querySelector('.rotate-dial-svg');
      if (!trackEl || !trailEl || !svg) return null;

      const { w: boxW, h: boxH } = getDialLayoutMetrics(dial, 320, 156);

      const padX = 18;
      const padY = 16;
      const left = padX;
      const right = Math.max(left + 20, boxW - padX);
      const top = padY;
      const bottom = Math.max(top + 20, boxH - padY);
      const trackW = right - left;
      const trackH = bottom - top;
      const cx = boxW / 2;
      const R = Math.min(36, Math.floor(trackW / 2), Math.floor(trackH / 2));

      const d = `M ${cx} ${top} H ${right - R} A ${R} ${R} 0 0 1 ${right} ${top + R} V ${bottom - R} A ${R} ${R} 0 0 1 ${right - R} ${bottom} H ${left + R} A ${R} ${R} 0 0 1 ${left} ${bottom - R} V ${top + R} A ${R} ${R} 0 0 1 ${left + R} ${top} Z`;

      svg.setAttribute('viewBox', `0 0 ${boxW} ${boxH}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      trackEl.setAttribute('d', d);
      trailEl.setAttribute('d', d);

      dial._lastW = boxW;
      dial._lastH = boxH;
      dial._totalLen = (typeof trackEl.getTotalLength === 'function' && trackEl.getTotalLength()) || (2 * (trackW + trackH) - 8 * R + 2 * Math.PI * R);
      return { boxW, boxH, totalLen: dial._totalLen, cx, top };
    }

    function updateRotateKnob(deg) {
      updateDesktopRotateDials();
      const dial = document.getElementById('dial-transform-rotate');
      const knob = document.getElementById('knob-transform-rotate');
      const valRot = document.getElementById('val-rotate-deg');
      const valTurns = document.getElementById('val-rotate-turns');
      if (!dial || !knob) return;

      const trackEl = document.getElementById('track-path-rotate');
      const trailEl = document.getElementById('rotate-trail-arc');
      if (!trackEl || !trailEl) return;

      const { w: boxW, h: boxH } = getDialLayoutMetrics(dial, 320, 156);

      // Elongated stadium squircle track geometry: dynamically sync viewBox and path to dial container
      if (dial._lastW !== boxW || dial._lastH !== boxH || !dial._totalLen) {
        syncRotateDialTrack();
      }

      const totalLen = dial._totalLen || ((typeof trackEl.getTotalLength === 'function' && trackEl.getTotalLength()) || 578.19);
      const normDeg = ((deg % 360) + 360) % 360;
      const dist = (normDeg / 360) * totalLen;
      const pt = (typeof trackEl.getPointAtLength === 'function')
        ? trackEl.getPointAtLength(dist)
        : { x: boxW / 2, y: 16 };

      const knobHalf = (knob.offsetWidth || 28) / 2;
      knob.style.left = `${pt.x - knobHalf}px`;
      knob.style.top = `${pt.y - knobHalf}px`;
      knob.style.right = 'auto';
      knob.style.bottom = 'auto';
      knob.style.transform = 'none';

      // Auto-observe size changes (e.g. splitter drag or orientation change) so elongated track & knob stay aligned
      if (window.ResizeObserver && !dial._hasResizeObserver) {
        dial._hasResizeObserver = true;
        const ro = new ResizeObserver(() => {
          if (dial.clientWidth > 0 && !window.isTransformInteracting) {
            syncRotateDialTrack();
            const curInfo = getSelectedLayerAndBaseDims();
            const l = curInfo ? curInfo.layer : null;
            let r = 0;
            if (l) {
              if (currentRotateAxis === 'x') r = l.rotX || 0;
              else if (currentRotateAxis === 'y') r = l.rotY || 0;
              else r = l.rotZ !== undefined ? l.rotZ : (l.rotation || 0);
            }
            updateRotateKnob(r);
          }
        });
        ro.observe(dial);
      }

      const turns = Math.trunc(deg / 360);
      const remRaw = deg % 360;
      const rem = (Math.abs(remRaw - Math.round(remRaw)) < 0.001) ? Math.round(remRaw) : Number(remRaw.toFixed(1));

      if (valTurns && !valTurns.dataset.isEditing) {
        if (turns !== 0) {
          valTurns.textContent = turns > 0 ? `+${turns}` : `${turns}`;
          valTurns.style.display = 'block';
        } else {
          valTurns.textContent = '';
          valTurns.style.display = 'none';
        }
      }

      if (valRot && !valRot.dataset.isEditing) {
        if (rem === 0) {
          valRot.textContent = '0°';
        } else {
          valRot.textContent = `${rem > 0 ? '+' : ''}${rem}°`;
        }
      }

      updateRotateTrail(deg);
    }

    // Desktop: 3 dial rotate X/Y/Z (tanpa switch). No-op bila elemen tak ada.
    function rotAxisVal(l, axis) {
      if (!l) return 0;
      if (axis === 'x') return l.rotX || 0;
      if (axis === 'y') return l.rotY || 0;
      return l.rotZ !== undefined ? l.rotZ : (l.rotation || 0);
    }

    function updateDesktopRotateDials() {
      if (!document.getElementById('dial-transform-rotate-z')
        && !document.getElementById('jog-rotate-z')
        && !document.getElementById('jog-rotate-x')
        && !document.getElementById('jog-rotate-y')) return;
      const info = (typeof getSelectedLayerAndBaseDims === 'function') ? getSelectedLayerAndBaseDims() : null;
      const l = info ? info.layer : null;
      const is3D = !!(l && l.is3D && l.type !== 'adjustment');
      updateRotateSliders(l, is3D);
      ['x', 'y', 'z'].forEach((axis) => {
        const dial = document.getElementById(`dial-transform-rotate-${axis}`);
        if (!dial) return;
        const knob = document.getElementById(`knob-transform-rotate-${axis}`);
        const valRot = document.getElementById(`val-rotate-deg-${axis}`);
        const valTurns = document.getElementById(`val-rotate-turns-${axis}`);
        const trailEl = document.getElementById(`rotate-trail-arc-${axis}`);
        const deg = rotAxisVal(l, axis);
        dial.classList.toggle('is-disabled', !is3D && axis !== 'z');
        dial.setAttribute('aria-valuenow', String(Math.round(deg)));

        const isSquircle = dial.classList.contains('is-watch-squircle');
        const trackPath = isSquircle ? dial.querySelector('.rotate-track-bg') : null;

        if (isSquircle && trackPath) {
          const totalLen = (typeof trackPath.getTotalLength === 'function' && trackPath.getTotalLength()) || 578.19;
          const normDeg = ((deg % 360) + 360) % 360;
          const dist = (normDeg / 360) * totalLen;
          const pt = (typeof trackPath.getPointAtLength === 'function') ? trackPath.getPointAtLength(dist) : { x: 100, y: 20 };
          const { w, h } = getDialLayoutMetrics(dial, 200, 200);
          const size = Math.min(w, h);
          const scale = size / 200;
          const offsetX = (w - size) / 2;
          const offsetY = (h - size) / 2;
          if (knob) {
            const knobHalf = (knob.offsetWidth || 20) / 2;
            const kx = offsetX + pt.x * scale - knobHalf;
            const ky = offsetY + pt.y * scale - knobHalf;
            knob.style.left = `${kx}px`;
            knob.style.top = `${ky}px`;
            knob.style.right = 'auto';
            knob.style.bottom = 'auto';
            knob.style.transform = 'none';
          }
          if (trailEl) {
            let sweep = deg;
            if (sweep > 360) sweep = 360;
            if (sweep < -360) sweep = -360;
            const trailLen = (Math.abs(sweep) / 360) * totalLen;

            if (Math.abs(sweep) < 0.5) {
              trailEl.style.strokeDasharray = `0 ${totalLen}`;
              trailEl.style.strokeDashoffset = '0';
            } else if (Math.abs(sweep) >= 359.5) {
              trailEl.style.strokeDasharray = `${totalLen} 0`;
              trailEl.style.strokeDashoffset = '0';
            } else if (sweep > 0) {
              trailEl.style.strokeDasharray = `${trailLen} ${totalLen}`;
              trailEl.style.strokeDashoffset = '0';
            } else {
              trailEl.style.strokeDasharray = `0 ${totalLen - trailLen} ${trailLen} ${totalLen}`;
              trailEl.style.strokeDashoffset = '0';
            }
          }
        } else {
          if (knob) {
            const { w } = getDialLayoutMetrics(dial, 200, 200);
            const rad = ((deg - 90) * Math.PI) / 180;
            const center = w / 2;
            const radius = center * 0.86;
            const knobHalf = (knob.offsetWidth || 28) / 2;
            knob.style.left = `${center + radius * Math.cos(rad) - knobHalf}px`;
            knob.style.top = `${center + radius * Math.sin(rad) - knobHalf}px`;
            knob.style.right = 'auto';
            knob.style.bottom = 'auto';
            knob.style.transform = 'none';
          }
          if (trailEl) {
            let sweep = deg;
            if (sweep > 360) sweep = 360;
            if (sweep < -360) sweep = -360;
            if (Math.abs(sweep) < 0.5) {
              trailEl.setAttribute('d', '');
            } else if (Math.abs(sweep) >= 359.5) {
              trailEl.setAttribute('d', 'M 100 14 A 86 86 0 1 1 100 186 A 86 86 0 1 1 100 14');
            } else {
              const r2 = ((sweep - 90) * Math.PI) / 180;
              const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
              const sweepFlag = sweep > 0 ? 1 : 0;
              trailEl.setAttribute('d', `M 100 14 A 86 86 0 ${largeArc} ${sweepFlag} ${100 + 86 * Math.cos(r2)} ${100 + 86 * Math.sin(r2)}`);
            }
          }
        }

        const turns = Math.trunc(deg / 360);
        const remRaw = deg % 360;
        const rem = (Math.abs(remRaw - Math.round(remRaw)) < 0.001) ? Math.round(remRaw) : Number(remRaw.toFixed(1));
        if (valTurns && !valTurns.dataset.isEditing) {
          if (turns !== 0) {
            valTurns.textContent = turns > 0 ? `+${turns}` : `${turns}`;
            valTurns.style.display = 'block';
          } else {
            valTurns.textContent = '';
            valTurns.style.display = 'none';
          }
        }
        if (valRot && !valRot.dataset.isEditing) valRot.textContent = rem === 0 ? '0°' : `${rem > 0 ? '+' : ''}${rem}°`;

        if (window.ResizeObserver && !dial._hasResizeObserver) {
          dial._hasResizeObserver = true;
          const ro = new ResizeObserver(() => {
            if (dial.clientWidth > 0 && !window.isTransformInteracting) {
              updateDesktopRotateDials();
            }
          });
          ro.observe(dial);
        }
      });
    }

    function initDesktopRotateDials() {
      ['x', 'y', 'z'].forEach((axis) => {
        const dial = document.getElementById(`dial-transform-rotate-${axis}`);
        if (!dial || dial._tripleInit) return;
        dial._tripleInit = true;
        let isRotating = false;
        let lastAngle = 0;
        let currentRot = 0;
        let targetL = null;
        let dialCenter = { x: 0, y: 0 };
        dial.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          if (dial.classList.contains('is-disabled')) return;
          const info = getSelectedLayerAndBaseDims();
          if (!info) return;
          targetL = info.layer;
          if (targetL && targetL.expressions && (targetL.expressions.rotate || targetL.expressions.rotation || targetL.expressions.rotZ)) return;
          window.isTransformInteracting = true;
          syncLayerWithEffectiveProps(targetL);
          invalidatePreviewCacheForLayer(targetL);
          const rect = dial.getBoundingClientRect();
          dialCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          isRotating = true;
          lastAngle = Math.atan2(e.clientY - dialCenter.y, e.clientX - dialCenter.x) * (180 / Math.PI);
          currentRot = rotAxisVal(targetL, axis);
          try { dial.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
        });
        dial.addEventListener('pointermove', (e) => {
          if (!isRotating || !targetL) return;
          const curAngle = Math.atan2(e.clientY - dialCenter.y, e.clientX - dialCenter.x) * (180 / Math.PI);
          let delta = curAngle - lastAngle;
          while (delta > 180) delta -= 360;
          while (delta < -180) delta += 360;
          currentRot += delta;
          lastAngle = curAngle;
          let val = Math.round(currentRot);
          const gridBtn = document.getElementById('editor-icon-grid');
          const isGridOn = gridBtn && gridBtn.classList.contains('is-active');
          if (isGridOn) {
            const snapAngles = [];
            for (let a = -720; a <= 720; a += 45) snapAngles.push(a);
            const sAngle = (window.findSnapTarget || findSnapTarget)(currentRot, snapAngles, 5);
            if (sAngle !== null) val = sAngle;
          }
          if (axis === 'x') targetL.rotX = val;
          else if (axis === 'y') targetL.rotY = val;
          else { targetL.rotZ = val; targetL.rotation = val; }
          if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
          recordLayerPropertyChange(targetL, 'rotate');
          updateDesktopRotateDials();
          redrawComposition();
        });
        const onTripleEnd = (e) => {
          if (!isRotating) return;
          try { dial.releasePointerCapture(e.pointerId); } catch (_) {}
          isRotating = false;
          window.isTransformInteracting = false;
          const finishedLayer = targetL;
          targetL = null;
          if (finishedLayer) invalidatePreviewCacheForLayer(finishedLayer);
          redrawComposition();
          renderTimelineLayers();
          saveCurrentProjectLayers();
        };
        dial.addEventListener('pointerup', onTripleEnd);
        dial.addEventListener('pointercancel', onTripleEnd);
      });
    }

    // Ruler jog X/Y tak terbatas (scrub seperti ruler parameter efek).
    // 0.5 derajat per px; ticks bergerak via bindJogWheel, needle tetap.
    const ROT_JOG_DEG_PER_PX = 0.5;

    function rotDegText(deg) {
      const turns = Math.trunc(deg / 360);
      const remRaw = deg % 360;
      const rem = (Math.abs(remRaw - Math.round(remRaw)) < 0.001) ? Math.round(remRaw) : Number(remRaw.toFixed(1));
      return {
        turns: turns !== 0 ? (turns > 0 ? `+${turns}` : `${turns}`) : '',
        deg: rem === 0 ? '0°' : `${rem > 0 ? '+' : ''}${rem}°`
      };
    }

    function updateRotateSliders(l, is3D) {
      [['x', 'jog-rotate-x'], ['y', 'jog-rotate-y']].forEach(([axis, id]) => {
        const jog = document.getElementById(id);
        if (!jog) return;
        const deg = rotAxisVal(l, axis);
        if (axis !== 'z') {
          jog.classList.toggle('is-disabled', !is3D);
        }
        jog.setAttribute('aria-valuenow', String(Math.round(deg)));
        const t = rotDegText(deg);
        const valRot = document.getElementById(`val-rotate-deg-${axis}`);
        const valTurns = document.getElementById(`val-rotate-turns-${axis}`);
        if (valTurns && !valTurns.dataset.isEditing) {
          valTurns.textContent = t.turns;
          valTurns.style.display = t.turns ? 'block' : 'none';
        }
        if (valRot && !valRot.dataset.isEditing) valRot.textContent = t.deg;
      });
    }

    function initRotateSliders() {
      [['x', true], ['y', false]].forEach(([axis, vertical]) => {
        const jog = document.getElementById(`jog-rotate-${axis}`);
        if (!jog || jog._jogInit) return;
        jog._jogInit = true;
        let targetL = null;
        let startVal = 0;
        const applyVal = (val) => {
          if (!targetL) return;
          const v = Math.round(val);
          if (axis === 'x') targetL.rotX = v;
          else if (axis === 'y') targetL.rotY = v;
          else { targetL.rotZ = v; targetL.rotation = v; }
          if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
          recordLayerPropertyChange(targetL, 'rotate');
          updateDesktopRotateDials();
          redrawComposition();
        };
        bindJogWheel(jog, {
          onStart: () => {
            if (jog.classList.contains('is-disabled')) return false;
            const info = getSelectedLayerAndBaseDims();
            if (!info) return false;
            targetL = info.layer;
            if (targetL && targetL.expressions && (targetL.expressions.rotate || targetL.expressions.rotation || targetL.expressions.rotZ)) {
              targetL = null;
              return false;
            }
            syncLayerWithEffectiveProps(targetL);
            invalidatePreviewCacheForLayer(targetL);
            startVal = rotAxisVal(targetL, axis);
          },
          onMove: (rawTotalDelta) => {
            if (!targetL) return;
            applyVal(startVal + rawTotalDelta * ROT_JOG_DEG_PER_PX);
          },
          onEnd: () => {
            const finishedLayer = targetL;
            targetL = null;
            if (finishedLayer) invalidatePreviewCacheForLayer(finishedLayer);
            redrawComposition();
            renderTimelineLayers();
          }
        }, vertical);
        jog.addEventListener('keydown', (e) => {
          if (jog.classList.contains('is-disabled')) return;
          const step = e.shiftKey ? 10 : 1;
          let d = 0;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') d = step;
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') d = -step;
          else if (e.key === 'Home') d = 'home';
          else return;
          e.preventDefault();
          const info = getSelectedLayerAndBaseDims();
          if (!info) return;
          targetL = info.layer;
          const cur = rotAxisVal(targetL, axis);
          const nv = d === 'home' ? 0 : cur + d;
          window.isTransformInteracting = true;
          syncLayerWithEffectiveProps(targetL);
          applyVal(nv);
          targetL = null;
          window.isTransformInteracting = false;
          renderTimelineLayers();
          saveCurrentProjectLayers();
        });
      });
    }

    function getSelectedLayerAndBaseDims() {
      const layers = (window.currentProjectState && window.currentProjectState.layers) || currentProjectState.layers || [];
      const targetId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size > 0 ? Array.from(window.selectedLayerIds)[0] : null);
      const layer = (typeof findLayerById === 'function') ? findLayerById(targetId, layers) : layers.find(l => l.id === targetId);
      if (!layer) return null;
      const proj = window.currentProjectState || currentProjectState || {};
      const aspect = proj.aspectRatio || '16:9';
      const res = proj.resolution || '1080p';
      const baseDims = window.getProjectDimensions(res, aspect);
      const parentPrecomp = layer._parentPrecomp || (typeof findLayerParentPrecomp === 'function' ? findLayerParentPrecomp(layer.id) : null);
      if (parentPrecomp) {
        const pW = Math.round(Math.abs(parentPrecomp.mediaWidth || parentPrecomp.scaleW || baseDims[0]));
        const pH = Math.round(Math.abs(parentPrecomp.mediaHeight || parentPrecomp.scaleH || baseDims[1]));
        return { layer, baseW: pW, baseH: pH };
      }
      return { layer, baseW: baseDims[0], baseH: baseDims[1] };
    }

    function syncTransformControllerValues() {
      const info = getSelectedLayerAndBaseDims();
      if (!info) return;
      const { layer, baseW, baseH } = info;
      const isAdjustment = (layer && layer.type === 'adjustment');
      if (isAdjustment) {
        currentRotateAxis = 'z';
        layer.posZ = 0;
        layer.rotX = 0;
        layer.rotY = 0;
        layer.anchorZ = 0;
      }
      const is3D = !!(layer && layer.is3D);
      const pps = window.currentPixelsPerSecond || 80;
      const isParented = !!(layer && layer.parentId);
      const curSec = (typeof window.currentSec === 'number') ? window.currentSec : (Math.max(0, -(window.timelinePanX || 0)) / pps);
      const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, curSec, null, null, isParented) : layer;

      // 1. Determine layer natural resolution
      let naturalW = baseW;
      let naturalH = baseH;
      if (layer.mediaWidth && layer.mediaHeight) {
        naturalW = layer.mediaWidth;
        naturalH = layer.mediaHeight;
      } else if (typeof getOrLoadLayerMedia === 'function') {
        const media = getOrLoadLayerMedia(layer);
        if (media && media.el) {
          const mw = media.el.videoWidth || media.el.naturalWidth || media.el.width;
          const mh = media.el.videoHeight || media.el.naturalHeight || media.el.height;
          if (mw && mh) {
            naturalW = mw;
            naturalH = mh;
          }
        }
      }
      if (layer.widthPx && layer.heightPx) {
        naturalW = layer.widthPx;
        naturalH = layer.heightPx;
      }

      // 2. Position values
      const curPosX = eff.posX !== undefined ? eff.posX : (layer.posX !== undefined ? layer.posX : ((layer.normX !== undefined ? (layer.normX + layer.normW / 2) : 0.5) * baseW));
      const curPosY = eff.posY !== undefined ? eff.posY : (layer.posY !== undefined ? layer.posY : ((layer.normY !== undefined ? (layer.normY + layer.normH / 2) : 0.5) * baseH));
      const curPosZ = eff.posZ !== undefined ? eff.posZ : (layer.posZ !== undefined ? layer.posZ : 0);
      const curAnchorX = eff.anchorX !== undefined ? eff.anchorX : (layer.anchorX || 0);
      const curAnchorY = eff.anchorY !== undefined ? eff.anchorY : (layer.anchorY || 0);
      const curAnchorZ = eff.anchorZ !== undefined ? eff.anchorZ : (layer.anchorZ || 0);

      const valPosX = document.getElementById('val-pos-x');
      const valPosY = document.getElementById('val-pos-y');
      const valPosZ = document.getElementById('val-pos-z');
      const lblPosX = document.getElementById('lbl-pos-x');
      const lblPosY = document.getElementById('lbl-pos-y');
      const lblPosZ = document.getElementById('lbl-pos-z');
      const lblZRuler = document.getElementById('lbl-z-ruler');

    function formatTransformNumber(val) {
      if (val === null || val === undefined || isNaN(val)) return '0';
      const n = Number(val);
      if (Math.abs(n - Math.round(n)) < 0.01) {
        return Math.round(n).toString();
      }
      return n.toFixed(1);
    }
    window.formatTransformNumber = formatTransformNumber;

      const isAnchorSubmode = (window.moveAnchorSubmode === 'anchor');
      if (isAnchorSubmode) {
        if (valPosX && !valPosX.dataset.isEditing) valPosX.textContent = formatTransformNumber(curAnchorX);
        if (valPosY && !valPosY.dataset.isEditing) valPosY.textContent = formatTransformNumber(curAnchorY);
        if (valPosZ && !valPosZ.dataset.isEditing) {
          valPosZ.textContent = formatTransformNumber(curAnchorZ);
          valPosZ.classList.toggle('is-neutral', Math.abs(curAnchorZ) < 0.01);
        }
        if (lblPosX) lblPosX.textContent = 'Anc X';
        if (lblPosY) lblPosY.textContent = 'Anc Y';
        if (lblPosZ) lblPosZ.textContent = 'Anc Z';
        if (lblZRuler) lblZRuler.textContent = 'Anc Z';
      } else {
        if (valPosX && !valPosX.dataset.isEditing) valPosX.textContent = formatTransformNumber(curPosX);
        if (valPosY && !valPosY.dataset.isEditing) valPosY.textContent = formatTransformNumber(curPosY);
        if (valPosZ && !valPosZ.dataset.isEditing) {
          valPosZ.textContent = formatTransformNumber(curPosZ);
          valPosZ.classList.toggle('is-neutral', Math.abs(curPosZ) < 0.01);
        }
        if (lblPosX) lblPosX.textContent = 'X';
        if (lblPosY) lblPosY.textContent = 'Y';
        if (lblPosZ) lblPosZ.textContent = 'Z';
        if (lblZRuler) lblZRuler.textContent = 'Z';
      }

      // 3. Scale values
      const curScaleW = eff.scaleW !== undefined ? eff.scaleW : (layer.scaleW !== undefined ? layer.scaleW : (layer.normW !== undefined ? layer.normW * baseW : naturalW));
      const curScaleH = eff.scaleH !== undefined ? eff.scaleH : (layer.scaleH !== undefined ? layer.scaleH : (layer.normH !== undefined ? layer.normH * baseH : naturalH));

      const valScaleW = document.getElementById('val-scale-w');
      const valScaleH = document.getElementById('val-scale-h');
      if (valScaleW && !valScaleW.dataset.isEditing) valScaleW.textContent = formatTransformNumber(curScaleW);
      if (valScaleH && !valScaleH.dataset.isEditing) valScaleH.textContent = formatTransformNumber(curScaleH);

      const has3DFx = Array.isArray(layer.effects) && layer.effects.some(f => {
        if (!f || f.disabled) return false;
        const t = (f.type || f.id || '').toLowerCase();
        if (t === 'box_3d' || t === 'box-3d' || t === 'cube_3d' || t === 'cube-3d' || t === 'extrude_3d' || t === 'extrude-3d' || t === 'pyramid_3d' || t === 'pyramid-3d' || t === 'sphere_3d' || t === 'sphere-3d' || t.includes('3d') || t.includes('cube') || t.includes('box')) return true;
        const name = (f.name || '').toLowerCase();
        if (name.includes('3d') || name.includes('cube') || name.includes('box')) return true;
        if (window.FishEffects && window.FishEffects.registry) {
          const def = window.FishEffects.registry.get(f.type || f.id);
          if (def && (def.category === '3d' || def.isExclusive3D)) return true;
        }
        return false;
      });
      const is3DScale = has3DFx;
      const defaultZ = Math.round(Math.min(Math.abs(curScaleW), Math.abs(curScaleH)));
      if (is3DScale && layer.scaleZ === undefined) {
        layer.scaleZ = defaultZ;
      }
      const curScaleZ = eff.scaleZ !== undefined ? eff.scaleZ : (layer.scaleZ !== undefined ? layer.scaleZ : defaultZ);

      const valScaleZ = document.getElementById('val-scale-z');
      const cardScaleZ = document.getElementById('card-scale-z');
      const jogScaleZ = document.getElementById('jog-scale-z');
      const dualJog = document.getElementById('jog-scale-unlinked');

      if (cardScaleZ) {
        cardScaleZ.style.display = is3DScale ? 'flex' : 'none';
        cardScaleZ.classList.toggle('is-3d-hidden', !is3DScale);
      }
      if (jogScaleZ) {
        jogScaleZ.style.display = is3DScale ? 'block' : 'none';
        jogScaleZ.classList.toggle('is-3d-hidden', !is3DScale);
      }
      if (dualJog) {
        dualJog.classList.toggle('has-3d', is3DScale);
      }
      if (valScaleZ && !valScaleZ.dataset.isEditing) valScaleZ.textContent = formatTransformNumber(curScaleZ);

      const lblScaleW = document.getElementById('lbl-scale-w');
      const lblScaleH = document.getElementById('lbl-scale-h');
      const lblScaleZ = document.getElementById('lbl-scale-z');
      if (lblScaleW) lblScaleW.textContent = is3DScale ? 'X' : 'Width';
      if (lblScaleH) lblScaleH.textContent = is3DScale ? 'Y' : 'Height';
      if (lblScaleZ) lblScaleZ.textContent = 'Z';

      // 4. Rotation value for active axis (X, Y, Z)
      if (!is3D && currentRotateAxis !== 'z') {
        currentRotateAxis = 'z';
        window.currentRotateAxis = 'z';
      }

      let curRot = 0;
      if (currentRotateAxis === 'x') {
        curRot = eff.rotX !== undefined ? eff.rotX : (layer.rotX || 0);
      } else if (currentRotateAxis === 'y') {
        curRot = eff.rotY !== undefined ? eff.rotY : (layer.rotY || 0);
      } else {
        curRot = eff.rotZ !== undefined ? eff.rotZ : (layer.rotZ !== undefined ? layer.rotZ : (layer.rotation !== undefined ? layer.rotation : 0));
      }
      updateRotateKnob(curRot);

      // Sync axis switch UI button states
      const rotateAxisSwitch = document.getElementById('rotate-axis-switch');
      if (rotateAxisSwitch) {
        rotateAxisSwitch.classList.toggle('is-3d-hidden', !is3D);
        if (!is3D) {
          rotateAxisSwitch.style.setProperty('display', 'none', 'important');
        } else {
          rotateAxisSwitch.style.removeProperty('display');
          if (!window.isDesktop && !document.body.classList.contains('is-desktop')) {
            rotateAxisSwitch.style.display = 'flex';
          }
        }
      }
      const axisBtns = document.querySelectorAll('#rotate-axis-switch .segmented-switch-item');
      axisBtns.forEach(b => {
        const ax = b.dataset.axis;
        const isDis = !is3D || (isAdjustment && (ax === 'x' || ax === 'y'));
        b.disabled = isDis;
        b.classList.toggle('is-disabled', isDis);
        const isActive = (ax === currentRotateAxis);
        b.classList.toggle('is-active', isActive);
        b.classList.toggle('is-selected', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      // Disable/hide Z position UI if not 3D layer (or adjustment layer)
      const zRulerWrap = document.querySelector('.transform-z-ruler-wrap');
      const valCardZ = valPosZ ? valPosZ.closest('.transform-val-card') : null;
      if (zRulerWrap) {
        zRulerWrap.classList.toggle('is-3d-hidden', !is3D);
        if (!is3D) {
          zRulerWrap.style.setProperty('display', 'none', 'important');
        } else {
          zRulerWrap.style.removeProperty('display');
        }
        zRulerWrap.classList.toggle('is-disabled', isAdjustment);
      }
      if (valCardZ) {
        valCardZ.classList.toggle('is-3d-hidden', !is3D);
        if (!is3D) {
          valCardZ.style.setProperty('display', 'none', 'important');
        } else {
          valCardZ.style.removeProperty('display');
        }
        valCardZ.classList.toggle('is-disabled', isAdjustment);
      }

      // 5. Skew values
      const curSkewX = eff.skewX !== undefined ? eff.skewX : (layer.skewX || 0);
      const curSkewY = eff.skewY !== undefined ? eff.skewY : (layer.skewY || 0);
      const valSkewX = document.getElementById('val-skew-x');
      const valSkewY = document.getElementById('val-skew-y');
      if (valSkewX && !valSkewX.dataset.isEditing) valSkewX.textContent = `${formatTransformNumber(curSkewX)}°`;
      if (valSkewY && !valSkewY.dataset.isEditing) valSkewY.textContent = `${formatTransformNumber(curSkewY)}°`;

      // 6. Expression disabled state on transform panes & nav button
      const exprs = (layer && layer.expressions && typeof layer.expressions === 'object') ? layer.expressions : {};
      const paneMove = document.getElementById('pane-transform-move');
      const paneRotate = document.getElementById('pane-transform-rotate');
      const paneScale = document.getElementById('pane-transform-scale');
      const paneSkew = document.getElementById('pane-transform-skew');

      const isMoveExpr = !!((exprs.move || exprs.position || exprs.pos || exprs['adbe position']) && (exprs.move || exprs.position || exprs.pos || exprs['adbe position']).trim().length > 0);
      const isRotateExpr = !!((exprs.rotate || exprs.rotation || exprs.rotZ || exprs['adbe rotate z']) && (exprs.rotate || exprs.rotation || exprs.rotZ || exprs['adbe rotate z']).trim().length > 0);
      const isScaleExpr = !!((exprs.scale || exprs['adbe scale']) && (exprs.scale || exprs['adbe scale']).trim().length > 0);
      const isSkewExpr = !!(exprs.skew && exprs.skew.trim().length > 0);

      if (paneMove) paneMove.classList.toggle('is-expression-disabled', isMoveExpr);
      if (paneRotate) paneRotate.classList.toggle('is-expression-disabled', isRotateExpr);
      if (paneScale) paneScale.classList.toggle('is-expression-disabled', isScaleExpr);
      if (paneSkew) paneSkew.classList.toggle('is-expression-disabled', isSkewExpr);

      const btnExpr = document.getElementById('btn-transform-expression');
      const activeTool = window.activeTransformTool || 'move';
      if (btnExpr) {
        let currentPropHasExpr = false;
        if (activeTool === 'move') currentPropHasExpr = isMoveExpr;
        else if (activeTool === 'rotate') currentPropHasExpr = isRotateExpr;
        else if (activeTool === 'scale') currentPropHasExpr = isScaleExpr;
        else if (activeTool === 'skew') currentPropHasExpr = isSkewExpr;
        btnExpr.classList.toggle('has-expression', currentPropHasExpr);
      }

      // If expression popover is open, live update its title & content
      const exprPopover = document.getElementById('popover-transform-expression');
      if (exprPopover && exprPopover.classList.contains('is-open')) {
        const propNames = {
          move: 'Position',
          rotate: 'Rotation',
          scale: 'Scale',
          skew: 'Skew'
        };
        const exprTitle = document.getElementById('expression-popover-title');
        const exprTextarea = document.getElementById('expression-editor-textarea');
        if (exprTitle) exprTitle.textContent = `${propNames[activeTool] || 'Transform'} Expression`;
        if (exprTextarea && document.activeElement !== exprTextarea) {
          exprTextarea.value = (exprs[activeTool] || '');
        }
      }
    }
    window.syncTransformControllerValues = syncTransformControllerValues;

    function syncTransform3DVisibility() {
      if (typeof syncTransformControllerValues === 'function') {
        syncTransformControllerValues();
      }
      if (typeof updateEditorHeaderMode === 'function') {
        updateEditorHeaderMode();
      }
      if (typeof updateTransformKeyframeBtnState === 'function') {
        updateTransformKeyframeBtnState();
      }
    }
    window.syncTransform3DVisibility = syncTransform3DVisibility;

    function bindJogWheel(el, callbacks, isVertical = false) {
      if (!el) return;
      const vertical = Boolean(isVertical || (el.classList && el.classList.contains('is-vertical')));
      let isDragging = false;
      let startCoord = 0;
      let lastCoord = 0;
      let virtualDelta = 0;
      let accumulatedTickOffset = 0;
      const ticksEl = el.querySelector('.jog-wheel-ticks');

      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target && e.target.closest('.effects-param-pill-val, .shape-param-pill-val, input, select')) return;
        if (callbacks.onStart && callbacks.onStart(e) === false) return;
        isDragging = true;
        window.isTransformInteracting = true;
        startCoord = vertical ? e.clientY : e.clientX;
        lastCoord = startCoord;
        virtualDelta = 0;
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      });

      el.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const currentCoord = vertical ? e.clientY : e.clientX;
        const step = vertical ? (lastCoord - currentCoord) : (currentCoord - lastCoord);
        lastCoord = currentCoord;
        const rawTotalDelta = vertical ? (startCoord - currentCoord) : (currentCoord - startCoord);

        let res = null;
        if (callbacks.onMove) {
          res = callbacks.onMove(rawTotalDelta, e, step, virtualDelta);
        }

        if (res && typeof res === 'object' && res.consumedStep !== undefined) {
          // Bounded jog wheel: strictly advance visual ticks only by the step actually consumed
          virtualDelta += res.consumedStep;
        } else if (res && typeof res === 'object' && res.virtualDelta !== undefined) {
          virtualDelta = res.virtualDelta;
        } else {
          // Default unconstrained scrolling
          virtualDelta = rawTotalDelta;
        }
        
        if (ticksEl && !ticksEl.classList.contains('is-bounded-tape')) {
          const finalPos = accumulatedTickOffset + virtualDelta;
          if (vertical) {
            ticksEl.style.setProperty('background-position-y', `${-finalPos}px`, 'important');
          } else {
            ticksEl.style.setProperty('background-position-x', `${finalPos}px`, 'important');
          }
        }
      });

      const onEnd = (e) => {
        if (!isDragging) return;
        accumulatedTickOffset += virtualDelta;
        if (e && e.pointerId !== undefined) {
          try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        isDragging = false;
        window.isTransformInteracting = false;
        if (callbacks.onEnd) callbacks.onEnd();
        if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
      };

      el.addEventListener('pointerup', onEnd);
      el.addEventListener('pointercancel', onEnd);
      el.addEventListener('lostpointercapture', onEnd);

      // Support two-finger trackpad scrolling
      let isWheeling = false;
      let wheelTotalDelta = 0;
      el.addEventListener('wheel', (e) => {
        if (e.target && e.target.closest('.effects-param-pill-val, .shape-param-pill-val, input, select')) return;
        e.preventDefault();
        
        if (!isWheeling) {
          if (callbacks.onStart && callbacks.onStart(e) === false) return;
          isWheeling = true;
          window.isTransformInteracting = true;
          wheelTotalDelta = 0;
          virtualDelta = 0;
        }
        
        const step = vertical ? -e.deltaY : -e.deltaX;
        wheelTotalDelta += step;
        
        let res = null;
        if (callbacks.onMove) {
          res = callbacks.onMove(wheelTotalDelta, e, step, virtualDelta);
        }

        if (res && typeof res === 'object' && res.consumedStep !== undefined) {
          virtualDelta += res.consumedStep;
        } else if (res && typeof res === 'object' && res.virtualDelta !== undefined) {
          virtualDelta = res.virtualDelta;
        } else {
          virtualDelta += step;
        }
        
        if (ticksEl && !ticksEl.classList.contains('is-bounded-tape')) {
          const finalPos = accumulatedTickOffset + virtualDelta;
          if (vertical) {
            ticksEl.style.setProperty('background-position-y', `${-finalPos}px`, 'important');
          } else {
            ticksEl.style.setProperty('background-position-x', `${finalPos}px`, 'important');
          }
        }
        
        if (el._wheelTimeout) clearTimeout(el._wheelTimeout);
        el._wheelTimeout = setTimeout(() => {
          if (!isWheeling) return;
          isWheeling = false;
          window.isTransformInteracting = false;
          accumulatedTickOffset += virtualDelta;
          if (callbacks.onEnd) callbacks.onEnd(e);
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
        }, 150);
      }, { passive: false });
    }
    window.bindJogWheel = bindJogWheel;

    (function initTransformController() {
      // 0. Edit Group / Enter Precompose Action Button
      const btnEditGroup = document.getElementById('btn-layer-edit-group');
      if (btnEditGroup) {
        btnEditGroup.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetId = window.selectedLayerId;
          if (targetId && typeof enterPrecompose === 'function') {
            enterPrecompose(targetId);
          }
        });
      }

      // A. Open Transform view from Layer Action Button
      const btnTransform = document.getElementById('btn-layer-transform');
      if (btnTransform) {
        btnTransform.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('transform');
        });
      }

      // B. Back button: Transform -> Main Layer Actions
      const btnTransformBack = document.getElementById('btn-transform-back');
      if (btnTransformBack) {
        btnTransformBack.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('main');
        });
      }

      // Keyframe button: Add / Remove Keyframe at Current Time
      const btnTransformKeyframe = document.getElementById('btn-transform-keyframe');
      if (btnTransformKeyframe) {
        btnTransformKeyframe.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleKeyframeAtCurrentTime();
        });
      }

      // C. Graph button: Transform -> Graph Editor
      const btnTransformGraph = document.getElementById('btn-transform-graph');
      if (btnTransformGraph) {
        btnTransformGraph.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          const prop = window.activeTransformTool || window.activeKeyframeProperty || 'move';
          const kfList = (layer && layer.keyframes && layer.keyframes[prop]) || [];
          if (kfList.length < 2) return;
          window.previousDrawerSubview = 'transform';
          switchLayerDrawerSubview('graph');
        });
      }

      // C2. Expression button: Transform Expression Popover
      const btnTransformExpression = document.getElementById('btn-transform-expression');
      const exprPopover = document.getElementById('popover-transform-expression');
      const exprTextarea = document.getElementById('expression-editor-textarea');
      const exprTitle = document.getElementById('expression-popover-title');
      const exprClearBtn = document.getElementById('btn-expression-clear');
      const exprErrorMsg = document.getElementById('expression-error-msg');

      const btnEffectsExpression = document.getElementById('btn-effects-expression');

      if (btnTransformExpression && exprPopover && exprTextarea) {
        btnTransformExpression.addEventListener('click', (e) => {
          e.stopPropagation();
          const info = getSelectedLayerAndBaseDims();
          if (!info || !info.layer) return;
          const layer = info.layer;
          const activeTool = window.activeTransformTool || 'move';
          window.activeExpressionProperty = activeTool;
          const propNames = {
            move: 'Position',
            rotate: 'Rotation',
            scale: 'Scale',
            skew: 'Skew'
          };
          if (exprTitle) {
            exprTitle.textContent = `${propNames[activeTool] || 'Transform'} Expression`;
          }
          const curExpr = (layer.expressions && layer.expressions[activeTool]) ? layer.expressions[activeTool] : '';
          exprTextarea.value = curExpr;
          if (exprErrorMsg) {
            exprErrorMsg.style.display = 'none';
            exprErrorMsg.textContent = '';
          }
          if (window.Popover) {
            window.Popover.toggle(btnTransformExpression, 'popover-transform-expression');
            if (window.Popover.isOpen && window.Popover.isOpen()) {
              setTimeout(() => { exprTextarea.focus(); }, 50);
            }
          }
        });

        if (btnEffectsExpression) {
          btnEffectsExpression.addEventListener('click', (e) => {
            e.stopPropagation();
            const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
            if (!layer) return;
            const curProp = window.activeKeyframeProperty;
            const effects = Array.isArray(layer.effects) ? layer.effects : [];
            if (!curProp || !curProp.includes(':')) {
              if (typeof showEffectsRackToast === 'function') {
                showEffectsRackToast('Select an effect parameter first');
              }
              return;
            }
            const parts = curProp.split(':');
            const fxId = parts[0];
            const pId = parts[1];
            const fx = effects.find(f => f.id === fxId);
            if (!fx) return;
            const def = window.FishEffectsRegistry ? window.FishEffectsRegistry.get(fx.type) : null;
            const pDef = def && Array.isArray(def.params) ? def.params.find(p => p.id === pId) : null;
            const fxName = fx.name || (def ? def.name : 'Effect');
            const pLabel = (pDef && (pDef.label || pDef.id)) || pId;

            window.activeExpressionProperty = curProp;
            if (exprTitle) {
              exprTitle.textContent = `${fxName} : ${pLabel} Expression`;
            }
            const curExpr = (layer.expressions && layer.expressions[curProp]) ? layer.expressions[curProp] : '';
            exprTextarea.value = curExpr;
            if (exprErrorMsg) {
              exprErrorMsg.style.display = 'none';
              exprErrorMsg.textContent = '';
            }
            if (window.Popover) {
              window.Popover.toggle(btnEffectsExpression, 'popover-transform-expression');
              if (window.Popover.isOpen && window.Popover.isOpen()) {
                setTimeout(() => { exprTextarea.focus(); }, 50);
              }
            }
          });
        }

        exprTextarea.addEventListener('input', () => {
          const info = getSelectedLayerAndBaseDims();
          const curLayerId = window.selectedLayerId;
          const layer = (info && info.layer) || (currentProjectState.layers || []).find(l => l.id === curLayerId);
          if (!layer) return;
          const targetProp = window.activeExpressionProperty || window.activeTransformTool || 'move';
          const isEffectProp = targetProp.includes(':');
          const val = exprTextarea.value;
          const trimmed = val.trim();

          if (!layer.expressions) layer.expressions = {};

          if (!trimmed) {
            delete layer.expressions[targetProp];
            if (exprErrorMsg) {
              exprErrorMsg.style.display = 'none';
              exprErrorMsg.textContent = '';
            }
          } else {
            // Syntax validation check
            try {
              let script = trimmed;
              if (!script.includes('return ') && !script.includes('return\n')) {
                const lines = script.split('\n');
                lines[lines.length - 1] = 'return (' + lines[lines.length - 1].replace(/;$/, '') + ');';
                script = lines.join('\n');
              }
              new Function('time', 'value', 'effect', 'wiggle', 'linear', 'clamp', 'thisLayer', 'thisComp', script);
              if (exprErrorMsg) {
                exprErrorMsg.style.display = 'none';
                exprErrorMsg.textContent = '';
              }
            } catch (err) {
              if (exprErrorMsg) {
                exprErrorMsg.style.display = 'block';
                exprErrorMsg.textContent = err.message || 'Syntax error in expression';
              }
            }
            layer.expressions[targetProp] = val;
          }

          if (isEffectProp) {
            if (typeof updateEffectsKeyframeAndGraphBtnStates === 'function') {
              updateEffectsKeyframeAndGraphBtnStates();
            }
            if (typeof syncEffectsRackUI === 'function') {
              syncEffectsRackUI(true);
            }
          } else {
            syncTransformControllerValues();
          }

          if (typeof invalidatePreviewCacheForLayer === 'function') {
            invalidatePreviewCacheForLayer(layer);
          }
          if (typeof redrawComposition === 'function') {
            redrawComposition(isEffectProp ? 'effectExpressionEdit' : 'expressionEdit');
          }
          if (typeof saveCurrentProjectLayers === 'function') {
            saveCurrentProjectLayers();
          }
        });

        if (exprClearBtn) {
          exprClearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const info = getSelectedLayerAndBaseDims();
            const curLayerId = window.selectedLayerId;
            const layer = (info && info.layer) || (currentProjectState.layers || []).find(l => l.id === curLayerId);
            if (!layer) return;
            const targetProp = window.activeExpressionProperty || window.activeTransformTool || 'move';
            const isEffectProp = targetProp.includes(':');
            if (layer.expressions) {
              delete layer.expressions[targetProp];
            }
            exprTextarea.value = '';
            if (exprErrorMsg) {
              exprErrorMsg.style.display = 'none';
              exprErrorMsg.textContent = '';
            }
            if (isEffectProp) {
              if (typeof updateEffectsKeyframeAndGraphBtnStates === 'function') {
                updateEffectsKeyframeAndGraphBtnStates();
              }
              if (typeof syncEffectsRackUI === 'function') {
                syncEffectsRackUI(true);
              }
            } else {
              syncTransformControllerValues();
            }
            if (typeof invalidatePreviewCacheForLayer === 'function') {
              invalidatePreviewCacheForLayer(layer);
            }
            if (typeof redrawComposition === 'function') {
              redrawComposition(isEffectProp ? 'effectExpressionClear' : 'expressionClear');
            }
            if (typeof saveCurrentProjectLayers === 'function') {
              saveCurrentProjectLayers();
            }
            if (window.Popover) {
              window.Popover.close();
            }
          });
        }
      }

      // D. Back button: Graph Editor -> Transform / Blend
      const btnGraphBack = document.getElementById('btn-graph-back');
      if (btnGraphBack) {
        btnGraphBack.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview(window.previousDrawerSubview || 'transform');
        });
      }

      // E. Tool Mode Switch (Move/Anchor toggle, Rotate, Scale, Skew)
      let moveAnchorSubmode = window.moveAnchorSubmode || 'move'; // 'move' or 'anchor'

      function updateMoveAnchorUI() {
        const moveBtn = document.getElementById('btn-tool-move-anchor');
        if (!moveBtn) return;
        const svgMove = moveBtn.querySelector('.svg-tool-move');
        const svgAnchor = moveBtn.querySelector('.svg-tool-anchor');
        const labelEl = moveBtn.querySelector('.transform-tool-label');
        const promptEl = document.querySelector('#pane-transform-move .transform-swipe-prompt');

        moveBtn.dataset.submode = moveAnchorSubmode;
        window.moveAnchorSubmode = moveAnchorSubmode;
        if (moveAnchorSubmode === 'anchor') {
          if (svgMove) svgMove.style.display = 'none';
          if (svgAnchor) svgAnchor.style.display = '';
          if (labelEl) labelEl.textContent = 'Anchor';
          moveBtn.title = 'Move Anchor Point - Click to toggle Move Layer';
          moveBtn.setAttribute('aria-label', 'Move Anchor');
          if (promptEl) promptEl.textContent = 'Swipe here to move anchor';
        } else {
          if (svgMove) svgMove.style.display = '';
          if (svgAnchor) svgAnchor.style.display = 'none';
          if (labelEl) labelEl.textContent = 'Move';
          moveBtn.title = 'Move Layer (Position) - Click to toggle Move Anchor';
          moveBtn.setAttribute('aria-label', 'Move Layer');
          if (promptEl) promptEl.textContent = 'Swipe here to move layer';
        }
        syncTransformControllerValues();
      }

      const toolBtns = document.querySelectorAll('.transform-tool-btn');
      toolBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tool = btn.dataset.tool;
          if (!tool) return;

          // If clicking already active Move button, toggle between Move and Anchor
          if (tool === 'move' && btn.classList.contains('is-active')) {
            moveAnchorSubmode = moveAnchorSubmode === 'move' ? 'anchor' : 'move';
            window.moveAnchorSubmode = moveAnchorSubmode;
            updateMoveAnchorUI();
            if (typeof redrawComposition === 'function') {
              redrawComposition('toggleMoveAnchorSubmode');
            }
            return;
          }

          toolBtns.forEach(b => b.classList.toggle('is-active', b === btn));

          document.querySelectorAll('.transform-pane').forEach(pane => {
            pane.classList.toggle('is-active', pane.id === `pane-transform-${tool}`);
          });

          if (tool === 'rotate' && typeof syncRotateDialTrack === 'function') {
            syncRotateDialTrack();
          }

          window.activeTransformTool = tool;
          window.activeKeyframeProperty = tool;
          if (typeof window.clearSelectedKeyframes === 'function') {
            window.clearSelectedKeyframes();
          }
          updateTransformKeyframeBtnState();
          renderTimelineLayers();
          if (typeof updateGraphEditorUI === 'function') {
            updateGraphEditorUI();
          }

          // Sync view values for the active tool
          syncTransformControllerValues();
          if (typeof redrawComposition === 'function') {
            redrawComposition('switchTransformTool');
          }
          if (typeof centerSelectedTimelineLayer === 'function') {
            centerSelectedTimelineLayer(false);
          }
        });
      });

      // Initialize Graph Editor Controller
      if (typeof window.initGraphEditor === 'function') {
        window.initGraphEditor();
      } else if (typeof initGraphEditor === 'function') {
        initGraphEditor();
      }

      // F. Aspect Ratio Link Toggle on Scale pane
      const btnScaleLink = document.getElementById('btn-scale-link');
      let isScaleLinked = true;
      function setScaleLinked(linked, targetLayer = null) {
        isScaleLinked = Boolean(linked);
        const layer = targetLayer || ((currentProjectState && currentProjectState.layers) || []).find(l => l.id === window.selectedLayerId);
        if (layer) {
          layer.isScaleLinked = isScaleLinked;
          layer.lockAspect = isScaleLinked;
          layer.aspectLocked = isScaleLinked;
        }
        if (btnScaleLink) {
          const linkOnSvg = btnScaleLink.querySelector('.svg-link-on');
          const linkOffSvg = btnScaleLink.querySelector('.svg-link-off');
          if (linkOnSvg) linkOnSvg.style.display = isScaleLinked ? '' : 'none';
          if (linkOffSvg) linkOffSvg.style.display = isScaleLinked ? 'none' : '';
        }
        const singleJog = document.getElementById('jog-scale-linked');
        const dualJog = document.getElementById('jog-scale-unlinked');
        if (singleJog) singleJog.style.display = isScaleLinked ? '' : 'none';
        if (dualJog) dualJog.style.display = isScaleLinked ? 'none' : 'flex';
        syncTransformControllerValues();
      }
      window.setScaleLinked = setScaleLinked;

      if (btnScaleLink) {
        btnScaleLink.addEventListener('click', (e) => {
          e.stopPropagation();
          setScaleLinked(!isScaleLinked);
        });
      }

      // G. Move Pad Interaction (#pad-transform-move)
      const movePad = document.getElementById('pad-transform-move');
      if (movePad) {
        let isMoving = false;
        let startPointer = { x: 0, y: 0 };
        let initPos = { x: 0, y: 0 };
        let initAnchor = { x: 0, y: 0 };
        let targetL = null;
        let bW = 1920;
        let bH = 1080;
        let movePadRaf = null;

        function requestMovePadRedraw() {
          if (movePadRaf) return;
          movePadRaf = requestAnimationFrame(() => {
            movePadRaf = null;
            redrawComposition();
          });
        }

        function flushMovePadRedraw() {
          if (movePadRaf) {
            cancelAnimationFrame(movePadRaf);
            movePadRaf = null;
          }
          redrawComposition();
        }

        movePad.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          if (e.target.closest('.transform-z-ruler-wrap')) return;
          const info = getSelectedLayerAndBaseDims();
          if (!info) return;
          targetL = info.layer;
          if (targetL && targetL.expressions && (targetL.expressions.move || (typeof moveAnchorSubmode !== 'undefined' && moveAnchorSubmode === 'anchor' && targetL.expressions.anchor))) return;
          bW = info.baseW;
          bH = info.baseH;

          window.isTransformInteracting = true;
          syncLayerWithEffectiveProps(targetL);
          invalidatePreviewCacheForLayer(targetL);

          isMoving = true;
          startPointer = { x: e.clientX, y: e.clientY };
          initPos = {
            x: targetL.posX !== undefined ? targetL.posX : (targetL.normX !== undefined ? (targetL.normX + targetL.normW / 2) * bW : bW / 2),
            y: targetL.posY !== undefined ? targetL.posY : (targetL.normY !== undefined ? (targetL.normY + targetL.normH / 2) * bH : bH / 2)
          };
          initAnchor = {
            x: targetL.anchorX !== undefined ? targetL.anchorX : 0,
            y: targetL.anchorY !== undefined ? targetL.anchorY : 0
          };

          movePad.setPointerCapture(e.pointerId);
          movePad.classList.add('is-dragging');
          e.preventDefault();
        });

        movePad.addEventListener('pointermove', (e) => {
          if (!isMoving || !targetL) return;
          const rawDeltaX = e.clientX - startPointer.x;
          const rawDeltaY = e.clientY - startPointer.y;

          const activeCanvasEl = document.getElementById('editor-active-canvas');
          const canvasRect = activeCanvasEl ? activeCanvasEl.getBoundingClientRect() : null;
          const scaleRatioX = (canvasRect && canvasRect.width > 0) ? (bW / canvasRect.width) : 1.0;
          const scaleRatioY = (canvasRect && canvasRect.height > 0) ? (bH / canvasRect.height) : 1.0;
          // Calibrated touchpad swipe sensitivity: smooth precision control without jumpiness
          const baseSensX = Math.max(0.5, Math.min(1.2, scaleRatioX * 0.35));
          const baseSensY = Math.max(0.5, Math.min(1.2, scaleRatioY * 0.35));
          const sensMod = e.shiftKey ? 0.25 : (e.altKey ? 2.0 : 1.0);

          const deltaX = rawDeltaX * baseSensX * sensMod;
          const deltaY = rawDeltaY * baseSensY * sensMod;

          if (moveAnchorSubmode === 'anchor') {
            const rad = -((targetL.rotZ || 0) * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const locX = deltaX * cos - deltaY * sin;
            const locY = deltaX * sin + deltaY * cos;

            let newAx = initAnchor.x + locX;
            let newAy = initAnchor.y + locY;

            // Snap to Grid when Grid Overlay is active
            const gridBtn = document.getElementById('editor-icon-grid');
            const isGridOn = gridBtn && gridBtn.classList.contains('is-active');
            let snapGuideX = null;
            let snapGuideY = null;

            if (isGridOn) {
              const targetsX = [0, bW * 0.25, bW * 0.5, bW * 0.75, bW];
              const targetsY = [0, bH * 0.25, bH * 0.5, bH * 0.75, bH];
              const tolX = 16;
              const tolY = 16;

              const layerPosX = targetL.posX !== undefined ? targetL.posX : bW / 2;
              const layerPosY = targetL.posY !== undefined ? targetL.posY : bH / 2;

              const curAncWorldX = layerPosX + newAx;
              const curAncWorldY = layerPosY + newAy;

              const sCX = (window.findSnapTarget || findSnapTarget)(curAncWorldX, targetsX, tolX);
              if (sCX !== null) {
                newAx = sCX - layerPosX;
                snapGuideX = sCX;
              } else {
                const sOriginX = (window.findSnapTarget || findSnapTarget)(curAncWorldX, [layerPosX], tolX);
                if (sOriginX !== null) {
                  newAx = 0;
                  snapGuideX = layerPosX;
                }
              }

              const sCY = (window.findSnapTarget || findSnapTarget)(curAncWorldY, targetsY, tolY);
              if (sCY !== null) {
                newAy = sCY - layerPosY;
                snapGuideY = sCY;
              } else {
                const sOriginY = (window.findSnapTarget || findSnapTarget)(curAncWorldY, [layerPosY], tolY);
                if (sOriginY !== null) {
                  newAy = 0;
                  snapGuideY = layerPosY;
                }
              }
            }

            window.activeSnapGuides = { x: snapGuideX, y: snapGuideY };

            targetL.anchorX = Number(newAx.toFixed(2));
            targetL.anchorY = Number(newAy.toFixed(2));

            recordLayerPropertyChange(targetL, 'move');

            const valPosX = document.getElementById('val-pos-x');
            const valPosY = document.getElementById('val-pos-y');
            if (valPosX) valPosX.textContent = (window.formatTransformNumber || formatTransformNumber)(targetL.anchorX);
            if (valPosY) valPosY.textContent = (window.formatTransformNumber || formatTransformNumber)(targetL.anchorY);

            requestMovePadRedraw();
            return;
          }

          let newPosX = initPos.x + deltaX;
          let newPosY = initPos.y + deltaY;

          const curScaleW = targetL.scaleW !== undefined ? targetL.scaleW : (targetL.normW !== undefined ? targetL.normW * bW : bW);
          const curScaleH = targetL.scaleH !== undefined ? targetL.scaleH : (targetL.normH !== undefined ? targetL.normH * bH : bH);
          const halfW = Math.abs(curScaleW) / 2;
          const halfH = Math.abs(curScaleH) / 2;

          // Snap to Grid when Grid Overlay is active
          const gridBtn = document.getElementById('editor-icon-grid');
          const isGridOn = gridBtn && gridBtn.classList.contains('is-active');
          let snapGuideX = null;
          let snapGuideY = null;

          if (isGridOn) {
            const targetsX = [0, bW * 0.25, bW * 0.5, bW * 0.75, bW];
            const targetsY = [0, bH * 0.25, bH * 0.5, bH * 0.75, bH];
            const tolX = 16;
            const tolY = 16;

            const anchorOffsetX = targetL.anchorX || 0;
            const anchorOffsetY = targetL.anchorY || 0;
            const curAnchorX = newPosX + anchorOffsetX;
            const curAnchorY = newPosY + anchorOffsetY;

            // Center X snapping: align anchor point to grid lines
            const sCX = (window.findSnapTarget || findSnapTarget)(curAnchorX, targetsX, tolX);
            if (sCX !== null) {
              newPosX = sCX - anchorOffsetX;
              snapGuideX = sCX;
            } else {
              const sLX = (window.findSnapTarget || findSnapTarget)(newPosX - halfW, targetsX, tolX);
              if (sLX !== null) {
                newPosX = sLX + halfW;
                snapGuideX = sLX;
              } else {
                const sRX = (window.findSnapTarget || findSnapTarget)(newPosX + halfW, targetsX, tolX);
                if (sRX !== null) {
                  newPosX = sRX - halfW;
                  snapGuideX = sRX;
                }
              }
            }

            // Center Y snapping: align anchor point to grid lines
            const sCY = (window.findSnapTarget || findSnapTarget)(curAnchorY, targetsY, tolY);
            if (sCY !== null) {
              newPosY = sCY - anchorOffsetY;
              snapGuideY = sCY;
            } else {
              const sTY = (window.findSnapTarget || findSnapTarget)(newPosY - halfH, targetsY, tolY);
              if (sTY !== null) {
                newPosY = sTY + halfH;
                snapGuideY = sTY;
              } else {
                const sBY = (window.findSnapTarget || findSnapTarget)(newPosY + halfH, targetsY, tolY);
                if (sBY !== null) {
                  newPosY = sBY - halfH;
                  snapGuideY = sBY;
                }
              }
            }
          }

          window.activeSnapGuides = { x: snapGuideX, y: snapGuideY };

          targetL.posX = Number(newPosX.toFixed(2));
          targetL.posY = Number(newPosY.toFixed(2));

          targetL.normX = (targetL.posX - halfW) / bW;
          targetL.normY = (targetL.posY - halfH) / bH;

          recordLayerPropertyChange(targetL, 'move');

          const valPosX = document.getElementById('val-pos-x');
          const valPosY = document.getElementById('val-pos-y');
          if (valPosX) valPosX.textContent = (window.formatTransformNumber || formatTransformNumber)(targetL.posX);
          if (valPosY) valPosY.textContent = (window.formatTransformNumber || formatTransformNumber)(targetL.posY);

          requestMovePadRedraw();
        });

        const onMoveEnd = (e) => {
          if (!isMoving) {
            if (window.activeSnapGuides) {
              window.activeSnapGuides = null;
              if (window.CanvasOverlay) window.CanvasOverlay.scheduleRedraw();
            }
            return;
          }
          try { movePad.releasePointerCapture(e.pointerId); } catch (_) {}
          movePad.classList.remove('is-dragging');
          isMoving = false;
          window.isTransformInteracting = false;
          const finishedLayer = targetL;
          targetL = null;
          window.activeSnapGuides = null;
          if (finishedLayer) {
            invalidatePreviewCacheForLayer(finishedLayer);
          }
          flushMovePadRedraw();
          renderTimelineLayers();
          saveCurrentProjectLayers();
        };

        movePad.addEventListener('pointerup', onMoveEnd);
        movePad.addEventListener('pointercancel', onMoveEnd);
        window.addEventListener('pointerup', onMoveEnd);
        window.addEventListener('pointercancel', onMoveEnd);
      }

      // H1. Rotate Axis Switch Interaction (X, Y, Z)
      const rotateAxisSwitchEl = document.getElementById('rotate-axis-switch');
      if (rotateAxisSwitchEl) {
        rotateAxisSwitchEl.addEventListener('pointerdown', (e) => e.stopPropagation());
        rotateAxisSwitchEl.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        rotateAxisSwitchEl.addEventListener('mousedown', (e) => e.stopPropagation());
      }
      const axisBtns = document.querySelectorAll('#rotate-axis-switch .segmented-switch-item');
      axisBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const axis = btn.dataset.axis;
          if (!axis) return;
          const info = getSelectedLayerAndBaseDims();
          if (info && info.layer && (info.layer.type === 'adjustment' || !info.layer.is3D)) {
            if (axis === 'x' || axis === 'y') return;
          }
          currentRotateAxis = axis;
          window.currentRotateAxis = axis;

          axisBtns.forEach(b => {
            const isActive = (b === btn);
            b.classList.toggle('is-active', isActive);
            b.classList.toggle('is-selected', isActive);
            b.setAttribute('aria-selected', isActive ? 'true' : 'false');
          });

          if (info) {
            const l = info.layer;
            let val = 0;
            if (axis === 'x') val = l.rotX || 0;
            else if (axis === 'y') val = l.rotY || 0;
            else val = l.rotZ !== undefined ? l.rotZ : (l.rotation || 0);

            updateRotateKnob(val);
          }
        });
      });

      // H2. Rotate Dial Wheel Interaction (#dial-transform-rotate)
      const rotateDial = document.getElementById('dial-transform-rotate');
      if (rotateDial) {
        let isRotating = false;
        let lastAngle = 0;
        let currentRot = 0;
        let targetL = null;
        let dialCenter = { x: 0, y: 0 };
        let dialHalfW = 100;
        let dialHalfH = 100;

        rotateDial.addEventListener('pointerdown', (e) => {
          if (e.target && (e.target.closest('.rotate-center-badge') || e.target.closest('#rotate-axis-switch'))) return;
          if (e.button !== 0) return;
          const info = getSelectedLayerAndBaseDims();
          if (!info) return;
          targetL = info.layer;
          if (targetL && targetL.expressions && (targetL.expressions.rotate || targetL.expressions.rotation || targetL.expressions.rotZ)) return;

          window.isTransformInteracting = true;
          syncLayerWithEffectiveProps(targetL);
          invalidatePreviewCacheForLayer(targetL);

          const rect = rotateDial.getBoundingClientRect();
          dialCenter = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
          dialHalfW = Math.max(1, rect.width / 2);
          dialHalfH = Math.max(1, rect.height / 2);

          isRotating = true;
          const dx = (e.clientX - dialCenter.x) / dialHalfW;
          const dy = (e.clientY - dialCenter.y) / dialHalfH;
          lastAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          if (currentRotateAxis === 'x') {
            currentRot = targetL.rotX !== undefined ? targetL.rotX : 0;
          } else if (currentRotateAxis === 'y') {
            currentRot = targetL.rotY !== undefined ? targetL.rotY : 0;
          } else {
            currentRot = targetL.rotZ !== undefined ? targetL.rotZ : (targetL.rotation !== undefined ? targetL.rotation : 0);
          }

          try { rotateDial.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
        });

        rotateDial.addEventListener('pointermove', (e) => {
          if (!isRotating || !targetL) return;
          const dx = (e.clientX - dialCenter.x) / dialHalfW;
          const dy = (e.clientY - dialCenter.y) / dialHalfH;
          const curAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          let delta = curAngle - lastAngle;
          while (delta > 180) delta -= 360;
          while (delta < -180) delta += 360;

          currentRot += delta;
          lastAngle = curAngle;

          let val = Math.round(currentRot);

          // Snap to standard angles (multiples of 45 deg) when grid is on
          const gridBtn = document.getElementById('editor-icon-grid');
          const isGridOn = gridBtn && gridBtn.classList.contains('is-active');
          if (isGridOn) {
            const snapAngles = [];
            for (let a = -720; a <= 720; a += 45) snapAngles.push(a);
            const sAngle = (window.findSnapTarget || findSnapTarget)(currentRot, snapAngles, 5);
            if (sAngle !== null) {
              val = sAngle;
            }
          }

          if (currentRotateAxis === 'x') {
            targetL.rotX = val;
          } else if (currentRotateAxis === 'y') {
            targetL.rotY = val;
          } else {
            targetL.rotZ = val;
            targetL.rotation = val;
          }

          if (typeof invalidateEffectivePropsCache === 'function') {
            invalidateEffectivePropsCache();
          }

          recordLayerPropertyChange(targetL, 'rotate');

          updateRotateKnob(val);
          redrawComposition();
        });

        const onRotEnd = (e) => {
          if (!isRotating) return;
          try { rotateDial.releasePointerCapture(e.pointerId); } catch (_) {}
          isRotating = false;
          window.isTransformInteracting = false;
          const finishedLayer = targetL;
          targetL = null;
          if (finishedLayer) {
            invalidatePreviewCacheForLayer(finishedLayer);
          }
          redrawComposition();
          renderTimelineLayers();
          saveCurrentProjectLayers();
        };

        rotateDial.addEventListener('pointerup', onRotEnd);
        rotateDial.addEventListener('pointercancel', onRotEnd);
      }
      initDesktopRotateDials();
      initRotateSliders();

      // UI scale (zoom) change listener: re-sync rotate dial tracks and knob positions immediately
      if (!window._oftRotateDialScaleListenerAttached) {
        window._oftRotateDialScaleListenerAttached = true;
        window.addEventListener('oft-ui-scale-changed', () => {
          try {
            const dial = document.getElementById('dial-transform-rotate');
            if (dial) {
              syncRotateDialTrack();
              const curInfo = (typeof getSelectedLayerAndBaseDims === 'function') ? getSelectedLayerAndBaseDims() : null;
              const l = curInfo ? curInfo.layer : null;
              let r = 0;
              if (l) {
                if (currentRotateAxis === 'x') r = l.rotX || 0;
                else if (currentRotateAxis === 'y') r = l.rotY || 0;
                else r = l.rotZ !== undefined ? l.rotZ : (l.rotation || 0);
              }
              updateRotateKnob(r);
            }
            updateDesktopRotateDials();
          } catch (_) {}
        });
      }

      // 0. Z Position / Anchor Z Vertical Jog Wheel (#jog-pos-z)
      let posZInit = { z: 0, targetL: null, isAnchor: false };
      bindJogWheel(document.getElementById('jog-pos-z'), {
        onStart: () => {
          const info = getSelectedLayerAndBaseDims();
          if (!info) return;
          const l = info.layer;
          if (l && (l.type === 'adjustment' || !l.is3D)) return;
          const isAnchor = (typeof moveAnchorSubmode !== 'undefined' && moveAnchorSubmode === 'anchor');
          if (l && l.expressions && (l.expressions.move || (isAnchor && l.expressions.anchor))) return;
          syncLayerWithEffectiveProps(l);
          invalidatePreviewCacheForLayer(l);
          const curVal = isAnchor ? (l.anchorZ !== undefined ? l.anchorZ : 0) : (l.posZ !== undefined ? l.posZ : 0);
          posZInit = { z: curVal, targetL: l, isAnchor };
        },
        onMove: (deltaY) => {
          const { targetL, z, isAnchor } = posZInit;
          if (!targetL || targetL.type === 'adjustment' || !targetL.is3D) return;
          let newZ = z + deltaY * 2;

          // Snap to Grid when Grid Overlay is active
          const gridBtn = document.getElementById('editor-icon-grid');
          const isGridOn = gridBtn && gridBtn.classList.contains('is-active');
          if (isGridOn) {
            const snapTargets = [-1000, -750, -500, -250, 0, 250, 500, 750, 980];
            const sVal = (window.findSnapTarget || findSnapTarget)(newZ, snapTargets, 18);
            if (sVal !== null) newZ = sVal;
          }

          if (isAnchor) {
            targetL.anchorZ = Number(newZ.toFixed(2));
          } else {
            targetL.posZ = Number(newZ.toFixed(2));
          }

          recordLayerPropertyChange(targetL, 'move');

          const valPosZ = document.getElementById('val-pos-z');
          if (valPosZ) {
            const displayVal = isAnchor ? targetL.anchorZ : targetL.posZ;
            valPosZ.textContent = (window.formatTransformNumber || formatTransformNumber)(displayVal);
            valPosZ.classList.toggle('is-neutral', Math.abs(displayVal) < 0.01);
          }

          redrawComposition();
        },
        onEnd: () => {
          if (posZInit && posZInit.targetL) {
            invalidatePreviewCacheForLayer(posZInit.targetL);
          }
          redrawComposition();
          renderTimelineLayers();
          saveCurrentProjectLayers();
        }
      }, true);

      // 1. Scale Linked Jog Wheel (#jog-scale-linked)
      let scaleLinkedInit = { w: 1080, h: 1920, z: 300, ratio: 1, targetL: null, baseW: 1920, baseH: 1080 };
      bindJogWheel(document.getElementById('jog-scale-linked'), {
        onStart: () => {
          const info = getSelectedLayerAndBaseDims();
          if (!info) return;
          const l = info.layer;
          if (l && l.expressions && l.expressions.scale) return;
          syncLayerWithEffectiveProps(l);
          invalidatePreviewCacheForLayer(l);
          const initW = l.scaleW !== undefined ? l.scaleW : (l.normW !== undefined ? l.normW * info.baseW : info.baseW);
          const initH = l.scaleH !== undefined ? l.scaleH : (l.normH !== undefined ? l.normH * info.baseH : info.baseH);
          const defaultZ = Math.round(Math.min(Math.abs(initW), Math.abs(initH)));
          const initZ = l.scaleZ !== undefined ? l.scaleZ : defaultZ;
          const ratio = (initH !== 0 && !isNaN(initH)) ? (initW / initH) : 1;
          scaleLinkedInit = { w: initW, h: initH, z: initZ, ratio: ratio, targetL: l, baseW: info.baseW, baseH: info.baseH };
        },
        onMove: (deltaX) => {
          const { targetL, w, h, z, ratio, baseW, baseH } = scaleLinkedInit;
          if (!targetL) return;
          let newW = Math.max(1, w + deltaX * 2);
          let newH = ratio !== 0 ? newW / ratio : newW;

          // Snap to Grid when Grid Overlay is active
          const gridBtn = document.getElementById('editor-icon-grid');
          const isGridOn = gridBtn && gridBtn.classList.contains('is-active');
          let snapGuideX = null;
          let snapGuideY = null;

          if (isGridOn) {
            const curPosX = targetL.posX !== undefined ? targetL.posX : baseW / 2;
            const curPosY = targetL.posY !== undefined ? targetL.posY : baseH / 2;
            const targetsX = [0, baseW * 0.25, baseW * 0.5, baseW * 0.75, baseW];
            const targetsY = [0, baseH * 0.25, baseH * 0.5, baseH * 0.75, baseH];
            const tol = 16;

            const halfW = Math.abs(newW) / 2;
            const sRX = (window.findSnapTarget || findSnapTarget)(curPosX + halfW, targetsX, tol);
            const sLX = (window.findSnapTarget || findSnapTarget)(curPosX - halfW, targetsX, tol);
            if (sRX !== null) {
              newW = Math.abs(sRX - curPosX) * 2;
              newH = ratio !== 0 ? newW / ratio : newW;
              snapGuideX = sRX;
            } else if (sLX !== null) {
              newW = Math.abs(curPosX - sLX) * 2;
              newH = ratio !== 0 ? newW / ratio : newW;
              snapGuideX = sLX;
            }

            const halfH = Math.abs(newH) / 2;
            const sBY = (window.findSnapTarget || findSnapTarget)(curPosY + halfH, targetsY, tol);
            const sTY = (window.findSnapTarget || findSnapTarget)(curPosY - halfH, targetsY, tol);
            if (sBY !== null) {
              newH = Math.abs(sBY - curPosY) * 2;
              newW = ratio !== 0 ? newH * ratio : newH;
              snapGuideY = sBY;
            } else if (sTY !== null) {
              newH = Math.abs(curPosY - sTY) * 2;
              newW = ratio !== 0 ? newH * ratio : newH;
              snapGuideY = sTY;
            }
          }

          window.activeSnapGuides = { x: snapGuideX, y: snapGuideY };

          targetL.scaleW = Number(newW.toFixed(1));
          targetL.scaleH = Number(newH.toFixed(1));
          if (targetL.scaleZ !== undefined && w !== 0) {
            const factor = Math.abs(newW) / Math.abs(w);
            targetL.scaleZ = Math.max(1, Math.round(z * factor));
            const valZ = document.getElementById('val-scale-z');
            if (valZ) valZ.textContent = targetL.scaleZ.toFixed(1);
          }
          targetL._userResized = true;
          targetL._userResizedManual = true;
          targetL.normW = Math.abs(targetL.scaleW) / baseW;
          targetL.normH = Math.abs(targetL.scaleH) / baseH;
          if (targetL.type === 'shape' && targetL.shapeProps) {
            const sx = Number(targetL.shapeProps.sizeX) || 300;
            const sy = Number(targetL.shapeProps.sizeY) || 300;
            targetL.transformScaleX = targetL.scaleW / sx;
            targetL.transformScaleY = targetL.scaleH / sy;
          } else if (targetL.type === 'text') {
            const nat = (window.FishTextEngine && window.FishTextEngine.getNaturalSize)
              ? window.FishTextEngine.getNaturalSize(targetL)
              : { width: 320, height: 100 };
            targetL.transformScaleX = targetL.scaleW / Math.max(1, nat.width);
            targetL.transformScaleY = targetL.scaleH / Math.max(1, nat.height);
          }
          const curPosX = targetL.posX !== undefined ? targetL.posX : baseW / 2;
          const curPosY = targetL.posY !== undefined ? targetL.posY : baseH / 2;
          targetL.normX = (curPosX - targetL.normW * baseW / 2) / baseW;
          targetL.normY = (curPosY - targetL.normH * baseH / 2) / baseH;

          recordLayerPropertyChange(targetL, 'scale');

          const valW = document.getElementById('val-scale-w');
          const valH = document.getElementById('val-scale-h');
          if (valW) valW.textContent = targetL.scaleW.toFixed(1);
          if (valH) valH.textContent = targetL.scaleH.toFixed(1);

          redrawComposition();
        },
        onEnd: () => {
          window.activeSnapGuides = null;
          if (scaleLinkedInit && scaleLinkedInit.targetL) {
            invalidatePreviewCacheForLayer(scaleLinkedInit.targetL);
          }
          redrawComposition();
          renderTimelineLayers();
          saveCurrentProjectLayers();
        }
      });

      // 2. Scale Width Unlinked Jog Wheel (#jog-scale-w)
      let scaleWInit = { w: 1080, targetL: null, baseW: 1920, baseH: 1080 };
      bindJogWheel(document.getElementById('jog-scale-w'), {
        onStart: () => {
          const info = getSelectedLayerAndBaseDims();
          if (!info) return;
          const l = info.layer;
          if (l && l.expressions && l.expressions.scale) return;
          syncLayerWithEffectiveProps(l);
          invalidatePreviewCacheForLayer(l);
          const initW = l.scaleW !== undefined ? l.scaleW : (l.normW !== undefined ? l.normW * info.baseW : info.baseW);
          scaleWInit = { w: initW, targetL: l, baseW: info.baseW, baseH: info.baseH };
        },
        onMove: (deltaX) => {
          const { targetL, w, baseW } = scaleWInit;
          if (!targetL) return;
          let newW = Math.max(1, w + deltaX * 2);

          // Snap to Grid when Grid Overlay is active
          const gridBtn = document.getElementById('editor-icon-grid');
          const isGridOn = gridBtn && gridBtn.classList.contains('is-active');
          let snapGuideX = null;

          if (isGridOn) {
            const curPosX = targetL.posX !== undefined ? targetL.posX : baseW / 2;
            const targetsX = [0, baseW * 0.25, baseW * 0.5, baseW * 0.75, baseW];
            const tol = 16;
            const halfW = Math.abs(newW) / 2;
            const sRX = (window.findSnapTarget || findSnapTarget)(curPosX + halfW, targetsX, tol);
            const sLX = (window.findSnapTarget || findSnapTarget)(curPosX - halfW, targetsX, tol);
            if (sRX !== null) {
              newW = Math.abs(sRX - curPosX) * 2;
              snapGuideX = sRX;
            } else if (sLX !== null) {
              newW = Math.abs(curPosX - sLX) * 2;
              snapGuideX = sLX;
            }
          }

          window.activeSnapGuides = { x: snapGuideX, y: null };

          targetL.scaleW = Number(newW.toFixed(1));
          targetL._userResized = true;
          targetL._userResizedManual = true;
          targetL.normW = Math.abs(targetL.scaleW) / baseW;
          if (targetL.type === 'shape' && targetL.shapeProps) {
            const sx = Number(targetL.shapeProps.sizeX) || 300;
            targetL.transformScaleX = targetL.scaleW / sx;
          } else if (targetL.type === 'text') {
            const nat = (window.FishTextEngine && window.FishTextEngine.getNaturalSize)
              ? window.FishTextEngine.getNaturalSize(targetL)
              : { width: 320, height: 100 };
            targetL.transformScaleX = targetL.scaleW / Math.max(1, nat.width);
          }
          const curPosX = targetL.posX !== undefined ? targetL.posX : baseW / 2;
          targetL.normX = (curPosX - targetL.normW * baseW / 2) / baseW;

          recordLayerPropertyChange(targetL, 'scale');

          const valW = document.getElementById('val-scale-w');
          if (valW) valW.textContent = targetL.scaleW.toFixed(1);

          redrawComposition();
        },
        onEnd: () => {
          window.activeSnapGuides = null;
          if (scaleWInit && scaleWInit.targetL) {
            invalidatePreviewCacheForLayer(scaleWInit.targetL);
          }
          redrawComposition();
          renderTimelineLayers();
          saveCurrentProjectLayers();
        }
      });

      // 3. Scale Height Unlinked Jog Wheel (#jog-scale-h)
      let scaleHInit = { h: 1920, targetL: null, baseW: 1920, baseH: 1080 };
      bindJogWheel(document.getElementById('jog-scale-h'), {
        onStart: () => {
          const info = getSelectedLayerAndBaseDims();
          if (!info) return;
          const l = info.layer;
          if (l && l.expressions && l.expressions.scale) return;
          syncLayerWithEffectiveProps(l);
          invalidatePreviewCacheForLayer(l);
          const initH = l.scaleH !== undefined ? l.scaleH : (l.normH !== undefined ? l.normH * info.baseH : info.baseH);
          scaleHInit = { h: initH, targetL: l, baseW: info.baseW, baseH: info.baseH };
        },
        onMove: (deltaX) => {
          const { targetL, h, baseH } = scaleHInit;
          if (!targetL) return;
          let newH = Math.max(1, h + deltaX * 2);

          // Snap to Grid when Grid Overlay is active
          const gridBtn = document.getElementById('editor-icon-grid');
          const isGridOn = gridBtn && gridBtn.classList.contains('is-active');
          let snapGuideY = null;

          if (isGridOn) {
            const curPosY = targetL.posY !== undefined ? targetL.posY : baseH / 2;
            const targetsY = [0, baseH * 0.25, baseH * 0.5, baseH * 0.75, baseH];
            const tol = 16;
            const halfH = Math.abs(newH) / 2;
            const sBY = (window.findSnapTarget || findSnapTarget)(curPosY + halfH, targetsY, tol);
            const sTY = (window.findSnapTarget || findSnapTarget)(curPosY - halfH, targetsY, tol);
            if (sBY !== null) {
              newH = Math.abs(sBY - curPosY) * 2;
              snapGuideY = sBY;
            } else if (sTY !== null) {
              newH = Math.abs(curPosY - sTY) * 2;
              snapGuideY = sTY;
            }
          }

          window.activeSnapGuides = { x: null, y: snapGuideY };

          targetL.scaleH = Number(newH.toFixed(1));
          targetL._userResized = true;
          targetL._userResizedManual = true;
          targetL.normH = Math.abs(targetL.scaleH) / baseH;
          if (targetL.type === 'shape' && targetL.shapeProps) {
            const sy = Number(targetL.shapeProps.sizeY) || 300;
            targetL.transformScaleY = targetL.scaleH / sy;
          } else if (targetL.type === 'text') {
            const nat = (window.FishTextEngine && window.FishTextEngine.getNaturalSize)
              ? window.FishTextEngine.getNaturalSize(targetL)
              : { width: 320, height: 100 };
            targetL.transformScaleY = targetL.scaleH / Math.max(1, nat.height);
          }
          const curPosY = targetL.posY !== undefined ? targetL.posY : baseH / 2;
          targetL.normY = (curPosY - targetL.normH * baseH / 2) / baseH;

          recordLayerPropertyChange(targetL, 'scale');

          const valH = document.getElementById('val-scale-h');
          if (valH) valH.textContent = targetL.scaleH.toFixed(1);

          redrawComposition();
        },
        onEnd: () => {
          window.activeSnapGuides = null;
          if (scaleHInit && scaleHInit.targetL) {
            invalidatePreviewCacheForLayer(scaleHInit.targetL);
          }
          redrawComposition();
          renderTimelineLayers();
        }
      });

      // 3b. Scale Z (Depth) Unlinked Jog Wheel (#jog-scale-z)
      let scaleZInit = { z: 300, targetL: null };
      bindJogWheel(document.getElementById('jog-scale-z'), {
        onStart: () => {
          const info = getSelectedLayerAndBaseDims();
          if (!info) return;
          const l = info.layer;
          if (l && l.expressions && l.expressions.scale) return;
          syncLayerWithEffectiveProps(l);
          invalidatePreviewCacheForLayer(l);
          const defaultZ = Math.round(Math.min(Math.abs(l.scaleW || l.w || 300), Math.abs(l.scaleH || l.h || 300)));
          const initZ = l.scaleZ !== undefined ? l.scaleZ : defaultZ;
          scaleZInit = { z: initZ, targetL: l };
        },
        onMove: (deltaX) => {
          const { targetL, z } = scaleZInit;
          if (!targetL) return;
          let newZ = Math.max(1, Math.round(z + deltaX * 2));
          targetL.scaleZ = newZ;
          recordLayerPropertyChange(targetL, 'scale');
          const valZ = document.getElementById('val-scale-z');
          if (valZ) valZ.textContent = targetL.scaleZ.toFixed(1);
          redrawComposition();
        },
        onEnd: () => {
          if (scaleZInit && scaleZInit.targetL) {
            invalidatePreviewCacheForLayer(scaleZInit.targetL);
          }
          redrawComposition();
          renderTimelineLayers();
          saveCurrentProjectLayers();
        }
      });



      // 4. Skew X Jog Wheel (#jog-skew-x) - rAF-coalesced apply, keyframe commit once on release
      let skewXInit = { skewX: 0, targetL: null, valEl: null, gridOn: false, pendingDelta: 0, rafId: 0 };
      const flushSkewX = () => {
        skewXInit.rafId = 0;
        const { targetL, skewX, pendingDelta, gridOn, valEl } = skewXInit;
        if (!targetL) return;
        let newSkewX = skewX + pendingDelta * 0.2;
        if (gridOn) {
          const snapAngles = [-45, -30, -15, 0, 15, 30, 45];
          const sVal = (window.findSnapTarget || findSnapTarget)(newSkewX, snapAngles, 2.0);
          if (sVal !== null) newSkewX = sVal;
        }
        newSkewX = Number(newSkewX.toFixed(1));
        if (targetL.skewX === newSkewX) return;
        targetL.skewX = newSkewX;
        // Live-sync existing keyframe value only; auto-create deferred to onEnd (1x)
        const kfListX = targetL.keyframes && targetL.keyframes.skew;
        if (kfListX && kfListX.length > 0 && typeof getKeyframeAtTime === 'function') {
          const ppsX = window.currentPixelsPerSecond || 80;
          const secX = Number((Math.abs(window.timelinePanX || 0) / ppsX).toFixed(3));
          const fpsX = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
          const kfX = getKeyframeAtTime(targetL, 'skew', secX, Math.max(0.04, 0.5 / fpsX));
          if (kfX) kfX.value = [targetL.skewX || 0, targetL.skewY || 0];
        }
        if (valEl) {
          const txtX = `${newSkewX.toFixed(1)}°`;
          if (valEl.textContent !== txtX) valEl.textContent = txtX;
        }
        redrawComposition();
      };
      bindJogWheel(document.getElementById('jog-skew-x'), {
        onStart: () => {
          const info = getSelectedLayerAndBaseDims();
          if (!info) return;
          const l = info.layer;
          if (l && l.expressions && l.expressions.skew) return;
          syncLayerWithEffectiveProps(l);
          invalidatePreviewCacheForLayer(l);
          const gridBtnX = document.getElementById('editor-icon-grid');
          skewXInit = { skewX: l.skewX || 0, targetL: l, valEl: document.getElementById('val-skew-x'), gridOn: !!(gridBtnX && gridBtnX.classList.contains('is-active')), pendingDelta: 0, rafId: 0 };
        },
        onMove: (deltaX) => {
          if (!skewXInit.targetL) return;
          skewXInit.pendingDelta = deltaX;
          if (!skewXInit.rafId) skewXInit.rafId = requestAnimationFrame(flushSkewX);
        },
        onEnd: () => {
          if (skewXInit.rafId) { cancelAnimationFrame(skewXInit.rafId); skewXInit.rafId = 0; flushSkewX(); }
          if (skewXInit && skewXInit.targetL) {
            if (typeof recordLayerPropertyChange === 'function') recordLayerPropertyChange(skewXInit.targetL, 'skew');
            invalidatePreviewCacheForLayer(skewXInit.targetL);
          }
          redrawComposition();
          renderTimelineLayers();
          saveCurrentProjectLayers();
        }
      });

      // 5. Skew Y Jog Wheel (#jog-skew-y) - rAF-coalesced apply, keyframe commit once on release
      let skewYInit = { skewY: 0, targetL: null, valEl: null, gridOn: false, pendingDelta: 0, rafId: 0 };
      const flushSkewY = () => {
        skewYInit.rafId = 0;
        const { targetL, skewY, pendingDelta, gridOn, valEl } = skewYInit;
        if (!targetL) return;
        let newSkewY = skewY + pendingDelta * 0.2;
        if (gridOn) {
          const snapAngles = [-45, -30, -15, 0, 15, 30, 45];
          const sVal = (window.findSnapTarget || findSnapTarget)(newSkewY, snapAngles, 2.0);
          if (sVal !== null) newSkewY = sVal;
        }
        newSkewY = Number(newSkewY.toFixed(1));
        if (targetL.skewY === newSkewY) return;
        targetL.skewY = newSkewY;
        // Live-sync existing keyframe value only; auto-create deferred to onEnd (1x)
        const kfListY = targetL.keyframes && targetL.keyframes.skew;
        if (kfListY && kfListY.length > 0 && typeof getKeyframeAtTime === 'function') {
          const ppsY = window.currentPixelsPerSecond || 80;
          const secY = Number((Math.abs(window.timelinePanX || 0) / ppsY).toFixed(3));
          const fpsY = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
          const kfY = getKeyframeAtTime(targetL, 'skew', secY, Math.max(0.04, 0.5 / fpsY));
          if (kfY) kfY.value = [targetL.skewX || 0, targetL.skewY || 0];
        }
        if (valEl) {
          const txtY = `${newSkewY.toFixed(1)}°`;
          if (valEl.textContent !== txtY) valEl.textContent = txtY;
        }
        redrawComposition();
      };
      bindJogWheel(document.getElementById('jog-skew-y'), {
        onStart: () => {
          const info = getSelectedLayerAndBaseDims();
          if (!info) return;
          const l = info.layer;
          if (l && l.expressions && l.expressions.skew) return;
          syncLayerWithEffectiveProps(l);
          invalidatePreviewCacheForLayer(l);
          const gridBtnY = document.getElementById('editor-icon-grid');
          skewYInit = { skewY: l.skewY || 0, targetL: l, valEl: document.getElementById('val-skew-y'), gridOn: !!(gridBtnY && gridBtnY.classList.contains('is-active')), pendingDelta: 0, rafId: 0 };
        },
        onMove: (deltaX) => {
          if (!skewYInit.targetL) return;
          skewYInit.pendingDelta = deltaX;
          if (!skewYInit.rafId) skewYInit.rafId = requestAnimationFrame(flushSkewY);
        },
        onEnd: () => {
          if (skewYInit.rafId) { cancelAnimationFrame(skewYInit.rafId); skewYInit.rafId = 0; flushSkewY(); }
          if (skewYInit && skewYInit.targetL) {
            if (typeof recordLayerPropertyChange === 'function') recordLayerPropertyChange(skewYInit.targetL, 'skew');
            invalidatePreviewCacheForLayer(skewYInit.targetL);
          }
          redrawComposition();
          renderTimelineLayers();
          saveCurrentProjectLayers();
        }
      });

      // I. Transform Inline Textbox Editing (Click-to-Edit Readouts)
      function parseTransformNumericInput(str) {
        if (!str) return NaN;
        str = String(str).replace(/px|deg|[°%]/gi, '').trim();
        str = str.replace(/x$/i, '').trim();
        if (/^[-+]?[0-9]*\.?[0-9]+([ \t]*[-+*/][ \t]*[-+]?[0-9]*\.?[0-9]+)*$/.test(str)) {
          try {
            const res = Function(`"use strict"; return (${str})`)();
            if (typeof res === 'number' && !isNaN(res) && isFinite(res)) {
              return res;
            }
          } catch (_) {}
        }
        const n = parseFloat(str);
        return isNaN(n) ? NaN : n;
      }

      function parseTransformRotationInput(str) {
        if (!str) return NaN;
        str = String(str).trim();
        if (!str) return NaN;

        const hasDegreeSymbol = /°|deg\b/i.test(str) || /(?<=\d)\s*\*(?!\s*[0-9.])/.test(str);
        let clean = str.replace(/°|deg\b/gi, '');
        clean = clean.replace(/(?<=\d)\s*\*(?!\s*[0-9.])/g, '').trim();
        clean = clean.replace(/\b(turns?|rot|putaran)\b/gi, 'x').trim();

        function calcRot(turns, deg, isNegTurn) {
          const d = Math.abs(deg);
          if (isNegTurn) {
            return (turns < 0 ? turns * 360 : 0) - d;
          }
          return turns * 360 + (deg < 0 ? deg : d);
        }

        // 1. Check for 'x' notation e.g. "1x 90", "+1x, 45", "-2x", "2x", "1x"
        const xMatch = clean.match(/^([-+]?\d*\.?\d+)\s*x(?:[,\s]*([-+]?\d*\.?\d+))?$/i);
        if (xMatch) {
          const turnsStr = xMatch[1];
          const turns = parseFloat(turnsStr);
          const deg = (xMatch[2] !== undefined && xMatch[2] !== '') ? parseFloat(xMatch[2]) : 0;
          if (!isNaN(turns) && !isNaN(deg)) {
            const isNegTurn = turns < 0 || Object.is(turns, -0) || turnsStr.startsWith('-');
            return calcRot(turns, deg, isNegTurn);
          }
        }

        // 2. Check for comma or semicolon separated e.g. "+1, 0", "1, 90", "-2, 45", "0, 90", "-0, 90"
        if (clean.includes(',') || clean.includes(';')) {
          const parts = clean.split(/[,;]/);
          const turnsStr = parts[0].trim();
          const degStr = parts.slice(1).join(',').trim();
          const turns = turnsStr ? parseFloat(turnsStr) : 0;
          const deg = degStr ? parseFloat(degStr) : 0;
          if (!isNaN(turns) && !isNaN(deg)) {
            const isNegTurn = turns < 0 || Object.is(turns, -0) || turnsStr.startsWith('-');
            return calcRot(turns, deg, isNegTurn);
          }
        }

        // 3. Check for two space-separated numbers e.g. "+1 90", "-2 45", "1 0"
        const spaceMatch = clean.match(/^([-+]?\d+)\s+([-+]?\d*\.?\d+)$/);
        if (spaceMatch) {
          const turnsStr = spaceMatch[1];
          const turns = parseFloat(turnsStr);
          const deg = parseFloat(spaceMatch[2]);
          if (!isNaN(turns) && !isNaN(deg)) {
            const isNegTurn = turns < 0 || Object.is(turns, -0) || turnsStr.startsWith('-');
            return calcRot(turns, deg, isNegTurn);
          }
        }

        // 4. Check for signed turn e.g. "+1", "+2", "-1", "-2" without degree symbol
        if (!hasDegreeSymbol) {
          const signedTurnMatch = clean.match(/^([+-]\d+)$/);
          if (signedTurnMatch) {
            const t = parseInt(signedTurnMatch[1], 10);
            if (Math.abs(t) <= 20) {
              return t * 360;
            }
          }
        }

        // 5. Single number or arithmetic expression e.g. "450", "90", "-180", "180+45", "360 * 2"
        return parseTransformNumericInput(clean);
      }

      function updateLayerScaleGeometry(layer, baseW, baseH) {
        layer._userResized = true;
        layer._userResizedManual = true;
        layer.normW = Math.abs(layer.scaleW) / baseW;
        layer.normH = Math.abs(layer.scaleH) / baseH;
        if (layer.type === 'shape' && layer.shapeProps) {
          const sx = Number(layer.shapeProps.sizeX) || 300;
          const sy = Number(layer.shapeProps.sizeY) || 300;
          layer.transformScaleX = layer.scaleW / sx;
          layer.transformScaleY = layer.scaleH / sy;
        } else if (layer.type === 'text') {
          const nat = (window.FishTextEngine && window.FishTextEngine.getNaturalSize)
            ? window.FishTextEngine.getNaturalSize(layer)
            : { width: 320, height: 100 };
          layer.transformScaleX = layer.scaleW / Math.max(1, nat.width);
          layer.transformScaleY = layer.scaleH / Math.max(1, nat.height);
        }
        const curPosX = layer.posX !== undefined ? layer.posX : baseW / 2;
        const curPosY = layer.posY !== undefined ? layer.posY : baseH / 2;
        layer.normX = (curPosX - layer.normW * baseW / 2) / baseW;
        layer.normY = (curPosY - layer.normH * baseH / 2) / baseH;
      }

      function getTransformReadoutSpan(prop) {
        if (prop === 'pos-x') return document.getElementById('val-pos-x');
        if (prop === 'pos-y') return document.getElementById('val-pos-y');
        if (prop === 'pos-z') return document.getElementById('val-pos-z');
        if (prop === 'scale-w') return document.getElementById('val-scale-w');
        if (prop === 'scale-h') return document.getElementById('val-scale-h');
        if (prop === 'scale-z') return document.getElementById('val-scale-z');
        if (prop === 'rotate-deg') return document.getElementById('val-rotate-deg') || document.getElementById('val-rotate-deg-z');
        if (prop === 'rotate-turns') return document.getElementById('val-rotate-turns') || document.getElementById('val-rotate-turns-z');
        if (prop === 'rotate-deg-z') return document.getElementById('val-rotate-deg-z');
        if (prop === 'rotate-turns-z') return document.getElementById('val-rotate-turns-z');
        if (prop === 'rotate-deg-x') return document.getElementById('val-rotate-deg-x');
        if (prop === 'rotate-turns-x') return document.getElementById('val-rotate-turns-x');
        if (prop === 'rotate-deg-y') return document.getElementById('val-rotate-deg-y');
        if (prop === 'rotate-turns-y') return document.getElementById('val-rotate-turns-y');
        if (prop === 'skew-x') return document.getElementById('val-skew-x');
        if (prop === 'skew-y') return document.getElementById('val-skew-y');
        return null;
      }

      const tabNavNext = {
        'pos-x': 'pos-y',
        'pos-y': 'pos-z',
        'pos-z': 'pos-x',
        'scale-w': 'scale-h',
        'scale-h': 'scale-z',
        'scale-z': 'scale-w',
        'rotate-turns': 'rotate-deg',
        'rotate-deg': 'rotate-turns',
        'rotate-deg-z': 'rotate-deg-x',
        'rotate-deg-x': 'rotate-deg-y',
        'rotate-deg-y': 'rotate-deg-z',
        'skew-x': 'skew-y',
        'skew-y': 'skew-x'
      };

      const tabNavPrev = {
        'pos-x': 'pos-z',
        'pos-y': 'pos-x',
        'pos-z': 'pos-y',
        'scale-w': 'scale-z',
        'scale-h': 'scale-w',
        'scale-z': 'scale-h',
        'rotate-turns': 'rotate-deg',
        'rotate-deg': 'rotate-turns',
        'rotate-deg-z': 'rotate-deg-y',
        'rotate-deg-y': 'rotate-deg-x',
        'rotate-deg-x': 'rotate-deg-z',
        'skew-x': 'skew-y',
        'skew-y': 'skew-x'
      };

      function startTransformInlineEdit(targetEl, propType) {
        if (!targetEl || targetEl.dataset.isEditing === 'true') return;
        const info = getSelectedLayerAndBaseDims();
        if (!info || !info.layer) return;
        const targetL = info.layer;
        const baseW = info.baseW;
        const baseH = info.baseH;

        // Check if property is driven by active expression
        const exprs = (targetL.expressions && typeof targetL.expressions === 'object') ? targetL.expressions : {};
        if (propType.startsWith('pos')) {
          if (exprs.move || (window.moveAnchorSubmode === 'anchor' && exprs.anchor)) return;
        } else if (propType.startsWith('scale')) {
          if (exprs.scale) return;
        } else if (propType.startsWith('rotate')) {
          if (exprs.rotate || exprs.rotation || exprs.rotZ) return;
        } else if (propType.startsWith('skew')) {
          if (exprs.skew) return;
        }

        const isAnchor = (window.moveAnchorSubmode === 'anchor');
        const isRotateTurns = (propType === 'rotate-turns' || propType === 'rotate-turns-z' || propType === 'rotate-turns-x' || propType === 'rotate-turns-y');
        const isRotateDeg = (propType === 'rotate-deg' || propType === 'rotate-deg-z' || propType === 'rotate-deg-x' || propType === 'rotate-deg-y');
        const isRotate = isRotateTurns || isRotateDeg;
        const targetRotateAxis = propType.endsWith('-x') ? 'x' : (propType.endsWith('-y') ? 'y' : (propType.endsWith('-z') ? 'z' : currentRotateAxis));
        let currentVal = 0;
        let initialStr = '';

        if (propType === 'pos-x') {
          currentVal = isAnchor ? (targetL.anchorX || 0) : (targetL.posX !== undefined ? targetL.posX : ((targetL.normX !== undefined ? targetL.normX + targetL.normW / 2 : 0.5) * baseW));
        } else if (propType === 'pos-y') {
          currentVal = isAnchor ? (targetL.anchorY || 0) : (targetL.posY !== undefined ? targetL.posY : ((targetL.normY !== undefined ? targetL.normY + targetL.normH / 2 : 0.5) * baseH));
        } else if (propType === 'pos-z') {
          currentVal = isAnchor ? (targetL.anchorZ || 0) : (targetL.posZ || 0);
        } else if (propType === 'scale-w') {
          currentVal = targetL.scaleW !== undefined ? targetL.scaleW : (targetL.normW !== undefined ? targetL.normW * baseW : baseW);
        } else if (propType === 'scale-h') {
          currentVal = targetL.scaleH !== undefined ? targetL.scaleH : (targetL.normH !== undefined ? targetL.normH * baseH : baseH);
        } else if (propType === 'scale-z') {
          currentVal = targetL.scaleZ !== undefined ? targetL.scaleZ : Math.round(Math.min(Math.abs(targetL.scaleW || baseW), Math.abs(targetL.scaleH || baseH)));
        } else if (isRotateTurns) {
          let curRot = 0;
          if (targetRotateAxis === 'x') curRot = targetL.rotX || 0;
          else if (targetRotateAxis === 'y') curRot = targetL.rotY || 0;
          else curRot = targetL.rotZ !== undefined ? targetL.rotZ : (targetL.rotation || 0);
          const turns = Math.trunc(curRot / 360);
          initialStr = turns > 0 ? `+${turns}` : `${turns}`;
        } else if (isRotateDeg) {
          let curRot = 0;
          if (targetRotateAxis === 'x') curRot = targetL.rotX || 0;
          else if (targetRotateAxis === 'y') curRot = targetL.rotY || 0;
          else curRot = targetL.rotZ !== undefined ? targetL.rotZ : (targetL.rotation || 0);
          const remRaw = curRot % 360;
          const rem = Math.abs(remRaw - Math.round(remRaw)) < 0.001 ? Math.round(remRaw) : Number(remRaw.toFixed(1));
          initialStr = `${rem}°`;
        } else if (propType === 'skew-x') {
          currentVal = targetL.skewX || 0;
        } else if (propType === 'skew-y') {
          currentVal = targetL.skewY || 0;
        }

        if (!isRotate) {
          initialStr = (Math.abs(currentVal - Math.round(currentVal)) < 0.001)
            ? Math.round(currentVal).toString()
            : Number(currentVal.toFixed(1)).toString();
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.size = 1;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.className = 'transform-inline-input';
        if (isRotate) input.classList.add('is-rotate');
        if (isRotateTurns) input.classList.add('is-rotate-turns');
        input.value = initialStr;
        input.setAttribute('aria-label', `Edit ${propType}`);
        input.setAttribute('inputmode', isRotateTurns ? 'numeric' : (isRotateDeg ? 'text' : 'decimal'));
        input.setAttribute('enterkeyhint', 'done');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');

        const targetComputed = window.getComputedStyle(targetEl);
        input.style.setProperty('font-size', targetComputed.fontSize, 'important');
        input.style.setProperty('font-family', targetComputed.fontFamily, 'important');
        input.style.setProperty('font-weight', targetComputed.fontWeight, 'important');
        input.style.setProperty('line-height', targetComputed.lineHeight, 'important');
        input.style.setProperty('letter-spacing', targetComputed.letterSpacing, 'important');
        input.style.setProperty('color', targetComputed.color, 'important');
        input.style.setProperty('text-align', 'center', 'important');
        input.style.setProperty('caret-color', targetComputed.color, 'important');
        input.style.border = 'none';
        input.style.outline = 'none';
        input.style.background = 'transparent';
        input.style.padding = '0';
        input.style.margin = '0';
        if (isRotateTurns) {
          input.style.marginBottom = '3px';
        }
        input.style.boxShadow = 'none';
        input.style.width = '100%';
        input.style.minWidth = '0';
        input.style.maxWidth = '100%';
        input.style.boxSizing = 'border-box';

        targetEl.dataset.isEditing = 'true';
        targetEl.style.display = 'none';

        targetEl.parentNode.insertBefore(input, targetEl.nextSibling);

        input.focus();
        try {
          input.setSelectionRange(0, input.value.length);
        } catch (_) {
          input.select();
        }

        try {
          input.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        } catch (_) {}

        let isDone = false;

        function cleanup() {
          document.removeEventListener('pointerdown', onOutsidePointerDown, true);
          document.removeEventListener('touchstart', onOutsidePointerDown, true);
          if (input.parentNode) {
            input.parentNode.removeChild(input);
          }
          targetEl.style.display = '';
          delete targetEl.dataset.isEditing;
        }

        const onOutsidePointerDown = (e) => {
          if (isDone) return;
          if (e.target === input || (input.contains && input.contains(e.target))) return;
          commit();
        };

        setTimeout(() => {
          if (!isDone) {
            document.addEventListener('pointerdown', onOutsidePointerDown, true);
            document.addEventListener('touchstart', onOutsidePointerDown, true);
          }
        }, 0);

        function commit() {
          if (isDone) return;
          isDone = true;

          const rawStr = input.value.trim();

          let curRot = 0;
          if (isRotate) {
            if (targetRotateAxis === 'x') curRot = targetL.rotX || 0;
            else if (targetRotateAxis === 'y') curRot = targetL.rotY || 0;
            else curRot = targetL.rotZ !== undefined ? targetL.rotZ : (targetL.rotation || 0);
          }

          let val = NaN;
          if (isRotateTurns) {
            const cleanStr = rawStr.replace(/[xX°deg\b(turns?|rot|putaran)\b]/gi, '').trim();
            const parsedTurns = cleanStr === '' ? 0 : parseInt(cleanStr, 10);
            const newTurns = isNaN(parsedTurns) ? 0 : parsedTurns;
            const curRemRaw = curRot % 360;
            if (newTurns === 0) {
              val = curRemRaw;
            } else if (newTurns > 0) {
              val = newTurns * 360 + Math.abs(curRemRaw);
            } else {
              val = newTurns * 360 - Math.abs(curRemRaw);
            }
          } else if (isRotateDeg) {
            const hasTurnSyntax = /[xX,;]|\b(turns?|rot|putaran)\b/.test(rawStr) || /\s+/.test(rawStr.replace(/^[+-]/, ''));
            if (hasTurnSyntax) {
              val = parseTransformRotationInput(rawStr);
            } else {
              const degVal = parseTransformNumericInput(rawStr);
              if (!isNaN(degVal)) {
                if (Math.abs(degVal) >= 360) {
                  val = degVal;
                } else {
                  const curTurns = Math.trunc(curRot / 360);
                  if (curTurns === 0) {
                    val = degVal;
                  } else if (curTurns > 0) {
                    val = curTurns * 360 + Math.abs(degVal);
                  } else {
                    val = curTurns * 360 - Math.abs(degVal);
                  }
                }
              }
            }
          } else {
            val = parseTransformNumericInput(rawStr);
          }

          if (isNaN(val)) {
            cleanup();
            if (isRotate) {
              updateRotateKnob(curRot);
              if (typeof updateDesktopRotateDials === 'function') updateDesktopRotateDials();
            }
            return;
          }

          syncLayerWithEffectiveProps(targetL);

          if (propType === 'pos-x') {
            if (isAnchor) {
              targetL.anchorX = Number(val.toFixed(2));
            } else {
              targetL.posX = Number(val.toFixed(2));
              const curScaleW = targetL.scaleW !== undefined ? targetL.scaleW : (targetL.normW !== undefined ? targetL.normW * baseW : baseW);
              targetL.normX = (targetL.posX - Math.abs(curScaleW) / 2) / baseW;
            }
            recordLayerPropertyChange(targetL, 'move');
          } else if (propType === 'pos-y') {
            if (isAnchor) {
              targetL.anchorY = Number(val.toFixed(2));
            } else {
              targetL.posY = Number(val.toFixed(2));
              const curScaleH = targetL.scaleH !== undefined ? targetL.scaleH : (targetL.normH !== undefined ? targetL.normH * baseH : baseH);
              targetL.normY = (targetL.posY - Math.abs(curScaleH) / 2) / baseH;
            }
            recordLayerPropertyChange(targetL, 'move');
          } else if (propType === 'pos-z') {
            if (isAnchor) {
              targetL.anchorZ = Number(val.toFixed(2));
            } else {
              targetL.posZ = Number(val.toFixed(2));
            }
            recordLayerPropertyChange(targetL, 'move');
          } else if (propType === 'scale-w') {
            const oldW = targetL.scaleW !== undefined ? targetL.scaleW : (targetL.normW !== undefined ? targetL.normW * baseW : baseW);
            const oldH = targetL.scaleH !== undefined ? targetL.scaleH : (targetL.normH !== undefined ? targetL.normH * baseH : baseH);
            const oldZ = targetL.scaleZ !== undefined ? targetL.scaleZ : Math.round(Math.min(Math.abs(oldW), Math.abs(oldH)));
            const newW = Math.max(1, Number(val.toFixed(1)));

            const singleJog = document.getElementById('jog-scale-linked');
            const isLinked = isScaleLinked && singleJog && singleJog.style.display !== 'none';

            targetL.scaleW = newW;
            if (isLinked) {
              const ratio = (oldH !== 0 && !isNaN(oldH)) ? (oldW / oldH) : 1;
              targetL.scaleH = Number((ratio !== 0 ? newW / ratio : newW).toFixed(1));
              if (targetL.scaleZ !== undefined && oldW !== 0) {
                const factor = Math.abs(newW) / Math.abs(oldW);
                targetL.scaleZ = Math.max(1, Math.round(oldZ * factor));
              }
            }
            updateLayerScaleGeometry(targetL, baseW, baseH);
            recordLayerPropertyChange(targetL, 'scale');
          } else if (propType === 'scale-h') {
            const oldW = targetL.scaleW !== undefined ? targetL.scaleW : (targetL.normW !== undefined ? targetL.normW * baseW : baseW);
            const oldH = targetL.scaleH !== undefined ? targetL.scaleH : (targetL.normH !== undefined ? targetL.normH * baseH : baseH);
            const newH = Math.max(1, Number(val.toFixed(1)));

            const singleJog = document.getElementById('jog-scale-linked');
            const isLinked = isScaleLinked && singleJog && singleJog.style.display !== 'none';

            targetL.scaleH = newH;
            if (isLinked) {
              const ratio = (oldH !== 0 && !isNaN(oldH)) ? (oldW / oldH) : 1;
              targetL.scaleW = Number((ratio !== 0 ? newH * ratio : newH).toFixed(1));
            }
            updateLayerScaleGeometry(targetL, baseW, baseH);
            recordLayerPropertyChange(targetL, 'scale');
          } else if (propType === 'scale-z') {
            targetL.scaleZ = Math.max(1, Math.round(val));
            recordLayerPropertyChange(targetL, 'scale');
          } else if (isRotate) {
            const newRot = (Math.abs(val - Math.round(val)) < 0.001) ? Math.round(val) : Number(val.toFixed(1));
            if (targetRotateAxis === 'x') {
              targetL.rotX = newRot;
            } else if (targetRotateAxis === 'y') {
              targetL.rotY = newRot;
            } else {
              targetL.rotZ = newRot;
              targetL.rotation = newRot;
            }
            if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
            recordLayerPropertyChange(targetL, 'rotate');
          } else if (propType === 'skew-x') {
            targetL.skewX = Number(val.toFixed(1));
            recordLayerPropertyChange(targetL, 'skew');
          } else if (propType === 'skew-y') {
            targetL.skewY = Number(val.toFixed(1));
            recordLayerPropertyChange(targetL, 'skew');
          }

          cleanup();

          if (isRotate) {
            let curRot = 0;
            if (targetRotateAxis === 'x') curRot = targetL.rotX || 0;
            else if (targetRotateAxis === 'y') curRot = targetL.rotY || 0;
            else curRot = targetL.rotZ !== undefined ? targetL.rotZ : (targetL.rotation || 0);
            updateRotateKnob(curRot);
            if (typeof updateDesktopRotateDials === 'function') updateDesktopRotateDials();
          }

          invalidatePreviewCacheForLayer(targetL);
          syncTransformControllerValues();
          redrawComposition();
          renderTimelineLayers();
          saveCurrentProjectLayers();
        }

        function cancel() {
          if (isDone) return;
          isDone = true;
          cleanup();
          if (isRotate) {
            let curRot = 0;
            if (targetRotateAxis === 'x') curRot = targetL.rotX || 0;
            else if (targetRotateAxis === 'y') curRot = targetL.rotY || 0;
            else curRot = targetL.rotZ !== undefined ? targetL.rotZ : (targetL.rotation || 0);
            updateRotateKnob(curRot);
            if (typeof updateDesktopRotateDials === 'function') updateDesktopRotateDials();
          }
        }

        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter' || e.keyCode === 13) {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape' || e.keyCode === 27) {
            e.preventDefault();
            cancel();
          } else if (e.key === 'Tab') {
            e.preventDefault();
            const nextProp = e.shiftKey ? tabNavPrev[propType] : tabNavNext[propType];
            commit();
            if (nextProp) {
              const nextEl = getTransformReadoutSpan(nextProp);
              if (nextEl && nextEl.offsetParent !== null && !nextEl.closest('[style*="display: none"]')) {
                setTimeout(() => {
                  startTransformInlineEdit(nextEl, nextProp);
                }, 20);
              }
            }
          }
        });

        input.addEventListener('blur', () => {
          commit();
        });

        input.addEventListener('pointerdown', (e) => e.stopPropagation());
        input.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('click', (e) => e.stopPropagation());
      }
      window.startTransformInlineEdit = startTransformInlineEdit;

      function bindTransformInlineEditing() {
        // Prevent move pad pointerdown/touchstart drag when clicking transform values header
        const movePadHeader = document.querySelector('#pad-transform-move .transform-values-header');
        if (movePadHeader) {
          movePadHeader.addEventListener('pointerdown', (e) => e.stopPropagation());
          movePadHeader.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
          movePadHeader.addEventListener('mousedown', (e) => e.stopPropagation());
        }

        function bindCardTap(el, readoutSpan, prop) {
          if (!el || !readoutSpan) return;
          el.addEventListener('pointerdown', (e) => e.stopPropagation());
          el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
          el.addEventListener('mousedown', (e) => e.stopPropagation());
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            startTransformInlineEdit(readoutSpan, prop);
          });
        }

        // Position X & Y groups
        const posGroups = document.querySelectorAll('#pane-transform-move .transform-val-group');
        if (posGroups.length >= 2) {
          bindCardTap(posGroups[0], document.getElementById('val-pos-x'), 'pos-x');
          bindCardTap(posGroups[1], document.getElementById('val-pos-y'), 'pos-y');
        }

        // Position Z card
        const valPosZ = document.getElementById('val-pos-z');
        if (valPosZ) {
          bindCardTap(valPosZ.closest('.transform-val-card'), valPosZ, 'pos-z');
        }

        // Rotate Center Badge
        const rotateCenterBadge = document.querySelector('#pane-transform-rotate .rotate-center-badge');
        if (rotateCenterBadge) {
          bindCardTap(rotateCenterBadge, document.getElementById('val-rotate-deg'), 'rotate-deg');
        }

        // Rotate Readouts (Desktop Z, X, Y)
        const readoutRotZ = document.getElementById('readout-rotate-z');
        if (readoutRotZ) {
          bindCardTap(readoutRotZ, document.getElementById('val-rotate-deg-z'), 'rotate-deg-z');
        }
        const readoutRotX = document.getElementById('readout-rotate-x');
        if (readoutRotX) {
          bindCardTap(readoutRotX, document.getElementById('val-rotate-deg-x'), 'rotate-deg-x');
        }
        const readoutRotY = document.getElementById('readout-rotate-y');
        if (readoutRotY) {
          bindCardTap(readoutRotY, document.getElementById('val-rotate-deg-y'), 'rotate-deg-y');
        }

        // Scale Width card
        const valScaleW = document.getElementById('val-scale-w');
        if (valScaleW) {
          bindCardTap(valScaleW.closest('.transform-val-card'), valScaleW, 'scale-w');
        }

        // Scale Height card
        const valScaleH = document.getElementById('val-scale-h');
        if (valScaleH) {
          bindCardTap(valScaleH.closest('.transform-val-card'), valScaleH, 'scale-h');
        }

        // Scale Depth (Z) card
        const cardScaleZ = document.getElementById('card-scale-z');
        const valScaleZ = document.getElementById('val-scale-z');
        if (cardScaleZ && valScaleZ) {
          bindCardTap(cardScaleZ, valScaleZ, 'scale-z');
        }

        // Skew X card
        const valSkewX = document.getElementById('val-skew-x');
        if (valSkewX) {
          bindCardTap(valSkewX.closest('.transform-val-card'), valSkewX, 'skew-x');
        }

        // Skew Y card
        const valSkewY = document.getElementById('val-skew-y');
        if (valSkewY) {
          bindCardTap(valSkewY.closest('.transform-val-card'), valSkewY, 'skew-y');
        }

        // Direct span click listeners
        const propMap = [
          { id: 'val-pos-x', prop: 'pos-x' },
          { id: 'val-pos-y', prop: 'pos-y' },
          { id: 'val-pos-z', prop: 'pos-z' },
          { id: 'val-scale-w', prop: 'scale-w' },
          { id: 'val-scale-h', prop: 'scale-h' },
          { id: 'val-scale-z', prop: 'scale-z' },
          { id: 'val-rotate-deg', prop: 'rotate-deg' },
          { id: 'val-rotate-turns', prop: 'rotate-turns' },
          { id: 'val-rotate-deg-z', prop: 'rotate-deg-z' },
          { id: 'val-rotate-turns-z', prop: 'rotate-turns-z' },
          { id: 'val-rotate-deg-x', prop: 'rotate-deg-x' },
          { id: 'val-rotate-turns-x', prop: 'rotate-turns-x' },
          { id: 'val-rotate-deg-y', prop: 'rotate-deg-y' },
          { id: 'val-rotate-turns-y', prop: 'rotate-turns-y' },
          { id: 'val-skew-x', prop: 'skew-x' },
          { id: 'val-skew-y', prop: 'skew-y' }
        ];

        propMap.forEach(({ id, prop }) => {
          const el = document.getElementById(id);
          if (el) {
            el.addEventListener('pointerdown', (e) => e.stopPropagation());
            el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
            el.addEventListener('mousedown', (e) => e.stopPropagation());
            el.addEventListener('click', (e) => {
              e.stopPropagation();
              startTransformInlineEdit(el, prop);
            });
          }
        });
      }

      bindTransformInlineEditing();

      // J. Popstate support for native back navigation
      window.addEventListener('popstate', (e) => {
        if (window.Popover && typeof window.Popover.getAwaitedPopstate === 'function' && window.Popover.getAwaitedPopstate() > 0) {
          return;
        }
        if (window._popoverClosingHistoryBack) {
          return;
        }
        if (window._isPrecompPoppingHistory) {
          window._isPrecompPoppingHistory = false;
          return;
        }
        if (e.state && (e.state.popoverOpen || e.state.modalOpen)) return;
        if (window.Popover && typeof window.Popover.isOpen === 'function' && window.Popover.isOpen()) {
          window.Popover.close(false);
          return;
        }
        if (e.state && e.state.drawerSubview && e.state.drawerSubview === currentDrawerSubview) {
          return;
        }
        if (currentDrawerSubview === 'graph') {
          switchLayerDrawerSubview(window.previousDrawerSubview || 'transform');
        } else if (document.getElementById('drawer-effects-gallery') && document.getElementById('drawer-effects-gallery').classList.contains('is-active')) {
          const iv = document.getElementById('effects-items-view');
          if (iv && iv.style.display !== 'none' && typeof window.closeGalleryCategory === 'function') {
            window.closeGalleryCategory();
          } else {
            closeEffectsGalleryDrawer(false);
          }
        } else if (currentDrawerSubview === 'effects-gallery') {
          const iv = document.getElementById('effects-items-view');
          if (iv && iv.style.display !== 'none' && typeof window.closeGalleryCategory === 'function') {
            window.closeGalleryCategory();
          } else {
            switchLayerDrawerSubview('effects');
          }
        } else if (currentDrawerSubview === 'transform' || currentDrawerSubview === 'blend' || currentDrawerSubview === 'effects' || currentDrawerSubview === 'camera' || currentDrawerSubview === 'fill' || currentDrawerSubview === 'volume' || currentDrawerSubview === 'speed' || currentDrawerSubview === 'shape' || currentDrawerSubview === 'text' || currentDrawerSubview === 'beatmark') {
          switchLayerDrawerSubview('main');
        } else if (compositionStack && compositionStack.length > 0) {
          window._precompHistoryPushed = Math.max(0, (window._precompHistoryPushed || 1) - 1);
          if (typeof exitPrecompose === 'function') {
            exitPrecompose(true);
          }
        }
      });
    })();

    function syncBlendOverlayValues() {
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer) return;

      const pps = window.currentPixelsPerSecond || 80;
      const currentSec = Math.abs(window.timelinePanX || 0) / pps;
      const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
        ? getLayerEffectivePropsAtTime(layer, currentSec)
        : { opacity: layer.opacity !== undefined ? layer.opacity : 1.0 };

      const opacity = Math.max(0, Math.min(1, effProps.opacity !== undefined ? effProps.opacity : 1.0));
      const pct = Math.round(opacity * 100);

      const badgeEl = document.getElementById('blend-opacity-badge');
      const jogOpacity = document.getElementById('jog-blend-opacity');
      const containerEl = document.getElementById('blend-slider-container');
      const fillEl = document.getElementById('blend-slider-fill');
      const thumbEl = document.getElementById('blend-slider-thumb');

      if (badgeEl) badgeEl.textContent = pct + '%';
      if (jogOpacity) {
        jogOpacity.setAttribute('aria-valuenow', pct);
        updateJogScrubberVisuals(jogOpacity, pct, 0, 100);
      }
      if (containerEl) containerEl.setAttribute('aria-valuenow', pct);
      if (fillEl) fillEl.style.width = pct + '%';
      if (thumbEl) thumbEl.style.left = pct + '%';

      // Sync Blend Mode Selection & Statuses
      const currentMode = layer.blendMode || 'normal';
      const normalCard = document.getElementById('blend-card-normal');
      const normalStatus = document.getElementById('blend-status-normal');

      if (normalStatus) {
        normalStatus.style.display = (currentMode === 'normal' || !layer.blendMode) ? '' : 'none';
      }
      if (normalCard) {
        normalCard.classList.toggle('is-selected-group', currentMode === 'normal' || !layer.blendMode);
      }

      // Check all accordion items and mask tiles
      const allItemBtns = document.querySelectorAll('#layer-drawer-blend-view .blend-item-btn, #layer-drawer-blend-view .blend-mask-tile');
      allItemBtns.forEach(btn => {
        const bMode = btn.dataset.blend;
        const isMatch = bMode === currentMode || (currentMode === 'mask' && bMode === 'destination-in') || (currentMode === 'exclude' && bMode === 'destination-out');
        btn.classList.toggle('is-selected', isMatch);
      });

      // Update accordion card headers
      const groupCards = document.querySelectorAll('#layer-drawer-blend-view .blend-group-card:not(#blend-card-normal)');
      groupCards.forEach(card => {
        const activeBtn = card.querySelector(`.blend-item-btn[data-blend="${currentMode}"], .blend-mask-tile[data-blend="${currentMode}"]`) ||
                          (currentMode === 'mask' ? card.querySelector(`.blend-mask-tile[data-blend="destination-in"]`) : null) ||
                          (currentMode === 'exclude' ? card.querySelector(`.blend-mask-tile[data-blend="destination-out"]`) : null);
        const statusSpan = card.querySelector('.blend-group-status');
        if (activeBtn) {
          card.classList.add('is-selected-group');
          if (statusSpan) {
            statusSpan.style.display = '';
            statusSpan.innerHTML = `${activeBtn.dataset.modeName || activeBtn.textContent.trim()} <svg class="blend-check-badge" viewBox="0 0 20 20" width="16" height="16"><circle cx="10" cy="10" r="10" fill="var(--color-primary)"/><path d="M6 10.2l2.6 2.6L14.2 7" fill="none" stroke="var(--bg-canvas)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
          }
        } else {
          card.classList.remove('is-selected-group');
          if (statusSpan) {
            statusSpan.style.display = 'none';
            statusSpan.textContent = '';
          }
        }
      });
    }
    window.syncBlendOverlayValues = syncBlendOverlayValues;

    function updateBlendKeyframeBtnState() {
      const btn = document.getElementById('btn-blend-keyframe');
      const btnGraph = document.getElementById('btn-blend-graph');
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
      const kf = (typeof getKeyframeAtTime === 'function') ? getKeyframeAtTime(layer, 'opacity', currentSec) : null;
      if (btn) btn.classList.toggle('is-active', !!kf);
      if (btnGraph) {
        const kfList = (layer && layer.keyframes && layer.keyframes.opacity) || [];
        const canOpen = kfList.length >= 2;
        btnGraph.disabled = !canOpen;
        btnGraph.classList.toggle('is-disabled', !canOpen);
      }
    }
    window.updateBlendKeyframeBtnState = updateBlendKeyframeBtnState;

    (function initBlendOverlayController() {
      // 1. Open Blend view from Layer Action Button
      const btnLayerBlend = document.getElementById('btn-layer-blend');
      if (btnLayerBlend) {
        btnLayerBlend.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('blend');
        });
      }

      // 2. Back button: Blend -> Main Layer Actions
      const btnBlendBack = document.getElementById('btn-blend-back');
      if (btnBlendBack) {
        btnBlendBack.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('main');
        });
      }

      // 3. Keyframe button: Add / Remove Keyframe for Opacity
      const btnBlendKeyframe = document.getElementById('btn-blend-keyframe');
      if (btnBlendKeyframe) {
        btnBlendKeyframe.addEventListener('click', (e) => {
          e.stopPropagation();
          window.activeKeyframeProperty = 'opacity';
          toggleKeyframeAtCurrentTime();
          updateBlendKeyframeBtnState();
        });
      }

      // 4. Graph button: Blend -> Graph Editor
      const btnBlendGraph = document.getElementById('btn-blend-graph');
      if (btnBlendGraph) {
        btnBlendGraph.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          const kfList = (layer && layer.keyframes && layer.keyframes.opacity) || [];
          if (kfList.length < 2) return;
          window.activeKeyframeProperty = 'opacity';
          window.previousDrawerSubview = 'blend';
          switchLayerDrawerSubview('graph');
        });
      }

      // 5. Opacity Scrubber Drag Interaction (Effects Parameter Ruler Format)
      const jogBlendOpacity = document.getElementById('jog-blend-opacity');
      const opacityBadge = document.getElementById('blend-opacity-badge');
      let initOpacityPct = 100;
      let lastOpacityPct = 100;

      function applyOpacityValue(pct, commit = false) {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!layer) return;
        const boundedPct = Math.max(0, Math.min(100, Math.round(pct)));
        lastOpacityPct = boundedPct;
        layer.opacity = Number((boundedPct / 100).toFixed(2));

        if (opacityBadge) opacityBadge.textContent = boundedPct + '%';
        const fillEl = document.getElementById('blend-slider-fill');
        const thumbEl = document.getElementById('blend-slider-thumb');
        const containerEl = document.getElementById('blend-slider-container');
        if (containerEl) containerEl.setAttribute('aria-valuenow', boundedPct);
        if (fillEl) fillEl.style.width = boundedPct + '%';
        if (thumbEl) thumbEl.style.left = boundedPct + '%';
        if (jogBlendOpacity) {
          jogBlendOpacity.setAttribute('aria-valuenow', boundedPct);
          updateJogScrubberVisuals(jogBlendOpacity, boundedPct, 0, 100);
        }

        invalidatePreviewCacheForLayer(layer);
        updateBlendKeyframeBtnState();

        if (commit) {
          if (typeof recordLayerPropertyChange === 'function') {
            recordLayerPropertyChange(layer, 'opacity');
          }
          if (typeof saveCurrentProjectLayers === 'function') {
            saveCurrentProjectLayers();
          }
          redrawComposition();
        } else {
          if (!window._blendRedrawRafPending) {
            window._blendRedrawRafPending = true;
            requestAnimationFrame(() => {
              window._blendRedrawRafPending = false;
              redrawComposition('blend-opacity-scrub');
            });
          }
        }
      }

      // Slider Fill Pointer & Keyboard Interaction
      const blendSliderContainer = document.getElementById('blend-slider-container');
      if (blendSliderContainer) {
        function updateOpacityFromPointer(e) {
          const rect = blendSliderContainer.getBoundingClientRect();
          if (!rect.width) return;
          const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
          const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          const newPct = Math.round(ratio * 100);
          applyOpacityValue(newPct, false);
        }

        blendSliderContainer.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          try { blendSliderContainer.setPointerCapture(e.pointerId); } catch (_) {}

          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            window.isTransformInteracting = true;
            syncLayerWithEffectiveProps(layer);
            invalidatePreviewCacheForLayer(layer);
          }

          updateOpacityFromPointer(e);

          function onPointerMove(ev) {
            updateOpacityFromPointer(ev);
          }

          function onPointerUp(ev) {
            try { blendSliderContainer.releasePointerCapture(ev.pointerId); } catch (_) {}
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
            window.isTransformInteracting = false;
            applyOpacityValue(lastOpacityPct, true);
          }

          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerUp);
        });

        blendSliderContainer.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            applyOpacityValue(lastOpacityPct - step, true);
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            applyOpacityValue(lastOpacityPct + step, true);
          }
        });
      }

      if (jogBlendOpacity) {
        bindJogWheel(jogBlendOpacity, {
          onStart: () => {
            const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
            if (!layer) return;
            window.isTransformInteracting = true;
            syncLayerWithEffectiveProps(layer);
            invalidatePreviewCacheForLayer(layer);
            initOpacityPct = Math.round((layer.opacity !== undefined ? layer.opacity : 1.0) * 100);
            lastOpacityPct = initOpacityPct;
          },
          onMove: (delta) => {
            const newPct = Math.max(0, Math.min(100, Math.round(initOpacityPct + delta * 0.4)));
            applyOpacityValue(newPct, false);
          },
          onEnd: () => {
            window.isTransformInteracting = false;
            applyOpacityValue(lastOpacityPct, true);
          }
        });
      }

      if (opacityBadge) {
        opacityBadge.style.cursor = 'pointer';
        opacityBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          const currentPct = Math.round((layer.opacity !== undefined ? layer.opacity : 1.0) * 100);
          if (typeof window.openValueInputPopover === 'function') {
            window.openValueInputPopover(opacityBadge, {
              title: 'Opacity',
              value: currentPct,
              unit: '%',
              min: 0,
              max: 100,
              onCommit: (val) => {
                applyOpacityValue(val, true);
              }
            });
          }
        });
      }

      // 6. Blend Mode Selection & Accordion Logic
      const blendCardNormal = document.getElementById('blend-card-normal');
      if (blendCardNormal) {
        blendCardNormal.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;

          layer.blendMode = 'normal';

          // Invalidate frame preview cache
          invalidatePreviewCacheForLayer(layer);

          syncBlendOverlayValues();
          if (typeof redrawComposition === 'function') redrawComposition('blend-mode-normal');
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
        });
      }

      // Accordion Headers Expand / Collapse
      const accordionHeaders = document.querySelectorAll('#layer-drawer-blend-view .blend-group-header[data-accordion]');
      accordionHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
          e.stopPropagation();
          const card = header.closest('.blend-group-card');
          if (!card) return;

          const isExpanded = card.classList.contains('is-expanded');

          // Collapse other accordion cards for clean single-focus accordion
          document.querySelectorAll('#layer-drawer-blend-view .blend-group-card').forEach(c => {
            if (c !== card) c.classList.remove('is-expanded');
          });

          card.classList.toggle('is-expanded', !isExpanded);
        });
      });

      // Individual Blend Mode Item & Mask Tile Selection
      const blendItemBtns = document.querySelectorAll('#layer-drawer-blend-view .blend-item-btn, #layer-drawer-blend-view .blend-mask-tile');
      blendItemBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const mode = btn.dataset.blend;
          if (!mode) return;

          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;

          // Toggle back to normal if already selected mask tile
          if (btn.classList.contains('blend-mask-tile') && (layer.blendMode === mode || (mode === 'destination-in' && layer.blendMode === 'mask') || (mode === 'destination-out' && layer.blendMode === 'exclude'))) {
            layer.blendMode = 'normal';
          } else {
            layer.blendMode = mode;
          }

          // Invalidate frame preview cache
          invalidatePreviewCacheForLayer(layer);

          syncBlendOverlayValues();
          if (typeof redrawComposition === 'function') redrawComposition('blend-mode-change');
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
        });
      });
    })();

    /* ==========================================================================
       VOLUME CONTROLLER (MODULAR & KEYFRAME CAPABLE)
       ========================================================================== */
    function syncVolumeControllerValues() {
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer) return;

      const pps = window.currentPixelsPerSecond || 80;
      const currentSec = Math.abs(window.timelinePanX || 0) / pps;
      const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
        ? getLayerEffectivePropsAtTime(layer, currentSec)
        : { volume: layer.volume !== undefined ? layer.volume : 1.0 };

      const vol = Math.max(0, Math.min(1, effProps.volume !== undefined ? effProps.volume : (layer.volume !== undefined ? layer.volume : 1.0)));
      const pct = Math.round(vol * 100);

      const badgeEl = document.getElementById('volume-slider-badge');
      const jogVol = document.getElementById('jog-layer-volume');
      const containerEl = document.getElementById('volume-slider-container');
      const fillEl = document.getElementById('volume-slider-fill');
      const thumbEl = document.getElementById('volume-slider-thumb');

      if (badgeEl) badgeEl.textContent = pct + '%';
      if (jogVol) {
        jogVol.setAttribute('aria-valuenow', pct);
        updateJogScrubberVisuals(jogVol, pct, 0, 100);
      }
      if (containerEl) containerEl.setAttribute('aria-valuenow', pct);
      if (fillEl) fillEl.style.width = pct + '%';
      if (thumbEl) thumbEl.style.left = pct + '%';
      if (typeof updateVolumeAndSpeedBtnState === 'function') {
        updateVolumeAndSpeedBtnState(layer);
      }
    }
    window.syncVolumeControllerValues = syncVolumeControllerValues;

    function updateVolumeKeyframeBtnState() {
      const btn = document.getElementById('btn-volume-keyframe');
      const btnGraph = document.getElementById('btn-volume-graph');
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
      const kf = (typeof getKeyframeAtTime === 'function') ? getKeyframeAtTime(layer, 'volume', currentSec) : null;
      if (btn) btn.classList.toggle('is-active', !!kf);
      if (btnGraph) {
        const kfList = (layer && layer.keyframes && layer.keyframes.volume) || [];
        const canOpen = kfList.length >= 2;
        btnGraph.disabled = !canOpen;
        btnGraph.classList.toggle('is-disabled', !canOpen);
      }
    }
    window.updateVolumeKeyframeBtnState = updateVolumeKeyframeBtnState;

    (function initVolumeController() {
      // 1. Open Volume view from Cut Operations Bar button
      const btnLayerVolume = document.getElementById('btn-layer-volume');
      if (btnLayerVolume) {
        btnLayerVolume.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btnLayerVolume.disabled || btnLayerVolume.classList.contains('is-disabled')) return;
          switchLayerDrawerSubview('volume');
        });
      }

      // Open Speed view from Cut Operations Bar button
      const btnLayerSpeed = document.getElementById('btn-layer-speed');
      if (btnLayerSpeed) {
        btnLayerSpeed.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btnLayerSpeed.disabled || btnLayerSpeed.classList.contains('is-disabled')) return;
          switchLayerDrawerSubview('speed');
        });
      }

      // 2. Back button: Volume -> Main Layer Actions
      const btnVolumeBack = document.getElementById('btn-volume-back');
      if (btnVolumeBack) {
        btnVolumeBack.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('main');
        });
      }

      // 3. Keyframe button: Add / Remove Keyframe for Volume
      const btnVolumeKeyframe = document.getElementById('btn-volume-keyframe');
      if (btnVolumeKeyframe) {
        btnVolumeKeyframe.addEventListener('click', (e) => {
          e.stopPropagation();
          window.activeKeyframeProperty = 'volume';
          toggleKeyframeAtCurrentTime();
          updateVolumeKeyframeBtnState();
        });
      }

      // 4. Graph button: Volume -> Graph Editor
      const btnVolumeGraph = document.getElementById('btn-volume-graph');
      if (btnVolumeGraph) {
        btnVolumeGraph.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          const kfList = (layer && layer.keyframes && layer.keyframes.volume) || [];
          if (kfList.length < 2) return;
          window.activeKeyframeProperty = 'volume';
          window.previousDrawerSubview = 'volume';
          switchLayerDrawerSubview('graph');
        });
      }

      // 5. Volume Jog Scrubber & Direct Value Interaction
      const jogLayerVolume = document.getElementById('jog-layer-volume');
      const volumeBadge = document.getElementById('volume-slider-badge');
      const sliderContainer = document.getElementById('volume-slider-container');
      const sliderFill = document.getElementById('volume-slider-fill');
      const sliderThumb = document.getElementById('volume-slider-thumb');

      let initVolPct = 100;
      let lastVolPct = 100;

      function applyVolumeValue(val, commit = true) {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!layer) return;

        let normalizedVal;
        if (typeof val === 'number') {
          normalizedVal = val > 1 ? val / 100 : val;
        } else {
          normalizedVal = 1;
        }
        const roundedVal = Number(Math.max(0, Math.min(1, normalizedVal)).toFixed(2));
        const pct = Math.round(roundedVal * 100);
        lastVolPct = pct;

        if (sliderFill) sliderFill.style.width = pct + '%';
        if (sliderThumb) sliderThumb.style.left = pct + '%';
        if (volumeBadge) volumeBadge.textContent = pct + '%';
        if (sliderContainer) sliderContainer.setAttribute('aria-valuenow', pct);
        if (jogLayerVolume) {
          jogLayerVolume.setAttribute('aria-valuenow', pct);
          updateJogScrubberVisuals(jogLayerVolume, pct, 0, 100);
        }

        layer.volume = roundedVal;

        // Live audio gain sync
        if (window.FishAudioEngine) {
          if (layer.type === 'video' || layer.type === 'audio') {
            const media = window.getOrLoadLayerMedia ? window.getOrLoadLayerMedia(layer) : null;
            if (media && media.el) {
              window.FishAudioEngine.setElementGain(media.el, roundedVal);
            }
          } else if (layer.type === 'precomp') {
            const pps = window.currentPixelsPerSecond || 80;
            const currentSec = Math.abs(window.timelinePanX || 0) / pps;
            window.FishAudioEngine.syncPlayback(currentProjectState.layers || [], currentSec, pps);
          }
        }

        invalidatePreviewCacheForLayer(layer);
        updateVolumeKeyframeBtnState();
        if (typeof updateVolumeAndSpeedBtnState === 'function') {
          updateVolumeAndSpeedBtnState(layer);
        }

        if (commit) {
          if (typeof recordLayerPropertyChange === 'function') {
            recordLayerPropertyChange(layer, 'volume');
          }
          if (typeof saveCurrentProjectLayers === 'function') {
            saveCurrentProjectLayers(true);
          }
        }
      }
      window.applyVolumeValue = applyVolumeValue;

      if (jogLayerVolume) {
        bindJogWheel(jogLayerVolume, {
          onStart: () => {
            const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
            if (!layer) return;
            window.isTransformInteracting = true;
            syncLayerWithEffectiveProps(layer);
            invalidatePreviewCacheForLayer(layer);
            initVolPct = Math.round((layer.volume !== undefined ? layer.volume : 1.0) * 100);
            lastVolPct = initVolPct;
          },
          onMove: (delta) => {
            const newPct = Math.max(0, Math.min(100, Math.round(initVolPct + delta * 0.4)));
            applyVolumeValue(newPct / 100, false);
          },
          onEnd: () => {
            window.isTransformInteracting = false;
            applyVolumeValue(lastVolPct / 100, true);
          }
        });
      }

      if (volumeBadge) {
        volumeBadge.style.cursor = 'pointer';
        volumeBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          const currentPct = Math.round((layer.volume !== undefined ? layer.volume : 1.0) * 100);
          if (typeof window.openValueInputPopover === 'function') {
            window.openValueInputPopover(volumeBadge, {
              title: 'Volume',
              value: currentPct,
              unit: '%',
              min: 0,
              max: 100,
              onCommit: (val) => {
                applyVolumeValue(val / 100, true);
              }
            });
          }
        });
      }

      if (sliderContainer && sliderContainer !== jogLayerVolume) {
        function updateVolumeFromPointer(e) {
          const rect = sliderContainer.getBoundingClientRect();
          if (!rect.width) return;
          const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
          const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          applyVolumeValue(ratio, false);
        }

        sliderContainer.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          try { sliderContainer.setPointerCapture(e.pointerId); } catch (_) {}

          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            window.isTransformInteracting = true;
            syncLayerWithEffectiveProps(layer);
            invalidatePreviewCacheForLayer(layer);
          }

          updateVolumeFromPointer(e);

          function onPointerMove(ev) {
            updateVolumeFromPointer(ev);
          }

          function onPointerUp(ev) {
            try { sliderContainer.releasePointerCapture(ev.pointerId); } catch (_) {}
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
            window.isTransformInteracting = false;
            applyVolumeValue(lastVolPct / 100, true);
          }

          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerUp);
        });
      }

      // 6. Audio Effects Rack: Add Effect button & Popover actions
      const btnAddAudioFx = document.getElementById('btn-add-audio-fx');
      if (btnAddAudioFx) {
        btnAddAudioFx.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.Popover) {
            window.Popover.open(btnAddAudioFx, 'popover-audio-fx-menu');
          }
        });
      }

      const btnAddReverb = document.getElementById('popover-btn-add-reverb');
      if (btnAddReverb) {
        btnAddReverb.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.Popover) window.Popover.close();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          layer.audioEffects = layer.audioEffects || [];
          layer.audioEffects.push({
            id: 'fx_rev_' + Math.random().toString(36).substring(2, 9),
            type: 'reverb',
            name: 'Reverb',
            disabled: false,
            decay: 1.5,
            mix: 0.4
          });
          renderAudioEffectsRack(layer);
          syncLayerAudioEffects(layer);
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
        });
      }

      const btnAddDelay = document.getElementById('popover-btn-add-delay');
      if (btnAddDelay) {
        btnAddDelay.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.Popover) window.Popover.close();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          layer.audioEffects = layer.audioEffects || [];
          layer.audioEffects.push({
            id: 'fx_del_' + Math.random().toString(36).substring(2, 9),
            type: 'delay',
            name: 'Delay',
            disabled: false,
            time: 0.3,
            feedback: 0.3,
            mix: 0.35
          });
          renderAudioEffectsRack(layer);
          syncLayerAudioEffects(layer);
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
        });
      }
    })();

    function syncLayerAudioEffects(layer) {
      if (!layer || (layer.type !== 'video' && layer.type !== 'audio')) return;
      if (window.FishAudioEngine) {
        const media = window.getOrLoadLayerMedia ? window.getOrLoadLayerMedia(layer) : null;
        if (media && media.el) {
          window.FishAudioEngine.applyAudioEffects(media.el, layer.audioEffects);
        }
      }
    }
    window.syncLayerAudioEffects = syncLayerAudioEffects;

    function createAudioFxParamRow(label, min, max, step, currentVal, formatFn, onInput) {
      const row = document.createElement('div');
      row.className = 'audio-fx-param-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'audio-fx-param-label';
      labelEl.textContent = label;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'audio-fx-slider';
      slider.min = min;
      slider.max = max;
      slider.step = step;
      slider.value = currentVal;

      const valEl = document.createElement('span');
      valEl.className = 'audio-fx-param-value';
      valEl.textContent = formatFn(currentVal);

      slider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        valEl.textContent = formatFn(v);
        onInput(v);
        if (typeof saveCurrentProjectLayers === 'function') {
          saveCurrentProjectLayers();
        }
      });

      const commitSave = () => {
        if (typeof saveCurrentProjectLayers === 'function') {
          saveCurrentProjectLayers(true);
        }
      };
      slider.addEventListener('change', commitSave);
      slider.addEventListener('pointerup', commitSave);
      slider.addEventListener('touchend', commitSave);

      row.appendChild(labelEl);
      row.appendChild(slider);
      row.appendChild(valEl);
      return row;
    }

    function renderAudioEffectsRack(layer) {
      const listEl = document.getElementById('audio-fx-list');
      if (!listEl) return;

      if (!layer || (layer.type !== 'video' && layer.type !== 'audio')) {
        listEl.innerHTML = '<div class="audio-fx-empty">Select an audio or video layer to apply effects</div>';
        return;
      }

      if (!Array.isArray(layer.audioEffects) || layer.audioEffects.length === 0) {
        listEl.innerHTML = '<div class="audio-fx-empty">No audio effects added</div>';
        return;
      }

      listEl.innerHTML = '';

      layer.audioEffects.forEach((fx, index) => {
        const card = document.createElement('div');
        card.className = 'audio-fx-card' + (fx.disabled ? ' is-disabled' : '');
        card.dataset.fxId = fx.id;

        // Header
        const header = document.createElement('div');
        header.className = 'audio-fx-card-header';

        const left = document.createElement('div');
        left.className = 'audio-fx-card-left';

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'audio-fx-toggle-btn' + (!fx.disabled ? ' is-active' : '');
        toggleBtn.title = fx.disabled ? 'Enable effect' : 'Disable effect';
        toggleBtn.innerHTML = '<i class="fticon fticon-chk-graph-overshoot" aria-hidden="true"></i>';
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          fx.disabled = !fx.disabled;
          renderAudioEffectsRack(layer);
          syncLayerAudioEffects(layer);
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
        });

        const nameEl = document.createElement('span');
        nameEl.className = 'audio-fx-card-name';
        nameEl.textContent = fx.name || (fx.type === 'reverb' ? 'Reverb' : 'Delay');

        left.appendChild(toggleBtn);
        left.appendChild(nameEl);

        const actions = document.createElement('div');
        actions.className = 'audio-fx-card-actions';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'audio-fx-del-btn';
        delBtn.title = 'Remove effect';
        delBtn.innerHTML = '<i class="fticon fticon-delete-beatmark" aria-hidden="true"></i>';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          layer.audioEffects.splice(index, 1);
          renderAudioEffectsRack(layer);
          syncLayerAudioEffects(layer);
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
        });

        actions.appendChild(delBtn);

        header.appendChild(left);
        header.appendChild(actions);
        card.appendChild(header);

        // Body with parameters
        const body = document.createElement('div');
        body.className = 'audio-fx-card-body';

        if (fx.type === 'reverb') {
          // Param: Decay (0.2s - 4.0s)
          const decayVal = typeof fx.decay === 'number' ? fx.decay : 1.5;
          const decayRow = createAudioFxParamRow('Decay', 0.2, 4.0, 0.1, decayVal, (val) => `${val.toFixed(1)}s`, (val) => {
            fx.decay = Number(val);
            syncLayerAudioEffects(layer);
          });
          body.appendChild(decayRow);

          // Param: Mix (0 - 100%)
          const mixVal = typeof fx.mix === 'number' ? Math.round(fx.mix * 100) : 40;
          const mixRow = createAudioFxParamRow('Mix', 0, 100, 1, mixVal, (val) => `${Math.round(val)}%`, (val) => {
            fx.mix = Number(val) / 100;
            syncLayerAudioEffects(layer);
          });
          body.appendChild(mixRow);
        } else if (fx.type === 'delay') {
          // Param: Time (0.05s - 1.0s)
          const timeVal = typeof fx.time === 'number' ? fx.time : 0.3;
          const timeRow = createAudioFxParamRow('Time', 0.05, 1.0, 0.05, timeVal, (val) => `${(val * 1000).toFixed(0)}ms`, (val) => {
            fx.time = Number(val);
            syncLayerAudioEffects(layer);
          });
          body.appendChild(timeRow);

          // Param: Feedback (0 - 80%)
          const fbVal = typeof fx.feedback === 'number' ? Math.round(fx.feedback * 100) : 30;
          const fbRow = createAudioFxParamRow('Feedback', 0, 80, 1, fbVal, (val) => `${Math.round(val)}%`, (val) => {
            fx.feedback = Number(val) / 100;
            syncLayerAudioEffects(layer);
          });
          body.appendChild(fbRow);

          // Param: Mix (0 - 100%)
          const mixVal = typeof fx.mix === 'number' ? Math.round(fx.mix * 100) : 35;
          const mixRow = createAudioFxParamRow('Mix', 0, 100, 1, mixVal, (val) => `${Math.round(val)}%`, (val) => {
            fx.mix = Number(val) / 100;
            syncLayerAudioEffects(layer);
          });
          body.appendChild(mixRow);
        }

        card.appendChild(body);
        listEl.appendChild(card);
      });
    }
    window.renderAudioEffectsRack = renderAudioEffectsRack;

    /* ==========================================================================
       SPEED CONTROLLER & VIDEO INTERPOLATION (MODULAR & PURE FLAT)
       ========================================================================== */
    function ratioToSpeed(ratio) {
      if (ratio <= 0.5) {
        // 0.0 -> 0.1x, 0.5 -> 1.0x
        return Number((0.1 + (ratio / 0.5) * 0.9).toFixed(2));
      } else {
        // 0.5 -> 1.0x, 1.0 -> 8.0x
        return Number((1.0 + ((ratio - 0.5) / 0.5) * 7.0).toFixed(1));
      }
    }

    function speedToRatio(speed) {
      const s = Math.max(0.1, Math.min(8.0, Number(speed) || 1.0));
      if (s <= 1.0) {
        return (s - 0.1) / 0.9 * 0.5;
      } else {
        return 0.5 + ((s - 1.0) / 7.0) * 0.5;
      }
    }

    function syncSpeedControllerValues() {
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer) return;

      const isRemapMode = layer.speedMode === 'time_remap';

      // 1. Sync mode switcher buttons
      const btnModeSpeed = document.getElementById('btn-speed-type-speed');
      const btnModeRemap = document.getElementById('btn-speed-type-remap');
      if (btnModeSpeed) {
        btnModeSpeed.classList.toggle('is-active', !isRemapMode);
        btnModeSpeed.setAttribute('aria-checked', !isRemapMode ? 'true' : 'false');
      }
      if (btnModeRemap) {
        btnModeRemap.classList.toggle('is-active', isRemapMode);
        btnModeRemap.setAttribute('aria-checked', isRemapMode ? 'true' : 'false');
      }

      // 2. Toggle panels
      const panelSpeed = document.getElementById('panel-speed-multiplier');
      const panelRemap = document.getElementById('panel-time-remap');
      if (panelSpeed) panelSpeed.style.display = isRemapMode ? 'none' : 'block';
      if (panelRemap) panelRemap.style.display = isRemapMode ? 'block' : 'none';

      const pps = window.currentPixelsPerSecond || 80;
      const currentSec = Math.abs(window.timelinePanX || 0) / pps;
      const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
        ? getLayerEffectivePropsAtTime(layer, currentSec)
        : null;

      if (!isRemapMode) {
        // Speed Multiplier Mode
        const spd = (effProps && effProps.speed !== undefined) ? effProps.speed : (layer.speed !== undefined ? layer.speed : 1.0);
        const fillEl = document.getElementById('speed-slider-fill');
        const thumbEl = document.getElementById('speed-slider-thumb');
        const badgeEl = document.getElementById('speed-slider-badge');
        const containerEl = document.getElementById('speed-slider-container');
        const jogSpeed = document.getElementById('jog-layer-speed');

        const ratio = Math.max(0, Math.min(1, speedToRatio(spd)));
        const pct = (ratio * 100).toFixed(2);

        if (fillEl) fillEl.style.width = pct + '%';
        if (thumbEl) thumbEl.style.left = pct + '%';
        if (badgeEl) badgeEl.textContent = `${spd}x`;
        if (containerEl) containerEl.setAttribute('aria-valuenow', spd);
        if (jogSpeed) {
          jogSpeed.setAttribute('aria-valuenow', spd);
          updateJogScrubberVisuals(jogSpeed, ratio * 100, 0, 100);
        }
      } else {
        // Time Remap Mode (Source Time)
        const remapSec = (effProps && effProps.timeRemap !== undefined)
          ? effProps.timeRemap
          : (layer.timeRemap !== undefined ? layer.timeRemap : 0);
        const maxSec = Math.max(0.1, layer.mediaDuration || layer.durationSec || ((layer.widthPx || 400) / pps));
        const remapRatio = Math.max(0, Math.min(1, remapSec / maxSec));
        const remapPct = (remapRatio * 100).toFixed(2);

        const remapFill = document.getElementById('timeremap-slider-fill');
        const remapThumb = document.getElementById('timeremap-slider-thumb');
        const remapBadge = document.getElementById('timeremap-slider-badge');
        const remapContainer = document.getElementById('timeremap-slider-container');
        const jogRemap = document.getElementById('jog-layer-timeremap');

        if (remapFill) remapFill.style.width = remapPct + '%';
        if (remapThumb) remapThumb.style.left = remapPct + '%';
        if (remapBadge) {
          if (typeof window.formatTimecode === 'function') {
            remapBadge.textContent = window.formatTimecode(Math.round(remapSec * 1000));
          } else {
            remapBadge.textContent = `${remapSec.toFixed(2)}s`;
          }
        }
        if (remapContainer) {
          remapContainer.setAttribute('aria-valuenow', remapSec.toFixed(3));
          remapContainer.setAttribute('aria-valuemax', maxSec.toFixed(3));
        }
        if (jogRemap) {
          jogRemap.setAttribute('aria-valuenow', remapSec.toFixed(3));
          jogRemap.setAttribute('aria-valuemax', maxSec.toFixed(3));
          updateJogScrubberVisuals(jogRemap, remapSec, 0, maxSec);
        }
      }

      // Sync interpolation buttons highlight
      const interp = layer.speedInterpolation || 'none';
      const modeBtns = document.querySelectorAll('.speed-mode-btn');
      modeBtns.forEach(btn => {
        const mode = btn.getAttribute('data-interpolation');
        const isActive = mode === interp;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      });

      // Sync pitch toggle
      const pitch = layer.preservePitch !== undefined ? layer.preservePitch : true;
      const pitchSwitch = document.getElementById('speed-preserve-pitch-toggle');
      if (pitchSwitch) {
        pitchSwitch.classList.toggle('is-active', !!pitch);
        pitchSwitch.setAttribute('aria-checked', !!pitch ? 'true' : 'false');
      }

      if (typeof updateSpeedKeyframeBtnState === 'function') {
        updateSpeedKeyframeBtnState();
      }
    }
    window.syncSpeedControllerValues = syncSpeedControllerValues;

    function updateSpeedKeyframeBtnState() {
      const btn = document.getElementById('btn-speed-keyframe');
      const btnGraph = document.getElementById('btn-speed-graph');
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
      const prop = (layer.speedMode === 'time_remap') ? 'timeRemap' : 'speed';
      const kf = (typeof getKeyframeAtTime === 'function') ? getKeyframeAtTime(layer, prop, currentSec) : null;
      if (btn) btn.classList.toggle('is-active', !!kf);
      if (btnGraph) {
        const kfList = (layer.keyframes && layer.keyframes[prop]) || [];
        const canOpen = kfList.length >= 2;
        btnGraph.disabled = !canOpen;
        btnGraph.classList.toggle('is-disabled', !canOpen);
      }
    }
    window.updateSpeedKeyframeBtnState = updateSpeedKeyframeBtnState;

    (function initSpeedController() {
      // 1. Back button: Speed -> Main Layer Actions
      const btnSpeedBack = document.getElementById('btn-speed-back');
      if (btnSpeedBack) {
        btnSpeedBack.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('main');
        });
      }

      // 2. Keyframe button: Add / Remove Keyframe for Speed or Time Remap
      const btnSpeedKeyframe = document.getElementById('btn-speed-keyframe');
      if (btnSpeedKeyframe) {
        btnSpeedKeyframe.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          const prop = (layer && layer.speedMode === 'time_remap') ? 'timeRemap' : 'speed';
          window.activeKeyframeProperty = prop;
          toggleKeyframeAtCurrentTime();
          updateSpeedKeyframeBtnState();
          syncSpeedControllerValues();
        });
      }

      // 3. Graph button: Speed / Time Remap -> Graph Editor
      const btnSpeedGraph = document.getElementById('btn-speed-graph');
      if (btnSpeedGraph) {
        btnSpeedGraph.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          const prop = (layer && layer.speedMode === 'time_remap') ? 'timeRemap' : 'speed';
          const kfList = (layer && layer.keyframes && layer.keyframes[prop]) || [];
          if (kfList.length < 2) return;
          window.activeKeyframeProperty = prop;
          window.previousDrawerSubview = 'speed';
          switchLayerDrawerSubview('graph');
        });
      }

      // Helper: Initialize Time Remap with 2 boundary AE keyframes (true media start & true media end)
      function initTimeRemapForLayer(layer, forceReset = false) {
        if (!layer) return;
        layer.speedMode = 'time_remap';
        if (!layer.keyframes) layer.keyframes = {};

        if (forceReset || !Array.isArray(layer.keyframes.timeRemap) || layer.keyframes.timeRemap.length === 0) {
          const pps = window.currentPixelsPerSecond || 80;
          const clipStartSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
          const clipDurSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
          const rawMediaDur = (typeof getLayerMediaDuration === 'function') ? getLayerMediaDuration(layer) : null;
          const totalMediaDur = (rawMediaDur && isFinite(rawMediaDur) && rawMediaDur > 0)
            ? rawMediaDur
            : ((layer.mediaDuration && isFinite(layer.mediaDuration) && layer.mediaDuration > 0) ? layer.mediaDuration : clipDurSec);
          const srcOffset = layer.sourceOffsetSec || 0;
          const spd = (layer.speed !== undefined && layer.speed > 0) ? layer.speed : 1.0;

          // True start and end of the underlying media on the timeline (AE-style Time Remap):
          // Even if the video was split in the middle (srcOffset > 0), keyframe 1 is at the true start of the video (0s)
          // and keyframe 2 is at the true end of the video (totalMediaDur).
          const trueStartSec = clipStartSec - (srcOffset / spd);
          const trueEndSec = trueStartSec + (totalMediaDur / spd);

          layer.keyframes.timeRemap = [
            {
              time: Number(trueStartSec.toFixed(3)),
              value: { timeRemap: 0 },
              easing: [0.0, 0.0, 1.0, 1.0]
            },
            {
              time: Number(trueEndSec.toFixed(3)),
              value: { timeRemap: Number(totalMediaDur.toFixed(3)) },
              easing: [0.0, 0.0, 1.0, 1.0]
            }
          ];
          layer.timeRemap = srcOffset;
        }
      }
      window.initTimeRemapForLayer = initTimeRemapForLayer;

      // Helper: Freeze frame from current playhead to clip end
      function freezeFrameAtCurrentTime() {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!layer) return;
        if (layer.speedMode !== 'time_remap') {
          initTimeRemapForLayer(layer, false);
        }
        const pps = window.currentPixelsPerSecond || 80;
        const currentSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
        const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
        const clipEnd = Number((clipStart + clipDur).toFixed(3));

        const eff = (typeof getLayerEffectivePropsAtTime === 'function')
          ? getLayerEffectivePropsAtTime(layer, currentSec)
          : layer;
        const freezeVal = Number((eff.timeRemap !== undefined ? eff.timeRemap : (layer.timeRemap || 0)).toFixed(3));

        if (!layer.keyframes) layer.keyframes = {};
        if (!Array.isArray(layer.keyframes.timeRemap)) layer.keyframes.timeRemap = [];

        // Filter out keyframes >= currentSec
        layer.keyframes.timeRemap = layer.keyframes.timeRemap.filter(kf => kf.time < currentSec - 0.001);

        // Add keyframe at currentSec
        layer.keyframes.timeRemap.push({
          time: currentSec,
          value: { timeRemap: freezeVal },
          easing: [0.0, 0.0, 1.0, 1.0]
        });

        // Add keyframe at clipEnd with the same value so it holds freeze
        if (clipEnd > currentSec + 0.001) {
          layer.keyframes.timeRemap.push({
            time: clipEnd,
            value: { timeRemap: freezeVal },
            easing: [0.0, 0.0, 1.0, 1.0]
          });
        }

        layer.keyframes.timeRemap.sort((a, b) => a.time - b.time);
        layer.timeRemap = freezeVal;

        syncSpeedControllerValues();
        updateSpeedKeyframeBtnState();
        if (typeof updateTimelineKeyframeMarkersHighlight === 'function') updateTimelineKeyframeMarkersHighlight();
        if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
        invalidatePreviewCacheForLayer(layer);
        if (typeof redrawComposition === 'function') redrawComposition('timeremap-freeze');
        if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
        if (typeof showEffectsRackToast === 'function') showEffectsRackToast('Frame Frozen');
      }
      window.freezeFrameAtCurrentTime = freezeFrameAtCurrentTime;

      // Helper: Reset Time Remap to 1:1 linear playback
      function resetTimeRemapLinear() {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!layer) return;
        initTimeRemapForLayer(layer, true);
        syncSpeedControllerValues();
        updateSpeedKeyframeBtnState();
        if (typeof updateTimelineKeyframeMarkersHighlight === 'function') updateTimelineKeyframeMarkersHighlight();
        if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
        invalidatePreviewCacheForLayer(layer);
        if (typeof redrawComposition === 'function') redrawComposition('timeremap-reset');
        if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
        if (typeof showEffectsRackToast === 'function') showEffectsRackToast('Time Remap Reset 1:1');
      }
      window.resetTimeRemapLinear = resetTimeRemapLinear;

      // 4. Mode switcher buttons: Speed Multiplier vs Time Remap
      const btnSpeedTypeSpeed = document.getElementById('btn-speed-type-speed');
      const btnSpeedTypeRemap = document.getElementById('btn-speed-type-remap');

      if (btnSpeedTypeSpeed) {
        btnSpeedTypeSpeed.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          layer.speedMode = 'speed';
          window.activeKeyframeProperty = 'speed';

          // In normal Speed mode, clamp layer duration so it cannot exceed native media duration
          if (layer.type === 'video' || layer.type === 'audio') {
            const totalMediaDur = (typeof getLayerMediaDuration === 'function') ? getLayerMediaDuration(layer) : layer.mediaDuration;
            if (totalMediaDur && isFinite(totalMediaDur) && totalMediaDur > 0) {
              const pps = window.currentPixelsPerSecond || 80;
              const spd = (layer.speed && layer.speed > 0) ? layer.speed : 1.0;
              const srcOff = layer.sourceOffsetSec || 0;
              const maxAllowedDur = Math.max(0.05, (totalMediaDur - srcOff) / spd);
              if (layer.durationSec > maxAllowedDur + 0.01) {
                layer.durationSec = maxAllowedDur;
                layer.widthPx = Math.max(10, Math.round(maxAllowedDur * pps));
              }
            }
          }

          syncSpeedControllerValues();
          updateSpeedKeyframeBtnState();
          if (typeof updateTimelineKeyframeMarkersHighlight === 'function') updateTimelineKeyframeMarkersHighlight();
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          invalidatePreviewCacheForLayer(layer);
          if (typeof redrawComposition === 'function') redrawComposition('speed-mode-speed');
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
        });
      }

      if (btnSpeedTypeRemap) {
        btnSpeedTypeRemap.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          layer.speedMode = 'time_remap';
          initTimeRemapForLayer(layer, false);
          window.activeKeyframeProperty = 'timeRemap';
          syncSpeedControllerValues();
          updateSpeedKeyframeBtnState();
          if (typeof updateTimelineKeyframeMarkersHighlight === 'function') updateTimelineKeyframeMarkersHighlight();
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          invalidatePreviewCacheForLayer(layer);
          if (typeof redrawComposition === 'function') redrawComposition('speed-mode-remap');
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
        });
      }

      // Freeze button
      const btnRemapFreeze = document.getElementById('btn-timeremap-freeze');
      if (btnRemapFreeze) {
        btnRemapFreeze.addEventListener('click', (e) => {
          e.stopPropagation();
          freezeFrameAtCurrentTime();
        });
      }

      // Reset button
      const btnRemapReset = document.getElementById('btn-timeremap-reset');
      if (btnRemapReset) {
        btnRemapReset.addEventListener('click', (e) => {
          e.stopPropagation();
          resetTimeRemapLinear();
        });
      }

      // Universal Reset Button (Speed + Time Remap)
      const btnUniversalReset = document.getElementById('btn-speed-universal-reset');
      if (btnUniversalReset) {
        btnUniversalReset.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          
          if (layer.keyframes) {
            delete layer.keyframes.speed;
            delete layer.keyframes.timeRemap;
          }
          layer.speed = 1.0;
          
          syncSpeedControllerValues();
          updateSpeedKeyframeBtnState();
          if (typeof updateTimelineKeyframeMarkersHighlight === 'function') updateTimelineKeyframeMarkersHighlight();
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          invalidatePreviewCacheForLayer(layer);
          if (typeof redrawComposition === 'function') redrawComposition('speed-reset-all');
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
          if (typeof showEffectsRackToast === 'function') showEffectsRackToast('Speed & Time Remap Reset');
        });
      }

      // 4. Speed Scrubber (Jog Wheel) & Direct Value Input
      const jogLayerSpeed = document.getElementById('jog-layer-speed');
      const speedBadge = document.getElementById('speed-slider-badge');
      const sliderContainer = document.getElementById('speed-slider-container');
      const sliderFill = document.getElementById('speed-slider-fill');
      const sliderThumb = document.getElementById('speed-slider-thumb');

      let initSpeedVal = 1.0;
      let lastSpeedVal = 1.0;

      function applySpeedValue(speedVal, commit = true) {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!layer) return;

        const roundedVal = Math.max(0.1, Math.min(8.0, Number(Number(speedVal).toFixed(2))));
        layer.speed = roundedVal;
        lastSpeedVal = roundedVal;

        // In normal Speed mode (without speed keyframes), clamp clip duration so it never exceeds available media duration
        const hasSpeedKfs = !!(layer.keyframes && Array.isArray(layer.keyframes.speed) && layer.keyframes.speed.length > 0);
        if (layer.speedMode !== 'time_remap' && !hasSpeedKfs && (layer.type === 'video' || layer.type === 'audio')) {
          const totalMediaDur = (typeof getLayerMediaDuration === 'function') ? getLayerMediaDuration(layer) : layer.mediaDuration;
          if (totalMediaDur && isFinite(totalMediaDur) && totalMediaDur > 0) {
            const pps = window.currentPixelsPerSecond || 80;
            const srcOff = layer.sourceOffsetSec || 0;
            const maxAllowedDur = Math.max(0.05, (totalMediaDur - srcOff) / roundedVal);
            if (!layer._userTrimmed || layer.durationSec > maxAllowedDur + 0.01) {
              layer.durationSec = maxAllowedDur;
              layer.widthPx = Math.max(10, Math.round(maxAllowedDur * pps));
              layer.isDurationExplicit = true;
              const clipEl = document.querySelector(`.timeline-clip-block[data-layer-id="${layer.id}"]`);
              if (clipEl) {
                clipEl.style.width = `${layer.widthPx}px`;
              }
            }
          }
        }

        const ratio = Math.max(0, Math.min(1, speedToRatio(roundedVal)));
        const pct = (ratio * 100).toFixed(2);

        if (sliderFill) sliderFill.style.width = pct + '%';
        if (sliderThumb) sliderThumb.style.left = pct + '%';
        if (speedBadge) speedBadge.textContent = `${roundedVal}x`;
        if (sliderContainer) sliderContainer.setAttribute('aria-valuenow', roundedVal);
        if (jogLayerSpeed) {
          jogLayerSpeed.setAttribute('aria-valuenow', roundedVal);
          updateJogScrubberVisuals(jogLayerSpeed, ratio * 100, 0, 100);
        }

        // Live media playback rate & pitch sync
        if (window.getOrLoadLayerMedia) {
          const media = window.getOrLoadLayerMedia(layer);
          if (media && media.el) {
            try {
              const tlSpeed = (typeof window.timelinePlaybackSpeed === 'number' && window.timelinePlaybackSpeed > 0)
                ? window.timelinePlaybackSpeed : 1.0;
              media.el.playbackRate = Math.max(0.0625, Math.min(8.0, roundedVal * tlSpeed));
              if ('preservesPitch' in media.el) {
                media.el.preservesPitch = layer.preservePitch !== false;
              }
              if ('webkitPreservesPitch' in media.el) {
                media.el.webkitPreservesPitch = layer.preservePitch !== false;
              }
              if ('mozPreservesPitch' in media.el) {
                media.el.mozPreservesPitch = layer.preservePitch !== false;
              }
            } catch (_) {}
          }
        }
        if (window.FishAudioEngine && window.isTimelinePlaying) {
          const pps = window.currentPixelsPerSecond || 80;
          const curPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
          const curSec = (typeof window.currentSec === 'number') ? window.currentSec : Math.max(0, -curPanX / pps);
          const tlSpeed = (typeof window.timelinePlaybackSpeed === 'number' && window.timelinePlaybackSpeed > 0)
            ? window.timelinePlaybackSpeed : 1.0;
          window.FishAudioEngine.syncPlayback(currentProjectState.layers || [], curSec, pps, tlSpeed);
        }

        if (layer.type === 'precomp') {
          if (window.FishAudioEngine) {
            const pps = window.currentPixelsPerSecond || 80;
            const currentSec = Math.abs(window.timelinePanX || 0) / pps;
            window.FishAudioEngine.syncPlayback(currentProjectState.layers || [], currentSec, pps);
          }
        }

        invalidatePreviewCacheForLayer(layer);

        if (commit) {
          if (typeof recordLayerPropertyChange === 'function') {
            recordLayerPropertyChange(layer, 'speed');
          }
          updateSpeedKeyframeBtnState();

          if (window.PreviewCacheManager) {
            const pps = window.currentPixelsPerSecond || 80;
            const lStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
            const lDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
            if (typeof window.PreviewCacheManager.forceRecache === 'function') {
              window.PreviewCacheManager.forceRecache(lStart, lStart + lDur);
            } else if (typeof window.PreviewCacheManager.scheduleIdleCheck === 'function') {
              window.PreviewCacheManager.scheduleIdleCheck(true);
            }
          }

          if (typeof redrawComposition === 'function') {
            redrawComposition('layer-speed-change');
          }
          if (typeof saveCurrentProjectLayers === 'function') {
            saveCurrentProjectLayers(true);
          }
        } else {
          if (!window._speedRedrawRafPending) {
            window._speedRedrawRafPending = true;
            requestAnimationFrame(() => {
              window._speedRedrawRafPending = false;
              if (typeof redrawComposition === 'function') {
                redrawComposition('layer-speed-scrub');
              }
            });
          }
        }
      }
      window.applySpeedValue = applySpeedValue;

      if (jogLayerSpeed) {
        bindJogWheel(jogLayerSpeed, {
          onStart: () => {
            const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
            if (!layer) return;
            window.isTransformInteracting = true;
            syncLayerWithEffectiveProps(layer);
            invalidatePreviewCacheForLayer(layer);
            initSpeedVal = (layer.speed !== undefined ? layer.speed : 1.0);
            lastSpeedVal = initSpeedVal;
          },
          onMove: (delta) => {
            const initRatio = speedToRatio(initSpeedVal);
            const currentRatio = Math.max(0, Math.min(1, initRatio + delta * 0.0025));
            const calculatedSpeed = ratioToSpeed(currentRatio);
            applySpeedValue(calculatedSpeed, false);
          },
          onEnd: () => {
            window.isTransformInteracting = false;
            applySpeedValue(lastSpeedVal, true);
          }
        });
      }

      if (speedBadge) {
        speedBadge.style.cursor = 'pointer';
        speedBadge.title = 'Click to edit Speed';
        speedBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          const curSpd = layer.speed !== undefined ? layer.speed : 1.0;
          if (typeof window.openValueInputPopover === 'function') {
            window.openValueInputPopover(speedBadge, {
              title: 'Speed',
              value: curSpd,
              defaultValue: 1.0,
              min: 0.1,
              max: 8.0,
              step: 0.1,
              onCommit: (val) => {
                applySpeedValue(val, true);
              }
            });
          } else {
            const input = prompt('Enter Speed (0.1x to 8.0x):', curSpd);
            if (input !== null) {
              const parsed = parseFloat(input);
              if (!isNaN(parsed) && parsed > 0) {
                applySpeedValue(parsed, true);
              }
            }
          }
        });
      }

      if (sliderContainer && sliderContainer !== jogLayerSpeed) {
        function updateSpeedFromPointer(e) {
          const rect = sliderContainer.getBoundingClientRect();
          if (!rect.width) return;
          const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
          const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          const calculatedSpeed = ratioToSpeed(ratio);
          applySpeedValue(calculatedSpeed, false);
        }

        sliderContainer.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          try { sliderContainer.setPointerCapture(e.pointerId); } catch (_) {}

          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            window.isTransformInteracting = true;
            syncLayerWithEffectiveProps(layer);
            invalidatePreviewCacheForLayer(layer);
          }

          updateSpeedFromPointer(e);

          function onPointerMove(ev) {
            updateSpeedFromPointer(ev);
          }

          function onPointerUp(ev) {
            try { sliderContainer.releasePointerCapture(ev.pointerId); } catch (_) {}
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
            window.isTransformInteracting = false;
            applySpeedValue(lastSpeedVal, true);
          }

          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerUp);
        });
      }

      // 5. Time Remap Scrubber (Jog Wheel) & Direct Value Input
      const jogLayerTimeRemap = document.getElementById('jog-layer-timeremap');
      const remapSliderBadge = document.getElementById('timeremap-slider-badge');
      const remapSliderContainer = document.getElementById('timeremap-slider-container');
      const remapFill = document.getElementById('timeremap-slider-fill');
      const remapThumb = document.getElementById('timeremap-slider-thumb');

      let initRemapVal = 0;
      let lastRemapVal = 0;

      function applyTimeRemapValue(remapVal, commit = true) {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!layer) return;

        const pps = window.currentPixelsPerSecond || 80;
        const currentSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
        const maxSec = Math.max(0.1, layer.mediaDuration || layer.durationSec || ((layer.widthPx || 400) / pps));
        const roundedVal = Math.max(0, Math.min(maxSec, Number(Number(remapVal).toFixed(3))));

        layer.timeRemap = roundedVal;
        lastRemapVal = roundedVal;

        // Update slider fill & thumb & badge
        const ratio = Math.max(0, Math.min(1, roundedVal / maxSec));
        const pct = (ratio * 100).toFixed(2);

        if (remapFill) remapFill.style.width = pct + '%';
        if (remapThumb) remapThumb.style.left = pct + '%';
        if (remapSliderBadge) {
          if (typeof window.formatTimecode === 'function') {
            remapSliderBadge.textContent = window.formatTimecode(Math.round(roundedVal * 1000));
          } else {
            remapSliderBadge.textContent = `${roundedVal.toFixed(2)}s`;
          }
        }
        if (remapSliderContainer) remapSliderContainer.setAttribute('aria-valuenow', roundedVal);
        if (jogLayerTimeRemap) {
          jogLayerTimeRemap.setAttribute('aria-valuenow', roundedVal);
          jogLayerTimeRemap.setAttribute('aria-valuemax', maxSec.toFixed(3));
          updateJogScrubberVisuals(jogLayerTimeRemap, roundedVal, 0, maxSec);
        }

        if (layer.type === 'precomp') {
          if (window.FishAudioEngine) {
            window.FishAudioEngine.syncPlayback(currentProjectState.layers || [], currentSec, pps);
          }
        }

        invalidatePreviewCacheForLayer(layer);

        if (commit) {
          // Auto-record keyframe if keyframes exist on timeRemap
          if (!layer.keyframes) layer.keyframes = {};
          if (!Array.isArray(layer.keyframes.timeRemap)) layer.keyframes.timeRemap = [];

          const existingKf = (typeof getKeyframeAtTime === 'function')
            ? getKeyframeAtTime(layer, 'timeRemap', currentSec)
            : layer.keyframes.timeRemap.find(k => Math.abs(k.time - currentSec) < 0.04);

          if (existingKf) {
            existingKf.value = { timeRemap: roundedVal };
          } else {
            const defaultEasing = (layer._defaultEasing && layer._defaultEasing.timeRemap) ? layer._defaultEasing.timeRemap : [0.0, 0.0, 1.0, 1.0];
            layer.keyframes.timeRemap.push({
              time: currentSec,
              value: { timeRemap: roundedVal },
              easing: [...defaultEasing]
            });
            layer.keyframes.timeRemap.sort((a, b) => a.time - b.time);
          }

          updateSpeedKeyframeBtnState();

          if (window.PreviewCacheManager) {
            const lStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
            const lDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
            if (typeof window.PreviewCacheManager.forceRecache === 'function') {
              window.PreviewCacheManager.forceRecache(lStart, lStart + lDur);
            } else if (typeof window.PreviewCacheManager.scheduleIdleCheck === 'function') {
              window.PreviewCacheManager.scheduleIdleCheck(true);
            }
          }

          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          if (typeof redrawComposition === 'function') redrawComposition('layer-timeremap-change');
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
        } else {
          if (!window._timeremapRedrawRafPending) {
            window._timeremapRedrawRafPending = true;
            requestAnimationFrame(() => {
              window._timeremapRedrawRafPending = false;
              if (typeof redrawComposition === 'function') {
                redrawComposition('layer-timeremap-scrub');
              }
            });
          }
        }
      }
      window.applyTimeRemapValue = applyTimeRemapValue;

      if (jogLayerTimeRemap) {
        bindJogWheel(jogLayerTimeRemap, {
          onStart: () => {
            const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
            if (!layer) return;
            window.isTransformInteracting = true;
            syncLayerWithEffectiveProps(layer);
            invalidatePreviewCacheForLayer(layer);
            const pps = window.currentPixelsPerSecond || 80;
            const currentSec = Math.abs(window.timelinePanX || 0) / pps;
            const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, currentSec) : layer;
            initRemapVal = eff.timeRemap !== undefined ? eff.timeRemap : (layer.timeRemap || 0);
            lastRemapVal = initRemapVal;
          },
          onMove: (delta) => {
            const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
            const pps = window.currentPixelsPerSecond || 80;
            const maxSec = layer ? Math.max(0.1, layer.mediaDuration || layer.durationSec || ((layer.widthPx || 400) / pps)) : 10;
            const stepRatio = delta / 250;
            const newRemap = Math.max(0, Math.min(maxSec, initRemapVal + stepRatio * maxSec));
            applyTimeRemapValue(newRemap, false);
          },
          onEnd: () => {
            window.isTransformInteracting = false;
            applyTimeRemapValue(lastRemapVal, true);
          }
        });
      }

      if (remapSliderBadge) {
        remapSliderBadge.style.cursor = 'pointer';
        remapSliderBadge.title = 'Click to edit Source Time';
        remapSliderBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          const pps = window.currentPixelsPerSecond || 80;
          const currentSec = Math.abs(window.timelinePanX || 0) / pps;
          const maxSec = Math.max(0.1, layer.mediaDuration || layer.durationSec || ((layer.widthPx || 400) / pps));
          const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, currentSec) : layer;
          const curVal = Number((eff.timeRemap !== undefined ? eff.timeRemap : (layer.timeRemap || 0)).toFixed(2));

          if (typeof window.openValueInputPopover === 'function') {
            window.openValueInputPopover(remapSliderBadge, {
              title: 'Source Time',
              value: curVal,
              defaultValue: 0,
              min: 0,
              max: Number(maxSec.toFixed(2)),
              step: 0.05,
              onCommit: (val) => {
                applyTimeRemapValue(val, true);
              }
            });
          } else {
            const input = prompt('Enter Source Time in seconds (e.g. 1.25):', curVal.toFixed(2));
            if (input !== null) {
              const parsed = parseFloat(input);
              if (!isNaN(parsed) && parsed >= 0) {
                applyTimeRemapValue(parsed, true);
              }
            }
          }
        });
      }

      if (remapSliderContainer && remapSliderContainer !== jogLayerTimeRemap) {
        function updateTimeRemapFromPointer(e) {
          const rect = remapSliderContainer.getBoundingClientRect();
          if (!rect.width) return;
          const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
          const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          const pps = window.currentPixelsPerSecond || 80;
          const maxSec = layer ? Math.max(0.1, layer.mediaDuration || layer.durationSec || ((layer.widthPx || 400) / pps)) : 10;
          const calculatedRemap = ratio * maxSec;
          applyTimeRemapValue(calculatedRemap, false);
        }

        remapSliderContainer.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          try { remapSliderContainer.setPointerCapture(e.pointerId); } catch (_) {}

          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            window.isTransformInteracting = true;
            syncLayerWithEffectiveProps(layer);
            invalidatePreviewCacheForLayer(layer);
          }

          updateTimeRemapFromPointer(e);

          function onPointerMove(ev) {
            updateTimeRemapFromPointer(ev);
          }

          function onPointerUp(ev) {
            try { remapSliderContainer.releasePointerCapture(ev.pointerId); } catch (_) {}
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
            window.isTransformInteracting = false;
            applyTimeRemapValue(lastRemapVal, true);
          }

          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerUp);
        });
      }

      // 6. Video Interpolation Modes
      const modeBtns = document.querySelectorAll('.speed-mode-btn');
      modeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const mode = btn.getAttribute('data-interpolation') || 'none';
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            layer.speedInterpolation = mode;
            modeBtns.forEach(b => {
              const active = b === btn;
              b.classList.toggle('is-active', active);
              b.setAttribute('aria-checked', active ? 'true' : 'false');
            });

            // Invalidate RAM preview cache for layer's active span
            invalidatePreviewCacheForLayer(layer);

            // 3. Auto recache composition in RAM preview buffer
            if (window.PreviewCacheManager) {
              const pps = window.currentPixelsPerSecond || 80;
              const lStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
              const lDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
              if (typeof window.PreviewCacheManager.forceRecache === 'function') {
                window.PreviewCacheManager.forceRecache(lStart, lStart + lDur);
              } else if (typeof window.PreviewCacheManager.scheduleIdleCheck === 'function') {
                window.PreviewCacheManager.scheduleIdleCheck(true);
              }
            }

            // 4. Redraw composition immediately with new interpolation
            if (typeof redrawComposition === 'function') {
              redrawComposition('speed-interpolation-change');
            }

            // 5. Toast notice
            const modeLabels = { 'none': 'None', 'blend': 'Frame Blend', 'optical_flow': 'Optical Flow' };
            if (typeof showEffectsRackToast === 'function') {
              showEffectsRackToast(`Interpolation: ${modeLabels[mode] || mode} (Recaching)`);
            }

            if (typeof saveCurrentProjectLayers === 'function') {
              saveCurrentProjectLayers(true);
            }
          }
        });
      });

      // 5. Audio Preserve Pitch Toggle
      const pitchToggle = document.getElementById('speed-preserve-pitch-toggle');
      if (pitchToggle) {
        pitchToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            const currentPitch = layer.preservePitch !== undefined ? layer.preservePitch : true;
            layer.preservePitch = !currentPitch;
            pitchToggle.classList.toggle('is-active', layer.preservePitch);
            pitchToggle.setAttribute('aria-checked', layer.preservePitch ? 'true' : 'false');

            // Apply live pitch property to media element
            if (window.getOrLoadLayerMedia) {
              const media = window.getOrLoadLayerMedia(layer);
              if (media && media.el) {
                try {
                  if ('preservesPitch' in media.el) media.el.preservesPitch = layer.preservePitch;
                  if ('webkitPreservesPitch' in media.el) media.el.webkitPreservesPitch = layer.preservePitch;
                  if ('mozPreservesPitch' in media.el) media.el.mozPreservesPitch = layer.preservePitch;
                } catch (_) {}
              }
            }
            if (typeof saveCurrentProjectLayers === 'function') {
              saveCurrentProjectLayers(true);
            }
          }
        });
      }
    })();
})();
