/**
 * OpenFishTools Studio - Editor Facade (Backward Compatibility Stub)
 * The monolithic editor.js has been decomposed into 11 cohesive domain modules in Studio/js/editor/:
 * 1.  editor-state.js             - Project state, UndoRedoManager, persistence, settings
 * 2.  editor-media.js             - Media cache, asset pool, video pooling, Fill/Stretch/Fit
 * 3.  editor-animation.js         - Easing curves, expressions, property evaluation, Graph Editor
 * 4.  editor-canvas.js            - renderCanvasFrame, 2D/3D composite, direct transform handles
 * 5.  editor-inspector.js         - Transform drawer, jog wheels, dials, blend/volume/speed subviews
 * 6.  editor-layers.js            - Layer creators (Camera, Null, Solid, Text, Shape) & 3D Camera
 * 7.  editor-effects.js           - Effects rack, gallery drawer, card scrubbers, param popovers
 * 8.  editor-timeline-core.js     - Ruler, timecode, zoom, playback transport, beatmarks, desktop tree
 * 9.  editor-timeline-ops.js      - renderTimelineLayers, multi-selection, trimming, cuts, precompose
 * 10. editor-export.js            - WebCodecs MP4, ZIP sequences, audio mixdown, OFTS package
 * 11. editor-extension-bridge.js  - Tool action router, 3D procedural bridges, layer alignment
 */

let timelineTweenRaf = null;

(function() {
  const EDITOR_MODULES = [
    'js/editor/editor-state.js',
    'js/editor/editor-media.js',
    'js/editor/editor-animation.js',
    'js/editor/editor-canvas.js',
    'js/editor/editor-inspector.js',
    'js/editor/editor-layers.js',
    'js/editor/editor-effects.js',
    'js/editor/editor-timeline-core.js',
    'js/editor/editor-timeline-ops.js',
    'js/editor/editor-export.js',
    'js/editor/editor-extension-bridge.js'
  ];

  if (typeof window !== 'undefined') {
    window.OpenFishEditorModules = EDITOR_MODULES;
    if (!window.currentProjectState && typeof console !== 'undefined' && console.warn) {
      console.warn('[OpenFishTools:Editor] Subsystems should be loaded via js/editor/*.js');
    }
  }
})();
