/**
 * OpenFishTools Extension - Cut / Trim Card
 * Provides: Fast layer trimming and splitting at playhead position.
 */
Card({
  id: 'cut_trim',
  name: 'Cut / Trim',
  icon: 'content_cut',
  description: 'FRONT ([), MIDDLE (][), and BACK (]) layer trimming.',
  category: 'Tools',
  defaultEnabled: true,

  build(ui, ctx) {
    ui.section('Trim & Split');

    ui.grid({ cols: 3 }, [
      ui.button({
        label: 'FRONT',
        hint: '[',
        title: 'Trim In point to current time ([)',
        onClick() {
          ctx.runTool('CUT_FRONT');
        }
      }),

      ui.button({
        label: 'MIDDLE',
        hint: '][',
        title: 'Split Layer at current time (Ctrl+Shift+D)',
        onClick() {
          ctx.runTool('CUT_MID');
        }
      }),

      ui.button({
        label: 'BACK',
        hint: ']',
        title: 'Trim Out point to current time (])',
        onClick() {
          ctx.runTool('CUT_BACK');
        }
      })
    ]);
  }
});
