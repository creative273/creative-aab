// Google tiruan untuk server lokal (uji tampilan).
import assert from "node:assert/strict";
import crypto from "node:crypto";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
export const SA = { client_email: "creative-aab@proyek.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };
export const CAL_ID = "1zEM2wcPMmckLGY36HgqMOEmLm8JWktiwCo8uAH_iSS0";
export const EP_ID = "16vNVvD0ZsSJTBmOK3cSOd9rjxIf88xSJLrfTiaUzsLA";
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
putRange("'AAB NOVEMBER'!B4:M11", [
  [1, "2. Education", "Video", "Instagram", "Kata Terlarang Pas Live", "2026-11-02", "", "02/11 - Kata", "https://www.instagram.com/p/Dcs1g0bvRp2/", true, true, true],
  [2, "3. Entertaintment", "Carousel", "Instagram", "5 Kesalahan Host Baru", "2026-11-06", "", "", "https://www.instagram.com/p/demo2/", true, true, true],
  [3, "1. Functional", "Video", "Instagram", "Cara Daftar Affiliate AAB", "2026-11-12", "", "", "https://www.instagram.com/reel/demo3/", true, true, true],
  [4, "2. Education", "Video", "Instagram", "Animasi 4 : Kunci Sukses Affiliator", "2026-11-23", "", "23/11 - Kunci", "https://www.instagram.com/reel/DgEx0gPBY-5/", true, true, true],
  [5, "", "", "", "NO POSTING", "2026-11-22", "", "", "", false, false, false],
  [6, "2. Education", "Video", "Instagram", "Modal Jadi Affiliator", "2026-11-25", "TAKE / REFLY", "", "", false, false, false],
  [7, "3. Entertaintment", "Video", "Instagram", "POV Villain tapi Host Live", "2026-11-27", "EDIT ALBAR", "", "", true, true, false],
  [8, "1. Functional", "Carousel", "Instagram", "Checklist Persiapan Live 12.12", "2026-11-29", "DESIGN AQIL", "", "", true, false, false],
]);
for (let r = 12; r <= 60; r++) { sheets["AAB NOVEMBER"]["B" + r] = r - 3; ["K", "L", "M"].forEach((c) => { sheets["AAB NOVEMBER"][c + r] = false; }); }
putRange("'NUSANTARA NOVEMBER'!B4:M6", [
  [1, "2. Education", "Video", "Instagram", "Kode Produk Shopee", "2026-11-03", "", "", "https://www.instagram.com/reel/demo-nus1/", true, true, true],
  [2, "3. Entertaintment", "Video", "Instagram", "Behind The Scene Studio Live", "2026-11-18", "", "", "https://www.instagram.com/reel/demo-nus2/", true, true, true],
  [3, "2. Education", "Video", "Instagram", "Tips Komisi Naik 2x Lipat", "2026-11-27", "TAKE SIANG", "", "", false, false, false],
]);

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
// Tambah slide EP baru (untuk tes notifikasi EP baru).
export function addEpSlide(id, cover) {
  slides.push({ objectId: id, pageElements: [shape(id + "a", `FORMAT: REELS\nCOVER : ${cover}\n\nTalent : \nRefly\n`), shape(id + "b", "Upload : Jumat, 27 November 2026\n")] });
}
export async function googleFetch(url, opts = {}) {
  const u = new URL(url);
  if (!u.host.endsWith("googleapis.com")) return null;
  calls.push(`${opts.method || "GET"} ${u.host}${u.pathname}`);
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  if (u.host === "oauth2.googleapis.com") {
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
    if (u.pathname.includes("/pages/") && u.pathname.endsWith("/thumbnail")) {
      assert.equal(u.searchParams.get("thumbnailProperties.thumbnailSize"), "LARGE");
      return ok({ contentUrl: `https://lh3.googleusercontent.com/thumb-${u.pathname.split("/")[5]}`, width: 1600, height: 900 });
    }
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
  return null;
}

