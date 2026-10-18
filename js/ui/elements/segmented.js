/**
 * OpenFishTools Studio - Universal Segmented Switch / Toggle Element
 * 
 * Features:
 * 1. Supports multi-option segments and boolean switches (On/Off).
 * 2. Tactile, instant visual switching with aria-checked / aria-selected sync.
 * 3. Declarative & Programmatic API: createSegmented, renderSegmentedHTML, bindSegmented.
 */
(function(global) {
  'use strict';

  function normalizeOptions(rawOpts, isBoolean = false) {
    if (isBoolean) {
      return [
        { value: '0', label: 'Off' },
        { value: '1', label: 'On' }
      ];
    }
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

  function renderSegmentedHTML(options = {}) {
    const {
      id = '',
      param = '',
      className = '',
      value = '',
      options: rawOpts = [],
      isBoolean = false,
      role = 'radiogroup',
      ariaLabel = 'Segmented Switch'
    } = options;

    const opts = normalizeOptions(rawOpts, isBoolean);
    const activeVal = String(value);

    const buttonsHTML = opts.map(opt => {
      const isActive = String(opt.value).toLowerCase() === activeVal.toLowerCase();
      return `
        <button type="button" class="effects-segmented-btn ${isActive ? 'is-active' : ''}" ${param ? `data-param="${param}"` : ''} data-val="${opt.value}" role="radio" aria-checked="${isActive ? 'true' : 'false'}" title="${opt.label}">
          ${opt.label}
        </button>
      `.trim();
    }).join('');

    return `
      <div class="effects-segmented-group ${className}" ${id ? `id="${id}"` : ''} ${param ? `data-param="${param}"` : ''} role="${role}" aria-label="${ariaLabel}">
        ${buttonsHTML}
      </div>
    `.trim();
  }

  function bindSegmented(groupEl, options = {}) {
    if (!groupEl) return null;

    let currentVal = options.value !== undefined ? String(options.value) : '';
    const buttons = Array.from(groupEl.querySelectorAll('.effects-segmented-btn, .segmented-switch-item'));

    if (!currentVal && buttons.length > 0) {
      const activeBtn = buttons.find(b => b.classList.contains('is-active') || b.classList.contains('is-selected'));
      currentVal = activeBtn ? (activeBtn.dataset.val || activeBtn.dataset.value || activeBtn.textContent.trim()) : (buttons[0].dataset.val || buttons[0].dataset.value || '');
    }

    function setValue(newVal, notify = true) {
      currentVal = String(newVal);
      const btns = Array.from(groupEl.querySelectorAll('.effects-segmented-btn, .segmented-switch-item'));
      let targetBtn = null;

      btns.forEach(btn => {
        const btnVal = btn.dataset.val !== undefined ? btn.dataset.val : (btn.dataset.value !== undefined ? btn.dataset.value : btn.textContent.trim());
        const isMatch = String(btnVal).toLowerCase() === currentVal.toLowerCase();
        btn.classList.toggle('is-active', isMatch);
        btn.classList.toggle('is-selected', isMatch);
        btn.setAttribute('aria-checked', isMatch ? 'true' : 'false');
        btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        if (isMatch) targetBtn = btn;
      });

      if (notify) {
        if (typeof options.onChange === 'function') {
          options.onChange(currentVal, targetBtn);
        }
        const event = new CustomEvent('segmented:change', {
          bubbles: true,
          detail: { value: currentVal, button: targetBtn }
        });
        groupEl.dispatchEvent(event);
      }
    }

    if (!groupEl._segmentedWired) {
      groupEl._segmentedWired = true;
      groupEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.effects-segmented-btn, .segmented-switch-item');
        if (!btn || btn.classList.contains('is-active')) return;
        e.stopPropagation();
        const val = btn.dataset.val !== undefined ? btn.dataset.val : (btn.dataset.value !== undefined ? btn.dataset.value : btn.textContent.trim());
        setValue(val, true);
      });
    }

    setValue(currentVal, false);

    const controller = {
      element: groupEl,
      getValue: () => currentVal,
      setValue
    };

    groupEl._segmentedController = controller;
    return controller;
  }

  function createSegmented(parent, options = {}) {
    const tempWrap = document.createElement('div');
    tempWrap.innerHTML = renderSegmentedHTML(options);
    const element = tempWrap.firstElementChild;
    if (parent && typeof parent.appendChild === 'function') {
      parent.appendChild(element);
    }
    bindSegmented(element, options);
    return element;
  }

  global.FishElements = global.FishElements || {};
  global.FishElements.renderSegmentedHTML = renderSegmentedHTML;
  global.FishElements.bindSegmented = bindSegmented;
  global.FishElements.createSegmented = createSegmented;
})(typeof window !== 'undefined' ? window : globalThis);
