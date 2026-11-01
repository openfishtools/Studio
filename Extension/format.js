/**
 * OpenFishTools Extension - Format Card (.js)
 * 100% Self-Contained Extension (UI + Aspect Ratio & FPS Switcher Logic)
 *
 * Cara Edit:
 * - Tambah preset rasio baru di `ASPECT_PRESETS` atau frame rate baru di `FPS_PRESETS`.
 */
(function() {
  'use strict';

  const ASPECT_PRESETS = [
    { label: '1:1',   w: 1080, h: 1080, icon: 'crop_square',    title: '1:1 Square (1080×1080)' },
    { label: '16:9',  w: 1920, h: 1080, icon: 'crop_16_9',      title: '16:9 Landscape (1920×1080)' },
    { label: '9:16',  w: 1080, h: 1920, icon: 'crop_portrait',  title: '9:16 Portrait / Shorts / Reels (1080×1920)' },
    { label: '3:4',   w: 1080, h: 1440, icon: 'aspect_ratio',   title: '3:4 Instagram (1080×1440)' },
    { label: '4:3',   w: 1440, h: 1080, icon: 'crop_landscape', title: '4:3 Retro (1440×1080)' }
  ];

  const FPS_PRESETS = [15, 30, 50, 60, 120];

  function setCompositionFormat(ctx, width, height) {
    const host = ctx.getHost();
    const state = ctx.getProjectState() || {};
    const w = parseInt(width, 10) || 1920;
    const h = parseInt(height, 10) || 1080;

    let ratioStr = `${w}:${h}`;
    if (w === 1920 && h === 1080) ratioStr = '16:9';
    else if (w === 1080 && h === 1920) ratioStr = '9:16';
    else if (w === 1080 && h === 1080) ratioStr = '1:1';
    else if (w === 1080 && h === 1440) ratioStr = '3:4';
    else if (w === 1440 && h === 1080) ratioStr = '4:3';

    if (host && typeof host.changeCompositionRatio === 'function') {
      return host.changeCompositionRatio(w, h);
    }
    if (host && typeof host.updatePreviewCanvas === 'function') {
      host.updatePreviewCanvas(ratioStr, state.resolution || '1080p', state.fps || 60, state.bgColor || 'transparent');
      ctx.showToast(`Format Komposisi: ${ratioStr} (${w}×${h})`);
    }
    return true;
  }

  function setCompositionFPS(ctx, fpsVal) {
    const host = ctx.getHost();
    const state = ctx.getProjectState() || {};
    const fps = parseInt(fpsVal, 10) || 60;

    if (host && typeof host.changeCompositionFPS === 'function') {
      return host.changeCompositionFPS(fps);
    }
    if (host && typeof host.updatePreviewCanvas === 'function') {
      host.updatePreviewCanvas(state.aspectRatio || '16:9', state.resolution || '1080p', fps, state.bgColor || 'transparent');
      ctx.showToast(`Frame Rate: ${fps} FPS`);
    }
    return true;
  }

  Card({
    id: 'format',
    name: 'Format',
    icon: 'aspect_ratio',
    description: 'Aspect Ratio (1:1, 16:9, 9:16, 3:4, 4:3) & FPS presets (15, 30, 50, 60, 120).',
    category: 'Tools',
    defaultEnabled: true,

    tools: {
      setCompositionFormat,
      changeCompRatio: setCompositionFormat,
      setCompositionFPS,
      changeCompFPS: setCompositionFPS
    },

    build(ui, ctx) {
      ui.section('Aspect Ratio');
      ui.grid({ cols: 5 }, ASPECT_PRESETS.map(p =>
        ui.button({
          label: p.label,
          icon: p.icon,
          title: p.title,
          onClick() { setCompositionFormat(ctx, p.w, p.h); }
        })
      ));

      ui.section('Frame Rate');
      ui.grid({ cols: 5 }, FPS_PRESETS.map(fps =>
        ui.button({
          label: `${fps} FPS`,
          icon: 'av_timer',
          title: `Set composition to ${fps} FPS`,
          onClick() { setCompositionFPS(ctx, fps); }
        })
      ));
    }
  });
})();
