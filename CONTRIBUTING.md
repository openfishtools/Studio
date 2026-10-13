# Contributing to OpenFishTools Studio

Contributions from both human developers and autonomous AI coding agents are welcome. To ensure consistency, stability, and high performance across the suite, please adhere to the following project guidelines.

---

## 1. Design System & Theming Tokens

- **100% Theme Token Binding**: All colors, surface backgrounds, and borders must strictly use CSS custom properties from `css/theme.css` (e.g. `var(--bg-canvas)`, `var(--bg-panel)`, `var(--color-primary)`).
- **No Hardcoded Color Literals**: Never introduce `#...`, `rgb(...)`, `rgba(...)`, or `hsl(...)` color strings in HTML or CSS component files.
- **Pure Flat Aesthetics**: Strictly avoid `backdrop-filter: blur()`, `filter: blur()`, `box-shadow`, `drop-shadow()`, and gradients.
- **Typography**: Strictly use Cal Sans across the interface.

---

## 2. Modular Visual Effect Plugins (`effects/`)

### Apakah Efek Masih Menggunakan JavaScript?
**Ya, 100% masih JavaScript.** Seluruh efek visual di OpenFishTools Studio ditulis dalam JavaScript murni menggunakan Canvas 2D atau WebGL shader. Anda **tidak perlu** menguasai Rust atau mengompilasi WebAssembly untuk membuat efek baru.

### Peran `effects.wasm` vs Efek JavaScript
* **`effects.wasm` (Official Core Bundle)**: Modul binary bawaan yang membundel 64 efek inti resmi untuk rilis produksi dan verifikasi domain.
* **Efek Kontributor / Kustom (`effects/<effect_id>.js`)**: Kontributor dapat menambahkan efek baru sebagai berkas JavaScript biasa. `effects/loader.js` secara otomatis memuat efek kustom Anda berdampingan dengan core WASM. Maintainer yang nantinya akan memasukkan efek yang disetujui ke dalam bundle WASM rilis resmi.

### Alur & Contoh Membuat Efek Sendiri

Untuk membuat efek visual baru, Anda cukup membuat satu file `.js` di dalam folder `effects/`, lalu menjalankan `npm run sync:effects`. Seluruh parameter yang Anda daftarkan di `params` akan **otomatis mendapatkan UI slider/color-picker di Inspector serta mendukung animasi Keyframe di Timeline**.

#### Referensi Tipe Parameter (`params`)
| `type` | Properti yang Didukung | Contoh Penggunaan |
| :--- | :--- | :--- |
| `'number'` | `id`, `label`, `min`, `max`, `default`, `step`, `unit` | Slider angka (misal: `0` s/d `100`, unit `'px'`, `'%'`, `'°'`) |
| `'color'` | `id`, `label`, `default` | Color picker hex (misal: `'#ff0055'`) |
| `'select'` | `id`, `label`, `options: [{value, label}]`, `default` | Dropdown pilihan mode |
| `'checkbox'` | `id`, `label`, `default` (`true`/`false`) | Toggle switch on/off |

#### Referensi Metode Rendering
1. **`render(ctx, el, layer, bounds, fx, currentSec)`**: Mengambil alih proses penggambaran layer sepenuhnya. Gunakan `el` (elemen sumber gambar/kanvas layer) untuk digambar ke `ctx` dengan manipulasi posisi, potongan piksel, atau shader.
2. **`renderPost(ctx, el, layer, bounds, fx)`**: Dipanggil *setelah* layer selesai digambar normal. Cocok untuk menambahkan overlay warna, vignette, atau garis scanline di atas layer.

---

#### Contoh 1: Efek Manipulasi Visual / Glitch (`effects/rgb_glitch.js`)
Contoh efek yang memisahkan channel warna dan menggesernya berdasarkan parameter slider yang bisa di-keyframe:

```javascript
(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'rgb_glitch',
    name: 'RGB Glitch Split',
    category: 'lightning', // Pilihan: 'lightning' | 'layer' | 'movement' | '3d' | 'expression'
    icon: 'assets/FXPH.svg',
    description: 'Memisahkan channel RGB secara horizontal dan vertikal.',
    isExpanding: true, // Set true jika efek keluar dari batas ukuran asli layer
    params: [
      { id: 'offsetX', label: 'Horizontal Shift', type: 'number', min: -100, max: 100, default: 15, unit: 'px', step: 1 },
      { id: 'offsetY', label: 'Vertical Shift', type: 'number', min: -100, max: 100, default: 0, unit: 'px', step: 1 },
      { id: 'opacity', label: 'Ghost Opacity', type: 'number', min: 0, max: 100, default: 70, unit: '%', step: 1 }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds ? bounds.x : 0;
      const y = bounds ? bounds.y : 0;
      const w = bounds ? bounds.w : ctx.canvas.width;
      const h = bounds ? bounds.h : ctx.canvas.height;

      const dx = fx.offsetX !== undefined ? fx.offsetX : 15;
      const dy = fx.offsetY !== undefined ? fx.offsetY : 0;
      const alpha = (fx.opacity !== undefined ? fx.opacity : 70) / 100;

      // 1. Gambar layer asli di tengah
      ctx.drawImage(el, x, y, w, h);

      if (dx === 0 && dy === 0) return;

      // 2. Gambar bayangan shift dengan blend mode 'screen'
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = alpha;
      ctx.drawImage(el, x + dx, y + dy, w, h);
      ctx.drawImage(el, x - dx, y - dy, w, h);
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
```

#### Contoh 2: Efek Overlay Pasca-Render (`effects/duotone_wash.js`)
Contoh efek menggunakan `renderPost` untuk memberi sapuan warna di atas layer:

```javascript
(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'duotone_wash',
    name: 'Color Wash',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'Memberikan sapuan warna blend di atas layer.',
    params: [
      { id: 'color', label: 'Wash Color', type: 'color', default: '#9dff00' },
      { id: 'amount', label: 'Mix Amount', type: 'number', min: 0, max: 100, default: 50, unit: '%' }
    ],
    renderPost(ctx, el, layer, bounds, fx) {
      const amt = Math.max(0, Math.min(1, (fx.amount ?? 50) / 100));
      if (amt <= 0) return;

      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = amt;
      ctx.fillStyle = fx.color || '#9dff00';
      ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
```

#### Langkah Menjalankan Efek Baru Anda:
1. Simpan file di atas ke dalam folder `effects/` (misal: `effects/rgb_glitch.js`).
2. Jalankan perintah sinkronisasi di terminal:
   ```bash
   npm run sync:effects
   ```
3. Jalankan server (`npm start`) dan buka `http://localhost:3000/desktop.html`. Efek Anda langsung siap digunakan dan di-keyframe di timeline!

---

## 3. Versioning (Single Source of Truth)

- Versions are managed strictly in `version.json`.
- Do not manually edit version strings in HTML files or JS scripts.
- To increment the version and synchronize badges, run:
  ```bash
  npm run bump <new-version>
  ```

---

## 4. Testing & Verification

Before submitting a Pull Request, verify that all tests pass:

```bash
npm test
```

The automated test suite verifies:
1. JavaScript syntax integrity (`node --check`) across all files.
2. AST scope audit with zero undeclared global references.
3. Synchronizer sanity checks (`sync-effects.js` and `sync-version.js`).
4. HTML file structure and completeness.

---

## 5. Development Guidelines for AI Agents

Autonomous agents working on this repository must read [`AGENTS.md`](AGENTS.md) and adhere to:
- The **Error Investigation Protocol** (reproducing issues on `http://localhost:3000`, browser console inspection, screenshot capture).
- The **Tooling Mandate**: Node.js and Python are strictly for read-only diagnostics; code edits must be executed via native editor tool calls.
