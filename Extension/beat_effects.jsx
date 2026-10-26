/**
 * OpenFishTools Extension - Beat Effects Card
 * Provides: Current beat effects, continuous motion shakes/beats, panning, and warp presets.
 */
Card({
  id: 'beat_effects',
  name: 'Beat Effects',
  icon: 'graphic_eq',
  description: 'Current, Continuous, Panning, and WARP1/2 beat-synchronized effects.',
  category: 'Tools',
  defaultEnabled: true,

  build(ui, ctx) {
    ui.section('Current Beat');
    ui.grid({ cols: 5 }, [
      ui.button({ label: 'GHOST', icon: 'auto_awesome_motion', title: 'Ghost Trail Effect', onClick() { ctx.runTool('GHST'); } }),
      ui.button({ label: 'WARP', icon: 'waves', title: 'Wave Warp Hit', onClick() { ctx.runTool('WARP'); } }),
      ui.button({ label: 'FISHEYE', icon: 'remove_red_eye', title: 'Fish Eye Ripple', onClick() { ctx.runTool('FISHEYE'); } }),
      ui.button({ label: 'MIDWAVE', icon: 'water_drop', title: 'Mid-Wave Impact', onClick() { ctx.runTool('MIDWAVE'); } }),
      ui.button({ label: 'HUESPIN', icon: 'palette', title: 'Hue Spin Beat', onClick() { ctx.runTool('HUESPIN'); } })
    ]);

    ui.section('Continuous Motion');
    ui.grid({ cols: 5 }, [
      ui.button({ label: 'FLASH', icon: 'flash_on', title: 'Exposure Flash', onClick() { ctx.runTool('EXPO'); } }),
      ui.button({ label: 'SHAKY', icon: 'vibration', title: 'Continuous Shaky Beat', onClick() { ctx.runTool('SHAKY'); } }),
      ui.button({
        label: 'BLUR',
        icon: 'blur_on',
        title: 'Fast Box Blur Beat (Left Click)',
        rightTitle: 'Lens Blur Beat (Right Click / Hold 2s)',
        onClick() { ctx.runTool('LENS', false); },
        onContextMenu() { ctx.runTool('LENS', true); }
      }),
      ui.button({ label: 'OSCILLATE', icon: 'wifi', title: 'Oscillate Bounce', onClick() { ctx.runTool('OSCILLATE'); } }),
      ui.button({ label: 'Y BEAT', icon: 'south', title: 'Vertical Y Beat', onClick() { ctx.runTool('Y_BEAT'); } }),
      ui.button({ label: 'Y FLIP', icon: 'swap_vert', title: 'Alternating Y Flip', onClick() { ctx.runTool('Y_FLIP'); } }),
      ui.button({ label: 'X BEAT', icon: 'east', title: 'Horizontal X Beat', onClick() { ctx.runTool('X_BEAT'); } }),
      ui.button({ label: 'X FLIP', icon: 'flip', title: 'Alternating X Flip', onClick() { ctx.runTool('X_FLIP'); } }),
      ui.button({ label: 'SCALE', icon: 'zoom_in', title: 'Scale Pulse Beat', onClick() { ctx.runTool('SCALE_BEAT'); } }),
      ui.button({ label: 'SWING', icon: '360', title: '360° Dynamic Swing', onClick() { ctx.runTool('SWING'); } })
    ]);

    ui.section('Panning');
    ui.grid({ cols: 5 }, [
      ui.button({ label: 'POSITION', icon: 'open_with', title: 'Panning Position', onClick() { ctx.runTool('PANNING_POS'); } }),
      ui.button({ label: 'ROTATION', icon: 'autorenew', title: 'Panning Rotation', onClick() { ctx.runTool('PANNING_ROT'); } }),
      ui.button({ label: 'SCALE', icon: 'aspect_ratio', title: 'Panning Scale', onClick() { ctx.runTool('PANNING_SCALE'); } }),
      ui.button({ label: 'MIX PR', icon: 'tune', title: 'Mix Pos & Rot', onClick() { ctx.runTool('PANNING_MIX_PR'); } }),
      ui.button({ label: 'MIX ALL', icon: 'widgets', title: 'Mix All (Pos, Rot, Scale)', onClick() { ctx.runTool('PANNING_MIX_ALL'); } })
    ]);

    ui.section('Presets');
    ui.grid({ cols: 2 }, [
      ui.button({ label: 'WARP 1', icon: 'waves', title: 'Warp Preset 1', onClick() { ctx.runTool('PRESET_WARP1'); } }),
      ui.button({ label: 'WARP 2', icon: 'waves', title: 'Warp Preset 2', onClick() { ctx.runTool('PRESET_WARP2'); } })
    ]);
  }
});
