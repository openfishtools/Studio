/**
 * OpenFishTools Extension - To Do List Card
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
    let tasks = ctx.storage.get('tasks', [
      { text: 'Add intro keyframes', done: false },
      { text: 'Sync audio beats', done: false }
    ]);

    const listWrap = document.createElement('div');
    listWrap.className = 'todo-list-container';

    function renderTasks() {
      listWrap.innerHTML = '';
      tasks.forEach((t, idx) => {
        const item = document.createElement('div');
        item.className = `todo-item ${t.done ? 'is-done' : ''}`;

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = !!t.done;
        chk.addEventListener('change', () => {
          tasks[idx].done = chk.checked;
          ctx.storage.set('tasks', tasks);
          renderTasks();
        });

        const span = document.createElement('span');
        span.className = 'todo-text';
        span.textContent = t.text;

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'todo-del-btn';
        del.textContent = '×';
        del.title = 'Delete Task';
        del.addEventListener('click', () => {
          tasks.splice(idx, 1);
          ctx.storage.set('tasks', tasks);
          renderTasks();
        });

        item.appendChild(chk);
        item.appendChild(span);
        item.appendChild(del);
        listWrap.appendChild(item);
      });
    }

    const inputRow = document.createElement('div');
    inputRow.className = 'todo-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'extension-input todo-input-field';
    input.placeholder = 'Add new task...';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'tool-btn todo-add-btn';
    addBtn.innerHTML = '<span class="material-icons" style="font-size:16px;">add</span>';
    addBtn.title = 'Add Task';

    function addTask() {
      const val = input.value.trim();
      if (!val) return;
      tasks.push({ text: val, done: false });
      ctx.storage.set('tasks', tasks);
      input.value = '';
      renderTasks();
    }

    addBtn.addEventListener('click', addTask);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTask();
    });

    inputRow.appendChild(input);
    inputRow.appendChild(addBtn);

    ui.custom(inputRow);
    ui.custom(listWrap);

    renderTasks();
  }
});
