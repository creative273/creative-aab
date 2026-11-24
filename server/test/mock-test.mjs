// Uji server dengan Lark tiruan (tidak memanggil Lark asli).
import worker, { parseRequests, shortcode, normalizeContent, parseSpreadsheetToken, colIndex, normDate } from "../worker.js";
import assert from "node:assert/strict";

const SHEET = "PSUosgLcFh58JftjSZclS4FwgLe";
const REPORT = "DkyyeC";
const REQ = "0x35bD";

// Grid tiruan: { sheetId: { "A1": value } }
const grid = { [REPORT]: {}, [REQ]: {} };
const images = [];
const calls = [];
const letters = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const set = (sid, cell, v) => { grid[sid][cell] = v; };
const parseRange = (r) => { const [sid, a] = r.split("!"); const [s, e] = a.split(":"); const p = (x) => { const m = x.match(/^([A-Z]+)(\d+)$/); return { c: colIndex(m[1]), r: +m[2] }; }; return { sid, s: p(s), e: p(e || s) }; };
const read = (range) => { const { sid, s, e } = parseRange(range); const rows = []; for (let r = s.r; r <= e.r; r++) { const row = []; for (let c = s.c; c <= e.c; c++) row.push(grid[sid][letters(c) + r] ?? null); rows.push(row); } return rows; };
const write = (range, values) => { const { sid, s } = parseRange(range); values.forEach((row, i) => row.forEach((v, j) => set(sid, letters(s.c + j) + (s.r + i), v))); };

// Isi awal mirip sheet asli
["No","Tanggal Upload","Account","Content Pillar","Konten","Kategori","Link Content","Total Views","Total Likes","Total Comment","Total Share & Save"].forEach((h,i)=>set(REPORT, letters(1+i)+"5", h));
set(REPORT,"N5","No");set(REPORT,"O5","Tanggal");set(REPORT,"P5","Informasi Detil");set(REPORT,"Q5","Hasil Design (attachment file design/picture)");
set(REPORT,"S5","No");set(REPORT,"T5","Tanggal");set(REPORT,"U5","Informasi Detil");set(REPORT,"V5","Hasil Video (attachment screenshot)");
set(REPORT,"AH5","No");set(REPORT,"AI5","Tanggal");set(REPORT,"AJ5","Jumlah Produksi");set(REPORT,"AK5","Jumlah Upload");
for (let i=0;i<46;i++) set(REPORT,"A"+(6+i), i+1); // No sudah terisi
write(`${REPORT}!A6:K7`, [[1,"11/2/2026","AAB","Entertainment","Kata Terlarang Pas Live","Reels/VT","https://www.instagram.com/p/DfPH3bSB2uY/",1160,19,2,0],[2,"11/3/2026","AAB","Education","Cara Pakai TAP Link AAB","Reels/VT","https://www.instagram.com/p/DfRrmSWhcG-/",629,9,0,0]]);
write(`${REPORT}!N6:P7`, [[1,"25/10/2026","REGIS PRINT A5"],[2,"26/10/2026","QCARD"]]);
set(REPORT,"G4",2);set(REPORT,"O4",2);set(REPORT,"T4",0);
write(`${REQ}!A2:I4`, [[1,"04 November 2026","WIDI","Request logo plang","13 November 2026","link",null,"DONE",null],[2,"04 November 2026","RERE","PPT TikTok One",null,null,null,"PENDING",null],[3,"5-Nov-26","REFLY","Sticker 11.11",null,null,null,null,null]]);
write(`${REQ}!A5:A20`, Array.from({length:16},(_,i)=>[4+i]));

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push(`${opts.method || "GET"} ${u.pathname}`);
  const ok = (data) => new Response(JSON.stringify({ code: 0, msg: "success", data }));
  if (u.pathname.endsWith("/tenant_access_token/internal")) {
    assert.equal(body.app_id, "cli_test");
    return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-123", expire: 7200 }));
  }
  assert.equal(opts.headers.Authorization, "Bearer t-123");
  if (u.pathname.endsWith("/sheets/query")) return ok({ sheets: [{ sheet_id: "x1", title: "KPI NOVEMBER 2026" }, { sheet_id: REPORT, title: "Creative Report Analytic" }, { sheet_id: REQ, title: "REQUEST CREATIVE" }] });
  if (u.pathname.endsWith("/values_batch_get")) {
    const ranges = u.searchParams.get("ranges").split(",");
    return ok({ valueRanges: ranges.map((r) => ({ range: r, values: read(r) })) });
  }
  if (u.pathname.endsWith("/values_batch_update")) { body.valueRanges.forEach((vr) => write(vr.range, vr.values)); return ok({}); }
  if (u.pathname.endsWith("/values_image")) { images.push({ range: body.range, size: body.image.length, name: body.name }); write(body.range.split(":")[0], [["[gambar]"]]); return ok({ spreadsheetToken: SHEET }); }
  throw new Error("Endpoint tiruan tidak dikenal: " + u.pathname);
};

const kv = new Map();
const env = {
  LARK_APP_ID: "cli_test", LARK_APP_SECRET: "secret", ADMIN_PASSWORD: "admin-rahasia-123",
  STORE: { get: async (k, t) => { const v = kv.get(k); return v === undefined ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
};
let TOK = "";
const call = async (method, path, body, token = TOK) => {
  const res = await worker.fetch(new Request("https://x.workers.dev" + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, {});
  return { status: res.status, data: await res.json() };
};

// 1. Helper
assert.equal(shortcode("https://www.instagram.com/reel/DfPH3bSB2uY/"), "DfPH3bSB2uY");
assert.equal(shortcode('=HYPERLINK("https://www.instagram.com/p/DfRrmSWhcG-/")'), "DfRrmSWhcG-");
assert.equal(shortcode("https://www.instagram.com/agensianakbangsa/reel/DfW2tV_N6SF/?x=1"), "DfW2tV_N6SF");
assert.equal(parseSpreadsheetToken("https://ksgffdqboz2b.sg.larksuite.com/sheets/PSUosgLcFh58JftjSZclS4FwgLe?sheet=DkyyeC"), SHEET);
assert.equal(colIndex("AK"), 37);

// 2. Login: tanpa token ditolak, ray pakai ADMIN_PASSWORD, password salah ditolak
assert.equal((await call("GET", "/api/state", null, "salah")).status, 401);
assert.equal((await call("POST", "/api/login", { username: "ray", password: "salah-banget" })).status, 401);
let lg = await call("POST", "/api/login", { username: "Ray", password: "admin-rahasia-123" });
assert.equal(lg.status, 200, JSON.stringify(lg.data));
assert.equal(lg.data.user.block, "lead");
TOK = lg.data.token;
const rayAdminTok = TOK;
// token dirusak ditolak
assert.equal((await call("GET", "/api/state", null, TOK.slice(0, -2) + "xx")).status, 401);
// Ray ganti password, token lama mati
let pw = await call("POST", "/api/password", { old: "admin-rahasia-123", password: "ray-baru-456" });
assert.equal(pw.status, 200);
assert.equal((await call("GET", "/api/me", null, rayAdminTok)).status, 401, "token lama harus mati setelah ganti password");
TOK = pw.data.token;
assert.equal((await call("GET", "/api/me")).data.user.username, "ray");
// ADMIN_PASSWORD tetap bisa (pemulihan)
assert.equal((await call("POST", "/api/login", { username: "ray", password: "admin-rahasia-123" })).status, 200);
assert.equal((await call("POST", "/api/login", { username: "ray", password: "ray-baru-456" })).status, 200);
// Buat akun tim
const mk = async (username, member, password = "pass-" + username) => (await call("POST", "/api/accounts/save", { username, member, password }));
for (const [u, m] of [["zahra", "fitria"], ["aqil", "athallah"], ["albar", "albar"], ["rifqi", "rifqi"]]) assert.equal((await mk(u, m)).status, 200);
assert.equal((await mk("zahra2", "fitria")).status, 400, "satu anggota satu akun");
assert.equal((await mk("bos", "ray")).status, 400, "slot Ray hanya untuk akun ray");
assert.equal((await mk("ab", "rifqi", "12345678")).status, 400, "username terlalu pendek");
assert.equal((await call("POST", "/api/accounts/save", { username: "budi", member: "rifqi", password: "pendek" })).status, 400);
const T = {};
for (const u of ["zahra", "aqil", "albar", "rifqi"]) {
  const x = await call("POST", "/api/login", { username: u, password: "pass-" + u });
  assert.equal(x.status, 200, u); T[u] = x.data.token;
}
assert.equal((await call("GET", "/api/accounts", null, T.zahra)).status, 403, "tim tidak bisa lihat akun");
assert.equal((await call("POST", "/api/accounts/save", { username: "zahra", member: "fitria", password: "hackhack" }, T.aqil)).status, 403);
// Lockout setelah 5 kali salah
for (let i = 0; i < 5; i++) await call("POST", "/api/login", { username: "albar", password: "salah-salah" });
assert.equal((await call("POST", "/api/login", { username: "albar", password: "pass-albar" })).status, 429);
kv.delete("fail:albar");

// 3. Belum dikonfigurasi
let r = await call("GET", "/api/state");
assert.equal(r.data.configured, false);

// 4. Simpan link
r = await call("POST", "/api/config", { url: "https://ksgffdqboz2b.sg.larksuite.com/sheets/PSUosgLcFh58JftjSZclS4FwgLe?sheet=DkyyeC" });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.deepEqual(r.data.warnings, []);
assert.equal(r.data.requests.length, 3);
assert.deepEqual(r.data.requests.map((x) => x.status), ["done", "pending", "new"]);
assert.equal(r.data.counts.content, 2);

// 5. Preview dan submit konten (1 lama + 1 baru)
const rows = [
  { link: "https://www.instagram.com/reel/DfPH3bSB2uY/", tanggal: "11/2/2026", account: "AAB", konten: "caption lama", kategori: "Reels/VT", views: 1200, likes: 20, comments: 3, shares: 1 },
  { link: "https://www.instagram.com/reel/DfZZZnewone/", tanggal: "11/24/2026", account: "NUSANTARA", konten: "caption baru", kategori: "Carousel", views: 50, likes: 5, comments: 0, shares: 0 },
];
r = await call("POST", "/api/kpi/content/preview", { rows });
assert.deepEqual(r.data.rows.map((x) => x.exists), [true, false]);
assert.equal(r.data.rows[0].sheetKonten, "Kata Terlarang Pas Live");
r = await call("POST", "/api/kpi/content/submit", { rows });
assert.equal(r.status, 400, "konten baru tanpa pillar harus ditolak");
rows[1].pillar = "Education";
r = await call("POST", "/api/kpi/content/submit", { rows });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.deepEqual([r.data.updated, r.data.added], [1, 1]);
assert.deepEqual(read(`${REPORT}!E6:K6`)[0], ["Kata Terlarang Pas Live", "Reels/VT", "https://www.instagram.com/p/DfPH3bSB2uY/", 1200, 20, 3, 1], "konten lama: judul tetap, angka diperbarui");
assert.deepEqual(read(`${REPORT}!A8:K8`)[0], [3, "11/24/2026", "NUSANTARA", "Education", "caption baru", "Carousel", "https://www.instagram.com/p/DfZZZnewone/", 50, 5, 0, 0]);
// kirim ulang tidak menggandakan
r = await call("POST", "/api/kpi/content/submit", { rows });
assert.deepEqual([r.data.updated, r.data.added], [2, 0]);

// 6. Design
const img = Buffer.from("fakejpegdata").toString("base64");
r = await call("POST", "/api/kpi/design", { tanggal: "24/11/2026", info: "Poster webinar", image: img });
assert.equal(r.data.row, 8);
assert.deepEqual(read(`${REPORT}!N8:Q8`)[0], [3, "24/11/2026", "Poster webinar", "[gambar]"]);
assert.equal(images.at(-1).range, `${REPORT}!Q8:Q8`);

// 6b. Preview Excel design
assert.equal(normDate("25/10/2026"), "2026-10-25");
assert.equal(normDate("30 okt 26"), "2026-10-30");
assert.equal(normDate("2026-10-01"), "2026-10-1");
r = await call("POST", "/api/kpi/design/preview", { rows: [{ tanggal: "25/10/2026", info: "regis print a5" }, { tanggal: "24/11/2026", info: "Poster webinar" }, { tanggal: "1/10/2026", info: "Update Deck" }] });
assert.deepEqual(r.data.rows.map((x) => x.exists), [true, true, false]);

// 7. Video dengan link
r = await call("POST", "/api/kpi/video", { tanggal: "24/11/2026", info: "reels", link: "https://www.tiktok.com/@aab/video/1", image: img });
assert.equal(r.data.row, 6);
assert.deepEqual(read(`${REPORT}!S6:V6`)[0], [1, "24/11/2026", "reels https://www.tiktok.com/@aab/video/1", "[gambar]"]);

// 8. AIGC: tambah lalu timpa tanggal yang sama
r = await call("POST", "/api/kpi/aigc", { tanggal: "24/11/2026", produksi: 10, upload: 8 });
assert.deepEqual([r.data.row, r.data.replaced], [6, false]);
r = await call("POST", "/api/kpi/aigc", { tanggal: "24/11/2026", produksi: 12, upload: 9 });
assert.deepEqual([r.data.row, r.data.replaced], [6, true]);
r = await call("POST", "/api/kpi/aigc", { tanggal: "25/11/2026", produksi: 5, upload: 5 });
assert.equal(r.data.row, 7);
assert.deepEqual(read(`${REPORT}!AH6:AK7`), [[1, "24/11/2026", 12, 9], [2, "25/11/2026", 5, 5]]);

// 9. Request selesai: id salah ditolak, id benar berhasil
r = await call("GET", "/api/state");
const reqNew = r.data.requests.find((x) => x.status === "new");
r = await call("POST", "/api/request/done", { row: reqNew.row, id: "4:salah", link: "https://canva.link/x" });
assert.equal(r.status, 409);
r = await call("POST", "/api/request/done", { row: reqNew.row, id: reqNew.id, link: "https://canva.link/x" });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.deepEqual(read(`${REQ}!F4:H4`)[0], ["https://canva.link/x", null, "DONE"]);
r = await call("POST", "/api/request/done", { row: reqNew.row, id: reqNew.id, link: "bukan-link" });
assert.equal(r.status, 400, "output harus link");
// approve
r = await call("GET", "/api/state");
const pend = r.data.requests.find((x) => x.status === "pending");
assert.equal(pend.approved, false);
r = await call("POST", "/api/request/decision", { row: pend.row, id: pend.id, decision: "APPROVE" });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(read(`${REQ}!G3:G3`)[0][0], "APPROVE");
r = await call("GET", "/api/state");
assert.equal(r.data.requests.find((x) => x.id === pend.id).approved, true);
r = await call("POST", "/api/request/decision", { row: pend.row, id: pend.id, decision: "REJECT" });
assert.equal(read(`${REQ}!G3:G3`)[0][0], "REJECT");
r = await call("GET", "/api/state");
let pr = r.data.requests.find((x) => x.id === pend.id);
assert.deepEqual([pr.decision, pr.approved], ["REJECT", false]);
r = await call("POST", "/api/request/decision", { row: pend.row, id: pend.id, decision: "PENDING" });
r = await call("GET", "/api/state");
pr = r.data.requests.find((x) => x.id === pend.id);
assert.deepEqual([pr.decision, pr.approved], ["PENDING", false]);
r = await call("POST", "/api/request/decision", { row: pend.row, id: pend.id, decision: "HAPUS" });
assert.equal(r.status, 400);

// 10. Refresh cooldown: tidak memanggil Lark lagi dalam 1 menit
const before = calls.length;
r = await call("POST", "/api/refresh");
assert.ok(r.data.note);
assert.equal(calls.length, before);

// 11. Blok AIGC belum ada -> peringatan
delete grid[REPORT]["AJ5"]; delete grid[REPORT]["AK5"];
r = await call("POST", "/api/config", { url: "https://x.larksuite.com/sheets/PSUosgLcFh58JftjSZclS4FwgLe" });
assert.equal(r.data.warnings.length, 1);
r = await call("POST", "/api/kpi/aigc", { tanggal: "26/11/2026", produksi: 1, upload: 1 });
assert.equal(r.status, 400);

// 12. Cron
await worker.scheduled({}, env, { waitUntil: (p) => p });

// 13. Role: tiap akun hanya blok miliknya
const deny = async (tok, path, body) => assert.equal((await call("POST", path, body, tok)).status, 403, path);
await deny(T.aqil, "/api/kpi/content/submit", { rows });
await deny(T.zahra, "/api/kpi/design", { tanggal: "1/1/2026", info: "x", image: img });
await deny(T.zahra, "/api/kpi/video", { tanggal: "1/1/2026", info: "x", image: img });
await deny(T.albar, "/api/kpi/aigc", { tanggal: "1/1/2026", produksi: 1, upload: 1 });
await deny(T.rifqi, "/api/request/decision", { row: 2, id: "x", decision: "APPROVE" });
await deny(T.rifqi, "/api/config", { url: "https://x.larksuite.com/sheets/abc" });
assert.equal((await call("GET", "/api/dashboard", null, T.zahra)).status, 403);
// Aqil boleh design
r = await call("POST", "/api/kpi/design", { tanggal: "25/11/2026", info: "Banner 12.12", image: img }, T.aqil);
assert.equal(r.status, 200, JSON.stringify(r.data));
// Tim hanya melihat request APPROVE
r = await call("GET", "/api/state", null, T.zahra);
assert.ok(r.data.requests.every((x) => x.approved), "tim hanya dapat request approve");
const rayState = await call("GET", "/api/state");
assert.ok(rayState.data.requests.length > r.data.requests.length);
assert.equal((await call("POST", "/api/refresh", {}, T.zahra)).status, 403, "refresh hanya Ray");

// 14. Dashboard Ray
r = await call("GET", "/api/dashboard");
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.accounts.length, 5);
assert.ok(r.data.activity.some((a) => a.who === "aqil" && a.text.includes("Banner 12.12")));
assert.ok(r.data.last.athallah);
assert.equal(typeof r.data.requests.needDecision, "number");
assert.ok(!JSON.stringify(r.data).includes('"hash"'), "hash password tidak boleh bocor");
assert.ok(!JSON.stringify((await call("GET", "/api/accounts")).data).includes('"salt"'));

// 15. Nonaktifkan dan reset: sesi lama keluar
assert.equal((await call("POST", "/api/accounts/save", { username: "rifqi", active: false })).status, 200);
assert.equal((await call("GET", "/api/me", null, T.rifqi)).status, 401);
assert.equal((await call("POST", "/api/login", { username: "rifqi", password: "pass-rifqi" })).status, 401);
assert.equal((await call("POST", "/api/accounts/save", { username: "rifqi", active: true, password: "rifqi-baru-1" })).status, 200);
assert.equal((await call("POST", "/api/login", { username: "rifqi", password: "rifqi-baru-1" })).status, 200);
assert.equal((await call("POST", "/api/accounts/save", { username: "ray", active: false })).status, 400);
assert.equal((await call("POST", "/api/accounts/delete", { username: "ray" })).status, 400);
assert.equal((await call("POST", "/api/accounts/delete", { username: "albar" })).status, 200);
assert.equal((await call("GET", "/api/me", null, T.albar)).status, 401);

console.log("SEMUA TES LULUS. Panggilan Lark tiruan:", calls.length);
