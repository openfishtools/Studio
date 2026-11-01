/**
 * OpenFishTools Studio - Universal Card Builder & Modular JS Extension SDK
 * 
 * Provides:
 * 1. Declarative Card({ ... }) DSL for modular .js extension cards.
 * 2. Universal UI builder (ui.button, ui.text, ui.section, ui.divider, ui.grid, ui.input, ui.textarea, ui.switch, ui.slider, ui.segmented, ui.anchorGrid, ui.checklist).
 * 3. High-level Modular Extension SDK on `ctx` (ctx.layers, ctx.timeline, ctx.effects, ctx.audio, ctx.storage, ctx.runTool).
 * 4. Validation & sandbox loader for user-imported .js extension files.
 * 5. Extension state persistence (On/Off switches synced to localStorage).
 */
(function(global) {
  'use strict';

  const STORAGE_STATES_KEY = 'oft_extension_states';
  const STORAGE_CUSTOM_KEY = 'oft_custom_extensions';

  // In-memory registry of all loaded cards and their self-contained tools
  const _cardRegistry = new Map();
  const _cardSourceMap = new Map(); // id -> raw JS string
  const _toolRegistry = new Map(); // toolName -> { cardId, fn }

  /**
   * Helper to safely read localStorage JSON
   */
  function readStorage(key, fallback = {}) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  /**
   * Helper to safely write localStorage JSON
   */
  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[CardBuilder] Storage write failed:', err);
    }
  }

  /**
   * Card State Manager (Enabled / Disabled)
   */
  const CardState = {
    getAllStates() {
      return readStorage(STORAGE_STATES_KEY, {});
    },
    isEnabled(id, defaultVal = true) {
      const states = this.getAllStates();
      return states[id] !== undefined ? !!states[id] : defaultVal;
    },
    setEnabled(id, enabled) {
      const states = this.getAllStates();
      states[id] = !!enabled;
      writeStorage(STORAGE_STATES_KEY, states);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('extension-state-changed', {
          detail: { id, enabled: !!enabled }
        }));
      }
    }
  };

  /**
   * UI Builder Instance passed into card.build(ui, ctx)
   */
  function createUIBuilder(container, ctx) {
    return {
      container,

      /**
       * Create a child UI builder scoped to a sub-container
       */
      createSubBuilder(subContainer) {
        return createUIBuilder(subContainer || container, ctx);
      },

      /**
       * Section / Divider label (Pembatas)
       */
      section(title, subtitle) {
        const wrap = document.createElement('div');
        wrap.className = 'extension-section-header';
        const label = document.createElement('span');
        label.className = 'extension-section-label';
        label.textContent = title;
        wrap.appendChild(label);
        if (subtitle) {
          const sub = document.createElement('small');
          sub.className = 'extension-section-sub';
          sub.textContent = subtitle;
          wrap.appendChild(sub);
        }
        container.appendChild(wrap);
        return wrap;
      },

      divider(label) {
        return this.section(label);
      },

      /**
       * Button Element (Tombol)
       */
      button(opts = {}) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `tool-btn extension-tool-btn ${opts.className || ''}`.trim();
        if (opts.id) btn.id = opts.id;

        const hasContext = typeof opts.onContextMenu === 'function' || opts.hasContext === true;
        if (hasContext) {
          btn.classList.add('has-context');
        }

        let fullTitle = opts.title || opts.label || '';
        if (opts.rightTitle) {
          fullTitle = fullTitle ? `${fullTitle} (Right-click: ${opts.rightTitle})` : `Right-click: ${opts.rightTitle}`;
        }
        if (fullTitle) btn.title = fullTitle;

        // Custom icon / hint graphic
        if (opts.hint) {
          const hintBox = document.createElement('div');
          hintBox.className = 'tool-hint-box';
          hintBox.textContent = opts.hint;
          btn.appendChild(hintBox);
        } else if (opts.icon) {
          if (opts.icon.startsWith('<svg')) {
            const svgBox = document.createElement('span');
            svgBox.className = 'tool-icon-svg';
            svgBox.innerHTML = opts.icon;
            btn.appendChild(svgBox);
          } else if (opts.icon.startsWith('fticon-')) {
            const iconEl = document.createElement('i');
            iconEl.className = `fticon ${opts.icon}`;
            iconEl.setAttribute('aria-hidden', 'true');
            btn.appendChild(iconEl);
          } else {
            const iconEl = document.createElement('span');
            iconEl.className = 'material-icons tool-btn-icon';
            iconEl.setAttribute('aria-hidden', 'true');
            iconEl.textContent = opts.icon;
            btn.appendChild(iconEl);
          }
        }

        if (opts.label) {
          const lbl = document.createElement('span');
          lbl.className = 'tool-label';
          lbl.textContent = opts.label;
          btn.appendChild(lbl);
        }

        const getPCM = () => (typeof window !== 'undefined' && (window.PreviewCacheManager || (window.parent && window.parent.PreviewCacheManager))) || null;
        const redrawHost = (reason) => {
          if (typeof window !== 'undefined' && typeof window.redrawComposition === 'function') {
            window.redrawComposition(reason);
          } else if (typeof window !== 'undefined' && window.parent && typeof window.parent.redrawComposition === 'function') {
            window.parent.redrawComposition(reason);
          }
        };

        let holdTimer = null;
        let isLongPressed = false;
        let startX = 0;
        let startY = 0;

        const invokeContextMenu = (e) => {
          btn.classList.add('tool-btn--active');
          setTimeout(() => btn.classList.remove('tool-btn--active'), 180);
          const pcm = getPCM();
          const beforeSnap = (pcm && typeof pcm.captureStateSnapshot === 'function') ? pcm.captureStateSnapshot() : null;
          try {
            opts.onContextMenu(e, ctx);
          } catch (err) {
            console.error(`[Card:${ctx.id}] Context menu error:`, err);
            ctx.showToast(`Error: ${err.message}`);
          } finally {
            if (pcm && beforeSnap && typeof pcm.invalidateSmartDiff === 'function') {
              if (pcm.invalidateSmartDiff(beforeSnap)) {
                redrawHost(`extContext:${ctx.id}`);
              }
            }
          }
        };

        if (typeof opts.onContextMenu === 'function') {
          btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (holdTimer) {
              clearTimeout(holdTimer);
              holdTimer = null;
            }
            if (isLongPressed) {
              isLongPressed = false;
              return;
            }
            invokeContextMenu(e);
          });

          // Mobile / touch hold 2 seconds (2000ms) to trigger right-click / contextmenu
          btn.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            isLongPressed = false;
            startX = e.clientX;
            startY = e.clientY;
            if (holdTimer) clearTimeout(holdTimer);
            holdTimer = setTimeout(() => {
              holdTimer = null;
              isLongPressed = true;
              if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                try { navigator.vibrate(50); } catch (_) {}
              }
              invokeContextMenu(e);
            }, 2000);
          });

          btn.addEventListener('pointermove', (e) => {
            if (!holdTimer) return;
            const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
            if (dist > 10) {
              clearTimeout(holdTimer);
              holdTimer = null;
            }
          });

          const cancelHold = () => {
            if (holdTimer) {
              clearTimeout(holdTimer);
              holdTimer = null;
            }
          };
          btn.addEventListener('pointerup', cancelHold);
          btn.addEventListener('pointercancel', cancelHold);
        }

        if (typeof opts.onClick === 'function') {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (isLongPressed) {
              isLongPressed = false;
              return;
            }
            btn.classList.add('tool-btn--active');
            setTimeout(() => btn.classList.remove('tool-btn--active'), 180);
            const pcm = getPCM();
            const beforeSnap = (pcm && typeof pcm.captureStateSnapshot === 'function') ? pcm.captureStateSnapshot() : null;
            try {
              opts.onClick(e, ctx);
            } catch (err) {
              console.error(`[Card:${ctx.id}] Button click error:`, err);
              ctx.showToast(`Error: ${err.message}`);
            } finally {
              if (pcm && beforeSnap && typeof pcm.invalidateSmartDiff === 'function') {
                if (pcm.invalidateSmartDiff(beforeSnap)) {
                  redrawHost(`extClick:${ctx.id}`);
                }
              }
            }
          });
        }

        container.appendChild(btn);
        return btn;
      },

      /**
       * Responsive Grid Container (col-2, col-3, col-4, col-5, col-6)
       */
      grid(opts = {}, items = []) {
        const grid = document.createElement('div');
        const cols = opts.cols || 3;
        grid.className = `toolbox-grid col-${cols} ${opts.className || ''}`.trim();
        if (opts.id) grid.id = opts.id;

        const subUI = createUIBuilder(grid, ctx);
        if (Array.isArray(items)) {
          items.forEach(item => {
            if (typeof item === 'function') {
              item(subUI, ctx);
            } else if (item instanceof HTMLElement) {
              grid.appendChild(item);
            }
          });
        } else if (typeof items === 'function') {
          items(subUI, ctx);
        }

        container.appendChild(grid);
        return grid;
      },

      /**
       * Segmented Mode / Option Selector (Declarative button group with active state)
       */
      segmented(opts = {}) {
        const targetContainer = (opts && opts.container) || (this && this.container) || container;
        const wrap = document.createElement('div');
        if (opts.style) Object.assign(wrap.style, opts.style);

        if (opts.label) {
          const lbl = document.createElement('span');
          lbl.className = 'status-label';
          lbl.textContent = opts.label;
          wrap.appendChild(lbl);
        }

        const options = Array.isArray(opts.options) ? opts.options : [];
        const cols = opts.cols || Math.max(1, options.length);
        const grid = document.createElement('div');
        grid.className = `toolbox-grid col-${cols} ${opts.className || ''}`.trim();
        if (opts.label) grid.style.marginTop = '4px';

        let currentVal = opts.value !== undefined ? opts.value : (options[0] && options[0].id);
        const buttons = [];

        const syncActive = () => {
          buttons.forEach(({ id, btn }) => {
            btn.classList.toggle('tool-btn--active', id === currentVal);
          });
        };

        options.forEach(opt => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `tool-btn extension-tool-btn ${currentVal === opt.id ? 'tool-btn--active' : ''}`.trim();
          if (opt.title) btn.title = opt.title;

          let inner = '';
          if (opt.icon) {
            inner += `<span class="material-icons tool-btn-icon" aria-hidden="true">${opt.icon}</span>`;
          }
          if (opt.label) {
            inner += `<span class="tool-label">${opt.label}</span>`;
          }
          btn.innerHTML = inner;

          btn.addEventListener('click', (e) => {
            e.preventDefault();
            currentVal = opt.id;
            syncActive();
            if (typeof opts.onChange === 'function') {
              opts.onChange(currentVal, opt, e, ctx);
            }
          });

          buttons.push({ id: opt.id, btn });
          grid.appendChild(btn);
        });

        wrap.appendChild(grid);
        targetContainer.appendChild(wrap);
        return {
          container: wrap,
          grid,
          getValue: () => currentVal,
          setValue(val) {
            currentVal = val;
            syncActive();
          }
        };
      },

      /**
       * 9-Point Anchor Grid Component
       */
      anchorGrid(opts = {}) {
        const wrapper = document.createElement('div');
        wrapper.className = 'anchor-grid-wrapper';

        const grid = document.createElement('div');
        grid.className = 'anchor-grid';

        const positions = [
          { id: 1, title: 'Top Left' },
          { id: 2, title: 'Top Center' },
          { id: 3, title: 'Top Right' },
          { id: 4, title: 'Middle Left' },
          { id: 5, title: 'Center' },
          { id: 6, title: 'Middle Right' },
          { id: 7, title: 'Bottom Left' },
          { id: 8, title: 'Bottom Center' },
          { id: 9, title: 'Bottom Right' }
        ];

        positions.forEach(p => {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'anchor-cell';
          cell.title = p.title;
          cell.setAttribute('aria-label', p.title);
          cell.addEventListener('click', () => {
            cell.classList.add('anchor-active');
            setTimeout(() => cell.classList.remove('anchor-active'), 180);
            if (typeof opts.onSelect === 'function') {
              opts.onSelect(p.id, p, ctx);
            } else {
              ctx.runTool('setAnchorPoint', p.id);
            }
          });
          grid.appendChild(cell);
        });

        wrapper.appendChild(grid);
        container.appendChild(wrapper);
        return wrapper;
      },

      /**
       * Interactive Checklist / To-Do List Component
       */
      checklist(opts = {}) {
        let tasks = Array.isArray(opts.items) ? opts.items.slice() : [];
        const listWrap = document.createElement('div');
        listWrap.className = 'todo-list-container';

        const notifyChange = () => {
          if (typeof opts.onChange === 'function') {
            opts.onChange(tasks, ctx);
          }
        };

        function renderTasks() {
          listWrap.innerHTML = '';
          tasks.forEach((t, idx) => {
            const item = document.createElement('div');
            item.className = `todo-item ${t.done ? 'is-done' : ''}`;

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = !!t.done;
            chk.addEventListener('change', () => {
              tasks[idx].done = chk.checked;
              notifyChange();
              renderTasks();
            });

            const span = document.createElement('span');
            span.className = 'todo-text';
            span.textContent = t.text;

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'todo-del-btn';
            del.textContent = '×';
            del.title = 'Delete Task';
            del.addEventListener('click', () => {
              tasks.splice(idx, 1);
              notifyChange();
              renderTasks();
            });

            item.appendChild(chk);
            item.appendChild(span);
            item.appendChild(del);
            listWrap.appendChild(item);
          });
        }

        const inputRow = document.createElement('div');
        inputRow.className = 'todo-input-row';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'extension-input todo-input-field';
        input.placeholder = opts.placeholder || 'Add new task...';

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'tool-btn todo-add-btn';
        addBtn.innerHTML = '<span class="material-icons" style="font-size:16px;">add</span>';
        addBtn.title = 'Add Task';

        function addTask() {
          const val = input.value.trim();
          if (!val) return;
          tasks.push({ text: val, done: false });
          notifyChange();
          input.value = '';
          renderTasks();
        }

        addBtn.addEventListener('click', addTask);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') addTask();
        });

        inputRow.appendChild(input);
        inputRow.appendChild(addBtn);

        container.appendChild(inputRow);
        container.appendChild(listWrap);
        renderTasks();

        return { inputRow, listWrap, refresh: renderTasks };
      },

      /**
       * Text element (Title, Label, Display, Hint, Description)
       */
      text(opts = {}) {
        const targetContainer = (opts && opts.container) || (this && this.container) || container;
        const textStr = typeof opts === 'string' ? opts : (opts.text || '');
        const variant = typeof opts === 'object' ? (opts.variant || 'label') : 'label';
        const el = document.createElement(variant === 'display' ? 'div' : 'span');
        el.className = `extension-text extension-text--${variant} ${opts.className || ''}`.trim();
        if (opts.id) el.id = opts.id;
        if (opts.style && typeof opts.style === 'object') {
          Object.assign(el.style, opts.style);
        }
        el.textContent = textStr;
        targetContainer.appendChild(el);
        return el;
      },

      /**
       * Text Input Field
       */
      input(opts = {}) {
        const targetContainer = (opts && opts.container) || (this && this.container) || container;
        const input = document.createElement('input');
        input.type = opts.type || 'text';
        input.className = `extension-input ${opts.className || ''}`.trim();
        if (opts.id) input.id = opts.id;
        if (opts.value !== undefined) input.value = opts.value;
        if (opts.placeholder) input.placeholder = opts.placeholder;
        if (opts.min !== undefined) input.min = opts.min;
        if (opts.max !== undefined) input.max = opts.max;
        if (opts.step !== undefined) input.step = opts.step;

        if (typeof opts.onChange === 'function') {
          input.addEventListener('input', (e) => opts.onChange(e.target.value, e, ctx));
        }

        targetContainer.appendChild(input);
        return input;
      },

      /**
       * Multi-line Text Area (for Sticky Notes, Bubble Text)
       */
      textarea(opts = {}) {
        const ta = document.createElement('textarea');
        ta.className = `extension-textarea ${opts.className || ''}`.trim();
        if (opts.id) ta.id = opts.id;
        if (opts.value !== undefined) ta.value = opts.value;
        if (opts.placeholder) ta.placeholder = opts.placeholder;
        if (opts.rows) ta.rows = opts.rows;

        if (typeof opts.onChange === 'function') {
          ta.addEventListener('input', (e) => opts.onChange(e.target.value, e, ctx));
        }

        container.appendChild(ta);
        return ta;
      },

      /**
       * Form Row (horizontal flex container for side-by-side inputs)
       */
      formRow(items = []) {
        const row = document.createElement('div');
        row.className = 'form-row';
        const subUI = createUIBuilder(row, ctx);
        if (Array.isArray(items)) {
          items.forEach(item => {
            if (typeof item === 'function') {
              item(subUI, ctx);
            } else if (item instanceof HTMLElement) {
              row.appendChild(item);
            }
          });
        } else if (typeof items === 'function') {
          items(subUI, ctx);
        }
        container.appendChild(row);
        return row;
      },

      /**
       * Form Group (Label + Input field)
       */
      formGroup(opts = {}) {
        const targetContainer = (opts && opts.container) || (this && this.container) || container;
        const grp = document.createElement('div');
        grp.className = `form-group ${opts.className || ''}`.trim();

        if (opts.label) {
          const lbl = document.createElement('label');
          lbl.className = 'status-label';
          lbl.textContent = opts.label;
          grp.appendChild(lbl);
        }

        const input = document.createElement('input');
        input.type = opts.type || 'text';
        input.className = `extension-input ${opts.inputClassName || ''}`.trim();
        if (opts.id) input.id = opts.id;
        if (opts.value !== undefined) input.value = opts.value;
        if (opts.placeholder) input.placeholder = opts.placeholder;
        if (opts.min !== undefined) input.min = opts.min;
        if (opts.max !== undefined) input.max = opts.max;
        if (opts.step !== undefined) input.step = opts.step;

        if (typeof opts.onChange === 'function') {
          input.addEventListener('input', (e) => opts.onChange(e.target.value, e, ctx));
        }

        grp.appendChild(input);
        targetContainer.appendChild(grp);
        return { group: grp, input };
      },

      /**
       * Toggle Switch (On/Off)
       */
      switch(opts = {}) {
        const wrap = document.createElement('label');
        wrap.className = `switch-container ${opts.className || ''}`.trim();

        const sw = document.createElement('span');
        sw.className = 'switch';

        const inp = document.createElement('input');
        inp.type = 'checkbox';
        if (opts.id) inp.id = opts.id;
        inp.checked = !!opts.checked;

        const slider = document.createElement('span');
        slider.className = 'slider';

        sw.appendChild(inp);
        sw.appendChild(slider);
        wrap.appendChild(sw);

        if (opts.label) {
          const lbl = document.createElement('span');
          lbl.className = 'switch-label';
          lbl.textContent = opts.label;
          wrap.appendChild(lbl);
        }

        if (typeof opts.onChange === 'function') {
          inp.addEventListener('change', (e) => opts.onChange(e.target.checked, e, ctx));
        }

        container.appendChild(wrap);
        return { container: wrap, input: inp };
      },

      /**
       * Custom Slider / Ruler Scrubber using Studio themed jog-wheel / ruler scrubber
       */
      slider(opts = {}) {
        const targetContainer = (opts && opts.container) || (this && this.container) || container;
        const wrap = document.createElement('div');
        wrap.className = `extension-slider-row ${opts.className || ''}`.trim();

        if (opts.label) {
          const lbl = document.createElement('span');
          lbl.className = 'status-label';
          lbl.textContent = opts.label;
          wrap.appendChild(lbl);
        }

        const min = opts.min !== undefined ? opts.min : 0;
        const max = opts.max !== undefined ? opts.max : 100;
        const step = opts.step !== undefined ? opts.step : 1;
        const value = opts.value !== undefined ? opts.value : 50;
        const unit = opts.unit || '';

        const fe = (typeof window !== 'undefined' && window.FishElements) ||
                   (typeof window !== 'undefined' && window.parent && window.parent.FishElements) ||
                   (typeof globalThis !== 'undefined' && globalThis.FishElements);

        let scrubberEl = null;

        if (fe && typeof fe.createSlider === 'function') {
          scrubberEl = fe.createSlider(wrap, {
            id: opts.id || '',
            min: min,
            max: max,
            step: step,
            unit: unit,
            value: value,
            label: opts.label || 'Value',
            ariaLabel: opts.label || 'Slider',
            title: opts.title || opts.label || 'Drag to adjust value',
            onChange(newVal) {
              if (typeof opts.onChange === 'function') {
                opts.onChange(newVal, null, ctx);
              }
            }
          });
        } else {
          // Self-contained themed ruler scrubber fallback
          const span = Math.max(0, max - min);
          const tapeW = Math.max(480, span);
          let curVal = value;
          const ratio = span > 0 ? Math.max(0, Math.min(1, (curVal - min) / span)) : 0;
          const initialOffset = (-ratio * tapeW).toFixed(1);

          const scrubWrap = document.createElement('div');
          scrubWrap.className = 'effects-param-pill jog-wheel-container is-horizontal effects-ruler-scrubber';
          scrubWrap.setAttribute('role', 'slider');
          scrubWrap.setAttribute('aria-label', opts.label || 'Slider');
          scrubWrap.setAttribute('aria-valuenow', String(curVal));
          scrubWrap.title = opts.title || opts.label || 'Drag to adjust value';
          scrubWrap.innerHTML = `
            <div class="jog-wheel-track-viewport">
              <div class="jog-wheel-ticks is-bounded-tape" style="--tape-width: ${tapeW}px; --tape-offset: ${initialOffset}px;"></div>
            </div>
            <div class="jog-wheel-needle"></div>
            <span class="effects-param-pill-val">${Math.round(curVal)}${unit}</span>
          `.trim();

          const ticks = scrubWrap.querySelector('.jog-wheel-ticks');
          const badge = scrubWrap.querySelector('.effects-param-pill-val');
          let isDragging = false;
          let startX = 0;
          let startVal = curVal;

          const updateVisuals = (val) => {
            curVal = Math.max(min, Math.min(max, val));
            const r = span > 0 ? (curVal - min) / span : 0;
            const off = (-r * tapeW).toFixed(1);
            if (ticks) ticks.style.setProperty('--tape-offset', `${off}px`);
            if (badge) badge.textContent = `${Math.round(curVal)}${unit}`;
            scrubWrap.setAttribute('aria-valuenow', String(curVal));
          };

          scrubWrap.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX;
            startVal = curVal;
            try { scrubWrap.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
          });

          scrubWrap.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const delta = e.clientX - startX;
            const speed = (span > 0) ? (span / tapeW) : 1;
            const nextVal = startVal - delta * speed;
            updateVisuals(nextVal);
            if (typeof opts.onChange === 'function') opts.onChange(curVal, e, ctx);
          });

          const onPointerEnd = (e) => {
            if (!isDragging) return;
            isDragging = false;
            try { scrubWrap.releasePointerCapture(e.pointerId); } catch (_) {}
            if (typeof opts.onChange === 'function') opts.onChange(curVal, e, ctx);
          };

          scrubWrap.addEventListener('pointerup', onPointerEnd);
          scrubWrap.addEventListener('pointercancel', onPointerEnd);

          wrap.appendChild(scrubWrap);
          scrubberEl = scrubWrap;
        }

        targetContainer.appendChild(wrap);
        return { container: wrap, scrubber: scrubberEl };
      },

      /**
       * Raw DOM Node / Custom injection
       */
      custom(elementOrHtml) {
        if (typeof elementOrHtml === 'string') {
          const wrap = document.createElement('div');
          wrap.innerHTML = elementOrHtml;
          Array.from(wrap.childNodes).forEach(node => container.appendChild(node));
          return wrap;
        } else if (elementOrHtml instanceof HTMLElement) {
          container.appendChild(elementOrHtml);
          return elementOrHtml;
        }
      }
    };
  }

  /**
   * Runtime Context & Modular Extension SDK provided to card.build(ui, ctx)
   */
  function createCardContext(def) {
    const cardStorageKey = `oft_card_store_${def.id}`;
    const getHostWindow = () => {
      if (typeof window !== 'undefined') {
        if (window.currentProjectState || window.PreviewCacheManager) return window;
        if (window.parent && (window.parent.currentProjectState || window.parent.PreviewCacheManager)) return window.parent;
      }
      return typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
    };

    const ctx = {
      id: def.id,
      name: def.name || def.id,

      getHost() {
        return getHostWindow();
      },

      invalidateCache(targetOrStartSec, endSec) {
        const host = getHostWindow();
        const pcm = host && host.PreviewCacheManager;
        if (!pcm) return;
        if (typeof targetOrStartSec === 'number' && typeof endSec === 'number') {
          pcm.invalidateRange(targetOrStartSec, endSec);
        } else if (targetOrStartSec && typeof targetOrStartSec === 'object') {
          if (typeof host.invalidatePreviewCacheForLayer === 'function') {
            host.invalidatePreviewCacheForLayer(targetOrStartSec);
          } else if (typeof pcm.invalidateLayer === 'function') {
            pcm.invalidateLayer(targetOrStartSec);
          }
        } else {
          pcm.clearAll('current');
        }
        if (host && typeof host.redrawComposition === 'function') {
          host.redrawComposition('invalidateCache');
        }
      },

      registerTool(toolName, handlerFn) {
        if (!toolName || typeof handlerFn !== 'function') return;
        _toolRegistry.set(String(toolName), { cardId: def.id, fn: handlerFn });
      },

      runTool(toolName, ...args) {
        const host = getHostWindow();
        const pcm = host && host.PreviewCacheManager;
        const beforeSnap = (pcm && typeof pcm.captureStateSnapshot === 'function') ? pcm.captureStateSnapshot() : null;
        try {
          // 1. Check self-contained extension tool registry first
          const registered = _toolRegistry.get(String(toolName));
          if (registered && typeof registered.fn === 'function') {
            const targetDef = _cardRegistry.get(registered.cardId) || def;
            const targetCtx = targetDef.id === def.id ? ctx : createCardContext(targetDef);
            const res = registered.fn.call(targetDef, targetCtx, ...args);
            if (pcm && beforeSnap && typeof pcm.invalidateSmartDiff === 'function') {
              if (pcm.invalidateSmartDiff(beforeSnap) && host && typeof host.redrawComposition === 'function') {
                host.redrawComposition(`runTool:${toolName}`);
              }
            }
            if (res && typeof res === 'object' && res.error) {
              if (res.message) this.showToast(res.message, true);
              return false;
            }
            return res !== undefined ? res : true;
          }

          // 2. Fallback to host executeFishTool if available
          if (typeof window !== 'undefined' && typeof window.executeFishTool === 'function' && !window._executingFishToolGuard) {
            const res = window.executeFishTool(toolName, ...args);
            if (pcm && beforeSnap && typeof pcm.invalidateSmartDiff === 'function') {
              if (pcm.invalidateSmartDiff(beforeSnap) && host && typeof host.redrawComposition === 'function') {
                host.redrawComposition(`runTool:${toolName}`);
              }
            }
            if (res && res.error) {
              if (res.message) this.showToast(res.message, true);
              return false;
            }
            return res !== undefined ? res : true;
          }
          if (host && typeof host.executeFishTool === 'function' && !host._executingFishToolGuard) {
            const res = host.executeFishTool(toolName, ...args);
            if (pcm && beforeSnap && typeof pcm.invalidateSmartDiff === 'function') {
              if (pcm.invalidateSmartDiff(beforeSnap) && typeof host.redrawComposition === 'function') {
                host.redrawComposition(`runTool:${toolName}`);
              }
            }
            if (res && res.error) {
              if (res.message) this.showToast(res.message, true);
              return false;
            }
            return res !== undefined ? res : true;
          }
        } catch (err) {
          console.error(`[Card:${def.id}] runTool error:`, err);
          this.showToast(`Error: ${err.message}`, true);
          return false;
        }

        // Layer-dependent tools guard when running outside active editor session
        const layerRequiredTools = new Set([
          'setAnchorPoint', 'ALIGN_LEFT', 'ALIGN_HCENTER', 'ALIGN_RIGHT', 'ALIGN_TOP', 'ALIGN_VCENTER', 'ALIGN_BOTTOM',
          'CUT_FRONT', 'CUT_MID', 'CUT_BACK', 'CUT_LEFT', 'CUT_RIGHT',
          'PRECOMP', 'PRECOMP_AUTOCROP', 'CENTER', 'CENTERINCOMP', 'OVERLAP', 'DUP_COMP', 'DUP',
          'FRZ', 'FIT', 'DSH', 'MIR', 'FILL', 'TINT', 'BLUR', 'LUM', 'CURV', 'HUE',
          'GHST', 'WARP', 'FISHEYE', 'MIDWAVE', 'HUESPIN', 'EXPO', 'SHAKY', 'LENS', 'OSCILLATE',
          'Y_BEAT', 'Y_FLIP', 'X_BEAT', 'X_FLIP', 'SCALE_BEAT', 'SWING',
          'PANNING_POS', 'PANNING_ROT', 'PANNING_SCALE', 'PANNING_MIX_PR', 'PANNING_MIX_ALL',
          'IDLE_MOVE_1', 'IDLE_MOVE_2', 'IDLE_MOVE_3', 'IDLE_MOVE_4', 'IDLE_MOVE_5', 'IDLE_MOVE_6',
          'PRESET_WARP1', 'PRESET_WARP2', 'PRESET_WARP3', 'TWIX', 'TMRE', 'AUTO_MARK'
        ]);

        if (layerRequiredTools.has(toolName)) {
          this.showToast('Pilih layer terlebih dahulu untuk menggunakan fitur ini', true);
          return false;
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('fishtools:tool', {
            detail: { tool: toolName, args }
          }));
        }

        this.showToast(`Tool: ${toolName}`);
        return true;
      },

      showToast(message, isError = false) {
        const isErr = isError === true || isError === 'error' || isError === 'warn';
        const type = isErr ? 'error' : 'info';
        const host = getHostWindow();
        if (typeof window !== 'undefined' && typeof window.showEditorToast === 'function') {
          window.showEditorToast(message, 2400, type);
        } else if (typeof window !== 'undefined' && typeof window.showDashboardToast === 'function') {
          window.showDashboardToast(message, 2400, type);
        } else if (host && typeof host.showEditorToast === 'function') {
          host.showEditorToast(message, 2400, type);
        } else if (host && typeof host.showDashboardToast === 'function') {
          host.showDashboardToast(message, 2400, type);
        } else if (typeof window !== 'undefined' && typeof window.showEffectsRackToast === 'function') {
          window.showEffectsRackToast(message, isErr ? 'warn' : 'info');
        }
      },

      toast(message, isError = false) {
        return this.showToast(message, isError);
      },

      notify(message, isError = false) {
        return this.showToast(message, isError);
      },

      getProjectState() {
        const host = getHostWindow();
        return (host && host.currentProjectState) || (typeof window !== 'undefined' && window.currentProjectState) || null;
      },

      getSelectedLayer() {
        return this.layers.getActive();
      },

      seek(sec) {
        const host = getHostWindow();
        if (host && typeof host.seekTimelineToTime === 'function') {
          host.seekTimelineToTime(sec);
        }
      },

      recordSnapshot() {
        const host = getHostWindow();
        const mgr = host && host.UndoRedoManager;
        if (mgr && typeof mgr.recordSnapshot === 'function' && !mgr.isApplying) {
          mgr.recordSnapshot();
        }
      },

      redraw(reason) {
        const host = getHostWindow();
        if (host && typeof host.redrawComposition === 'function') {
          host.redrawComposition(reason || `ext:${def.id}`);
        }
      },

      // =====================================================================
      // MODULAR JS EXTENSION SDK NAMESPACES
      // (project, history, layers, timeline, effects, audio, scene3d, storage)
      // =====================================================================
      project: {
        getState() {
          return ctx.getProjectState();
        },

        getDimensions() {
          const host = getHostWindow();
          const state = ctx.getProjectState() || {};
          let width = state._baseW || state.baseW || state.width || 0;
          let height = state._baseH || state.baseH || state.height || 0;

          if (host && host.currentActivePrecomp) {
            width = Math.round(Math.abs(host.currentActivePrecomp.mediaWidth || host.currentActivePrecomp.scaleW || width || 0));
            height = Math.round(Math.abs(host.currentActivePrecomp.mediaHeight || host.currentActivePrecomp.scaleH || height || 0));
          }

          if (!width || !height) {
            const res = state.resolution || '1080p';
            const aspect = state.aspectRatio || '16:9';
            const dims = (host && typeof host.getProjectDimensions === 'function')
              ? host.getProjectDimensions(res, aspect)
              : [1920, 1080];
            width = (dims && (dims.width || dims[0])) || 1920;
            height = (dims && (dims.height || dims[1])) || 1080;
          }

          const fps = (host && typeof host.getProjectFps === 'function')
            ? host.getProjectFps()
            : (parseInt(state.fps, 10) || 60);
          const pps = (host && ((typeof host.pixelsPerSecond === 'number' && host.pixelsPerSecond > 0) ? host.pixelsPerSecond : host.currentPixelsPerSecond)) || 80;
          const currentTime = ctx.timeline.getCurrentTime();

          const result = {
            0: width,
            1: height,
            length: 2,
            width,
            height,
            fps,
            pps,
            currentTime,
            [Symbol.iterator]: function* () {
              yield width;
              yield height;
            }
          };
          return result;
        },

        commit(reason = 'extension', invalidateTargets = null) {
          const host = getHostWindow();
          if (!host) return;
          if (invalidateTargets) {
            const list = Array.isArray(invalidateTargets) ? invalidateTargets : [invalidateTargets];
            list.forEach(item => {
              if (item && typeof host.invalidatePreviewCacheForLayer === 'function') {
                host.invalidatePreviewCacheForLayer(item);
              }
            });
          }
          if (typeof host.invalidateEffectivePropsCache === 'function') host.invalidateEffectivePropsCache();
          if (typeof host.syncTransformControllerValues === 'function') host.syncTransformControllerValues();
          if (typeof host.syncInspectorState === 'function') host.syncInspectorState();
          if (typeof host.syncEffectsRackUI === 'function') host.syncEffectsRackUI();
          if (typeof host.saveCurrentProjectLayers === 'function') host.saveCurrentProjectLayers(true);
          if (typeof host.renderTimelineLayers === 'function') host.renderTimelineLayers();
          if (typeof host.redrawComposition === 'function') host.redrawComposition(reason);
          if (host.CanvasOverlay && typeof host.CanvasOverlay.redraw === 'function') host.CanvasOverlay.redraw();
        }
      },

      history: {
        snapshot() {
          ctx.recordSnapshot();
        },
        push() {
          ctx.recordSnapshot();
        }
      },

      layers: {
        getAll() {
          const state = ctx.getProjectState();
          return (state && Array.isArray(state.layers)) ? state.layers : [];
        },

        getSelected() {
          const host = getHostWindow();
          if (host && typeof host.getSelectedLayersForOperation === 'function') {
            const res = host.getSelectedLayersForOperation();
            if (Array.isArray(res) && res.length > 0) return res;
          }
          const all = this.getAll();
          if (!all.length || !host) return [];
          const ids = new Set();
          if (host.selectedLayerIds && host.selectedLayerIds.size > 0) {
            host.selectedLayerIds.forEach(id => ids.add(String(id)));
          }
          if (host.selectedLayerId) {
            ids.add(String(host.selectedLayerId));
          }
          return all.filter(l => l && ids.has(String(l.id)));
        },

        getActive() {
          const selected = this.getSelected();
          if (selected.length > 0) return selected[0];
          const host = getHostWindow();
          const all = this.getAll();
          if (!all.length || !host) return null;
          const selId = host.selectedLayerId;
          if (selId) {
            return all.find(l => l && String(l.id) === String(selId)) || null;
          }
          return null;
        },

        select(layerOrId, addToSelection = false) {
          const host = getHostWindow();
          if (!host || !layerOrId) return;
          const id = typeof layerOrId === 'object' ? layerOrId.id : layerOrId;
          if (typeof host.selectTimelineLayer === 'function') {
            host.selectTimelineLayer(id, addToSelection);
          } else {
            host.selectedLayerId = id;
            if (host.selectedLayerIds) {
              if (!addToSelection) host.selectedLayerIds.clear();
              host.selectedLayerIds.add(id);
            }
          }
        },

        getTiming(layer = null) {
          const target = layer || this.getActive();
          const { pps, fps, currentTime } = ctx.project.getDimensions();
          const state = ctx.getProjectState() || {};
          const defaultDur = state.defaultDuration || 5;
          let startSec = currentTime;
          let durationSec = defaultDur;
          if (target) {
            startSec = target.startSec !== undefined ? target.startSec : ((target.startPx || 0) / pps);
            durationSec = target.durationSec !== undefined ? target.durationSec : ((target.widthPx || 320) / pps);
          }
          startSec = Number(startSec.toFixed(4));
          durationSec = Number(Math.max(0.1, durationSec).toFixed(4));
          const endSec = Number((startSec + durationSec).toFixed(4));
          return { startSec, durationSec, endSec, pps, fps };
        },

        createSlider(name, val, min = -10000, max = 10000, step = 1, unit = '') {
          return {
            id: 'fx_' + String(name).toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type: 'slider-control',
            name,
            slider: val,
            value: val,
            min,
            max,
            step,
            unit,
            isExpanded: true
          };
        },

        isAudio(layer) {
          if (!layer) return false;
          return layer.type === 'audio' || layer.mediaType === 'audio' || layer.isAudioTrack === true;
        },

        update(layerOrId, patch = {}) {
          const host = getHostWindow();
          const target = (typeof layerOrId === 'object' && layerOrId)
            ? layerOrId
            : this.getAll().find(l => l && String(l.id) === String(layerOrId));
          if (!target) return false;
          Object.assign(target, patch);
          delete target._effectivePropsCache;
          if (host && typeof host.invalidateEffectivePropsCache === 'function') {
            host.invalidateEffectivePropsCache();
          }
          ctx.invalidateCache(target);
          if (host && typeof host.saveCurrentProjectLayers === 'function') {
            host.saveCurrentProjectLayers(true);
          }
          return true;
        },

        create(type, opts = {}) {
          const map = {
            shape: 'SHA',
            solid: 'SOL',
            null: 'NUL',
            camera: 'CAM',
            adjustment: 'ADJ'
          };
          const tool = map[String(type || '').toLowerCase()] || type;
          return ctx.runTool(tool, opts);
        }
      },

      timeline: {
        getCurrentTime() {
          const host = getHostWindow();
          if (!host) return 0;
          if (typeof host.getCurrentPlayheadTime === 'function') return host.getCurrentPlayheadTime();
          if (typeof host.getTimelineCurrentSec === 'function') return host.getTimelineCurrentSec();
          const pps = host.currentPixelsPerSecond || 80;
          return Math.max(0, -(host.timelinePanX || 0) / pps);
        },

        getPlayhead() {
          return this.getCurrentTime();
        },

        seek(sec) {
          ctx.seek(sec);
        },

        getFPS() {
          const host = getHostWindow();
          if (host && typeof host.getProjectFps === 'function') return host.getProjectFps();
          const state = ctx.getProjectState();
          return (state && Number(state.fps)) || 60;
        },

        getFps() {
          return this.getFPS();
        },

        getPps() {
          const host = getHostWindow();
          if (!host) return 80;
          return (typeof host.pixelsPerSecond === 'number' && host.pixelsPerSecond > 0)
            ? host.pixelsPerSecond
            : (host.currentPixelsPerSecond || 80);
        },

        getPPS() {
          return this.getPps();
        },

        setFPS(fps) {
          return ctx.runTool('setCompositionFPS', fps);
        },

        setFormat(width, height) {
          return ctx.runTool('setCompositionFormat', width, height);
        },

        getMarkers() {
          const state = ctx.getProjectState();
          return (state && Array.isArray(state.beatmarks)) ? state.beatmarks.slice() : [];
        },

        getBeatmarks(layer = null) {
          const host = getHostWindow();
          const state = ctx.getProjectState();
          let rawMarkers = [];
          if (layer && Array.isArray(layer.markers) && layer.markers.length > 0) {
            rawMarkers = rawMarkers.concat(layer.markers.map(m => (typeof m === 'number' ? m : (m.time || 0))));
          }
          if (state && Array.isArray(state.beatmarks) && state.beatmarks.length > 0) {
            rawMarkers = rawMarkers.concat(state.beatmarks);
          }
          if (host && Array.isArray(host.beatmarks) && host.beatmarks.length > 0) {
            rawMarkers = rawMarkers.concat(host.beatmarks);
          }
          return Array.from(new Set(rawMarkers.map(m => Number(Number(m).toFixed(4))))).sort((a, b) => a - b);
        },

        setMarkers(markers = []) {
          const host = getHostWindow();
          const state = ctx.getProjectState();
          if (!state) return false;
          const clean = Array.isArray(markers)
            ? markers.map(Number).filter(n => !isNaN(n) && n >= 0).sort((a, b) => a - b)
            : [];
          state.beatmarks = clean;
          if (host && host.currentProjectState) {
            host.currentProjectState.beatmarks = clean;
          }
          if (host) {
            if (typeof host.renderTimelineBeatmarks === 'function') host.renderTimelineBeatmarks();
            if (typeof host.saveCurrentProjectBeatmarks === 'function') host.saveCurrentProjectBeatmarks(true);
            if (typeof host.updateTimeBadgeBeatmarkState === 'function') host.updateTimeBadgeBeatmarkState();
            if (typeof host.syncDesktopMarkerLabels === 'function') host.syncDesktopMarkerLabels();
            if (typeof host.syncBeatmarkDrawerUI === 'function') host.syncBeatmarkDrawerUI();
          }
          ctx.recordSnapshot();
          return true;
        },

        clearMarkers() {
          const current = this.getMarkers();
          if (current.length === 0) return false;
          this.setMarkers([]);
          return true;
        }
      },

      effects: {
        add(effectId) {
          const host = getHostWindow();
          if (host && typeof host.addEffectToLayer === 'function') {
            host.addEffectToLayer(effectId);
            return true;
          }
          return ctx.runTool(effectId);
        },
        createInstance(type, fallbackName) {
          const host = getHostWindow();
          const reg = (host && host.FishEffects && host.FishEffects.registry) || (host && host.FishEffectsRegistry);
          if (reg && typeof reg.createInstance === 'function') {
            return reg.createInstance(type, fallbackName);
          }
          return {
            id: `fx_${String(type).replace(/[^a-z0-9]/gi, '_')}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            name: fallbackName || type,
            isExpanded: true,
            disabled: false
          };
        }
      },

      audio: {
        isAudioLayer(layer) {
          return ctx.layers.isAudio(layer);
        },

        async detectBPM(layer, sensitivity = 65) {
          const host = getHostWindow();
          const target = layer || ctx.layers.getActive();
          if (!target || !host) return 120;
          let detected = 120;
          let audioBuffer = null;
          if (typeof host.getAudioBufferForLayer === 'function') {
            audioBuffer = await host.getAudioBufferForLayer(target);
          }
          if (audioBuffer && typeof host.detectBassFromAudioBuffer === 'function' && typeof host.estimateBPMFromAudio === 'function') {
            const beats = host.detectBassFromAudioBuffer(audioBuffer, sensitivity, target.durationSec || 30);
            detected = host.estimateBPMFromAudio(beats);
          } else if (typeof host.getAudioPeaksForLayer === 'function' && typeof host.detectBassFromWaveformPeaks === 'function' && typeof host.estimateBPMFromAudio === 'function') {
            const peaks = await host.getAudioPeaksForLayer(target, 800);
            const beats = host.detectBassFromWaveformPeaks(peaks, target.durationSec || 30, sensitivity);
            detected = host.estimateBPMFromAudio(beats);
          }
          return Math.round(detected);
        },

        generateBeatmarks(opts = {}) {
          return ctx.runTool('AUTO_MARK', opts);
        }
      },

      scene3d: {
        rgbaToHex(rgba, mult = 1.0) {
          if (!rgba) return '#888888';
          if (typeof rgba === 'string') return rgba;
          const r = Math.min(255, Math.max(0, Math.round(rgba[0] * 255 * mult)));
          const g = Math.min(255, Math.max(0, Math.round(rgba[1] * 255 * mult)));
          const b = Math.min(255, Math.max(0, Math.round(rgba[2] * 255 * mult)));
          const toHex = n => n.toString(16).padStart(2, '0');
          return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        },

        generateId(prefix = 'layer') {
          return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        },

        getBaseDims() {
          const { width, height } = ctx.project.getDimensions();
          return [width, height];
        },

        getTiming(selLayer) {
          return ctx.layers.getTiming(selLayer);
        },

        create3DNull({ name, pos = [0, 0, 0], ori = [0, 0, 0], parent = null, startSec = 0, durationSec = 5, pps = 80 }) {
          const id = this.generateId('layer_null');
          const parentPosX = parent ? parent.posX : 0;
          const parentPosY = parent ? parent.posY : 0;
          const parentPosZ = parent ? (parent.posZ || 0) : 0;

          const posX = parentPosX + pos[0];
          const posY = parentPosY + pos[1];
          const posZ = parentPosZ + pos[2];

          return {
            id,
            name,
            type: 'null',
            is3D: true,
            startPx: Math.round(startSec * pps),
            startSec,
            durationSec,
            widthPx: Math.round(durationSec * pps),
            posX,
            posY,
            posZ,
            rotX: ori[0] || 0,
            rotY: ori[1] || 0,
            rotZ: ori[2] || 0,
            rotation: ori[2] || 0,
            scaleW: 100,
            scaleH: 100,
            opacity: 1.0,
            parentId: parent ? parent.id : null,
            parentBind: parent ? {
              parentPosX: parent.posX,
              parentPosY: parent.posY,
              parentPosZ: parent.posZ || 0,
              parentRotX: parent.rotX || 0,
              parentRotY: parent.rotY || 0,
              parentRotZ: parent.rotZ || 0,
              parentScaleW: parent.scaleW || 100,
              parentScaleH: parent.scaleH || 100
            } : null
          };
        },

        create3DFace({
          name,
          w,
          h,
          pos = [0, 0, 0],
          ori = [0, 0, 0],
          parent = null,
          color = '#888888',
          opacity = 1.0,
          roundness = 0,
          textureLayer = null,
          startSec = 0,
          durationSec = 5,
          pps = 80
        }) {
          const id = this.generateId('layer_face');
          const parentPosX = parent ? parent.posX : 0;
          const parentPosY = parent ? parent.posY : 0;
          const parentPosZ = parent ? (parent.posZ || 0) : 0;

          const posX = parentPosX + pos[0];
          const posY = parentPosY + pos[1];
          const posZ = parentPosZ + pos[2];

          const isTextured = !!(textureLayer && (textureLayer.dataUrl || textureLayer.mediaId || textureLayer.type === 'image' || textureLayer.type === 'video'));

          const faceLayer = {
            id,
            name,
            type: isTextured ? (textureLayer.type === 'video' ? 'video' : 'image') : 'shape',
            is3D: true,
            startPx: Math.round(startSec * pps),
            startSec,
            durationSec,
            widthPx: Math.round(durationSec * pps),
            posX,
            posY,
            posZ,
            rotX: ori[0] || 0,
            rotY: ori[1] || 0,
            rotZ: ori[2] || 0,
            rotation: ori[2] || 0,
            scaleW: Math.max(1, Math.round(w)),
            scaleH: Math.max(1, Math.round(h)),
            _userResized: true,
            _userResizedManual: true,
            opacity,
            blendMode: 'normal',
            parentId: parent ? parent.id : null,
            parentBind: parent ? {
              parentPosX: parent.posX,
              parentPosY: parent.posY,
              parentPosZ: parent.posZ || 0,
              parentRotX: parent.rotX || 0,
              parentRotY: parent.rotY || 0,
              parentRotZ: parent.rotZ || 0,
              parentScaleW: parent.scaleW || 100,
              parentScaleH: parent.scaleH || 100
            } : null
          };

          if (isTextured) {
            faceLayer.dataUrl = textureLayer.dataUrl || null;
            faceLayer.mediaId = textureLayer.mediaId || null;
            faceLayer.mediaWidth = textureLayer.mediaWidth || Math.max(1, Math.round(w));
            faceLayer.mediaHeight = textureLayer.mediaHeight || Math.max(1, Math.round(h));
            if (textureLayer.naturalWidth) faceLayer.naturalWidth = textureLayer.naturalWidth;
            if (textureLayer.naturalHeight) faceLayer.naturalHeight = textureLayer.naturalHeight;
            if (textureLayer.speed !== undefined) faceLayer.speed = textureLayer.speed;
            if (textureLayer.sourceOffsetSec !== undefined) faceLayer.sourceOffsetSec = textureLayer.sourceOffsetSec;
          } else {
            faceLayer.shapeType = 'rectangle';
            faceLayer.shapeProps = {
              sizeX: Math.max(1, Math.round(w)),
              sizeY: Math.max(1, Math.round(h)),
              roundness: roundness || 0
            };
            faceLayer.fillType = 'color';
            faceLayer.fillColor = color;
            faceLayer.strokeColor = color;
            faceLayer.strokeWidth = 0;
          }

          return faceLayer;
        },

        wrapIn3DPrecomp({
          name,
          compW,
          compH,
          startSec,
          durationSec,
          childLayers,
          replaceLayer = null,
          pps = 80
        }) {
          const host = getHostWindow();
          const [baseW, baseH] = this.getBaseDims();
          const state = ctx.getProjectState() || {};
          state.layers = state.layers || [];

          const precompId = this.generateId('layer_precomp');
          const mediaId = this.generateId('media_comp');

          const pX = replaceLayer && replaceLayer.posX !== undefined ? replaceLayer.posX : Math.round(baseW / 2);
          const pY = replaceLayer && replaceLayer.posY !== undefined ? replaceLayer.posY : Math.round(baseH / 2);
          const pZ = replaceLayer && replaceLayer.posZ !== undefined ? replaceLayer.posZ : 0;

          if (Array.isArray(childLayers)) {
            childLayers.forEach(l => {
              if (l) {
                const lStart = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
                const relStart = Math.max(0, lStart - (startSec || 0));
                l.startSec = Number(relStart.toFixed(4));
                l.startPx = Math.round(l.startSec * pps);
                l.durationSec = Number((l.durationSec !== undefined ? l.durationSec : durationSec).toFixed(4));
                l.widthPx = Math.round(l.durationSec * pps);
              }
            });
          }

          const precompLayer = {
            id: precompId,
            mediaId,
            name,
            type: 'precomp',
            startSec,
            durationSec,
            startPx: Math.round(startSec * pps),
            widthPx: Math.round(durationSec * pps),
            posX: pX,
            posY: pY,
            posZ: pZ,
            rotX: 0,
            rotY: 0,
            rotZ: 0,
            rotation: 0,
            scaleW: compW,
            scaleH: compH,
            mediaWidth: compW,
            mediaHeight: compH,
            _userResized: true,
            normX: Number(((pX - compW / 2) / baseW).toFixed(4)),
            normY: Number(((pY - compH / 2) / baseH).toFixed(4)),
            normW: Number((compW / baseW).toFixed(4)),
            normH: Number((compH / baseH).toFixed(4)),
            opacity: 1,
            blendMode: 'normal',
            is3D: true,
            collapseTransformations: true,
            layers: childLayers
          };

          const precompMediaItem = {
            id: mediaId,
            projectId: state.id,
            name,
            type: 'precomp',
            precompId,
            duration: durationSec,
            width: compW,
            height: compH,
            is3D: true,
            collapseTransformations: true,
            layers: JSON.parse(JSON.stringify(childLayers))
          };

          if (host && host.FishDatabase && typeof host.FishDatabase.saveMedia === 'function' && state.id) {
            host.FishDatabase.saveMedia(precompMediaItem).catch(err => {
              console.warn('[scene3d] saveMedia error:', err);
            });
          }

          if (replaceLayer) {
            const idx = state.layers.findIndex(l => l.id === replaceLayer.id);
            if (idx !== -1) {
              state.layers.splice(idx, 1, precompLayer);
            } else {
              state.layers.unshift(precompLayer);
            }
          } else {
            state.layers.unshift(precompLayer);
          }

          if (host) {
            if (host.PreviewCacheManager && typeof host.PreviewCacheManager.deletePool === 'function') {
              host.PreviewCacheManager.deletePool(precompId);
            }
            if (typeof host.invalidatePreviewCacheForLayer === 'function') {
              if (replaceLayer) host.invalidatePreviewCacheForLayer(replaceLayer);
              host.invalidatePreviewCacheForLayer(precompLayer);
            }
            if (host.selectedLayerIds) host.selectedLayerIds.clear();
            host.selectedLayerId = precompId;
            if (host.selectedLayerIds) host.selectedLayerIds.add(precompId);

            if (typeof host.renderTimelineLayers === 'function') host.renderTimelineLayers();
            if (typeof host.updateEditorHeaderMode === 'function') host.updateEditorHeaderMode();
            if (typeof host.redrawComposition === 'function') host.redrawComposition('3d-gen');
            if (typeof host.saveCurrentProjectLayers === 'function') host.saveCurrentProjectLayers(true);
            if (typeof host.showEffectsRackToast === 'function') {
              host.showEffectsRackToast(`${name} created`);
            }
          }

          return JSON.stringify({
            error: false,
            message: `${name} generated successfully!`,
            layerId: precompId,
            is3D: true,
            collapseTransformations: true
          });
        }
      },

      storage: {
        get(key, defaultVal = null) {
          const store = readStorage(cardStorageKey, {});
          return store[key] !== undefined ? store[key] : defaultVal;
        },
        set(key, val) {
          const store = readStorage(cardStorageKey, {});
          store[key] = val;
          writeStorage(cardStorageKey, store);
        },
        remove(key) {
          const store = readStorage(cardStorageKey, {});
          delete store[key];
          writeStorage(cardStorageKey, store);
        }
      }
    };

    return ctx;
  }

  /**
   * Main Declarative Card Definition Function: window.Card({ ... })
   */
  function defineCard(def) {
    if (!def || !def.id) {
      console.error('[CardBuilder] Invalid Card definition: "id" is required.', def);
      return null;
    }

    _cardRegistry.set(def.id, def);

    // Automatically register any declarative tools map defined on the Card
    if (def.tools && typeof def.tools === 'object') {
      Object.entries(def.tools).forEach(([toolName, fn]) => {
        if (typeof fn === 'function') {
          _toolRegistry.set(String(toolName), { cardId: def.id, fn });
        }
      });
    }

    // Bridge with FishExtensions if available
    if (global.FishExtensions && typeof global.FishExtensions.register === 'function') {
      const isEnabled = CardState.isEnabled(def.id, def.defaultEnabled !== false);
      if (isEnabled) {
        registerIntoFishExtensions(def);
      }
    }

    return def;
  }

  /**
   * Internal helper to mount card definition into FishExtensions runtime
   */
  function registerIntoFishExtensions(def) {
    if (!global.FishExtensions) return;

    global.FishExtensions.register({
      id: def.id,
      name: def.name || def.id,
      icon: def.icon,
      description: def.description,
      render(cardBody) {
        cardBody.innerHTML = '';
        const ctx = createCardContext(def);
        const ui = createUIBuilder(cardBody, ctx);
        if (typeof def.build === 'function') {
          def.build(ui, ctx);
        }
        if (typeof def.setup === 'function') {
          def.setup(ctx, cardBody);
        }
      }
    });
  }

  /**
   * Strict Validator for user-imported .js extension files
   * Ensures modular Card({ ... }) definition with interactive UI and actions.
   */
  function validateExtensionJS(jsContent) {
    if (!jsContent || typeof jsContent !== 'string' || !jsContent.trim()) {
      return { valid: false, error: 'File kosong atau tidak dapat dibaca.' };
    }

    const hasCardCall = /Card\s*\(\s*\{/.test(jsContent) || /FishExtensions\.defineCard/.test(jsContent);
    if (!hasCardCall) {
      return {
        valid: false,
        error: 'Format tidak valid: File ekstensi .js harus mendeklarasikan Card({ id, name, build(ui, ctx) { ... } }).'
      };
    }

    const hasInteractiveUI = /ui\.(button|segmented|anchorGrid|checklist|slider|switch|input|textarea)|createElement\(['"]button['"]\)/.test(jsContent);
    const hasFunction = /function|onClick|onSelect|onChange|=>|\.addEventListener/.test(jsContent);

    if (!hasInteractiveUI) {
      return {
        valid: false,
        error: 'Format tidak lengkap: Card harus memiliki minimal satu komponen UI interaktif (misalnya ui.button, ui.slider, ui.segmented).'
      };
    }

    if (!hasFunction) {
      return {
        valid: false,
        error: 'Format tidak lengkap: Komponen Card harus memiliki fungsi aksi (onClick / onChange) yang dapat dieksekusi.'
      };
    }

    try {
      let extractedDef = null;
      const sandboxFn = new Function('Card', 'window', 'globalThis', jsContent);
      const mockCard = function(def) {
        extractedDef = def;
        return def;
      };

      sandboxFn(mockCard, {}, {});

      if (!extractedDef || !extractedDef.id) {
        return {
          valid: false,
          error: 'Eksekusi Card gagal: Properti "id" dan "name" wajib didefinisikan.'
        };
      }

      if (typeof extractedDef.build !== 'function') {
        return {
          valid: false,
          error: 'Format tidak valid: Properti "build(ui, ctx)" harus berupa fungsi untuk merender komponen.'
        };
      }

      return { valid: true, def: extractedDef };
    } catch (err) {
      return {
        valid: false,
        error: `Kesalahan sintaks JavaScript pada file .js: ${err.message}`
      };
    }
  }

  /**
   * Load and evaluate a modular .js extension string dynamically into runtime
   */
  function loadExtensionJS(jsContent, isCustom = false, filename = '') {
    const val = validateExtensionJS(jsContent, filename);
    if (!val.valid) return val;

    try {
      const fn = new Function('Card', 'window', 'globalThis', jsContent);
      fn(defineCard, global, global);

      if (val.def && val.def.id) {
        _cardSourceMap.set(val.def.id, jsContent);
        if (isCustom) {
          saveCustomCardSource(val.def.id, jsContent);
        }
      }

      return { valid: true, def: val.def };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * Custom Cards Persistence Manager
   */
  function getAllCustomCards() {
    return readStorage(STORAGE_CUSTOM_KEY, []);
  }

  function saveCustomCardSource(id, jsContent) {
    const list = getAllCustomCards().filter(item => item.id !== id);
    list.push({ id, code: jsContent, timestamp: Date.now() });
    writeStorage(STORAGE_CUSTOM_KEY, list);
  }

  function deleteCustomCard(id) {
    const list = getAllCustomCards().filter(item => item.id !== id);
    writeStorage(STORAGE_CUSTOM_KEY, list);
    _cardRegistry.delete(id);
    _cardSourceMap.delete(id);
    if (global.FishExtensions && typeof global.FishExtensions.unregister === 'function') {
      global.FishExtensions.unregister(id);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('extension-custom-deleted', { detail: { id } }));
    }
  }

  /**
   * Restore all custom saved cards on startup
   */
  function initCustomCards() {
    const customList = getAllCustomCards();
    customList.forEach(item => {
      if (item && item.code) {
        loadExtensionJS(item.code, false, item.id);
      }
    });
  }

  /**
   * Public CardBuilder Namespace
   */
  const CardBuilder = {
    Card: defineCard,
    defineCard,
    validateExtensionJS,
    loadExtensionJS,
    // Backward-compatible aliases
    validateJSX: validateExtensionJS,
    loadJSXString: loadExtensionJS,
    State: CardState,
    getRegistry: () => Array.from(_cardRegistry.values()),
    getCard: (id) => _cardRegistry.get(id) || null,
    getCardSource: (id) => _cardSourceMap.get(id) || null,
    hasTool: (toolName) => _toolRegistry.has(String(toolName)),
    runTool(toolName, ...args) {
      const entry = _toolRegistry.get(String(toolName));
      if (!entry || typeof entry.fn !== 'function') return undefined;
      const def = _cardRegistry.get(entry.cardId) || { id: entry.cardId || 'global', name: entry.cardId || 'Global' };
      const ctx = createCardContext(def);
      return entry.fn.call(def, ctx, ...args);
    },
    createContext: (id = 'global') => createCardContext(_cardRegistry.get(id) || { id, name: id }),
    getAllCustomCards,
    deleteCustomCard,
    initCustomCards,
    /**
     * Render a card definition into an arbitrary host element.
     * Optional ctxOverride allows sandboxed contexts (used by Extension Builder preview).
     */
    mount(def, host, ctxOverride = null) {
      host.innerHTML = '';
      const ctx = ctxOverride || createCardContext(def);
      const ui = createUIBuilder(host, ctx);
      if (typeof def.build === 'function') def.build(ui, ctx);
      if (typeof def.setup === 'function') def.setup(ctx, host);
      return ctx;
    },
    syncToFishExtensions() {
      if (!global.FishExtensions) return;
      _cardRegistry.forEach(def => {
        const enabled = CardState.isEnabled(def.id, def.defaultEnabled !== false);
        if (enabled) {
          registerIntoFishExtensions(def);
        } else {
          global.FishExtensions.unregister(def.id);
        }
      });
    }
  };

  // Listen to state changes to update FishExtensions live
  if (typeof window !== 'undefined') {
    window.addEventListener('extension-state-changed', (e) => {
      const { id, enabled } = e.detail;
      const def = _cardRegistry.get(id);
      if (!def || !global.FishExtensions) return;

      if (enabled) {
        registerIntoFishExtensions(def);
      } else {
        global.FishExtensions.unregister(id);
      }
    });
  }

  // Export globally
  global.Card = defineCard;
  global.CardBuilder = CardBuilder;

  // Auto-init custom extensions when DOM is ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initCustomCards);
    } else {
      initCustomCards();
    }
  }

})(typeof window !== 'undefined' ? window : globalThis);
