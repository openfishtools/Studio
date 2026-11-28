/**
 * FishToolEngine - Custom High-Performance Micro-GPU 2.5D/3D Layer Engine
 * Dedicated 1-Quad hardware perspective blitter (< 8 KB).
 * Zero bloat, zero subdivision, zero seams, zero warping.
 * 144+ FPS hardware perspective via WebGL2/WebGL1.
 */
(function(window) {
  'use strict';

  const CAMERA_DISTANCE = 1000.0; // Standard 3D perspective focal distance in pixels
  const NEAR_PLANE = 20.0;        // Near clip plane: object clips out when within 20px of camera lens
  const MAX_Z = CAMERA_DISTANCE - NEAR_PLANE; // 980.0px: threshold where layer exits camera view

  function hexToRgba(hex, alpha) {
    let c = (hex || '#000000').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

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

  // 1. Minimal Vertex & Fragment Shaders (Supports 2D Quads, 3D Volumetric Meshes & Advance 3D Lighting)
  const VS_SOURCE = `
    attribute vec3 a_position;
    attribute vec3 a_normal;
    attribute vec2 a_texCoord;
    attribute vec4 a_color;
    uniform mat4 u_matrix;
    uniform mat4 u_modelMatrix;
    uniform mat3 u_normalMatrix;
    uniform float u_lensDistort;
    varying vec2 v_texCoord;
    varying vec4 v_color;
    varying vec3 v_worldPos;
    varying vec3 v_normal;

    void main() {
      v_texCoord = a_texCoord;
      v_color = a_color;
      v_worldPos = (u_modelMatrix * vec4(a_position, 1.0)).xyz;
      v_normal = normalize(u_normalMatrix * a_normal);
      vec4 pos = u_matrix * vec4(a_position, 1.0);
      if (abs(u_lensDistort) > 0.001 && pos.w > 0.001) {
        vec2 ndc = pos.xy / pos.w;
        float r2 = dot(ndc, ndc);
        float warp = 1.0 + u_lensDistort * r2;
        pos.xy = ndc * warp * pos.w;
      }
      gl_Position = pos;
    }
  `;

  const FS_SOURCE = `
    precision mediump float;
    varying vec2 v_texCoord;
    varying vec4 v_color;
    varying vec3 v_worldPos;
    varying vec3 v_normal;

    uniform sampler2D u_texture;
    uniform float u_opacity;
    uniform float u_noDiscard;
    uniform int u_mode;

    // Advance 3D Lighting Uniforms
    uniform int u_numLights;
    uniform int u_lightTypes[4];
    uniform vec3 u_lightColors[4];
    uniform float u_lightIntensities[4];
    uniform vec3 u_lightPositions[4];
    uniform vec3 u_lightDirections[4];
    uniform float u_lightRadii[4];
    uniform vec4 u_materialParams;
    uniform vec4 u_matExtra;
    uniform sampler2D u_envMap;
    uniform vec3 u_viewPos;

    // Advance 3D Shadow Mapping & Screen-Space Reflections
    uniform sampler2D u_shadowMap;
    uniform mat4 u_lightViewProj;
    uniform vec4 u_shadowParams; // x: enabled(0/1), y: lightIndex, z: texelSize, w: strength
    uniform sampler2D u_sceneColorTex;
    uniform sampler2D u_sceneDepthTex;
    uniform mat4 u_cameraVP;
    uniform vec4 u_reflParams; // x: enabled(0/1), y: maxDist, z: stepDist, w: thickness

    float sampleShadowFactor(vec3 worldPos, vec3 N, vec3 L) {
      if (u_shadowParams.x < 0.5) return 1.0;
      float nDotL = max(dot(N, L), 0.0);
      float biasWorld = mix(6.0, 1.5, nDotL);
      vec4 lsPos = u_lightViewProj * vec4(worldPos + N * biasWorld, 1.0);
      if (lsPos.w <= 0.0001) return 1.0;
      vec3 proj = (lsPos.xyz / lsPos.w) * 0.5 + 0.5;
      if (proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0 || proj.z < 0.0 || proj.z > 1.0) {
        return 1.0;
      }
      float depthBias = max(0.0035 * (1.0 - nDotL), 0.0012);
      float texel = u_shadowParams.z;
      float lit = 0.0;
      for (int ox = -1; ox <= 1; ox++) {
        for (int oy = -1; oy <= 1; oy++) {
          vec2 suv = proj.xy + vec2(float(ox), float(oy)) * texel;
          float closest = texture2D(u_shadowMap, suv).r;
          lit += (proj.z - depthBias > closest) ? 0.0 : 1.0;
        }
      }
      lit /= 9.0;
      return mix(1.0 - u_shadowParams.w, 1.0, lit);
    }

    vec4 traceSceneReflection(vec3 worldPos, vec3 N, vec3 R) {
      if (u_reflParams.x < 0.5) return vec4(0.0);
      float maxDist = max(u_reflParams.y, 100.0);
      float stepSize = maxDist / 16.0;
      float thickness = max(u_reflParams.w, 0.015);
      vec3 origin = worldPos + N * 4.0;
      float prevT = 0.0;
      for (int s = 1; s <= 16; s++) {
        float t = float(s) * stepSize;
        vec3 p = origin + R * t;
        vec4 cp = u_cameraVP * vec4(p, 1.0);
        if (cp.w <= 0.001) break;
        vec3 ndc = cp.xyz / cp.w;
        vec2 uv = ndc.xy * 0.5 + 0.5;
        float rayZ = ndc.z * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || rayZ < 0.0 || rayZ > 1.0) {
          break;
        }
        float sceneZ = texture2D(u_sceneDepthTex, uv).r;
        float diff = rayZ - sceneZ;
        if (sceneZ < 0.9999 && diff > 0.0004 && diff < thickness) {
          // 3-step binary refinement for crisp reflection edge
          float lo = prevT;
          float hi = t;
          vec2 hitUv = uv;
          for (int b = 0; b < 3; b++) {
            float mid = 0.5 * (lo + hi);
            vec4 mp = u_cameraVP * vec4(origin + R * mid, 1.0);
            vec3 mndc = mp.xyz / max(mp.w, 0.001);
            vec2 muv = mndc.xy * 0.5 + 0.5;
            float mz = mndc.z * 0.5 + 0.5;
            float msz = texture2D(u_sceneDepthTex, muv).r;
            if (mz - msz > 0.0002) {
              hi = mid;
              hitUv = muv;
            } else {
              lo = mid;
            }
          }
          vec4 hitCol = texture2D(u_sceneColorTex, hitUv);
          if (hitCol.a > 0.05) {
            vec2 edgeDist = min(hitUv, 1.0 - hitUv);
            float edgeFade = smoothstep(0.0, 0.08, min(edgeDist.x, edgeDist.y));
            float distFade = 1.0 - smoothstep(maxDist * 0.65, maxDist, hi);
            vec3 rgb = hitCol.rgb / max(hitCol.a, 0.001);
            return vec4(rgb, clamp(hitCol.a * edgeFade * distFade, 0.0, 1.0));
          }
        }
        prevT = t;
      }
      return vec4(0.0);
    }

    void main() {
      vec4 baseColor;
      if (u_mode == 1) {
        if (u_noDiscard < 0.5 && v_color.a <= 0.015) discard;
        baseColor = v_color;
      } else {
        vec4 col = texture2D(u_texture, v_texCoord);
        if (u_noDiscard < 0.5 && col.a <= 0.015) discard;
        vec4 tint = (v_color.a > 0.001 && (v_color.r > 0.001 || v_color.g > 0.001 || v_color.b > 0.001)) ? v_color : vec4(1.0, 1.0, 1.0, 1.0);
        baseColor = col * tint;
      }

      float glossy = clamp(u_matExtra.x, 0.0, 1.0);
      float metallic = clamp(u_matExtra.y, 0.0, 1.0);
      float envStrength = clamp(u_matExtra.z, 0.0, 2.0);
      bool hasEnvMap = (u_matExtra.w > 0.5);
      bool hasSceneRefl = (u_reflParams.x > 0.5);
      bool hasEnvGloss = ((hasEnvMap || hasSceneRefl) && (glossy > 0.005 || metallic > 0.005) && envStrength > 0.005);

      // Unlit path: Classic 3D, acceptsLights false (without env/refl), or 0 lights & no reflection -> identical to baseline
      if (u_materialParams.x < 0.5 || (u_numLights <= 0 && !hasEnvGloss)) {
        gl_FragColor = baseColor * u_opacity;
        return;
      }

      vec3 N = normalize(v_normal);
      vec3 V = normalize(u_viewPos - v_worldPos);
      float nDotV = max(dot(N, V), 0.0);

      vec3 totalDiffuseLight = vec3(0.0);
      vec3 totalSpecularLight = vec3(0.0);
      float diffCoeff = u_materialParams.y;
      float specCoeff = u_materialParams.z;
      float roughness = clamp(u_materialParams.w, 0.02, 1.0);
      float effRough = clamp(roughness * (1.0 - glossy * 0.55), 0.02, 1.0);
      float shininess = mix(256.0, 4.0, effRough);
      int shadowLightIdx = int(u_shadowParams.y + 0.5);

      for (int i = 0; i < 4; i++) {
        if (i >= u_numLights) break;
        int type = u_lightTypes[i];
        vec3 lCol = u_lightColors[i];
        float lInt = u_lightIntensities[i];

        if (type == 0) {
          totalDiffuseLight += lCol * lInt;
        } else if (type == 1) {
          vec3 L = -normalize(u_lightDirections[i]);
          float nDotL = max(0.0, dot(N, L));
          float sh = (u_shadowParams.x > 0.5 && i == shadowLightIdx && nDotL > 0.0) ? sampleShadowFactor(v_worldPos, N, L) : 1.0;
          totalDiffuseLight += lCol * (lInt * nDotL * sh);
          if (nDotL > 0.0) {
            vec3 H = normalize(L + V);
            float nDotH = max(0.0, dot(N, H));
            totalSpecularLight += lCol * (lInt * pow(nDotH, shininess) * sh);
          }
        } else if (type == 2) {
          vec3 toLight = u_lightPositions[i] - v_worldPos;
          float d = length(toLight);
          vec3 L = toLight / max(d, 0.001);
          float nDotL = max(0.0, dot(N, L));
          float rad = max(u_lightRadii[i], 1.0);
          float atten = 1.0 / (1.0 + (d / rad) * (d / rad));
          float sh = (u_shadowParams.x > 0.5 && i == shadowLightIdx && nDotL > 0.0) ? sampleShadowFactor(v_worldPos, N, L) : 1.0;
          totalDiffuseLight += lCol * (lInt * nDotL * atten * sh);
          if (nDotL > 0.0) {
            vec3 H = normalize(L + V);
            float nDotH = max(0.0, dot(N, H));
            totalSpecularLight += lCol * (lInt * pow(nDotH, shininess) * atten * sh);
          }
        }
      }

      vec3 specTint = mix(vec3(1.0), baseColor.rgb, metallic);
      float specBoost = specCoeff + glossy * 0.85;
      vec3 litRgb;
      if (u_numLights > 0) {
        litRgb = baseColor.rgb * totalDiffuseLight * diffCoeff * (1.0 - metallic * 0.85) + totalSpecularLight * specTint * specBoost;
      } else {
        litRgb = baseColor.rgb * (1.0 - metallic * (hasEnvMap ? 0.7 : 0.25));
      }

      if (hasEnvGloss) {
        vec3 R = reflect(-V, N);
        vec3 envCol = vec3(0.0);
        float envWeight = 0.0;
        if (hasEnvMap) {
          vec2 envUv = vec2(
            atan(R.x, -R.z) / 6.2831853 + 0.5,
            acos(clamp(-R.y, -1.0, 1.0)) / 3.1415926
          );
          envCol = texture2D(u_envMap, envUv, effRough * 5.0).rgb;
          envWeight = 1.0;
        }
        if (hasSceneRefl) {
          vec4 ssr = traceSceneReflection(v_worldPos, N, R);
          float ssrVis = ssr.a * (1.0 - effRough * 0.65);
          if (ssrVis > 0.001) {
            envCol = (envWeight > 0.5) ? mix(envCol, ssr.rgb, ssrVis) : ssr.rgb;
            envWeight = max(envWeight, ssrVis);
          }
        }
        if (envWeight > 0.001) {
          float fresnel = mix(0.04, 1.0, pow(1.0 - nDotV, 5.0));
          float coatAmt = mix(fresnel, 1.0, glossy * 0.55) * glossy * envStrength * envWeight;
          vec3 metalEnv = envCol * mix(baseColor.rgb, vec3(1.0), fresnel * 0.35) * (metallic * envStrength * envWeight);
          litRgb = mix(litRgb, envCol, clamp(coatAmt * 0.85, 0.0, 0.92)) + metalEnv;
        }
      }

      gl_FragColor = vec4(litRgb, baseColor.a) * u_opacity;
    }
  `;

  // Hardware-Accelerated Optical RGB Split Shaders (Single-Quad GPU channel offset)
  const RGB_SPLIT_VS = `
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    void main() {
      v_uv = a_uv;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const RGB_SPLIT_FS = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_delta;
    uniform float u_opacity;

    void main() {
      vec4 colG = texture2D(u_image, v_uv);
      vec4 colR = texture2D(u_image, v_uv + u_delta);
      vec4 colB = texture2D(u_image, v_uv - u_delta);
      float outA = max(colG.a, max(colR.a, colB.a));
      if (outA <= 0.003) discard;
      gl_FragColor = vec4(colR.r, colG.g, colB.b, outA) * u_opacity;
    }
  `;

  const FRAME_BLEND_FS = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex0;
    uniform sampler2D u_tex1;
    uniform float u_alpha;

    void main() {
      vec4 c0 = texture2D(u_tex0, v_uv);
      vec4 c1 = texture2D(u_tex1, v_uv);
      gl_FragColor = mix(c0, c1, u_alpha);
    }
  `;

  // WebGL2 Half-Resolution Depth SSAO Shaders (Zero-extension, Zero-halo normal diff)
  const AO_QUAD_VS = `#version 300 es
    precision highp float;
    const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    out vec2 v_uv;
    void main() {
      vec2 p = POS[gl_VertexID];
      v_uv = p * 0.5 + 0.5;
      gl_Position = vec4(p, 0.0, 1.0);
    }
  `;

  const AO_PASS_FS = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    out float outAO;
    uniform sampler2D u_depth;
    uniform float u_near;
    uniform float u_far;
    uniform vec2 u_projScale;
    uniform float u_radius;
    uniform float u_strength;
    uniform float u_power;
    uniform int u_samples;

    float getLinearDepth(float d01) {
      float ndcZ = d01 * 2.0 - 1.0;
      return (2.0 * u_near * u_far) / max(0.0001, (u_far + u_near) - ndcZ * (u_far - u_near));
    }

    vec3 getViewPos(vec2 uv, float linZ) {
      vec2 ndc = uv * 2.0 - 1.0;
      return vec3(ndc.x * linZ * u_projScale.x, ndc.y * linZ * u_projScale.y, -linZ);
    }

    void main() {
      ivec2 dSize = textureSize(u_depth, 0);
      vec2 fDSize = vec2(dSize);
      vec2 invDSize = 1.0 / fDSize;
      ivec2 fc = clamp(ivec2(v_uv * fDSize), ivec2(0), dSize - 1);

      float cD01 = texelFetch(u_depth, fc, 0).r;
      if (cD01 >= 0.9999) {
        outAO = 1.0;
        return;
      }
      vec2 cUv = (vec2(fc) + 0.5) * invDSize;
      float cZ = getLinearDepth(cD01);
      vec3 P = getViewPos(cUv, cZ);

      ivec2 fcL = ivec2(max(fc.x - 1, 0), fc.y);
      ivec2 fcR = ivec2(min(fc.x + 1, dSize.x - 1), fc.y);
      ivec2 fcD = ivec2(fc.x, max(fc.y - 1, 0));
      ivec2 fcU = ivec2(fc.x, min(fc.y + 1, dSize.y - 1));

      float dL = getLinearDepth(texelFetch(u_depth, fcL, 0).r);
      float dR = getLinearDepth(texelFetch(u_depth, fcR, 0).r);
      float dD = getLinearDepth(texelFetch(u_depth, fcD, 0).r);
      float dU = getLinearDepth(texelFetch(u_depth, fcU, 0).r);

      vec3 pL = getViewPos((vec2(fcL) + 0.5) * invDSize, dL);
      vec3 pR = getViewPos((vec2(fcR) + 0.5) * invDSize, dR);
      vec3 pD = getViewPos((vec2(fcD) + 0.5) * invDSize, dD);
      vec3 pU = getViewPos((vec2(fcU) + 0.5) * invDSize, dU);

      vec3 dPdx = (abs(dR - cZ) < abs(cZ - dL)) ? (pR - P) : (P - pL);
      vec3 dPdy = (abs(dU - cZ) < abs(cZ - dD)) ? (pU - P) : (P - pD);
      vec3 crossN = cross(dPdx, dPdy);
      float nLen = length(crossN);
      if (nLen < 1e-6) {
        outAO = 1.0;
        return;
      }
      vec3 N = crossN / nLen;

      float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float baseAngle = ign * 6.2831853;
      float screenRadX = u_radius / max(1.0, cZ * u_projScale.x * 2.0);
      float screenRadY = u_radius / max(1.0, cZ * u_projScale.y * 2.0);
      vec2 screenRad = min(vec2(screenRadX, screenRadY), vec2(0.15));

      float occ = 0.0;
      float fSamples = float(u_samples);
      for (int i = 0; i < 16; i++) {
        if (i >= u_samples) break;
        float frac = (float(i) + 0.5) / fSamples;
        float r = frac;
        float theta = baseAngle + float(i) * 2.3999632;
        vec2 offset = vec2(cos(theta), sin(theta)) * (r * screenRad);
        vec2 sUv = cUv + offset;
        if (sUv.x < 0.0 || sUv.x >= 1.0 || sUv.y < 0.0 || sUv.y >= 1.0) continue;

        ivec2 sFc = ivec2(sUv * fDSize);
        if (sFc == fc) continue;
        float sD01 = texelFetch(u_depth, sFc, 0).r;
        if (sD01 >= 0.9999) continue;

        vec2 sUvExact = (vec2(sFc) + 0.5) * invDSize;
        float sZ = getLinearDepth(sD01);
        vec3 sP = getViewPos(sUvExact, sZ);
        vec3 v = sP - P;
        float dist = length(v);
        if (dist > 0.001 && dist < u_radius) {
          float t = 1.0 - (dist / u_radius);
          float falloff = t * sqrt(t);
          occ += max(0.0, dot(N, v) / dist - 0.12) * falloff;
        }
      }
      float rawAO = clamp(1.0 - (occ / fSamples) * u_strength, 0.0, 1.0);
      outAO = pow(rawAO, u_power);
    }
  `;

  const AO_BLUR_FS = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    out float outBlurred;
    uniform sampler2D u_aoTex;
    uniform sampler2D u_depth;
    uniform float u_near;
    uniform float u_far;
    uniform float u_radius;
    uniform vec2 u_dir;

    float getLinearDepth(float d01) {
      float ndcZ = d01 * 2.0 - 1.0;
      return (2.0 * u_near * u_far) / max(0.0001, (u_far + u_near) - ndcZ * (u_far - u_near));
    }

    void main() {
      ivec2 dSize = textureSize(u_depth, 0);
      vec2 fDSize = vec2(dSize);
      ivec2 cFc = clamp(ivec2(v_uv * fDSize), ivec2(0), dSize - 1);
      float cD01 = texelFetch(u_depth, cFc, 0).r;
      if (cD01 >= 0.9999) {
        outBlurred = 1.0;
        return;
      }
      float cZ = getLinearDepth(cD01);
      vec2 texel = (1.0 / vec2(textureSize(u_aoTex, 0))) * u_dir;
      float sum = 0.0;
      float wSum = 0.0;
      float invTol = 1.0 / max(1.0, u_radius * 0.45);

      for (int k = -3; k <= 3; k++) {
        vec2 sUv = clamp(v_uv + float(k) * texel, vec2(0.0), vec2(0.9999));
        ivec2 sFc = clamp(ivec2(sUv * fDSize), ivec2(0), dSize - 1);
        float sD01 = texelFetch(u_depth, sFc, 0).r;
        if (sD01 >= 0.9999) continue;
        float sZ = getLinearDepth(sD01);
        float w = exp(-float(k * k) * 0.18) * exp(-abs(sZ - cZ) * invTol);
        sum += texture(u_aoTex, sUv).r * w;
        wSum += w;
      }
      outBlurred = (wSum > 0.0001) ? (sum / wSum) : 1.0;
    }
  `;

  const AO_COMP_FS = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    out vec4 fragColor;
    uniform sampler2D u_colorTex;
    uniform sampler2D u_aoTex;
    void main() {
      vec4 col = texture(u_colorTex, v_uv);
      if (col.a <= 0.001) {
        fragColor = vec4(0.0);
        return;
      }
      float ao = texture(u_aoTex, v_uv).r;
      fragColor = vec4(col.rgb * ao, col.a);
    }
  `;

  class FishToolEngineCore {
    constructor() {
      this.glCanvas = null;
      this.gl = null;
      this.program = null;
      this.buffers = null;
      this.locations = null;
      this.textureCache = new WeakMap();
      this.dynamicTexturePool = new Map();
      this.currentTexture = null;
      this.isReady = false;

      // Silhouette contour cache for true-shape extrusion (WeakMap<sourceEl, entry>)
      this._extrudeContourCache = new WeakMap();
      this._extrudeScratch = null;
      this._extrudeScratchCtx = null;

      // Shared-depth 3D scene motion blur: per-sample FBO + passthrough blit program
      this._sceneFbo = null;
      this._sceneFboTex = null;
      this._sceneFboDepth = null;
      this._sceneBlitProg = null;
      this._sceneBlitPosLoc = -1;
      this._sceneBlitTexLoc = null;
      this._sceneBlitQuad = null;
      this._sceneFboW = 0;
      this._sceneFboH = 0;
      this._sceneGLFailed = false;
      this.timeScale = 0.52; // Balanced smooth speed (~550ms duration)

      this._initGL();
    }

    _resetGpuResourceRefs() {
      this.program = null;
      this.buffers = null;
      this.locations = null;
      this.textureCache = new WeakMap();
      if (this.dynamicTexturePool) this.dynamicTexturePool.clear();
      this.currentTexture = null;
      this._envTexture = null;
      this._envFallbackTex = null;
      this._sceneFbo = null;
      this._sceneFboTex = null;
      this._sceneFboDepth = null;
      this._sceneBlitProg = null;
      this._sceneBlitQuad = null;
      this._sceneFboW = 0;
      this._sceneFboH = 0;
      this._ssaoFbo = null;
      this._ssaoTex = null;
      this._shadowFbo = null;
      this._shadowTex = null;
      this._reflFbo = null;
      this._reflTex = null;
      this._modelGpuCache = new WeakMap();
      this.isReady = false;
    }

    _initGL() {
      try {
        if (!this.glCanvas) {
          this.glCanvas = document.createElement('canvas');
          this.glCanvas.width = 1920;
          this.glCanvas.height = 1080;
          this.glCanvas.addEventListener('webglcontextlost', (e) => {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            this._contextLost = true;
            this._resetGpuResourceRefs();
            console.warn('FishToolEngine: WebGL context lost (heavy GPU load). Waiting to restore...');
          }, false);
          this.glCanvas.addEventListener('webglcontextrestored', () => {
            this._contextLost = false;
            this._initGL();
            if (typeof window !== 'undefined') {
              if (typeof window.syncProjectEnvironmentTexture === 'function') {
                try { window.syncProjectEnvironmentTexture(); } catch (_) {}
              }
              if (typeof window.redrawComposition === 'function') {
                window.redrawComposition('webglRestored');
              }
            }
          }, false);
        }

        const opts = {
          alpha: true,
          depth: true,
          premultipliedAlpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance'
        };

        this.gl = this.glCanvas.getContext('webgl2', opts) ||
                  this.glCanvas.getContext('webgl', opts) ||
                  this.glCanvas.getContext('experimental-webgl', opts);

        if (!this.gl || (typeof this.gl.isContextLost === 'function' && this.gl.isContextLost())) {
          console.warn('FishToolEngine: WebGL not supported or context lost, falling back to 2D.');
          return;
        }

        const gl = this.gl;
        this.isWebGL2 = Boolean(typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);

        // Pre-allocated scratch buffers/pools for zero-GC 3D rendering
        this._mvpScratchBounds = new Float32Array(16);
        this._mvpScratchDraw = new Float32Array(16);
        this._mvpScratchPad = new Float32Array(16);
        this._meshScratchMvp = new Float32Array(16);
        this._meshScratchModel = new Float32Array(16);
        this._zRangeScratch = new Float32Array(2);
        this._camScaleScratch = { x: 1, y: 1 };
        this._sceneBoundsScratch = [];
        this._sceneBatchScratch = [];
        this._batchPool = [];
        this._batchOpaqueScratch = [];
        this._batchTransScratch = [];

        // Compile Shaders
        const vs = this._compileShader(gl.VERTEX_SHADER, VS_SOURCE);
        const fs = this._compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          console.error('FishToolEngine Program Link Error:', gl.getProgramInfoLog(prog));
          return;
        }

        gl.disable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

        this.program = prog;

        // Attribute & Uniform Locations
        this.locations = {
          position: gl.getAttribLocation(prog, 'a_position'),
          normal: gl.getAttribLocation(prog, 'a_normal'),
          texCoord: gl.getAttribLocation(prog, 'a_texCoord'),
          color: gl.getAttribLocation(prog, 'a_color'),
          matrix: gl.getUniformLocation(prog, 'u_matrix'),
          modelMatrix: gl.getUniformLocation(prog, 'u_modelMatrix'),
          normalMatrix: gl.getUniformLocation(prog, 'u_normalMatrix'),
          texture: gl.getUniformLocation(prog, 'u_texture'),
          opacity: gl.getUniformLocation(prog, 'u_opacity'),
          noDiscard: gl.getUniformLocation(prog, 'u_noDiscard'),
          mode: gl.getUniformLocation(prog, 'u_mode'),
          lensDistort: gl.getUniformLocation(prog, 'u_lensDistort'),
          numLights: gl.getUniformLocation(prog, 'u_numLights'),
          lightTypes: gl.getUniformLocation(prog, 'u_lightTypes'),
          lightColors: gl.getUniformLocation(prog, 'u_lightColors'),
          lightIntensities: gl.getUniformLocation(prog, 'u_lightIntensities'),
          lightPositions: gl.getUniformLocation(prog, 'u_lightPositions'),
          lightDirections: gl.getUniformLocation(prog, 'u_lightDirections'),
          lightRadii: gl.getUniformLocation(prog, 'u_lightRadii'),
          materialParams: gl.getUniformLocation(prog, 'u_materialParams'),
          matExtra: gl.getUniformLocation(prog, 'u_matExtra'),
          envMap: gl.getUniformLocation(prog, 'u_envMap'),
          viewPos: gl.getUniformLocation(prog, 'u_viewPos'),
          shadowMap: gl.getUniformLocation(prog, 'u_shadowMap'),
          lightViewProj: gl.getUniformLocation(prog, 'u_lightViewProj'),
          shadowParams: gl.getUniformLocation(prog, 'u_shadowParams'),
          sceneColorTex: gl.getUniformLocation(prog, 'u_sceneColorTex'),
          sceneDepthTex: gl.getUniformLocation(prog, 'u_sceneDepthTex'),
          cameraVP: gl.getUniformLocation(prog, 'u_cameraVP'),
          reflParams: gl.getUniformLocation(prog, 'u_reflParams')
        };

        // Compile Dedicated Hardware RGB Split & Frame Blend Shaders
        try {
          const rgbVs = this._compileShader(gl.VERTEX_SHADER, RGB_SPLIT_VS);
          const rgbFs = this._compileShader(gl.FRAGMENT_SHADER, RGB_SPLIT_FS);
          const rgbProg = gl.createProgram();
          gl.attachShader(rgbProg, rgbVs);
          gl.attachShader(rgbProg, rgbFs);
          gl.linkProgram(rgbProg);
          if (gl.getProgramParameter(rgbProg, gl.LINK_STATUS)) {
            this.rgbSplitProgram = rgbProg;
            this.rgbLocations = {
              pos: gl.getAttribLocation(rgbProg, 'a_pos'),
              uv: gl.getAttribLocation(rgbProg, 'a_uv'),
              image: gl.getUniformLocation(rgbProg, 'u_image'),
              delta: gl.getUniformLocation(rgbProg, 'u_delta'),
              opacity: gl.getUniformLocation(rgbProg, 'u_opacity')
            };
          }

          const blendFs = this._compileShader(gl.FRAGMENT_SHADER, FRAME_BLEND_FS);
          const blendProg = gl.createProgram();
          gl.attachShader(blendProg, rgbVs);
          gl.attachShader(blendProg, blendFs);
          gl.linkProgram(blendProg);
          if (gl.getProgramParameter(blendProg, gl.LINK_STATUS)) {
            this.frameBlendProgram = blendProg;
            this.blendLocations = {
              pos: gl.getAttribLocation(blendProg, 'a_pos'),
              uv: gl.getAttribLocation(blendProg, 'a_uv'),
              tex0: gl.getUniformLocation(blendProg, 'u_tex0'),
              tex1: gl.getUniformLocation(blendProg, 'u_tex1'),
              alpha: gl.getUniformLocation(blendProg, 'u_alpha')
            };
          }
        } catch (_) {}

        // Tessellated unit quad (N x N grid) centered at origin: [-0.5, 0.5].
        // Subdivision is required because the vertex shader applies non-linear lens distortion
        // per vertex; a bare 4-vertex quad would crease along its diagonal (warped text middle).
        const N = 10;
        const positions = new Float32Array((N + 1) * (N + 1) * 2);
        const texCoords = new Float32Array((N + 1) * (N + 1) * 2);
        const indices = new Uint16Array(N * N * 6);
        let pi = 0;
        for (let gy = 0; gy <= N; gy++) {
          for (let gx = 0; gx <= N; gx++) {
            positions[pi] = gx / N - 0.5;
            positions[pi + 1] = gy / N - 0.5;
            texCoords[pi] = gx / N;
            texCoords[pi + 1] = gy / N;
            pi += 2;
          }
        }
        let ii = 0;
        for (let gy = 0; gy < N; gy++) {
          for (let gx = 0; gx < N; gx++) {
            const i0 = gy * (N + 1) + gx;
            const i1 = i0 + 1;
            const i3 = i0 + (N + 1);
            const i2 = i3 + 1;
            indices[ii++] = i0; indices[ii++] = i1; indices[ii++] = i2;
            indices[ii++] = i0; indices[ii++] = i2; indices[ii++] = i3;
          }
        }
        this.quadIndexCount = indices.length;

        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        const texBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        const idxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        this.buffers = {
          position: posBuffer,
          texCoord: texBuffer,
          index: idxBuffer
        };

        // Dedicated dynamic buffers for 3D volumetric meshes (Box, Extrude, Pyramid, Sphere)
        this.meshBuffers = {
          position: gl.createBuffer(),
          normal: gl.createBuffer(),
          texCoord: gl.createBuffer(),
          color: gl.createBuffer(),
          index: gl.createBuffer()
        };

        gl.useProgram(this.program);
        gl.uniform1i(this.locations.mode, 0);
        if (this.locations.noDiscard) gl.uniform1f(this.locations.noDiscard, 0);
        gl.disableVertexAttribArray(this.locations.color);
        gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
        if (this.locations.normal !== -1) {
          gl.disableVertexAttribArray(this.locations.normal);
          gl.vertexAttrib3f(this.locations.normal, 0.0, 0.0, 1.0);
        }
        if (this.locations.modelMatrix) {
          gl.uniformMatrix4fv(this.locations.modelMatrix, false, new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]));
        }
        if (this.locations.normalMatrix) {
          gl.uniformMatrix3fv(this.locations.normalMatrix, false, new Float32Array([1,0,0, 0,1,0, 0,0,1]));
        }
        if (this.locations.numLights) gl.uniform1i(this.locations.numLights, 0);
        if (this.locations.materialParams) gl.uniform4f(this.locations.materialParams, 0.0, 1.0, 0.5, 0.5);
        if (this.locations.matExtra) gl.uniform4f(this.locations.matExtra, 0.0, 0.0, 1.0, 0.0);

        // 1x1 neutral fallback texture for u_envMap (TEXTURE1)
        this._envFallbackTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._envFallbackTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (this.locations.envMap) gl.uniform1i(this.locations.envMap, 1);

        // 1x1 fallback textures for Shadow Map (TEXTURE2) and Reflection Scene Color/Depth (TEXTURE3/4)
        this._whiteFallbackTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this._whiteFallbackTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (this.locations.shadowMap) gl.uniform1i(this.locations.shadowMap, 2);
        if (this.locations.shadowParams) gl.uniform4f(this.locations.shadowParams, 0.0, 0.0, 1.0 / 1024.0, 0.85);
        const idMat4 = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
        if (this.locations.lightViewProj) gl.uniformMatrix4fv(this.locations.lightViewProj, false, idMat4);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this._envFallbackTex);
        if (this.locations.sceneColorTex) gl.uniform1i(this.locations.sceneColorTex, 3);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, this._whiteFallbackTex);
        if (this.locations.sceneDepthTex) gl.uniform1i(this.locations.sceneDepthTex, 4);
        if (this.locations.cameraVP) gl.uniformMatrix4fv(this.locations.cameraVP, false, idMat4);
        if (this.locations.reflParams) gl.uniform4f(this.locations.reflParams, 0.0, 1200.0, 50.0, 0.025);

        gl.activeTexture(gl.TEXTURE0);
        this._hasEnvMap = false;
        this._envTexture = null;
        this._envSourceRef = null;

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        this.isReady = true;
        if (this._pendingEnvImg) {
          const pImg = this._pendingEnvImg;
          this._pendingEnvImg = null;
          this.setEnvironmentImage(pImg);
        }
      } catch (err) {
        console.error('FishToolEngine Init Failed:', err);
      }
    }

    setLightingData(data) {
      this._lightingData = data || null;
    }

    setEnvironmentImage(imgEl) {
      const gl = this.gl;
      if (!gl || !this.isReady) {
        this._pendingEnvImg = imgEl || null;
        return;
      }
      if (!imgEl || !this._hasValidDimensions(imgEl)) {
        this._hasEnvMap = false;
        this._envSourceRef = null;
        return;
      }
      if (this._envSourceRef === imgEl && this._hasEnvMap) return;
      try {
        if (!this._envScratchCanvas) {
          this._envScratchCanvas = document.createElement('canvas');
          this._envScratchCanvas.width = 512;
          this._envScratchCanvas.height = 256;
          this._envScratchCtx = this._envScratchCanvas.getContext('2d');
        }
        const ectx = this._envScratchCtx;
        if (!ectx) return;
        ectx.clearRect(0, 0, 512, 256);
        ectx.drawImage(imgEl, 0, 0, 512, 256);

        if (!this._envTexture) {
          this._envTexture = gl.createTexture();
        }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._envTexture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._envScratchCanvas);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.activeTexture(gl.TEXTURE0);
        this._hasEnvMap = true;
        this._envSourceRef = imgEl;
      } catch (err) {
        console.warn('FishToolEngine setEnvironmentImage failed:', err);
        this._hasEnvMap = false;
        this._envSourceRef = null;
      }
    }

    _getSlotMaterial(layer, slotOverride) {
      if (slotOverride) return slotOverride;
      if (layer && Array.isArray(layer.materialSlots) && layer.materialSlots.length > 0) {
        return layer.materialSlots[0];
      }
      return (layer && layer.materialOptions) || {};
    }

    applyMaterialSlot(gl, layer, slot, fallbackEl, finalOpacity, baseColorRgb, baseHasTex) {
      const loc = this.locations;
      if (!gl || !loc) return false;
      if (this._inShadowPass) {
        gl.uniform1i(loc.mode, 1);
        gl.vertexAttrib4f(loc.color, 1.0, 1.0, 1.0, 1.0);
        return false;
      }
      const ps = (typeof window !== 'undefined' && window.currentProjectState) ? window.currentProjectState : null;
      const isAdvance = Boolean(ps && ps.threeDEngine === 'advance');
      const mat = slot || this._getSlotMaterial(layer, null);

      if (isAdvance) {
        const acceptsLights = mat.acceptsLights !== false;
        const diffuse = (mat.diffuse !== undefined ? Number(mat.diffuse) : 100) / 100;
        const specular = (mat.specular !== undefined ? Number(mat.specular) : 50) / 100;
        const roughness = (mat.roughness !== undefined ? Number(mat.roughness) : 50) / 100;
        const glossy = (mat.glossy !== undefined ? Number(mat.glossy) : 0) / 100;
        const metallic = (mat.metallic !== undefined ? Number(mat.metallic) : 0) / 100;
        const envRefl = (mat.envReflection !== undefined ? Number(mat.envReflection) : 100) / 100;
        const hasEnv = this._hasEnvMap ? 1.0 : 0.0;
        const hasReflOrEnv = (hasEnv > 0.5 || this._activeReflPass);
        const activeFlag = (acceptsLights || (hasReflOrEnv && (glossy > 0.005 || metallic > 0.005))) ? 1.0 : 0.0;
        if (loc.materialParams) {
          gl.uniform4f(loc.materialParams, activeFlag, diffuse, specular, roughness);
        }
        if (loc.matExtra) {
          gl.uniform4f(loc.matExtra, glossy, metallic, envRefl, hasEnv);
        }
      }

      const mode = (slot && slot.surfaceMode) || 'inherit';
      if (mode === 'media' && slot && slot.mediaId && typeof window !== 'undefined' && typeof window.getMaterialMediaImage === 'function') {
        const slotImg = window.getMaterialMediaImage(slot.mediaId);
        if (slotImg && this._hasValidDimensions(slotImg)) {
          const tex = this._getOrCreateTexture(slotImg);
          if (tex) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(loc.texture, 0);
            gl.uniform1i(loc.mode, 0);
            gl.vertexAttrib4f(loc.color, 1.0, 1.0, 1.0, finalOpacity);
            return true;
          }
        }
      }
      if (mode === 'solid' && slot && slot.color) {
        const sc = hexToRgb(slot.color);
        gl.uniform1i(loc.mode, 1);
        gl.vertexAttrib4f(loc.color, sc.r / 255, sc.g / 255, sc.b / 255, finalOpacity);
        return false;
      }
      if (baseHasTex && fallbackEl) {
        const baseTex = this._getOrCreateTexture(fallbackEl);
        if (baseTex) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, baseTex);
          gl.uniform1i(loc.texture, 0);
        }
        gl.uniform1i(loc.mode, 0);
        gl.vertexAttrib4f(loc.color, 1.0, 1.0, 1.0, finalOpacity);
        return true;
      }
      gl.uniform1i(loc.mode, 1);
      gl.vertexAttrib4f(loc.color, baseColorRgb.r / 255, baseColorRgb.g / 255, baseColorRgb.b / 255, finalOpacity);
      return false;
    }

    _applyLightingUniforms(gl, layer, camera, bounds, vw, vh, slotOverride = null) {
      const loc = this.locations;
      if (!loc) return;
      if (this._inShadowPass) {
        if (loc.numLights) gl.uniform1i(loc.numLights, 0);
        if (loc.materialParams) gl.uniform4f(loc.materialParams, 0.0, 1.0, 0.5, 0.5);
        return;
      }
      const ps = (typeof window !== 'undefined' && window.currentProjectState) ? window.currentProjectState : null;
      const isAdvance = Boolean(ps && ps.threeDEngine === 'advance');
      const mat = this._getSlotMaterial(layer, slotOverride);
      const acceptsLights = mat.acceptsLights !== false;
      const glossy = (mat.glossy !== undefined ? Number(mat.glossy) : 0) / 100;
      const metallic = (mat.metallic !== undefined ? Number(mat.metallic) : 0) / 100;
      const envRefl = (mat.envReflection !== undefined ? Number(mat.envReflection) : 100) / 100;
      const hasEnv = (isAdvance && this._hasEnvMap) ? 1.0 : 0.0;

      const lighting = this._lightingData;
      const customNumLights = (isAdvance && acceptsLights && lighting && lighting.numLights > 0) ? lighting.numLights : 0;
      const is3DMeshLayer = Boolean(
        layer && (
          layer.shapeType === '3d_model' ||
          (typeof layer.shapeType === 'string' && layer.shapeType.startsWith('3d_')) ||
          (Number(layer.extrudeDepth) || 0) > 0
        )
      );
      const useDefaultAdvanceRig = Boolean(isAdvance && acceptsLights && customNumLights === 0 && is3DMeshLayer);
      const numLights = useDefaultAdvanceRig ? 3 : customNumLights;
      const hasReflOrEnv = (hasEnv > 0.5 || Boolean(this._activeReflPass));
      const needShading = isAdvance && (numLights > 0 || (hasReflOrEnv && (glossy > 0.005 || metallic > 0.005) && envRefl > 0.005));

      if (loc.numLights) {
        gl.uniform1i(loc.numLights, numLights);
      }

      if (loc.envMap) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, (hasEnv > 0.5 && this._envTexture) ? this._envTexture : this._envFallbackTex);
        gl.uniform1i(loc.envMap, 1);
        gl.activeTexture(gl.TEXTURE0);
      }

      if (needShading) {
        const bScale = (bounds && bounds.bufferScale) || 1;
        if (useDefaultAdvanceRig) {
          if (!this._defaultAdvanceLights) {
            this._defaultAdvanceLights = {
              types: new Int32Array([0, 1, 1, 0]),
              colors: new Float32Array([
                0.96, 0.98, 1.0,
                1.0, 0.97, 0.92,
                0.78, 0.88, 1.0,
                0.0, 0.0, 0.0
              ]),
              intensities: new Float32Array([0.42, 0.85, 0.38, 0.0]),
              positions: new Float32Array(12),
              directions: new Float32Array([
                0.0, 0.0, -1.0,
                -0.45, -0.60, -0.66,
                0.60, 0.25, 0.76,
                0.0, 0.0, -1.0
              ]),
              radii: new Float32Array([1000, 1000, 1000, 1000])
            };
          }
          const dl = this._defaultAdvanceLights;
          if (loc.lightTypes) gl.uniform1iv(loc.lightTypes, dl.types);
          if (loc.lightColors) gl.uniform3fv(loc.lightColors, dl.colors);
          if (loc.lightIntensities) gl.uniform1fv(loc.lightIntensities, dl.intensities);
          if (loc.lightPositions) gl.uniform3fv(loc.lightPositions, dl.positions);
          if (loc.lightDirections) gl.uniform3fv(loc.lightDirections, dl.directions);
          if (loc.lightRadii) gl.uniform1fv(loc.lightRadii, dl.radii);
        } else if (numLights > 0) {
          if (!this._scaledLightPositions) {
            this._scaledLightPositions = new Float32Array(12);
            this._scaledLightRadii = new Float32Array(4);
          }

          if (loc.lightTypes) gl.uniform1iv(loc.lightTypes, lighting.types || lighting.lightTypes);
          if (loc.lightColors) gl.uniform3fv(loc.lightColors, lighting.colors || lighting.lightColors);
          if (loc.lightIntensities) gl.uniform1fv(loc.lightIntensities, lighting.intensities || lighting.lightIntensities);

          const rawPos = lighting.positions || lighting.lightPositions;
          if (rawPos) {
            for (let p = 0; p < 12; p++) {
              this._scaledLightPositions[p] = rawPos[p] * bScale;
            }
            if (loc.lightPositions) gl.uniform3fv(loc.lightPositions, this._scaledLightPositions);
          }

          if (loc.lightDirections) gl.uniform3fv(loc.lightDirections, lighting.directions || lighting.lightDirections);

          const rawRadii = lighting.radii || lighting.lightRadii;
          if (rawRadii) {
            for (let r = 0; r < 4; r++) {
              this._scaledLightRadii[r] = rawRadii[r] * bScale;
            }
            if (loc.lightRadii) gl.uniform1fv(loc.lightRadii, this._scaledLightRadii);
          }
        }

        const diffuse = (mat.diffuse !== undefined ? Number(mat.diffuse) : 100) / 100;
        const specular = (mat.specular !== undefined ? Number(mat.specular) : 50) / 100;
        const roughness = (mat.roughness !== undefined ? Number(mat.roughness) : 50) / 100;

        if (loc.materialParams) {
          gl.uniform4f(loc.materialParams, 1.0, diffuse, specular, roughness);
        }
        if (loc.matExtra) {
          gl.uniform4f(loc.matExtra, glossy, metallic, envRefl, hasEnv);
        }

        if (loc.viewPos) {
          const activeCam = camera || this._activeCamera || null;
          const activeVw = this._activeVw || vw || (bounds && bounds.w) || 0;
          const activeVh = this._activeVh || vh || (bounds && bounds.h) || 0;
          const camLens = Math.max(1, activeCam && activeCam.cameraLens !== undefined ? activeCam.cameraLens : 50);
          const lensFactor = Math.max(0.01, camLens / 50);
          const D = CAMERA_DISTANCE * lensFactor * bScale;
          const camX = (activeVw / 2) + (activeCam ? (activeCam.posX || 0) * bScale : 0);
          const camY = (activeVh / 2) + (activeCam ? (activeCam.posY || 0) * bScale : 0);
          const camZ = (activeCam ? (activeCam.posZ || 0) * bScale : 0) + D;
          gl.uniform3f(loc.viewPos, camX, camY, camZ);
        }
      } else {
        if (loc.materialParams) {
          gl.uniform4f(loc.materialParams, 0.0, 1.0, 0.5, 0.5);
        }
        if (loc.matExtra) {
          gl.uniform4f(loc.matExtra, 0.0, 0.0, 1.0, 0.0);
        }
      }

      if (this._currentModelMatrix && loc.modelMatrix) {
        gl.uniformMatrix4fv(loc.modelMatrix, false, this._currentModelMatrix);
      }
      if (this._currentNormalMatrix && loc.normalMatrix) {
        gl.uniformMatrix3fv(loc.normalMatrix, false, this._currentNormalMatrix);
      }
    }

    _compileShader(type, src) {
      const gl = this.gl;
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('FishToolEngine Shader Compile Error:', gl.getShaderInfoLog(s));
      }
      return s;
    }

    _getProjectViewport(bufferScale = 1, layer = null) {
      let pw = 1920;
      let ph = 1080;
      if (layer && layer._baseW && layer._baseH) {
        pw = layer._baseW;
        ph = layer._baseH;
      } else if (typeof window !== 'undefined' && window.currentProjectState) {
        const ps = window.currentProjectState;
        if (ps._nativeBaseW && ps._nativeBaseH && (!ps.aspectRatio || ps.aspectRatio === ps._nativeAspect)) {
          pw = ps._nativeBaseW;
          ph = ps._nativeBaseH;
        } else if (typeof window.getProjectDimensions === 'function' && ps.resolution && ps.aspectRatio) {
          const dims = window.getProjectDimensions(ps.resolution, ps.aspectRatio);
          if (dims && dims[0] && dims[1]) {
            pw = dims[0];
            ph = dims[1];
          }
        } else if (ps.baseW && ps.baseH) {
          pw = ps.baseW;
          ph = ps.baseH;
        } else if (ps.width && ps.height) {
          pw = ps.width;
          ph = ps.height;
        }
      } else if (this.glCanvas && this.glCanvas.width > 0 && this.glCanvas.height > 0) {
        pw = this.glCanvas.width / (bufferScale || 1);
        ph = this.glCanvas.height / (bufferScale || 1);
      }
      return {
        vw: pw * (bufferScale || 1),
        vh: ph * (bufferScale || 1)
      };
    }

    _hasValidDimensions(el) {
      if (!el) return false;
      if (el.tagName === 'AUDIO' || (typeof HTMLAudioElement !== 'undefined' && el instanceof HTMLAudioElement)) {
        return false;
      }
      if (el.tagName === 'VIDEO') {
        return el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0;
      }
      if (el.tagName === 'IMG') {
        return el.complete && el.naturalWidth > 0 && el.naturalHeight > 0;
      }
      if (typeof el.displayWidth === 'number' && typeof el.displayHeight === 'number') {
        return el.displayWidth > 0 && el.displayHeight > 0;
      }
      if (typeof el.width === 'number' && typeof el.height === 'number') {
        return el.width > 0 && el.height > 0;
      }
      return false;
    }

    _getElementDimensions(el) {
      if (!el) return { w: 0, h: 0 };
      if (el.tagName === 'VIDEO') return { w: el.videoWidth || 0, h: el.videoHeight || 0 };
      if (el.tagName === 'IMG') return { w: el.naturalWidth || el.width || 0, h: el.naturalHeight || el.height || 0 };
      if (typeof el.displayWidth === 'number') return { w: el.displayWidth || 0, h: el.displayHeight || 0 };
      return { w: el.width || 0, h: el.height || 0 };
    }

    _createConfiguredTexture(gl) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      tex._texW = 0;
      tex._texH = 0;
      tex._lastUploadedEl = null;
      tex._lastVideoTime = -1;
      return tex;
    }

    _uploadToTexture(gl, tex, el, ew, eh) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // WebGL spec: UNPACK_PREMULTIPLY_ALPHA_WEBGL=true guarantees the GPU texture stores
      // premultiplied RGBA (matching gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA) and FS_SOURCE).
      // Setting false for HTMLCanvasElement/ImageBitmap forces WebGL to un-premultiply RGB/A,
      // blowing up semi-transparent glow/alpha pixels into solid white super-luminous blobs!
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      if (ew > 0 && eh > 0 && tex._texW === ew && tex._texH === eh) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, el);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        tex._texW = ew;
        tex._texH = eh;
      }
      tex._lastUploadedEl = el;
    }

    _getOrCreateTexture(el) {
      if (!this._hasValidDimensions(el) || el === this.glCanvas) return null;
      const gl = this.gl;
      if (!gl || (typeof gl.isContextLost === 'function' && gl.isContextLost())) return null;
      let uploadEl = el;
      let { w: ew, h: eh } = this._getElementDimensions(el);
      if (ew <= 0 || eh <= 0) return null;

      // Downscale oversized static images (e.g. 4K/8K 3D model textures) to prevent mobile GPU OOM / black canvas
      const isMobileGpu = (typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || ''));
      const maxTexDim = isMobileGpu ? 1024 : 2048;
      if (el.tagName === 'IMG' && (ew > maxTexDim || eh > maxTexDim)) {
        if (!el._oftsDownscaledCanvas) {
          const scale = Math.min(maxTexDim / ew, maxTexDim / eh);
          const dw = Math.max(1, Math.round(ew * scale));
          const dh = Math.max(1, Math.round(eh * scale));
          const sc = document.createElement('canvas');
          sc.width = dw;
          sc.height = dh;
          const sctx = sc.getContext('2d');
          if (sctx) {
            sctx.drawImage(el, 0, 0, dw, dh);
            el._oftsDownscaledCanvas = sc;
          }
        }
        if (el._oftsDownscaledCanvas) {
          uploadEl = el._oftsDownscaledCanvas;
          ew = uploadEl.width;
          eh = uploadEl.height;
        }
      }

      // Fast path for streaming video frames (ImageBitmap / VideoFrame / HTMLVideoElement):
      // Reuse a single WebGLTexture per video stream key via gl.texSubImage2D instead of allocating
      // a new WebGLTexture per frame (saves ~1.5ms/frame and prevents GPU VRAM fragmentation).
      const isVideoEl = (el.tagName === 'VIDEO');
      const isStreamBitmap = !!(el._streamKey || (typeof ImageBitmap !== 'undefined' && el instanceof ImageBitmap) || (typeof VideoFrame !== 'undefined' && el instanceof VideoFrame));

      if (isVideoEl || isStreamBitmap) {
        const poolKey = el._streamKey || (isVideoEl ? ('vid_' + (el.src || 'default')) : 'stream_bitmap_shared');
        let tex = this.dynamicTexturePool.get(poolKey);
        if (!tex) {
          if (this.dynamicTexturePool.size >= 24) {
            const oldestKey = this.dynamicTexturePool.keys().next().value;
            const oldTex = this.dynamicTexturePool.get(oldestKey);
            this.dynamicTexturePool.delete(oldestKey);
            if (oldTex) {
              try { gl.deleteTexture(oldTex); } catch (_) {}
            }
          }
          tex = this._createConfiguredTexture(gl);
          this.dynamicTexturePool.set(poolKey, tex);
        } else {
          gl.bindTexture(gl.TEXTURE_2D, tex);
        }

        // Skip redundant GPU upload if the exact same frame/timestamp is already resident in VRAM
        if (isVideoEl) {
          const curVidTime = el.currentTime || 0;
          if (tex._lastUploadedEl === el && tex._texW === ew && tex._texH === eh && Math.abs(tex._lastVideoTime - curVidTime) < 0.0005) {
            return tex;
          }
          try {
            this._uploadToTexture(gl, tex, el, ew, eh);
            tex._lastVideoTime = curVidTime;
          } catch (_) {}
          return tex;
        } else {
          if (tex._lastUploadedEl === el && tex._texW === ew && tex._texH === eh) {
            return tex;
          }
          try {
            this._uploadToTexture(gl, tex, el, ew, eh);
          } catch (_) {}
          return tex;
        }
      }

      let tex = this.textureCache.get(el);
      if (!tex) {
        tex = this._createConfiguredTexture(gl);
        // Pre-initialize with a 1x1 transparent RGBA pixel so texture is never incomplete
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        this.textureCache.set(el, tex);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, tex);
      }

      try {
        const isStaticImg = (el.tagName === 'IMG');
        const src = el.src || '';
        if (isStaticImg) {
          if (tex._uploadedSrc !== src || tex._texW !== ew || tex._texH !== eh) {
            this._uploadToTexture(gl, tex, uploadEl, ew, eh);
            if (src) tex._uploadedSrc = src;
          }
        } else if (el.tagName === 'CANVAS') {
          const ver = el._contentVersion;
          if (ver === undefined || tex._uploadedVersion !== ver || tex._texW !== ew || tex._texH !== eh) {
            this._uploadToTexture(gl, tex, el, ew, eh);
            if (ver !== undefined) tex._uploadedVersion = ver;
          }
        } else {
          this._uploadToTexture(gl, tex, el, ew, eh);
        }
      } catch (_) {}

      return tex;
    }

    /**
     * Hardware-Accelerated WebGL Frame Blender (5x faster than Canvas2D drawImage alpha blend)
     * Blends frame0 and frame1 with factor alpha on the GPU using reusable textures.
     */
    blendFramesToCanvas(frame0, frame1, alpha, w, h, targetCanvas = null) {
      if (!this.isReady || !this.frameBlendProgram || !this.gl || !frame0 || !frame1) return null;
      const gl = this.gl;
      const bw = Math.max(1, Math.round(w || 960));
      const bh = Math.max(1, Math.round(h || 540));

      try {
        if (this.glCanvas.width !== bw || this.glCanvas.height !== bh) {
          this.glCanvas.width = bw;
          this.glCanvas.height = bh;
        }
        gl.viewport(0, 0, bw, bh);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);

        if (!this._blendTex0) this._blendTex0 = this._createConfiguredTexture(gl);
        if (!this._blendTex1) this._blendTex1 = this._createConfiguredTexture(gl);

        const d0 = this._getElementDimensions(frame0);
        const d1 = this._getElementDimensions(frame1);
        if (this._blendTex0._lastUploadedEl !== frame0) {
          this._uploadToTexture(gl, this._blendTex0, frame0, d0.w, d0.h);
        }
        if (this._blendTex1._lastUploadedEl !== frame1) {
          this._uploadToTexture(gl, this._blendTex1, frame1, d1.w, d1.h);
        }

        gl.useProgram(this.frameBlendProgram);

        if (!this._fsQuadBuffer) {
          this._fsQuadBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, this._fsQuadBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
             1.0,  1.0,
            -1.0,  1.0
          ]), gl.STATIC_DRAW);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this._fsQuadBuffer);
        gl.enableVertexAttribArray(this.blendLocations.pos);
        gl.vertexAttribPointer(this.blendLocations.pos, 2, gl.FLOAT, false, 0, 0);

        if (!this._fxTexCoordBuffer) {
          this._fxTexCoordBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, this._fxTexCoordBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0.0, 1.0,
            1.0, 1.0,
            1.0, 0.0,
            0.0, 0.0
          ]), gl.STATIC_DRAW);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this._fxTexCoordBuffer);
        gl.enableVertexAttribArray(this.blendLocations.uv);
        gl.vertexAttribPointer(this.blendLocations.uv, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._blendTex0);
        gl.uniform1i(this.blendLocations.tex0, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._blendTex1);
        gl.uniform1i(this.blendLocations.tex1, 1);

        gl.uniform1f(this.blendLocations.alpha, Math.max(0, Math.min(1, alpha)));

        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

        gl.activeTexture(gl.TEXTURE0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        const outCanvas = targetCanvas || document.createElement('canvas');
        if (outCanvas.width !== bw || outCanvas.height !== bh) {
          outCanvas.width = bw;
          outCanvas.height = bh;
        }
        const outCtx = outCanvas._cachedBlendCtx || (outCanvas._cachedBlendCtx = outCanvas.getContext('2d', { alpha: false }));
        if (outCtx) {
          outCtx.drawImage(this.glCanvas, 0, 0, bw, bh);
          outCanvas._contentVersion = (outCanvas._contentVersion || 0) + 1;
          return outCanvas;
        }
      } catch (_) {}
      return null;
    }

    _getLensDistort(camera) {
      if (!camera) return 0.0;
      const camLens = camera.cameraLens !== undefined ? camera.cameraLens : 50;
      if (camLens < 50) {
        return Math.max(0.0, ((50 - camLens) / 50) * 0.45);
      } else if (camLens > 50) {
        return Math.min(0.0, -((camLens - 50) / 250) * 0.08);
      }
      return 0.0;
    }

    _getEffectProcessedElement(el, layer, bounds, currentSec = null) {
      if (!el || typeof document === 'undefined') return { el, padX: 0, padY: 0, origW: bounds.w || 100, origH: bounds.h || 100 };
      const isPrecompCollapsed = (layer && layer.type === 'precomp' && !!layer.collapseTransformations);
      const rVal = (!isPrecompCollapsed && layer && typeof layer.roundness === 'number') ? layer.roundness : 0;
      const rawEffects = Array.isArray(layer && layer.effects) ? layer.effects : [];
      const activeFx = rawEffects.filter(f => f && !f.disabled &&
        f.type !== 'tile' &&
        f.type !== 'rgb-split' &&
        f.type !== 'drop-shadow' &&
        f.type !== 'deep-glow' &&
        f.type !== 'box_3d' &&
        f.type !== 'extrude_3d' &&
        f.type !== 'pyramid_3d' &&
        f.type !== 'sphere_3d'
      );
      if (activeFx.length === 0 && rVal <= 0) {
        return { el, padX: 0, padY: 0, origW: bounds.w || 100, origH: bounds.h || 100 };
      }

      const nw = (el.naturalWidth || el.videoWidth || el.width || Math.abs(bounds.w) || 500);
      const nh = (el.naturalHeight || el.videoHeight || el.height || Math.abs(bounds.h) || 500);
      let w = Math.max(1, Math.round(nw));
      let h = Math.max(1, Math.round(nh));
      if (activeFx.some(f => f.type === 'particle-engine')) {
        const bw = Math.abs(bounds.absW || bounds.w || 0);
        const bh = Math.abs(bounds.absH || bounds.h || 0);
        if (bw >= 1 && bh >= 1) {
          const k = Math.min(1, 2048 / Math.max(bw, bh));
          w = Math.max(1, Math.round(bw * k));
          h = Math.max(1, Math.round(bh * k));
        }
      }

      let padX = 0;
      let padY = 0;
      const hasExpanding = activeFx.some(f => {
        const d = (window.FishEffectsRegistry && window.FishEffectsRegistry.get) ? window.FishEffectsRegistry.get(f.type) : null;
        if ((d && (d.isExpanding || d.category === 'warp')) || f.type === 'transform') return true;
        if (f.type === 'deep-glow' && (f.outLayer === 1 || f.outLayer === true || f.outLayer === '1' || f.outLayer === 'true' || f.outLayer === 'on')) return true;
        return false;
      });
      if (hasExpanding) {
        let maxRad = 80;
        const dg = activeFx.find(f => f.type === 'deep-glow' && (f.outLayer === 1 || f.outLayer === true || f.outLayer === '1' || f.outLayer === 'true' || f.outLayer === 'on'));
        if (dg && dg.radius !== undefined) maxRad = Math.max(maxRad, Number(dg.radius) || 80);
        const pad = Math.min(600, Math.ceil(maxRad * 1.1 + 24));
        padX = pad;
        padY = pad;
      }

      const fullW = w + padX * 2;
      const fullH = h + padY * 2;

      if (!this._fxCanvas) {
        this._fxCanvas = document.createElement('canvas');
        this._fxCtx = this._fxCanvas.getContext('2d');
      }
      if (this._fxCanvas.width !== fullW || this._fxCanvas.height !== fullH) {
        this._fxCanvas.width = fullW;
        this._fxCanvas.height = fullH;
      }
      this._fxCtx.clearRect(0, 0, fullW, fullH);

      const fakeLayer = Object.assign({}, layer, { effects: activeFx });
      const curSec = (typeof currentSec === 'number' && !isNaN(currentSec))
        ? currentSec
        : ((layer && typeof layer._currentSec === 'number')
          ? layer._currentSec
          : ((typeof window !== 'undefined' && typeof window._currentRenderSec === 'number')
            ? window._currentRenderSec
            : ((typeof window !== 'undefined' && typeof window.currentPlaybackSec === 'number')
              ? window.currentPlaybackSec
              : 0)));
      // unitScale = effect-space px per comp px. Effects are rendered at media size here, then the quad
      // is scaled to the layer → comp-px distances must be expressed in media px.
      const bScaleFx = (bounds && bounds.bufferScale) || 1;
      const quadCompW = Math.abs(bounds && (bounds.absW || bounds.w) || 0) / bScaleFx;
      const unitScale = quadCompW > 0 ? (w / quadCompW) : 1;

      if (rVal > 0) {
        this._fxCtx.save();
        const maxR = Math.min(w, h) / 2;
        const scaleK = w / Math.max(1, Math.abs((bounds && (bounds.absW || bounds.w)) || w));
        const r = Math.min(rVal * scaleK, maxR);
        this._fxCtx.beginPath();
        if (typeof this._fxCtx.roundRect === 'function') {
          this._fxCtx.roundRect(padX, padY, w, h, r);
        } else {
          this._fxCtx.moveTo(padX + r, padY);
          this._fxCtx.arcTo(padX + w, padY, padX + w, padY + h, r);
          this._fxCtx.arcTo(padX + w, padY + h, padX, padY + h, r);
          this._fxCtx.arcTo(padX, padY + h, padX, padY, r);
          this._fxCtx.arcTo(padX, padY, padX + w, padY, r);
          this._fxCtx.closePath();
        }
        this._fxCtx.clip();
      }

      if (activeFx.length > 0 && window.FishEffects && typeof window.FishEffects.renderLayer === 'function') {
        window.FishEffects.renderLayer(this._fxCtx, el, fakeLayer, { x: padX, y: padY, w, h, bufferScale: bScaleFx, unitScale }, curSec);
      } else {
        this._fxCtx.drawImage(el, padX, padY, w, h);
      }

      if (rVal > 0) {
        this._fxCtx.restore();
      }

      return { el: this._fxCanvas, padX, padY, origW: w, origH: h };
    }

    /**
     * Deep Glow rasa adjustment untuk layer 3D langsung.
     * Quad 3D selalu di-bake BERSIH (deep-glow dikecualikan di atas), lalu glow
     * dihitung dari snapshot HASIL PROYEKSI (glCanvas) dalam screen-space 2D:
     * posisi/orientasi nempel ke quad, kernel blur tetap melingkar, spill full
     * selalu (paksaan outLayer internal).
     * Dua koreksi di sini:
     * 1. Snapshot = AABB + margin (bukan AABB pas): potong tepat di AABB bikin
     *    tepi keras di konten terang → bloom palsu (makanya digeser ke ujung
     *    canvas glow malah membesar). Potong di margin yang sudah transparan.
     * 2. Kompensasi facing: sliver tipis bikin octave dalam piramid sub-pixel
     *    → energi halo jauh kolaps (makanya 0 ke -90 glow mengecil). Boost
     *    exposure 1/sqrt(facing), cap x3. Radius tidak diubah (ukuran fisik).
     */
    _applyDeepGlowScreenSpace(ctx, layer, bounds, currentSec = null) {
      if (!ctx || !layer || !bounds || !Array.isArray(layer.effects)) return;
      const dgList = layer.effects.filter(f => f && !f.disabled && f.type === 'deep-glow');
      if (dgList.length === 0) return;
      const reg = (typeof window !== 'undefined' && window.FishEffectsRegistry) ? window.FishEffectsRegistry : null;
      const def = (reg && typeof reg.get === 'function') ? reg.get('deep-glow') : null;
      if (!def || typeof def.render !== 'function') return;
      const targetCanvas = ctx.canvas;
      const vw = targetCanvas ? targetCanvas.width : 0;
      const vh = targetCanvas ? targetCanvas.height : 0;
      if (!(vw > 0 && vh > 0)) return;
      const src = this.glCanvas;
      if (!src || !src.width || !src.height) return;
      let maxPad = 0;
      for (let i = 0; i < dgList.length; i++) {
        const r = Math.max(2, Number(dgList[i].radius) || 80);
        if (!isNaN(r)) maxPad = Math.max(maxPad, Math.min(600, Math.ceil(r * 1.1 + 24)));
      }
      const ax = Math.round(bounds.x);
      const ay = Math.round(bounds.y);
      const aw = Math.max(1, Math.round(bounds.aabbW));
      const ah = Math.max(1, Math.round(bounds.aabbH));
      const snapMargin = Math.min(maxPad, 256);
      const cx0 = Math.max(0, ax - snapMargin);
      const cy0 = Math.max(0, ay - snapMargin);
      const cx1 = Math.min(vw, ax + aw + snapMargin);
      const cy1 = Math.min(vh, ay + ah + snapMargin);
      const cw = cx1 - cx0;
      const ch = cy1 - cy0;
      if (cw < 1 || ch < 1) return;
      // Facing = luas proyeksi / luas footprint tak-terotasi (<=1, kecil saat edge-on)
      const footW = Math.max(1, Math.abs(bounds.w) || aw);
      const footH = Math.max(1, Math.abs(bounds.h) || ah);
      const facing = Math.max(0.02, Math.min(1, (aw * ah) / (footW * footH)));
      const boost = Math.min(3, 1 / Math.sqrt(facing));
      if (!this._dgSnapCanvas) {
        this._dgSnapCanvas = document.createElement('canvas');
        this._dgSnapCtx = this._dgSnapCanvas.getContext('2d');
      }
      if (this._dgSnapCanvas.width !== cw || this._dgSnapCanvas.height !== ch) {
        this._dgSnapCanvas.width = cw;
        this._dgSnapCanvas.height = ch;
      }
      const sctx = this._dgSnapCtx;
      if (!sctx) return;
      sctx.clearRect(0, 0, cw, ch);
      try { sctx.drawImage(src, cx0, cy0, cw, ch, 0, 0, cw, ch); } catch (_) { return; }
      const rawOp = (layer.opacity !== undefined && layer.opacity !== null) ? Number(layer.opacity) : 1.0;
      const normOp = (rawOp > 1.0) ? Math.max(0, Math.min(1, rawOp / 100)) : Math.max(0, Math.min(1, rawOp));
      if (!(normOp > 0.001)) return;
      const sec = (typeof currentSec === 'number' && !isNaN(currentSec))
        ? currentSec
        : ((layer && typeof layer._currentSec === 'number') ? layer._currentSec : 0);
      for (let i = 0; i < dgList.length; i++) {
        const dg = dgList[i];
        const baseNum = Number(dg.opacity);
        const baseOp = (dg.opacity === undefined || dg.opacity === null || isNaN(baseNum)) ? 100 : Math.max(0, Math.min(100, baseNum));
        const expNum = Number(dg.exposure);
        const baseExp = (dg.exposure === undefined || dg.exposure === null || isNaN(expNum)) ? 150 : Math.max(10, Math.min(500, expNum));
        const glowFx = Object.assign({}, dg, { glowOnly: true, outLayer: true, opacity: baseOp * normOp, exposure: Math.min(500, baseExp * boost) });
        try { def.render(ctx, this._dgSnapCanvas, layer, { x: cx0, y: cy0, w: cw, h: ch }, glowFx, sec); } catch (_) {}
      }
    }

    /**
     * Compute 3D projected coordinates of a local point (lx, ly, lz)
     */
    projectPoint(lx, ly, lz = 0, params = {}) {
      const {
        cx = 0,
        cy = 0,
        posZ = 0,
        rotX = 0,
        rotY = 0,
        rotZ = 0,
        skewX = 0,
        skewY = 0,
        signX = 1,
        signY = 1,
        anchorX = 0,
        anchorY = 0,
        anchorZ = 0,
        perspective = CAMERA_DISTANCE
      } = params;

      // 1. Vector from anchor to local point in layer space
      let dx = (lx - anchorX) * signX;
      let dy = (ly - anchorY) * signY;
      let dz = lz - anchorZ;

      // 2. Local Skew
      if (skewX || skewY) {
        const tanX = Math.tan(((skewX || 0) * Math.PI) / 180);
        const tanY = Math.tan(((skewY || 0) * Math.PI) / 180);
        const sx = dx + tanX * dy;
        const sy = tanY * dx + dy;
        dx = sx;
        dy = sy;
      }

      // Anchor world coordinates (pivot point in 3D space)
      const anchorWorldX = cx + anchorX * signX;
      const anchorWorldY = cy + anchorY * signY;
      const anchorWorldZ = posZ + anchorZ;

      const camera = params.camera || null;

      // 3. Fast 2D (Only when rotX == 0, rotY == 0, posZ == 0, anchorZ == 0, and no camera)
      if (!rotX && !rotY && !posZ && !anchorZ && !camera) {
        let rx = dx, ry = dy;
        if (rotZ) {
          const radZ = (rotZ * Math.PI) / 180;
          const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);
          rx = dx * cosZ - dy * sinZ;
          ry = dx * sinZ + dy * cosZ;
        }
        return { x: anchorWorldX + rx, y: anchorWorldY + ry, z: 0, scale: 1, isBehind: false };
      }

      // 4. 3D Euler Rotations around anchor pivot: Rx -> Ry -> Rz
      const radX = (rotX * Math.PI) / 180;
      const radY = (rotY * Math.PI) / 180;
      const radZ = (rotZ * Math.PI) / 180;

      const cosX = Math.cos(radX), sinX = Math.sin(radX);
      const cosY = Math.cos(radY), sinY = Math.sin(radY);
      const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);

      const y1 = dy * cosX - dz * sinX;
      const z1 = dy * sinX + dz * cosX;
      const x1 = dx;

      const x2 = x1 * cosY + z1 * sinY;
      const z2 = -x1 * sinY + z1 * cosY;
      const y2 = y1;

      const x3 = x2 * cosZ - y2 * sinZ;
      const y3 = x2 * sinZ + y2 * cosZ;
      const z3 = z2 + anchorWorldZ;

      // 5. Perspective Projection
      const pDist = perspective || (CAMERA_DISTANCE * (params.bufferScale || 1));
      const pNear = params.near || (NEAR_PLANE * (params.bufferScale || 1));
      const maxZ = pDist - pNear;

      if (camera) {
        const bScale = params.bufferScale || 1;
        const camX = (camera.posX || 0) * bScale;
        const camY = (camera.posY || 0) * bScale;
        const camPosZ = (camera.posZ || 0) * bScale;
        const camRotX = camera.rotX || 0;
        const camRotY = camera.rotY || 0;
        const camRotZ = camera.rotZ !== undefined ? camera.rotZ : (camera.rotation || 0);
        const camLens = Math.max(1, camera.cameraLens !== undefined ? camera.cameraLens : 50);
        const camZoom = camera.cameraZoom !== undefined ? camera.cameraZoom : 100;
        const lensFactor = Math.max(0.01, camLens / 50);
        const zoomFactor = Math.max(0.01, camZoom / 100);
        const totalZoom = lensFactor * zoomFactor;
        const D = CAMERA_DISTANCE * lensFactor * bScale;

        let vw = params.vw;
        let vh = params.vh;
        if (!vw || !vh) {
          const vp = this._getProjectViewport(params.bufferScale || 1);
          if (!vw) vw = vp.vw;
          if (!vh) vh = vp.vh;
        }
        let worldX = anchorWorldX + x3;
        let worldY = anchorWorldY + y3;
        let worldZ = z3;

        let relX = worldX - (vw / 2 + camX);
        let relY = worldY - (vh / 2 + camY);
        let relZ = (worldZ - camPosZ) - D;

        if (camRotZ) {
          const radZ = (-camRotZ * Math.PI) / 180;
          const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
          const nX = relX * cZ - relY * sZ, nY = relX * sZ + relY * cZ;
          relX = nX; relY = nY;
        }
        if (camRotY) {
          const radY = (camRotY * Math.PI) / 180;
          const cY = Math.cos(radY), sY = Math.sin(radY);
          const nX = relX * cY + relZ * sY, nZ = -relX * sY + relZ * cY;
          relX = nX; relZ = nZ;
        }
        if (camRotX) {
          const radX = (camRotX * Math.PI) / 180;
          const cX = Math.cos(radX), sX = Math.sin(radX);
          const nY = relY * cX - relZ * sX, nZ = relY * sX + relZ * cX;
          relY = nY; relZ = nZ;
        }

        const dist = -relZ;
        const isBehind = dist <= pNear;
        const camInv = this._getCameraInverseScale(camera, vw, vh, bScale, this._camScaleScratch);
        const projScaleX = (D * totalZoom * camInv.x) / Math.max(pNear, dist);
        const projScaleY = (D * totalZoom * camInv.y) / Math.max(pNear, dist);
        const projScale = (Math.abs(projScaleX) + Math.abs(projScaleY)) * 0.5;
        let px = vw / 2 + relX * projScaleX;
        let py = vh / 2 + relY * projScaleY;

        const lensDistort = this._getLensDistort(camera);
        if (Math.abs(lensDistort) > 0.001) {
          const ndcX = (px - vw / 2) / (vw / 2);
          const ndcY = (py - vh / 2) / (vh / 2);
          const r2 = ndcX * ndcX + ndcY * ndcY;
          const warp = 1.0 + lensDistort * r2;
          px = vw / 2 + ndcX * warp * (vw / 2);
          py = vh / 2 + ndcY * warp * (vh / 2);
        }

        return {
          x: px,
          y: py,
          z: relZ + D,
          scale: projScale,
          isBehind
        };
      }

      const isBehind = z3 >= maxZ;
      const clampedZ = Math.min(z3, maxZ);
      const projScale = pDist / Math.max(pNear, pDist - clampedZ);

      return {
        x: anchorWorldX + x3 * projScale,
        y: anchorWorldY + y3 * projScale,
        z: z3,
        scale: projScale,
        isBehind
      };
    }

    /**
     * Compute rotation-aware cursor string matching screen orientation of handle from center
     */
    getHandleCursor(hx, hy, cx, cy) {
      const dx = hx - cx;
      const dy = hy - cy;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      const sector = Math.round(deg / 45) % 8;
      if (sector === 0 || sector === 4) return 'ew-resize';
      if (sector === 1 || sector === 5) return 'nwse-resize';
      if (sector === 2 || sector === 6) return 'ns-resize';
      if (sector === 3 || sector === 7) return 'nesw-resize';
      return 'crosshair';
    }

    /**
     * Compute exact local 2D contour points for any Shape geometry
     */
    getShapeLocalContour(shapeType, shapeProps = {}, w = 300, h = 300) {
      if (typeof window !== 'undefined' && window.FishShapesRegistry && typeof window.FishShapesRegistry.getContour === 'function') {
        return window.FishShapesRegistry.getContour(shapeType, shapeProps, w, h);
      }
      const sx = Math.max(1, w);
      const sy = Math.max(1, h);
      const rx = sx / 2;
      const ry = sy / 2;
      const pts = [];

      const baseW = (shapeProps.sizeX && Number(shapeProps.sizeX) > 0) ? Number(shapeProps.sizeX) : sx;
      const scaleR = sx / Math.max(1, baseW);

      switch (shapeType) {
        case 'circle': {
          const segs = 48;
          for (let i = 0; i < segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
          }
          break;
        }
        case 'rectangle': {
          let r = Number(shapeProps.roundness);
          if (isNaN(r) || r < 0) r = 0;
          r = Math.min(r * scaleR, rx, ry);
          if (r <= 0.5) {
            pts.push({ x: -rx, y: -ry }, { x: rx, y: -ry }, { x: rx, y: ry }, { x: -rx, y: ry });
          } else {
            const arcSegs = 6;
            for (let i = 0; i <= arcSegs; i++) {
              const a = -Math.PI / 2 + (i / arcSegs) * (Math.PI / 2);
              pts.push({ x: rx - r + Math.cos(a) * r, y: -ry + r + Math.sin(a) * r });
            }
            for (let i = 0; i <= arcSegs; i++) {
              const a = (i / arcSegs) * (Math.PI / 2);
              pts.push({ x: rx - r + Math.cos(a) * r, y: ry - r + Math.sin(a) * r });
            }
            for (let i = 0; i <= arcSegs; i++) {
              const a = Math.PI / 2 + (i / arcSegs) * (Math.PI / 2);
              pts.push({ x: -rx + r + Math.cos(a) * r, y: ry - r + Math.sin(a) * r });
            }
            for (let i = 0; i <= arcSegs; i++) {
              const a = Math.PI + (i / arcSegs) * (Math.PI / 2);
              pts.push({ x: -rx + r + Math.cos(a) * r, y: -ry + r + Math.sin(a) * r });
            }
          }
          break;
        }
        case 'triangle': {
          const step = Math.max(3, parseInt(shapeProps.step || shapeProps.steps, 10) || 3);
          if (step === 3) {
            let r = Number(shapeProps.roundness);
            if (isNaN(r) || r < 0) r = 0;
            r = r * scaleR;
            if (r <= 0.5) {
              pts.push({ x: 0, y: -ry });
              pts.push({ x: rx, y: ry });
              pts.push({ x: -rx, y: ry });
            } else {
              const raw = [{ x: 0, y: -ry }, { x: rx, y: ry }, { x: -rx, y: ry }];
              const cornerR = Math.min(r, Math.min(sx, sy) * 0.25);
              for (let i = 0; i < 3; i++) {
                const pPrev = raw[(i + 2) % 3];
                const pCurr = raw[i];
                const pNext = raw[(i + 1) % 3];
                const v1 = { x: pPrev.x - pCurr.x, y: pPrev.y - pCurr.y };
                const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };
                const l1 = Math.hypot(v1.x, v1.y) || 1;
                const l2 = Math.hypot(v2.x, v2.y) || 1;
                const u1 = { x: v1.x / l1, y: v1.y / l1 };
                const u2 = { x: v2.x / l2, y: v2.y / l2 };
                const startPt = { x: pCurr.x + u1.x * cornerR, y: pCurr.y + u1.y * cornerR };
                const endPt = { x: pCurr.x + u2.x * cornerR, y: pCurr.y + u2.y * cornerR };
                pts.push(startPt);
                for (let k = 1; k <= 4; k++) {
                  const t = k / 5;
                  pts.push({
                    x: (1 - t) * (1 - t) * startPt.x + 2 * (1 - t) * t * pCurr.x + t * t * endPt.x,
                    y: (1 - t) * (1 - t) * startPt.y + 2 * (1 - t) * t * pCurr.y + t * t * endPt.y
                  });
                }
                pts.push(endPt);
              }
            }
          } else {
            for (let i = 0; i < step; i++) {
              const a = -Math.PI / 2 + (i / step) * Math.PI * 2;
              pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
            }
          }
          break;
        }
        case 'star': {
          const numPts = Math.max(3, parseInt(shapeProps.points, 10) || 5);
          let inR = Number(shapeProps.innerRadius);
          if (isNaN(inR) || inR <= 0) inR = 0.4;
          inR = Math.max(0.1, Math.min(0.9, inR));
          const total = numPts * 2;
          for (let i = 0; i < total; i++) {
            const a = -Math.PI / 2 + (i / total) * Math.PI * 2;
            const radRatio = (i % 2 === 0) ? 1.0 : inR;
            pts.push({ x: Math.cos(a) * rx * radRatio, y: Math.sin(a) * ry * radRatio });
          }
          break;
        }
        case 'polygon': {
          const sides = Math.max(3, parseInt(shapeProps.sides, 10) || 6);
          for (let i = 0; i < sides; i++) {
            const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
            pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
          }
          break;
        }
        case 'capsule': {
          const r = Math.min(rx, ry);
          const arcSegs = 8;
          if (rx >= ry) {
            for (let i = 0; i <= arcSegs; i++) {
              const a = -Math.PI / 2 + (i / arcSegs) * Math.PI;
              pts.push({ x: rx - r + Math.cos(a) * r, y: Math.sin(a) * r });
            }
            for (let i = 0; i <= arcSegs; i++) {
              const a = Math.PI / 2 + (i / arcSegs) * Math.PI;
              pts.push({ x: -rx + r + Math.cos(a) * r, y: Math.sin(a) * r });
            }
          } else {
            for (let i = 0; i <= arcSegs; i++) {
              const a = (i / arcSegs) * Math.PI;
              pts.push({ x: Math.cos(a) * r, y: ry - r + Math.sin(a) * r });
            }
            for (let i = 0; i <= arcSegs; i++) {
              const a = Math.PI + (i / arcSegs) * Math.PI;
              pts.push({ x: Math.cos(a) * r, y: -ry + r + Math.sin(a) * r });
            }
          }
          break;
        }
        case 'heart': {
          const segs = 48;
          for (let i = 0; i < segs; i++) {
            const t = (i / segs) * Math.PI * 2;
            const hx = 16 * Math.pow(Math.sin(t), 3);
            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            pts.push({ x: (hx / 16) * rx, y: ((hy + 2) / 17) * ry });
          }
          break;
        }
        default: {
          pts.push({ x: -rx, y: -ry }, { x: rx, y: -ry }, { x: rx, y: ry }, { x: -rx, y: ry });
          break;
        }
      }
      return pts;
    }

    /**
     * Compute exact bounding quad, 8 handles, and center anchor
     */
    getBounds(layer, bufferScale = 1, camera = null, viewportW = null, viewportH = null) {
      const bw = (layer.scaleW !== undefined ? layer.scaleW : (layer.normW || 100)) * bufferScale;
      const bh = (layer.scaleH !== undefined ? layer.scaleH : (layer.normH || 100)) * bufferScale;
      const absW = Math.abs(bw);
      const absH = Math.abs(bh);
      const signX = Math.sign(bw) || 1;
      const signY = Math.sign(bh) || 1;

      const cx = (layer.posX || 0) * bufferScale;
      const cy = (layer.posY || 0) * bufferScale;
      const posZ = (layer.posZ || 0) * bufferScale;

      const rotZ = layer.rotZ !== undefined ? layer.rotZ : (layer.rotation || 0);
      const rotX = layer.rotX || 0;
      const rotY = layer.rotY || 0;
      const skewX = layer.skewX || 0;
      const skewY = layer.skewY || 0;

      const anchorX = (layer.anchorX || 0) * bufferScale;
      const anchorY = (layer.anchorY || 0) * bufferScale;
      const anchorZ = (layer.anchorZ || 0) * bufferScale;

      const hasParticleEngine = Array.isArray(layer.effects) && layer.effects.some(f => f && !f.disabled && f.type === 'particle-engine');
      const is3DNativeShape = (typeof layer.shapeType === 'string' && (layer.shapeType === '3d_box' || layer.shapeType.startsWith('3d_')));
      const has3DFx = (Array.isArray(layer.effects) && layer.effects.some(f => f && !f.disabled && (f.type === 'box_3d' || f.type === '3d_box' || f.type === 'extrude_3d' || f.type === 'pyramid_3d' || f.type === 'sphere_3d' || f.type === 'cone_3d' || f.type === 'cylinder_3d' || f.type === 'torus_3d'))) || is3DNativeShape;
      const is3D = !hasParticleEngine && (!!layer.is3D || has3DFx || (layer.type === 'precomp' && !!layer.collapseTransformations) || layer.type === 'camera');
      const boxFx = (Array.isArray(layer.effects) ? layer.effects.find(f => f && !f.disabled && (f.type === 'box_3d' || f.type === '3d_box')) : null) || (layer.shapeType === '3d_box' ? { type: '3d_box' } : null);
      const boxAngleX = (boxFx && boxFx.angleX !== undefined) ? Number(boxFx.angleX) : 0;
      const boxAngleY = (boxFx && boxFx.angleY !== undefined) ? Number(boxFx.angleY) : 0;
      const effectiveRotX = is3D ? (rotX + boxAngleX) : 0;
      const effectiveRotY = is3D ? (rotY + boxAngleY) : 0;
      const effectivePosZ = is3D ? posZ : 0;
      const effectiveAnchorZ = is3D ? anchorZ : 0;
      const effectiveCamera = is3D ? camera : null;

      const camLens = Math.max(1, effectiveCamera ? (effectiveCamera.cameraLens !== undefined ? effectiveCamera.cameraLens : 50) : 50);
      const camZoom = effectiveCamera ? (effectiveCamera.cameraZoom !== undefined ? effectiveCamera.cameraZoom : 100) : 100;
      const lensFactor = Math.max(0.01, camLens / 50);
      const zoomFactor = Math.max(0.01, camZoom / 100);
      const totalZoom = lensFactor * zoomFactor;

      const camDist = CAMERA_DISTANCE * lensFactor * bufferScale;
      const nearPlane = NEAR_PLANE * bufferScale;
      const maxZ = camDist - nearPlane;
      const lensDistort = this._getLensDistort(effectiveCamera);

      let vw = viewportW;
      let vh = viewportH;
      if (!vw || !vh) {
        const vp = this._getProjectViewport(bufferScale, layer);
        if (!vw) vw = vp.vw;
        if (!vh) vh = vp.vh;
      }

      const boundsForMVP = {
        cx, cy,
        posZ: effectivePosZ,
        w: absW, h: absH,
        signX, signY,
        rotX: effectiveRotX,
        rotY: effectiveRotY,
        rotZ,
        skewX, skewY,
        anchorX, anchorY,
        anchorZ: effectiveAnchorZ,
        bufferScale
      };

      let mvp = null;
      if (is3D) {
        mvp = this._computeMVP(boundsForMVP, vw, vh, 0, effectiveCamera, this._mvpScratchBounds);
      }

      let pTL, pTR, pBR, pBL, pN, pE, pS, pW, pAnchor;
      let isBehindCamera = false;

      const transformParams = {
        cx, cy,
        posZ: effectivePosZ,
        rotX: effectiveRotX,
        rotY: effectiveRotY,
        rotZ,
        skewX, skewY, signX, signY,
        anchorX, anchorY,
        anchorZ: effectiveAnchorZ,
        perspective: camDist,
        near: nearPlane,
        bufferScale,
        camera: effectiveCamera,
        vw,
        vh
      };

      let projectLocalPoint = null;
      let projectQuad = null;

      if (mvp) {
        projectQuad = (u, v, zCoord = 0) => {
          const clipX = mvp[0] * u + mvp[4] * v + mvp[8] * zCoord + mvp[12];
          const clipY = mvp[1] * u + mvp[5] * v + mvp[9] * zCoord + mvp[13];
          const clipZ = mvp[2] * u + mvp[6] * v + mvp[10] * zCoord + mvp[14];
          const clipW = mvp[3] * u + mvp[7] * v + mvp[11] * zCoord + mvp[15];

          const behind = clipW <= 0.001;
          const invW = 1.0 / Math.max(0.02, clipW);
          let ndcX = clipX * invW;
          let ndcY = clipY * invW;
          if (!behind && Math.abs(lensDistort) > 0.001) {
            const r2 = ndcX * ndcX + ndcY * ndcY;
            const warp = 1.0 + lensDistort * r2;
            ndcX *= warp;
            ndcY *= warp;
          }
          return {
            x: (ndcX * 0.5 + 0.5) * vw,
            y: (-ndcY * 0.5 + 0.5) * vh,
            z: clipZ,
            scale: behind ? 0 : (invW * totalZoom),
            isBehind: behind
          };
        };

        projectLocalPoint = (lx, ly, lz = 0) => projectQuad(absW ? lx / absW : 0, absH ? ly / absH : 0, lz);

        pTL = projectQuad(-0.5, -0.5, 0);
        pTR = projectQuad( 0.5, -0.5, 0);
        pBR = projectQuad( 0.5,  0.5, 0);
        pBL = projectQuad(-0.5,  0.5, 0);

        pN  = projectQuad( 0.0, -0.5, 0);
        pE  = projectQuad( 0.5,  0.0, 0);
        pS  = projectQuad( 0.0,  0.5, 0);
        pW  = projectQuad(-0.5,  0.0, 0);

        const uAnchor = absW ? anchorX / absW : 0;
        const vAnchor = absH ? anchorY / absH : 0;
        pAnchor = projectQuad(uAnchor, vAnchor, anchorZ);

        isBehindCamera = (posZ >= maxZ) || [pTL, pTR, pBR, pBL].every(p => !p || p.isBehind);
      } else if (is3D) {
        const halfW = absW / 2;
        const halfH = absH / 2;

        projectLocalPoint = (lx, ly, lz = 0) => this.projectPoint(lx, ly, lz, transformParams);

        pTL = this.projectPoint(-halfW, -halfH, 0, transformParams);
        pTR = this.projectPoint( halfW, -halfH, 0, transformParams);
        pBR = this.projectPoint( halfW,  halfH, 0, transformParams);
        pBL = this.projectPoint(-halfW,  halfH, 0, transformParams);

        pN  = this.projectPoint( 0,     -halfH, 0, transformParams);
        pE  = this.projectPoint( halfW,  0,     0, transformParams);
        pS  = this.projectPoint( 0,      halfH, 0, transformParams);
        pW  = this.projectPoint(-halfW,  0,     0, transformParams);

        pAnchor = this.projectPoint(anchorX, anchorY, anchorZ, transformParams);
        isBehindCamera = (posZ >= maxZ) || [pTL, pTR, pBR, pBL].every(p => !p || p.isBehind);
      } else {
        const halfW = absW / 2;
        const halfH = absH / 2;

        projectLocalPoint = (lx, ly, lz = 0) => this.projectPoint(lx, ly, lz, transformParams);

        pTL = this.projectPoint(-halfW, -halfH, 0, transformParams);
        pTR = this.projectPoint(halfW, -halfH, 0, transformParams);
        pBR = this.projectPoint(halfW, halfH, 0, transformParams);
        pBL = this.projectPoint(-halfW, halfH, 0, transformParams);

        pN = this.projectPoint(0, -halfH, 0, transformParams);
        pE = this.projectPoint(halfW, 0, 0, transformParams);
        pS = this.projectPoint(0, halfH, 0, transformParams);
        pW = this.projectPoint(-halfW, 0, 0, transformParams);

        pAnchor = this.projectPoint(anchorX, anchorY, anchorZ, transformParams);
        isBehindCamera = (posZ >= maxZ) || [pTL, pTR, pBR, pBL].every(p => !p || p.isBehind);
      }

      if (!layer._isVectorRenderPass && layer.type === 'shape' && layer.shapeType === 'vector' && typeof projectLocalPoint === 'function' && typeof window !== 'undefined' && typeof window.getVectorLocalBounds === 'function') {
        const vBounds = window.getVectorLocalBounds(layer.shapeProps || {});
        const scaleX = absW / Math.max(1, vBounds.width);
        const scaleY = absH / Math.max(1, vBounds.height);
        const minLX = vBounds.minX * scaleX;
        const maxLX = vBounds.maxX * scaleX;
        const minLY = vBounds.minY * scaleY;
        const maxLY = vBounds.maxY * scaleY;
        const midLX = (minLX + maxLX) / 2;
        const midLY = (minLY + maxLY) / 2;

        pTL = projectLocalPoint(minLX, minLY, 0);
        pTR = projectLocalPoint(maxLX, minLY, 0);
        pBR = projectLocalPoint(maxLX, maxLY, 0);
        pBL = projectLocalPoint(minLX, maxLY, 0);

        pN  = projectLocalPoint(midLX, minLY, 0);
        pE  = projectLocalPoint(maxLX, midLY, 0);
        pS  = projectLocalPoint(midLX, maxLY, 0);
        pW  = projectLocalPoint(minLX, midLY, 0);

        isBehindCamera = (posZ >= maxZ) || [pTL, pTR, pBR, pBL].every(p => !p || p.isBehind);
      }

      const corners = [pTL, pTR, pBR, pBL];
      let backCorners = null;
      let apexPoint = null;
      const all3DCorners = [pTL, pTR, pBR, pBL];

      if (mvp) {
        const isNative3DShape = (typeof layer.shapeType === 'string' && (layer.shapeType === '3d_box' || layer.shapeType.startsWith('3d_')));
        const active3DFx = Array.isArray(layer.effects)
          ? layer.effects.find(f => f && !f.disabled && (f.type === 'box_3d' || f.type === '3d_box' || f.type === 'extrude_3d' || f.type === 'pyramid_3d' || f.type === 'sphere_3d' || f.type === 'cone_3d' || f.type === 'cylinder_3d' || f.type === 'torus_3d'))
          : (isNative3DShape ? { type: layer.shapeType } : null);
        let meshD = 0;
        if (active3DFx || isNative3DShape) {
          const lDepth = (layer && layer.scaleZ !== undefined) ? layer.scaleZ : (layer && layer.depth !== undefined ? layer.depth : undefined);
          if (isNative3DShape || (active3DFx && (active3DFx.type === 'box_3d' || active3DFx.type === '3d_box' || active3DFx.type === 'sphere_3d' || active3DFx.type === 'cone_3d' || active3DFx.type === 'cylinder_3d' || active3DFx.type === 'torus_3d'))) {
            const defaultD = Math.round(Math.min(absW || (300 * bufferScale), absH || (300 * bufferScale)));
            meshD = Math.max(1, lDepth !== undefined ? (lDepth * bufferScale) : ((active3DFx && active3DFx.depth !== undefined) ? (active3DFx.depth * bufferScale) : defaultD));
          } else if (active3DFx && active3DFx.type === 'extrude_3d') {
            meshD = Math.max(1, (lDepth !== undefined ? lDepth : (active3DFx.extrudeDepth !== undefined ? active3DFx.extrudeDepth : 35)) * bufferScale);
          } else if (active3DFx && (active3DFx.type === 'pyramid_3d' || active3DFx.type === '3d_pyramid')) {
            meshD = Math.max(1, (lDepth !== undefined ? lDepth : (active3DFx.height !== undefined ? active3DFx.height : 80)) * bufferScale);
          }
        }
        if (meshD > 0 && typeof projectQuad === 'function') {
          if (active3DFx && (active3DFx.type === 'pyramid_3d' || active3DFx.type === '3d_pyramid')) {
            const apexX = ((active3DFx.apexX !== undefined ? active3DFx.apexX : 50) / 100 - 0.5);
            const apexY = ((active3DFx.apexY !== undefined ? active3DFx.apexY : 0) / 100 - 0.5);
            apexPoint = projectQuad(apexX, apexY, meshD);
            if (apexPoint && !apexPoint.isBehind) all3DCorners.push(apexPoint);
          } else if (layer.shapeType === '3d_model' && layer.modelMediaId) {
            const loader = (typeof window !== 'undefined') ? window.Fish3DLoader : null;
            const bundle = (loader && typeof loader.getModel === 'function') ? loader.getModel(layer.modelMediaId) : null;
            const lb = (bundle && bundle.localBounds)
              ? bundle.localBounds
              : { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 };
            const zF = lb.maxZ * meshD;
            const zB = lb.minZ * meshD;
            pTL = projectQuad(lb.minX, lb.minY, zF);
            pTR = projectQuad(lb.maxX, lb.minY, zF);
            pBR = projectQuad(lb.maxX, lb.maxY, zF);
            pBL = projectQuad(lb.minX, lb.maxY, zF);
            corners[0] = pTL; corners[1] = pTR; corners[2] = pBR; corners[3] = pBL;
            backCorners = [
              projectQuad(lb.minX, lb.minY, zB),
              projectQuad(lb.maxX, lb.minY, zB),
              projectQuad(lb.maxX, lb.maxY, zB),
              projectQuad(lb.minX, lb.maxY, zB)
            ];
            all3DCorners.length = 0;
            corners.forEach(p => { if (p && !p.isBehind) all3DCorners.push(p); });
            backCorners.forEach(p => { if (p && !p.isBehind) all3DCorners.push(p); });
          } else if (isNative3DShape || (active3DFx && (active3DFx.type === '3d_box' || active3DFx.type === 'box_3d' || active3DFx.type === 'sphere_3d' || active3DFx.type === 'cone_3d' || active3DFx.type === 'cylinder_3d' || active3DFx.type === 'torus_3d'))) {
            const f3d = typeof window !== 'undefined' ? window.Fish3DEngine : null;
            const res3d = (f3d && typeof f3d.compute3DBoxCorners === 'function')
              ? f3d.compute3DBoxCorners(projectQuad, meshD)
              : null;
            if (res3d && res3d.corners && res3d.backCorners) {
              pTL = res3d.corners[0]; pTR = res3d.corners[1]; pBR = res3d.corners[2]; pBL = res3d.corners[3];
              corners[0] = pTL; corners[1] = pTR; corners[2] = pBR; corners[3] = pBL;
              backCorners = res3d.backCorners;
            } else {
              const halfD = meshD / 2;
              pTL = projectQuad(-0.5, -0.5,  halfD);
              pTR = projectQuad( 0.5, -0.5,  halfD);
              pBR = projectQuad( 0.5,  0.5,  halfD);
              pBL = projectQuad(-0.5,  0.5,  halfD);
              corners[0] = pTL; corners[1] = pTR; corners[2] = pBR; corners[3] = pBL;
              backCorners = [
                projectQuad(-0.5, -0.5, -halfD),
                projectQuad( 0.5, -0.5, -halfD),
                projectQuad( 0.5,  0.5, -halfD),
                projectQuad(-0.5,  0.5, -halfD)
              ];
            }
            all3DCorners.length = 0;
            corners.forEach(p => { if (p && !p.isBehind) all3DCorners.push(p); });
            backCorners.forEach(p => { if (p && !p.isBehind) all3DCorners.push(p); });
          } else {
            const pTL_b = projectQuad(-0.5, -0.5, -meshD);
            const pTR_b = projectQuad( 0.5, -0.5, -meshD);
            const pBR_b = projectQuad( 0.5,  0.5, -meshD);
            const pBL_b = projectQuad(-0.5,  0.5, -meshD);
            backCorners = [pTL_b, pTR_b, pBR_b, pBL_b];
            [pTL_b, pTR_b, pBR_b, pBL_b].forEach(p => {
              if (p && !p.isBehind) all3DCorners.push(p);
            });
          }
        }
      }

      const validCorners = all3DCorners.filter(p => p && !p.isBehind);
      const minX = validCorners.length > 0 ? Math.min(...validCorners.map(p => p.x)) : pTL.x;
      const maxX = validCorners.length > 0 ? Math.max(...validCorners.map(p => p.x)) : pBR.x;
      const minY = validCorners.length > 0 ? Math.min(...validCorners.map(p => p.y)) : pTL.y;
      const maxY = validCorners.length > 0 ? Math.max(...validCorners.map(p => p.y)) : pBR.y;

      const screenCenterX = (pTL.x + pBR.x) / 2;
      const screenCenterY = (pTL.y + pBR.y) / 2;

      let shapeContour = null;
      let shapeContourLocal = null;
      if (layer.type === 'shape' && !(typeof layer.shapeType === 'string' && (layer.shapeType === '3d_box' || layer.shapeType.startsWith('3d_')))) {
        shapeContourLocal = this.getShapeLocalContour(layer.shapeType || 'rectangle', layer.shapeProps || {}, absW, absH);
        if (Array.isArray(shapeContourLocal) && typeof projectLocalPoint === 'function') {
          shapeContour = shapeContourLocal.map(pt => projectLocalPoint(pt.x, pt.y, 0));
        }
      }

      return {
        is3D,
        isBehindCamera,
        maxZ,
        cx, cy,
        posZ: effectivePosZ,
        anchorX, anchorY,
        anchorZ: effectiveAnchorZ,
        w: absW, h: absH,
        scaleW: bw, scaleH: bh,
        signX, signY,
        rotation: rotZ,
        rotX: effectiveRotX,
        rotY: effectiveRotY,
        rotZ,
        skewX, skewY,
        x: minX, y: minY,
        aabbW: maxX - minX,
        aabbH: maxY - minY,
        corners,
        backCorners,
        apexPoint,
        is3DBox: !!backCorners,
        shapeContour,
        shapeContourLocal,
        shapeType: layer.shapeType || null,
        shapeProps: layer.shapeProps || null,
        bufferScale,
        handles: (layer.shapeType === '3d_model' ? [
          { type: 'anchor', x: pAnchor.x, y: pAnchor.y, cursor: 'move' }
        ] : (backCorners ? [
          { type: 'nw', x: pTL.x, y: pTL.y, cursor: this.getHandleCursor(pTL.x, pTL.y, screenCenterX, screenCenterY) },
          { type: 'ne', x: pTR.x, y: pTR.y, cursor: this.getHandleCursor(pTR.x, pTR.y, screenCenterX, screenCenterY) },
          { type: 'se', x: pBR.x, y: pBR.y, cursor: this.getHandleCursor(pBR.x, pBR.y, screenCenterX, screenCenterY) },
          { type: 'sw', x: pBL.x, y: pBL.y, cursor: this.getHandleCursor(pBL.x, pBL.y, screenCenterX, screenCenterY) },
          { type: 'anchor', x: pAnchor.x, y: pAnchor.y, cursor: 'move' }
        ] : [
          { type: 'nw', x: pTL.x, y: pTL.y, cursor: this.getHandleCursor(pTL.x, pTL.y, screenCenterX, screenCenterY) },
          { type: 'n',  x: pN.x,  y: pN.y,  cursor: this.getHandleCursor(pN.x,  pN.y,  screenCenterX, screenCenterY) },
          { type: 'ne', x: pTR.x, y: pTR.y, cursor: this.getHandleCursor(pTR.x, pTR.y, screenCenterX, screenCenterY) },
          { type: 'e',  x: pE.x,  y: pE.y,  cursor: this.getHandleCursor(pE.x,  pE.y,  screenCenterX, screenCenterY) },
          { type: 'se', x: pBR.x, y: pBR.y, cursor: this.getHandleCursor(pBR.x, pBR.y, screenCenterX, screenCenterY) },
          { type: 's',  x: pS.x,  y: pS.y,  cursor: this.getHandleCursor(pS.x,  pS.y,  screenCenterX, screenCenterY) },
          { type: 'sw', x: pBL.x, y: pBL.y, cursor: this.getHandleCursor(pBL.x, pBL.y, screenCenterX, screenCenterY) },
          { type: 'w',  x: pW.x,  y: pW.y,  cursor: this.getHandleCursor(pW.x,  pW.y,  screenCenterX, screenCenterY) },
          { type: 'anchor', x: pAnchor.x, y: pAnchor.y, cursor: 'move' }
        ])),
        anchor: pAnchor,
        transformParams
      };
    }

    /**
     * Hit test a point against the transformed 3D quad
     */
    hitTest(bounds, px, py) {
      if (!bounds || bounds.isBehindCamera) return false;
      if (px < bounds.x || px > bounds.x + bounds.aabbW ||
          py < bounds.y || py > bounds.y + bounds.aabbH) {
        return false;
      }
      if (bounds.is3DBox || bounds.backCorners || (bounds.all3DCorners && bounds.all3DCorners.length > 4)) {
        return true;
      }
      const poly = bounds.corners;
      if (!poly || poly.length < 3) return false;

      let hasPos = false, hasNeg = false;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const cross = (px - a.x) * (b.y - a.y) - (py - a.y) * (b.x - a.x);
        if (cross > 0) hasPos = true;
        if (cross < 0) hasNeg = true;
        if (hasPos && hasNeg) return false;
      }
      return true;
    }

    /**
     * Render layer onto destination 2D canvas with hardware 3D perspective
     */
    renderLayer(ctx, el, layer, bufferScale = 1, camera = null, currentSec = null) {
      if (!ctx || !el || !this._hasValidDimensions(el)) return;

      const targetCanvas = ctx.canvas;
      const vp = this._getProjectViewport(bufferScale, layer);
      const vw = targetCanvas ? targetCanvas.width : vp.vw;
      const vh = targetCanvas ? targetCanvas.height : vp.vh;

      const bounds = this.getBounds(layer, bufferScale, camera, vw, vh);
      if (bounds.isBehindCamera) {
        return; // Clipped out of camera view: layer has passed behind camera near plane
      }
      const { absW = bounds.w, absH = bounds.h, signX, signY, is3D } = bounds;

      // 1. Fast Path: Pure 2D (Single native ctx.drawImage)
      if (!is3D || !this.isReady) {
        ctx.save();
        if (layer.opacity !== undefined && layer.opacity !== null) {
          const rawOp = Number(layer.opacity);
          ctx.globalAlpha = (rawOp > 1.0) ? Math.max(0, Math.min(1, rawOp / 100)) : Math.max(0, Math.min(1, rawOp));
        }
        if (layer.blendMode && layer.blendMode !== 'normal') {
          ctx.globalCompositeOperation = (layer.blendMode === 'mask') ? 'destination-in' : (layer.blendMode === 'exclude') ? 'destination-out' : layer.blendMode;
        }
        if (window.FishEffects && typeof window.FishEffects.applyToContext === 'function') {
          window.FishEffects.applyToContext(ctx, layer);
        }
        if (is3D && layer._dofBlur && layer._dofBlur > 0.5) {
          const curF = ctx.filter && ctx.filter !== 'none' ? ctx.filter : '';
          ctx.filter = (curF ? (curF + ' ') : '') + `blur(${layer._dofBlur.toFixed(1)}px)`;
        }
        const ax = (bounds.anchorX || 0) * signX;
        const ay = (bounds.anchorY || 0) * signY;
        ctx.translate(bounds.cx + ax, bounds.cy + ay);

        if (is3D && !this.isReady) {
          const posZ = bounds.posZ || 0;
          const camLens = Math.max(1, camera ? (camera.cameraLens !== undefined ? camera.cameraLens : 50) : 50);
          const camZoom = camera ? (camera.cameraZoom !== undefined ? camera.cameraZoom : 100) : 100;
          const lensFactor = Math.max(0.01, camLens / 50);
          const zoomFactor = Math.max(0.01, camZoom / 100);
          const totalZoom = lensFactor * zoomFactor;
          const camDist = CAMERA_DISTANCE * lensFactor * bufferScale;
          const nearPlane = NEAR_PLANE * bufferScale;
          const maxZ = camDist - nearPlane;
          const zScale = posZ ? (camDist / Math.max(nearPlane, camDist - Math.min(posZ, maxZ))) : 1;
          const vp2d = this._getProjectViewport(bufferScale, layer);
          const camInv2d = this._getCameraInverseScale(camera, vp2d.vw, vp2d.vh, bufferScale, this._camScaleScratch);
          const finalScaleX = zScale * totalZoom * camInv2d.x;
          const finalScaleY = zScale * totalZoom * camInv2d.y;
          if (finalScaleX !== 1 || finalScaleY !== 1) {
            ctx.scale(finalScaleX, finalScaleY);
          }
          if (bounds.rotX || bounds.rotY) {
            const cosX = Math.cos(((bounds.rotX || 0) * Math.PI) / 180);
            const cosY = Math.cos(((bounds.rotY || 0) * Math.PI) / 180);
            ctx.scale(cosY, cosX);
          }
        }

        if (bounds.rotation) {
          ctx.rotate((bounds.rotation * Math.PI) / 180);
        }
        if (bounds.skewX || bounds.skewY) {
          const tanX = Math.tan(((bounds.skewX || 0) * Math.PI) / 180);
          const tanY = Math.tan(((bounds.skewY || 0) * Math.PI) / 180);
          ctx.transform(1, tanY, tanX, 1, 0, 0);
        }
        if (signX < 0 || signY < 0) {
          ctx.scale(signX, signY);
        }
        const drawX = -absW / 2 - (bounds.anchorX || 0);
        const drawY = -absH / 2 - (bounds.anchorY || 0);
        const isPrecompCollapsed = (layer && layer.type === 'precomp' && !!layer.collapseTransformations);
        const rVal = (!isPrecompCollapsed && layer && typeof layer.roundness === 'number') ? layer.roundness : 0;
        const hasRoundClip = (rVal > 0);
        if (hasRoundClip) {
          const maxR = Math.min(absW, absH) / 2;
          const r = Math.min(rVal, maxR);
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(drawX, drawY, absW, absH, r);
          } else {
            ctx.moveTo(drawX + r, drawY);
            ctx.arcTo(drawX + absW, drawY, drawX + absW, drawY + absH, r);
            ctx.arcTo(drawX + absW, drawY + absH, drawX, drawY + absH, r);
            ctx.arcTo(drawX, drawY + absH, drawX, drawY, r);
            ctx.arcTo(drawX, drawY, drawX + absW, drawY, r);
            ctx.closePath();
          }
          ctx.clip();
        }
        try {
          const curSec = (typeof currentSec === 'number' && !isNaN(currentSec))
            ? currentSec
            : ((layer && typeof layer._currentSec === 'number')
              ? layer._currentSec
              : ((typeof window !== 'undefined' && typeof window._currentRenderSec === 'number')
                ? window._currentRenderSec
                : ((typeof window !== 'undefined' && typeof window.currentPlaybackSec === 'number')
                  ? window.currentPlaybackSec
                  : 0)));
          if (window.FishEffects && typeof window.FishEffects.renderLayer === 'function') {
            window.FishEffects.renderLayer(ctx, el, layer, { x: drawX, y: drawY, w: absW, h: absH, bufferScale: bounds.bufferScale || bufferScale || 1, unitScale: bounds.bufferScale || bufferScale || 1 }, curSec);
          } else {
            ctx.drawImage(el, drawX, drawY, absW, absH);
          }

          if (window.FishEffects && typeof window.FishEffects.applyPostEffects === 'function') {
            window.FishEffects.applyPostEffects(ctx, el, layer, { x: drawX, y: drawY, w: absW, h: absH, bufferScale: bounds.bufferScale || bufferScale || 1, unitScale: bounds.bufferScale || bufferScale || 1 });
          }
        } catch (fxErr) {
          console.warn('[Engine] Effect render failed, falling back to base image:', fxErr);
          try { ctx.drawImage(el, drawX, drawY, absW, absH); } catch (drawErr) {
            console.warn('[Engine] Base image fallback draw failed:', drawErr);
          }
        }
        ctx.restore();
        return;
      }

      // 2. Hardware 3D Perspective Path: Single Quad GPU Draw

      // Edge-on guard around 90 deg: skip invisible edge-on slivers (only when true layer bounds are also sliver)
      if ((bounds.aabbW < 1.0 && bounds.w < 1.0) || (bounds.aabbH < 1.0 && bounds.h < 1.0)) {
        return;
      }

      // Pre-process 2D effects onto local offscreen canvas before 3D perspective projection
      const layerSec = (typeof currentSec === 'number' && !isNaN(currentSec)) ? currentSec : ((layer && typeof layer._currentSec === 'number') ? layer._currentSec : null);
      const processed = this._getEffectProcessedElement(el, layer, bounds, layerSec);
      const sourceEl = processed.el;

      // Calculate Full 4x4 MVP Matrix
      let mvp = this._computeMVP(bounds, vw, vh, 0, camera, this._mvpScratchDraw);
      if (!mvp) return;

      if (processed.padX > 0 || processed.padY > 0) {
        const sX = (processed.origW + processed.padX * 2) / processed.origW;
        const sY = (processed.origH + processed.padY * 2) / processed.origH;
        const scaledMVP = this._mvpScratchPad;
        for (let i = 0; i < 16; i++) scaledMVP[i] = mvp[i];
        scaledMVP[0] *= sX;
        scaledMVP[1] *= sX;
        scaledMVP[2] *= sX;
        scaledMVP[3] *= sX;
        scaledMVP[4] *= sY;
        scaledMVP[5] *= sY;
        scaledMVP[6] *= sY;
        scaledMVP[7] *= sY;
        mvp = scaledMVP;
      }

      const gl = this.gl;
      if (this.glCanvas.width !== vw || this.glCanvas.height !== vh) {
        this.glCanvas.width = vw;
        this.glCanvas.height = vh;
        gl.viewport(0, 0, vw, vh);
      }

      gl.viewport(0, 0, vw, vh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const prevLayerCam = this._activeCamera;
      const prevLayerVw = this._activeVw;
      const prevLayerVh = this._activeVh;
      this._activeCamera = camera;
      this._activeVw = vw;
      this._activeVh = vh;

      gl.useProgram(this.program);
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);

      // Bind quad buffers
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.enableVertexAttribArray(this.locations.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);

      // Upload/Bind texture
      const tex = this._getOrCreateTexture(sourceEl);
      if (!tex) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.locations.texture, 0);
      const rawLayerOp = (layer.opacity !== undefined && layer.opacity !== null) ? Number(layer.opacity) : 1.0;
      const normLayerOp = (rawLayerOp > 1.0) ? Math.max(0, Math.min(1, rawLayerOp / 100)) : Math.max(0, Math.min(1, rawLayerOp));
      gl.uniform1f(this.locations.opacity, normLayerOp);
      if (this.locations.lensDistort) gl.uniform1f(this.locations.lensDistort, this._getLensDistort(camera));

      const tileFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f.type === 'tile' && !f.disabled)
        : null;

      const boxFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'box_3d' || f.type === '3d_box'))
        : null) || (layer.shapeType === '3d_box' ? { type: '3d_box' } : null);
      const extrudeFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && f.type === 'extrude_3d')
        : null;
      const pyramidFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'pyramid_3d' || f.type === '3d_pyramid'))
        : null) || (layer.shapeType === '3d_pyramid' || layer.shapeType === '3d_triangle' ? { type: '3d_pyramid', sideMode: 'solid color' } : null);
      const sphereFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'sphere_3d' || f.type === '3d_sphere'))
        : null) || (layer.shapeType === '3d_sphere' ? { type: '3d_sphere', sideMode: 'solid color' } : null);
      const coneFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'cone_3d' || f.type === '3d_cone'))
        : null) || (layer.shapeType === '3d_cone' ? { type: '3d_cone', sideMode: 'solid color' } : null);
      const cylinderFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'cylinder_3d' || f.type === '3d_cylinder'))
        : null) || (layer.shapeType === '3d_cylinder' ? { type: '3d_cylinder', sideMode: 'solid color' } : null);
      const torusFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'torus_3d' || f.type === '3d_torus'))
        : null) || (layer.shapeType === '3d_torus' ? { type: '3d_torus', sideMode: 'solid color' } : null);
      const modelFx = (layer.shapeType === '3d_model' && layer.modelMediaId) ? { type: '3d_model' } : null;

      if (!tileFx && !layer._dofBlur) {
        const hasSpillFx = Array.isArray(layer.effects) && layer.effects.some(f => f && !f.disabled && (f.type === 'drop-shadow' || f.type === 'deep-glow' || f.type === 'rgb-split' || f.type === 'blur'));
        if (!hasSpillFx) {
          const zRange = this._getLayerMeshZRange(layer, bounds, boxFx, extrudeFx, pyramidFx, sphereFx, coneFx, cylinderFx, torusFx, modelFx);
          if (this._isOutsideFrustum(mvp, zRange[0], zRange[1], this._getLensDistort(camera))) {
            this._activeCamera = prevLayerCam;
            this._activeVw = prevLayerVw;
            this._activeVh = prevLayerVh;
            return;
          }
        }
      }

      if (boxFx || extrudeFx || pyramidFx || sphereFx || coneFx || cylinderFx || torusFx || modelFx) {
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        if (modelFx) this._draw3DModelMesh(gl, mvp, bounds, normLayerOp, layer, sourceEl);
        else if (boxFx) this._draw3DBoxMesh(gl, mvp, boxFx, bounds, normLayerOp, layer, sourceEl);
        else if (extrudeFx) this._draw3DExtrudeMesh(gl, mvp, extrudeFx, bounds, normLayerOp, layer, sourceEl);
        else if (pyramidFx) this._draw3DPyramidMesh(gl, mvp, pyramidFx, bounds, normLayerOp, layer);
        else if (sphereFx) this._draw3DSphereMesh(gl, mvp, sphereFx, bounds, normLayerOp, layer);
        else if (coneFx) this._draw3DConeMesh(gl, mvp, coneFx, bounds, normLayerOp, layer, sourceEl);
        else if (cylinderFx) this._draw3DCylinderMesh(gl, mvp, cylinderFx, bounds, normLayerOp, layer, sourceEl);
        else if (torusFx) this._draw3DTorusMesh(gl, mvp, torusFx, bounds, normLayerOp, layer, sourceEl);
        gl.disable(gl.DEPTH_TEST);
      } else {
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        this._drawQuadOrTile(gl, mvp, tileFx, vw, vh, bounds);
      }
      this._activeCamera = prevLayerCam;
      this._activeVw = prevLayerVw;
      this._activeVh = prevLayerVh;

      // Blit GL framebuffer onto target 2D canvas context
      this._blitGLToContext(ctx, layer, bounds, vw, vh, bufferScale);
      // Deep Glow rasa adjustment: blur 2D dari snapshot proyeksi, spill full
      this._applyDeepGlowScreenSpace(ctx, layer, bounds, layerSec);
    }

    _drawQuadOrTile(gl, mvp, tileFx, vw, vh, bounds) {
      if (tileFx) {
        const isMirror = (tileFx.mirror === 1 || tileFx.mirror === true || tileFx.mirror === '1' || tileFx.mirror === 'true' || tileFx.mirror === 'on');
        const tileScale = Math.max(5, (tileFx.scale !== undefined ? tileFx.scale : 100)) / 100;
        const rawOffX = ((tileFx.offsetX !== undefined ? tileFx.offsetX : 0) / 100);
        const rawOffY = ((tileFx.offsetY !== undefined ? tileFx.offsetY : 0) / 100);

        const periodX = isMirror ? (tileScale * 2) : tileScale;
        const periodY = isMirror ? (tileScale * 2) : tileScale;

        let offX = rawOffX % periodX;
        if (offX < 0) offX += periodX;

        let offY = rawOffY % periodY;
        if (offY < 0) offY += periodY;

        const spanX = Math.ceil(vw / Math.max(20, (bounds.w || 100) * tileScale));
        const spanY = Math.ceil(vh / Math.max(20, (bounds.h || 100) * tileScale));
        const countX = Math.min(16, Math.max(4, Math.ceil(spanX * 2.5)));
        const countY = Math.min(16, Math.max(4, Math.ceil(spanY * 2.5)));
        const tileMVP = new Float32Array(16);

        for (let j = -countY; j <= countY; j++) {
          for (let i = -countX; i <= countX; i++) {
            const flipX = isMirror && (Math.abs(i) % 2 === 1);
            const flipY = isMirror && (Math.abs(j) % 2 === 1);

            const dirX = flipX ? -1 : 1;
            const dirY = flipY ? -1 : 1;

            const sX = tileScale * dirX;
            const sY = tileScale * dirY;

            const shiftX = offX + i * tileScale;
            const shiftY = offY + j * tileScale;

            tileMVP[0] = mvp[0] * sX;
            tileMVP[1] = mvp[1] * sX;
            tileMVP[2] = mvp[2] * sX;
            tileMVP[3] = mvp[3] * sX;

            tileMVP[4] = mvp[4] * sY;
            tileMVP[5] = mvp[5] * sY;
            tileMVP[6] = mvp[6] * sY;
            tileMVP[7] = mvp[7] * sY;

            tileMVP[8] = mvp[8];
            tileMVP[9] = mvp[9];
            tileMVP[10] = mvp[10];
            tileMVP[11] = mvp[11];

            tileMVP[12] = mvp[12] + mvp[0] * shiftX + mvp[4] * shiftY;
            tileMVP[13] = mvp[13] + mvp[1] * shiftX + mvp[5] * shiftY;
            tileMVP[14] = mvp[14] + mvp[2] * shiftX + mvp[6] * shiftY;
            tileMVP[15] = mvp[15] + mvp[3] * shiftX + mvp[7] * shiftY;

            const maxRadiusW = Math.abs(tileMVP[3] * 0.5) + Math.abs(tileMVP[7] * 0.5);
            if (tileMVP[15] + maxRadiusW <= 0.001) continue;

            gl.uniformMatrix4fv(this.locations.matrix, false, tileMVP);
            gl.drawElements(gl.TRIANGLES, this.quadIndexCount, gl.UNSIGNED_SHORT, 0);
          }
        }
      } else {
        gl.uniform1i(this.locations.mode, 0);
        gl.disableVertexAttribArray(this.locations.color);
        gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
        gl.uniformMatrix4fv(this.locations.matrix, false, mvp);
        gl.drawElements(gl.TRIANGLES, this.quadIndexCount, gl.UNSIGNED_SHORT, 0);
      }
    }

    _setSolidCullFace(gl, enable, bounds) {
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

    _scaleMatrixZ(out, src, zScale) {
      for (let i = 0; i < 16; i++) out[i] = src[i];
      out[8] *= zScale;
      out[9] *= zScale;
      out[10] *= zScale;
      out[11] *= zScale;
      return out;
    }

    _isOutsideFrustum(mvp, zMin = 0, zMax = 0, lensDistort = 0) {
      if (!mvp || Math.abs(lensDistort) > 0.001) return false;
      let allOut = 63;
      const zCount = (zMax !== zMin) ? 2 : 1;
      for (let zi = 0; zi < zCount; zi++) {
        const z = (zi === 0) ? zMin : zMax;
        for (let yi = 0; yi < 2; yi++) {
          const y = (yi === 0) ? -0.5 : 0.5;
          for (let xi = 0; xi < 2; xi++) {
            const x = (xi === 0) ? -0.5 : 0.5;
            const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
            const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
            const cz = mvp[2] * x + mvp[6] * y + mvp[10] * z + mvp[14];
            const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
            const code =
              (cx + cw < 0 ? 1 : 0) |
              (cw - cx < 0 ? 2 : 0) |
              (cy + cw < 0 ? 4 : 0) |
              (cw - cy < 0 ? 8 : 0) |
              (cz + cw < 0 ? 16 : 0) |
              (cw - cz < 0 ? 32 : 0);
            allOut &= code;
            if (allOut === 0) return false;
          }
        }
      }
      return allOut !== 0;
    }

    _getLayerMeshZRange(layer, bounds, bFx, eFx, pFx, sFx, cFx, cylFx, tFx, mFx) {
      const out = this._zRangeScratch || (this._zRangeScratch = new Float32Array(2));
      const bScale = (bounds && bounds.bufferScale) ? bounds.bufferScale : 1;
      const w = (bounds && bounds.w) ? bounds.w : (300 * bScale);
      const h = (bounds && bounds.h) ? bounds.h : (300 * bScale);
      const lDepth = (layer && layer.scaleZ !== undefined)
        ? (layer.scaleZ * bScale)
        : ((layer && layer.depth !== undefined) ? (layer.depth * bScale) : null);

      if (bFx || cFx || cylFx || mFx) {
        const d = Math.max(1, lDepth !== null ? lDepth : ((bFx && bFx.depth !== undefined) ? bFx.depth * bScale : Math.round(Math.min(w, h))));
        out[0] = -d * 0.5;
        out[1] = d * 0.5;
      } else if (tFx) {
        const d = Math.max(1, lDepth !== null ? lDepth : (150 * bScale));
        const rMax = 0.12 * d * 2;
        out[0] = -rMax;
        out[1] = rMax;
      } else if (sFx) {
        const defD = Math.round(Math.min(w, h)) * 0.5;
        const d = Math.max(0.1, lDepth !== null ? lDepth : defD);
        out[0] = -d;
        out[1] = d;
      } else if (pFx) {
        const d = Math.max(0, lDepth !== null ? lDepth : ((pFx.height !== undefined) ? pFx.height * bScale : Math.round(Math.min(w, h))));
        out[0] = 0;
        out[1] = d;
      } else if (eFx) {
        const d = Math.max(1, lDepth !== null ? lDepth : ((eFx.extrudeDepth !== undefined) ? eFx.extrudeDepth * bScale : Math.round(Math.min(w, h))));
        out[0] = -d;
        out[1] = 0;
      } else {
        out[0] = 0;
        out[1] = 0;
      }
      return out;
    }

    _draw3DBoxMesh(gl, mvp, boxFx, bounds, layerOpacity, layer = null, el = null) {
      if (typeof window !== 'undefined' && window.Fish3DEngine && typeof window.Fish3DEngine.draw3DBoxMesh === 'function') {
        this._applyLightingUniforms(gl, layer, null, bounds, bounds && bounds.w, bounds && bounds.h);
        window.Fish3DEngine.draw3DBoxMesh(gl, this.locations, this.buffers, mvp, bounds, layerOpacity, layer, el, this._currentModelMatrix, this);
        this._restoreMeshQuadState(gl);
        return;
      }
      const bScale = (bounds && bounds.bufferScale) ? bounds.bufferScale : 1;
      const defaultDepth = bounds && (bounds.w || bounds.h)
        ? Math.round(Math.min(bounds.w || (300 * bScale), bounds.h || (300 * bScale)))
        : (300 * bScale);
      const lDepth = (layer && layer.scaleZ !== undefined) ? (layer.scaleZ * bScale) : ((layer && layer.depth !== undefined) ? (layer.depth * bScale) : ((boxFx && boxFx.depth !== undefined) ? (boxFx.depth * bScale) : null));
      const depth = Math.max(1, lDepth !== null ? lDepth : defaultDepth);
      const isSolidMode = boxFx && boxFx.sideMode === 'solid color';
      const defaultWhite = '#ffffff';
      let faceColor = (boxFx && boxFx.faceColor) || defaultWhite;
      if (isSolidMode && faceColor === defaultWhite && layer && (layer.fillColor || layer.color)) {
        faceColor = layer.fillColor || layer.color;
      }
      const rawFaceOp = (boxFx && boxFx.faceOpacity !== undefined) ? boxFx.faceOpacity : 100;
      const faceOpacity = Math.max(0, Math.min(1, rawFaceOp / 100)) * (layerOpacity !== undefined ? layerOpacity : 1.0);
      const edgeColor = (boxFx && boxFx.edgeColor) || '#ffffff';
      const edgeOpacity = Math.max(0, Math.min(1, (boxFx && boxFx.edgeOpacity !== undefined ? boxFx.edgeOpacity : 0) / 100));
      const shading = Math.max(0, Math.min(1, (boxFx && boxFx.shading !== undefined ? boxFx.shading : 0) / 100));

      gl.uniformMatrix4fv(this.locations.matrix, false, mvp);

      // --- Pass 1: Front Face (Textured, at z = 0) ---
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);

      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
      gl.drawElements(gl.TRIANGLES, this.quadIndexCount, gl.UNSIGNED_SHORT, 0);

      if (depth < 0.5) return;

      // --- Pass 2: 5 Shaded Faces (Back, Top, Bottom, Left, Right) ---
      const cBase = hexToRgb(faceColor);
      const mulTop = 1.0 + shading * 0.4;
      const mulRight = Math.max(0.15, 1.0 - shading * 0.25);
      const mulLeft = Math.max(0.15, 1.0 - shading * 0.35);
      const mulBot = Math.max(0.1, 1.0 - shading * 0.55);
      const mulBack = Math.max(0.1, 1.0 - shading * 0.45);

      const tintR = isSolidMode ? (cBase.r / 255) : 1.0;
      const tintG = isSolidMode ? (cBase.g / 255) : 1.0;
      const tintB = isSolidMode ? (cBase.b / 255) : 1.0;

      const makeCol = (m) => [
        Math.min(1.0, tintR * m),
        Math.min(1.0, tintG * m),
        Math.min(1.0, tintB * m),
        faceOpacity
      ];

      const cTop = makeCol(mulTop);
      const cRight = makeCol(mulRight);
      const cLeft = makeCol(mulLeft);
      const cBot = makeCol(mulBot);
      const cBack = makeCol(mulBack);

      const solidPositions = new Float32Array([
        // Back Face (z = -depth)
        -0.5, -0.5, -depth,
         0.5, -0.5, -depth,
         0.5,  0.5, -depth,
        -0.5,  0.5, -depth,

        // Top Face (y = -0.5)
        -0.5, -0.5,      0,
         0.5, -0.5,      0,
         0.5, -0.5, -depth,
        -0.5, -0.5, -depth,

        // Bottom Face (y = 0.5)
        -0.5,  0.5,      0,
         0.5,  0.5,      0,
         0.5,  0.5, -depth,
        -0.5,  0.5, -depth,

        // Left Face (x = -0.5)
        -0.5, -0.5,      0,
        -0.5,  0.5,      0,
        -0.5,  0.5, -depth,
        -0.5, -0.5, -depth,

        // Right Face (x = 0.5)
         0.5, -0.5,      0,
         0.5,  0.5,      0,
         0.5,  0.5, -depth,
         0.5, -0.5, -depth
      ]);

      const solidColors = new Float32Array([
        ...cBack, ...cBack, ...cBack, ...cBack,
        ...cTop, ...cTop, ...cTop, ...cTop,
        ...cBot, ...cBot, ...cBot, ...cBot,
        ...cLeft, ...cLeft, ...cLeft, ...cLeft,
        ...cRight, ...cRight, ...cRight, ...cRight
      ]);

      const solidTexCoords = new Float32Array([
        // Back Face (mirrored texture)
        1.0, 0.0,
        0.0, 0.0,
        0.0, 1.0,
        1.0, 1.0,

        // Top Face (maps texture across top surface)
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,

        // Bottom Face (maps texture across bottom surface)
        0.0, 1.0,
        1.0, 1.0,
        1.0, 0.0,
        0.0, 0.0,

        // Left Face (maps texture across left surface)
        0.0, 0.0,
        0.0, 1.0,
        1.0, 1.0,
        1.0, 0.0,

        // Right Face (maps texture across right surface)
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
        0.0, 0.0
      ]);

      const solidIndices = new Uint16Array([
        0, 1, 2,  0, 2, 3,
        4, 5, 6,  4, 6, 7,
        8, 9, 10,  8, 10, 11,
        12, 13, 14,  12, 14, 15,
        16, 17, 18,  16, 18, 19
      ]);

      gl.uniform1i(this.locations.mode, isSolidMode ? 1 : 0);

      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, solidPositions, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.texCoord);
      gl.bufferData(gl.ARRAY_BUFFER, solidTexCoords, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, solidColors, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshBuffers.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, solidIndices, gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, 30, gl.UNSIGNED_SHORT, 0);

      // --- Pass 3: 12 Wireframe Edge Lines ---
      if (edgeOpacity > 0) {
        const edgePositions = new Float32Array([
          // Front 4 edges (z = 0)
          -0.5, -0.5, 0,    0.5, -0.5, 0,
           0.5, -0.5, 0,    0.5,  0.5, 0,
           0.5,  0.5, 0,   -0.5,  0.5, 0,
          -0.5,  0.5, 0,   -0.5, -0.5, 0,

          // Back 4 edges (z = -depth)
          -0.5, -0.5, -depth,    0.5, -0.5, -depth,
           0.5, -0.5, -depth,    0.5,  0.5, -depth,
           0.5,  0.5, -depth,   -0.5,  0.5, -depth,
          -0.5,  0.5, -depth,   -0.5, -0.5, -depth,

          // 4 Connecting side edges
          -0.5, -0.5, 0,   -0.5, -0.5, -depth,
           0.5, -0.5, 0,    0.5, -0.5, -depth,
           0.5,  0.5, 0,    0.5,  0.5, -depth,
          -0.5,  0.5, 0,   -0.5,  0.5, -depth
        ]);

        const cEdge = hexToRgb(edgeColor);
        gl.uniform1i(this.locations.mode, 1);
        gl.disableVertexAttribArray(this.locations.color);
        gl.disableVertexAttribArray(this.locations.texCoord);
        gl.vertexAttrib4f(this.locations.color, cEdge.r / 255, cEdge.g / 255, cEdge.b / 255, edgeOpacity);
        gl.vertexAttrib2f(this.locations.texCoord, 0.0, 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, edgePositions, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.LINES, 0, 24);
      }

      // Restore standard 2D quad state for subsequent renders
      this._restoreMeshQuadState(gl);
    }

    /* ── True-shape silhouette extrusion (text / triangle / image cutouts) ────
     * Marching squares on the source alpha (≤176px readout) yields contour
     * segments in unit-quad space; side walls are built along the REAL outline
     * instead of the bounding box, so text extrudes as text and a triangle
     * extrudes as a triangle. Fully opaque rectangles (video, solids) keep the
     * cheap exact box walls ('box'); fully transparent ⇒ 'empty'.
     * Cached per source content-version (static images compute once). */
    _extractExtrudeContour(srcEl) {
      if (!srcEl || typeof document === 'undefined') return { kind: 'box', segs: null };
      const ew = Math.round(srcEl.naturalWidth || srcEl.videoWidth || srcEl.width || 0);
      const eh = Math.round(srcEl.naturalHeight || srcEl.videoHeight || srcEl.height || 0);
      if (ew < 2 || eh < 2) return { kind: 'box', segs: null };
      const ver = (srcEl._contentVersion !== undefined && srcEl._contentVersion !== null)
        ? srcEl._contentVersion
        : ((srcEl.tagName === 'IMG') ? ('img:' + (srcEl.src || '')) : -1);
      const MAXD = 256;
      const k = Math.min(1, MAXD / Math.max(ew, eh));
      const W = Math.max(8, Math.round(ew * k));
      const H = Math.max(8, Math.round(eh * k));
      const cached = this._extrudeContourCache.get(srcEl);
      if (cached && cached.ver === ver && cached.W === W && cached.H === H) return cached.res;
      let res = { kind: 'box', segs: null };
      try {
        if (!this._extrudeScratch) {
          this._extrudeScratch = document.createElement('canvas');
          this._extrudeScratchCtx = this._extrudeScratch.getContext('2d', { willReadFrequently: true });
        }
        const sc = this._extrudeScratch;
        const sx = this._extrudeScratchCtx;
        if (!sx) return res;
        if (sc.width !== W || sc.height !== H) { sc.width = W; sc.height = H; }
        sx.setTransform(1, 0, 0, 1, 0, 0);
        sx.globalCompositeOperation = 'source-over';
        sx.globalAlpha = 1;
        sx.clearRect(0, 0, W, H);
        sx.drawImage(srcEl, 0, 0, W, H);
        const px = sx.getImageData(0, 0, W, H).data;
        let opaque = 0, clear = 0;
        const total = W * H;
        for (let i = 3; i < px.length; i += 4) {
          const a = px[i];
          if (a > 250) opaque++;
          else if (a < 8) clear++;
        }
        if (clear === total) res = { kind: 'empty', segs: null };
        else if (opaque === total) res = { kind: 'box', segs: null };
        else {
          const segs = this._marchingSquaresAlpha(px, W, H);
          if (segs && segs.length >= 24) {
            // Inward-shifted UVs: the contour sits on ~50% alpha texels, which
            // would render ghostly semi-transparent walls. Sampling ~1.5px
            // inside the shape grabs fully opaque interior texels instead.
            res = { kind: 'contour', segs, uvs: this._inwardContourUvs(px, W, H, segs) };
          } else {
            res = { kind: 'box', segs: null };
          }
        }
      } catch (_) { res = { kind: 'box', segs: null }; }
      try { this._extrudeContourCache.set(srcEl, { ver, W, H, res }); } catch (_) {}
      return res;
    }

    /* Marching squares on alpha channel → flat [x1,y1,x2,y2 …] segments in
     * unit-quad space ([-0.5, 0.5], y down like texture v). Holes (O, A, …)
     * emerge automatically since every cell is independent. Pure function. */
    _marchingSquaresAlpha(px, W, H) {
      const T = 128;
      const segs = [];
      const at = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return 0;
        return px[((y * W) + x) * 4 + 3];
      };
      const mix = (v0, v1) => {
        if (v1 === v0) return 0.5;
        const t = (T - v0) / (v1 - v0);
        return t < 0 ? 0 : (t > 1 ? 1 : t);
      };
      // pixel-corner (ix,iy) integer grid 0..W,0..H → unit space (matches uv-0.5)
      const UX = ix => (ix / W) - 0.5;
      const UY = iy => (iy / H) - 0.5;
      const emit = (ax, ay, bx, by) => {
        const x1 = UX(ax), y1 = UY(ay), x2 = UX(bx), y2 = UY(by);
        const dx = x2 - x1, dy = y2 - y1;
        if (dx * dx + dy * dy < 1e-12) return;
        segs.push(x1, y1, x2, y2);
      };
      for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
          const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1);
          let idx = 0;
          if (a > T) idx |= 8;
          if (b > T) idx |= 4;
          if (c > T) idx |= 2;
          if (d > T) idx |= 1;
          if (idx === 0 || idx === 15) continue;
          // crossing points on the four cell edges (pixel-corner coords)
          const top = [x + mix(a, b), y];
          const right = [x + 1, y + mix(b, c)];
          const bot = [x + mix(d, c), y + 1];
          const left = [x, y + mix(a, d)];
          const S = (p, q) => emit(p[0], p[1], q[0], q[1]);
          switch (idx) {
            case 1: case 14: S(left, bot); break;
            case 2: case 13: S(bot, right); break;
            case 3: case 12: S(left, right); break;
            case 4: case 11: S(top, right); break;
            case 5: S(left, top); S(right, bot); break;
            case 6: case 9: S(top, bot); break;
            case 7: case 8: S(left, top); break;
            case 10: S(top, right); S(left, bot); break;
          }
        }
      }
      return segs;
    }

    /* Inward-shifted sample UVs for contour walls (flat [u1,v1,u2,v2 …],
     * parallel to segs). Probes both sides of each segment in the alpha grid
     * and shifts ~1.5px toward the more opaque side, so walls sample solid
     * interior texels instead of the ~50% edge texels. Pure function. */
    _inwardContourUvs(data, W, H, segs) {
      const at = (x, y) => {
        x = x < 0 ? 0 : (x > W - 1 ? W - 1 : Math.round(x));
        y = y < 0 ? 0 : (y > H - 1 ? H - 1 : Math.round(y));
        return data[((y * W) + x) * 4 + 3];
      };
      const out = new Float32Array(segs.length);
      for (let i = 0; i + 3 < segs.length; i += 4) {
        // unit space → pixel-corner coords (exact inverse of UX/UY mapping)
        const ax = (segs[i] + 0.5) * W, ay = (segs[i + 1] + 0.5) * H;
        const bx = (segs[i + 2] + 0.5) * W, by = (segs[i + 3] + 0.5) * H;
        let dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const nx = dy, ny = -dx;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const aPlus = at(mx + nx * 1.5, my + ny * 1.5);
        const aMinus = at(mx - nx * 1.5, my - ny * 1.5);
        const s = (aPlus >= aMinus) ? 1 : -1;
        const ox = (nx * s * 1.5) / W, oy = (ny * s * 1.5) / H;
        const cl = v => v < 0 ? 0 : (v > 1 ? 1 : v);
        out[i] = cl((ax / W) + ox); out[i + 1] = cl((ay / H) + oy);
        out[i + 2] = cl((bx / W) + ox); out[i + 3] = cl((by / H) + oy);
      }
      return out;
    }

    /* Contour side walls + back cap arrays. Front edge verts carry colFront,
     * back edge verts colBack (depth cue). uvSegs (optional, same layout as
     * segs) overrides geometric UVs for inward-shifted opaque sampling. Pure. */
    _buildExtrudeWallArrays(segs, uvSegs, depth, colFront, colBack) {
      const total = Math.floor(segs.length / 4);
      if (total < 1) return null;
      const MAXS = 4096;
      const stride = total > MAXS ? Math.ceil(total / MAXS) : 1;
      const order = [];
      for (let s = 0; s < total; s += stride) order.push(s);
      const S = order.length;
      const positions = new Float32Array(S * 18);
      const colors = new Float32Array(S * 24);
      const uvs = new Float32Array(S * 12);
      const edges = new Float32Array(S * 12);
      const pushC = (arr, o, col) => { arr[o] = col[0]; arr[o + 1] = col[1]; arr[o + 2] = col[2]; arr[o + 3] = col[3]; };
      let p = 0, c = 0, t = 0, e = 0;
      for (let k = 0; k < S; k++) {
        const s = order[k] * 4;
        const ax = segs[s], ay = segs[s + 1], bx = segs[s + 2], by = segs[s + 3];
        // Af, Bf, Bb | Af, Bb, Ab
        positions[p++] = ax; positions[p++] = ay; positions[p++] = 0;
        positions[p++] = bx; positions[p++] = by; positions[p++] = 0;
        positions[p++] = bx; positions[p++] = by; positions[p++] = -depth;
        positions[p++] = ax; positions[p++] = ay; positions[p++] = 0;
        positions[p++] = bx; positions[p++] = by; positions[p++] = -depth;
        positions[p++] = ax; positions[p++] = ay; positions[p++] = -depth;
        pushC(colors, c, colFront); c += 4;
        pushC(colors, c, colFront); c += 4;
        pushC(colors, c, colBack); c += 4;
        pushC(colors, c, colFront); c += 4;
        pushC(colors, c, colBack); c += 4;
        pushC(colors, c, colBack); c += 4;
        // Inward-shifted UVs when available (opaque interior sampling);
        // otherwise geometric UVs (exact contour location).
        const hasUv = uvSegs && uvSegs.length >= s + 4;
        const u1 = hasUv ? uvSegs[s] : ax + 0.5;
        const v1 = hasUv ? uvSegs[s + 1] : ay + 0.5;
        const u2 = hasUv ? uvSegs[s + 2] : bx + 0.5;
        const v2 = hasUv ? uvSegs[s + 3] : by + 0.5;
        uvs[t++] = u1; uvs[t++] = v1;
        uvs[t++] = u2; uvs[t++] = v2;
        uvs[t++] = u2; uvs[t++] = v2;
        uvs[t++] = u1; uvs[t++] = v1;
        uvs[t++] = u2; uvs[t++] = v2;
        uvs[t++] = u1; uvs[t++] = v1;
        edges[e++] = ax; edges[e++] = ay; edges[e++] = 0;
        edges[e++] = bx; edges[e++] = by; edges[e++] = 0;
        edges[e++] = ax; edges[e++] = ay; edges[e++] = -depth;
        edges[e++] = bx; edges[e++] = by; edges[e++] = -depth;
      }
      return { positions, colors, uvs, edges, count: S * 6, edgeCount: S * 4 };
    }

    /* Draw silhouette walls + textured back cap + contour edge lines. */
    _drawExtrudeContourSolid(gl, segs, uvSegs, depth, opts) {
      const built = this._buildExtrudeWallArrays(segs, uvSegs, depth, opts.colFront, opts.colBack);
      if (!built) return;
      gl.uniform1i(this.locations.mode, opts.solid ? 1 : 0);
      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, built.positions, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.texCoord);
      gl.bufferData(gl.ARRAY_BUFFER, built.uvs, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.locations.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, built.colors, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, built.count);

      // Back cap (textured silhouette at z = -depth, same uv as front)
      const bp = new Float32Array([
        -0.5, -0.5, -depth,   0.5, -0.5, -depth,   0.5, 0.5, -depth,
        -0.5, -0.5, -depth,   0.5,  0.5, -depth,  -0.5, 0.5, -depth
      ]);
      const buv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
      const bc = new Float32Array(24);
      for (let i = 0; i < 6; i++) {
        bc[i * 4] = opts.colBack[0]; bc[i * 4 + 1] = opts.colBack[1];
        bc[i * 4 + 2] = opts.colBack[2]; bc[i * 4 + 3] = opts.colBack[3];
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, bp, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.texCoord);
      gl.bufferData(gl.ARRAY_BUFFER, buv, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, bc, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (opts.edgeOpacity > 0) {
        const cE = opts.edgeRgb;
        gl.uniform1i(this.locations.mode, 1);
        gl.disableVertexAttribArray(this.locations.color);
        gl.disableVertexAttribArray(this.locations.texCoord);
        gl.vertexAttrib4f(this.locations.color, cE.r / 255, cE.g / 255, cE.b / 255, opts.edgeOpacity);
        gl.vertexAttrib2f(this.locations.texCoord, 0.0, 0.0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, built.edges, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, built.edgeCount);
      }
    }

    /* Restore standard 2D quad attrib state after a mesh draw. */
    _restoreMeshQuadState(gl) {
      if (this.isWebGL2 && typeof gl.bindVertexArray === 'function') {
        gl.bindVertexArray(null);
      }
      gl.disable(gl.CULL_FACE);
      gl.frontFace(gl.CCW);
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
      if (this.locations.normal !== -1 && this.locations.normal !== undefined) {
        gl.disableVertexAttribArray(this.locations.normal);
        gl.vertexAttrib3f(this.locations.normal, 0.0, 0.0, 1.0);
      }
      if (this.locations.numLights) gl.uniform1i(this.locations.numLights, 0);
      if (this.locations.materialParams) gl.uniform4f(this.locations.materialParams, 0.0, 1.0, 0.5, 0.5);
      if (this.locations.matExtra) gl.uniform4f(this.locations.matExtra, 0.0, 0.0, 1.0, 0.0);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
    }

    _draw3DConeMesh(gl, mvp, coneFx, bounds, layerOpacity, layer = null, el = null) {
      if (typeof window !== 'undefined' && window.Fish3DEngine && typeof window.Fish3DEngine.draw3DConeMesh === 'function') {
        this._applyLightingUniforms(gl, layer, null, bounds, bounds && bounds.w, bounds && bounds.h);
        window.Fish3DEngine.draw3DConeMesh(gl, this.locations, this.buffers, mvp, bounds, layerOpacity, layer, el, this._currentModelMatrix, this);
      }
      this._restoreMeshQuadState(gl);
    }

    _draw3DCylinderMesh(gl, mvp, cylinderFx, bounds, layerOpacity, layer = null, el = null) {
      if (typeof window !== 'undefined' && window.Fish3DEngine && typeof window.Fish3DEngine.draw3DCylinderMesh === 'function') {
        this._applyLightingUniforms(gl, layer, null, bounds, bounds && bounds.w, bounds && bounds.h);
        window.Fish3DEngine.draw3DCylinderMesh(gl, this.locations, this.buffers, mvp, bounds, layerOpacity, layer, el, this._currentModelMatrix, this);
      }
      this._restoreMeshQuadState(gl);
    }

    _draw3DTorusMesh(gl, mvp, torusFx, bounds, layerOpacity, layer = null, el = null) {
      if (typeof window !== 'undefined' && window.Fish3DEngine && typeof window.Fish3DEngine.draw3DTorusMesh === 'function') {
        this._applyLightingUniforms(gl, layer, null, bounds, bounds && bounds.w, bounds && bounds.h);
        window.Fish3DEngine.draw3DTorusMesh(gl, this.locations, this.buffers, mvp, bounds, layerOpacity, layer, el, this._currentModelMatrix, this);
      }
      this._restoreMeshQuadState(gl);
    }

    _draw3DModelMesh(gl, mvp, bounds, layerOpacity, layer = null, el = null) {
      if (typeof window !== 'undefined' && window.Fish3DLoader && typeof window.Fish3DLoader.draw3DModelMesh === 'function') {
        this._applyLightingUniforms(gl, layer, null, bounds, bounds && bounds.w, bounds && bounds.h);
        window.Fish3DLoader.draw3DModelMesh(gl, this.locations, mvp, bounds, layerOpacity, layer, el, this._currentModelMatrix, this);
      }
      this._restoreMeshQuadState(gl);
    }

    _draw3DExtrudeMesh(gl, mvp, extrudeFx, bounds, layerOpacity, layer = null, srcEl = null) {
      const bScale = (bounds && bounds.bufferScale) ? bounds.bufferScale : 1;
      const defaultDepth = bounds && (bounds.w || bounds.h)
        ? Math.round(Math.min(bounds.w || (300 * bScale), bounds.h || (300 * bScale)))
        : (300 * bScale);
      const lDepth = (layer && layer.scaleZ !== undefined) ? (layer.scaleZ * bScale) : ((layer && layer.depth !== undefined) ? (layer.depth * bScale) : ((extrudeFx && extrudeFx.extrudeDepth !== undefined) ? (extrudeFx.extrudeDepth * bScale) : null));
      const depth = Math.max(1, lDepth !== null ? lDepth : defaultDepth);
      const isSolidMode = extrudeFx && extrudeFx.sideMode === 'solid color';
      const defaultWhite = '#ffffff';
      let faceColor = (extrudeFx && (extrudeFx.faceColor || extrudeFx.shadeColor)) || defaultWhite;
      if (isSolidMode && faceColor === defaultWhite && layer && (layer.fillColor || layer.color)) {
        faceColor = layer.fillColor || layer.color;
      }
      const rawFaceOp = (extrudeFx && (extrudeFx.faceOpacity !== undefined ? extrudeFx.faceOpacity : extrudeFx.shadeOpacity)) !== undefined ? (extrudeFx.faceOpacity !== undefined ? extrudeFx.faceOpacity : extrudeFx.shadeOpacity) : 100;
      const faceOpacity = Math.max(0, Math.min(1, rawFaceOp / 100)) * (layerOpacity !== undefined ? layerOpacity : 1.0);
      const edgeColor = (extrudeFx && extrudeFx.edgeColor) || '#ffffff';
      const edgeOpacity = Math.max(0, Math.min(1, (extrudeFx && extrudeFx.edgeOpacity !== undefined ? extrudeFx.edgeOpacity : 0) / 100));
      const shading = Math.max(0, Math.min(1, (extrudeFx && extrudeFx.shading !== undefined ? extrudeFx.shading : 0) / 100));

      gl.uniformMatrix4fv(this.locations.matrix, false, mvp);

      // Front Face (Textured, at z = 0)
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);

      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
      gl.drawElements(gl.TRIANGLES, this.quadIndexCount, gl.UNSIGNED_SHORT, 0);

      if (depth < 0.5) return;

      // 4 Extrusion Side Walls + Back Face
      const cBase = hexToRgb(faceColor);
      const mulTop = 1.0 + shading * 0.4;
      const mulRight = Math.max(0.15, 1.0 - shading * 0.25);
      const mulLeft = Math.max(0.15, 1.0 - shading * 0.35);
      const mulBot = Math.max(0.1, 1.0 - shading * 0.55);
      const mulBack = Math.max(0.1, 1.0 - shading * 0.45);

      const tintR = isSolidMode ? (cBase.r / 255) : 1.0;
      const tintG = isSolidMode ? (cBase.g / 255) : 1.0;
      const tintB = isSolidMode ? (cBase.b / 255) : 1.0;

      const makeCol = (m) => [
        Math.min(1.0, tintR * m),
        Math.min(1.0, tintG * m),
        Math.min(1.0, tintB * m),
        faceOpacity
      ];

      const cTop = makeCol(mulTop);
      const cRight = makeCol(mulRight);
      const cLeft = makeCol(mulLeft);
      const cBot = makeCol(mulBot);
      const cBack = makeCol(mulBack);

      // True-shape branch: text / triangle / cutout layers extrude their own
      // alpha outline (silhouette walls); opaque rectangles fall through to the
      // box walls below. Empty layers draw nothing but restore GL state.
      const contour = this._extractExtrudeContour(srcEl);
      const contourSegs = (contour && contour.kind === 'contour' && contour.segs) ? contour.segs : null;
      if (contourSegs && contourSegs.length >= 24) {
        this._drawExtrudeContourSolid(gl, contourSegs, contour.uvs, depth, {
          solid: isSolidMode,
          colFront: makeCol(1.0),
          colBack: makeCol(Math.max(0.1, 1.0 - shading * 0.45)),
          edgeRgb: hexToRgb(edgeColor),
          edgeOpacity
        });
        this._restoreMeshQuadState(gl);
        return;
      }
      if (contour && contour.kind === 'empty') {
        this._restoreMeshQuadState(gl);
        return;
      }

      const solidPositions = new Float32Array([
        // Back Face (z = -depth)
        -0.5, -0.5, -depth,
         0.5, -0.5, -depth,
         0.5,  0.5, -depth,
        -0.5,  0.5, -depth,

        // Top Face (y = -0.5)
        -0.5, -0.5,      0,
         0.5, -0.5,      0,
         0.5, -0.5, -depth,
        -0.5, -0.5, -depth,

        // Bottom Face (y = 0.5)
        -0.5,  0.5,      0,
         0.5,  0.5,      0,
         0.5,  0.5, -depth,
        -0.5,  0.5, -depth,

        // Left Face (x = -0.5)
        -0.5, -0.5,      0,
        -0.5,  0.5,      0,
        -0.5,  0.5, -depth,
        -0.5, -0.5, -depth,

        // Right Face (x = 0.5)
         0.5, -0.5,      0,
         0.5,  0.5,      0,
         0.5,  0.5, -depth,
         0.5, -0.5, -depth
      ]);

      const solidColors = new Float32Array([
        ...cBack, ...cBack, ...cBack, ...cBack,
        ...cTop, ...cTop, ...cTop, ...cTop,
        ...cBot, ...cBot, ...cBot, ...cBot,
        ...cLeft, ...cLeft, ...cLeft, ...cLeft,
        ...cRight, ...cRight, ...cRight, ...cRight
      ]);

      const solidTexCoords = new Float32Array([
        // Back Face
        1.0, 0.0,  0.0, 0.0,  0.0, 1.0,  1.0, 1.0,
        // Top Face
        0.0, 0.0,  1.0, 0.0,  1.0, 1.0,  0.0, 1.0,
        // Bottom Face
        0.0, 1.0,  1.0, 1.0,  1.0, 0.0,  0.0, 0.0,
        // Left Face
        0.0, 0.0,  0.0, 1.0,  1.0, 1.0,  1.0, 0.0,
        // Right Face
        1.0, 0.0,  1.0, 1.0,  0.0, 1.0,  0.0, 0.0
      ]);

      const solidIndices = new Uint16Array([
        0, 1, 2,  0, 2, 3,
        4, 5, 6,  4, 6, 7,
        8, 9, 10,  8, 10, 11,
        12, 13, 14,  12, 14, 15,
        16, 17, 18,  16, 18, 19
      ]);

      gl.uniform1i(this.locations.mode, isSolidMode ? 1 : 0);

      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, solidPositions, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.texCoord);
      gl.bufferData(gl.ARRAY_BUFFER, solidTexCoords, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, solidColors, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshBuffers.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, solidIndices, gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, 30, gl.UNSIGNED_SHORT, 0);

      if (edgeOpacity > 0) {
        const edgePositions = new Float32Array([
          -0.5, -0.5, 0,    0.5, -0.5, 0,
           0.5, -0.5, 0,    0.5,  0.5, 0,
           0.5,  0.5, 0,   -0.5,  0.5, 0,
          -0.5,  0.5, 0,   -0.5, -0.5, 0,
          -0.5, -0.5, -depth,    0.5, -0.5, -depth,
           0.5, -0.5, -depth,    0.5,  0.5, -depth,
           0.5,  0.5, -depth,   -0.5,  0.5, -depth,
          -0.5,  0.5, -depth,   -0.5, -0.5, -depth,
          -0.5, -0.5, 0,   -0.5, -0.5, -depth,
           0.5, -0.5, 0,    0.5, -0.5, -depth,
           0.5,  0.5, 0,    0.5,  0.5, -depth,
          -0.5,  0.5, 0,   -0.5,  0.5, -depth
        ]);

        const cEdge = hexToRgb(edgeColor);
        gl.uniform1i(this.locations.mode, 1);
        gl.disableVertexAttribArray(this.locations.color);
        gl.disableVertexAttribArray(this.locations.texCoord);
        gl.vertexAttrib4f(this.locations.color, cEdge.r / 255, cEdge.g / 255, cEdge.b / 255, edgeOpacity);
        gl.vertexAttrib2f(this.locations.texCoord, 0.0, 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, edgePositions, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.LINES, 0, 24);
      }

      // Restore standard 2D quad state for subsequent renders
      this._restoreMeshQuadState(gl);
    }

    _draw3DPyramidMesh(gl, mvp, pyramidFx, bounds, layerOpacity, layer = null) {
      const bScale = (bounds && bounds.bufferScale) ? bounds.bufferScale : 1;
      const defaultDepth = bounds && (bounds.w || bounds.h)
        ? Math.round(Math.min(bounds.w || (300 * bScale), bounds.h || (300 * bScale)))
        : (300 * bScale);
      const lDepth = (layer && layer.scaleZ !== undefined) ? (layer.scaleZ * bScale) : ((layer && layer.depth !== undefined) ? (layer.depth * bScale) : ((pyramidFx && pyramidFx.height !== undefined) ? (pyramidFx.height * bScale) : null));
      const height = Math.max(0, lDepth !== null ? lDepth : defaultDepth);
      const apexX = ((pyramidFx && pyramidFx.apexX !== undefined ? pyramidFx.apexX : 50) / 100 - 0.5);
      const apexY = ((pyramidFx && pyramidFx.apexY !== undefined ? pyramidFx.apexY : 25) / 100 - 0.5);

      const isSolidMode = pyramidFx && pyramidFx.sideMode === 'solid color';
      const defaultWhite = '#ffffff';
      let faceColor = (pyramidFx && pyramidFx.faceColor) || defaultWhite;
      if (isSolidMode && faceColor === defaultWhite && layer && (layer.fillColor || layer.color)) {
        faceColor = layer.fillColor || layer.color;
      }
      const rawFaceOp = (pyramidFx && pyramidFx.faceOpacity !== undefined) ? pyramidFx.faceOpacity : 100;
      const faceOpacity = Math.max(0, Math.min(1, rawFaceOp / 100)) * (layerOpacity !== undefined ? layerOpacity : 1.0);
      const edgeColor = (pyramidFx && pyramidFx.edgeColor) || '#ffffff';
      const edgeOpacity = Math.max(0, Math.min(1, (pyramidFx && pyramidFx.edgeOpacity !== undefined ? pyramidFx.edgeOpacity : (pyramidFx && pyramidFx.edgeWidth && pyramidFx.edgeWidth > 0 ? 70 : 0)) / 100));
      const shading = Math.max(0, Math.min(1, (pyramidFx && pyramidFx.shading !== undefined ? pyramidFx.shading : 0) / 100));

      gl.uniformMatrix4fv(this.locations.matrix, false, mvp);
      this._applyLightingUniforms(gl, layer, null, bounds, bounds && bounds.w, bounds && bounds.h);

      if (!this._pyramidPositions) this._pyramidPositions = new Float32Array(16 * 3);
      if (!this._pyramidNormals) this._pyramidNormals = new Float32Array(16 * 3);
      if (!this._pyramidColors) this._pyramidColors = new Float32Array(16 * 4);
      if (!this._pyramidEdgePos) this._pyramidEdgePos = new Float32Array(16 * 3);

      if (!this._pyramidPosBuffer) this._pyramidPosBuffer = gl.createBuffer();
      if (!this._pyramidNormBuffer) this._pyramidNormBuffer = gl.createBuffer();
      if (!this._pyramidColBuffer) this._pyramidColBuffer = gl.createBuffer();
      if (!this._pyramidUvBuffer) {
        this._pyramidUvBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._pyramidUvBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          0.0, 1.0, 1.0, 1.0, 0.5, 0.5,
          1.0, 1.0, 1.0, 0.0, 0.5, 0.5,
          1.0, 0.0, 0.0, 0.0, 0.5, 0.5,
          0.0, 0.0, 0.0, 1.0, 0.5, 0.5,
          0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0
        ]), gl.STATIC_DRAW);
      }
      if (!this._pyramidIdxBuffer) {
        this._pyramidIdxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._pyramidIdxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([
          0, 1, 2,
          3, 4, 5,
          6, 7, 8,
          9, 10, 11,
          12, 13, 14, 12, 14, 15
        ]), gl.STATIC_DRAW);
      }

      const positions = this._pyramidPositions;
      const pn = this._pyramidNormals;
      const geomKey = `${height.toFixed(2)}_${apexX.toFixed(4)}_${apexY.toFixed(4)}`;
      if (this._pyramidGeomKey !== geomKey) {
        this._pyramidGeomKey = geomKey;
        positions.set([
          -0.5,  0.5, 0,   0.5,  0.5, 0,  apexX, apexY, height,
           0.5,  0.5, 0,   0.5, -0.5, 0,  apexX, apexY, height,
           0.5, -0.5, 0,  -0.5, -0.5, 0,  apexX, apexY, height,
          -0.5, -0.5, 0,  -0.5,  0.5, 0,  apexX, apexY, height,
          -0.5, -0.5, 0,   0.5, -0.5, 0,  0.5, 0.5, 0,  -0.5, 0.5, 0
        ]);
        const l1 = Math.hypot(height, 0.5 - apexY) || 1;
        const n1y = height / l1, n1z = (0.5 - apexY) / l1;
        const l2 = Math.hypot(height, 0.5 - apexX) || 1;
        const n2x = height / l2, n2z = (0.5 - apexX) / l2;
        const l3 = Math.hypot(height, apexY + 0.5) || 1;
        const n3y = -height / l3, n3z = (apexY + 0.5) / l3;
        const l4 = Math.hypot(height, apexX + 0.5) || 1;
        const n4x = -height / l4, n4z = (apexX + 0.5) / l4;

        let pno = 0;
        pn[pno++] = 0;   pn[pno++] = n1y; pn[pno++] = n1z;
        pn[pno++] = 0;   pn[pno++] = n1y; pn[pno++] = n1z;
        pn[pno++] = 0;   pn[pno++] = n1y; pn[pno++] = n1z;
        pn[pno++] = n2x; pn[pno++] = 0;   pn[pno++] = n2z;
        pn[pno++] = n2x; pn[pno++] = 0;   pn[pno++] = n2z;
        pn[pno++] = n2x; pn[pno++] = 0;   pn[pno++] = n2z;
        pn[pno++] = 0;   pn[pno++] = n3y; pn[pno++] = n3z;
        pn[pno++] = 0;   pn[pno++] = n3y; pn[pno++] = n3z;
        pn[pno++] = 0;   pn[pno++] = n3y; pn[pno++] = n3z;
        pn[pno++] = n4x; pn[pno++] = 0;   pn[pno++] = n4z;
        pn[pno++] = n4x; pn[pno++] = 0;   pn[pno++] = n4z;
        pn[pno++] = n4x; pn[pno++] = 0;   pn[pno++] = n4z;
        pn[pno++] = 0;   pn[pno++] = 0;   pn[pno++] = -1;
        pn[pno++] = 0;   pn[pno++] = 0;   pn[pno++] = -1;
        pn[pno++] = 0;   pn[pno++] = 0;   pn[pno++] = -1;
        pn[pno++] = 0;   pn[pno++] = 0;   pn[pno++] = -1;

        gl.bindBuffer(gl.ARRAY_BUFFER, this._pyramidPosBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._pyramidNormBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, pn, gl.DYNAMIC_DRAW);
      }

      const cBase = hexToRgb(faceColor);
      const tintR = isSolidMode ? (cBase.r / 255) : 1.0;
      const tintG = isSolidMode ? (cBase.g / 255) : 1.0;
      const tintB = isSolidMode ? (cBase.b / 255) : 1.0;

      this._setSolidCullFace(gl, isSolidMode && faceOpacity >= 0.999, bounds);
      gl.uniform1i(this.locations.mode, isSolidMode ? 1 : 0);

      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._pyramidPosBuffer);
      gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

      if (this.locations.normal !== -1 && this.locations.normal !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this._pyramidNormBuffer);
        gl.enableVertexAttribArray(this.locations.normal);
        gl.vertexAttribPointer(this.locations.normal, 3, gl.FLOAT, false, 0, 0);
      }

      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._pyramidUvBuffer);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      if (shading <= 0.001) {
        gl.disableVertexAttribArray(this.locations.color);
        const sSlot = (layer && Array.isArray(layer.materialSlots) && layer.materialSlots[0]) ? layer.materialSlots[0] : null;
        if (sSlot && sSlot.surfaceMode && sSlot.surfaceMode !== 'inherit') {
          this.applyMaterialSlot(gl, layer, sSlot, null, faceOpacity, cBase, !isSolidMode);
        } else {
          gl.vertexAttrib4f(this.locations.color, tintR, tintG, tintB, faceOpacity);
        }
      } else {
        const colKey = `${tintR.toFixed(3)}_${tintG.toFixed(3)}_${tintB.toFixed(3)}_${faceOpacity.toFixed(3)}_${shading.toFixed(3)}`;
        if (this._pyramidColKey !== colKey) {
          this._pyramidColKey = colKey;
          const colors = this._pyramidColors;
          const muls = [
            1.0 + shading * 0.2, 1.0 + shading * 0.2, 1.0 + shading * 0.2,
            Math.max(0.15, 1.0 - shading * 0.25), Math.max(0.15, 1.0 - shading * 0.25), Math.max(0.15, 1.0 - shading * 0.25),
            Math.max(0.1, 1.0 - shading * 0.45), Math.max(0.1, 1.0 - shading * 0.45), Math.max(0.1, 1.0 - shading * 0.45),
            Math.max(0.15, 1.0 - shading * 0.35), Math.max(0.15, 1.0 - shading * 0.35), Math.max(0.15, 1.0 - shading * 0.35),
            Math.max(0.1, 1.0 - shading * 0.5), Math.max(0.1, 1.0 - shading * 0.5), Math.max(0.1, 1.0 - shading * 0.5), Math.max(0.1, 1.0 - shading * 0.5)
          ];
          for (let i = 0; i < 16; i++) {
            const m = muls[i];
            const ci = i * 4;
            colors[ci] = Math.min(1.0, tintR * m);
            colors[ci + 1] = Math.min(1.0, tintG * m);
            colors[ci + 2] = Math.min(1.0, tintB * m);
            colors[ci + 3] = faceOpacity;
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, this._pyramidColBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
        }
        gl.enableVertexAttribArray(this.locations.color);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._pyramidColBuffer);
        gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, 0, 0);
      }

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._pyramidIdxBuffer);
      const pSlots = (layer && Array.isArray(layer.materialSlots) && layer.materialSlots.length > 0) ? layer.materialSlots : null;
      if (pSlots && pSlots.length >= 2 && shading <= 0.001) {
        this.applyMaterialSlot(gl, layer, pSlots[0], null, faceOpacity, cBase, !isSolidMode);
        gl.drawElements(gl.TRIANGLES, 12, gl.UNSIGNED_SHORT, 0);
        this.applyMaterialSlot(gl, layer, pSlots[1], null, faceOpacity, cBase, !isSolidMode);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 12 * 2);
      } else {
        if (pSlots && pSlots[0] && shading <= 0.001) {
          this.applyMaterialSlot(gl, layer, pSlots[0], null, faceOpacity, cBase, !isSolidMode);
        }
        gl.drawElements(gl.TRIANGLES, 18, gl.UNSIGNED_SHORT, 0);
      }
      this._setSolidCullFace(gl, false, null);

      if (edgeOpacity > 0.01) {
        this._pyramidEdgePos.set([
          -0.5, -0.5, 0,  0.5, -0.5, 0,
           0.5, -0.5, 0,  0.5,  0.5, 0,
           0.5,  0.5, 0, -0.5,  0.5, 0,
          -0.5,  0.5, 0, -0.5, -0.5, 0,
          -0.5, -0.5, 0,  apexX, apexY, height,
           0.5, -0.5, 0,  apexX, apexY, height,
           0.5,  0.5, 0,  apexX, apexY, height,
          -0.5,  0.5, 0,  apexX, apexY, height
        ]);

        const cEdge = hexToRgb(edgeColor);
        gl.uniform1i(this.locations.mode, 1);
        gl.disableVertexAttribArray(this.locations.color);
        gl.disableVertexAttribArray(this.locations.texCoord);
        if (this.locations.normal !== -1 && this.locations.normal !== undefined) {
          gl.disableVertexAttribArray(this.locations.normal);
        }
        gl.vertexAttrib4f(this.locations.color, cEdge.r / 255, cEdge.g / 255, cEdge.b / 255, edgeOpacity);
        gl.vertexAttrib2f(this.locations.texCoord, 0.0, 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, this._pyramidEdgePos, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.LINES, 0, 16);
      }

      // Restore standard 2D quad state for subsequent renders
      this._restoreMeshQuadState(gl);
    }

    _draw3DSphereMesh(gl, mvp, sphereFx, bounds, layerOpacity, layer = null) {
      const bScale = (bounds && bounds.bufferScale) ? bounds.bufferScale : 1;
      const defaultDepth = bounds && (bounds.w || bounds.h)
        ? Math.round(Math.min(bounds.w || (300 * bScale), bounds.h || (300 * bScale))) * 0.5
        : (150 * bScale);
      const lDepth = (layer && layer.scaleZ !== undefined) ? (layer.scaleZ * bScale) : ((layer && layer.depth !== undefined) ? (layer.depth * bScale) : null);
      const depthZ = Math.max(0.1, lDepth !== null ? lDepth : defaultDepth);

      const isSolidMode = sphereFx && (sphereFx.sideMode === 'solid color' || sphereFx.fillMode === 'solid color');
      const defaultWhite = '#ffffff';
      let faceColor = (sphereFx && (sphereFx.faceColor || sphereFx.color)) || defaultWhite;
      if (isSolidMode && faceColor === defaultWhite && layer && (layer.fillColor || layer.color)) {
        faceColor = layer.fillColor || layer.color;
      }
      const rawFaceOp = (sphereFx && sphereFx.faceOpacity !== undefined) ? sphereFx.faceOpacity : 100;
      const faceOpacity = Math.max(0, Math.min(1, rawFaceOp / 100)) * (layerOpacity !== undefined ? layerOpacity : 1.0);
      const shading = Math.max(0, Math.min(1, (sphereFx && sphereFx.shading !== undefined ? sphereFx.shading : (sphereFx && sphereFx.shadowOpacity !== undefined && sphereFx.shadowOpacity > 0 ? sphereFx.shadowOpacity : 0)) / 100));
      const edgeColor = (sphereFx && sphereFx.edgeColor) || '#ffffff';
      const edgeOpacity = Math.max(0, Math.min(1, (sphereFx && sphereFx.edgeOpacity !== undefined ? sphereFx.edgeOpacity : 0) / 100));

      this._scaleMatrixZ(this._meshScratchMvp, mvp, depthZ);
      gl.uniformMatrix4fv(this.locations.matrix, false, this._meshScratchMvp);
      this._applyLightingUniforms(gl, layer, null, bounds, bounds && bounds.w, bounds && bounds.h);
      if (this._currentModelMatrix && this.locations.modelMatrix) {
        this._scaleMatrixZ(this._meshScratchModel, this._currentModelMatrix, depthZ);
        gl.uniformMatrix4fv(this.locations.modelMatrix, false, this._meshScratchModel);
      }

      if (!this._sphereMeshBase) {
        const rings = 16;
        const sectors = 24;
        const basePos = [];
        const normals = [];
        const texCoords = [];
        const indices = [];

        for (let r = 0; r <= rings; r++) {
          const v = r / rings;
          const phi = v * Math.PI;
          for (let s = 0; s <= sectors; s++) {
            const u = s / sectors;
            const theta = u * Math.PI * 2;
            const x = -0.5 * Math.sin(phi) * Math.cos(theta);
            const y = -0.5 * Math.cos(phi);
            const zNorm = Math.sin(phi) * Math.sin(theta);
            basePos.push(x, y, zNorm);
            texCoords.push(u, v);
            normals.push(-Math.sin(phi) * Math.cos(theta), -Math.cos(phi), Math.sin(phi) * Math.sin(theta));
          }
        }

        for (let r = 0; r < rings; r++) {
          for (let s = 0; s < sectors; s++) {
            const first = r * (sectors + 1) + s;
            const second = first + sectors + 1;
            indices.push(first, second, first + 1);
            indices.push(second, second + 1, first + 1);
          }
        }

        this._sphereMeshBase = {
          basePos: new Float32Array(basePos),
          normals: new Float32Array(normals),
          texCoords: new Float32Array(texCoords),
          indices: new Uint16Array(indices),
          count: indices.length,
          vertexCount: (rings + 1) * (sectors + 1)
        };
      }

      const base = this._sphereMeshBase;
      const vCount = base.vertexCount;

      if (!this._spherePosBuffer) {
        this._spherePosBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._spherePosBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, base.basePos, gl.STATIC_DRAW);
      }
      if (!this._sphereNormBuffer) {
        this._sphereNormBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._sphereNormBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, base.normals, gl.STATIC_DRAW);
      }
      if (!this._sphereUvBuffer) {
        this._sphereUvBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._sphereUvBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, base.texCoords, gl.STATIC_DRAW);
      }
      if (!this._sphereIdxBuffer) {
        this._sphereIdxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._sphereIdxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, base.indices, gl.STATIC_DRAW);
      }
      if (this.isWebGL2 && !this._sphereVao && typeof gl.createVertexArray === 'function') {
        this._sphereVao = gl.createVertexArray();
        gl.bindVertexArray(this._sphereVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._spherePosBuffer);
        gl.enableVertexAttribArray(this.locations.position);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
        if (this.locations.normal !== -1 && this.locations.normal !== undefined) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this._sphereNormBuffer);
          gl.enableVertexAttribArray(this.locations.normal);
          gl.vertexAttribPointer(this.locations.normal, 3, gl.FLOAT, false, 0, 0);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this._sphereUvBuffer);
        gl.enableVertexAttribArray(this.locations.texCoord);
        gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
        if (this.locations.color !== -1 && this.locations.color !== undefined) {
          gl.disableVertexAttribArray(this.locations.color);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._sphereIdxBuffer);
        gl.bindVertexArray(null);
      }

      const cBase = hexToRgb(faceColor);
      const tintR = isSolidMode ? (cBase.r / 255) : 1.0;
      const tintG = isSolidMode ? (cBase.g / 255) : 1.0;
      const tintB = isSolidMode ? (cBase.b / 255) : 1.0;

      this._setSolidCullFace(gl, isSolidMode && faceOpacity >= 0.999, bounds);
      gl.uniform1i(this.locations.mode, isSolidMode ? 1 : 0);

      if (shading <= 0.001) {
        gl.disableVertexAttribArray(this.locations.color);
        const sSlot = (layer && Array.isArray(layer.materialSlots) && layer.materialSlots[0]) ? layer.materialSlots[0] : null;
        if (sSlot && sSlot.surfaceMode && sSlot.surfaceMode !== 'inherit') {
          this.applyMaterialSlot(gl, layer, sSlot, null, faceOpacity, cBase, !isSolidMode);
        } else {
          gl.vertexAttrib4f(this.locations.color, tintR, tintG, tintB, faceOpacity);
        }
        if (this._sphereVao && typeof gl.bindVertexArray === 'function') {
          gl.bindVertexArray(this._sphereVao);
          gl.drawElements(gl.TRIANGLES, base.count, gl.UNSIGNED_SHORT, 0);
          gl.bindVertexArray(null);
        } else {
          gl.enableVertexAttribArray(this.locations.position);
          gl.bindBuffer(gl.ARRAY_BUFFER, this._spherePosBuffer);
          gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
          if (this.locations.normal !== -1 && this.locations.normal !== undefined) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this._sphereNormBuffer);
            gl.enableVertexAttribArray(this.locations.normal);
            gl.vertexAttribPointer(this.locations.normal, 3, gl.FLOAT, false, 0, 0);
          }
          gl.enableVertexAttribArray(this.locations.texCoord);
          gl.bindBuffer(gl.ARRAY_BUFFER, this._sphereUvBuffer);
          gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._sphereIdxBuffer);
          gl.drawElements(gl.TRIANGLES, base.count, gl.UNSIGNED_SHORT, 0);
        }
      } else {
        if (!this._sphereScratchColors) this._sphereScratchColors = new Float32Array(vCount * 4);
        if (!this._sphereColBuffer) this._sphereColBuffer = gl.createBuffer();
        const colKey = `${tintR.toFixed(3)}_${tintG.toFixed(3)}_${tintB.toFixed(3)}_${faceOpacity.toFixed(3)}_${shading.toFixed(3)}`;
        if (this._sphereColKey !== colKey) {
          this._sphereColKey = colKey;
          const colors = this._sphereScratchColors;
          for (let i = 0; i < vCount; i++) {
            const cIdx = i * 4;
            const nz = Math.max(0, base.basePos[i * 3 + 2]);
            const shadeFactor = Math.max(0.15, 1.0 - (1.0 - nz) * shading * 0.7);
            colors[cIdx] = Math.min(1.0, tintR * shadeFactor);
            colors[cIdx + 1] = Math.min(1.0, tintG * shadeFactor);
            colors[cIdx + 2] = Math.min(1.0, tintB * shadeFactor);
            colors[cIdx + 3] = faceOpacity;
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, this._sphereColBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
        }

        gl.enableVertexAttribArray(this.locations.position);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._spherePosBuffer);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
        if (this.locations.normal !== -1 && this.locations.normal !== undefined) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this._sphereNormBuffer);
          gl.enableVertexAttribArray(this.locations.normal);
          gl.vertexAttribPointer(this.locations.normal, 3, gl.FLOAT, false, 0, 0);
        }
        gl.enableVertexAttribArray(this.locations.texCoord);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._sphereUvBuffer);
        gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.locations.color);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._sphereColBuffer);
        gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._sphereIdxBuffer);
        gl.drawElements(gl.TRIANGLES, base.count, gl.UNSIGNED_SHORT, 0);
      }

      this._setSolidCullFace(gl, false, null);

      if (edgeOpacity > 0.01) {
        const cEdge = hexToRgb(edgeColor);
        gl.uniform1i(this.locations.mode, 1);
        gl.disableVertexAttribArray(this.locations.color);
        gl.disableVertexAttribArray(this.locations.texCoord);
        if (this.locations.normal !== -1 && this.locations.normal !== undefined) {
          gl.disableVertexAttribArray(this.locations.normal);
        }
        gl.vertexAttrib4f(this.locations.color, cEdge.r / 255, cEdge.g / 255, cEdge.b / 255, edgeOpacity);
        gl.vertexAttrib2f(this.locations.texCoord, 0.0, 0.0);

        const ringSegments = 32;
        if (!this._sphereEdgeScratch) this._sphereEdgeScratch = new Float32Array(ringSegments * 4 * 3);
        const edgePosArr = this._sphereEdgeScratch;
        let ei = 0;
        for (let i = 0; i < ringSegments; i++) {
          const a1 = (i / ringSegments) * Math.PI * 2;
          const a2 = ((i + 1) / ringSegments) * Math.PI * 2;
          edgePosArr[ei++] = 0.5 * Math.cos(a1); edgePosArr[ei++] = 0.5 * Math.sin(a1); edgePosArr[ei++] = 0;
          edgePosArr[ei++] = 0.5 * Math.cos(a2); edgePosArr[ei++] = 0.5 * Math.sin(a2); edgePosArr[ei++] = 0;
          edgePosArr[ei++] = 0.5 * Math.cos(a1); edgePosArr[ei++] = 0; edgePosArr[ei++] = Math.sin(a1);
          edgePosArr[ei++] = 0.5 * Math.cos(a2); edgePosArr[ei++] = 0; edgePosArr[ei++] = Math.sin(a2);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, edgePosArr, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, ringSegments * 4);
      }

      // Restore standard 2D quad state for subsequent renders
      this._restoreMeshQuadState(gl);
    }

    _blitGLToContext(ctx, layer, bounds, vw, vh, bufferScale, cropRect = null) {
      try {
        ctx.save();
        if (layer.blendMode && layer.blendMode !== 'normal') {
          ctx.globalCompositeOperation = (layer.blendMode === 'mask') ? 'destination-in' : (layer.blendMode === 'exclude') ? 'destination-out' : layer.blendMode;
        }
        if (window.FishEffects && typeof window.FishEffects.applyToContext === 'function') {
          window.FishEffects.applyToContext(ctx, layer);
        }
        if (layer._dofBlur && layer._dofBlur > 0.5) {
          const curF = ctx.filter && ctx.filter !== 'none' ? ctx.filter : '';
          ctx.filter = (curF ? (curF + ' ') : '') + `blur(${layer._dofBlur.toFixed(1)}px)`;
        }
        const rgbSplitFx = Array.isArray(layer.effects)
          ? layer.effects.find(f => f.type === 'rgb-split' && !f.disabled && ((f.distance !== undefined ? f.distance : 8) > 0))
          : null;

        const dsFx = Array.isArray(layer.effects)
          ? layer.effects.find(f => f && !f.disabled && f.type === 'drop-shadow')
          : null;

        const hasCrop = !!(cropRect && cropRect.w > 0 && cropRect.h > 0 && (cropRect.w < vw || cropRect.h < vh));
        const sx = hasCrop ? Math.max(0, Math.floor(cropRect.x)) : 0;
        const sy = hasCrop ? Math.max(0, Math.floor(cropRect.y)) : 0;
        const sw = hasCrop ? Math.min(vw - sx, Math.ceil(cropRect.w)) : vw;
        const sh = hasCrop ? Math.min(vh - sy, Math.ceil(cropRect.h)) : vh;

        if (dsFx) {
          const op = Math.max(0, Math.min(1, (dsFx.opacity !== undefined ? dsFx.opacity : 75) / 100));
          const angle = ((dsFx.angle !== undefined ? dsFx.angle : 135) * Math.PI) / 180;
          const dist = (dsFx.distance !== undefined ? dsFx.distance : 15) * bufferScale;
          const blur = Math.max(0, (dsFx.blur !== undefined ? dsFx.blur : 10) * bufferScale);
          const ox = Math.cos(angle) * dist;
          const oy = Math.sin(angle) * dist;
          const color = dsFx.color || '#000000';

          if (op > 0 && (blur > 0 || dist > 0)) {
            ctx.save();
            ctx.shadowColor = hexToRgba(color, op);
            ctx.shadowBlur = blur;
            ctx.shadowOffsetX = ox;
            ctx.shadowOffsetY = oy;
            if (rgbSplitFx) {
              const offX = vw + blur * 2 + Math.abs(ox);
              ctx.shadowOffsetX = ox + offX;
              ctx.drawImage(this.glCanvas, sx, sy, sw, sh, sx - offX, sy, sw, sh);
            } else {
              ctx.drawImage(this.glCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
            }
            ctx.restore();
          } else if (!rgbSplitFx) {
            ctx.drawImage(this.glCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
          }
        } else if (!rgbSplitFx) {
          ctx.drawImage(this.glCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
        }

        if (rgbSplitFx && window.FishEffects && typeof window.FishEffects.renderRGBSplit === 'function') {
          if (!this._copyCanvas) {
            this._copyCanvas = document.createElement('canvas');
            this._copyCtx = this._copyCanvas.getContext('2d');
          }
          if (this._copyCanvas.width !== vw || this._copyCanvas.height !== vh) {
            this._copyCanvas.width = vw;
            this._copyCanvas.height = vh;
          }
          this._copyCtx.clearRect(0, 0, vw, vh);
          this._copyCtx.drawImage(this.glCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
          window.FishEffects.renderRGBSplit(ctx, this._copyCanvas, layer, { x: sx, y: sy, w: sw, h: sh }, rgbSplitFx);
        }

        if (window.FishEffects && typeof window.FishEffects.applyPostEffects === 'function') {
          window.FishEffects.applyPostEffects(ctx, this.glCanvas, layer, { x: sx, y: sy, w: sw, h: sh, bufferScale: (bounds && bounds.bufferScale) || bufferScale || 1, unitScale: (bounds && bounds.bufferScale) || bufferScale || 1 });
        }
        ctx.restore();
      } catch (_) {}
    }

    /**
     * Hardware WebGL Motion Blur for 3D Layers
     * Accumulates multi-sample motion blur directly in WebGL framebuffer via running
     * mean (sample i blends at 1/(i+1) over the previous mean), then 1 single blit!
     * Running mean keeps the buffer near full brightness: the old ONE,ONE additive
     * sum with per-sample opacity 1/N quantized each sample to a few LSBs of the
     * 8-bit framebuffer, whose rounding error shifted hues on trails.
     */
    render3DMotionBlur(ctx, el, layer, bufferScale = 1, camera = null, currentSec = null, compState = null) {
      if (!ctx || !el || !this._hasValidDimensions(el)) return;
      const w = (typeof window !== 'undefined') ? window : {};
      const isExport = !!(w._isExportingVideo === true || w._isExportingSequence === true || w.isExporting === true);
      if (!this.isReady || (w.isTransformInteracting && !isExport)) {
        this.renderLayer(ctx, el, layer, bufferScale, camera, currentSec);
        return;
      }

      const pool = (compState && Array.isArray(compState.layers) && compState.layers)
        || ((typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) ? window.currentProjectState.layers : null);
      const evalSec = (typeof currentSec === 'number' && !isNaN(currentSec))
        ? currentSec
        : ((layer && typeof layer._currentSec === 'number') ? layer._currentSec : 0);
      const curEff = (typeof window.getLayerEffectivePropsAtTime === 'function')
        ? window.getLayerEffectivePropsAtTime(layer, evalSec, null, pool)
        : null;
      const animLayer = curEff ? Object.assign({}, layer, curEff) : layer;
      animLayer._currentSec = evalSec;

      const targetCanvas = ctx.canvas;
      const vp = this._getProjectViewport(bufferScale, layer);
      const vw = targetCanvas ? targetCanvas.width : vp.vw;
      const vh = targetCanvas ? targetCanvas.height : vp.vh;

      const bounds = this.getBounds(animLayer, bufferScale, camera, vw, vh);
      if (bounds.isBehindCamera || ((bounds.aabbW < 1.0 && bounds.w < 1.0) || (bounds.aabbH < 1.0 && bounds.h < 1.0))) {
        return;
      }

      const mbEngine = window.FishMotionBlurEngine;
      const shutter = mbEngine && typeof mbEngine.getShutter === 'function'
        ? mbEngine.getShutter(compState, evalSec)
        : {
            exposureTime: (180 / 360) * (1 / ((typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60)),
            tStart: evalSec
          };
      const exposureTime = shutter.exposureTime;
      const tStart = shutter.tStart;

      const plan = mbEngine && typeof mbEngine.planSamples === 'function'
        ? mbEngine.planSamples(animLayer, bufferScale, camera, tStart, exposureTime, compState)
        : { n: 16 };
      const cfgSamples = (mbEngine && typeof mbEngine.getConfig === 'function') ? mbEngine.getConfig(compState).samples : 16;
      const samples = Math.max(2, plan.n || cfgSamples || 16);

      if (plan.n <= 1) {
        this.renderLayer(ctx, el, layer, bufferScale, camera, currentSec);
        return;
      }

      // Pre-process 2D effects onto local offscreen canvas if needed
      const processed = this._getEffectProcessedElement(el, animLayer, bounds, evalSec);
      const sourceEl = processed.el;

      const gl = this.gl;
      if (this.glCanvas.width !== vw || this.glCanvas.height !== vh) {
        this.glCanvas.width = vw;
        this.glCanvas.height = vh;
      }

      // Dynamic Bounding Box & Scissor Clamping: restrict rendering & clearing to moving layer AABB
      const cropRect = plan && plan.rect;
      const hasCrop = false; // Disabled: cropRect is in composition space but used in screen space, causing offsets
      const cropX = 0;
      const cropY = 0;
      const cropW = vw;
      const cropH = vh;

      gl.viewport(0, 0, vw, vh);
      if (hasCrop) {
        const glScissorY = Math.max(0, vh - (cropY + cropH));
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(cropX, glScissorY, cropW, cropH);
      } else {
        gl.disable(gl.SCISSOR_TEST);
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(this.program);
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);

      // Bind quad buffers
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.enableVertexAttribArray(this.locations.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);

      // Upload/Bind texture ONCE for all samples
      const tex = this._getOrCreateTexture(sourceEl);
      if (!tex) {
        if (hasCrop) gl.disable(gl.SCISSOR_TEST);
        return;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.locations.texture, 0);
      if (this.locations.lensDistort) gl.uniform1f(this.locations.lensDistort, this._getLensDistort(bounds.is3D ? camera : null));

      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      // Running mean: sample 0 copies at full strength (ONE, ZERO); sample i blends
      // at w = 1/(i+1) via (CONSTANT_ALPHA, ONE_MINUS_CONSTANT_ALPHA) with the
      // shader emitting the sample at FULL layer opacity. out = S*w + D*(1-w).
      // Depth test stays ON with a per-sample depth clear: mesh faces self-occlude
      // correctly inside every sample while samples still average independently.
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      // u_noDiscard=1 during the loop: transparent texels emit (0,0,0,0) instead of
      // discard, so empty samples dilute the mean and trails stay symmetric.
      if (this.locations.noDiscard) gl.uniform1f(this.locations.noDiscard, 1);

      const tileFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f.type === 'tile' && !f.disabled)
        : null;

      const boxFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'box_3d' || f.type === '3d_box'))
        : null) || (layer.shapeType === '3d_box' ? { type: '3d_box' } : null);
      const extrudeFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && f.type === 'extrude_3d')
        : null;
      const pyramidFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'pyramid_3d' || f.type === '3d_pyramid'))
        : null) || (layer.shapeType === '3d_pyramid' || layer.shapeType === '3d_triangle' ? { type: '3d_pyramid', sideMode: 'solid color' } : null);
      const sphereFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'sphere_3d' || f.type === '3d_sphere'))
        : null) || (layer.shapeType === '3d_sphere' ? { type: '3d_sphere', sideMode: 'solid color' } : null);
      const coneFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'cone_3d' || f.type === '3d_cone'))
        : null) || (layer.shapeType === '3d_cone' ? { type: '3d_cone', sideMode: 'solid color' } : null);
      const cylinderFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'cylinder_3d' || f.type === '3d_cylinder'))
        : null) || (layer.shapeType === '3d_cylinder' ? { type: '3d_cylinder', sideMode: 'solid color' } : null);
      const torusFx = (Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && (f.type === 'torus_3d' || f.type === '3d_torus'))
        : null) || (layer.shapeType === '3d_torus' ? { type: '3d_torus', sideMode: 'solid color' } : null);
      const modelFx = (layer.shapeType === '3d_model' && layer.modelMediaId) ? { type: '3d_model' } : null;

      const camLayer = (camera && camera._rawCamera)
        || (camera && camera.type === 'camera' ? camera : null)
        || (pool && pool.find(l => l && l.type === 'camera' && !l.hidden))
        || null;

      const is3DMesh = !!(boxFx || extrudeFx || pyramidFx || sphereFx || coneFx || cylinderFx || torusFx || modelFx);
      const psMb = (typeof window !== 'undefined' && window.currentProjectState) ? window.currentProjectState : null;
      const aoModeMb = (psMb && psMb.threeDEngine === 'advance' && (psMb.ambientOcclusion === 'low' || psMb.ambientOcclusion === 'medium' || psMb.ambientOcclusion === 'high'))
        ? psMb.ambientOcclusion
        : 'disabled';
      const useAOMb = Boolean(is3DMesh && aoModeMb !== 'disabled' && this.isWebGL2 && this._ensureAOGl(vw, vh));
      const aoStrideMb = Math.max(1, Math.ceil(samples / 4));
      const useMeshFbo = is3DMesh && (useAOMb || this._ensureSceneBlurGL(vw, vh));

      const prevActiveCam = this._activeCamera;
      const prevActiveVw = this._activeVw;
      const prevActiveVh = this._activeVh;
      this._activeVw = vw;
      this._activeVh = vh;

      let drawnSamples = 0;
      for (let s = 0; s < samples; s++) {
        const u = (s + 0.5) / samples;
        const subSec = tStart + u * exposureTime;

        const subCamera = (camLayer && typeof window.getLayerEffectivePropsAtTime === 'function')
          ? window.getLayerEffectivePropsAtTime(camLayer, subSec, null, pool)
          : camera;
        this._activeCamera = subCamera;

        const srcLayer = layer._rawLayer || layer;
        const subEff = (typeof window.getLayerEffectivePropsAtTime === 'function')
          ? window.getLayerEffectivePropsAtTime(srcLayer, subSec, null, pool)
          : null;
        let subAnimLayer = subEff
          ? Object.assign({}, layer, subEff, { is3D: !!(srcLayer.is3D || bounds.is3D) })
          : Object.assign({}, animLayer, { is3D: !!(srcLayer.is3D || bounds.is3D) });
        subAnimLayer._currentSec = subSec;
        if (subAnimLayer.type === 'text' && window.FishMotionBlurEngine && typeof window.FishMotionBlurEngine.compensateTextPad === 'function') {
          subAnimLayer = window.FishMotionBlurEngine.compensateTextPad(layer, sourceEl, subAnimLayer);
        }

        const subBounds = this.getBounds(subAnimLayer, bufferScale, subCamera, vw, vh);
        if (subBounds.isBehindCamera) continue;

        // The scene camera only transforms 3D layers. A 2D layer must keep identical placement with
        // blur on/off (effects like shatter/particles apply the camera inside their own texture).
        const mvpCamera = (subBounds.is3D || bounds.is3D) ? subCamera : null;
        let mvp = this._computeMVP(subBounds, vw, vh, 0, mvpCamera);
        if (!mvp) continue;

        if (processed.padX > 0 || processed.padY > 0) {
          const sX = (processed.origW + processed.padX * 2) / processed.origW;
          const sY = (processed.origH + processed.padY * 2) / processed.origH;
          const scaledMVP = new Float32Array(mvp);
          scaledMVP[0] *= sX; scaledMVP[1] *= sX; scaledMVP[2] *= sX; scaledMVP[3] *= sX;
          scaledMVP[4] *= sY; scaledMVP[5] *= sY; scaledMVP[6] *= sY; scaledMVP[7] *= sY;
          mvp = scaledMVP;
        }

        const rawOp = (subAnimLayer.opacity !== undefined && subAnimLayer.opacity !== null) ? Number(subAnimLayer.opacity) : 1.0;
        const normOp = (rawOp > 1.0) ? Math.max(0, Math.min(1, rawOp / 100)) : Math.max(0, Math.min(1, rawOp));

        if (useMeshFbo) {
          // Render 3D mesh sample cleanly into offscreen FBO with normal opaque depth-testing
          // so overlapping triangles/material groups never self-blend with CONSTANT_ALPHA.
          gl.bindFramebuffer(gl.FRAMEBUFFER, useAOMb ? this._aoSceneFbo : this._sceneFbo);
          gl.viewport(0, 0, vw, vh);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(normOp >= 0.999);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.useProgram(this.program);
          if (this.locations.noDiscard) gl.uniform1f(this.locations.noDiscard, 0);
          if (this.locations.lensDistort) gl.uniform1f(this.locations.lensDistort, this._getLensDistort(mvpCamera));
          gl.uniform1f(this.locations.opacity, normOp);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(this.locations.texture, 0);

          if (modelFx) this._draw3DModelMesh(gl, mvp, subBounds, normOp, subAnimLayer, sourceEl);
          else if (boxFx) this._draw3DBoxMesh(gl, mvp, boxFx, subBounds, normOp, subAnimLayer);
          else if (extrudeFx) this._draw3DExtrudeMesh(gl, mvp, extrudeFx, subBounds, normOp, subAnimLayer, sourceEl);
          else if (pyramidFx) this._draw3DPyramidMesh(gl, mvp, pyramidFx, subBounds, normOp, subAnimLayer);
          else if (sphereFx) this._draw3DSphereMesh(gl, mvp, sphereFx, subBounds, normOp, subAnimLayer);
          else if (coneFx) this._draw3DConeMesh(gl, mvp, coneFx, subBounds, normOp, subAnimLayer, sourceEl);
          else if (cylinderFx) this._draw3DCylinderMesh(gl, mvp, cylinderFx, subBounds, normOp, subAnimLayer, sourceEl);
          else if (torusFx) this._draw3DTorusMesh(gl, mvp, torusFx, subBounds, normOp, subAnimLayer, sourceEl);

          // Blend finished 3D sample (with SSAO when enabled) into default framebuffer accumulation buffer
          gl.depthMask(true);
          if (useAOMb) {
            const blendW = (drawnSamples === 0) ? 1.0 : (1 / (drawnSamples + 1));
            this._runAOPostPass(gl, vw, vh, bufferScale, subCamera, aoModeMb, blendW, (drawnSamples % aoStrideMb) !== 0);
          } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, vw, vh);
            gl.disable(gl.DEPTH_TEST);
            gl.useProgram(this._sceneBlitProg);
            gl.bindBuffer(gl.ARRAY_BUFFER, this._sceneBlitQuad);
            gl.enableVertexAttribArray(this._sceneBlitPosLoc);
            gl.vertexAttribPointer(this._sceneBlitPosLoc, 2, gl.FLOAT, false, 0, 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this._sceneFboTex);
            gl.uniform1i(this._sceneBlitTexLoc, 0);
            if (drawnSamples === 0) {
              gl.blendFunc(gl.ONE, gl.ZERO);
            } else {
              gl.blendColor(0, 0, 0, 1 / (drawnSamples + 1));
              gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
            }
            gl.drawArrays(gl.TRIANGLES, 0, 6);
          }
          drawnSamples++;
          continue;
        }

        // Fresh depth for every sample: self-occlusion inside the sample,
        // no occlusion leaking across samples of the blur average.
        gl.clear(gl.DEPTH_BUFFER_BIT);
        if (this.locations.lensDistort) gl.uniform1f(this.locations.lensDistort, this._getLensDistort(mvpCamera));

        gl.depthMask(normOp >= 0.999);
        if (drawnSamples === 0) {
          gl.blendFunc(gl.ONE, gl.ZERO);
          gl.uniform1f(this.locations.opacity, normOp);
        } else {
          const w = 1 / (drawnSamples + 1);
          gl.blendColor(0, 0, 0, w);
          gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
          gl.uniform1f(this.locations.opacity, normOp);
        }

        if (is3DMesh) {
          if (modelFx) this._draw3DModelMesh(gl, mvp, subBounds, normOp, subAnimLayer, sourceEl);
          else if (boxFx) this._draw3DBoxMesh(gl, mvp, boxFx, subBounds, normOp, subAnimLayer);
          else if (extrudeFx) this._draw3DExtrudeMesh(gl, mvp, extrudeFx, subBounds, normOp, subAnimLayer, sourceEl);
          else if (pyramidFx) this._draw3DPyramidMesh(gl, mvp, pyramidFx, subBounds, normOp, subAnimLayer);
          else if (sphereFx) this._draw3DSphereMesh(gl, mvp, sphereFx, subBounds, normOp, subAnimLayer);
          else if (coneFx) this._draw3DConeMesh(gl, mvp, coneFx, subBounds, normOp, subAnimLayer, sourceEl);
          else if (cylinderFx) this._draw3DCylinderMesh(gl, mvp, cylinderFx, subBounds, normOp, subAnimLayer, sourceEl);
          else if (torusFx) this._draw3DTorusMesh(gl, mvp, torusFx, subBounds, normOp, subAnimLayer, sourceEl);
        } else {
          this._drawQuadOrTile(gl, mvp, tileFx, vw, vh, subBounds);
        }
        drawnSamples++;
      }

      this._activeCamera = prevActiveCam;
      this._activeVw = prevActiveVw;
      this._activeVh = prevActiveVh;
      if (useMeshFbo) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(this.program);
        gl.depthMask(true);
      }

      // Restore normal premultiplied compositing for single-pass draws
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
      if (this.locations.noDiscard) gl.uniform1f(this.locations.noDiscard, 0);

      if (hasCrop) {
        gl.disable(gl.SCISSOR_TEST);
      }

      // Blit accumulated result to 2D canvas context ONCE with shadow / RGB split (clipped to cropRect)
      if (drawnSamples > 0) {
        this._blitGLToContext(ctx, animLayer, bounds, vw, vh, bufferScale, hasCrop ? { x: cropX, y: cropY, w: cropW, h: cropH } : null);
        // Deep Glow rasa adjustment: blur 2D dari snapshot proyeksi, spill full
        this._applyDeepGlowScreenSpace(ctx, animLayer, bounds, evalSec);
      }
    }

    /**
     * Per-sample FBO + passthrough blit program for shared-depth scene blur.
     * Each shutter sample renders into the FBO (normal blend + depth), then the
     * FBO is blended over the running mean in the default framebuffer.
     * WebGL1-core only (RGBA texture + depth renderbuffer). Returns false when
     * unavailable so callers can fall back to legacy per-layer passes.
     */
    _ensureSceneBlurGL(vw, vh) {
      const gl = this.gl;
      if (!gl || (this._sceneGLFailCount && this._sceneGLFailCount > 3)) return false;
      if (vw <= 0 || vh <= 0) return false;
      try {
        if (!this._sceneBlitProg) {
          const vs = this._compileShader(gl.VERTEX_SHADER,
            'attribute vec2 a_p; varying vec2 v_uv; void main(){ v_uv = a_p * 0.5 + 0.5; gl_Position = vec4(a_p, 0.0, 1.0); }');
          const fs = this._compileShader(gl.FRAGMENT_SHADER,
            'precision mediump float; varying vec2 v_uv; uniform sampler2D u_t; void main(){ gl_FragColor = texture2D(u_t, v_uv); }');
          const pr = gl.createProgram();
          gl.attachShader(pr, vs);
          gl.attachShader(pr, fs);
          gl.linkProgram(pr);
          if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
            this._sceneGLFailCount = (this._sceneGLFailCount || 0) + 1;
            return false;
          }
          this._sceneBlitProg = pr;
          this._sceneBlitPosLoc = gl.getAttribLocation(pr, 'a_p');
          this._sceneBlitTexLoc = gl.getUniformLocation(pr, 'u_t');
          this._sceneBlitQuad = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, this._sceneBlitQuad);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
          this._sceneFbo = gl.createFramebuffer();
          this._sceneFboTex = gl.createTexture();
          this._sceneFboDepth = gl.createRenderbuffer();
        }
        if (this._sceneFboW !== vw || this._sceneFboH !== vh) {
          gl.bindTexture(gl.TEXTURE_2D, this._sceneFboTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vw, vh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.bindRenderbuffer(gl.RENDERBUFFER, this._sceneFboDepth);
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, vw, vh);
          gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._sceneFboTex, 0);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this._sceneFboDepth);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          this._sceneFboW = vw;
          this._sceneFboH = vh;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (!ok) {
          this._sceneGLFailCount = (this._sceneGLFailCount || 0) + 1;
          return false;
        }
        this._sceneGLFailCount = 0;
        this._sceneGLFailed = false;
        return true;
      } catch (_) {
        this._sceneGLFailCount = (this._sceneGLFailCount || 0) + 1;
        return false;
      }
    }

    /**
     * Shared-depth 3D scene motion blur for one consecutive run of plain 3D layers.
     * Every shutter sample draws ALL run members into the FBO with normal blending
     * and a shared depth buffer (true 3D penetration, like the static batch pass),
     * then the sample is blended over the running mean. Static members naturally
     * average to themselves. Returns true when handled (even when nothing was
     * visible), false when the caller should use legacy per-layer passes.
     * run: Array<{ item:{el,layer,animLayer}, bounds, blur:boolean }>
     */
    render3DSceneMotionBlur(ctx, run, bufferScale = 1, camera = null, currentSec = null, compState = null) {
      if (!ctx || !run || run.length === 0 || !this.isReady) return false;
      const gl = this.gl;
      if (!gl) return false;
      const w = (typeof window !== 'undefined') ? window : {};
      const isExport = !!(w._isExportingVideo === true || w._isExportingSequence === true || w.isExporting === true);
      if (w.isTransformInteracting && !isExport) return false;

      const pool = (compState && Array.isArray(compState.layers) && compState.layers)
        || ((typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) ? window.currentProjectState.layers : null);
      const evalSec = (typeof currentSec === 'number' && !isNaN(currentSec)) ? currentSec : 0;

      const mbEngine = window.FishMotionBlurEngine;
      const shutter = mbEngine && typeof mbEngine.getShutter === 'function'
        ? mbEngine.getShutter(compState, evalSec)
        : { exposureTime: 0, tStart: evalSec };
      const exposureTime = shutter.exposureTime;
      const tStart = shutter.tStart;
      if (!(exposureTime > 0.0001)) return false;

      // Sample count: worst case over the moving members (static ones need none).
      let samples = 0;
      for (const m of run) {
        if (!m.blur) continue;
        const planeff = m.item.animLayer || m.item.layer;
        const n = (mbEngine && typeof mbEngine.planSamples === 'function')
          ? (mbEngine.planSamples(planeff, bufferScale, camera, tStart, exposureTime, compState).n || 0)
          : 0;
        if (n > samples) samples = n;
      }
      if (!(samples >= 2)) {
        return false;
      }

      const targetCanvas = ctx.canvas;
      const vp = this._getProjectViewport(bufferScale);
      const vw = targetCanvas ? targetCanvas.width : vp.vw;
      const vh = targetCanvas ? targetCanvas.height : vp.vh;
      if (vw <= 0 || vh <= 0) return false;
      if (this.glCanvas.width !== vw || this.glCanvas.height !== vh) {
        this.glCanvas.width = vw;
        this.glCanvas.height = vh;
      }
      if (!this._ensureSceneBlurGL(vw, vh)) return false;

      const camLayer = (camera && camera._rawCamera)
        || (camera && camera.type === 'camera' ? camera : null)
        || (pool && pool.find(l => l && l.type === 'camera' && !l.hidden))
        || null;
      const getEff = (typeof window !== 'undefined') ? window.getLayerEffectivePropsAtTime : null;

      // Accumulation buffer: default framebuffer, cleared once.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, vw, vh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      if (this.locations.noDiscard) {
        gl.useProgram(this.program);
        gl.uniform1f(this.locations.noDiscard, 0);
      }

      const prevSceneCam = this._activeCamera;
      const prevSceneVw = this._activeVw;
      const prevSceneVh = this._activeVh;
      this._activeVw = vw;
      this._activeVh = vh;

      const psSceneMb = (typeof window !== 'undefined' && window.currentProjectState) ? window.currentProjectState : null;
      const aoModeSceneMb = (psSceneMb && psSceneMb.threeDEngine === 'advance' && (psSceneMb.ambientOcclusion === 'low' || psSceneMb.ambientOcclusion === 'medium' || psSceneMb.ambientOcclusion === 'high'))
        ? psSceneMb.ambientOcclusion
        : 'disabled';
      const useAOSceneMb = Boolean(aoModeSceneMb !== 'disabled' && this.isWebGL2 && this._ensureAOGl(vw, vh));
      // Recompute SSAO at most ~4 times per motion-blur frame; intermediate samples reuse the AO texture.
      const aoStrideScene = Math.max(1, Math.ceil(samples / 4));

      let completed = 0;
      for (let s = 0; s < samples; s++) {
        const subSec = tStart + ((s + 0.5) / samples) * exposureTime;
        const subCamera = (camLayer && typeof getEff === 'function')
          ? getEff(camLayer, subSec, null, pool)
          : camera;
        this._activeCamera = subCamera;

        // One full scene sample into the FBO: normal blend + shared depth.
        gl.bindFramebuffer(gl.FRAMEBUFFER, useAOSceneMb ? this._aoSceneFbo : this._sceneFbo);
        gl.viewport(0, 0, vw, vh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.program);
        if (this.locations.noDiscard) gl.uniform1f(this.locations.noDiscard, 0);
        gl.uniform1i(this.locations.mode, 0);
        gl.disableVertexAttribArray(this.locations.color);
        gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(this.locations.position);
        gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.enableVertexAttribArray(this.locations.texCoord);
        gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);

        let drawn = 0;
        for (let mi = 0; mi < run.length; mi++) {
          const m = run[mi];
          const srcEl = m.item.el;
          if (!srcEl || !this._hasValidDimensions(srcEl)) continue;
          const srcLayer = (m.item.layer && m.item.layer._rawLayer) || m.item.layer;
          const subEff = (typeof getEff === 'function' && srcLayer)
            ? getEff(srcLayer, subSec, null, pool)
            : null;
          let subAnimLayer = Object.assign({}, m.item.animLayer || m.item.layer, subEff || {});
          subAnimLayer._currentSec = subSec;
          if (subAnimLayer.type === 'text' && window.FishMotionBlurEngine && typeof window.FishMotionBlurEngine.compensateTextPad === 'function') {
            subAnimLayer = window.FishMotionBlurEngine.compensateTextPad(m.item.layer, srcEl, subAnimLayer);
          }
          const subBounds = this.getBounds(subAnimLayer, bufferScale, subCamera, vw, vh);
          if (subBounds.isBehindCamera || ((subBounds.aabbW < 1.0 && subBounds.w < 1.0) || (subBounds.aabbH < 1.0 && subBounds.h < 1.0))) continue;
          const mvpCamera = subBounds.is3D ? subCamera : null;
          const mvp = this._computeMVP(subBounds, vw, vh, mi * 0.00002, mvpCamera);
          if (!mvp) continue;
          const tex = this._getOrCreateTexture(srcEl);
          if (!tex) continue;
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(this.locations.texture, 0);
          const rawOp = (subAnimLayer.opacity !== undefined && subAnimLayer.opacity !== null) ? Number(subAnimLayer.opacity) : 1.0;
          const normOp = (rawOp > 1.0) ? Math.max(0, Math.min(1, rawOp / 100)) : Math.max(0, Math.min(1, rawOp));
          gl.uniform1f(this.locations.opacity, normOp);
          gl.depthMask(normOp >= 0.999);
          if (this.locations.lensDistort) gl.uniform1f(this.locations.lensDistort, this._getLensDistort(mvpCamera));
          gl.uniformMatrix4fv(this.locations.matrix, false, mvp);

          const mfxSub = this._resolveMeshFx(subAnimLayer, this._meshFxScratch || (this._meshFxScratch = {}));
          const bFx = mfxSub.b, eFx = mfxSub.e, pFx = mfxSub.p, sFx = mfxSub.s;
          const cFx = mfxSub.c, cylFx = mfxSub.cyl, tFx = mfxSub.t, mFx = mfxSub.m;

          if (mFx) this._draw3DModelMesh(gl, mvp, subBounds, normOp, subAnimLayer, srcEl);
          else if (bFx) this._draw3DBoxMesh(gl, mvp, bFx, subBounds, normOp, subAnimLayer, srcEl);
          else if (eFx) this._draw3DExtrudeMesh(gl, mvp, eFx, subBounds, normOp, subAnimLayer, srcEl);
          else if (pFx) this._draw3DPyramidMesh(gl, mvp, pFx, subBounds, normOp, subAnimLayer);
          else if (sFx) this._draw3DSphereMesh(gl, mvp, sFx, subBounds, normOp, subAnimLayer);
          else if (cFx) this._draw3DConeMesh(gl, mvp, cFx, subBounds, normOp, subAnimLayer, srcEl);
          else if (cylFx) this._draw3DCylinderMesh(gl, mvp, cylFx, subBounds, normOp, subAnimLayer, srcEl);
          else if (tFx) this._draw3DTorusMesh(gl, mvp, tFx, subBounds, normOp, subAnimLayer, srcEl);
          else {
            gl.uniform1i(this.locations.mode, 0);
            gl.disableVertexAttribArray(this.locations.color);
            gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
            gl.enableVertexAttribArray(this.locations.position);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
            gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(this.locations.texCoord);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
            gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
            this._drawQuadOrTile(gl, mvp, null, vw, vh, subBounds);
          }
          drawn++;
        }
        gl.depthMask(true);
        if (!drawn) continue;

        // Blend this sample (with SSAO when enabled) over the running mean in the default framebuffer.
        if (useAOSceneMb) {
          const blendW = (completed === 0) ? 1.0 : (1 / (completed + 1));
          this._runAOPostPass(gl, vw, vh, bufferScale, subCamera, aoModeSceneMb, blendW, (completed % aoStrideScene) !== 0);
        } else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, vw, vh);
          gl.disable(gl.DEPTH_TEST);
          gl.useProgram(this._sceneBlitProg);
          gl.bindBuffer(gl.ARRAY_BUFFER, this._sceneBlitQuad);
          gl.enableVertexAttribArray(this._sceneBlitPosLoc);
          gl.vertexAttribPointer(this._sceneBlitPosLoc, 2, gl.FLOAT, false, 0, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this._sceneFboTex);
          gl.uniform1i(this._sceneBlitTexLoc, 0);
          if (completed === 0) {
            gl.blendFunc(gl.ONE, gl.ZERO);
          } else {
            gl.blendColor(0, 0, 0, 1 / (completed + 1));
            gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
          }
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
        completed++;
      }

      // Restore standard state for subsequent draws
      this._activeCamera = prevSceneCam;
      this._activeVw = prevSceneVw;
      this._activeVh = prevSceneVh;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(this.program);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
      if (this.locations.noDiscard) gl.uniform1f(this.locations.noDiscard, 0);

      // Members are effect-free by construction: plain blit (no shadow/split/post).
      if (completed > 0) {
        try { ctx.drawImage(this.glCanvas, 0, 0); } catch (_) { return false; }
        return true;
      }
      return false;
    }

    _ensureAOGl(vw, vh) {
      const gl = this.gl;
      if (!gl || !this.isWebGL2 || vw <= 0 || vh <= 0 || (this._aoFailCount && this._aoFailCount > 2)) return false;
      try {
        if (!this._aoProg) {
          const vs = this._compileShader(gl.VERTEX_SHADER, AO_QUAD_VS);
          const mkProg = (fsSrc) => {
            const fs = this._compileShader(gl.FRAGMENT_SHADER, fsSrc);
            const p = gl.createProgram();
            gl.attachShader(p, vs);
            gl.attachShader(p, fs);
            gl.linkProgram(p);
            gl.deleteShader(fs);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
            return p;
          };
          this._aoProg = mkProg(AO_PASS_FS);
          this._aoBlurProg = mkProg(AO_BLUR_FS);
          this._aoCompProg = mkProg(AO_COMP_FS);
          gl.deleteShader(vs);
          if (!this._aoProg || !this._aoBlurProg || !this._aoCompProg) {
            this._aoFailCount = (this._aoFailCount || 0) + 1;
            return false;
          }
          this._aoLocs = {
            depth: gl.getUniformLocation(this._aoProg, 'u_depth'),
            near: gl.getUniformLocation(this._aoProg, 'u_near'),
            far: gl.getUniformLocation(this._aoProg, 'u_far'),
            projScale: gl.getUniformLocation(this._aoProg, 'u_projScale'),
            radius: gl.getUniformLocation(this._aoProg, 'u_radius'),
            strength: gl.getUniformLocation(this._aoProg, 'u_strength'),
            power: gl.getUniformLocation(this._aoProg, 'u_power'),
            samples: gl.getUniformLocation(this._aoProg, 'u_samples')
          };
          this._aoBlurLocs = {
            aoTex: gl.getUniformLocation(this._aoBlurProg, 'u_aoTex'),
            depth: gl.getUniformLocation(this._aoBlurProg, 'u_depth'),
            near: gl.getUniformLocation(this._aoBlurProg, 'u_near'),
            far: gl.getUniformLocation(this._aoBlurProg, 'u_far'),
            radius: gl.getUniformLocation(this._aoBlurProg, 'u_radius'),
            dir: gl.getUniformLocation(this._aoBlurProg, 'u_dir')
          };
          this._aoCompLocs = {
            colorTex: gl.getUniformLocation(this._aoCompProg, 'u_colorTex'),
            aoTex: gl.getUniformLocation(this._aoCompProg, 'u_aoTex')
          };
          this._aoEmptyVao = gl.createVertexArray();
          this._aoSceneFbo = gl.createFramebuffer();
          this._aoColorTex = gl.createTexture();
          this._aoDepthTex = gl.createTexture();
          this._aoRawFbo = gl.createFramebuffer();
          this._aoRawTex = gl.createTexture();
          this._aoBlurFbo = gl.createFramebuffer();
          this._aoBlurTex = gl.createTexture();
        }

        if (this._aoFboW !== vw || this._aoFboH !== vh) {
          const useFullResAO = (vw <= 960 && vh <= 960);
          const aoW = useFullResAO ? vw : Math.max(1, vw >> 1);
          const aoH = useFullResAO ? vh : Math.max(1, vh >> 1);
          const initTex = (tex, intFmt, fmt, type, w, h, filter) => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, intFmt, w, h, 0, fmt, type, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          };
          initTex(this._aoColorTex, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, vw, vh, gl.NEAREST);
          initTex(this._aoDepthTex, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, vw, vh, gl.NEAREST);
          initTex(this._aoRawTex, gl.R8, gl.RED, gl.UNSIGNED_BYTE, aoW, aoH, gl.LINEAR);
          initTex(this._aoBlurTex, gl.R8, gl.RED, gl.UNSIGNED_BYTE, aoW, aoH, gl.LINEAR);

          gl.bindFramebuffer(gl.FRAMEBUFFER, this._aoSceneFbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._aoColorTex, 0);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this._aoDepthTex, 0);
          const okScene = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

          gl.bindFramebuffer(gl.FRAMEBUFFER, this._aoRawFbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._aoRawTex, 0);
          const okRaw = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

          gl.bindFramebuffer(gl.FRAMEBUFFER, this._aoBlurFbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._aoBlurTex, 0);
          const okBlur = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          if (!okScene || !okRaw || !okBlur) {
            this._aoFailCount = (this._aoFailCount || 0) + 1;
            return false;
          }
          this._aoFboW = vw;
          this._aoFboH = vh;
          this._aoHalfW = aoW;
          this._aoHalfH = aoH;
        }
        this._aoFailCount = 0;
        return true;
      } catch (_) {
        this._aoFailCount = (this._aoFailCount || 0) + 1;
        return false;
      }
    }

    /**
     * Single-pass, allocation-free resolver for volumetric 3D mesh effects of a layer.
     * Mirrors the previous per-type `effects.find(...)` lookups (first enabled match wins,
     * shapeType fallbacks use shared constant descriptors). Fills and returns `out`.
     */
    _resolveMeshFx(layer, out) {
      const K = this._meshFxConsts || (this._meshFxConsts = {
        box: { type: '3d_box' },
        pyr: { type: '3d_pyramid', sideMode: 'solid color' },
        sph: { type: '3d_sphere', sideMode: 'solid color' },
        cone: { type: '3d_cone', sideMode: 'solid color' },
        cyl: { type: '3d_cylinder', sideMode: 'solid color' },
        tor: { type: '3d_torus', sideMode: 'solid color' },
        mdl: { type: '3d_model' }
      });
      out.b = out.e = out.p = out.s = out.c = out.cyl = out.t = out.m = null;
      const fxs = layer.effects;
      if (Array.isArray(fxs)) {
        for (let i = 0; i < fxs.length; i++) {
          const f = fxs[i];
          if (!f || f.disabled) continue;
          const t = f.type;
          if (!out.b && (t === 'box_3d' || t === '3d_box')) out.b = f;
          else if (!out.e && t === 'extrude_3d') out.e = f;
          else if (!out.p && (t === 'pyramid_3d' || t === '3d_pyramid')) out.p = f;
          else if (!out.s && (t === 'sphere_3d' || t === '3d_sphere')) out.s = f;
          else if (!out.c && (t === 'cone_3d' || t === '3d_cone')) out.c = f;
          else if (!out.cyl && (t === 'cylinder_3d' || t === '3d_cylinder')) out.cyl = f;
          else if (!out.t && (t === 'torus_3d' || t === '3d_torus')) out.t = f;
        }
      }
      const st = layer.shapeType;
      if (!out.b && st === '3d_box') out.b = K.box;
      if (!out.p && (st === '3d_pyramid' || st === '3d_triangle')) out.p = K.pyr;
      if (!out.s && st === '3d_sphere') out.s = K.sph;
      if (!out.c && st === '3d_cone') out.c = K.cone;
      if (!out.cyl && st === '3d_cylinder') out.cyl = K.cyl;
      if (!out.t && st === '3d_torus') out.t = K.tor;
      out.m = (st === '3d_model' && layer.modelMediaId) ? K.mdl : null;
      return out;
    }

    _runAOPostPass(gl, vw, vh, bufferScale, camera, aoMode, blendWeight = -1, skipCompute = false) {
      const aoW = this._aoHalfW || Math.max(1, vw >> 1);
      const aoH = this._aoHalfH || Math.max(1, vh >> 1);
      const isHigh = aoMode === 'high';
      const isMed = aoMode === 'medium';
      const samples = isHigh ? 16 : (isMed ? 12 : 8);
      const radius = (isHigh ? 96 : (isMed ? 72 : 50)) * (bufferScale || 1);
      const strength = isHigh ? 6.5 : (isMed ? 4.5 : 2.8);
      const power = isHigh ? 2.0 : (isMed ? 1.45 : 1.0);

      const camLens = Math.max(1, camera && camera.cameraLens !== undefined ? camera.cameraLens : 50);
      const camZoom = camera && camera.cameraZoom !== undefined ? camera.cameraZoom : 100;
      const lensFactor = Math.max(0.01, camLens / 50);
      const totalZoom = lensFactor * Math.max(0.01, camZoom / 100);
      const D = CAMERA_DISTANCE * lensFactor * (bufferScale || 1);
      const NEAR = NEAR_PLANE * (bufferScale || 1);
      const FAR = 10000.0 * (bufferScale || 1);
      const camInv = this._getCameraInverseScale(camera, vw, vh, bufferScale, this._camScaleScratch);
      const projScaleX = vw / (2.0 * totalZoom * Math.abs(camInv.x) * D);
      const projScaleY = vh / (2.0 * totalZoom * Math.abs(camInv.y) * D);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this._aoEmptyVao);

      // Pass 2: Half-res Depth SSAO (+ passes 3a/3b blur) — skipped when reusing AO from a previous
      // motion-blur sample (skipCompute), saving 3 full-screen passes per sample.
      if (!skipCompute) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._aoRawFbo);
      gl.viewport(0, 0, aoW, aoH);
      gl.useProgram(this._aoProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._aoDepthTex);
      gl.uniform1i(this._aoLocs.depth, 0);
      gl.uniform1f(this._aoLocs.near, NEAR);
      gl.uniform1f(this._aoLocs.far, FAR);
      gl.uniform2f(this._aoLocs.projScale, projScaleX, projScaleY);
      gl.uniform1f(this._aoLocs.radius, radius);
      gl.uniform1f(this._aoLocs.strength, strength);
      gl.uniform1f(this._aoLocs.power, power);
      gl.uniform1i(this._aoLocs.samples, samples);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Pass 3a: Horizontal 7-tap depth-aware bilateral blur (_aoRawTex -> _aoBlurFbo)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._aoBlurFbo);
      gl.viewport(0, 0, aoW, aoH);
      gl.useProgram(this._aoBlurProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._aoRawTex);
      gl.uniform1i(this._aoBlurLocs.aoTex, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this._aoDepthTex);
      gl.uniform1i(this._aoBlurLocs.depth, 1);
      gl.uniform1f(this._aoBlurLocs.near, NEAR);
      gl.uniform1f(this._aoBlurLocs.far, FAR);
      gl.uniform1f(this._aoBlurLocs.radius, radius);
      gl.uniform2f(this._aoBlurLocs.dir, 1.0, 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Pass 3b: Vertical 7-tap depth-aware bilateral blur (_aoBlurTex -> _aoRawFbo)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._aoRawFbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._aoBlurTex);
      gl.uniform2f(this._aoBlurLocs.dir, 0.0, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      // Pass 4: Composite AO onto default framebuffer (supports running-mean blendWeight for motion blur)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, vw, vh);
      if (blendWeight >= 0) {
        gl.enable(gl.BLEND);
        if (blendWeight >= 0.999) {
          gl.blendFunc(gl.ONE, gl.ZERO);
        } else {
          gl.blendColor(0, 0, 0, blendWeight);
          gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
        }
      }
      gl.useProgram(this._aoCompProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._aoColorTex);
      gl.uniform1i(this._aoCompLocs.colorTex, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this._aoRawTex);
      gl.uniform1i(this._aoCompLocs.aoTex, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(null);
      gl.useProgram(this.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    /**
     * Batch membership rule for the shared 3D depth pass (single source of truth).
     * A layer joins a depth-shared run iff it is 3D with normal blending, no
     * 2D post-effects/filters and no depth-of-field — mirrors AE's "2D breaks 3D space".
     * Volumetric 3D effects (box_3d, extrude_3d, pyramid_3d, sphere_3d) are rendered directly
     * in the hardware WebGL depth buffer and preserve mutual 3D penetration.
     * js/editor.js uses the same rule to group motion-blur scene passes.
     */
    isBatchable3D(layer, bounds) {
      if (!layer || !bounds || !bounds.is3D) return false;
      if (layer.blendMode && layer.blendMode !== 'normal') return false;
      if (Array.isArray(layer.effects) && layer.effects.some(f => f && !f.disabled && f.type !== 'box_3d' && f.type !== '3d_box' && f.type !== 'extrude_3d' && f.type !== 'pyramid_3d' && f.type !== 'sphere_3d' && f.type !== 'cone_3d' && f.type !== 'cylinder_3d' && f.type !== 'torus_3d')) return false;
      if (window.FishEffects && typeof window.FishEffects.buildFilter === 'function' && window.FishEffects.buildFilter(layer) !== '') return false;
      if (layer._dofBlur && layer._dofBlur > 0.5) return false;
      const isPrecompCollapsed = (layer.type === 'precomp' && !!layer.collapseTransformations);
      if (!isPrecompCollapsed && typeof layer.roundness === 'number' && layer.roundness > 0) return false;
      return true;
    }

    /**
     * Render a composition sequence with hardware Z-buffer penetration for 3D intersecting layers.
     * Batches consecutive 3D layers into a single WebGL depth pass (reducing drawImage overhead for mobile).
     * NOTE: batch membership rule lives in isBatchable3D (single source of truth,
     * shared with the motion-blur scene pass in js/editor.js).
     * @param {CanvasRenderingContext2D} ctx - Target 2D canvas context
     * @param {Array<{ el: HTMLElement, layer: Object, animLayer?: Object }>} renderList - Layers to draw
     * @param {number} bufferScale - Scale factor relative to composition base size
     */
    renderScene(ctx, renderList, bufferScale = 1, camera = null, currentSec = null) {
      if (!ctx || !renderList || renderList.length === 0) return;

      const targetCanvas = ctx.canvas;
      const vp = this._getProjectViewport(bufferScale);
      const vw = targetCanvas ? targetCanvas.width : vp.vw;
      const vh = targetCanvas ? targetCanvas.height : vp.vh;

      const boundsArr = this._sceneBoundsScratch || (this._sceneBoundsScratch = []);
      boundsArr.length = renderList.length;
      let has3D = false;
      for (let i = 0; i < renderList.length; i++) {
        const item = renderList[i];
        const b = this.getBounds(item.animLayer || item.layer, bufferScale, camera, vw, vh);
        boundsArr[i] = b;
        if (b.is3D) has3D = true;
      }

      // Pure 2D fast path: If no 3D layers exist and no camera exists, render directly with native 2D canvas drawImage
      if (!has3D || !this.isReady) {
        for (let i = 0; i < renderList.length; i++) {
          const item = renderList[i];
          const lSec = (typeof currentSec === 'number' && !isNaN(currentSec)) ? currentSec : ((item.animLayer && item.animLayer._currentSec) || (item.layer && item.layer._currentSec));
          this.renderLayer(ctx, item.el, item.animLayer || item.layer, bufferScale, null, lSec);
        }
        return;
      }

      const currentBatch = this._sceneBatchScratch || (this._sceneBatchScratch = []);
      currentBatch.length = 0;

      const flushBatch = () => {
        if (currentBatch.length === 0) return;
        this._renderBatch(ctx, currentBatch, vw, vh, bufferScale, camera);
        currentBatch.length = 0;
      };

      for (let idx = 0; idx < renderList.length; idx++) {
        const item = renderList[idx];
        const layer = item.animLayer || item.layer;
        const b = boundsArr[idx];

        // In After Effects, 2D layers break 3D space:
        // Flush any preceding 3D layers in the depth buffer, composite the 2D layer, then resume 3D batching
        if (!this.isBatchable3D(layer, b)) {
          flushBatch();
          const lSec = (typeof currentSec === 'number' && !isNaN(currentSec)) ? currentSec : ((layer && layer._currentSec !== undefined) ? layer._currentSec : null);
          this.renderLayer(ctx, item.el, layer, bufferScale, b.is3D ? camera : null, lSec);
        } else {
          currentBatch.push({ item, bounds: b, batchIndex: idx });
        }
      }

      flushBatch();
    }

    _mat4Mul(out, a, b) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (let c = 0; c < 4; c++) {
        const o = c * 4;
        const b0 = b[o], b1 = b[o + 1], b2 = b[o + 2], b3 = b[o + 3];
        out[o]     = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
        out[o + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
        out[o + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
        out[o + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
      }
      return out;
    }

    _ensureShadowGl(size) {
      const gl = this.gl;
      if (!gl || !this.isWebGL2 || size <= 0) return false;
      if (this._shadowFbo && this._shadowSize === size) return true;
      try {
        if (!this._shadowFbo) {
          this._shadowFbo = gl.createFramebuffer();
          this._shadowDepthTex = gl.createTexture();
        }
        gl.bindTexture(gl.TEXTURE_2D, this._shadowDepthTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._shadowFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this._shadowDepthTex, 0);
        if (typeof gl.drawBuffers === 'function') gl.drawBuffers([gl.NONE]);
        if (typeof gl.readBuffer === 'function') gl.readBuffer(gl.NONE);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        if (status !== gl.FRAMEBUFFER_COMPLETE) return false;
        this._shadowSize = size;
        return true;
      } catch (_) {
        return false;
      }
    }

    _ensureReflGl(vw, vh) {
      const gl = this.gl;
      if (!gl || !this.isWebGL2 || vw <= 0 || vh <= 0) return false;
      if (this._reflFbo && this._reflW === vw && this._reflH === vh) return true;
      try {
        if (!this._reflFbo) {
          this._reflFbo = gl.createFramebuffer();
          this._reflColorTex = gl.createTexture();
          this._reflDepthTex = gl.createTexture();
        }
        gl.bindTexture(gl.TEXTURE_2D, this._reflColorTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, vw, vh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.bindTexture(gl.TEXTURE_2D, this._reflDepthTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, vw, vh, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._reflFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._reflColorTex, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this._reflDepthTex, 0);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        if (status !== gl.FRAMEBUFFER_COMPLETE) return false;
        this._reflW = vw;
        this._reflH = vh;
        return true;
      } catch (_) {
        return false;
      }
    }

    _computeCameraVP(out, vw, vh, bScale, camera) {
      const camX = camera ? (camera.posX || 0) * bScale : 0;
      const camY = camera ? (camera.posY || 0) * bScale : 0;
      const camPosZ = camera ? (camera.posZ || 0) * bScale : 0;
      const camRotX = camera ? (camera.rotX || 0) : 0;
      const camRotY = camera ? (camera.rotY || 0) : 0;
      const camRotZ = camera ? (camera.rotZ !== undefined ? camera.rotZ : (camera.rotation || 0)) : 0;
      const camLens = Math.max(1, camera ? (camera.cameraLens !== undefined ? camera.cameraLens : 50) : 50);
      const camZoom = camera ? (camera.cameraZoom !== undefined ? camera.cameraZoom : 100) : 100;
      const lensFactor = Math.max(0.01, camLens / 50);
      const zoomFactor = Math.max(0.01, camZoom / 100);
      const totalZoom = lensFactor * zoomFactor;
      const camInv = this._getCameraInverseScale(camera, vw, vh, bScale, this._camScaleScratch);
      const totalZoomX = totalZoom * camInv.x;
      const totalZoomY = totalZoom * camInv.y;
      const D = CAMERA_DISTANCE * lensFactor * bScale;
      const NEAR = NEAR_PLANE * bScale;
      const FAR = 10000.0 * bScale;
      const a = (FAR + NEAR) / (FAR - NEAR);
      const b = (-2.0 * FAR * NEAR) / (D * (FAR - NEAR));

      let m00 = 1, m01 = 0, m02 = 0;
      let m10 = 0, m11 = 1, m12 = 0;
      let m20 = 0, m21 = 0, m22 = 1;
      let rx = -(vw * 0.5 + camX);
      let ry = -(vh * 0.5 + camY);
      let rz = -camPosZ - D;

      if (camRotZ) {
        const radZ = (-camRotZ * Math.PI) / 180;
        const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
        let nx, ny;
        nx = rx * cZ - ry * sZ; ny = rx * sZ + ry * cZ; rx = nx; ry = ny;
        nx = m00 * cZ - m01 * sZ; ny = m00 * sZ + m01 * cZ; m00 = nx; m01 = ny;
        nx = m10 * cZ - m11 * sZ; ny = m10 * sZ + m11 * cZ; m10 = nx; m11 = ny;
        nx = m20 * cZ - m21 * sZ; ny = m20 * sZ + m21 * cZ; m20 = nx; m21 = ny;
      }
      if (camRotY) {
        const radY = (camRotY * Math.PI) / 180;
        const cY = Math.cos(radY), sY = Math.sin(radY);
        let nx, nz;
        nx = rx * cY + rz * sY; nz = -rx * sY + rz * cY; rx = nx; rz = nz;
        nx = m00 * cY + m02 * sY; nz = -m00 * sY + m02 * cY; m00 = nx; m02 = nz;
        nx = m10 * cY + m12 * sY; nz = -m10 * sY + m12 * cY; m10 = nx; m12 = nz;
        nx = m20 * cY + m22 * sY; nz = -m20 * sY + m22 * cY; m20 = nx; m22 = nz;
      }
      if (camRotX) {
        const radX = (camRotX * Math.PI) / 180;
        const cX = Math.cos(radX), sX = Math.sin(radX);
        let ny, nz;
        ny = ry * cX - rz * sX; nz = ry * sX + rz * cX; ry = ny; rz = nz;
        ny = m01 * cX - m02 * sX; nz = m01 * sX + m02 * cX; m01 = ny; m02 = nz;
        ny = m11 * cX - m12 * sX; nz = m11 * sX + m12 * cX; m11 = ny; m12 = nz;
        ny = m21 * cX - m22 * sX; nz = m21 * sX + m22 * cX; m21 = ny; m22 = nz;
      }

      const sxP = (2.0 / vw) * totalZoomX;
      const syP = -(2.0 / vh) * totalZoomY;
      out[0] = m00 * sxP; out[1] = m01 * syP; out[2] = a * (-m02 / D); out[3] = -m02 / D;
      out[4] = m10 * sxP; out[5] = m11 * syP; out[6] = a * (-m12 / D); out[7] = -m12 / D;
      out[8] = m20 * sxP; out[9] = m21 * syP; out[10] = a * (-m22 / D); out[11] = -m22 / D;
      out[12] = rx * sxP; out[13] = ry * syP; out[14] = a * (-rz / D) + b; out[15] = -rz / D;
      return out;
    }

    _computeLightVP(out, lightIdx, lightType, lighting, bScale, scx, scy, scz, sceneR) {
      const view = this._shadowViewScratch || (this._shadowViewScratch = new Float32Array(16));
      const proj = this._shadowProjScratch || (this._shadowProjScratch = new Float32Array(16));
      let ex, ey, ez, tx = scx, ty = scy, tz = scz;
      if (lightType === 1) {
        const dirs = lighting.directions || lighting.lightDirections;
        const o3 = lightIdx * 3;
        let dx = dirs ? dirs[o3] : 0, dy = dirs ? dirs[o3 + 1] : 0.7, dz = dirs ? dirs[o3 + 2] : -0.7;
        const dLen = Math.hypot(dx, dy, dz) || 1;
        dx /= dLen; dy /= dLen; dz /= dLen;
        const dist = sceneR * 2.4;
        ex = scx - dx * dist;
        ey = scy - dy * dist;
        ez = scz - dz * dist;
      } else {
        const pos = lighting.positions || lighting.lightPositions;
        const o3 = lightIdx * 3;
        ex = (pos ? pos[o3] : 0) * bScale;
        ey = (pos ? pos[o3 + 1] : 0) * bScale;
        ez = (pos ? pos[o3 + 2] : 300) * bScale;
      }

      let fx = tx - ex, fy = ty - ey, fz = tz - ez;
      let fLen = Math.hypot(fx, fy, fz);
      if (fLen < 1e-3) { fx = 0; fy = 0; fz = -1; fLen = 1; }
      fx /= fLen; fy /= fLen; fz /= fLen;

      let ux = 0, uy = 1, uz = 0;
      if (Math.abs(fy) > 0.96) { ux = 0; uy = 0; uz = 1; }
      let sx = fy * uz - fz * uy;
      let sy = fz * ux - fx * uz;
      let sz = fx * uy - fy * ux;
      const sLen = Math.hypot(sx, sy, sz) || 1;
      sx /= sLen; sy /= sLen; sz /= sLen;
      ux = sy * fz - sz * fy;
      uy = sz * fx - sx * fz;
      uz = sx * fy - sy * fx;

      view[0] = sx;  view[1] = ux;  view[2] = -fx; view[3] = 0;
      view[4] = sy;  view[5] = uy;  view[6] = -fy; view[7] = 0;
      view[8] = sz;  view[9] = uz;  view[10] = -fz; view[11] = 0;
      view[12] = -(sx * ex + sy * ey + sz * ez);
      view[13] = -(ux * ex + uy * ey + uz * ez);
      view[14] = (fx * ex + fy * ey + fz * ez);
      view[15] = 1;

      proj.fill(0);
      if (lightType === 1) {
        const half = sceneR * 1.35;
        const near = Math.max(10 * bScale, sceneR * 0.1);
        const far = sceneR * 5.0;
        const invR = 1 / half;
        const invNF = 1 / (far - near);
        proj[0] = invR;
        proj[5] = invR;
        proj[10] = -2 * invNF;
        proj[14] = -(far + near) * invNF;
        proj[15] = 1;
      } else {
        const dist = Math.max(fLen, 10 * bScale);
        const near = Math.max(12 * bScale, dist - sceneR * 1.45);
        const far = dist + sceneR * 1.8;
        const halfAngle = Math.min(1.18, Math.max(0.38, Math.atan((sceneR * 1.35) / Math.max(dist, sceneR * 0.5)) * 1.15));
        const f = 1 / Math.tan(halfAngle);
        const invNF = 1 / (near - far);
        proj[0] = f;
        proj[5] = f;
        proj[10] = (far + near) * invNF;
        proj[11] = -1;
        proj[14] = 2 * far * near * invNF;
      }

      return this._mat4Mul(out, proj, view);
    }

    _entryHasReflection(entry) {
      const layer = entry && entry.layer;
      if (!layer) return false;
      if (Array.isArray(layer.materialSlots) && layer.materialSlots.length > 0) {
        for (let i = 0; i < layer.materialSlots.length; i++) {
          const s = layer.materialSlots[i];
          if (s && ((Number(s.glossy) || 0) > 0.5 || (Number(s.metallic) || 0) > 0.5)) return true;
        }
      }
      const mo = layer.materialOptions;
      if (mo && ((Number(mo.glossy) || 0) > 0.5 || (Number(mo.metallic) || 0) > 0.5)) return true;
      return false;
    }

    _renderBatch(ctx, batch, vw, vh, bufferScale, camera = null) {
      if (!batch || batch.length === 0) return;
      const gl = this.gl;
      if (!gl) return;

      if (this.glCanvas.width !== vw || this.glCanvas.height !== vh) {
        this.glCanvas.width = vw;
        this.glCanvas.height = vh;
      }
      gl.viewport(0, 0, vw, vh);

      // Hardware depth testing enables true 3D spatial intersection
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.CULL_FACE);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      this._activeCamera = camera;
      this._activeVw = vw;
      this._activeVh = vh;

      // Single buffer clear for all layers in 3D batch
      const ps = (typeof window !== 'undefined' && window.currentProjectState) ? window.currentProjectState : null;
      const aoMode = (ps && ps.threeDEngine === 'advance' && (ps.ambientOcclusion === 'low' || ps.ambientOcclusion === 'medium' || ps.ambientOcclusion === 'high'))
        ? ps.ambientOcclusion
        : 'disabled';
      const useAO = Boolean(aoMode !== 'disabled' && this.isWebGL2 && this._ensureAOGl(vw, vh));

      gl.bindFramebuffer(gl.FRAMEBUFFER, useAO ? this._aoSceneFbo : null);
      gl.viewport(0, 0, vw, vh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(this.program);
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);

      // Bind quad buffers once
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.enableVertexAttribArray(this.locations.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);

      const pool = this._batchPool || (this._batchPool = []);
      const opaqueList = this._batchOpaqueScratch || (this._batchOpaqueScratch = []);
      const transList = this._batchTransScratch || (this._batchTransScratch = []);
      opaqueList.length = 0;
      transList.length = 0;

      const lensDistort = this._getLensDistort(camera);
      let poolUsed = 0;

      for (let i = 0; i < batch.length; i++) {
        const bEntry = batch[i];
        const item = bEntry.item || bEntry;
        const layer = item.animLayer || item.layer;
        const el = item.el;
        if (!el || !this._hasValidDimensions(el)) continue;

        const bounds = bEntry.bounds || this.getBounds(layer, bufferScale, camera, vw, vh);
        if (bounds.isBehindCamera || ((bounds.aabbW < 1.0 && bounds.w < 1.0) || (bounds.aabbH < 1.0 && bounds.h < 1.0))) {
          continue;
        }

        let entry = pool[poolUsed];
        if (!entry) {
          entry = {
            mvp: new Float32Array(16),
            model: new Float32Array(16),
            normal: new Float32Array(9),
            layer: null,
            el: null,
            bounds: null,
            layerOpacity: 1.0,
            bFx: null, eFx: null, pFx: null, sFx: null, cFx: null, cylFx: null, tFx: null, mFx: null,
            ndcZ: 0
          };
          pool[poolUsed] = entry;
        }

        const layerBias = (bEntry.batchIndex !== undefined ? bEntry.batchIndex : i) * 0.00002;
        const mvp = this._computeMVP(bounds, vw, vh, layerBias, camera, entry.mvp);
        if (!mvp) continue;

        const mfxB = this._resolveMeshFx(layer, this._meshFxScratch || (this._meshFxScratch = {}));
        const bFx = mfxB.b, eFx = mfxB.e, pFx = mfxB.p, sFx = mfxB.s;
        const cFx = mfxB.c, cylFx = mfxB.cyl, tFx = mfxB.t, mFx = mfxB.m;

        const zRange = this._getLayerMeshZRange(layer, bounds, bFx, eFx, pFx, sFx, cFx, cylFx, tFx, mFx);
        if (this._isOutsideFrustum(mvp, zRange[0], zRange[1], lensDistort)) {
          continue;
        }

        if (this._currentModelMatrix) entry.model.set(this._currentModelMatrix);
        if (this._currentNormalMatrix) entry.normal.set(this._currentNormalMatrix);

        const rawBatchOp = (layer.opacity !== undefined && layer.opacity !== null) ? Number(layer.opacity) : 1.0;
        const layerOpacity = (rawBatchOp > 1.0) ? Math.max(0, Math.min(1, rawBatchOp / 100)) : Math.max(0, Math.min(1, rawBatchOp));

        entry.layer = layer;
        entry.el = el;
        entry.bounds = bounds;
        entry.layerOpacity = layerOpacity;
        entry.bFx = bFx; entry.eFx = eFx; entry.pFx = pFx; entry.sFx = sFx; entry.cFx = cFx; entry.cylFx = cylFx; entry.tFx = tFx; entry.mFx = mFx;
        entry.ndcZ = mvp[14] / Math.max(0.001, mvp[15]);
        poolUsed++;

        const hasClosedMesh = !!(bFx || pFx || sFx || cFx || cylFx || tFx || mFx);
        const isTextured = !!(el !== gl.canvas && (
          layer.type === 'video' || layer.type === 'image' || layer.type === 'precomp' ||
          layer.fillType === 'gradient' || layer.fillType === 'media' ||
          (layer.type === 'shape' && (layer.fillType === 'gradient' || layer.fillType === 'media' || (layer.strokeWidth && layer.strokeWidth > 0)))
        ));
        if (hasClosedMesh && layerOpacity >= 0.999 && !isTextured) {
          opaqueList.push(entry);
        } else {
          transList.push(entry);
        }
      }

      if (opaqueList.length > 1) {
        opaqueList.sort((a, b) => a.ndcZ - b.ndcZ);
      }

      const drawBatchEntry = (entry, mvpOverride = null) => {
        const { layer, el, bounds, mvp, layerOpacity, bFx, eFx, pFx, sFx, cFx, cylFx, tFx, mFx } = entry;
        const useMvp = mvpOverride || mvp;
        const isCutoutQuad = (layer.type === 'image' || layer.type === 'text');
        if (!this._inShadowPass || isCutoutQuad) {
          const tex = this._getOrCreateTexture(el);
          if (!tex) return;
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(this.locations.texture, 0);
        }

        if (this._currentModelMatrix) this._currentModelMatrix.set(entry.model);
        if (this._currentNormalMatrix) this._currentNormalMatrix.set(entry.normal);

        gl.uniform1f(this.locations.opacity, this._inShadowPass ? 1.0 : layerOpacity);
        gl.depthMask(this._inShadowPass ? true : (!isCutoutQuad && layerOpacity >= 0.999));
        if (this.locations.lensDistort) gl.uniform1f(this.locations.lensDistort, this._inShadowPass ? 0.0 : lensDistort);
        gl.uniformMatrix4fv(this.locations.matrix, false, useMvp);

        if (mFx) this._draw3DModelMesh(gl, useMvp, bounds, layerOpacity, layer, el);
        else if (bFx) this._draw3DBoxMesh(gl, useMvp, bFx, bounds, layerOpacity, layer, el);
        else if (eFx) this._draw3DExtrudeMesh(gl, useMvp, eFx, bounds, layerOpacity, layer, el);
        else if (pFx) this._draw3DPyramidMesh(gl, useMvp, pFx, bounds, layerOpacity, layer);
        else if (sFx) this._draw3DSphereMesh(gl, useMvp, sFx, bounds, layerOpacity, layer);
        else if (cFx) this._draw3DConeMesh(gl, useMvp, cFx, bounds, layerOpacity, layer, el);
        else if (cylFx) this._draw3DCylinderMesh(gl, useMvp, cylFx, bounds, layerOpacity, layer, el);
        else if (tFx) this._draw3DTorusMesh(gl, useMvp, tFx, bounds, layerOpacity, layer, el);
        else {
          gl.uniform1i(this.locations.mode, (this._inShadowPass && !isCutoutQuad) ? 1 : 0);
          gl.disableVertexAttribArray(this.locations.color);
          gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
          gl.enableVertexAttribArray(this.locations.position);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
          gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
          gl.enableVertexAttribArray(this.locations.texCoord);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
          gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
          gl.drawElements(gl.TRIANGLES, this.quadIndexCount, gl.UNSIGNED_SHORT, 0);
        }
      };

      // --- ADVANCE 3D SHADOW MAP PASS ---
      const isAdvanceScene = Boolean(ps && ps.threeDEngine === 'advance');
      const shadowSize = isAdvanceScene ? (parseInt(ps.shadowQuality, 10) || 0) : 0;
      const lighting = this._lightingData;
      let shadowLightIdx = -1;
      let shadowLightType = 0;
      if (shadowSize >= 256 && lighting && lighting.numLights > 0) {
        const lTypes = lighting.types || lighting.lightTypes;
        if (lTypes) {
          for (let li = 0; li < lighting.numLights; li++) {
            if (lTypes[li] === 1) { shadowLightIdx = li; shadowLightType = 1; break; }
            if (lTypes[li] === 2 && shadowLightIdx < 0) { shadowLightIdx = li; shadowLightType = 2; }
          }
        }
      }
      const useShadow = Boolean(
        shadowLightIdx >= 0 &&
        (opaqueList.length + transList.length) > 0 &&
        this.isWebGL2 &&
        this._ensureShadowGl(shadowSize)
      );

      if (useShadow) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        const expandEntry = (en) => {
          const mm = en.model;
          const b = en.bounds;
          const r = Math.max(b ? b.w : 200, b ? b.h : 200, (en.layer && en.layer.scaleZ ? en.layer.scaleZ * bufferScale : 200)) * 0.75;
          const px = mm[12], py = mm[13], pz = mm[14];
          if (px - r < minX) minX = px - r; if (px + r > maxX) maxX = px + r;
          if (py - r < minY) minY = py - r; if (py + r > maxY) maxY = py + r;
          if (pz - r < minZ) minZ = pz - r; if (pz + r > maxZ) maxZ = pz + r;
        };
        for (let i = 0; i < opaqueList.length; i++) expandEntry(opaqueList[i]);
        for (let i = 0; i < transList.length; i++) expandEntry(transList[i]);
        const scx = (minX + maxX) * 0.5;
        const scy = (minY + maxY) * 0.5;
        const scz = (minZ + maxZ) * 0.5;
        const sceneR = Math.max(300 * bufferScale, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.55);

        const lightVP = this._shadowLightVP || (this._shadowLightVP = new Float32Array(16));
        const lightMvpScratch = this._shadowMvpScratch || (this._shadowMvpScratch = new Float32Array(16));
        this._computeLightVP(lightVP, shadowLightIdx, shadowLightType, lighting, bufferScale, scx, scy, scz, sceneR);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._shadowFbo);
        gl.viewport(0, 0, shadowSize, shadowSize);
        gl.colorMask(false, false, false, false);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(2.5, 4.0);
        if (this.locations.shadowParams) gl.uniform4f(this.locations.shadowParams, 0.0, 0.0, 1.0 / shadowSize, 0.85);
        if (this.locations.reflParams) gl.uniform4f(this.locations.reflParams, 0.0, 1200.0, 50.0, 0.03);

        this._inShadowPass = true;
        for (let i = 0; i < opaqueList.length; i++) {
          this._mat4Mul(lightMvpScratch, lightVP, opaqueList[i].model);
          drawBatchEntry(opaqueList[i], lightMvpScratch);
        }
        for (let i = 0; i < transList.length; i++) {
          if (transList[i].layerOpacity < 0.25) continue;
          this._mat4Mul(lightMvpScratch, lightVP, transList[i].model);
          drawBatchEntry(transList[i], lightMvpScratch);
        }
        this._inShadowPass = false;

        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.colorMask(true, true, true, true);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this._shadowDepthTex);
        if (this.locations.shadowMap) gl.uniform1i(this.locations.shadowMap, 2);
        if (this.locations.lightViewProj) gl.uniformMatrix4fv(this.locations.lightViewProj, false, lightVP);
        if (this.locations.shadowParams) gl.uniform4f(this.locations.shadowParams, 1.0, shadowLightIdx, 1.0 / shadowSize, 0.82);
        gl.activeTexture(gl.TEXTURE0);
      } else {
        if (this.locations.shadowParams) gl.uniform4f(this.locations.shadowParams, 0.0, 0.0, 1.0 / 1024.0, 0.82);
      }

      // --- ADVANCE 3D SCREEN-SPACE OBJECT REFLECTION PASS ---
      let hasReflectiveEntry = false;
      if (isAdvanceScene && ps.enableReflection) {
        for (let i = 0; i < opaqueList.length && !hasReflectiveEntry; i++) {
          if (this._entryHasReflection(opaqueList[i])) hasReflectiveEntry = true;
        }
        for (let i = 0; i < transList.length && !hasReflectiveEntry; i++) {
          if (this._entryHasReflection(transList[i])) hasReflectiveEntry = true;
        }
      }
      const reflW = Math.max(1, vw >> 1);
      const reflH = Math.max(1, vh >> 1);
      const useRefl = Boolean(
        hasReflectiveEntry &&
        (opaqueList.length + transList.length) > 1 &&
        this.isWebGL2 &&
        this._ensureReflGl(reflW, reflH)
      );

      if (useRefl) {
        // Pass 1: Render lit+shadowed scene into half-res _reflFbo (color + depth) to avoid GPU TDR on heavy meshes
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._reflFbo);
        gl.viewport(0, 0, reflW, reflH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this._activeReflPass = false;
        if (this.locations.reflParams) gl.uniform4f(this.locations.reflParams, 0.0, 1200.0, 50.0, 0.035);
        for (let i = 0; i < opaqueList.length; i++) drawBatchEntry(opaqueList[i]);
        for (let i = 0; i < transList.length; i++) drawBatchEntry(transList[i]);
        gl.depthMask(true);

        // Pass 2: Render final scene sampling _reflColorTex + _reflDepthTex for glossy/metallic objects
        const camVP = this._reflCameraVP || (this._reflCameraVP = new Float32Array(16));
        this._computeCameraVP(camVP, vw, vh, bufferScale, camera);
        gl.bindFramebuffer(gl.FRAMEBUFFER, useAO ? this._aoSceneFbo : null);
        gl.viewport(0, 0, vw, vh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this._reflColorTex);
        if (this.locations.sceneColorTex) gl.uniform1i(this.locations.sceneColorTex, 3);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, this._reflDepthTex);
        if (this.locations.sceneDepthTex) gl.uniform1i(this.locations.sceneDepthTex, 4);
        if (this.locations.cameraVP) gl.uniformMatrix4fv(this.locations.cameraVP, false, camVP);
        const maxReflDist = Math.max(vw, vh) * 1.15;
        if (this.locations.reflParams) gl.uniform4f(this.locations.reflParams, 1.0, maxReflDist, maxReflDist / 24.0, 0.045);
        gl.activeTexture(gl.TEXTURE0);

        this._activeReflPass = true;
        for (let i = 0; i < opaqueList.length; i++) drawBatchEntry(opaqueList[i]);
        for (let i = 0; i < transList.length; i++) drawBatchEntry(transList[i]);
        this._activeReflPass = false;
        gl.depthMask(true);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, useAO ? this._aoSceneFbo : null);
        gl.viewport(0, 0, vw, vh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this._activeReflPass = false;
        if (this.locations.reflParams) gl.uniform4f(this.locations.reflParams, 0.0, 1200.0, 50.0, 0.035);
        for (let i = 0; i < opaqueList.length; i++) drawBatchEntry(opaqueList[i]);
        for (let i = 0; i < transList.length; i++) drawBatchEntry(transList[i]);
        gl.depthMask(true);
      }

      // Reset shadow/reflection uniforms so single-layer renders & thumbnails stay clean
      if (this.locations.shadowParams) gl.uniform4f(this.locations.shadowParams, 0.0, 0.0, 1.0 / 1024.0, 0.82);
      if (this.locations.reflParams) gl.uniform4f(this.locations.reflParams, 0.0, 1200.0, 50.0, 0.035);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this._whiteFallbackTex);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this._envFallbackTex);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this._whiteFallbackTex);
      gl.activeTexture(gl.TEXTURE0);

      if (useAO) {
        this._runAOPostPass(gl, vw, vh, bufferScale, camera, aoMode);
      }

      // Single hardware blit onto destination 2D canvas
      try {
        ctx.drawImage(this.glCanvas, 0, 0);
      } catch (_) {}

      gl.disable(gl.DEPTH_TEST);
    }

    /**
     * Hardware-Accelerated 1-Pass WebGL RGB Split Renderer
     * Samples R, G, B channels with GPU texture offsets and outputs in 1 draw call (< 0.2ms).
     * @param {CanvasRenderingContext2D} ctx - Target 2D canvas context
     * @param {HTMLElement} el - Source image/canvas/video
     * @param {Object} bounds - Target bounds {x, y, w, h}
     * @param {Object} fx - Effect parameters {distance, angle}
     * @returns {boolean} True if successfully rendered via WebGL
     */
    renderRGBSplit(ctx, el, bounds, fx) {
      if (!this.isReady || !this.rgbSplitProgram || !this.gl || !el || !this._hasValidDimensions(el) || el === this.glCanvas) return false;
      const gl = this.gl;
      const dist = fx && fx.distance !== undefined ? fx.distance : 8;
      if (dist <= 0) return false;

      const angle = ((fx && fx.angle !== undefined ? fx.angle : 0) * Math.PI) / 180;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      if (this.glCanvas.width !== w || this.glCanvas.height !== h) {
        this.glCanvas.width = w;
        this.glCanvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.rgbSplitProgram);

      if (!this._fsQuadBuffer) {
        this._fsQuadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._fsQuadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          -1.0, -1.0,
           1.0, -1.0,
           1.0,  1.0,
          -1.0,  1.0
        ]), gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this._fsQuadBuffer);
      gl.enableVertexAttribArray(this.rgbLocations.pos);
      gl.vertexAttribPointer(this.rgbLocations.pos, 2, gl.FLOAT, false, 0, 0);

      if (!this._fxTexCoordBuffer) {
        this._fxTexCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._fxTexCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          0.0, 1.0,
          1.0, 1.0,
          1.0, 0.0,
          0.0, 0.0
        ]), gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this._fxTexCoordBuffer);
      gl.enableVertexAttribArray(this.rgbLocations.uv);
      gl.vertexAttribPointer(this.rgbLocations.uv, 2, gl.FLOAT, false, 0, 0);

      const tex = this._getOrCreateTexture(el);
      if (!tex) return false;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.rgbLocations.image, 0);
      gl.uniform2f(this.rgbLocations.delta, dx / w, -dy / h);
      gl.uniform1f(this.rgbLocations.opacity, 1.0);

      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

      try {
        ctx.drawImage(this.glCanvas, 0, 0, w, h, x, y, w, h);
        return true;
      } catch (_) {
        return false;
      }
    }

    /**
     * Compute 4x4 Model-View-Perspective matrix mapping [-0.5, 0.5] quad to WebGL clip space
     */
    /**
     * Compute inverse camera scale factors (smaller camera => larger projected objects).
     * Writes into a pre-allocated scratch object for zero per-frame GC allocation.
     */
    _getCameraInverseScale(camera, vw, vh, bScale, out) {
      const res = out || this._camScaleScratch || (this._camScaleScratch = { x: 1, y: 1 });
      res.x = 1;
      res.y = 1;
      if (!camera) return res;
      const safeScale = (bScale && bScale > 0) ? bScale : 1;
      const baseW = vw / safeScale;
      const baseH = vh / safeScale;
      if (baseW > 0 && typeof camera.scaleW === 'number' && !isNaN(camera.scaleW)) {
        const signX = camera.scaleW < 0 ? -1 : 1;
        const ratioX = Math.max(0.01, Math.abs(camera.scaleW) / baseW);
        res.x = signX / ratioX;
      }
      if (baseH > 0 && typeof camera.scaleH === 'number' && !isNaN(camera.scaleH)) {
        const signY = camera.scaleH < 0 ? -1 : 1;
        const ratioY = Math.max(0.01, Math.abs(camera.scaleH) / baseH);
        res.y = signY / ratioY;
      }
      return res;
    }

    _computeMVP(bounds, vw, vh, layerBias = 0, camera = null, outBuf = null) {
      const {
        cx, cy, posZ = 0,
        w, h, signX, signY,
        rotX = 0, rotY = 0, rotZ = 0,
        skewX = 0, skewY = 0,
        anchorX = 0, anchorY = 0, anchorZ = 0
      } = bounds;

      const bScale = bounds.bufferScale || 1;
      const camX = camera ? (camera.posX || 0) * bScale : 0;
      const camY = camera ? (camera.posY || 0) * bScale : 0;
      const camPosZ = camera ? (camera.posZ || 0) * bScale : 0;
      const camRotX = camera ? (camera.rotX || 0) : 0;
      const camRotY = camera ? (camera.rotY || 0) : 0;
      const camRotZ = camera ? (camera.rotZ !== undefined ? camera.rotZ : (camera.rotation || 0)) : 0;
      const camLens = Math.max(1, camera ? (camera.cameraLens !== undefined ? camera.cameraLens : 50) : 50);
      const camZoom = camera ? (camera.cameraZoom !== undefined ? camera.cameraZoom : 100) : 100;

      const lensFactor = Math.max(0.01, camLens / 50);
      const zoomFactor = Math.max(0.01, camZoom / 100);
      const totalZoom = lensFactor * zoomFactor;
      const camInv = this._getCameraInverseScale(camera, vw, vh, bScale, this._camScaleScratch);
      const totalZoomX = totalZoom * camInv.x;
      const totalZoomY = totalZoom * camInv.y;
      const D = CAMERA_DISTANCE * lensFactor * bScale;
      const NEAR = NEAR_PLANE * bScale;
      const FAR = 10000.0 * bScale;

      const radX = (rotX * Math.PI) / 180;
      const radY = (rotY * Math.PI) / 180;
      const radZ = (rotZ * Math.PI) / 180;
      const tanX = Math.tan(((skewX || 0) * Math.PI) / 180);
      const tanY = Math.tan(((skewY || 0) * Math.PI) / 180);

      const cosX = Math.cos(radX), sinX = Math.sin(radX);
      const cosY = Math.cos(radY), sinY = Math.sin(radY);
      const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);

      // 1. Local Basis Vectors in 3D layer space
      const sx = w * signX;
      const sy = h * signY;

      // Basis vector for vertex X input [-0.5, 0.5]
      let m00 = sx * (cosY * cosZ + tanY * (sinX * sinY * cosZ - cosX * sinZ));
      let m01 = sx * (cosY * sinZ + tanY * (sinX * sinY * sinZ + cosX * cosZ));
      let m02 = sx * (-sinY       + tanY * (sinX * cosY));

      // Basis vector for vertex Y input [-0.5, 0.5]
      let m10 = sy * (tanX * cosY * cosZ + (sinX * sinY * cosZ - cosX * sinZ));
      let m11 = sy * (tanX * cosY * sinZ + (sinX * sinY * sinZ + cosX * cosZ));
      let m12 = sy * (-tanX * sinY       + (sinX * cosY));

      // Basis vector for vertex Z
      let m20 = (cosX * sinY * cosZ + sinX * sinZ);
      let m21 = (cosX * sinY * sinZ - sinX * cosZ);
      let m22 = (cosX * cosY);

      // 2. Anchor World Position
      const anchorWorldX = cx + (bounds.anchorX || 0) * (signX || 1);
      const anchorWorldY = cy + (bounds.anchorY || 0) * (signY || 1);
      const anchorWorldZ = posZ + (bounds.anchorZ || 0);

      // Model matrix & Normal matrix for 3D Shading Pipeline (zero per-frame allocation)
      if (!this._currentModelMatrix) {
        this._currentModelMatrix = new Float32Array(16);
        this._currentNormalMatrix = new Float32Array(9);
      }
      const uax0 = -(bounds.anchorX || 0) / (bounds.w || 1);
      const uay0 = -(bounds.anchorY || 0) / (bounds.h || 1);
      const aZ0 = bounds.anchorZ || 0;

      const mm = this._currentModelMatrix;
      mm[0] = m00;  mm[1] = m01;  mm[2] = m02;  mm[3] = 0;
      mm[4] = m10;  mm[5] = m11;  mm[6] = m12;  mm[7] = 0;
      mm[8] = m20;  mm[9] = m21;  mm[10] = m22; mm[11] = 0;
      mm[12] = anchorWorldX + uax0 * m00 + uay0 * m10 - aZ0 * m20;
      mm[13] = anchorWorldY + uax0 * m01 + uay0 * m11 - aZ0 * m21;
      mm[14] = anchorWorldZ + uax0 * m02 + uay0 * m12 - aZ0 * m22;
      mm[15] = 1;

      const nm = this._currentNormalMatrix;
      const invSx = sx !== 0 ? (1.0 / sx) : 1.0;
      const invSy = sy !== 0 ? (1.0 / sy) : 1.0;
      nm[0] = m00 * invSx; nm[1] = m01 * invSx; nm[2] = m02 * invSx;
      nm[3] = m10 * invSy; nm[4] = m11 * invSy; nm[5] = m12 * invSy;
      nm[6] = m20;         nm[7] = m21;         nm[8] = m22;

      if (bounds.transformParams) {
        bounds.transformParams.modelMatrix = mm;
        bounds.transformParams.normalMatrix = nm;
      }

      // Relative coordinates in camera space (camera eye at distance D in front of canvas)
      let rx = anchorWorldX - (vw / 2 + camX);
      let ry = anchorWorldY - (vh / 2 + camY);
      let rz = (anchorWorldZ - camPosZ) - D;

      // Apply camera inverse 3D rotation (Roll -> Yaw -> Pitch around Camera Eye)
      if (camRotX || camRotY || camRotZ) {
        if (camRotZ) {
          const radZ = (-camRotZ * Math.PI) / 180;
          const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
          const nRx = rx * cZ - ry * sZ, nRy = rx * sZ + ry * cZ;
          rx = nRx; ry = nRy;

          const nb00 = m00 * cZ - m01 * sZ, nb01 = m00 * sZ + m01 * cZ;
          m00 = nb00; m01 = nb01;

          const nb10 = m10 * cZ - m11 * sZ, nb11 = m10 * sZ + m11 * cZ;
          m10 = nb10; m11 = nb11;

          const nb20 = m20 * cZ - m21 * sZ, nb21 = m20 * sZ + m21 * cZ;
          m20 = nb20; m21 = nb21;
        }
        if (camRotY) {
          const radY = (camRotY * Math.PI) / 180;
          const cY = Math.cos(radY), sY = Math.sin(radY);
          const nRx = rx * cY + rz * sY, nRz = -rx * sY + rz * cY;
          rx = nRx; rz = nRz;

          const nb00 = m00 * cY + m02 * sY, nb02 = -m00 * sY + m02 * cY;
          m00 = nb00; m02 = nb02;

          const nb10 = m10 * cY + m12 * sY, nb12 = -m10 * sY + m12 * cY;
          m10 = nb10; m12 = nb12;

          const nb20 = m20 * cY + m22 * sY, nb22 = -m20 * sY + m22 * cY;
          m20 = nb20; m22 = nb22;
        }
        if (camRotX) {
          const radX = (camRotX * Math.PI) / 180;
          const cX = Math.cos(radX), sX = Math.sin(radX);
          const nRy = ry * cX - rz * sX, nRz = ry * sX + rz * cX;
          ry = nRy; rz = nRz;

          const nb01 = m01 * cX - m02 * sX, nb02 = m01 * sX + m02 * cX;
          m01 = nb01; m02 = nb02;

          const nb11 = m11 * cX - m12 * sX, nb12 = m11 * sX + m12 * cX;
          m11 = nb11; m12 = nb12;

          const nb21 = m21 * cX - m22 * sX, nb22 = m21 * sX + m22 * cX;
          m21 = nb21; m22 = nb22;
        }
      }

      const wTrans = -rz / D;
      if (wTrans <= 0.001) {
        // If anchor point is behind camera lens, check if any corner of the quad is still in front
        const w0 = (-rz - 0.5 * m02 - 0.5 * m12) / D;
        const w1 = (-rz + 0.5 * m02 - 0.5 * m12) / D;
        const w2 = (-rz + 0.5 * m02 + 0.5 * m12) / D;
        const w3 = (-rz - 0.5 * m02 + 0.5 * m12) / D;
        if (Math.max(w0, w1, w2, w3) <= 0.001) return null; // Entire quad is behind camera lens
      }
      const safeWTrans = Math.max(0.001, wTrans);

      // Z Perspective Projection Parameters (maps distance [NEAR, FAR] monotonically to NDC [-1, 1])
      const a = (FAR + NEAR) / (FAR - NEAR);
      const b = (-2.0 * FAR * NEAR) / (D * (FAR - NEAR)) - (layerBias || 0);

      const out = outBuf || new Float32Array(16);

      // Column 0 (X vertex [-0.5, 0.5])
      out[0] = m00 * (2.0 / vw) * totalZoomX;
      out[1] = -m01 * (2.0 / vh) * totalZoomY;
      out[2] = a * (-m02 / D);
      out[3] = -m02 / D;

      // Column 1 (Y vertex [-0.5, 0.5])
      out[4] = m10 * (2.0 / vw) * totalZoomX;
      out[5] = -m11 * (2.0 / vh) * totalZoomY;
      out[6] = a * (-m12 / D);
      out[7] = -m12 / D;

      // Column 2 (Z unit basis vector)
      const z0 = m20 * (2.0 / vw) * totalZoomX;
      const z1 = -m21 * (2.0 / vh) * totalZoomY;
      const z3 = -m22 / D;
      out[8] = z0;
      out[9] = z1;
      out[10] = a * z3;
      out[11] = z3;

      // Column 3 (Anchor Translation & W homogeneous component)
      out[12] = (2.0 * rx) / vw * totalZoomX;
      out[13] = (-2.0 * ry) / vh * totalZoomY;
      out[14] = a * safeWTrans + b;
      out[15] = safeWTrans;

      // 3. Anchor Offset Correction (Shift quad vertices relative to local anchor point)
      const uax = -(bounds.anchorX || 0) / bounds.w;
      const uay = -(bounds.anchorY || 0) / bounds.h;
      if (uax || uay) {
        const dX = uax * out[0] + uay * out[4];
        const dY = uax * out[1] + uay * out[5];
        const dW = uax * out[3] + uay * out[7];
        out[12] += dX;
        out[13] += dY;
        out[14] += a * dW;
        out[15] += dW;
      }
      if (anchorZ) {
        out[12] += (-anchorZ) * z0;
        out[13] += (-anchorZ) * z1;
        out[14] += a * ((-anchorZ) * z3);
        out[15] += (-anchorZ) * z3;
      }

      return out;
    }

    /**
     * Micro Physics Spring Solver (Damped Harmonic Oscillator)
     * Provides authentic physics-based spring bounce for UI & 3D layers.
     * @param {Object} options
     * @param {number} [options.from=0] Initial value
     * @param {number} [options.to=1] Target value
     * @param {number} [options.stiffness=280] Spring constant k
     * @param {number} [options.damping=18] Damping ratio c
     * @param {number} [options.mass=1] Mass m
     * @param {number} [options.velocity=0] Initial velocity
     * @param {Function} options.onUpdate Value callback (currentVal, currentVel)
     * @param {Function} [options.onComplete] Callback on settled
     * @returns {Function} Cancel callback
     */
    spring({ from = 0, to = 1, stiffness = 280, damping = 18, mass = 1, velocity = 0, onUpdate, onComplete, timeScale } = {}) {
      let current = from;
      let vel = velocity;
      let lastTime = performance.now();
      let animId = null;

      const step = (now) => {
        let dt = (now - lastTime) / 1000;
        lastTime = now;
        if (dt > 0.064) dt = 0.064;

        const effectiveScale = typeof timeScale === 'number' ? timeScale : (typeof this.timeScale === 'number' ? this.timeScale : 1.0);
        dt = dt * effectiveScale;

        const springForce = -stiffness * (current - to);
        const dampingForce = -damping * vel;
        const accel = (springForce + dampingForce) / mass;

        vel += accel * dt;
        current += vel * dt;

        if (typeof onUpdate === 'function') {
          onUpdate(current, vel);
        }

        if (Math.abs(current - to) < 0.005 && Math.abs(vel) < 0.01) {
          if (typeof onUpdate === 'function') onUpdate(to, 0);
          if (typeof onComplete === 'function') onComplete();
          return;
        }

        animId = requestAnimationFrame(step);
      };

      animId = requestAnimationFrame(step);
      return () => {
        if (animId) cancelAnimationFrame(animId);
      };
    }

    /**
     * Set animation playback speed multiplier (e.g. 0.20 for super slowmo, 1.0 for normal)
     * @param {number} scale
     */
    setTimeScale(scale = 1.0) {
      this.timeScale = scale;
    }


  }

  const engine = new FishToolEngineCore();

  window.FishToolEngine = engine;
  window.LayerTransform = engine; // Seamless drop-in alias

})(window);
