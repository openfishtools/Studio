/**
 * OpenFishTools Extension - Auto Mark Card
 * Automatic beatmark generator using Bass transient detection or BPM tempo grid.
 */
Card({
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
});
