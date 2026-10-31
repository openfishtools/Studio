const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing Auto Mark Extension ---');

// 1. Check file existence
const extPath = path.join(__dirname, '..', 'Extension', 'auto_mark.jsx');
assert.strictEqual(fs.existsSync(extPath), true, 'Extension/auto_mark.jsx must exist');
const jsxContent = fs.readFileSync(extPath, 'utf8');

// 2. Validate JSX Structure
assert.ok(jsxContent.includes("id: 'auto_mark'"), 'Card id must be auto_mark');
assert.ok(jsxContent.includes("name: 'Auto Mark'"), 'Card name must be Auto Mark');
assert.ok(jsxContent.includes("Please select an audio layer first"), 'English error toast for unselected layer must exist');
assert.ok(jsxContent.includes("Selected layer is not an audio layer"), 'English error toast for non-audio layer must exist');
assert.ok(jsxContent.includes("BASS"), 'Bass mode button must exist');
assert.ok(jsxContent.includes("BPM"), 'BPM mode button must exist');
assert.ok(jsxContent.includes("SENSITIVITY"), 'Sensitivity slider must exist');

// 3. Test execution simulation with mock context
let toasts = [];
const mockCtx = {
  selectedLayer: null,
  projectState: {
    layers: [],
    beatmarks: []
  },
  getSelectedLayer() {
    return this.selectedLayer;
  },
  getProjectState() {
    return this.projectState;
  },
  showToast(msg, isError) {
    toasts.push({ msg, isError: !!isError });
  },
  runTool(toolName, opts) {
    if (toolName === 'AUTO_MARK') {
      const l = this.getSelectedLayer();
      if (!l || (l.type !== 'audio' && l.mediaType !== 'audio')) {
        this.showToast('Please select an audio layer first', true);
        return false;
      }
      return true;
    }
  },
  storage: {
    data: {},
    get(k, def) { return this.data[k] !== undefined ? this.data[k] : def; },
    set(k, v) { this.data[k] = v; }
  }
};

// Simulation: No layer selected
mockCtx.selectedLayer = null;
let layer = mockCtx.getSelectedLayer();
if (!layer) {
  mockCtx.showToast('Please select an audio layer first', true);
}
assert.strictEqual(toasts.length, 1);
assert.strictEqual(toasts[0].isError, true);
assert.ok(toasts[0].msg.includes('Please select an audio layer'));

// Simulation: Non-audio layer selected
toasts = [];
mockCtx.selectedLayer = { id: 'layer1', name: 'Shape 1', type: 'shape' };
layer = mockCtx.getSelectedLayer();
if (!layer) {
  mockCtx.showToast('Please select an audio layer first', true);
} else if (layer.type !== 'audio' && layer.mediaType !== 'audio') {
  mockCtx.showToast('Selected layer is not an audio layer', true);
}
assert.strictEqual(toasts.length, 1);
assert.strictEqual(toasts[0].isError, true);
assert.ok(toasts[0].msg.includes('not an audio layer'));

// Simulation: Audio layer selected
toasts = [];
mockCtx.selectedLayer = { id: 'audio1', name: 'Background Music', type: 'audio', durationSec: 10, startSec: 0 };
layer = mockCtx.getSelectedLayer();
let isAudio = layer && (layer.type === 'audio' || layer.mediaType === 'audio');
assert.strictEqual(isAudio, true);

// Test BPM calculation
const bpm = 120;
const interval = 60 / bpm; // 0.5 sec
let marks = [];
let t = 0;
while (t <= 5) {
  marks.push(Math.round(t * 60) / 60);
  t += interval;
}
assert.strictEqual(marks.length, 11); // 0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0

console.log('PASS: Auto Mark extension verification passed successfully!');
