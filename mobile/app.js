// Creative AAB versi HP: notifikasi, approval (Ray), pengaturan push.
// Input KPI dan posting tetap di aplikasi laptop.
"use strict";

const SHORT = { fitria: "Zahra", athallah: "Aqil", albar: "Albar", rifqi: "Rifqi", ray: "Ray" };
const AV_BG = { fitria: "#F3A6C8", athallah: "#FFD8A8", albar: "#8BBAF2", rifqi: "#A8E6CF", ray: "#C9B6FF" };
const REACT = { like: "👍", love: "❤️", haha: "😂", wow: "😮", fire: "🔥" };
const PUSH_LABELS = [
  ["mention", "Ditandai (@)", "Saat ada yang menandai kamu"],
  ["comment", "Komentar di postinganmu", ""],
  ["reply", "Balasan diskusi", "Komentar baru di postingan yang kamu komentari"],
  ["request", "Request baru", "Khusus Ray, request yang perlu approval"],
  ["epnew", "EP baru", "Khusus Ray, slide EP baru yang perlu approval"],
  ["ep", "Keputusan EP", "OKE atau revisi dari Ray"],
  ["react", "Reaksi", "Saat postinganmu diberi reaksi"],
  ["update", "Minta update aplikasi laptop", ""],
];
const POLL_MS = 60 * 1000;

const ui = {
  token: localStorage.getItem("aab_m_token") || "",
  user: JSON.parse(localStorage.getItem("aab_m_user") || "null"),
  tab: "notif",
  view: null, // { type: "post" | "ep" | "update", ... }
  filter: "all",
  seg: "req",
  notif: null,
  state: null,
  ep: null,
  photos: {},
  thumbs: {},
  push: null,
  msg: "",
  busy: "",
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isLead = () => !!ui.user && ui.user.member === "ray";
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

// ---------- IndexedDB (dipakai juga oleh service worker) ----------
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("aab-mobile", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("kv", mode);
      const req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const idbPut = (k, v) => idb("readwrite", (s) => s.put(v, k)).catch(() => {});
const idbDel = (k) => idb("readwrite", (s) => s.delete(k)).catch(() => {});

// ---------- API ----------
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(ui.token ? { Authorization: `Bearer ${ui.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ ok: false, error: `Server menjawab ${res.status}.` }));
  if (res.status === 401 && ui.token) { logout(); throw new Error("Sesi habis. Login lagi."); }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Gagal (${res.status}).`);
  return data;
}

// ---------- Tim dan nama ----------
const team = () => (ui.state && ui.state.team) || [];
const person = (username) => team().find((t) => t.username === username) || null;
const nameOf = (username) => (person(username) || {}).name || username || "";
const shortOf = (username) => { const p = person(username); return (p && SHORT[p.member]) || (p ? p.name.split(" ")[0] : username); };
function avatar(username, size = "", label = "") {
  const p = person(username);
  const ph = ui.photos[username];
  const bg = (p && AV_BG[p.member]) || "#F3C77A";
  const letters = label || (p ? shortOf(username) : username || "?").slice(0, label ? 2 : 1).toUpperCase();
  if (ph && ph.image && /^data:image\//.test(ph.image)) return `<span class="av ${size}"><img src="${esc(ph.image)}" alt=""></span>`;
  return `<span class="av ${size}" style="background:${bg}" aria-hidden="true">${esc(letters)}</span>`;
}
const mentions = (html) => html.replace(/(^|[\s(])@([a-z0-9._-]{3,32})/gi, (all, pre, raw) => {
  const u = raw.toLowerCase().replace(/[._-]+$/, "");
  return person(u) ? `${pre}<span class="mention">@${esc(shortOf(u))}</span>${raw.slice(u.length)}` : all;
});
const plain = (t) => String(t || "").replace(/@([a-z0-9._-]{3,32})/gi, (all, raw) => { const u = raw.toLowerCase().replace(/[._-]+$/, ""); return person(u) ? `@${shortOf(u)}${raw.slice(u.length)}` : all; });

function ago(iso) {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  const y = new Date(); y.setDate(y.getDate() - 1);
  const hm = `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === y.toDateString()) return `Kemarin ${hm}`;
  return `${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][d.getMonth()]} ${hm}`;
}

function notifLine(n) {
  const who = `<b>${esc(nameOf(n.by))}</b>`;
  const quote = n.text ? `: “${mentions(esc(n.text))}”` : "";
  switch (n.type) {
    case "mention": return `${who} menandai kamu di ${n.postBy && n.postBy !== n.by ? "komentar" : "postingan"}${quote}`;
    case "comment": return `${who} mengomentari postinganmu${quote}`;
    case "reply": return `${who} juga mengomentari postingan ${n.postBy ? esc(shortOf(n.postBy)) : ""}${quote}`;
    case "react": return `${who} memberi ${REACT[n.reaction] || "👍"} pada postinganmu${quote}`;
    case "request": return `Request baru dari <b>${esc(n.requester || "user")}</b>${quote}`;
    case "epnew": return `EP baru perlu approval: “${esc(n.text)}”${n.upload ? ` · upload ${esc(n.upload)}` : ""}`;
    case "ep": return n.status === "OKE" ? `${who} meng-OKE EP “${esc(n.text)}”` : `${who} minta revisi EP “${esc(n.text)}”${n.note ? `: ${esc(n.note)}` : ""}`;
    case "update": return `${who} minta kamu update aplikasi laptop ke v${esc(n.version)}`;
    default: return `${who} berinteraksi denganmu`;
  }
}
const notifIcon = (n) => ({ mention: ["@", "#8BBAF2"], comment: ["💬", "#A8E6CF"], reply: ["💬", "#8BBAF2"], react: [REACT[n.reaction] || "👍", "#F3A6C8"], request: ["!", "#F3C77A"], epnew: ["▣", "#C9B6FF"], ep: [n.status === "OKE" ? "✓" : "✎", n.status === "OKE" ? "#8FE3B5" : "#FFB4BB"], update: ["↑", "#C9B6FF"] }[n.type] || ["•", "#8BBAF2"]);

// ---------- Data ----------
async function loadAll() {
  if (!ui.token) return;
  await Promise.all([loadNotif(), loadState()]);
  if (isLead()) loadEp();
  loadPhotos();
}
async function loadNotif() {
  try {
    ui.notif = await api("/api/notif");
    if (navigator.setAppBadge) navigator.setAppBadge(ui.notif.unread).catch(() => {});
  } catch (e) { ui.msg = e.message; }
  render();
}
async function loadState() {
  try {
    ui.state = await api("/api/state");
    const names = Object.fromEntries(team().map((t) => [t.username, t.name]));
    idbPut("names", names);
  } catch (e) { ui.msg = e.message; }
  render();
}
async function loadEp() {
  try { ui.ep = await api("/api/ep"); } catch (e) { ui.epErr = e.message; }
  render();
}
async function loadPhotos() {
  try {
    const cached = JSON.parse(localStorage.getItem("aab_m_photos") || "{}");
    ui.photos = cached;
    const need = team().some((t) => t.photoVer && (!cached[t.username] || cached[t.username].ver !== t.photoVer));
    if (!need) return render();
    const r = await api("/api/photos");
    ui.photos = r.photos;
    try { localStorage.setItem("aab_m_photos", JSON.stringify(r.photos)); } catch { /* penyimpanan penuh: abaikan */ }
    render();
  } catch { /* foto tidak wajib */ }
}

// ---------- Tampilan ----------
const ICON = {
  notif: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>',
  approval: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  akun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
};

function pendingRequests() {
  return ((ui.state && ui.state.requests) || []).filter((r) => r.status !== "done" && r.decision !== "APPROVE" && r.decision !== "REJECT");
}
function pendingEp() {
  return ((ui.ep && ui.ep.items) || []).filter((i) => !i.decision && !i.posted);
}

function renderTabs() {
  const bar = $("tabbar");
  if (!ui.token) { bar.hidden = true; return; }
  bar.hidden = false;
  const unread = (ui.notif && ui.notif.unread) || 0;
  const appr = isLead() ? pendingRequests().length + pendingEp().length : 0;
  const tabs = [["notif", "Notifikasi", unread], ...(isLead() ? [["approval", "Approval", appr]] : []), ["akun", "Akun", 0]];
  bar.innerHTML = tabs.map(([id, label, n]) => `<button class="tab" data-tab="${id}" ${ui.tab === id && !ui.view ? 'aria-current="page"' : ""}>${ICON[id]}${label}${n ? `<b>${n > 99 ? "99+" : n}</b>` : ""}</button>`).join("");
  bar.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { ui.tab = b.dataset.tab; ui.view = null; ui.msg = ""; ui.okMsg = ""; render(); window.scrollTo(0, 0); }));
}

function render() {
  renderTabs();
  const app = $("app");
  if (!ui.token) { app.innerHTML = loginView(); bindLogin(); return; }
  const msg = ui.msg ? `<p class="err" role="alert">${esc(ui.msg)}</p>` : ui.okMsg ? `<p class="ok-msg" role="status">${esc(ui.okMsg)}</p>` : "";
  if (ui.view) { app.innerHTML = msg + detailView(); bindDetail(); return; }
  if (ui.tab === "approval" && isLead()) { app.innerHTML = msg + approvalView(); bindApproval(); return; }
  if (ui.tab === "akun") { app.innerHTML = msg + akunView(); bindAkun(); return; }
  app.innerHTML = msg + notifView(); bindNotif();
}

function loginView() {
  return `<form class="login" id="loginForm" novalidate>
    <img src="icon-192.png" alt="">
    <h2>Creative AAB</h2>
    <p>Notifikasi dan approval tim creative</p>
    ${ui.msg ? `<p class="err" role="alert">${esc(ui.msg)}</p>` : ""}
    <label for="lUser">Username</label><input id="lUser" autocomplete="username" autocapitalize="none" value="${esc(ui.loginUser || "")}" required>
    <label for="lPass">Password</label><input id="lPass" type="password" autocomplete="current-password" required>
    <button class="big-btn" ${ui.busy === "login" ? "disabled" : ""}>${ui.busy === "login" ? "Masuk…" : "Masuk"}</button>
    <p class="hint">Pakai username dan password yang sama dengan aplikasi laptop.</p>
  </form>`;
}
function bindLogin() {
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("lUser").value.trim().toLowerCase(), password = $("lPass").value;
    ui.loginUser = username;
    if (!username || !password) { ui.msg = "Isi username dan password."; return render(); }
    ui.busy = "login"; ui.msg = ""; render();
    try {
      const r = await api("/api/login", { username, password });
      ui.token = r.token; ui.user = r.user;
      localStorage.setItem("aab_m_token", r.token);
      localStorage.setItem("aab_m_user", JSON.stringify(r.user));
      await idbPut("token", r.token);
      ui.busy = ""; ui.tab = "notif";
      render();
      loadAll();
    } catch (err) { ui.busy = ""; ui.msg = err.message; render(); }
  });
}

function notifView() {
  const items = (ui.notif && ui.notif.items) || [];
  const shown = ui.filter === "unread" ? items.filter((n) => !n.read) : items;
  const unread = items.filter((n) => !n.read).length;
  const fresh = shown.filter((n) => Date.now() - Date.parse(n.at) < 86400000);
  const older = shown.filter((n) => Date.now() - Date.parse(n.at) >= 86400000);
  const row = (n) => {
    const [ic, c] = notifIcon(n);
    const av = n.type === "epnew" ? avatar("", "", "EP") : n.type === "request" ? avatar("", "", (n.requester || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2)) : avatar(n.by);
    return `<button class="notif glass${n.read ? "" : " unread"}" data-n="${esc(n.id)}"><span class="ic">${av}<i style="background:${c}">${esc(ic)}</i></span>
      <span class="t">${notifLine(n)}<small>${esc(ago(n.at))}${n.type === "request" || n.type === "epnew" ? " · perlu approval" : ""}</small></span>${n.read ? "" : '<span class="dot" aria-label="belum dibaca"></span>'}</button>`;
  };
  return `<div class="top"><h1>Notifikasi</h1>${unread ? `<button class="back" data-act="readall">Tandai dibaca</button>` : ""}</div>
    <div class="chips" role="group" aria-label="Filter"><button class="chip" data-f="all" aria-pressed="${ui.filter === "all"}">Semua</button><button class="chip" data-f="unread" aria-pressed="${ui.filter === "unread"}">Belum dibaca${unread ? ` · ${unread}` : ""}</button></div>
    ${!ui.notif ? `<p class="empty">Memuat…</p>` : !shown.length ? `<p class="empty">${ui.filter === "unread" ? "Semua sudah dibaca." : "Belum ada notifikasi. Kalau ada yang menandai, mengomentari, atau ada request baru, muncul di sini."}</p>` : `<div class="list">
      ${fresh.length ? `<div class="sec">BARU</div>${fresh.map(row).join("")}` : ""}
      ${older.length ? `<div class="sec">SEBELUMNYA</div>${older.map(row).join("")}` : ""}</div>`}
    ${pushNudge()}`;
}
function pushNudge() {
  if (!("Notification" in window) || Notification.permission === "granted" || localStorage.getItem("aab_m_nudge") === "off") return "";
  return `<div class="spacer"></div><div class="glass install"><b>Nyalakan notifikasi HP</b><span class="hint" style="padding:0">Supaya tag, komentar, dan approval masuk walau aplikasi ditutup.</span><div class="btns"><button class="btn ok" data-act="gopush">Nyalakan</button><button class="btn" data-act="nudgeoff">Nanti</button></div></div>`;
}
function bindNotif() {
  document.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { ui.filter = b.dataset.f; render(); }));
  document.querySelectorAll("[data-n]").forEach((b) => b.addEventListener("click", () => openNotif(b.dataset.n)));
  on("readall", async () => { try { await api("/api/notif/read", {}); ui.notif.items.forEach((n) => { n.read = true; }); ui.notif.unread = 0; if (navigator.setAppBadge) navigator.setAppBadge(0).catch(() => {}); } catch (e) { ui.msg = e.message; } render(); });
  on("gopush", () => { ui.tab = "akun"; render(); });
  on("nudgeoff", () => { localStorage.setItem("aab_m_nudge", "off"); render(); });
}
function on(act, fn) { document.querySelectorAll(`[data-act="${act}"]`).forEach((b) => b.addEventListener("click", fn)); }

async function openNotif(id) {
  const n = ui.notif && ui.notif.items.find((x) => x.id === id);
  if (!n) return;
  if (!n.read) { n.read = true; ui.notif.unread = Math.max(0, ui.notif.unread - 1); api("/api/notif/read", { id }).catch(() => {}); if (navigator.setAppBadge) navigator.setAppBadge(ui.notif.unread).catch(() => {}); }
  ui.msg = ""; ui.okMsg = "";
  if (n.type === "request") { if (isLead()) { ui.tab = "approval"; ui.seg = "req"; ui.focus = n.reqId; ui.view = null; } render(); return; }
  if (n.type === "epnew" && isLead()) { ui.tab = "approval"; ui.seg = "ep"; ui.focusEp = n.epId; ui.view = null; if (!ui.ep) loadEp(); render(); return; }
  if (n.type === "ep" || n.type === "epnew") { ui.view = { type: "ep", epId: n.epId, n }; if (!ui.ep) loadEp(); render(); return; }
  if (n.type === "update") { ui.view = { type: "update", n }; render(); return; }
  if (n.postId) { ui.view = { type: "post", id: n.postId }; render(); loadPost(n.postId); }
}
async function loadPost(id) {
  try {
    const r = await api(`/api/feed/item?id=${encodeURIComponent(id)}`);
    if (ui.view && ui.view.id === id) { ui.view.item = r.item; render(); }
    if (r.item.image) {
      const img = await api(`/api/feed/image?id=${encodeURIComponent(id)}`);
      if (ui.view && ui.view.id === id) { ui.view.img = img.image; render(); }
    }
  } catch (e) { if (ui.view && ui.view.id === id) { ui.view.err = e.message; render(); } }
}

function detailView() {
  const v = ui.view;
  const back = `<div class="top"><button class="back" data-act="back">‹ ${v.type === "ep" && ui.tab === "approval" ? "Approval" : "Notifikasi"}</button></div>`;
  if (v.type === "update") return `${back}<div class="glass card"><p><b>${esc(nameOf(v.n.by))}</b> minta semua update aplikasi laptop ke <b>v${esc(v.n.version)}</b>.</p><p class="hint" style="padding:0">Di laptop: buka Creative AAB → Pengaturan → Cek pembaruan → Pasang dan restart.</p></div>`;
  if (v.type === "ep") {
    const it = ((ui.ep && ui.ep.items) || []).find((x) => x.id === v.epId);
    if (!it) return `${back}${ui.ep ? `<p class="empty">Slide EP ini sudah tidak ada di file EP bulan ini.</p>` : `<p class="empty">Memuat EP…</p>`}`;
    return back + epCard(it, { readOnly: !isLead() });
  }
  const p = v.item;
  if (v.err) return `${back}<p class="empty">${esc(v.err)}</p>`;
  if (!p) return `${back}<p class="empty">Memuat postingan…</p>`;
  const reacts = Object.entries(p.reactions || {}).filter(([, c]) => c).map(([k, c]) => `<span class="r">${REACT[k] || "👍"} ${c}</span>`).join("");
  return `${back}<article class="glass post">
    <div class="h">${avatar(p.by)}<div><b>${esc(nameOf(p.by))}</b><small>${esc((person(p.by) || {}).title || "")}${(person(p.by) || {}).title ? " · " : ""}${esc(ago(p.at))}</small></div></div>
    ${p.kind === "auto" ? `<div class="txt"><b>${esc(shortOf(p.by))}</b> ${esc(p.text)}</div>` : p.text ? `<div class="txt">${mentions(esc(p.text))}</div>` : ""}
    ${p.image ? (v.img ? `<img class="ph" src="${esc(v.img)}" alt="Foto postingan">` : `<div class="ep"><div class="thumb">Memuat foto…</div></div>`) : ""}
    ${reacts || p.comments.length ? `<div class="reacts">${reacts}${p.comments.length ? `<span>${p.comments.length} komentar</span>` : ""}</div>` : ""}
    ${p.comments.map((c) => `<div class="cm">${avatar(c.by, "sm")}<div class="bub"><b>${esc(nameOf(c.by))}</b>${mentions(esc(c.text))}</div></div>`).join("")}
  </article>
  <p class="ro">Membalas dan memberi reaksi lewat aplikasi di laptop.</p>`;
}
function bindDetail() {
  on("back", () => { ui.view = null; render(); window.scrollTo(0, 0); });
  bindEpButtons();
}

// ---------- Approval (Ray) ----------
function approvalView() {
  const reqs = pendingRequests();
  const eps = pendingEp();
  const seg = `<div class="seg" role="group" aria-label="Jenis approval"><button data-seg="req" aria-pressed="${ui.seg === "req"}">Request · ${reqs.length}</button><button data-seg="ep" aria-pressed="${ui.seg === "ep"}">EP · ${eps.length}</button></div>`;
  let body;
  if (ui.seg === "req") {
    body = !ui.state ? `<p class="empty">Memuat…</p>` : !reqs.length ? `<p class="empty">Tidak ada request yang menunggu approval.</p>` : `<div class="list">${reqs.map((r) => {
      const busy = ui.busy === `req:${r.id}`;
      return `<div class="glass card" id="req-${esc(r.id)}">
        <div class="h">${avatar("", "sm", (r.user || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2))}<div><b>${esc(r.user || "Tanpa nama")}</b><small>${esc(r.submitted || "")}${r.output ? ` · ${esc(r.output)}` : ""}</small></div></div>
        <p>${esc(r.info)}</p>
        <div class="meta">${r.deadline ? `<span class="pill hot">Deadline ${esc(r.deadline)}</span>` : ""}<span class="pill">Baris ${r.row}</span>${r.decision === "PENDING" ? `<span class="pill">Ditunda</span>` : ""}</div>
        <div class="btns">${["APPROVE", "PENDING", "REJECT"].map((d) => `<button class="btn${d === "APPROVE" ? " ok" : d === "REJECT" ? " no" : ""}" data-req="${esc(r.id)}" data-row="${r.row}" data-d="${d}" ${busy ? "disabled" : ""}>${{ APPROVE: "Approve", PENDING: "Pending", REJECT: "Reject" }[d]}</button>`).join("")}</div>
      </div>`;
    }).join("")}</div>`;
  } else {
    body = ui.epErr ? `<p class="err">${esc(ui.epErr)}</p>` : !ui.ep ? `<p class="empty">Memuat EP…</p>` : !ui.ep.configured ? `<p class="empty">Link EP belum diisi di aplikasi laptop.</p>` : !eps.length ? `<p class="empty">Semua slide EP sudah diputuskan.</p>` : `<div class="list">${eps.map((it) => epCard(it)).join("")}</div>`;
  }
  return `<div class="top"><h1>Approval</h1></div>${seg}${body}<p class="hint">Keputusan langsung tertulis ke sheet dan EP, sama seperti dari laptop.</p>`;
}
function epCard(it, { readOnly = false } = {}) {
  const th = ui.thumbs[it.id];
  const d = it.decision;
  const busy = ui.busy === `ep:${it.id}`;
  return `<div class="glass ep" id="ep-${esc(it.id)}">
    <div class="thumb" data-thumb="${esc(it.id)}">${th && th.url ? `<img src="${esc(th.url)}" alt="Slide EP ${esc(it.cover || it.format)}">` : th && th.err ? "Gambar slide gagal dimuat" : "Memuat slide…"}</div>
    <div class="b"><h3>${esc(it.cover || it.format || "Tanpa judul")}</h3>
      <div class="meta">${it.format ? `<span class="pill">${esc(it.format)}</span>` : ""}${it.account ? `<span class="pill">${esc(it.account)}</span>` : ""}${it.uploadText ? `<span class="pill">Upload ${esc(it.uploadText)}</span>` : ""}${it.talent ? `<span class="pill">Talent: ${esc(it.talent)}</span>` : ""}
        ${d ? `<span class="pill ${d.status === "OKE" ? "ok" : "no"}">${d.status === "OKE" ? "OKE" : "Revisi"}</span>` : ""}${it.posted ? `<span class="pill ok">POSTED</span>` : ""}</div>
      ${d && d.note ? `<p class="note-show">Catatan: ${esc(d.note)}</p>` : ""}
      ${readOnly ? "" : `<div class="btns"><button class="btn ok" data-ep="${esc(it.id)}" data-s="OKE" ${busy ? "disabled" : ""}>OKE</button><button class="btn no" data-ep="${esc(it.id)}" data-s="REVISI" ${busy ? "disabled" : ""}>Revisi</button></div>`}
    </div></div>`;
}
function loadThumbs() {
  document.querySelectorAll("[data-thumb]").forEach((el) => {
    const id = el.dataset.thumb;
    if (ui.thumbs[id]) return;
    ui.thumbs[id] = { loading: true };
    api(`/api/ep/thumb?id=${encodeURIComponent(id)}`).then((r) => { ui.thumbs[id] = { url: r.url }; }).catch(() => { ui.thumbs[id] = { err: true }; }).finally(render);
  });
}
function bindApproval() {
  document.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => { ui.seg = b.dataset.seg; if (ui.seg === "ep" && !ui.ep) loadEp(); render(); }));
  document.querySelectorAll("[data-req]").forEach((b) => b.addEventListener("click", async () => {
    ui.busy = `req:${b.dataset.req}`; ui.msg = ""; ui.okMsg = ""; render();
    try {
      await api("/api/request/decision", { id: b.dataset.req, row: Number(b.dataset.row), decision: b.dataset.d });
      ui.okMsg = `Request baris ${b.dataset.row}: ${b.dataset.d}.`;
      await loadState();
    } catch (e) { ui.msg = e.message; }
    ui.busy = ""; render();
  }));
  bindEpButtons();
  if (ui.focus) { const el = document.getElementById(`req-${ui.focus}`); if (el) el.scrollIntoView({ block: "center" }); ui.focus = null; }
  if (ui.focusEp && ui.ep) { const el = document.getElementById(`ep-${ui.focusEp}`); if (el) el.scrollIntoView({ block: "start" }); ui.focusEp = null; }
}
function bindEpButtons() {
  loadThumbs();
  document.querySelectorAll("[data-thumb] img").forEach((img) => img.addEventListener("error", () => { ui.thumbs[img.closest("[data-thumb]").dataset.thumb] = { err: true }; render(); }, { once: true }));
  document.querySelectorAll("[data-ep]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.s === "OKE") return decideEp(b.dataset.ep, "OKE", "");
    openSheet(b.dataset.ep);
  }));
}
function openSheet(id) {
  const it = ui.ep.items.find((x) => x.id === id);
  const root = $("sheet-root");
  root.innerHTML = `<div class="sheet-shade" data-act="closeSheet"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><span class="grab"></span>
    <b id="sheetTitle">Catatan revisi: ${esc(it ? it.cover || it.format : "")}</b>
    <textarea id="revNote" maxlength="1000" placeholder="Apa yang perlu diubah?"></textarea>
    <div class="btns"><button class="btn" data-act="closeSheet">Batal</button><button class="btn ok" data-act="sendRev">Kirim revisi</button></div></div>`;
  const ta = $("revNote");
  ta.focus();
  const close = () => { root.innerHTML = ""; };
  root.querySelectorAll('[data-act="closeSheet"]').forEach((x) => x.addEventListener("click", close));
  root.querySelector('[data-act="sendRev"]').addEventListener("click", async () => {
    const note = ta.value.trim();
    if (!note) { ta.focus(); ta.placeholder = "Catatan revisi wajib diisi."; return; }
    close();
    await decideEp(id, "REVISI", note);
  });
}
async function decideEp(id, status, note) {
  ui.busy = `ep:${id}`; ui.msg = ""; ui.okMsg = ""; render();
  try {
    await api("/api/ep/decision", { id, status, note });
    ui.okMsg = status === "OKE" ? "EP di-OKE. Tim dapat notifikasi." : "Revisi terkirim ke tim.";
    await loadEp();
  } catch (e) { ui.msg = e.message; }
  ui.busy = ""; render();
}

// ---------- Akun dan push ----------
function akunView() {
  const u = ui.user || {};
  const p = person(u.username) || {};
  const pushOk = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const push = ui.push;
  let pushBox;
  if (!pushOk) {
    pushBox = isIOS() && !standalone()
      ? `<div class="glass install"><b>Pasang dulu ke layar utama</b><span>Di iPhone, notifikasi hanya jalan setelah aplikasi dipasang:</span><ol><li>Buka halaman ini di Safari.</li><li>Ketuk tombol Share (kotak dengan panah ke atas).</li><li>Pilih <b>Add to Home Screen</b>, lalu buka Creative AAB dari layar utama.</li></ol></div>`
      : `<p class="hint">Browser ini tidak mendukung notifikasi push. Pakai Chrome (Android) atau Safari (iPhone, iOS 16.4 ke atas).</p>`;
  } else if (perm === "denied") {
    pushBox = `<p class="err">Notifikasi diblokir untuk aplikasi ini. Buka pengaturan HP → Notifikasi → Creative AAB (atau pengaturan situs di Chrome), izinkan, lalu buka lagi halaman ini.</p>`;
  } else if (!push || !push.subscribed) {
    pushBox = `<button class="big-btn" data-act="enablePush" ${ui.busy === "push" ? "disabled" : ""}>${ui.busy === "push" ? "Menyalakan…" : "Nyalakan notifikasi di HP ini"}</button>`;
  } else {
    pushBox = PUSH_LABELS.filter(([k]) => !["request", "epnew"].includes(k) || isLead()).map(([k, l, h]) => `<div class="glass row"><span>${esc(l)}${h ? `<small>${esc(h)}</small>` : ""}</span><button class="sw" role="switch" aria-checked="${!!push.prefs[k]}" aria-label="${esc(l)}" data-pref="${k}"></button></div>`).join("")
      + `<button class="btn" data-act="testPush" style="width:100%">Kirim notifikasi uji</button><button class="btn" data-act="disablePush" style="width:100%">Matikan notifikasi di HP ini</button>`;
  }
  const install = !standalone() && !isIOS() ? `<div class="glass install"><b>Pasang ke layar utama</b><span>Di Chrome: ketuk menu ⋮ → <b>Tambahkan ke layar utama</b> (atau <b>Instal aplikasi</b>).</span></div>` : "";
  return `<div class="top"><h1>Akun</h1></div>
    <div class="glass row" style="justify-content:flex-start">${avatar(u.username, "lg")}<span><b>${esc(u.name || "")}</b><small>${esc(p.title || (isLead() ? "Creative Lead" : "Tim creative"))} · @${esc(u.username || "")}</small></span></div>
    <div class="sec">NOTIFIKASI DI HP INI</div>
    <div class="list" style="margin-top:8px">${pushBox}</div>
    ${install ? `<div class="spacer"></div>${install}` : ""}
    <div class="spacer"></div>
    <button class="glass logout" data-act="logout">Keluar</button>
    <p class="hint" style="text-align:center">Input KPI dan posting tetap lewat aplikasi laptop.</p>`;
}
async function swReg() {
  return navigator.serviceWorker.register("sw.js", { scope: "./" });
}
async function loadPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !ui.token) return;
  try {
    const reg = await swReg();
    const sub = await reg.pushManager.getSubscription();
    ui.push = await api(`/api/push${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ""}`);
    if (sub && !ui.push.subscribed) {
      // Langganan lama di HP tapi server belum tahu (misal setelah login ulang): daftarkan lagi.
      await api("/api/push/subscribe", { subscription: sub.toJSON(), prefs: ui.push.prefs, device: navigator.userAgent.slice(0, 80) });
      ui.push.subscribed = true;
    }
  } catch { ui.push = ui.push || null; }
  if (ui.tab === "akun") render();
}
function bindAkun() {
  if (!ui.push && !ui.pushLoading) { ui.pushLoading = true; loadPush().finally(() => { ui.pushLoading = false; }); }
  on("logout", () => logout());
  on("enablePush", async () => {
    ui.busy = "push"; ui.msg = ""; render();
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Izin notifikasi tidak diberikan.");
      const reg = await swReg();
      await navigator.serviceWorker.ready;
      const info = await api("/api/push");
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(info.key) }));
      const r = await api("/api/push/subscribe", { subscription: sub.toJSON(), prefs: info.prefs, device: navigator.userAgent.slice(0, 80) });
      ui.push = { subscribed: true, prefs: r.prefs, key: info.key };
      ui.okMsg = "Notifikasi HP menyala.";
    } catch (e) { ui.msg = e.message; }
    ui.busy = ""; render();
  });
  document.querySelectorAll("[data-pref]").forEach((b) => b.addEventListener("click", async () => {
    const k = b.dataset.pref;
    const prefs = { ...ui.push.prefs, [k]: !ui.push.prefs[k] };
    ui.push.prefs = prefs; render();
    try {
      const reg = await swReg();
      const sub = await reg.pushManager.getSubscription();
      if (sub) await api("/api/push/subscribe", { subscription: sub.toJSON(), prefs, device: navigator.userAgent.slice(0, 80) });
    } catch (e) { ui.msg = e.message; render(); }
  }));
  on("testPush", async () => {
    try { const reg = await swReg(); await reg.showNotification("Creative AAB", { body: "Notifikasi di HP ini sudah jalan.", icon: "icon-192.png", badge: "badge.png", tag: "aab-test" }); }
    catch (e) { ui.msg = e.message; render(); }
  });
  on("disablePush", async () => {
    try {
      const reg = await swReg();
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api("/api/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      ui.push = { ...(ui.push || {}), subscribed: false };
      ui.okMsg = "Notifikasi HP dimatikan.";
    } catch (e) { ui.msg = e.message; }
    render();
  });
}
function b64uToBytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function logout() {
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("./") : null;
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub && ui.token) { await fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ui.token}` }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  } catch { /* tetap keluar */ }
  ["aab_m_token", "aab_m_user", "aab_m_photos"].forEach((k) => localStorage.removeItem(k));
  await idbDel("token");
  Object.assign(ui, { token: "", user: null, notif: null, state: null, ep: null, push: null, view: null, tab: "notif", msg: "", okMsg: "", photos: {} });
  if (navigator.setAppBadge) navigator.setAppBadge(0).catch(() => {});
  render();
}

// ---------- Mulai ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.open) loadNotif().then(() => openNotif(e.data.open)); });
}
window.addEventListener("hashchange", () => openFromHash());
function openFromHash() {
  const m = location.hash.match(/n=([^&]+)/);
  if (!m) return;
  history.replaceState(null, "", location.pathname);
  const id = decodeURIComponent(m[1]);
  loadNotif().then(() => openNotif(id));
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ui.token) loadAll(); });
setInterval(() => { if (document.visibilityState === "visible" && ui.token) { loadNotif(); if (isLead() && ui.tab === "approval") loadState(); } }, POLL_MS);

render();
window.__aabReady = true;
if (ui.token) { idbPut("token", ui.token); loadAll().then(() => { loadPush(); openFromHash(); }); }
