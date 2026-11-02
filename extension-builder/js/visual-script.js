/**
 * Extension Builder - Visual Scripting Subsystem (Scratch / Node Blocks)
 * Provides visual block-based logic construction for extension components.
 * 100% theme-native, toolbox matching palette.js, and mobile FAB drawer.
 */
(function (global) {
  'use strict';

  const Model = global.OFTBuilderModel;
  const { PALETTE } = global.OFTBuilderPalette;

  let currentTargetId = null; // Node id or '_shared'
  let currentTab = 'blocks';   // 'blocks' | 'code'
  let isInternalChange = false;

  const $ = (id) => document.getElementById(id);
  const uid = () => 'b_' + Math.random().toString(36).slice(2, 9);
  const isMobile = () => window.matchMedia('(max-width: 1023.98px)').matches;

  function showToast(msg) {
    const t = $('eb-toast');
    if (t) {
      t.textContent = msg;
      t.hidden = false;
      setTimeout(() => { t.hidden = true; }, 2200);
    }
  }

  // ---------------------------------------------------------------------------
  // Block Registry
  // ---------------------------------------------------------------------------
  const BLOCK_DEFS = {
    // --- History ---
    snapshot: {
      category: 'history',
      catLabel: 'History',
      label: 'Save Undo Snapshot',
      icon: 'history',
      desc: 'Record a history checkpoint before modifying layers.',
      code: () => 'ctx.history.snapshot();'
    },

    // --- Layers ---
    for_each_selected: {
      category: 'layer',
      catLabel: 'Layers',
      label: 'For Each Selected Layer',
      icon: 'layers',
      isCBlock: true,
      desc: 'Loops over currently selected layers in the composition.',
      code: (b, compileSlot) => {
        const inner = compileSlot(b.children || []);
        return `const selectedLayers = ctx.layers.getSelected();\nif (!selectedLayers.length) return ctx.toast('Select a layer first', true);\nselectedLayers.forEach(layer => {\n${inner || '  // (no actions)'}\n});`;
      }
    },
    update_prop: {
      category: 'layer',
      catLabel: 'Layers',
      label: 'Set Layer Property',
      icon: 'tune',
      fields: [
        {
          key: 'prop',
          type: 'select',
          options: [
            { id: 'opacity', label: 'Opacity (0-100)' },
            { id: 'scaleX', label: 'Scale X' },
            { id: 'scaleY', label: 'Scale Y' },
            { id: 'posX', label: 'Position X' },
            { id: 'posY', label: 'Position Y' },
            { id: 'rotZ', label: 'Rotation Z' },
            { id: 'name', label: 'Layer Name' },
            { id: 'blendMode', label: 'Blend Mode' }
          ],
          default: 'opacity'
        },
        {
          key: 'val',
          type: 'text',
          placeholder: 'value (e.g. 50)',
          default: '50'
        }
      ],
      code: (b) => {
        const prop = (b.props && b.props.prop) || 'opacity';
        let val = (b.props && b.props.val != null) ? String(b.props.val).trim() : '50';
        if (!val) val = '0';
        const isLiteral = !/^(\d+(\.\d+)?|value|layer\.[a-zA-Z0-9_]+|true|false)$/.test(val);
        const valExpr = isLiteral ? JSON.stringify(val) : val;
        return `ctx.layers.update(layer, { ${prop}: ${valExpr} });`;
      }
    },
    create_layer: {
      category: 'layer',
      catLabel: 'Layers',
      label: 'Create New Layer',
      icon: 'add_box',
      fields: [
        {
          key: 'type',
          type: 'select',
          options: [
            { id: 'adjustment', label: 'Adjustment' },
            { id: 'solid', label: 'Solid Color' },
            { id: 'text', label: 'Text' },
            { id: 'null', label: 'Null Object' }
          ],
          default: 'adjustment'
        },
        {
          key: 'name',
          type: 'text',
          placeholder: 'Layer Name',
          default: 'New Layer'
        }
      ],
      code: (b) => {
        const type = (b.props && b.props.type) || 'adjustment';
        const name = (b.props && b.props.name) || 'New Layer';
        return `const newLayer = ctx.layers.create('${type}', { name: ${JSON.stringify(name)} });`;
      }
    },
    select_layer: {
      category: 'layer',
      catLabel: 'Layers',
      label: 'Select Layer',
      icon: 'touch_app',
      fields: [
        {
          key: 'target',
          type: 'select',
          options: [
            { id: 'layer', label: 'Current loop layer' },
            { id: 'newLayer', label: 'Newly created layer' }
          ],
          default: 'layer'
        }
      ],
      code: (b) => {
        const target = (b.props && b.props.target) || 'layer';
        return `ctx.layers.select(${target});`;
      }
    },

    // --- Project ---
    commit: {
      category: 'project',
      catLabel: 'Project',
      label: 'Commit Changes',
      icon: 'save',
      fields: [
        {
          key: 'reason',
          type: 'text',
          placeholder: 'Reason for history',
          default: 'Tool Execution'
        }
      ],
      code: (b) => {
        const reason = (b.props && b.props.reason) || 'Tool Execution';
        return `ctx.project.commit(${JSON.stringify(reason)}, typeof selectedLayers !== 'undefined' ? selectedLayers : null);`;
      }
    },
    set_format: {
      category: 'project',
      catLabel: 'Project',
      label: 'Set Canvas Resolution',
      icon: 'aspect_ratio',
      fields: [
        { key: 'w', type: 'text', placeholder: 'Width', default: '1080' },
        { key: 'h', type: 'text', placeholder: 'Height', default: '1920' }
      ],
      code: (b) => {
        const w = (b.props && b.props.w) || '1080';
        const h = (b.props && b.props.h) || '1920';
        return `ctx.timeline.setFormat(${Number(w) || 1080}, ${Number(h) || 1920});`;
      }
    },

    // --- Timeline ---
    seek: {
      category: 'timeline',
      catLabel: 'Timeline',
      label: 'Seek Playhead (sec)',
      icon: 'fast_forward',
      fields: [
        { key: 'sec', type: 'text', placeholder: '0.0', default: '0' }
      ],
      code: (b) => {
        const sec = (b.props && b.props.sec) || '0';
        return `ctx.timeline.seek(${Number(sec) || 0});`;
      }
    },
    set_fps: {
      category: 'timeline',
      catLabel: 'Timeline',
      label: 'Set Project FPS',
      icon: 'speed',
      fields: [
        {
          key: 'fps',
          type: 'select',
          options: [
            { id: '24', label: '24 FPS' },
            { id: '30', label: '30 FPS' },
            { id: '60', label: '60 FPS' }
          ],
          default: '30'
        }
      ],
      code: (b) => {
        const fps = (b.props && b.props.fps) || '30';
        return `ctx.timeline.setFPS(${Number(fps) || 30});`;
      }
    },

    // --- Storage ---
    storage_set: {
      category: 'storage',
      catLabel: 'Storage',
      label: 'Save Stored Value',
      icon: 'archive',
      fields: [
        { key: 'key', type: 'text', placeholder: 'Key name', default: 'savedSetting' },
        { key: 'val', type: 'text', placeholder: 'Value or variable', default: 'value' }
      ],
      code: (b) => {
        const key = (b.props && b.props.key) || 'savedSetting';
        const val = (b.props && b.props.val != null) ? b.props.val : 'value';
        return `ctx.storage.set(${JSON.stringify(key)}, ${val});`;
      }
    },
    storage_get: {
      category: 'storage',
      catLabel: 'Storage',
      label: 'Load Stored Value',
      icon: 'unarchive',
      fields: [
        { key: 'key', type: 'text', placeholder: 'Key name', default: 'savedSetting' },
        { key: 'def', type: 'text', placeholder: 'Default value', default: '0' }
      ],
      code: (b) => {
        const key = (b.props && b.props.key) || 'savedSetting';
        const def = (b.props && b.props.def) || '0';
        return `const ${key} = ctx.storage.get(${JSON.stringify(key)}, ${def});`;
      }
    },

    // --- Feedback ---
    toast: {
      category: 'feedback',
      catLabel: 'Feedback',
      label: 'Show Toast Message',
      icon: 'chat',
      fields: [
        { key: 'msg', type: 'text', placeholder: 'Message text', default: 'Action completed!' },
        {
          key: 'isError',
          type: 'select',
          options: [
            { id: 'false', label: 'Normal / Success' },
            { id: 'true', label: 'Error Style (Red)' }
          ],
          default: 'false'
        }
      ],
      code: (b) => {
        const msg = (b.props && b.props.msg) || 'Done!';
        const isErr = (b.props && b.props.isError === 'true');
        return `ctx.toast(${JSON.stringify(msg)}${isErr ? ', true' : ''});`;
      }
    },

    // --- Control ---
    try_catch: {
      category: 'control',
      catLabel: 'Control',
      label: 'Safe Try / Catch',
      icon: 'shield',
      isCBlock: true,
      desc: 'Wraps inner blocks safely so errors show as red toasts instead of crashing.',
      code: (b, compileSlot) => {
        const inner = compileSlot(b.children || []);
        return `try {\n${inner || '  // (protected logic)'}\n} catch (err) {\n  ctx.toast(err.message, true);\n}`;
      }
    },
    if_condition: {
      category: 'control',
      catLabel: 'Control',
      label: 'If Condition',
      icon: 'alt_route',
      isCBlock: true,
      fields: [
        { key: 'cond', type: 'text', placeholder: 'e.g. value > 50', default: 'value' }
      ],
      code: (b, compileSlot) => {
        const cond = (b.props && b.props.cond) || 'value';
        const inner = compileSlot(b.children || []);
        return `if (${cond}) {\n${inner || '  // (condition met)'}\n}`;
      }
    },

    // --- Custom JS ---
    custom_code: {
      category: 'custom',
      catLabel: 'Custom JS',
      label: 'Custom JavaScript',
      icon: 'code',
      fields: [
        { key: 'code', type: 'textarea', placeholder: '// Write any JavaScript here', default: '// Custom code\n' }
      ],
      code: (b) => {
        return (b.props && b.props.code != null) ? b.props.code.trim() : '';
      }
    }
  };

  const CATEGORIES = [
    { id: 'history', label: 'History' },
    { id: 'layer', label: 'Layers' },
    { id: 'project', label: 'Project' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'storage', label: 'Storage' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'control', label: 'Control' },
    { id: 'custom', label: 'Custom' }
  ];

  // Logic Presets
  const PRESETS = [
    {
      name: 'Batch Modify Selected Layers',
      desc: 'Snapshot -> For each selected -> Set opacity -> Commit -> Toast',
      build: () => [
        createBlock('snapshot'),
        createBlock('for_each_selected', {}, [
          createBlock('update_prop', { prop: 'opacity', val: '50' })
        ]),
        createBlock('commit', { reason: 'Batch Modify Layers' }),
        createBlock('toast', { msg: 'Selected layers updated!', isError: 'false' })
      ]
    },
    {
      name: 'Add Adjustment Layer',
      desc: 'Snapshot -> Create Adjustment -> Select it -> Commit -> Toast',
      build: () => [
        createBlock('snapshot'),
        createBlock('create_layer', { type: 'adjustment', name: 'Color Grade FX' }),
        createBlock('select_layer', { target: 'newLayer' }),
        createBlock('commit', { reason: 'Add Adjustment Layer' }),
        createBlock('toast', { msg: 'Adjustment layer created!', isError: 'false' })
      ]
    },
    {
      name: 'Slider Real-time Property Sync',
      desc: 'Snapshot -> For each selected -> Apply slider value -> Commit',
      build: () => [
        createBlock('snapshot'),
        createBlock('for_each_selected', {}, [
          createBlock('update_prop', { prop: 'opacity', val: 'value' })
        ]),
        createBlock('commit', { reason: 'Slider Adjust' })
      ]
    },
    {
      name: 'Quick Notification Toast',
      desc: 'Show a success toast on click',
      build: () => [
        createBlock('toast', { msg: 'Button clicked!', isError: 'false' })
      ]
    }
  ];

  function createBlock(type, props = {}, children = []) {
    const def = BLOCK_DEFS[type];
    if (!def) return null;
    const defaultProps = {};
    (def.fields || []).forEach(f => {
      defaultProps[f.key] = props[f.key] !== undefined ? props[f.key] : f.default;
    });
    return {
      id: uid(),
      type,
      props: Object.assign({}, defaultProps, props),
      children: def.isCBlock ? children : undefined
    };
  }

  // ---------------------------------------------------------------------------
  // Target Resolution
  // ---------------------------------------------------------------------------
  function getScriptableNodes() {
    const list = [];
    (function scan(nodes) {
      (nodes || []).forEach(n => {
        const def = PALETTE[n.type];
        if (def && def.handler) list.push(n);
        if (n.children) scan(n.children);
      });
    })(Model.data.nodes);
    return list;
  }

  function getTargetNode() {
    if (currentTargetId === '_shared') return null;
    if (!currentTargetId) {
      const scriptables = getScriptableNodes();
      if (scriptables.length) currentTargetId = scriptables[0].id;
    }
    return currentTargetId ? Model.find(currentTargetId)?.node : null;
  }

  function getTargetBlocks() {
    if (currentTargetId === '_shared') {
      if (!Model.data.sharedBlocks) Model.data.sharedBlocks = [];
      return Model.data.sharedBlocks;
    }
    const node = getTargetNode();
    if (!node) return [];
    if (!node.blocks) {
      node.blocks = getDefaultBlocksForNode(node);
    }
    return node.blocks;
  }

  function getDefaultBlocksForNode(node) {
    if (node.type === 'button') {
      return [
        createBlock('snapshot'),
        createBlock('for_each_selected', {}, [
          createBlock('update_prop', { prop: 'opacity', val: '75' })
        ]),
        createBlock('commit', { reason: (node.props && node.props.label) || 'Button Action' }),
        createBlock('toast', { msg: 'Effect applied!', isError: 'false' })
      ];
    }
    if (node.type === 'slider') {
      return [
        createBlock('snapshot'),
        createBlock('for_each_selected', {}, [
          createBlock('update_prop', { prop: 'opacity', val: 'value' })
        ]),
        createBlock('commit', { reason: 'Adjust ' + ((node.props && node.props.label) || 'Slider') })
      ];
    }
    if (node.type === 'switch') {
      return [
        createBlock('toast', { msg: 'Toggled: ' + ((node.props && node.props.label) || 'Switch'), isError: 'false' })
      ];
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // Compiler: Blocks -> JavaScript Code
  // ---------------------------------------------------------------------------
  function pad(str, spaces = 2) {
    const p = ' '.repeat(spaces);
    return str.split('\n').map(l => (l.trim() ? p + l : l)).join('\n');
  }

  function compileSlot(blocks, depth = 1) {
    if (!blocks || !blocks.length) return '';
    const stmts = blocks.map(b => {
      const def = BLOCK_DEFS[b.type];
      if (!def) return '';
      return def.code(b, (kids) => compileSlot(kids, depth + 1));
    }).filter(Boolean);
    return pad(stmts.join('\n\n'), depth * 2);
  }

  function compileBlocks(blocks) {
    if (!blocks || !blocks.length) return '';
    return blocks.map(b => {
      const def = BLOCK_DEFS[b.type];
      if (!def) return '';
      return def.code(b, (kids) => compileSlot(kids, 1));
    }).filter(Boolean).join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // Sync to Model & Editor
  // ---------------------------------------------------------------------------
  function syncChanges() {
    if (isInternalChange) return;
    const blocks = getTargetBlocks();
    const code = compileBlocks(blocks);

    const pre = $('sv-code-pre');
    if (pre) pre.textContent = code || '// No blocks yet in this script';

    if (currentTargetId === '_shared') {
      Model.data.sharedBlocks = blocks;
      Model.setShared(code);
    } else {
      const node = getTargetNode();
      if (node) {
        node.blocks = blocks;
        Model.setBlocks(node.id, blocks, code);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // View & Tab Switching (Blocks vs Code) & Mobile Toolbox Drawer
  // ---------------------------------------------------------------------------
  function setTab(tab) {
    currentTab = tab;
    const pane = $('pane-script-view');
    if (pane) pane.dataset.tab = tab;

    document.querySelectorAll('.sv-nav-tabs button').forEach(b => {
      const active = b.dataset.svTab === tab;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    });

    // Close toolbox if switching to code
    if (tab === 'code') openToolbox(false);
  }

  function openToolbox(open) {
    const pane = $('pane-script-view');
    if (pane) pane.dataset.toolboxOpen = String(open);
    $('sv-fab')?.setAttribute('aria-expanded', String(open));
  }

  // ---------------------------------------------------------------------------
  // Rendering UI
  // ---------------------------------------------------------------------------
  function renderTargetSelect() {
    const sel = $('sv-target-select');
    if (!sel) return;
    sel.innerHTML = '';

    const nodes = getScriptableNodes();
    nodes.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.id;
      const def = PALETTE[n.type];
      const label = n.props.label || n.props.title || n.props.placeholder || n.type;
      opt.textContent = `${def.label}: "${label}"`;
      if (n.id === currentTargetId) opt.selected = true;
      sel.appendChild(opt);
    });

    const optShared = document.createElement('option');
    optShared.value = '_shared';
    optShared.textContent = '🌐 Shared Code (build)';
    if (currentTargetId === '_shared') optShared.selected = true;
    sel.appendChild(optShared);

    if (!sel.value && nodes.length) {
      currentTargetId = nodes[0].id;
      sel.value = currentTargetId;
    }
  }

  function renderHatBlock() {
    const hat = $('sv-hat-block');
    if (!hat) return;

    if (currentTargetId === '_shared') {
      hat.innerHTML = `
        <span class="material-icons" aria-hidden="true">settings</span>
        <div class="sv-hat-title">
          <span>Extension Setup: build(ui, ctx)</span>
          <span class="sv-hat-badge">Initializes on load</span>
        </div>
      `;
      return;
    }

    const node = getTargetNode();
    if (!node) {
      hat.innerHTML = `
        <span class="material-icons" aria-hidden="true">info</span>
        <div class="sv-hat-title"><span>No component selected</span></div>
      `;
      return;
    }

    const def = PALETTE[node.type];
    const hDef = def.handler;
    hat.innerHTML = `
      <span class="material-icons" aria-hidden="true">play_arrow</span>
      <div class="sv-hat-title">
        <span>When ${def.label} ${hDef ? hDef.name : 'action'} (${hDef ? hDef.params : 'ctx'})</span>
        <span class="sv-hat-badge">${node.props.label || node.type}</span>
      </div>
    `;
  }

  function renderBlockElement(block, parentList, index) {
    const def = BLOCK_DEFS[block.type];
    if (!def) return null;

    if (def.isCBlock) {
      const el = document.createElement('div');
      el.className = `sv-c-block cat-${def.category}`;
      el.dataset.id = block.id;

      // C-Head
      const head = document.createElement('div');
      head.className = 'sv-c-head';

      const headerRow = document.createElement('div');
      headerRow.className = 'sv-block-header';
      headerRow.innerHTML = `
        <div class="sv-block-main">
          <span class="material-icons sv-block-icon" aria-hidden="true">${def.icon}</span>
          <span class="sv-block-label">${def.label}</span>
        </div>
      `;
      headerRow.appendChild(renderTools(parentList, index));
      head.appendChild(headerRow);

      // Render parameter inputs
      if (def.fields && def.fields.length) {
        const fieldsRow = document.createElement('div');
        fieldsRow.className = 'sv-block-fields';
        def.fields.forEach(f => {
          fieldsRow.appendChild(renderFieldChip(block, f));
        });
        head.appendChild(fieldsRow);
      }

      el.appendChild(head);

      // C-Slot (children)
      const slot = document.createElement('div');
      slot.className = 'sv-c-slot';
      if (!block.children || !block.children.length) {
        slot.classList.add('is-empty');
      } else {
        block.children.forEach((child, cIdx) => {
          const childEl = renderBlockElement(child, block.children, cIdx);
          if (childEl) slot.appendChild(childEl);
        });
      }
      el.appendChild(slot);

      // C-Foot
      const foot = document.createElement('div');
      foot.className = 'sv-c-foot';
      el.appendChild(foot);

      return el;
    }

    // Standard action block
    const el = document.createElement('div');
    el.className = `sv-block cat-${def.category}`;
    el.dataset.id = block.id;

    // Header Row: Icon + Label + Tools
    const headerRow = document.createElement('div');
    headerRow.className = 'sv-block-header';
    headerRow.innerHTML = `
      <div class="sv-block-main">
        <span class="material-icons sv-block-icon" aria-hidden="true">${def.icon}</span>
        <span class="sv-block-label">${def.label}</span>
      </div>
    `;
    headerRow.appendChild(renderTools(parentList, index));
    el.appendChild(headerRow);

    // Fields Row: Chips/inputs
    if (def.fields && def.fields.length) {
      const fieldsRow = document.createElement('div');
      fieldsRow.className = 'sv-block-fields';
      def.fields.forEach(f => {
        fieldsRow.appendChild(renderFieldChip(block, f));
      });
      el.appendChild(fieldsRow);
    }

    return el;
  }

  function renderFieldChip(block, field) {
    if (!block.props) block.props = {};
    const curVal = block.props[field.key] !== undefined ? block.props[field.key] : field.default;

    if (field.type === 'select') {
      const select = document.createElement('select');
      select.className = 'sv-chip sv-chip-select';
      field.options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.id;
        option.textContent = opt.label;
        if (opt.id === String(curVal)) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', (e) => {
        block.props[field.key] = e.target.value;
        syncChanges();
      });
      return select;
    }

    if (field.type === 'textarea') {
      const ta = document.createElement('textarea');
      ta.className = 'sv-custom-code-area';
      ta.value = curVal;
      ta.placeholder = field.placeholder || '';
      ta.addEventListener('input', (e) => {
        block.props[field.key] = e.target.value;
        syncChanges();
      });
      return ta;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sv-chip sv-chip-input';
    input.value = curVal;
    input.placeholder = field.placeholder || '';
    input.addEventListener('input', (e) => {
      block.props[field.key] = e.target.value;
      syncChanges();
    });
    return input;
  }

  function renderTools(list, index) {
    const tools = document.createElement('div');
    tools.className = 'sv-block-tools';

    // Move Up
    if (index > 0) {
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'sv-tool-btn';
      up.title = 'Move up';
      up.setAttribute('aria-label', 'Move block up');
      up.innerHTML = '<span class="material-icons" aria-hidden="true">arrow_upward</span>';
      up.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = list.splice(index, 1)[0];
        list.splice(index - 1, 0, item);
        renderWorkspace();
        syncChanges();
      });
      tools.appendChild(up);
    }

    // Move Down
    if (index < list.length - 1) {
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'sv-tool-btn';
      down.title = 'Move down';
      down.setAttribute('aria-label', 'Move block down');
      down.innerHTML = '<span class="material-icons" aria-hidden="true">arrow_downward</span>';
      down.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = list.splice(index, 1)[0];
        list.splice(index + 1, 0, item);
        renderWorkspace();
        syncChanges();
      });
      tools.appendChild(down);
    }

    // Delete
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sv-tool-btn sv-del';
    del.title = 'Delete block';
    del.setAttribute('aria-label', 'Delete block');
    del.innerHTML = '<span class="material-icons" aria-hidden="true">delete</span>';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      list.splice(index, 1);
      renderWorkspace();
      syncChanges();
    });
    tools.appendChild(del);

    return tools;
  }

  function renderWorkspace() {
    renderHatBlock();
    const stack = $('sv-block-stack');
    const emptyNotice = $('sv-empty-drop');
    if (!stack) return;
    stack.innerHTML = '';

    const blocks = getTargetBlocks();
    if (!blocks || !blocks.length) {
      if (emptyNotice) emptyNotice.hidden = false;
    } else {
      if (emptyNotice) emptyNotice.hidden = true;
      blocks.forEach((b, idx) => {
        const el = renderBlockElement(b, blocks, idx);
        if (el) stack.appendChild(el);
      });
    }

    syncChanges();
  }

  // ---------------------------------------------------------------------------
  // Toolbox (1:1 Matched to Extension Builder Palette in builder.css)
  // ---------------------------------------------------------------------------
  function renderPalette() {
    const container = $('sv-palette-categories');
    if (!container) return;
    container.innerHTML = '';

    CATEGORIES.forEach(cat => {
      const defKeys = Object.keys(BLOCK_DEFS).filter(k => BLOCK_DEFS[k].category === cat.id);
      if (!defKeys.length) return;

      const groupTitle = document.createElement('div');
      groupTitle.className = 'pal-group';
      groupTitle.textContent = cat.label;
      container.appendChild(groupTitle);

      const grid = document.createElement('div');
      grid.className = 'pal-grid';

      defKeys.forEach(key => {
        const bDef = BLOCK_DEFS[key];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pal-item sv-pal-item';
        btn.dataset.category = cat.id;
        btn.title = bDef.desc || bDef.label;
        btn.innerHTML = `<span class="material-icons" aria-hidden="true">${bDef.icon}</span><span>${bDef.label}</span>`;
        btn.addEventListener('click', () => {
          addBlockToActiveTarget(key);
        });
        grid.appendChild(btn);
      });

      container.appendChild(grid);
    });
  }

  function addBlockToActiveTarget(type) {
    const blocks = getTargetBlocks();
    const block = createBlock(type);
    if (!block) return;
    blocks.push(block);
    renderWorkspace();
    syncChanges();

    const def = BLOCK_DEFS[type];
    showToast(`${def.label} added`);

    // On mobile, auto-close toolbox drawer when a block is chosen
    if (isMobile()) {
      openToolbox(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Presets & Controls
  // ---------------------------------------------------------------------------
  let presetsMenuEl = null;

  function togglePresetsMenu() {
    if (presetsMenuEl) {
      presetsMenuEl.remove();
      presetsMenuEl = null;
      return;
    }

    presetsMenuEl = document.createElement('div');
    presetsMenuEl.className = 'sv-presets-menu';
    presetsMenuEl.setAttribute('role', 'menu');

    PRESETS.forEach(p => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sv-preset-item';
      item.innerHTML = `<b>${p.name}</b><small>${p.desc}</small>`;
      item.addEventListener('click', () => {
        const targetBlocks = getTargetBlocks();
        targetBlocks.length = 0;
        p.build().forEach(b => targetBlocks.push(b));
        presetsMenuEl.remove();
        presetsMenuEl = null;
        renderWorkspace();
        syncChanges();
        showToast('Preset applied');
      });
      presetsMenuEl.appendChild(item);
    });

    $('sv-actions').appendChild(presetsMenuEl);

    const dismiss = (e) => {
      if (presetsMenuEl && !presetsMenuEl.contains(e.target) && e.target !== $('sv-btn-preset')) {
        presetsMenuEl.remove();
        presetsMenuEl = null;
        document.removeEventListener('pointerdown', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', dismiss), 10);
  }

  function clearActiveBlocks() {
    const blocks = getTargetBlocks();
    blocks.length = 0;
    renderWorkspace();
    syncChanges();
    showToast('Blocks cleared');
  }

  // ---------------------------------------------------------------------------
  // Lifecycle Initialization
  // ---------------------------------------------------------------------------
  function init() {
    renderPalette();
    renderTargetSelect();
    renderWorkspace();

    // Event listeners
    $('sv-target-select')?.addEventListener('change', (e) => {
      currentTargetId = e.target.value;
      renderWorkspace();
    });

    $('sv-btn-preset')?.addEventListener('click', togglePresetsMenu);
    $('sv-btn-clear')?.addEventListener('click', clearActiveBlocks);

    // Mobile FAB opens toolbox, Close button closes it
    $('sv-fab')?.addEventListener('click', () => openToolbox(true));
    $('sv-toolbox-close')?.addEventListener('click', () => openToolbox(false));

    // Dismiss toolbox on outside click on mobile
    document.addEventListener('pointerdown', (e) => {
      const pane = $('pane-script-view');
      if (pane && pane.dataset.toolboxOpen === 'true' && isMobile()) {
        const toolbox = $('sv-palette');
        const fab = $('sv-fab');
        if (toolbox && !toolbox.contains(e.target) && fab && !fab.contains(e.target)) {
          openToolbox(false);
        }
      }
    });

    // View selector pills ([Blocks] [Code])
    document.querySelectorAll('.sv-nav-tabs button').forEach(b => {
      b.addEventListener('click', () => {
        const tab = b.dataset.svTab;
        if (tab) setTab(tab);
      });
    });

    // Copy Code button
    $('sv-btn-copy-code')?.addEventListener('click', async () => {
      const code = $('sv-code-pre')?.textContent;
      if (code && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(code);
          showToast('Script copied to clipboard');
        } catch (_) {}
      }
    });

    // Model listener: when selection changes on canvas, switch target automatically
    Model.on('selection', () => {
      const sel = Model.selected();
      if (sel && PALETTE[sel.type]?.handler) {
        currentTargetId = sel.id;
        renderTargetSelect();
        renderWorkspace();
      }
    });

    // Model structure reset / undo / redo
    Model.on('structure', () => {
      renderTargetSelect();
      renderWorkspace();
    });

    setTab('blocks');
  }

  function refresh() {
    renderTargetSelect();
    renderWorkspace();
    setTab(currentTab || 'blocks');
    openToolbox(false);
  }

  global.OFTVisualScript = {
    init,
    refresh,
    setTab,
    openToolbox,
    compileBlocks
  };
})(window);
