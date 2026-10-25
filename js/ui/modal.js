/**
 * OpenFishTools Studio - Modular Modal System (ModalManager)
 * 
 * Features:
 * 1. Modular: Open/Close any modal by ID or custom HTML content.
 * 2. Back Button Interception: Native browser back / swipe back closes popup without URL address changes.
 * 3. Outside Click: Clicking the empty backdrop closes popup smoothly.
 * 4. Responsive Transition: Mobile (bottom sheet slide-up), Desktop/Tablet (center scale-in).
 */

class ModalManager {
  constructor() {
    this.activeModal = null;
    this.historyPushed = false;
    this.initGlobalListeners();
  }

  initGlobalListeners() {
    // 1. Close on backdrop click (outside the modal card)
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) {
        this.close();
      }
    });

    // 2. Close on ESC key press
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModal) {
        this.close();
      }
    });
  }

  /**
   * Opens a modal container by Element ID or reference
   * @param {string|HTMLElement} modalTarget 
   */
  open(modalTarget) {
    const el = typeof modalTarget === 'string' ? document.getElementById(modalTarget) : modalTarget;
    if (!el) return;

    // Instantiate template if modal content is lazy-templated
    const tmpl = el.querySelector('template');
    if (tmpl && tmpl.content) {
      el.appendChild(tmpl.content.cloneNode(true));
      tmpl.remove();
    }

    // Close existing modal if open
    if (this.activeModal && this.activeModal !== el) {
      this.close(false);
    }

    this.activeModal = el;
    el.classList.add('is-active');
    this.historyPushed = false;

    // Auto-focus first input if present
    const firstInput = el.querySelector('input, select, textarea, button');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }

  /**
   * Closes the active modal
   * @param {string|HTMLElement|boolean} [modalTargetOrTriggerBack=true]
   * @param {boolean} [triggerHistoryBack=true]
   */
  close(modalTargetOrTriggerBack = true, triggerHistoryBack = true) {
    let targetEl = null;

    if (typeof modalTargetOrTriggerBack === 'string') {
      targetEl = document.getElementById(modalTargetOrTriggerBack);
    } else if (modalTargetOrTriggerBack instanceof HTMLElement) {
      targetEl = modalTargetOrTriggerBack;
    }

    const el = targetEl || this.activeModal;
    if (!el) return;

    el.classList.remove('is-active');
    if (this.activeModal === el) {
      this.activeModal = null;
    }
    this.historyPushed = false;
  }
}

// Global Singleton Instance
window.Modal = new ModalManager();

