/**
 * OpenFishTools Studio - Universal Modular Elements Hub (FishElements)
 * 
 * Bundles:
 * - Slider / Ruler Scrubber (slider.js)
 * - Custom Dropdown (dropdown.js)
 * - Segmented Switch (segmented.js)
 * - Number Input Popover (number-input.js)
 * - Color Input (color-input.js)
 */
(function(global) {
  'use strict';

  const FishElements = global.FishElements || {};

  /**
   * Auto-initializes declarative elements within a root container
   * @param {HTMLElement|Document} root 
   */
  function initAll(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;

    // 1. Auto-bind Declarative Sliders [data-ruler-scrubber]
    if (typeof FishElements.bindRulerScrubber === 'function') {
      root.querySelectorAll('[data-ruler-scrubber]').forEach(el => {
        if (!el._rulerScrubberController) {
          FishElements.bindRulerScrubber(el);
        }
      });
    }

    // 2. Auto-bind Declarative Dropdowns [data-custom-dropdown]
    if (typeof FishElements.bindDropdown === 'function') {
      root.querySelectorAll('[data-custom-dropdown]').forEach(el => {
        if (!el._dropdownController) {
          FishElements.bindDropdown(el);
        }
      });
    }

    // 3. Auto-bind Declarative Segmented Switches [data-segmented-switch]
    if (typeof FishElements.bindSegmented === 'function') {
      root.querySelectorAll('[data-segmented-switch]').forEach(el => {
        if (!el._segmentedController) {
          FishElements.bindSegmented(el);
        }
      });
    }

    // 4. Auto-bind Declarative Color Inputs [data-color-input]
    if (typeof FishElements.bindColorInput === 'function') {
      root.querySelectorAll('[data-color-input]').forEach(el => {
        if (!el._colorInputController) {
          FishElements.bindColorInput(el);
        }
      });
    }
  }

  FishElements.initAll = initAll;
  global.FishElements = FishElements;
  if (typeof window !== 'undefined') {
    window.FishElements = FishElements;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => initAll(document));
    } else {
      initAll(document);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
