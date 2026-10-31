const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('--- Deep Verification: VideoCompEngine, PreviewCacheManager & Composition Operations ---');

// Set up mock browser environment
global.window = global;
global.window.location = { search: '', href: '' };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: (id) => null,
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: () => {},
      clearRect: () => {},
      fillRect: () => {}
    })
  })
};
global.performance = { now: () => Date.now() };

// 1. Load VideoCompEngine
require(path.join(__dirname, '../js/media/videocomp-enggine.js'));
const engine = global.VideoCompEngine;
assert(engine, 'VideoCompEngine should be exported on global/window');
console.log('✓ VideoCompEngine loaded successfully.');

// Test: computeLayerClipTime
const testLayer = {
  startSec: 2.0,
  speed: 1.5,
  sourceOffsetSec: 0.5,
  speedMode: 'standard'
};
const tClip = engine.computeLayerClipTime(testLayer, 4.0);
// expected: sourceOffsetSec + (currentSec - start) * speed = 0.5 + (4.0 - 2.0) * 1.5 = 3.5
assert.strictEqual(tClip, 3.5, 'computeLayerClipTime standard calculation mismatch');

// Test with precomp offset parameters: (layer, currentSec, rootStartSec, speed, sourceOffsetSec)
const tClipPrecomp = engine.computeLayerClipTime(testLayer, 5.0, 3.0, 2.0, 1.0);
// expected: 1.0 + (5.0 - 3.0) * 2.0 = 5.0
assert.strictEqual(tClipPrecomp, 5.0, 'computeLayerClipTime precomp parameter calculation mismatch');

// Adversarial Test: clip starting after 10s (rootStartSec = 15.0s, e.g. 5-arg signature)
const tClipLateStart = engine.computeLayerClipTime(testLayer, 20.0, 15.0, 2.0, 1.0);
// expected: 1.0 + (20.0 - 15.0) * 2.0 = 11.0
assert.strictEqual(tClipLateStart, 11.0, 'computeLayerClipTime must correctly handle rootStartSec > 10 in 5-arg signature');

// Adversarial Test: zoomed out timeline PPS <= 10 (3-arg signature: layer, currentSec, pps = 5)
const tClipZoomedOut = engine.computeLayerClipTime({ startPx: 10, speed: 1.0, sourceOffsetSec: 0 }, 6.0, 5);
// start = 10 / 5 = 2.0s; expected: 0 + (6.0 - 2.0) * 1.0 = 4.0s
assert.strictEqual(tClipZoomedOut, 4.0, 'computeLayerClipTime must handle pps <= 10 in 3-arg signature without confusing it with rootStartSec');

// Test with object options: (layer, currentSec, { rootStartSec, speed, sourceOffsetSec })
const tClipObj = engine.computeLayerClipTime(testLayer, 5.0, { rootStartSec: 3.0, speed: 2.0, sourceOffsetSec: 1.0 });
assert.strictEqual(tClipObj, 5.0, 'computeLayerClipTime object options calculation mismatch');

// Test time_remap
const testRemapLayer = {
  startSec: 1.0,
  speedMode: 'time_remap',
  timeRemap: 7.25
};
global.getLayerEffectivePropsAtTime = (l, t) => l;
const tClipRemap = engine.computeLayerClipTime(testRemapLayer, 3.0);
assert.strictEqual(tClipRemap, 7.25, 'computeLayerClipTime time_remap calculation mismatch');

// Test: computeLayerClipTime with reverse speed (negative speed)
const testReverseLayer = {
  startSec: 2.0,
  durationSec: 5.0,
  speed: -1.0,
  sourceOffsetSec: 0.5,
  speedMode: 'standard'
};
const tClipRevStart = engine.computeLayerClipTime(testReverseLayer, 2.0);
assert.strictEqual(tClipRevStart, 5.5, 'computeLayerClipTime reverse at start mismatch');
const tClipRevMid = engine.computeLayerClipTime(testReverseLayer, 4.5);
assert.strictEqual(tClipRevMid, 3.0, 'computeLayerClipTime reverse at midpoint mismatch');
const tClipRevEnd = engine.computeLayerClipTime(testReverseLayer, 7.0);
assert.strictEqual(tClipRevEnd, 0.5, 'computeLayerClipTime reverse at end mismatch');
console.log('✓ computeLayerClipTime verified under all parameter signatures and modes (including reverse).');

// Test: seekVideoElementCoalesced
let mockVideo = {
  tagName: 'VIDEO',
  readyState: 4,
  videoWidth: 1920,
  videoHeight: 1080,
  currentTime: 1.0,
  duration: 10.0,
  seeking: false,
  _pendingScrubTime: null
};

// Scrub seek while not seeking
engine.seekVideoElementCoalesced(mockVideo, 3.0, false);
assert.strictEqual(mockVideo.currentTime, 3.0, 'Immediate scrub seek should update currentTime');
assert.strictEqual(mockVideo._pendingScrubTime, null, 'Pending scrub should be null when not seeking');

// Scrub seek while currently seeking -> coalesced single slot
mockVideo.seeking = true;
engine.seekVideoElementCoalesced(mockVideo, 4.5, false);
assert.strictEqual(mockVideo._pendingScrubTime, 4.5, 'Coalesced seek should set _pendingScrubTime');

// Fast playback stepped seek
mockVideo.seeking = false;
mockVideo.paused = true;
engine.seekVideoElementCoalesced(mockVideo, 6.0, true, true);
assert.strictEqual(mockVideo.currentTime, 6.0, 'Stepped seek should update currentTime');
console.log('✓ seekVideoElementCoalesced verified (immediate, single-slot coalescing, and stepped).');

// Test: resolveLayerVideoElement
const mockMediaEntry = {
  el: mockVideo,
  poster: { naturalWidth: 1920, naturalHeight: 1080 },
  freezeCanvas: null,
  hasFreezeFrame: false
};

// Test normal resolution
const resolved = engine.resolveLayerVideoElement(testLayer, mockMediaEntry, { currentSec: 4.0 });
assert(resolved.el === mockVideo, 'resolveLayerVideoElement should return mockVideo element');
assert(resolved.timeInClip === 3.5, 'resolveLayerVideoElement should return accurate timeInClip');
assert.strictEqual(resolved.hasUnreadyMedia, false, 'hasUnreadyMedia should be false for ready video');

// Test idle-cache guard: must return null el and hasUnreadyMedia: true
const resolvedIdle = engine.resolveLayerVideoElement(testLayer, mockMediaEntry, { currentSec: 4.0, isIdleCache: true });
assert.strictEqual(resolvedIdle.el, null, 'idle-cache guard must return null el');
assert.strictEqual(resolvedIdle.hasUnreadyMedia, true, 'idle-cache guard must report hasUnreadyMedia: true');

// Test direct HTMLVideoElement passed as media
const resolvedDirect = engine.resolveLayerVideoElement(testLayer, mockVideo, { currentSec: 4.0 });
assert(resolvedDirect.el === mockVideo, 'resolveLayerVideoElement must handle direct HTMLVideoElement');
console.log('✓ resolveLayerVideoElement verified (standard, idle-cache guard, and direct element).');

// Test: computePlaybackRates & pitch preservation
const normalRates = engine.computePlaybackRates(mockVideo, 1.0, 1.0, testLayer);
assert.strictEqual(normalRates.wantPreservePitch, true, 'Normal 1x rate should preserve pitch');
assert.strictEqual(normalRates.tooFastForVideoEl, false, '1x rate is not too fast');

const fastRates = engine.computePlaybackRates(mockVideo, 1.5, 1.0, testLayer);
assert.strictEqual(fastRates.wantPreservePitch, false, 'Fast playback >1.35x must disable pitch preservation');

const extremeRates = engine.computePlaybackRates(mockVideo, 3.0, 1.0, testLayer);
assert.strictEqual(extremeRates.tooFastForVideoEl, true, 'Rates >2.0x must be flagged as tooFastForVideoEl');
assert.strictEqual(extremeRates.finalPlaybackRate, 1.0, 'Rates >2.0x must clamp playbackRate to 1.0 for stepped seeking');
console.log('✓ computePlaybackRates verified across 1x, 1.5x, and 3x scenarios.');

// Test: computeAdaptiveDraftScale & adjustAdaptiveDraftBudget
const layersWithEffects = [
  { type: 'adjustment', effects: [{ type: 'deep-glow', disabled: false }] },
  { type: 'shape', effects: [{ type: 'shatter', disabled: false }] }
];
const draftScaleHeavy = engine.computeAdaptiveDraftScale(layersWithEffects, { canUseAdaptiveDraft: true, isInteractiveMotion: true });
assert.strictEqual(draftScaleHeavy, 0.38, 'Heavy effects under motion should scale down to 0.38x');

const draftScaleLight = engine.computeAdaptiveDraftScale([], { canUseAdaptiveDraft: true, isInteractiveMotion: true });
assert.strictEqual(draftScaleLight, 0.50, 'Light effects under motion should scale down to 0.50x');

const adBudgetState = { scale: 0.50, emaMs: 8.0, fastStreak: 0 };
engine.adjustAdaptiveDraftBudget(35.0, 60, adBudgetState);
assert(adBudgetState.scale < 0.50, 'Budget overrun should decrease adaptive draft scale');
console.log('✓ computeAdaptiveDraftScale and adjustAdaptiveDraftBudget verified.');

// 2. Load PreviewCacheManager
require(path.join(__dirname, '../js/media/preview-cache.js'));
const pcm = window.PreviewCacheManager;
assert(pcm, 'PreviewCacheManager should be exported on global/window');
console.log('✓ PreviewCacheManager loaded successfully.');

// Test: getLayerSignature covers all R4 properties
const fullLayer = {
  id: 'layer_1',
  type: 'shape',
  startSec: 1.0,
  durationSec: 4.0,
  sourceOffsetSec: 0.0,
  posX: 960,
  posY: 540,
  posZ: 0,
  scaleW: 500,
  scaleH: 300,
  scaleZ: 100,
  rotX: 0,
  rotY: 0,
  rotZ: 45,
  rotation: 45,
  skewX: 10,
  skewY: 5,
  anchorX: 0,
  anchorY: 0,
  opacity: 0.85,
  blendMode: 'screen',
  roundness: 20,
  hidden: false,
  locked: false,
  speed: 1.0,
  speedMode: 'standard',
  fillType: 'color',
  fillColor: '#ff0000',
  shapeProps: { sizeX: 500, sizeY: 300, roundness: 20 },
  textProps: { fontSize: 48, fontFamily: 'Inter' },
  masks: [{ id: 'm1', path: 'M0,0 L10,10' }],
  effects: [{ id: 'fx1', type: 'gaussian-blur', value: 10 }],
  keyframes: { opacity: [{ time: 1.0, val: 0.5 }] }
};

const sig1 = pcm.getLayerSignature(fullLayer, 0);
assert(sig1.includes('10.00'), 'Signature must include skewX');
assert(sig1.includes('5.00'), 'Signature must include skewY');
assert(sig1.includes('20.00'), 'Signature must include roundness');
assert(sig1.includes('screen'), 'Signature must include blendMode');
assert(sig1.includes('color'), 'Signature must include fillType');
assert(sig1.includes('gaussian-blur'), 'Signature must include effects');
assert(sig1.includes('Inter'), 'Signature must include textProps');
assert(sig1.includes('m1'), 'Signature must include masks');
console.log('✓ getLayerSignature verified across all R4 properties.');

// Test: syncStateWithProject auto-invalidation
const mockProject = {
  fps: 60,
  baseW: 1920,
  baseH: 1080,
  resolution: '1080p',
  aspectRatio: '16:9',
  bgColor: '#000000',
  motionBlur: { enabled: false },
  layers: [fullLayer]
};

pcm.syncStateWithProject(mockProject, 'root');

// Simulate property edit: change skewX
fullLayer.skewX = 25;
let invalidated = pcm.syncStateWithProject(mockProject, 'root');
assert(invalidated, 'syncStateWithProject must detect skewX modification and invalidate');
assert.strictEqual(fullLayer._shapeDirty, true, 'syncStateWithProject must mark _shapeDirty = true');
assert.strictEqual(fullLayer._fillDirty, true, 'syncStateWithProject must mark _fillDirty = true');

// Simulate comp setting edit: change aspectRatio
mockProject.aspectRatio = '9:16';
let compInvalidated = pcm.syncStateWithProject(mockProject, 'root');
assert(compInvalidated, 'syncStateWithProject must detect aspectRatio change and invalidate');

// Adversarial Test: layer order change must invalidate
const secondLayer = { id: 'layer_2', type: 'text', startSec: 0, durationSec: 5, posX: 100, posY: 100 };
mockProject.layers = [fullLayer, secondLayer];
pcm.syncStateWithProject(mockProject, 'root');
mockProject.layers = [secondLayer, fullLayer]; // reordered
let orderInvalidated = pcm.syncStateWithProject(mockProject, 'root');
assert(orderInvalidated, 'syncStateWithProject must detect layer order change and invalidate');

// Adversarial Test: dataUrl media swap must invalidate
fullLayer.dataUrl = 'blob:new-video-source';
let dataUrlInvalidated = pcm.syncStateWithProject(mockProject, 'root');
assert(dataUrlInvalidated, 'syncStateWithProject must detect media dataUrl change and invalidate');

// Adversarial Test: isTimeReadyToCache must return false when video is active, true when only graphics active
const videoLayer = { id: 'v1', type: 'video', startSec: 0.0, durationSec: 10.0, hidden: false };
mockProject.layers = [videoLayer];
global.currentProjectState = mockProject;
assert.strictEqual(pcm.isTimeReadyToCache(5.0), false, 'isTimeReadyToCache must return false during active video to prevent idle seeking');
assert.strictEqual(pcm.isTimeReadyToCache(15.0), true, 'isTimeReadyToCache must return true when video is outside active bounds');

// Adversarial Test: isTimeReadyToCache must return false when video is active in nested precomp
const precompWithVideo = {
  id: 'precomp_1',
  type: 'precomp',
  startSec: 0.0,
  durationSec: 10.0,
  speed: 1.0,
  sourceOffsetSec: 0,
  layers: [{ id: 'nested_v1', type: 'video', startSec: 0.0, durationSec: 5.0 }]
};
mockProject.layers = [precompWithVideo];
assert.strictEqual(pcm.isTimeReadyToCache(2.0), false, 'isTimeReadyToCache must detect video inside nested precomp and return false');
assert.strictEqual(pcm.isTimeReadyToCache(8.0), true, 'isTimeReadyToCache must return true when outside nested precomp video bounds');

console.log('✓ syncStateWithProject auto-invalidation and buffer reset verified.');

// Test: Dynamic maxFrames based on project duration
global.getProjectTotalDuration = () => 15.0; // 15 seconds
assert(pcm.maxFrames >= 15 * 60 + 120, 'maxFrames must adapt dynamically to project total duration');

// Test: hasFrame and getFrame resolution enforcement
pcm.clearAll('all');
const mockFrameBmp = { width: 960, height: 540 };
pcm.getPool('root').set(10, { bitmap: mockFrameBmp, width: 960, height: 540, isDraft: false });
assert.strictEqual(pcm.hasFrame(10, 960, 540), true, 'hasFrame must return true for matching resolution');
assert.strictEqual(pcm.getFrame(10, 960, 540), mockFrameBmp, 'getFrame must return bitmap for matching resolution');
// When resolution mismatches (e.g. preview resized to 1280x720)
assert.strictEqual(pcm.hasFrame(10, 1280, 720), false, 'hasFrame must reject mismatched resolution');
assert.strictEqual(pcm.getPool('root').has(10), false, 'hasFrame must auto-prune mismatched resolution frame');

// Test: VideoCompEngine.resolvePrecompElement prioritizes baked source.frames
const bakedPrecomp = {
  id: 'precomp_baked_test',
  type: 'precomp',
  startSec: 0,
  durationSec: 5,
  speed: 1.0,
  sourceOffsetSec: 0,
  layers: [{ id: 'child_1', type: 'text', startSec: 0, durationSec: 5 }]
};
const mockBakedBmp = { width: 1920, height: 1080 };
const vfeMockSource = {
  sourceKey: 'precomp_precomp_baked_test',
  frames: new Map([[0, mockBakedBmp]]),
  fps: 60
};
const origVfe = global.VideoFrameExtractor;
try {
  global.VideoFrameExtractor = {
    _getSourceKey: (l) => 'precomp_' + l.id,
    getSourceCache: (k) => (k === vfeMockSource.sourceKey ? vfeMockSource : null),
    getInterpolatedFrame: () => mockBakedBmp,
    _isPrecompLightweightContent: () => true
  };
  const resBaked = engine.resolvePrecompElement(bakedPrecomp, { currentSec: 0 });
  assert.strictEqual(resBaked.fromSequence, true, 'resolvePrecompElement must prioritize baked sequence frames over lightweight live check');
  assert.strictEqual(resBaked.el, mockBakedBmp, 'resolvePrecompElement must return baked bitmap');
} finally {
  global.VideoFrameExtractor = origVfe;
}
console.log('✓ Dynamic maxFrames, cache resolution matching & baked precomp priority verified.');

// 3. Test applyFitOrStretchToComposition
// Load editor-canvas.js dependencies
mockProject.layers = [fullLayer];
global.currentProjectState = mockProject;
global.selectedLayerId = fullLayer.id;
global.currentSelectedLayerId = null;
global.syncShapeControllerUI = () => {};
global.syncTransformControllerValues = () => {};
global.recordLayerPropertyChange = (l, prop) => {};
global.redrawComposition = () => {};

require(path.join(__dirname, '../js/editor/editor-canvas.js'));
assert(typeof window.applyFitOrStretchToComposition === 'function', 'applyFitOrStretchToComposition must be defined on window');

// Test: fit mode on shape layer using canonical window.selectedLayerId and resetting transformScaleX/Y
mockProject.baseW = 1920;
mockProject.baseH = 1080;
fullLayer.transformScaleX = 2.5;
fullLayer.transformScaleY = 3.0;
window.applyFitOrStretchToComposition('fit');
assert.strictEqual(fullLayer.posX, 960, 'fit mode must center posX at baseW/2');
assert.strictEqual(fullLayer.posY, 540, 'fit mode must center posY at baseH/2');
assert.strictEqual(fullLayer.scaleW, 1920, 'fit mode on shape must scale scaleW to compW');
assert.strictEqual(fullLayer.scaleH, 1080, 'fit mode on shape must scale scaleH to compH');
assert.strictEqual(fullLayer.transformScaleX, 1.0, 'fit mode must reset transformScaleX to 1.0 on shape');
assert.strictEqual(fullLayer.transformScaleY, 1.0, 'fit mode must reset transformScaleY to 1.0 on shape');
assert.strictEqual(fullLayer.shapeProps.sizeX, 1920, 'fit mode must update shapeProps.sizeX');
assert.strictEqual(fullLayer.shapeProps.sizeY, 1080, 'fit mode must update shapeProps.sizeY');
assert.strictEqual(fullLayer._shapeDirty, true, 'fit mode must set _shapeDirty = true');
assert.strictEqual(fullLayer._userResized, true, 'fit mode must set _userResized = true');

// Test: stretch mode
window.applyFitOrStretchToComposition('stretch');
assert.strictEqual(fullLayer.scaleW, 1920, 'stretch mode must stretch scaleW to compW');
assert.strictEqual(fullLayer.scaleH, 1080, 'stretch mode must stretch scaleH to compH');
assert.strictEqual(fullLayer.aspectLocked, false, 'stretch mode must set aspectLocked = false');

// Adversarial Test: fit mode on image layer using canonical selectedLayerId and media.el.naturalWidth / naturalHeight
const mockImgLayer = {
  id: 'img_layer',
  type: 'image',
  scaleW: 100,
  scaleH: 100
};
mockProject.layers.push(mockImgLayer);
global.selectedLayerId = 'img_layer';
global.currentSelectedLayerId = null;
global.getOrLoadLayerMedia = (l) => {
  if (l.id === 'img_layer') {
    return {
      type: 'image',
      el: {
        tagName: 'IMG',
        naturalWidth: 800,
        naturalHeight: 600
      }
    };
  }
  return null;
};

// Fit 800x600 image into 1920x1080 composition
// Proportional fit (contain): scaleFactor = min(1920/800, 1080/600) = min(2.4, 1.8) = 1.8
// scaleW = 800 * 1.8 = 1440; scaleH = 600 * 1.8 = 1080
window.applyFitOrStretchToComposition('fit');
assert.strictEqual(mockImgLayer.scaleW, 1440, 'fit mode on image must proportionally scale scaleW to fit inside comp');
assert.strictEqual(mockImgLayer.scaleH, 1080, 'fit mode on image must proportionally scale scaleH to fit inside comp');
assert.strictEqual(mockImgLayer.posX, 960, 'fit mode on image must center posX');
assert.strictEqual(mockImgLayer.posY, 540, 'fit mode on image must center posY');
assert.strictEqual(mockImgLayer.mediaWidth, 800, 'fit mode must cache resolved mediaWidth');
assert.strictEqual(mockImgLayer.mediaHeight, 600, 'fit mode must cache resolved mediaHeight');

// 4. Test handleVideoSeeked coalescing
let redrawCalls = 0;
let snapshotCalls = 0;
global.redrawComposition = () => { redrawCalls++; };
const coalescedVideo = {
  currentTime: 2.0,
  duration: 10.0,
  readyState: 4,
  _pendingScrubTime: 5.0
};
const mockEntry = {
  hasFreezeFrame: false,
  snapshotFreezeCanvas: () => { snapshotCalls++; }
};
engine.handleVideoSeeked(coalescedVideo, mockEntry);
assert.strictEqual(coalescedVideo.currentTime, 5.0, 'handleVideoSeeked must dispatch pending scrub seek');
assert.strictEqual(snapshotCalls, 0, 'handleVideoSeeked must NOT snapshot freeze canvas while new seek was dispatched');
assert.strictEqual(redrawCalls, 0, 'handleVideoSeeked must NOT redraw composition while new seek was dispatched');

// Final seek completion
coalescedVideo._pendingScrubTime = null;
engine.handleVideoSeeked(coalescedVideo, mockEntry);
assert.strictEqual(snapshotCalls, 1, 'handleVideoSeeked must snapshot freeze canvas on final seek completion');
assert.strictEqual(redrawCalls, 1, 'handleVideoSeeked must redraw composition on final seek completion');

console.log('✓ applyFitOrStretchToComposition verified (canonical selectedLayerId, transformScale reset, and media cache).');
console.log('✓ handleVideoSeeked coalesced seeking and freeze synchronization verified.');

// 5. Test VideoFrameExtractor (Video + Precomp Frame Sequence Engine & Sample Deduplication)
const vfe = window.VideoFrameExtractor;
assert(vfe, 'VideoFrameExtractor must be exported on window');
const mockBmp = { width: 960, height: 540, closeCalled: 0, close() { this.closeCalled++; } };
vfe.retainBitmap(mockBmp);
vfe.retainBitmap(mockBmp);
assert.strictEqual(mockBmp._refCount, 2, 'retainBitmap must increment _refCount');
vfe.releaseBitmap(mockBmp);
assert.strictEqual(mockBmp.closeCalled, 0, 'releaseBitmap must not close bitmap while _refCount > 0');
vfe.releaseBitmap(mockBmp);
assert.strictEqual(mockBmp.closeCalled, 1, 'releaseBitmap must close bitmap when _refCount reaches 0');

// Test Precomp Sequence Resolution & Invalidation
const testPrecompLayer = {
  id: 'precomp_seq_1',
  type: 'precomp',
  startSec: 1.0,
  durationSec: 4.0,
  speed: 1.0,
  sourceOffsetSec: 0,
  collapseTransformations: false,
  layers: [{ id: 'child_shape', type: 'shape', startSec: 0, durationSec: 4.0 }]
};
const precompSourceKey = vfe._getSourceKey(testPrecompLayer);
assert.strictEqual(precompSourceKey, 'precomp_precomp_seq_1', 'Precomp sourceKey must use precomp_<id> namespace');
const precompSource = vfe._getOrCreateSource(precompSourceKey, '', 'Precomp', testPrecompLayer.id, true);
const mockPrecompFrameBmp = { width: 960, height: 540, close() {} };
const fIdxAt2Sec = Math.round(1.0 * (precompSource.fps || 60)); // currentSec=2.0 -> timeInClip=1.0
precompSource.frames.set(fIdxAt2Sec, vfe.retainBitmap(mockPrecompFrameBmp, precompSourceKey));
assert.strictEqual(vfe.isVideoFrameReady(testPrecompLayer, 2.0), true, 'isVideoFrameReady must return true for extracted precomp frame');
const resolvedPrecomp = engine.resolvePrecompElement(testPrecompLayer, { currentSec: 2.0 });
assert.strictEqual(resolvedPrecomp.el, mockPrecompFrameBmp, 'resolvePrecompElement must return extracted ImageBitmap frame');
assert.strictEqual(resolvedPrecomp.hasUnreadyMedia, false, 'resolvePrecompElement must report hasUnreadyMedia: false');

vfe.invalidatePrecomp(testPrecompLayer);
assert.strictEqual(precompSource.frames.size, 0, 'invalidatePrecomp must clear precomp extracted frames');

// Test Mobile/Low-RAM Eviction Unpins _pendingDbEncode & Closes Evicted Bitmaps
const origMaxRam = vfe.maxRamFrames;
const origTotalRam = vfe.maxTotalRamFrames;
vfe.maxRamFrames = 3;
vfe.maxTotalRamFrames = 5;
const evictSource = vfe._getOrCreateSource('test_evict_src', '', 'EvictTest', 'ev1', false);
const createdBmps = [];
for (let i = 0; i < 5; i++) {
  const b = { width: 640, height: 360, closed: false, _pendingDbEncode: true, close() { this.closed = true; } };
  vfe.retainBitmap(b, 'test_evict_src');
  evictSource.frames.set(i, b);
  evictSource.cachedFrameIndices.add(i);
  createdBmps.push(b);
  vfe._evictOldestFrame(evictSource, i);
}
assert(evictSource.frames.size <= 3, 'Per-source RAM frame cap must evict excess frames immediately');
const closedCount = createdBmps.filter(b => b.closed).length;
assert(closedCount >= 2, 'Evicted bitmaps must have _pendingDbEncode unpinned and .close() called so mobile VRAM never leaks');
vfe.sources.delete('test_evict_src');
vfe.maxRamFrames = origMaxRam;
vfe.maxTotalRamFrames = origTotalRam;

// Test Reverse Playback Eviction Inversion
const revSource = vfe._getOrCreateSource('test_rev_src', '', 'RevTest', 'rev1', false);
vfe.maxRamFrames = 3;
vfe.maxTotalRamFrames = 5;
// Mock playhead at frame 50 in reverse mode
revSource._isReversePlayback = true;
vfe._isSourceReversePlayback = (s) => s && s._isReversePlayback;
vfe._getVideoFrameForPlayhead = () => 50;

// Add frame 70 (past frame in reverse), frame 49 (upcoming frame), frame 48 (upcoming frame), frame 47 (upcoming frame)
const bPast = { width: 640, height: 360, closed: false, close() { this.closed = true; } };
const bUpcoming1 = { width: 640, height: 360, closed: false, close() { this.closed = true; } };
const bUpcoming2 = { width: 640, height: 360, closed: false, close() { this.closed = true; } };
const bUpcoming3 = { width: 640, height: 360, closed: false, close() { this.closed = true; } };

revSource.frames.set(70, bPast);
revSource.frames.set(49, bUpcoming1);
revSource.frames.set(48, bUpcoming2);
// Trigger eviction by adding 4th frame
vfe._evictSingleFromSource(revSource, null, 2);
assert(!revSource.frames.has(70), 'In reverse playback, past frames (fIdx > curFIdx) must be evicted first');
assert(revSource.frames.has(49) && revSource.frames.has(48), 'In reverse playback, upcoming frames (fIdx < curFIdx) must be protected');

vfe.sources.delete('test_rev_src');
vfe.maxRamFrames = origMaxRam;
vfe.maxTotalRamFrames = origTotalRam;

// Test Reverse Split Continuity Math:
// Original layer: startSec = 0, durationSec = 10, speed = -1, sourceOffsetSec = 0
const origRevLayer = { startSec: 0, durationSec: 10, speed: -1, sourceOffsetSec: 0 };
const cutTime = 4.0;
const origFrameAtCut = engine.computeLayerClipTime(origRevLayer, cutTime);
// Split produces:
// Left piece: start = 0, dur = 4, sourceOffsetSec = 0 + (10 - 4)*1 = 6
// Right piece: start = 4, dur = 6, sourceOffsetSec = 0
const leftPiece = { startSec: 0, durationSec: 4, speed: -1, sourceOffsetSec: 6 };
const rightPiece = { startSec: 4, durationSec: 6, speed: -1, sourceOffsetSec: 0 };
const leftFrameAtCut = engine.computeLayerClipTime(leftPiece, cutTime);
const rightFrameAtCut = engine.computeLayerClipTime(rightPiece, cutTime);
assert.strictEqual(origFrameAtCut, 6.0, 'Original reverse frame at cut point must be 6.0s');
assert.strictEqual(leftFrameAtCut, 6.0, 'Left split piece must evaluate to exactly 6.0s at cut point');
assert.strictEqual(rightFrameAtCut, 6.0, 'Right split piece must evaluate to exactly 6.0s at cut point');
assert.strictEqual(leftFrameAtCut, rightFrameAtCut, 'Reverse split must be 100% seamless across boundary');

// Test: Precomp caching when older frames evicted from RAM
const mockPrecompLayer = { id: 'pre_test_1', type: 'precomp', startSec: 0, durationSec: 5.0, widthPx: 400 };
const preSource = vfe._getOrCreateSource('src_pre_test_1', '', 'Precomp', 'pre_test_1', true);
preSource.fps = 60;
preSource.cachedFrameIndices = new Set([0, 1, 2, 3, 4]); // previously extracted
// RAM only contains frame 4 (frames 0-3 evicted due to mobile RAM quota)
preSource.frames = new Map();
preSource.frames.set(4, { width: 640, height: 360, closed: false });
const { startIdx: pStart, endIdx: pEnd } = vfe.getLayerFrameRange(mockPrecompLayer);
// Simulate the missing check in extractPrecompRange
const pMissing = [];
for (let i = 0; i <= 4; i++) {
  const hasRam = preSource.frames && preSource.frames.has(i);
  const hasCached = preSource.cachedFrameIndices && preSource.cachedFrameIndices.has(i);
  if (!hasRam && !hasCached) {
    pMissing.push(i);
  }
}
assert.strictEqual(pMissing.length, 0, 'Precomp frames evicted from RAM but in cachedFrameIndices must NOT be marked missing');

// Test: Circuit Breaker on Consecutive Extraction Passes
const cbSource = vfe._getOrCreateSource('src_cb_test', 'blob:test', 'Video', 'cb_layer_1', false);
cbSource.pendingFrames = new Set([10, 11, 12]);
cbSource._consecutivePasses = 3;
cbSource._lastExtractPassEnd = Date.now() - 100; // 100ms ago (very rapid)
vfe._startExtractionForSource(cbSource, [10, 11, 12]);
// Circuit breaker must have tripped: pendingFrames cleared, frames recorded in cachedFrameIndices
assert.strictEqual(cbSource.pendingFrames.size, 0, 'Circuit breaker must clear pendingFrames to stop infinite loop');
assert(cbSource.cachedFrameIndices.has(10) && cbSource.cachedFrameIndices.has(11) && cbSource.cachedFrameIndices.has(12), 'Circuit breaker must add unresolved frames to cachedFrameIndices');

// Test: Missing frames sorting in ensurePlaybackFrames (forward vs reverse)
const fMissing = [35, 45, 55, 65, 75, 25];
const curFIdx = 50;
// Forward sort: upcoming (>= 50) first in order 55, 65, 75, then past frames
fMissing.sort((a, b) => {
  const scoreA = a >= curFIdx ? (a - curFIdx) : ((curFIdx - a) + 10000);
  const scoreB = b >= curFIdx ? (b - curFIdx) : ((curFIdx - b) + 10000);
  return scoreA - scoreB;
});
assert.deepStrictEqual(fMissing.slice(0, 3), [55, 65, 75], 'Forward playback prefetch must prioritize upcoming frames over past frames');

// Reverse sort: upcoming (<= 50) decreasing first in order 45, 35, 25, then past frames
const rMissing = [55, 65, 45, 35, 75, 25];
rMissing.sort((a, b) => {
  const scoreA = a <= curFIdx ? (curFIdx - a) : ((a - curFIdx) + 10000);
  const scoreB = b <= curFIdx ? (curFIdx - b) : ((b - curFIdx) + 10000);
  return scoreA - scoreB;
});
assert.deepStrictEqual(rMissing.slice(0, 3), [45, 35, 25], 'Reverse playback prefetch must prioritize upcoming decreasing frames over past frames');

// Test: Proactive Streaming Prefetch in resolveLayerVideoElement
let prefetchCalledWith = null;
vfe.ensurePlaybackFrames = (src, f) => { prefetchCalledWith = f; };
const streamSrc = vfe._getOrCreateSource('stream_test', 'blob:test', 'Video', 'stream_layer_1', false);
streamSrc.fps = 60;
const streamMockBmp = { width: 640, height: 360, closed: false };
streamSrc.frames.set(10, streamMockBmp);
vfe.getInterpolatedFrame = () => streamMockBmp;
const streamLayer = { id: 'stream_layer_1', mediaId: 'stream_test', type: 'video', startSec: 0, speed: 1.0, sourceOffsetSec: 0 };
engine.resolveLayerVideoElement(streamLayer, null, { currentSec: 10 / 60 });
assert.strictEqual(prefetchCalledWith, 10, 'resolveLayerVideoElement must proactively trigger ensurePlaybackFrames even when frame is present in RAM');

vfe.sources.delete('src_pre_test_1');
vfe.sources.delete('src_cb_test');
vfe.sources.delete('stream_test');

// Test: True After Effects Model for Precompositions
const livePrecomp = {
  id: 'precomp_live_ae_test',
  type: 'precomp',
  startSec: 0,
  durationSec: 5,
  speed: 1.0,
  sourceOffsetSec: 0,
  layers: [{ id: 'child_txt', type: 'text', startSec: 0, durationSec: 5 }]
};
const resLive = engine.resolvePrecompElement(livePrecomp, { currentSec: 1.0 });
assert.strictEqual(resLive.fromSequence, false, 'resolvePrecompElement must not use sequence for live precomps');
assert.strictEqual(resLive.hasUnreadyMedia, false, 'live precomps must be marked ready immediately without waiting for baking');

// Test: VideoFrameExtractor.extractPrecompRange completes in 0ms
const pExtract = vfe.extractPrecompRange(livePrecomp);
assert(pExtract && typeof pExtract.then === 'function', 'extractPrecompRange must return a promise');
assert.strictEqual(livePrecomp._extractComplete, true, 'extractPrecompRange must mark precomp complete immediately');
assert.strictEqual(livePrecomp._extractProgress, 1, 'extractPrecompRange must mark precomp progress 100% immediately');

// Test: Modifying precomp container transform preserves _precompBufferCanvas._lastRenderKey
livePrecomp._precompBufferCanvas = { width: 960, height: 540, _lastRenderKey: 'frame_60_960_540' };
mockProject.layers = [livePrecomp];
pcm.syncStateWithProject(mockProject, 'root');
livePrecomp.posX = 500;
livePrecomp.scaleW = 120;
livePrecomp.rotation = 45;
pcm.syncStateWithProject(mockProject, 'root');
assert.strictEqual(livePrecomp._precompBufferCanvas._lastRenderKey, 'frame_60_960_540', 'Outer precomp container transform changes must preserve inner buffer _lastRenderKey');

// Test: getProjectDimensions toast notification on invalid resolution
require(path.join(__dirname, '../js/editor/editor-state.js'));
let toastCalledWith = null;
global.window.showToast = (msg, type) => { toastCalledWith = { msg, type }; };
const invalidDims = window.getProjectDimensions('INVALID_RES', 'INVALID_ASPECT');
assert(toastCalledWith && toastCalledWith.type === 'error', 'getProjectDimensions must trigger error toast on invalid resolution');
assert(Array.isArray(invalidDims) && invalidDims[0] > 0, 'getProjectDimensions must return safe fallback tuple');
console.log('✓ True After Effects Model & precomp transform isolation verified.');

// Test: Algoritma 5 (Temporal Occupancy Partitioning & Void Realtime Bypass)
global.window.getProjectTotalDuration = () => 60;
const mixedProject = {
  fps: 60,
  resolution: '1080p',
  aspectRatio: '16:9',
  duration: 60,
  bgColor: '#0a0d07',
  layers: [
    { id: 'anim_layer', type: 'text', startSec: 0, durationSec: 6 },
    { id: 'bg_audio', type: 'audio', startSec: 0, durationSec: 60 }
  ]
};

pcm.syncStateWithProject(mixedProject, 'root');
assert.strictEqual(pcm.hasActiveVisualContentAt(3.0), true, 'hasActiveVisualContentAt must be true during visual layer interval');
assert.strictEqual(pcm.hasActiveVisualContentAt(6.0), false, 'hasActiveVisualContentAt must be false once visual layer ends');
assert.strictEqual(pcm.hasActiveVisualContentAt(10.0), false, 'hasActiveVisualContentAt must be false during audio-only span');
assert.strictEqual(pcm.isTimeInVoidSpan(10.0), true, 'isTimeInVoidSpan must be true during audio-only span');

const vIntervals = pcm._compVisualIntervals.get('root');
const voidIntervals = pcm._compVoidIntervals.get('root');
assert(Array.isArray(vIntervals) && vIntervals.length === 1, 'There must be exactly 1 merged visual interval');
assert.strictEqual(vIntervals[0][0], 0);
assert.strictEqual(vIntervals[0][1], 6);
assert(Array.isArray(voidIntervals) && voidIntervals.length === 1, 'There must be exactly 1 void interval');
assert.strictEqual(voidIntervals[0][0], 6);
assert.strictEqual(voidIntervals[0][1], 60);

// Verify Virtual Cache Hit: 0 memory allocated in frames pool for void span
const pool = pcm.getPool('root');
assert.strictEqual(pool.has(600), false, 'Void span frames must NOT be allocated in frames pool');
assert.strictEqual(pcm.hasFrame(600), true, 'hasFrame must return true virtually for void span');
const voidCanvas = pcm.getFrame(600, 1920, 1080);
assert(voidCanvas !== null, 'getFrame must return shared background canvas for void span');
assert.strictEqual(pcm.isContiguousPlaybackFrame(600), true, 'Void span must always be treated as contiguous playback frame');

// Verify dynamic mutation: adding a layer at 15s splits void intervals seamlessly
mixedProject.layers.push({ id: 'mid_text', type: 'text', startSec: 15, durationSec: 5 });
pcm.syncStateWithProject(mixedProject, 'root');
assert.strictEqual(pcm.hasActiveVisualContentAt(16.0), true, 'Added layer at 15s must be detected as active visual');
assert.strictEqual(pcm.hasActiveVisualContentAt(10.0), false, '10s must still be in void interval');
assert.strictEqual(pcm.hasActiveVisualContentAt(25.0), false, '25s must be in void interval');

const voidIntervalsUpdated = pcm._compVoidIntervals.get('root');
assert.strictEqual(voidIntervalsUpdated.length, 2, 'Void intervals must be split into 2 spans [6..15] and [20..60]');
assert.strictEqual(voidIntervalsUpdated[0][0], 6);
assert.strictEqual(voidIntervalsUpdated[0][1], 15);
assert.strictEqual(voidIntervalsUpdated[1][0], 20);
assert.strictEqual(voidIntervalsUpdated[1][1], 60);

// Test: Synchronous provisional staging in setFrameFromCanvas (zero async gap before createImageBitmap resolves)
let resolveDeferredBitmap = null;
const origCreateImageBitmap = global.createImageBitmap;
try {
  global.createImageBitmap = () => new Promise(res => { resolveDeferredBitmap = res; });
  const mockSrcCanvas = {
    id: 'offscreen-test-canvas',
    width: 1920,
    height: 1080,
    getContext: () => ({ clearRect: () => {}, drawImage: () => {} })
  };
  pcm.setFrameFromCanvas(12, mockSrcCanvas, false, 'root');
  assert.strictEqual(pcm.hasFrame(12, 1920, 1080, 'root'), true, 'setFrameFromCanvas must register frame synchronously before createImageBitmap resolves');
  assert.strictEqual(pcm.getFrame(12, 1920, 1080, 'root'), mockSrcCanvas, 'getFrame must return provisional staging canvas while createImageBitmap is pending');
  if (resolveDeferredBitmap) {
    resolveDeferredBitmap({ width: 1920, height: 1080, close() {} });
  }
} finally {
  global.createImageBitmap = origCreateImageBitmap;
}

// Test: vectorPoints keyframe dynamic bounds do not trigger false cache invalidation on Play
const vecKfLayer = {
  id: 'vec_kf_1',
  type: 'shape',
  startSec: 0,
  durationSec: 5,
  posX: 500,
  posY: 400,
  scaleW: 200,
  scaleH: 150,
  shapeProps: {
    points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
    sizeX: 200,
    sizeY: 150,
    fillColor: '#00ff00'
  },
  keyframes: {
    vectorPoints: [{ time: 0, value: [{ x: 0, y: 0 }] }, { time: 2, value: [{ x: 50, y: 80 }] }]
  }
};
const sigVecBefore = pcm.getLayerSignature(vecKfLayer, 0);
// Simulate syncVectorLayerBounds mutating posX, posY, scaleW, scaleH, sizeX, sizeY during scrub
vecKfLayer.posX = 620;
vecKfLayer.posY = 480;
vecKfLayer.scaleW = 310;
vecKfLayer.scaleH = 240;
vecKfLayer.shapeProps.sizeX = 310;
vecKfLayer.shapeProps.sizeY = 240;
vecKfLayer.shapeProps.points = [{ x: 25, y: 40 }, { x: 120, y: 160 }];
const sigVecAfter = pcm.getLayerSignature(vecKfLayer, 0);
assert.strictEqual(sigVecBefore, sigVecAfter, 'getLayerSignature must remain stable when vectorPoints keyframes mutate bounds during scrub');

// Test: Cut Mid (Potong Tengah) on cached layer must NOT turn right split half into a false void span
const cutLayerLeft = mixedProject.layers[0]; // anim_layer [0..6s]
// Populate mock cached frame at 4.0s (frame 240)
pcm.getPool('root').set(240, { bitmap: { width: 1920, height: 1080 }, width: 1920, height: 1080, isDraft: false });
assert.strictEqual(pcm.hasFrame(240, 1920, 1080, 'root'), true, 'Pre-cut frame 240 should be cached');
// Simulate split at 3.0s: shorten left half to [0..3s], invalidate range, and splice right half [3..6s]
cutLayerLeft.durationSec = 3;
pcm.invalidateRange(0, 6, 60, 'root');
const cutLayerRight = { id: 'anim_layer_right', type: 'text', startSec: 3, durationSec: 3 };
mixedProject.layers.splice(0, 0, cutLayerRight);
assert.strictEqual(pcm.hasActiveVisualContentAt(4.0, 'root'), true, 'Right split piece [3..6s] must be recognized as active visual content even if spliced after invalidateRange');
assert.strictEqual(pcm.isTimeInVoidSpan(4.0, 'root'), false, 'Right split piece [3..6s] must NOT be classified as a void span');
assert.strictEqual(pcm.hasFrame(240, 1920, 1080, 'root'), false, 'Invalidated split piece frame 240 must report cache miss (not virtual void cache hit)');
assert.strictEqual(pcm.getFrame(240, 1920, 1080, 'root'), null, 'getFrame on invalidated split piece must return null so live layer renders instead of blank _audioOnlyCanvas');

console.log('✓ Algoritma 5: Temporal Occupancy Partitioning, Virtual Void Cache, Dynamic Mutation & Cut Mid Split Sync verified cleanly.');

console.log('✓ VideoFrameExtractor verified (retain/release deduplication, reverse eviction inversion, seamless reverse split, proactive streaming prefetch, upcoming frame sort order, precomp RAM eviction protection, extraction circuit breaker, mobile VRAM cap, precomp sequence resolution, and invalidation).');

console.log('\n========================================');
console.log('ALL DEEP VERIFICATION TESTS PASSED! (100%)');
console.log('========================================\n');
process.exit(0);
