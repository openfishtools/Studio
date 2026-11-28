/**
 * FishTool Studio - WebCodecs Video Decoder Worker
 * High-performance background ISOBMFF (MP4/MOV) demuxer & continuous hardware video streamer.
 *
 * Key invariants for zero-freeze 60fps real-time playback:
 * 1. Persistent output pipeline: VideoDecoder.output NEVER drops frames between batches
 *    (only drops pre-seek reference frames when ptsSec < _dropBeforePts).
 * 2. Persistent continuous cursor (_cursorIdx): forward playback feeds small 30-frame batches
 *    into the already-warm hardware decoder with ZERO decoder.reset() and ZERO decoder.flush() stalls.
 * 3. Generation counter (_streamGen): stale async createImageBitmap callbacks from a cancelled
 *    random seek are cleanly closed and never pollute the new seek window.
 * 4. Immediate hardware VideoFrame.close() inside output callback prevents Chromium DPB deadlocks.
 * 5. Auto-Proxy (>1080p desktop / >720p mobile) for preview; full-res decode when isExport === true.
 */

'use strict';

const streams = new Map();

/**
 * Minimalist Fast MP4 / MOV (ISOBMFF) Box Parser
 */
class MP4Demuxer {
  constructor(arrayBuffer) {
    this.buffer = arrayBuffer;
    this.view = new DataView(arrayBuffer);
    this.tracks = [];
    this.videoTrack = null;
    this._parse();
  }

  _parse() {
    let offset = 0;
    const len = this.buffer.byteLength;

    while (offset + 8 <= len) {
      const size = this.view.getUint32(offset);
      const type = this._readString(offset + 4, 4);
      const boxSize = size === 1 ? Number(this.view.getBigUint64(offset + 8)) : (size === 0 ? len - offset : size);
      const headerSize = size === 1 ? 16 : 8;

      if (type === 'moov') {
        this._parseMoov(offset + headerSize, offset + boxSize);
        break;
      }

      if (boxSize <= 0) break;
      offset += boxSize;
    }
  }

  _parseMoov(start, end) {
    let offset = start;
    while (offset + 8 <= end) {
      const size = this.view.getUint32(offset);
      const type = this._readString(offset + 4, 4);
      const boxSize = size === 1 ? Number(this.view.getBigUint64(offset + 8)) : size;
      const headerSize = size === 1 ? 16 : 8;

      if (type === 'trak') {
        const track = this._parseTrak(offset + headerSize, offset + boxSize);
        if (track && track.isVideo) {
          this.videoTrack = track;
          this.tracks.push(track);
        }
      }

      if (boxSize <= 0) break;
      offset += boxSize;
    }
  }

  _parseTrak(start, end) {
    let offset = start;
    let isVideo = false;
    let mdiaStart = 0, mdiaEnd = 0;

    while (offset + 8 <= end) {
      const size = this.view.getUint32(offset);
      const type = this._readString(offset + 4, 4);
      const boxSize = size === 1 ? Number(this.view.getBigUint64(offset + 8)) : size;
      const headerSize = size === 1 ? 16 : 8;

      if (type === 'mdia') {
        mdiaStart = offset + headerSize;
        mdiaEnd = offset + boxSize;
      }

      if (boxSize <= 0) break;
      offset += boxSize;
    }

    if (!mdiaStart) return null;

    offset = mdiaStart;
    let timescale = 1000;
    let stblStart = 0, stblEnd = 0;

    while (offset + 8 <= mdiaEnd) {
      const size = this.view.getUint32(offset);
      const type = this._readString(offset + 4, 4);
      const boxSize = size === 1 ? Number(this.view.getBigUint64(offset + 8)) : size;
      const headerSize = size === 1 ? 16 : 8;

      if (type === 'mdhd') {
        const version = this.view.getUint8(offset + headerSize);
        timescale = version === 1
          ? this.view.getUint32(offset + headerSize + 20)
          : this.view.getUint32(offset + headerSize + 12);
      } else if (type === 'hdlr') {
        const handlerType = this._readString(offset + headerSize + 8, 4);
        if (handlerType === 'vide') isVideo = true;
      } else if (type === 'minf') {
        const minfBoxes = this._findSubBoxes(offset + headerSize, offset + boxSize);
        const stblBox = minfBoxes.find(b => b.type === 'stbl');
        if (stblBox) {
          stblStart = stblBox.start;
          stblEnd = stblBox.end;
        }
      }

      if (boxSize <= 0) break;
      offset += boxSize;
    }

    if (!isVideo || !stblStart) return null;

    return this._parseStbl(stblStart, stblEnd, timescale);
  }

  _parseStbl(start, end, timescale) {
    const boxes = this._findSubBoxes(start, end);
    let codec = 'avc1.4d401f';
    let width = 1920, height = 1080;
    let description = null;
    const sampleDurations = [];
    const compositionOffsets = [];
    let hasCtts = false;
    let keyframeIndexes = null;
    const sampleSizes = [];
    const chunkOffsets = [];
    const sampleToChunk = [];

    for (const box of boxes) {
      const p = box.start;
      if (box.type === 'stsd') {
        const entryCount = this.view.getUint32(p + 4);
        if (entryCount > 0) {
          const entryStart = p + 8;
          const entrySize = this.view.getUint32(entryStart);
          const format = this._readString(entryStart + 4, 4);
          const parsedW = this.view.getUint16(entryStart + 32);
          const parsedH = this.view.getUint16(entryStart + 34);
          if (parsedW > 0) width = parsedW;
          if (parsedH > 0) height = parsedH;

          const subBoxStart = entryStart + 86;
          const subBoxEnd = Math.min(box.end, entryStart + entrySize);
          if (subBoxStart + 8 <= subBoxEnd) {
            const subBoxes = this._findSubBoxes(subBoxStart, subBoxEnd);
            const codecBox = subBoxes.find(b => b.type === 'avcC' || b.type === 'hvcC' || b.type === 'vpcC' || b.type === 'av1C');
            if (codecBox) {
              description = new Uint8Array(this.buffer.slice(codecBox.start, codecBox.end));
              if (codecBox.type === 'avcC' && (codecBox.end - codecBox.start) >= 4) {
                const profile = this.view.getUint8(codecBox.start + 1).toString(16).padStart(2, '0');
                const compat = this.view.getUint8(codecBox.start + 2).toString(16).padStart(2, '0');
                const level = this.view.getUint8(codecBox.start + 3).toString(16).padStart(2, '0');
                codec = `avc1.${profile}${compat}${level}`;
              } else if (codecBox.type === 'hvcC') {
                codec = format === 'hev1' ? 'hev1.1.6.L93.B0' : 'hvc1.1.6.L93.B0';
              } else if (codecBox.type === 'vpcC') {
                codec = 'vp09.00.10.08';
              } else if (codecBox.type === 'av1C') {
                codec = 'av01.0.04M.08';
              }
            }
          }
        }
      } else if (box.type === 'stts') {
        const count = this.view.getUint32(p + 4);
        let ptr = p + 8;
        for (let i = 0; i < count && ptr + 8 <= box.end; i++) {
          const sCount = this.view.getUint32(ptr);
          const sDelta = this.view.getUint32(ptr + 4);
          ptr += 8;
          for (let j = 0; j < sCount; j++) {
            sampleDurations.push(sDelta);
          }
        }
      } else if (box.type === 'ctts') {
        hasCtts = true;
        const version = this.view.getUint8(p);
        const count = this.view.getUint32(p + 4);
        let ptr = p + 8;
        for (let i = 0; i < count && ptr + 8 <= box.end; i++) {
          const sCount = this.view.getUint32(ptr);
          const sOffset = version === 1 ? this.view.getInt32(ptr + 4) : this.view.getUint32(ptr + 4);
          ptr += 8;
          for (let j = 0; j < sCount; j++) {
            compositionOffsets.push(sOffset);
          }
        }
      } else if (box.type === 'stss') {
        const count = this.view.getUint32(p + 4);
        keyframeIndexes = new Set();
        let ptr = p + 8;
        for (let i = 0; i < count && ptr + 4 <= box.end; i++) {
          keyframeIndexes.add(this.view.getUint32(ptr) - 1);
          ptr += 4;
        }
      } else if (box.type === 'stsz') {
        const uniformSize = this.view.getUint32(p + 4);
        const count = this.view.getUint32(p + 8);
        let ptr = p + 12;
        for (let i = 0; i < count; i++) {
          sampleSizes.push(uniformSize || (ptr + 4 <= box.end ? this.view.getUint32(ptr) : 0));
          if (!uniformSize) ptr += 4;
        }
      } else if (box.type === 'stsc') {
        const count = this.view.getUint32(p + 4);
        let ptr = p + 8;
        for (let i = 0; i < count && ptr + 12 <= box.end; i++) {
          sampleToChunk.push({
            firstChunk: this.view.getUint32(ptr),
            samplesPerChunk: this.view.getUint32(ptr + 4),
            sampleDescIdx: this.view.getUint32(ptr + 8)
          });
          ptr += 12;
        }
      } else if (box.type === 'stco') {
        const count = this.view.getUint32(p + 4);
        let ptr = p + 8;
        for (let i = 0; i < count && ptr + 4 <= box.end; i++) {
          chunkOffsets.push(this.view.getUint32(ptr));
          ptr += 4;
        }
      } else if (box.type === 'co64') {
        const count = this.view.getUint32(p + 4);
        let ptr = p + 8;
        for (let i = 0; i < count && ptr + 8 <= box.end; i++) {
          chunkOffsets.push(Number(this.view.getBigUint64(ptr)));
          ptr += 8;
        }
      }
    }

    const samples = [];
    let curDts = 0;
    let minCts = Infinity;
    const rawCtsList = new Float64Array(sampleSizes.length);

    for (let i = 0; i < sampleSizes.length; i++) {
      const dur = sampleDurations[i] !== undefined ? sampleDurations[i] : (sampleDurations[0] || 1);
      const ctsOffset = hasCtts && compositionOffsets[i] !== undefined ? compositionOffsets[i] : 0;
      const cts = curDts + ctsOffset;
      rawCtsList[i] = cts;
      if (cts < minCts) minCts = cts;
      curDts += dur;
    }
    if (!isFinite(minCts)) minCts = 0;

    let chunkIdx = 0;
    let sampleInChunk = 0;
    let curChunkOffset = chunkOffsets[0] || 0;
    let stscIdx = 0;
    curDts = 0;

    for (let i = 0; i < sampleSizes.length; i++) {
      const isKey = keyframeIndexes ? keyframeIndexes.has(i) : (i === 0);
      const size = sampleSizes[i];
      const dur = sampleDurations[i] !== undefined ? sampleDurations[i] : (sampleDurations[0] || 1);
      const ptsSec = Math.max(0, (rawCtsList[i] - minCts) / timescale);
      const dtsSec = curDts / timescale;

      while (stscIdx + 1 < sampleToChunk.length && (chunkIdx + 1) >= sampleToChunk[stscIdx + 1].firstChunk) {
        stscIdx++;
      }
      const samplesPerChunk = sampleToChunk[stscIdx] ? sampleToChunk[stscIdx].samplesPerChunk : 1;

      samples.push({
        index: i,
        offset: curChunkOffset,
        size: size,
        pts: ptsSec,
        dts: dtsSec,
        duration: dur / timescale,
        isKey: isKey
      });

      curChunkOffset += size;
      sampleInChunk++;
      if (sampleInChunk >= samplesPerChunk) {
        chunkIdx++;
        sampleInChunk = 0;
        curChunkOffset = chunkOffsets[chunkIdx] || 0;
      }
      curDts += dur;
    }

    const totalDurationSec = timescale > 0 ? (curDts / timescale) : 0;
    const avgFrameDur = samples.length > 0 && totalDurationSec > 0 ? (totalDurationSec / samples.length) : (1 / 30);
    const fps = avgFrameDur > 0 ? Math.max(1, Math.min(240, Math.round((1 / avgFrameDur) * 100) / 100)) : 30;

    const gops = [];
    let currentGop = null;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (!currentGop || s.isKey) {
        currentGop = {
          index: gops.length,
          keyIdx: i,
          endIdx: i,
          startPts: s.pts,
          endPts: s.pts + s.duration
        };
        gops.push(currentGop);
      } else {
        currentGop.endIdx = i;
        if (s.pts < currentGop.startPts) currentGop.startPts = s.pts;
        const sEnd = s.pts + s.duration;
        if (sEnd > currentGop.endPts) currentGop.endPts = sEnd;
      }
    }

    return {
      isVideo: true,
      codec: codec,
      width: width,
      height: height,
      description: description,
      timescale: timescale,
      duration: totalDurationSec,
      fps: fps,
      avgFrameDur: avgFrameDur,
      samples: samples,
      gops: gops
    };
  }

  _findSubBoxes(start, end) {
    const boxes = [];
    let offset = start;
    while (offset + 8 <= end) {
      const size = this.view.getUint32(offset);
      const type = this._readString(offset + 4, 4);
      const boxSize = size === 1 ? Number(this.view.getBigUint64(offset + 8)) : size;
      const headerSize = size === 1 ? 16 : 8;

      if (boxSize <= 0) break;
      boxes.push({ type, start: offset + headerSize, end: offset + boxSize });
      offset += boxSize;
    }
    return boxes;
  }

  _readString(offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
      str += String.fromCharCode(this.view.getUint8(offset + i));
    }
    return str;
  }
}

function _computeProxyDims(srcW, srcH, maxW, maxH) {
  if (!srcW || !srcH || !maxW || !maxH) return null;
  if (srcW <= maxW && srcH <= maxH) return null;
  const scale = Math.min(maxW / srcW, maxH / srcH);
  const w = Math.max(2, Math.round((srcW * scale) / 2) * 2);
  const h = Math.max(2, Math.round((srcH * scale) / 2) * 2);
  return { width: w, height: h };
}

/**
 * Worker Video Stream Controller (Persistent Output Pipeline + Continuous Cursor)
 */
class VideoStream {
  constructor(mediaId, arrayBuffer) {
    this.mediaId = mediaId;
    this.buffer = arrayBuffer;
    this.demuxer = new MP4Demuxer(arrayBuffer);
    this.track = this.demuxer.videoTrack;
    this.decoder = null;
    this.config = null;
    this._destroyed = false;

    // Persistent continuous streaming state (never drops frames between batches!)
    this._cursorIdx = -1;
    this._streamGen = 0;
    this._proxyDims = null;
    this._proxyKey = 'full';
    this._dropBeforePts = -1;
    this._outQueue = [];
    this._outFlushTimer = null;

    // Dedicated random-access decoder for seek() (export + AI background removal).
    // Fully independent from the playback streaming decoder, so sequential extraction never
    // resets / pollutes the playback pipeline, and sequential access is O(n) (no per-frame GOP re-decode).
    this._seekDecoder = null;
    this._seekConfig = null;
    this._seekCursorIdx = -1;
    this._seekGen = 0;
    this._seekProxyDims = null;
    this._seekProxyKey = 'full';
    this._seekStash = new Map();
    this._seekPending = new Set();

    // Serialized command chain
    this._jobChain = Promise.resolve();

    if (this.track && this.track.samples.length > 0) {
      this._initDecoder();
    }
  }

  _initDecoder() {
    if (typeof VideoDecoder === 'undefined' || !this.track) {
      return;
    }

    this.config = {
      codec: this.track.codec,
      codedWidth: this.track.width,
      codedHeight: this.track.height,
      optimizeForLatency: true
    };

    if (this.track.description) {
      this.config.description = this.track.description;
    }

    this.decoder = new VideoDecoder({
      output: (videoFrame) => this._onVideoFrame(videoFrame),
      error: (err) => {
        console.warn(`[WebCodecs] Decoder error on media ${this.mediaId}:`, err);
        this._cursorIdx = -1;
      }
    });

    try {
      this.decoder.configure(this.config);
    } catch (err) {
      delete this.config.description;
      try { this.decoder.configure(this.config); } catch (_) {}
    }
    this._cursorIdx = -1;
  }

  _resetDecoder() {
    this._streamGen++;
    this._clearOutQueue();
    if (!this.decoder || this.decoder.state === 'closed') {
      this._initDecoder();
      return !!this.decoder;
    }
    try {
      if (this.decoder.state === 'configured') {
        this.decoder.reset();
      }
      this.decoder.configure(this.config);
    } catch (_) {
      try { this.decoder.close(); } catch (__) {}
      this.decoder = null;
      this._initDecoder();
    }
    this._cursorIdx = -1;
    return !!this.decoder && this.decoder.state === 'configured';
  }

  _clearOutQueue() {
    if (this._outFlushTimer) {
      clearTimeout(this._outFlushTimer);
      this._outFlushTimer = null;
    }
    for (let i = 0; i < this._outQueue.length; i++) {
      try { this._outQueue[i].bitmap.close(); } catch (_) {}
    }
    this._outQueue.length = 0;
  }

  _flushOutQueue(done, requestId) {
    if (this._outFlushTimer) {
      clearTimeout(this._outFlushTimer);
      this._outFlushTimer = null;
    }
    const batch = this._outQueue.splice(0, this._outQueue.length);
    if (batch.length === 0 && !done) return;

    const transferList = [];
    for (let i = 0; i < batch.length; i++) {
      if (batch[i] && batch[i].bitmap) transferList.push(batch[i].bitmap);
    }

    const samples = this.track ? this.track.samples : null;
    const cursorPts = (this._cursorIdx >= 0 && samples && samples[this._cursorIdx])
      ? samples[this._cursorIdx].pts
      : -1;

    self.postMessage({
      type: 'frames_batch',
      id: requestId || 0,
      mediaId: this.mediaId,
      isProxy: !!this._proxyDims,
      done: !!done,
      cursorPts: cursorPts,
      frames: batch
    }, transferList);
  }

  _scheduleOutFlush() {
    if (this._outFlushTimer || this._destroyed) return;
    this._outFlushTimer = setTimeout(() => {
      this._outFlushTimer = null;
      if (!this._destroyed && this._outQueue.length > 0) {
        this._flushOutQueue(false, 0);
      }
    }, 4);
  }

  _onVideoFrame(videoFrame) {
    if (this._destroyed) {
      try { videoFrame.close(); } catch (_) {}
      return;
    }

    const ptsSec = (videoFrame.timestamp || 0) / 1000000;

    // Persistent continuous stream output (NEVER drops frames between batches!)
    if (this._dropBeforePts >= 0 && ptsSec < this._dropBeforePts) {
      try { videoFrame.close(); } catch (_) {}
      return;
    }

    const gen = this._streamGen;
    const resizeOpts = this._proxyDims
      ? { resizeWidth: this._proxyDims.width, resizeHeight: this._proxyDims.height, resizeQuality: 'medium' }
      : undefined;

    (resizeOpts ? createImageBitmap(videoFrame, resizeOpts) : createImageBitmap(videoFrame))
      .then((bitmap) => {
        if (this._destroyed || gen !== this._streamGen) {
          try { bitmap.close(); } catch (_) {}
          return;
        }
        this._outQueue.push({ pts: ptsSec, bitmap: bitmap });
        if (this._outQueue.length >= 6) {
          this._flushOutQueue(false, 0);
        } else {
          this._scheduleOutFlush();
        }
      })
      .catch(() => {})
      .finally(() => {
        try { videoFrame.close(); } catch (_) {}
      });
  }

  findGopIndex(targetSec) {
    const gops = this.track ? this.track.gops : null;
    if (!gops || gops.length === 0) return -1;
    if (targetSec <= gops[0].startPts) return 0;
    const last = gops.length - 1;
    if (targetSec >= gops[last].startPts) return last;

    let lo = 0;
    let hi = last;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (gops[mid].startPts <= targetSec) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  _findSampleIndexNear(targetSec) {
    const samples = this.track.samples;
    if (!samples.length) return 0;
    const gopIdx = this.findGopIndex(targetSec);
    const gop = this.track.gops[Math.max(0, gopIdx)];
    let bestIdx = gop.keyIdx;
    let bestDiff = Math.abs(samples[gop.keyIdx].pts - targetSec);
    for (let i = gop.keyIdx; i <= gop.endIdx; i++) {
      const diff = Math.abs(samples[i].pts - targetSec);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /**
   * Continuous progressive stream decode.
   * When `continue` is possible (decoder already warm and ahead/near target), feeds the next
   * `count` chunks directly with ZERO reset and ZERO flush stall!
   */
  streamAhead(requestId, options = {}) {
    const run = async () => {
      if (this._destroyed || !this.track || !this.track.samples.length) {
        self.postMessage({ type: 'frames_batch', id: requestId, mediaId: this.mediaId, isProxy: false, done: true, cursorPts: 0, frames: [] });
        return;
      }

      const samples = this.track.samples;
      const targetSec = Math.max(0, Number(options.targetSec) || 0);
      const count = Math.max(12, Math.min(64, Number(options.count) || 30));
      const isExport = !!options.isExport;
      const maxW = options.maxW || 1920;
      const maxH = options.maxH || 1080;
      const proxyDims = isExport ? null : _computeProxyDims(this.track.width, this.track.height, maxW, maxH);
      const proxyKey = proxyDims ? `${proxyDims.width}x${proxyDims.height}` : 'full';

      const targetIdx = this._findSampleIndexNear(targetSec);
      const gopIdx = this.findGopIndex(targetSec);
      const gop = this.track.gops[Math.max(0, gopIdx)];

      // Continue warm decoder whenever:
      // - Decoder is configured and proxy dimensions match
      // - Either caller explicitly asked to continue forward, OR targetIdx is within [-24 .. +120]
      //   of the current warm cursor AND doesn't skip past a newer keyframe.
      const canContinue = (
        this.decoder &&
        this.decoder.state === 'configured' &&
        this._cursorIdx >= 0 &&
        this._proxyKey === proxyKey &&
        (
          options.mode === 'continue' ||
          (targetIdx >= this._cursorIdx - 24 && targetIdx <= this._cursorIdx + 120 && !(gop.keyIdx > this._cursorIdx + 16))
        )
      );

      let feedStartIdx;
      let feedEndIdx;
      let needFlush = false;

      if (canContinue) {
        this._dropBeforePts = -1;
        feedStartIdx = this._cursorIdx + 1;
        feedEndIdx = Math.min(samples.length - 1, Math.max(targetIdx + count, feedStartIdx + count - 1));
        needFlush = (feedEndIdx >= samples.length - 1);
      } else {
        if (!this._resetDecoder()) {
          self.postMessage({ type: 'frames_batch', id: requestId, mediaId: this.mediaId, isProxy: !!proxyDims, done: true, cursorPts: 0, frames: [] });
          return;
        }
        this._proxyDims = proxyDims;
        this._proxyKey = proxyKey;
        feedStartIdx = gop.keyIdx;
        feedEndIdx = Math.min(samples.length - 1, targetIdx + count);
        // Drop pre-seek reference frames in hardware (0.02ms) if keyframe is far before target
        this._dropBeforePts = (targetIdx - gop.keyIdx > 12) ? Math.max(0, targetSec - 0.12) : -1;
        needFlush = (feedEndIdx >= samples.length - 1);
      }

      if (feedStartIdx > feedEndIdx) {
        this._flushOutQueue(true, requestId);
        return;
      }

      try {
        for (let i = feedStartIdx; i <= feedEndIdx; i++) {
          const s = samples[i];
          const chunkData = new Uint8Array(this.buffer, s.offset, s.size);
          const chunk = new EncodedVideoChunk({
            type: s.isKey ? 'key' : 'delta',
            timestamp: Math.round(s.pts * 1000000),
            duration: Math.round(s.duration * 1000000),
            data: chunkData
          });
          this.decoder.decode(chunk);
          this._cursorIdx = i;
        }

        if (needFlush) {
          await this.decoder.flush();
          this._cursorIdx = -1;
        } else {
          // Yield briefly so hardware decoder queue drains without forcing a flush stall
          let spins = 0;
          while (this.decoder && this.decoder.state === 'configured' && this.decoder.decodeQueueSize > 4 && spins < 25) {
            await new Promise(r => setTimeout(r, 2));
            spins++;
          }
        }
      } catch (_) {
        this._cursorIdx = -1;
      }

      // Send any queued frames + done signal with updated cursorPts
      this._flushOutQueue(true, requestId);
    };

    this._jobChain = this._jobChain.then(run, run);
    return this._jobChain;
  }

  _initSeekDecoder() {
    if (typeof VideoDecoder === 'undefined' || !this.track) return false;

    const cfg = {
      codec: this.track.codec,
      codedWidth: this.track.width,
      codedHeight: this.track.height,
      optimizeForLatency: true
    };
    if (this.track.description) cfg.description = this.track.description;
    this._seekConfig = cfg;

    this._seekDecoder = new VideoDecoder({
      output: (videoFrame) => this._onSeekFrame(videoFrame),
      error: () => { this._seekCursorIdx = -1; }
    });

    try {
      this._seekDecoder.configure(cfg);
    } catch (_) {
      delete cfg.description;
      try { this._seekDecoder.configure(cfg); } catch (__) {}
    }
    this._seekCursorIdx = -1;
    return this._seekDecoder.state === 'configured';
  }

  _clearSeekStash() {
    for (const bmp of this._seekStash.values()) {
      try { bmp.close(); } catch (_) {}
    }
    this._seekStash.clear();
  }

  _resetSeekDecoder() {
    this._seekGen++;
    this._clearSeekStash();
    if (!this._seekDecoder || this._seekDecoder.state === 'closed') {
      return this._initSeekDecoder();
    }
    try {
      if (this._seekDecoder.state === 'configured') this._seekDecoder.reset();
      this._seekDecoder.configure(this._seekConfig);
    } catch (_) {
      try { this._seekDecoder.close(); } catch (__) {}
      this._seekDecoder = null;
      return this._initSeekDecoder();
    }
    this._seekCursorIdx = -1;
    return this._seekDecoder.state === 'configured';
  }

  _onSeekFrame(videoFrame) {
    if (this._destroyed) {
      try { videoFrame.close(); } catch (_) {}
      return;
    }
    const key = videoFrame.timestamp;
    const gen = this._seekGen;
    const dims = this._seekProxyDims;
    const opts = dims ? { resizeWidth: dims.width, resizeHeight: dims.height, resizeQuality: 'medium' } : undefined;

    const p = (opts ? createImageBitmap(videoFrame, opts) : createImageBitmap(videoFrame))
      .then((bmp) => {
        if (this._destroyed || gen !== this._seekGen) {
          try { bmp.close(); } catch (_) {}
          return;
        }
        const prev = this._seekStash.get(key);
        if (prev) { try { prev.close(); } catch (_) {} }
        this._seekStash.set(key, bmp);
        // Bounded stash: evict oldest decoded-ahead frames (never grows unbounded)
        while (this._seekStash.size > 32) {
          const oldestKey = this._seekStash.keys().next().value;
          const old = this._seekStash.get(oldestKey);
          this._seekStash.delete(oldestKey);
          if (old) { try { old.close(); } catch (_) {} }
        }
      })
      .catch(() => {})
      .finally(() => {
        try { videoFrame.close(); } catch (_) {}
        this._seekPending.delete(p);
      });
    this._seekPending.add(p);
  }

  _feedSeekSample(i) {
    const s = this.track.samples[i];
    this._seekDecoder.decode(new EncodedVideoChunk({
      type: s.isKey ? 'key' : 'delta',
      timestamp: Math.round(s.pts * 1000000),
      duration: Math.round(s.duration * 1000000),
      data: new Uint8Array(this.buffer, s.offset, s.size)
    }));
    this._seekCursorIdx = i;
  }

  /**
   * Random-access exact frame (used by export and AI background removal).
   * Runs on a dedicated decoder with a warm cursor: sequential requests (t, t+1, t+2 ...) only
   * decode ONE new chunk each (O(n) overall) instead of re-decoding the whole GOP per frame.
   * Never touches the playback streaming decoder.
   */
  seek(targetSec, options = {}) {
    const run = async () => {
      if (this._destroyed || !this.track || !this.track.samples.length) return null;

      const samples = this.track.samples;
      const targetIdx = this._findSampleIndexNear(targetSec);
      const gop = this.track.gops[Math.max(0, this.findGopIndex(targetSec))];
      const key = Math.round(samples[targetIdx].pts * 1000000);

      const isExport = !!options.isExport;
      const proxyDims = isExport ? null : _computeProxyDims(this.track.width, this.track.height, options.maxW || 1920, options.maxH || 1080);
      const proxyKey = proxyDims ? `${proxyDims.width}x${proxyDims.height}` : 'full';

      const findStashKey = () => {
        if (this._seekStash.has(key)) return key;
        let bestK = null;
        let bestDiff = 10000; // 10ms tolerance for hardware decoder timestamp rounding
        for (const k of this._seekStash.keys()) {
          const d = Math.abs(k - key);
          if (d < bestDiff) {
            bestDiff = d;
            bestK = k;
          }
        }
        return bestK;
      };

      const take = () => {
        const k = findStashKey();
        if (k === null) return null;
        const bmp = this._seekStash.get(k);
        this._seekStash.delete(k);
        return bmp || null;
      };

      if (this._seekProxyKey === proxyKey && findStashKey() !== null) return take();

      const dec = this._seekDecoder;
      const cursor = this._seekCursorIdx;
      // Warm continuation: target is just ahead of the cursor, or still inside the hardware
      // reorder buffer right behind it (its output simply has not been emitted yet).
      const canContinue = !!(
        dec && dec.state === 'configured' &&
        cursor >= 0 &&
        this._seekProxyKey === proxyKey &&
        targetIdx > cursor - 12 &&
        (targetIdx - cursor) <= 300
      );

      let feedStart;
      if (canContinue) {
        // A later keyframe lets us skip straight to it without any reset
        feedStart = (gop.keyIdx > cursor) ? gop.keyIdx : cursor + 1;
      } else {
        if (!this._resetSeekDecoder()) return null;
        feedStart = gop.keyIdx;
      }
      this._seekProxyDims = proxyDims;
      this._seekProxyKey = proxyKey;

      try {
        // Feed a little past the target: the hardware reorder buffer holds ~4-6 frames, and the
        // extra outputs are stashed so the following sequential seeks are served instantly.
        const feedEnd = Math.min(samples.length - 1, targetIdx + 8);
        for (let i = feedStart; i <= feedEnd; i++) this._feedSeekSample(i);

        // Wait for the target to leave the hardware reorder buffer; nudge with extra chunks if needed.
        const deadline = Date.now() + 400;
        let lastNudge = Date.now();
        let nudges = 0;
        while (findStashKey() === null && Date.now() < deadline) {
          // createImageBitmap resolves on microtasks: awaiting it avoids a timer round-trip (1-15ms) per frame
          if (this._seekPending.size > 0) {
            await Promise.all(Array.from(this._seekPending));
            if (findStashKey() !== null) break;
          }
          await new Promise(r => setTimeout(r, 2));
          const now = Date.now();
          if (findStashKey() === null && now - lastNudge > 30 && nudges < 8 && this._seekCursorIdx + 1 < samples.length) {
            this._feedSeekSample(this._seekCursorIdx + 1);
            nudges++;
            lastNudge = now;
          }
        }

        if (findStashKey() === null && this._seekPending.size > 0) {
          await Promise.all(Array.from(this._seekPending));
        }
        if (findStashKey() === null && this._seekDecoder && this._seekDecoder.state === 'configured') {
          // Last resort: flush forces out every buffered frame (next seek will reset to a keyframe)
          await this._seekDecoder.flush();
          await Promise.all(Array.from(this._seekPending));
          this._seekCursorIdx = -1;
        }
      } catch (_) {
        this._seekCursorIdx = -1;
      }

      return take();
    };

    this._jobChain = this._jobChain.then(run, run);
    return this._jobChain;
  }

  destroy() {
    this._destroyed = true;
    this._streamGen++;
    this._seekGen++;
    this._clearOutQueue();
    this._clearSeekStash();
    if (this._seekDecoder) {
      try { this._seekDecoder.close(); } catch (_) {}
      this._seekDecoder = null;
    }
    if (this.decoder) {
      try { this.decoder.close(); } catch (_) {}
      this.decoder = null;
    }
    this.buffer = null;
  }
}

// Worker Message Dispatcher
self.onmessage = async (e) => {
  const data = e.data;
  if (!data) return;

  const { type, id, mediaId } = data;

  if (type === 'init') {
    try {
      const existing = streams.get(mediaId);
      if (existing) {
        existing.destroy();
        streams.delete(mediaId);
      }
      const stream = new VideoStream(mediaId, data.buffer);
      if (stream.track && stream.track.samples && stream.track.samples.length > 0) {
        streams.set(mediaId, stream);
        const gopSummary = stream.track.gops.map(g => ({
          index: g.index,
          startPts: g.startPts,
          endPts: g.endPts,
          frameCount: g.endIdx - g.keyIdx + 1
        }));
        self.postMessage({
          type: 'init_ok',
          id: id,
          mediaId: mediaId,
          duration: stream.track.duration || 0,
          width: stream.track.width || 1920,
          height: stream.track.height || 1080,
          fps: stream.track.fps || 30,
          sampleCount: stream.track.samples.length,
          gops: gopSummary
        });
      } else {
        self.postMessage({ type: 'init_error', id: id, mediaId: mediaId, error: 'No video samples demuxed' });
      }
    } catch (err) {
      self.postMessage({ type: 'init_error', id: id, mediaId: mediaId, error: String(err) });
    }
  } else if (type === 'stream_ahead' || type === 'decode_gop') {
    const stream = streams.get(mediaId);
    if (!stream) {
      self.postMessage({ type: 'frames_batch', id: id, mediaId: mediaId, isProxy: false, done: true, cursorPts: 0, frames: [] });
      return;
    }
    await stream.streamAhead(id, {
      targetSec: data.timeSec || 0,
      count: data.count || 30,
      mode: data.mode || 'auto',
      isExport: !!data.isExport,
      maxW: data.maxW || 1920,
      maxH: data.maxH || 1080
    });
  } else if (type === 'seek') {
    const stream = streams.get(mediaId);
    if (!stream) {
      self.postMessage({ type: 'seek_result', id: id, mediaId: mediaId, bitmap: null });
      return;
    }

    try {
      const bitmap = await stream.seek(data.timeSec, {
        isExport: !!data.isExport,
        maxW: data.maxW || 1920,
        maxH: data.maxH || 1080
      });
      if (bitmap) {
        self.postMessage(
          { type: 'seek_result', id: id, mediaId: mediaId, timeSec: data.timeSec, bitmap: bitmap },
          [bitmap]
        );
      } else {
        self.postMessage({ type: 'seek_result', id: id, mediaId: mediaId, timeSec: data.timeSec, bitmap: null });
      }
    } catch (_) {
      self.postMessage({ type: 'seek_result', id: id, mediaId: mediaId, timeSec: data.timeSec, bitmap: null });
    }
  } else if (type === 'release') {
    const stream = streams.get(mediaId);
    if (stream) {
      stream.destroy();
      streams.delete(mediaId);
    }
    self.postMessage({ type: 'released', id: id, mediaId: mediaId });
  }
};
