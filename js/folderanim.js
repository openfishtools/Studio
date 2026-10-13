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

      folderEl.classList.add('is-animating');
      folderEl.classList.add('is-open');

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
        if (front && front.style.opacity !== '0') {
          front.style.transform = `perspective(240px) rotateX(${flapDeg.toFixed(1)}deg)`;
        }
        if (graphic) {
          const rotStr = isAction ? `rotate(${curRot.toFixed(1)}deg) ` : '';
          const graphicTransform = `${rotStr}scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)}) translateY(${translateY.toFixed(1)}px)`;
          graphic.style.transform = graphicTransform;
          folderEl._currentGraphicTransform = graphicTransform;
        }

        if (u >= 1) {
          folderEl._folderTickerCancel = null;
          folderEl.classList.remove('is-animating');
          folderEl._currentRot = -48;
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
        if (front && front.style.opacity !== '0') {
          front.style.transform = `perspective(240px) rotateX(${flapDeg.toFixed(1)}deg)`;
        }
        if (graphic) {
          const rotStr = isAction ? `rotate(${curRot.toFixed(1)}deg) ` : '';
          const graphicTransform = `${rotStr}scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)}) translateY(${translateY.toFixed(1)}px)`;
          graphic.style.transform = graphicTransform;
          folderEl._currentGraphicTransform = graphicTransform;
        }

        if (u >= 1) {
          folderEl._folderTickerCancel = null;
          folderEl._arrivalBounceRunning = false;
          folderEl._currentRot = 0;
          folderEl.classList.remove('is-animating', 'is-open');
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
      if (clampedP > 0.42) {
        // While card is flying toward folder: flap stays open waiting, opening slightly wider (-48deg to -52deg)
        const prog = (1.0 - clampedP) / 0.58;
        const eased = Math.sin(prog * Math.PI * 0.5);
        return -48.0 - 4.0 * eased;
      }
      // Card about to enter and plunging into slot (p <= 0.42 -> 0.0): flap slaps shut with overshoot past 0deg up to +5.2deg
      const prog = (0.42 - clampedP) / 0.42; // 0 at p=0.42, 1 at p=0
      if (prog <= 0.65) {
        const slapProg = prog / 0.65;
        const eased = slapProg * slapProg * (3 - 2 * slapProg);
        return -52.0 + 57.2 * eased; // -52 + 57.2 = +5.2deg
      } else {
        const rebProg = (prog - 0.65) / 0.35;
        const eased = rebProg * rebProg * (3 - 2 * rebProg);
        return 5.2 * (1 - eased);
      }
    }

    _setupFlapOverlay(folderEl, modal, geom) {
      if (!folderEl || !modal) return null;
      let overlay = modal.querySelector('.folder-flap-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'folder-flap-overlay';
        overlay.style.position = 'fixed';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '10005';
        overlay.style.display = 'none';
        modal.appendChild(overlay);
      }
      if (geom && typeof geom.cx === 'number' && typeof geom.cy === 'number') {
        overlay.style.left = `${(geom.cx - geom.gw / 2).toFixed(1)}px`;
        overlay.style.top = `${(geom.cy - geom.gh / 2).toFixed(1)}px`;
        overlay.style.width = `${geom.gw.toFixed(1)}px`;
        overlay.style.height = `${geom.gh.toFixed(1)}px`;
        overlay.style.transformOrigin = geom.isActionFolder ? 'center center' : '50% 100%';
      }
      const frontGroup = folderEl.querySelector('.folder-svg-front-group');
      const front = folderEl.querySelector('.folder-svg-front');
      const frontColor = front ? (front.getAttribute('fill') || 'var(--color-primary, #98ce7b)') : 'var(--color-primary, #98ce7b)';
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
      return {
        overlay,
        overlayFlap: overlay.querySelector('.overlay-flap-group')
      };
    }

    _mountMorphSvg(skeleton, insert) {
      if (!skeleton || !insert) return;
      // Gunakan seluruh SVG isi folder termasuk sheet background dengan opacity 1 solid
      // agar warna morphing dari sheet (hijau aksen) ke isi kartu pop-up bertransformasi mulus dan pekat
      const content = insert.innerHTML.replace(/opacity="0\.95"/g, 'opacity="1"');
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
        const overlay = modal.querySelector('.folder-flap-overlay');
        if (overlay) overlay.remove();
      }
      document.querySelectorAll('.folder-flap-overlay').forEach(el => el.remove());
      // Pulihkan opacity penutup asli agar tidak hilang
      const folder = folderEl || (modal && modal._activeSourceFolder);
      if (folder) {
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
      const graphic = folderEl.querySelector('.desktop-folder-graphic') || folderEl.querySelector('.btn-bg-icon');
      const svgEl = folderEl.querySelector('.desktop-folder-svg');

      const isActionFolder = folderEl.classList.contains('btn-new-project') || 
                             folderEl.classList.contains('btn-import-project') || 
                             folderEl.classList.contains('action-btn');

      // Fast neutral measurement:
      // Strip active transform from win and graphic so getBoundingClientRect reflects neutral resting layout
      const prevWinTransform = win.style.transform;
      const prevGraphicTransform = graphic ? graphic.style.transform : '';

      if (prevWinTransform && prevWinTransform !== 'none') {
        win.style.setProperty('transform', 'none', 'important');
      }
      if (prevGraphicTransform && prevGraphicTransform !== 'none') {
        graphic.style.setProperty('transform', 'none', 'important');
      }

      // Batch rect reads together
      const sRect = sheet.getBoundingClientRect();
      const tRect = win.getBoundingClientRect();
      const svgRect = svgEl ? svgEl.getBoundingClientRect() : (graphic ? graphic.getBoundingClientRect() : sRect);

      // Restore transforms
      if (prevWinTransform && prevWinTransform !== 'none') {
        win.style.transform = prevWinTransform;
      } else {
        win.style.removeProperty('transform');
      }
      if (prevGraphicTransform && prevGraphicTransform !== 'none') {
        graphic.style.transform = prevGraphicTransform;
      } else if (graphic) {
        graphic.style.removeProperty('transform');
      }

      const gw = svgRect.width || 60;
      const gh = svgRect.height || 48;
      const cx = svgRect.left + svgRect.width / 2;
      const cy = svgRect.top + svgRect.height / 2;

      const sCenterX = sRect.left + sRect.width / 2;
      const sCenterY = sRect.top + sRect.height / 2;
      const tCenterX = tRect.left + tRect.width / 2;
      const tCenterY = tRect.top + tRect.height / 2;

      const dx = sCenterX - tCenterX;
      const dy = sCenterY - tCenterY;
      const realWidth = Math.max(200, tRect.width || 320);
      const realHeight = Math.max(150, tRect.height || 200);
      const sx = Math.min(0.5, Math.max(0.01, sRect.width / realWidth));
      const sy = Math.min(0.5, Math.max(0.01, sRect.height / realHeight));

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

      return {
        dx, dy, sx, sy, sRect, tRect,
        targetRadiusTop, targetRadiusBottom, targetBg,
        startRot, cx, cy, gw, gh,
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
        srcFolder.classList.remove('is-open', 'is-animating');
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
        if (header) header.style.opacity = '';
        if (body) body.style.opacity = '';
        if (footer) footer.style.opacity = '';
        const skeleton = win.querySelector('.folder-morph-skeleton');
        if (skeleton) {
          skeleton.style.opacity = '0';
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
      const flapDeg = typeof folderEl._currentRot === 'number' ? folderEl._currentRot : this._calcFlapDeg(clampedP, isOpening);
      folderEl._currentRot = flapDeg;

      if (!win._bgSet) {
        const solidCardBg = geom.targetBg || (isFullScreen ? 'var(--bg-dashboard)' : 'var(--bg-dashboard)');
        win.style.backgroundColor = solidCardBg;
        win.style.opacity = '1';
        win._bgSet = true;
      }

      const u = clampedP;
      const eased = u * u * (3 - 2 * u);

      const uX = u < 0.18 ? 0 : (u - 0.18) / 0.82;
      const easedX = uX * uX * (3 - 2 * uX);
      const curDx = dx * (1 - easedX);

      // On mobile: subtle jump prevents jarring offscreen leaps
      const jumpProg = Math.min(1, u / 0.45);
      const slotJump = (isMobile ? -10 : -32) * Math.sin(jumpProg * Math.PI);
      const flightLift = (isMobile ? -6 : -16) * Math.sin(u * Math.PI);
      const curDy = dy * (1 - eased) + flightLift + slotJump;

      const curSx = sx + (1 - sx) * eased;
      const curSy = sy + (1 - sy) * eased;

      const baseRot = typeof geom.startRot === 'number' ? geom.startRot : 0;
      const curRot = baseRot * (1 - Math.min(1, u / 0.35));

      // Visual border radius morph:
      // Desktop: smoothly interpolate visual curvature.
      // Mobile: NEVER mutate border-radius during animation!
      // In CSS, mobile already has border-radius: 24px 24px 0 0 (drawer) or 0 (fullscreen).
      // Mutating border-radius on every frame forces full CPU re-rasterization on mobile WebKit/Blink!
      if (!isMobile) {
        const sheetVisualR = 3.0;
        const targetRTop = (typeof geom.targetRadiusTop === 'number') ? geom.targetRadiusTop : 20;
        const targetRBottom = (typeof geom.targetRadiusBottom === 'number') ? geom.targetRadiusBottom : 20;
        const curVisRTop = sheetVisualR + (targetRTop - sheetVisualR) * eased;
        const curVisRBottom = sheetVisualR + (targetRBottom - sheetVisualR) * eased;
        const minScale = Math.max(0.01, Math.min(curSx, curSy));
        const cssRTop = curVisRTop / minScale;
        const cssRBottom = curVisRBottom / minScale;
        win.style.setProperty('border-radius', `${cssRTop.toFixed(1)}px ${cssRTop.toFixed(1)}px ${cssRBottom.toFixed(1)}px ${cssRBottom.toFixed(1)}px`, 'important');
      }

      // Border color toggle (only when crossing threshold u = 0.15)
      const shouldShowBorder = u >= 0.15;
      if (cached.lastBorderColor !== shouldShowBorder) {
        cached.lastBorderColor = shouldShowBorder;
        win.style.borderColor = shouldShowBorder ? '' : 'transparent';
      }

      // Content cross-fade: only update DOM opacity during active fade window (0.08 <= u <= 0.36)
      if (u <= 0.08) {
        if (cached.opacitySettled !== 'zero') {
          cached.opacitySettled = 'zero';
          if (cached.skeleton) cached.skeleton.style.opacity = '1';
          if (cached.header) cached.header.style.opacity = '0';
          if (cached.body) cached.body.style.opacity = '0';
          if (cached.footer) cached.footer.style.opacity = '0';
        }
      } else if (u >= 0.36) {
        if (cached.opacitySettled !== 'full') {
          cached.opacitySettled = 'full';
          if (cached.skeleton) cached.skeleton.style.opacity = '0';
          if (cached.header) cached.header.style.opacity = '1';
          if (cached.body) cached.body.style.opacity = '1';
          if (cached.footer) cached.footer.style.opacity = '1';
        }
      } else {
        cached.opacitySettled = 'fading';
        const progMorph = (u - 0.08) / 0.28;
        const easedMorph = progMorph * progMorph * (3 - 2 * progMorph);
        if (cached.skeleton) cached.skeleton.style.opacity = (1 - easedMorph).toFixed(2);
        if (cached.header) cached.header.style.opacity = easedMorph.toFixed(2);
        if (cached.body) cached.body.style.opacity = easedMorph.toFixed(2);
        if (cached.footer) cached.footer.style.opacity = easedMorph.toFixed(2);
      }

      // Hardware accelerated GPU Transform
      const rotStr = Math.abs(curRot) > 0.01 ? ` rotate(${curRot.toFixed(1)}deg)` : '';
      win.style.setProperty('transform', `translate3d(${curDx.toFixed(1)}px, ${curDy.toFixed(1)}px, 0)${rotStr} scale(${curSx.toFixed(3)}, ${curSy.toFixed(3)})`, 'important');

      // Flap Overlay Choreography (zero per-frame layout property writes)
      if (cached.overlay && cached.overlayFlap && geom.cx && geom.cy) {
        if (clampedP <= 0.45) {
          if (cached.overlayVisible !== true) {
            cached.overlayVisible = true;
            cached.overlay.style.display = 'block';
            if (cached.front) cached.front.style.opacity = '0';
          }
          const syncGraphicTransform = (cached.graphic && cached.graphic.style.transform) ? cached.graphic.style.transform : (Math.abs(curRot) > 0.01 ? `rotate(${curRot.toFixed(1)}deg)` : 'none');
          cached.overlay.style.transform = syncGraphicTransform;
          cached.overlayFlap.style.transform = `perspective(240px) rotateX(${flapDeg.toFixed(1)}deg)`;
        } else {
          if (cached.overlayVisible !== false) {
            cached.overlayVisible = false;
            cached.overlay.style.display = 'none';
            if (cached.front) {
              cached.front.style.opacity = '1';
              cached.front.style.transform = `perspective(240px) rotateX(${flapDeg.toFixed(1)}deg)`;
            }
          }
        }
      } else if (cached.front) {
        cached.front.style.opacity = '1';
        cached.front.style.transform = `perspective(240px) rotateX(${flapDeg.toFixed(1)}deg)`;
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
        this.closeFolderWithMorph(folderEl, modal);
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
      const startP = typeof win._morphProgress === 'number' ? Math.max(0, Math.min(1, win._morphProgress)) : 0.0;
      const initialAlpha = isFullScreen ? 0 : (0.78 * Math.sin(Math.min(1, startP * 1.85) * Math.PI * 0.5));

      // Set backdrop transparent & transition: none SEBELUM menambahkan is-active
      // agar tidak ada flicker/kilatan hitam dari CSS default (.modal-backdrop { background-color: rgba(10,18,10,0.78); transition: opacity 0.28s; })
      modal.style.setProperty('transition', 'none', 'important');
      modal.style.setProperty('opacity', '1', 'important');
      const isFolderModal = modal.id === 'modal-extensions' || 
                            modal.id === 'modal-community' || 
                            modal.id === 'modal-new-project' || 
                            modal.id === 'modal-import-project';
      modal.style.backgroundColor = (isFullScreen || isFolderModal) ? 'transparent' : `rgba(10, 18, 10, ${initialAlpha.toFixed(3)})`;

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
      win.style.setProperty('pointer-events', 'none', 'important');
      win.querySelectorAll('button, a, input, [role="button"]').forEach(el => el.style.setProperty('pointer-events', 'none', 'important'));

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

        if (!isMobile) {
          this._mountMorphSvg(skeleton, insert);
        } else if (skeleton) {
          skeleton.style.opacity = '0';
          skeleton.innerHTML = '';
        }

        this._applyMorphFrame(folderEl, modal, win, startP, geom, true);

        // Critically damped spring untuk kartu pop-up (gerakan mulus, tanpa goyang/overshoot di window)
        win._morphCancel = this.spring({
          from: startP,
          to: 1.0,
          stiffness: isMobile ? 310 : 260,
          damping: isMobile ? 31 : 32,
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
            win._bgSet = false;
            modal.style.removeProperty('pointer-events');
            win.querySelectorAll('button, a, input, [role="button"]').forEach(el => el.style.removeProperty('pointer-events'));
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
      folderEl.classList.add('is-animating');

      if (win && win._kickLaunchTimer) {
        clearTimeout(win._kickLaunchTimer);
        win._kickLaunchTimer = null;
      }

      // Bebaskan backdrop & kunci container agar klik tidak terhalang selama animasi keluar
      win.style.setProperty('pointer-events', 'none', 'important');
      modal.style.setProperty('pointer-events', 'none', 'important');
      win.querySelectorAll('button, a, input, [role="button"]').forEach(el => el.style.setProperty('pointer-events', 'none', 'important'));

      // Reuse cached geometry if available to bypass synchronous reflow on close!
      const geom = win._morphGeom || this._measureMorphGeometry(folderEl, win, modal);
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

      if (!isMobile) {
        this._mountMorphSvg(skeleton, insert);
      } else if (skeleton) {
        skeleton.style.opacity = '0';
        skeleton.innerHTML = '';
      }

      let arrivalBounceTriggered = false;
      const triggerArrivalBounce = () => {
        if (arrivalBounceTriggered) return;
        arrivalBounceTriggered = true;
        this._runFolderArrivalBounce(folderEl);
      };

      // If already at or about to enter folder slot, trigger arrival bounce immediately
      if (startP <= 0.42) {
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

        if (insert) {
          insert.style.opacity = '1';
          insert.style.transform = '';
        }
        if (sheet) sheet.style.opacity = '1';
        this._removeFlapOverlay(modal, folderEl);
        document.querySelectorAll('.folder-flap-overlay').forEach(el => el.remove());

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
        modal.style.removeProperty('pointer-events');
        win.querySelectorAll('button, a, input, [role="button"]').forEach(el => el.style.removeProperty('pointer-events'));
        if (header) header.style.opacity = '';
        if (body) body.style.opacity = '';
        if (footer) footer.style.opacity = '';
        if (skeleton) {
          skeleton.style.opacity = '0';
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
        }
      };

      // Critically damped spring for returning modal window smoothly into the folder slot
      win._morphCancel = this.spring({
        from: startP,
        to: 0.0,
        stiffness: isMobile ? 320 : 270,
        damping: isMobile ? 32 : 33,
        mass: 1.0,
        onUpdate: (p) => {
          if (p <= 0.42) {
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

      // Add mobile titlebar tap to dismiss drawer
      document.querySelectorAll('.finder-titlebar').forEach((tb) => {
        if (!tb._tapDismissInit) {
          tb._tapDismissInit = true;
          tb.addEventListener('click', (e) => {
            if (window.innerWidth <= 600) {
              if (window.Modal) window.Modal.close();
            }
          });
        }
      });

      // Add mobile header / handle bar tap to dismiss drawer
      document.querySelectorAll('.folder-modal-header').forEach((h) => {
        if (!h._tapDismissInit) {
          h._tapDismissInit = true;
          h.addEventListener('click', (e) => {
            if (window.innerWidth <= 600 && !e.target.closest('button, a, input, select, textarea')) {
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
          const folders = document.querySelectorAll('.desktop-folder-item');
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
