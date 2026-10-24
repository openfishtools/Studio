<!-- caveman-begin -->
Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Answer first: Answer, then reason, then next step.
- Kill ceremony: No greeting, hedging, pleasantries, recap, or closer.
- Short word: "fix" not "implement a solution for".
- Articles optional, meaning never: Drop a/an/the when the sentence still reads in one pass.
- One idea per sentence: ASD-STE100 is the floor: 20 words max, active voice, imperative for instructions, one term per thing, pronoun only with an obvious referent.
- Payload verbatim: Code blocks unchanged.
- Tool runs: bounded status: No text between routine calls.
- User's language: Compress the style, not the language.
- Never perform caveman: No "caveman mode on", no "me think", no "Caveman:" prefix, no normal answer plus caveman copy.

Switch: /caveman (default), /ultracave (fragments, each fact once), /megacave (Classical Chinese 文言文)
Stop: "stop caveman" or "normal mode"

Auto-Clarity: plain prose for security warnings, irreversible actions, step order a fragment could scramble, user confused. Resume after.

Boundaries: code, comments, commits, PRs, docs written normal.
Floor: code, commands, paths, numbers and error strings verbatim; never drop not/never/no/only.
<!-- caveman-end -->

# FishTools Studio AI Agent Guidelines

## 1. System Architecture & Component Map

OpenFishTools Studio is a zero-dependency, client-side web and desktop NLE (Non-Linear Editor) motion graphics and video editing workstation built with vanilla web technologies, WebCodecs, HTML5 Canvas, and Web Audio.

### 1.1 Core Workstation Interfaces & Entry Points
- `index.html` & `js/app/main.js`: Project manager & launcher. Handles IndexedDB local project storage, cloud template browser, share links, and QR modals.
- `editor.html` & `js/editor.js`: Responsive mobile/tablet/desktop NLE interface. Canvas layer compositor, transform controls, inspector, keyframe markers, and mobile timeline.
- `desktop.html` & `js/app/desktop.js`: Professional desktop NLE workstation featuring After Effects-style docked panels, track headers, timeline tracks, and graph editor.
- `server.js`: Zero-dependency local development server with SSE (Server-Sent Events) live reload, static file streaming, and Cloudflare tunnel support.
- `version.json`: Single source of truth (SSOT) for repository version.

### 1.2 Restructured Domain Directory Layout
The codebase is organized into clean, domain-categorized directories:
- `Studio/js/app/`: Application bootstrap, desktop workstation shell, template editor, and PWA installation (`main.js`, `desktop.js`, `template-editor.js`, `pwa-install.js`).
- `Studio/js/core/`: Core 2D/3D affine transformation matrix pipeline, multi-layer canvas rendering, camera projections, text layout, motion blur, and wireframe overlay (`fishtool-engine.js`, `motion-blur-engine.js`, `text-engine.js`, `canvas-overlay.js`, `wireframe.js`).
- `Studio/js/media/`: Audio/video processing, frame extraction, cache, export, and streaming (`fish-export-engine.js`, `fish-audio-engine.js`, `videocomp-enggine.js`, `preview-cache.js`, `bg-removal-engine.js`, `video-stream-manager.js`, `video-decoder-worker.js`).
- `Studio/js/editor/`: 11 modular subsystems decomposed from monolithic `editor.js` (< 400 KB each).
- `Studio/js/extensions/`: Extension hosts, controllers, and bridges (`extension-manager.js`, `extensions.js`, `openfishtools-controller.js`, `openfishtools-generators3d.js`, `JSX-Translator.js`, `fishtools-adapter.js`, `attributes-clipboard.js`).
- `Studio/js/ui/`: UI controls, modal overlays, drawers, popovers, and widgets (`modal.js`, `drawer.js`, `popover.js`, `color-picker.js`, `context-menu.js`, `switch.js`, `sync-height.js`, `folderanim.js`, `elements/`).
- `Studio/js/plugins/`: Plugin extensions for shapes, typography, and procedural visual effects (`shapes/`, `text/`, `effects/`).
- `Studio/js/storage/`: IndexedDB client database persistence layer (`db.js`).
- `Studio/vendor/`: Third-party vendor dependencies (`jszip.min.js`, `mp4-muxer.js`, `qrcode.min.js`, `ffmpeg/`, `lamejs/`).
- `Studio/css/tokens/`: Central design system tokens and variables (`theme.css`).
- `Studio/css/layout/`: Page-level layouts (`layout.css`, `editor.css`, `desktop.css`).
- `Studio/css/components/`: Reusable UI component stylesheets (`modal.css`, `drawer.css`, `popover.css`, `context-menu.css`, `color-picker.css`, `switch.css`, `segmented-button.css`).
- `Studio/css/panels/`: Dedicated tool panel stylesheets (`transform-controller.css`, `effects-rack.css`, `text-format.css`, `wireframe.css`, `template-editor.css`, `extensions.css`).
- `Studio/css/fixes/`: Platform and browser-specific fixes (`safari.css`).
- `Studio/Extension/`: Standalone `.jsx` card extensions executable in Studio (`actions.jsx`, `beat_effects.jsx`, `cube_generator.jsx`, `sticky_note.jsx`, `toolbox.jsx`, `extension_creator.jsx`, etc.).
- `Studio/effects/`: Standalone modular effect plugins registered directly via `FishEffectsRegistry.register({...})`, `manifest.json`, and `effects.wasm`.
- `Studio/fticons/`: Vector icon assets and font glyph definitions (`fticons.css`, `fticons.woff2`, `raw icons/`).
- `Studio/scripts/`: Build synchronizers, scope auditors, and test runners (`test-suite.js`, `static-scope-audit.js`, `sync-effects.js`, `sync-version.js`, `audit-effects.js`).

### 1.3 Modular Editor Architecture (`Studio/js/editor/`)
The legacy monolithic `editor.js` (~2 MB, 43k lines) has been decomposed into 11 cohesive domain modules, with each module strictly under the 400 KB ceiling:

| Module File | Approx. Size | Primary Scope & Responsibilities | Key Exported APIs |
|---|---|---|---|
| `editor-state.js` | ~154 KB | Project state management, undo/redo history, layer state persistence, dimensions, and editor lifecycle | `currentProjectState`, `resMap`, `UndoRedoManager`, `saveCurrentProjectLayers`, `getProjectDimensions`, `getProjectFps`, `teardownEditor`, `_editorAutoSaveIntervalId` |
| `editor-media.js` | ~147 KB | Media pool, layer media element ingestion, Fill/Stretch/Fit modes, video pooling, Object URL tracking | `layerMediaCache`, `getOrLoadLayerMedia`, `applyFlexibleMediaReplacement`, `releaseLayerMediaElement`, `trackStudioObjectUrl`, `revokeStudioObjectUrl`, `_studioObjectUrls`, `seekVideoToTime` |
| `editor-animation.js` | ~196 KB | Keyframe evaluation, cubic bezier curves, expressions, Graph Editor, effective props cache | `getLayerEffectivePropsAtTime`, `evaluateKeyframeAnimation`, `invalidateEffectivePropsCache`, `_effectivePropsCache`, `openGraphEditorModal` |
| `editor-canvas.js` | ~200 KB | Multi-layer canvas compositor, 2D/3D matrix projection, rAF render coalescing, zero-GC scratch buffers | `renderCanvasFrame`, `redrawComposition`, `_redrawRafId`, `_scratchActiveLayers`, `_scratchActiveVideos`, `invalidatePreviewCacheForLayer`, transform handles |
| `editor-inspector.js` | ~221 KB | Layer property inspection, transform controls (pos/scale/rot/skew/opacity), knobs, jog wheels, dials, blend/volume/speed subviews | `renderLayerInspector`, `updateTransformControls`, `syncInspectorValues`, `showTransformPropertyDrawer` |
| `editor-layers.js` | ~181 KB | Layer management (Camera, Null, Solid, Text, Shape, Video, Image, Audio, Precomp), 3D Camera controls, layer ordering, precomp hierarchy | `addNewLayer`, `duplicateLayer`, `deleteLayer`, `reorderLayers`, `createPrecompFromSelected`, `setup3DCameraControls` |
| `editor-effects.js` | ~151 KB | Visual effect processing, effects rack UI, parameter sliders/scrubbers, parameter popovers, effects gallery drawer, WebGL/WASM bridge | `renderEffectsRack`, `openEffectsGalleryModal`, `applyEffectToLayer`, `removeEffectFromLayer`, `FishEffectsRegistry` |
| `editor-timeline-core.js` | ~184 KB | Timeline ruler, playhead scrubbing, viewport zoom/pan, timecode formatting, transport loop, beatmarks | `seekTimelineToTime`, `playAnimationLoop`, `pausePlayback`, `updateRulerScale`, `setTimelineZoom`, `addTimelineBeatmark` |
| `editor-timeline-ops.js` | ~355 KB | Timeline layer tracks rendering, multi-selection, trimming, cut/split, precompose, reflow-guarded reorder handles | `renderTimelineLayers`, `selectTimelineLayer`, `selectedLayerId`, `selectedLayerIds`, `splitLayerAtPlayhead`, `trimLayerStart`, `trimLayerEnd`, `updateReorderHandlesContrast` |
| `editor-export.js` | ~131 KB | Client-side video export pipeline, WebCodecs MP4 encoding via `mp4-muxer`, ZIP image sequences, audio mixdown, OFTS package | `exportVideoMP4`, `exportImageSequenceZIP`, `exportAudioMixdownWAV`, `exportOFTSPackage`, `showExportModal` |
| `editor-extension-bridge.js` | ~93 KB | Host controller communication, CEP / JSX extension translation, action routing, 3D procedural bridges, layer alignment | `editorExecuteFishTool`, `executeFishTool`, `setAnchorPointForSelectedLayers`, `alignSelectedLayers`, `showEditorToast` |

### 1.4 Backward-Compatibility Facade (`Studio/js/editor.js`)
`Studio/js/editor.js` (~3 KB) serves as the backward-compatibility facade stub. It preserves 100% interoperability with all 373 public `window.*` globals, ensuring that existing callers (`desktop.js`, `openfishtools-controller.js`, `JSX-Translator.js`, and inline HTML event handlers) operate without breaking changes or regressions.

## 2. Runtime Performance Optimization (R6) & Memory Hygiene Protocols

The workstation implements strict performance and memory hygiene protocols across all hot execution paths:

### 2.1 Canvas rAF Render Coalescing
- **Function**: `window.redrawComposition(source, immediate)`
- **Mechanism**: Canvas redraw requests are coalesced onto the browser's display refresh rate using `requestAnimationFrame` (`_redrawRafId`, `_redrawRafScheduled`). Multiple synchronous state changes (e.g. slider scrubbing, layer property tweaks, keyframe edits) schedule at most one canvas redraw per display frame.
- **Immediate Bypass**: When instantaneous rendering is required (e.g., export step, screenshot capture, or force sync), `immediate = true` cancels any scheduled rAF and executes `renderCanvasFrame()` synchronously.

### 2.2 Scratch Buffer Reuse (Zero Per-Frame GC Pressure)
- In the hot frame rendering loop (`renderCanvasFrame` in `editor-canvas.js`), per-frame allocations are eliminated.
- Pre-allocated static scratch arrays and sets are reused across frames:
  - `_scratchActiveLayers.length = 0;`
  - `_scratchActiveVideos.length = 0;`
  - `_scratchRenderOrderLayers.length = 0;`
  - `_scratchLayersToRender.length = 0;`
  - `_scratchActiveIdSet.clear();`
  - `_scratchEulerRot.rotX = 0; _scratchEulerRot.rotY = 0; _scratchEulerRot.rotZ = 0;`
- This completely eliminates garbage collection thrashing and frame drops during 60fps canvas animation and timeline scrubbing.

### 2.3 Timeline DOM Scrubbing Reflow Suppression
- **Function**: `updateReorderHandlesContrast()` in `editor-timeline-ops.js`
- **Reflow Guard**: Querying `vp.clientWidth` causes forced synchronous layout (reflow). To prevent layout thrashing during active timeline interaction, `updateReorderHandlesContrast()` is strictly self-guarded:
  ```javascript
  if (window.isTimelinePlaying || window.isTimelineScrubbing || window.isTimelinePanning) return;
  ```
- Playhead updates, needle movements, and scrub line positions update via fast style transforms/left properties without touching or querying layout geometries during active interactions.

### 2.4 Passive Event Listeners (`{ passive: true }`)
- High-frequency event listeners across the workstation specify `{ passive: true }` whenever `preventDefault()` is not required:
  - Desktop split handles (`splitH`, `splitLeft`, `splitRight` in `js/app/desktop.js`).
  - Extension split handle (`splitExt` in `js/extensions/extensions.js`).
  - Timeline and canvas `wheel`, `pointermove`, `mousemove`, and `scroll` listeners.
- This offloads gesture and pointer dispatching to browser compositor threads, ensuring buttery-smooth 60-120fps interactions.

### 2.5 Object URL Lifecycle Registry
- **Registry**: `window._studioObjectUrls` (`Set`)
- **APIs**: `trackStudioObjectUrl(url)` and `revokeStudioObjectUrl(url)` in `editor-media.js`
- All dynamically generated `blob:` URLs (video assets, audio clips, image thumbnails, media pool items) must be registered via `trackStudioObjectUrl()`. When assets are removed, replaced, or during project teardown, URLs are systematically revoked via `URL.revokeObjectURL()` and deleted from the registry, preventing memory leaks.

### 2.6 Layer Media Element Release & Video Mount Pool Evacuation
- **API**: `releaseLayerMediaElement(layer)` in `editor-media.js`
- When layers are deleted or media replaced:
  1. Media elements (`HTMLVideoElement`, `HTMLAudioElement`) are paused and source cleared (`media.el.src = ''`).
  2. Audio routing is detached from `window.FishAudioEngine.detachMediaElement(media.el)`.
  3. Video DOM nodes are removed from `#editor-video-mount-pool`.
  4. GPU texture memory is immediately released by zeroing canvas dimensions: `freezeCanvas.width = 0; freezeCanvas.height = 0;`
  5. Backing scratch canvases for layer types are zeroed: `_textBufferCanvas`, `_shapeBufferCanvas`, `_precompBufferCanvas`, `_fillBufferCanvas`.
  6. Layer entries are cleared from `window.layerMediaCache`.

### 2.7 Centralized Teardown Routine & Auto-Save Interval Tracking
- **Interval Tracking**: Auto-save timer is tracked via `window._editorAutoSaveIntervalId` (cleared before setting a new interval).
- **Teardown API**: `window.teardownEditor({ flushSave = true, revokeAllObjectUrls = true })`
- Coordinates clean destruction of editor instances during project switching or navigation:
  1. Flushes pending layer saves to IndexedDB (`saveCurrentProjectLayers(true)`).
  2. Stops transport playback (`pausePlayback(false)`).
  3. Clears auto-save interval (`_editorAutoSaveIntervalId`) and all debounce timers (`saveLayersDebounceTimer`, `_parkAudioTimer`, etc.).
  4. Cancels all animation frames (`_canvasRedrawRaf`, `_desktopRAF`, `_mobileRAF`, `_playAnimationId`).
  5. Pauses audio engine (`FishAudioEngine.pauseAll()`).
  6. Releases all media elements and empties `#editor-video-mount-pool`.
  7. Clears preview RAM cache workers (`PreviewCacheManager.stopIdleWorker()`, `clearAll()`).
  8. Invalidates effective props cache (`invalidateEffectivePropsCache()`).
  10. Revokes all registered Object URLs in `_studioObjectUrls`.

## 3. Error Investigation & Diagnostic Protocol (MANDATORY)
When debugging errors, unexpected behavior, or UI bugs:
1. **Access Localhost**: Start the local dev server (`node server.js` or `npm start`) and navigate to `http://localhost:3000` (or `/desktop.html`, `/editor.html`, `/index.html`).
2. **Inspect Browser & Page**: Access the rendered page, inspect DOM structure, and check DevTools console logs.
3. **Capture Screenshots**: Take visual screenshots of the interface to verify layout alignment, theme contrast, and rendering glitches.
4. **Diagnostic Tooling (Read-Only)**: Use Node.js and Python **strictly for read-only diagnostics** (e.g. running AST scope audits, parsing logs, analyzing test matrices).

## 4. Strict File Manipulation Tooling (NO SCRIPT-BASED EDITS)
- **STRICTLY FORBIDDEN**: Using Python scripts, Node.js scripts, `sed`, `awk`, `echo >`, `cat << 'EOF'`, or shell redirection to edit or generate code files.
- **MANDATORY**: All file creations and code modifications MUST strictly use the agent's native tool calls (`replace_file_content` or `write_to_file`).

## 5. UI Design Rules (Strict Flat & Performance Aesthetics)
- **NO Heavy Effects**: Banned `backdrop-filter: blur()`, `filter: blur()`, `box-shadow`, `drop-shadow()`, `text-shadow`.
- **NO Gradients**: Only flat solid colors from `css/tokens/theme.css` tokens.
- **NO Outlines / Unnecessary Borders**: `outline: none;` globally. Clean borderless surfaces.
- **Pure Flat & Fast**: High performance, crisp vector lines, 100% Cal Sans typography.

## 6. Pop-up & Drawer Navigation Rules
- **Modular Architecture**: All popups/drawers must use universal `.modal-backdrop` & `.modal-card` from `css/components/modal.css` and `js/ui/modal.js`.
- **Responsive Movement**:
  - **Mobile (<= 600px)**: Slide in from BOTTOM to TOP (`transform: translateY(100%)` -> `translateY(0)`). Full width bottom sheet (`width: 100%`) with top rounded corners (`border-radius: 28px 28px 0 0`).
  - **Tablet & Desktop (>= 601px)**: Center scale-in (`transform: scale(0.92)` -> `scale(1)`).
- **Close Triggers**: Clicking backdrop outside card closes the popup.
- **Native Back Button / Popstate Support**: Opening any modal pushes `history.pushState({ modalOpen: true }, '')`. Browser back closes modal without navigating away.

## 7. Strict Color Token Enforcement (`css/tokens/theme.css`) - MANDATORY
- **100% Theme Token Binding**: All colors MUST use CSS custom properties from `css/tokens/theme.css` (e.g. `var(--bg-canvas)`, `var(--bg-panel)`, `var(--color-primary)`, `var(--text-primary)`, `var(--text-secondary)`).
- **NO Hardcoded Colors**: Direct color literals (hex `#...`, `rgb()`, `rgba()`, `hsl()`) outside `css/tokens/theme.css` are STRICTLY FORBIDDEN in component code.
- **Seamless Theme Switching**: Every UI element must respond synchronously when `data-theme` changes.

## 8. Interactive Contrast & Hover State Rules
- **Simultaneous Foreground Adaptation**: When an element changes background on `:hover`, `:focus`, `:active`, or `.is-selected`, the inner content color MUST adapt to preserve contrast (e.g. invert text/icon from `var(--color-primary)` to `var(--bg-canvas)` when background becomes solid primary green).
- **Zero Invisibility**: Foreground and background must maintain high contrast across all states.

## 9. Modular Component Architecture
- **Strict Modularity**: Every new component MUST be built as a decoupled, standalone unit (`.modal-dropzone`, `.custom-dropdown`, `.timeline-split-handle`).
- **NO Demo File**: `demo.html` is permanently removed. Never recreate `demo.html`.

## 10. Splitter Handle Rules
- **Desktop (>= 601px)**: Pill splitter handle (`.timeline-split-handle`) for horizontal left/right resize (clamped 20% to 80%).
- **Mobile (<= 600px)**: Pill splitter handle (`.preview-split-handle`) for vertical preview/timeline resize (clamped 22% to 78%).

## 11. Vector Icon Assets Rules
- **Automatic SVG Generation**: When a component needs an icon and none exists in `assets/`, generate a crisp vector SVG in `assets/<name>.svg`.
- **Theme Color Token Binding**: SVGs must use `fill="currentColor"` (or `stroke="currentColor"`), viewBox `0 0 24 24`, clean geometric paths, and zero hardcoded colors.

## 12. Strict UI Scoping & Premature Mechanism Ban
- **NO Premature Workflows**: When user requests UI components (e.g. button, icon, tab), implement ONLY visual layout, CSS styling, and hover/press states.
- **Explicit Request Required**: Never invent, assume, or attach unrequested business logic or mutations unless explicitly commanded.

## 13. Modular JS Effects Architecture (`effects/`)
- **Plugin Architecture**: Layer effects are standalone `.js` files in `effects/<id>.js`.
- **Registry Pattern**: Effects register via `FishEffectsRegistry.register({...})`.
- **Manifest Synchronization**: Run `npm run sync:effects` after adding or editing effects.

## 14. Extension System Synchronization & Layer Mutation Rules (`Extension/`)
- **UI Dual-Source Sync**: When modifying any built-in extension UI or preset grid, update BOTH `Extension/<id>.jsx` AND the runtime renderer in `js/extensions/extension-manager.js`.
- **Action Dispatch Sync**: When adding, renaming, or changing extension actions/presets, synchronize all dispatch layers: `js/extensions/openfishtools-controller.js`, `js/extensions/JSX-Translator.js`, and `js/editor/editor-extension-bridge.js` (and the `js/editor.js` facade).
- **Window Scope Bridge**: `js/extensions/openfishtools-controller.js` runs in an IIFE; any editor function it calls (`setAnchorPointForSelectedLayers`, `alignSelectedLayers`, `editorExecuteFishTool`) MUST be exported on `window`.
- **Effective Props Cache Invalidation**: Whenever mutating layer transform/anchor properties (`x`, `y`, `anchorX`, `anchorY`, or `move` keyframes), always call `invalidateEffectivePropsCache()` (or `delete layer._effectivePropsCache`) before calling `draw()`, `redrawComposition()`, or `updatePlayheadPosition()`.

## 15. Unified Versioning & SSOT
- **Single Source of Truth**: Version is strictly defined in `version.json`.
- **Automated Synchronization**: Run `npm run bump <version>` to synchronize `package.json`, HTML badges, and cache busters.
- **NO Hardcoded Fallback Versions**: Never write fallback version literals in JavaScript.

## 16. Mandatory Quality & Test Verification

Before completing any task or pull request, all test suites must pass 100%:

### 16.1 Comprehensive Fast Suite (`npm test`)
```bash
npm test
```
Executes `node scripts/test-suite.js` across 4 verification phases:
- `[1/4] Syntax Verification`: `node --check` across all 140 JS files in the project.
- `[2/4] AST Scope & Undeclared Reference Audit`: Acorn-based static scope audit across all 140 application JS files (guaranteeing 0 undeclared references and 0 leaked globals).
- `[3/4] Synchronizers & System Sanity Check`: Executes `scripts/sync-effects.js` and `scripts/sync-version.js` to ensure generated manifests match disk state.
- `[4/4] HTML File Integrity & Structure Check`: Validates minimum line counts and critical structural markup for `index.html`, `editor.html`, and `desktop.html`.

### 16.2 Modular Editor File Size Verification
```bash
wc -c Studio/js/editor/*.js
```
Verifies that all 11 modular editor files in `Studio/js/editor/` strictly adhere to the < 400 KB (409,600 bytes) architectural ceiling.

## 17. Strict Git Safety & Working Tree Protection (NO UNNOTIFIED GIT OPERATIONS)
- **Zero Silent Git Changes**: STRICTLY FORBIDDEN to run `git checkout`, `git restore`, `git reset`, `git clean`, `git pull`, `git switch`, or any Git command that alters, overwrites, or discards local changes without explicit user consent.
- **No Remote Git Inspections/Checkouts Without Prior Notice**: Never check remote GitHub, fetch, pull, or checkout branches without explicitly informing and getting confirmation from the user first.
- **Absolute Preservation of Local State**: Always respect and preserve active uncommitted edits and untracked files. Never overwrite or discard user work in the working directory under any circumstance.

## 18. Zero Hardcoded Dimension Tunnels & Strict Fallback Policy
- **STRICTLY FORBIDDEN to Hardcode Composition Dimensions**: Never write fallback tunnels like `|| 1920`, `|| 1080`, or default `[1920, 1080]` when reading or calculating composition/layer dimensions.
- **Dynamic Resolution Order**: Always resolve composition dimensions strictly in order:
  1. `window.currentActivePrecomp` (if inside precompose)
  2. `currentProjectState._baseW` and `currentProjectState._baseH` (active backing canvas dimensions)
  3. `currentProjectState.baseW` and `currentProjectState.baseH`
  4. `currentProjectState.width` and `currentProjectState.height`
  5. `window.getProjectDimensions(ps.resolution, ps.aspectRatio)` (only when both parameters are explicitly present)
- **Toast Error on Failure, NO Fake Fallbacks**: If composition dimensions cannot be determined, NEVER invent fallback dimensions (which destroys 1:1 square, 9:16 portrait, or custom ratios). Immediately abort the operation and show an error toast (`showEditorToast('Gagal menentukan ukuran komposisi proyek', 2400, 'error')`).


