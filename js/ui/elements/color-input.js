/**
 * OpenFishTools Studio - Universal Color Swatch & Hex Input Element
 * 
 * Features:
 * 1. Synchronized Color Swatch button and Hex text input.
 * 2. Integrated with ColorPicker popover.
 * 3. Declarative & Programmatic API: createColorInput, renderColorInputHTML, bindColorInput.
 */
(function(global) {
  'use strict';

  function normalizeHex(hex) {
    if (!hex) return '#FFFFFF';
    let s = String(hex).trim().toUpperCase();
    if (!s.startsWith('#')) s = '#' + s;
    if (/^#[0-9A-F]{3}$/.test(s)) {
      s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    if (/^#[0-9A-F]{6}$/.test(s)) return s;
    return s.slice(0, 7);
  }

  function renderColorInputHTML(options = {}) {
    const {
      id = '',
      param = '',
      className = '',
      value = '#FFFFFF',
      title = 'Pick Color'
    } = options;

    const hex = normalizeHex(value);

    return `
      <div class="effects-color-picker-wrap ${className}" ${id ? `id="${id}"` : ''} ${param ? `data-param="${param}"` : ''}>
        <button type="button" class="effects-color-swatch-btn ${param ? `fx-swatch-btn-${param}` : ''}" ${param ? `data-param="${param}"` : ''} title="${title}">
          <span class="effects-color-swatch-preview ${param ? `fx-swatch-preview-${param}` : ''}" style="background-color: ${hex};"></span>
        </button>
        <input type="text" class="effects-color-hex-input ${param ? `fx-hex-${param}` : ''}" ${param ? `data-param="${param}"` : ''} value="${hex}" maxlength="7" spellcheck="false" title="Hex color">
      </div>
    `.trim();
  }

  function bindColorInput(wrapEl, options = {}) {
    if (!wrapEl) return null;

    const swatchBtn = wrapEl.querySelector('.effects-color-swatch-btn');
    const previewEl = wrapEl.querySelector('.effects-color-swatch-preview');
    const hexInput = wrapEl.querySelector('.effects-color-hex-input');

    let currentHex = normalizeHex(options.value || (hexInput ? hexInput.value : '#FFFFFF'));

    function setHex(newVal, notify = true) {
      currentHex = normalizeHex(newVal);
      if (previewEl) previewEl.style.backgroundColor = currentHex;
      if (hexInput && document.activeElement !== hexInput) hexInput.value = currentHex;
      if (notify && typeof options.onChange === 'function') {
        options.onChange(currentHex);
      }
    }

    if (swatchBtn && !swatchBtn._swatchWired) {
      swatchBtn._swatchWired = true;
      swatchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (global.ColorPicker && typeof global.ColorPicker.open === 'function') {
          global.ColorPicker.open(swatchBtn, {
            color: currentHex,
            onChange: (pickedHex) => {
              setHex(pickedHex, true);
            }
          });
        }
      });
    }

    if (hexInput && !hexInput._hexInputWired) {
      hexInput._hexInputWired = true;
      hexInput.addEventListener('input', () => {
        let val = hexInput.value.trim().toUpperCase();
        if (!val.startsWith('#') && val.length > 0) val = '#' + val;
        if (/^#[0-9A-F]{6}$/i.test(val)) {
          setHex(val, true);
        }
      });
      hexInput.addEventListener('blur', () => {
        setHex(hexInput.value, true);
      });
      hexInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          setHex(hexInput.value, true);
          hexInput.blur();
        }
      });
    }

    setHex(currentHex, false);

    const controller = {
      element: wrapEl,
      getValue: () => currentHex,
      setValue: setHex
    };

    wrapEl._colorInputController = controller;
    return controller;
  }

  function createColorInput(parent, options = {}) {
    const tempWrap = document.createElement('div');
    tempWrap.innerHTML = renderColorInputHTML(options);
    const element = tempWrap.firstElementChild;
    if (parent && typeof parent.appendChild === 'function') {
      parent.appendChild(element);
    }
    bindColorInput(element, options);
    return element;
  }

  global.FishElements = global.FishElements || {};
  global.FishElements.renderColorInputHTML = renderColorInputHTML;
  global.FishElements.bindColorInput = bindColorInput;
  global.FishElements.createColorInput = createColorInput;
})(typeof window !== 'undefined' ? window : globalThis);
