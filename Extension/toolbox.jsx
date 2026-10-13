/**
 * OpenFishTools Extension - Toolbox Card
 * Provides: Essential layer operations, layer creation shortcuts, and quick effects application.
 */
Card({
  id: 'toolbox',
  name: 'Toolbox',
  icon: 'handyman',
  description: 'Layer operations (FRZ, FIT, DSH, MIR), Create (SHA, SOL, NUL, CAM, ADJ), Effects (FILL, TINT, BLUR, LUM, CURV, HUE).',
  category: 'Tools',
  defaultEnabled: true,

  build(ui, ctx) {
    ui.section('Layer');
    ui.grid({ cols: 4 }, [
      ui.button({ label: 'FRZ', icon: 'ac_unit', title: 'Freeze Frame', onClick() { ctx.runTool('FRZ'); } }),
      ui.button({
        label: 'FIT',
        icon: 'fit_screen',
        title: 'Fit to Comp',
        rightTitle: 'Fit to Comp Width',
        onClick() { ctx.runTool('FIT', false); },
        onContextMenu() { ctx.runTool('FIT', true); }
      }),
      ui.button({ label: 'DSH', icon: 'filter_drama', title: 'Drop Shadow', onClick() { ctx.runTool('DSH'); } }),
      ui.button({
        label: 'MIR',
        icon: 'flip',
        title: 'Mirror Horizontal',
        rightTitle: 'Mirror Vertical',
        onClick() { ctx.runTool('MIR', false); },
        onContextMenu() { ctx.runTool('MIR', true); }
      })
    ]);

    ui.section('Create');
    ui.grid({ cols: 5 }, [
      ui.button({ label: 'SHA', icon: 'pentagon', title: 'New Shape Layer', onClick() { ctx.runTool('SHA'); } }),
      ui.button({
        label: 'SOL',
        icon: 'rectangle',
        title: 'New Solid Layer (Random Color)',
        rightTitle: 'New Black Solid [0,0,0]',
        onClick() { ctx.runTool('SOL', false); },
        onContextMenu() { ctx.runTool('SOL', true); }
      }),
      ui.button({
        label: 'NUL',
        icon: 'control_camera',
        title: 'New Null Object',
        rightTitle: 'Create Null & Link Selected',
        onClick() { ctx.runTool('NUL', false); },
        onContextMenu() { ctx.runTool('NUL', true); }
      }),
      ui.button({ label: 'CAM', icon: 'videocam', title: 'New Camera', onClick() { ctx.runTool('CAM'); } }),
      ui.button({ label: 'ADJ', icon: 'tune', title: 'New Adjustment Layer', onClick() { ctx.runTool('ADJ'); } })
    ]);

    ui.section('Effects');
    ui.grid({ cols: 6 }, [
      ui.button({ label: 'FILL', icon: 'format_color_fill', title: 'Add Fill Effect', onClick() { ctx.runTool('FILL'); } }),
      ui.button({ label: 'TINT', icon: 'gradient', title: 'Add Tint Effect', onClick() { ctx.runTool('TINT'); } }),
      ui.button({
        label: 'BLUR',
        icon: 'blur_on',
        title: 'Add Fast Box Blur',
        rightTitle: 'Add Camera Lens Blur',
        onClick() { ctx.runTool('BLUR', false); },
        onContextMenu() { ctx.runTool('BLUR', true); }
      }),
      ui.button({ label: 'LUM', icon: 'contrast', title: 'Add Lumetri Color', onClick() { ctx.runTool('LUM'); } }),
      ui.button({ label: 'CURV', icon: 'show_chart', title: 'Add Curves', onClick() { ctx.runTool('CURV'); } }),
      ui.button({ label: 'HUE', icon: 'palette', title: 'Add Hue/Saturation', onClick() { ctx.runTool('HUE'); } })
    ]);
  }
});
