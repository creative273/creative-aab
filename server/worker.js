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
      if (url.pathname === "/m" ) return Response.redirect(`${url.origin}/m/`, 301);
      if (url.pathname.startsWith("/m/") && request.method === "GET") return serveMobile(url.pathname);
      const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
      const route = `${request.method} ${url.pathname}`;
      if (route === "POST /api/login") return cors(json(await login(env, body)));

      const me = await authenticate(env, request);
      // Siapa boleh apa. "all" = semua akun aktif. Nama blok = pemilik blok itu. Ray (lead) boleh semua.
      const R = {
        "GET /api/state": ["all", () => fullState(env, me)],
        "POST /api/refresh": ["lead", () => refreshAll(env, me)],
        "GET /api/me": ["all", () => ({ ok: true, user: publicUser(me) })],
        "POST /api/me/photo": ["all", () => setPhoto(env, me, body)],
        "GET /api/photos": ["all", () => getPhotos(env)],
        "POST /api/me/profile": ["all", () => setProfile(env, me, body)],
        "GET /api/profile/cover": ["all", () => getCover(env, url)],
        "GET /api/feed": ["all", () => getFeed(env, me, url)],
        "GET /api/feed/image": ["all", () => feedImage(env, url)],
        "POST /api/feed/post": ["all", () => feedPost(env, me, body)],
        "POST /api/feed/edit": ["all", () => feedEdit(env, me, body)],
        "POST /api/feed/comment": ["all", () => feedComment(env, me, body)],
        "POST /api/feed/react": ["all", () => feedReact(env, me, body)],
        "POST /api/feed/delete": ["all", () => feedDelete(env, me, body)],
        "GET /api/feed/item": ["all", () => feedOne(env, me, url)],
        "GET /api/notif": ["all", () => getNotif(env, me)],
        "GET /api/push": ["all", () => pushInfo(env, me, url)],
        "POST /api/push/subscribe": ["all", () => pushSubscribe(env, me, body)],
        "POST /api/push/unsubscribe": ["all", () => pushUnsubscribe(env, me, body)],
        "POST /api/notif/read": ["all", () => readNotif(env, me, body)],
        "POST /api/app/update-request": ["lead", () => requestUpdate(env, me, body)],
        "GET /api/app/versions": ["lead", async () => ({ ok: true, versions: appVersions(await getAccounts(env)) })],
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
        "GET /api/ep/thumb": ["all", () => epThumb(env, url)],
        "POST /api/ep/decision": ["lead", () => epDecision(env, body, me)],
        "POST /api/ep/posted": ["content", () => epPosted(env, body, me)],
        "GET /api/calendar": ["content", () => getCalendar(env)],
        "GET /api/ig": ["all", () => igOverview(env)],
        "POST /api/ig/connect": ["lead", () => igConnect(env, body)],
        "POST /api/ig/disconnect": ["lead", () => igDisconnect(env, body)],
        "POST /api/ig/sync": ["lead", () => igManualSync(env)],
        "GET /api/ig/new": ["content", () => igNewPosts(env)],
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
    // Berurutan: Lark dulu, lalu Google, lalu Instagram dengan jatah panggilan terbatas,
    // supaya batas 50 subrequest paket gratis tidak memutus pembaruan sheet.
    // Jam kerja (Senin sampai Sabtu, 08.00 sampai 18.59 WIB): semuanya tiap 10 menit.
    // Di luar jam kerja dan hari Minggu: hanya Instagram, tiap 30 menit, tanpa menyentuh sheet Lark.
    const w = new Date((event && event.scheduledTime) || Date.now());
    const wib = new Date(w.getTime() + 7 * 3600 * 1000);
    const work = wib.getUTCDay() !== 0 && wib.getUTCHours() >= 8 && wib.getUTCHours() < 19;
    if (!work && wib.getUTCMinutes() % 30 >= 10) return;
    ctx.waitUntil((async () => {
      if (work) {
        await refresh(env, { force: true }).catch(() => {});
        await googleRefreshAll(env).catch(() => {});
      }
      await igSync(env, { sheet: work }).catch(() => {});
    })());
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
  // Catat versi widget (untuk daftar versi di Pengaturan Ray). Ditulis hanya saat berubah.
  const v = (request.headers.get("X-App-Version") || "").trim();
  if (/^\d+\.\d+\.\d+$/.test(v) && acc.appVersion !== v) {
    const accounts = await getAccounts(env);
    if (accounts[acc.username]) { accounts[acc.username].appVersion = v; accounts[acc.username].appSeenAt = new Date().toISOString(); await putAccounts(env, accounts); }
    acc.appVersion = v;
  }
  return acc;
}

const verNum = (v) => String(v || "0.0.0").split(".").map(Number).reduce((a, n) => a * 1000 + (n || 0), 0);

// Ray minta semua laptop update: tiap akun dapat notifikasi "update", widget menampilkannya sebagai pop-up.
async function requestUpdate(env, me, body) {
  const version = clean(body.version);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw fail("Versi tidak dikenali.");
  const accounts = await getAccounts(env);
  const to = Object.values(accounts).filter((a) => a.active !== false && a.username !== me.username && verNum(a.appVersion) < verNum(version));
  const text = `Tolong update aplikasi ke v${version}. Buka Pengaturan, klik Cek pembaruan, lalu Restart.`;
  for (const a of to) await notify(env, a.username, { type: "update", by: me.username, version, text }).catch(() => {});
  return { ok: true, sent: to.map((a) => a.username), versions: appVersions(accounts) };
}

function appVersions(accounts) {
  return Object.values(accounts).filter((a) => a.active !== false).map((a) => ({ username: a.username, name: a.name || a.username, version: a.appVersion || "", seenAt: a.appSeenAt || null })).sort((a, b) => String(a.name || a.username).localeCompare(String(b.name || b.username)));
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
  await env.STORE.delete(`photo:${username}`);
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

// ---------- Foto profil ----------
// Disimpan per akun di KV (bukan di objek akun) supaya data akun yang dibaca tiap request tetap kecil.
const PHOTO_MAX = 80 * 1024;

async function setPhoto(env, me, body) {
  const img = String(body.image || "");
  const accounts = await getAccounts(env);
  const acc = accounts[me.username];
  if (!img) {
    await env.STORE.delete(`photo:${me.username}`);
    acc.photoVer = 0;
  } else {
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) throw fail("Format foto tidak dikenali. Pakai JPG atau PNG.");
    if (img.length > PHOTO_MAX) throw fail("Foto terlalu besar setelah dikompres. Coba foto lain.");
    await env.STORE.put(`photo:${me.username}`, img);
    acc.photoVer = Date.now();
  }
  await putAccounts(env, accounts);
  return { ok: true, photoVer: acc.photoVer };
}

async function getPhotos(env) {
  const accounts = Object.values(await getAccounts(env)).filter((a) => a.photoVer);
  const photos = {};
  await Promise.all(accounts.map(async (a) => { photos[a.username] = { ver: a.photoVer, image: await env.STORE.get(`photo:${a.username}`) }; }));
  return { ok: true, photos };
}

// ---------- Timeline dan profil tim (v1.5) ----------
// Isi timeline: postingan tim (teks, foto) dan kejadian otomatis dari widget (KPI, request, EP, POSTED).
// Tiap item disimpan di KV sendiri (feed:item:<id>) supaya komentar dan reaksi tidak saling timpa satu daftar besar.
// Daftar urutan ada di feed:index (maksimal FEED_KEEP item terbaru). Foto postingan di feed:img:<id>.
const FEED_KEEP = 300;
const FEED_PAGE = 15;
const FEED_TEXT_MAX = 2000;
const FEED_COMMENT_MAX = 500;
const FEED_IMG_MAX = 450 * 1024;
const COVER_MAX = 350 * 1024;
export const REACTIONS = ["like", "love", "haha", "wow", "fire"];

const feedId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const multiline = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

async function feedIndex(env) {
  return (await env.STORE.get("feed:index", "json")) || [];
}

async function feedInsert(env, item) {
  await env.STORE.put(`feed:item:${item.id}`, JSON.stringify(item));
  const idx = await feedIndex(env);
  idx.unshift({ id: item.id, at: item.at, by: item.by, kind: item.kind });
  const drop = idx.splice(FEED_KEEP);
  await env.STORE.put("feed:index", JSON.stringify(idx));
  for (const d of drop) {
    await env.STORE.delete(`feed:item:${d.id}`);
    await env.STORE.delete(`feed:img:${d.id}`);
  }
  return item;
}

// Kejadian otomatis. Gagal menulis timeline tidak boleh menggagalkan input KPI.
async function feedAuto(env, me, text, icon) {
  if (!me || !text) return;
  await feedInsert(env, { id: feedId(), at: new Date().toISOString(), by: me.username, member: me.member, kind: "auto", icon: icon || "info", text: String(text).slice(0, 300), reactions: {}, comments: [] }).catch(() => {});
}

function feedPublic(item, me) {
  const counts = {};
  for (const r of Object.values(item.reactions || {})) counts[r] = (counts[r] || 0) + 1;
  return {
    id: item.id, at: item.at, by: item.by, member: item.member, kind: item.kind, icon: item.icon || "", text: item.text,
    image: item.image ? { ver: item.image.ver, w: item.image.w, h: item.image.h } : null,
    reactions: counts, mine: (item.reactions || {})[me.username] || "", reactors: item.reactions || {},
    comments: item.comments || [], editedAt: item.editedAt || null,
  };
}

async function getFeed(env, me, url) {
  const before = url.searchParams.get("before") || "";
  const by = url.searchParams.get("by") || "";
  const kind = url.searchParams.get("kind") || "";
  const idx = (await feedIndex(env)).filter((x) => (!before || x.at < before) && (!by || x.by === by) && (!kind || x.kind === kind));
  const page = idx.slice(0, FEED_PAGE);
  const items = (await Promise.all(page.map((x) => env.STORE.get(`feed:item:${x.id}`, "json")))).filter(Boolean);
  return { ok: true, items: items.map((i) => feedPublic(i, me)), more: idx.length > page.length, latest: (await feedIndex(env))[0]?.at || null };
}

async function feedPost(env, me, body) {
  const text = multiline(body.text, FEED_TEXT_MAX);
  const img = String(body.image || "");
  if (!text && !img) throw fail("Tulis sesuatu atau pilih foto dulu.");
  const item = { id: feedId(), at: new Date().toISOString(), by: me.username, member: me.member, kind: "post", text, reactions: {}, comments: [] };
  if (img) {
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) throw fail("Format foto tidak dikenali. Pakai JPG atau PNG.");
    if (img.length > FEED_IMG_MAX) throw fail("Foto terlalu besar setelah dikompres. Coba foto lain.");
    await env.STORE.put(`feed:img:${item.id}`, img);
    item.image = { ver: Date.now(), w: clampInt(body.w, 1, 4000), h: clampInt(body.h, 1, 4000) };
  }
  await feedInsert(env, item);
  const accounts = await getAccounts(env);
  await notifyMany(env, mentionsIn(text, accounts).map((u) => [u, { type: "mention", by: me.username, postId: item.id, text: snippet(text) }]));
  return { ok: true, item: feedPublic(item, me) };
}

const clampInt = (v, a, b) => Math.min(b, Math.max(a, Math.round(Number(v) || a)));

async function feedLoad(env, id) {
  const item = id && (await env.STORE.get(`feed:item:${id}`, "json"));
  if (!item) throw fail("Postingan tidak ditemukan. Mungkin sudah dihapus.", 404);
  return item;
}

async function feedComment(env, me, body) {
  const text = multiline(body.text, FEED_COMMENT_MAX);
  if (!text) throw fail("Komentar masih kosong.");
  const item = await feedLoad(env, clean(body.id));
  item.comments = item.comments || [];
  if (item.comments.length >= 200) throw fail("Komentar di postingan ini sudah terlalu banyak.");
  const before = item.comments.map((c) => c.by);
  item.comments.push({ id: feedId(), at: new Date().toISOString(), by: me.username, text });
  await env.STORE.put(`feed:item:${item.id}`, JSON.stringify(item));
  // Urutan prioritas: yang ditag, pemilik postingan, lalu yang sudah ikut berkomentar.
  const accounts = await getAccounts(env);
  const base = { by: me.username, postId: item.id, postBy: item.by, text: snippet(text) };
  await notifyMany(env, [
    ...mentionsIn(text, accounts).map((u) => [u, { ...base, type: "mention" }]),
    [item.by, { ...base, type: "comment" }],
    ...before.map((u) => [u, { ...base, type: "reply" }]),
  ]);
  return { ok: true, item: feedPublic(item, me) };
}

async function feedReact(env, me, body) {
  const item = await feedLoad(env, clean(body.id));
  const r = clean(body.reaction);
  if (r && !REACTIONS.includes(r)) throw fail("Reaksi tidak dikenal.");
  item.reactions = item.reactions || {};
  const had = item.reactions[me.username];
  if (!r || had === r) delete item.reactions[me.username];
  else item.reactions[me.username] = r;
  await env.STORE.put(`feed:item:${item.id}`, JSON.stringify(item));
  if (r && !had && item.reactions[me.username]) await notifyMany(env, [[item.by, { type: "react", reaction: r, by: me.username, postId: item.id, text: snippet(item.text) }]]);
  return { ok: true, item: feedPublic(item, me) };
}

// Hapus postingan atau komentar: pemiliknya sendiri, atau Ray.
async function feedDelete(env, me, body) {
  const item = await feedLoad(env, clean(body.id));
  const lead = allowed(me, "lead");
  const commentId = clean(body.commentId);
  if (commentId) {
    const c = (item.comments || []).find((x) => x.id === commentId);
    if (!c) throw fail("Komentar tidak ditemukan.", 404);
    if (c.by !== me.username && !lead) throw fail("Hanya penulis komentar atau Ray yang bisa menghapus.", 403);
    item.comments = item.comments.filter((x) => x.id !== commentId);
    await env.STORE.put(`feed:item:${item.id}`, JSON.stringify(item));
    return { ok: true, item: feedPublic(item, me) };
  }
  if (item.by !== me.username && !lead) throw fail("Hanya pemilik postingan atau Ray yang bisa menghapus.", 403);
  const idx = (await feedIndex(env)).filter((x) => x.id !== item.id);
  await env.STORE.put("feed:index", JSON.stringify(idx));
  await env.STORE.delete(`feed:item:${item.id}`);
  if (item.image) await env.STORE.delete(`feed:img:${item.id}`);
  return { ok: true, deleted: item.id };
}

async function feedEdit(env, me, body) {
  const item = await feedLoad(env, clean(body.id));
  if (item.kind !== "post" || item.by !== me.username) throw fail("Hanya pemilik postingan yang bisa mengubah.", 403);
  const text = multiline(body.text, FEED_TEXT_MAX);
  if (!text && !item.image) throw fail("Postingan tidak boleh kosong.");
  const accounts = await getAccounts(env);
  const old = new Set(mentionsIn(item.text, accounts));
  item.text = text;
  item.editedAt = new Date().toISOString();
  await env.STORE.put(`feed:item:${item.id}`, JSON.stringify(item));
  await notifyMany(env, mentionsIn(text, accounts).filter((u) => !old.has(u)).map((u) => [u, { type: "mention", by: me.username, postId: item.id, text: snippet(text) }]));
  return { ok: true, item: feedPublic(item, me) };
}

async function feedImage(env, url) {
  const id = url.searchParams.get("id") || "";
  const image = id && (await env.STORE.get(`feed:img:${id}`));
  if (!image) throw fail("Foto tidak ditemukan.", 404);
  return { ok: true, image };
}

// Profil: bio dan jabatan disimpan di objek akun (kecil), foto sampul di KV sendiri.
async function setProfile(env, me, body) {
  const accounts = await getAccounts(env);
  const acc = accounts[me.username];
  if ("bio" in body) acc.bio = multiline(body.bio, 300);
  if ("title" in body) acc.title = clean(body.title).slice(0, 60);
  if ("cover" in body) {
    const img = String(body.cover || "");
    if (!img) {
      await env.STORE.delete(`cover:${me.username}`);
      acc.coverVer = 0;
    } else {
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) throw fail("Format sampul tidak dikenali. Pakai JPG atau PNG.");
      if (img.length > COVER_MAX) throw fail("Foto sampul terlalu besar setelah dikompres. Coba foto lain.");
      await env.STORE.put(`cover:${me.username}`, img);
      acc.coverVer = Date.now();
    }
  }
  await putAccounts(env, accounts);
  return { ok: true, profile: teamEntry(acc) };
}

async function getCover(env, url) {
  const u = url.searchParams.get("u") || "";
  const image = u && (await env.STORE.get(`cover:${u}`));
  if (!image) throw fail("Sampul tidak ditemukan.", 404);
  return { ok: true, image };
}

function teamEntry(a) {
  return { ...publicUser(a), photoVer: a.photoVer || 0, bio: a.bio || "", title: a.title || "", coverVer: a.coverVer || 0 };
}

// Judul singkat request untuk timeline, dari cache sheet (tanpa panggilan Lark tambahan).
async function requestLabel(env, row) {
  const cache = await env.STORE.get("cache", "json");
  const r = cache && (cache.requests || []).find((x) => x.row === row);
  return r ? ` "${r.info.slice(0, 70)}"${r.user ? ` dari ${r.user}` : ""}` : ` baris ${row}`;
}

// ---------- Notifikasi dan tag (v1.5.1) ----------
// Tag ditulis sebagai @username (dipilih dari daftar saat mengetik @). Notifikasi disimpan per akun di notif:<username>.
const NOTIF_KEEP = 60;

function mentionsIn(text, accounts) {
  const out = new Set();
  for (const m of String(text || "").matchAll(/@([a-z0-9._-]{3,32})/gi)) {
    const u = m[1].toLowerCase().replace(/[._-]+$/, "");
    if (accounts[u] && accounts[u].active !== false) out.add(u);
  }
  return [...out];
}

async function notify(env, to, n) {
  if (!to || to === n.by) return;
  const key = `notif:${to}`;
  const list = (await env.STORE.get(key, "json")) || [];
  list.unshift({ id: feedId(), at: new Date().toISOString(), read: false, ...n });
  await env.STORE.put(key, JSON.stringify(list.slice(0, NOTIF_KEEP)));
  await pushTo(env, to, n.type).catch(() => {});
}

// Kirim ke banyak orang, masing-masing paling banyak satu notifikasi per kejadian.
async function notifyMany(env, list) {
  const seen = new Set();
  for (const [to, n] of list) {
    if (!to || to === n.by || seen.has(to)) continue;
    seen.add(to);
    await notify(env, to, n).catch(() => {});
  }
}

async function getNotif(env, me) {
  const list = (await env.STORE.get(`notif:${me.username}`, "json")) || [];
  return { ok: true, items: list, unread: list.filter((n) => !n.read).length };
}

async function readNotif(env, me, body) {
  const key = `notif:${me.username}`;
  const list = (await env.STORE.get(key, "json")) || [];
  const id = clean(body.id);
  let changed = false;
  for (const n of list) if (!n.read && (!id || n.id === id)) { n.read = true; changed = true; }
  if (changed) await env.STORE.put(key, JSON.stringify(list));
  return { ok: true, unread: list.filter((n) => !n.read).length };
}

async function feedOne(env, me, url) {
  const item = await feedLoad(env, url.searchParams.get("id") || "");
  return { ok: true, item: feedPublic(item, me) };
}

const snippet = (t) => String(t || "").replace(/\s+/g, " ").slice(0, 90);

// ---------- Versi HP dan Web Push (v1.6) ----------
// Push dikirim tanpa isi (tanpa enkripsi payload): HP hanya "dibangunkan", lalu service worker mengambil
// notifikasi terbaru dari /api/notif dengan token login yang tersimpan di HP. Kunci VAPID dibuat sekali
// oleh server dan disimpan di KV (push:vapid); kunci privat tidak pernah keluar dari server.
const PUSH_TYPES = ["mention", "comment", "reply", "react", "request", "epnew", "ep", "update"];
const PUSH_DEFAULT = { mention: true, comment: true, reply: true, react: false, request: true, epnew: true, ep: true, update: true };
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function vapidKeys(env) {
  let k = await env.STORE.get("push:vapid", "json");
  if (!k) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const pub = await crypto.subtle.exportKey("raw", pair.publicKey);
    k = { jwk, pub: b64u(pub) };
    await env.STORE.put("push:vapid", JSON.stringify(k));
  }
  return k;
}

const jwtCache = new Map(); // aud -> { token, exp }
async function vapidAuth(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud);
  const k = await vapidKeys(env);
  if (hit && hit.exp - Date.now() / 1000 > 3600) return `vapid t=${hit.token}, k=${k.pub}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp, sub: "mailto:agensianakbangsa@gmail.com" })}`;
  const key = await crypto.subtle.importKey("jwk", k.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  const token = `${unsigned}.${b64u(sig)}`;
  jwtCache.set(aud, { token, exp });
  return `vapid t=${token}, k=${k.pub}`;
}

async function pushTo(env, username, type) {
  const key = `push:${username}`;
  const subs = (await env.STORE.get(key, "json")) || [];
  if (!subs.length) return;
  let changed = false;
  for (const s of subs) {
    const prefs = { ...PUSH_DEFAULT, ...(s.prefs || {}) };
    if (prefs[type] === false) continue;
    try {
      const res = await fetch(s.endpoint, { method: "POST", headers: { Authorization: await vapidAuth(env, s.endpoint), TTL: "86400", Urgency: "high", "Content-Length": "0" } });
      if (res.status === 404 || res.status === 410) { s.dead = true; changed = true; }
    } catch { /* coba lagi di notifikasi berikutnya */ }
  }
  if (changed) await env.STORE.put(key, JSON.stringify(subs.filter((s) => !s.dead)));
}

async function pushSubscribe(env, me, body) {
  const sub = body.subscription || {};
  if (!/^https:\/\//.test(sub.endpoint || "")) throw fail("Langganan notifikasi tidak valid.");
  const key = `push:${me.username}`;
  const subs = ((await env.STORE.get(key, "json")) || []).filter((s) => s.endpoint !== sub.endpoint);
  const prefs = {};
  for (const t of PUSH_TYPES) prefs[t] = body.prefs && t in body.prefs ? !!body.prefs[t] : PUSH_DEFAULT[t];
  subs.push({ endpoint: sub.endpoint, device: clean(body.device).slice(0, 80), prefs, at: new Date().toISOString() });
  await env.STORE.put(key, JSON.stringify(subs.slice(-6)));
  return { ok: true, prefs };
}

async function pushUnsubscribe(env, me, body) {
  const key = `push:${me.username}`;
  const subs = (await env.STORE.get(key, "json")) || [];
  await env.STORE.put(key, JSON.stringify(subs.filter((s) => s.endpoint !== body.endpoint)));
  return { ok: true };
}

async function pushInfo(env, me, url) {
  const k = await vapidKeys(env);
  const ep = url.searchParams.get("endpoint") || "";
  const subs = (await env.STORE.get(`push:${me.username}`, "json")) || [];
  const mine = subs.find((s) => s.endpoint === ep);
  return { ok: true, key: k.pub, subscribed: !!mine, prefs: mine ? { ...PUSH_DEFAULT, ...mine.prefs } : PUSH_DEFAULT };
}

// Request baru di sheet: Ray dapat notifikasi (sekali per request). Pertama kali hanya mencatat.
async function notifyNewRequests(env, requests) {
  const seen = await env.STORE.get("req:notified", "json");
  const pending = requests.filter((r) => !r.decision && r.status !== "done");
  if (!seen) { await env.STORE.put("req:notified", JSON.stringify(requests.map((r) => r.id).slice(-400))); return; }
  const fresh = pending.filter((r) => !seen.includes(r.id));
  if (!fresh.length) return;
  const leads = Object.values(await getAccounts(env)).filter((a) => a.active !== false && MEMBERS[a.member]?.block === "lead");
  for (const r of fresh) {
    for (const l of leads) await notify(env, l.username, { type: "request", by: "", requester: r.user, row: r.row, reqId: r.id, text: r.info.slice(0, 140), deadline: r.deadline }).catch(() => {});
  }
  await env.STORE.put("req:notified", JSON.stringify([...seen, ...fresh.map((r) => r.id)].slice(-400)));
}

// Halaman versi HP disajikan dari Worker ini (/m/). Isinya dibuat oleh build-mobile.mjs.
function serveMobile(path) {
  const name = path.replace(/^\/m\/?/, "") || "index.html";
  const f = MOBILE_FILES[name];
  if (!f) return new Response("Tidak ditemukan", { status: 404 });
  const body = f.b64 ? Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)) : f.data;
  return new Response(body, { headers: { "Content-Type": f.type, "Cache-Control": name === "sw.js" || name === "index.html" ? "no-cache" : "public, max-age=3600", ...(name === "sw.js" ? { "Service-Worker-Allowed": "/m/" } : {}) } });
}

// ---------- Aktivitas dan dashboard Ray ----------

async function logActivity(env, me, text, feed) {
  if (!me) return;
  if (feed) await feedAuto(env, me, feed.text, feed.icon);
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
  // Satu panggilan Lark: request, baris summary, dan kolom tanggal tiap blok (untuk grafik harian).
  const [reqRows, summary, cDates, dDates, vDates, aRows] = await readRanges(env, cfg, [
    `${cfg.requestId}!${REQUEST_RANGE}`,
    `${cfg.reportId}!A4:AK4`,
    `${cfg.reportId}!B${FIRST_ROW}:B${LAST_ROW}`,
    `${cfg.reportId}!O${FIRST_ROW}:O${LAST_ROW}`,
    `${cfg.reportId}!T${FIRST_ROW}:T${LAST_ROW}`,
    `${cfg.reportId}!AI${FIRST_ROW}:AK${LAST_ROW}`,
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
  const daily = dailySeries({ content: cDates, design: dDates, video: vDates, aigc: cfg.aigcReady ? aRows : [] });
  const next = { configured: true, token: cfg.token, aigcReady: !!cfg.aigcReady, requests, counts, daily, fetchedAt: new Date().toISOString() };
  const prev = cache ? JSON.stringify({ ...cache, fetchedAt: "" }) : "";
  // Tulis KV hanya kalau ada perubahan (hemat kuota tulis KV), kecuali cache sudah > 1 jam.
  const stale = !cache || Date.now() - Date.parse(cache.fetchedAt) > 60 * 60 * 1000;
  if (stale || prev !== JSON.stringify({ ...next, fetchedAt: "" })) {
    await env.STORE.put("cache", JSON.stringify(next));
  }
  await notifyNewRequests(env, requests).catch(() => {});
  return { ok: true, ...next };
}

// Tanggal sel Lark bisa berupa angka serial (hari sejak 30 Des 1899) atau teks.
// CONTENT ditulis M/D/YYYY (format ABT), blok lain D/M/YYYY.
export function dayKey(v, monthFirst = false) {
  if (typeof v === "number" && v > 30000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = clean(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const [a, b] = monthFirst ? [m[2], m[1]] : [m[1], m[2]];
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    if (+b < 1 || +b > 12 || +a < 1 || +a > 31) return "";
    return `${y}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  }
  const n = normDate(s);
  m = n.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

export function dailySeries({ content = [], design = [], video = [], aigc = [] }) {
  const count = (rows, monthFirst) => {
    const out = {};
    for (const r of rows || []) { const k = dayKey(r && r[0], monthFirst); if (k) out[k] = (out[k] || 0) + 1; }
    return out;
  };
  const prod = {}, up = {};
  for (const r of aigc || []) {
    const k = dayKey(r && r[0]);
    if (!k) continue;
    prod[k] = (prod[k] || 0) + toNumber(r[1]);
    up[k] = (up[k] || 0) + toNumber(r[2]);
  }
  return { content: count(content, true), design: count(design), video: count(video), aigcProduksi: prod, aigcUpload: up };
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
    if (code) byCode.set(code, { row: rowNum, konten: clean(r[4]), pillar: clean(r[3]), vals: [r[7], r[8], r[9], r[10]] });
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
  await logActivity(env, me, `CONTENT: ${added} konten baru, ${updated} diperbarui`, added ? { text: `menambahkan ${added} konten baru ke KPI CONTENT`, icon: "content" } : null);
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
  await logActivity(env, me, `${kind.toUpperCase()}: ${info.slice(0, 60)}`, { text: `mengirim hasil ${kind === "design" ? "design" : "video"}: ${info.slice(0, 120)}`, icon: kind });
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
  await logActivity(env, me, `AIGC ${tanggal}: ${produksi} produksi, ${upload} upload`, { text: `input AIGC ${tanggal}: ${produksi} produksi, ${upload} upload`, icon: "aigc" });
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
  await logActivity(env, me, `Request selesai (baris ${row})`, { text: `menyelesaikan request${await requestLabel(env, row)}`, icon: "done" });
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
  await logActivity(env, me, `Request baris ${row}: ${decision}`, null);
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
  await putIfChanged(env, "calcache", out);
  return out;
}

// Tulis cache ke KV hanya kalau isinya berubah, atau cache lama sudah lebih dari 1 jam (hemat kuota tulis KV 1.000/hari).
async function putIfChanged(env, key, out) {
  const prev = await env.STORE.get(key, "json");
  const strip = (o) => JSON.stringify({ ...o, fetchedAt: "" });
  const stale = !prev || Date.now() - Date.parse(prev.fetchedAt) > 60 * 60 * 1000;
  if (stale || strip(prev) !== strip(out)) await env.STORE.put(key, JSON.stringify(out));
}

const GOOGLE_COOLDOWN_MS = 60 * 1000;
let lastGoogleRefresh = 0; // per isolate; cukup untuk meredam klik beruntun

// Dipanggil tombol muat ulang Ray: Lark dan Google, masing-masing paling sering sekali per menit.
async function refreshAll(env, me) {
  const lark = await refresh(env, { force: false });
  if (Date.now() - lastGoogleRefresh > GOOGLE_COOLDOWN_MS) {
    lastGoogleRefresh = Date.now();
    await googleRefreshAll(env);
  }
  return fullState(env, me, forUser(lark, me));
}

// Satu request untuk semua data widget: request creative, EP, kalender (kalau boleh), dan daftar tim.
async function fullState(env, me, base) {
  const out = base || (await getState(env, me));
  const accounts = await getAccounts(env);
  out.team = Object.values(accounts).filter((a) => a.active !== false).map(teamEntry);
  out.feedLatest = (await feedIndex(env))[0]?.at || null;
  out.notifUnread = ((await env.STORE.get(`notif:${me.username}`, "json")) || []).filter((n) => !n.read).length;
  const g = await getGoogleConfig(env);
  if (g.ep) out.ep = await getEp(env, me).catch((e) => ({ ok: false, error: e.message }));
  if (g.calendar && allowed(me, "content")) out.cal = await getCalendar(env).catch((e) => ({ ok: false, error: e.message }));
  return out;
}

async function epThumb(env, url) {
  const c = await env.STORE.get("epcache", "json");
  const id = url.searchParams.get("id") || "";
  if (!c || !c.items.some((i) => i.id === id)) throw fail("Slide tidak ditemukan. Muat ulang.", 404);
  const t = await google(env, "GET", `${SLIDES}/${c.id}/pages/${encodeURIComponent(id)}/thumbnail?thumbnailProperties.thumbnailSize=LARGE&thumbnailProperties.mimeType=PNG`);
  return { ok: true, url: t.contentUrl, width: t.width, height: t.height };
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
  await putIfChanged(env, "epcache", out);
  await notifyNewEp(env, g.ep.id, items).catch(() => {});
  return out;
}

// Slide EP baru: Ray dapat notifikasi (sekali per slide). Pertama kali (atau file EP bulan baru) hanya mencatat.
async function notifyNewEp(env, fileId, items) {
  const prev = await env.STORE.get("ep:notified", "json");
  const ids = items.map((i) => i.id);
  if (!prev || prev.file !== fileId) { await env.STORE.put("ep:notified", JSON.stringify({ file: fileId, ids })); return; }
  const fresh = items.filter((i) => !prev.ids.includes(i.id) && !i.posted);
  if (!fresh.length) return;
  const leads = Object.values(await getAccounts(env)).filter((a) => a.active !== false && MEMBERS[a.member]?.block === "lead");
  for (const it of fresh) {
    for (const l of leads) await notify(env, l.username, { type: "epnew", by: "", epId: it.id, text: (it.cover || it.format || "Slide baru").slice(0, 100), format: it.format || "", upload: it.uploadText || "" }).catch(() => {});
  }
  await env.STORE.put("ep:notified", JSON.stringify({ file: fileId, ids: [...new Set([...prev.ids, ...ids])].slice(-300) }));
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
  if (status) {
    const team = Object.values(await getAccounts(env)).filter((a) => a.active !== false && MEMBERS[a.member]?.block !== "lead");
    await notifyMany(env, team.map((a) => [a.username, { type: "ep", by: me.username, status, epId: item.id, text: (item.cover || item.format).slice(0, 100), note: status === "REVISI" ? note.slice(0, 200) : "" }]));
  }
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
  await logActivity(env, me, `POSTED: "${(item.cover || item.format).slice(0, 40)}"`, { text: `menandai POSTED "${(item.cover || item.format).slice(0, 60)}"`, icon: "posted" });
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

// ---------- Instagram (v1.4) ----------
// Dua jenis token diterima:
// - token login Instagram (diawali IG, graph.instagram.com), berlaku 60 hari dan diperpanjang otomatis;
// - token Login Terpadu / pengguna sistem (diawali EAA, graph.facebook.com ke ID akun IG), tidak kedaluwarsa.
// Token disimpan di KV oleh Ray lewat widget dan tidak pernah dikirim ke laptop tim. Paket gratis Cloudflare membatasi 50 subrequest per
// jalan, jadi tiap cron hanya memperbarui sebagian konten (bergiliran).
const IG_HOST = "https://graph.instagram.com";
const FB_HOST = "https://graph.facebook.com";
// ID akun IG dari halaman Meta (API setup with Unified login). Bukan rahasia; dipakai kalau token EAA tidak menyebut akunnya.
const IG_DEFAULT_IDS = { AAB: "17841471637263858", NUSANTARA: "17841474840408535" };
const isFbToken = (token) => /^EAA/.test(token);
const IG_VER = "v25.0";
export const IG_ACCOUNTS = ["AAB", "NUSANTARA"];
const IG_MEDIA_PER_RUN = 12;
// Jatah panggilan Instagram per akun per jalan (paket gratis: 50 subrequest per jalan, dibagi dengan Lark dan Google).
const IG_BUDGET_CRON = 9;
const IG_BUDGET_MANUAL = 20;
// Daftar postingan dan insight akun diambil tiap 30 menit supaya postingan baru cepat muncul.
const IG_PROFILE_EVERY_MS = 30 * 60 * 1000;
const IG_MEDIA_FRESH_MS = 2 * 3600 * 1000;
const IG_KEEP_DAYS = 90;
const IG_MEDIA_DAYS = 60;
const IG_SHEET_EVERY_MS = 4 * 60 * 60 * 1000;

// t: { token, kind: "ig" | "fb", igId }. Untuk token fb, "me" dan "me/..." diarahkan ke ID akun IG.
async function ig(path, t, params = {}) {
  if (t.budget && t.budget.left-- <= 0) {
    const e = fail("Instagram: jatah panggilan habis untuk jalan ini", 503);
    e.budget = true;
    throw e;
  }
  const fb = t.kind === "fb";
  const p = fb && t.igId ? path.replace(/^me(?=\/|$)/, t.igId) : path;
  const u = new URL(`${fb ? FB_HOST : IG_HOST}/${p.startsWith("refresh_access_token") ? "" : IG_VER + "/"}${p}`);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  u.searchParams.set("access_token", t.token);
  const res = await fetch(u.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = fail(`Instagram: ${(data.error && data.error.message) || res.status}`, res.status === 400 || res.status === 401 || res.status === 403 ? 409 : 502);
    e.igCode = data.error && data.error.code;
    throw e;
  }
  return data;
}

const wibDay = (ms = Date.now()) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
const wibDayStart = (iso) => Math.floor((Date.parse(`${iso}T00:00:00Z`) - 7 * 3600 * 1000) / 1000);

async function igTokens(env) {
  return (await env.STORE.get("ig:accounts", "json")) || {};
}

async function igConnect(env, body) {
  const account = clean(body.account).toUpperCase();
  if (!IG_ACCOUNTS.includes(account)) throw fail("Pilih akun AAB atau NUSANTARA.");
  const token = clean(body.token);
  if (!/^[A-Za-z0-9_\-|.]{40,}$/.test(token)) throw fail("Token tidak dikenali. Salin ulang token dari halaman Meta for Developers.");
  let me, rec;
  if (isFbToken(token)) {
    ({ me, rec } = await igFindFbAccount(token, account, clean(body.igId)));
  } else {
    me = await ig("me", { token, kind: "ig" }, { fields: "user_id,username,account_type,followers_count,media_count" });
    rec = { token, kind: "ig", userId: String(me.user_id || me.id), refreshedAt: Date.now(), expiresAt: Date.now() + 60 * 864e5 };
  }
  const tokens = await igTokens(env);
  const other = Object.entries(tokens).find(([k, v]) => k !== account && v.userId === rec.userId);
  if (other) throw fail(`Token ini milik @${me.username}, yang sudah terhubung sebagai ${other[0]}.`);
  tokens[account] = { ...rec, username: me.username, setAt: Date.now() };
  await env.STORE.put("ig:accounts", JSON.stringify(tokens));
  await env.STORE.delete(`ig:data:${account}`);
  await igSyncAccount(env, account, tokens[account], { force: true });
  return { ok: true, account, username: me.username, accountType: me.account_type, followers: me.followers_count };
}

// Token EAA: cari ID akun IG yang bisa dibuka token ini. Urutan: ID dari widget, ID bawaan akun, lalu Halaman FB yang tertaut.
async function igFindFbAccount(token, account, igId) {
  const fields = "id,username,followers_count,media_count";
  const tried = new Set();
  const tryId = async (id) => {
    if (!id || tried.has(id)) return null;
    tried.add(id);
    try { return await ig(id, { token, kind: "fb" }, { fields }); } catch (e) { if (e.status === 409 && /OAuth|token/i.test(e.message) && !/permission|object/i.test(e.message)) throw e; return null; }
  };
  let me = (await tryId(igId)) || (await tryId(IG_DEFAULT_IDS[account]));
  if (!me) {
    const pages = await ig("me/accounts", { token, kind: "fb" }, { fields: "instagram_business_account{id,username}" }).catch(() => ({ data: [] }));
    for (const pg of pages.data || []) {
      const iba = pg.instagram_business_account;
      if (iba && (me = await tryId(iba.id))) break;
    }
  }
  if (!me) throw fail(`Token diterima, tapi akun Instagram ${account} tidak bisa dibuka dengan token ini. Pastikan token dibuat di baris akun ${account}.`);
  return { me, rec: { token, kind: "fb", igId: String(me.id), userId: String(me.id), refreshedAt: Date.now(), expiresAt: null } };
}

async function igDisconnect(env, body) {
  const account = clean(body.account).toUpperCase();
  const tokens = await igTokens(env);
  delete tokens[account];
  await env.STORE.put("ig:accounts", JSON.stringify(tokens));
  await env.STORE.delete(`ig:data:${account}`);
  return { ok: true };
}

const kategoriOf = (m) => (m.media_product_type === "REELS" || m.media_type === "VIDEO" ? "Reels/VT" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : "Feed");

async function igMediaInsights(t, m) {
  const want = m.type === "CAROUSEL_ALBUM" ? ["reach", "likes", "comments", "shares", "saved", "views"] : ["views", "reach", "likes", "comments", "shares", "saved"];
  let data;
  try {
    data = await ig(`${m.id}/insights`, t, { metric: want.join(",") });
  } catch (e) {
    // Sebagian tipe konten tidak punya metrik views: ulangi tanpa views.
    data = await ig(`${m.id}/insights`, t, { metric: want.filter((x) => x !== "views").join(",") });
  }
  const out = {};
  for (const d of data.data || []) out[d.name] = (d.values && d.values[0] && d.values[0].value) ?? (d.total_value && d.total_value.value) ?? 0;
  return out;
}

async function igSyncAccount(env, account, tok, { force = false } = {}) {
  const t = { ...tok, budget: { left: force ? IG_BUDGET_MANUAL : IG_BUDGET_CRON } };
  const key = `ig:data:${account}`;
  const prev = (await env.STORE.get(key, "json")) || { account, daily: {}, media: [] };
  const data = JSON.parse(JSON.stringify(prev));
  data.account = account;
  data.username = t.username;
  const now = Date.now();
  const today = wibDay(now);
  if (force || !data.profileAt || now - data.profileAt > IG_PROFILE_EVERY_MS) {
    const me = await ig("me", t, { fields: "username,followers_count,media_count,profile_picture_url" });
    data.followers = me.followers_count || 0;
    data.mediaCount = me.media_count || 0;
    data.picture = me.profile_picture_url || "";
    data.username = me.username;
    const list = await ig("me/media", t, { fields: "id,caption,media_type,media_product_type,permalink,shortcode,timestamp,thumbnail_url,media_url,like_count,comments_count", limit: "50" });
    const old = new Map((data.media || []).map((m) => [m.id, m]));
    const cutoff = now - IG_MEDIA_DAYS * 864e5;
    data.media = (list.data || [])
      .filter((m) => Date.parse(m.timestamp) >= cutoff)
      .map((m) => {
        const o = old.get(m.id) || {};
        return {
          id: m.id, code: m.shortcode || shortcode(m.permalink), permalink: m.permalink,
          caption: clean(m.caption).slice(0, 160), type: m.media_type, product: m.media_product_type, kategori: kategoriOf(m),
          timestamp: m.timestamp, thumb: m.thumbnail_url || (m.media_type === "IMAGE" ? m.media_url : "") || "",
          likes: m.like_count ?? o.likes ?? 0, comments: m.comments_count ?? o.comments ?? 0,
          views: o.views ?? null, reach: o.reach ?? null, shares: o.shares ?? null, saved: o.saved ?? null, insightsAt: o.insightsAt || 0, insightError: o.insightError || "",
        };
      });
    // Insight akun hari ini dan kemarin (kemarin final setelah lewat tengah malam WIB).
    for (const day of [today, wibDay(now - 864e5)]) {
      if (day !== today && data.daily[day] && data.daily[day].final) continue;
      const since = wibDayStart(day);
      const until = Math.min(since + 86400, Math.floor(now / 1000));
      const ins = await ig("me/insights", t, { metric: "views,reach,total_interactions,accounts_engaged", period: "day", metric_type: "total_value", since: String(since), until: String(until) }).catch(() => null);
      const row = data.daily[day] || {};
      for (const d of (ins && ins.data) || []) row[d.name] = (d.total_value && d.total_value.value) || 0;
      if (day === today) row.followers = data.followers;
      if (day !== today) row.final = true;
      data.daily[day] = row;
    }
    const keep = wibDay(now - IG_KEEP_DAYS * 864e5);
    Object.keys(data.daily).forEach((d) => { if (d < keep) delete data.daily[d]; });
    data.profileAt = now;
  }
  // Insight per konten, bergiliran: konten seminggu terakhir didahulukan.
  const week = now - 7 * 864e5;
  // Urutan: konten yang belum pernah punya angka (terbaru dulu), lalu konten seminggu terakhir, lalu yang paling lama tidak diperbarui.
  // Konten yang ditolak Instagram dicoba lagi setelah 6 jam. Sinkron manual tidak mengulang yang baru diperbarui 10 menit terakhir.
  const empty = (m) => m.views === null && m.reach === null;
  const due = (m) => {
    const age = now - (m.insightsAt || 0);
    if (m.insightError) return age > 6 * 3600 * 1000;
    if (force) return age > 10 * 60 * 1000;
    return empty(m) || age > IG_MEDIA_FRESH_MS;
  };
  const queue = (data.media || [])
    .filter(due)
    .sort((a, b) => empty(b) - empty(a) || (empty(a) && empty(b) ? Date.parse(b.timestamp) - Date.parse(a.timestamp) : 0) ||
      (Date.parse(b.timestamp) >= week) - (Date.parse(a.timestamp) >= week) || (a.insightsAt || 0) - (b.insightsAt || 0))
    .slice(0, force ? 20 : IG_MEDIA_PER_RUN);
  for (const m of queue) {
    try {
      const s = await igMediaInsights(t, m);
      Object.assign(m, { views: s.views ?? m.views, reach: s.reach ?? m.reach, likes: s.likes ?? m.likes, comments: s.comments ?? m.comments, shares: s.shares ?? m.shares, saved: s.saved ?? m.saved, insightsAt: now, insightError: "" });
    } catch (e) {
      if (e.budget) break; // jatah habis: sisanya dilanjutkan jalan berikutnya
      if (e.igCode === 190) throw e; // token bermasalah: berhenti dan tampilkan error
      m.insightsAt = now; // jangan diulang terus kalau Instagram menolak satu konten
      m.insightError = String(e.message || "").slice(0, 200);
    }
  }
  data.updatedAt = now;
  const strip = (o) => JSON.stringify({ ...o, updatedAt: 0, profileAt: 0, media: o.media.map((m) => ({ ...m, insightsAt: 0 })) });
  if (force || strip(prev) !== strip(data) || now - (prev.savedAt || 0) > 3 * 3600 * 1000) {
    data.savedAt = now;
    await env.STORE.put(key, JSON.stringify(data));
  }
  return data;
}

// Perpanjang token kalau sisa kurang dari 15 hari (Instagram mewajibkan token berumur minimal 24 jam).
async function igRefreshTokens(env, tokens) {
  let changed = false;
  for (const [acc, t] of Object.entries(tokens)) {
    if (t.kind === "fb" || !t.expiresAt) continue; // token pengguna sistem tidak kedaluwarsa
    if (t.expiresAt - Date.now() > 15 * 864e5 || Date.now() - t.refreshedAt < 864e5) continue;
    try {
      const r = await ig("refresh_access_token", { ...t, kind: "ig" }, { grant_type: "ig_refresh_token" });
      t.token = r.access_token;
      t.refreshedAt = Date.now();
      t.expiresAt = Date.now() + (r.expires_in || 60 * 86400) * 1000;
      t.error = "";
    } catch (e) {
      t.error = e.message;
    }
    tokens[acc] = t;
    changed = true;
  }
  if (changed) await env.STORE.put("ig:accounts", JSON.stringify(tokens));
}

async function igSync(env, { force = false, sheet = true } = {}) {
  const tokens = await igTokens(env);
  if (!Object.keys(tokens).length) return { ok: true, synced: 0 };
  await igRefreshTokens(env, tokens);
  let synced = 0;
  for (const acc of IG_ACCOUNTS) {
    if (!tokens[acc]) continue;
    try { await igSyncAccount(env, acc, tokens[acc], { force }); synced++; } catch (e) {
      tokens[acc].error = e.message;
      await env.STORE.put("ig:accounts", JSON.stringify(tokens));
    }
  }
  if (sheet) await igSheetSync(env).catch(() => {});
  return { ok: true, synced };
}

// Semua konten IG yang dikenal server, digabung per shortcode. Konten yang muncul di dua akun = COLLABORATION.
async function igAllMedia(env) {
  const byCode = new Map();
  for (const acc of IG_ACCOUNTS) {
    const d = await env.STORE.get(`ig:data:${acc}`, "json");
    for (const m of (d && d.media) || []) {
      const hit = byCode.get(m.code);
      if (hit) { hit.account = "COLLABORATION"; continue; }
      byCode.set(m.code, { ...m, account: acc });
    }
  }
  return byCode;
}

const sheetMetrics = (m) => [m.views ?? 0, m.likes ?? 0, m.comments ?? 0, (m.shares ?? 0) + (m.saved ?? 0)];

// Isi otomatis Views/Likes/Comment/Share & Save di blok CONTENT untuk konten yang sudah ada di sheet (tiap 4 jam).
async function igSheetSync(env, { force = false } = {}) {
  const cfg = await env.STORE.get("config", "json");
  if (!cfg) return { updated: 0 };
  const meta = (await env.STORE.get("ig:sheet", "json")) || {};
  if (!force && meta.at && Date.now() - meta.at < IG_SHEET_EVERY_MS) return { updated: 0 };
  const media = await igAllMedia(env);
  if (!media.size) return { updated: 0 };
  const { byCode } = await readContent(env, cfg);
  const ranges = [];
  for (const [code, hit] of byCode) {
    const m = media.get(code);
    if (!m || (m.views === null && m.reach === null)) continue; // insight konten belum terambil
    const next = sheetMetrics(m);
    if (m.views === null) next[0] = toNumber(hit.vals[0]); // Instagram tidak memberi views: biarkan angka di sheet
    if (next.some((v, i) => v !== toNumber(hit.vals[i]))) ranges.push({ range: `${cfg.reportId}!H${hit.row}:K${hit.row}`, values: [next] });
  }
  if (ranges.length) await writeRanges(env, cfg, ranges);
  await env.STORE.put("ig:sheet", JSON.stringify({ at: Date.now(), updated: ranges.length }));
  return { updated: ranges.length };
}

// Kalau banyak konten ditolak Instagram, tampilkan satu contoh pesannya supaya penyebabnya kelihatan.
function insightProblem(d) {
  const bad = ((d && d.media) || []).filter((m) => m.insightError && m.views === null && m.reach === null);
  return bad.length >= 3 ? `Insight ${bad.length} konten ditolak Instagram: ${bad[0].insightError}` : "";
}

// Untuk halaman Insight IG (semua akun boleh lihat).
async function igOverview(env) {
  const tokens = await igTokens(env);
  const sheet = (await env.STORE.get("ig:sheet", "json")) || {};
  const accounts = {};
  for (const acc of IG_ACCOUNTS) {
    const t = tokens[acc];
    const d = await env.STORE.get(`ig:data:${acc}`, "json");
    accounts[acc] = {
      connected: !!t,
      username: (d && d.username) || (t && t.username) || "",
      error: (t && t.error) || insightProblem(d),
      expiresAt: t ? t.expiresAt : null,
      followers: d ? d.followers : null,
      mediaCount: d ? d.mediaCount : null,
      picture: d ? d.picture : "",
      daily: d ? d.daily : {},
      media: d ? d.media.map(({ id, code, permalink, caption, kategori, timestamp, thumb, views, reach, likes, comments, shares, saved }) => ({ id, code, permalink, caption, kategori, timestamp, thumb, views, reach, likes, comments, shares, saved })) : [],
      updatedAt: d ? d.updatedAt : null,
    };
  }
  return { ok: true, accounts, sheetSyncAt: sheet.at || null, sheetUpdated: sheet.updated || 0 };
}

// Untuk Zahra: konten IG 45 hari terakhir yang belum ada di blok CONTENT.
async function igNewPosts(env) {
  const cfg = await getConfig(env);
  const media = await igAllMedia(env);
  const { byCode } = await readContent(env, cfg);
  // Hanya postingan bulan berjalan (WIB): sheet KPI dibuat per bulan.
  const w = new Date(Date.now() + 7 * 3600 * 1000);
  const cutoff = Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), 1) - 7 * 3600 * 1000;
  const items = [...media.values()]
    .filter((m) => !byCode.has(m.code) && Date.parse(m.timestamp) >= cutoff)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((m) => {
      const d = new Date(Date.parse(m.timestamp) + 7 * 3600 * 1000);
      return {
        code: m.code, link: m.permalink, account: m.account, kategori: m.kategori, caption: m.caption, thumb: m.thumb,
        tanggal: `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`,
        views: m.views ?? 0, likes: m.likes ?? 0, comments: m.comments ?? 0, shares: (m.shares ?? 0) + (m.saved ?? 0),
        insightsReady: m.views !== null,
      };
    });
  return { ok: true, items };
}

let lastIgManual = 0;
async function igManualSync(env) {
  if (Date.now() - lastIgManual < 60 * 1000) return igOverview(env);
  lastIgManual = Date.now();
  await igSync(env, { force: false });
  await igSheetSync(env, { force: true }).catch(() => {});
  return igOverview(env);
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
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-App-Version");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return res;
}

// ---------- Berkas versi HP (dibuat otomatis oleh build-mobile.mjs, jangan diubah manual) ----------
// MOBILE-START
const MOBILE_FILES = {"app.js":{"type":"text/javascript; charset=utf-8","data":"// Creative AAB versi HP: notifikasi, approval (Ray), pengaturan push.\n// Input KPI dan posting tetap di aplikasi laptop.\n\"use strict\";\n\nconst SHORT = { fitria: \"Zahra\", athallah: \"Aqil\", albar: \"Albar\", rifqi: \"Rifqi\", ray: \"Ray\" };\nconst AV_BG = { fitria: \"#F3A6C8\", athallah: \"#FFD8A8\", albar: \"#8BBAF2\", rifqi: \"#A8E6CF\", ray: \"#C9B6FF\" };\nconst REACT = { like: \"👍\", love: \"❤️\", haha: \"😂\", wow: \"😮\", fire: \"🔥\" };\nconst PUSH_LABELS = [\n  [\"mention\", \"Ditandai (@)\", \"Saat ada yang menandai kamu\"],\n  [\"comment\", \"Komentar di postinganmu\", \"\"],\n  [\"reply\", \"Balasan diskusi\", \"Komentar baru di postingan yang kamu komentari\"],\n  [\"request\", \"Request baru\", \"Khusus Ray, request yang perlu approval\"],\n  [\"epnew\", \"EP baru\", \"Khusus Ray, slide EP baru yang perlu approval\"],\n  [\"ep\", \"Keputusan EP\", \"OKE atau revisi dari Ray\"],\n  [\"react\", \"Reaksi\", \"Saat postinganmu diberi reaksi\"],\n  [\"update\", \"Minta update aplikasi laptop\", \"\"],\n];\nconst POLL_MS = 60 * 1000;\n\nconst ui = {\n  token: localStorage.getItem(\"aab_m_token\") || \"\",\n  user: JSON.parse(localStorage.getItem(\"aab_m_user\") || \"null\"),\n  tab: \"notif\",\n  view: null, // { type: \"post\" | \"ep\" | \"update\", ... }\n  filter: \"all\",\n  seg: \"req\",\n  notif: null,\n  state: null,\n  ep: null,\n  photos: {},\n  thumbs: {},\n  push: null,\n  msg: \"\",\n  busy: \"\",\n};\n\nconst $ = (id) => document.getElementById(id);\nconst esc = (s) => String(s ?? \"\").replace(/[&<>\"']/g, (c) => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[c]));\nconst isLead = () => !!ui.user && ui.user.member === \"ray\";\nconst standalone = () => window.matchMedia(\"(display-mode: standalone)\").matches || navigator.standalone === true;\nconst isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);\n\n// ---------- IndexedDB (dipakai juga oleh service worker) ----------\nfunction idb(mode, fn) {\n  return new Promise((resolve, reject) => {\n    const open = indexedDB.open(\"aab-mobile\", 1);\n    open.onupgradeneeded = () => open.result.createObjectStore(\"kv\");\n    open.onerror = () => reject(open.error);\n    open.onsuccess = () => {\n      const tx = open.result.transaction(\"kv\", mode);\n      const req = fn(tx.objectStore(\"kv\"));\n      tx.oncomplete = () => resolve(req && req.result);\n      tx.onerror = () => reject(tx.error);\n    };\n  });\n}\nconst idbPut = (k, v) => idb(\"readwrite\", (s) => s.put(v, k)).catch(() => {});\nconst idbDel = (k) => idb(\"readwrite\", (s) => s.delete(k)).catch(() => {});\n\n// ---------- API ----------\nasync function api(path, body) {\n  const res = await fetch(path, {\n    method: body ? \"POST\" : \"GET\",\n    headers: { \"Content-Type\": \"application/json\", ...(ui.token ? { Authorization: `Bearer ${ui.token}` } : {}) },\n    body: body ? JSON.stringify(body) : undefined,\n  });\n  const data = await res.json().catch(() => ({ ok: false, error: `Server menjawab ${res.status}.` }));\n  if (res.status === 401 && ui.token) { logout(); throw new Error(\"Sesi habis. Login lagi.\"); }\n  if (!res.ok || data.ok === false) throw new Error(data.error || `Gagal (${res.status}).`);\n  return data;\n}\n\n// ---------- Tim dan nama ----------\nconst team = () => (ui.state && ui.state.team) || [];\nconst person = (username) => team().find((t) => t.username === username) || null;\nconst nameOf = (username) => (person(username) || {}).name || username || \"\";\nconst shortOf = (username) => { const p = person(username); return (p && SHORT[p.member]) || (p ? p.name.split(\" \")[0] : username); };\nfunction avatar(username, size = \"\", label = \"\") {\n  const p = person(username);\n  const ph = ui.photos[username];\n  const bg = (p && AV_BG[p.member]) || \"#F3C77A\";\n  const letters = label || (p ? shortOf(username) : username || \"?\").slice(0, label ? 2 : 1).toUpperCase();\n  if (ph && ph.image && /^data:image\\//.test(ph.image)) return `<span class=\"av ${size}\"><img src=\"${esc(ph.image)}\" alt=\"\"></span>`;\n  return `<span class=\"av ${size}\" style=\"background:${bg}\" aria-hidden=\"true\">${esc(letters)}</span>`;\n}\nconst mentions = (html) => html.replace(/(^|[\\s(])@([a-z0-9._-]{3,32})/gi, (all, pre, raw) => {\n  const u = raw.toLowerCase().replace(/[._-]+$/, \"\");\n  return person(u) ? `${pre}<span class=\"mention\">@${esc(shortOf(u))}</span>${raw.slice(u.length)}` : all;\n});\nconst plain = (t) => String(t || \"\").replace(/@([a-z0-9._-]{3,32})/gi, (all, raw) => { const u = raw.toLowerCase().replace(/[._-]+$/, \"\"); return person(u) ? `@${shortOf(u)}${raw.slice(u.length)}` : all; });\n\nfunction ago(iso) {\n  const d = new Date(iso);\n  const s = (Date.now() - d.getTime()) / 1000;\n  if (s < 60) return \"baru saja\";\n  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;\n  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;\n  const y = new Date(); y.setDate(y.getDate() - 1);\n  const hm = `${String(d.getHours()).padStart(2, \"0\")}.${String(d.getMinutes()).padStart(2, \"0\")}`;\n  if (d.toDateString() === y.toDateString()) return `Kemarin ${hm}`;\n  return `${d.getDate()} ${[\"Jan\", \"Feb\", \"Mar\", \"Apr\", \"Mei\", \"Jun\", \"Jul\", \"Agu\", \"Sep\", \"Okt\", \"Nov\", \"Des\"][d.getMonth()]} ${hm}`;\n}\n\nfunction notifLine(n) {\n  const who = `<b>${esc(nameOf(n.by))}</b>`;\n  const quote = n.text ? `: “${mentions(esc(n.text))}”` : \"\";\n  switch (n.type) {\n    case \"mention\": return `${who} menandai kamu di ${n.postBy && n.postBy !== n.by ? \"komentar\" : \"postingan\"}${quote}`;\n    case \"comment\": return `${who} mengomentari postinganmu${quote}`;\n    case \"reply\": return `${who} juga mengomentari postingan ${n.postBy ? esc(shortOf(n.postBy)) : \"\"}${quote}`;\n    case \"react\": return `${who} memberi ${REACT[n.reaction] || \"👍\"} pada postinganmu${quote}`;\n    case \"request\": return `Request baru dari <b>${esc(n.requester || \"user\")}</b>${quote}`;\n    case \"epnew\": return `EP baru perlu approval: “${esc(n.text)}”${n.upload ? ` · upload ${esc(n.upload)}` : \"\"}`;\n    case \"ep\": return n.status === \"OKE\" ? `${who} meng-OKE EP “${esc(n.text)}”` : `${who} minta revisi EP “${esc(n.text)}”${n.note ? `: ${esc(n.note)}` : \"\"}`;\n    case \"update\": return `${who} minta kamu update aplikasi laptop ke v${esc(n.version)}`;\n    default: return `${who} berinteraksi denganmu`;\n  }\n}\nconst notifIcon = (n) => ({ mention: [\"@\", \"#8BBAF2\"], comment: [\"💬\", \"#A8E6CF\"], reply: [\"💬\", \"#8BBAF2\"], react: [REACT[n.reaction] || \"👍\", \"#F3A6C8\"], request: [\"!\", \"#F3C77A\"], epnew: [\"▣\", \"#C9B6FF\"], ep: [n.status === \"OKE\" ? \"✓\" : \"✎\", n.status === \"OKE\" ? \"#8FE3B5\" : \"#FFB4BB\"], update: [\"↑\", \"#C9B6FF\"] }[n.type] || [\"•\", \"#8BBAF2\"]);\n\n// ---------- Data ----------\nasync function loadAll() {\n  if (!ui.token) return;\n  await Promise.all([loadNotif(), loadState()]);\n  if (isLead()) loadEp();\n  loadPhotos();\n}\nasync function loadNotif() {\n  try {\n    ui.notif = await api(\"/api/notif\");\n    if (navigator.setAppBadge) navigator.setAppBadge(ui.notif.unread).catch(() => {});\n  } catch (e) { ui.msg = e.message; }\n  render();\n}\nasync function loadState() {\n  try {\n    ui.state = await api(\"/api/state\");\n    const names = Object.fromEntries(team().map((t) => [t.username, t.name]));\n    idbPut(\"names\", names);\n  } catch (e) { ui.msg = e.message; }\n  render();\n}\nasync function loadEp() {\n  try { ui.ep = await api(\"/api/ep\"); } catch (e) { ui.epErr = e.message; }\n  render();\n}\nasync function loadPhotos() {\n  try {\n    const cached = JSON.parse(localStorage.getItem(\"aab_m_photos\") || \"{}\");\n    ui.photos = cached;\n    const need = team().some((t) => t.photoVer && (!cached[t.username] || cached[t.username].ver !== t.photoVer));\n    if (!need) return render();\n    const r = await api(\"/api/photos\");\n    ui.photos = r.photos;\n    try { localStorage.setItem(\"aab_m_photos\", JSON.stringify(r.photos)); } catch { /* penyimpanan penuh: abaikan */ }\n    render();\n  } catch { /* foto tidak wajib */ }\n}\n\n// ---------- Tampilan ----------\nconst ICON = {\n  notif: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><path d=\"M6 16V11a6 6 0 0 1 12 0v5l2 2H4z\"/><path d=\"M10 21h4\"/></svg>',\n  approval: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><path d=\"M5 12.5l4.5 4.5L19 7\"/></svg>',\n  akun: '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5\"/></svg>',\n};\n\nfunction pendingRequests() {\n  return ((ui.state && ui.state.requests) || []).filter((r) => r.status !== \"done\" && r.decision !== \"APPROVE\" && r.decision !== \"REJECT\");\n}\nfunction pendingEp() {\n  return ((ui.ep && ui.ep.items) || []).filter((i) => !i.decision && !i.posted);\n}\n\nfunction renderTabs() {\n  const bar = $(\"tabbar\");\n  if (!ui.token) { bar.hidden = true; return; }\n  bar.hidden = false;\n  const unread = (ui.notif && ui.notif.unread) || 0;\n  const appr = isLead() ? pendingRequests().length + pendingEp().length : 0;\n  const tabs = [[\"notif\", \"Notifikasi\", unread], ...(isLead() ? [[\"approval\", \"Approval\", appr]] : []), [\"akun\", \"Akun\", 0]];\n  bar.innerHTML = tabs.map(([id, label, n]) => `<button class=\"tab\" data-tab=\"${id}\" ${ui.tab === id && !ui.view ? 'aria-current=\"page\"' : \"\"}>${ICON[id]}${label}${n ? `<b>${n > 99 ? \"99+\" : n}</b>` : \"\"}</button>`).join(\"\");\n  bar.querySelectorAll(\"[data-tab]\").forEach((b) => b.addEventListener(\"click\", () => { ui.tab = b.dataset.tab; ui.view = null; ui.msg = \"\"; ui.okMsg = \"\"; render(); window.scrollTo(0, 0); }));\n}\n\nfunction render() {\n  renderTabs();\n  const app = $(\"app\");\n  if (!ui.token) { app.innerHTML = loginView(); bindLogin(); return; }\n  const msg = ui.msg ? `<p class=\"err\" role=\"alert\">${esc(ui.msg)}</p>` : ui.okMsg ? `<p class=\"ok-msg\" role=\"status\">${esc(ui.okMsg)}</p>` : \"\";\n  if (ui.view) { app.innerHTML = msg + detailView(); bindDetail(); return; }\n  if (ui.tab === \"approval\" && isLead()) { app.innerHTML = msg + approvalView(); bindApproval(); return; }\n  if (ui.tab === \"akun\") { app.innerHTML = msg + akunView(); bindAkun(); return; }\n  app.innerHTML = msg + notifView(); bindNotif();\n}\n\nfunction loginView() {\n  return `<form class=\"login\" id=\"loginForm\" novalidate>\n    <img src=\"icon-192.png\" alt=\"\">\n    <h2>Creative AAB</h2>\n    <p>Notifikasi dan approval tim creative</p>\n    ${ui.msg ? `<p class=\"err\" role=\"alert\">${esc(ui.msg)}</p>` : \"\"}\n    <label for=\"lUser\">Username</label><input id=\"lUser\" autocomplete=\"username\" autocapitalize=\"none\" value=\"${esc(ui.loginUser || \"\")}\" required>\n    <label for=\"lPass\">Password</label><input id=\"lPass\" type=\"password\" autocomplete=\"current-password\" required>\n    <button class=\"big-btn\" ${ui.busy === \"login\" ? \"disabled\" : \"\"}>${ui.busy === \"login\" ? \"Masuk…\" : \"Masuk\"}</button>\n    <p class=\"hint\">Pakai username dan password yang sama dengan aplikasi laptop.</p>\n  </form>`;\n}\nfunction bindLogin() {\n  $(\"loginForm\").addEventListener(\"submit\", async (e) => {\n    e.preventDefault();\n    const username = $(\"lUser\").value.trim().toLowerCase(), password = $(\"lPass\").value;\n    ui.loginUser = username;\n    if (!username || !password) { ui.msg = \"Isi username dan password.\"; return render(); }\n    ui.busy = \"login\"; ui.msg = \"\"; render();\n    try {\n      const r = await api(\"/api/login\", { username, password });\n      ui.token = r.token; ui.user = r.user;\n      localStorage.setItem(\"aab_m_token\", r.token);\n      localStorage.setItem(\"aab_m_user\", JSON.stringify(r.user));\n      await idbPut(\"token\", r.token);\n      ui.busy = \"\"; ui.tab = \"notif\";\n      render();\n      loadAll();\n    } catch (err) { ui.busy = \"\"; ui.msg = err.message; render(); }\n  });\n}\n\nfunction notifView() {\n  const items = (ui.notif && ui.notif.items) || [];\n  const shown = ui.filter === \"unread\" ? items.filter((n) => !n.read) : items;\n  const unread = items.filter((n) => !n.read).length;\n  const fresh = shown.filter((n) => Date.now() - Date.parse(n.at) < 86400000);\n  const older = shown.filter((n) => Date.now() - Date.parse(n.at) >= 86400000);\n  const row = (n) => {\n    const [ic, c] = notifIcon(n);\n    const av = n.type === \"epnew\" ? avatar(\"\", \"\", \"EP\") : n.type === \"request\" ? avatar(\"\", \"\", (n.requester || \"?\").split(/\\s+/).map((w) => w[0]).join(\"\").slice(0, 2)) : avatar(n.by);\n    return `<button class=\"notif glass${n.read ? \"\" : \" unread\"}\" data-n=\"${esc(n.id)}\"><span class=\"ic\">${av}<i style=\"background:${c}\">${esc(ic)}</i></span>\n      <span class=\"t\">${notifLine(n)}<small>${esc(ago(n.at))}${n.type === \"request\" || n.type === \"epnew\" ? \" · perlu approval\" : \"\"}</small></span>${n.read ? \"\" : '<span class=\"dot\" aria-label=\"belum dibaca\"></span>'}</button>`;\n  };\n  return `<div class=\"top\"><h1>Notifikasi</h1>${unread ? `<button class=\"back\" data-act=\"readall\">Tandai dibaca</button>` : \"\"}</div>\n    <div class=\"chips\" role=\"group\" aria-label=\"Filter\"><button class=\"chip\" data-f=\"all\" aria-pressed=\"${ui.filter === \"all\"}\">Semua</button><button class=\"chip\" data-f=\"unread\" aria-pressed=\"${ui.filter === \"unread\"}\">Belum dibaca${unread ? ` · ${unread}` : \"\"}</button></div>\n    ${!ui.notif ? `<p class=\"empty\">Memuat…</p>` : !shown.length ? `<p class=\"empty\">${ui.filter === \"unread\" ? \"Semua sudah dibaca.\" : \"Belum ada notifikasi. Kalau ada yang menandai, mengomentari, atau ada request baru, muncul di sini.\"}</p>` : `<div class=\"list\">\n      ${fresh.length ? `<div class=\"sec\">BARU</div>${fresh.map(row).join(\"\")}` : \"\"}\n      ${older.length ? `<div class=\"sec\">SEBELUMNYA</div>${older.map(row).join(\"\")}` : \"\"}</div>`}\n    ${pushNudge()}`;\n}\nfunction pushNudge() {\n  if (!(\"Notification\" in window) || Notification.permission === \"granted\" || localStorage.getItem(\"aab_m_nudge\") === \"off\") return \"\";\n  return `<div class=\"spacer\"></div><div class=\"glass install\"><b>Nyalakan notifikasi HP</b><span class=\"hint\" style=\"padding:0\">Supaya tag, komentar, dan approval masuk walau aplikasi ditutup.</span><div class=\"btns\"><button class=\"btn ok\" data-act=\"gopush\">Nyalakan</button><button class=\"btn\" data-act=\"nudgeoff\">Nanti</button></div></div>`;\n}\nfunction bindNotif() {\n  document.querySelectorAll(\"[data-f]\").forEach((b) => b.addEventListener(\"click\", () => { ui.filter = b.dataset.f; render(); }));\n  document.querySelectorAll(\"[data-n]\").forEach((b) => b.addEventListener(\"click\", () => openNotif(b.dataset.n)));\n  on(\"readall\", async () => { try { await api(\"/api/notif/read\", {}); ui.notif.items.forEach((n) => { n.read = true; }); ui.notif.unread = 0; if (navigator.setAppBadge) navigator.setAppBadge(0).catch(() => {}); } catch (e) { ui.msg = e.message; } render(); });\n  on(\"gopush\", () => { ui.tab = \"akun\"; render(); });\n  on(\"nudgeoff\", () => { localStorage.setItem(\"aab_m_nudge\", \"off\"); render(); });\n}\nfunction on(act, fn) { document.querySelectorAll(`[data-act=\"${act}\"]`).forEach((b) => b.addEventListener(\"click\", fn)); }\n\nasync function openNotif(id) {\n  const n = ui.notif && ui.notif.items.find((x) => x.id === id);\n  if (!n) return;\n  if (!n.read) { n.read = true; ui.notif.unread = Math.max(0, ui.notif.unread - 1); api(\"/api/notif/read\", { id }).catch(() => {}); if (navigator.setAppBadge) navigator.setAppBadge(ui.notif.unread).catch(() => {}); }\n  ui.msg = \"\"; ui.okMsg = \"\";\n  if (n.type === \"request\") { if (isLead()) { ui.tab = \"approval\"; ui.seg = \"req\"; ui.focus = n.reqId; ui.view = null; } render(); return; }\n  if (n.type === \"epnew\" && isLead()) { ui.tab = \"approval\"; ui.seg = \"ep\"; ui.focusEp = n.epId; ui.view = null; if (!ui.ep) loadEp(); render(); return; }\n  if (n.type === \"ep\" || n.type === \"epnew\") { ui.view = { type: \"ep\", epId: n.epId, n }; if (!ui.ep) loadEp(); render(); return; }\n  if (n.type === \"update\") { ui.view = { type: \"update\", n }; render(); return; }\n  if (n.postId) { ui.view = { type: \"post\", id: n.postId }; render(); loadPost(n.postId); }\n}\nasync function loadPost(id) {\n  try {\n    const r = await api(`/api/feed/item?id=${encodeURIComponent(id)}`);\n    if (ui.view && ui.view.id === id) { ui.view.item = r.item; render(); }\n    if (r.item.image) {\n      const img = await api(`/api/feed/image?id=${encodeURIComponent(id)}`);\n      if (ui.view && ui.view.id === id) { ui.view.img = img.image; render(); }\n    }\n  } catch (e) { if (ui.view && ui.view.id === id) { ui.view.err = e.message; render(); } }\n}\n\nfunction detailView() {\n  const v = ui.view;\n  const back = `<div class=\"top\"><button class=\"back\" data-act=\"back\">‹ ${v.type === \"ep\" && ui.tab === \"approval\" ? \"Approval\" : \"Notifikasi\"}</button></div>`;\n  if (v.type === \"update\") return `${back}<div class=\"glass card\"><p><b>${esc(nameOf(v.n.by))}</b> minta semua update aplikasi laptop ke <b>v${esc(v.n.version)}</b>.</p><p class=\"hint\" style=\"padding:0\">Di laptop: buka Creative AAB → Pengaturan → Cek pembaruan → Pasang dan restart.</p></div>`;\n  if (v.type === \"ep\") {\n    const it = ((ui.ep && ui.ep.items) || []).find((x) => x.id === v.epId);\n    if (!it) return `${back}${ui.ep ? `<p class=\"empty\">Slide EP ini sudah tidak ada di file EP bulan ini.</p>` : `<p class=\"empty\">Memuat EP…</p>`}`;\n    return back + epCard(it, { readOnly: !isLead() });\n  }\n  const p = v.item;\n  if (v.err) return `${back}<p class=\"empty\">${esc(v.err)}</p>`;\n  if (!p) return `${back}<p class=\"empty\">Memuat postingan…</p>`;\n  const reacts = Object.entries(p.reactions || {}).filter(([, c]) => c).map(([k, c]) => `<span class=\"r\">${REACT[k] || \"👍\"} ${c}</span>`).join(\"\");\n  return `${back}<article class=\"glass post\">\n    <div class=\"h\">${avatar(p.by)}<div><b>${esc(nameOf(p.by))}</b><small>${esc((person(p.by) || {}).title || \"\")}${(person(p.by) || {}).title ? \" · \" : \"\"}${esc(ago(p.at))}</small></div></div>\n    ${p.kind === \"auto\" ? `<div class=\"txt\"><b>${esc(shortOf(p.by))}</b> ${esc(p.text)}</div>` : p.text ? `<div class=\"txt\">${mentions(esc(p.text))}</div>` : \"\"}\n    ${p.image ? (v.img ? `<img class=\"ph\" src=\"${esc(v.img)}\" alt=\"Foto postingan\">` : `<div class=\"ep\"><div class=\"thumb\">Memuat foto…</div></div>`) : \"\"}\n    ${reacts || p.comments.length ? `<div class=\"reacts\">${reacts}${p.comments.length ? `<span>${p.comments.length} komentar</span>` : \"\"}</div>` : \"\"}\n    ${p.comments.map((c) => `<div class=\"cm\">${avatar(c.by, \"sm\")}<div class=\"bub\"><b>${esc(nameOf(c.by))}</b>${mentions(esc(c.text))}</div></div>`).join(\"\")}\n  </article>\n  <p class=\"ro\">Membalas dan memberi reaksi lewat aplikasi di laptop.</p>`;\n}\nfunction bindDetail() {\n  on(\"back\", () => { ui.view = null; render(); window.scrollTo(0, 0); });\n  bindEpButtons();\n}\n\n// ---------- Approval (Ray) ----------\nfunction approvalView() {\n  const reqs = pendingRequests();\n  const eps = pendingEp();\n  const seg = `<div class=\"seg\" role=\"group\" aria-label=\"Jenis approval\"><button data-seg=\"req\" aria-pressed=\"${ui.seg === \"req\"}\">Request · ${reqs.length}</button><button data-seg=\"ep\" aria-pressed=\"${ui.seg === \"ep\"}\">EP · ${eps.length}</button></div>`;\n  let body;\n  if (ui.seg === \"req\") {\n    body = !ui.state ? `<p class=\"empty\">Memuat…</p>` : !reqs.length ? `<p class=\"empty\">Tidak ada request yang menunggu approval.</p>` : `<div class=\"list\">${reqs.map((r) => {\n      const busy = ui.busy === `req:${r.id}`;\n      return `<div class=\"glass card\" id=\"req-${esc(r.id)}\">\n        <div class=\"h\">${avatar(\"\", \"sm\", (r.user || \"?\").split(/\\s+/).map((w) => w[0]).join(\"\").slice(0, 2))}<div><b>${esc(r.user || \"Tanpa nama\")}</b><small>${esc(r.submitted || \"\")}${r.output ? ` · ${esc(r.output)}` : \"\"}</small></div></div>\n        <p>${esc(r.info)}</p>\n        <div class=\"meta\">${r.deadline ? `<span class=\"pill hot\">Deadline ${esc(r.deadline)}</span>` : \"\"}<span class=\"pill\">Baris ${r.row}</span>${r.decision === \"PENDING\" ? `<span class=\"pill\">Ditunda</span>` : \"\"}</div>\n        <div class=\"btns\">${[\"APPROVE\", \"PENDING\", \"REJECT\"].map((d) => `<button class=\"btn${d === \"APPROVE\" ? \" ok\" : d === \"REJECT\" ? \" no\" : \"\"}\" data-req=\"${esc(r.id)}\" data-row=\"${r.row}\" data-d=\"${d}\" ${busy ? \"disabled\" : \"\"}>${{ APPROVE: \"Approve\", PENDING: \"Pending\", REJECT: \"Reject\" }[d]}</button>`).join(\"\")}</div>\n      </div>`;\n    }).join(\"\")}</div>`;\n  } else {\n    body = ui.epErr ? `<p class=\"err\">${esc(ui.epErr)}</p>` : !ui.ep ? `<p class=\"empty\">Memuat EP…</p>` : !ui.ep.configured ? `<p class=\"empty\">Link EP belum diisi di aplikasi laptop.</p>` : !eps.length ? `<p class=\"empty\">Semua slide EP sudah diputuskan.</p>` : `<div class=\"list\">${eps.map((it) => epCard(it)).join(\"\")}</div>`;\n  }\n  return `<div class=\"top\"><h1>Approval</h1></div>${seg}${body}<p class=\"hint\">Keputusan langsung tertulis ke sheet dan EP, sama seperti dari laptop.</p>`;\n}\nfunction epCard(it, { readOnly = false } = {}) {\n  const th = ui.thumbs[it.id];\n  const d = it.decision;\n  const busy = ui.busy === `ep:${it.id}`;\n  return `<div class=\"glass ep\" id=\"ep-${esc(it.id)}\">\n    <div class=\"thumb\" data-thumb=\"${esc(it.id)}\">${th && th.url ? `<img src=\"${esc(th.url)}\" alt=\"Slide EP ${esc(it.cover || it.format)}\">` : th && th.err ? \"Gambar slide gagal dimuat\" : \"Memuat slide…\"}</div>\n    <div class=\"b\"><h3>${esc(it.cover || it.format || \"Tanpa judul\")}</h3>\n      <div class=\"meta\">${it.format ? `<span class=\"pill\">${esc(it.format)}</span>` : \"\"}${it.account ? `<span class=\"pill\">${esc(it.account)}</span>` : \"\"}${it.uploadText ? `<span class=\"pill\">Upload ${esc(it.uploadText)}</span>` : \"\"}${it.talent ? `<span class=\"pill\">Talent: ${esc(it.talent)}</span>` : \"\"}\n        ${d ? `<span class=\"pill ${d.status === \"OKE\" ? \"ok\" : \"no\"}\">${d.status === \"OKE\" ? \"OKE\" : \"Revisi\"}</span>` : \"\"}${it.posted ? `<span class=\"pill ok\">POSTED</span>` : \"\"}</div>\n      ${d && d.note ? `<p class=\"note-show\">Catatan: ${esc(d.note)}</p>` : \"\"}\n      ${readOnly ? \"\" : `<div class=\"btns\"><button class=\"btn ok\" data-ep=\"${esc(it.id)}\" data-s=\"OKE\" ${busy ? \"disabled\" : \"\"}>OKE</button><button class=\"btn no\" data-ep=\"${esc(it.id)}\" data-s=\"REVISI\" ${busy ? \"disabled\" : \"\"}>Revisi</button></div>`}\n    </div></div>`;\n}\nfunction loadThumbs() {\n  document.querySelectorAll(\"[data-thumb]\").forEach((el) => {\n    const id = el.dataset.thumb;\n    if (ui.thumbs[id]) return;\n    ui.thumbs[id] = { loading: true };\n    api(`/api/ep/thumb?id=${encodeURIComponent(id)}`).then((r) => { ui.thumbs[id] = { url: r.url }; }).catch(() => { ui.thumbs[id] = { err: true }; }).finally(render);\n  });\n}\nfunction bindApproval() {\n  document.querySelectorAll(\"[data-seg]\").forEach((b) => b.addEventListener(\"click\", () => { ui.seg = b.dataset.seg; if (ui.seg === \"ep\" && !ui.ep) loadEp(); render(); }));\n  document.querySelectorAll(\"[data-req]\").forEach((b) => b.addEventListener(\"click\", async () => {\n    ui.busy = `req:${b.dataset.req}`; ui.msg = \"\"; ui.okMsg = \"\"; render();\n    try {\n      await api(\"/api/request/decision\", { id: b.dataset.req, row: Number(b.dataset.row), decision: b.dataset.d });\n      ui.okMsg = `Request baris ${b.dataset.row}: ${b.dataset.d}.`;\n      await loadState();\n    } catch (e) { ui.msg = e.message; }\n    ui.busy = \"\"; render();\n  }));\n  bindEpButtons();\n  if (ui.focus) { const el = document.getElementById(`req-${ui.focus}`); if (el) el.scrollIntoView({ block: \"center\" }); ui.focus = null; }\n  if (ui.focusEp && ui.ep) { const el = document.getElementById(`ep-${ui.focusEp}`); if (el) el.scrollIntoView({ block: \"start\" }); ui.focusEp = null; }\n}\nfunction bindEpButtons() {\n  loadThumbs();\n  document.querySelectorAll(\"[data-thumb] img\").forEach((img) => img.addEventListener(\"error\", () => { ui.thumbs[img.closest(\"[data-thumb]\").dataset.thumb] = { err: true }; render(); }, { once: true }));\n  document.querySelectorAll(\"[data-ep]\").forEach((b) => b.addEventListener(\"click\", () => {\n    if (b.dataset.s === \"OKE\") return decideEp(b.dataset.ep, \"OKE\", \"\");\n    openSheet(b.dataset.ep);\n  }));\n}\nfunction openSheet(id) {\n  const it = ui.ep.items.find((x) => x.id === id);\n  const root = $(\"sheet-root\");\n  root.innerHTML = `<div class=\"sheet-shade\" data-act=\"closeSheet\"></div><div class=\"sheet\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"sheetTitle\"><span class=\"grab\"></span>\n    <b id=\"sheetTitle\">Catatan revisi: ${esc(it ? it.cover || it.format : \"\")}</b>\n    <textarea id=\"revNote\" maxlength=\"1000\" placeholder=\"Apa yang perlu diubah?\"></textarea>\n    <div class=\"btns\"><button class=\"btn\" data-act=\"closeSheet\">Batal</button><button class=\"btn ok\" data-act=\"sendRev\">Kirim revisi</button></div></div>`;\n  const ta = $(\"revNote\");\n  ta.focus();\n  const close = () => { root.innerHTML = \"\"; };\n  root.querySelectorAll('[data-act=\"closeSheet\"]').forEach((x) => x.addEventListener(\"click\", close));\n  root.querySelector('[data-act=\"sendRev\"]').addEventListener(\"click\", async () => {\n    const note = ta.value.trim();\n    if (!note) { ta.focus(); ta.placeholder = \"Catatan revisi wajib diisi.\"; return; }\n    close();\n    await decideEp(id, \"REVISI\", note);\n  });\n}\nasync function decideEp(id, status, note) {\n  ui.busy = `ep:${id}`; ui.msg = \"\"; ui.okMsg = \"\"; render();\n  try {\n    await api(\"/api/ep/decision\", { id, status, note });\n    ui.okMsg = status === \"OKE\" ? \"EP di-OKE. Tim dapat notifikasi.\" : \"Revisi terkirim ke tim.\";\n    await loadEp();\n  } catch (e) { ui.msg = e.message; }\n  ui.busy = \"\"; render();\n}\n\n// ---------- Akun dan push ----------\nfunction akunView() {\n  const u = ui.user || {};\n  const p = person(u.username) || {};\n  const pushOk = \"serviceWorker\" in navigator && \"PushManager\" in window && \"Notification\" in window;\n  const perm = \"Notification\" in window ? Notification.permission : \"unsupported\";\n  const push = ui.push;\n  let pushBox;\n  if (!pushOk) {\n    pushBox = isIOS() && !standalone()\n      ? `<div class=\"glass install\"><b>Pasang dulu ke layar utama</b><span>Di iPhone, notifikasi hanya jalan setelah aplikasi dipasang:</span><ol><li>Buka halaman ini di Safari.</li><li>Ketuk tombol Share (kotak dengan panah ke atas).</li><li>Pilih <b>Add to Home Screen</b>, lalu buka Creative AAB dari layar utama.</li></ol></div>`\n      : `<p class=\"hint\">Browser ini tidak mendukung notifikasi push. Pakai Chrome (Android) atau Safari (iPhone, iOS 16.4 ke atas).</p>`;\n  } else if (perm === \"denied\") {\n    pushBox = `<p class=\"err\">Notifikasi diblokir untuk aplikasi ini. Buka pengaturan HP → Notifikasi → Creative AAB (atau pengaturan situs di Chrome), izinkan, lalu buka lagi halaman ini.</p>`;\n  } else if (!push || !push.subscribed) {\n    pushBox = `<button class=\"big-btn\" data-act=\"enablePush\" ${ui.busy === \"push\" ? \"disabled\" : \"\"}>${ui.busy === \"push\" ? \"Menyalakan…\" : \"Nyalakan notifikasi di HP ini\"}</button>`;\n  } else {\n    pushBox = PUSH_LABELS.filter(([k]) => ![\"request\", \"epnew\"].includes(k) || isLead()).map(([k, l, h]) => `<div class=\"glass row\"><span>${esc(l)}${h ? `<small>${esc(h)}</small>` : \"\"}</span><button class=\"sw\" role=\"switch\" aria-checked=\"${!!push.prefs[k]}\" aria-label=\"${esc(l)}\" data-pref=\"${k}\"></button></div>`).join(\"\")\n      + `<button class=\"btn\" data-act=\"testPush\" style=\"width:100%\">Kirim notifikasi uji</button><button class=\"btn\" data-act=\"disablePush\" style=\"width:100%\">Matikan notifikasi di HP ini</button>`;\n  }\n  const install = !standalone() && !isIOS() ? `<div class=\"glass install\"><b>Pasang ke layar utama</b><span>Di Chrome: ketuk menu ⋮ → <b>Tambahkan ke layar utama</b> (atau <b>Instal aplikasi</b>).</span></div>` : \"\";\n  return `<div class=\"top\"><h1>Akun</h1></div>\n    <div class=\"glass row\" style=\"justify-content:flex-start\">${avatar(u.username, \"lg\")}<span><b>${esc(u.name || \"\")}</b><small>${esc(p.title || (isLead() ? \"Creative Lead\" : \"Tim creative\"))} · @${esc(u.username || \"\")}</small></span></div>\n    <div class=\"sec\">NOTIFIKASI DI HP INI</div>\n    <div class=\"list\" style=\"margin-top:8px\">${pushBox}</div>\n    ${install ? `<div class=\"spacer\"></div>${install}` : \"\"}\n    <div class=\"spacer\"></div>\n    <button class=\"glass logout\" data-act=\"logout\">Keluar</button>\n    <p class=\"hint\" style=\"text-align:center\">Input KPI dan posting tetap lewat aplikasi laptop.</p>`;\n}\nasync function swReg() {\n  return navigator.serviceWorker.register(\"sw.js\", { scope: \"./\" });\n}\nasync function loadPush() {\n  if (!(\"serviceWorker\" in navigator) || !(\"PushManager\" in window) || !ui.token) return;\n  try {\n    const reg = await swReg();\n    const sub = await reg.pushManager.getSubscription();\n    ui.push = await api(`/api/push${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : \"\"}`);\n    if (sub && !ui.push.subscribed) {\n      // Langganan lama di HP tapi server belum tahu (misal setelah login ulang): daftarkan lagi.\n      await api(\"/api/push/subscribe\", { subscription: sub.toJSON(), prefs: ui.push.prefs, device: navigator.userAgent.slice(0, 80) });\n      ui.push.subscribed = true;\n    }\n  } catch { ui.push = ui.push || null; }\n  if (ui.tab === \"akun\") render();\n}\nfunction bindAkun() {\n  if (!ui.push && !ui.pushLoading) { ui.pushLoading = true; loadPush().finally(() => { ui.pushLoading = false; }); }\n  on(\"logout\", () => logout());\n  on(\"enablePush\", async () => {\n    ui.busy = \"push\"; ui.msg = \"\"; render();\n    try {\n      const perm = await Notification.requestPermission();\n      if (perm !== \"granted\") throw new Error(\"Izin notifikasi tidak diberikan.\");\n      const reg = await swReg();\n      await navigator.serviceWorker.ready;\n      const info = await api(\"/api/push\");\n      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(info.key) }));\n      const r = await api(\"/api/push/subscribe\", { subscription: sub.toJSON(), prefs: info.prefs, device: navigator.userAgent.slice(0, 80) });\n      ui.push = { subscribed: true, prefs: r.prefs, key: info.key };\n      ui.okMsg = \"Notifikasi HP menyala.\";\n    } catch (e) { ui.msg = e.message; }\n    ui.busy = \"\"; render();\n  });\n  document.querySelectorAll(\"[data-pref]\").forEach((b) => b.addEventListener(\"click\", async () => {\n    const k = b.dataset.pref;\n    const prefs = { ...ui.push.prefs, [k]: !ui.push.prefs[k] };\n    ui.push.prefs = prefs; render();\n    try {\n      const reg = await swReg();\n      const sub = await reg.pushManager.getSubscription();\n      if (sub) await api(\"/api/push/subscribe\", { subscription: sub.toJSON(), prefs, device: navigator.userAgent.slice(0, 80) });\n    } catch (e) { ui.msg = e.message; render(); }\n  }));\n  on(\"testPush\", async () => {\n    try { const reg = await swReg(); await reg.showNotification(\"Creative AAB\", { body: \"Notifikasi di HP ini sudah jalan.\", icon: \"icon-192.png\", badge: \"badge.png\", tag: \"aab-test\" }); }\n    catch (e) { ui.msg = e.message; render(); }\n  });\n  on(\"disablePush\", async () => {\n    try {\n      const reg = await swReg();\n      const sub = await reg.pushManager.getSubscription();\n      if (sub) { await api(\"/api/push/unsubscribe\", { endpoint: sub.endpoint }); await sub.unsubscribe(); }\n      ui.push = { ...(ui.push || {}), subscribed: false };\n      ui.okMsg = \"Notifikasi HP dimatikan.\";\n    } catch (e) { ui.msg = e.message; }\n    render();\n  });\n}\nfunction b64uToBytes(s) {\n  const b = atob(s.replace(/-/g, \"+\").replace(/_/g, \"/\") + \"===\".slice((s.length + 3) % 4));\n  return Uint8Array.from(b, (c) => c.charCodeAt(0));\n}\n\nasync function logout() {\n  try {\n    const reg = \"serviceWorker\" in navigator ? await navigator.serviceWorker.getRegistration(\"./\") : null;\n    const sub = reg && (await reg.pushManager.getSubscription());\n    if (sub && ui.token) { await fetch(\"/api/push/unsubscribe\", { method: \"POST\", headers: { \"Content-Type\": \"application/json\", Authorization: `Bearer ${ui.token}` }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }\n  } catch { /* tetap keluar */ }\n  [\"aab_m_token\", \"aab_m_user\", \"aab_m_photos\"].forEach((k) => localStorage.removeItem(k));\n  await idbDel(\"token\");\n  Object.assign(ui, { token: \"\", user: null, notif: null, state: null, ep: null, push: null, view: null, tab: \"notif\", msg: \"\", okMsg: \"\", photos: {} });\n  if (navigator.setAppBadge) navigator.setAppBadge(0).catch(() => {});\n  render();\n}\n\n// ---------- Mulai ----------\nif (\"serviceWorker\" in navigator) {\n  navigator.serviceWorker.addEventListener(\"message\", (e) => { if (e.data && e.data.open) loadNotif().then(() => openNotif(e.data.open)); });\n}\nwindow.addEventListener(\"hashchange\", () => openFromHash());\nfunction openFromHash() {\n  const m = location.hash.match(/n=([^&]+)/);\n  if (!m) return;\n  history.replaceState(null, \"\", location.pathname);\n  const id = decodeURIComponent(m[1]);\n  loadNotif().then(() => openNotif(id));\n}\ndocument.addEventListener(\"visibilitychange\", () => { if (document.visibilityState === \"visible\" && ui.token) loadAll(); });\nsetInterval(() => { if (document.visibilityState === \"visible\" && ui.token) { loadNotif(); if (isLead() && ui.tab === \"approval\") loadState(); } }, POLL_MS);\n\nrender();\nwindow.__aabReady = true;\nif (ui.token) { idbPut(\"token\", ui.token); loadAll().then(() => { loadPush(); openFromHash(); }); }\n"},"apple-touch-icon.png":{"type":"image/png","b64":true,"data":"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"},"badge.png":{"type":"image/png","b64":true,"data":"iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAB/ElEQVR42u3c266EIAxAUUv4/192XsZkMvFCgbaAez2eMSgFiqCebQMAAAAAAAAAAAAAAAAAzGX/IhLnxCLgRScWkR7ltJxjhPOKd+BLL7bnqCkNSK9zahogRacYjxRVUn5UmkwRvT4iAHflR85RaaSAjTASvGWritTk9pLc2Tp57/u+l+bomkncpQFaLvr4/T9QvSp7Vb7HHZRLCmrtwWfHWlS2tUyvdJUiKyxfZoscp17s1gBvWtEOm4IiL7bXeZ46kufIyW/sjXfleaetvHLwNSkzar7Io6Yfz4Ccnatmvqu55rTqBNy6P0UKCtipjOhk+S2Bn343NGKS6h2UERdm0iMgFhXzfCDjWS+zrYjVbmOnWglvi75MMM0krNljt+rRVwHzvDbzETByRWbY+TRNQTVD1uudoZEXkSlqIfN7bMTrIMtOwvsPTa+3bgRt+V6jRkYb1k/PdEt6pvaxqUVdSkdQGmmI9n4wv/wkPGPOHW1CTj0C1xI8qwfztW9oTHsbqg2k9RsR2gl5xtEMAAAAbMGfoJZsvtVs0tUe+3SMZkPw6diQ1bUmWC2VvyuzpBG0v/3/XdMo0z8TLv2acaWVZo4I7FUARwisiMjRyB6NnbwqdVSk9zv+r/43CCUTkSantuT03t8G974WAAAAAAAAAAAAAAAAAADe4QP/ts/mFPvBUAAAAABJRU5ErkJggg=="},"icon-192.png":{"type":"image/png","b64":true,"data":"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"},"icon-512.png":{"type":"image/png","b64":true,"data":"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"},"index.html":{"type":"text/html; charset=utf-8","data":"<!DOCTYPE html>\n<html lang=\"id\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"theme-color\" content=\"#08111D\">\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">\n<meta name=\"apple-mobile-web-app-title\" content=\"Creative AAB\">\n<link rel=\"manifest\" href=\"manifest.webmanifest\">\n<link rel=\"icon\" href=\"icon-192.png\">\n<link rel=\"apple-touch-icon\" href=\"apple-touch-icon.png\">\n<style>html,body{background:#08111D;color:#EEF3FA;margin:0}.boot{font:15px -apple-system,system-ui,sans-serif;padding:80px 24px;text-align:center;color:#9DB0C8}.boot-err{font:13px ui-monospace,monospace;color:#FFB4BB;background:#3E1A20;margin:12px;padding:10px;border-radius:10px;white-space:pre-wrap;word-break:break-word}</style>\n<link rel=\"stylesheet\" href=\"style.css?v=242e44a9\">\n<title>Creative AAB</title>\n</head>\n<body>\n<main id=\"app\" aria-live=\"polite\"><p class=\"boot\">Memuat Creative AAB…</p></main>\n<nav class=\"tabbar\" id=\"tabbar\" hidden></nav>\n<div id=\"sheet-root\"></div>\n<script>\n// Kalau ada error saat memuat, tampilkan di layar supaya bisa difoto dan diperbaiki.\n(function () {\n  function show(msg) {\n    var d = document.createElement(\"div\"); d.className = \"boot-err\"; d.textContent = \"Error: \" + msg + \"\\n\" + navigator.userAgent;\n    document.body.appendChild(d);\n  }\n  window.addEventListener(\"error\", function (e) { show((e.message || \"gagal memuat \" + ((e.target && (e.target.src || e.target.href)) || \"\")) + (e.filename ? \" @ \" + e.filename.split(\"/\").pop() + \":\" + e.lineno : \"\")); }, true);\n  window.addEventListener(\"unhandledrejection\", function (e) { show(\"promise: \" + (e.reason && e.reason.message || e.reason)); });\n  setTimeout(function () { if (!window.__aabReady) show(\"Aplikasi tidak selesai dimuat dalam 8 detik.\"); }, 8000);\n})();\n</script>\n<script src=\"app.js?v=242e44a9\"></script>\n</body>\n</html>\n"},"manifest.webmanifest":{"type":"application/manifest+json","data":"{\n  \"name\": \"Creative AAB\",\n  \"short_name\": \"Creative AAB\",\n  \"description\": \"Notifikasi dan approval tim creative AAB\",\n  \"start_url\": \"/m/\",\n  \"scope\": \"/m/\",\n  \"display\": \"standalone\",\n  \"background_color\": \"#08111D\",\n  \"theme_color\": \"#08111D\",\n  \"lang\": \"id\",\n  \"icons\": [\n    { \"src\": \"icon-192.png\", \"sizes\": \"192x192\", \"type\": \"image/png\", \"purpose\": \"any maskable\" },\n    { \"src\": \"icon-512.png\", \"sizes\": \"512x512\", \"type\": \"image/png\", \"purpose\": \"any maskable\" }\n  ]\n}\n"},"style.css":{"type":"text/css; charset=utf-8","data":"/* Creative AAB versi HP. Mengikuti widget: navy gelap, kartu glass, aksen biru. */\n:root { color-scheme: dark; --bg: #08111D; --panel: #0E1A2B; --panel2: #13233A; --line: #1F334D; --ink: #EEF3FA; --ink2: #9DB0C8; --accent: #5B9BE6; --accent2: #8BBAF2; --warn: #FFB4BB; --amber: #F3C77A; --safe-t: env(safe-area-inset-top, 0px); --safe-b: env(safe-area-inset-bottom, 0px); }\n* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }\nhtml, body { margin: 0; min-height: 100%; }\nbody { font-family: -apple-system, \"Segoe UI\", Roboto, system-ui, sans-serif; color: var(--ink); font-size: 15px; line-height: 1.4;\n  background: radial-gradient(120% 60% at 0% 0%, #12305a 0%, transparent 60%) fixed, radial-gradient(90% 50% at 100% 100%, #1b2f55 0%, transparent 60%) fixed, var(--bg); }\nbutton { font: inherit; color: inherit; }\nmain { padding: calc(var(--safe-t) + 14px) 14px calc(var(--safe-b) + 96px); max-width: 640px; margin: 0 auto; }\n.top { display: flex; align-items: center; gap: 12px; padding: 4px 4px 12px; }\n.top h1 { font-size: 28px; margin: 0; flex: 1; letter-spacing: -.01em; }\n.back { border: 0; background: none; color: var(--accent2); padding: 6px 0; font-size: 16px; cursor: pointer; }\n.av { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; flex: none; color: #08111D; overflow: hidden; font-size: 15px; }\n.av img { width: 100%; height: 100%; object-fit: cover; }\n.av.sm { width: 30px; height: 30px; font-size: 12px; }\n.av.lg { width: 56px; height: 56px; font-size: 20px; }\n.chips { display: flex; gap: 8px; padding: 0 4px 12px; }\n.chip { padding: 7px 15px; border-radius: 999px; border: 1px solid var(--line); font-size: 14px; color: var(--ink2); background: none; cursor: pointer; }\n.chip[aria-pressed=\"true\"] { background: var(--ink); color: var(--bg); border-color: var(--ink); font-weight: 600; }\n.list { display: flex; flex-direction: column; gap: 10px; }\n.glass { background: rgb(14 26 43 / .8); border: 1px solid rgb(139 186 242 / .14); border-radius: 18px; -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }\n.sec { font-size: 12.5px; color: var(--ink2); font-weight: 600; letter-spacing: .04em; padding: 8px 6px 0; }\n.notif { display: flex; gap: 12px; padding: 12px; align-items: flex-start; width: 100%; text-align: left; cursor: pointer; }\n.notif.unread { background: rgb(91 155 230 / .14); border-color: rgb(91 155 230 / .35); }\n.notif .t { flex: 1; font-size: 14.5px; min-width: 0; overflow-wrap: anywhere; }\n.notif .t small { display: block; color: var(--ink2); font-size: 12.5px; margin-top: 3px; }\n.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); margin-top: 6px; flex: none; }\n.ic { position: relative; flex: none; }\n.ic i { position: absolute; right: -4px; bottom: -4px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 11px; border: 2px solid var(--bg); color: #08111D; font-weight: 700; }\n.empty { color: var(--ink2); text-align: center; padding: 40px 16px; }\n.err { color: var(--warn); background: #3E1A20; border-radius: 12px; padding: 10px 12px; font-size: 14px; margin: 0 0 10px; }\n.ok-msg { color: #8FE3B5; background: #12382A; border-radius: 12px; padding: 10px 12px; font-size: 14px; margin: 0 0 10px; }\n.tabbar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-around; padding: 8px 10px calc(var(--safe-b) + 10px); border-top: 1px solid var(--line); background: rgb(5 11 20 / .92); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); z-index: 10; }\n.tab { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11.5px; color: var(--ink2); position: relative; min-width: 84px; border: 0; background: none; padding: 2px 0; cursor: pointer; }\n.tab[aria-current=\"page\"] { color: var(--ink); }\n.tab svg { width: 25px; height: 25px; }\n.tab b { position: absolute; top: -4px; left: calc(50% + 6px); background: #E5484D; color: #fff; font-size: 10.5px; border-radius: 999px; padding: 0 5px; line-height: 16px; min-width: 16px; text-align: center; }\n.seg { display: flex; margin: 0 4px 12px; background: var(--panel); border-radius: 12px; padding: 3px; }\n.seg button { flex: 1; text-align: center; padding: 8px; border-radius: 9px; font-size: 14.5px; color: var(--ink2); border: 0; background: none; cursor: pointer; }\n.seg button[aria-pressed=\"true\"] { background: var(--panel2); color: var(--ink); font-weight: 600; }\n.card { padding: 14px; display: flex; flex-direction: column; gap: 9px; }\n.card .h { display: flex; align-items: center; gap: 10px; }\n.card .h small { color: var(--ink2); font-size: 12.5px; display: block; }\n.card p { margin: 0; font-size: 15px; overflow-wrap: anywhere; white-space: pre-wrap; }\n.meta { display: flex; gap: 6px; flex-wrap: wrap; }\n.pill { font-size: 12px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--ink2); }\n.pill.hot { border-color: #7a4b1c; color: var(--amber); background: #2e2213; }\n.pill.ok { border-color: #1f5a40; color: #8FE3B5; background: #12382A; }\n.pill.no { border-color: #5b2a32; color: var(--warn); background: #3E1A20; }\n.btns { display: flex; gap: 8px; }\n.btn { flex: 1; text-align: center; padding: 12px 10px; border-radius: 12px; font-weight: 600; font-size: 15px; border: 1px solid var(--line); background: none; cursor: pointer; }\n.btn.ok { background: var(--ink); color: var(--bg); border-color: var(--ink); }\n.btn.no { color: var(--warn); border-color: #5b2a32; }\n.btn:disabled { opacity: .5; }\n.btn.sel { outline: 2px solid var(--accent); outline-offset: 2px; }\n.ep { padding: 0; overflow: hidden; }\n.ep .thumb { width: 100%; aspect-ratio: 16 / 9; background: var(--panel2); display: grid; place-items: center; color: var(--ink2); font-size: 13px; }\n.ep .thumb img { width: 100%; height: 100%; object-fit: contain; display: block; background: #fff; }\n.ep .b { padding: 14px; display: flex; flex-direction: column; gap: 9px; }\n.ep h3 { margin: 0; font-size: 17px; }\n.note-show { font-size: 13.5px; color: var(--ink2); }\n.sheet-shade { position: fixed; inset: 0; background: rgb(0 0 0 / .5); z-index: 20; }\n.sheet { position: fixed; left: 0; right: 0; bottom: 0; padding: 14px 16px calc(var(--safe-b) + 18px); border-radius: 22px 22px 0 0; background: #101e31; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; z-index: 21; max-width: 640px; margin: 0 auto; }\n.sheet .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); align-self: center; }\ntextarea, input { width: 100%; background: var(--panel2); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; color: var(--ink); font: inherit; font-size: 16px; }\ntextarea { min-height: 96px; resize: vertical; }\ntextarea:focus, input:focus, button:focus-visible { outline: 2px solid var(--accent2); outline-offset: 2px; }\n.post { padding: 14px; display: flex; flex-direction: column; gap: 10px; }\n.post .h { display: flex; gap: 10px; align-items: center; }\n.post .h small { display: block; color: var(--ink2); font-size: 12.5px; }\n.post .txt { white-space: pre-wrap; overflow-wrap: anywhere; }\n.post img.ph { width: 100%; border-radius: 12px; display: block; }\n.mention { color: var(--accent2); background: rgb(91 155 230 / .18); border-radius: 4px; padding: 0 3px; font-weight: 600; }\n.reacts { display: flex; gap: 6px; font-size: 13.5px; color: var(--ink2); align-items: center; border-top: 1px solid var(--line); padding-top: 8px; flex-wrap: wrap; }\n.reacts span.r { border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; color: var(--ink); }\n.cm { display: flex; gap: 8px; align-items: flex-start; }\n.cm .bub { background: rgb(255 255 255 / .06); border-radius: 14px; padding: 6px 12px; font-size: 14px; min-width: 0; overflow-wrap: anywhere; }\n.cm .bub b { display: block; font-size: 12.5px; }\n.ro { text-align: center; font-size: 13px; color: var(--ink2); padding: 6px 0; }\n.login { min-height: calc(100vh - 120px); display: flex; flex-direction: column; justify-content: center; gap: 12px; padding: 0 12px; }\n.login img { width: 76px; height: 76px; border-radius: 18px; align-self: center; }\n.login h2 { text-align: center; margin: 4px 0 0; font-size: 24px; }\n.login p { text-align: center; color: var(--ink2); margin: 0 0 8px; }\n.login label { font-size: 13px; color: var(--ink2); margin-bottom: -6px; }\n.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; }\n.row span small { display: block; color: var(--ink2); font-size: 12.5px; }\n.sw { width: 50px; height: 30px; border-radius: 999px; background: var(--line); position: relative; border: 0; flex: none; cursor: pointer; }\n.sw::after { content: \"\"; position: absolute; left: 3px; top: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; transition: left .15s; }\n.sw[aria-checked=\"true\"] { background: var(--accent); }\n.sw[aria-checked=\"true\"]::after { left: 23px; }\n.hint { color: var(--ink2); font-size: 13px; padding: 0 6px; margin: 4px 0; }\n.big-btn { width: 100%; padding: 14px; border-radius: 14px; border: 0; background: var(--accent); color: #fff; font-weight: 700; font-size: 16px; cursor: pointer; }\n.logout { width: 100%; padding: 14px; color: var(--warn); text-align: center; border: 1px solid rgb(139 186 242 / .14); cursor: pointer; }\n.install { padding: 14px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }\n.install ol { margin: 4px 0 0; padding-left: 20px; color: var(--ink2); }\n.spacer { height: 10px; }\n"},"sw.js":{"type":"text/javascript; charset=utf-8","data":"// Service worker versi HP Creative AAB.\n// Push dari server tidak membawa isi. Saat push masuk, ambil notifikasi terbaru dari server\n// dengan token login yang disimpan di IndexedDB, lalu tampilkan yang belum pernah ditampilkan.\nconst DB = \"aab-mobile\";\n\nfunction idb(mode, fn) {\n  return new Promise((resolve, reject) => {\n    const open = indexedDB.open(DB, 1);\n    open.onupgradeneeded = () => open.result.createObjectStore(\"kv\");\n    open.onerror = () => reject(open.error);\n    open.onsuccess = () => {\n      const tx = open.result.transaction(\"kv\", mode);\n      const req = fn(tx.objectStore(\"kv\"));\n      tx.oncomplete = () => resolve(req && req.result);\n      tx.onerror = () => reject(tx.error);\n    };\n  });\n}\nconst get = (k) => idb(\"readonly\", (s) => s.get(k));\nconst put = (k, v) => idb(\"readwrite\", (s) => s.put(v, k));\n\nself.addEventListener(\"install\", () => self.skipWaiting());\nself.addEventListener(\"activate\", (e) => e.waitUntil(self.clients.claim()));\n\nconst VERB = {\n  mention: (n) => (n.postBy && n.postBy !== n.by ? \"menandai kamu di komentar\" : \"menandai kamu di postingan\"),\n  comment: () => \"mengomentari postinganmu\",\n  reply: () => \"juga mengomentari postingan yang kamu komentari\",\n  react: () => \"memberi reaksi pada postinganmu\",\n  update: (n) => `minta kamu update aplikasi laptop ke v${n.version}`,\n};\n\nfunction describe(n, names) {\n  const who = names[n.by] || n.by || \"\";\n  if (n.type === \"request\") return { title: `Request baru dari ${n.requester || \"user\"}`, body: `${n.text}${n.deadline ? ` · deadline ${n.deadline}` : \"\"}. Perlu approval.` };\n  if (n.type === \"epnew\") return { title: `EP baru: ${n.text}`, body: `Perlu approval${n.upload ? `, upload ${n.upload}` : \"\"}.` };\n  if (n.type === \"ep\") return { title: n.status === \"OKE\" ? `EP di-OKE: ${n.text}` : `Revisi EP: ${n.text}`, body: n.status === \"OKE\" ? \"Lanjut produksi.\" : n.note || \"Ada catatan revisi.\" };\n  const verb = (VERB[n.type] || (() => \"berinteraksi denganmu\"))(n);\n  return { title: `${who} ${verb}`, body: n.text || \"\" };\n}\n\nself.addEventListener(\"push\", (event) => {\n  event.waitUntil((async () => {\n    const token = await get(\"token\").catch(() => null);\n    let items = [];\n    let names = {};\n    if (token) {\n      try {\n        const res = await fetch(\"/api/notif\", { headers: { Authorization: `Bearer ${token}` } });\n        if (res.ok) items = (await res.json()).items || [];\n        names = (await get(\"names\").catch(() => null)) || {};\n      } catch { /* tampilkan pesan umum di bawah */ }\n    }\n    const shown = new Set((await get(\"shown\").catch(() => null)) || []);\n    const fresh = items.filter((n) => !n.read && !shown.has(n.id));\n    const unread = items.filter((n) => !n.read).length;\n    if (self.navigator.setAppBadge) self.navigator.setAppBadge(unread).catch(() => {});\n    if (!fresh.length) {\n      // iOS mewajibkan setiap push menampilkan notifikasi.\n      return self.registration.showNotification(\"Creative AAB\", { body: \"Ada notifikasi baru.\", icon: \"icon-192.png\", badge: \"badge.png\", tag: \"aab-generic\" });\n    }\n    for (const n of fresh.slice(0, 3).reverse()) {\n      const d = describe(n, names);\n      await self.registration.showNotification(d.title, { body: d.body.replace(/@([a-z0-9._-]+)/gi, (a, u) => (names[u.toLowerCase()] ? `@${names[u.toLowerCase()].split(\" \")[0]}` : a)), icon: \"icon-192.png\", badge: \"badge.png\", tag: n.id, data: { id: n.id } });\n      shown.add(n.id);\n    }\n    await put(\"shown\", [...shown].slice(-200));\n  })());\n});\n\nself.addEventListener(\"notificationclick\", (event) => {\n  event.notification.close();\n  const id = (event.notification.data || {}).id || \"\";\n  event.waitUntil((async () => {\n    const url = `/m/${id ? `#n=${encodeURIComponent(id)}` : \"\"}`;\n    const wins = await self.clients.matchAll({ type: \"window\", includeUncontrolled: true });\n    for (const w of wins) {\n      if (new URL(w.url).pathname.startsWith(\"/m/\")) {\n        await w.focus();\n        w.postMessage({ open: id });\n        return;\n      }\n    }\n    await self.clients.openWindow(url);\n  })());\n});\n"}};
// MOBILE-END
