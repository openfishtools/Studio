ROLE
You are working on OpenFishTools Studio (zero-dependency vanilla JS + native WebGL NLE).
Read AGENTS.md first and obey it fully. This prompt adds to AGENTS.md, never overrides it.
Goal: add an "Advance 3D" lighting pipeline. Default stays "Classic 3D", pixel-identical to today.

=====================================================================
0. HARD RULES (from AGENTS.md, restated because they are often broken)
=====================================================================
- Edit files ONLY with native tools (replace_file_content / write_to_file).
  NO python/node/sed/awk/echo/cat-heredoc to write or edit code. Scripts = read-only diagnostics.
- NO git command that changes or discards local state (checkout/restore/reset/clean/pull/switch).
  No remote git inspection without asking me. Never overwrite my uncommitted work.
- UI: flat only. No box-shadow, text-shadow, drop-shadow, backdrop-filter, filter: blur,
  gradients, outlines, hardcoded colors (#hex/rgb/hsl) in component code.
  Use var(--...) tokens from css/tokens/theme.css. No inline style="display:none";
  use an existing hidden/utility class or a new class in the right css/ folder.
  Hover/active/selected states must keep contrast (invert foreground when background changes).
- Reuse existing components exactly: .custom-dropdown, .modal-form-row, .settings-category,
  .modal-card/.modal-backdrop, switch, sliders, jog wheel. Copy the structure of a sibling
  element; do not invent new patterns.
- New icons: SVG in assets/<name>.svg, viewBox 0 0 24 24, currentColor, no hardcoded colors.
- Never hardcode composition dimensions (no || 1920 / 1080). Resolve dimensions in the order
  defined in AGENTS.md section 18. If unknown: abort and
  showEditorToast('Gagal menentukan ukuran komposisi proyek', 2400, 'error').
- Zero per-frame allocation in hot paths: use pre-allocated scratch arrays
  (same style as _scratchActiveLayers). No shader recompile during scrub/playback.
- After mutating layer props: invalidateEffectivePropsCache() then redrawComposition().
- Any new function called from HTML handlers, desktop.js, Extension/*.js or
  openfishtools-controller.js must be exported on window AND stay compatible with the
  editor.js facade. Tell me exactly which globals you add.
- Every file in Studio/js/editor/ must stay < 409,600 bytes. editor-timeline-ops.js is
  already ~355 KB: do NOT add meaningful code there. For large new code, propose a new
  small module (e.g. js/core/lighting.js or similar), tell me the script-tag/test-suite
  impact, and WAIT for my approval before creating it.
- Do not touch version.json / do not bump version unless I ask.
- Do not implement anything not listed in the current phase (AGENTS.md section 12).
  The logic listed below IS explicitly requested; nothing beyond it is.
- If anything is ambiguous, missing, or conflicts with existing code: ASK. Do not guess.
  If a function/ID I mention does not exist, say so; never invent names.

=====================================================================
1. WORKFLOW (applies to EVERY phase)
=====================================================================
Step A  READ: open every file you will modify. Reply with "Findings": real function names,
        variables, DOM IDs, and the existing pattern you will mirror (e.g. the function that
        creates a Camera/Null layer, how camera layers are excluded from render, how
        sibling settings categories sync in openProjectSettingsModal).
Step B  PLAN: numbered plan (file -> what changes -> risks). STOP and wait for my "go".
Step C  CODE: implement only that phase.
Step D  VERIFY: run `npm test` and `wc -c Studio/js/editor/*.js`. Report real results.
        For UI/render work, follow AGENTS.md section 3: start the dev server, open
        /editor.html and /desktop.html, check console, take screenshots (also light+dark theme).
        If you could not verify something, say so. Never claim success without evidence.
Step E  REPORT: files changed, what changed, manual test steps, acceptance checklist
        with pass/fail, known gaps. Then STOP. Do not start the next phase until I say "go phase N".
Reply style: terse (per AGENTS.md caveman rules). Code, comments, and docs written normal.

=====================================================================
2. FEATURE SPEC
=====================================================================
Three engine-level concepts:
 (a) Project setting "3D Engine": classic | advance
 (b) Light layers: point | sun | ambient (control layers, never rendered visibly)
 (c) Blinn-Phong shading on 3D mesh layers when engine = advance

Fixed limits and rules:
- Max 4 simultaneous lights; extra lights ignored (deterministic: timeline order).
- Lights only affect layers of the SAME composition level (inside a precomp, only that
  precomp's lights; the parent comp's lights do not leak in). Ask me if existing code makes
  this hard.
- A layer receives lighting ONLY if: engine === 'advance' AND layer is a 3D mesh shape
  (box/cone/cylinder/torus/pyramid/sphere) AND layer.materialOptions.acceptsLights !== false.
  Everything else (2D layers, flat layers with 3D transform, lights themselves) renders
  exactly as today. If you believe a flat layer with 3D transform should be lit, ASK first.
- "Catch" rule: 0 active lights at playhead -> flat, identical to current render.
  >=1 active light -> brightness comes ONLY from active lights. A face pointing away from a
  Point Light gets 0 direct light, unless an Ambient Light layer is active.

=====================================================================
PHASE 1: Setting + persistence (NO shader, NO lights)
=====================================================================
UI (editor.html AND desktop.html): new collapsible category "3D Engine",
id cat-settings-3d-engine, placed after "Color" and before "Engine & Performance".
Mirror the markup of a sibling category (header button, summary span
#summary-settings-3d-engine, chevron icon, body #body-settings-3d-engine).
Contents:
- Dropdown "Renderer" (#dropdown-3d-engine): Classic 3D (data-val classic, default) |
  Advance 3D (data-val advance).
- Container #settings-advance-3d-options (hidden unless Advance, via class not inline style):
  - Ambient Occlusion dropdown (#dropdown-ambient-occlusion): disabled | low | medium | high
  - Shadow Quality dropdown (#dropdown-shadow-quality): disabled | 512 | 1024 | 2048
    (labels: Disabled, Fast (512px), High (1024px), Ultra (2048px))
  These two are saved settings only for now. They do nothing yet.
State (editor-state.js):
- currentProjectState.threeDEngine ('classic'), .ambientOcclusion ('disabled'),
  .shadowQuality ('disabled'). Missing fields on old projects fall back to these defaults
  WITHOUT breaking or mutating old data unexpectedly.
- Sync in openProjectSettingsModal(), persist in saveProjectSettingsAction(), update the
  summary text, toggle the advance container immediately when the Renderer dropdown changes.
- On save: call redrawComposition('engineChange').
- Do NOT add updateEngineFeatureVisibility() behavior beyond what Phase 3 needs; if a
  function by that name does not exist, tell me.
Acceptance:
[ ] Category in both HTML files, correct position, theme tokens only
[ ] Advance options hidden on Classic, shown on Advance, instantly
[ ] Save -> reopen -> values persist; project reload persists
[ ] Old projects open as Classic, zero console errors
[ ] Rendering unchanged; npm test passes

=====================================================================
PHASE 2: Light layers (create + inspector rules, NO shading)
=====================================================================
Prerequisite: Phase 1 approved.
1. Add buttons #btn-add-point-light, #btn-add-sun-light, #btn-add-ambient-light inside
   #add-layer-control-grid (mobile drawer AND desktop panel). Visual layout + hover/press only
   for the buttons; their click wiring is part of item 2.
2. window.addLightLayer(lightType) - find the existing layer-creation function first and
   mirror ALL its fields (id, start/end time, track/order, defaults, undo snapshot,
   save trigger). Light data:
   { type:'light', lightType:'point'|'sun'|'ambient', color:<solid color from theme-safe
     default; if a white default needs a literal, ask me where existing code keeps it>,
     intensity:100, radius:600 (point only), acceptsLights:false }
   Defaults: point pos (0,0,-300) in the SAME coordinate convention existing 3D layers use
   (verify; do not assume); sun rot (-30,45,0); ambient no transform.
   Names auto-increment per type: "Point Light 1", "Sun Light 1", "Ambient Light 1"...
   Must go through undo/redo and autosave like other layers.
3. Inspector (editor-inspector.js, renderLayerInspector):
   - Point: position X/Y/Z + rotation enabled; scale and skew disabled.
   - Sun: rotation only; position, scale, skew disabled.
   - Ambient: all transforms disabled.
   - Show: Fill, Edit Light (#btn-layer-edit-light). Hide: Effects, Camera Settings, Beatmark.
   - Disabled controls use existing .is-disabled styling.
   - Fill subview for lights: solid color only; hide Gradient and Media options.
4. Edit Light subview (#layer-drawer-edit-light-view): Intensity slider 0-500% (all lights),
   Radius slider (Point only). Reuse existing slider/drawer-subview pattern and
   switchLayerDrawerSubview mechanism (verify real name). On change:
   invalidateEffectivePropsCache() + redrawComposition().
5. Lights are control layers: they must NOT render in preview output or export.
   Find how Camera/Null layers are excluded and follow the same mechanism
   (including export path in editor-export.js).
Acceptance:
[ ] Each light type can be added, appears on timeline, can be trimmed/moved/deleted/duplicated
[ ] Transform restrictions exactly as specified
[ ] Fill = solid only for lights
[ ] Lights invisible in final render and export
[ ] Save/load project keeps lights intact; undo/redo works
[ ] npm test passes, file sizes OK

=====================================================================
PHASE 3: Shading engine (core; NO AO, NO shadows)
=====================================================================
Prerequisite: Phase 2 approved.
Light collection:
- getActiveLightsAtPlayhead(sec): lights whose time range includes sec, max 4, written into
  a PRE-ALLOCATED module-level array/typed arrays. No new arrays/objects per frame.
  Use effective (animated) props at that time (getLayerEffectivePropsAtTime), so animated
  light position/intensity/rotation work.
Shader (fish3d.js):
- Compile ONCE. Engine switch or light count change = uniform updates only.
- Uniforms: u_numLights, u_lightTypes[4] (0 ambient, 1 sun, 2 point), u_lightColors[4],
  u_lightIntensities[4], u_lightPositions[4], u_lightDirections[4], u_lightRadii[4],
  u_materialParams (acceptsLights, diffuse, specular, roughness).
- Normals: first VERIFY every draw3D*Mesh (Box, Cone, Cylinder, Torus, Pyramid, Sphere) has
  correct normals and that they are transformed correctly with the layer's rotation
  (normal matrix, not the position matrix if non-uniform scale). If any mesh lacks normals,
  report BEFORE coding.
- Math: intensity 100% = 1.0 (range 0..5.0).
  ambient = sum(color*intensity)
  sun     = color*intensity*max(0, N.L), L = -direction derived from light rotation
  point   = color*intensity*max(0, N.L) * 1/(1+(d/radius)^2)
  specular = Blinn-Phong half-vector, scaled by material specular and roughness
  final = baseColor * (ambient+sun+point) * diffuse + specular
- numLights == 0 or engine classic or acceptsLights false -> unlit path identical to today.
Material (Edit 3D): button #btn-layer-edit-3d, visible only when engine = advance AND layer
is a 3D mesh layer. Subview #layer-drawer-edit-3d-view: Accepts Lights (switch),
Diffuse % (default 100), Specular % (default 50), Roughness % (default 50), stored in
layer.materialOptions (defaults true/100/50/50; missing field = defaults, not an error).
Update all draw3D*Mesh functions to pass uniforms. Keep the fishtool-engine.js changes minimal.
Acceptance:
[ ] Classic: pixel-identical to before (compare screenshots)
[ ] Advance + no lights: mesh flat
[ ] Advance + Point Light: facing side bright, far side dark
[ ] + Ambient Light: dark faces lifted uniformly
[ ] Sun rotation changes lit faces; moving Point Light updates in realtime
[ ] Animated light keyframes work; export frames match preview
[ ] Scrub/playback: no shader recompiles, no per-frame allocation (explain how you checked)
[ ] npm test passes, file sizes OK

=====================================================================
PHASE 4: Editor-only overlay
=====================================================================
Prerequisite: Phase 3 approved. Read existing _drawWireframes() and its projection/drawing
helpers first. Extend them; do not build a parallel system.
- Point: bulb icon at projected (X,Y,Z), XYZ gizmo, dashed circle for radius.
- Sun: sun icon + arrow along the rotation direction.
- Ambient: small status badge at top of viewer ("Ambient Light: <intensity>%").
- Colors: read from theme tokens (resolve CSS variables once and cache; no hardcoded
  literals, no per-frame getComputedStyle). Overlays never appear in export or screenshots
  taken for export.
Acceptance: overlays follow the selected light, match theme in light/dark, absent in export.

=====================================================================
PHASE 5 (only if I ask): Ambient Occlusion + Shadows
=====================================================================
Do NOT code. Propose 2 lightweight zero-dependency, mobile-safe approaches for each
(no full-screen SSAO), with trade-offs and cost estimates, then wait for my choice.

=====================================================================
START NOW
=====================================================================
Begin with Phase 1, Step A only: read the files and send "Findings".
Then send the Step B plan and wait for my "go".