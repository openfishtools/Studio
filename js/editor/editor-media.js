/**
 * OpenFishTools Studio - Editor Media & Ingestion
 * Manages layerMediaCache, getOrLoadLayerMedia, media pool ingestion, Fill/Stretch/Fit modes,
 * gradient handles, audio decoding, video pooling, and media replacement.
 */
(function() {
  function seekVideoToTime(video, targetTime) {
    return new Promise((resolve) => {
      if (!video) return resolve();
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = Math.max(0, targetTime || 0);
    });
  }
  window.seekVideoToTime = seekVideoToTime;

  // Centralized Studio Object URL Tracking Registry
  const _studioObjectUrls = window._studioObjectUrls || new Set();
  window._studioObjectUrls = _studioObjectUrls;

  function trackStudioObjectUrl(url) {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      _studioObjectUrls.add(url);
    }
    return url;
  }
  window.trackStudioObjectUrl = trackStudioObjectUrl;

  function revokeStudioObjectUrl(url) {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
      _studioObjectUrls.delete(url);
    }
  }
  window.revokeStudioObjectUrl = revokeStudioObjectUrl;

  function releaseLayerMediaElement(layer) {
    if (!layer) return;
    const cacheKey = (layer.type === 'video' || layer.type === 'audio') ? layer.id : (layer.mediaId || layer.id);
    const media = window.layerMediaCache ? window.layerMediaCache.get(cacheKey) : null;

    if (media && media.el) {
      if (typeof media.el.pause === 'function') {
        try { media.el.pause(); } catch (_) {}
      }
      try {
        media.el.src = '';
        if (typeof media.el.load === 'function') media.el.load();
      } catch (_) {}
      if (window.FishAudioEngine) {
        try { window.FishAudioEngine.detachMediaElement(media.el); } catch (_) {}
      }
      // Remove element from DOM (#editor-video-mount-pool or body)
      if (media.el.parentNode) {
        try { media.el.parentNode.removeChild(media.el); } catch (_) {}
      }
      // Zero freezeCanvas dimensions to release GPU textures
      if (media.freezeCanvas) {
        media.freezeCanvas.width = 0;
        media.freezeCanvas.height = 0;
        media.freezeCanvas = null;
      }
    }

    if (window.layerMediaCache) {
      window.layerMediaCache.delete(layer.id);
      if (layer.mediaId) {
        const isShared = (window.currentProjectState?.layers || []).some(l => l !== layer && (l.mediaId === layer.mediaId || l.fillMediaId === layer.mediaId));
        if (!isShared) {
          window.layerMediaCache.delete(layer.mediaId);
        }
      }
    }

    // Release scratch canvas GPU backing buffers
    if (layer._textBufferCanvas) {
      layer._textBufferCanvas.width = 0;
      layer._textBufferCanvas.height = 0;
      layer._textBufferCanvas = null;
    }
    if (layer._shapeBufferCanvas) {
      layer._shapeBufferCanvas.width = 0;
      layer._shapeBufferCanvas.height = 0;
      layer._shapeBufferCanvas = null;
    }
    if (layer._precompBufferCanvas) {
      layer._precompBufferCanvas.width = 0;
      layer._precompBufferCanvas.height = 0;
      layer._precompBufferCanvas = null;
    }
    if (layer._fillBufferCanvas) {
      layer._fillBufferCanvas.width = 0;
      layer._fillBufferCanvas.height = 0;
      layer._fillBufferCanvas = null;
    }
    if (layer._mediaFitCanvas) {
      layer._mediaFitCanvas.width = 0;
      layer._mediaFitCanvas.height = 0;
      layer._mediaFitCanvas = null;
    }

    // Invalidate effective animated properties cache for this layer
    if (typeof window.invalidateEffectivePropsCache === 'function') {
      window.invalidateEffectivePropsCache(layer.id);
    }
    if ((layer.type === 'video' || layer.type === 'precomp') && window.VideoFrameExtractor) {
      window.VideoFrameExtractor.clearLayer(layer);
    }
  }
  window.releaseLayerMediaElement = releaseLayerMediaElement;

    if (!window.layerMediaCache) window.layerMediaCache = new Map();

    function getLayerMediaDuration(layer) {
      if (!layer) return null;
      if (layer.mediaDuration && isFinite(layer.mediaDuration) && layer.mediaDuration > 0) {
        return layer.mediaDuration;
      }
      if (layer.type === 'video' && window.VideoFrameExtractor) {
        const src = window.VideoFrameExtractor.getSourceCache(window.VideoFrameExtractor._getSourceKey(layer));
        if (src && isFinite(src.duration) && src.duration > 0) {
          layer.mediaDuration = src.duration;
          return src.duration;
        }
      }
      const media = layerMediaCache.get(layer.mediaId || layer.id);
      if (media && media.el && isFinite(media.el.duration) && media.el.duration > 0) {
        layer.mediaDuration = media.el.duration;
        return media.el.duration;
      }
      return null;
    }
    window.getLayerMediaDuration = getLayerMediaDuration;

    function getOrLoadLayerMedia(layer) {
      if (!layer || layer.type === 'null' || layer.type === 'camera' || layer.type === 'adjustment' || layer.type === 'shape' || layer.type === 'text') return null;
      if (layer.type === 'precomp') {
        if (!layer._precompBufferCanvas || !(layer._precompBufferCanvas instanceof HTMLCanvasElement) || typeof layer._precompBufferCanvas.getContext !== 'function') {
          layer._precompBufferCanvas = document.createElement('canvas');
        }
        if (window.VideoFrameExtractor && !layer._extractComplete && !layer._dirty) {
          window.VideoFrameExtractor.extractLayerRange(layer);
        }
        return {
          type: 'precomp',
          el: layer._precompBufferCanvas,
          isReady: true
        };
      }
      if (window._activeMediaMap) {
        let activeItem = layer.mediaId ? window._activeMediaMap.get(layer.mediaId) : null;
        if (!activeItem && layer.name) {
          for (const item of window._activeMediaMap.values()) {
            if (item && item.name === layer.name && (!item.type || item.type === layer.type)) {
              activeItem = item;
              if (!layer.mediaId && item.id) layer.mediaId = item.id;
              break;
            }
          }
        }
        if (activeItem && activeItem.dataUrl && layer.dataUrl !== activeItem.dataUrl) {
          layer.dataUrl = activeItem.dataUrl;
        }
      }
      const key = (layer.type === 'video' || layer.type === 'audio') ? layer.id : (layer.mediaId || layer.id);
      if (layerMediaCache.has(key)) {
        const cachedEntry = layerMediaCache.get(key);
        if (layer.type === 'video') {
          if (layer.isMuted && cachedEntry.el) {
            try {
              cachedEntry.el.pause();
              cachedEntry.el.removeAttribute('src');
              if (typeof cachedEntry.el.load === 'function') cachedEntry.el.load();
            } catch (_) {}
            cachedEntry.el = null;
          }
          if (window.VideoFrameExtractor && !layer._extractComplete) {
            window.VideoFrameExtractor.extractLayerRange(layer);
          }
        }
        if (cachedEntry && cachedEntry.el && layer.dataUrl) {
          const curSrc = cachedEntry.el.getAttribute('src') || cachedEntry.el.src || '';
          if (!curSrc || curSrc !== layer.dataUrl) {
            cachedEntry.el._contentVersion = (cachedEntry.el._contentVersion || 0) + 1;
            cachedEntry.el.src = layer.dataUrl;
            if (typeof cachedEntry.el.load === 'function') cachedEntry.el.load();
          }
        }
        return cachedEntry;
      }

      const entry = {
        type: layer.type,
        el: null,
        poster: null,
        isReady: false,
        freezeCanvas: null,
        hasFreezeFrame: false
      };

      if (layer.type === 'image') {
        const img = new Image();
        if (layer.dataUrl && !layer.dataUrl.startsWith('blob:')) {
          img.crossOrigin = 'anonymous';
        }
        img.onload = () => {
          entry.isReady = true;
          img._contentVersion = (img._contentVersion || 0) + 1;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            layer.mediaWidth = img.naturalWidth;
            layer.mediaHeight = img.naturalHeight;
            if (!layer._userResized) {
              const curAspect = (layer.scaleW && layer.scaleH) ? (layer.scaleW / layer.scaleH) : null;
              const imgAspect = img.naturalWidth / img.naturalHeight;
              if (!curAspect || Math.abs(curAspect - imgAspect) > 0.02) {
                fitLayerToComposition(layer, img.naturalWidth, img.naturalHeight);
                if (!window.isTimelinePlaying && !window.isTimelineScrubbing && typeof saveCurrentProjectLayers === 'function') {
                  saveCurrentProjectLayers();
                }
                if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
              }
            }
          }
          if (typeof invalidatePreviewCacheForLayer === 'function' && !window.isTimelinePlaying && !window.isTimelineScrubbing) {
            invalidatePreviewCacheForLayer(layer);
          }
          if (!window.isTimelinePlaying && !window.isTimelineScrubbing) {
            redrawComposition();
          }
        };
        img.onerror = () => {
          console.warn('[Editor] Image load error for layer:', layer.id, layer.name);
          if (layer.mediaId && window.FishDatabase && typeof window.FishDatabase.getMedia === 'function') {
            window.FishDatabase.getMedia(layer.mediaId).then(m => {
              if (m) {
                if (!m.dataUrl && m.buffer) {
                  try {
                    m.blob = new Blob([m.buffer], { type: m.mimeType || 'image/png' });
                    m.dataUrl = trackStudioObjectUrl(URL.createObjectURL(m.blob));
                  } catch (_) {}
                } else if (!m.dataUrl && m.blob) {
                  try { m.dataUrl = trackStudioObjectUrl(URL.createObjectURL(m.blob)); } catch (_) {}
                }
                if (m.dataUrl && m.dataUrl !== img.src) {
                  layer.dataUrl = m.dataUrl;
                  img._contentVersion = (img._contentVersion || 0) + 1;
                  img.src = m.dataUrl;
                }
              }
            }).catch(() => {});
          }
        };
        if (layer.dataUrl) {
          img.src = layer.dataUrl;
        }
        entry.el = img;
      } else if (layer.type === 'video') {
        if (layer.thumbUrl) {
          const poster = new Image();
          poster.onload = () => {
            if (!entry.isReady && !window.isExporting) redrawComposition();
          };
          poster.src = layer.thumbUrl;
          entry.poster = poster;
        }

        // Visual frames are rendered exclusively via VideoFrameExtractor ImageBitmap sequences.
        // Only create a lightweight <audio> element if the video layer is unmuted.
        if (layer.isMuted) {
          entry.el = null;
          entry.isReady = true;
        } else {
          const vidAudio = document.createElement('audio');
          vidAudio.muted = false;
          vidAudio.loop = false;
          vidAudio.preload = 'auto';
          vidAudio.setAttribute('playsinline', 'true');
          vidAudio.setAttribute('disableremoteplayback', 'true');
          if ('disableRemotePlayback' in vidAudio) {
            try { vidAudio.disableRemotePlayback = true; } catch (_) {}
          }
          try { vidAudio.playsInline = true; } catch (_) {}

          const suppressVidAudio = () => {
            if (window.FishAudioEngine && typeof window.FishAudioEngine.suppressMediaSession === 'function') {
              window.FishAudioEngine.suppressMediaSession();
            } else if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
              try {
                navigator.mediaSession.playbackState = 'none';
                navigator.mediaSession.metadata = null;
              } catch (_) {}
            }
          };
          vidAudio.addEventListener('play', suppressVidAudio, { passive: true });
          vidAudio.addEventListener('playing', suppressVidAudio, { passive: true });

          vidAudio.onloadedmetadata = () => {
            const hasFx = Array.isArray(layer.audioEffects) && layer.audioEffects.some(fx => !fx.disabled);
            if (window.FishAudioEngine && !layer.isMuted && hasFx) {
              window.FishAudioEngine.attachMediaElement(vidAudio);
              window.FishAudioEngine.applyAudioEffects(vidAudio, layer.audioEffects);
            }
            if (isFinite(vidAudio.duration) && vidAudio.duration > 0) {
              const trueDur = vidAudio.duration;
              layer.mediaDuration = trueDur;
              if (window._activeMediaMap && layer.mediaId && window._activeMediaMap.has(layer.mediaId)) {
                const mItem = window._activeMediaMap.get(layer.mediaId);
                mItem.duration = trueDur;
                mItem._durationVerified = true;
              }
              const layers = currentProjectState.layers || [];
              let updated = false;
              const pps = window.currentPixelsPerSecond || 80;
              layers.forEach(l => {
                const matchesMedia = (l.id === layer.id || (layer.mediaId && l.mediaId === layer.mediaId) || l.mediaId === layer.id || (l.name && layer.name && l.name === layer.name));
                if (matchesMedia) {
                  l.mediaDuration = trueDur;
                  const spd = (l.speed && l.speed > 0) ? l.speed : 1.0;
                  const srcOff = l.sourceOffsetSec || 0;
                  const targetDur = Math.max(0.05, (trueDur - srcOff) / spd);
                  if (!l._userTrimmed && (!l.durationSec || Math.abs(l.durationSec - targetDur) > 0.01)) {
                    l.durationSec = targetDur;
                    l.widthPx = Math.max(10, Math.round(targetDur * pps));
                    l.isDurationExplicit = true;
                    updated = true;
                  } else if (l._userTrimmed && l.speedMode !== 'time_remap' && l.durationSec > targetDur + 0.01) {
                    l.durationSec = targetDur;
                    l.widthPx = Math.max(10, Math.round(targetDur * pps));
                    updated = true;
                  }
                }
              });
              if (updated) {
                if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
                if (typeof window.updateTimelineDuration === 'function') window.updateTimelineDuration(true);
                saveCurrentProjectLayers();
              }
            }
            entry.isReady = true;
          };

          vidAudio.oncanplay = () => {
            entry.isReady = true;
          };

          vidAudio.onerror = () => {
            if (layer.mediaId && window.FishDatabase && typeof window.FishDatabase.getMedia === 'function') {
              window.FishDatabase.getMedia(layer.mediaId).then(m => {
                if (m && m.dataUrl && m.dataUrl !== vidAudio.src) {
                  layer.dataUrl = m.dataUrl;
                  vidAudio.src = m.dataUrl;
                  vidAudio.load();
                }
              }).catch(() => {});
            }
          };

          if (layer.dataUrl) {
            vidAudio.src = layer.dataUrl;
            vidAudio.load();
          }
          entry.el = vidAudio;
        }

        const isRawMediaPoolItem = layer.id && String(layer.id).startsWith('med_') && !layer.mediaId && layer.startSec === undefined && layer.startPx === undefined;
        if (window.VideoFrameExtractor && !isRawMediaPoolItem) {
          window.VideoFrameExtractor.extractLayerRange(layer);
        }
      } else if (layer.type === 'audio') {
        const audio = document.createElement('audio');
        audio.muted = !!layer.isMuted;
        audio.loop = false;
        audio.preload = 'auto';
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('disableremoteplayback', 'true');
        if ('disableRemotePlayback' in audio) {
          try { audio.disableRemotePlayback = true; } catch (_) {}
        }
        try { audio.playsInline = true; } catch (_) {}

        const suppressAudio = () => {
          if (window.FishAudioEngine && typeof window.FishAudioEngine.suppressMediaSession === 'function') {
            window.FishAudioEngine.suppressMediaSession();
          } else if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
            try {
              navigator.mediaSession.playbackState = 'none';
              navigator.mediaSession.metadata = null;
            } catch (_) {}
          }
        };
        audio.addEventListener('play', suppressAudio, { passive: true });
        audio.addEventListener('playing', suppressAudio, { passive: true });

        audio.onloadedmetadata = () => {
          const hasFx = Array.isArray(layer.audioEffects) && layer.audioEffects.some(fx => !fx.disabled);
          if (window.FishAudioEngine && !layer.isMuted && hasFx) {
            window.FishAudioEngine.attachMediaElement(audio);
            window.FishAudioEngine.applyAudioEffects(audio, layer.audioEffects);
          }
          if (isFinite(audio.duration) && audio.duration > 0) {
            const trueDur = audio.duration;
            layer.mediaDuration = trueDur;
            if (window._activeMediaMap && layer.mediaId && window._activeMediaMap.has(layer.mediaId)) {
              const mItem = window._activeMediaMap.get(layer.mediaId);
              mItem.duration = trueDur;
              mItem._durationVerified = true;
            }
            const layers = currentProjectState.layers || [];
            let updated = false;
            const pps = window.currentPixelsPerSecond || 80;
            layers.forEach(l => {
              const matchesMedia = (l.id === layer.id || (layer.mediaId && l.mediaId === layer.mediaId) || l.mediaId === layer.id);
              if (matchesMedia) {
                l.mediaDuration = trueDur;
                const spd = (l.speed && l.speed > 0) ? l.speed : 1.0;
                const srcOff = l.sourceOffsetSec || 0;
                const targetDur = Math.max(0.05, (trueDur - srcOff) / spd);
                if (!l._userTrimmed && (!l.durationSec || Math.abs(l.durationSec - targetDur) > 0.01)) {
                  l.durationSec = targetDur;
                  l.widthPx = Math.max(10, Math.round(targetDur * pps));
                  l.isDurationExplicit = true;
                  updated = true;
                } else if (l._userTrimmed && l.speedMode !== 'time_remap' && l.durationSec > targetDur + 0.01) {
                  l.durationSec = targetDur;
                  l.widthPx = Math.max(10, Math.round(targetDur * pps));
                  updated = true;
                }
              }
            });
            if (updated) {
              if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
              if (typeof window.updateTimelineDuration === 'function') window.updateTimelineDuration(true);
              saveCurrentProjectLayers();
            }
          }
          entry.isReady = true;
        };

        audio.oncanplay = () => {
          entry.isReady = true;
        };

        audio.onseeked = () => {
          entry.isReady = true;
          if (!window.isTimelinePlaying && audio._pendingScrubTime !== null && audio._pendingScrubTime !== undefined) {
            const nextTime = audio._pendingScrubTime;
            audio._pendingScrubTime = null;
            const maxSeek = (audio.duration && !isNaN(audio.duration) && audio.duration > 0)
              ? Math.max(0, audio.duration - 0.01)
              : Infinity;
            const targetSeek = Math.min(nextTime, maxSeek);
            if (Math.abs(audio.currentTime - targetSeek) > 0.03) {
              try { audio.currentTime = targetSeek; } catch (_) {}
            }
          }
        };

        audio.onerror = (e) => {
          console.warn('[Editor] Audio load error for layer:', layer.id, e);
          if (layer.mediaId && window.FishDatabase && typeof window.FishDatabase.getMedia === 'function') {
            window.FishDatabase.getMedia(layer.mediaId).then(m => {
              if (m && m.dataUrl && m.dataUrl !== audio.src) {
                layer.dataUrl = m.dataUrl;
                audio.src = m.dataUrl;
                audio.load();
              }
            }).catch(() => {});
          }
        };

        if (layer.dataUrl) {
          audio.src = layer.dataUrl;
          audio.load();
        }
        entry.el = audio;
      }

      // Fallback async hydration if layer.dataUrl is missing or dead blob URL
      const activePoolItem = (window._activeMediaMap && layer.mediaId) ? window._activeMediaMap.get(layer.mediaId) : null;
      const isDeadBlob = layer.dataUrl && typeof layer.dataUrl === 'string' && layer.dataUrl.startsWith('blob:') &&
        (!activePoolItem || !activePoolItem.dataUrl || activePoolItem.dataUrl !== layer.dataUrl);
      if ((!layer.dataUrl || isDeadBlob) && (layer.mediaId || layer.type === 'video' || layer.type === 'audio' || layer.type === 'image') && window.FishDatabase && currentProjectState.id) {
        window.FishDatabase.getProjectMedia(currentProjectState.id).then(async medias => {
          let m = (medias || []).find(item => item.id === layer.mediaId);
          if (!m) {
            m = (medias || []).find(item => item.id === layer.id || item.name === layer.name || (item.name && layer.name && (item.name.includes(layer.name) || layer.name.includes(item.name))));
            if (m) layer.mediaId = m.id;
          }
          if (m) {
            if (!m.dataUrl && m.buffer) {
              try {
                m.blob = new Blob([m.buffer], { type: m.mimeType || '' });
                m.dataUrl = trackStudioObjectUrl(URL.createObjectURL(m.blob));
              } catch (_) {}
            } else if (!m.dataUrl && m.blob) {
              try { m.dataUrl = trackStudioObjectUrl(URL.createObjectURL(m.blob)); } catch (_) {}
            }
          }
          // Local storage/files fallback recovery if IndexedDB write was previously interrupted
          const targetName = (m && m.name) || layer.name;
          if ((!m || !m.dataUrl) && targetName) {
            try {
              const res = await fetch('/storage/files/' + encodeURIComponent(targetName));
              if (res.ok) {
                const blob = await res.blob();
                if (blob && blob.size > 64) {
                  const freshUrl = trackStudioObjectUrl(URL.createObjectURL(blob));
                  if (!m) {
                    m = {
                      id: layer.mediaId || ('med_rec_' + Date.now()),
                      projectId: currentProjectState.id,
                      name: targetName,
                      type: layer.type || 'video',
                      mimeType: blob.type || (layer.type === 'video' ? 'video/mp4' : ''),
                      size: blob.size,
                      blob: blob,
                      dataUrl: freshUrl,
                      duration: layer.mediaDuration || layer.durationSec || 5,
                      width: layer.mediaWidth || null,
                      height: layer.mediaHeight || null,
                      createdAt: new Date().toISOString()
                    };
                    layer.mediaId = m.id;
                  } else {
                    m.blob = blob;
                    m.dataUrl = freshUrl;
                  }
                  if (window.FishDatabase && typeof window.FishDatabase.saveMedia === 'function') {
                    window.FishDatabase.saveMedia(m).catch(() => {});
                  }
                  if (typeof window.refreshProjectMediaGrid === 'function') {
                    window.refreshProjectMediaGrid();
                  }
                }
              }
            } catch (_) {}
          }
          if (m && m.dataUrl) {
            layer.dataUrl = m.dataUrl;
            window._activeMediaMap = window._activeMediaMap || new Map();
            window._activeMediaMap.set(m.id, m);
            if (entry.el && entry.el.src !== m.dataUrl) {
              entry.el._contentVersion = (entry.el._contentVersion || 0) + 1;
              entry.el.src = m.dataUrl;
              if (typeof entry.el.load === 'function') entry.el.load();
            }
            const isPoolOnly = layer.id && String(layer.id).startsWith('med_') && !layer.mediaId && layer.startSec === undefined && layer.startPx === undefined;
            if ((layer.type === 'video' || layer.type === 'precomp') && window.VideoFrameExtractor && !isPoolOnly) {
              window.VideoFrameExtractor.extractLayerRange(layer);
            }
            if (typeof redrawComposition === 'function') {
              redrawComposition('mediaHydrated');
            }
          }
        }).catch(() => {});
      }

      layerMediaCache.set(key, entry);
      return entry;
    }
    window.getOrLoadLayerMedia = getOrLoadLayerMedia;

    function setActivePreviewMedia(item) {
      if (!item) {
        redrawComposition('setActivePreviewMedia:null');
        return;
      }
      if (item.startSec !== undefined || item.startPx !== undefined || item.mediaId) {
        getOrLoadLayerMedia(item);
      }
      redrawComposition('setActivePreviewMedia');
    }
    window.setActivePreviewMedia = setActivePreviewMedia;

    // Ultra-Fast Flat Placeholder Canvas Generator for unready video layers
    let _unreadyPlaceholderCanvas = null;
    let _lastPlaceholderW = 0;
    let _lastPlaceholderH = 0;
    let _lastPlaceholderProgress = -1;
    let _lastPlaceholderStatus = '';

    function getMediaNotReadyPlaceholder(w = 640, h = 360, progress = 0, customStatus = '') {
      const targetW = Math.max(320, Math.min(1920, Math.round(w)));
      const targetH = Math.max(180, Math.min(1080, Math.round(h)));
      const pct = Math.round((progress || 0) * 100);

      if (!_unreadyPlaceholderCanvas) {
        _unreadyPlaceholderCanvas = document.createElement('canvas');
      }
      if (_unreadyPlaceholderCanvas.width !== targetW || _unreadyPlaceholderCanvas.height !== targetH || _lastPlaceholderProgress !== pct || _lastPlaceholderStatus !== customStatus) {
        _unreadyPlaceholderCanvas.width = targetW;
        _unreadyPlaceholderCanvas.height = targetH;
        _lastPlaceholderProgress = pct;
        _lastPlaceholderStatus = customStatus;

        const pctx = _unreadyPlaceholderCanvas.getContext('2d');
        if (pctx) {
          const rootStyle = (typeof window !== 'undefined' && window.getComputedStyle) ? window.getComputedStyle(document.documentElement) : null;
          const bgPanel = (rootStyle && rootStyle.getPropertyValue('--bg-panel').trim()) || '#141814';
          const bgPanelInner = (rootStyle && rootStyle.getPropertyValue('--bg-panel-inner').trim()) || '#1c221c';
          const borderSubtle = (rootStyle && rootStyle.getPropertyValue('--border-subtle').trim()) || '#222c22';
          const colorPrimary = (rootStyle && rootStyle.getPropertyValue('--color-primary').trim()) || '#98ce7b';
          const textSec = (rootStyle && rootStyle.getPropertyValue('--text-secondary').trim()) || '#c5d2c0';
          const textMuted = (rootStyle && rootStyle.getPropertyValue('--text-muted').trim()) || '#788874';

          // Flat background surface (CSS token: var(--bg-panel))
          pctx.fillStyle = bgPanel;
          pctx.fillRect(0, 0, targetW, targetH);

          // Flat subtle border (CSS token: var(--border-subtle))
          pctx.strokeStyle = borderSubtle;
          pctx.lineWidth = Math.max(1, Math.round(targetW / 400));
          pctx.strokeRect(2, 2, targetW - 4, targetH - 4);

          const cx = targetW / 2;
          const cy = targetH / 2;

          // Geometric film strip badge (CSS token: var(--bg-panel-inner) / var(--border-subtle))
          const iconW = Math.max(28, Math.min(64, Math.round(targetW * 0.09)));
          const iconH = Math.round(iconW * 0.72);
          const ix = cx - iconW / 2;
          const iy = cy - iconH - 12;

          pctx.fillStyle = bgPanelInner;
          pctx.fillRect(ix, iy, iconW, iconH);
          pctx.strokeStyle = borderSubtle;
          pctx.lineWidth = 1;
          pctx.strokeRect(ix, iy, iconW, iconH);

          // Play triangle icon (CSS token: var(--color-primary))
          pctx.fillStyle = colorPrimary;
          pctx.beginPath();
          const tw = iconW * 0.32;
          const th = iconH * 0.45;
          pctx.moveTo(cx - tw * 0.35, iy + (iconH - th) / 2);
          pctx.lineTo(cx + tw * 0.65, iy + iconH / 2);
          pctx.lineTo(cx - tw * 0.35, iy + (iconH + th) / 2);
          pctx.closePath();
          pctx.fill();

          // Title: "Video is not ready yet" (Cal Sans, CSS token: var(--text-secondary))
          const fontSize = Math.max(14, Math.min(24, Math.round(targetW * 0.04)));
          pctx.font = `600 ${fontSize}px "Cal Sans", sans-serif`;
          pctx.fillStyle = textSec;
          pctx.textAlign = 'center';
          pctx.textBaseline = 'middle';
          pctx.fillText('Video is not ready yet', cx, cy + 8);

          // Subtitle / Progress (CSS token: var(--text-muted) / var(--color-primary))
          const subFontSize = Math.max(11, Math.min(15, Math.round(fontSize * 0.75)));
          pctx.font = `500 ${subFontSize}px "Cal Sans", sans-serif`;
          pctx.fillStyle = pct > 0 ? colorPrimary : textMuted;
          const defaultText = pct > 0 ? `Preparing frames... ${pct}%` : 'Extracting image sequence...';
          const statusText = customStatus ? (pct > 0 ? `${customStatus} ${pct}%` : customStatus) : defaultText;
          pctx.fillText(statusText, cx, cy + 12 + fontSize);

          // Visual Progress Bar (clean flat track & fill)
          const barW = Math.max(140, Math.min(360, Math.round(targetW * 0.45)));
          const barH = Math.max(4, Math.round(targetH * 0.018));
          const barX = cx - barW / 2;
          const barY = cy + 18 + fontSize + subFontSize;
          pctx.fillStyle = bgPanelInner;
          pctx.fillRect(barX, barY, barW, barH);
          if (pct > 0) {
            pctx.fillStyle = colorPrimary;
            pctx.fillRect(barX, barY, Math.round(barW * (pct / 100)), barH);
          }
        }
      }
      return _unreadyPlaceholderCanvas;
    }
    window.getMediaNotReadyPlaceholder = getMediaNotReadyPlaceholder;

    // Generate unique cache key for layer fill rendering
    function getFillRenderKey(layer) {
      if (!layer) return '';
      const stopsKey = Array.isArray(layer.fillGradStops) ? layer.fillGradStops.map(s => `${s.offset}_${s.color}`).join(';') : '';
      return `${layer.fillType || 'none'}:${layer.fillColor || ''}:${layer.fillGradType || ''}:${layer.fillGradAngle || ''}:${stopsKey}:${layer.fillGradColor1 || ''}:${layer.fillGradColor2 || ''}:${layer.fillMediaId || ''}:${layer.fillMediaUrl || layer.dataUrl || ''}:${layer.mediaWidth || ''}:${layer.mediaHeight || ''}:${layer.fillMediaFit || 'fill'}`;
    }

    // Draw image/video element into a target box using fitMode ('fill' | 'fit' | 'stretch')
    function drawElementWithMediaFit(ctx, el, boxX, boxY, boxW, boxH, fitMode) {
      if (!ctx || !el) return;
      const iw = el.videoWidth || el.naturalWidth || el.width || boxW;
      const ih = el.videoHeight || el.naturalHeight || el.height || boxH;
      if (!iw || !ih || !boxW || !boxH) return;
      const mode = fitMode || 'fill';
      if (mode === 'stretch') {
        ctx.drawImage(el, boxX, boxY, boxW, boxH);
        return;
      }
      if (mode === 'fit') {
        const scale = Math.min(boxW / iw, boxH / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = boxX + (boxW - dw) / 2;
        const dy = boxY + (boxH - dh) / 2;
        ctx.drawImage(el, dx, dy, dw, dh);
        return;
      }
      // Default: 'fill' (aspect-ratio-preserving cover crop)
      const scale = Math.max(boxW / iw, boxH / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = boxX + (boxW - dw) / 2;
      const dy = boxY + (boxH - dh) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(boxX, boxY, boxW, boxH);
      ctx.clip();
      ctx.drawImage(el, dx, dy, dw, dh);
      ctx.restore();
    }
    window.drawElementWithMediaFit = drawElementWithMediaFit;

    // Return fitted canvas element for native image/video layers when aspect ratio differs and fitMode is 'fill' or 'fit'
    function getFittedMediaElement(layer, el, boxW, boxH) {
      if (!layer || !el || (layer.type !== 'image' && layer.type !== 'video')) return el;
      if (el === _unreadyPlaceholderCanvas) return el;
      const fitMode = layer.fillMediaFit || 'fill';
      if (fitMode === 'stretch') return el;
      const iw = el.videoWidth || el.naturalWidth || el.width || 0;
      const ih = el.videoHeight || el.naturalHeight || el.height || 0;
      const bw = Math.abs(Number(boxW) || 0);
      const bh = Math.abs(Number(boxH) || 0);
      if (iw <= 0 || ih <= 0 || bw <= 0 || bh <= 0) return el;
      const srcRatio = iw / ih;
      const dstRatio = bw / bh;
      if (Math.abs(srcRatio - dstRatio) < 0.005) return el;

      const maxSide = Math.min(2048, Math.max(iw, ih, Math.round(bw), Math.round(bh)));
      const cw = dstRatio >= 1 ? maxSide : Math.max(1, Math.round(maxSide * dstRatio));
      const ch = dstRatio >= 1 ? Math.max(1, Math.round(maxSide / dstRatio)) : maxSide;

      if (!layer._mediaFitCanvas || !(layer._mediaFitCanvas instanceof HTMLCanvasElement)) {
        layer._mediaFitCanvas = document.createElement('canvas');
      }
      const fc = layer._mediaFitCanvas;
      const isDynamicVideo = (el && el.tagName === 'VIDEO') || layer.type === 'video' || (typeof ImageBitmap !== 'undefined' && el instanceof ImageBitmap && layer.type !== 'image');
      const fitKey = isDynamicVideo ? '' : `${fitMode}:${cw}x${ch}:${iw}x${ih}:${layer.mediaId || ''}:${layer.fillMediaId || ''}:${el.src || ''}:${layer._contentVersion || 0}`;
      if (!isDynamicVideo && fc._lastFitKey === fitKey && fc.width === cw && fc.height === ch) {
        return fc;
      }
      if (fc.width !== cw || fc.height !== ch) {
        fc.width = cw;
        fc.height = ch;
      }
      const fctx = fc.getContext('2d');
      if (!fctx) return el;
      fctx.clearRect(0, 0, cw, ch);
      drawElementWithMediaFit(fctx, el, 0, 0, cw, ch, fitMode);
      fc._lastFitKey = isDynamicVideo ? null : fitKey;
      return fc;
    }
    window.getFittedMediaElement = getFittedMediaElement;

    // Dynamic Fill Canvas Generator (No Fill, Solid Color, Project Media, Linear/Radial Gradient)
    function getOrUpdateLayerFillCanvas(layer, width = 1920, height = 1080) {
      const targetW = Math.max(1, Math.round(width));
      const targetH = Math.max(1, Math.round(height));
      if (!layer._fillBufferCanvas || !(layer._fillBufferCanvas instanceof HTMLCanvasElement) || typeof layer._fillBufferCanvas.getContext !== 'function') {
        layer._fillBufferCanvas = document.createElement('canvas');
      }
      const canvas = layer._fillBufferCanvas;
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        layer._fillDirty = true;
      }

      const currentKey = getFillRenderKey(layer);
      if (!layer._fillDirty && layer._lastFillRenderKey === currentKey) {
        return canvas;
      }

      const fctx = canvas.getContext('2d');
      if (!fctx) return canvas;

      fctx.clearRect(0, 0, targetW, targetH);

      const fillType = layer.fillType || 'none';
      if (fillType === 'color') {
        fctx.fillStyle = layer.fillColor || '#98ce7b';
        fctx.fillRect(0, 0, targetW, targetH);
      } else if (fillType === 'gradient') {
        const stops = (Array.isArray(layer.fillGradStops) && layer.fillGradStops.length >= 2)
          ? [...layer.fillGradStops].sort((a, b) => a.offset - b.offset)
          : [
              { offset: 0, color: layer.fillGradColor1 || '#000000' },
              { offset: 1, color: layer.fillGradColor2 || '#ffffff' }
            ];
        const gradType = layer.fillGradType || 'linear';
        const angleDeg = (layer.fillGradAngle !== undefined) ? Number(layer.fillGradAngle) : 90;

        let grad = null;
        if (gradType === 'radial') {
          const cx = targetW / 2;
          const cy = targetH / 2;
          const r = Math.max(targetW, targetH) / 2;
          grad = fctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        } else if (gradType === 'sweep' && typeof fctx.createConicGradient === 'function') {
          const cx = targetW / 2;
          const cy = targetH / 2;
          const rad = (angleDeg - 90) * (Math.PI / 180);
          grad = fctx.createConicGradient(rad, cx, cy);
        } else {
          const rad = (angleDeg - 90) * (Math.PI / 180);
          const cx = targetW / 2;
          const cy = targetH / 2;
          const dist = Math.sqrt(targetW * targetW + targetH * targetH) / 2;
          const x0 = cx - Math.cos(rad) * dist;
          const y0 = cy - Math.sin(rad) * dist;
          const x1 = cx + Math.cos(rad) * dist;
          const y1 = cy + Math.sin(rad) * dist;
          grad = fctx.createLinearGradient(x0, y0, x1, y1);
        }

        stops.forEach(s => {
          const off = Math.max(0, Math.min(1, Number(s.offset) || 0));
          grad.addColorStop(off, s.color || '#000000');
        });

        fctx.fillStyle = grad;
        fctx.fillRect(0, 0, targetW, targetH);
      } else if (fillType === 'media') {
        const mediaUrl = layer.fillMediaUrl || layer.thumbUrl || (layer.dataUrl && !layer.dataUrl.startsWith('data:video') ? layer.dataUrl : '');
        const cachedEntry = window.layerMediaCache ? (window.layerMediaCache.get(layer.id) || (layer.mediaId ? window.layerMediaCache.get(layer.mediaId) : null) || (layer.fillMediaId ? window.layerMediaCache.get(layer.fillMediaId) : null)) : null;
        const fitMode = layer.fillMediaFit || 'fill';
        let boxX = 0;
        let boxY = 0;
        let boxW = targetW;
        let boxH = targetH;
        const getVecBoundsFn = window.getVectorLocalBounds || window.computeVectorPathTightBounds;
        if (layer.type === 'shape' && layer.shapeType === 'vector' && typeof getVecBoundsFn === 'function') {
          const vBounds = getVecBoundsFn(layer.shapeProps || {});
          if (vBounds && vBounds.width > 0.5 && vBounds.height > 0.5) {
            boxW = vBounds.width;
            boxH = vBounds.height;
            boxX = (targetW / 2) + vBounds.minX;
            boxY = (targetH / 2) + vBounds.minY;
          }
        }
        if (cachedEntry && cachedEntry.el && cachedEntry.isReady && cachedEntry.el.tagName === 'IMG') {
          drawElementWithMediaFit(fctx, cachedEntry.el, boxX, boxY, boxW, boxH, fitMode);
        } else if (layer._fillMediaImg && layer._fillMediaImg.complete && layer._fillMediaImg.naturalWidth > 0 && layer._fillMediaImg.src === mediaUrl) {
          drawElementWithMediaFit(fctx, layer._fillMediaImg, boxX, boxY, boxW, boxH, fitMode);
        } else if (mediaUrl && !mediaUrl.startsWith('data:video')) {
          if (!layer._fillMediaImg || layer._fillMediaImg.src !== mediaUrl) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              layer._fillMediaImg = img;
              layer._fillDirty = true;
              if (layer._shapeBufferCanvas) {
                layer._shapeBufferCanvas._lastShapeKey = null;
              }
              if (typeof redrawComposition === 'function') redrawComposition('fill-media-loaded');
            };
            img.src = mediaUrl;
            layer._fillMediaImg = img;
          }
        }
      }
      // 'none' leaves canvas cleared transparently

      const cachedEntry = window.layerMediaCache ? (window.layerMediaCache.get(layer.id) || (layer.mediaId ? window.layerMediaCache.get(layer.mediaId) : null) || (layer.fillMediaId ? window.layerMediaCache.get(layer.fillMediaId) : null)) : null;
      const isMediaReady = (fillType !== 'media') ||
        (cachedEntry && cachedEntry.el && cachedEntry.isReady) ||
        (layer._fillMediaImg && layer._fillMediaImg.complete && layer._fillMediaImg.naturalWidth > 0);
      if (isMediaReady) {
        layer._fillDirty = false;
        layer._lastFillRenderKey = currentKey;
      }
      return canvas;
    }
    window.getFillRenderKey = getFillRenderKey;
    window.getOrUpdateLayerFillCanvas = getOrUpdateLayerFillCanvas;


    function getSelectedLayerForFill() {
      return (currentProjectState.layers || []).find(l => l.id === window.selectedLayerId);
    }
    window.getSelectedLayerForFill = getSelectedLayerForFill;

    function getLayerDefaultFillType(layer) {
      if (!layer) return 'none';
      if (layer.fillType) return layer.fillType;
      // Default based on layer characteristics
      if (layer.type === 'image' || layer.type === 'video' || layer.type === 'precomp' || layer.dataUrl || layer.mediaId || layer.fillMediaUrl) {
        return 'media';
      }
      if (layer.type === 'shape' || layer.type === 'text' || layer.fillColor) {
        return 'color';
      }
      return 'none';
    }
    window.getLayerDefaultFillType = getLayerDefaultFillType;

    async function applyFlexibleMediaReplacement(targetLayerInput, item) {
      if (!targetLayerInput || !item) return;

      let targetL = targetLayerInput;
      // If the user tries to replace a precomp layer from the outside, drill down and replace its inner media content instead
      if (targetL.type === 'precomp' && Array.isArray(targetL.layers) && targetL.layers.length > 0) {
        const innerMediaLayer = targetL.layers.find(l => l.type === 'image' || l.type === 'video' || l.fillType === 'media');
        if (innerMediaLayer) {
          targetL = innerMediaLayer;
        } else {
          targetL = targetL.layers[0];
        }
      }

      targetL.fillType = 'media';
      targetL.fillMediaFit = targetL.fillMediaFit || 'fill';
      targetL.fillMediaId = item.id;
      targetL.fillMediaName = item.name || 'Media';
      targetL.fillMediaUrl = item.thumbUrl || item.dataUrl || '';
      targetL._fillMediaImg = null;
      targetL._fillDirty = true;
      if (targetL._mediaFitCanvas) targetL._mediaFitCanvas._lastFitKey = null;

      const oldType = targetL.type;

      // 1. Release old layer media element and clean up GPU buffers/cache
      if (typeof window.releaseLayerMediaElement === 'function') {
        window.releaseLayerMediaElement(targetL);
      } else {
        if (window.FishAudioEngine && window.layerMediaCache) {
          const oldEntry = window.layerMediaCache.get(targetL.id) || (targetL.mediaId ? window.layerMediaCache.get(targetL.mediaId) : null);
          if (oldEntry && oldEntry.el) {
            try {
              window.FishAudioEngine.detachMediaElement(oldEntry.el);
              if (!oldEntry.el.paused) oldEntry.el.pause();
            } catch (_) {}
          }
        }
        if (window.layerMediaCache) {
          window.layerMediaCache.delete(targetL.id);
          if (targetL.mediaId) window.layerMediaCache.delete(targetL.mediaId);
        }
      }

      const isShape = (targetL.type === 'shape') || !!targetL.shapeType || !!targetL.shapeProps || (targetL.id && targetL.id.startsWith('layer_shape_'));
      const isAudio = item.type === 'audio' ||
        (item.dataUrl && (item.dataUrl.startsWith('data:audio') || /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(item.dataUrl))) ||
        (item.name && /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(item.name));
      const isVideo = item.type === 'video' ||
        (item.dataUrl && (item.dataUrl.startsWith('data:video') || /\.(mp4|webm|mov|mkv)(\?.*)?$/i.test(item.dataUrl))) ||
        (item.name && /\.(mp4|webm|mov|mkv)$/i.test(item.name));

      const newType = item.type || (item.layers ? 'precomp' : (isAudio ? 'audio' : (isVideo ? 'video' : 'image')));

      if (!isShape) {
        if (typeof targetL.scaleW === 'number' && Math.abs(targetL.scaleW) > 0 &&
            typeof targetL.scaleH === 'number' && Math.abs(targetL.scaleH) > 0) {
          targetL._userResized = true;
        }
        targetL.fillType = 'media';
        targetL.type = newType;
        targetL.mediaId = item.id;
        if (item.name) targetL.name = item.name;
        // Break cut-linkage to old sibling: this layer now has its own unique media source
        targetL.sourceLayerId = targetL.id;
        targetL.sourceOffsetSec = 0;

        if (newType === 'precomp') {
          targetL.layers = Array.isArray(item.layers) ? (window.UndoRedoManager && window.UndoRedoManager._safeClone ? window.UndoRedoManager._safeClone(item.layers) : (Array.isArray(item.layers) ? [] : {})) : (targetL.layers || []);
          targetL.thumbUrl = item.thumbUrl || '';
          targetL.dataUrl = item.dataUrl || '';
          delete targetL._precompBufferCanvas;
          if (isFinite(item.duration) && item.duration > 0) {
            targetL.mediaDuration = item.duration;
            if (!targetL.isDurationExplicit) {
              targetL.durationSec = item.duration;
              const pps = window.currentPixelsPerSecond || 80;
              targetL.widthPx = Math.max(80, Math.round(item.duration * pps));
            }
          }
          if (item.width && item.height) {
            targetL.mediaWidth = item.width;
            targetL.mediaHeight = item.height;
            targetL.scaleW = item.width;
            targetL.scaleH = item.height;
          }
        } else if (newType === 'video') {
          targetL.dataUrl = item.dataUrl || '';
          targetL.thumbUrl = item.thumbUrl || '';
          delete targetL.layers;
          delete targetL._precompBufferCanvas;
          if (item.width && item.height) {
            targetL.mediaWidth = item.width;
            targetL.mediaHeight = item.height;
          }
          if (typeof getOrLoadLayerMedia === 'function') {
            const mediaEntry = getOrLoadLayerMedia(targetL);
            if (mediaEntry && mediaEntry.el) {
              mediaEntry.el.src = targetL.dataUrl;
              mediaEntry.el.load();
            }
          }
        } else if (newType === 'audio') {
          targetL.dataUrl = item.dataUrl || '';
          targetL.thumbUrl = item.thumbUrl || '';
          delete targetL.layers;
          delete targetL._precompBufferCanvas;
          if (isFinite(item.duration) && item.duration > 0) {
            targetL.mediaDuration = item.duration;
            if (!targetL.isDurationExplicit) {
              targetL.durationSec = item.duration;
              const pps = window.currentPixelsPerSecond || 80;
              targetL.widthPx = Math.max(80, Math.round(item.duration * pps));
            }
          }
          if (typeof getOrLoadLayerMedia === 'function') {
            const mediaEntry = getOrLoadLayerMedia(targetL);
            if (mediaEntry && mediaEntry.el) {
              mediaEntry.el.src = targetL.dataUrl;
              mediaEntry.el.load();
            }
          }
        } else {
          // image
          targetL.dataUrl = item.dataUrl || '';
          targetL.thumbUrl = item.thumbUrl || item.dataUrl || '';
          delete targetL.layers;
          delete targetL._precompBufferCanvas;
          if (typeof getOrLoadLayerMedia === 'function') {
            const mediaEntry = getOrLoadLayerMedia(targetL);
            const img = new Image();
            img.onload = () => {
              if (mediaEntry) {
                mediaEntry.isReady = true;
                mediaEntry.el = img;
              }
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                targetL.mediaWidth = img.naturalWidth;
                targetL.mediaHeight = img.naturalHeight;
                if (!targetL._userResized && typeof fitLayerToComposition === 'function') {
                  fitLayerToComposition(targetL, img.naturalWidth, img.naturalHeight);
                }
              }
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(targetL);
              if (typeof redrawComposition === 'function') redrawComposition('fill-media-img-loaded');
            };
            img.src = targetL.dataUrl;
            if (mediaEntry) {
              mediaEntry.el = img;
              mediaEntry.type = 'image';
            }
          }
        }
      } else {
        // Shape layer filled with media (strictly static thumbnail fill — NEVER play video)
        targetL.type = 'shape';
        targetL.fillType = 'media';
        targetL.fillMediaId = item.id;
        targetL.fillMediaName = item.name || 'Media';
        if (item.name) targetL.name = item.name;
        delete targetL.mediaId; // Strict: do not assign mediaId so playback engine never plays it
        targetL.sourceLayerId = targetL.id;
        targetL.sourceOffsetSec = 0;
        delete targetL._fillBufferCanvas;
        delete targetL._fillMediaImg;
        if (targetL._shapeBufferCanvas) {
          targetL._shapeBufferCanvas._lastShapeKey = null;
        }
        delete targetL._shapeBufferCanvas;
        targetL._fillDirty = true;

        const thumbSrc = (item.thumbUrl && !item.thumbUrl.startsWith('data:video')) ? item.thumbUrl : '';
        if (isVideo) {
          targetL.fillMediaUrl = thumbSrc;
          targetL.thumbUrl = thumbSrc;
          targetL.dataUrl = thumbSrc;
          if (!thumbSrc && item.dataUrl && typeof captureVideoThumbnail === 'function') {
            captureVideoThumbnail(null, item.dataUrl).then(thumb => {
              if (thumb) {
                item.thumbUrl = thumb;
                targetL.fillMediaUrl = thumb;
                targetL.thumbUrl = thumb;
                targetL._fillDirty = true;
                if (targetL._shapeBufferCanvas) targetL._shapeBufferCanvas._lastShapeKey = null;
                if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(targetL);
                if (typeof redrawComposition === 'function') redrawComposition('fill-media-loaded');
              }
            });
          }
        } else {
          const freshMediaUrl = item.thumbUrl || item.dataUrl || '';
          targetL.fillMediaUrl = freshMediaUrl;
          targetL.dataUrl = item.dataUrl || '';
          targetL.thumbUrl = item.thumbUrl || item.dataUrl || '';

          if (freshMediaUrl && !freshMediaUrl.startsWith('data:video')) {
            const preImg = new Image();
            preImg.crossOrigin = 'anonymous';
            preImg.onload = () => {
              targetL._fillMediaImg = preImg;
              targetL._fillDirty = true;
              if (targetL._shapeBufferCanvas) targetL._shapeBufferCanvas._lastShapeKey = null;
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(targetL);
              if (typeof redrawComposition === 'function') redrawComposition('fill-media-img-ready');
            };
            preImg.src = freshMediaUrl;
          }
        }
      }

      // Update Edit Group button visibility if precomp
      const btnEditGroup = document.getElementById('btn-layer-edit-group');
      if (btnEditGroup) {
        btnEditGroup.style.display = (targetL.type === 'precomp') ? 'inline-flex' : 'none';
      }

      if (typeof invalidatePreviewCacheForLayer === 'function') {
        invalidatePreviewCacheForLayer(targetL);
        if (targetLayerInput && targetLayerInput.id !== targetL.id) {
          invalidatePreviewCacheForLayer(targetLayerInput);
        }
      }
      if (typeof saveCurrentProjectLayers === 'function') await saveCurrentProjectLayers(true);
      if (window.FishDatabase && currentProjectState && currentProjectState.id) {
        try { await window.FishDatabase.saveProject(currentProjectState); } catch (_) {}
      }
      if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
      if (typeof updateVolumeAndSpeedBtnState === 'function') updateVolumeAndSpeedBtnState(targetL);
      if (typeof updateCutBarRowState === 'function') updateCutBarRowState();
      if (typeof redrawComposition === 'function') redrawComposition('fill-media-swapped');
    }
    window.applyFlexibleMediaReplacement = applyFlexibleMediaReplacement;

    async function renderFillMediaPool() {
      const grid = document.getElementById('fill-media-pool-grid');
      if (!grid) return;

      const layer = getSelectedLayerForFill();
      const currentMediaId = layer ? (layer.fillMediaId || layer.mediaId) : null;
      const currentMediaUrl = layer ? (layer.fillMediaUrl || layer.thumbUrl || layer.dataUrl) : null;

      const projectId = currentProjectState.id;
      let mediaItems = [];
      try {
        if (window.FishDatabase && typeof window.FishDatabase.getProjectMedia === 'function') {
          mediaItems = await window.FishDatabase.getProjectMedia(projectId);
        }
      } catch (_) {
        mediaItems = [];
      }

      grid.innerHTML = '';

      // 1. Import (+) Tile
      const importTile = document.createElement('button');
      importTile.type = 'button';
      importTile.className = 'fill-media-import-tile';
      importTile.title = 'Import Image / Video';
      importTile.setAttribute('aria-label', 'Import Media');
      importTile.innerHTML = `
        <span class="fill-media-thumbbox fill-media-import-box"><i class="fticon fticon-icon-23" style="width:22px;height:22px;font-size:22px;line-height:1;" aria-hidden="true"></i></span>
        <span class="fill-media-name">Import</span>
      `;
      importTile.addEventListener('click', (e) => {
        e.stopPropagation();
        const fileInput = document.getElementById('fill-media-file-input');
        if (fileInput) fileInput.click();
      });
      grid.appendChild(importTile);

      // 2. Render Project Media Items
      mediaItems.forEach(item => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'fill-media-tile';
        tile.title = item.name || 'Media Item';
        tile.dataset.mediaId = item.id;

        const isSelected = (currentMediaId && currentMediaId === item.id) ||
                           (currentMediaUrl && (currentMediaUrl === item.dataUrl || currentMediaUrl === item.thumbUrl));
        if (isSelected) {
          tile.classList.add('is-active');
        }

        const isAudioItem = item.type === 'audio' ||
          (item.dataUrl && item.dataUrl.startsWith('data:audio')) ||
          (item.name && /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(item.name));
        const isVideoItem = item.type === 'video' ||
          (item.dataUrl && (item.dataUrl.startsWith('data:video') || /\.(mp4|webm|mov|mkv)(\?.*)?$/i.test(item.dataUrl))) ||
          (item.name && /\.(mp4|webm|mov|mkv)$/i.test(item.name));

        let thumbboxHtml = '';
        if (isAudioItem) {
          thumbboxHtml = `<div class="fill-media-fallback fill-media-audio-fallback" title="${item.name || 'Audio'}">
            <i class='fticon fticon-track-audio' style='width:20px;height:20px;font-size:20px;line-height:1;' aria-hidden='true'></i>
          </div>`;
        } else if (isVideoItem) {
          const thumbSrc = item.thumbUrl || '';
          if (thumbSrc && !thumbSrc.startsWith('data:video')) {
            thumbboxHtml = `<img src="${thumbSrc}" class="fill-media-thumb" alt="${item.name || ''}" loading="lazy">`;
          } else {
            thumbboxHtml = `
              <div class="fill-media-fallback fill-media-vid-fallback" title="${item.name || 'Video'}">
                <i class='fticon fticon-icon' style='width:20px;height:20px;font-size:20px;line-height:1;' aria-hidden='true'></i>
              </div>
            `;
            if (item.dataUrl && typeof captureVideoThumbnail === 'function') {
              captureVideoThumbnail(null, item.dataUrl).then(thumb => {
                if (thumb) {
                  item.thumbUrl = thumb;
                  if (window.FishDatabase && typeof window.FishDatabase.saveMedia === 'function') {
                    window.FishDatabase.saveMedia(item).catch(() => {});
                  }
                  const fallback = tile.querySelector('.fill-media-vid-fallback');
                  if (fallback) {
                    const img = document.createElement('img');
                    img.className = 'fill-media-thumb';
                    img.src = thumb;
                    img.alt = item.name || '';
                    fallback.replaceWith(img);
                  }
                }
              });
            }
          }
        } else {
          // image or precomp
          const thumbUrl = item.thumbUrl || item.dataUrl || '';
          if (thumbUrl && !thumbUrl.startsWith('data:video')) {
            thumbboxHtml = `<img src="${thumbUrl}" class="fill-media-thumb" alt="${item.name || ''}" loading="lazy">`;
          } else {
            thumbboxHtml = `<div class="fill-media-fallback">${item.name ? item.name.slice(0, 4) : 'MED'}</div>`;
          }
        }
        const badge = isVideoItem ? 'VID' : (item.type === 'precomp' ? 'COMP' : (isAudioItem ? 'AUD' : 'IMG'));
        const mediaName = item.name || badge;
        tile.innerHTML = `<span class="fill-media-thumbbox">${thumbboxHtml}<span class="fill-media-badge">${badge}</span></span><span class="fill-media-name" title="${item.name || badge}">${mediaName}</span>`;

        tile.addEventListener('click', async (e) => {
          e.stopPropagation();
          const targetL = getSelectedLayerForFill();
          if (!targetL) return;

          await applyFlexibleMediaReplacement(targetL, item);

          grid.querySelectorAll('.fill-media-tile').forEach(t => t.classList.remove('is-active'));
          tile.classList.add('is-active');
        });

        grid.appendChild(tile);
      });
    }
    window.renderFillMediaPool = renderFillMediaPool;

    // Color interpolation for adding gradient stops
    function interpolateHexColor(color1, color2, t) {
      function hexToRgbSimple(hex) {
        let c = (hex || '#000000').replace('#', '').trim();
        if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        const num = parseInt(c, 16) || 0;
        return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
      }
      const c1 = hexToRgbSimple(color1);
      const c2 = hexToRgbSimple(color2);
      const r = Math.round(c1.r + (c2.r - c1.r) * t);
      const g = Math.round(c1.g + (c2.g - c1.g) * t);
      const b = Math.round(c1.b + (c2.b - c1.b) * t);
      const toHex = n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0').toUpperCase();
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
    window.interpolateHexColor = interpolateHexColor;

    let activeGradStopIndex = 0;

    function ensureLayerGradStops(layer) {
      if (!layer) return [];
      if (!Array.isArray(layer.fillGradStops) || layer.fillGradStops.length < 2) {
        layer.fillGradStops = [
          { offset: 0, color: layer.fillGradColor1 || '#000000' },
          { offset: 1, color: layer.fillGradColor2 || '#ffffff' }
        ];
      }
      layer.fillGradStops.forEach(s => {
        s.offset = Math.max(0, Math.min(1, Number(s.offset) || 0));
        if (!s.color) s.color = '#000000';
      });
      layer.fillGradColor1 = layer.fillGradStops[0].color;
      layer.fillGradColor2 = layer.fillGradStops[layer.fillGradStops.length - 1].color;
      return layer.fillGradStops;
    }
    window.ensureLayerGradStops = ensureLayerGradStops;

    function getTrackGradientCss(stops) {
      const sorted = [...stops].sort((a, b) => a.offset - b.offset);
      const stopsStr = sorted.map(s => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ');
      return `linear-gradient(90deg, ${stopsStr})`;
    }
    window.getTrackGradientCss = getTrackGradientCss;

    function renderGradHandles(layer) {
      const container = document.getElementById('fill-grad-handles-container');
      const trackBar = document.getElementById('fill-grad-track-bar');
      if (!container || !layer) return;

      const stops = ensureLayerGradStops(layer);
      if (activeGradStopIndex < 0 || activeGradStopIndex >= stops.length) {
        activeGradStopIndex = 0;
      }

      // Update track bar background
      if (trackBar) {
        trackBar.style.background = getTrackGradientCss(stops);
      }

      container.innerHTML = '';

      stops.forEach((stop, idx) => {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'fill-grad-handle';
        handle.style.left = (stop.offset * 100) + '%';
        handle.style.backgroundColor = stop.color;
        handle.title = `Stop ${idx + 1} (${Math.round(stop.offset * 100)}%) - Hold to delete`;
        handle.setAttribute('aria-label', `Stop ${idx + 1}`);

        if (stop.offset <= 0.05) {
          handle.classList.add('is-stop-first');
        } else if (stop.offset >= 0.95) {
          handle.classList.add('is-stop-last');
        } else {
          handle.classList.add('is-stop-mid');
        }

        if (idx === activeGradStopIndex) {
          handle.classList.add('is-active');
        }

        // Pointer Drag & Long-Press Handlers
        let longPressTimer = null;
        let isLongPressed = false;
        let isDragging = false;
        let startX = 0, startY = 0;

        handle.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          try { handle.setPointerCapture(e.pointerId); } catch (_) {}

          activeGradStopIndex = idx;
          container.querySelectorAll('.fill-grad-handle').forEach((h, hIdx) => {
            h.classList.toggle('is-active', hIdx === idx);
          });

          isDragging = false;
          isLongPressed = false;
          startX = e.clientX;
          startY = e.clientY;

          // 400ms long press to delete stop (if stops.length > 2)
          longPressTimer = setTimeout(() => {
            if (!isDragging && stops.length > 2) {
              isLongPressed = true;
              try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
              layer.fillGradStops.splice(idx, 1);
              activeGradStopIndex = Math.max(0, idx - 1);
              layer.fillGradColor1 = layer.fillGradStops[0].color;
              layer.fillGradColor2 = layer.fillGradStops[layer.fillGradStops.length - 1].color;
              layer._fillDirty = true;
              if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
              if (typeof redrawComposition === 'function') redrawComposition('fill-grad-delete');
              if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
              renderGradHandles(layer);
            }
          }, 400);

          const onPointerMove = (ev) => {
            ev.stopPropagation();
            if (isLongPressed) return;

            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (Math.hypot(dx, dy) > 5) {
              isDragging = true;
              if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
              }
            }

            if (!isDragging) return;

            const currentRect = trackBar ? trackBar.getBoundingClientRect() : container.getBoundingClientRect();
            const rawOffset = (ev.clientX - currentRect.left) / currentRect.width;
            const clampedOffset = Math.max(0, Math.min(1, rawOffset));

            stop.offset = Math.round(clampedOffset * 1000) / 1000;
            handle.style.left = (stop.offset * 100) + '%';
            if (stop.offset <= 0.05) {
              handle.className = 'fill-grad-handle is-stop-first is-active';
            } else if (stop.offset >= 0.95) {
              handle.className = 'fill-grad-handle is-stop-last is-active';
            } else {
              handle.className = 'fill-grad-handle is-stop-mid is-active';
            }

            // Update track bar background in real-time
            if (trackBar) {
              trackBar.style.background = getTrackGradientCss(stops);
            }

            // Invalidate preview cache and redraw composition
            layer._fillDirty = true;
            if (layer.type === 'shape' && layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
            if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
            layer._contentVersion = (layer._contentVersion || 0) + 1;
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof redrawComposition === 'function') redrawComposition('fill-grad-drag');
          };

          const onPointerUp = (ev) => {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
            try { handle.releasePointerCapture(ev.pointerId); } catch (_) {}
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);

            if (isLongPressed) return;

            if (!isDragging) {
              // Clicked 1x without drag: open color picker to change stop color
              openFillColorPicker(handle, stop.color, (hex, alpha, commit) => {
                stop.color = hex;
                layer._fillDirty = true;
                if (layer.type === 'shape' && layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
                if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
                layer._contentVersion = (layer._contentVersion || 0) + 1;
                if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
                if (typeof redrawComposition === 'function') redrawComposition('fill-grad-color');
                if (commit && typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
                renderGradHandles(layer);
              });
              return;
            }

            // Re-sort stops by offset and update active index
            const currentStop = stop;
            layer.fillGradStops.sort((a, b) => a.offset - b.offset);
            activeGradStopIndex = layer.fillGradStops.indexOf(currentStop);
            layer.fillGradColor1 = layer.fillGradStops[0].color;
            layer.fillGradColor2 = layer.fillGradStops[layer.fillGradStops.length - 1].color;
            layer._fillDirty = true;
            if (layer.type === 'shape' && layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
            if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
            layer._contentVersion = (layer._contentVersion || 0) + 1;

            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof redrawComposition === 'function') redrawComposition('fill-grad-drag-end');
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);

            renderGradHandles(layer);
          };

          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
        });

        container.appendChild(handle);
      });
    }
    window.renderGradHandles = renderGradHandles;

    function initGradTrackAdd(trackBar) {
      if (!trackBar) return;
      trackBar.addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = getSelectedLayerForFill();
        if (!layer) return;

        const stops = ensureLayerGradStops(layer);
        const trackRect = trackBar.getBoundingClientRect();
        const clickOffset = Math.max(0, Math.min(1, (e.clientX - trackRect.left) / trackRect.width));
        const roundedOffset = Math.round(clickOffset * 100) / 100;

        // Find surrounding stops to interpolate color
        const sorted = [...stops].sort((a, b) => a.offset - b.offset);
        let leftStop = sorted[0];
        let rightStop = sorted[sorted.length - 1];

        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i].offset <= roundedOffset) leftStop = sorted[i];
          if (sorted[i].offset >= roundedOffset) {
            rightStop = sorted[i];
            break;
          }
        }

        let interpolatedColor = leftStop.color;
        if (leftStop !== rightStop && rightStop.offset > leftStop.offset) {
          const t = (roundedOffset - leftStop.offset) / (rightStop.offset - leftStop.offset);
          interpolatedColor = interpolateHexColor(leftStop.color, rightStop.color, t);
        }

        const newStop = {
          offset: roundedOffset,
          color: interpolatedColor
        };

        layer.fillGradStops.push(newStop);
        layer.fillGradStops.sort((a, b) => a.offset - b.offset);
        activeGradStopIndex = layer.fillGradStops.indexOf(newStop);

        layer.fillGradColor1 = layer.fillGradStops[0].color;
        layer.fillGradColor2 = layer.fillGradStops[layer.fillGradStops.length - 1].color;
        layer._fillDirty = true;
        if (layer.type === 'shape' && layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
        if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
        layer._contentVersion = (layer._contentVersion || 0) + 1;

        if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
        if (typeof redrawComposition === 'function') redrawComposition('fill-grad-add');
        if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);

        renderGradHandles(layer);
      });
    }
    window.initGradTrackAdd = initGradTrackAdd;

    function syncFillControllerUI() {
      const layer = getSelectedLayerForFill();
      if (!layer) return;

      // Auto-detect default fill type if not explicitly set
      if (!layer.fillType) {
        layer.fillType = getLayerDefaultFillType(layer);
        if (layer.fillType === 'media') {
          if (!layer.fillMediaId && layer.mediaId) layer.fillMediaId = layer.mediaId;
          if (!layer.fillMediaUrl) layer.fillMediaUrl = layer.thumbUrl || layer.dataUrl || '';
          if (!layer.fillMediaName) layer.fillMediaName = layer.name || 'Media';
        }
      }

      const fillType = layer.fillType || 'none';

      // 1. Switch active category tab in top segmented bar
      const tabBtns = document.querySelectorAll('#fill-category-bar .fill-tab-btn');
      tabBtns.forEach(btn => {
        const t = btn.dataset.fillTab;
        const isActive = (t === fillType);
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      // 2. Switch panel views
      const views = document.querySelectorAll('#layer-drawer-fill-view .fill-panel-view');
      views.forEach(v => {
        v.classList.toggle('is-active', v.id === `fill-view-${fillType}`);
      });

      // 3. Sync Color UI (Inline Popover Color Picker)
      const currentColor = layer.fillColor || '#3D4CF5';
      const currentOpacity = layer.opacity !== undefined ? layer.opacity : 1.0;
      if (window.inlineFillColorPicker) {
        window.inlineFillColorPicker.setColor(currentColor, false, currentOpacity);
      }

      // 4. Sync Media UI (Direct Media Pool + Media Fit Mode)
      const activeFitLayer = (layer.type === 'precomp' && Array.isArray(layer.layers) && layer.layers.length > 0)
        ? (layer.layers.find(l => l.type === 'image' || l.type === 'video' || l.fillType === 'media') || layer)
        : layer;
      const currentFitMode = activeFitLayer.fillMediaFit || layer.fillMediaFit || 'fill';
      const mediaFitBtns = document.querySelectorAll('#fill-media-fit-bar .fill-media-fit-btn');
      mediaFitBtns.forEach(btn => {
        const isActive = (btn.dataset.mediaFit === currentFitMode);
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      renderFillMediaPool();

      // 5. Sync Gradient UI (Multi-stop track & types)
      const gradType = layer.fillGradType || 'linear';
      const gradTypeBtns = document.querySelectorAll('#fill-grad-types-bar .fill-grad-type-btn');
      gradTypeBtns.forEach(btn => {
        const isActive = (btn.dataset.gradType === gradType);
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      renderGradHandles(layer);
    }
    window.syncFillControllerUI = syncFillControllerUI;

    function openFillColorPicker(anchorEl, currentColor, onApply, initialAlpha = null) {
      if (!anchorEl || !anchorEl.isConnected) {
        anchorEl = document.querySelector('#fill-grad-handles-container .fill-grad-handle.is-active') ||
                   document.getElementById('fill-grad-track-bar');
      }
      if (window.FishColorPicker && typeof window.FishColorPicker.open === 'function') {
        window.FishColorPicker.open({
          anchor: anchorEl,
          color: currentColor || '#3D4CF5',
          opacity: typeof initialAlpha === 'number' ? initialAlpha : 1.0,
          onChange: (hex, alpha, rgba) => {
            onApply(hex, alpha, false, rgba);
          },
          onCommit: (hex, alpha, rgba) => {
            onApply(hex, alpha, true, rgba);
          }
        });
      }
    }
    window.openFillColorPicker = openFillColorPicker;

    (function initFillController() {
      // 1. Layer Action Grid Fill Button
      const btnLayerFill = document.getElementById('btn-layer-fill');
      if (btnLayerFill) {
        btnLayerFill.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('fill');
        });
      }

      // 2. Back Button: Fill -> Main
      const btnFillBack = document.getElementById('btn-fill-back');
      if (btnFillBack) {
        btnFillBack.addEventListener('click', (e) => {
          e.stopPropagation();
          switchLayerDrawerSubview('main');
        });
      }

      // 3. Category Tab Switch (No Fill, Color, Gradient, Media)
      const tabBtns = document.querySelectorAll('#fill-category-bar .fill-tab-btn');
      tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tab = btn.dataset.fillTab;
          if (!tab) return;

          const layer = getSelectedLayerForFill();
          if (layer) {
            layer.fillType = tab;
            if (tab === 'color') {
              if (!layer.fillColor) layer.fillColor = '#3D4CF5';
              // Detach audio/video playback if previously a video/audio layer
              if (window.FishAudioEngine && window.layerMediaCache) {
                const oldEntry = window.layerMediaCache.get(layer.id) || (layer.mediaId ? window.layerMediaCache.get(layer.mediaId) : null);
                if (oldEntry && oldEntry.el) {
                  try {
                    window.FishAudioEngine.detachMediaElement(oldEntry.el);
                    if (!oldEntry.el.paused) oldEntry.el.pause();
                  } catch (_) {}
                }
              }
            } else if (tab === 'gradient') {
              ensureLayerGradStops(layer);
              if (layer.fillGradAngle === undefined) layer.fillGradAngle = 90;
              if (!layer.fillGradType) layer.fillGradType = 'linear';
              // Detach audio/video playback if previously a video/audio layer
              if (window.FishAudioEngine && window.layerMediaCache) {
                const oldEntry = window.layerMediaCache.get(layer.id) || (layer.mediaId ? window.layerMediaCache.get(layer.mediaId) : null);
                if (oldEntry && oldEntry.el) {
                  try {
                    window.FishAudioEngine.detachMediaElement(oldEntry.el);
                    if (!oldEntry.el.paused) oldEntry.el.pause();
                  } catch (_) {}
                }
              }
            }
            layer._fillDirty = true;
            if (layer.type === 'shape' && layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
            if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
            layer._contentVersion = (layer._contentVersion || 0) + 1;
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
            if (typeof updateVolumeAndSpeedBtnState === 'function') updateVolumeAndSpeedBtnState(layer);
            if (typeof updateCutBarRowState === 'function') updateCutBarRowState();
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
            if (typeof redrawComposition === 'function') redrawComposition('fill-tab-switch');
          }
          syncFillControllerUI();
        });
      });

      // 3b. Media Fit Mode Switch (Stretch, Fit, Fill)
      const mediaFitBtns = document.querySelectorAll('#fill-media-fit-bar .fill-media-fit-btn');
      mediaFitBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fitMode = btn.dataset.mediaFit;
          if (!fitMode) return;
          const layer = getSelectedLayerForFill();
          if (layer) {
            layer.fillMediaFit = fitMode;
            layer._fillDirty = true;
            if (layer.type === 'shape' && layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
            if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
            if (layer._mediaFitCanvas) layer._mediaFitCanvas._lastFitKey = null;
            if (layer.type === 'precomp' && Array.isArray(layer.layers)) {
              delete layer._precompBufferCanvas;
              layer.layers.forEach(innerL => {
                if (innerL.type === 'image' || innerL.type === 'video' || innerL.fillType === 'media') {
                  innerL.fillMediaFit = fitMode;
                  innerL._fillDirty = true;
                  if (innerL._shapeBufferCanvas) innerL._shapeBufferCanvas._lastShapeKey = null;
                  if (innerL._fillBufferCanvas) innerL._fillBufferCanvas._lastRenderKey = null;
                  if (innerL._mediaFitCanvas) innerL._mediaFitCanvas._lastFitKey = null;
                  innerL._contentVersion = (innerL._contentVersion || 0) + 1;
                }
              });
            }
            layer._contentVersion = (layer._contentVersion || 0) + 1;
            if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
            if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
            if (typeof redrawComposition === 'function') redrawComposition('fill-media-fit');
          }
          syncFillControllerUI();
        });
      });

      // 4. No Fill button (Clicking the whole watermark empty card)
      const btnApplyNoFill = document.getElementById('btn-apply-no-fill');
      if (btnApplyNoFill) {
        btnApplyNoFill.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = getSelectedLayerForFill();
          if (!layer) return;
          layer.fillType = 'none';
          layer._fillDirty = true;
          if (layer.type === 'shape' && layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
          if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
          layer._contentVersion = (layer._contentVersion || 0) + 1;
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
          if (typeof redrawComposition === 'function') redrawComposition('fill-apply-none');
          syncFillControllerUI();
        });
      }

      // 5. Solid Color Helper & Inline Color Picker Instance
      function applySolidColor(hex, alpha = null, commit = true) {
        const layer = getSelectedLayerForFill();
        if (!layer) return;
        layer.fillType = 'color';
        layer.fillColor = hex;
        if (typeof alpha === 'number') {
          layer.opacity = Number(alpha.toFixed(2));
          if (typeof recordLayerPropertyChange === 'function') {
            recordLayerPropertyChange(layer, 'opacity');
          }
          if (typeof syncBlendOverlayValues === 'function') {
            syncBlendOverlayValues();
          }
        }
        // Detach audio/video playback if previously video/audio layer
        if (window.FishAudioEngine && window.layerMediaCache) {
          const oldEntry = window.layerMediaCache.get(layer.id) || (layer.mediaId ? window.layerMediaCache.get(layer.mediaId) : null);
          if (oldEntry && oldEntry.el) {
            try {
              window.FishAudioEngine.detachMediaElement(oldEntry.el);
              if (!oldEntry.el.paused) oldEntry.el.pause();
            } catch (_) {}
          }
        }
        layer._fillDirty = true;
        if (layer.type === 'shape' && layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
        if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
        layer._contentVersion = (layer._contentVersion || 0) + 1;

        if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
        if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
        if (typeof redrawComposition === 'function') redrawComposition('fill-color-change');
        if (commit && typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
      }

      const colorRootEl = document.getElementById('fill-view-color');
      if (colorRootEl && window.FishColorPicker && window.FishColorPicker.ColorPickerComponent) {
        window.inlineFillColorPicker = new window.FishColorPicker.ColorPickerComponent({
          rootEl: colorRootEl,
          isInline: true,
          initialTab: 'palette',
          onChange: (hex, alpha) => {
            applySolidColor(hex, alpha, false);
          },
          onCommit: (hex, alpha) => {
            applySolidColor(hex, alpha, true);
          }
        });
      }

      // 6. Gradient Controls (Types Toggle, Click to Add, Draggable Stops)
      const gradTypeBtns = document.querySelectorAll('#fill-grad-types-bar .fill-grad-type-btn');
      gradTypeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const gType = btn.dataset.gradType;
          if (!gType) return;
          const layer = getSelectedLayerForFill();
          if (!layer) return;
          layer.fillType = 'gradient';
          layer.fillGradType = gType;
          layer._fillDirty = true;
          if (layer.type === 'shape' && layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
          if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
          layer._contentVersion = (layer._contentVersion || 0) + 1;
          if (typeof invalidatePreviewCacheForLayer === 'function') invalidatePreviewCacheForLayer(layer);
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
          if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers(true);
          if (typeof redrawComposition === 'function') redrawComposition('fill-grad-type');
          syncFillControllerUI();
        });
      });

      const trackBar = document.getElementById('fill-grad-track-bar');
      if (trackBar) {
        initGradTrackAdd(trackBar);
      }

      // 7. File Input for Direct Media Pool Import
      const fillFileInput = document.getElementById('fill-media-file-input');
      if (fillFileInput) {
        fillFileInput.addEventListener('change', async (e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;
          const file = files[0];
          const projectId = currentProjectState.id;
          if (!projectId || !window.FishDatabase) return;

          try {
            const dataUrl = await new Promise((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(r.result);
              r.onerror = reject;
              r.readAsDataURL(file);
            });

            const isVideo = file.type.startsWith('video') || /\.(mp4|webm|mov|mkv)$/i.test(file.name);
            const isAudio = file.type.startsWith('audio') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
            let thumbUrl = isVideo ? '' : dataUrl;
            let vidDims = null;
            let audioDur = null;
            if (isVideo && typeof captureVideoThumbnail === 'function') {
              try {
                thumbUrl = (await captureVideoThumbnail(file, dataUrl)) || '';
                if (window.lastCapturedVideoDims) vidDims = window.lastCapturedVideoDims;
              } catch (_) {}
            } else if (isAudio) {
              thumbUrl = '';
              await new Promise((resolve) => {
                const aud = new Audio();
                aud.preload = 'metadata';
                aud.onloadedmetadata = () => {
                  if (isFinite(aud.duration) && aud.duration > 0) {
                    audioDur = aud.duration;
                  }
                  resolve();
                };
                aud.onerror = () => resolve();
                aud.src = dataUrl;
              });
            }

            const mediaItem = {
              id: 'med_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              projectId: projectId,
              name: file.name,
              type: isAudio ? 'audio' : (isVideo ? 'video' : 'image'),
              dataUrl: dataUrl,
              thumbUrl: thumbUrl,
              duration: audioDur || null,
              width: vidDims ? vidDims.width : null,
              height: vidDims ? vidDims.height : null,
              createdAt: Date.now()
            };

            await window.FishDatabase.saveMedia(mediaItem);

            if (typeof window.refreshProjectMediaGrid === 'function') {
              window.refreshProjectMediaGrid();
            }

            const targetL = getSelectedLayerForFill();
            if (targetL) {
              await applyFlexibleMediaReplacement(targetL, mediaItem);
            }

            await renderFillMediaPool();
          } catch (err) {
            console.error('Failed to import media for fill:', err);
          }
          fillFileInput.value = '';
        });
      }
    })();

    let mediaPoolInitialized = false;
    function initProjectMediaPool() {
      const gridEl = document.getElementById('drawer-media-grid');
      const importBtn = document.getElementById('btn-import-media');
      const fileInput = document.getElementById('media-file-input');
      if (!gridEl || !importBtn || !fileInput) return;

      // Delete media item helper — purges media from database and removes all active timeline layers
      async function deleteMediaItem(item) {
        if (!item || !item.id) return;

        // 1. Instant optimistic DOM & timeline removal (0ms visual latency)
        document.querySelectorAll(`.media-item-tile[data-media-id="${item.id}"]`).forEach(t => t.remove());
        document.querySelectorAll(`.fill-media-tile[data-media-id="${item.id}"]`).forEach(t => t.remove());

        if (window.selectedMediaId === item.id) {
          window.selectedMediaId = null;
          if (typeof setActivePreviewMedia === 'function') {
            setActivePreviewMedia(null);
          }
        }

        if (window._activeMediaMap && window._activeMediaMap.has(item.id)) {
          window._activeMediaMap.delete(item.id);
        }

        // Immediately purge any timeline layers referencing this media
        if (typeof window.removeTimelineLayersForMedia === 'function') {
          window.removeTimelineLayersForMedia(item.id, item.dataUrl, item);
        }

        // Revoke object URLs if no other media item or active layer references them
        const urlToRevoke = item.dataUrl;
        const thumbToRevoke = item.thumbUrl;
        const activeMedias = Array.from(window._activeMediaMap?.values() || []);
        const activeLayers = (window.currentProjectState?.layers || []);

        if (urlToRevoke && typeof urlToRevoke === 'string' && urlToRevoke.startsWith('blob:')) {
          const isReferenced = activeMedias.some(m => m !== item && m.dataUrl === urlToRevoke) ||
                               activeLayers.some(l => l.dataUrl === urlToRevoke || l.fillMediaUrl === urlToRevoke);
          if (!isReferenced) {
            if (typeof window.revokeStudioObjectUrl === 'function') {
              window.revokeStudioObjectUrl(urlToRevoke);
            } else {
              try { URL.revokeObjectURL(urlToRevoke); } catch (_) {}
            }
          }
        }
        if (thumbToRevoke && typeof thumbToRevoke === 'string' && thumbToRevoke.startsWith('blob:') && thumbToRevoke !== urlToRevoke) {
          const isReferenced = activeMedias.some(m => m !== item && m.thumbUrl === thumbToRevoke) ||
                               activeLayers.some(l => l.thumbUrl === thumbToRevoke);
          if (!isReferenced) {
            if (typeof window.revokeStudioObjectUrl === 'function') {
              window.revokeStudioObjectUrl(thumbToRevoke);
            } else {
              try { URL.revokeObjectURL(thumbToRevoke); } catch (_) {}
            }
          }
        }

        // 2. Background database & frame cache cleanup
        try {
          if (window.FishDatabase) {
            await window.FishDatabase.deleteMedia(item.id);
          }
        } catch (err) {
          console.warn('[MediaPool] Error during media deletion:', err);
        } finally {
          await renderMediaGrid();
          if (typeof renderFillMediaPool === 'function') {
            renderFillMediaPool();
          }
        }
      }

      // Helper to dynamically guarantee vendor/lamejs/lame.min.js is ready
      async function ensureLameLoaded() {
        if (window.lamejs && window.lamejs.Mp3Encoder) return window.lamejs;
        if (typeof lamejs !== 'undefined' && lamejs.Mp3Encoder) return lamejs;
        return new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'vendor/lamejs/lame.min.js';
          script.onload = () => {
            const lib = window.lamejs || (typeof lamejs !== 'undefined' ? lamejs : null);
            resolve(lib);
          };
          script.onerror = () => reject(new Error('Failed to load vendor/lamejs/lame.min.js'));
          document.head.appendChild(script);
        });
      }
      window.ensureLameLoaded = ensureLameLoaded;

      // Pure client-side MP3 Encoder (Offline, Fast, 192kbps true MP3)
      async function audioBufferToMp3(buffer, kbps = 192) {
        let activeBuffer = buffer;
        const supportedRates = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
        if (!supportedRates.includes(activeBuffer.sampleRate)) {
          try {
            const targetRate = 44100;
            const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            if (OfflineCtx) {
              const targetLen = Math.ceil(activeBuffer.duration * targetRate);
              const offCtx = new OfflineCtx(Math.min(2, activeBuffer.numberOfChannels), targetLen, targetRate);
              const src = offCtx.createBufferSource();
              src.buffer = activeBuffer;
              src.connect(offCtx.destination);
              src.start(0);
              activeBuffer = await offCtx.startRendering();
            }
          } catch (resampleErr) {
            console.warn('[audioBufferToMp3] Resample fallback failed:', resampleErr);
          }
        }

        const Lame = await ensureLameLoaded();
        if (!Lame || !Lame.Mp3Encoder) {
          throw new Error('Lame MP3 Encoder not available');
        }

        const numChannels = activeBuffer.numberOfChannels;
        const sampleRate = activeBuffer.sampleRate;
        const numSamples = activeBuffer.length;
        const isStereo = numChannels >= 2;
        const encoderChannels = isStereo ? 2 : 1;

        const mp3encoder = new Lame.Mp3Encoder(encoderChannels, sampleRate, kbps);

        function floatTo16BitPCM(input) {
          const output = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          return output;
        }

        const leftPCM = floatTo16BitPCM(activeBuffer.getChannelData(0));
        const rightPCM = isStereo ? floatTo16BitPCM(activeBuffer.getChannelData(1)) : null;

        const mp3Data = [];
        const sampleBlockSize = 1152;

        for (let i = 0; i < numSamples; i += sampleBlockSize) {
          const leftChunk = leftPCM.subarray(i, i + sampleBlockSize);
          let mp3buf;
          if (isStereo) {
            const rightChunk = rightPCM.subarray(i, i + sampleBlockSize);
            mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
          } else {
            mp3buf = mp3encoder.encodeBuffer(leftChunk);
          }
          if (mp3buf && mp3buf.length > 0) {
            mp3Data.push(mp3buf);
          }
        }

        const endBuf = mp3encoder.flush();
        if (endBuf && endBuf.length > 0) {
          mp3Data.push(endBuf);
        }

        return new Blob(mp3Data, { type: 'audio/mp3' });
      }
      window.audioBufferToMp3 = audioBufferToMp3;

      // Universal Cross-Browser Video Audio Extractor (Direct Decode -> Safari Recast -> MediaRecorder Fast Capture)
      async function decodeAudioFromBlob(blob) {
        if (!blob) return null;
        const arrayBuffer = await blob.arrayBuffer();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) throw new Error('Web Audio API not supported');

        // Attempt 1: Direct decodeAudioData (Chrome, Firefox)
        try {
          const ctx1 = new AudioCtx();
          try {
            const buf = await ctx1.decodeAudioData(arrayBuffer.slice(0));
            if (buf && buf.numberOfChannels > 0) return buf;
          } finally {
            try { ctx1.close(); } catch (_) {}
          }
        } catch (_) {}

        // Attempt 2: Safari audio/mp4 container recast
        try {
          const audioMimeBlob = new Blob([arrayBuffer], { type: 'audio/mp4' });
          const ctx2 = new AudioCtx();
          try {
            const buf = await ctx2.decodeAudioData(await audioMimeBlob.arrayBuffer());
            if (buf && buf.numberOfChannels > 0) return buf;
          } finally {
            try { ctx2.close(); } catch (_) {}
          }
        } catch (_) {}

        // Attempt 3: Fast playback capture via MediaRecorder (16x speed)
        try {
          const blobUrl = URL.createObjectURL(blob);
          let videoEl = null;
          try {
            videoEl = document.createElement('video');
            videoEl.src = blobUrl;
            videoEl.muted = false;
            videoEl.crossOrigin = 'anonymous';
            videoEl.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;top:-9999px';
            document.body.appendChild(videoEl);

            await new Promise((res, rej) => {
              videoEl.onloadedmetadata = res;
              videoEl.onerror = () => rej(new Error('Video load failed'));
              setTimeout(() => rej(new Error('Metadata timeout')), 8000);
            });

            const captureCtx = new AudioCtx({ sampleRate: 44100 });
            const sourceNode = captureCtx.createMediaElementSource(videoEl);
            const destNode = captureCtx.createMediaStreamDestination();
            sourceNode.connect(destNode);
            sourceNode.connect(captureCtx.destination);

            const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4'))
              ? 'audio/mp4'
              : (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
                ? 'audio/webm;codecs=opus'
                : '';

            if (typeof MediaRecorder !== 'undefined') {
              const recorder = new MediaRecorder(destNode.stream, mimeType ? { mimeType } : {});
              const chunks = [];
              recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
              const recordingDone = new Promise((res, rej) => { recorder.onstop = res; recorder.onerror = rej; });

              recorder.start(100);
              videoEl.playbackRate = 16;
              videoEl.currentTime = 0;
              await videoEl.play().catch(() => {});

              await new Promise(res => {
                videoEl.onended = res;
                const dur = isFinite(videoEl.duration) ? videoEl.duration : 60;
                setTimeout(res, Math.ceil(dur / 16) * 1000 + 3000);
              });

              recorder.stop();
              videoEl.pause();
              await recordingDone;
              videoEl.remove();
              try { captureCtx.close(); } catch (_) {}

              if (chunks.length > 0) {
                const capturedBlob = new Blob(chunks, { type: mimeType || 'audio/webm' });
                const decodeCtx = new AudioCtx();
                try {
                  return await decodeCtx.decodeAudioData(await capturedBlob.arrayBuffer());
                } finally {
                  try { decodeCtx.close(); } catch (_) {}
                }
              }
            } else {
              videoEl.remove();
              try { captureCtx.close(); } catch (_) {}
            }
          } finally {
            try {
              videoEl.pause();
              videoEl.src = '';
            } catch (_) {}
            setTimeout(() => {
              try { URL.revokeObjectURL(blobUrl); } catch (_) {}
            }, 10000);
          }
        } catch (captureErr) {
          console.warn('[decodeAudioFromBlob] MediaRecorder capture failed:', captureErr);
        }

        return null;
      }
      window.decodeAudioFromBlob = decodeAudioFromBlob;

      // Convert Video Media Item to Audio in Media Pool (True MP3)
      async function convertVideoMediaToAudio(mediaItem) {
        if (!mediaItem || mediaItem.type !== 'video' || !mediaItem.dataUrl) return;
        const projectId = currentProjectState.id || (new URLSearchParams(window.location.search).get('id')) || 'default_project';

        if (typeof showEffectsRackToast === 'function') {
          showEffectsRackToast('Mengonversi audio ke MP3...');
        }

        try {
          const res = await fetch(mediaItem.dataUrl);
          const blob = await res.blob();

          const decodedBuffer = await decodeAudioFromBlob(blob);

          if (!decodedBuffer || decodedBuffer.numberOfChannels === 0) {
            alert('Video tidak memiliki track audio.');
            return;
          }

          const mp3Blob = await audioBufferToMp3(decodedBuffer, 192);
          const mp3DataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(mp3Blob);
          });

          const cleanBaseName = (mediaItem.name || 'Video').replace(/\.[^/.]+$/, '');
          const audioItemName = cleanBaseName + ' (Audio).mp3';
          const audioDur = decodedBuffer.duration || 5;

          const audioMediaItem = {
            id: 'med_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            projectId: projectId,
            name: audioItemName,
            type: 'audio',
            mimeType: 'audio/mp3',
            size: mp3Blob.size || mp3DataUrl.length,
            dataUrl: mp3DataUrl,
            blob: mp3Blob,
            thumbUrl: '',
            duration: audioDur,
            createdAt: new Date().toISOString()
          };

          if (window.FishDatabase) {
            await window.FishDatabase.saveMedia(audioMediaItem);
            await renderMediaGrid();
            if (typeof renderFillMediaPool === 'function') {
              renderFillMediaPool();
            }
          }

          if (typeof showEffectsRackToast === 'function') {
            showEffectsRackToast('Audio berhasil dikonversi ke MP3');
          }
        } catch (err) {
          console.error('[MediaPool] Failed to convert video to audio:', err);
          alert('Failed to convert video to audio.');
        }
      }

      // Bind actions on #popover-media-item-menu once
      const popoverMediaMenu = document.getElementById('popover-media-item-menu');
      if (popoverMediaMenu && !popoverMediaMenu._eventsBound) {
        popoverMediaMenu._eventsBound = true;
        const btnDelete = popoverMediaMenu.querySelector('#btn-media-delete');
        const btnConvertAudio = popoverMediaMenu.querySelector('#btn-media-convert-audio');

        if (btnDelete) {
          btnDelete.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = window._activeMediaPoolItem;
            if (window.Popover) window.Popover.close(false);
            if (item) deleteMediaItem(item);
          });
        }

        if (btnConvertAudio) {
          btnConvertAudio.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = window._activeMediaPoolItem;
            if (window.Popover) window.Popover.close(false);
            if (item && item.type === 'video') convertVideoMediaToAudio(item);
          });
        }
      }

      window.deleteMediaItem = deleteMediaItem;
      window.convertVideoMediaToAudio = convertVideoMediaToAudio;
      window.renderMediaGrid = renderMediaGrid;

      // 1. Render all stored media for current project
      async function renderMediaGrid() {
        const projectId = currentProjectState.id;
        if (!projectId || !window.FishDatabase) return;

        let mediaItems = [];
        try {
          mediaItems = await window.FishDatabase.getProjectMedia(projectId);
        } catch (e) {
          mediaItems = [];
        }

        window._activeMediaMap = window._activeMediaMap || new Map();
        // Hydrate or merge in-memory session media items so live dataUrls are never lost
        mediaItems.forEach(item => {
          if (!item.dataUrl && item.buffer) {
            try {
              item.blob = new Blob([item.buffer], { type: item.mimeType || '' });
              item.dataUrl = trackStudioObjectUrl(URL.createObjectURL(item.blob));
            } catch (_) {}
          } else if (!item.dataUrl && item.blob) {
            try {
              item.dataUrl = trackStudioObjectUrl(URL.createObjectURL(item.blob));
            } catch (_) {}
          }
          if ((!item.dataUrl || item.dataUrl.startsWith('blob:')) && window._activeMediaMap.has(item.id)) {
            const cached = window._activeMediaMap.get(item.id);
            if (cached && cached.dataUrl) item.dataUrl = cached.dataUrl;
          }
          if (item.dataUrl && !window._activeMediaMap.has(item.id)) {
            window._activeMediaMap.set(item.id, item);
          }
        });
        window._activeMediaMap.forEach(item => {
          if (item && item.projectId === projectId && !mediaItems.some(m => m.id === item.id)) {
            mediaItems.push(item);
          }
        });

        // Remove existing media item tiles
        gridEl.querySelectorAll('.media-item-tile').forEach(el => el.remove());

        // Render each media item tile before importBtn
        mediaItems.forEach(item => {
          const tile = document.createElement('div');
          tile.className = 'media-item-tile';
          tile.dataset.mediaId = item.id;
          tile.title = item.name;

          if (window.selectedMediaId && window.selectedMediaId === item.id) {
            tile.classList.add('is-selected');
          }

          let previewHtml = '';
          if (item.type === 'image') {
            previewHtml = `<img class="media-item-thumb" src="${item.dataUrl}" alt="${item.name}">`;
          } else if (item.type === 'video') {
            const thumbSrc = item.thumbUrl || '';
            if (thumbSrc) {
              previewHtml = `<img class="media-item-thumb" src="${thumbSrc}" alt="${item.name}"><span class="media-item-type-badge">VID</span>`;
            } else {
              previewHtml = `
                <div class="media-item-fallback media-item-vid-placeholder">
                  <i class='fticon fticon-icon-20' aria-hidden='true'></i>
                </div>
                <span class="media-item-type-badge">VID</span>
              `;
              // Lazily generate missing thumbnail and persist (skip if handleFiles Phase 3 is already ingesting)
              if (item.dataUrl && !item._ingesting) {
                captureVideoThumbnail(null, item.dataUrl).then(thumb => {
                  if (thumb) {
                    item.thumbUrl = thumb;
                    if (window.lastCapturedVideoDims && window.lastCapturedVideoDims.width > 0) {
                      item.width = window.lastCapturedVideoDims.width;
                      item.height = window.lastCapturedVideoDims.height;
                    }
                    if (window.FishDatabase && !item._ingesting) window.FishDatabase.saveMedia(item);
                    const placeholder = tile.querySelector('.media-item-vid-placeholder');
                    if (placeholder) {
                      const img = document.createElement('img');
                      img.className = 'media-item-thumb';
                      img.src = thumb;
                      img.alt = item.name;
                      placeholder.replaceWith(img);
                    }
                  }
                });
              }
            }
          } else if (item.type === 'precomp') {
            previewHtml = `
              <div class="media-item-fallback media-item-precomp-placeholder">
                <i class='fticon fticon-icon-29' aria-hidden='true'></i>
              </div>
              <span class="media-item-type-badge">COMP</span>
            `;
          } else {
            previewHtml = `
              <div class="media-item-fallback">
                <i class='fticon fticon-icon-18' aria-hidden='true'></i>
              </div>
              <span class="media-item-type-badge">AUD</span>
            `;
          }

          tile.innerHTML = `
            ${previewHtml}
            <button type="button" class="media-item-delete-btn" title="Delete Media" aria-label="Delete Media">
              <i class='fticon fticon-delete-media' aria-hidden='true'></i>
            </button>
          `;

          let longPressTimer = null;
          let startX = 0;
          let startY = 0;

          const openMediaItemPopover = (anchor) => {
            if (!window.Popover) return;
            window._activeMediaPoolItem = item;
            window._activeMediaPoolTile = tile;

            const popoverEl = document.getElementById('popover-media-item-menu');
            if (popoverEl) {
              const btnConvert = popoverEl.querySelector('#btn-media-convert-audio');
              const divider = popoverEl.querySelector('#divider-media-convert-audio');
              if (btnConvert && divider) {
                const isVid = (item.type === 'video');
                btnConvert.style.display = isVid ? 'flex' : 'none';
                divider.style.display = isVid ? 'block' : 'none';
              }
            }
            window.Popover.open(anchor, 'popover-media-item-menu');
          };

          // 1. Desktop: Right-Click (contextmenu)
          tile.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const mouseAnchor = {
              isVirtual: true,
              isContextMenu: true,
              getBoundingClientRect: () => ({
                left: e.clientX,
                top: e.clientY,
                right: e.clientX,
                bottom: e.clientY,
                width: 0,
                height: 0
              }),
              dataset: {}
            };
            openMediaItemPopover(mouseAnchor);
          });

          // 2. Mobile & Touch: Long-Press (500ms)
          // Touch holds must not start a native HTML5 drag: draggable tiles
          // fire pointercancel on touch-hold, which would kill the timer and
          // the popover would never appear. Re-enabled on release.
          tile.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return; // Primary button only (touch/stylus always pass)
            startX = e.clientX;
            startY = e.clientY;

            if (e.pointerType === 'touch' && 'draggable' in tile) tile.draggable = false;
            if (longPressTimer) clearTimeout(longPressTimer);
            longPressTimer = setTimeout(() => {
              tile._suppressClick = true;
              longPressTimer = null;
              if (typeof navigator !== 'undefined' && navigator.vibrate) {
                try { navigator.vibrate(40); } catch (_) {}
              }
              openMediaItemPopover(tile);
            }, 500);
          });

          tile.addEventListener('pointermove', (e) => {
            if (!longPressTimer) return;
            if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
          });

          const cancelLongPress = () => {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
            if ('draggable' in tile) tile.draggable = true;
          };
          tile.addEventListener('pointerup', cancelLongPress);
          tile.addEventListener('pointercancel', cancelLongPress);

          // 2b. Drag and drop from project asset tile to timeline or canvas
          tile.draggable = true;
          tile.addEventListener('dragstart', (e) => {
            cancelLongPress();
            window._draggedProjectAsset = { type: 'media', item: item };
            tile.classList.add('is-dragging');
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = 'copy';
              try {
                e.dataTransfer.setData('application/json', JSON.stringify({
                  source: 'fishtools-project-asset',
                  assetType: 'media',
                  id: item.id
                }));
                e.dataTransfer.setData('text/plain', item.name || 'Media Asset');
              } catch (_) {}
            }
          });
          tile.addEventListener('dragend', () => {
            window._draggedProjectAsset = null;
            tile.classList.remove('is-dragging');
            if (typeof window.hideTimelineDropIndicator === 'function') {
              window.hideTimelineDropIndicator();
            }
            const previewEl = document.getElementById('editor-preview-container');
            if (previewEl) previewEl.classList.remove('is-asset-dragover');
          });

          // 3. Click tile to import/add a new layer instance of this media onto timeline
          tile.addEventListener('click', (e) => {
            if (e.target.closest('.media-item-delete-btn')) return;
            if (tile._suppressClick) {
              tile._suppressClick = false;
              return;
            }
            window.selectedMediaId = item.id;
            gridEl.querySelectorAll('.media-item-tile').forEach(t => t.classList.remove('is-selected'));
            tile.classList.add('is-selected');
            setActivePreviewMedia(item);
            if (typeof window.addOrSelectMediaLayer === 'function') {
              window.addOrSelectMediaLayer(item);
            }
          });

          // Delete media item on clicking delete button - purges media and ALL its layers from timeline (Desktop mouse only)
          const delBtn = tile.querySelector('.media-item-delete-btn');
          if (delBtn) {
            delBtn.addEventListener('pointerdown', (e) => {
              e.stopPropagation();
            });
            delBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              e.preventDefault();
              // Prevent accidental touch trigger or non-hover click
              if (e.pointerType === 'touch' || (window.matchMedia && window.matchMedia('(hover: none)').matches)) {
                return;
              }
              await deleteMediaItem(item);
            });
          }

          gridEl.insertBefore(tile, importBtn);
        });
      }

      window.refreshProjectMediaGrid = renderMediaGrid;
      window.renderProjectMediaGrid = renderMediaGrid;
      window.renderMediaGrid = renderMediaGrid;

      if (mediaPoolInitialized) {
        renderMediaGrid();
        return;
      }
      mediaPoolInitialized = true;

      // 2. Click & Keyboard accessibility on import box
      importBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
      });

      fileInput.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      importBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput.click();
        }
      });

      // 3. File ingestion logic (Strictly MP4, MP3, PNG, JPG/JPEG with Instant Optimistic Rendering)
      async function handleFiles(files, autoAddToTimeline = false) {
        if (!files || files.length === 0) return [];
        const addedItems = [];
        let projectId = currentProjectState.id;
        if (!projectId && window.FishDatabase) {
          try {
            const created = await window.FishDatabase.createProject({
              name: currentProjectState.name || 'New_Project',
              aspectRatio: currentProjectState.aspectRatio || '16:9',
              resolution: currentProjectState.resolution || '1080p',
              fps: currentProjectState.fps || 60,
              bgColor: currentProjectState.bgColor || 'transparent'
            });
            if (created && created.id) {
              currentProjectState.id = created.id;
              projectId = created.id;
            }
          } catch (_) {}
        }
        if (!projectId) {
          projectId = 'prj_' + Date.now();
          currentProjectState.id = projectId;
        }

        const defaultDur = currentProjectState.defaultDuration || 5;
        const validFilePairs = [];

        // Phase 1: Instant synchronous registration (< 1ms per file)
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file && file.name && file.name.toLowerCase().endsWith('.ofts')) {
            if (window.FishDatabase && typeof window.FishDatabase.importOFTSPackage === 'function') {
              try {
                const imported = await window.FishDatabase.importOFTSPackage(file);
                if (imported && imported.id) {
                  const isDesktop = window.location.pathname.includes('desktop.html') || window.location.pathname.includes('/desktop');
                  const target = isDesktop ? 'desktop.html' : 'editor.html';
                  window.location.href = `${target}?id=${encodeURIComponent(imported.id)}&template=1`;
                  return [];
                }
              } catch (e) {
                console.warn('Error importing dropped .ofts file:', e);
              }
            }
            continue;
          }

          const ext = (file.name.split('.').pop() || '').toLowerCase();
          const mime = (file.type || '').toLowerCase();

          let mediaType = '';
          if (['mp4', 'mov', 'webm', 'mkv'].includes(ext) || mime.startsWith('video/')) {
            mediaType = 'video';
          } else if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext) || mime.startsWith('audio/') || mime.includes('mpeg') || mime.includes('mp3')) {
            mediaType = 'audio';
          } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) || mime.startsWith('image/')) {
            mediaType = 'image';
          }

          if (!mediaType) {
            console.warn('[MediaPool] Skipping unsupported file format:', file.name, ext, mime);
            continue;
          }

          try {
            const blobUrl = trackStudioObjectUrl(URL.createObjectURL(file));
            const mediaItem = {
              id: 'med_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6) + '_' + i,
              projectId: projectId,
              name: file.name,
              type: mediaType,
              mimeType: file.type || (mediaType === 'video' ? 'video/mp4' : (mediaType === 'audio' ? 'audio/mpeg' : 'image/' + (ext === 'png' ? 'png' : 'jpeg'))),
              size: file.size,
              dataUrl: blobUrl,
              blob: file,
              buffer: null,
              thumbUrl: (mediaType === 'image' ? blobUrl : ''),
              duration: defaultDur,
              _durationVerified: (mediaType === 'image'),
              fps: null,
              width: null,
              height: null,
              _ingesting: true,
              createdAt: new Date().toISOString()
            };

            window._activeMediaMap = window._activeMediaMap || new Map();
            window._activeMediaMap.set(mediaItem.id, mediaItem);
            addedItems.push(mediaItem);
            validFilePairs.push({ file, mediaItem });
          } catch (err) {
            console.error('[MediaPool] Failed creating object URL for file:', file.name, err);
          }
        }

        // Phase 2: Instant Render (< 16ms)
        // Render newly registered tiles into media pool grid immediately
        await renderMediaGrid();

        // If dropped directly onto Timeline/Canvas or auto-add requested, instantiate layers immediately
        if (autoAddToTimeline && addedItems.length > 0 && typeof window.addOrSelectMediaLayer === 'function') {
          addedItems.forEach(item => window.addOrSelectMediaLayer(item));
        }

        // Phase 3: Non-blocking background worker for metadata & persistent database storage
        validFilePairs.forEach(({ file, mediaItem }) => {
          (async () => {
            try {
              if (mediaItem.type === 'image') {
                const img = new Image();
                img.src = mediaItem.dataUrl;
                await new Promise(r => {
                  if (img.complete && img.naturalWidth > 0) return r();
                  img.onload = () => r();
                  img.onerror = () => r();
                  setTimeout(r, 600);
                });
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  mediaItem.width = img.naturalWidth;
                  mediaItem.height = img.naturalHeight;
                  const layers = (currentProjectState && currentProjectState.layers) || [];
                  layers.forEach(l => {
                    if (l.mediaId === mediaItem.id && (!l.mediaWidth || !l.mediaHeight)) {
                      l.mediaWidth = img.naturalWidth;
                      l.mediaHeight = img.naturalHeight;
                      if (!l._userResized) {
                        fitLayerToComposition(l, img.naturalWidth, img.naturalHeight);
                      }
                    }
                  });
                  if (typeof redrawComposition === 'function') redrawComposition();
                }
              } else if (mediaItem.type === 'video') {
                try {
                  const meta = await inspectVideoMetadata(file, mediaItem.dataUrl);
                  if (meta) {
                    if (meta.thumbUrl) mediaItem.thumbUrl = meta.thumbUrl;
                    if (meta.width > 0) mediaItem.width = meta.width;
                    if (meta.height > 0) mediaItem.height = meta.height;
                    if (meta.fps && meta.fps > 0) mediaItem.fps = meta.fps;
                    if (meta.duration && meta.duration > 0) {
                      mediaItem.duration = meta.duration;
                      mediaItem._durationVerified = true;
                      if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor.getSourceCache === 'function') {
                        const src = window.VideoFrameExtractor.getSourceCache(mediaItem.id);
                        if (src) {
                          src.duration = meta.duration;
                          src._durationVerified = true;
                        }
                      }
                      const layers = (currentProjectState && currentProjectState.layers) || [];
                      const pps = window.currentPixelsPerSecond || 80;
                      layers.forEach(l => {
                        if (l.mediaId === mediaItem.id) {
                          l.mediaDuration = meta.duration;
                          if (meta.fps && meta.fps > 0 && !l.mediaFps) l.mediaFps = meta.fps;
                          if (meta.width > 0 && !l.mediaWidth) l.mediaWidth = meta.width;
                          if (meta.height > 0 && !l.mediaHeight) l.mediaHeight = meta.height;
                          const spd = (l.speed && l.speed > 0) ? l.speed : 1.0;
                          const srcOff = l.sourceOffsetSec || 0;
                          const targetDur = Math.max(0.05, (meta.duration - srcOff) / spd);
                          if (!l._userTrimmed) {
                            l.durationSec = targetDur;
                            l.widthPx = Math.max(10, Math.round(targetDur * pps));
                            l.isDurationExplicit = true;
                          } else if (l.speedMode !== 'time_remap' && l.durationSec > targetDur + 0.01) {
                            l.durationSec = targetDur;
                            l.widthPx = Math.max(10, Math.round(targetDur * pps));
                          }
                        }
                      });
                      if (meta.duration > (currentProjectState.defaultDuration || 5)) {
                        currentProjectState.defaultDuration = Math.ceil(meta.duration);
                      }
                      if (typeof window.updateTimelineDuration === 'function') {
                        window.updateTimelineDuration(true);
                      }
                      if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
                      if (typeof redrawComposition === 'function') redrawComposition();
                      if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
                    }
                  }
                } catch (_) {}

                // Update video tile placeholder with generated thumbnail
                if (mediaItem.thumbUrl) {
                  const grid = document.getElementById('project-media-grid');
                  const tile = grid ? grid.querySelector(`.media-item-tile[data-media-id="${mediaItem.id}"]`) : null;
                  if (tile) {
                    const ph = tile.querySelector('.media-item-vid-placeholder');
                    if (ph) {
                      const thumbImg = document.createElement('img');
                      thumbImg.className = 'media-item-thumb';
                      thumbImg.src = mediaItem.thumbUrl;
                      thumbImg.alt = mediaItem.name;
                      ph.replaceWith(thumbImg);
                    }
                  }
                }
              } else if (mediaItem.type === 'audio') {
                try {
                  const a = new Audio();
                  a.preload = 'metadata';
                  a.src = mediaItem.dataUrl;
                  await new Promise(r => {
                    a.onloadedmetadata = () => r();
                    a.onerror = () => r();
                    setTimeout(r, 1200);
                  });
                  if (isFinite(a.duration) && a.duration > 0) {
                    mediaItem.duration = a.duration;
                    mediaItem._durationVerified = true;
                    const layers = (currentProjectState && currentProjectState.layers) || [];
                    const pps = window.currentPixelsPerSecond || 80;
                    layers.forEach(l => {
                      if (l.mediaId === mediaItem.id) {
                        l.mediaDuration = a.duration;
                        const spd = (l.speed && l.speed > 0) ? l.speed : 1.0;
                        const srcOff = l.sourceOffsetSec || 0;
                        const targetDur = Math.max(0.05, (a.duration - srcOff) / spd);
                        if (!l._userTrimmed) {
                          l.durationSec = targetDur;
                          l.widthPx = Math.max(10, Math.round(targetDur * pps));
                          l.isDurationExplicit = true;
                        } else if (l.speedMode !== 'time_remap' && l.durationSec > targetDur + 0.01) {
                          l.durationSec = targetDur;
                          l.widthPx = Math.max(10, Math.round(targetDur * pps));
                        }
                      }
                    });
                    if (a.duration > (currentProjectState.defaultDuration || 5)) {
                      currentProjectState.defaultDuration = Math.ceil(a.duration);
                    }
                    if (typeof window.updateTimelineDuration === 'function') {
                      window.updateTimelineDuration(true);
                    }
                    if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
                    if (typeof saveCurrentProjectLayers === 'function') saveCurrentProjectLayers();
                  }
                } catch (_) {}
              }

              delete mediaItem._ingesting;
              if (window.FishDatabase) {
                try {
                  await window.FishDatabase.saveMedia(mediaItem);
                } catch (saveErr) {
                  console.warn('[MediaPool] FishDatabase.saveMedia background error:', saveErr);
                }
              }
            } catch (err) {
              delete mediaItem._ingesting;
              console.warn(`[MediaPool] Background worker warning for ${mediaItem.name}:`, err);
            }
          })();
        });

        return addedItems;
      }

      function isVideoFile(file) {
        if (!file) return false;
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const mime = (file.type || '').toLowerCase();
        return ['mp4', 'mov', 'webm', 'mkv'].includes(ext) || mime.startsWith('video/');
      }

      async function convertVideoFileToAudioItem(file, projectId) {
        if (!file) return null;
        if (typeof showEffectsRackToast === 'function') {
          showEffectsRackToast('Mengonversi video ke MP3...');
        }
        try {
          const decodedBuffer = await decodeAudioFromBlob(file);
          if (!decodedBuffer || decodedBuffer.numberOfChannels === 0) {
            if (typeof showEffectsRackToast === 'function') {
              showEffectsRackToast('Video tidak memiliki track audio.');
            }
            return null;
          }

          const mp3Blob = await audioBufferToMp3(decodedBuffer, 192);
          const dataUrl = trackStudioObjectUrl(URL.createObjectURL(mp3Blob));
          const cleanBaseName = (file.name || 'Video').replace(/\.[^/.]+$/, '');
          const audioItemName = cleanBaseName + ' (Audio).mp3';
          const audioDur = decodedBuffer.duration || 5;

          const audioMediaItem = {
            id: 'med_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            projectId: projectId,
            name: audioItemName,
            type: 'audio',
            mimeType: 'audio/mp3',
            size: mp3Blob.size,
            dataUrl: dataUrl,
            blob: mp3Blob,
            thumbUrl: '',
            duration: audioDur,
            createdAt: new Date().toISOString()
          };

          if (window.FishDatabase) {
            try {
              await window.FishDatabase.saveMedia(audioMediaItem);
            } catch (_) {}
          }
          window._activeMediaMap = window._activeMediaMap || new Map();
          window._activeMediaMap.set(audioMediaItem.id, audioMediaItem);

          if (typeof showEffectsRackToast === 'function') {
            showEffectsRackToast('Audio berhasil dikonversi ke MP3');
          }
          return audioMediaItem;
        } catch (err) {
          console.error('[MediaPool] Failed to convert video file to audio:', err);
          if (typeof showEffectsRackToast === 'function') {
            showEffectsRackToast('Gagal mengonversi audio.');
          }
          return null;
        }
      }

      async function handleDropFilesWithAction(filesArr, action, autoAddToTimeline = false) {
        if (!filesArr || filesArr.length === 0) return;
        const projectId = currentProjectState.id || 'default_project';

        // When action is convert-mp3, strictly isolate video files for audio extraction
        // Images and pure audio files MUST NEVER be converted to MP3!
        if (action === 'convert-mp3') {
          const videoFiles = filesArr.filter(f => isVideoFile(f));
          const nonVideoFiles = filesArr.filter(f => !isVideoFile(f));

          const addedItems = [];
          for (const file of videoFiles) {
            const audioItem = await convertVideoFileToAudioItem(file, projectId);
            if (audioItem) {
              addedItems.push(audioItem);
            } else {
              const imported = await handleFiles([file], false);
              if (imported && imported.length > 0) addedItems.push(...imported);
            }
          }

          // Import photos or audio directly without audio conversion
          if (nonVideoFiles.length > 0) {
            const imported = await handleFiles(nonVideoFiles, autoAddToTimeline);
            if (imported && imported.length > 0) addedItems.push(...imported);
          }

          await renderMediaGrid();
          if (autoAddToTimeline && addedItems.length > 0 && typeof window.addOrSelectMediaLayer === 'function') {
            addedItems.filter(item => item.type === 'audio' && item.name.includes('(Audio)')).forEach(item => window.addOrSelectMediaLayer(item));
          }
          return;
        }

        // action === 'import-video', 'import-image', 'import-audio', 'import-media', or default
        await handleFiles(filesArr, autoAddToTimeline);
      }

      function setupSplitDropzone(containerEl, overlayEl, autoAddToTimeline) {
        if (!containerEl || !overlayEl) return;

        let dragDepth = 0;
        let activeHoverCol = null;
        let currentMode = null;
        const initialOverlayHtml = overlayEl.innerHTML;
        overlayEl._renderOverlayMode = renderOverlayMode;

        function detectDraggedMediaType(dataTransfer) {
          if (!dataTransfer) return 'split';

          if (dataTransfer.items && dataTransfer.items.length > 0) {
            let hasImage = false;
            let hasVideo = false;
            let hasAudio = false;
            let count = 0;

            for (let i = 0; i < dataTransfer.items.length; i++) {
              const item = dataTransfer.items[i];
              if (item.kind === 'file') {
                const mime = (item.type || '').toLowerCase();
                if (mime.startsWith('image/')) {
                  hasImage = true;
                  count++;
                } else if (mime.startsWith('video/')) {
                  hasVideo = true;
                  count++;
                } else if (mime.startsWith('audio/') || mime.includes('mpeg') || mime.includes('mp3') || mime.includes('wav')) {
                  hasAudio = true;
                  count++;
                }
              }
            }

            if (count > 0) {
              if (hasImage && !hasVideo && !hasAudio) return 'image';
              if (hasAudio && !hasVideo && !hasImage) return 'audio';
              if (hasVideo) return 'video';
            }
          }

          if (dataTransfer.files && dataTransfer.files.length > 0) {
            let hasImage = false;
            let hasVideo = false;
            let hasAudio = false;

            for (let i = 0; i < dataTransfer.files.length; i++) {
              const f = dataTransfer.files[i];
              const ext = (f.name.split('.').pop() || '').toLowerCase();
              const mime = (f.type || '').toLowerCase();
              if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif', 'jfif'].includes(ext) || mime.startsWith('image/')) {
                hasImage = true;
              } else if (['mp4', 'mov', 'webm', 'mkv'].includes(ext) || mime.startsWith('video/')) {
                hasVideo = true;
              } else if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext) || mime.startsWith('audio/')) {
                hasAudio = true;
              }
            }

            if (hasImage && !hasVideo && !hasAudio) return 'image';
            if (hasAudio && !hasVideo && !hasImage) return 'audio';
            if (hasVideo) return 'video';
          }

          return 'split';
        }

        function renderOverlayMode(mode) {
          if (currentMode === mode) return;
          currentMode = mode;

          if (mode === 'image') {
            overlayEl.innerHTML = `
              <div class="media-dropzone-col media-dropzone-image" data-drop-action="import-image">
                <div class="media-dropzone-content">
                  <div class="media-dropzone-icon">
                    <i class='fticon fticon-icon-30' style='width:28px;height:28px;font-size:28px;line-height:1;' aria-hidden='true'></i>
                  </div>
                  <div class="media-dropzone-title">${autoAddToTimeline ? 'Import Photo to Timeline' : 'Import Photo to Project'}</div>
                  <div class="media-dropzone-desc">${autoAddToTimeline ? 'Add photo layer to composition' : 'Add photo to media pool'}</div>
                  <span class="media-dropzone-badge">Photo</span>
                </div>
              </div>
            `;
          } else if (mode === 'audio') {
            overlayEl.innerHTML = `
              <div class="media-dropzone-col media-dropzone-mp3" data-drop-action="import-audio">
                <div class="media-dropzone-content">
                  <div class="media-dropzone-icon">
                    <i class='fticon fticon-track-audio' style='width:28px;height:28px;font-size:28px;line-height:1;' aria-hidden='true'></i>
                  </div>
                  <div class="media-dropzone-title">${autoAddToTimeline ? 'Import Audio to Timeline' : 'Import Audio to Project'}</div>
                  <div class="media-dropzone-desc">${autoAddToTimeline ? 'Add audio track to composition' : 'Add audio to media pool'}</div>
                  <span class="media-dropzone-badge">Audio</span>
                </div>
              </div>
            `;
          } else {
            overlayEl.innerHTML = initialOverlayHtml;
          }
        }

        function updateHoverState(clientX, clientY) {
          const currentCols = overlayEl.querySelectorAll('.media-dropzone-col');
          currentCols.forEach(col => {
            const rect = col.getBoundingClientRect();
            if (
              clientX >= rect.left &&
              clientX <= rect.right &&
              clientY >= rect.top &&
              clientY <= rect.bottom
            ) {
              col.classList.add('is-hover');
              activeHoverCol = col;
            } else {
              col.classList.remove('is-hover');
            }
          });
        }

        function clearHoverState() {
          const currentCols = overlayEl.querySelectorAll('.media-dropzone-col');
          currentCols.forEach(col => col.classList.remove('is-hover'));
          activeHoverCol = null;
        }

        function hideOverlay() {
          dragDepth = 0;
          clearHoverState();
          overlayEl.classList.remove('is-active');
          containerEl.classList.remove('has-dropzone-active');
          renderOverlayMode('split');
        }

        function isExternalFileDrag(e) {
          if (window._draggedProjectAsset) return false;
          if (!e.dataTransfer) return false;
          const types = Array.from(e.dataTransfer.types || []);
          return types.includes('Files');
        }

        containerEl.addEventListener('dragenter', (e) => {
          if (!isExternalFileDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          dragDepth++;
          const detected = detectDraggedMediaType(e.dataTransfer);
          renderOverlayMode(detected);
          overlayEl.classList.add('is-active');
          containerEl.classList.add('has-dropzone-active');
          updateHoverState(e.clientX, e.clientY);
        });

        containerEl.addEventListener('dragover', (e) => {
          if (!isExternalFileDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
          }
          const detected = detectDraggedMediaType(e.dataTransfer);
          renderOverlayMode(detected);
          overlayEl.classList.add('is-active');
          containerEl.classList.add('has-dropzone-active');
          updateHoverState(e.clientX, e.clientY);
        });

        containerEl.addEventListener('dragleave', (e) => {
          if (!isExternalFileDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          dragDepth--;
          if (dragDepth <= 0) {
            hideOverlay();
          }
        });

        containerEl.addEventListener('drop', async (e) => {
          if (!isExternalFileDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();

          const targetCol = activeHoverCol || e.target.closest('.media-dropzone-col');
          const chosenAction = targetCol ? (targetCol.getAttribute('data-drop-action') || 'import-media') : 'import-media';

          hideOverlay();

          if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const droppedFiles = Array.from(e.dataTransfer.files);
            await handleDropFilesWithAction(droppedFiles, chosenAction, autoAddToTimeline);
          }
        });

        window.addEventListener('dragend', hideOverlay);
        window.addEventListener('drop', hideOverlay);
        window.addEventListener('pointerdown', hideOverlay);
        window.addEventListener('dragleave', (e) => {
          if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
            hideOverlay();
          }
        });
      }

      fileInput.addEventListener('change', async () => {
        if (fileInput.files && fileInput.files.length > 0) {
          const filesToProcess = Array.from(fileInput.files);
          try {
            await handleDropFilesWithAction(filesToProcess, 'import-video', false);
          } catch (err) {
            console.error('[MediaPool] Error importing files:', err);
          } finally {
            try { fileInput.value = ''; } catch (_) {}
          }
        }
      });

      // 4. Attach Split Dropzones
      const mediaPoolEl = document.getElementById('add-layer-media-pool');
      const mediaPoolOverlay = document.getElementById('media-pool-dropzone-split');
      if (mediaPoolEl && mediaPoolOverlay) {
        setupSplitDropzone(mediaPoolEl, mediaPoolOverlay, false);
      }

      const timelineVp = document.getElementById('timeline-layers-viewport');
      const timelineOverlay = document.getElementById('timeline-dropzone-split');
      if (timelineVp && timelineOverlay) {
        setupSplitDropzone(timelineVp, timelineOverlay, true);
      }

      const canvasContainer = document.getElementById('editor-preview-container');
      const canvasOverlay = document.getElementById('canvas-dropzone-split');
      if (canvasContainer && canvasOverlay) {
        setupSplitDropzone(canvasContainer, canvasOverlay, true);
      }

      // 4b. Setup Drag & Drop from Project Assets to Timeline & Preview Canvas
      function setupProjectAssetDropTargets() {
        const timelineVp = document.getElementById('timeline-layers-viewport');
        const canvasContainer = document.getElementById('editor-preview-container');

        // Timeline Drop Indicator
        let dropIndicator = null;
        let badgeEl = null;
        if (timelineVp) {
          dropIndicator = timelineVp.querySelector('.timeline-drag-drop-indicator');
          if (!dropIndicator) {
            dropIndicator = document.createElement('div');
            dropIndicator.className = 'timeline-drag-drop-indicator';
            dropIndicator.innerHTML = '<span class="timeline-drag-drop-badge">00:00</span>';
            timelineVp.appendChild(dropIndicator);
          }
          badgeEl = dropIndicator.querySelector('.timeline-drag-drop-badge');
        }

        function getDropSecAtClientX(clientX) {
          if (!timelineVp) return { sec: 0, x: 0 };
          const rect = timelineVp.getBoundingClientRect();
          const mouseXInVp = clientX - rect.left;
          const pps = window.currentPixelsPerSecond || 80;
          const isDesktop = Boolean(document.querySelector('.desktop-workstation, .desktop-viewport'));
          let sec = 0;
          if (isDesktop) {
            const scrollX = typeof window.getDesktopScrollX === 'function' ? window.getDesktopScrollX() : 0;
            sec = Math.max(0, (mouseXInVp + scrollX) / pps);
          } else {
            const curPan = window.timelinePanX !== undefined ? window.timelinePanX : 0;
            sec = Math.max(0, (mouseXInVp - curPan) / pps);
          }
          return { sec, x: mouseXInVp };
        }

        function formatDropTime(sec) {
          const fps = (currentProjectState && currentProjectState.fps) || 30;
          const totalFrames = Math.round(sec * fps);
          const m = Math.floor(totalFrames / (fps * 60));
          const s = Math.floor((totalFrames % (fps * 60)) / fps);
          const f = totalFrames % fps;
          return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
        }

        function instantiateDroppedAsset(asset, opts = {}) {
          if (!asset) return;
          if (asset.type === 'media') {
            if (typeof window.addOrSelectMediaLayer === 'function') {
              window.addOrSelectMediaLayer(asset.item, opts);
            }
          } else if (asset.type === 'shape') {
            if (typeof addShapeLayer === 'function') {
              addShapeLayer(asset.shapeType, opts);
            }
          } else if (asset.type === 'control') {
            if (asset.controlType === 'camera') {
              if (typeof addCameraLayer === 'function') {
                addCameraLayer(null, opts.targetSec !== undefined ? opts.targetSec : null);
              }
            } else if (asset.controlType === 'overlap-camera') {
              if (typeof addOverlapCameraLayer === 'function') {
                addOverlapCameraLayer(null, opts.targetSec !== undefined ? opts.targetSec : null);
              }
            } else if (asset.controlType === 'null') {
              if (typeof addNullLayer === 'function') {
                addNullLayer(false, opts);
              }
            } else if (asset.controlType === 'overlap-null') {
              if (typeof addOverlapNullLayer === 'function') {
                addOverlapNullLayer(false, opts);
              }
            } else if (asset.controlType === 'adjustment') {
              if (typeof addAdjustmentLayer === 'function') {
                addAdjustmentLayer(null, opts.targetSec !== undefined ? opts.targetSec : null);
              }
            } else if (asset.controlType === 'solid') {
              if (typeof addSolidLayer === 'function') {
                addSolidLayer(null, opts.targetSec !== undefined ? opts.targetSec : null);
              }
            }
          } else if (asset.type === 'text') {
            if (typeof addTextLayer === 'function') {
              addTextLayer(asset.presetId || 'default', opts);
            }
          }
        }

        if (timelineVp) {
          timelineVp.addEventListener('dragover', (e) => {
            if (!window._draggedProjectAsset) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            const { sec, x } = getDropSecAtClientX(e.clientX);
            if (dropIndicator) {
              dropIndicator.style.transform = `translate3d(${x}px, 0, 0)`;
              dropIndicator.classList.add('is-active');
            }
            if (badgeEl) badgeEl.textContent = formatDropTime(sec);
          });

          timelineVp.addEventListener('dragleave', (e) => {
            const rect = timelineVp.getBoundingClientRect();
            if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
              if (dropIndicator) dropIndicator.classList.remove('is-active');
            }
          });

          timelineVp.addEventListener('drop', (e) => {
            if (!window._draggedProjectAsset) return;
            e.preventDefault();
            e.stopPropagation();
            if (dropIndicator) dropIndicator.classList.remove('is-active');
            const asset = window._draggedProjectAsset;
            window._draggedProjectAsset = null;
            const { sec } = getDropSecAtClientX(e.clientX);
            instantiateDroppedAsset(asset, { targetSec: sec });
          });
        }

        if (canvasContainer) {
          canvasContainer.addEventListener('dragover', (e) => {
            if (!window._draggedProjectAsset) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            canvasContainer.classList.add('is-asset-dragover');
          });

          canvasContainer.addEventListener('dragleave', (e) => {
            const rect = canvasContainer.getBoundingClientRect();
            if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
              canvasContainer.classList.remove('is-asset-dragover');
            }
          });

          canvasContainer.addEventListener('drop', (e) => {
            if (!window._draggedProjectAsset) return;
            e.preventDefault();
            e.stopPropagation();
            canvasContainer.classList.remove('is-asset-dragover');
            const asset = window._draggedProjectAsset;
            window._draggedProjectAsset = null;
            instantiateDroppedAsset(asset, {});
          });
        }

        window.hideTimelineDropIndicator = () => {
          if (dropIndicator) dropIndicator.classList.remove('is-active');
          if (canvasContainer) canvasContainer.classList.remove('is-asset-dragover');
        };

        window.addEventListener('dragend', () => {
          window._draggedProjectAsset = null;
          if (dropIndicator) dropIndicator.classList.remove('is-active');
          if (canvasContainer) canvasContainer.classList.remove('is-asset-dragover');
        });
      }

      setupProjectAssetDropTargets();


      // 5. Re-render media grid when the drawer is opened or tab changes to media
      const addFab = document.getElementById('timeline-btn-add');
      if (addFab) {
        addFab.addEventListener('click', () => {
          setTimeout(renderMediaGrid, 20);
        });
      }

      function updateAddLayerCategoryPanels(cat) {
        const mediaPool = document.getElementById('add-layer-media-pool');
        const controlPanel = document.getElementById('add-layer-control-panel');
        const shapePanel = document.getElementById('add-layer-shape-panel');
        const textPanel = document.getElementById('add-layer-text-panel');
        const elementPanel = document.getElementById('add-layer-element-panel');
        if (mediaPool) mediaPool.style.display = (cat === 'media') ? '' : 'none';
        if (controlPanel) controlPanel.style.display = (cat === 'control') ? '' : 'none';
        if (shapePanel) shapePanel.style.display = (cat === 'shape') ? '' : 'none';
        if (textPanel) textPanel.style.display = (cat === 'text') ? '' : 'none';
        if (elementPanel) elementPanel.style.display = (cat === 'element') ? '' : 'none';
        if (cat === 'media') renderMediaGrid();
        if (cat === 'shape' && typeof syncShapeButtonsUI === 'function') syncShapeButtonsUI();
        if (cat === 'text' && typeof renderTextPresetsGrid === 'function') renderTextPresetsGrid();
        if (cat === 'element' && typeof renderSavedElementsGrid === 'function') renderSavedElementsGrid();
      }

      window.addEventListener('drawer-opened', (e) => {
        if (e.detail && e.detail.id === 'timeline-add-drawer') {
          const catSwitch = document.querySelector('#timeline-add-drawer .add-layer-categories-switch');
          const activeItem = catSwitch ? catSwitch.querySelector('.segmented-switch-item.is-active, .segmented-switch-item.is-selected') : null;
          const cat = activeItem ? (activeItem.dataset.category || activeItem.dataset.value) : 'media';
          updateAddLayerCategoryPanels(cat);
        }
      });

      document.addEventListener('switch:change', (e) => {
        if (e.detail && e.detail.track && e.detail.track.closest('#timeline-add-drawer')) {
          updateAddLayerCategoryPanels(e.detail.value);
        }
      });

      document.querySelector('#timeline-add-drawer .add-layer-categories-switch')?.addEventListener('click', (e) => {
        const item = e.target.closest('.segmented-switch-item');
        if (item) {
          const cat = item.dataset.category || item.dataset.value;
          updateAddLayerCategoryPanels(cat);
        }
      });

      // Initial render
      renderMediaGrid();
    }

    window.initProjectMediaPool = initProjectMediaPool;

    // Call initProjectMediaPool immediately so upload events are always ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initProjectMediaPool);
    } else {
      initProjectMediaPool();
    }

    // Dynamic version synchronization for editor
    async function initEditorVersion() {
      try {
        const res = await fetch('./version.json');
        if (res.ok) {
          const data = await res.json();
          if (data && data.version) {
            const clean = String(data.version).trim().replace(/^v\.?/i, '');
            window.OFT_VERSION = clean;
            const welcomeBadge = document.querySelector('.welcome-header-title-box .welcome-badge');
            if (welcomeBadge) welcomeBadge.textContent = `v${clean}`;
          }
        }
      } catch (_) {}
    }
    window.initEditorVersion = initEditorVersion;
    initEditorVersion();

    // Apply persisted UI scale immediately (Editor/Desktop default 100%).
    try {
      const _p = (window.location.pathname || '').indexOf('desktop') !== -1 ? 'desktop' : 'editor';
      const _v = (() => {
        try {
          const raw = localStorage.getItem('oft_ui_scale_' + _p);
          const n = parseInt(raw, 10);
          if (!isNaN(n)) return Math.max(80, Math.min(130, n));
        } catch (_) {}
        return 100;
      })();
      document.documentElement.style.setProperty('--oft-ui-scale', String(_v / 100));
      if (_v !== 100) document.documentElement.style.setProperty('zoom', String(_v / 100));
      else document.documentElement.style.removeProperty('zoom');
      try {
        window.__OFT_ZOOM = _v / 100;
        document.documentElement.classList.toggle('is-scaled', _v !== 100);
      } catch (_) {}
    } catch (_) {}

    // Interactive Option Selectors for Modal Dialogs (Custom Dropdowns, Aspect Frames, Swatches)
    document.addEventListener('DOMContentLoaded', () => {
      // 1. Custom Themed Dropdowns
      document.querySelectorAll('.custom-dropdown').forEach(dropdown => {
        const trigger = dropdown.querySelector('.custom-dropdown-trigger');
        const label = dropdown.querySelector('.custom-dropdown-label');
        const items = dropdown.querySelectorAll('.custom-dropdown-item');

        if (trigger) {
          trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-dropdown.is-open').forEach(other => {
              if (other !== dropdown) other.classList.remove('is-open');
            });
            dropdown.classList.toggle('is-open');
            trigger.setAttribute('aria-expanded', dropdown.classList.contains('is-open'));
          });
        }

        items.forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            const val = item.dataset.val;
            dropdown.dataset.value = val;
            if (label) label.textContent = item.textContent;
            items.forEach(i => i.classList.remove('is-selected'));
            item.classList.add('is-selected');
            dropdown.classList.remove('is-open');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
            if (typeof updateProjectSettingsSummaries === 'function') {
              updateProjectSettingsSummaries();
            }
          });
        });
      });

      // Close custom dropdowns on outside click
      document.addEventListener('click', () => {
        document.querySelectorAll('.custom-dropdown.is-open').forEach(dropdown => {
          dropdown.classList.remove('is-open');
          const trigger = dropdown.querySelector('.custom-dropdown-trigger');
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
          const c = dropdown.closest('.effects-card');
          if (c) c.classList.remove('has-dropdown-open');
        });
      });

      // 2. Aspect Ratio Visual Frames
      document.querySelectorAll('.modal-aspect-grid').forEach(grid => {
        grid.addEventListener('click', (e) => {
          const frame = e.target.closest('.aspect-ratio-frame');
          if (!frame) return;
          grid.querySelectorAll('.aspect-ratio-frame').forEach(f => f.classList.remove('is-selected'));
          frame.classList.add('is-selected');

          const isSettings = grid.id === 'settings-options-aspect-ratio';
          const containerId = isSettings ? 'settings-container-resolution' : 'container-resolution';
          if (typeof window.toggleResolutionUI === 'function') {
            window.toggleResolutionUI(containerId, frame.dataset.val);
          }
          if (typeof updateProjectSettingsSummaries === 'function') {
            updateProjectSettingsSummaries();
          }
        });
      });

      // 3. Color Swatches
      document.querySelectorAll('.modal-color-swatches').forEach(row => {
        row.addEventListener('click', (e) => {
          const swatch = e.target.closest('.modal-color-swatch');
          if (!swatch) return;
          row.querySelectorAll('.modal-color-swatch').forEach(s => s.classList.remove('is-selected'));
          swatch.classList.add('is-selected');
        });
        // Custom background swatch: universal FishColorPicker popover (above the modal)
        row.addEventListener('click', (e) => {
          const custom = e.target.closest('.swatch-custom');
          if (!custom || !window.FishColorPicker || typeof window.FishColorPicker.open !== 'function') return;
          const apply = (hex) => {
            if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
            custom.dataset.val = hex;
            custom.style.backgroundColor = hex;
            custom.classList.add('is-picked');
            row.querySelectorAll('.modal-color-swatch').forEach(s => s.classList.remove('is-selected'));
            custom.classList.add('is-selected');
          };
          window.FishColorPicker.open({
            anchor: custom,
            color: (/^#[0-9a-f]{6}$/i.test(custom.dataset.val || '') ? custom.dataset.val : '#ffffff'),
            onChange: (hex) => apply(hex),
            onCommit: (hex) => apply(hex),
            onClose: () => {
              const pop = document.getElementById('popover-color-picker');
              if (pop) pop.style.zIndex = '';
            }
          });
          const pop = document.getElementById('popover-color-picker');
          if (pop) pop.style.zIndex = '10002';
        });
      });

      // 4. Settings Category Accordion Expand/Collapse Toggles (Capture phase to bypass modal-card stopPropagation)
      document.addEventListener('click', (e) => {
        const header = e.target.closest('.settings-category-header');
        if (!header) return;
        const category = header.closest('.settings-category');
        if (!category) return;
        const isCollapsed = category.classList.toggle('is-collapsed');
        header.setAttribute('aria-expanded', String(!isCollapsed));
      }, true);

      // 4. Grid overlay button live redraw & persistence
      const gridBtn = document.getElementById('editor-icon-grid');
      if (gridBtn) {
        gridBtn.addEventListener('click', () => {
          gridBtn.classList.toggle('is-active');
          const isActive = gridBtn.classList.contains('is-active');
          try {
            localStorage.setItem('oft_more_settings_grid', isActive ? 'true' : 'false');
          } catch (err) {}
          const canvas = document.getElementById('editor-active-canvas');
          if (canvas) {
            renderCanvasFrame(canvas, currentProjectState.bgColor, canvas.width, canvas.height);
          }
        });
      }

      // 5. Speed Draft Mode button (Adaptive Fast Resolution toggle & persistence)
      const draftBtn = document.getElementById('editor-icon-low-quality');
      if (draftBtn) {
        try {
          if (localStorage.getItem('oft_more_settings_draft') === 'true') {
            draftBtn.classList.add('is-active');
            window._adaptiveDraftState = { scale: 0.5, emaMs: 8.0, fastStreak: 0 };
            window._currentAdaptiveDraftScale = 0.5;
            if (window.PreviewCacheManager) {
              window.PreviewCacheManager.setDraftMode(true);
            }
          }
        } catch (_) {}
        draftBtn.addEventListener('click', () => {
          draftBtn.classList.toggle('is-active');
          const isActive = draftBtn.classList.contains('is-active');
          window._adaptiveDraftState = { scale: isActive ? 0.5 : 1.0, emaMs: 8.0, fastStreak: 0 };
          window._currentAdaptiveDraftScale = isActive ? 0.5 : 1.0;
          try {
            localStorage.setItem('oft_more_settings_draft', isActive ? 'true' : 'false');
          } catch (err) {}
          if (window.PreviewCacheManager) {
            window.PreviewCacheManager.setDraftMode(isActive);
          }
          if (typeof fitPreviewCanvasBox === 'function') {
            fitPreviewCanvasBox();
          }
          updatePreviewCanvas();
          redrawComposition('draftToggle');
        });
      }

      // 6. Global Motion Blur button live redraw & persistence
      const globalMbBtn = document.getElementById('editor-icon-motion-blur');
      if (globalMbBtn) {
        globalMbBtn.addEventListener('click', () => {
          globalMbBtn.classList.toggle('is-active');
          const isActive = globalMbBtn.classList.contains('is-active');
          const targetState = currentActivePrecomp || currentProjectState;
          targetState.motionBlur = targetState.motionBlur || {};
          targetState.motionBlur.enabled = isActive;
          try {
            localStorage.setItem('oft_global_motion_blur', String(isActive));
          } catch (_) {}
          if (typeof redrawComposition === 'function') {
            redrawComposition('globalMotionBlurToggle');
          }
          if (typeof saveCurrentProjectLayers === 'function') {
            saveCurrentProjectLayers(true);
          }
        });
      }
    });
})();
