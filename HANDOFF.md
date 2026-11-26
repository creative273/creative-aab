# Handoff: Creative AAB (untuk asisten AI lain)

Dokumen ini untuk melanjutkan pekerjaan aplikasi Creative AAB. Baca seluruhnya sebelum mengubah apa pun.

## 1. Gambaran

Aplikasi internal tim creative Agensi Anak Bangsa (AAB), 5 orang. Lead: Ray (username `ray`). Anggota: Fitria Azzahra/"Zahra" (`zahra`, konten sosmed), Athallah/"Aqil" (`aqil`, design), Albar (`albar`, video), Rifqi (`rifqi`, AIGC).

Tiga bagian, satu repo: https://github.com/creative273/creative-aab

| Bagian | Folder | Isi |
|---|---|---|
| Server | `server/worker.js` | Cloudflare Worker (satu file). API, login, sinkron Lark Sheet, Google Slides (EP) dan Sheets (kalender), Instagram, timeline, notifikasi, Web Push. Juga menyajikan versi HP di `/m/`. |
| Aplikasi laptop | `widget/` | Electron (Windows). `main.js`, `preload.js`, `renderer/app.js`, `renderer/style.css`. Auto-update dari GitHub Releases. |
| Versi HP | `mobile/` | PWA tanpa build tool: `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest`, ikon. Hanya notifikasi + approval (Ray). |

Alamat Worker produksi: `https://creative-aab.creative-545.workers.dev` (versi HP di `/m/`).

## 2. Aturan wajib

1. **Jangan pernah** minta atau menampilkan secret di chat: Lark App Secret, `ADMIN_PASSWORD`, `GOOGLE_SA` (JSON service account), token Instagram (diawali `EAA`), token login. Semua secret hanya di Cloudflare (Settings → Variables) atau disimpan server di KV.
2. Repo ini **publik**. Jangan commit secret.
3. **Push ke branch `main` yang mengubah `widget/**` = rilis otomatis ke semua laptop** (GitHub Actions membuat installer + `latest.yml`, laptop auto-update). Kerjakan di branch terpisah, rilis hanya setelah Ray bilang "rilis".
4. Worker (mulai v1.7) dideploy otomatis oleh `.github/workflows/deploy-worker.yml` memakai `server/wrangler.toml` saat `server/**` atau `mobile/**` di-push ke `main`, selama 3 secret GitHub (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_KV_ID`) sudah diisi. `keep_vars = true` menjaga variabel/secret Cloudflare tidak ikut terhapus. Deploy manual tetap bisa dilakukan dengan menyalin `server/worker.js` ke Cloudflare.
5. Setiap perubahan `mobile/*` wajib diikuti `node server/build-mobile.mjs`. Script itu menyalin isi `mobile/` ke dalam `worker.js` (antara penanda `// MOBILE-START` dan `// MOBILE-END`). Jangan edit blok itu manual.
6. Paket gratis Cloudflare: 100.000 request/hari, KV 100.000 baca dan **1.000 tulis/hari**, CPU 10 ms per request, 50 subrequest per jalan. Lark API: 10.000 panggilan/bulan. Hindari tulis KV yang tidak perlu (pola: tulis hanya kalau berubah).
7. Bahasa UI: Bahasa Indonesia. Tanpa em dash. Teks jelas dan singkat.
8. Cek setiap pekerjaan 2x (jalankan tes 2x) sebelum menyerahkan.

## 3. Menjalankan tes

```bash
cd server
node test/mock-test.mjs     # tes server utama (Lark, akun, IG, timeline, notifikasi, push, v1.7). Harus: "SEMUA TES LULUS"
node test/google-test.mjs   # tes Google Slides/Sheets dan setup v1.7. Harus: "TES GOOGLE LULUS"
# server lokal untuk mencoba UI (data tiruan):
WITH_GOOGLE=1 WITH_IG=1 WITH_FEED=1 WITH_MOBILE=1 WITH_V17=1 node test/dev-server.mjs
# lalu buka http://localhost:8787/m/  (login: ray / admin-rahasia-123, lainnya password123)
```

## 4. Status sekarang (26 Nov 2026)

- Rilis laptop terakhir di `main`: **v1.6.1**.
- Tag cadangan rollback: **`v1.6.2-stable`** (commit `097f95d`, isi v1.6.2 termasuk diagnosa layar hitam versi HP).
- Branch kerja **`v1.7`** (siap ditinjau Ray, belum di-merge ke `main`):
  1. **KPI Tim Saat Ini** (`/api/v17/kpi`, `/api/v17/kpi/refresh`): baca read-only dari sheet Lark tab pertama `A46:I67`, cache di KV `v17:kpi:sheet`, ditarik berkala (stale 3 jam, cron per jam). Semua akun bisa lihat; hanya Ray punya tombol Tarik ulang dan perbandingan snapshot bulan lalu.
  2. **Notifikasi Update Otomatis**: cron mengecek `latest.yml` GitHub Releases tiap jam, simpan di `v17:app:latest`, dititipkan sebagai `latestApp` di `/api/state`. Widget menampilkan banner + pop-up sekali per versi dengan tombol "Update Sekarang". Route `/api/app/update-request` dan tombol manual Ray sudah dihapus.
  3. **Panel Kesehatan & Kuota** (`/api/v17/health`, `/api/v17/health/check`, khusus Ray): status token Meta/IG (cek `debug_token` harian jam 08.00 WIB, peringatan bila tidak valid / error 190 / akses data <= 7 hari, maks 1x/hari), estimasi KV tulis harian (/1.000) dan Lark call bulanan (/10.000) + proyeksi, sinkron terakhir, dan log error per layanan (Lark, Google, IG). Notifikasi jenis `system` masuk ke laptop dan HP Ray.
  4. **Setup Bulan Baru 1 Halaman** (`/api/v17/setup/validate`, `/api/v17/setup/apply`, `/api/v17/snapshots`, khusus Ray): tempel 3 link (Lark, Content Calendar, EP) + opsional link KPI, tes koneksi, simpan snapshot bulan lalu ke `v17:snapshots` untuk pembanding MoM di Ringkasan, lalu terapkan.
  5. **Catatan Lead Privat** (`/api/v17/lead-notes`, `save`, `delete`, khusus Ray): log Performance, Development, Potential, Arahan per anggota di `v17:leadnotes`, tombol salin ringkasan Bagian 6 Monthly Report. Tidak terlihat tim dan tidak masuk Timeline.
  6. **Auto-deploy Worker**: `server/wrangler.toml` + `.github/workflows/deploy-worker.yml`.
- **Key KV baru v1.7 (terpisah total dari data lama):** `v17:kpi:config`, `v17:kpi:sheet`, `v17:app:latest`, `v17:health`, `v17:snapshots`, `v17:leadnotes`. Tidak ada struktur key lama yang diubah.
- **Prosedur rollback ke v1.6.2:** deploy ulang `server/worker.js` dari tag `v1.6.2-stable` ke Cloudflare. Key `v17:*` di KV boleh dibiarkan (tidak dibaca worker lama dan tidak mengganggu data lama). Widget `1.7.0` tetap bisa berjalan dengan worker lama (`latestApp` kosong sehingga banner update tidak muncul; menu lama tetap berfungsi).
- Cron Cloudflare: `*/10 * * * *`. Server sendiri yang membatasi: Lark dan Google hanya Senin sampai Sabtu 08.00 sampai 18.59 WIB; Instagram tiap 30 menit di luar jam itu; tugas per jam v1.7 (KPI, cek `latest.yml`, cek token harian jam 08 WIB) berjalan saat menit WIB < 10.

## 5. Masalah terbuka: versi HP layar hitam di iPhone Ray

**Gejala:** di iPhone Ray (Safari dan versi "Add to Home Screen"), halaman `/m/` hitam polos, tidak ada teks sama sekali. Warna piksel screenshot `#000000` (bukan navy `#08111D`), jadi CSS kemungkinan tidak terpasang atau halaman belum selesai dimuat. Di Android dan di laptop (mode mobile) aplikasi jalan normal. File di server sudah benar: `/m/`, `/m/app.js`, `/m/style.css` tersaji dengan isi terbaru.

**Yang sudah dicoba:** belum ada pengujian di iPhone selain screenshot. Diagnosa di branch `v1.6.2` belum sempat dicoba Ray (atau sudah dicoba dan tetap hitam tanpa teks).

**Arah investigasi yang disarankan:**
1. Pastikan worker branch `v1.6.2` (atau `v1.7`) sudah dideploy. Lalu buka `/m/` di Safari iPhone. Kalau tulisan "Memuat Creative AAB…" juga tidak muncul (padahal ada di HTML dengan style inline), berarti HTML-nya sendiri tidak sampai atau tidak dirender. Curigai: jaringan/DNS (`*.workers.dev` diblokir operator atau DNS), Private Relay, VPN, pemblokir konten Safari, atau Lockdown Mode.
2. Coba buka `https://creative-aab.creative-545.workers.dev/` (harus tampil JSON `{"ok":true,...}`) dan `/m/app.js` langsung di Safari iPhone. Kalau JSON pun tidak tampil, masalahnya jaringan, bukan kode.
3. Coba dengan Wi-Fi lain atau data seluler, dan matikan iCloud Private Relay (Settings → Apple ID → iCloud → Private Relay) serta content blocker (Settings → Safari → Extensions).
4. Kalau teks dan kotak error muncul: perbaiki sesuai pesannya. Kandidat kuat: akses `localStorage` atau `indexedDB` melempar `SecurityError` saat Safari memblokir penyimpanan (Settings → Safari → "Block All Cookies", atau Lockdown Mode). `mobile/app.js` membaca `localStorage` di baris paling atas, tanpa `try/catch`, sehingga seluruh aplikasi berhenti. Bungkus semua akses `localStorage`/`indexedDB` dengan `try/catch`.
5. Debug paling akurat: sambungkan iPhone ke Mac → Safari Mac → Develop → [iPhone] → halaman `/m/` → Console.
6. Coba di iPhone lain. Kalau jalan, masalahnya pengaturan iPhone Ray.

Setelah memperbaiki `mobile/*`: jalankan `node server/build-mobile.mjs`, jalankan dua tes server, lalu merge/deploy Worker. Versi HP tidak perlu rilis laptop.

## 6. Peta singkat kode

**Server (`server/worker.js`):**
- Rute ada di objek `R` di handler `fetch` (contoh `"GET /api/notif": ["all", () => getNotif(env, me)]`). Peran: `all`, `content`, `design`, `video`, `aigc`, `lead`. Rute v1.7 memakai prefix `/api/v17/*`.
- `/m/*` disajikan oleh `serveMobile()` dari `MOBILE_FILES` (tanpa login).
- Login: `POST /api/login` → token HMAC. Header `Authorization: Bearer <token>`.
- Notifikasi: `notify()` menyimpan ke KV `notif:<username>` lalu memanggil `pushTo()` (Web Push tanpa payload, VAPID ES256; kunci dibuat otomatis di KV `push:vapid`). Jenis: `mention`, `comment`, `reply`, `react`, `request`, `epnew`, `ep`, `system` (khusus Ray).
- Langganan push per akun: KV `push:<username>` (endpoint + preferensi per jenis).
- Request baru dan slide EP baru dideteksi saat cron (`notifyNewRequests`, `notifyNewEp`), hanya ke Ray.
- Approval: `POST /api/request/decision` (`APPROVE`/`PENDING`/`REJECT`), `POST /api/ep/decision` (`OKE`/`REVISI` + `note` wajib untuk revisi).

**Versi HP (`mobile/`):**
- `app.js`: state di objek `ui`, tampilan dirender ulang lewat `render()`. Tab: Notifikasi, Approval (hanya Ray), Akun.
- Token disimpan di `localStorage` (`aab_m_token`) dan IndexedDB `aab-mobile` (dipakai `sw.js`).
- `sw.js`: saat push masuk, ambil `/api/notif` dengan token dari IndexedDB, lalu tampilkan notifikasi yang belum pernah ditampilkan.
- Di iPhone, push hanya jalan dari aplikasi yang dipasang lewat Safari → Add to Home Screen (iOS 16.4 ke atas).

**Aplikasi laptop (`widget/`):**
- Rilis: naikkan `version` di `widget/package.json`, merge ke `main`, push. GitHub Actions (`.github/workflows/release.yml`) membuat rilis.
- Halaman baru v1.7 di `widget/renderer/app.js` (jendela penuh): `kpi` (semua akun), `health`, `setup`, `notes` (grup KHUSUS RAY). Menu input lama Ray diberi label "Dashboard tim". Banner update otomatis tampil di kedua mode (`#updBanner`).
- Renderer punya CSP ketat: dilarang atribut `style="..."` di HTML. Pakai class CSS atau `data-css` + `applyCss()`.

## 7. Panduan pengguna

`PANDUAN.md` di root repo berisi panduan lengkap untuk tim (setup Lark, Google, Instagram/Meta, versi HP, fitur v1.7, dan auto-deploy Worker). Perbarui kalau ada fitur yang berubah.
