// Creative AAB: server pusat (Cloudflare Worker)
// Satu-satunya yang memanggil API Lark. Widget di laptop tim hanya bicara dengan server ini.
//
// Pengaturan di Cloudflare (Settings > Variables and Secrets):
//   LARK_APP_ID      (Text)    App ID custom app Lark
//   LARK_APP_SECRET  (Secret)  App Secret custom app Lark
//   ADMIN_PASSWORD   (Secret)  Password awal akun "ray". Juga jalan pemulihan kalau Ray lupa password.
// Akun tim dibuat Ray dari widget (Pengaturan > Akun tim), disimpan di KV dengan password ter-hash.
// Binding (Settings > Bindings):
//   STORE            KV namespace
// Trigger (Settings > Triggers > Cron):
//   */10 1-11 * * 1-6   (tiap 10 menit, Senin-Sabtu, 08.00-18.59 WIB)

const LARK = "https://open.larksuite.com/open-apis";

const TAB_REPORT = "Creative Report Analytic";
const TAB_REQUEST = "REQUEST CREATIVE";

// Baris pertama data di tab Creative Report Analytic (header ada di baris 5).
const FIRST_ROW = 6;
const LAST_ROW = 300;

// Posisi blok di tab Creative Report Analytic.
const BLOCKS = {
  content: { first: "A", last: "K", key: "B" }, // No, Tanggal Upload, Account, Content Pillar, Konten, Kategori, Link Content, Views, Likes, Comment, Share & Save
  design: { first: "N", last: "Q", key: "O" }, // No, Tanggal, Informasi Detil, Hasil Design (gambar)
  video: { first: "S", last: "V", key: "T" }, // No, Tanggal, Informasi Detil, Hasil Video (gambar)
  aigc: { first: "AH", last: "AK", key: "AI" }, // No, Tanggal, Jumlah Produksi, Jumlah Upload
};

// Kolom tab REQUEST CREATIVE (header baris 1).
// A No | B Tanggal Submit | C User | D Informasi Request | E Deadline | F Output (Creative) | G Remark (Creative) | H PROGRESS (Creative) | I NOTE (Acil)
const REQUEST_RANGE = "A2:I300";

const REFRESH_COOLDOWN_MS = 60 * 1000;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    try {
      const url = new URL(request.url);
      if (url.pathname === "/") return cors(json({ ok: true, app: "creative-aab", auth: "accounts" }));
      const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
      const route = `${request.method} ${url.pathname}`;
      if (route === "POST /api/login") return cors(json(await login(env, body)));

      const me = await authenticate(env, request);
      // Siapa boleh apa. "all" = semua akun aktif. Nama blok = pemilik blok itu. Ray (lead) boleh semua.
      const R = {
        "GET /api/state": ["all", () => getState(env, me)],
        "POST /api/refresh": ["all", () => refresh(env, { force: false }).then((s) => forUser(s, me))],
        "GET /api/me": ["all", () => ({ ok: true, user: publicUser(me) })],
        "POST /api/password": ["all", () => changeOwnPassword(env, me, body)],
        "POST /api/request/done": ["all", () => requestDone(env, body, me)],
        "POST /api/kpi/content/preview": ["content", () => contentPreview(env, body)],
        "POST /api/kpi/content/submit": ["content", () => contentSubmit(env, body, me)],
        "POST /api/kpi/design/preview": ["design", () => imageRowsPreview(env, "design", body)],
        "POST /api/kpi/design": ["design", () => appendImageRow(env, "design", body, me)],
        "POST /api/kpi/video/preview": ["video", () => imageRowsPreview(env, "video", body)],
        "POST /api/kpi/video": ["video", () => appendImageRow(env, "video", body, me)],
        "POST /api/kpi/aigc": ["aigc", () => upsertAigc(env, body, me)],
        "POST /api/config": ["lead", () => setConfig(env, body)],
        "POST /api/request/decision": ["lead", () => requestDecision(env, body, me)],
        "GET /api/dashboard": ["lead", () => dashboard(env)],
        "GET /api/google": ["lead", () => googleConfigInfo(env)],
        "POST /api/google": ["lead", () => setGoogleConfig(env, body)],
        "GET /api/ep": ["all", () => getEp(env, me)],
        "POST /api/ep/refresh": ["all", () => refreshEp(env).then(() => getEp(env, me))],
        "POST /api/ep/decision": ["lead", () => epDecision(env, body, me)],
        "POST /api/ep/posted": ["content", () => epPosted(env, body, me)],
        "GET /api/calendar": ["content", () => getCalendar(env)],
        "POST /api/calendar/refresh": ["content", () => refreshCalendar(env).then((c) => ({ ok: true, ...c }))],
        "POST /api/calendar/save": ["content", () => calendarSave(env, body, me)],
        "POST /api/calendar/toggle": ["content", () => calendarToggle(env, body, me)],
        "GET /api/accounts": ["lead", () => listAccounts(env)],
        "POST /api/accounts/save": ["lead", () => saveAccount(env, body)],
        "POST /api/accounts/delete": ["lead", () => deleteAccount(env, body)],
      };
      const entry = R[route];
      if (!entry) return cors(json({ ok: false, error: "Alamat tidak dikenal." }, 404));
      const [need, handler] = entry;
      if (!allowed(me, need)) return cors(json({ ok: false, error: "Akun kamu tidak punya akses ke fitur ini." }, 403));
      return cors(json(await handler()));
    } catch (err) {
      return cors(json({ ok: false, error: err.message || String(err) }, err.status || 500));
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([refresh(env, { force: true }).catch(() => {}), googleRefreshAll(env)]));
  },
};

// ---------- Akun dan login ----------

// Slot anggota. "block" menentukan input KPI mana yang boleh dikirim akun itu.
export const MEMBERS = {
  ray: { name: "Ray Sangkhylang", block: "lead" },
  fitria: { name: "Fitria Azzahra Kurnia", block: "content" },
  athallah: { name: "Athallah Aqil Sukendar", block: "design" },
  albar: { name: "Muhammad Albar", block: "video" },
  rifqi: { name: "Rifqi Firega", block: "aigc" },
};
const LEAD_USER = "ray";
const SESSION_DAYS = 60;
// Paket gratis Cloudflare membatasi CPU 10 ms per permintaan. 20.000 iterasi sekitar 5 ms.
// Percobaan login dibatasi 5 kali per 15 menit, jadi tebak password tetap lambat.
const PBKDF2_ITER = 20000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

export function allowed(me, need) {
  const block = MEMBERS[me.member]?.block;
  if (block === "lead") return true;
  if (need === "all") return true;
  return block === need;
}

export function publicUser(a) {
  const m = MEMBERS[a.member] || {};
  return { username: a.username, member: a.member, name: m.name || a.member, block: m.block || "", active: a.active !== false, createdAt: a.createdAt || null };
}

async function getAccounts(env) {
  return (await env.STORE.get("accounts", "json")) || {};
}
async function putAccounts(env, accounts) {
  await env.STORE.put("accounts", JSON.stringify(accounts));
}

async function login(env, body) {
  const username = clean(body.username).toLowerCase();
  const password = String(body.password ?? "");
  if (!username || !password) throw fail("Isi username dan password.");
  const failKey = `fail:${username}`;
  const fails = (await env.STORE.get(failKey, "json")) || { n: 0, until: 0 };
  if (fails.until > Date.now()) {
    const menit = Math.ceil((fails.until - Date.now()) / 60000);
    throw fail(`Terlalu banyak percobaan salah. Coba lagi ${menit} menit lagi.`, 429);
  }
  const accounts = await getAccounts(env);
  let acc = accounts[username];
  let ok = false;
  if (acc && acc.active !== false) ok = await verifyPassword(password, acc);
  // Akun Ray: password dari Cloudflare (ADMIN_PASSWORD) selalu diterima. Dipakai untuk login pertama dan pemulihan.
  if (!ok && username === LEAD_USER && env.ADMIN_PASSWORD && safeEqual(password, env.ADMIN_PASSWORD)) {
    if (!acc) {
      acc = { username: LEAD_USER, member: "ray", active: true, ver: 1, createdAt: new Date().toISOString(), ...(await hashPassword(password)) };
      accounts[LEAD_USER] = acc;
      await putAccounts(env, accounts);
    }
    ok = true;
  }
  if (!ok) {
    const n = fails.n + 1;
    await env.STORE.put(failKey, JSON.stringify(n >= MAX_FAILS ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 }), { expirationTtl: 3600 });
    throw fail(acc && acc.active === false ? "Akun ini dinonaktifkan. Hubungi Ray." : "Username atau password salah.", 401);
  }
  if (fails.n) await env.STORE.delete(failKey);
  return { ok: true, token: await signToken(env, acc), user: publicUser(acc) };
}

async function authenticate(env, request) {
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const payload = token ? await verifyToken(env, token) : null;
  if (!payload) throw fail("Sesi habis. Login lagi.", 401);
  const acc = (await getAccounts(env))[payload.u];
  if (!acc || acc.active === false || (acc.ver || 1) !== payload.v) throw fail("Sesi habis. Login lagi.", 401);
  return acc;
}

async function changeOwnPassword(env, me, body) {
  const accounts = await getAccounts(env);
  const acc = accounts[me.username];
  if (!(await verifyPassword(String(body.old ?? ""), acc))) throw fail("Password lama salah.");
  checkPassword(body.password);
  Object.assign(acc, await hashPassword(String(body.password)), { ver: (acc.ver || 1) + 1 });
  await putAccounts(env, accounts);
  return { ok: true, token: await signToken(env, acc) };
}

async function listAccounts(env) {
  const accounts = await getAccounts(env);
  return { ok: true, accounts: Object.values(accounts).map(publicUser).sort((a, b) => a.username.localeCompare(b.username)), members: MEMBERS };
}

async function saveAccount(env, body) {
  const username = clean(body.username).toLowerCase();
  if (!/^[a-z0-9._-]{3,20}$/.test(username)) throw fail("Username 3 sampai 20 karakter: huruf kecil, angka, titik, minus, atau garis bawah.");
  const accounts = await getAccounts(env);
  let acc = accounts[username];
  const member = body.member === undefined && acc ? acc.member : clean(body.member);
  if (!MEMBERS[member]) throw fail("Pilih anggota tim untuk akun ini.");
  if ((username === LEAD_USER) !== (member === "ray")) throw fail('Slot Ray hanya untuk akun "ray".');
  const taken = Object.values(accounts).find((a) => a.member === member && a.username !== username);
  if (taken) throw fail(`${MEMBERS[member].name} sudah punya akun "${taken.username}".`);
  let bump = false;
  if (!acc) {
    checkPassword(body.password);
    acc = { username, member, active: true, ver: 1, createdAt: new Date().toISOString(), ...(await hashPassword(String(body.password))) };
    accounts[username] = acc;
  } else {
    if (acc.member !== member) { acc.member = member; bump = true; }
    if (body.password) { checkPassword(body.password); Object.assign(acc, await hashPassword(String(body.password))); bump = true; }
    if (body.active !== undefined) {
      if (username === LEAD_USER && !body.active) throw fail("Akun Ray tidak bisa dinonaktifkan.");
      if (acc.active !== !!body.active) { acc.active = !!body.active; bump = true; }
    }
    if (bump) acc.ver = (acc.ver || 1) + 1; // sesi lama di laptop itu otomatis keluar
  }
  await putAccounts(env, accounts);
  return { ok: true, account: publicUser(acc) };
}

async function deleteAccount(env, body) {
  const username = clean(body.username).toLowerCase();
  if (username === LEAD_USER) throw fail("Akun Ray tidak bisa dihapus.");
  const accounts = await getAccounts(env);
  if (!accounts[username]) throw fail("Akun tidak ditemukan.");
  delete accounts[username];
  await putAccounts(env, accounts);
  return { ok: true };
}

function checkPassword(p) {
  if (typeof p !== "string" || p.length < 8) throw fail("Password minimal 8 karakter.");
  if (p.length > 100) throw fail("Password maksimal 100 karakter.");
}

async function hashPassword(password, saltB64, iter = PBKDF2_ITER) {
  const salt = saltB64 ? b64ToBuf(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
  return { salt: bufToB64(salt), hash: bufToB64(new Uint8Array(bits)), iter };
}

async function verifyPassword(password, acc) {
  if (!acc || !acc.salt || !acc.hash) return false;
  const { hash } = await hashPassword(password, acc.salt, acc.iter || PBKDF2_ITER);
  return safeEqual(hash, acc.hash);
}

async function sessionKey(env) {
  const secret = env.LARK_APP_SECRET || env.ADMIN_PASSWORD;
  if (!secret) throw fail("Server belum diatur: LARK_APP_SECRET kosong.", 500);
  return crypto.subtle.importKey("raw", new TextEncoder().encode(`creative-aab-session|${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function signToken(env, acc) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: acc.username, v: acc.ver || 1, exp: Date.now() + SESSION_DAYS * 864e5 })));
  const sig = await crypto.subtle.sign("HMAC", await sessionKey(env), new TextEncoder().encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

async function verifyToken(env, token) {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = await crypto.subtle.sign("HMAC", await sessionKey(env), new TextEncoder().encode(payload));
  if (!safeEqual(sig, b64url(new Uint8Array(want)))) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64ToBuf(payload.replace(/-/g, "+").replace(/_/g, "/"))));
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
const bufToB64 = (u8) => btoa(String.fromCharCode(...u8));
const b64ToBuf = (s) => Uint8Array.from(atob(s.padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const b64url = (u8) => bufToB64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Tim hanya menerima request yang sudah di-approve. Ray menerima semua.
function forUser(state, me) {
  if (!state || !Array.isArray(state.requests) || MEMBERS[me.member]?.block === "lead") return state;
  return { ...state, requests: state.requests.filter((r) => r.approved) };
}

// ---------- Aktivitas dan dashboard Ray ----------

async function logActivity(env, me, text) {
  if (!me) return;
  const log = (await env.STORE.get("activity", "json")) || { items: [], last: {} };
  const at = new Date().toISOString();
  log.items.unshift({ at, who: me.username, member: me.member, text });
  log.items = log.items.slice(0, 40);
  log.last[me.member] = at;
  await env.STORE.put("activity", JSON.stringify(log));
}

async function dashboard(env) {
  const state = await getState(env, { member: "ray" });
  const log = (await env.STORE.get("activity", "json")) || { items: [], last: {} };
  const accounts = Object.values(await getAccounts(env)).map(publicUser);
  const reqs = state.requests || [];
  const open = reqs.filter((r) => r.status !== "done");
  const cal = await env.STORE.get("calcache", "json");
  const ep = await env.STORE.get("epcache", "json");
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // WIB
  let epInfo = null;
  if (ep && ep.configured) {
    const dec = (await env.STORE.get(`epdec:${ep.id}`, "json")) || {};
    epInfo = {
      total: ep.items.length,
      waiting: ep.items.filter((i) => !i.posted && !dec[i.id]).length,
      revisi: ep.items.filter((i) => !i.posted && dec[i.id] && dec[i.id].status === "REVISI").length,
      posted: ep.items.filter((i) => i.posted).length,
    };
  }
  return {
    ok: true,
    configured: !!state.configured,
    fetchedAt: state.fetchedAt || null,
    counts: state.counts || {},
    aigcReady: !!state.aigcReady,
    requests: {
      needDecision: open.filter((r) => !r.decision).length,
      pending: open.filter((r) => r.decision === "PENDING").length,
      rejected: open.filter((r) => r.decision === "REJECT").length,
      inProgress: open.filter((r) => r.approved).length,
      done: reqs.filter((r) => r.status === "done").length,
    },
    plan: cal && cal.configured ? weekPlan(cal.rows, today) : null,
    ep: epInfo,
    last: log.last,
    activity: log.items,
    accounts,
  };
}

// ---------- Lark ----------

async function larkToken(env) {
  const cached = await env.STORE.get("lark:token", "json");
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) return cached.token;
  const res = await fetch(`${LARK}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: env.LARK_APP_ID, app_secret: env.LARK_APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw fail(`Login ke Lark gagal (${data.code}): ${data.msg}. Cek App ID dan App Secret.`);
  const token = data.tenant_access_token;
  await env.STORE.put("lark:token", JSON.stringify({ token, expiresAt: Date.now() + data.expire * 1000 }));
  return token;
}

async function lark(env, method, path, payload) {
  const token = await larkToken(env);
  const res = await fetch(`${LARK}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({ code: -1, msg: `HTTP ${res.status}` }));
  if (data.code !== 0) {
    let hint = "";
    if ([91403, 1310213, 99991672, 99991679].includes(data.code)) {
      hint = " App belum punya akses ke file ini. Tambahkan app ke file lewat ⋯ > Add Apps, beri akses edit.";
    }
    throw fail(`Lark menolak (${data.code}): ${data.msg}.${hint}`);
  }
  return data.data;
}

async function readRanges(env, cfg, ranges) {
  const q = ranges.map((r) => encodeURIComponent(r)).join(",");
  const data = await lark(
    env,
    "GET",
    `/sheets/v2/spreadsheets/${cfg.token}/values_batch_get?ranges=${q}&valueRenderOption=ToString&dateTimeRenderOption=FormattedString`
  );
  return (data.valueRanges || []).map((vr) => vr.values || []);
}

async function writeRanges(env, cfg, valueRanges) {
  if (!valueRanges.length) return;
  await lark(env, "POST", `/sheets/v2/spreadsheets/${cfg.token}/values_batch_update`, { valueRanges });
}

async function writeImage(env, cfg, cell, base64, name) {
  const bytes = Array.from(base64ToBytes(base64));
  if (bytes.length > 3 * 1024 * 1024) throw fail("Gambar terlalu besar (maksimal 3 MB).");
  await lark(env, "POST", `/sheets/v2/spreadsheets/${cfg.token}/values_image`, {
    range: `${cfg.reportId}!${cell}:${cell}`,
    image: bytes,
    name,
  });
}

// ---------- Config ----------

async function getConfig(env) {
  const cfg = await env.STORE.get("config", "json");
  if (!cfg) throw fail("Link sheet bulan ini belum diisi. Buka Pengaturan di widget.", 409);
  return cfg;
}

async function setConfig(env, body) {
  const token = parseSpreadsheetToken(body.url || "");
  if (!token) throw fail("Link tidak dikenali. Tempel link sheet Lark yang berisi /sheets/...");
  const meta = await lark(env, "GET", `/sheets/v3/spreadsheets/${token}/sheets/query`);
  const sheets = meta.sheets || [];
  const find = (title) => sheets.find((s) => (s.title || "").trim().toLowerCase() === title.toLowerCase());
  const report = find(TAB_REPORT);
  const req = find(TAB_REQUEST);
  if (!report || !req) {
    throw fail(`Tab "${TAB_REPORT}" atau "${TAB_REQUEST}" tidak ditemukan di file ini.`);
  }
  const cfg = { token, reportId: report.sheet_id, requestId: req.sheet_id, setAt: new Date().toISOString() };

  // Cek header blok supaya tulisan tidak salah tempat.
  const [hdr] = await readRanges(env, cfg, [`${cfg.reportId}!A5:AK5`]);
  const row = (hdr[0] || []).map((v) => String(v ?? "").trim().toLowerCase());
  const at = (col) => row[colIndex(col) - 1] || "";
  const warnings = [];
  if (!at("G").includes("link")) warnings.push("Kolom G5 bukan 'Link Content'. Blok CONTENT mungkin bergeser.");
  if (!at("Q").includes("design")) warnings.push("Kolom Q5 bukan 'Hasil Design'. Blok DESIGN mungkin bergeser.");
  if (!at("V").includes("video")) warnings.push("Kolom V5 bukan 'Hasil Video'. Blok VIDEO mungkin bergeser.");
  if (!at("AJ").includes("produksi") || !at("AK").includes("upload")) {
    warnings.push("Blok AIGC (AH:AK) belum ada. Input Rifqi belum bisa dipakai sampai blok dibuat.");
  }
  cfg.aigcReady = at("AJ").includes("produksi") && at("AK").includes("upload");

  await env.STORE.put("config", JSON.stringify(cfg));
  await env.STORE.delete("cache");
  const state = await refresh(env, { force: true });
  return { ...state, warnings };
}

// ---------- State & refresh ----------

async function getState(env, me) {
  const cache = await env.STORE.get("cache", "json");
  if (cache) return forUser({ ok: true, ...cache }, me);
  const cfg = await env.STORE.get("config", "json");
  if (!cfg) return { ok: true, configured: false, requests: [], counts: {} };
  return forUser(await refresh(env, { force: true }), me);
}

async function refresh(env, { force }) {
  const cfg = await env.STORE.get("config", "json");
  if (!cfg) return { ok: true, configured: false, requests: [], counts: {} };
  const cache = await env.STORE.get("cache", "json");
  if (!force && cache && Date.now() - Date.parse(cache.fetchedAt) < REFRESH_COOLDOWN_MS) {
    return { ok: true, ...cache, note: "Data baru diambil kurang dari 1 menit lalu." };
  }
  const [reqRows, summary] = await readRanges(env, cfg, [
    `${cfg.requestId}!${REQUEST_RANGE}`,
    `${cfg.reportId}!A4:AK4`,
  ]);
  const requests = parseRequests(reqRows);
  const s = summary[0] || [];
  const num = (col) => toNumber(s[colIndex(col) - 1]);
  const counts = {
    content: num("G"),
    design: num("O"),
    video: num("T"),
    aigcProduksi: cfg.aigcReady ? num("AJ") : null,
    aigcUpload: cfg.aigcReady ? num("AK") : null,
  };
  const next = { configured: true, token: cfg.token, aigcReady: !!cfg.aigcReady, requests, counts, fetchedAt: new Date().toISOString() };
  const prev = cache ? JSON.stringify({ ...cache, fetchedAt: "" }) : "";
  // Tulis KV hanya kalau ada perubahan (hemat kuota tulis KV), kecuali cache sudah > 1 jam.
  const stale = !cache || Date.now() - Date.parse(cache.fetchedAt) > 60 * 60 * 1000;
  if (stale || prev !== JSON.stringify({ ...next, fetchedAt: "" })) {
    await env.STORE.put("cache", JSON.stringify(next));
  }
  return { ok: true, ...next };
}

export function parseRequests(rows) {
  const out = [];
  rows.forEach((r, i) => {
    const info = clean(r[3]);
    if (!info) return;
    const row = i + 2;
    const progress = clean(r[7]).toUpperCase();
    out.push({
      id: `${row}:${hash(info)}`,
      row,
      no: clean(r[0]),
      submitted: clean(r[1]),
      user: clean(r[2]),
      info,
      deadline: clean(r[4]),
      output: clean(r[5]),
      remark: clean(r[6]),
      decision: decisionOf(r[6]),
      approved: decisionOf(r[6]) === "APPROVE",
      progress,
      status: progress === "DONE" ? "done" : progress ? "pending" : "new",
    });
  });
  return out;
}

// ---------- KPI: CONTENT (Zahra) ----------

async function readContent(env, cfg) {
  const [rows] = await readRanges(env, cfg, [`${cfg.reportId}!A${FIRST_ROW}:K${LAST_ROW}`]);
  const byCode = new Map();
  let lastFilled = FIRST_ROW - 1;
  rows.forEach((r, i) => {
    const rowNum = FIRST_ROW + i;
    const hasData = clean(r[1]) || clean(r[6]);
    if (hasData) lastFilled = rowNum;
    const code = shortcode(r[6]);
    if (code) byCode.set(code, { row: rowNum, konten: clean(r[4]), pillar: clean(r[3]) });
  });
  return { byCode, nextRow: lastFilled + 1 };
}

async function contentPreview(env, body) {
  const cfg = await getConfig(env);
  const items = normalizeContent(body.rows);
  const { byCode } = await readContent(env, cfg);
  return {
    ok: true,
    rows: items.map((it) => {
      const hit = byCode.get(it.code);
      return { ...it, exists: !!hit, row: hit ? hit.row : null, sheetKonten: hit ? hit.konten : null };
    }),
  };
}

async function contentSubmit(env, body, me) {
  const cfg = await getConfig(env);
  const items = normalizeContent(body.rows);
  const { byCode, nextRow } = await readContent(env, cfg);
  const ranges = [];
  let updated = 0;
  let added = 0;
  let row = nextRow;
  for (const it of items) {
    const hit = byCode.get(it.code);
    if (hit) {
      ranges.push({ range: `${cfg.reportId}!H${hit.row}:K${hit.row}`, values: [[it.views, it.likes, it.comments, it.shares]] });
      updated++;
    } else {
      if (!it.pillar) throw fail(`Content Pillar belum dipilih untuk: ${it.konten.slice(0, 40)}`);
      if (row > LAST_ROW) throw fail("Blok CONTENT sudah penuh sampai baris 300.");
      ranges.push({
        range: `${cfg.reportId}!A${row}:K${row}`,
        values: [[row - FIRST_ROW + 1, it.tanggal, it.account, it.pillar, it.konten, it.kategori, it.link, it.views, it.likes, it.comments, it.shares]],
      });
      byCode.set(it.code, { row });
      row++;
      added++;
    }
  }
  await writeRanges(env, cfg, ranges);
  await logActivity(env, me, `CONTENT: ${added} konten baru, ${updated} diperbarui`);
  await refresh(env, { force: true }).catch(() => {});
  return { ok: true, updated, added };
}

export function normalizeContent(rows) {
  if (!Array.isArray(rows) || !rows.length) throw fail("Tidak ada data konten yang dikirim.");
  if (rows.length > 200) throw fail("Maksimal 200 konten sekali kirim.");
  return rows.map((r) => {
    const link = clean(r.link);
    const code = shortcode(link);
    if (!code) throw fail(`Link bukan link postingan Instagram: ${link || "(kosong)"}`);
    return {
      code,
      link: `https://www.instagram.com/p/${code}/`,
      tanggal: clean(r.tanggal),
      account: clean(r.account),
      pillar: clean(r.pillar),
      konten: clean(r.konten),
      kategori: clean(r.kategori),
      views: toNumber(r.views),
      likes: toNumber(r.likes),
      comments: toNumber(r.comments),
      shares: toNumber(r.shares),
    };
  });
}

// ---------- KPI: DESIGN (Athallah) dan VIDEO (Albar) ----------

async function appendImageRow(env, kind, body, me) {
  const cfg = await getConfig(env);
  const b = BLOCKS[kind];
  const info = clean(body.info);
  const tanggal = clean(body.tanggal);
  if (!info) throw fail("Informasi detil wajib diisi.");
  if (!tanggal) throw fail("Tanggal wajib diisi.");
  if (!body.image) throw fail("Gambar bukti wajib ada.");
  const row = await nextEmptyRow(env, cfg, b.key);
  const infoCol = kind === "design" ? "P" : "U";
  const imgCol = kind === "design" ? "Q" : "V";
  const text = kind === "video" && clean(body.link) ? `${info} ${clean(body.link)}` : info;
  await writeRanges(env, cfg, [
    { range: `${cfg.reportId}!${b.first}${row}:${infoCol}${row}`, values: [[row - FIRST_ROW + 1, tanggal, text]] },
  ]);
  await writeImage(env, cfg, `${imgCol}${row}`, body.image, `${kind}-${row}.jpg`);
  await logActivity(env, me, `${kind.toUpperCase()}: ${info.slice(0, 60)}`);
  await refresh(env, { force: true }).catch(() => {});
  return { ok: true, row };
}

// Cek baris dari Excel mana yang sudah ada di blok (cocokkan tanggal + informasi detil).
async function imageRowsPreview(env, kind, body) {
  const cfg = await getConfig(env);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 300) : [];
  if (!rows.length) throw fail("Tidak ada baris yang dikirim.");
  const b = BLOCKS[kind];
  const infoCol = kind === "design" ? "P" : "U";
  const [cur] = await readRanges(env, cfg, [`${cfg.reportId}!${b.key}${FIRST_ROW}:${infoCol}${LAST_ROW}`]);
  const have = new Set();
  cur.forEach((r) => {
    const info = clean(r[1]);
    if (info) have.add(`${normDate(r[0])}|${normText(info)}`);
  });
  return {
    ok: true,
    rows: rows.map((r) => ({ exists: have.has(`${normDate(r.tanggal)}|${normText(r.info)}`) })),
  };
}

const BULAN = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };

// Samakan format tanggal: "25/10/2026", "30 okt 26", "2026-10-01" menjadi "2026-10-25".
export function normDate(v) {
  const s = clean(v).toLowerCase();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${+m[2]}-${+m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${+m[2]}-${+m[1]}`;
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s-]+(\d{2,4})$/);
  if (m && BULAN[m[2]]) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${BULAN[m[2]]}-${+m[1]}`;
  return s;
}

function normText(v) {
  return clean(v).toLowerCase().replace(/\s+/g, " ");
}

// ---------- KPI: AIGC (Rifqi) ----------

async function upsertAigc(env, body, me) {
  const cfg = await getConfig(env);
  if (!cfg.aigcReady) throw fail("Blok AIGC (AH:AK) belum ada di sheet. Buat dulu, lalu simpan ulang link di Pengaturan.");
  const tanggal = clean(body.tanggal);
  if (!tanggal) throw fail("Tanggal wajib diisi.");
  const produksi = toNumber(body.produksi);
  const upload = toNumber(body.upload);
  const [rows] = await readRanges(env, cfg, [`${cfg.reportId}!AI${FIRST_ROW}:AI${LAST_ROW}`]);
  let row = null;
  let lastFilled = FIRST_ROW - 1;
  rows.forEach((r, i) => {
    const v = clean(r[0]);
    if (v) lastFilled = FIRST_ROW + i;
    if (v === tanggal) row = FIRST_ROW + i;
  });
  const replaced = !!row;
  if (!row) row = lastFilled + 1;
  await writeRanges(env, cfg, [
    { range: `${cfg.reportId}!AH${row}:AK${row}`, values: [[row - FIRST_ROW + 1, tanggal, produksi, upload]] },
  ]);
  await logActivity(env, me, `AIGC ${tanggal}: ${produksi} produksi, ${upload} upload`);
  await refresh(env, { force: true }).catch(() => {});
  return { ok: true, row, replaced };
}

// ---------- Request selesai ----------

async function requestDone(env, body, me) {
  const cfg = await getConfig(env);
  const row = await checkRequestRow(env, cfg, body);
  const link = clean(body.link);
  if (!/^https?:\/\//i.test(link)) throw fail("Isi link output yang diawali https://");
  await writeRanges(env, cfg, [
    { range: `${cfg.requestId}!F${row}:F${row}`, values: [[link]] },
    { range: `${cfg.requestId}!H${row}:H${row}`, values: [["DONE"]] },
  ]);
  await logActivity(env, me, `Request selesai (baris ${row})`);
  await refresh(env, { force: true }).catch(() => {});
  return { ok: true };
}

// ---------- Keputusan Ray: APPROVE / PENDING / REJECT di kolom G ----------

const DECISIONS = ["APPROVE", "PENDING", "REJECT"];

export function decisionOf(v) {
  const s = clean(v).toUpperCase();
  return DECISIONS.find((d) => s.includes(d)) || "";
}

async function requestDecision(env, body, me) {
  const decision = clean(body.decision).toUpperCase();
  if (!DECISIONS.includes(decision)) throw fail("Keputusan harus APPROVE, PENDING, atau REJECT.");
  const cfg = await getConfig(env);
  const row = await checkRequestRow(env, cfg, body);
  await writeRanges(env, cfg, [{ range: `${cfg.requestId}!G${row}:G${row}`, values: [[decision]] }]);
  await logActivity(env, me, `Request baris ${row}: ${decision}`);
  await refresh(env, { force: true }).catch(() => {});
  return { ok: true, decision };
}

async function checkRequestRow(env, cfg, body) {
  const row = Number(body.row);
  if (!Number.isInteger(row) || row < 2) throw fail("Baris request tidak valid.");
  const [cur] = await readRanges(env, cfg, [`${cfg.requestId}!D${row}:D${row}`]);
  const info = clean((cur[0] || [])[0]);
  if (!info || `${row}:${hash(info)}` !== body.id) {
    throw fail("Isi request di baris ini sudah berubah di sheet. Muat ulang widget lalu coba lagi.", 409);
  }
  return row;
}

// ---------- Google (Content Calendar dan EP) ----------
// Akses lewat service account. Secret GOOGLE_SA berisi isi file JSON kunci service account.
// Tiap file bulanan dibagikan (Editor) ke email service account itu.

const GOOGLE_SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/presentations";
const CAL_FIRST_ROW = 4; // header di baris 3
const CAL_LAST_ROW = 400;
const EP_DECISIONS = ["OKE", "REVISI"];

function serviceAccount(env) {
  if (!env.GOOGLE_SA) throw fail("Akses Google belum diatur di server (secret GOOGLE_SA kosong).", 409);
  try {
    const sa = JSON.parse(env.GOOGLE_SA);
    if (!sa.client_email || !sa.private_key) throw new Error();
    return sa;
  } catch {
    throw fail("Secret GOOGLE_SA bukan file JSON service account yang benar.", 500);
  }
}

async function googleToken(env) {
  const cached = await env.STORE.get("google:token", "json");
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) return cached.token;
  const sa = serviceAccount(env);
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: sa.client_email, scope: GOOGLE_SCOPES, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", b64ToBuf(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${b64url(new Uint8Array(sig))}`,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw fail(`Login ke Google gagal: ${data.error_description || data.error || res.status}. Cek secret GOOGLE_SA.`, 502);
  await env.STORE.put("google:token", JSON.stringify({ token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 }));
  return data.access_token;
}

async function google(env, method, url, payload) {
  const token = await googleToken(env);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const sa = serviceAccount(env).client_email;
    if (res.status === 403 || res.status === 404) {
      throw fail(`Google menolak akses (${res.status}). Bagikan file ini sebagai Editor ke ${sa}.`, 409);
    }
    throw fail(`Google error ${res.status}: ${(data.error && data.error.message) || "tidak diketahui"}`, 502);
  }
  return data;
}

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const SLIDES = "https://slides.googleapis.com/v1/presentations";

export function parseGoogleId(url, kind) {
  const m = String(url || "").match(kind === "sheet" ? /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/ : /\/presentation\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

async function getGoogleConfig(env) {
  return (await env.STORE.get("gconfig", "json")) || {};
}

async function googleConfigInfo(env) {
  const g = await getGoogleConfig(env);
  let email = "";
  try { email = serviceAccount(env).client_email; } catch { email = ""; }
  return { ok: true, serviceAccount: email, calendar: g.calendar || null, ep: g.ep || null };
}

async function setGoogleConfig(env, body) {
  const g = await getGoogleConfig(env);
  const warnings = [];
  if (body.calendarUrl !== undefined && clean(body.calendarUrl)) {
    const id = parseGoogleId(body.calendarUrl, "sheet");
    if (!id) throw fail("Link Content Calendar harus link Google Sheets (docs.google.com/spreadsheets/d/...).");
    const meta = await google(env, "GET", `${SHEETS}/${id}?fields=properties.title,sheets.properties(sheetId,title)`);
    const titles = meta.sheets.map((s) => s.properties.title);
    const heads = await google(env, "GET", `${SHEETS}/${id}/values:batchGet?${titles.map((t) => `ranges=${encodeURIComponent(`'${t}'!B3:M3`)}`).join("&")}`);
    const tabs = [];
    heads.valueRanges.forEach((vr, i) => {
      const h = ((vr.values || [])[0] || []).map((x) => String(x).trim().toLowerCase());
      if (h[0] === "#" && h[4] === "content" && h[5] === "date") tabs.push({ title: titles[i], account: titles[i].trim().split(/\s+/)[0].toUpperCase() });
    });
    if (!tabs.length) throw fail('Tidak ada tab content plan di file ini (header baris 3: # | Content Pillar | ... | Content | Date).');
    let options = { pillars: [], formats: [], platforms: [] };
    if (titles.includes("Settings")) {
      const s = await google(env, "GET", `${SHEETS}/${id}/values:batchGet?ranges=${encodeURIComponent("Settings!C12:C40")}&ranges=${encodeURIComponent("Settings!G12:G40")}&ranges=${encodeURIComponent("Settings!K12:K40")}`);
      const col = (vr) => (vr.values || []).map((r) => clean(r[0])).filter(Boolean);
      options = { pillars: col(s.valueRanges[0]), formats: col(s.valueRanges[1]), platforms: col(s.valueRanges[2]) };
    } else warnings.push("Tab Settings tidak ditemukan. Pilihan pillar dan format diketik manual.");
    g.calendar = { id, title: meta.properties.title, tabs, options, setAt: new Date().toISOString() };
  }
  if (body.epUrl !== undefined && clean(body.epUrl)) {
    const id = parseGoogleId(body.epUrl, "slides");
    if (!id) throw fail("Link EP harus link Google Slides (docs.google.com/presentation/d/...).");
    const meta = await google(env, "GET", `${SLIDES}/${id}?fields=title`);
    g.ep = { id, title: meta.title, setAt: new Date().toISOString() };
  }
  await env.STORE.put("gconfig", JSON.stringify(g));
  await env.STORE.delete("calcache");
  await env.STORE.delete("epcache");
  const out = { ...(await googleConfigInfo(env)), warnings };
  if (g.calendar) out.calendarRows = (await refreshCalendar(env)).rows.length;
  if (g.ep) out.epItems = (await refreshEp(env)).items.length;
  return out;
}

// ----- Content Calendar -----

const serialToISO = (n) => {
  const d = new Date(Math.round((Number(n) - 25569) * 86400000));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

export function parseCalendarRows(values, tab) {
  const rows = [];
  (values || []).forEach((r, i) => {
    const row = CAL_FIRST_ROW + i;
    const v = (k) => r[k] === undefined || r[k] === null ? "" : r[k];
    const content = clean(v(4));
    const date = typeof v(5) === "number" ? serialToISO(v(5)) : clean(v(5));
    const pillar = clean(v(1)), format = clean(v(2)), platform = clean(v(3)), note = clean(v(6)), fa = clean(v(7)), link = clean(v(8));
    if (!content && !date && !pillar && !format && !link && !fa) return;
    rows.push({
      id: `${tab.account}:${row}:${hash(`${content}|${date}`)}`,
      tab: tab.title, account: tab.account, row, no: clean(v(0)),
      pillar, format, platform, content, date, note, fa, link,
      noPosting: /^no posting$/i.test(content),
      take: v(9) === true, editing: v(10) === true, posting: v(11) === true,
    });
  });
  return rows;
}

async function readCalendar(env, cal) {
  const ranges = cal.tabs.map((t) => `ranges=${encodeURIComponent(`'${t.title}'!B${CAL_FIRST_ROW}:M${CAL_LAST_ROW}`)}`).join("&");
  const data = await google(env, "GET", `${SHEETS}/${cal.id}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  return cal.tabs.map((t, i) => ({ tab: t, values: data.valueRanges[i].values || [] }));
}

async function refreshCalendar(env) {
  const g = await getGoogleConfig(env);
  if (!g.calendar) return { configured: false, rows: [] };
  const parts = await readCalendar(env, g.calendar);
  const rows = parts.flatMap((p) => parseCalendarRows(p.values, p.tab));
  const out = { configured: true, title: g.calendar.title, id: g.calendar.id, accounts: g.calendar.tabs.map((t) => t.account), options: g.calendar.options, rows, fetchedAt: new Date().toISOString() };
  await env.STORE.put("calcache", JSON.stringify(out));
  return out;
}

async function getCalendar(env) {
  const c = await env.STORE.get("calcache", "json");
  return { ok: true, ...(c || (await refreshCalendar(env))) };
}

function calendarValues(b) {
  const noPosting = !!b.noPosting;
  const date = clean(b.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail("Tanggal wajib diisi.");
  const content = noPosting ? "NO POSTING" : clean(b.content);
  if (!content) throw fail("Judul konten wajib diisi, atau pilih No posting.");
  const t = (x) => (noPosting ? "" : clean(x));
  return [t(b.pillar), t(b.format), t(b.platform), content, date, t(b.note), t(b.fa), t(b.link), noPosting ? false : !!b.take, noPosting ? false : !!b.editing, noPosting ? false : !!b.posting];
}

async function calendarSave(env, body, me) {
  const g = await getGoogleConfig(env);
  if (!g.calendar) throw fail("Link Content Calendar belum diisi. Ray isi di Pengaturan.", 409);
  const tab = g.calendar.tabs.find((t) => t.account === clean(body.account).toUpperCase());
  if (!tab) throw fail("Pilih akun AAB atau NUSANTARA.");
  const vals = calendarValues(body);
  const [part] = await readCalendar(env, { ...g.calendar, tabs: [tab] });
  const existing = parseCalendarRows(part.values, tab);
  let row;
  if (body.id) {
    const hit = existing.find((r) => r.id === body.id);
    if (!hit) throw fail("Baris ini sudah berubah di sheet. Muat ulang lalu coba lagi.", 409);
    row = hit.row;
  } else {
    const last = existing.reduce((m, r) => Math.max(m, r.row), CAL_FIRST_ROW - 1);
    row = last + 1;
    if (row > CAL_LAST_ROW) throw fail(`Tab ${tab.title} sudah penuh sampai baris ${CAL_LAST_ROW}.`);
  }
  await google(env, "POST", `${SHEETS}/${g.calendar.id}/values:batchUpdate`, {
    valueInputOption: "USER_ENTERED",
    data: [{ range: `'${tab.title}'!C${row}:M${row}`, values: [vals] }],
  });
  await logActivity(env, me, `Kalender ${tab.account}: ${body.id ? "ubah" : "tambah"} "${vals[3].slice(0, 50)}" (${vals[4]})`);
  const cal = await refreshCalendar(env);
  return { ok: true, row, calendar: cal };
}

async function calendarToggle(env, body, me) {
  const g = await getGoogleConfig(env);
  if (!g.calendar) throw fail("Link Content Calendar belum diisi.", 409);
  const col = { take: "K", editing: "L", posting: "M" }[body.field];
  if (!col) throw fail("Kolom tidak dikenal.");
  const cal = await refreshCalendar(env);
  const hit = cal.rows.find((r) => r.id === body.id);
  if (!hit) throw fail("Baris ini sudah berubah di sheet. Muat ulang lalu coba lagi.", 409);
  await google(env, "POST", `${SHEETS}/${g.calendar.id}/values:batchUpdate`, {
    valueInputOption: "USER_ENTERED",
    data: [{ range: `'${hit.tab}'!${col}${hit.row}`, values: [[!!body.value]] }],
  });
  return { ok: true, calendar: await refreshCalendar(env) };
}

// ----- EP (Google Slides) -----

const BULAN_ID = { januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12 };

export function parseIndoDate(s) {
  const m = String(s || "").toLowerCase().match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (!m || !BULAN_ID[m[2]]) return "";
  return `${m[3]}-${String(BULAN_ID[m[2]]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
}

const textOf = (t) => ((t && t.textElements) || []).map((e) => (e.textRun ? e.textRun.content : "")).join("");

function elementTexts(el, out) {
  if (el.shape && el.shape.text) out.push({ id: el.objectId, text: textOf(el.shape.text), y: (el.transform && el.transform.translateY) || 0, x: (el.transform && el.transform.translateX) || 0 });
  if (el.table) {
    const cells = (el.table.tableRows || []).map((r) => (r.tableCells || []).map((c) => textOf(c.text).trim()).join("\n"));
    out.push({ id: el.objectId, text: cells.join("\n"), y: (el.transform && el.transform.translateY) || 0, x: (el.transform && el.transform.translateX) || 0, table: true });
  }
  if (el.elementGroup) (el.elementGroup.children || []).forEach((c) => elementTexts(c, out));
  return out;
}

const field = (text, re) => { const m = text.match(re); return m ? m[1].replace(/\s+/g, " ").trim() : ""; };

export function parseEpSlides(slides) {
  let section = "AAB";
  const items = [];
  for (const s of slides || []) {
    const parts = (s.pageElements || []).flatMap((el) => elementTexts(el, []));
    const all = parts.map((p) => p.text).join("\n");
    const flat = all.replace(/\u000b/g, "\n");
    if (!/FORMAT\s*:/i.test(flat)) {
      const t = flat.trim().toUpperCase();
      if (/^NUSANTARA$/.test(t)) section = "NUSANTARA";
      else if (/^TEMPLATE$/.test(t)) section = "TEMPLATE";
      else if (/EDITORIAL PLAN/.test(t)) section = "AAB";
      continue;
    }
    if (section === "TEMPLATE") continue;
    const posted = parts.some((p) => !p.table && p.text.trim().toUpperCase() === "POSTED");
    const cover = field(flat, /(?:COVER|JUDUL)\s*:[ \t]*([^\n]*)/i);
    const talentM = flat.match(/Talent\s*:[ \t]*\n?([^\n]*)/i);
    const talent = talentM ? talentM[1].trim() : "";
    const uploadRaw = field(flat, /Upload\s*:\s*([^\n]+)/i);
    const blank = (x) => !x || /^[.…\-\s]*$/.test(x);
    items.push({
      id: s.objectId,
      account: section,
      format: field(flat, /FORMAT\s*:[ \t]*([^\n]*)/i),
      cover: blank(cover) ? "" : cover,
      talent: blank(talent) ? "" : talent,
      uploadText: blank(uploadRaw) ? "" : uploadRaw,
      date: parseIndoDate(uploadRaw),
      reference: field(flat, /Reference\s*:\s*(https?:\/\/\S+)/i),
      posted,
      body: parts.filter((p) => p.text.trim().toUpperCase() !== "POSTED").sort((a, b) => a.y - b.y || a.x - b.x).map((p) => p.text.trim()).filter(Boolean).join("\n\n").slice(0, 4000),
    });
  }
  return items;
}

const EP_FIELDS = "slides(objectId,pageElements(objectId,transform,shape(text(textElements(textRun(content)))),table(tableRows(tableCells(text(textElements(textRun(content)))))),elementGroup(children(objectId,transform,shape(text(textElements(textRun(content)))),table(tableRows(tableCells(text(textElements(textRun(content)))))),elementGroup(children(objectId,transform,shape(text(textElements(textRun(content))))))))))";

async function refreshEp(env) {
  const g = await getGoogleConfig(env);
  if (!g.ep) return { configured: false, items: [] };
  const pres = await google(env, "GET", `${SLIDES}/${g.ep.id}?fields=${encodeURIComponent(EP_FIELDS)}`);
  const items = parseEpSlides(pres.slides);
  const out = { configured: true, id: g.ep.id, title: g.ep.title, items, fetchedAt: new Date().toISOString() };
  await env.STORE.put("epcache", JSON.stringify(out));
  return out;
}

async function getEp(env, me) {
  const c = (await env.STORE.get("epcache", "json")) || (await refreshEp(env));
  if (!c.configured) return { ok: true, ...c };
  const decisions = (await env.STORE.get(`epdec:${c.id}`, "json")) || {};
  const lead = MEMBERS[me.member]?.block === "lead";
  return {
    ok: true,
    ...c,
    items: c.items.map((it) => ({ ...it, decision: decisions[it.id] || null })),
    canDecide: lead,
    canPost: lead || MEMBERS[me.member]?.block === "content",
  };
}

async function epDecision(env, body, me) {
  const g = await getGoogleConfig(env);
  if (!g.ep) throw fail("Link EP belum diisi.", 409);
  const status = clean(body.status).toUpperCase();
  if (![...EP_DECISIONS, ""].includes(status)) throw fail("Status harus OKE atau REVISI.");
  const note = clean(body.note).slice(0, 1000);
  if (status === "REVISI" && !note) throw fail("Tulis catatan revisinya.");
  const c = (await env.STORE.get("epcache", "json")) || (await refreshEp(env));
  const item = c.items.find((x) => x.id === body.id);
  if (!item) throw fail("Slide ini tidak ditemukan lagi di EP. Muat ulang.", 409);
  const key = `epdec:${g.ep.id}`;
  const decisions = (await env.STORE.get(key, "json")) || {};
  if (status) decisions[item.id] = { status, note: status === "REVISI" ? note : "", at: new Date().toISOString(), by: me.username, seq: Date.now() };
  else delete decisions[item.id];
  await env.STORE.put(key, JSON.stringify(decisions));
  await logActivity(env, me, `EP "${(item.cover || item.format).slice(0, 40)}": ${status || "status dihapus"}`);
  return getEp(env, me);
}

// Stempel POSTED: salin gaya stempel POSTED yang sudah ada di presentasi.
async function findPostedTemplate(env, presId) {
  const key = `eptpl:${presId}`;
  const cached = await env.STORE.get(key, "json");
  if (cached) return cached;
  const pres = await google(env, "GET", `${SLIDES}/${presId}?fields=${encodeURIComponent("slides(objectId,pageElements(objectId,size,transform,shape))")}`);
  for (const s of pres.slides || []) {
    for (const el of s.pageElements || []) {
      if (el.shape && el.shape.text && textOf(el.shape.text).trim().toUpperCase() === "POSTED") {
        await env.STORE.put(key, JSON.stringify(el), { expirationTtl: 7 * 86400 });
        return el;
      }
    }
  }
  return null;
}

export function postedRequests(pageId, tpl) {
  const id = `posted_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const size = tpl ? tpl.size : { width: { magnitude: 2400000, unit: "EMU" }, height: { magnitude: 600000, unit: "EMU" } };
  const transform = tpl ? tpl.transform : { scaleX: 1, scaleY: 1, translateX: 6300000, translateY: 4300000, unit: "EMU" };
  const reqs = [
    { createShape: { objectId: id, shapeType: (tpl && tpl.shape.shapeType) || "TEXT_BOX", elementProperties: { pageObjectId: pageId, size, transform } } },
    { insertText: { objectId: id, text: "POSTED" } },
  ];
  const run = tpl && (tpl.shape.text.textElements || []).find((e) => e.textRun && e.textRun.content.trim());
  const style = run ? run.textRun.style || {} : { bold: true, fontSize: { magnitude: 28, unit: "PT" }, foregroundColor: { opaqueColor: { rgbColor: { red: 0.85, green: 0.1, blue: 0.1 } } } };
  const keys = ["bold", "italic", "underline", "fontFamily", "fontSize", "foregroundColor", "weightedFontFamily"].filter((k) => style[k] !== undefined);
  if (keys.length) {
    const s = {}; keys.forEach((k) => { s[k] = style[k]; });
    reqs.push({ updateTextStyle: { objectId: id, style: s, fields: keys.join(","), textRange: { type: "ALL" } } });
  }
  const sp = tpl && tpl.shape.shapeProperties;
  if (sp) {
    const p = {}; const f = [];
    for (const k of ["shapeBackgroundFill", "outline", "contentAlignment"]) {
      if (sp[k] === undefined) continue;
      const v = JSON.parse(JSON.stringify(sp[k]));
      if (v && v.propertyState === undefined && (k === "shapeBackgroundFill" || k === "outline")) delete v.propertyState;
      p[k] = v; f.push(k);
    }
    if (f.length) reqs.push({ updateShapeProperties: { objectId: id, shapeProperties: p, fields: f.join(",") } });
  }
  const para = tpl && (tpl.shape.text.textElements || []).find((e) => e.paragraphMarker && e.paragraphMarker.style && e.paragraphMarker.style.alignment);
  reqs.push({ updateParagraphStyle: { objectId: id, style: { alignment: para ? para.paragraphMarker.style.alignment : "CENTER" }, fields: "alignment", textRange: { type: "ALL" } } });
  return reqs;
}

async function epPosted(env, body, me) {
  const g = await getGoogleConfig(env);
  if (!g.ep) throw fail("Link EP belum diisi.", 409);
  const link = clean(body.link);
  if (link && !/^https?:\/\//i.test(link)) throw fail("Link post harus diawali https://");
  const ep = await refreshEp(env);
  const item = ep.items.find((x) => x.id === body.id);
  if (!item) throw fail("Slide ini tidak ditemukan lagi di EP. Muat ulang.", 409);
  let stamped = false;
  if (!item.posted) {
    const tpl = await findPostedTemplate(env, g.ep.id);
    await google(env, "POST", `${SLIDES}/${g.ep.id}:batchUpdate`, { requests: postedRequests(item.id, tpl) });
    stamped = true;
  }
  let calendarRow = null;
  if (body.calendarId) {
    if (!g.calendar) throw fail("Link Content Calendar belum diisi.", 409);
    const cal = await refreshCalendar(env);
    const hit = cal.rows.find((r) => r.id === body.calendarId);
    if (!hit) throw fail("Baris kalender berubah. Muat ulang lalu coba lagi.", 409);
    const data = [{ range: `'${hit.tab}'!M${hit.row}`, values: [[true]] }];
    if (link) data.push({ range: `'${hit.tab}'!J${hit.row}`, values: [[link]] });
    await google(env, "POST", `${SHEETS}/${g.calendar.id}/values:batchUpdate`, { valueInputOption: "USER_ENTERED", data });
    calendarRow = hit.row;
    await refreshCalendar(env);
  }
  await refreshEp(env);
  await logActivity(env, me, `POSTED: "${(item.cover || item.format).slice(0, 40)}"`);
  return { ok: true, stamped, calendarRow, ep: await getEp(env, me) };
}

async function googleRefreshAll(env) {
  const g = await getGoogleConfig(env);
  if (g.calendar) await refreshCalendar(env).catch(() => {});
  if (g.ep) await refreshEp(env).catch(() => {});
}

// Ringkasan content plan minggu ini (Senin sampai Minggu, WIB) untuk dashboard Ray.
export function weekPlan(rows, todayISO) {
  const t = new Date(`${todayISO}T00:00:00Z`);
  const dow = (t.getUTCDay() + 6) % 7;
  const start = new Date(t.getTime() - dow * 864e5).toISOString().slice(0, 10);
  const end = new Date(t.getTime() + (6 - dow) * 864e5).toISOString().slice(0, 10);
  const inWeek = rows.filter((r) => r.date >= start && r.date <= end && !r.noPosting && r.content);
  const by = {};
  for (const r of inWeek) {
    const a = (by[r.account] ||= { planned: 0, posted: 0, late: 0 });
    a.planned++;
    if (r.posting) a.posted++;
    else if (r.date < todayISO) a.late++;
  }
  return { start, end, accounts: by };
}

// ---------- Helpers ----------

async function nextEmptyRow(env, cfg, keyCol) {
  const [rows] = await readRanges(env, cfg, [`${cfg.reportId}!${keyCol}${FIRST_ROW}:${keyCol}${LAST_ROW}`]);
  let lastFilled = FIRST_ROW - 1;
  rows.forEach((r, i) => {
    if (clean(r[0])) lastFilled = FIRST_ROW + i;
  });
  if (lastFilled + 1 > LAST_ROW) throw fail("Blok sudah penuh sampai baris 300.");
  return lastFilled + 1;
}

export function parseSpreadsheetToken(url) {
  const m = String(url).match(/\/sheets\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

export function shortcode(v) {
  const m = String(v ?? "").match(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export function colIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function clean(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" && x ? x.text || x.link || "" : x)).join("").trim();
  if (typeof v === "object") return String(v.text || v.link || "").trim();
  return String(v).trim();
}

function toNumber(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function base64ToBytes(b64) {
  const s = atob(String(b64).replace(/^data:[^,]+,/, ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return res;
}
