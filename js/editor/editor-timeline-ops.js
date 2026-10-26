
function initTimelineOperations() {
  const rulerTrack = document.getElementById("timeline-ruler-track");
  const layersTrack = document.getElementById("timeline-layers-track");
  const timecodeEl = document.getElementById("playhead-current-time");
  const rulerViewport = document.getElementById("timeline-ruler-viewport");
  const layersViewport = document.getElementById("timeline-layers-viewport");

  pixelsPerSecond = window.currentPixelsPerSecond || 80;
  let currentFps = window.currentTimelineFps || 60;
  panX = window.timelinePanX !== undefined ? window.timelinePanX : 0;

      function selectTimelineLayer(layerId, isMulti = false, keepKeyframes = false) {
        if (!layerId) return;
        if (window._layerDrawerResetTimer) {
          clearTimeout(window._layerDrawerResetTimer);
          window._layerDrawerResetTimer = null;
        }
        if (window.activeSnapGuides) {
          window.activeSnapGuides = null;
          if (window.CanvasOverlay) window.CanvasOverlay.scheduleRedraw();
        }
        if (!keepKeyframes && typeof window.clearSelectedKeyframes === 'function') {
          window.clearSelectedKeyframes();
        }
        if (!isMulti) {
          selectedLayerIds.clear();
          selectedLayerIds.add(layerId);
          selectedLayerId = layerId;
        } else {
          selectedLayerIds.add(layerId);
          selectedLayerId = layerId;
        }
        window.selectedLayerId = selectedLayerId;
        window.selectedLayerIds = selectedLayerIds;
        window.lastSelectedLayerId = layerId;

        const layer = (currentProjectState.layers || []).find(l => l.id === layerId);
        if (layer) {
          if (typeof sanitizeLayer3DEffects === 'function') {
            sanitizeLayer3DEffects(layer);
          }
          window.selectedMediaId = layer.mediaId;
          const currentSec = Math.max(0, -(panX || 0) / pixelsPerSecond);
          const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
          const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pixelsPerSecond);
          const end = start + dur;

          // Keep playhead at current frame without forced auto-jumping

          const drawerGrid = document.getElementById('drawer-media-grid');
          if (drawerGrid) {
            drawerGrid.querySelectorAll('.media-item-tile').forEach(t => {
              t.classList.toggle('is-selected', t.dataset.mediaId === layer.mediaId);
            });
          }
        }
        const btnCameraSettings = document.getElementById('btn-layer-camera-settings');
        const btnFill = document.getElementById('btn-layer-fill');
        const btnBlend = document.getElementById('btn-layer-blend');
        const btnEffects = document.getElementById('btn-layer-effects');
        const btnTransform = document.getElementById('btn-layer-transform');
        const btnBeatmark = document.getElementById('btn-layer-beatmark');
        const btnEditGroup = document.getElementById('btn-layer-edit-group');
        const btnEditShape = document.getElementById('btn-layer-edit-shape');
        const btnEditVector = document.getElementById('btn-layer-edit-vector');
        const btnEditText = document.getElementById('btn-layer-edit-text');
        const actionGrid = document.getElementById('layer-action-btn-grid');

        if (layer && (layer.shapeType || layer.shapeProps || (layer.id && layer.id.startsWith('layer_shape_')))) {
          layer.type = 'shape';
          if (!layer.fillType) layer.fillType = 'color';
          if (!layer.shapeType) layer.shapeType = 'rectangle';
        }

        if (btnEditGroup) {
          btnEditGroup.style.display = (layer && layer.type === 'precomp') ? 'inline-flex' : 'none';
        }
        const isVectorShape = Boolean(layer && layer.type === 'shape' && layer.shapeType === 'vector');
        const canEditShape = Boolean(layer && !isVectorShape && (
          layer.type === 'shape' ||
          layer.type === 'image' ||
          layer.type === 'video' ||
          (layer.type === 'precomp' && !layer.collapseTransformations)
        ));
        if (btnEditShape) {
          btnEditShape.style.display = canEditShape ? 'inline-flex' : 'none';
        }
        if (btnEditVector) {
          btnEditVector.style.display = isVectorShape ? 'inline-flex' : 'none';
        }
        if (btnEditText) {
          btnEditText.style.display = (layer && layer.type === 'text') ? 'inline-flex' : 'none';
        }

        if (layer && layer.type === 'audio') {
          if (btnBeatmark) btnBeatmark.style.display = 'inline-flex';
          if (btnTransform) btnTransform.style.display = 'none';
          if (btnCameraSettings) btnCameraSettings.style.display = 'none';
          if (btnFill) btnFill.style.display = 'none';
          if (btnBlend) btnBlend.style.display = 'none';
          if (btnEffects) btnEffects.style.display = 'none';
          const fxGal = document.getElementById('drawer-effects-gallery');
          if (fxGal && fxGal.classList.contains('is-active')) {
            closeEffectsGalleryDrawer(false);
          }
          if (currentDrawerSubview === 'transform' || currentDrawerSubview === 'graph' || currentDrawerSubview === 'fill' || currentDrawerSubview === 'blend' || currentDrawerSubview === 'effects' || currentDrawerSubview === 'shape' || currentDrawerSubview === 'vector' || currentDrawerSubview === 'camera' || currentDrawerSubview === 'text') {
            switchLayerDrawerSubview('main');
          }
        } else if (layer && layer.type === 'camera') {
          if (btnBeatmark) btnBeatmark.style.display = 'none';
          if (btnTransform) btnTransform.style.display = '';
          if (btnCameraSettings) btnCameraSettings.style.display = '';
          if (btnFill) btnFill.style.display = 'none';
          if (btnBlend) btnBlend.style.display = 'none';
          if (btnEffects) btnEffects.style.display = 'none';
          if (actionGrid) {
            actionGrid.classList.add('is-camera-mode');
          }
          const fxGal = document.getElementById('drawer-effects-gallery');
          if (fxGal && fxGal.classList.contains('is-active')) {
            closeEffectsGalleryDrawer(false);
          }
          if (currentDrawerSubview === 'fill' || currentDrawerSubview === 'blend' || currentDrawerSubview === 'effects' || currentDrawerSubview === 'shape' || currentDrawerSubview === 'vector' || currentDrawerSubview === 'beatmark') {
            switchLayerDrawerSubview('main');
          }
        } else {
          if (btnBeatmark) btnBeatmark.style.display = 'none';
          if (btnTransform) btnTransform.style.display = '';
          if (btnCameraSettings) btnCameraSettings.style.display = 'none';
          if (btnFill) btnFill.style.display = '';
          if (btnBlend) btnBlend.style.display = '';
          if (btnEffects) btnEffects.style.display = '';
          if (actionGrid) actionGrid.classList.remove('is-camera-mode');
          if (currentDrawerSubview === 'camera' || currentDrawerSubview === 'beatmark' || (currentDrawerSubview === 'shape' && !canEditShape) || (currentDrawerSubview === 'vector' && !isVectorShape)) {
            switchLayerDrawerSubview('main');
          }
        }

        if (actionGrid) {
          const allBtns = Array.from(actionGrid.querySelectorAll('.layer-action-btn'));
          const visibleBtns = allBtns.filter(b => b.style.display !== 'none');
          const count = visibleBtns.length;

          actionGrid.classList.remove('is-solo-mode', 'is-2-items', 'is-3-items', 'is-4-items', 'is-5-items', 'is-6-items');
          if (count === 1) {
            actionGrid.classList.add('is-solo-mode');
          } else if (count === 2) {
            actionGrid.classList.add('is-2-items');
          } else if (count === 3) {
            actionGrid.classList.add('is-3-items');
          } else if (count === 4) {
            actionGrid.classList.add('is-4-items');
          } else if (count === 5) {
            actionGrid.classList.add('is-5-items');
          } else if (count >= 6) {
            actionGrid.classList.add('is-6-items');
          }
        }

        const overlayContainer = document.getElementById('timeline-lane-heads-overlay');
        if (overlayContainer && overlayContainer.children.length > 0 && typeof syncSelectionClassesInPlace === 'function') {
          syncSelectionClassesInPlace();
        } else {
          renderTimelineLayers();
        }

        // Open drawer (No backdrop) IMMEDIATELY with zero blocking latency
        if (!isSelectorMode) {
          const vp = document.getElementById('timeline-layers-viewport');
          if (vp) vp.classList.add('has-drawer-open');

          const allSlots = document.querySelectorAll('.timeline-lane-pill-slot');
          allSlots.forEach(s => s.classList.remove('is-focused'));
          const focusedSlot = document.querySelector(`.timeline-lane-pill-slot[data-layer-id="${layerId}"]`);
          if (focusedSlot) focusedSlot.classList.add('is-focused');

          if (window.Drawer && !window.Drawer.isOpen('timeline-layer-drawer')) {
            window.Drawer.open('timeline-layer-drawer');
          }
          const activeCard = document.querySelector('#timeline-layer-drawer .drawer-card');
          if (activeCard && currentDrawerSubview === 'main') {
            activeCard.style.height = '';
          }
        }

        updateEditorHeaderMode();
        if (typeof updateTimelineKeyframeMarkersHighlight === 'function') {
          updateTimelineKeyframeMarkersHighlight();
        }
        if (typeof updateCutBarRowState === 'function') {
          updateCutBarRowState();
        }
        if (typeof window.updateClipboardButtonsVisibility === 'function') {
          window.updateClipboardButtonsVisibility();
        }

        // Only sync the active controller UI if currently in a parameter subview
        if (typeof currentDrawerSubview !== 'undefined' && currentDrawerSubview !== 'main') {
          if (currentDrawerSubview === 'transform' && typeof syncTransformControllerValues === 'function') {
            syncTransformControllerValues();
          } else if (currentDrawerSubview === 'fill' && typeof syncFillControllerUI === 'function') {
            syncFillControllerUI();
          } else if (currentDrawerSubview === 'blend' && typeof syncBlendOverlayValues === 'function') {
            syncBlendOverlayValues();
            if (typeof updateBlendKeyframeBtnState === 'function') updateBlendKeyframeBtnState();
          } else if (currentDrawerSubview === 'effects' && typeof syncEffectsRackUI === 'function') {
            syncEffectsRackUI();
          } else if (currentDrawerSubview === 'camera' && typeof syncCameraSettingsUI === 'function') {
            syncCameraSettingsUI();
            if (typeof updateCameraKeyframeBtnState === 'function') updateCameraKeyframeBtnState();
          } else if (currentDrawerSubview === 'volume' && typeof syncVolumeControllerValues === 'function') {
            syncVolumeControllerValues();
            if (typeof updateVolumeKeyframeBtnState === 'function') updateVolumeKeyframeBtnState();
            if (typeof renderAudioEffectsRack === 'function') renderAudioEffectsRack(layer);
          } else if (currentDrawerSubview === 'speed' && typeof syncSpeedControllerValues === 'function') {
            syncSpeedControllerValues();
            if (typeof updateSpeedKeyframeBtnState === 'function') updateSpeedKeyframeBtnState();
          } else if (layer && layer.type === 'shape' && currentDrawerSubview === 'shape' && typeof syncShapeControllerUI === 'function') {
            syncShapeControllerUI();
          } else if (layer && layer.type === 'shape' && layer.shapeType === 'vector' && currentDrawerSubview === 'vector' && typeof syncVectorControllerUI === 'function') {
            syncVectorControllerUI();
          } else if (layer && layer.type === 'text' && currentDrawerSubview === 'text' && typeof syncTextControllerUI === 'function') {
            syncTextControllerUI();
          }
        }

        // Sync wireframe viewer overlay immediately
        const pps = window.currentPixelsPerSecond || 80;
        const curPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
        const currentSec = Math.max(0, -curPanX / pps);
        const activeCanvas = document.getElementById('editor-active-canvas');
        if (activeCanvas && typeof syncActiveViewerOverlay === 'function') {
          syncActiveViewerOverlay(currentSec, activeCanvas.width, activeCanvas.height);
        }

        // Defer centering and full composition redraw to next animation frame to prevent blocking drawer slide-up
        if (!isSelectorMode) {
          requestAnimationFrame(() => {
            if (typeof centerSelectedTimelineLayer === 'function') {
              centerSelectedTimelineLayer(false, layerId);
            }
            redrawComposition();
          });
        } else {
          redrawComposition();
        }
      }
      window.selectTimelineLayer = selectTimelineLayer;

      function selectTimelineLayers(layerIds, primaryId = null) {
        const ids = Array.from(layerIds || []);
        if (ids.length === 0) {
          deselectTimelineLayer();
          return;
        }
        const firstId = (primaryId && ids.includes(primaryId)) ? primaryId : ids[0];
        if (typeof window.clearSelectedKeyframes === 'function') {
          window.clearSelectedKeyframes();
        }
        selectedLayerIds.clear();
        ids.forEach(id => selectedLayerIds.add(id));
        selectedLayerId = firstId;
        window.selectedLayerId = firstId;
        window.selectedLayerIds = selectedLayerIds;
        window.lastSelectedLayerId = firstId;
        isSelectorMode = ids.length > 1;
        window.isSelectorMode = isSelectorMode;

        const layer = (currentProjectState.layers || []).find(l => l.id === firstId);
        if (layer) {
          window.selectedMediaId = layer.mediaId;
        }

        syncSelectionClassesInPlace();
        if (typeof window.syncInspectorState === 'function') {
          window.syncInspectorState();
        }
        if (typeof updateEditorHeaderMode === 'function') {
          updateEditorHeaderMode();
        }
        if (typeof updateCutBarRowState === 'function') {
          updateCutBarRowState();
        }
        if (typeof window.updateClipboardButtonsVisibility === 'function') {
          window.updateClipboardButtonsVisibility();
        }
        redrawComposition();
      }
      window.selectTimelineLayers = selectTimelineLayers;

      function updateTimelineSpotlight() {}
      window.updateTimelineSpotlight = updateTimelineSpotlight;

      function toggleSelectTimelineLayer(layerId, isMulti = false) {
        if (!layerId) return;
        if (!isMulti) {
          // Never deselect when clicking selected layer; keep active
          selectTimelineLayer(layerId, false);
        } else {
          if (selectedLayerIds.has(layerId)) {
            selectedLayerIds.delete(layerId);
            if (selectedLayerIds.size === 0) {
              selectedLayerId = null;
              window.selectedLayerId = null;
              isSelectorMode = false;
            } else {
              selectedLayerId = Array.from(selectedLayerIds)[selectedLayerIds.size - 1];
              window.selectedLayerId = selectedLayerId;
            }
          } else {
            selectedLayerIds.add(layerId);
            selectedLayerId = layerId;
            window.selectedLayerId = selectedLayerId;
          }
          renderTimelineLayers();
          redrawComposition();
          updateEditorHeaderMode();
        }
      }

      function deselectTimelineLayer() {
        // Auto-close selected layer drawer
        if (window.Drawer) {
          if (window.Drawer.isOpen('timeline-layer-drawer')) {
            window.Drawer.close('timeline-layer-drawer', false);
          }
          const layerDrawer = document.getElementById('timeline-layer-drawer');
          if (layerDrawer && layerDrawer.classList.contains('is-active')) {
            layerDrawer.classList.remove('is-active');
            layerDrawer.setAttribute('aria-hidden', 'true');
            const card = layerDrawer.querySelector('.drawer-card');
            if (card) card.style.height = '';
          }
          const fxGal = document.getElementById('drawer-effects-gallery');
          if (fxGal && fxGal.classList.contains('is-active')) {
            fxGal.classList.remove('is-active');
            fxGal.setAttribute('aria-hidden', 'true');
            const card = fxGal.querySelector('.drawer-card');
            if (card) card.style.height = '';
          }
          const remainingActive = document.querySelectorAll('.drawer-container.is-active');
          if (remainingActive.length === 0) {
            document.body.classList.remove('has-active-drawer');
            document.querySelectorAll('.editor-timeline.has-drawer-open').forEach(t => t.classList.remove('has-drawer-open'));
          }
        }
        const resetDrawerSubviewsToMain = () => {
          window._layerDrawerResetTimer = null;
          if (window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size > 0)) return;
          if (typeof switchLayerDrawerSubview === 'function') {
            switchLayerDrawerSubview('main');
          }
          const btnCameraSettings = document.getElementById('btn-layer-camera-settings');
          const btnFill = document.getElementById('btn-layer-fill');
          const btnBlend = document.getElementById('btn-layer-blend');
          const btnEffects = document.getElementById('btn-layer-effects');
          const btnEditShape = document.getElementById('btn-layer-edit-shape');
          const btnEditVector = document.getElementById('btn-layer-edit-vector');
          const btnEditText = document.getElementById('btn-layer-edit-text');
          const actionGrid = document.getElementById('layer-action-btn-grid');
          if (btnCameraSettings) btnCameraSettings.style.display = 'none';
          if (btnEditShape) btnEditShape.style.display = 'none';
          if (btnEditVector) btnEditVector.style.display = 'none';
          if (btnEditText) btnEditText.style.display = 'none';
          if (btnFill) btnFill.style.display = '';
          if (btnBlend) btnBlend.style.display = '';
          if (btnEffects) btnEffects.style.display = '';
          if (actionGrid) {
            actionGrid.classList.remove('is-solo-mode', 'is-2-items', 'is-3-items', 'is-4-items', 'is-5-items', 'is-6-items', 'is-camera-mode');
          }
        };

        const isDesktop = Boolean(document.querySelector('.desktop-workstation, .desktop-viewport'));
        if (isDesktop) {
          resetDrawerSubviewsToMain();
        } else {
          if (window._layerDrawerResetTimer) clearTimeout(window._layerDrawerResetTimer);
          window._layerDrawerResetTimer = setTimeout(resetDrawerSubviewsToMain, 280);
        }

        if (selectedLayerIds.size === 0 && !selectedLayerId && !isSelectorMode) {
          updateEditorHeaderMode();
          return;
        }
        selectedLayerIds.clear();
        selectedLayerId = null;
        window.selectedLayerId = null;
        window.selectedLayerIds = selectedLayerIds;
        window.selectedMediaId = null;
        window.activeKeyframeProperty = null;
        if (window.activeSnapGuides) {
          window.activeSnapGuides = null;
          if (window.CanvasOverlay) window.CanvasOverlay.scheduleRedraw();
        }
        if (typeof window.clearSelectedKeyframes === 'function') {
          window.clearSelectedKeyframes();
        }
        isSelectorMode = false;
        const vp = document.getElementById('timeline-layers-viewport');
        if (vp) vp.classList.remove('has-drawer-open');
        const tl = document.getElementById('main-editor-timeline');
        if (tl) tl.classList.remove('has-layer-drawer-open');
        const drawerGrid = document.getElementById('drawer-media-grid');
        if (drawerGrid) {
          drawerGrid.querySelectorAll('.media-item-tile').forEach(t => {
            t.classList.remove('is-selected');
          });
        }
        const overlayContainer = document.getElementById('timeline-lane-heads-overlay');
        if (overlayContainer && overlayContainer.children.length > 0 && typeof syncSelectionClassesInPlace === 'function') {
          syncSelectionClassesInPlace();
        } else {
          renderTimelineLayers();
        }
        redrawComposition();
        // Remove spotlight on deselect
        document.querySelectorAll('.timeline-lane-pill-slot.is-focused').forEach(s => s.classList.remove('is-focused'));
        const drawerEl = document.getElementById('timeline-layer-drawer');
        if (drawerEl) {
          drawerEl.style.removeProperty('--spotlight-top');
          drawerEl.style.removeProperty('--spotlight-bottom');
        }
        updateEditorHeaderMode();
        if (typeof updateTimelineKeyframeMarkersHighlight === 'function') {
          updateTimelineKeyframeMarkersHighlight();
        }
        if (typeof updateVolumeAndSpeedBtnState === 'function') {
          updateVolumeAndSpeedBtnState(null);
        }
        if (typeof updateCutBarRowState === 'function') {
          updateCutBarRowState();
        }
        if (typeof window.updateClipboardButtonsVisibility === 'function') {
          window.updateClipboardButtonsVisibility();
        }
      }
      window.deselectTimelineLayer = deselectTimelineLayer;

      // ======================================================================
      // CONTEXTUAL TOP HEADER BAR MANAGER
      // - Project Mode: Back to Hub, Project Title, Settings Button
      // - Single Layer Mode: Back (Deselect), Rename Layer Input, Delete Button
      // - Batch Select Mode: Back (Deselect All), "(count) Selected", Delete Button
      // ======================================================================
      function updateEditorHeaderMode() {
        const projectNav = document.getElementById('header-nav-project');
        const layerNav = document.getElementById('header-nav-layer');
        const layerNameInput = document.getElementById('editor-layer-name-input');
        const batchTitle = document.getElementById('editor-layer-batch-title');
        const batchActions = document.getElementById('editor-layer-batch-actions');
        const btnLink = document.getElementById('btn-layer-header-link');
        const btnPrecomp = document.getElementById('btn-layer-header-precomp');
        const btnGroupMask = document.getElementById('btn-layer-header-group-mask');
        const btnGroupExclude = document.getElementById('btn-layer-header-group-exclude');
        if (!projectNav || !layerNav) return;

        let count = selectedLayerIds && selectedLayerIds.size > 0 ? selectedLayerIds.size : (selectedLayerId ? 1 : 0);
        if (count === 0 && isSelectorMode) {
          isSelectorMode = false;
        }
        const prevBtn = document.getElementById('editor-btn-prev');
        const nextBtn = document.getElementById('editor-btn-next');

        if (count > 0) {
          if (prevBtn) prevBtn.setAttribute('title', 'Previous Keyframe / Beatmark');
          if (nextBtn) nextBtn.setAttribute('title', 'Next Keyframe / Beatmark');
          projectNav.style.display = 'none';
          layerNav.style.display = 'flex';

          const batchFloatingBar = document.getElementById('timeline-batch-floating-bar');

          if (isSelectorMode || count > 1) {
            // Batch select: show "(count) Selected" in header & show floating bottom bar
            if (layerNameInput) layerNameInput.style.display = 'none';
            // Show link button so users can batch-link multiple selected layers
            if (btnLink) {
              btnLink.style.display = 'inline-flex';
              btnLink.classList.remove('is-linked');
              btnLink.title = 'Link / Parent Selected Layers (Hold to Drag-to-Link)';
            }
            // Keep header clean: hide header batch actions to prevent icon collisions
            if (batchActions) batchActions.style.display = 'none';
            if (btnPrecomp) btnPrecomp.style.display = 'none';
            if (btnGroupMask) btnGroupMask.style.display = 'none';
            if (btnGroupExclude) btnGroupExclude.style.display = 'none';
            if (batchTitle) {
              batchTitle.textContent = `${count} Selected`;
              batchTitle.style.display = 'block';
            }
            if (batchFloatingBar) {
              batchFloatingBar.style.display = 'inline-flex';
            }
          } else if (count === 1) {
            // Single select: show layer rename input & link button, hide group buttons & floating bar
            if (batchFloatingBar) batchFloatingBar.style.display = 'none';
            if (batchActions) batchActions.style.display = 'none';
            if (btnPrecomp) btnPrecomp.style.display = 'none';
            if (btnGroupMask) btnGroupMask.style.display = 'none';
            if (btnGroupExclude) btnGroupExclude.style.display = 'none';
            const targetId = selectedLayerId || (selectedLayerIds ? Array.from(selectedLayerIds)[0] : null);
            const layer = (currentProjectState.layers || []).find(l => l.id === targetId);
            if (layer && layerNameInput) {
              layerNameInput.value = layer.name || 'Untitled Layer';
              layerNameInput.style.display = 'block';
            }
            if (btnLink) {
              btnLink.style.display = 'inline-flex';
              if (layer && layer.parentId) {
                btnLink.classList.add('is-linked');
                btnLink.title = 'Linked to parent (Click to view/unlink, Hold to Drag-to-Link)';
              } else {
                btnLink.classList.remove('is-linked');
                btnLink.title = 'Link / Parent Layer (Hold to Drag-to-Link)';
              }
            }
            if (batchTitle) batchTitle.style.display = 'none';
          }

          const btnMotionBlur = document.getElementById('btn-layer-header-motion-blur');
          if (btnMotionBlur) {
            const targetId = selectedLayerId || (selectedLayerIds ? Array.from(selectedLayerIds)[0] : null);
            const layer = (currentProjectState.layers || []).find(l => l.id === targetId);
            btnMotionBlur.classList.toggle('is-active', !!(layer && layer.motionBlur));
          }

          const btn3D = document.getElementById('btn-layer-header-3d');
          if (btn3D) {
            const targetId = selectedLayerId || (selectedLayerIds ? Array.from(selectedLayerIds)[0] : null);
            const layer = (currentProjectState.layers || []).find(l => l.id === targetId);
            const canBe3D = layer && layer.type !== 'audio';
            btn3D.style.display = canBe3D ? 'inline-flex' : 'none';
            const is3D = !!(layer && layer.is3D);
            btn3D.classList.toggle('is-active', is3D);
            btn3D.setAttribute('aria-pressed', String(is3D));
          }

          const btnCollapse = document.getElementById('btn-layer-header-collapse');
          if (btnCollapse) {
            const targetId = selectedLayerId || (selectedLayerIds ? Array.from(selectedLayerIds)[0] : null);
            const layer = (currentProjectState.layers || []).find(l => l.id === targetId);
            if (count === 1 && layer && layer.type === 'precomp') {
              btnCollapse.style.display = 'inline-flex';
              const isCol = !!layer.collapseTransformations;
              btnCollapse.classList.toggle('is-active', isCol);
              btnCollapse.setAttribute('aria-pressed', String(isCol));
            } else {
              btnCollapse.style.display = 'none';
            }
          }
        } else {
          // Normal project mode
          if (prevBtn) prevBtn.setAttribute('title', 'Previous Beatmark / Frame');
          if (nextBtn) nextBtn.setAttribute('title', 'Next Beatmark / Frame');
          layerNav.style.display = 'none';
          projectNav.style.display = 'flex';
          const batchFloatingBar = document.getElementById('timeline-batch-floating-bar');
          if (batchFloatingBar) batchFloatingBar.style.display = 'none';
          if (btnLink) btnLink.style.display = 'none';
          if (btnPrecomp) btnPrecomp.style.display = 'none';
          if (btnGroupMask) btnGroupMask.style.display = 'none';
          if (btnGroupExclude) btnGroupExclude.style.display = 'none';
          if (batchActions) batchActions.style.display = 'none';
          const btnLayerCol = document.getElementById('btn-layer-header-collapse');
          if (btnLayerCol) btnLayerCol.style.display = 'none';
          const btnLayer3D = document.getElementById('btn-layer-header-3d');
          if (btnLayer3D) btnLayer3D.style.display = 'none';

          const projectBackBtn = document.getElementById('editor-project-back-btn');
          const projectNameInput = document.getElementById('editor-project-name');
          const precompBreadcrumb = document.getElementById('editor-precomp-breadcrumb');
          const breadcrumbProjName = document.getElementById('breadcrumb-project-name');
          const precompNameInput = document.getElementById('editor-precomp-name');
          const btnPrecompCollapse = document.getElementById('btn-precomp-collapse');

          if (currentActivePrecomp) {
            if (projectBackBtn) projectBackBtn.style.display = 'none';
            if (projectNameInput) projectNameInput.style.display = 'none';
            if (precompBreadcrumb) precompBreadcrumb.style.display = 'flex';
            if (breadcrumbProjName) {
              const rootName = (compositionStack && compositionStack.length > 0 && compositionStack[0].parentPrecomp)
                ? compositionStack[0].parentPrecomp.name
                : (currentProjectState.name || 'Project');
              breadcrumbProjName.textContent = rootName;
            }
            if (precompNameInput) {
              precompNameInput.value = currentActivePrecomp.name || 'Pre-comp';
            }
            if (btnPrecompCollapse) {
              btnPrecompCollapse.style.display = 'inline-flex';
              const isCol = !!currentActivePrecomp.collapseTransformations;
              btnPrecompCollapse.classList.toggle('is-active', isCol);
              btnPrecompCollapse.setAttribute('aria-pressed', String(isCol));
            }
          } else {
            if (projectBackBtn) projectBackBtn.style.display = '';
            if (projectNameInput) projectNameInput.style.display = '';
            if (precompBreadcrumb) precompBreadcrumb.style.display = 'none';
            if (btnPrecompCollapse) btnPrecompCollapse.style.display = 'none';
          }

          const btnSettings = document.getElementById('btn-editor-settings');
          if (btnSettings) {
            const title = currentActivePrecomp
              ? `Composition Settings (${currentActivePrecomp.name || 'Pre-comp'})`
              : 'Composition Settings';
            btnSettings.setAttribute('title', title);
            btnSettings.setAttribute('aria-label', title);
          }
        }
        if (typeof window.updateClipboardButtonsVisibility === 'function') {
          window.updateClipboardButtonsVisibility();
        }
      }
      window.updateEditorHeaderMode = updateEditorHeaderMode;

      // Contextual Header Event Listeners (Back, Rename, Precompose, Delete)
      (function initContextualHeaderEvents() {
        // 1. Back button: Deselect current selection
        const btnLayerBack = document.getElementById('btn-layer-header-back');
        if (btnLayerBack) {
          btnLayerBack.addEventListener('click', (e) => {
            e.stopPropagation();
            deselectTimelineLayer();
          });
        }

        // 1b. Precompose / Group Selected Layer(s) Button
        const btnLayerPrecomp = document.getElementById('btn-layer-header-precomp');
        if (btnLayerPrecomp) {
          btnLayerPrecomp.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof precomposeSelectedLayers === 'function') {
              precomposeSelectedLayers(false, 'normal');
            }
          });
          btnLayerPrecomp.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof precomposeSelectedLayers === 'function') {
              precomposeSelectedLayers(true, 'normal');
            }
          });
        }

        // 1c. Mask Group Button (Group and Mask)
        const btnLayerGroupMask = document.getElementById('btn-layer-header-group-mask');
        if (btnLayerGroupMask) {
          btnLayerGroupMask.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof precomposeSelectedLayers === 'function') {
              precomposeSelectedLayers(false, 'mask');
            }
          });
        }

        // 1d. Exclude Group Button (Group and Exclude)
        const btnLayerGroupExclude = document.getElementById('btn-layer-header-group-exclude');
        if (btnLayerGroupExclude) {
          btnLayerGroupExclude.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof precomposeSelectedLayers === 'function') {
              precomposeSelectedLayers(false, 'exclude');
            }
          });
        }

        // 1e. Modular Floating Multi-Select Bottom Bar Actions
        const btnBatchFloatGroup = document.getElementById('btn-batch-float-group');
        if (btnBatchFloatGroup) {
          btnBatchFloatGroup.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof precomposeSelectedLayers === 'function') {
              precomposeSelectedLayers(false, 'normal');
            }
          });
          btnBatchFloatGroup.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof precomposeSelectedLayers === 'function') {
              precomposeSelectedLayers(true, 'normal');
            }
          });
        }

        const btnBatchFloatMask = document.getElementById('btn-batch-float-mask');
        if (btnBatchFloatMask) {
          btnBatchFloatMask.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof precomposeSelectedLayers === 'function') {
              precomposeSelectedLayers(false, 'mask');
            }
          });
        }

        const btnBatchFloatExclude = document.getElementById('btn-batch-float-exclude');
        if (btnBatchFloatExclude) {
          btnBatchFloatExclude.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof precomposeSelectedLayers === 'function') {
              precomposeSelectedLayers(false, 'exclude');
            }
          });
        }

        const btnBatchFloatSaveElement = document.getElementById('btn-batch-float-save-element');
        if (btnBatchFloatSaveElement) {
          btnBatchFloatSaveElement.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.openSaveElementModal === 'function') {
              window.openSaveElementModal();
            }
          });
        }

        const btnBatchFloatClose = document.getElementById('btn-batch-float-close');
        if (btnBatchFloatClose) {
          btnBatchFloatClose.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof deselectTimelineLayer === 'function') {
              deselectTimelineLayer();
            }
          });
        }

        // 2. Rename Layer Input
        const layerNameInput = document.getElementById('editor-layer-name-input');
        if (layerNameInput) {
          const saveRename = () => {
            const targetId = selectedLayerId || (selectedLayerIds ? Array.from(selectedLayerIds)[0] : null);
            if (!targetId || !currentProjectState.layers) return;
            const layer = currentProjectState.layers.find(l => l.id === targetId);
            if (layer) {
              const newName = layerNameInput.value.trim() || 'Untitled Layer';
              if (layer.name !== newName) {
                layer.name = newName;
                renderTimelineLayers();
                saveCurrentProjectLayers();
              }
            }
          };

          layerNameInput.addEventListener('change', saveRename);
          layerNameInput.addEventListener('blur', saveRename);
          layerNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              layerNameInput.blur();
            }
          });
        }

        // 3. Delete Selected Layer(s) Button
        const btnLayerDelete = document.getElementById('btn-layer-header-delete');
        if (btnLayerDelete) {
          btnLayerDelete.addEventListener('click', (e) => {
            e.stopPropagation();
            const idsToDelete = new Set();
            if (selectedLayerId) idsToDelete.add(selectedLayerId);
            if (selectedLayerIds && selectedLayerIds.size > 0) {
              selectedLayerIds.forEach(id => idsToDelete.add(id));
            }

            if (idsToDelete.size === 0 || !currentProjectState.layers) return;

            currentProjectState.layers.forEach(l => {
              if (idsToDelete.has(l.id)) {
                invalidatePreviewCacheForLayer(l);
              }
            });

            // Remove layers from project state
            const deletedLayers = currentProjectState.layers.filter(l => idsToDelete.has(l.id));
            currentProjectState.layers = currentProjectState.layers.filter(l => !idsToDelete.has(l.id));

            // Remove child layers from parent precomps if deleted
            currentProjectState.layers.forEach(l => {
              if (l.type === 'precomp' && Array.isArray(l.layers)) {
                const origLen = l.layers.length;
                l.layers = l.layers.filter(child => !idsToDelete.has(child.id));
                if (l.layers.length !== origLen) {
                  l._dirty = true;
                  if (l._precompBufferCanvas) l._precompBufferCanvas._lastRenderKey = null;
                }
              }
            });

            deletedLayers.forEach(l => {
              if (typeof window.releaseLayerMediaElement === 'function') {
                window.releaseLayerMediaElement(l);
              } else {
                const media = layerMediaCache.get(l.mediaId || l.id);
                if (media && media.el && typeof media.el.pause === 'function') {
                  try { media.el.pause(); } catch (_) {}
                }
                layerMediaCache.delete(l.id);
                layerMediaCache.delete(l.mediaId);
              }
            });

            // Clean up child layers pointing to deleted parents
            currentProjectState.layers.forEach(l => {
              if (idsToDelete.has(l.parentId)) {
                l.parentId = null;
                delete l.parentBind;
              }
            });

            // Close drawer & reset selection state
            if (window.Drawer && window.Drawer.isOpen('timeline-layer-drawer')) {
              window.Drawer.close(false);
            }
            selectedLayerId = null;
            window.selectedLayerId = null;
            if (selectedLayerIds) selectedLayerIds.clear();

            deselectTimelineLayer();
            renderTimelineLayers();
            saveCurrentProjectLayers();
            redrawComposition();
            updateEditorHeaderMode();
          });
        }

        // 3a. Motion Blur Toggle Button in Layer Header
        const btnLayerMotionBlur = document.getElementById('btn-layer-header-motion-blur');
        if (btnLayerMotionBlur) {
          btnLayerMotionBlur.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetIds = new Set();
            if (selectedLayerId) targetIds.add(selectedLayerId);
            if (selectedLayerIds && selectedLayerIds.size > 0) {
              selectedLayerIds.forEach(id => targetIds.add(id));
            }
            if (targetIds.size === 0 || !currentProjectState.layers) return;

            const firstLayer = currentProjectState.layers.find(l => targetIds.has(l.id));
            const nextState = firstLayer ? !firstLayer.motionBlur : true;

            currentProjectState.layers.forEach(l => {
              if (targetIds.has(l.id)) {
                l.motionBlur = nextState;
                if (l.type === 'text') {
                  l._textDirty = true;
                  if (l._textBufferCanvas) l._textBufferCanvas._lastRenderKey = null;
                  if (l._textMbCanvas) l._textMbCanvas._lastRenderKey = null;
                }
                invalidatePreviewCacheForLayer(l);
              }
            });

            if (nextState) {
              currentProjectState.motionBlur = currentProjectState.motionBlur || { shutterAngle: 180, shutterPhase: 0, samples: 16 };
              currentProjectState.motionBlur.enabled = true;
              try { localStorage.setItem('oft_global_motion_blur', 'true'); } catch (_) {}
              const globalMbIcon = document.getElementById('editor-icon-motion-blur');
              if (globalMbIcon) globalMbIcon.classList.add('is-active');
            }

            btnLayerMotionBlur.classList.toggle('is-active', nextState);

            targetIds.forEach(id => {
              const overlay = document.getElementById('timeline-lane-heads-overlay');
              const pillSlot = overlay ? overlay.querySelector(`.timeline-lane-pill-slot[data-layer-id="${id}"]`) : null;
              if (pillSlot) {
                const b = pillSlot.querySelector('.desktop-layer-mblur-btn');
                if (b) {
                  b.classList.toggle('is-active', nextState);
                  b.title = nextState ? 'Motion Blur: Enabled' : 'Motion Blur: Disabled';
                  b.setAttribute('aria-label', b.title);
                }
              }
            });

            const selectedTextLyr = getSelectedTextLayer();
            if (selectedTextLyr && targetIds.has(selectedTextLyr.id) && typeof syncTextFormatControls === 'function') {
              syncTextFormatControls(selectedTextLyr.textProps);
            }

            saveCurrentProjectLayers();
            redrawComposition();
          });
        }

        // 3a-3. 3D Layer Toggle Button in Layer Header
        const btnLayer3D = document.getElementById('btn-layer-header-3d');
        if (btnLayer3D) {
          btnLayer3D.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetIds = new Set();
            if (selectedLayerId) targetIds.add(selectedLayerId);
            if (selectedLayerIds && selectedLayerIds.size > 0) {
              selectedLayerIds.forEach(id => targetIds.add(id));
            }
            if (targetIds.size === 0 || !currentProjectState.layers) return;

            const firstLayer = currentProjectState.layers.find(l => targetIds.has(l.id));
            const nextState = firstLayer ? !firstLayer.is3D : true;

            currentProjectState.layers.forEach(l => {
              if (targetIds.has(l.id)) {
                l.is3D = nextState;
                if (typeof invalidatePreviewCacheForLayer === 'function') {
                  invalidatePreviewCacheForLayer(l);
                }
              }
            });

            btnLayer3D.classList.toggle('is-active', nextState);
            btnLayer3D.setAttribute('aria-pressed', String(nextState));

            targetIds.forEach(id => {
              const overlay = document.getElementById('timeline-lane-heads-overlay');
              const pillSlot = overlay ? overlay.querySelector(`.timeline-lane-pill-slot[data-layer-id="${id}"]`) : null;
              if (pillSlot) {
                const b = pillSlot.querySelector('.desktop-layer-3d-btn');
                if (b) {
                  b.classList.toggle('is-active', nextState);
                  b.title = nextState ? '3D Layer: Enabled' : '3D Layer: Disabled';
                  b.setAttribute('aria-label', b.title);
                }
              }
            });

            if (!nextState && typeof currentRotateAxis !== 'undefined') {
              currentRotateAxis = 'z';
            }

            if (typeof syncTransform3DVisibility === 'function') {
              syncTransform3DVisibility();
            } else if (typeof syncTransformControllerValues === 'function') {
              syncTransformControllerValues();
            }
            if (typeof renderTimelineLayers === 'function') {
              renderTimelineLayers();
            }
            saveCurrentProjectLayers();
            redrawComposition();
          });
        }

        // 3a-2. Collapse Transformations Toggle Button in Layer Header
        const btnLayerCollapse = document.getElementById('btn-layer-header-collapse');
        if (btnLayerCollapse) {
          btnLayerCollapse.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetId = (typeof selectedLayerId !== 'undefined' && selectedLayerId) || window.selectedLayerId || (selectedLayerIds ? Array.from(selectedLayerIds)[0] : null);
            if (!targetId || !currentProjectState.layers) return;
            const layer = currentProjectState.layers.find(l => l.id === targetId);
            if (!layer || layer.type !== 'precomp') return;

            layer.collapseTransformations = !layer.collapseTransformations;
            const nextState = !!layer.collapseTransformations;
            btnLayerCollapse.classList.toggle('is-active', nextState);
            btnLayerCollapse.setAttribute('aria-pressed', String(nextState));

            const btnEditShape = document.getElementById('btn-layer-edit-shape');
            if (btnEditShape) {
              btnEditShape.style.display = nextState ? 'none' : 'inline-flex';
            }
            if (nextState && currentDrawerSubview === 'shape') {
              switchLayerDrawerSubview('main');
            }
            const actionGrid = document.getElementById('layer-action-btn-grid');
            if (actionGrid) {
              const allBtns = Array.from(actionGrid.querySelectorAll('.layer-action-btn'));
              const visibleBtns = allBtns.filter(b => b.style.display !== 'none');
              const count = visibleBtns.length;
              actionGrid.classList.remove('is-solo-mode', 'is-2-items', 'is-3-items', 'is-4-items', 'is-5-items', 'is-6-items');
              if (count === 1) actionGrid.classList.add('is-solo-mode');
              else if (count === 2) actionGrid.classList.add('is-2-items');
              else if (count === 3) actionGrid.classList.add('is-3-items');
              else if (count === 4) actionGrid.classList.add('is-4-items');
              else if (count === 5) actionGrid.classList.add('is-5-items');
              else if (count >= 6) actionGrid.classList.add('is-6-items');
            }

            layer._precompBufferCanvas = null;
            if (window.PreviewCacheManager) {
              if (typeof window.PreviewCacheManager.clearPool === 'function') {
                window.PreviewCacheManager.clearPool(layer.id);
              } else if (typeof window.PreviewCacheManager.clearAll === 'function') {
                window.PreviewCacheManager.clearAll('all');
              } else if (typeof window.PreviewCacheManager.clear === 'function') {
                window.PreviewCacheManager.clear();
              }
            }
            if (typeof invalidatePreviewCacheForLayer === 'function') {
              invalidatePreviewCacheForLayer(layer);
            }
            saveCurrentProjectLayers(true);
            redrawComposition('togglePrecompCollapse');
          });
        }

        // 3b. Link / Parent Layer Button (Press to open link list; drag/scrub across layer items; release to link)
        const btnLayerLink = document.getElementById('btn-layer-header-link');
        if (btnLayerLink) {
          btnLayerLink.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;

            const startX = e.clientX;
            const startY = e.clientY;
            const popoverEl = document.getElementById('popover-layer-link');
            const wasAlreadyOpen = popoverEl && popoverEl.classList.contains('is-open') && window.Popover && window.Popover.isOpen && window.Popover.isOpen();

            let isLinkScrubbing = false;
            let currentDragItem = null;

            // Open popover immediately on press so layer items are built and rendered
            if (typeof openLayerLinkPopover === 'function') {
              openLayerLinkPopover(btnLayerLink);
              if (popoverEl) {
                popoverEl.classList.add('is-open');
                popoverEl.setAttribute('aria-hidden', 'false');
              }
            }

            try {
              btnLayerLink.setPointerCapture(e.pointerId);
            } catch (_) {}

            function cleanupHover() {
              if (popoverEl) {
                popoverEl.querySelectorAll('.layer-link-item.is-drag-hover').forEach(el => el.classList.remove('is-drag-hover'));
              }
              currentDragItem = null;
            }

            function onGlobalLinkMove(moveEv) {
              const dist = Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY);
              if (dist > 6) {
                isLinkScrubbing = true;
              }

              if (!isLinkScrubbing) return;
              moveEv.preventDefault();

              // Hit test for layer link item
              const hitEl = document.elementFromPoint(moveEv.clientX, moveEv.clientY);
              const itemBtn = hitEl ? hitEl.closest('.layer-link-item') : null;

              if (itemBtn && !itemBtn.disabled && !itemBtn.classList.contains('is-disabled')) {
                if (itemBtn !== currentDragItem) {
                  cleanupHover();
                  itemBtn.classList.add('is-drag-hover');
                  currentDragItem = itemBtn;
                  if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
                }
              } else {
                cleanupHover();
              }

              // Auto-scroll list if finger is near top or bottom edge of list container
              const listContainer = document.getElementById('layer-link-popover-list');
              if (listContainer && listContainer.scrollHeight > listContainer.clientHeight) {
                const rect = listContainer.getBoundingClientRect();
                if (moveEv.clientX >= rect.left - 24 && moveEv.clientX <= rect.right + 24) {
                  if (moveEv.clientY > rect.bottom - 32 && moveEv.clientY <= rect.bottom + 40) {
                    listContainer.scrollTop += 6;
                  } else if (moveEv.clientY < rect.top + 32 && moveEv.clientY >= rect.top - 40) {
                    listContainer.scrollTop -= 6;
                  }
                }
              }
            }

            function onGlobalLinkUp(upEv) {
              window.removeEventListener('pointermove', onGlobalLinkMove);
              window.removeEventListener('pointerup', onGlobalLinkUp);
              window.removeEventListener('pointercancel', onGlobalLinkUp);
              try {
                btnLayerLink.releasePointerCapture(e.pointerId);
              } catch (_) {}

              const finalItem = currentDragItem;
              cleanupHover();

              if (isLinkScrubbing) {
                if (finalItem) {
                  // Released on a specific layer item -> execute link/unlink!
                  finalItem.click();
                  if (navigator.vibrate) try { navigator.vibrate([15, 35]); } catch (_) {}
                  if (window.Popover) window.Popover.close();
                } else {
                  // Dragged but released outside any valid item -> check if released outside popover card
                  const cardRect = popoverEl ? popoverEl.getBoundingClientRect() : null;
                  const isOutside = !cardRect || upEv.clientX < cardRect.left || upEv.clientX > cardRect.right || upEv.clientY < cardRect.top || upEv.clientY > cardRect.bottom;
                  if (isOutside && window.Popover) {
                    window.Popover.close();
                  }
                }
                btnLayerLink._suppressNextClick = true;
                setTimeout(() => { btnLayerLink._suppressNextClick = false; }, 250);
              } else {
                // Not scrubbing (was quick tap / release without drag)
                if (wasAlreadyOpen) {
                  // Tapped while already open -> toggle close
                  if (window.Popover) window.Popover.close();
                  btnLayerLink._suppressNextClick = true;
                  setTimeout(() => { btnLayerLink._suppressNextClick = false; }, 250);
                }
              }
            }

            window.addEventListener('pointermove', onGlobalLinkMove, { passive: false });
            window.addEventListener('pointerup', onGlobalLinkUp);
            window.addEventListener('pointercancel', onGlobalLinkUp);
          });

          btnLayerLink.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (btnLayerLink._suppressNextClick) {
              btnLayerLink._suppressNextClick = false;
              return;
            }
            if (typeof openLayerLinkPopover === 'function') {
              openLayerLinkPopover(btnLayerLink);
            }
          });
        }

        // 4. Layer More / Settings Button & Layer Actions Popover
        const btnLayerMore = document.getElementById('btn-layer-header-more');
        if (btnLayerMore) {
          btnLayerMore.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const targetId = selectedLayerId || (selectedLayerIds ? Array.from(selectedLayerIds)[0] : null);
            const layer = (currentProjectState.layers || []).find(l => l.id === targetId);
            if (!layer) return;
            updateLayerActionsPopoverState(layer);
            if (window.Popover) {
              window.Popover.open(btnLayerMore, 'popover-layer-actions');
            }
          });
        }

        const btnCopy = document.getElementById('popover-btn-copy');
        if (btnCopy) {
          btnCopy.addEventListener('click', (e) => {
            e.stopPropagation();
            if (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0) {
              copySelectedKeyframes();
            } else {
              copySelectedLayers();
            }
          });
        }

        const btnPaste = document.getElementById('popover-btn-paste');
        if (btnPaste) {
          btnPaste.addEventListener('click', (e) => {
            e.stopPropagation();
            const hasKeyframesSelected = Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0;
            const hasKeyframeClip = window.internalKeyframeClipboard && Array.isArray(window.internalKeyframeClipboard.items) && window.internalKeyframeClipboard.items.length > 0;
            const shouldPasteKeyframe = (window.lastClipboardType === 'keyframe' && hasKeyframeClip) || (hasKeyframesSelected && hasKeyframeClip);

            if (shouldPasteKeyframe) {
              pasteKeyframes();
            } else {
              pasteLayers();
            }
          });
        }

        const btnDuplicate = document.getElementById('popover-btn-duplicate');
        if (btnDuplicate) {
          btnDuplicate.addEventListener('click', (e) => {
            e.stopPropagation();
            duplicateSelectedLayers();
          });
        }

        const btnPrecompose = document.getElementById('popover-btn-precompose');
        if (btnPrecompose) {
          btnPrecompose.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof precomposeSelectedLayers === 'function') {
              precomposeSelectedLayers();
            }
          });
        }

        const btnUngroup = document.getElementById('popover-btn-ungroup');
        if (btnUngroup) {
          btnUngroup.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof ungroupPrecompose === 'function') {
              ungroupPrecompose();
            }
          });
        }

        const btnSelectAll = document.getElementById('popover-btn-select-all');
        if (btnSelectAll) {
          btnSelectAll._bound = true;
          btnSelectAll.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.Popover) window.Popover.close();
            selectAllTimelineLayers();
          });
        }

        const btnFitComp = document.getElementById('popover-btn-fit-comp');
        if (btnFitComp) {
          btnFitComp.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.applyFitOrStretchToComposition === 'function') {
              window.applyFitOrStretchToComposition('fit');
            }
          });
        }

        const btnStretchComp = document.getElementById('popover-btn-stretch-comp');
        if (btnStretchComp) {
          btnStretchComp.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.applyFitOrStretchToComposition === 'function') {
              window.applyFitOrStretchToComposition('stretch');
            }
          });
        }

        const btnExtractAudio = document.getElementById('popover-btn-extract-audio');
        if (btnExtractAudio) {
          btnExtractAudio.addEventListener('click', (e) => {
            e.stopPropagation();
            extractAudioFromSelectedVideo();
          });
        }
      })();

      // Internal Layer & Keyframe Clipboard & Modular Actions Logic
      window.internalLayerClipboard = null;
      window.internalKeyframeClipboard = null;
      window.lastClipboardType = null;
      lastContextClickSec = null;

      function isKeyframePropCompatible(clipProp, targetProp) {
        if (!clipProp || !targetProp) return false;
        if (clipProp === targetProp) return true;

        const isPos = p => p === 'move' || p === 'pos' || p === 'position';
        if (isPos(clipProp) && isPos(targetProp)) return true;

        const isRot = p => p === 'rotate' || p === 'rotZ' || p === 'rotation';
        if (isRot(clipProp) && isRot(targetProp)) return true;

        const isScale = p => p === 'scale' || p === 'scaleW' || p === 'scaleH';
        if (isScale(clipProp) && isScale(targetProp)) return true;

        const isSkew = p => p === 'skew' || p === 'skewX' || p === 'skewY';
        if (isSkew(clipProp) && isSkew(targetProp)) return true;

        if (clipProp === 'opacity' && targetProp === 'opacity') return true;
        if (clipProp === 'volume' && targetProp === 'volume') return true;
        if (clipProp === 'speed' && targetProp === 'speed') return true;

        if (clipProp.startsWith('camera') && targetProp.startsWith('camera')) {
          return clipProp === targetProp;
        }

        if (clipProp.includes(':') && targetProp.includes(':')) {
          const clipParam = clipProp.split(':')[1];
          const targetParam = targetProp.split(':')[1];
          return clipParam === targetParam;
        }

        return false;
      }
      window.isKeyframePropCompatible = isKeyframePropCompatible;

      function copySelectedKeyframes() {
        if (!Array.isArray(window.selectedKeyframes) || window.selectedKeyframes.length === 0) return;
        const items = [...window.selectedKeyframes];
        const primaryProp = items[0].prop;
        const minTime = Math.min(...items.map(it => (it.kf ? it.kf.time : it.time)));

        window.internalKeyframeClipboard = {
          prop: primaryProp,
          items: items.map(it => {
            let val = null;
            let easing = null;
            let easingConfig = null;
            if (it.kf) {
              val = it.kf.value !== undefined ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(it.kf.value) : (Array.isArray(it.kf.value) ? [] : {})) : null;
              easing = it.kf.easing ? [...it.kf.easing] : null;
              if (it.kf.easingConfig) easingConfig = cloneEasingConfig(it.kf.easingConfig);
            } else {
              const lyr = it.layer || (currentProjectState.layers || []).find(l => l.id === it.layerId);
              if (lyr && lyr.keyframes && lyr.keyframes[it.prop]) {
                const found = lyr.keyframes[it.prop].find(k => Math.abs(k.time - it.time) < 0.002);
                if (found) {
                  val = found.value !== undefined ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(found.value) : (Array.isArray(found.value) ? [] : {})) : null;
                  easing = found.easing ? [...found.easing] : null;
                  if (found.easingConfig) easingConfig = cloneEasingConfig(found.easingConfig);
                }
              }
            }
            return {
              prop: it.prop,
              offsetSec: Number(((it.kf ? it.kf.time : it.time) - minTime).toFixed(4)),
              value: val,
              easing: easing,
              easingConfig: easingConfig
            };
          })
        };
        window.lastClipboardType = 'keyframe';
        if (window.Popover) window.Popover.close();
      }
      window.copySelectedKeyframes = copySelectedKeyframes;

      function pasteKeyframes() {
        if (!window.internalKeyframeClipboard || !Array.isArray(window.internalKeyframeClipboard.items) || window.internalKeyframeClipboard.items.length === 0) {
          return false;
        }

        const targetLayer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId)
          || ((selectedLayerIds && selectedLayerIds.size > 0) ? (currentProjectState.layers || []).find(l => selectedLayerIds.has(l.id)) : null);

        if (!targetLayer) return false;

        const clipProp = window.internalKeyframeClipboard.prop;
        let targetProp = null;
        if (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0) {
          targetProp = window.selectedKeyframes[0].prop;
        } else if (window.activeKeyframeProperty) {
          targetProp = window.activeKeyframeProperty;
        } else if (window.activeTransformTool && isKeyframePropCompatible(clipProp, window.activeTransformTool)) {
          targetProp = window.activeTransformTool;
        } else {
          targetProp = clipProp;
        }

        if (!isKeyframePropCompatible(clipProp, targetProp)) {
          targetProp = clipProp;
        }

        if (window.Popover) window.Popover.close();

        let baseSec = (typeof window.getCurrentPlayheadTime === 'function')
          ? window.getCurrentPlayheadTime()
          : (typeof window.currentSec === 'number' ? window.currentSec : 0);
        const effectiveContextSec = (lastContextClickSec !== null && typeof lastContextClickSec === 'number')
          ? lastContextClickSec
          : (typeof window !== 'undefined' && typeof window.lastContextClickSec === 'number' ? window.lastContextClickSec : null);
        if (effectiveContextSec !== null) {
          baseSec = effectiveContextSec;
        }
        lastContextClickSec = null;
        if (typeof window !== 'undefined') window.lastContextClickSec = null;

        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        if (!targetLayer.keyframes) targetLayer.keyframes = {};

        const pastedList = [];
        window.internalKeyframeClipboard.items.forEach(item => {
          const itemProp = (item.prop && isKeyframePropCompatible(item.prop, targetProp)) ? targetProp : (item.prop || targetProp);
          if (!targetLayer.keyframes[itemProp]) targetLayer.keyframes[itemProp] = [];

          const pasteTime = Number((baseSec + item.offsetSec).toFixed(4));
          targetLayer.keyframes[itemProp] = targetLayer.keyframes[itemProp].filter(k => Math.abs(k.time - pasteTime) > 0.005);

          const newKf = {
            time: pasteTime,
            value: item.value !== null ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(item.value) : (Array.isArray(item.value) ? [] : {})) : (typeof getLayerPropertyValue === 'function' ? getLayerPropertyValue(targetLayer, itemProp) : null),
            easing: item.easing ? [...item.easing] : [0.0, 0.0, 1.0, 1.0]
          };
          if (item.easingConfig) newKf.easingConfig = cloneEasingConfig(item.easingConfig);
          targetLayer.keyframes[itemProp].push(newKf);
          targetLayer.keyframes[itemProp].sort((a, b) => a.time - b.time);
          pastedList.push({
            layerId: targetLayer.id,
            layer: targetLayer,
            prop: itemProp,
            time: pasteTime,
            kf: newKf
          });
        });

        window.selectedKeyframes = pastedList;

        if (typeof invalidatePreviewCacheForLayer === 'function') {
          invalidatePreviewCacheForLayer(targetLayer);
        }
        if (typeof syncLayerWithEffectiveProps === 'function') {
          syncLayerWithEffectiveProps(targetLayer);
        }

        saveCurrentProjectLayers();
        renderTimelineLayers();
        if (typeof updateTransformKeyframeBtnState === 'function') updateTransformKeyframeBtnState();
        if (typeof updateBlendKeyframeBtnState === 'function') updateBlendKeyframeBtnState();
        if (typeof syncEffectsKeyframeState === 'function') syncEffectsKeyframeState(targetLayer);
        if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
        if (typeof syncEffectsRackUI === 'function') syncEffectsRackUI();
        if (typeof updateTimelineKeyframeMarkersHighlight === 'function') updateTimelineKeyframeMarkersHighlight();
        if (typeof updateGraphEditorUI === 'function') updateGraphEditorUI();
        if (typeof redrawComposition === 'function') redrawComposition('pasteKeyframes');

        return true;
      }
      window.pasteKeyframes = pasteKeyframes;

      function updateLayerActionsPopoverState(contextLayer = null, isFromEmptyTimeline = false) {
        const copyBtn = document.getElementById('popover-btn-copy');
        const copyLabel = document.getElementById('popover-label-copy');
        const pasteBtn = document.getElementById('popover-btn-paste');
        const pasteLabel = document.getElementById('popover-label-paste');
        const duplicateBtn = document.getElementById('popover-btn-duplicate');
        const duplicateLabel = document.getElementById('popover-label-duplicate');
        const precomposeBtn = document.getElementById('popover-btn-precompose');
        const precomposeLabel = document.getElementById('popover-label-precompose');
        const extractBtn = document.getElementById('popover-btn-extract-audio');
        const audioDivider = document.getElementById('popover-layer-audio-divider');

        const layers = currentProjectState.layers || [];

        const hasKeyframesSelected = Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0;
        const kfCount = hasKeyframesSelected ? window.selectedKeyframes.length : 0;

        // Determine effective selected layer count
        const selectedCount = (selectedLayerIds && selectedLayerIds.size > 0)
          ? selectedLayerIds.size
          : (selectedLayerId ? 1 : 0);

        // 1. Copy State
        if (copyBtn) {
          if (hasKeyframesSelected) {
            copyBtn.removeAttribute('disabled');
            if (copyLabel) {
              copyLabel.textContent = kfCount > 1 ? `Copy (${kfCount} Keyframes)` : 'Copy Keyframe';
            }
          } else if (selectedCount > 0) {
            copyBtn.removeAttribute('disabled');
            if (copyLabel) {
              copyLabel.textContent = selectedCount > 1 ? `Copy (${selectedCount} Layers)` : 'Copy';
            }
          } else {
            copyBtn.setAttribute('disabled', 'true');
            if (copyLabel) copyLabel.textContent = 'Copy';
          }
        }

        // 2. Paste State
        const hasKeyframeClip = window.internalKeyframeClipboard && Array.isArray(window.internalKeyframeClipboard.items) && window.internalKeyframeClipboard.items.length > 0;
        const clipLayerCount = (window.internalLayerClipboard && window.internalLayerClipboard.length) || 0;
        const shouldPasteKeyframe = (window.lastClipboardType === 'keyframe' && hasKeyframeClip) || (hasKeyframesSelected && hasKeyframeClip);

        if (pasteBtn) {
          if (shouldPasteKeyframe) {
            const clipProp = window.internalKeyframeClipboard.prop;
            const targetProp = (hasKeyframesSelected && window.selectedKeyframes[0].prop)
              || window.activeKeyframeProperty
              || (window.activeTransformTool && isKeyframePropCompatible(clipProp, window.activeTransformTool) ? window.activeTransformTool : null)
              || clipProp;
            const isCompatible = isKeyframePropCompatible(clipProp, targetProp);

            if (isCompatible) {
              pasteBtn.removeAttribute('disabled');
              if (pasteLabel) {
                const count = window.internalKeyframeClipboard.items.length;
                pasteLabel.textContent = count > 1 ? `Paste (${count} Keyframes)` : 'Paste Keyframe';
              }
            } else {
              pasteBtn.setAttribute('disabled', 'true');
              if (pasteLabel) {
                pasteLabel.textContent = 'Paste (Type Mismatch)';
              }
            }
          } else if (clipLayerCount > 0) {
            pasteBtn.removeAttribute('disabled');
            if (pasteLabel) {
              pasteLabel.textContent = clipLayerCount > 1 ? `Paste (${clipLayerCount} Layers)` : 'Paste';
            }
          } else {
            pasteBtn.setAttribute('disabled', 'true');
            if (pasteLabel) pasteLabel.textContent = 'Paste';
          }
        }

        // 3. Duplicate State
        if (duplicateBtn) {
          if (hasKeyframesSelected) {
            duplicateBtn.setAttribute('disabled', 'true');
            if (duplicateLabel) duplicateLabel.textContent = 'Duplicate';
          } else if (selectedCount > 0) {
            duplicateBtn.removeAttribute('disabled');
            if (duplicateLabel) {
              duplicateLabel.textContent = selectedCount > 1 ? `Duplicate (${selectedCount})` : 'Duplicate';
            }
          } else {
            duplicateBtn.setAttribute('disabled', 'true');
            if (duplicateLabel) duplicateLabel.textContent = 'Duplicate';
          }
        }

        // 3b. Precompose / Group State (Text only)
        if (precomposeBtn) {
          if (!hasKeyframesSelected && selectedCount > 0 && !isFromEmptyTimeline) {
            precomposeBtn.removeAttribute('disabled');
            precomposeBtn.style.display = 'flex';
            if (precomposeLabel) {
              precomposeLabel.textContent = selectedCount > 1 ? `Group (${selectedCount})` : 'Group';
            }
          } else {
            precomposeBtn.setAttribute('disabled', 'true');
            precomposeBtn.style.display = 'none';
            if (precomposeLabel) precomposeLabel.textContent = 'Group';
          }
        }

        // 3b-2. Un Group State (Only for precomp layers)
        const ungroupBtn = document.getElementById('popover-btn-ungroup');
        const ungroupLabel = document.getElementById('popover-label-ungroup');
        if (ungroupBtn) {
          let hasPrecomp = false;
          if (!hasKeyframesSelected && selectedCount > 0 && !isFromEmptyTimeline) {
            if (contextLayer) {
              hasPrecomp = (contextLayer.type === 'precomp');
            } else {
              const selectedLayersList = layers.filter(l => {
                if (selectedLayerIds && selectedLayerIds.size > 0) return selectedLayerIds.has(l.id);
                return l.id === selectedLayerId;
              });
              hasPrecomp = selectedLayersList.length > 0 && selectedLayersList.every(l => l.type === 'precomp');
            }
          }

          if (hasPrecomp) {
            ungroupBtn.removeAttribute('disabled');
            ungroupBtn.style.display = 'flex';
            if (ungroupLabel) {
              ungroupLabel.textContent = 'Un Group';
            }
          } else {
            ungroupBtn.setAttribute('disabled', 'true');
            ungroupBtn.style.display = 'none';
            if (ungroupLabel) ungroupLabel.textContent = 'Un Group';
          }
        }

        // 3c. Save as Element State (Single or Multi-layer selection)
        const saveElemBtn = document.getElementById('popover-btn-save-element');
        const saveElemLabel = document.getElementById('popover-label-save-element');
        if (saveElemBtn) {
          if (!hasKeyframesSelected && selectedCount >= 1 && !isFromEmptyTimeline) {
            saveElemBtn.removeAttribute('disabled');
            saveElemBtn.style.display = 'flex';
            if (saveElemLabel) {
              saveElemLabel.textContent = selectedCount > 1 ? `Save as Element (${selectedCount})` : 'Save as Element';
            }
          } else {
            saveElemBtn.setAttribute('disabled', 'true');
            saveElemBtn.style.display = 'none';
            if (saveElemLabel) {
              saveElemLabel.textContent = 'Save as Element';
            }
          }
        }

        // 3d. Fit to Composition & Stretch to Composition (Visual layers)
        const fitCompBtn = document.getElementById('popover-btn-fit-comp');
        const stretchCompBtn = document.getElementById('popover-btn-stretch-comp');
        const transformDivider = document.getElementById('popover-layer-transform-divider');
        let hasVisualTarget = false;
        if (!hasKeyframesSelected && selectedCount >= 1 && !isFromEmptyTimeline) {
          const checkLayers = [];
          if (selectedLayerIds && selectedLayerIds.size > 0) {
            selectedLayerIds.forEach(id => {
              const found = layers.find(l => l.id === id);
              if (found) checkLayers.push(found);
            });
          } else if (contextLayer) {
            checkLayers.push(contextLayer);
          } else if (selectedLayerId) {
            const found = layers.find(l => l.id === selectedLayerId);
            if (found) checkLayers.push(found);
          }
          hasVisualTarget = checkLayers.some(l => l && l.type !== 'audio' && l.type !== 'camera' && l.type !== 'null');
        }
        if (fitCompBtn) {
          if (hasVisualTarget) {
            fitCompBtn.removeAttribute('disabled');
            fitCompBtn.style.display = 'flex';
          } else {
            fitCompBtn.setAttribute('disabled', 'true');
            fitCompBtn.style.display = 'none';
          }
        }
        if (stretchCompBtn) {
          if (hasVisualTarget) {
            stretchCompBtn.removeAttribute('disabled');
            stretchCompBtn.style.display = 'flex';
          } else {
            stretchCompBtn.setAttribute('disabled', 'true');
            stretchCompBtn.style.display = 'none';
          }
        }
        if (transformDivider) {
          transformDivider.style.display = hasVisualTarget ? 'block' : 'none';
        }

        // 4. Extract Audio State (Only for single selected video)
        let isSingleVideo = false;
        if (!hasKeyframesSelected && selectedCount === 1) {
          if (contextLayer && contextLayer.type === 'video') {
            isSingleVideo = true;
          } else {
            const targetId = selectedLayerId || (selectedLayerIds ? Array.from(selectedLayerIds)[0] : null);
            const found = layers.find(l => l.id === targetId);
            if (found && found.type === 'video') isSingleVideo = true;
          }
        }
        if (extractBtn) {
          extractBtn.style.display = isSingleVideo ? 'flex' : 'none';
        }
        if (audioDivider) {
          audioDivider.style.display = isSingleVideo ? 'block' : 'none';
        }
      }
      window.updateLayerActionsPopoverState = updateLayerActionsPopoverState;

      function selectAllTimelineLayers() {
        const layers = currentProjectState.layers || [];
        if (layers.length === 0) return;
        if (window.Popover) window.Popover.close();

        selectedLayerIds.clear();
        layers.forEach(l => selectedLayerIds.add(l.id));
        selectedLayerId = layers[0].id;
        window.selectedLayerId = selectedLayerId;
        window.selectedLayerIds = selectedLayerIds;
        isSelectorMode = true;

        updateEditorHeaderMode();
        renderTimelineLayers();
        redrawComposition('selectAll');
      }
      window.selectAllTimelineLayers = selectAllTimelineLayers;

      function copySelectedLayers() {
        const ids = [];
        if (selectedLayerId) ids.push(selectedLayerId);
        if (window.selectedLayerId && !ids.includes(window.selectedLayerId)) ids.push(window.selectedLayerId);
        if (selectedLayerIds && selectedLayerIds.size > 0) {
          selectedLayerIds.forEach(id => { if (!ids.includes(id)) ids.push(id); });
        }
        if (window.selectedLayerIds && window.selectedLayerIds.size > 0) {
          window.selectedLayerIds.forEach(id => { if (!ids.includes(id)) ids.push(id); });
        }
        if (ids.length === 0 || !currentProjectState.layers) return;

        const copied = currentProjectState.layers
          .filter(l => ids.includes(l.id))
          .map(l => (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l) : (Array.isArray(l) ? [] : {})));

        if (copied.length > 0) {
          const curPanX = (typeof panX === 'number') ? panX : (window.timelinePanX !== undefined ? window.timelinePanX : 0);
          const curPps = (typeof pixelsPerSecond === 'number' && pixelsPerSecond > 0) ? pixelsPerSecond : (window.currentPixelsPerSecond || 80);
          const copyPlayheadSec = (typeof getCurrentPlayheadTime === 'function')
            ? getCurrentPlayheadTime()
            : Math.max(0, -curPanX / curPps);
          const minCopyStartSec = Math.min(...copied.map(l => (l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / curPps))));
          const maxCopyEndSec = Math.max(...copied.map(l => {
            const s = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / curPps);
            const d = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 320) / curPps);
            return s + d;
          }));
          // Preserve exact playhead offset at copy time when playhead is inside the copied layer(s) span
          const anchorSec = (copyPlayheadSec >= minCopyStartSec - 0.001 && copyPlayheadSec <= maxCopyEndSec + 0.001)
            ? copyPlayheadSec
            : minCopyStartSec;

          window.internalLayerClipboard = copied;
          window.internalLayerClipboardAnchorSec = anchorSec;
          window.lastClipboardType = 'layer';
          if (copied.length === 1 && typeof window.FishAttributesClipboard !== 'undefined' && typeof window.FishAttributesClipboard.syncFromLayer === 'function') {
            window.FishAttributesClipboard.syncFromLayer(copied[0]);
          }
        }
        if (window.Popover) window.Popover.close();
      }
      window.copySelectedLayers = copySelectedLayers;

      function pasteLayers(overrideStartSec = null) {
        if (!window.internalLayerClipboard || window.internalLayerClipboard.length === 0 || !currentProjectState.layers) return;
        if (window.Popover) window.Popover.close();

        const curPanX = (typeof panX === 'number') ? panX : (window.timelinePanX !== undefined ? window.timelinePanX : 0);
        const curPps = (typeof pixelsPerSecond === 'number' && pixelsPerSecond > 0) ? pixelsPerSecond : (window.currentPixelsPerSecond || 80);
        let curPlayheadSec = Math.max(0, -curPanX / curPps);

        const effectiveContextSec = (lastContextClickSec !== null && typeof lastContextClickSec === 'number')
          ? lastContextClickSec
          : (typeof window !== 'undefined' && typeof window.lastContextClickSec === 'number' ? window.lastContextClickSec : null);
        if (overrideStartSec !== null && typeof overrideStartSec === 'number') {
          curPlayheadSec = overrideStartSec;
        } else if (effectiveContextSec !== null) {
          curPlayheadSec = effectiveContextSec;
        }
        lastContextClickSec = null;
        if (typeof window !== 'undefined') window.lastContextClickSec = null;

        const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60);
        const minStartSec = Math.min(...window.internalLayerClipboard.map(l => (l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / curPps))));
        const anchorSec = (typeof window.internalLayerClipboardAnchorSec === 'number' && isFinite(window.internalLayerClipboardAnchorSec))
          ? window.internalLayerClipboardAnchorSec
          : minStartSec;
        const rawDeltaSec = Math.max(-minStartSec, curPlayheadSec - anchorSec);
        const deltaSec = Math.round(rawDeltaSec * safeFps) / safeFps;

        // Pass 1: generate unique ID map for all copied layers to preserve internal hierarchy
        const idMap = new Map();
        window.internalLayerClipboard.forEach((l, idx) => {
          const newId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6) + '_' + (currentProjectState.layers.length + idx);
          idMap.set(l.id, newId);
        });

        const newPastedIds = [];
        const newPastedLayers = [];
        window.internalLayerClipboard.forEach((l) => {
          const origStartSec = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / curPps);
          const newStartSec = Math.max(0, Math.round((origStartSec + deltaSec) * safeFps) / safeFps);
          const newStartPx = Math.round(newStartSec * curPps);
          const newId = idMap.get(l.id);

          // Deep clone keyframes & shift all times by deltaSec so animation aligns with pasted layer
          let clonedKeyframes = l.keyframes ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.keyframes) : JSON.parse(JSON.stringify(l.keyframes))) : undefined;
          if (clonedKeyframes && Math.abs(deltaSec) > 0.0001) {
            Object.keys(clonedKeyframes).forEach(prop => {
              if (Array.isArray(clonedKeyframes[prop])) {
                clonedKeyframes[prop].forEach(kf => {
                  if (typeof kf.time === 'number') {
                    kf.time = Number(Math.max(0, kf.time + deltaSec).toFixed(4));
                  }
                });
              }
            });
          }

          // Deep clone 100% of all effects and remap their keyframes
          let clonedEffects = undefined;
          if (Array.isArray(l.effects)) {
            clonedEffects = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.effects) : JSON.parse(JSON.stringify(l.effects)));
            clonedEffects.forEach(fx => {
              const oldId = fx.id;
              const newFxId = 'fx_' + (fx.type || 'effect') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + Math.floor(Math.random() * 1000);
              fx.id = newFxId;
              if (clonedKeyframes) {
                Object.keys(clonedKeyframes).forEach(k => {
                  if (k.startsWith(oldId + ':')) {
                    const paramName = k.slice(oldId.length + 1);
                    clonedKeyframes[`${newFxId}:${paramName}`] = clonedKeyframes[k];
                    delete clonedKeyframes[k];
                  }
                });
              }
            });
          }

          let clonedAudioEffects = Array.isArray(l.audioEffects) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.audioEffects) : JSON.parse(JSON.stringify(l.audioEffects))) : undefined;
          if (clonedAudioEffects) {
            clonedAudioEffects.forEach(fx => {
              fx.id = 'fx_' + (fx.type || 'audio') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            });
          }

          // Remap parentId if parent layer is also part of the copied set
          const newParentId = (l.parentId && idMap.has(l.parentId)) ? idMap.get(l.parentId) : (l.parentId || null);

          const clonedLayer = Object.assign({}, (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l) : JSON.parse(JSON.stringify(l))), {
            id: newId,
            name: l.name ? (l.name + ' (Copy)') : 'Layer (Copy)',
            startSec: newStartSec,
            startPx: newStartPx,
            parentId: newParentId,
            parentBind: l.parentBind ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.parentBind) : JSON.parse(JSON.stringify(l.parentBind))) : undefined,
            effects: clonedEffects,
            audioEffects: clonedAudioEffects,
            keyframes: clonedKeyframes
          });

          // Preserve in-memory references & cache handles (AI cutout, media cache, frame extractor)
          if (l._bgCutoutBitmap) clonedLayer._bgCutoutBitmap = l._bgCutoutBitmap;
          if (l._lastMattingModel) clonedLayer._lastMattingModel = l._lastMattingModel;
          if (l._fillMediaImg) clonedLayer._fillMediaImg = l._fillMediaImg;
          if (l._lastRenderedFrame) clonedLayer._lastRenderedFrame = l._lastRenderedFrame;

          if (window.FishBgRemovalEngine) {
            const cutout = l._bgCutoutBitmap || window.FishBgRemovalEngine.getPhotoCutout(l);
            if (cutout) {
              clonedLayer._bgCutoutBitmap = cutout;
              if (window.FishBgRemovalEngine._photoCutoutCache) {
                window.FishBgRemovalEngine._photoCutoutCache.set(newId, cutout);
                if (clonedLayer.mediaId) window.FishBgRemovalEngine._photoCutoutCache.set(clonedLayer.mediaId, cutout);
              }
            }
          }

          if (window.layerMediaCache) {
            const origMedia = window.layerMediaCache.get(l.id) || (l.mediaId ? window.layerMediaCache.get(l.mediaId) : null);
            if (origMedia) {
              window.layerMediaCache.set(newId, origMedia);
            }
          }

          if (l.type === 'video' && !clonedLayer.mediaId) {
            clonedLayer.mediaId = l.mediaId || l.sourceVideoId || l.id;
          }

          invalidatePreviewCacheForLayer(clonedLayer);
          newPastedLayers.push(clonedLayer);
          newPastedIds.push(newId);
        });

        // Insert in exact original top-to-bottom stack order directly above selected layer
        const pasteInsertIdx = (typeof window.getLayerInsertionIndex === 'function') ? window.getLayerInsertionIndex() : 0;
        if (pasteInsertIdx >= 0 && pasteInsertIdx <= currentProjectState.layers.length) {
          currentProjectState.layers.splice(pasteInsertIdx, 0, ...newPastedLayers);
        } else {
          currentProjectState.layers.unshift(...newPastedLayers);
        }

        saveCurrentProjectLayers();
        renderTimelineLayers();
        redrawComposition('pasteLayers');

        if (newPastedIds.length === 1) {
          selectTimelineLayer(newPastedIds[0], false);
        } else if (newPastedIds.length > 1) {
          if (selectedLayerIds) {
            selectedLayerIds.clear();
            newPastedIds.forEach(id => selectedLayerIds.add(id));
            selectedLayerId = newPastedIds[0];
            window.selectedLayerId = selectedLayerId;
            isSelectorMode = true;
            updateEditorHeaderMode();
            renderTimelineLayers();
          }
        }
      }
      window.pasteLayers = pasteLayers;

      function duplicateSelectedLayers() {
        const ids = [];
        if (selectedLayerId) ids.push(selectedLayerId);
        if (window.selectedLayerId && !ids.includes(window.selectedLayerId)) ids.push(window.selectedLayerId);
        if (selectedLayerIds && selectedLayerIds.size > 0) {
          selectedLayerIds.forEach(id => { if (!ids.includes(id)) ids.push(id); });
        }
        if (window.selectedLayerIds && window.selectedLayerIds.size > 0) {
          window.selectedLayerIds.forEach(id => { if (!ids.includes(id)) ids.push(id); });
        }
        if (ids.length === 0 || !currentProjectState.layers) return;
        if (window.Popover) window.Popover.close();

        // Pass 1: generate unique ID map for duplicated set to preserve internal parenting
        const idMap = new Map();
        ids.forEach((id, idx) => {
          const newId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6) + '_' + (currentProjectState.layers.length + idx);
          idMap.set(id, newId);
        });

        const newDuplicatedIds = [];
        ids.forEach((id) => {
          const orig = currentProjectState.layers.find(l => l.id === id);
          if (!orig) return;
          const newId = idMap.get(id);

          let clonedKeyframes = orig.keyframes ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(orig.keyframes) : (Array.isArray(orig.keyframes) ? [] : {})) : undefined;
          let clonedEffects = undefined;
          if (Array.isArray(orig.effects)) {
            clonedEffects = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(orig.effects) : (Array.isArray(orig.effects) ? [] : {}));
            clonedEffects.forEach(fx => {
              const oldId = fx.id;
              const newFxId = 'fx_' + (fx.type || 'effect') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + Math.floor(Math.random() * 1000);
              fx.id = newFxId;
              if (clonedKeyframes) {
                Object.keys(clonedKeyframes).forEach(k => {
                  if (k.startsWith(oldId + ':')) {
                    const paramName = k.slice(oldId.length + 1);
                    clonedKeyframes[`${newFxId}:${paramName}`] = clonedKeyframes[k];
                    delete clonedKeyframes[k];
                  }
                });
              }
            });
          }

          let clonedAudioEffects = Array.isArray(orig.audioEffects) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(orig.audioEffects) : (Array.isArray(orig.audioEffects) ? [] : {})) : undefined;
          if (clonedAudioEffects) {
            clonedAudioEffects.forEach(fx => {
              fx.id = 'fx_' + (fx.type || 'audio') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            });
          }

          const newParentId = (orig.parentId && idMap.has(orig.parentId)) ? idMap.get(orig.parentId) : (orig.parentId || null);

          const cloned = Object.assign({}, (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(orig) : (Array.isArray(orig) ? [] : {})), {
            id: newId,
            name: orig.name ? (orig.name + ' (Copy)') : 'Layer (Copy)',
            startSec: orig.startSec !== undefined ? orig.startSec : ((orig.startPx || 0) / (window.currentPixelsPerSecond || 80)),
            startPx: orig.startPx || 0,
            durationSec: orig.durationSec !== undefined ? orig.durationSec : ((orig.widthPx || 320) / (window.currentPixelsPerSecond || 80)),
            widthPx: orig.widthPx || 320,
            parentId: newParentId,
            parentBind: orig.parentBind ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(orig.parentBind) : (Array.isArray(orig.parentBind) ? [] : {})) : undefined,
            effects: clonedEffects,
            audioEffects: clonedAudioEffects,
            keyframes: clonedKeyframes
          });

          // Preserve in-memory references & cache handles (AI cutout, media cache, frame extractor)
          if (orig._bgCutoutBitmap) cloned._bgCutoutBitmap = orig._bgCutoutBitmap;
          if (orig._lastMattingModel) cloned._lastMattingModel = orig._lastMattingModel;
          if (orig._fillMediaImg) cloned._fillMediaImg = orig._fillMediaImg;
          if (orig._lastRenderedFrame) cloned._lastRenderedFrame = orig._lastRenderedFrame;

          if (window.FishBgRemovalEngine) {
            const cutout = orig._bgCutoutBitmap || window.FishBgRemovalEngine.getPhotoCutout(orig);
            if (cutout) {
              cloned._bgCutoutBitmap = cutout;
              if (window.FishBgRemovalEngine._photoCutoutCache) {
                window.FishBgRemovalEngine._photoCutoutCache.set(newId, cutout);
                if (cloned.mediaId) window.FishBgRemovalEngine._photoCutoutCache.set(cloned.mediaId, cutout);
              }
            }
          }

          if (window.layerMediaCache) {
            const origMedia = window.layerMediaCache.get(orig.id) || (orig.mediaId ? window.layerMediaCache.get(orig.mediaId) : null);
            if (origMedia) {
              window.layerMediaCache.set(newId, origMedia);
            }
          }

          if (orig.type === 'video' && !cloned.mediaId) {
            cloned.mediaId = orig.mediaId || orig.sourceVideoId || orig.id;
          }

          // Insert directly above original layer in timeline stack (in-place timecode)
          invalidatePreviewCacheForLayer(cloned);
          const origIdx = currentProjectState.layers.findIndex(l => l.id === id);
          if (origIdx >= 0) {
            currentProjectState.layers.splice(origIdx, 0, cloned);
          } else {
            currentProjectState.layers.unshift(cloned);
          }
          newDuplicatedIds.push(newId);
        });

        saveCurrentProjectLayers();
        renderTimelineLayers();
        redrawComposition('duplicateLayers');

        if (newDuplicatedIds.length === 1) {
          selectTimelineLayer(newDuplicatedIds[0], false);
        } else if (newDuplicatedIds.length > 1) {
          if (selectedLayerIds) {
            selectedLayerIds.clear();
            newDuplicatedIds.forEach(id => selectedLayerIds.add(id));
            selectedLayerId = newDuplicatedIds[0];
            window.selectedLayerId = selectedLayerId;
            isSelectorMode = true;
            updateEditorHeaderMode();
            renderTimelineLayers();
          }
        }
      }
      window.duplicateSelectedLayers = duplicateSelectedLayers;

      function precomposeSelectedLayers(autoCrop = false, groupMode = 'normal') {
        const layers = currentProjectState.layers || [];
        const ids = [];
        const sId = selectedLayerId || window.selectedLayerId;
        if (sId) ids.push(sId);
        const sIds = (selectedLayerIds && selectedLayerIds.size > 0) ? selectedLayerIds : (window.selectedLayerIds && window.selectedLayerIds.size > 0 ? window.selectedLayerIds : null);
        if (sIds && sIds.size > 0) {
          sIds.forEach(id => { if (!ids.includes(id)) ids.push(id); });
        }
        if (ids.length === 0 || layers.length === 0) return null;

        // Target layers preserving current order in timeline
        const targetLayers = layers.filter(l => ids.includes(l.id));
        if (targetLayers.length === 0) return null;

        if (window.Popover) window.Popover.close();

        // Record Undo snapshot
        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const aspect = currentProjectState.aspectRatio || '16:9';
        const res = currentProjectState.resolution || '1080p';
        const baseDims = window.getProjectDimensions(res, aspect);
        const baseW = baseDims[0];
        const baseH = baseDims[1];

        // 1. Calculate bounding time span
        let minStartSec = Infinity;
        let maxEndSec = -Infinity;

        targetLayers.forEach(l => {
          const s = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
          const d = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 320) / pps);
          if (s < minStartSec) minStartSec = s;
          if (s + d > maxEndSec) maxEndSec = s + d;
        });

        if (!isFinite(minStartSec)) minStartSec = 0;
        if (!isFinite(maxEndSec) || maxEndSec <= minStartSec) maxEndSec = minStartSec + 4;
        const durationSec = Math.max(0.1, maxEndSec - minStartSec);

        function cleanLayerForClone(layer) {
          try {
            const seen = new WeakSet();
            const copy = JSON.parse(JSON.stringify(layer, (k, v) => {
              if (typeof k === 'string' && k.startsWith('_') && k !== '_userResized' && k !== '_defaultEasing') return undefined;
              if (v !== null && typeof v === 'object') {
                if (typeof Element !== 'undefined' && v instanceof Element) return undefined;
                if (typeof Node !== 'undefined' && v instanceof Node) return undefined;
                if (typeof Window !== 'undefined' && v instanceof Window) return undefined;
                if (seen.has(v)) return undefined;
                seen.add(v);
              }
              if (typeof v === 'function') return undefined;
              return v;
            }));
            delete copy._shapeBufferCanvas;
            delete copy._precompBufferCanvas;
            delete copy._fillBufferCanvas;
            delete copy._fillMediaImg;
            delete copy._alphaHitCanvas;
            delete copy._alphaHitCtx;
            delete copy._canvasBounds;
            return copy;
          } catch (e) {
            console.error('[Precompose] Clone error:', e);
            return Object.assign({}, layer); // Fallback to shallow copy to prevent fatal freeze
          }
        }

        // 2. Clone child layers and normalize time/keyframes relative to minStartSec
        const clonedChildren = targetLayers.map(l => cleanLayerForClone(l));
        clonedChildren.forEach(child => {
          const origStart = child.startSec !== undefined ? child.startSec : ((child.startPx || 0) / pps);
          const relStart = Math.max(0, origStart - minStartSec);
          child.startSec = Number(relStart.toFixed(4));
          child.startPx = Math.round(child.startSec * pps);
          if (child.durationSec === undefined) {
            child.durationSec = Number(((child.widthPx || 320) / pps).toFixed(4));
          }
          child.widthPx = Math.round(child.durationSec * pps);

          if (child.keyframes && typeof child.keyframes === 'object') {
            Object.keys(child.keyframes).forEach(prop => {
              if (Array.isArray(child.keyframes[prop])) {
                child.keyframes[prop].forEach(kf => {
                  kf.time = Number(Math.max(0, kf.time - minStartSec).toFixed(4));
                });
              }
            });
          }
        });

        // For Mask Group / Exclude Group, topmost visual layer (child 0) acts as the mask
        if (groupMode === 'mask' && clonedChildren.length > 0) {
          clonedChildren[0].blendMode = 'destination-in';
        } else if (groupMode === 'exclude' && clonedChildren.length > 0) {
          clonedChildren[0].blendMode = 'destination-out';
        }

        // Auto-Crop bounding box calculation (Right-click PRECOMP_AUTOCROP)
        let compW = baseW;
        let compH = baseH;
        let compPosX = baseW / 2;
        let compPosY = baseH / 2;

        if (autoCrop) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          const engine = window.FishToolEngine || window.LayerTransform;
          targetLayers.forEach(l => {
            if (l.type === 'camera' || l.type === 'audio' || l.type === 'null') return;
            const effProps = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(l, minStartSec, null, targetLayers) : {};
            const resolvedLayer = Object.assign({}, l, effProps);
            if (resolvedLayer.type === 'shape') {
              if (resolvedLayer.scaleW === undefined) resolvedLayer.scaleW = ((resolvedLayer.shapeProps && resolvedLayer.shapeProps.sizeX) || 300) * (resolvedLayer.transformScaleX !== undefined ? resolvedLayer.transformScaleX : 1);
              if (resolvedLayer.scaleH === undefined) resolvedLayer.scaleH = ((resolvedLayer.shapeProps && resolvedLayer.shapeProps.sizeY) || 300) * (resolvedLayer.transformScaleY !== undefined ? resolvedLayer.transformScaleY : 1);
            }
            if (resolvedLayer.scaleW === undefined) resolvedLayer.scaleW = resolvedLayer.normW ? resolvedLayer.normW * baseW : 200;
            if (resolvedLayer.scaleH === undefined) resolvedLayer.scaleH = resolvedLayer.normH ? resolvedLayer.normH * baseH : 200;
            if (resolvedLayer.posX === undefined) resolvedLayer.posX = resolvedLayer.normX !== undefined ? (resolvedLayer.normX + (resolvedLayer.normW || 0.5) / 2) * baseW : baseW / 2;
            if (resolvedLayer.posY === undefined) resolvedLayer.posY = resolvedLayer.normY !== undefined ? (resolvedLayer.normY + (resolvedLayer.normH || 0.5) / 2) * baseH : baseH / 2;

            let bounds = null;
            if (engine && typeof engine.getBounds === 'function') {
              try { bounds = engine.getBounds(resolvedLayer, 1); } catch (_) {}
            }
            if (!bounds || bounds.w === undefined) {
              const lw = Math.abs(resolvedLayer.scaleW || 200);
              const lh = Math.abs(resolvedLayer.scaleH || 200);
              const lx = resolvedLayer.posX !== undefined ? resolvedLayer.posX : baseW / 2;
              const ly = resolvedLayer.posY !== undefined ? resolvedLayer.posY : baseH / 2;
              bounds = { x: lx - lw / 2, y: ly - lh / 2, w: lw, h: lh };
            }
            const bRight = bounds.x + (bounds.aabbW !== undefined ? bounds.aabbW : bounds.w);
            const bBottom = bounds.y + (bounds.aabbH !== undefined ? bounds.aabbH : bounds.h);
            if (bounds.x < minX) minX = bounds.x;
            if (bounds.y < minY) minY = bounds.y;
            if (bRight > maxX) maxX = bRight;
            if (bBottom > maxY) maxY = bBottom;
          });

          if (isFinite(minX) && isFinite(maxX) && maxX > minX && isFinite(minY) && isFinite(maxY) && maxY > minY) {
            compW = Math.max(16, Math.round(maxX - minX));
            compH = Math.max(16, Math.round(maxY - minY));
            compPosX = minX + compW / 2;
            compPosY = minY + compH / 2;

            // Offset child layers to fit within cropped precomp
            clonedChildren.forEach(child => {
              if (child.posX !== undefined) {
                child.posX = Number((child.posX - minX).toFixed(2));
              }
              if (child.posY !== undefined) {
                child.posY = Number((child.posY - minY).toFixed(2));
              }
              if (child.keyframes && typeof child.keyframes === 'object') {
                if (Array.isArray(child.keyframes.move)) {
                  child.keyframes.move.forEach(kf => {
                    if (kf.value) {
                      if (kf.value.posX !== undefined) kf.value.posX = Number((kf.value.posX - minX).toFixed(2));
                      if (kf.value.posY !== undefined) kf.value.posY = Number((kf.value.posY - minY).toFixed(2));
                    }
                  });
                }
              }
              const cW = Math.abs(child.scaleW || (child.type === 'shape' ? ((child.shapeProps && child.shapeProps.sizeX) || 300) : (child.normW ? child.normW * baseW : 200)));
              const cH = Math.abs(child.scaleH || (child.type === 'shape' ? ((child.shapeProps && child.shapeProps.sizeY) || 300) : (child.normH ? child.normH * baseH : 200)));
              child.scaleW = cW;
              child.scaleH = cH;
              child.normW = Number((cW / compW).toFixed(4));
              child.normH = Number((cH / compH).toFixed(4));
              child.normX = Number(((child.posX - cW / 2) / compW).toFixed(4));
              child.normY = Number(((child.posY - cH / 2) / compH).toFixed(4));
              child._userResized = true;
            });
          }
        }

        // 3. Name & ID & Media Pool Registration
        let precompName = '';
        if (groupMode === 'mask') {
          const maskCount = layers.filter(l => l.type === 'precomp' && l.groupType === 'mask').length + 1;
          precompName = `Mask Group ${maskCount}`;
        } else if (groupMode === 'exclude') {
          const excludeCount = layers.filter(l => l.type === 'precomp' && l.groupType === 'exclude').length + 1;
          precompName = `Exclude Group ${excludeCount}`;
        } else {
          const precompCount = layers.filter(l => l.type === 'precomp' && (!l.groupType || l.groupType === 'normal')).length + 1;
          precompName = `Pre-comp ${precompCount}`;
        }
        const precompId = 'layer_precomp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const mediaId = 'media_comp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

        const has3DChildren = clonedChildren.some(l => {
          const rotX = Math.abs(l.rotX || 0);
          const rotY = Math.abs(l.rotY || 0);
          const posZ = Math.abs(l.posZ || 0);
          const anchorZ = Math.abs(l.anchorZ || 0);
          const has3DKeyframes = l.keyframes && (
            (Array.isArray(l.keyframes.rotX) && l.keyframes.rotX.length > 0) ||
            (Array.isArray(l.keyframes.rotY) && l.keyframes.rotY.length > 0) ||
            (Array.isArray(l.keyframes.posZ) && l.keyframes.posZ.length > 0)
          );
          return rotX > 0.001 || rotY > 0.001 || posZ > 0.001 || anchorZ > 0.001 || !!l.is3D || !!l.collapseTransformations || has3DKeyframes;
        });

        const precompLayer = {
          id: precompId,
          mediaId: mediaId,
          name: precompName,
          type: 'precomp',
          groupType: groupMode,
          startSec: Number(minStartSec.toFixed(4)),
          durationSec: Number(durationSec.toFixed(4)),
          startPx: Math.round(minStartSec * pps),
          widthPx: Math.round(durationSec * pps),
          posX: Number(compPosX.toFixed(2)),
          posY: Number(compPosY.toFixed(2)),
          scaleW: compW,
          scaleH: compH,
          mediaWidth: compW,
          mediaHeight: compH,
          _userResized: true,
          normX: Number(((compPosX - compW / 2) / baseW).toFixed(4)),
          normY: Number(((compPosY - compH / 2) / baseH).toFixed(4)),
          normW: Number((compW / baseW).toFixed(4)),
          normH: Number((compH / baseH).toFixed(4)),
          rotZ: 0,
          rotX: 0,
          rotY: 0,
          rotation: 0,
          skewX: 0,
          skewY: 0,
          anchorX: 0,
          anchorY: 0,
          anchorZ: 0,
          posZ: 0,
          opacity: 1,
          blendMode: 'normal',
          hasAudio: clonedChildren.some(l => l.type === 'audio' || l.type === 'video' || (l.type === 'precomp' && l.hasAudio)),
          is3D: has3DChildren,
          // A precomp with its own camera renders through that camera; collapsing would discard it.
          collapseTransformations: has3DChildren && !clonedChildren.some(l => l && l.type === 'camera' && !l.hidden),
          layers: clonedChildren
        };

        const precompMediaItem = {
          id: mediaId,
          projectId: currentProjectState.id,
          name: precompName,
          type: 'precomp',
          groupType: groupMode,
          precompId: precompId,
          duration: durationSec,
          width: compW,
          height: compH,
          layers: (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(clonedChildren) : (Array.isArray(clonedChildren) ? [] : {}))
        };

        if (window.FishDatabase && typeof window.FishDatabase.saveMedia === 'function' && currentProjectState.id) {
          window.FishDatabase.saveMedia(precompMediaItem).then(() => {
            if (typeof window.refreshProjectMediaGrid === 'function') {
              window.refreshProjectMediaGrid();
            }
          }).catch(err => {
            console.warn('[Precompose] Failed to save media item:', err);
          });
        }

        // 4. Invalidate cache for original layers
        targetLayers.forEach(l => {
          if (typeof invalidatePreviewCacheForLayer === 'function') {
            invalidatePreviewCacheForLayer(l);
          }
        });

        // 5. Replace selected layers with precomp layer in layer stack
        const firstIndex = layers.findIndex(l => ids.includes(l.id));
        const remainingLayers = layers.filter(l => !ids.includes(l.id));
        remainingLayers.splice(firstIndex >= 0 ? firstIndex : 0, 0, precompLayer);
        currentProjectState.layers = remainingLayers;

        // 6. Select newly created precomp layer
        if (selectedLayerIds) selectedLayerIds.clear();
        selectedLayerId = precompId;
        if (selectedLayerIds) selectedLayerIds.add(precompId);
        window.selectedLayerId = precompId;
        window.selectedLayerIds = selectedLayerIds;
        isSelectorMode = false;

        // 7. Clear Preview cache
        if (window.PreviewCacheManager && typeof window.PreviewCacheManager.clear === 'function') {
          window.PreviewCacheManager.clear();
        }

        // 8. Redraw & Save
        renderTimelineLayers();
        updateEditorHeaderMode();
        redrawComposition('precompose');
        saveCurrentProjectLayers(true);

        return precompLayer;
      }
      window.precomposeSelectedLayers = precomposeSelectedLayers;

      function ungroupPrecompose(targetPrecompId = null) {
        const layers = currentProjectState.layers || [];
        if (layers.length === 0) return null;

        // 1. Resolve target precomp layers to ungroup
        let targetPrecomps = [];
        if (targetPrecompId) {
          const found = layers.find(l => l.id === targetPrecompId && l.type === 'precomp');
          if (found) targetPrecomps.push(found);
        } else {
          const ids = [];
          const sId = selectedLayerId || window.selectedLayerId;
          if (sId) ids.push(sId);
          const sIds = (selectedLayerIds && selectedLayerIds.size > 0)
            ? selectedLayerIds
            : (window.selectedLayerIds && window.selectedLayerIds.size > 0 ? window.selectedLayerIds : null);
          if (sIds && sIds.size > 0) {
            sIds.forEach(id => { if (!ids.includes(id)) ids.push(id); });
          }
          targetPrecomps = layers.filter(l => ids.includes(l.id) && l.type === 'precomp');
        }

        if (targetPrecomps.length === 0) return null;

        if (window.Popover) window.Popover.close();

        // 2. Record Undo snapshot
        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const aspect = currentProjectState.aspectRatio || '16:9';
        const res = currentProjectState.resolution || '1080p';
        const baseDims = (typeof window.getProjectDimensions === 'function')
          ? window.getProjectDimensions(res, aspect)
          : [1920, 1080];
        const baseW = baseDims[0];
        const baseH = baseDims[1];

        function cleanLayerForClone(layer) {
          try {
            const seen = new WeakSet();
            const copy = JSON.parse(JSON.stringify(layer, (k, v) => {
              if (typeof k === 'string' && k.startsWith('_') && k !== '_userResized' && k !== '_defaultEasing') return undefined;
              if (v !== null && typeof v === 'object') {
                if (typeof Element !== 'undefined' && v instanceof Element) return undefined;
                if (typeof Node !== 'undefined' && v instanceof Node) return undefined;
                if (typeof Window !== 'undefined' && v instanceof Window) return undefined;
                if (seen.has(v)) return undefined;
                seen.add(v);
              }
              if (typeof v === 'function') return undefined;
              return v;
            }));
            delete copy._shapeBufferCanvas;
            delete copy._precompBufferCanvas;
            delete copy._fillBufferCanvas;
            delete copy._fillMediaImg;
            delete copy._alphaHitCanvas;
            delete copy._alphaHitCtx;
            delete copy._canvasBounds;
            delete copy._parentPrecomp;
            delete copy._parentPrecompId;
            delete copy._isCollapsedPrecompChild;
            delete copy._precompParentId;
            delete copy._precompParentLayer;
            delete copy._childOrigLayer;
            return copy;
          } catch (e) {
            console.error('[Ungroup] Clone error:', e);
            return Object.assign({}, layer);
          }
        }

        const allNewlyExtractedIds = [];

        // 3. Process each targeted precomp (reverse order if multiple, so index splicing remains accurate)
        targetPrecomps.slice().reverse().forEach(precompLayer => {
          const childLayers = Array.isArray(precompLayer.layers) ? precompLayer.layers : [];
          const clonedChildren = childLayers.map(l => cleanLayerForClone(l));

          const precompStartSec = precompLayer.startSec !== undefined ? precompLayer.startSec : ((precompLayer.startPx || 0) / pps);
          const precompSourceOffset = precompLayer.sourceOffsetSec || 0;
          const precompSpeed = (precompLayer.speed !== undefined && precompLayer.speed !== 0) ? precompLayer.speed : 1.0;

          const pw = precompLayer.mediaWidth || precompLayer.scaleW || baseW;
          const ph = precompLayer.mediaHeight || precompLayer.scaleH || baseH;

          const scaleRatioW = (precompLayer.scaleW !== undefined ? precompLayer.scaleW : pw) / (pw || 1920);
          const scaleRatioH = (precompLayer.scaleH !== undefined ? precompLayer.scaleH : ph) / (ph || 1080);
          const scaleRatioZ = (Math.abs(scaleRatioW) + Math.abs(scaleRatioH)) / 2;

          const pRotX = precompLayer.rotX || 0;
          const pRotY = precompLayer.rotY || 0;
          const pRotZ = precompLayer.rotZ !== undefined ? precompLayer.rotZ : (precompLayer.rotation || 0);

          const pivotX = pw / 2 + (precompLayer.anchorX || 0);
          const pivotY = ph / 2 + (precompLayer.anchorY || 0);
          const pivotZ = (precompLayer.anchorZ || 0);

          const pWorldX = (precompLayer.posX !== undefined ? precompLayer.posX : baseW / 2) + (precompLayer.anchorX || 0);
          const pWorldY = (precompLayer.posY !== undefined ? precompLayer.posY : baseH / 2) + (precompLayer.anchorY || 0);
          const pWorldZ = (precompLayer.posZ || 0) + (precompLayer.anchorZ || 0);

          const precompOpacity = precompLayer.opacity !== undefined ? precompLayer.opacity : 1.0;

          function transformPoint(cx, cy, cz = 0) {
            let vx = (cx !== undefined ? cx : pw / 2) - pivotX;
            let vy = (cy !== undefined ? cy : ph / 2) - pivotY;
            let vz = (cz || 0) - pivotZ;

            vx *= scaleRatioW;
            vy *= scaleRatioH;
            vz *= scaleRatioZ;

            if (pRotX !== 0) {
              const radX = (pRotX * Math.PI) / 180;
              const cX = Math.cos(radX), sX = Math.sin(radX);
              const nvy = vy * cX - vz * sX, nvz = vy * sX + vz * cX;
              vy = nvy; vz = nvz;
            }
            if (pRotY !== 0) {
              const radY = (pRotY * Math.PI) / 180;
              const cY = Math.cos(radY), sY = Math.sin(radY);
              const nvx = vx * cY + vz * sY, nvz = -vx * sY + vz * cY;
              vx = nvx; vz = nvz;
            }
            if (pRotZ !== 0) {
              const radZ = (pRotZ * Math.PI) / 180;
              const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
              const nvx = vx * cZ - vy * sZ, nvy = vx * sZ + vy * cZ;
              vx = nvx; vy = nvy;
            }

            return {
              x: Number((pWorldX + vx).toFixed(2)),
              y: Number((pWorldY + vy).toFixed(2)),
              z: Number((pWorldZ + vz).toFixed(2))
            };
          }

          const hasTransformDelta = (
            Math.abs(scaleRatioW - 1) > 1e-4 ||
            Math.abs(scaleRatioH - 1) > 1e-4 ||
            Math.abs(pRotX) > 1e-4 ||
            Math.abs(pRotY) > 1e-4 ||
            Math.abs(pRotZ) > 1e-4 ||
            Math.abs(pWorldX - pivotX) > 1e-4 ||
            Math.abs(pWorldY - pivotY) > 1e-4 ||
            Math.abs(pWorldZ - pivotZ) > 1e-4
          );

          clonedChildren.forEach(child => {
            // Timing adjustments
            const cStartRel = child.startSec !== undefined ? child.startSec : ((child.startPx || 0) / pps);
            const cDur = child.durationSec !== undefined ? child.durationSec : ((child.widthPx || 320) / pps);
            const childStartSec = Number((precompStartSec + (cStartRel - precompSourceOffset) / precompSpeed).toFixed(4));
            const childDurSec = Number((cDur / precompSpeed).toFixed(4));
            child.startSec = Math.max(0, childStartSec);
            child.startPx = Math.round(child.startSec * pps);
            child.durationSec = Math.max(0.05, childDurSec);
            child.widthPx = Math.round(child.durationSec * pps);

            if (child.keyframes && typeof child.keyframes === 'object') {
              Object.keys(child.keyframes).forEach(prop => {
                if (Array.isArray(child.keyframes[prop])) {
                  child.keyframes[prop].forEach(kf => {
                    const origTime = (kf.time !== undefined) ? kf.time : 0;
                    kf.time = Number(Math.max(0, precompStartSec + (origTime - precompSourceOffset) / precompSpeed).toFixed(4));
                  });
                }
              });
            }

            if (precompSpeed !== 1.0) {
              child.speed = Number(((child.speed || 1.0) * precompSpeed).toFixed(4));
            }

            // Spatial adjustments if precomp had non-identity transform
            if (hasTransformDelta) {
              const newPos = transformPoint(child.posX, child.posY, child.posZ || 0);
              child.posX = newPos.x;
              child.posY = newPos.y;
              if (child.posZ !== undefined || newPos.z !== 0) {
                child.posZ = newPos.z;
              }

              if (child.keyframes && Array.isArray(child.keyframes.move)) {
                child.keyframes.move.forEach(kf => {
                  if (kf.value) {
                    const kfPos = transformPoint(kf.value.posX, kf.value.posY, kf.value.posZ || 0);
                    kf.value.posX = kfPos.x;
                    kf.value.posY = kfPos.y;
                    if (kf.value.posZ !== undefined || kfPos.z !== 0) {
                      kf.value.posZ = kfPos.z;
                    }
                  }
                });
              }

              // Scale adjustments
              if (Math.abs(scaleRatioW - 1) > 1e-4 || Math.abs(scaleRatioH - 1) > 1e-4) {
                if (child.type === 'shape') {
                  if (child.shapeProps) {
                    child.shapeProps.sizeX = Number(((child.shapeProps.sizeX || 300) * Math.abs(scaleRatioW)).toFixed(2));
                    child.shapeProps.sizeY = Number(((child.shapeProps.sizeY || 300) * Math.abs(scaleRatioH)).toFixed(2));
                  }
                  if (child.scaleW !== undefined) child.scaleW = Number((child.scaleW * scaleRatioW).toFixed(2));
                  if (child.scaleH !== undefined) child.scaleH = Number((child.scaleH * scaleRatioH).toFixed(2));
                } else {
                  if (child.scaleW !== undefined) child.scaleW = Number((child.scaleW * scaleRatioW).toFixed(2));
                  if (child.scaleH !== undefined) child.scaleH = Number((child.scaleH * scaleRatioH).toFixed(2));
                  if (child.mediaWidth !== undefined) child.mediaWidth = Number((child.mediaWidth * Math.abs(scaleRatioW)).toFixed(2));
                  if (child.mediaHeight !== undefined) child.mediaHeight = Number((child.mediaHeight * Math.abs(scaleRatioH)).toFixed(2));
                }

                if (child.keyframes && Array.isArray(child.keyframes.scale)) {
                  child.keyframes.scale.forEach(kf => {
                    if (kf.value) {
                      if (kf.value.scaleW !== undefined) kf.value.scaleW = Number((kf.value.scaleW * scaleRatioW).toFixed(2));
                      if (kf.value.scaleH !== undefined) kf.value.scaleH = Number((kf.value.scaleH * scaleRatioH).toFixed(2));
                    }
                  });
                }
              }

              // Rotation adjustments
              if (Math.abs(pRotZ) > 1e-4 || Math.abs(pRotX) > 1e-4 || Math.abs(pRotY) > 1e-4) {
                const cRotX = child.rotX || 0;
                const cRotY = child.rotY || 0;
                const cRotZ = child.rotZ !== undefined ? child.rotZ : (child.rotation || 0);
                const composedRot = (typeof composeEulerRotations === 'function')
                  ? composeEulerRotations(pRotX, pRotY, pRotZ, cRotX, cRotY, cRotZ)
                  : { rotX: cRotX + pRotX, rotY: cRotY + pRotY, rotZ: cRotZ + pRotZ };
                child.rotX = Number(composedRot.rotX.toFixed(2));
                child.rotY = Number(composedRot.rotY.toFixed(2));
                child.rotZ = Number(composedRot.rotZ.toFixed(2));
                child.rotation = child.rotZ;

                if (child.keyframes && Array.isArray(child.keyframes.rotate)) {
                  child.keyframes.rotate.forEach(kf => {
                    if (typeof kf.value === 'number') {
                      kf.value = Number((kf.value + pRotZ).toFixed(2));
                    }
                  });
                }
              }
            }

            // Opacity adjustments
            if (precompOpacity < 0.999) {
              child.opacity = Number(((child.opacity !== undefined ? child.opacity : 1.0) * precompOpacity).toFixed(4));
              if (child.keyframes && Array.isArray(child.keyframes.opacity)) {
                child.keyframes.opacity.forEach(kf => {
                  if (typeof kf.value === 'number') {
                    kf.value = Number((kf.value * precompOpacity).toFixed(4));
                  }
                });
              }
            }

            // Re-normalize norm bounds
            const effW = Math.abs(child.scaleW || child.mediaWidth || (child.shapeProps && child.shapeProps.sizeX) || 200);
            const effH = Math.abs(child.scaleH || child.mediaHeight || (child.shapeProps && child.shapeProps.sizeY) || 200);
            child.normW = Number((effW / baseW).toFixed(4));
            child.normH = Number((effH / baseH).toFixed(4));
            child.normX = Number(((child.posX - effW / 2) / baseW).toFixed(4));
            child.normY = Number(((child.posY - effH / 2) / baseH).toFixed(4));
            child._userResized = true;

            // 3D inheritance
            if (precompLayer.is3D) {
              child.is3D = true;
            }

            // Parent link inheritance
            if (precompLayer.parentBind && !child.parentBind) {
              child.parentBind = Object.assign({}, precompLayer.parentBind);
            }

            allNewlyExtractedIds.push(child.id);
          });

          // Invalidate cache for precomp and children
          if (typeof invalidatePreviewCacheForLayer === 'function') {
            invalidatePreviewCacheForLayer(precompLayer);
            clonedChildren.forEach(c => invalidatePreviewCacheForLayer(c));
          }

          // Clean up database media item if not reused
          if (precompLayer.mediaId) {
            const isReused = currentProjectState.layers.some(l => l.id !== precompLayer.id && l.mediaId === precompLayer.mediaId);
            if (!isReused && window.FishDatabase && typeof window.FishDatabase.deleteMedia === 'function') {
              window.FishDatabase.deleteMedia(precompLayer.mediaId).then(() => {
                if (typeof window.refreshProjectMediaGrid === 'function') {
                  window.refreshProjectMediaGrid();
                }
              }).catch(() => {});
            }
          }

          // Replace precomp in timeline layers
          const pIndex = currentProjectState.layers.findIndex(l => l.id === precompLayer.id);
          if (pIndex >= 0) {
            currentProjectState.layers.splice(pIndex, 1, ...clonedChildren);
          }
        });

        // 4. Update selections to unpacked child layers
        if (selectedLayerIds) selectedLayerIds.clear();
        allNewlyExtractedIds.forEach(id => {
          if (selectedLayerIds) selectedLayerIds.add(id);
        });
        selectedLayerId = allNewlyExtractedIds.length > 0 ? allNewlyExtractedIds[0] : null;
        window.selectedLayerId = selectedLayerId;
        window.selectedLayerIds = selectedLayerIds;
        isSelectorMode = allNewlyExtractedIds.length > 1;

        // 5. Clear preview cache
        if (window.PreviewCacheManager && typeof window.PreviewCacheManager.clear === 'function') {
          window.PreviewCacheManager.clear();
        }

        // 6. Redraw UI & Save
        renderTimelineLayers();
        updateEditorHeaderMode();
        if (typeof fitPreviewCanvasBox === 'function') {
          fitPreviewCanvasBox();
        }
        redrawComposition('ungroup');
        saveCurrentProjectLayers(true);

        return allNewlyExtractedIds;
      }
      window.ungroupPrecompose = ungroupPrecompose;
      window.ungroupSelectedLayers = ungroupPrecompose;

      // ======================================================================
      // OPENFISHTOOLS ACTIONS: KEYFRAME OVERLAP (LEAPFROG RIG)
      // Ports _OVERLAP / _OVERLAP_2D from host/modules/misc.jsx
      // ======================================================================
      function applyKeyframeOverlap() {
        const layers = currentProjectState.layers || [];
        const layer = layers.find(l => l.id === (window.selectedLayerId || selectedLayerId));
        if (!layer) {
          return JSON.stringify({
            error: true,
            tool: 'Overlap',
            type: 'warn',
            message: 'Please select a layer to apply Overlap.'
          });
        }

        if (!layer.keyframes || typeof layer.keyframes !== 'object') {
          return JSON.stringify({
            error: true,
            tool: 'Overlap',
            type: 'warn',
            message: 'Overlap requires the selected layer to have at least 2 keyframes on Position, Scale, or Rotation.'
          });
        }

        const propCandidates = ['move', 'scale', 'rotate'];
        const qualifyingProps = propCandidates.filter(p => Array.isArray(layer.keyframes[p]) && layer.keyframes[p].length >= 2);

        if (qualifyingProps.length === 0) {
          return JSON.stringify({
            error: true,
            tool: 'Overlap',
            type: 'warn',
            message: 'Overlap requires the selected layer to have at least 2 keyframes on Position, Scale, or Rotation.'
          });
        }

        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const aspect = currentProjectState.aspectRatio || '16:9';
        const res = currentProjectState.resolution || '1080p';
        const baseDims = window.getProjectDimensions(res, aspect);
        const baseW = baseDims[0];
        const baseH = baseDims[1];
        const centerPosX = Math.round(baseW / 2);
        const centerPosY = Math.round(baseH / 2);

        const nullsCreated = [];

        qualifyingProps.forEach(prop => {
          const keyframes = [...layer.keyframes[prop]].sort((a, b) => a.time - b.time);
          const propLabel = prop === 'move' ? 'Position' : (prop === 'scale' ? 'Scale' : 'Rotation');

          for (let i = 0; i < keyframes.length - 1; i++) {
            const startKf = keyframes[i];
            const endKf = keyframes[i + 1];

            const nullStartTime = startKf.time;
            const nullEndTime = (i + 2 < keyframes.length)
              ? keyframes[i + 2].time
              : endKf.time + (endKf.time - startKf.time);
            const nullDuration = Math.max(0.05, nullEndTime - nullStartTime);

            // Leapfrog bezier influence calculation from JSX
            const transitionDuration = nullEndTime - nullStartTime;
            const ratio = (transitionDuration > 0) ? (endKf.time - nullStartTime) / transitionDuration : 0.5;
            const baseInfluence = 0.85;
            const influenceOut = Math.max(0.33, Math.min(1.0, ratio * 2 * baseInfluence));
            const influenceIn = Math.max(0.33, Math.min(1.0, (1 - ratio) * 2 * baseInfluence));
            const easeCurve = [
              Number(influenceOut.toFixed(3)),
              0.0,
              Number((1.0 - influenceIn).toFixed(3)),
              1.0
            ];

            let val1, val2;
            if (prop === 'move') {
              val1 = { posX: centerPosX, posY: centerPosY, posZ: 0 };
              const dx = endKf.value.posX - startKf.value.posX;
              const dy = endKf.value.posY - startKf.value.posY;
              const dz = (endKf.value.posZ || 0) - (startKf.value.posZ || 0);
              val2 = { posX: centerPosX + dx, posY: centerPosY + dy, posZ: dz };
            } else if (prop === 'scale') {
              const sW0 = (startKf.value.scaleW !== undefined) ? startKf.value.scaleW : 100;
              const sH0 = (startKf.value.scaleH !== undefined) ? startKf.value.scaleH : 100;
              const sW1 = (endKf.value.scaleW !== undefined) ? endKf.value.scaleW : 100;
              const sH1 = (endKf.value.scaleH !== undefined) ? endKf.value.scaleH : 100;
              const rW = (sW0 !== 0) ? (sW1 / sW0) : 1;
              const rH = (sH0 !== 0) ? (sH1 / sH0) : 1;
              val1 = { scaleW: 100, scaleH: 100 };
              val2 = { scaleW: Number((100 * rW).toFixed(3)), scaleH: Number((100 * rH).toFixed(3)) };
            } else if (prop === 'rotate') {
              const rZ0 = startKf.value.rotZ !== undefined ? startKf.value.rotZ : (startKf.value.rotation || 0);
              const rZ1 = endKf.value.rotZ !== undefined ? endKf.value.rotZ : (endKf.value.rotation || 0);
              const deltaRotZ = rZ1 - rZ0;
              const deltaRotX = (endKf.value.rotX || 0) - (startKf.value.rotX || 0);
              const deltaRotY = (endKf.value.rotY || 0) - (startKf.value.rotY || 0);
              val1 = { rotZ: 0, rotation: 0, rotX: 0, rotY: 0 };
              val2 = { rotZ: deltaRotZ, rotation: deltaRotZ, rotX: deltaRotX, rotY: deltaRotY };
            }

            const nullId = 'layer_null_overlap_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
            const nullName = `Overlap_${propLabel}_${i + 1}`;

            const nullLayer = {
              id: nullId,
              name: nullName,
              type: 'null',
              startSec: Number(nullStartTime.toFixed(4)),
              durationSec: Number(nullDuration.toFixed(4)),
              startPx: Math.round(nullStartTime * pps),
              widthPx: Math.round(nullDuration * pps),
              posX: centerPosX,
              posY: centerPosY,
              posZ: 0,
              scaleW: 100,
              scaleH: 100,
              rotX: 0,
              rotY: 0,
              rotZ: 0,
              rotation: 0,
              opacity: 1.0,
              keyframes: {
                [prop]: [
                  {
                    time: Number(nullStartTime.toFixed(4)),
                    value: val1,
                    easing: easeCurve
                  },
                  {
                    time: Number(nullEndTime.toFixed(4)),
                    value: val2,
                    easing: [0.33, 0.0, 0.67, 1.0]
                  }
                ]
              }
            };

            nullsCreated.push(nullLayer);
          }
        });

        if (nullsCreated.length > 0) {
          // Reset transformed properties on original layer to Keyframe 0 values before deleting keyframes
          qualifyingProps.forEach(prop => {
            const sortedKfs = [...layer.keyframes[prop]].sort((a, b) => a.time - b.time);
            const firstKf = sortedKfs[0];

            if (prop === 'move') {
              layer.posX = firstKf.value.posX !== undefined ? firstKf.value.posX : centerPosX;
              layer.posY = firstKf.value.posY !== undefined ? firstKf.value.posY : centerPosY;
              layer.posZ = firstKf.value.posZ || 0;
            } else if (prop === 'scale') {
              layer.scaleW = firstKf.value.scaleW !== undefined ? firstKf.value.scaleW : (layer.scaleW || 100);
              layer.scaleH = firstKf.value.scaleH !== undefined ? firstKf.value.scaleH : (layer.scaleH || 100);
            } else if (prop === 'rotate') {
              const rZ = firstKf.value.rotZ !== undefined ? firstKf.value.rotZ : (firstKf.value.rotation || 0);
              layer.rotZ = rZ;
              layer.rotX = firstKf.value.rotX || 0;
              layer.rotY = firstKf.value.rotY || 0;
              layer.rotation = rZ;
            }

            delete layer.keyframes[prop];
          });

          if (Object.keys(layer.keyframes).length === 0) {
            delete layer.keyframes;
          }

          // Preserve existing layer parent if any
          const origParentId = layer.parentId || null;
          const origParentBind = layer.parentBind || null;

          // Wire leapfrog hierarchy: layer -> null[0] -> null[1] -> ... -> null[last] (-> origParent)
          const neutralBind = {
            parentPosX: centerPosX,
            parentPosY: centerPosY,
            parentPosZ: 0,
            parentRotX: 0,
            parentRotY: 0,
            parentRotZ: 0,
            parentScaleW: 100,
            parentScaleH: 100
          };

          layer.parentId = nullsCreated[0].id;
          layer.parentBind = Object.assign({}, neutralBind);

          for (let n = 0; n < nullsCreated.length - 1; n++) {
            nullsCreated[n].parentId = nullsCreated[n + 1].id;
            nullsCreated[n].parentBind = Object.assign({}, neutralBind);
          }

          if (origParentId) {
            nullsCreated[nullsCreated.length - 1].parentId = origParentId;
            nullsCreated[nullsCreated.length - 1].parentBind = origParentBind;
          }

          // Insert null layers into project layers immediately before the target layer
          const targetIdx = layers.findIndex(l => l.id === layer.id);
          layers.splice(targetIdx >= 0 ? targetIdx : 0, 0, ...nullsCreated);

          if (typeof invalidatePreviewCacheForLayer === 'function') {
            invalidatePreviewCacheForLayer(layer);
            nullsCreated.forEach(nl => invalidatePreviewCacheForLayer(nl));
          }
          renderTimelineLayers();
          redrawComposition('overlap');
          saveCurrentProjectLayers(true);
        }

        return JSON.stringify({
          error: false,
          type: 'info',
          message: `Overlap rig applied with ${nullsCreated.length} null layer(s).`
        });
      }
      window.applyKeyframeOverlap = applyKeyframeOverlap;

      // ======================================================================
      // OPENFISHTOOLS ACTIONS: DUPLICATE PRECOMPOSITION (DUP)
      // Clones precomp in media pool & places duplicate on timeline
      // ======================================================================
      function duplicatePrecompLayer(newName) {
        const layers = currentProjectState.layers || [];
        const selId = window.selectedLayerId || selectedLayerId;
        let targetPrecompLayer = layers.find(l => l.id === selId);

        if (!targetPrecompLayer || targetPrecompLayer.type !== 'precomp') {
          if (window.currentActivePrecomp) {
            targetPrecompLayer = window.currentActivePrecomp;
          } else {
            targetPrecompLayer = layers.find(l => l.type === 'precomp');
          }
        }

        if (!targetPrecompLayer || targetPrecompLayer.type !== 'precomp') {
          return JSON.stringify({
            error: true,
            tool: 'Duplicate Comp',
            type: 'warn',
            message: 'Please select a precomp layer, not a regular layer.'
          });
        }

        if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
          window.UndoRedoManager.recordSnapshot();
        }

        const origName = targetPrecompLayer.name || 'Pre-comp 1';
        let compName = newName;
        if (!compName || typeof compName !== 'string' || compName.trim() === '') {
          if (/\d+(?=\D*$)/.test(origName)) {
            compName = origName.replace(/(\d+)(?=\D*$)/g, (match) => {
              const num = parseInt(match, 10) + 1;
              let s = String(num);
              while (s.length < match.length) s = '0' + s;
              return s;
            });
          } else {
            compName = origName + ' 2';
          }
        }
        compName = compName.trim();

        const newPrecompId = 'layer_precomp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const newMediaId = 'media_comp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

        // Deep clone internal layers with new IDs
        let clonedChildren = [];
        if (Array.isArray(targetPrecompLayer.layers)) {
          clonedChildren = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(targetPrecompLayer.layers) : (Array.isArray(targetPrecompLayer.layers) ? [] : {}));
          clonedChildren.forEach(child => {
            child.id = 'layer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
          });
        }

        // 1. Save in Media Pool
        const precompMediaItem = {
          id: newMediaId,
          projectId: currentProjectState.id,
          name: compName,
          type: 'precomp',
          precompId: newPrecompId,
          duration: targetPrecompLayer.durationSec || 5,
          width: targetPrecompLayer.scaleW || 1920,
          height: targetPrecompLayer.scaleH || 1080,
          layers: (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(clonedChildren) : (Array.isArray(clonedChildren) ? [] : {}))
        };

        if (window.FishDatabase && typeof window.FishDatabase.saveMedia === 'function' && currentProjectState.id) {
          window.FishDatabase.saveMedia(precompMediaItem).then(() => {
            if (typeof window.refreshProjectMediaGrid === 'function') {
              window.refreshProjectMediaGrid();
            }
          }).catch(err => {
            console.warn('[DuplicatePrecomp] Failed to save media item:', err);
          });
        }

        // 2. Clone timeline layer and insert right above targetPrecompLayer
        const duplicatedLayer = {
          ...(window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(targetPrecompLayer) : (Array.isArray(targetPrecompLayer) ? [] : {})),
          id: newPrecompId,
          mediaId: newMediaId,
          name: compName,
          layers: clonedChildren,
          _precompBufferCanvas: null
        };

        const targetIdx = layers.findIndex(l => l.id === targetPrecompLayer.id);
        layers.splice(targetIdx >= 0 ? targetIdx : 0, 0, duplicatedLayer);

        // 3. Select newly duplicated layer
        if (selectedLayerIds) selectedLayerIds.clear();
        selectedLayerId = newPrecompId;
        if (selectedLayerIds) selectedLayerIds.add(newPrecompId);
        window.selectedLayerId = newPrecompId;
        window.selectedLayerIds = selectedLayerIds;

        renderTimelineLayers();
        updateEditorHeaderMode();
        redrawComposition('duplicatePrecomp');
        saveCurrentProjectLayers(true);

        return JSON.stringify({
          error: false,
          type: 'info',
          message: `Composition duplicated as '${compName}'.`
        });
      }
      window.duplicatePrecompLayer = duplicatePrecompLayer;

      // ======================================================================
      // OPENFISHTOOLS FORMAT: COMPOSITION RATIO & FPS
      // ======================================================================
      function changeCompositionRatio(w, h) {
        const wVal = parseInt(w, 10);
        const hVal = parseInt(h, 10);
        if (isNaN(wVal) || isNaN(hVal) || wVal <= 0 || hVal <= 0) {
          return JSON.stringify({ error: true, message: `Invalid ratio dimensions: ${w}x${h}` });
        }

        const ratio = wVal / hVal;
        let aspect = '16:9';
        if (Math.abs(ratio - 1.0) < 0.05) aspect = '1:1';
        else if (Math.abs(ratio - (9 / 16)) < 0.05) aspect = '9:16';
        else if (Math.abs(ratio - (16 / 9)) < 0.05) aspect = '16:9';
        else if (Math.abs(ratio - (3 / 4)) < 0.05) aspect = '3:4';
        else if (Math.abs(ratio - (4 / 3)) < 0.05) aspect = '4:3';
        else if (Math.abs(ratio - (21 / 9)) < 0.05) aspect = '21:9';
        else aspect = `${wVal}:${hVal}`;

        const res = (wVal >= 3840 || hVal >= 3840) ? '4K'
                  : (wVal >= 2560 || hVal >= 2560) ? '2K'
                  : (wVal >= 1920 || hVal >= 1920 || wVal === 1080) ? '1080p'
                  : '720p';

        if (typeof updatePreviewCanvas === 'function') {
          updatePreviewCanvas(aspect, res, currentProjectState.fps, currentProjectState.bgColor);
        }
        if (typeof redrawComposition === 'function') {
          redrawComposition('changeCompRatio');
        }
        if (typeof saveCurrentProjectLayers === 'function') {
          saveCurrentProjectLayers(true);
        }

        return JSON.stringify({
          error: false,
          type: 'info',
          message: `Composition ratio updated to ${wVal}x${hVal} (${aspect}).`
        });
      }
      window.changeCompositionRatio = changeCompositionRatio;

      function changeCompositionFPS(newFPS) {
        const fpsVal = parseFloat(newFPS);
        if (isNaN(fpsVal) || fpsVal <= 0) {
          return JSON.stringify({ error: true, message: `Invalid FPS value: ${newFPS}` });
        }

        currentProjectState.fps = fpsVal;
        window.currentTimelineFps = fpsVal;

        if (typeof window.setTimelineFps === 'function') {
          window.setTimelineFps(fpsVal);
        }
        if (window.PreviewCacheManager) {
          window.PreviewCacheManager.setFps(fpsVal);
        }
        if (window.VideoFrameExtractor) {
          window.VideoFrameExtractor.setFps(fpsVal);
        }
        if (typeof window.updateTimelineDuration === 'function') {
          window.updateTimelineDuration(true);
        }
        if (typeof redrawComposition === 'function') {
          redrawComposition('changeCompFPS');
        }
        if (typeof saveCurrentProjectLayers === 'function') {
          saveCurrentProjectLayers(true);
        }

        return JSON.stringify({
          error: false,
          type: 'info',
          message: `Composition frame rate updated to ${fpsVal} FPS.`
        });
      }
      window.changeCompositionFPS = changeCompositionFPS;

      // ======================================================================
      // Precompose Context Switching: Enter & Exit Sub-composition
      // ======================================================================
      // Check if project state has only this 1 precomp with standard 1:1 transform (eligible for direct cache adoption)
      function isPrecompEligibleForDirectCacheAdoption(precompLayer, layers = null) {
        if (!precompLayer) return false;
        const list = Array.isArray(layers) ? layers : (currentProjectState?.layers || []);
        const visualLayers = list.filter(l => !l.hidden && l.type !== 'audio' && l.type !== 'camera' && l.type !== 'null');

        // Condition: project only has this 1 precompose
        if (visualLayers.length !== 1 || visualLayers[0].id !== precompLayer.id) {
          return false;
        }

        const aspect = currentProjectState?.aspectRatio || '16:9';
        const res = currentProjectState?.resolution || '1080p';
        const baseDims = window.getProjectDimensions(res, aspect);
        const baseW = baseDims[0];
        const baseH = baseDims[1];

        const bw = (precompLayer.scaleW !== undefined ? precompLayer.scaleW : baseW);
        const bh = (precompLayer.scaleH !== undefined ? precompLayer.scaleH : baseH);
        if (Math.abs(bw) !== baseW || Math.abs(bh) !== baseH) return false;

        const cx = (precompLayer.posX !== undefined ? precompLayer.posX : (baseW / 2));
        const cy = (precompLayer.posY !== undefined ? precompLayer.posY : (baseH / 2));
        if (Math.round(cx) !== Math.round(baseW / 2) || Math.round(cy) !== Math.round(baseH / 2)) return false;

        if (precompLayer.rotZ || precompLayer.rotX || precompLayer.rotY || precompLayer.rotation) return false;
        if (precompLayer.skewX || precompLayer.skewY || precompLayer.anchorX || precompLayer.anchorY) return false;
        if (precompLayer.opacity !== undefined && precompLayer.opacity !== 1) return false;
        if (precompLayer.blendMode && precompLayer.blendMode !== 'normal') return false;
        if (precompLayer.effects && precompLayer.effects.length > 0) return false;
        if (precompLayer.hasBrightnessContrast && (precompLayer.brightness !== 0 || precompLayer.contrast !== 0)) return false;

        return true;
      }
      window.isPrecompEligibleForDirectCacheAdoption = isPrecompEligibleForDirectCacheAdoption;

      function enterPrecompose(precompId) {
        if (!precompId) return;
        const layers = currentProjectState.layers || [];
        const targetPrecomp = layers.find(l => l.id === precompId);
        if (!targetPrecomp || targetPrecomp.type !== 'precomp') return;

        if (!Array.isArray(targetPrecomp.layers)) {
          targetPrecomp.layers = [];
        }

        const currentPan = window.timelinePanX !== undefined ? window.timelinePanX : (typeof panX !== 'undefined' ? panX : 0);
        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        const curPlayheadSec = Math.abs(currentPan) / pps;

        compositionStack.push({
          parentPrecomp: currentActivePrecomp,
          layers: currentProjectState.layers,
          selectedLayerId: selectedLayerId,
          selectedLayerIds: new Set(selectedLayerIds),
          panX: currentPan,
          playheadSec: curPlayheadSec,
          durationSec: typeof getProjectTotalDuration === 'function' ? getProjectTotalDuration() : (currentProjectState.defaultDuration || 5)
        });

        currentActivePrecomp = targetPrecomp;
        window.currentActivePrecomp = currentActivePrecomp;
        currentProjectState.layers = targetPrecomp.layers;

        if (selectedLayerIds) selectedLayerIds.clear();
        selectedLayerId = null;
        window.selectedLayerId = null;
        window.selectedLayerIds = selectedLayerIds;
        isSelectorMode = false;
        if (typeof window.closeLayerDrawer === 'function') {
          window.closeLayerDrawer();
        }
        if (window.Drawer && typeof window.Drawer.close === 'function') {
          window.Drawer.close(false);
        }
        if (window.Popover && typeof window.Popover.close === 'function') {
          window.Popover.close();
        }

        updateEditorHeaderMode();

        if (typeof seekTimelineToTime === 'function') {
          seekTimelineToTime(0, true);
        }

        // Switch PreviewCacheManager scope to the precompose without clearing cache
        if (window.PreviewCacheManager) {
          window.PreviewCacheManager.setActiveComp(targetPrecomp.id);
          const parentCompId = compositionStack[compositionStack.length - 1]?.parentPrecomp?.id || 'root';
          window.PreviewCacheManager.adoptRootFrames(targetPrecomp, parentCompId);
        }
        renderTimelineLayers();
        updateTimelineDuration(true);
        if (typeof fitPreviewCanvasBox === 'function') {
          fitPreviewCanvasBox();
        }
        redrawComposition('enterPrecompose');
      }
      window.enterPrecompose = enterPrecompose;

      function exitPrecompose(fromHistory = false) {
        if (!compositionStack || compositionStack.length === 0) return;

        const exitingPrecomp = currentActivePrecomp;

        if (currentActivePrecomp) {
          currentActivePrecomp.layers = currentProjectState.layers;
          currentActivePrecomp._precompBufferCanvas = null;
          currentActivePrecomp._dirty = true;
          if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.invalidatePrecomp === 'function') {
            window.VideoFrameExtractor.invalidatePrecomp(currentActivePrecomp);
          }

          const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
          if (Array.isArray(currentActivePrecomp.layers) && currentActivePrecomp.layers.length > 0) {
            let maxEndSec = 0;
            currentActivePrecomp.layers.forEach(child => {
              const s = child.startSec !== undefined ? child.startSec : ((child.startPx || 0) / pps);
              const d = child.durationSec !== undefined ? child.durationSec : ((child.widthPx || 320) / pps);
              if (s + d > maxEndSec) maxEndSec = s + d;
            });
            if (maxEndSec > 0) {
              currentActivePrecomp.durationSec = Math.max(currentActivePrecomp.durationSec || 0, Number(maxEndSec.toFixed(4)));
              currentActivePrecomp.widthPx = Math.round(currentActivePrecomp.durationSec * pps);
            }
            currentActivePrecomp.hasAudio = currentActivePrecomp.layers.some(l => l.type === 'audio' || l.type === 'video' || (l.type === 'precomp' && l.hasAudio));
          }
        }

        const parentState = compositionStack.pop();
        currentActivePrecomp = parentState.parentPrecomp;
        window.currentActivePrecomp = currentActivePrecomp;
        currentProjectState.layers = parentState.layers;

        selectedLayerId = parentState.selectedLayerId;
        window.selectedLayerId = selectedLayerId;
        if (selectedLayerIds) {
          selectedLayerIds.clear();
          if (parentState.selectedLayerIds) {
            parentState.selectedLayerIds.forEach(id => selectedLayerIds.add(id));
          }
        }
        window.selectedLayerIds = selectedLayerIds;

        updateEditorHeaderMode();

        if (typeof seekTimelineToTime === 'function') {
          seekTimelineToTime(parentState.playheadSec || 0, true);
        }

        // Restore PreviewCacheManager scope and adopt precomp frames
        if (window.PreviewCacheManager) {
          const parentCompId = currentActivePrecomp ? currentActivePrecomp.id : 'root';
          window.PreviewCacheManager.setActiveComp(parentCompId);
          if (exitingPrecomp) {
            window.PreviewCacheManager.adoptPrecompFrames(exitingPrecomp, parentCompId);
          }
        }
        renderTimelineLayers();
        updateTimelineDuration(true);
        if (typeof fitPreviewCanvasBox === 'function') {
          fitPreviewCanvasBox();
        }
        redrawComposition('exitPrecompose');
        saveCurrentProjectLayers();
      }
      window.exitPrecompose = exitPrecompose;
      window.enterPrecomp = enterPrecompose;
      window.exitPrecomp = exitPrecompose;

      // Header Breadcrumb Event Listeners (Exit Precomp & Inline Rename)
      (function initPrecompBreadcrumbEvents() {
        const btnExit = document.getElementById('btn-precomp-exit');
        if (btnExit) {
          btnExit.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            exitPrecompose(false);
          });
        }

        const precompNameInput = document.getElementById('editor-precomp-name');
        if (precompNameInput) {
          precompNameInput.addEventListener('input', () => {
            if (currentActivePrecomp) {
              const val = precompNameInput.value.trim() || 'Pre-comp';
              currentActivePrecomp.name = val;
              if (currentActivePrecomp.mediaId && window.FishDatabase && typeof window.FishDatabase.saveMedia === 'function') {
                window.FishDatabase.getMedia(currentActivePrecomp.mediaId).then(item => {
                  if (item) {
                    item.name = val;
                    window.FishDatabase.saveMedia(item).then(() => {
                      if (typeof window.refreshProjectMediaGrid === 'function') {
                        window.refreshProjectMediaGrid();
                      }
                    });
                  }
                }).catch(() => {});
              }
              renderTimelineLayers();
              saveCurrentProjectLayers();
            }
          });
        }

        const btnPrecompCollapse = document.getElementById('btn-precomp-collapse');
        if (btnPrecompCollapse) {
          btnPrecompCollapse.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentActivePrecomp) {
              currentActivePrecomp.collapseTransformations = !currentActivePrecomp.collapseTransformations;
              const nextState = !!currentActivePrecomp.collapseTransformations;
              btnPrecompCollapse.classList.toggle('is-active', nextState);
              btnPrecompCollapse.setAttribute('aria-pressed', String(nextState));

              currentActivePrecomp._precompBufferCanvas = null;
              if (window.PreviewCacheManager) {
                if (typeof window.PreviewCacheManager.clearPool === 'function') {
                  window.PreviewCacheManager.clearPool(currentActivePrecomp.id);
                } else if (typeof window.PreviewCacheManager.clearAll === 'function') {
                  window.PreviewCacheManager.clearAll('all');
                } else if (typeof window.PreviewCacheManager.clear === 'function') {
                  window.PreviewCacheManager.clear();
                }
              }
              if (typeof invalidatePreviewCacheForLayer === 'function') {
                invalidatePreviewCacheForLayer(currentActivePrecomp);
              }
              saveCurrentProjectLayers(true);
              redrawComposition('togglePrecompCollapse');
            }
          });
        }
      })();

      // Pure PCM 16-Bit WAV Encoder Helper (Offline, Fast, Zero External Libs)
      function audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const length = buffer.length;
        const dataSize = length * blockAlign;
        const headerSize = 44;
        const totalSize = headerSize + dataSize;
        const arrayBuffer = new ArrayBuffer(totalSize);
        const view = new DataView(arrayBuffer);

        function writeString(offset, string) {
          for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
          }
        }

        /* RIFF chunk */
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, 'WAVE');
        /* fmt chunk */
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        /* data chunk */
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        const channels = [];
        for (let c = 0; c < numChannels; c++) {
          channels.push(buffer.getChannelData(c));
        }

        let offset = 44;
        for (let i = 0; i < length; i++) {
          for (let c = 0; c < numChannels; c++) {
            let sample = channels[c][i];
            sample = Math.max(-1, Math.min(1, sample));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
          }
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
      }
      window.audioBufferToWav = audioBufferToWav;

      // Extract Audio from Selected Video Layer (Places into Media Pool & Timeline as true MP3)
      async function extractAudioFromSelectedVideo() {
        const targetId = selectedLayerId || (selectedLayerIds ? Array.from(selectedLayerIds)[0] : null);
        if (!targetId || !currentProjectState.layers) return;
        const layer = currentProjectState.layers.find(l => l.id === targetId);
        if (!layer || layer.type !== 'video') return;

        const projectId = currentProjectState.id || (new URLSearchParams(window.location.search).get('id')) || 'default_project';

        if (window.Popover) window.Popover.close();

        const cleanBaseName = (layer.name || 'Video').replace(/\.[^/.]+$/, '');
        const audioItemName = cleanBaseName + ' (Audio).mp3';
        const placeholderMediaId = 'med_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const placeholderLayerId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6) + '_' + currentProjectState.layers.length;
        const estDur = layer.durationSec || layer.mediaDuration || 5;
        const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const widthPx = layer.widthPx || Math.max(80, Math.round(estDur * pps));

        // 1. Optimistic Placeholder in Media Pool
        const audioMediaItem = {
          id: placeholderMediaId,
          projectId: projectId,
          name: audioItemName,
          type: 'audio',
          mimeType: 'audio/mp3',
          size: 0,
          dataUrl: '',
          blob: null,
          thumbUrl: '',
          duration: estDur,
          _convertingAudio: true,
          _convertProgress: 0,
          createdAt: new Date().toISOString()
        };
        window._activeMediaMap = window._activeMediaMap || new Map();
        window._activeMediaMap.set(placeholderMediaId, audioMediaItem);
        if (typeof renderMediaGrid === 'function') {
          await renderMediaGrid();
        }
        if (typeof renderFillMediaPool === 'function') {
          renderFillMediaPool();
        }

        // 2. Optimistic Placeholder Layer in Timeline directly below video layer
        const newAudioLayer = {
          id: placeholderLayerId,
          mediaId: placeholderMediaId,
          name: audioItemName,
          type: 'audio',
          startPx: layer.startPx || 0,
          startSec: layer.startSec !== undefined ? layer.startSec : 0,
          durationSec: estDur,
          widthPx: widthPx,
          sourceOffsetSec: layer.sourceOffsetSec || 0,
          dataUrl: '',
          thumbUrl: '',
          mediaDuration: estDur,
          isDurationExplicit: true,
          _convertingAudio: true,
          _convertProgress: 0
        };

        const videoIdx = currentProjectState.layers.findIndex(l => l.id === layer.id);
        if (videoIdx >= 0) {
          currentProjectState.layers.splice(videoIdx + 1, 0, newAudioLayer);
        } else {
          currentProjectState.layers.unshift(newAudioLayer);
        }
        renderTimelineLayers();
        await new Promise(r => requestAnimationFrame(r));

        const setProgress = (pct) => {
          if (typeof window.updateAudioConvertProgressUI === 'function') {
            window.updateAudioConvertProgressUI(placeholderMediaId, pct);
            window.updateAudioConvertProgressUI(placeholderLayerId, pct);
          }
        };

        const cleanupPlaceholders = async () => {
          if (window._activeMediaMap) window._activeMediaMap.delete(placeholderMediaId);
          if (currentProjectState && Array.isArray(currentProjectState.layers)) {
            const idx = currentProjectState.layers.findIndex(l => l.id === placeholderLayerId);
            if (idx >= 0) currentProjectState.layers.splice(idx, 1);
          }
          if (typeof renderMediaGrid === 'function') await renderMediaGrid();
          if (typeof renderFillMediaPool === 'function') renderFillMediaPool();
          renderTimelineLayers();
        };

        try {
          setProgress(5);
          let blob = null;
          if (layer.dataUrl && (layer.dataUrl.startsWith('data:') || layer.dataUrl.startsWith('blob:'))) {
            const res = await fetch(layer.dataUrl);
            blob = await res.blob();
          } else if (layer.mediaId && window.FishDatabase) {
            const projectMedias = await window.FishDatabase.getProjectMedia(projectId);
            const foundMedia = (projectMedias || []).find(m => m.id === layer.mediaId);
            if (foundMedia && foundMedia.dataUrl) {
              const res = await fetch(foundMedia.dataUrl);
              blob = await res.blob();
            }
          }

          if (!blob) {
            const cachedMedia = layerMediaCache.get(layer.mediaId || layer.id);
            if (cachedMedia && cachedMedia.el && cachedMedia.el.src) {
              const res = await fetch(cachedMedia.el.src);
              blob = await res.blob();
            }
          }

          if (!blob) {
            await cleanupPlaceholders();
            alert('Cannot locate video source data to extract audio.');
            return;
          }

          setProgress(12);
          const decodedBuffer = await decodeAudioFromBlob(blob, (decFrac) => {
            setProgress(12 + Math.round(decFrac * 33));
          });

          if (!decodedBuffer || decodedBuffer.numberOfChannels === 0) {
            await cleanupPlaceholders();
            alert('No audio stream detected in this video file.');
            return;
          }

          setProgress(45);
          const mp3Blob = await audioBufferToMp3(decodedBuffer, 192, (encFrac) => {
            setProgress(45 + Math.round(encFrac * 50));
          });

          setProgress(96);
          const mp3DataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(mp3Blob);
          });

          setProgress(100);
          await new Promise(r => requestAnimationFrame(r));

          const audioDur = decodedBuffer.duration || layer.durationSec || 5;

          // Finalize Media Pool item
          audioMediaItem.size = mp3Blob.size || mp3DataUrl.length;
          audioMediaItem.dataUrl = mp3DataUrl;
          audioMediaItem.blob = mp3Blob;
          audioMediaItem.duration = audioDur;
          delete audioMediaItem._convertingAudio;
          delete audioMediaItem._convertProgress;

          if (window.FishDatabase) {
            await window.FishDatabase.saveMedia(audioMediaItem);
            if (typeof renderMediaGrid === 'function') {
              await renderMediaGrid();
            }
            if (typeof renderFillMediaPool === 'function') {
              renderFillMediaPool();
            }
          }

          // Mute source video layer (audio is now separated into distinct audio track)
          layer.isMuted = true;
          const cachedVideoMedia = layerMediaCache.get(layer.id) || layerMediaCache.get(layer.mediaId);
          if (cachedVideoMedia && cachedVideoMedia.el) {
            cachedVideoMedia.el.muted = true;
            if (window.FishAudioEngine) {
              window.FishAudioEngine.detachMediaElement(cachedVideoMedia.el);
            }
          }
          layerMediaCache.forEach((entry) => {
            if (entry && entry.el && (entry.el.src === layer.dataUrl || entry.key === layer.id || entry.key === layer.mediaId)) {
              entry.el.muted = true;
              if (window.FishAudioEngine) {
                window.FishAudioEngine.detachMediaElement(entry.el);
              }
            }
          });

          // Finalize Audio Layer in Timeline
          newAudioLayer.durationSec = layer.durationSec !== undefined ? layer.durationSec : audioDur;
          newAudioLayer.widthPx = layer.widthPx || Math.max(80, Math.round(newAudioLayer.durationSec * (window.currentPixelsPerSecond || pixelsPerSecond || 80)));
          newAudioLayer.dataUrl = mp3DataUrl;
          newAudioLayer.mediaDuration = audioDur;
          delete newAudioLayer._convertingAudio;
          delete newAudioLayer._convertProgress;

          await saveCurrentProjectLayers(true);
          renderTimelineLayers();
          redrawComposition('extractAudio');
          selectTimelineLayer(newAudioLayer.id, false);

          if (typeof showEffectsRackToast === 'function') {
            showEffectsRackToast('Audio berhasil diekstrak ke MP3');
          }

        } catch (err) {
          console.error('Audio extraction error:', err);
          await cleanupPlaceholders();
          alert('Could not extract audio: this video may not contain an audio track.');
        }
      }
      window.extractAudioFromSelectedVideo = extractAudioFromSelectedVideo;

      // Close layer drawer → deselect layer & clear spotlight
      window.addEventListener('drawer-closed', (e) => {
        if (e.detail && e.detail.id === 'timeline-layer-drawer') {
          const vp = document.getElementById('timeline-layers-viewport');
          if (vp) vp.classList.remove('has-drawer-open');
          const tl = document.getElementById('main-editor-timeline');
          if (tl) {
            tl.classList.remove('has-layer-drawer-open');
            tl.style.removeProperty('--timeline-drawer-height');
          }
          const drawerEl = document.getElementById('timeline-layer-drawer');
          if (drawerEl) {
            drawerEl.style.removeProperty('--spotlight-top');
            drawerEl.style.removeProperty('--spotlight-bottom');
          }
          if (typeof deselectTimelineLayer === 'function') deselectTimelineLayer();
        }
      });
      window.addEventListener('drawer-opened', (e) => {
        if (e.detail && e.detail.id === 'timeline-layer-drawer') {
          const vp = document.getElementById('timeline-layers-viewport');
          if (vp) vp.classList.add('has-drawer-open');
          const tl = document.getElementById('main-editor-timeline');
          if (tl) tl.classList.add('has-layer-drawer-open');
          updateTimelineSpotlight();
          if (typeof updateTimelineKeyframeMarkersHighlight === 'function') {
            updateTimelineKeyframeMarkersHighlight();
          }
          if (typeof centerSelectedTimelineLayer === 'function') {
            setTimeout(() => {
              if (window.Drawer && window.Drawer.isOpen('timeline-layer-drawer')) {
                centerSelectedTimelineLayer(true);
              }
            }, 270);
          }
        }
      });

      const timelineLayersVp = document.getElementById('timeline-layers-viewport');
      if (timelineLayersVp) {
        timelineLayersVp.addEventListener('scroll', () => {
          if (window.Drawer && window.Drawer.isOpen('timeline-layer-drawer')) {
            updateTimelineSpotlight();
          }
        }, { passive: true });
      }
      window.addEventListener('resize', () => {
        if (window.Drawer && window.Drawer.isOpen('timeline-layer-drawer')) {
          updateTimelineSpotlight();
          if (typeof centerSelectedTimelineLayer === 'function') {
            centerSelectedTimelineLayer(false);
          }
        }
      }, { passive: true });

      function getVisibleTimelineLayers() {
        const overlayContainer = document.getElementById('timeline-lane-heads-overlay');
        if (overlayContainer) {
          const slots = overlayContainer.querySelectorAll('.timeline-lane-pill-slot');
          if (slots.length > 0) {
            const list = [];
            slots.forEach(s => {
              const lid = s.dataset.layerId;
              const found = typeof findLayerById === 'function' ? findLayerById(lid) : ((currentProjectState.layers || []).find(l => l.id === lid));
              if (found) list.push(found);
            });
            if (list.length > 0) return list;
          }
        }
        const root = currentProjectState.layers || [];
        const list = [];
        root.forEach(l => {
          list.push(l);
          if (l.type === 'precomp' && l._precompExpanded && Array.isArray(l.layers)) {
            list.push(...l.layers);
          }
        });
        return list;
      }
      window.getVisibleTimelineLayers = getVisibleTimelineLayers;

      let _cachedLanePitch = null;
      let _cachedOverlayTop = null;

      function getLayerIndexAtY(clientY) {
        const visibleLayers = getVisibleTimelineLayers();
        if (visibleLayers.length === 0) return -1;
        const overlayContainer = document.getElementById('timeline-lane-heads-overlay');
        if (overlayContainer) {
          if (_cachedLanePitch === null || _cachedOverlayTop === null) {
            const rect = overlayContainer.getBoundingClientRect();
            _cachedOverlayTop = rect.top;
            const firstSlot = overlayContainer.querySelector('.timeline-lane-pill-slot');
            _cachedLanePitch = firstSlot ? (firstSlot.offsetHeight || 40) : 40;
          }
          const vp = document.getElementById('timeline-layers-viewport');
          const scrollOffset = vp ? vp.scrollTop : 0;
          const relativeY = clientY - _cachedOverlayTop + scrollOffset;
          const idx = Math.floor(relativeY / _cachedLanePitch);
          return Math.max(0, Math.min(visibleLayers.length - 1, idx));
        }

        const track = document.getElementById('timeline-layers-track');
        let elements = track ? Array.from(track.querySelectorAll('.timeline-track-lane')) : [];
        if (elements.length === 0) return -1;

        for (let i = 0; i < elements.length; i++) {
          const rect = elements[i].getBoundingClientRect();
          if (clientY >= rect.top && clientY <= rect.bottom) {
            return i;
          }
        }

        for (let i = 0; i < elements.length - 1; i++) {
          const rect1 = elements[i].getBoundingClientRect();
          const rect2 = elements[i + 1].getBoundingClientRect();
          if (clientY > rect1.bottom && clientY < rect2.top) {
            return (clientY - rect1.bottom < rect2.top - clientY) ? i : i + 1;
          }
        }

        const firstRect = elements[0].getBoundingClientRect();
        if (clientY < firstRect.top) return 0;
        const lastRect = elements[elements.length - 1].getBoundingClientRect();
        if (clientY > lastRect.bottom) return elements.length - 1;

        return -1;
      }

      function syncSelectionClassesInPlace() {
        const overlay = document.getElementById('timeline-lane-heads-overlay');
        if (overlay) {
          overlay.classList.toggle('is-selector-mode', isSelectorMode);
          overlay.querySelectorAll('.timeline-lane-pill-slot').forEach(slot => {
            const lid = slot.dataset.layerId;
            const isSel = selectedLayerIds.has(lid) || (lid === selectedLayerId);
            slot.querySelector('.timeline-layer-ctrl-pill')?.classList.toggle('is-selected', isSel);
            slot.querySelector('.timeline-layer-checkbox')?.classList.toggle('is-selected', isSel);
          });
        }
        const track = document.getElementById('timeline-layers-track');
        if (track) {
          track.querySelectorAll('.timeline-clip-block').forEach(clip => {
            const lid = clip.dataset.layerId;
            const isSel = selectedLayerIds.has(lid) || (lid === selectedLayerId);
            clip.classList.toggle('is-selected', isSel);
            if (clip.classList.contains('clip-audio')) {
              const l = (currentProjectState.layers || []).find(x => x.id === lid);
              if (l) renderAudioClipWaveform(l, clip);
            }
          });
          if (typeof renderTimelineLinkConnectors === 'function') renderTimelineLinkConnectors();
        }
      }
      window.syncSelectionClassesInPlace = syncSelectionClassesInPlace;
      window.updateTimelineLayerSelectionState = syncSelectionClassesInPlace;


      function renderTimelineLayers() {
        if (!layersTrack) return;
        const viewport = document.getElementById('timeline-layers-viewport');
        const prevScrollTop = viewport ? viewport.scrollTop : 0;

        updateTimelineDuration();
        const isDesktop = isDesktopLayout();
        layersTrack.innerHTML = '';
        const overlayContainer = document.getElementById('timeline-lane-heads-overlay');
        if (overlayContainer) {
          overlayContainer.innerHTML = '';
          overlayContainer.classList.toggle('is-selector-mode', isSelectorMode);
        }

        const layers = currentProjectState.layers || [];
        if (viewport && viewport.scrollLeft !== 0) viewport.scrollLeft = 0;
        const existingEmpty = viewport ? viewport.querySelector('.timeline-empty-state') : null;

        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        layers.forEach(layer => {
          if (layer.startSec !== undefined) {
            layer.startPx = Math.round(layer.startSec * pps);
          } else {
            layer.startSec = (layer.startPx || 0) / pps;
            layer.startPx = Math.round(layer.startSec * pps);
          }
          if (layer.durationSec !== undefined) {
            const endPx = Math.round((layer.startSec + layer.durationSec) * pps);
            layer.widthPx = Math.max(16, endPx - layer.startPx);
          } else {
            layer.durationSec = Math.max(0.1, (layer.widthPx || 320) / pps);
            const endPx = Math.round((layer.startSec + layer.durationSec) * pps);
            layer.widthPx = Math.max(16, endPx - layer.startPx);
          }
        });

        if (layers.length === 0) {
          if (!existingEmpty && viewport) {
            const emptyState = document.createElement('div');
            emptyState.className = 'timeline-empty-state';
            emptyState.id = 'timeline-empty-state';
            emptyState.innerHTML = `
              <div class="timeline-empty-icon" aria-hidden="true">
                <i class='fticon fticon-icon-11' aria-hidden='true'></i>
              </div>
              <span class="timeline-empty-text">Drop media here to import</span>
            `;
            viewport.appendChild(emptyState);
          }
        } else if (existingEmpty) {
          existingEmpty.remove();
        }

        layers.forEach(layer => {
          const clipType = layer.type === 'shape' ? 'shape' : (layer.type === 'text' ? 'text' : (layer.type === 'video' ? 'video' : (layer.type === 'audio' ? 'audio' : (layer.type === 'adjustment' ? 'adjustment' : (layer.type === 'camera' ? 'camera' : (layer.type === 'null' ? 'null' : (layer.type === 'precomp' ? 'precomp' : (layer.type === 'color' ? 'color' : 'image'))))))));
          const typeTag = layer.type === 'shape' ? 'SHP' : (layer.type === 'text' ? 'TXT' : (layer.type === 'video' ? 'VID' : (layer.type === 'audio' ? 'AUD' : (layer.type === 'adjustment' ? 'ADJ' : (layer.type === 'camera' ? (layer.isOverlapCamera ? 'O-CAM' : 'CAM') : (layer.type === 'null' ? (layer.isOverlapNull ? 'O-NULL' : 'NULL') : (layer.type === 'precomp' ? (layer.groupType === 'mask' ? 'MASK' : (layer.groupType === 'exclude' ? 'EXCL' : 'COMP')) : (layer.type === 'color' ? 'CLR' : 'IMG'))))))));
          const isSelected = selectedLayerIds.has(layer.id) || layer.id === selectedLayerId;
          const isHidden = !!layer.hidden;

          // 1. Floating Pill Control anchored on the left overlay of viewport
          if (overlayContainer) {
            const isFocused = !isSelectorMode && isSelected && (layer.id === selectedLayerId);
            const pillSlot = document.createElement('div');
            pillSlot.className = `timeline-lane-pill-slot ${isFocused ? 'is-focused' : ''}`;
            pillSlot.dataset.layerId = layer.id;
            pillSlot.innerHTML = `
              <div class="timeline-layer-ctrl-pill ${isSelected ? 'is-selected' : ''} ${isHidden ? 'is-hidden' : ''} ${layer.type === 'precomp' ? 'has-precomp-expand' : ''}" 
                   title="${layer.name} - ${isHidden ? 'Klik untuk tampilkan' : 'Klik untuk sembunyikan'}"
                   data-layer-id="${layer.id}">
                <button type="button" class="timeline-layer-eye-btn" aria-label="${isHidden ? 'Show Layer' : 'Hide Layer'}" title="${isHidden ? 'Show Layer' : 'Hide Layer'}">
                  <span class="fticon ${isHidden ? 'fticon fticon-eye-off' : 'fticon fticon-eye'}" aria-hidden="true"></span>
                </button>
                ${layer.type === 'precomp' && !isDesktop ? `
                <button type="button" class="timeline-layer-precomp-expand-btn ${layer._precompExpanded ? 'is-expanded' : ''}" aria-label="${layer._precompExpanded ? 'Collapse Group' : 'Expand Group'}" title="${layer._precompExpanded ? 'Collapse Group' : 'Expand Group'}">
                  <span class="fticon fticon-chevron-right" aria-hidden="true"></span>
                </button>
                ` : ''}
                <button type="button" class="timeline-layer-checkbox ${isSelected ? 'is-selected' : ''}" aria-label="${isSelected ? 'Deselect Layer' : 'Select Layer'}" title="${isSelected ? 'Deselect Layer' : 'Select Layer'}">
                  <span class="fticon fticon-check" aria-hidden="true"></span>
                </button>
              </div>
            `;

            // Expand / Collapse Precompose Group
            const precompExpBtn = pillSlot.querySelector('.timeline-layer-precomp-expand-btn');
            if (precompExpBtn) {
              precompExpBtn.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
              });
              precompExpBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                layer._precompExpanded = !layer._precompExpanded;
                renderTimelineLayers();
              });
            }

            // Toggle Hide / Show on eye button click (Normal Mode) + Long-press hold to trigger selection
            const eyeBtn = pillSlot.querySelector('.timeline-layer-eye-btn');
            if (eyeBtn) {
              let eyeHoldTimer = null;
              let eyeHoldFired = false;
              let eyeStartX = 0;
              let eyeStartY = 0;
              let eyeIsDragging = false;
              let eyeInitialSelectedIds = null;
              const currentLayers = typeof getVisibleTimelineLayers === 'function' ? getVisibleTimelineLayers() : (currentProjectState.layers || []);
              const startIdx = currentLayers.findIndex(l => l.id === layer.id);

              function onEyePointerDown(e) {
                if (e.button !== undefined && e.button !== 0) return;
                eyeStartX = e.clientX;
                eyeStartY = e.clientY;
                eyeHoldFired = false;
                eyeIsDragging = false;
                eyeInitialSelectedIds = new Set(selectedLayerIds);

                eyeHoldTimer = setTimeout(() => {
                  eyeHoldFired = true;
                  try { eyeBtn.setPointerCapture(e.pointerId); } catch (_) {}

                  if (!isSelectorMode) {
                    isSelectorMode = true;
                    window.isSelectorMode = true;
                  }

                  if (selectedLayerIds.has(layer.id) && selectedLayerIds.size > 1) {
                    selectedLayerIds.delete(layer.id);
                    selectedLayerId = selectedLayerIds.size > 0 ? Array.from(selectedLayerIds)[selectedLayerIds.size - 1] : null;
                  } else {
                    selectedLayerIds.add(layer.id);
                    selectedLayerId = layer.id;
                  }
                  window.selectedLayerId = selectedLayerId;
                  window.selectedLayerIds = selectedLayerIds;

                  if (typeof syncSelectionClassesInPlace === 'function') {
                    syncSelectionClassesInPlace();
                  }
                  if (typeof updateEditorHeaderMode === 'function') {
                    updateEditorHeaderMode();
                  }
                  if (navigator.vibrate) navigator.vibrate(25);
                }, 200);

                function onEyePointerMove(me) {
                  const distX = Math.abs(me.clientX - eyeStartX);
                  const distY = Math.abs(me.clientY - eyeStartY);
                  const dist = Math.hypot(distX, distY);

                  if (!eyeHoldFired && dist > 6) {
                    clearTimeout(eyeHoldTimer);
                    eyeHoldTimer = null;
                  }

                  // If hold already fired, enable vertical drag-to-select!
                  if (eyeHoldFired) {
                    eyeIsDragging = true;
                    me.preventDefault();

                    if (typeof getLayerIndexAtY === 'function') {
                      const curIdx = getLayerIndexAtY(me.clientY);
                      if (curIdx !== -1 && startIdx !== -1) {
                        const minIdx = Math.min(startIdx, curIdx);
                        const maxIdx = Math.max(startIdx, curIdx);
                        const nextSelected = new Set(eyeInitialSelectedIds || []);
                        for (let i = minIdx; i <= maxIdx; i++) {
                          if (currentLayers[i]) nextSelected.add(currentLayers[i].id);
                        }
                        selectedLayerIds = nextSelected;
                        selectedLayerId = currentLayers[curIdx]?.id || layer.id;
                        window.selectedLayerIds = selectedLayerIds;
                        window.selectedLayerId = selectedLayerId;

                        if (typeof syncSelectionClassesInPlace === 'function') {
                          syncSelectionClassesInPlace();
                        }
                        if (typeof updateEditorHeaderMode === 'function') {
                          updateEditorHeaderMode();
                        }
                      }
                    }
                  }
                }

                function onEyePointerUp(ue) {
                  _cachedLanePitch = null;
                  _cachedOverlayTop = null;
                  if (eyeHoldTimer) {
                    clearTimeout(eyeHoldTimer);
                    eyeHoldTimer = null;
                  }
                  try { eyeBtn.releasePointerCapture(ue.pointerId); } catch (_) {}
                  window.removeEventListener('pointermove', onEyePointerMove);
                  window.removeEventListener('pointerup', onEyePointerUp);
                  window.removeEventListener('pointercancel', onEyePointerUp);

                  if (eyeHoldFired || eyeIsDragging) {
                    ue.preventDefault();
                    ue.stopPropagation();
                    setTimeout(() => {
                      eyeHoldFired = false;
                      eyeIsDragging = false;
                    }, 80);
                  }
                }

                window.addEventListener('pointermove', onEyePointerMove, { passive: false });
                window.addEventListener('pointerup', onEyePointerUp);
                window.addEventListener('pointercancel', onEyePointerUp);
              }

              eyeBtn.addEventListener('pointerdown', onEyePointerDown);

              eyeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                // If hold fired or was dragging, don't toggle visibility!
                if (eyeHoldFired || eyeIsDragging) {
                  eyeHoldFired = false;
                  eyeIsDragging = false;
                  return;
                }
                if (typeof invalidatePreviewCacheForLayer === 'function') {
                  invalidatePreviewCacheForLayer(layer);
                }
                layer.hidden = !layer.hidden;
                if (!layer.hidden && (layer.type === 'video' || layer.type === 'precomp') && window.VideoFrameExtractor) {
                  window.VideoFrameExtractor.extractLayerRange(layer);
                }
                renderTimelineLayers();
                redrawComposition();
                saveCurrentProjectLayers();
              });
            }

            // Pill Click, Long-Press & Drag-to-Select across layers (including Checkbox & Preview)
            const pillEl = pillSlot.querySelector('.timeline-layer-ctrl-pill');
            if (pillEl) {
              function onPillPointerDown(e) {
                if (
                  e.target.closest('.timeline-layer-eye-btn') ||
                  e.target.closest('.timeline-layer-precomp-expand-btn') ||
                  e.target.closest('.desktop-layer-twistie-btn') ||
                  e.target.closest('.desktop-layer-control-col') ||
                  e.target.closest('.desktop-layer-mblur-btn') ||
                  e.target.closest('.desktop-layer-parent-col') ||
                  e.target.closest('.desktop-layer-pickwhip-btn') ||
                  e.target.closest('.desktop-layer-parent-badge') ||
                  e.target.closest('.desktop-layer-null-icon')
                ) return;
                if (e.button !== undefined && e.button !== 0) return;

                // Stop browser default text selection, image drag, and touch scroll
                e.preventDefault();

                const currentLayers = typeof getVisibleTimelineLayers === 'function' ? getVisibleTimelineLayers() : (currentProjectState.layers || []);
                const startIdx = currentLayers.findIndex(l => l.id === layer.id);
                if (startIdx === -1) return;

                const startX = e.clientX;
                const startY = e.clientY;
                const pointerId = e.pointerId;

                let isDragMode = false;
                let hasHoldFired = false;
                let initialSelectedIds = new Set(selectedLayerIds);

                try {
                  pillEl.setPointerCapture(pointerId);
                } catch (_) {}

                // Long-press hold timer (550ms) to trigger selector mode
                const holdTimer = setTimeout(() => {
                  hasHoldFired = true;
                  isSelectorMode = true;
                  selectedLayerIds.add(layer.id);
                  selectedLayerId = layer.id;
                  window.selectedLayerId = selectedLayerId;
                  window.selectedLayerIds = selectedLayerIds;

                  syncSelectionClassesInPlace();
                  updateEditorHeaderMode();
                  if (navigator.vibrate) navigator.vibrate(25);
                }, 550);

                function onPillPointerMove(moveEvent) {
                  const distX = Math.abs(moveEvent.clientX - startX);
                  const distY = Math.abs(moveEvent.clientY - startY);
                  const dist = Math.hypot(distX, distY);

                  // If pointer moved vertically across pills (> 8px), trigger drag selection!
                  if (!isDragMode && (distY > 8 || (isSelectorMode && dist > 4))) {
                    isDragMode = true;
                    clearTimeout(holdTimer);

                    if (!isSelectorMode) {
                      isSelectorMode = true;
                    }

                    if (!hasHoldFired && initialSelectedIds.size <= 1) {
                      initialSelectedIds = new Set([layer.id]);
                    } else {
                      initialSelectedIds.add(layer.id);
                    }
                  }

                  if (isDragMode) {
                    moveEvent.preventDefault();

                    const currentIdx = getLayerIndexAtY(moveEvent.clientY);
                    if (currentIdx !== -1) {
                      const minIdx = Math.min(startIdx, currentIdx);
                      const maxIdx = Math.max(startIdx, currentIdx);

                      const nextSelected = new Set(initialSelectedIds);
                      for (let i = minIdx; i <= maxIdx; i++) {
                        if (currentLayers[i]) {
                          nextSelected.add(currentLayers[i].id);
                        }
                      }

                      selectedLayerIds = nextSelected;
                      selectedLayerId = currentLayers[currentIdx]?.id || layer.id;
                      window.selectedLayerIds = selectedLayerIds;
                      window.selectedLayerId = selectedLayerId;

                      syncSelectionClassesInPlace();
                      updateEditorHeaderMode();
                    }
                  }
                }

                function onPillPointerUp(upEvent) {
                  _cachedLanePitch = null;
                  _cachedOverlayTop = null;
                  clearTimeout(holdTimer);
                  try {
                    pillEl.releasePointerCapture(pointerId);
                  } catch (_) {}

                  window.removeEventListener('pointermove', onPillPointerMove);
                  window.removeEventListener('pointerup', onPillPointerUp);
                  window.removeEventListener('pointercancel', onPillPointerUp);

                  if (isDragMode) {
                    renderTimelineLayers();
                    redrawComposition();
                    updateEditorHeaderMode();
                    return;
                  }

                  if (hasHoldFired) {
                    renderTimelineLayers();
                    redrawComposition();
                    updateEditorHeaderMode();
                    return;
                  }

                  // Tap / click without drag or hold
                  if (isSelectorMode) {
                    toggleSelectTimelineLayer(layer.id, true);
                  } else {
                    toggleSelectTimelineLayer(layer.id, false);
                  }
                }

                window.addEventListener('pointermove', onPillPointerMove, { passive: false });
                window.addEventListener('pointerup', onPillPointerUp);
                window.addEventListener('pointercancel', onPillPointerUp);
              }

              pillEl.addEventListener('pointerdown', onPillPointerDown);
              pillEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                triggerClipContextMenu(layer, e.clientX, e.clientY, e);
              });
            }

            if (isDesktop && layer._kfExpanded && layer.type !== 'precomp') {
              pillSlot.classList.add('is-kf-expanded');
              const treeEl = buildDesktopKfPropertyTree(layer, layer._kfExpandedOnlyKeyframed);
              pillSlot.appendChild(treeEl);
            }
            overlayContainer.appendChild(pillSlot);
          }

          // 2. Timeline Track Lane in layersTrack
          const isReverse = (layer.speed !== undefined && layer.speed < 0);
          const isConvertingAudio = !!layer._convertingAudio;
          const convertPct = Math.max(0, Math.min(100, Math.round(Number(layer._convertProgress) || 0)));
          const lane = document.createElement('div');
          lane.className = 'timeline-track-lane';
          lane.dataset.layerId = layer.id;
          lane.innerHTML = `
            <div class="track-content-lane">
              <div class="timeline-clip-block clip-${clipType} ${isConvertingAudio ? 'is-converting-audio' : ''} ${isSelected ? 'is-selected' : ''} ${isHidden ? 'is-hidden' : ''} ${isReverse ? 'is-reverse' : ''}" 
                   style="left: ${layer.startPx || 0}px; width: ${layer.widthPx || 320}px;" 
                   title="${layer.name}${isReverse ? ' (Reverse ' + layer.speed + 'x)' : ''}${isHidden ? ' (Hidden)' : ''}" 
                   data-layer-id="${layer.id}"
                   ${layer.mediaId ? `data-media-id="${layer.mediaId}"` : ''}>
                ${isConvertingAudio ? `
                  <div class="clip-convert-progress-fill" style="width: ${convertPct}%;"></div>
                  <span class="clip-convert-progress-num">${convertPct}%</span>
                ` : `
                  <button type="button" class="timeline-clip-handle handle-left" aria-label="Trim / Lengthen Start" title="Drag to trim or lengthen start">
                    <span class="fticon fticon-chevron-left" style="width: 13px; height: 13px;" aria-hidden="true"></span>
                  </button>
                  <span class="timeline-clip-tag">${typeTag}${isReverse ? ' ◀' : ''}</span>
                  <span class="clip-label">${layer.name}</span>
                  <button type="button" class="timeline-clip-handle handle-right" aria-label="Trim / Lengthen End" title="Drag to trim or lengthen end">
                    <span class="fticon fticon-chevron-right" style="width: 13px; height: 13px;" aria-hidden="true"></span>
                  </button>
                  ${(clipType === 'video' || clipType === 'precomp') ? '<div class="timeline-clip-progress-track"><div class="timeline-clip-progress"></div></div>' : ''}
                  ${(clipType === 'audio') ? '<canvas class="timeline-audio-waveform-canvas"></canvas>' : ''}
                  ${(clipType === 'text') ? (() => {
                    const pps = window.currentPixelsPerSecond || 80;
                    const tp = layer.textProps || {};
                    const animInDur = Math.max(0.1, Number(tp.animInDuration || tp.animDuration) || 0.8);
                    const animOutDur = Math.max(0.1, Number(tp.animOutDuration) || 0.6);
                    const clipW = layer.widthPx || 320;
                    const hasIn = (tp.animIn || tp.animation || 'none') !== 'none';
                    const hasOut = (tp.animOut || 'none') !== 'none';

                    const inPx = Math.min(clipW * 0.48, Math.round(animInDur * pps));
                    const outPx = Math.min(clipW * 0.48, Math.round(animOutDur * pps));
                    const inMarkerLeft = Math.max(34, inPx - 42);
                    const outMarkerRight = Math.max(2, outPx - 48);

                    return `
                      ${hasIn ? `
                        <div class="text-anim-zone zone-in" style="width: ${inPx}px;" title="IN Animation: ${(tp.animIn || tp.animation || 'none').toUpperCase()} (${animInDur.toFixed(2)}s)"></div>
                        <div class="text-anim-marker marker-in" style="left: ${inMarkerLeft}px;" data-layer-id="${layer.id}" title="IN: ${animInDur.toFixed(2)}s (Drag to adjust)">IN ${animInDur.toFixed(1)}s</div>
                      ` : ''}
                      ${hasOut ? `
                        <div class="text-anim-zone zone-out" style="width: ${outPx}px;" title="OUT Animation: ${(tp.animOut || 'none').toUpperCase()} (${animOutDur.toFixed(2)}s)"></div>
                        <div class="text-anim-marker marker-out" style="right: ${outMarkerRight}px;" data-layer-id="${layer.id}" title="OUT: ${animOutDur.toFixed(2)}s (Drag to adjust)">OUT ${animOutDur.toFixed(1)}s</div>
                      ` : ''}
                    `;
                  })() : ''}
                  <div class="timeline-clip-keyframes"></div>
                `}
              </div>
            </div>
          `;

          // Select / Deselect clip on click & Long-Press Horizontal Slide
          const clipEl = lane.querySelector('.timeline-clip-block');
          if (clipEl && !isConvertingAudio) {
            if (!isDesktop || !layer._kfExpanded) {
              renderLayerKeyframes(layer, clipEl);
            }
            if (clipType === 'audio') {
              renderAudioClipWaveform(layer, clipEl);
            }
            if ((clipType === 'video' || clipType === 'precomp') && !layer.hidden && window.VideoFrameExtractor) {
              window.VideoFrameExtractor.extractLayerRange(layer);
            }

            // Interactive Drag for Text IN / OUT Animation Markers (Only in selection mode)
            if (clipType === 'text') {
              clipEl.querySelectorAll('.text-anim-marker').forEach(marker => {
                marker.addEventListener('pointerdown', (e) => {
                  const isSelected = clipEl.classList.contains('is-selected') || (window.selectedLayerId === layer.id);
                  if (!isSelected) return;

                  e.stopPropagation();
                  e.preventDefault();
                  if (e.button !== undefined && e.button !== 0) return;

                  const isMarkerIn = marker.classList.contains('marker-in');
                  const startX = e.clientX;
                  const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
                  const tp = layer.textProps || (layer.textProps = {});
                  const initialInDur = Math.max(0.1, Number(tp.animInDuration || tp.animDuration) || 0.8);
                  const initialOutDur = Math.max(0.1, Number(tp.animOutDuration) || 0.6);
                  const clipW = layer.widthPx || 320;
                  const clipDurSec = layer.durationSec !== undefined ? layer.durationSec : (clipW / pps);

                  marker.classList.add('is-dragging');

                  function onAnimMarkerMove(moveEv) {
                    moveEv.stopPropagation();
                    moveEv.preventDefault();
                    const dx = moveEv.clientX - startX;

                    if (isMarkerIn) {
                      const deltaSec = dx / pps;
                      const maxIn = Math.max(0.2, clipDurSec * 0.48);
                      const newDur = Number(Math.max(0.1, Math.min(maxIn, initialInDur + deltaSec)).toFixed(2));
                      tp.animInDuration = newDur;
                      tp.animDuration = newDur;
                      marker.textContent = `IN ${newDur.toFixed(1)}s`;
                      marker.title = `IN: ${newDur.toFixed(2)}s (Drag to adjust)`;
                      const newPx = Math.min(clipW * 0.48, Math.round(newDur * pps));
                      marker.style.left = `${Math.max(34, newPx - 42)}px`;
                      const zoneIn = clipEl.querySelector('.text-anim-zone.zone-in');
                      if (zoneIn) zoneIn.style.width = `${newPx}px`;

                      const valBadge = document.getElementById('val-text-anim-in-duration');
                      if (valBadge) valBadge.textContent = `${newDur.toFixed(2)}s`;
                      const badgeJog = document.getElementById('badge-text-anim-in-dur');
                      if (badgeJog) badgeJog.textContent = `${newDur.toFixed(2)}s`;
                    } else {
                      // Dragging OUT marker leftward increases duration, rightward decreases
                      const deltaSec = -dx / pps;
                      const maxOut = Math.max(0.2, clipDurSec * 0.48);
                      const newDur = Number(Math.max(0.1, Math.min(maxOut, initialOutDur + deltaSec)).toFixed(2));
                      tp.animOutDuration = newDur;
                      marker.textContent = `OUT ${newDur.toFixed(1)}s`;
                      marker.title = `OUT: ${newDur.toFixed(2)}s (Drag to adjust)`;
                      const newPx = Math.min(clipW * 0.48, Math.round(newDur * pps));
                      marker.style.right = `${Math.max(2, newPx - 48)}px`;
                      const zoneOut = clipEl.querySelector('.text-anim-zone.zone-out');
                      if (zoneOut) zoneOut.style.width = `${newPx}px`;

                      const valBadge = document.getElementById('val-text-anim-out-duration');
                      if (valBadge) valBadge.textContent = `${newDur.toFixed(2)}s`;
                      const badgeJog = document.getElementById('badge-text-anim-out-dur');
                      if (badgeJog) badgeJog.textContent = `${newDur.toFixed(2)}s`;
                    }

                    layer._textBufferCanvas = null;
                    if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
                    redrawComposition();
                  }

                  function onAnimMarkerUp() {
                    marker.classList.remove('is-dragging');
                    window.removeEventListener('pointermove', onAnimMarkerMove);
                    window.removeEventListener('pointerup', onAnimMarkerUp);
                    window.removeEventListener('pointercancel', onAnimMarkerUp);
                    saveCurrentProjectLayers();
                  }

                  window.addEventListener('pointermove', onAnimMarkerMove, { passive: false });
                  window.addEventListener('pointerup', onAnimMarkerUp);
                  window.addEventListener('pointercancel', onAnimMarkerUp);
                });
              });
            }

            let lpHoldTimer = null;
            let isHoldActive = false;
            let isDraggingLayer = false;
            let hasSlid = false;
            let hasMenuOpened = false;
            let isPanPassthrough = false;
            let startPointerX = 0;
            let startPointerY = 0;
            let panStartX = 0;
            let panStartY = 0;
            let panStartPanX = 0;
            let panStartScrollTop = 0;
            let initialStartPx = 0;
            let justFinishedSlide = false;
            let justTappedInPointerUp = false;
            let slideRedrawRaf = null;
            const HOLD_DELAY = 360;

            function onClipPointerDown(e) {
              justTappedInPointerUp = false;
              if (window.isTimelinePinching || (window.timelinePinchEndTime && Date.now() - window.timelinePinchEndTime < 250)) return;
              if (e.target.closest('.timeline-clip-handle') || e.target.closest('.timeline-keyframe-marker.is-active-prop') || e.target.closest('.timeline-keyframe-marker.is-out-of-bounds') || e.target.closest('.text-anim-marker')) return;
              if (e.button !== undefined && e.button !== 0) return;

              startPointerX = e.clientX;
              startPointerY = e.clientY;
              initialStartPx = layer.startPx || 0;
              const initialSlideStartSec = layer.startSec !== undefined ? layer.startSec : (initialStartPx / pixelsPerSecond);
              const initialSlideDurSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pixelsPerSecond);
              const initialSlideEndSec = initialSlideStartSec + initialSlideDurSec;
              const initialLayerKeyframes = layer.keyframes ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.keyframes) : (Array.isArray(layer.keyframes) ? [] : {})) : null;
              isHoldActive = false;
              isDraggingLayer = false;
              hasSlid = false;
              hasMenuOpened = false;
              isPanPassthrough = false;

              const isSelectedLayer = (layer.id === window.selectedLayerId);

              // Multi-layer drag support: when multiple layers are selected or in selector mode, dragging one shifts all together
              const isLayerCurrentlySelected = isLayerSelected(layer.id);
              const isMultiSelectState = isSelectorMode || (window.selectedLayerIds && window.selectedLayerIds.size > 1);
              const isMultiDragging = isMultiSelectState && isLayerCurrentlySelected;
              let multiDragLayers = [];
              if (isMultiDragging) {
                const currentLayers = currentProjectState.layers || [];
                multiDragLayers = currentLayers.filter(l => isLayerSelected(l.id)).map(l => {
                  const sInitPx = l.startPx || 0;
                  const sInitSec = l.startSec !== undefined ? l.startSec : (sInitPx / pixelsPerSecond);
                  const sDurSec = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 320) / pixelsPerSecond);
                  const sClipEl = document.querySelector(`.timeline-clip-block[data-layer-id="${l.id}"]`);
                  return {
                    layer: l,
                    initialStartPx: sInitPx,
                    initialStartSec: sInitSec,
                    initialSlideStartSec: sInitSec,
                    initialEndSec: sInitSec + sDurSec,
                    durationSec: sDurSec,
                    clipEl: sClipEl,
                    initialKeyframes: l.keyframes ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.keyframes) : JSON.parse(JSON.stringify(l.keyframes))) : null
                  };
                });
              }

              // Hold timer (360ms): triggers hold state without opening popover
              lpHoldTimer = setTimeout(() => {
                if (hasSlid || isPanPassthrough) return;
                isHoldActive = true;
                if (navigator.vibrate) try { navigator.vibrate(25); } catch (_) {}
                clipEl.classList.add('is-held');
                if (isMultiDragging && multiDragLayers.length > 0) {
                  multiDragLayers.forEach(m => { if (m.clipEl) m.clipEl.classList.add('is-held'); });
                }
              }, HOLD_DELAY);

              function onClipPointerMove(moveEvent) {
                if (window.isTimelinePinching) {
                  if (lpHoldTimer) {
                    clearTimeout(lpHoldTimer);
                    lpHoldTimer = null;
                  }
                  return;
                }
                const dist = Math.hypot(moveEvent.clientX - startPointerX, moveEvent.clientY - startPointerY);

                if (hasMenuOpened) return;

                // 1. If user moves pointer BEFORE hold duration is reached: cancel hold, pan timeline
                if (!isHoldActive) {
                  if (dist > 6) {
                    if (lpHoldTimer) {
                      clearTimeout(lpHoldTimer);
                      lpHoldTimer = null;
                    }

                    // Forward to timeline scrubbing & vertical viewport scrolling
                    if (!isPanPassthrough) {
                      isPanPassthrough = true;
                      panStartX = moveEvent.clientX;
                      panStartY = moveEvent.clientY;
                      panStartPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
                      panStartScrollTop = document.getElementById('timeline-layers-viewport')?.scrollTop || 0;
                      window.isTimelinePanning = true;
                      window.isTimelineScrubbing = true;
                      if (window.FishAudioEngine) window.FishAudioEngine.startScrub();
                      const vp = document.getElementById('timeline-layers-viewport');
                      if (vp) vp.classList.add('is-dragging');
                    }

                    const deltaX = moveEvent.clientX - panStartX;
                    const deltaY = moveEvent.clientY - panStartY;
                    const bounds = (typeof getTimelineBounds === 'function') ? getTimelineBounds() : { min: -10000, max: 0 };
                    let targetPanX = Math.max(bounds.min, Math.min(0, panStartPanX + deltaX));
                    const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (window.currentTimelineFps || 60);
                    const activePps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
                    const rawSec = Math.max(0, -targetPanX / activePps);
                    const snappedSec = Math.round(rawSec * safeFps) / safeFps;
                    targetPanX = -snappedSec * activePps;
                    if (typeof updateTimelinePosition === 'function') {
                      updateTimelinePosition(targetPanX);
                    }
                    const vp = document.getElementById('timeline-layers-viewport');
                    if (vp) {
                      vp.scrollTop = panStartScrollTop - deltaY;
                    }
                  }
                  return;
                }

                // 2. User HAS held (isHoldActive === true): drag enters layer slide mode!
                if (dist <= 4 && !isDraggingLayer) return;

                if (!isDraggingLayer) {
                  isDraggingLayer = true;
                  clipEl.classList.remove('is-held');
                  if (isMultiDragging && multiDragLayers.length > 0) {
                    multiDragLayers.forEach(m => {
                      if (m.clipEl) {
                        m.clipEl.classList.remove('is-held');
                        m.clipEl.classList.add('is-sliding');
                      }
                    });
                  } else {
                    clipEl.classList.remove('is-held');
                    clipEl.classList.add('is-sliding');
                  }
                  try {
                    clipEl.setPointerCapture(e.pointerId);
                  } catch (_) {}
                }

                moveEvent.preventDefault();
                hasSlid = true;
                window.isTransformInteracting = true;
                const deltaX = moveEvent.clientX - startPointerX;

                if (isMultiDragging && multiDragLayers.length > 0) {
                  const minMultiStartPx = Math.min(...multiDragLayers.map(m => m.initialStartPx));
                  const clampedDeltaX = Math.max(-minMultiStartPx, deltaX);

                  let targetStartPx = Math.max(0, initialStartPx + clampedDeltaX);
                  const durPx = layer.widthPx || Math.round((layer.durationSec || 5) * pixelsPerSecond);
                  const targetEndPx = targetStartPx + durPx;

                  // Snap sliding primary layer to timeline targets (excluding layers moving together)
                  const snapTargets = (typeof getTimelineSnapTargets === 'function') ? getTimelineSnapTargets(layer.id, true) : [];
                  const multiIds = new Set(multiDragLayers.map(m => m.layer.id));
                  const filteredSnapTargets = snapTargets.filter(st => !multiIds.has(st.layerId));

                  const startSnap = (typeof findTimelineSnap === 'function') ? findTimelineSnap(targetStartPx, filteredSnapTargets, 10) : null;
                  const endSnap = (typeof findTimelineSnap === 'function') ? findTimelineSnap(targetEndPx, filteredSnapTargets, 10) : null;

                  let activeSnap = null;
                  if (startSnap && endSnap) {
                    const diffStart = Math.abs(targetStartPx - startSnap.px);
                    const diffEnd = Math.abs(targetEndPx - endSnap.px);
                    activeSnap = diffStart <= diffEnd ? { ...startSnap, snapEnd: false } : { ...endSnap, snapEnd: true };
                  } else if (startSnap) {
                    activeSnap = { ...startSnap, snapEnd: false };
                  } else if (endSnap) {
                    activeSnap = { ...endSnap, snapEnd: true };
                  }

                  if (activeSnap) {
                    if (activeSnap.snapEnd) {
                      targetStartPx = Math.max(0, activeSnap.px - durPx);
                    } else {
                      targetStartPx = activeSnap.px;
                    }
                    if (typeof showTimelineSnapGuide === 'function') showTimelineSnapGuide(activeSnap.px);
                    if (window._lastSlideSnapPx !== activeSnap.px) {
                      window._lastSlideSnapPx = activeSnap.px;
                      if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
                    }
                  } else {
                    if (typeof hideTimelineSnapGuide === 'function') hideTimelineSnapGuide();
                    window._lastSlideSnapPx = null;
                  }

                  const effectiveDeltaPx = Math.max(-minMultiStartPx, targetStartPx - initialStartPx);
                  const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60);
                  const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
                  const snappedDeltaSec = Math.round((effectiveDeltaPx / pps) * safeFps) / safeFps;

                  multiDragLayers.forEach(m => {
                    m.layer.startSec = Math.max(0, Math.round((m.initialStartSec + snappedDeltaSec) * safeFps) / safeFps);
                    m.layer.startPx = Math.round(m.layer.startSec * pps);
                    const curSlideEndSec = (m.layer.startSec || 0) + (m.layer.durationSec || ((m.layer.widthPx || 320) / pps));
                    const rulerDuration = (typeof lastGeneratedDuration !== 'undefined') ? lastGeneratedDuration : (typeof window !== 'undefined' && typeof window.lastGeneratedDuration === 'number' ? window.lastGeneratedDuration : 0);
                    if (curSlideEndSec > rulerDuration) {
                      if (typeof generateRulerTicks === 'function') {
                        generateRulerTicks(safeFps);
                      } else if (typeof window !== 'undefined' && typeof window.generateRulerTicks === 'function') {
                        window.generateRulerTicks(safeFps);
                      }
                    }
                    if (m.clipEl) {
                      m.clipEl.style.left = `${m.layer.startPx}px`;
                    }
                    if (m.initialKeyframes && m.layer.keyframes) {
                      const mDeltaSec = m.layer.startSec - m.initialStartSec;
                      for (const [p, kfs] of Object.entries(m.initialKeyframes)) {
                        if (!Array.isArray(kfs) || !Array.isArray(m.layer.keyframes[p])) continue;
                        kfs.forEach((initKf, idx) => {
                          const curKf = m.layer.keyframes[p][idx];
                          if (curKf) {
                            curKf.time = Number(Math.max(0, initKf.time + mDeltaSec).toFixed(4));
                          }
                        });
                      }
                      if (m.clipEl && (!isDesktop || !m.layer._kfExpanded)) {
                        renderLayerKeyframes(m.layer, m.clipEl);
                      }
                    }
                  });
                } else {
                  // Single layer drag
                  const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60);
                  const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
                  let newStartPx = Math.max(0, initialStartPx + deltaX);
                  const durPx = layer.widthPx || Math.round((layer.durationSec || 5) * pps);
                  const durSec = layer.durationSec !== undefined ? layer.durationSec : (durPx / pps);
                  const newEndPx = newStartPx + durPx;

                  // Snap sliding layer (start & end) to beatmarks, adjacent layers depan/belakang, and playhead
                  const snapTargets = (typeof getTimelineSnapTargets === 'function') ? getTimelineSnapTargets(layer.id, true) : [];
                  const startSnap = (typeof findTimelineSnap === 'function') ? findTimelineSnap(newStartPx, snapTargets, 10) : null;
                  const endSnap = (typeof findTimelineSnap === 'function') ? findTimelineSnap(newEndPx, snapTargets, 10) : null;

                  let activeSnap = null;
                  if (startSnap && endSnap) {
                    const diffStart = Math.abs(newStartPx - startSnap.px);
                    const diffEnd = Math.abs(newEndPx - endSnap.px);
                    activeSnap = diffStart <= diffEnd ? { ...startSnap, snapEnd: false } : { ...endSnap, snapEnd: true };
                  } else if (startSnap) {
                    activeSnap = { ...startSnap, snapEnd: false };
                  } else if (endSnap) {
                    activeSnap = { ...endSnap, snapEnd: true };
                  }

                  if (activeSnap) {
                    const snapSec = Math.round((activeSnap.sec !== undefined ? activeSnap.sec : (activeSnap.px / pps)) * safeFps) / safeFps;
                    if (activeSnap.snapEnd) {
                      layer.startSec = Math.max(0, Math.round((snapSec - durSec) * safeFps) / safeFps);
                    } else {
                      layer.startSec = Math.max(0, snapSec);
                    }
                    layer.startPx = Math.round(layer.startSec * pps);
                    if (typeof showTimelineSnapGuide === 'function') showTimelineSnapGuide(activeSnap.px);
                    if (window._lastSlideSnapPx !== activeSnap.px) {
                      window._lastSlideSnapPx = activeSnap.px;
                      if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
                    }
                  } else {
                    if (typeof hideTimelineSnapGuide === 'function') hideTimelineSnapGuide();
                    window._lastSlideSnapPx = null;
                    const rawStartSec = Math.max(0, (initialStartPx + deltaX) / pps);
                    layer.startSec = Math.max(0, Math.round(rawStartSec * safeFps) / safeFps);
                    layer.startPx = Math.round(layer.startSec * pps);
                  }

                  const curSlideEndSec = (layer.startSec || 0) + (layer.durationSec || ((layer.widthPx || 320) / pps));
                  const rulerDuration = (typeof lastGeneratedDuration !== 'undefined') ? lastGeneratedDuration : (typeof window !== 'undefined' && typeof window.lastGeneratedDuration === 'number' ? window.lastGeneratedDuration : 0);
                  if (curSlideEndSec > rulerDuration) {
                    if (typeof generateRulerTicks === 'function') {
                      generateRulerTicks(safeFps);
                    } else if (typeof window !== 'undefined' && typeof window.generateRulerTicks === 'function') {
                      window.generateRulerTicks(safeFps);
                    }
                  }
                  clipEl.style.left = `${layer.startPx}px`;

                  if (initialLayerKeyframes && layer.keyframes) {
                    const deltaSec = layer.startSec - initialSlideStartSec;
                    for (const [p, kfs] of Object.entries(initialLayerKeyframes)) {
                      if (!Array.isArray(kfs) || !Array.isArray(layer.keyframes[p])) continue;
                      kfs.forEach((initKf, idx) => {
                        const curKf = layer.keyframes[p][idx];
                        if (curKf) {
                          curKf.time = Number((initKf.time + deltaSec).toFixed(4));
                        }
                      });
                    }
                  }
                }

                if (!slideRedrawRaf) {
                  slideRedrawRaf = requestAnimationFrame(() => {
                    slideRedrawRaf = null;
                    if (typeof renderTimelineLinkConnectors === 'function') renderTimelineLinkConnectors();
                    redrawComposition();
                  });
                }
              }

              function onClipPointerUp(upEvent) {
                if (typeof hideTimelineSnapGuide === 'function') hideTimelineSnapGuide();
                window._lastSlideSnapPx = null;

                if (slideRedrawRaf) {
                  cancelAnimationFrame(slideRedrawRaf);
                  slideRedrawRaf = null;
                }
                if (lpHoldTimer) {
                  clearTimeout(lpHoldTimer);
                  lpHoldTimer = null;
                }

                clipEl.classList.remove('is-held');
                if (isMultiDragging && multiDragLayers.length > 0) {
                  multiDragLayers.forEach(m => { if (m.clipEl) m.clipEl.classList.remove('is-held'); });
                }

                window.removeEventListener('pointermove', onClipPointerMove);
                window.removeEventListener('pointerup', onClipPointerUp);
                window.removeEventListener('pointercancel', onClipPointerUp);

                // Passthrough timeline pan cleanup
                if (isPanPassthrough) {
                  isPanPassthrough = false;
                  window.isTimelinePanning = false;
                  window.isTimelineScrubbing = false;
                  if (window.FishAudioEngine) window.FishAudioEngine.stopScrub();
                  const vp = document.getElementById('timeline-layers-viewport');
                  if (vp) vp.classList.remove('is-dragging');
                  const rawSec = (typeof getCurrentPlayheadTime === 'function') ? getCurrentPlayheadTime() : Math.max(0, -(window.timelinePanX || 0) / pixelsPerSecond);
                  const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (window.currentTimelineFps || 60);
                  const finalSnappedSec = Math.round(rawSec * safeFps) / safeFps;
                  const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
                  if (typeof updateTimelinePosition === 'function') {
                    updateTimelinePosition(-finalSnappedSec * pps, true);
                  }
                  justFinishedSlide = true;
                  setTimeout(() => { justFinishedSlide = false; }, 150);
                  return;
                }


                if (hasMenuOpened) {
                  window.isTransformInteracting = false;
                  return;
                }

                // Case 1: Was in layer slide mode (hold + drag) -> DO NOT open popover ("klo di lepas ga muncul pop over karena ini mode geser")
                if (isDraggingLayer || hasSlid) {
                  isDraggingLayer = false;
                  isHoldActive = false;
                  window.isTransformInteracting = false;
                  if (isMultiDragging && multiDragLayers.length > 0) {
                    multiDragLayers.forEach(m => {
                      if (m.clipEl) m.clipEl.classList.remove('is-sliding');
                      invalidatePreviewCacheForLayer(m.layer, m.initialStartSec, m.initialEndSec);
                    });
                  } else {
                    clipEl.classList.remove('is-sliding');
                    invalidatePreviewCacheForLayer(layer, initialSlideStartSec, initialSlideEndSec);
                  }
                  try {
                    clipEl.releasePointerCapture(upEvent.pointerId);
                  } catch (_) {}

                  justFinishedSlide = true;
                  if (hasSlid) {
                    const fps = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
                    const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
                    if (isMultiDragging && multiDragLayers.length > 0) {
                      multiDragLayers.forEach(m => {
                        m.layer.startSec = Math.round(m.layer.startSec * fps) / fps;
                        m.layer.startPx = Math.round(m.layer.startSec * pps);
                        if (m.initialKeyframes && m.layer.keyframes) {
                          const mDeltaSec = m.layer.startSec - m.initialStartSec;
                          for (const [p, kfs] of Object.entries(m.initialKeyframes)) {
                            if (!Array.isArray(kfs) || !Array.isArray(m.layer.keyframes[p])) continue;
                            kfs.forEach((initKf, idx) => {
                              const curKf = m.layer.keyframes[p][idx];
                              if (curKf) {
                                curKf.time = Number(Math.max(0, initKf.time + mDeltaSec).toFixed(4));
                              }
                            });
                          }
                        }
                      });
                    } else {
                      layer.startSec = Math.round(layer.startSec * fps) / fps;
                      layer.startPx = Math.round(layer.startSec * pps);
                    }
                    if (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0) {
                      window.selectedKeyframes.forEach(item => {
                        if (item.kf) item.time = item.kf.time;
                      });
                    }
                    renderTimelineLayers();
                    redrawComposition();
                    saveCurrentProjectLayers();
                    updateTimelineDuration(true);
                    if (!isMultiDragging && !isSelectorMode && (window.selectedLayerIds ? window.selectedLayerIds.size <= 1 : true)) {
                      if (typeof deselectTimelineLayer === 'function') {
                        deselectTimelineLayer();
                      }
                    }
                  }
                  setTimeout(() => { justFinishedSlide = false; }, 150);
                  return;
                }

                // Case 2: Held and released WITHOUT dragging -> Cleanly clear hold state without opening popover
                if (isHoldActive && !hasSlid) {
                  isHoldActive = false;
                  window.isTransformInteracting = false;
                  if (isMultiDragging && multiDragLayers.length > 0) {
                    multiDragLayers.forEach(m => {
                      if (m.clipEl) {
                        m.clipEl.classList.remove('is-held');
                        m.clipEl.classList.remove('is-sliding');
                      }
                    });
                  } else {
                    clipEl.classList.remove('is-held');
                    clipEl.classList.remove('is-sliding');
                  }
                  try {
                    clipEl.releasePointerCapture(upEvent.pointerId);
                  } catch (_) {}
                  return;
                }

                // Case 3: Tap without hold (Instant selection on pointerup with zero mobile click delay)
                const dist = Math.hypot(upEvent.clientX - startPointerX, upEvent.clientY - startPointerY);
                if (!hasSlid && dist <= 6) {
                  if (isSelectedLayer && !isSelectorMode) {
                    if (!upEvent.shiftKey && typeof window.clearSelectedKeyframes === 'function') {
                      window.clearSelectedKeyframes();
                    }
                  } else {
                    justTappedInPointerUp = true;
                    toggleSelectTimelineLayer(layer.id, isSelectorMode);
                    setTimeout(() => { justTappedInPointerUp = false; }, 400);
                  }
                }
                window.isTransformInteracting = false;
              }

              window.addEventListener('pointermove', onClipPointerMove, { passive: false });
              window.addEventListener('pointerup', onClipPointerUp);
              window.addEventListener('pointercancel', onClipPointerUp);
            }

            clipEl.addEventListener('pointerdown', onClipPointerDown);

            clipEl.addEventListener('click', (e) => {
              if (e.target.closest('.timeline-clip-handle') || e.target.closest('.timeline-keyframe-marker.is-active-prop') || e.target.closest('.timeline-keyframe-marker.is-out-of-bounds')) return;
              if (hasMenuOpened || justFinishedSlide || isPanPassthrough) {
                e.stopPropagation();
                e.preventDefault();
                hasMenuOpened = false;
                justFinishedSlide = false;
                return;
              }
              if (justTappedInPointerUp) {
                e.stopPropagation();
                justTappedInPointerUp = false;
                return;
              }
              e.stopPropagation();
              toggleSelectTimelineLayer(layer.id, isSelectorMode);
            });

            // Double click precomp clip to enter precompose (After Effects behavior)
            if (clipType === 'precomp') {
              clipEl.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (typeof enterPrecompose === 'function') {
                  enterPrecompose(layer.id);
                }
              });
            }

            clipEl.addEventListener('contextmenu', (e) => {
              e.preventDefault();
              e.stopPropagation();
              triggerClipContextMenu(layer, e.clientX, e.clientY, e);
            });

            // Handle left/right trim handles dragging (Lengthen / Shorten Layer)
            const leftHandle = clipEl.querySelector('.handle-left');
            const rightHandle = clipEl.querySelector('.handle-right');
            const minWidth = 36;

            if (leftHandle) {
              leftHandle.addEventListener('pointerdown', (e) => {
                const isCurrentlySelected = clipEl.classList.contains('is-selected') ||
                  (window.selectedLayerIds && window.selectedLayerIds.has(layer.id)) ||
                  (window.selectedLayerId === layer.id);
                if (!isCurrentlySelected) return;
                if (e.button !== undefined && e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                try { leftHandle.setPointerCapture(e.pointerId); } catch (_) {}

                const curPps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
                const startPointerX = e.clientX;
                const initialStartPx = layer.startPx || 0;
                const initialWidthPx = layer.widthPx || 320;
                const fixedRightPx = initialStartPx + initialWidthPx;
                const initialOffsetSec = layer.sourceOffsetSec || 0;
                const totalMediaDur = (layer.type === 'video' || layer.type === 'audio') ? getLayerMediaDuration(layer) : null;

                const initialStartSec = layer.startSec !== undefined ? layer.startSec : (initialStartPx / curPps);
                const initialDurSec = layer.durationSec !== undefined ? layer.durationSec : (initialWidthPx / curPps);
                const initialEndSec = initialStartSec + initialDurSec;
                window.isTransformInteracting = true;

                // Support batch trimming for multi-selected layers
                const isMultiSelectState = (typeof isSelectorMode !== 'undefined' && isSelectorMode) || (window.selectedLayerIds && window.selectedLayerIds.size > 1);
                const isMultiTrimming = isMultiSelectState && (window.selectedLayerIds ? window.selectedLayerIds.has(layer.id) : false);
                let multiTrimLayers = [];
                if (isMultiTrimming) {
                  const currentLayers = currentProjectState?.layers || [];
                  multiTrimLayers = currentLayers.filter(l => (typeof isLayerSelected === 'function' ? isLayerSelected(l.id) : window.selectedLayerIds?.has(l.id))).map(l => {
                    const sInitPx = l.startPx || 0;
                    const sWidthPx = l.widthPx || 320;
                    const sInitSec = l.startSec !== undefined ? l.startSec : (sInitPx / curPps);
                    const sDurSec = l.durationSec !== undefined ? l.durationSec : (sWidthPx / curPps);
                    const sClipEl = document.querySelector(`.timeline-clip-block[data-layer-id="${l.id}"]`);
                    const sLane = sClipEl?.closest('.timeline-lane-track');
                    return {
                      layer: l,
                      initialStartPx: sInitPx,
                      initialWidthPx: sWidthPx,
                      fixedRightPx: sInitPx + sWidthPx,
                      initialStartSec: sInitSec,
                      initialDurSec: sDurSec,
                      initialEndSec: sInitSec + sDurSec,
                      initialOffsetSec: l.sourceOffsetSec || 0,
                      totalMediaDur: (l.type === 'video' || l.type === 'audio') ? getLayerMediaDuration(l) : null,
                      clipEl: sClipEl,
                      lane: sLane,
                      initialKeyframes: l.keyframes ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(l.keyframes) : (Array.isArray(l.keyframes) ? [] : JSON.parse(JSON.stringify(l.keyframes)))) : null
                    };
                  });
                } else {
                  multiTrimLayers = [{
                    layer: layer,
                    initialStartPx: initialStartPx,
                    initialWidthPx: initialWidthPx,
                    fixedRightPx: fixedRightPx,
                    initialStartSec: initialStartSec,
                    initialDurSec: initialDurSec,
                    initialEndSec: initialEndSec,
                    initialOffsetSec: initialOffsetSec,
                    totalMediaDur: totalMediaDur,
                    clipEl: clipEl,
                    lane: lane,
                    initialKeyframes: layer.keyframes ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.keyframes) : (Array.isArray(layer.keyframes) ? [] : JSON.parse(JSON.stringify(layer.keyframes)))) : null
                  }];
                }

                function onPointerMove(moveEvent) {
                  const activePps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
                  const deltaX = moveEvent.clientX - startPointerX;
                  let newStartPx = initialStartPx + deltaX;

                  // Snap trimming start to beatmarks, other layers depan/belakang, and playhead
                  const snapTargets = (typeof getTimelineSnapTargets === 'function') ? getTimelineSnapTargets(layer.id, true) : [];
                  const multiIds = new Set(multiTrimLayers.map(m => m.layer.id));
                  const filteredSnapTargets = snapTargets.filter(st => !multiIds.has(st.layerId));
                  const snap = (typeof findTimelineSnap === 'function') ? findTimelineSnap(newStartPx, filteredSnapTargets, 10) : null;
                  if (snap) {
                    newStartPx = snap.px;
                    if (typeof showTimelineSnapGuide === 'function') showTimelineSnapGuide(snap.px);
                    if (window._lastTrimSnapPx !== snap.px) {
                      window._lastTrimSnapPx = snap.px;
                      if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
                    }
                  } else {
                    if (typeof hideTimelineSnapGuide === 'function') hideTimelineSnapGuide();
                    window._lastTrimSnapPx = null;
                  }

                  const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60);
                  const minDurSec = 1 / safeFps;

                  // Calculate primary shift
                  const isTimeRemap = (layer.speedMode === 'time_remap');
                  const effSpeed = (layer.speed !== undefined && layer.speed !== 0) ? Math.abs(layer.speed) : 1.0;

                  if (!isTimeRemap && totalMediaDur !== null) {
                    const maxExtendLeftSec = initialOffsetSec / effSpeed;
                    const maxExtendLeftPx = Math.round(maxExtendLeftSec * activePps);
                    const minAllowedStartPx = Math.max(0, initialStartPx - maxExtendLeftPx);
                    newStartPx = Math.max(minAllowedStartPx, newStartPx);
                  } else {
                    newStartPx = Math.max(0, newStartPx);
                  }

                  let newWidthPx = fixedRightPx - newStartPx;
                  if (newWidthPx < minWidth) {
                    newWidthPx = minWidth;
                    newStartPx = fixedRightPx - minWidth;
                  }

                  const fixedRightSec = Math.round((fixedRightPx / activePps) * safeFps) / safeFps;
                  let minAllowedSec = 0;
                  if (!isTimeRemap && totalMediaDur !== null) {
                    minAllowedSec = Math.max(0, initialStartSec - (initialOffsetSec / effSpeed));
                  }
                  let targetStartSec = Math.max(minAllowedSec, Math.round((newStartPx / activePps) * safeFps) / safeFps);
                  if (targetStartSec > fixedRightSec - minDurSec) {
                    targetStartSec = fixedRightSec - minDurSec;
                  }
                  const primaryShiftSec = targetStartSec - initialStartSec;

                  // Apply to all layers in batch (or single)
                  multiTrimLayers.forEach(m => {
                    const mLayer = m.layer;
                    const mIsTimeRemap = (mLayer.speedMode === 'time_remap');
                    const mEffSpeed = (mLayer.speed !== undefined && mLayer.speed !== 0) ? Math.abs(mLayer.speed) : 1.0;
                    const mFixedRightSec = Math.round((m.fixedRightPx / activePps) * safeFps) / safeFps;

                    let mMinAllowedSec = 0;
                    if (!mIsTimeRemap && m.totalMediaDur !== null) {
                      mMinAllowedSec = Math.max(0, m.initialStartSec - (m.initialOffsetSec / mEffSpeed));
                    }
                    let mTargetStartSec = Math.max(mMinAllowedSec, Math.round((m.initialStartSec + primaryShiftSec) * safeFps) / safeFps);
                    if (mTargetStartSec > mFixedRightSec - minDurSec) {
                      mTargetStartSec = mFixedRightSec - minDurSec;
                    }

                    mLayer.startSec = Math.max(0, mTargetStartSec);
                    mLayer.durationSec = Math.max(minDurSec, Math.round((mFixedRightSec - mLayer.startSec) * safeFps) / safeFps);
                    mLayer.startPx = Math.round(mLayer.startSec * activePps);
                    mLayer.widthPx = Math.max(minWidth, Math.round((mLayer.startSec + mLayer.durationSec) * activePps) - mLayer.startPx);
                    mLayer.isDurationExplicit = true;
                    mLayer._userTrimmed = true;

                    if (m.totalMediaDur !== null) {
                      if (mLayer.speed !== undefined && mLayer.speed < 0) {
                        mLayer.sourceOffsetSec = m.initialOffsetSec;
                      } else {
                        const shiftedSec = mLayer.startSec - m.initialStartSec;
                        mLayer.sourceOffsetSec = Math.max(0, Math.min(m.totalMediaDur, m.initialOffsetSec + shiftedSec * mEffSpeed));
                      }
                    }

                    // Shift layer keyframes synchronously with startSec change
                    if (m.initialKeyframes && mLayer.keyframes) {
                      const shiftedStartSec = mLayer.startSec - m.initialStartSec;
                      for (const [p, kfs] of Object.entries(m.initialKeyframes)) {
                        if (!Array.isArray(kfs) || !Array.isArray(mLayer.keyframes[p])) continue;
                        kfs.forEach((initKf, idx) => {
                          const curKf = mLayer.keyframes[p][idx];
                          if (curKf) {
                            curKf.time = Math.max(0, Number((initKf.time + shiftedStartSec).toFixed(4)));
                          }
                        });
                      }
                    }

                    if (m.clipEl) {
                      m.clipEl.style.left = `${mLayer.startPx}px`;
                      m.clipEl.style.width = `${mLayer.widthPx}px`;
                      if (!isDesktop || !mLayer._kfExpanded) {
                        renderLayerKeyframes(mLayer, m.clipEl);
                      } else if (m.lane) {
                        const curStart = mLayer.startSec !== undefined ? mLayer.startSec : ((mLayer.startPx || 0) / activePps);
                        const curEnd = curStart + (mLayer.durationSec || 0);
                        m.lane.querySelectorAll('.desktop-kf-diamond').forEach(d => {
                          const t = Number(d.dataset.time);
                          d.classList.toggle('is-out-of-bounds', t < curStart - 0.001 || t > curEnd + 0.001);
                        });
                      }
                      if (mLayer.type === 'audio') renderAudioClipWaveform(mLayer, m.clipEl);
                    }
                  });

                  if (typeof renderTimelineLinkConnectors === 'function') renderTimelineLinkConnectors();
                  redrawComposition();
                  updateTimelinePosition(panX, true);
                }

                function onPointerUp(upEvent) {
                  if (typeof hideTimelineSnapGuide === 'function') hideTimelineSnapGuide();
                  window._lastTrimSnapPx = null;
                  try { leftHandle.releasePointerCapture(upEvent.pointerId); } catch (_) {}
                  window.removeEventListener('pointermove', onPointerMove);
                  window.removeEventListener('pointerup', onPointerUp);
                  window.removeEventListener('pointercancel', onPointerUp);
                  window.isTransformInteracting = false;

                  const fps = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
                  const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;

                  multiTrimLayers.forEach(m => {
                    const mLayer = m.layer;
                    mLayer.startSec = Math.round(mLayer.startSec * fps) / fps;
                    mLayer.durationSec = Math.max(1 / fps, Math.round(mLayer.durationSec * fps) / fps);
                    mLayer.startPx = Math.round(mLayer.startSec * pps);
                    mLayer.widthPx = Math.max(minWidth, Math.round((mLayer.startSec + mLayer.durationSec) * pps) - mLayer.startPx);
                    if (m.clipEl) {
                      m.clipEl.style.left = `${mLayer.startPx}px`;
                      m.clipEl.style.width = `${mLayer.widthPx}px`;
                      if (typeof syncLayerKeyframeMarkersInPlace === 'function') {
                        syncLayerKeyframeMarkersInPlace(mLayer);
                      } else {
                        renderLayerKeyframes(mLayer, m.clipEl);
                      }
                      if (mLayer.type === 'audio') renderAudioClipWaveform(mLayer, m.clipEl);
                    }
                    invalidatePreviewCacheForLayer(mLayer, m.initialStartSec, m.initialEndSec);
                    if ((mLayer.type === 'video' || mLayer.type === 'precomp') && window.VideoFrameExtractor) {
                      window.VideoFrameExtractor.extractLayerRange(mLayer);
                    }
                  });

                  if (typeof updateCutBarRowState === 'function') updateCutBarRowState();
                  redrawComposition();
                  saveCurrentProjectLayers();
                  updateTimelineDuration(true);
                }

                window.addEventListener('pointermove', onPointerMove, { passive: true });
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
              });
            }

            if (rightHandle) {
              rightHandle.addEventListener('pointerdown', (e) => {
                const isCurrentlySelected = clipEl.classList.contains('is-selected') ||
                  (window.selectedLayerIds && window.selectedLayerIds.has(layer.id)) ||
                  (window.selectedLayerId === layer.id);
                if (!isCurrentlySelected) return;
                if (e.button !== undefined && e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                try { rightHandle.setPointerCapture(e.pointerId); } catch (_) {}

                const curPps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
                const startPointerX = e.clientX;
                const initialWidthPx = layer.widthPx || 320;
                const currentOffsetSec = layer.sourceOffsetSec || 0;
                const totalMediaDur = (layer.type === 'video' || layer.type === 'audio') ? getLayerMediaDuration(layer) : null;
                const isTimeRemap = (layer.speedMode === 'time_remap');
                const effSpeed = (layer.speed !== undefined && layer.speed !== 0) ? Math.abs(layer.speed) : 1.0;

                const initialStartSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / curPps);
                const initialDurSec = layer.durationSec !== undefined ? layer.durationSec : (initialWidthPx / curPps);
                const initialEndSec = initialStartSec + initialDurSec;
                window.isTransformInteracting = true;

                // Support batch duration trimming for multi-selected layers
                const isMultiSelectState = (typeof isSelectorMode !== 'undefined' && isSelectorMode) || (window.selectedLayerIds && window.selectedLayerIds.size > 1);
                const isMultiTrimming = isMultiSelectState && (window.selectedLayerIds ? window.selectedLayerIds.has(layer.id) : false);
                let multiTrimLayers = [];
                if (isMultiTrimming) {
                  const currentLayers = currentProjectState?.layers || [];
                  multiTrimLayers = currentLayers.filter(l => (typeof isLayerSelected === 'function' ? isLayerSelected(l.id) : window.selectedLayerIds?.has(l.id))).map(l => {
                    const sInitPx = l.startPx || 0;
                    const sWidthPx = l.widthPx || 320;
                    const sInitSec = l.startSec !== undefined ? l.startSec : (sInitPx / curPps);
                    const sDurSec = l.durationSec !== undefined ? l.durationSec : (sWidthPx / curPps);
                    const sClipEl = document.querySelector(`.timeline-clip-block[data-layer-id="${l.id}"]`);
                    const sLane = sClipEl?.closest('.timeline-lane-track');
                    return {
                      layer: l,
                      initialStartPx: sInitPx,
                      initialWidthPx: sWidthPx,
                      initialStartSec: sInitSec,
                      initialDurSec: sDurSec,
                      initialEndSec: sInitSec + sDurSec,
                      initialOffsetSec: l.sourceOffsetSec || 0,
                      totalMediaDur: (l.type === 'video' || l.type === 'audio') ? getLayerMediaDuration(l) : null,
                      clipEl: sClipEl,
                      lane: sLane
                    };
                  });
                } else {
                  multiTrimLayers = [{
                    layer: layer,
                    initialStartPx: layer.startPx || 0,
                    initialWidthPx: initialWidthPx,
                    initialStartSec: initialStartSec,
                    initialDurSec: initialDurSec,
                    initialEndSec: initialEndSec,
                    initialOffsetSec: currentOffsetSec,
                    totalMediaDur: totalMediaDur,
                    clipEl: clipEl,
                    lane: lane
                  }];
                }

                function onPointerMove(moveEvent) {
                  const activePps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
                  const deltaX = moveEvent.clientX - startPointerX;
                  let rawEndPx = (layer.startPx || 0) + initialWidthPx + deltaX;

                  // Snap trimming end to beatmarks, other layers depan/belakang, and playhead
                  const snapTargets = (typeof getTimelineSnapTargets === 'function') ? getTimelineSnapTargets(layer.id, true) : [];
                  const multiIds = new Set(multiTrimLayers.map(m => m.layer.id));
                  const filteredSnapTargets = snapTargets.filter(st => !multiIds.has(st.layerId));
                  const snap = (typeof findTimelineSnap === 'function') ? findTimelineSnap(rawEndPx, filteredSnapTargets, 10) : null;
                  if (snap) {
                    rawEndPx = snap.px;
                    if (typeof showTimelineSnapGuide === 'function') showTimelineSnapGuide(snap.px);
                    if (window._lastTrimSnapPx !== snap.px) {
                      window._lastTrimSnapPx = snap.px;
                      if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
                    }
                  } else {
                    if (typeof hideTimelineSnapGuide === 'function') hideTimelineSnapGuide();
                    window._lastTrimSnapPx = null;
                  }

                  const safeFps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60);
                  const minDurSec = 1 / safeFps;
                  const curStartSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / activePps);
                  let targetEndSec = Math.round((rawEndPx / activePps) * safeFps) / safeFps;
                  if (targetEndSec < curStartSec + minDurSec) {
                    targetEndSec = curStartSec + minDurSec;
                  }
                  if (!isTimeRemap && totalMediaDur !== null) {
                    const maxAvailableDurSec = Math.max(minDurSec, (totalMediaDur - currentOffsetSec) / effSpeed);
                    const maxAllowedEndSec = curStartSec + maxAvailableDurSec;
                    targetEndSec = Math.min(maxAllowedEndSec, targetEndSec);
                  }
                  const primaryNewDurSec = Math.max(minDurSec, Math.round((targetEndSec - curStartSec) * safeFps) / safeFps);
                  const deltaDurSec = primaryNewDurSec - initialDurSec;

                  // Apply to all trimmed layers
                  multiTrimLayers.forEach(m => {
                    const mLayer = m.layer;
                    const mIsTimeRemap = (mLayer.speedMode === 'time_remap');
                    const mEffSpeed = (mLayer.speed !== undefined && mLayer.speed !== 0) ? Math.abs(mLayer.speed) : 1.0;
                    const mCurStartSec = mLayer.startSec !== undefined ? mLayer.startSec : ((mLayer.startPx || 0) / activePps);
                    let mTargetDurSec = Math.max(minDurSec, Math.round((m.initialDurSec + deltaDurSec) * safeFps) / safeFps);

                    if (!mIsTimeRemap && m.totalMediaDur !== null) {
                      const mMaxAvailableDurSec = Math.max(minDurSec, (m.totalMediaDur - m.initialOffsetSec) / mEffSpeed);
                      mTargetDurSec = Math.min(mMaxAvailableDurSec, mTargetDurSec);
                    }

                    const mOldDurSec = mLayer.durationSec || m.initialDurSec;
                    mLayer.durationSec = Math.max(minDurSec, mTargetDurSec);
                    mLayer.widthPx = Math.max(minWidth, Math.round((mCurStartSec + mLayer.durationSec) * activePps) - (mLayer.startPx || 0));

                    if (mLayer.speed !== undefined && mLayer.speed < 0 && m.totalMediaDur !== null) {
                      const dDur = mOldDurSec - mLayer.durationSec;
                      mLayer.sourceOffsetSec = Math.max(0, Math.min(m.totalMediaDur, m.initialOffsetSec + dDur * mEffSpeed));
                    }
                    mLayer.isDurationExplicit = true;
                    mLayer._userTrimmed = true;

                    if (m.clipEl) {
                      m.clipEl.style.width = `${mLayer.widthPx}px`;
                      if (!isDesktop || !mLayer._kfExpanded) {
                        renderLayerKeyframes(mLayer, m.clipEl);
                      } else if (m.lane) {
                        const curEnd = mCurStartSec + (mLayer.durationSec || 0);
                        m.lane.querySelectorAll('.desktop-kf-diamond').forEach(d => {
                          const t = Number(d.dataset.time);
                          d.classList.toggle('is-out-of-bounds', t < mCurStartSec - 0.001 || t > curEnd + 0.001);
                        });
                      }
                      if (mLayer.type === 'audio') renderAudioClipWaveform(mLayer, m.clipEl);
                    }
                  });

                  const curTrimEndSec = (layer.startSec !== undefined ? layer.startSec : (layer.startPx / activePps)) + (layer.durationSec || 0);
                  const rulerDuration = (typeof lastGeneratedDuration !== 'undefined') ? lastGeneratedDuration : (typeof window !== 'undefined' && typeof window.lastGeneratedDuration === 'number' ? window.lastGeneratedDuration : 0);
                  if (curTrimEndSec > rulerDuration) {
                    if (typeof generateRulerTicks === 'function') {
                      generateRulerTicks(safeFps);
                    } else if (typeof window !== 'undefined' && typeof window.generateRulerTicks === 'function') {
                      window.generateRulerTicks(safeFps);
                    }
                  }
                  if (typeof renderTimelineLinkConnectors === 'function') renderTimelineLinkConnectors();
                  redrawComposition();
                  updateTimelinePosition(panX, true);
                }

                function onPointerUp(upEvent) {
                  if (typeof hideTimelineSnapGuide === 'function') hideTimelineSnapGuide();
                  window._lastTrimSnapPx = null;
                  try { rightHandle.releasePointerCapture(upEvent.pointerId); } catch (_) {}
                  window.removeEventListener('pointermove', onPointerMove);
                  window.removeEventListener('pointerup', onPointerUp);
                  window.removeEventListener('pointercancel', onPointerUp);
                  window.isTransformInteracting = false;

                  const fps = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
                  const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;

                  multiTrimLayers.forEach(m => {
                    const mLayer = m.layer;
                    const curStartSec = mLayer.startSec !== undefined ? mLayer.startSec : ((mLayer.startPx || 0) / pps);
                    mLayer.durationSec = Math.max(1 / fps, Math.round(mLayer.durationSec * fps) / fps);
                    mLayer.widthPx = Math.max(minWidth, Math.round((curStartSec + mLayer.durationSec) * pps) - (mLayer.startPx || 0));
                    if (m.clipEl) {
                      m.clipEl.style.width = `${mLayer.widthPx}px`;
                      if (typeof syncLayerKeyframeMarkersInPlace === 'function') {
                        syncLayerKeyframeMarkersInPlace(mLayer);
                      } else {
                        renderLayerKeyframes(mLayer, m.clipEl);
                      }
                      if (mLayer.type === 'audio') renderAudioClipWaveform(mLayer, m.clipEl);
                    }
                    invalidatePreviewCacheForLayer(mLayer, m.initialStartSec, m.initialEndSec);
                    if ((mLayer.type === 'video' || mLayer.type === 'precomp') && window.VideoFrameExtractor) {
                      window.VideoFrameExtractor.extractLayerRange(mLayer);
                    }
                  });

                  if (typeof updateCutBarRowState === 'function') updateCutBarRowState();
                  redrawComposition();
                  saveCurrentProjectLayers();
                  updateTimelineDuration(true);
                }

                window.addEventListener('pointermove', onPointerMove, { passive: true });
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
              });
            }
          }

          if (isDesktop && layer._kfExpanded && layer.type !== 'precomp') {
            lane.classList.add('is-kf-expanded');
            const tracksEl = buildDesktopKfTracksWrapper(layer, pps, layer._kfExpandedOnlyKeyframed);
            lane.appendChild(tracksEl);
          }

          layersTrack.appendChild(lane);

          // Render child elements when Precompose is expanded
          if (layer.type === 'precomp' && layer._precompExpanded && Array.isArray(layer.layers)) {
            const parentStartSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);

            layer.layers.forEach((child) => {
              child._parentPrecomp = layer;
              child._parentPrecompId = layer.id;

              const childClipType = child.type === 'shape' ? 'shape' : (child.type === 'text' ? 'text' : (child.type === 'video' ? 'video' : (child.type === 'audio' ? 'audio' : (child.type === 'adjustment' ? 'adjustment' : (child.type === 'camera' ? 'camera' : (child.type === 'null' ? 'null' : (child.type === 'precomp' ? 'precomp' : (child.type === 'color' ? 'color' : 'image'))))))));
              const childTypeTag = child.type === 'shape' ? 'SHP' : (child.type === 'text' ? 'TXT' : (child.type === 'video' ? 'VID' : (child.type === 'audio' ? 'AUD' : (child.type === 'adjustment' ? 'ADJ' : (child.type === 'camera' ? (child.isOverlapCamera ? 'O-CAM' : 'CAM') : (child.type === 'null' ? (child.isOverlapNull ? 'O-NULL' : 'NULL') : (child.type === 'precomp' ? (child.groupType === 'mask' ? 'MASK' : (child.groupType === 'exclude' ? 'EXCL' : 'COMP')) : (child.type === 'color' ? 'CLR' : 'IMG'))))))));
              const isChildSelected = selectedLayerIds.has(child.id) || child.id === selectedLayerId;
              const isChildHidden = !!child.hidden;

              const childStartSec = child.startSec !== undefined ? child.startSec : ((child.startPx || 0) / pps);
              const childDurSec = child.durationSec !== undefined ? child.durationSec : ((child.widthPx || 320) / pps);
              const childGlobalStartSec = parentStartSec + childStartSec;
              const childGlobalStartPx = Math.round(childGlobalStartSec * pps);
              const childWidthPx = Math.max(16, Math.round(childDurSec * pps));

              // 1. Child Pill Slot in overlayContainer
              if (overlayContainer) {
                if (isDesktop) {
                  const isChildFocused = !isSelectorMode && isChildSelected && (child.id === selectedLayerId);
                  const childPillSlot = document.createElement('div');
                  childPillSlot.className = `timeline-lane-pill-slot is-precomp-child ${isChildFocused ? 'is-focused' : ''}`;
                  childPillSlot.dataset.layerId = child.id;
                  childPillSlot.dataset.parentPrecompId = layer.id;
                  childPillSlot.innerHTML = `
                    <div class="timeline-layer-ctrl-pill is-precomp-child ${isChildSelected ? 'is-selected' : ''} ${isChildHidden ? 'is-hidden' : ''}" 
                         title="${child.name} [${layer.name}] - ${isChildHidden ? 'Klik untuk tampilkan' : 'Klik untuk sembunyikan'}"
                         data-layer-id="${child.id}">
                      <span class="desktop-child-twistie-spacer" aria-hidden="true"></span>
                      <button type="button" class="timeline-layer-eye-btn" aria-label="${isChildHidden ? 'Show Layer' : 'Hide Layer'}" title="${isChildHidden ? 'Show Layer' : 'Hide Layer'}">
                        <span class="fticon ${isChildHidden ? 'fticon fticon-eye-off' : 'fticon fticon-eye'}" aria-hidden="true"></span>
                      </button>
                      <span class="desktop-layer-name-text" title="${child.name}">${child.name}</span>
                    </div>
                  `;

                  // Child eye button click
                  const childEyeBtn = childPillSlot.querySelector('.timeline-layer-eye-btn');
                  if (childEyeBtn) {
                    childEyeBtn.addEventListener('click', (e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      child.hidden = !child.hidden;
                      layer._dirty = true;
                      if (layer._precompBufferCanvas) layer._precompBufferCanvas._lastRenderKey = null;
                      invalidatePreviewCacheForLayer(child);
                      renderTimelineLayers();
                      redrawComposition();
                      saveCurrentProjectLayers();
                    });
                  }

                  // Child pill click
                  const childPillEl = childPillSlot.querySelector('.timeline-layer-ctrl-pill');
                  if (childPillEl) {
                    childPillEl.addEventListener('click', (e) => {
                      if (e.target.closest('.timeline-layer-eye-btn')) return;
                      e.stopPropagation();
                      if (isSelectorMode) {
                        toggleSelectTimelineLayer(child.id, true);
                      } else {
                        toggleSelectTimelineLayer(child.id, false);
                      }
                    });
                    childPillEl.addEventListener('contextmenu', (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      triggerClipContextMenu(child, e.clientX, e.clientY, e);
                    });
                  }

                  overlayContainer.appendChild(childPillSlot);
                } else {
                  // In editor.html (mobile), do NOT render floating left pill to avoid cluttering the screen.
                  // Render an invisible spacer slot to keep 1:1 row sync with track lanes below.
                  const childSpacer = document.createElement('div');
                  childSpacer.className = 'timeline-lane-pill-slot is-precomp-child is-mobile-spacer';
                  childSpacer.dataset.layerId = child.id;
                  childSpacer.dataset.parentPrecompId = layer.id;
                  childSpacer.style.height = '32px';
                  childSpacer.style.pointerEvents = 'none';
                  overlayContainer.appendChild(childSpacer);
                }
              }

              // 2. Child Track Lane in layersTrack
              const isChildReverse = (child.speed !== undefined && child.speed < 0);
              const childLane = document.createElement('div');
              childLane.className = 'timeline-track-lane is-precomp-child';
              childLane.dataset.layerId = child.id;
              childLane.dataset.parentPrecompId = layer.id;
              childLane.innerHTML = `
                <div class="track-content-lane">
                  <div class="timeline-clip-block clip-${childClipType} is-precomp-child ${isChildSelected ? 'is-selected' : ''} ${isChildHidden ? 'is-hidden' : ''} ${isChildReverse ? 'is-reverse' : ''}" 
                       style="left: ${childGlobalStartPx}px; width: ${childWidthPx}px;" 
                       title="${child.name}${isChildReverse ? ' (Reverse ' + child.speed + 'x)' : ''}${isChildHidden ? ' (Hidden)' : ''} [${layer.name}]" 
                       data-layer-id="${child.id}">
                    <button type="button" class="timeline-clip-handle handle-left" aria-label="Trim / Lengthen Start" title="Drag to trim start">
                      <span class="fticon fticon-chevron-left" style="width: 10px; height: 10px;" aria-hidden="true"></span>
                    </button>
                    <span class="timeline-clip-tag">${childTypeTag}${isChildReverse ? ' ◀' : ''}</span>
                    <span class="clip-label">${child.name}</span>
                    <button type="button" class="timeline-clip-handle handle-right" aria-label="Trim / Lengthen End" title="Drag to trim end">
                      <span class="fticon fticon-chevron-right" style="width: 10px; height: 10px;" aria-hidden="true"></span>
                    </button>
                    ${(childClipType === 'video' || childClipType === 'precomp') ? '<div class="timeline-clip-progress-track"><div class="timeline-clip-progress"></div></div>' : ''}
                    ${(childClipType === 'audio') ? '<canvas class="timeline-audio-waveform-canvas"></canvas>' : ''}
                    <div class="timeline-clip-keyframes"></div>
                  </div>
                </div>
              `;

              const childClipEl = childLane.querySelector('.timeline-clip-block');
              if (childClipEl) {
                renderLayerKeyframes(child, childClipEl);
                if (childClipType === 'audio') {
                  renderAudioClipWaveform(child, childClipEl);
                }
                if ((childClipType === 'video' || childClipType === 'precomp') && !child.hidden && window.VideoFrameExtractor) {
                  window.VideoFrameExtractor.extractLayerRange(child);
                }

                childClipEl.addEventListener('click', (e) => {
                  if (e.target.closest('.timeline-clip-handle')) return;
                  e.stopPropagation();
                  if (isSelectorMode) {
                    toggleSelectTimelineLayer(child.id, true);
                  } else {
                    toggleSelectTimelineLayer(child.id, false);
                  }
                });

                childClipEl.addEventListener('contextmenu', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  triggerClipContextMenu(child, e.clientX, e.clientY, e);
                });

                // Left handle trimming
                const childLeftHandle = childClipEl.querySelector('.handle-left');
                if (childLeftHandle) {
                  childLeftHandle.addEventListener('pointerdown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (e.button !== undefined && e.button !== 0) return;
                    try { childLeftHandle.setPointerCapture(e.pointerId); } catch (_) {}
                    const startX = e.clientX;
                    const origChildStartSec = child.startSec !== undefined ? child.startSec : 0;
                    const origChildDurSec = child.durationSec !== undefined ? child.durationSec : 1;

                    function onChildTrimMove(me) {
                      me.stopPropagation();
                      me.preventDefault();
                      const deltaSec = (me.clientX - startX) / pps;
                      const newStartSec = Math.max(0, origChildStartSec + deltaSec);
                      const newDurSec = Math.max(0.1, origChildDurSec - (newStartSec - origChildStartSec));
                      child.startSec = Number(newStartSec.toFixed(3));
                      child.startPx = Math.round(child.startSec * pps);
                      child.durationSec = Number(newDurSec.toFixed(3));
                      child.widthPx = Math.round(child.durationSec * pps);

                      const newGlobalStartPx = Math.round((parentStartSec + child.startSec) * pps);
                      childClipEl.style.left = `${newGlobalStartPx}px`;
                      childClipEl.style.width = `${child.widthPx}px`;
                      renderLayerKeyframes(child, childClipEl);

                      layer._dirty = true;
                      if (layer._precompBufferCanvas) layer._precompBufferCanvas._lastRenderKey = null;
                      invalidatePreviewCacheForLayer(child);
                      redrawComposition();
                    }

                    function onChildTrimUp(ue) {
                      try { childLeftHandle.releasePointerCapture(ue.pointerId); } catch (_) {}
                      window.removeEventListener('pointermove', onChildTrimMove);
                      window.removeEventListener('pointerup', onChildTrimUp);
                      saveCurrentProjectLayers();
                      renderTimelineLayers();
                    }

                    window.addEventListener('pointermove', onChildTrimMove);
                    window.addEventListener('pointerup', onChildTrimUp);
                  });
                }

                // Right handle trimming
                const childRightHandle = childClipEl.querySelector('.handle-right');
                if (childRightHandle) {
                  childRightHandle.addEventListener('pointerdown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (e.button !== undefined && e.button !== 0) return;
                    try { childRightHandle.setPointerCapture(e.pointerId); } catch (_) {}
                    const startX = e.clientX;
                    const origChildDurSec = child.durationSec !== undefined ? child.durationSec : 1;

                    function onChildRightMove(me) {
                      me.stopPropagation();
                      me.preventDefault();
                      const deltaSec = (me.clientX - startX) / pps;
                      const newDurSec = Math.max(0.1, origChildDurSec + deltaSec);
                      child.durationSec = Number(newDurSec.toFixed(3));
                      child.widthPx = Math.round(child.durationSec * pps);
                      childClipEl.style.width = `${child.widthPx}px`;
                      renderLayerKeyframes(child, childClipEl);

                      layer._dirty = true;
                      if (layer._precompBufferCanvas) layer._precompBufferCanvas._lastRenderKey = null;
                      invalidatePreviewCacheForLayer(child);
                      redrawComposition();
                    }

                    function onChildRightUp(ue) {
                      try { childRightHandle.releasePointerCapture(ue.pointerId); } catch (_) {}
                      window.removeEventListener('pointermove', onChildRightMove);
                      window.removeEventListener('pointerup', onChildRightUp);
                      saveCurrentProjectLayers();
                      renderTimelineLayers();
                    }

                    window.addEventListener('pointermove', onChildRightMove);
                    window.addEventListener('pointerup', onChildRightUp);
                  });
                }

                // Horizontal slide
                let childSlideStartX = 0;
                let childIsSliding = false;
                let childOrigStartSec = 0;

                childClipEl.addEventListener('pointerdown', (e) => {
                  if (e.target.closest('.timeline-clip-handle')) return;
                  if (e.button !== undefined && e.button !== 0) return;
                  childSlideStartX = e.clientX;
                  childIsSliding = false;
                  childOrigStartSec = child.startSec !== undefined ? child.startSec : 0;

                  function onChildSlideMove(me) {
                    const dx = me.clientX - childSlideStartX;
                    if (!childIsSliding && Math.abs(dx) > 4) {
                      childIsSliding = true;
                      try { childClipEl.setPointerCapture(e.pointerId); } catch (_) {}
                    }
                    if (childIsSliding) {
                      me.preventDefault();
                      const deltaSec = dx / pps;
                      const newStartSec = Math.max(0, childOrigStartSec + deltaSec);
                      child.startSec = Number(newStartSec.toFixed(3));
                      child.startPx = Math.round(child.startSec * pps);

                      const newGlobalStartPx = Math.round((parentStartSec + child.startSec) * pps);
                      childClipEl.style.left = `${newGlobalStartPx}px`;

                      layer._dirty = true;
                      if (layer._precompBufferCanvas) layer._precompBufferCanvas._lastRenderKey = null;
                      invalidatePreviewCacheForLayer(child);
                      redrawComposition();
                    }
                  }

                  function onChildSlideUp(ue) {
                    try { childClipEl.releasePointerCapture(ue.pointerId); } catch (_) {}
                    window.removeEventListener('pointermove', onChildSlideMove);
                    window.removeEventListener('pointerup', onChildSlideUp);
                    if (childIsSliding) {
                      childIsSliding = false;
                      saveCurrentProjectLayers();
                      renderTimelineLayers();
                    }
                  }

                  window.addEventListener('pointermove', onChildSlideMove);
                  window.addEventListener('pointerup', onChildSlideUp);
                });
              }

              layersTrack.appendChild(childLane);
            });

            // On Desktop, append Precomp's Transform below its child layers ("di atas transform")
            if (isDesktop && layer._kfExpanded) {
              if (overlayContainer) {
                const precompKfSlot = document.createElement('div');
                precompKfSlot.className = 'timeline-lane-pill-slot is-kf-expanded is-precomp-transform-slot';
                precompKfSlot.dataset.layerId = layer.id;
                const treeEl = buildDesktopKfPropertyTree(layer, layer._kfExpandedOnlyKeyframed);
                precompKfSlot.appendChild(treeEl);
                overlayContainer.appendChild(precompKfSlot);
              }

              const precompKfLane = document.createElement('div');
              precompKfLane.className = 'timeline-track-lane is-kf-expanded is-precomp-transform-lane';
              precompKfLane.dataset.layerId = layer.id;
              const tracksEl = buildDesktopKfTracksWrapper(layer, pps, layer._kfExpandedOnlyKeyframed);
              precompKfLane.appendChild(tracksEl);
              layersTrack.appendChild(precompKfLane);
            }
          }
        });

        // 3. Floating Right Reorder Pills (Semua layer punya handle hamburger, drag untuk geser posisi layer)
        const reorderOverlay = document.getElementById('timeline-lane-reorder-overlay');
        if (reorderOverlay) {
          reorderOverlay.innerHTML = '';
          reorderOverlay.classList.toggle('is-selector-mode', isSelectorMode);

          // Render handle untuk setiap layer (bahkan saat multi-select agar bisa batch reorder)
          if (layers.length > 0) {
            const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
            const vpWidth = layersViewport ? layersViewport.clientWidth : 800;
            const curPan = (window.timelinePanX !== undefined ? window.timelinePanX : (typeof panX !== 'undefined' ? panX : 0));
            const handleTimelinePx = (vpWidth / 2 - 20) - curPan;

            layers.forEach((layer, layerIdx) => {
              const isSelected = selectedLayerIds.has(layer.id) || layer.id === selectedLayerId;
              const slot = document.createElement('div');
              slot.className = 'timeline-lane-reorder-slot';
              slot.dataset.layerId = layer.id;
              slot.dataset.layerIndex = layerIdx;

              const startPx = layer.startSec !== undefined ? Math.round(layer.startSec * pps) : (layer.startPx || 0);
              const widthPx = layer.durationSec !== undefined ? Math.round(layer.durationSec * pps) : (layer.widthPx || 320);
              const endPx = startPx + widthPx;
              const isOverClip = !layer.hidden && (handleTimelinePx >= startPx && handleTimelinePx <= endPx);

              const pill = document.createElement('div');
              pill.className = `timeline-layer-reorder-pill ${isSelected ? 'is-selected' : ''} ${isOverClip ? 'is-over-clip' : ''}`;
              pill.dataset.layerId = layer.id;
              pill.title = `Move Layer: ${layer.name}`;
              pill.innerHTML = `
                <div class="reorder-grip" title="Drag to Move Layer Up / Down" aria-label="Drag to Reorder Layer">
                  <i class='fticon fticon-drag-to-reorder-layer reorder-grip-svg' style='width:18px;height:18px;font-size:18px;line-height:1;' aria-hidden='true'></i>
                </div>
              `;

              // Pointer drag up and down to freely swap layers with full visual lane follow
              let isDragging = false;
              pill.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                try { pill.setPointerCapture(e.pointerId); } catch (_) {}
                isDragging = true;

                const curLayers = (currentProjectState.layers || []);
                const isMulti = selectedLayerIds && selectedLayerIds.has(layer.id) && selectedLayerIds.size > 1;
                const movingIdSet = isMulti ? new Set(selectedLayerIds) : new Set([layer.id]);
                const movingLayers = curLayers.filter(l => movingIdSet.has(l.id));
                const movingIndices = movingLayers.map(l => curLayers.findIndex(x => x.id === l.id)).sort((a,b) => a - b);
                const movingCount = movingLayers.length;

                // Collect moving elements
                const movingPills = [];
                const movingLanes = [];
                const movingLeftSlots = [];
                movingIdSet.forEach(id => {
                  const p = reorderOverlay.querySelector(`.timeline-layer-reorder-pill[data-layer-id="${id}"]`);
                  const l = layersTrack.querySelector(`.timeline-track-lane[data-layer-id="${id}"]`);
                  const s = overlayContainer ? overlayContainer.querySelector(`.timeline-lane-pill-slot[data-layer-id="${id}"]`) : null;
                  if (p) { p.classList.add('is-dragging'); movingPills.push(p); }
                  if (l) { l.classList.add('is-dragging'); movingLanes.push(l); }
                  if (s) { s.classList.add('is-dragging'); movingLeftSlots.push(s); }
                });

                const allLanes = Array.from(layersTrack.querySelectorAll('.timeline-track-lane'));
                const allLeftSlots = overlayContainer ? Array.from(overlayContainer.querySelectorAll('.timeline-lane-pill-slot')) : [];
                const allRightSlots = Array.from(reorderOverlay.querySelectorAll('.timeline-lane-reorder-slot'));

                const startY = e.clientY;
                const originalIndex = layerIdx;
                let currentDropIdx = originalIndex;

                let lastPointerClientY = e.clientY;
                const startScrollTop = layersViewport ? layersViewport.scrollTop : 0;
                let autoScrollRaf = null;

                // Auto-scroll function when pointer is near top or bottom boundary of layersViewport
                function processAutoScroll() {
                  if (!isDragging || !layersViewport) return;
                  const vpRect = layersViewport.getBoundingClientRect();
                  const edgeZone = 40; // Gentle edge trigger zone
                  let scrollSpeed = 0;

                  const maxScroll = Math.max(0, layersViewport.scrollHeight - layersViewport.clientHeight);

                  if (lastPointerClientY < vpRect.top + edgeZone) {
                    const intensity = Math.max(0, Math.min(1, 1 - (lastPointerClientY - vpRect.top) / edgeZone));
                    scrollSpeed = -Math.max(1, Math.round(intensity * 6));
                  } else if (lastPointerClientY > vpRect.bottom - edgeZone) {
                    if (layersViewport.scrollTop < maxScroll) {
                      const intensity = Math.max(0, Math.min(1, 1 - (vpRect.bottom - lastPointerClientY) / edgeZone));
                      scrollSpeed = Math.max(1, Math.round(intensity * 6));
                    }
                  }

                  if (scrollSpeed !== 0) {
                    const prevScroll = layersViewport.scrollTop;
                    let nextScroll = prevScroll + scrollSpeed;
                    nextScroll = Math.max(0, Math.min(maxScroll, nextScroll));
                    if (nextScroll !== prevScroll) {
                      layersViewport.scrollTop = nextScroll;
                      updatePositions();
                    }
                  }

                  autoScrollRaf = requestAnimationFrame(processAutoScroll);
                }

                function updatePositions() {
                  const scrollDelta = layersViewport ? (layersViewport.scrollTop - startScrollTop) : 0;
                  let rawDeltaY = (lastPointerClientY - startY) + scrollDelta;

                  const isCompactVp = !window.isDesktop && !document.querySelector('.desktop-viewport');
                  const rowPitch = (allLanes.length >= 2)
                    ? Math.max(24, Math.round(allLanes[1].offsetTop - allLanes[0].offsetTop))
                    : (isCompactVp ? 40 : 54);

                  // Constrain deltaY strictly within existing layer boundaries:
                  const minMovingIdx = movingIndices.length > 0 ? movingIndices[0] : originalIndex;
                  const maxMovingIdx = movingIndices.length > 0 ? movingIndices[movingIndices.length - 1] : originalIndex;
                  const minDeltaY = -minMovingIdx * rowPitch;
                  const maxDeltaY = (layers.length - 1 - maxMovingIdx) * rowPitch;
                  const clampedDeltaY = Math.max(minDeltaY - 10, Math.min(maxDeltaY + 10, rawDeltaY));

                  // 1. Visually translate all moving pills, track lanes, and left pill slots simultaneously
                  movingPills.forEach(p => p.style.transform = `translateY(${clampedDeltaY}px)`);
                  movingLanes.forEach(l => l.style.transform = `translateY(${clampedDeltaY}px)`);
                  movingLeftSlots.forEach(s => s.style.transform = `translateY(${clampedDeltaY}px)`);

                  // 2. Calculate targeted drop position:
                  const vpRect = layersViewport ? layersViewport.getBoundingClientRect() : { top: 0 };
                  const vpY = lastPointerClientY - vpRect.top + (layersViewport ? layersViewport.scrollTop : 0);
                  const dropIdx = Math.max(0, Math.min(layers.length, Math.round(vpY / rowPitch)));
                  currentDropIdx = dropIdx;

                  // 3. Animate other lanes sliding up or down to make room
                  const remainingLayers = curLayers.filter(l => !movingIdSet.has(l.id));
                  let insertIdx = remainingLayers.length;
                  for (let j = dropIdx; j < curLayers.length; j++) {
                    if (!movingIdSet.has(curLayers[j].id)) {
                      const rIdx = remainingLayers.indexOf(curLayers[j]);
                      if (rIdx !== -1) {
                        insertIdx = rIdx;
                        break;
                      }
                    }
                  }

                  allLanes.forEach((otherLane, idx) => {
                    const lObj = curLayers[idx];
                    if (!lObj || movingIdSet.has(lObj.id)) return;
                    const movingAbove = movingIndices.filter(mIdx => mIdx < idx).length;
                    const remIdx = idx - movingAbove;
                    const shiftRows = (remIdx < insertIdx) ? -movingAbove : (movingCount - movingAbove);
                    const shift = shiftRows * rowPitch;

                    otherLane.style.transform = shift ? `translateY(${shift}px)` : '';
                    if (allLeftSlots[idx]) allLeftSlots[idx].style.transform = shift ? `translateY(${shift}px)` : '';
                    if (allRightSlots[idx]) allRightSlots[idx].style.transform = shift ? `translateY(${shift}px)` : '';
                  });
                }

                let reorderRaf = null;
                function onPointerMove(moveEvent) {
                  if (!isDragging) return;
                  lastPointerClientY = moveEvent.clientY;
                  if (!reorderRaf) {
                    reorderRaf = requestAnimationFrame(() => {
                      reorderRaf = null;
                      updatePositions();
                    });
                  }
                }

                // Start auto-scroll ticker
                autoScrollRaf = requestAnimationFrame(processAutoScroll);

                function onPointerUp(upEvent) {
                  if (!isDragging) return;
                  isDragging = false;
                  if (reorderRaf) {
                    cancelAnimationFrame(reorderRaf);
                    reorderRaf = null;
                  }
                  if (autoScrollRaf) {
                    cancelAnimationFrame(autoScrollRaf);
                    autoScrollRaf = null;
                  }
                  try { pill.releasePointerCapture(upEvent.pointerId); } catch (_) {}

                  movingPills.forEach(p => {
                    p.classList.remove('is-dragging');
                    p.style.transform = '';
                  });
                  movingLanes.forEach(l => {
                    l.classList.remove('is-dragging');
                    l.style.transform = '';
                  });
                  movingLeftSlots.forEach(s => {
                    s.classList.remove('is-dragging');
                    s.style.transform = '';
                  });

                  // Clear shifts on all lanes
                  allLanes.forEach(l => l.style.transform = '');
                  allLeftSlots.forEach(s => s.style.transform = '');
                  allRightSlots.forEach(s => s.style.transform = '');

                  window.removeEventListener('pointermove', onPointerMove);
                  window.removeEventListener('pointerup', onPointerUp);
                  window.removeEventListener('pointercancel', onPointerUp);

                  // Commit batch reorder if order changed
                  if (currentProjectState.layers && currentDropIdx >= 0) {
                    const reordered = (typeof window.reorderLayersBatch === 'function')
                      ? window.reorderLayersBatch(currentProjectState.layers, movingIdSet, currentDropIdx)
                      : reorderLayersBatch(currentProjectState.layers, movingIdSet, currentDropIdx);
                    const changed = reordered.some((l, idx) => l.id !== currentProjectState.layers[idx].id);
                    if (changed) {
                      currentProjectState.layers = reordered;
                      movingLayers.forEach(movedItem => {
                        invalidatePreviewCacheForLayer(movedItem);
                      });
                      saveCurrentProjectLayers();
                    }
                  }

                  // Preserve multi-selection
                  if (movingIdSet.size > 1) {
                    selectedLayerIds = new Set(movingIdSet);
                    window.selectedLayerIds = selectedLayerIds;
                    selectedLayerId = movingLayers[movingLayers.length - 1].id;
                    window.selectedLayerId = selectedLayerId;
                  }

                  renderTimelineLayers();
                  redrawComposition();
                }

                window.addEventListener('pointermove', onPointerMove, { passive: true });
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
              });

              slot.appendChild(pill);
              reorderOverlay.appendChild(slot);

              // Render placeholder reorder slots for child layers so vertical rows stay aligned
              if (layer.type === 'precomp' && layer._precompExpanded && Array.isArray(layer.layers)) {
                layer.layers.forEach(child => {
                  const childSlot = document.createElement('div');
                  childSlot.className = 'timeline-lane-reorder-slot is-precomp-child';
                  childSlot.dataset.layerId = child.id;
                  reorderOverlay.appendChild(childSlot);
                });

                if (isDesktop && layer._kfExpanded) {
                  const precompReorderSlot = document.createElement('div');
                  precompReorderSlot.className = 'timeline-lane-reorder-slot is-kf-expanded is-precomp-transform-reorder';
                  precompReorderSlot.dataset.layerId = layer.id;
                  reorderOverlay.appendChild(precompReorderSlot);
                }
              }
            });
          }
        }
        updateReorderHandlesContrast();
        updateTimelineSpotlight();
        renderTimelineLinkConnectors();
        if (typeof window.renderTimelineBeatmarks === 'function') {
          window.renderTimelineBeatmarks();
        }


        if (typeof updateCutBarRowState === 'function') {
          updateCutBarRowState();
        }

        // Restore viewport scrollTop to prevent timeline vertical jump / shifting down
        if (viewport && prevScrollTop > 0) {
          viewport.scrollTop = prevScrollTop;
        }

        // Keep active layer centered if layer action drawer is currently open
        const drawerContainer = document.getElementById('timeline-layer-drawer');
        const isDrawerActive = Boolean(
          (window.Drawer && typeof window.Drawer.isOpen === 'function' && window.Drawer.isOpen('timeline-layer-drawer')) ||
          (drawerContainer && drawerContainer.classList.contains('is-active'))
        );
        if (isDrawerActive && (window.selectedLayerId || (selectedLayerIds && selectedLayerIds.size > 0))) {
          if (typeof centerSelectedTimelineLayer === 'function') {
            centerSelectedTimelineLayer(false);
          }
        }

        if (typeof window.enhanceLaneHeads === 'function') {
          try { window.enhanceLaneHeads(); } catch (_) {}
        }

        if (window.PreviewCacheManager && typeof window.PreviewCacheManager.ensureAudioOnlyFullCache === 'function') {
          window.PreviewCacheManager.ensureAudioOnlyFullCache(currentProjectState);
        }
      }

      function updateReorderHandlesContrast() {
        if (window.isTimelinePlaying || window.isTimelineScrubbing || window.isTimelinePanning) return; // Eliminate forced synchronous reflow during active playback, scrub, or pan
        const reorderOverlay = document.getElementById('timeline-lane-reorder-overlay');
        const vp = document.getElementById('timeline-layers-viewport');
        if (!reorderOverlay || !vp) return;
        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        const curPan = (window.timelinePanX !== undefined ? window.timelinePanX : (typeof panX !== 'undefined' ? panX : 0));
        const vpWidth = vp.clientWidth;
        if (!vpWidth) return;
        const handleTimelinePx = (vpWidth / 2 - 20) - curPan;

        const layers = (currentProjectState && currentProjectState.layers) ? currentProjectState.layers : [];
        const pills = reorderOverlay.querySelectorAll('.timeline-layer-reorder-pill');
        for (let i = 0; i < pills.length; i++) {
          const pill = pills[i];
          const layerId = pill.dataset.layerId;
          const layer = layers.find(l => l.id === layerId);
          if (!layer) continue;
          const startPx = layer.startSec !== undefined ? Math.round(layer.startSec * pps) : (layer.startPx || 0);
          const widthPx = layer.durationSec !== undefined ? Math.round(layer.durationSec * pps) : (layer.widthPx || 320);
          const endPx = startPx + widthPx;
          const isOverClip = !layer.hidden && (handleTimelinePx >= startPx && handleTimelinePx <= endPx);
          pill.classList.toggle('is-over-clip', isOverClip);
        }
      }
      window.updateReorderHandlesContrast = updateReorderHandlesContrast;
      window.addEventListener('resize', updateReorderHandlesContrast, { passive: true });

      function renderTimelineLinkConnectors() {
        // Suppress connector lines on desktop workstations (matches After Effects left-column parenting)
        if (window.isDesktop || document.querySelector('.desktop-viewport')) {
          const staleSvg = document.querySelector('.timeline-link-connectors-svg');
          if (staleSvg) staleSvg.remove();
          return;
        }

        // Connectors render strictly in the timeline track (to the left of layer clips).
        // Matches professional After Effects timeline hierarchy connectors (Photo 2).
        const layersTrack = document.getElementById('timeline-layers-track');
        if (!layersTrack) return;

        // Clean up any stale SVG left in the lane-heads-overlay
        const staleOverlay = document.getElementById('timeline-lane-heads-overlay');
        if (staleOverlay) {
          const staleSvg = staleOverlay.querySelector('.timeline-link-connectors-svg');
          if (staleSvg) staleSvg.remove();
        }

        let svg = layersTrack.querySelector('.timeline-link-connectors-svg');
        if (!svg) {
          svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('class', 'timeline-link-connectors-svg');
          svg.setAttribute('aria-hidden', 'true');
          svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:12;';
          layersTrack.insertBefore(svg, layersTrack.firstChild);
        }
        svg.innerHTML = '';

        const layers = currentProjectState.layers || [];
        if (layers.length === 0) return;

        const linkedLayers = layers.filter(l => l.parentId && (l.id === window.selectedLayerId || l.parentId === window.selectedLayerId));
        if (linkedLayers.length === 0) return;

        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond === 'number' ? pixelsPerSecond : 80);
        function getLayerStartX(layer) {
          if (layer.startPx !== undefined) return layer.startPx;
          return (layer.startSec !== undefined ? layer.startSec : 0) * pps;
        }

        const lanes = layersTrack.querySelectorAll('.timeline-track-lane');
        function getRowY(r) {
          if (lanes && lanes[r]) {
            return lanes[r].offsetTop + lanes[r].offsetHeight / 2;
          }
          const isCompactVp = !window.isDesktop && !document.querySelector('.desktop-viewport');
          return r * (isCompactVp ? 40 : 54) + (isCompactVp ? 17 : 22);
        }

        // 1. Group child layers by parentId
        const parentGroupsMap = new Map();
        linkedLayers.forEach(child => {
          const parent = layers.find(l => l.id === child.parentId);
          if (!parent) return;
          const pIdx = layers.indexOf(parent);
          const cIdx = layers.indexOf(child);
          if (pIdx === -1 || cIdx === -1 || pIdx === cIdx) return;
          if (!parentGroupsMap.has(parent.id)) {
            parentGroupsMap.set(parent.id, { parent, pIdx, children: [], rows: [pIdx], isSelected: false });
          }
          const g = parentGroupsMap.get(parent.id);
          g.children.push({ child, cIdx });
          g.rows.push(cIdx);
        });

        const groups = Array.from(parentGroupsMap.values());
        if (groups.length === 0) return;

        // 2. Compute vertical row spans, selection state, and the leftmost clip start among all rows in span
        groups.forEach(g => {
          g.minRow = Math.min(...g.rows);
          g.maxRow = Math.max(...g.rows);
          const hasPSel = (selectedLayerIds && selectedLayerIds.has(g.parent.id)) || g.parent.id === selectedLayerId;
          const hasCSel = g.children.some(({ child }) => (selectedLayerIds && selectedLayerIds.has(child.id)) || child.id === selectedLayerId);
          g.isSelected = hasPSel || hasCSel;

          // Find the leftmost clip start among ALL layers within this row range
          let minClipX = Infinity;
          for (let r = g.minRow; r <= g.maxRow; r++) {
            const l = layers[r];
            if (l) {
              const sx = getLayerStartX(l);
              if (sx < minClipX) minClipX = sx;
            }
          }
          g.minClipX = isFinite(minClipX) ? minClipX : 0;
        });

        // 3. Cluster overlapping vertical spans to prevent stem collisions (nested channels like Photo 2)
        groups.sort((a, b) => a.minRow - b.minRow || (b.maxRow - b.minRow) - (a.maxRow - a.minRow));
        const clusters = [];
        groups.forEach(g => {
          let placed = clusters.find(c => g.minRow <= c.maxRow && g.maxRow >= c.minRow);
          if (placed) {
            placed.groups.push(g);
            placed.minRow = Math.min(placed.minRow, g.minRow);
            placed.maxRow = Math.max(placed.maxRow, g.maxRow);
            placed.minClipX = Math.min(placed.minClipX, g.minClipX);
          } else {
            clusters.push({ groups: [g], minRow: g.minRow, maxRow: g.maxRow, minClipX: g.minClipX });
          }
        });

        const baseClearance = 16;  // px left of leftmost clip in row span
        const channelSpacing = 12; // px per channel column

        clusters.forEach(cluster => {
          // Larger row spans get outer (further left) channels for clean nesting
          cluster.groups.sort((a, b) => (b.maxRow - b.minRow) - (a.maxRow - a.minRow));
          const channelMaxRows = [];
          cluster.groups.forEach(g => {
            let assigned = -1;
            for (let ch = 0; ch < channelMaxRows.length; ch++) {
              if (channelMaxRows[ch] < g.minRow) {
                assigned = ch;
                channelMaxRows[ch] = g.maxRow;
                break;
              }
            }
            if (assigned === -1) {
              assigned = channelMaxRows.length;
              channelMaxRows.push(g.maxRow);
            }
            g.channel = assigned;
            // Stem X is placed strictly to the left of all clips in this span
            g.stemX = cluster.minClipX - (baseClearance + assigned * channelSpacing);
          });
        });

        // 4. Render: unselected first, selected last (paints on top)
        groups.sort((a, b) => (a.isSelected === b.isSelected ? 0 : a.isSelected ? 1 : -1));

        const clipGap = 3; // px gap before clip edge

        groups.forEach(g => {
          const { pIdx, parent, stemX } = g;
          const sortedRows = g.rows.slice().sort((a, b) => a - b);
          const minRow = sortedRows[0];
          const maxRow = sortedRows[sortedRows.length - 1];
          const yMin = getRowY(minRow);
          const yMax = getRowY(maxRow);
          const R = Math.min(6, Math.max(3, (yMax - yMin) / 6));

          function getTermX(r) {
            if (r === pIdx) {
              return getLayerStartX(parent) - clipGap;
            }
            const ch = g.children.find(c => c.cIdx === r);
            return ch ? (getLayerStartX(ch.child) - clipGap) : stemX;
          }

          const xTop = Math.max(stemX + R, getTermX(minRow));
          const xBot = Math.max(stemX + R, getTermX(maxRow));

          // Continuous C-bracket path with rounded corners (matches Photo 2)
          let d = `M ${xTop} ${yMin} H ${stemX + R} Q ${stemX} ${yMin} ${stemX} ${yMin + R} V ${yMax - R} Q ${stemX} ${yMax} ${stemX + R} ${yMax} H ${xBot}`;

          // Intermediate horizontal branches for rows strictly between minRow and maxRow
          for (let i = 1; i < sortedRows.length - 1; i++) {
            const r = sortedRows[i];
            const y = getRowY(r);
            const tx = Math.max(stemX, getTermX(r));
            d += ` M ${stemX} ${y} H ${tx}`;
          }

          const isSel = g.isSelected;
          const gEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          gEl.setAttribute('class', `timeline-link-group ${isSel ? 'is-selected' : ''}`);

          // Main path line
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', d);
          path.setAttribute('class', `timeline-link-line ${isSel ? 'is-selected' : ''}`);
          gEl.appendChild(path);

          // Origin dot on parent row
          const pY = getRowY(pIdx);
          const pTermX = Math.max(stemX, getLayerStartX(parent) - clipGap);
          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', pTermX);
          dot.setAttribute('cy', pY);
          dot.setAttribute('r', '2.5');
          dot.setAttribute('class', 'timeline-link-dot');
          gEl.appendChild(dot);

          // Junction dots on vertical stem for intermediate rows
          for (let i = 1; i < sortedRows.length - 1; i++) {
            const r = sortedRows[i];
            const jct = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            jct.setAttribute('cx', stemX);
            jct.setAttribute('cy', getRowY(r));
            jct.setAttribute('r', '2');
            jct.setAttribute('class', 'timeline-link-junction');
            gEl.appendChild(jct);
          }

          // Arrowheads at each child clip edge (pointing into child)
          g.children.forEach(({ child, cIdx }) => {
            const yC = getRowY(cIdx);
            const tipX = Math.max(stemX + 2, getLayerStartX(child) - clipGap);
            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arrow.setAttribute('points', `${tipX - 6},${yC - 3.5} ${tipX},${yC} ${tipX - 6},${yC + 3.5}`);
            arrow.setAttribute('class', 'timeline-link-arrow');
            gEl.appendChild(arrow);
          });

          svg.appendChild(gEl);
        });
      }
      window.renderTimelineLinkConnectors = renderTimelineLinkConnectors;

      function removeTimelineLayer(layerId) {
        const idx = (currentProjectState.layers || []).findIndex(l => l.id === layerId);
        if (idx >= 0) {
          const removed = currentProjectState.layers[idx];
          invalidatePreviewCacheForLayer(removed);
          currentProjectState.layers.splice(idx, 1);
          if (selectedLayerId === layerId) {
            selectedLayerId = null;
            window.selectedLayerId = null;
          }
          const media = layerMediaCache.get(removed.mediaId || removed.id);
          if (media && media.el && typeof media.el.pause === 'function') {
            try { media.el.pause(); } catch (_) {}
          }
          if (removed.type === 'precomp' && window.PreviewCacheManager && typeof window.PreviewCacheManager.deletePool === 'function') {
            window.PreviewCacheManager.deletePool(removed.id);
          }
          if (window.Drawer && window.Drawer.isOpen('timeline-layer-drawer')) {
            window.Drawer.close(false);
          }
          deselectTimelineLayer();
          renderTimelineLayers();
          saveCurrentProjectLayers();
          redrawComposition();
        }
      }
      window.removeTimelineLayer = removeTimelineLayer;

      function addOrSelectMediaLayer(item, options = {}) {
        if (!item) return;
        currentProjectState.layers = currentProjectState.layers || [];

        const isTargetSec = options && typeof options.targetSec === 'number' && isFinite(options.targetSec);
        const currentSec = isTargetSec ? Math.max(0, options.targetSec) : Math.max(0, -(panX || 0) / pixelsPerSecond);
        const defaultDur = currentProjectState.defaultDuration || 5;

        if (item.type === 'precomp') {
          const existing = currentProjectState.layers.find(l => l.id === item.precompId || l.mediaId === item.id);
          if (existing && !isTargetSec) {
            selectTimelineLayer(existing.id);
            return;
          }
          const dur = item.duration || defaultDur;
          const widthPx = Math.max(80, Math.round(dur * pixelsPerSecond));
          const startPx = Math.round(currentSec * pixelsPerSecond);
          const aspect = currentProjectState.aspectRatio || '16:9';
          const res = currentProjectState.resolution || '1080p';
          const baseDims = window.getProjectDimensions(res, aspect);
          const baseW = baseDims[0];
          const baseH = baseDims[1];

          const newPrecompLayer = {
            id: item.precompId || ('layer_precomp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)),
            mediaId: item.id,
            name: item.name || 'Pre-comp',
            type: 'precomp',
            startPx: startPx,
            startSec: currentSec,
            durationSec: dur,
            widthPx: widthPx,
            posX: baseW / 2,
            posY: baseH / 2,
            scaleW: baseW,
            scaleH: baseH,
            rotZ: 0,
            rotX: 0,
            rotY: 0,
            rotation: 0,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
            anchorZ: 0,
            posZ: 0,
            opacity: 1,
            blendMode: 'normal',
            is3D: !!item.is3D,
            collapseTransformations: item.collapseTransformations !== undefined ? !!item.collapseTransformations : false,
            layers: Array.isArray(item.layers) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(item.layers) : (Array.isArray(item.layers) ? [] : {})) : []
          };
          if (typeof window.insertLayerIntoCurrentProject === 'function') {
            window.insertLayerIntoCurrentProject(newPrecompLayer);
          } else {
            currentProjectState.layers.unshift(newPrecompLayer);
          }
          selectTimelineLayer(newPrecompLayer.id);
          renderTimelineLayers();
          updateEditorHeaderMode();
          redrawComposition('addPrecompFromMedia');
          saveCurrentProjectLayers();
          return;
        }

        let dur = defaultDur;
        let isVerifiedMediaDur = false;
        if (item.type === 'video' || item.type === 'audio') {
          if (item._durationVerified !== false && isFinite(item.duration) && item.duration > 0) {
            dur = item.duration;
            isVerifiedMediaDur = true;
          } else {
            const media = layerMediaCache ? layerMediaCache.get(item.id) : null;
            if (media && media.el && isFinite(media.el.duration) && media.el.duration > 0) {
              dur = media.el.duration;
              isVerifiedMediaDur = true;
            } else if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.getSourceCache === 'function') {
              const src = window.VideoFrameExtractor.getSourceCache(item.id);
              if (src && isFinite(src.duration) && src.duration > 0) {
                dur = src.duration;
                isVerifiedMediaDur = true;
              }
            }
          }
        }
        // Auto-expand default timeline duration if media is longer than default
        if (dur > (currentProjectState.defaultDuration || 5)) {
          currentProjectState.defaultDuration = Math.ceil(dur);
          if (typeof window.updateTimelineDuration === 'function') {
            window.updateTimelineDuration(true);
          }
        }
        const widthPx = Math.max(10, Math.round(dur * pixelsPerSecond));
        const startPx = Math.round(currentSec * pixelsPerSecond);

        const newLayer = {
          id: 'layer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6) + '_' + currentProjectState.layers.length,
          mediaId: item.id,
          name: item.name,
          type: item.type,
          startPx: startPx,
          startSec: currentSec,
          durationSec: dur,
          widthPx: widthPx,
          dataUrl: item.dataUrl || '',
          thumbUrl: item.thumbUrl || (item.type === 'image' ? (item.dataUrl || '') : ''),
          mediaDuration: ((item.type === 'video' || item.type === 'audio') && isVerifiedMediaDur) ? dur : null,
          mediaFps: item.fps || null,
          mediaWidth: item.width || null,
          mediaHeight: item.height || null,
          isDurationExplicit: true,
          _userResized: false,
          _userTrimmed: false
        };

        // Proportional Aspect Fit: If media width/height known, fit to canvas without stretching
        let natW = item.width || 0;
        let natH = item.height || 0;
        if (!natW || !natH) {
          const mediaEntry = getOrLoadLayerMedia(newLayer);
          if (mediaEntry && mediaEntry.el) {
            if (item.type === 'video' && mediaEntry.el.videoWidth > 0) {
              natW = mediaEntry.el.videoWidth;
              natH = mediaEntry.el.videoHeight;
            } else if (item.type === 'image' && mediaEntry.el.naturalWidth > 0) {
              natW = mediaEntry.el.naturalWidth;
              natH = mediaEntry.el.naturalHeight;
            }
          }
        }
        if (natW && natH) {
          newLayer.mediaWidth = natW;
          newLayer.mediaHeight = natH;
          fitLayerToComposition(newLayer, natW, natH);
        }

        if (typeof window.insertLayerIntoCurrentProject === 'function') {
          window.insertLayerIntoCurrentProject(newLayer);
        } else {
          currentProjectState.layers.unshift(newLayer);
        }
        invalidatePreviewCacheForLayer(newLayer);
        saveCurrentProjectLayers();
        renderTimelineLayers();
        redrawComposition();

        if (!isSelectorMode) {
          selectTimelineLayer(newLayer.id, false);
        } else {
          selectedLayerIds.add(newLayer.id);
          selectedLayerId = newLayer.id;
          window.selectedLayerId = selectedLayerId;
          updateEditorHeaderMode();
        }
      }

      function isTextInputElement(el) {
        if (!el || typeof el !== 'object') return false;
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'textarea') return true;
        if (el.isContentEditable) return true;
        if (typeof el.getAttribute === 'function' && el.getAttribute('contenteditable') === 'true') return true;
        if (tag === 'input') {
          const type = (el.type || '').toLowerCase();
          return ['text', 'search', 'password', 'url', 'email', 'tel', 'number'].includes(type);
        }
        return false;
      }

      // STRICT SPACE KEYBOARD LOCK: Guarantees Space ONLY controls timeline playback, NEVER clicks buttons or triggers UI controllers
      window.addEventListener('keydown', (e) => {
        const isSpace = (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.keyCode === 32);
        if (!isSpace) return;
        if (e.ctrlKey || e.metaKey) return; // Ctrl+Space handled separately for Quick Effects Search

        const activeEl = document.activeElement;
        const targetEl = e.target;
        if (isTextInputElement(targetEl) || isTextInputElement(activeEl)) {
          return; // Let user type spaces in real text input fields
        }

        // If export is in progress, suppress Space completely so playback cannot be started
        if (window.isExporting) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          return;
        }

        // If any modal/popup card or export overlay is active, suppress Space so background timeline does not play and modal buttons don't fire
        const hasOpenModal = document.querySelector('.modal-backdrop.is-active, .modal-backdrop.active, .modal-backdrop.is-open, .modal-card.is-active, #export-fs-overlay.is-active, #export-drawer-backdrop.is-active, #editor-export-progress-overlay[style*="flex"]');
        if (hasOpenModal) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          return;
        }

        // Lock Space exclusively to timeline playback
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }

        // Defocus any button, slider, or UI controller that retained keyboard focus
        if (activeEl && typeof activeEl.blur === 'function' && !isTextInputElement(activeEl)) {
          activeEl.blur();
        }

        const playBtn = document.getElementById('editor-btn-play');
        if (playBtn) {
          playBtn.click();
        }
      }, true); // STRICT CAPTURE PHASE!

      // Intercept Space keyup in capture phase to prevent browser from firing native .click() on focused buttons
      window.addEventListener('keyup', (e) => {
        const isSpace = (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.keyCode === 32);
        if (!isSpace) return;
        if (e.ctrlKey || e.metaKey) return;

        const activeEl = document.activeElement;
        const targetEl = e.target;
        if (isTextInputElement(targetEl) || isTextInputElement(activeEl)) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
      }, true); // STRICT CAPTURE PHASE!

      // Global safety: automatically blur buttons, sliders, switches on pointerup so they don't trap focus
      document.addEventListener('pointerup', (e) => {
        const btn = e.target && typeof e.target.closest === 'function'
          ? e.target.closest('button, [role="button"], input[type="range"], input[type="checkbox"], input[type="radio"]')
          : null;
        if (btn && typeof btn.blur === 'function') {
          setTimeout(() => {
            if (document.activeElement === btn) {
              btn.blur();
            }
          }, 30);
        }
      }, { capture: true, passive: true });

      // Keyboard Shortcuts: Escape to deselect, Ctrl+A to select all, Delete to remove, Ctrl+C/V/D for clipboard
      window.addEventListener('keydown', (e) => {
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (document.querySelector('.modal-backdrop.is-open, .modal-backdrop.active, .modal-card.is-active, .modal-backdrop.is-active, #export-fs-overlay.is-active, #export-drawer-backdrop.is-active')) return;

        // Quick Effects Search Shortcut: Ctrl+Space (works only on selected single or multiple layers)
        if ((e.ctrlKey || e.metaKey) && (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.keyCode === 32)) {
          e.preventDefault();
          const targetLayers = (typeof getSelectedTimelineLayers === 'function') ? getSelectedTimelineLayers() : [];
          if (targetLayers && targetLayers.length > 0) {
            e.stopPropagation();
            if (typeof openQuickEffectsSearch === 'function') {
              openQuickEffectsSearch();
            }
          }
          return;
        }

        // Standard Transform Property Shortcuts: S (Scale), R (Rotation), P (Position), T (Opacity), A (Anchor Point), U (Reveal Keyframes)
        // Mobile: U nonaktif (tanpa dropdown keyframe); S/P/R/T/A tetap buka panel kontrol transform.
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          const hasSelected = !!(selectedLayerId || (selectedLayerIds && selectedLayerIds.size > 0) || (window.selectedLayerId));
          const isMobileKb = (typeof window !== 'undefined' && typeof navigator !== 'undefined'
            && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || ''));
          const k = e.key ? e.key.toLowerCase() : '';
          if (!isMobileKb && hasSelected && k === 'u') {
            e.preventDefault();
            e.stopPropagation();
            const selectedIds = window.selectedLayerIds && window.selectedLayerIds.size > 0 
              ? Array.from(window.selectedLayerIds) 
              : (window.selectedLayerId ? [window.selectedLayerId] : (selectedLayerId ? [selectedLayerId] : []));
            if (selectedIds.length > 0 && typeof window.toggleKeyframeExpansionForSelection === 'function') {
              window.toggleKeyframeExpansionForSelection(selectedIds, true);
            }
            return;
          }
          if (hasSelected && (k === 's' || k === 'r' || k === 'p' || k === 't' || k === 'a')) {
            e.preventDefault();
            if (typeof focusLayerTransformProperty === 'function') {
              if (k === 's') focusLayerTransformProperty('scale');
              else if (k === 'r') focusLayerTransformProperty('rotation');
              else if (k === 'p') focusLayerTransformProperty('position');
              else if (k === 't') focusLayerTransformProperty('opacity');
              else if (k === 'a') focusLayerTransformProperty('anchor');
            }
            return;
          }
        }

        // AE Shortcut: Deselect All (Escape / F2 / Ctrl+Shift+A / Cmd+Shift+A)
        const isDeselect = (e.key === 'Escape') || (e.key === 'F2') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a');
        if (isDeselect) {
          if (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0) {
            e.preventDefault();
            window.clearSelectedKeyframes();
            return;
          }
          if (selectedLayerId || (selectedLayerIds && selectedLayerIds.size > 0) || isSelectorMode) {
            e.preventDefault();
            deselectTimelineLayer();
            return;
          }
        } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'a') {
          // AE Shortcut: Select All (Ctrl+A / Cmd+A)
          e.preventDefault();
          selectAllTimelineLayers();
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
          // AE Shortcut: Split Layer at Current Time (Ctrl+Shift+D / Cmd+Shift+D)
          e.preventDefault();
          if (typeof executeCutMid === 'function') {
            executeCutMid();
          }
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
          // AE Shortcut: Pre-compose / Group Layer(s) (Ctrl+Shift+C / Cmd+Shift+C)
          e.preventDefault();
          const btnPrecomp = document.getElementById('btn-layer-header-left-precomp') || document.getElementById('btn-layer-header-precomp') || document.getElementById('popover-btn-precompose');
          if (btnPrecomp && typeof btnPrecomp.click === 'function') {
            btnPrecomp.click();
          }
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
          // Shortcut: Un Group Precompose (Ctrl+Shift+G / Cmd+Shift+G)
          e.preventDefault();
          if (typeof ungroupPrecompose === 'function') {
            ungroupPrecompose();
          }
        } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
          // Shortcut: Group Layer(s) (Ctrl+G / Cmd+G)
          e.preventDefault();
          if (typeof precomposeSelectedLayers === 'function') {
            precomposeSelectedLayers();
          }
        } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'y') {
          // AE Shortcut: New Solid Layer (Ctrl+Y / Cmd+Y)
          e.preventDefault();
          if (typeof addShapeLayer === 'function') {
            addShapeLayer('rectangle');
          } else {
            const btnKotak = document.getElementById('btn-add-shape-kotak');
            if (btnKotak) btnKotak.click();
          }
        } else if (
          e.altKey && !e.ctrlKey &&
          (e.code === 'BracketLeft' || e.key === '[' || e.keyCode === 219 || e.key === '“' || e.key === '”')
        ) {
          // AE Shortcut: Trim In-Point of layer to Current Time (Alt+[ / Option+[)
          e.preventDefault();
          e.stopPropagation();
          executeTrimIn();
        } else if (
          e.altKey && !e.ctrlKey &&
          (e.code === 'BracketRight' || e.key === ']' || e.keyCode === 221 || e.key === '‘' || e.key === '’')
        ) {
          // AE Shortcut: Trim Out-Point of layer to Current Time (Alt+] / Option+])
          e.preventDefault();
          e.stopPropagation();
          executeTrimOut();
        } else if (
          !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
          (e.code === 'BracketLeft' || e.key === '[' || e.keyCode === 219)
        ) {
          // AE Shortcut: Move In-Point of layer to Current Time ([)
          e.preventDefault();
          e.stopPropagation();
          executeMoveIn();
        } else if (
          !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
          (e.code === 'BracketRight' || e.key === ']' || e.keyCode === 221)
        ) {
          // AE Shortcut: Move Out-Point of layer to Current Time (])
          e.preventDefault();
          e.stopPropagation();
          executeMoveOut();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          // AE Shortcut: Delete (Delete / Backspace)
          if (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.deleteSelectedKeyframes === 'function') {
              window.deleteSelectedKeyframes();
            }
            return;
          }
          const idsToDelete = new Set();
          if (selectedLayerId) idsToDelete.add(selectedLayerId);
          if (selectedLayerIds && selectedLayerIds.size > 0) {
            selectedLayerIds.forEach(id => idsToDelete.add(id));
          }
          if (idsToDelete.size > 0 && currentProjectState.layers) {
            e.preventDefault();
            currentProjectState.layers.forEach(l => {
              if (idsToDelete.has(l.id)) {
                invalidatePreviewCacheForLayer(l);
              }
            });
            currentProjectState.layers = currentProjectState.layers.filter(l => {
              if (idsToDelete.has(l.id)) {
                if (typeof window.releaseLayerMediaElement === 'function') {
                  window.releaseLayerMediaElement(l);
                } else {
                  const media = layerMediaCache.get(l.mediaId || l.id);
                  if (media && media.el && typeof media.el.pause === 'function') {
                    try { media.el.pause(); } catch (_) {}
                  }
                  layerMediaCache.delete(l.id);
                  layerMediaCache.delete(l.mediaId);
                }
                return false;
              }
              return true;
            });
            deselectTimelineLayer();
            renderTimelineLayers();
            saveCurrentProjectLayers();
            redrawComposition();
          }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
          // AE Shortcut: Copy (Ctrl+C / Cmd+C)
          if (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0) {
            e.preventDefault();
            copySelectedKeyframes();
          } else if (selectedLayerId || (selectedLayerIds && selectedLayerIds.size > 0)) {
            e.preventDefault();
            copySelectedLayers();
          }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
          // AE Shortcut: Paste (Ctrl+V / Cmd+V)
          const hasKeyframesSelected = Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0;
          const hasKeyframeClip = window.internalKeyframeClipboard && Array.isArray(window.internalKeyframeClipboard.items) && window.internalKeyframeClipboard.items.length > 0;
          const shouldPasteKeyframe = (window.lastClipboardType === 'keyframe' && hasKeyframeClip) || (hasKeyframesSelected && hasKeyframeClip);

          if (shouldPasteKeyframe) {
            e.preventDefault();
            pasteKeyframes();
          } else if (window.internalLayerClipboard && window.internalLayerClipboard.length > 0) {
            e.preventDefault();
            pasteLayers();
          }
        } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
          // AE Shortcut: Duplicate Layer(s) (Ctrl+D / Cmd+D)
          if (selectedLayerId || (selectedLayerIds && selectedLayerIds.size > 0)) {
            e.preventDefault();
            duplicateSelectedLayers();
          }
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
          // AE Shortcut: Jump to Previous Keyframe / Marker (J)
          e.preventDefault();
          if (typeof navigateBeatmark === 'function') {
            navigateBeatmark(-1);
          }
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
          // AE Shortcut: Jump to Next Keyframe / Marker (K)
          e.preventDefault();
          if (typeof navigateBeatmark === 'function') {
            navigateBeatmark(1);
          }
        } else if (
          (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'm' || e.code === 'KeyM')) ||
          (e.key === '*' || e.code === 'NumpadMultiply') ||
          ((e.ctrlKey || e.metaKey) && (e.key === '8' || e.code === 'Digit8'))
        ) {
          // Shortcut: Add / Toggle Marker or Beatmark at Current Time (M / * / Ctrl+8)
          e.preventDefault();
          e.stopPropagation();
          if (typeof toggleBeatmarkAtCurrentTime === 'function') {
            toggleBeatmarkAtCurrentTime();
          }
          if (typeof window.syncDesktopMarkerLabels === 'function') {
            window.syncDesktopMarkerLabels();
          }
        } else if (e.key === 'PageUp' || ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'ArrowLeft')) {
          // AE Shortcut: Step 1 Frame Backward (Page Up / Ctrl+Left Arrow)
          e.preventDefault();
          const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
          const curSec = Math.max(0, -panX / pps);
          const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState && currentProjectState.fps, 10) || 60);
          const frameDur = 1 / fps;
          if (typeof seekTimelineToTime === 'function') {
            seekTimelineToTime(Math.max(0, curSec - frameDur));
          }
        } else if (e.key === 'PageDown' || ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'ArrowRight')) {
          // AE Shortcut: Step 1 Frame Forward (Page Down / Ctrl+Right Arrow)
          e.preventDefault();
          const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
          const curSec = Math.max(0, -panX / pps);
          const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState && currentProjectState.fps, 10) || 60);
          const frameDur = 1 / fps;
          if (typeof seekTimelineToTime === 'function') {
            seekTimelineToTime(curSec + frameDur);
          }
        } else if (e.key === 'Home') {
          // AE Shortcut: Go to Beginning of Composition (Home)
          e.preventDefault();
          if (typeof seekTimelineToTime === 'function') {
            seekTimelineToTime(0);
          }
        } else if (e.key === 'End') {
          // AE Shortcut: Go to End of Composition (End)
          e.preventDefault();
          const maxDur = (currentProjectState && currentProjectState.durationSec) ||
            (currentProjectState && Array.isArray(currentProjectState.layers) && currentProjectState.layers.reduce((m, l) => Math.max(m, (l.startSec || 0) + (l.durationSec || 0)), 5)) || 5;
          if (typeof seekTimelineToTime === 'function') {
            seekTimelineToTime(maxDur);
          }
        }
      });

      // Expose globally for media drawer interactions
      window.addOrSelectMediaLayer = addOrSelectMediaLayer;
      window.renderTimelineLayers = renderTimelineLayers;
      window.toggleSelectTimelineLayer = toggleSelectTimelineLayer;
      window.removeTimelineLayersForMedia = function(mediaId, dataUrl, item) {
        if (!currentProjectState.layers || !Array.isArray(currentProjectState.layers)) return;

        const targetMediaId = (typeof mediaId === 'object' && mediaId !== null && mediaId.id)
          ? mediaId.id
          : (typeof mediaId === 'string' ? mediaId : (item && item.id ? item.id : null));

        const targetDataUrl = (typeof dataUrl === 'string' && dataUrl)
          ? dataUrl
          : (item && item.dataUrl ? item.dataUrl : null);

        const targetItem = (typeof mediaId === 'object' && mediaId !== null)
          ? mediaId
          : (item || null);

        const targetName = targetItem && targetItem.name ? targetItem.name : null;
        const targetType = targetItem && targetItem.type ? targetItem.type : null;

        const matches = (l) => {
          if (!l) return false;
          // 1. Direct mediaId / id / fillMediaId / sourceVideoId match
          if (targetMediaId && (l.mediaId === targetMediaId || l.id === targetMediaId || l.fillMediaId === targetMediaId || l.sourceVideoId === targetMediaId)) {
            return true;
          }
          // 2. Exact dataUrl match
          if (targetDataUrl && l.dataUrl === targetDataUrl) {
            return true;
          }
          // 3. Precomp match
          if (targetItem && targetItem.type === 'precomp' && (l.id === targetItem.precompId || l.mediaId === targetItem.id)) {
            return true;
          }
          // 4. Name & Type match (handles cases where mediaId was unassigned or stripped)
          if (targetName && l.name === targetName && (l.type === 'video' || l.type === 'audio' || l.type === 'image')) {
            if (!targetType || l.type === targetType) {
              return true;
            }
          }
          // 5. Audio extracted from video match (e.g. video.mp4 (Audio))
          if (targetName && targetType === 'video' && l.type === 'audio' && l.name && l.name.startsWith(targetName)) {
            return true;
          }
          return false;
        };

        const removedLayers = currentProjectState.layers.filter(matches);
        if (removedLayers.length === 0) return;

        const removedIds = new Set(removedLayers.map(l => l.id));

        removedLayers.forEach(l => {
          invalidatePreviewCacheForLayer(l);
          if (typeof window.releaseLayerMediaElement === 'function') {
            window.releaseLayerMediaElement(l);
          } else {
            const media = layerMediaCache.get(l.mediaId || l.id);
            if (media && media.el) {
              if (typeof media.el.pause === 'function') {
                try { media.el.pause(); } catch (_) {}
              }
              try { media.el.src = ''; } catch (_) {}
              if (window.FishAudioEngine) {
                try { window.FishAudioEngine.detachMediaElement(media.el); } catch (_) {}
              }
            }
            layerMediaCache.delete(l.id);
            if (l.mediaId) layerMediaCache.delete(l.mediaId);
          }
        });

        // Clean up nested precomp layers if any child matches
        currentProjectState.layers.forEach(l => {
          if (l.type === 'precomp' && Array.isArray(l.layers)) {
            l.layers = l.layers.filter(child => !matches(child));
          }
          if (removedIds.has(l.parentId)) {
            l.parentId = null;
            delete l.parentBind;
          }
        });

        // Filter out from active project layers
        currentProjectState.layers = currentProjectState.layers.filter(l => !matches(l));

        // Reset selection if removed layer was active
        let selectionChanged = false;
        if (selectedLayerId && removedIds.has(selectedLayerId)) {
          selectedLayerId = null;
          window.selectedLayerId = null;
          selectionChanged = true;
        }
        const selIds = window.selectedLayerIds || (typeof selectedLayerIds !== 'undefined' ? selectedLayerIds : null);
        if (selIds) {
          removedIds.forEach(id => {
            if (selIds.has(id)) {
              selIds.delete(id);
              selectionChanged = true;
            }
          });
        }

        if (selectionChanged) {
          if (typeof window.deselectAllDesktopLayers === 'function') {
            try { window.deselectAllDesktopLayers(); } catch (_) {}
          }
          if (window.Drawer && window.Drawer.isOpen('timeline-layer-drawer')) {
            try { window.Drawer.close(false); } catch (_) {}
          }
        }

        renderTimelineLayers();
        updateEditorHeaderMode();
        saveCurrentProjectLayers();
        redrawComposition('deleteMediaLayers');
      };

      function getSelectedLayerForCut() {
        const targetId = (typeof selectedLayerId !== 'undefined' && selectedLayerId) || window.selectedLayerId;
        if (!targetId || !currentProjectState || !currentProjectState.layers) return null;
        const layer = currentProjectState.layers.find(l => l.id === targetId);
        if (!layer) return null;

        const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60);
        const currentPanX = window.timelinePanX !== undefined ? window.timelinePanX : (typeof window.panX === 'number' ? window.panX : (typeof panX === 'number' ? panX : 0));
        const rawPlayheadPx = Math.abs(currentPanX || 0);
        const playheadSec = Math.round((rawPlayheadPx / pps) * fps) / fps;
        const playheadPx = Math.round(playheadSec * pps);

        const startSec = Math.round((layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps)) * fps) / fps;
        const durSec = Math.max(1 / fps, Math.round((layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps)) * fps) / fps);
        const startPx = Math.round(startSec * pps);
        const widthPx = Math.max(16, Math.round((startSec + durSec) * pps) - startPx);
        const endPx = startPx + widthPx;

        return { layer, playheadPx, startPx, widthPx, endPx, pps, fps };
      }

      function computeLayerSourceOffsetAtTime(layer, targetSec, startSec) {
        const baseOffset = layer.sourceOffsetSec || 0;
        const spd = (layer.speed !== undefined && layer.speed !== 0) ? layer.speed : 1.0;
        if (spd < 0) {
          // For reverse speed, the right piece after split or the remaining piece after left trim retains baseOffset
          return baseOffset;
        }
        if (layer.speedMode !== 'time_remap' && typeof getLayerIntegratedSpeedTime === 'function') {
          return Math.max(0, getLayerIntegratedSpeedTime(layer, targetSec));
        }
        return Math.max(0, baseOffset + Math.max(0, targetSec - startSec) * spd);
      }

      // 1. Cut Left: Trim start of layer to current playhead
      function executeCutLeft() {
        const info = getSelectedLayerForCut();
        if (!info) return;
        const { layer, playheadPx } = info;
        const pps = info.pps || window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const fps = info.fps || ((typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60));

        const currentSec = Math.round((playheadPx / pps) * fps) / fps;
        const startSec = Math.round((layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps)) * fps) / fps;
        const durSec = Math.max(1 / fps, Math.round((layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps)) * fps) / fps);
        const endSec = Math.round((startSec + durSec) * fps) / fps;

        const minDuration = 1 / fps;
        if (currentSec <= startSec + (minDuration * 0.5) || currentSec >= endSec) return;

        const remainingDurSec = Math.max(minDuration, Math.round((endSec - currentSec) * fps) / fps);
        const newSourceOffsetSec = computeLayerSourceOffsetAtTime(layer, currentSec, startSec);

        // Invalidate original span BEFORE redrawing
        invalidatePreviewCacheForLayer(layer, startSec, endSec);

        layer.startSec = currentSec;
        layer.durationSec = remainingDurSec;
        layer.startPx = Math.round(currentSec * pps);
        layer.widthPx = Math.round((currentSec + remainingDurSec) * pps) - layer.startPx;
        layer.sourceOffsetSec = newSourceOffsetSec;
        layer.isDurationExplicit = true;
        layer._userTrimmed = true;
        layer.sourceLayerId = layer.sourceLayerId || layer.id;
        layer._cachedStartSec = currentSec;
        layer._cachedEndSec = endSec;

        renderTimelineLayers();
        redrawComposition();
        saveCurrentProjectLayers();
        selectTimelineLayer(layer.id, false);
      }

      // 2. Cut Mid: Potong tengah di playhead (select layer setelah current playhead)
      function executeCutMid() {
        const info = getSelectedLayerForCut();
        if (!info) return;
        const { layer, playheadPx } = info;
        const pps = info.pps || window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const fps = info.fps || ((typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60));

        const currentSec = Math.round((playheadPx / pps) * fps) / fps;
        const startSec = Math.round((layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps)) * fps) / fps;
        const durSec = Math.max(1 / fps, Math.round((layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps)) * fps) / fps);
        const endSec = Math.round((startSec + durSec) * fps) / fps;

        const minDuration = 1 / fps;
        if (currentSec <= startSec + (minDuration * 0.5) || currentSec >= endSec - (minDuration * 0.5)) return;

        const leftDurSec = Math.max(minDuration, Math.round((currentSec - startSec) * fps) / fps);
        const rightDurSec = Math.max(minDuration, Math.round((endSec - (startSec + leftDurSec)) * fps) / fps);

        const leftStartPx = Math.round(startSec * pps);
        const leftWidthPx = Math.round((startSec + leftDurSec) * pps) - leftStartPx;
        const rightStartPx = leftStartPx + leftWidthPx;
        const rightWidthPx = Math.round((startSec + leftDurSec + rightDurSec) * pps) - rightStartPx;

        // Invalidate original span BEFORE redrawing
        invalidatePreviewCacheForLayer(layer, startSec, endSec);

        const cutSrcId = layer.sourceLayerId || layer.id;
        layer.sourceLayerId = cutSrcId;

        const newLayerId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

        // Deep clone effects with fresh unique IDs so both pieces are 100% decoupled
        const fxIdMap = new Map();
        let clonedEffects = [];
        if (Array.isArray(layer.effects)) {
          clonedEffects = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.effects) : (Array.isArray(layer.effects) ? [] : {}));
          clonedEffects.forEach(fx => {
            const oldFxId = fx.id;
            const newFxId = 'fx_' + (fx.type || 'effect') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            fx.id = newFxId;
            if (oldFxId) fxIdMap.set(oldFxId, newFxId);
          });
        }

        // Deep clone audio effects with fresh unique IDs
        let clonedAudioEffects = [];
        if (Array.isArray(layer.audioEffects)) {
          clonedAudioEffects = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.audioEffects) : (Array.isArray(layer.audioEffects) ? [] : {}));
          clonedAudioEffects.forEach(afx => {
            afx.id = 'afx_' + (afx.type || 'audio') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          });
        }

        // Preserve all keyframes across both split pieces so out-of-bounds keyframes remain visible (outline style) and draggable,
        // and Bezier/Time Remap curves are 100% preserved across the split point
        let leftKeyframes = {};
        let rightKeyframes = {};

        if (layer.keyframes && typeof layer.keyframes === 'object') {
          const allProps = Object.keys(layer.keyframes);
          allProps.forEach(prop => {
            const list = layer.keyframes[prop];
            if (!Array.isArray(list) || list.length === 0) return;

            let rightProp = prop;
            if (prop.includes(':')) {
              const colonIdx = prop.indexOf(':');
              const oldFxId = prop.slice(0, colonIdx);
              const paramName = prop.slice(colonIdx + 1);
              if (fxIdMap.has(oldFxId)) {
                rightProp = `${fxIdMap.get(oldFxId)}:${paramName}`;
              }
            }

            const leftList = list.map(kf => (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(kf) : JSON.parse(JSON.stringify(kf))));
            const rightList = list.map(kf => (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(kf) : JSON.parse(JSON.stringify(kf))));

            if (leftList.length > 0) {
              leftList.sort((a, b) => a.time - b.time);
              leftKeyframes[prop] = leftList;
            }
            if (rightList.length > 0) {
              rightList.sort((a, b) => a.time - b.time);
              rightKeyframes[rightProp] = rightList;
            }
          });
        }

        // Deep-clone nested style and binding objects
        const clonedTextStyle = layer.textStyle ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.textStyle) : (Array.isArray(layer.textStyle) ? [] : {})) : undefined;
        const clonedShapeProps = layer.shapeProps ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.shapeProps) : (Array.isArray(layer.shapeProps) ? [] : {})) : undefined;
        const clonedParentBind = layer.parentBind ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.parentBind) : (Array.isArray(layer.parentBind) ? [] : {})) : undefined;
        const clonedMask = layer.mask ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.mask) : (Array.isArray(layer.mask) ? [] : {})) : undefined;

        // Sample instantaneous effective transform properties at cut time
        const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
          ? getLayerEffectivePropsAtTime(layer, currentSec)
          : layer;

        const aspect = currentProjectState.aspectRatio || '16:9';
        const res = currentProjectState.resolution || '1080p';
        const baseDims = window.getProjectDimensions(res, aspect);
        const baseW = baseDims[0];
        const baseH = baseDims[1];

        const effPosX = effProps.posX !== undefined ? effProps.posX : (layer.posX !== undefined ? layer.posX : baseW / 2);
        const effPosY = effProps.posY !== undefined ? effProps.posY : (layer.posY !== undefined ? layer.posY : baseH / 2);
        const effPosZ = effProps.posZ !== undefined ? effProps.posZ : (layer.posZ || 0);
        const effScaleW = effProps.scaleW !== undefined ? effProps.scaleW : (layer.scaleW || baseW);
        const effScaleH = effProps.scaleH !== undefined ? effProps.scaleH : (layer.scaleH || baseH);
        const effRotZ = effProps.rotZ !== undefined ? effProps.rotZ : (layer.rotZ !== undefined ? layer.rotZ : (layer.rotation || 0));
        const effRotX = effProps.rotX !== undefined ? effProps.rotX : (layer.rotX || 0);
        const effRotY = effProps.rotY !== undefined ? effProps.rotY : (layer.rotY || 0);
        const effOpacity = effProps.opacity !== undefined ? effProps.opacity : (layer.opacity !== undefined ? layer.opacity : 1.0);
        const effSkewX = effProps.skewX !== undefined ? effProps.skewX : (layer.skewX || 0);
        const effSkewY = effProps.skewY !== undefined ? effProps.skewY : (layer.skewY || 0);
        const effAnchorX = effProps.anchorX !== undefined ? effProps.anchorX : (layer.anchorX || 0);
        const effAnchorY = effProps.anchorY !== undefined ? effProps.anchorY : (layer.anchorY || 0);
        const effAnchorZ = effProps.anchorZ !== undefined ? effProps.anchorZ : (layer.anchorZ || 0);

        // Compute right piece's sourceOffsetSec BEFORE modifying layer
        const rightStartSec = startSec + leftDurSec;
        const rightSourceOffsetSec = computeLayerSourceOffsetAtTime(layer, rightStartSec, startSec);
        const resolvedMediaDuration = layer.mediaDuration || getLayerMediaDuration(layer) || null;
        if (resolvedMediaDuration && !layer.mediaDuration) {
          layer.mediaDuration = resolvedMediaDuration;
        }

        // Ensure left piece (layer) has completely independent state
        layer.effects = Array.isArray(layer.effects) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.effects) : (Array.isArray(layer.effects) ? [] : {})) : [];
        layer.audioEffects = Array.isArray(layer.audioEffects) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.audioEffects) : (Array.isArray(layer.audioEffects) ? [] : {})) : [];
        layer.keyframes = leftKeyframes;
        layer._userResized = true;
        layer._userTrimmed = true;
        if (layer.textStyle) layer.textStyle = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.textStyle) : (Array.isArray(layer.textStyle) ? [] : {}));
        if (layer.shapeProps) layer.shapeProps = (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(layer.shapeProps) : (Array.isArray(layer.shapeProps) ? [] : {}));

        // Potongan kanan (setelah playhead)
        const newLayer = {
          ...layer,
          id: newLayerId,
          sourceLayerId: cutSrcId,
          startPx: rightStartPx,
          widthPx: rightWidthPx,
          startSec: rightStartSec,
          durationSec: rightDurSec,
          sourceOffsetSec: rightSourceOffsetSec,
          mediaDuration: resolvedMediaDuration,
          isDurationExplicit: true,
          posX: effPosX,
          posY: effPosY,
          posZ: effPosZ,
          scaleW: effScaleW,
          scaleH: effScaleH,
          rotZ: effRotZ,
          rotation: effRotZ,
          rotX: effRotX,
          rotY: effRotY,
          opacity: effOpacity,
          skewX: effSkewX,
          skewY: effSkewY,
          anchorX: effAnchorX,
          anchorY: effAnchorY,
          anchorZ: effAnchorZ,
          normW: Math.abs(effScaleW) / baseW,
          normH: Math.abs(effScaleH) / baseH,
          normX: (effPosX - effScaleW / 2) / baseW,
          normY: (effPosY - effScaleH / 2) / baseH,
          _userResized: true,
          _userTrimmed: true,
          effects: clonedEffects,
          audioEffects: clonedAudioEffects,
          keyframes: rightKeyframes,
          textStyle: clonedTextStyle,
          shapeProps: clonedShapeProps,
          parentBind: clonedParentBind,
          mask: clonedMask,
          _cachedStartSec: rightStartSec,
          _cachedEndSec: rightStartSec + rightDurSec
        };

        delete newLayer._precompBufferCanvas;
        delete newLayer._runtimeEl;
        delete newLayer._tempCanvas;

        // Share active loaded media element in layerMediaCache so new piece renders instantly without reload
        const origKey = (layer.type === 'video' || layer.type === 'audio') ? layer.id : (layer.mediaId || layer.id);
        if (layerMediaCache && layerMediaCache.has(origKey)) {
          const origEntry = layerMediaCache.get(origKey);
          if (origEntry && (layer.type === 'image' || layer.type === 'video')) {
            layerMediaCache.set(newLayerId, origEntry);
          }
        }

        // Potongan kiri (layer asli)
        layer.startPx = leftStartPx;
        layer.startSec = startSec;
        layer.widthPx = leftWidthPx;
        layer.durationSec = leftDurSec;
        if (layer.speed !== undefined && layer.speed < 0) {
          layer.sourceOffsetSec = (layer.sourceOffsetSec || 0) + rightDurSec * Math.abs(layer.speed);
        }
        layer.isDurationExplicit = true;
        layer._cachedStartSec = startSec;
        layer._cachedEndSec = rightStartSec;

        // Invalidate preview cache across both halves explicitly
        if (window.PreviewCacheManager) {
          window.PreviewCacheManager.invalidateRange(startSec, endSec);
        }
        invalidatePreviewCacheForLayer(layer);
        invalidatePreviewCacheForLayer(newLayer);

        // Sisipkan potongan depan (kanan) di ATAS layer asli dalam timeline layering
        const layerIdx = currentProjectState.layers.findIndex(l => l.id === layer.id);
        if (layerIdx !== -1) {
          currentProjectState.layers.splice(layerIdx, 0, newLayer);
        } else {
          currentProjectState.layers.unshift(newLayer);
        }

        renderTimelineLayers();
        redrawComposition();
        saveCurrentProjectLayers();

        // User requirement: "(yang di select itu layer yang setelah current)"
        selectTimelineLayer(newLayerId, false);
        return newLayerId;
      }

      // 4. Freeze Current Frame: Cut video in middle & freeze upper piece with Time Remapping
      function executeFreezeCurrentFrame() {
        const info = getSelectedLayerForCut();
        if (!info) {
          if (typeof showEffectsRackToast === 'function') showEffectsRackToast('Select a video layer to freeze');
          return;
        }
        const { layer, playheadPx } = info;
        if (layer.type !== 'video') {
          if (typeof showEffectsRackToast === 'function') showEffectsRackToast('Freeze frame requires a video layer');
          return;
        }

        const pps = info.pps || window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const currentSec = playheadPx / pps;
        const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
        const endSec = startSec + durSec;

        const minDuration = 16 / pps;
        if (currentSec <= startSec + minDuration || currentSec >= endSec - minDuration) {
          if (typeof showEffectsRackToast === 'function') showEffectsRackToast('Playhead must be inside video clip');
          return;
        }

        // Calculate exact source video frame timestamp at current playhead before cut
        let freezeSourceTime = 0;
        if (layer.speedMode === 'time_remap') {
          const eff = (typeof getLayerEffectivePropsAtTime === 'function')
            ? getLayerEffectivePropsAtTime(layer, currentSec)
            : layer;
          freezeSourceTime = eff.timeRemap !== undefined ? eff.timeRemap : (layer.timeRemap || 0);
        } else {
          freezeSourceTime = (typeof getLayerIntegratedSpeedTime === 'function')
            ? getLayerIntegratedSpeedTime(layer, currentSec)
            : Math.max(0, (layer.sourceOffsetSec || 0) + (currentSec - startSec) * (layer.speed || 1.0));
        }
        freezeSourceTime = Number(freezeSourceTime.toFixed(3));

        // Execute split at current frame
        const newLayerId = executeCutMid();
        if (!newLayerId) return;

        // Freeze the right half (which was inserted directly above the original layer) using Time Remapping
        const newLayer = (currentProjectState.layers || []).find(l => l.id === newLayerId);
        if (newLayer) {
          const nStartSec = newLayer.startSec !== undefined ? newLayer.startSec : currentSec;
          const nDurSec = newLayer.durationSec !== undefined ? newLayer.durationSec : (endSec - currentSec);
          const nEndSec = Number((nStartSec + nDurSec).toFixed(3));

          newLayer.speedMode = 'time_remap';
          newLayer.timeRemap = freezeSourceTime;
          newLayer.isMuted = true;
          newLayer.muted = true;
          if (!newLayer.keyframes) newLayer.keyframes = {};
          newLayer.keyframes.timeRemap = [
            {
              time: Number(nStartSec.toFixed(3)),
              value: { timeRemap: freezeSourceTime },
              easing: [0, 0, 1, 1]
            },
            {
              time: nEndSec,
              value: { timeRemap: freezeSourceTime },
              easing: [0, 0, 1, 1]
            }
          ];

          invalidatePreviewCacheForLayer(newLayer);
          if (window.PreviewCacheManager) {
            window.PreviewCacheManager.invalidateRange(nStartSec, nEndSec);
          }

          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          if (typeof redrawComposition === 'function') redrawComposition('freeze-frame');
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
          if (typeof showEffectsRackToast === 'function') showEffectsRackToast('Frame Frozen (Time Remapped)');
        }
      }
      window.executeFreezeCurrentFrame = executeFreezeCurrentFrame;

      // 3. Cut Right: Trim end of layer to current playhead
      function executeCutRight() {
        const info = getSelectedLayerForCut();
        if (!info) return;
        const { layer, playheadPx } = info;
        const pps = info.pps || window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const fps = info.fps || ((typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60));

        const currentSec = Math.round((playheadPx / pps) * fps) / fps;
        const startSec = Math.round((layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps)) * fps) / fps;
        const durSec = Math.max(1 / fps, Math.round((layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps)) * fps) / fps);
        const endSec = Math.round((startSec + durSec) * fps) / fps;

        const minDuration = 1 / fps;
        if (currentSec <= startSec + (minDuration * 0.5) || currentSec >= endSec - (minDuration * 0.5)) return;

        const remainingDurSec = Math.max(minDuration, Math.round((currentSec - startSec) * fps) / fps);

        // Invalidate original span BEFORE redrawing
        invalidatePreviewCacheForLayer(layer, startSec, endSec);

        layer.startSec = startSec;
        layer.durationSec = remainingDurSec;
        layer.startPx = Math.round(startSec * pps);
        layer.widthPx = Math.round((startSec + remainingDurSec) * pps) - layer.startPx;
        if (layer.speed !== undefined && layer.speed < 0) {
          layer.sourceOffsetSec = (layer.sourceOffsetSec || 0) + (durSec - remainingDurSec) * Math.abs(layer.speed);
        }
        layer.isDurationExplicit = true;
        layer._userTrimmed = true;
        layer.sourceLayerId = layer.sourceLayerId || layer.id;
        layer._cachedStartSec = startSec;
        layer._cachedEndSec = startSec + remainingDurSec;

        renderTimelineLayers();
        redrawComposition();
        saveCurrentProjectLayers();
        selectTimelineLayer(layer.id, false);
      }

      // 4. Out-of-Bounds Actions (Expand Right, Move Right, Move Left, Expand Left)
      function executeExpandRight() {
        const info = getSelectedLayerForCut();
        if (!info || !info.layer) return;
        const { layer, playheadPx } = info;
        const pps = info.pps || window.currentPixelsPerSecond || pixelsPerSecond || 80;

        const currentSec = playheadPx / pps;
        const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
        const endSec = startSec + durSec;

        if (currentSec <= endSec) return;

        let newDurSec = currentSec - startSec;
        const totalMediaDur = (layer.type === 'video' || layer.type === 'audio') ? getLayerMediaDuration(layer) : null;
        if (layer.speedMode !== 'time_remap' && totalMediaDur !== null) {
          const effSpeed = (layer.speed !== undefined && layer.speed !== 0) ? Math.abs(layer.speed) : 1.0;
          const maxDurSec = Math.max(0.05, (totalMediaDur - (layer.sourceOffsetSec || 0)) / effSpeed);
          newDurSec = Math.min(newDurSec, maxDurSec);
        }

        invalidatePreviewCacheForLayer(layer, startSec, endSec);

        layer.durationSec = newDurSec;
        layer.widthPx = Math.round(newDurSec * pps);
        layer.isDurationExplicit = true;
        layer._userTrimmed = true;
        layer._cachedStartSec = startSec;
        layer._cachedEndSec = startSec + newDurSec;

        renderTimelineLayers();
        redrawComposition();
        saveCurrentProjectLayers();
        updateTimelineDuration(true);
        selectTimelineLayer(layer.id, false);
      }

      function executeMoveRight() {
        const info = getSelectedLayerForCut();
        if (!info || !info.layer) return;
        const { layer, playheadPx } = info;
        const pps = info.pps || window.currentPixelsPerSecond || pixelsPerSecond || 80;

        const currentSec = playheadPx / pps;
        const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
        const endSec = startSec + durSec;

        if (currentSec <= endSec) return;

        const newStartSec = currentSec - durSec;
        const deltaSec = newStartSec - startSec;

        invalidatePreviewCacheForLayer(layer, startSec, endSec);

        layer.startSec = newStartSec;
        layer.startPx = Math.round(newStartSec * pps);
        layer.isDurationExplicit = true;
        layer._cachedStartSec = newStartSec;
        layer._cachedEndSec = currentSec;

        if (layer.keyframes) {
          Object.values(layer.keyframes).forEach(list => {
            if (Array.isArray(list)) {
              list.forEach(kf => {
                kf.time = Number((kf.time + deltaSec).toFixed(4));
              });
            }
          });
        }

        renderTimelineLayers();
        redrawComposition();
        saveCurrentProjectLayers();
        updateTimelineDuration(true);
        selectTimelineLayer(layer.id, false);
      }

      function executeMoveLeft() {
        const info = getSelectedLayerForCut();
        if (!info || !info.layer) return;
        const { layer, playheadPx } = info;
        const pps = info.pps || window.currentPixelsPerSecond || pixelsPerSecond || 80;

        const currentSec = playheadPx / pps;
        const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
        const endSec = startSec + durSec;

        if (currentSec >= startSec) return;

        const newStartSec = Math.max(0, currentSec);
        const deltaSec = newStartSec - startSec;

        invalidatePreviewCacheForLayer(layer, startSec, endSec);

        layer.startSec = newStartSec;
        layer.startPx = Math.round(newStartSec * pps);
        layer.isDurationExplicit = true;
        layer._cachedStartSec = newStartSec;
        layer._cachedEndSec = newStartSec + durSec;

        if (layer.keyframes) {
          Object.values(layer.keyframes).forEach(list => {
            if (Array.isArray(list)) {
              list.forEach(kf => {
                kf.time = Number((kf.time + deltaSec).toFixed(4));
              });
            }
          });
        }

        renderTimelineLayers();
        redrawComposition();
        saveCurrentProjectLayers();
        updateTimelineDuration(true);
        selectTimelineLayer(layer.id, false);
      }

      function executeExpandLeft() {
        const info = getSelectedLayerForCut();
        if (!info || !info.layer) return;
        const { layer, playheadPx } = info;
        const pps = info.pps || window.currentPixelsPerSecond || pixelsPerSecond || 80;

        const currentSec = playheadPx / pps;
        const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
        const endSec = startSec + durSec;

        if (currentSec >= startSec) return;

        const extendSec = startSec - currentSec;
        const totalMediaDur = (layer.type === 'video' || layer.type === 'audio') ? getLayerMediaDuration(layer) : null;
        const effSpeed = (layer.speed !== undefined && layer.speed !== 0) ? Math.abs(layer.speed) : 1.0;

        let actualStartSec = Math.max(0, currentSec);
        let actualDurSec = endSec - actualStartSec;

        if (layer.speedMode !== 'time_remap' && totalMediaDur !== null) {
          const currentOffset = layer.sourceOffsetSec || 0;
          const maxExtend = Math.max(0, currentOffset / effSpeed);
          const actualExtend = Math.min(extendSec, maxExtend);
          actualStartSec = Math.max(0, startSec - actualExtend);
          actualDurSec = endSec - actualStartSec;
          layer.sourceOffsetSec = Math.max(0, currentOffset - actualExtend * effSpeed);
        }

        invalidatePreviewCacheForLayer(layer, startSec, endSec);

        layer.startSec = actualStartSec;
        layer.startPx = Math.round(actualStartSec * pps);
        layer.durationSec = actualDurSec;
        layer.widthPx = Math.round(actualDurSec * pps);
        layer.isDurationExplicit = true;
        layer._userTrimmed = true;
        layer._cachedStartSec = actualStartSec;
        layer._cachedEndSec = endSec;

        renderTimelineLayers();
        redrawComposition();
        saveCurrentProjectLayers();
        updateTimelineDuration(true);
        selectTimelineLayer(layer.id, false);
      }

      function getSelectedLayersForOperation() {
        const layers = (currentProjectState && currentProjectState.layers) || (window.currentProjectState && window.currentProjectState.layers) || [];
        const targetIds = new Set();

        if (window.selectedLayerIds && window.selectedLayerIds.size > 0) {
          window.selectedLayerIds.forEach(id => targetIds.add(id));
        }
        if (typeof selectedLayerIds !== 'undefined' && selectedLayerIds && selectedLayerIds.size > 0) {
          selectedLayerIds.forEach(id => targetIds.add(id));
        }
        if (window.selectedLayerId) {
          targetIds.add(window.selectedLayerId);
        }
        if (typeof selectedLayerId !== 'undefined' && selectedLayerId) {
          targetIds.add(selectedLayerId);
        }

        const selected = layers.filter(l => targetIds.has(l.id));
        return selected;
      }
      window.getSelectedLayersForOperation = getSelectedLayersForOperation;

      function getPlayheadSecForOperation() {
        if (typeof window.getCurrentPlayheadTime === 'function') {
          return window.getCurrentPlayheadTime();
        }
        if (typeof getCurrentPlayheadTime === 'function') {
          return getCurrentPlayheadTime();
        }
        if (typeof window.currentPlaybackSec === 'number') {
          return window.currentPlaybackSec;
        }
        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        const curPan = window.timelinePanX !== undefined ? window.timelinePanX : (typeof panX !== 'undefined' ? panX : 0);
        return Math.max(0, -curPan / pps);
      }
      window.getPlayheadSecForOperation = getPlayheadSecForOperation;

      // Universal After Effects Trim In-Point (Alt+[ / Option+[)
      function executeTrimIn() {
        const targets = getSelectedLayersForOperation();
        if (!targets || targets.length === 0) return;
        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        const currentSec = getPlayheadSecForOperation();

        targets.forEach(layer => {
          const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
          const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
          const endSec = startSec + durSec;
          const effSpeed = (layer.speed !== undefined && layer.speed !== 0) ? Math.abs(layer.speed) : 1.0;

          invalidatePreviewCacheForLayer(layer, startSec, endSec);

          if (currentSec <= startSec) {
            // Playhead before or at start: expand left towards playhead
            const extendSec = startSec - currentSec;
            const totalMediaDur = (layer.type === 'video' || layer.type === 'audio') ? getLayerMediaDuration(layer) : null;
            let actualStartSec = Math.max(0, currentSec);
            let actualDurSec = endSec - actualStartSec;

            if (layer.speedMode !== 'time_remap' && totalMediaDur !== null) {
              const currentOffset = layer.sourceOffsetSec || 0;
              const maxExtend = Math.max(0, currentOffset / effSpeed);
              const actualExtend = Math.min(extendSec, maxExtend);
              actualStartSec = Math.max(0, startSec - actualExtend);
              actualDurSec = endSec - actualStartSec;
              layer.sourceOffsetSec = Math.max(0, currentOffset - actualExtend * effSpeed);
            }

            layer.startSec = actualStartSec;
            layer.startPx = Math.round(actualStartSec * pps);
            layer.durationSec = actualDurSec;
            layer.widthPx = Math.round(actualDurSec * pps);
            layer.isDurationExplicit = true;
            layer._userTrimmed = true;
            layer._cachedStartSec = actualStartSec;
            layer._cachedEndSec = endSec;
          } else if (currentSec > startSec && currentSec < endSec) {
            // Playhead inside layer: trim start
            const remainingDurSec = endSec - currentSec;
            const newSourceOffsetSec = computeLayerSourceOffsetAtTime(layer, currentSec, startSec);
            layer.startSec = currentSec;
            layer.durationSec = remainingDurSec;
            layer.startPx = Math.round(currentSec * pps);
            layer.widthPx = Math.round(remainingDurSec * pps);
            layer.sourceOffsetSec = newSourceOffsetSec;
            layer.isDurationExplicit = true;
            layer._userTrimmed = true;
            layer.sourceLayerId = layer.sourceLayerId || layer.id;
            layer._cachedStartSec = currentSec;
            layer._cachedEndSec = endSec;
          } else {
            // Playhead at or past end: move start to playhead with minimal duration
            const minDur = Math.max(0.1, 1 / (window.currentTimelineFps || 60));
            layer.startSec = currentSec;
            layer.startPx = Math.round(currentSec * pps);
            layer.durationSec = minDur;
            layer.widthPx = Math.round(minDur * pps);
            layer.isDurationExplicit = true;
            layer._userTrimmed = true;
            layer._cachedStartSec = currentSec;
            layer._cachedEndSec = currentSec + minDur;
          }
        });

        renderTimelineLayers();
        redrawComposition();
        saveCurrentProjectLayers();
        updateTimelineDuration(true);

        if (typeof window.syncSelectionClassesInPlace === 'function') {
          try { window.syncSelectionClassesInPlace(); } catch (_) {}
        }
        if (typeof window.syncInspectorState === 'function') {
          try { window.syncInspectorState(); } catch (_) {}
        }
        if (typeof updateCutBarRowState === 'function') {
          try { updateCutBarRowState(); } catch (_) {}
        }
        if (typeof window.syncDesktopPlayhead === 'function') {
          try { window.syncDesktopPlayhead(); } catch (_) {}
        }
      }

      // Universal After Effects Trim Out-Point (Alt+] / Option+])
      function executeTrimOut() {
        const targets = getSelectedLayersForOperation();
        if (!targets || targets.length === 0) return;
        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        const currentSec = getPlayheadSecForOperation();

        targets.forEach(layer => {
          const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
          const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
          const endSec = startSec + durSec;

          invalidatePreviewCacheForLayer(layer, startSec, endSec);

          if (currentSec >= endSec) {
            // Playhead after or at end: expand right towards playhead
            let newDurSec = currentSec - startSec;
            const totalMediaDur = (layer.type === 'video' || layer.type === 'audio') ? getLayerMediaDuration(layer) : null;
            if (layer.speedMode !== 'time_remap' && totalMediaDur !== null) {
              const effSpeed = (layer.speed !== undefined && layer.speed !== 0) ? Math.abs(layer.speed) : 1.0;
              const maxDurSec = Math.max(0.05, (totalMediaDur - (layer.sourceOffsetSec || 0)) / effSpeed);
              newDurSec = Math.min(newDurSec, maxDurSec);
            }
            layer.durationSec = newDurSec;
            layer.widthPx = Math.round(newDurSec * pps);
            layer.isDurationExplicit = true;
            layer._userTrimmed = true;
            layer._cachedStartSec = startSec;
            layer._cachedEndSec = startSec + newDurSec;
          } else if (currentSec > startSec && currentSec < endSec) {
            // Playhead inside layer: trim end
            const remainingDurSec = currentSec - startSec;
            layer.durationSec = remainingDurSec;
            layer.widthPx = Math.round(remainingDurSec * pps);
            layer.isDurationExplicit = true;
            layer._userTrimmed = true;
            layer.sourceLayerId = layer.sourceLayerId || layer.id;
            layer._cachedStartSec = startSec;
            layer._cachedEndSec = currentSec;
          } else {
            // Playhead at or before start: collapse to minimal duration ending at playhead
            const minDur = Math.max(0.1, 1 / (window.currentTimelineFps || 60));
            const newStart = Math.max(0, currentSec - minDur);
            layer.startSec = newStart;
            layer.startPx = Math.round(newStart * pps);
            layer.durationSec = minDur;
            layer.widthPx = Math.round(minDur * pps);
            layer.isDurationExplicit = true;
            layer._userTrimmed = true;
            layer._cachedStartSec = newStart;
            layer._cachedEndSec = currentSec;
          }
        });

        renderTimelineLayers();
        redrawComposition();
        saveCurrentProjectLayers();
        updateTimelineDuration(true);

        if (typeof window.syncSelectionClassesInPlace === 'function') {
          try { window.syncSelectionClassesInPlace(); } catch (_) {}
        }
        if (typeof window.syncInspectorState === 'function') {
          try { window.syncInspectorState(); } catch (_) {}
        }
        if (typeof updateCutBarRowState === 'function') {
          try { updateCutBarRowState(); } catch (_) {}
        }
        if (typeof window.syncDesktopPlayhead === 'function') {
          try { window.syncDesktopPlayhead(); } catch (_) {}
        }
      }

      // Universal After Effects Move In-Point to Playhead ([)
      function executeMoveIn() {
        const targets = getSelectedLayersForOperation();
        if (!targets || targets.length === 0) return;
        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        const currentSec = getPlayheadSecForOperation();

        targets.forEach(layer => {
          const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
          const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
          const endSec = startSec + durSec;

          const newStartSec = Math.max(0, currentSec);
          const deltaSec = newStartSec - startSec;

          invalidatePreviewCacheForLayer(layer, startSec, endSec);

          layer.startSec = newStartSec;
          layer.startPx = Math.round(newStartSec * pps);
          layer.isDurationExplicit = true;
          layer._cachedStartSec = newStartSec;
          layer._cachedEndSec = newStartSec + durSec;

          if (layer.keyframes) {
            Object.values(layer.keyframes).forEach(list => {
              if (Array.isArray(list)) {
                list.forEach(kf => {
                  kf.time = Number(Math.max(0, kf.time + deltaSec).toFixed(4));
                });
              }
            });
          }
        });

        renderTimelineLayers();
        redrawComposition();
        saveCurrentProjectLayers();
        updateTimelineDuration(true);

        if (typeof window.syncSelectionClassesInPlace === 'function') {
          try { window.syncSelectionClassesInPlace(); } catch (_) {}
        }
        if (typeof window.syncInspectorState === 'function') {
          try { window.syncInspectorState(); } catch (_) {}
        }
        if (typeof updateCutBarRowState === 'function') {
          try { updateCutBarRowState(); } catch (_) {}
        }
        if (typeof window.syncDesktopPlayhead === 'function') {
          try { window.syncDesktopPlayhead(); } catch (_) {}
        }
      }

      // Universal After Effects Move Out-Point to Playhead (])
      function executeMoveOut() {
        const targets = getSelectedLayersForOperation();
        if (!targets || targets.length === 0) return;
        const pps = window.currentPixelsPerSecond || (typeof pixelsPerSecond !== 'undefined' ? pixelsPerSecond : 80);
        const currentSec = getPlayheadSecForOperation();

        targets.forEach(layer => {
          const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
          const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
          const endSec = startSec + durSec;

          const newStartSec = Math.max(0, currentSec - durSec);
          const deltaSec = newStartSec - startSec;

          invalidatePreviewCacheForLayer(layer, startSec, endSec);

          layer.startSec = newStartSec;
          layer.startPx = Math.round(newStartSec * pps);
          layer.isDurationExplicit = true;
          layer._cachedStartSec = newStartSec;
          layer._cachedEndSec = newStartSec + durSec;

          if (layer.keyframes) {
            Object.values(layer.keyframes).forEach(list => {
              if (Array.isArray(list)) {
                list.forEach(kf => {
                  kf.time = Number(Math.max(0, kf.time + deltaSec).toFixed(4));
                });
              }
            });
          }
        });

        renderTimelineLayers();
        redrawComposition();
        saveCurrentProjectLayers();
        updateTimelineDuration(true);

        if (typeof window.syncSelectionClassesInPlace === 'function') {
          try { window.syncSelectionClassesInPlace(); } catch (_) {}
        }
        if (typeof window.syncInspectorState === 'function') {
          try { window.syncInspectorState(); } catch (_) {}
        }
        if (typeof updateCutBarRowState === 'function') {
          try { updateCutBarRowState(); } catch (_) {}
        }
        if (typeof window.syncDesktopPlayhead === 'function') {
          try { window.syncDesktopPlayhead(); } catch (_) {}
        }
      }

      function updateVolumeAndSpeedBtnState(layer) {
        const btnSpeed = document.getElementById('btn-layer-speed');
        const btnVolume = document.getElementById('btn-layer-volume');
        if (!btnSpeed || !btnVolume) return;

        const currentLayer = layer || (window.selectedLayerId ? (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId) : null);

        // Speed supported for video, audio, and precomp layers
        const supportsSpeed = !!(currentLayer && (
          currentLayer.type === 'video' ||
          currentLayer.type === 'audio' ||
          currentLayer.type === 'precomp'
        ));

        // Volume supported for video, audio, and precomp layers
        const supportsVolume = !!(currentLayer && (
          currentLayer.type === 'video' ||
          currentLayer.type === 'audio' ||
          currentLayer.type === 'precomp'
        ));

        const volumeIcon = btnVolume.querySelector('.fticon');

        btnSpeed.disabled = !supportsSpeed;
        btnSpeed.classList.toggle('is-disabled', !supportsSpeed);
        btnSpeed.title = supportsSpeed ? 'Speed' : (currentLayer ? 'Speed (Hanya untuk Precomp / Video / Audio)' : 'Speed');

        btnVolume.disabled = !supportsVolume;
        btnVolume.classList.toggle('is-disabled', !supportsVolume);
        btnVolume.title = supportsVolume ? 'Volume' : (currentLayer ? 'Volume (Hanya untuk Precomp / Video / Audio)' : 'Volume');

        if (!supportsVolume) {
          if (volumeIcon) {
            volumeIcon.className = 'fticon fticon-volume-mute';
          }
          return;
        }

        const pps = window.currentPixelsPerSecond || pixelsPerSecond || 80;
        const currentSec = Math.abs(window.timelinePanX || 0) / pps;
        const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
          ? getLayerEffectivePropsAtTime(currentLayer, currentSec)
          : null;
        const currentVol = effProps && effProps.volume !== undefined
          ? effProps.volume
          : (currentLayer.volume !== undefined ? currentLayer.volume : 1.0);

        const isMuted = (currentVol <= 0.001 || currentLayer.muted === true || currentLayer.isMuted === true);

        if (isMuted) {
          if (volumeIcon) volumeIcon.className = 'fticon fticon-volume-mute';
          btnVolume.title = 'Volume (0% - Mute)';
        } else {
          if (volumeIcon) volumeIcon.className = 'fticon fticon-volume';
          btnVolume.title = `Volume (${Math.round(currentVol * 100)}%)`;
        }
      }
      window.updateVolumeAndSpeedBtnState = updateVolumeAndSpeedBtnState;

      let _lastCutBarLayerId = null;
      let _lastCutBarRelation = null;

      function updateCutBarRowState() {
        const groupNormal = document.getElementById('layer-cut-group-normal');
        const groupAfter = document.getElementById('layer-cut-group-after');
        const groupBefore = document.getElementById('layer-cut-group-before');
        if (!groupNormal || !groupAfter || !groupBefore) return;

        const info = getSelectedLayerForCut();
        const currentLayerId = info && info.layer ? info.layer.id : null;
        let currentRelation = 'none';

        if (info && info.layer) {
          if (info.playheadPx > info.endPx + 1) currentRelation = 'after';
          else if (info.playheadPx < info.startPx - 1) currentRelation = 'before';
          else currentRelation = 'inside';
        }

        // Fast skip if relation and target layer haven't changed during timeline scrubbing/panning
        if (currentLayerId === _lastCutBarLayerId && currentRelation === _lastCutBarRelation && (window.isTimelineScrubbing || window.isTimelinePanning)) {
          return;
        }
        _lastCutBarLayerId = currentLayerId;
        _lastCutBarRelation = currentRelation;

        const selectedClip = selectedLayerId ? document.querySelector(`.timeline-clip-block[data-layer-id="${selectedLayerId}"]`) : null;

        updateVolumeAndSpeedBtnState(info ? info.layer : null);

        // Pastikan trim handles selalu normal dan tidak pernah diganggu/disembunyikan
        if (selectedClip) {
          selectedClip.querySelectorAll('.timeline-clip-overflow-pill').forEach(p => p.remove());
          selectedClip.querySelectorAll('.timeline-clip-handle').forEach(h => {
            if (h.style.display === 'none') h.style.display = '';
          });
        }

        const cutRow = document.querySelector('.desktop-timeline-toolbar-left .layer-cut-bar-row');
        const cutDivider = document.getElementById('desktop-cut-divider') || document.querySelector('.desktop-timeline-toolbar-left .desktop-toolbar-divider');

        if (!info || !info.layer) {
          if (cutRow) cutRow.style.display = 'none';
          if (cutDivider) cutDivider.style.display = 'none';
          groupNormal.style.display = cutRow ? 'none' : 'flex';
          groupAfter.style.display = 'none';
          groupBefore.style.display = 'none';
          return;
        }

        if (cutRow) cutRow.style.display = '';
        if (cutDivider) cutDivider.style.display = '';

        if (currentRelation === 'after') {
          groupNormal.style.display = 'none';
          groupAfter.style.display = 'flex';
          groupBefore.style.display = 'none';
        } else if (currentRelation === 'before') {
          groupNormal.style.display = 'none';
          groupAfter.style.display = 'none';
          groupBefore.style.display = 'flex';
        } else {
          groupNormal.style.display = 'flex';
          groupAfter.style.display = 'none';
          groupBefore.style.display = 'none';
        }
      }

      // Hubungkan tombol Cut & Trim ke logic
      const btnCutLeft = document.getElementById('btn-cut-left');
      if (btnCutLeft) {
        btnCutLeft.addEventListener('click', (e) => {
          e.stopPropagation();
          executeTrimIn();
        });
      }

      const btnCutMid = document.getElementById('btn-cut-mid');
      if (btnCutMid) {
        btnCutMid.addEventListener('click', (e) => {
          e.stopPropagation();
          executeCutMid();
        });
      }

      const btnCutRight = document.getElementById('btn-cut-right');
      if (btnCutRight) {
        btnCutRight.addEventListener('click', (e) => {
          e.stopPropagation();
          executeTrimOut();
        });
      }

      const btnExpandRight = document.getElementById('btn-layer-expand-right');
      if (btnExpandRight) {
        btnExpandRight.addEventListener('click', (e) => {
          e.stopPropagation();
          executeTrimOut();
        });
      }

      const btnMoveRight = document.getElementById('btn-layer-move-right');
      if (btnMoveRight) {
        btnMoveRight.addEventListener('click', (e) => {
          e.stopPropagation();
          executeMoveOut();
        });
      }

      const btnMoveLeft = document.getElementById('btn-layer-move-left');
      if (btnMoveLeft) {
        btnMoveLeft.addEventListener('click', (e) => {
          e.stopPropagation();
          executeMoveIn();
        });
      }

      const btnExpandLeft = document.getElementById('btn-layer-expand-left');
      if (btnExpandLeft) {
        btnExpandLeft.addEventListener('click', (e) => {
          e.stopPropagation();
          executeTrimIn();
        });
      }

      const btnFreezeDock = document.getElementById('editor-btn-freeze-frame');
      if (btnFreezeDock) {
        btnFreezeDock.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.Popover) window.Popover.close(false);
          executeFreezeCurrentFrame();
        });
      }

      const desktopBtnFreeze = document.getElementById('desktop-btn-freeze-frame');
      if (desktopBtnFreeze) {
        desktopBtnFreeze.addEventListener('click', (e) => {
          e.stopPropagation();
          executeFreezeCurrentFrame();
        });
      }

      window.executeCutLeft = executeCutLeft;
      window.executeCutMid = executeCutMid;
      window.executeCutRight = executeCutRight;
      window.executeFreezeCurrentFrame = executeFreezeCurrentFrame;
      window.executeExpandRight = executeExpandRight;
      window.executeMoveRight = executeMoveRight;
      window.executeMoveLeft = executeMoveLeft;
      window.executeExpandLeft = executeExpandLeft;
      window.executeTrimIn = executeTrimIn;
      window.executeTrimOut = executeTrimOut;
      window.executeMoveIn = executeMoveIn;
      window.executeMoveOut = executeMoveOut;
      window.updateCutBarRowState = updateCutBarRowState;
      window.updateVolumeAndSpeedBtnState = updateVolumeAndSpeedBtnState;

      // Initial render of timeline layers
      if (typeof renderTimelineLayers === 'function' && layersTrack) renderTimelineLayers();
      if (typeof updateVolumeAndSpeedBtnState === 'function') updateVolumeAndSpeedBtnState(null);

      // Initial alignment at 00:00:00:00
      if (typeof updateTimelinePosition === 'function') updateTimelinePosition(0);
      else if (typeof window.updateTimelinePosition === 'function') window.updateTimelinePosition(0);
}
window.initTimelineOperations = initTimelineOperations;
initTimelineOperations();
