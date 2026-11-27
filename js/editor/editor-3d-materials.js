/**
 * OpenFishTools Studio - Advance 3D Environment Map & Unified 3-Column Texture Controller
 * Manages:
 * 1. Project Settings -> 3D Engine -> Environment Map (Media Pool Mirror Popover + Upload)
 * 2. Unified 3-Column Texture Drawer (#layer-drawer-texture-view)
 *    - Left: Back
 *    - Center: Pane 1 (Live 3D Material Sphere Pool) <-> Pane 2 (Per-Slot Parameter Settings)
 *    - Right: 2-button mode rail (Spheres / Parameters)
 * 3. Per-slot material & media texture caching (zero per-frame allocations)
 */
(function () {
  'use strict';

  const DEFAULT_SLOT = {
    id: 'surface',
    name: 'Surface',
    surfaceMode: 'inherit', // 'inherit' | 'solid' | 'media'
    color: null,
    mediaId: null,
    acceptsLights: true,
    glossy: 0,
    metallic: 0,
    roughness: 50,
    diffuse: 100,
    specular: 50,
    envReflection: 100
  };

  const SHAPE_FACE_TEMPLATES = {
    '3d_box': [
      { id: 'front', name: 'Front' },
      { id: 'back', name: 'Back' },
      { id: 'top', name: 'Top' },
      { id: 'bottom', name: 'Bottom' },
      { id: 'left', name: 'Left' },
      { id: 'right', name: 'Right' }
    ],
    '3d_cylinder': [
      { id: 'body', name: 'Body' },
      { id: 'top', name: 'Top Cap' },
      { id: 'bottom', name: 'Bottom Cap' }
    ],
    '3d_cone': [
      { id: 'side', name: 'Side' },
      { id: 'base', name: 'Base' }
    ],
    '3d_pyramid': [
      { id: 'side', name: 'Sides' },
      { id: 'base', name: 'Base' }
    ]
  };

  let _activeSlotIndex = 0;
  let _activeTexTab = 'spheres';
  let _popoverMode = 'env'; // 'env' | 'slot'
  let _activeEnvImg = null;
  let _activeEnvPixels = null; // { w, h, data }
  let _spherePreviewRaf = null;

  // Caches keyed by mediaId
  const _mediaImgCache = new Map();       // mediaId -> HTMLImageElement
  const _mediaLoadingSet = new Set();     // mediaId currently fetching/decoding
  const _thumbPixelsCache = new WeakMap(); // HTMLImageElement -> { w, h, data }
  const _sphereLutCache = new Map();      // size -> Float32Array / LUT

  function getShapeKey(layer) {
    if (!layer) return '';
    if (typeof layer.shapeType === 'string' && layer.shapeType.startsWith('3d_')) {
      return layer.shapeType === '3d_triangle' ? '3d_pyramid' : layer.shapeType;
    }
    if (Array.isArray(layer.effects)) {
      const fx = layer.effects.find(f => f && !f.disabled && (
        f.type === 'box_3d' || f.type === '3d_box' ||
        f.type === 'cylinder_3d' || f.type === '3d_cylinder' ||
        f.type === 'cone_3d' || f.type === '3d_cone' ||
        f.type === 'pyramid_3d' || f.type === '3d_pyramid' ||
        f.type === 'sphere_3d' || f.type === '3d_sphere' ||
        f.type === 'torus_3d' || f.type === '3d_torus'
      ));
      if (fx) {
        if (fx.type === 'box_3d' || fx.type === '3d_box') return '3d_box';
        if (fx.type === 'cylinder_3d' || fx.type === '3d_cylinder') return '3d_cylinder';
        if (fx.type === 'cone_3d' || fx.type === '3d_cone') return '3d_cone';
        if (fx.type === 'pyramid_3d' || fx.type === '3d_pyramid') return '3d_pyramid';
        if (fx.type === 'sphere_3d' || fx.type === '3d_sphere') return '3d_sphere';
        if (fx.type === 'torus_3d' || fx.type === '3d_torus') return '3d_torus';
      }
    }
    return '';
  }

  function makeSlot(overrides) {
    return Object.assign({}, DEFAULT_SLOT, overrides || {});
  }

  function ensureLayerMaterialSlots(layer) {
    if (!layer) return [];
    if (!Array.isArray(layer.materialSlots) || layer.materialSlots.length === 0) {
      const legacy = (layer.materialOptions && typeof layer.materialOptions === 'object') ? layer.materialOptions : {};
      layer.materialSlots = [makeSlot({
        id: 'surface',
        name: 'Surface',
        acceptsLights: legacy.acceptsLights !== false,
        diffuse: typeof legacy.diffuse === 'number' ? legacy.diffuse : 100,
        specular: typeof legacy.specular === 'number' ? legacy.specular : 50,
        roughness: typeof legacy.roughness === 'number' ? legacy.roughness : 50,
        glossy: typeof legacy.glossy === 'number' ? legacy.glossy : 0,
        metallic: typeof legacy.metallic === 'number' ? legacy.metallic : 0,
        envReflection: typeof legacy.envReflection === 'number' ? legacy.envReflection : 100
      })];
    }
    return layer.materialSlots;
  }

  function mirrorSlot0ToMaterialOptions(layer) {
    if (!layer || !Array.isArray(layer.materialSlots) || layer.materialSlots.length === 0) return;
    const s0 = layer.materialSlots[0];
    layer.materialOptions = {
      acceptsLights: s0.acceptsLights !== false,
      diffuse: typeof s0.diffuse === 'number' ? s0.diffuse : 100,
      specular: typeof s0.specular === 'number' ? s0.specular : 50,
      roughness: typeof s0.roughness === 'number' ? s0.roughness : 50,
      glossy: typeof s0.glossy === 'number' ? s0.glossy : 0,
      metallic: typeof s0.metallic === 'number' ? s0.metallic : 0,
      envReflection: typeof s0.envReflection === 'number' ? s0.envReflection : 100
    };
  }

  function getSelectedLayer() {
    const ps = window.currentProjectState;
    if (!ps || !Array.isArray(ps.layers) || !window.selectedLayerId) return null;
    return ps.layers.find(l => l && l.id === window.selectedLayerId) || null;
  }

  function hexToRgb(hex) {
    let c = (hex || '#98ce7b').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16);
    if (isNaN(num)) return { r: 152, g: 206, b: 123 };
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function isImageMediaItem(item) {
    if (!item) return false;
    if (item.type === 'audio' || item.type === 'video' || item.type === 'precomp' || item.type === '3d_model') return false;
    if (item.dataUrl && (item.dataUrl.startsWith('data:video') || item.dataUrl.startsWith('data:audio'))) return false;
    if (item.name && /\.(mp4|webm|mov|mkv|mp3|wav|ogg|m4a|aac|flac)$/i.test(item.name)) return false;
    return Boolean(item.dataUrl || item.thumbUrl);
  }

  async function fetchProjectImageMedia() {
    const ps = window.currentProjectState;
    const projectId = ps ? ps.id : '';
    let items = [];
    try {
      if (window.FishDatabase && typeof window.FishDatabase.getProjectMedia === 'function' && projectId) {
        items = await window.FishDatabase.getProjectMedia(projectId);
      }
    } catch (_) {
      items = [];
    }
    if (window._activeMediaMap) {
      window._activeMediaMap.forEach(item => {
        if (item && (!projectId || item.projectId === projectId) && !items.some(m => m.id === item.id)) {
          items.push(item);
        }
      });
    }
    return items.filter(isImageMediaItem);
  }

  function decodeAndCacheMediaImage(mediaId, srcUrl, onReady) {
    if (!mediaId || !srcUrl) return null;
    const existing = _mediaImgCache.get(mediaId);
    if (existing && existing.complete && existing.naturalWidth > 0) {
      if (typeof onReady === 'function') onReady(existing);
      return existing;
    }
    const img = new Image();
    if (/^https?:/i.test(srcUrl)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      _mediaImgCache.set(mediaId, img);
      _mediaLoadingSet.delete(mediaId);
      if (typeof onReady === 'function') onReady(img);
    };
    img.onerror = () => {
      _mediaLoadingSet.delete(mediaId);
    };
    img.src = srcUrl;
    return null;
  }

  function getMaterialMediaImage(mediaId) {
    if (!mediaId) return null;
    const cached = _mediaImgCache.get(mediaId);
    if (cached && cached.complete && cached.naturalWidth > 0) return cached;
    // Known-missing media: never re-hit IndexedDB every frame from the render hot path
    if (window._missing3DMediaIds && window._missing3DMediaIds.has(mediaId)) return null;
    if (!_mediaLoadingSet.has(mediaId)) {
      _mediaLoadingSet.add(mediaId);
      // Fast synchronous check in _activeMediaMap
      const mapItem = window._activeMediaMap ? window._activeMediaMap.get(mediaId) : null;
      if (mapItem && (mapItem.dataUrl || mapItem.thumbUrl)) {
        decodeAndCacheMediaImage(mediaId, mapItem.dataUrl || mapItem.thumbUrl, () => {
          if (typeof window.redrawComposition === 'function') window.redrawComposition();
          scheduleSpherePreviewRefresh();
        });
      } else {
        fetchProjectImageMedia().then(items => {
          const found = items.find(m => m.id === mediaId);
          if (found && (found.dataUrl || found.thumbUrl)) {
            decodeAndCacheMediaImage(mediaId, found.dataUrl || found.thumbUrl, () => {
              if (typeof window.redrawComposition === 'function') window.redrawComposition();
              scheduleSpherePreviewRefresh();
            });
          } else {
            _mediaLoadingSet.delete(mediaId);
            if (!String(mediaId).startsWith('mtex_')) {
              if (!window._missing3DMediaIds) window._missing3DMediaIds = new Set();
              window._missing3DMediaIds.add(mediaId);
            }
          }
        }).catch(() => {
          _mediaLoadingSet.delete(mediaId);
        });
      }
    }
    return null;
  }
  window.getMaterialMediaImage = getMaterialMediaImage;

  function registerMaterialTextureDataUrl(mediaId, dataUrl) {
    if (!mediaId || !dataUrl) return;
    if (window._missing3DMediaIds) window._missing3DMediaIds.delete(mediaId);
    decodeAndCacheMediaImage(mediaId, dataUrl, () => {
      window._assetReadyVersion = (window._assetReadyVersion | 0) + 1;
      if (window.PreviewCacheManager && typeof window.PreviewCacheManager.invalidateAll === 'function') {
        window.PreviewCacheManager.invalidateAll();
      }
      if (typeof window.redrawComposition === 'function') window.redrawComposition();
      scheduleSpherePreviewRefresh();
    });
  }
  window.registerMaterialTextureDataUrl = registerMaterialTextureDataUrl;

  function sampleImagePixels(img, w, h) {
    if (!img || !img.complete || !(img.naturalWidth > 0)) return null;
    const cached = _thumbPixelsCache.get(img);
    if (cached && cached.w === w && cached.h === h) return cached;
    try {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const out = { w, h, data };
      _thumbPixelsCache.set(img, out);
      return out;
    } catch (_) {
      return null;
    }
  }

  // =========================================================================
  // 1. ENVIRONMENT MAP SYNC & TRIGGER UI
  // =========================================================================
  const DEFAULT_ENV_PRESETS = Array.from({ length: 15 }, (_, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    return {
      id: `builtin_env_${num}`,
      name: `Basic ${num}`,
      url: `assets/environments/Basic_2K_${num}.jpg`
    };
  });

  function getBuiltinEnvPreset(mediaId) {
    if (!mediaId || typeof mediaId !== 'string' || !mediaId.startsWith('builtin_env_')) return null;
    return DEFAULT_ENV_PRESETS.find(p => p.id === mediaId) || null;
  }

  let _envPopoverTab = 'presets'; // 'presets' | 'media'

  function syncEnvironmentPickerTrigger(mediaId, mediaName, thumbSrc) {
    const btn = document.getElementById('btn-settings-environment-picker');
    const lbl = document.getElementById('env-picker-trigger-label');
    const thumb = document.getElementById('env-picker-trigger-thumb');
    if (!btn) return;

    const builtin = getBuiltinEnvPreset(mediaId);
    const resolvedName = builtin ? builtin.name : (mediaName || '');
    const resolvedThumb = thumbSrc || (builtin ? builtin.url : '');

    btn.dataset.mediaId = mediaId || '';
    btn.dataset.mediaName = resolvedName;
    if (lbl) {
      lbl.textContent = mediaId ? (resolvedName || 'Environment') : 'None';
    }
    if (thumb) {
      thumb.innerHTML = '';
      if (mediaId && resolvedThumb) {
        const img = document.createElement('img');
        img.src = resolvedThumb;
        img.alt = resolvedName || 'Environment';
        thumb.appendChild(img);
      } else if (mediaId) {
        const cached = _mediaImgCache.get(mediaId);
        if (cached && cached.src) {
          const img = document.createElement('img');
          img.src = cached.src;
          img.alt = resolvedName || 'Environment';
          thumb.appendChild(img);
        } else {
          fetchProjectImageMedia().then(items => {
            const found = items.find(m => m.id === mediaId);
            if (found && btn.dataset.mediaId === mediaId) {
              const src = found.thumbUrl || found.dataUrl;
              if (src) {
                thumb.innerHTML = '';
                const img = document.createElement('img');
                img.src = src;
                img.alt = found.name || 'Environment';
                thumb.appendChild(img);
              }
              if (lbl && found.name) lbl.textContent = found.name;
            }
          }).catch(() => {});
        }
      }
    }
    if (typeof window.updateProjectSettingsSummaries === 'function') {
      window.updateProjectSettingsSummaries();
    }
  }
  window.syncEnvironmentPickerTrigger = syncEnvironmentPickerTrigger;

  function applyDecodedEnvironmentImage(img) {
    _activeEnvImg = img || null;
    _activeEnvPixels = img ? sampleImagePixels(img, 64, 32) : null;
    if (window.FishToolEngine && typeof window.FishToolEngine.setEnvironmentImage === 'function') {
      window.FishToolEngine.setEnvironmentImage(_activeEnvImg);
    }
    scheduleSpherePreviewRefresh();
    if (typeof window.redrawComposition === 'function') {
      window.redrawComposition();
    }
  }

  function syncProjectEnvironmentTexture() {
    const ps = window.currentProjectState;
    const envId = ps ? (ps.environmentMediaId || null) : null;
    if (!envId) {
      applyDecodedEnvironmentImage(null);
      return;
    }
    const cached = _mediaImgCache.get(envId);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      applyDecodedEnvironmentImage(cached);
      return;
    }
    const builtin = getBuiltinEnvPreset(envId);
    if (builtin) {
      decodeAndCacheMediaImage(builtin.id, builtin.url, (img) => {
        if (window.currentProjectState && window.currentProjectState.environmentMediaId === envId) {
          applyDecodedEnvironmentImage(img);
        }
      });
      return;
    }
    fetchProjectImageMedia().then(items => {
      const found = items.find(m => m.id === envId);
      if (found && (found.dataUrl || found.thumbUrl)) {
        decodeAndCacheMediaImage(envId, found.dataUrl || found.thumbUrl, (img) => {
          if (window.currentProjectState && window.currentProjectState.environmentMediaId === envId) {
            applyDecodedEnvironmentImage(img);
          }
        });
      } else {
        applyDecodedEnvironmentImage(null);
      }
    }).catch(() => {
      applyDecodedEnvironmentImage(null);
    });
  }
  window.syncProjectEnvironmentTexture = syncProjectEnvironmentTexture;

  function persistEnvironmentChoiceImmediately(mediaId, mediaName) {
    const ps = window.currentProjectState;
    if (!ps) return;
    ps.environmentMediaId = mediaId || null;
    ps.environmentName = mediaName || '';
    syncProjectEnvironmentTexture();
    if (ps.id && window.FishDatabase && typeof window.FishDatabase.getProject === 'function') {
      window.FishDatabase.getProject(ps.id).then(proj => {
        if (proj) {
          proj.environmentMediaId = ps.environmentMediaId;
          proj.environmentName = ps.environmentName;
          return window.FishDatabase.saveProject(proj);
        }
        return window.FishDatabase.saveProject(ps);
      }).catch(() => {});
    }
  }

  // =========================================================================
  // 2. SHARED MEDIA POOL MIRROR POPOVER (Environment + 3D Slot Texture)
  // =========================================================================
  function syncEnvPopoverTabsUI() {
    const tabsEl = document.getElementById('env-popover-tabs');
    if (!tabsEl) return;
    tabsEl.classList.toggle('is-hidden-item', _popoverMode !== 'env');
    tabsEl.querySelectorAll('.segmented-switch-item').forEach(btn => {
      const active = (btn.dataset.envTab === _envPopoverTab);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    if (!tabsEl._wired) {
      tabsEl._wired = true;
      tabsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.segmented-switch-item');
        if (!btn || !btn.dataset.envTab) return;
        e.stopPropagation();
        if (_envPopoverTab === btn.dataset.envTab) return;
        _envPopoverTab = btn.dataset.envTab;
        syncEnvPopoverTabsUI();
        renderEnvironmentMediaPool();
      });
    }
  }

  async function renderEnvironmentMediaPool() {
    const grid = document.getElementById('env-media-pool-grid');
    if (!grid) return;

    const titleEl = document.getElementById('env-popover-title');
    if (titleEl) {
      titleEl.textContent = (_popoverMode === 'slot') ? 'Slot Texture' : 'Environment Map';
    }

    syncEnvPopoverTabsUI();

    let selectedId = '';
    if (_popoverMode === 'env') {
      const btn = document.getElementById('btn-settings-environment-picker');
      selectedId = (btn && btn.dataset.mediaId) || (window.currentProjectState && window.currentProjectState.environmentMediaId) || '';
    } else {
      const layer = getSelectedLayer();
      const slots = ensureLayerMaterialSlots(layer);
      const slot = slots[_activeSlotIndex] || slots[0];
      selectedId = (slot && slot.surfaceMode === 'media' && slot.mediaId) ? slot.mediaId : '';
    }

    const showPresets = (_popoverMode === 'env' && _envPopoverTab === 'presets');
    const mediaItems = showPresets ? [] : await fetchProjectImageMedia();
    grid.innerHTML = '';

    if (!showPresets) {
      // 1. Import (+) Tile (Media Pool mode)
      const importTile = document.createElement('button');
      importTile.type = 'button';
      importTile.className = 'fill-media-import-tile';
      importTile.title = 'Upload Image';
      importTile.setAttribute('aria-label', 'Upload Image');
      importTile.innerHTML = '<span class="fill-media-thumbbox fill-media-import-box"><i class="fticon fticon-icon-23" aria-hidden="true"></i></span><span class="fill-media-name">Upload</span>';
      importTile.addEventListener('click', (e) => {
        e.stopPropagation();
        const input = document.getElementById('env-media-file-input');
        if (input) input.click();
      });
      grid.appendChild(importTile);
    }

    // 2. None / Clear Tile
    const noneTile = document.createElement('button');
    noneTile.type = 'button';
    noneTile.className = 'fill-media-tile env-media-none-tile' + (!selectedId ? ' is-active' : '');
    noneTile.title = (_popoverMode === 'slot') ? 'Inherit Layer Fill' : 'None (No Environment)';
    noneTile.innerHTML = '<span class="fill-media-thumbbox"><i class="fticon fticon-no-fill" aria-hidden="true"></i></span><span class="fill-media-name">None</span>';
    noneTile.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_popoverMode === 'env') {
        syncEnvironmentPickerTrigger(null, '', '');
        persistEnvironmentChoiceImmediately(null, '');
      } else {
        applySlotMediaSelection(null);
      }
      closeEnvironmentPopover();
    });
    grid.appendChild(noneTile);

    if (showPresets) {
      // 3a. Built-in Basic 2K Environment Gallery
      DEFAULT_ENV_PRESETS.forEach(preset => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'fill-media-tile' + (selectedId === preset.id ? ' is-active' : '');
        tile.dataset.mediaId = preset.id;
        tile.title = preset.name;

        const thumbBox = document.createElement('span');
        thumbBox.className = 'fill-media-thumbbox';
        const img = document.createElement('img');
        img.className = 'fill-media-thumb';
        img.src = preset.url;
        img.alt = preset.name;
        img.loading = 'lazy';
        thumbBox.appendChild(img);

        const badge = document.createElement('span');
        badge.className = 'fill-media-badge';
        badge.textContent = 'ENV';
        thumbBox.appendChild(badge);

        const nameEl = document.createElement('span');
        nameEl.className = 'fill-media-name';
        nameEl.textContent = preset.name;
        nameEl.title = preset.name;

        tile.appendChild(thumbBox);
        tile.appendChild(nameEl);

        tile.addEventListener('click', (e) => {
          e.stopPropagation();
          syncEnvironmentPickerTrigger(preset.id, preset.name, preset.url);
          decodeAndCacheMediaImage(preset.id, preset.url, (decoded) => {
            if (window.currentProjectState && window.currentProjectState.environmentMediaId === preset.id) {
              applyDecodedEnvironmentImage(decoded);
            }
          });
          persistEnvironmentChoiceImmediately(preset.id, preset.name);
          closeEnvironmentPopover();
        });

        grid.appendChild(tile);
      });
      return;
    }

    // 3b. Mirrored Project Image Items (Media Pool)
    mediaItems.forEach(item => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'fill-media-tile' + (selectedId === item.id ? ' is-active' : '');
      tile.dataset.mediaId = item.id;
      tile.title = item.name || 'Image';

      const thumbSrc = item.thumbUrl || item.dataUrl || '';
      const safeName = item.name || 'IMG';
      const thumbBox = document.createElement('span');
      thumbBox.className = 'fill-media-thumbbox';
      if (thumbSrc) {
        const img = document.createElement('img');
        img.className = 'fill-media-thumb';
        img.src = thumbSrc;
        img.alt = safeName;
        img.loading = 'lazy';
        thumbBox.appendChild(img);
      }
      const badge = document.createElement('span');
      badge.className = 'fill-media-badge';
      badge.textContent = 'IMG';
      thumbBox.appendChild(badge);

      const nameEl = document.createElement('span');
      nameEl.className = 'fill-media-name';
      nameEl.textContent = safeName;
      nameEl.title = safeName;

      tile.appendChild(thumbBox);
      tile.appendChild(nameEl);

      tile.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_popoverMode === 'env') {
          syncEnvironmentPickerTrigger(item.id, item.name || 'Environment', thumbSrc);
          decodeAndCacheMediaImage(item.id, item.dataUrl || item.thumbUrl, (img) => {
            if (window.currentProjectState && window.currentProjectState.environmentMediaId === item.id) {
              applyDecodedEnvironmentImage(img);
            }
          });
          persistEnvironmentChoiceImmediately(item.id, item.name || 'Environment');
        } else {
          decodeAndCacheMediaImage(item.id, item.dataUrl || item.thumbUrl, () => {
            if (typeof window.redrawComposition === 'function') window.redrawComposition();
            scheduleSpherePreviewRefresh();
          });
          applySlotMediaSelection(item.id);
        }
        closeEnvironmentPopover();
      });

      grid.appendChild(tile);
    });
  }
  window.renderEnvironmentMediaPool = renderEnvironmentMediaPool;

  function openEnvironmentPickerPopover(anchorEl, mode) {
    const pop = document.getElementById('popover-environment-media-pool');
    if (!pop || !anchorEl) return;
    _popoverMode = mode === 'slot' ? 'slot' : 'env';
    if (_popoverMode === 'env') {
      const curId = (window.currentProjectState && window.currentProjectState.environmentMediaId) || '';
      if (curId && !getBuiltinEnvPreset(curId)) {
        _envPopoverTab = 'media';
      } else if (curId && getBuiltinEnvPreset(curId)) {
        _envPopoverTab = 'presets';
      }
    }
    pop.classList.toggle('is-above-modal', _popoverMode === 'env');
    renderEnvironmentMediaPool().then(() => {
      if (window.Popover && typeof window.Popover.open === 'function') {
        window.Popover.open(anchorEl, pop);
      }
    }).catch(() => {});
  }
  window.openEnvironmentPickerPopover = openEnvironmentPickerPopover;

  function closeEnvironmentPopover() {
    if (window.Popover && typeof window.Popover.close === 'function') {
      window.Popover.close();
    }
  }

  function applySlotMediaSelection(mediaId) {
    const layer = getSelectedLayer();
    if (!layer) return;
    const slots = ensureLayerMaterialSlots(layer);
    const slot = slots[_activeSlotIndex] || slots[0];
    if (!slot) return;
    if (mediaId) {
      slot.surfaceMode = 'media';
      slot.mediaId = mediaId;
    } else {
      slot.surfaceMode = 'inherit';
      slot.mediaId = null;
    }
    mirrorSlot0ToMaterialOptions(layer);
    syncTextureParamsUI(layer);
    scheduleSpherePreviewRefresh();
    commitMaterialChange(layer, true);
  }

  // =========================================================================
  // 3. LIVE SHADED 3D MATERIAL SPHERE PREVIEW RENDERER (Zero-GC LUT)
  // =========================================================================
  function getSphereLut(size) {
    let lut = _sphereLutCache.get(size);
    if (lut) return lut;
    const count = size * size;
    const nxArr = new Float32Array(count);
    const nyArr = new Float32Array(count);
    const nzArr = new Float32Array(count);
    const uArr = new Float32Array(count);
    const vArr = new Float32Array(count);
    const alphaArr = new Uint8Array(count);

    const half = size * 0.5;
    const radius = half - 1.5;
    for (let y = 0; y < size; y++) {
      const dy = (y + 0.5 - half) / radius;
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - half) / radius;
        const r2 = dx * dx + dy * dy;
        const idx = y * size + x;
        if (r2 <= 1.0) {
          const nz = Math.sqrt(Math.max(0, 1.0 - r2));
          nxArr[idx] = dx;
          nyArr[idx] = dy;
          nzArr[idx] = nz;
          uArr[idx] = Math.atan2(dx, nz) / (Math.PI * 2) + 0.5;
          vArr[idx] = Math.acos(Math.max(-1, Math.min(1, -dy))) / Math.PI;
          const edge = (1.0 - Math.sqrt(r2)) * radius;
          alphaArr[idx] = edge >= 1.0 ? 255 : Math.max(0, Math.min(255, Math.round(edge * 255)));
        } else {
          alphaArr[idx] = 0;
        }
      }
    }
    lut = { size, nxArr, nyArr, nzArr, uArr, vArr, alphaArr };
    _sphereLutCache.set(size, lut);
    return lut;
  }

  function renderMaterialSpherePreview(canvas, slot, layer) {
    if (!canvas || typeof canvas.getContext !== 'function' || !slot) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width || 44;
    const lut = getSphereLut(size);
    const imgData = ctx.createImageData(size, size);
    const out = imgData.data;

    let baseRgb = hexToRgb((layer && (layer.fillColor || layer.color)) || '#98ce7b');
    let texPixels = null;
    if (slot.surfaceMode === 'solid' && slot.color) {
      baseRgb = hexToRgb(slot.color);
    } else if (slot.surfaceMode === 'media' && slot.mediaId) {
      const mImg = getMaterialMediaImage(slot.mediaId);
      if (mImg) texPixels = sampleImagePixels(mImg, 32, 32);
    }

    const bR = baseRgb.r / 255;
    const bG = baseRgb.g / 255;
    const bB = baseRgb.b / 255;
    const diffCoeff = (typeof slot.diffuse === 'number' ? slot.diffuse : 100) / 100;
    const specCoeff = (typeof slot.specular === 'number' ? slot.specular : 50) / 100;
    const rough = Math.max(0.02, Math.min(1.0, (typeof slot.roughness === 'number' ? slot.roughness : 50) / 100));
    const glossy = Math.max(0, Math.min(1, (typeof slot.glossy === 'number' ? slot.glossy : 0) / 100));
    const metallic = Math.max(0, Math.min(1, (typeof slot.metallic === 'number' ? slot.metallic : 0) / 100));
    const envRefl = Math.max(0, Math.min(1, (typeof slot.envReflection === 'number' ? slot.envReflection : 100) / 100));
    const acceptsLights = slot.acceptsLights !== false;

    const effRough = Math.max(0.02, rough * (1.0 - glossy * 0.55));
    const shininess = 4.0 + (256.0 - 4.0) * (1.0 - effRough);
    const specBoost = specCoeff + glossy * 0.85;

    // Preview studio key light from top-front-left
    const lx = -0.45, ly = -0.58, lz = 0.68;
    // Half vector for view (0, 0, 1)
    let hx = lx, hy = ly, hz = lz + 1.0;
    const hLen = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
    hx /= hLen; hy /= hLen; hz /= hLen;

    const envPx = _activeEnvPixels;
    const hasEnv = Boolean(envPx && (glossy > 0.005 || metallic > 0.005) && envRefl > 0.005);
    const total = size * size;

    for (let i = 0; i < total; i++) {
      const a = lut.alphaArr[i];
      if (a === 0) continue;

      const nx = lut.nxArr[i];
      const ny = lut.nyArr[i];
      const nz = lut.nzArr[i];

      let cr = bR, cg = bG, cb = bB;
      if (texPixels) {
        const tx = Math.min(texPixels.w - 1, Math.max(0, Math.floor(lut.uArr[i] * texPixels.w)));
        const ty = Math.min(texPixels.h - 1, Math.max(0, Math.floor(lut.vArr[i] * texPixels.h)));
        const ti = (ty * texPixels.w + tx) * 4;
        cr = texPixels.data[ti] / 255;
        cg = texPixels.data[ti + 1] / 255;
        cb = texPixels.data[ti + 2] / 255;
      }

      let r = cr, g = cg, b = cb;
      if (acceptsLights) {
        const nDotL = Math.max(0, nx * lx + ny * ly + nz * lz);
        const shade = (0.28 + 0.82 * nDotL) * diffCoeff * (1.0 - metallic * 0.82);
        const nDotH = Math.max(0, nx * hx + ny * hy + nz * hz);
        const spec = Math.pow(nDotH, shininess) * specBoost;
        const sR = 1.0 * (1.0 - metallic) + cr * metallic;
        const sG = 1.0 * (1.0 - metallic) + cg * metallic;
        const sB = 1.0 * (1.0 - metallic) + cb * metallic;
        r = cr * shade + spec * sR;
        g = cg * shade + spec * sG;
        b = cb * shade + spec * sB;
      }

      if (hasEnv) {
        // Reflect V=(0,0,1) around N -> R = 2*nz*N - V
        const rx = 2.0 * nz * nx;
        const ry = 2.0 * nz * ny;
        const rz = 2.0 * nz * nz - 1.0;
        let eu = Math.atan2(rx, -rz) / (Math.PI * 2) + 0.5;
        if (eu < 0) eu += 1;
        if (eu >= 1) eu -= 1;
        const ev = Math.acos(Math.max(-1, Math.min(1, -ry))) / Math.PI;
        const ex = Math.min(envPx.w - 1, Math.max(0, Math.floor(eu * envPx.w)));
        const ey = Math.min(envPx.h - 1, Math.max(0, Math.floor(ev * envPx.h)));
        const ei = (ey * envPx.w + ex) * 4;
        const er = envPx.data[ei] / 255;
        const eg = envPx.data[ei + 1] / 255;
        const eb = envPx.data[ei + 2] / 255;

        const fresnel = 0.04 + 0.96 * Math.pow(1.0 - Math.max(0, nz), 5.0);
        const coatAmt = Math.min(0.92, (fresnel * (1.0 - glossy * 0.55) + glossy * 0.55) * glossy * envRefl * 0.85);
        const mFac = metallic * envRefl;
        const mTintR = cr * (1.0 - fresnel * 0.35) + fresnel * 0.35;
        const mTintG = cg * (1.0 - fresnel * 0.35) + fresnel * 0.35;
        const mTintB = cb * (1.0 - fresnel * 0.35) + fresnel * 0.35;

        r = r * (1.0 - coatAmt) + er * coatAmt + er * mTintR * mFac;
        g = g * (1.0 - coatAmt) + eg * coatAmt + eg * mTintG * mFac;
        b = b * (1.0 - coatAmt) + eb * coatAmt + eb * mTintB * mFac;
      }

      const oi = i * 4;
      out[oi] = Math.max(0, Math.min(255, Math.round(r * 255)));
      out[oi + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      out[oi + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      out[oi + 3] = a;
    }

    ctx.putImageData(imgData, 0, 0);
  }

  function scheduleSpherePreviewRefresh() {
    if (_spherePreviewRaf) return;
    _spherePreviewRaf = requestAnimationFrame(() => {
      _spherePreviewRaf = null;
      const layer = getSelectedLayer();
      if (!layer) return;
      const slots = ensureLayerMaterialSlots(layer);
      const grid = document.getElementById('texture-sphere-pool-grid');
      if (grid) {
        const canvases = grid.querySelectorAll('.texture-sphere-canvas');
        canvases.forEach((cv, idx) => {
          if (slots[idx]) renderMaterialSpherePreview(cv, slots[idx], layer);
        });
      }
      const miniCv = document.getElementById('texture-param-slot-canvas');
      const curSlot = slots[_activeSlotIndex] || slots[0];
      if (miniCv && curSlot) {
        renderMaterialSpherePreview(miniCv, curSlot, layer);
      }
    });
  }

  // =========================================================================
  // 4. 3-COLUMN TEXTURE DRAWER UI SYNC & INTERACTION
  // =========================================================================
  function switchTexture3DTab(tabName) {
    _activeTexTab = (tabName === 'params') ? 'params' : 'spheres';
    const paneSpheres = document.getElementById('pane-texture-spheres');
    const paneParams = document.getElementById('pane-texture-params');
    const btnSpheres = document.getElementById('btn-texture-tab-spheres');
    const btnParams = document.getElementById('btn-texture-tab-params');

    if (paneSpheres) paneSpheres.classList.toggle('is-active', _activeTexTab === 'spheres');
    if (paneParams) paneParams.classList.toggle('is-active', _activeTexTab === 'params');
    if (btnSpheres) btnSpheres.classList.toggle('is-active', _activeTexTab === 'spheres');
    if (btnParams) btnParams.classList.toggle('is-active', _activeTexTab === 'params');

    const layer = getSelectedLayer();
    if (layer) {
      if (_activeTexTab === 'params') {
        syncTextureParamsUI(layer);
      } else {
        renderTextureSpherePool(layer);
      }
    }
  }
  window.switchTexture3DTab = switchTexture3DTab;

  function renderTextureSpherePool(layer) {
    const grid = document.getElementById('texture-sphere-pool-grid');
    const titleEl = document.getElementById('texture-sphere-pool-title');
    const splitBtn = document.getElementById('btn-texture-toggle-slots');
    if (!grid || !layer) return;

    const slots = ensureLayerMaterialSlots(layer);
    if (_activeSlotIndex >= slots.length) _activeSlotIndex = 0;

    const shapeKey = getShapeKey(layer);
    const templates = SHAPE_FACE_TEMPLATES[shapeKey] || null;
    if (splitBtn) {
      if (templates && templates.length > 1) {
        splitBtn.classList.remove('is-hidden');
        const isSplit = slots.length > 1;
        splitBtn.classList.toggle('is-active', isSplit);
        splitBtn.textContent = isSplit ? 'Unified' : 'Split Faces';
      } else {
        splitBtn.classList.add('is-hidden');
      }
    }
    if (titleEl) {
      titleEl.textContent = slots.length > 1 ? `Textures (${slots.length})` : 'Textures';
    }

    grid.innerHTML = '';
    slots.forEach((slot, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'texture-sphere-item' + (idx === _activeSlotIndex ? ' is-selected' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', idx === _activeSlotIndex ? 'true' : 'false');
      btn.title = `${slot.name} — Click to edit parameters`;

      const cv = document.createElement('canvas');
      cv.className = 'texture-sphere-canvas';
      cv.width = 44;
      cv.height = 44;
      renderMaterialSpherePreview(cv, slot, layer);

      const lbl = document.createElement('span');
      lbl.className = 'texture-sphere-label';
      lbl.textContent = slot.name || `Slot ${idx + 1}`;

      btn.appendChild(cv);
      btn.appendChild(lbl);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _activeSlotIndex = idx;
        syncTextureParamsUI(layer);
        switchTexture3DTab('params');
      });

      grid.appendChild(btn);
    });
  }

  function syncTextureParamsUI(layer) {
    if (!layer) return;
    const slots = ensureLayerMaterialSlots(layer);
    if (_activeSlotIndex >= slots.length) _activeSlotIndex = 0;
    const slot = slots[_activeSlotIndex] || slots[0];
    if (!slot) return;

    const nameEl = document.getElementById('texture-param-slot-name');
    if (nameEl) nameEl.textContent = slot.name || 'Surface';

    const miniCv = document.getElementById('texture-param-slot-canvas');
    if (miniCv) renderMaterialSpherePreview(miniCv, slot, layer);

    const surfaceBar = document.getElementById('texture-surface-bar');
    if (surfaceBar) {
      const mode = slot.surfaceMode || 'inherit';
      surfaceBar.querySelectorAll('.texture-surface-btn').forEach(b => {
        const active = b.getAttribute('data-surface-mode') === mode;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    const acceptsLights = slot.acceptsLights !== false;
    const switchEl = document.getElementById('switch-material-accepts-lights');
    if (switchEl) {
      switchEl.querySelectorAll('.segmented-switch-item').forEach(b => {
        const isTarget = (b.getAttribute('data-val') === 'on' && acceptsLights) ||
          (b.getAttribute('data-val') === 'off' && !acceptsLights);
        b.classList.toggle('is-active', isTarget);
        b.classList.toggle('is-selected', isTarget);
        b.setAttribute('aria-selected', isTarget ? 'true' : 'false');
      });
    }

    const syncScrubber = (jogId, valId, val) => {
      const v = Math.round(val);
      const valEl = document.getElementById(valId);
      if (valEl) valEl.textContent = `${v}%`;
      const jogEl = document.getElementById(jogId);
      if (jogEl && typeof window.updateJogScrubberVisuals === 'function') {
        window.updateJogScrubberVisuals(jogEl, v, 0, 100);
      }
    };

    syncScrubber('jog-material-glossy', 'val-material-glossy', typeof slot.glossy === 'number' ? slot.glossy : 0);
    syncScrubber('jog-material-metallic', 'val-material-metallic', typeof slot.metallic === 'number' ? slot.metallic : 0);
    syncScrubber('jog-material-roughness', 'val-material-roughness', typeof slot.roughness === 'number' ? slot.roughness : 50);
    syncScrubber('jog-material-diffuse', 'val-material-diffuse', typeof slot.diffuse === 'number' ? slot.diffuse : 100);
    syncScrubber('jog-material-specular', 'val-material-specular', typeof slot.specular === 'number' ? slot.specular : 50);
    syncScrubber('jog-material-env-reflection', 'val-material-env-reflection', typeof slot.envReflection === 'number' ? slot.envReflection : 100);
  }

  function syncTexture3DUI(layer) {
    if (!layer) return;
    ensureLayerMaterialSlots(layer);
    renderTextureSpherePool(layer);
    syncTextureParamsUI(layer);
  }
  window.syncTexture3DUI = syncTexture3DUI;
  window.syncEdit3DUI = syncTexture3DUI;

  function commitMaterialChange(layer, persist) {
    if (!layer) return;
    mirrorSlot0ToMaterialOptions(layer);
    if (typeof window.invalidateEffectivePropsCache === 'function') {
      window.invalidateEffectivePropsCache();
    }
    if (persist) {
      if (typeof window.invalidatePreviewCacheForLayer === 'function') {
        window.invalidatePreviewCacheForLayer(layer);
      }
      if (typeof window.saveCurrentProjectLayers === 'function') {
        window.saveCurrentProjectLayers();
      }
    }
    if (typeof window.redrawComposition === 'function') {
      window.redrawComposition();
    }
  }

  // =========================================================================
  // 5. EVENT BINDINGS
  // =========================================================================
  function init3DMaterialsController() {
    // 1. Project Settings -> Environment Picker Button
    const envBtn = document.getElementById('btn-settings-environment-picker');
    if (envBtn && !envBtn._bound) {
      envBtn._bound = true;
      envBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEnvironmentPickerPopover(envBtn, 'env');
      });
    }

    // 2. Direct Image Upload inside Environment / Slot Texture Popover
    const envFileInput = document.getElementById('env-media-file-input');
    if (envFileInput && !envFileInput._bound) {
      envFileInput._bound = true;
      envFileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        const ps = window.currentProjectState;
        const projectId = ps ? ps.id : '';
        if (!projectId || !window.FishDatabase) return;

        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const mediaItem = {
            id: 'med_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            projectId: projectId,
            name: file.name,
            type: 'image',
            dataUrl: dataUrl,
            thumbUrl: dataUrl,
            duration: null,
            width: null,
            height: null,
            createdAt: Date.now()
          };

          await window.FishDatabase.saveMedia(mediaItem);
          if (window._activeMediaMap) {
            window._activeMediaMap.set(mediaItem.id, mediaItem);
          }
          if (typeof window.refreshProjectMediaGrid === 'function') {
            window.refreshProjectMediaGrid();
          }
          if (typeof window.renderFillMediaPool === 'function') {
            window.renderFillMediaPool();
          }

          decodeAndCacheMediaImage(mediaItem.id, dataUrl, () => {
            if (_popoverMode === 'slot') {
              if (typeof window.redrawComposition === 'function') window.redrawComposition();
              scheduleSpherePreviewRefresh();
            }
          });

          if (_popoverMode === 'env') {
            syncEnvironmentPickerTrigger(mediaItem.id, mediaItem.name, dataUrl);
            persistEnvironmentChoiceImmediately(mediaItem.id, mediaItem.name);
          } else {
            applySlotMediaSelection(mediaItem.id);
          }
          await renderEnvironmentMediaPool();
          closeEnvironmentPopover();
        } catch (err) {
          console.error('Failed to upload environment/texture image:', err);
        }
        envFileInput.value = '';
      });
    }

    // 3. Open 3-Column Texture Drawer from #btn-layer-texture
    const btnTexture = document.getElementById('btn-layer-texture');
    if (btnTexture && !btnTexture._bound) {
      btnTexture._bound = true;
      btnTexture.addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = getSelectedLayer();
        if (!layer) return;
        _activeSlotIndex = 0;
        syncTexture3DUI(layer);
        switchTexture3DTab('spheres');
        if (typeof window.switchLayerDrawerSubview === 'function') {
          window.switchLayerDrawerSubview('texture');
        }
      });
    }

    // 4. Left Back Button -> Main Layer Actions
    const btnBack = document.getElementById('btn-texture-back');
    if (btnBack && !btnBack._bound) {
      btnBack._bound = true;
      btnBack.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.switchLayerDrawerSubview === 'function') {
          window.switchLayerDrawerSubview('main');
        }
      });
    }

    // 5. Right 2-Button Rail (Sphere Pool <-> Parameter Settings)
    const btnTabSpheres = document.getElementById('btn-texture-tab-spheres');
    const btnTabParams = document.getElementById('btn-texture-tab-params');
    if (btnTabSpheres && !btnTabSpheres._bound) {
      btnTabSpheres._bound = true;
      btnTabSpheres.addEventListener('click', (e) => {
        e.stopPropagation();
        switchTexture3DTab('spheres');
      });
    }
    if (btnTabParams && !btnTabParams._bound) {
      btnTabParams._bound = true;
      btnTabParams.addEventListener('click', (e) => {
        e.stopPropagation();
        switchTexture3DTab('params');
      });
    }

    // 6. Split Faces / Unified Toggle in Pane 1
    const splitBtn = document.getElementById('btn-texture-toggle-slots');
    if (splitBtn && !splitBtn._bound) {
      splitBtn._bound = true;
      splitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = getSelectedLayer();
        if (!layer) return;
        const shapeKey = getShapeKey(layer);
        const templates = SHAPE_FACE_TEMPLATES[shapeKey];
        if (!templates || templates.length <= 1) return;

        const slots = ensureLayerMaterialSlots(layer);
        if (slots.length > 1) {
          const base = Object.assign({}, slots[0], { id: 'surface', name: 'Surface' });
          layer.materialSlots = [base];
          _activeSlotIndex = 0;
        } else {
          const base = slots[0] || makeSlot();
          layer.materialSlots = templates.map(t => Object.assign({}, base, { id: t.id, name: t.name }));
          _activeSlotIndex = 0;
        }
        renderTextureSpherePool(layer);
        syncTextureParamsUI(layer);
        commitMaterialChange(layer, true);
      });
    }

    // 7. Surface Source Selector (Fill / Color / Image) in Pane 2
    const surfaceBar = document.getElementById('texture-surface-bar');
    if (surfaceBar && !surfaceBar._bound) {
      surfaceBar._bound = true;
      surfaceBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.texture-surface-btn');
        if (!btn) return;
        e.stopPropagation();
        const mode = btn.getAttribute('data-surface-mode');
        const layer = getSelectedLayer();
        if (!layer) return;
        const slots = ensureLayerMaterialSlots(layer);
        const slot = slots[_activeSlotIndex] || slots[0];
        if (!slot) return;

        if (mode === 'inherit') {
          slot.surfaceMode = 'inherit';
          syncTextureParamsUI(layer);
          scheduleSpherePreviewRefresh();
          commitMaterialChange(layer, true);
        } else if (mode === 'solid') {
          slot.surfaceMode = 'solid';
          if (!slot.color) slot.color = (layer.fillColor || layer.color || '#98ce7b');
          syncTextureParamsUI(layer);
          scheduleSpherePreviewRefresh();
          commitMaterialChange(layer, true);
          if (window.FishColorPicker && typeof window.FishColorPicker.open === 'function') {
            window.FishColorPicker.open({
              anchor: btn,
              color: slot.color,
              onChange: (hex) => {
                if (!hex) return;
                slot.color = hex;
                scheduleSpherePreviewRefresh();
                commitMaterialChange(layer, false);
              },
              onCommit: (hex) => {
                if (!hex) return;
                slot.color = hex;
                scheduleSpherePreviewRefresh();
                commitMaterialChange(layer, true);
              }
            });
          }
        } else if (mode === 'media') {
          openEnvironmentPickerPopover(btn, 'slot');
        }
      });
    }

    // 8. Accepts Lights Switch
    const switchEl = document.getElementById('switch-material-accepts-lights');
    if (switchEl && !switchEl._bound) {
      switchEl._bound = true;
      switchEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.segmented-switch-item');
        if (!btn) return;
        const val = btn.getAttribute('data-val');
        const layer = getSelectedLayer();
        if (!layer) return;
        const slots = ensureLayerMaterialSlots(layer);
        const slot = slots[_activeSlotIndex] || slots[0];
        if (!slot) return;
        slot.acceptsLights = (val === 'on');
        syncTextureParamsUI(layer);
        scheduleSpherePreviewRefresh();
        commitMaterialChange(layer, true);
      });
    }

    // 9. Jog Scrubbers for Material Parameters
    function bindSlotScrubber(jogId, valId, propKey, defaultVal, labelTitle) {
      let initVal = defaultVal;
      const jogEl = document.getElementById(jogId);
      if (jogEl && !jogEl._matBound && typeof window.bindJogWheel === 'function') {
        jogEl._matBound = true;
        window.bindJogWheel(jogEl, {
          onStart: () => {
            const layer = getSelectedLayer();
            if (!layer) return;
            const slots = ensureLayerMaterialSlots(layer);
            const slot = slots[_activeSlotIndex] || slots[0];
            initVal = (slot && typeof slot[propKey] === 'number') ? slot[propKey] : defaultVal;
          },
          onMove: (delta) => {
            const layer = getSelectedLayer();
            if (!layer) return;
            const slots = ensureLayerMaterialSlots(layer);
            const slot = slots[_activeSlotIndex] || slots[0];
            if (!slot) return;
            const newVal = Math.max(0, Math.min(100, Math.round(initVal - delta * 0.25)));
            slot[propKey] = newVal;
            const valEl = document.getElementById(valId);
            if (valEl) valEl.textContent = `${newVal}%`;
            if (typeof window.updateJogScrubberVisuals === 'function') {
              window.updateJogScrubberVisuals(jogEl, newVal, 0, 100);
            }
            scheduleSpherePreviewRefresh();
            commitMaterialChange(layer, false);
          },
          onEnd: () => {
            const layer = getSelectedLayer();
            if (layer) commitMaterialChange(layer, true);
          }
        });
      }

      const valEl = document.getElementById(valId);
      if (valEl && !valEl._matBound) {
        valEl._matBound = true;
        valEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = getSelectedLayer();
          if (!layer) return;
          const slots = ensureLayerMaterialSlots(layer);
          const slot = slots[_activeSlotIndex] || slots[0];
          if (!slot) return;
          if (typeof window.openValueInputPopover === 'function') {
            window.openValueInputPopover(valEl, {
              initialValue: typeof slot[propKey] === 'number' ? slot[propKey] : defaultVal,
              min: 0,
              max: 100,
              step: 1,
              unit: '%',
              title: labelTitle,
              onApply: (newVal) => {
                slot[propKey] = Math.max(0, Math.min(100, Number(newVal) || 0));
                syncTextureParamsUI(layer);
                scheduleSpherePreviewRefresh();
                commitMaterialChange(layer, true);
              }
            });
          }
        });
      }
    }

    bindSlotScrubber('jog-material-glossy', 'val-material-glossy', 'glossy', 0, 'Glossy');
    bindSlotScrubber('jog-material-metallic', 'val-material-metallic', 'metallic', 0, 'Metallic');
    bindSlotScrubber('jog-material-roughness', 'val-material-roughness', 'roughness', 50, 'Roughness');
    bindSlotScrubber('jog-material-diffuse', 'val-material-diffuse', 'diffuse', 100, 'Diffuse');
    bindSlotScrubber('jog-material-specular', 'val-material-specular', 'specular', 50, 'Specular');
    bindSlotScrubber('jog-material-env-reflection', 'val-material-env-reflection', 'envReflection', 100, 'Env Reflection');

    // 10. Hook selectTimelineLayer & selectLayer after all editor modules finish loading
    //     so mobile (editor.html) & desktop (desktop.html) always swap Fill <-> Texture.
    setTimeout(() => {
      ['selectTimelineLayer', 'selectLayer'].forEach((fnName) => {
        const origFn = window[fnName];
        if (typeof origFn === 'function' && !origFn._texture3dWrapped) {
          const wrapped = function () {
            const res = origFn.apply(this, arguments);
            if (typeof window.syncEdit3DInspector === 'function') {
              window.syncEdit3DInspector(getSelectedLayer());
            }
            return res;
          };
          wrapped._texture3dWrapped = true;
          window[fnName] = wrapped;
        }
      });
    }, 0);

    // 11. Import 3D Model (.obj, .mtl, .fbx, .zip + textures) & Media Pool 3D Integration
    const _imported3DModelsMem = new Map(); // id -> { id, name, modelData, thumbUrl, projectId }
    window.forgetImported3DModelMem = (id) => { if (id) _imported3DModelsMem.delete(id); };

    function ensureModelRecordRegistered(rec) {
      if (!rec || !rec.id) return null;
      const md = rec.modelData || {};
      if (window.Fish3DLoader && typeof window.Fish3DLoader.registerBundle === 'function' && md.positions) {
        window.Fish3DLoader.registerBundle({
          id: rec.id,
          name: rec.name || '3D Model',
          positions: md.positions instanceof Float32Array ? md.positions : new Float32Array(md.positions || []),
          normals: md.normals instanceof Float32Array ? md.normals : new Float32Array(md.normals || []),
          uvs: md.uvs instanceof Float32Array ? md.uvs : new Float32Array(md.uvs || []),
          groups: md.groups || [],
          slots: md.slots || [],
          textures: md.textures || {},
          vertexCount: md.vertexCount || 0,
          triangleCount: md.triangleCount || 0,
          basePositions: md.basePositions ? (md.basePositions instanceof Float32Array ? md.basePositions : new Float32Array(md.basePositions)) : null,
          baseNormals: md.baseNormals ? (md.baseNormals instanceof Float32Array ? md.baseNormals : new Float32Array(md.baseNormals)) : null,
          skinIndices: md.skinIndices ? (md.skinIndices instanceof Uint16Array ? md.skinIndices : new Uint16Array(md.skinIndices)) : null,
          skinWeights: md.skinWeights ? (md.skinWeights instanceof Float32Array ? md.skinWeights : new Float32Array(md.skinWeights)) : null,
          rig: md.rig || null,
          animations: md.animations || []
        });
      }
      return md;
    }

    async function refreshImported3DModelsGrid() {
      // Remove any legacy tiles if present in #shape-grid-3d
      const legacyGrid = document.getElementById('shape-grid-3d');
      if (legacyGrid) {
        legacyGrid.querySelectorAll('.shape-3d-imported-tile').forEach(el => el.remove());
      }

      const ps = window.currentProjectState;
      const projectId = ps ? ps.id : '';
      let records = [];
      try {
        if (projectId && window.FishDatabase && typeof window.FishDatabase.getProjectMedia === 'function') {
          const all = await window.FishDatabase.getProjectMedia(projectId);
          records = (all || []).filter(m => m && m.type === '3d_model');
        }
      } catch (_) {
        records = [];
      }
      _imported3DModelsMem.forEach(rec => {
        if (rec && (!projectId || !rec.projectId || rec.projectId === projectId) && !records.some(r => r.id === rec.id)) {
          records.push(rec);
        }
      });

      window._activeMediaMap = window._activeMediaMap || new Map();
      records.forEach(rec => {
        ensureModelRecordRegistered(rec);
        if (!window._activeMediaMap.has(rec.id)) {
          window._activeMediaMap.set(rec.id, rec);
        }
      });

      if (typeof window.renderMediaGrid === 'function') {
        window.renderMediaGrid(true);
      }
    }
    window.refreshImported3DModelsGrid = refreshImported3DModelsGrid;

    function ensureAdvance3DForModel() {
      const ps = window.currentProjectState;
      if (!ps || ps.threeDEngine === 'advance') return false;
      ps.threeDEngine = 'advance';
      const dd = document.getElementById('dropdown-3d-engine');
      if (dd) {
        dd.dataset.value = 'advance';
        const lbl = dd.querySelector('.custom-dropdown-label');
        if (lbl) lbl.textContent = 'Advance 3D';
        dd.querySelectorAll('.custom-dropdown-item').forEach(it => {
          it.classList.toggle('is-selected', it.dataset.val === 'advance');
        });
      }
      syncProjectEnvironmentTexture();
      if (typeof window.saveCurrentProject === 'function') {
        try { window.saveCurrentProject(); } catch (_) {}
      }
      return true;
    }

    function addOrReplace3DModelFromMedia(item, replaceSelected = false, extraOpts = null) {
      if (!item || !item.id) return null;
      ensureAdvance3DForModel();
      const md = ensureModelRecordRegistered(item) || {};
      const bundle = (window.Fish3DLoader && typeof window.Fish3DLoader.getModel === 'function')
        ? window.Fish3DLoader.getModel(item.id)
        : null;
      const srcSlots = Array.isArray(md.slots) && md.slots.length > 0
        ? md.slots
        : (bundle && Array.isArray(bundle.slots) ? bundle.slots : []);
      const clonedSlots = srcSlots.map(s => Object.assign({}, s));

      if (replaceSelected) {
        const ps = window.currentProjectState;
        const selId = window.selectedLayerId;
        const selLayer = (ps && Array.isArray(ps.layers) && selId)
          ? ps.layers.find(l => l && l.id === selId)
          : null;
        if (selLayer && selLayer.shapeType === '3d_model') {
          if (window.UndoRedoManager && typeof window.UndoRedoManager.pushState === 'function') {
            window.UndoRedoManager.pushState('Replace 3D Model');
          }
          selLayer.modelMediaId = item.id;
          selLayer.name = item.name || selLayer.name || '3D Model';
          selLayer.materialSlots = clonedSlots;
          selLayer._rdyP = -1;
          selLayer._rdyA = -1;
          if (typeof window.invalidateEffectivePropsCache === 'function') {
            window.invalidateEffectivePropsCache(selLayer.id);
          }
          if (typeof window.renderTimelineLayers === 'function') {
            window.renderTimelineLayers();
          }
          if (typeof window.syncEdit3DInspector === 'function') {
            window.syncEdit3DInspector(selLayer);
          }
          if (typeof window.redrawComposition === 'function') {
            window.redrawComposition('replace3DModel');
          }
          if (typeof window.saveCurrentProject === 'function') {
            window.saveCurrentProject();
          }
          return selLayer;
        }
      }

      if (typeof window.addShapeLayer === 'function') {
        const opts = Object.assign({
          name: item.name || '3D Model',
          modelMediaId: item.id,
          materialSlots: clonedSlots
        }, extraOpts || {});
        return window.addShapeLayer('3d_model', opts);
      }
      return null;
    }
    window.addOrReplace3DModelFromMedia = addOrReplace3DModelFromMedia;

    async function import3DModelFiles(fileList) {
      if (!fileList || fileList.length === 0) return null;
      if (!window.Fish3DLoader || typeof window.Fish3DLoader.importFiles !== 'function') {
        if (typeof window.showEditorToast === 'function') {
          window.showEditorToast('Fish3DLoader is not available', 2400, 'error');
        }
        return null;
      }
      const ps = window.currentProjectState;
      const projectId = ps ? ps.id : '';
      const firstFile = fileList[0];
      const rawName = (firstFile && firstFile.name) ? String(firstFile.name).replace(/\.(zip|fbx|obj|mtl)$/i, '') : '3D Model';
      const pendingId = '3d_pending_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      window._activeMediaMap = window._activeMediaMap || new Map();
      // Optimistic instant entry in Project Pool so local imports appear immediately
      window._activeMediaMap.set(pendingId, {
        id: pendingId,
        projectId: projectId,
        name: rawName + ' (Importing...)',
        type: '3d_model',
        thumbUrl: '',
        _ingesting: true,
        createdAt: Date.now()
      });
      if (typeof window.renderMediaGrid === 'function') {
        window.renderMediaGrid(true);
      }
      try {
        const bundle = await window.Fish3DLoader.importFiles(fileList);
        window._activeMediaMap.delete(pendingId);
        let modelByteSize = 0;
        const addBufBytes = (arr) => {
          if (arr && typeof arr.byteLength === 'number') modelByteSize += arr.byteLength;
          else if (Array.isArray(arr)) modelByteSize += arr.length * 4;
        };
        addBufBytes(bundle.positions);
        addBufBytes(bundle.normals);
        addBufBytes(bundle.uvs);
        addBufBytes(bundle.basePositions);
        addBufBytes(bundle.baseNormals);
        addBufBytes(bundle.skinIndices);
        addBufBytes(bundle.skinWeights);
        if (bundle.textures && typeof bundle.textures === 'object') {
          Object.values(bundle.textures).forEach(v => {
            if (typeof v === 'string') modelByteSize += v.length;
          });
        }
        const modelRecord = {
          id: bundle.id,
          projectId: projectId,
          name: bundle.name,
          type: '3d_model',
          size: modelByteSize,
          thumbUrl: '',
          modelData: {
            positions: bundle.positions,
            normals: bundle.normals,
            uvs: bundle.uvs,
            groups: bundle.groups,
            slots: bundle.slots,
            textures: bundle.textures,
            vertexCount: bundle.vertexCount,
            triangleCount: bundle.triangleCount,
            basePositions: bundle.basePositions || null,
            baseNormals: bundle.baseNormals || null,
            skinIndices: bundle.skinIndices || null,
            skinWeights: bundle.skinWeights || null,
            rig: bundle.rig || null,
            animations: bundle.animations || []
          },
          createdAt: Date.now()
        };
        _imported3DModelsMem.set(bundle.id, modelRecord);
        window._activeMediaMap.set(bundle.id, modelRecord);
        if (typeof window.renderMediaGrid === 'function') {
          window.renderMediaGrid();
        }
        const switchedToAdvance = !!(window.currentProjectState && window.currentProjectState.threeDEngine !== 'advance');
        const layer = addOrReplace3DModelFromMedia(modelRecord, false);
        if (typeof window.showEditorToast === 'function') {
          const suffix = switchedToAdvance ? ' • Advance 3D aktif' : '';
          window.showEditorToast(`3D Imported: ${bundle.name} (${bundle.triangleCount} tris, ${bundle.slots.length} materials)${suffix}`, 2800, 'success');
        }
        // Generate 3D thumbnail & persist to IndexedDB in background without delaying pool appearance
        Promise.resolve().then(async () => {
          if (typeof window.Fish3DLoader.captureModelThumbnail === 'function') {
            try {
              const thumbUrl = await window.Fish3DLoader.captureModelThumbnail(bundle, 128);
              if (thumbUrl) {
                modelRecord.thumbUrl = thumbUrl;
                if (typeof window.renderMediaGrid === 'function') window.renderMediaGrid();
              }
            } catch (_) {}
          }
          if (projectId && window.FishDatabase && typeof window.FishDatabase.saveMedia === 'function') {
            window.FishDatabase.saveMedia(modelRecord).catch(() => {});
          }
        });
        return layer || bundle;
      } catch (err) {
        window._activeMediaMap.delete(pendingId);
        if (typeof window.renderMediaGrid === 'function') {
          window.renderMediaGrid();
        }
        console.error('[3D Import] Failed:', err);
        if (typeof window.showEditorToast === 'function') {
          window.showEditorToast('3D import failed: ' + (err && err.message ? err.message : 'Unsupported format'), 3000, 'error');
        }
        return null;
      }
    }
    window.import3DModelFiles = import3DModelFiles;

    syncProjectEnvironmentTexture();
    setTimeout(() => {
      syncProjectEnvironmentTexture();
      refreshImported3DModelsGrid();
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init3DMaterialsController);
  } else {
    init3DMaterialsController();
  }
})();
