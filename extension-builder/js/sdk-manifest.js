/**
 * Extension Builder - SDK manifest.
 * Single source of truth for the helper panel + autocomplete.
 * To expose a new ctx method in the builder, add one entry here.
 * Entry: { path, sig, doc, snippet }
 */
(function (global) {
  'use strict';

  const SDK = [
    // --- Feedback -----------------------------------------------------------
    { group: 'Feedback', path: 'ctx.toast', sig: '(message, isError?)', doc: 'Show a toast notification.', snippet: "ctx.toast('Done!');" },
    { group: 'Feedback', path: 'ctx.showToast', sig: '(message, isError?)', doc: 'Alias of ctx.toast.', snippet: "ctx.showToast('Done!');" },

    // --- Project ------------------------------------------------------------
    { group: 'Project', path: 'ctx.project.getDimensions', sig: '() → {width,height,fps,pps,currentTime}', doc: 'Canvas size and timing. Also supports array destructuring [w, h].', snippet: 'const { width, height, fps } = ctx.project.getDimensions();' },
    { group: 'Project', path: 'ctx.project.commit', sig: '(reason?, layersToInvalidate?)', doc: 'Invalidate preview cache, save and redraw. Call after changing layers (use ctx.history.snapshot() first for undo).', snippet: "ctx.project.commit('My Tool', layer);" },
    { group: 'History', path: 'ctx.history.snapshot', sig: '()', doc: 'Record an undo snapshot. Call before changing layers.', snippet: 'ctx.history.snapshot();' },

    // --- Layers -------------------------------------------------------------
    { group: 'Layers', path: 'ctx.layers.getAll', sig: '() → Layer[]', doc: 'All layers in the project.', snippet: 'const layers = ctx.layers.getAll();' },
    { group: 'Layers', path: 'ctx.layers.getSelected', sig: '() → Layer[]', doc: 'Currently selected layers.', snippet: 'const selected = ctx.layers.getSelected();\nif (!selected.length) return ctx.toast(\'Select a layer first\', true);' },
    { group: 'Layers', path: 'ctx.layers.getActive', sig: '() → Layer|null', doc: 'Primary selected layer.', snippet: 'const layer = ctx.layers.getActive();' },
    { group: 'Layers', path: 'ctx.layers.select', sig: '(layerOrId, add?)', doc: 'Select a layer.', snippet: 'ctx.layers.select(layer);' },
    { group: 'Layers', path: 'ctx.layers.update', sig: '(layerOrId, patch)', doc: 'Patch layer properties.', snippet: 'ctx.layers.update(layer, { opacity: 50 });' },
    { group: 'Layers', path: 'ctx.layers.create', sig: '(type, opts?)', doc: 'Create a new layer.', snippet: "const layer = ctx.layers.create('adjustment', { name: 'My Layer' });" },
    { group: 'Layers', path: 'ctx.layers.isAudio', sig: '(layer) → boolean', doc: 'True if layer is audio.', snippet: 'if (ctx.layers.isAudio(layer)) return;' },

    // --- Timeline -----------------------------------------------------------
    { group: 'Timeline', path: 'ctx.timeline.getCurrentTime', sig: '() → seconds', doc: 'Playhead time.', snippet: 'const t = ctx.timeline.getCurrentTime();' },
    { group: 'Timeline', path: 'ctx.timeline.getPlayhead', sig: '() → seconds', doc: 'Alias of getCurrentTime.', snippet: 'const t = ctx.timeline.getPlayhead();' },
    { group: 'Timeline', path: 'ctx.timeline.seek', sig: '(seconds)', doc: 'Move playhead.', snippet: 'ctx.timeline.seek(0);' },
    { group: 'Timeline', path: 'ctx.timeline.getFps', sig: '() → number', doc: 'Project frame rate.', snippet: 'const fps = ctx.timeline.getFps();' },
    { group: 'Timeline', path: 'ctx.timeline.getPps', sig: '() → number', doc: 'Timeline pixels per second.', snippet: 'const pps = ctx.timeline.getPps();' },
    { group: 'Timeline', path: 'ctx.timeline.getBeatmarks', sig: '(layer?) → {time}[]', doc: 'Sorted markers of a layer (or global).', snippet: 'const marks = ctx.timeline.getBeatmarks(layer);' },
    { group: 'Timeline', path: 'ctx.timeline.setFPS', sig: '(fps)', doc: 'Set project frame rate.', snippet: 'ctx.timeline.setFPS(30);' },
    { group: 'Timeline', path: 'ctx.timeline.setFormat', sig: '(width, height)', doc: 'Set canvas size.', snippet: 'ctx.timeline.setFormat(1080, 1920);' },

    // --- Storage ------------------------------------------------------------
    { group: 'Storage', path: 'ctx.storage.get', sig: '(key, default?)', doc: 'Read a persisted value (per extension).', snippet: "const v = ctx.storage.get('key', 0);" },
    { group: 'Storage', path: 'ctx.storage.set', sig: '(key, value)', doc: 'Persist a value (per extension).', snippet: "ctx.storage.set('key', value);" },

    // --- Tools --------------------------------------------------------------
    { group: 'Tools', path: 'ctx.runTool', sig: '(toolName, ...args)', doc: 'Run a tool registered by another card.', snippet: "ctx.runTool('toolName');" }
  ];

  const SNIPPETS = [
    { label: 'for each selected layer', code: "const layers = ctx.layers.getSelected();\nif (!layers.length) return ctx.toast('Select a layer first', true);\nctx.history.snapshot();\nlayers.forEach(layer => {\n  // TODO: modify layer\n});\nctx.project.commit('My Tool', layers);" },
    { label: 'safe handler (try/catch)', code: "try {\n  // TODO\n} catch (err) {\n  ctx.toast(err.message, true);\n}" },
    { label: 'persisted counter', code: "const n = ctx.storage.get('count', 0) + 1;\nctx.storage.set('count', n);\nctx.toast('Count: ' + n);" }
  ];

  global.OFTBuilderSDK = { SDK, SNIPPETS };
})(window);
