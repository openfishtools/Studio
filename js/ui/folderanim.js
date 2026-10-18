/**
 * OpenFishTools Studio - Desktop Folder Animation Engine
 * Handles bouncy physics, SVG flap open/close, and seamless morphing transitions
 * for Studio desktop folder drawers.
 */
(function(window) {
  'use strict';

  class FolderAnimationEngine {
    constructor() {
      this.timeScale = 1.0;
    }

    /**
     * Micro Physics Spring Solver (Damped Harmonic Oscillator)
     * Provides authentic physics-based spring bounce for UI & folder animations.
     * @param {Object} options
     * @param {number} [options.from=0] Initial value
     * @param {number} [options.to=1] Target value
     * @param {number} [options.stiffness=280] Spring constant k
     * @param {number} [options.damping=18] Damping ratio c
     * @param {number} [options.mass=1] Mass m
     * @param {number} [options.velocity=0] Initial velocity
     * @param {Function} options.onUpdate Value callback (currentVal, currentVel)
     * @param {Function} [options.onComplete] Callback on settled
     * @returns {Function} Cancel callback
     */
    spring({ from = 0, to = 1, stiffness = 280, damping = 18, mass = 1, velocity = 0, onUpdate, onComplete, timeScale } = {}) {
      let current = from;
      let vel = velocity;
      let lastTime = performance.now();
      let animId = null;

      const step = (now) => {
        let dt = (now - lastTime) / 1000;
        lastTime = now;
        if (dt > 0.05) dt = 0.05;
        if (dt < 0.001) dt = 0.001;

        const effectiveScale = typeof timeScale === 'number' ? timeScale : (typeof this.timeScale === 'number' ? this.timeScale : 1.0);
        dt = dt * effectiveScale;

        const springForce = -stiffness * (current - to);
        const dampingForce = -damping * vel;
        const accel = (springForce + dampingForce) / mass;

        vel += accel * dt;
        current += vel * dt;

        if (typeof onUpdate === 'function') {
          onUpdate(current, vel);
        }

        if (Math.abs(current - to) < 0.005 && Math.abs(vel) < 0.01) {
          if (animId) cancelAnimationFrame(animId);
          animId = null;
          if (typeof onUpdate === 'function') onUpdate(to, 0);
          if (typeof onComplete === 'function') onComplete();
          return;
        }

        animId = requestAnimationFrame(step);
      };

      animId = requestAnimationFrame(step);
      return () => {
        if (animId) {
          cancelAnimationFrame(animId);
          animId = null;
        }
      };
    }

    /**
     * Set animation playback speed multiplier (e.g. 0.20 for slowmo, 1.0 for normal)
     * @param {number} scale
     */
    setTimeScale(scale = 1.0) {
      this.timeScale = scale;
    }

    /**
     * Dedicated folder ticker: runs physical overshoot choreography on the folder
     * (flap + graphic body).
     * 
     * @param {HTMLElement} folderEl
     * @param {boolean} isOpen
     */
    _runFolderTicker(folderEl, isOpen = true) {
      if (!folderEl) return;
      if (!isOpen) {
        this._runFolderArrivalBounce(folderEl);
        return;
      }

      const front = folderEl.querySelector('.folder-svg-front-group') || folderEl.querySelector('.folder-svg-front');
      const graphic = folderEl.querySelector('.desktop-folder-graphic') || folderEl.querySelector('.btn-bg-icon');

      if (folderEl._folderTickerCancel) {
        folderEl._folderTickerCancel();
        folderEl._folderTickerCancel = null;
      }
      folderEl._arrivalBounceRunning = false;

      folderEl.classList.remove('is-closing');
      folderEl.classList.add('is-animating');
      folderEl.classList.add('is-open');
      folderEl.classList.add('no-hover');

      const isAction = folderEl.classList.contains('action-btn') || 
                       folderEl.classList.contains('btn-new-project') || 
                       folderEl.classList.contains('btn-import-project');

      if (front) {
        front.style.transformBox = 'fill-box';
        front.style.transformOrigin = '50% 100%';
        front.style.setProperty('transition', 'none', 'important');
        front.style.willChange = 'transform';
      }
      if (graphic) {
        graphic.style.setProperty('transition', 'none', 'important');
        graphic.style.setProperty('transform-origin', isAction ? 'center center' : '50% 100%', 'important');
        graphic.style.willChange = 'transform';
      }

      const duration = 440;
      const startTime = performance.now();
      let animId = null;

      const step = (now) => {
        const elapsed = now - startTime;
        const u = Math.min(1, Math.max(0, elapsed / duration));

        let flapDeg, scaleY, scaleX, translateY, curRot = 0;

        // OPENING CHOREOGRAPHY:
        // 1. Flap swings wide with -56deg overshoot, then settles softly to -48deg
        if (u <= 0.22) {
          const prog = u / 0.22;
          const peak = Math.sin(prog * Math.PI * 0.5);
          flapDeg = -56.0 * peak;
        } else if (u <= 0.60) {
          const prog = (u - 0.22) / 0.38;
          const eased = prog * prog * (3 - 2 * prog);
          flapDeg = -56.0 + 8.0 * eased; // settles softly to -48deg
        } else {
          flapDeg = -48.0;
        }

        // 2. Folder body: IMMEDIATE EXPLOSIVE LAUNCH BOUNCE (starts immediately at u = 0!)
        scaleY = 1.0; scaleX = 1.0; translateY = 0;
        if (u <= 0.24) {
          // The launch kick: folder forcefully catapults upward from the very start!
          const prog = Math.sin((u / 0.24) * Math.PI);
          scaleY = 1.0 + 0.16 * prog;
          scaleX = 1.0 - 0.08 * prog;
          translateY = -9.5 * prog;
        } else if (u <= 0.58) {
          // Elastic dock recoil cushion: absorbs the kickback
          const prog = Math.sin(((u - 0.24) / 0.34) * Math.PI);
          scaleY = 1.0 - 0.06 * prog;
          scaleX = 1.0 + 0.04 * prog;
          translateY = 3.2 * prog;
        } else if (u <= 0.86) {
          // Secondary rebound bounce
          const prog = Math.sin(((u - 0.58) / 0.28) * Math.PI);
          scaleY = 1.0 + 0.03 * prog;
          scaleX = 1.0 - 0.02 * prog;
          translateY = -1.6 * prog;
        } else {
          scaleY = 1.0;
          scaleX = 1.0;
          translateY = 0;
        }

        if (isAction) {
          curRot = -8 * (1 - Math.min(1, u / 0.30));
        }

        folderEl._currentRot = flapDeg;
        if (front) {
          const flapTf = `perspective(240px) rotateX(${flapDeg.toFixed(1)}deg)`;
          if (folderEl._lastFlapTf !== flapTf) {
            folderEl._lastFlapTf = flapTf;
            front.style.transform = flapTf;
          }
        }
        if (graphic) {
          const rotStr = isAction ? `rotate(${curRot.toFixed(1)}deg) ` : '';
          const graphicTransform = `${rotStr}scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)}) translateY(${translateY.toFixed(1)}px)`;
          if (folderEl._lastGraphicTf !== graphicTransform) {
            folderEl._lastGraphicTf = graphicTransform;
            graphic.style.transform = graphicTransform;
          }
          folderEl._currentGraphicTransform = graphicTransform;
        }

        if (u >= 1) {
          folderEl._folderTickerCancel = null;
          folderEl.classList.remove('is-animating');
          folderEl._currentRot = -48;
          folderEl._lastFlapTf = null;
          folderEl._lastGraphicTf = null;
          if (front) {
            front.style.transform = 'perspective(240px) rotateX(-48deg)';
            front.style.removeProperty('will-change');
          }
          if (graphic) {
            graphic.style.transform = isAction ? 'rotate(0deg)' : '';
            graphic.style.removeProperty('will-change');
            if (isAction) {
              graphic.style.setProperty('transform-origin', 'center center', 'important');
            }
          }
          return;
        }

        animId = requestAnimationFrame(step);
      };

      animId = requestAnimationFrame(step);
      folderEl._folderTickerCancel = () => {
        if (animId) cancelAnimationFrame(animId);
        folderEl._folderTickerCancel = null;
        if (front) front.style.removeProperty('will-change');
        if (graphic) graphic.style.removeProperty('will-change');
      };
    }

    /**
     * Physical Arrival Impact Bounce:
     * Triggers precisely when the returning card plunges into the folder pocket (p <= 0.08 / touchdown).
     * 1. Heavy impact cushion squash (+5.0px, scaleY 0.89) as the folder absorbs the incoming item
     * 2. Flap slaps shut with overshoot momentum past 0deg up to +5.2deg
     * 3. Energetic elastic rebound bounce (-3.2px, scaleY 1.07) up off the dock
     * 4. Settles cleanly into neutral resting state (0deg, 0px, 1.0, 1.0)
     * 
     * @param {HTMLElement} folderEl
     */
    _runFolderArrivalBounce(folderEl) {
      if (!folderEl) return;
      if (folderEl._arrivalBounceRunning) return;
      folderEl._arrivalBounceRunning = true;

      const front = folderEl.querySelector('.folder-svg-front-group') || folderEl.querySelector('.folder-svg-front');
      const graphic = folderEl.querySelector('.desktop-folder-graphic') || folderEl.querySelector('.btn-bg-icon');
      const isAction = folderEl.classList.contains('action-btn') || 
                       folderEl.classList.contains('btn-new-project') || 
                       folderEl.classList.contains('btn-import-project');

      if (folderEl._folderTickerCancel) {
        folderEl._folderTickerCancel();
        folderEl._folderTickerCancel = null;
      }

      folderEl.classList.add('is-animating');

      if (front) {
        front.style.transformBox = 'fill-box';
        front.style.transformOrigin = '50% 100%';
        front.style.setProperty('transition', 'none', 'important');
        front.style.willChange = 'transform';
      }
      if (graphic) {
        graphic.style.setProperty('transition', 'none', 'important');
        graphic.style.setProperty('transform-origin', isAction ? 'center center' : '50% 100%', 'important');
        graphic.style.willChange = 'transform';
      }

      const duration = 380;
      const startTime = performance.now();
      let animId = null;

      const step = (now) => {
        const elapsed = now - startTime;
        const u = Math.min(1, Math.max(0, elapsed / duration));

        let flapDeg, scaleY, scaleX, translateY, curRot = 0;

        // 1. Front flap slap shut with overshoot to +5.2deg, rebound to -1.5deg, settle at 0deg
        if (u <= 0.38) {
          // Flap slaps shut rapidly from -48deg past 0deg to +5.2deg
          const prog = u / 0.38;
          const eased = prog * prog * (3 - 2 * prog);
          flapDeg = -48.0 + 53.2 * eased; // -48 + 53.2 = +5.2deg
        } else if (u <= 0.72) {
          // Rebound back from +5.2deg to -1.5deg
          const prog = (u - 0.38) / 0.34;
          const eased = prog * prog * (3 - 2 * prog);
          flapDeg = 5.2 - 6.7 * eased; // 5.2 - 6.7 = -1.5deg
        } else {
          // Settle softly from -1.5deg to locked 0deg
          const prog = (u - 0.72) / 0.28;
          const eased = prog * prog * (3 - 2 * prog);
          flapDeg = -1.5 * (1 - eased);
        }

        // 2. Folder body: Impact cushion squash (+5.0px, 0.89) -> Rebound bounce (-3.2px, 1.07) -> Settle
        if (u <= 0.38) {
          // Heavy impact cushion squash absorbing the card plunging into the pocket
          const prog = Math.sin((u / 0.38) * Math.PI);
          scaleY = 1.0 - 0.11 * prog;
          scaleX = 1.0 + 0.08 * prog;
          translateY = 5.0 * prog;
        } else if (u <= 0.75) {
          // Elastic rebound bounce up off the dock
          const prog = Math.sin(((u - 0.38) / 0.37) * Math.PI);
          scaleY = 1.0 + 0.07 * prog;
          scaleX = 1.0 - 0.05 * prog;
          translateY = -3.2 * prog;
        } else if (u <= 0.92) {
          // Micro secondary cushion
          const prog = Math.sin(((u - 0.75) / 0.17) * Math.PI);
          scaleY = 1.0 - 0.02 * prog;
          scaleX = 1.0 + 0.015 * prog;
          translateY = 0.8 * prog;
        } else {
          scaleY = 1.0;
          scaleX = 1.0;
          translateY = 0;
        }

        if (isAction) {
          // Tilt back smoothly from 0deg to -8deg
          curRot = -8 * Math.min(1, u / 0.50);
        }

        folderEl._currentRot = flapDeg;
        folderEl._arrivalBounceOffset = { translateY, scaleY, scaleX };
        if (front) {
          const flapTf = `perspective(240px) rotateX(${flapDeg.toFixed(1)}deg)`;
          if (folderEl._lastFlapTf !== flapTf) {
            folderEl._lastFlapTf = flapTf;
            front.style.transform = flapTf;
          }
        }
        if (graphic) {
          const rotStr = isAction ? `rotate(${curRot.toFixed(1)}deg) ` : '';
          const graphicTransform = `${rotStr}scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)}) translateY(${translateY.toFixed(1)}px)`;
          if (folderEl._lastGraphicTf !== graphicTransform) {
            folderEl._lastGraphicTf = graphicTransform;
            graphic.style.transform = graphicTransform;
          }
          folderEl._currentGraphicTransform = graphicTransform;
        }

        if (u >= 1) {
          folderEl._folderTickerCancel = null;
          folderEl._arrivalBounceRunning = false;
          folderEl._currentRot = 0;
          folderEl._arrivalBounceOffset = null;
          folderEl._lastFlapTf = null;
          folderEl._lastGraphicTf = null;
          folderEl.classList.remove('is-animating', 'is-open', 'is-closing');
          if (front) {
            front.style.opacity = '1';
            front.style.transform = '';
            front.style.removeProperty('transition');
            front.style.removeProperty('will-change');
          }
          if (graphic) {
            graphic.style.transform = isAction ? 'rotate(-8deg)' : '';
            graphic.style.removeProperty('transition');
            graphic.style.removeProperty('will-change');
            if (isAction) {
              graphic.style.setProperty('transform-origin', 'center center', 'important');
            } else {
              graphic.style.removeProperty('transform-origin');
            }
          }
          if (typeof folderEl.blur === 'function') folderEl.blur();

          // Bersihkan flap overlay setelah settle sempurna
          this._removeFlapOverlay(null, folderEl);

          // Kunci folder di posisi neutral non-hover (-8deg, scale 1.0, sheet masuk)
          // Hanya izinkan hover jika kursor mouse digerakkan aktif setelah animasi selesai di desktop
          this._bindPostCloseHover(folderEl);
          return;
        }

        animId = requestAnimationFrame(step);
      };

      animId = requestAnimationFrame(step);
      folderEl._folderTickerCancel = () => {
        if (animId) cancelAnimationFrame(animId);
        folderEl._folderTickerCancel = null;
        folderEl._arrivalBounceRunning = false;
        if (front) front.style.removeProperty('will-change');
        if (graphic) graphic.style.removeProperty('will-change');
      };
    }

    /**
     * Ensures folder icon remains in clean neutral non-hover resting state after closing.
     * Prevents oversized hover glitches and sticky touch hover on mobile.
     * Only activates hover if the user actively moves the mouse over the button on desktop.
     * 
     * @param {HTMLElement} folderEl
     */
    _bindPostCloseHover(folderEl) {
      if (!folderEl) return;
      folderEl.classList.add('no-hover');
      folderEl.classList.remove('is-open', 'is-closing');
      if (typeof folderEl.blur === 'function') folderEl.blur();

      // Bersihkan listener sebelumnya jika ada
      if (folderEl._clearPostCloseHover) {
        folderEl._clearPostCloseHover();
        folderEl._clearPostCloseHover = null;
      }

      let armed = false;
      const armTimer = setTimeout(() => {
        armed = true;
      }, 200); // Tunggu sampai pantulan tiba benar-benar tenang

      const onMouseMove = () => {
        if (!armed) return;
        cleanup();
        folderEl.classList.remove('no-hover');
      };

      const onMouseLeave = () => {
        cleanup();
        folderEl.classList.remove('no-hover');
      };

      const cleanup = () => {
        clearTimeout(armTimer);
        folderEl.removeEventListener('mousemove', onMouseMove);
        folderEl.removeEventListener('mouseleave', onMouseLeave);
        folderEl.removeEventListener('pointerleave', onMouseLeave);
        folderEl._clearPostCloseHover = null;
      };

      folderEl.addEventListener('mousemove', onMouseMove, { passive: true });
      folderEl.addEventListener('mouseleave', onMouseLeave, { passive: true });
      folderEl.addEventListener('pointerleave', onMouseLeave, { passive: true });
      folderEl._clearPostCloseHover = cleanup;
    }

    /**
     * Animates folder front flap opening or closing with bouncy spring physics.
     * @param {HTMLElement} folderEl
     * @param {boolean} isOpen
     */
    animateFolderFlap(folderEl, isOpen = true) {
      this._runFolderTicker(folderEl, isOpen);
    }

    /**
     * Backward-compatible alias for animateFolderFlap
     */
    animateFolder(folderEl, isOpen = true) {
      this.animateFolderFlap(folderEl, isOpen);
    }

    /**
     * Symmetrical, deterministic flap angle as a pure function of progress p.
     * Ensures zero jumps, zero double flaps, and seamless continuity on spam reversal.
     * @param {number} p - Progress (0.0 inside folder slot, 1.0 open center)
     * @param {boolean} [isOpening=true]
     * @returns {number} Flap angle in degrees (0.0 to -52.0)
     */
    _calcFlapDeg(p, isOpening = true) {
      const clampedP = Math.max(0, Math.min(1, typeof p === 'number' ? p : 0));
      if (isOpening) {
        if (clampedP <= 0.25) {
          const prog = clampedP / 0.25;
          const peak = Math.sin(prog * Math.PI * 0.5);
          return -56 * peak; // Mengayun cepat hingga -56deg (overshoot open)
        } else if (clampedP <= 0.65) {
          const prog = (clampedP - 0.25) / 0.40;
          const eased = prog * prog * (3 - 2 * prog);
          return -56 + 8 * eased; // Membal santai dan settle di -48deg
        }
        return -48;
      }
      // CLOSING:
      // While returning, flap stays open at -48deg waiting for incoming card until arrival impact bounce slaps it shut
      return -48.0;
    }

    /**
     * Promotes morph subtrees to compositor layers once per morph (instead of
     * letting the browser re-decide layerization on every opacity/transform
     * write), and clears per-frame string caches when the morph ends so the
     * next morph never skips its first write on a stale cache hit.
     */
    _setMorphLayerHint(win, header, body, footer, skeleton, on) {
      const set = (el, v) => {
        if (!el) return;
        try {
          if (on) el.style.willChange = v;
          else el.style.removeProperty('will-change');
        } catch (_) {}
      };
      set(header, 'opacity');
      set(body, 'opacity');
      set(footer, 'opacity');
      set(skeleton, 'opacity');
      if (!on && win) {
        win._lastMorphTf = null;
        win._lastOvTf = null;
        win._lastFlapTf = null;
        win._lastFrontTf = null;
        win._lastBgAlpha = null;
        win._lastRadius = null;
        win._morphVis = null;
        try { win.style.removeProperty('will-change'); } catch (_) {}
      }
    }


    _setupFlapOverlay(folderEl, modal, geom) {
      if (!folderEl || !modal) return null;
      let overlay = modal._flapOverlay;
      if (!overlay || !overlay.isConnected) {
        overlay = modal.querySelector('.folder-flap-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.className = 'folder-flap-overlay';
          overlay.style.position = 'fixed';
          overlay.style.pointerEvents = 'none';
          overlay.style.zIndex = '10005';
          overlay.style.display = 'none';
          modal.appendChild(overlay);
        }
        modal._flapOverlay = overlay;
      }
      const posX = (geom && typeof geom.gx === 'number') ? geom.gx : (geom ? geom.cx : null);
      const posY = (geom && typeof geom.gy === 'number') ? geom.gy : (geom ? geom.cy : null);
      if (typeof posX === 'number' && typeof posY === 'number') {
        overlay.style.left = `${(posX - geom.gw / 2).toFixed(1)}px`;
        overlay.style.top = `${(posY - geom.gh / 2).toFixed(1)}px`;
        overlay.style.width = `${geom.gw.toFixed(1)}px`;
        overlay.style.height = `${geom.gh.toFixed(1)}px`;
        overlay.style.transformOrigin = geom.isActionFolder ? 'center center' : '50% 100%';
        // Promote once: overlay + flap are written every frame during flight
        overlay.style.willChange = 'transform';
      }
      const frontGroup = folderEl.querySelector('.folder-svg-front-group');
      const front = folderEl.querySelector('.folder-svg-front');
      const frontColor = front ? (front.getAttribute('fill') || 'var(--color-primary, #98ce7b)') : 'var(--color-primary, #98ce7b)';
      if (!overlay._flapMounted || overlay._flapColor !== frontColor) {
        overlay._flapColor = frontColor;
        overlay._flapMounted = true;
        const flapContent = frontGroup ? frontGroup.innerHTML : `
          <rect x="6" y="16" width="56" height="32" rx="6" fill="${frontColor}"/>
          <rect x="8" y="17" width="52" height="1.5" rx="0.75" fill="#ffffff" opacity="0.35"/>
        `;
        overlay.innerHTML = `
          <svg viewBox="0 0 68 54" width="100%" height="100%" fill="none" style="overflow: visible; display: block;">
            <g class="overlay-flap-group" style="transform-box: fill-box; transform-origin: 50% 100%; transform-style: preserve-3d;">
              ${flapContent}
            </g>
          </svg>
        `;
        overlay._cachedFlap = overlay.querySelector('.overlay-flap-group');
      }
      return {
        overlay,
        overlayFlap: overlay._cachedFlap || overlay.querySelector('.overlay-flap-group')
      };
    }

    _mountMorphSvg(skeleton, insert) {
      if (!skeleton || !insert) return;
      if (skeleton._mountedInsert === insert && skeleton.firstElementChild) {
        return; // Already compiled and mounted, zero re-parse needed
      }
      skeleton._mountedInsert = insert;
      const content = insert.innerHTML
        .replace(/opacity="0\.95"/g, 'opacity="1"')
        .replace(/<line /g, '<line vector-effect="non-scaling-stroke" ');
      skeleton.innerHTML = `
        <svg viewBox="12 8 44 32" preserveAspectRatio="none" style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: hidden; display: block; border-radius: inherit;">
          <g style="opacity: 1; transform: none;">
            ${content}
          </g>
        </svg>
      `;
    }

    _removeFlapOverlay(modal, folderEl) {
      if (modal) {
        const overlay = modal._flapOverlay || modal.querySelector('.folder-flap-overlay');
        if (overlay) overlay.remove();
        modal._flapOverlay = null;
      }
      const folder = folderEl || (modal && modal._activeSourceFolder);
      if (folder) {
        if (folder._activeTargetModal && folder._activeTargetModal._flapOverlay) {
          folder._activeTargetModal._flapOverlay.remove();
          folder._activeTargetModal._flapOverlay = null;
        }
        const origFront = folder.querySelector('.folder-svg-front-group') || folder.querySelector('.folder-svg-front');
        if (origFront) {
          origFront.style.opacity = '1';
        }
      }
    }

    /**
     * Measures pure untransformed neutral layout geometry between folder sheet and modal card.
     * Fast neutral measurement: batches layout reads without triggering layout thrashing.
     */
    _measureMorphGeometry(folderEl, win, modal) {
      if (!folderEl || !win) return null;
      const sheet = folderEl.querySelector('.folder-insert-sheet') || folderEl.querySelector('.folder-svg-insert') || folderEl;
      const insert = folderEl.querySelector('.folder-svg-insert') || sheet;
      const front = folderEl.querySelector('.folder-svg-front-group') || folderEl.querySelector('.folder-svg-front');
      const graphic = folderEl.querySelector('.desktop-folder-graphic') || folderEl.querySelector('.btn-bg-icon');
      const svgEl = folderEl.querySelector('.desktop-folder-svg');

      const isActionFolder = folderEl.classList.contains('btn-new-project') || 
                             folderEl.classList.contains('btn-import-project') || 
                             folderEl.classList.contains('action-btn');

      // Fast neutral measurement:
      // Strip active transform and hover state from folderEl, win, graphic, insert, sheet, and front
      // so getBoundingClientRect reflects pure neutral resting layout without rotation distortion or hover displacement!
      folderEl.classList.add('no-hover');
      if (typeof folderEl.blur === 'function') folderEl.blur();

      const prevWinTransform = win.style.transform;
      const prevGraphicTransform = graphic ? graphic.style.transform : '';
      const prevInsertTransform = insert ? insert.style.transform : '';
      const prevSheetTransform = sheet ? sheet.style.transform : '';
      const prevFrontTransform = front ? front.style.transform : '';

      const hadWin = prevWinTransform && prevWinTransform !== 'none';
      const hadGraphic = graphic && prevGraphicTransform && prevGraphicTransform !== 'none';
      const hadInsert = insert && prevInsertTransform && prevInsertTransform !== 'none';
      const hadSheet = sheet && prevSheetTransform && prevSheetTransform !== 'none';
      const hadFront = front && prevFrontTransform && prevFrontTransform !== 'none';

      if (hadWin) win.style.setProperty('transform', 'none', 'important');
      if (hadGraphic) graphic.style.setProperty('transform', 'none', 'important');
      if (hadInsert) insert.style.setProperty('transform', 'none', 'important');
      if (hadSheet) sheet.style.setProperty('transform', 'none', 'important');
      if (hadFront) front.style.setProperty('transform', 'none', 'important');

      // Batch rect reads together while in pure untransformed, unrotated neutral resting state
      const sRect = sheet.getBoundingClientRect();
      const tRect = win.getBoundingClientRect();
      const gRect = (graphic || svgEl || sheet).getBoundingClientRect();
      const svgRect = svgEl ? svgEl.getBoundingClientRect() : gRect;

      // Restore transforms only if modified
      if (hadWin) win.style.transform = prevWinTransform;
      if (hadGraphic) graphic.style.transform = prevGraphicTransform;
      if (hadInsert) insert.style.transform = prevInsertTransform;
      if (hadSheet) sheet.style.transform = prevSheetTransform;
      if (hadFront) front.style.transform = prevFrontTransform;

      // Unrotated exact sheet scale factors (prevents the oversized / 'kebesaran' bug caused by measuring rotated bounding box)
      const realWidth = Math.max(200, tRect.width || 320);
      const realHeight = Math.max(150, tRect.height || 200);
      const sx = Math.min(0.5, Math.max(0.01, sRect.width / realWidth));
      const sy = Math.min(0.5, Math.max(0.01, sRect.height / realHeight));

      // Calculate target sheet center when rotated to resting state (-8deg for action buttons, 0deg for standard folders)
      const gx = gRect.left + gRect.width / 2;
      const gy = gRect.top + gRect.height / 2;
      const sCenterX0 = sRect.left + sRect.width / 2;
      const sCenterY0 = sRect.top + sRect.height / 2;
      const ox = sCenterX0 - gx;
      const oy = sCenterY0 - gy;

      const thetaRad = isActionFolder ? (-8 * Math.PI / 180) : 0;
      const cosT = Math.cos(thetaRad);
      const sinT = Math.sin(thetaRad);
      const oxRot = ox * cosT - oy * sinT;
      const oyRot = ox * sinT + oy * cosT;

      const sCenterX = gx + oxRot;
      const sCenterY = gy + oyRot;
      const tCenterX = tRect.left + tRect.width / 2;
      const tCenterY = tRect.top + tRect.height / 2;

      const dx = sCenterX - tCenterX;
      const dy = sCenterY - tCenterY;

      let targetRadiusTop = win._morphTargetRadiusTop;
      let targetRadiusBottom = win._morphTargetRadiusBottom;
      let targetBg = win._morphTargetBg;
      if (typeof targetRadiusTop !== 'number' || typeof targetRadiusBottom !== 'number' || !targetBg) {
        if (win && typeof window !== 'undefined' && window.getComputedStyle) {
          const cs = window.getComputedStyle(win);
          const rTop = parseFloat(cs.borderTopLeftRadius);
          const rBottom = parseFloat(cs.borderBottomLeftRadius);
          const rGeneral = parseFloat(cs.borderRadius);
          targetRadiusTop = !isNaN(rTop) && rTop >= 0 ? rTop : (!isNaN(rGeneral) && rGeneral >= 0 ? rGeneral : 20);
          targetRadiusBottom = !isNaN(rBottom) && rBottom >= 0 ? rBottom : (!isNaN(rGeneral) && rGeneral >= 0 ? rGeneral : 20);
          targetBg = cs.backgroundColor;
          win._morphTargetRadiusTop = targetRadiusTop;
          win._morphTargetRadiusBottom = targetRadiusBottom;
          win._morphTargetBg = targetBg;
        } else {
          targetRadiusTop = 20;
          targetRadiusBottom = 20;
          targetBg = '';
        }
      }

      const startRot = isActionFolder ? -8 : 0;

      // UI-scale zoom compensation: rects report visual px, but translate /
      // left / width styles render scaled — divide back to layout px so the
      // morph lands exactly on the folder at any UI scale. Ratios (sx/sy)
      // are unaffected. At 100% the factor is 1 (no behavior change).
      const _z = (typeof window.oftUiScaleFactor === 'function' ? window.oftUiScaleFactor() : 1) || 1;

      return {
        dx: dx / _z, dy: dy / _z, sx, sy, sRect, tRect,
        targetRadiusTop, targetRadiusBottom, targetBg,
        startRot,
        cx: sCenterX / _z, cy: sCenterY / _z,
        gx: gx / _z, gy: gy / _z,
        gw: (svgRect.width || 60) / _z,
        gh: (svgRect.height || 48) / _z,
        isActionFolder,
        graphicEl: graphic
      };
    }

    /**
     * Resets any active folder modal instantly to its pristine closed state.
     * Guarantees no two folder modals conflict when switching rapidly.
     */
    _resetModalInstantly(modal) {
      if (!modal) return;
      const win = modal.querySelector('.folder-modal-card') || modal.querySelector('.modal-card') || modal.querySelector('.finder-window');
      const srcFolder = modal._activeSourceFolder || (
        modal.id === 'modal-extensions' ? document.getElementById('btn-folder-extensions') :
        modal.id === 'modal-community' ? document.getElementById('btn-folder-community') :
        modal.id === 'modal-new-project' ? document.querySelector('.btn-new-project') :
        modal.id === 'modal-import-project' ? document.querySelector('.btn-import-project') : null
      );
      if (win) {
        win._bgSet = false;
        win._cachedMorph = null;
        win.style.removeProperty('will-change');
        if (win._kickLaunchTimer) {
          clearTimeout(win._kickLaunchTimer);
          win._kickLaunchTimer = null;
        }
        if (win._morphCancel) {
          win._morphCancel();
          win._morphCancel = null;
        }
      }
      modal.style.setProperty('transition', 'none', 'important');
      modal.style.setProperty('opacity', '0', 'important');
      modal.style.setProperty('background-color', 'transparent', 'important');
      if (srcFolder) {
        if (srcFolder._springFrontCancel) {
          srcFolder._springFrontCancel();
          srcFolder._springFrontCancel = null;
        }
        if (srcFolder._folderTickerCancel) {
          srcFolder._folderTickerCancel();
          srcFolder._folderTickerCancel = null;
        }
        srcFolder._arrivalBounceRunning = false;
        srcFolder.classList.remove('is-open', 'is-animating', 'is-closing');
        if (typeof srcFolder.blur === 'function') srcFolder.blur();
        this._bindPostCloseHover(srcFolder);
        const insert = srcFolder.querySelector('.folder-svg-insert') || srcFolder.querySelector('.folder-insert-sheet');
        if (insert) {
          insert.style.opacity = '1';
          insert.style.transform = '';
        }
        const front = srcFolder.querySelector('.folder-svg-front-group') || srcFolder.querySelector('.folder-svg-front');
        if (front) {
          front.style.opacity = '1';
          front.style.removeProperty('transition');
          front.style.removeProperty('will-change');
          front.style.transform = '';
        }
        const graphic = srcFolder.querySelector('.desktop-folder-graphic') || srcFolder.querySelector('.btn-bg-icon');
        if (graphic) {
          const isAction = srcFolder.classList.contains('action-btn') || 
                           srcFolder.classList.contains('btn-new-project') || 
                           srcFolder.classList.contains('btn-import-project');
          graphic.style.removeProperty('transition');
          graphic.style.removeProperty('will-change');
          if (isAction) {
            graphic.style.setProperty('transform-origin', 'center center', 'important');
          } else {
            graphic.style.removeProperty('transform-origin');
          }
          graphic.style.transform = isAction ? 'rotate(-8deg)' : '';
        }
        srcFolder._currentRot = 0;
        srcFolder._lastFlapTf = null;
        srcFolder._lastGraphicTf = null;
        srcFolder._activeTargetModal = null;
      }
      this._removeFlapOverlay(modal, srcFolder);
      modal.classList.remove('is-active');
      modal._activeSourceFolder = null;
      modal._isClosingWithMorph = false;
      modal.style.removeProperty('pointer-events');
      requestAnimationFrame(() => {
        modal.style.removeProperty('opacity');
        modal.style.removeProperty('background-color');
        modal.style.removeProperty('transition');
      });
      if (win) {
        win._morphProgress = 0.0;
        win.style.removeProperty('transform');
        win.style.opacity = '';
        win.style.backgroundColor = '';
        win.style.removeProperty('border-radius');
        win.style.borderColor = '';
        win.style.removeProperty('pointer-events');
        const header = win.querySelector('.folder-modal-header, .modal-header');
        const body = win.querySelector('.folder-modal-body, .modal-body');
        const footer = win.querySelector('.folder-modal-footer, .modal-footer');
        this._setMorphLayerHint(win, header, body, footer, win.querySelector('.folder-morph-skeleton'), false);
        if (header) { header.style.opacity = ''; header.style.visibility = ''; }
        if (body) { body.style.opacity = ''; body.style.visibility = ''; }
        if (footer) { footer.style.opacity = ''; footer.style.visibility = ''; }
        const skeleton = win.querySelector('.folder-morph-skeleton');
        if (skeleton) {
          skeleton.style.opacity = '0';
          skeleton.style.visibility = '';
          skeleton.innerHTML = '';
        }
      }
      if (window.Modal && window.Modal.activeModal === modal) {
        window.Modal.activeModal = null;
      }
      if (!document.querySelector('#modal-extensions.is-active, #modal-community.is-active, #modal-new-project.is-active, #modal-import-project.is-active')) {
        document.body.classList.remove('has-folder-modal-open');
      }
    }

    /**
     * Unified, deterministic frame rendering for any progress p (0.0 to 1.0).
     */
    _applyMorphFrame(folderEl, modal, win, p, geom, isOpening) {
      win._morphProgress = p;
      const isMobile = window.innerWidth <= 600;
      const isFullScreen = isMobile && (modal.id === 'modal-extensions' || (win && win.classList.contains('extension-modal-card')));
      const { dx, dy, sx, sy } = geom;

      let cached = win._cachedMorph;
      if (!cached || !cached.overlay || !cached.overlay.isConnected) {
        const flapData = this._setupFlapOverlay(folderEl, modal, geom);
        cached = {
          header: win.querySelector('.folder-modal-header, .modal-header'),
          body: win.querySelector('.folder-modal-body, .modal-body'),
          footer: win.querySelector('.folder-modal-footer, .modal-footer'),
          skeleton: win.querySelector('.folder-morph-skeleton'),
          front: folderEl.querySelector('.folder-svg-front-group') || folderEl.querySelector('.folder-svg-front'),
          graphic: geom.graphicEl || folderEl.querySelector('.desktop-folder-graphic') || folderEl.querySelector('.btn-bg-icon'),
          overlay: flapData ? flapData.overlay : null,
          overlayFlap: flapData ? flapData.overlayFlap : null,
          overlayVisible: null,
          lastBorderColor: null,
          opacitySettled: null
        };
        win._cachedMorph = cached;
      }

      const clampedP = Math.max(0, Math.min(1, p));
      const flapDeg = (folderEl && folderEl._arrivalBounceRunning && typeof folderEl._currentRot === 'number')
        ? folderEl._currentRot
        : this._calcFlapDeg(clampedP, isOpening);
      folderEl._currentRot = flapDeg;

      if (!win._bgSet) {
        const solidCardBg = geom.targetBg || (isFullScreen ? 'var(--bg-dashboard)' : 'var(--bg-panel)');
        win.style.backgroundColor = solidCardBg;
        win.style.opacity = '1';
        win._bgSet = true;
      }

      const u = clampedP;
      const isActionModal = (geom && geom.isActionFolder) || (modal && (modal.id === 'modal-new-project' || modal.id === 'modal-import-project'));

      let curDx, curDy, curSx, curSy, curRot;

      if (!isOpening) {
        // Fluid physical spring trajectory for closing:
        // Directly driven by spring progress p without double-easing or zero-velocity clamping,
        // so the spring's natural elastic velocity and kinetic momentum carry the card fluidly into the sleeve.
        const flightLift = (isMobile ? -8 : -14) * Math.sin(u * Math.PI);
        curDx = dx * (1 - p);
        curDy = dy * (1 - p) + flightLift;
        curSx = sx + (1 - sx) * p;
        curSy = sy + (1 - sy) * p;

        // Smooth aerodynamic rotation throughout the entire return flight
        const baseRot = typeof geom.startRot === 'number' ? geom.startRot : 0;
        curRot = baseRot * (1 - u);

        // Physical cushion squash absorption: sheet moves with folder during arrival impact
        if (folderEl && folderEl._arrivalBounceRunning && folderEl._arrivalBounceOffset && p <= 0.15) {
          const bounce = folderEl._arrivalBounceOffset;
          const blend = 1 - Math.max(0, Math.min(1, p / 0.15));
          curDy += (bounce.translateY || 0) * blend;
          if (typeof bounce.scaleY === 'number') curSy *= (1 + (bounce.scaleY - 1) * blend);
          if (typeof bounce.scaleX === 'number') curSx *= (1 + (bounce.scaleX - 1) * blend);
        }
      } else {
        const eased = u * u * (3 - 2 * u);
        curDx = dx * (1 - eased);
        const flightLift = (isMobile ? -8 : -16) * Math.sin(u * Math.PI);
        curDy = dy * (1 - eased) + flightLift;

        if (isActionModal && p > 1.0) {
          const overshootFactor = isMobile ? 220 : 300;
          curDy += (p - 1.0) * overshootFactor;
        }

        curSx = sx + (1 - sx) * eased;
        curSy = sy + (1 - sy) * eased;

        const baseRot = typeof geom.startRot === 'number' ? geom.startRot : 0;
        curRot = baseRot * (1 - Math.min(1, u / 0.35));
      }

      // Synchronized dark backdrop dimming for dialog modals (New Project & Import Project)
      if (modal && (modal.id === 'modal-new-project' || modal.id === 'modal-import-project')) {
        const bgAlpha = Math.max(0, Math.min(0.78, 0.78 * Math.sin(Math.min(1, u * 1.35) * Math.PI * 0.5)));
        const qAlpha = (Math.round(bgAlpha * 50) / 50).toFixed(2);
        if (cached.lastBgAlpha !== qAlpha) {
          cached.lastBgAlpha = qAlpha;
          modal.style.backgroundColor = `rgba(10, 18, 10, ${qAlpha})`;
        }
      }

      // Visual border radius morph:
      // Desktop: smoothly interpolate visual curvature.
      // Mobile: NEVER mutate border-radius during animation!
      // In CSS, mobile already has border-radius: 24px 24px 0 0 (drawer) or 0 (fullscreen).
      // Mutating border-radius on every frame forces full CPU re-rasterization on mobile WebKit/Blink!
      if (!isMobile) {
        const sheetVisualR = 3.0;
        const targetRTop = (typeof geom.targetRadiusTop === 'number') ? geom.targetRadiusTop : 20;
        const targetRBottom = (typeof geom.targetRadiusBottom === 'number') ? geom.targetRadiusBottom : 20;
        const radFactor = isOpening ? (u * u * (3 - 2 * u)) : u;
        let minScale = curSx;
        if (curSy < minScale) minScale = curSy;
        if (minScale < 0.01) minScale = 0.01;
        const rTop = sheetVisualR + (targetRTop - sheetVisualR) * radFactor;
        const rBot = sheetVisualR + (targetRBottom - sheetVisualR) * radFactor;
        const cssTop = Math.round(rTop / minScale);
        const cssBot = Math.round(rBot / minScale);
        if (cached.lastRTop !== cssTop || cached.lastRBot !== cssBot) {
          cached.lastRTop = cssTop;
          cached.lastRBot = cssBot;
          win.style.borderRadius = `${cssTop}px ${cssTop}px ${cssBot}px ${cssBot}px`;
        }
      }

      // Border color toggle (only when crossing threshold u = 0.15)
      const shouldShowBorder = u >= 0.15;
      if (cached.lastBorderColor !== shouldShowBorder) {
        cached.lastBorderColor = shouldShowBorder;
        win.style.borderColor = shouldShowBorder ? '' : 'transparent';
      }

      // Content cross-fade:
      // When opening: cross-fade from sheet skeleton to modal UI between p = 0.08 and 0.36
      // When closing: gently dissolve modal UI into sleek document sheet between p = 0.85 and 0.20
      if (isOpening) {
        if (u <= 0.08) {
          if (cached.opacitySettled !== 'zero') {
            cached.opacitySettled = 'zero';
            win._morphVis = 'zero';
            cached.lastSkelO = '1';
            cached.lastMorphO = '0';
            if (cached.skeleton) { cached.skeleton.style.opacity = '1'; cached.skeleton.style.visibility = 'visible'; }
            if (cached.header) { cached.header.style.opacity = '0'; cached.header.style.visibility = 'hidden'; }
            if (cached.body) { cached.body.style.opacity = '0'; cached.body.style.visibility = 'hidden'; }
            if (cached.footer) { cached.footer.style.opacity = '0'; cached.footer.style.visibility = 'hidden'; }
          }
        } else if (u >= 0.36) {
          if (cached.opacitySettled !== 'full') {
            cached.opacitySettled = 'full';
            win._morphVis = 'full';
            cached.lastSkelO = '0';
            cached.lastMorphO = '1';
            if (cached.skeleton) { cached.skeleton.style.opacity = '0'; cached.skeleton.style.visibility = 'hidden'; }
            if (cached.header) { cached.header.style.opacity = '1'; cached.header.style.visibility = 'visible'; }
            if (cached.body) { cached.body.style.opacity = '1'; cached.body.style.visibility = 'visible'; }
            if (cached.footer) { cached.footer.style.opacity = '1'; cached.footer.style.visibility = 'visible'; }
          }
        } else {
          cached.opacitySettled = 'fading';
          if (win._morphVis !== 'fading') {
            win._morphVis = 'fading';
            if (cached.skeleton) cached.skeleton.style.visibility = 'visible';
            if (cached.header) cached.header.style.visibility = 'visible';
            if (cached.body) cached.body.style.visibility = 'visible';
            if (cached.footer) cached.footer.style.visibility = 'visible';
          }
          const progMorph = (u - 0.08) / 0.28;
          const easedMorph = progMorph * progMorph * (3 - 2 * progMorph);
          const skelO = (1 - easedMorph).toFixed(2);
          const morphO = easedMorph.toFixed(2);
          if (cached.lastSkelO !== skelO) {
            cached.lastSkelO = skelO;
            if (cached.skeleton) cached.skeleton.style.opacity = skelO;
          }
          if (cached.lastMorphO !== morphO) {
            cached.lastMorphO = morphO;
            if (cached.header) cached.header.style.opacity = morphO;
            if (cached.body) cached.body.style.opacity = morphO;
            if (cached.footer) cached.footer.style.opacity = morphO;
          }
        }
      } else {
        if (u >= 0.85) {
          if (cached.opacitySettled !== 'full') {
            cached.opacitySettled = 'full';
            win._morphVis = 'full';
            cached.lastSkelO = '0';
            cached.lastMorphO = '1';
            if (cached.skeleton) { cached.skeleton.style.opacity = '0'; cached.skeleton.style.visibility = 'hidden'; }
            if (cached.header) { cached.header.style.opacity = '1'; cached.header.style.visibility = 'visible'; }
            if (cached.body) { cached.body.style.opacity = '1'; cached.body.style.visibility = 'visible'; }
            if (cached.footer) { cached.footer.style.opacity = '1'; cached.footer.style.visibility = 'visible'; }
          }
        } else if (u <= 0.20) {
          if (cached.opacitySettled !== 'zero') {
            cached.opacitySettled = 'zero';
            win._morphVis = 'zero';
            cached.lastSkelO = '1';
            cached.lastMorphO = '0';
            if (cached.skeleton) { cached.skeleton.style.opacity = '1'; cached.skeleton.style.visibility = 'visible'; }
            if (cached.header) { cached.header.style.opacity = '0'; cached.header.style.visibility = 'hidden'; }
            if (cached.body) { cached.body.style.opacity = '0'; cached.body.style.visibility = 'hidden'; }
            if (cached.footer) { cached.footer.style.opacity = '0'; cached.footer.style.visibility = 'hidden'; }
          }
        } else {
          cached.opacitySettled = 'fading';
          if (win._morphVis !== 'fading') {
            win._morphVis = 'fading';
            if (cached.skeleton) cached.skeleton.style.visibility = 'visible';
            if (cached.header) cached.header.style.visibility = 'visible';
            if (cached.body) cached.body.style.visibility = 'visible';
            if (cached.footer) cached.footer.style.visibility = 'visible';
          }
          const progMorph = (u - 0.20) / 0.65;
          const easedMorph = progMorph * progMorph * (3 - 2 * progMorph);
          const skelO = (1 - easedMorph).toFixed(2);
          const morphO = easedMorph.toFixed(2);
          if (cached.lastSkelO !== skelO) {
            cached.lastSkelO = skelO;
            if (cached.skeleton) cached.skeleton.style.opacity = skelO;
          }
          if (cached.lastMorphO !== morphO) {
            cached.lastMorphO = morphO;
            if (cached.header) cached.header.style.opacity = morphO;
            if (cached.body) cached.body.style.opacity = morphO;
            if (cached.footer) cached.footer.style.opacity = morphO;
          }
        }
      }

      // Hardware accelerated GPU Transform (will-change is promoted once at
      // morph start; rewriting it per frame forces needless style recalc)
      const rotStr = Math.abs(curRot) > 0.01 ? ` rotate(${curRot.toFixed(1)}deg)` : '';
      const morphTf = `translate3d(${curDx.toFixed(1)}px, ${curDy.toFixed(1)}px, 0)${rotStr} scale(${curSx.toFixed(3)}, ${curSy.toFixed(3)})`;
      if (win._lastMorphTf !== morphTf) {
        win._lastMorphTf = morphTf;
        win.style.transform = morphTf;
      }

      // Flap Overlay Choreography (zero per-frame layout property writes)
      if (cached.overlay && cached.overlayFlap) {
        if (clampedP <= 0.45) {
          if (cached.overlayVisible !== true) {
            cached.overlayVisible = true;
            cached.overlay.style.display = 'block';
            if (cached.front) cached.front.style.opacity = '0';
          }
          let syncGraphicTransform = folderEl._currentGraphicTransform;
          if (cached.graphic && geom.isActionFolder && !folderEl._arrivalBounceRunning) {
            const rotTf = `rotate(${curRot.toFixed(1)}deg)`;
            if (folderEl._lastGraphicTf !== rotTf) {
              folderEl._lastGraphicTf = rotTf;
              cached.graphic.style.transform = rotTf;
            }
            syncGraphicTransform = rotTf;
            folderEl._currentGraphicTransform = rotTf;
          }
          if (!syncGraphicTransform || syncGraphicTransform === 'none') {
            syncGraphicTransform = Math.abs(curRot) > 0.01 ? `rotate(${curRot.toFixed(1)}deg)` : 'none';
          }
          if (win._lastOvTf !== syncGraphicTransform) {
            win._lastOvTf = syncGraphicTransform;
            cached.overlay.style.transform = syncGraphicTransform;
          }
          const flapTf = `perspective(240px) rotateX(${flapDeg.toFixed(1)}deg)`;
          if (win._lastFlapTf !== flapTf) {
            win._lastFlapTf = flapTf;
            cached.overlayFlap.style.transform = flapTf;
          }
        } else {
          if (cached.graphic && geom.isActionFolder && !folderEl._arrivalBounceRunning && !isOpening) {
            const rotTf = `rotate(${curRot.toFixed(1)}deg)`;
            if (folderEl._lastGraphicTf !== rotTf) {
              folderEl._lastGraphicTf = rotTf;
              cached.graphic.style.transform = rotTf;
            }
            folderEl._currentGraphicTransform = rotTf;
          }
          if (cached.overlayVisible !== false) {
            cached.overlayVisible = false;
            cached.overlay.style.display = 'none';
            if (cached.front) {
              cached.front.style.opacity = '1';
              const frontTf = `perspective(240px) rotateX(${flapDeg.toFixed(1)}deg)`;
              if (folderEl._lastFlapTf !== frontTf) {
                folderEl._lastFlapTf = frontTf;
                cached.front.style.transform = frontTf;
              }
            }
          }
        }
      } else if (cached.front) {
        cached.front.style.opacity = '1';
        const frontTf = `perspective(240px) rotateX(${flapDeg.toFixed(1)}deg)`;
        if (win._lastFrontTf !== frontTf) {
          win._lastFrontTf = frontTf;
          cached.front.style.transform = frontTf;
        }
      }
    }

    /**
     * Morph / expand animation:
     * Fully reversible and spam-proof.
     * 
     * @param {HTMLElement} folderEl
     * @param {string|HTMLElement} modalTarget
     */
    openFolderWithMorph(folderEl, modalTarget) {
      if (!folderEl) return;
      this._hookModalIfNeeded();
      const modal = typeof modalTarget === 'string' ? document.getElementById(modalTarget) : modalTarget;
      if (!modal) return;

      const sheet = folderEl.querySelector('.folder-insert-sheet') || folderEl.querySelector('.folder-svg-insert') || folderEl;
      const win = modal.querySelector('.folder-modal-card') || modal.querySelector('.modal-card') || modal.querySelector('.finder-window');
      if (!sheet || !win) {
        if (window.Modal) window.Modal.open(modal);
        return;
      }

      // Jika modal sedang aktif dan BUKAN sedang dalam proses closing, langsung toggle tutup seketika!
      if (modal.classList.contains('is-active') && !modal._isClosingWithMorph) {
        if (win._morphCancel) {
          win._morphCancel();
          win._morphCancel = null;
        }
        if (window.Modal) {
          window.Modal.close(modal);
        } else {
          this.closeFolderWithMorph(folderEl, modal);
        }
        return;
      }

      // Jika modal sedang dalam proses closing dan diklik lagi, batalkan closing seketika dan balikkan ke buka
      if (modal._isClosingWithMorph) {
        if (win._morphCancel) {
          win._morphCancel();
          win._morphCancel = null;
        }
        modal._isClosingWithMorph = false;
      }

      // Tutup modal folder lain yang sedang aktif agar tidak tumpang tindih
      const allFolderModals = document.querySelectorAll('#modal-extensions, #modal-community, .modal-backdrop.is-active');
      allFolderModals.forEach((other) => {
        if (other !== modal && (other.classList.contains('is-active') || other._activeSourceFolder || other._isClosingWithMorph)) {
          this._resetModalInstantly(other);
        }
      });

      const isMobile = window.innerWidth <= 600;
      const isFullScreen = isMobile && (modal.id === 'modal-extensions' || (win && win.classList.contains('extension-modal-card')));
      const isDialogModal = modal.id === 'modal-new-project' || modal.id === 'modal-import-project';
      const startP = typeof win._morphProgress === 'number' ? Math.max(0, Math.min(1, win._morphProgress)) : 0.0;
      const initialAlpha = isFullScreen ? 0 : (isDialogModal ? (0.78 * Math.sin(Math.min(1, startP * 1.35) * Math.PI * 0.5)) : 0);

      // Set backdrop transparent & transition: none SEBELUM menambahkan is-active
      // agar tidak ada flicker/kilatan hitam dari CSS default (.modal-backdrop { background-color: rgba(10,18,10,0.78); transition: opacity 0.28s; })
      modal.style.setProperty('transition', 'none', 'important');
      modal.style.setProperty('opacity', '1', 'important');
      modal.style.backgroundColor = isDialogModal ? `rgba(10, 18, 10, ${initialAlpha.toFixed(3)})` : 'transparent';

      // AKTIFKAN MODAL TERLEBIH DAHULU agar layout memiliki dimensi nyata (bukan display: none / width: 0)!
      if (window.Modal) {
        window.Modal.activeModal = modal;
        modal.classList.add('is-active');
        if (!window.Modal.historyPushed) {
          if (!window.history.state || !window.history.state.modalOpen) {
            window.history.pushState({ modalOpen: true, modalId: modal.id }, '');
            window.Modal.historyPushed = true;
          }
        }
      } else {
        modal.classList.add('is-active');
      }
      document.body.classList.add('has-folder-modal-open');
      modal.style.removeProperty('pointer-events');

      modal._activeSourceFolder = folderEl;
      folderEl._activeTargetModal = modal;
      modal._isClosingWithMorph = false;

      // Siapkan container modal
      win._cachedMorph = null;
      win._bgSet = false;
      win.style.setProperty('transition', 'none', 'important');
      win.style.setProperty('transform-origin', 'center center', 'important');
      win.style.willChange = 'transform';
      // Container UI interaktif langsung saat animasi masuk berlangsung
      win.style.setProperty('pointer-events', 'auto', 'important');
      modal.style.removeProperty('pointer-events');

      // Ukur geometri murni saat modal sudah aktif (dimensi nyata 100% akurat)
      const geom = this._measureMorphGeometry(folderEl, win, modal);
      win._morphGeom = geom;
      const insert = folderEl.querySelector('.folder-svg-insert') || sheet;

      const solidCardBg = geom.targetBg || (isFullScreen ? 'var(--bg-dashboard)' : 'var(--bg-panel)');
      win.style.backgroundColor = solidCardBg;
      win.style.borderColor = 'transparent';
      win._bgSet = true;

      // Flap folder mulai membuka secara sinkron dengan morph kartu (dimulai dari startP saat reversal)
      // Flap folder & folder graphic tactile bounce kick ticker
      this._removeFlapOverlay(modal, folderEl);
      this._runFolderTicker(folderEl, true);

      const header = win.querySelector('.folder-modal-header, .modal-header');
      const body = win.querySelector('.folder-modal-body, .modal-body');
      const footer = win.querySelector('.folder-modal-footer, .modal-footer');
      const skeleton = win.querySelector('.folder-morph-skeleton');

      // Promote cross-fading subtrees to compositor layers once (cheap blend
      // per frame instead of per-frame layer decisions + repaints)
      this._setMorphLayerHint(win, header, body, footer, skeleton, true);

      // Batalkan spring atau kick timer yang sedang berjalan (jika ada)
      if (win._morphCancel) {
        win._morphCancel();
        win._morphCancel = null;
      }
      if (win._kickLaunchTimer) {
        clearTimeout(win._kickLaunchTimer);
        win._kickLaunchTimer = null;
      }

      const launchSpring = () => {
        if (!modal.classList.contains('is-active') && !modal._activeSourceFolder) return;
        if (modal._isClosingWithMorph) return;

        // Sembunyikan SVG statis di folder tepat saat kartu melesat keluar
        insert.style.opacity = '0';
        win.style.opacity = '1';

        this._mountMorphSvg(skeleton, insert);

        this._applyMorphFrame(folderEl, modal, win, startP, geom, true);

        // Bouncy spring with juicy downward overshoot for action modals (New Project & Import Project)
        const isActionModal = (geom && geom.isActionFolder) || modal.id === 'modal-new-project' || modal.id === 'modal-import-project';
        win._morphCancel = this.spring({
          from: startP,
          to: 1.0,
          stiffness: isActionModal ? (isMobile ? 290 : 250) : (isMobile ? 310 : 270),
          damping: isActionModal ? (isMobile ? 20 : 17.5) : (isMobile ? 29 : 28),
          mass: 1.0,
          onUpdate: (p) => {
            this._applyMorphFrame(folderEl, modal, win, p, geom, true);
          },
          onComplete: () => {
            win._morphProgress = 1.0;
            win.style.removeProperty('transform');
            win.style.removeProperty('will-change');
            win.style.opacity = '1';
            win.style.backgroundColor = '';
            win.style.removeProperty('border-radius');
            win.style.borderColor = '';
            win.style.removeProperty('pointer-events');
            this._setMorphLayerHint(win, header, body, footer, skeleton, false);
            if (header) { header.style.opacity = '1'; header.style.visibility = 'visible'; }
            if (body) { body.style.opacity = '1'; body.style.visibility = 'visible'; }
            if (footer) { footer.style.opacity = '1'; footer.style.visibility = 'visible'; }
            if (skeleton) { skeleton.style.opacity = '0'; skeleton.style.visibility = 'hidden'; }
            win._bgSet = false;
            modal.style.removeProperty('pointer-events');
            if (header) header.style.opacity = '';
            if (body) body.style.opacity = '';
            if (footer) footer.style.opacity = '';
            if (skeleton) {
              skeleton.style.opacity = '0';
              skeleton.innerHTML = '';
            }
            this._removeFlapOverlay(modal, folderEl);
            win._morphCancel = null;
          }
        });
      };

      // Launch immediately with zero delay so backdrop overlay and card animate synchronously
      launchSpring();
    }

    /**
     * Close morph:
     * Fully reversible and spam-proof.
     * 
     * @param {HTMLElement} folderEl
     * @param {HTMLElement} modal
     * @param {Function} [onComplete]
     */
    closeFolderWithMorph(folderEl, modal, onComplete) {
      if (!folderEl || !modal) {
        if (typeof onComplete === 'function') onComplete();
        return;
      }
      const sheet = folderEl.querySelector('.folder-insert-sheet') || folderEl.querySelector('.folder-svg-insert') || folderEl;
      const insert = folderEl.querySelector('.folder-svg-insert') || sheet;
      const win = modal.querySelector('.folder-modal-card') || modal.querySelector('.modal-card') || modal.querySelector('.finder-window');
      if (!sheet || !win) {
        this.animateFolderFlap(folderEl, false);
        if (typeof onComplete === 'function') onComplete();
        return;
      }

      modal._isClosingWithMorph = true;
      folderEl.classList.remove('is-open');
      folderEl.classList.add('is-closing', 'is-animating', 'no-hover');
      if (typeof folderEl.blur === 'function') folderEl.blur();

      if (win && win._kickLaunchTimer) {
        clearTimeout(win._kickLaunchTimer);
        win._kickLaunchTimer = null;
      }

      // Bebaskan backdrop & kunci container agar klik tidak terhalang selama animasi keluar
      win.style.setProperty('pointer-events', 'none', 'important');
      modal.style.setProperty('pointer-events', 'none', 'important');

      // Hitung geometri murni neutral terbaru untuk target kembali yang presisi 100%
      const geom = this._measureMorphGeometry(folderEl, win, modal);
      win._morphGeom = geom;

      const isMobile = window.innerWidth <= 600;
      const isFullScreen = isMobile && (modal.id === 'modal-extensions' || (win && win.classList.contains('extension-modal-card')));

      const startP = typeof win._morphProgress === 'number' ? Math.max(0, Math.min(1, win._morphProgress)) : 1.0;

      win.style.setProperty('transition', 'none', 'important');
      win.style.setProperty('transform-origin', 'center center', 'important');
      win.style.willChange = 'transform';
      win.style.opacity = '1';
      const solidCardBg = geom.targetBg || (isFullScreen ? 'var(--bg-dashboard)' : 'var(--bg-panel)');
      win.style.backgroundColor = solidCardBg;
      win.style.borderColor = 'transparent';
      win._bgSet = true;

      if (win._morphCancel) win._morphCancel();
      win._cachedMorph = null;

      const header = win.querySelector('.folder-modal-header, .modal-header');
      const body = win.querySelector('.folder-modal-body, .modal-body');
      const footer = win.querySelector('.folder-modal-footer, .modal-footer');
      const skeleton = win.querySelector('.folder-morph-skeleton');

      this._setMorphLayerHint(win, header, body, footer, skeleton, true);

      this._mountMorphSvg(skeleton, insert);

      let arrivalBounceTriggered = false;
      const triggerArrivalBounce = () => {
        if (arrivalBounceTriggered) return;
        arrivalBounceTriggered = true;
        this._runFolderArrivalBounce(folderEl);
      };

      // If already at or about to enter folder slot, trigger arrival bounce immediately
      if (startP <= 0.10) {
        triggerArrivalBounce();
      }

      const finishClose = () => {
        if (!modal._isClosingWithMorph && !modal.classList.contains('is-active')) return;
        win._morphProgress = 0.0;
        win._morphGeom = null;
        win._cachedMorph = null;
        win._morphCancel = null;
        win._bgSet = false;
        modal._isClosingWithMorph = false;
        modal._activeSourceFolder = null;
        folderEl._activeTargetModal = null;
        folderEl.classList.remove('is-open', 'is-closing');
        if (typeof folderEl.blur === 'function') folderEl.blur();

        if (insert) {
          insert.style.opacity = '1';
          insert.style.transform = '';
        }
        if (sheet) sheet.style.opacity = '1';

        // Pulihkan penutup asli seketika sebelum modal dinonaktifkan agar flap tidak hilang sedetik pun
        this._removeFlapOverlay(modal, folderEl);

        const front = folderEl.querySelector('.folder-svg-front-group') || folderEl.querySelector('.folder-svg-front');
        if (front) {
          front.style.opacity = '1';
          const curFlap = (typeof folderEl._currentRot === 'number') ? folderEl._currentRot : 0;
          front.style.transform = `perspective(240px) rotateX(${curFlap.toFixed(1)}deg)`;
        }

        if (!folderEl._arrivalBounceRunning) {
          folderEl.classList.remove('is-animating');
          this._bindPostCloseHover(folderEl);
        }

        // Nonaktifkan backdrop seketika tanpa memicu CSS transition fade-out dari background gelap
        modal.style.setProperty('transition', 'none', 'important');
        modal.style.setProperty('opacity', '0', 'important');
        modal.style.setProperty('background-color', 'transparent', 'important');
        modal.classList.remove('is-active');
        if (window.Modal && window.Modal.activeModal === modal) {
          window.Modal.activeModal = null;
        }
        if (!document.querySelector('#modal-extensions.is-active, #modal-community.is-active, #modal-new-project.is-active, #modal-import-project.is-active')) {
          document.body.classList.remove('has-folder-modal-open');
        }

        win.style.removeProperty('transform');
        win.style.removeProperty('will-change');
        win.style.opacity = '';
        win.style.backgroundColor = '';
        win.style.removeProperty('border-radius');
        win.style.borderColor = '';
        win.style.removeProperty('pointer-events');
        this._setMorphLayerHint(win, header, body, footer, skeleton, false);
        modal.style.removeProperty('pointer-events');
        if (header) { header.style.opacity = ''; header.style.visibility = ''; }
        if (body) { body.style.opacity = ''; body.style.visibility = ''; }
        if (footer) { footer.style.opacity = ''; footer.style.visibility = ''; }
        if (skeleton) {
          skeleton.style.opacity = '0';
          skeleton.style.visibility = '';
          skeleton.innerHTML = '';
        }

        // Bersihkan inline style modal di frame berikutnya saat status inactive sudah terkunci
        requestAnimationFrame(() => {
          modal.style.removeProperty('opacity');
          modal.style.removeProperty('background-color');
          modal.style.removeProperty('transition');
        });

        // Note: Do NOT abort _folderTickerCancel or reset graphic here;
        // allow the folder icon's physical cushion squash & rebound bounce to complete naturally!

        if (typeof onComplete === 'function') {
          const cb = onComplete;
          onComplete = null;
          cb();
        } else if (window.Modal && window.Modal.historyPushed && window.history.state && window.history.state.modalOpen) {
          window.Modal.historyPushed = false;
          window._modalClosingHistoryBack = true;
          window.history.back();
          setTimeout(() => {
            window._modalClosingHistoryBack = false;
          }, 350);
        }
      };

      // Snappy, responsive spring for returning modal window into the folder slot
      win._morphCancel = this.spring({
        from: startP,
        to: 0.0,
        stiffness: isMobile ? 350 : 330,
        damping: isMobile ? 26 : 24,
        mass: 1.0,
        onUpdate: (p) => {
          if (p <= 0.10) {
            triggerArrivalBounce();
          }
          this._applyMorphFrame(folderEl, modal, win, p, geom, false);
        },
        onComplete: () => {
          triggerArrivalBounce();
          finishClose();
        }
      });
    }

    /**
     * Initializes all desktop folder items to use FolderAnimationEngine spring animation.
     */
    initDesktopFolders() {
      const folders = document.querySelectorAll('.desktop-folder-item, .btn-new-project, .btn-import-project');
      if (!folders.length) return;

      folders.forEach((btn) => {
        // Prevent sticky touch hover on mobile / touch screen
        btn.addEventListener('touchstart', () => {
          btn.classList.add('no-hover');
        }, { passive: true });
        btn.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'touch') {
            btn.classList.add('no-hover');
          }
        }, { passive: true });
        btn.addEventListener('pointerenter', (e) => {
          if (e.pointerType === 'mouse' && !btn.classList.contains('is-closing') && !btn.classList.contains('is-animating') && !btn.classList.contains('is-open')) {
            btn.classList.remove('no-hover');
          }
        }, { passive: true });

        const svg = btn.querySelector('.desktop-folder-svg');
        if (svg) {
          let frontGroup = svg.querySelector('.folder-svg-front-group');
          const front = svg.querySelector('.folder-svg-front');
          const line = svg.querySelector('.folder-svg-line');
          if (!frontGroup && front) {
            frontGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            frontGroup.setAttribute('class', 'folder-svg-front-group');
            svg.insertBefore(frontGroup, front);
            frontGroup.appendChild(front);
            if (line) frontGroup.appendChild(line);
          }
          if (frontGroup) {
            frontGroup.style.transformBox = 'fill-box';
            frontGroup.style.transformOrigin = '50% 100%';
          }
          const insert = svg.querySelector('.folder-svg-insert');
          if (insert) {
            insert.style.transformBox = 'fill-box';
            insert.style.transformOrigin = '50% 100%';
          }
        }
      });

      // Synchronize with ModalManager so when modal closes, morph back and spring shut!
      this._hookModalIfNeeded();

      // Add mobile handle bar pill tap to dismiss drawer
      document.querySelectorAll('.folder-modal-handle').forEach((h) => {
        if (!h._tapDismissInit) {
          h._tapDismissInit = true;
          h.addEventListener('click', (e) => {
            if (window.innerWidth <= 600) {
              if (window.Modal) window.Modal.close();
            }
          });
        }
      });

      // Passive resize listener to invalidate cached geometry if orientation / size changes
      if (!window._folderAnimResizeInit) {
        window._folderAnimResizeInit = true;
        window.addEventListener('resize', () => {
          document.querySelectorAll('.folder-modal-card, .modal-card, .finder-window').forEach(w => {
            w._morphGeom = null;
            w._morphTargetRadiusTop = null;
            w._morphTargetRadiusBottom = null;
            w._morphTargetBg = null;
          });
        }, { passive: true });
      }
    }

    /**
     * Intercepts ModalManager close calls so closing folder modals triggers smooth morph & spring physics.
     */
    _hookModalIfNeeded() {
      if (window.Modal && !window.Modal._folderHooked) {
        window.Modal._folderHooked = true;
        const origClose = window.Modal.close.bind(window.Modal);
        window.Modal.close = (modalTargetOrTriggerBack, triggerHistoryBack) => {
          let targetEl = null;
          let shouldTriggerHistory = true;
          if (typeof modalTargetOrTriggerBack === 'boolean') {
            shouldTriggerHistory = modalTargetOrTriggerBack;
          } else if (typeof modalTargetOrTriggerBack === 'string') {
            targetEl = document.getElementById(modalTargetOrTriggerBack);
            if (typeof triggerHistoryBack === 'boolean') {
              shouldTriggerHistory = triggerHistoryBack;
            }
          } else if (modalTargetOrTriggerBack instanceof HTMLElement) {
            targetEl = modalTargetOrTriggerBack;
            if (typeof triggerHistoryBack === 'boolean') {
              shouldTriggerHistory = triggerHistoryBack;
            }
          }
          const active = targetEl || window.Modal.activeModal;

          let srcFolder = active ? active._activeSourceFolder : null;
          if (!srcFolder && active) {
            if (active.id === 'modal-extensions') {
              srcFolder = document.getElementById('btn-folder-extensions');
            } else if (active.id === 'modal-community') {
              srcFolder = document.getElementById('btn-folder-community');
            } else if (active.id === 'modal-new-project') {
              srcFolder = document.querySelector('.btn-new-project');
            } else if (active.id === 'modal-import-project') {
              srcFolder = document.querySelector('.btn-import-project');
            }
          }
          if (active && srcFolder) {
            if (active._isClosingWithMorph) return;
            active._isClosingWithMorph = true;
            this.closeFolderWithMorph(srcFolder, active, () => {
              active._isClosingWithMorph = false;
              active._activeSourceFolder = null;
              origClose(active, shouldTriggerHistory);
            });
            return;
          }
          const folders = document.querySelectorAll('.desktop-folder-item, .action-btn');
          folders.forEach((f) => {
            if (f.classList.contains('is-open')) {
              this.animateFolder(f, false);
            }
          });
          return origClose(modalTargetOrTriggerBack, triggerHistoryBack);
        };
      }
    }
  }

  const folderAnim = new FolderAnimationEngine();
  window.FolderAnim = folderAnim;

  // Backward compatibility forwarder in case anything calls FishToolEngine for folder anims
  if (window.FishToolEngine) {
    window.FishToolEngine.animateFolderFlap = (...args) => folderAnim.animateFolderFlap(...args);
    window.FishToolEngine.animateFolder = (...args) => folderAnim.animateFolder(...args);
    window.FishToolEngine.openFolderWithMorph = (...args) => folderAnim.openFolderWithMorph(...args);
    window.FishToolEngine.closeFolderWithMorph = (...args) => folderAnim.closeFolderWithMorph(...args);
    window.FishToolEngine.initDesktopFolders = (...args) => folderAnim.initDesktopFolders(...args);
  }

  // Auto-init folder animations once DOM is ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => folderAnim.initDesktopFolders());
    } else {
      setTimeout(() => folderAnim.initDesktopFolders(), 0);
    }
  }
})(window);
