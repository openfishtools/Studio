/**
 * OpenFishTools Studio - Extension Manager & Modal UI Controller
 * 
 * Manages:
 * 1. Synchronization of modular built-in `Extension/*.js` cards into FishExtensions.
 * 2. Extension Modal UI in index.html (Extension list with On/Off switches).
 * 3. Import .js button & validation (only valid modular Card({ ... }) scripts are accepted).
 * 4. Synchronization of enabled extensions across index.html, editor.html, and desktop.html.
 */
(function(global) {
  'use strict';

  /**
   * Extension Modal UI Controller
   */
  const ExtensionManager = {
    init() {
      if (global.CardBuilder && typeof global.CardBuilder.syncToFishExtensions === 'function') {
        global.CardBuilder.syncToFishExtensions();
      }

      // Setup Import Button and File Input
      const btnImport = document.getElementById('btn-import-extension');
      const inputImport = document.getElementById('input-import-js') || document.getElementById('input-import-jsx');

      if (btnImport && inputImport && !btnImport._extBound) {
        btnImport._extBound = true;
        btnImport.addEventListener('click', (e) => {
          e.preventDefault();
          inputImport.click();
        });

        inputImport.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) {
            this.handleImportFile(file);
          }
          inputImport.value = ''; // Reset for next selection
        });
      }

      // Initial render of the extension list
      this.renderList();

      // Listen for custom card deletions or state changes
      if (typeof window !== 'undefined' && !window._oftExtManagerListenersBound) {
        window._oftExtManagerListenersBound = true;
        window.addEventListener('extension-custom-deleted', () => this.renderList());
        window.addEventListener('extension-state-changed', () => this.renderList());
      }
    },

    /**
     * Read, validate, and load an imported .js extension file
     */
    handleImportFile(file) {
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        if (!global.CardBuilder) {
          alert('Error: CardBuilder runtime tidak tersedia.');
          return;
        }

        // Validate modular JS Card format
        const validation = global.CardBuilder.validateExtensionJS(content, file.name);
        if (!validation.valid) {
          alert(`Import Gagal!\n\n${validation.error}`);
          return;
        }

        // Load into runtime and persist
        const loadResult = global.CardBuilder.loadExtensionJS(content, true, file.name);
        if (!loadResult.valid) {
          alert(`Gagal mengeksekusi file ekstensi .js: ${loadResult.error}`);
          return;
        }

        // Auto-enable newly imported card
        if (loadResult.def && loadResult.def.id) {
          global.CardBuilder.State.setEnabled(loadResult.def.id, true);
        }

        // Sync with FishExtensions
        global.CardBuilder.syncToFishExtensions();

        // Refresh list
        this.renderList();

        const cardName = (loadResult.def && loadResult.def.name) || file.name;
        alert(`Berhasil mengimpor ekstensi "${cardName}"!\nEkstensi kini aktif dan dapat digunakan.`);
      };

      reader.onerror = () => {
        alert('Gagal membaca file dari sistem.');
      };

      reader.readAsText(file);
    },

    /**
     * Render the cards list with On/Off switches inside #extension-modal-list
     */
    renderList() {
      const container = document.getElementById('extension-modal-list');
      if (!container) return;

      if (!global.CardBuilder) return;
      const allCards = global.CardBuilder.getRegistry();
      const customCards = global.CardBuilder.getAllCustomCards();
      const customIds = new Set(customCards.map(c => c.id));

      if (allCards.length === 0) {
        container.innerHTML = `
          <div class="folder-empty-state">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="var(--color-primary)" opacity="0.4">
              <path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5s-1.12-2.5-2.5-2.5z"/>
            </svg>
            <span class="folder-empty-text">No Extensions Installed</span>
          </div>
        `;
        return;
      }

      container.innerHTML = allCards.map(card => {
        const isCustom = customIds.has(card.id);
        const isEnabled = global.CardBuilder.State.isEnabled(card.id, card.defaultEnabled !== false);
        const badgeText = isCustom ? 'Userscript' : 'Built-in';
        const badgeClass = isCustom ? 'extension-badge-custom' : 'extension-badge-builtin';

        return `
          <div class="extension-manager-row" data-card-id="${card.id}">
            <div class="extension-row-icon-box">
              ${card.icon ? `<span class="material-icons" style="font-size: 20px; color: var(--color-primary);">${escapeHtml(card.icon)}</span>` : `
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5s-1.12-2.5-2.5-2.5z"/>
              </svg>`}
            </div>
            <div class="extension-row-info">
              <div class="extension-row-title-line">
                <span class="extension-row-name">${escapeHtml(card.name || card.id)}</span>
                <span class="extension-badge ${badgeClass}">${badgeText}</span>
              </div>
              <span class="extension-row-desc">${escapeHtml(card.description || '')}</span>
            </div>
            <div class="extension-row-actions">
              ${isCustom ? `
                <button type="button" class="extension-delete-btn" data-delete-id="${card.id}" title="Delete userscript" aria-label="Delete userscript">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                  </svg>
                </button>
              ` : ''}
              <label class="switch-container extension-switch-label" title="${isEnabled ? 'Disable Extension' : 'Enable Extension'}">
                <span class="switch">
                  <input type="checkbox" class="extension-toggle-checkbox" data-card-id="${card.id}" ${isEnabled ? 'checked' : ''}>
                  <span class="slider"></span>
                </span>
              </label>
            </div>
          </div>
        `;
      }).join('');

      // Bind toggle switches
      container.querySelectorAll('.extension-toggle-checkbox').forEach(input => {
        input.addEventListener('change', (e) => {
          const cardId = input.getAttribute('data-card-id');
          const checked = e.target.checked;
          if (cardId && global.CardBuilder) {
            global.CardBuilder.State.setEnabled(cardId, checked);
            global.CardBuilder.syncToFishExtensions();
          }
        });
      });

      // Delete button for userscripts: one click deletes (built-in cards never get this button).
      container.querySelectorAll('.extension-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const cardId = btn.getAttribute('data-delete-id');
          if (cardId && global.CardBuilder) global.CardBuilder.deleteCustomCard(cardId);
        });
      });
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Export globally
  global.ExtensionManager = ExtensionManager;

  // Auto-init on page load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => ExtensionManager.init());
    } else {
      ExtensionManager.init();
    }
  }

})(typeof window !== 'undefined' ? window : globalThis);
