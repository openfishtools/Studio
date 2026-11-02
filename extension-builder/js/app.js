/**
 * Extension Builder - App bootstrap: palette UI, views/panels, live preview wiring, toolbar, shortcuts.
 * Theme is not switched here: it follows the Studio theme (oft_theme set from index.html).
 */
(function () {
  'use strict';

  const Model = window.OFTBuilderModel;
  const { PALETTE, GROUP_ORDER } = window.OFTBuilderPalette;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- toast
  let toastTimer = null;
  function toast(msg, isError) {
    const t = $('eb-toast');
    t.textContent = msg; t.hidden = false; t.classList.toggle('is-error', !!isError);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // -------------------------------------------------------------- palette
  function addTarget() {
    const sel = Model.selected();
    if (!sel) return { parentId: null, index: null };
    if (PALETTE[sel.type].container) return { parentId: sel.id, index: null };
    const r = Model.find(sel.id);
    return { parentId: r.parent ? r.parent.id : null, index: r.index + 1 };
  }

  function buildPalette() {
    const host = $('palette');
    GROUP_ORDER.forEach(group => {
      const types = Object.keys(PALETTE).filter(t => PALETTE[t].group === group);
      if (!types.length) return;
      const title = document.createElement('div');
      title.className = 'pal-group'; title.textContent = group;
      const grid = document.createElement('div');
      grid.className = 'pal-grid';
      types.forEach(type => {
        const def = PALETTE[type];
        const item = document.createElement('button');
        item.type = 'button'; item.className = 'pal-item'; item.dataset.type = type;
        item.innerHTML = `<span class="material-icons" aria-hidden="true">${def.icon}</span><span>${def.label}</span>`;
        item.addEventListener('pointerdown', (e) => {
          if (e.button !== undefined && e.button > 0) return;
          window.OFTBuilderCanvas.startDrag({ kind: 'new', type, label: def.label }, e);
        });
        item.addEventListener('click', () => {            // tap = add (drag releases elsewhere never click)
          const t = addTarget();
          Model.add(type, t.parentId, t.index);
          toast(`${def.label} added`);
        });
        grid.appendChild(item);
      });
      host.appendChild(title); host.appendChild(grid);
    });
  }

  // ----------------------------------------------------------------- tabs
  // Views (center): canvas | script | preview. Panels (bottom sheets on mobile): palette | props.
  function setView(view) {
    document.body.dataset.view = view;
    document.querySelectorAll('#center-tabs button').forEach(b => { const on = b.dataset.center === view; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
    if (view === 'preview') { closePanel(); window.OFTBuilderLivePreview.show(snapshot()); }
    else if (view === 'script') { closePanel(); if (window.OFTVisualScript) window.OFTVisualScript.refresh(); }
  }

  // Mobile: one panel at a time (palette = morph card, props = drawer). Opening one closes the other.
  const isMobileLayout = () => window.matchMedia('(max-width: 1023.98px)').matches;
  function openPanel(panel) {
    const prev = document.body.dataset.panel;
    document.body.dataset.panel = panel;
    document.querySelectorAll('button[data-panel]').forEach(b => {
      const on = b.dataset.panel === panel;
      b.classList.toggle('is-active', on);
      if (b.getAttribute('role') === 'tab') b.setAttribute('aria-selected', String(on));
    });
    $('fab-main').setAttribute('aria-expanded', String(panel === 'palette'));
    if (!isMobileLayout() || prev === panel) return;
    // move focus into the sheet (after its slide/morph), and back to the FAB when it closes
    setTimeout(() => {
      const pane = panel ? document.querySelector(`.float[data-pane="${panel}"]`) : null;
      const target = pane ? pane.querySelector('[data-close]') : $('fab-main');
      if (target) target.focus({ preventScroll: true });
    }, 380);
  }
  function closePanel() { openPanel(''); }

  // Desktop: independent floating cards (toggle visibility from the floating bar, collapse from each header)
  function togglePcPanel(name) {
    const pane = document.querySelector(`.float[data-pane="${name}"]`);
    const hidden = pane.classList.toggle('is-hidden');
    const t = document.querySelector(`#pc-toggles [data-pc="${name}"]`);
    t.classList.toggle('is-active', !hidden);
    t.setAttribute('aria-pressed', String(!hidden));
  }

  function setPropsTab(which) {
    $('ins-props').hidden = which !== 'props';
    $('ins-meta').hidden = which !== 'meta';
    document.querySelectorAll('#props-tabs button').forEach(b => { const on = b.dataset.ptab === which; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
  }

  // -------------------------------------------------------------- live preview
  // The preview is the real Studio editor (iframe) with the draft injected; see live-preview.js.
  const snapshot = () => ({ meta: Model.data.meta, code: window.OFTBuilderCodegen.generate(Model.data) });

  // --------------------------------------------------------------- toolbar
  function bindToolbar() {
    $('btn-undo').addEventListener('click', () => Model.undo());
    $('btn-redo').addEventListener('click', () => Model.redo());
    $('btn-new').addEventListener('click', () => {
      Model.reset();   // undoable, so no blocking confirm() dialog
      toast('New extension started — press Undo to bring the previous one back');
    });
    $('btn-copy').addEventListener('click', async () => toast((await window.OFTBuilderExport.copy()) ? 'Code copied' : 'Copy failed', false));
    $('btn-export').addEventListener('click', () => {
      const v = window.OFTBuilderExport.download();
      if (v.valid) toast(`Saved ${window.OFTBuilderExport.fileName()} — put it in Studio/Extension/`);
      else toast('Exported, but: ' + v.error, true);
    });
    $('btn-import').addEventListener('click', () => $('file-import').click());
    $('file-import').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { await window.OFTBuilderExport.importFile(f); toast('Imported ' + f.name); }
      catch (err) { toast(err.message, true); }
    });

    $('fab-main').addEventListener('click', () => openPanel('palette'));
    // [data-panel] buttons (drawer switch, card shortcuts) open that panel; opening one closes the others
    document.querySelectorAll('button[data-panel]').forEach(b => b.addEventListener('click', () => openPanel(b.dataset.panel)));
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closePanel));
    document.querySelectorAll('[data-collapse]').forEach(b => b.addEventListener('click', () => b.closest('.float').classList.toggle('is-collapsed')));
    $('pc-toggles').addEventListener('click', (e) => { const b = e.target.closest('button[data-pc]'); if (b) togglePcPanel(b.dataset.pc); });
    $('center-tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-center]'); if (b) setView(b.dataset.center); });
    $('props-tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-ptab]'); if (b) setPropsTab(b.dataset.ptab); });

    window.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.closest('.cm-editor');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? Model.redo() : Model.undo(); }
      else if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); Model.redo(); }
      else if (e.key === 'Escape' && document.body.dataset.panel) closePanel();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && Model.selectedId) { e.preventDefault(); Model.remove(Model.selectedId); }
    });
  }

  function refreshHistoryButtons() {
    $('btn-undo').disabled = !Model.canUndo();
    $('btn-redo').disabled = !Model.canRedo();
  }

  // ----------------------------------------------------------------- init
  function init() {
    Model.restore();
    buildPalette();
    bindToolbar();

    window.OFTBuilderLivePreview.init({ stage: $('pv-stage'), msg: $('pv-msg') });
    window.OFTBuilderCanvas.init({ viewport: $('cv-viewport'), stage: $('cv-stage'), indicator: $('cv-indicator'), ghost: $('cv-ghost') });
    window.OFTBuilderInspector.init({ propsHost: $('ins-props'), metaHost: $('ins-meta') });
    if (window.OFTBuilderScript && $('se-tabs')) {
      window.OFTBuilderScript.init({
        tabs: $('se-tabs'), cmHost: $('se-cm'), output: $('se-output'), hint: $('se-hint'),
        sigTop: $('se-sig-top'), sigBottom: $('se-sig-bottom'),
        helper: $('se-helper'), helperList: $('se-helper-list'), search: $('se-search')
      });
    }
    if (window.OFTVisualScript) window.OFTVisualScript.init();

    Model.on(() => {
      refreshHistoryButtons();
      if (document.body.dataset.view === 'preview') window.OFTBuilderLivePreview.update(snapshot());
    });
    refreshHistoryButtons();
    setPropsTab('props');
    setView('canvas');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
