/**
 * FISH3D-LOADER.JS - Zero-Dependency 3D Model Importer & WebGL Mesh Renderer
 * Supports:
 * - Wavefront .OBJ + .MTL (+ diffuse/specular textures)
 * - Autodesk .FBX (Binary 7100-7700 with zlib deflate & ASCII FBX)
 * - .ZIP bundles containing .obj/.mtl/.fbx + texture images (via vendored JSZip)
 * - Multi-file selection (.obj + .mtl + .png/.jpg/.webp selected together)
 *
 * All imported geometry is centered at (0,0,0), normalized to [-0.5, 0.5] unit space,
 * converted from Y-up to canvas Y-down, and uploaded once to static WebGL VBOs/VAOs.
 */
(function (global) {
  'use strict';

  const _modelCache = new Map();     // modelId -> parsed model bundle { id, name, positions, normals, uvs, groups, slots, aspect, textures }
  const _gpuMeshCache = new WeakMap(); // modelBundle -> { gl, vao, posBuf, normBuf, uvBuf, groups }
  const _loadingIds = new Set();

  const _scratchMvp = new Float32Array(16);
  const _scratchModel = new Float32Array(16);
  const _scratchRgb = { r: 200, g: 200, b: 200 };

  function basenameLower(p) {
    if (!p) return '';
    const s = String(p).replace(/\\/g, '/').trim();
    const parts = s.split('/');
    return parts[parts.length - 1].toLowerCase();
  }

  function rgbFloatToHex(r, g, b) {
    const cr = Math.max(0, Math.min(255, Math.round((Number(r) || 0) * 255)));
    const cg = Math.max(0, Math.min(255, Math.round((Number(g) || 0) * 255)));
    const cb = Math.max(0, Math.min(255, Math.round((Number(b) || 0) * 255)));
    return '#' + ((1 << 24) + (cr << 16) + (cg << 8) + cb).toString(16).slice(1);
  }

  function scaleMatrixZ(out, src, zScale) {
    for (let i = 0; i < 16; i++) out[i] = src[i];
    out[8] *= zScale;
    out[9] *= zScale;
    out[10] *= zScale;
    out[11] *= zScale;
    return out;
  }

  // =========================================================================
  // 0b. 4x4 MATRIX & FBX SKELETAL / NODE ANIMATION EVALUATOR (Zero-GC)
  // =========================================================================
  const DEG2RAD = Math.PI / 180;
  const _mTmpA = new Float32Array(16);
  const _mTmpB = new Float32Array(16);
  const _mTmpR = new Float32Array(16);
  const _mTmpPre = new Float32Array(16);
  const _qTmp0 = new Float32Array(4);
  const _qTmp1 = new Float32Array(4);
  const _qTmpOut = new Float32Array(4);

  function mat4Identity(out, off = 0) {
    out[off] = 1; out[off + 1] = 0; out[off + 2] = 0; out[off + 3] = 0;
    out[off + 4] = 0; out[off + 5] = 1; out[off + 6] = 0; out[off + 7] = 0;
    out[off + 8] = 0; out[off + 9] = 0; out[off + 10] = 1; out[off + 11] = 0;
    out[off + 12] = 0; out[off + 13] = 0; out[off + 14] = 0; out[off + 15] = 1;
    return out;
  }

  function mat4Mul(out, outOff, a, aOff, b, bOff) {
    const a00 = a[aOff], a01 = a[aOff + 1], a02 = a[aOff + 2], a03 = a[aOff + 3];
    const a10 = a[aOff + 4], a11 = a[aOff + 5], a12 = a[aOff + 6], a13 = a[aOff + 7];
    const a20 = a[aOff + 8], a21 = a[aOff + 9], a22 = a[aOff + 10], a23 = a[aOff + 11];
    const a30 = a[aOff + 12], a31 = a[aOff + 13], a32 = a[aOff + 14], a33 = a[aOff + 15];
    for (let col = 0; col < 4; col++) {
      const bo = bOff + col * 4;
      const b0 = b[bo], b1 = b[bo + 1], b2 = b[bo + 2], b3 = b[bo + 3];
      const oo = outOff + col * 4;
      out[oo] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
      out[oo + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
      out[oo + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
      out[oo + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
    }
    return out;
  }

  function mat4Invert(out, m) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return mat4Identity(out, 0);
    det = 1.0 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  }

  function mat4FromEulerXYZ(out, rx, ry, rz) {
    const x = rx * DEG2RAD, y = ry * DEG2RAD, z = rz * DEG2RAD;
    const cx = Math.cos(x), sx = Math.sin(x);
    const cy = Math.cos(y), sy = Math.sin(y);
    const cz = Math.cos(z), sz = Math.sin(z);
    // R = Rz * Ry * Rx (column-major)
    out[0] = cy * cz;
    out[1] = cy * sz;
    out[2] = -sy;
    out[3] = 0;
    out[4] = sx * sy * cz - cx * sz;
    out[5] = sx * sy * sz + cx * cz;
    out[6] = sx * cy;
    out[7] = 0;
    out[8] = cx * sy * cz + sx * sz;
    out[9] = cx * sy * sz - sx * cz;
    out[10] = cx * cy;
    out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
  }

  function quatFromEulerXYZ(out, rx, ry, rz) {
    // Matches mat4FromEulerXYZ (R = Rz * Ry * Rx)
    const hx = rx * DEG2RAD * 0.5;
    const hy = ry * DEG2RAD * 0.5;
    const hz = rz * DEG2RAD * 0.5;
    const cx = Math.cos(hx), sx = Math.sin(hx);
    const cy = Math.cos(hy), sy = Math.sin(hy);
    const cz = Math.cos(hz), sz = Math.sin(hz);
    out[0] = sx * cy * cz - cx * sy * sz;
    out[1] = cx * sy * cz + sx * cy * sz;
    out[2] = cx * cy * sz - sx * sy * cz;
    out[3] = cx * cy * cz + sx * sy * sz;
    return out;
  }

  function quatSlerp(out, a, b, t) {
    let bx = b[0], by = b[1], bz = b[2], bw = b[3];
    let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
    if (dot < 0) {
      dot = -dot;
      bx = -bx; by = -by; bz = -bz; bw = -bw;
    }
    let s0, s1;
    if (dot > 0.9995) {
      s0 = 1 - t;
      s1 = t;
    } else {
      const theta = Math.acos(Math.min(1, dot));
      const invSin = 1 / Math.sin(theta);
      s0 = Math.sin((1 - t) * theta) * invSin;
      s1 = Math.sin(t * theta) * invSin;
    }
    const rx = a[0] * s0 + bx * s1;
    const ry = a[1] * s0 + by * s1;
    const rz = a[2] * s0 + bz * s1;
    const rw = a[3] * s0 + bw * s1;
    const len = Math.hypot(rx, ry, rz, rw) || 1;
    out[0] = rx / len;
    out[1] = ry / len;
    out[2] = rz / len;
    out[3] = rw / len;
    return out;
  }

  function mat4FromQuat(out, qx, qy, qz, qw) {
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    out[0] = 1 - (yy + zz);
    out[1] = xy + wz;
    out[2] = xz - wy;
    out[3] = 0;
    out[4] = xy - wz;
    out[5] = 1 - (xx + zz);
    out[6] = yz + wx;
    out[7] = 0;
    out[8] = xz + wy;
    out[9] = yz - wx;
    out[10] = 1 - (xx + yy);
    out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
  }

  function computeFbxNodeLocal(out, node, tx, ty, tz, rx, ry, rz, sx, sy, sz, qArr, qOff) {
    // M = T * Rp * Rpre * R * Rp^-1 * Sp * S * Sp^-1
    if (qArr) {
      mat4FromQuat(_mTmpR, qArr[qOff], qArr[qOff + 1], qArr[qOff + 2], qArr[qOff + 3]);
    } else {
      mat4FromEulerXYZ(_mTmpR, rx, ry, rz);
    }
    const pr = node.preRot;
    if (pr && (pr[0] || pr[1] || pr[2])) {
      mat4FromEulerXYZ(_mTmpPre, pr[0], pr[1], pr[2]);
      mat4Mul(_mTmpA, 0, _mTmpPre, 0, _mTmpR, 0);
    } else {
      _mTmpA.set(_mTmpR);
    }
    const rp = node.rotPivot;
    if (rp && (rp[0] || rp[1] || rp[2])) {
      const r00 = _mTmpA[0], r01 = _mTmpA[1], r02 = _mTmpA[2];
      const r10 = _mTmpA[4], r11 = _mTmpA[5], r12 = _mTmpA[6];
      const r20 = _mTmpA[8], r21 = _mTmpA[9], r22 = _mTmpA[10];
      _mTmpA[12] += rp[0] - (r00 * rp[0] + r10 * rp[1] + r20 * rp[2]);
      _mTmpA[13] += rp[1] - (r01 * rp[0] + r11 * rp[1] + r21 * rp[2]);
      _mTmpA[14] += rp[2] - (r02 * rp[0] + r12 * rp[1] + r22 * rp[2]);
    }
    _mTmpA[12] += tx;
    _mTmpA[13] += ty;
    _mTmpA[14] += tz;

    if (sx !== 1 || sy !== 1 || sz !== 1) {
      const sp = node.scalePivot;
      mat4Identity(_mTmpB, 0);
      _mTmpB[0] = sx; _mTmpB[5] = sy; _mTmpB[10] = sz;
      if (sp && (sp[0] || sp[1] || sp[2])) {
        _mTmpB[12] = sp[0] * (1 - sx);
        _mTmpB[13] = sp[1] * (1 - sy);
        _mTmpB[14] = sp[2] * (1 - sz);
      }
      mat4Mul(out, 0, _mTmpA, 0, _mTmpB, 0);
    } else {
      out.set(_mTmpA);
    }
    return out;
  }

  function sampleAnimCurve(curve, t, defVal) {
    if (!curve || !curve.times || curve.times.length === 0) return defVal;
    const times = curve.times;
    const vals = curve.values;
    const n = times.length;
    if (t <= times[0] || n === 1) return vals[0];
    if (t >= times[n - 1]) return vals[n - 1];
    let lo = 0, hi = n - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    const dt = times[hi] - times[lo];
    const alpha = dt > 1e-6 ? (t - times[lo]) / dt : 0;
    return vals[lo] + (vals[hi] - vals[lo]) * alpha;
  }

  function _curveBracket(curve, t, outPair) {
    if (!curve || !curve.times || curve.times.length === 0) return false;
    const times = curve.times;
    const n = times.length;
    if (t <= times[0] || n === 1) { outPair[0] = times[0]; outPair[1] = times[0]; return true; }
    if (t >= times[n - 1]) { outPair[0] = times[n - 1]; outPair[1] = times[n - 1]; return true; }
    let lo = 0, hi = n - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    outPair[0] = times[lo];
    outPair[1] = times[hi];
    return true;
  }
  const _bracketTmp = new Float64Array(2);

  function evaluateBundlePose(bundle, clipIndex, timeSec) {
    const rig = bundle && bundle.rig;
    if (!rig || !rig.nodes || !bundle.basePositions) return;
    const nodes = rig.nodes;
    const nCount = nodes.length;
    if (!rig._worldMats || !(rig._worldMats instanceof Float32Array) || rig._worldMats.length < nCount * 16) {
      rig._worldMats = new Float32Array(nCount * 16);
    }
    if (!rig._localMat || !(rig._localMat instanceof Float32Array) || rig._localMat.length < 16) {
      rig._localMat = new Float32Array(16);
    }
    if (!rig._poseT || !(rig._poseT instanceof Float32Array) || rig._poseT.length < nCount * 3) {
      rig._poseT = new Float32Array(nCount * 3);
    }
    if (!rig._poseR || !(rig._poseR instanceof Float32Array) || rig._poseR.length < nCount * 3) {
      rig._poseR = new Float32Array(nCount * 3);
    }
    if (!rig._poseS || !(rig._poseS instanceof Float32Array) || rig._poseS.length < nCount * 3) {
      rig._poseS = new Float32Array(nCount * 3);
    }
    if (!rig._poseQ || !(rig._poseQ instanceof Float32Array) || rig._poseQ.length < nCount * 4) {
      rig._poseQ = new Float32Array(nCount * 4);
    }
    if (!rig._hasPoseQ || !(rig._hasPoseQ instanceof Uint8Array) || rig._hasPoseQ.length < nCount) {
      rig._hasPoseQ = new Uint8Array(nCount);
    }
    const worldMats = rig._worldMats;
    const localMat = rig._localMat;
    const pT = rig._poseT, pR = rig._poseR, pS = rig._poseS;
    const pQ = rig._poseQ, hasPoseQ = rig._hasPoseQ;

    for (let i = 0; i < nCount; i++) {
      const nd = nodes[i];
      const i3 = i * 3;
      pT[i3] = nd.lclT[0]; pT[i3 + 1] = nd.lclT[1]; pT[i3 + 2] = nd.lclT[2];
      pR[i3] = nd.lclR[0]; pR[i3 + 1] = nd.lclR[1]; pR[i3 + 2] = nd.lclR[2];
      pS[i3] = nd.lclS[0]; pS[i3 + 1] = nd.lclS[1]; pS[i3 + 2] = nd.lclS[2];
      hasPoseQ[i] = 0;
    }

    const anims = bundle.animations;
    if (anims && anims.length > 0 && clipIndex >= 0) {
      const clip = anims[Math.min(clipIndex, anims.length - 1)];
      if (clip && clip.tracks) {
        const dur = clip.duration > 1e-4 ? clip.duration : 1;
        const t = ((timeSec % dur) + dur) % dur;
        for (let ti = 0; ti < clip.tracks.length; ti++) {
          const tr = clip.tracks[ti];
          const ni = tr.nodeIdx;
          if (ni < 0 || ni >= nCount) continue;
          const i3 = ni * 3;
          if (tr.prop === 'R') {
            // Find tightest bracketing keyframe interval [t0, t1] across X/Y/Z curves
            // and SLERP between endpoint quaternions to eliminate Euler gimbal flips
            // (e.g. (x, y, z) <-> (x +/- 180, 180 - y, z +/- 180) between 30fps keys).
            let t0 = -Infinity, t1 = Infinity;
            let hasAny = false;
            if (_curveBracket(tr.cx, t, _bracketTmp)) {
              if (_bracketTmp[0] > t0) t0 = _bracketTmp[0];
              if (_bracketTmp[1] < t1) t1 = _bracketTmp[1];
              hasAny = true;
            }
            if (_curveBracket(tr.cy, t, _bracketTmp)) {
              if (_bracketTmp[0] > t0) t0 = _bracketTmp[0];
              if (_bracketTmp[1] < t1) t1 = _bracketTmp[1];
              hasAny = true;
            }
            if (_curveBracket(tr.cz, t, _bracketTmp)) {
              if (_bracketTmp[0] > t0) t0 = _bracketTmp[0];
              if (_bracketTmp[1] < t1) t1 = _bracketTmp[1];
              hasAny = true;
            }
            if (!hasAny) continue;
            const dt = t1 - t0;
            if (dt <= 1e-6) {
              if (tr.cx) pR[i3] = sampleAnimCurve(tr.cx, t, pR[i3]);
              if (tr.cy) pR[i3 + 1] = sampleAnimCurve(tr.cy, t, pR[i3 + 1]);
              if (tr.cz) pR[i3 + 2] = sampleAnimCurve(tr.cz, t, pR[i3 + 2]);
              hasPoseQ[ni] = 0;
            } else {
              const rx0 = tr.cx ? sampleAnimCurve(tr.cx, t0, pR[i3]) : pR[i3];
              const ry0 = tr.cy ? sampleAnimCurve(tr.cy, t0, pR[i3 + 1]) : pR[i3 + 1];
              const rz0 = tr.cz ? sampleAnimCurve(tr.cz, t0, pR[i3 + 2]) : pR[i3 + 2];
              const rx1 = tr.cx ? sampleAnimCurve(tr.cx, t1, pR[i3]) : pR[i3];
              const ry1 = tr.cy ? sampleAnimCurve(tr.cy, t1, pR[i3 + 1]) : pR[i3 + 1];
              const rz1 = tr.cz ? sampleAnimCurve(tr.cz, t1, pR[i3 + 2]) : pR[i3 + 2];
              const dx = Math.abs(rx1 - rx0), dy = Math.abs(ry1 - ry0), dz = Math.abs(rz1 - rz0);
              const isSingleAxisSpin =
                (dx >= 180 && dy < 30 && dz < 30) ||
                (dy >= 180 && dx < 30 && dz < 30) ||
                (dz >= 180 && dx < 30 && dy < 30);
              const alpha = (t - t0) / dt;
              if (isSingleAxisSpin) {
                pR[i3] = rx0 + (rx1 - rx0) * alpha;
                pR[i3 + 1] = ry0 + (ry1 - ry0) * alpha;
                pR[i3 + 2] = rz0 + (rz1 - rz0) * alpha;
                hasPoseQ[ni] = 0;
              } else {
                quatFromEulerXYZ(_qTmp0, rx0, ry0, rz0);
                quatFromEulerXYZ(_qTmp1, rx1, ry1, rz1);
                quatSlerp(_qTmpOut, _qTmp0, _qTmp1, alpha);
                const i4 = ni * 4;
                pQ[i4] = _qTmpOut[0];
                pQ[i4 + 1] = _qTmpOut[1];
                pQ[i4 + 2] = _qTmpOut[2];
                pQ[i4 + 3] = _qTmpOut[3];
                hasPoseQ[ni] = 1;
              }
            }
          } else {
            const arr = tr.prop === 'T' ? pT : pS;
            if (tr.cx) arr[i3] = sampleAnimCurve(tr.cx, t, arr[i3]);
            if (tr.cy) arr[i3 + 1] = sampleAnimCurve(tr.cy, t, arr[i3 + 1]);
            if (tr.cz) arr[i3 + 2] = sampleAnimCurve(tr.cz, t, arr[i3 + 2]);
          }
        }
      }
    }

    for (let i = 0; i < nCount; i++) {
      const nd = nodes[i];
      const i3 = i * 3;
      computeFbxNodeLocal(
        localMat, nd,
        pT[i3], pT[i3 + 1], pT[i3 + 2],
        pR[i3], pR[i3 + 1], pR[i3 + 2],
        pS[i3], pS[i3 + 1], pS[i3 + 2],
        hasPoseQ[i] ? pQ : null, i * 4
      );
      if (nd.parentIdx >= 0) {
        mat4Mul(worldMats, i * 16, worldMats, nd.parentIdx * 16, localMat, 0);
      } else {
        worldMats.set(localMat, i * 16);
      }
    }

    const bCount = rig.boneNodeIdx.length;
    if (!rig._skinMats || !(rig._skinMats instanceof Float32Array) || rig._skinMats.length < bCount * 16) {
      rig._skinMats = new Float32Array(bCount * 16);
    }
    const skinMats = rig._skinMats;
    const boneNodeIdx = rig.boneNodeIdx;
    const boneOffsets = rig.boneOffsets;
    for (let b = 0; b < bCount; b++) {
      mat4Mul(skinMats, b * 16, worldMats, boneNodeIdx[b] * 16, boneOffsets, b * 16);
    }

    const basePos = bundle.basePositions;
    const baseNorm = bundle.baseNormals;
    const outPos = bundle.positions;
    const outNorm = bundle.normals;
    const sIdx = bundle.skinIndices;
    const sWt = bundle.skinWeights;
    const vCount = bundle.vertexCount;
    const cx = rig.cx, cy = rig.cy, cz = rig.cz, invScale = rig.invScale;

    for (let v = 0; v < vCount; v++) {
      const v3 = v * 3;
      const v4 = v * 4;
      const px = basePos[v3], py = basePos[v3 + 1], pz = basePos[v3 + 2];
      const nx = baseNorm[v3], ny = baseNorm[v3 + 1], nz = baseNorm[v3 + 2];
      let wx = 0, wy = 0, wz = 0;
      let wnx = 0, wny = 0, wnz = 0;

      for (let j = 0; j < 4; j++) {
        const w = sWt[v4 + j];
        if (w <= 0) continue;
        const mOff = sIdx[v4 + j] * 16;
        wx += (skinMats[mOff] * px + skinMats[mOff + 4] * py + skinMats[mOff + 8] * pz + skinMats[mOff + 12]) * w;
        wy += (skinMats[mOff + 1] * px + skinMats[mOff + 5] * py + skinMats[mOff + 9] * pz + skinMats[mOff + 13]) * w;
        wz += (skinMats[mOff + 2] * px + skinMats[mOff + 6] * py + skinMats[mOff + 10] * pz + skinMats[mOff + 14]) * w;

        wnx += (skinMats[mOff] * nx + skinMats[mOff + 4] * ny + skinMats[mOff + 8] * nz) * w;
        wny += (skinMats[mOff + 1] * nx + skinMats[mOff + 5] * ny + skinMats[mOff + 9] * nz) * w;
        wnz += (skinMats[mOff + 2] * nx + skinMats[mOff + 6] * ny + skinMats[mOff + 10] * nz) * w;
      }

      outPos[v3] = (wx - cx) * invScale;
      outPos[v3 + 1] = -(wy - cy) * invScale;
      outPos[v3 + 2] = (wz - cz) * invScale;

      const nLen = Math.hypot(wnx, wny, wnz) || 1;
      outNorm[v3] = wnx / nLen;
      outNorm[v3 + 1] = -wny / nLen;
      outNorm[v3 + 2] = wnz / nLen;
    }
  }

  // =========================================================================
  // 1. MTL PARSER
  // =========================================================================
  function parseMTL(text) {
    const materials = {};
    if (!text) return materials;
    let cur = null;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.charCodeAt(0) === 35) continue; // '#'
      const sp = line.search(/\s/);
      const key = sp === -1 ? line : line.slice(0, sp);
      const rest = sp === -1 ? '' : line.slice(sp + 1).trim();

      if (key === 'newmtl') {
        cur = {
          name: rest || 'Material',
          kd: [0.85, 0.85, 0.85],
          ks: [0.25, 0.25, 0.25],
          ns: 32,
          d: 1.0,
          mapKd: null
        };
        materials[cur.name] = cur;
      } else if (!cur) {
        continue;
      } else if (key === 'Kd') {
        const p = rest.split(/\s+/);
        if (p.length >= 3) {
          cur.kd = [parseFloat(p[0]) || 0.85, parseFloat(p[1]) || 0.85, parseFloat(p[2]) || 0.85];
        }
      } else if (key === 'Ks') {
        const p = rest.split(/\s+/);
        if (p.length >= 3) {
          cur.ks = [parseFloat(p[0]) || 0, parseFloat(p[1]) || 0, parseFloat(p[2]) || 0];
        }
      } else if (key === 'Ns') {
        cur.ns = parseFloat(rest) || 0;
      } else if (key === 'd') {
        cur.d = parseFloat(rest);
        if (isNaN(cur.d)) cur.d = 1.0;
      } else if (key === 'map_Kd' || key === 'map_kd') {
        // Strip optional MTL options like -bm 1.0 or -s 1 1 1
        const tokens = rest.split(/\s+/);
        let texPath = rest;
        for (let t = tokens.length - 1; t >= 0; t--) {
          if (/\.(png|jpe?g|webp|bmp|gif|tga)$/i.test(tokens[t])) {
            texPath = tokens[t];
            break;
          }
        }
        cur.mapKd = basenameLower(texPath);
      }
    }
    return materials;
  }

  // =========================================================================
  // 2. OBJ PARSER (Grouped by Material -> Non-Indexed Static VBO)
  // =========================================================================
  function parseOBJ(text, mtlMap) {
    const rawV = [];
    const rawVt = [];
    const rawVn = [];

    const groupBuckets = new Map(); // mtlName -> { pos:[], norm:[], uv:[] }
    let curMtl = 'Default';

    function getBucket(name) {
      let b = groupBuckets.get(name);
      if (!b) {
        b = { name, pos: [], norm: [], uv: [] };
        groupBuckets.set(name, b);
      }
      return b;
    }

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.charCodeAt(0) === 35) continue;

      if (line.startsWith('v ')) {
        const p = line.slice(2).trim().split(/\s+/);
        rawV.push(parseFloat(p[0]) || 0, parseFloat(p[1]) || 0, parseFloat(p[2]) || 0);
      } else if (line.startsWith('vt ')) {
        const p = line.slice(3).trim().split(/\s+/);
        rawVt.push(parseFloat(p[0]) || 0, parseFloat(p[1]) || 0);
      } else if (line.startsWith('vn ')) {
        const p = line.slice(3).trim().split(/\s+/);
        rawVn.push(parseFloat(p[0]) || 0, parseFloat(p[1]) || 0, parseFloat(p[2]) || 0);
      } else if (line.startsWith('usemtl ')) {
        curMtl = line.slice(7).trim() || 'Default';
      } else if (line.startsWith('f ')) {
        const tokens = line.slice(2).trim().split(/\s+/);
        if (tokens.length < 3) continue;

        const vCount = rawV.length / 3;
        const vtCount = rawVt.length / 2;
        const vnCount = rawVn.length / 3;

        const faceVerts = [];
        for (let t = 0; t < tokens.length; t++) {
          const parts = tokens[t].split('/');
          let vi = parseInt(parts[0], 10);
          let ti = parts.length > 1 && parts[1] !== '' ? parseInt(parts[1], 10) : 0;
          let ni = parts.length > 2 && parts[2] !== '' ? parseInt(parts[2], 10) : 0;
          if (vi < 0) vi = vCount + vi + 1;
          if (ti < 0) ti = vtCount + ti + 1;
          if (ni < 0) ni = vnCount + ni + 1;
          faceVerts.push([vi - 1, ti - 1, ni - 1]);
        }

        const bucket = getBucket(curMtl);
        // Fan triangulation
        for (let k = 1; k + 1 < faceVerts.length; k++) {
          const tri = [faceVerts[0], faceVerts[k], faceVerts[k + 1]];
          const p0 = tri[0][0] * 3, p1 = tri[1][0] * 3, p2 = tri[2][0] * 3;
          const x0 = rawV[p0] || 0, y0 = rawV[p0 + 1] || 0, z0 = rawV[p0 + 2] || 0;
          const x1 = rawV[p1] || 0, y1 = rawV[p1 + 1] || 0, z1 = rawV[p1 + 2] || 0;
          const x2 = rawV[p2] || 0, y2 = rawV[p2 + 1] || 0, z2 = rawV[p2 + 2] || 0;

          let fnx = 0, fny = 0, fnz = 1;
          const needFaceNormal = (tri[0][2] < 0 || tri[1][2] < 0 || tri[2][2] < 0);
          if (needFaceNormal) {
            const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0;
            const e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
            fnx = e1y * e2z - e1z * e2y;
            fny = e1z * e2x - e1x * e2z;
            fnz = e1x * e2y - e1y * e2x;
            const len = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz) || 1;
            fnx /= len; fny /= len; fnz /= len;
          }

          for (let c = 0; c < 3; c++) {
            const vi = tri[c][0] * 3;
            const ti = tri[c][1] * 2;
            const ni = tri[c][2] * 3;
            bucket.pos.push(rawV[vi] || 0, rawV[vi + 1] || 0, rawV[vi + 2] || 0);
            if (tri[c][1] >= 0 && ti + 1 < rawVt.length) {
              bucket.uv.push(rawVt[ti], 1.0 - rawVt[ti + 1]);
            } else {
              bucket.uv.push(0, 0);
            }
            if (tri[c][2] >= 0 && ni + 2 < rawVn.length) {
              bucket.norm.push(rawVn[ni], rawVn[ni + 1], rawVn[ni + 2]);
            } else {
              bucket.norm.push(fnx, fny, fnz);
            }
          }
        }
      }
    }

    return finalizeBucketsToBundle(groupBuckets, mtlMap || {});
  }

  // =========================================================================
  // 3. FBX PARSER (Binary 7100-7700 + ASCII FBX)
  // =========================================================================
  async function inflateZlib(bytes) {
    const DS = global.DecompressionStream;
    if (typeof DS === 'function') {
      const ds = new DS('deflate');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const resp = new Response(ds.readable);
      const ab = await resp.arrayBuffer();
      return new Uint8Array(ab);
    }
    throw new Error('DecompressionStream(deflate) is not supported in this browser');
  }

  async function parseBinaryFBX(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const version = view.getUint32(23, true);
    const is64 = version >= 7500;
    let offset = 27;

    function readUInt64AsNum(pos) {
      const lo = view.getUint32(pos, true);
      const hi = view.getUint32(pos + 4, true);
      return hi * 4294967296 + lo;
    }

    async function readProperty() {
      const type = String.fromCharCode(bytes[offset++]);
      switch (type) {
        case 'Y': { const v = view.getInt16(offset, true); offset += 2; return v; }
        case 'C': { const v = bytes[offset++] !== 0; return v; }
        case 'I': { const v = view.getInt32(offset, true); offset += 4; return v; }
        case 'F': { const v = view.getFloat32(offset, true); offset += 4; return v; }
        case 'D': { const v = view.getFloat64(offset, true); offset += 8; return v; }
        case 'L': { const v = readUInt64AsNum(offset); offset += 8; return v; }
        case 'S':
        case 'R': {
          const len = view.getUint32(offset, true);
          offset += 4;
          const slice = bytes.subarray(offset, offset + len);
          offset += len;
          if (type === 'R') return slice;
          return new TextDecoder('utf-8').decode(slice);
        }
        case 'f':
        case 'd':
        case 'l':
        case 'i':
        case 'b': {
          const arrLen = view.getUint32(offset, true);
          const encoding = view.getUint32(offset + 4, true);
          const compLen = view.getUint32(offset + 8, true);
          offset += 12;
          let raw = bytes.subarray(offset, offset + compLen);
          offset += compLen;
          if (encoding === 1) {
            raw = await inflateZlib(raw);
          }
          const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
          if (type === 'd') {
            const out = new Float64Array(arrLen);
            for (let i = 0; i < arrLen; i++) out[i] = dv.getFloat64(i * 8, true);
            return out;
          }
          if (type === 'f') {
            const out = new Float32Array(arrLen);
            for (let i = 0; i < arrLen; i++) out[i] = dv.getFloat32(i * 4, true);
            return out;
          }
          if (type === 'i') {
            const out = new Int32Array(arrLen);
            for (let i = 0; i < arrLen; i++) out[i] = dv.getInt32(i * 4, true);
            return out;
          }
          if (type === 'l') {
            const out = new Float64Array(arrLen);
            for (let i = 0; i < arrLen; i++) {
              const lo = dv.getUint32(i * 8, true);
              const hi = dv.getUint32(i * 8 + 4, true);
              out[i] = hi * 4294967296 + lo;
            }
            return out;
          }
          return raw;
        }
        default:
          throw new Error('Unknown FBX property type: ' + type);
      }
    }

    async function readNode() {
      const endOffset = is64 ? readUInt64AsNum(offset) : view.getUint32(offset, true);
      offset += is64 ? 8 : 4;
      const numProps = is64 ? readUInt64AsNum(offset) : view.getUint32(offset, true);
      offset += is64 ? 8 : 4;
      const propListLen = is64 ? readUInt64AsNum(offset) : view.getUint32(offset, true);
      offset += is64 ? 8 : 4;
      const nameLen = bytes[offset++];
      if (endOffset === 0 && numProps === 0 && propListLen === 0 && nameLen === 0) {
        return null;
      }
      const name = new TextDecoder('utf-8').decode(bytes.subarray(offset, offset + nameLen));
      offset += nameLen;

      const props = [];
      for (let i = 0; i < numProps; i++) {
        props.push(await readProperty());
      }
      const children = [];
      const sentinelSize = is64 ? 25 : 13;
      while (offset < endOffset) {
        if (offset + sentinelSize === endOffset) {
          offset = endOffset;
          break;
        }
        const child = await readNode();
        if (!child) break;
        children.push(child);
      }
      offset = endOffset;
      return { name, props, children };
    }

    const rootChildren = [];
    while (offset < arrayBuffer.byteLength - 25) {
      const node = await readNode();
      if (!node) break;
      rootChildren.push(node);
    }

    function findChild(node, name) {
      if (!node || !node.children) return null;
      return node.children.find(c => c.name === name) || null;
    }

    const objectsNode = rootChildren.find(n => n.name === 'Objects');
    const connectionsNode = rootChildren.find(n => n.name === 'Connections');
    const geometries = new Map();
    const materials = new Map();
    const textures = new Map();
    const videos = new Map();
    const models = new Map();
    const skinDeformers = new Map();    // skinId -> { geomId, clusterIds: [] }
    const clusterDeformers = new Map(); // clusterId -> { boneId, indexes, weights, transform, transformLink }
    const animStacks = new Map();       // stackId -> { id, name, startSec, stopSec, layerIds: [] }
    const animLayers = new Map();       // layerId -> { id, curveNodeIds: [] }
    const animCurveNodes = new Map();   // cnId -> { id, attr, modelId, propName, curves: { x, y, z } }
    const animCurves = new Map();       // curveId -> { times: Float32Array, values: Float32Array }

    const FBX_TIME_UNIT = 46186158000;

    function readProp70Vec3(p70, targetName, defVal) {
      if (!p70 || !p70.children) return defVal;
      for (const p of p70.children) {
        if (p.props[0] === targetName && p.props.length >= 7) {
          return [Number(p.props[4]) || 0, Number(p.props[5]) || 0, Number(p.props[6]) || 0];
        }
      }
      return defVal;
    }

    if (objectsNode) {
      for (const ch of objectsNode.children) {
        const id = ch.props[0];
        const rawName = typeof ch.props[1] === 'string' ? ch.props[1].split('\x00')[0] : '';
        if (ch.name === 'Geometry') {
          const vertsNode = findChild(ch, 'Vertices');
          const polyNode = findChild(ch, 'PolygonVertexIndex');
          if (!vertsNode || !polyNode) continue;
          const normLayer = findChild(ch, 'LayerElementNormal');
          const uvLayer = findChild(ch, 'LayerElementUV');
          const matLayer = findChild(ch, 'LayerElementMaterial');
          geometries.set(id, {
            id,
            name: rawName || 'Mesh',
            vertices: vertsNode.props[0],
            indices: polyNode.props[0],
            normals: normLayer && findChild(normLayer, 'Normals') ? findChild(normLayer, 'Normals').props[0] : null,
            normalRef: normLayer && findChild(normLayer, 'ReferenceInformationType') ? findChild(normLayer, 'ReferenceInformationType').props[0] : 'Direct',
            normalMap: normLayer && findChild(normLayer, 'MappingInformationType') ? findChild(normLayer, 'MappingInformationType').props[0] : 'ByPolygonVertex',
            normalIdx: normLayer && findChild(normLayer, 'NormalsIndex') ? findChild(normLayer, 'NormalsIndex').props[0] : null,
            uvs: uvLayer && findChild(uvLayer, 'UV') ? findChild(uvLayer, 'UV').props[0] : null,
            uvIdx: uvLayer && findChild(uvLayer, 'UVIndex') ? findChild(uvLayer, 'UVIndex').props[0] : null,
            matIndices: matLayer && findChild(matLayer, 'Materials') ? findChild(matLayer, 'Materials').props[0] : null,
            matMapping: matLayer && findChild(matLayer, 'MappingInformationType') ? findChild(matLayer, 'MappingInformationType').props[0] : 'AllSame'
          });
        } else if (ch.name === 'Material') {
          const mat = { id, name: rawName || ('Material_' + id), kd: [0.85, 0.85, 0.85], ks: [0.25, 0.25, 0.25], ns: 32, d: 1, mapKd: null, _texId: null, _texPrio: 0 };
          const p70 = findChild(ch, 'Properties70');
          if (p70) {
            for (const p of p70.children) {
              if (p.props[0] === 'DiffuseColor' && p.props.length >= 7) {
                mat.kd = [Number(p.props[4]) || 0.85, Number(p.props[5]) || 0.85, Number(p.props[6]) || 0.85];
              } else if (p.props[0] === 'Shininess' && p.props.length >= 5) {
                mat.ns = Number(p.props[4]) || 32;
              }
            }
          }
          materials.set(id, mat);
        } else if (ch.name === 'Texture') {
          const rel = findChild(ch, 'RelativeFilename') || findChild(ch, 'FileName');
          const fname = rel && typeof rel.props[0] === 'string' ? basenameLower(rel.props[0]) : '';
          textures.set(id, { id, name: rawName, fileName: fname, videoId: null });
        } else if (ch.name === 'Video') {
          const contentNode = findChild(ch, 'Content');
          const rel = findChild(ch, 'RelativeFilename') || findChild(ch, 'Filename') || findChild(ch, 'FileName');
          const fname = rel && typeof rel.props[0] === 'string' ? basenameLower(rel.props[0]) : ('fbx_tex_' + id + '.png');
          videos.set(id, { id, fileName: fname, bytes: contentNode ? contentNode.props[0] : null });
        } else if (ch.name === 'Model') {
          const p70 = findChild(ch, 'Properties70');
          models.set(id, {
            id,
            name: rawName,
            modelType: String(ch.props[2] || ''),
            parentId: 0,
            lclT: readProp70Vec3(p70, 'Lcl Translation', [0, 0, 0]),
            lclR: readProp70Vec3(p70, 'Lcl Rotation', [0, 0, 0]),
            lclS: readProp70Vec3(p70, 'Lcl Scaling', [1, 1, 1]),
            preRot: readProp70Vec3(p70, 'PreRotation', [0, 0, 0]),
            postRot: readProp70Vec3(p70, 'PostRotation', [0, 0, 0]),
            rotPivot: readProp70Vec3(p70, 'RotationPivot', [0, 0, 0]),
            rotOffset: readProp70Vec3(p70, 'RotationOffset', [0, 0, 0]),
            scalePivot: readProp70Vec3(p70, 'ScalingPivot', [0, 0, 0]),
            scaleOffset: readProp70Vec3(p70, 'ScalingOffset', [0, 0, 0]),
            geomIds: [],
            matIds: []
          });
        } else if (ch.name === 'Deformer') {
          const dType = String(ch.props[2] || '');
          if (dType === 'Skin') {
            skinDeformers.set(id, { id, geomId: null, clusterIds: [] });
          } else if (dType === 'Cluster') {
            const idxNode = findChild(ch, 'Indexes');
            const wNode = findChild(ch, 'Weights');
            const tfNode = findChild(ch, 'Transform');
            const tflNode = findChild(ch, 'TransformLink');
            clusterDeformers.set(id, {
              id,
              boneId: null,
              indexes: idxNode ? idxNode.props[0] : null,
              weights: wNode ? wNode.props[0] : null,
              transform: tfNode ? tfNode.props[0] : null,
              transformLink: tflNode ? tflNode.props[0] : null
            });
          }
        } else if (ch.name === 'AnimationStack') {
          const p70 = findChild(ch, 'Properties70');
          let startSec = null, stopSec = null;
          if (p70) {
            for (const p of p70.children) {
              if (p.props[0] === 'LocalStart' && p.props.length >= 5) startSec = Number(p.props[4]) / FBX_TIME_UNIT;
              else if (p.props[0] === 'LocalStop' && p.props.length >= 5) stopSec = Number(p.props[4]) / FBX_TIME_UNIT;
            }
          }
          animStacks.set(id, { id, name: rawName || 'Anim', startSec, stopSec, layerIds: [] });
        } else if (ch.name === 'AnimationLayer') {
          animLayers.set(id, { id, curveNodeIds: [] });
        } else if (ch.name === 'AnimationCurveNode') {
          const p70 = findChild(ch, 'Properties70');
          const defVec = [0, 0, 0];
          if (p70) {
            for (const p of p70.children) {
              if (p.props[0] === 'd|X') defVec[0] = Number(p.props[4]) || 0;
              else if (p.props[0] === 'd|Y') defVec[1] = Number(p.props[4]) || 0;
              else if (p.props[0] === 'd|Z') defVec[2] = Number(p.props[4]) || 0;
            }
          }
          animCurveNodes.set(id, { id, attr: rawName, defVec, modelId: null, propName: '', curves: { x: null, y: null, z: null } });
        } else if (ch.name === 'AnimationCurve') {
          const ktNode = findChild(ch, 'KeyTime');
          const kvNode = findChild(ch, 'KeyValueFloat');
          if (ktNode && kvNode && ktNode.props[0] && kvNode.props[0]) {
            const rawT = ktNode.props[0];
            const rawV = kvNode.props[0];
            const len = Math.min(rawT.length, rawV.length);
            const times = new Float32Array(len);
            const values = new Float32Array(len);
            for (let k = 0; k < len; k++) {
              times[k] = rawT[k] / FBX_TIME_UNIT;
              values[k] = rawV[k];
            }
            animCurves.set(id, { times, values });
          }
        }
      }
    }

    if (connectionsNode) {
      for (const c of connectionsNode.children) {
        if (c.name !== 'C' || c.props.length < 3) continue;
        const childId = c.props[1];
        const parentId = c.props[2];
        const propName = String(c.props[3] || '');
        if (models.has(parentId) && geometries.has(childId)) {
          models.get(parentId).geomIds.push(childId);
        } else if (models.has(parentId) && materials.has(childId)) {
          models.get(parentId).matIds.push(childId);
        } else if (models.has(parentId) && models.has(childId)) {
          models.get(childId).parentId = parentId;
        } else if (materials.has(parentId) && textures.has(childId)) {
          // Only pick color/diffuse textures; never let NormalMap/Bump/Roughness/Specular overwrite DiffuseColor
          let prio = 0;
          if (/diffusecolor|basecolor|albedo/i.test(propName)) prio = 4;
          else if (/diffuse/i.test(propName)) prio = 3;
          else if (/emissive/i.test(propName)) prio = 2;
          else if (!propName) prio = 1;
          const m = materials.get(parentId);
          if (prio > 0 && prio >= m._texPrio) {
            m._texId = childId;
            m._texPrio = prio;
          }
        } else if (textures.has(parentId) && videos.has(childId)) {
          textures.get(parentId).videoId = childId;
        } else if (geometries.has(parentId) && skinDeformers.has(childId)) {
          skinDeformers.get(childId).geomId = parentId;
        } else if (skinDeformers.has(parentId) && clusterDeformers.has(childId)) {
          skinDeformers.get(parentId).clusterIds.push(childId);
        } else if (clusterDeformers.has(parentId) && models.has(childId)) {
          clusterDeformers.get(parentId).boneId = childId;
        } else if (animStacks.has(parentId) && animLayers.has(childId)) {
          animStacks.get(parentId).layerIds.push(childId);
        } else if (animLayers.has(parentId) && animCurveNodes.has(childId)) {
          animLayers.get(parentId).curveNodeIds.push(childId);
        } else if (models.has(parentId) && animCurveNodes.has(childId)) {
          const cn = animCurveNodes.get(childId);
          cn.modelId = parentId;
          cn.propName = propName;
        } else if (animCurveNodes.has(parentId) && animCurves.has(childId)) {
          const cn = animCurveNodes.get(parentId);
          if (propName === 'd|X') cn.curves.x = childId;
          else if (propName === 'd|Y') cn.curves.y = childId;
          else if (propName === 'd|Z') cn.curves.z = childId;
        }
      }
    }

    const embeddedTextures = {};
    videos.forEach(v => {
      if (v.bytes && v.bytes.length > 16) {
        const mime = (v.bytes[0] === 0xFF && v.bytes[1] === 0xD8) ? 'image/jpeg' : 'image/png';
        let bin = '';
        for (let i = 0; i < v.bytes.length; i++) bin += String.fromCharCode(v.bytes[i]);
        embeddedTextures[v.fileName] = `data:${mime};base64,${btoa(bin)}`;
      }
    });

    const mtlMap = {};
    materials.forEach(mat => {
      if (mat._texId && textures.has(mat._texId)) {
        const tex = textures.get(mat._texId);
        if (tex.videoId && videos.has(tex.videoId)) {
          mat.mapKd = videos.get(tex.videoId).fileName;
        } else if (tex.fileName) {
          mat.mapKd = tex.fileName;
        }
      }
      mtlMap[mat.name] = mat;
    });

    const groupBuckets = new Map();
    function getBucket(name) {
      let b = groupBuckets.get(name);
      if (!b) {
        b = { name, pos: [], norm: [], uv: [], si: [], sw: [] };
        groupBuckets.set(name, b);
      }
      return b;
    }

    // Build topological node list (parents before children)
    const nodes = [];
    const nodeIdxById = new Map();
    const visitedIds = new Set();
    function visitModel(m) {
      if (!m || visitedIds.has(m.id)) return;
      if (m.parentId && models.has(m.parentId)) visitModel(models.get(m.parentId));
      visitedIds.add(m.id);
      const pIdx = (m.parentId && nodeIdxById.has(m.parentId)) ? nodeIdxById.get(m.parentId) : -1;
      nodeIdxById.set(m.id, nodes.length);
      nodes.push({
        id: m.id,
        name: m.name,
        parentIdx: pIdx,
        lclT: m.lclT,
        lclR: m.lclR,
        lclS: m.lclS,
        preRot: m.preRot,
        rotPivot: m.rotPivot,
        scalePivot: m.scalePivot
      });
    }
    models.forEach(m => visitModel(m));

    const bonePairs = []; // { nodeIdx, offset: Float32Array(16) }
    const rigidBoneMap = new Map(); // modelId -> boneIdx
    function getRigidBoneIdx(modelId) {
      if (rigidBoneMap.has(modelId)) return rigidBoneMap.get(modelId);
      const nIdx = nodeIdxById.has(modelId) ? nodeIdxById.get(modelId) : 0;
      const bIdx = bonePairs.length;
      const ident = new Float32Array(16);
      mat4Identity(ident, 0);
      bonePairs.push({ nodeIdx: nIdx, offset: ident });
      rigidBoneMap.set(modelId, bIdx);
      return bIdx;
    }

    // Build per-geometry skinning tables
    const geomSkinTable = new Map(); // geomId -> { cpBones: Uint16Array(cp*4), cpWeights: Float32Array(cp*4) }
    skinDeformers.forEach(skin => {
      if (!skin.geomId || !geometries.has(skin.geomId)) return;
      const g = geometries.get(skin.geomId);
      const cpCount = Math.floor((g.vertices ? g.vertices.length : 0) / 3);
      if (cpCount <= 0) return;
      const cpBones = new Uint16Array(cpCount * 4);
      const cpWeights = new Float32Array(cpCount * 4);

      for (const cid of skin.clusterIds) {
        const cl = clusterDeformers.get(cid);
        if (!cl || !cl.boneId || !nodeIdxById.has(cl.boneId)) continue;
        if (!cl.indexes || !cl.weights) continue;
        const bIdx = bonePairs.length;
        const offset = new Float32Array(16);
        if (cl.transform && cl.transform.length >= 16) {
          // FBX Cluster.Transform already maps geometry-local vertices into bone-local bind space
          offset.set(cl.transform.subarray(0, 16));
        } else if (cl.transformLink && cl.transformLink.length >= 16) {
          mat4Invert(offset, cl.transformLink);
        } else {
          mat4Identity(offset, 0);
        }
        bonePairs.push({ nodeIdx: nodeIdxById.get(cl.boneId), offset });

        const idxs = cl.indexes;
        const wts = cl.weights;
        const len = Math.min(idxs.length, wts.length);
        for (let k = 0; k < len; k++) {
          const vi = idxs[k];
          const w = wts[k];
          if (vi < 0 || vi >= cpCount || w <= 1e-6) continue;
          const v4 = vi * 4;
          // Insert into 4-slot weight list (keep top 4)
          let minJ = 0;
          for (let j = 0; j < 4; j++) {
            if (cpWeights[v4 + j] === 0) { minJ = j; break; }
            if (cpWeights[v4 + j] < cpWeights[v4 + minJ]) minJ = j;
          }
          if (cpWeights[v4 + minJ] < w) {
            cpBones[v4 + minJ] = bIdx;
            cpWeights[v4 + minJ] = w;
          }
        }
      }
      // Normalize weights per vertex
      for (let vi = 0; vi < cpCount; vi++) {
        const v4 = vi * 4;
        const sum = cpWeights[v4] + cpWeights[v4 + 1] + cpWeights[v4 + 2] + cpWeights[v4 + 3];
        if (sum > 1e-6) {
          const inv = 1.0 / sum;
          cpWeights[v4] *= inv; cpWeights[v4 + 1] *= inv; cpWeights[v4 + 2] *= inv; cpWeights[v4 + 3] *= inv;
        }
      }
      geomSkinTable.set(skin.geomId, { cpBones, cpWeights });
    });

    const geomMatList = new Map();
    const geomOwnerModel = new Map();
    models.forEach(m => {
      m.geomIds.forEach(gid => {
        geomMatList.set(gid, m.matIds.map(mid => materials.get(mid)).filter(Boolean));
        if (!geomOwnerModel.has(gid)) geomOwnerModel.set(gid, m.id);
      });
    });

    geometries.forEach(g => {
      const verts = g.vertices;
      const polyIdx = g.indices;
      if (!verts || !polyIdx) return;
      const gMats = geomMatList.get(g.id) || [];
      const skinData = geomSkinTable.get(g.id) || null;
      const ownerId = geomOwnerModel.get(g.id);
      const rigidIdx = ownerId ? getRigidBoneIdx(ownerId) : 0;
      let polyVerts = [];
      let polyIndex = 0;

      for (let i = 0; i < polyIdx.length; i++) {
        let vi = polyIdx[i];
        const isEnd = vi < 0;
        if (isEnd) vi = ~vi;
        polyVerts.push({ vi, pvi: i });

        if (isEnd) {
          if (polyVerts.length >= 3) {
            let matSlotIdx = 0;
            if (g.matIndices && g.matIndices.length > 0) {
              matSlotIdx = (g.matMapping === 'ByPolygon' && polyIndex < g.matIndices.length) ? g.matIndices[polyIndex] : g.matIndices[0];
            }
            const matObj = gMats[matSlotIdx] || gMats[0];
            const bucket = getBucket(matObj ? matObj.name : (g.name || 'Default'));

            for (let k = 1; k + 1 < polyVerts.length; k++) {
              const tri = [polyVerts[0], polyVerts[k], polyVerts[k + 1]];
              const x0 = verts[tri[0].vi * 3] || 0, y0 = verts[tri[0].vi * 3 + 1] || 0, z0 = verts[tri[0].vi * 3 + 2] || 0;
              const x1 = verts[tri[1].vi * 3] || 0, y1 = verts[tri[1].vi * 3 + 1] || 0, z1 = verts[tri[1].vi * 3 + 2] || 0;
              const x2 = verts[tri[2].vi * 3] || 0, y2 = verts[tri[2].vi * 3 + 1] || 0, z2 = verts[tri[2].vi * 3 + 2] || 0;

              let fnx = 0, fny = 0, fnz = 1;
              if (!g.normals) {
                const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0;
                const e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
                fnx = e1y * e2z - e1z * e2y;
                fny = e1z * e2x - e1x * e2z;
                fnz = e1x * e2y - e1y * e2x;
                const len = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz) || 1;
                fnx /= len; fny /= len; fnz /= len;
              }

              for (let c = 0; c < 3; c++) {
                const cpIdx = tri[c].vi;
                const vi3 = cpIdx * 3;
                bucket.pos.push(verts[vi3] || 0, verts[vi3 + 1] || 0, verts[vi3 + 2] || 0);

                if (skinData && (skinData.cpWeights[cpIdx * 4] > 0)) {
                  const cp4 = cpIdx * 4;
                  bucket.si.push(skinData.cpBones[cp4], skinData.cpBones[cp4 + 1], skinData.cpBones[cp4 + 2], skinData.cpBones[cp4 + 3]);
                  bucket.sw.push(skinData.cpWeights[cp4], skinData.cpWeights[cp4 + 1], skinData.cpWeights[cp4 + 2], skinData.cpWeights[cp4 + 3]);
                } else {
                  bucket.si.push(rigidIdx, 0, 0, 0);
                  bucket.sw.push(1, 0, 0, 0);
                }

                if (g.normals) {
                  let ni = (g.normalMap === 'ByVertice' || g.normalMap === 'ByVertex') ? tri[c].vi : tri[c].pvi;
                  if (g.normalIdx && g.normalIdx.length > ni) ni = g.normalIdx[ni];
                  const ni3 = ni * 3;
                  if (ni3 + 2 < g.normals.length) {
                    bucket.norm.push(g.normals[ni3], g.normals[ni3 + 1], g.normals[ni3 + 2]);
                  } else {
                    bucket.norm.push(fnx, fny, fnz);
                  }
                } else {
                  bucket.norm.push(fnx, fny, fnz);
                }

                if (g.uvs) {
                  let ui = tri[c].pvi;
                  if (g.uvIdx && g.uvIdx.length > ui) ui = g.uvIdx[ui];
                  const ui2 = ui * 2;
                  if (ui2 + 1 < g.uvs.length) {
                    bucket.uv.push(g.uvs[ui2], 1.0 - g.uvs[ui2 + 1]);
                  } else {
                    bucket.uv.push(0, 0);
                  }
                } else {
                  bucket.uv.push(0, 0);
                }
              }
            }
          }
          polyVerts = [];
          polyIndex++;
        }
      }
    });

    // Build Animation Clips (shift keyframe times relative to each stack's start)
    const animations = [];
    animStacks.forEach(st => {
      const tracksByKey = new Map();
      let minT = Infinity, maxT = -Infinity;
      for (const lid of st.layerIds) {
        const lay = animLayers.get(lid);
        if (!lay) continue;
        for (const cnId of lay.curveNodeIds) {
          const cn = animCurveNodes.get(cnId);
          if (!cn || !cn.modelId || !nodeIdxById.has(cn.modelId)) continue;
          let prop = '';
          if (cn.propName === 'Lcl Translation') prop = 'T';
          else if (cn.propName === 'Lcl Rotation') prop = 'R';
          else if (cn.propName === 'Lcl Scaling') prop = 'S';
          else continue;
          const cx = cn.curves.x ? animCurves.get(cn.curves.x) : null;
          const cy = cn.curves.y ? animCurves.get(cn.curves.y) : null;
          const cz = cn.curves.z ? animCurves.get(cn.curves.z) : null;
          if (!cx && !cy && !cz) continue;
          [cx, cy, cz].forEach(cv => {
            if (cv && cv.times.length > 0) {
              if (cv.times[0] < minT) minT = cv.times[0];
              if (cv.times[cv.times.length - 1] > maxT) maxT = cv.times[cv.times.length - 1];
            }
          });
          tracksByKey.set(cn.modelId + ':' + prop, { nodeIdx: nodeIdxById.get(cn.modelId), prop, cx, cy, cz });
        }
      }
      if (tracksByKey.size === 0) return;
      const t0 = (st.startSec !== null && isFinite(st.startSec)) ? st.startSec : (isFinite(minT) ? minT : 0);
      const t1 = (st.stopSec !== null && isFinite(st.stopSec) && st.stopSec > t0) ? st.stopSec : (isFinite(maxT) ? maxT : t0 + 1);
      const duration = Math.max(0.05, t1 - t0);
      const tracks = [];
      tracksByKey.forEach(tr => {
        const shiftCurve = (cv) => {
          if (!cv || !cv.times.length) return null;
          const times = new Float32Array(cv.times.length);
          for (let k = 0; k < times.length; k++) times[k] = cv.times[k] - t0;
          return { times, values: cv.values };
        };
        tracks.push({
          nodeIdx: tr.nodeIdx,
          prop: tr.prop,
          cx: shiftCurve(tr.cx),
          cy: shiftCurve(tr.cy),
          cz: shiftCurve(tr.cz)
        });
      });
      animations.push({ name: st.name || ('Anim ' + (animations.length + 1)), duration, tracks });
    });

    const bundle = finalizeBucketsToBundle(groupBuckets, mtlMap);
    bundle._embeddedTextures = embeddedTextures;

    // Attach Rig + Bind-Pose Normalization when nodes/bones/animations are present
    if (nodes.length > 0 && bonePairs.length > 0 && bundle.vertexCount > 0) {
      const vCount = bundle.vertexCount;
      const basePositions = new Float32Array(vCount * 3);
      const baseNormals = new Float32Array(vCount * 3);
      const skinIndices = new Uint16Array(vCount * 4);
      const skinWeights = new Float32Array(vCount * 4);
      let vOff = 0;
      groupBuckets.forEach(b => {
        const cnt = b.pos.length / 3;
        if (cnt === 0) return;
        basePositions.set(b.pos, vOff * 3);
        baseNormals.set(b.norm, vOff * 3);
        skinIndices.set(b.si, vOff * 4);
        skinWeights.set(b.sw, vOff * 4);
        vOff += cnt;
      });

      const boneNodeIdx = new Uint16Array(bonePairs.length);
      const boneOffsets = new Float32Array(bonePairs.length * 16);
      for (let b = 0; b < bonePairs.length; b++) {
        boneNodeIdx[b] = bonePairs[b].nodeIdx;
        boneOffsets.set(bonePairs[b].offset, b * 16);
      }

      const rig = { nodes, boneNodeIdx, boneOffsets, cx: 0, cy: 0, cz: 0, invScale: 1 };
      bundle.basePositions = basePositions;
      bundle.baseNormals = baseNormals;
      bundle.skinIndices = skinIndices;
      bundle.skinWeights = skinWeights;
      bundle.rig = rig;
      bundle.animations = animations;

      // Evaluate pose at t=0 (first clip if animated, or rest pose) to compute accurate normalization bounds
      evaluateBundlePose(bundle, animations.length > 0 ? 0 : -1, 0);
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      const pos = bundle.positions;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      rig.cx = (minX + maxX) * 0.5;
      rig.cy = -(minY + maxY) * 0.5; // undo Y-flip from initial pass
      rig.cz = (minZ + maxZ) * 0.5;
      rig.invScale = 1.0 / Math.max(1e-5, maxX - minX, maxY - minY, maxZ - minZ);
      evaluateBundlePose(bundle, animations.length > 0 ? 0 : -1, 0);
    }

    return bundle;
  }

  function parseAsciiFBX(text) {
    const groupBuckets = new Map();
    const bucket = { name: 'Default', pos: [], norm: [], uv: [] };
    groupBuckets.set('Default', bucket);

    const vMatch = text.match(/Vertices:\s*\*\d+\s*\{\s*a:\s*([\s\S]*?)\}/);
    const pMatch = text.match(/PolygonVertexIndex:\s*\*\d+\s*\{\s*a:\s*([\s\S]*?)\}/);
    if (!vMatch || !pMatch) return finalizeBucketsToBundle(groupBuckets, {});

    const verts = vMatch[1].split(',').map(Number);
    const polyIdx = pMatch[1].split(',').map(Number);
    const uvMatch = text.match(/UV:\s*\*\d+\s*\{\s*a:\s*([\s\S]*?)\}/);
    const uvIdxMatch = text.match(/UVIndex:\s*\*\d+\s*\{\s*a:\s*([\s\S]*?)\}/);
    const uvs = uvMatch ? uvMatch[1].split(',').map(Number) : null;
    const uvIdx = uvIdxMatch ? uvIdxMatch[1].split(',').map(Number) : null;

    let polyVerts = [];
    for (let i = 0; i < polyIdx.length; i++) {
      let vi = polyIdx[i];
      const isEnd = vi < 0;
      if (isEnd) vi = ~vi;
      polyVerts.push({ vi, pvi: i });
      if (isEnd) {
        if (polyVerts.length >= 3) {
          for (let k = 1; k + 1 < polyVerts.length; k++) {
            const tri = [polyVerts[0], polyVerts[k], polyVerts[k + 1]];
            const x0 = verts[tri[0].vi * 3] || 0, y0 = verts[tri[0].vi * 3 + 1] || 0, z0 = verts[tri[0].vi * 3 + 2] || 0;
            const x1 = verts[tri[1].vi * 3] || 0, y1 = verts[tri[1].vi * 3 + 1] || 0, z1 = verts[tri[1].vi * 3 + 2] || 0;
            const x2 = verts[tri[2].vi * 3] || 0, y2 = verts[tri[2].vi * 3 + 1] || 0, z2 = verts[tri[2].vi * 3 + 2] || 0;
            const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0;
            const e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
            let fnx = e1y * e2z - e1z * e2y;
            let fny = e1z * e2x - e1x * e2z;
            let fnz = e1x * e2y - e1y * e2x;
            const len = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz) || 1;
            fnx /= len; fny /= len; fnz /= len;

            for (let c = 0; c < 3; c++) {
              const vi3 = tri[c].vi * 3;
              bucket.pos.push(verts[vi3] || 0, verts[vi3 + 1] || 0, verts[vi3 + 2] || 0);
              bucket.norm.push(fnx, fny, fnz);
              if (uvs) {
                let ui = tri[c].pvi;
                if (uvIdx && uvIdx.length > ui) ui = uvIdx[ui];
                bucket.uv.push(uvs[ui * 2] || 0, 1.0 - (uvs[ui * 2 + 1] || 0));
              } else {
                bucket.uv.push(0, 0);
              }
            }
          }
        }
        polyVerts = [];
      }
    }
    return finalizeBucketsToBundle(groupBuckets, {});
  }

  async function parseFBX(arrayBuffer) {
    const header = new TextDecoder('ascii').decode(new Uint8Array(arrayBuffer, 0, Math.min(23, arrayBuffer.byteLength)));
    if (header.startsWith('Kaydara FBX Binary')) {
      return await parseBinaryFBX(arrayBuffer);
    }
    const text = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer));
    return parseAsciiFBX(text);
  }

  // =========================================================================
  // 3b. BINARY glTF 2.0 (.GLB) PARSER (Zero-Dependency Vanilla JS)
  // =========================================================================
  function uint8ToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
      binary += String.fromCharCode.apply(null, slice);
    }
    if (typeof btoa === 'function') return btoa(binary);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    return '';
  }

  function parseGLB(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 20) {
      throw new Error('Invalid GLB file: too small.');
    }
    const dv = new DataView(arrayBuffer);
    const magic = dv.getUint32(0, true);
    if (magic !== 0x46546C67) { // "glTF"
      throw new Error('Invalid GLB header (expected glTF binary).');
    }
    const version = dv.getUint32(4, true);
    if (version !== 2) {
      throw new Error(`Unsupported glTF version: ${version} (expected glTF 2.0).`);
    }

    let jsonObj = null;
    let binChunk = null;
    let offset = 12;
    const totalLen = Math.min(arrayBuffer.byteLength, dv.getUint32(8, true));

    while (offset + 8 <= totalLen) {
      const chunkLen = dv.getUint32(offset, true);
      const chunkType = dv.getUint32(offset + 4, true);
      offset += 8;
      if (offset + chunkLen > arrayBuffer.byteLength) break;
      if (chunkType === 0x4E4F534A && !jsonObj) { // JSON
        const jsonBytes = new Uint8Array(arrayBuffer, offset, chunkLen);
        jsonObj = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes));
      } else if (chunkType === 0x004E4942 && !binChunk) { // BIN
        binChunk = new Uint8Array(arrayBuffer, offset, chunkLen);
      }
      offset += chunkLen;
    }

    if (!jsonObj) {
      throw new Error('Invalid GLB: missing JSON chunk.');
    }
    if (Array.isArray(jsonObj.extensionsRequired) && jsonObj.extensionsRequired.includes('KHR_draco_mesh_compression')) {
      throw new Error('GLB uses Draco mesh compression (KHR_draco_mesh_compression) — re-export without Draco compression.');
    }

    const accessors = Array.isArray(jsonObj.accessors) ? jsonObj.accessors : [];
    const bufferViews = Array.isArray(jsonObj.bufferViews) ? jsonObj.bufferViews : [];
    const meshes = Array.isArray(jsonObj.meshes) ? jsonObj.meshes : [];
    const nodes = Array.isArray(jsonObj.nodes) ? jsonObj.nodes : [];
    const materials = Array.isArray(jsonObj.materials) ? jsonObj.materials : [];
    const textures = Array.isArray(jsonObj.textures) ? jsonObj.textures : [];
    const images = Array.isArray(jsonObj.images) ? jsonObj.images : [];

    const TYPE_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
    const COMP_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

    function readComponent(view, bytePos, compType, normalized) {
      switch (compType) {
        case 5126: return view.getFloat32(bytePos, true);
        case 5125: return view.getUint32(bytePos, true);
        case 5123: {
          const v = view.getUint16(bytePos, true);
          return normalized ? (v / 65535) : v;
        }
        case 5122: {
          const v = view.getInt16(bytePos, true);
          return normalized ? Math.max(-1, v / 32767) : v;
        }
        case 5121: {
          const v = view.getUint8(bytePos);
          return normalized ? (v / 255) : v;
        }
        case 5120: {
          const v = view.getInt8(bytePos);
          return normalized ? Math.max(-1, v / 127) : v;
        }
        default: return 0;
      }
    }

    function readGlbAccessor(accIdx) {
      if (accIdx === undefined || accIdx === null || !accessors[accIdx]) return null;
      const acc = accessors[accIdx];
      const numComps = TYPE_COUNTS[acc.type] || 1;
      const compType = acc.componentType;
      const compSize = COMP_BYTES[compType] || 4;
      const count = acc.count || 0;
      const normalized = Boolean(acc.normalized);
      const out = (compType === 5125 || compType === 5123 || compType === 5121) && !normalized && numComps === 1
        ? new Uint32Array(count)
        : new Float32Array(count * numComps);

      if (acc.bufferView !== undefined && bufferViews[acc.bufferView] && binChunk) {
        const bv = bufferViews[acc.bufferView];
        const baseOff = (bv.byteOffset || 0) + (acc.byteOffset || 0);
        const stride = bv.byteStride || (numComps * compSize);
        const view = new DataView(binChunk.buffer, binChunk.byteOffset, binChunk.byteLength);
        for (let i = 0; i < count; i++) {
          const elemOff = baseOff + i * stride;
          for (let c = 0; c < numComps; c++) {
            const p = elemOff + c * compSize;
            if (p + compSize <= binChunk.byteLength) {
              out[i * numComps + c] = readComponent(view, p, compType, normalized);
            }
          }
        }
      }
      return { data: out, count, numComps };
    }

    // Extract embedded images -> textureMap keys
    const embeddedTextures = {};
    const imageKeyByIdx = new Map();
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img) continue;
      const texKey = `glb_img_${i}`;
      if (typeof img.uri === 'string' && img.uri.startsWith('data:')) {
        embeddedTextures[texKey] = img.uri;
        imageKeyByIdx.set(i, texKey);
      } else if (img.bufferView !== undefined && bufferViews[img.bufferView] && binChunk) {
        const bv = bufferViews[img.bufferView];
        const bOff = bv.byteOffset || 0;
        const bLen = bv.byteLength || 0;
        if (bLen > 0 && bOff + bLen <= binChunk.byteLength) {
          const bytes = binChunk.subarray(bOff, bOff + bLen);
          const mime = img.mimeType || 'image/png';
          const b64 = uint8ToBase64(bytes);
          if (b64) {
            embeddedTextures[texKey] = `data:${mime};base64,${b64}`;
            imageKeyByIdx.set(i, texKey);
          }
        }
      } else if (typeof img.uri === 'string') {
        imageKeyByIdx.set(i, basenameLower(img.uri));
      }
    }

    // Build mtlMap from glTF PBR materials
    const mtlMap = {};
    const matNames = [];
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i] || {};
      const mName = (m.name && String(m.name).trim()) ? String(m.name).trim() : `Material_${i + 1}`;
      const uniqueName = mtlMap[mName] ? `${mName}_${i + 1}` : mName;
      matNames[i] = uniqueName;
      const pbr = m.pbrMetallicRoughness || {};
      const bcf = Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor : [0.85, 0.85, 0.85, 1];
      const metallicF = (typeof pbr.metallicFactor === 'number') ? Math.max(0, Math.min(1, pbr.metallicFactor)) : 0;
      const roughF = (typeof pbr.roughnessFactor === 'number') ? Math.max(0, Math.min(1, pbr.roughnessFactor)) : 0.55;
      let mapKd = null;
      if (pbr.baseColorTexture && pbr.baseColorTexture.index !== undefined) {
        const texDef = textures[pbr.baseColorTexture.index];
        if (texDef && texDef.source !== undefined && imageKeyByIdx.has(texDef.source)) {
          mapKd = imageKeyByIdx.get(texDef.source);
        }
      }
      mtlMap[uniqueName] = {
        kd: [bcf[0], bcf[1], bcf[2]],
        ns: Math.round((1 - roughF) * 200),
        metallic: Math.round(metallicF * 100),
        roughness: Math.max(5, Math.min(98, Math.round(roughF * 100))),
        mapKd
      };
    }

    // Compute local mat4 for a glTF node (column-major, matching mat4Mul convention)
    function computeGlbNodeLocal(node) {
      const m = new Float32Array(16);
      if (Array.isArray(node.matrix) && node.matrix.length === 16) {
        for (let i = 0; i < 16; i++) m[i] = node.matrix[i];
        return m;
      }
      const t = Array.isArray(node.translation) ? node.translation : [0, 0, 0];
      const r = Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1];
      const sc = Array.isArray(node.scale) ? node.scale : [1, 1, 1];
      mat4FromQuat(m, r[0], r[1], r[2], r[3]);
      m[0] *= sc[0]; m[1] *= sc[0]; m[2] *= sc[0];
      m[4] *= sc[1]; m[5] *= sc[1]; m[6] *= sc[1];
      m[8] *= sc[2]; m[9] *= sc[2]; m[10] *= sc[2];
      m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
      return m;
    }

    const groupBuckets = new Map();
    function getBucket(name) {
      const key = name || 'Default';
      let b = groupBuckets.get(key);
      if (!b) {
        b = { name: key, pos: [], norm: [], uv: [] };
        groupBuckets.set(key, b);
      }
      return b;
    }

    function appendPrimitive(prim, worldMat) {
      if (!prim || !prim.attributes || prim.attributes.POSITION === undefined) return;
      const mode = prim.mode !== undefined ? prim.mode : 4;
      if (mode !== 4 && mode !== 5 && mode !== 6) return;

      const posAcc = readGlbAccessor(prim.attributes.POSITION);
      if (!posAcc || posAcc.count === 0) return;
      const normAcc = (prim.attributes.NORMAL !== undefined) ? readGlbAccessor(prim.attributes.NORMAL) : null;
      const uvAcc = (prim.attributes.TEXCOORD_0 !== undefined) ? readGlbAccessor(prim.attributes.TEXCOORD_0) : null;
      const idxAcc = (prim.indices !== undefined) ? readGlbAccessor(prim.indices) : null;

      const matName = (prim.material !== undefined && matNames[prim.material]) ? matNames[prim.material] : 'Default';
      const bucket = getBucket(matName);

      const invWorld = new Float32Array(16);
      const hasInv = mat4Invert(invWorld, worldMat);

      const transformPos = (vIdx, out3) => {
        const x = posAcc.data[vIdx * 3];
        const y = posAcc.data[vIdx * 3 + 1];
        const z = posAcc.data[vIdx * 3 + 2];
        out3[0] = worldMat[0] * x + worldMat[4] * y + worldMat[8] * z + worldMat[12];
        out3[1] = worldMat[1] * x + worldMat[5] * y + worldMat[9] * z + worldMat[13];
        out3[2] = worldMat[2] * x + worldMat[6] * y + worldMat[10] * z + worldMat[14];
      };

      const transformNorm = (vIdx, out3) => {
        if (!normAcc) return false;
        const x = normAcc.data[vIdx * 3];
        const y = normAcc.data[vIdx * 3 + 1];
        const z = normAcc.data[vIdx * 3 + 2];
        let nx, ny, nz;
        if (hasInv) {
          nx = invWorld[0] * x + invWorld[1] * y + invWorld[2] * z;
          ny = invWorld[4] * x + invWorld[5] * y + invWorld[6] * z;
          nz = invWorld[8] * x + invWorld[9] * y + invWorld[10] * z;
        } else {
          nx = worldMat[0] * x + worldMat[4] * y + worldMat[8] * z;
          ny = worldMat[1] * x + worldMat[5] * y + worldMat[9] * z;
          nz = worldMat[2] * x + worldMat[6] * y + worldMat[10] * z;
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        out3[0] = nx / len; out3[1] = ny / len; out3[2] = nz / len;
        return true;
      };

      const p0 = [0, 0, 0], p1 = [0, 0, 0], p2 = [0, 0, 0];
      const n0 = [0, 0, 0], n1 = [0, 0, 0], n2 = [0, 0, 0];

      const pushTri = (i0, i1, i2) => {
        if (i0 >= posAcc.count || i1 >= posAcc.count || i2 >= posAcc.count) return;
        transformPos(i0, p0);
        transformPos(i1, p1);
        transformPos(i2, p2);

        const hasN0 = transformNorm(i0, n0);
        const hasN1 = transformNorm(i1, n1);
        const hasN2 = transformNorm(i2, n2);
        if (!hasN0 || !hasN1 || !hasN2) {
          const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2];
          const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
          let fnx = e1y * e2z - e1z * e2y;
          let fny = e1z * e2x - e1x * e2z;
          let fnz = e1x * e2y - e1y * e2x;
          const fl = Math.hypot(fnx, fny, fnz) || 1;
          fnx /= fl; fny /= fl; fnz /= fl;
          n0[0] = n1[0] = n2[0] = fnx;
          n0[1] = n1[1] = n2[1] = fny;
          n0[2] = n1[2] = n2[2] = fnz;
        }

        bucket.pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
        bucket.norm.push(n0[0], n0[1], n0[2], n1[0], n1[1], n1[2], n2[0], n2[1], n2[2]);

        const triIdx = [i0, i1, i2];
        for (let k = 0; k < 3; k++) {
          const vi = triIdx[k];
          if (uvAcc && vi < uvAcc.count) {
            bucket.uv.push(uvAcc.data[vi * 2], uvAcc.data[vi * 2 + 1]);
          } else {
            bucket.uv.push(0, 0);
          }
        }
      };

      const indexCount = idxAcc ? idxAcc.count : posAcc.count;
      const getIndex = idxAcc ? (k) => idxAcc.data[k] : (k) => k;

      if (mode === 4) {
        for (let k = 0; k + 2 < indexCount; k += 3) {
          pushTri(getIndex(k), getIndex(k + 1), getIndex(k + 2));
        }
      } else if (mode === 5) {
        for (let k = 0; k + 2 < indexCount; k++) {
          const a = getIndex(k), b = getIndex(k + 1), c = getIndex(k + 2);
          if (k % 2 === 0) pushTri(a, b, c);
          else pushTri(b, a, c);
        }
      } else if (mode === 6) {
        const root = getIndex(0);
        for (let k = 1; k + 1 < indexCount; k++) {
          pushTri(root, getIndex(k), getIndex(k + 1));
        }
      }
    }

    function visitNode(nodeIdx, parentWorld) {
      const node = nodes[nodeIdx];
      if (!node) return;
      const localMat = computeGlbNodeLocal(node);
      const worldMat = new Float32Array(16);
      mat4Mul(worldMat, 0, parentWorld, 0, localMat, 0);

      if (node.mesh !== undefined && meshes[node.mesh]) {
        const mesh = meshes[node.mesh];
        const prims = Array.isArray(mesh.primitives) ? mesh.primitives : [];
        for (let p = 0; p < prims.length; p++) {
          appendPrimitive(prims[p], worldMat);
        }
      }
      if (Array.isArray(node.children)) {
        for (let c = 0; c < node.children.length; c++) {
          visitNode(node.children[c], worldMat);
        }
      }
    }

    const identity = new Float32Array(16);
    mat4Identity(identity, 0);
    const activeScene = (Array.isArray(jsonObj.scenes) && jsonObj.scenes.length > 0)
      ? jsonObj.scenes[jsonObj.scene || 0]
      : null;

    if (activeScene && Array.isArray(activeScene.nodes) && activeScene.nodes.length > 0) {
      for (let i = 0; i < activeScene.nodes.length; i++) {
        visitNode(activeScene.nodes[i], identity);
      }
    } else if (nodes.length > 0) {
      const childSet = new Set();
      nodes.forEach(n => { if (n && Array.isArray(n.children)) n.children.forEach(c => childSet.add(c)); });
      for (let i = 0; i < nodes.length; i++) {
        if (!childSet.has(i)) visitNode(i, identity);
      }
    } else {
      for (let m = 0; m < meshes.length; m++) {
        const prims = (meshes[m] && Array.isArray(meshes[m].primitives)) ? meshes[m].primitives : [];
        for (let p = 0; p < prims.length; p++) appendPrimitive(prims[p], identity);
      }
    }

    const bundle = finalizeBucketsToBundle(groupBuckets, mtlMap);
    bundle._embeddedTextures = embeddedTextures;
    return bundle;
  }

  // =========================================================================
  // 4. NORMALIZATION & BUNDLE PACKAGING (Center + Unit Scale + Y-down)
  // =========================================================================
  function finalizeBucketsToBundle(groupBuckets, mtlMap) {
    let totalVerts = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    groupBuckets.forEach(b => {
      const n = b.pos.length / 3;
      totalVerts += n;
      for (let i = 0; i < b.pos.length; i += 3) {
        const x = b.pos[i], y = b.pos[i + 1], z = b.pos[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    });

    if (totalVerts === 0) {
      return { positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), groups: [], mtlDefs: [] };
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const spanX = Math.max(1e-5, maxX - minX);
    const spanY = Math.max(1e-5, maxY - minY);
    const spanZ = Math.max(1e-5, maxZ - minZ);
    const maxSpan = Math.max(spanX, spanY, spanZ);
    const invScale = 1.0 / maxSpan;

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const groups = [];
    const mtlDefs = [];

    let vOffset = 0;
    groupBuckets.forEach(b => {
      const count = b.pos.length / 3;
      if (count === 0) return;

      for (let i = 0; i < count; i++) {
        const dst3 = (vOffset + i) * 3;
        const dst2 = (vOffset + i) * 2;
        const src3 = i * 3;
        const src2 = i * 2;

        // Convert Y-up -> Canvas Y-down and normalize to [-0.5, 0.5]
        positions[dst3] = (b.pos[src3] - cx) * invScale;
        positions[dst3 + 1] = -(b.pos[src3 + 1] - cy) * invScale;
        positions[dst3 + 2] = (b.pos[src3 + 2] - cz) * invScale;

        normals[dst3] = b.norm[src3];
        normals[dst3 + 1] = -b.norm[src3 + 1];
        normals[dst3 + 2] = b.norm[src3 + 2];

        uvs[dst2] = b.uv[src2];
        uvs[dst2 + 1] = b.uv[src2 + 1];
      }

      const mtl = mtlMap[b.name] || null;
      const slotIdx = groups.length;
      groups.push({ name: b.name, offset: vOffset, count, slotIndex: slotIdx });
      mtlDefs.push({
        name: b.name,
        color: mtl ? rgbFloatToHex(mtl.kd[0], mtl.kd[1], mtl.kd[2]) : '#cccccc',
        mapKd: mtl ? mtl.mapKd : null,
        glossy: mtl && mtl.ns > 40 ? Math.min(80, Math.round(mtl.ns / 3.5)) : 0,
        metallic: (mtl && typeof mtl.metallic === 'number') ? mtl.metallic : 0,
        roughness: (mtl && typeof mtl.roughness === 'number')
          ? mtl.roughness
          : (mtl && mtl.ns > 0 ? Math.max(10, Math.min(95, Math.round(100 - Math.min(90, mtl.ns * 0.35)))) : 55)
      });

      vOffset += count;
    });

    return {
      positions,
      normals,
      uvs,
      groups,
      mtlDefs,
      vertexCount: totalVerts,
      triangleCount: Math.floor(totalVerts / 3)
    };
  }

  // =========================================================================
  // 5. FILE / ZIP IMPORT ORCHESTRATOR
  // =========================================================================
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsArrayBuffer(file);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) throw new Error('No files selected');

    let objText = null;
    let objName = '';
    let mtlText = '';
    let fbxBuf = null;
    let fbxName = '';
    let glbBuf = null;
    let glbName = '';
    const textureMap = {}; // lowercase basename -> dataUrl

    for (const file of files) {
      const lower = (file.name || '').toLowerCase();
      if (lower.endsWith('.zip')) {
        if (!global.JSZip) throw new Error('JSZip is not loaded');
        const zipBuf = await readFileAsArrayBuffer(file);
        const zip = await global.JSZip.loadAsync(zipBuf);
        const entries = Object.values(zip.files);
        for (const entry of entries) {
          if (entry.dir) continue;
          const base = basenameLower(entry.name);
          if (base.startsWith('.') || entry.name.includes('__MACOSX')) continue;
          if (base.endsWith('.obj') && !objText) {
            objText = await entry.async('string');
            objName = entry.name.replace(/^.*\//, '').replace(/\.obj$/i, '');
          } else if (base.endsWith('.mtl')) {
            mtlText += '\n' + (await entry.async('string'));
          } else if (base.endsWith('.fbx') && !fbxBuf) {
            fbxBuf = await entry.async('arraybuffer');
            fbxName = entry.name.replace(/^.*\//, '').replace(/\.fbx$/i, '');
          } else if (base.endsWith('.glb') && !glbBuf) {
            glbBuf = await entry.async('arraybuffer');
            glbName = entry.name.replace(/^.*\//, '').replace(/\.glb$/i, '');
          } else if (/\.(png|jpe?g|webp|bmp|gif)$/i.test(base)) {
            const ext = base.split('.').pop();
            const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
            const b64 = await entry.async('base64');
            textureMap[base] = `data:${mime};base64,${b64}`;
          }
        }
        if (!objName && !fbxName && !glbName) {
          objName = file.name.replace(/\.zip$/i, '');
        }
      } else if (lower.endsWith('.obj')) {
        objText = await readFileAsText(file);
        objName = file.name.replace(/\.obj$/i, '');
      } else if (lower.endsWith('.mtl')) {
        mtlText += '\n' + (await readFileAsText(file));
      } else if (lower.endsWith('.fbx')) {
        fbxBuf = await readFileAsArrayBuffer(file);
        fbxName = file.name.replace(/\.fbx$/i, '');
      } else if (lower.endsWith('.glb')) {
        glbBuf = await readFileAsArrayBuffer(file);
        glbName = file.name.replace(/\.glb$/i, '');
      } else if (/\.(png|jpe?g|webp|bmp|gif)$/i.test(lower)) {
        textureMap[basenameLower(file.name)] = await readFileAsDataUrl(file);
      }
    }

    let parsed = null;
    let modelName = objName || fbxName || glbName || '3D Model';
    if (objText) {
      const mtlMap = parseMTL(mtlText);
      parsed = parseOBJ(objText, mtlMap);
    } else if (fbxBuf) {
      parsed = await parseFBX(fbxBuf);
      if (parsed._embeddedTextures) {
        Object.assign(textureMap, parsed._embeddedTextures);
      }
    } else if (glbBuf) {
      parsed = parseGLB(glbBuf);
      if (parsed._embeddedTextures) {
        Object.assign(textureMap, parsed._embeddedTextures);
      }
    } else {
      throw new Error('No .obj, .fbx, or .glb file found in the selected files.');
    }

    if (!parsed || parsed.vertexCount === 0) {
      throw new Error('3D file has no valid vertex or triangle data.');
    }

    const modelId = 'mdl3d_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const registeredTextures = {}; // synthetic mediaId -> dataUrl
    const texKeys = Object.keys(textureMap);
    const slots = parsed.mtlDefs.map((def, idx) => {
      let mediaId = null;
      let matchedTexKey = (def.mapKd && textureMap[def.mapKd]) ? def.mapKd : null;
      if (!matchedTexKey && def.name) {
        const cleanMat = def.name.toLowerCase().replace(/[^a-z0-9_]/g, '');
        matchedTexKey = texKeys.find(k => {
          const stem = k.replace(/\.[^.]+$/, '');
          return stem === cleanMat || stem.includes(cleanMat) || (cleanMat.length >= 4 && cleanMat.includes(stem));
        }) || null;
      }
      if (matchedTexKey) {
        mediaId = `mtex_${modelId}_${idx}`;
        registeredTextures[mediaId] = textureMap[matchedTexKey];
      }
      return {
        id: `mat_${idx}`,
        name: def.name || `Material ${idx + 1}`,
        surfaceMode: mediaId ? 'media' : 'solid',
        color: def.color || '#cccccc',
        mediaId: mediaId,
        acceptsLights: true,
        glossy: def.glossy || 0,
        metallic: typeof def.metallic === 'number' ? def.metallic : 0,
        roughness: def.roughness !== undefined ? def.roughness : 55,
        diffuse: 100,
        specular: 50,
        envReflection: 100
      };
    });

    const bundle = {
      id: modelId,
      name: modelName,
      positions: parsed.positions,
      normals: parsed.normals,
      uvs: parsed.uvs,
      groups: parsed.groups,
      slots: slots,
      textures: registeredTextures,
      vertexCount: parsed.vertexCount,
      triangleCount: parsed.triangleCount,
      basePositions: parsed.basePositions || null,
      baseNormals: parsed.baseNormals || null,
      skinIndices: parsed.skinIndices || null,
      skinWeights: parsed.skinWeights || null,
      rig: parsed.rig || null,
      animations: parsed.animations || []
    };

    registerBundle(bundle);
    return bundle;
  }

  function computePositionsBounds(positions) {
    if (!positions || positions.length < 3) {
      return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 };
    }
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    return { minX, maxX, minY, maxY, minZ, maxZ };
  }

  function registerBundle(bundle) {
    if (!bundle || !bundle.id) return;
    if (!bundle.localBounds) {
      bundle.localBounds = computePositionsBounds(bundle.positions);
    }
    _modelCache.set(bundle.id, bundle);
    if (bundle.textures && typeof global.registerMaterialTextureDataUrl === 'function') {
      Object.entries(bundle.textures).forEach(([tid, dataUrl]) => {
        global.registerMaterialTextureDataUrl(tid, dataUrl);
      });
    }
  }

  function getModel(modelId) {
    if (!modelId) return null;
    const cached = _modelCache.get(modelId);
    if (cached) return cached;
    if (!_loadingIds.has(modelId) && global.FishDatabase && typeof global.FishDatabase.getProjectMedia === 'function') {
      _loadingIds.add(modelId);
      const pid = (global.currentProjectState && global.currentProjectState.id) || '';
      global.FishDatabase.getProjectMedia(pid).then(items => {
        const rec = (items || []).find(m => m && m.id === modelId);
        if (rec && rec.modelData) {
          const md = rec.modelData;
          const bundle = {
            id: rec.id,
            name: rec.name || '3D Model',
            positions: md.positions instanceof Float32Array ? md.positions : new Float32Array(md.positions || []),
            normals: md.normals instanceof Float32Array ? md.normals : new Float32Array(md.normals || []),
            uvs: md.uvs instanceof Float32Array ? md.uvs : new Float32Array(md.uvs || []),
            groups: md.groups || [],
            slots: md.slots || [],
            textures: md.textures || {},
            vertexCount: md.vertexCount || 0,
            triangleCount: md.triangleCount || 0,
            basePositions: md.basePositions ? (md.basePositions instanceof Float32Array ? md.basePositions : new Float32Array(md.basePositions)) : null,
            baseNormals: md.baseNormals ? (md.baseNormals instanceof Float32Array ? md.baseNormals : new Float32Array(md.baseNormals)) : null,
            skinIndices: md.skinIndices ? (md.skinIndices instanceof Uint16Array ? md.skinIndices : new Uint16Array(md.skinIndices)) : null,
            skinWeights: md.skinWeights ? (md.skinWeights instanceof Float32Array ? md.skinWeights : new Float32Array(md.skinWeights)) : null,
            rig: md.rig || null,
            animations: md.animations || []
          };
          registerBundle(bundle);
          if (typeof global.redrawComposition === 'function') global.redrawComposition();
        }
        _loadingIds.delete(modelId);
      }).catch(() => {
        _loadingIds.delete(modelId);
      });
    }
    return null;
  }

  // =========================================================================
  // 6. WEBGL STATIC VBO/VAO UPLOAD & ZERO-ALLOC MULTI-MATERIAL DRAW
  // =========================================================================
  function getOrCreateGpuMesh(gl, locations, bundle) {
    let gpu = _gpuMeshCache.get(bundle);
    if (gpu && gpu.gl === gl) return gpu;

    const isAnimated = Boolean(bundle.rig && bundle.animations && bundle.animations.length > 0);
    const drawUsage = isAnimated ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, bundle.positions, drawUsage);

    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, bundle.normals, drawUsage);

    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, bundle.uvs, gl.STATIC_DRAW);

    let vao = null;
    if (typeof gl.createVertexArray === 'function') {
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(locations.position);
      gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
      if (locations.normal !== -1 && locations.normal !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
        gl.enableVertexAttribArray(locations.normal);
        gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.enableVertexAttribArray(locations.texCoord);
      gl.vertexAttribPointer(locations.texCoord, 2, gl.FLOAT, false, 0, 0);
      if (locations.color !== -1 && locations.color !== undefined) {
        gl.disableVertexAttribArray(locations.color);
      }
      gl.bindVertexArray(null);
    }

    gpu = { gl, vao, posBuf, normBuf, uvBuf, groups: bundle.groups };
    _gpuMeshCache.set(bundle, gpu);
    return gpu;
  }

  function draw3DModelMesh(gl, locations, mvp, bounds, layerOpacity, layer, el, modelMatrix, engine) {
    if (!gl || !locations || !mvp || !layer || !layer.modelMediaId) return;
    const bundle = getModel(layer.modelMediaId);
    if (!bundle || !bundle.positions || bundle.positions.length === 0) return;

    const bScale = (bounds && bounds.bufferScale) ? bounds.bufferScale : 1;
    const w = (bounds && bounds.w) ? bounds.w : (400 * bScale);
    const h = (bounds && bounds.h) ? bounds.h : (400 * bScale);
    const lDepth = (layer.scaleZ !== undefined)
      ? (layer.scaleZ * bScale)
      : ((layer.depth !== undefined) ? (layer.depth * bScale) : Math.round(Math.min(w, h)));
    const depth = Math.max(1, lDepth || (400 * bScale));

    const rawOpacity = (layer.opacity !== undefined) ? Number(layer.opacity) : 1.0;
    const normOp = (rawOpacity > 1.0) ? Math.max(0, Math.min(1, rawOpacity / 100)) : Math.max(0, Math.min(1, rawOpacity));
    const finalOpacity = normOp * (layerOpacity !== undefined ? layerOpacity : 1.0);

    scaleMatrixZ(_scratchMvp, mvp, depth);
    gl.uniformMatrix4fv(locations.matrix, false, _scratchMvp);
    if (modelMatrix && locations.modelMatrix) {
      scaleMatrixZ(_scratchModel, modelMatrix, depth);
      gl.uniformMatrix4fv(locations.modelMatrix, false, _scratchModel);
    }

    const gpu = getOrCreateGpuMesh(gl, locations, bundle);

    // Evaluate skeletal/node animation at playhead time when model has FBX animations
    if (bundle.rig && bundle.animations && bundle.animations.length > 0 && bundle.basePositions) {
      const clipIdx = Math.max(0, Math.min(bundle.animations.length - 1, Number(layer.modelAnimIndex) || 0));
      const curSec = (typeof layer._currentSec === 'number')
        ? layer._currentSec
        : ((typeof global._currentRenderSec === 'number') ? global._currentRenderSec : 0);
      const startSec = (typeof layer.startSec === 'number') ? layer.startSec : 0;
      const animSec = Math.max(0, curSec - startSec);
      const animKey = `${clipIdx}:${Math.round(animSec * 120)}`;
      if (gpu._lastAnimKey !== animKey) {
        gpu._lastAnimKey = animKey;
        evaluateBundlePose(bundle, clipIdx, animSec);
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, bundle.positions);
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.normBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, bundle.normals);
      }
    }

    gl.disable(gl.CULL_FACE);

    if (gpu.vao && typeof gl.bindVertexArray === 'function') {
      gl.bindVertexArray(gpu.vao);
    } else {
      gl.disableVertexAttribArray(locations.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
      gl.enableVertexAttribArray(locations.position);
      gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
      if (locations.normal !== -1 && locations.normal !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.normBuf);
        gl.enableVertexAttribArray(locations.normal);
        gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uvBuf);
      gl.enableVertexAttribArray(locations.texCoord);
      gl.vertexAttribPointer(locations.texCoord, 2, gl.FLOAT, false, 0, 0);
    }

    const slots = (Array.isArray(layer.materialSlots) && layer.materialSlots.length > 0) ? layer.materialSlots : bundle.slots;
    for (let i = 0; i < gpu.groups.length; i++) {
      const grp = gpu.groups[i];
      const slot = (slots && (slots[grp.slotIndex] || slots[0])) || null;
      if (engine && typeof engine.applyMaterialSlot === 'function') {
        engine.applyMaterialSlot(gl, layer, slot, el, finalOpacity, _scratchRgb, false);
      } else {
        gl.uniform1i(locations.mode, 1);
        gl.vertexAttrib4f(locations.color, 0.8, 0.8, 0.8, finalOpacity);
      }
      gl.drawArrays(gl.TRIANGLES, grp.offset, grp.count);
    }

    if (gpu.vao && typeof gl.bindVertexArray === 'function') {
      gl.bindVertexArray(null);
    }
  }

  function removeModel(modelId) {
    if (!modelId) return;
    const bundle = _modelCache.get(modelId);
    if (bundle) {
      const gpu = _gpuMeshCache.get(bundle);
      if (gpu && gpu.gl) {
        try {
          if (gpu.posBuf) gpu.gl.deleteBuffer(gpu.posBuf);
          if (gpu.normBuf) gpu.gl.deleteBuffer(gpu.normBuf);
          if (gpu.uvBuf) gpu.gl.deleteBuffer(gpu.uvBuf);
          if (gpu.vao && typeof gpu.gl.deleteVertexArray === 'function') gpu.gl.deleteVertexArray(gpu.vao);
        } catch (_) {}
      }
      _gpuMeshCache.delete(bundle);
    }
    _modelCache.delete(modelId);
    if (typeof window !== 'undefined') window._assetReadyVersion = ((window._assetReadyVersion | 0) + 1) | 0;
    _loadingIds.delete(modelId);
  }

  async function captureModelThumbnail(bundle, size = 128) {
    if (!bundle || !bundle.id || !global.FishToolEngine || !global.FishToolEngine.isReady) return '';
    try {
      // Wait for all embedded/ZIP diffuse textures to finish decoding before snapping 1-shot thumbnail
      if (bundle.textures) {
        const urls = Object.entries(bundle.textures);
        await Promise.all(urls.map(([tid, dataUrl]) => new Promise((resolve) => {
          if (!dataUrl) return resolve();
          const img = new Image();
          img.onload = () => {
            if (typeof global.registerMaterialTextureDataUrl === 'function') {
              global.registerMaterialTextureDataUrl(tid, dataUrl);
            }
            resolve();
          };
          img.onerror = () => resolve();
          img.src = dataUrl;
        })));
      }

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = size;
      thumbCanvas.height = size;
      const tCtx = thumbCanvas.getContext('2d');
      if (!tCtx) return '';

      const dummyEl = document.createElement('canvas');
      dummyEl.width = 4;
      dummyEl.height = 4;

      const engine = global.FishToolEngine;
      const prevLighting = engine._lightingData;
      const dim = Math.round(size * 0.82);
      const fakeLayer = {
        id: '_thumb_' + bundle.id,
        type: 'shape',
        shapeType: '3d_model',
        modelMediaId: bundle.id,
        materialSlots: (bundle.slots || []).map(s => Object.assign({}, s)),
        is3D: true,
        posX: size * 0.5,
        posY: size * 0.5,
        posZ: 0,
        scaleW: dim,
        scaleH: dim,
        scaleZ: dim,
        depth: dim,
        rotX: 12,
        rotY: 26,
        rotZ: 0,
        rotation: 0,
        opacity: 1.0,
        blendMode: 'normal',
        effects: []
      };

      // Temporarily render 1 hardware WebGL frame onto offscreen 128x128 canvas
      engine.setLightingData(null);
      engine.renderLayer(tCtx, dummyEl, fakeLayer, 1, null, 0);
      engine.setLightingData(prevLighting);
      return thumbCanvas.toDataURL('image/png');
    } catch (err) {
      console.warn('[Fish3DLoader] Thumbnail capture failed:', err);
      return '';
    }
  }

  global.Fish3DLoader = {
    parseMTL,
    parseOBJ,
    parseFBX,
    parseGLB,
    importFiles,
    registerBundle,
    getModel,
    removeModel,
    captureModelThumbnail,
    draw3DModelMesh
  };
})(typeof window !== 'undefined' ? window : globalThis);
