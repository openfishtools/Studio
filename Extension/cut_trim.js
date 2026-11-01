/**
 * OpenFishTools Extension - Cut / Trim Card (.js)
 * 100% Self-Contained Extension (UI + Trim In, Split Mid, Trim Out Logic)
 *
 * Cara Edit:
 * - `cutFront(ctx)`: Memangkas bagian awal layer hingga posisi playhead saat ini (`[`).
 * - `cutMid(ctx)`: Membelah (split) layer menjadi dua pada posisi playhead (`][`).
 * - `cutBack(ctx)`: Memangkas bagian akhir layer mulai dari posisi playhead (`]`).
 */
(function() {
  'use strict';

  function cutFront(ctx) {
    const host = ctx.getHost();
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = 'Pilih layer terlebih dahulu untuk memotong (Cut Front)';
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }
    if (host && typeof host.executeCutLeft === 'function') {
      host.executeCutLeft();
    } else if (host && typeof host.executeTrimIn === 'function') {
      host.executeTrimIn();
    }
    ctx.showToast('Cut Front');
    return true;
  }

  function cutMid(ctx) {
    const host = ctx.getHost();
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = 'Pilih layer terlebih dahulu untuk membagi (Cut Mid)';
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }
    if (host && typeof host.executeCutMid === 'function') {
      host.executeCutMid();
    }
    ctx.showToast('Split Layer');
    return true;
  }

  function cutBack(ctx) {
    const host = ctx.getHost();
    const targets = ctx.layers.getSelected();
    if (!targets.length) {
      const msg = 'Pilih layer terlebih dahulu untuk memotong (Cut Back)';
      ctx.showToast(msg, true);
      return { error: true, message: msg };
    }
    if (host && typeof host.executeCutRight === 'function') {
      host.executeCutRight();
    } else if (host && typeof host.executeTrimOut === 'function') {
      host.executeTrimOut();
    }
    ctx.showToast('Cut Back');
    return true;
  }

  Card({
    id: 'cut_trim',
    name: 'Cut / Trim',
    icon: 'content_cut',
    description: 'FRONT ([), MIDDLE (][), dan BACK (]) pemotongan layer pada playhead.',
    category: 'Tools',
    defaultEnabled: true,

    tools: {
      CUT_FRONT: cutFront,
      CUT_LEFT: cutFront,
      CUT_MID: cutMid,
      CUT_BACK: cutBack,
      CUT_RIGHT: cutBack
    },

    build(ui, ctx) {
      ui.section('Trim & Split');

      ui.grid({ cols: 3 }, [
        ui.button({
          label: 'FRONT',
          hint: '[',
          title: 'Trim In point to current time ([)',
          onClick() {
            cutFront(ctx);
          }
        }),
        ui.button({
          label: 'MIDDLE',
          hint: '][',
          title: 'Split Layer at current time (][)',
          onClick() {
            cutMid(ctx);
          }
        }),
        ui.button({
          label: 'BACK',
          hint: ']',
          title: 'Trim Out point to current time (])',
          onClick() {
            cutBack(ctx);
          }
        })
      ]);
    }
  });
})();
