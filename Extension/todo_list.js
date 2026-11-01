/**
 * OpenFishTools Extension - To Do List Card (.js)
 * Provides: Task checklist for project workflow (add, check, delete).
 */
Card({
  id: 'todo_list',
  name: 'To Do List',
  icon: 'checklist',
  description: 'Checklist tugas/task proyek (tambah tugas, checklist selesai, hapus).',
  category: 'Dashboard',
  defaultEnabled: true,

  build(ui, ctx) {
    const savedTasks = ctx.storage.get('tasks', [
      { text: 'Add intro keyframes', done: false },
      { text: 'Sync audio beats', done: false }
    ]);

    ui.checklist({
      items: savedTasks,
      placeholder: 'Add new task...',
      onChange(updatedTasks) {
        ctx.storage.set('tasks', updatedTasks);
      }
    });
  }
});
