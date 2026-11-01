/**
 * Extension Builder - Script editor (CodeMirror 6) with SDK helper panel.
 * Tabs: Handler (selected component logic) | Shared (helpers/state above the UI) | Output (generated file).
 */
(function (global) {
  'use strict';

  const Model = global.OFTBuilderModel;
  const Codegen = global.OFTBuilderCodegen;
  const { PALETTE } = global.OFTBuilderPalette;
  const { SDK, SNIPPETS } = global.OFTBuilderSDK;

  let cm = null, mode = 'handler', silent = false;
  let els = {};

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  function completions() {
    const sdk = SDK.map(s => ({ label: s.path, type: 'function', detail: s.sig, info: s.doc, apply: s.path }));
    const snip = SNIPPETS.map(s => ({ label: s.label, type: 'text', detail: 'snippet', apply: s.code }));
    const extra = ['ctx', 'ui', 'const', 'let', 'return', 'function', 'async', 'await', 'forEach', 'Math.round', 'Math.max', 'Math.min', 'Number', 'JSON.stringify'].map(l => ({ label: l, type: 'keyword' }));
    return sdk.concat(snip, extra);
  }

  function handlerDef() {
    const node = Model.selected();
    if (!node) return null;
    const d = PALETTE[node.type];
    return d && d.handler ? { node, handler: d.handler } : null;
  }

  function load() {
    const hd = handlerDef();
    const showEditor = mode === 'shared' || (mode === 'handler' && hd);
    els.cmHost.hidden = !showEditor;
    els.output.hidden = mode !== 'output';
    els.hint.hidden = !(mode === 'handler' && !hd);
    els.sigTop.hidden = els.sigBottom.hidden = !showEditor;
    els.helper.hidden = mode === 'output';

    if (mode === 'handler') {
      els.hint.textContent = Model.selected()
        ? 'This component has no logic. Select a Button, Input, Switch, Slider or Segmented.'
        : 'Select a component on the canvas to edit its logic.';
      if (hd) {
        els.sigTop.textContent = `${hd.node.type}.${hd.handler.name}(${hd.handler.params}) {`;
        els.sigBottom.textContent = '}';
        setDoc(hd.node.handler || '');
      }
    } else if (mode === 'shared') {
      els.sigTop.textContent = 'build(ui, ctx) {  // shared code runs before the UI is created';
      els.sigBottom.textContent = '  // ...components follow';
      setDoc(Model.data.shared || '');
    } else {
      els.output.textContent = Codegen.generate(Model.data);
    }
  }

  function setDoc(text) {
    if (cm.getValue() === text) return;
    silent = true; cm.setValue(text); silent = false;
  }

  function onEdit(code) {
    if (silent) return;
    if (mode === 'shared') Model.setShared(code);
    else if (mode === 'handler') { const hd = handlerDef(); if (hd) Model.setHandler(hd.node.id, code); }
  }

  function setMode(next) {
    mode = next;
    els.tabs.querySelectorAll('button').forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
    load();
  }

  function renderHelper(filter = '') {
    const f = filter.trim().toLowerCase();
    els.helperList.innerHTML = '';
    const add = (title, sub, doc, code) => {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'se-helper-item';
      row.innerHTML = `<b>${esc(title)}</b><small>${esc(sub)}</small><span>${esc(doc)}</span>`;
      row.addEventListener('click', () => { if (!els.cmHost.hidden) cm.insert(code); });
      els.helperList.appendChild(row);
    };
    SNIPPETS.filter(s => !f || s.label.toLowerCase().includes(f)).forEach(s => add(s.label, 'snippet', 'Insert code template', s.code));
    SDK.filter(s => !f || (s.path + ' ' + s.doc).toLowerCase().includes(f)).forEach(s => add(s.path, s.sig, s.doc, s.snippet));
  }

  function init(opts) {
    els = opts;
    cm = global.OFTCodeMirror.createEditor(els.cmHost, { doc: '', onChange: onEdit, completions: completions() });
    els.tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
    els.search.addEventListener('input', () => renderHelper(els.search.value));
    renderHelper();
    Model.on((kind) => {
      if (kind === 'props' || kind === 'meta') { if (mode === 'output') load(); return; }
      if (kind === 'script') { if (mode === 'output') load(); return; }
      load();
    });
    setMode('handler');
  }

  global.OFTBuilderScript = { init, setMode, refreshOutput: () => { if (mode === 'output') load(); } };
})(window);
