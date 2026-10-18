/**
 * OpenFishTools Studio - Universal Numeric Value Input Popover Controller
 * 
 * Features:
 * - Dynamic Anchor scaling via window.Popover.
 * - Live input parsing, clamping (min/max), step rounding.
 * - Keyboard shortcuts: Enter commits, Escape cancels and reverts to initial.
 * - Auto-focus and selection on opening.
 */
(function(global) {
  'use strict';

  function openNumberInput(anchorEl, options = {}) {
    const {
      value = 0,
      defaultValue = 0,
      min = -Infinity,
      max = Infinity,
      step = 1,
      onCommit = null
    } = options;

    const popover = document.getElementById('popover-value-input');
    const inputEl = document.getElementById('popover-value-input-field');
    const formEl = document.getElementById('popover-value-input-form');
    if (!popover || !inputEl || !anchorEl || !global.Popover) return;

    const parsedCurrent = parseFloat(value);
    const initialVal = !isNaN(parsedCurrent) ? parsedCurrent : (parseFloat(defaultValue) || 0);

    inputEl.step = step ? String(step) : 'any';
    if (Number.isFinite(min)) inputEl.min = min; else inputEl.removeAttribute('min');
    if (Number.isFinite(max)) inputEl.max = max; else inputEl.removeAttribute('max');
    inputEl.value = (step && step < 1) ? initialVal.toFixed(2) : initialVal;

    let isFinished = false;

    function parseLiveNumber(rawVal) {
      if (rawVal === '' || rawVal === '-' || rawVal === '+') return null;
      let num = parseFloat(rawVal);
      if (isNaN(num)) return null;
      if (Number.isFinite(max) && num > max) num = max;
      if (Number.isFinite(min) && num < min) num = min;
      if (step && step >= 1) {
        num = Math.round(num);
      } else if (step && step < 1) {
        const decimals = (step.toString().split('.')[1] || '').length || 2;
        num = parseFloat(num.toFixed(decimals));
      }
      return num;
    }

    function handleLiveInput() {
      if (isFinished) return;
      const num = parseLiveNumber(inputEl.value);
      if (num !== null && typeof onCommit === 'function') {
        onCommit(num);
      }
    }

    inputEl.oninput = handleLiveInput;
    inputEl.onchange = handleLiveInput;

    function commitValue(rawVal) {
      if (isFinished) return;
      isFinished = true;
      let num = parseFloat(rawVal);
      if (isNaN(num)) num = parseFloat(defaultValue) || 0;
      if (Number.isFinite(min)) num = Math.max(min, num);
      if (Number.isFinite(max)) num = Math.min(max, num);

      if (step && step >= 1) {
        num = Math.round(num);
      } else if (step && step < 1) {
        const decimals = (step.toString().split('.')[1] || '').length || 2;
        num = parseFloat(num.toFixed(decimals));
      }

      if (typeof onCommit === 'function') {
        onCommit(num);
      }
      if (global.Popover) global.Popover.close();
    }

    if (formEl) {
      formEl.onsubmit = (e) => {
        e.preventDefault();
        commitValue(inputEl.value);
      };
    }

    inputEl.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        isFinished = true;
        if (typeof onCommit === 'function') onCommit(initialVal);
        if (global.Popover) global.Popover.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commitValue(inputEl.value);
      }
    };

    inputEl.onblur = () => {
      if (!isFinished && global.Popover && typeof global.Popover.isOpen === 'function' && global.Popover.isOpen()) {
        commitValue(inputEl.value);
      }
    };

    global.Popover.open(anchorEl, popover);

    setTimeout(() => {
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      }
    }, 50);
  }

  global.FishElements = global.FishElements || {};
  global.FishElements.openNumberInput = openNumberInput;
  global.openValueInputPopover = openNumberInput;
})(typeof window !== 'undefined' ? window : globalThis);
