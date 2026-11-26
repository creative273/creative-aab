// Menyalin isi folder mobile/ ke dalam worker.js (antara MOBILE-START dan MOBILE-END),
// supaya versi HP ikut tersaji dari Worker yang sama tanpa hosting terpisah.
// Jalankan: node server/build-mobile.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "mobile");
const workerPath = path.join(here, "worker.js");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const files = {};
for (const name of fs.readdirSync(dir).sort()) {
  const ext = path.extname(name);
  if (!TYPES[ext]) continue;
  const buf = fs.readFileSync(path.join(dir, name));
  files[name] = ext === ".png" ? { type: TYPES[ext], b64: true, data: buf.toString("base64") } : { type: TYPES[ext], data: buf.toString("utf8") };
}
// Penanda versi untuk app.js dan style.css supaya HP tidak memakai salinan lama.
const crypto = await import("node:crypto");
const ver = crypto.createHash("sha1").update(files["app.js"].data + files["style.css"].data).digest("hex").slice(0, 8);
files["index.html"].data = files["index.html"].data.replaceAll("__V__", ver);
const src = fs.readFileSync(workerPath, "utf8");
const start = src.indexOf("// MOBILE-START"), end = src.indexOf("// MOBILE-END");
if (start < 0 || end < 0) throw new Error("Penanda MOBILE-START/MOBILE-END tidak ada di worker.js");
const out = `${src.slice(0, start)}// MOBILE-START\nconst MOBILE_FILES = ${JSON.stringify(files)};\n${src.slice(end)}`;
fs.writeFileSync(workerPath, out);
console.log(`Versi HP disalin: ${Object.keys(files).join(", ")} (${Math.round(out.length / 1024)} KB worker.js)`);
