/**
 * OpenFishTools Extension - Align Card
 * Provides: 6-way composition alignment for selected layers.
 */
Card({
  id: 'align',
  name: 'Align',
  icon: 'format_align_center',
  description: '6 tombol perataan layer (LEFT, H-MID, RIGHT, TOP, V-MID, BOTTOM).',
  category: 'Tools',
  defaultEnabled: true,

  build(ui, ctx) {
    ui.section('Layer Alignment');

    ui.grid({ cols: 3 }, [
      ui.button({
        label: 'LEFT',
        icon: 'align_horizontal_left',
        title: 'Align Left',
        onClick() { ctx.runTool('ALIGN_LEFT'); }
      }),
      ui.button({
        label: 'H-MID',
        icon: 'align_horizontal_center',
        title: 'Align Horizontal Center',
        onClick() { ctx.runTool('ALIGN_HCENTER'); }
      }),
      ui.button({
        label: 'RIGHT',
        icon: 'align_horizontal_right',
        title: 'Align Right',
        onClick() { ctx.runTool('ALIGN_RIGHT'); }
      }),
      ui.button({
        label: 'TOP',
        icon: 'align_vertical_top',
        title: 'Align Top',
        onClick() { ctx.runTool('ALIGN_TOP'); }
      }),
      ui.button({
        label: 'V-MID',
        icon: 'align_vertical_center',
        title: 'Align Vertical Center',
        onClick() { ctx.runTool('ALIGN_VCENTER'); }
      }),
      ui.button({
        label: 'BOTTOM',
        icon: 'align_vertical_bottom',
        title: 'Align Bottom',
        onClick() { ctx.runTool('ALIGN_BOTTOM'); }
      })
    ]);
  }
});
