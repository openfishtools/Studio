const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('--- Deep Verification: VideoCompEngine, PreviewCacheManager & Composition Operations ---');

// Set up mock browser environment
global.window = global;
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.document = {
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
console.log('✓ computeLayerClipTime verified under all parameter signatures and modes.');

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
// scaleFactor = max(1920/800, 1080/600) = max(2.4, 1.8) = 2.4
// scaleW = 800 * 2.4 = 1920; scaleH = 600 * 2.4 = 1440
window.applyFitOrStretchToComposition('fit');
assert.strictEqual(mockImgLayer.scaleW, 1920, 'fit mode on image must proportionally scale scaleW to fill');
assert.strictEqual(mockImgLayer.scaleH, 1440, 'fit mode on image must proportionally scale scaleH to fill');
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
console.log('✓ VideoFrameExtractor verified (retain/release deduplication, precomp sequence resolution, and invalidation).');

console.log('\n========================================');
console.log('ALL DEEP VERIFICATION TESTS PASSED! (100%)');
console.log('========================================\n');
