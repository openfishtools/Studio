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
        labelEl.textContent = targetItem.textContent;
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

  global.FishElements = global.FishElements || {};
  global.FishElements.renderDropdownHTML = renderDropdownHTML;
  global.FishElements.bindDropdown = bindDropdown;
  global.FishElements.createDropdown = createDropdown;
})(typeof window !== 'undefined' ? window : globalThis);
