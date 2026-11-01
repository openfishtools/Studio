/**
 * Extension Builder - Mock ctx used by the canvas to render components (handlers never run there).
 * The real behaviour is tested in the Preview view (live-preview.js), which embeds the actual editor.
 */
(function (global) {
  'use strict';

  function createMockCtx(log) {
    const store = {};
    const fmt = (a) => { try { return typeof a === 'string' ? JSON.stringify(a) : (typeof a === 'function' ? 'fn' : JSON.stringify(a)); } catch (_) { return String(a); } };

    // Generic recursive proxy: ctx.foo.bar(x) logs and returns undefined; property reads keep chaining.
    const chain = (path) => new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return chain(path + '.' + String(prop));
      },
      apply(_t, _this, args) {
        log('call', `${path}(${args.map(fmt).join(', ')})`);
        return undefined;
      }
    });

    const call = (path, ret) => (...args) => { log('call', `${path}(${args.map(fmt).join(', ')})`); return typeof ret === 'function' ? ret(...args) : ret; };

    const dims = () => {
      const d = { width: 1920, height: 1080, fps: 30, pps: 100, currentTime: 0 };
      d[Symbol.iterator] = function* () { yield d.width; yield d.height; };
      return d;
    };

    const overrides = {
      toast: (m, isErr) => log(isErr ? 'error' : 'toast', String(m)),
      showToast: (m, isErr) => log(isErr ? 'error' : 'toast', String(m)),
      notify: (m, isErr) => log(isErr ? 'error' : 'toast', String(m)),
      storage: {
        get: (k, d) => (k in store ? store[k] : d),
        set: (k, v) => { store[k] = v; log('call', `ctx.storage.set(${fmt(k)}, ${fmt(v)})`); }
      },
      project: { getDimensions: dims, commit: call('ctx.project.commit') },
      history: { snapshot: call('ctx.history.snapshot'), push: call('ctx.history.push') },
      layers: {
        getAll: call('ctx.layers.getAll', () => []),
        getSelected: call('ctx.layers.getSelected', () => []),
        getActive: call('ctx.layers.getActive', null),
        isAudio: () => false
      },
      timeline: {
        getFps: () => 30, getFPS: () => 30, getPps: () => 100, getPPS: () => 100,
        getCurrentTime: () => 0, getPlayhead: () => 0,
        getBeatmarks: () => [], getMarkers: () => []
      }
    };

    return new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        if (prop in overrides) {
          const v = overrides[prop];
          if (typeof v === 'object') {
            // Merge defined methods with the generic chain for everything else.
            return new Proxy(v, { get: (o, k) => (k in o ? o[k] : (typeof k === 'symbol' ? undefined : chain(`ctx.${prop}.${String(k)}`))) });
          }
          return v;
        }
        return chain('ctx.' + String(prop));
      }
    });
  }

  /** Mount a single-node expression (handlers stripped) - used by the canvas. */
  function mountExpr(expr, host) {
    const def = { id: '_canvas', build: new Function('ui', 'ctx', expr + ';') };
    global.CardBuilder.mount(def, host, createMockCtx(() => {}));
  }

  global.OFTBuilderPreview = { mountExpr, createMockCtx };
})(window);
