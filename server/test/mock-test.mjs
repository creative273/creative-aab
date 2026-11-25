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

// Instagram tiruan (v1.4)
const igCalls = [];
const NOWS = Date.now();
const iso = (msAgo) => new Date(NOWS - msAgo).toISOString().replace(/\.\d+Z$/, "+0000");
const IG = {
  "tok-aab-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { id: "1781", username: "agensianakbangsa", followers: 19400,
    media: [
      { id: "m1", shortcode: "DfPH3bSB2uY", media_type: "VIDEO", media_product_type: "REELS", ago: 3 * 864e5, views: 1300, reach: 1100, likes: 21, comments: 3, shares: 1, saved: 2 },
      { id: "m2", shortcode: "DgNEWaaaaa1", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", ago: 864e5, views: null, reach: 500, likes: 30, comments: 4, shares: 2, saved: 5 },
      { id: "m3", shortcode: "DgCOLLAB001", media_type: "VIDEO", media_product_type: "REELS", ago: 2 * 864e5, views: 800, reach: 700, likes: 10, comments: 1, shares: 0, saved: 0 },
      { id: "m4", shortcode: "DgLASTMONTH", media_type: "VIDEO", media_product_type: "REELS", ago: 40 * 864e5, views: 90, reach: 80, likes: 1, comments: 0, shares: 0, saved: 0 },
    ] },
  "tok-nus-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": { id: "1782", username: "nusantara.mcn", followers: 6452,
    media: [{ id: "m3", shortcode: "DgCOLLAB001", media_type: "VIDEO", media_product_type: "REELS", ago: 2 * 864e5, views: 800, reach: 700, likes: 10, comments: 1, shares: 0, saved: 0 }] },
};
IG["tok-big-gggggggggggggggggggggggggggggggggggggggggggg"] = { id: "1799", username: "nusantara.mcn", followers: 6452,
  media: Array.from({ length: 30 }, (_, i) => ({ id: "b" + i, shortcode: "DgBIG" + String(i).padStart(6, "0"), media_type: i % 5 ? "VIDEO" : "CAROUSEL_ALBUM", media_product_type: i % 5 ? "REELS" : "FEED", ago: (1 + i * 0.7) * 864e5, views: 100 + i, reach: 90 + i, likes: i, comments: 1, shares: 0, saved: 0, broken: i === 2 })) };
function igMock(u) {
  const tok = u.searchParams.get("access_token");
  igCalls.push(u.pathname);
  const acc = IG[tok];
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  const err = (m) => new Response(JSON.stringify({ error: { message: m, code: 190 } }), { status: 400 });
  if (u.pathname === "/refresh_access_token") return acc ? ok({ access_token: tok, expires_in: 5184000 }) : err("Invalid OAuth access token");
  if (!acc) return err("Invalid OAuth access token - Cannot parse access token");
  assert.ok(u.pathname.startsWith("/v25.0/"), u.pathname);
  const path = u.pathname.slice(7);
  if (path === "me") return ok({ user_id: acc.id, id: acc.id, username: acc.username, account_type: "MEDIA_CREATOR", followers_count: acc.followers, media_count: 197 });
  if (path === "me/media") return ok({ data: acc.media.map((m) => ({ id: m.id, shortcode: m.shortcode, media_type: m.media_type, media_product_type: m.media_product_type, permalink: `https://www.instagram.com/reel/${m.shortcode}/`, caption: "Caption " + m.id, timestamp: iso(m.ago), like_count: m.likes, comments_count: m.comments })) });
  if (path === "me/insights") { assert.equal(u.searchParams.get("metric_type"), "total_value"); return ok({ data: [{ name: "views", total_value: { value: 900 } }, { name: "reach", total_value: { value: 600 } }, { name: "total_interactions", total_value: { value: 40 } }, { name: "accounts_engaged", total_value: { value: 30 } }] }); }
  const mm = path.match(/^(\w+)\/insights$/);
  if (mm) {
    const m = acc.media.find((x) => x.id === mm[1]);
    if (m.broken) return new Response(JSON.stringify({ error: { message: "(#10) Media posted before business conversion", code: 10 } }), { status: 400 });
    const metrics = u.searchParams.get("metric").split(",");
    if (metrics.includes("views") && m.views === null) return new Response(JSON.stringify({ error: { message: "(#100) metric views not supported", code: 100 } }), { status: 400 });
    return ok({ data: metrics.map((k) => ({ name: k, period: "lifetime", values: [{ value: m[k] }] })) });
  }
  return err("unknown " + path);
}

// Token Login Terpadu (EAA) lewat graph.facebook.com: diterjemahkan ke data IG tiruan di atas.
const FB = {
  "EAAaab-ddddddddddddddddddddddddddddddddddddddddddddd": { ids: { "17841471637263858": "tok-aab-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, pages: [] },
  "EAAbig-hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh": { ids: { "17841474840408535": "tok-big-gggggggggggggggggggggggggggggggggggggggggggg" }, pages: [] },
  "EAApage-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": { ids: { "555": "tok-nus-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, pages: [{ id: "p1", instagram_business_account: { id: "555", username: "nusantara.mcn" } }] },
};
const fbCalls = [];
function fbMock(u) {
  const tok = u.searchParams.get("access_token");
  fbCalls.push(u.pathname);
  const acc = FB[tok];
  if (!acc) return new Response(JSON.stringify({ error: { message: "Invalid OAuth access token - Cannot parse access token", code: 190 } }), { status: 400 });
  assert.ok(u.pathname.startsWith("/v25.0/"), u.pathname);
  const parts = u.pathname.slice(7).split("/");
  if (parts[0] === "me" && parts[1] === "accounts") return new Response(JSON.stringify({ data: acc.pages }));
  if (parts[0] === "me") return new Response(JSON.stringify({ error: { message: "(#100) Tried accessing nonexisting field", code: 100 } }), { status: 400 });
  const igTok = acc.ids[parts[0]];
  const known = Object.values(IG).some((a) => a.id === parts[0] || a.media.some((m) => m.id === parts[0]));
  if (!igTok && /^\d{6,}$/.test(parts[0]) || (!igTok && !known)) return new Response(JSON.stringify({ error: { message: "(#100) Object does not exist or missing permissions", code: 100 } }), { status: 400 });
  const x = new URL(u.toString().replace("graph.facebook.com", "graph.instagram.com"));
  x.pathname = "/v25.0/" + (igTok ? ["me", ...parts.slice(1)] : parts).join("/");
  x.searchParams.set("access_token", igTok || Object.values(acc.ids)[0]);
  if (igTok && parts.length === 1) x.searchParams.set("fields", "user_id,username,followers_count,media_count");
  return Promise.resolve(igMock(x)).then(async (res) => {
    if (!(igTok && parts.length === 1)) return res;
    const d = await res.json(); d.id = parts[0]; delete d.user_id; return new Response(JSON.stringify(d));
  });
}

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.host === "graph.instagram.com") return igMock(u);
  if (u.host === "graph.facebook.com") return fbMock(u);
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

// 13b. Data harian untuk grafik (v1.3)
await call("POST", "/api/refresh", {});
r = await call("GET", "/api/state", null, T.aqil);
assert.ok(r.data.daily && r.data.daily.design["2026-11-25"] >= 1, JSON.stringify(r.data.daily));
assert.ok(Array.isArray(r.data.team) && r.data.team.some((t) => t.username === "aqil"));
assert.ok(!JSON.stringify(r.data.team).includes('"hash"'));
// Foto profil
const tiny = "data:image/jpeg;base64," + Buffer.from("fotokecil").toString("base64");
assert.equal((await call("POST", "/api/me/photo", { image: "javascript:alert(1)" }, T.aqil)).status, 400);
assert.equal((await call("POST", "/api/me/photo", { image: "data:image/jpeg;base64," + "A".repeat(90000) }, T.aqil)).status, 400);
r = await call("POST", "/api/me/photo", { image: tiny }, T.aqil);
assert.equal(r.status, 200);
r = await call("GET", "/api/state", null, T.zahra);
assert.ok(r.data.team.find((t) => t.username === "aqil").photoVer > 0, "tim lihat versi foto Aqil");
r = await call("GET", "/api/photos", null, T.zahra);
assert.equal(r.data.photos.aqil.image, tiny);
assert.equal((await call("GET", "/api/me", null, T.aqil)).status, 200, "ganti foto tidak mengeluarkan sesi");
await call("POST", "/api/me/photo", { image: "" }, T.aqil);
r = await call("GET", "/api/photos", null, T.zahra);
assert.equal(r.data.photos.aqil, undefined);

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

// 16. Instagram (v1.4)
const TAAB = "tok-aab-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TNUS = "tok-nus-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
assert.equal((await call("POST", "/api/ig/connect", { account: "AAB", token: TAAB }, T.zahra)).status, 403, "hanya Ray yang hubungkan IG");
assert.equal((await call("POST", "/api/ig/connect", { account: "AAB", token: "pendek" })).status, 400);
r = await call("POST", "/api/ig/connect", { account: "AAB", token: "tok-salah-cccccccccccccccccccccccccccccccccccccccccccc" });
assert.equal(r.status, 409);
assert.match(r.data.error, /Instagram/);
r = await call("POST", "/api/ig/connect", { account: "AAB", token: TAAB });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.username, "agensianakbangsa");
r = await call("POST", "/api/ig/connect", { account: "NUSANTARA", token: TAAB });
assert.equal(r.status, 400, "token yang sama tidak boleh dipakai dua akun");
assert.equal((await call("POST", "/api/ig/connect", { account: "NUSANTARA", token: TNUS })).status, 200);
// Tim boleh lihat insight, token tidak pernah ikut terkirim
r = await call("GET", "/api/ig", null, T.aqil);
assert.equal(r.status, 200);
assert.ok(!JSON.stringify(r.data).includes("tok-"), "token tidak boleh bocor");
const aab = r.data.accounts.AAB;
assert.equal(aab.followers, 19400);
assert.equal(aab.media.length, 4, "konten 60 hari tetap tampil di Insight");
const car = aab.media.find((m) => m.id === "m2");
assert.equal(car.views, null, "carousel tanpa views tetap tersimpan");
assert.equal(car.saved, 5);
assert.equal(aab.media.find((m) => m.id === "m1").views, 1300);
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
assert.equal(aab.daily[today].views, 900);
assert.equal(aab.daily[today].followers, 19400);
// Blok CONTENT terisi otomatis untuk konten yang sudah ada (shortcode DfPH3bSB2uY di baris 6)
r = await call("POST", "/api/ig/sync", {});
assert.equal(r.status, 200);
assert.deepEqual(read(`${REPORT}!H6:K6`)[0], [1300, 21, 3, 3], "views, likes, comments, share+save");
assert.equal((await call("POST", "/api/ig/sync", {}, T.zahra)).status, 403);
// Zahra: konten IG yang belum ada di sheet
assert.equal((await call("GET", "/api/ig/new", null, T.aqil)).status, 403);
r = await call("GET", "/api/ig/new", null, T.zahra);
assert.equal(r.status, 200, JSON.stringify(r.data));
const codes = r.data.items.map((x) => x.code);
assert.ok(!codes.includes("DfPH3bSB2uY"), "yang sudah ada di sheet tidak muncul");
assert.ok(codes.includes("DgNEWaaaaa1"));
assert.ok(!codes.includes("DgLASTMONTH"), "postingan bulan lalu tidak muncul");
const collab = r.data.items.find((x) => x.code === "DgCOLLAB001");
assert.equal(collab.account, "COLLABORATION", "muncul di dua akun = kolaborasi");
assert.equal(r.data.items.find((x) => x.code === "DgNEWaaaaa1").kategori, "Carousel");
assert.match(collab.tanggal, /^\d{1,2}\/\d{1,2}\/2026$/);
// Kirim lewat jalur yang sama dengan ABT
const it = r.data.items.find((x) => x.code === "DgNEWaaaaa1");
r = await call("POST", "/api/kpi/content/submit", { rows: [{ ...it, konten: "Carousel Recap Summit", pillar: "Functional" }] }, T.zahra);
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.added, 1);
r = await call("GET", "/api/ig/new", null, T.zahra);
assert.ok(!r.data.items.some((x) => x.code === "DgNEWaaaaa1"));
// Carousel tanpa views: kolom Views di sheet tidak ditimpa, Likes/Comment/Share&Save tetap diperbarui
let carRow = 0;
for (let i = 6; i < 60; i++) if (String(grid[REPORT]["G" + i] || "").includes("DgNEWaaaaa1")) carRow = i;
assert.ok(carRow, "baris carousel ditemukan");
write(`${REPORT}!H${carRow}:K${carRow}`, [[777, 1, 1, 1]]);
kv.delete("ig:sheet"); // sinkron sheet jalan lagi di cron berikutnya
await worker.scheduled({}, env, { waitUntil: (p) => p });
await new Promise((res) => setTimeout(res, 50));
assert.deepEqual(read(`${REPORT}!H${carRow}:K${carRow}`)[0], [777, 30, 4, 7]);
// Token hampir habis diperpanjang otomatis lewat cron
const tk = JSON.parse(kv.get("ig:accounts"));
tk.AAB.expiresAt = Date.now() + 5 * 864e5; tk.AAB.refreshedAt = Date.now() - 2 * 864e5;
kv.set("ig:accounts", JSON.stringify(tk));
await worker.scheduled({}, env, { waitUntil: (p) => p });
await new Promise((res) => setTimeout(res, 50));
assert.ok(igCalls.includes("/refresh_access_token"));
assert.ok(JSON.parse(kv.get("ig:accounts")).AAB.expiresAt > Date.now() + 50 * 864e5);
// Lepas akun
assert.equal((await call("POST", "/api/ig/disconnect", { account: "NUSANTARA" })).status, 200);
r = await call("GET", "/api/ig", null, T.aqil);
assert.equal(r.data.accounts.NUSANTARA.connected, false);

// 17. Token Login Terpadu (EAA, graph.facebook.com)
r = await call("POST", "/api/ig/connect", { account: "NUSANTARA", token: "EAAsalah-ffffffffffffffffffffffffffffffffffffffffffff" });
assert.equal(r.status, 409, JSON.stringify(r.data));
assert.match(r.data.error, /Invalid OAuth/);
// ID bawaan akun AAB dipakai langsung
r = await call("POST", "/api/ig/connect", { account: "AAB", token: "EAAaab-ddddddddddddddddddddddddddddddddddddddddddddd" });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.username, "agensianakbangsa");
let acc = JSON.parse(kv.get("ig:accounts")).AAB;
assert.equal(acc.kind, "fb"); assert.equal(acc.igId, "17841471637263858"); assert.equal(acc.expiresAt, null);
// ID bawaan tidak cocok: dicari lewat Halaman FB yang tertaut
r = await call("POST", "/api/ig/connect", { account: "NUSANTARA", token: "EAApage-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.username, "nusantara.mcn");
assert.equal(JSON.parse(kv.get("ig:accounts")).NUSANTARA.igId, "555");
// Token untuk akun lain ditolak dengan pesan jelas
r = await call("POST", "/api/ig/connect", { account: "NUSANTARA", token: "EAAaab-ddddddddddddddddddddddddddddddddddddddddddddd" });
assert.equal(r.status, 400);
// Data tersinkron lewat graph.facebook.com
r = await call("GET", "/api/ig", null, T.aqil);
const aab2 = r.data.accounts.AAB;
assert.equal(aab2.followers, 19400);
assert.equal(aab2.media.find((m) => m.id === "m1").views, 1300);
assert.equal(aab2.media.find((m) => m.code === "DgNEWaaaaa1").kategori, "Carousel");
assert.equal(aab2.expiresAt, null);
assert.ok(fbCalls.some((p) => p.endsWith("/17841471637263858/media")));
assert.ok(fbCalls.some((p) => p.endsWith("/17841471637263858/insights")));
assert.ok(!JSON.stringify(r.data).includes("EAA"), "token EAA tidak boleh bocor");
// Token EAA tidak pernah diperpanjang
const refBefore = igCalls.filter((p) => p === "/refresh_access_token").length;
await worker.scheduled({}, env, { waitUntil: (p) => p });
await new Promise((res) => setTimeout(res, 50));
assert.equal(igCalls.filter((p) => p === "/refresh_access_token").length, refBefore);
assert.equal(JSON.parse(kv.get("ig:accounts")).AAB.error || "", "");

// 18. Banyak konten: jatah panggilan per jalan dipatuhi, satu konten bermasalah tidak menghentikan yang lain
assert.equal((await call("POST", "/api/ig/disconnect", { account: "NUSANTARA" })).status, 200);
r = await call("POST", "/api/ig/connect", { account: "NUSANTARA", token: "EAAbig-hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh" });
assert.equal(r.status, 200, JSON.stringify(r.data));
let nus = JSON.parse(kv.get("ig:data:NUSANTARA"));
const doneAfterConnect = nus.media.filter((m) => m.views !== null).length;
assert.ok(doneAfterConnect >= 12, "connect langsung mengisi banyak konten: " + doneAfterConnect);
assert.ok(nus.media.find((m) => m.id === "b2").views === null, "konten bermasalah dilewati");
for (let run = 0; run < 4; run++) {
  // anggap insight sudah basi supaya cron mengambil ulang
  const d = JSON.parse(kv.get("ig:data:NUSANTARA")); d.media.forEach((m) => { if (m.views === null) m.insightsAt = 0; }); kv.set("ig:data:NUSANTARA", JSON.stringify(d));
  const n0 = fbCalls.filter((x) => x.includes("/b")).length;
  await worker.scheduled({}, env, { waitUntil: (p) => p });
  await new Promise((res) => setTimeout(res, 50));
  const used = fbCalls.filter((x) => x.includes("/b")).length - n0;
  assert.ok(used <= 9, "jatah per jalan: " + used);
}
nus = JSON.parse(kv.get("ig:data:NUSANTARA"));
assert.equal(nus.media.filter((m) => m.views === null).length, 1, "semua konten terisi kecuali yang ditolak Instagram");
assert.match(nus.media.find((m) => m.id === "b2").insightError, /business conversion/);
// Banyak konten ditolak: pesannya tampil di Insight
const dd = JSON.parse(kv.get("ig:data:NUSANTARA"));
dd.media.slice(0, 3).forEach((m) => { m.views = null; m.reach = null; m.insightError = "Instagram: (#10) contoh"; });
kv.set("ig:data:NUSANTARA", JSON.stringify(dd));
r = await call("GET", "/api/ig", null, T.aqil);
assert.match(r.data.accounts.NUSANTARA.error, /Insight \d+ konten ditolak Instagram/);
// Konten lama tanpa angka (sisa sinkron sebelumnya) langsung diambil di cron berikutnya walau baru dicoba
const d3 = JSON.parse(kv.get("ig:data:NUSANTARA"));
d3.media.forEach((m) => { m.insightError = ""; m.insightsAt = Date.now(); });
d3.media.slice(20, 24).forEach((m) => { m.views = null; m.reach = null; });
kv.set("ig:data:NUSANTARA", JSON.stringify(d3));
await worker.scheduled({}, env, { waitUntil: (p) => p });
await new Promise((res) => setTimeout(res, 50));
assert.equal(JSON.parse(kv.get("ig:data:NUSANTARA")).media.slice(20, 24).filter((m) => m.views === null).length, 0, "konten kosong didahulukan");

console.log("SEMUA TES LULUS. Panggilan Lark tiruan:", calls.length);
