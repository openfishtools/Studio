/**
 * OpenFishTools Extension - Format Card
 * Provides: Aspect ratio presets (1:1, 16:9, 9:16, 3:4, 4:3) and frame rate switches (15, 30, 50, 60, 120 FPS).
 */
Card({
  id: 'format',
  name: 'Format',
  icon: 'aspect_ratio',
  description: 'Aspect Ratio (1:1, 16:9, 9:16, 3:4, 4:3) & FPS presets (15, 30, 50, 60, 120).',
  category: 'Tools',
  defaultEnabled: true,

  build(ui, ctx) {
    ui.section('Aspect Ratio');
    ui.grid({ cols: 5 }, [
      ui.button({
        label: '1:1',
        icon: 'crop_square',
        title: '1:1 Square (1080×1080)',
        onClick() { ctx.runTool('setCompositionFormat', 1080, 1080); }
      }),
      ui.button({
        label: '16:9',
        icon: 'crop_16_9',
        title: '16:9 Landscape (1920×1080)',
        onClick() { ctx.runTool('setCompositionFormat', 1920, 1080); }
      }),
      ui.button({
        label: '9:16',
        icon: 'crop_portrait',
        title: '9:16 Portrait / Shorts / Reels (1080×1920)',
        onClick() { ctx.runTool('setCompositionFormat', 1080, 1920); }
      }),
      ui.button({
        label: '3:4',
        icon: 'aspect_ratio',
        title: '3:4 Instagram (1080×1440)',
        onClick() { ctx.runTool('setCompositionFormat', 1080, 1440); }
      }),
      ui.button({
        label: '4:3',
        icon: 'crop_landscape',
        title: '4:3 Retro (1440×1080)',
        onClick() { ctx.runTool('setCompositionFormat', 1440, 1080); }
      })
    ]);

    ui.section('Frame Rate');
    ui.grid({ cols: 5 }, [
      ui.button({
        label: '15 FPS',
        icon: 'av_timer',
        title: 'Set composition to 15 FPS',
        onClick() { ctx.runTool('setCompositionFPS', 15); }
      }),
      ui.button({
        label: '30 FPS',
        icon: 'av_timer',
        title: 'Set composition to 30 FPS',
        onClick() { ctx.runTool('setCompositionFPS', 30); }
      }),
      ui.button({
        label: '50 FPS',
        icon: 'av_timer',
        title: 'Set composition to 50 FPS',
        onClick() { ctx.runTool('setCompositionFPS', 50); }
      }),
      ui.button({
        label: '60 FPS',
        icon: 'av_timer',
        title: 'Set composition to 60 FPS',
        onClick() { ctx.runTool('setCompositionFPS', 60); }
      }),
      ui.button({
        label: '120 FPS',
        icon: 'av_timer',
        title: 'Set composition to 120 FPS',
        onClick() { ctx.runTool('setCompositionFPS', 120); }
      })
    ]);
  }
});
