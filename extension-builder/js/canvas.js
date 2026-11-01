/**
 * Extension Builder - Canvas: WYSIWYG render, drag & drop (Pointer Events), pinch/pan/zoom (multi-touch).
 * Rendering reuses the real CardBuilder ui via codegen.nodeExpr() so the canvas looks exactly like the editor.
 */
(function (global) {
  'use strict';

  const Model = global.OFTBuilderModel;
  const { PALETTE } = global.OFTBuilderPalette;
  const Codegen = global.OFTBuilderCodegen;
  const Preview = global.OFTBuilderPreview;

  const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;
  const MIN_SCALE = 0.4, MAX_SCALE = 2.5, DRAG_THRESHOLD = 6;

  let viewport, stage, indicator, ghost;
  const view = { x: 16, y: 76, scale: 1 };
  const pointers = new Map();           // active pointers on the viewport (multi-touch)
  let gesture = null;                   // { type:'pan'|'pinch', ... }
  let drag = null;                      // active node/palette drag
  let suppressClick = false;

  // ------------------------------------------------------------------ render
  let frame = null;   // replica of the editor's Extensions panel; nodes render into frame.body

  function render() {
    const focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.cv-node') : null;
    const focusId = focused && stage.contains(focused) ? focused.dataset.id : null;
    stage.innerHTML = '';
    frame = global.OFTBuilderFrame.create(Model.data.meta);
    stage.appendChild(frame.root);
    if (!Model.data.nodes.length) {
      const empty = document.createElement('div');
      empty.className = 'cv-empty';
      empty.innerHTML = `${icon('drag_indicator')}<p>Drag components here<br><small>or tap a component to add it</small></p>`;
      frame.body.appendChild(empty);
    } else {
      renderList(Model.data.nodes, frame.body);
    }
    Model.freshId = null;
    if (focusId) { const again = stage.querySelector(`.cv-node[data-id="${focusId}"]`); if (again) again.focus({ preventScroll: true }); }
  }

  function renderList(nodes, parentEl) {
    nodes.forEach((n, i) => {
      const el = renderNode(n);
      if (i > 0) el.classList.add('cv-not-first');   // each node mounts in its own wrapper, so emulate :first-child sibling rules
      parentEl.appendChild(el);
    });
  }

  function renderNode(node) {
    const def = PALETTE[node.type];
    const el = document.createElement('div');
    el.className = 'cv-node' + (node.id === Model.selectedId ? ' is-selected' : '') + (def.container ? ' is-container' : '');
    el.dataset.id = node.id;
    el.dataset.type = node.type;
    // keyboard + screen-reader access: Tab to focus, Enter/Space to select, Alt+arrows to move, Ctrl/Cmd+D to duplicate
    el.tabIndex = 0;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-roledescription', 'component');
    el.setAttribute('aria-label', `${def.label}${node.props && (node.props.label || node.props.title || node.props.text) ? ': ' + (node.props.label || node.props.title || node.props.text) : ''}`);
    if (node.id === Model.selectedId) el.setAttribute('aria-current', 'true');
    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return;            // ignore keys typed inside nested controls
      const k = e.key;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); Model.select(node.id); }
      else if (e.altKey && (k === 'ArrowUp' || k === 'ArrowLeft')) { e.preventDefault(); Model.nudge(node.id, -1); }
      else if (e.altKey && (k === 'ArrowDown' || k === 'ArrowRight')) { e.preventDefault(); Model.nudge(node.id, 1); }
      else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd') { e.preventDefault(); Model.duplicate(node.id); }
    });
    if (node.id === Model.freshId) el.classList.add('is-new');

    el.appendChild(renderHandle(node, def));

    if (def.container) {
      const kids = document.createElement('div');
      // real classes from card-builder (toolbox-grid / form-row) so spacing matches the editor exactly
      kids.className = 'cv-children' + (node.type === 'grid' ? ` toolbox-grid col-${Math.max(1, Number(node.props.cols) || 3)}` : ' form-row');
      if (!node.children.length) kids.classList.add('is-empty');
      renderList(node.children, kids);
      el.appendChild(kids);
    } else {
      const body = document.createElement('div');
      body.className = 'cv-body';
      try { Preview.mountExpr(Codegen.nodeExpr(node, false), body); }
      catch (err) { body.innerHTML = `<div class="cv-error">${icon('error_outline')} ${String(err.message).replace(/</g, '&lt;')}</div>`; }
      el.appendChild(body);
    }
    return el;
  }

  function renderHandle(node, def) {
    const h = document.createElement('div');
    h.className = 'cv-handle';
    h.innerHTML = `
      <span class="cv-grip" title="Drag to move (keyboard: Alt+arrows)" aria-hidden="true">${icon('drag_indicator')}</span>
      <span class="cv-type">${def.label}</span>
      <span class="cv-actions">
        <button type="button" data-act="up" title="Move up" aria-label="Move up">${icon('arrow_upward')}</button>
        <button type="button" data-act="down" title="Move down" aria-label="Move down">${icon('arrow_downward')}</button>
        <button type="button" data-act="dup" title="Duplicate" aria-label="Duplicate">${icon('content_copy')}</button>
        <button type="button" data-act="del" title="Delete" aria-label="Delete">${icon('delete')}</button>
      </span>`;
    h.querySelector('.cv-grip').addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      Model.select(node.id);
      startDrag({ kind: 'move', id: node.id, label: def.label }, e);
    });
    h.querySelector('.cv-actions').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      e.stopPropagation();
      ({ up: () => Model.nudge(node.id, -1), down: () => Model.nudge(node.id, 1), dup: () => Model.duplicate(node.id), del: () => Model.remove(node.id) })[b.dataset.act]();
    });
    return h;
  }

  function updateSelection() {
    stage.querySelectorAll('.cv-node.is-selected').forEach(e => { e.classList.remove('is-selected'); e.removeAttribute('aria-current'); });
    if (Model.selectedId) {
      const el = stage.querySelector(`.cv-node[data-id="${Model.selectedId}"]`);
      if (el) { el.classList.add('is-selected'); el.setAttribute('aria-current', 'true'); }
    }
  }

  // --------------------------------------------------------------- drag & drop
  /** Start dragging a palette item ({kind:'new', type}) or an existing node ({kind:'move', id}). */
  function startDrag(payload, e) {
    if (drag) return;
    drag = { payload, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false, drop: null };
    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('keydown', onDragKey);
  }

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.active = true;
      ghost.textContent = drag.payload.label || '';
      ghost.hidden = false;
      document.body.classList.add('is-dragging');
    }
    e.preventDefault();
    ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
    drag.drop = computeDrop(e.clientX, e.clientY);
    showIndicator(drag.drop);
  }

  function onDragEnd(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { payload, drop, active } = drag;
    endDrag();
    if (!active || !drop) return;
    if (payload.kind === 'new') Model.add(payload.type, drop.parentId, drop.index);
    else Model.move(payload.id, drop.parentId, drop.index);
  }

  function cancelDrag() { endDrag(); }
  function onDragKey(e) { if (e.key === 'Escape') endDrag(); }

  function endDrag() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', cancelDrag);
    window.removeEventListener('keydown', onDragKey);
    document.body.classList.remove('is-dragging');
    ghost.hidden = true;
    indicator.hidden = true;
    stage.querySelectorAll('.cv-drop-into').forEach(e => e.classList.remove('cv-drop-into'));
    drag = null;
  }

  /** Resolve {parentId, index, rect, axis} for a viewport point; null when outside the canvas. */
  function computeDrop(x, y) {
    const vr = viewport.getBoundingClientRect();
    if (x < vr.left || x > vr.right || y < vr.top || y > vr.bottom) return null;
    const movingId = drag.payload.kind === 'move' ? drag.payload.id : null;
    const inMoving = (el) => movingId && el.closest(`.cv-node[data-id="${movingId}"]`);

    const hit = document.elementsFromPoint(x, y).find(el => el.classList && el.classList.contains('cv-node') && !inMoving(el));
    const rootEnd = () => ({ parentId: null, index: Model.data.nodes.filter(n => n.id !== movingId).length, rect: lastRect(frame.body, movingId), axis: 'v', after: true });
    if (!hit) return rootEnd();

    const found = Model.find(hit.dataset.id);
    const r = hit.getBoundingClientRect();
    const def = PALETTE[found.node.type];
    const edge = Math.min(14, r.height * 0.25);

    if (def.container && y > r.top + edge && y < r.bottom - edge) {
      return dropIntoContainer(hit, found.node, x, y, movingId);
    }
    // before / after the hit node inside its parent list
    const horizontal = !!(found.parent && (found.parent.type === 'grid' || found.parent.type === 'formRow'));
    const after = horizontal ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
    const ids = found.list.map(n => n.id).filter(id => id !== movingId);
    const index = ids.indexOf(found.node.id) + (after ? 1 : 0);
    return { parentId: found.parent ? found.parent.id : null, index, rect: r, axis: horizontal ? 'h' : 'v', after };
  }

  function dropIntoContainer(el, node, x, y, movingId) {
    const kidsEl = el.querySelector(':scope > .cv-children');
    const wrappers = Array.from(kidsEl.children).filter(c => c.classList.contains('cv-node') && c.dataset.id !== movingId);
    let index = wrappers.length;
    let rect = null, after = true;
    for (let i = 0; i < wrappers.length; i++) {
      const cr = wrappers[i].getBoundingClientRect();
      if (y < cr.top || (y <= cr.bottom && x < cr.left + cr.width / 2)) { index = i; rect = cr; after = false; break; }
    }
    if (!rect && wrappers.length) rect = wrappers[wrappers.length - 1].getBoundingClientRect();
    if (!wrappers.length) rect = kidsEl.getBoundingClientRect();
    return { parentId: node.id, index, rect, axis: node.type === 'grid' || node.type === 'formRow' ? 'h' : 'v', after, container: el };
  }

  function lastRect(parent, movingId) {
    const kids = Array.from(parent.children).filter(c => c.classList.contains('cv-node') && c.dataset.id !== movingId);
    return kids.length ? kids[kids.length - 1].getBoundingClientRect() : parent.getBoundingClientRect();
  }

  function showIndicator(drop) {
    stage.querySelectorAll('.cv-drop-into').forEach(e => e.classList.remove('cv-drop-into'));
    if (!drop || !drop.rect) { indicator.hidden = true; return; }
    if (drop.container) drop.container.classList.add('cv-drop-into');
    const r = drop.rect;
    indicator.hidden = false;
    if (drop.axis === 'h') {
      const x = drop.after ? r.right + 2 : r.left - 2;
      Object.assign(indicator.style, { left: x - 1.5 + 'px', top: r.top + 'px', width: '3px', height: r.height + 'px' });
    } else {
      const y = drop.after ? r.bottom + 2 : r.top - 2;
      Object.assign(indicator.style, { left: r.left + 'px', top: y - 1.5 + 'px', width: r.width + 'px', height: '3px' });
    }
  }

  // ------------------------------------------------------ pinch / pan / zoom
  function applyView() {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    const z = document.getElementById('cv-zoom-label');
    if (z) z.textContent = Math.round(view.scale * 100) + '%';
  }

  function zoomAt(cx, cy, factor) {
    const vr = viewport.getBoundingClientRect();
    const px = cx - vr.left, py = cy - vr.top;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    const k = next / view.scale;
    view.x = px - (px - view.x) * k;
    view.y = py - (py - view.y) * k;
    view.scale = next;
    applyView();
  }

  function resetView() {
    const vr = viewport.getBoundingClientRect();
    view.scale = 1;
    view.x = Math.max(16, (vr.width - stage.offsetWidth) / 2);
    view.y = 76;                                   // clear the floating bar
    applyView();
  }

  function pinchMetrics() {
    const [a, b] = Array.from(pointers.values());
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  function onViewportDown(e) {
    if (drag || e.target.closest('.cv-handle')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    suppressClick = false;
    if (pointers.size === 2) {
      const m = pinchMetrics();
      gesture = { type: 'pinch', dist: m.dist, cx: m.cx, cy: m.cy };
      suppressClick = true;
    } else if (pointers.size === 1) {
      // Mouse pans only from empty background; touch/pen can pan from anywhere (taps still select).
      const onNode = !!e.target.closest('.cv-node');
      const canPan = e.pointerType !== 'mouse' || !onNode || e.button === 1;
      gesture = canPan ? { type: 'pan', x: e.clientX, y: e.clientY, moved: false } : null;
    }
  }

  function onViewportMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p || drag) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!gesture) return;
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const m = pinchMetrics();
      zoomAt(m.cx, m.cy, m.dist / gesture.dist);     // pinch zoom around the midpoint
      view.x += m.cx - gesture.cx;                    // two-finger pan
      view.y += m.cy - gesture.cy;
      applyView();
      gesture.dist = m.dist; gesture.cx = m.cx; gesture.cy = m.cy;
    } else if (gesture.type === 'pan') {
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      gesture.moved = true; suppressClick = true;
      view.x += dx; view.y += dy;
      gesture.x = e.clientX; gesture.y = e.clientY;
      applyView();
    }
  }

  function onViewportUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 1 && gesture && gesture.type === 'pinch') {
      const rest = Array.from(pointers.values())[0];
      gesture = { type: 'pan', x: rest.x, y: rest.y, moved: true };   // continue as pan with the remaining finger
    } else if (!pointers.size) {
      gesture = null;
    }
  }

  let lastTap = 0;
  function onViewportClick(e) {
    if (suppressClick) { suppressClick = false; return; }
    const nodeEl = e.target.closest('.cv-node');
    Model.select(nodeEl ? nodeEl.dataset.id : null);
    if (!nodeEl) {                                    // double-tap / double-click on background = reset view
      const now = Date.now();
      if (now - lastTap < 320) resetView();
      lastTap = now;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    else { view.x -= e.shiftKey ? e.deltaY : e.deltaX; view.y -= e.shiftKey ? 0 : e.deltaY; applyView(); }
  }

  // --------------------------------------------------------------------- init
  function init(opts) {
    viewport = opts.viewport; stage = opts.stage; indicator = opts.indicator; ghost = opts.ghost;
    viewport.addEventListener('pointerdown', onViewportDown);
    viewport.addEventListener('pointermove', onViewportMove);
    viewport.addEventListener('pointerup', onViewportUp);
    viewport.addEventListener('pointercancel', onViewportUp);
    viewport.addEventListener('click', onViewportClick);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    const zoomBy = (f) => { const r = viewport.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); };
    document.getElementById('cv-zoom-in').addEventListener('click', () => zoomBy(1.2));
    document.getElementById('cv-zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
    document.getElementById('cv-zoom-reset').addEventListener('click', resetView);

    Model.on((kind) => {
      if (kind === 'selection') updateSelection();
      else if (kind === 'meta') { if (frame) frame.update(Model.data.meta); }   // plugin name/icon live in the card header
      else if (kind !== 'script') render();
    });
    render();
    resetView();
  }

  global.OFTBuilderCanvas = { init, render, startDrag, resetView };
})(window);
