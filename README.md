# Creative AAB

Widget Windows tim creative Agensi Anak Bangsa: input KPI ke sheet Lark, request creative, dan dashboard lead.

- `widget/`: aplikasi Electron. Installer dan update otomatis dari GitHub Releases repo ini.
- `server/worker.js`: server Cloudflare Worker. Rahasia (App Secret Lark, password admin) hanya disimpan di Cloudflare, tidak di repo.

Rilis baru: naikkan `version` di `widget/package.json` lalu push ke `main`. GitHub Actions membangun installer dan menerbitkannya sebagai rilis `vX.Y.Z`. Versi yang sudah dirilis tidak dibangun ulang.
