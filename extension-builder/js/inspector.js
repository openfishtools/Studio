/**
 * Extension Builder - Inspector: property form for the selected node + extension metadata form.
 * Forms are generated from palette field schemas; typing never re-renders the form (keeps focus).
 */
(function (global) {
  'use strict';

  const Model = global.OFTBuilderModel;
  const { PALETTE } = global.OFTBuilderPalette;

  const CATEGORIES = ['Tools', 'Dashboard', 'Effects', 'Utility'];

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  function fieldRow(label, control) {
    const row = el('label', 'ins-row' + (control.type === 'checkbox' ? ' ins-switch' : ''));
    row.appendChild(el('span', 'ins-label', esc(label)));
    row.appendChild(control);
    return row;
  }

  function control(kind, value, onChange, field = {}) {
    let c;
    if (kind === 'bool') {
      c = el('input'); c.type = 'checkbox'; c.checked = !!value;
      c.addEventListener('change', () => onChange(c.checked));
    } else if (kind === 'select') {
      c = el('select', 'ins-input');
      (field.options || []).forEach(o => { const op = el('option', '', esc(o)); op.value = o; c.appendChild(op); });
      c.value = value;
      c.addEventListener('change', () => onChange(c.value));
    } else if (kind === 'lines') {
      c = el('textarea', 'ins-input'); c.rows = 4; c.value = value == null ? '' : value;
      c.addEventListener('input', () => onChange(c.value));
    } else if (kind === 'number') {
      c = el('input', 'ins-input'); c.type = 'number'; c.value = value;
      c.addEventListener('input', () => onChange(c.value === '' ? 0 : Number(c.value)));
    } else {
      c = el('input', 'ins-input'); c.type = 'text'; c.value = value == null ? '' : value;
      c.addEventListener('input', () => onChange(c.value));
    }
    return c;
  }

  function renderProps(host) {
    host.innerHTML = '';
    const node = Model.selected();
    if (!node) {
      host.appendChild(el('p', 'ins-empty', 'Select a component on the canvas to edit its properties.'));
      return;
    }
    const def = PALETTE[node.type];
    host.appendChild(el('div', 'ins-title', `<span class="material-icons" aria-hidden="true">${def.icon}</span> ${esc(def.label)}`));
    if (!def.fields.length) host.appendChild(el('p', 'ins-empty', 'This component has no properties. Drop components inside it.'));
    def.fields.forEach(f => {
      host.appendChild(fieldRow(f.label, control(f.kind, node.props[f.key], v => Model.setProp(node.id, f.key, v), f)));
    });
    if (def.handler) {
      host.appendChild(el('p', 'ins-hint', `Logic: edit <code>${def.handler.name}(${def.handler.params})</code> in the Script panel.`));
    }
  }

  function renderMeta(host) {
    host.innerHTML = '';
    const m = Model.data.meta;
    const text = (key, label) => host.appendChild(fieldRow(label, control('text', m[key], v => Model.setMeta(key, v))));
    text('name', 'Name');
    const idCtl = control('text', m.id, v => Model.setMeta('id', v.replace(/[^a-z0-9_]/gi, '_').toLowerCase()));
    host.appendChild(fieldRow('ID (file name)', idCtl));
    text('icon', 'Icon (material name)');
    text('description', 'Description');
    host.appendChild(fieldRow('Category', control('select', m.category, v => Model.setMeta('category', v), { options: CATEGORIES.includes(m.category) ? CATEGORIES : CATEGORIES.concat(m.category) })));
    host.appendChild(fieldRow('Enabled by default', control('bool', m.defaultEnabled !== false, v => Model.setMeta('defaultEnabled', v))));
  }

  function init(opts) {
    const refresh = (kind) => {
      if (kind === 'props' || kind === 'script') return;
      if (kind === 'meta') return;
      renderProps(opts.propsHost);
      renderMeta(opts.metaHost);
    };
    Model.on(refresh);
    refresh('structure');
  }

  global.OFTBuilderInspector = { init };
})(window);
