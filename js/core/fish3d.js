/**
 * FISH3D.JS - Native 3D WebGL Engine & Volumetric Primitives
 * OpenFishTools Studio - Decoupled 3D subsystem
 * Handles WebGL 3D meshes, MVP projection, centered 3D box, and interactive thumbnails.
 */

(function(global) {
  'use strict';

  const CAMERA_DISTANCE = 1000.0;
  const NEAR_PLANE = 10.0;
  const FAR_PLANE = 10000.0;

  function hexToRgb(hex) {
    let c = (hex || '#000000').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  const _scratchMvp = new Float32Array(16);
  const _scratchModel = new Float32Array(16);
  const _scratchRgb = { r: 0, g: 0, b: 0 };

  function hexToRgbInto(hex, out) {
    let c = (hex || '#000000').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    out.r = (num >> 16) & 255;
    out.g = (num >> 8) & 255;
    out.b = num & 255;
    return out;
  }

  function scaleMatrixZ(out, src, zScale) {
    for (let i = 0; i < 16; i++) out[i] = src[i];
    out[8] *= zScale;
    out[9] *= zScale;
    out[10] *= zScale;
    out[11] *= zScale;
    return out;
  }

  function hasLayerTexture(gl, layer, el) {
    return !!(el && el !== gl.canvas && layer && (
      layer.type === 'video' ||
      layer.type === 'image' ||
      layer.type === 'precomp' ||
      layer.fillType === 'gradient' ||
      layer.fillType === 'media' ||
      (layer.type === 'shape' && (layer.fillType === 'gradient' || layer.fillType === 'media' || (layer.strokeWidth && layer.strokeWidth > 0)))
    ));
  }

  function setSolidCullFace(gl, enable, bounds) {
    if (enable) {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      const flipped = bounds && ((bounds.signX || 1) * (bounds.signY || 1) < 0);
      gl.frontFace(flipped ? gl.CW : gl.CCW);
    } else {
      gl.disable(gl.CULL_FACE);
      gl.frontFace(gl.CCW);
    }
  }

  function createStaticMesh(gl, locations, positions, normals, uvs, indices) {
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

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
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bindVertexArray(null);
    }

    return {
      gl,
      vao,
      posBuf,
      normBuf,
      uvBuf,
      idxBuf,
      indexCount: indices.length
    };
  }

  function bindAndDrawStaticMesh(gl, mesh, locations, hasTexture, colR, colG, colB, finalOpacity, bounds, layer, el, engine, cBaseRgb) {
    const slots = (layer && Array.isArray(layer.materialSlots) && layer.materialSlots.length > 0) ? layer.materialSlots : null;
    const isMultiSlot = Boolean(slots && slots.length > 1 && mesh.faceRanges && mesh.faceRanges.length > 1 && engine && typeof engine.applyMaterialSlot === 'function');
    const hasSingleOverride = Boolean(!isMultiSlot && slots && slots[0] && slots[0].surfaceMode && slots[0].surfaceMode !== 'inherit' && engine && typeof engine.applyMaterialSlot === 'function');

    if (isMultiSlot) {
      setSolidCullFace(gl, finalOpacity >= 0.999, bounds);
      if (mesh.vao && typeof gl.bindVertexArray === 'function') {
        gl.bindVertexArray(mesh.vao);
      } else {
        gl.disableVertexAttribArray(locations.color);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf);
        gl.enableVertexAttribArray(locations.position);
        gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
        if (locations.normal !== -1 && locations.normal !== undefined) {
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normBuf);
          gl.enableVertexAttribArray(locations.normal);
          gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuf);
        gl.enableVertexAttribArray(locations.texCoord);
        gl.vertexAttribPointer(locations.texCoord, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idxBuf);
      }
      for (let i = 0; i < mesh.faceRanges.length; i++) {
        const range = mesh.faceRanges[i];
        const slot = slots[i] || slots[0];
        engine.applyMaterialSlot(gl, layer, slot, el, finalOpacity, cBaseRgb, hasTexture);
        gl.drawElements(gl.TRIANGLES, range.count, gl.UNSIGNED_SHORT, range.offset * 2);
      }
      if (mesh.vao && typeof gl.bindVertexArray === 'function') {
        gl.bindVertexArray(null);
      }
      setSolidCullFace(gl, false, null);
      return;
    }

    let effectiveHasTex = hasTexture;
    if (hasSingleOverride) {
      effectiveHasTex = engine.applyMaterialSlot(gl, layer, slots[0], el, finalOpacity, cBaseRgb, hasTexture);
    } else if (hasTexture) {
      gl.uniform1i(locations.mode, 0);
      gl.vertexAttrib4f(locations.color, 1.0, 1.0, 1.0, finalOpacity);
    } else {
      gl.uniform1i(locations.mode, 1);
      gl.vertexAttrib4f(locations.color, colR, colG, colB, finalOpacity);
    }

    setSolidCullFace(gl, !effectiveHasTex && finalOpacity >= 0.999, bounds);

    if (mesh.vao && typeof gl.bindVertexArray === 'function') {
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    } else {
      gl.disableVertexAttribArray(locations.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf);
      gl.enableVertexAttribArray(locations.position);
      gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
      if (locations.normal !== -1 && locations.normal !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normBuf);
        gl.enableVertexAttribArray(locations.normal);
        gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuf);
      gl.enableVertexAttribArray(locations.texCoord);
      gl.vertexAttribPointer(locations.texCoord, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idxBuf);
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    }
    setSolidCullFace(gl, false, null);
  }

  const Fish3DEngine = {
    CAMERA_DISTANCE,
    NEAR_PLANE,
    FAR_PLANE,

    /**
     * Compute corners and backCorners for 3D box wireframe centered at z = 0
     * @param {Object} bounds - Layer bounds with projectQuad function
     * @param {number} depth - Box depth in pixels
     * @returns {{corners: Array, backCorners: Array}}
     */
    compute3DBoxCorners(projectQuad, depth = 300) {
      if (typeof projectQuad !== 'function') return null;
      const halfD = Math.max(1, depth / 2);

      // Front face at +halfD (facing viewer)
      const pTL_f = projectQuad(-0.5, -0.5,  halfD);
      const pTR_f = projectQuad( 0.5, -0.5,  halfD);
      const pBR_f = projectQuad( 0.5,  0.5,  halfD);
      const pBL_f = projectQuad(-0.5,  0.5,  halfD);

      // Back face at -halfD (receding depth)
      const pTL_b = projectQuad(-0.5, -0.5, -halfD);
      const pTR_b = projectQuad( 0.5, -0.5, -halfD);
      const pBR_b = projectQuad( 0.5,  0.5, -halfD);
      const pBL_b = projectQuad(-0.5,  0.5, -halfD);

      return {
        corners: [pTL_f, pTR_f, pBR_f, pBL_f],
        backCorners: [pTL_b, pTR_b, pBR_b, pBL_b]
      };
    },

    /**
     * Render hardware WebGL 3D Box volumetric mesh with centered anchor [0, 0, 0]
     * Pure flat mode: all 6 faces share uniform color/media without artificial gradients or edge strokes.
     */
    draw3DBoxMesh(gl, locations, buffers, mvp, bounds, layerOpacity = 1.0, layer = null, el = null, modelMatrix = null, engine = null) {
      if (!gl || !locations || !buffers || !mvp) return;

      const bScale = (bounds && bounds.bufferScale) ? bounds.bufferScale : 1;
      const w = bounds && bounds.w ? bounds.w : (300 * bScale);
      const h = bounds && bounds.h ? bounds.h : (300 * bScale);
      const lDepth = (layer && layer.scaleZ !== undefined)
        ? (layer.scaleZ * bScale)
        : ((layer && layer.depth !== undefined) ? (layer.depth * bScale) : Math.round(Math.min(w, h)));
      const depth = Math.max(1, lDepth || (300 * bScale));

      if (layer && layer.fillType === 'none' && (!layer.strokeWidth || layer.strokeWidth <= 0)) {
        return;
      }

      const rawColor = (layer && (layer.fillColor || layer.color)) || '#98ce7b';
      const cBase = hexToRgbInto(rawColor, _scratchRgb);

      const rawOpacity = (layer && layer.opacity !== undefined) ? Number(layer.opacity) : 1.0;
      const normOp = (rawOpacity > 1.0) ? Math.max(0, Math.min(1, rawOpacity / 100)) : Math.max(0, Math.min(1, rawOpacity));
      const finalOpacity = normOp * (layerOpacity !== undefined ? layerOpacity : 1.0);

      scaleMatrixZ(_scratchMvp, mvp, depth);
      gl.uniformMatrix4fv(locations.matrix, false, _scratchMvp);
      if (modelMatrix && locations.modelMatrix) {
        scaleMatrixZ(_scratchModel, modelMatrix, depth);
        gl.uniformMatrix4fv(locations.modelMatrix, false, _scratchModel);
      }

      const hasTexture = hasLayerTexture(gl, layer, el);

      if (!this._boxStaticMesh || this._boxStaticMesh.gl !== gl) {
        const positions = new Float32Array([
          // 1. Front Face (z = +0.5)
          -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
          // 2. Back Face (z = -0.5)
          -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
          // 3. Top Face (y = -0.5)
          -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5, -0.5, -0.5,  -0.5, -0.5, -0.5,
          // 4. Bottom Face (y = 0.5)
          -0.5,  0.5,  0.5,   0.5,  0.5,  0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
          // 5. Left Face (x = -0.5)
          -0.5, -0.5,  0.5,  -0.5,  0.5,  0.5,  -0.5,  0.5, -0.5,  -0.5, -0.5, -0.5,
          // 6. Right Face (x = 0.5)
           0.5, -0.5,  0.5,   0.5,  0.5,  0.5,   0.5,  0.5, -0.5,   0.5, -0.5, -0.5
        ]);
        const norms = new Float32Array([
          0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
          0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
          0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
          0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
          -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
          1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0
        ]);
        const uvs = new Float32Array([
          0, 0, 1, 0, 1, 1, 0, 1,
          1, 0, 0, 0, 0, 1, 1, 1,
          0, 1, 1, 1, 1, 0, 0, 0,
          0, 0, 1, 0, 1, 1, 0, 1,
          1, 0, 1, 1, 0, 1, 0, 0,
          0, 0, 0, 1, 1, 1, 1, 0
        ]);
        const indices = new Uint16Array([
          0, 2, 1,   0, 3, 2,
          4, 5, 6,   4, 6, 7,
          8, 9, 10,  8, 10, 11,
          12, 14, 13, 12, 15, 14,
          16, 18, 17, 16, 19, 18,
          20, 21, 22, 20, 22, 23
        ]);
        this._boxStaticMesh = createStaticMesh(gl, locations, positions, norms, uvs, indices);
        this._boxStaticMesh.faceRanges = [
          { offset: 0, count: 6 },
          { offset: 6, count: 6 },
          { offset: 12, count: 6 },
          { offset: 18, count: 6 },
          { offset: 24, count: 6 },
          { offset: 30, count: 6 }
        ];
      }

      bindAndDrawStaticMesh(gl, this._boxStaticMesh, locations, hasTexture, cBase.r / 255, cBase.g / 255, cBase.b / 255, finalOpacity, bounds, layer, el, engine, cBase);
    },

    /**
     * Render hardware WebGL 3D Cone volumetric mesh
     */
    draw3DConeMesh(gl, locations, buffers, mvp, bounds, layerOpacity = 1.0, layer = null, el = null, modelMatrix = null, engine = null) {
      if (!gl || !locations || !buffers || !mvp) return;

      const bScale = (bounds && bounds.bufferScale) ? bounds.bufferScale : 1;
      const w = bounds && bounds.w ? bounds.w : (300 * bScale);
      const h = bounds && bounds.h ? bounds.h : (300 * bScale);
      const lDepth = (layer && layer.scaleZ !== undefined)
        ? (layer.scaleZ * bScale)
        : ((layer && layer.depth !== undefined) ? (layer.depth * bScale) : Math.round(Math.min(w, h)));
      const depth = Math.max(1, lDepth || (300 * bScale));

      if (layer && layer.fillType === 'none' && (!layer.strokeWidth || layer.strokeWidth <= 0)) {
        return;
      }

      const rawColor = (layer && (layer.fillColor || layer.color)) || '#98ce7b';
      const cBase = hexToRgbInto(rawColor, _scratchRgb);

      const rawOpacity = (layer && layer.opacity !== undefined) ? Number(layer.opacity) : 1.0;
      const normOp = (rawOpacity > 1.0) ? Math.max(0, Math.min(1, rawOpacity / 100)) : Math.max(0, Math.min(1, rawOpacity));
      const finalOpacity = normOp * (layerOpacity !== undefined ? layerOpacity : 1.0);

      scaleMatrixZ(_scratchMvp, mvp, depth);
      gl.uniformMatrix4fv(locations.matrix, false, _scratchMvp);
      if (modelMatrix && locations.modelMatrix) {
        scaleMatrixZ(_scratchModel, modelMatrix, depth);
        gl.uniformMatrix4fv(locations.modelMatrix, false, _scratchModel);
      }

      const hasTexture = hasLayerTexture(gl, layer, el);

      if (!this._coneStaticMesh || this._coneStaticMesh.gl !== gl) {
        const segs = 32;
        const totalVerts = (segs + 2) + (segs + 2);
        const positions = new Float32Array(totalVerts * 3);
        const uvs = [];
        const norms = [];
        const indices = [];

        let pIdx = 0;
        positions[pIdx++] = 0; positions[pIdx++] = -0.5; positions[pIdx++] = 0;
        uvs.push(0.5, 0.0);
        norms.push(0, -1, 0);

        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          positions[pIdx++] = 0.5 * Math.cos(a);
          positions[pIdx++] = 0.5;
          positions[pIdx++] = 0.5 * Math.sin(a);
          uvs.push(i / segs, 1.0);
          norms.push(Math.cos(a) * 0.8944, 0.4472, Math.sin(a) * 0.8944);
        }

        for (let i = 1; i <= segs; i++) {
          indices.push(0, i + 1, i);
        }

        const baseCenterIdx = segs + 2;
        positions[pIdx++] = 0; positions[pIdx++] = 0.5; positions[pIdx++] = 0;
        uvs.push(0.5, 0.5);
        norms.push(0, 1, 0);

        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          positions[pIdx++] = 0.5 * Math.cos(a);
          positions[pIdx++] = 0.5;
          positions[pIdx++] = 0.5 * Math.sin(a);
          uvs.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
          norms.push(0, 1, 0);
        }

        for (let i = 0; i < segs; i++) {
          const curr = baseCenterIdx + 1 + i;
          const next = baseCenterIdx + 1 + i + 1;
          indices.push(baseCenterIdx, curr, next);
        }

        this._coneStaticMesh = createStaticMesh(
          gl, locations, positions, new Float32Array(norms), new Float32Array(uvs), new Uint16Array(indices)
        );
        this._coneStaticMesh.faceRanges = [
          { offset: 0, count: segs * 3 },
          { offset: segs * 3, count: segs * 3 }
        ];
      }

      bindAndDrawStaticMesh(gl, this._coneStaticMesh, locations, hasTexture, cBase.r / 255, cBase.g / 255, cBase.b / 255, finalOpacity, bounds, layer, el, engine, cBase);
    },

    /**
     * Render hardware WebGL 3D Cylinder volumetric mesh
     */
    draw3DCylinderMesh(gl, locations, buffers, mvp, bounds, layerOpacity = 1.0, layer = null, el = null, modelMatrix = null, engine = null) {
      if (!gl || !locations || !buffers || !mvp) return;

      const bScale = (bounds && bounds.bufferScale) ? bounds.bufferScale : 1;
      const w = bounds && bounds.w ? bounds.w : (300 * bScale);
      const h = bounds && bounds.h ? bounds.h : (300 * bScale);
      const lDepth = (layer && layer.scaleZ !== undefined)
        ? (layer.scaleZ * bScale)
        : ((layer && layer.depth !== undefined) ? (layer.depth * bScale) : Math.round(Math.min(w, h)));
      const depth = Math.max(1, lDepth || (300 * bScale));

      if (layer && layer.fillType === 'none' && (!layer.strokeWidth || layer.strokeWidth <= 0)) {
        return;
      }

      const rawColor = (layer && (layer.fillColor || layer.color)) || '#98ce7b';
      const cBase = hexToRgbInto(rawColor, _scratchRgb);

      const rawOpacity = (layer && layer.opacity !== undefined) ? Number(layer.opacity) : 1.0;
      const normOp = (rawOpacity > 1.0) ? Math.max(0, Math.min(1, rawOpacity / 100)) : Math.max(0, Math.min(1, rawOpacity));
      const finalOpacity = normOp * (layerOpacity !== undefined ? layerOpacity : 1.0);

      scaleMatrixZ(_scratchMvp, mvp, depth);
      gl.uniformMatrix4fv(locations.matrix, false, _scratchMvp);
      if (modelMatrix && locations.modelMatrix) {
        scaleMatrixZ(_scratchModel, modelMatrix, depth);
        gl.uniformMatrix4fv(locations.modelMatrix, false, _scratchModel);
      }

      const hasTexture = hasLayerTexture(gl, layer, el);

      if (!this._cylStaticMesh || this._cylStaticMesh.gl !== gl) {
        const segs = 32;
        const topCenterIdx = (segs + 1) * 2;
        const botCenterIdx = topCenterIdx + 1 + (segs + 1);
        const totalVerts = botCenterIdx + 1 + (segs + 1);
        const positions = new Float32Array(totalVerts * 3);
        const uvs = [];
        const norms = [];
        const indices = [];

        let pIdx = 0;
        for (let i = 0; i <= segs; i++) {
          const u = i / segs;
          const a = u * Math.PI * 2;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          positions[pIdx++] = 0.5 * cos; positions[pIdx++] = -0.5; positions[pIdx++] = 0.5 * sin;
          positions[pIdx++] = 0.5 * cos; positions[pIdx++] =  0.5; positions[pIdx++] = 0.5 * sin;
          uvs.push(u, 0.0, u, 1.0);
          norms.push(cos, 0, sin, cos, 0, sin);
        }

        for (let i = 0; i < segs; i++) {
          const tl = i * 2;
          const bl = i * 2 + 1;
          const tr = (i + 1) * 2;
          const br = (i + 1) * 2 + 1;
          indices.push(tl, br, bl);
          indices.push(tl, tr, br);
        }

        positions[pIdx++] = 0; positions[pIdx++] = -0.5; positions[pIdx++] = 0;
        uvs.push(0.5, 0.5);
        norms.push(0, -1, 0);
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          positions[pIdx++] = 0.5 * Math.cos(a); positions[pIdx++] = -0.5; positions[pIdx++] = 0.5 * Math.sin(a);
          uvs.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
          norms.push(0, -1, 0);
        }
        for (let i = 0; i < segs; i++) {
          indices.push(topCenterIdx, topCenterIdx + 1 + i + 1, topCenterIdx + 1 + i);
        }

        positions[pIdx++] = 0; positions[pIdx++] = 0.5; positions[pIdx++] = 0;
        uvs.push(0.5, 0.5);
        norms.push(0, 1, 0);
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          positions[pIdx++] = 0.5 * Math.cos(a); positions[pIdx++] = 0.5; positions[pIdx++] = 0.5 * Math.sin(a);
          uvs.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
          norms.push(0, 1, 0);
        }
        for (let i = 0; i < segs; i++) {
          indices.push(botCenterIdx, botCenterIdx + 1 + i, botCenterIdx + 1 + i + 1);
        }

        this._cylStaticMesh = createStaticMesh(
          gl, locations, positions, new Float32Array(norms), new Float32Array(uvs), new Uint16Array(indices)
        );
        this._cylStaticMesh.faceRanges = [
          { offset: 0, count: segs * 6 },
          { offset: segs * 6, count: segs * 3 },
          { offset: segs * 9, count: segs * 3 }
        ];
      }

      bindAndDrawStaticMesh(gl, this._cylStaticMesh, locations, hasTexture, cBase.r / 255, cBase.g / 255, cBase.b / 255, finalOpacity, bounds, layer, el, engine, cBase);
    },

    /**
     * Render hardware WebGL 3D Torus volumetric mesh
     */
    draw3DTorusMesh(gl, locations, buffers, mvp, bounds, layerOpacity = 1.0, layer = null, el = null, modelMatrix = null, engine = null) {
      if (!gl || !locations || !buffers || !mvp) return;

      const bScale = (bounds && bounds.bufferScale) ? bounds.bufferScale : 1;
      const lDepth = (layer && layer.scaleZ !== undefined)
        ? (layer.scaleZ * bScale)
        : ((layer && layer.depth !== undefined) ? (layer.depth * bScale) : 150 * bScale);
      const depth = Math.max(1, lDepth || (150 * bScale));
      const zScale = depth * 2;

      if (layer && layer.fillType === 'none' && (!layer.strokeWidth || layer.strokeWidth <= 0)) {
        return;
      }

      const rawColor = (layer && (layer.fillColor || layer.color)) || '#98ce7b';
      const cBase = hexToRgbInto(rawColor, _scratchRgb);

      const rawOpacity = (layer && layer.opacity !== undefined) ? Number(layer.opacity) : 1.0;
      const normOp = (rawOpacity > 1.0) ? Math.max(0, Math.min(1, rawOpacity / 100)) : Math.max(0, Math.min(1, rawOpacity));
      const finalOpacity = normOp * (layerOpacity !== undefined ? layerOpacity : 1.0);

      scaleMatrixZ(_scratchMvp, mvp, zScale);
      gl.uniformMatrix4fv(locations.matrix, false, _scratchMvp);
      if (modelMatrix && locations.modelMatrix) {
        scaleMatrixZ(_scratchModel, modelMatrix, zScale);
        gl.uniformMatrix4fv(locations.modelMatrix, false, _scratchModel);
      }

      const hasTexture = hasLayerTexture(gl, layer, el);

      if (!this._torusStaticMesh || this._torusStaticMesh.gl !== gl) {
        const radialSegs = 24;
        const tubularSegs = 16;
        const R = 0.35;
        const r = 0.12;
        const totalVerts = (radialSegs + 1) * (tubularSegs + 1);
        const positions = new Float32Array(totalVerts * 3);
        const uvs = [];
        const norms = [];
        const indices = [];

        let pIdx = 0;
        for (let j = 0; j <= radialSegs; j++) {
          const uFrac = j / radialSegs;
          const u = uFrac * Math.PI * 2;
          const cosU = Math.cos(u);
          const sinU = Math.sin(u);
          for (let i = 0; i <= tubularSegs; i++) {
            const vFrac = i / tubularSegs;
            const v = vFrac * Math.PI * 2;
            const cosV = Math.cos(v);
            const sinV = Math.sin(v);
            positions[pIdx++] = (R + r * cosV) * cosU;
            positions[pIdx++] = (R + r * cosV) * sinU;
            positions[pIdx++] = r * sinV;
            uvs.push(uFrac, vFrac);
            norms.push(cosV * cosU, cosV * sinU, sinV);
          }
        }

        for (let j = 0; j < radialSegs; j++) {
          for (let i = 0; i < tubularSegs; i++) {
            const a = (tubularSegs + 1) * j + i;
            const b = (tubularSegs + 1) * (j + 1) + i;
            const c = (tubularSegs + 1) * (j + 1) + (i + 1);
            const d = (tubularSegs + 1) * j + (i + 1);
            indices.push(a, d, b);
            indices.push(b, d, c);
          }
        }

        this._torusStaticMesh = createStaticMesh(
          gl, locations, positions, new Float32Array(norms), new Float32Array(uvs), new Uint16Array(indices)
        );
      }

      bindAndDrawStaticMesh(gl, this._torusStaticMesh, locations, hasTexture, cBase.r / 255, cBase.g / 255, cBase.b / 255, finalOpacity, bounds, layer, el, engine, cBase);
    },

    /**
     * Render crisp real 3D isometric shape onto thumbnail canvas
     * @param {HTMLCanvasElement} canvas
     * @param {string} shapeType - '3d_box', '3d_sphere', '3d_pyramid', '3d_cone', '3d_cylinder', '3d_torus'
     * @param {Object} options - { rotX, rotY, color, size }
     */
    renderShapeThumbnail(canvas, shapeType = '3d_box', options = {}) {
      if (!canvas || typeof canvas.getContext !== 'function') return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width || 48;
      const h = canvas.height || 48;
      ctx.clearRect(0, 0, w, h);

      const rotXDeg = options.rotX !== undefined ? options.rotX : 25;
      const rotYDeg = options.rotY !== undefined ? options.rotY : 35;
      const color = options.color || '#98ce7b';
      const rgb = hexToRgb(color);

      const radX = (rotXDeg * Math.PI) / 180;
      const radY = (rotYDeg * Math.PI) / 180;

      const cosX = Math.cos(radX), sinX = Math.sin(radX);
      const cosY = Math.cos(radY), sinY = Math.sin(radY);

      const cx = w / 2;
      const cy = h / 2;
      const minDim = Math.min(w, h);

      function project(x, y, z) {
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        return { x: cx + x1, y: cy + y2, z: z2 };
      }

      function shadeColor(factor) {
        return `rgb(${Math.min(255, Math.max(0, Math.round(rgb.r * factor)))}, ${Math.min(255, Math.max(0, Math.round(rgb.g * factor)))}, ${Math.min(255, Math.max(0, Math.round(rgb.b * factor)))})`;
      }

      // Light direction from top-front-right
      const Lx = 0.45, Ly = -0.75, Lz = 0.48;
      function computeShade(nx, ny, nz) {
        const dot = nx * Lx + ny * Ly + nz * Lz;
        return Math.max(0.55, Math.min(1.25, 0.82 + dot * 0.42));
      }

      const faces = [];

      if (shapeType === '3d_sphere') {
        const s = (options.size || minDim * 0.35);
        const rings = 8;
        const sectors = 12;
        const grid = [];
        for (let r = 0; r <= rings; r++) {
          const v = r / rings;
          const phi = v * Math.PI;
          const row = [];
          for (let sc = 0; sc <= sectors; sc++) {
            const u = sc / sectors;
            const theta = u * Math.PI * 2;
            const nx = Math.sin(phi) * Math.cos(theta);
            const ny = -Math.cos(phi);
            const nz = Math.sin(phi) * Math.sin(theta);
            const p = project(nx * s, ny * s, nz * s);
            p.nx = nx; p.ny = ny; p.nz = nz;
            row.push(p);
          }
          grid.push(row);
        }
        for (let r = 0; r < rings; r++) {
          for (let sc = 0; sc < sectors; sc++) {
            const p0 = grid[r][sc];
            const p1 = grid[r][sc + 1];
            const p2 = grid[r + 1][sc + 1];
            const p3 = grid[r + 1][sc];
            const avgZ = (p0.z + p1.z + p2.z + p3.z) / 4;
            const fnx = (p0.nx + p1.nx + p2.nx + p3.nx) / 4;
            const fny = (p0.ny + p1.ny + p2.ny + p3.ny) / 4;
            const fnz = (p0.nz + p1.nz + p2.nz + p3.nz) / 4;
            faces.push({
              pts: [p0, p1, p2, p3],
              avgZ,
              shade: computeShade(fnx, fny, fnz)
            });
          }
        }
      } else if (shapeType === '3d_pyramid' || shapeType === '3d_triangle') {
        const s = (options.size || minDim * 0.34);
        const apex = project(0, -s * 0.9, 0);
        const b0 = project(-s * 0.85, s * 0.7,  s * 0.85);
        const b1 = project( s * 0.85, s * 0.7,  s * 0.85);
        const b2 = project( s * 0.85, s * 0.7, -s * 0.85);
        const b3 = project(-s * 0.85, s * 0.7, -s * 0.85);

        faces.push({
          pts: [apex, b0, b1],
          avgZ: (apex.z + b0.z + b1.z) / 3,
          shade: computeShade(0, -0.4, 0.9)
        });
        faces.push({
          pts: [apex, b1, b2],
          avgZ: (apex.z + b1.z + b2.z) / 3,
          shade: computeShade(0.9, -0.4, 0)
        });
        faces.push({
          pts: [apex, b2, b3],
          avgZ: (apex.z + b2.z + b3.z) / 3,
          shade: computeShade(0, -0.4, -0.9)
        });
        faces.push({
          pts: [apex, b3, b0],
          avgZ: (apex.z + b3.z + b0.z) / 3,
          shade: computeShade(-0.9, -0.4, 0)
        });
        faces.push({
          pts: [b3, b2, b1, b0],
          avgZ: (b0.z + b1.z + b2.z + b3.z) / 4,
          shade: computeShade(0, 1.0, 0)
        });
      } else if (shapeType === '3d_cone') {
        const s = (options.size || minDim * 0.34);
        const segs = 16;
        const apex = project(0, -s * 0.9, 0);
        const basePts = [];
        const baseCenter = project(0, s * 0.7, 0);
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          const cos = Math.cos(a), sin = Math.sin(a);
          const pt = project(cos * s * 0.85, s * 0.7, sin * s * 0.85);
          pt.nx = cos; pt.nz = sin;
          basePts.push(pt);
        }
        for (let i = 0; i < segs; i++) {
          const p0 = basePts[i];
          const p1 = basePts[i + 1];
          const fnx = (p0.nx + p1.nx) / 2;
          const fnz = (p0.nz + p1.nz) / 2;
          faces.push({
            pts: [apex, p0, p1],
            avgZ: (apex.z + p0.z + p1.z) / 3,
            shade: computeShade(fnx * 0.9, -0.45, fnz * 0.9)
          });
          faces.push({
            pts: [baseCenter, p1, p0],
            avgZ: (baseCenter.z + p0.z + p1.z) / 3,
            shade: computeShade(0, 1.0, 0)
          });
        }
      } else if (shapeType === '3d_cylinder') {
        const s = (options.size || minDim * 0.33);
        const segs = 16;
        const topPts = [];
        const botPts = [];
        const topCenter = project(0, -s * 0.75, 0);
        const botCenter = project(0, s * 0.75, 0);
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          const cos = Math.cos(a), sin = Math.sin(a);
          const tp = project(cos * s * 0.75, -s * 0.75, sin * s * 0.75);
          const bp = project(cos * s * 0.75,  s * 0.75, sin * s * 0.75);
          tp.nx = cos; tp.nz = sin;
          bp.nx = cos; bp.nz = sin;
          topPts.push(tp);
          botPts.push(bp);
        }
        for (let i = 0; i < segs; i++) {
          const t0 = topPts[i], t1 = topPts[i + 1];
          const b0 = botPts[i], b1 = botPts[i + 1];
          const fnx = (t0.nx + t1.nx) / 2;
          const fnz = (t0.nz + t1.nz) / 2;
          faces.push({
            pts: [t0, t1, b1, b0],
            avgZ: (t0.z + t1.z + b1.z + b0.z) / 4,
            shade: computeShade(fnx, 0, fnz)
          });
          faces.push({
            pts: [topCenter, t0, t1],
            avgZ: (topCenter.z + t0.z + t1.z) / 3,
            shade: computeShade(0, -1.0, 0)
          });
          faces.push({
            pts: [botCenter, b1, b0],
            avgZ: (botCenter.z + b0.z + b1.z) / 3,
            shade: computeShade(0, 1.0, 0)
          });
        }
      } else if (shapeType === '3d_torus') {
        const s = (options.size || minDim * 0.34);
        const R = s * 0.62;
        const r = s * 0.28;
        const radSegs = 14;
        const tubSegs = 8;
        const grid = [];
        for (let j = 0; j <= radSegs; j++) {
          const u = (j / radSegs) * Math.PI * 2;
          const cosU = Math.cos(u), sinU = Math.sin(u);
          const row = [];
          for (let i = 0; i <= tubSegs; i++) {
            const v = (i / tubSegs) * Math.PI * 2;
            const cosV = Math.cos(v), sinV = Math.sin(v);
            const px = (R + r * cosV) * cosU;
            const py = (R + r * cosV) * sinU;
            const pz = r * sinV;
            const pt = project(px, py, pz);
            pt.nx = cosV * cosU;
            pt.ny = cosV * sinU;
            pt.nz = sinV;
            row.push(pt);
          }
          grid.push(row);
        }
        for (let j = 0; j < radSegs; j++) {
          for (let i = 0; i < tubSegs; i++) {
            const p0 = grid[j][i];
            const p1 = grid[j + 1][i];
            const p2 = grid[j + 1][i + 1];
            const p3 = grid[j][i + 1];
            const avgZ = (p0.z + p1.z + p2.z + p3.z) / 4;
            const fnx = (p0.nx + p1.nx + p2.nx + p3.nx) / 4;
            const fny = (p0.ny + p1.ny + p2.ny + p3.ny) / 4;
            const fnz = (p0.nz + p1.nz + p2.nz + p3.nz) / 4;
            faces.push({
              pts: [p0, p1, p2, p3],
              avgZ,
              shade: computeShade(fnx, fny, fnz)
            });
          }
        }
      } else {
        // Standard 3D Box (Cube)
        const s = (options.size || minDim * 0.32);
        const v = [
          project(-s, -s,  s), // 0: Top-Left-Front
          project( s, -s,  s), // 1: Top-Right-Front
          project( s,  s,  s), // 2: Bottom-Right-Front
          project(-s,  s,  s), // 3: Bottom-Left-Front
          project(-s, -s, -s), // 4: Top-Left-Back
          project( s, -s, -s), // 5: Top-Right-Back
          project( s,  s, -s), // 6: Bottom-Right-Back
          project(-s,  s, -s)  // 7: Bottom-Left-Back
        ];
        faces.push({ pts: [v[0], v[1], v[2], v[3]], avgZ: (v[0].z + v[1].z + v[2].z + v[3].z) / 4, shade: computeShade(0, 0, 1) });
        faces.push({ pts: [v[5], v[4], v[7], v[6]], avgZ: (v[5].z + v[4].z + v[7].z + v[6].z) / 4, shade: computeShade(0, 0, -1) });
        faces.push({ pts: [v[4], v[5], v[1], v[0]], avgZ: (v[4].z + v[5].z + v[1].z + v[0].z) / 4, shade: computeShade(0, -1, 0) });
        faces.push({ pts: [v[3], v[2], v[6], v[7]], avgZ: (v[3].z + v[2].z + v[6].z + v[7].z) / 4, shade: computeShade(0, 1, 0) });
        faces.push({ pts: [v[4], v[0], v[3], v[7]], avgZ: (v[4].z + v[0].z + v[3].z + v[7].z) / 4, shade: computeShade(-1, 0, 0) });
        faces.push({ pts: [v[1], v[5], v[6], v[2]], avgZ: (v[1].z + v[5].z + v[6].z + v[2].z) / 4, shade: computeShade(1, 0, 0) });
      }

      faces.sort((a, b) => a.avgZ - b.avgZ);

      ctx.save();
      faces.forEach(f => {
        const pts = f.pts;
        const nz = (pts[1].x - pts[0].x) * (pts[2].y - pts[0].y) - (pts[1].y - pts[0].y) * (pts[2].x - pts[0].x);
        if (nz > 0) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
          }
          ctx.closePath();
          ctx.fillStyle = shadeColor(f.shade);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      });
      ctx.restore();
    },

    /**
     * Backward-compatibility facade for 3D box thumbnail
     */
    renderBoxThumbnail(canvas, options = {}) {
      return this.renderShapeThumbnail(canvas, '3d_box', options);
    },

    /**
     * Bind smooth interactive turntable hover on drawer button
     * @param {HTMLElement} btn - Button element
     * @param {HTMLCanvasElement} canvas - 3D canvas inside button
     * @param {string} shapeType - Optional 3D shape type
     */
    bindTurntableHover(btn, canvas, shapeType = '3d_box') {
      if (!btn || !canvas) return;

      const defaultRotX = 25;
      const defaultRotY = 35;
      let currentRotX = defaultRotX;
      let currentRotY = defaultRotY;
      let targetRotY = defaultRotY;
      let targetRotX = defaultRotX;
      let isHovered = false;
      let animId = null;

      const render = () => {
        this.renderShapeThumbnail(canvas, shapeType, { rotX: currentRotX, rotY: currentRotY });
      };

      // Initial static render
      render();

      const loop = () => {
        if (!isHovered && Math.abs(currentRotY - defaultRotY) < 0.2 && Math.abs(currentRotX - defaultRotX) < 0.2) {
          currentRotX = defaultRotX;
          currentRotY = defaultRotY;
          render();
          animId = null;
          return;
        }

        if (isHovered) {
          // Continuous turntable spin while hovered
          targetRotY += 1.8;
          targetRotX = defaultRotX + Math.sin(targetRotY * 0.05) * 6;
        }

        currentRotY += (targetRotY - currentRotY) * 0.15;
        currentRotX += (targetRotX - currentRotX) * 0.15;
        render();

        animId = requestAnimationFrame(loop);
      };

      btn.addEventListener('pointerenter', () => {
        isHovered = true;
        targetRotY = currentRotY + 20;
        if (!animId) animId = requestAnimationFrame(loop);
      });

      btn.addEventListener('pointerleave', () => {
        isHovered = false;
        targetRotX = defaultRotX;
        targetRotY = Math.round(currentRotY / 360) * 360 + defaultRotY;
        if (!animId) animId = requestAnimationFrame(loop);
      });
    }
  };

  global.Fish3DEngine = Fish3DEngine;
  global.Fish3D = Fish3DEngine;

})(typeof window !== 'undefined' ? window : globalThis);
