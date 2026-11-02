/**
 * Extension Builder - Inspector: property form for the selected node + extension metadata form.
 * Forms are generated from palette field schemas; typing never re-renders the form (keeps focus).
 * Includes an interactive Icon Gallery Picker for icons.
 */
(function (global) {
  'use strict';

  const Model = global.OFTBuilderModel;
  const { PALETTE } = global.OFTBuilderPalette;

  const CATEGORIES = ['Tools', 'Dashboard', 'Effects', 'Utility'];

  const ICON_CATEGORIES = [
    { id: 'all', label: 'All' },
    { id: 'media', label: 'Video & Media' },
    { id: 'audio', label: 'Audio' },
    { id: 'editing', label: 'Editing & FX' },
    { id: 'ui', label: 'UI & Actions' },
    { id: 'shapes', label: 'Badges & Symbols' },
    { id: 'system', label: 'System & Code' }
  ];

  const ICONS = [
    // Video & Media
    { name: 'movie', cat: 'media', keywords: 'film video reel cinema' },
    { name: 'videocam', cat: 'media', keywords: 'camera record video' },
    { name: 'play_arrow', cat: 'media', keywords: 'play start resume' },
    { name: 'pause', cat: 'media', keywords: 'pause stop hold' },
    { name: 'stop', cat: 'media', keywords: 'stop square' },
    { name: 'skip_next', cat: 'media', keywords: 'next forward' },
    { name: 'skip_previous', cat: 'media', keywords: 'previous back rew' },
    { name: 'fast_forward', cat: 'media', keywords: 'speed fast ff' },
    { name: 'fast_rewind', cat: 'media', keywords: 'rewind back' },
    { name: 'replay', cat: 'media', keywords: 'repeat again reset' },
    { name: 'slideshow', cat: 'media', keywords: 'slide presentation' },
    { name: 'animation', cat: 'media', keywords: 'motion anim frames' },
    { name: 'slow_motion_video', cat: 'media', keywords: 'slow motion fps speed' },
    { name: 'subtitles', cat: 'media', keywords: 'captions text cc' },
    { name: 'closed_caption', cat: 'media', keywords: 'cc subs transcript' },
    { name: 'video_library', cat: 'media', keywords: 'media files gallery' },
    { name: 'smart_display', cat: 'media', keywords: 'screen tv monitor' },
    { name: 'featured_video', cat: 'media', keywords: 'star clip snippet' },
    { name: 'aspect_ratio', cat: 'media', keywords: 'scale 16:9 crop ratio' },
    { name: 'high_quality', cat: 'media', keywords: 'hd 4k 1080p resolution' },

    // Audio
    { name: 'audiotrack', cat: 'audio', keywords: 'music note song sound' },
    { name: 'volume_up', cat: 'audio', keywords: 'speaker sound audio loud' },
    { name: 'volume_down', cat: 'audio', keywords: 'speaker quiet soft' },
    { name: 'volume_mute', cat: 'audio', keywords: 'silent speaker' },
    { name: 'volume_off', cat: 'audio', keywords: 'mute sound off' },
    { name: 'mic', cat: 'audio', keywords: 'microphone record voice speech' },
    { name: 'mic_off', cat: 'audio', keywords: 'mute mic off' },
    { name: 'equalizer', cat: 'audio', keywords: 'eq sound levels mixing' },
    { name: 'graphic_eq', cat: 'audio', keywords: 'spectrum visualizer audio' },
    { name: 'surround_sound', cat: 'audio', keywords: 'stereo 5.1 dolby audio' },
    { name: 'headphones', cat: 'audio', keywords: 'headset listen monitoring' },
    { name: 'music_note', cat: 'audio', keywords: 'melody tune audio' },
    { name: 'radio', cat: 'audio', keywords: 'broadcast station frequency' },

    // Editing & FX
    { name: 'content_cut', cat: 'editing', keywords: 'scissors cut split trim slice' },
    { name: 'crop', cat: 'editing', keywords: 'crop resize frame bounds' },
    { name: 'auto_fix_high', cat: 'editing', keywords: 'magic wand fx filter enhance' },
    { name: 'auto_fix_normal', cat: 'editing', keywords: 'wand fix auto' },
    { name: 'brush', cat: 'editing', keywords: 'paint draw brush stroke' },
    { name: 'draw', cat: 'editing', keywords: 'pencil sketch pen' },
    { name: 'colorize', cat: 'editing', keywords: 'picker dropper color eyedropper' },
    { name: 'palette', cat: 'editing', keywords: 'color theme palette swatch' },
    { name: 'tune', cat: 'editing', keywords: 'settings sliders adjust filter' },
    { name: 'transform', cat: 'editing', keywords: 'warp rotate flip scale' },
    { name: 'straighten', cat: 'editing', keywords: 'angle ruler align level' },
    { name: 'filter', cat: 'editing', keywords: 'fx photo effect preset' },
    { name: 'filter_vintage', cat: 'editing', keywords: 'retro grain film sepia' },
    { name: 'blur_on', cat: 'editing', keywords: 'blur bokeh defocus mask' },
    { name: 'blur_linear', cat: 'editing', keywords: 'tilt shift gradient blur' },
    { name: 'format_color_fill', cat: 'editing', keywords: 'bucket fill paint bg' },
    { name: 'layers', cat: 'editing', keywords: 'stack comp layers overlay' },
    { name: 'layers_clear', cat: 'editing', keywords: 'flatten remove layers' },
    { name: 'history', cat: 'editing', keywords: 'undo timeline history clock' },
    { name: 'timeline', cat: 'editing', keywords: 'keyframes track sequence' },
    { name: 'speed', cat: 'editing', keywords: 'velocity rate duration fps' },
    { name: 'compress', cat: 'editing', keywords: 'minify optimize shrink export' },
    { name: 'compare', cat: 'editing', keywords: 'before after split diff' },

    // UI & Actions
    { name: 'bolt', cat: 'ui', keywords: 'lightning instant quick flash energy' },
    { name: 'smart_button', cat: 'ui', keywords: 'button click press trigger' },
    { name: 'touch_app', cat: 'ui', keywords: 'tap gesture hand pointer' },
    { name: 'check', cat: 'ui', keywords: 'done ok success tick' },
    { name: 'close', cat: 'ui', keywords: 'cancel exit x remove' },
    { name: 'add', cat: 'ui', keywords: 'plus new create insert' },
    { name: 'remove', cat: 'ui', keywords: 'minus subtract delete' },
    { name: 'delete', cat: 'ui', keywords: 'trash bin destroy' },
    { name: 'edit', cat: 'ui', keywords: 'pencil modify rename change' },
    { name: 'save', cat: 'ui', keywords: 'floppy disk store write' },
    { name: 'download', cat: 'ui', keywords: 'export save file down' },
    { name: 'upload', cat: 'ui', keywords: 'import load file up' },
    { name: 'share', cat: 'ui', keywords: 'social send publish export' },
    { name: 'link', cat: 'ui', keywords: 'url chain connect attach' },
    { name: 'visibility', cat: 'ui', keywords: 'eye show preview view' },
    { name: 'visibility_off', cat: 'ui', keywords: 'hide blind eye' },
    { name: 'lock', cat: 'ui', keywords: 'secure protect pad lock' },
    { name: 'lock_open', cat: 'ui', keywords: 'unlock access open' },
    { name: 'refresh', cat: 'ui', keywords: 'reload update cycle' },
    { name: 'sync', cat: 'ui', keywords: 'synchronize cloud connect' },
    { name: 'search', cat: 'ui', keywords: 'find magnify look query' },
    { name: 'zoom_in', cat: 'ui', keywords: 'magnify enlarge bigger' },
    { name: 'zoom_out', cat: 'ui', keywords: 'shrink smaller overview' },
    { name: 'pan_tool', cat: 'ui', keywords: 'drag hand pan move' },
    { name: 'open_in_new', cat: 'ui', keywords: 'external window popout' },

    // Badges & Symbols
    { name: 'star', cat: 'shapes', keywords: 'favorite bookmark rate rating' },
    { name: 'star_border', cat: 'shapes', keywords: 'unstarred empty rate' },
    { name: 'favorite', cat: 'shapes', keywords: 'heart love like' },
    { name: 'favorite_border', cat: 'shapes', keywords: 'heart empty like' },
    { name: 'flag', cat: 'shapes', keywords: 'marker bookmark report' },
    { name: 'bookmark', cat: 'shapes', keywords: 'save ribbon mark' },
    { name: 'badge', cat: 'shapes', keywords: 'id tag cert reward' },
    { name: 'verified', cat: 'shapes', keywords: 'check trust official' },
    { name: 'workspace_premium', cat: 'shapes', keywords: 'pro medal crown gold' },
    { name: 'shield', cat: 'shapes', keywords: 'protect security guard' },
    { name: 'sentiment_satisfied', cat: 'shapes', keywords: 'smile happy emotion' },
    { name: 'thumb_up', cat: 'shapes', keywords: 'like approve good' },
    { name: 'celebration', cat: 'shapes', keywords: 'party confetti success' },

    // System & Code
    { name: 'widgets', cat: 'system', keywords: 'component block module pack' },
    { name: 'dashboard', cat: 'system', keywords: 'board grid layout overview' },
    { name: 'extension', cat: 'system', keywords: 'plugin addon puzzle piece' },
    { name: 'settings', cat: 'system', keywords: 'gear cog config preferences' },
    { name: 'build', cat: 'system', keywords: 'wrench tool construct' },
    { name: 'science', cat: 'system', keywords: 'flask lab test experiment' },
    { name: 'psychology', cat: 'system', keywords: 'ai brain neural intelligence' },
    { name: 'code', cat: 'system', keywords: 'bracket dev programming script' },
    { name: 'terminal', cat: 'system', keywords: 'cli console command prompt' },
    { name: 'bug_report', cat: 'system', keywords: 'debug insect error fix' },
    { name: 'lightbulb', cat: 'system', keywords: 'idea tip prompt hint' },
    { name: 'flash_on', cat: 'system', keywords: 'spark power electric' },
    { name: 'auto_awesome', cat: 'system', keywords: 'sparkle ai magic star' },
    { name: 'memory', cat: 'system', keywords: 'chip cpu ram hardware' },
    { name: 'cloud', cat: 'system', keywords: 'network server online storage' },
    { name: 'folder', cat: 'system', keywords: 'directory files storage' },
    { name: 'insert_drive_file', cat: 'system', keywords: 'doc file item asset' },
    { name: 'help_outline', cat: 'system', keywords: 'question faq support' },
    { name: 'info', cat: 'system', keywords: 'information details about' }
  ];

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  function fieldRow(label, controlEl) {
    const row = el('label', 'ins-row' + (controlEl.type === 'checkbox' ? ' ins-switch' : ''));
    row.appendChild(el('span', 'ins-label', esc(label)));
    row.appendChild(controlEl);
    return row;
  }

  let activeModal = null;

  function openIconGalleryModal(currentVal, onSelect) {
    if (activeModal) { activeModal.remove(); activeModal = null; }

    let selectedCat = 'all';
    let searchQuery = '';

    const backdrop = el('div', 'eb-modal-backdrop');
    const card = el('div', 'eb-modal-card eb-icon-gallery-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Icon Gallery');

    // Head
    const head = el('div', 'eb-modal-head', `
      <div class="eb-modal-title">
        <span class="material-icons" aria-hidden="true">category</span>
        <span>Icon Gallery</span>
      </div>
      <button type="button" class="eb-modal-close-btn" title="Close" aria-label="Close">
        <span class="material-icons" aria-hidden="true">close</span>
      </button>
    `);
    card.appendChild(head);

    // Search bar
    const searchBar = el('div', 'eb-icon-search-bar');
    searchBar.innerHTML = `<span class="material-icons" aria-hidden="true">search</span>`;
    const searchInput = el('input', 'eb-icon-search-input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search icons (e.g. video, cut, star, play, filter)...';
    searchBar.appendChild(searchInput);
    card.appendChild(searchBar);

    // Categories
    const catBar = el('div', 'eb-icon-categories');
    ICON_CATEGORIES.forEach(cat => {
      const chip = el('button', 'eb-icon-cat-chip' + (cat.id === 'all' ? ' is-active' : ''), esc(cat.label));
      chip.type = 'button';
      chip.dataset.cat = cat.id;
      chip.addEventListener('click', () => {
        selectedCat = cat.id;
        catBar.querySelectorAll('.eb-icon-cat-chip').forEach(c => c.classList.toggle('is-active', c.dataset.cat === selectedCat));
        renderGrid();
      });
      catBar.appendChild(chip);
    });
    card.appendChild(catBar);

    // Grid container
    const gridWrap = el('div', 'eb-icon-grid-wrap');
    const grid = el('div', 'eb-icon-grid');
    gridWrap.appendChild(grid);
    card.appendChild(gridWrap);

    // Footer
    const footer = el('div', 'eb-modal-footer');
    const customBox = el('div', 'eb-icon-custom-box');
    customBox.innerHTML = `<span style="font-size:11px;color:var(--text-muted)">Custom:</span>`;
    const customInput = el('input', '');
    customInput.type = 'text';
    customInput.placeholder = 'Icon name (e.g. bolt)';
    customInput.value = currentVal || '';
    const applyCustomBtn = el('button', '', 'Apply');
    applyCustomBtn.type = 'button';
    customBox.appendChild(customInput);
    customBox.appendChild(applyCustomBtn);

    const clearBtn = el('button', 'eb-icon-clear-action-btn', 'Clear Icon');
    clearBtn.type = 'button';

    footer.appendChild(customBox);
    footer.appendChild(clearBtn);
    card.appendChild(footer);

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    function closeModal() {
      if (activeModal) {
        activeModal.remove();
        activeModal = null;
      }
      document.removeEventListener('keydown', onKeyDown);
    }

    function choose(iconName) {
      onSelect(iconName);
      closeModal();
    }

    function renderGrid() {
      grid.innerHTML = '';
      const q = searchQuery.trim().toLowerCase();
      const filtered = ICONS.filter(item => {
        if (selectedCat !== 'all' && item.cat !== selectedCat) return false;
        if (!q) return true;
        return item.name.toLowerCase().includes(q) || (item.keywords && item.keywords.toLowerCase().includes(q));
      });

      if (!filtered.length) {
        grid.appendChild(el('div', 'eb-icon-empty-state', `No icons matching "${esc(searchQuery)}". You can apply it directly via custom name below.`));
        return;
      }

      filtered.forEach(item => {
        const isSel = (item.name === (currentVal || ''));
        const tile = el('button', 'eb-icon-tile' + (isSel ? ' is-selected' : ''));
        tile.type = 'button';
        tile.title = item.name;
        tile.innerHTML = `
          <span class="material-icons" aria-hidden="true">${item.name}</span>
          <span class="eb-icon-tile-name">${esc(item.name)}</span>
        `;
        tile.addEventListener('click', () => choose(item.name));
        grid.appendChild(tile);
      });
    }

    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      renderGrid();
    });

    applyCustomBtn.addEventListener('click', () => {
      const val = customInput.value.trim().toLowerCase();
      choose(val);
    });

    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCustomBtn.click();
      }
    });

    clearBtn.addEventListener('click', () => choose(''));

    head.querySelector('.eb-modal-close-btn').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    function onKeyDown(e) {
      if (e.key === 'Escape') closeModal();
    }
    document.addEventListener('keydown', onKeyDown);

    renderGrid();
    setTimeout(() => searchInput.focus(), 50);
  }

  function iconPicker(initialValue, onChange) {
    let value = initialValue;
    const box = el('div', 'ins-icon-picker-box');

    const trigger = el('button', 'ins-icon-trigger');
    trigger.type = 'button';
    trigger.title = 'Open icon gallery';

    const thumb = el('span', 'ins-icon-thumb', `<span class="material-icons" aria-hidden="true">${esc(value || 'image_not_supported')}</span>`);
    const valText = el('span', 'ins-icon-val' + (!value ? ' is-empty' : ''), esc(value || 'None'));
    const changeBtn = el('span', 'ins-icon-change-btn', 'Browse');

    trigger.appendChild(thumb);
    trigger.appendChild(valText);
    trigger.appendChild(changeBtn);

    const clearBtn = el('button', 'ins-icon-clear-btn');
    clearBtn.type = 'button';
    clearBtn.title = 'Remove icon';
    clearBtn.setAttribute('aria-label', 'Remove icon');
    clearBtn.innerHTML = `<span class="material-icons" aria-hidden="true">close</span>`;
    clearBtn.hidden = !value;

    function updateView(newVal) {
      value = newVal;
      thumb.innerHTML = `<span class="material-icons" aria-hidden="true">${esc(value || 'image_not_supported')}</span>`;
      valText.textContent = value || 'None';
      valText.classList.toggle('is-empty', !value);
      clearBtn.hidden = !value;
    }

    trigger.addEventListener('click', () => {
      openIconGalleryModal(value, (newIcon) => {
        updateView(newIcon);
        onChange(newIcon);
      });
    });
    box.appendChild(trigger);

    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateView('');
      onChange('');
    });
    box.appendChild(clearBtn);

    return box;
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
      const isIcon = f.kind === 'icon' || f.key === 'icon';
      const ctl = isIcon
        ? iconPicker(node.props[f.key] || '', v => Model.setProp(node.id, f.key, v))
        : control(f.kind, node.props[f.key], v => Model.setProp(node.id, f.key, v), f);
      host.appendChild(fieldRow(f.label, ctl));
    });
    if (def.handler) {
      host.appendChild(el('p', 'ins-hint', `Logic: edit <code>${def.handler.name}(${def.handler.params})</code> in the Script tab.`));
    }
  }

  function renderMeta(host) {
    host.innerHTML = '';
    const m = Model.data.meta;
    const text = (key, label) => host.appendChild(fieldRow(label, control('text', m[key], v => Model.setMeta(key, v))));
    text('name', 'Name');
    const idCtl = control('text', m.id, v => Model.setMeta('id', v.replace(/[^a-z0-9_]/gi, '_').toLowerCase()));
    host.appendChild(fieldRow('ID (file name)', idCtl));
    host.appendChild(fieldRow('Icon', iconPicker(m.icon || 'extension', v => Model.setMeta('icon', v))));
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

  global.OFTBuilderInspector = { init, openIconGalleryModal, ICONS, ICON_CATEGORIES };
})(window);
