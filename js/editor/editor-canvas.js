/**
 * OpenFishTools Studio - Editor Canvas & Transform Handles
 * Manages frame rendering (renderCanvasFrame), active layer filtering, blend modes,
 * motion blur accumulation, 2D/3D affine matrix transformations, precomp canvas buffers,
 * viewer overlays, and interactive bounding box transform handles.
 */
(function() {
    function composeEulerRotations(pRotX, pRotY, pRotZ, cRotX, cRotY, cRotZ, out = null) {
      const target = out || { rotX: 0, rotY: 0, rotZ: 0 };
      if (!pRotX && !pRotY && !pRotZ) {
        target.rotX = cRotX || 0;
        target.rotY = cRotY || 0;
        target.rotZ = cRotZ || 0;
        return target;
      }
      if (!cRotX && !cRotY && !cRotZ) {
        target.rotX = pRotX || 0;
        target.rotY = pRotY || 0;
        target.rotZ = pRotZ || 0;
        return target;
      }

      const radPX = ((pRotX || 0) * Math.PI) / 180;
      const radPY = ((pRotY || 0) * Math.PI) / 180;
      const radPZ = ((pRotZ || 0) * Math.PI) / 180;
      const cpx = Math.cos(radPX), spx = Math.sin(radPX);
      const cpy = Math.cos(radPY), spy = Math.sin(radPY);
      const cpz = Math.cos(radPZ), spz = Math.sin(radPZ);

      const mp00 = cpy * cpz;
      const mp10 = spx * spy * cpz - cpx * spz;
      const mp20 = cpx * spy * cpz + spx * spz;
      const mp01 = cpy * spz;
      const mp11 = spx * spy * spz + cpx * cpz;
      const mp21 = cpx * spy * spz - spx * cpz;
      const mp02 = -spy;
      const mp12 = spx * cpy;
      const mp22 = cpx * cpy;

      const radCX = ((cRotX || 0) * Math.PI) / 180;
      const radCY = ((cRotY || 0) * Math.PI) / 180;
      const radCZ = ((cRotZ || 0) * Math.PI) / 180;
      const ccx = Math.cos(radCX), scx = Math.sin(radCX);
      const ccy = Math.cos(radCY), scy = Math.sin(radCY);
      const ccz = Math.cos(radCZ), scz = Math.sin(radCZ);

      const mc00 = ccy * ccz;
      const mc10 = scx * scy * ccz - ccx * scz;
      const mc20 = ccx * scy * ccz + scx * scz;
      const mc01 = ccy * scz;
      const mc11 = scx * scy * scz + ccx * ccz;
      const mc21 = ccx * scy * scz - scx * ccz;
      const mc02 = -scy;
      const mc12 = scx * ccy;
      const mc22 = ccx * ccy;

      const mw00 = mp00 * mc00 + mp10 * mc01 + mp20 * mc02;
      const mw10 = mp00 * mc10 + mp10 * mc11 + mp20 * mc12;
      const mw01 = mp01 * mc00 + mp11 * mc01 + mp21 * mc02;
      const mw11 = mp01 * mc10 + mp11 * mc11 + mp21 * mc12;
      const mw02 = mp02 * mc00 + mp12 * mc01 + mp22 * mc02;
      const mw12 = mp02 * mc10 + mp12 * mc11 + mp22 * mc12;
      const mw22 = mp02 * mc20 + mp12 * mc21 + mp22 * mc22;

      const m02Clamped = Math.max(-1, Math.min(1, mw02));
      const ry = -Math.asin(m02Clamped);
      const cosY = Math.cos(ry);
      let rx, rz;
      if (Math.abs(cosY) > 0.0001) {
        rx = Math.atan2(mw12, mw22);
        rz = Math.atan2(mw01, mw00);
      } else {
        rx = 0;
        rz = Math.atan2(-mw10, mw11);
      }

      target.rotX = (rx * 180) / Math.PI;
      target.rotY = (ry * 180) / Math.PI;
      target.rotZ = (rz * 180) / Math.PI;
      return target;
    }
    window.composeEulerRotations = composeEulerRotations;

    // Module-scoped scratch arrays & objects for per-frame zero-GC operation
    const _scratchActiveLayers = [];
    const _scratchActiveVideos = [];
    const _scratchRenderOrderLayers = [];
    const _scratchLayersToRender = [];
    const _scratchActiveIdSet = new Set();
    const _scratchEulerRot = { rotX: 0, rotY: 0, rotZ: 0 };

    var _redrawCount = 0;
    var _redrawRafId = null;
    var _redrawRafScheduled = false;
    var _lastRedrawSource = 'general';

    function redrawComposition(source = 'general', immediate = false) {
      _lastRedrawSource = source;
      const isNonMutatingRedraw = (
        source === 'scrub' ||
        source === 'scrubEnd' ||
        source === 'playbackStep' ||
        source === 'playbackPause' ||
        source === 'frameReady' ||
        source === 'playbackFramesBatchLoaded' ||
        source === 'fitPreviewCanvasBox' ||
        source === 'video:onseeked'
      ) || (!!(window.isTimelineScrubbing || window.isTimelinePanning) && !window.isTransformInteracting);
      if (!window.isTimelinePlaying && !isNonMutatingRedraw && window.PreviewCacheManager && typeof window.PreviewCacheManager.syncStateWithProject === 'function') {
        window.PreviewCacheManager.syncStateWithProject();
      }

      const cancelRaf = (typeof cancelAnimationFrame === 'function') ? cancelAnimationFrame : clearTimeout;
      const requestRaf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (fn) => setTimeout(fn, 16);

      if (immediate) {
        if (_redrawRafId !== null) {
          cancelRaf(_redrawRafId);
          _redrawRafId = null;
        }
        _redrawRafScheduled = false;
        _redrawCount++;
        const canvas = document.getElementById('editor-active-canvas');
        if (!canvas) return;
        const activeBg = (currentActivePrecomp && currentActivePrecomp.bgColor !== undefined)
          ? currentActivePrecomp.bgColor
          : (currentProjectState.bgColor || 'transparent');
        renderCanvasFrame(canvas, activeBg, canvas.width, canvas.height, _lastRedrawSource);
        return;
      }

      if (_redrawRafScheduled) return;
      _redrawRafScheduled = true;

      _redrawRafId = requestRaf(() => {
        _redrawRafScheduled = false;
        _redrawRafId = null;
        _redrawCount++;
        const canvas = document.getElementById('editor-active-canvas');
        if (!canvas) return;
        const activeBg = (currentActivePrecomp && currentActivePrecomp.bgColor !== undefined)
          ? currentActivePrecomp.bgColor
          : (currentProjectState.bgColor || 'transparent');
        renderCanvasFrame(canvas, activeBg, canvas.width, canvas.height, _lastRedrawSource);
      });
    }
    window.redrawComposition = redrawComposition;

    function getPrecompChildRenderElement(child, innerSec, pw, ph, pps, triggerSource = '', layerPool = null) {
      if (!child) return null;
      const childEff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(child, innerSec, null, (Array.isArray(layerPool) && layerPool.length > 0) ? layerPool : [child]) : child;
      const effSpeed = (childEff && childEff.speed !== undefined) ? childEff.speed : (child.speed !== undefined && child.speed > 0 ? child.speed : 1);
      const isExport = (typeof triggerSource === 'string') && triggerSource.startsWith('export');

      if (child.type === 'precomp') {
        if (!child._precompBufferCanvas || !(child._precompBufferCanvas instanceof HTMLCanvasElement) || typeof child._precompBufferCanvas.getContext !== 'function') {
          child._precompBufferCanvas = document.createElement('canvas');
        }
        const childW = Math.round(Math.abs(child.mediaWidth || child.scaleW || pw));
        const childH = Math.round(Math.abs(child.mediaHeight || child.scaleH || ph));
        if (child._precompBufferCanvas.width !== childW || child._precompBufferCanvas.height !== childH) {
          child._precompBufferCanvas.width = childW;
          child._precompBufferCanvas.height = childH;
          child._precompBufferCanvas._lastRenderKey = null;
        }
        child.mediaWidth = childW;
        child.mediaHeight = childH;
        child._userResized = true;
        const cStart = child.startSec !== undefined ? child.startSec : ((child.startPx || 0) / pps);
        const cInnerSec = Math.max(0, (child.sourceOffsetSec || 0) + (innerSec - cStart) * effSpeed);
        renderPrecompToCanvas(child, child._precompBufferCanvas, cInnerSec, childW, childH, triggerSource);
        return child._precompBufferCanvas;
      } else if (child.type === 'text') {
        if (!child._textBufferCanvas || !(child._textBufferCanvas instanceof HTMLCanvasElement)) {
          child._textBufferCanvas = document.createElement('canvas');
        }
        const tw = Math.max(1, Math.round(Math.abs(child.scaleW || child.mediaWidth || 500)));
        const th = Math.max(1, Math.round(Math.abs(child.scaleH || child.mediaHeight || 180)));
        const cStart = child.startSec !== undefined ? child.startSec : ((child.startPx || 0) / pps);
        const cDur = child.durationSec !== undefined ? child.durationSec : ((child.widthPx || 400) / pps);
        const cLocal = Math.max(0, innerSec - cStart);
        if (window.FishTextEngine && typeof window.FishTextEngine.renderTextToCanvas === 'function') {
          window.FishTextEngine.renderTextToCanvas(child, child._textBufferCanvas, tw, th, cLocal, cDur);
        }
        child.mediaWidth = tw;
        child.mediaHeight = th;
        child._userResized = true;
        return child._textBufferCanvas;
      } else if (child.type === 'shape') {
        if (!child._shapeBufferCanvas || !(child._shapeBufferCanvas instanceof HTMLCanvasElement) || typeof child._shapeBufferCanvas.getContext !== 'function') {
          child._shapeBufferCanvas = document.createElement('canvas');
        }
        const isVecChild = (child.shapeType === 'vector');
        if (isVecChild && typeof window.syncVectorLayerBounds === 'function') {
          window.syncVectorLayerBounds(child, !window.isTransformInteracting);
        }
        const vBounds = (isVecChild && typeof window.getVectorLocalBounds === 'function')
          ? window.getVectorLocalBounds(child.shapeProps || {})
          : null;
        const spW = vBounds
          ? vBounds.bufferW
          : Math.max(1, Math.round(Math.abs((child.shapeProps && child.shapeProps.sizeX) || 300)));
        const spH = vBounds
          ? vBounds.bufferH
          : Math.max(1, Math.round(Math.abs((child.shapeProps && child.shapeProps.sizeY) || 300)));
        if (child._shapeBufferCanvas.width !== spW || child._shapeBufferCanvas.height !== spH) {
          child._shapeBufferCanvas.width = spW;
          child._shapeBufferCanvas.height = spH;
        }
        if (typeof renderShapeToCanvas === 'function') {
          renderShapeToCanvas(child, child._shapeBufferCanvas, spW, spH);
        }
        child.mediaWidth = vBounds ? vBounds.width : spW;
        child.mediaHeight = vBounds ? vBounds.height : spH;
        return child._shapeBufferCanvas;
      } else {
        const isNativeMedia = (child.type === 'video' || child.type === 'image');
        const effectiveFill = child.fillType || (isNativeMedia ? 'media' : (child.fillColor ? 'color' : 'none'));
        if (effectiveFill === 'none') {
          return null;
        } else if (effectiveFill === 'color' || effectiveFill === 'gradient' || (!isNativeMedia && effectiveFill === 'media')) {
          const cw = Math.round(Math.abs(child.mediaWidth || child.scaleW || pw));
          const ch = Math.round(Math.abs(child.mediaHeight || child.scaleH || ph));
          const el = (typeof getOrUpdateLayerFillCanvas === 'function') ? getOrUpdateLayerFillCanvas(child, cw, ch) : null;
          child.mediaWidth = cw;
          child.mediaHeight = ch;
          return el;
        } else {
          const m = getOrLoadLayerMedia(child);
          if (!m) return null;
          let el = m.el;
          if (child.type === 'video') {
            const res = window.VideoCompEngine.resolveLayerVideoElement(child, m, {
              isExport,
              isIdleCache: triggerSource === 'idle-cache',
              currentSec: innerSec,
              pixelsPerSecond: pps
            });
            el = res.el;
            if (el && window.FishBgRemovalEngine && window.FishBgRemovalEngine.isLayerMattingActive(child)) {
              const sourceKey = (child.mediaId || child.dataUrl || child.id);
              const fps = (currentProjectState && currentProjectState.fps) || 60;
              const fIdx = Math.round(res.timeInClip * fps);
              const cutoutFrame = window.FishBgRemovalEngine.getVideoCutoutFrame(sourceKey, fIdx);
              if (cutoutFrame) {
                el = cutoutFrame;
              } else if (!isExport && triggerSource !== 'idle-cache') {
                window.FishBgRemovalEngine.processLayer(child);
              }
            }
          } else if (el && window.FishBgRemovalEngine && window.FishBgRemovalEngine.isLayerMattingActive(child)) {
            const photoCutout = window.FishBgRemovalEngine.getPhotoCutout(child);
            if (photoCutout) {
              el = photoCutout;
            } else if (!isExport && triggerSource !== 'idle-cache') {
              window.FishBgRemovalEngine.processLayer(child);
            }
          }
          if (typeof window.getFittedMediaElement === 'function') {
            const cw = Math.abs(childEff.scaleW !== undefined ? childEff.scaleW : (child.mediaWidth || 1920));
            const ch = Math.abs(childEff.scaleH !== undefined ? childEff.scaleH : (child.mediaHeight || 1080));
            el = window.getFittedMediaElement(child, el, cw, ch);
          }
          return el;
        }
      }
    }
    window.getPrecompChildRenderElement = getPrecompChildRenderElement;

    // Helper: Compute Adaptive 3D Group Wireframe Bounds for Collapsed Precompose Layer
    function computeCollapsedPrecompBounds(precompLayer, effProps, currentSec, bufferScale, camEff, w, h) {
      const engine = window.FishToolEngine || window.LayerTransform;
      if (!engine || !precompLayer) return null;

      const pps = window.currentPixelsPerSecond || 80;
      const baseW = (typeof currentProjectState !== 'undefined' && currentProjectState.baseW) || 1920;
      const baseH = (typeof currentProjectState !== 'undefined' && currentProjectState.baseH) || 1080;
      const precompW = Math.round(Math.abs(precompLayer.mediaWidth || precompLayer.scaleW || baseW));
      const precompH = Math.round(Math.abs(precompLayer.mediaHeight || precompLayer.scaleH || baseH));

      const clipStart = precompLayer.startSec !== undefined ? precompLayer.startSec : ((precompLayer.startPx || 0) / pps);
      let innerSec = 0;
      if (precompLayer.speedMode === 'time_remap') {
        innerSec = Math.max(0, effProps.timeRemap !== undefined ? effProps.timeRemap : ((currentSec - clipStart) * (precompLayer.speed || 1.0)));
      } else {
        innerSec = (typeof getLayerIntegratedSpeedTime === 'function')
          ? getLayerIntegratedSpeedTime(precompLayer, currentSec)
          : Math.max(0, (precompLayer.sourceOffsetSec || 0) + (currentSec - clipStart) * (precompLayer.speed || 1.0));
      }

      const childLayers = precompLayer.layers || [];
      const activeChildren = childLayers.filter(child => {
        const cs = child.startSec !== undefined ? child.startSec : ((child.startPx || 0) / pps);
        const cd = child.durationSec !== undefined ? child.durationSec : ((child.widthPx || 320) / pps);
        return innerSec >= cs && innerSec < cs + cd;
      });
      const validChildren = activeChildren.filter(c => c.type !== 'camera' && c.type !== 'null' && c.type !== 'audio' && !c.hidden);

      const precompCenterBounds = engine.getBounds(Object.assign({}, precompLayer, effProps), bufferScale, camEff, w, h);
      if (validChildren.length === 0) {
        return precompCenterBounds;
      }

      const scaleRatioW = (effProps.scaleW !== undefined ? effProps.scaleW : precompW) / (precompW || 1920);
      const scaleRatioH = (effProps.scaleH !== undefined ? effProps.scaleH : precompH) / (precompH || 1080);
      const scaleRatioZ = (Math.abs(scaleRatioW) + Math.abs(scaleRatioH)) / 2;

      const pRotX = effProps.rotX || 0;
      const pRotY = effProps.rotY || 0;
      const pRotZ = effProps.rotZ !== undefined ? effProps.rotZ : (effProps.rotation || 0);

      const pivotX = precompW / 2 + (effProps.anchorX || 0);
      const pivotY = precompH / 2 + (effProps.anchorY || 0);
      const pivotZ = (effProps.anchorZ || 0);

      const pWorldX = (effProps.posX !== undefined ? effProps.posX : baseW / 2) + (effProps.anchorX || 0);
      const pWorldY = (effProps.posY !== undefined ? effProps.posY : baseH / 2) + (effProps.anchorY || 0);
      const pWorldZ = (effProps.posZ || 0) + (effProps.anchorZ || 0);

      if (validChildren.length === 1) {
        const child = validChildren[0];
        const childEff = (typeof getLayerEffectivePropsAtTime === 'function')
          ? getLayerEffectivePropsAtTime(child, innerSec, null, childLayers)
          : child;

        let vx = (childEff.posX !== undefined ? childEff.posX : precompW / 2) - pivotX;
        let vy = (childEff.posY !== undefined ? childEff.posY : precompH / 2) - pivotY;
        let vz = (childEff.posZ || 0) - pivotZ;

        vx *= scaleRatioW;
        vy *= scaleRatioH;
        vz *= scaleRatioZ;

        if (pRotZ !== 0) {
          const radZ = (pRotZ * Math.PI) / 180;
          const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
          const nvx = vx * cZ - vy * sZ, nvy = vx * sZ + vy * cZ;
          vx = nvx; vy = nvy;
        }
        if (pRotY !== 0) {
          const radY = (pRotY * Math.PI) / 180;
          const cY = Math.cos(radY), sY = Math.sin(radY);
          const nvx = vx * cY + vz * sY, nvz = -vx * sY + vz * cY;
          vx = nvx; vz = nvz;
        }
        if (pRotX !== 0) {
          const radX = (pRotX * Math.PI) / 180;
          const cX = Math.cos(radX), sX = Math.sin(radX);
          const nvy = vy * cX - vz * sX, nvz = vy * sX + vz * cX;
          vy = nvy; vz = nvz;
        }

        const worldPosX = pWorldX + vx;
        const worldPosY = pWorldY + vy;
        const worldPosZ = pWorldZ + vz;

        const worldRotX = (childEff.rotX || 0) + pRotX;
        const worldRotY = (childEff.rotY || 0) + pRotY;
        const worldRotZ = ((childEff.rotZ !== undefined ? childEff.rotZ : (childEff.rotation || 0))) + pRotZ;

        const childBaseW = (childEff.scaleW !== undefined ? childEff.scaleW : (child.scaleW || child.mediaWidth || 500));
        const childBaseH = (childEff.scaleH !== undefined ? childEff.scaleH : (child.scaleH || child.mediaHeight || 500));
        const worldScaleW = childBaseW * scaleRatioW;
        const worldScaleH = childBaseH * scaleRatioH;

        const worldAnchorX = (childEff.anchorX || 0) * scaleRatioW;
        const worldAnchorY = (childEff.anchorY || 0) * scaleRatioH;
        const worldAnchorZ = (childEff.anchorZ || 0) * scaleRatioZ;

        const childWorldAnimLayer = Object.assign({}, child, childEff, {
          posX: worldPosX,
          posY: worldPosY,
          posZ: worldPosZ,
          rotX: worldRotX,
          rotY: worldRotY,
          rotZ: worldRotZ,
          rotation: worldRotZ,
          scaleW: worldScaleW,
          scaleH: worldScaleH,
          anchorX: worldAnchorX,
          anchorY: worldAnchorY,
          anchorZ: worldAnchorZ,
          mediaWidth: child.mediaWidth || Math.abs(worldScaleW),
          mediaHeight: child.mediaHeight || Math.abs(worldScaleH)
        });

        const cb = engine.getBounds(childWorldAnimLayer, bufferScale, camEff, w, h);
        if (cb && cb.corners && Array.isArray(cb.corners) && cb.corners.length === 4) {
          return cb;
        }
      }

      if (validChildren.length > 1 && (pRotX !== 0 || pRotY !== 0 || pRotZ !== 0) && precompCenterBounds && precompCenterBounds.corners && precompCenterBounds.corners.length === 4) {
        return precompCenterBounds;
      }

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let anyValid = false;

      validChildren.forEach(child => {
        const childEff = (typeof getLayerEffectivePropsAtTime === 'function')
          ? getLayerEffectivePropsAtTime(child, innerSec, null, childLayers)
          : child;

        let vx = (childEff.posX !== undefined ? childEff.posX : precompW / 2) - pivotX;
        let vy = (childEff.posY !== undefined ? childEff.posY : precompH / 2) - pivotY;
        let vz = (childEff.posZ || 0) - pivotZ;

        vx *= scaleRatioW;
        vy *= scaleRatioH;
        vz *= scaleRatioZ;

        if (pRotZ !== 0) {
          const radZ = (pRotZ * Math.PI) / 180;
          const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
          const nvx = vx * cZ - vy * sZ, nvy = vx * sZ + vy * cZ;
          vx = nvx; vy = nvy;
        }
        if (pRotY !== 0) {
          const radY = (pRotY * Math.PI) / 180;
          const cY = Math.cos(radY), sY = Math.sin(radY);
          const nvx = vx * cY + vz * sY, nvz = -vx * sY + vz * cY;
          vx = nvx; vz = nvz;
        }
        if (pRotX !== 0) {
          const radX = (pRotX * Math.PI) / 180;
          const cX = Math.cos(radX), sX = Math.sin(radX);
          const nvy = vy * cX - vz * sX, nvz = vy * sX + vz * cX;
          vy = nvy; vz = nvz;
        }

        const worldPosX = pWorldX + vx;
        const worldPosY = pWorldY + vy;
        const worldPosZ = pWorldZ + vz;

        const worldRotX = (childEff.rotX || 0) + pRotX;
        const worldRotY = (childEff.rotY || 0) + pRotY;
        const worldRotZ = ((childEff.rotZ !== undefined ? childEff.rotZ : (childEff.rotation || 0))) + pRotZ;

        const childBaseW = (childEff.scaleW !== undefined ? childEff.scaleW : (child.scaleW || child.mediaWidth || 500));
        const childBaseH = (childEff.scaleH !== undefined ? childEff.scaleH : (child.scaleH || child.mediaHeight || 500));
        const worldScaleW = childBaseW * scaleRatioW;
        const worldScaleH = childBaseH * scaleRatioH;

        const worldAnchorX = (childEff.anchorX || 0) * scaleRatioW;
        const worldAnchorY = (childEff.anchorY || 0) * scaleRatioH;
        const worldAnchorZ = (childEff.anchorZ || 0) * scaleRatioZ;

        const childWorldAnimLayer = Object.assign({}, child, childEff, {
          posX: worldPosX,
          posY: worldPosY,
          posZ: worldPosZ,
          rotX: worldRotX,
          rotY: worldRotY,
          rotZ: worldRotZ,
          rotation: worldRotZ,
          scaleW: worldScaleW,
          scaleH: worldScaleH,
          anchorX: worldAnchorX,
          anchorY: worldAnchorY,
          anchorZ: worldAnchorZ,
          mediaWidth: child.mediaWidth || Math.abs(worldScaleW),
          mediaHeight: child.mediaHeight || Math.abs(worldScaleH)
        });

        const cb = engine.getBounds(childWorldAnimLayer, bufferScale, camEff, w, h);
        if (cb && cb.corners && Array.isArray(cb.corners)) {
          cb.corners.forEach(pt => {
            if (pt && !pt.isBehind && !isNaN(pt.x) && !isNaN(pt.y)) {
              anyValid = true;
              if (pt.x < minX) minX = pt.x;
              if (pt.x > maxX) maxX = pt.x;
              if (pt.y < minY) minY = pt.y;
              if (pt.y > maxY) maxY = pt.y;
            }
          });
        }
      });

      if (!anyValid || !isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
        return precompCenterBounds;
      }

      const anc = (precompCenterBounds && precompCenterBounds.anchor) ? precompCenterBounds.anchor : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      const groupCorners = [
        { x: minX, y: minY, z: 0 },
        { x: maxX, y: minY, z: 0 },
        { x: maxX, y: maxY, z: 0 },
        { x: minX, y: maxY, z: 0 }
      ];

      return {
        is3D: true,
        isBehindCamera: false,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        x: minX,
        y: minY,
        w: Math.max(1, maxX - minX),
        h: Math.max(1, maxY - minY),
        aabbW: Math.max(1, maxX - minX),
        aabbH: Math.max(1, maxY - minY),
        corners: groupCorners,
        anchor: anc,
        handles: [
          { type: 'nw', x: minX, y: minY, cursor: 'nwse-resize' },
          { type: 'n',  x: (minX + maxX) / 2, y: minY, cursor: 'ns-resize' },
          { type: 'ne', x: maxX, y: minY, cursor: 'nesw-resize' },
          { type: 'e',  x: maxX, y: (minY + maxY) / 2, cursor: 'ew-resize' },
          { type: 'se', x: maxX, y: maxY, cursor: 'nwse-resize' },
          { type: 's',  x: (minX + maxX) / 2, y: maxY, cursor: 'ns-resize' },
          { type: 'sw', x: minX, y: maxY, cursor: 'nesw-resize' },
          { type: 'w',  x: minX, y: (minY + maxY) / 2, cursor: 'ew-resize' },
          { type: 'anchor', x: anc.x, y: anc.y, cursor: 'move' }
        ],
        bufferScale
      };
    }
    window.computeCollapsedPrecompBounds = computeCollapsedPrecompBounds;

    // Helper: Compute Adaptive Wireframe Bounds for Child Layer inside Precompose
    function computeChildWorldBounds(child, parentPrecomp, targetSec, bufferScale, camEff, w, h) {
      const engine = window.FishToolEngine || window.LayerTransform;
      if (!engine || !child || !parentPrecomp) return null;

      const pps = window.currentPixelsPerSecond || 80;
      const baseW = (typeof currentProjectState !== 'undefined' && currentProjectState.baseW) || 1920;
      const baseH = (typeof currentProjectState !== 'undefined' && currentProjectState.baseH) || 1080;
      const precompW = Math.round(Math.abs(parentPrecomp.mediaWidth || parentPrecomp.scaleW || baseW));
      const precompH = Math.round(Math.abs(parentPrecomp.mediaHeight || parentPrecomp.scaleH || baseH));

      const clipStart = parentPrecomp.startSec !== undefined ? parentPrecomp.startSec : ((parentPrecomp.startPx || 0) / pps);
      let innerSec = 0;
      if (parentPrecomp.speedMode === 'time_remap') {
        innerSec = Math.max(0, parentPrecomp.timeRemap !== undefined ? parentPrecomp.timeRemap : ((targetSec - clipStart) * (parentPrecomp.speed || 1.0)));
      } else {
        innerSec = (typeof getLayerIntegratedSpeedTime === 'function')
          ? getLayerIntegratedSpeedTime(parentPrecomp, targetSec)
          : Math.max(0, (parentPrecomp.sourceOffsetSec || 0) + (targetSec - clipStart) * (parentPrecomp.speed || 1.0));
      }

      const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
        ? getLayerEffectivePropsAtTime(parentPrecomp, targetSec)
        : parentPrecomp;

      const scaleRatioW = (effProps.scaleW !== undefined ? effProps.scaleW : precompW) / (precompW || 1920);
      const scaleRatioH = (effProps.scaleH !== undefined ? effProps.scaleH : precompH) / (precompH || 1080);
      const scaleRatioZ = (Math.abs(scaleRatioW) + Math.abs(scaleRatioH)) / 2;

      const pRotX = effProps.rotX || 0;
      const pRotY = effProps.rotY || 0;
      const pRotZ = effProps.rotZ !== undefined ? effProps.rotZ : (effProps.rotation || 0);

      const pivotX = precompW / 2 + (effProps.anchorX || 0);
      const pivotY = precompH / 2 + (effProps.anchorY || 0);
      const pivotZ = (effProps.anchorZ || 0);

      const pWorldX = (effProps.posX !== undefined ? effProps.posX : baseW / 2) + (effProps.anchorX || 0);
      const pWorldY = (effProps.posY !== undefined ? effProps.posY : baseH / 2) + (effProps.anchorY || 0);
      const pWorldZ = (effProps.posZ || 0) + (effProps.anchorZ || 0);

      const childEff = (typeof getLayerEffectivePropsAtTime === 'function')
        ? getLayerEffectivePropsAtTime(child, innerSec, null, parentPrecomp.layers || [])
        : child;

      let vx = (childEff.posX !== undefined ? childEff.posX : precompW / 2) - pivotX;
      let vy = (childEff.posY !== undefined ? childEff.posY : precompH / 2) - pivotY;
      let vz = (childEff.posZ || 0) - pivotZ;

      vx *= scaleRatioW;
      vy *= scaleRatioH;
      vz *= scaleRatioZ;

      if (pRotZ !== 0) {
        const radZ = (pRotZ * Math.PI) / 180;
        const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
        const nvx = vx * cZ - vy * sZ, nvy = vx * sZ + vy * cZ;
        vx = nvx; vy = nvy;
      }
      if (pRotY !== 0) {
        const radY = (pRotY * Math.PI) / 180;
        const cY = Math.cos(radY), sY = Math.sin(radY);
        const nvx = vx * cY + vz * sY, nvz = -vx * sY + vz * cY;
        vx = nvx; vz = nvz;
      }
      if (pRotX !== 0) {
        const radX = (pRotX * Math.PI) / 180;
        const cX = Math.cos(radX), sX = Math.sin(radX);
        const nvy = vy * cX - vz * sX, nvz = vy * sX + vz * cX;
        vy = nvy; vz = nvz;
      }

      const worldPosX = pWorldX + vx;
      const worldPosY = pWorldY + vy;
      const worldPosZ = pWorldZ + vz;

      const worldRotX = (childEff.rotX || 0) + pRotX;
      const worldRotY = (childEff.rotY || 0) + pRotY;
      const worldRotZ = ((childEff.rotZ !== undefined ? childEff.rotZ : (childEff.rotation || 0))) + pRotZ;

      const childBaseW = (childEff.scaleW !== undefined ? childEff.scaleW : (child.scaleW || child.mediaWidth || 300));
      const childBaseH = (childEff.scaleH !== undefined ? childEff.scaleH : (child.scaleH || child.mediaHeight || 300));
      const worldScaleW = childBaseW * scaleRatioW;
      const worldScaleH = childBaseH * scaleRatioH;

      const worldAnchorX = (childEff.anchorX || 0) * scaleRatioW;
      const worldAnchorY = (childEff.anchorY || 0) * scaleRatioH;
      const worldAnchorZ = (childEff.anchorZ || 0) * scaleRatioZ;

      const childWorldAnimLayer = Object.assign({}, child, childEff, {
        posX: worldPosX,
        posY: worldPosY,
        posZ: worldPosZ,
        rotX: worldRotX,
        rotY: worldRotY,
        rotZ: worldRotZ,
        rotation: worldRotZ,
        scaleW: worldScaleW,
        scaleH: worldScaleH,
        anchorX: worldAnchorX,
        anchorY: worldAnchorY,
        anchorZ: worldAnchorZ,
        skewX: (childEff.skewX || 0) + (effProps.skewX || 0),
        skewY: (childEff.skewY || 0) + (effProps.skewY || 0)
      });

      return engine.getBounds(childWorldAnimLayer, bufferScale, camEff, w, h);
    }
    window.computeChildWorldBounds = computeChildWorldBounds;

    // Global Blend Mode & Composite Operation Resolver (Mask & Exclude support)
    function resolveBlendMode(mode) {
      if (!mode || mode === 'normal') return 'source-over';
      if (mode === 'mask') return 'destination-in';
      if (mode === 'exclude') return 'destination-out';
      return mode;
    }
    window.resolveBlendMode = resolveBlendMode;

    // A precomp that owns a visible camera must be rasterized through that camera.
    // Collapse Transformations would merge its children into the parent scene and
    // silently drop the inner camera, so callers treat such precomps as non-collapsed.
    function precompHasOwnCamera(precompLayer) {
      if (!precompLayer || !Array.isArray(precompLayer.layers)) return false;
      return precompLayer.layers.some(c => c && c.type === 'camera' && !c.hidden);
    }
    window.precompHasOwnCamera = precompHasOwnCamera;

    function isPrecompEffectivelyCollapsed(precompLayer) {
      return !!(precompLayer && precompLayer.type === 'precomp' && precompLayer.collapseTransformations && !precompHasOwnCamera(precompLayer));
    }
    window.isPrecompEffectivelyCollapsed = isPrecompEffectivelyCollapsed;

    // Resolve the active camera inside a precomp at its local time (null when none).
    function getPrecompInnerCameraEff(activeChildren, innerSec, childLayers) {
      const cam = activeChildren.find(c => c && c.type === 'camera' && !c.hidden);
      if (!cam) return null;
      const eff = (typeof getLayerEffectivePropsAtTime === 'function')
        ? getLayerEffectivePropsAtTime(cam, innerSec, null, childLayers)
        : Object.assign({}, cam);
      eff._rawCamera = cam;
      return eff;
    }
    window.getPrecompInnerCameraEff = getPrecompInnerCameraEff;

    // Render Precompose Layer onto offscreen canvas buffer

    function renderPrecompToCanvas(precompLayer, targetCanvas, innerSec, targetW = null, targetH = null, triggerSource = '', visitedPrecomps = new Set()) {
      if (!targetCanvas || typeof targetCanvas.getContext !== 'function' || !precompLayer) return;
      if (visitedPrecomps.has(precompLayer) || (precompLayer.id && visitedPrecomps.has(precompLayer.id))) return;
      visitedPrecomps.add(precompLayer);
      if (precompLayer.id) visitedPrecomps.add(precompLayer.id);
      const pctx = targetCanvas.getContext('2d');
      if (!pctx) return;
      const pw = targetW || targetCanvas.width || precompLayer.mediaWidth || Math.round(Math.abs(precompLayer.scaleW)) || 1920;
      const ph = targetH || targetCanvas.height || precompLayer.mediaHeight || Math.round(Math.abs(precompLayer.scaleH)) || 1080;
      const baseW = Math.round(Math.abs(precompLayer.mediaWidth || precompLayer.scaleW || pw || 1920));
      const baseH = Math.round(Math.abs(precompLayer.mediaHeight || precompLayer.scaleH || ph || 1080));

      const fps = (typeof getProjectFps === 'function') ? getProjectFps() : 60;
      const pps = window.currentPixelsPerSecond || 80;
      const childLayers = precompLayer.layers || [];

      // Frame key strictly bound to playhead time within precomp (at project FPS resolution)
      const frameKey = `${Math.round(innerSec * fps)}_${pw}_${ph}`;
      if (!precompLayer._dirty && targetCanvas._lastRenderKey === frameKey && targetCanvas.width === pw && targetCanvas.height === ph) {
        return; // Fast-path: precomp content already rendered for this exact frame!
      }

      if (targetCanvas.width !== pw || targetCanvas.height !== ph) {
        targetCanvas.width = pw;
        targetCanvas.height = ph;
      }

      pctx.clearRect(0, 0, pw, ph);

      const activeChildren = childLayers.filter(child => {
        const cs = child.startSec !== undefined ? child.startSec : ((child.startPx || 0) / pps);
        const cd = child.durationSec !== undefined ? child.durationSec : ((child.widthPx || 320) / pps);
        return innerSec >= cs && innerSec < cs + cd;
      });

      const drawList = [...activeChildren].reverse().filter(c => c.type !== 'camera' && c.type !== 'null' && c.type !== 'audio' && !c.hidden);
      const isExport = (typeof triggerSource === 'string') && triggerSource.startsWith('export');
      // Camera inside this precomp drives its 3D children (previously dropped -> camera looked absent).
      const innerCamEff = getPrecompInnerCameraEff(activeChildren, innerSec, childLayers);
      const innerCamRaw = innerCamEff ? innerCamEff._rawCamera : null;
      // Engine expects composition-space props plus a uniform buffer scale (matches main comp path).
      const precompRenderScale = pw / (baseW || pw || 1);

      drawList.forEach(child => {
        let childEl = null;
        const childEff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(child, innerSec, null, childLayers) : child;
        const effSpeed = (childEff && childEff.speed !== undefined) ? childEff.speed : (child.speed !== undefined && child.speed > 0 ? child.speed : 1);

        if (child.type === 'precomp') {
          const childBaseW = Math.round(Math.abs(child.mediaWidth || child.scaleW || baseW));
          const childBaseH = Math.round(Math.abs(child.mediaHeight || child.scaleH || baseH));
          const childW = isExport ? childBaseW : Math.max(1, Math.round(childBaseW * (pw / baseW)));
          const childH = isExport ? childBaseH : Math.max(1, Math.round(childBaseH * (ph / baseH)));
          const precompRes = (triggerSource !== 'precomp-extract' && window.VideoCompEngine && typeof window.VideoCompEngine.resolvePrecompElement === 'function')
            ? window.VideoCompEngine.resolvePrecompElement(child, {
                isExport,
                isIdleCache: triggerSource === 'idle-cache',
                currentSec: innerSec,
                pixelsPerSecond: pps,
                targetW: childW,
                targetH: childH
              })
            : null;
          if (precompRes && precompRes.fromSequence && precompRes.el) {
            childEl = precompRes.el;
          } else {
            if (!child._precompBufferCanvas || !(child._precompBufferCanvas instanceof HTMLCanvasElement) || typeof child._precompBufferCanvas.getContext !== 'function') {
              child._precompBufferCanvas = document.createElement('canvas');
            }
            if (child._precompBufferCanvas.width !== childW || child._precompBufferCanvas.height !== childH) {
              child._precompBufferCanvas.width = childW;
              child._precompBufferCanvas.height = childH;
              child._precompBufferCanvas._lastRenderKey = null;
            }
            const cStart = child.startSec !== undefined ? child.startSec : ((child.startPx || 0) / pps);
            const cInnerSec = Math.max(0, (child.sourceOffsetSec || 0) + (innerSec - cStart) * effSpeed);
            renderPrecompToCanvas(child, child._precompBufferCanvas, cInnerSec, childW, childH, triggerSource, visitedPrecomps);
            childEl = child._precompBufferCanvas;
          }
          child.mediaWidth = childBaseW;
          child.mediaHeight = childBaseH;
          child._userResized = true;
        } else if (child.type === 'adjustment') {
          if (!child._adjSnapCanvas) {
            child._adjSnapCanvas = document.createElement('canvas');
          }
          if (child._adjSnapCanvas.width !== pw || child._adjSnapCanvas.height !== ph) {
            child._adjSnapCanvas.width = pw;
            child._adjSnapCanvas.height = ph;
          }
          const snap = child._adjSnapCanvas;
          const sctx = snap.getContext('2d');
          if (sctx) {
            sctx.clearRect(0, 0, pw, ph);
            sctx.drawImage(targetCanvas, 0, 0);
            const animChild = Object.assign({}, child, childEff);
            if (window.FishEffects && typeof window.FishEffects.renderLayer === 'function' && Array.isArray(child.effects) && child.effects.length > 0) {
              pctx.save();
              if (childEff.opacity !== undefined && childEff.opacity !== null) {
                pctx.globalAlpha = Math.max(0, Math.min(1, childEff.opacity));
              }
              if (child.blendMode && child.blendMode !== 'normal') {
                pctx.globalCompositeOperation = resolveBlendMode(child.blendMode);
              }
              try {
                window.FishEffects.renderLayer(pctx, snap, animChild, { x: 0, y: 0, w: pw, h: ph }, innerSec);
              } catch (e) {
                console.warn('[Precomp Adjustment] Effect render error:', e);
              }
              pctx.restore();
            } else if (window.FishEffects && typeof window.FishEffects.applyToContext === 'function') {
              window.FishEffects.applyToContext(pctx, animChild);
            }
          }
          return;
        } else if (child.type === 'text') {
          if (!child._textBufferCanvas || !(child._textBufferCanvas instanceof HTMLCanvasElement)) {
            child._textBufferCanvas = document.createElement('canvas');
          }
          const tw = Math.max(1, Math.round(Math.abs(child.scaleW || child.mediaWidth || 500)));
          const th = Math.max(1, Math.round(Math.abs(child.scaleH || child.mediaHeight || 180)));
          const cStart = child.startSec !== undefined ? child.startSec : ((child.startPx || 0) / pps);
          const cDur = child.durationSec !== undefined ? child.durationSec : ((child.widthPx || 400) / pps);
          const cLocal = Math.max(0, innerSec - cStart);
          if (window.FishTextEngine && typeof window.FishTextEngine.renderTextToCanvas === 'function') {
            window.FishTextEngine.renderTextToCanvas(child, child._textBufferCanvas, tw, th, cLocal, cDur);
          }
          childEl = child._textBufferCanvas;
          child.mediaWidth = tw;
          child.mediaHeight = th;
          child._userResized = true;
        } else if (child.type === 'shape') {
          if (!child._shapeBufferCanvas || !(child._shapeBufferCanvas instanceof HTMLCanvasElement) || typeof child._shapeBufferCanvas.getContext !== 'function') {
            child._shapeBufferCanvas = document.createElement('canvas');
          }
          const isVecChild = (child.shapeType === 'vector');
          if (isVecChild && typeof window.syncVectorLayerBounds === 'function') {
            window.syncVectorLayerBounds(child, !window.isTransformInteracting);
          }
          const vBounds = (isVecChild && typeof window.getVectorLocalBounds === 'function')
            ? window.getVectorLocalBounds(child.shapeProps || {})
            : null;
          const spW = vBounds
            ? vBounds.bufferW
            : Math.max(1, Math.round(Math.abs((child.shapeProps && child.shapeProps.sizeX) || 300)));
          const spH = vBounds
            ? vBounds.bufferH
            : Math.max(1, Math.round(Math.abs((child.shapeProps && child.shapeProps.sizeY) || 300)));
          if (child._shapeBufferCanvas.width !== spW || child._shapeBufferCanvas.height !== spH) {
            child._shapeBufferCanvas.width = spW;
            child._shapeBufferCanvas.height = spH;
          }
          if (typeof renderShapeToCanvas === 'function') {
            renderShapeToCanvas(child, child._shapeBufferCanvas, spW, spH);
          }
          childEl = child._shapeBufferCanvas;
          child.mediaWidth = vBounds ? vBounds.width : spW;
          child.mediaHeight = vBounds ? vBounds.height : spH;
        } else {
          const isNativeMedia = (child.type === 'video' || child.type === 'image');
          const effectiveFill = child.fillType || (isNativeMedia ? 'media' : (child.fillColor ? 'color' : 'none'));
          if (effectiveFill === 'none') {
            childEl = null;
          } else if (effectiveFill === 'color' || effectiveFill === 'gradient' || (!isNativeMedia && effectiveFill === 'media')) {
            const cw = Math.round(Math.abs(child.mediaWidth || child.scaleW || pw));
            const ch = Math.round(Math.abs(child.mediaHeight || child.scaleH || ph));
            childEl = (typeof getOrUpdateLayerFillCanvas === 'function') ? getOrUpdateLayerFillCanvas(child, cw, ch) : null;
            child.mediaWidth = cw;
            child.mediaHeight = ch;
          } else {
            const m = getOrLoadLayerMedia(child);
            if (!m) return;
            childEl = m.el;
            if (child.type === 'video') {
              const res = window.VideoCompEngine.resolveLayerVideoElement(child, m, {
                isExport,
                isIdleCache: triggerSource === 'idle-cache',
                currentSec: innerSec,
                pixelsPerSecond: pps
              });
              childEl = res.el;
              if (childEl && window.FishBgRemovalEngine && window.FishBgRemovalEngine.isLayerMattingActive(child)) {
                const sourceKey = (child.mediaId || child.dataUrl || child.id);
                const fps = (currentProjectState && currentProjectState.fps) || 60;
                const fIdx = Math.round(res.timeInClip * fps);
                const cutoutFrame = window.FishBgRemovalEngine.getVideoCutoutFrame(sourceKey, fIdx);
                if (cutoutFrame) {
                  childEl = cutoutFrame;
                } else if (!isExport && triggerSource !== 'idle-cache') {
                  window.FishBgRemovalEngine.processLayer(child);
                }
              }
            } else if (childEl && window.FishBgRemovalEngine && window.FishBgRemovalEngine.isLayerMattingActive(child)) {
              const photoCutout = window.FishBgRemovalEngine.getPhotoCutout(child);
              if (photoCutout) {
                childEl = photoCutout;
              } else if (!isExport && triggerSource !== 'idle-cache') {
                window.FishBgRemovalEngine.processLayer(child);
              }
            }
          }
        }

        if (!childEl) return;
        const cx = (childEff.posX !== undefined ? childEff.posX : (pw / 2));
        const cy = (childEff.posY !== undefined ? childEff.posY : (ph / 2));
        let bw = (childEff.scaleW !== undefined ? childEff.scaleW : (child.mediaWidth || pw));
        let bh = (childEff.scaleH !== undefined ? childEff.scaleH : (child.mediaHeight || ph));
        if ((child.type === 'image' || child.type === 'video') && (!child.fillType || child.fillType === 'media') && typeof window.getFittedMediaElement === 'function') {
          childEl = window.getFittedMediaElement(child, childEl, bw, bh);
        }

        if (child.type === 'shape') {
          if (bw === undefined || isNaN(bw)) {
            bw = ((child.shapeProps && child.shapeProps.sizeX) || 300) * (child.transformScaleX !== undefined ? child.transformScaleX : 1.0);
          }
          if (bh === undefined || isNaN(bh)) {
            bh = ((child.shapeProps && child.shapeProps.sizeY) || 300) * (child.transformScaleY !== undefined ? child.transformScaleY : 1.0);
          }
        }
        const rotZ = childEff.rotZ !== undefined ? childEff.rotZ : (childEff.rotation || 0);
        const rotX = childEff.rotX || 0;
        const rotY = childEff.rotY || 0;
        const skewX = childEff.skewX || 0;
        const skewY = childEff.skewY || 0;
        const ax = childEff.anchorX || 0;
        const ay = childEff.anchorY || 0;

        const signX = Math.sign(bw) || 1;
        const signY = Math.sign(bh) || 1;
        const absW = Math.abs(bw);
        const absH = Math.abs(bh);

        const mbEngine = window.FishMotionBlurEngine;
        const isMbActive = mbEngine && mbEngine.isLayerActive(child, precompLayer, innerCamRaw) && mbEngine.hasMotion(child, innerSec, null, fps, childLayers, innerCamRaw);

        const drawChildSinglePass = (targetCtx, targetEl, targetChild, eff, passCamEff) => {
          targetCtx.save();
          if (eff.opacity !== undefined && eff.opacity !== null) {
            targetCtx.globalAlpha = Math.max(0, Math.min(1, eff.opacity));
          }
          if (targetChild.blendMode && targetChild.blendMode !== 'normal') {
            targetCtx.globalCompositeOperation = resolveBlendMode(targetChild.blendMode);
          }
          if (window.FishEffects && typeof window.FishEffects.applyToContext === 'function') {
            const animChild = Object.assign({}, targetChild, eff);
            window.FishEffects.applyToContext(targetCtx, animChild);
          }

          let childPadRatioW = 1;
          let childPadRatioH = 1;
          if (targetChild.type === 'shape' && targetChild.shapeType === 'vector' && targetChild.shapeProps && typeof window.getVectorLocalBounds === 'function') {
            const vb = window.getVectorLocalBounds(targetChild.shapeProps);
            childPadRatioW = (targetEl.width || vb.bufferW || 24) / Math.max(1, vb.width || 24);
            childPadRatioH = (targetEl.height || vb.bufferH || 24) / Math.max(1, vb.height || 24);
          }

          const curCx = (eff.posX !== undefined ? eff.posX : (baseW / 2)) * (pw / baseW);
          const curCy = (eff.posY !== undefined ? eff.posY : (baseH / 2)) * (ph / baseH);
          const curBw = (eff.scaleW !== undefined ? eff.scaleW : (child.mediaWidth || baseW)) * (pw / baseW) * childPadRatioW;
          const curBh = (eff.scaleH !== undefined ? eff.scaleH : (child.mediaHeight || baseH)) * (ph / baseH) * childPadRatioH;
          const curRotZ = eff.rotZ !== undefined ? eff.rotZ : (eff.rotation || 0);
          const curRotX = eff.rotX || 0;
          const curRotY = eff.rotY || 0;
          const curSkewX = eff.skewX || 0;
          const curSkewY = eff.skewY || 0;
          const curAx = (eff.anchorX || 0) * (pw / baseW);
          const curAy = (eff.anchorY || 0) * (ph / baseH);
          const curSignX = Math.sign(curBw) || 1;
          const curSignY = Math.sign(curBh) || 1;
          const curAbsW = Math.abs(curBw);
          const curAbsH = Math.abs(curBh);

          const engine = window.FishToolEngine || window.LayerTransform;
          const isChild3D = engine && (Math.abs(curRotX) > 0.001 || Math.abs(curRotY) > 0.001 || Math.abs(eff.posZ || 0) > 0.001 || Math.abs(eff.anchorZ || 0) > 0.001 || !!targetChild.is3D);
          if (isChild3D) {
            // Pass composition-space props + uniform scale (same contract as the main comp) so the
            // camera offset, camera distance and near plane scale with the preview buffer.
            const animChild = Object.assign({}, targetChild, eff, {
              posX: eff.posX !== undefined ? eff.posX : (baseW / 2),
              posY: eff.posY !== undefined ? eff.posY : (baseH / 2),
              scaleW: (eff.scaleW !== undefined ? eff.scaleW : (child.mediaWidth || baseW)) * childPadRatioW,
              scaleH: (eff.scaleH !== undefined ? eff.scaleH : (child.mediaHeight || baseH)) * childPadRatioH,
              _isVectorRenderPass: targetChild.type === 'shape' && targetChild.shapeType === 'vector',
              rotZ: curRotZ,
              rotX: curRotX,
              rotY: curRotY,
              skewX: curSkewX,
              skewY: curSkewY,
              anchorX: eff.anchorX || 0,
              anchorY: eff.anchorY || 0,
              opacity: eff.opacity !== undefined ? eff.opacity : 1.0
            });
            const passCam = (passCamEff !== undefined) ? passCamEff : innerCamEff;
            const passSec = (eff && typeof eff._currentSec === 'number') ? eff._currentSec : innerSec;
            engine.renderLayer(targetCtx, targetEl, animChild, precompRenderScale, passCam, passSec);
            targetCtx.restore();
            return;
          }

          targetCtx.translate(curCx + curAx * curSignX, curCy + curAy * curSignY);
          if (curRotZ) targetCtx.rotate((curRotZ * Math.PI) / 180);
          if (curRotX || curRotY) {
            const cosX = Math.cos((curRotX * Math.PI) / 180);
            const cosY = Math.cos((curRotY * Math.PI) / 180);
            targetCtx.scale(cosY, cosX);
          }
          if (curSkewX || curSkewY) {
            const tanX = Math.tan(((curSkewX || 0) * Math.PI) / 180);
            const tanY = Math.tan(((curSkewY || 0) * Math.PI) / 180);
            targetCtx.transform(1, tanY, tanX, 1, 0, 0);
          }
          if (curSignX < 0 || curSignY < 0) {
            targetCtx.scale(curSignX, curSignY);
          }

          try {
            if (window.FishEffects && typeof window.FishEffects.renderLayer === 'function' && Array.isArray(targetChild.effects) && targetChild.effects.length > 0) {
              const childRenderSec = (eff && typeof eff._currentSec === 'number') ? eff._currentSec : innerSec;
              window.FishEffects.renderLayer(targetCtx, targetEl, Object.assign({}, targetChild, eff), { x: -curAbsW / 2 - curAx, y: -curAbsH / 2 - curAy, w: curAbsW, h: curAbsH }, childRenderSec);
            } else {
              targetCtx.drawImage(targetEl, -curAbsW / 2 - curAx, -curAbsH / 2 - curAy, curAbsW, curAbsH);
            }
          } catch (_) {}
          targetCtx.restore();
        };

        if (isMbActive) {
          mbEngine.renderLayerWithMotionBlur(
            pctx,
            childEl,
            child,
            precompRenderScale,
            innerCamEff,
            innerSec,
            (subCtx, subEl, subChild, subScale, subCam, subSec) => {
              const currentSubEl = subEl; // text glyph blur already baked in buffer
              const subEff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(subChild, subSec, null, childLayers) : subChild;
              if (subEff) subEff._currentSec = subSec;
              const subCamEff = (innerCamRaw && typeof getLayerEffectivePropsAtTime === 'function')
                ? getLayerEffectivePropsAtTime(innerCamRaw, subSec, null, childLayers)
                : innerCamEff;
              drawChildSinglePass(subCtx, currentSubEl, subChild, subEff, subCamEff);
            },
            precompLayer
          );
        } else {
          drawChildSinglePass(pctx, childEl, child, childEff);
        }
      });

      targetCanvas._lastRenderKey = frameKey;
      targetCanvas._contentVersion = (targetCanvas._contentVersion || 0) + 1;
      precompLayer._dirty = false;
    }
    window.renderPrecompToCanvas = renderPrecompToCanvas;

    // Sync interactive canvas overlay & wireframe bounds strictly for visible player
    function syncActiveViewerOverlay(targetSec, w, h, bufferScale = null, camEff = null, activeLayers = null) {
      const allSelectedIds = (window.selectedLayerIds && window.selectedLayerIds.size > 0)
        ? Array.from(window.selectedLayerIds)
        : (window.selectedLayerId ? [window.selectedLayerId] : []);

      // Fast-path during active playback: if no layer is selected and grid overlay is off, skip per-frame overlay redraw
      if (window.isTimelinePlaying && allSelectedIds.length === 0) {
        if (!window.CanvasOverlay || !window.CanvasOverlay.showGrid) {
          return;
        }
      }

      const layers = (currentProjectState && currentProjectState.layers) || [];
      const pixelsPerSecond = window.currentPixelsPerSecond || 80;

      if (!activeLayers) {
        activeLayers = layers.filter(layer => {
          const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
          const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pixelsPerSecond);
          const end = start + dur;
          return targetSec >= start && targetSec < end;
        });
      }

      if (bufferScale === null) {
        const aspect = (currentProjectState && currentProjectState.aspectRatio) || '16:9';
        const res = (currentProjectState && currentProjectState.resolution) || '1080p';
        let baseDims = window.getProjectDimensions(res, aspect);
        if (currentActivePrecomp) {
          const cw = Math.round(Math.abs(currentActivePrecomp.mediaWidth || currentActivePrecomp.scaleW || baseDims[0]));
          const ch = Math.round(Math.abs(currentActivePrecomp.mediaHeight || currentActivePrecomp.scaleH || baseDims[1]));
          baseDims = [cw, ch];
        }
        bufferScale = w / (baseDims[0] || 1920);
      }
      window._lastBufferScale = bufferScale;

      if (camEff === null) {
        const activeCamera = activeLayers.find(l => l.type === 'camera' && !l.hidden);
        camEff = activeCamera
          ? ((typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(activeCamera, targetSec) : activeCamera)
          : null;
      }

      if (allSelectedIds.length > 0) {
        _scratchActiveIdSet.clear();
        for (let i = 0; i < activeLayers.length; i++) {
          _scratchActiveIdSet.add(activeLayers[i].id);
        }
        const activeIds = _scratchActiveIdSet;
        const engine = window.FishToolEngine || window.LayerTransform;
        allSelectedIds.forEach(id => {
          const selL = layers.find(l => l.id === id);
          if (!selL || selL.type === 'audio') {
            if (selL) selL._canvasBounds = null;
            return;
          }

          // Precompose Child Layer Bounds Resolver
          const parentPrecomp = selL._parentPrecomp || (typeof findLayerParentPrecomp === 'function' ? findLayerParentPrecomp(selL.id) : null);
          if (parentPrecomp) {
            if (!activeIds.has(parentPrecomp.id)) {
              selL._canvasBounds = null;
              return;
            }
            if (typeof computeChildWorldBounds === 'function') {
              selL._canvasBounds = computeChildWorldBounds(selL, parentPrecomp, targetSec, bufferScale, camEff, w, h);
            }
            return;
          }

          if (!activeIds.has(id)) {
            selL._canvasBounds = null;
            return;
          }
          if (selL.type === 'camera') {
            const padX = Math.max(8, Math.round(w * 0.035));
            const padY = Math.max(8, Math.round(h * 0.035));
            const frameW = w - padX * 2;
            const frameH = h - padY * 2;
            selL._canvasBounds = {
              x: padX,
              y: padY,
              w: frameW,
              h: frameH,
              cx: w / 2,
              cy: h / 2,
              rotation: 0,
              isCamera: true,
              name: selL.name || 'Camera',
              corners: [
                { x: padX, y: padY },
                { x: padX + frameW, y: padY },
                { x: padX + frameW, y: padY + frameH },
                { x: padX, y: padY + frameH }
              ],
              anchor: { x: w / 2, y: h / 2 }
            };
          } else if (engine) {
            if (isPrecompEffectivelyCollapsed(selL) && Array.isArray(selL.layers) && selL.layers.length > 0) {
              const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
                ? getLayerEffectivePropsAtTime(selL, targetSec)
                : selL;
              selL._canvasBounds = computeCollapsedPrecompBounds(selL, effProps, targetSec, bufferScale, camEff, w, h);
            } else if (!selL._canvasBounds || selL._currentSec !== targetSec) {
              const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
                ? getLayerEffectivePropsAtTime(selL, targetSec)
                : selL;
              selL._canvasBounds = engine.getBounds(Object.assign({}, selL, effProps), bufferScale, camEff, w, h);
            }
          }
        });
      }

      if (window.CanvasOverlay) {
        if (window.isTimelinePlaying) {
          const isMob = (typeof window !== 'undefined' && (window.innerWidth <= 768 || (typeof navigator !== 'undefined' && navigator.deviceMemory && navigator.deviceMemory <= 4)));
          if (isMob) {
            window._mobOverlayTick = ((window._mobOverlayTick || 0) + 1);
            if (window._mobOverlayTick % 3 === 0) {
              window.CanvasOverlay.redraw();
            }
          } else {
            window.CanvasOverlay.redraw();
          }
        } else {
          window.CanvasOverlay.scheduleRedraw();
        }
      }
    }
    window.syncActiveViewerOverlay = syncActiveViewerOverlay;

    // Render Canvas Content (Background, Time-Filtered Active Layers, Center-Aligned Grid Overlay)
    function renderCanvasFrame(canvas, bg, w, h, triggerSource = '', overrideSec = null) {
      if (!canvas) return;
      const isTemplate = (typeof triggerSource === 'string') && triggerSource.startsWith('template');
      const isExport = !!window.isExporting || ((typeof triggerSource === 'string') && triggerSource.startsWith('export'));
      const isIdleCache = triggerSource === 'idle-cache';
      const needsAlpha = isExport && triggerSource !== 'export-video' && (!bg || bg === 'transparent');
      const needsAlphaCanvas = needsAlpha;
      // Cache context on canvas element — avoid repeated getContext overhead per frame
      if (!canvas._cachedCtx || canvas._cachedCtxAlpha !== needsAlphaCanvas) {
        canvas._cachedCtx = canvas.getContext('2d', { alpha: needsAlphaCanvas }) || canvas.getContext('2d');
        canvas._cachedCtxAlpha = needsAlphaCanvas;
        // Set smoothing quality once on new context — guard prevents per-frame GPU state write
        if (canvas._cachedCtx) {
          const isMob = (typeof window !== 'undefined' && (window.innerWidth <= 600 || ('ontouchstart' in window && window.innerWidth <= 900)));
          canvas._cachedCtx.imageSmoothingEnabled = true;
          canvas._cachedCtx.imageSmoothingQuality = isMob ? 'medium' : 'high';
          canvas._cachedCtx._smoothingSet = true;
        }
      }
      let ctx = canvas._cachedCtx;
      if (!ctx) return;

      if (typeof window.getAdaptiveDraftScale !== 'function') {
        window.getAdaptiveDraftScale = function() {
          if (window.isExporting || window._isExportingVideo || window._isExportingSequence) return 1.0;
          const dBtn = (typeof document !== 'undefined') ? document.getElementById('editor-icon-low-quality') : null;
          if (!dBtn || !dBtn.classList.contains('is-active')) return 1.0;
          return (typeof window._currentAdaptiveDraftScale === 'number' && window._currentAdaptiveDraftScale > 0)
            ? window._currentAdaptiveDraftScale
            : ((window._adaptiveDraftState && window._adaptiveDraftState.scale) || 1.0);
        };
      }

      const t0 = performance.now();

      // Calculate current time from timeline playhead or overrideSec
      const pixelsPerSecond = window.currentPixelsPerSecond || 80;
      const currentPanX = window.timelinePanX !== undefined ? Math.min(0, window.timelinePanX) : 0;
      let currentSec = (overrideSec !== null && overrideSec !== undefined) ? Math.max(0, overrideSec) : (Math.max(0, -currentPanX) / pixelsPerSecond);
      const fps = (typeof getProjectFps === 'function') ? getProjectFps() : (parseInt(currentProjectState.fps, 10) || 60);
      const frameIndex = Math.round(currentSec * fps);
      // NLE Standard: frame-quantize animation evaluation so 24fps/30fps hold frames for their authentic duration
      // (Bypassed during direct mouse transform dragging on canvas for maximum interactive responsiveness)
      const isTransformDragging = !!(window.isTransformInteracting || (typeof window.activeOp !== 'undefined' && window.activeOp));
      if (!isTransformDragging) {
        currentSec = frameIndex / fps;
      }
      window._currentRenderSec = currentSec;
      if (overrideSec === null || overrideSec === undefined) {
        window.currentSec = currentSec;
        window.currentPlaybackSec = currentSec;
      }
      if (canvas && canvas.id === 'editor-active-canvas' && _redrawRafId !== null) {
        cancelAnimationFrame(_redrawRafId);
        _redrawRafId = null;
        _redrawRafScheduled = false;
      }
      if (window._lastRenderFrameSec !== currentSec) {
        window._lastRenderFrameSec = currentSec;
        if (typeof invalidateEffectivePropsCache === 'function') {
          invalidateEffectivePropsCache();
        }
      }

      // ─── EARLY-EXIT CACHE FAST-PATH ──────────────────────────────────────────
      // If frame is cached, blit directly and skip the entire render pipeline
      // (layer filter, camera transform, effects, etc.).
      // Bypassed during export, idle-cache generation, or direct canvas transform dragging.
      if (
        !isExport && !isIdleCache && !isTemplate &&
        triggerSource !== 'lookahead-cache' &&
        !isTransformDragging &&
        window.PreviewCacheManager &&
        window.isPreviewCacheEnabled !== false
      ) {
        const earlyBitmap = window.PreviewCacheManager.getFrame(frameIndex, w, h);
        if (earlyBitmap) {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(earlyBitmap, 0, 0, w, h);
          window._lastFrameRenderDuration = 0.5;
          window._lastFrameWasCached = true;
          if (window._adaptiveDraftState) {
            window._adaptiveDraftState.fastStreak = (window._adaptiveDraftState.fastStreak || 0) + 1;
            if (window._adaptiveDraftState.fastStreak >= 8 && window._adaptiveDraftState.scale < 1.0) {
              window._adaptiveDraftState.scale = Math.min(1.0, window._adaptiveDraftState.scale + 0.15);
              if (window._adaptiveDraftState.scale > 0.96) window._adaptiveDraftState.scale = 1.0;
              window._currentAdaptiveDraftScale = window._adaptiveDraftState.scale;
            }
          }
          if (canvas && canvas.id === 'editor-active-canvas') {
            syncActiveViewerOverlay(currentSec, w, h);
          }
          return true; // skip full pipeline — ~0.1ms vs ~10ms
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

      const aspect = currentProjectState.aspectRatio || '16:9';
      const res = currentProjectState.resolution || '1080p';
      let baseDims = window.getProjectDimensions(res, aspect);
      if (currentActivePrecomp) {
        const cw = Math.round(Math.abs(currentActivePrecomp.mediaWidth || currentActivePrecomp.scaleW || baseDims[0]));
        const ch = Math.round(Math.abs(currentActivePrecomp.mediaHeight || currentActivePrecomp.scaleH || baseDims[1]));
        baseDims = [cw, ch];
      }
      const baseW = baseDims[0];
      const baseH = baseDims[1];
      let bufferScale = w / baseW;

      // Find all layers overlapping currentSec (strictly visible only when playhead is inside layer boundary)
      const layers = currentProjectState.layers || [];
      _scratchActiveLayers.length = 0;
      _scratchActiveVideos.length = 0;
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
        const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pixelsPerSecond);
        if (currentSec >= start && currentSec < (start + dur)) {
          _scratchActiveLayers.push(layer);
          if (layer.type === 'video') _scratchActiveVideos.push(layer);
        }
      }
      const activeLayers = _scratchActiveLayers;
      const activeVideos = _scratchActiveVideos;

      // 1. Detect active Camera layer
      const activeCamera = activeLayers.find(l => l.type === 'camera' && !l.hidden);
      const camEff = activeCamera
        ? ((typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(activeCamera, currentSec) : activeCamera)
        : null;
      if (camEff && activeCamera) {
        camEff._rawCamera = activeCamera;
      }

      let selectedWireframeBounds = null;
      let cachedBitmap = null;
      let hasUnreadyMedia = false;
      const isScrubbing = !!(window.isTimelineScrubbing || window.isTimelinePanning || (typeof window.isPanning !== 'undefined' && window.isPanning));
      // RAM preview cache: used during playback, scrubbing, and frame park for instant 60fps blit.
      // Canvas wireframe transform interaction bypasses cache to track cursor movements live.
      if (!isExport && !isIdleCache && !isTransformDragging && window.PreviewCacheManager && window.isPreviewCacheEnabled !== false) {
        cachedBitmap = window.PreviewCacheManager.getFrame(frameIndex, w, h);
      }

      if (cachedBitmap) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(cachedBitmap, 0, 0, w, h);
        if (window._adaptiveDraftState) {
          window._adaptiveDraftState.fastStreak = (window._adaptiveDraftState.fastStreak || 0) + 1;
          if (window._adaptiveDraftState.fastStreak >= 8 && window._adaptiveDraftState.scale < 1.0) {
            window._adaptiveDraftState.scale = Math.min(1.0, window._adaptiveDraftState.scale + 0.15);
            if (window._adaptiveDraftState.scale > 0.96) window._adaptiveDraftState.scale = 1.0;
            window._currentAdaptiveDraftScale = window._adaptiveDraftState.scale;
          }
        }
      } else {
        const outerCanvas = canvas;
        const outerCtx = ctx;
        const outerW = w;
        const outerH = h;
        const draftBtnEl = (typeof document !== 'undefined') ? document.getElementById('editor-icon-low-quality') : null;
        const isDraftModeActive = !!(draftBtnEl && draftBtnEl.classList.contains('is-active'));
        const canUseAdaptiveDraft = isDraftModeActive && !isExport && !isIdleCache && !isTemplate && triggerSource !== 'lookahead-cache';

        if (!window._adaptiveDraftState) {
          window._adaptiveDraftState = { scale: 1.0, emaMs: 8.0, fastStreak: 0 };
        }
        const adState = window._adaptiveDraftState;
        let adaptiveScale = 1.0;
        if (canUseAdaptiveDraft) {
          const isInteractiveMotion = !!(window.isTimelinePlaying || isScrubbing || isTransformDragging);
          adaptiveScale = window.VideoCompEngine.computeAdaptiveDraftScale(activeLayers, {
            canUseAdaptiveDraft,
            isInteractiveMotion,
            currentScale: adState.scale
          });
          adState.scale = adaptiveScale;
        } else {
          adState.scale = 1.0;
        }
        window._currentAdaptiveDraftScale = adaptiveScale;

        let useAdaptiveBuffer = false;
        if (canUseAdaptiveDraft && adaptiveScale < 0.96 && outerW > 64 && outerH > 36) {
          const rw = Math.max(64, Math.round(outerW * adaptiveScale));
          const rh = Math.max(36, Math.round(outerH * adaptiveScale));
          if (!window._adaptiveDraftCanvas) {
            window._adaptiveDraftCanvas = document.createElement('canvas');
          }
          const dCanvas = window._adaptiveDraftCanvas;
          if (dCanvas.width !== rw || dCanvas.height !== rh) {
            dCanvas.width = rw;
            dCanvas.height = rh;
          }
          const dCtx = dCanvas.getContext('2d', { alpha: needsAlphaCanvas }) || dCanvas.getContext('2d');
          if (dCtx) {
            dCtx.imageSmoothingEnabled = adaptiveScale > 0.55;
            dCtx.imageSmoothingQuality = 'low';
            canvas = dCanvas;
            ctx = dCtx;
            w = rw;
            h = rh;
            bufferScale = w / baseW;
            useAdaptiveBuffer = true;
            window._inAdaptiveDraftBuffer = true;
          }
        } else {
          window._inAdaptiveDraftBuffer = false;
        }

        ctx.clearRect(0, 0, w, h);

        if (bg && bg !== 'transparent') {
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, h);
        } else if (triggerSource === 'export-video' || isTemplate) {
          // Flat solid black for video render and template preview
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, w, h);
        } else if (!isExport) {
          // Flat dark background for transparent preview
          ctx.fillStyle = '#0a0d07';
          ctx.fillRect(0, 0, w, h);
        }

        // Draw each active layer onto canvas in bottom-to-top order (excluding camera, null, and audio layers, reverse so top timeline lane is on top of canvas)
        _scratchRenderOrderLayers.length = 0;
        for (let i = activeLayers.length - 1; i >= 0; i--) {
          const l = activeLayers[i];
          if (l.type !== 'camera' && l.type !== 'null' && l.type !== 'audio') {
            _scratchRenderOrderLayers.push(l);
          }
        }
        const renderOrderLayers = _scratchRenderOrderLayers;
        _scratchLayersToRender.length = 0;
        const layersToRender = _scratchLayersToRender;
        let compositionBufferScale = bufferScale;

        // Apply camera viewport transformation if active camera exists (2D canvas squash only when FishToolEngine is not active)
        const engineActive = !!(window.FishToolEngine && window.FishToolEngine.isReady);
        if (activeCamera && camEff && !engineActive) {
          const camZoom = (camEff.cameraZoom !== undefined ? camEff.cameraZoom : 100) / 100;
          const camLens = Math.max(1, camEff.cameraLens !== undefined ? camEff.cameraLens : 50);
          const lensFactor = Math.max(0.01, camLens / 50);
          const camX = (camEff.posX || 0) * bufferScale;
          const camY = (camEff.posY || 0) * bufferScale;
          const camPosZ = (camEff.posZ || 0) * bufferScale;
          const camRotX = camEff.rotX || 0;
          const camRotY = camEff.rotY || 0;
          const camRotZ = camEff.rotZ !== undefined ? camEff.rotZ : (camEff.rotation || 0);

          const camDist = 1000 * lensFactor * bufferScale;
          const zDollyScale = camPosZ ? (camDist / Math.max(50 * bufferScale, camDist - camPosZ)) : 1;
          const totalZoom = camZoom * lensFactor * zDollyScale;

          ctx.save();
          ctx.translate(w / 2, h / 2);
          if (totalZoom !== 1) ctx.scale(totalZoom, totalZoom);
          if (camRotZ) ctx.rotate((-camRotZ * Math.PI) / 180);
          if (camRotX || camRotY) {
            const cosCamX = Math.cos((-camRotX * Math.PI) / 180);
            const cosCamY = Math.cos((-camRotY * Math.PI) / 180);
            ctx.scale(cosCamY, cosCamX);
          }
          ctx.translate(-w / 2 - camX, -h / 2 - camY);
        }

      renderOrderLayers.forEach(layer => {
        const isSelected = (layer.id === window.selectedLayerId) || (window.selectedLayerIds && window.selectedLayerIds.has(layer.id));
        if (layer.hidden) {
          if (isSelected && layer.type !== 'camera' && layer.type !== 'audio') {
            const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
              ? getLayerEffectivePropsAtTime(layer, currentSec)
              : layer;
            const engine = window.FishToolEngine || window.LayerTransform;
            if (engine) {
              const animLayer = Object.assign({}, layer, effProps);
              animLayer._currentSec = currentSec;
              if (Array.isArray(effProps.effects)) {
                animLayer.effects = effProps.effects.map(fx => Object.assign({}, fx));
              } else if (Array.isArray(layer.effects)) {
                animLayer.effects = layer.effects.map(fx => Object.assign({}, fx));
              }
              layer._canvasBounds = engine.getBounds(animLayer, compositionBufferScale, camEff, w, h);
            }
          }
          return; // Skip hidden layers from canvas rendering
        }

        if (layer.type === 'adjustment') {
          // 1. Flush any batched layers rendered prior to this adjustment layer into ctx
          const engine = window.FishToolEngine || window.LayerTransform;
          const mbEngine = window.FishMotionBlurEngine;
          const compState = currentActivePrecomp || currentProjectState;
          if (engine && layersToRender.length > 0) {
            let staticBatch = [];
            const flushStaticBatch = () => {
              if (staticBatch.length === 0) return;
              if (typeof engine.renderScene === 'function') {
                engine.renderScene(ctx, staticBatch, compositionBufferScale, camEff, currentSec);
              } else {
                staticBatch.forEach(item => {
                  engine.renderLayer(ctx, item.el, item.animLayer || item.layer, compositionBufferScale, camEff, currentSec);
                });
              }
              staticBatch = [];
            };

            // Shared-depth 3D runs: consecutive plain-3D layers accumulate here and
            // render together — one depth pass when static, one scene motion-blur
            // pass when any member moves — so 3D penetration survives motion blur.
            // Runs without blur (or when the scene pass is unavailable) fall back
            // to the legacy staticBatch path verbatim.
            let pending3DRun = [];
            const flush3DRun = () => {
              if (pending3DRun.length === 0) return;
              const anyBlur = pending3DRun.some(m => m.blur);
              let handled = false;
              if (anyBlur && engine && typeof engine.render3DSceneMotionBlur === 'function') {
                handled = engine.render3DSceneMotionBlur(ctx, pending3DRun, compositionBufferScale, camEff, currentSec, compState);
              }
              if (!handled) {
                pending3DRun.forEach(m => { staticBatch.push(m.item); });
                flushStaticBatch();
              }
              pending3DRun = [];
            };

            layersToRender.forEach(item => {
              const rawLayer = item.layer;
              const isMbActive = mbEngine && mbEngine.isLayerActive(rawLayer, compState, activeCamera) && mbEngine.hasMotion(rawLayer, currentSec, null, (typeof getProjectFps === 'function' ? getProjectFps() : 60), (compState && compState.layers) || (currentProjectState && currentProjectState.layers) || [], activeCamera);
              const bounds = engine ? engine.getBounds(item.animLayer || rawLayer, compositionBufferScale, camEff) : null;
              // Plain-3D run member (static or blurred): shared depth pass.
              // Collapsed precomp children join the shared depth pass when static,
              // or keep the legacy sampled path when per-sample world-transform blur is active.
              if (engine && typeof engine.isBatchable3D === 'function' &&
                  engine.isBatchable3D(item.animLayer || rawLayer, bounds) &&
                  (!rawLayer._isCollapsedPrecompChild || !isMbActive)) {
                pending3DRun.push({ item, bounds, blur: !!isMbActive });
                return;
              }
              flushStaticBatch();
              flush3DRun();
              if (isMbActive) {
                const hasMoveFx = mbEngine && ((typeof mbEngine.hasMovementEffect === 'function' && mbEngine.hasMovementEffect(rawLayer)) || (typeof mbEngine.needsSampledPath === 'function' && mbEngine.needsSampledPath(rawLayer)));
                const hasSelfBlur = mbEngine && Array.isArray(rawLayer.effects) && rawLayer.effects.some(f => {
                  if (!f || f.disabled) return false;
                  if (f.type === 'shatter') return true;
                  const d = typeof mbEngine._effectDef === 'function' ? mbEngine._effectDef(f) : null;
                  return !!(d && d.selfBlur);
                });
                if (hasSelfBlur) {
                  engine.renderLayer(ctx, item.el, item.animLayer || rawLayer, compositionBufferScale, camEff, currentSec);
                } else if (engine && item.el && typeof engine.render3DMotionBlur === 'function' && !rawLayer._isCollapsedPrecompChild && !hasMoveFx && bounds && bounds.is3D) {
                  engine.render3DMotionBlur(ctx, item.el, item.animLayer || rawLayer, compositionBufferScale, camEff, currentSec, compState);
                } else {
                  mbEngine.renderLayerWithMotionBlur(
                    ctx,
                    item.el,
                    item.animLayer || rawLayer,
                    compositionBufferScale,
                    camEff,
                    currentSec,
                    (subCtx, subEl, subLayer, subScale, subCam, subSec) => {
                      const currentSubEl = subEl; // text glyph blur already baked in buffer
                      const pool = (compState && compState.layers) || (currentProjectState && currentProjectState.layers) || [];
                      const subCamera = (activeCamera && typeof getLayerEffectivePropsAtTime === 'function')
                        ? getLayerEffectivePropsAtTime(activeCamera, subSec, null, pool)
                        : (subCam || camEff);
                      // For collapsed precomp children: re-evaluate world transform at subSec
                      if (subLayer._isCollapsedPrecompChild && subLayer._precompParentLayer && subLayer._childOrigLayer && window.FishMotionBlurEngine) {
                        const worldAtSub = window.FishMotionBlurEngine._computeCollapsedChildWorldPos(
                          subLayer._precompParentLayer, subLayer._childOrigLayer, subSec, null
                        );
                        if (worldAtSub) {
                          const subAnimLayer = Object.assign({}, subLayer, {
                            posX: worldAtSub.posX,
                            posY: worldAtSub.posY,
                            posZ: worldAtSub.posZ,
                            scaleW: worldAtSub.scaleW,
                            scaleH: worldAtSub.scaleH,
                            rotX: worldAtSub.rotX,
                            rotY: worldAtSub.rotY,
                            rotZ: worldAtSub.rotZ,
                            rotation: worldAtSub.rotZ,
                            _currentSec: subSec
                          });
                          if (Array.isArray(subLayer.effects)) subAnimLayer.effects = subLayer.effects;
                          engine.renderLayer(subCtx, currentSubEl, mbEngine.compensateTextPad(subLayer, currentSubEl, subAnimLayer), subScale, subCamera, subSec);
                          return;
                        }
                      }
                      const srcLayer = subLayer._rawLayer || subLayer;
                      const subEff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(srcLayer, subSec) : srcLayer;
                      const subAnimLayer = Object.assign({}, subLayer, subEff);
                      subAnimLayer._currentSec = subSec;
                      if (Array.isArray(subEff.effects)) subAnimLayer.effects = subEff.effects;
                      else if (Array.isArray(subLayer.effects)) subAnimLayer.effects = subLayer.effects;
                      engine.renderLayer(subCtx, currentSubEl, mbEngine.compensateTextPad(subLayer, currentSubEl, subAnimLayer), subScale, subCamera, subSec);
                    },
                    compState
                  );
                }
              } else {
                staticBatch.push(item);
              }
            });
            flushStaticBatch();
            flush3DRun();
            layersToRender.length = 0;
          }

          // 2. Compute 2D effective transform properties
          const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
            ? getLayerEffectivePropsAtTime(layer, currentSec)
            : layer;

          const cx = (effProps.posX !== undefined ? effProps.posX : (baseW / 2)) * bufferScale;
          const cy = (effProps.posY !== undefined ? effProps.posY : (baseH / 2)) * bufferScale;
          const bw = (effProps.scaleW !== undefined ? effProps.scaleW : baseW) * bufferScale;
          const bh = (effProps.scaleH !== undefined ? effProps.scaleH : baseH) * bufferScale;
          const rotZ = effProps.rotZ !== undefined ? effProps.rotZ : (effProps.rotation || 0);
          const skewX = effProps.skewX || 0;
          const skewY = effProps.skewY || 0;
          const signX = Math.sign(bw) || 1;
          const signY = Math.sign(bh) || 1;
          const absW = Math.abs(bw);
          const absH = Math.abs(bh);
          const ax = (effProps.anchorX || 0) * bufferScale;
          const ay = (effProps.anchorY || 0) * bufferScale;

          const animLayer = Object.assign({}, layer, effProps);
          animLayer.rotX = 0;
          animLayer.rotY = 0;
          animLayer.posZ = 0;
          animLayer.anchorZ = 0;

          if (engine) {
            layer._canvasBounds = engine.getBounds(animLayer, bufferScale);
          } else {
            if (!layer._canvasBounds) {
              layer._canvasBounds = { cx: 0, cy: 0, x: 0, y: 0, w: 0, h: 0, scaleW: 0, scaleH: 0, rotation: 0, rotX: 0, rotY: 0, skewX: 0, skewY: 0 };
            }
            const b = layer._canvasBounds;
            b.cx = cx;
            b.cy = cy;
            b.x = cx - absW / 2;
            b.y = cy - absH / 2;
            b.w = absW;
            b.h = absH;
            b.scaleW = bw;
            b.scaleH = bh;
            b.rotation = rotZ;
            b.rotX = 0;
            b.rotY = 0;
            b.skewX = skewX;
            b.skewY = skewY;
          }

          if (!isExport && window.selectedLayerId && layer.id === window.selectedLayerId && !layer.hidden) {
            selectedWireframeBounds = layer._canvasBounds;
          }

          // 3. Fast-path: check if adjustment layer has active effects, custom blend, or non-100% opacity
          const rawAdjOp = (effProps.opacity !== undefined && effProps.opacity !== null) ? Number(effProps.opacity) : 1.0;
          const normAdjOp = (rawAdjOp > 1.0) ? (rawAdjOp / 100) : rawAdjOp;
          if (normAdjOp <= 0.001) {
            return; // 0% opacity adjustment layer is visually completely invisible
          }

          const isNormalBlend = !layer.blendMode || layer.blendMode === 'normal';
          const hasBuiltinFilter = (window.FishEffects && typeof window.FishEffects.buildFilter === 'function' && window.FishEffects.buildFilter(animLayer) !== '') ||
            (animLayer.brightness !== undefined && animLayer.brightness !== 0) ||
            (animLayer.contrast !== undefined && animLayer.contrast !== 0);
          const hasActiveEffects = window.FishEffects && typeof window.FishEffects.hasNonIdentityEffects === 'function'
            ? window.FishEffects.hasNonIdentityEffects(animLayer)
            : (Array.isArray(animLayer.effects) && animLayer.effects.some(f => !f.disabled));

          if (!hasBuiltinFilter && !hasActiveEffects && isNormalBlend && normAdjOp >= 0.999) {
            return; // Identity pass: normal blend, 100% opacity, all effects are identity no-ops
          }

          // 4. Offscreen buffers (allocated once, separate buffers for lookahead to prevent concurrency races)
          const isLookahead = (triggerSource === 'lookahead-cache');
          if (isLookahead) {
            if (!window._lookaheadAdjBufferCanvas) window._lookaheadAdjBufferCanvas = document.createElement('canvas');
            if (!window._lookaheadAdjProcCanvas) window._lookaheadAdjProcCanvas = document.createElement('canvas');
          } else {
            if (!window._adjBufferCanvas) window._adjBufferCanvas = document.createElement('canvas');
            if (!window._adjProcCanvas) window._adjProcCanvas = document.createElement('canvas');
          }
          const buf = isLookahead ? window._lookaheadAdjBufferCanvas : window._adjBufferCanvas;
          const proc = isLookahead ? window._lookaheadAdjProcCanvas : window._adjProcCanvas;
          if (buf.width !== w || buf.height !== h) {
            buf.width = w;
            buf.height = h;
          }
          if (proc.width !== w || proc.height !== h) {
            proc.width = w;
            proc.height = h;
          }

          const bufCtx = buf.getContext('2d', { alpha: true });
          const procCtx = proc.getContext('2d', { alpha: true });
          if (!bufCtx || !procCtx) return;

          // Snapshot composition below adjustment layer
          bufCtx.clearRect(0, 0, w, h);
          bufCtx.drawImage(canvas, 0, 0);

          const isAdjMbActive = mbEngine && mbEngine.isLayerActive(layer, compState) && (mbEngine.hasMovementEffect(layer) || mbEngine.hasMotion(layer, currentSec, null, (typeof getProjectFps === 'function' ? getProjectFps() : 60), (compState && compState.layers) || (currentProjectState && currentProjectState.layers) || []));

          procCtx.clearRect(0, 0, w, h);
          if (isAdjMbActive) {
            mbEngine.renderLayerWithMotionBlur(
              procCtx,
              buf,
              animLayer,
              bufferScale,
              null,
              currentSec,
              (subCtx, subEl, subLayer, subScale, subCam, subSec) => {
                const subEff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(layer, subSec) : subLayer;
                const subAnim = Object.assign({}, subLayer, subEff);
                subAnim._currentSec = subSec;
                subCtx.save();
                if (window.FishEffects && typeof window.FishEffects.applyToContext === 'function') {
                  window.FishEffects.applyToContext(subCtx, subAnim);
                }
                if (window.FishEffects && typeof window.FishEffects.renderLayer === 'function') {
                  window.FishEffects.renderLayer(subCtx, subEl, subAnim, { x: 0, y: 0, w: w, h: h, bufferScale: (typeof compositionBufferScale === 'number' ? compositionBufferScale : bufferScale), unitScale: (typeof compositionBufferScale === 'number' ? compositionBufferScale : bufferScale), baseW, baseH }, subSec);
                } else {
                  subCtx.drawImage(subEl, 0, 0);
                }
                if (window.FishEffects && typeof window.FishEffects.applyPostEffects === 'function') {
                  window.FishEffects.applyPostEffects(subCtx, subEl, subAnim, { x: 0, y: 0, w: w, h: h, bufferScale: (typeof compositionBufferScale === 'number' ? compositionBufferScale : bufferScale), unitScale: (typeof compositionBufferScale === 'number' ? compositionBufferScale : bufferScale), baseW, baseH });
                }
                subCtx.restore();
              },
              compState
            );
          } else {
            procCtx.save();
            if (window.FishEffects && typeof window.FishEffects.applyToContext === 'function') {
              window.FishEffects.applyToContext(procCtx, animLayer);
            }

            if (window.FishEffects && typeof window.FishEffects.renderLayer === 'function') {
              window.FishEffects.renderLayer(procCtx, buf, animLayer, { x: 0, y: 0, w: w, h: h, bufferScale: (typeof compositionBufferScale === 'number' ? compositionBufferScale : bufferScale), unitScale: (typeof compositionBufferScale === 'number' ? compositionBufferScale : bufferScale), baseW, baseH }, currentSec);
            } else {
              procCtx.drawImage(buf, 0, 0);
            }

            if (window.FishEffects && typeof window.FishEffects.applyPostEffects === 'function') {
              window.FishEffects.applyPostEffects(procCtx, buf, animLayer, { x: 0, y: 0, w: w, h: h, bufferScale: (typeof compositionBufferScale === 'number' ? compositionBufferScale : bufferScale), unitScale: (typeof compositionBufferScale === 'number' ? compositionBufferScale : bufferScale), baseW, baseH });
            }
            procCtx.restore();
          }

          // 5. Composite back onto ctx, clipped to the adjustment layer's transformed boundary
          // Exception: active Deep Glow with Out Layer ON, fluid transitions (Fluid Fish),
          // or isExpanding effects are full-comp (AE-style): they must span across the frame, never hard-cut at adj bounds.
          const isFullCompAdj = Array.isArray(animLayer.effects) && animLayer.effects.some(f => {
            if (!f || f.disabled) return false;
            if (f.type === 'fluid-fish' || f.type === 'open-ios' || f.type === 'open-mac') return true;
            if (f.type === 'deep-glow' && (f.outLayer === 1 || f.outLayer === true || f.outLayer === '1' || f.outLayer === 'true' || f.outLayer === 'on')) return true;
            const def = (window.FishEffectsRegistry && typeof window.FishEffectsRegistry.get === 'function')
              ? window.FishEffectsRegistry.get(f.type)
              : null;
            return !!(def && def.isExpanding);
          });
          ctx.save();
          if (effProps.opacity !== undefined && effProps.opacity !== null) {
            ctx.globalAlpha = Math.max(0, Math.min(1, effProps.opacity));
          }
          if (layer.blendMode && layer.blendMode !== 'normal') {
            ctx.globalCompositeOperation = resolveBlendMode(layer.blendMode);
          }

          if (isFullCompAdj) {
            // Draw full-canvas processed image in identity screen space, no boundary clip
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(proc, 0, 0, w, h);
            ctx.restore();
            return;
          }

          ctx.beginPath();
          ctx.translate(cx + ax * signX, cy + ay * signY);
          if (rotZ) {
            ctx.rotate((rotZ * Math.PI) / 180);
          }
          if (skewX || skewY) {
            const tanX = Math.tan(((skewX || 0) * Math.PI) / 180);
            const tanY = Math.tan(((skewY || 0) * Math.PI) / 180);
            ctx.transform(1, tanY, tanX, 1, 0, 0);
          }
          if (signX < 0 || signY < 0) {
            ctx.scale(signX, signY);
          }
          ctx.rect(-absW / 2 - ax, -absH / 2 - ay, absW, absH);
          ctx.clip();

          // Draw full-canvas processed image in identity screen space
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(proc, 0, 0, w, h);
          ctx.restore();

          return;
        }

        let el = null;
        let media = null;
        let timeInClip = 0;
        const isNativeMedia = (layer.type === 'video' || layer.type === 'image' || layer.type === 'precomp');
        const isShape = (layer.type === 'shape');
        const isText = (layer.type === 'text');
        const effectiveFill = layer.fillType || (isNativeMedia ? 'media' : (layer.fillColor ? 'color' : 'none'));

        if (isText) {
          if (!layer._textBufferCanvas || !(layer._textBufferCanvas instanceof HTMLCanvasElement) || typeof layer._textBufferCanvas.getContext !== 'function') {
            layer._textBufferCanvas = document.createElement('canvas');
          }
          const nat = (window.FishTextEngine && window.FishTextEngine.getNaturalSize)
            ? window.FishTextEngine.getNaturalSize(layer)
            : { width: 320, height: 100 };
          const pw = Math.max(1, Math.round(nat.width));
          const ph = Math.max(1, Math.round(nat.height));

          // Calculate high-DPI supersampling scale so text is rendered razor-sharp without pixelation when scaled up
          const curScaleW = Math.abs(layer.scaleW || pw);
          const curScaleH = Math.abs(layer.scaleH || ph);
          const scaleMultX = curScaleW / Math.max(1, pw);
          const scaleMultY = curScaleH / Math.max(1, ph);
          const isMobileText = (typeof window !== 'undefined' && (window.innerWidth <= 600 || ('ontouchstart' in window && window.innerWidth <= 900)));
          const draftBtn = document.getElementById('editor-icon-low-quality');
          const isDraft = draftBtn && draftBtn.classList.contains('is-active');
          const isInteracting = !!(window.isTransformInteracting && !isExport);
          const tp = layer.textProps || {};
          const isAnimatedText = !!(
            (tp.animIn && tp.animIn !== 'none') ||
            (tp.animOut && tp.animOut !== 'none') ||
            tp.animPosY || tp.animPosX
          );
          // For animated text, cap supersampling to 1.25x (or 1.0x on mobile/draft) so buffer memory stays compact
          // and WebGL texture upload remains instant at locked 60 FPS.
          const maxResScale = isDraft ? 1.0 : (isAnimatedText ? (isMobileText ? 1.0 : 1.25) : (isMobileText ? 1.5 : 2.0));
          // During interactive transform drag, lock resScale to pre-drag value so canvas buffer doesn't thrash/reallocate on every mousemove
          const resScale = (isInteracting && layer._textResScaleApplied)
            ? layer._textResScaleApplied
            : Math.min(maxResScale, Math.max(0.75, Math.max(scaleMultX, scaleMultY) * (bufferScale || 1.0)));
          layer._textResScale = resScale;

          const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
          const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pixelsPerSecond);
          const localSec = Math.max(0, currentSec - clipStart);
          if (window.FishTextEngine && typeof window.FishTextEngine.renderTextToCanvas === 'function') {
            window.FishTextEngine.renderTextToCanvas(layer, layer._textBufferCanvas, pw, ph, localSec, clipDur);
          }
          el = layer._textBufferCanvas;
          // mediaWidth/Height = natural text size (used for wireframe & transform bounds)
          // _textAnimPadY is set by renderTextToCanvas — compositor uses it to draw without squish
          layer.mediaWidth = pw;
          layer.mediaHeight = ph;

        } else if (isShape) {
          if (!layer._shapeBufferCanvas || !(layer._shapeBufferCanvas instanceof HTMLCanvasElement) || typeof layer._shapeBufferCanvas.getContext !== 'function') {
            layer._shapeBufferCanvas = document.createElement('canvas');
          }
          const isVecShape = (layer.shapeType === 'vector');
          if (isVecShape) {
            if (
              layer.keyframes &&
              Array.isArray(layer.keyframes.vectorPoints) &&
              layer.keyframes.vectorPoints.length > 0 &&
              !(window._vectorEditorState && window._vectorEditorState.isDraggingPad)
            ) {
              const effVec = (typeof getLayerEffectivePropsAtTime === 'function')
                ? getLayerEffectivePropsAtTime(layer, currentSec)
                : null;
              if (effVec && Array.isArray(effVec.vectorPoints)) {
                if (!layer.shapeProps) layer.shapeProps = {};
                layer.shapeProps.points = effVec.vectorPoints.map(pt => ({ ...pt }));
              }
            }
            if (typeof window.syncVectorLayerBounds === 'function') {
              window.syncVectorLayerBounds(layer, !window.isTransformInteracting);
            }
          }
          const vBounds = (isVecShape && typeof window.getVectorLocalBounds === 'function')
            ? window.getVectorLocalBounds(layer.shapeProps || {})
            : null;
          const pw = vBounds
            ? vBounds.bufferW
            : Math.max(1, Math.round(Math.abs((layer.shapeProps && layer.shapeProps.sizeX) || 300)));
          const ph = vBounds
            ? vBounds.bufferH
            : Math.max(1, Math.round(Math.abs((layer.shapeProps && layer.shapeProps.sizeY) || 300)));
          renderShapeToCanvas(layer, layer._shapeBufferCanvas, pw, ph);
          el = layer._shapeBufferCanvas;
          layer.mediaWidth = vBounds ? vBounds.width : pw;
          layer.mediaHeight = vBounds ? vBounds.height : ph;
        } else if (effectiveFill === 'none') {
          el = null;
        } else if (effectiveFill === 'color' || effectiveFill === 'gradient' || (!isNativeMedia && effectiveFill === 'media')) {
          const pw = Math.round(Math.abs(layer.mediaWidth || layer.scaleW || baseW));
          const ph = Math.round(Math.abs(layer.mediaHeight || layer.scaleH || baseH));
          el = getOrUpdateLayerFillCanvas(layer, pw, ph);
          layer.mediaWidth = pw;
          layer.mediaHeight = ph;
        } else if (layer.type === 'precomp') {
          if (isPrecompEffectivelyCollapsed(layer)) {
            // Collapse Transformations (3D Grouping Mode)
            const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
              ? getLayerEffectivePropsAtTime(layer, currentSec)
              : layer;

            const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
            let innerSec = 0;
            if (layer.speedMode === 'time_remap') {
              innerSec = Math.max(0, effProps.timeRemap !== undefined ? effProps.timeRemap : ((layer.sourceOffsetSec || 0) + (currentSec - clipStart) * (layer.speed || 1.0)));
            } else {
              innerSec = (typeof getLayerIntegratedSpeedTime === 'function')
                ? getLayerIntegratedSpeedTime(layer, currentSec)
                : (layer.speed !== undefined && layer.speed < 0
                  ? Math.max(0, (layer.sourceOffsetSec || 0) + Math.max(0, (((layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pixelsPerSecond))) - (currentSec - clipStart)) * Math.abs(layer.speed)))
                  : Math.max(0, (layer.sourceOffsetSec || 0) + (currentSec - clipStart) * (layer.speed || 1.0)));
            }

            const pw = Math.round(Math.abs(layer.mediaWidth || layer.scaleW || baseW));
            const ph = Math.round(Math.abs(layer.mediaHeight || layer.scaleH || baseH));
            layer.mediaWidth = pw;
            layer.mediaHeight = ph;

            // Group wireframe bounds only serve hit-testing / selection overlay.
            // Skip that per-child projection work while exporting or playing back
            // (selected layer still refreshes; syncActiveViewerOverlay also covers it when paused).
            const playbackActive = (typeof window.isAnyPlaybackActive === 'function') && window.isAnyPlaybackActive();
            const needGroupBounds = !isExport && (!playbackActive || layer.id === window.selectedLayerId || !layer._canvasBounds);
            if (needGroupBounds) {
              layer._canvasBounds = computeCollapsedPrecompBounds(layer, effProps, currentSec, bufferScale, camEff, w, h);
            }

            // Concatenate precomp 3D transform with each child layer and push to 3D scene batch
            const pps = window.currentPixelsPerSecond || 80;
            const childLayers = layer.layers || [];
            const activeChildren = childLayers.filter(child => {
              const cs = child.startSec !== undefined ? child.startSec : ((child.startPx || 0) / pps);
              const cd = child.durationSec !== undefined ? child.durationSec : ((child.widthPx || 320) / pps);
              return innerSec >= cs && innerSec < cs + cd;
            });
            const validChildren = [...activeChildren].reverse().filter(c => c.type !== 'camera' && c.type !== 'null' && c.type !== 'audio' && !c.hidden);

            const scaleRatioW = (effProps.scaleW !== undefined ? effProps.scaleW : pw) / (pw || 1920);
            const scaleRatioH = (effProps.scaleH !== undefined ? effProps.scaleH : ph) / (ph || 1080);
            const scaleRatioZ = (Math.abs(scaleRatioW) + Math.abs(scaleRatioH)) / 2;

            const pRotX = effProps.rotX || 0;
            const pRotY = effProps.rotY || 0;
            const pRotZ = effProps.rotZ !== undefined ? effProps.rotZ : (effProps.rotation || 0);

            const pivotX = pw / 2 + (effProps.anchorX || 0);
            const pivotY = ph / 2 + (effProps.anchorY || 0);
            const pivotZ = (effProps.anchorZ || 0);

            const pWorldX = (effProps.posX !== undefined ? effProps.posX : baseW / 2) + (effProps.anchorX || 0);
            const pWorldY = (effProps.posY !== undefined ? effProps.posY : baseH / 2) + (effProps.anchorY || 0);
            const pWorldZ = (effProps.posZ || 0) + (effProps.anchorZ || 0);

            const precompOpacity = effProps.opacity !== undefined ? effProps.opacity : 1.0;
            const engine = window.FishToolEngine || window.LayerTransform;

            validChildren.forEach(child => {
              const childEl = getPrecompChildRenderElement(child, innerSec, pw, ph, pps, triggerSource, childLayers);
              if (!childEl) return;

              const childEff = (typeof getLayerEffectivePropsAtTime === 'function')
                ? getLayerEffectivePropsAtTime(child, innerSec, null, childLayers)
                : child;

              let vx = (childEff.posX !== undefined ? childEff.posX : pw / 2) - pivotX;
              let vy = (childEff.posY !== undefined ? childEff.posY : ph / 2) - pivotY;
              let vz = (childEff.posZ || 0) - pivotZ;

              vx *= scaleRatioW;
              vy *= scaleRatioH;
              vz *= scaleRatioZ;

              if (pRotX !== 0) {
                const radX = (pRotX * Math.PI) / 180;
                const cX = Math.cos(radX), sX = Math.sin(radX);
                const nvy = vy * cX - vz * sX, nvz = vy * sX + vz * cX;
                vy = nvy; vz = nvz;
              }
              if (pRotY !== 0) {
                const radY = (pRotY * Math.PI) / 180;
                const cY = Math.cos(radY), sY = Math.sin(radY);
                const nvx = vx * cY + vz * sY, nvz = -vx * sY + vz * cY;
                vx = nvx; vz = nvz;
              }
              if (pRotZ !== 0) {
                const radZ = (pRotZ * Math.PI) / 180;
                const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
                const nvx = vx * cZ - vy * sZ, nvy = vx * sZ + vy * cZ;
                vx = nvx; vy = nvy;
              }

              const worldPosX = pWorldX + vx;
              const worldPosY = pWorldY + vy;
              const worldPosZ = pWorldZ + vz;

              const cRotX = childEff.rotX || 0;
              const cRotY = childEff.rotY || 0;
              const cRotZ = childEff.rotZ !== undefined ? childEff.rotZ : (childEff.rotation || 0);
              const composedRot = composeEulerRotations(pRotX, pRotY, pRotZ, cRotX, cRotY, cRotZ, _scratchEulerRot);
              const worldRotX = composedRot.rotX;
              const worldRotY = composedRot.rotY;
              const worldRotZ = composedRot.rotZ;

              const childBaseW = (childEff.scaleW !== undefined ? childEff.scaleW : (child.scaleW || child.mediaWidth || 500));
              const childBaseH = (childEff.scaleH !== undefined ? childEff.scaleH : (child.scaleH || child.mediaHeight || 500));
              const worldScaleW = childBaseW * scaleRatioW;
              const worldScaleH = childBaseH * scaleRatioH;

              const worldAnchorX = (childEff.anchorX || 0) * scaleRatioW;
              const worldAnchorY = (childEff.anchorY || 0) * scaleRatioH;
              const worldAnchorZ = (childEff.anchorZ || 0) * scaleRatioZ;

              const worldOpacity = precompOpacity * (childEff.opacity !== undefined ? childEff.opacity : 1.0);

              const childWorldAnimLayer = Object.assign({}, child, childEff, {
                posX: worldPosX,
                posY: worldPosY,
                posZ: worldPosZ,
                rotX: worldRotX,
                rotY: worldRotY,
                rotZ: worldRotZ,
                rotation: worldRotZ,
                scaleW: worldScaleW,
                scaleH: worldScaleH,
                anchorX: worldAnchorX,
                anchorY: worldAnchorY,
                anchorZ: worldAnchorZ,
                opacity: worldOpacity,
                mediaWidth: child.mediaWidth || Math.abs(worldScaleW),
                mediaHeight: child.mediaHeight || Math.abs(worldScaleH),
                _isCollapsedPrecompChild: true,
                _precompParentId: layer.id,
                // MB: propagate parent precomp-layer motionBlur switch + refs for world-transform re-evaluation
                motionBlur: !!(layer.motionBlur || child.motionBlur),
                _precompParentLayer: layer,
                _childOrigLayer: child
              });

              if (Array.isArray(childEff.effects)) {
                childWorldAnimLayer.effects = childEff.effects.map(fx => Object.assign({}, fx));
              }

              if (engine) {
                childWorldAnimLayer._currentSec = currentSec;
                let renderChildAnimLayer = childWorldAnimLayer;
                if (child.type === 'text' && child._textPadY > 0 && childEl && childEl.width && childEl.height) {
                  const natW = child._textNaturalW || (childEl.width - 2 * child._textPadX);
                  const natH = child._textNaturalH || (childEl.height - 2 * child._textPadY);
                  const padRatioW = childEl.width / Math.max(1, natW);
                  const padRatioH = childEl.height / Math.max(1, natH);
                  renderChildAnimLayer = Object.assign({}, childWorldAnimLayer, {
                    scaleW: childWorldAnimLayer.scaleW * padRatioW,
                    scaleH: childWorldAnimLayer.scaleH * padRatioH
                  });
                }
                layersToRender.push({ el: childEl, layer: childWorldAnimLayer, animLayer: renderChildAnimLayer });
              } else {
                ctx.save();
                if (worldOpacity < 1.0) ctx.globalAlpha = Math.max(0, Math.min(1, worldOpacity));
                if (child.blendMode && child.blendMode !== 'normal') ctx.globalCompositeOperation = resolveBlendMode(child.blendMode);
                const ax = worldAnchorX * bufferScale;
                const ay = worldAnchorY * bufferScale;
                ctx.translate(worldPosX * bufferScale + ax, worldPosY * bufferScale + ay);
                if (worldRotZ) ctx.rotate((worldRotZ * Math.PI) / 180);
                const signCX = Math.sign(worldScaleW) || 1;
                const signCY = Math.sign(worldScaleH) || 1;
                const cAbsW = Math.abs(worldScaleW) * bufferScale;
                const cAbsH = Math.abs(worldScaleH) * bufferScale;
                if (signCX < 0 || signCY < 0) ctx.scale(signCX, signCY);
                try {
                  ctx.drawImage(childEl, -cAbsW / 2 - ax, -cAbsH / 2 - ay, cAbsW, cAbsH);
                } catch (_) {}
                ctx.restore();
              }
            });

            if (!isExport && window.selectedLayerId && layer.id === window.selectedLayerId && !layer.hidden) {
              selectedWireframeBounds = layer._canvasBounds;
            }
            return; // Skip normal single-layer pass for this collapsed precomp
          }

          const basePw = Math.round(Math.abs(layer.mediaWidth || layer.scaleW || baseW));
          const basePh = Math.round(Math.abs(layer.mediaHeight || layer.scaleH || baseH));
          const pw = isExport ? basePw : Math.max(1, Math.round(basePw * bufferScale));
          const ph = isExport ? basePh : Math.max(1, Math.round(basePh * bufferScale));
          const precompRes = (window.VideoCompEngine && typeof window.VideoCompEngine.resolvePrecompElement === 'function')
            ? window.VideoCompEngine.resolvePrecompElement(layer, {
                isExport,
                isIdleCache,
                currentSec,
                pixelsPerSecond,
                targetW: pw,
                targetH: ph
              })
            : null;
          if (precompRes && precompRes.fromSequence && precompRes.el) {
            el = precompRes.el;
          } else {
            if (!layer._precompBufferCanvas || !(layer._precompBufferCanvas instanceof HTMLCanvasElement) || typeof layer._precompBufferCanvas.getContext !== 'function') {
              layer._precompBufferCanvas = document.createElement('canvas');
            }
            if (layer._precompBufferCanvas.width !== pw || layer._precompBufferCanvas.height !== ph) {
              layer._precompBufferCanvas.width = pw;
              layer._precompBufferCanvas.height = ph;
              layer._precompBufferCanvas._lastRenderKey = null;
            }
            const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
            let innerSec = 0;
            if (layer.speedMode === 'time_remap') {
              const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
                ? getLayerEffectivePropsAtTime(layer, currentSec)
                : layer;
              innerSec = Math.max(0, effProps.timeRemap !== undefined ? effProps.timeRemap : ((layer.sourceOffsetSec || 0) + (currentSec - clipStart) * (layer.speed || 1.0)));
            } else {
              innerSec = (typeof getLayerIntegratedSpeedTime === 'function')
                ? getLayerIntegratedSpeedTime(layer, currentSec)
                : (layer.speed !== undefined && layer.speed < 0
                  ? Math.max(0, (layer.sourceOffsetSec || 0) + Math.max(0, (((layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pixelsPerSecond))) - (currentSec - clipStart)) * Math.abs(layer.speed)))
                  : Math.max(0, (layer.sourceOffsetSec || 0) + (currentSec - clipStart) * (layer.speed || 1.0)));
            }
            renderPrecompToCanvas(layer, layer._precompBufferCanvas, innerSec, pw, ph, triggerSource);
            el = layer._precompBufferCanvas;
          }
          layer.mediaWidth = basePw;
          layer.mediaHeight = basePh;
          layer._userResized = true;
        } else {
          media = getOrLoadLayerMedia(layer);
          if (!media) return;

          el = media.el;
          timeInClip = 0;
          if (layer.type === 'video') {
            const res = window.VideoCompEngine.resolveLayerVideoElement(layer, media, {
              isExport,
              isIdleCache,
              currentSec,
              pixelsPerSecond
            });
            el = res.el;
            timeInClip = res.timeInClip;
            if (res.hasUnreadyMedia && isIdleCache) {
              hasUnreadyMedia = true;
              return;
            }
          }
        }

        // AI Background Removal: Substitute transparent cutout if ready, otherwise fallback to raw baked media seamlessly
        if (el && window.FishBgRemovalEngine && window.FishBgRemovalEngine.isLayerMattingActive(layer)) {
          if (layer.type === 'video') {
            const sourceKey = (layer.mediaId || layer.dataUrl || layer.id);
            const fps = (currentProjectState && currentProjectState.fps) || 60;
            const fIdx = Math.round(timeInClip * fps);
            const cutoutFrame = window.FishBgRemovalEngine.getVideoCutoutFrame(sourceKey, fIdx);
            if (cutoutFrame) {
              el = cutoutFrame;
            } else if (!isExport && !isIdleCache) {
              window.FishBgRemovalEngine.processLayer(layer);
            }
          } else {
            const photoCutout = window.FishBgRemovalEngine.getPhotoCutout(layer);
            if (photoCutout) {
              el = photoCutout;
            } else if (!isExport && !isIdleCache) {
              window.FishBgRemovalEngine.processLayer(layer);
            }
          }
        }

        if (el) {
          const origW = layer.mediaWidth || (media && media.el && media.el.videoWidth > 0 ? media.el.videoWidth : 0);
          const origH = layer.mediaHeight || (media && media.el && media.el.videoHeight > 0 ? media.el.videoHeight : 0);
          if (origW && !layer.mediaWidth) layer.mediaWidth = origW;
          if (origH && !layer.mediaHeight) layer.mediaHeight = origH;

          const mw = origW ||
                     (el.videoWidth > 0 ? el.videoWidth : 0) ||
                     (el.naturalWidth > 0 ? el.naturalWidth : 0) ||
                     (el.width > 0 ? el.width : 0) ||
                     (media && media.poster && media.poster.naturalWidth > 0 ? media.poster.naturalWidth : 0) ||
                     null;
          const mh = origH ||
                     (el.videoHeight > 0 ? el.videoHeight : 0) ||
                     (el.naturalHeight > 0 ? el.naturalHeight : 0) ||
                     (el.height > 0 ? el.height : 0) ||
                     (media && media.poster && media.poster.naturalHeight > 0 ? media.poster.naturalHeight : 0) ||
                     null;

          const aspect = currentProjectState.aspectRatio || '16:9';
          let baseDims = window.getProjectDimensions(res, aspect);
          if (currentActivePrecomp) {
            const cw = Math.round(Math.abs(currentActivePrecomp.mediaWidth || currentActivePrecomp.scaleW || baseDims[0]));
            const ch = Math.round(Math.abs(currentActivePrecomp.mediaHeight || currentActivePrecomp.scaleH || baseDims[1]));
            baseDims = [cw, ch];
          }
          const baseW = baseDims[0];
          const baseH = baseDims[1];
          const bufferScale = w / baseW;
          compositionBufferScale = bufferScale;

          if (mw && mh && layer.type !== 'precomp' && layer.type !== 'shape' && layer.type !== 'text') {
            if (!layer._userResized) {
              const curAspect = (layer.scaleW && layer.scaleH) ? (layer.scaleW / layer.scaleH) : null;
              const mediaAspect = mw / mh;
              if (!curAspect || Math.abs(curAspect - mediaAspect) > 0.02 || layer.normW === undefined) {
                fitLayerToComposition(layer, mw, mh);
              }
            } else if (layer.normX === undefined || layer.normY === undefined || layer.normW === undefined || layer.normH === undefined ||
                layer.scaleW === undefined || layer.scaleH === undefined) {
              fitLayerToComposition(layer, mw, mh);
            }
          }

          if (layer.type === 'shape') {
            if (!layer.shapeProps) {
              layer.shapeProps = { sizeX: 300, sizeY: 300 };
            }
            if (layer.transformScaleX === undefined) layer.transformScaleX = 1.0;
            if (layer.transformScaleY === undefined) layer.transformScaleY = 1.0;
            if (layer.scaleW === undefined) {
              layer.scaleW = (Number(layer.shapeProps.sizeX) || 300) * layer.transformScaleX;
            }
            if (layer.scaleH === undefined) {
              layer.scaleH = (Number(layer.shapeProps.sizeY) || 300) * layer.transformScaleY;
            }
            if (layer.normW === undefined) layer.normW = Math.abs(layer.scaleW) / baseW;
            if (layer.normH === undefined) layer.normH = Math.abs(layer.scaleH) / baseH;
            if (layer.posX === undefined) layer.posX = baseW / 2;
            if (layer.posY === undefined) layer.posY = baseH / 2;
            if (layer.normX === undefined) layer.normX = (layer.posX - layer.scaleW / 2) / baseW;
            if (layer.normY === undefined) layer.normY = (layer.posY - layer.scaleH / 2) / baseH;
            layer._userResized = true;
          }

          if (layer.type === 'text') {
            if (!layer.textProps && window.FishTextEngine && typeof window.FishTextEngine.getDefaultProps === 'function') {
              layer.textProps = window.FishTextEngine.getDefaultProps();
            }
            const nat = (window.FishTextEngine && window.FishTextEngine.getNaturalSize)
              ? window.FishTextEngine.getNaturalSize(layer)
              : { width: 320, height: 100 };
            const defBoxW = nat.width;
            const defBoxH = nat.height;
            if (layer.transformScaleX === undefined) {
              layer.transformScaleX = (layer.scaleW && defBoxW > 0 && layer._userResizedManual) ? (Math.abs(layer.scaleW) / defBoxW) : 1.0;
            }
            if (layer.transformScaleY === undefined) {
              layer.transformScaleY = (layer.scaleH && defBoxH > 0 && layer._userResizedManual) ? (Math.abs(layer.scaleH) / defBoxH) : 1.0;
            }
            layer.scaleW = defBoxW * layer.transformScaleX;
            layer.scaleH = defBoxH * layer.transformScaleY;
            if (layer.normW === undefined) layer.normW = Math.abs(layer.scaleW) / baseW;
            if (layer.normH === undefined) layer.normH = Math.abs(layer.scaleH) / baseH;
            if (layer.posX === undefined) layer.posX = baseW / 2;
            if (layer.posY === undefined) layer.posY = baseH / 2;
            if (layer.normX === undefined) layer.normX = (layer.posX - layer.scaleW / 2) / baseW;
            if (layer.normY === undefined) layer.normY = (layer.posY - layer.scaleH / 2) / baseH;
          }

          if (layer.posX === undefined) {
            const nw = (typeof layer.normW === 'number' && !isNaN(layer.normW)) ? layer.normW : 1;
            layer.posX = Number(((layer.normX !== undefined ? (layer.normX + nw / 2) : 0.5) * baseW).toFixed(2));
          }
          if (layer.posY === undefined) {
            const nh = (typeof layer.normH === 'number' && !isNaN(layer.normH))
              ? layer.normH
              : ((typeof layer.normW === 'number' && !isNaN(layer.normW)) ? (layer.normW * baseW / baseH) : 1);
            layer.posY = Number(((layer.normY !== undefined ? (layer.normY + nh / 2) : 0.5) * baseH).toFixed(2));
          }
          if (layer.scaleW === undefined) {
            const rawW = layer.normW !== undefined ? layer.normW * baseW : (mw || (layer.normH !== undefined ? layer.normH * baseH : baseW));
            layer.scaleW = Number(rawW.toFixed(1));
          }
          if (layer.scaleH === undefined) {
            const rawH = layer.normH !== undefined ? layer.normH * baseH : (mh || (layer.normW !== undefined ? layer.normW * baseW : (mw || baseW)));
            layer.scaleH = Number(rawH.toFixed(1));
          }
            if (layer.rotZ === undefined) layer.rotZ = layer.rotation || 0;
            if (layer.rotX === undefined) layer.rotX = 0;
            if (layer.rotY === undefined) layer.rotY = 0;
            if (layer.rotation === undefined) layer.rotation = layer.rotZ || 0;
            if (layer.skewX === undefined) layer.skewX = 0;
            if (layer.skewY === undefined) layer.skewY = 0;
            if (layer.posZ === undefined) layer.posZ = 0;
            if (layer.anchorX === undefined) layer.anchorX = 0;
            if (layer.anchorY === undefined) layer.anchorY = 0;
            if (layer.anchorZ === undefined) layer.anchorZ = 0;

            const effProps = (typeof getLayerEffectivePropsAtTime === 'function')
              ? getLayerEffectivePropsAtTime(layer, currentSec)
              : {
                  posX: layer.posX,
                  posY: layer.posY,
                  scaleW: layer.scaleW,
                  scaleH: layer.scaleH,
                  rotZ: layer.rotZ !== undefined ? layer.rotZ : (layer.rotation || 0),
                  rotX: layer.rotX || 0,
                  rotY: layer.rotY || 0,
                  skewX: layer.skewX || 0,
                  skewY: layer.skewY || 0,
                  anchorX: layer.anchorX || 0,
                  anchorY: layer.anchorY || 0,
                  posZ: layer.posZ || 0,
                  opacity: (layer.opacity !== undefined && layer.opacity !== null) ? (Number(layer.opacity) > 1.0 ? Math.max(0, Math.min(1, Number(layer.opacity) / 100)) : Math.max(0, Math.min(1, Number(layer.opacity)))) : 1.0
                };

            const cx = effProps.posX * bufferScale;
            const cy = effProps.posY * bufferScale;
            const bw = effProps.scaleW * bufferScale;
            const bh = effProps.scaleH * bufferScale;
            const rotZ = effProps.rotZ !== undefined ? effProps.rotZ : (effProps.rotation || 0);
            const rotX = effProps.rotX || 0;
            const rotY = effProps.rotY || 0;
            const skewX = effProps.skewX || 0;
            const skewY = effProps.skewY || 0;

            const signX = Math.sign(bw) || 1;
            const signY = Math.sign(bh) || 1;
            const absW = Math.abs(bw);
            const absH = Math.abs(bh);
            if ((layer.type === 'image' || layer.type === 'video') && (!layer.fillType || layer.fillType === 'media') && typeof window.getFittedMediaElement === 'function') {
              el = window.getFittedMediaElement(layer, el, absW, absH);
            }

            // Calculate Camera Depth of Field blur if camera blur is enabled (3D layers only)
            let layerDofBlur = 0;
            if (layer.is3D && activeCamera && camEff && camEff.cameraBlurEnabled && (camEff.cameraBlurAmount || 20) > 0) {
              const layerZ = effProps.posZ || 0;
              let focusZ = camEff.cameraFocusDistance || 0;
              let distToFocus = 0;

              if (camEff.cameraFocusMode === 'layer' && camEff.cameraFocusTargetLayerId) {
                if (layer.id === camEff.cameraFocusTargetLayerId) {
                  distToFocus = 0;
                } else {
                  const targetLayer = (currentProjectState.layers || []).find(l => l.id === camEff.cameraFocusTargetLayerId);
                  if (targetLayer) {
                    const targetEff = (typeof getLayerEffectivePropsAtTime === 'function')
                      ? getLayerEffectivePropsAtTime(targetLayer, currentSec)
                      : targetLayer;
                    focusZ = targetEff.posZ || 0;
                    distToFocus = Math.abs(layerZ - focusZ) < 0.001 ? 0 : (layerZ - focusZ);
                  } else {
                    distToFocus = Math.abs(layerZ - focusZ) < 0.001 ? 0 : (layerZ - focusZ);
                  }
                }
              } else {
                distToFocus = Math.abs(layerZ - focusZ) < 0.001 ? 0 : (layerZ - focusZ);
              }

              const blurRange = Math.max(10, camEff.cameraBlurNearFar || 600);
              const maxBlur = camEff.cameraBlurAmount !== undefined ? camEff.cameraBlurAmount : 20;
              const balance = (camEff.cameraBlurBalance || 0) / 100;
              const falloff = distToFocus > 0 ? (blurRange * (1 - balance * 0.5)) : (blurRange * (1 + balance * 0.5));
              const blurFactor = Math.min(1.0, Math.abs(distToFocus) / Math.max(10, falloff));
              layerDofBlur = blurFactor * maxBlur;
            }

            const engine = window.FishToolEngine || window.LayerTransform;
            if (engine) {
              const animLayer = Object.assign({}, layer, effProps);
              animLayer._currentSec = currentSec;
              layer._currentSec = currentSec;
              animLayer._dofBlur = layerDofBlur;
              layer._dofBlur = layerDofBlur;
              animLayer._rawLayer = layer;
              if (Array.isArray(effProps.effects)) {
                animLayer.effects = effProps.effects;
              } else if (Array.isArray(layer.effects)) {
                animLayer.effects = layer.effects;
              }

              // 1. Compute wireframe bounds on unpadded animLayer so wireframe stays tight on text/vector metrics (like AE)
              // During playback or timeline scrubbing, only compute bounds for selected layers (or if never computed)
              const isLayerSelected = (window.selectedLayerId === layer.id) || (window.selectedLayerIds && window.selectedLayerIds.has(layer.id));
              if (isLayerSelected || (!window.isTimelinePlaying && !isScrubbing) || !layer._canvasBounds) {
                layer._canvasBounds = engine.getBounds(animLayer, bufferScale, camEff, w, h);
              }

              // 2. Expand render quad for padded canvas so texture renders 1:1 without squish or stretch
              let renderAnimLayer = animLayer;
              if (el && el._isPlaceholder) {
                renderAnimLayer = Object.assign({}, animLayer, { effects: [] });
              }
              if (isText && layer._textPadY > 0 && el && el.width && el.height) {
                const natW = layer._textNaturalW || (el.width - 2 * layer._textPadX);
                const natH = layer._textNaturalH || (el.height - 2 * layer._textPadY);
                const padRatioW = el.width / Math.max(1, natW);
                const padRatioH = el.height / Math.max(1, natH);
                renderAnimLayer = Object.assign({}, renderAnimLayer, {
                  scaleW: animLayer.scaleW * padRatioW,
                  scaleH: animLayer.scaleH * padRatioH
                });
              } else if (isShape && layer.shapeType === 'vector' && el && el.width && el.height) {
                const vBounds = (typeof window.getVectorLocalBounds === 'function')
                  ? window.getVectorLocalBounds(layer.shapeProps || {})
                  : null;
                const natW = vBounds ? vBounds.width : (Number(layer.shapeProps && layer.shapeProps.sizeX) || el.width);
                const natH = vBounds ? vBounds.height : (Number(layer.shapeProps && layer.shapeProps.sizeY) || el.height);
                const padRatioW = el.width / Math.max(1, natW);
                const padRatioH = el.height / Math.max(1, natH);
                renderAnimLayer = Object.assign({}, renderAnimLayer, {
                  scaleW: animLayer.scaleW * padRatioW,
                  scaleH: animLayer.scaleH * padRatioH,
                  _isVectorRenderPass: true
                });
              }
              layersToRender.push({ el, layer, animLayer: renderAnimLayer });

            } else {
              ctx.save();
              if (effProps.opacity !== undefined && effProps.opacity !== null) {
                ctx.globalAlpha = Math.max(0, Math.min(1, effProps.opacity));
              }
              if (layer.blendMode && layer.blendMode !== 'normal') {
                ctx.globalCompositeOperation = resolveBlendMode(layer.blendMode);
              }
              if (layerDofBlur > 0.5) {
                const curFilter = ctx.filter && ctx.filter !== 'none' ? ctx.filter : '';
                ctx.filter = (curFilter ? (curFilter + ' ') : '') + `blur(${layerDofBlur.toFixed(1)}px)`;
              }
              if (window.FishEffects && typeof window.FishEffects.applyToContext === 'function' && !(el && el._isPlaceholder)) {
                const animLayer2D = Object.assign({}, layer, effProps);
                if (Array.isArray(effProps.effects)) {
                  animLayer2D.effects = effProps.effects.map(fx => Object.assign({}, fx));
                } else if (Array.isArray(layer.effects)) {
                  animLayer2D.effects = layer.effects.map(fx => Object.assign({}, fx));
                }
                window.FishEffects.applyToContext(ctx, animLayer2D);
              }
              const ax = (effProps.anchorX || 0) * bufferScale;
              const ay = (effProps.anchorY || 0) * bufferScale;
              ctx.translate(cx + ax * signX, cy + ay * signY);
              const posZ = (effProps.posZ || 0) * bufferScale;
              const camDist = 1000 * bufferScale;
              const nearDist = 50 * bufferScale;
              const maxZ = 950 * bufferScale;
              const zScale = posZ ? (camDist / Math.max(nearDist, camDist - Math.min(posZ, maxZ))) : 1;
              if (zScale !== 1) {
                ctx.scale(zScale, zScale);
              }
              if (rotZ) {
                ctx.rotate((rotZ * Math.PI) / 180);
              }
              if (rotX || rotY) {
                const cosX = Math.cos((rotX * Math.PI) / 180);
                const cosY = Math.cos((rotY * Math.PI) / 180);
                ctx.scale(cosY, cosX);
              }
              if (skewX || skewY) {
                const tanX = Math.tan(((skewX || 0) * Math.PI) / 180);
                const tanY = Math.tan(((skewY || 0) * Math.PI) / 180);
                ctx.transform(1, tanY, tanX, 1, 0, 0);
              }
              if (signX < 0 || signY < 0) {
                ctx.scale(signX, signY);
              }
              let animLayerPost = null;
              try {
                animLayerPost = Object.assign({}, layer, effProps);
                if (Array.isArray(effProps.effects)) animLayerPost.effects = effProps.effects;
                else if (Array.isArray(layer.effects)) animLayerPost.effects = layer.effects;

                // Text or Vector layers with expanded buffer padding: draw canvas WITHOUT squishing.
                if (isText && layer._textPadY > 0 && el instanceof HTMLCanvasElement) {
                  const natW = layer._textNaturalW || (el.width - 2 * layer._textPadX);
                  const natH = layer._textNaturalH || (el.height - 2 * layer._textPadY);
                  const padRatioW = el.width / Math.max(1, natW);
                  const padRatioH = el.height / Math.max(1, natH);
                  const drawW = absW * padRatioW;
                  const drawH = absH * padRatioH;
                  const drawX = -drawW / 2 - ax;
                  const drawY = -drawH / 2 - ay;
                  if (window.FishEffects && typeof window.FishEffects.renderLayer === 'function') {
                    window.FishEffects.renderLayer(ctx, el, animLayerPost, { x: drawX, y: drawY, w: drawW, h: drawH, bufferScale: bufferScale, unitScale: bufferScale }, currentSec);
                  } else {
                    ctx.drawImage(el, drawX, drawY, drawW, drawH);
                  }
                } else if (isShape && layer.shapeType === 'vector' && el instanceof HTMLCanvasElement) {
                  const vBounds = (typeof window.getVectorLocalBounds === 'function')
                    ? window.getVectorLocalBounds(layer.shapeProps || {})
                    : null;
                  const natW = vBounds ? vBounds.width : (Number(layer.shapeProps && layer.shapeProps.sizeX) || el.width);
                  const natH = vBounds ? vBounds.height : (Number(layer.shapeProps && layer.shapeProps.sizeY) || el.height);
                  const padRatioW = el.width / Math.max(1, natW);
                  const padRatioH = el.height / Math.max(1, natH);
                  const drawW = absW * padRatioW;
                  const drawH = absH * padRatioH;
                  const drawX = -drawW / 2 - ax;
                  const drawY = -drawH / 2 - ay;
                  if (window.FishEffects && typeof window.FishEffects.renderLayer === 'function') {
                    window.FishEffects.renderLayer(ctx, el, animLayerPost, { x: drawX, y: drawY, w: drawW, h: drawH, bufferScale: bufferScale, unitScale: bufferScale }, currentSec);
                  } else {
                    ctx.drawImage(el, drawX, drawY, drawW, drawH);
                  }
                } else {
                  const isPrecompCollapsed = (layer.type === 'precomp' && !!layer.collapseTransformations);
                  const rVal = (!isPrecompCollapsed && typeof layer.roundness === 'number') ? layer.roundness : 0;
                  const hasRoundClip = (rVal > 0);
                  if (hasRoundClip) {
                    const maxR = Math.min(absW, absH) / 2;
                    const r = Math.min(rVal, maxR);
                    ctx.save();
                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') {
                      ctx.roundRect(-absW / 2 - ax, -absH / 2 - ay, absW, absH, r);
                    } else {
                      const rx = -absW / 2 - ax;
                      const ry = -absH / 2 - ay;
                      ctx.moveTo(rx + r, ry);
                      ctx.arcTo(rx + absW, ry, rx + absW, ry + absH, r);
                      ctx.arcTo(rx + absW, ry + absH, rx, ry + absH, r);
                      ctx.arcTo(rx, ry + absH, rx, ry, r);
                      ctx.arcTo(rx, ry, rx + absW, ry, r);
                      ctx.closePath();
                    }
                    ctx.clip();
                  }
                  if (window.FishEffects && typeof window.FishEffects.renderLayer === 'function') {
                    window.FishEffects.renderLayer(ctx, el, animLayerPost, { x: -absW / 2 - ax, y: -absH / 2 - ay, w: absW, h: absH, bufferScale: bufferScale, unitScale: bufferScale }, currentSec);
                  } else {
                    ctx.drawImage(el, -absW / 2 - ax, -absH / 2 - ay, absW, absH);
                  }
                  if (hasRoundClip) {
                    ctx.restore();
                  }
                }

                if (window.FishEffects && typeof window.FishEffects.applyPostEffects === 'function') {
                  window.FishEffects.applyPostEffects(ctx, el, animLayerPost, { x: -absW / 2 - ax, y: -absH / 2 - ay, w: absW, h: absH });
                }
              } catch (_) {
                try { ctx.drawImage(el, -absW / 2 - ax, -absH / 2 - ay, absW, absH); } catch (e) {}
              }
              ctx.restore();

              if (!layer._canvasBounds) {
                layer._canvasBounds = { cx: 0, cy: 0, x: 0, y: 0, w: 0, h: 0, scaleW: 0, scaleH: 0, rotation: 0, rotX: 0, rotY: 0, skewX: 0, skewY: 0 };
              }
              const b = layer._canvasBounds;
              b.cx = cx;
              b.cy = cy;
              b.x = cx - absW / 2;
              b.y = cy - absH / 2;
              b.w = absW;
              b.h = absH;
              b.scaleW = bw;
              b.scaleH = bh;
              b.rotation = rotZ;
              b.rotX = rotX || 0;
              b.rotY = rotY || 0;
              b.skewX = skewX;
              b.skewY = skewY;

              const tfFx = (animLayerPost.effects || []).find(f => f && f.type === 'transform' && !f.disabled);
              if (tfFx) {
                const tfScale = (tfFx.scale !== undefined ? tfFx.scale : 100) / 100;
                const tfRot = tfFx.rotation || 0;
                const tfPx = (tfFx.posX || 0) * bufferScale;
                const tfPy = (tfFx.posY || 0) * bufferScale;

                layer._canvasBounds.cx += tfPx;
                layer._canvasBounds.cy += tfPy;
                layer._canvasBounds.w *= tfScale;
                layer._canvasBounds.h *= tfScale;
                layer._canvasBounds.scaleW *= tfScale;
                layer._canvasBounds.scaleH *= tfScale;
                layer._canvasBounds.rotation = (layer._canvasBounds.rotation || 0) + tfRot;
                layer._canvasBounds.x = layer._canvasBounds.cx - layer._canvasBounds.w / 2;
                layer._canvasBounds.y = layer._canvasBounds.cy - layer._canvasBounds.h / 2;
              }
            }

            // Auto-capture ultra-lightweight micro-thumbnail preview (32x24px, JPEG 0.45) for timeline pill (only when paused/idle & not exporting)
            if (!isExport && (!layer.thumbUrl || layer.thumbUrl.length < 50) && !window.isTimelinePlaying && !layer._capturingThumb) {
              layer._capturingThumb = true;
              setTimeout(() => {
                try {
                  const mini = document.createElement('canvas');
                  mini.width = 32;
                  mini.height = 24;
                  const mctx = mini.getContext('2d', { alpha: false });
                  mctx.imageSmoothingQuality = 'low';
                  const sw = el.videoWidth || el.naturalWidth || absW;
                  const sh = el.videoHeight || el.naturalHeight || absH;
                  mctx.drawImage(el, 0, 0, sw, sh, 0, 0, 32, 24);
                  const u = mini.toDataURL('image/jpeg', 0.45);
                  if (u && u.length > 50) {
                    layer.thumbUrl = u;
                    const slot = document.querySelector(`.timeline-lane-pill-slot[data-layer-id="${layer.id}"]`);
                    if (slot) {
                      const thumbBox = slot.querySelector('.timeline-layer-thumb-circle');
                      if (thumbBox) {
                        thumbBox.innerHTML = `<img src="${u}" class="timeline-layer-thumb-img" alt="" loading="lazy" draggable="false" />`;
                      }
                    }
                  }
                } catch (_) {}
                layer._capturingThumb = false;
              }, 120);
            }

            if (!isExport && window.selectedLayerId && layer.id === window.selectedLayerId && !layer.hidden) {
              selectedWireframeBounds = layer._canvasBounds;
            }
          }
        });

        // Hardware 3D Perspective Scene: Batches intersecting 3D layers into WebGL with true Z-buffer penetration
        const engine = window.FishToolEngine || window.LayerTransform;
        const mbEngine = window.FishMotionBlurEngine;
        const compState = currentActivePrecomp || currentProjectState;
        if (engine && layersToRender.length > 0) {
          let staticBatch = [];
          const flushStaticBatch = () => {
            if (staticBatch.length === 0) return;
            if (typeof engine.renderScene === 'function') {
              engine.renderScene(ctx, staticBatch, compositionBufferScale, camEff, currentSec);
            } else {
              staticBatch.forEach(item => {
                engine.renderLayer(ctx, item.el, item.animLayer || item.layer, compositionBufferScale, camEff, currentSec);
              });
            }
            staticBatch = [];
          };

          // Shared-depth 3D runs: consecutive plain-3D layers accumulate here and
          // render together — one depth pass when static, one scene motion-blur
          // pass when any member moves — so 3D penetration survives motion blur.
          // Runs without blur (or when the scene pass is unavailable) fall back
          // to the legacy staticBatch path verbatim.
          let pending3DRun = [];
          const flush3DRun = () => {
            if (pending3DRun.length === 0) return;
            const anyBlur = pending3DRun.some(m => m.blur);
            let handled = false;
            if (anyBlur && engine && typeof engine.render3DSceneMotionBlur === 'function') {
              handled = engine.render3DSceneMotionBlur(ctx, pending3DRun, compositionBufferScale, camEff, currentSec, compState);
            }
            if (!handled) {
              pending3DRun.forEach(m => { staticBatch.push(m.item); });
              flushStaticBatch();
            }
            pending3DRun = [];
          };

          layersToRender.forEach(item => {
            const rawLayer = item.layer;
            const isMbActive = mbEngine && mbEngine.isLayerActive(rawLayer, compState, activeCamera) && mbEngine.hasMotion(rawLayer, currentSec, null, (typeof getProjectFps === 'function' ? getProjectFps() : 60), (compState && compState.layers) || (currentProjectState && currentProjectState.layers) || [], activeCamera);
            const bounds = engine ? engine.getBounds(item.animLayer || rawLayer, compositionBufferScale, camEff) : null;
            // Plain-3D run member (static or blurred): shared depth pass.
            // Collapsed precomp children join the shared depth pass when static,
            // or keep the legacy sampled path when per-sample world-transform blur is active.
            if (engine && typeof engine.isBatchable3D === 'function' &&
                engine.isBatchable3D(item.animLayer || rawLayer, bounds) &&
                (!rawLayer._isCollapsedPrecompChild || !isMbActive)) {
              pending3DRun.push({ item, bounds, blur: !!isMbActive });
              return;
            }
            flushStaticBatch();
            flush3DRun();
            if (isMbActive) {
              const hasMoveFx = mbEngine && ((typeof mbEngine.hasMovementEffect === 'function' && mbEngine.hasMovementEffect(rawLayer)) || (typeof mbEngine.needsSampledPath === 'function' && mbEngine.needsSampledPath(rawLayer)));
              const hasSelfBlur = mbEngine && Array.isArray(rawLayer.effects) && rawLayer.effects.some(f => {
                if (!f || f.disabled) return false;
                if (f.type === 'shatter') return true;
                const d = typeof mbEngine._effectDef === 'function' ? mbEngine._effectDef(f) : null;
                return !!(d && d.selfBlur);
              });
              if (hasSelfBlur) {
                engine.renderLayer(ctx, item.el, item.animLayer || rawLayer, compositionBufferScale, camEff, currentSec);
              } else if (engine && item.el && typeof engine.render3DMotionBlur === 'function' && !rawLayer._isCollapsedPrecompChild && !hasMoveFx && bounds && bounds.is3D) {
                engine.render3DMotionBlur(ctx, item.el, item.animLayer || rawLayer, compositionBufferScale, camEff, currentSec, compState);
              } else {
                mbEngine.renderLayerWithMotionBlur(
                  ctx,
                  item.el,
                  item.animLayer || rawLayer,
                  compositionBufferScale,
                  camEff,
                  currentSec,
                  (subCtx, subEl, subLayer, subScale, subCam, subSec) => {
                    const currentSubEl = subEl; // text glyph blur already baked in buffer
                    const pool = (compState && compState.layers) || (currentProjectState && currentProjectState.layers) || [];
                    const subCamera = (activeCamera && typeof getLayerEffectivePropsAtTime === 'function')
                      ? getLayerEffectivePropsAtTime(activeCamera, subSec, null, pool)
                      : (subCam || camEff);
                    // For collapsed precomp children: re-evaluate world transform at subSec
                    // so motion blur samples real parent+child animation, not baked static position
                    if (subLayer._isCollapsedPrecompChild && subLayer._precompParentLayer && subLayer._childOrigLayer && window.FishMotionBlurEngine) {
                      const worldAtSub = window.FishMotionBlurEngine._computeCollapsedChildWorldPos(
                        subLayer._precompParentLayer, subLayer._childOrigLayer, subSec, null
                      );
                      if (worldAtSub) {
                        const subAnimLayer = Object.assign({}, subLayer, {
                          posX: worldAtSub.posX,
                          posY: worldAtSub.posY,
                          posZ: worldAtSub.posZ,
                          scaleW: worldAtSub.scaleW,
                          scaleH: worldAtSub.scaleH,
                          rotX: worldAtSub.rotX,
                          rotY: worldAtSub.rotY,
                          rotZ: worldAtSub.rotZ,
                          rotation: worldAtSub.rotZ,
                          _currentSec: subSec
                        });
                        if (Array.isArray(subLayer.effects)) subAnimLayer.effects = subLayer.effects;
                        engine.renderLayer(subCtx, currentSubEl, mbEngine.compensateTextPad(subLayer, currentSubEl, subAnimLayer), subScale, subCamera, subSec);
                        return;
                      }
                    }
                    const srcLayer = subLayer._rawLayer || subLayer;
                    const subEff = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(srcLayer, subSec) : srcLayer;
                    const subAnimLayer = Object.assign({}, subLayer, subEff);
                    subAnimLayer._currentSec = subSec;
                    if (Array.isArray(subEff.effects)) subAnimLayer.effects = subEff.effects;
                    else if (Array.isArray(subLayer.effects)) subAnimLayer.effects = subLayer.effects;
                    engine.renderLayer(subCtx, currentSubEl, mbEngine.compensateTextPad(subLayer, currentSubEl, subAnimLayer), subScale, subCamera, subSec);
                  },
                  compState
                );
              }
            } else {
              staticBatch.push(item);
            }
          });
          flushStaticBatch();
          flush3DRun();
        }

        if (activeCamera && camEff && !engineActive) {
          ctx.restore();
        }

        window._inAdaptiveDraftBuffer = false;
        if (useAdaptiveBuffer) {
          const renderedDraftCanvas = canvas;
          const rw = w;
          const rh = h;
          canvas = outerCanvas;
          ctx = outerCtx;
          w = outerW;
          h = outerH;
          bufferScale = outerW / baseW;

          ctx.clearRect(0, 0, w, h);
          const prevSmooth = ctx.imageSmoothingEnabled;
          ctx.imageSmoothingEnabled = adaptiveScale > 0.65;
          ctx.drawImage(renderedDraftCanvas, 0, 0, rw, rh, 0, 0, w, h);
          ctx.imageSmoothingEnabled = prevSmooth;

          const invX = w / Math.max(1, rw);
          const invY = h / Math.max(1, rh);
          activeLayers.forEach(al => {
            const b = al && al._canvasBounds;
            if (!b) return;
            if (typeof b.x === 'number') b.x *= invX;
            if (typeof b.y === 'number') b.y *= invY;
            if (typeof b.w === 'number') b.w *= invX;
            if (typeof b.h === 'number') b.h *= invY;
            if (typeof b.cx === 'number') b.cx *= invX;
            if (typeof b.cy === 'number') b.cy *= invY;
            if (typeof b.aabbW === 'number') b.aabbW *= invX;
            if (typeof b.aabbH === 'number') b.aabbH *= invY;
            if (Array.isArray(b.corners)) {
              b.corners.forEach(pt => {
                if (pt) { pt.x *= invX; pt.y *= invY; }
              });
            }
            if (b.anchor) {
              b.anchor.x *= invX;
              b.anchor.y *= invY;
            }
          });
        }

        // LIVE FRAME CACHING (After Effects RAM Preview Style)
        // Caching during playback, scrubbing, and frame park ensures subsequent scrubbing is instant 60fps.
        const currentRenderElapsed = performance.now() - t0;
        if (canUseAdaptiveDraft) {
          window.VideoCompEngine.adjustAdaptiveDraftBudget(currentRenderElapsed, fps, adState);
          window._currentAdaptiveDraftScale = adState.scale;
        }

        // Ensure active video layers actually rendered exact decoded frames (never cache fallback/stale frames!)
        const hasUnreadyVideoInComposition = activeVideos.some(vl => {
          if (vl.hidden) return false;
          if (!vl._renderedExactVideoFrame) return true;
          if (!vl._lastRenderedFrame) return true;
          return false;
        });

        const shouldBakeLiveFrame = !isScrubbing;

        if (shouldBakeLiveFrame && !hasUnreadyVideoInComposition && !isExport && !window.isExporting && !isIdleCache && !isTransformDragging &&
            triggerSource !== 'lookahead-cache' &&
            window.PreviewCacheManager && window.isPreviewCacheEnabled !== false) {
          if (typeof window.PreviewCacheManager.ensureAudioOnlyFullCache === 'function' &&
              window.PreviewCacheManager.ensureAudioOnlyFullCache(currentProjectState)) {
            // Audio-only timeline: entire project duration is now 100% cached
          } else if (adaptiveScale >= 0.96 || isDraftModeActive || window.isTimelinePlaying) {
            window.PreviewCacheManager.setFrameFromCanvas(frameIndex, canvas, isDraftModeActive);
          }
        }

      }

      if (!isExport && !isIdleCache && triggerSource !== 'lookahead-cache') {
        window._lastFrameWasCached = !!cachedBitmap;
      }

      // Grid overlay → drawn by CanvasOverlay (js/canvas-overlay.js) on separate canvas

      // Motion path → drawn by CanvasOverlay (js/canvas-overlay.js) on separate canvas


      window._lastFrameRenderDuration = performance.now() - t0;

      // Ensure wireframe bounds and overlay are strictly updated ONLY for the interactive viewer
      // Lookahead worker, idle cache, templates, and video export must NEVER touch viewer overlay or bounds!
      const isInteractiveViewer = (canvas && canvas.id === 'editor-active-canvas') &&
        !isExport && !isTemplate &&
        triggerSource !== 'lookahead-cache' && triggerSource !== 'idle-cache';

      if (isInteractiveViewer) {
        syncActiveViewerOverlay(currentSec, w, h, bufferScale, camEff, activeLayers);
      }
      return !hasUnreadyMedia;
    }
    window.renderCanvasFrame = renderCanvasFrame;

    // Ensure preview box visual on-screen dimensions stably fit container, invariant to resolution changes (e.g. Speed Draft)
    function fitPreviewCanvasBox() {
      const container = document.getElementById('editor-preview-container');
      const box = document.getElementById('editor-preview-canvas');
      const canvas = document.getElementById('editor-active-canvas');
      if (!container || !box) return;

      const aspectStr = currentProjectState.aspectRatio || '16:9';
      const resStr = currentProjectState.resolution || '1080p';
      let aspect = 16 / 9;
      if (currentActivePrecomp) {
        const cw = Math.round(Math.abs(currentActivePrecomp.mediaWidth || currentActivePrecomp.scaleW || 1920));
        const ch = Math.round(Math.abs(currentActivePrecomp.mediaHeight || currentActivePrecomp.scaleH || 1080));
        aspect = (cw && ch) ? (cw / ch) : (16 / 9);
      } else {
        const baseDims = window.getProjectDimensions(resStr, aspectStr);
        if (baseDims && baseDims[0] > 0 && baseDims[1] > 0) {
          aspect = baseDims[0] / baseDims[1];
        } else if (aspectStr === '9:16') aspect = 9 / 16;
        else if (aspectStr === '1:1') aspect = 1 / 1;
        else if (aspectStr === '4:3') aspect = 4 / 3;
        else if (aspectStr === '21:9') aspect = 21 / 9;
      }

      const availW = Math.max(0, container.clientWidth - 24);
      const availH = Math.max(0, container.clientHeight - 24);
      if (availW <= 0 || availH <= 0) return;

      let w = availW;
      let h = w / aspect;

      if (h > availH) {
        h = availH;
        w = h * aspect;
      }

      box.style.width = `${Math.round(w)}px`;
      box.style.height = `${Math.round(h)}px`;

      // Adapt canvas pixel buffer to physical display resolution to eliminate 1080p frame drops
      if (canvas && typeof resMap !== 'undefined') {
        const aspect = currentProjectState.aspectRatio || '16:9';
        const res = currentProjectState.resolution || '1080p';
        let baseDims = window.getProjectDimensions(res, aspect);
        if (currentActivePrecomp) {
          const cw = Math.round(Math.abs(currentActivePrecomp.mediaWidth || currentActivePrecomp.scaleW || baseDims[0]));
          const ch = Math.round(Math.abs(currentActivePrecomp.mediaHeight || currentActivePrecomp.scaleH || baseDims[1]));
          baseDims = [cw, ch];
        }
        currentProjectState._baseW = baseDims[0];
        currentProjectState._baseH = baseDims[1];
        const isMobileDevice = (typeof window !== 'undefined' && (window.innerWidth <= 600 || ('ontouchstart' in window && window.innerWidth <= 900)));

        // Keep backing canvas at display DPR; Speed Draft scales internal render buffer via _adaptiveDraftCanvas
        const dpr = isMobileDevice ? 1.0 : Math.min(1.5, window.devicePixelRatio || 1);
        const targetW = Math.max(1, Math.min(baseDims[0], Math.round(w * dpr)));
        const targetH = Math.max(1, Math.min(baseDims[1], Math.round(h * dpr)));

        canvas.style.imageRendering = 'auto';

        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
          redrawComposition('fitPreviewCanvasBox');
        }
      }
    }

    window.addEventListener('resize', fitPreviewCanvasBox);
    if (typeof ResizeObserver !== 'undefined') {
      window.addEventListener('DOMContentLoaded', () => {
        const pContainer = document.getElementById('editor-preview-container');
        if (pContainer) {
          new ResizeObserver(() => fitPreviewCanvasBox()).observe(pContainer);
        }
      });
    }

    // Function to apply aspect ratio, resolution, fps and background to preview canvas
    function updatePreviewCanvas(aspectStr, resStr, fpsVal, bgVal) {
      const box = document.getElementById('editor-preview-canvas');
      const canvas = document.getElementById('editor-active-canvas');
      if (!box || !canvas) return;

      const aspect = aspectStr || currentProjectState.aspectRatio || '16:9';
      const res = resStr || currentProjectState.resolution || '1080p';
      const fps = fpsVal ? parseInt(fpsVal, 10) : currentProjectState.fps || 60;
      const bg = bgVal !== undefined ? bgVal : currentProjectState.bgColor || 'transparent';

      currentProjectState.aspectRatio = aspect;
      currentProjectState.resolution = res;
      if (currentProjectState.fps !== fps) {
        currentProjectState.fps = fps;
        window.currentTimelineFps = fps;
        if (window.PreviewCacheManager) {
          window.PreviewCacheManager.setFps(fps);
        }
      } else {
        currentProjectState.fps = fps;
      }
      currentProjectState.bgColor = bg;

      // Sync existing camera layers scaleW & scaleH to new project resolution & aspect ratio
      const baseDims = window.getProjectDimensions(res, aspect);
      const baseW = baseDims[0];
      const baseH = baseDims[1];
      currentProjectState._baseW = baseW;
      currentProjectState._baseH = baseH;
      currentProjectState.baseW = baseW;
      currentProjectState.baseH = baseH;
      (currentProjectState.layers || []).forEach(l => {
        if (l.type === 'camera') {
          l.scaleW = baseW;
          l.scaleH = baseH;
        }
      });

      // 1. Calculate CSS aspect-ratio string & keep on-screen size stable
      let cssRatio = `${baseW} / ${baseH}`;
      box.style.setProperty('--preview-aspect', cssRatio);
      box.style.aspectRatio = cssRatio;
      fitPreviewCanvasBox();

      // 2. Set Preview Box Background
      if (bg === 'transparent') {
        box.style.backgroundColor = '#000000';
      } else {
        box.style.backgroundColor = bg;
      }

      // 3. Render Active Frame
      renderCanvasFrame(canvas, bg, canvas.width, canvas.height);
    }
    window.updatePreviewCanvas = updatePreviewCanvas;
    window.fitPreviewCanvasBox = fitPreviewCanvasBox;

    (function initCanvasTransform() {
      const activeCanvasEl = document.getElementById('editor-active-canvas');
      if (!activeCanvasEl) return;

      // Initialize overlay canvas
      const overlayCanvas = document.getElementById('editor-overlay-canvas');
      if (overlayCanvas && window.CanvasOverlay) {
        window.CanvasOverlay.init(overlayCanvas);
      }

      window.moveAnchorSubmode = window.moveAnchorSubmode || 'move';
      window.isAnchorMode = function() {
        const activeProp = window.activeKeyframeProperty || 'move';
        return (activeProp === 'move' || !window.activeKeyframeProperty) && (window.moveAnchorSubmode === 'anchor');
      };

      let activeOp = null; // null | 'move' | 'scale'
      let activeHandleType = null;
      let targetLayer = null;
      let startPointer = { x: 0, y: 0 };
      let startBounds = { x: 0, y: 0, w: 0, h: 0 };
      let startLayerState = null;
      let hasMoved = false;

      function getCanvasBufferCoords(e) {
        const rect = activeCanvasEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return { x: 0, y: 0, dprScale: 1 };
        const scaleX = activeCanvasEl.width / rect.width;
        const scaleY = activeCanvasEl.height / rect.height;
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY,
          dprScale: scaleX
        };
      }

      function findSnapTarget(val, targets, threshold) {
        let closest = null;
        let minDiff = threshold;
        for (let i = 0; i < targets.length; i++) {
          const diff = Math.abs(val - targets[i]);
          if (diff < minDiff) {
            minDiff = diff;
            closest = targets[i];
          }
        }
        return closest;
      }
      window.findSnapTarget = findSnapTarget;

      function getActiveLayersAtPlayhead() {
        const pixelsPerSec = window.currentPixelsPerSecond || 80;
        const currentPanX = window.timelinePanX !== undefined ? Math.min(0, window.timelinePanX) : 0;
        const currentSec = Math.max(0, -currentPanX / pixelsPerSec);
        const layers = currentProjectState.layers || [];
        return layers.filter(layer => {
          if (layer.hidden) return false;
          const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSec);
          const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pixelsPerSec);
          return currentSec >= (start - 0.0001) && currentSec < (start + dur);
        });
      }
      window.getActiveLayersAtPlayhead = getActiveLayersAtPlayhead;

      function getActiveCameraLayer() {
        const activeLayers = getActiveLayersAtPlayhead();
        return activeLayers.find(l => l && l.type === 'camera') || (currentProjectState.layers || []).find(l => l && l.type === 'camera' && !l.hidden) || null;
      }
      window.getActiveCameraLayer = getActiveCameraLayer;

      function isLayerPixelTransparent(layer, canvasX, canvasY) {
        if (!layer || layer.type !== 'image' || !layer._canvasBounds) return false;
        const media = window.layerMediaCache && window.layerMediaCache.get(layer.type === 'video' ? layer.id : (layer.mediaId || layer.id));
        const img = media && media.el;
        if (!img || img.tagName !== 'IMG' || !img.complete || !img.naturalWidth || !img.naturalHeight) return false;

        const b = layer._canvasBounds;
        const engine = window.FishToolEngine || window.LayerTransform;
        if (!engine || !engine.hitTest(b, canvasX, canvasY)) return false;

        try {
          if (!layer._alphaHitCanvas) {
            layer._alphaHitCanvas = document.createElement('canvas');
            layer._alphaHitCanvas.width = 1;
            layer._alphaHitCanvas.height = 1;
            layer._alphaHitCtx = layer._alphaHitCanvas.getContext('2d', { willReadFrequently: true });
          }
          const hctx = layer._alphaHitCtx;
          if (!hctx) return false;

          let lx = canvasX - b.cx;
          let ly = canvasY - b.cy;
          const rot = b.rotation || 0;
          if (rot) {
            const rad = -(rot * Math.PI) / 180;
            const rx = lx * Math.cos(rad) - ly * Math.sin(rad);
            const ry = lx * Math.sin(rad) + ly * Math.cos(rad);
            lx = rx; ly = ry;
          }
          const sx = b.skewX || 0;
          const sy = b.skewY || 0;
          if (sx || sy) {
            const tanX = Math.tan((sx * Math.PI) / 180);
            const tanY = Math.tan((sy * Math.PI) / 180);
            const det = 1 - tanX * tanY;
            if (Math.abs(det) > 1e-6) {
              const ix = (lx - tanX * ly) / det;
              const iy = (-tanY * lx + ly) / det;
              lx = ix; ly = iy;
            }
          }
          const bw = b.w || 1;
          const bh = b.h || 1;
          const u = (lx / bw) + 0.5;
          const v = (ly / bh) + 0.5;
          if (u < 0 || u > 1 || v < 0 || v > 1) return true;

          const imgX = Math.min(img.naturalWidth - 1, Math.max(0, Math.floor(u * img.naturalWidth)));
          const imgY = Math.min(img.naturalHeight - 1, Math.max(0, Math.floor(v * img.naturalHeight)));

          hctx.clearRect(0, 0, 1, 1);
          hctx.drawImage(img, imgX, imgY, 1, 1, 0, 0, 1, 1);
          const pixel = hctx.getImageData(0, 0, 1, 1).data;
          return pixel[3] <= 5;
        } catch (_) {
          return false;
        }
      }

      // Dynamic Hover Cursor Feedback
      activeCanvasEl.addEventListener('pointermove', (e) => {
        if (activeOp) return;
        if (window.isTimelinePlaying) {
          activeCanvasEl.style.cursor = 'default';
          return;
        }

        const coords = getCanvasBufferCoords(e);
        const layers = currentProjectState.layers || [];
        const selectedLayer = layers.find(l => l.id === window.selectedLayerId);
        const isAnchorMode = typeof window.isAnchorMode === 'function' ? window.isAnchorMode() : (window.moveAnchorSubmode === 'anchor');
        const isMultiSelect = !!(window.selectedLayerIds && window.selectedLayerIds.size > 1);

        if (!isMultiSelect && selectedLayer && selectedLayer._canvasBounds && window.CanvasWireframe) {
          const b = selectedLayer._canvasBounds;
          const hitTolerance = Math.max(12, Math.round(12 * coords.dprScale));

          if (window.currentDrawerSubview === 'vector' && selectedLayer.type === 'shape' && selectedLayer.shapeType === 'vector' && window.CanvasOverlay && typeof window.CanvasOverlay.hitTestVectorOverlay === 'function') {
            const vecHit = window.CanvasOverlay.hitTestVectorOverlay(selectedLayer, coords.x, coords.y, Math.max(14, hitTolerance));
            if (vecHit) {
              activeCanvasEl.style.cursor = vecHit.cursor || 'pointer';
              return;
            }
          }

          if (window.CanvasOverlay && typeof window.CanvasOverlay.hitTestRoundnessHandle === 'function') {
            const roundHit = window.CanvasOverlay.hitTestRoundnessHandle(selectedLayer, coords.x, coords.y, Math.max(13, hitTolerance));
            if (roundHit) {
              activeCanvasEl.style.cursor = roundHit.cursor || 'nwse-resize';
              return;
            }
          }

          const h = window.CanvasWireframe.hitTestHandle(b, coords.x, coords.y, hitTolerance, isAnchorMode);
          if (h && (h.type !== 'anchor' || isAnchorMode)) {
            activeCanvasEl.style.cursor = (h.type === 'anchor') ? 'crosshair' : (h.cursor || 'pointer');
            return;
          }
          if (selectedLayer.type !== 'camera' && window.CanvasWireframe.hitTest(b, coords.x, coords.y) &&
              !(selectedLayer.type === 'image' && !selectedLayer.hidden && isLayerPixelTransparent(selectedLayer, coords.x, coords.y))) {
            activeCanvasEl.style.cursor = isAnchorMode ? 'crosshair' : 'move';
            return;
          }
        } else if (isMultiSelect && window.selectedLayerIds) {
          for (const id of window.selectedLayerIds) {
            const l = layers.find(layer => layer.id === id);
            if (l && l._canvasBounds && l.type !== 'camera' && l.type !== 'audio' && window.CanvasWireframe && window.CanvasWireframe.hitTest(l._canvasBounds, coords.x, coords.y) &&
                !(l.type === 'image' && !l.hidden && isLayerPixelTransparent(l, coords.x, coords.y))) {
              activeCanvasEl.style.cursor = 'move';
              return;
            }
          }
        }

        const activeLayers = getActiveLayersAtPlayhead().filter(l => l.type !== 'camera' && l.type !== 'audio');
        for (let i = 0; i < activeLayers.length; i++) {
          const l = activeLayers[i];
          if (l._canvasBounds && window.CanvasWireframe && window.CanvasWireframe.hitTest(l._canvasBounds, coords.x, coords.y) &&
              !(l.type === 'image' && isLayerPixelTransparent(l, coords.x, coords.y))) {
            activeCanvasEl.style.cursor = 'pointer';
            return;
          }
        }

        activeCanvasEl.style.cursor = 'default';
      });

      // Double-click on canvas to enter Vector or Shape editing mode directly
      activeCanvasEl.addEventListener('dblclick', (e) => {
        if (window.isTimelinePlaying) return;
        const layers = currentProjectState.layers || [];
        const selectedLayer = layers.find(l => l.id === window.selectedLayerId);
        if (!selectedLayer || selectedLayer.hidden || selectedLayer.locked) return;
        if (selectedLayer.type === 'shape' && selectedLayer.shapeType === 'vector') {
          if (window.currentDrawerSubview !== 'vector' && typeof window.switchLayerDrawerSubview === 'function') {
            window.switchLayerDrawerSubview('vector');
          }
        } else if (selectedLayer.type === 'shape') {
          if (window.currentDrawerSubview !== 'shape' && typeof window.switchLayerDrawerSubview === 'function') {
            window.switchLayerDrawerSubview('shape');
          }
        }
      });

      // Pointerdown: Start Move, Scale, Vector Edit, Roundness, or Layer Selection
      activeCanvasEl.addEventListener('pointerdown', (e) => {
        if (window.isTimelinePlaying) return;
        if (e.button !== 0) return; // Primary click only
        if (window.isCanvasViewportPinching || (window.canvasGestureEndTime && Date.now() - window.canvasGestureEndTime < 300)) return;

        const coords = getCanvasBufferCoords(e);
        const layers = currentProjectState.layers || [];
        const selectedLayer = layers.find(l => l.id === window.selectedLayerId);

        const isAnchorMode = typeof window.isAnchorMode === 'function' ? window.isAnchorMode() : (window.moveAnchorSubmode === 'anchor');
        const isMultiSelect = !!(window.selectedLayerIds && window.selectedLayerIds.size > 1);

        // A0. If in Vector Edit Subview, handle direct Vector Points / Bezier Curve Handles / Segments / New Point on Canvas
        if (!isMultiSelect && window.currentDrawerSubview === 'vector' && selectedLayer && selectedLayer.type === 'shape' && selectedLayer.shapeType === 'vector' && window.CanvasOverlay && typeof window.CanvasOverlay.hitTestVectorOverlay === 'function') {
          const hitTolerance = Math.max(14, Math.round(14 * coords.dprScale));
          const vecHit = window.CanvasOverlay.hitTestVectorOverlay(selectedLayer, coords.x, coords.y, hitTolerance);
          if (vecHit) {
            if (!selectedLayer.shapeProps) selectedLayer.shapeProps = {};
            if (!Array.isArray(selectedLayer.shapeProps.points)) selectedLayer.shapeProps.points = [];
            const pts = selectedLayer.shapeProps.points;
            const vt = window.CanvasOverlay.getVectorTransform(selectedLayer, activeCanvasEl.width, activeCanvasEl.height);
            if (vt) {
              const startLocal = vt.toLocal(coords.x, coords.y);
              const vState = window._vectorEditorState || (window._vectorEditorState = { target: 'new', scrubberPos: 0, tool: 'point', curveSubMode: 'both', cursorX: 0, cursorY: 0, isDraggingPad: false, isScrubbing: false });
              vState.isDraggingPad = true;
              window.isTransformInteracting = true;

              activeOp = vecHit.type;
              window._activeCanvasOp = activeOp;
              activeHandleType = vecHit.type;
              targetLayer = selectedLayer;
              startPointer = { x: coords.x, y: coords.y };
              hasMoved = false;

              if (vecHit.type === 'vector-handle-out' || vecHit.type === 'vector-handle-in') {
                const pointIndex = vecHit.pointIndex;
                vState.target = pointIndex;
                vState.scrubberPos = pointIndex;
                const pt = pts[pointIndex] || { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 };
                startLayerState = {
                  vt,
                  startLocal,
                  pointIndex,
                  initX: Number(pt.x) || 0,
                  initY: Number(pt.y) || 0,
                  initInX: Number(pt.inX) || 0,
                  initInY: Number(pt.inY) || 0,
                  initOutX: Number(pt.outX) || 0,
                  initOutY: Number(pt.outY) || 0
                };
                if (typeof window.syncVectorControllerUI === 'function') window.syncVectorControllerUI();
              } else if (vecHit.type === 'vector-point') {
                const pointIndex = vecHit.pointIndex;
                const wasAlreadySelected = (vState.target === pointIndex);
                vState.target = pointIndex;
                vState.scrubberPos = pointIndex;
                const pt = pts[pointIndex] || { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 };
                let didAutoRoundOnSelect = false;
                if (vState.tool === 'curve' && typeof window.ensureVectorPointAutoCurve === 'function') {
                  didAutoRoundOnSelect = window.ensureVectorPointAutoCurve(pts, pointIndex, !!selectedLayer.shapeProps.closed);
                  if (didAutoRoundOnSelect && typeof window.commitVectorChange === 'function') {
                    window.commitVectorChange(selectedLayer, false);
                  }
                }
                startLayerState = {
                  vt,
                  startLocal,
                  pointIndex,
                  wasAlreadySelected,
                  didAutoRoundOnSelect,
                  initX: Number(pt.x) || 0,
                  initY: Number(pt.y) || 0,
                  initInX: Number(pt.inX) || 0,
                  initInY: Number(pt.inY) || 0,
                  initOutX: Number(pt.outX) || 0,
                  initOutY: Number(pt.outY) || 0
                };
                if (typeof window.syncVectorControllerUI === 'function') window.syncVectorControllerUI();
              } else if (vecHit.type === 'vector-seg-mid' || vecHit.type === 'vector-segment') {
                const p0 = pts[vecHit.segStart];
                const p1 = pts[vecHit.segEnd];
                startLayerState = {
                  vt,
                  startLocal,
                  segStart: vecHit.segStart,
                  segEnd: vecHit.segEnd,
                  t: vecHit.t,
                  insertedPointIndex: null,
                  p0InitOutX: Number(p0 && p0.outX) || 0,
                  p0InitOutY: Number(p0 && p0.outY) || 0,
                  p1InitInX: Number(p1 && p1.inX) || 0,
                  p1InitInY: Number(p1 && p1.inY) || 0
                };
              } else if (vecHit.type === 'vector-new-point') {
                vState.cursorX = Math.round(startLocal.x);
                vState.cursorY = Math.round(startLocal.y);
                startLayerState = {
                  vt,
                  startLocal,
                  newPointIndex: null
                };
                if (typeof window.syncVectorControllerUI === 'function') window.syncVectorControllerUI();
              }

              activeCanvasEl.setPointerCapture(e.pointerId);
              activeCanvasEl.style.cursor = vecHit.cursor || 'pointer';
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }
        }

        // A. If single layer selected, check Roundness handle or Scale handle click first
        if (!isMultiSelect && selectedLayer && selectedLayer._canvasBounds && window.CanvasWireframe) {
          const b = selectedLayer._canvasBounds;
          const hitTolerance = Math.max(12, Math.round(12 * coords.dprScale));

          if (window.CanvasOverlay && typeof window.CanvasOverlay.hitTestRoundnessHandle === 'function') {
            const roundHit = window.CanvasOverlay.hitTestRoundnessHandle(selectedLayer, coords.x, coords.y, Math.max(13, hitTolerance));
            if (roundHit) {
              window.isTransformInteracting = true;
              syncLayerWithEffectiveProps(selectedLayer);

              activeOp = 'roundness';
              window._activeCanvasOp = 'roundness';
              activeHandleType = 'roundness';
              targetLayer = selectedLayer;
              startPointer = { x: coords.x, y: coords.y };
              startBounds = { ...b };
              hasMoved = false;
              startLayerState = { ...roundHit };

              activeCanvasEl.setPointerCapture(e.pointerId);
              activeCanvasEl.style.cursor = roundHit.cursor || 'nwse-resize';
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }

          const hitH = window.CanvasWireframe.hitTestHandle(b, coords.x, coords.y, hitTolerance, isAnchorMode);

          if (hitH && hitH.type !== 'anchor') {
            if (selectedLayer.expressions && selectedLayer.expressions.scale) {
              return; // Scale controlled by expression
            }
            if (selectedLayer.type === 'camera') {
              window.isTransformInteracting = true;
              syncLayerWithEffectiveProps(selectedLayer);

              activeOp = 'scale';
              activeHandleType = hitH.type;
              targetLayer = selectedLayer;
              startPointer = { x: coords.x, y: coords.y };
              startBounds = { ...b };
              hasMoved = false;

              startLayerState = {
                cameraZoom: selectedLayer.cameraZoom !== undefined ? selectedLayer.cameraZoom : 100
              };

              activeCanvasEl.setPointerCapture(e.pointerId);
              activeCanvasEl.style.cursor = hitH.cursor;
              e.preventDefault();
              e.stopPropagation();
              return;
            }

            window.isTransformInteracting = true;
            syncLayerWithEffectiveProps(selectedLayer);

            activeOp = 'scale';
            activeHandleType = hitH.type;
            targetLayer = selectedLayer;
            startPointer = { x: coords.x, y: coords.y };
            startBounds = { ...b };
            hasMoved = false;

            const aspect = currentProjectState.aspectRatio || '16:9';
            const res = currentProjectState.resolution || '1080p';
            const baseDims = window.getProjectDimensions(res, aspect);
            const baseW = baseDims[0];
            const baseH = baseDims[1];
            const bufferScale = activeCanvasEl.width / baseW;

            const layerPosX = selectedLayer.posX !== undefined ? selectedLayer.posX : ((selectedLayer.normX + selectedLayer.normW / 2) * baseW);
            const layerPosY = selectedLayer.posY !== undefined ? selectedLayer.posY : ((selectedLayer.normY + selectedLayer.normH / 2) * baseH);
            const layerScaleW = selectedLayer.scaleW !== undefined ? selectedLayer.scaleW : (selectedLayer.normW * baseW);
            const layerScaleH = selectedLayer.scaleH !== undefined ? selectedLayer.scaleH : (selectedLayer.normH * baseH);

            const activeCam = getActiveLayersAtPlayhead().find(l => l.type === 'camera' && !l.hidden);
            const curPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
            const curPlayheadSec = Math.abs(curPanX) / 80;
            const camEff = activeCam ? ((typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(activeCam, curPlayheadSec) : activeCam) : null;

            const engine = window.FishToolEngine || window.LayerTransform;
            const transformParams = {
              cx: layerPosX * bufferScale,
              cy: layerPosY * bufferScale,
              posZ: (selectedLayer.posZ || 0) * bufferScale,
              rotX: selectedLayer.rotX || 0,
              rotY: selectedLayer.rotY || 0,
              rotZ: selectedLayer.rotZ !== undefined ? selectedLayer.rotZ : (selectedLayer.rotation || 0),
              skewX: selectedLayer.skewX || 0,
              skewY: selectedLayer.skewY || 0,
              signX: Math.sign(layerScaleW) || 1,
              signY: Math.sign(layerScaleH) || 1,
              perspective: 1000 * bufferScale,
              bufferScale,
              camera: camEff,
              vw: activeCanvasEl.width,
              vh: activeCanvasEl.height
            };

            const pCenter = engine ? engine.projectPoint(0, 0, 0, transformParams) : { x: transformParams.cx, y: transformParams.cy };
            const pX = engine ? engine.projectPoint(50, 0, 0, transformParams) : { x: transformParams.cx + 50, y: transformParams.cy };
            const pY = engine ? engine.projectPoint(0, 50, 0, transformParams) : { x: transformParams.cx, y: transformParams.cy + 50 };

            const axisX = { x: pX.x - pCenter.x, y: pX.y - pCenter.y };
            const axisY = { x: pY.x - pCenter.x, y: pY.y - pCenter.y };
            const lenSqX = axisX.x * axisX.x + axisX.y * axisX.y || 1;
            const lenSqY = axisY.x * axisY.x + axisY.y * axisY.y || 1;

            startLayerState = {
              posX: layerPosX,
              posY: layerPosY,
              scaleW: layerScaleW,
              scaleH: layerScaleH,
              baseW,
              baseH,
              bufferScale,
              transformParams,
              axisX,
              axisY,
              lenSqX,
              lenSqY
            };

            activeCanvasEl.setPointerCapture(e.pointerId);
            activeCanvasEl.style.cursor = hitH.cursor;
            e.preventDefault();
            e.stopPropagation();
            return;
          }

          // B. Check if clicking inside selected layer bounding box or center anchor (moving)
          const isAnchorHit = isAnchorMode && (hitH?.type === 'anchor');
          const isBodyHit = selectedLayer.type !== 'camera' &&
                            window.CanvasWireframe.hitTest(b, coords.x, coords.y) &&
                            !(selectedLayer.type === 'image' && !selectedLayer.hidden && isLayerPixelTransparent(selectedLayer, coords.x, coords.y));
          if (isAnchorHit || (isAnchorMode && isBodyHit) || isBodyHit) {
            const isMoveAnchor = isAnchorMode;
            if (selectedLayer.expressions && (selectedLayer.expressions.move || (isMoveAnchor && selectedLayer.expressions.anchor))) {
              return; // Position/Anchor controlled by expression
            }
            window.isTransformInteracting = true;
            syncLayerWithEffectiveProps(selectedLayer);

            activeOp = isMoveAnchor ? 'moveAnchor' : 'move';
            activeHandleType = isMoveAnchor ? 'anchor' : 'move';
            targetLayer = selectedLayer;
            startPointer = { x: coords.x, y: coords.y };
            startBounds = { ...b };
            hasMoved = false;

            const aspect = currentProjectState.aspectRatio || '16:9';
            const res = currentProjectState.resolution || '1080p';
            const baseDims = window.getProjectDimensions(res, aspect);
            const baseW = baseDims[0];
            const baseH = baseDims[1];

            const layerPosX = selectedLayer.posX !== undefined ? selectedLayer.posX : ((selectedLayer.normX + (selectedLayer.normW || 0.2) / 2) * baseW);
            const layerPosY = selectedLayer.posY !== undefined ? selectedLayer.posY : ((selectedLayer.normY + (selectedLayer.normH || 0.2) / 2) * baseH);

            startLayerState = {
              posX: layerPosX,
              posY: layerPosY,
              posZ: selectedLayer.posZ || 0,
              anchorX: selectedLayer.anchorX || 0,
              anchorY: selectedLayer.anchorY || 0,
              anchorZ: selectedLayer.anchorZ || 0,
              baseW,
              baseH
            };

            activeCanvasEl.setPointerCapture(e.pointerId);
            activeCanvasEl.style.cursor = isMoveAnchor ? 'crosshair' : 'move';
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }

        // C. Check other active layers (from topmost to bottom)
        const activeLayers = getActiveLayersAtPlayhead().filter(l => l.type !== 'camera' && l.type !== 'audio');
        for (let i = 0; i < activeLayers.length; i++) {
          const l = activeLayers[i];
          const b = l._canvasBounds;
          if (b && window.CanvasWireframe && window.CanvasWireframe.hitTest(b, coords.x, coords.y) &&
              !(l.type === 'image' && isLayerPixelTransparent(l, coords.x, coords.y))) {
            if (typeof window.selectTimelineLayer === 'function') {
              window.selectTimelineLayer(l.id);
            }
            window.isTransformInteracting = true;
            syncLayerWithEffectiveProps(l);

            activeOp = 'move';
            activeHandleType = 'move';
            targetLayer = l;
            startPointer = { x: coords.x, y: coords.y };
            startBounds = { ...b };
            hasMoved = false;

            const aspect = currentProjectState.aspectRatio || '16:9';
            const res = currentProjectState.resolution || '1080p';
            const baseDims = window.getProjectDimensions(res, aspect);
            const baseW = baseDims[0];
            const baseH = baseDims[1];

            const layerPosX = l.posX !== undefined ? l.posX : ((l.normX + (l.normW || 0.2) / 2) * baseW);
            const layerPosY = l.posY !== undefined ? l.posY : ((l.normY + (l.normH || 0.2) / 2) * baseH);

            startLayerState = {
              posX: layerPosX,
              posY: layerPosY,
              baseW,
              baseH
            };

            activeCanvasEl.setPointerCapture(e.pointerId);
            activeCanvasEl.style.cursor = 'move';
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }

        // D. If Camera layer is selected and user clicked/dragged on canvas: Start Moving Camera!
        if (selectedLayer && selectedLayer.type === 'camera') {
          window.isTransformInteracting = true;
          syncLayerWithEffectiveProps(selectedLayer);

          activeOp = 'move';
          activeHandleType = 'move';
          targetLayer = selectedLayer;
          startPointer = { x: coords.x, y: coords.y };
          startBounds = { ...(selectedLayer._canvasBounds || {}) };
          hasMoved = false;

          const aspect = currentProjectState.aspectRatio || '16:9';
          const res = currentProjectState.resolution || '1080p';
          const baseDims = window.getProjectDimensions(res, aspect);
          const baseW = baseDims[0];
          const baseH = baseDims[1];

          startLayerState = {
            posX: selectedLayer.posX || 0,
            posY: selectedLayer.posY || 0,
            posZ: selectedLayer.posZ || 0,
            baseW,
            baseH
          };

          activeCanvasEl.setPointerCapture(e.pointerId);
          activeCanvasEl.style.cursor = 'move';
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        // E. Click on empty background: keep layer selected per user rule
        // Drag on empty background: Rectangle Lasso (Canvas Marquee Selection)
        if (e.button === 0) {
          const startLassoClientX = e.clientX;
          const startLassoClientY = e.clientY;
          let isCanvasMarquee = false;
          let canvasMarqueeBox = document.querySelector('.canvas-marquee-box');
          if (!canvasMarqueeBox) {
            canvasMarqueeBox = document.createElement('div');
            canvasMarqueeBox.className = 'canvas-marquee-box';
            document.body.appendChild(canvasMarqueeBox);
          } else if (canvasMarqueeBox.parentNode !== document.body) {
            document.body.appendChild(canvasMarqueeBox);
          }

          function onCanvasMarqueeMove(moveEvent) {
            const dx = moveEvent.clientX - startLassoClientX;
            const dy = moveEvent.clientY - startLassoClientY;
            const dist = Math.hypot(dx, dy);

            if (!isCanvasMarquee && dist > 5) {
              isCanvasMarquee = true;
              canvasMarqueeBox.style.display = 'block';
            }

            if (isCanvasMarquee) {
              moveEvent.preventDefault();
              const cRect = activeCanvasEl.getBoundingClientRect();
              const clampedX = Math.max(cRect.left, Math.min(cRect.right, moveEvent.clientX));
              const clampedY = Math.max(cRect.top, Math.min(cRect.bottom, moveEvent.clientY));

              const boxL = Math.max(cRect.left, Math.min(startLassoClientX, clampedX));
              const boxT = Math.max(cRect.top, Math.min(startLassoClientY, clampedY));
              const boxR = Math.min(cRect.right, Math.max(startLassoClientX, clampedX));
              const boxB = Math.min(cRect.bottom, Math.max(startLassoClientY, clampedY));

              canvasMarqueeBox.style.left = `${boxL}px`;
              canvasMarqueeBox.style.top = `${boxT}px`;
              canvasMarqueeBox.style.width = `${Math.max(0, boxR - boxL)}px`;
              canvasMarqueeBox.style.height = `${Math.max(0, boxB - boxT)}px`;
            }
          }

          function onCanvasMarqueeUp(upEvent) {
            window.removeEventListener('pointermove', onCanvasMarqueeMove, true);
            window.removeEventListener('pointerup', onCanvasMarqueeUp, true);
            window.removeEventListener('pointercancel', onCanvasMarqueeUp, true);

            if (isCanvasMarquee) {
              isCanvasMarquee = false;
              canvasMarqueeBox.style.display = 'none';

              const cRect = activeCanvasEl.getBoundingClientRect();
              const clampedX = Math.max(cRect.left, Math.min(cRect.right, upEvent.clientX));
              const clampedY = Math.max(cRect.top, Math.min(cRect.bottom, upEvent.clientY));

              const boxL = Math.max(cRect.left, Math.min(startLassoClientX, clampedX));
              const boxT = Math.max(cRect.top, Math.min(startLassoClientY, clampedY));
              const boxR = Math.min(cRect.right, Math.max(startLassoClientX, clampedX));
              const boxB = Math.min(cRect.bottom, Math.max(startLassoClientY, clampedY));

              // Map screen rect to buffer rect
              const scaleX = activeCanvasEl.width / cRect.width;
              const scaleY = activeCanvasEl.height / cRect.height;
              const bufferRect = {
                left: (boxL - cRect.left) * scaleX,
                top: (boxT - cRect.top) * scaleY,
                right: (boxR - cRect.left) * scaleX,
                bottom: (boxB - cRect.top) * scaleY
              };

              const allLayers = currentProjectState.layers || [];
              const matchedLayerIds = [];
              allLayers.forEach(l => {
                if (l.hidden || l.locked) return;
                const b = l._canvasBounds;
                if (!b) return;
                const intersects = !(
                  b.x + b.w < bufferRect.left ||
                  b.x > bufferRect.right ||
                  b.y + b.h < bufferRect.top ||
                  b.y > bufferRect.bottom
                );
                if (intersects) {
                  matchedLayerIds.push(l.id);
                }
              });

              const isAdditive = !!(upEvent.shiftKey || upEvent.metaKey || upEvent.ctrlKey);
              if (matchedLayerIds.length > 0) {
                if (isAdditive && window.selectedLayerIds && window.selectedLayerIds.size > 0) {
                  const combined = new Set(window.selectedLayerIds);
                  matchedLayerIds.forEach(id => combined.add(id));
                  if (typeof window.setDesktopSelectedLayers === 'function') {
                    window.setDesktopSelectedLayers(combined, matchedLayerIds[0]);
                  } else if (typeof window.selectTimelineLayers === 'function') {
                    window.selectTimelineLayers(Array.from(combined), matchedLayerIds[0]);
                  }
                } else {
                  if (typeof window.setDesktopSelectedLayers === 'function') {
                    window.setDesktopSelectedLayers(new Set(matchedLayerIds), matchedLayerIds[0]);
                  } else if (typeof window.selectTimelineLayers === 'function') {
                    window.selectTimelineLayers(matchedLayerIds, matchedLayerIds[0]);
                  } else if (typeof window.selectTimelineLayer === 'function') {
                    window.selectTimelineLayer(matchedLayerIds[0]);
                  }
                }
              } else if (!isAdditive) {
                if (typeof window.deselectAllDesktopLayers === 'function') {
                  window.deselectAllDesktopLayers();
                } else if (typeof window.deselectTimelineLayer === 'function') {
                  window.deselectTimelineLayer();
                } else if (typeof deselectTimelineLayer === 'function') {
                  deselectTimelineLayer();
                }
              }
            } else {
              // Clicked empty background without dragging
              const isAdditive = !!(upEvent.shiftKey || upEvent.metaKey || upEvent.ctrlKey);
              if (!isAdditive) {
                if (typeof window.deselectAllDesktopLayers === 'function') {
                  window.deselectAllDesktopLayers();
                } else if (typeof window.deselectTimelineLayer === 'function') {
                  window.deselectTimelineLayer();
                } else if (typeof deselectTimelineLayer === 'function') {
                  deselectTimelineLayer();
                }
              }
            }
          }

          window.addEventListener('pointermove', onCanvasMarqueeMove, true);
          window.addEventListener('pointerup', onCanvasMarqueeUp, true);
          window.addEventListener('pointercancel', onCanvasMarqueeUp, true);
        }
      });

      function requestCanvasRedraw() {
        redrawComposition('canvasTransformDrag');
      }
      function flushCanvasRedraw() {
        redrawComposition('canvasTransformFlush', true);
      }
      window.requestCanvasRedraw = requestCanvasRedraw;
      window.flushCanvasRedraw = flushCanvasRedraw;

      // Pointermove: Execute Live Drag / Scale with requestAnimationFrame Throttling
      window.addEventListener('pointermove', (e) => {
        if (!activeOp || !targetLayer || window.isCanvasViewportPinching) return;
        const coords = getCanvasBufferCoords(e);
        const deltaX = coords.x - startPointer.x;
        const deltaY = coords.y - startPointer.y;

        if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
          hasMoved = true;
        }

        const cw = activeCanvasEl.width;
        const ch = activeCanvasEl.height;

        const aspect = currentProjectState.aspectRatio || '16:9';
        const res = currentProjectState.resolution || '1080p';
        const baseDims = window.getProjectDimensions(res, aspect);
        const baseW = baseDims[0];
        const baseH = baseDims[1];

        if (activeOp === 'moveAnchor' && targetLayer) {
          const deltaCanvasX = coords.x - startPointer.x;
          const deltaCanvasY = coords.y - startPointer.y;
          const bufferScaleX = cw / baseW;
          const bufferScaleY = ch / baseH;

          const startAx = startLayerState ? startLayerState.anchorX : (targetLayer.anchorX || 0);
          const startAy = startLayerState ? startLayerState.anchorY : (targetLayer.anchorY || 0);

          const dWorldX = deltaCanvasX / bufferScaleX;
          const dWorldY = deltaCanvasY / bufferScaleY;

          // Convert world delta to local orientation
          const rad = -((targetLayer.rotZ || 0) * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const dLocX = dWorldX * cos - dWorldY * sin;
          const dLocY = dWorldX * sin + dWorldY * cos;

          let newAnchorX = startAx + dLocX;
          let newAnchorY = startAy + dLocY;

          // Snap to Grid when Grid Overlay is active
          const gridBtn = document.getElementById('editor-icon-grid');
          const isGridOn = gridBtn && gridBtn.classList.contains('is-active');
          let snapGuideX = null;
          let snapGuideY = null;

          if (isGridOn) {
            const targetsX = [0, baseW * 0.25, baseW * 0.5, baseW * 0.75, baseW];
            const targetsY = [0, baseH * 0.25, baseH * 0.5, baseH * 0.75, baseH];
            const tolX = 14 / bufferScaleX;
            const tolY = 14 / bufferScaleY;

            const layerCenterX = targetLayer.posX !== undefined ? targetLayer.posX : baseW / 2;
            const layerCenterY = targetLayer.posY !== undefined ? targetLayer.posY : baseH / 2;

            const curAncWorldX = layerCenterX + newAnchorX;
            const curAncWorldY = layerCenterY + newAnchorY;

            const sCX = findSnapTarget(curAncWorldX, targetsX, tolX);
            if (sCX !== null) {
              newAnchorX = sCX - layerCenterX;
              snapGuideX = sCX;
            } else {
              const sOriginX = findSnapTarget(curAncWorldX, [layerCenterX], tolX);
              if (sOriginX !== null) {
                newAnchorX = 0;
                snapGuideX = layerCenterX;
              }
            }

            const sCY = findSnapTarget(curAncWorldY, targetsY, tolY);
            if (sCY !== null) {
              newAnchorY = sCY - layerCenterY;
              snapGuideY = sCY;
            } else {
              const sOriginY = findSnapTarget(curAncWorldY, [layerCenterY], tolY);
              if (sOriginY !== null) {
                newAnchorY = 0;
                snapGuideY = layerCenterY;
              }
            }
          }

          window.activeSnapGuides = { x: snapGuideX, y: snapGuideY };

          targetLayer.anchorX = Number(newAnchorX.toFixed(2));
          targetLayer.anchorY = Number(newAnchorY.toFixed(2));

          if (typeof recordLayerPropertyChange === 'function') recordLayerPropertyChange(targetLayer, 'move');
          if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
          requestCanvasRedraw();
        } else if (activeOp === 'move' && targetLayer) {
          const deltaCanvasX = coords.x - startPointer.x;
          const deltaCanvasY = coords.y - startPointer.y;
          const bufferScaleX = cw / baseW;
          const bufferScaleY = ch / baseH;

          if (targetLayer.type === 'camera') {
            const startX = startLayerState ? startLayerState.posX : (targetLayer.posX || 0);
            const startY = startLayerState ? startLayerState.posY : (targetLayer.posY || 0);

            // Natural camera pan: dragging canvas moves camera position
            const newPosX = startX - deltaCanvasX / bufferScaleX;
            const newPosY = startY - deltaCanvasY / bufferScaleY;

            targetLayer.posX = Number(newPosX.toFixed(2));
            targetLayer.posY = Number(newPosY.toFixed(2));

            if (typeof recordLayerPropertyChange === 'function') recordLayerPropertyChange(targetLayer, 'move');
            if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
            requestCanvasRedraw();
            return;
          }

          const startX = startLayerState ? startLayerState.posX : (targetLayer.posX || 0);
          const startY = startLayerState ? startLayerState.posY : (targetLayer.posY || 0);

          let newPosX = startX + deltaCanvasX / bufferScaleX;
          let newPosY = startY + deltaCanvasY / bufferScaleY;

          const curScaleW = targetLayer.scaleW !== undefined ? targetLayer.scaleW : ((targetLayer.normW || 0.2) * baseW);
          const curScaleH = targetLayer.scaleH !== undefined ? targetLayer.scaleH : ((targetLayer.normH || 0.2) * baseH);
          const halfW = Math.abs(curScaleW) / 2;
          const halfH = Math.abs(curScaleH) / 2;

          // Snap to Grid when Grid Overlay is active
          const gridBtn = document.getElementById('editor-icon-grid');
          const isGridOn = gridBtn && gridBtn.classList.contains('is-active');
          let snapGuideX = null;
          let snapGuideY = null;

          if (isGridOn) {
            const targetsX = [0, baseW * 0.25, baseW * 0.5, baseW * 0.75, baseW];
            const targetsY = [0, baseH * 0.25, baseH * 0.5, baseH * 0.75, baseH];
            const tolX = 14 / bufferScaleX;
            const tolY = 14 / bufferScaleY;

            // Anchor point in world coordinates
            const anchorOffsetX = targetLayer.anchorX || 0;
            const anchorOffsetY = targetLayer.anchorY || 0;
            const curAnchorX = newPosX + anchorOffsetX;
            const curAnchorY = newPosY + anchorOffsetY;

            // Center X snapping: align anchor point to grid lines
            const sCX = findSnapTarget(curAnchorX, targetsX, tolX);
            if (sCX !== null) {
              newPosX = sCX - anchorOffsetX;
              snapGuideX = sCX;
            } else {
              const sLX = findSnapTarget(newPosX - halfW, targetsX, tolX);
              if (sLX !== null) {
                newPosX = sLX + halfW;
                snapGuideX = sLX;
              } else {
                const sRX = findSnapTarget(newPosX + halfW, targetsX, tolX);
                if (sRX !== null) {
                  newPosX = sRX - halfW;
                  snapGuideX = sRX;
                }
              }
            }

            // Center Y snapping: align anchor point to grid lines
            const sCY = findSnapTarget(curAnchorY, targetsY, tolY);
            if (sCY !== null) {
              newPosY = sCY - anchorOffsetY;
              snapGuideY = sCY;
            } else {
              const sTY = findSnapTarget(newPosY - halfH, targetsY, tolY);
              if (sTY !== null) {
                newPosY = sTY + halfH;
                snapGuideY = sTY;
              } else {
                const sBY = findSnapTarget(newPosY + halfH, targetsY, tolY);
                if (sBY !== null) {
                  newPosY = sBY - halfH;
                  snapGuideY = sBY;
                }
              }
            }
          }

          window.activeSnapGuides = { x: snapGuideX, y: snapGuideY };

          targetLayer.posX = Number(newPosX.toFixed(2));
          targetLayer.posY = Number(newPosY.toFixed(2));

          targetLayer.normX = (targetLayer.posX - halfW) / baseW;
          targetLayer.normY = (targetLayer.posY - halfH) / baseH;

          if (typeof recordLayerPropertyChange === 'function') recordLayerPropertyChange(targetLayer, 'move');
          if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
          requestCanvasRedraw();
        } else if (activeOp === 'scale' && startLayerState) {
          if (targetLayer && targetLayer.type === 'camera') {
            const initZoom = startLayerState.cameraZoom || 100;
            const distStart = Math.hypot(startPointer.x - cw / 2, startPointer.y - ch / 2) || 1;
            const distCur = Math.hypot(coords.x - cw / 2, coords.y - ch / 2);
            const zoomFactor = distCur / distStart;
            const newZoom = Math.max(10, Math.min(400, Math.round(initZoom * zoomFactor)));
            targetLayer.cameraZoom = newZoom;
            if (typeof recordLayerPropertyChange === 'function') recordLayerPropertyChange(targetLayer, 'cameraZoom');
            if (typeof syncCameraSettingsUI === 'function') syncCameraSettingsUI();
            requestCanvasRedraw();
            return;
          }

          if (!startLayerState.axisX || !startLayerState.axisY) return;

          let curCoordsX = coords.x;
          let curCoordsY = coords.y;

          // Snap to Grid when Grid Overlay is active
          const gridBtn = document.getElementById('editor-icon-grid');
          const isGridOn = gridBtn && gridBtn.classList.contains('is-active');
          let snapGuideX = null;
          let snapGuideY = null;

          if (isGridOn) {
            const canvasTargetsX = [0, cw * 0.25, cw * 0.5, cw * 0.75, cw];
            const canvasTargetsY = [0, ch * 0.25, ch * 0.5, ch * 0.75, ch];
            const tolPx = 14;

            const sX = findSnapTarget(curCoordsX, canvasTargetsX, tolPx);
            if (sX !== null) {
              curCoordsX = sX;
              snapGuideX = sX * (baseW / cw);
            }

            const sY = findSnapTarget(curCoordsY, canvasTargetsY, tolPx);
            if (sY !== null) {
              curCoordsY = sY;
              snapGuideY = sY * (baseH / ch);
            }
          }

          window.activeSnapGuides = { x: snapGuideX, y: snapGuideY };

          const deltaX = curCoordsX - startPointer.x;
          const deltaY = curCoordsY - startPointer.y;

          // Project delta onto local X and Y axes (in base project units)
          const projLocalX = ((deltaX * startLayerState.axisX.x + deltaY * startLayerState.axisX.y) / startLayerState.lenSqX) * 50 / startLayerState.bufferScale;
          const projLocalY = ((deltaX * startLayerState.axisY.x + deltaY * startLayerState.axisY.y) / startLayerState.lenSqY) * 50 / startLayerState.bufferScale;

          let factorX = 0;
          let factorY = 0;
          switch (activeHandleType) {
            case 'e':  factorX =  1; factorY =  0; break;
            case 'w':  factorX = -1; factorY =  0; break;
            case 's':  factorX =  0; factorY =  1; break;
            case 'n':  factorX =  0; factorY = -1; break;
            case 'se': factorX =  1; factorY =  1; break;
            case 'ne': factorX =  1; factorY = -1; break;
            case 'nw': factorX = -1; factorY = -1; break;
            case 'sw': factorX = -1; factorY =  1; break;
          }

          const deltaW = factorX !== 0 ? (projLocalX * factorX) : 0;
          const deltaH = factorY !== 0 ? (projLocalY * factorY) : 0;

          let newW = startLayerState.scaleW;
          let newH = startLayerState.scaleH;

          const isCenterScale = e.altKey;
          if (isCenterScale) {
            // Symmetrical expansion around center anchor
            if (factorX !== 0) newW = Math.max(10, startLayerState.scaleW + deltaW * 2);
            if (factorY !== 0) newH = Math.max(10, startLayerState.scaleH + deltaH * 2);
          } else {
            // Opposite edge remains pinned
            if (factorX !== 0) newW = Math.max(10, startLayerState.scaleW + deltaW);
            if (factorY !== 0) newH = Math.max(10, startLayerState.scaleH + deltaH);
          }

          // Shift key: lock aspect ratio
          if (e.shiftKey && factorX !== 0 && factorY !== 0 && startLayerState.scaleW > 0 && startLayerState.scaleH > 0) {
            const aspect = startLayerState.scaleW / startLayerState.scaleH;
            const ratioW = newW / startLayerState.scaleW;
            const ratioH = newH / startLayerState.scaleH;
            const chosenRatio = Math.max(ratioW, ratioH);
            newW = Math.max(10, startLayerState.scaleW * chosenRatio);
            newH = Math.max(10, startLayerState.scaleH * chosenRatio);
          }

          // Compute new center anchor position in world/base coordinates
          let newPosX = startLayerState.posX;
          let newPosY = startLayerState.posY;

          if (!isCenterScale) {
            // Center shifts along the local transformed axes so the opposite edge remains pinned
            let localShiftX = factorX * (newW - startLayerState.scaleW) / 2;
            let localShiftY = factorY * (newH - startLayerState.scaleH) / 2;
            if (targetLayer.type === 'shape' && targetLayer.shapeType === 'vector' && typeof window.getVectorLocalBounds === 'function') {
              const vBounds = window.getVectorLocalBounds(targetLayer.shapeProps || {});
              const dScaleX = (newW - startLayerState.scaleW) / Math.max(1, vBounds.width);
              const dScaleY = (newH - startLayerState.scaleH) / Math.max(1, vBounds.height);
              localShiftX = factorX > 0 ? (-vBounds.minX * dScaleX) : (factorX < 0 ? (-vBounds.maxX * dScaleX) : 0);
              localShiftY = factorY > 0 ? (-vBounds.minY * dScaleY) : (factorY < 0 ? (-vBounds.maxY * dScaleY) : 0);
            }

            const rotZ = targetLayer.rotZ !== undefined ? targetLayer.rotZ : (targetLayer.rotation || 0);
            const rotX = targetLayer.rotX || 0;
            const rotY = targetLayer.rotY || 0;
            const skewX = targetLayer.skewX || 0;
            const skewY = targetLayer.skewY || 0;

            if (!rotX && !rotY) {
              const radZ = (rotZ * Math.PI) / 180;
              const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);
              let sx = localShiftX, sy = localShiftY;
              if (skewX || skewY) {
                const tanX = Math.tan((skewX * Math.PI) / 180);
                const tanY = Math.tan((skewY * Math.PI) / 180);
                sx = localShiftX + tanX * localShiftY;
                sy = tanY * localShiftX + localShiftY;
              }
              const worldShiftX = sx * cosZ - sy * sinZ;
              const worldShiftY = sx * sinZ + sy * cosZ;
              newPosX = startLayerState.posX + worldShiftX;
              newPosY = startLayerState.posY + worldShiftY;
            } else {
              // 3D Euler shift
              const engine = window.FishToolEngine || window.LayerTransform;
              if (engine) {
                const pOrigin = engine.projectPoint(0, 0, 0, { ...startLayerState.transformParams, cx: 0, cy: 0 });
                const pTarget = engine.projectPoint(localShiftX, localShiftY, 0, { ...startLayerState.transformParams, cx: 0, cy: 0 });
                newPosX = startLayerState.posX + (pTarget.x - pOrigin.x) / startLayerState.bufferScale;
                newPosY = startLayerState.posY + (pTarget.y - pOrigin.y) / startLayerState.bufferScale;
              }
            }
          }

          targetLayer.scaleW = Number(newW.toFixed(1));
          targetLayer.scaleH = Number(newH.toFixed(1));
          targetLayer._userResized = true;
          targetLayer._userResizedManual = true;
          targetLayer.posX = Number(newPosX.toFixed(2));
          targetLayer.posY = Number(newPosY.toFixed(2));
          targetLayer.normW = targetLayer.scaleW / baseW;
          targetLayer.normH = targetLayer.scaleH / baseH;
          targetLayer.normX = (targetLayer.posX - targetLayer.scaleW / 2) / baseW;
          targetLayer.normY = (targetLayer.posY - targetLayer.scaleH / 2) / baseH;

          if (targetLayer.type === 'shape' && targetLayer.shapeType === 'vector') {
            const vBounds = (typeof window.getVectorLocalBounds === 'function')
              ? window.getVectorLocalBounds(targetLayer.shapeProps || {})
              : { width: 120, height: 120 };
            targetLayer.transformScaleX = Math.abs(targetLayer.scaleW) / Math.max(1, vBounds.width);
            targetLayer.transformScaleY = Math.abs(targetLayer.scaleH) / Math.max(1, vBounds.height);
          } else if (targetLayer.type === 'shape') {
            if (!targetLayer.shapeProps) targetLayer.shapeProps = {};
            targetLayer.shapeProps.sizeX = Math.round(Math.abs(targetLayer.scaleW));
            targetLayer.shapeProps.sizeY = Math.round(Math.abs(targetLayer.scaleH));
            targetLayer.mediaWidth = targetLayer.shapeProps.sizeX;
            targetLayer.mediaHeight = targetLayer.shapeProps.sizeY;
            targetLayer._shapeDirty = true;
            targetLayer._fillDirty = true;
            if (targetLayer._shapeBufferCanvas) targetLayer._shapeBufferCanvas._lastShapeKey = null;
            if (typeof syncShapeControllerUI === 'function') {
              syncShapeControllerUI();
            }
          } else if (targetLayer.type === 'text') {
            const nat = (window.FishTextEngine && window.FishTextEngine.getNaturalSize)
              ? window.FishTextEngine.getNaturalSize(targetLayer)
              : { width: 320, height: 100 };
            targetLayer.transformScaleX = Math.abs(targetLayer.scaleW) / Math.max(1, nat.width);
            targetLayer.transformScaleY = Math.abs(targetLayer.scaleH) / Math.max(1, nat.height);
          }

          if (typeof recordLayerPropertyChange === 'function') {
            recordLayerPropertyChange(targetLayer, 'scale');
            recordLayerPropertyChange(targetLayer, 'move');
          }
          if (typeof syncTransformControllerValues === 'function') syncTransformControllerValues();
          requestCanvasRedraw();
        } else if (activeOp === 'roundness' && targetLayer && startLayerState) {
          const projDeltaPx = deltaX * startLayerState.dirX + deltaY * startLayerState.dirY;
          const startRatio = startLayerState.curRound / Math.max(1, startLayerState.maxR);
          const newRatio = Math.max(0, Math.min(1, startRatio + (projDeltaPx / Math.max(1, startLayerState.travelSpanPx))));
          const newRound = Math.round(newRatio * startLayerState.maxR);
          if (typeof window.updateShapeOtherProp === 'function') {
            window.updateShapeOtherProp(targetLayer, 'roundness', newRound, false);
          } else {
            if (targetLayer.type === 'shape') {
              if (!targetLayer.shapeProps) targetLayer.shapeProps = {};
              targetLayer.shapeProps.roundness = newRound;
              targetLayer._shapeDirty = true;
              targetLayer._fillDirty = true;
            } else {
              targetLayer.roundness = newRound;
            }
            requestCanvasRedraw();
          }
          if (typeof window.syncShapeControllerUI === 'function') window.syncShapeControllerUI();
        } else if ((activeOp === 'vector-handle-out' || activeOp === 'vector-handle-in') && targetLayer && startLayerState && startLayerState.vt) {
          const curLocal = startLayerState.vt.toLocal(coords.x, coords.y);
          const dLocalX = curLocal.x - startLayerState.startLocal.x;
          const dLocalY = curLocal.y - startLayerState.startLocal.y;
          const pts = (targetLayer.shapeProps && Array.isArray(targetLayer.shapeProps.points)) ? targetLayer.shapeProps.points : [];
          const pt = pts[startLayerState.pointIndex];
          const vState = window._vectorEditorState;
          if (pt) {
            if (activeOp === 'vector-handle-out') {
              pt.outX = Math.round(startLayerState.initOutX + dLocalX);
              pt.outY = Math.round(startLayerState.initOutY + dLocalY);
              if (!e.altKey && (!vState || vState.curveSubMode !== 'out')) {
                pt.inX = -pt.outX;
                pt.inY = -pt.outY;
              }
            } else {
              pt.inX = Math.round(startLayerState.initInX + dLocalX);
              pt.inY = Math.round(startLayerState.initInY + dLocalY);
              if (!e.altKey && (!vState || vState.curveSubMode !== 'in')) {
                pt.outX = -pt.inX;
                pt.outY = -pt.inY;
              }
            }
            if (typeof window.commitVectorChange === 'function') {
              window.commitVectorChange(targetLayer, false);
            } else {
              requestCanvasRedraw();
            }
          }
        } else if (activeOp === 'vector-point' && targetLayer && startLayerState && startLayerState.vt) {
          const curLocal = startLayerState.vt.toLocal(coords.x, coords.y);
          const dLocalX = curLocal.x - startLayerState.startLocal.x;
          const dLocalY = curLocal.y - startLayerState.startLocal.y;
          const pts = (targetLayer.shapeProps && Array.isArray(targetLayer.shapeProps.points)) ? targetLayer.shapeProps.points : [];
          const pt = pts[startLayerState.pointIndex];
          if (pt) {
            if (e.altKey) {
              pt.outX = Math.round(dLocalX);
              pt.outY = Math.round(dLocalY);
              pt.inX = -pt.outX;
              pt.inY = -pt.outY;
            } else {
              pt.x = Math.round(startLayerState.initX + dLocalX);
              pt.y = Math.round(startLayerState.initY + dLocalY);
            }
            if (typeof window.commitVectorChange === 'function') {
              window.commitVectorChange(targetLayer, false);
            } else {
              requestCanvasRedraw();
            }
          }
        } else if ((activeOp === 'vector-seg-mid' || activeOp === 'vector-segment') && targetLayer && startLayerState && startLayerState.vt) {
          const curLocal = startLayerState.vt.toLocal(coords.x, coords.y);
          const dLocalX = curLocal.x - startLayerState.startLocal.x;
          const dLocalY = curLocal.y - startLayerState.startLocal.y;
          const pts = (targetLayer.shapeProps && Array.isArray(targetLayer.shapeProps.points)) ? targetLayer.shapeProps.points : [];
          const vState = window._vectorEditorState;
          if (activeOp === 'vector-segment' && vState && vState.tool === 'curve') {
            const p0 = pts[startLayerState.segStart];
            const p1 = pts[startLayerState.segEnd];
            if (p0 && p1) {
              p0.outX = Math.round(startLayerState.p0InitOutX + dLocalX * 1.35);
              p0.outY = Math.round(startLayerState.p0InitOutY + dLocalY * 1.35);
              p1.inX = Math.round(startLayerState.p1InitInX + dLocalX * 1.35);
              p1.inY = Math.round(startLayerState.p1InitInY + dLocalY * 1.35);
              if (typeof window.commitVectorChange === 'function') {
                window.commitVectorChange(targetLayer, false);
              } else {
                requestCanvasRedraw();
              }
            }
          } else if (hasMoved) {
            if (startLayerState.insertedPointIndex === null && typeof window.subdivideVectorSegment === 'function') {
              const p0 = pts[startLayerState.segStart];
              const p1 = pts[startLayerState.segEnd];
              if (p0 && p1) {
                const sub = window.subdivideVectorSegment(p0, p1, startLayerState.t || 0.5);
                const midPt = sub.midPoint || sub;
                const insertIdx = startLayerState.segStart + 1;
                pts.splice(insertIdx, 0, {
                  x: Math.round(midPt.x),
                  y: Math.round(midPt.y),
                  inX: Math.round(midPt.inX || 0),
                  inY: Math.round(midPt.inY || 0),
                  outX: Math.round(midPt.outX || 0),
                  outY: Math.round(midPt.outY || 0)
                });
                startLayerState.insertedPointIndex = insertIdx;
                startLayerState.insertedInitX = Math.round(midPt.x);
                startLayerState.insertedInitY = Math.round(midPt.y);
                if (vState) {
                  vState.target = insertIdx;
                  vState.scrubberPos = insertIdx;
                  if (vState.tool === 'curve' && typeof window.ensureVectorPointAutoCurve === 'function') {
                    window.ensureVectorPointAutoCurve(pts, insertIdx, !!targetLayer.shapeProps.closed);
                  }
                }
              }
            }
            if (startLayerState.insertedPointIndex !== null) {
              const insPt = pts[startLayerState.insertedPointIndex];
              if (insPt) {
                insPt.x = Math.round(startLayerState.insertedInitX + dLocalX);
                insPt.y = Math.round(startLayerState.insertedInitY + dLocalY);
                if (typeof window.commitVectorChange === 'function') {
                  window.commitVectorChange(targetLayer, false);
                } else {
                  requestCanvasRedraw();
                }
              }
            }
          }
        } else if (activeOp === 'vector-new-point' && targetLayer && startLayerState && startLayerState.vt) {
          const curLocal = startLayerState.vt.toLocal(coords.x, coords.y);
          const dLocalX = curLocal.x - startLayerState.startLocal.x;
          const dLocalY = curLocal.y - startLayerState.startLocal.y;
          const pts = (targetLayer.shapeProps && Array.isArray(targetLayer.shapeProps.points)) ? targetLayer.shapeProps.points : [];
          const vState = window._vectorEditorState;
          if (hasMoved) {
            if (startLayerState.newPointIndex === null) {
              pts.push({
                x: Math.round(startLayerState.startLocal.x),
                y: Math.round(startLayerState.startLocal.y),
                inX: 0,
                inY: 0,
                outX: 0,
                outY: 0
              });
              startLayerState.newPointIndex = pts.length - 1;
            }
            const newPt = pts[startLayerState.newPointIndex];
            if (newPt) {
              if (e.altKey || (vState && vState.tool === 'curve')) {
                newPt.outX = Math.round(dLocalX);
                newPt.outY = Math.round(dLocalY);
                newPt.inX = -newPt.outX;
                newPt.inY = -newPt.outY;
              } else {
                newPt.x = Math.round(curLocal.x);
                newPt.y = Math.round(curLocal.y);
                if (vState) {
                  vState.cursorX = newPt.x;
                  vState.cursorY = newPt.y;
                }
              }
              if (typeof window.commitVectorChange === 'function') {
                window.commitVectorChange(targetLayer, false);
              } else {
                requestCanvasRedraw();
              }
            }
          }
        }
      });

      // Pointerup / Pointercancel / Window Blur: Release & Persist to DB on gesture completion
      const onPointerEnd = (e) => {
        if (!activeOp) {
          if (window.activeSnapGuides) {
            window.activeSnapGuides = null;
            if (window.CanvasOverlay) window.CanvasOverlay.scheduleRedraw();
          }
          return;
        }
        try { activeCanvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
        const didMove = hasMoved;
        const finishedLayer = targetLayer;
        const finishedOp = activeOp;
        const finishedStartState = startLayerState;
        activeOp = null;
        window._activeCanvasOp = null;
        activeHandleType = null;
        targetLayer = null;
        startLayerState = null;
        hasMoved = false;
        window.activeSnapGuides = null;
        window.isTransformInteracting = false;
        if (window._vectorEditorState) {
          window._vectorEditorState.isDraggingPad = false;
        }

        if (finishedLayer && finishedOp && finishedOp.startsWith('vector-')) {
          const pts = (finishedLayer.shapeProps && Array.isArray(finishedLayer.shapeProps.points)) ? finishedLayer.shapeProps.points : [];
          const vState = window._vectorEditorState;
          if (!didMove && finishedStartState) {
            if (finishedOp === 'vector-seg-mid' || (finishedOp === 'vector-segment' && (!vState || vState.tool !== 'curve'))) {
              if (typeof window.subdivideVectorSegment === 'function') {
                const p0 = pts[finishedStartState.segStart];
                const p1 = pts[finishedStartState.segEnd];
                if (p0 && p1) {
                  const sub = window.subdivideVectorSegment(p0, p1, finishedStartState.t || 0.5);
                  const midPt = sub.midPoint || sub;
                  const insertIdx = finishedStartState.segStart + 1;
                  pts.splice(insertIdx, 0, {
                    x: Math.round(midPt.x),
                    y: Math.round(midPt.y),
                    inX: Math.round(midPt.inX || 0),
                    inY: Math.round(midPt.inY || 0),
                    outX: Math.round(midPt.outX || 0),
                    outY: Math.round(midPt.outY || 0)
                  });
                  if (vState) {
                    vState.target = insertIdx;
                    vState.scrubberPos = insertIdx;
                    if (vState.tool === 'curve' && typeof window.ensureVectorPointAutoCurve === 'function') {
                      window.ensureVectorPointAutoCurve(pts, insertIdx, !!finishedLayer.shapeProps.closed);
                    }
                  }
                  if (typeof window.commitVectorChange === 'function') {
                    window.commitVectorChange(finishedLayer, true);
                  }
                }
              }
            } else if (finishedOp === 'vector-new-point') {
              pts.push({
                x: Math.round(finishedStartState.startLocal.x),
                y: Math.round(finishedStartState.startLocal.y),
                inX: 0,
                inY: 0,
                outX: 0,
                outY: 0
              });
              if (vState && vState.tool === 'curve' && typeof window.ensureVectorPointAutoCurve === 'function') {
                window.ensureVectorPointAutoCurve(pts, pts.length - 1, !!finishedLayer.shapeProps.closed);
              }
              if (vState) {
                vState.target = 'new';
                vState.scrubberPos = pts.length;
              }
              if (typeof window.commitVectorChange === 'function') {
                window.commitVectorChange(finishedLayer, true);
              }
            } else if (finishedOp === 'vector-point' && finishedStartState.didAutoRoundOnSelect) {
              if (typeof window.commitVectorChange === 'function') {
                window.commitVectorChange(finishedLayer, true);
              }
            }
          } else if (didMove) {
            if (finishedOp === 'vector-new-point' && vState) {
              vState.target = 'new';
              vState.scrubberPos = pts.length;
            }
            if (typeof window.commitVectorChange === 'function') {
              window.commitVectorChange(finishedLayer, true);
            }
          }
          if (typeof window.syncVectorControllerUI === 'function') window.syncVectorControllerUI();
        } else if (finishedLayer && finishedOp === 'roundness' && didMove) {
          const curVal = finishedLayer.type === 'shape' ? finishedLayer.shapeProps?.roundness : finishedLayer.roundness;
          if (typeof window.updateShapeOtherProp === 'function') {
            window.updateShapeOtherProp(finishedLayer, 'roundness', curVal, true);
          }
        }

        if (finishedLayer && didMove) {
          invalidatePreviewCacheForLayer(finishedLayer);
        }
        flushCanvasRedraw();

        // Save immediately upon releasing movement
        if (didMove) {
          saveCurrentProjectLayers();
          if (typeof renderTimelineLayers === 'function') renderTimelineLayers();
        }
      };

      window.addEventListener('pointerup', onPointerEnd);
      window.addEventListener('pointercancel', onPointerEnd);
      window.addEventListener('blur', onPointerEnd);

      // ==========================================================================
      // PREVIEW CANVAS VIEWPORT 2-FINGER PINCH ZOOM, PAN & RESET SYSTEM
      // ==========================================================================
      let canvasViewportZoom = 1.0;
      let canvasViewportPanX = 0;
      let canvasViewportPanY = 0;
      let isCanvasPinching = false;
      let isCanvasOutsidePanning = false;
      let pinchStartDist = 0;
      let pinchStartCenter = { x: 0, y: 0 };
      let pinchStartZoom = 1.0;
      let pinchStartPan = { x: 0, y: 0 };
      let outsidePanStartPoint = { x: 0, y: 0 };
      let outsidePanStartPan = { x: 0, y: 0 };
      let canvasGestureEndTime = 0;

      window.canvasViewportZoom = 1.0;
      window.canvasViewportPanX = 0;
      window.canvasViewportPanY = 0;
      window.isCanvasViewportPinching = false;
      window.canvasGestureEndTime = 0;

      function applyCanvasViewportTransform(animate = false) {
        const box = document.getElementById('editor-preview-canvas');
        const resetBtn = document.getElementById('preview-canvas-reset-btn');
        if (!box) return;

        const isTransformed = Math.abs(canvasViewportZoom - 1.0) > 0.01 || Math.abs(canvasViewportPanX) > 1 || Math.abs(canvasViewportPanY) > 1;

        if (animate) {
          box.style.transition = 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
        } else {
          box.style.transition = 'none';
        }

        if (isTransformed) {
          box.style.transform = `translate3d(${canvasViewportPanX.toFixed(1)}px, ${canvasViewportPanY.toFixed(1)}px, 0) scale(${canvasViewportZoom.toFixed(3)})`;
          if (resetBtn) resetBtn.style.display = 'inline-flex';
        } else {
          box.style.transform = '';
          if (resetBtn) resetBtn.style.display = 'none';
        }
        window.canvasViewportZoom = canvasViewportZoom;
        window.canvasViewportPanX = canvasViewportPanX;
        window.canvasViewportPanY = canvasViewportPanY;
      }
      window.applyCanvasViewportTransform = applyCanvasViewportTransform;

      function resetCanvasViewport() {
        canvasViewportZoom = 1.0;
        canvasViewportPanX = 0;
        canvasViewportPanY = 0;
        applyCanvasViewportTransform(true);
      }
      window.resetCanvasViewport = resetCanvasViewport;

      function initCanvasViewportGestures() {
        const container = document.getElementById('editor-preview-container');
        const resetBtn = document.getElementById('preview-canvas-reset-btn');
        if (!container) return;

        if (resetBtn) {
          resetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            resetCanvasViewport();
          });
        }

        container.addEventListener('touchstart', (e) => {
          if (e.touches && e.touches.length === 2) {
            // Cancel active layer transformation
            if (activeOp || window.isTransformInteracting) {
              activeOp = null;
              window._activeCanvasOp = null;
              targetLayer = null;
              window.isTransformInteracting = false;
              if (typeof flushCanvasRedraw === 'function') flushCanvasRedraw();
            }
            isCanvasPinching = true;
            isCanvasOutsidePanning = false;
            window.isCanvasViewportPinching = true;

            const t1 = e.touches[0];
            const t2 = e.touches[1];
            pinchStartDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
            pinchStartCenter = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
            pinchStartZoom = canvasViewportZoom;
            pinchStartPan = { x: canvasViewportPanX, y: canvasViewportPanY };
            if (e.cancelable) e.preventDefault();
          } else if (e.touches && e.touches.length === 1) {
            const target = e.target;
            const isOutside = !target.closest('#editor-preview-canvas') && !target.closest('#preview-matting-widget') && !target.closest('#preview-canvas-reset-btn') && !target.closest('#canvas-dropzone-split');
            if (isOutside) {
              isCanvasOutsidePanning = true;
              outsidePanStartPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              outsidePanStartPan = { x: canvasViewportPanX, y: canvasViewportPanY };
            }
          }
        }, { passive: false });

        container.addEventListener('touchmove', (e) => {
          if (isCanvasPinching && e.touches && e.touches.length === 2) {
            if (e.cancelable) e.preventDefault();
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const currDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
            const currCenter = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };

            if (pinchStartDist > 5) {
              const zoomFactor = currDist / pinchStartDist;
              canvasViewportZoom = Math.max(0.2, Math.min(6.0, pinchStartZoom * zoomFactor));
              canvasViewportPanX = pinchStartPan.x + (currCenter.x - pinchStartCenter.x);
              canvasViewportPanY = pinchStartPan.y + (currCenter.y - pinchStartCenter.y);
              applyCanvasViewportTransform(false);
            }
          } else if (isCanvasOutsidePanning && e.touches && e.touches.length === 1) {
            if (e.cancelable) e.preventDefault();
            const currPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            canvasViewportPanX = outsidePanStartPan.x + (currPoint.x - outsidePanStartPoint.x);
            canvasViewportPanY = outsidePanStartPan.y + (currPoint.y - outsidePanStartPoint.y);
            applyCanvasViewportTransform(false);
          }
        }, { passive: false });

        const onTouchEnd = (e) => {
          if (isCanvasPinching) {
            if (!e.touches || e.touches.length < 2) {
              isCanvasPinching = false;
              window.isCanvasViewportPinching = false;
              canvasGestureEndTime = Date.now();
              window.canvasGestureEndTime = canvasGestureEndTime;
            }
          }
          if (!e.touches || e.touches.length === 0) {
            isCanvasOutsidePanning = false;
            isCanvasPinching = false;
            window.isCanvasViewportPinching = false;
            canvasGestureEndTime = Date.now();
            window.canvasGestureEndTime = canvasGestureEndTime;
          }
        };

        container.addEventListener('touchend', onTouchEnd, { passive: true });
        container.addEventListener('touchcancel', onTouchEnd, { passive: true });

        // Trackpad pinch-to-zoom on desktop
        container.addEventListener('wheel', (e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.06 : 0.94;
            canvasViewportZoom = Math.max(0.2, Math.min(6.0, canvasViewportZoom * factor));
            applyCanvasViewportTransform(false);
          }
        }, { passive: false });

        // Double click outside canvas to reset viewport
        container.addEventListener('dblclick', (e) => {
          if (!e.target.closest('#editor-preview-canvas')) {
            resetCanvasViewport();
          }
        });
      }

      initCanvasViewportGestures();
    })();

    /**
     * Fit or stretch selected layer(s) to composition dimensions.
     * Supports all aspect ratios dynamically (16:9, 9:16 portrait, 1:1 square, 4:3, 21:9, custom).
     * @param {'fit'|'stretch'} mode
     */
    function applyFitOrStretchToComposition(mode, explicitLayer = null) {
      const ps = window.currentProjectState;
      if (!ps) return;

      let compW = 0;
      let compH = 0;

      if (window.currentActivePrecomp) {
        compW = Math.round(Math.abs(window.currentActivePrecomp.mediaWidth || window.currentActivePrecomp.scaleW || 0));
        compH = Math.round(Math.abs(window.currentActivePrecomp.mediaHeight || window.currentActivePrecomp.scaleH || 0));
      }
      if (!compW || !compH) {
        if (ps._baseW && ps._baseH) {
          compW = ps._baseW;
          compH = ps._baseH;
        } else if (ps.baseW && ps.baseH) {
          compW = ps.baseW;
          compH = ps.baseH;
        } else if (ps.width && ps.height) {
          compW = ps.width;
          compH = ps.height;
        } else if (typeof window.getProjectDimensions === 'function' && ps.resolution && ps.aspectRatio) {
          const dims = window.getProjectDimensions(ps.resolution, ps.aspectRatio);
          if (dims && dims.length >= 2 && dims[0] > 0 && dims[1] > 0) {
            compW = dims[0];
            compH = dims[1];
          }
        }
      }

      if (!compW || !compH) {
        if (typeof showEditorToast === 'function') {
          showEditorToast('Gagal menentukan ukuran komposisi proyek', 2400, 'error');
        } else if (typeof window.showEditorToast === 'function') {
          window.showEditorToast('Gagal menentukan ukuran komposisi proyek', 2400, 'error');
        }
        return;
      }

      const targetLayers = [];
      if (explicitLayer) {
        targetLayers.push(explicitLayer);
      } else if (window.selectedLayerIds && window.selectedLayerIds.size > 0 && ps.layers) {
        window.selectedLayerIds.forEach(id => {
          const found = ps.layers.find(l => l.id === id);
          if (found && !targetLayers.includes(found)) targetLayers.push(found);
        });
      }

      if (targetLayers.length === 0) {
        const targetId = window.selectedLayerId || window.currentSelectedLayerId;
        let single = (targetId && ps.layers) ? ps.layers.find(l => l.id === targetId) : null;
        if (!single && window.currentSelectedLayer) single = window.currentSelectedLayer;
        if (!single && ps.layers) single = ps.layers.find(l => l.selected);
        if (single) targetLayers.push(single);
      }

      if (targetLayers.length === 0) return;

      targetLayers.forEach(layer => {
        if (!layer || layer.type === 'camera' || layer.type === 'audio') return;

        const isShapeOrFill = (layer.type === 'shape' || layer.type === 'adjustment' || layer.type === 'solid' || layer.fillType === 'color' || layer.fillType === 'gradient');

        if (mode === 'fit') {
          if (isShapeOrFill) {
            layer.scaleW = compW;
            layer.scaleH = compH;
          } else {
            let srcW = layer.mediaWidth;
            let srcH = layer.mediaHeight;
            if (!srcW || !srcH) {
              if (layer.type === 'text') {
                const nat = (window.FishTextEngine && window.FishTextEngine.getNaturalSize)
                  ? window.FishTextEngine.getNaturalSize(layer)
                  : { width: 320, height: 100 };
                srcW = nat.width;
                srcH = nat.height;
              } else {
                const media = (typeof getOrLoadLayerMedia === 'function')
                  ? getOrLoadLayerMedia(layer)
                  : (window.getOrLoadLayerMedia ? window.getOrLoadLayerMedia(layer) : null);
                if (media) {
                  const el = (media && media.el) ? media.el : media;
                  if (el && el.videoWidth > 0 && el.videoHeight > 0) {
                    srcW = el.videoWidth;
                    srcH = el.videoHeight;
                  } else if (el && el.naturalWidth > 0 && el.naturalHeight > 0) {
                    srcW = el.naturalWidth;
                    srcH = el.naturalHeight;
                  } else if (media.img && media.img.naturalWidth > 0 && media.img.naturalHeight > 0) {
                    srcW = media.img.naturalWidth;
                    srcH = media.img.naturalHeight;
                  } else if (media.naturalWidth > 0 && media.naturalHeight > 0) {
                    srcW = media.naturalWidth;
                    srcH = media.naturalHeight;
                  }
                }
                if (!srcW || !srcH) {
                  srcW = Math.abs(layer.scaleW) || compW;
                  srcH = Math.abs(layer.scaleH) || compH;
                }
              }
            }
            if (srcW > 0 && srcH > 0 && (!layer.mediaWidth || !layer.mediaHeight)) {
              layer.mediaWidth = srcW;
              layer.mediaHeight = srcH;
            }
            const scaleFactor = Math.min(compW / Math.max(1, srcW), compH / Math.max(1, srcH));
            layer.scaleW = Math.round(srcW * scaleFactor);
            layer.scaleH = Math.round(srcH * scaleFactor);
          }
        } else if (mode === 'stretch') {
          layer.scaleW = compW;
          layer.scaleH = compH;
          layer.aspectLocked = false;
        }

        layer.posX = compW / 2;
        layer.posY = compH / 2;
        layer.anchorX = 0;
        layer.anchorY = 0;
        if (layer.anchorZ !== undefined) layer.anchorZ = 0;
        layer.normX = (layer.posX - layer.scaleW / 2) / compW;
        layer.normY = (layer.posY - layer.scaleH / 2) / compH;
        layer.normW = layer.scaleW / compW;
        layer.normH = layer.scaleH / compH;
        layer._userResized = true;
        layer._userResizedManual = true;

        if (layer.type === 'shape') {
          if (!layer.shapeProps) layer.shapeProps = {};
          layer.shapeProps.sizeX = Math.abs(layer.scaleW);
          layer.shapeProps.sizeY = Math.abs(layer.scaleH);
          layer.transformScaleX = 1.0;
          layer.transformScaleY = 1.0;
          layer.mediaWidth = Math.abs(layer.scaleW);
          layer.mediaHeight = Math.abs(layer.scaleH);
          layer._shapeDirty = true;
          layer._fillDirty = true;
          if (layer._shapeBufferCanvas) layer._shapeBufferCanvas._lastShapeKey = null;
          if (layer._fillBufferCanvas) layer._fillBufferCanvas._lastRenderKey = null;
          if (typeof syncShapeControllerUI === 'function') {
            syncShapeControllerUI();
          } else if (typeof window.syncShapeControllerUI === 'function') {
            window.syncShapeControllerUI();
          }
        } else if (layer.type === 'text') {
          const nat = (window.FishTextEngine && window.FishTextEngine.getNaturalSize)
            ? window.FishTextEngine.getNaturalSize(layer)
            : { width: 320, height: 100 };
          layer.transformScaleX = Math.abs(layer.scaleW) / Math.max(1, nat.width);
          layer.transformScaleY = Math.abs(layer.scaleH) / Math.max(1, nat.height);
          layer._textDirty = true;
          if (layer._textBufferCanvas) layer._textBufferCanvas._lastRenderKey = null;
          if (layer._textMbCanvas) layer._textMbCanvas._lastRenderKey = null;
        } else if (layer.type === 'precomp') {
          if (layer._precompBufferCanvas) layer._precompBufferCanvas._lastRenderKey = null;
        }

        if (typeof recordLayerPropertyChange === 'function') {
          recordLayerPropertyChange(layer, 'scale');
          recordLayerPropertyChange(layer, 'move');
        } else if (typeof window.recordLayerPropertyChange === 'function') {
          window.recordLayerPropertyChange(layer, 'scale');
          window.recordLayerPropertyChange(layer, 'move');
        }

        if (typeof invalidatePreviewCacheForLayer === 'function') {
          invalidatePreviewCacheForLayer(layer);
        }
      });

      if (typeof syncTransformControllerValues === 'function') {
        syncTransformControllerValues();
      } else if (typeof window.syncTransformControllerValues === 'function') {
        window.syncTransformControllerValues();
      }

      if (window.PreviewCacheManager && typeof window.PreviewCacheManager.syncStateWithProject === 'function') {
        window.PreviewCacheManager.syncStateWithProject();
      }

      if (typeof requestCanvasRedraw === 'function') {
        requestCanvasRedraw();
      } else if (typeof redrawComposition === 'function') {
        redrawComposition();
      } else if (typeof window.redrawComposition === 'function') {
        window.redrawComposition();
      }

      if (typeof saveCurrentProjectLayers === 'function') {
        saveCurrentProjectLayers();
      } else if (typeof window.saveCurrentProjectLayers === 'function') {
        window.saveCurrentProjectLayers();
      }

      if (typeof renderTimelineLayers === 'function') {
        renderTimelineLayers();
      } else if (typeof window.renderTimelineLayers === 'function') {
        window.renderTimelineLayers();
      }
    }
    window.applyFitOrStretchToComposition = applyFitOrStretchToComposition;
})();
