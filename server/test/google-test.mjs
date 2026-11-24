// Uji fitur Google (Content Calendar dan EP) dengan Google tiruan.
import worker, { parseIndoDate, parseEpSlides, weekPlan, parseGoogleId } from "../worker.js";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = { client_email: "creative-aab@proyek.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };
const CAL_ID = "1zEM2wcPMmckLGY36HgqMOEmLm8JWktiwCo8uAH_iSS0";
const EP_ID = "16vNVvD0ZsSJTBmOK3cSOd9rjxIf88xSJLrfTiaUzsLA";

// ---- Sheet tiruan ----
const toSerial = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / 86400000) + 25569;
const sheets = { "AAB NOVEMBER": {}, "NUSANTARA NOVEMBER": {}, Settings: {}, "IDEA KONTEN": {} };
const L = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const ci = (c) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const parseA1 = (a1) => { const m = a1.match(/^'?(.+?)'?!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/); return { tab: m[1], c1: ci(m[2]), r1: +m[3], c2: ci(m[4] || m[2]), r2: +(m[5] || m[3]) }; };
const getRange = (a1) => { const p = parseA1(a1); const g = sheets[p.tab]; const rows = []; for (let r = p.r1; r <= p.r2; r++) { const row = []; for (let c = p.c1; c <= p.c2; c++) row.push(g[L(c) + r] ?? ""); while (row.length && row[row.length - 1] === "") row.pop(); rows.push(row); } while (rows.length && !rows[rows.length - 1].length) rows.pop(); return rows; };
const putRange = (a1, values) => { const p = parseA1(a1); values.forEach((row, i) => row.forEach((v, j) => { let x = v; if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) x = toSerial(v); sheets[p.tab][L(p.c1 + j) + (p.r1 + i)] = x; })); };
const header = ["#", "Content Pillar", "Format", "Platform", "Content", "Date", "Time", "FA Content", "Link Post", "", "", ""];
for (const t of ["AAB NOVEMBER", "NUSANTARA NOVEMBER"]) putRange(`'${t}'!B3:M3`, [header]);
putRange("'IDEA KONTEN'!B3:C3", [["KONTEN", "AKUN"]]);
putRange("Settings!C12:C14", [["1. Functional"], ["2. Education"], ["3. Entertaintment"]]);
putRange("Settings!G12:G15", [["Video"], ["Carousel"], ["News"], ["Feed"]]);
putRange("Settings!K12:K12", [["Instagram"]]);
putRange("'AAB NOVEMBER'!B4:M7", [
  [1, "", "", "", "NO POSTING", "2026-11-22", "", "", "", false, false, false],
  [2, "2. Education", "Video", "", "Modal Jadi Affiliator", "2026-11-25", "TAKE / REFLY", "", "", false, false, false],
  [3, "3. Entertaintment", "Video", "", "POV Villain tapi Host Live", "2026-11-25", "", "", "", true, true, false],
  [4, "2. Education", "Video", "", "Animasi 4 : Kunci Sukses Affiliator", "2026-11-23", "", "23/11 - Kunci", "https://www.instagram.com/reel/DgEx0gPBY-5/", true, true, true],
]);
for (let r = 8; r <= 60; r++) { sheets["AAB NOVEMBER"]["B" + r] = r - 3; ["K", "L", "M"].forEach((c) => { sheets["AAB NOVEMBER"][c + r] = false; }); }
putRange("'NUSANTARA NOVEMBER'!B4:M4", [[1, "2. Education", "Video", "", "Kode Produk Shopee", "2026-11-03", "", "", "", true, true, true]]);

// ---- Slides tiruan ----
const run = (content, style) => ({ textRun: { content, style: style || {} } });
const shape = (id, text, y = 0, extra = {}) => ({ objectId: id, transform: { translateX: 100, translateY: y, scaleX: 1, scaleY: 1, unit: "EMU" }, size: { width: { magnitude: 3e6, unit: "EMU" }, height: { magnitude: 5e5, unit: "EMU" } }, shape: { shapeType: "TEXT_BOX", text: { textElements: [{ paragraphMarker: { style: { alignment: "CENTER" } } }, run(text, extra.style)] }, shapeProperties: extra.sp || {} } });
const table = (id, rows, y) => ({ objectId: id, transform: { translateY: y }, table: { tableRows: rows.map((r) => ({ tableCells: r.map((t) => ({ text: { textElements: [run(t)] } })) })) } });
const postedStyle = { bold: true, fontFamily: "Anton", fontSize: { magnitude: 40, unit: "PT" }, foregroundColor: { opaqueColor: { rgbColor: { red: 1 } } } };
const slides = [
  { objectId: "p1", pageElements: [shape("t1", "Editorial Plan November\n")] },
  { objectId: "s_kata", pageElements: [
    shape("a1", "FORMAT: REELS\nCOVER : KATA TERLARANG PAS LIVE\n\nReference :\u000bhttps://www.instagram.com/p/Dcs1g0bvRp2/ \n\n\nTalent : \nCM & CA\n", 10),
    shape("a2", "Upload : Senin, 2 November 2026\n", 20),
    table("a3", [["NARASI", "VISUAL"], ["Question : \n“Sebutkan 1 kata yang dilarang pas live”", "(natural handheld)"]], 30),
    shape("a4", "POSTED\n", 40, { style: postedStyle, sp: { outline: { propertyState: "NOT_RENDERED" }, contentAlignment: "MIDDLE" } }),
  ] },
  { objectId: "s_modal", pageElements: [
    { objectId: "g1", elementGroup: { children: [shape("b1", "FORMAT: REELS\nCOVER : MODAL JADI AFFILIATOR\n\nReference :\u000bhttps://www.instagram.com/reel/DfbKtjLhLQ8/\n\nTalent : \nRefly\n", 10)] } },
    shape("b2", "Upload : Rabu, 25 November 2026\n", 20),
    table("b3", [["KET", "NARASI", "VISUAL"], ["HOOK", "-", "TEXT : “MODAL JADI AFFILIATOR”"]], 30),
  ] },
  { objectId: "s_kosong", pageElements: [shape("c1", "FORMAT: REELS\nCOVER : …\n\nReference :\u000b…\n\nTalent : \n…\n"), shape("c2", "Upload : Senin, 30 November 2026\n")] },
  { objectId: "p2", pageElements: [shape("t2", "NUSANTARA\n")] },
  { objectId: "s_kode", pageElements: [shape("d1", "FORMAT: REELS\nCOVER : KODE PRODUK SHOPEE\n\nTalent : \nRay, Aqil\n"), shape("d2", "Upload : Selasa, 3 November 2026\n"), shape("d3", "POSTED\n", 40, { style: postedStyle })] },
  { objectId: "p3", pageElements: [shape("t3", "TEMPLATE\n")] },
  { objectId: "s_tpl", pageElements: [shape("e1", "FORMAT: \nCOVER : \n\nTalent : \n….\n"), shape("e2", "Upload : ….\n")] },
];
const slideUpdates = [];

let tokenCalls = 0;
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  calls.push(`${opts.method || "GET"} ${u.host}${u.pathname}`);
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  if (u.host === "oauth2.googleapis.com") {
    tokenCalls++;
    const assertion = new URLSearchParams(opts.body).get("assertion");
    const [h, p, sig] = assertion.split(".");
    const valid = crypto.verify("sha256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, "base64url"));
    assert.ok(valid, "tanda tangan JWT harus valid");
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    assert.equal(claims.iss, SA.client_email);
    assert.match(claims.scope, /spreadsheets/);
    assert.match(claims.scope, /presentations/);
    return ok({ access_token: "g-token", expires_in: 3600 });
  }
  assert.equal(opts.headers.Authorization, "Bearer g-token");
  if (u.host === "sheets.googleapis.com") {
    const id = u.pathname.split("/")[3];
    if (id !== CAL_ID) return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
    if (u.pathname.endsWith("/values:batchGet")) return ok({ valueRanges: u.searchParams.getAll("ranges").map((r) => ({ range: r, values: getRange(r) })) });
    if (u.pathname.endsWith("/values:batchUpdate")) { const b = JSON.parse(opts.body); assert.equal(b.valueInputOption, "USER_ENTERED"); b.data.forEach((d) => putRange(d.range, d.values)); return ok({}); }
    return ok({ properties: { title: "AAB - Content Calendar November 2026" }, sheets: Object.keys(sheets).map((t, i) => ({ properties: { sheetId: i, title: t } })) });
  }
  if (u.host === "slides.googleapis.com") {
    if (!u.pathname.includes(EP_ID)) return new Response(JSON.stringify({ error: { message: "forbidden" } }), { status: 403 });
    if (u.pathname.endsWith(":batchUpdate")) {
      const { requests } = JSON.parse(opts.body);
      slideUpdates.push(requests);
      const cs = requests[0].createShape;
      const txt = requests.find((r) => r.insertText).insertText.text;
      slides.find((s) => s.objectId === cs.elementProperties.pageObjectId).pageElements.push(shape(cs.objectId, txt + "\n", 50));
      return ok({});
    }
    return ok({ title: "AABxNUSANTARA - EP November", slides });
  }
  throw new Error("host tiruan tidak dikenal: " + u.host);
};

const kv = new Map();
const env = {
  LARK_APP_SECRET: "secret", ADMIN_PASSWORD: "admin-rahasia-123", GOOGLE_SA: JSON.stringify(SA),
  STORE: { get: async (k, t) => { const v = kv.get(k); return v === undefined ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
};
const call = async (method, path, body, token) => {
  const res = await worker.fetch(new Request("https://x.dev" + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, {});
  return { status: res.status, data: await res.json() };
};

// Helper
assert.equal(parseIndoDate("Senin, 09 November 2026"), "2026-11-09");
assert.equal(parseIndoDate("Selasa, 10 Oktober 2026"), "2026-10-10");
assert.equal(parseIndoDate("…."), "");
assert.equal(parseGoogleId("https://docs.google.com/spreadsheets/d/1zEM2wcPMmckLGY36HgqMOEmLm8JWktiwCo8uAH_iSS0/edit?usp=drivesdk", "sheet"), CAL_ID);
assert.equal(parseGoogleId("https://docs.google.com/presentation/d/16vNVvD0ZsSJTBmOK3cSOd9rjxIf88xSJLrfTiaUzsLA/edit#slide=id.p", "slides"), EP_ID);
assert.equal(parseGoogleId("https://docs.google.com/presentation/d/16vNVvD0ZsSJTBmOK3cSOd9rjxIf88xSJLrfTiaUzsLA/edit", "sheet"), null);
const parsed = parseEpSlides(slides);
assert.deepEqual(parsed.map((x) => [x.id, x.account, x.cover, x.date, x.posted, x.talent]), [
  ["s_kata", "AAB", "KATA TERLARANG PAS LIVE", "2026-11-02", true, "CM & CA"],
  ["s_modal", "AAB", "MODAL JADI AFFILIATOR", "2026-11-25", false, "Refly"],
  ["s_kosong", "AAB", "", "2026-11-30", false, ""],
  ["s_kode", "NUSANTARA", "KODE PRODUK SHOPEE", "2026-11-03", true, "Ray, Aqil"],
]);
assert.equal(parsed[0].format, "REELS");
assert.equal(parsed[0].reference, "https://www.instagram.com/p/Dcs1g0bvRp2/");
assert.ok(parsed[0].body.includes("Sebutkan 1 kata"));
assert.ok(!parsed[0].body.includes("POSTED"));

// Akun
const login = async (u, p) => (await call("POST", "/api/login", { username: u, password: p })).data.token;
const RAY = await login("ray", "admin-rahasia-123");
for (const [u, m] of [["zahra", "fitria"], ["aqil", "athallah"]]) await call("POST", "/api/accounts/save", { username: u, member: m, password: "password123" }, RAY);
const ZAHRA = await login("zahra", "password123");
const AQIL = await login("aqil", "password123");

// Konfigurasi
let r = await call("GET", "/api/google", null, RAY);
assert.equal(r.data.serviceAccount, SA.client_email);
assert.equal(r.data.calendar, null);
assert.equal((await call("POST", "/api/google", { calendarUrl: "https://x.com/abc" }, RAY)).status, 400);
assert.equal((await call("POST", "/api/google", { calendarUrl: "https://docs.google.com/spreadsheets/d/1zEM2wcPMmckLGY36HgqMOEmLm8JWktiwCo8uAH_iSS0/edit" }, ZAHRA)).status, 403, "hanya Ray yang atur link");
r = await call("POST", "/api/google", { calendarUrl: "https://docs.google.com/spreadsheets/d/1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/edit" }, RAY);
assert.equal(r.status, 409);
assert.match(r.data.error, /Bagikan file ini sebagai Editor ke creative-aab@/);
r = await call("POST", "/api/google", { calendarUrl: `https://docs.google.com/spreadsheets/d/${CAL_ID}/edit`, epUrl: `https://docs.google.com/presentation/d/${EP_ID}/edit` }, RAY);
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.deepEqual(r.data.calendar.tabs.map((t) => t.account), ["AAB", "NUSANTARA"], "tab IDEA KONTEN dan Settings tidak ikut");
assert.deepEqual(r.data.calendar.options.formats, ["Video", "Carousel", "News", "Feed"]);
assert.equal(r.data.calendarRows, 5);
assert.equal(r.data.epItems, 4);
assert.equal(tokenCalls, 1, "token Google di-cache");

// Kalender
assert.equal((await call("GET", "/api/calendar", null, AQIL)).status, 403, "Aqil tidak akses kalender");
r = await call("GET", "/api/calendar", null, ZAHRA);
assert.equal(r.status, 200);
const modal = r.data.rows.find((x) => x.content === "Modal Jadi Affiliator");
assert.deepEqual([modal.date, modal.note, modal.take, modal.account, modal.row], ["2026-11-25", "TAKE / REFLY", false, "AAB", 5]);
assert.equal(r.data.rows.find((x) => x.row === 4).noPosting, true);
// tambah konten baru: masuk ke baris kosong pertama setelah baris terakhir
r = await call("POST", "/api/calendar/save", { account: "AAB", date: "2026-11-27", pillar: "2. Education", format: "Video", platform: "Instagram", content: "Kunci Affiliator 2027", note: "TAKE" }, ZAHRA);
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.row, 8);
assert.deepEqual(getRange("'AAB NOVEMBER'!B8:M8")[0], [5, "2. Education", "Video", "Instagram", "Kunci Affiliator 2027", toSerial("2026-11-27"), "TAKE", "", "", false, false, false], "kolom B (nomor) tidak disentuh");
// no posting
r = await call("POST", "/api/calendar/save", { account: "AAB", date: "2026-11-28", noPosting: true, content: "abaikan", pillar: "x" }, ZAHRA);
assert.equal(r.data.row, 9);
assert.deepEqual(getRange("'AAB NOVEMBER'!C9:M9")[0], ["", "", "", "NO POSTING", toSerial("2026-11-28"), "", "", "", false, false, false]);
// validasi
assert.equal((await call("POST", "/api/calendar/save", { account: "AAB", date: "", content: "x" }, ZAHRA)).status, 400);
assert.equal((await call("POST", "/api/calendar/save", { account: "AAB", date: "2026-11-27", content: "" }, ZAHRA)).status, 400);
assert.equal((await call("POST", "/api/calendar/save", { account: "LAIN", date: "2026-11-27", content: "x" }, ZAHRA)).status, 400);
// ubah baris
r = await call("GET", "/api/calendar", null, ZAHRA);
const kunci = r.data.rows.find((x) => x.content === "Kunci Affiliator 2027");
r = await call("POST", "/api/calendar/save", { ...kunci, id: kunci.id, content: "On Site (Kunci Affiliator 2027)", editing: true }, ZAHRA);
assert.equal(r.data.row, 8);
assert.equal(sheets["AAB NOVEMBER"].F8, "On Site (Kunci Affiliator 2027)");
assert.equal(sheets["AAB NOVEMBER"].L8, true);
// id lama sudah tidak cocok
assert.equal((await call("POST", "/api/calendar/save", { ...kunci, id: kunci.id }, ZAHRA)).status, 409);
// centang
r = await call("GET", "/api/calendar", null, RAY);
const pov = r.data.rows.find((x) => x.content === "POV Villain tapi Host Live");
r = await call("POST", "/api/calendar/toggle", { id: pov.id, field: "posting", value: true }, ZAHRA);
assert.equal(r.status, 200);
assert.equal(sheets["AAB NOVEMBER"].M6, true);
assert.equal((await call("POST", "/api/calendar/toggle", { id: pov.id, field: "hapus", value: true }, ZAHRA)).status, 400);
// tab NUSANTARA
r = await call("POST", "/api/calendar/save", { account: "NUSANTARA", date: "2026-11-30", content: "Pelanggaran Shopee Video", pillar: "2. Education", format: "Video" }, ZAHRA);
assert.equal(r.data.row, 5);
assert.equal(sheets["NUSANTARA NOVEMBER"].F5, "Pelanggaran Shopee Video");

// EP
r = await call("GET", "/api/ep", null, AQIL);
assert.equal(r.status, 200);
assert.equal(r.data.items.length, 4);
assert.deepEqual([r.data.canDecide, r.data.canPost], [false, false]);
r = await call("GET", "/api/ep", null, ZAHRA);
assert.deepEqual([r.data.canDecide, r.data.canPost], [false, true]);
assert.equal((await call("POST", "/api/ep/decision", { id: "s_modal", status: "OKE" }, ZAHRA)).status, 403);
assert.equal((await call("POST", "/api/ep/decision", { id: "s_modal", status: "REVISI" }, RAY)).status, 400, "revisi wajib catatan");
assert.equal((await call("POST", "/api/ep/decision", { id: "s_modal", status: "SETUJU" }, RAY)).status, 400);
r = await call("POST", "/api/ep/decision", { id: "s_modal", status: "REVISI", note: "Revisi di kolom VISUAL" }, RAY);
assert.equal(r.status, 200);
assert.deepEqual([r.data.items.find((x) => x.id === "s_modal").decision.status, r.data.items.find((x) => x.id === "s_modal").decision.note], ["REVISI", "Revisi di kolom VISUAL"]);
r = await call("GET", "/api/ep", null, AQIL);
assert.equal(r.data.items.find((x) => x.id === "s_modal").decision.status, "REVISI", "tim lihat status revisi");
r = await call("POST", "/api/ep/decision", { id: "s_modal", status: "OKE" }, RAY);
assert.equal(r.data.items.find((x) => x.id === "s_modal").decision.note, "");
// POSTED
assert.equal((await call("POST", "/api/ep/posted", { id: "s_modal" }, AQIL)).status, 403);
assert.equal((await call("POST", "/api/ep/posted", { id: "s_modal", link: "bukan-link" }, ZAHRA)).status, 400);
r = await call("GET", "/api/calendar", null, ZAHRA);
const modalRow = r.data.rows.find((x) => x.content === "Modal Jadi Affiliator");
r = await call("POST", "/api/ep/posted", { id: "s_modal", link: "https://www.instagram.com/reel/DgXyZ/", calendarId: modalRow.id }, ZAHRA);
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.stamped, true);
assert.equal(r.data.ep.items.find((x) => x.id === "s_modal").posted, true);
const req = slideUpdates.at(-1);
assert.equal(req[0].createShape.elementProperties.pageObjectId, "s_modal");
assert.deepEqual(req[0].createShape.elementProperties.transform, slides[1].pageElements[3].transform, "posisi sama dengan stempel yang ada");
const ts = req.find((x) => x.updateTextStyle).updateTextStyle;
assert.equal(ts.style.fontFamily, "Anton");
assert.equal(ts.fields, "bold,fontFamily,fontSize,foregroundColor");
assert.equal(req.find((x) => x.updateShapeProperties).updateShapeProperties.fields, "outline,contentAlignment");
assert.equal(sheets["AAB NOVEMBER"].M5, true);
assert.equal(sheets["AAB NOVEMBER"].J5, "https://www.instagram.com/reel/DgXyZ/");
// kirim ulang tidak menempel stempel kedua
const n = slideUpdates.length;
r = await call("POST", "/api/ep/posted", { id: "s_modal" }, ZAHRA);
assert.equal(r.data.stamped, false);
assert.equal(slideUpdates.length, n);

// Dashboard
r = await call("GET", "/api/dashboard", null, RAY);
assert.equal(r.status, 200);
assert.ok(r.data.ep);
assert.equal(r.data.ep.posted, 3);
assert.ok(r.data.activity.some((a) => a.text.startsWith("POSTED")));
const wp = weekPlan([
  { account: "AAB", date: "2026-11-23", content: "a", posting: true },
  { account: "AAB", date: "2026-11-24", content: "b", posting: false },
  { account: "AAB", date: "2026-11-26", content: "c", posting: false },
  { account: "AAB", date: "2026-11-28", content: "NO POSTING", noPosting: true },
  { account: "AAB", date: "2026-11-30", content: "minggu depan", posting: false },
  { account: "NUSANTARA", date: "2026-11-29", content: "d", posting: true },
], "2026-11-25");
assert.deepEqual([wp.start, wp.end], ["2026-11-23", "2026-11-29"]);
assert.deepEqual(wp.accounts, { AAB: { planned: 3, posted: 1, late: 1 }, NUSANTARA: { planned: 1, posted: 1, late: 0 } });

// Cron menyegarkan kalender dan EP
const before = calls.length;
await worker.scheduled({}, env, { waitUntil: (p) => p });
await new Promise((res) => setTimeout(res, 50));
assert.ok(calls.slice(before).some((c) => c.includes("slides.googleapis.com")));

// GOOGLE_SA kosong: pesan jelas
const env2 = { ...env, GOOGLE_SA: "" };
kv.delete("google:token"); kv.delete("epcache");
const res2 = await worker.fetch(new Request("https://x.dev/api/ep/refresh", { method: "POST", headers: { Authorization: `Bearer ${ZAHRA}` } }), env2, {});
assert.equal(res2.status, 409);
assert.match((await res2.json()).error, /GOOGLE_SA/);

console.log("TES GOOGLE LULUS. Panggilan:", calls.length);
