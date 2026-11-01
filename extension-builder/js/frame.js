/**
 * Extension Builder - Frame: a 1:1 replica of the editor's Extensions panel
 * ("Extensions" header -> .extension-card-list -> .extension-card with icon + plugin name header -> .extension-card-body).
 * Markup and class names mirror js/extensions/extensions.js (renderAll) so css/panels/extensions.css styles it identically.
 * Used by both the canvas (editing) and the live preview.
 */
(function (global) {
  'use strict';

  const PUZZLE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5s-1.12-2.5-2.5-2.5z"/></svg>';

  /** Same icon rules as extensions.js: raw <svg>, fticon-* class, or Material Icons ligature. */
  function iconNode(icon) {
    if (!icon) return null;
    if (icon.startsWith('<svg')) {
      const box = document.createElement('span');
      box.innerHTML = icon;
      return box;
    }
    if (icon.startsWith('fticon-')) {
      const i = document.createElement('i');
      i.className = `fticon ${icon}`;
      i.setAttribute('aria-hidden', 'true');
      return i;
    }
    const s = document.createElement('span');
    s.className = 'material-icons';
    s.setAttribute('aria-hidden', 'true');
    s.textContent = icon;
    return s;
  }

  function create(meta) {
    const root = document.createElement('div');
    root.className = 'ext-frame';

    const panelHeader = document.createElement('div');
    panelHeader.className = 'ext-frame-header';
    panelHeader.innerHTML = `<span class="ext-frame-title">${PUZZLE}<span>Extensions</span></span>`;

    const list = document.createElement('div');
    list.className = 'extension-card-list ext-frame-list';

    const card = document.createElement('div');
    card.className = 'extension-card';

    const header = document.createElement('div');
    header.className = 'extension-card-header';
    const titleGrp = document.createElement('div');
    titleGrp.className = 'extension-card-title-group';
    const title = document.createElement('span');
    title.className = 'extension-card-title';
    titleGrp.appendChild(title);
    header.appendChild(titleGrp);

    const body = document.createElement('div');
    body.className = 'extension-card-body';

    card.appendChild(header);
    card.appendChild(body);
    list.appendChild(card);
    root.appendChild(panelHeader);
    root.appendChild(list);

    /** Refresh icon + plugin name from the model's meta. */
    function update(m) {
      const old = titleGrp.firstElementChild !== title ? titleGrp.firstElementChild : null;
      if (old) old.remove();
      const ic = iconNode(m.icon);
      if (ic) titleGrp.insertBefore(ic, title);
      title.textContent = m.name || m.id || 'Untitled';
    }
    update(meta);

    return { root, body, update };
  }

  global.OFTBuilderFrame = { create };
})(window);
