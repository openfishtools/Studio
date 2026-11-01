/**
 * Extension Builder - Palette: component definitions.
 * Each entry maps 1:1 to a ui.* call of CardBuilder.
 * To add a component: add an entry here (+ a case in codegen.js / renderer.js).
 *
 * field kinds: text | number | bool | select | lines (one option per line "id:Label")
 * handler: { name, params, hint } -> generated as `name(params) { body }`
 */
(function (global) {
  'use strict';

  const PALETTE = {
    section: {
      label: 'Section', icon: 'title', group: 'Layout',
      fields: [
        { key: 'title', label: 'Title', kind: 'text', def: 'Section' },
        { key: 'subtitle', label: 'Subtitle', kind: 'text', def: '' }
      ]
    },
    text: {
      label: 'Text', icon: 'notes', group: 'Display',
      fields: [
        { key: 'text', label: 'Text', kind: 'text', def: 'Hello' },
        { key: 'variant', label: 'Variant', kind: 'select', def: 'label', options: ['label', 'display', 'hint'] }
      ]
    },
    button: {
      label: 'Button', icon: 'smart_button', group: 'Input',
      fields: [
        { key: 'label', label: 'Label', kind: 'text', def: 'BUTTON' },
        { key: 'icon', label: 'Icon (material name)', kind: 'text', def: 'bolt' },
        { key: 'title', label: 'Tooltip', kind: 'text', def: '' }
      ],
      handler: { name: 'onClick', params: 'e, ctx', hint: 'Runs when the button is clicked.', body: "ctx.toast('Clicked!');" }
    },
    input: {
      label: 'Input', icon: 'text_fields', group: 'Input',
      fields: [
        { key: 'type', label: 'Type', kind: 'select', def: 'text', options: ['text', 'number'] },
        { key: 'value', label: 'Default value', kind: 'text', def: '' },
        { key: 'placeholder', label: 'Placeholder', kind: 'text', def: '' }
      ],
      handler: { name: 'onChange', params: 'value, e, ctx', hint: 'Runs on every edit. `value` is a string.', body: '' }
    },
    textarea: {
      label: 'Textarea', icon: 'notes', group: 'Input',
      fields: [
        { key: 'value', label: 'Default value', kind: 'text', def: '' },
        { key: 'placeholder', label: 'Placeholder', kind: 'text', def: '' },
        { key: 'rows', label: 'Rows', kind: 'number', def: 4 }
      ],
      handler: { name: 'onChange', params: 'value, e, ctx', hint: 'Runs on every edit.', body: '' }
    },
    switch: {
      label: 'Switch', icon: 'toggle_on', group: 'Input',
      fields: [
        { key: 'label', label: 'Label', kind: 'text', def: 'Enabled' },
        { key: 'checked', label: 'Checked', kind: 'bool', def: false }
      ],
      handler: { name: 'onChange', params: 'checked, e, ctx', hint: '`checked` is a boolean.', body: '' }
    },
    slider: {
      label: 'Slider', icon: 'tune', group: 'Input',
      fields: [
        { key: 'label', label: 'Label', kind: 'text', def: 'Amount' },
        { key: 'min', label: 'Min', kind: 'number', def: 0 },
        { key: 'max', label: 'Max', kind: 'number', def: 100 },
        { key: 'step', label: 'Step', kind: 'number', def: 1 },
        { key: 'value', label: 'Value', kind: 'number', def: 50 }
      ],
      handler: { name: 'onChange', params: 'value, _e, ctx', hint: '`value` is a number.', body: '' }
    },
    segmented: {
      label: 'Segmented', icon: 'view_column', group: 'Input',
      fields: [
        { key: 'label', label: 'Label', kind: 'text', def: 'Mode' },
        { key: 'options', label: 'Options (id:Label per line)', kind: 'lines', def: 'a:Option A\nb:Option B' },
        { key: 'value', label: 'Selected id', kind: 'text', def: 'a' }
      ],
      handler: { name: 'onChange', params: 'value, opt, e, ctx', hint: '`value` is the selected option id.', body: '' }
    },
    grid: {
      label: 'Grid', icon: 'grid_view', group: 'Layout', container: true,
      fields: [{ key: 'cols', label: 'Columns', kind: 'number', def: 3 }]
    },
    formRow: {
      label: 'Form Row', icon: 'view_stream', group: 'Layout', container: true,
      fields: []
    }
  };

  const GROUP_ORDER = ['Layout', 'Input', 'Display'];

  function defaultProps(type) {
    const props = {};
    (PALETTE[type].fields || []).forEach(f => { props[f.key] = f.def; });
    return props;
  }

  global.OFTBuilderPalette = { PALETTE, GROUP_ORDER, defaultProps };
})(window);
