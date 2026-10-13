/**
 * OpenFishTools Extension - Sticky Note Card
 * Provides: Fast project scratchpad with local auto-save.
 */
Card({
  id: 'sticky_note',
  name: 'Sticky Note',
  icon: 'notes',
  description: 'Papan catatan proyek cepat (auto-save lokal).',
  category: 'Dashboard',
  defaultEnabled: true,

  build(ui, ctx) {
    const savedNote = ctx.storage.get('note_text', '');

    const textarea = ui.textarea({
      id: 'sticky-note-textarea',
      placeholder: 'Write your project notes, ideas, or reminders here...',
      value: savedNote,
      rows: 4,
      className: 'sticky-note-area',
      onChange(val) {
        ctx.storage.set('note_text', val);
      }
    });

    ui.grid({ cols: 2, className: 'sticky-controls' }, [
      ui.button({
        label: 'CLEAR',
        icon: 'delete',
        title: 'Clear Notes',
        className: 'btn-secondary',
        onClick() {
          textarea.value = '';
          ctx.storage.set('note_text', '');
          ctx.showToast('Notes cleared');
        }
      }),

      ui.button({
        label: 'COPY',
        icon: 'content_copy',
        title: 'Copy Notes to Clipboard',
        className: 'btn-secondary',
        onClick() {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(textarea.value).then(() => {
              ctx.showToast('Notes copied to clipboard!');
            });
          } else {
            textarea.select();
            document.execCommand('copy');
            ctx.showToast('Notes copied!');
          }
        }
      })
    ]);
  }
});
