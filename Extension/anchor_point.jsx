/**
 * OpenFishTools Extension - Anchor Point (9-Point Grid) Card
 * Provides: Instant layer anchor point repositioning without altering visual transform.
 */
Card({
  id: 'anchor_point',
  name: 'Anchor Point',
  icon: 'control_camera',
  description: 'Memindahkan titik tumpu layer secara instan (9 titik tumpu) tanpa menggeser layer.',
  category: 'Tools',
  defaultEnabled: true,

  build(ui, ctx) {
    ui.section('Anchor Position', '9-Point Grid');

    const wrapper = document.createElement('div');
    wrapper.className = 'anchor-grid-wrapper';

    const grid = document.createElement('div');
    grid.className = 'anchor-grid';

    const positions = [
      { id: 1, title: 'Top Left' },
      { id: 2, title: 'Top Center' },
      { id: 3, title: 'Top Right' },
      { id: 4, title: 'Middle Left' },
      { id: 5, title: 'Center' },
      { id: 6, title: 'Middle Right' },
      { id: 7, title: 'Bottom Left' },
      { id: 8, title: 'Bottom Center' },
      { id: 9, title: 'Bottom Right' }
    ];

    positions.forEach(p => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'anchor-cell';
      cell.title = p.title;
      cell.setAttribute('aria-label', p.title);
      cell.addEventListener('click', () => {
        cell.classList.add('anchor-active');
        setTimeout(() => cell.classList.remove('anchor-active'), 180);
        ctx.runTool('setAnchorPoint', p.id);
      });
      grid.appendChild(cell);
    });

    wrapper.appendChild(grid);
    ui.custom(wrapper);
  }
});
