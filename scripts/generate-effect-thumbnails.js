/**
 * OpenFishTools Studio - Zero-Dependency Effect Thumbnail Generator (CLI)
 *
 * Generates 128x128 PNG effect thumbnails matching the exact cat-portrait style
 * used across assets/effects/thumbs/*.png and builds 128x128 category collage
 * cards in assets/effects/categories/*.png.
 *
 * Usage:
 *   node scripts/generate-effect-thumbnails.js
 *   node scripts/generate-effect-thumbnails.js --category keying
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const THUMBS_DIR = path.join(ROOT, 'assets', 'effects', 'thumbs');
const CATS_DIR = path.join(ROOT, 'assets', 'effects', 'categories');
const MANIFEST_PATH = path.join(ROOT, 'effects', 'manifest.json');

/* ── Minimal Zero-Dependency PNG Decoder / Encoder (8-bit RGB / RGBA) ────── */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1);
    raw[rowOff] = 0; // filter None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowOff + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePNG(filePath) {
  const buf = fs.readFileSync(filePath);
  let off = 8;
  let width = 0, height = 0, bitDepth = 8, colorType = 6;
  const idats = [];

  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format (${bitDepth}-bit, type ${colorType}) in ${filePath}`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const inflated = zlib.inflateSync(Buffer.concat(idats));
  const recon = new Uint8Array(width * height * bpp);

  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const srcRow = y * (stride + 1) + 1;
    const dstRow = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = inflated[srcRow + x];
      const a = x >= bpp ? recon[dstRow + x - bpp] : 0;
      const b = y > 0 ? recon[dstRow - stride + x] : 0;
      const c = (x >= bpp && y > 0) ? recon[dstRow - stride + x - bpp] : 0;
      let val = raw;
      if (filter === 1) val = (raw + a) & 255;
      else if (filter === 2) val = (raw + b) & 255;
      else if (filter === 3) val = (raw + ((a + b) >> 1)) & 255;
      else if (filter === 4) val = (raw + paeth(a, b, c)) & 255;
      recon[dstRow + x] = val;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  if (bpp === 4) {
    rgba.set(recon);
  } else {
    for (let i = 0, j = 0; i < recon.length; i += 3, j += 4) {
      rgba[j] = recon[i];
      rgba[j + 1] = recon[i + 1];
      rgba[j + 2] = recon[i + 2];
      rgba[j + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/* ── Base Cat Portrait & Subject Mask Extraction ─────────────────────────── */

function loadBaseCat() {
  // Recover the exact original 128x128 cat base image from invert.png (255 - RGB)
  const invPath = path.join(THUMBS_DIR, 'invert.png');
  const img = decodePNG(invPath);
  const out = new Uint8Array(img.rgba.length);
  for (let i = 0; i < img.rgba.length; i += 4) {
    out[i] = 255 - img.rgba[i];
    out[i + 1] = 255 - img.rgba[i + 1];
    out[i + 2] = 255 - img.rgba[i + 2];
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, rgba: out };
}

/**
 * Estimate a clean foreground alpha mask for the cat + basket against the uniform
 * light-gray studio wall in the 128x128 base portrait.
 */
function buildCatForegroundMask(cat) {
  const { width: W, height: H, rgba } = cat;
  // Wall color sampled from top-left corner (uniform studio backdrop)
  const bgR = rgba[0], bgG = rgba[1], bgB = rgba[2];
  const mask = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const r = rgba[idx], g = rgba[idx + 1], b = rgba[idx + 2];
      const dist = Math.hypot(r - bgR, g - bgG, b - bgB);
      // Cat + basket sits mostly right-center/bottom (x > 30, y > 18)
      const inWallZone = (x < 32 && y < 95) || y < 18;
      let a = inWallZone ? 0 : Math.max(0, Math.min(1, (dist - 16) / 24));
      // Smoothstep
      a = a * a * (3 - 2 * a);
      // Preserve bright white cat chest/paws inside cat silhouette
      const cx = (x - 78) / 36;
      const cy = (y - 82) / 48;
      if (cx * cx + cy * cy < 0.85 && y > 48) {
        a = Math.max(a, 1.0);
      }
      mask[y * W + x] = a;
    }
  }
  return mask;
}

function checkerColor(x, y, cell = 8) {
  const dark = (((x / cell) | 0) + ((y / cell) | 0)) & 1;
  return dark ? [46, 52, 58] : [82, 90, 98];
}

function blendOver(fgR, fgG, fgB, alpha, bgR, bgG, bgB) {
  return [
    Math.round(fgR * alpha + bgR * (1 - alpha)),
    Math.round(fgG * alpha + bgG * (1 - alpha)),
    Math.round(fgB * alpha + bgB * (1 - alpha))
  ];
}

/* ── Keying Effect Thumbnail Renderers (128x128) ─────────────────────────── */

function renderChromaKeyThumb(cat, fgMask) {
  const { width: W, height: H, rgba } = cat;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const idx = p * 4;
      const a = fgMask[p];
      const [ckR, ckG, ckB] = checkerColor(x, y, 8);
      // Diagonal split: top-left shows original green screen, main area shows keyed transparency!
      const splitDiag = (x + y * 0.7) < 72;
      const bgR = splitDiag ? 24 : ckR;
      const bgG = splitDiag ? 196 : ckG;
      const bgB = splitDiag ? 54 : ckB;
      const [r, g, b] = blendOver(rgba[idx], rgba[idx + 1], rgba[idx + 2], a, bgR, bgG, bgB);
      // Crisp 1px divider on split line
      const onLine = Math.abs((x + y * 0.7) - 72) < 0.9 && a < 0.5;
      out[idx] = onLine ? 225 : r;
      out[idx + 1] = onLine ? 245 : g;
      out[idx + 2] = onLine ? 225 : b;
      out[idx + 3] = 255;
    }
  }
  return out;
}

function renderColorKeyThumb(cat, fgMask) {
  const { width: W, height: H, rgba } = cat;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const idx = p * 4;
      const a = fgMask[p];
      const [ckR, ckG, ckB] = checkerColor(x, y, 8);
      // Vertical split: left shows cyan-blue backdrop, right shows keyed transparency
      const isLeft = x < 44;
      const bgR = isLeft ? 14 : ckR;
      const bgG = isLeft ? 156 : ckG;
      const bgB = isLeft ? 235 : ckB;
      const [r, g, b] = blendOver(rgba[idx], rgba[idx + 1], rgba[idx + 2], a, bgR, bgG, bgB);
      const onLine = x === 44 && a < 0.5;
      out[idx] = onLine ? 210 : r;
      out[idx + 1] = onLine ? 240 : g;
      out[idx + 2] = onLine ? 255 : b;
      out[idx + 3] = 255;
    }
  }
  return out;
}

function renderLumaKeyThumb(cat) {
  const { width: W, height: H, rgba } = cat;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const r = rgba[idx], g = rgba[idx + 1], b = rgba[idx + 2];
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      // Key out brighter wall & highlights, keeping mid/dark cat tones over checkerboard
      let t = 1 - Math.max(0, Math.min(1, (luma - 0.42) / 0.20));
      const matte = t * t * (3 - 2 * t);
      const [ckR, ckG, ckB] = checkerColor(x, y, 8);
      const [or, og, ob] = blendOver(r, g, b, matte, ckR, ckG, ckB);
      out[idx] = or;
      out[idx + 1] = og;
      out[idx + 2] = ob;
      out[idx + 3] = 255;
    }
  }
  return out;
}

function renderSpillSuppressorThumb(cat, fgMask) {
  const { width: W, height: H, rgba } = cat;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const idx = p * 4;
      let r = rgba[idx], g = rgba[idx + 1], b = rgba[idx + 2];
      const a = fgMask[p];
      // Left half: strong green spill contamination; right half: clean despilled subject!
      if (x < 64) {
        r = Math.round(r * 0.65);
        g = Math.min(255, Math.round(g * 1.18 + 42));
        b = Math.round(b * 0.68);
      } else {
        // Subtle clean studio tint on despilled side
        const lim = 0.5 * (r + b);
        if (g > lim) g = Math.round(g - (g - lim) * 0.85);
      }
      const [ckR, ckG, ckB] = checkerColor(x, y, 8);
      const [or, og, ob] = blendOver(r, g, b, Math.max(0.25, a), ckR, ckG, ckB);
      const onLine = x === 64;
      out[idx] = onLine ? 235 : or;
      out[idx + 1] = onLine ? 255 : og;
      out[idx + 2] = onLine ? 235 : ob;
      out[idx + 3] = 255;
    }
  }
  return out;
}

function renderMatteChokerThumb(cat, fgMask) {
  const { width: W, height: H, rgba } = cat;
  const out = new Uint8Array(W * H * 4);
  // Erode mask by 2px to illustrate matte choking
  const choked = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let minA = fgMask[y * W + x];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = Math.max(0, Math.min(W - 1, x + dx));
          const ny = Math.max(0, Math.min(H - 1, y + dy));
          const v = fgMask[ny * W + nx];
          if (v < minA) minA = v;
        }
      }
      choked[y * W + x] = minA;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const idx = p * 4;
      const a = choked[p];
      const edgeRing = Math.max(0, fgMask[p] - a);
      const [ckR, ckG, ckB] = checkerColor(x, y, 8);
      // Highlight choked matte boundary in crisp lime accent over checkerboard
      let [or, og, ob] = blendOver(rgba[idx], rgba[idx + 1], rgba[idx + 2], a, ckR, ckG, ckB);
      if (edgeRing > 0.25) {
        or = Math.round(or * 0.35 + 160 * 0.65);
        og = Math.round(og * 0.35 + 235 * 0.65);
        ob = Math.round(ob * 0.35 + 115 * 0.65);
      }
      out[idx] = or;
      out[idx + 1] = og;
      out[idx + 2] = ob;
      out[idx + 3] = 255;
    }
  }
  return out;
}

/* ── Category Collage Builder (2x2 or 3x3 -> 128x128 PNG) ────────────────── */

function buildCategoryCollage(categoryName, effectIds) {
  const W = 128, H = 128;
  const grid = effectIds.length >= 7 ? 3 : 2;
  const cell = Math.floor(W / grid);
  const out = new Uint8Array(W * H * 4);

  const sources = [];
  for (const id of effectIds) {
    const p = path.join(THUMBS_DIR, `${id}.png`);
    if (fs.existsSync(p)) {
      sources.push(decodePNG(p));
    }
    if (sources.length >= grid * grid) break;
  }
  if (!sources.length) return null;

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const src = sources[(gy * grid + gx) % sources.length];
      const ox = gx * cell;
      const oy = gy * cell;
      const cw = gx === grid - 1 ? (W - ox) : cell;
      const ch = gy === grid - 1 ? (H - oy) : cell;
      for (let y = 0; y < ch; y++) {
        const sy = Math.min(src.height - 1, Math.floor((y / ch) * src.height));
        for (let x = 0; x < cw; x++) {
          const sx = Math.min(src.width - 1, Math.floor((x / cw) * src.width));
          const sIdx = (sy * src.width + sx) * 4;
          const dIdx = ((oy + y) * W + (ox + x)) * 4;
          out[dIdx] = src.rgba[sIdx];
          out[dIdx + 1] = src.rgba[sIdx + 1];
          out[dIdx + 2] = src.rgba[sIdx + 2];
          out[dIdx + 3] = 255;
        }
      }
    }
  }

  const outPath = path.join(CATS_DIR, `${categoryName.replace(/\s+/g, '-')}.png`);
  fs.mkdirSync(CATS_DIR, { recursive: true });
  fs.writeFileSync(outPath, encodePNG(W, H, out));
  return outPath;
}

/* ── Main Entrypoint ─────────────────────────────────────────────────────── */

function main() {
  const args = process.argv.slice(2);
  const catFlagIdx = args.indexOf('--category');
  const onlyCat = catFlagIdx >= 0 ? args[catFlagIdx + 1] : null;

  if (!onlyCat || onlyCat === 'keying') {
    const cat = loadBaseCat();
    const fgMask = buildCatForegroundMask(cat);

    const jobs = [
      ['chroma-key', renderChromaKeyThumb(cat, fgMask)],
      ['color-key', renderColorKeyThumb(cat, fgMask)],
      ['luma-key', renderLumaKeyThumb(cat)],
      ['spill-suppressor', renderSpillSuppressorThumb(cat, fgMask)],
      ['matte-choker', renderMatteChokerThumb(cat, fgMask)]
    ];

    fs.mkdirSync(THUMBS_DIR, { recursive: true });
    for (const [id, rgba] of jobs) {
      const target = path.join(THUMBS_DIR, `${id}.png`);
      fs.writeFileSync(target, encodePNG(cat.width, cat.height, rgba));
      console.log(`Generated ${path.relative(ROOT, target)} (${cat.width}x${cat.height})`);
    }

    const catPath = buildCategoryCollage('keying', ['chroma-key', 'color-key', 'luma-key', 'spill-suppressor']);
    if (catPath) {
      console.log(`Generated ${path.relative(ROOT, catPath)} (128x128 2x2 collage)`);
    }
  }

  if (onlyCat && onlyCat !== 'keying' && fs.existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const ids = manifest
      .filter(e => String(e.category || '').toLowerCase() === onlyCat.toLowerCase())
      .map(e => e.id);
    if (ids.length > 0) {
      const catPath = buildCategoryCollage(onlyCat.toLowerCase(), ids);
      console.log(`Generated ${path.relative(ROOT, catPath)} from ${ids.length} effects`);
    } else {
      console.warn(`No effects found for category "${onlyCat}"`);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { encodePNG, decodePNG, buildCategoryCollage };
