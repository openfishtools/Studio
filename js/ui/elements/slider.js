/**
 * OpenFishTools Studio - Universal Ruler Scrubber / Slider Element
 * 
 * Features:
 * 1. Physical 1:1 Needle Tracking: Tape moves 1:1 with mouse cursor under stationary needle.
 * 2. Standard Drag Direction: Drag right decreases value, drag left increases value.
 * 3. Integrated Numeric Popover: Clicking badge opens direct number input popover.
 * 4. Speed Modifiers: Shift = 0.2x (high precision), Alt = 3.0x (fast scrub).
 * 5. Bounded Tape & Infinite Jog Wheel Modes.
 */
(function(global) {
  'use strict';

  function formatDisplayVal(val, options = {}) {
    const { unit = '', min = -Infinity, step = 1, decimals = null, isAngle = false } = options;
    if (isAngle) {
      const angleVal = Math.round(Number(val) || 0);
      const turns = Math.trunc(angleVal / 360);
      const rem = Math.round(angleVal % 360);
      return (turns !== 0)
        ? `${turns}x ${rem >= 0 ? '+' : ''}${rem}°`
        : `${rem >= 0 ? '+' : ''}${rem}°`;
    }
    const isDec = decimals !== null ? decimals > 0 : (step < 1 || unit === 'x' || unit.includes('.'));
    const decDigits = decimals !== null ? decimals : (isDec ? 2 : 0);
    const num = isDec ? Number(val).toFixed(decDigits) : Math.round(val);
    const prefix = (num >= 0 && min < 0) ? '+' : '';
    return `${prefix}${num}${unit}`;
  }

  function renderRulerScrubberHTML(options = {}) {
    const {
      id = '',
      className = '',
      title = 'Drag to adjust value',
      min = 0,
      max = 100,
      step = 1,
      unit = '',
      value = 0,
      decimals = null,
      axisBadge = '',
      tapeWidth = null,
      isBounded = true,
      ariaLabel = 'Ruler Scrubber',
      dataParam = '',
      isAngle = false,
      badgeClassName = '',
      badgeTitle = 'Click to edit value'
    } = options;

    const span = Math.max(0, max - min);
    const calculatedTapeW = tapeWidth || (span > 480 ? span : 480);
    const ratio = span > 0 ? Math.max(0, Math.min(1, (value - min) / span)) : 0;
    const initialOffset = (-ratio * calculatedTapeW).toFixed(1);
    const formatted = formatDisplayVal(value, { unit, min, step, decimals, isAngle });

    const paramAttr = dataParam ? ` data-param="${dataParam}"` : '';
    const angleAttrs = isAngle ? ` data-type="angle" data-is-angle="true" data-unlimited="true"` : '';
    const minMaxAttrs = isAngle ? '' : ` aria-valuemin="${min}" aria-valuemax="${max}" data-min="${min}" data-max="${max}"`;
    const stepAttr = (step && !isAngle) ? ` data-step="${step}"` : '';
    const unitAttr = unit ? ` data-unit="${unit}"` : '';
    const ticksStyle = isAngle ? '' : ` style="--tape-width: ${calculatedTapeW}px; --tape-offset: ${initialOffset}px;" data-tape-width="${calculatedTapeW}"`;
    const boundedClass = (!isAngle && isBounded) ? ' is-bounded-tape' : '';
    const badgeParamAttr = dataParam ? ` data-param="${dataParam}"` : '';
    const badgeClass = badgeClassName ? ` ${badgeClassName}` : '';

    return `
      <div class="effects-param-pill jog-wheel-container is-horizontal effects-ruler-scrubber ${className}" ${id ? `id="${id}"` : ''}${paramAttr}${unitAttr}${minMaxAttrs}${stepAttr}${angleAttrs} title="${title}" role="slider" aria-label="${ariaLabel}" aria-valuenow="${value}">
        <div class="jog-wheel-track-viewport">
          <div class="jog-wheel-ticks${boundedClass}"${ticksStyle}></div>
        </div>
        <div class="jog-wheel-needle"></div>
        ${axisBadge ? `<span class="effects-axis-badge">${axisBadge}</span>` : ''}
        <span class="effects-param-pill-val${badgeClass}"${badgeParamAttr} title="${badgeTitle}">${formatted}</span>
      </div>
    `.trim();
  }

  function bindRulerScrubber(element, options = {}) {
    if (!element) return null;

    const isAngle = Boolean(options.isAngle || element.dataset.type === 'angle' || element.dataset.isAngle === 'true');
    const min = options.min !== undefined ? Number(options.min) : (element.dataset.min !== undefined ? Number(element.dataset.min) : (isAngle ? -Infinity : 0));
    const max = options.max !== undefined ? Number(options.max) : (element.dataset.max !== undefined ? Number(element.dataset.max) : (isAngle ? Infinity : 100));
    const step = options.step !== undefined ? Number(options.step) : (element.dataset.step !== undefined ? Number(element.dataset.step) : 1);
    const unit = options.unit !== undefined ? String(options.unit) : (element.dataset.unit || '');
    const decimals = options.decimals !== undefined ? options.decimals : (step < 1 ? 2 : 0);
    const label = options.label || element.getAttribute('aria-label') || 'Value';

    const ticksEl = element.querySelector('.jog-wheel-ticks');
    const badgeEl = element.querySelector('.effects-param-pill-val');
    const trackEl = element.querySelector('.effects-pill-track');

    const span = Math.max(0, max - min);
    let tapeW = options.tapeWidth || (ticksEl ? (parseFloat(ticksEl.dataset.tapeWidth) || parseFloat(getComputedStyle(ticksEl).getPropertyValue('--tape-width')) || 480) : 480);
    if (span > tapeW && Number.isFinite(span)) {
      tapeW = span;
      if (ticksEl) {
        ticksEl.dataset.tapeWidth = String(tapeW);
        ticksEl.style.setProperty('--tape-width', `${tapeW}px`);
      }
    }

    let currentVal = options.value !== undefined ? Number(options.value) : (element.getAttribute('aria-valuenow') !== null ? Number(element.getAttribute('aria-valuenow')) : (isAngle ? 0 : min));
    let startVal = currentVal;

    function updateVisuals(val) {
      const clamped = Math.max(min, Math.min(max, val));
      const ratio = (span > 0 && Number.isFinite(span)) ? (clamped - min) / span : 0;
      const offset = -ratio * tapeW;

      if (ticksEl && ticksEl.classList.contains('is-bounded-tape')) {
        ticksEl.style.setProperty('--tape-offset', `${offset.toFixed(1)}px`);
        ticksEl.style.transform = `translateX(${offset.toFixed(1)}px)`;
        ticksEl.style.clipPath = 'none';
      } else if (ticksEl && isAngle) {
        const tickOffset = (clamped * 2);
        ticksEl.style.setProperty('background-position-x', `${tickOffset.toFixed(1)}px`, 'important');
      }

      if (trackEl) {
        if (isAngle) {
          const normAngle = ((clamped % 360) + 360) % 360;
          trackEl.style.width = `${((normAngle / 360) * 100).toFixed(1)}%`;
        } else {
          trackEl.style.width = `${(ratio * 100).toFixed(1)}%`;
        }
      }

      if (badgeEl) {
        badgeEl.textContent = formatDisplayVal(clamped, { unit, min, step, decimals, isAngle });
      }

      element.setAttribute('aria-valuenow', String(clamped));
    }

    // Direct click on value badge to open numeric popover
    if (badgeEl && !badgeEl._scrubberBadgeWired) {
      badgeEl._scrubberBadgeWired = true;
      badgeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const openPopover = (global.FishElements && global.FishElements.openNumberInput) || global.openValueInputPopover;
        if (typeof openPopover === 'function') {
          openPopover(badgeEl, {
            title: label,
            value: currentVal,
            defaultValue: currentVal,
            min: min,
            max: max,
            step: step,
            unit: unit,
            onCommit: (newVal) => {
              currentVal = newVal;
              updateVisuals(newVal);
              const curOpts = element._rulerScrubberOptions || options;
              if (typeof curOpts.onChange === 'function') curOpts.onChange(newVal, true);
              if (typeof curOpts.onCommit === 'function') curOpts.onCommit(newVal);
            }
          });
        }
      });
    }

    element._rulerScrubberOptions = options;

    // Mouse wheel scroll to adjust slider value
    if (!element._rulerScrubberWheelWired) {
      element._rulerScrubberWheelWired = true;
      let wheelAccumulator = 0;
      let wheelCommitTimeout = null;
      let wheelInternalVal = currentVal;

      element.addEventListener('wheel', (e) => {
        // Do not intercept if user is interacting with an input/select
        if (e.target && e.target.closest('input, select, textarea')) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const curOpts = element._rulerScrubberOptions || options;

        if (!wheelCommitTimeout) {
          if (typeof curOpts.onStart === 'function') curOpts.onStart(e);
          const attrVal = element.getAttribute('aria-valuenow');
          if (attrVal !== null && !isNaN(Number(attrVal))) {
            currentVal = Number(attrVal);
          }
          wheelInternalVal = currentVal;
          wheelAccumulator = 0;
        }

        // Determine dominant scroll direction
        let rawDelta = 0;
        if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
          // Scroll up (deltaY < 0) increases value; scroll down (deltaY > 0) decreases value
          rawDelta = -e.deltaY;
        } else {
          // Scroll right (deltaX > 0) increases value; scroll left (deltaX < 0) decreases value
          rawDelta = e.deltaX;
        }

        if (!rawDelta) return;

        // Modifiers: Shift = fine precision, Alt/Ctrl = fast scrub
        const isFine = Boolean(e.shiftKey);
        const isFast = Boolean(e.altKey || e.ctrlKey || e.metaKey);

        let effectiveStep = step;
        let speed = 1.0;

        if (decimals > 0) {
          effectiveStep = isFine ? Math.max(Math.pow(10, -decimals), step * 0.1) : step;
          speed = isFast ? 5.0 : 1.0;
        } else {
          effectiveStep = step;
          speed = isFine ? 0.2 : (isFast ? 5.0 : 1.0);
        }

        let stepCount = 0;
        if (e.deltaMode === 1) {
          // Line mode (Firefox)
          stepCount = Math.sign(rawDelta) * Math.max(1, Math.round(Math.abs(rawDelta) / 3)) * speed;
        } else if (e.deltaMode === 2) {
          // Page mode
          stepCount = Math.sign(rawDelta) * 10 * speed;
        } else {
          // Pixel mode (Chrome, Safari, macOS trackpad / mouse)
          if (Math.abs(rawDelta) >= 40) {
            // Discrete mouse wheel notch
            stepCount = Math.sign(rawDelta) * Math.max(1, Math.round(Math.abs(rawDelta) / 100)) * speed;
          } else {
            // Smooth trackpad / continuous wheel
            wheelAccumulator += rawDelta;
            const threshold = 16;
            if (Math.abs(wheelAccumulator) >= threshold) {
              stepCount = Math.sign(wheelAccumulator) * Math.max(1, Math.floor(Math.abs(wheelAccumulator) / threshold)) * speed;
              wheelAccumulator %= threshold;
            }
          }
        }

        if (stepCount !== 0) {
          const deltaVal = stepCount * effectiveStep;
          wheelInternalVal = Math.max(min, Math.min(max, wheelInternalVal + deltaVal));

          const quantVal = (decimals > 0)
            ? Number((Math.round(wheelInternalVal / effectiveStep) * effectiveStep).toFixed(decimals))
            : Math.round(wheelInternalVal);

          const clampedVal = Math.max(min, Math.min(max, quantVal));

          if (clampedVal !== currentVal) {
            currentVal = clampedVal;
            wheelInternalVal = clampedVal;
            updateVisuals(clampedVal);
            if (typeof curOpts.onChange === 'function') curOpts.onChange(clampedVal, false);
          }
        }

        if (wheelCommitTimeout) clearTimeout(wheelCommitTimeout);
        wheelCommitTimeout = setTimeout(() => {
          wheelCommitTimeout = null;
          wheelAccumulator = 0;
          wheelInternalVal = currentVal;
          if (typeof curOpts.onChange === 'function') curOpts.onChange(currentVal, true);
          if (typeof curOpts.onCommit === 'function') curOpts.onCommit(currentVal);
        }, 180);
      }, { passive: false });
    }

    // Bind physical jog wheel interaction
    if (typeof global.bindJogWheel === 'function') {
      global.bindJogWheel(element, {
        onStart: (e) => {
          const curOpts = element._rulerScrubberOptions || options;
          if (typeof curOpts.onStart === 'function') {
            if (curOpts.onStart(e) === false) return false;
          }
          const attrVal = element.getAttribute('aria-valuenow');
          if (attrVal !== null && !isNaN(Number(attrVal))) {
            currentVal = Number(attrVal);
          }
          startVal = currentVal;
          if (ticksEl) {
            tapeW = parseFloat(ticksEl.dataset.tapeWidth) || parseFloat(getComputedStyle(ticksEl).getPropertyValue('--tape-width')) || tapeW;
          }
        },
        onMove: (rawDelta, e) => {
          const speed = (e && e.shiftKey) ? 0.2 : ((e && e.altKey) ? 3.0 : 1.0);
          const rate = (span > 0 && Number.isFinite(span)) ? (span / tapeW) : 1.0;
          // Drag right (rawDelta > 0) decreases value, drag left (rawDelta < 0) increases value
          const nextVal = startVal - rawDelta * rate * speed;
          currentVal = Math.max(min, Math.min(max, nextVal));
          const quantVal = (decimals > 0)
            ? Number((Math.round(currentVal / step) * step).toFixed(decimals))
            : Math.round(currentVal);
          updateVisuals(quantVal);
          const curOpts = element._rulerScrubberOptions || options;
          if (typeof curOpts.onChange === 'function') curOpts.onChange(quantVal, false);
        },
        onEnd: () => {
          const quantVal = (decimals > 0)
            ? Number((Math.round(currentVal / step) * step).toFixed(decimals))
            : Math.round(currentVal);
          updateVisuals(quantVal);
          const curOpts = element._rulerScrubberOptions || options;
          if (typeof curOpts.onChange === 'function') curOpts.onChange(quantVal, true);
          if (typeof curOpts.onCommit === 'function') curOpts.onCommit(quantVal);
        }
      });
    } else {
      let isDragging = false;
      let startX = 0;
      element.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target && e.target.closest('.effects-param-pill-val, input, select')) return;
        const curOpts = element._rulerScrubberOptions || options;
        if (typeof curOpts.onStart === 'function') {
          if (curOpts.onStart(e) === false) return;
        }
        const attrVal = element.getAttribute('aria-valuenow');
        if (attrVal !== null && !isNaN(Number(attrVal))) {
          currentVal = Number(attrVal);
        }
        isDragging = true;
        startX = e.clientX;
        startVal = currentVal;
        try { element.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      });
      element.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const speed = (e && e.shiftKey) ? 0.2 : ((e && e.altKey) ? 3.0 : 1.0);
        const delta = e.clientX - startX;
        const rate = (span > 0 && Number.isFinite(span)) ? (span / tapeW) : 1.0;
        const nextVal = startVal - delta * rate * speed;
        currentVal = Math.max(min, Math.min(max, nextVal));
        const quantVal = (decimals > 0)
          ? Number((Math.round(currentVal / step) * step).toFixed(decimals))
          : Math.round(currentVal);
        updateVisuals(quantVal);
        const curOpts = element._rulerScrubberOptions || options;
        if (typeof curOpts.onChange === 'function') curOpts.onChange(quantVal, false);
      });
      const onEnd = (e) => {
        if (!isDragging) return;
        isDragging = false;
        if (e && e.pointerId !== undefined) {
          try { element.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        const quantVal = (decimals > 0)
          ? Number((Math.round(currentVal / step) * step).toFixed(decimals))
          : Math.round(currentVal);
        updateVisuals(quantVal);
        const curOpts = element._rulerScrubberOptions || options;
        if (typeof curOpts.onChange === 'function') curOpts.onChange(quantVal, true);
        if (typeof curOpts.onCommit === 'function') curOpts.onCommit(quantVal);
      };
      element.addEventListener('pointerup', onEnd);
      element.addEventListener('pointercancel', onEnd);
    }

    updateVisuals(currentVal);

    const controller = {
      element,
      getValue: () => currentVal,
      setValue: (val, commit = false) => {
        currentVal = Math.max(min, Math.min(max, Number(val)));
        updateVisuals(currentVal);
        const curOpts = element._rulerScrubberOptions || options;
        if (commit && typeof curOpts.onCommit === 'function') curOpts.onCommit(currentVal);
      },
      updateVisuals
    };

    element._rulerScrubberController = controller;
    return controller;
  }

  function createRulerScrubber(parent, options = {}) {
    const tempWrap = document.createElement('div');
    tempWrap.innerHTML = renderRulerScrubberHTML(options);
    const element = tempWrap.firstElementChild;
    if (parent && typeof parent.appendChild === 'function') {
      parent.appendChild(element);
    }
    bindRulerScrubber(element, options);
    return element;
  }

  global.FishElements = global.FishElements || {};
  global.FishElements.renderRulerScrubberHTML = renderRulerScrubberHTML;
  global.FishElements.bindRulerScrubber = bindRulerScrubber;
  global.FishElements.createRulerScrubber = createRulerScrubber;
  // Aliases for convenience
  global.FishElements.createSlider = createRulerScrubber;
  global.FishElements.bindSlider = bindRulerScrubber;
  global.FishElements.renderSliderHTML = renderRulerScrubberHTML;
})(typeof window !== 'undefined' ? window : globalThis);
