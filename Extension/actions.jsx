/**
 * OpenFishTools Extension - Actions Card
 * Provides: Core composition workflow actions (Precompose, Center, Overlap, Screenshot, Duplicate).
 */
Card({
  id: 'actions',
  name: 'Actions',
  icon: 'layers',
  description: 'PRECOMP, CENTER, OVERLAP, SHOT, DUP shortcut actions.',
  category: 'Tools',
  defaultEnabled: true,

  build(ui, ctx) {
    ui.section('Quick Actions');

    ui.grid({ cols: 5 }, [
      ui.button({
        label: 'PRECOMP',
        icon: 'layers',
        title: 'Precompose selected layer(s)',
        rightTitle: 'Precompose & Auto-Crop to Bounds',
        onClick() { ctx.runTool('PRECOMP'); },
        onContextMenu() { ctx.runTool('PRECOMP_AUTOCROP'); }
      }),
      ui.button({
        label: 'CENTER',
        icon: 'filter_center_focus',
        title: 'Center Layer to Comp Viewport',
        onClick() { ctx.runTool('CENTER'); }
      }),
      ui.button({
        label: 'OVERLAP',
        icon: 'auto_awesome_motion',
        title: 'Sequence / Stagger Overlapping Layers',
        onClick() { ctx.runTool('OVERLAP'); }
      }),
      ui.button({
        label: 'SHOT',
        icon: 'camera_alt',
        title: 'Take frame snapshot screenshot',
        onClick() { ctx.runTool('SCREENSHOT'); }
      }),
      ui.button({
        label: 'DUP',
        icon: 'file_copy',
        title: 'Duplicate composition with hierarchy',
        onClick() { ctx.runTool('DUP_COMP'); }
      })
    ]);
  }
});
