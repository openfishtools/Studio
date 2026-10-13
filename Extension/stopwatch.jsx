/**
 * OpenFishTools Extension - Stopwatch Card
 * Provides: Work session timer with Play, Pause, and Reset controls.
 */
Card({
  id: 'stopwatch',
  name: 'Stopwatch',
  icon: 'schedule',
  description: 'Work session timer (00:00:00) dengan kontrol Play, Pause, dan Reset.',
  category: 'Dashboard',
  defaultEnabled: true,

  build(ui, ctx) {
    let elapsedMs = ctx.storage.get('elapsed_ms', 0);
    let timerId = null;
    let isRunning = false;

    function formatTime(totalMs) {
      const m = Math.floor(totalMs / 60000);
      const s = Math.floor((totalMs % 60000) / 1000);
      const ms = Math.floor((totalMs % 1000) / 10);
      return [m, s, ms].map(v => String(v).padStart(2, '0')).join(':');
    }

    const display = ui.text({
      id: 'sw-display',
      text: formatTime(elapsedMs),
      variant: 'display',
      className: 'timer-display'
    });

    ui.grid({ cols: 3, className: 'stopwatch-controls' }, [
      ui.button({
        id: 'sw-start',
        label: 'START',
        icon: 'play_arrow',
        title: 'Start Timer',
        className: 'btn-sw-start',
        onClick() {
          if (isRunning) return;
          isRunning = true;
          const startTime = Date.now() - elapsedMs;
          timerId = setInterval(() => {
            elapsedMs = Date.now() - startTime;
            display.textContent = formatTime(elapsedMs);
            ctx.storage.set('elapsed_ms', elapsedMs);
          }, 25);
        }
      }),

      ui.button({
        id: 'sw-pause',
        label: 'PAUSE',
        icon: 'pause',
        title: 'Pause Timer',
        className: 'btn-sw-pause',
        onClick() {
          if (!isRunning) return;
          isRunning = false;
          if (timerId) clearInterval(timerId);
          ctx.storage.set('elapsed_ms', elapsedMs);
        }
      }),

      ui.button({
        id: 'sw-reset',
        label: 'RESET',
        icon: 'replay',
        title: 'Reset Timer',
        className: 'btn-sw-reset',
        onClick() {
          isRunning = false;
          if (timerId) clearInterval(timerId);
          elapsedMs = 0;
          ctx.storage.set('elapsed_ms', 0);
          display.textContent = '00:00:00';
        }
      })
    ]);
  }
});
