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
4. Worker **tidak** dideploy otomatis. Ray menyalin isi `server/worker.js` ke Cloudflare (Workers → creative-aab → Edit code → tempel → Deploy).
5. Setiap perubahan `mobile/*` wajib diikuti `node server/build-mobile.mjs`. Script itu menyalin isi `mobile/` ke dalam `worker.js` (antara penanda `// MOBILE-START` dan `// MOBILE-END`). Jangan edit blok itu manual.
6. Paket gratis Cloudflare: 100.000 request/hari, KV 100.000 baca dan **1.000 tulis/hari**, CPU 10 ms per request, 50 subrequest per jalan. Lark API: 10.000 panggilan/bulan. Hindari tulis KV yang tidak perlu (pola: tulis hanya kalau berubah).
7. Bahasa UI: Bahasa Indonesia. Tanpa em dash. Teks jelas dan singkat.
8. Cek setiap pekerjaan 2x (jalankan tes 2x) sebelum menyerahkan.

## 3. Menjalankan tes

```bash
cd server
node test/mock-test.mjs     # tes server utama (Lark, akun, IG, timeline, notifikasi, push). Harus: "SEMUA TES LULUS"
node test/google-test.mjs   # tes Google Slides/Sheets. Harus: "TES GOOGLE LULUS"
# server lokal untuk mencoba UI (data tiruan):
WITH_GOOGLE=1 WITH_IG=1 WITH_FEED=1 WITH_MOBILE=1 node test/dev-server.mjs
# lalu buka http://localhost:8787/m/  (login: ray / admin-rahasia-123, lainnya password123)
```

## 4. Status sekarang (26 Nov 2026)

- Rilis laptop terakhir: **v1.6.1** (sudah di `main`).
- Branch `v1.6.2` (belum di-merge, hanya server/HP): versi HP menampilkan tulisan "Memuat Creative AAB…" dan kotak error merah di layar kalau JavaScript gagal, plus penanda versi `?v=` pada `app.js` dan `style.css`. File `server/worker.js` di branch ini yang terakhir diberikan ke Ray.
- Cron Cloudflare: `*/10 * * * *`. Server sendiri yang membatasi: Lark dan Google hanya Senin sampai Sabtu 08.00 sampai 18.59 WIB; Instagram tiap 30 menit di luar jam itu.

## 5. Masalah terbuka: versi HP layar hitam di iPhone Ray

**Gejala:** di iPhone Ray (Safari dan versi "Add to Home Screen"), halaman `/m/` hitam polos, tidak ada teks sama sekali. Warna piksel screenshot `#000000` (bukan navy `#08111D`), jadi CSS kemungkinan tidak terpasang atau halaman belum selesai dimuat. Di Android dan di laptop (mode mobile) aplikasi jalan normal. File di server sudah benar: `/m/`, `/m/app.js`, `/m/style.css` tersaji dengan isi terbaru.

**Yang sudah dicoba:** belum ada pengujian di iPhone selain screenshot. Diagnosa di branch `v1.6.2` belum sempat dicoba Ray (atau sudah dicoba dan tetap hitam tanpa teks).

**Arah investigasi yang disarankan:**
1. Pastikan worker branch `v1.6.2` sudah dideploy. Lalu buka `/m/` di Safari iPhone. Kalau tulisan "Memuat Creative AAB…" juga tidak muncul (padahal ada di HTML dengan style inline), berarti HTML-nya sendiri tidak sampai atau tidak dirender. Curigai: jaringan/DNS (`*.workers.dev` diblokir operator atau DNS), Private Relay, VPN, pemblokir konten Safari, atau Lockdown Mode.
2. Coba buka `https://creative-aab.creative-545.workers.dev/` (harus tampil JSON `{"ok":true,...}`) dan `/m/app.js` langsung di Safari iPhone. Kalau JSON pun tidak tampil, masalahnya jaringan, bukan kode.
3. Coba dengan Wi-Fi lain atau data seluler, dan matikan iCloud Private Relay (Settings → Apple ID → iCloud → Private Relay) serta content blocker (Settings → Safari → Extensions).
4. Kalau teks dan kotak error muncul: perbaiki sesuai pesannya. Kandidat kuat: akses `localStorage` atau `indexedDB` melempar `SecurityError` saat Safari memblokir penyimpanan (Settings → Safari → "Block All Cookies", atau Lockdown Mode). `mobile/app.js` membaca `localStorage` di baris paling atas, tanpa `try/catch`, sehingga seluruh aplikasi berhenti. Bungkus semua akses `localStorage`/`indexedDB` dengan `try/catch`.
5. Debug paling akurat: sambungkan iPhone ke Mac → Safari Mac → Develop → [iPhone] → halaman `/m/` → Console.
6. Coba di iPhone lain. Kalau jalan, masalahnya pengaturan iPhone Ray.

Setelah memperbaiki `mobile/*`: jalankan `node server/build-mobile.mjs`, jalankan dua tes server, lalu serahkan `server/worker.js` ke Ray untuk dideploy. Versi HP tidak perlu rilis laptop.

## 6. Peta singkat kode

**Server (`server/worker.js`):**
- Rute ada di objek `R` di handler `fetch` (contoh `"GET /api/notif": ["all", () => getNotif(env, me)]`). Peran: `all`, `content`, `design`, `video`, `aigc`, `lead`.
- `/m/*` disajikan oleh `serveMobile()` dari `MOBILE_FILES` (tanpa login).
- Login: `POST /api/login` → token HMAC. Header `Authorization: Bearer <token>`.
- Notifikasi: `notify()` menyimpan ke KV `notif:<username>` lalu memanggil `pushTo()` (Web Push tanpa payload, VAPID ES256; kunci dibuat otomatis di KV `push:vapid`). Jenis: `mention`, `comment`, `reply`, `react`, `request`, `epnew`, `ep`, `update`.
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
- Renderer punya CSP ketat: dilarang atribut `style="..."` di HTML. Pakai class CSS atau `data-css` + `applyCss()`.

## 7. Panduan pengguna

`PANDUAN.md` di root repo berisi panduan lengkap untuk tim (setup Lark, Google, Instagram/Meta, versi HP). Perbarui kalau ada fitur yang berubah.
