# Panduan setup Creative AAB

Isi paket:
- `server/worker.js`: kode server pusat untuk Cloudflare.
- `Creative AAB-win32-x64/`: widget Windows untuk 4 laptop tim.

Urutan setup: **A. Lark → B. Sheet → C. Cloudflare → D. Widget**. Cukup sekali. Setelah itu tinggal rutinitas awal bulan (bagian E).

---

## A. Lark Developer (open.larksuite.com/app)

1. Buka app yang sudah kamu buat.
2. **Features → Bot**, lalu aktifkan. Ini syarat supaya app bisa ditambahkan ke file sheet.
3. **Permissions & Scopes**, tambahkan:
   - `sheets:spreadsheet`
4. **Version Management & Release**: buat versi baru, lalu Publish. Kalau perlu approval admin, approve dulu.
5. **Credentials & Basic Info**: catat **App ID**. App Secret jangan dikirim ke siapa pun. Nanti langsung ditempel di Cloudflare.

## B. Sheet bulan ini

1. **Tambahkan app ke file.** Buka file GMV CAMPAIGN NOVEMBER 2026, klik **⋯ → More → Add Apps** (atau "Add Document App"), cari nama app, lalu beri akses **Can edit**.
2. **Buat blok AIGC untuk Rifqi** di tab **Creative Report Analytic**, kolom **AH sampai AK**. Kolom X sampai AF sudah dipakai blok SHOWCASE HANDLED, jadi AG dibiarkan kosong sebagai jarak.

   | Sel | Isi |
   |---|---|
   | AH3 | AIGC |
   | AH4 | Summary |
   | AJ4 | `=SUM(AJ6:AJ104)` |
   | AK4 | `=SUM(AK6:AK104)` |
   | AH5 | No |
   | AI5 | Tanggal |
   | AJ5 | Jumlah Produksi |
   | AK5 | Jumlah Upload |

   Judul AJ5 dan AK5 harus mengandung kata "Produksi" dan "Upload". Server memakai judul itu untuk memastikan bloknya ada.
3. **Disarankan:** ubah akses link file jadi internal organisasi saja. Saat dicek, file ini bisa dibuka tanpa login Lark.

## C. Cloudflare (dash.cloudflare.com)

1. **Buat Worker.** Buka **Workers & Pages → Create → Create Worker**, beri nama `creative-aab`, lalu **Deploy**.
2. **Tempel kode.** Klik **Edit code**, hapus semua isi bawaan, tempel seluruh isi `server/worker.js`, lalu **Deploy**.
3. **Buat penyimpanan.** Buka **Storage & Databases → KV → Create**, beri nama `creative-aab-store`.
4. **Sambungkan penyimpanan.** Buka Worker `creative-aab` → **Settings → Bindings → Add → KV namespace**.
   - Variable name: `STORE`
   - KV namespace: `creative-aab-store`
5. **Isi variabel.** Masih di Worker yang sama, buka **Settings → Variables and Secrets**, tambahkan 3 variabel:
   - `LARK_APP_ID`, tipe Text: App ID dari langkah A5
   - `LARK_APP_SECRET`, tipe **Secret**: App Secret Lark
   - `ADMIN_PASSWORD`, tipe **Secret**: password awal akun `ray`, minimal 12 karakter campur huruf dan angka. Jangan dibagikan ke siapa pun. Password ini juga jalan masuk kalau Ray lupa password.
6. **Jadwal cek otomatis.** Buka **Settings → Trigger Events → Cron Triggers → Add**, isi `*/10 * * * *` (mulai versi 1.5.3). Server sendiri yang mengatur: sheet Lark dan Google dicek tiap 10 menit di jam kerja (Senin sampai Sabtu, 08.00 sampai 18.59 WIB). Di luar jam itu dan hari Minggu, hanya Instagram yang diperbarui, tiap 30 menit, tanpa menyentuh sheet.
7. **Cek server.** Buka alamat Worker di browser (contoh `https://creative-aab.namakamu.workers.dev`). Harus muncul `{"ok":true,"app":"creative-aab","auth":"accounts"}`.

## D. Widget di laptop

1. Unduh installer terbaru dari https://github.com/creative273/creative-aab/releases/latest (file `Creative-AAB-Setup-x.y.z.exe`).
2. Jalankan installer. Karena belum bertanda tangan digital, Windows memunculkan "Windows protected your PC". Klik **More info → Run anyway**. Cukup sekali, update berikutnya tidak memunculkan ini.
3. Login. Ray masuk dengan username `ray` dan password `ADMIN_PASSWORD` (langkah C5), lalu langsung ganti password di **Pengaturan → Ganti password**.
4. **Ray saja:** buka **Pengaturan → Kelola akun tim**, buat akun untuk Zahra, Aqil, Albar, dan Rifqi. Kirim username dan password ke masing-masing lewat chat pribadi.
5. **Ray saja, sekali per bulan:** **Pengaturan → Link sheet bulan ini**, tempel link file GMV CAMPAIGN, lalu klik **Pakai file ini**.

**Pindah dari versi 1.0 (folder zip):** klik kanan ikon CRE di tray → **Keluar**, hapus folder `Creative AAB-win32-x64` lama, lalu pasang installer di atas. Versi 1.0 berhenti jalan begitu server versi baru di-deploy, karena kunci tim sudah diganti login per akun.

**Update:** aplikasi mengecek versi baru saat dibuka dan tiap 6 jam, lalu mengunduhnya diam-diam. Begitu siap, muncul pop-up. Klik **Pengaturan → Pasang dan restart**, atau biarkan saja: update terpasang otomatis saat aplikasi ditutup. Tombol **Cek pembaruan** ada di Pengaturan.

Widget otomatis terbuka saat Windows menyala. Tombol − menyembunyikannya ke tray (ikon CRE di pojok kanan bawah, di dekat jam).

**Pembaruan data:** server mengecek sheet tiap 10 menit, widget mengambil data dari server tiap 5 menit dan saat jendela dibuka (paling sering sekali per menit). Tombol muat ulang hanya ada di widget Ray, dan dalam satu menit hanya satu kali yang benar-benar mengecek sheet, berapa kali pun diklik. Kalau batas gratis harian Cloudflare tercapai, widget menampilkan pesan dan berhenti mengirim request sampai jam 07.00 WIB. Data di sheet tidak terpengaruh.

## Jendela penuh dan personalisasi (versi 1.3)

- **Dua mode, satu aplikasi.** Tombol panah di bilah atas widget membuka **jendela penuh** (sidebar, Ringkasan, EP dengan daftar dan slide berdampingan). Tombol kotak di kiri bawah sidebar mengecilkannya lagi jadi widget. Semua data dan pengaturan sama di kedua mode.
- **Ringkasan** (jendela penuh): kartu KPI dengan tren 14 hari, daftar "Perlu ditangani sekarang", grafik input per hari 7 hari terakhir, content plan minggu ini, ringkasan EP, dan aktivitas tim (khusus Ray). Akun tim melihat KPI dan tugasnya sendiri.
- **Pengaturan → Tampilan** (per laptop): warna aksen (7 pilihan atau warna bebas), transparansi kaca, mode terang, efek kaca Windows 11 (wallpaper terlihat buram di belakang jendela; di Windows 10 memakai latar gradasi), dan pilihan membuka sebagai jendela penuh saat Windows menyala. Pop-up ikut warna aksen.
- **Foto profil:** Pengaturan → Ganti foto. Foto dipotong bulat, dikompres kecil, disimpan di server, dan terlihat oleh seluruh tim di sidebar, kartu KPI, dan aktivitas.

## Timeline, profil tim, dan tema penuh (versi 1.5)

- **Timeline** (semua akun, jendela penuh): tulis kabar dengan teks dan foto, beri reaksi (Suka, Love, Haha, Wow, Keren), dan komentar. Kejadian dari widget ikut muncul otomatis: konten baru di KPI, hasil design dan video, input AIGC, request selesai, dan POSTED. Keputusan approval (request dan EP) tidak masuk Timeline, cukup lewat notifikasi. Postingan dan komentar bisa dihapus pemiliknya atau Ray. Menu Timeline menampilkan tanda **Baru** kalau ada kabar yang belum dibaca.
- **Profil tim**: kartu semua anggota. Klik nama atau foto siapa saja (di Timeline juga) untuk membuka profilnya: foto besar, sampul, jabatan, bio, dan aktivitas orang itu. Di profil sendiri ada **Edit profil** untuk mengganti jabatan, bio, dan foto sampul.
- **Warna latar dan kartu** (Pengaturan): geser ke kanan supaya sidebar, kartu, dan latar ikut warna aksen. Geser ke kiri untuk tampilan netral seperti versi 1.3.
- Timeline menyimpan 300 item terakhir. Foto postingan dikompres otomatis.
- **Minta semua update (versi 1.5.2, khusus Ray)**: setelah rilis baru, update widget Ray dulu. Lalu di **Pengaturan → Aplikasi**, lihat daftar **Versi aplikasi tim** dan klik **Kirim pop-up: minta semua update**. Laptop yang belum di versi itu mendapat pop-up dalam 1 menit, dan widgetnya langsung mulai mengunduh pembaruan. Versi tiap orang tercatat otomatis mulai versi 1.5.2.
- **Tag dan notifikasi (versi 1.5.1)**: ketik `@` di postingan atau komentar, lalu pilih nama dari daftar (panah atas/bawah lalu Enter, atau klik). Orang yang ditag, pemilik postingan yang dikomentari, orang yang sudah ikut berkomentar, dan pemilik postingan yang diberi reaksi mendapat notifikasi. Lonceng di kanan atas menampilkan jumlah yang belum dibaca. Klik satu notifikasi untuk membuka postingannya. Notifikasi baru juga muncul sebagai pop-up di pojok layar (dicek tiap 1 menit).

## Versi HP (versi 1.6)

Versi HP isinya ringan: **notifikasi** untuk semua akun, plus **approval** request dan EP khusus Ray. Input KPI dan posting tetap lewat laptop.

**Alamat:** `https://<alamat-worker>/m/`, alamat Worker yang sama dengan yang diisi di aplikasi laptop, ditambah `/m/`.

**Pasang di Android (Chrome):**
1. Buka alamat di atas di Chrome, lalu login dengan username dan password yang sama dengan laptop.
2. Ketuk menu ⋮ → **Tambahkan ke layar utama** (atau **Instal aplikasi**).
3. Buka Creative AAB dari layar utama → tab **Akun** → **Nyalakan notifikasi di HP ini** → **Izinkan**.

**Pasang di iPhone (Safari, iOS 16.4 ke atas):**
1. Buka alamat di atas di **Safari** (bukan Chrome).
2. Ketuk tombol **Share** (kotak dengan panah ke atas) → **Add to Home Screen** → **Add**.
3. Buka Creative AAB dari layar utama, login → tab **Akun** → **Nyalakan notifikasi di HP ini** → **Allow**. Di iPhone, notifikasi hanya jalan kalau dibuka dari layar utama.

**Yang masuk sebagai notifikasi:** ditandai (@), komentar di postinganmu, balasan diskusi, request baru dan slide EP baru (khusus Ray), keputusan EP (OKE atau revisi, untuk tim), reaksi (mati bawaan, bisa dinyalakan), dan permintaan update aplikasi laptop. Tiap jenis bisa dimatikan di tab **Akun**, per HP.

**Approval (Ray):** tab **Approval** berisi request yang belum diputuskan (Approve, Pending, Reject) dan slide EP yang belum diputuskan (OKE, atau Revisi dengan catatan). Keputusan langsung tertulis ke sheet dan EP, dan tim dapat notifikasi.

Notifikasi request baru dicek bersama jadwal sheet (tiap 10 menit di jam kerja). Notifikasi HP tidak butuh pengaturan tambahan di Cloudflare: kunci notifikasi dibuat otomatis oleh server saat pertama dipakai.

## Akun dan akses

| Akun | Akses |
|---|---|
| Ray (`ray`) | Semua. Approve, Pending, Reject request. Dashboard tim. Link sheet bulan ini. Kelola akun tim. |
| Zahra | Input KPI CONTENT, request creative (yang sudah di-approve). |
| Aqil | Input KPI DESIGN, request creative. |
| Albar | Input KPI VIDEO, request creative. |
| Rifqi | Input KPI AIGC, request creative. |

Akses dicek di server, bukan hanya disembunyikan di tampilan. Satu anggota satu akun.

- **Reset password:** Pengaturan → Kelola akun tim → Reset password. Laptop yang memakai akun itu otomatis keluar dan perlu login lagi.
- **Nonaktifkan:** akun langsung keluar dan tidak bisa login sampai diaktifkan lagi. Data di sheet tidak berubah.
- **Salah password 5 kali:** akun dikunci 15 menit.
- **Ray lupa password:** login dengan `ADMIN_PASSWORD` dari Cloudflare. Kalau itu juga lupa, ganti nilai `ADMIN_PASSWORD` di Cloudflare lalu login dengan nilai baru.

## F. Google: Content Calendar dan EP (mulai versi 1.2)

Widget membaca dan menulis Content Calendar (Google Sheets) dan EP (Google Slides) lewat **service account**, yaitu akun Google khusus untuk server. Cukup diatur sekali.

1. Buka https://console.cloud.google.com dengan akun yang memiliki file Content Calendar dan EP (misalnya creative@agensianakbangsa.com). Buat project baru, beri nama `creative-aab`.
2. **APIs & Services → Library**: cari dan klik **Enable** untuk **Google Sheets API**, lalu untuk **Google Slides API**.
3. **IAM & Admin → Service Accounts → Create service account**. Isi nama `creative-aab-widget`, klik **Create and continue**, lewati pemberian role, lalu klik **Done**.
4. Klik service account yang baru dibuat → tab **Keys** → **Add key → Create new key → JSON**. Sebuah file `.json` terunduh.
   Kalau muncul pesan bahwa pembuatan key diblokir kebijakan organisasi, admin Google Workspace kantor perlu mengizinkannya dulu.
5. Cloudflare → Worker `creative-aab` → **Settings → Variables and Secrets → Add**: nama `GOOGLE_SA`, tipe **Secret**, nilainya seluruh isi file `.json` tadi (buka dengan Notepad, salin semua). Simpan, lalu **Deploy**.
6. **Penting:** file `.json` itu adalah kunci penuh ke file yang dibagikan. Jangan kirim lewat chat atau email. Setelah ditempel ke Cloudflare, hapus file itu dari laptop dan kosongkan Recycle Bin.
7. Bagikan file ke service account. Buka folder induk di Google Drive tempat folder bulanan dibuat (folder yang berisi `11. NOVEMBER` dan seterusnya) → **Share** → tempel email service account (bentuknya `creative-aab-widget@....iam.gserviceaccount.com`, tampil juga di Pengaturan widget Ray) → **Editor** → hilangkan centang Notify → **Share**. File di dalam folder itu, termasuk bulan-bulan berikutnya, otomatis ikut.
8. Di widget Ray: **Pengaturan → Content Calendar dan EP**, tempel link Content Calendar dan link EP bulan ini, lalu klik **Pakai link ini**.

## G. Instagram: Insight dan angka konten otomatis (mulai versi 1.4)

Widget mengambil data resmi dari Instagram untuk @agensianakbangsa (AAB) dan Nusantara MCN (NUSANTARA). Keduanya akun Creator, jadi bisa. Cukup diatur sekali oleh Ray.

1. Buka https://developers.facebook.com, login dengan akun Facebook Ray, klik **My Apps → Create App**. Beri nama `Creative AAB Insight`. Pada pilihan use case, pilih yang untuk mengelola konten dan pesan Instagram (**Manage messaging & content on Instagram**), lalu selesaikan pembuatan app. App cukup di mode **Development**, tidak perlu App Review karena hanya dipakai untuk akun sendiri.
2. Di menu kiri: **Instagram → API setup with Instagram login**. Kalau diminta permission, pastikan `instagram_business_basic` dan `instagram_business_manage_insights` aktif.
3. Tambahkan kedua akun IG sebagai tester: **App roles → Roles → Add People → Instagram Tester**, isi username `agensianakbangsa`, lalu ulangi untuk akun Nusantara.
4. Terima undangan di tiap akun IG: buka Instagram (di browser lebih mudah) → **Settings → Apps and websites → Tester invites** → **Accept**. Lakukan di kedua akun.
5. App baru memakai **API setup with Unified login**. Tautkan portofolio bisnis Agensi Anak Bangsa, lalu di **1. Konfigurasikan aplikasi** klik **Buat konfigurasi baru → Buat dari template**. Buka **Facebook Login for Business → Konfigurasi**, edit konfigurasi itu, dan pastikan izin `instagram_manage_insights` tercentang. Setelah itu di **2. Buat token akses → Tambahkan akun**, login dengan akun AAB, lalu klik **Buat token** dan salin tokennya. Token ini diawali `EAA` dan tidak kedaluwarsa.
6. Di widget Ray: **Pengaturan → Instagram**, tempel token di baris **AAB**, klik **Hubungkan**. Widget mengecek token ke Instagram dan menampilkan @username kalau berhasil.
7. Ulangi langkah 5 dan 6 untuk akun NUSANTARA (logout dulu dari Instagram di browser, lalu login dengan akun Nusantara).
8. **Penting:** token adalah akses ke akun IG. Jangan kirim lewat chat atau email, dan jangan screenshot. Token disimpan di server, tidak pernah dikirim ke laptop tim, dan diperpanjang otomatis sebelum masa 60 harinya habis. Kalau token bocor, buat token baru (langkah 5) lalu tempel lagi; token lama bisa dicabut dari Instagram → Settings → Apps and websites.

Yang terjadi setelah terhubung:

- Menu **Insight Instagram** (semua akun tim): followers, views, reach, dan interaksi 7 hari (dibanding 7 hari sebelumnya), grafik views per hari 14 hari, konten terbaik 7 atau 30 hari, dan tabel semua konten 60 hari terakhir. Ray punya tombol **Sinkron sekarang**.
- Followers, daftar postingan, dan insight akun diambil tiap 30 menit, termasuk malam hari dan hari Minggu. Angka per konten diperbarui bergiliran tiap 10 menit, konten seminggu terakhir didahulukan. Penulisan angka ke sheet hanya di jam kerja. Instagram sendiri bisa terlambat sampai 48 jam.
- **Angka di blok CONTENT terisi otomatis.** Tiap 4 jam (dan saat Ray klik Sinkron sekarang), Views, Likes, Comment, dan Share & Save untuk link yang sudah ada di blok CONTENT diperbarui dari Instagram. Share & Save diisi jumlah share ditambah save. Kalau Instagram tidak memberi angka views (misalnya sebagian carousel), kolom Views dibiarkan seperti semula, kolom lain tetap diperbarui.
- **Zahra tidak perlu file ABT lagi untuk konten IG.** Di Input KPI klik **Ambil postingan baru**: muncul postingan bulan ini (sesuai sheet bulanan) yang belum ada di sheet, lengkap dengan tanggal, akun (COLLABORATION kalau postingan muncul di kedua akun), kategori, dan angka. Zahra tinggal isi nama konten dan pilih pillar, lalu kirim. Upload file ABT tetap ada sebagai cadangan.

## E. Rutinitas tiap awal bulan

1. Duplikat file seperti biasa.
2. Tambahkan app ke file baru (langkah B1). Blok AIGC ikut terbawa saat diduplikat.
3. Di widget Ray: **Pengaturan → Link sheet bulan ini**, tempel link baru, lalu klik **Pakai file ini**. Semua laptop otomatis ikut.
4. Buat Content Calendar dan EP bulan baru seperti biasa (di dalam folder bulanan). Di widget Ray: **Pengaturan → Content Calendar dan EP**, tempel kedua link baru, lalu klik **Pakai link ini**. Kalau file dibuat di luar folder induk yang sudah dibagikan (langkah F7), bagikan dulu ke email service account.

## Cara kerja per orang

| Nama | Blok | Yang diisi |
|---|---|---|
| Fitria Azzahra Kurnia | CONTENT (A:K) | Mulai versi 1.4: klik **Ambil postingan baru** (dari Instagram), isi nama konten dan pillar. Angka konten lama diperbarui otomatis tiap 4 jam. Cadangan: tarik file bulk ABT (.xlsx). Konten lama hanya diperbarui angkanya. Untuk konten baru, isi nama konten sendiri (caption ABT ditampilkan sebagai acuan) dan pilih pillar. Ada input manual untuk konten yang metriknya tidak terbaca ABT. |
| Athallah Aqil Sukendar | DESIGN (N:Q) | Bisa banyak sekaligus. **Import dari Excel**: tanggal dan informasi detil terisi otomatis dari file Excel (format sama dengan blok DESIGN), baris yang sudah ada di sheet dilewati, lalu tinggal tambah gambar per baris. Bisa juga tarik beberapa SS sekaligus (mengisi baris yang belum punya gambar, urut dari atas) atau klik "+ Tambah inputan". Ada tombol untuk mengirim baris yang sudah ada gambarnya saja. |
| Muhammad Albar | VIDEO (S:V) | Sama seperti DESIGN, termasuk Import dari Excel. Per input bisa tempel link video, lalu SS diambil otomatis, atau tarik SS manual. Link ditulis di kolom Informasi Detil karena blok VIDEO tidak punya kolom link. |
| Rifqi Firega | AIGC (AH:AK) | Tanggal, jumlah produksi, jumlah upload. Tanggal yang sama dikirim ulang akan ditimpa. |
| Ray Sangkhylang | Lead | Melihat semua request dan memutuskan Approve, Pending, atau Reject. Tab **Dashboard**: angka KPI per orang, kapan terakhir input, jumlah request per status, dan aktivitas terbaru dari widget. |

## Alur EP dan Content Calendar (versi 1.2)

- **Tab EP** (semua akun): daftar konten dari Google Slides EP bulan ini, per akun AAB atau NUSANTARA, dengan filter Minggu ini, Menunggu, Revisi, Semua. Klik satu konten untuk melihat **screenshot slide utuh** (termasuk reference dan desain). Klik gambarnya untuk memperbesar, Esc untuk menutup.
- **Approval EP pindah ke widget.** Ray membuka konten lalu klik **OKE**, atau **Revisi** dengan catatan. Tim langsung melihat statusnya dan mendapat pop-up. Komentar di Slides tidak dipakai lagi untuk approval. Isi EP tetap ditulis di Slides.
- **POSTED** (Zahra atau Ray): buka konten di tab EP → isi link post → pilih baris Content Calendar (sudah dipilihkan otomatis kalau tanggal dan judulnya cocok) → **Tandai POSTED**. Widget menempel stempel POSTED di slide dengan gaya yang sama seperti stempel yang sudah ada, mencentang POSTING, dan mengisi Link Post di kalender. Stempel POSTED yang ditempel manual di Slides tetap terbaca.
- **Tab Kalender** (Zahra dan Ray): isi Content Calendar per akun. **+ Tambah ke kalender** untuk konten baru atau hari **No posting**. Klik judul untuk mengubah. Tombol Take, Edit, Post langsung mencentang TAKE, EDITING, POSTING di sheet. Baris baru masuk ke baris kosong pertama di bawah baris terakhir, kolom nomor (#) dan rumus di sheet tidak disentuh.
- **Dashboard Ray** menampilkan content plan minggu ini (sudah posting dari total, dan yang lewat tanggal) serta jumlah EP menunggu, revisi, dan posted.

## Alur request creative

1. Divisi lain mengisi tab REQUEST CREATIVE seperti biasa.
2. Request yang kolom G (Remark Creative) masih kosong hanya muncul di widget Ray, dengan label "Belum diputuskan". Ray mendapat pop-up untuk request ini.
3. Ray membuka request, lalu memilih **Approve**, **Pending**, atau **Reject**. Pilihan ditulis ke kolom G.
   - **Approve:** request muncul di widget tim, dan tim mendapat pop-up paling lambat 10 menit kemudian.
   - **Pending** dan **Reject:** request tidak muncul di widget tim. Tetap terlihat di widget Ray (filter Pending atau Reject) dan keputusannya bisa diubah kapan saja.
   - Kalau Ray mengubah keputusan request yang sudah di-approve, request itu hilang lagi dari widget tim.
4. Setelah selesai, tim menempel link output lalu klik **Tandai selesai**. Link masuk ke kolom Output dan PROGRESS menjadi DONE. Output hanya bisa berupa link.

## Berhenti memakai

- **Sementara:** nonaktifkan app di Lark Developer.
- **Satu orang:** nonaktifkan atau hapus akunnya di Kelola akun tim.
- **Permanen:** uninstall Creative AAB di tiap laptop (Settings → Apps), hapus Worker di Cloudflare, dan hapus app di Lark Developer.

Data yang sudah masuk ke sheet tetap ada.

## Kalau ada masalah

| Pesan | Penyebab dan solusi |
|---|---|
| "Username atau password salah" | Cek ejaan. Minta Ray reset password kalau lupa. |
| "Sesi habis. Login lagi." | Ray mereset password atau menonaktifkan akun itu. Login dengan password terbaru. |
| "Akun kamu tidak punya akses ke fitur ini" | Akun terhubung ke anggota yang salah. Ray hapus lalu buat ulang akunnya. |
| "Google menolak akses (403/404). Bagikan file ini sebagai Editor ke ..." | File belum dibagikan ke service account. Ulangi langkah F7 untuk file itu. |
| "Akses Google belum diatur di server (secret GOOGLE_SA kosong)" | Langkah F5 belum dilakukan, atau Worker belum di-Deploy ulang. |
| "Login ke Google gagal" | Isi `GOOGLE_SA` tidak lengkap. Tempel ulang seluruh isi file JSON. |
| "Tidak ada tab content plan di file ini" | Link yang ditempel bukan file Content Calendar, atau header baris 3 berubah (# , Content Pillar, Format, Platform, Content, Date). |
| "Token Instagram ditolak" atau Insight menampilkan "Sinkron terakhir gagal" | Token salah salin, dicabut, atau password IG diganti. Buat token baru (langkah G5) dan tempel lagi di Pengaturan. |
| "Ambil postingan baru" kosong padahal ada post baru | Daftar postingan diambil tiap 30 menit. Ray bisa klik **Sinkron sekarang** di Insight Instagram, lalu coba lagi. |
| "Cek pembaruan gagal" | Biasanya internet. Kalau terus muncul, unduh installer terbaru dari halaman Releases dan pasang di atas versi lama. |
| "Login ke Lark gagal" | App ID atau App Secret di Cloudflare salah, atau app belum di-publish (langkah A4). |
| "Lark menolak … App belum punya akses ke file ini" | Ulangi langkah B1 untuk file bulan ini. |
| "Blok AIGC (AH:AK) belum ada" | Buat blok sesuai langkah B2, lalu klik **Pakai file ini** lagi. |
| "Worker exceeded CPU" saat kirim gambar | Gambar terlalu berat untuk paket gratis Cloudflare. Coba kirim SS yang lebih kecil. Kalau sering terjadi, kabari untuk disesuaikan. |
| SS otomatis Albar gagal atau isinya halaman login | Link private. Ubah akses link jadi "siapa pun dengan link", atau tarik SS manual. |
