<div align="center">

  <img src="https://raw.githubusercontent.com/openfishtools/.github/main/profile/assets/projects/studio.svg" width="96" height="96" alt="FishTools Studio" />

  # FishTools
  <sub>Studio</sub>

  **Browser-based motion graphics and video editing application.**

  [![Version: 0.5.133](https://img.shields.io/badge/version-0.5.133-9DFF00.svg)](version.json)
  [![Category: Web App](https://img.shields.io/badge/category-Web_App-blue.svg)](#)
  [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)
  [![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-blue.svg)](https://nodejs.org/)
  [![CI](https://github.com/cutefishaep/FishTools-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/cutefishaep/FishTools-Studio/actions)

</div>

[Bahasa Indonesia](#bahasa-indonesia) • [English](#english)

---

<a name="bahasa-indonesia"></a>
## Bahasa Indonesia

> **Pembaruan lisensi:** mulai dari **v0.5.133**, FishTools Studio dilisensikan di bawah **[GNU AGPLv3](LICENSE)**, bukan lagi MIT. Perangkat lunak bebas & open source dengan perlindungan *network copyleft* (siapapun yang memodifikasi dan men-deploy di web wajib membuka seluruh kode sumbernya). Versi sebelum v0.5.133 tetap MIT. Lihat [Lisensi](#lisensi).
>
> **Kebijakan Fork & Deployment Web:** Jika Anda melakukan *fork* repositori ini dan men-deploy-nya sendiri di web, seluruh efek bawaan (`effects.wasm`) terikat pada domain resmi dan akan menampilkan watermark anti-tamper jika diakses di luar domain resmi. Anda harus membuat ulang (*remake*) efek secara manual jika ingin menggunakan efek kustom sendiri pada deployment mandiri. Jika ingin mengakses dan menggunakan efek-efek ini secara penuh dan resmi tanpa watermark, akseslah melalui domain resmi: **[studio.cutefish.my.id](https://studio.cutefish.my.id)**.

### Ringkasan
OpenFishTools Studio adalah aplikasi grafis gerak (motion graphics) dan penyunting video non-linear berbasis web yang dibangun menggunakan teknologi web murni (*vanilla*). Menyediakan editor non-linear (NLE) dengan *compositing* layer, animasi *keyframe* pada multi-track timeline, sistem plugin efek visual modular, dan rendering video berbasis akselerasi perangkat keras langsung di sisi klien (*client-side*).

### Arsitektur & Kapabilitas Utama
- **Timeline Non-Linear**: Mendukung animasi *keyframe*, hierarki *parent & link*, mode *blend*, serta komposisi bertingkat (*precomps*).
- **Dua Mode Antarmuka**:
  - **Desktop Suite** (`desktop.html`): Tata letak desktop profesional dengan panel inspektur terintegrasi, header track, playhead scrubbing, dan kurva *graph editor*.
  - **Editor Responsif** (`editor.html`): Kompositor canvas yang adaptif terhadap perangkat mobile maupun tablet dengan kontrol sentuh.
- **Arsitektur Efek Modular**: Seluruh efek visual merupakan modul plugin independen di dalam `effects/*.js` yang terdaftar langsung ke `FishEffectsRegistry` dengan integrasi parameter ke timeline secara otomatis.
- **Ekspor Video Client-Side**: Memanfaatkan WebCodecs API dan MP4-muxer untuk proses rendering dan ekspor video langsung di dalam peramban (*browser*) tanpa ketergantungan server pemroses video eksternal.
- **Server Lokal Mandiri**: Server HTTP bawaan (`server.js`) tanpa dependensi eksternal, dilengkapi fitur *live reload* otomatis (SSE) dan integrasi opsional tunnel Cloudflare.
- **Sistem Desain Terstandarisasi**: Mengikat 100% warna dan token desain dari `css/theme.css` dengan prinsip *flat design* murni tanpa efek blur atau bayangan berat.

### Persyaratan Sistem & Kompatibilitas
- **Node.js**: Versi 18.0.0 atau lebih baru.
- **Peramban Web**: Peramban modern dengan dukungan WebCodecs dan HTML5 Canvas (Google Chrome 94+, Microsoft Edge 94+, Safari 16.4+).

### Panduan Memulai Cepat

1. **Kloning repositori**:
   ```bash
   git clone https://github.com/cutefishaep/FishTools-Studio.git
   cd FishTools-Studio
   ```

2. **Pasang dependensi**:
   ```bash
   npm install
   ```

3. **Jalankan server lokal**:
   ```bash
   npm start
   ```
   *Peluncur langsung sistem operasi:*
   - **macOS**: Klik dua kali file `./run.command`
   - **Windows**: Klik dua kali file `run.bat`

4. **Akses aplikasi melalui peramban**:
   - Antarmuka Desktop: `http://localhost:3000/desktop.html`
   - Antarmuka Responsif: `http://localhost:3000/editor.html`
   - Manajemen Proyek: `http://localhost:3000/index.html`

### Struktur Direktori Proyek

```text
├── assets/          # Ikon vektor SVG, font, dan berkas statis
├── css/             # Token desain tema dan lembar gaya CSS
│   ├── theme.css    # Token warna utama dan tipografi
│   ├── desktop.css  # Tampilan antarmuka desktop NLE
│   ├── editor.css   # Tampilan antarmuka editor responsif
│   └── modal.css    # Komponen dialog pop-up modular
├── effects/         # Plugin efek visual mandiri (FishEffectsRegistry)
├── js/              # Modul fungsional utama aplikasi
│   ├── desktop.js   # Logika desktop, pengaturan track, dan graph editor
│   ├── editor.js    # Komposisi canvas layer, manipulasi, dan playback
│   ├── fishtool-engine.js  # Mesin transformasi matriks 2D/3D & rendering
│   ├── FishExport-Enggine.js # Mesin ekspor WebCodecs
│   └── main.js      # Peluncur proyek dan basis data IndexedDB
├── functions/       # Handler backend Cloudflare Pages / Workers
├── scripts/         # Skrip otomatisasi, pengujian, dan sinkronisasi
│   ├── test-suite.js          # Skrip pengujian otomatis
│   ├── static-scope-audit.js  # Audit cakupan AST dan sintaksis JS
│   ├── prepare-wrangler.js    # Sinkronisasi konfigurasi Cloudflare dari .env
│   └── sync-effects.js        # Generator manifest efek otomatis
├── server.js        # Server pengembangan lokal
├── version.json     # Sumber kebenaran tunggal untuk versi aplikasi
└── CHANGELOG.md     # Catatan rilis kronologis
```

### Konfigurasi Lingkungan (`.env` & `wrangler.jsonc`)

Karena berkas `.env` dan `wrangler.jsonc` diabaikan oleh Git (demi keamanan token dan ID KV), ikuti langkah berikut untuk menyiapkannya sebelum deployment:

1. **Siapkan Berkas `.env`**:
   Salin template contoh yang telah disediakan:
   ```bash
   cp .env.example .env
   ```
   Lalu sesuaikan nilai variabelnya:
   - `SHARE_SECRET_TOKEN`: Token rahasia otentikasi endpoint `/api/share`.
   - `CATBOX_USERHASH`: (Opsional) Akun Catbox untuk penyimpanan aset cloud.
   - `CF_KV_NAMESPACE_ID`: ID namespace Cloudflare KV untuk proyek cloud.

2. **Buat Berkas `wrangler.jsonc`**:
   - **Cara Otomatis (Direkomendasikan)**:
     ```bash
     npm run prepare:wrangler
     ```
     Perintah ini otomatis membaca `CF_KV_NAMESPACE_ID` dari `.env` dan menghasilkan berkas `wrangler.jsonc`.
   - **Cara Manual**:
     Salin berkas template dan ubah nilainya langsung:
     ```bash
     cp wrangler.example.jsonc wrangler.jsonc
     ```

### Pengujian Otomatis
Jalankan rangkaian pengujian menyeluruh (validasi sintaksis, verifikasi cakupan AST, integritas dokumen HTML):
```bash
npm test
```

### Panduan untuk AI Agent
AI coding agent mandiri (Cursor, GitHub Copilot, Cline, Windsurf, OpenCode) wajib membaca dan mematuhi panduan dalam [`AGENTS.md`](AGENTS.md) mengenai peta arsitektur kode, kepatuhan token CSS, dan protokol investigasi bug runtime.

### Lisensi
Proyek ini dilisensikan di bawah [GNU Affero General Public License v3 (AGPL-3.0)](LICENSE). Halaman resmi: <https://www.gnu.org/licenses/agpl-3.0.html>.

#### Ringkasan
| B/T | Keterangan |
|---|---|
| Boleh | Memakai, memodifikasi, dan membagikan secara bebas (termasuk untuk keperluan pribadi maupun komersial). |
| Boleh | Membuat versi modifikasi (fork) dan mengintegrasikannya. |
| Boleh | Menjalankan server atau layanan web sendiri. |
| Wajib | **Membuka Source Code (Network Copyleft):** Jika Anda memodifikasi atau men-deploy software ini ke jaringan/web publik, Anda **wajib** merilis seluruh kode sumber modifikasinya ke publik di bawah lisensi AGPLv3 juga. |
| Wajib | Mencantumkan kredit dan pemberitahuan hak cipta asli ke FishTools Studio (OpenFishTools). |
| Wajib | Membagikan versi modifikasi dengan lisensi yang sama persis (AGPL-3.0). |
| Tidak | Menutup source code (*closed source*) saat mendistribusikan atau menjalankannya sebagai layanan jaringan. |
| Tidak | Menghapus atribusi/kredit asli atau membatasi hak kebebasan pengguna lain. |
| Tidak | Menuntut pembuat bertanggung jawab. Diberikan apa adanya, tanpa jaminan. |

Teks yang mengikat secara hukum adalah file [`LICENSE`](LICENSE); ringkasan ini hanya sebagai bantuan penjelasan.

---

<a name="english"></a>
## English

> **License update:** starting from **v0.5.133**, FishTools Studio is licensed under **[GNU AGPLv3](LICENSE)** instead of MIT. Free and open-source software protected by *network copyleft* (anyone who modifies and hosts it on the web must release the complete source code). Versions before v0.5.133 stay under MIT. See [License](#license).
>
> **Fork & Web Deployment Policy:** If you fork this repository and deploy it on the web, all built-in effects (`effects.wasm`) are tied to the official domain and will display an anti-tamper watermark if accessed outside authorized domains. You will need to manually remake your own effects if you wish to use custom effects on standalone deployments. To access and use these effects officially without any watermark, please access the platform through the official domain: **[studio.cutefish.my.id](https://studio.cutefish.my.id)**.

### Overview
OpenFishTools Studio is a browser-based motion graphics and video editing application built with vanilla web technologies. It provides a non-linear editor (NLE) with layer compositing, multi-track timeline keyframing, an extensible visual effect registry, and client-side hardware-accelerated video rendering.

### Key Architecture & Capabilities
- **Non-Linear Timeline**: Multi-track timeline supporting keyframe interpolation, parent & link hierarchies, blend modes, and nested precompositions.
- **Dual Interface Modes**:
  - **Desktop Suite** (`desktop.html`): After Effects-style layout with docked inspector panels, track headers, playhead scrubbing, and curve graph editor.
  - **Mobile / Responsive Editor** (`editor.html`): Touch-friendly and viewport-adaptive canvas compositor with gesture-driven timeline controls.
- **Modular Effect Plugin Engine**: Standalone effect modules located in `effects/*.js` registering directly to `FishEffectsRegistry` with automated parameter-to-timeline binding.
- **Client-Side Video Export**: Utilizes WebCodecs API and MP4-muxer for local rendering and video generation directly inside the browser without cloud processing.
- **Zero-Dependency Development Server**: Built-in HTTP server (`server.js`) with Server-Sent Events (SSE) live reload and optional Cloudflare tunnel support.
- **Strict Design System**: 100% CSS theme token binding (`css/theme.css`), pure flat aesthetic without heavy blur or shadow overhead.

### System Requirements & Compatibility
- **Node.js**: v18.0.0 or later (for local dev server).
- **Web Browser**: Modern browser with WebCodecs and HTML5 Canvas support (Google Chrome 94+, Microsoft Edge 94+, Safari 16.4+).

### Quick Start

1. **Clone the repository**:
   ```bash
   git clone https://github.com/cutefishaep/FishTools-Studio.git
   cd FishTools-Studio
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the local server**:
   ```bash
   npm start
   ```
   *Alternative native launchers:*
   - **macOS**: Double-click `./run.command`
   - **Windows**: Double-click `run.bat`

4. **Access the application**:
   - Desktop Interface: `http://localhost:3000/desktop.html`
   - Responsive Interface: `http://localhost:3000/editor.html`
   - Project Launcher & Dashboard: `http://localhost:3000/index.html`

### Project Structure

```text
├── assets/          # Vector SVG icons, fonts, and static assets
├── css/             # Design system tokens and component stylesheets
│   ├── theme.css    # Central color and spacing tokens
│   ├── desktop.css  # Desktop NLE styling
│   ├── editor.css   # Responsive editor styling
│   └── modal.css    # Modular modal components
├── effects/         # Modular visual effect plugins (FishEffectsRegistry)
├── js/              # Core client-side modules
│   ├── desktop.js   # Desktop interface, track controls, and graph editor
│   ├── editor.js    # Canvas compositor, layer operations, and playback
│   ├── fishtool-engine.js  # 2D/3D matrix transforms and rendering pipeline
│   ├── FishExport-Enggine.js # WebCodecs export engine
│   └── main.js      # Project launcher and IndexedDB storage
├── functions/       # Cloudflare Pages / Workers backend handlers
├── scripts/         # Verification test suite and build synchronizers
│   ├── test-suite.js          # Automated test runner
│   ├── static-scope-audit.js  # AST scope and syntax audit
│   ├── prepare-wrangler.js    # Wrangler configuration synchronizer
│   └── sync-effects.js        # Effect manifest generator
├── server.js        # Local development server
├── version.json     # Single source of truth for versioning
└── CHANGELOG.md     # Chronological release notes
```

### Configuration (`.env` & `wrangler.jsonc`)

Because `.env` and `wrangler.jsonc` are gitignored (to protect credentials and KV tokens), follow these steps to set them up before deployment:

1. **Setup `.env`**:
   Copy the provided example template:
   ```bash
   cp .env.example .env
   ```
   Configure your environment variables as needed:
   - `SHARE_SECRET_TOKEN`: Secret upload authorization token protecting `/api/share`.
   - `CATBOX_USERHASH`: (Optional) Userhash key for cloud asset hosting.
   - `CF_KV_NAMESPACE_ID`: Cloudflare KV namespace ID for project sharing.

2. **Generate `wrangler.jsonc`**:
   - **Automated (Recommended)**:
     ```bash
     npm run prepare:wrangler
     ```
     This reads `CF_KV_NAMESPACE_ID` from `.env` and generates a production-ready `wrangler.jsonc`.
   - **Manual**:
     Copy the template and edit directly:
     ```bash
     cp wrangler.example.jsonc wrangler.jsonc
     ```

### Automated Testing
Run the comprehensive test suite (syntax validation, AST scope verification, HTML integrity):
```bash
npm test
```

### AI Agent Guidance
Autonomous coding agents (Cursor, GitHub Copilot, Cline, Windsurf, OpenCode) should consult [`AGENTS.md`](AGENTS.md) for architectural maps, strict design token enforcement rules, and error investigation protocols.

### License & Fork Policy
This project is licensed under the [GNU Affero General Public License v3 (AGPL-3.0)](LICENSE). Official page: <https://www.gnu.org/licenses/agpl-3.0.html>.

> **Important Fork & Web Deployment Policy:**  
> If you fork this repository and deploy it to the web, the built-in effects engine (`effects.wasm`) is bound to the official domain and will display an anti-tamper watermark if accessed outside of it. You must manually remake the effects if you wish to run custom effects on your own deployment. To access and use these effects officially and fully without watermarks, visit the official domain: **[studio.cutefish.my.id](https://studio.cutefish.my.id)**.

#### Summary
| Y/N | Description |
|---|---|
| Yes | Use, modify and share freely (including for personal and commercial purposes). |
| Yes | Make modified versions (forks) and integrate them. |
| Yes | Run your own server or web-based service. |
| Required | **Disclose Source Code (Network Copyleft):** If you modify or run this software across a public network/web, you **must** make the complete source code of your version available under the AGPLv3. |
| Required | Keep the original copyright notices and credit to FishTools Studio (OpenFishTools). |
| Required | Share any modified versions under the same AGPL-3.0 license. |
| No | Make the software closed-source when distributing or running it as a network service. |
| No | Remove original credits or restrict other users' freedoms. |
| No | Hold the authors liable. It is provided as is, without warranty. |

The legally binding text is the [`LICENSE`](LICENSE) file; this summary is for informational purposes only.
