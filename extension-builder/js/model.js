/**
 * Extension Builder - Model: single source of truth + undo/redo + autosave.
 * Canvas, inspector, script editor and codegen are all views of this model.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'oft-ext-builder-v1';
  const MAX_HISTORY = 100;
  const { PALETTE, defaultProps } = global.OFTBuilderPalette;

  const uid = () => 'n' + Math.random().toString(36).slice(2, 9);

  function emptyModel() {
    return {
      meta: { id: 'my_extension', name: 'My Extension', icon: 'extension', description: 'Built with Extension Builder.', category: 'Tools', defaultEnabled: true },
      shared: '',
      nodes: []
    };
  }

  function createNode(type) {
    const def = PALETTE[type];
    const node = { id: uid(), type, props: defaultProps(type), handler: def.handler ? def.handler.body : '' };
    if (def.container) node.children = [];
    return node;
  }

  function cloneNode(node) {
    const c = JSON.parse(JSON.stringify(node));
    (function reid(n) { n.id = uid(); (n.children || []).forEach(reid); })(c);
    return c;
  }

  const Model = {
    data: emptyModel(),
    selectedId: null,
    freshId: null,          // last inserted node id (canvas plays an enter animation once)
    _undo: [],
    _redo: [],
    _listeners: new Set(),

    on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
    _emit(kind) { this._listeners.forEach(fn => fn(kind)); },

    // ---- queries ----
    find(id, list = this.data.nodes, parent = null) {
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (n.id === id) return { node: n, list, index: i, parent };
        if (n.children) {
          const r = this.find(id, n.children, n);
          if (r) return r;
        }
      }
      return null;
    },
    selected() { const r = this.selectedId && this.find(this.selectedId); return r ? r.node : null; },
    isDescendant(ancestorId, id) {
      const a = this.find(ancestorId);
      return !!(a && a.node.children && this.find(id, a.node.children));
    },

    // ---- history ----
    _snapshot() { return JSON.stringify(this.data); },
    checkpoint() {
      this._undo.push(this._snapshot());
      if (this._undo.length > MAX_HISTORY) this._undo.shift();
      this._redo.length = 0;
    },
    undo() {
      if (!this._undo.length) return;
      this._redo.push(this._snapshot());
      this.data = JSON.parse(this._undo.pop());
      if (this.selectedId && !this.find(this.selectedId)) this.selectedId = null;
      this._changed('structure');
    },
    redo() {
      if (!this._redo.length) return;
      this._undo.push(this._snapshot());
      this.data = JSON.parse(this._redo.pop());
      if (this.selectedId && !this.find(this.selectedId)) this.selectedId = null;
      this._changed('structure');
    },
    canUndo() { return this._undo.length > 0; },
    canRedo() { return this._redo.length > 0; },

    // ---- mutations ----
    /** Insert node into `parentId` (null = root) at `index` (default end). */
    add(type, parentId = null, index = null) {
      this.checkpoint();
      const node = createNode(type);
      this._insert(node, parentId, index);
      this.selectedId = node.id;
      this.freshId = node.id;
      this._changed('structure');
      return node;
    },
    _insert(node, parentId, index) {
      let list = this.data.nodes;
      if (parentId) {
        const p = this.find(parentId);
        if (p && p.node.children) list = p.node.children;
      }
      if (index === null || index > list.length) index = list.length;
      list.splice(index, 0, node);
    },
    /** Move existing node to a new parent/index. */
    move(id, parentId, index) {
      const src = this.find(id);
      if (!src) return;
      if (parentId && (parentId === id || this.isDescendant(id, parentId))) return;
      this.checkpoint();
      src.list.splice(src.index, 1);
      let list = this.data.nodes;
      if (parentId) { const p = this.find(parentId); if (p && p.node.children) list = p.node.children; }
      if (index === null || index > list.length) index = list.length;
      list.splice(index, 0, src.node);
      this._changed('structure');
    },
    remove(id) {
      const r = this.find(id);
      if (!r) return;
      this.checkpoint();
      r.list.splice(r.index, 1);
      if (this.selectedId === id || this.isDescendant(id, this.selectedId)) this.selectedId = null;
      this._changed('structure');
    },
    duplicate(id) {
      const r = this.find(id);
      if (!r) return;
      this.checkpoint();
      const copy = cloneNode(r.node);
      r.list.splice(r.index + 1, 0, copy);
      this.selectedId = copy.id;
      this.freshId = copy.id;
      this._changed('structure');
    },
    nudge(id, dir) {
      const r = this.find(id);
      if (!r) return;
      const to = r.index + dir;
      if (to < 0 || to >= r.list.length) return;
      this.checkpoint();
      const [n] = r.list.splice(r.index, 1);
      r.list.splice(to, 0, n);
      this._changed('structure');
    },
    select(id) { this.selectedId = id; this._emit('selection'); },

    /** Property edits are coalesced into one undo step per key burst. */
    setProp(id, key, value) {
      const r = this.find(id);
      if (!r) return;
      this._coalesce('prop:' + id + ':' + key);
      r.node.props[key] = value;
      this._changed('props', id);
    },
    setHandler(id, code) {
      const r = this.find(id);
      if (!r) return;
      this._coalesce('handler:' + id);
      r.node.handler = code;
      this._changed('script', id);
    },
    setShared(code) { this._coalesce('shared'); this.data.shared = code; this._changed('script'); },
    setMeta(key, value) { this._coalesce('meta:' + key); this.data.meta[key] = value; this._changed('meta'); },

    _lastCoalesce: null, _coalesceTimer: null,
    _coalesce(token) {
      if (this._lastCoalesce !== token) this.checkpoint();
      this._lastCoalesce = token;
      clearTimeout(this._coalesceTimer);
      this._coalesceTimer = setTimeout(() => { this._lastCoalesce = null; }, 900);
    },

    load(data) {
      this.checkpoint();
      this.data = data;
      this.selectedId = null;
      this._changed('structure');
    },
    reset() { this.load(emptyModel()); },

    _changed(kind, id) {
      this._save();
      this._emit(kind, id);
    },
    _save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (_) { /* quota: ignore */ } },
    restore() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) { const d = JSON.parse(raw); if (d && d.meta && Array.isArray(d.nodes)) this.data = d; }
      } catch (_) { /* ignore corrupt */ }
    }
  };

  global.OFTBuilderModel = Model;
})(window);
