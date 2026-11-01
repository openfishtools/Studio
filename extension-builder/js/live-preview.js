/**
 * Extension Builder - Live preview: embeds the REAL Studio editor in an iframe and injects the draft extension into it.
 * Nothing is duplicated, so the preview is always 1:1 with the editor, and buttons run against the editor's real ctx.
 *
 *   desktop.html (>= 900px wide) or editor.html (mobile) -> CardBuilder.loadExtensionJS(code) -> FishExtensions.renderAll()
 *   Only the draft card is shown in the editor's Extensions panel/popover (other cards are hidden in the iframe).
 *
 * The iframe is same-origin, so it needs to be served by the Studio server (not opened via file://).
 *
 * TEMPORARY by design: the draft is only registered in the iframe's memory (loadExtensionJS with isCustom=false, so it is never
 * saved to oft_custom_extensions). The few localStorage keys a draft/the panel can touch are restored, and the scratch project
 * the embedded editor creates is deleted, when the builder closes.
 */
(function (global) {
  'use strict';

  const STORAGE_PREFIX = 'oft-ext-builder-preview-project:';
  const ISOLATE_STYLE_ID = 'oft-builder-isolate';

  let stage = null, msgEl = null, iframe = null;
  let page = '', ready = false, lastId = null, panelOpened = false;
  let latest = null, applyTimer = null, pollTimer = null;

  // ---- temporary-session guard: restore every shared localStorage key the preview may touch ----
  const GUARDED_KEYS = ['oft_desktop_extension_open', 'oft_extension_states', 'oft_custom_extensions'];
  const touched = new Map();    // key -> original value (null = did not exist)
  function remember(key) { if (!touched.has(key)) touched.set(key, localStorage.getItem(key)); }
  GUARDED_KEYS.forEach(remember);

  /** Undo anything the preview wrote: extension-panel open state, per-draft ctx.storage, enable states. */
  function restoreKey(key) {
    if (!touched.has(key)) return;
    const orig = touched.get(key);
    try { if (orig === null) localStorage.removeItem(key); else localStorage.setItem(key, orig); } catch (_) { /* ignore */ }
  }
  function restoreStorage() { touched.forEach((_, key) => restoreKey(key)); }

  function pickPage() { return window.innerWidth < 900 ? 'editor.html' : 'desktop.html'; }

  function showMsg(text, kind) {
    msgEl.textContent = text;
    msgEl.dataset.kind = kind || 'info';
    msgEl.hidden = !text;
  }

  /** Same-origin access to the embedded editor; null while it is still booting. */
  function editorWindow() {
    try {
      const w = iframe && iframe.contentWindow;
      if (!w || !w.document || w.document.readyState !== 'complete') return null;
      const ok = w.CardBuilder && w.FishExtensions && typeof w.FishExtensions.renderAll === 'function';
      return ok ? w : null;
    } catch (_) { return null; }
  }

  function create() {
    page = pickPage();
    ready = false; lastId = null; panelOpened = false;
    // reuse one scratch project so previews never pile up new projects in the user's list
    const saved = localStorage.getItem(STORAGE_PREFIX + page);
    iframe = document.createElement('iframe');
    iframe.title = 'Studio editor (live preview)';
    iframe.className = 'pv-iframe';
    iframe.src = saved ? `${page}?id=${encodeURIComponent(saved)}` : page;
    stage.appendChild(iframe);
    showMsg('Loading the editor…');
    iframe.addEventListener('load', waitForEditor);
    waitForEditor();   // start isolating immediately, before the editor renders its own cards
  }

  /** The editor adds ?id=<project> to its URL once it has created its scratch project (can be a moment after ready). */
  function trackScratchProject() {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      try {
        const id = new URL(iframe.contentWindow.location.href).searchParams.get('id');
        if (id) { localStorage.setItem(STORAGE_PREFIX + page, id); clearInterval(t); return; }
      } catch (_) { /* iframe navigating */ }
      if (tries > 40) clearInterval(t);
    }, 300);
  }

  /** The scratch project only exists to host the preview: remove it from the user's project list on exit. */
  function discardScratchProject() {
    ['desktop.html', 'editor.html'].forEach((pg) => {   // both layouts may have created one if the window was resized
      let id = null;
      try { id = localStorage.getItem(STORAGE_PREFIX + pg); } catch (_) { /* ignore */ }
      if (!id) return;
      try { const w = editorWindow(); if (w && w.FishDatabase) w.FishDatabase.deleteProject(id); } catch (_) { /* ignore */ }
      try {
        localStorage.removeItem('oft_active_project_backup_' + id);
        localStorage.removeItem(STORAGE_PREFIX + pg);
      } catch (_) { /* ignore */ }
    });
  }

  function waitForEditor() {
    clearInterval(pollTimer);
    const started = Date.now();
    pollTimer = setInterval(() => {
      try { if (latest) isolate(iframe.contentWindow, latest.meta.id); } catch (_) { /* not ready */ }
      const w = editorWindow();
      if (w) {
        clearInterval(pollTimer);
        ready = true;
        trackScratchProject();
        showMsg('');
        apply();
      } else if (Date.now() - started > 25000) {
        clearInterval(pollTimer);
        showMsg('The editor did not finish loading. Serve Studio over http (npm start) and reload.', 'error');
      }
    }, 100);
  }

  /**
   * Focus mode: hide every card in the editor's Extensions panel/popover except the draft (by id).
   * Installed as soon as the iframe has a document - even before the draft is injected, and also when the draft is
   * invalid/empty (then nothing is shown) - so the editor's own extensions never flash or clutter the preview.
   */
  function isolate(w, id) {
    try {
      const d = w.document;
      if (!d || !d.head) return;
      let st = d.getElementById(ISOLATE_STYLE_ID);
      if (!st) { st = d.createElement('style'); st.id = ISOLATE_STYLE_ID; d.head.appendChild(st); }
      const css = `.extension-card:not(#extension-card-${CSS.escape(id || '_none_')}) { display: none !important; } .extension-empty-state { display: none !important; }`;
      if (st.textContent !== css) st.textContent = css;
    } catch (_) { /* iframe is navigating */ }
  }

  /** Open the editor's Extensions panel/popover once (restores the saved layout flag right after). */
  function openPanelOnce(w) {
    if (panelOpened) return;
    const d = w.document;
    const trigger = d.getElementById('editor-btn-fishtool-trigger');
    const desktopPanel = d.getElementById('desktop-panel-extension');
    const popover = d.getElementById('popover-extensions');
    const isOpen = desktopPanel && w.getComputedStyle(desktopPanel).display !== 'none'
      || (!desktopPanel && popover && popover.classList.contains('is-open'));
    if (!isOpen && trigger) trigger.click();
    restoreKey('oft_desktop_extension_open');   // opening the panel must not change the user's saved layout preference
    panelOpened = true;
  }

  function apply() {
    if (!ready || !latest) return;
    const w = editorWindow();
    if (!w) { ready = false; waitForEditor(); return; }
    const { meta, code } = latest;
    const FE = w.FishExtensions;
    isolate(w, meta.id);   // before anything re-renders
    try {
      if (lastId && lastId !== meta.id) FE.unregister(lastId);   // id was renamed in the builder
      remember('oft_card_store_' + meta.id);   // the draft's ctx.storage lives here; restored on exit
      FE.unregister(meta.id);
      const check = global.OFTBuilderExport.validate(code);
      if (!check.valid) { lastId = null; FE.renderAll(); showMsg('Nothing to preview yet. ' + check.error.replace(' before exporting', ''), 'warn'); return; }
      const res = w.CardBuilder.loadExtensionJS(code, false, meta.id);
      if (!res.valid) { lastId = null; FE.renderAll(); showMsg(res.error, 'error'); return; }
      lastId = meta.id;
      FE.renderAll();
      openPanelOnce(w);
      showMsg('');
    } catch (err) {
      showMsg('Preview error: ' + err.message, 'error');
    }
  }

  const LivePreview = {
    init(opts) { stage = opts.stage; msgEl = opts.msg; },

    /** Called when the Preview view opens: boots the editor on first use, then syncs the draft. */
    show(snapshot) {
      latest = snapshot;
      if (!iframe) create();
      else { panelOpened = false; apply(); }
    },

    /** Called on every model change (debounced); no-op until the preview has been opened once. */
    /** Drop the draft and restore shared storage. Runs automatically when the builder page closes. */
    dispose() {
      clearTimeout(applyTimer); clearInterval(pollTimer);
      try { const w = editorWindow(); if (w && lastId) w.FishExtensions.unregister(lastId); } catch (_) { /* iframe already gone */ }
      lastId = null;
      restoreStorage();
      discardScratchProject();
    },

    update(snapshot) {
      latest = snapshot;
      if (!iframe) return;
      clearTimeout(applyTimer);
      applyTimer = setTimeout(apply, 400);
    }
  };

  // Crossing the 900px breakpoint needs the other editor layout (desktop.html <-> editor.html): reload the iframe.
  let resizeTimer = null;
  global.addEventListener('resize', () => {
    if (!iframe) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (pickPage() === page) return;
      clearInterval(pollTimer);
      iframe.remove(); iframe = null;
      create();
    }, 400);
  });

  global.addEventListener('pagehide', () => LivePreview.dispose());
  global.OFTBuilderLivePreview = LivePreview;
})(window);
