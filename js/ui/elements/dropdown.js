/**
 * OpenFishTools Studio - Universal Custom Dropdown Element
 * 
 * Features:
 * 1. Accessible: ARIA listbox & option attributes, keyboard navigation (Arrow keys, Enter, Escape).
 * 2. Auto Dismissal: Closes automatically on outside click or when another dropdown opens.
 * 3. Declarative & Programmatic API: createDropdown, renderDropdownHTML, bindDropdown.
 */
(function(global) {
  'use strict';

  function normalizeOptions(rawOpts) {
    if (!Array.isArray(rawOpts)) return [];
    return rawOpts.map(opt => {
      if (typeof opt === 'object' && opt !== null) {
        return {
          value: String(opt.value !== undefined ? opt.value : ''),
          label: String(opt.label || opt.value || '')
        };
      }
      const s = String(opt);
      return {
        value: s,
        label: s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      };
    });
  }

  function renderDropdownHTML(options = {}) {
    const {
      id = '',
      param = '',
      className = '',
      value = '',
      options: rawOpts = [],
      placeholder = 'Select option',
      title = 'Select'
    } = options;

    const opts = normalizeOptions(rawOpts);
    const matched = opts.find(o => String(o.value).toLowerCase() === String(value).toLowerCase()) || opts[0];
    const currentVal = matched ? matched.value : value;
    const currentLabel = matched ? matched.label : (value || placeholder);

    const itemsHTML = opts.map(opt => {
      const isSelected = String(opt.value).toLowerCase() === String(currentVal).toLowerCase();
      return `<div class="custom-dropdown-item ${isSelected ? 'is-selected' : ''}" role="option" data-val="${opt.value}" title="${opt.label}">${opt.label}</div>`;
    }).join('');

    return `
      <div class="custom-dropdown effects-custom-dropdown ${className}" ${id ? `id="${id}"` : ''} ${param ? `data-param="${param}"` : ''} data-value="${currentVal}">
        <button type="button" class="custom-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="${title}">
          <span class="custom-dropdown-label">${currentLabel}</span>
          <i class="fticon fticon-select-animation-target custom-dropdown-arrow" style="width:14px;height:14px;font-size:14px;line-height:1;" aria-hidden="true"></i>
        </button>
        <div class="custom-dropdown-menu" role="listbox">
          ${itemsHTML}
        </div>
      </div>
    `.trim();
  }

  function bindDropdown(dropdownEl, options = {}) {
    if (!dropdownEl) return null;

    const trigger = dropdownEl.querySelector('.custom-dropdown-trigger');
    const labelEl = dropdownEl.querySelector('.custom-dropdown-label');
    const menuEl = dropdownEl.querySelector('.custom-dropdown-menu');

    let currentVal = options.value !== undefined ? String(options.value) : (dropdownEl.dataset.value || '');

    function close() {
      dropdownEl.classList.remove('is-open');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    function open() {
      // Close other open dropdowns
      document.querySelectorAll('.custom-dropdown.is-open').forEach(other => {
        if (other !== dropdownEl) {
          other.classList.remove('is-open');
          const otherTrigger = other.querySelector('.custom-dropdown-trigger');
          if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
        }
      });

      // Auto-detect dropup positioning when near viewport or container bottom
      try {
        const rect = dropdownEl.getBoundingClientRect();
        const scrollParent = dropdownEl.closest('.effects-rack-content, .drawer-body') || document.body;
        const parentRect = scrollParent.getBoundingClientRect();
        const spaceBelow = parentRect.bottom - rect.bottom;
        const spaceAbove = rect.top - parentRect.top;
        if (spaceBelow < 220 && spaceAbove > spaceBelow) {
          dropdownEl.classList.add('is-dropup');
        } else {
          dropdownEl.classList.remove('is-dropup');
        }
      } catch (_) {}

      dropdownEl.classList.add('is-open');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
    }

    function setValue(newVal, notify = true) {
      currentVal = String(newVal);
      dropdownEl.dataset.value = currentVal;
      const items = Array.from(dropdownEl.querySelectorAll('.custom-dropdown-item'));
      const targetItem = items.find(it => String(it.dataset.val).toLowerCase() === currentVal.toLowerCase());

      items.forEach(it => {
        it.classList.toggle('is-selected', String(it.dataset.val).toLowerCase() === currentVal.toLowerCase());
      });

      if (targetItem && labelEl) {
        const richContent = targetItem.querySelector('.layer-dropdown-item-content');
        if (richContent) {
          labelEl.innerHTML = richContent.outerHTML;
        } else {
          labelEl.textContent = targetItem.textContent;
        }
      }

      if (notify && typeof options.onChange === 'function') {
        options.onChange(currentVal, targetItem);
      }
    }

    if (trigger && !trigger._dropdownWired) {
      trigger._dropdownWired = true;
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdownEl.classList.contains('is-open');
        if (isOpen) close(); else open();
      });

      trigger.addEventListener('keydown', (e) => {
        const isOpen = dropdownEl.classList.contains('is-open');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!isOpen) open();
          const items = Array.from(dropdownEl.querySelectorAll('.custom-dropdown-item'));
          const curIdx = items.findIndex(it => it.classList.contains('is-selected'));
          let nextIdx = e.key === 'ArrowDown' ? curIdx + 1 : curIdx - 1;
          if (nextIdx < 0) nextIdx = items.length - 1;
          if (nextIdx >= items.length) nextIdx = 0;
          if (items[nextIdx]) {
            setValue(items[nextIdx].dataset.val, true);
          }
        } else if (e.key === 'Escape' && isOpen) {
          e.preventDefault();
          close();
        }
      });
    }

    if (menuEl && !menuEl._dropdownMenuWired) {
      menuEl._dropdownMenuWired = true;
      menuEl.addEventListener('click', (e) => {
        const item = e.target.closest('.custom-dropdown-item');
        if (!item) return;
        e.stopPropagation();
        setValue(item.dataset.val, true);
        close();
      });
    }

    // Global listener for closing dropdowns when clicking outside
    if (!global._dropdownGlobalListenerWired) {
      global._dropdownGlobalListenerWired = true;
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-dropdown')) {
          document.querySelectorAll('.custom-dropdown.is-open').forEach(d => {
            d.classList.remove('is-open');
            const trig = d.querySelector('.custom-dropdown-trigger');
            if (trig) trig.setAttribute('aria-expanded', 'false');
          });
        }
      });
    }

    const controller = {
      element: dropdownEl,
      getValue: () => currentVal,
      setValue,
      open,
      close
    };

    dropdownEl._dropdownController = controller;
    return controller;
  }

  function getLayerDropdownInfo(layer, index) {
    if (!layer) {
      return {
        id: '',
        name: 'None',
        tag: '',
        tagClass: '',
        thumbHtml: '<span class="layer-dropdown-thumb is-none" aria-hidden="true"><i class="fticon fticon-close-3" aria-hidden="true"></i></span>'
      };
    }
    const type = (layer.type || 'shape').toLowerCase();
    let tag = 'SHP';
    let tagClass = 'tag-shape';
    let thumbHtml = '';

    let thumb = layer.thumbUrl;
    if (!thumb && layer.mediaId && global.importedMediaMap && typeof global.importedMediaMap.has === 'function' && global.importedMediaMap.has(layer.mediaId)) {
      const m = global.importedMediaMap.get(layer.mediaId);
      if (m && m.thumbUrl) thumb = m.thumbUrl;
    }

    if (thumb) {
      tag = (type === 'video') ? 'VID' : 'IMG';
      tagClass = (type === 'video') ? 'tag-video' : 'tag-image';
      thumbHtml = `<span class="layer-dropdown-thumb is-media" aria-hidden="true"><img src="${thumb}" class="layer-dropdown-thumb-img" alt="" loading="lazy" draggable="false"/></span>`;
    } else if (type === 'adjustment') {
      tag = 'ADJ';
      tagClass = 'tag-adj';
      thumbHtml = `<span class="layer-dropdown-thumb is-adj" aria-hidden="true"><i class="fticon fticon-icon-17" aria-hidden="true"></i></span>`;
    } else if (type === 'null') {
      tag = 'NULL';
      tagClass = 'tag-null';
      thumbHtml = `<span class="layer-dropdown-thumb is-null" aria-hidden="true"><i class="fticon fticon-icon-16" aria-hidden="true"></i></span>`;
    } else if (type === 'camera') {
      tag = 'CAM';
      tagClass = 'tag-camera';
      thumbHtml = `<span class="layer-dropdown-thumb is-camera" aria-hidden="true"><i class="fticon fticon-icon-15" aria-hidden="true"></i></span>`;
    } else if (type === 'audio') {
      tag = 'AUD';
      tagClass = 'tag-audio';
      thumbHtml = `<span class="layer-dropdown-thumb is-audio" aria-hidden="true"><i class="fticon fticon-icon-18" aria-hidden="true"></i></span>`;
    } else if (type === 'text') {
      tag = 'TXT';
      tagClass = 'tag-text';
      thumbHtml = `<span class="layer-dropdown-thumb is-text" aria-hidden="true"><i class="fticon fticon-icon-19" aria-hidden="true"></i></span>`;
    } else if (type === 'precomp') {
      tag = 'PRE';
      tagClass = 'tag-precomp';
      thumbHtml = `<span class="layer-dropdown-thumb is-precomp" aria-hidden="true"><i class="fticon fticon-icon-28" aria-hidden="true"></i></span>`;
    } else if (type === 'video') {
      tag = 'VID';
      tagClass = 'tag-video';
      thumbHtml = `<span class="layer-dropdown-thumb is-media" aria-hidden="true"><i class="fticon fticon-icon-20" aria-hidden="true"></i></span>`;
    } else if (type === 'image') {
      tag = 'IMG';
      tagClass = 'tag-image';
      thumbHtml = `<span class="layer-dropdown-thumb is-media" aria-hidden="true"><i class="fticon fticon-icon-21" aria-hidden="true"></i></span>`;
    } else {
      const isSolid = (layer.fillType === 'color' || !!layer.fillColor);
      tag = isSolid ? 'SLD' : 'SHP';
      tagClass = 'tag-shape';
      const color = layer.fillColor || (layer.shapeProps && layer.shapeProps.fillColor) || (layer.style && layer.style.fill) || '#89B4FA';
      thumbHtml = `<span class="layer-dropdown-thumb is-shape" style="background-color: ${color};" aria-hidden="true"><i class="fticon fticon-icon-26" style="color: rgba(0,0,0,0.35);" aria-hidden="true"></i></span>`;
    }

    const numPrefix = (index !== undefined && index !== null) ? `${index + 1}. ` : '';
    const name = `${numPrefix}${layer.name || 'Untitled Layer'}`;
    return {
      id: String(layer.id || ''),
      name,
      tag,
      tagClass,
      thumbHtml
    };
  }

  function renderLayerDropdownHTML(options = {}) {
    const {
      id = '',
      param = '',
      className = '',
      value = '',
      layers = [],
      excludeLayerId = '',
      title = 'Select Layer'
    } = options;

    const currentVal = String(value || '');
    const candidateLayers = (Array.isArray(layers) ? layers : []).filter(l => l && (!excludeLayerId || String(l.id) !== String(excludeLayerId)));

    const matchedLayer = candidateLayers.find(l => String(l.id) === currentVal);
    const matchedIndex = matchedLayer ? layers.indexOf(matchedLayer) : -1;
    const selectedInfo = matchedLayer ? getLayerDropdownInfo(matchedLayer, matchedIndex) : getLayerDropdownInfo(null);

    const noneInfo = getLayerDropdownInfo(null);
    const isNoneSelected = !currentVal || currentVal === 'none';

    let itemsHTML = `
      <div class="custom-dropdown-item custom-dropdown-layer-item ${isNoneSelected ? 'is-selected' : ''}" role="option" data-val="" title="None">
        <div class="layer-dropdown-item-content">
          ${noneInfo.thumbHtml}
          <span class="layer-dropdown-name">None</span>
        </div>
      </div>
    `.trim();

    candidateLayers.forEach(l => {
      const idx = layers.indexOf(l);
      const info = getLayerDropdownInfo(l, idx);
      const isSelected = String(l.id) === currentVal;
      itemsHTML += `
        <div class="custom-dropdown-item custom-dropdown-layer-item ${isSelected ? 'is-selected' : ''}" role="option" data-val="${info.id}" title="${info.name}">
          <div class="layer-dropdown-item-content">
            ${info.thumbHtml}
            <span class="layer-dropdown-name">${info.name}</span>
            ${info.tag ? `<span class="layer-dropdown-tag ${info.tagClass}">${info.tag}</span>` : ''}
          </div>
        </div>
      `.trim();
    });

    return `
      <div class="custom-dropdown effects-custom-dropdown effects-layer-dropdown ${className}" ${id ? `id="${id}"` : ''} ${param ? `data-param="${param}"` : ''} data-value="${currentVal}">
        <button type="button" class="custom-dropdown-trigger effects-layer-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="${title}">
          <span class="custom-dropdown-label layer-dropdown-trigger-label">
            <span class="layer-dropdown-item-content">
              ${selectedInfo.thumbHtml}
              <span class="layer-dropdown-name">${selectedInfo.name}</span>
              ${selectedInfo.tag ? `<span class="layer-dropdown-tag ${selectedInfo.tagClass}">${selectedInfo.tag}</span>` : ''}
            </span>
          </span>
          <i class="fticon fticon-select-animation-target custom-dropdown-arrow" style="width:14px;height:14px;font-size:14px;line-height:1;" aria-hidden="true"></i>
        </button>
        <div class="custom-dropdown-menu custom-dropdown-layer-menu" role="listbox">
          ${itemsHTML}
        </div>
      </div>
    `.trim();
  }

  function createDropdown(parent, options = {}) {
    const tempWrap = document.createElement('div');
    tempWrap.innerHTML = renderDropdownHTML(options);
    const element = tempWrap.firstElementChild;
    if (parent && typeof parent.appendChild === 'function') {
      parent.appendChild(element);
    }
    bindDropdown(element, options);
    return element;
  }

  function createLayerDropdown(parent, options = {}) {
    const tempWrap = document.createElement('div');
    tempWrap.innerHTML = renderLayerDropdownHTML(options);
    const element = tempWrap.firstElementChild;
    if (parent && typeof parent.appendChild === 'function') {
      parent.appendChild(element);
    }
    bindDropdown(element, options);
    return element;
  }

  global.FishElements = global.FishElements || {};
  global.FishElements.renderDropdownHTML = renderDropdownHTML;
  global.FishElements.renderLayerDropdownHTML = renderLayerDropdownHTML;
  global.FishElements.bindDropdown = bindDropdown;
  global.FishElements.createDropdown = createDropdown;
  global.FishElements.createLayerDropdown = createLayerDropdown;
  global.FishElements.getLayerDropdownInfo = getLayerDropdownInfo;
})(typeof window !== 'undefined' ? window : globalThis);
