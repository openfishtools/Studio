# Panduan Modular Extension OpenFishTools Studio (`Studio/Extension/`)

Direktori `Studio/Extension/` berisi seluruh **Modular Extension Cards (`.js`)** untuk OpenFishTools Studio.

Setiap file `.js` di dalam folder ini bersifat **100% Mandiri (Self-Contained)**:
- **Tampilan UI Card** (`build(ui, ctx)`)
- **Logika Bisnis, Algoritma Matematika, Expression After Effects, & Manipulasi Layer** (`tools: { ... }` dan method di dalam `Card({...})`)

Dengan arsitektur ini, Anda **tidak perlu lagi** mengedit banyak file di tempat terpisah. Cukup buka satu file `.js` di folder `Studio/Extension/`, edit logika atau tombolnya, simpan, dan perubahan langsung aktif!

---

## Daftar Extension Bawaan (`Studio/Extension/*.js`)

| File Extension | ID Card | Kategori | Fungsi Utama |
| :--- | :--- | :--- | :--- |
| `anchor_point.js` | `anchor_point` | `Layer` | Mengatur titik tumpu (Anchor Point) 9-arah dengan kompensasi trigonometri rotasi otomatis. |
| `cut_trim.js` | `cut_trim` | `Layer` | Memotong layer terhadap posisi playhead: **Cut Front**, **Cut Mid** (Split), dan **Cut Back**. |
| `align.js` | `align` | `Layer` | Meratakan posisi layer (**Left**, **H-Center**, **Right**, **Top**, **V-Center**, **Bottom**) terhadap kanvas komposisi. |
| `actions.js` | `actions` | `Layer` | **Precomp** (Normal & Auto-Crop), **Center** di kanvas, **Overlap** tangga timeline, **Screenshot PNG**, dan **Duplicate** layer/precomp. |
| `format.js` | `format` | `Project` | Mengubah rasio aspek komposisi (`1:1`, `16:9`, `9:16`, `3:4`, `4:3`) dan Frame Rate (`15`, `30`, `50`, `60`, `120` FPS). |
| `toolbox.js` | `toolbox` | `Tools` | Quick Layer (`FRZ`, `FIT`, `DSH`, `MIR`), Create Layer (`TXT`, `SHA`, `SOL`, `NUL`, `CAM`, `ADJ`), Effects, & 11 preset **Cutefish Styles**. |
| `velocity.js` | `velocity` | `Tools` | Pembuatan kurva kecepatan sinkron ketukan beat: **Twixtor Velocity** & **Time Remap Velocity**. |
| `beat_effects.js` | `beat_effects` | `Tools` | Efek beat **Current Beat** (`GHOST`, `WARP`, `FISHEYE`, `MIDWAVE`, `HUESPIN`), **Continuous Motion** (`FLASH`, `SHAKY`, `BLUR`, `OSCILLATE`, `X/Y BEAT`, `X/Y FLIP`, `SCALE`, `SWING`), **Panning**, **Idle Movement 1–6**, & **Warp Presets 1–2**. |
| `cube_generator.js` | `cube_generator` | `3D` | Generator kubus 3D 6-sisi (`Cube_Comp`) lengkap dengan `Cube_Controller` berdasarkan dimensi input atau ukuran layer terpilih. |
| `generator_3d.js` | `generator_3d` | `3D` | Generator 18 objek 3D prosedural (`PHONE`, `LAPTOP`, `MONITOR`, `PC`, `CRT`, `ROOM`, `DOOR`, `WINDOW`, `TABLE`, `DESK`, `CABINET`, `BOX`, `BOOK`, `BINDER`, `GLASSES`, `ZFLIP`, `ZFOLD`, `TABLET`), **MC 3D Rig**, **2/3-Split**, dan **3D Tunnel**. |
| `auto_mark.js` | `auto_mark` | `Audio` | Detektor ketukan otomatis dari layer audio menggunakan **Bass Peak Detection** (Filter Butterworth Low-Pass 160Hz + Spectral Flux) atau **Constant BPM Grid**. |
| `stopwatch.js` | `stopwatch` | `Utility` | Penghitung waktu kerja sesi (Stopwatch) terintegrasi. |
| `sticky_note.js` | `sticky_note` | `Utility` | Catatan tempel cepat yang tersimpan otomatis di `localStorage`. |
| `todo_list.js` | `todo_list` | `Utility` | Daftar tugas checklist proyek yang tersimpan otomatis di `localStorage`. |

---

## Struktur Dasar File Extension (`.js`)

Setiap extension didefinisikan menggunakan fungsi global `Card({ ... })`:

```javascript
/**
 * Contoh Extension Modular (.js)
 */
Card({
  id: 'my_custom_tool',           // ID unik extension (wajib sama dengan nama file)
  name: 'My Custom Tool',         // Nama yang tampil di header Card
  icon: 'auto_Fix_high',          // Nama Material Icon Google
  description: 'Deskripsi singkat fungsi extension ini.',
  category: 'Tools',              // Kategori: 'Layer' | 'Project' | 'Tools' | '3D' | 'Audio' | 'Utility'
  defaultEnabled: true,           // Aktif secara default di Extension Manager

  // 1. Method / Algoritma Anda sendiri (bebas menambahkan fungsi sebanyak apapun)
  spinSelectedLayer(ctx, angleDeg = 45) {
    const selected = ctx.layers.getSelected();
    if (!selected.length) {
      ctx.toast('Pilih minimal 1 layer terlebih dahulu!', 'warn');
      return;
    }

    ctx.history.snapshot(); // Simpan titik Undo
    selected.forEach(layer => {
      layer.rotation = (layer.rotation || 0) + angleDeg;
      layer.rotZ = layer.rotation;
    });

    ctx.project.commit('spin-layer', selected); // Render ulang timeline & kanvas
    ctx.toast(`Layer diputar +${angleDeg}°`);
  },

  // 2. Registrasi Tool ID (opsional, agar bisa dipanggil lewat ctx.runTool('SPIN_45') atau shortcut)
  tools: {
    SPIN_45(ctx) {
      return this.spinSelectedLayer(ctx, 45);
    }
  },

  // 3. Tampilan UI Card
  build(ui, ctx) {
    const self = this;

    ui.section('Quick Spin');
    ui.grid({ cols: 2 }, [
      ui.button({
        label: 'ROTATE +45°',
        icon: 'rotate_right',
        title: 'Putar layer 45 derajat searah jarum jam',
        onClick() {
          self.spinSelectedLayer(ctx, 45);
        }
      }),
      ui.button({
        label: 'ROTATE -45°',
        icon: 'rotate_left',
        title: 'Putar layer 45 derajat berlawanan jarum jam',
        onClick() {
          self.spinSelectedLayer(ctx, -45);
        }
      })
    ]);
  }
});
```

---

## Referensi Komponen UI (`ui.*`)

Di dalam `build(ui, ctx)`, Anda dapat menyusun antarmuka menggunakan helper `ui`:

1. **`ui.section(title)`**
   Membuat judul sub-bagian di dalam Card.
2. **`ui.grid({ cols: 3, gap: '6px' }, [ ...buttons ])`**
   Menyusun elemen tombol dalam tata letak kolom grid (`cols`: `1` s/d `6`).
3. **`ui.button({ label, icon, title, rightTitle, className, onClick, onContextMenu })`**
   Membuat tombol aksi. Mendukung klik kiri (`onClick`) dan klik kanan / tahan 2 detik di layar sentuh (`onContextMenu`).
4. **`ui.anchorGrid({ defaultActive: 4, onSelect(index) })`**
   Membuat grid 3x3 khusus pemilihan titik Anchor Point (`0` sampai `8`).
5. **`ui.formRow([ (subUI) => { ... } ])`**
   Menyusun beberapa input dalam satu baris horizontal.
6. **`ui.formGroup({ label, type, value, min, max, step, placeholder, onChange(val) })`**
   Membuat input angka (`type: 'number'`) atau teks (`type: 'text'`) lengkap dengan label di atasnya.
7. **`ui.slider({ label, min, max, step, value, unit, onChange(val) })`**
   Membuat slider geser interaktif dengan indikator nilai real-time.
8. **`ui.switch({ id, label, checked, onChange(isChecked) })`**
   Membuat tombol toggle on/off.
9. **`ui.custom((containerEl) => { ... })`**
   Membuat elemen DOM HTML kustom secara bebas di dalam `containerEl`.

---

## Referensi SDK Context (`ctx.*`)

Objek `ctx` menyediakan akses langsung yang bersih ke seluruh fitur inti editor tanpa perlu menghafal variabel global internal:

### 1. `ctx.layers` — Manipulasi Layer
- `ctx.layers.getAll()` — Mengambil seluruh array layer pada komposisi aktif.
- `ctx.layers.getSelected()` — Mengambil array semua layer yang sedang dipilih.
- `ctx.layers.getActive()` — Mengambil 1 layer utama yang sedang aktif/dipilih.
- `ctx.layers.select(layerId, multi = false)` — Memilih layer berdasarkan ID.
- `ctx.layers.getTiming(layer)` — Mengembalikan `{ startSec, durationSec, endSec, pps }`.
- `ctx.layers.createSlider(name, val, min, max, step, unit)` — Membuat objek Expression Slider Control (`ADBE Slider Control-0001`).
- `ctx.layers.isAudio(layer)` — Mengecek apakah sebuah layer merupakan layer audio.

### 2. `ctx.timeline` — Playhead, FPS, & Beatmarks
- `ctx.timeline.getPlayhead()` — Mengambil posisi waktu playhead saat ini (detik).
- `ctx.timeline.getFps()` — Mengambil FPS proyek saat ini (misal `60`).
- `ctx.timeline.getPps()` — Mengambil skala piksel per detik timeline (`pixelsPerSecond`).
- `ctx.timeline.getBeatmarks(layer)` — Mengambil daftar seluruh waktu beatmark aktif (detik) yang sudah diurutkan.

### 3. `ctx.project` & `ctx.history` — Komposisi & Undo/Redo
- `ctx.project.getState()` — Mengambil objek `currentProjectState`.
- `ctx.project.getDimensions()` — Mengembalikan `[baseW, baseH]` ukuran kanvas proyek (misal `[1920, 1080]`).
- `ctx.project.commit(reason, invalidateLayers)` — Menginvalidasi smart cache untuk layer yang berubah, me-render ulang timeline, menggambar ulang kanvas komposisi, dan menyimpan proyek.
- `ctx.history.snapshot()` — Menyimpan snapshot Undo/Redo sebelum memodifikasi properti layer.

### 4. `ctx.effects` — Efek Visual
- `ctx.effects.add(effectType)` — Menambahkan efek dari registry ke layer yang sedang dipilih.
- `ctx.effects.createInstance(effectType)` — Membuat instance objek efek baru dari `FishEffects.registry`.

### 5. `ctx.scene3d` — Engine 3D Prosedural & Precomp 3D
- `ctx.scene3d.create3DNull({ name, pos, ori, parent, startSec, durationSec, pps })` — Membuat layer Null 3D dengan parenting hierarkis.
- `ctx.scene3d.create3DFace({ name, w, h, pos, ori, parent, color, opacity, roundness, textureLayer, startSec, durationSec, pps })` — Membuat bidang 3D (shape atau bertekstur gambar/video).
- `ctx.scene3d.wrapIn3DPrecomp({ name, compW, compH, startSec, durationSec, childLayers, replaceLayer, pps })` — Membungkus seluruh rig 3D ke dalam Precomposition 3D (`collapseTransformations: true`).

### 6. `ctx.storage` & `ctx.toast` — Penyimpanan Lokal & Notifikasi
- `ctx.storage.get(key, defaultValue)` — Membaca data JSON milik extension dari `localStorage`.
- `ctx.storage.set(key, value)` — Menyimpan data JSON milik extension ke `localStorage`.
- `ctx.toast(message, type)` — Menampilkan pesan notifikasi toast di layar editor.

---

## Cara Membuat atau Menambah Extension Baru

1. **Buat File `.js` Baru** di dalam folder `Studio/Extension/`, misalnya `Studio/Extension/my_tool.js`.
2. **Tulis kode `Card({ id: 'my_tool', ... })`** di dalam file tersebut.
3. **Daftarkan di Manifest & HTML**:
   - Tambahkan entri `'my_tool'` pada array `BUILTIN_MANIFEST` di `Studio/js/extensions/extension-loader.js`.
   - Tambahkan `<script src="Extension/my_tool.js"></script>` di bagian bawah `Studio/editor.html` dan `Studio/desktop.html`.
   *(Atau pengguna juga dapat mengunggah file `.js` secara langsung melalui tombol **Import Extension** di jendela Extension Manager tanpa perlu mengedit HTML!).*

---

## Extension Builder (tanpa menulis dari nol)

Buka `Studio/extension-builder.html` (di server lokal: `http://localhost:3000/extension-builder.html`).

1. **Seret** komponen dari kartu *Add element* ke canvas (atau **tap** untuk menambah). Di HP, tombol FAB (+) berubah (morph) menjadi kartu *Add element*; tombol di header kartu membuka drawer **Properties / Script** (membuka satu otomatis menutup yang lain). **Canvas/Preview** diganti lewat bar melayang di atas. Di PC semuanya berupa kartu melayang yang bisa disembunyikan (ikon di bar atas) atau di-collapse.
2. Atur properti di panel **Properties**; metadata (id, nama, ikon, kategori) ada di tab **Extension**.
3. Tulis logika di **Script**: tab *Handler* (logika komponen terpilih), *Shared* (kode bersama di atas UI), *Output* (file hasil). Panel helper di kanan berisi daftar `ctx.*` yang bisa diklik untuk menyisipkan kode, dan autocomplete aktif saat mengetik `ctx.`.
4. Tab **Preview** menanam **editor Studio yang asli** (iframe `desktop.html` / `editor.html` di HP) dan memasukkan extension draft ke panel Extensions-nya, jadi tampilan dan tombolnya 1:1 dan jalan dengan `ctx` asli (project scratch, bukan project kamu). Hanya kartu draft yang ditampilkan; perubahan di builder tersinkron otomatis. Extension draft hanya **disuntikkan sementara** ke memori iframe (tidak pernah di-install atau disimpan ke `oft_custom_extensions`); saat halaman builder ditutup, data `ctx.storage` draft dikembalikan dan project scratch dihapus. Perlu dibuka lewat server Studio (`npm start`), bukan `file://`.
5. Klik **Export .js**, lalu simpan file ke `Studio/Extension/` dan tambahkan `<script src="Extension/nama.js"></script>` di `editor.html` / `desktop.html`.

File hasil export bisa di-**Import** kembali ke builder (model disimpan di komentar `@oft-builder-model` di akhir file; jangan dihapus bila ingin diedit lagi di builder).

Gesture: seret pegangan (⋮⋮) untuk memindah komponen; satu jari/drag di latar untuk menggeser canvas; **dua jari** untuk pinch-zoom + geser; ketuk dua kali di latar untuk reset tampilan; `Ctrl/Cmd + scroll` untuk zoom di PC.

Menambah komponen baru ke builder: tambahkan entri di `extension-builder/js/palette.js` dan satu `case` di `extension-builder/js/codegen.js`. Menambah method SDK ke helper: satu entri di `extension-builder/js/sdk-manifest.js`.
