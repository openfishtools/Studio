/**
 * OpenFishTools Studio - Modular Drawer Controller (DrawerManager)
 * 
 * Features:
 * 1. Bottom Sheet Drawer: Slides up from bottom with 60fps GPU acceleration.
 * 2. Top Drag Handle Resizer: Drag handle up to expand drawer height, strictly clamped
 *    when content is fully displayed ("sudah ke show semua") or hits container top boundary.
 * 3. Rapid Multi-Tool Switching: Immediately cleans and closes existing drawer before opening new one.
 * 4. Perfect Close (Drawer & Content Cleanup): Automatically empties and purges inner content upon closing.
 * 5. Content-adaptive Height: Fits content height without rigid overflow.
 * 6. Outside Backdrop & ESC Key Dismissal.
 * 7. Native Browser Back / Popstate Interception without URL mutations.
 * 8. Programmatic API: open(target, content), close(), clearContent(target), setContent(target, content).
 */

class DrawerManager {
  constructor() {
    this.activeDrawer = null;
    this.historyPushed = false;
    this.initGlobalListeners();
    this.initDragHandleListeners();
  }

  initGlobalListeners() {
    // 1. Close on backdrop or [data-drawer-close] click
    document.addEventListener('click', (e) => {
      const closeTrigger = e.target.closest('[data-drawer-close]');
      if (closeTrigger) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }

      // Click outside card in full-screen drawer (e.g. effects-gallery backdrop)
      if (e.target && (e.target.id === 'drawer-effects-gallery' || (e.target.id === 'timeline-layer-drawer' && e.target.getAttribute('data-subview') === 'effects-gallery'))) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }

      const openTrigger = e.target.closest('[data-drawer-target]');
      if (openTrigger) {
        e.preventDefault();
        e.stopPropagation();
        const targetId = openTrigger.getAttribute('data-drawer-target');
        this.toggle(targetId);
        return;
      }

      // 2. Category Tab switcher inside Add Layer Drawer
      const categoryTab = e.target.closest('.category-tab-btn');
      if (categoryTab) {
        const bar = categoryTab.closest('.add-layer-categories-bar');
        if (bar) {
          bar.querySelectorAll('.category-tab-btn').forEach((btn) => {
            btn.classList.remove('is-selected');
            btn.setAttribute('aria-selected', 'false');
          });
          categoryTab.classList.add('is-selected');
          categoryTab.setAttribute('aria-selected', 'true');
        }
      }
    });

    // 2. Close on ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeDrawer) {
        this.close();
      }
    });
  }

  /**
   * Interactive Pointer-Event Drag Handle Resizer & Magnetic Sheet Drag-to-Close
   */
  initDragHandleListeners() {
    let isDragging = false;
    let startY = 0;
    let startHeight = 0;
    let currentOffsetY = 0;
    let rawDownDist = 0;
    let isMagnetDetached = false;
    let lastY = 0;
    let lastTime = 0;
    let velocityY = 0;
    let dragZoom = 1;
    let currentHandle = null;
    let currentCard = null;
    let currentContainer = null;
    let currentBackdrop = null;
    let currentIsFlexible = false;
    let maxAllowedHeight = 0;
    let minAllowedHeight = 60;

    document.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.drawer-drag-handle');
      if (!handle) return;

      const card = handle.closest('.drawer-card');
      const container = handle.closest('.drawer-container');
      if (!card || !container) return;

      if (card._dragSpringTimer) {
        clearTimeout(card._dragSpringTimer);
        card._dragSpringTimer = null;
      }
      if (card._magnetSnapTimer) {
        clearTimeout(card._magnetSnapTimer);
        card._magnetSnapTimer = null;
      }

      isDragging = true;
      currentHandle = handle;
      currentCard = card;
      currentContainer = container;
      currentBackdrop = container.querySelector('.drawer-backdrop');
      startY = e.clientY;
      lastY = e.clientY;
      lastTime = performance.now();
      velocityY = 0;
      currentOffsetY = 0;
      rawDownDist = 0;
      isMagnetDetached = false;

      // UI-scale zoom compensation: pointer + rects report visual px, but
      // card heights live in layout px — convert once here.
      dragZoom = (typeof window.oftUiScaleFactor === 'function' ? window.oftUiScaleFactor() : 1) || 1;
      startHeight = card.getBoundingClientRect().height / dragZoom;

      // Effects Gallery is flexible and allowed to expand all the way up to topLimit (full screen)
      const isEffectsGallery = Boolean(
        container.id === 'drawer-effects-gallery' ||
        container.getAttribute('data-subview') === 'effects-gallery' ||
        card.classList.contains('is-effects-gallery')
      );

      const isTablet = window.innerWidth >= 601;
      const containerH = (isEffectsGallery && isTablet)
        ? (container.clientHeight || (window.innerHeight / dragZoom - 44))
        : (isEffectsGallery
            ? ((window.innerHeight / dragZoom) || document.documentElement.clientHeight)
            : (container.clientHeight || window.innerHeight / dragZoom));
      const topLimit = Math.max(80, containerH - 16);

      currentIsFlexible = isEffectsGallery;

      if (isEffectsGallery) {
        maxAllowedHeight = topLimit;
        minAllowedHeight = Math.min(220, topLimit);
      } else {
        // Timeline drawers (#timeline-layer-drawer and #timeline-add-drawer) follow
        // a locked Transform height and slide downward via translate3d when dragged to close.
        maxAllowedHeight = startHeight;
        minAllowedHeight = startHeight;
      }

      container.style.pointerEvents = '';
      card._closingFromDrag = false;
      handle.classList.add('is-dragging');
      handle.classList.remove('is-magnet-detached');
      card.style.transition = 'none';
      card.style.willChange = 'transform';
      if (currentBackdrop) {
        currentBackdrop.style.transition = 'none';
      }
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (_) {}
      e.preventDefault();
    });

    document.addEventListener('pointermove', (e) => {
      if (!isDragging || !currentCard) return;

      const now = performance.now();
      const dt = now - lastTime;
      if (dt > 0) {
        const instVy = ((e.clientY - lastY) / dragZoom) / dt; // px/ms, positive = dragging down
        velocityY = velocityY * 0.4 + instVy * 0.6;
        lastY = e.clientY;
        lastTime = now;
      }

      const rawDownY = (e.clientY - startY) / dragZoom; // positive = dragging downward
      rawDownDist = Math.max(0, rawDownY);

      if (currentIsFlexible) {
        const deltaUp = -rawDownY;
        const rawTargetHeight = startHeight + deltaUp;
        if (rawTargetHeight >= minAllowedHeight) {
          const targetHeight = Math.min(maxAllowedHeight, rawTargetHeight);
          currentCard.style.height = `${targetHeight}px`;
          currentCard.style.transform = 'translate3d(0, 0, 0)';
          currentOffsetY = 0;
          isMagnetDetached = false;
          if (currentHandle) currentHandle.classList.remove('is-magnet-detached');
          if (currentBackdrop) {
            currentBackdrop.style.opacity = '';
          }
        } else {
          // Below minAllowedHeight: magnetic hold then slide downward
          currentCard.style.height = `${minAllowedHeight}px`;
          const pullBelow = Math.max(0, minAllowedHeight - rawTargetHeight);
          const magnetThreshold = 68;
          const nextDetached = pullBelow >= magnetThreshold;
          if (nextDetached !== isMagnetDetached) {
            isMagnetDetached = nextDetached;
            if (currentHandle) currentHandle.classList.toggle('is-magnet-detached', isMagnetDetached);
            currentCard.style.transition = 'transform 0.11s cubic-bezier(0.22, 1, 0.36, 1)';
            if (currentCard._magnetSnapTimer) clearTimeout(currentCard._magnetSnapTimer);
            const cRef = currentCard;
            currentCard._magnetSnapTimer = setTimeout(() => {
              if (isDragging && cRef === currentCard) cRef.style.transition = 'none';
            }, 115);
          }
          if (!isMagnetDetached) {
            const ratio = pullBelow / magnetThreshold;
            currentOffsetY = magnetThreshold * 0.46 * Math.pow(ratio, 0.85);
          } else {
            currentOffsetY = (magnetThreshold * 0.46) + (pullBelow - magnetThreshold) * 0.92;
          }
          currentCard.style.transform = `translate3d(0, ${currentOffsetY.toFixed(2)}px, 0)`;
          if (currentBackdrop) {
            const progress = Math.min(1, currentOffsetY / Math.max(140, minAllowedHeight));
            currentBackdrop.style.opacity = String(Math.max(0, 1 - progress * 0.85));
          }
        }
      } else {
        // Fixed timeline drawers: two-zone magnetic hold at top + smooth slide-down beyond magnet threshold
        const magnetThreshold = Math.min(82, Math.max(60, startHeight * 0.30));
        const nextDetached = rawDownDist >= magnetThreshold;

        if (nextDetached !== isMagnetDetached) {
          isMagnetDetached = nextDetached;
          if (currentHandle) currentHandle.classList.toggle('is-magnet-detached', isMagnetDetached);
          currentCard.style.transition = 'transform 0.11s cubic-bezier(0.22, 1, 0.36, 1)';
          if (currentCard._magnetSnapTimer) clearTimeout(currentCard._magnetSnapTimer);
          const cRef = currentCard;
          currentCard._magnetSnapTimer = setTimeout(() => {
            if (isDragging && cRef === currentCard) cRef.style.transition = 'none';
          }, 115);
        }

        if (!isMagnetDetached) {
          // Zone 1 (Top Magnet Hold): strong magnetic tension holding drawer near the top
          const ratio = rawDownDist / magnetThreshold;
          currentOffsetY = magnetThreshold * 0.46 * Math.pow(ratio, 0.85);
        } else {
          // Zone 2 (Magnet Detached): breaks free of top magnet and tracks finger downward
          currentOffsetY = (magnetThreshold * 0.46) + (rawDownDist - magnetThreshold) * 0.94;
        }

        currentCard.style.transform = `translate3d(0, ${currentOffsetY.toFixed(2)}px, 0)`;
        if (currentBackdrop) {
          const progress = Math.min(1, currentOffsetY / Math.max(140, startHeight));
          currentBackdrop.style.opacity = String(Math.max(0, 1 - progress * 0.85));
        }
      }
    });

    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;

      if (currentHandle) {
        currentHandle.classList.remove('is-dragging', 'is-magnet-detached');
        try {
          currentHandle.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }

      if (currentCard) {
        const cardRef = currentCard;
        const backdropRef = currentBackdrop;
        const containerRef = currentContainer;

        if (cardRef._magnetSnapTimer) {
          clearTimeout(cardRef._magnetSnapTimer);
          cardRef._magnetSnapTimer = null;
        }

        // If user held finger stationary before lifting, decay flick velocity
        if (performance.now() - lastTime > 65) {
          velocityY = 0;
        }

        const effectiveH = currentIsFlexible
          ? (cardRef.getBoundingClientRect().height / dragZoom)
          : startHeight;

        // Dismiss only when pulled past the magnetic detachment threshold OR Deliberate fast downward flick
        const shouldDismiss = isMagnetDetached || (velocityY > 0.85 && rawDownDist > 38);

        if (shouldDismiss) {
          // Bottom magnet sucks the drawer smoothly all the way down off-screen BEFORE deactivating .is-active
          const targetCloseY = Math.ceil(effectiveH + 28);
          const remainingPx = Math.max(36, targetCloseY - currentOffsetY);
          const durationMs = velocityY > 0.85
            ? Math.max(190, Math.min(250, Math.round(remainingPx / Math.min(2.2, velocityY))))
            : 260;

          cardRef._closingFromDrag = true;
          if (containerRef) {
            containerRef.style.pointerEvents = 'none';
          }
          cardRef.style.transition = `transform ${durationMs}ms cubic-bezier(0.32, 0.72, 0, 1)`;
          if (backdropRef) {
            backdropRef.style.transition = `opacity ${durationMs}ms cubic-bezier(0.32, 0.72, 0, 1)`;
            backdropRef.style.opacity = '0';
          }
          void cardRef.offsetHeight;
          cardRef.style.transform = `translate3d(0, ${targetCloseY}px, 0)`;

          cardRef._dragSpringTimer = setTimeout(() => {
            this.close(containerRef || true);
            cardRef._closingFromDrag = false;
            cardRef.style.transition = '';
            cardRef.style.transform = '';
            cardRef.style.willChange = '';
            if (containerRef) {
              containerRef.style.pointerEvents = '';
            }
            if (backdropRef) {
              backdropRef.style.transition = '';
              backdropRef.style.opacity = '';
            }
            cardRef._dragSpringTimer = null;
          }, durationMs);
        } else if (currentOffsetY > 0) {
          // Top magnet pulls drawer back up into place with a tactile magnetic spring
          cardRef.style.transition = 'transform 0.34s cubic-bezier(0.18, 1.20, 0.32, 1)';
          if (backdropRef) {
            backdropRef.style.transition = 'opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1)';
            backdropRef.style.opacity = '';
          }
          void cardRef.offsetHeight;
          cardRef.style.transform = 'translate3d(0, 0, 0)';

          cardRef._dragSpringTimer = setTimeout(() => {
            cardRef.style.transition = '';
            cardRef.style.transform = '';
            cardRef.style.willChange = '';
            if (backdropRef) {
              backdropRef.style.transition = '';
            }
            cardRef._dragSpringTimer = null;
          }, 350);
        } else {
          cardRef.style.transition = '';
          cardRef.style.transform = '';
          cardRef.style.willChange = '';
          if (backdropRef) {
            backdropRef.style.transition = '';
            backdropRef.style.opacity = '';
          }
          if (currentIsFlexible && containerRef && containerRef.id === 'timeline-layer-drawer') {
            const mainTl = document.getElementById('main-editor-timeline');
            if (mainTl) mainTl.style.setProperty('--timeline-drawer-height', `${Math.round(effectiveH)}px`);
            if (typeof window.centerSelectedTimelineLayer === 'function') {
              window.centerSelectedTimelineLayer(true);
            }
          }
        }
      }

      currentHandle = null;
      currentCard = null;
      currentContainer = null;
      currentBackdrop = null;
      currentIsFlexible = false;
      currentOffsetY = 0;
      rawDownDist = 0;
      isMagnetDetached = false;
    };

    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  }

  /**
   * Resolves target element from string ID or element reference
   * @param {string|HTMLElement} target
   * @returns {HTMLElement|null}
   */
  resolveElement(target) {
    if (!target) return null;
    return typeof target === 'string' ? document.getElementById(target) : target;
  }

  /**
   * Sets content of drawer's body
   * @param {string|HTMLElement} target 
   * @param {string|HTMLElement} content 
   */
  setContent(target, content) {
    const el = this.resolveElement(target);
    if (!el) return;
    const body = el.querySelector('.drawer-body');
    if (!body) return;

    if (typeof content === 'string') {
      body.innerHTML = content;
    } else if (content instanceof Node) {
      body.innerHTML = '';
      body.appendChild(content);
    }
  }

  /**
   * Cleans and purges content inside drawer body
   * @param {string|HTMLElement} target 
   */
  clearContent(target) {
    const el = this.resolveElement(target);
    if (!el) return;

    const body = el.querySelector('.drawer-body');
    if (body) {
      body.querySelectorAll('input, select, textarea').forEach((input) => {
        if (input.type !== 'file') input.value = '';
      });
      if (body.hasAttribute('data-clear-body')) {
        body.innerHTML = '';
      }
    }

    const card = el.querySelector('.drawer-card');
    if (card) {
      card.style.height = '';
      if (!card._closingFromDrag) {
        card.style.transform = '';
        card.style.transition = '';
        card.style.willChange = '';
      }
    }
    const backdrop = el.querySelector('.drawer-backdrop');
    if (backdrop && (!card || !card._closingFromDrag)) {
      backdrop.style.opacity = '';
      backdrop.style.transition = '';
    }
  }

  /**
   * Fast cleanup of active elements, DOM state, and inner content
   * @param {HTMLElement} [exceptEl] - Container element to preserve
   */
  cleanup(exceptEl = null) {
    // 1. Release active focus inside closing drawers
    if (document.activeElement && document.activeElement.closest('.drawer-container')) {
      const parentDrawer = document.activeElement.closest('.drawer-container');
      if (parentDrawer !== exceptEl) {
        document.activeElement.blur();
      }
    }

    // 2. Immediate purge of any lingering active drawer states and content in DOM
    const activeDrawers = document.querySelectorAll('.drawer-container.is-active');
    let hasRemainingActive = false;
    activeDrawers.forEach((drawer) => {
      if (drawer !== exceptEl) {
        if (exceptEl && exceptEl.id === 'drawer-effects-gallery' && drawer.id === 'timeline-layer-drawer') {
          return;
        }
        drawer.classList.remove('is-active');
        drawer.setAttribute('aria-hidden', 'true');
        this.clearContent(drawer);
      } else {
        hasRemainingActive = true;
      }
    });
    if (!hasRemainingActive && !exceptEl) {
      document.body.classList.remove('has-active-drawer');
      document.querySelectorAll('.editor-timeline.has-drawer-open').forEach(t => t.classList.remove('has-drawer-open'));
    }
  }

  /**
   * Opens target drawer. Instantly closes existing drawer without stacking delay.
   * @param {string|HTMLElement} target 
   * @param {string|HTMLElement} [content] - Optional dynamic content to set
   */
  open(target, content = null) {
    const el = this.resolveElement(target);
    if (!el) return;

    // Mutually exclusive: If a popover is active, automatically close it immediately
    if (window.Popover && typeof window.Popover.close === 'function') {
      window.Popover.close(false);
    }

    // If another drawer is already open, preserve timeline-layer-drawer if opening drawer-effects-gallery
    if (this.activeDrawer && this.activeDrawer !== el) {
      if (el.id === 'drawer-effects-gallery' && this.activeDrawer.id === 'timeline-layer-drawer') {
        this.parentDrawer = this.activeDrawer;
      } else {
        this.cleanup(el);
      }
    } else {
      this.cleanup(el);
    }

    // Inject content if provided
    if (content) {
      this.setContent(el, content);
    }

    // Reset height and drag styles to natural content state
    el.style.pointerEvents = '';
    const card = el.querySelector('.drawer-card');
    if (card) {
      if (card._dragSpringTimer) {
        clearTimeout(card._dragSpringTimer);
        card._dragSpringTimer = null;
      }
      if (card._magnetSnapTimer) {
        clearTimeout(card._magnetSnapTimer);
        card._magnetSnapTimer = null;
      }
      card._closingFromDrag = false;
      card.style.height = '';
      card.style.transform = '';
      card.style.transition = '';
      card.style.willChange = '';
    }
    const backdrop = el.querySelector('.drawer-backdrop');
    if (backdrop) {
      backdrop.style.opacity = '';
      backdrop.style.transition = '';
    }

    this.activeDrawer = el;
    el.classList.add('is-active');
    el.setAttribute('aria-hidden', 'false');

    document.body.classList.add('has-active-drawer');
    const timeline = el.closest('.editor-timeline') || document.querySelector('.editor-timeline');
    if (timeline) {
      timeline.classList.add('has-drawer-open');
    }
    const fab = document.getElementById('timeline-btn-add') || document.querySelector('.timeline-fab-add');
    if (fab && document.activeElement === fab) {
      fab.blur();
    }

    this.historyPushed = false;

    // Auto-focus first focusable element inside drawer
    const focusable = el.querySelector('button, [tabindex="0"], input');
    if (focusable) {
      setTimeout(() => focusable.focus(), 50);
    }

    window.dispatchEvent(new CustomEvent('drawer-opened', { detail: { id: el.id, target: el } }));
  }

  /**
   * Perfect Close: Closes active drawer and purges its inner content
   * @param {boolean|string|HTMLElement} [targetOrHistory=true]
   * @param {boolean} [triggerHistoryBack=true]
   */
  close(targetOrHistory = true, triggerHistoryBack = true) {
    let closingDrawer = this.activeDrawer;

    if (typeof targetOrHistory === 'string' || (targetOrHistory && targetOrHistory.nodeType)) {
      const specified = this.resolveElement(targetOrHistory);
      if (specified) {
        closingDrawer = specified;
      }
    }

    if (!closingDrawer) {
      closingDrawer = document.querySelector('.drawer-container.is-active');
    }

    if (!closingDrawer) {
      this.cleanup(null);
      return;
    }

    // Deactivate drawer UI immediately
    closingDrawer.classList.remove('is-active');
    closingDrawer.setAttribute('aria-hidden', 'true');
    const closingCard = closingDrawer.querySelector('.drawer-card');
    if (closingCard) {
      closingCard.style.height = '';
      closingCard.style.transform = '';
      if (!closingCard._closingFromDrag) {
        closingCard.style.transition = '';
        closingCard.style.willChange = '';
      }
    }

    if (closingDrawer.id === 'drawer-effects-gallery' && this.parentDrawer && (this.parentDrawer.classList.contains('is-active') || this.isOpen(this.parentDrawer))) {
      this.activeDrawer = this.parentDrawer;
      this.parentDrawer = null;
    } else {
      if (this.activeDrawer === closingDrawer) {
        this.activeDrawer = null;
      }
      this.parentDrawer = null;
    }

    const remainingActive = document.querySelectorAll('.drawer-container.is-active');
    if (remainingActive.length === 0) {
      document.body.classList.remove('has-active-drawer');
      document.querySelectorAll('.editor-timeline.has-drawer-open').forEach(t => t.classList.remove('has-drawer-open'));
    }

    window.dispatchEvent(new CustomEvent('drawer-closed', { detail: { id: closingDrawer.id, target: closingDrawer } }));

    // Release active element focus
    if (document.activeElement && document.activeElement.closest('.drawer-container')) {
      document.activeElement.blur();
    }

    // Clean inner content: Purge upon slide-down animation completion
    setTimeout(() => {
      if (!this.isOpen(closingDrawer) && closingDrawer.id !== 'drawer-effects-gallery') {
        this.clearContent(closingDrawer);
      }
    }, 260);

    this.historyPushed = false;
  }

  /**
   * Immediately closes all drawers and purges all drawer content
   */
  closeAll() {
    const allDrawers = document.querySelectorAll('.drawer-container');
    allDrawers.forEach((d) => this.clearContent(d));
    this.cleanup(null);
    this.activeDrawer = null;
    this.historyPushed = false;
    document.body.classList.remove('has-active-drawer');
    document.querySelectorAll('.editor-timeline.has-drawer-open').forEach(t => t.classList.remove('has-drawer-open'));
  }

  /**
   * Toggles drawer state
   * @param {string|HTMLElement} target 
   * @param {string|HTMLElement} [content]
   */
  toggle(target, content = null) {
    const el = this.resolveElement(target);
    if (!el) return;

    if (this.activeDrawer === el) {
      this.close();
    } else {
      this.open(el, content);
    }
  }

  /**
   * Returns whether a drawer is open
   * @param {string|HTMLElement} target 
   * @returns {boolean}
   */
  isOpen(target) {
    const el = this.resolveElement(target);
    if (!el) return false;
    return el.classList.contains('is-active') || this.activeDrawer === el;
  }
}

// Global Singleton Instance
window.Drawer = new DrawerManager();

window.closeDrawer = function(target) {
  if (!window.Drawer) return;
  if (target) {
    const el = window.Drawer.resolveElement(target);
    if (el && window.Drawer.isOpen(el)) {
      window.Drawer.close();
    } else if (el) {
      el.classList.remove('is-active');
    }
  } else {
    window.Drawer.close();
  }
};

window.closeLayerDrawer = function() {
  window.closeDrawer('timeline-layer-drawer');
};
