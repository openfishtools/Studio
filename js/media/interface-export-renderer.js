/**
 * OpenFishTools Studio — Interface Video Export Renderer
 * Zero-dependency Canvas 2D compositor matching the real OpenFishTools Studio UI (1:1).
 * Features:
 * - Real `fticons` webfont glyphs & exact inline SVG paths from editor.html.
 * - Real FishToolEngine.getBounds() + CanvasWireframe.draw() (Null parenting, 3D Camera, Adjustment 3D).
 * - Multi-select timeline UI (trim handles, type tags, checked pills — no bottom cut/group drawer).
 * - Full Beatmark rendering on Ruler & Tracks + smooth bouncy spring hit animation on every beat.
 * - "In/Out Zoom" Easy-Ease camera rig: starts 100% full-screen video, smoothly zooms out at
 *   Beatmark 1 to reveal the Studio UI, and easy-eases back to full-screen video from the last beatmark to end.
 */
(function () {
  'use strict';

  var OUTPUT_RES_MAP = {
    mobile: {
      '2K':    [1440, 2560],
      '1080p': [1080, 1920],
      '720p':  [720, 1280],
      '480p':  [480, 854]
    },
    desktop: {
      '2K':    [2560, 1440],
      '1080p': [1920, 1080],
      '720p':  [1280, 720],
      '480p':  [854, 480]
    }
  };

  var SVG_PUZZLE_PATH = 'M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5s-1.12-2.5-2.5-2.5z';
  var SVG_SELECT_ARC_PATH = 'M15 9A6 6 0 1 0 9 15';
  var SVG_SELECT_CHECK_PATH = 'M12.5 15L14.3 16.8L17.5 13.2';

  var FTICON_CLASSES = {
    back:      'fticon-back-to-projects',
    desktop:   'fticon-desktop-view',
    template:  'fticon-template-editor',
    settings:  'fticon-composition-settings',
    export2:   'fticon-export-2',
    del:       'fticon-delete-selected-layer',
    badge3d:   'fticon-badge-3d',
    link:      'fticon-link-parent-layer',
    options:   'fticon-layer-options',
    check:     'fticon-check',
    chevLeft:  'fticon-chevron-left',
    chevRight: 'fticon-chevron-right',
    beatPin:   'fticon-icon-31',
    undo:      'fticon-undo',
    redo:      'fticon-redo',
    previous:  'fticon-previous',
    play:      'fticon-play',
    pause:     'fticon-pause',
    next:      'fticon-next',
    more:      'fticon-more',
    eye:       'fticon-eye',
    reorder:   'fticon-drag-to-reorder-layer',
    plus:      'fticon-plus'
  };

  function getOutputDims(layout, resolution) {
    var mode = (layout === 'desktop') ? 'desktop' : 'mobile';
    var resKey = (resolution && OUTPUT_RES_MAP[mode][resolution]) ? resolution : '1080p';
    var pair = OUTPUT_RES_MAP[mode][resKey];
    var w = pair[0] - (pair[0] % 2);
    var h = pair[1] - (pair[1] % 2);
    return { w: w, h: h };
  }

  // Classic After Effects Easy-Ease (symmetric cubic)
  function easyEase(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x < 0.5 ? (4 * x * x * x) : (1 - Math.pow(-2 * x + 2, 3) * 0.5);
  }

  // Ultra-smooth C2 continuous ease (zero velocity & zero acceleration at both ends — never rushes or jerks!)
  function ultraSmoothEase(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Blend cosine ease with quintic smootherstep for silky, unhurried cinema camera motion
    var s = x * x * x * (x * (x * 6 - 15) + 10);
    var c = 0.5 - 0.5 * Math.cos(Math.PI * x);
    return 0.65 * s + 0.35 * c;
  }

  function readCssVar(cs, name, fallback) {
    if (!cs) return fallback;
    var val = cs.getPropertyValue(name);
    if (!val) return fallback;
    val = val.trim();
    return val || fallback;
  }

  function parseColorLuminance(colorStr) {
    if (!colorStr || typeof colorStr !== 'string') return 0.5;
    var s = colorStr.trim();
    var r = 128, g = 128, b = 128;
    if (s.charAt(0) === '#') {
      var hex = s.slice(1);
      if (hex.length === 3) {
        r = parseInt(hex.charAt(0) + hex.charAt(0), 16);
        g = parseInt(hex.charAt(1) + hex.charAt(1), 16);
        b = parseInt(hex.charAt(2) + hex.charAt(2), 16);
      } else if (hex.length >= 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }
    } else if (s.indexOf('rgb') === 0) {
      var m = s.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        r = parseFloat(m[0]);
        g = parseFloat(m[1]);
        b = parseFloat(m[2]);
      }
    }
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return 0.5;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function resolveFticonGlyphs() {
    var glyphs = {};
    var keys = Object.keys(FTICON_CLASSES);
    if (typeof document === 'undefined' || !document.body || typeof getComputedStyle !== 'function') {
      for (var k0 = 0; k0 < keys.length; k0++) glyphs[keys[k0]] = '';
      return glyphs;
    }
    var probe = document.createElement('span');
    probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
    try {
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        probe.className = 'fticon ' + FTICON_CLASSES[key];
        var raw = getComputedStyle(probe, '::before').content || '';
        if ((raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"') ||
            (raw.charAt(0) === "'" && raw.charAt(raw.length - 1) === "'")) {
          raw = raw.slice(1, -1);
        }
        glyphs[key] = (raw && raw !== 'none' && raw !== 'normal') ? raw : '';
      }
    } finally {
      if (probe.parentNode) probe.parentNode.removeChild(probe);
    }
    return glyphs;
  }

  // Resolve user's UI Scale setting (80%..130%) from Studio settings once per session
  function resolveUserUiScale() {
    var pct = null;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var rawEditor = localStorage.getItem('oft_ui_scale_editor');
        var rawDesktop = localStorage.getItem('oft_ui_scale_desktop');
        var rawGeneric = localStorage.getItem('oft_ui_scale');
        var pick = (rawEditor !== null && rawEditor !== '') ? rawEditor
          : ((rawDesktop !== null && rawDesktop !== '') ? rawDesktop : rawGeneric);
        if (pick !== null && pick !== undefined && pick !== '') {
          var parsed = parseFloat(pick);
          if (Number.isFinite(parsed)) pct = parsed;
        }
      }
    } catch (_) {}

    if (pct === null && typeof window !== 'undefined' && typeof window.getUiScale === 'function') {
      try {
        var fnVal = Number(window.getUiScale());
        if (Number.isFinite(fnVal) && fnVal > 0) pct = fnVal;
      } catch (_) {}
    }

    if (pct === null && typeof window !== 'undefined' && typeof getComputedStyle === 'function' && document && document.documentElement) {
      var cssScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--oft-ui-scale'));
      if (Number.isFinite(cssScale) && cssScale > 0.4 && cssScale < 3.0) {
        return Math.max(0.8, Math.min(1.3, cssScale));
      }
    }

    if (pct !== null && Number.isFinite(pct)) {
      var clamped = Math.max(80, Math.min(130, pct));
      return clamped / 100;
    }
    return 1.0;
  }

  function resolveThemePalette() {
    var cs = (typeof window !== 'undefined' && typeof getComputedStyle === 'function' && document && document.documentElement)
      ? getComputedStyle(document.documentElement)
      : null;

    var palette = {
      bgCanvas:        readCssVar(cs, '--bg-canvas', '#151b10'),
      bgPanel:         readCssVar(cs, '--bg-panel', '#212a1a'),
      bgPanelInner:    readCssVar(cs, '--bg-panel-inner', '#1b2315'),
      bgTimeline:      readCssVar(cs, '--bg-timeline', '#181f13'),
      bgPreview:       readCssVar(cs, '--bg-preview', '#0f140b'),
      borderDefault:   readCssVar(cs, '--border-default', '#2f3c24'),
      borderSubtle:    readCssVar(cs, '--border-subtle', '#26311d'),
      gridLineThin:    readCssVar(cs, '--grid-line-thin', 'rgba(199, 220, 156, 0.16)'),
      colorPrimary:    readCssVar(cs, '--color-primary', '#c7dc9c'),
      colorPrimaryHov: readCssVar(cs, '--color-primary-hover', '#d8e9b5'),
      colorAccent:     readCssVar(cs, '--color-accent', '#9cb477'),
      textPrimary:     readCssVar(cs, '--text-primary', '#e6f0d2'),
      textSecondary:   readCssVar(cs, '--text-secondary', '#9fb08a'),
      textMuted:       readCssVar(cs, '--text-muted', '#738560'),
      trackVideo:      readCssVar(cs, '--track-video', '#c7dc9c'),
      trackVideoDark:  readCssVar(cs, '--track-video-dark', '#6e8254'),
      trackImage:      readCssVar(cs, '--track-image', '#d8e9b5'),
      trackImageDark:  readCssVar(cs, '--track-image-dark', '#6e8254'),
      trackAudio:      readCssVar(cs, '--track-audio', '#b3ca89'),
      trackAudioDark:  readCssVar(cs, '--track-audio-dark', '#6e8254'),
      trackAdj:        readCssVar(cs, '--track-adj', '#9cb477'),
      trackAdjDark:    readCssVar(cs, '--track-adj-dark', '#4c5d39'),
      trackColor:      readCssVar(cs, '--track-color', '#e4f0ca'),
      trackColorDark:  readCssVar(cs, '--track-color-dark', '#748c5a'),
      trackText:       readCssVar(cs, '--track-text', '#d5e6b1'),
      trackTextDark:   readCssVar(cs, '--track-text-dark', '#6e8254'),
      fontBrand:       readCssVar(cs, '--font-brand', 'sans-serif'),
      fontMono:        readCssVar(cs, '--font-mono', 'monospace')
    };

    var bgLum = parseColorLuminance(palette.bgCanvas);
    palette.isLightTheme = bgLum > 0.55;
    palette.darkInk = palette.isLightTheme ? palette.textPrimary : palette.bgCanvas;
    palette.lightInk = palette.isLightTheme ? palette.bgCanvas : palette.textPrimary;
    return palette;
  }

  function resolveLayerTypeTag(layer) {
    if (!layer) return 'IMG';
    if (layer.type === 'shape') return 'SHP';
    if (layer.type === 'text') return 'TXT';
    if (layer.type === 'video') return 'VID';
    if (layer.type === 'audio') return 'AUD';
    if (layer.type === 'adjustment') return 'ADJ';
    if (layer.type === 'camera') return layer.isOverlapCamera ? 'O-CAM' : 'CAM';
    if (layer.type === 'null') return layer.isOverlapNull ? 'O-NULL' : 'NULL';
    if (layer.type === 'precomp') {
      if (layer.groupType === 'mask') return 'MASK';
      if (layer.groupType === 'exclude') return 'EXCL';
      return 'COMP';
    }
    if (layer.type === 'color') return 'CLR';
    if (layer.type === 'light') return 'LGH';
    return 'IMG';
  }

  function getTrackColorsForType(type, palette) {
    switch (type) {
      case 'video':
        return { fill: palette.trackVideo, dim: palette.trackVideoDark };
      case 'image':
        return { fill: palette.trackImage, dim: palette.trackImageDark };
      case 'audio':
        return { fill: palette.trackAudio, dim: palette.trackAudioDark };
      case 'adjustment':
        return { fill: palette.trackAdj, dim: palette.trackAdjDark };
      case 'text':
        return { fill: palette.trackText, dim: palette.trackTextDark };
      case 'camera':
      case 'null':
        return { fill: palette.colorAccent, dim: palette.trackAdjDark };
      case 'precomp':
        return { fill: palette.colorPrimary, dim: palette.trackVideoDark };
      case 'shape':
      case 'color':
      default:
        return { fill: palette.trackColor, dim: palette.trackColorDark };
    }
  }

  function extractLayerKeyframes(layer) {
    var times = [];
    if (!layer) return times;
    var seen = Object.create(null);
    if (layer.keyframes && typeof layer.keyframes === 'object') {
      var keys = Object.keys(layer.keyframes);
      for (var i = 0; i < keys.length; i++) {
        var list = layer.keyframes[keys[i]];
        if (!Array.isArray(list)) continue;
        for (var j = 0; j < list.length; j++) {
          var kf = list[j];
          if (!kf) continue;
          var t = (typeof kf.time === 'number') ? kf.time : ((typeof kf.t === 'number') ? kf.t : null);
          if (t === null || !Number.isFinite(t)) continue;
          var bucket = Math.round(t * 100);
          if (!seen[bucket]) {
            seen[bucket] = true;
            times.push(t);
          }
        }
      }
    }
    if (Array.isArray(layer.effects)) {
      for (var ei = 0; ei < layer.effects.length; ei++) {
        var eff = layer.effects[ei];
        if (!eff || !eff.keyframes || typeof eff.keyframes !== 'object') continue;
        var eKeys = Object.keys(eff.keyframes);
        for (var ek = 0; ek < eKeys.length; ek++) {
          var eList = eff.keyframes[eKeys[ek]];
          if (!Array.isArray(eList)) continue;
          for (var ej = 0; ej < eList.length; ej++) {
            var ekf = eList[ej];
            var et = ekf && typeof ekf.time === 'number' ? ekf.time : null;
            if (et === null || !Number.isFinite(et)) continue;
            var eb = Math.round(et * 100);
            if (!seen[eb]) {
              seen[eb] = true;
              times.push(et);
            }
          }
        }
      }
    }
    times.sort(function (a, b) { return a - b; });
    return times;
  }

  // Parse beatmarks & markerNames once per session (mirrors getMarkerNameForTime in editor-timeline-core.js)
  function parseProjectBeatmarks(ps, fps) {
    var raw = (ps && Array.isArray(ps.beatmarks)) ? ps.beatmarks : [];
    var markerNames = (ps && ps.markerNames && typeof ps.markerNames === 'object') ? ps.markerNames : {};
    var mKeys = Object.keys(markerNames);
    var tol = 0.5 / Math.max(1, fps || 60);
    var nums = [];
    for (var i = 0; i < raw.length; i++) {
      var v = parseFloat(raw[i]);
      if (Number.isFinite(v) && v >= 0) nums.push(v);
    }
    nums.sort(function (a, b) { return a - b; });

    var result = [];
    for (var j = 0; j < nums.length; j++) {
      var t = nums[j];
      if (j > 0 && Math.abs(t - nums[j - 1]) < 0.001) continue;
      var name = '';
      if (markerNames[t] !== undefined && markerNames[t] !== '') {
        name = String(markerNames[t]);
      } else if (markerNames[String(t)] !== undefined && markerNames[String(t)] !== '') {
        name = String(markerNames[String(t)]);
      } else {
        for (var mk = 0; mk < mKeys.length; mk++) {
          if (Math.abs(parseFloat(mKeys[mk]) - t) <= tol && markerNames[mKeys[mk]]) {
            name = String(markerNames[mKeys[mk]]);
            break;
          }
        }
      }
      result.push({
        time: t,
        name: name,
        isNamed: Boolean(name),
        index: result.length + 1
      });
    }
    return result;
  }

  function formatStudioTimecode(sec, fps) {
    var clamped = sec > 0 ? sec : 0;
    var safeFps = fps > 0 ? Math.round(fps) : 60;
    var totalFrames = Math.floor(clamped * safeFps + 1e-6);
    var ff = totalFrames % safeFps;
    var totalSec = Math.floor(totalFrames / safeFps);
    var ss = totalSec % 60;
    var totalMin = Math.floor(totalSec / 60);
    var mm = totalMin % 60;
    var hh = Math.floor(totalMin / 60);
    return (hh < 10 ? '0' + hh : '' + hh) + ':' +
           (mm < 10 ? '0' + mm : '' + mm) + ':' +
           (ss < 10 ? '0' + ss : '' + ss) + ':' +
           (ff < 10 ? '0' + ff : '' + ff);
  }

  function drawRoundedRectPath(ctx, x, y, w, h, r) {
    var radius = r;
    if (radius > w * 0.5) radius = w * 0.5;
    if (radius > h * 0.5) radius = h * 0.5;
    if (radius < 0) radius = 0;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function drawLeftRoundedRectPath(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function drawRightRoundedRectPath(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  }

  function drawTopRoundedRectPath(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w * 0.5, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  function drawBottomRoundedRectPath(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w * 0.5, h);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.closePath();
  }

  function drawFticon(ctx, glyph, cx, cy, sizePx, color) {
    if (!glyph) return;
    ctx.fillStyle = color;
    ctx.font = Math.round(sizePx) + 'px fticons';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, cx, cy);
  }

  function drawSvgPathIcon(ctx, pathObj, cx, cy, sizePx, color, isStroke, strokeWidth) {
    if (!pathObj) return;
    ctx.save();
    var sc = sizePx / 24;
    ctx.translate(cx - sizePx * 0.5, cy - sizePx * 0.5);
    ctx.scale(sc, sc);
    if (isStroke) {
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth || 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(pathObj);
    } else {
      ctx.fillStyle = color;
      ctx.fill(pathObj);
    }
    ctx.restore();
  }

  function drawMotionBlurSvg(ctx, cx, cy, sizePx, color) {
    ctx.save();
    var sc = sizePx / 24;
    ctx.translate(cx - sizePx * 0.5, cy - sizePx * 0.5);
    ctx.scale(sc, sc);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.arc(6.5, 12, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.arc(11.5, 12, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.beginPath(); ctx.arc(16.5, 12, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Authentic Map-Pin / After Effects Marker drop + squash-bounce:
  // Pre-beat lead-in (-0.065s .. 0s) drops the pin from above so IMPACT lands at dtHit === 0.000s
  // (0ms lag, 0px offset — dead center on the playhead needle & audio beat!).
  var PIN_LEAD_SEC = 0.065;
  var PIN_BOUNCE_SEC = 0.38;

  function evalPinDropAnim(dtHit) {
    if (dtHit < -PIN_LEAD_SEC) return null;
    if (dtHit >= PIN_BOUNCE_SEC) {
      return { active: false, scaleX: 1, scaleY: 1, offsetY: 0, alpha: 1, pulse: 0, lineProg: 1 };
    }

    if (dtHit < 0) {
      // Pre-beat drop-in (-0.065s -> 0.000s): accelerates downward to land squarely on t = bm.time
      var u = (dtHit + PIN_LEAD_SEC) / PIN_LEAD_SEC; // 0..1
      var accel = u * u;
      return {
        active: true,
        scaleX: 0.65 + 0.25 * u,
        scaleY: 0.35 + 0.90 * u,
        offsetY: -1.15 * (1 - accel),
        alpha: Math.min(1, u * 1.8),
        pulse: 0,
        lineProg: 0
      };
    }

    // dtHit >= 0 (EXACT BEAT IMPACT at dtHit === 0!): instant squash -> bouncy rebound -> settle
    var b = dtHit / PIN_BOUNCE_SEC; // 0..1
    var wave = Math.exp(-6.5 * b) * Math.cos(b * Math.PI * 3.2);
    // At b = 0 (exact beat): wave = +1 -> instant impact squash on (playheadX, pinTipY), then springs tall!
    var scaleY = 1.0 - 0.32 * wave;
    var scaleX = 1.0 + 0.26 * wave;
    var pulse = Math.pow(1 - b, 1.6);
    var lineProg = easyEase(Math.min(1, 0.35 + (dtHit / 0.12) * 0.65));

    return {
      active: true,
      scaleX: scaleX,
      scaleY: scaleY,
      offsetY: 0.0,
      alpha: 1.0,
      pulse: pulse,
      lineProg: lineProg
    };
  }

  // Draw classic After Effects pentagon/shield marker pin with bottom tip at (0, 0)
  function drawAeMarkerPinPath(ctx, w, h, r) {
    var hw = w * 0.5;
    var shoulderY = -h * 0.42;
    var topY = -h;
    var rad = Math.min(r, hw * 0.65, (h * 0.58) * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, 0); // Sharp bottom pin point
    ctx.lineTo(-hw, shoulderY);
    ctx.lineTo(-hw, topY + rad);
    ctx.quadraticCurveTo(-hw, topY, -hw + rad, topY);
    ctx.lineTo(hw - rad, topY);
    ctx.quadraticCurveTo(hw, topY, hw, topY + rad);
    ctx.lineTo(hw, shoulderY);
    ctx.closePath();
  }

  // Compute UI reveal factor u in [0..1]:
  // u = 0 -> 100% full-screen video
  // u = 1 -> 100% normal Studio Interface UI
  // - Intro zoom-out spans smoothly from Beatmark 1 (bms[0]) to Beatmark 2 (bms[1]).
  // - Outro zoom-in spans unhurriedly from the ending beatmark to totalDur.
  function computeInOutZoomReveal(session, t, totalDur) {
    if (!session.inOutZoom) return 1.0;
    var dur = Math.max(0.5, totalDur || 5);
    var bms = session.beatmarks;
    var tInStart, tInEnd, tOutStart;

    if (bms && bms.length >= 2) {
      tInStart = bms[0].time;
      // Span strictly from 1st beatmark to 2nd beatmark (with a gentle floor so sub-second double-beats never rush)
      var rawSecond = bms[1].time;
      var minSmoothIn = Math.min(1.35, Math.max(0.6, (dur - tInStart) * 0.25));
      tInEnd = Math.max(rawSecond, tInStart + minSmoothIn);

      // Pick ending zoom-in start: last beatmark, but if it's tucked too close to totalDur (< 1.8s left),
      // step back to an earlier beatmark / unhurried window so the final zoom-in glides smoothly!
      tOutStart = bms[bms.length - 1].time;
      var minSmoothOut = Math.min(2.2, Math.max(1.2, dur * 0.16));
      if (dur - tOutStart < minSmoothOut) {
        for (var k = bms.length - 2; k >= 1; k--) {
          if (dur - bms[k].time >= minSmoothOut) {
            tOutStart = bms[k].time;
            break;
          }
        }
        if (dur - tOutStart < minSmoothOut) {
          tOutStart = Math.max(tInEnd + 0.2, dur - minSmoothOut);
        }
      }
      if (tInEnd > tOutStart - 0.1) {
        tInEnd = Math.max(tInStart + 0.3, (tInStart + tOutStart) * 0.5);
      }
    } else if (bms && bms.length === 1) {
      tInStart = bms[0].time;
      tInEnd = Math.min(dur * 0.45, tInStart + Math.max(1.4, dur * 0.18));
      tOutStart = Math.max(tInEnd + 0.3, dur - Math.max(1.6, dur * 0.20));
    } else {
      tInStart = Math.min(1.0, dur * 0.12);
      tInEnd = tInStart + Math.max(1.4, dur * 0.18);
      tOutStart = Math.max(tInEnd + 0.3, dur - Math.max(1.6, dur * 0.20));
    }

    if (t <= tInStart) {
      return 0.0;
    }
    if (t < tInEnd) {
      return ultraSmoothEase((t - tInStart) / Math.max(0.05, tInEnd - tInStart));
    }
    if (tOutStart < dur - 0.04 && t >= tOutStart) {
      return 1.0 - ultraSmoothEase((t - tOutStart) / Math.max(0.05, dur - tOutStart));
    }
    return 1.0;
  }

  function createSession(config) {
    config = config || {};
    var ps = config.projectState || window.currentProjectState || {};
    var layout = (config.layout === 'desktop') ? 'desktop' : 'mobile';
    var dims = getOutputDims(layout, config.resolution || '1080p');
    var outW = config.outW || dims.w;
    var outH = config.outH || dims.h;
    var compW = config.compW || outW;
    var compH = config.compH || outH;
    var fps = parseInt(ps.fps || config.fps || 60, 10);
    var ppsBase = window.currentPixelsPerSecond || 80;
    var palette = resolveThemePalette();
    var glyphs = resolveFticonGlyphs();
    var highlightActive = config.highlightActive !== false;
    var beatmarks = parseProjectBeatmarks(ps, fps);

    var hasPath2D = (typeof Path2D === 'function');
    var svgPaths = {
      puzzle: hasPath2D ? new Path2D(SVG_PUZZLE_PATH) : null,
      selectArc: hasPath2D ? new Path2D(SVG_SELECT_ARC_PATH) : null,
      selectCheck: hasPath2D ? new Path2D(SVG_SELECT_CHECK_PATH) : null
    };

    var rawLayers = Array.isArray(ps.layers) ? ps.layers : [];
    var maxEndSec = 0.5;
    var parsedLayers = [];
    var cameraLayers = [];
    for (var i = 0; i < rawLayers.length; i++) {
      var l = rawLayers[i];
      if (!l || l.hidden) continue;
      var startSec = (l.startSec !== undefined) ? Number(l.startSec) : ((l.startPx || 0) / ppsBase);
      var durSec = (l.durationSec !== undefined) ? Number(l.durationSec) : ((l.widthPx || 400) / ppsBase);
      if (!Number.isFinite(startSec)) startSec = 0;
      if (!Number.isFinite(durSec) || durSec <= 0) durSec = 0.5;
      var endSec = startSec + durSec;
      if (endSec > maxEndSec) maxEndSec = endSec;
      if (l.type === 'camera') {
        cameraLayers.push({ ref: l, startSec: startSec, endSec: endSec });
      }
      var col = getTrackColorsForType(l.type, palette);
      var fillLum = parseColorLuminance(col.fill);
      var dimLum = parseColorLuminance(col.dim);
      parsedLayers.push({
        ref: l,
        id: l.id || ('layer_' + i),
        name: String(l.name || l.text || (l.type ? l.type.charAt(0).toUpperCase() + l.type.slice(1) : 'Layer') + ' ' + (i + 1)),
        type: l.type || 'shape',
        typeTag: resolveLayerTypeTag(l),
        startSec: startSec,
        durSec: durSec,
        endSec: endSec,
        isPersistent: false,
        fillColor: col.fill,
        dimColor: col.dim,
        fillTextColor: fillLum > 0.52 ? palette.darkInk : palette.lightInk,
        dimTextColor: dimLum > 0.52 ? palette.darkInk : palette.lightInk,
        keyframes: extractLayerKeyframes(l)
      });
    }

    var totalEstDur = Math.max(maxEndSec, Number(ps.defaultDuration || 0.5));
    for (var pi = 0; pi < parsedLayers.length; pi++) {
      if (parsedLayers[pi].durSec >= totalEstDur * 0.75) {
        parsedLayers[pi].isPersistent = true;
      }
    }

    // Match Portrait (412px ref) & Landscape (760px editor.html tablet/landscape ref) physical density, multiplied by user's UI Scale!
    var uiScale = (typeof config.uiScale === 'number' && config.uiScale > 0) ? config.uiScale : resolveUserUiScale();
    var baseScale = (layout === 'desktop') ? (outW / 760) : (outW / 412);
    var s = baseScale * uiScale;

    var pad = Math.round(12 * s);
    var headerH = Math.round(44 * s);
    var transportH = Math.round(42 * s);
    var rulerH = Math.round(28 * s);

    // Portrait (mobile): Stacked top/bottom.
    // Landscape (desktop): editor.html >= 601px 2-column split (Left Pane = Preview + Controller, Right Pane = Ruler + Timeline)!
    var headerY = 0;
    var previewX, previewY, previewAreaW, previewAreaH;
    var transportX, transportY, transportW;
    var timelineX, timelineW, rulerY, tracksY, tracksH;

    if (layout === 'desktop') {
      var leftPaneW = Math.round(outW * 0.50);
      previewX = 0;
      previewY = headerH;
      previewAreaW = leftPaneW;
      previewAreaH = Math.max(80, outH - headerH - transportH);

      transportX = 0;
      transportY = outH - transportH;
      transportW = leftPaneW;

      timelineX = leftPaneW;
      timelineW = outW - leftPaneW;
      rulerY = headerH;
      tracksY = rulerY + rulerH;
      tracksH = Math.max(80, outH - tracksY);
    } else {
      previewX = 0;
      previewY = headerH;
      previewAreaW = outW;
      previewAreaH = Math.round(outH * 0.455);

      transportX = 0;
      transportY = previewY + previewAreaH;
      transportW = outW;

      timelineX = 0;
      timelineW = outW;
      rulerY = transportY + transportH;
      tracksY = rulerY + rulerH;
      tracksH = Math.max(80, outH - tracksY);
    }

    var playheadX = timelineX + Math.round(timelineW * 0.5);

    var rowHeight = Math.round(32 * s);
    var rowGap = Math.round(8 * s);
    var rowPitch = rowHeight + rowGap;
    var timelinePps = Math.round(80 * s);

    // Normal UI preview box inside Left/Top Preview Well
    var wellPad = Math.round(12 * s);
    var wellX = previewX + wellPad;
    var wellY = previewY + wellPad;
    var wellW = previewAreaW - wellPad * 2;
    var wellH = previewAreaH - wellPad * 2;

    var compAspect = compW / Math.max(1, compH);
    var wellAspect = wellW / Math.max(1, wellH);
    var drawCompW, drawCompH;
    if (compAspect > wellAspect) {
      drawCompW = wellW;
      drawCompH = wellW / compAspect;
    } else {
      drawCompH = wellH;
      drawCompW = wellH * compAspect;
    }
    var drawCompX = Math.round(wellX + (wellW - drawCompW) * 0.5);
    var drawCompY = Math.round(wellY + (wellH - drawCompH) * 0.5);
    drawCompW = Math.round(drawCompW);
    drawCompH = Math.round(drawCompH);

    // Full-screen video box (when u = 0 in In/Out Zoom mode)
    var outAspect = outW / Math.max(1, outH);
    var fullCompW, fullCompH;
    if (compAspect > outAspect) {
      fullCompW = outW;
      fullCompH = outW / compAspect;
    } else {
      fullCompH = outH;
      fullCompW = outH * compAspect;
    }
    var fullCompX = (outW - fullCompW) * 0.5;
    var fullCompY = (outH - fullCompH) * 0.5;

    var compCanvas = document.createElement('canvas');
    compCanvas.width = compW;
    compCanvas.height = compH;

    // Resolve project Motion Blur settings (Shutter Angle, Shutter Phase, Samples) for Interface Motion Blur
    var interfaceMotionBlur = Boolean(config.interfaceMotionBlur);
    var mbCfg = (typeof window !== 'undefined' && window.FishMotionBlurEngine && typeof window.FishMotionBlurEngine.getConfig === 'function')
      ? window.FishMotionBlurEngine.getConfig(ps)
      : ((ps && ps.motionBlur && typeof ps.motionBlur === 'object') ? ps.motionBlur : {});
    var mbShutterAngle = (typeof mbCfg.shutterAngle === 'number' && !isNaN(mbCfg.shutterAngle)) ? Math.max(0, Math.min(720, mbCfg.shutterAngle)) : 180;
    var mbShutterPhase = (typeof mbCfg.shutterPhase === 'number' && !isNaN(mbCfg.shutterPhase)) ? Math.max(-360, Math.min(360, mbCfg.shutterPhase)) : 0;
    var mbSamples = (typeof mbCfg.samples === 'number' && mbCfg.samples >= 2) ? Math.max(2, Math.min(32, Math.round(mbCfg.samples))) : 12;

    var mbSampleCanvas = null;
    if (interfaceMotionBlur && mbShutterAngle > 0.5) {
      mbSampleCanvas = document.createElement('canvas');
      mbSampleCanvas.width = outW;
      mbSampleCanvas.height = outH;
    }

    var totalTrackContentH = parsedLayers.length * rowPitch + Math.round(16 * s);
    var maxScrollY = Math.max(0, totalTrackContentH - tracksH);

    return {
      layout: layout,
      outW: outW,
      outH: outH,
      compW: compW,
      compH: compH,
      scale: s,
      projectName: String(ps.name || 'New Project'),
      fps: fps,
      scrollMode: config.scrollMode || 'follow-top',
      highlightActive: highlightActive,
      showKeyframes: config.showKeyframes !== false,
      showWireframe: config.showWireframe !== false,
      inOutZoom: config.inOutZoom !== false,
      interfaceMotionBlur: interfaceMotionBlur,
      mbShutterAngle: mbShutterAngle,
      mbShutterPhase: mbShutterPhase,
      mbSamples: mbSamples,
      mbSampleCanvas: mbSampleCanvas,
      palette: palette,
      glyphs: glyphs,
      svgPaths: svgPaths,
      beatmarks: beatmarks,
      layers: parsedLayers,
      cameraLayers: cameraLayers,
      activeScratch: new Int32Array(Math.max(1, parsedLayers.length)),
      compCanvas: compCanvas,
      pad: pad,
      headerY: headerY,
      headerH: headerH,
      previewX: previewX,
      previewY: previewY,
      previewAreaW: previewAreaW,
      previewAreaH: previewAreaH,
      drawCompX: drawCompX,
      drawCompY: drawCompY,
      drawCompW: drawCompW,
      drawCompH: drawCompH,
      fullCompX: fullCompX,
      fullCompY: fullCompY,
      fullCompW: fullCompW,
      fullCompH: fullCompH,
      transportX: transportX,
      transportY: transportY,
      transportW: transportW,
      transportH: transportH,
      rulerY: rulerY,
      rulerH: rulerH,
      tracksY: tracksY,
      tracksH: tracksH,
      timelineX: timelineX,
      timelineW: timelineW,
      playheadX: playheadX,
      rowHeight: rowHeight,
      rowGap: rowGap,
      rowPitch: rowPitch,
      timelinePps: timelinePps,
      totalTrackContentH: totalTrackContentH,
      maxScrollY: maxScrollY,
      scrollY: 0,
      prevScrollY: 0,
      hasInitializedScroll: false
    };
  }

  function collectActiveLayersAtTime(session, t) {
    var layers = session.layers;
    var count = layers.length;
    var activeCount = 0;
    for (var i = 0; i < count; i++) {
      var l = layers[i];
      if (t >= l.startSec && t < l.endSec) {
        session.activeScratch[activeCount++] = i;
      }
    }
    return activeCount;
  }

  function updateAutoScroll(session, t, dt) {
    var layers = session.layers;
    var count = layers.length;
    var activeCount = 0;

    var minDynRow = count, maxDynRow = -1;
    var minAnyRow = count, maxAnyRow = -1;
    var lookAhead = 0.20;

    for (var i = 0; i < count; i++) {
      var l = layers[i];
      if (t >= l.startSec && t < l.endSec) {
        session.activeScratch[activeCount++] = i;
      }
      if (l.startSec <= t + lookAhead && l.endSec > t) {
        if (i < minAnyRow) minAnyRow = i;
        if (i > maxAnyRow) maxAnyRow = i;
        if (!l.isPersistent) {
          if (i < minDynRow) minDynRow = i;
          if (i > maxDynRow) maxDynRow = i;
        }
      }
    }

    var focusMin = (maxDynRow >= 0) ? minDynRow : minAnyRow;
    var focusMax = (maxDynRow >= 0) ? maxDynRow : maxAnyRow;

    var targetScrollY = session.scrollY;
    if (session.scrollMode === 'static' || session.maxScrollY <= 0) {
      targetScrollY = 0;
    } else if (focusMax >= 0) {
      if (session.scrollMode === 'auto-center') {
        var midRow = (focusMin + focusMax) * 0.5;
        targetScrollY = (midRow * session.rowPitch) - (session.tracksH * 0.42);
      } else {
        targetScrollY = (focusMin * session.rowPitch) - (session.tracksH * 0.16);
      }
      if (targetScrollY < 0) targetScrollY = 0;
      if (targetScrollY > session.maxScrollY) targetScrollY = session.maxScrollY;
    } else if (!session.hasInitializedScroll) {
      var earliestRow = 0;
      var earliestStart = Infinity;
      for (var j = 0; j < count; j++) {
        if (!layers[j].isPersistent && layers[j].startSec < earliestStart) {
          earliestStart = layers[j].startSec;
          earliestRow = j;
        }
      }
      targetScrollY = (earliestRow * session.rowPitch) - (session.tracksH * 0.25);
      if (targetScrollY < 0) targetScrollY = 0;
      if (targetScrollY > session.maxScrollY) targetScrollY = session.maxScrollY;
    }

    if (!session.hasInitializedScroll) {
      session.scrollY = targetScrollY;
      session.hasInitializedScroll = true;
    } else {
      var smoothSpeed = 6.5;
      var alpha = 1 - Math.exp(-smoothSpeed * dt);
      session.scrollY += (targetScrollY - session.scrollY) * alpha;
      if (Math.abs(targetScrollY - session.scrollY) < 0.25) {
        session.scrollY = targetScrollY;
      }
    }

    return activeCount;
  }

  function drawActiveWireframes(ctx, session, activeCount, t, boxX, boxY, boxW, boxH, clipX, clipY, clipW, clipH, overlayAlpha) {
    if (!session.showWireframe || activeCount <= 0 || overlayAlpha <= 0.01) return;
    if (!window.CanvasWireframe || typeof window.CanvasWireframe.draw !== 'function') return;

    var engine = window.FishToolEngine || window.LayerTransform;
    if (!engine || typeof engine.getBounds !== 'function') return;

    var p = session.palette;
    var compW = session.compW;
    var compH = session.compH;
    var scaleX = boxW / Math.max(1, compW);
    var scaleY = boxH / Math.max(1, compH);
    var hasOverlayScaler = Boolean(window.CanvasOverlay && typeof window.CanvasOverlay._scaleBoundsForOverlay === 'function');
    var dprScale = Math.max(1, session.scale * 0.55);

    var camEff = null;
    for (var ci = 0; ci < session.cameraLayers.length; ci++) {
      var camItem = session.cameraLayers[ci];
      if (t >= camItem.startSec && t < camItem.endSec) {
        camEff = (typeof window.getLayerEffectivePropsAtTime === 'function')
          ? window.getLayerEffectivePropsAtTime(camItem.ref, t)
          : camItem.ref;
        break;
      }
    }

    ctx.save();
    ctx.globalAlpha = overlayAlpha;
    // Clip to the Preview Stage Well (allows wireframes to extend outside the composition frame
    // into the dark preview area, without ever bleeding into Header, Controller bar, or Timeline!)
    ctx.beginPath();
    ctx.rect(clipX, clipY, clipW, clipH);
    ctx.clip();
    ctx.translate(boxX, boxY);

    for (var ai = 0; ai < activeCount; ai++) {
      var item = session.layers[session.activeScratch[ai]];
      if (!item || item.type === 'audio' || item.type === 'camera' || item.type === 'light') continue;
      var l = item.ref;
      if (!l) continue;

      var effProps = (typeof window.getLayerEffectivePropsAtTime === 'function')
        ? window.getLayerEffectivePropsAtTime(l, t)
        : l;
      var rawBounds = null;
      var isCollapsedPrecomp = (l.type === 'precomp' && Boolean(l.collapseTransformations) && Array.isArray(l.layers) && l.layers.length > 0);
      if (isCollapsedPrecomp && typeof window.computeCollapsedPrecompBounds === 'function') {
        rawBounds = window.computeCollapsedPrecompBounds(l, effProps, t, 1, camEff, compW, compH);
      } else {
        var animLayer = Object.assign({}, l, effProps);
        rawBounds = engine.getBounds(animLayer, 1, camEff, compW, compH);
      }
      if (!rawBounds) continue;

      var b = hasOverlayScaler
        ? window.CanvasOverlay._scaleBoundsForOverlay(rawBounds, scaleX, scaleY)
        : rawBounds;
      if (b && (!b.isBehindCamera || (b.posZ || 0) < 950)) {
        window.CanvasWireframe.draw(ctx, b, {
          showAnchor: false,
          showHandles: false,
          isAnchorMode: false,
          color: p.colorPrimary,
          bgColor: p.bgCanvas,
          dprScale: dprScale,
          hidden: false
        });
      }
    }

    ctx.restore();
  }

  function findRecentBeatHit(beatmarks, t, frameTol) {
    if (!beatmarks || beatmarks.length === 0) return null;
    var tol = frameTol || 0.008;
    var best = null;
    for (var i = 0; i < beatmarks.length; i++) {
      var bm = beatmarks[i];
      var dt = t - bm.time;
      if (dt >= -tol && dt <= PIN_BOUNCE_SEC) {
        var clampedDt = dt < 0 ? 0 : dt;
        if (!best || clampedDt < best.dt) {
          best = { bm: bm, dt: clampedDt, anim: evalPinDropAnim(clampedDt) };
        }
      }
    }
    return best;
  }

  function renderSinglePass(ctx, session, compCanvas, t, scrollYVal, activeCount, frameIndex, safeFps, totalDur) {
    var p = session.palette;
    var g = session.glyphs;
    var w = session.outW;
    var h = session.outH;
    var s = session.scale;
    var savedScrollY = session.scrollY;
    session.scrollY = scrollYVal;

    var u = computeInOutZoomReveal(session, t, totalDur);

    // Fast path: 100% Full-Screen Video (Intro before Beatmark 1, or final frame of Outro)
    if (u <= 0.0005) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = p.bgPreview;
      ctx.fillRect(0, 0, w, h);
      if (compCanvas && compCanvas.width > 0 && compCanvas.height > 0) {
        ctx.drawImage(compCanvas, session.fullCompX, session.fullCompY, session.fullCompW, session.fullCompH);
      }
      session.scrollY = savedScrollY;
      return;
    }

    // Compute exact camera transform interpolating between Full-Screen Video (u=0) and Studio UI (u=1)
    var camScale = 1.0;
    var camTx = 0.0;
    var camTy = 0.0;
    var curCompX = session.drawCompX;
    var curCompY = session.drawCompY;
    var curCompW = session.drawCompW;
    var curCompH = session.drawCompH;

    if (u < 0.9995) {
      var fCx = session.fullCompX + session.fullCompW * 0.5;
      var fCy = session.fullCompY + session.fullCompH * 0.5;
      var dCx = session.drawCompX + session.drawCompW * 0.5;
      var dCy = session.drawCompY + session.drawCompH * 0.5;

      // Perceptually uniform Exponential Scale (After Effects "Exponential Scale")
      // Eliminates the mid-transition speed rush of linear scale interpolation!
      var fullScale = session.fullCompW / Math.max(1, session.drawCompW);
      camScale = Math.pow(fullScale, 1.0 - u);

      curCompW = session.drawCompW * camScale;
      curCompH = session.drawCompH * camScale;

      // Match center translation seamlessly to the optical zoom factor
      var posFrac = (fullScale > 1.0001) ? ((fullScale - camScale) / (fullScale - 1.0)) : u;
      var curCx = fCx + (dCx - fCx) * posFrac;
      var curCy = fCy + (dCy - fCy) * posFrac;
      curCompX = curCx - curCompW * 0.5;
      curCompY = curCy - curCompH * 0.5;

      camTx = curCx - dCx * camScale;
      camTy = curCy - dCy * camScale;
    }

    var frameTol = 0.5 / Math.max(1, safeFps);
    var selectAll = session.highlightActive && session.layers.length > 0;
    var beatHit = findRecentBeatHit(session.beatmarks, t, frameTol);

    // 1. Base Background & Camera Transform for Studio UI Shell
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = p.bgPreview;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    if (u < 0.9995) {
      ctx.setTransform(camScale, 0, 0, camScale, camTx, camTy);
    }

    // 2. Top Header Bar (.editor-header)
    ctx.fillStyle = p.bgPanel;
    ctx.fillRect(0, session.headerY, w, session.headerH);
    ctx.fillStyle = p.borderDefault;
    ctx.fillRect(0, session.headerY + session.headerH - Math.max(1, Math.round(s * 0.5)), w, Math.max(1, Math.round(s * 0.5)));

    var headerMidY = session.headerY + session.headerH * 0.5;
    var hIconSz = Math.round(18 * s);

    drawFticon(ctx, g.back, session.pad + hIconSz * 0.5, headerMidY, hIconSz, p.colorPrimary);

    ctx.fillStyle = p.textPrimary;
    ctx.font = '700 ' + Math.round(14 * s) + 'px ' + p.fontBrand;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    var titleX = session.pad + hIconSz + Math.round(12 * s);
    var projLabel = selectAll ? (session.layers.length + ' Selected') : session.projectName;
    ctx.fillText(projLabel, titleX, headerMidY);

    var iconGap = Math.round((session.layout === 'desktop' ? 32 : 30) * s);
    var rightX = w - session.pad - hIconSz * 0.5;
    if (selectAll) {
      drawFticon(ctx, g.options, rightX, headerMidY, hIconSz, p.colorPrimary);
      drawFticon(ctx, g.link,    rightX - iconGap, headerMidY, hIconSz, p.colorPrimary);
      drawFticon(ctx, g.badge3d, rightX - iconGap * 2, headerMidY, hIconSz, p.colorPrimary);
      drawMotionBlurSvg(ctx,     rightX - iconGap * 3, headerMidY, Math.round(18 * s), p.colorPrimary);
      drawFticon(ctx, g.del,     rightX - iconGap * 4, headerMidY, hIconSz, p.colorPrimary);
    } else {
      drawFticon(ctx, g.export2,  rightX, headerMidY, hIconSz, p.colorPrimary);
      drawFticon(ctx, g.settings, rightX - iconGap, headerMidY, hIconSz, p.colorPrimary);
      drawFticon(ctx, g.template, rightX - iconGap * 2, headerMidY, hIconSz, p.colorPrimary);
      drawFticon(ctx, g.desktop,  rightX - iconGap * 3, headerMidY, hIconSz, p.colorPrimary);
    }

    // 3. Preview Stage Well Background
    ctx.fillStyle = p.bgPreview;
    ctx.fillRect(session.previewX, session.previewY, session.previewAreaW, session.previewAreaH);

    // 4. Controller Bar (.editor-controller — bottom of Left Pane in Landscape, or middle in Portrait)
    var trX = session.transportX;
    var trW = session.transportW;
    ctx.fillStyle = p.bgPanel;
    if (session.layout === 'mobile') {
      drawTopRoundedRectPath(ctx, trX, session.transportY, trW, session.transportH, Math.round(14 * s));
      ctx.fill();
      ctx.strokeStyle = p.borderDefault;
      ctx.lineWidth = Math.max(1, Math.round(s * 0.6));
      ctx.stroke();
      ctx.fillStyle = p.borderSubtle;
      ctx.fillRect(trX, session.transportY + session.transportH - Math.max(1, Math.round(s * 0.5)), trW, Math.max(1, Math.round(s * 0.5)));
    } else {
      ctx.fillRect(trX, session.transportY, trW, session.transportH);
      ctx.fillStyle = p.borderDefault;
      ctx.fillRect(trX, session.transportY, trW, Math.max(1, Math.round(s * 0.6)));
    }

    var trMidY = session.transportY + session.transportH * 0.5;
    var tbIconSz = Math.round(18 * s);
    var cols = 7;
    var colSpan = (trW - session.pad * 2) / cols;
    var c0 = trX + session.pad + colSpan * 0.5;
    var endDur = Math.max(0.5, totalDur || 5);
    var isPlayingNow = (frameIndex > 1) && (t < endDur - (0.75 / safeFps));
    drawFticon(ctx, g.undo,     c0,               trMidY, tbIconSz, p.textMuted);
    drawFticon(ctx, g.redo,     c0 + colSpan,     trMidY, tbIconSz, p.textMuted);
    drawFticon(ctx, g.previous, c0 + colSpan * 2, trMidY, tbIconSz, p.colorPrimary);
    drawFticon(ctx, isPlayingNow ? g.pause : g.play, c0 + colSpan * 3, trMidY, tbIconSz, p.colorPrimary);
    drawFticon(ctx, g.next,     c0 + colSpan * 4, trMidY, tbIconSz, p.colorPrimary);
    drawFticon(ctx, g.more,     c0 + colSpan * 5, trMidY, tbIconSz, p.colorPrimary);
    drawSvgPathIcon(ctx, session.svgPaths.puzzle, c0 + colSpan * 6, trMidY, Math.round(19 * s), p.colorPrimary, false);

    // 5. Time Ruler & Vertical Grid + Beatmark Lines (inside Right Pane in Landscape, or Bottom Pane in Portrait)
    ctx.fillStyle = p.bgTimeline;
    ctx.fillRect(session.timelineX, session.rulerY, session.timelineW, session.rulerH + session.tracksH);

    ctx.fillStyle = p.borderDefault;
    ctx.fillRect(session.timelineX, session.rulerY + session.rulerH - Math.max(1, Math.round(s * 0.5)), session.timelineW, Math.max(1, Math.round(s * 0.5)));

    var pps = session.timelinePps;
    var leftSec = t - (session.playheadX - session.timelineX) / pps;
    var rightSec = t + (session.timelineX + session.timelineW - session.playheadX) / pps;
    var startSub = Math.max(0, Math.floor(leftSec * 10) / 10);
    var endSub = Math.ceil(rightSec * 10) / 10;

    // 5a. Dashed vertical grid lines + Beatmark vertical lines behind tracks
    ctx.save();
    ctx.beginPath();
    ctx.rect(session.timelineX, session.tracksY, session.timelineW, session.tracksH);
    ctx.clip();
    ctx.strokeStyle = p.gridLineThin;
    ctx.lineWidth = Math.max(1, Math.round(s * 0.5));
    ctx.setLineDash([Math.round(3 * s), Math.round(3 * s)]);
    var gridStart = Math.max(0, Math.floor(leftSec * 2) / 2);
    var gridEnd = Math.ceil(rightSec * 2) / 2;
    for (var gs = gridStart; gs <= gridEnd + 0.001; gs += 0.5) {
      var gx = Math.round(session.playheadX + (gs - t) * pps) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, session.tracksY);
      ctx.lineTo(gx, session.tracksY + session.tracksH);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // .timeline-layers-beatmarks vertical lines — spawn right on the beat (with half-frame float tolerance)!
    var bms = session.beatmarks;
    for (var bi = 0; bi < bms.length; bi++) {
      var bm = bms[bi];
      if (t + frameTol < bm.time) break; // Future beatmarks stay hidden until hit!
      if (bm.time < leftSec - 0.2 || bm.time > rightSec + 0.2) continue;
      var bx = Math.round(session.playheadX + (bm.time - t) * pps) + 0.5;
      var dtBm = Math.max(0, t - bm.time);
      var pinAnim = evalPinDropAnim(dtBm);
      var lineH = session.tracksH * (pinAnim ? pinAnim.lineProg : 1.0);

      ctx.save();
      if (pinAnim && pinAnim.active) {
        ctx.strokeStyle = p.colorPrimary;
        ctx.globalAlpha = 0.45 + 0.55 * pinAnim.pulse;
        ctx.lineWidth = Math.max(1.5, (1.0 + 1.5 * pinAnim.pulse) * s);
        ctx.setLineDash([]);
      } else if (bm.isNamed) {
        ctx.strokeStyle = p.colorPrimary;
        ctx.globalAlpha = 0.34;
        ctx.lineWidth = Math.max(1, Math.round(s * 0.7));
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = p.colorAccent;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = Math.max(1, Math.round(s * 0.7));
        ctx.setLineDash([Math.round(4 * s), Math.round(3 * s)]);
      }
      ctx.beginPath();
      ctx.moveTo(bx, session.tracksY);
      ctx.lineTo(bx, session.tracksY + lineH);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // 5b. Ruler ticks & second labels
    ctx.save();
    ctx.beginPath();
    ctx.rect(session.timelineX, session.rulerY, session.timelineW, session.rulerH);
    ctx.clip();

    ctx.font = '600 ' + Math.round(9.5 * s) + 'px ' + p.fontMono;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    var tickBottom = session.rulerY + session.rulerH;
    var majorH = Math.round(session.rulerH * 0.65);
    var midH = Math.round(session.rulerH * 0.34);
    var fineH = Math.round(session.rulerH * 0.16);

    for (var ts = startSub; ts <= endSub + 0.001; ts = Math.round((ts + 0.1) * 10) / 10) {
      var tx = Math.round(session.playheadX + (ts - t) * pps);
      var frac = Math.abs(ts - Math.round(ts));
      var isMajor = frac < 0.01;
      var isHalf = Math.abs(frac - 0.5) < 0.01;
      if (isMajor) {
        ctx.fillStyle = p.colorPrimary;
        ctx.fillRect(tx, tickBottom - majorH, Math.max(1, Math.round(s)), majorH);
        var secInt = Math.round(ts);
        var rm = Math.floor(secInt / 60);
        var rs = secInt % 60;
        var rLabel = (rm > 0 ? rm + ':' + (rs < 10 ? '0' + rs : rs) : rs + 's');
        ctx.fillStyle = p.textPrimary;
        ctx.fillText(rLabel, tx + Math.round(4 * s), session.rulerY + Math.round(3 * s));
      } else if (isHalf) {
        ctx.fillStyle = p.textMuted;
        ctx.fillRect(tx, tickBottom - midH, Math.max(1, Math.round(s * 0.6)), midH);
      } else {
        ctx.fillStyle = p.borderDefault;
        ctx.fillRect(tx, tickBottom - fineH, Math.max(1, Math.round(s * 0.5)), fineH);
      }
    }
    ctx.restore();

    // Left selection-mode pill (#timeline-btn-selection-mode — anchored at timelineX in both Portrait & Landscape!)
    var selPillW = Math.round(32 * s);
    var selPillH = Math.round(24 * s);
    var selPillY = Math.round(session.rulerY + (session.rulerH - selPillH) * 0.5);
    if (selectAll) {
      ctx.fillStyle = p.colorPrimary;
      drawRightRoundedRectPath(ctx, session.timelineX, selPillY, selPillW, selPillH, Math.round(8 * s));
      ctx.fill();
    }
    var selColor = selectAll ? p.bgCanvas : p.textPrimary;
    var selX = session.timelineX + selPillW * 0.48;
    var selY = selPillY + selPillH * 0.5;
    var selSz = Math.round(15 * s);
    drawSvgPathIcon(ctx, session.svgPaths.selectArc, selX, selY, selSz, selColor, true, 2);
    ctx.save();
    var scSel = selSz / 24;
    ctx.translate(selX - selSz * 0.5, selY - selSz * 0.5);
    ctx.scale(scSel, scSel);
    ctx.strokeStyle = selColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(15, 15, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawSvgPathIcon(ctx, session.svgPaths.selectCheck, selX, selY, selSz, selColor, true, 2);

    // 6. Timeline Tracks Viewport (.timeline-layers-viewport)
    var totalLayers = session.layers.length;
    var topPadding = Math.round(6 * s);
    var firstVisibleRow = Math.max(0, Math.floor((session.scrollY - topPadding) / session.rowPitch));
    var visibleLaneSlots = Math.ceil(session.tracksH / session.rowPitch) + 1;
    var lastVisibleRow = Math.min(totalLayers - 1, firstVisibleRow + visibleLaneSlots);

    ctx.save();
    ctx.beginPath();
    ctx.rect(session.timelineX, session.tracksY, session.timelineW, session.tracksH);
    ctx.clip();

    ctx.fillStyle = p.borderSubtle;
    var maxSlot = Math.max(lastVisibleRow, firstVisibleRow + visibleLaneSlots);
    for (var dl = firstVisibleRow; dl <= maxSlot; dl++) {
      var lineY = Math.round(session.tracksY + topPadding + dl * session.rowPitch - session.scrollY + session.rowHeight + session.rowGap * 0.5);
      if (lineY >= session.tracksY && lineY <= session.tracksY + session.tracksH) {
        ctx.fillRect(session.timelineX, lineY, session.timelineW, Math.max(1, Math.round(s * 0.5)));
      }
    }

    if (totalLayers === 0) {
      ctx.fillStyle = p.textMuted;
      ctx.font = '600 ' + Math.round(13 * s) + 'px ' + p.fontBrand;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No layers', session.timelineX + session.timelineW * 0.5, session.tracksY + session.tracksH * 0.5);
    } else {
      var barRadius = Math.round(6 * s);
      var handleW = Math.round(18 * s);
      var handleR = Math.round(7 * s);
      var chevSz = Math.round(11 * s);
      var barFontSize = Math.round(11 * s);
      var tagFontSize = Math.round(8.5 * s);
      var kfSize = Math.round(5.2 * s);
      var leftPillW = Math.round(32 * s);

      for (var r = firstVisibleRow; r <= lastVisibleRow; r++) {
        var layer = session.layers[r];
        var rowY = Math.round(session.tracksY + topPadding + r * session.rowPitch - session.scrollY);
        var isActive = (t >= layer.startSec && t < layer.endSec);

        var barX = Math.round(session.playheadX + (layer.startSec - t) * pps);
        var barW = Math.max(Math.round(8 * s), Math.round(layer.durSec * pps));

        if (barX + barW + handleW < session.timelineX - 8 || barX - handleW > session.timelineX + session.timelineW + 8) {
          continue;
        }

        var midRowY = rowY + session.rowHeight * 0.5;

        if (selectAll) {
          ctx.fillStyle = p.colorPrimary;
          drawLeftRoundedRectPath(ctx, barX - handleW, rowY, handleW, session.rowHeight, handleR);
          ctx.fill();
          drawFticon(ctx, g.chevLeft, barX - handleW * 0.5, midRowY, chevSz, p.bgCanvas);

          ctx.fillStyle = p.colorPrimary;
          drawRightRoundedRectPath(ctx, barX + barW, rowY, handleW, session.rowHeight, handleR);
          ctx.fill();
          drawFticon(ctx, g.chevRight, barX + barW + handleW * 0.5, midRowY, chevSz, p.bgCanvas);

          var drawX = Math.max(session.timelineX - 4, barX);
          var drawRight = Math.min(session.timelineX + session.timelineW + 4, barX + barW);
          var drawW = Math.max(2, drawRight - drawX);

          ctx.fillStyle = p.bgCanvas;
          ctx.fillRect(drawX, rowY, drawW, session.rowHeight);
          ctx.strokeStyle = p.colorPrimary;
          ctx.lineWidth = Math.max(1.5, Math.round(1.6 * s));
          ctx.strokeRect(drawX + 0.5, rowY + 0.5, Math.max(1, drawW - 1), Math.max(1, session.rowHeight - 1));

          if (drawW > Math.round(22 * s)) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(drawX + Math.round(2 * s), rowY, drawW - Math.round(4 * s), session.rowHeight);
            ctx.clip();

            var contentX = Math.max(barX + Math.round(6 * s), session.timelineX + leftPillW + Math.round(6 * s));
            ctx.font = '800 ' + tagFontSize + 'px ' + p.fontBrand;
            var tagTextW = ctx.measureText(layer.typeTag).width;
            var tagBoxW = Math.round(tagTextW + 8 * s);
            var tagBoxH = Math.round(14 * s);
            var tagBoxY = Math.round(midRowY - tagBoxH * 0.5);

            ctx.fillStyle = p.colorPrimary;
            drawRoundedRectPath(ctx, contentX, tagBoxY, tagBoxW, tagBoxH, Math.round(3 * s));
            ctx.fill();

            ctx.fillStyle = p.bgCanvas;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(layer.typeTag, contentX + tagBoxW * 0.5, midRowY + 0.5);

            ctx.fillStyle = p.colorPrimary;
            ctx.textAlign = 'left';
            ctx.font = '700 ' + barFontSize + 'px ' + p.fontBrand;
            ctx.fillText(layer.name, contentX + tagBoxW + Math.round(5 * s), midRowY);
            ctx.restore();
          }
        } else {
          var drawU = Math.max(session.timelineX - barRadius, barX);
          var rightU = Math.min(session.timelineX + session.timelineW + barRadius, barX + barW);
          var widthU = Math.max(6, rightU - drawU);
          ctx.fillStyle = isActive ? layer.fillColor : layer.dimColor;
          drawRoundedRectPath(ctx, drawU, rowY, widthU, session.rowHeight, barRadius);
          ctx.fill();

          if (widthU > Math.round(26 * s)) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(drawU + Math.round(4 * s), rowY, widthU - Math.round(8 * s), session.rowHeight);
            ctx.clip();
            var inkU = isActive ? layer.fillTextColor : layer.dimTextColor;
            var lblX = Math.max(barX + Math.round(8 * s), session.timelineX + leftPillW + Math.round(6 * s));
            ctx.fillStyle = inkU;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = '700 ' + barFontSize + 'px ' + p.fontBrand;
            ctx.fillText(layer.name, lblX, midRowY);
            ctx.restore();
          }
        }

        if (session.showKeyframes && layer.keyframes.length > 0) {
          var kfs = layer.keyframes;
          ctx.fillStyle = p.bgCanvas;
          ctx.strokeStyle = p.colorPrimary;
          ctx.lineWidth = Math.max(1.2, Math.round(1.2 * s));
          for (var ki = 0; ki < kfs.length; ki++) {
            var kfX = Math.round(session.playheadX + (kfs[ki] - t) * pps);
            if (kfX < session.timelineX || kfX > session.timelineX + session.timelineW) continue;
            ctx.beginPath();
            ctx.moveTo(kfX, midRowY - kfSize);
            ctx.lineTo(kfX + kfSize, midRowY);
            ctx.lineTo(kfX, midRowY + kfSize);
            ctx.lineTo(kfX - kfSize, midRowY);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // Left Checkbox/Eye Pill & Right Reorder Pill (anchored to timelineX .. w in both Portrait & Landscape!)
      var pillW = Math.round(28 * s);
      var pillH = Math.round(28 * s);
      var pillR = Math.round(9 * s);
      var laneIconSz = Math.round(14 * s);
      var chkR = Math.round(7.5 * s);
      var rPillW = Math.round(28 * s);

      for (var pr = firstVisibleRow; pr <= lastVisibleRow; pr++) {
        var pRowY = Math.round(session.tracksY + topPadding + pr * session.rowPitch - session.scrollY);
        var pMidY = pRowY + session.rowHeight * 0.5;
        var pillTopY = Math.round(pMidY - pillH * 0.5);

        if (selectAll) {
          ctx.fillStyle = p.colorPrimary;
          drawRightRoundedRectPath(ctx, session.timelineX, pillTopY, pillW, pillH, pillR);
          ctx.fill();
          ctx.fillStyle = p.bgCanvas;
          ctx.beginPath();
          ctx.arc(session.timelineX + pillW * 0.46, pMidY, chkR, 0, Math.PI * 2);
          ctx.fill();
          drawFticon(ctx, g.check, session.timelineX + pillW * 0.46, pMidY, Math.round(9.5 * s), p.colorPrimary);
        } else {
          ctx.fillStyle = p.bgPanel;
          drawRightRoundedRectPath(ctx, session.timelineX, pillTopY, pillW, pillH, pillR);
          ctx.fill();
          drawFticon(ctx, g.eye, session.timelineX + pillW * 0.46, pMidY, laneIconSz, p.colorPrimary);
        }

        ctx.fillStyle = p.bgTimeline;
        drawLeftRoundedRectPath(ctx, w - rPillW, pillTopY, rPillW, pillH, pillR);
        ctx.fill();
        drawFticon(ctx, g.reorder, w - rPillW * 0.5, pMidY, laneIconSz, p.colorPrimary);
      }
    }
    ctx.restore();

    // Vertical Split Resizer Handle (.timeline-split-handle) between Left & Right Panes in Landscape!
    if (session.layout === 'desktop') {
      var splitX = session.timelineX;
      ctx.fillStyle = p.borderDefault;
      ctx.fillRect(splitX - Math.max(1, Math.round(s * 0.5)), session.headerH, Math.max(1, Math.round(s)), h - session.headerH);
      var handlePillW = Math.round(5 * s);
      var handlePillH = Math.round(52 * s);
      var handlePillY = Math.round(session.headerH + (h - session.headerH - handlePillH) * 0.5);
      ctx.fillStyle = p.borderDefault;
      drawRoundedRectPath(ctx, Math.round(splitX - handlePillW * 0.5), handlePillY, handlePillW, handlePillH, handlePillW * 0.5);
      ctx.fill();
    }

    // 7. Playhead Needle + Timecode Badge + AE Beatmark Map-Pins (identical in Portrait & Landscape, no '+' FAB!)
    var needleW = Math.max(2, Math.round((beatHit ? 1.4 + 0.7 * beatHit.anim.pulse : 1.4) * s));
    var tcText = formatStudioTimecode(t, safeFps);
    ctx.font = '600 ' + Math.round(10 * s) + 'px ' + p.fontMono;
    var tcW = ctx.measureText(tcText).width + Math.round(14 * s);
    var tcH = Math.round(18 * s);
    var tcX = Math.round(session.playheadX - tcW * 0.5);
    var tcY = session.rulerY;

    ctx.fillStyle = p.colorPrimary;
    ctx.fillRect(session.playheadX - Math.floor(needleW * 0.5), tcY + tcH, needleW, Math.max(0, h - (tcY + tcH)));

    ctx.fillStyle = p.bgPanel;
    drawBottomRoundedRectPath(ctx, tcX, tcY, tcW, tcH, Math.round(5 * s));
    ctx.fill();
    ctx.strokeStyle = p.colorPrimary;
    ctx.lineWidth = Math.max(1, Math.round(s * 0.8));
    ctx.stroke();

    ctx.fillStyle = p.colorPrimary;
    ctx.font = '700 ' + Math.round(10 * s) + 'px ' + p.fontMono;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tcText, session.playheadX, tcY + tcH * 0.5);

    // 7b. After Effects Beatmark Pins — hidden before beat, drop & squash-bounce like a Map Pin when hit!
    ctx.save();
    ctx.beginPath();
    var leftClipX = session.timelineX + Math.round(34 * s);
    var clipTopY = (session.layout === 'desktop') ? session.headerH : session.transportY;
    var clipH = (session.tracksY + Math.round(10 * s)) - clipTopY;
    ctx.rect(leftClipX, clipTopY, w - leftClipX, clipH);
    ctx.clip();

    var pinW = Math.round(11.5 * s);
    var pinH = Math.round(14.5 * s);
    var pinR = Math.round(2.6 * s);
    var pinTipY = session.tracksY + Math.round(1 * s);

    for (var rbi = 0; rbi < bms.length; rbi++) {
      var rbm = bms[rbi];
      if (t + PIN_LEAD_SEC < rbm.time) break; // Start drop 65ms early so impact lands at 0.000s on the playhead!
      if (rbm.time < leftSec - 0.3 || rbm.time > rightSec + 0.3) continue;

      var rbx = Math.round(session.playheadX + (rbm.time - t) * pps);
      var rdt = (Math.abs(t - rbm.time) <= frameTol && t < rbm.time) ? 0 : (t - rbm.time);
      var pAnim = evalPinDropAnim(rdt);

      if (pAnim && pAnim.active && rdt >= 0 && rdt < 0.24) {
        var ringP = rdt / 0.24;
        var ringR = (3 + 10 * easyEase(ringP)) * s;
        ctx.save();
        ctx.globalAlpha = (1 - ringP) * 0.75;
        ctx.strokeStyle = p.colorPrimary;
        ctx.lineWidth = Math.max(1, Math.round(1.1 * s));
        ctx.beginPath();
        ctx.ellipse(rbx, pinTipY, ringR, ringR * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = pAnim ? pAnim.alpha : 1.0;
      var dropPx = pAnim ? (pAnim.offsetY * pinH) : 0;
      ctx.translate(rbx, pinTipY + dropPx);
      if (pAnim) {
        ctx.scale(pAnim.scaleX, pAnim.scaleY);
      }

      ctx.fillStyle = (pAnim && pAnim.active) ? p.colorPrimaryHov : p.colorPrimary;
      drawAeMarkerPinPath(ctx, pinW, pinH, pinR);
      ctx.fill();
      ctx.strokeStyle = p.bgCanvas;
      ctx.lineWidth = Math.max(1.2, Math.round(1.1 * s));
      ctx.stroke();

      ctx.fillStyle = p.bgCanvas;
      ctx.beginPath();
      ctx.arc(0, -pinH * 0.62, Math.max(1.5, pinW * 0.19), 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
    ctx.restore();

    ctx.restore(); // Exit camera transform so compCanvas & wireframes render at crisp 1:1 output pixels!

    // 8. Draw Composition Video, Border & Wireframes
    // Composition pixels stay inside curComp rect; Wireframes can extend into the Preview Stage Well
    // (bounded strictly between Header, Controller bar, and Landscape Split Handle!).
    var compRadius = Math.round(4 * s * u);
    if (compCanvas && compCanvas.width > 0 && compCanvas.height > 0) {
      ctx.save();
      if (compRadius > 0.5) {
        drawRoundedRectPath(ctx, curCompX, curCompY, curCompW, curCompH, compRadius);
        ctx.clip();
      }
      ctx.drawImage(compCanvas, curCompX, curCompY, curCompW, curCompH);
      ctx.restore();
    }

    var uiOverlayAlpha = easyEase(Math.min(1, Math.max(0, (u - 0.12) / 0.88)));
    if (uiOverlayAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = uiOverlayAlpha;
      ctx.strokeStyle = p.colorPrimary;
      ctx.lineWidth = Math.max(1, Math.round(s * 0.75));
      drawRoundedRectPath(ctx, curCompX, curCompY, curCompW, curCompH, compRadius);
      ctx.stroke();
      ctx.restore();
    }

    if (session.showWireframe && uiOverlayAlpha > 0.01) {
      var wellScreenX = session.previewX * camScale + camTx;
      var wellScreenY = session.previewY * camScale + camTy;
      var wellScreenW = session.previewAreaW * camScale;
      var wellScreenH = session.previewAreaH * camScale;
      drawActiveWireframes(
        ctx, session, activeCount, t,
        curCompX, curCompY, curCompW, curCompH,
        wellScreenX, wellScreenY, wellScreenW, wellScreenH,
        uiOverlayAlpha
      );
    }

    session.scrollY = savedScrollY;
  }

  function renderFrame(session, targetCanvas, compCanvas, t, frameIndex, fps, totalDur) {
    if (!session || !targetCanvas) return;
    var ctx = targetCanvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';

    var safeFps = fps || session.fps || 60;
    var dt = 1 / Math.max(1, safeFps);

    var prevScroll = session.hasInitializedScroll ? session.scrollY : null;
    var activeCount = updateAutoScroll(session, t, dt);
    var curScroll = session.scrollY;
    if (prevScroll === null) prevScroll = curScroll;
    session.prevScrollY = prevScroll;

    // Bypass sub-sampling when Interface Motion Blur is OFF, shutterAngle is 0, or full-screen video (u === 0)
    var uMid = computeInOutZoomReveal(session, t, totalDur);
    if (!session.interfaceMotionBlur || !session.mbSampleCanvas || session.mbShutterAngle <= 0.5 || uMid <= 0.0005) {
      renderSinglePass(ctx, session, compCanvas, t, curScroll, activeCount, frameIndex, safeFps, totalDur);
      return;
    }

    // AE-accurate Sub-Frame Multi-Sampling Motion Blur across Project Shutter Angle & Phase!
    // Uses incremental running mean (globalAlpha = 1 / (k + 1)) so brightness & colors stay 100% accurate.
    var sCanvas = session.mbSampleCanvas;
    var sCtx = sCanvas.getContext('2d');
    if (!sCtx) {
      renderSinglePass(ctx, session, compCanvas, t, curScroll, activeCount, frameIndex, safeFps, totalDur);
      return;
    }
    sCtx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in sCtx) sCtx.imageSmoothingQuality = 'high';

    var exposure = (session.mbShutterAngle / 360) * dt;
    var phaseOffset = (session.mbShutterPhase / 360) * dt;
    var numSamples = session.mbSamples;
    var maxDur = Math.max(0.1, totalDur || 5);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    for (var k = 0; k < numSamples; k++) {
      var frac = (k + 0.5) / numSamples;
      var subT = t + phaseOffset + (frac - 0.5) * exposure;
      if (subT < 0) subT = 0;
      if (subT > maxDur) subT = maxDur;

      // Interpolate scrollY smoothly across the shutter window
      var relDt = (subT - t) / dt; // roughly -0.5 .. +0.5
      var subScroll = curScroll + (curScroll - prevScroll) * relDt;
      if (subScroll < 0) subScroll = 0;
      if (subScroll > session.maxScrollY) subScroll = session.maxScrollY;

      var subActive = collectActiveLayersAtTime(session, subT);
      renderSinglePass(sCtx, session, compCanvas, subT, subScroll, subActive, frameIndex, safeFps, totalDur);

      ctx.globalAlpha = 1 / (k + 1);
      ctx.drawImage(sCanvas, 0, 0);
    }

    ctx.globalAlpha = 1.0;
  }

  function disposeSession(session) {
    if (!session) return;
    if (session.compCanvas) {
      session.compCanvas.width = 1;
      session.compCanvas.height = 1;
      session.compCanvas = null;
    }
    if (session.mbSampleCanvas) {
      session.mbSampleCanvas.width = 1;
      session.mbSampleCanvas.height = 1;
      session.mbSampleCanvas = null;
    }
    session.layers = null;
    session.beatmarks = null;
    session.cameraLayers = null;
    session.activeScratch = null;
  }

  window.InterfaceExportRenderer = {
    getOutputDims: getOutputDims,
    createSession: createSession,
    renderFrame: renderFrame,
    disposeSession: disposeSession
  };
})();
