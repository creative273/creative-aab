// Server lokal untuk uji tampilan widget: worker.js + Lark tiruan.
import worker, { colIndex } from "../worker.js";
import assert from "node:assert/strict";
import http from "node:http";
import { googleFetch, SA, CAL_ID, EP_ID } from "./google-mock.mjs";
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

import assert2 from "node:assert/strict";
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
      ...Array.from({ length: 8 }, (_, i) => ({ id: "x" + i, shortcode: "DgOLD00000" + i, media_type: i % 3 ? "VIDEO" : "IMAGE", media_product_type: i % 3 ? "REELS" : "FEED", ago: (5 + i * 3) * 864e5, views: 4000 - i * 350, reach: 3000 - i * 200, likes: 60 - i * 4, comments: 9 - i, shares: 4, saved: 6 })),
    ] },
  "tok-nus-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": { id: "1782", username: "nusantara.mcn", followers: 6452,
    media: [{ id: "m3", shortcode: "DgCOLLAB001", media_type: "VIDEO", media_product_type: "REELS", ago: 2 * 864e5, views: 800, reach: 700, likes: 10, comments: 1, shares: 0, saved: 0 }] },
};
function igMock(u) {
  const tok = u.searchParams.get("access_token");
  igCalls.push(u.pathname);
  const acc = IG[tok];
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  const err = (m) => new Response(JSON.stringify({ error: { message: m, code: 190 } }), { status: 400 });
  if (u.pathname === "/refresh_access_token") return acc ? ok({ access_token: tok, expires_in: 5184000 }) : err("Invalid OAuth access token");
  if (!acc) return err("Invalid OAuth access token - Cannot parse access token");
  assert2.ok(u.pathname.startsWith("/v25.0/"), u.pathname);
  const path = u.pathname.slice(7);
  if (path === "me") return ok({ user_id: acc.id, id: acc.id, username: acc.username, account_type: "MEDIA_CREATOR", followers_count: acc.followers, media_count: 197 });
  if (path === "me/media") return ok({ data: acc.media.map((m) => ({ id: m.id, shortcode: m.shortcode, media_type: m.media_type, media_product_type: m.media_product_type, permalink: `https://www.instagram.com/reel/${m.shortcode}/`, caption: "Caption " + m.id, timestamp: iso(m.ago), like_count: m.likes, comments_count: m.comments })) });
  if (path === "me/insights") { assert2.equal(u.searchParams.get("metric_type"), "total_value"); return ok({ data: [{ name: "views", total_value: { value: 900 } }, { name: "reach", total_value: { value: 600 } }, { name: "total_interactions", total_value: { value: 40 } }, { name: "accounts_engaged", total_value: { value: 30 } }] }); }
  const mm = path.match(/^(\w+)\/insights$/);
  if (mm) {
    const m = acc.media.find((x) => x.id === mm[1]);
    const metrics = u.searchParams.get("metric").split(",");
    if (metrics.includes("views") && m.views === null) return new Response(JSON.stringify({ error: { message: "(#100) metric views not supported", code: 100 } }), { status: 400 });
    return ok({ data: metrics.map((k) => ({ name: k, period: "lifetime", values: [{ value: m[k] }] })) });
  }
  return err("unknown " + path);
}

globalThis.fetch = async (url, opts = {}) => {
  if (new URL(url).host === "graph.instagram.com") return igMock(new URL(url));
  const g = await googleFetch(url, opts);
  if (g) return g;
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
  LARK_APP_ID: "cli_test", LARK_APP_SECRET: "secret", ADMIN_PASSWORD: "admin-rahasia-123", GOOGLE_SA: JSON.stringify(SA),
  STORE: { get: async (k, t) => { const v = kv.get(k); return v === undefined ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
};
const call = async (method, path, body, key = "kunci-tim") => {
  const res = await worker.fetch(new Request("https://x.workers.dev" + path, { method, headers: { "X-Team-Key": key, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, {});
  return { status: res.status, data: await res.json() };
};


// tambah request yang lebih realistis
write(`${REQ}!A5:I6`, [[4,"24 November 2026","SHELLA","Banner live Shopee 12.12 ukuran 1080x1920, warna hijau klinik","27 November 2026",null,"APPROVE",null,null],[5,"24 November 2026","ARIL SULAEMAN","Asset live Healthy Inside Out: sticker promo, frame kamera",null,null,null,null,null]]);
const nodeFetch = globalThis.fetch;
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = new Request("http://localhost:8787" + req.url, { method: req.method, headers: req.headers, body: ["GET","HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const out = await worker.fetch(r, env, { waitUntil() {} });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(8787, async () => {
  // Akun contoh: ray / admin-rahasia-123, lainnya password123
  const go = async (path, body, tok) => (await worker.fetch(new Request("http://x" + path, { method: "POST", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) }), env, {})).json();
  const { token } = await go("/api/login", { username: "ray", password: "admin-rahasia-123" });
  for (const [u, m] of [["zahra", "fitria"], ["aqil", "athallah"], ["albar", "albar"], ["rifqi", "rifqi"]]) await go("/api/accounts/save", { username: u, member: m, password: "password123" }, token);
  if (process.env.WITH_GOOGLE) await go("/api/google", { calendarUrl: `https://docs.google.com/spreadsheets/d/${CAL_ID}/edit`, epUrl: `https://docs.google.com/presentation/d/${EP_ID}/edit` }, token);
  if (!process.env.NO_SHEET) await go("/api/config", { url: `https://x.larksuite.com/sheets/${SHEET}` }, token);
  if (process.env.WITH_IG) {
    await go("/api/ig/connect", { account: "AAB", token: "tok-aab-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, token);
    // isi riwayat harian 14 hari supaya grafik terlihat
    const d = JSON.parse(kv.get("ig:data:AAB"));
    for (let i = 1; i < 14; i++) { const k = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); d.daily[k] = { views: 700 + ((i * 137) % 600), reach: 500 + ((i * 91) % 300), total_interactions: 20 + (i * 7) % 40, followers: 19400 - i * 12 }; }
    kv.set("ig:data:AAB", JSON.stringify(d));
  }
  if (process.env.WITH_FEED) {
    const tok = {};
    for (const u of ["zahra", "aqil", "albar", "rifqi"]) tok[u] = (await go("/api/login", { username: u, password: "password123" })).token;
    await go("/api/me/profile", { bio: "Ngurus IG @agensianakbangsa dari take sampai upload.", title: "Social Media Specialist" }, tok.zahra);
    await go("/api/me/profile", { bio: "Desain cetak dan motion. Kopi susu garis keras.", title: "Graphic Designer" }, tok.aqil);
    await go("/api/me/profile", { bio: "Creative lead. AIGC, sosmed, event.", title: "Creative Lead" }, token);
    const st = await (await worker.fetch(new Request("http://x/api/state", { headers: { Authorization: "Bearer " + token } }), env, {})).json();
    const rq = st.requests.find((r) => r.user === "ARIL SULAEMAN");
    if (rq) await go("/api/request/decision", { row: rq.row, id: rq.id, decision: "APPROVE" }, token);
    if (process.env.WITH_GOOGLE) await go("/api/ep/decision", { id: "s_kata", status: "OKE" }, token);
    await go("/api/kpi/aigc", { tanggal: "11/24/2026", produksi: 12, upload: 10 }, tok.rifqi);
    const p1 = await go("/api/feed/post", { text: "Take konten Dos & Don'ts live affiliate hari ini aman semua. Besok editing ya @Albar 🙏" }, tok.zahra);
    await go("/api/feed/react", { id: p1.item.id, reaction: "fire" }, tok.albar);
    await go("/api/feed/react", { id: p1.item.id, reaction: "like" }, token);
    await go("/api/feed/comment", { id: p1.item.id, text: "Siap, nanti sore aku mulai." }, tok.albar);
    await go("/api/feed/comment", { id: p1.item.id, text: "Mantap Zahra. Jangan lupa cover-nya." }, token);
    await go("/api/feed/post", { text: "Banner Shopee 12.12 sudah final, cek di folder DESIGN ya." }, tok.aqil);
    await worker.fetch(new Request("http://x/api/state", { headers: { Authorization: "Bearer " + tok.zahra, "X-App-Version": "1.5.1" } }), env, {});
    await worker.fetch(new Request("http://x/api/state", { headers: { Authorization: "Bearer " + tok.albar, "X-App-Version": "1.5.0" } }), env, {});
    const fsm = await import("node:fs");
    if (fsm.existsSync("/tmp/ui/post.jpg")) {
      const img = "data:image/jpeg;base64," + fsm.readFileSync("/tmp/ui/post.jpg").toString("base64");
      const p2 = await go("/api/feed/post", { text: "Moodboard event creative minggu depan. Gimana menurut kalian?", image: img, w: 1200, h: 750 }, token);
      await go("/api/feed/react", { id: p2.item.id, reaction: "love" }, tok.zahra);
      await go("/api/feed/react", { id: p2.item.id, reaction: "love" }, tok.aqil);
      await go("/api/feed/comment", { id: p2.item.id, text: "Warna oranyenya cakep kak!" }, tok.zahra);
    }
  }
  if (process.env.WITH_MOBILE) {
    const tz = (await go("/api/login", { username: "zahra", password: "password123" })).token;
    const ta = (await go("/api/login", { username: "aqil", password: "password123" })).token;
    const rp = await go("/api/feed/post", { text: "Moodboard event creative minggu depan. Gimana menurut kalian? @zahra @aqil" }, token);
    await go("/api/feed/react", { id: rp.item.id, reaction: "love" }, tz);
    await go("/api/feed/comment", { id: rp.item.id, text: "Cover-nya aku bikin versi gelap juga ya @ray" }, ta);
    await go("/api/feed/comment", { id: rp.item.id, text: "Warna oranyenya cakep kak!" }, tz);
    const st = await (await worker.fetch(new Request("http://x/api/state", { headers: { Authorization: "Bearer " + token } }), env, {})).json();
    const rq = st.requests.find((r) => !r.decision && r.status !== "done");
    if (rq) {
      const list = JSON.parse(kv.get("notif:ray") || "[]");
      list.unshift({ id: "nreq1", at: new Date().toISOString(), read: false, type: "request", by: "", requester: rq.user, row: rq.row, reqId: rq.id, text: rq.info, deadline: rq.deadline });
      kv.set("notif:ray", JSON.stringify(list));
    }
  }
  console.log("dev server :8787");
});
