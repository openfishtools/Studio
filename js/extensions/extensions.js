/**
 * EXTENSIONS.JS - Modular Extension & Card Architecture for OpenFishTools
 * Provides:
 * 1. Desktop docked Extension panel (#desktop-panel-extension) with resizable splitter
 * 2. Mobile/Tablet Extension popover (#popover-extensions)
 * 3. Unified trigger controller (#editor-btn-fishtool-trigger)
 * 4. Extensible Card & Button API (window.FishExtensions) for user/developer scripts
 */
(function(window) {
  'use strict';

  // Internal state
  let _isDesktopOpen = false;
  let _isMobileOpen = false;
  const _registry = new Map();

  function isDesktopMode() {
    const isNarrow = (typeof window !== 'undefined' && window.innerWidth <= 900);
    const isCoarse = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches);
    const hasDesktopPanel = !!document.getElementById('desktop-panel-extension');
    return hasDesktopPanel && !isNarrow && !isCoarse;
  }

  function getTriggers() {
    return Array.from(document.querySelectorAll('#editor-btn-fishtool-trigger, [data-extension-trigger]'));
  }

  function updateTriggerUI(isActive) {
    getTriggers().forEach(btn => {
      btn.classList.toggle('is-active', !!isActive);
      btn.setAttribute('aria-expanded', isActive ? 'true' : 'false');
    });
  }

  function syncLayout() {
    if (typeof window.syncDesktopLayout === 'function') {
      window.syncDesktopLayout();
    } else if (typeof window.fitPreviewCanvasBox === 'function') {
      window.fitPreviewCanvasBox();
    }
  }

  // --- Desktop Panel Controls ---
  function openDesktopPanel() {
    const panel = document.getElementById('desktop-panel-extension');
    const splitter = document.getElementById('desktop-split-extension');
    if (!panel) return;

    panel.style.display = 'flex';
    if (splitter) splitter.style.display = 'flex';
    _isDesktopOpen = true;
    updateTriggerUI(true);

    try {
      localStorage.setItem('oft_desktop_extension_open', '1');
    } catch (_) {}

    syncLayout();
  }

  function closeDesktopPanel() {
    const panel = document.getElementById('desktop-panel-extension');
    const splitter = document.getElementById('desktop-split-extension');
    if (!panel) return;

    panel.style.display = 'none';
    if (splitter) splitter.style.display = 'none';
    _isDesktopOpen = false;
    updateTriggerUI(false);

    try {
      localStorage.setItem('oft_desktop_extension_open', '0');
    } catch (_) {}

    syncLayout();
  }

  function toggleDesktopPanel() {
    if (_isDesktopOpen) {
      closeDesktopPanel();
    } else {
      openDesktopPanel();
    }
  }

  // --- Mobile Popover Controls ---
  function openMobilePopover(triggerEl) {
    const popover = document.getElementById('popover-extensions');
    if (!popover) return;
    const anchor = triggerEl || getTriggers()[0] || document.body;

    if (window.Popover && typeof window.Popover.open === 'function') {
      window.Popover.open(anchor, popover);
    } else {
      popover.classList.add('is-open', 'is-active');
    }
    _isMobileOpen = true;
    updateTriggerUI(true);
  }

  function closeMobilePopover() {
    const popover = document.getElementById('popover-extensions');
    if (!popover) return;

    if (window.Popover && typeof window.Popover.close === 'function') {
      window.Popover.close();
    } else {
      popover.classList.remove('is-open', 'is-active');
    }
    _isMobileOpen = false;
    updateTriggerUI(false);
  }

  function toggleMobilePopover(triggerEl) {
    const popover = document.getElementById('popover-extensions');
    if (!popover) return;
    const anchor = triggerEl || getTriggers()[0] || document.body;

    if (window.Popover && typeof window.Popover.toggle === 'function') {
      window.Popover.toggle(anchor, popover);
      const isOpenNow = (typeof window.Popover.isOpen === 'function') ? window.Popover.isOpen() : popover.classList.contains('is-open');
      _isMobileOpen = isOpenNow;
      updateTriggerUI(isOpenNow);
    } else {
      const isOpen = popover.classList.contains('is-open');
      if (isOpen) {
        closeMobilePopover();
      } else {
        openMobilePopover(anchor);
      }
    }
  }

  // --- Unified Trigger Handler ---
  function handleTriggerClick(e, triggerEl) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (isDesktopMode()) {
      // If mobile popover happened to be open, close it first
      closeMobilePopover();
      toggleDesktopPanel();
    } else {
      // If desktop panel happened to be open, close it first
      closeDesktopPanel();
      toggleMobilePopover(triggerEl);
    }
  }

  // --- Resizable Splitter Logic (#desktop-split-extension) ---
  function initDesktopSplitter() {
    const splitExt = document.getElementById('desktop-split-extension');
    const viewport = document.querySelector('.desktop-viewport');
    if (!splitExt || !viewport) return;

    // Load saved extension width
    try {
      const savedW = localStorage.getItem('oft_desktop_extension_width');
      if (savedW) viewport.style.setProperty('--desktop-extension-width', savedW);
    } catch (_) {}

    let isDragging = false;

    splitExt.addEventListener('pointerdown', (e) => {
      isDragging = true;
      splitExt.classList.add('is-dragging');
      viewport.classList.add('is-resizing');
      splitExt.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    splitExt.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const rect = viewport.getBoundingClientRect();
      const rightW = parseFloat(getComputedStyle(viewport).getPropertyValue('--desktop-right-width')) || 320;
      const splitRightW = 5;
      const extensionRightEdge = rect.right - rightW - splitRightW;
      let px = extensionRightEdge - e.clientX;

      // Clamp between 220px and 600px
      px = Math.max(220, Math.min(600, px));
      const val = Math.round(px) + 'px';
      viewport.style.setProperty('--desktop-extension-width', val);

      try {
        localStorage.setItem('oft_desktop_extension_width', val);
      } catch (_) {}

      syncLayout();
    }, { passive: true });

    function stopDrag(e) {
      if (!isDragging) return;
      isDragging = false;
      splitExt.classList.remove('is-dragging');
      viewport.classList.remove('is-resizing');
      try { splitExt.releasePointerCapture(e.pointerId); } catch (_) {}
      document.body.style.cursor = '';
      syncLayout();
    }

    splitExt.addEventListener('pointerup', stopDrag);
    splitExt.addEventListener('pointercancel', stopDrag);
  }

  // --- Extension Card & Button Registry (FishExtensions API) ---
  const FishExtensions = {
    /**
     * Register a new extension card.
     * @param {Object} def
     * @param {string} def.id - Unique extension ID
     * @param {string} def.name - Extension title displayed in card header
     * @param {string} [def.icon] - fticon class or SVG string
     * @param {string} [def.description] - Short summary of the extension
     * @param {Function} [def.render] - Function(cardBody, api) to build card controls & buttons
     */
    register(def) {
      if (!def || !def.id) {
        console.warn('[FishExtensions] Registration failed: "id" is required.');
        return false;
      }
      _registry.set(def.id, def);
      this.renderAll();
      return true;
    },

    unregister(id) {
      if (_registry.has(id)) {
        _registry.delete(id);
        this.renderAll();
        return true;
      }
      return false;
    },

    get(id) {
      return _registry.get(id) || null;
    },

    getAll() {
      return Array.from(_registry.values());
    },

    /**
     * Render all registered extension cards into both desktop and mobile views.
     */
    renderAll() {
      const desktopList = document.getElementById('desktop-extension-card-list');
      const mobileList = document.getElementById('mobile-extension-card-list');
      const desktopEmpty = document.getElementById('desktop-extension-empty');
      const mobileEmpty = document.getElementById('mobile-extension-empty');

      const exts = this.getAll();
      const hasExts = exts.length > 0;

      if (desktopEmpty) desktopEmpty.style.display = hasExts ? 'none' : 'flex';
      if (mobileEmpty) mobileEmpty.style.display = hasExts ? 'none' : 'flex';

      const containers = [desktopList, mobileList].filter(Boolean);
      containers.forEach(list => {
        list.innerHTML = '';
        if (!hasExts) return;

        exts.forEach(def => {
          const card = document.createElement('div');
          card.className = 'extension-card';
          card.id = `extension-card-${def.id}`;

          // Card Header
          const header = document.createElement('div');
          header.className = 'extension-card-header';

          const titleGrp = document.createElement('div');
          titleGrp.className = 'extension-card-title-group';

          if (def.icon) {
            if (def.icon.startsWith('<svg')) {
              const iconBox = document.createElement('span');
              iconBox.innerHTML = def.icon;
              titleGrp.appendChild(iconBox);
            } else if (def.icon.startsWith('fticon-')) {
              const iconEl = document.createElement('i');
              iconEl.className = `fticon ${def.icon}`;
              iconEl.setAttribute('aria-hidden', 'true');
              titleGrp.appendChild(iconEl);
            } else {
              const iconEl = document.createElement('span');
              iconEl.className = 'material-icons';
              iconEl.textContent = def.icon;
              titleGrp.appendChild(iconEl);
            }
          }

          const title = document.createElement('span');
          title.className = 'extension-card-title';
          title.textContent = def.name || def.id;
          titleGrp.appendChild(title);
          header.appendChild(titleGrp);
          card.appendChild(header);

          // Card Body
          const body = document.createElement('div');
          body.className = 'extension-card-body';

          const api = this.createAPI(def, body);
          if (typeof def.render === 'function') {
            try {
              def.render(body, api);
            } catch (err) {
              console.error(`[FishExtensions] Error rendering extension "${def.id}":`, err);
              const errEl = document.createElement('div');
              errEl.style.color = 'var(--color-danger, #e55353)';
              errEl.style.fontSize = '11px';
              errEl.textContent = `Render Error: ${err.message}`;
              body.appendChild(errEl);
            }
          }

          card.appendChild(body);
          list.appendChild(card);
        });
      });
    },

    /**
     * Create developer/user-facing API passed into render(cardBody, api).
     */
    createAPI(def, cardBody) {
      let btnGrid = null;

      return {
        /**
         * Mount a button inside the extension card.
         * @param {Object} opts - { label, icon, onClick, title, className }
         */
        createButton(opts = {}) {
          if (!btnGrid) {
            btnGrid = document.createElement('div');
            btnGrid.className = 'extension-btn-grid';
            cardBody.appendChild(btnGrid);
          }
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `extension-btn ${opts.className || ''}`.trim();
          if (opts.title) btn.title = opts.title;

          if (opts.icon) {
            if (opts.icon.startsWith('<svg')) {
              btn.innerHTML = opts.icon;
            } else {
              const ic = document.createElement('i');
              ic.className = `fticon ${opts.icon}`;
              ic.setAttribute('aria-hidden', 'true');
              btn.appendChild(ic);
            }
          }

          if (opts.label) {
            const span = document.createElement('span');
            span.textContent = opts.label;
            btn.appendChild(span);
          }

          if (typeof opts.onClick === 'function') {
            btn.addEventListener('click', (e) => {
              e.preventDefault();
              try {
                opts.onClick(e);
              } catch (err) {
                console.error(`[FishExtensions:${def.id}] Click error:`, err);
              }
            });
          }

          btnGrid.appendChild(btn);
          return btn;
        },

        getProjectState() {
          return window.currentProjectState || null;
        },

        getSelectedLayer() {
          const state = window.currentProjectState;
          if (!state || !Array.isArray(state.layers)) return null;
          const selId = window.selectedLayerId;
          return state.layers.find(l => l.id === selId) || null;
        },

        seek(sec) {
          if (typeof window.seekTimelineToTime === 'function') {
            window.seekTimelineToTime(sec);
          } else if (window.currentProjectState) {
            window.currentProjectState.currentTime = sec;
            if (typeof window.redrawComposition === 'function') window.redrawComposition();
          }
        },

        showToast(message, isError = false) {
          const type = isError ? 'error' : 'info';
          if (typeof window.showEditorToast === 'function') {
            window.showEditorToast(message, 2400, type);
          } else if (typeof window.showDashboardToast === 'function') {
            window.showDashboardToast(message, 2400, type);
          } else if (typeof window.showEffectsRackToast === 'function') {
            window.showEffectsRackToast(message, isError ? 'warn' : 'info');
          }
        },

        recordSnapshot() {
          if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
            window.UndoRedoManager.recordSnapshot();
          }
        },

        redraw() {
          if (typeof window.redrawComposition === 'function') {
            window.redrawComposition();
          }
        }
      };
    },

    toggle() {
      handleTriggerClick(null, getTriggers()[0]);
    },

    open() {
      if (isDesktopMode()) openDesktopPanel();
      else openMobilePopover(getTriggers()[0]);
    },

    close() {
      closeDesktopPanel();
      closeMobilePopover();
    },

    isOpen() {
      return isDesktopMode() ? _isDesktopOpen : _isMobileOpen;
    },

    init() {
      // 1. Wire Triggers
      getTriggers().forEach(btn => {
        if (btn._fishExtBound) return;
        btn._fishExtBound = true;
        btn.addEventListener('click', (e) => handleTriggerClick(e, btn));
      });

      // 2. Wire Close Buttons
      const desktopCloseBtn = document.getElementById('desktop-extension-close');
      if (desktopCloseBtn && !desktopCloseBtn._bound) {
        desktopCloseBtn._bound = true;
        desktopCloseBtn.addEventListener('click', (e) => {
          e.preventDefault();
          closeDesktopPanel();
        });
      }

      const mobileCloseBtn = document.getElementById('popover-extensions-close');
      if (mobileCloseBtn && !mobileCloseBtn._bound) {
        mobileCloseBtn._bound = true;
        mobileCloseBtn.addEventListener('click', (e) => {
          e.preventDefault();
          closeMobilePopover();
        });
      }

      // 3. Listen to Popover system close events
      const mobilePopover = document.getElementById('popover-extensions');
      if (mobilePopover) {
        mobilePopover.addEventListener('popover:close', () => {
          _isMobileOpen = false;
          updateTriggerUI(false);
        });
        const observer = new MutationObserver(() => {
          const isOpen = mobilePopover.classList.contains('is-open');
          if (!isOpen && _isMobileOpen) {
            _isMobileOpen = false;
            updateTriggerUI(false);
          }
        });
        observer.observe(mobilePopover, { attributes: true, attributeFilter: ['class', 'style'] });
      }

      // 4. Initialize Splitter
      initDesktopSplitter();

      // 5. Restore saved desktop panel state on desktop view
      try {
        if (isDesktopMode() && localStorage.getItem('oft_desktop_extension_open') === '1') {
          openDesktopPanel();
        }
      } catch (_) {}

      // 6. Initial render of cards
      this.renderAll();
    }
  };

  // Expose to window
  window.FishExtensions = FishExtensions;

  // Auto-init on DOMContentLoaded or immediate if already ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => FishExtensions.init());
  } else {
    setTimeout(() => FishExtensions.init(), 0);
  }

})(typeof window !== 'undefined' ? window : this);
