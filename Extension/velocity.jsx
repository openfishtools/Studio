/**
 * OpenFishTools Extension - Velocity Card
 * Provides: Velocity editing shortcuts (Twixtor & Time Remapping).
 */
Card({
  id: 'velocity',
  name: 'Velocity',
  icon: 'speed',
  description: 'TWIXTOR and Time Remapping (T-REMAP) speed workflows.',
  category: 'Tools',
  defaultEnabled: true,

  build(ui, ctx) {
    ui.section('Speed Ramping');
    ui.grid({ cols: 2 }, [
      ui.button({
        label: 'TWIXTOR',
        icon: 'speed',
        title: 'Apply Twixtor speed effect setup',
        onClick() { ctx.runTool('TWIX'); }
      }),
      ui.button({
        label: 'T-REMAP',
        icon: 'update',
        title: 'Enable & Configure Time Remapping',
        onClick() { ctx.runTool('TMRE'); }
      })
    ]);
  }
});
