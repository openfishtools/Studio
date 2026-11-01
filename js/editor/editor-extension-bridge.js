/**
 * FishTools Studio — Thin Modular Extension Dispatcher
 * Routes tool invocations to self-contained extensions registered in Studio/Extension/*.js via CardBuilder.
 */
(function () {
  'use strict';

  function getSelectedLayersForFishTool() {
    if (!currentProjectState || !Array.isArray(currentProjectState.layers)) return [];
    let selected = [];
    if (typeof selectedLayerIds !== 'undefined' && selectedLayerIds.size > 0) {
      selected = currentProjectState.layers.filter(l => selectedLayerIds.has(l.id));
    }
    if (selected.length === 0 && typeof selectedLayerId !== 'undefined' && selectedLayerId) {
      const found = currentProjectState.layers.find(l => l.id === selectedLayerId);
      if (found) selected = [found];
    }
    return selected;
  }

  function executeFishTool(toolName, ...args) {
    if (!toolName) return false;

    const pcm = window.PreviewCacheManager;
    const beforeSnap = (pcm && typeof pcm.captureStateSnapshot === 'function')
      ? pcm.captureStateSnapshot()
      : null;

    let result = false;
    if (window.CardBuilder && typeof window.CardBuilder.runTool === 'function') {
      result = window.CardBuilder.runTool(toolName, ...args);
    }

    if (pcm && beforeSnap && typeof pcm.invalidateSmartDiff === 'function') {
      const changed = pcm.invalidateSmartDiff(beforeSnap);
      if (changed) {
        if (typeof invalidateEffectivePropsCache === 'function') invalidateEffectivePropsCache();
        if (typeof redrawComposition === 'function') redrawComposition('smartCache:' + String(toolName));
      }
    }
    return result;
  }

  window.getSelectedLayersForFishTool = getSelectedLayersForFishTool;
  window.editorExecuteFishTool = executeFishTool;
  window.executeFishTool = executeFishTool;

  // Convenience global aliases routing to modular extensions in Studio/Extension/*.js
  window.setAnchorPointForSelectedLayers = (pos) => executeFishTool('ANCHOR_POINT', pos);
  window.alignSelectedLayers = (mode) => executeFishTool(mode);
  window.generateAutoBeatmarks = (sens, maxBpm, minInterval) => executeFishTool('AUTO_MARK', sens, maxBpm, minInterval);
  window.createProceduralCube = (w, h, d, useLayer) => executeFishTool('CREATE_CUBE', w, h, d, useLayer);
  window.createProcedural3D = (type) => executeFishTool('GEN_3D_' + String(type || 'BOX').toUpperCase().replace('GEN_3D_', ''));
  window.createProcedural2Split = () => executeFishTool('GEN_3D_2SPLIT');
  window.createProcedural3Split = () => executeFishTool('GEN_3D_3SPLIT');
  window.createProceduralTunnel = () => executeFishTool('GEN_3D_TUNNEL');
  window.createProceduralMC = () => executeFishTool('GEN_3D_MC');

  // Cross-frame extension tool message listener
  if (typeof window !== 'undefined' && !window._fishToolBridgeListenerAdded) {
    window._fishToolBridgeListenerAdded = true;
    window.addEventListener('message', function (ev) {
      if (ev && ev.data && ev.data.type === 'fishtools-run-tool' && ev.data.tool) {
        const args = Array.isArray(ev.data.args) ? ev.data.args : [];
        executeFishTool(ev.data.tool, ...args);
      }
    });
  }
})();
