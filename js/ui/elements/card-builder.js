/**
 * OpenFishTools Studio - Universal Card Builder & Extension DSL Engine
 * 
 * Provides:
 * 1. Declarative Card({ ... }) DSL for .jsx extension cards.
 * 2. Universal UI builder (ui.button, ui.text, ui.section, ui.divider, ui.grid, ui.input, ui.textarea, ui.switch, ui.slider).
 * 3. Validation parser for imported .jsx files (ensures UI buttons and executable functions exist).
 * 4. Extension state persistence (On/Off switches synced to localStorage).
 * 5. Custom .jsx extensions manager.
 */
(function(global) {
  'use strict';

  const STORAGE_STATES_KEY = 'oft_extension_states';
  const STORAGE_CUSTOM_KEY = 'oft_custom_extensions';

  // In-memory registry of all loaded cards
  const _cardRegistry = new Map();
  const _cardSourceMap = new Map(); // id -> raw JSX string

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
       * Text element (Title, Label, Display, Hint, Description)
       */
      text(opts = {}) {
        const textStr = typeof opts === 'string' ? opts : (opts.text || '');
        const variant = typeof opts === 'object' ? (opts.variant || 'label') : 'label';
        const el = document.createElement(variant === 'display' ? 'div' : 'span');
        el.className = `extension-text extension-text--${variant} ${opts.className || ''}`.trim();
        if (opts.id) el.id = opts.id;
        el.textContent = textStr;
        container.appendChild(el);
        return el;
      },

      /**
       * Text Input Field
       */
      input(opts = {}) {
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

        container.appendChild(input);
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
        container.appendChild(grp);
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
       * Custom Slider / Ruler Scrubber using Studio/element/slider.js if available
       */
      slider(opts = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'extension-slider-row';

        if (opts.label) {
          const lbl = document.createElement('span');
          lbl.className = 'status-label';
          lbl.textContent = opts.label;
          wrap.appendChild(lbl);
        }

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'extension-range-input';
        if (opts.id) input.id = opts.id;
        input.min = opts.min !== undefined ? opts.min : 0;
        input.max = opts.max !== undefined ? opts.max : 100;
        input.step = opts.step !== undefined ? opts.step : 1;
        input.value = opts.value !== undefined ? opts.value : 50;

        const valTag = document.createElement('span');
        valTag.className = 'extension-slider-val';
        valTag.textContent = `${input.value}${opts.unit || ''}`;

        input.addEventListener('input', (e) => {
          valTag.textContent = `${e.target.value}${opts.unit || ''}`;
          if (typeof opts.onChange === 'function') {
            opts.onChange(parseFloat(e.target.value), e, ctx);
          }
        });

        wrap.appendChild(input);
        wrap.appendChild(valTag);
        container.appendChild(wrap);
        return wrap;
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
   * Runtime Context provided to card actions and build
   */
  function createCardContext(def) {
    const cardStorageKey = `oft_card_store_${def.id}`;
    const getHostWindow = () => {
      if (typeof window !== 'undefined') {
        if (window.PreviewCacheManager) return window;
        if (window.parent && window.parent.PreviewCacheManager) return window.parent;
      }
      return typeof window !== 'undefined' ? window : null;
    };

    return {
      id: def.id,
      name: def.name || def.id,

      get app() {
        return (typeof window !== 'undefined' && window.app) || (typeof window !== 'undefined' && window.parent && window.parent.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
      },

      get translator() {
        return (typeof window !== 'undefined' && window.JSXTranslator) || (typeof window !== 'undefined' && window.parent && window.parent.JSXTranslator) || null;
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

      executeJSX(codeOrFn) {
        const host = getHostWindow();
        const pcm = host && host.PreviewCacheManager;
        const beforeSnap = (pcm && typeof pcm.captureStateSnapshot === 'function') ? pcm.captureStateSnapshot() : null;
        let res = null;
        if (typeof window !== 'undefined' && typeof window.executeJSX === 'function') {
          res = window.executeJSX(codeOrFn);
        } else if (typeof window !== 'undefined' && window.parent && typeof window.parent.executeJSX === 'function') {
          res = window.parent.executeJSX(codeOrFn);
        } else if (typeof window !== 'undefined' && window.JSXTranslator) {
          res = window.JSXTranslator.executeJSX(codeOrFn);
        }
        if (pcm && beforeSnap && typeof pcm.invalidateSmartDiff === 'function') {
          if (pcm.invalidateSmartDiff(beforeSnap) && host && typeof host.redrawComposition === 'function') {
            host.redrawComposition('executeJSX');
          }
        }
        return res;
      },

      runTool(toolName, ...args) {
        const host = getHostWindow();
        const pcm = host && host.PreviewCacheManager;
        const beforeSnap = (pcm && typeof pcm.captureStateSnapshot === 'function') ? pcm.captureStateSnapshot() : null;
        // 1. Direct parent/editor tool bridge
        try {
          if (typeof window.executeFishTool === 'function') {
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
          if (window.parent && typeof window.parent.executeFishTool === 'function') {
            const res = window.parent.executeFishTool(toolName, ...args);
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
        } catch (err) {
          console.error(`[Card:${def.id}] executeFishTool error:`, err);
          this.showToast(`Error: ${err.message}`, true);
          return false;
        }

        // Layer-dependent tools guard when running outside active editor session
        const layerRequiredTools = new Set([
          'setAnchorPoint', 'ALIGN_LEFT', 'ALIGN_HCENTER', 'ALIGN_RIGHT', 'ALIGN_TOP', 'ALIGN_VCENTER', 'ALIGN_BOTTOM',
          'CUT_FRONT', 'CUT_MID', 'CUT_BACK', 'CUT_LEFT', 'CUT_RIGHT',
          'PRECOMP', 'CENTER', 'CENTERINCOMP', 'OVERLAP', 'DUP_COMP', 'DUP',
          'FRZ', 'FIT', 'DSH', 'MIR', 'FILL', 'TINT', 'BLUR', 'LUM', 'CURV', 'HUE',
          'GHST', 'WARP', 'FISHEYE', 'MIDWAVE', 'HUESPIN', 'EXPO', 'SHAKY', 'LENS', 'OSCILLATE',
          'Y_BEAT', 'Y_FLIP', 'X_BEAT', 'X_FLIP', 'SCALE_BEAT', 'SWING',
          'PANNING_POS', 'PANNING_ROT', 'PANNING_SCALE', 'PANNING_MIX_PR', 'PANNING_MIX_ALL',
          'IDLE_MOVE_1', 'IDLE_MOVE_2',
          'PRESET_WARP1', 'PRESET_WARP2', 'PRESET_WARP3', 'TWIX', 'TMRE'
        ]);

        if (layerRequiredTools.has(toolName)) {
          this.showToast('Pilih layer terlebih dahulu untuk menggunakan fitur ini', true);
          return false;
        }

        // 2. Dispatch custom tool event for editor timeline & effects
        window.dispatchEvent(new CustomEvent('fishtools:tool', {
          detail: { tool: toolName, args }
        }));

        this.showToast(`Tool: ${toolName}`);
        return true;
      },

      showToast(message, isError = false) {
        const type = isError ? 'error' : 'info';
        if (typeof window.showEditorToast === 'function') {
          window.showEditorToast(message, 2400, type);
        } else if (typeof window.showDashboardToast === 'function') {
          window.showDashboardToast(message, 2400, type);
        } else if (window.parent && typeof window.parent.showEditorToast === 'function') {
          window.parent.showEditorToast(message, 2400, type);
        } else if (window.parent && typeof window.parent.showDashboardToast === 'function') {
          window.parent.showDashboardToast(message, 2400, type);
        } else if (typeof window.showEffectsRackToast === 'function') {
          window.showEffectsRackToast(message, isError ? 'warn' : 'info');
        }
      },

      getProjectState() {
        return window.currentProjectState || (window.parent && window.parent.currentProjectState) || null;
      },

      getSelectedLayer() {
        const state = this.getProjectState();
        if (!state || !Array.isArray(state.layers)) return null;
        const selId = window.selectedLayerId || (window.parent && window.parent.selectedLayerId);
        return state.layers.find(l => l.id === selId) || null;
      },

      seek(sec) {
        if (typeof window.seekTimelineToTime === 'function') {
          window.seekTimelineToTime(sec);
        } else if (window.parent && typeof window.parent.seekTimelineToTime === 'function') {
          window.parent.seekTimelineToTime(sec);
        }
      },

      recordSnapshot() {
        const mgr = window.UndoRedoManager || (window.parent && window.parent.UndoRedoManager);
        if (mgr && typeof mgr.recordSnapshot === 'function') {
          mgr.recordSnapshot();
        }
      },

      redraw() {
        if (typeof window.redrawComposition === 'function') {
          window.redrawComposition();
        } else if (window.parent && typeof window.parent.redrawComposition === 'function') {
          window.parent.redrawComposition();
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
   * Strict Validator for user-imported .jsx files
  /**
   * Helper to convert raw ExtendScript JSX into a standard Card
   */
  function convertScriptToCard(jsxContent, filename = 'custom_script.jsx') {
    const rawBase = filename ? filename.replace(/\.[^/.]+$/, '') : 'Custom Script';
    const cleanName = rawBase.replace(/[-_]/g, ' ') || 'Custom Script';
    const cleanId = 'card_' + (rawBase.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() || 'custom_' + Date.now());
    return `
Card({
  id: ${JSON.stringify(cleanId)},
  name: ${JSON.stringify(cleanName)},
  icon: 'code',
  description: 'Imported Adobe ExtendScript JSX Script',
  build: function(ui, ctx) {
    ui.section('ExtendScript Action');
    ui.button({
      label: ${JSON.stringify('RUN ' + cleanName.toUpperCase())},
      icon: 'play_arrow',
      className: 'w-full tool-btn-primary',
      onClick: function() {
        try {
          ctx.executeJSX(${JSON.stringify(jsxContent)});
          ctx.showToast('Script executed successfully');
        } catch (e) {
          ctx.showToast('Script error: ' + e.message, true);
        }
      }
    });
  }
});
`;
  }

  /**
   * Strict Validator for user-imported .jsx files
   * Supports:
   * 1. Declarative Card({ ... }) definitions with UI buttons and executable functions.
   * 2. Raw Adobe ExtendScript scripts (auto-wrapped into interactive cards).
   */
  function validateJSX(jsxContent, filename = '') {
    if (!jsxContent || typeof jsxContent !== 'string' || !jsxContent.trim()) {
      return { valid: false, error: 'File kosong atau tidak dapat dibaca.' };
    }

    // 1. Basic structural check
    const hasCardCall = /Card\s*\(\s*\{/.test(jsxContent) || /FishExtensions\.defineCard/.test(jsxContent);

    if (!hasCardCall) {
      // Check if this is a raw ExtendScript / JavaScript script
      try {
        new Function('app', 'window', 'globalThis', jsxContent);
      } catch (syntaxErr) {
        return {
          valid: false,
          error: `Kesalahan sintaks JavaScript pada file .jsx: ${syntaxErr.message}`
        };
      }

      // Automatically wrap raw ExtendScript into a Card
      const wrapped = convertScriptToCard(jsxContent, filename);
      const res = validateJSX(wrapped, filename);
      if (res.valid) {
        res.wrappedContent = wrapped;
      }
      return res;
    }

    const hasButton = /ui\.button|createButton|<button|createElement\(['"]button['"]\)/.test(jsxContent);
    const hasFunction = /function|onClick|=>|\.addEventListener/.test(jsxContent);

    if (!hasButton) {
      return {
        valid: false,
        error: 'Format tidak lengkap: Card harus memiliki minimal satu tombol (ui.button).'
      };
    }

    if (!hasFunction) {
      return {
        valid: false,
        error: 'Format tidak lengkap: Tombol harus memiliki fungsi aksi (onClick) yang dapat dieksekusi.'
      };
    }

    // 2. Safe sandbox execution to extract definition
    try {
      let extractedDef = null;
      const sandboxFn = new Function('Card', 'window', 'globalThis', jsxContent);
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
        error: `Kesalahan sintaks JavaScript pada file .jsx: ${err.message}`
      };
    }
  }

  /**
   * Load and evaluate a .jsx string dynamically into runtime
   */
  function loadJSXString(jsxContent, isCustom = false, filename = '') {
    const val = validateJSX(jsxContent, filename);
    if (!val.valid) return val;

    const codeToRun = val.wrappedContent || jsxContent;

    try {
      const fn = new Function('Card', 'window', 'globalThis', codeToRun);
      fn(defineCard, global, global);

      if (val.def && val.def.id) {
        _cardSourceMap.set(val.def.id, jsxContent);
        if (isCustom) {
          saveCustomCardSource(val.def.id, jsxContent);
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

  function saveCustomCardSource(id, jsxContent) {
    const list = getAllCustomCards().filter(item => item.id !== id);
    list.push({ id, code: jsxContent, timestamp: Date.now() });
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
        loadJSXString(item.code, false, item.id);
      }
    });
  }

  /**
   * Public CardBuilder Namespace
   */
  const CardBuilder = {
    Card: defineCard,
    defineCard,
    validateJSX,
    loadJSXString,
    State: CardState,
    getRegistry: () => Array.from(_cardRegistry.values()),
    getCard: (id) => _cardRegistry.get(id) || null,
    getCardSource: (id) => _cardSourceMap.get(id) || null,
    getAllCustomCards,
    deleteCustomCard,
    initCustomCards,
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
