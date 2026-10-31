/**
 * OpenFishTools Studio - Editor Layer Types & 3D Camera
 * Manages primitive layer creation (Camera, Null, Adjustment, Solid, Text, Shape),
 * text typography controls, vector shape canvas rendering, layer parenting/linking, and 3D Camera orbit/pan/dolly controls.
 */
(function() {
    function getLayerInsertionIndex() {
      if (!currentProjectState || !Array.isArray(currentProjectState.layers) || currentProjectState.layers.length === 0) {
        return 0;
      }
      const layers = currentProjectState.layers;
      const selectedIds = new Set();
      if (window.selectedLayerId) selectedIds.add(String(window.selectedLayerId));
      if (window.selectedLayerIds) {
        if (typeof window.selectedLayerIds.forEach === 'function') {
          window.selectedLayerIds.forEach(id => { if (id) selectedIds.add(String(id)); });
        } else if (Array.isArray(window.selectedLayerIds)) {
          window.selectedLayerIds.forEach(id => { if (id) selectedIds.add(String(id)); });
        }
      }
      if (selectedIds.size === 0) {
        const domSelected = document.querySelectorAll('.timeline-clip.is-selected, .timeline-layer.is-selected, [data-layer-id].is-selected');
        domSelected.forEach(el => {
          const lid = el.dataset.layerId || el.getAttribute('data-id');
          if (lid) selectedIds.add(String(lid));
        });
      }
      if (selectedIds.size === 0) {
        return 0;
      }
      for (let i = 0; i < layers.length; i++) {
        if (layers[i] && selectedIds.has(String(layers[i].id))) {
          return i;
        }
      }
      return 0;
    }

    function insertLayerIntoCurrentProject(newLayer) {
      currentProjectState.layers = currentProjectState.layers || [];
      const insertIdx = getLayerInsertionIndex();
      if (insertIdx >= 0 && insertIdx <= currentProjectState.layers.length) {
        currentProjectState.layers.splice(insertIdx, 0, newLayer);
      } else {
        currentProjectState.layers.unshift(newLayer);
      }
      return insertIdx;
    }
    window.getLayerInsertionIndex = getLayerInsertionIndex;
    window.insertLayerIntoCurrentProject = insertLayerIntoCurrentProject;

    function getSelectedLayerTiming() {
      const layers = (currentProjectState && currentProjectState.layers) || [];
      const insertIdx = getLayerInsertionIndex();
      const selId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size === 1 ? Array.from(window.selectedLayerIds)[0] : null);
      let selLayer = layers.find(l => l && String(l.id) === String(selId));
      if (!selLayer && insertIdx >= 0 && insertIdx < layers.length) {
        selLayer = layers[insertIdx];
      }
      if (selLayer) {
        return {
          durationSec: selLayer.durationSec !== undefined ? selLayer.durationSec : null,
          startSec: selLayer.startSec !== undefined ? selLayer.startSec : null
        };
      }
      return { durationSec: null, startSec: null };
    }
    window.getSelectedLayerTiming = getSelectedLayerTiming;

    function addCameraLayer(customDur = null, customStart = null) {
      currentProjectState.layers = currentProjectState.layers || [];
      const pps = window.currentPixelsPerSecond || 80;
      const timing = (customStart === null && customDur === null) ? getSelectedLayerTiming() : {};
      const currentSec = (customStart !== null && typeof customStart === 'number')
        ? customStart
        : (timing.startSec !== null && timing.startSec !== undefined ? timing.startSec : (Math.abs(window.timelinePanX || 0) / pps));
      const defaultDur = (customDur !== null && typeof customDur === 'number')
        ? customDur
        : (timing.durationSec !== null && timing.durationSec !== undefined ? timing.durationSec : (currentProjectState.defaultDuration || 5));
      const widthPx = Math.max(80, Math.round(defaultDur * pps));
      const startPx = Math.round(currentSec * pps);

      const aspect = currentProjectState.aspectRatio || '16:9';
      const res = currentProjectState.resolution || '1080p';
      const baseDims = window.getProjectDimensions(res, aspect);
      const baseW = baseDims[0];
      const baseH = baseDims[1];

      const camCount = currentProjectState.layers.filter(l => l.type === 'camera').length + 1;
      const newLayer = {
        id: 'layer_cam_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: 'Camera ' + camCount,
        type: 'camera',
        startPx: startPx,
        startSec: currentSec,
        durationSec: defaultDur,
        widthPx: widthPx,
        posX: 0,
        posY: 0,
        posZ: 0,
        scaleW: baseW,
        scaleH: baseH,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        rotation: 0,
        cameraLens: 50,
        cameraZoom: 100,
        cameraBlurEnabled: false,
        cameraFocusMode: 'manual',
        cameraFocusTargetLayerId: null,
        cameraFocusDistance: 0,
        cameraBlurNearFar: 600,
        cameraBlurAmount: 20,
        cameraBlurBalance: 0,
        cameraLensPreset: 'standard'
      };

      insertLayerIntoCurrentProject(newLayer);
      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(newLayer);
      saveCurrentProjectLayers();
      renderTimelineLayers();
      redrawComposition();

      if (window.Drawer && window.Drawer.isOpen('timeline-add-drawer')) {
        window.Drawer.close(false);
      }

      selectTimelineLayer(newLayer.id, false);
      return newLayer;
    }
    window.addCameraLayer = addCameraLayer;

    function addOverlapCameraLayer(customDur = null, customStart = null) {
      currentProjectState.layers = currentProjectState.layers || [];
      const pps = window.currentPixelsPerSecond || 80;
      const timing = (customStart === null && customDur === null) ? getSelectedLayerTiming() : {};
      const currentSec = (customStart !== null && typeof customStart === 'number')
        ? customStart
        : (timing.startSec !== null && timing.startSec !== undefined ? timing.startSec : (Math.abs(window.timelinePanX || 0) / pps));
      const defaultDur = (customDur !== null && typeof customDur === 'number')
        ? customDur
        : (timing.durationSec !== null && timing.durationSec !== undefined ? timing.durationSec : (currentProjectState.defaultDuration || 5));
      const widthPx = Math.max(80, Math.round(defaultDur * pps));
      const startPx = Math.round(currentSec * pps);

      const aspect = currentProjectState.aspectRatio || '16:9';
      const res = currentProjectState.resolution || '1080p';
      const baseDims = window.getProjectDimensions(res, aspect);
      const baseW = baseDims[0];
      const baseH = baseDims[1];

      const overlapCamCount = currentProjectState.layers.filter(l => l.isOverlapCamera || (l.name && l.name.startsWith('Overlap Camera'))).length + 1;
      const newLayer = {
        id: 'layer_overlap_cam_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: 'Overlap Camera ' + overlapCamCount,
        type: 'camera',
        isOverlapCamera: true,
        startPx: startPx,
        startSec: currentSec,
        durationSec: defaultDur,
        widthPx: widthPx,
        posX: 0,
        posY: 0,
        posZ: 0,
        scaleW: baseW,
        scaleH: baseH,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        rotation: 0,
        cameraLens: 50,
        cameraZoom: 100,
        cameraBlurEnabled: false,
        cameraFocusMode: 'manual',
        cameraFocusTargetLayerId: null,
        cameraFocusDistance: 0,
        cameraBlurNearFar: 600,
        cameraBlurAmount: 20,
        cameraBlurBalance: 0,
        cameraLensPreset: 'standard',
        overlapChannels: []
      };

      insertLayerIntoCurrentProject(newLayer);
      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(newLayer);
      saveCurrentProjectLayers();
      renderTimelineLayers();
      redrawComposition();

      if (window.Drawer && window.Drawer.isOpen('timeline-add-drawer')) {
        window.Drawer.close(false);
      }

      selectTimelineLayer(newLayer.id, false);
      return newLayer;
    }
    window.addOverlapCameraLayer = addOverlapCameraLayer;

    // ======================================================================
    // NULL OBJECT LAYER & HIERARCHICAL PARENTING CONTROLLER
    // ======================================================================
    function addNullLayer(autoLink = false, options = {}) {
      currentProjectState.layers = currentProjectState.layers || [];
      const pps = window.currentPixelsPerSecond || 80;
      
      const timing = getSelectedLayerTiming();
      let currentSec = Math.abs(window.timelinePanX || 0) / pps;
      if (options && typeof options.startSec === 'number' && isFinite(options.startSec)) {
        currentSec = Math.max(0, options.startSec);
      } else if (options && typeof options.targetSec === 'number' && isFinite(options.targetSec)) {
        currentSec = Math.max(0, options.targetSec);
      } else if (timing.startSec !== null && timing.startSec !== undefined) {
        currentSec = Math.max(0, timing.startSec);
      }
      
      let defaultDur = currentProjectState.defaultDuration || 5;
      if (options && typeof options.durationSec === 'number' && isFinite(options.durationSec)) {
        defaultDur = Math.max(0.1, options.durationSec);
      } else if (timing.durationSec !== null && timing.durationSec !== undefined) {
        defaultDur = Math.max(0.1, timing.durationSec);
      }

      const widthPx = Math.max(80, Math.round(defaultDur * pps));
      const startPx = Math.round(currentSec * pps);

      const aspect = currentProjectState.aspectRatio || '16:9';
      const res = currentProjectState.resolution || '1080p';
      const baseDims = window.getProjectDimensions(res, aspect);
      const baseW = baseDims[0];
      const baseH = baseDims[1];

      const nullCount = currentProjectState.layers.filter(l => l.type === 'null').length + 1;
      const newLayer = {
        id: 'layer_null_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: 'Null ' + nullCount,
        type: 'null',
        startPx: startPx,
        startSec: currentSec,
        durationSec: defaultDur,
        widthPx: widthPx,
        posX: Math.round(baseW / 2),
        posY: Math.round(baseH / 2),
        posZ: 0,
        scaleW: 240,
        scaleH: 240,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        rotation: 0,
        opacity: 1.0
      };

      insertLayerIntoCurrentProject(newLayer);

      if (autoLink && (window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size > 0))) {
        const idSet = new Set();
        if (window.selectedLayerIds && window.selectedLayerIds.size > 0) {
          window.selectedLayerIds.forEach(id => idSet.add(id));
        }
        if (window.selectedLayerId) idSet.add(window.selectedLayerId);
        idSet.delete(newLayer.id);
        const selLayers = (currentProjectState.layers || []).filter(l => idSet.has(l.id));
        selLayers.forEach(l => {
          if (typeof window.linkLayer === 'function') {
            window.linkLayer(l, newLayer);
          } else {
            l.parentId = newLayer.id;
          }
        });
      }

      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(newLayer);
      saveCurrentProjectLayers();
      renderTimelineLayers();
      redrawComposition();

      if (window.Drawer && window.Drawer.isOpen('timeline-add-drawer')) {
        window.Drawer.close(false);
      }

      selectTimelineLayer(newLayer.id, false);
      return newLayer;
    }
    window.addNullLayer = addNullLayer;

    // ======================================================================
    // OVERLAP NULL OBJECT LAYER CONTROLLER
    // ======================================================================
    function addOverlapNullLayer(autoLink = false, options = {}) {
      currentProjectState.layers = currentProjectState.layers || [];
      const pps = window.currentPixelsPerSecond || 80;
      const timing = getSelectedLayerTiming();
      const isTargetSec = options && typeof options.targetSec === 'number' && isFinite(options.targetSec);
      let currentSec = isTargetSec ? Math.max(0, options.targetSec) : (Math.abs(window.timelinePanX || 0) / pps);
      if (options && typeof options.startSec === 'number' && isFinite(options.startSec)) {
        currentSec = Math.max(0, options.startSec);
      } else if (!isTargetSec && timing.startSec !== null && timing.startSec !== undefined) {
        currentSec = Math.max(0, timing.startSec);
      }
      let defaultDur = currentProjectState.defaultDuration || 5;
      if (options && typeof options.durationSec === 'number' && isFinite(options.durationSec)) {
        defaultDur = Math.max(0.1, options.durationSec);
      } else if (timing.durationSec !== null && timing.durationSec !== undefined) {
        defaultDur = Math.max(0.1, timing.durationSec);
      }
      const widthPx = Math.max(80, Math.round(defaultDur * pps));
      const startPx = Math.round(currentSec * pps);

      const aspect = currentProjectState.aspectRatio || '16:9';
      const res = currentProjectState.resolution || '1080p';
      const baseDims = window.getProjectDimensions(res, aspect);
      const baseW = baseDims[0];
      const baseH = baseDims[1];

      const overlapNullCount = currentProjectState.layers.filter(l => l.isOverlapNull || (l.name && l.name.startsWith('Overlap Null'))).length + 1;
      const newLayer = {
        id: 'layer_overlap_null_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: 'Overlap Null ' + overlapNullCount,
        type: 'null',
        isOverlapNull: true,
        startPx: startPx,
        startSec: currentSec,
        durationSec: defaultDur,
        widthPx: widthPx,
        posX: Math.round(baseW / 2),
        posY: Math.round(baseH / 2),
        posZ: 0,
        scaleW: 240,
        scaleH: 240,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        rotation: 0,
        opacity: 1.0
      };

      insertLayerIntoCurrentProject(newLayer);

      if (autoLink && (window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size > 0))) {
        const idSet = new Set();
        if (window.selectedLayerIds && window.selectedLayerIds.size > 0) {
          window.selectedLayerIds.forEach(id => idSet.add(id));
        }
        if (window.selectedLayerId) idSet.add(window.selectedLayerId);
        idSet.delete(newLayer.id);
        const selLayers = (currentProjectState.layers || []).filter(l => idSet.has(l.id));
        selLayers.forEach(l => {
          if (typeof window.linkLayer === 'function') {
            window.linkLayer(l, newLayer);
          } else {
            l.parentId = newLayer.id;
          }
        });
      }

      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(newLayer);
      saveCurrentProjectLayers();
      renderTimelineLayers();
      redrawComposition();

      if (window.Drawer && window.Drawer.isOpen('timeline-add-drawer')) {
        window.Drawer.close(false);
      }

      selectTimelineLayer(newLayer.id, false);
      return newLayer;
    }
    window.addOverlapNullLayer = addOverlapNullLayer;

    // ======================================================================
    // ADJUSTMENT LAYER CONTROLLER
    // ======================================================================
    function addAdjustmentLayer(customDur = null, customStart = null) {
      currentProjectState.layers = currentProjectState.layers || [];
      const pps = window.currentPixelsPerSecond || 80;
      const timing = (customStart === null && customDur === null) ? getSelectedLayerTiming() : {};
      const currentSec = (customStart !== null && typeof customStart === 'number')
        ? customStart
        : (timing.startSec !== null && timing.startSec !== undefined ? timing.startSec : (Math.abs(window.timelinePanX || 0) / pps));
      const defaultDur = (customDur !== null && typeof customDur === 'number')
        ? customDur
        : (timing.durationSec !== null && timing.durationSec !== undefined ? timing.durationSec : (currentProjectState.defaultDuration || 5));
      const widthPx = (customDur !== null && typeof customDur === 'number') ? Math.max(1, Math.round(defaultDur * pps)) : Math.max(80, Math.round(defaultDur * pps));
      const startPx = Math.round(currentSec * pps);

      const aspect = currentProjectState.aspectRatio || '16:9';
      const res = currentProjectState.resolution || '1080p';
      const baseDims = window.getProjectDimensions(res, aspect);
      const baseW = baseDims[0];
      const baseH = baseDims[1];

      const adjCount = currentProjectState.layers.filter(l => l.type === 'adjustment').length + 1;
      const newLayer = {
        id: 'layer_adj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: 'Adjustment ' + adjCount,
        type: 'adjustment',
        startPx: startPx,
        startSec: currentSec,
        durationSec: defaultDur,
        widthPx: widthPx,
        posX: Math.round(baseW / 2),
        posY: Math.round(baseH / 2),
        posZ: 0,
        scaleW: baseW,
        scaleH: baseH,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        rotation: 0,
        opacity: 1.0,
        blendMode: 'normal',
        effects: []
      };

      insertLayerIntoCurrentProject(newLayer);
      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(newLayer);
      saveCurrentProjectLayers();
      renderTimelineLayers();
      redrawComposition();

      if (window.Drawer && window.Drawer.isOpen('timeline-add-drawer')) {
        window.Drawer.close(false);
      }

      selectTimelineLayer(newLayer.id, false);
      return newLayer;
    }
    window.addAdjustmentLayer = addAdjustmentLayer;

    // ======================================================================
    // SOLID LAYER CONTROLLER
    // ======================================================================
    function getRandomSolidColor() {
      const hue = Math.floor(Math.random() * 360);
      const sat = Math.floor(Math.random() * 25) + 65;
      const light = Math.floor(Math.random() * 20) + 45;
      const l = light / 100;
      const a = (sat / 100) * Math.min(l, 1 - l);
      const f = n => {
        const k = (n + hue / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    }
    window.getRandomSolidColor = getRandomSolidColor;

    function addSolidLayer(customDur = null, customStart = null, colorOption = false) {
      currentProjectState.layers = currentProjectState.layers || [];
      const pps = window.currentPixelsPerSecond || 80;
      const timing = (customStart === null && customDur === null) ? getSelectedLayerTiming() : {};
      const currentSec = (customStart !== null && typeof customStart === 'number')
        ? customStart
        : (timing.startSec !== null && timing.startSec !== undefined ? timing.startSec : (Math.abs(window.timelinePanX || 0) / pps));
      const defaultDur = (customDur !== null && typeof customDur === 'number')
        ? customDur
        : (timing.durationSec !== null && timing.durationSec !== undefined ? timing.durationSec : (currentProjectState.defaultDuration || 5));
      const widthPx = Math.max(80, Math.round(defaultDur * pps));
      const startPx = Math.round(currentSec * pps);

      const aspect = currentProjectState.aspectRatio || '16:9';
      const res = currentProjectState.resolution || '1080p';
      const baseDims = window.getProjectDimensions(res, aspect);
      const baseW = (currentProjectState.width && currentProjectState.width > 0) ? currentProjectState.width : baseDims[0];
      const baseH = (currentProjectState.height && currentProjectState.height > 0) ? currentProjectState.height : baseDims[1];

      const shapeProps = {
        sizeX: baseW,
        sizeY: baseH,
        roundness: 0
      };

      const isBlack = (colorOption === true || colorOption === 'black' || colorOption === '#000000');
      let targetColor;
      if (isBlack) {
        targetColor = '#000000';
      } else if (typeof colorOption === 'string' && colorOption.startsWith('#')) {
        targetColor = colorOption;
      } else {
        targetColor = getRandomSolidColor();
      }

      const solidCount = currentProjectState.layers.filter(l => l.type === 'shape' && (l.isSolid || (l.name && l.name.startsWith('Solid')) || (l.name && l.name.startsWith('Black Solid')))).length + 1;
      const layerName = isBlack ? ('Black Solid ' + solidCount) : ('Solid ' + solidCount);

      const newLayer = {
        id: 'layer_solid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: layerName,
        type: 'shape',
        isSolid: true,
        shapeType: 'rectangle',
        shapeProps: shapeProps,
        fillType: 'color',
        fillColor: targetColor,
        strokeColor: targetColor,
        strokeWidth: 0,
        startPx: startPx,
        startSec: currentSec,
        durationSec: defaultDur,
        widthPx: widthPx,
        posX: Math.round(baseW / 2),
        posY: Math.round(baseH / 2),
        posZ: 0,
        scaleW: baseW,
        scaleH: baseH,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        rotation: 0,
        opacity: 1.0
      };

      insertLayerIntoCurrentProject(newLayer);
      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(newLayer);
      if (typeof writeEmergencySnapshot === 'function') writeEmergencySnapshot();
      saveCurrentProjectLayers(true);
      renderTimelineLayers();
      redrawComposition();

      if (window.Drawer && window.Drawer.isOpen('timeline-add-drawer')) {
        window.Drawer.close(false);
      }

      selectTimelineLayer(newLayer.id, false);
      return newLayer;
    }
    window.addSolidLayer = addSolidLayer;

    // ======================================================================
    // TEXT LAYER CONTROLLER & FISHTOOL TEXT ENGINE INTEGRATION
    // ======================================================================
    function addTextLayer(presetId = 'default', options = {}) {
      currentProjectState.layers = currentProjectState.layers || [];
      const pps = window.currentPixelsPerSecond || 80;
      const timing = getSelectedLayerTiming();
      const isTargetSec = options && typeof options.targetSec === 'number' && isFinite(options.targetSec);
      let currentSec = isTargetSec ? Math.max(0, options.targetSec) : (Math.abs(window.timelinePanX || 0) / pps);
      if (options && typeof options.startSec === 'number' && isFinite(options.startSec)) {
        currentSec = Math.max(0, options.startSec);
      } else if (!isTargetSec && timing.startSec !== null && timing.startSec !== undefined) {
        currentSec = Math.max(0, timing.startSec);
      }
      let defaultDur = currentProjectState.defaultDuration || 5;
      if (options && typeof options.durationSec === 'number' && isFinite(options.durationSec)) {
        defaultDur = Math.max(0.1, options.durationSec);
      } else if (timing.durationSec !== null && timing.durationSec !== undefined) {
        defaultDur = Math.max(0.1, timing.durationSec);
      }
      const widthPx = Math.max(80, Math.round(defaultDur * pps));
      const startPx = Math.round(currentSec * pps);

      const aspect = currentProjectState.aspectRatio || '16:9';
      const res = currentProjectState.resolution || '1080p';
      const baseDims = window.getProjectDimensions(res, aspect);
      const baseW = baseDims[0];
      const baseH = baseDims[1];

      const preset = (window.FishTextEngine && window.FishTextEngine.getPreset(presetId)) || {
        name: 'Text',
        props: { text: 'FISH TOOL', fontSize: 64 }
      };

      const defaultTextProps = (window.FishTextEngine && window.FishTextEngine.getDefaultProps()) || {};
      const textProps = Object.assign({}, defaultTextProps, preset.props || {});
      textProps.presetId = presetId;

      const textCount = currentProjectState.layers.filter(l => l.type === 'text').length + 1;
      const nat = (window.FishTextEngine && window.FishTextEngine.getNaturalSize)
        ? window.FishTextEngine.getNaturalSize({ textProps })
        : { width: 320, height: 100 };
      const boxW = nat.width;
      const boxH = nat.height;

      const newLayer = {
        id: 'layer_text_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: (textProps.text || 'Text') + ' ' + textCount,
        type: 'text',
        textProps: textProps,
        fillType: 'color',
        fillColor: textProps.fillColor || '#ffffff',
        startPx: startPx,
        startSec: currentSec,
        durationSec: defaultDur,
        widthPx: widthPx,
        posX: Math.round(baseW / 2),
        posY: Math.round(baseH / 2),
        posZ: 0,
        scaleW: boxW,
        scaleH: boxH,
        normW: Number((boxW / baseW).toFixed(4)),
        normH: Number((boxH / baseH).toFixed(4)),
        normX: Number(((Math.round(baseW / 2) - boxW / 2) / baseW).toFixed(4)),
        normY: Number(((Math.round(baseH / 2) - boxH / 2) / baseH).toFixed(4)),
        mediaWidth: boxW,
        mediaHeight: boxH,
        transformScaleX: 1.0,
        transformScaleY: 1.0,
        _userResized: true,
        _userResizedManual: false,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        rotation: 0,
        opacity: 1.0,
        blendMode: 'normal',
        effects: []
      };

      insertLayerIntoCurrentProject(newLayer);
      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(newLayer);
      saveCurrentProjectLayers();

      if (window.Drawer && window.Drawer.isOpen('timeline-add-drawer')) {
        window.Drawer.close(false);
      }

      renderTimelineLayers();
      redrawComposition();
      selectTimelineLayer(newLayer.id, false);
      updateEditorHeaderMode();
    }
    window.addTextLayer = addTextLayer;

    function renderTextPresetsGrid() {
      const grid = document.getElementById('drawer-text-preset-grid');
      if (!grid || !window.FishTextEngine) return;
      const presets = window.FishTextEngine.getPresets();
      grid.innerHTML = presets.map(p => {
        const tp = p.props;
        let previewStyle = `color: ${tp.fillColor || '#ffffff'};`;
        if (tp.strokeWidth) {
          previewStyle += ` -webkit-text-stroke: ${Math.min(2, tp.strokeWidth / 4)}px ${tp.strokeColor || '#000'};`;
        }
        if (tp.longShadow) {
          previewStyle += ` text-shadow: 2px 2px 0px ${tp.longShadowColor || 'rgba(0,0,0,0.4)'};`;
        } else if (tp.neonGlow) {
          previewStyle += ` text-shadow: 0 0 8px ${tp.neonGlowColor || '#98ce7b'};`;
        }
        let badgeWrapStart = '';
        let badgeWrapEnd = '';
        if (tp.badgeEnabled) {
          badgeWrapStart = `<span style="background: ${tp.badgeColor || '#98ce7b'}; color: ${tp.fillColor || '#000'}; padding: 2px 8px; border-radius: 999px;">`;
          badgeWrapEnd = `</span>`;
        }
        return `
          <button type="button" class="text-preset-card" data-preset-id="${p.id}" title="${p.name} - ${p.desc}" aria-label="${p.name}">
            <div class="text-preset-preview-box">
              <span class="text-preset-preview-text" style="${previewStyle}">${badgeWrapStart}${tp.text ? (tp.text.length > 12 ? tp.text.substring(0, 10) + '..' : tp.text) : 'TEXT'}${badgeWrapEnd}</span>
            </div>
            <span class="text-preset-title">${p.name}</span>
          </button>
        `;
      }).join('');

      grid.querySelectorAll('.text-preset-card').forEach(card => {
        const pid = card.dataset.presetId || 'default';
        if (!card._textDraggableWired) {
          card._textDraggableWired = true;
          card.draggable = true;
          card.addEventListener('dragstart', (e) => {
            window._draggedProjectAsset = { type: 'text', presetId: pid, name: 'Text Preset' };
            card.classList.add('is-dragging');
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = 'copy';
              try {
                e.dataTransfer.setData('application/json', JSON.stringify({ type: 'text', presetId: pid }));
                e.dataTransfer.setData('text/plain', 'Text Preset');
              } catch (_) {}
            }
          });
          card.addEventListener('dragend', () => {
            window._draggedProjectAsset = null;
            card.classList.remove('is-dragging');
            if (typeof window.hideTimelineDropIndicator === 'function') {
              window.hideTimelineDropIndicator();
            }
            const previewEl = document.getElementById('editor-preview-container');
            if (previewEl) previewEl.classList.remove('is-asset-dragover');
          });
        }
        card.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          addTextLayer(pid);
        });
      });
    }
    window.renderTextPresetsGrid = renderTextPresetsGrid;

    // ======================================================================
    // TEXT FORMATTING CONTROLS (data-driven: data-text-jog / -select / -switch / -color)
    // Every control declares its textProps key in HTML; one binder wires them all.
    // ======================================================================
    function getSelectedTextLayer() {
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer || layer.type !== 'text') return null;
      if (!layer.textProps) layer.textProps = window.FishTextEngine ? window.FishTextEngine.getDefaultProps() : {};
      return layer;
    }
    window.getSelectedTextLayer = getSelectedTextLayer;

    function getTextPropValue(tp, key) {
      if (tp && tp[key] !== undefined && tp[key] !== null && tp[key] !== '') return tp[key];
      if (key === 'strokeEnabled' && tp && Number(tp.strokeWidth) > 0) return true;
      const defs = window.FishTextEngine ? window.FishTextEngine.getDefaultProps() : {};
      return defs[key];
    }

    function applyTextLayerChange(layer, opts = {}) {
      if (!layer) return;
      layer._textDirty = true;
      if (layer._textBufferCanvas) {
        layer._textBufferCanvas._lastRenderKey = null;
      }
      layer._textMbCanvas = null;
      if (window.FishTextEngine) {
        const nat = window.FishTextEngine.getNaturalSize(layer);
        const tx = (typeof layer.transformScaleX === 'number' && !isNaN(layer.transformScaleX) && layer.transformScaleX > 0) ? layer.transformScaleX : 1.0;
        const ty = (typeof layer.transformScaleY === 'number' && !isNaN(layer.transformScaleY) && layer.transformScaleY > 0) ? layer.transformScaleY : 1.0;
        layer.scaleW = Math.round(nat.width * tx);
        layer.scaleH = Math.round(nat.height * ty);
        layer.mediaWidth = nat.width;
        layer.mediaHeight = nat.height;
        const baseW = (currentProjectState && currentProjectState.canvasWidth) ? currentProjectState.canvasWidth : 1080;
        const baseH = (currentProjectState && currentProjectState.canvasHeight) ? currentProjectState.canvasHeight : 1920;
        layer.normW = Math.abs(layer.scaleW) / baseW;
        layer.normH = Math.abs(layer.scaleH) / baseH;
      }
      if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
      if (opts.timeline) renderTimelineLayers();
      redrawComposition();
      if (opts.save) saveCurrentProjectLayers();
    }

    // Parse '#rgb' | '#rrggbb' | 'rgb(a)(...)' -> { hex: '#RRGGBB', alpha }
    function parseTextColor(c) {
      const s = String(c || '').trim();
      let m = s.match(/^#([0-9a-f]{3})$/i);
      if (m) {
        const h = m[1].split('').map(x => x + x).join('');
        return { hex: '#' + h.toUpperCase(), alpha: 1 };
      }
      m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
      if (m) return { hex: '#' + m[1].toUpperCase(), alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
      m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i);
      if (m) {
        const toH = v => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0');
        return { hex: ('#' + toH(m[1]) + toH(m[2]) + toH(m[3])).toUpperCase(), alpha: m[4] !== undefined ? Number(m[4]) : 1 };
      }
      return { hex: '#FFFFFF', alpha: 1 };
    }

    function formatTextJogValue(jogEl, v) {
      const dec = Number(jogEl.dataset.decimals) || 0;
      const unit = jogEl.dataset.unit || '';
      return `${Number(v).toFixed(dec)}${unit}`;
    }

    function setTextRulerOffset(jog, v) {
      const ticksEl = jog.querySelector('.jog-wheel-ticks');
      if (!ticksEl) return;
      const mn = Number(jog.dataset.min);
      const span = Number(jog.dataset.max) - mn;
      const tapeW = parseFloat(ticksEl.dataset.tapeWidth) || 480;
      const ratio = span > 0 ? Math.max(0, Math.min(1, (Number(v) - mn) / span)) : 0;
      const offset = (-ratio * tapeW).toFixed(1);
      ticksEl.style.setProperty('--tape-offset', `${offset}px`);
      ticksEl.style.transform = `translateX(${offset}px)`;
      ticksEl.style.clipPath = 'none';
    }

    function syncTextFormatControls(tp) {
      // Jog badges
      document.querySelectorAll('[data-text-jog]').forEach(jog => {
        const key = jog.dataset.textJog;
        const v = Number(getTextPropValue(tp, key)) || 0;
        jog.setAttribute('aria-valuenow', String(v));
        document.querySelectorAll(`[data-text-badge="${key}"]`).forEach(b => { b.textContent = formatTextJogValue(jog, v); });
        if (jog.classList.contains('effects-ruler-scrubber')) setTextRulerOffset(jog, v);
      });
      // Dropdowns
      document.querySelectorAll('[data-text-select]').forEach(dd => {
        const v = String(getTextPropValue(tp, dd.dataset.textSelect));
        dd.dataset.value = v;
        let found = null;
        dd.querySelectorAll('.custom-dropdown-item').forEach(item => {
          const hit = item.dataset.val === v;
          item.classList.toggle('is-selected', hit);
          if (hit) found = item;
        });
        const label = dd.querySelector('.custom-dropdown-label');
        if (label) label.textContent = found ? found.textContent : v.split(',')[0].replace(/['"]/g, '');
      });
      // Segmented switches (string / bool / layer-bool)
      const curTextLayer = getSelectedTextLayer();
      document.querySelectorAll('[data-text-switch]').forEach(sw => {
        const key = sw.dataset.textSwitch;
        let v;
        if (sw.dataset.type === 'layer-bool') {
          v = String(!!(curTextLayer && curTextLayer[key]));
        } else if (sw.dataset.type === 'bool') {
          const raw = getTextPropValue(tp, key);
          v = String(!!raw);
        } else {
          const raw = getTextPropValue(tp, key);
          v = String(raw);
        }
        sw.querySelectorAll('.segmented-switch-item').forEach(item => {
          const hit = item.dataset.val === v;
          item.classList.toggle('is-active', hit);
          item.classList.toggle('is-selected', hit);
          item.setAttribute('aria-selected', hit ? 'true' : 'false');
        });
      });
      // Sections gated by a toggle
      document.querySelectorAll('[data-text-depends]').forEach(body => {
        body.classList.toggle('is-disabled', !getTextPropValue(tp, body.dataset.textDepends));
      });
      // Color swatches (chip uses the user's chosen swatch value)
      document.querySelectorAll('[data-text-color]').forEach(btn => {
        const v = getTextPropValue(tp, btn.dataset.textColor) || '#FFFFFF';
        const chip = btn.querySelector('.color-swatch-chip');
        const hexEl = btn.querySelector('.color-swatch-hex');
        if (chip) chip.style.backgroundColor = v;
        if (hexEl) {
          const pc = parseTextColor(v);
          hexEl.textContent = pc.alpha < 1 ? `${pc.hex} ${Math.round(pc.alpha * 100)}%` : pc.hex;
        }
      });
    }
    window.syncTextFormatControls = syncTextFormatControls;

    function initTextFormatControls() {
      // 1. Pane tabs (Text / Style / Animate)
      const handleTextTabClick = (btn) => {
        const name = btn.dataset.textTab;
        if (!name) return;
        const controller = btn.closest('#text-controller') || document.getElementById('text-controller') || document;
        controller.querySelectorAll('[data-text-tab]').forEach(b => {
          const on = (b.dataset.textTab === name);
          b.classList.toggle('is-active', on);
          b.classList.toggle('is-selected', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        controller.querySelectorAll('[data-text-pane]').forEach(p => {
          p.classList.toggle('is-active', p.dataset.textPane === name);
        });
      };

      document.querySelectorAll('#text-controller [data-text-tab], .text-panel-tabs [data-text-tab], .text-tools-col [data-text-tab]').forEach(btn => {
        if (btn._textTabBound) return;
        btn._textTabBound = true;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleTextTabClick(btn);
        });
      });

      // 2. Jog wheels (delta pills) and ruler sliders (bounded tape, same as Effects params)
      document.querySelectorAll('[data-text-jog]').forEach(jog => {
        const key = jog.dataset.textJog;
        const mn = Number(jog.dataset.min);
        const mx = Number(jog.dataset.max);
        const step = Number(jog.dataset.step) || 1;
        const dec = Number(jog.dataset.decimals) || 0;
        const setText = (layer, v) => {
          layer.textProps[key] = v;
          if (key === 'animInDuration') layer.textProps.animDuration = v;
          document.querySelectorAll(`[data-text-badge="${key}"]`).forEach(b => { b.textContent = formatTextJogValue(jog, v); });
          if (key === 'animInDuration' || key === 'animOutDuration') {
            const hdr = document.getElementById(key === 'animInDuration' ? 'val-text-anim-in-duration' : 'val-text-anim-out-duration');
            if (hdr) hdr.textContent = `${v.toFixed(2)}s`;
          }
        };
        const isTimeline = key === 'animInDuration' || key === 'animOutDuration';

        if (jog.classList.contains('effects-ruler-scrubber')) {
          if (window.FishElements && typeof window.FishElements.bindRulerScrubber === 'function') {
            window.FishElements.bindRulerScrubber(jog, {
              min: mn,
              max: mx,
              step: step,
              decimals: dec,
              onStart: () => {
                const layer = getSelectedTextLayer();
                if (!layer) return false;
                const cur = Number(getTextPropValue(layer.textProps, key));
                jog.setAttribute('aria-valuenow', String(Number.isFinite(cur) ? cur : mn));
                window.isTransformInteracting = true;
              },
              onChange: (quant) => {
                const layer = getSelectedTextLayer();
                if (!layer) return;
                setText(layer, quant);
                setTextRulerOffset(jog, quant);
                applyTextLayerChange(layer, isTimeline ? { timeline: true } : {});
              },
              onCommit: () => {
                window.isTransformInteracting = false;
                const layer = getSelectedTextLayer();
                if (layer) {
                  applyTextLayerChange(layer, { save: true });
                } else {
                  redrawComposition('transformCommit');
                  saveCurrentProjectLayers();
                }
              }
            });
            return;
          }
          const ticksEl = jog.querySelector('.jog-wheel-ticks');
          let currentVal = 0;
          let tapeW = 480;
          bindJogWheel(jog, {
            onStart: (e) => {
              if (e && e.target && e.target.closest('.effects-param-pill-val')) return false;
              const layer = getSelectedTextLayer();
              if (!layer) return false;
              currentVal = Number(getTextPropValue(layer.textProps, key));
              if (!Number.isFinite(currentVal)) currentVal = mn;
              if (ticksEl) tapeW = parseFloat(ticksEl.dataset.tapeWidth) || 480;
              window.isTransformInteracting = true;
            },
            onMove: (rawDelta, e, stepPx) => {
              const layer = getSelectedTextLayer();
              if (!layer) return;
              const span = mx - mn;
              const speed = (e && e.shiftKey) ? 0.2 : ((e && e.altKey) ? 2.5 : 1.0);
              // Drag right (positive px) decreases value (physical ruler reel mechanics)
              currentVal = Math.max(mn, Math.min(mx, currentVal - (span > 0 ? stepPx * (span / tapeW) * speed : 0)));
              const quant = Number((Math.round(currentVal / step) * step).toFixed(dec + 2));
              setText(layer, quant);
              setTextRulerOffset(jog, quant);
              applyTextLayerChange(layer, isTimeline ? { timeline: true } : {});
            },
            onEnd: () => {
              window.isTransformInteracting = false;
              const layer = getSelectedTextLayer();
              if (layer) {
                applyTextLayerChange(layer, { save: true });
              } else {
                redrawComposition('transformEnd');
                saveCurrentProjectLayers();
              }
            }
          });
          return;
        }

        let initVal = 0;
        bindJogWheel(jog, {
          onStart: () => {
            const layer = getSelectedTextLayer();
            if (!layer) return;
            initVal = Number(getTextPropValue(layer.textProps, key)) || 0;
            window.isTransformInteracting = true;
          },
          onMove: (delta) => {
            const layer = getSelectedTextLayer();
            if (!layer) return;
            const v = Number(Math.max(mn, Math.min(mx, initVal + delta * step)).toFixed(dec));
            setText(layer, v);
            applyTextLayerChange(layer, isTimeline ? { timeline: true } : {});
          },
          onEnd: () => {
            window.isTransformInteracting = false;
            const layer = getSelectedTextLayer();
            if (layer) {
              applyTextLayerChange(layer, { save: true });
            } else {
              saveCurrentProjectLayers();
            }
          }
        });
      });

      // 3. Dropdowns
      document.querySelectorAll('[data-text-select]').forEach(dd => {
        const key = dd.dataset.textSelect;
        dd.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.preventDefault();
            const layer = getSelectedTextLayer();
            if (!layer) return;
            layer.textProps[key] = item.dataset.val;
            dd.classList.remove('is-open');
            syncTextFormatControls(layer.textProps);
            applyTextLayerChange(layer, { save: true });
          });
        });
      });

      // 4. Segmented switches (string / bool / layer-bool)
      document.querySelectorAll('[data-text-switch]').forEach(sw => {
        const key = sw.dataset.textSwitch;
        sw.querySelectorAll('.segmented-switch-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const layer = getSelectedTextLayer();
            if (!layer) return;
            if (sw.dataset.type === 'layer-bool') {
              const nextVal = item.dataset.val === 'true';
              layer[key] = nextVal;
              if (key === 'motionBlur') {
                layer._textDirty = true;
                if (layer._textBufferCanvas) layer._textBufferCanvas._lastRenderKey = null;
                if (layer._textMbCanvas) layer._textMbCanvas._lastRenderKey = null;
                if (nextVal && currentProjectState) {
                  currentProjectState.motionBlur = currentProjectState.motionBlur || { shutterAngle: 180, shutterPhase: 0, samples: 16 };
                  currentProjectState.motionBlur.enabled = true;
                  try { localStorage.setItem('oft_global_motion_blur', 'true'); } catch (_) {}
                  const globalMbIcon = document.getElementById('editor-icon-motion-blur');
                  if (globalMbIcon) globalMbIcon.classList.add('is-active');
                }
                const topHeaderMb = document.getElementById('btn-layer-header-motion-blur');
                if (topHeaderMb) topHeaderMb.classList.toggle('is-active', nextVal);
                const overlay = document.getElementById('timeline-lane-heads-overlay');
                const pillSlot = overlay ? overlay.querySelector(`.timeline-lane-pill-slot[data-layer-id="${layer.id}"]`) : null;
                if (pillSlot) {
                  const b = pillSlot.querySelector('.desktop-layer-mblur-btn');
                  if (b) {
                    b.classList.toggle('is-active', nextVal);
                    b.title = nextVal ? 'Motion Blur: Enabled' : 'Motion Blur: Disabled (Click to enable)';
                  }
                }
                if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
              }
            } else {
              const val = sw.dataset.type === 'bool' ? item.dataset.val === 'true' : item.dataset.val;
              layer.textProps[key] = val;
              if (key === 'strokeEnabled' && val === true) {
                if (!Number(layer.textProps.strokeWidth)) {
                  layer.textProps.strokeWidth = 3;
                }
              }
            }
            syncTextFormatControls(layer.textProps);
            applyTextLayerChange(layer, { save: true });
          });
        });
      });

      // 5. Color swatches -> universal FishColorPicker popover
      document.querySelectorAll('[data-text-color]').forEach(btn => {
        const key = btn.dataset.textColor;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const layer = getSelectedTextLayer();
          if (!layer || !window.FishColorPicker || typeof window.FishColorPicker.open !== 'function') return;
          const cur = parseTextColor(getTextPropValue(layer.textProps, key));
          const apply = (hex, alpha, rgba, commit) => {
            const lyr = getSelectedTextLayer();
            if (!lyr) return;
            const val = (typeof alpha === 'number' && alpha < 1 && rgba) ? rgba : hex;
            lyr.textProps[key] = val;
            if (key === 'fillColor') lyr.fillColor = hex;
            syncTextFormatControls(lyr.textProps);
            applyTextLayerChange(lyr, { save: !!commit });
          };
          btn.classList.add('is-active');
          window.FishColorPicker.open({
            anchor: btn,
            color: cur.hex,
            opacity: cur.alpha,
            onChange: (hex, alpha, rgba) => apply(hex, alpha, rgba, false),
            onCommit: (hex, alpha, rgba) => apply(hex, alpha, rgba, true),
            onClose: () => btn.classList.remove('is-active')
          });
        });
      });
    }

    function syncTextControllerUI() {
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer || layer.type !== 'text') return;
      if (!layer.textProps && window.FishTextEngine) {
        layer.textProps = window.FishTextEngine.getDefaultProps();
      }
      const tp = layer.textProps || {};
      syncTextFormatControls(tp);

      const inputContent = document.getElementById('input-text-content');
      if (inputContent && document.activeElement !== inputContent) {
        inputContent.value = tp.text || '';
      }

      const valFontSize = document.getElementById('val-text-font-size');
      if (valFontSize) valFontSize.textContent = `${Math.round(tp.fontSize || 64)}px`;

      const valStrokeWidth = document.getElementById('val-text-stroke-width');
      if (valStrokeWidth) valStrokeWidth.textContent = `${Math.round(tp.strokeWidth || 0)}px`;

      const lblPreset = document.getElementById('lbl-text-preset-name');
      if (lblPreset) {
        const pObj = window.FishTextEngine ? window.FishTextEngine.getPreset(tp.presetId) : null;
        lblPreset.textContent = pObj ? pObj.name : 'FishText';
      }

      const inDur = Math.max(0.1, Number(tp.animInDuration || tp.animDuration) || 0.8);
      const outDur = Math.max(0.1, Number(tp.animOutDuration) || 0.6);
      const curAnimIn = (window.FishTextEngine && typeof window.FishTextEngine.normalizeAnimIn === 'function') ? window.FishTextEngine.normalizeAnimIn(tp.animIn || tp.animation || 'none') : (tp.animIn || tp.animation || 'none');
      const curAnimOut = (window.FishTextEngine && typeof window.FishTextEngine.normalizeAnimOut === 'function') ? window.FishTextEngine.normalizeAnimOut(tp.animOut || 'none') : (tp.animOut || 'none');

      const valAnimInDur = document.getElementById('val-text-anim-in-duration');
      if (valAnimInDur) valAnimInDur.textContent = `${inDur.toFixed(2)}s`;
      const badgeAnimInDur = document.getElementById('badge-text-anim-in-dur');
      if (badgeAnimInDur) badgeAnimInDur.textContent = `${inDur.toFixed(2)}s`;

      const badgeDecay = document.getElementById('badge-text-anim-decay');
      if (badgeDecay) badgeDecay.textContent = `${Number(tp.animDecay || 7.0).toFixed(1)}`;
      const badgeFreq = document.getElementById('badge-text-anim-freq');
      if (badgeFreq) badgeFreq.textContent = `${Number(tp.animFreq || 3).toFixed(1)}`;
      const badgeAmp = document.getElementById('badge-text-anim-amplitude');
      if (badgeAmp) badgeAmp.textContent = `${Number(tp.animAmplitude || 0.6).toFixed(2)}`;
      const badgeStagger = document.getElementById('badge-text-anim-stagger');
      if (badgeStagger) badgeStagger.textContent = `${Number(tp.animStagger || 0.5).toFixed(2)}`;

      const valAnimOutDur = document.getElementById('val-text-anim-out-duration');
      if (valAnimOutDur) valAnimOutDur.textContent = `${outDur.toFixed(2)}s`;
      const badgeAnimOutDur = document.getElementById('badge-text-anim-out-dur');
      if (badgeAnimOutDur) badgeAnimOutDur.textContent = `${outDur.toFixed(2)}s`;

      // Sync IN Animation Dropdown
      const ddAnimIn = document.getElementById('dropdown-text-anim-in');
      if (ddAnimIn) {
        ddAnimIn.dataset.value = curAnimIn;
        const targetItem = ddAnimIn.querySelector(`.custom-dropdown-item[data-val="${curAnimIn}"]`);
        const label = ddAnimIn.querySelector('.custom-dropdown-label');
        if (targetItem && label) {
          label.textContent = targetItem.textContent;
        }
        ddAnimIn.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.classList.toggle('is-selected', item.dataset.val === curAnimIn);
        });
      }

      // Sync Animate By Dropdown
      const curAnimTarget = tp.animTarget || 'character';
      const ddAnimTarget = document.getElementById('dropdown-text-anim-target');
      if (ddAnimTarget) {
        ddAnimTarget.dataset.value = curAnimTarget;
        const targetItem = ddAnimTarget.querySelector(`.custom-dropdown-item[data-val="${curAnimTarget}"]`);
        const label = ddAnimTarget.querySelector('.custom-dropdown-label');
        if (targetItem && label) label.textContent = targetItem.textContent;
        ddAnimTarget.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.classList.toggle('is-selected', item.dataset.val === curAnimTarget);
        });
      }

      // Sync OUT Animation Dropdown
      const ddAnimOut = document.getElementById('dropdown-text-anim-out');
      if (ddAnimOut) {
        ddAnimOut.dataset.value = curAnimOut;
        const targetItem = ddAnimOut.querySelector(`.custom-dropdown-item[data-val="${curAnimOut}"]`);
        const label = ddAnimOut.querySelector('.custom-dropdown-label');
        if (targetItem && label) {
          label.textContent = targetItem.textContent;
        }
        ddAnimOut.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.classList.toggle('is-selected', item.dataset.val === curAnimOut);
        });
      }

      const quickRow = document.getElementById('text-quick-presets-row');
      if (quickRow && window.FishTextEngine) {
        const presets = window.FishTextEngine.getPresets();
        quickRow.innerHTML = presets.map(p => {
          const isActive = (tp.presetId === p.id);
          return `<button type="button" class="text-quick-preset-pill ${isActive ? 'is-active' : ''}" data-preset-id="${p.id}">${p.name}</button>`;
        }).join('');
        quickRow.querySelectorAll('.text-quick-preset-pill').forEach(pill => {
          pill.addEventListener('click', (e) => {
            e.preventDefault();
            const pid = pill.dataset.presetId;
            const pObj = window.FishTextEngine.getPreset(pid);
            if (pObj) {
              const keepText = layer.textProps.text;
              layer.textProps = Object.assign({}, window.FishTextEngine.getDefaultProps(), pObj.props || {});
              layer.textProps.text = keepText;
              layer.textProps.presetId = pid;
              layer.fillColor = layer.textProps.fillColor || '#ffffff';
              layer._textBufferCanvas = null;
              if (window.FishTextEngine) {
                const nat = window.FishTextEngine.getNaturalSize(layer);
                layer.scaleW = nat.width * (layer.transformScaleX || 1);
                layer.scaleH = nat.height * (layer.transformScaleY || 1);
                layer.mediaWidth = nat.width;
                layer.mediaHeight = nat.height;
              }
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
              syncTextControllerUI();
              renderTimelineLayers();
              redrawComposition();
              saveCurrentProjectLayers();
            }
          });
        });
      }
    }
    window.syncTextControllerUI = syncTextControllerUI;

    function initTextController() {
      const inputContent = document.getElementById('input-text-content');
      if (inputContent) {
        inputContent.addEventListener('input', () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'text') return;
          if (!layer.textProps) layer.textProps = {};
          layer.textProps.text = inputContent.value;
          layer._textBufferCanvas = null;
          if (window.FishTextEngine) {
            const nat = window.FishTextEngine.getNaturalSize(layer);
            layer.scaleW = nat.width * (layer.transformScaleX || 1);
            layer.scaleH = nat.height * (layer.transformScaleY || 1);
            layer.mediaWidth = nat.width;
            layer.mediaHeight = nat.height;
          }
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          redrawComposition();
          saveCurrentProjectLayers();
        });
      }

      // Text IN Animation Dropdown
      const ddAnimIn = document.getElementById('dropdown-text-anim-in');
      if (ddAnimIn) {
        ddAnimIn.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.preventDefault();
            const val = item.dataset.val;
            const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
            if (!layer || layer.type !== 'text') return;
            if (!layer.textProps) layer.textProps = {};
            layer.textProps.animIn = val;
            layer.textProps.animation = val;
            ddAnimIn.dataset.value = val;
            const label = ddAnimIn.querySelector('.custom-dropdown-label');
            if (label) label.textContent = item.textContent;
            ddAnimIn.querySelectorAll('.custom-dropdown-item').forEach(i => i.classList.toggle('is-selected', i === item));
            ddAnimIn.classList.remove('is-open');
            layer._textBufferCanvas = null;
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            renderTimelineLayers();
            redrawComposition();
            saveCurrentProjectLayers();
          });
        });
      }

      // Animate By Dropdown (character / word / line)
      const ddAnimTarget = document.getElementById('dropdown-text-anim-target');
      if (ddAnimTarget) {
        ddAnimTarget.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.preventDefault();
            const val = item.dataset.val;
            const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
            if (!layer || layer.type !== 'text') return;
            if (!layer.textProps) layer.textProps = {};
            layer.textProps.animTarget = val;
            ddAnimTarget.dataset.value = val;
            const label = ddAnimTarget.querySelector('.custom-dropdown-label');
            if (label) label.textContent = item.textContent;
            ddAnimTarget.querySelectorAll('.custom-dropdown-item').forEach(i => i.classList.toggle('is-selected', i === item));
            ddAnimTarget.classList.remove('is-open');
            layer._textBufferCanvas = null;
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            redrawComposition();
            saveCurrentProjectLayers();
          });
        });
      }

      // Text OUT Animation Dropdown
      const ddAnimOut = document.getElementById('dropdown-text-anim-out');
      if (ddAnimOut) {
        ddAnimOut.querySelectorAll('.custom-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.preventDefault();
            const val = item.dataset.val;
            const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
            if (!layer || layer.type !== 'text') return;
            if (!layer.textProps) layer.textProps = {};
            layer.textProps.animOut = val;
            ddAnimOut.dataset.value = val;
            const label = ddAnimOut.querySelector('.custom-dropdown-label');
            if (label) label.textContent = item.textContent;
            ddAnimOut.querySelectorAll('.custom-dropdown-item').forEach(i => i.classList.toggle('is-selected', i === item));
            ddAnimOut.classList.remove('is-open');
            layer._textBufferCanvas = null;
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            renderTimelineLayers();
            redrawComposition();
            saveCurrentProjectLayers();
          });
        });
      }

      initTextFormatControls();
    }
    window.initTextController = initTextController;

    // Precomp clip cache progress helper (no-op: baked precomp removed)
    function updatePrecompClipProgress(layerOrId) {}
    window.updatePrecompClipProgress = updatePrecompClipProgress;

    function updateAllPrecompClipsProgress() {}
    window.updateAllPrecompClipsProgress = updateAllPrecompClipsProgress;

    // ======================================================================
    // SHAPE LAYER CONTROLLER & VECTOR CANVAS RENDERER
    // ======================================================================
    window.isShapeSizeLinked = true;

    function addShapeLayer(shapeType = 'rectangle', options = {}) {
      currentProjectState.layers = currentProjectState.layers || [];
      const pps = window.currentPixelsPerSecond || 80;
      
      const timing = getSelectedLayerTiming();
      let currentSec = Math.abs(window.timelinePanX || 0) / pps;
      if (options && typeof options.startSec === 'number' && isFinite(options.startSec)) {
        currentSec = Math.max(0, options.startSec);
      } else if (options && typeof options.targetSec === 'number' && isFinite(options.targetSec)) {
        currentSec = Math.max(0, options.targetSec);
      } else if (timing.startSec !== null && timing.startSec !== undefined) {
        currentSec = Math.max(0, timing.startSec);
      }
      
      let defaultDur = currentProjectState.defaultDuration || 5;
      if (options && typeof options.durationSec === 'number' && isFinite(options.durationSec)) {
        defaultDur = Math.max(0.1, options.durationSec);
      } else if (timing.durationSec !== null && timing.durationSec !== undefined) {
        defaultDur = Math.max(0.1, timing.durationSec);
      }

      const widthPx = Math.max(80, Math.round(defaultDur * pps));
      const startPx = Math.round(currentSec * pps);

      const aspect = currentProjectState.aspectRatio || '16:9';
      const res = currentProjectState.resolution || '1080p';
      const baseDims = window.getProjectDimensions(res, aspect);
      const baseW = baseDims[0];
      const baseH = baseDims[1];

      let shapeProps = {
        sizeX: 300,
        sizeY: 300
      };

      const shapeDef = (typeof window !== 'undefined' && window.FishShapesRegistry)
        ? window.FishShapesRegistry.get(shapeType)
        : null;

      let defaultName = shapeDef ? shapeDef.name : 'Kotak';
      if (shapeDef && typeof window.FishShapesRegistry.createDefaultProps === 'function') {
        shapeProps = window.FishShapesRegistry.createDefaultProps(shapeType);
      } else if (shapeType === 'circle') {
        defaultName = 'Lingkaran';
        shapeProps.sizeX = 300;
        shapeProps.sizeY = 300;
      } else if (shapeType === 'rectangle') {
        defaultName = 'Kotak';
        shapeProps.sizeX = 300;
        shapeProps.sizeY = 300;
        shapeProps.roundness = 24;
      } else if (shapeType === 'triangle') {
        defaultName = 'Segitiga';
        shapeProps.sizeX = 300;
        shapeProps.sizeY = 300;
        shapeProps.step = 3;
        shapeProps.roundness = 0;
      } else if (shapeType === 'star') {
        defaultName = 'Bintang';
        shapeProps.sizeX = 320;
        shapeProps.sizeY = 320;
        shapeProps.points = 5;
        shapeProps.innerRadius = 0.4;
      } else if (shapeType === 'polygon') {
        defaultName = 'Poligon';
        shapeProps.sizeX = 300;
        shapeProps.sizeY = 300;
        shapeProps.sides = 6;
        shapeProps.roundness = 0;
      } else if (shapeType === 'capsule') {
        defaultName = 'Kapsul';
        shapeProps.sizeX = 360;
        shapeProps.sizeY = 180;
      } else if (shapeType === 'heart') {
        defaultName = 'Hati';
        shapeProps.sizeX = 300;
        shapeProps.sizeY = 300;
      }

      if (shapeType === 'vector') {
        defaultName = 'Vector';
        shapeProps.sizeX = 120;
        shapeProps.sizeY = 120;
        shapeProps.closed = false;
        shapeProps.strokeWidth = 6;
        shapeProps.strokeColor = '#ffffff';
        shapeProps.strokeCap = 'round';
        if (!Array.isArray(shapeProps.points)) shapeProps.points = [];
      }

      const shapeCount = currentProjectState.layers.filter(l => l.type === 'shape' && l.shapeType === shapeType).length + 1;
      const newLayer = {
        id: 'layer_shape_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: defaultName + ' ' + shapeCount,
        type: 'shape',
        shapeType: shapeType,
        shapeProps: shapeProps,
        fillType: 'color',
        fillColor: '#98ce7b',
        strokeColor: '#ffffff',
        strokeWidth: shapeType === 'vector' ? 6 : 0,
        strokeCap: 'round',
        startPx: startPx,
        startSec: currentSec,
        durationSec: defaultDur,
        widthPx: widthPx,
        posX: Math.round(baseW / 2),
        posY: Math.round(baseH / 2),
        posZ: 0,
        scaleW: shapeProps.sizeX,
        scaleH: shapeProps.sizeY,
        normW: Number((shapeProps.sizeX / baseW).toFixed(4)),
        normH: Number((shapeProps.sizeY / baseH).toFixed(4)),
        normX: Number(((Math.round(baseW / 2) - shapeProps.sizeX / 2) / baseW).toFixed(4)),
        normY: Number(((Math.round(baseH / 2) - shapeProps.sizeY / 2) / baseH).toFixed(4)),
        mediaWidth: shapeProps.sizeX,
        mediaHeight: shapeProps.sizeY,
        transformScaleX: 1.0,
        transformScaleY: 1.0,
        _userResized: true,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        rotation: 0,
        opacity: 1.0,
        blendMode: 'normal',
        effects: []
      };

      if (shapeType === 'vector' && typeof window.syncVectorLayerBounds === 'function') {
        window.syncVectorLayerBounds(newLayer, true);
      }

      insertLayerIntoCurrentProject(newLayer);
      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(newLayer);
      if (typeof writeEmergencySnapshot === 'function') writeEmergencySnapshot();
      saveCurrentProjectLayers(true);
      renderTimelineLayers();
      redrawComposition();

      if (window.Drawer && window.Drawer.isOpen('timeline-add-drawer')) {
        window.Drawer.close(false);
      }

      if (shapeType === 'vector' && window._vectorEditorState) {
        window._vectorEditorState.target = 'new';
        window._vectorEditorState.tool = 'point';
        window._vectorEditorState.curveSubMode = 'both';
        window._vectorEditorState.cursorX = 0;
        window._vectorEditorState.cursorY = 0;
        window._vectorEditorState.isDraggingPad = false;
        window._vectorEditorState.isScrubbing = false;
      }

      selectTimelineLayer(newLayer.id, false);
      if (typeof switchLayerDrawerSubview === 'function') {
        switchLayerDrawerSubview(shapeType === 'vector' ? 'vector' : 'main');
      }
      return newLayer;
    }
    window.addShapeLayer = addShapeLayer;

    function renderShapeToCanvas(layer, targetCanvas, targetW, targetH) {
      if (!targetCanvas || typeof targetCanvas.getContext !== 'function' || !layer) return targetCanvas;
      const shapeType = layer.shapeType || 'rectangle';
      const isVector = (shapeType === 'vector');
      let sProps = layer.shapeProps || {};

      const hasVecKf = isVector && layer.keyframes && Array.isArray(layer.keyframes.vectorPoints) && layer.keyframes.vectorPoints.length > 0;
      if (hasVecKf && !(window._vectorEditorState && window._vectorEditorState.isDraggingPad)) {
        const pps = window.currentPixelsPerSecond || 80;
        const curSec = (typeof layer._currentSec === 'number') ? layer._currentSec : (Math.abs(window.timelinePanX || 0) / pps);
        const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, curSec) : null;
        if (eff && Array.isArray(eff.vectorPoints)) {
          sProps = Object.assign({}, sProps, { points: eff.vectorPoints });
        }
      }

      if (layer._shapeDirty || hasVecKf || !layer._cachedSPropsKey || layer._cachedSPropsRef !== sProps) {
        layer._cachedSPropsKey = JSON.stringify(sProps);
        layer._cachedSPropsRef = sProps;
      }
      const sPropsKey = layer._cachedSPropsKey;
      const fillKey = (typeof getFillRenderKey === 'function') ? getFillRenderKey(layer) : `${layer.fillType || 'color'}_${layer.fillColor || ''}`;
      const strokeKey = `${sProps.strokeWidth !== undefined ? sProps.strokeWidth : (layer.strokeWidth || 0)}_${sProps.strokeColor || layer.strokeColor || ''}_${sProps.strokeCap || layer.strokeCap || 'round'}`;
      const shapeKey = `${shapeType}_${sPropsKey}_${strokeKey}_${fillKey}_${targetW}_${targetH}`;
      if (!layer._fillDirty && !layer._shapeDirty && targetCanvas._lastShapeKey === shapeKey && targetCanvas.width === targetW && targetCanvas.height === targetH) {
        return targetCanvas;
      }

      const sctx = targetCanvas.getContext('2d');
      if (!sctx) return targetCanvas;

      if (targetCanvas.width !== targetW || targetCanvas.height !== targetH) {
        targetCanvas.width = targetW;
        targetCanvas.height = targetH;
      }

      sctx.clearRect(0, 0, targetW, targetH);

      const shapeProps = sProps;
      const sx = (shapeProps.sizeX !== undefined && shapeProps.sizeX !== null) ? Number(shapeProps.sizeX) : targetW;
      const sy = (shapeProps.sizeY !== undefined && shapeProps.sizeY !== null) ? Number(shapeProps.sizeY) : targetH;
      const cx = targetW / 2;
      const cy = targetH / 2;
      const rx = sx / 2;
      const ry = sy / 2;

      sctx.save();
      sctx.beginPath();

      if (typeof window !== 'undefined' && window.FishShapesRegistry && typeof window.FishShapesRegistry.drawPath === 'function') {
        window.FishShapesRegistry.drawPath(sctx, shapeType, shapeProps, cx, cy, sx, sy);
      } else {
        switch (shapeType) {
        case 'circle': {
          sctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
          break;
        }
        case 'rectangle': {
          let r = Number(shapeProps.roundness);
          if (isNaN(r) || r < 0) r = 0;
          r = Math.min(r, rx, ry);
          if (typeof sctx.roundRect === 'function') {
            sctx.roundRect(cx - rx, cy - ry, sx, sy, r);
          } else {
            sctx.moveTo(cx - rx + r, cy - ry);
            sctx.arcTo(cx + rx, cy - ry, cx + rx, cy + ry, r);
            sctx.arcTo(cx + rx, cy + ry, cx - rx, cy + ry, r);
            sctx.arcTo(cx - rx, cy + ry, cx - rx, cy - ry, r);
            sctx.arcTo(cx - rx, cy - ry, cx + rx, cy - ry, r);
            sctx.closePath();
          }
          break;
        }
        case 'triangle': {
          const step = Math.max(3, parseInt(shapeProps.step || shapeProps.steps, 10) || 3);
          if (step === 3) {
            let r = Number(shapeProps.roundness);
            if (isNaN(r) || r < 0) r = 0;
            if (r <= 0.5) {
              sctx.moveTo(cx, cy - ry);
              sctx.lineTo(cx + rx, cy + ry);
              sctx.lineTo(cx - rx, cy + ry);
              sctx.closePath();
            } else {
              const engine = window.FishToolEngine || window.LayerTransform;
              const pts = engine && typeof engine.getShapeLocalContour === 'function'
                ? engine.getShapeLocalContour(shapeType, shapeProps, sx, sy)
                : [];
              if (pts.length > 0) {
                sctx.moveTo(cx + pts[0].x, cy + pts[0].y);
                for (let i = 1; i < pts.length; i++) {
                  sctx.lineTo(cx + pts[i].x, cy + pts[i].y);
                }
                sctx.closePath();
              } else {
                sctx.moveTo(cx, cy - ry);
                sctx.lineTo(cx + rx, cy + ry);
                sctx.lineTo(cx - rx, cy + ry);
                sctx.closePath();
              }
            }
          } else {
            for (let i = 0; i < step; i++) {
              const a = -Math.PI / 2 + (i / step) * Math.PI * 2;
              const px = cx + Math.cos(a) * rx;
              const py = cy + Math.sin(a) * ry;
              if (i === 0) sctx.moveTo(px, py);
              else sctx.lineTo(px, py);
            }
            sctx.closePath();
          }
          break;
        }
        case 'star': {
          const numPts = Math.max(3, parseInt(shapeProps.points, 10) || 5);
          let inR = Number(shapeProps.innerRadius);
          if (isNaN(inR) || inR <= 0) inR = 0.4;
          inR = Math.max(0.1, Math.min(0.9, inR));
          const total = numPts * 2;
          for (let i = 0; i < total; i++) {
            const a = -Math.PI / 2 + (i / total) * Math.PI * 2;
            const radRatio = (i % 2 === 0) ? 1.0 : inR;
            const px = cx + Math.cos(a) * rx * radRatio;
            const py = cy + Math.sin(a) * ry * radRatio;
            if (i === 0) sctx.moveTo(px, py);
            else sctx.lineTo(px, py);
          }
          sctx.closePath();
          break;
        }
        case 'polygon': {
          const sides = Math.max(3, parseInt(shapeProps.sides, 10) || 6);
          for (let i = 0; i < sides; i++) {
            const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
            const px = cx + Math.cos(a) * rx;
            const py = cy + Math.sin(a) * ry;
            if (i === 0) sctx.moveTo(px, py);
            else sctx.lineTo(px, py);
          }
          sctx.closePath();
          break;
        }
        case 'capsule': {
          const r = Math.min(rx, ry);
          if (typeof sctx.roundRect === 'function') {
            sctx.roundRect(cx - rx, cy - ry, sx, sy, r);
          } else {
            sctx.moveTo(cx - rx + r, cy - ry);
            sctx.arcTo(cx + rx, cy - ry, cx + rx, cy + ry, r);
            sctx.arcTo(cx + rx, cy + ry, cx - rx, cy + ry, r);
            sctx.arcTo(cx - rx, cy + ry, cx - rx, cy - ry, r);
            sctx.arcTo(cx - rx, cy - ry, cx + rx, cy - ry, r);
            sctx.closePath();
          }
          break;
        }
        case 'heart': {
          const segs = 48;
          for (let i = 0; i < segs; i++) {
            const t = (i / segs) * Math.PI * 2;
            const hx = 16 * Math.pow(Math.sin(t), 3);
            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            const px = cx + (hx / 16) * rx;
            const py = cy + ((hy + 2) / 17) * ry;
            if (i === 0) sctx.moveTo(px, py);
            else sctx.lineTo(px, py);
          }
          sctx.closePath();
          break;
        }
        default: {
          sctx.rect(cx - rx, cy - ry, sx, sy);
          break;
        }
        }
      }

      const vPts = isVector && Array.isArray(shapeProps.points) ? shapeProps.points : [];
      const isVectorClosed = isVector && !!shapeProps.closed && vPts.length >= 3;
      const canFill = !isVector || isVectorClosed;

      // Apply Fill (strictly fills path interior)
      const fillType = layer.fillType || 'color';
      if (canFill && fillType !== 'none') {
        if (fillType === 'color') {
          sctx.fillStyle = layer.fillColor || '#98ce7b';
          sctx.fill();
        } else if (fillType === 'gradient' || fillType === 'media') {
          const fillCanvas = getOrUpdateLayerFillCanvas(layer, targetW, targetH);
          sctx.save();
          sctx.clip();
          sctx.drawImage(fillCanvas, 0, 0, targetW, targetH);
          sctx.restore();
        }
      }

      // Apply Stroke (strictly uses strokeWidth, strokeColor, strokeCap)
      const rawStrokeW = (shapeProps.strokeWidth !== undefined)
        ? Number(shapeProps.strokeWidth)
        : (layer.strokeWidth !== undefined ? Number(layer.strokeWidth) : (isVector ? 6 : 0));
      const strokeW = Math.max(0, isNaN(rawStrokeW) ? 0 : rawStrokeW);
      if (strokeW > 0 && (!isVector || vPts.length >= 1)) {
        const strokeCap = shapeProps.strokeCap || layer.strokeCap || 'round';
        sctx.lineCap = strokeCap;
        sctx.lineJoin = strokeCap === 'round' ? 'round' : (strokeCap === 'square' ? 'bevel' : 'miter');
        sctx.lineWidth = strokeW;
        sctx.strokeStyle = shapeProps.strokeColor || layer.strokeColor || '#ffffff';
        sctx.stroke();
      }

      sctx.restore();

      const cachedEntry = window.layerMediaCache ? (window.layerMediaCache.get(layer.id) || (layer.mediaId ? window.layerMediaCache.get(layer.mediaId) : null) || (layer.fillMediaId ? window.layerMediaCache.get(layer.fillMediaId) : null)) : null;
      const isMediaReady = (fillType !== 'media') ||
        (cachedEntry && cachedEntry.el && cachedEntry.isReady) ||
        (layer._fillMediaImg && layer._fillMediaImg.complete && layer._fillMediaImg.naturalWidth > 0);
      if (isMediaReady) {
        targetCanvas._lastShapeKey = shapeKey;
        targetCanvas._contentVersion = (targetCanvas._contentVersion || 0) + 1;
        layer._fillDirty = false;
        layer._shapeDirty = false;
      } else {
        targetCanvas._lastShapeKey = null;
      }

      return targetCanvas;
    }
    window.renderShapeToCanvas = renderShapeToCanvas;

    function updateJogScrubberVisuals(jogEl, val, min, max) {
      if (!jogEl) return;
      if (jogEl._rulerScrubberController && typeof jogEl._rulerScrubberController.setValue === 'function') {
        jogEl._rulerScrubberController.setValue(val, false);
        return;
      }
      const ticksEl = jogEl.querySelector('.jog-wheel-ticks');
      const trackEl = jogEl.querySelector('.effects-pill-track');
      const ratio = (max > min) ? Math.max(0, Math.min(1, (val - min) / (max - min))) : 0;
      if (ticksEl && ticksEl.classList.contains('is-bounded-tape')) {
        const tapeW = parseFloat(ticksEl.dataset.tapeWidth) || 480;
        const offset = -ratio * tapeW;
        ticksEl.style.setProperty('--tape-offset', `${offset.toFixed(1)}px`);
        ticksEl.style.transform = `translateX(${offset.toFixed(1)}px)`;
        ticksEl.style.clipPath = 'none';
      }
      if (trackEl) {
        trackEl.style.width = `${(ratio * 100).toFixed(1)}%`;
      }
    }
    window.updateJogScrubberVisuals = updateJogScrubberVisuals;
    if (window.FishElements) {
      window.FishElements.updateScrubberVisuals = updateJogScrubberVisuals;
    }

    function syncShapeControllerUI() {
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer) return;
      if (layer.shapeType || layer.shapeProps || (layer.id && layer.id.startsWith('layer_shape_'))) {
        layer.type = 'shape';
      }
      const isShape = (layer.type === 'shape');
      const isMediaRoundable = (layer.type === 'image' || layer.type === 'video' || (layer.type === 'precomp' && !layer.collapseTransformations));
      if (!isShape && !isMediaRoundable) return;

      if (isShape && !layer.shapeProps) {
        layer.shapeProps = {
          sizeX: Math.round(Math.abs(layer.scaleW || 300)),
          sizeY: Math.round(Math.abs(layer.scaleH || 300))
        };
      }

      const shapeType = isShape ? (layer.shapeType || 'rectangle') : 'rectangle';
      const shapeProps = isShape ? (layer.shapeProps || {}) : {};

      const shapeDef = (isShape && typeof window !== 'undefined' && window.FishShapesRegistry)
        ? window.FishShapesRegistry.get(shapeType)
        : null;

      const titleEl = document.getElementById('lbl-shape-title');
      if (titleEl) {
        titleEl.textContent = isShape
          ? (shapeDef ? shapeDef.name : (shapeType.charAt(0).toUpperCase() + shapeType.slice(1)))
          : 'Edit Shape';
      }

      const updateScrubberVisuals = updateJogScrubberVisuals;

      // 1. Size section (Shapes with size control only)
      const secSize = document.getElementById('shape-section-size');
      const hasSize = isShape && (shapeDef ? shapeDef.controls.size !== false : shapeType !== 'vector');
      if (secSize) {
        if (hasSize) {
          secSize.style.removeProperty('display');
          secSize.classList.remove('is-hidden');
          secSize.removeAttribute('hidden');

          const valSizeX = document.getElementById('val-shape-size-x');
          const valSizeY = document.getElementById('val-shape-size-y');
          const valSizeLinked = document.getElementById('val-shape-size-linked');
          const curSizeX = Math.round(shapeProps.sizeX || 300);
          const curSizeY = Math.round(shapeProps.sizeY || 300);
          if (valSizeX) valSizeX.textContent = curSizeX;
          if (valSizeY) valSizeY.textContent = curSizeY;
          if (valSizeLinked) valSizeLinked.textContent = curSizeX;

          // Link button & Rulers toggle (Identical to Scale in Transform)
          const linkBtn = document.getElementById('btn-shape-size-link');
          if (linkBtn) {
            linkBtn.classList.toggle('is-active', !!window.isShapeSizeLinked);
            linkBtn.title = window.isShapeSizeLinked
              ? 'Proportions Linked (Click to Unlink)'
              : 'Independent Dimensions (Click to Link)';
            linkBtn.setAttribute('aria-label', linkBtn.title);
            const iconOn = linkBtn.querySelector('.svg-link-on');
            const iconOff = linkBtn.querySelector('.svg-link-off');
            if (iconOn) iconOn.style.display = window.isShapeSizeLinked ? '' : 'none';
            if (iconOff) iconOff.style.display = window.isShapeSizeLinked ? 'none' : '';
          }
          const singleJog = document.getElementById('jog-shape-size-linked');
          const dualJog = document.getElementById('jog-shape-size-unlinked');
          if (singleJog) {
            if (window.isShapeSizeLinked) {
              singleJog.style.removeProperty('display');
              singleJog.classList.remove('is-hidden');
              singleJog.removeAttribute('hidden');
            } else {
              singleJog.style.setProperty('display', 'none', 'important');
              singleJog.classList.add('is-hidden');
              singleJog.setAttribute('hidden', '');
            }
          }
          if (dualJog) {
            if (!window.isShapeSizeLinked) {
              dualJog.style.removeProperty('display');
              dualJog.classList.remove('is-hidden');
              dualJog.removeAttribute('hidden');
            } else {
              dualJog.style.setProperty('display', 'none', 'important');
              dualJog.classList.add('is-hidden');
              dualJog.setAttribute('hidden', '');
            }
          }

          updateScrubberVisuals(singleJog, curSizeX, 10, 3840);
          updateScrubberVisuals(document.getElementById('jog-shape-size-x'), curSizeX, 10, 3840);
          updateScrubberVisuals(document.getElementById('jog-shape-size-y'), curSizeY, 10, 3840);
        } else {
          secSize.style.setProperty('display', 'none', 'important');
          secSize.classList.add('is-hidden');
          secSize.setAttribute('hidden', '');
        }
      }

      // 2. Roundness section (Shapes with roundness or Images/Videos/Precomps)
      const secRound = document.getElementById('shape-section-roundness');
      const hasRound = isShape
        ? (shapeDef ? !!shapeDef.controls.roundness : (shapeType === 'rectangle' || shapeType === 'triangle'))
        : isMediaRoundable;
      if (secRound) {
        if (hasRound) {
          secRound.style.removeProperty('display');
          secRound.classList.remove('is-hidden');
          secRound.removeAttribute('hidden');

          const valRound = document.getElementById('val-shape-roundness');
          const curRound = Math.round(isShape ? (shapeProps.roundness || 0) : (layer.roundness || 0));
          if (valRound) valRound.textContent = curRound;
          const curW = isShape ? (shapeProps.sizeX || 300) : Math.abs(layer.scaleW || layer.mediaWidth || 300);
          const curH = isShape ? (shapeProps.sizeY || 300) : Math.abs(layer.scaleH || layer.mediaHeight || 300);
          const maxR = Math.min(curW, curH) / 2;
          updateScrubberVisuals(document.getElementById('jog-shape-roundness'), curRound, 0, maxR);
        } else {
          secRound.style.setProperty('display', 'none', 'important');
          secRound.classList.add('is-hidden');
          secRound.setAttribute('hidden', '');
        }
      }

      // 3. Step section
      const secStep = document.getElementById('shape-section-step');
      const hasStep = isShape && (shapeDef
        ? !!shapeDef.controls.step
        : (shapeType === 'triangle' || shapeType === 'polygon'));
      if (secStep) {
        if (hasStep) {
          secStep.style.removeProperty('display');
          secStep.classList.remove('is-hidden');
          secStep.removeAttribute('hidden');
          const stepLabel = (shapeDef && shapeDef.controls && shapeDef.controls.step && shapeDef.controls.step.label)
            ? shapeDef.controls.step.label
            : ((shapeType === 'polygon') ? 'Sides' : 'Step');
          const lblStep = document.getElementById('lbl-shape-step');
          if (lblStep) lblStep.textContent = stepLabel;
          const valStep = document.getElementById('val-shape-step');
          const curStep = (shapeType === 'polygon') ? (shapeProps.sides || 6) : (shapeProps.step || 3);
          if (valStep) valStep.textContent = curStep;
          updateScrubberVisuals(document.getElementById('jog-shape-step'), curStep, 3, 24);
        } else {
          secStep.style.setProperty('display', 'none', 'important');
          secStep.classList.add('is-hidden');
          secStep.setAttribute('hidden', '');
        }
      }

      // 4. Star section
      const secStar = document.getElementById('shape-section-star');
      const isStar = isShape && (shapeDef
        ? !!shapeDef.controls.star
        : (shapeType === 'star'));
      if (secStar) {
        if (isStar) {
          secStar.style.removeProperty('display');
          secStar.classList.remove('is-hidden');
          secStar.removeAttribute('hidden');
          const valPts = document.getElementById('val-shape-points');
          const curPts = shapeProps.points || 5;
          if (valPts) valPts.textContent = curPts;
          updateScrubberVisuals(document.getElementById('jog-shape-points'), curPts, 3, 24);

          const inRPercent = Math.round((shapeProps.innerRadius !== undefined ? shapeProps.innerRadius : 0.4) * 100);
          const valInR = document.getElementById('val-shape-inner-radius');
          if (valInR) valInR.textContent = `${inRPercent}%`;
          updateScrubberVisuals(document.getElementById('jog-shape-inner-radius'), inRPercent, 5, 95);
        } else {
          secStar.style.setProperty('display', 'none', 'important');
          secStar.classList.add('is-hidden');
          secStar.setAttribute('hidden', '');
        }
      }

      // 5. Convert to Vector action section (visible for all preset shapes except already-vector shapes)
      const secConvertVec = document.getElementById('shape-section-convert-vector');
      const canConvertVec = isShape && shapeType !== 'vector';
      if (secConvertVec) {
        if (canConvertVec) {
          secConvertVec.style.removeProperty('display');
          secConvertVec.classList.remove('is-hidden');
          secConvertVec.removeAttribute('hidden');
        } else {
          secConvertVec.style.setProperty('display', 'none', 'important');
          secConvertVec.classList.add('is-hidden');
          secConvertVec.setAttribute('hidden', '');
        }
      }
    }
    window.syncShapeControllerUI = syncShapeControllerUI;

    function initShapeController() {
      let _lastShapeX = 300;
      let _lastShapeY = 300;

      function updateShapeSize(newX, newY, commit = false) {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!layer || layer.type !== 'shape') return;
        if (!layer.shapeProps) layer.shapeProps = {};

        const prevSizeX = Number(layer.shapeProps.sizeX) || 300;
        const prevSizeY = Number(layer.shapeProps.sizeY) || 300;
        layer.shapeProps.sizeX = newX;
        layer.shapeProps.sizeY = newY;
        _lastShapeX = newX;
        _lastShapeY = newY;

        // Edit Shape Size and Transform Scale are 2 decoupled properties:
        // Transform scale factor represents the layer's world transform multiplier (scaleW / sizeX)
        const factorX = (typeof layer.transformScaleX === 'number' && !isNaN(layer.transformScaleX) && layer.transformScaleX > 0)
          ? layer.transformScaleX
          : (layer.scaleW && prevSizeX && Math.abs(layer.scaleW - prevSizeX) > 1 ? (layer.scaleW / prevSizeX) : 1.0);
        const factorY = (typeof layer.transformScaleY === 'number' && !isNaN(layer.transformScaleY) && layer.transformScaleY > 0)
          ? layer.transformScaleY
          : (layer.scaleH && prevSizeY && Math.abs(layer.scaleH - prevSizeY) > 1 ? (layer.scaleH / prevSizeY) : 1.0);

        layer.transformScaleX = factorX;
        layer.transformScaleY = factorY;

        layer.scaleW = Math.round(newX * factorX);
        layer.scaleH = Math.round(newY * factorY);
        layer.mediaWidth = newX;
        layer.mediaHeight = newY;
        layer._userResized = true;

        const baseW = (currentProjectState && currentProjectState.canvasWidth) ? currentProjectState.canvasWidth : 1080;
        const baseH = (currentProjectState && currentProjectState.canvasHeight) ? currentProjectState.canvasHeight : 1920;
        layer.normW = layer.scaleW / baseW;
        layer.normH = layer.scaleH / baseH;
        layer.normX = (layer.posX - layer.scaleW / 2) / baseW;
        layer.normY = (layer.posY - layer.scaleH / 2) / baseH;
        layer._shapeDirty = true;
        layer._fillDirty = true;
        if (layer._shapeBufferCanvas) {
          layer._shapeBufferCanvas._lastShapeKey = null;
        }
        if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);

        if (commit) {
          if (typeof recordLayerPropertyChange === 'function') {
            recordLayerPropertyChange(layer, 'shape');
          }
          syncShapeControllerUI();
          redrawComposition();
          if (typeof saveCurrentProjectLayers === 'function') {
            saveCurrentProjectLayers();
          }
        } else {
          const valX = document.getElementById('val-shape-size-x');
          const valY = document.getElementById('val-shape-size-y');
          const valLinked = document.getElementById('val-shape-size-linked');
          if (valX) valX.textContent = Math.round(newX);
          if (valY) valY.textContent = Math.round(newY);
          if (valLinked) valLinked.textContent = Math.round(newX);

          updateJogScrubberVisuals(document.getElementById('jog-shape-size-linked'), newX, 10, 3840);
          updateJogScrubberVisuals(document.getElementById('jog-shape-size-x'), newX, 10, 3840);
          updateJogScrubberVisuals(document.getElementById('jog-shape-size-y'), newY, 10, 3840);

          if (!window._shapeRedrawRafPending) {
            window._shapeRedrawRafPending = true;
            requestAnimationFrame(() => {
              window._shapeRedrawRafPending = false;
              redrawComposition();
            });
          }
        }
      }

      function updateShapeOtherProp(propKeyOrLayer, valueOrKey, commitOrVal = false, maybeCommit = false) {
        let layer, propKey, value, commit;
        if (propKeyOrLayer && typeof propKeyOrLayer === 'object') {
          layer = propKeyOrLayer;
          propKey = valueOrKey;
          value = commitOrVal;
          commit = !!maybeCommit;
        } else {
          layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          propKey = propKeyOrLayer;
          value = valueOrKey;
          commit = !!commitOrVal;
        }
        if (!layer) return;
        const isShape = (layer.type === 'shape');
        const isMediaRoundable = (layer.type === 'image' || layer.type === 'video' || (layer.type === 'precomp' && !layer.collapseTransformations));
        if (!isShape && !isMediaRoundable) return;

        if (isShape) {
          if (!layer.shapeProps) layer.shapeProps = {};
          layer.shapeProps[propKey] = value;
        } else if (propKey === 'roundness') {
          layer.roundness = value;
        }
        layer._shapeDirty = true;
        layer._fillDirty = true;
        if (layer._shapeBufferCanvas) {
          layer._shapeBufferCanvas._lastShapeKey = null;
        }
        if (layer._precompBufferCanvas) {
          layer._precompBufferCanvas._lastRenderKey = null;
        }
        if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);

        if (commit) {
          if (typeof recordLayerPropertyChange === 'function') {
            recordLayerPropertyChange(layer, isShape ? 'shape' : 'roundness');
          }
          syncShapeControllerUI();
          redrawComposition();
          if (typeof saveCurrentProjectLayers === 'function') {
            saveCurrentProjectLayers();
          }
        } else {
          if (propKey === 'roundness') {
            const valRound = document.getElementById('val-shape-roundness');
            if (valRound) valRound.textContent = Math.round(value);
            const curW = isShape ? (layer.shapeProps?.sizeX || 300) : Math.abs(layer.scaleW || layer.mediaWidth || 300);
            const curH = isShape ? (layer.shapeProps?.sizeY || 300) : Math.abs(layer.scaleH || layer.mediaHeight || 300);
            const maxR = Math.min(curW, curH) / 2;
            updateJogScrubberVisuals(document.getElementById('jog-shape-roundness'), value, 0, maxR);
          } else if (propKey === 'step' || propKey === 'sides') {
            const valStep = document.getElementById('val-shape-step');
            if (valStep) valStep.textContent = Math.round(value);
            updateJogScrubberVisuals(document.getElementById('jog-shape-step'), value, 3, 24);
          } else if (propKey === 'points') {
            const valPts = document.getElementById('val-shape-points');
            if (valPts) valPts.textContent = Math.round(value);
            updateJogScrubberVisuals(document.getElementById('jog-shape-points'), value, 3, 24);
          } else if (propKey === 'innerRadius') {
            const valInR = document.getElementById('val-shape-inner-radius');
            if (valInR) valInR.textContent = `${Math.round(value * 100)}%`;
            updateJogScrubberVisuals(document.getElementById('jog-shape-inner-radius'), value, 0.05, 0.95);
          }

          if (!window._shapeRedrawRafPending) {
            window._shapeRedrawRafPending = true;
            requestAnimationFrame(() => {
              window._shapeRedrawRafPending = false;
              redrawComposition();
            });
          }
        }
      }
      window.updateShapeSize = updateShapeSize;
      window.updateShapeOtherProp = updateShapeOtherProp;

      // 1. Link toggle
      const linkBtn = document.getElementById('btn-shape-size-link');
      if (linkBtn) {
        linkBtn.addEventListener('click', (e) => {
          e.preventDefault();
          window.isShapeSizeLinked = !window.isShapeSizeLinked;
          syncShapeControllerUI();
        });
      }

      // 2. Scale Linked Jog Wheel Ruler (#jog-shape-size-linked)
      let shapeLinkedInit = null;
      bindJogWheel(document.getElementById('jog-shape-size-linked'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          if (!layer.shapeProps) layer.shapeProps = {};
          const initX = Number(layer.shapeProps.sizeX) || 300;
          const initY = Number(layer.shapeProps.sizeY) || 300;
          const ratio = (initX > 0) ? (initY / initX) : 1;
          shapeLinkedInit = { initX, initY, ratio };
          _lastShapeX = initX;
          _lastShapeY = initY;
        },
        onMove: (rawDelta, e) => {
          if (!shapeLinkedInit) return;
          const { initX, ratio } = shapeLinkedInit;
          const speed = (e && e.shiftKey) ? 0.2 : ((e && e.altKey) ? 3.0 : 1.0);
          const newX = Math.max(10, Math.min(3840, Math.round(initX - rawDelta * speed)));
          const newY = Math.max(10, Math.min(3840, Math.round(newX * ratio)));
          updateShapeSize(newX, newY, false);
        },
        onEnd: () => {
          shapeLinkedInit = null;
          updateShapeSize(_lastShapeX, _lastShapeY, true);
        }
      });

      // 3. Unlinked Jog Size X (#jog-shape-size-x)
      let initSizeX = 300;
      let initSizeY = 300;
      bindJogWheel(document.getElementById('jog-shape-size-x'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          initSizeX = Number(layer.shapeProps?.sizeX) || 300;
          initSizeY = Number(layer.shapeProps?.sizeY) || 300;
          _lastShapeX = initSizeX;
          _lastShapeY = initSizeY;
        },
        onMove: (rawDelta, e) => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          const speed = (e && e.shiftKey) ? 0.2 : ((e && e.altKey) ? 3.0 : 1.0);
          const newX = Math.max(10, Math.min(3840, Math.round(initSizeX - rawDelta * speed)));
          const newY = Number(layer.shapeProps?.sizeY) || initSizeY;
          updateShapeSize(newX, newY, false);
        },
        onEnd: () => {
          updateShapeSize(_lastShapeX, _lastShapeY, true);
        }
      });

      // 4. Unlinked Jog Size Y (#jog-shape-size-y)
      bindJogWheel(document.getElementById('jog-shape-size-y'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          initSizeX = Number(layer.shapeProps?.sizeX) || 300;
          initSizeY = Number(layer.shapeProps?.sizeY) || 300;
          _lastShapeX = initSizeX;
          _lastShapeY = initSizeY;
        },
        onMove: (rawDelta, e) => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          const speed = (e && e.shiftKey) ? 0.2 : ((e && e.altKey) ? 3.0 : 1.0);
          const newY = Math.max(10, Math.min(3840, Math.round(initSizeY - rawDelta * speed)));
          const newX = Number(layer.shapeProps?.sizeX) || initSizeX;
          updateShapeSize(newX, newY, false);
        },
        onEnd: () => {
          updateShapeSize(_lastShapeX, _lastShapeY, true);
        }
      });

      // 5. Jog Roundness
      let initRound = 0;
      let lastRound = 0;
      bindJogWheel(document.getElementById('jog-shape-roundness'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          const isShape = (layer.type === 'shape');
          const isMediaRoundable = (layer.type === 'image' || layer.type === 'video' || (layer.type === 'precomp' && !layer.collapseTransformations));
          if (!isShape && !isMediaRoundable) return;
          initRound = isShape ? (Number(layer.shapeProps?.roundness) || 0) : (Number(layer.roundness) || 0);
          lastRound = initRound;
        },
        onMove: (rawDelta, e) => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          const isShape = (layer.type === 'shape');
          const isMediaRoundable = (layer.type === 'image' || layer.type === 'video' || (layer.type === 'precomp' && !layer.collapseTransformations));
          if (!isShape && !isMediaRoundable) return;
          const curW = isShape ? (layer.shapeProps?.sizeX || 300) : Math.abs(layer.scaleW || layer.mediaWidth || 300);
          const curH = isShape ? (layer.shapeProps?.sizeY || 300) : Math.abs(layer.scaleH || layer.mediaHeight || 300);
          const maxR = Math.min(curW, curH) / 2;
          const speed = (e && e.shiftKey) ? 0.2 : ((e && e.altKey) ? 2.5 : 1.0);
          const rate = (maxR > 0) ? (maxR / 480) : 0.5;
          const newR = Math.max(0, Math.min(maxR, Math.round(initRound - rawDelta * rate * speed)));
          lastRound = newR;
          updateShapeOtherProp('roundness', newR, false);
        },
        onEnd: () => {
          updateShapeOtherProp('roundness', lastRound, true);
        }
      });

      // 6. Jog Step / Sides
      let initStep = 3;
      let lastStep = 3;
      bindJogWheel(document.getElementById('jog-shape-step'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          initStep = (layer.shapeType === 'polygon') ? (Number(layer.shapeProps?.sides) || 6) : (Number(layer.shapeProps?.step) || 3);
          lastStep = initStep;
        },
        onMove: (rawDelta, e) => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          const speed = (e && e.shiftKey) ? 0.2 : ((e && e.altKey) ? 2.5 : 1.0);
          const rate = 21 / 480;
          const newStep = Math.max(3, Math.min(24, Math.round(initStep - rawDelta * rate * speed)));
          lastStep = newStep;
          const propKey = (layer.shapeType === 'polygon') ? 'sides' : 'step';
          updateShapeOtherProp(propKey, newStep, false);
        },
        onEnd: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          const propKey = (layer && layer.shapeType === 'polygon') ? 'sides' : 'step';
          updateShapeOtherProp(propKey, lastStep, true);
        }
      });

      // 7. Jog Star Points
      let initPts = 5;
      let lastPts = 5;
      bindJogWheel(document.getElementById('jog-shape-points'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          initPts = Number(layer.shapeProps?.points) || 5;
          lastPts = initPts;
        },
        onMove: (rawDelta, e) => {
          const speed = (e && e.shiftKey) ? 0.2 : ((e && e.altKey) ? 2.5 : 1.0);
          const rate = 21 / 480;
          const newPts = Math.max(3, Math.min(24, Math.round(initPts - rawDelta * rate * speed)));
          lastPts = newPts;
          updateShapeOtherProp('points', newPts, false);
        },
        onEnd: () => {
          updateShapeOtherProp('points', lastPts, true);
        }
      });

      // 8. Jog Star Inner Radius
      let initInR = 0.4;
      let lastInR = 0.4;
      bindJogWheel(document.getElementById('jog-shape-inner-radius'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          initInR = (layer.shapeProps?.innerRadius !== undefined) ? Number(layer.shapeProps.innerRadius) : 0.4;
          lastInR = initInR;
        },
        onMove: (rawDelta, e) => {
          const speed = (e && e.shiftKey) ? 0.2 : ((e && e.altKey) ? 2.5 : 1.0);
          const rate = 0.90 / 480;
          const newInR = Math.max(0.05, Math.min(0.95, Number((initInR - rawDelta * rate * speed).toFixed(2))));
          lastInR = newInR;
          updateShapeOtherProp('innerRadius', newInR, false);
        },
        onEnd: () => {
          updateShapeOtherProp('innerRadius', lastInR, true);
        }
      });

      // 9. Direct Value Input Popovers for Shape Parameters (.shape-param-pill-val)
      function openShapeValueInput(badgeEl, options) {
        if (!badgeEl) return;
        if (typeof window.openValueInputPopover === 'function') {
          window.openValueInputPopover(badgeEl, options);
        } else {
          const res = prompt(options.title || 'Enter value', options.value);
          if (res !== null && !isNaN(parseFloat(res))) {
            if (options.onCommit) options.onCommit(parseFloat(res));
          }
        }
      }

      const valSizeLinkedEl = document.getElementById('val-shape-size-linked');
      if (valSizeLinkedEl) {
        valSizeLinkedEl.title = 'Click to edit value';
        valSizeLinkedEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          const curVal = Math.round(layer.shapeProps?.sizeX || 300);
          openShapeValueInput(valSizeLinkedEl, {
            title: 'Size',
            value: curVal,
            defaultValue: 300,
            min: 10,
            max: 3840,
            step: 1,
            unit: 'px',
            onCommit: (newVal) => {
              const initX = Number(layer.shapeProps?.sizeX) || 300;
              const initY = Number(layer.shapeProps?.sizeY) || 300;
              const ratio = (initX > 0) ? (initY / initX) : 1;
              const newX = Math.max(10, Math.min(3840, Math.round(newVal)));
              const newY = Math.max(10, Math.min(3840, Math.round(newX * ratio)));
              updateShapeSize(newX, newY, true);
            }
          });
        });
      }

      const valSizeXEl = document.getElementById('val-shape-size-x');
      if (valSizeXEl) {
        valSizeXEl.title = 'Click to edit value';
        valSizeXEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          const curVal = Math.round(layer.shapeProps?.sizeX || 300);
          openShapeValueInput(valSizeXEl, {
            title: 'Size X',
            value: curVal,
            defaultValue: 300,
            min: 10,
            max: 3840,
            step: 1,
            unit: 'px',
            onCommit: (newVal) => {
              const curY = Number(layer.shapeProps?.sizeY) || 300;
              const newX = Math.max(10, Math.min(3840, Math.round(newVal)));
              updateShapeSize(newX, curY, true);
            }
          });
        });
      }

      const valSizeYEl = document.getElementById('val-shape-size-y');
      if (valSizeYEl) {
        valSizeYEl.title = 'Click to edit value';
        valSizeYEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          const curVal = Math.round(layer.shapeProps?.sizeY || 300);
          openShapeValueInput(valSizeYEl, {
            title: 'Size Y',
            value: curVal,
            defaultValue: 300,
            min: 10,
            max: 3840,
            step: 1,
            unit: 'px',
            onCommit: (newVal) => {
              const curX = Number(layer.shapeProps?.sizeX) || 300;
              const newY = Math.max(10, Math.min(3840, Math.round(newVal)));
              updateShapeSize(curX, newY, true);
            }
          });
        });
      }

      const valRoundEl = document.getElementById('val-shape-roundness');
      if (valRoundEl) {
        valRoundEl.title = 'Click to edit value';
        valRoundEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer) return;
          const isShape = (layer.type === 'shape');
          const isMediaRoundable = (layer.type === 'image' || layer.type === 'video' || (layer.type === 'precomp' && !layer.collapseTransformations));
          if (!isShape && !isMediaRoundable) return;
          const curVal = Math.round(isShape ? (layer.shapeProps?.roundness || 0) : (layer.roundness || 0));
          const curW = isShape ? (layer.shapeProps?.sizeX || 300) : Math.abs(layer.scaleW || layer.mediaWidth || 300);
          const curH = isShape ? (layer.shapeProps?.sizeY || 300) : Math.abs(layer.scaleH || layer.mediaHeight || 300);
          const maxR = Math.min(curW, curH) / 2;
          openShapeValueInput(valRoundEl, {
            title: 'Roundness',
            value: curVal,
            defaultValue: 0,
            min: 0,
            max: maxR,
            step: 1,
            unit: 'px',
            onCommit: (newVal) => {
              updateShapeOtherProp('roundness', Math.max(0, Math.min(maxR, Math.round(newVal))), true);
            }
          });
        });
      }

      const valStepEl = document.getElementById('val-shape-step');
      if (valStepEl) {
        valStepEl.title = 'Click to edit value';
        valStepEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          const isPolygon = (layer.shapeType === 'polygon');
          const curVal = isPolygon ? (Number(layer.shapeProps?.sides) || 6) : (Number(layer.shapeProps?.step) || 3);
          openShapeValueInput(valStepEl, {
            title: isPolygon ? 'Sides' : 'Step',
            value: curVal,
            defaultValue: isPolygon ? 6 : 3,
            min: 3,
            max: 24,
            step: 1,
            onCommit: (newVal) => {
              const propKey = isPolygon ? 'sides' : 'step';
              updateShapeOtherProp(propKey, Math.max(3, Math.min(24, Math.round(newVal))), true);
            }
          });
        });
      }

      const valPtsEl = document.getElementById('val-shape-points');
      if (valPtsEl) {
        valPtsEl.title = 'Click to edit value';
        valPtsEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          const curVal = Number(layer.shapeProps?.points) || 5;
          openShapeValueInput(valPtsEl, {
            title: 'Points',
            value: curVal,
            defaultValue: 5,
            min: 3,
            max: 24,
            step: 1,
            onCommit: (newVal) => {
              updateShapeOtherProp('points', Math.max(3, Math.min(24, Math.round(newVal))), true);
            }
          });
        });
      }

      const valInREl = document.getElementById('val-shape-inner-radius');
      if (valInREl) {
        valInREl.title = 'Click to edit value';
        valInREl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'shape') return;
          const curRatio = (layer.shapeProps?.innerRadius !== undefined) ? Number(layer.shapeProps.innerRadius) : 0.4;
          const curPercent = Math.round(curRatio * 100);
          openShapeValueInput(valInREl, {
            title: 'Inner Depth',
            value: curPercent,
            defaultValue: 40,
            min: 5,
            max: 95,
            step: 1,
            unit: '%',
            onCommit: (newVal) => {
              const ratio = Math.max(0.05, Math.min(0.95, Number((newVal / 100).toFixed(2))));
              updateShapeOtherProp('innerRadius', ratio, true);
            }
          });
        });
      }
    }
    window.initShapeController = initShapeController;

    // ==========================================================================
    // SUBVIEW 14: EDIT VECTOR CONTROLLER & SHAPE-TO-VECTOR CONVERTER
    // ==========================================================================
    if (!window._vectorEditorState) {
      window._vectorEditorState = {
        target: 'new', // 'new' | integer point index (0..N-1) | continuous segment float (i + t)
        scrubberPos: 0, // continuous real-valued position along infinite looping zig-zag strip
        tool: 'point', // 'point' | 'curve' | 'stroke'
        curveSubMode: 'both', // 'both' | 'out' | 'in'
        cursorX: 0,
        cursorY: 0,
        isDraggingPad: false,
        isScrubbing: false
      };
    }

    const VECTOR_SEG_H = 48;
    const VECTOR_GAP_UNITS = 1.6;
    const VECTOR_X_LEFT = 14;
    const VECTOR_X_RIGHT = 40;
    const VECTOR_MAGNET_SNAP = 0.14;

    function getVectorCycleUnits(points) {
      const pts = Array.isArray(points) ? points : [];
      if (pts.length === 0) return 1;
      return pts.length + VECTOR_GAP_UNITS;
    }

    function resolveVectorTargetState(points, closed, target) {
      const pts = Array.isArray(points) ? points : [];
      if (pts.length === 0 || target === 'new') {
        return { kind: 'new', value: 'new', canonicalPos: pts.length };
      }
      if (typeof target === 'number' && !isNaN(target)) {
        const n = pts.length;
        const idxFloor = ((Math.floor(target) % n) + n) % n;
        const frac = target - Math.floor(target);
        const canSubdivideSeg = n >= 2 && (closed || idxFloor < n - 1);
        if (!canSubdivideSeg || frac <= 0.002 || frac >= 0.998) {
          const ptIdx = ((Math.round(target) % n) + n) % n;
          return {
            kind: 'point',
            value: ptIdx,
            pointIndex: ptIdx,
            canonicalPos: ptIdx
          };
        }
        const cleanT = Number(Math.max(0.02, Math.min(0.98, frac)).toFixed(3));
        return {
          kind: 'mid',
          value: Number((idxFloor + cleanT).toFixed(3)),
          segStart: idxFloor,
          segEnd: (idxFloor + 1) % n,
          t: cleanT,
          canonicalPos: idxFloor + cleanT
        };
      }
      return { kind: 'new', value: 'new', canonicalPos: pts.length };
    }
    window.resolveVectorTargetState = resolveVectorTargetState;

    function getVectorScrubberSlots(points, closed) {
      const pts = Array.isArray(points) ? points : [];
      const slots = [
        { value: 'new', kind: 'new' }
      ];
      for (let i = 0; i < pts.length; i++) {
        slots.push({
          value: i,
          kind: 'point',
          pointIndex: i
        });
        if (i < pts.length - 1) {
          slots.push({
            value: i + 0.5,
            kind: 'mid',
            segStart: i,
            segEnd: i + 1,
            t: 0.5
          });
        } else if (closed && pts.length >= 2) {
          slots.push({
            value: i + 0.5,
            kind: 'mid',
            segStart: i,
            segEnd: 0,
            t: 0.5
          });
        }
      }
      return slots;
    }
    window.getVectorScrubberSlots = getVectorScrubberSlots;

    function convertShapeLayerToVector(targetLayer) {
      const layer = targetLayer || (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer || layer.type !== 'shape' || layer.shapeType === 'vector') return false;

      const origType = layer.shapeType || 'rectangle';
      const origProps = layer.shapeProps || {};
      const origSizeX = Number(origProps.sizeX) || 300;
      const origSizeY = Number(origProps.sizeY) || 300;

      const pts = (typeof window.buildVectorPointsFromPresetShape === 'function')
        ? window.buildVectorPointsFromPresetShape(origType, origProps, origSizeX, origSizeY)
        : [
            { x: -origSizeX / 2, y: -origSizeY / 2, inX: 0, inY: 0, outX: 0, outY: 0 },
            { x: origSizeX / 2, y: -origSizeY / 2, inX: 0, inY: 0, outX: 0, outY: 0 },
            { x: origSizeX / 2, y: origSizeY / 2, inX: 0, inY: 0, outX: 0, outY: 0 },
            { x: -origSizeX / 2, y: origSizeY / 2, inX: 0, inY: 0, outX: 0, outY: 0 }
          ];

      const factorX = (typeof layer.transformScaleX === 'number' && !isNaN(layer.transformScaleX) && layer.transformScaleX > 0)
        ? layer.transformScaleX
        : (layer.scaleW && origSizeX && Math.abs(layer.scaleW - origSizeX) > 1 ? (layer.scaleW / origSizeX) : 1.0);
      const factorY = (typeof layer.transformScaleY === 'number' && !isNaN(layer.transformScaleY) && layer.transformScaleY > 0)
        ? layer.transformScaleY
        : (layer.scaleH && origSizeY && Math.abs(layer.scaleH - origSizeY) > 1 ? (layer.scaleH / origSizeY) : 1.0);

      const aspect = currentProjectState.aspectRatio || '16:9';
      const res = currentProjectState.resolution || '1080p';
      const baseDims = window.getProjectDimensions ? window.getProjectDimensions(res, aspect) : [1080, 1920];
      const baseW = (currentProjectState.width && currentProjectState.width > 0) ? currentProjectState.width : baseDims[0];
      const baseH = (currentProjectState.height && currentProjectState.height > 0) ? currentProjectState.height : baseDims[1];

      const initStrokeW = (origProps.strokeWidth !== undefined) ? Number(origProps.strokeWidth) : (Number(layer.strokeWidth) || 0);
      const initStrokeColor = origProps.strokeColor || layer.strokeColor || '#ffffff';
      const initStrokeCap = origProps.strokeCap || layer.strokeCap || 'round';

      layer.shapeType = 'vector';
      layer.shapeProps = {
        ...origProps,
        sizeX: origSizeX,
        sizeY: origSizeY,
        points: pts,
        closed: true,
        strokeWidth: initStrokeW,
        strokeColor: initStrokeColor,
        strokeCap: initStrokeCap
      };
      layer.strokeWidth = initStrokeW;
      layer.strokeColor = initStrokeColor;
      layer.strokeCap = initStrokeCap;
      layer.transformScaleX = factorX;
      layer.transformScaleY = factorY;
      if (typeof window.syncVectorLayerBounds === 'function') {
        window.syncVectorLayerBounds(layer, true);
      } else {
        layer.scaleW = Math.round(origSizeX * factorX);
        layer.scaleH = Math.round(origSizeY * factorY);
        layer.mediaWidth = origSizeX;
        layer.mediaHeight = origSizeY;
      }
      layer._userResized = true;

      layer.normW = layer.scaleW / baseW;
      layer.normH = layer.scaleH / baseH;
      layer.normX = (layer.posX - layer.scaleW / 2) / baseW;
      layer.normY = (layer.posY - layer.scaleH / 2) / baseH;

      const registry = window.FishShapesRegistry;
      if (registry && typeof registry.renderSvg === 'function') {
        layer.svgIcon = registry.renderSvg('vector');
      }

      if (window._vectorEditorState) {
        window._vectorEditorState.target = pts.length > 0 ? 0 : 'new';
        window._vectorEditorState.scrubberPos = 0;
        window._vectorEditorState.tool = 'point';
      }

      layer._shapeDirty = true;
      layer._fillDirty = true;
      if (layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
      saveCurrentProjectLayers(true);
      renderTimelineLayers();
      redrawComposition();

      const btnEditShape = document.getElementById('btn-layer-edit-shape');
      const btnEditVector = document.getElementById('btn-layer-edit-vector');
      if (btnEditShape) btnEditShape.style.display = 'none';
      if (btnEditVector) btnEditVector.style.display = 'inline-flex';

      if (typeof switchLayerDrawerSubview === 'function') {
        switchLayerDrawerSubview('vector');
      }
      return true;
    }
    window.convertShapeLayerToVector = convertShapeLayerToVector;

    function updateVectorKeyframeBtnState() {
      const btnKf = document.getElementById('btn-vector-keyframe');
      if (!btnKf) return;
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer || layer.type !== 'shape' || layer.shapeType !== 'vector') {
        btnKf.classList.remove('is-keyframed', 'has-keyframe-track');
        return;
      }
      const kfs = layer.keyframes && Array.isArray(layer.keyframes.vectorPoints) ? layer.keyframes.vectorPoints : [];
      const pps = window.currentPixelsPerSecond || 80;
      const currentSec = Math.abs(window.timelinePanX || 0) / pps;
      const hasTrack = kfs.length > 0;
      const atCurrent = kfs.some(k => Math.abs((Number(k.time) || 0) - currentSec) <= 0.04);
      btnKf.classList.toggle('has-keyframe-track', hasTrack);
      btnKf.classList.toggle('is-keyframed', atCurrent);
    }
    window.updateVectorKeyframeBtnState = updateVectorKeyframeBtnState;

    function syncVectorControllerUI() {
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer || layer.type !== 'shape' || layer.shapeType !== 'vector') return;
      if (!layer.shapeProps) layer.shapeProps = {};
      if (!Array.isArray(layer.shapeProps.points)) layer.shapeProps.points = [];

      const pts = layer.shapeProps.points;
      const closed = !!layer.shapeProps.closed;
      const state = window._vectorEditorState;
      const cycleUnits = getVectorCycleUnits(pts);
      const activeSlot = resolveVectorTargetState(pts, closed, state.target);
      state.target = activeSlot.value;

      if (!state.isScrubbing) {
        if (typeof state.scrubberPos !== 'number' || isNaN(state.scrubberPos)) {
          state.scrubberPos = activeSlot.canonicalPos;
        } else {
          const turns = Math.round((state.scrubberPos - activeSlot.canonicalPos) / cycleUnits);
          state.scrubberPos = turns * cycleUnits + activeSlot.canonicalPos;
        }
      }

      // Switch between Pane 1 (Touchpad + Right Slide Pad) and Pane 2 (Stroke Settings)
      const isStrokePane = (state.tool === 'stroke');
      const paneEdit = document.getElementById('pane-vector-edit');
      const paneStroke = document.getElementById('pane-vector-stroke');
      if (paneEdit) paneEdit.classList.toggle('is-active', !isStrokePane);
      if (paneStroke) paneStroke.classList.toggle('is-active', isStrokePane);

      // Determine displayed X / Y values
      let dispX = state.cursorX || 0;
      let dispY = state.cursorY || 0;
      if (activeSlot.kind === 'point') {
        const pt = pts[activeSlot.pointIndex];
        if (pt) {
          if (state.tool === 'curve') {
            if (state.curveSubMode === 'in') {
              dispX = Number(pt.inX) || 0;
              dispY = Number(pt.inY) || 0;
            } else {
              dispX = Number(pt.outX) || 0;
              dispY = Number(pt.outY) || 0;
            }
          } else {
            dispX = Number(pt.x) || 0;
            dispY = Number(pt.y) || 0;
          }
        }
      } else if (activeSlot.kind === 'mid') {
        const p0 = pts[activeSlot.segStart];
        const p1 = pts[activeSlot.segEnd];
        if (p0 && p1 && typeof window.evaluateVectorSegmentPoint === 'function') {
          const mid = window.evaluateVectorSegmentPoint(p0, p1, activeSlot.t);
          dispX = mid.x;
          dispY = mid.y;
        }
      }

      const valXEl = document.getElementById('val-vector-x');
      if (valXEl) valXEl.textContent = `${Math.round(dispX)}`;

      const valYEl = document.getElementById('val-vector-y');
      if (valYEl) valYEl.textContent = `${Math.round(dispY)}`;

      const lblXEl = document.getElementById('lbl-vector-x');
      const lblYEl = document.getElementById('lbl-vector-y');
      if (lblXEl) lblXEl.textContent = (activeSlot.kind === 'point' && state.tool === 'curve') ? 'HX' : 'X';
      if (lblYEl) lblYEl.textContent = (activeSlot.kind === 'point' && state.tool === 'curve') ? 'HY' : 'Y';

      // Update Touchpad prompt (clean, zero P1/P2 labels)
      const hintEl = document.getElementById('lbl-vector-touchpad-prompt');
      if (hintEl) {
        if (activeSlot.kind === 'new') {
          hintEl.textContent = 'Swipe to aim • Tap to add';
        } else if (activeSlot.kind === 'mid') {
          hintEl.textContent = 'Tap or drag to insert point';
        } else if (state.tool === 'curve') {
          const modeLabel = state.curveSubMode === 'both' ? 'Symmetric' : (state.curveSubMode === 'out' ? 'Out Handle' : 'In Handle');
          hintEl.textContent = `Swipe to bend curve (${modeLabel})`;
        } else {
          hintEl.textContent = 'Swipe to move point';
        }
      }

      // Sync Stroke Settings Pane UI (#pane-vector-stroke)
      const strokeW = (layer.shapeProps.strokeWidth !== undefined)
        ? Number(layer.shapeProps.strokeWidth)
        : (layer.strokeWidth !== undefined ? Number(layer.strokeWidth) : 6);
      const strokeCap = layer.shapeProps.strokeCap || layer.strokeCap || 'round';
      const strokeColor = (layer.shapeProps.strokeColor || layer.strokeColor || '#ffffff').toUpperCase();

      const valStrokeEl = document.getElementById('val-vector-stroke');
      if (valStrokeEl) valStrokeEl.textContent = `${Math.round(strokeW)}px`;
      updateJogScrubberVisuals(document.getElementById('jog-vector-stroke-width'), strokeW, 0, 150);

      const capSwitchEl = document.getElementById('vector-stroke-cap-switch');
      if (capSwitchEl) {
        capSwitchEl.querySelectorAll('[data-stroke-cap]').forEach(btn => {
          btn.classList.toggle('is-active', btn.dataset.strokeCap === strokeCap);
        });
      }

      const chipColorEl = document.getElementById('chip-vector-stroke-color');
      const hexColorEl = document.getElementById('hex-vector-stroke-color');
      if (chipColorEl) chipColorEl.style.backgroundColor = strokeColor;
      if (hexColorEl) hexColorEl.textContent = strokeColor;

      // Sync Right & Left Tool Buttons
      const btnPoint = document.getElementById('btn-vector-tool-point');
      const btnCurve = document.getElementById('btn-vector-tool-curve');
      const btnClose = document.getElementById('btn-vector-tool-close');
      const btnStroke = document.getElementById('btn-vector-tool-stroke');
      const btnDelete = document.getElementById('btn-vector-tool-delete');

      if (btnPoint) btnPoint.classList.toggle('is-active', state.tool === 'point');
      if (btnCurve) btnCurve.classList.toggle('is-active', state.tool === 'curve');
      if (btnClose) btnClose.classList.toggle('is-active', closed);
      if (btnStroke) btnStroke.classList.toggle('is-active', state.tool === 'stroke');
      if (btnDelete) {
        const canDel = !isStrokePane && activeSlot.kind === 'point';
        btnDelete.classList.toggle('is-disabled', !canDel);
        btnDelete.disabled = !canDel;
      }

      // Render Right Looping Zig-Zag Track (#vector-scrubber-detents)
      // Each cycle m has nodes j = 0 .. N (0..N-1 are anchor points, N is '+').
      // Segments are drawn ONLY for j = 0 .. N-1 (last segment N-1 -> N is dashed to '+').
      // After '+' (j = N), there is NO line and a wider vertical gap (VECTOR_GAP_UNITS)
      // before the next cycle's start point (j = 0) on the opposite side.
      const detentsContainer = document.getElementById('vector-scrubber-detents');
      if (detentsContainer) {
        detentsContainer.style.transform = 'none';
        detentsContainer.innerHTML = '';

        const displayPos = (typeof state.scrubberPos === 'number' && !isNaN(state.scrubberPos))
          ? state.scrubberPos
          : activeSlot.canonicalPos;

        if (pts.length === 0) {
          const plusEl = document.createElement('div');
          plusEl.className = 'vector-zigzag-node is-plus-node is-active';
          plusEl.style.left = '27px';
          plusEl.style.top = '0px';
          plusEl.textContent = '+';
          detentsContainer.appendChild(plusEl);
        } else {
          const n = pts.length;
          const nodesPerCycle = n + 1;
          const centerCycle = Math.floor(displayPos / cycleUnits);
          const mMin = centerCycle - 2;
          const mMax = centerCycle + 2;

          const nodeSeq = (m, j) => m * nodesPerCycle + j;
          const nodeX = (m, j) => ((((nodeSeq(m, j) % 2) + 2) % 2 === 0) ? VECTOR_X_LEFT : VECTOR_X_RIGHT);
          const nodePos = (m, j) => m * cycleUnits + j;
          const nodeY = (m, j) => (nodePos(m, j) - displayPos) * VECTOR_SEG_H;

          const svgNS = 'http://www.w3.org/2000/svg';
          const svgEl = document.createElementNS(svgNS, 'svg');
          svgEl.setAttribute('class', 'vector-zigzag-svg');
          svgEl.setAttribute('viewBox', '0 -240 54 480');

          for (let m = mMin; m <= mMax; m++) {
            // Draw segments ONLY inside cycle m: j = 0..n-1 (from j to j+1).
            // Never draw a line from j = n ('+') to the next cycle's j = 0 ('awal')!
            for (let j = 0; j < n; j++) {
              const x1 = nodeX(m, j);
              const y1 = nodeY(m, j);
              const x2 = nodeX(m, j + 1);
              const y2 = nodeY(m, j + 1);
              if ((y1 < -240 && y2 < -240) || (y1 > 240 && y2 > 240)) continue;

              const isDashed = (j === n - 1);
              const segStartPos = nodePos(m, j);
              const isActiveSeg = !isDashed &&
                activeSlot.kind === 'mid' &&
                displayPos >= segStartPos - 0.01 &&
                displayPos <= segStartPos + 1.01;

              const lineEl = document.createElementNS(svgNS, 'line');
              lineEl.setAttribute('x1', String(x1));
              lineEl.setAttribute('y1', y1.toFixed(1));
              lineEl.setAttribute('x2', String(x2));
              lineEl.setAttribute('y2', y2.toFixed(1));
              lineEl.setAttribute(
                'class',
                'vector-zigzag-seg' +
                  (isDashed ? ' is-dashed' : '') +
                  (isActiveSeg ? ' is-active-seg' : '')
              );
              svgEl.appendChild(lineEl);
            }
          }
          detentsContainer.appendChild(svgEl);

          for (let m = mMin; m <= mMax; m++) {
            for (let j = 0; j <= n; j++) {
              const y = nodeY(m, j);
              if (Math.abs(y) > 220) continue;
              const x = nodeX(m, j);
              const pos = nodePos(m, j);
              const isPlus = (j === n);
              const isActiveNode = Math.abs(pos - displayPos) <= 0.06;

              const nodeEl = document.createElement('div');
              nodeEl.className = 'vector-zigzag-node ' +
                (isPlus ? 'is-plus-node' : 'is-point-node') +
                (isActiveNode ? ' is-active' : '');
              nodeEl.dataset.nodePos = String(pos);
              nodeEl.dataset.nodeJ = String(j);
              nodeEl.style.left = `${x}px`;
              nodeEl.style.top = `${y.toFixed(1)}px`;
              if (isPlus) {
                nodeEl.textContent = '+';
              }
              detentsContainer.appendChild(nodeEl);
            }
          }

          if (activeSlot.kind === 'mid') {
            const curCycle = Math.floor((displayPos + 1e-6) / cycleUnits);
            const u = displayPos - curCycle * cycleUnits;
            const j0 = Math.max(0, Math.min(n - 1, Math.floor(u)));
            const t = Math.max(0, Math.min(1, u - j0));
            const curX = nodeX(curCycle, j0) + (nodeX(curCycle, j0 + 1) - nodeX(curCycle, j0)) * t;
            const cursorDot = document.createElement('div');
            cursorDot.className = 'vector-zigzag-cursor-dot';
            cursorDot.style.left = `${curX.toFixed(1)}px`;
            cursorDot.style.top = '0px';
            cursorDot.textContent = '+';
            detentsContainer.appendChild(cursorDot);
          }
        }
      }

      updateVectorKeyframeBtnState();
      if (window.CanvasOverlay && typeof window.CanvasOverlay.scheduleRedraw === 'function') {
        window.CanvasOverlay.scheduleRedraw();
      }
    }
    window.syncVectorControllerUI = syncVectorControllerUI;

    function initVectorController() {
      const state = window._vectorEditorState;

      function getActiveVectorLayer() {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!layer || layer.type !== 'shape' || layer.shapeType !== 'vector') return null;
        if (!layer.shapeProps) layer.shapeProps = {};
        if (!Array.isArray(layer.shapeProps.points)) layer.shapeProps.points = [];
        return layer;
      }

      function commitVectorChange(layer, commitToHistory = false) {
        if (!layer) return;
        if (typeof window.syncVectorLayerBounds === 'function') {
          window.syncVectorLayerBounds(layer, true);
        }
        layer._shapeDirty = true;
        layer._fillDirty = true;
        if (layer._shapeBufferCanvas) {
          layer._shapeBufferCanvas._lastShapeKey = null;
        }
        if (typeof recordLayerPropertyChange === 'function') {
          recordLayerPropertyChange(layer, 'vectorPoints', layer.shapeProps.points);
        }
        if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
        redrawComposition();
        syncVectorControllerUI();
        if (commitToHistory) {
          saveCurrentProjectLayers(true);
          renderTimelineLayers();
        }
      }
      window.commitVectorChange = commitVectorChange;

      // 1. Touchpad Area: Tap to Add Point / Insert Segment Point, Swipe to Aim or Move Point / Curve Handles
      const padWrapEl = document.getElementById('pad-vector-touch');
      const padEl = document.getElementById('vector-touchpad-area');
      if (padEl) {
        let isPadDown = false;
        let startX = 0;
        let startY = 0;
        let hasDragged = false;
        let initX = 0;
        let initY = 0;
        let activeLayer = null;

        padEl.addEventListener('pointerdown', (e) => {
          activeLayer = getActiveVectorLayer();
          if (!activeLayer) return;

          isPadDown = true;
          hasDragged = false;
          startX = e.clientX;
          startY = e.clientY;
          state.isDraggingPad = true;
          padEl.classList.add('is-dragging');
          if (padWrapEl) padWrapEl.classList.add('is-dragging');
          if (padEl.setPointerCapture) {
            try { padEl.setPointerCapture(e.pointerId); } catch (_) {}
          }

          const pts = activeLayer.shapeProps.points;
          const slot = resolveVectorTargetState(pts, !!activeLayer.shapeProps.closed, state.target);

          if (slot.kind === 'new') {
            initX = state.cursorX || 0;
            initY = state.cursorY || 0;
          } else if (slot.kind === 'point') {
            const pt = pts[slot.pointIndex];
            if (pt) {
              if (state.tool === 'curve') {
                if (state.curveSubMode === 'in') {
                  initX = Number(pt.inX) || 0;
                  initY = Number(pt.inY) || 0;
                } else {
                  initX = Number(pt.outX) || 0;
                  initY = Number(pt.outY) || 0;
                }
              } else {
                initX = Number(pt.x) || 0;
                initY = Number(pt.y) || 0;
              }
            }
          }
        });

        padEl.addEventListener('pointermove', (e) => {
          if (!isPadDown || !activeLayer) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          const dist = Math.hypot(dx, dy);

          if (!hasDragged && dist > 4) {
            hasDragged = true;
            // If user starts dragging while positioned anywhere along a segment (t in 0..1), split at t & drag the new point!
            const pts = activeLayer.shapeProps.points;
            const slot = resolveVectorTargetState(pts, !!activeLayer.shapeProps.closed, state.target);
            if (slot && slot.kind === 'mid' && typeof window.subdivideVectorSegment === 'function') {
              const p0 = pts[slot.segStart];
              const p1 = pts[slot.segEnd];
              if (p0 && p1) {
                const prevCycle = Math.floor((state.scrubberPos || 0) / getVectorCycleUnits(pts));
                const sub = window.subdivideVectorSegment(p0, p1, slot.t);
                const midPt = sub.midPoint || sub;
                const insertIdx = slot.segStart + 1;
                pts.splice(insertIdx, 0, {
                  x: midPt.x,
                  y: midPt.y,
                  inX: midPt.inX || 0,
                  inY: midPt.inY || 0,
                  outX: midPt.outX || 0,
                  outY: midPt.outY || 0
                });
                state.target = insertIdx;
                state.scrubberPos = prevCycle * getVectorCycleUnits(pts) + insertIdx;
                state.tool = 'point';
                initX = midPt.x;
                initY = midPt.y;
              }
            }
          }

          if (!hasDragged) return;

          const speed = e.shiftKey ? 0.35 : (e.altKey ? 2.5 : 1.35);
          const pts = activeLayer.shapeProps.points;
          const slot = resolveVectorTargetState(pts, !!activeLayer.shapeProps.closed, state.target);

          if (slot.kind === 'new') {
            state.cursorX = Math.round(initX + dx * speed);
            state.cursorY = Math.round(initY + dy * speed);
            syncVectorControllerUI();
          } else if (slot.kind === 'point') {
            const pt = pts[slot.pointIndex];
            if (!pt) return;
            if (state.tool === 'curve') {
              const newHX = Math.round(initX + dx * speed);
              const newHY = Math.round(initY + dy * speed);
              if (state.curveSubMode === 'both') {
                pt.outX = newHX;
                pt.outY = newHY;
                pt.inX = -newHX;
                pt.inY = -newHY;
              } else if (state.curveSubMode === 'out') {
                pt.outX = newHX;
                pt.outY = newHY;
              } else {
                pt.inX = newHX;
                pt.inY = newHY;
              }
            } else {
              pt.x = Math.round(initX + dx * speed);
              pt.y = Math.round(initY + dy * speed);
            }
            commitVectorChange(activeLayer, false);
          }
        });

        const endPadGesture = (e) => {
          if (!isPadDown) return;
          isPadDown = false;
          state.isDraggingPad = false;
          padEl.classList.remove('is-dragging');
          if (padWrapEl) padWrapEl.classList.remove('is-dragging');
          if (e && padEl.releasePointerCapture) {
            try { padEl.releasePointerCapture(e.pointerId); } catch (_) {}
          }

          if (!activeLayer) return;
          const pts = activeLayer.shapeProps.points;
          const slot = resolveVectorTargetState(pts, !!activeLayer.shapeProps.closed, state.target);

          if (!hasDragged) {
            if (slot.kind === 'new') {
              const prevCycle = pts.length > 0 ? Math.floor((state.scrubberPos || 0) / getVectorCycleUnits(pts)) : 0;
              let newX = Math.round(state.cursorX || 0);
              let newY = Math.round(state.cursorY || 0);
              if (pts.length > 0) {
                const lastPt = pts[pts.length - 1];
                if (Math.hypot((lastPt.x || 0) - newX, (lastPt.y || 0) - newY) < 2) {
                  newX += 60;
                  state.cursorX = newX;
                }
              }
              pts.push({ x: newX, y: newY, inX: 0, inY: 0, outX: 0, outY: 0 });
              if (pts.length >= 3 && !activeLayer.shapeProps.closed) {
                const firstPt = pts[0];
                if (Math.hypot((firstPt.x || 0) - newX, (firstPt.y || 0) - newY) <= 18) {
                  pts.pop();
                  activeLayer.shapeProps.closed = true;
                  state.target = 0;
                  state.scrubberPos = prevCycle * getVectorCycleUnits(pts);
                } else {
                  state.scrubberPos = prevCycle * getVectorCycleUnits(pts) + pts.length;
                }
              } else {
                state.scrubberPos = prevCycle * getVectorCycleUnits(pts) + pts.length;
              }
              commitVectorChange(activeLayer, true);
            } else if (slot.kind === 'mid' && typeof window.subdivideVectorSegment === 'function') {
              const p0 = pts[slot.segStart];
              const p1 = pts[slot.segEnd];
              if (p0 && p1) {
                const prevCycle = Math.floor((state.scrubberPos || 0) / getVectorCycleUnits(pts));
                const sub = window.subdivideVectorSegment(p0, p1, slot.t);
                const midPt = sub.midPoint || sub;
                const insertIdx = slot.segStart + 1;
                pts.splice(insertIdx, 0, {
                  x: midPt.x,
                  y: midPt.y,
                  inX: midPt.inX || 0,
                  inY: midPt.inY || 0,
                  outX: midPt.outX || 0,
                  outY: midPt.outY || 0
                });
                state.target = insertIdx;
                state.scrubberPos = prevCycle * getVectorCycleUnits(pts) + insertIdx;
                state.tool = 'point';
                commitVectorChange(activeLayer, true);
              }
            }
          } else {
            if (slot.kind === 'point') {
              commitVectorChange(activeLayer, true);
            }
          }
          activeLayer = null;
        };

        padEl.addEventListener('pointerup', endPadGesture);
        padEl.addEventListener('pointercancel', endPadGesture);
      }

      // 2. Right Touchpad-Styled Looping Zig-Zag Slide Bar (#jog-vector-scrubber)
      const scrubberEl = document.getElementById('jog-vector-scrubber');
      if (scrubberEl) {
        let isScrubDown = false;
        let scrubStartY = 0;
        let scrubStartPos = 0;
        let scrubHasDragged = false;

        scrubberEl.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const layer = getActiveVectorLayer();
          if (!layer) return;

          const pts = layer.shapeProps.points;
          const closed = !!layer.shapeProps.closed;
          const slot = resolveVectorTargetState(pts, closed, state.target);
          if (typeof state.scrubberPos !== 'number' || isNaN(state.scrubberPos)) {
            state.scrubberPos = slot.canonicalPos;
          }

          isScrubDown = true;
          scrubHasDragged = false;
          scrubStartY = e.clientY;
          scrubStartPos = state.scrubberPos;
          state.isScrubbing = true;
          scrubberEl.classList.add('is-dragging');
          if (scrubberEl.setPointerCapture) {
            try { scrubberEl.setPointerCapture(e.pointerId); } catch (_) {}
          }
        });

        scrubberEl.addEventListener('pointermove', (e) => {
          if (!isScrubDown) return;
          const dy = e.clientY - scrubStartY;
          if (!scrubHasDragged && Math.abs(dy) > 2) {
            scrubHasDragged = true;
          }
          if (!scrubHasDragged) return;

          const layer = getActiveVectorLayer();
          if (!layer) return;
          const pts = layer.shapeProps.points;
          if (pts.length === 0) return;

          const n = pts.length;
          const cycleUnits = getVectorCycleUnits(pts);
          // 1:1 physical direction: dragging finger down (dy > 0) moves track down (pos decreases)
          const rawPos = scrubStartPos - (dy / VECTOR_SEG_H);
          const m = Math.floor(rawPos / cycleUnits);
          const u = rawPos - m * cycleUnits; // in [0, cycleUnits)

          let effectiveU = u;
          if (u <= n) {
            const jNear = Math.round(u);
            if (Math.abs(u - jNear) <= VECTOR_MAGNET_SNAP) {
              effectiveU = jNear;
            }
          } else {
            // Inside the open gap between '+' (u = n) and next cycle's Point 0 (u = cycleUnits)
            if (u - n <= VECTOR_MAGNET_SNAP) {
              effectiveU = n;
            } else if (cycleUnits - u <= VECTOR_MAGNET_SNAP) {
              effectiveU = cycleUnits;
            }
          }

          const effectivePos = m * cycleUnits + effectiveU;
          state.scrubberPos = effectivePos;

          if (Math.abs(effectiveU - cycleUnits) <= 0.001) {
            state.target = 0;
          } else if (Math.abs(effectiveU - Math.round(effectiveU)) <= 0.001 && Math.round(effectiveU) <= n) {
            const jNode = Math.round(effectiveU);
            state.target = (jNode === n) ? 'new' : jNode;
          } else if (effectiveU > 0 && effectiveU < n - 1 && n >= 2) {
            // Free non-magnetic middle of a solid segment j -> j+1
            state.target = Number(effectiveU.toFixed(3));
          } else if (effectiveU > n - 1 && effectiveU < n) {
            // Along the dashed connector from last point (n - 1) to '+' (n)
            state.target = (effectiveU - (n - 1) >= 0.5) ? 'new' : (n - 1);
          } else {
            // Inside the open gap between '+' (n) and next cycle's start (cycleUnits)
            state.target = ((effectiveU - n) >= (cycleUnits - n) * 0.5) ? 0 : 'new';
          }

          syncVectorControllerUI();
        });

        const endScrub = (e) => {
          if (!isScrubDown) return;
          isScrubDown = false;
          state.isScrubbing = false;
          scrubberEl.classList.remove('is-dragging');
          if (e && scrubberEl.releasePointerCapture) {
            try { scrubberEl.releasePointerCapture(e.pointerId); } catch (_) {}
          }

          const layer = getActiveVectorLayer();
          if (layer) {
            const pts = layer.shapeProps.points;
            const n = pts.length;
            const cycleUnits = getVectorCycleUnits(pts);

            if (!scrubHasDragged && e) {
              // Direct tap on a visible zig-zag node
              const nodeEl = e.target && e.target.closest ? e.target.closest('.vector-zigzag-node') : null;
              if (nodeEl && nodeEl.dataset.nodePos !== undefined && nodeEl.dataset.nodeJ !== undefined) {
                const pos = Number(nodeEl.dataset.nodePos);
                const j = Number(nodeEl.dataset.nodeJ);
                state.scrubberPos = pos;
                state.target = (j === n) ? 'new' : j;
                if (state.tool === 'curve' && j < n && typeof window.ensureVectorPointAutoCurve === 'function') {
                  if (window.ensureVectorPointAutoCurve(pts, j, !!layer.shapeProps.closed)) {
                    commitVectorChange(layer, true);
                    return;
                  }
                }
              }
            } else if (n > 0) {
              // If released inside the dashed connector (n-1 .. n) or open loop gap (n .. cycleUnits), snap cleanly to nearest node
              const m = Math.floor(state.scrubberPos / cycleUnits);
              const u = state.scrubberPos - m * cycleUnits;
              if (u > n - 1 || n < 2) {
                if (u <= n) {
                  const snapJ = (u - (n - 1) >= 0.5) ? n : (n - 1);
                  state.scrubberPos = m * cycleUnits + snapJ;
                  state.target = (snapJ === n) ? 'new' : snapJ;
                } else {
                  const snapToNextStart = (u - n) >= (cycleUnits - n) * 0.5;
                  if (snapToNextStart) {
                    state.scrubberPos = (m + 1) * cycleUnits;
                    state.target = 0;
                  } else {
                    state.scrubberPos = m * cycleUnits + n;
                    state.target = 'new';
                  }
                }
              }
            }
          }
          syncVectorControllerUI();
        };

        scrubberEl.addEventListener('pointerup', endScrub);
        scrubberEl.addEventListener('pointercancel', endScrub);
      }

      // 3. Right Tool Column: Point, Curve (cycles both/out/in), Close Path, Stroke Settings
      const btnPoint = document.getElementById('btn-vector-tool-point');
      if (btnPoint) {
        btnPoint.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          state.tool = 'point';
          syncVectorControllerUI();
        });
      }

      const btnCurve = document.getElementById('btn-vector-tool-curve');
      if (btnCurve) {
        btnCurve.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const layer = getActiveVectorLayer();
          const wasCurve = (state.tool === 'curve');
          if (!wasCurve) {
            state.tool = 'curve';
            state.curveSubMode = 'both';
          }

          if (layer && Array.isArray(layer.shapeProps.points) && layer.shapeProps.points.length > 0) {
            const pts = layer.shapeProps.points;
            const closed = !!layer.shapeProps.closed;
            if (state.target === 'new') {
              const targetIdx = pts.length - 1;
              state.target = targetIdx;
              state.scrubberPos = targetIdx;
            } else {
              const preSlot = resolveVectorTargetState(pts, closed, state.target);
              if (preSlot && preSlot.kind === 'mid' && typeof window.subdivideVectorSegment === 'function') {
                const p0 = pts[preSlot.segStart];
                const p1 = pts[preSlot.segEnd];
                if (p0 && p1) {
                  const prevCycle = Math.floor((state.scrubberPos || 0) / getVectorCycleUnits(pts));
                  const sub = window.subdivideVectorSegment(p0, p1, preSlot.t);
                  const midPt = sub.midPoint || sub;
                  const insertIdx = preSlot.segStart + 1;
                  pts.splice(insertIdx, 0, {
                    x: midPt.x,
                    y: midPt.y,
                    inX: midPt.inX || 0,
                    inY: midPt.inY || 0,
                    outX: midPt.outX || 0,
                    outY: midPt.outY || 0
                  });
                  state.target = insertIdx;
                  state.scrubberPos = prevCycle * getVectorCycleUnits(pts) + insertIdx;
                }
              }
            }

            const slot = resolveVectorTargetState(pts, closed, state.target);
            if (slot && slot.kind === 'point' && typeof window.ensureVectorPointAutoCurve === 'function') {
              const didAutoRound = window.ensureVectorPointAutoCurve(pts, slot.pointIndex, closed);
              if (didAutoRound) {
                state.curveSubMode = 'both';
                commitVectorChange(layer, true);
                return;
              }
            }
          }

          if (wasCurve) {
            state.curveSubMode = state.curveSubMode === 'both'
              ? 'out'
              : (state.curveSubMode === 'out' ? 'in' : 'both');
          }
          syncVectorControllerUI();
        });
      }

      const btnClose = document.getElementById('btn-vector-tool-close');
      if (btnClose) {
        btnClose.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const layer = getActiveVectorLayer();
          if (!layer) return;
          layer.shapeProps.closed = !layer.shapeProps.closed;
          if (layer.shapeProps.closed && state.target === 'new' && layer.shapeProps.points.length > 0) {
            state.target = 0;
            state.scrubberPos = 0;
          }
          commitVectorChange(layer, true);
        });
      }

      const btnStroke = document.getElementById('btn-vector-tool-stroke');
      if (btnStroke) {
        btnStroke.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          state.tool = (state.tool === 'stroke') ? 'point' : 'stroke';
          syncVectorControllerUI();
        });
      }

      const btnDelete = document.getElementById('btn-vector-tool-delete');
      if (btnDelete) {
        btnDelete.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const layer = getActiveVectorLayer();
          if (!layer) return;
          const pts = layer.shapeProps.points;
          const slot = resolveVectorTargetState(pts, !!layer.shapeProps.closed, state.target);
          if (slot && slot.kind === 'point') {
            pts.splice(slot.pointIndex, 1);
            if (pts.length === 0) {
              state.target = 'new';
              state.scrubberPos = 0;
            } else {
              const nextIdx = Math.max(0, Math.min(pts.length - 1, slot.pointIndex - 1));
              state.target = nextIdx;
              state.scrubberPos = nextIdx;
            }
            commitVectorChange(layer, true);
          }
        });
      }

      // 4. Stroke Pane Controls (#jog-vector-stroke-width, #vector-stroke-cap-switch, #btn-vector-stroke-color)
      const jogStrokeW = document.getElementById('jog-vector-stroke-width');
      if (jogStrokeW) {
        let initStrokeW = 6;
        let lastStrokeW = 6;
        bindJogWheel(jogStrokeW, {
          onStart: () => {
            const layer = getActiveVectorLayer();
            if (!layer) return;
            initStrokeW = (layer.shapeProps.strokeWidth !== undefined)
              ? Number(layer.shapeProps.strokeWidth)
              : (layer.strokeWidth !== undefined ? Number(layer.strokeWidth) : 6);
            lastStrokeW = initStrokeW;
          },
          onMove: (rawDelta, e) => {
            const layer = getActiveVectorLayer();
            if (!layer) return;
            const speed = (e && e.shiftKey) ? 0.1 : 0.35;
            const nextW = Math.max(0, Math.min(150, Math.round(initStrokeW - rawDelta * speed)));
            lastStrokeW = nextW;
            layer.shapeProps.strokeWidth = nextW;
            layer.strokeWidth = nextW;
            commitVectorChange(layer, false);
          },
          onEnd: () => {
            const layer = getActiveVectorLayer();
            if (!layer) return;
            layer.shapeProps.strokeWidth = lastStrokeW;
            layer.strokeWidth = lastStrokeW;
            commitVectorChange(layer, true);
          }
        });
      }

      const capSwitchEl = document.getElementById('vector-stroke-cap-switch');
      if (capSwitchEl) {
        capSwitchEl.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-stroke-cap]');
          if (!btn) return;
          e.preventDefault();
          e.stopPropagation();
          const layer = getActiveVectorLayer();
          if (!layer) return;
          const cap = btn.dataset.strokeCap || 'round';
          layer.shapeProps.strokeCap = cap;
          layer.strokeCap = cap;
          commitVectorChange(layer, true);
        });
      }

      const btnStrokeColor = document.getElementById('btn-vector-stroke-color');
      if (btnStrokeColor) {
        btnStrokeColor.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const layer = getActiveVectorLayer();
          if (!layer || !window.FishColorPicker || typeof window.FishColorPicker.open !== 'function') return;
          const curColor = layer.shapeProps.strokeColor || layer.strokeColor || '#ffffff';
          btnStrokeColor.classList.add('is-active');
          window.FishColorPicker.open({
            anchor: btnStrokeColor,
            color: curColor,
            onChange: (hex) => {
              const target = getActiveVectorLayer();
              if (!target) return;
              target.shapeProps.strokeColor = hex;
              target.strokeColor = hex;
              commitVectorChange(target, false);
            },
            onCommit: (hex) => {
              const target = getActiveVectorLayer();
              if (!target) return;
              target.shapeProps.strokeColor = hex;
              target.strokeColor = hex;
              commitVectorChange(target, true);
            },
            onClose: () => {
              btnStrokeColor.classList.remove('is-active');
            }
          });
        });
      }

      // 5. Header Pill Value Inputs (X, Y, Stroke Width)
      const valXEl = document.getElementById('card-vector-x') || document.getElementById('val-vector-x');
      if (valXEl) {
        valXEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = getActiveVectorLayer();
          if (!layer) return;
          const pts = layer.shapeProps.points;
          const slot = resolveVectorTargetState(pts, !!layer.shapeProps.closed, state.target);
          const curVal = slot.kind === 'point'
            ? Math.round(state.tool === 'curve' ? (state.curveSubMode === 'in' ? (pts[slot.pointIndex]?.inX || 0) : (pts[slot.pointIndex]?.outX || 0)) : (pts[slot.pointIndex]?.x || 0))
            : Math.round(state.cursorX || 0);
          if (typeof window.openValueInputPopover === 'function') {
            window.openValueInputPopover(valXEl, {
              title: 'Vector X',
              value: curVal,
              defaultValue: 0,
              min: -100000,
              max: 100000,
              step: 1,
              unit: 'px',
              onCommit: (newVal) => {
                const v = Math.round(newVal);
                if (slot.kind === 'point' && pts[slot.pointIndex]) {
                  if (state.tool === 'curve') {
                    if (state.curveSubMode === 'in') pts[slot.pointIndex].inX = v;
                    else if (state.curveSubMode === 'out') pts[slot.pointIndex].outX = v;
                    else { pts[slot.pointIndex].outX = v; pts[slot.pointIndex].inX = -v; }
                  } else {
                    pts[slot.pointIndex].x = v;
                  }
                  commitVectorChange(layer, true);
                } else {
                  state.cursorX = v;
                  syncVectorControllerUI();
                }
              }
            });
          }
        });
      }

      const valYEl = document.getElementById('card-vector-y') || document.getElementById('val-vector-y');
      if (valYEl) {
        valYEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = getActiveVectorLayer();
          if (!layer) return;
          const pts = layer.shapeProps.points;
          const slot = resolveVectorTargetState(pts, !!layer.shapeProps.closed, state.target);
          const curVal = slot.kind === 'point'
            ? Math.round(state.tool === 'curve' ? (state.curveSubMode === 'in' ? (pts[slot.pointIndex]?.inY || 0) : (pts[slot.pointIndex]?.outY || 0)) : (pts[slot.pointIndex]?.y || 0))
            : Math.round(state.cursorY || 0);
          if (typeof window.openValueInputPopover === 'function') {
            window.openValueInputPopover(valYEl, {
              title: 'Vector Y',
              value: curVal,
              defaultValue: 0,
              min: -100000,
              max: 100000,
              step: 1,
              unit: 'px',
              onCommit: (newVal) => {
                const v = Math.round(newVal);
                if (slot.kind === 'point' && pts[slot.pointIndex]) {
                  if (state.tool === 'curve') {
                    if (state.curveSubMode === 'in') pts[slot.pointIndex].inY = v;
                    else if (state.curveSubMode === 'out') pts[slot.pointIndex].outY = v;
                    else { pts[slot.pointIndex].outY = v; pts[slot.pointIndex].inY = -v; }
                  } else {
                    pts[slot.pointIndex].y = v;
                  }
                  commitVectorChange(layer, true);
                } else {
                  state.cursorY = v;
                  syncVectorControllerUI();
                }
              }
            });
          }
        });
      }

      const valStrokeEl = document.getElementById('val-vector-stroke');
      if (valStrokeEl) {
        valStrokeEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = getActiveVectorLayer();
          if (!layer) return;
          const curStroke = (layer.shapeProps.strokeWidth !== undefined)
            ? Number(layer.shapeProps.strokeWidth)
            : (layer.strokeWidth !== undefined ? Number(layer.strokeWidth) : 6);
          if (typeof window.openValueInputPopover === 'function') {
            window.openValueInputPopover(valStrokeEl, {
              title: 'Stroke Width',
              value: Math.round(curStroke),
              defaultValue: 6,
              min: 0,
              max: 150,
              step: 1,
              unit: 'px',
              onCommit: (newVal) => {
                const w = Math.max(0, Math.min(150, Math.round(newVal)));
                layer.shapeProps.strokeWidth = w;
                layer.strokeWidth = w;
                commitVectorChange(layer, true);
              }
            });
          }
        });
      }

      // 6. Keyframe & Graph Buttons in Left Nav
      const btnVecKf = document.getElementById('btn-vector-keyframe');
      if (btnVecKf) {
        btnVecKf.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const layer = getActiveVectorLayer();
          if (!layer) return;
          if (typeof toggleKeyframeAtCurrentTime === 'function') {
            toggleKeyframeAtCurrentTime(layer, 'vectorPoints');
            updateVectorKeyframeBtnState();
          }
        });
      }

      const btnVecGraph = document.getElementById('btn-vector-graph');
      if (btnVecGraph) {
        btnVecGraph.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.activeKeyframeProperty = 'vectorPoints';
          if (typeof switchLayerDrawerSubview === 'function') {
            switchLayerDrawerSubview('graph');
          }
        });
      }
    }
    window.initVectorController = initVectorController;

    function linkLayer(childLayer, parentLayer, skipSave = false) {
      if (!childLayer || !parentLayer || childLayer.id === parentLayer.id) return;
      const pps = window.currentPixelsPerSecond || 80;
      const currentSec = Math.abs(window.timelinePanX || 0) / pps;
      const pEff = (typeof getLayerEffectivePropsAtTime === 'function')
        ? getLayerEffectivePropsAtTime(parentLayer, currentSec)
        : parentLayer;

      const aspect = currentProjectState.aspectRatio || '16:9';
      const res = currentProjectState.resolution || '1080p';
      const baseDims = window.getProjectDimensions(res, aspect);
      const baseW = (currentProjectState.width && currentProjectState.width > 0) ? currentProjectState.width : baseDims[0];
      const baseH = (currentProjectState.height && currentProjectState.height > 0) ? currentProjectState.height : baseDims[1];

      childLayer.parentId = parentLayer.id;
      childLayer.parentBind = {
        parentPosX: pEff.posX !== undefined ? pEff.posX : (baseW / 2),
        parentPosY: pEff.posY !== undefined ? pEff.posY : (baseH / 2),
        parentRotX: pEff.rotX || 0,
        parentRotY: pEff.rotY || 0,
        parentRotZ: pEff.rotZ !== undefined ? pEff.rotZ : (pEff.rotation || 0),
        parentScaleW: pEff.scaleW || 500,
        parentScaleH: pEff.scaleH || 500,
        parentPosZ: pEff.posZ || 0
      };

      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(childLayer);
      if (!skipSave) {
        saveCurrentProjectLayers(true);
        renderTimelineLayers();
        redrawComposition();
        if (typeof updateEditorHeaderMode === 'function') updateEditorHeaderMode();
      }
    }
    window.linkLayer = linkLayer;

    function linkLayers(childLayers, parentLayer) {
      if (!Array.isArray(childLayers) || childLayers.length === 0 || !parentLayer) return;
      childLayers.forEach(c => linkLayer(c, parentLayer, true));
      saveCurrentProjectLayers(true);
      renderTimelineLayers();
      redrawComposition();
      if (typeof updateEditorHeaderMode === 'function') updateEditorHeaderMode();
    }
    window.linkLayers = linkLayers;

    function unlinkLayer(layer, skipSave = false) {
      if (!layer || !layer.parentId) return;
      const pps = window.currentPixelsPerSecond || 80;
      const currentSec = Math.abs(window.timelinePanX || 0) / pps;
      const eff = (typeof getLayerEffectivePropsAtTime === 'function')
        ? getLayerEffectivePropsAtTime(layer, currentSec)
        : layer;

      // Preserve transformed world coordinates on unlink so layer does not jump
      if (eff.posX !== undefined) layer.posX = Number(eff.posX.toFixed(2));
      if (eff.posY !== undefined) layer.posY = Number(eff.posY.toFixed(2));
      if (eff.posZ !== undefined) layer.posZ = Number(eff.posZ.toFixed(2));
      if (eff.rotX !== undefined) layer.rotX = Number(eff.rotX.toFixed(2));
      if (eff.rotY !== undefined) layer.rotY = Number(eff.rotY.toFixed(2));
      if (eff.rotZ !== undefined) {
        layer.rotZ = Number(eff.rotZ.toFixed(2));
        layer.rotation = layer.rotZ;
      }
      if (eff.scaleW !== undefined) layer.scaleW = Number(eff.scaleW.toFixed(1));
      if (eff.scaleH !== undefined) layer.scaleH = Number(eff.scaleH.toFixed(1));

      layer.parentId = null;
      delete layer.parentBind;

      if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
      if (!skipSave) {
        saveCurrentProjectLayers(true);
        renderTimelineLayers();
        redrawComposition();
        if (typeof updateEditorHeaderMode === 'function') updateEditorHeaderMode();
      }
    }
    window.unlinkLayer = unlinkLayer;

    function unlinkLayers(layersToUnlink) {
      if (!Array.isArray(layersToUnlink) || layersToUnlink.length === 0) return;
      layersToUnlink.forEach(l => unlinkLayer(l, true));
      saveCurrentProjectLayers(true);
      renderTimelineLayers();
      redrawComposition();
      if (typeof updateEditorHeaderMode === 'function') updateEditorHeaderMode();
    }
    window.unlinkLayers = unlinkLayers;

    function reorderLayersBatch(allLayers, movingIdSet, targetDropIdx) {
      if (!allLayers || allLayers.length <= 1) return allLayers || [];
      const strSet = new Set(Array.from(movingIdSet).map(String));
      const movingLayers = allLayers.filter(l => strSet.has(String(l.id)));
      if (movingLayers.length === 0) return allLayers;
      const remainingLayers = allLayers.filter(l => !strSet.has(String(l.id)));

      let insertIdx = remainingLayers.length;
      for (let i = targetDropIdx; i < allLayers.length; i++) {
        const l = allLayers[i];
        if (!strSet.has(String(l.id))) {
          const idxInRemaining = remainingLayers.indexOf(l);
          if (idxInRemaining !== -1) {
            insertIdx = idxInRemaining;
            break;
          }
        }
      }

      return [...remainingLayers.slice(0, insertIdx), ...movingLayers, ...remainingLayers.slice(insertIdx)];
    }
    window.reorderLayersBatch = reorderLayersBatch;

    function openLayerLinkPopover(triggerEl, explicitLayerId) {
      const selIds = window.selectedLayerIds || null;
      const currentLayerId = (explicitLayerId !== undefined && explicitLayerId !== null)
        ? explicitLayerId
        : (window.selectedLayerId || (selIds && selIds.size === 1 ? Array.from(selIds)[0] : null));
      const layers = currentProjectState.layers || [];
      const currentLayer = layers.find(l => String(l.id) === String(currentLayerId));
      if (!currentLayer) return;

      const isMulti = selIds && selIds.size > 1;
      const targetIds = isMulti ? new Set(Array.from(selIds).map(String)) : new Set([String(currentLayer.id)]);
      const targetLayers = layers.filter(l => targetIds.has(String(l.id)));
      if (targetLayers.length === 0) targetLayers.push(currentLayer);

      const listContainer = document.getElementById('layer-link-popover-list');
      if (!listContainer) return;

      listContainer.innerHTML = '';

      const hasParent = targetLayers.some(l => !!l.parentId);

      // 1. "None" (Unlink) option at top
      const noneBtn = document.createElement('button');
      noneBtn.type = 'button';
      noneBtn.className = `layer-link-item ${!hasParent ? 'is-selected' : ''}`;
      noneBtn.innerHTML = `
        <span class="layer-link-preview-box is-none" aria-hidden="true">
          <i class='fticon fticon-icon-13' aria-hidden='true'></i>
        </span>
        <span class="layer-link-item-name">None</span>
        ${!hasParent ? '<span class="layer-link-check" aria-hidden="true"><i class="fticon fticon-icon-14" aria-hidden="true"></i></span>' : ''}
      `;
      noneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const toUnlink = targetLayers.filter(t => t.parentId);
        if (toUnlink.length > 0) {
          unlinkLayers(toUnlink);
        }
        if (window.Popover) window.Popover.close();
      });
      listContainer.appendChild(noneBtn);

      // Check if candidateId is a descendant of ancestorId to prevent circular dependency
      function isDescendant(candidateId, ancestorId) {
        let cur = layers.find(l => String(l.id) === String(candidateId));
        const visited = new Set();
        while (cur && cur.parentId) {
          if (visited.has(cur.id)) break;
          visited.add(cur.id);
          if (String(cur.parentId) === String(ancestorId)) return true;
          cur = layers.find(l => String(l.id) === String(cur.parentId));
        }
        return false;
      }

      function getPreviewHtml(l) {
        const type = l.type || 'image';
        if (type === 'camera') {
          return `<span class="layer-link-preview-box is-camera" aria-hidden="true"><i class='fticon fticon-icon-15' aria-hidden='true'></i></span>`;
        }
        if (type === 'null') {
          return `<span class="layer-link-preview-box is-null" aria-hidden="true"><i class='fticon fticon-icon-16' aria-hidden='true'></i></span>`;
        }
        if (type === 'adjustment') {
          return `<span class="layer-link-preview-box is-adj" aria-hidden="true"><i class='fticon fticon-icon-17' aria-hidden='true'></i></span>`;
        }
        if (type === 'audio') {
          return `<span class="layer-link-preview-box is-audio" aria-hidden="true"><i class='fticon fticon-icon-18' aria-hidden='true'></i></span>`;
        }
        if (type === 'text') {
          return `<span class="layer-link-preview-box is-text" aria-hidden="true"><i class='fticon fticon-icon-19' aria-hidden='true'></i></span>`;
        }
        let thumb = l.thumbUrl;
        if (!thumb && l.mediaId && window.importedMediaMap && window.importedMediaMap.has(l.mediaId)) {
          const m = window.importedMediaMap.get(l.mediaId);
          if (m && m.thumbUrl) thumb = m.thumbUrl;
        }
        if (thumb) {
          return `<span class="layer-link-preview-box" aria-hidden="true"><img src="${thumb}" class="layer-link-preview-img" alt="" loading="lazy" draggable="false"/></span>`;
        }
        const iconSvg = (type === 'video')
          ? `<i class="fticon fticon-icon-20" aria-hidden="true"></i>`
          : `<i class="fticon fticon-icon-21" aria-hidden="true"></i>`;
        return `<span class="layer-link-preview-box is-media" aria-hidden="true">${iconSvg}</span>`;
      }

      // Render layer items
      layers.forEach(layerItem => {
        const isSelf = String(layerItem.id) === String(currentLayer.id);
        const isSelected = targetIds.has(String(layerItem.id));
        const isCurrentParent = targetLayers.some(t => String(t.parentId) === String(layerItem.id));
        const isCircular = !isSelected && targetLayers.some(t => isDescendant(layerItem.id, t.id));
        const isDisabled = isSelected || isCircular;

        const itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.className = `layer-link-item ${isCurrentParent ? 'is-selected' : ''} ${isDisabled ? 'is-disabled' : ''}`;
        if (isDisabled) {
          itemBtn.disabled = true;
          itemBtn.title = isSelf ? 'Layer ini' : (isSelected ? 'Layer yang terpilih' : 'Anak layer ini (Mencegah circular loop)');
        }

        itemBtn.innerHTML = `
          ${getPreviewHtml(layerItem)}
          <span class="layer-link-item-name">${layerItem.name || 'Untitled Layer'}</span>
          ${isCurrentParent ? '<span class="layer-link-check" aria-hidden="true"><i class="fticon fticon-icon-14" aria-hidden="true"></i></span>' : ''}
        `;

        if (!isDisabled) {
          itemBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isCurrentParent) {
              const toUnlink = targetLayers.filter(t => t.parentId);
              if (toUnlink.length > 0) unlinkLayers(toUnlink);
            } else {
              linkLayers(targetLayers, layerItem);
            }
            if (window.Popover) window.Popover.close();
          });
        }

        listContainer.appendChild(itemBtn);
      });

      if (window.Popover) {
        window.Popover.open(triggerEl, 'popover-layer-link');
      }
    }
    window.openLayerLinkPopover = openLayerLinkPopover;

    function syncCameraSettingsUI() {
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer || layer.type !== 'camera') return;

      const pps = window.currentPixelsPerSecond || 80;
      const currentSec = Math.abs(window.timelinePanX || 0) / pps;
      const eff = (typeof getLayerEffectivePropsAtTime === 'function')
        ? getLayerEffectivePropsAtTime(layer, currentSec)
        : layer;

      // 1. Lens Focal Length
      const curLens = eff.cameraLens !== undefined ? eff.cameraLens : 50;
      const valLens = document.getElementById('val-camera-lens');
      if (valLens) {
        valLens.textContent = `${Math.round(curLens)} mm`;
      }
      updateJogScrubberVisuals(document.getElementById('jog-camera-lens'), curLens, 12, 300);

      // 2. Zoom
      const curZoom = eff.cameraZoom !== undefined ? eff.cameraZoom : 100;
      const valZoom = document.getElementById('val-camera-zoom');
      if (valZoom) {
        valZoom.textContent = `${Math.round(curZoom)}%`;
      }
      updateJogScrubberVisuals(document.getElementById('jog-camera-zoom'), curZoom, 10, 400);

      // 3. Switch Blur (Depth of Field)
      const isBlurOn = !!(layer.cameraBlurEnabled);
      document.querySelectorAll('#camera-blur-switch .segmented-switch-item').forEach(btn => {
        const isMatch = btn.dataset.blur === (isBlurOn ? 'on' : 'off');
        btn.classList.toggle('is-active', isMatch);
        btn.classList.toggle('is-selected', isMatch);
        btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });

      const dofGroup = document.getElementById('camera-dof-group');
      if (dofGroup) {
        dofGroup.style.display = isBlurOn ? '' : 'none';
      }

      // 4. Focus Target Mode (VALUE / TO LAYER)
      const focusMode = layer.cameraFocusMode || 'manual';
      document.querySelectorAll('#camera-focus-mode-switch .segmented-switch-item').forEach(btn => {
        const isMatch = btn.dataset.focusMode === focusMode;
        btn.classList.toggle('is-active', isMatch);
        btn.classList.toggle('is-selected', isMatch);
        btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });

      const rowManual = document.getElementById('row-camera-focus-manual');
      const rowLayer = document.getElementById('row-camera-focus-layer');
      if (rowManual) rowManual.style.display = (focusMode === 'manual') ? '' : 'none';
      if (rowLayer) rowLayer.style.display = (focusMode === 'layer') ? '' : 'none';

      // 4a. Focus Distance (Dekat / Jauh - Manual)
      const curFocusDist = eff.cameraFocusDistance !== undefined ? eff.cameraFocusDistance : 0;
      const valFocusDist = document.getElementById('val-camera-focus-dist');
      if (valFocusDist) {
        valFocusDist.textContent = `${Math.round(curFocusDist)} px`;
      }
      updateJogScrubberVisuals(document.getElementById('jog-camera-focus-dist'), curFocusDist, 0, 4000);

      // 4b. Dynamic Focus to Layer UI
      const labelFocusLayer = document.getElementById('label-camera-focus-layer');
      const valFocusLayerDist = document.getElementById('val-camera-focus-layer-dist');
      if (focusMode === 'layer') {
        const targetLayer = (currentProjectState.layers || []).find(l => l.id === layer.cameraFocusTargetLayerId);
        if (targetLayer) {
          if (labelFocusLayer) labelFocusLayer.textContent = targetLayer.name || 'Layer';
          const targetEff = (typeof getLayerEffectivePropsAtTime === 'function')
            ? getLayerEffectivePropsAtTime(targetLayer, currentSec)
            : targetLayer;
          const targetZ = Math.round(targetEff.posZ || 0);
          if (valFocusLayerDist) {
            valFocusLayerDist.textContent = `Z: ${targetZ >= 0 ? '+' : ''}${targetZ} px`;
          }
        } else {
          if (labelFocusLayer) labelFocusLayer.textContent = 'Select Layer...';
          if (valFocusLayerDist) valFocusLayerDist.textContent = 'Z: 0 px';
        }
      }

      // 5. Blur Range / Falloff
      const curFocusRange = eff.cameraBlurNearFar !== undefined ? eff.cameraBlurNearFar : 600;
      const valFocusRange = document.getElementById('val-camera-focus-range');
      if (valFocusRange) {
        valFocusRange.textContent = `${Math.round(curFocusRange)} px`;
      }
      updateJogScrubberVisuals(document.getElementById('jog-camera-focus-range'), curFocusRange, 1, 2000);

      // 6. Value Blur (Blur Amount)
      const curBlurAmount = eff.cameraBlurAmount !== undefined ? eff.cameraBlurAmount : 20;
      const valBlurAmount = document.getElementById('val-camera-blur-amount');
      if (valBlurAmount) {
        valBlurAmount.textContent = `${Math.round(curBlurAmount)} px`;
      }
      updateJogScrubberVisuals(document.getElementById('jog-camera-blur-amount'), curBlurAmount, 0, 100);

      // 7. Blur Balance
      const curBlurBalance = eff.cameraBlurBalance !== undefined ? eff.cameraBlurBalance : 0;
      const valBlurBalance = document.getElementById('val-camera-blur-balance');
      if (valBlurBalance) {
        const bal = Math.round(curBlurBalance);
        valBlurBalance.textContent = bal === 0 ? '0 (Balanced)' : (bal < 0 ? `${bal} (Front)` : `+${bal} (Back)`);
      }
      updateJogScrubberVisuals(document.getElementById('jog-camera-blur-balance'), curBlurBalance, -100, 100);
    }
    window.syncCameraSettingsUI = syncCameraSettingsUI;

    function updateCameraKeyframeBtnState() {
      const btn = document.getElementById('btn-camera-keyframe');
      const btnGraph = document.getElementById('btn-camera-graph');
      const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
      if (!layer || layer.type !== 'camera') {
        if (btn) btn.classList.remove('is-active');
        if (btnGraph) {
          btnGraph.disabled = true;
          btnGraph.classList.add('is-disabled');
        }
        return;
      }
      const pps = window.currentPixelsPerSecond || 80;
      const currentSec = Math.abs(window.timelinePanX || 0) / pps;
      const prop = window.activeKeyframeProperty || 'cameraLens';
      const kf = (typeof getKeyframeAtTime === 'function') ? getKeyframeAtTime(layer, prop, currentSec) : null;
      if (btn) btn.classList.toggle('is-active', !!kf);
      if (btnGraph) {
        const kfList = (layer.keyframes && layer.keyframes[prop]) || [];
        const canOpen = kfList.length >= 2;
        btnGraph.disabled = !canOpen;
        btnGraph.classList.toggle('is-disabled', !canOpen);
      }
    }
    window.updateCameraKeyframeBtnState = updateCameraKeyframeBtnState;

    (function initCameraController() {
      // 1. Open Camera settings view from Layer Action Button
      const btnLayerCamera = document.getElementById('btn-layer-camera-settings');
      if (btnLayerCamera) {
        btnLayerCamera.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('camera');
        });
      }

      // 2. Back button: Camera -> Main Layer Actions
      const btnCameraBack = document.getElementById('btn-camera-back');
      if (btnCameraBack) {
        btnCameraBack.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('main');
        });
      }

      // 3. Keyframe button: Toggle Keyframe for active camera property
      const btnCameraKeyframe = document.getElementById('btn-camera-keyframe');
      if (btnCameraKeyframe) {
        btnCameraKeyframe.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!window.activeKeyframeProperty || !window.activeKeyframeProperty.startsWith('camera')) {
            window.activeKeyframeProperty = 'cameraLens';
          }
          toggleKeyframeAtCurrentTime();
          updateCameraKeyframeBtnState();
        });
      }

      // 4. Graph button: Camera -> Graph Editor
      const btnCameraGraph = document.getElementById('btn-camera-graph');
      if (btnCameraGraph) {
        btnCameraGraph.addEventListener('click', (e) => {
          e.stopPropagation();
          window.previousDrawerSubview = 'camera';
          const targetId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size > 0 ? [...window.selectedLayerIds][0] : null);
          const layer = (currentProjectState.layers || []).find(l => l.id === targetId);
          if (layer && layer.isOverlapCamera && (!layer.keyframes || !layer.keyframes['cameraLens'] || layer.keyframes['cameraLens'].length === 0)) {
            window.activeKeyframeProperty = 'move';
          } else if (!window.activeKeyframeProperty || !window.activeKeyframeProperty.startsWith('camera')) {
            window.activeKeyframeProperty = 'cameraLens';
          }
          const curProp = window.activeKeyframeProperty || 'cameraLens';
          const kfList = (layer && layer.keyframes && layer.keyframes[curProp]) || [];
          if (kfList.length < 2) return;
          switchLayerDrawerSubview('graph');
        });
      }

      // Helper: Make Project Asset Button Draggable
      function makeDraggableAsset(btn, assetData) {
        if (!btn || btn._assetDraggableWired) return;
        btn._assetDraggableWired = true;
        btn.draggable = true;
        btn.addEventListener('dragstart', (e) => {
          window._draggedProjectAsset = assetData;
          btn.classList.add('is-dragging');
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'copy';
            try {
              e.dataTransfer.setData('application/json', JSON.stringify(assetData));
              e.dataTransfer.setData('text/plain', assetData.name || 'Project Asset');
            } catch (_) {}
          }
        });
        btn.addEventListener('dragend', () => {
          window._draggedProjectAsset = null;
          btn.classList.remove('is-dragging');
          if (typeof window.hideTimelineDropIndicator === 'function') {
            window.hideTimelineDropIndicator();
          }
          const previewEl = document.getElementById('editor-preview-container');
          if (previewEl) previewEl.classList.remove('is-asset-dragover');
        });
      }

      // 5. Add Camera Layer Button in Add Layer Drawer
      const btnAddCamera = document.getElementById('btn-add-camera');
      if (btnAddCamera) {
        makeDraggableAsset(btnAddCamera, { type: 'control', controlType: 'camera', name: 'Camera' });
        btnAddCamera.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          addCameraLayer();
        });
      }

      // 5-alt. Add Overlap Camera Layer Button in Add Layer Drawer
      const btnAddOverlapCamera = document.getElementById('btn-add-overlap-camera');
      if (btnAddOverlapCamera) {
        makeDraggableAsset(btnAddOverlapCamera, { type: 'control', controlType: 'overlap-camera', name: 'Overlap Camera' });
        btnAddOverlapCamera.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          addOverlapCameraLayer();
        });
      }

      // 5b. Add Null Layer Button in Add Layer Drawer
      const btnAddNull = document.getElementById('btn-add-null');
      if (btnAddNull) {
        makeDraggableAsset(btnAddNull, { type: 'control', controlType: 'null', name: 'Null' });
        btnAddNull.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          addNullLayer();
        });
      }

      // 5b-alt. Add Overlap Null Layer Button in Add Layer Drawer
      const btnAddOverlapNull = document.getElementById('btn-add-overlap-null');
      if (btnAddOverlapNull) {
        makeDraggableAsset(btnAddOverlapNull, { type: 'control', controlType: 'overlap-null', name: 'Overlap Null' });
        btnAddOverlapNull.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          addOverlapNullLayer();
        });
      }

      // 5c. Add Adjustment Layer Button in Add Layer Drawer
      const btnAddAdjustment = document.getElementById('btn-add-adjustment');
      if (btnAddAdjustment) {
        makeDraggableAsset(btnAddAdjustment, { type: 'control', controlType: 'adjustment', name: 'Adjustment' });
        btnAddAdjustment.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          addAdjustmentLayer();
        });
      }

      // 5c2. Add Solid Layer Button in Add Layer Drawer (Control Camera Layer panel)
      const btnAddSolid = document.getElementById('btn-add-solid');
      if (btnAddSolid) {
        makeDraggableAsset(btnAddSolid, { type: 'control', controlType: 'solid', name: 'Solid' });
        btnAddSolid.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          addSolidLayer();
        });
      }

      // 5d. Add Shape Layer Buttons in Add Layer Drawer
      function syncShapeButtonsUI() {
        if (typeof window === 'undefined') return;
        const registry = window.FishShapesRegistry;
        const shapeButtons = [
          { id: 'btn-add-shape-kotak', type: 'rectangle' },
          { id: 'btn-add-shape-segitiga', type: 'triangle' },
          { id: 'btn-add-shape-lingkaran', type: 'circle' },
          { id: 'btn-add-shape-bintang', type: 'star' },
          { id: 'btn-add-shape-poligon', type: 'polygon' },
          { id: 'btn-add-shape-kapsul', type: 'capsule' },
          { id: 'btn-add-shape-hati', type: 'heart' },
          { id: 'btn-add-shape-vector', type: 'vector' }
        ];

        shapeButtons.forEach(item => {
          const btn = document.getElementById(item.id);
          if (btn) {
            if (registry && typeof registry.renderSvg === 'function') {
              btn.innerHTML = registry.renderSvg(item.type);
            }
            if (!btn._shapeWired) {
              btn._shapeWired = true;
              makeDraggableAsset(btn, { type: 'shape', shapeType: item.type, name: item.type });
              btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                addShapeLayer(item.type);
              });
            }
          }
        });

        if (registry && typeof registry.getAll === 'function') {
          const allShapes = registry.getAll();
          allShapes.forEach(s => {
            const alias = (s.aliases && s.aliases[0]) ? s.aliases[0] : s.id;
            const btn = document.getElementById('btn-add-shape-' + alias) || document.getElementById('btn-add-shape-' + s.id);
            if (btn) {
              btn.innerHTML = registry.renderSvg(s.id);
              if (!btn._shapeWired) {
                btn._shapeWired = true;
                makeDraggableAsset(btn, { type: 'shape', shapeType: s.id, name: s.name || s.id });
                btn.addEventListener('click', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  addShapeLayer(s.id);
                });
              }
            }
          });
        }
      }
      syncShapeButtonsUI();
      window.syncShapeButtonsUI = syncShapeButtonsUI;

      // 5e. Edit Shape Button & Back Button in Timeline Layer Drawer
      const btnEditShape = document.getElementById('btn-layer-edit-shape');
      if (btnEditShape) {
        btnEditShape.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          switchLayerDrawerSubview('shape');
        });
      }
      const btnShapeBack = document.getElementById('btn-shape-back');
      if (btnShapeBack) {
        btnShapeBack.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          switchLayerDrawerSubview('main');
        });
      }

      // 5e-vec. Edit Vector Button, Back Button & Convert Shape to Vector Button
      const btnEditVector = document.getElementById('btn-layer-edit-vector');
      if (btnEditVector) {
        btnEditVector.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          switchLayerDrawerSubview('vector');
          if (typeof syncVectorControllerUI === 'function') {
            syncVectorControllerUI();
          }
        });
      }
      const btnVectorBack = document.getElementById('btn-vector-back');
      if (btnVectorBack) {
        btnVectorBack.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          switchLayerDrawerSubview('main');
        });
      }
      const btnConvertShapeVec = document.getElementById('btn-convert-shape-to-vector');
      if (btnConvertShapeVec) {
        btnConvertShapeVec.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          convertShapeLayerToVector();
        });
      }

      // 5f. Edit Text Button & Back Button in Timeline Layer Drawer
      const btnEditText = document.getElementById('btn-layer-edit-text');
      if (btnEditText) {
        btnEditText.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          switchLayerDrawerSubview('text');
          if (typeof syncTextControllerUI === 'function') {
            syncTextControllerUI();
          }
        });
      }
      const btnTextBack = document.getElementById('btn-text-back');
      if (btnTextBack) {
        btnTextBack.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          switchLayerDrawerSubview('main');
        });
      }

      // Drag handle tap to open if drawer is currently closed
      const layerDrawerEl = document.getElementById('timeline-layer-drawer');
      if (layerDrawerEl) {
        const dragHandle = layerDrawerEl.querySelector('.drawer-drag-handle');
        if (dragHandle) {
          dragHandle.addEventListener('click', (e) => {
            const isDrawerOpen = (window.Drawer && typeof window.Drawer.isOpen === 'function' && window.Drawer.isOpen('timeline-layer-drawer')) || layerDrawerEl.classList.contains('is-active');
            if (!isDrawerOpen && window.selectedLayerId) {
              e.preventDefault();
              e.stopPropagation();
              selectTimelineLayer(window.selectedLayerId, false);
            }
          });
        }
      }

      // Initialize Shape, Vector & Text Controller Jog Wheels & Toggles
      initShapeController();
      initVectorController();
      initTextController();

      // ==========================================================================
      // SUBVIEW 13: AUDIO BEATMARK CONTROLLER UI & ENGINE
      // ==========================================================================
      const _audioWaveformPeaksCache = new Map();
      const _audioDecodingPromises = new Map();

      function getTimelineCurrentSec() {
        const pps = window.currentPixelsPerSecond || 80;
        const pan = (typeof window.timelinePanX !== 'undefined') ? window.timelinePanX : 0;
        return Math.max(0, -pan / pps);
      }

      function formatTimecodeStr(sec) {
        if (typeof window.formatTimecode === 'function') {
          return window.formatTimecode(Math.round(sec * 1000));
        }
        const fps = 60;
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        const f = Math.floor((sec % 1) * fps);
        return `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
      }

      function getIsTimelinePlaying() {
        return !!(window.isTimelinePlaying);
      }

      function generateProceduralPeaks(seedStr, numBars = 120) {
        const peaks = new Float32Array(numBars);
        let hash = 0;
        const s = String(seedStr || 'audio');
        for (let i = 0; i < s.length; i++) {
          hash = ((hash << 5) - hash) + s.charCodeAt(i);
          hash |= 0;
        }
        const seed = Math.abs(hash) || 12345;
        let rng = seed;
        function nextRng() {
          rng = (rng * 1664525 + 1013904223) >>> 0;
          return (rng >>> 0) / 4294967296;
        }

        const beats = 12 + (seed % 8);
        for (let i = 0; i < numBars; i++) {
          const t = i / numBars;
          const macro = Math.sin(t * Math.PI) * 0.35 + 0.55;
          const phase = (t * beats) % 1;
          const pulse = Math.exp(-phase * 4.2);
          const noise = nextRng() * 0.38;
          const raw = (pulse * 0.48 + noise * 0.38 + 0.12) * macro;
          peaks[i] = Math.max(0.12, Math.min(0.95, raw));
        }
        return peaks;
      }

      async function getAudioPeaksForLayer(layer, targetBars = 800) {
        if (!layer) return generateProceduralPeaks('default', 120);
        const cacheKey = layer.mediaId || layer.id || 'audio';
        const cached = _audioWaveformPeaksCache.get(cacheKey);
        if (cached && cached.isReal) {
          return cached.peaks;
        }

        if (_audioDecodingPromises.has(cacheKey)) {
          return _audioDecodingPromises.get(cacheKey);
        }

        const decodePromise = (async () => {
          let audioSrc = layer.dataUrl;
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
              if (item.dataUrl) {
                audioSrc = item.dataUrl;
              } else if (item.blob) {
                try {
                  blobToRevoke = URL.createObjectURL(item.blob);
                  audioSrc = blobToRevoke;
                } catch (_) {}
              }
            }
          }

          if (!audioSrc && layer.mediaId && window.FishDatabase && typeof window.FishDatabase.getMedia === 'function') {
            try {
              const item = await window.FishDatabase.getMedia(layer.mediaId);
              if (item) {
                if (item.dataUrl) {
                  audioSrc = item.dataUrl;
                } else if (item.blob) {
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

          if (!audioSrc) {
            const fallback = generateProceduralPeaks(layer.id || layer.name || 'audio', targetBars);
            _audioWaveformPeaksCache.set(cacheKey, { peaks: fallback, isReal: false });
            return fallback;
          }

          try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) throw new Error('No AudioContext');
            const audioCtx = new AudioCtx();

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
              const response = await fetch(audioSrc);
              arrayBuffer = await response.arrayBuffer();
            }

            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            const channelData = audioBuffer.getChannelData(0);
            const numBars = Math.max(300, Math.min(1200, Math.round((audioBuffer.duration || 10) * 40)));
            const step = Math.max(1, Math.floor(channelData.length / numBars));
            const peaks = new Float32Array(numBars);

            for (let i = 0; i < numBars; i++) {
              let max = 0;
              const start = i * step;
              const end = Math.min(channelData.length, start + step);
              const sampleStride = Math.max(1, Math.floor((end - start) / 48));
              for (let j = start; j < end; j += sampleStride) {
                const val = Math.abs(channelData[j]);
                if (val > max) max = val;
              }
              peaks[i] = Math.max(0.08, Math.min(1.0, max));
            }

            _audioWaveformPeaksCache.set(cacheKey, { peaks, isReal: true });
            try { if (audioCtx.state !== 'closed') audioCtx.close(); } catch (_) {}
            if (blobToRevoke) {
              try { URL.revokeObjectURL(blobToRevoke); } catch (_) {}
            }
            return peaks;
          } catch (err) {
            console.warn('[AudioPeaks] Audio peak extraction fallback:', err);
            const fallback = generateProceduralPeaks(layer.id || layer.name || 'audio', targetBars);
            _audioWaveformPeaksCache.set(cacheKey, { peaks: fallback, isReal: false });
            return fallback;
          } finally {
            _audioDecodingPromises.delete(cacheKey);
          }
        })();

        _audioDecodingPromises.set(cacheKey, decodePromise);
        return decodePromise;
      }
      window.getAudioPeaksForLayer = getAudioPeaksForLayer;

      let _cachedWaveformColors = null;

      function renderBeatmarkWaveform(layer) {
        const canvas = document.getElementById('beatmark-waveform-canvas');
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          requestAnimationFrame(() => {
            if (window.currentDrawerSubview === 'beatmark') {
              renderBeatmarkWaveform(layer);
            }
          });
          return;
        }

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(rect.width * dpr);
        const h = Math.round(rect.height * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, w, h);

        const cacheKey = layer ? (layer.mediaId || layer.id || 'audio') : null;
        const entry = cacheKey && _audioWaveformPeaksCache.has(cacheKey) ? _audioWaveformPeaksCache.get(cacheKey) : null;
        let peaks = entry ? entry.peaks : null;
        if (!peaks || !entry.isReal) {
          if (!peaks) {
            peaks = generateProceduralPeaks(layer ? (layer.id || layer.name || 'audio') : 'audio', 120);
          }
          if (layer && !_audioDecodingPromises.has(cacheKey)) {
            getAudioPeaksForLayer(layer, 800).then(() => {
              if (window.currentDrawerSubview === 'beatmark') {
                renderBeatmarkWaveform(layer);
              }
            });
          }
        }

        const numBars = 120;
        const barStep = w / numBars;
        const barWidth = Math.max(2 * dpr, barStep * 0.65);
        const midY = h / 2;

        if (!_cachedWaveformColors) {
          try {
            const computedStyle = getComputedStyle(canvas);
            const primaryColor = computedStyle.getPropertyValue('--color-primary').trim() || '#98ce7b';
            const playedColor = computedStyle.getPropertyValue('--track-audio').trim() || primaryColor;
            const unplayedColor = computedStyle.getPropertyValue('--track-audio-dark').trim() || '#648250';
            _cachedWaveformColors = { primaryColor, playedColor, unplayedColor };
          } catch (_) {
            _cachedWaveformColors = { primaryColor: '#98ce7b', playedColor: '#98ce7b', unplayedColor: '#648250' };
          }
        }

        const barColor = _cachedWaveformColors.playedColor || '#98ce7b';
        ctx.fillStyle = barColor;

        for (let i = 0; i < numBars; i++) {
          const frac = i / numBars;
          const idx = Math.min(peaks.length - 1, Math.floor(frac * peaks.length));
          const peak = peaks[idx] !== undefined ? peaks[idx] : 0.2;
          const barHeight = Math.max(4 * dpr, peak * (h * 0.82));
          const x = i * barStep + (barStep - barWidth) / 2;
          const y = midY - barHeight / 2;

          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, y, barWidth, barHeight, 2 * dpr);
          } else {
            ctx.rect(x, y, barWidth, barHeight);
          }
          ctx.fill();
        }
      }

      function renderAudioClipWaveform(layer, clipEl) {
        if (!layer || layer.type !== 'audio' || !clipEl) return;
        const canvas = clipEl.querySelector('.timeline-audio-waveform-canvas');
        if (!canvas) return;

        const pps = window.currentPixelsPerSecond || 80;
        const clipW = Math.max(16, Math.round(layer.widthPx || ((layer.durationSec || 5) * pps)));
        const clipH = clipEl.offsetHeight || 38;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(clipW * dpr);
        const h = Math.round(clipH * dpr);

        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, w, h);

        const cacheKey = layer.mediaId || layer.id || 'audio';
        const entry = _audioWaveformPeaksCache.get(cacheKey);
        let peaks = entry ? entry.peaks : null;

        if (!peaks || !entry.isReal) {
          if (!peaks) {
            peaks = generateProceduralPeaks(cacheKey, 120);
          }
          getAudioPeaksForLayer(layer, 800).then(() => {
            if (clipEl && clipEl.isConnected) {
              renderAudioClipWaveform(layer, clipEl);
            }
          });
        }

        const isSelected = clipEl.classList.contains('is-selected') || (window.selectedLayerId === layer.id);

        if (isSelected) {
          const computedStyle = getComputedStyle(clipEl);
          const trackAudio = computedStyle.getPropertyValue('--track-audio').trim() || '#bbf29b';
          ctx.fillStyle = trackAudio;
          ctx.globalAlpha = 0.65;
        } else {
          ctx.fillStyle = 'rgba(14, 16, 21, 0.32)';
          ctx.globalAlpha = 1.0;
        }

        const mediaDur = Math.max(0.1, layer.mediaDuration || (layer.durationSec || 5));
        const offsetSec = Math.max(0, layer.sourceOffsetSec || 0);
        const clipDur = Math.max(0.05, layer.durationSec || (clipW / pps) || 5);

        const startRatio = Math.max(0, Math.min(1, offsetSec / mediaDur));
        const endRatio = Math.max(startRatio, Math.min(1, (offsetSec + clipDur) / mediaDur));

        const barStep = 3.5 * dpr;
        const barWidth = 2.2 * dpr;
        const numBars = Math.max(4, Math.floor(w / barStep));
        const midY = h / 2;
        const maxBarH = h * 0.74;
        const radius = 1 * dpr;
        const fullLen = peaks.length;

        for (let i = 0; i < numBars; i++) {
          const frac = startRatio + (i / numBars) * (endRatio - startRatio);
          const idx = Math.min(fullLen - 1, Math.floor(frac * fullLen));
          const peak = peaks[idx] !== undefined ? peaks[idx] : 0.2;
          const barH = Math.max(3 * dpr, peak * maxBarH);
          const x = Math.round(i * barStep);
          const y = Math.round(midY - barH / 2);

          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, y, barWidth, barH, radius);
          } else {
            ctx.rect(x, y, barWidth, barH);
          }
          ctx.fill();
        }
        ctx.globalAlpha = 1.0;
      }
      window.renderAudioClipWaveform = renderAudioClipWaveform;

      let _lastNeedlePlayState = null;
      let _cachedBeatmarkNeedle = null;
      let _cachedBeatmarkTimeDisplay = null;
      let _cachedBeatmarkPlaySvg = null;
      let _cachedBtnAddGiant = null;
      let _lastGiantIsNear = null;

      function updateBeatmarkPlayheadNeedle() {
        if (!_cachedBeatmarkNeedle || !_cachedBeatmarkNeedle.isConnected) {
          _cachedBeatmarkNeedle = document.getElementById('beatmark-waveform-needle');
          _cachedBeatmarkTimeDisplay = document.getElementById('beatmark-time-display');
          _cachedBeatmarkPlaySvg = document.getElementById('beatmark-play-icon');
          _cachedBtnAddGiant = document.getElementById('btn-add-beatmark-giant');
        }
        if (!_cachedBeatmarkNeedle) return;

        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        const currentSec = getTimelineCurrentSec();
        const layerStart = layer && layer.startSec !== undefined ? layer.startSec : 0;
        const layerDur = layer && layer.durationSec !== undefined ? layer.durationSec : (layer ? (layer.mediaDuration || 5) : 5);
        const relSec = currentSec - layerStart;
        const pct = (layerDur > 0) ? Math.max(0, Math.min(100, (relSec / layerDur) * 100)) : 0;

        _cachedBeatmarkNeedle.style.left = `${pct}%`;

        if (_cachedBeatmarkTimeDisplay) {
          _cachedBeatmarkTimeDisplay.textContent = formatTimecodeStr(currentSec);
        }

        if (_cachedBeatmarkPlaySvg) {
          const isPlayingNow = getIsTimelinePlaying();
          if (isPlayingNow !== _lastNeedlePlayState) {
            _lastNeedlePlayState = isPlayingNow;
            if (isPlayingNow) {
              _cachedBeatmarkPlaySvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
            } else {
              _cachedBeatmarkPlaySvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
            }
          }
        }

        if (_cachedBtnAddGiant) {
          const beatmarks = Array.isArray(currentProjectState.beatmarks) ? currentProjectState.beatmarks : [];
          const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60);
          const isNear = beatmarks.some(b => Math.abs(b - currentSec) <= 0.5 / fps);
          if (isNear !== _lastGiantIsNear) {
            _lastGiantIsNear = isNear;
            _cachedBtnAddGiant.classList.toggle('is-active', isNear);
          }
        }
      }
      window.updateBeatmarkPlayheadNeedle = updateBeatmarkPlayheadNeedle;

      function syncBeatmarkDrawerUI() {
        const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        const audioNameEl = document.getElementById('beatmark-audio-name');
        const countBadgeEl = document.getElementById('beatmark-count-badge');
        const pinsContainer = document.getElementById('beatmark-waveform-pins');

        if (audioNameEl) {
          audioNameEl.textContent = (layer && (layer.name || 'Audio Track')) || 'Audio Track';
        }

        const layerStart = layer && layer.startSec !== undefined ? layer.startSec : 0;
        const layerDur = layer && layer.durationSec !== undefined ? layer.durationSec : (layer ? (layer.mediaDuration || 5) : 5);
        const layerEnd = layerStart + layerDur;

        const beatmarks = Array.isArray(currentProjectState.beatmarks) ? currentProjectState.beatmarks : [];
        const layerBeatmarks = beatmarks.filter(b => b >= layerStart - 0.01 && b <= layerEnd + 0.01);

        if (countBadgeEl) {
          countBadgeEl.textContent = `${layerBeatmarks.length} beatmark${layerBeatmarks.length === 1 ? '' : 's'}`;
        }

        if (pinsContainer) {
          const frag = document.createDocumentFragment();
          layerBeatmarks.forEach(bm => {
            const pct = (layerDur > 0) ? Math.max(0, Math.min(100, ((bm - layerStart) / layerDur) * 100)) : 0;
            const pin = document.createElement('div');
            pin.className = 'beatmark-wf-pin';
            pin.style.left = `${pct}%`;
            pin.title = `Beatmark: ${formatTimecodeStr(bm)}`;
            frag.appendChild(pin);
          });
          pinsContainer.replaceChildren(frag);
        }

        updateBeatmarkPlayheadNeedle();
        renderBeatmarkWaveform(layer);
      }
      window.syncBeatmarkDrawerUI = syncBeatmarkDrawerUI;

      function initBeatmarkController() {
        // 1. Open Beatmark view from Layer Action Button
        const btnLayerBeatmark = document.getElementById('btn-layer-beatmark');
        if (btnLayerBeatmark) {
          btnLayerBeatmark.addEventListener('click', (e) => {
            e.stopPropagation();
            switchLayerDrawerSubview('beatmark');
          });
        }

        // 2. Back button: Beatmark -> Main
        const btnBeatmarkBack = document.getElementById('btn-beatmark-back');
        if (btnBeatmarkBack) {
          btnBeatmarkBack.addEventListener('click', (e) => {
            e.stopPropagation();
            switchLayerDrawerSubview('main');
          });
        }

        // 3. Previous Keyframe / Beatmark button
        const btnBeatmarkPrev = document.getElementById('btn-beatmark-prev');
        if (btnBeatmarkPrev) {
          btnBeatmarkPrev.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof navigateBeatmark === 'function') {
              navigateBeatmark(-1);
            } else if (typeof window.navigateBeatmark === 'function') {
              window.navigateBeatmark(-1);
            }
            if (typeof updateBeatmarkPlayheadNeedle === 'function') {
              updateBeatmarkPlayheadNeedle();
            }
            if (typeof syncBeatmarkDrawerUI === 'function') {
              syncBeatmarkDrawerUI();
            }
          });
        }

        // 4. Play / Pause button
        const btnBeatmarkPlay = document.getElementById('btn-beatmark-play');
        if (btnBeatmarkPlay) {
          btnBeatmarkPlay.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.FishAudioEngine && !window.FishAudioEngine.isUnlocked) {
              window.FishAudioEngine.unlock(e);
            }
            const playBtn = document.getElementById('editor-btn-play');
            if (playBtn) playBtn.click();
            updateBeatmarkPlayheadNeedle();
          });
        }

        // 5. Next Keyframe / Beatmark button
        const btnBeatmarkNext = document.getElementById('btn-beatmark-next');
        if (btnBeatmarkNext) {
          btnBeatmarkNext.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof navigateBeatmark === 'function') {
              navigateBeatmark(1);
            } else if (typeof window.navigateBeatmark === 'function') {
              window.navigateBeatmark(1);
            }
            if (typeof updateBeatmarkPlayheadNeedle === 'function') {
              updateBeatmarkPlayheadNeedle();
            }
            if (typeof syncBeatmarkDrawerUI === 'function') {
              syncBeatmarkDrawerUI();
            }
          });
        }

        // 4. Delete beatmark at current playhead
        const btnBeatmarkDelete = document.getElementById('btn-beatmark-delete');
        if (btnBeatmarkDelete) {
          btnBeatmarkDelete.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentSec = getTimelineCurrentSec();
            const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState?.fps, 10) || window.currentTimelineFps || 60);
            const tolerance = 0.5 / fps;
            const bms = Array.isArray(currentProjectState.beatmarks) ? currentProjectState.beatmarks : [];
            const idx = bms.findIndex(b => Math.abs(b - currentSec) <= tolerance);
            if (idx !== -1) {
              bms.splice(idx, 1);
              if (typeof renderTimelineBeatmarks === 'function') renderTimelineBeatmarks();
              if (typeof saveCurrentProjectBeatmarks === 'function') saveCurrentProjectBeatmarks();
              syncBeatmarkDrawerUI();
            }
          });
        }

        // 4b. Clean all beatmarks button
        const btnBeatmarkCleanAll = document.getElementById('btn-beatmark-clean-all');
        if (btnBeatmarkCleanAll) {
          btnBeatmarkCleanAll.addEventListener('click', (e) => {
            e.stopPropagation();
            const bms = Array.isArray(currentProjectState.beatmarks) ? currentProjectState.beatmarks : [];
            if (bms.length === 0) {
              if (typeof showEditorToast === 'function') {
                showEditorToast('Tidak ada beatmark untuk dibersihkan', 1800, 'info');
              }
              return;
            }
            currentProjectState.beatmarks = [];
            currentProjectState.markerNames = {};
            if (window.currentProjectState) {
              window.currentProjectState.beatmarks = [];
              window.currentProjectState.markerNames = {};
            }
            if (typeof renderTimelineBeatmarks === 'function') renderTimelineBeatmarks();
            if (typeof saveCurrentProjectBeatmarks === 'function') saveCurrentProjectBeatmarks(true);
            if (typeof window.saveDesktopMarkerNames === 'function') window.saveDesktopMarkerNames();
            if (typeof updateTimeBadgeBeatmarkState === 'function') updateTimeBadgeBeatmarkState();
            if (typeof syncDesktopMarkerLabels === 'function') syncDesktopMarkerLabels();
            syncBeatmarkDrawerUI();
            if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
              window.UndoRedoManager.recordSnapshot();
            }
            if (typeof showEditorToast === 'function') {
              showEditorToast('Semua beatmark berhasil dibersihkan', 1800, 'info');
            }
          });
        }

        // 5. Giant center button to add beatmark
        const btnAddGiant = document.getElementById('btn-add-beatmark-giant');
        if (btnAddGiant) {
          let lastHandledTime = 0;
          let lastPointerDownTime = 0;

          const executeAdd = (e, source) => {
            const now = performance.now();
            // Debounce threshold: 45ms protects against hardware switch/touchscreen bounce,
            // but fully allows fast spam tapping (up to 20 taps/sec)
            if (now - lastHandledTime < 45) {
              return;
            }
            lastHandledTime = now;

            btnAddGiant.classList.add('is-pressed');
            if (btnAddGiant._pressTimer) clearTimeout(btnAddGiant._pressTimer);
            btnAddGiant._pressTimer = setTimeout(() => btnAddGiant.classList.remove('is-pressed'), 35);

            if (typeof navigator.vibrate === 'function') {
              try { navigator.vibrate(15); } catch (_) {}
            }

            const isPlayingNow = (typeof getIsTimelinePlaying === 'function' && getIsTimelinePlaying());
            let addedSec = null;
            if (typeof toggleBeatmarkAtCurrentTime === 'function') {
              // Always pass 'add' mode during playback so rhythm taps never accidentally delete
              addedSec = toggleBeatmarkAtCurrentTime(isPlayingNow ? 'add' : 'toggle');
            }

            // High performance pin append during playback (O(1) DOM operation)
            if (isPlayingNow && typeof addedSec === 'number') {
              const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId) ||
                            (currentProjectState.layers || []).find(l => l.type === 'audio');
              const layerStart = layer && layer.startSec !== undefined ? layer.startSec : 0;
              const layerDur = layer && layer.durationSec !== undefined ? layer.durationSec : (layer ? (layer.mediaDuration || 5) : 5);
              const beatmarks = Array.isArray(currentProjectState.beatmarks) ? currentProjectState.beatmarks : [];
              const countBadgeEl = document.getElementById('beatmark-count-badge');
              if (countBadgeEl) {
                countBadgeEl.textContent = `${beatmarks.length} beatmark${beatmarks.length === 1 ? '' : 's'}`;
              }
              const pinsContainer = document.getElementById('beatmark-waveform-pins');
              if (pinsContainer && layerDur > 0) {
                const pct = Math.max(0, Math.min(100, ((addedSec - layerStart) / layerDur) * 100));
                const pin = document.createElement('div');
                pin.className = 'beatmark-wf-pin';
                pin.style.left = `${pct}%`;
                pin.title = `Beatmark: ${formatTimecodeStr(addedSec)}`;
                pinsContainer.appendChild(pin);
              }
            } else {
              syncBeatmarkDrawerUI();
            }
          };

          btnAddGiant.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            lastPointerDownTime = performance.now();
            executeAdd(e, 'pointerdown');
          });

          // Prevent ghost/synthetic clicks on mobile and tablet completely
          btnAddGiant.addEventListener('click', (e) => {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            if (performance.now() - lastPointerDownTime < 800) {
              return;
            }
            executeAdd(e, 'click');
          });

          btnAddGiant.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
              if (e.cancelable) e.preventDefault();
              e.stopPropagation();
              executeAdd(e, 'keydown');
            }
          });
        }

        // 6. Waveform scrubbing and seeking
        const wfWrapper = document.getElementById('beatmark-waveform-wrapper');
        if (wfWrapper) {
          let isScrubbingWaveform = false;

          const handleWaveformSeek = (e) => {
            const rect = wfWrapper.getBoundingClientRect();
            if (rect.width <= 0) return;
            const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

            const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
            const layerStart = layer && layer.startSec !== undefined ? layer.startSec : 0;
            const layerDur = layer && layer.durationSec !== undefined ? layer.durationSec : (layer ? (layer.mediaDuration || 5) : 5);
            const targetSec = layerStart + (pct * layerDur);

            if (typeof seekTimelineToTime === 'function') {
              seekTimelineToTime(targetSec, true);
            }
            updateBeatmarkPlayheadNeedle();
          };

          wfWrapper.addEventListener('pointerdown', (e) => {
            isScrubbingWaveform = true;
            try { wfWrapper.setPointerCapture(e.pointerId); } catch (_) {}
            handleWaveformSeek(e);
          });

          wfWrapper.addEventListener('pointermove', (e) => {
            if (!isScrubbingWaveform) return;
            handleWaveformSeek(e);
          });

          const stopScrub = (e) => {
            if (isScrubbingWaveform) {
              isScrubbingWaveform = false;
              try { wfWrapper.releasePointerCapture(e.pointerId); } catch (_) {}
            }
          };

          wfWrapper.addEventListener('pointerup', stopScrub);
          wfWrapper.addEventListener('pointercancel', stopScrub);
        }

        // Window resize observer to adapt waveform canvas
        window.addEventListener('resize', () => {
          if (window.currentDrawerSubview === 'beatmark') {
            const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
            renderBeatmarkWaveform(layer);
          }
        });
      }

      initBeatmarkController();

      function requestCameraRedraw() {
        if (!window._cameraRedrawRafPending) {
          window._cameraRedrawRafPending = true;
          requestAnimationFrame(() => {
            window._cameraRedrawRafPending = false;
            redrawComposition();
          });
        }
      }

      // 6. Camera Lens Focal Length Scrubber (12mm - 300mm)
      let initLensVal = 50;
      bindJogWheel(document.getElementById('jog-camera-lens'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          window.activeKeyframeProperty = 'cameraLens';
          const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, Math.abs(window.timelinePanX || 0) / (window.currentPixelsPerSecond || 80)) : layer;
          initLensVal = eff.cameraLens !== undefined ? eff.cameraLens : 50;
          updateCameraKeyframeBtnState();
        },
        onMove: (delta) => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const newLens = Math.max(12, Math.min(300, Math.round(initLensVal - delta * 0.4)));
          layer.cameraLens = newLens;
          layer.cameraLensPreset = newLens <= 35 ? 'wide' : (newLens >= 70 ? 'tele' : 'standard');
          const valEl = document.getElementById('val-camera-lens');
          if (valEl) valEl.textContent = `${newLens} mm`;
          updateJogScrubberVisuals(document.getElementById('jog-camera-lens'), newLens, 12, 300);
          requestCameraRedraw();
        },
        onEnd: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            recordLayerPropertyChange(layer, 'cameraLens');
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            syncCameraSettingsUI();
            updateCameraKeyframeBtnState();
            redrawComposition();
          }
        }
      });

      // 7. Depth of Field Blur Switch (OFF / ON)
      const blurBtns = document.querySelectorAll('#camera-blur-switch .segmented-switch-item');
      blurBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          layer.cameraBlurEnabled = (btn.dataset.blur === 'on');
          if (window.PreviewCacheManager && typeof window.PreviewCacheManager.invalidateAll === 'function') {
            window.PreviewCacheManager.invalidateAll();
          }
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          syncCameraSettingsUI();
          saveCurrentProjectLayers();
          redrawComposition();
        });
      });

      // 7b. Focus Target Mode Switch (VALUE vs TO LAYER)
      const focusModeBtns = document.querySelectorAll('#camera-focus-mode-switch .segmented-switch-item');
      focusModeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const mode = btn.dataset.focusMode || 'manual';
          layer.cameraFocusMode = mode;
          if (mode === 'layer' && !layer.cameraFocusTargetLayerId) {
            const otherLayer = (currentProjectState.layers || []).find(l => l.id !== layer.id && l.type !== 'camera');
            if (otherLayer) layer.cameraFocusTargetLayerId = otherLayer.id;
          }
          if (window.PreviewCacheManager && typeof window.PreviewCacheManager.invalidateAll === 'function') {
            window.PreviewCacheManager.invalidateAll();
          }
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          syncCameraSettingsUI();
          saveCurrentProjectLayers();
          redrawComposition();
        });
      });

      // 7c. Dynamic Focus Target Layer Dropdown
      const btnFocusLayerDropdown = document.getElementById('btn-camera-focus-layer-dropdown');
      const menuFocusLayer = document.getElementById('menu-camera-focus-layer');

      function closeFocusLayerDropdown() {
        if (menuFocusLayer) menuFocusLayer.style.display = 'none';
        if (btnFocusLayerDropdown) btnFocusLayerDropdown.setAttribute('aria-expanded', 'false');
      }

      function openFocusLayerDropdown() {
        if (!menuFocusLayer || !btnFocusLayerDropdown) return;
        const currentCamera = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
        if (!currentCamera || currentCamera.type !== 'camera') return;

        const pps = window.currentPixelsPerSecond || 80;
        const currentSec = Math.abs(window.timelinePanX || 0) / pps;

        menuFocusLayer.innerHTML = '';
        const eligibleLayers = (currentProjectState.layers || []).filter(l => l.id !== currentCamera.id && l.type !== 'camera');

        if (eligibleLayers.length === 0) {
          const empty = document.createElement('div');
          empty.style.padding = '8px';
          empty.style.fontSize = '11px';
          empty.style.color = 'var(--text-muted)';
          empty.textContent = 'No other layers in composition';
          menuFocusLayer.appendChild(empty);
        } else {
          eligibleLayers.forEach(l => {
            const itemBtn = document.createElement('button');
            itemBtn.type = 'button';
            itemBtn.className = 'camera-layer-option-item';
            const isSelected = (currentCamera.cameraFocusTargetLayerId === l.id);
            if (isSelected) itemBtn.classList.add('is-selected');

            const lEff = (typeof getLayerEffectivePropsAtTime === 'function')
              ? getLayerEffectivePropsAtTime(l, currentSec)
              : l;
            const lZ = Math.round(lEff.posZ || 0);

            itemBtn.innerHTML = `
              <span class="camera-layer-option-icon">
                <i class='fticon fticon-icon-22' style='width:12px;height:12px;font-size:12px;line-height:1;' aria-hidden='true'></i>
              </span>
              <span class="camera-layer-option-name">${l.name || 'Layer'}</span>
              <span class="camera-layer-option-z">Z: ${lZ >= 0 ? '+' : ''}${lZ}</span>
            `;

            itemBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              currentCamera.cameraFocusTargetLayerId = l.id;
              currentCamera.cameraFocusMode = 'layer';
              closeFocusLayerDropdown();
              if (window.PreviewCacheManager && typeof window.PreviewCacheManager.invalidateAll === 'function') {
                window.PreviewCacheManager.invalidateAll();
              }
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(currentCamera);
              syncCameraSettingsUI();
              saveCurrentProjectLayers();
              redrawComposition();
            });

            menuFocusLayer.appendChild(itemBtn);
          });
        }

        menuFocusLayer.style.display = 'flex';
        btnFocusLayerDropdown.setAttribute('aria-expanded', 'true');
      }

      if (btnFocusLayerDropdown) {
        btnFocusLayerDropdown.addEventListener('click', (e) => {
          e.stopPropagation();
          const isExpanded = btnFocusLayerDropdown.getAttribute('aria-expanded') === 'true';
          if (isExpanded) {
            closeFocusLayerDropdown();
          } else {
            openFocusLayerDropdown();
          }
        });
      }

      document.addEventListener('click', (e) => {
        if (menuFocusLayer && menuFocusLayer.style.display !== 'none') {
          if (!menuFocusLayer.contains(e.target) && !btnFocusLayerDropdown.contains(e.target)) {
            closeFocusLayerDropdown();
          }
        }
      });

      // 8. Jog Wheels Scrubbers Binding
      // A. Zoom Scrubber
      let initZoomVal = 100;
      bindJogWheel(document.getElementById('jog-camera-zoom'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          window.activeKeyframeProperty = 'cameraZoom';
          const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, Math.abs(window.timelinePanX || 0) / (window.currentPixelsPerSecond || 80)) : layer;
          initZoomVal = eff.cameraZoom !== undefined ? eff.cameraZoom : 100;
          updateCameraKeyframeBtnState();
        },
        onMove: (delta) => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const newZoom = Math.max(10, Math.min(400, Math.round(initZoomVal - delta * 0.4)));
          layer.cameraZoom = newZoom;
          const valEl = document.getElementById('val-camera-zoom');
          if (valEl) valEl.textContent = `${newZoom}%`;
          updateJogScrubberVisuals(document.getElementById('jog-camera-zoom'), newZoom, 10, 400);
          requestCameraRedraw();
        },
        onEnd: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            recordLayerPropertyChange(layer, 'cameraZoom');
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            syncCameraSettingsUI();
            updateCameraKeyframeBtnState();
            redrawComposition();
          }
        }
      });

      // B. Focus Distance Scrubber (Dekat / Jauh)
      let initFocusDist = 0;
      bindJogWheel(document.getElementById('jog-camera-focus-dist'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          window.activeKeyframeProperty = 'cameraFocusDistance';
          const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, Math.abs(window.timelinePanX || 0) / (window.currentPixelsPerSecond || 80)) : layer;
          initFocusDist = eff.cameraFocusDistance || 0;
          updateCameraKeyframeBtnState();
        },
        onMove: (delta) => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const newDist = Math.max(0, Math.min(4000, Math.round(initFocusDist - delta * 2)));
          layer.cameraFocusDistance = newDist;
          const valEl = document.getElementById('val-camera-focus-dist');
          if (valEl) valEl.textContent = `${newDist} px`;
          updateJogScrubberVisuals(document.getElementById('jog-camera-focus-dist'), newDist, 0, 4000);
          requestCameraRedraw();
        },
        onEnd: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            recordLayerPropertyChange(layer, 'cameraFocusDistance');
            if (window.PreviewCacheManager && typeof window.PreviewCacheManager.invalidateAll === 'function') {
              window.PreviewCacheManager.invalidateAll();
            }
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            syncCameraSettingsUI();
            updateCameraKeyframeBtnState();
            redrawComposition();
          }
        }
      });

      // C. Focus Range / Falloff Scrubber
      let initFocusRange = 600;
      bindJogWheel(document.getElementById('jog-camera-focus-range'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          window.activeKeyframeProperty = 'cameraBlurNearFar';
          const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, Math.abs(window.timelinePanX || 0) / (window.currentPixelsPerSecond || 80)) : layer;
          initFocusRange = eff.cameraBlurNearFar !== undefined ? eff.cameraBlurNearFar : 600;
          updateCameraKeyframeBtnState();
        },
        onMove: (delta) => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const newRange = Math.max(1, Math.min(2000, Math.round(initFocusRange - delta * 2)));
          layer.cameraBlurNearFar = newRange;
          const valEl = document.getElementById('val-camera-focus-range');
          if (valEl) valEl.textContent = `${newRange} px`;
          updateJogScrubberVisuals(document.getElementById('jog-camera-focus-range'), newRange, 1, 2000);
          requestCameraRedraw();
        },
        onEnd: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            recordLayerPropertyChange(layer, 'cameraBlurNearFar');
            if (window.PreviewCacheManager && typeof window.PreviewCacheManager.invalidateAll === 'function') {
              window.PreviewCacheManager.invalidateAll();
            }
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            syncCameraSettingsUI();
            updateCameraKeyframeBtnState();
            redrawComposition();
          }
        }
      });

      // D. Blur Amount / Intensity Scrubber
      let initBlurAmount = 20;
      bindJogWheel(document.getElementById('jog-camera-blur-amount'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          window.activeKeyframeProperty = 'cameraBlurAmount';
          const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, Math.abs(window.timelinePanX || 0) / (window.currentPixelsPerSecond || 80)) : layer;
          initBlurAmount = eff.cameraBlurAmount !== undefined ? eff.cameraBlurAmount : 20;
          updateCameraKeyframeBtnState();
        },
        onMove: (delta) => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const newAmt = Math.max(0, Math.min(100, Math.round(initBlurAmount - delta * 0.2)));
          layer.cameraBlurAmount = newAmt;
          const valEl = document.getElementById('val-camera-blur-amount');
          if (valEl) valEl.textContent = `${newAmt} px`;
          updateJogScrubberVisuals(document.getElementById('jog-camera-blur-amount'), newAmt, 0, 100);
          requestCameraRedraw();
        },
        onEnd: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            recordLayerPropertyChange(layer, 'cameraBlurAmount');
            if (window.PreviewCacheManager && typeof window.PreviewCacheManager.invalidateAll === 'function') {
              window.PreviewCacheManager.invalidateAll();
            }
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            syncCameraSettingsUI();
            updateCameraKeyframeBtnState();
            redrawComposition();
          }
        }
      });

      // E. Blur Balance Scrubber (Foreground vs Background Weight)
      let initBlurBal = 0;
      bindJogWheel(document.getElementById('jog-camera-blur-balance'), {
        onStart: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          window.activeKeyframeProperty = 'cameraBlurBalance';
          const eff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, Math.abs(window.timelinePanX || 0) / (window.currentPixelsPerSecond || 80)) : layer;
          initBlurBal = eff.cameraBlurBalance || 0;
          updateCameraKeyframeBtnState();
        },
        onMove: (delta) => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const newBal = Math.max(-100, Math.min(100, Math.round(initBlurBal - delta * 0.4)));
          layer.cameraBlurBalance = newBal;
          const valEl = document.getElementById('val-camera-blur-balance');
          if (valEl) {
            valEl.textContent = newBal === 0 ? '0 (Balanced)' : (newBal < 0 ? `${newBal} (Front)` : `+${newBal} (Back)`);
          }
          updateJogScrubberVisuals(document.getElementById('jog-camera-blur-balance'), newBal, -100, 100);
          requestCameraRedraw();
        },
        onEnd: () => {
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (layer) {
            recordLayerPropertyChange(layer, 'cameraBlurBalance');
            if (window.PreviewCacheManager && typeof window.PreviewCacheManager.invalidateAll === 'function') {
              window.PreviewCacheManager.invalidateAll();
            }
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            syncCameraSettingsUI();
            updateCameraKeyframeBtnState();
            redrawComposition();
          }
        }
      });

      // Direct Value Popovers for Camera Parameters
      function openCameraValueInput(badgeEl, options) {
        if (!badgeEl) return;
        if (typeof window.openValueInputPopover === 'function') {
          window.openValueInputPopover(badgeEl, options);
        } else {
          const res = prompt(options.title || 'Enter value', options.value);
          if (res !== null && !isNaN(parseFloat(res))) {
            if (options.onCommit) options.onCommit(parseFloat(res));
          }
        }
      }

      const valLensEl = document.getElementById('val-camera-lens');
      if (valLensEl) {
        valLensEl.title = 'Click to edit value';
        valLensEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const curVal = Math.round(layer.cameraLens !== undefined ? layer.cameraLens : 50);
          openCameraValueInput(valLensEl, {
            title: 'Focal Length',
            value: curVal,
            defaultValue: 50,
            min: 12,
            max: 300,
            step: 1,
            unit: 'mm',
            onCommit: (newVal) => {
              const clamped = Math.max(12, Math.min(300, Math.round(newVal)));
              layer.cameraLens = clamped;
              layer.cameraLensPreset = clamped <= 35 ? 'wide' : (clamped >= 70 ? 'tele' : 'standard');
              recordLayerPropertyChange(layer, 'cameraLens');
              syncCameraSettingsUI();
              redrawComposition();
              if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            }
          });
        });
      }

      const valZoomEl = document.getElementById('val-camera-zoom');
      if (valZoomEl) {
        valZoomEl.title = 'Click to edit value';
        valZoomEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const curVal = Math.round(layer.cameraZoom !== undefined ? layer.cameraZoom : 100);
          openCameraValueInput(valZoomEl, {
            title: 'Zoom',
            value: curVal,
            defaultValue: 100,
            min: 10,
            max: 400,
            step: 1,
            unit: '%',
            onCommit: (newVal) => {
              const clamped = Math.max(10, Math.min(400, Math.round(newVal)));
              layer.cameraZoom = clamped;
              recordLayerPropertyChange(layer, 'cameraZoom');
              syncCameraSettingsUI();
              redrawComposition();
              if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            }
          });
        });
      }

      const valFocusDistEl = document.getElementById('val-camera-focus-dist');
      if (valFocusDistEl) {
        valFocusDistEl.title = 'Click to edit value';
        valFocusDistEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const curVal = Math.round(layer.cameraFocusDistance || 0);
          openCameraValueInput(valFocusDistEl, {
            title: 'Focus Distance',
            value: curVal,
            defaultValue: 0,
            min: 0,
            max: 4000,
            step: 1,
            unit: 'px',
            onCommit: (newVal) => {
              const clamped = Math.max(0, Math.min(4000, Math.round(newVal)));
              layer.cameraFocusDistance = clamped;
              recordLayerPropertyChange(layer, 'cameraFocusDistance');
              syncCameraSettingsUI();
              redrawComposition();
              if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            }
          });
        });
      }

      const valFocusRangeEl = document.getElementById('val-camera-focus-range');
      if (valFocusRangeEl) {
        valFocusRangeEl.title = 'Click to edit value';
        valFocusRangeEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const curVal = Math.round(layer.cameraBlurNearFar !== undefined ? layer.cameraBlurNearFar : 600);
          openCameraValueInput(valFocusRangeEl, {
            title: 'Blur Range',
            value: curVal,
            defaultValue: 600,
            min: 1,
            max: 2000,
            step: 1,
            unit: 'px',
            onCommit: (newVal) => {
              const clamped = Math.max(1, Math.min(2000, Math.round(newVal)));
              layer.cameraBlurNearFar = clamped;
              recordLayerPropertyChange(layer, 'cameraBlurNearFar');
              syncCameraSettingsUI();
              redrawComposition();
              if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            }
          });
        });
      }

      const valBlurAmtEl = document.getElementById('val-camera-blur-amount');
      if (valBlurAmtEl) {
        valBlurAmtEl.title = 'Click to edit value';
        valBlurAmtEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const curVal = Math.round(layer.cameraBlurAmount !== undefined ? layer.cameraBlurAmount : 20);
          openCameraValueInput(valBlurAmtEl, {
            title: 'Blur Amount',
            value: curVal,
            defaultValue: 20,
            min: 0,
            max: 100,
            step: 1,
            unit: 'px',
            onCommit: (newVal) => {
              const clamped = Math.max(0, Math.min(100, Math.round(newVal)));
              layer.cameraBlurAmount = clamped;
              recordLayerPropertyChange(layer, 'cameraBlurAmount');
              syncCameraSettingsUI();
              redrawComposition();
              if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            }
          });
        });
      }

      const valBlurBalEl = document.getElementById('val-camera-blur-balance');
      if (valBlurBalEl) {
        valBlurBalEl.title = 'Click to edit value';
        valBlurBalEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
          if (!layer || layer.type !== 'camera') return;
          const curVal = Math.round(layer.cameraBlurBalance || 0);
          openCameraValueInput(valBlurBalEl, {
            title: 'Blur Balance',
            value: curVal,
            defaultValue: 0,
            min: -100,
            max: 100,
            step: 1,
            unit: '',
            onCommit: (newVal) => {
              const clamped = Math.max(-100, Math.min(100, Math.round(newVal)));
              layer.cameraBlurBalance = clamped;
              recordLayerPropertyChange(layer, 'cameraBlurBalance');
              syncCameraSettingsUI();
              redrawComposition();
              if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
            }
          });
        });
      }
    })();
})();
