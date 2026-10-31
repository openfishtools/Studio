/**
 * OpenFishTools Studio - Extension Manager & Built-in Cards Loader
 * 
 * Manages:
 * 1. Built-in .jsx extensions registration.
 * 2. Extension Modal UI in index.html (Extension list with On/Off switches).
 * 3. Import .jsx button & validation (only valid cards with UI buttons and executable functions are accepted).
 * 4. Synchronization of enabled extensions to editor.html and desktop.html.
 */
(function(global) {
  'use strict';

  // Manifest of built-in extension cards
  const BUILTIN_CARDS = [
    {
      id: 'stopwatch',
      name: 'Stopwatch',
      icon: 'schedule',
      description: 'Timer waktu kerja (00:00:00) dengan kontrol Play, Pause, dan Reset.',
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
            label: 'START',
            icon: 'play_arrow',
            title: 'Start Timer',
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
            label: 'PAUSE',
            icon: 'pause',
            title: 'Pause Timer',
            onClick() {
              if (!isRunning) return;
              isRunning = false;
              if (timerId) clearInterval(timerId);
              ctx.storage.set('elapsed_ms', elapsedMs);
            }
          }),
          ui.button({
            label: 'RESET',
            icon: 'replay',
            title: 'Reset Timer',
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
    },
    {
      id: 'sticky_note',
      name: 'Sticky Note',
      icon: 'notes',
      description: 'Papan catatan proyek cepat (auto-save lokal).',
      category: 'Dashboard',
      defaultEnabled: true,
      build(ui, ctx) {
        const savedNote = ctx.storage.get('note_text', '');
        const ta = ui.textarea({
          placeholder: 'Write your project notes here...',
          value: savedNote,
          rows: 4,
          onChange(val) {
            ctx.storage.set('note_text', val);
          }
        });

        ui.grid({ cols: 2 }, [
          ui.button({
            label: 'CLEAR',
            icon: 'delete',
            title: 'Clear Notes',
            onClick() {
              ta.value = '';
              ctx.storage.set('note_text', '');
              ctx.showToast('Notes cleared');
            }
          }),
          ui.button({
            label: 'COPY',
            icon: 'content_copy',
            title: 'Copy Notes to Clipboard',
            onClick() {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(ta.value).then(() => ctx.showToast('Notes copied!'));
              } else {
                ta.select();
                document.execCommand('copy');
                ctx.showToast('Notes copied!');
              }
            }
          })
        ]);
      }
    },
    {
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
    },
    {
      id: 'anchor_point',
      name: 'Anchor Point',
      icon: 'control_camera',
      description: 'Memindahkan titik tumpu layer secara instan (9-Point Grid) tanpa menggeser layer.',
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
    },
    {
      id: 'cut_trim',
      name: 'Cut / Trim',
      icon: 'content_cut',
      description: 'FRONT ([), MIDDLE (][), dan BACK (]) pemotongan layer pada playhead.',
      category: 'Tools',
      defaultEnabled: true,
      build(ui, ctx) {
        ui.section('Trim & Split');
        ui.grid({ cols: 3 }, [
          ui.button({
            label: 'FRONT',
            hint: '[',
            title: 'Trim In point to current time ([)',
            onClick() { ctx.runTool('CUT_FRONT'); }
          }),
          ui.button({
            label: 'MIDDLE',
            hint: '][',
            title: 'Split Layer at current time (][)',
            onClick() { ctx.runTool('CUT_MID'); }
          }),
          ui.button({
            label: 'BACK',
            hint: ']',
            title: 'Trim Out point to current time (])',
            onClick() { ctx.runTool('CUT_BACK'); }
          })
        ]);
      }
    },
    {
      id: 'align',
      name: 'Align',
      icon: 'format_align_center',
      description: '6 tombol perataan layer (LEFT, H-MID, RIGHT, TOP, V-MID, BOTTOM).',
      category: 'Tools',
      defaultEnabled: true,
      build(ui, ctx) {
        ui.section('Layer Alignment');
        ui.grid({ cols: 3 }, [
          ui.button({ label: 'LEFT', icon: 'align_horizontal_left', title: 'Align Left', onClick() { ctx.runTool('ALIGN_LEFT'); } }),
          ui.button({ label: 'H-MID', icon: 'align_horizontal_center', title: 'Align Horizontal Center', onClick() { ctx.runTool('ALIGN_HCENTER'); } }),
          ui.button({ label: 'RIGHT', icon: 'align_horizontal_right', title: 'Align Right', onClick() { ctx.runTool('ALIGN_RIGHT'); } }),
          ui.button({ label: 'TOP', icon: 'align_vertical_top', title: 'Align Top', onClick() { ctx.runTool('ALIGN_TOP'); } }),
          ui.button({ label: 'V-MID', icon: 'align_vertical_center', title: 'Align Vertical Center', onClick() { ctx.runTool('ALIGN_VCENTER'); } }),
          ui.button({ label: 'BOTTOM', icon: 'align_vertical_bottom', title: 'Align Bottom', onClick() { ctx.runTool('ALIGN_BOTTOM'); } })
        ]);
      }
    },
    {
      id: 'actions',
      name: 'Actions',
      icon: 'layers',
      description: 'PRECOMP, CENTER, OVERLAP, SHOT, DUP shortcut actions.',
      category: 'Tools',
      defaultEnabled: true,
      build(ui, ctx) {
        ui.section('Quick Actions');
        ui.grid({ cols: 5 }, [
          ui.button({ label: 'PRECOMP', icon: 'layers', title: 'Precompose selected layer(s)', onClick() { ctx.runTool('PRECOMP'); } }),
          ui.button({ label: 'CENTER', icon: 'filter_center_focus', title: 'Center Layer to Comp Viewport', onClick() { ctx.runTool('CENTER'); } }),
          ui.button({ label: 'OVERLAP', icon: 'auto_awesome_motion', title: 'Sequence / Stagger Layers', onClick() { ctx.runTool('OVERLAP'); } }),
          ui.button({ label: 'SHOT', icon: 'camera_alt', title: 'Take frame snapshot screenshot', onClick() { ctx.runTool('SCREENSHOT'); } }),
          ui.button({ label: 'DUP', icon: 'file_copy', title: 'Duplicate composition', onClick() { ctx.runTool('DUP_COMP'); } })
        ]);
      }
    },
    {
      id: 'format',
      name: 'Format',
      icon: 'aspect_ratio',
      description: 'Aspect Ratio (1:1, 16:9, 9:16, 3:4, 4:3) & FPS presets (15, 30, 50, 60, 120).',
      category: 'Tools',
      defaultEnabled: true,
      build(ui, ctx) {
        ui.section('Aspect Ratio');
        ui.grid({ cols: 5 }, [
          ui.button({ label: '1:1', icon: 'crop_square', title: '1:1 Square (1080×1080)', onClick() { ctx.runTool('setCompositionFormat', 1080, 1080); } }),
          ui.button({ label: '16:9', icon: 'crop_16_9', title: '16:9 Landscape (1920×1080)', onClick() { ctx.runTool('setCompositionFormat', 1920, 1080); } }),
          ui.button({ label: '9:16', icon: 'crop_portrait', title: '9:16 Portrait / Shorts / Reels (1080×1920)', onClick() { ctx.runTool('setCompositionFormat', 1080, 1920); } }),
          ui.button({ label: '3:4', icon: 'aspect_ratio', title: '3:4 Instagram (1080×1440)', onClick() { ctx.runTool('setCompositionFormat', 1080, 1440); } }),
          ui.button({ label: '4:3', icon: 'crop_landscape', title: '4:3 Retro (1440×1080)', onClick() { ctx.runTool('setCompositionFormat', 1440, 1080); } })
        ]);

        ui.section('Frame Rate');
        ui.grid({ cols: 5 }, [
          ui.button({ label: '15 FPS', icon: 'av_timer', title: 'Set to 15 FPS', onClick() { ctx.runTool('setCompositionFPS', 15); } }),
          ui.button({ label: '30 FPS', icon: 'av_timer', title: 'Set to 30 FPS', onClick() { ctx.runTool('setCompositionFPS', 30); } }),
          ui.button({ label: '50 FPS', icon: 'av_timer', title: 'Set to 50 FPS', onClick() { ctx.runTool('setCompositionFPS', 50); } }),
          ui.button({ label: '60 FPS', icon: 'av_timer', title: 'Set to 60 FPS', onClick() { ctx.runTool('setCompositionFPS', 60); } }),
          ui.button({ label: '120 FPS', icon: 'av_timer', title: 'Set to 120 FPS', onClick() { ctx.runTool('setCompositionFPS', 120); } })
        ]);
      }
    },
    {
      id: 'toolbox',
      name: 'Toolbox',
      icon: 'handyman',
      description: 'Layer (FRZ, FIT, DSH, MIR), Create (SHA, SOL, NUL, CAM, ADJ), Effects (FILL, TINT, BLUR, LUM, CURV, HUE).',
      category: 'Tools',
      defaultEnabled: true,
      build(ui, ctx) {
        ui.section('Layer');
        ui.grid({ cols: 4 }, [
          ui.button({ label: 'FRZ', icon: 'ac_unit', title: 'Freeze Frame', onClick() { ctx.runTool('FRZ'); } }),
          ui.button({
            label: 'FIT',
            icon: 'fit_screen',
            title: 'Fit to Comp',
            rightTitle: 'Fit to Comp Width',
            onClick() { ctx.runTool('FIT', false); },
            onContextMenu() { ctx.runTool('FIT', true); }
          }),
          ui.button({ label: 'DSH', icon: 'filter_drama', title: 'Drop Shadow', onClick() { ctx.runTool('DSH'); } }),
          ui.button({
            label: 'MIR',
            icon: 'flip',
            title: 'Mirror Horizontal',
            rightTitle: 'Mirror Vertical',
            onClick() { ctx.runTool('MIR', false); },
            onContextMenu() { ctx.runTool('MIR', true); }
          })
        ]);

        ui.section('Create');
        ui.grid({ cols: 5 }, [
          ui.button({ label: 'SHA', icon: 'pentagon', title: 'New Shape Layer', onClick() { ctx.runTool('SHA'); } }),
          ui.button({
            label: 'SOL',
            icon: 'rectangle',
            title: 'New Solid Layer (Random Color)',
            rightTitle: 'New Black Solid [0,0,0]',
            onClick() { ctx.runTool('SOL', false); },
            onContextMenu() { ctx.runTool('SOL', true); }
          }),
          ui.button({
            label: 'NUL',
            icon: 'control_camera',
            title: 'New Null Object',
            rightTitle: 'Create Null & Link Selected',
            onClick() { ctx.runTool('NUL', false); },
            onContextMenu() { ctx.runTool('NUL', true); }
          }),
          ui.button({ label: 'CAM', icon: 'videocam', title: 'New Camera', onClick() { ctx.runTool('CAM'); } }),
          ui.button({ label: 'ADJ', icon: 'tune', title: 'New Adjustment Layer', onClick() { ctx.runTool('ADJ'); } })
        ]);

        ui.section('Effects');
        ui.grid({ cols: 6 }, [
          ui.button({ label: 'FILL', icon: 'format_color_fill', title: 'Add Fill Effect', onClick() { ctx.runTool('FILL'); } }),
          ui.button({ label: 'TINT', icon: 'gradient', title: 'Add Tint Effect', onClick() { ctx.runTool('TINT'); } }),
          ui.button({
            label: 'BLUR',
            icon: 'blur_on',
            title: 'Add Fast Box Blur',
            rightTitle: 'Add Camera Lens Blur',
            onClick() { ctx.runTool('BLUR', false); },
            onContextMenu() { ctx.runTool('BLUR', true); }
          }),
          ui.button({ label: 'LUM', icon: 'contrast', title: 'Add Lumetri Color', onClick() { ctx.runTool('LUM'); } }),
          ui.button({ label: 'CURV', icon: 'show_chart', title: 'Add Curves', onClick() { ctx.runTool('CURV'); } }),
          ui.button({ label: 'HUE', icon: 'palette', title: 'Add Hue/Saturation', onClick() { ctx.runTool('HUE'); } })
        ]);
      }
    },
    {
      id: 'velocity',
      name: 'Velocity',
      icon: 'speed',
      description: 'TWIXTOR and Time Remapping (T-REMAP) speed workflows.',
      category: 'Tools',
      defaultEnabled: true,
      build(ui, ctx) {
        ui.section('Speed Ramping');
        ui.grid({ cols: 2 }, [
          ui.button({ label: 'TWIXTOR', icon: 'speed', title: 'Apply Twixtor speed effect', onClick() { ctx.runTool('TWIX'); } }),
          ui.button({ label: 'T-REMAP', icon: 'update', title: 'Enable & Configure Time Remapping', onClick() { ctx.runTool('TMRE'); } })
        ]);
      }
    },
    {
      id: 'beat_effects',
      name: 'Beat Effects',
      icon: 'graphic_eq',
      description: 'Current, Continuous, Panning, Idle Movement, and WARP1/2 beat-synchronized effects.',
      category: 'Tools',
      defaultEnabled: true,
      build(ui, ctx) {
        ui.section('Current Beat');
        ui.grid({ cols: 5 }, [
          ui.button({ label: 'GHOST', icon: 'auto_awesome_motion', title: 'Ghost Trail Effect', onClick() { ctx.runTool('GHST'); } }),
          ui.button({ label: 'WARP', icon: 'waves', title: 'Wave Warp Hit', onClick() { ctx.runTool('WARP'); } }),
          ui.button({ label: 'FISHEYE', icon: 'remove_red_eye', title: 'Fish Eye Ripple', onClick() { ctx.runTool('FISHEYE'); } }),
          ui.button({ label: 'MIDWAVE', icon: 'water_drop', title: 'Mid-Wave Impact', onClick() { ctx.runTool('MIDWAVE'); } }),
          ui.button({ label: 'HUESPIN', icon: 'palette', title: 'Hue Spin Beat', onClick() { ctx.runTool('HUESPIN'); } })
        ]);

        ui.section('Continuous Motion');
        ui.grid({ cols: 5 }, [
          ui.button({ label: 'FLASH', icon: 'flash_on', title: 'Exposure Flash', onClick() { ctx.runTool('EXPO'); } }),
          ui.button({ label: 'SHAKY', icon: 'vibration', title: 'Continuous Shaky Beat', onClick() { ctx.runTool('SHAKY'); } }),
          ui.button({
            label: 'BLUR',
            icon: 'blur_on',
            title: 'Fast Box Blur Beat (Left Click)',
            rightTitle: 'Lens Blur Beat (Right Click / Hold 2s)',
            onClick() { ctx.runTool('LENS', false); },
            onContextMenu() { ctx.runTool('LENS', true); }
          }),
          ui.button({ label: 'OSCILLATE', icon: 'wifi', title: 'Oscillate Bounce', onClick() { ctx.runTool('OSCILLATE'); } }),
          ui.button({ label: 'Y BEAT', icon: 'south', title: 'Vertical Y Beat', onClick() { ctx.runTool('Y_BEAT'); } }),
          ui.button({ label: 'Y FLIP', icon: 'swap_vert', title: 'Alternating Y Flip', onClick() { ctx.runTool('Y_FLIP'); } }),
          ui.button({ label: 'X BEAT', icon: 'east', title: 'Horizontal X Beat', onClick() { ctx.runTool('X_BEAT'); } }),
          ui.button({ label: 'X FLIP', icon: 'flip', title: 'Alternating X Flip', onClick() { ctx.runTool('X_FLIP'); } }),
          ui.button({ label: 'SCALE', icon: 'zoom_in', title: 'Scale Pulse Beat', onClick() { ctx.runTool('SCALE_BEAT'); } }),
          ui.button({ label: 'SWING', icon: '360', title: '360° Dynamic Swing', onClick() { ctx.runTool('SWING'); } })
        ]);

        ui.section('Panning');
        ui.grid({ cols: 5 }, [
          ui.button({ label: 'POSITION', icon: 'open_with', title: 'Panning Position', onClick() { ctx.runTool('PANNING_POS'); } }),
          ui.button({ label: 'ROTATION', icon: 'autorenew', title: 'Panning Rotation', onClick() { ctx.runTool('PANNING_ROT'); } }),
          ui.button({ label: 'SCALE', icon: 'aspect_ratio', title: 'Panning Scale', onClick() { ctx.runTool('PANNING_SCALE'); } }),
          ui.button({ label: 'MIX PR', icon: 'tune', title: 'Mix Pos & Rot', onClick() { ctx.runTool('PANNING_MIX_PR'); } }),
          ui.button({ label: 'MIX ALL', icon: 'widgets', title: 'Mix All', onClick() { ctx.runTool('PANNING_MIX_ALL'); } })
        ]);

        ui.section('Idle Movement');
        ui.grid({ cols: 3 }, [
          ui.button({ label: 'PATTERN 1', icon: 'animation', title: 'Idle Movement 1: Scale Bounce', onClick() { ctx.runTool('IDLE_MOVE_1'); } }),
          ui.button({ label: 'PATTERN 2', icon: 'motion_photos_on', title: 'Idle Movement 2: Dynamic Scale', onClick() { ctx.runTool('IDLE_MOVE_2'); } }),
          ui.button({ label: 'SCALE + POS', icon: 'open_with', title: 'Idle Movement 3: Scale + Position 2D Drift', onClick() { ctx.runTool('IDLE_MOVE_3'); } }),
          ui.button({ label: 'SCALE + ROT', icon: 'rotate_right', title: 'Idle Movement 4: Scale + Rotation Swing', onClick() { ctx.runTool('IDLE_MOVE_4'); } }),
          ui.button({ label: 'POS + ROT', icon: 'explore', title: 'Idle Movement 5: Position 2D + Rotation Sway + Scale', onClick() { ctx.runTool('IDLE_MOVE_5'); } }),
          ui.button({ label: 'FULL COMBO', icon: 'auto_awesome_motion', title: 'Idle Movement 6: Dynamic Scale + Position 2D + Rotation', onClick() { ctx.runTool('IDLE_MOVE_6'); } })
        ]);

        ui.section('Presets');
        ui.grid({ cols: 2 }, [
          ui.button({ label: 'WARP 1', icon: 'waves', title: 'Warp Preset 1', onClick() { ctx.runTool('PRESET_WARP1'); } }),
          ui.button({ label: 'WARP 2', icon: 'waves', title: 'Warp Preset 2', onClick() { ctx.runTool('PRESET_WARP2'); } })
        ]);
      }
    },
    {
      id: 'cube_generator',
      name: 'Cube Generator',
      icon: 'view_in_ar',
      description: 'Generator kubus 3D berdasarkan dimensi Width, Height, Depth, atau ukuran layer terpilih.',
      category: '3D',
      defaultEnabled: true,
      build(ui, ctx) {
        ui.section('Cube Dimensions');
        let widthVal = 100;
        let heightVal = 100;
        let depthVal = 100;
        let useLayerDimensions = false;

        ui.formRow([
          (subUI) => {
            subUI.formGroup({
              label: 'WIDTH',
              type: 'number',
              value: 100,
              onChange(v) { widthVal = parseFloat(v) || 100; }
            });
          },
          (subUI) => {
            subUI.formGroup({
              label: 'HEIGHT',
              type: 'number',
              value: 100,
              onChange(v) { heightVal = parseFloat(v) || 100; }
            });
          },
          (subUI) => {
            subUI.formGroup({
              label: 'DEPTH',
              type: 'number',
              value: 100,
              onChange(v) { depthVal = parseFloat(v) || 100; }
            });
          }
        ]);

        ui.switch({
          label: 'Use Layer Dimensions',
          checked: false,
          onChange(checked) { useLayerDimensions = !!checked; }
        });

        ui.button({
          label: 'CREATE CUBE',
          icon: 'view_in_ar',
          title: 'Generate 6-sided 3D Cube',
          className: 'w-full tool-btn-primary',
          onClick() {
            ctx.runTool('CREATE_CUBE', {
              width: widthVal,
              height: heightVal,
              depth: depthVal,
              useLayer: useLayerDimensions
            });
          }
        });
      }
    },
    {
      id: 'generator_3d',
      name: '3D Generator',
      icon: 'view_in_ar',
      description: 'Basic 3D, Devices & Tech (Phone, Laptop, Monitor), Room & Furniture, Props & Character.',
      category: '3D',
      defaultEnabled: true,
      build(ui, ctx) {
        ui.section('Basic 3D');
        ui.grid({ cols: 3 }, [
          ui.button({ label: '3 SPLIT', icon: 'view_column', title: '3D 3-Split Columns', onClick() { ctx.runTool('GEN_3D_3SPLIT'); } }),
          ui.button({ label: '2 SPLIT', icon: 'view_stream', title: '3D 2-Split Screens', onClick() { ctx.runTool('GEN_3D_2SPLIT'); } }),
          ui.button({ label: 'TUNNEL', icon: 'filter_tilt_shift', title: '3D Depth Tunnel', onClick() { ctx.runTool('GEN_3D_TUNNEL'); } })
        ]);

        ui.section('Devices & Tech');
        ui.grid({ cols: 4 }, [
          ui.button({ label: 'PHONE', icon: 'smartphone', title: '3D Smartphone Mockup', onClick() { ctx.runTool('GEN_3D_PHONE'); } }),
          ui.button({ label: 'Z FLIP', icon: 'mobile_friendly', title: '3D Flip Phone Fold', onClick() { ctx.runTool('GEN_3D_ZFLIP'); } }),
          ui.button({ label: 'Z FOLD', icon: 'menu_book', title: '3D Foldable Tablet/Phone', onClick() { ctx.runTool('GEN_3D_ZFOLD'); } }),
          ui.button({ label: 'TABLET', icon: 'tablet_mac', title: '3D Tablet Frame', onClick() { ctx.runTool('GEN_3D_TABLET'); } }),
          ui.button({ label: 'LAPTOP', icon: 'laptop_mac', title: '3D Laptop with Screen', onClick() { ctx.runTool('GEN_3D_LAPTOP'); } }),
          ui.button({ label: 'MONITOR', icon: 'desktop_windows', title: '3D Desktop Monitor', onClick() { ctx.runTool('GEN_3D_MONITOR'); } }),
          ui.button({ label: 'PC TOWER', icon: 'computer', title: '3D PC Computer Case', onClick() { ctx.runTool('GEN_3D_PC'); } }),
          ui.button({ label: 'CRT TV', icon: 'tv', title: '3D Retro CRT Television', onClick() { ctx.runTool('GEN_3D_CRT'); } })
        ]);

        ui.section('Room & Furniture');
        ui.grid({ cols: 3 }, [
          ui.button({ label: 'ROOM', icon: 'roofing', title: '3D Isometric Room Box', onClick() { ctx.runTool('GEN_3D_ROOM'); } }),
          ui.button({ label: 'DOOR', icon: 'door_front', title: '3D Hinged Door', onClick() { ctx.runTool('GEN_3D_DOOR'); } }),
          ui.button({ label: 'WINDOW', icon: 'window', title: '3D Window Pane', onClick() { ctx.runTool('GEN_3D_WINDOW'); } }),
          ui.button({ label: 'TABLE', icon: 'table_restaurant', title: '3D Table Surface', onClick() { ctx.runTool('GEN_3D_TABLE'); } }),
          ui.button({ label: 'DESK', icon: 'desk', title: '3D Office Desk', onClick() { ctx.runTool('GEN_3D_DESK'); } }),
          ui.button({ label: 'CABINET', icon: 'inventory_2', title: '3D Storage Cabinet', onClick() { ctx.runTool('GEN_3D_CABINET'); } })
        ]);

        ui.section('Props & Character');
        ui.grid({ cols: 5 }, [
          ui.button({ label: 'BOX', icon: 'view_in_ar', title: '3D Parcel Box', onClick() { ctx.runTool('GEN_3D_BOX'); } }),
          ui.button({ label: 'BOOK', icon: 'auto_stories', title: '3D Book Cover & Pages', onClick() { ctx.runTool('GEN_3D_BOOK'); } }),
          ui.button({ label: 'BINDER', icon: 'folder_special', title: '3D Office Binder', onClick() { ctx.runTool('GEN_3D_BINDER'); } }),
          ui.button({ label: 'GLASSES', icon: 'visibility', title: '3D Glasses Frame', onClick() { ctx.runTool('GEN_3D_GLASSES'); } }),
          ui.button({ label: 'MC 3D', icon: 'accessibility_new', title: '3D Minecraft Character Rig', onClick() { ctx.runTool('GEN_3D_MC'); } })
        ]);
      }
    },
    {
      id: 'auto_mark',
      name: 'Auto Mark',
      icon: 'music_note',
      description: 'Automatic beatmark generator based on Bass transients or BPM tempo grid.',
      category: 'Tools',
      defaultEnabled: true,
      build(ui, ctx) {
        let currentMode = ctx.storage.get('auto_mark_mode', 'bass');
        let sensitivityVal = ctx.storage.get('auto_mark_sensitivity', 65);
        let bpmVal = ctx.storage.get('auto_mark_bpm', 120);
        let divisionVal = ctx.storage.get('auto_mark_division', '1/1');
        let clearExistingVal = ctx.storage.get('auto_mark_clear', true);

        function getSelectedAudioLayer() {
          let layer = ctx && typeof ctx.getSelectedLayer === 'function' ? ctx.getSelectedLayer() : null;
          const win = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
          const host = (win.parent && win.parent.currentProjectState) ? win.parent : win;
          const state = (ctx && ctx.getProjectState && ctx.getProjectState()) || host.currentProjectState;
          if (!layer && state && Array.isArray(state.layers)) {
            let selId = host.selectedLayerId;
            if (!selId && host.selectedLayerIds && host.selectedLayerIds.size > 0) {
              selId = Array.from(host.selectedLayerIds)[0];
            }
            if (selId) {
              layer = state.layers.find(l => l && (l.id === selId || String(l.id) === String(selId))) || null;
            }
          }
          return layer;
        }

        function isAudioLayer(layer) {
          if (!layer) return false;
          return layer.type === 'audio' || layer.mediaType === 'audio' || layer.isAudioTrack === true;
        }

        ui.section('Detection Mode');

        const modeWrap = document.createElement('div');
        modeWrap.className = 'toolbox-grid col-2';

        const btnBass = document.createElement('button');
        btnBass.type = 'button';
        btnBass.className = 'tool-btn extension-tool-btn';
        btnBass.innerHTML = '<span class="material-icons tool-btn-icon">graphic_eq</span><span class="tool-label">BASS</span>';
        btnBass.title = 'Detect kick drum and bass transients';

        const btnBpm = document.createElement('button');
        btnBpm.type = 'button';
        btnBpm.className = 'tool-btn extension-tool-btn';
        btnBpm.innerHTML = '<span class="material-icons tool-btn-icon">av_timer</span><span class="tool-label">BPM</span>';
        btnBpm.title = 'Generate markers from tempo BPM grid';

        modeWrap.appendChild(btnBass);
        modeWrap.appendChild(btnBpm);
        ui.custom(modeWrap);

        const settingsContainer = document.createElement('div');
        settingsContainer.className = 'auto-mark-settings-panel';
        ui.custom(settingsContainer);

        function updateModeButtons() {
          if (currentMode === 'bass') {
            btnBass.classList.add('tool-btn--active');
            btnBpm.classList.remove('tool-btn--active');
          } else {
            btnBpm.classList.add('tool-btn--active');
            btnBass.classList.remove('tool-btn--active');
          }
        }

        function renderSettings() {
          settingsContainer.innerHTML = '';
          updateModeButtons();
          const subUI = ui.createSubBuilder ? ui.createSubBuilder(settingsContainer) : ui;

          if (currentMode === 'bass') {
            subUI.slider({
              label: 'SENSITIVITY',
              min: 10,
              max: 100,
              step: 1,
              value: sensitivityVal,
              unit: '%',
              title: 'Drag to adjust bass detection sensitivity',
              container: settingsContainer,
              onChange(val) {
                sensitivityVal = Math.round(val);
                ctx.storage.set('auto_mark_sensitivity', sensitivityVal);
              }
            });

            const hint = document.createElement('div');
            hint.className = 'extension-text extension-text--label';
            hint.style.fontSize = '11px';
            hint.style.opacity = '0.75';
            hint.style.marginTop = '2px';
            hint.textContent = 'Higher sensitivity captures lighter hits; lower sensitivity captures prominent kicks only.';
            settingsContainer.appendChild(hint);
          } else {
            // BPM Mode settings
            const bpmGroup = document.createElement('div');
            bpmGroup.className = 'form-group';
            bpmGroup.style.display = 'flex';
            bpmGroup.style.flexDirection = 'column';
            bpmGroup.style.gap = '4px';

            const bpmLabel = document.createElement('label');
            bpmLabel.className = 'status-label';
            bpmLabel.textContent = 'TEMPO (BPM)';
            bpmGroup.appendChild(bpmLabel);

            const bpmControlRow = document.createElement('div');
            bpmControlRow.className = 'auto-mark-bpm-row';

            const inputWrap = document.createElement('div');
            inputWrap.className = 'auto-mark-bpm-input-wrap';

            const bpmInput = document.createElement('input');
            bpmInput.type = 'number';
            bpmInput.className = 'extension-input';
            bpmInput.min = '40';
            bpmInput.max = '240';
            bpmInput.step = '1';
            bpmInput.value = String(bpmVal);
            bpmInput.addEventListener('input', (e) => {
              bpmVal = parseInt(e.target.value, 10) || 120;
              ctx.storage.set('auto_mark_bpm', bpmVal);
            });
            inputWrap.appendChild(bpmInput);
            bpmControlRow.appendChild(inputWrap);

            const btnDetectBpm = document.createElement('button');
            btnDetectBpm.type = 'button';
            btnDetectBpm.className = 'tool-btn extension-tool-btn auto-mark-detect-btn';
            btnDetectBpm.innerHTML = '<span class="material-icons tool-btn-icon">graphic_eq</span><span class="tool-label">DETECT BPM</span>';
            btnDetectBpm.title = 'Detect tempo BPM from selected audio layer';

            btnDetectBpm.addEventListener('click', async (e) => {
              e.preventDefault();
              const layer = getSelectedAudioLayer();
              if (!layer) {
                ctx.showToast('Please select an audio layer first', true);
                return;
              }
              if (!isAudioLayer(layer)) {
                ctx.showToast('Selected layer is not an audio layer', true);
                return;
              }

              ctx.showToast('Analyzing audio tempo...');
              try {
                const win = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
                let detected = 120;
                let audioBuffer = null;
                if (typeof win.getAudioBufferForLayer === 'function') {
                  audioBuffer = await win.getAudioBufferForLayer(layer);
                }
                if (audioBuffer && typeof win.detectBassFromAudioBuffer === 'function' && typeof win.estimateBPMFromAudio === 'function') {
                  const beats = win.detectBassFromAudioBuffer(audioBuffer, 65, layer.durationSec || 30);
                  detected = win.estimateBPMFromAudio(beats);
                } else if (typeof win.getAudioPeaksForLayer === 'function' && typeof win.detectBassFromWaveformPeaks === 'function' && typeof win.estimateBPMFromAudio === 'function') {
                  const peaks = await win.getAudioPeaksForLayer(layer, 800);
                  const beats = win.detectBassFromWaveformPeaks(peaks, layer.durationSec || 30, 65);
                  detected = win.estimateBPMFromAudio(beats);
                }
                bpmVal = Math.round(detected);
                bpmInput.value = String(bpmVal);
                ctx.storage.set('auto_mark_bpm', bpmVal);
                ctx.showToast(`Detected tempo: ${bpmVal} BPM`);
              } catch (err) {
                ctx.showToast(`Failed to detect BPM: ${err.message}`, true);
              }
            });

            bpmControlRow.appendChild(btnDetectBpm);
            bpmGroup.appendChild(bpmControlRow);
            settingsContainer.appendChild(bpmGroup);

            // Division selector
            const divWrap = document.createElement('div');
            divWrap.style.marginTop = '4px';

            const divLabel = document.createElement('span');
            divLabel.className = 'status-label';
            divLabel.textContent = 'BEAT DIVISION';
            divWrap.appendChild(divLabel);

            const divGrid = document.createElement('div');
            divGrid.className = 'toolbox-grid col-3';
            divGrid.style.marginTop = '4px';

            const divisions = [
              { id: '1/1', label: '1/1 BEAT', title: 'Every beat (Quarter note)' },
              { id: '1/2', label: '1/2 BEAT', title: 'Half beat (Eighth note)' },
              { id: '1/4', label: '1/4 BEAT', title: 'Quarter beat (Sixteenth note)' }
            ];

            divisions.forEach(d => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = `tool-btn extension-tool-btn ${divisionVal === d.id ? 'tool-btn--active' : ''}`;
              btn.innerHTML = `<span class="tool-label">${d.label}</span>`;
              btn.title = d.title;
              btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                divisionVal = d.id;
                ctx.storage.set('auto_mark_division', divisionVal);
                Array.from(divGrid.children).forEach(c => c.classList.remove('tool-btn--active'));
                btn.classList.add('tool-btn--active');
              });
              divGrid.appendChild(btn);
            });

            divWrap.appendChild(divGrid);
            settingsContainer.appendChild(divWrap);
          }
        }

        btnBass.addEventListener('click', (e) => {
          e.preventDefault();
          currentMode = 'bass';
          ctx.storage.set('auto_mark_mode', 'bass');
          renderSettings();
        });

        btnBpm.addEventListener('click', (e) => {
          e.preventDefault();
          currentMode = 'bpm';
          ctx.storage.set('auto_mark_mode', 'bpm');
          renderSettings();
        });

        renderSettings();

        ui.section('Options');
        ui.switch({
          label: 'Clear Existing Markers',
          checked: clearExistingVal,
          onChange(checked) {
            clearExistingVal = !!checked;
            ctx.storage.set('auto_mark_clear', clearExistingVal);
          }
        });

        ui.grid({ cols: 2 }, [
          ui.button({
            label: 'AUTO MARK',
            icon: 'auto_awesome',
            title: 'Generate beatmarks on selected audio layer',
            className: 'tool-btn-primary',
            onClick() {
              const layer = getSelectedAudioLayer();
              if (!layer) {
                ctx.showToast('Please select an audio layer first', true);
                return;
              }
              if (!isAudioLayer(layer)) {
                ctx.showToast('Selected layer is not an audio layer', true);
                return;
              }

              ctx.showToast('Analyzing audio...');
              ctx.runTool('AUTO_MARK', {
                mode: currentMode,
                sensitivity: sensitivityVal,
                bpm: bpmVal,
                division: divisionVal,
                clearExisting: clearExistingVal
              });
            }
          }),
          ui.button({
            label: 'CLEAR ALL',
            icon: 'delete_sweep',
            title: 'Clear all timeline beatmarks',
            onClick() {
              const state = ctx.getProjectState ? ctx.getProjectState() : null;
              const marks = (state && state.beatmarks) || [];
              if (marks.length === 0) {
                ctx.showToast('No beatmarks to clear');
                return;
              }
              state.beatmarks = [];
              const win = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
              const host = (win.parent && win.parent.currentProjectState) ? win.parent : win;
              if (host.currentProjectState) {
                host.currentProjectState.beatmarks = [];
              }
              if (typeof host.renderTimelineBeatmarks === 'function') host.renderTimelineBeatmarks();
              if (typeof host.saveCurrentProjectBeatmarks === 'function') host.saveCurrentProjectBeatmarks(true);
              if (typeof host.updateTimeBadgeBeatmarkState === 'function') host.updateTimeBadgeBeatmarkState();
              if (typeof host.syncDesktopMarkerLabels === 'function') host.syncDesktopMarkerLabels();
              if (typeof host.syncBeatmarkDrawerUI === 'function') host.syncBeatmarkDrawerUI();
              if (host.UndoRedoManager && typeof host.UndoRedoManager.recordSnapshot === 'function' && !host.UndoRedoManager.isApplying) {
                host.UndoRedoManager.recordSnapshot();
              }
              ctx.showToast('All beatmarks cleared');
            }
          })
        ]);
      }
    }
  ];

  /**
   * Register all built-in cards into CardBuilder
   */
  function registerBuiltins() {
    if (!global.CardBuilder) return;
    BUILTIN_CARDS.forEach(cardDef => {
      global.CardBuilder.defineCard(cardDef);
    });
  }

  /**
   * Extension Modal UI Controller (for index.html)
   */
  const ExtensionManager = {
    init() {
      registerBuiltins();

      // Setup Import Button and File Input
      const btnImport = document.getElementById('btn-import-extension');
      const inputImport = document.getElementById('input-import-jsx');

      if (btnImport && inputImport && !btnImport._extBound) {
        btnImport._extBound = true;
        btnImport.addEventListener('click', (e) => {
          e.preventDefault();
          inputImport.click();
        });

        inputImport.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) {
            this.handleImportFile(file);
          }
          inputImport.value = ''; // Reset for next selection
        });
      }

      // Initial render of the extension list
      this.renderList();

      // Listen for custom card deletions or state changes
      if (typeof window !== 'undefined') {
        window.addEventListener('extension-custom-deleted', () => this.renderList());
        window.addEventListener('extension-state-changed', () => this.renderList());
      }
    },

    /**
     * Read, validate, and load an imported .jsx file
     */
    handleImportFile(file) {
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        if (!global.CardBuilder) {
          alert('Error: CardBuilder runtime tidak tersedia.');
          return;
        }

        // Validate JSX format (supports both Card DSL and raw AE ExtendScript)
        const validation = global.CardBuilder.validateJSX(content, file.name);
        if (!validation.valid) {
          alert(`Import Gagal!\n\n${validation.error}`);
          return;
        }

        // Load into runtime and persist
        const loadResult = global.CardBuilder.loadJSXString(content, true, file.name);
        if (!loadResult.valid) {
          alert(`Gagal mengeksekusi file .jsx: ${loadResult.error}`);
          return;
        }

        // Auto-enable newly imported card
        if (loadResult.def && loadResult.def.id) {
          global.CardBuilder.State.setEnabled(loadResult.def.id, true);
        }

        // Sync with FishExtensions
        global.CardBuilder.syncToFishExtensions();

        // Refresh list
        this.renderList();

        const cardName = (loadResult.def && loadResult.def.name) || file.name;
        alert(`Berhasil mengimpor ekstensi "${cardName}"!\nEkstensi kini aktif dan dapat digunakan.`);
      };

      reader.onerror = () => {
        alert('Gagal membaca file dari sistem.');
      };

      reader.readAsText(file);
    },

    /**
     * Render the cards list with On/Off switches inside #extension-modal-list
     */
    renderList() {
      const container = document.getElementById('extension-modal-list');
      if (!container) return;

      if (!global.CardBuilder) return;
      const allCards = global.CardBuilder.getRegistry();
      const customCards = global.CardBuilder.getAllCustomCards();
      const customIds = new Set(customCards.map(c => c.id));

      if (allCards.length === 0) {
        container.innerHTML = `
          <div class="folder-empty-state">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="var(--color-primary)" opacity="0.4">
              <path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5s-1.12-2.5-2.5-2.5z"/>
            </svg>
            <span class="folder-empty-text">No Extensions Installed</span>
          </div>
        `;
        return;
      }

      container.innerHTML = allCards.map(card => {
        const isCustom = customIds.has(card.id);
        const isEnabled = global.CardBuilder.State.isEnabled(card.id, card.defaultEnabled !== false);
        const badgeText = isCustom ? 'Custom .jsx' : 'Built-in';
        const badgeClass = isCustom ? 'extension-badge-custom' : 'extension-badge-builtin';

        return `
          <div class="extension-manager-row" data-card-id="${card.id}">
            <div class="extension-row-icon-box">
              ${card.icon ? `<span class="material-icons" style="font-size: 20px; color: var(--color-primary);">${escapeHtml(card.icon)}</span>` : `
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5s-1.12-2.5-2.5-2.5z"/>
              </svg>`}
            </div>
            <div class="extension-row-info">
              <div class="extension-row-title-line">
                <span class="extension-row-name">${escapeHtml(card.name || card.id)}</span>
                <span class="extension-badge ${badgeClass}">${badgeText}</span>
              </div>
              <span class="extension-row-desc">${escapeHtml(card.description || '')}</span>
            </div>
            <div class="extension-row-actions">
              ${isCustom ? `
                <button type="button" class="extension-delete-btn" data-delete-id="${card.id}" title="Hapus Ekstensi" aria-label="Hapus">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                  </svg>
                </button>
              ` : ''}
              <label class="switch-container extension-switch-label" title="${isEnabled ? 'Disable Extension' : 'Enable Extension'}">
                <span class="switch">
                  <input type="checkbox" class="extension-toggle-checkbox" data-card-id="${card.id}" ${isEnabled ? 'checked' : ''}>
                  <span class="slider"></span>
                </span>
              </label>
            </div>
          </div>
        `;
      }).join('');

      // Bind toggle switches
      container.querySelectorAll('.extension-toggle-checkbox').forEach(input => {
        input.addEventListener('change', (e) => {
          const cardId = input.getAttribute('data-card-id');
          const checked = e.target.checked;
          if (cardId && global.CardBuilder) {
            global.CardBuilder.State.setEnabled(cardId, checked);
            global.CardBuilder.syncToFishExtensions();
          }
        });
      });

      // Bind delete buttons for custom cards
      container.querySelectorAll('.extension-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const cardId = btn.getAttribute('data-delete-id');
          if (cardId && global.CardBuilder) {
            if (confirm(`Hapus ekstensi kustom "${cardId}"?`)) {
              global.CardBuilder.deleteCustomCard(cardId);
            }
          }
        });
      });
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Register built-ins immediately so registry is populated
  registerBuiltins();

  // Export globally
  global.ExtensionManager = ExtensionManager;

  // Auto-init on page load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => ExtensionManager.init());
    } else {
      ExtensionManager.init();
    }
  }

})(typeof window !== 'undefined' ? window : globalThis);
