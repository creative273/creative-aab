// Creative AAB: tampilan widget
"use strict";

const MEMBERS = [
  { id: "fitria", name: "Fitria Azzahra Kurnia", short: "Zahra", block: "CONTENT", task: "Upload file bulk ABT" },
  { id: "athallah", name: "Athallah Aqil Sukendar", short: "Aqil", block: "DESIGN", task: "SS desain dan judul" },
  { id: "albar", name: "Muhammad Albar", short: "Albar", block: "VIDEO", task: "Link video, SS otomatis" },
  { id: "rifqi", name: "Rifqi Firega", short: "Rifqi", block: "AIGC", task: "Jumlah produksi dan upload" },
  { id: "ray", name: "Ray Sangkhylang", short: "Ray", block: "LEAD", task: "Approve request dan pantau KPI tim" },
];
const PILLARS = ["Education", "Entertainment", "Functional"];
const ACCOUNTS = ["AAB", "NUSANTARA", "COLLABORATION"];
const KATEGORI = ["Reels/VT", "Carousel", "Feed"];
// Cek server tiap 5 menit. Server sendiri mengecek sheet tiap 10 menit, jadi lebih sering tidak ada gunanya.
const POLL_MS = 5 * 60 * 1000;
const FOCUS_MIN_MS = 60 * 1000;

const ui = {
  settings: null,
  data: null,
  loading: false,
  error: "",
  tab: "request",
  view: "list", // list | detail | settings
  openId: null,
  showAll: false,
  form: {},
};

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const member = () => MEMBERS.find((m) => m.id === (ui.settings.user && ui.settings.user.member)) || null;
const configured = () => !!(ui.settings.serverUrl && ui.settings.token && ui.settings.user);
const isLead = () => !!(ui.settings.user && ui.settings.user.block === "lead");
const canCal = () => !!(ui.settings.user && ["lead", "content"].includes(ui.settings.user.block));
// Tim hanya melihat request yang sudah di-approve Ray (kolom G = APPROVE). Ray melihat semua.
const visibleRequests = () => {
  const all = (ui.data && ui.data.requests) || [];
  return isLead() ? all : all.filter((r) => r.approved);
};

// ---------- Tanggal ----------
const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// Format yang sudah dipakai di sheet: blok DESIGN/VIDEO/AIGC = D/M/YYYY, blok CONTENT = M/D/YYYY.
const isoToDMY = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d}/${m}/${y}`; };
const isoToMDY = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${m}/${d}/${y}`; };

// ---------- Server ----------
async function api(path, body) {
  const base = ui.settings.serverUrl.replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${ui.settings.token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Tidak bisa menghubungi server. Cek internet atau alamat server di Pengaturan.");
  }
  const data = await res.json().catch(() => null);
  if (!data) {
    // Halaman error Cloudflare (bukan JSON): kuota harian habis (429) atau worker kelebihan beban (5xx).
    if (res.status === 429) throw limitError();
    if (res.status >= 500) throw new Error("Server sedang kelebihan beban. Coba lagi beberapa menit lagi. Sementara bisa input langsung di sheet.");
    throw new Error(`Server membalas HTTP ${res.status}.`);
  }
  if (/limit exceeded|exceeded.*limit/i.test(data.error || "")) throw limitError();
  if (res.status === 401 && path !== "/api/login" && ui.settings.token) {
    await logout("Sesi habis atau akun diubah Ray. Login lagi.");
    throw new Error("Sesi habis. Login lagi.");
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Server membalas HTTP ${res.status}.`);
  return data;
}

// Batas gratis Cloudflare reset jam 00.00 UTC (07.00 WIB). Sampai saat itu widget berhenti mengirim request.
function limitError() {
  const now = new Date();
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  ui.limitedUntil = reset;
  return new Error("Server mencapai batas gratis harian Cloudflare. Normal lagi jam 07.00 WIB. Sementara input langsung di sheet.");
}

async function logout(msg) {
  ui.settings = await window.aab.saveSettings({ token: "", user: null });
  ui.data = null; ui.dash = null; ui.ep = null; ui.cal = null; ui.gcfg = null; ui.gErr = ""; ui.tab = "request"; ui.view = "list"; ui.filter = null;
  ui.form = msg ? { msg, msgType: "info" } : {};
  render();
}

async function loadState({ refresh = false } = {}) {
  if (!configured()) { render(); return; }
  if (ui.limitedUntil && Date.now() < ui.limitedUntil) { render(); return; }
  ui.lastLoad = Date.now();
  ui.loading = true;
  ui.error = "";
  renderFooter();
  try {
    const data = refresh ? await api("/api/refresh", {}) : await api("/api/state");
    ui.data = data;
    if (isLead() && (ui.tab === "input" || (ui.tab === "home" && isFull()))) ui.dash = await api("/api/dashboard");
    await applyGoogle(data);
    await syncPhotos();
    await checkNewRequests(data.requests || []);
    // Timeline terbuka dan ada kabar baru: muat ulang diam-diam.
    const fa = (ui.feeds || {}).all;
    if (currentPage() === "feed" && fa && !fa.loading && data.feedLatest && (!fa.items[0] || data.feedLatest > fa.items[0].at)) loadFeed();
  } catch (e) {
    ui.error = e.message;
  } finally {
    ui.loading = false;
    render();
  }
}

// Ray dikabari request baru yang perlu di-approve. Tim dikabari request yang baru di-approve.
async function checkNewRequests(requests, { silent = false } = {}) {
  const lead = isLead();
  const pool = requests.filter((r) => r.status !== "done" && (lead ? !r.decision : r.approved));
  const key = (r) => (lead ? `L:${r.id}` : r.id);
  const who = (ui.settings.user && ui.settings.user.username) || "";
  const sameUser = ui.settings.seenUser === who;
  const seen = new Set(sameUser ? ui.settings.seen || [] : []);
  const fresh = pool.filter((r) => !seen.has(key(r)));
  if (!silent && sameUser && ui.settings.seenInit && fresh.length) {
    const last = fresh[fresh.length - 1];
    const label = lead ? "perlu keputusan" : "baru";
    window.aab.showPopup(
      fresh.length === 1
        ? { id: last.id, title: lead ? `Request dari ${last.user || "tim lain"} perlu keputusan` : `Request baru dari ${last.user || "tim lain"}`, body: `${last.info}${last.deadline ? `, deadline ${last.deadline}` : ""}` }
        : { id: last.id, title: `${fresh.length} request ${label}`, body: fresh.map((r) => r.user || "?").join(", ") }
    );
  }
  const all = [...seen, ...pool.map(key)];
  ui.settings = await window.aab.saveSettings({ seen: [...new Set(all)].slice(-800), seenInit: true, seenUser: who });
}

// ---------- Render ----------
function render() {
  applyTheme();
  if (!isFull() && ["home", "ig", "feed", "team", "profile"].includes(ui.tab)) ui.tab = "request";
  renderBar();
  renderSide();
  renderPageHead();
  const view = $("view");
  const card = (html) => (isFull() ? `<div class="page-card">${html}</div>` : html);
  if (!configured()) {
    view.innerHTML = loginView();
    bindLogin();
  } else if (ui.view === "accounts" && isLead()) {
    view.innerHTML = card(accountsView());
    bindAccounts();
  } else if (ui.view === "settings") {
    view.innerHTML = settingsView();
    bindSettings();
  } else if (ui.tab === "home") {
    view.innerHTML = homeView();
    bindHome();
  } else if (ui.tab === "feed" && isFull()) {
    view.innerHTML = (ui.feedErr ? `<p class="msg err">${esc(ui.feedErr)}</p>` : "") + feedView();
    bindFeed();
  } else if (ui.tab === "team" && isFull()) {
    view.innerHTML = teamView();
    bindTeam();
  } else if (ui.tab === "profile" && isFull()) {
    view.innerHTML = (ui.feedErr ? `<p class="msg err">${esc(ui.feedErr)}</p>` : "") + profileView();
    bindProfile();
  } else if (ui.tab === "ig" && isFull()) {
    view.innerHTML = igView();
    bindIg();
  } else if (ui.tab === "ep" && isFull()) {
    // Jendela penuh: daftar di kiri, detail (screenshot slide) di kanan.
    const open = ui.view === "detail" && ui.ep && ui.ep.items && ui.ep.items.some((x) => x.id === ui.epOpen);
    view.innerHTML = `<div class="split"><section class="glass">${epListView()}</section><section class="glass">${open ? epDetailView() : `<div class="split-empty">Pilih konten di kiri untuk melihat slide dan memberi keputusan.</div>`}</section></div>`;
    bindEpList();
    if (open) bindEpDetail();
  } else if (ui.tab === "ep") {
    view.innerHTML = ui.view === "detail" ? epDetailView() : epListView();
    ui.view === "detail" ? bindEpDetail() : bindEpList();
  } else if (ui.tab === "cal" && canCal()) {
    view.innerHTML = card(ui.view === "detail" ? calFormView() : calListView());
    ui.view === "detail" ? bindCalForm() : bindCalList();
  } else if (ui.tab === "request") {
    view.innerHTML = card(ui.view === "detail" ? detailView() : requestListView());
    ui.view === "detail" ? bindDetail() : bindRequestList();
  } else {
    view.innerHTML = card(inputView());
    bindInput();
  }
  renderFooter();
  applyCss();
}

// CSP aplikasi tidak mengizinkan atribut style di HTML. Gaya dinamis (tinggi grafik, warna) dipasang lewat CSSOM.
function applyCss(root = document) {
  root.querySelectorAll("[data-css]").forEach((el) => { el.style.cssText = el.dataset.css; el.removeAttribute("data-css"); });
}

function renderBar() {
  const full = isFull() && configured();
  $("btnMode").hidden = !configured() || full;
  $("btnMax").hidden = !full;
  $("btnPin").hidden = full;
  $("btnSettings").hidden = full;
  const reqs = visibleRequests();
  const open = reqs.filter((r) => r.status !== "done").length;
  $("reqCount").textContent = ui.data ? `(${open})` : "";
  $("tabRequest").setAttribute("aria-selected", String(ui.tab === "request" && ui.view !== "settings"));
  $("tabInput").setAttribute("aria-selected", String(ui.tab === "input" && ui.view !== "settings"));
  $("tabInput").textContent = isLead() ? "Dashboard" : "Input KPI";
  $("tabEp").setAttribute("aria-selected", String(ui.tab === "ep" && ui.view !== "settings"));
  $("tabCal").setAttribute("aria-selected", String(ui.tab === "cal" && ui.view !== "settings"));
  $("tabCal").hidden = !canCal();
  const epItems = (ui.ep && ui.ep.items) || [];
  const epOpen = isLead() ? epItems.filter((i) => !i.posted && !i.decision).length : epItems.filter((i) => !i.posted && i.decision && i.decision.status === "REVISI").length;
  $("epCount").textContent = ui.ep && ui.ep.configured && epOpen ? `(${epOpen})` : "";
  document.querySelector(".tabs").hidden = !configured();
  // Tombol muat ulang hanya untuk Ray. Tim mendapat data baru otomatis tiap 5 menit.
  $("btnRefresh").hidden = !isLead();
  $("btnPin").classList.toggle("on", !!ui.settings.pinned);
  $("btnPin").setAttribute("aria-pressed", String(!!ui.settings.pinned));
  const c = (ui.data && ui.data.counts) || {};
  const m = member();
  let sub = "";
  if (ui.data && ui.data.configured && m) {
    if (m.id === "fitria") sub = `${c.content ?? 0} konten`;
    if (m.id === "athallah") sub = `${c.design ?? 0} desain`;
    if (m.id === "albar") sub = `${c.video ?? 0} video`;
    if (m.id === "rifqi") sub = c.aigcProduksi == null ? "Blok AIGC belum ada" : `${c.aigcProduksi} produksi, ${c.aigcUpload} upload`;
    if (m.id === "ray") sub = `${reqs.filter((r) => !r.decision && r.status !== "done").length} request baru`;
  }
  if (ui.update && ui.update.state === "ready") sub = `Versi ${ui.update.version} siap dipasang`;
  $("barSub").textContent = sub;
  $("barSub").title = sub;
}

function renderFooter() {
  const f = $("footer");
  if (!configured()) { f.textContent = ""; return; }
  if (ui.loading) { f.textContent = "Memuat data…"; return; }
  if (ui.data && ui.data.fetchedAt) {
    const t = new Date(ui.data.fetchedAt);
    f.textContent = `Sheet terakhir dicek ${pad(t.getHours())}.${pad(t.getMinutes())}. Server cek tiap 10 menit${isLead() ? "" : ", widget ikut tiap 5 menit"}.`;
  } else f.textContent = "";
}

const statusPill = (r) =>
  r.status === "done"
    ? '<span class="pill done">Selesai</span>'
    : r.decision === "REJECT"
    ? '<span class="pill rej">Reject</span>'
    : r.decision === "PENDING"
    ? '<span class="pill hold">Pending</span>'
    : !r.approved
    ? '<span class="pill wait">Belum diputuskan</span>'
    : r.status === "pending"
    ? '<span class="pill pending">Pending</span>'
    : '<span class="pill new">Baru</span>';

function stateBlock() {
  if (ui.error) {
    const limited = ui.limitedUntil && Date.now() < ui.limitedUntil;
    return `<div class="pad"><p class="msg err" role="alert">${esc(ui.error)}</p>${limited ? "" : `<button class="btn secondary" data-act="retry">Coba lagi</button>`}</div>`;
  }
  if (!ui.data) return `<p class="empty">Memuat data…</p>`;
  if (!ui.data.configured)
    return `<div class="empty"><p>Link sheet bulan ini belum diisi.</p><button class="btn" data-act="settings">Buka Pengaturan</button></div>`;
  return "";
}

function requestListView() {
  const blocked = stateBlock();
  if (blocked) return blocked;
  const reqs = [...visibleRequests()].reverse();
  const notDone = reqs.filter((r) => r.status !== "done");
  const groups = isLead()
    ? {
        baru: ["Baru", notDone.filter((r) => !r.decision)],
        pending: ["Pending", notDone.filter((r) => r.decision === "PENDING")],
        reject: ["Reject", notDone.filter((r) => r.decision === "REJECT")],
        open: ["Dikerjakan", notDone.filter((r) => r.approved)],
        all: ["Semua", reqs],
      }
    : { open: ["Belum selesai", notDone], all: ["Semua", reqs] };
  let filter = ui.filter && groups[ui.filter] ? ui.filter : isLead() && groups.baru[1].length ? "baru" : "open";
  const list = groups[filter][1];
  const items = list
    .map(
      (r) => `<li><button class="req" data-id="${esc(r.id)}">
        <p class="req-info">${esc(r.info)}</p>
        <span class="req-meta"><span>${esc(r.user || "Tanpa nama")}${r.deadline ? `, deadline ${esc(r.deadline)}` : ""}</span>${statusPill(r)}</span>
      </button></li>`
    )
    .join("");
  const empty = { baru: "Tidak ada request baru yang perlu keputusan.", pending: "Tidak ada request yang di-pending.", reject: "Tidak ada request yang di-reject.", open: "Tidak ada request yang sedang dikerjakan.", all: "Belum ada request di sheet bulan ini." }[filter];
  return `<div class="filter" role="group" aria-label="Saring request">
      ${Object.entries(groups).map(([k, [label, arr]]) => `<button data-filter="${k}" aria-pressed="${filter === k}">${label} (${arr.length})</button>`).join("")}
    </div>
    ${list.length ? `<ul class="req-list">${items}</ul>` : `<p class="empty">${empty}</p>`}`;
}

function bindRequestList() {
  bindCommon();
  document.querySelectorAll(".req").forEach((b) => b.addEventListener("click", () => { ui.openId = b.dataset.id; ui.view = "detail"; ui.form = {}; render(); }));
  document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { ui.filter = b.dataset.filter; render(); }));
}

function detailView() {
  const r = visibleRequests().find((x) => x.id === ui.openId);
  if (!r) return `<div class="pad"><button class="back" data-act="back">← Kembali</button><p class="msg info">Request ini sudah berubah, belum di-approve, atau tidak ada lagi di sheet.</p></div>`;
  const out = r.output ? (/^https?:\/\//.test(r.output) ? `<a href="${esc(r.output)}" target="_blank" rel="noopener">${esc(r.output)}</a>` : esc(r.output)) : "Belum ada";
  const f = ui.form;
  let action = "";
  const decisionBox =
    isLead() && r.status !== "done"
      ? `<div class="section">
        <h2>Keputusan Ray</h2>
        <p class="hint">Hanya Approve yang membuat request muncul di widget tim. Pending dan Reject tetap bisa diubah kapan saja.</p>
        <div class="seg decide" role="group" aria-label="Keputusan">
          ${["APPROVE", "PENDING", "REJECT"].map((d) => `<button data-decide="${d}" aria-pressed="${r.decision === d}">${d === "APPROVE" ? "Approve" : d === "PENDING" ? "Pending" : "Reject"}</button>`).join("")}
        </div>
        ${f.decide ? `<p class="msg info">Kolom G (Remark Creative) diubah jadi ${esc(f.decide)}${f.decide === "APPROVE" ? " dan request muncul di widget tim" : r.approved ? " dan request hilang dari widget tim" : ""}. Lanjut?</p>
          <div class="row2"><button class="btn secondary" data-act="cancelDecide">Batal</button><button class="btn" data-act="doDecide" ${f.busy ? "disabled" : ""}>${f.busy ? "Menyimpan…" : "Ya, simpan"}</button></div>` : ""}
      </div>`
      : "";
  if (r.status !== "done" && !r.approved) {
    action = "";
  } else if (r.status !== "done") {
    action = `<div class="section">
        <h2>Selesaikan request</h2>
        <label for="outLink">Link output (Canva, Drive, dll)</label>
        <input type="url" id="outLink" placeholder="https://" value="${esc(f.outLink || "")}">
        ${f.confirm ? `<p class="msg info">Link masuk ke kolom Output dan PROGRESS di sheet diubah jadi DONE. Lanjut?</p>
          <div class="row2"><button class="btn secondary" data-act="cancelDone">Batal</button><button class="btn" data-act="doDone" ${f.busy ? "disabled" : ""}>${f.busy ? "Menyimpan…" : "Ya, tandai selesai"}</button></div>`
        : `<button class="btn" data-act="askDone">Tandai selesai</button>`}
      </div>`;
  }
  return `<div class="pad">
    <button class="back" data-act="back">← Kembali</button>
    <p class="detail-info">${esc(r.info)}</p>
    <dl class="facts">
      <dt>Dari</dt><dd>${esc(r.user || "-")}</dd>
      <dt>Tanggal</dt><dd>${esc(r.submitted || "-")}</dd>
      <dt>Deadline</dt><dd>${esc(r.deadline || "-")}</dd>
      <dt>Status</dt><dd>${statusPill(r)}</dd>
      <dt>Output</dt><dd>${out}</dd>
      <dt>Remark</dt><dd>${esc(r.remark || "-")}</dd>
    </dl>
    ${decisionBox}
    ${action}
    ${f.msg ? `<p class="msg ${f.msgType}" role="status">${esc(f.msg)}</p>` : ""}
  </div>`;
}

function bindDetail() {
  bindCommon();
  const r = visibleRequests().find((x) => x.id === ui.openId);
  const link = $("outLink");
  if (link) link.addEventListener("input", () => { ui.form.outLink = link.value; });
  on("askDone", () => {
    if (!/^https?:\/\//i.test((ui.form.outLink || "").trim())) { setMsg("Isi link output yang diawali https:// dulu.", "err"); return; }
    ui.form.confirm = true; ui.form.msg = ""; render();
  });
  on("cancelDone", () => { ui.form.confirm = false; render(); });
  on("doDone", async () => {
    ui.form.busy = true; render();
    try {
      await api("/api/request/done", { row: r.row, id: r.id, link: ui.form.outLink.trim() });
      ui.form = { msg: "Tersimpan. Link masuk ke kolom Output dan PROGRESS sudah DONE.", msgType: "ok" };
      await loadState();
    } catch (e) {
      ui.form.busy = false; ui.form.confirm = false; setMsg(e.message, "err");
    }
  });
  document.querySelectorAll("[data-decide]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.decide === r.decision) return;
      ui.form.decide = b.dataset.decide; ui.form.msg = ""; render();
    })
  );
  on("cancelDecide", () => { ui.form.decide = null; render(); });
  on("doDecide", async () => {
    const decision = ui.form.decide;
    ui.form.busy = true; render();
    try {
      await api("/api/request/decision", { row: r.row, id: r.id, decision });
      ui.form = { msg: decision === "APPROVE" ? "Request di-approve. Sekarang muncul di widget tim." : `Keputusan disimpan: ${decision}. Request tidak muncul di widget tim.`, msgType: "ok" };
      await loadState();
    } catch (e) {
      ui.form.busy = false; ui.form.decide = null; setMsg(e.message, "err");
    }
  });
}

// ---------- Input KPI ----------
function inputView() {
  const blocked = stateBlock();
  if (blocked) return blocked;
  const m = member();
  if (!m) return `<p class="empty">Akun ini belum terhubung ke anggota tim. Minta Ray mengatur akunmu.</p>`;
  const head = m.id === "ray" ? "" : `<p class="hint who-line">${esc(m.name)}, blok ${m.block}.</p>`;
  const body = { fitria: contentForm, athallah: () => batchForm("design"), albar: () => batchForm("video"), rifqi: aigcForm, ray: dashboardView }[m.id]();
  const f = ui.form;
  return `<div class="pad">${head}${body}${f.msg ? `<p class="msg ${f.msgType}" role="status">${esc(f.msg)}</p>` : ""}</div>`;
}

function bindInput() {
  bindCommon();
  const m = member();
  if (!m) return;
  ({ fitria: bindContent, athallah: () => bindBatch("design"), albar: () => bindBatch("video"), rifqi: bindAigc, ray: bindDashboard })[m.id]();
}

// Zahra: bulk ABT + manual
function contentForm() {
  const f = ui.form;
  if (f.mode === "manual") {
    return `<h2>Input manual satu konten</h2>
      <label for="cLink">Link postingan Instagram</label><input type="url" id="cLink" value="${esc(f.cLink || "")}" placeholder="https://www.instagram.com/reel/...">
      <div class="row2">
        <div><label for="cDate">Tanggal upload</label><input type="date" id="cDate" value="${esc(f.cDate || todayISO())}"></div>
        <div><label for="cAcc">Account</label><select id="cAcc">${ACCOUNTS.map((a) => `<option ${f.cAcc === a ? "selected" : ""}>${a}</option>`).join("")}</select></div>
      </div>
      <div class="row2">
        <div><label for="cPillar">Content pillar</label><select id="cPillar">${PILLARS.map((a) => `<option ${f.cPillar === a ? "selected" : ""}>${a}</option>`).join("")}</select></div>
        <div><label for="cKat">Kategori</label><select id="cKat">${KATEGORI.map((a) => `<option ${f.cKat === a ? "selected" : ""}>${a}</option>`).join("")}</select></div>
      </div>
      <label for="cKonten">Konten (judul atau caption)</label><input type="text" id="cKonten" value="${esc(f.cKonten || "")}">
      <div class="row4">
        <div><label for="cViews">Views</label><input type="number" min="0" id="cViews" value="${esc(f.cViews ?? "")}"></div>
        <div><label for="cLikes">Likes</label><input type="number" min="0" id="cLikes" value="${esc(f.cLikes ?? "")}"></div>
        <div><label for="cComm">Comment</label><input type="number" min="0" id="cComm" value="${esc(f.cComm ?? "")}"></div>
        <div><label for="cShare">Share+Save</label><input type="number" min="0" id="cShare" value="${esc(f.cShare ?? "")}"></div>
      </div>
      <p class="hint">Kalau link ini sudah ada di sheet, hanya angka views, likes, comment, dan share yang diperbarui.</p>
      <button class="btn" data-act="sendManual" ${f.busy ? "disabled" : ""}>${f.busy ? "Mengirim…" : "Kirim ke sheet"}</button>
      <button class="btn secondary" data-act="modeBulk">Kembali ke upload file ABT</button>`;
  }
  if (f.preview) {
    const rows = f.preview;
    const lama = rows.filter((r) => r.exists);
    const baru = rows.filter((r) => !r.exists);
    const kurang = baru.filter((r) => !r.pillar || !(r.judul || "").trim()).length;
    return `<h2>${esc(f.fileName || "File ABT")}</h2>
      ${lama.length ? `<div class="summary"><div><b>${lama.length}</b>sudah ada, angka diperbarui</div><div><b>${baru.length}</b>konten baru</div></div>` : ""}
      ${baru.length ? `<p class="hint">Untuk tiap konten baru, isi nama konten dan pilih content pillar. Caption ditampilkan sebagai acuan.</p>` : ""}
      ${baru
        .map(
          (r, i) => `<div class="bulk-item">
          ${r.thumb ? `<img class="bulk-thumb" src="${esc(r.thumb)}" alt="" loading="lazy">` : ""}
          <div class="bulk-meta">${esc(r.account)}, ${esc(r.tanggal)}, ${esc(r.kategori)}${r.link ? ` · <a href="${esc(r.link)}" target="_blank" rel="noopener">buka</a>` : ""}</div>
          <div class="bulk-cap">Caption: ${esc(r.caption || "(tanpa caption)")}</div>
          <label for="judul-${i}">Nama konten</label>
          <input type="text" id="judul-${i}" data-judul="${esc(r.code)}" value="${esc(r.judul || "")}" placeholder="Contoh: Kata Terlarang Pas Live">
          <div class="seg" role="group" aria-label="Content pillar">${PILLARS.map((p) => `<button data-code="${esc(r.code)}" data-pillar="${p}" aria-pressed="${r.pillar === p}">${p}</button>`).join("")}</div>
        </div>`
        )
        .join("")}
      <button class="btn" id="sendBulkBtn" data-act="sendBulk" ${kurang || f.busy ? "disabled" : ""}>${f.busy ? "Mengirim…" : bulkLabel(kurang)}</button>
      <button class="btn secondary" data-act="resetBulk">Batal</button>`;
  }
  return `<h2>Konten baru dari Instagram</h2>
    <p class="hint">Angka konten yang sudah ada di sheet diperbarui otomatis tiap 4 jam. Ambil daftar postingan bulan ini yang belum ada di sheet, lalu isi nama konten dan pillar.</p>
    <button class="btn" data-act="fromIg" ${f.parsing ? "disabled" : ""}>${f.parsing ? "Mengambil dari Instagram…" : "Ambil postingan baru"}</button>
    <div class="section"></div>
    <h2>Atau upload file Anak Bangsa Tools</h2>
    ${dropZone("abtFile", f.parsing ? "Membaca file…" : "Tarik file bulk ABT (.xlsx) ke sini", "atau klik untuk pilih file", ".xlsx")}
    <p class="hint">Konten yang sudah ada di sheet hanya diperbarui angkanya. Konten baru ditambahkan setelah kamu isi nama konten dan pilih pillar.</p>
    <p class="hint">Ada konten yang metriknya tidak terbaca ABT? <button class="linklike" data-act="modeManual">Input manual</button></p>`;
}

function bindContent() {
  const f = ui.form;
  on("modeManual", () => { ui.form = { mode: "manual" }; render(); });
  on("modeBulk", () => { ui.form = {}; render(); });
  on("resetBulk", () => { ui.form = {}; render(); });
  on("fromIg", async () => {
    ui.form = { parsing: true }; render();
    try {
      const res = await api("/api/ig/new");
      ui.form = res.items.length
        ? { preview: res.items.map((r) => ({ ...r, exists: false, judul: "", pillar: "" })), fileName: `${res.items.length} postingan baru dari Instagram` }
        : { msg: "Tidak ada postingan baru. Semua postingan bulan ini sudah ada di sheet.", msgType: "ok" };
    } catch (e) { ui.form = { msg: e.message, msgType: "err" }; }
    render();
  });
  bindDrop("abtFile", null, async (file) => {
    ui.form = { parsing: true }; render();
    try {
      const rows = await parseAbt(file);
      const res = await api("/api/kpi/content/preview", { rows });
      ui.form = { preview: res.rows.map((r, i) => ({ ...rows[i], ...r, caption: rows[i].konten, judul: "", pillar: "" })), fileName: file.name };
    } catch (e) {
      ui.form = { msg: e.message, msgType: "err" };
    }
    render();
  });
  document.querySelectorAll("[data-pillar]").forEach((b) =>
    b.addEventListener("click", () => {
      const row = ui.form.preview.find((r) => r.code === b.dataset.code);
      if (row) row.pillar = b.dataset.pillar;
      render();
    })
  );
  document.querySelectorAll("[data-judul]").forEach((el) =>
    el.addEventListener("input", () => {
      const row = ui.form.preview.find((r) => r.code === el.dataset.judul);
      if (row) row.judul = el.value;
      const kurang = ui.form.preview.filter((r) => !r.exists && (!r.pillar || !(r.judul || "").trim())).length;
      const btn = $("sendBulkBtn");
      btn.disabled = !!kurang;
      btn.textContent = bulkLabel(kurang);
    })
  );
  on("sendBulk", async () => {
    ui.form.busy = true; render();
    try {
      const rows = ui.form.preview.map((r) => (r.exists ? r : { ...r, konten: r.judul.trim() }));
      const res = await api("/api/kpi/content/submit", { rows });
      ui.form = { msg: `Tersimpan: ${res.updated} konten diperbarui, ${res.added} konten baru ditambahkan.`, msgType: "ok" };
      await loadState();
    } catch (e) { ui.form.busy = false; setMsg(e.message, "err"); }
  });
  if (f.mode === "manual") {
    const ids = { cLink: "cLink", cDate: "cDate", cAcc: "cAcc", cPillar: "cPillar", cKat: "cKat", cKonten: "cKonten", cViews: "cViews", cLikes: "cLikes", cComm: "cComm", cShare: "cShare" };
    Object.keys(ids).forEach((k) => { const el = $(k); if (el) el.addEventListener("input", () => { ui.form[k] = el.value; }); });
    on("sendManual", async () => {
      const g = (k) => ($(k) ? $(k).value : "");
      if (!g("cLink")) { setMsg("Link postingan wajib diisi.", "err"); return; }
      ui.form = { ...ui.form, cLink: g("cLink"), cDate: g("cDate"), cAcc: g("cAcc"), cPillar: g("cPillar"), cKat: g("cKat"), cKonten: g("cKonten"), cViews: g("cViews"), cLikes: g("cLikes"), cComm: g("cComm"), cShare: g("cShare"), busy: true };
      render();
      try {
        const res = await api("/api/kpi/content/submit", {
          rows: [{ link: g("cLink"), tanggal: isoToMDY(g("cDate")), account: g("cAcc"), pillar: g("cPillar"), kategori: g("cKat"), konten: g("cKonten"), views: g("cViews"), likes: g("cLikes"), comments: g("cComm"), shares: g("cShare") }],
        });
        ui.form = { mode: "manual", msg: res.added ? "Konten baru ditambahkan ke sheet." : "Angka konten diperbarui.", msgType: "ok" };
        await loadState();
      } catch (e) { ui.form.busy = false; setMsg(e.message, "err"); }
    });
  }
}

function bulkLabel(kurang) {
  return kurang ? `Lengkapi nama dan pillar dulu (${kurang} konten lagi)` : "Kirim ke sheet";
}

async function parseAbt(file) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("File harus .xlsx hasil Anak Bangsa Tools.");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets["Data Postingan"] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Sheet 'Data Postingan' tidak ditemukan di file.");
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const header = [];
  for (let c = range.s.c; c <= range.e.c; c++) header.push(String((ws[XLSX.utils.encode_cell({ r: range.s.r, c })] || {}).v || "").trim().toLowerCase());
  const col = (name) => header.findIndex((h) => h === name);
  const need = ["tanggal upload", "account", "konten", "kategori", "link content", "total views", "total likes", "total comment", "total share & save"];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new Error(`Kolom tidak ditemukan di file: ${missing.join(", ")}. Pastikan ini file bulk Instagram dari ABT.`);
  const cell = (r, name) => ws[XLSX.utils.encode_cell({ r, c: range.s.c + col(name) })];
  const val = (r, name) => { const c = cell(r, name); return c ? c.v : ""; };
  const rows = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const lc = cell(r, "link content");
    const linkRaw = lc ? `${lc.f || ""} ${lc.v || ""} ${(lc.l && lc.l.Target) || ""}` : "";
    const m = linkRaw.match(/https?:\/\/[^\s"')]+/);
    if (!m) continue;
    rows.push({
      link: m[0],
      tanggal: abtDate(val(r, "tanggal upload")),
      account: String(val(r, "account") || "").trim(),
      konten: String(val(r, "konten") || "").trim(),
      kategori: String(val(r, "kategori") || "").trim(),
      views: Number(val(r, "total views")) || 0,
      likes: Number(val(r, "total likes")) || 0,
      comments: Number(val(r, "total comment")) || 0,
      shares: Number(val(r, "total share & save")) || 0,
    });
  }
  if (!rows.length) throw new Error("Tidak ada baris konten dengan link di file ini.");
  return rows;
}

// "2026-11-02 17:45" menjadi "11/2/2026" (format kolom Tanggal Upload di sheet)
function abtDate(v) {
  const m = String(v || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : String(v || "");
}

// Athallah (DESIGN) dan Albar (VIDEO): bisa banyak input sekaligus
const BATCH = {
  design: { title: "Input hasil desain", infoPh: "Contoh: Poster webinar TikTok One", dropMany: "Tarik beberapa SS desain sekaligus", endpoint: "/api/kpi/design", block: "DESIGN" },
  video: { title: "Input hasil video", infoPh: "Contoh: reels", dropMany: "Tarik beberapa SS video sekaligus", endpoint: "/api/kpi/video", block: "VIDEO" },
};
let entrySeq = 0;
const newEntry = (img) => ({ key: ++entrySeq, date: todayISO(), info: "", link: "", img: img || null });
function entries() {
  if (!ui.form.items || !ui.form.items.length) ui.form.items = [newEntry()];
  return ui.form.items;
}

function batchForm(kind) {
  const cfg = BATCH[kind];
  const items = entries();
  const f = ui.form;
  let lastDate = null;
  const cards = items
    .map((it, i) => {
      const id = `e${it.key}`;
      const group = f.imported && it.date !== lastDate ? `<p class="date-group">Tanggal ${esc(isoToDMY(it.date))}</p>` : "";
      lastDate = it.date;
      const imgPart = it.img
        ? `<div class="preview"><img src="${esc(it.img.url)}" alt="Pratinjau gambar input ${i + 1}">
            <div class="preview-bar"><span>${esc(it.img.label || "Gambar")}, ${Math.round((it.img.base64.length * 0.75) / 1024)} KB</span>
            <span>${kind === "video" && it.link ? `<button class="linklike" data-retake="${it.key}">Ambil ulang</button> · ` : ""}<button class="linklike" data-clearimg="${it.key}">Hapus gambar</button></span></div></div>`
        : `<button type="button" class="drop small" data-pick="${it.key}" aria-label="Pilih gambar untuk input ${i + 1}"><strong>${kind === "video" ? "Tarik SS manual" : "Tarik SS desain"}</strong><span>atau klik untuk pilih file</span></button>`;
      return `${group}<div class="entry${it.status === "err" ? " entry-err" : ""}" data-entry="${it.key}">
        <div class="entry-head"><b>Input ${i + 1}</b>${items.length > 1 ? `<button class="linklike" data-remove="${it.key}">Hapus input</button>` : ""}</div>
        <div class="entry-date"><label for="${id}-date">Tanggal</label><input type="date" id="${id}-date" data-field="date" data-key="${it.key}" value="${esc(it.date)}"></div>
        <label for="${id}-info">Informasi detil</label><textarea id="${id}-info" class="info-box" rows="2" data-field="info" data-key="${it.key}" placeholder="${esc(cfg.infoPh)}">${esc(it.info)}</textarea>
        ${kind === "video" ? `<label for="${id}-link">Link video</label>
          <div class="row-link"><input type="url" id="${id}-link" data-field="link" data-key="${it.key}" value="${esc(it.link)}" placeholder="https://">
          <button class="btn secondary inline" data-capture="${it.key}" ${it.capturing ? "disabled" : ""}>${it.capturing ? "Mengambil…" : "Ambil SS"}</button></div>` : ""}
        <div class="entry-img">${imgPart}</div>
        ${it.err ? `<p class="msg err">${esc(it.err)}</p>` : ""}
      </div>`;
    })
    .join("");
  const ready = items.length;
  const withImg = items.filter((it) => it.img).length;
  const imp = f.imported;
  return `<h2>${cfg.title}</h2>
    <div class="import-row">
      <button class="btn secondary inline" data-act="importXlsx">Import dari Excel</button>
      <span class="hint">Tanggal dan informasi detil terisi otomatis, gambar ditambahkan per baris.</span>
    </div>
    <input type="file" id="xlsxFile" accept=".xlsx" hidden>
    ${imp ? `<p class="msg info">${esc(imp.file)}: ${imp.total} baris, ${imp.exists} sudah ada di sheet dan dilewati. Gambar terisi ${withImg} dari ${ready} input.</p>` : ""}
    <button type="button" class="drop" id="manyDrop" aria-label="${esc(cfg.dropMany)}"><strong>${esc(cfg.dropMany)}</strong><span>${imp ? "Gambar mengisi baris yang belum punya gambar, urut dari atas." : "Tiap file jadi 1 input. Bisa juga klik untuk pilih beberapa file."}</span></button>
    <input type="file" id="manyFile" accept="image/*" multiple hidden>
    <input type="file" id="oneFile" accept="image/*" hidden>
    ${kind === "video" ? `<p class="hint">SS juga bisa diambil otomatis dari link. Kalau hasilnya halaman login, <button class="linklike" data-act="loginIg">login Instagram di widget</button> sekali, lalu klik Ambil ulang.</p>` : ""}
    <div class="entries">${cards}</div>
    <button class="btn secondary" data-act="addEntry">+ Tambah inputan</button>
    <button class="btn" data-act="sendBatch" ${f.busy ? "disabled" : ""}>${f.busy ? `Mengirim ${f.progress || ""}…` : `Kirim semua (${ready}) ke sheet`}</button>
    ${!f.busy && withImg && withImg < ready ? `<button class="btn secondary" data-act="sendReady">Kirim yang sudah ada gambarnya saja (${withImg})</button>` : ""}`;
}

function bindBatch(kind) {
  const cfg = BATCH[kind];
  const find = (key) => ui.form.items.find((x) => String(x.key) === String(key));
  document.querySelectorAll("[data-field]").forEach((el) =>
    el.addEventListener("input", () => { const it = find(el.dataset.key); if (it) it[el.dataset.field] = el.value; })
  );
  const addImages = async (files) => {
    const imgs = [...files].filter((fl) => fl.type.startsWith("image/"));
    if (!imgs.length) return setMsg("File harus gambar (PNG atau JPG).", "err");
    for (const fl of imgs) {
      try {
        const img = { ...(await compressImage(fl)), label: fl.name };
        const empty = ui.form.items.find((x) => !x.img);
        if (empty) empty.img = img;
        else ui.form.items.push(newEntry(img));
      } catch (e) { setMsg(e.message, "err"); }
    }
    render();
  };
  const many = $("manyDrop");
  const manyFile = $("manyFile");
  const oneFile = $("oneFile");
  many.addEventListener("click", () => manyFile.click());
  manyFile.addEventListener("change", () => addImages(manyFile.files));
  many.addEventListener("dragover", (e) => { e.preventDefault(); many.classList.add("over"); });
  many.addEventListener("dragleave", () => many.classList.remove("over"));
  many.addEventListener("drop", (e) => { e.preventDefault(); many.classList.remove("over"); addImages(e.dataTransfer.files); });
  document.onpaste = (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile());
    if (files.length) addImages(files);
  };
  let pickKey = null;
  oneFile.addEventListener("change", async () => {
    const it = find(pickKey);
    const fl = oneFile.files[0];
    if (!it || !fl) return;
    try { it.img = { ...(await compressImage(fl)), label: fl.name }; } catch (e) { it.err = e.message; }
    render();
  });
  document.querySelectorAll("[data-pick]").forEach((b) => {
    b.addEventListener("click", () => { pickKey = b.dataset.pick; oneFile.value = ""; oneFile.click(); });
    b.addEventListener("dragover", (e) => { e.preventDefault(); b.classList.add("over"); });
    b.addEventListener("dragleave", () => b.classList.remove("over"));
    b.addEventListener("drop", async (e) => {
      e.preventDefault();
      const it = find(b.dataset.pick);
      const files = [...e.dataTransfer.files].filter((fl) => fl.type.startsWith("image/"));
      if (!it || !files.length) return;
      it.img = { ...(await compressImage(files[0])), label: files[0].name };
      if (files.length > 1) return addImages(files.slice(1));
      render();
    });
  });
  document.querySelectorAll("[data-clearimg]").forEach((b) => b.addEventListener("click", () => { find(b.dataset.clearimg).img = null; render(); }));
  document.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", () => { ui.form.items = ui.form.items.filter((x) => String(x.key) !== b.dataset.remove); render(); })
  );
  on("addEntry", () => { ui.form.items.push(newEntry()); ui.form.msg = ""; render(); });
  on("loginIg", () => window.aab.captureLogin("instagram"));

  const xlsx = $("xlsxFile");
  on("importXlsx", () => { xlsx.value = ""; xlsx.click(); });
  xlsx.addEventListener("change", async () => {
    const file = xlsx.files[0];
    if (!file) return;
    try {
      const rows = parseDetailExcel(await file.arrayBuffer(), kind);
      const res = await api(`/api/kpi/${kind}/preview`, { rows: rows.map((r) => ({ tanggal: isoToDMY(r.date), info: r.info })) });
      const fresh = rows.filter((_, i) => !res.rows[i].exists);
      const keep = (ui.form.items || []).filter((it) => it.info || it.img);
      const k = (d, i) => `${d}|${String(i).trim().toLowerCase()}`;
      const kept = new Set(keep.map((it) => k(it.date, it.info)));
      const add = fresh.filter((r) => !kept.has(k(r.date, r.info)));
      ui.form = {
        items: [...keep, ...add.map((r) => ({ ...newEntry(), date: r.date, info: r.info, link: r.link || "" }))],
        imported: { file: file.name, total: rows.length, exists: rows.length - fresh.length, added: fresh.length },
      };
      if (!ui.form.items.length) ui.form.items = [newEntry()];
      if (!fresh.length) { ui.form.msg = "Semua baris di Excel sudah ada di sheet. Tidak ada yang perlu dikirim."; ui.form.msgType = "info"; }
    } catch (e) {
      setMsg(e.message, "err");
      return;
    }
    render();
  });

  const capture = async (key) => {
    const it = find(key);
    const link = (it.link || "").trim();
    if (!/^https?:\/\//.test(link)) { it.err = "Tempel link video yang diawali https:// dulu."; render(); return; }
    it.capturing = true; it.err = ""; render();
    try {
      const res = await window.aab.captureLink(link);
      it.img = { base64: res.base64, url: `data:image/jpeg;base64,${res.base64}`, label: res.source === "cover" ? "Cover video" : res.source === "halaman" ? "SS halaman" : res.source };
    } catch (e) {
      it.err = `SS otomatis gagal: ${String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")} Tarik SS manual saja.`;
    }
    it.capturing = false; render();
  };
  document.querySelectorAll("[data-capture]").forEach((b) => b.addEventListener("click", () => capture(b.dataset.capture)));
  document.querySelectorAll("[data-retake]").forEach((b) => b.addEventListener("click", () => capture(b.dataset.retake)));
  document.querySelectorAll('[data-field="link"]').forEach((el) =>
    el.addEventListener("paste", () => setTimeout(() => { const it = find(el.dataset.key); it.link = el.value; capture(it.key); }, 50))
  );

  const send = async (onlyReady) => {
    const all = ui.form.items;
    const items = onlyReady ? all.filter((it) => it.img) : all;
    const waiting = onlyReady ? all.filter((it) => !it.img) : [];
    let bad = false;
    items.forEach((it) => {
      it.err = !it.info.trim() ? "Informasi detil wajib diisi." : !it.img ? "Belum ada gambar." : "";
      if (it.err) { it.status = "err"; bad = true; } else it.status = "";
    });
    if (bad) { ui.form.msg = "Lengkapi input yang ditandai merah dulu."; ui.form.msgType = "err"; render(); return; }
    ui.form.busy = true; ui.form.msg = "";
    const done = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      ui.form.progress = `${i + 1}/${items.length}`; render();
      try {
        const res = await api(cfg.endpoint, { tanggal: isoToDMY(it.date || todayISO()), info: it.info.trim(), link: it.link || "", image: it.img.base64 });
        done.push(res.row);
        it.sent = true;
      } catch (e) {
        it.status = "err"; it.err = e.message;
      }
    }
    const left = all.filter((it) => !it.sent);
    const failed = items.filter((it) => !it.sent).length;
    const imported = ui.form.imported;
    const saved = done.length ? `${done.length} input tersimpan di blok ${cfg.block} (baris ${done.join(", ")}).` : "";
    ui.form = {
      imported: left.length ? imported : null,
      items: left.length ? left : [newEntry()],
      msg: failed
        ? `${saved} ${failed} gagal. Cek input yang ditandai merah lalu kirim ulang.`.trim()
        : waiting.length
        ? `${saved} ${waiting.length} baris masih menunggu gambar.`
        : saved,
      msgType: failed ? "err" : "ok",
    };
    await loadState();
  };
  on("sendBatch", () => send(false));
  on("sendReady", () => send(true));
}

// Baca Excel DESIGN/VIDEO milik Aqil atau Albar: cari baris judul yang berisi "Informasi Detil".
function parseDetailExcel(buf, kind) {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const names = [...wb.SheetNames].sort((a, b) => (b.toUpperCase().includes(kind.toUpperCase()) ? 1 : 0) - (a.toUpperCase().includes(kind.toUpperCase()) ? 1 : 0));
  for (const name of names) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    const h = rows.slice(0, 15).findIndex((r) => r.some((c) => String(c).toLowerCase().includes("informasi detil")));
    if (h < 0) continue;
    const head = rows[h].map((c) => String(c).toLowerCase());
    const ci = head.findIndex((c) => c.includes("informasi detil"));
    const ct = head.findIndex((c) => c.includes("tanggal"));
    const cl = head.findIndex((c) => c.includes("link"));
    if (ct < 0) throw new Error(`Kolom Tanggal tidak ditemukan di sheet ${name}.`);
    const out = [];
    for (const r of rows.slice(h + 1)) {
      const info = String(r[ci] ?? "").trim();
      if (!info) continue;
      const date = excelDateToISO(r[ct]);
      if (!date) throw new Error(`Tanggal tidak terbaca untuk "${info.slice(0, 40)}". Pakai format tanggal Excel atau D/M/YYYY.`);
      out.push({ date, info, link: cl >= 0 ? String(r[cl] ?? "").trim() : "" });
    }
    if (!out.length) throw new Error(`Sheet ${name} tidak punya baris berisi informasi detil.`);
    return out;
  }
  throw new Error('Tidak ada sheet dengan kolom "Informasi Detil" di file ini.');
}

function excelDateToISO(v) {
  if (v instanceof Date && !isNaN(v)) {
    // cellDates memberi tengah malam waktu lokal; tambah 12 jam supaya tidak geser hari.
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (typeof v === "number") {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : "";
  }
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return "";
}

// Ray: dashboard tim
const ago = (iso) => {
  if (!iso) return "belum ada";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "baru saja";
  if (min < 60) return `${min} menit lalu`;
  const jam = Math.round(min / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.round(jam / 24)} hari lalu`;
};

function dashboardView() {
  const d = ui.dash;
  if (!d) return `<p class="empty">Memuat dashboard…</p>`;
  const c = d.counts || {};
  const last = d.last || {};
  const acc = (id) => (d.accounts || []).find((a) => a.member === id);
  const tile = (id, label, value) => {
    const m = MEMBERS.find((x) => x.id === id);
    const a = acc(id);
    return `<div class="tile">
      <span class="tile-name">${esc(m.short)} <small>${esc(m.block)}</small></span>
      <b class="tile-num">${value}</b>
      <span class="tile-sub">${esc(label)}</span>
      <span class="tile-foot">${a ? (a.active ? `Input terakhir: ${esc(ago(last[id]))}` : "Akun nonaktif") : "Belum punya akun"}</span>
    </div>`;
  };
  const r = d.requests || {};
  const act = (d.activity || []).slice(0, 12);
  return `<h2>Dashboard tim</h2>
    <p class="hint gap-below">Angka KPI dari baris Summary tab Creative Report Analytic. Input terakhir dihitung dari kiriman lewat widget.</p>
    <div class="tiles">
      ${tile("fitria", "konten", c.content ?? 0)}
      ${tile("athallah", "desain", c.design ?? 0)}
      ${tile("albar", "video", c.video ?? 0)}
      ${tile("rifqi", d.aigcReady ? `produksi, ${c.aigcUpload ?? 0} upload` : "blok AIGC belum ada", d.aigcReady ? c.aigcProduksi ?? 0 : "-")}
    </div>
    <div class="section">
      <h2>Request creative</h2>
      <div class="req-stats">
        <button data-goreq="baru"><b>${r.needDecision ?? 0}</b>perlu keputusan</button>
        <button data-goreq="open"><b>${r.inProgress ?? 0}</b>dikerjakan tim</button>
        <button data-goreq="pending"><b>${r.pending ?? 0}</b>pending</button>
        <button data-goreq="all"><b>${r.done ?? 0}</b>selesai</button>
      </div>
    </div>
    ${d.plan ? `<div class="section">
      <h2>Content plan minggu ini</h2>
      <p class="hint gap-below">${esc(fmtDate(d.plan.start))} sampai ${esc(fmtDate(d.plan.end))}, dari Content Calendar.</p>
      ${Object.keys(d.plan.accounts).length ? `<div class="req-stats plan">${Object.entries(d.plan.accounts).map(([a, p]) => `<button data-gocal="${esc(a)}"><span class="plan-acc">${esc(a)}</span><b>${p.posted}/${p.planned}</b>sudah posting${p.late ? `<span class="plan-late">${p.late} lewat tanggal</span>` : ""}</button>`).join("")}</div>` : `<p class="hint">Belum ada konten di kalender minggu ini.</p>`}
    </div>` : ""}
    ${d.ep ? `<div class="section">
      <h2>Editorial plan</h2>
      <div class="req-stats">
        <button data-goep="wait"><b>${d.ep.waiting}</b>menunggu keputusan</button>
        <button data-goep="rev"><b>${d.ep.revisi}</b>revisi</button>
        <button data-goep="all"><b>${d.ep.posted}</b>posted</button>
        <button data-goep="all"><b>${d.ep.total}</b>total EP</button>
      </div>
    </div>` : ""}
    <div class="section">
      <h2>Aktivitas terbaru</h2>
      ${act.length ? `<ul class="activity">${act.map((x) => `<li><span class="act-who">${esc((MEMBERS.find((m) => m.id === x.member) || {}).short || x.who)}</span><span class="act-text">${esc(x.text)}</span><span class="act-time">${esc(ago(x.at))}</span></li>`).join("")}</ul>` : `<p class="hint">Belum ada kiriman lewat widget sejak update ini.</p>`}
    </div>`;
}

function bindDashboard() {
  document.querySelectorAll("[data-goep]").forEach((b) => b.addEventListener("click", () => { ui.tab = "ep"; ui.view = "list"; ui.epFilter = b.dataset.goep; ui.form = {}; render(); }));
  document.querySelectorAll("[data-gocal]").forEach((b) => b.addEventListener("click", () => { ui.tab = "cal"; ui.view = "list"; ui.calAcc = b.dataset.gocal; ui.calFilter = "week"; ui.form = {}; render(); }));
  document.querySelectorAll("[data-goreq]").forEach((b) =>
    b.addEventListener("click", () => { ui.tab = "request"; ui.view = "list"; ui.filter = b.dataset.goreq; ui.form = {}; render(); })
  );
  if (!ui.dash && !ui.loading) loadState();
}

// Rifqi
function aigcForm() {
  const f = ui.form;
  if (ui.data && !ui.data.aigcReady) {
    return `<p class="msg info">Blok AIGC (kolom AH sampai AK) belum ada di sheet bulan ini. Minta Ray membuatnya, lalu simpan ulang link di Pengaturan.</p>`;
  }
  return `<h2>Input produksi dan upload harian</h2>
    <label for="aDate">Tanggal</label><input type="date" id="aDate" value="${esc(f.aDate || todayISO())}">
    <div class="row2">
      <div><label for="aProd">Jumlah produksi</label><input type="number" min="0" id="aProd" value="${esc(f.aProd ?? "")}"></div>
      <div><label for="aUp">Jumlah upload</label><input type="number" min="0" id="aUp" value="${esc(f.aUp ?? "")}"></div>
    </div>
    <p class="hint">Kalau tanggal yang sama dikirim ulang, angkanya ditimpa, bukan ditambah baris baru.</p>
    <button class="btn" data-act="sendAigc" ${f.busy ? "disabled" : ""}>${f.busy ? "Mengirim…" : "Kirim ke sheet"}</button>`;
}
function bindAigc() {
  keep(["aDate", "aProd", "aUp"]);
  on("sendAigc", async () => {
    const f = ui.form;
    if (f.aProd === undefined || f.aProd === "" || f.aUp === undefined || f.aUp === "") return setMsg("Isi jumlah produksi dan jumlah upload.", "err");
    f.busy = true; render();
    try {
      const res = await api("/api/kpi/aigc", { tanggal: isoToDMY(f.aDate || todayISO()), produksi: f.aProd, upload: f.aUp });
      ui.form = { msg: res.replaced ? `Angka tanggal ini diperbarui (baris ${res.row}).` : `Tersimpan di baris ${res.row} blok AIGC.`, msgType: "ok" };
      await loadState();
    } catch (e) { f.busy = false; setMsg(e.message, "err"); }
  });
}

// ---------- EP dan Content Calendar (Google) ----------
const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const fmtDate = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso || "Tanpa tanggal";
  const d = new Date(`${iso}T00:00:00`);
  return `${HARI[d.getDay()]} ${d.getDate()} ${BLN[d.getMonth()]}`;
};
const weekRange = () => {
  const t = new Date(`${todayISO()}T00:00:00`);
  const dow = (t.getDay() + 6) % 7;
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return [iso(new Date(t.getTime() - dow * 864e5)), iso(new Date(t.getTime() + (6 - dow) * 864e5))];
};
const inWeek = (iso) => { const [a, b] = weekRange(); return iso >= a && iso <= b; };
const words = (s) => new Set(String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 2));
const similar = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach((w) => { if (B.has(w)) n++; }); return n / Math.min(A.size, B.size); };

// EP dan kalender ikut dalam satu jawaban /api/state (atau /api/refresh untuk Ray).
async function applyGoogle(data) {
  const err = (data.ep && data.ep.ok === false && data.ep.error) || (data.cal && data.cal.ok === false && data.cal.error) || "";
  ui.gErr = err;
  ui.ep = data.ep && data.ep.ok !== false ? data.ep : data.ep ? ui.ep : { configured: false, items: [] };
  if (canCal()) ui.cal = data.cal && data.cal.ok !== false ? data.cal : data.cal ? ui.cal : { configured: false, rows: [] };
  if (!err) await checkEpRevisions();
}

// Tim dapat pop-up saat Ray memberi revisi atau OKE di EP.
async function checkEpRevisions() {
  if (isLead() || !ui.ep || !ui.ep.configured) return;
  const seen = new Set(ui.settings.epSeen || []);
  const all = ui.ep.items.filter((i) => i.decision && !i.posted);
  const key = (i) => `${i.id}:${i.decision.seq}`;
  const fresh = all.filter((i) => !seen.has(key(i)));
  if (ui.settings.epSeenInit && fresh.length) {
    const rev = fresh.filter((i) => i.decision.status === "REVISI");
    const last = (rev.length ? rev : fresh)[(rev.length ? rev : fresh).length - 1];
    window.aab.showPopup(
      rev.length
        ? { id: `ep:${last.id}`, title: rev.length === 1 ? `Revisi EP: ${last.cover || last.format}` : `${rev.length} EP perlu revisi`, body: rev.length === 1 ? last.decision.note : rev.map((i) => i.cover).join(", ") }
        : { id: `ep:${last.id}`, title: fresh.length === 1 ? `EP di-OKE: ${last.cover || last.format}` : `${fresh.length} EP di-OKE Ray`, body: "Lanjut produksi." }
    );
  }
  ui.settings = await window.aab.saveSettings({ epSeen: [...new Set([...seen, ...all.map(key)])].slice(-500), epSeenInit: true });
}

const epPill = (i) =>
  i.posted ? '<span class="pill done">POSTED</span>'
  : !i.decision ? '<span class="pill wait">Menunggu</span>'
  : i.decision.status === "REVISI" ? '<span class="pill rej">Revisi</span>'
  : '<span class="pill new">OKE</span>';

function googleBlock(kind) {
  if (ui.gErr) return `<div class="pad"><p class="msg err" role="alert">${esc(ui.gErr)}</p><button class="btn secondary" data-act="gRetry">Coba lagi</button></div>`;
  const d = kind === "ep" ? ui.ep : ui.cal;
  if (!d) return `<p class="empty">Memuat…</p>`;
  if (!d.configured)
    return `<div class="empty"><p>Link ${kind === "ep" ? "EP (Google Slides)" : "Content Calendar (Google Sheets)"} bulan ini belum diisi.</p>${isLead() ? `<button class="btn" data-act="settings">Buka Pengaturan</button>` : "<p>Minta Ray mengisinya di Pengaturan.</p>"}</div>`;
  return "";
}

function accountSeg(list, cur, attr) {
  return `<div class="seg acc-seg" role="group" aria-label="Akun">${list.map((a) => `<button data-${attr}="${esc(a)}" aria-pressed="${a === cur}">${esc(a)}</button>`).join("")}</div>`;
}

function epListView() {
  const blocked = googleBlock("ep");
  if (blocked) return blocked;
  const items = ui.ep.items;
  const accounts = [...new Set(items.map((i) => i.account))];
  const acc = accounts.includes(ui.epAcc) ? ui.epAcc : accounts[0] || "AAB";
  const mine = items.filter((i) => i.account === acc);
  const groups = {
    week: ["Minggu ini", mine.filter((i) => inWeek(i.date))],
    wait: ["Menunggu", mine.filter((i) => !i.posted && !i.decision)],
    rev: ["Revisi", mine.filter((i) => !i.posted && i.decision && i.decision.status === "REVISI")],
    all: ["Semua", mine],
  };
  const filter = groups[ui.epFilter] ? ui.epFilter : "week";
  const list = groups[filter][1];
  return `<div class="list-head">${accountSeg(accounts, acc, "epacc")}
      <a class="linklike" href="https://docs.google.com/presentation/d/${esc(ui.ep.id)}/edit" target="_blank" rel="noopener">Buka Slides</a></div>
    <div class="filter" role="group" aria-label="Saring EP">${Object.entries(groups).map(([k, [l, a]]) => `<button data-epf="${k}" aria-pressed="${filter === k}">${l} (${a.length})</button>`).join("")}</div>
    ${list.length ? `<ul class="req-list">${list.map((i) => `<li><button class="req" data-ep="${esc(i.id)}">
        <p class="req-info">${esc(i.cover || "(cover belum diisi)")}</p>
        <span class="req-meta"><span>${esc(fmtDate(i.date))}${i.format ? `, ${esc(i.format)}` : ""}${i.talent ? `, ${esc(i.talent)}` : ""}</span>${epPill(i)}</span>
      </button></li>`).join("")}</ul>` : `<p class="empty">Tidak ada EP di filter ini.</p>`}`;
}

function bindEpList() {
  bindCommon();
  on("gRetry", () => loadState());
  document.querySelectorAll("[data-epacc]").forEach((b) => b.addEventListener("click", () => { ui.epAcc = b.dataset.epacc; render(); }));
  document.querySelectorAll("[data-epf]").forEach((b) => b.addEventListener("click", () => { ui.epFilter = b.dataset.epf; render(); }));
  document.querySelectorAll("[data-ep]").forEach((b) => b.addEventListener("click", () => { ui.epOpen = b.dataset.ep; ui.view = "detail"; ui.form = {}; render(); }));
}

function calCandidates(item) {
  const rows = ((ui.cal && ui.cal.rows) || []).filter((r) => r.account === item.account && !r.noPosting && r.content);
  return rows
    .map((r) => ({ r, score: (r.date === item.date ? 2 : 0) + similar(r.content, item.cover) - (r.posting ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function epDetailView() {
  const blocked = googleBlock("ep");
  if (blocked) return blocked;
  const i = ui.ep.items.find((x) => x.id === ui.epOpen);
  if (!i) return `<div class="pad"><button class="back" data-act="back">← Kembali</button><p class="msg info">Slide ini tidak ada lagi di EP.</p></div>`;
  const f = ui.form;
  const dec = i.decision;
  let decision = "";
  if (ui.ep.canDecide && !i.posted) {
    decision = `<div class="section"><h2>Keputusan Ray</h2>
      <div class="seg decide" role="group" aria-label="Keputusan EP">
        <button data-epdec="OKE" aria-pressed="${dec && dec.status === "OKE"}">OKE</button>
        <button data-epdec="REVISI" aria-pressed="${(dec && dec.status === "REVISI") || f.epRev ? "true" : "false"}">Revisi</button>
      </div>
      ${f.epRev ? `<label for="epNote">Catatan revisi</label><textarea id="epNote" rows="3" placeholder="Contoh: revisi di kolom VISUAL">${esc(f.epNote ?? (dec && dec.note) ?? "")}</textarea>
        <div class="row2"><button class="btn secondary" data-act="epRevCancel">Batal</button><button class="btn" data-act="epRevSave" ${f.busy ? "disabled" : ""}>${f.busy ? "Menyimpan…" : "Kirim revisi"}</button></div>` : ""}
      ${dec ? `<p class="hint">Terakhir: ${esc(dec.status)} oleh ${esc(dec.by)}, ${esc(ago(dec.at))}. <button class="linklike" data-act="epClear">Hapus status</button></p>` : ""}
    </div>`;
  } else if (dec && !i.posted) {
    decision = `<div class="section"><h2>Keputusan Ray</h2><p class="msg ${dec.status === "REVISI" ? "err" : "ok"}">${dec.status === "REVISI" ? `Perlu revisi. Catatan Ray: ${esc(dec.note)}` : "OKE, lanjut produksi."}</p></div>`;
  }
  let post = "";
  if (ui.ep.canPost && !i.posted) {
    const cands = calCandidates(i);
    const sel = f.epCal !== undefined ? f.epCal : cands.length && cands[0].score >= 2.3 ? cands[0].r.id : "";
    post = `<div class="section"><h2>Tandai POSTED</h2>
      <p class="hint">Stempel POSTED ditempel di slide. Kalau baris kalender dipilih, kolom POSTING dicentang dan Link Post diisi.</p>
      <label for="epLink">Link post</label><input type="url" id="epLink" value="${esc(f.epLink || "")}" placeholder="https://www.instagram.com/reel/...">
      ${ui.cal && ui.cal.configured ? `<label for="epCal">Baris di Content Calendar</label>
      <select id="epCal"><option value="">Jangan ubah kalender</option>${cands.map(({ r }) => `<option value="${esc(r.id)}" ${sel === r.id ? "selected" : ""}>${esc(fmtDate(r.date))}: ${esc(r.content.slice(0, 50))}${r.posting ? " (sudah POSTING)" : ""}</option>`).join("")}</select>` : ""}
      ${f.epConfirm ? `<p class="msg info">Tempel stempel POSTED di slide ini${sel ? " dan centang POSTING di kalender" : ""}. Lanjut?</p>
        <div class="row2"><button class="btn secondary" data-act="epPostCancel">Batal</button><button class="btn" data-act="epPostDo" ${f.busy ? "disabled" : ""}>${f.busy ? "Menyimpan…" : "Ya, POSTED"}</button></div>`
        : `<button class="btn" data-act="epPostAsk">Tandai POSTED</button>`}
    </div>`;
  }
  return `<div class="pad">
    <button class="back" data-act="back">← Kembali</button>
    <p class="detail-title">${esc(i.cover || "(cover belum diisi)")}</p>
    <dl class="facts">
      <dt>Upload</dt><dd>${esc(i.uploadText || "-")}</dd>
      <dt>Akun</dt><dd>${esc(i.account)}</dd>
      <dt>Format</dt><dd>${esc(i.format || "-")}</dd>
      <dt>Talent</dt><dd>${esc(i.talent || "-")}</dd>
      <dt>Status</dt><dd>${epPill(i)}</dd>
      ${i.reference ? `<dt>Reference</dt><dd><a href="${esc(i.reference)}" target="_blank" rel="noopener">${esc(i.reference)}</a></dd>` : ""}
    </dl>
    ${slideShot(i)}
    <a class="btn secondary as-link" href="https://docs.google.com/presentation/d/${esc(ui.ep.id)}/edit#slide=id.${esc(i.id)}" target="_blank" rel="noopener">Buka slide ini di Google Slides</a>
    ${decision}
    ${post}
    ${f.msg ? `<p class="msg ${f.msgType}" role="status">${esc(f.msg)}</p>` : ""}
  </div>`;
}

// Screenshot slide dari Google (link berlaku sekitar 30 menit, disimpan 25 menit di memori).
const THUMB_MS = 25 * 60 * 1000;
function slideShot(i) {
  const t = (ui.thumbs || {})[i.id];
  if (t && t.error) return `<div class="slide-shot empty-shot"><p>${esc(t.error)}</p><button class="linklike" data-act="thumbRetry">Coba lagi</button></div>`;
  if (!t || Date.now() - t.at > THUMB_MS) return `<div class="slide-shot empty-shot" aria-busy="true"><p>Memuat gambar slide…</p></div>`;
  return `<button class="slide-shot" data-act="zoom" aria-label="Perbesar gambar slide"><img src="${esc(t.url)}" alt="Slide EP: ${esc(i.cover || i.format)}" width="${t.width}" height="${t.height}"></button>`;
}
async function loadThumb(id) {
  ui.thumbs = ui.thumbs || {};
  const t = ui.thumbs[id];
  if (t && !t.error && Date.now() - t.at < THUMB_MS) return;
  if (t && t.loading) return;
  ui.thumbs[id] = { loading: true, at: 0 };
  try {
    const r = await api(`/api/ep/thumb?id=${encodeURIComponent(id)}`);
    ui.thumbs[id] = { url: r.url, width: r.width, height: r.height, at: Date.now() };
  } catch (e) { ui.thumbs[id] = { error: e.message, at: Date.now() }; }
  if (ui.tab === "ep" && ui.view === "detail" && ui.epOpen === id) render();
}
function openZoom(url, alt) {
  const z = document.createElement("div");
  z.className = "zoom";
  z.setAttribute("role", "dialog");
  z.setAttribute("aria-label", "Gambar slide diperbesar. Klik atau tekan Esc untuk menutup.");
  z.innerHTML = `<img src="${esc(url)}" alt="${esc(alt)}">`;
  const close = () => { z.remove(); document.removeEventListener("keydown", key, true); };
  const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  z.addEventListener("click", close);
  document.addEventListener("keydown", key, true);
  document.body.appendChild(z);
}

function bindEpDetail() {
  bindCommon();
  on("gRetry", () => loadState());
  if (ui.ep && ui.ep.items.some((x) => x.id === ui.epOpen)) loadThumb(ui.epOpen);
  on("thumbRetry", () => { delete ui.thumbs[ui.epOpen]; loadThumb(ui.epOpen); });
  on("zoom", () => { const t = ui.thumbs[ui.epOpen]; if (t && t.url) openZoom(t.url, "Slide EP"); });
  keep(["epNote", "epLink"]);
  const i = ui.ep && ui.ep.items.find((x) => x.id === ui.epOpen);
  if (!i) return;
  const selCal = $("epCal");
  if (selCal) selCal.addEventListener("change", () => { ui.form.epCal = selCal.value; });
  const decide = async (status, note) => {
    ui.form.busy = true; render();
    try {
      ui.ep = await api("/api/ep/decision", { id: i.id, status, note });
      ui.form = { msg: status === "OKE" ? "EP di-OKE. Tim mendapat pemberitahuan." : status === "REVISI" ? "Revisi terkirim ke tim." : "Status dihapus.", msgType: "ok" };
    } catch (e) { ui.form.busy = false; ui.form.msg = e.message; ui.form.msgType = "err"; }
    render();
  };
  document.querySelectorAll("[data-epdec]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.epdec === "OKE") decide("OKE", "");
    else { ui.form.epRev = true; ui.form.msg = ""; render(); const n = $("epNote"); if (n) n.focus(); }
  }));
  on("epRevCancel", () => { ui.form = {}; render(); });
  on("epRevSave", () => {
    const note = (ui.form.epNote ?? (i.decision && i.decision.note) ?? "").trim();
    if (!note) return setMsg("Tulis catatan revisinya dulu.", "err");
    decide("REVISI", note);
  });
  on("epClear", () => decide("", ""));
  on("epPostAsk", () => {
    const link = (ui.form.epLink || "").trim();
    if (link && !/^https?:\/\//i.test(link)) return setMsg("Link post harus diawali https://", "err");
    if (selCal) ui.form.epCal = selCal.value;
    ui.form.epConfirm = true; ui.form.msg = ""; render();
  });
  on("epPostCancel", () => { ui.form.epConfirm = false; render(); });
  on("epPostDo", async () => {
    ui.form.busy = true; render();
    try {
      const res = await api("/api/ep/posted", { id: i.id, link: (ui.form.epLink || "").trim(), calendarId: ui.form.epCal || "" });
      ui.ep = res.ep;
      if (res.calendarRow && canCal()) ui.cal = await api("/api/calendar");
      ui.form = { msg: `${res.stamped ? "Stempel POSTED ditempel di slide." : "Slide sudah POSTED."}${res.calendarRow ? ` Kalender baris ${res.calendarRow} dicentang POSTING.` : ""}`, msgType: "ok" };
    } catch (e) { ui.form.busy = false; ui.form.epConfirm = false; ui.form.msg = e.message; ui.form.msgType = "err"; }
    render();
  });
}

// ----- Content Calendar -----
function calListView() {
  const blocked = googleBlock("cal");
  if (blocked) return blocked;
  const accounts = ui.cal.accounts || [];
  const acc = accounts.includes(ui.calAcc) ? ui.calAcc : accounts[0];
  const all = ui.cal.rows.filter((r) => r.account === acc).sort((a, b) => (a.date || "9").localeCompare(b.date || "9") || a.row - b.row);
  const filter = ui.calFilter || "week";
  const rows = filter === "week" ? all.filter((r) => inWeek(r.date)) : filter === "todo" ? all.filter((r) => !r.noPosting && !r.posting) : all;
  let last = null;
  const body = rows
    .map((r) => {
      const head = r.date !== last ? `<li class="cal-date">${esc(fmtDate(r.date))}</li>` : "";
      last = r.date;
      if (r.noPosting) return `${head}<li class="cal-row cal-off"><button class="cal-main" data-calrow="${esc(r.id)}"><span class="cal-title">NO POSTING</span></button></li>`;
      return `${head}<li class="cal-row">
        <button class="cal-main" data-calrow="${esc(r.id)}">
          <span class="cal-title">${esc(r.content)}</span>
          <span class="cal-meta">${esc([r.pillar.replace(/^\d+\.\s*/, ""), r.format, r.note].filter(Boolean).join(", "))}</span>
        </button>
        <div class="cal-checks" role="group" aria-label="Progres ${esc(r.content)}">
          ${[["take", "Take"], ["editing", "Edit"], ["posting", "Post"]].map(([k, l]) => `<button data-tog="${esc(r.id)}" data-field="${k}" aria-pressed="${r[k]}" title="${k.toUpperCase()}">${l}</button>`).join("")}
          ${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener" class="cal-link" aria-label="Buka link post">Link</a>` : ""}
        </div>
      </li>`;
    })
    .join("");
  return `<div class="list-head">${accountSeg(accounts, acc, "calacc")}
      <a class="linklike" href="https://docs.google.com/spreadsheets/d/${esc(ui.cal.id)}/edit" target="_blank" rel="noopener">Buka Sheet</a></div>
    <div class="filter" role="group" aria-label="Saring kalender">
      ${[["week", "Minggu ini"], ["todo", "Belum posting"], ["all", "Semua"]].map(([k, l]) => `<button data-calf="${k}" aria-pressed="${filter === k}">${l}</button>`).join("")}
    </div>
    <div class="pad-x"><button class="btn" data-act="calAdd">+ Tambah ke kalender</button></div>
    ${rows.length ? `<ul class="cal-list">${body}</ul>` : `<p class="empty">Belum ada baris di filter ini.</p>`}
    ${ui.form.msg ? `<p class="msg ${ui.form.msgType} pad-x" role="status">${esc(ui.form.msg)}</p>` : ""}`;
}

function bindCalList() {
  bindCommon();
  on("gRetry", () => loadState());
  document.querySelectorAll("[data-calacc]").forEach((b) => b.addEventListener("click", () => { ui.calAcc = b.dataset.calacc; render(); }));
  document.querySelectorAll("[data-calf]").forEach((b) => b.addEventListener("click", () => { ui.calFilter = b.dataset.calf; render(); }));
  on("calAdd", () => {
    const acc = (ui.cal.accounts || []).includes(ui.calAcc) ? ui.calAcc : (ui.cal.accounts || [])[0];
    const o = ui.cal.options || {};
    ui.form = { edit: { account: acc, date: todayISO(), pillar: "", format: (o.formats || [])[0] || "", platform: (o.platforms || [])[0] || "", content: "", note: "", fa: "", link: "", take: false, editing: false, posting: false, noPosting: false } };
    ui.view = "detail"; render();
  });
  document.querySelectorAll("[data-calrow]").forEach((b) => b.addEventListener("click", () => {
    const r = ui.cal.rows.find((x) => x.id === b.dataset.calrow);
    if (!r) return;
    ui.form = { edit: { ...r } }; ui.view = "detail"; render();
  }));
  document.querySelectorAll("[data-tog]").forEach((b) => b.addEventListener("click", async () => {
    const value = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(value)); b.disabled = true;
    try {
      const res = await api("/api/calendar/toggle", { id: b.dataset.tog, field: b.dataset.field, value });
      ui.cal = { ok: true, ...res.calendar }; ui.form = {};
    } catch (e) { ui.form = { msg: e.message, msgType: "err" }; }
    render();
  }));
}

function calFormView() {
  const blocked = googleBlock("cal");
  if (blocked) return blocked;
  const e = ui.form.edit;
  const o = ui.cal.options || {};
  const opt = (list, cur) => {
    const all = cur && !list.includes(cur) ? [cur, ...list] : list;
    return `<option value="">-</option>${all.map((x) => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("")}`;
  };
  const f = ui.form;
  return `<div class="pad">
    <button class="back" data-act="back">← Kembali</button>
    <h2>${e.id ? `Ubah baris ${e.row}` : "Tambah ke kalender"}</h2>
    <label>Akun</label>${accountSeg(ui.cal.accounts || [], e.account, "fAcc")}
    <label for="fDate">Tanggal</label><input type="date" id="fDate" value="${esc(e.date)}">
    <label class="check"><input type="checkbox" id="fNo" ${e.noPosting ? "checked" : ""}> No posting (libur atau memang tidak posting)</label>
    ${e.noPosting ? "" : `
      <label for="fContent">Judul konten</label><input type="text" id="fContent" value="${esc(e.content)}" placeholder="Contoh: Animasi 6 : Ganti Niche Terus">
      <div class="row2">
        <div><label for="fPillar">Content pillar</label><select id="fPillar">${opt(o.pillars || [], e.pillar)}</select></div>
        <div><label for="fFormat">Format</label><select id="fFormat">${opt(o.formats || [], e.format)}</select></div>
      </div>
      <div class="row2">
        <div><label for="fPlatform">Platform</label><select id="fPlatform">${opt(o.platforms || [], e.platform)}</select></div>
        <div><label for="fNote">Time / catatan</label><input type="text" id="fNote" value="${esc(e.note)}" placeholder="TAKE / REFLY"></div>
      </div>
      <label for="fFa">FA Content</label><input type="text" id="fFa" value="${esc(e.fa)}" placeholder="26/11 - Ganti Niche">
      <label for="fLink">Link post</label><input type="url" id="fLink" value="${esc(e.link)}" placeholder="https://www.instagram.com/...">
      <div class="seg cal-checks-form" role="group" aria-label="Progres">
        ${[["take", "TAKE"], ["editing", "EDITING"], ["posting", "POSTING"]].map(([k, l]) => `<button data-fchk="${k}" aria-pressed="${!!e[k]}">${l}</button>`).join("")}
      </div>`}
    <button class="btn" data-act="calSave" ${f.busy ? "disabled" : ""}>${f.busy ? "Menyimpan…" : e.id ? "Simpan perubahan" : "Tambah ke sheet"}</button>
    ${f.msg ? `<p class="msg ${f.msgType}" role="status">${esc(f.msg)}</p>` : ""}
  </div>`;
}

function bindCalForm() {
  bindCommon();
  on("gRetry", () => loadState());
  const e = ui.form.edit;
  if (!e) { ui.view = "list"; render(); return; }
  const map = { fDate: "date", fContent: "content", fPillar: "pillar", fFormat: "format", fPlatform: "platform", fNote: "note", fFa: "fa", fLink: "link" };
  Object.entries(map).forEach(([id, k]) => { const el = $(id); if (el) el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => { e[k] = el.value; }); });
  const no = $("fNo");
  no.addEventListener("change", () => { e.noPosting = no.checked; render(); });
  document.querySelectorAll("[data-facc]").forEach((b) => b.addEventListener("click", () => { e.account = b.dataset.facc; render(); }));
  document.querySelectorAll("[data-fchk]").forEach((b) => b.addEventListener("click", () => { e[b.dataset.fchk] = !e[b.dataset.fchk]; render(); }));
  on("calSave", async () => {
    if (!e.date) return setMsg("Tanggal wajib diisi.", "err");
    if (!e.noPosting && !(e.content || "").trim()) return setMsg("Isi judul konten, atau centang No posting.", "err");
    if (e.link && !/^https?:\/\//i.test(e.link)) return setMsg("Link post harus diawali https://", "err");
    ui.form.busy = true; render();
    try {
      const res = await api("/api/calendar/save", e);
      ui.cal = { ok: true, ...res.calendar };
      ui.calAcc = e.account;
      ui.form = { msg: `${e.id ? "Baris diperbarui" : "Ditambahkan"} di baris ${res.row} tab ${e.account}.`, msgType: "ok" };
      ui.view = "list";
    } catch (err) { ui.form.busy = false; ui.form.msg = err.message; ui.form.msgType = "err"; }
    render();
  });
}

// ===================== v1.3: tema, jendela penuh, foto, ringkasan =====================
const isFull = () => ui.settings.mode === "full";
const DEFAULT_ACCENT = "#5B9BE6";
const ACCENTS = ["#5B9BE6", "#3DBE9A", "#E7A93B", "#E36B7B", "#9C7BEA", "#E07BC1", "#D8DEE6"];
const hexOk = (h) => /^#[0-9a-f]{6}$/i.test(h || "");
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(+v) ? +v : a));

// Kontras teks di atas warna aksen: pilih gelap atau putih, mana yang kontrasnya lebih tinggi.
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
function onAccent(hex) {
  const L = luminance(hex);
  return contrast(L, luminance("#08111D")) >= contrast(L, 1) ? "#08111D" : "#FFFFFF";
}

// v1.5: warna aksen ikut mewarnai latar, sidebar, dan kartu. tint 0 = netral seperti v1.3.
const THEME_BASE = {
  dark: { bg: [8, 17, 29], bar: [5, 11, 20], panel: [14, 26, 43], panel2: [19, 35, 58] },
  light: { bg: [233, 238, 246], bar: [255, 255, 255], panel: [255, 255, 255], panel2: [241, 245, 251] },
};
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function tintChannels(acc, light, tint) {
  const a = hexRgb(acc);
  const base = THEME_BASE[light ? "light" : "dark"];
  // Gelap: aksen diredupkan supaya teks putih tetap kontras. Terang: aksen dipudarkan ke putih.
  const target = light ? a.map((c) => Math.round(c * 0.22 + 255 * 0.78)) : a.map((c) => Math.round(c * 0.3));
  const mix = (b, k) => b.map((c, i) => Math.round(c * (1 - k) + target[i] * k)).join(" ");
  const k = clamp(tint, 0, 1);
  return { "--bg-c": mix(base.bg, 0.75 * k), "--bar-c": mix(base.bar, 0.7 * k), "--panel-c": mix(base.panel, 0.8 * k), "--panel2-c": mix(base.panel2, 0.8 * k) };
}

function applyTheme() {
  const s = ui.settings;
  const r = document.documentElement;
  const acc = hexOk(s.accent) ? s.accent : DEFAULT_ACCENT;
  for (const [k, v] of Object.entries(tintChannels(acc, s.theme === "light", s.tint ?? 0.5))) r.style.setProperty(k, v);
  r.style.setProperty("--accent", acc);
  r.style.setProperty("--on-accent", onAccent(acc));
  r.style.setProperty("--glass", String(clamp(s.glass ?? 0.55, 0.1, 0.9)));
  r.classList.toggle("light", s.theme === "light");
  r.classList.toggle("native", !!(ui.win && ui.win.glass));
  r.classList.toggle("full", isFull() && configured());
}

async function setMode(mode) {
  ui.settings = await window.aab.setMode(mode);
  if (mode === "compact" && ["home", "ig", "feed", "team", "profile"].includes(ui.tab)) ui.tab = "request";
  if (mode === "full" && configured() && ui.tab === "request" && ui.view === "list") ui.tab = "home";
  if (ui.view === "detail" && ui.tab !== "ep") ui.view = "list";
  render();
  if (mode === "full" && isLead()) loadState();
}

// ---------- Foto profil ----------
function photoCache() {
  try { return JSON.parse(localStorage.getItem("photos") || "{}"); } catch { return {}; }
}
async function syncPhotos() {
  const team = (ui.data && ui.data.team) || [];
  if (!ui.photos) ui.photos = photoCache();
  const need = team.some((t) => (t.photoVer || 0) !== ((ui.photos[t.username] || {}).ver || 0));
  if (!need) return;
  try {
    ui.photos = (await api("/api/photos")).photos || {};
    try { localStorage.setItem("photos", JSON.stringify(ui.photos)); } catch { /* penyimpanan penuh, abaikan */ }
  } catch { /* foto tidak wajib */ }
}
const teamBy = (key, val) => ((ui.data && ui.data.team) || []).find((t) => t[key] === val) || null;
function avatar(username, size = "", fallbackName = "") {
  const t = teamBy("username", username);
  const short = t && (MEMBERS.find((m) => m.id === t.member) || {}).short;
  const name = short || (t && t.name) || fallbackName || username || "?";
  const p = ui.photos && ui.photos[username];
  const cls = `avatar${size ? " " + size : ""}`;
  if (p && p.image && /^data:image\//.test(p.image)) return `<span class="${cls}"><img src="${esc(p.image)}" alt=""></span>`;
  return `<span class="${cls}" aria-hidden="true">${esc(name.trim().charAt(0).toUpperCase())}</span>`;
}
const memberAvatar = (memberId, size) => {
  const t = teamBy("member", memberId);
  const m = MEMBERS.find((x) => x.id === memberId);
  return avatar(t ? t.username : "", size, m ? m.short : "?");
};

// Potong tengah jadi persegi 256 px, JPEG. Hasilnya sekitar 15 sampai 35 KB.
async function photoToDataUrl(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  c.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  for (const q of [0.85, 0.7, 0.55]) {
    const url = c.toDataURL("image/jpeg", q);
    if (url.length < 75 * 1024) return url;
  }
  throw new Error("Foto terlalu besar. Coba foto lain.");
}

// ---------- Sidebar ----------
const ICONS = {
  home: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="11" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.5"/><rect x="11" y="11" width="6" height="6" rx="1.5"/>',
  request: '<path d="M4 5h12M4 10h12M4 15h7"/>',
  input: '<path d="M4 16V9M10 16V4M16 16v-5"/>',
  ep: '<rect x="3" y="4" width="14" height="10" rx="2"/><path d="M7 17h6"/>',
  cal: '<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 2v4M13 2v4"/>',
  accounts: '<circle cx="7" cy="7" r="3"/><circle cx="14" cy="8" r="2.5"/><path d="M2 17c0-3 2.5-5 5-5s5 2 5 5M12 13c3 0 6 1.5 6 4"/>',
  ig: '<rect x="3" y="3" width="14" height="14" rx="4"/><circle cx="10" cy="10" r="3.2"/><circle cx="14.2" cy="5.8" r=".6" fill="currentColor"/>',
  feed: '<path d="M4 4h12v9H8l-4 3z"/><path d="M7 8h6M7 10.5h4"/>',
  team: '<circle cx="10" cy="7" r="3"/><path d="M4 17c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/>',
  profile: '<circle cx="10" cy="7" r="3"/><path d="M4 17c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/>',
  settings: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6"/>',
};
function currentPage() {
  if (ui.view === "settings") return "settings";
  if (ui.view === "accounts") return "accounts";
  return ui.tab;
}
function navItems() {
  const reqOpen = visibleRequests().filter((r) => r.status !== "done").length;
  const epItems = (ui.ep && ui.ep.items) || [];
  const epBadge = isLead() ? epItems.filter((i) => !i.posted && !i.decision).length : epItems.filter((i) => !i.posted && i.decision && i.decision.status === "REVISI").length;
  return [
    { group: "HARIAN" },
    { id: "home", label: "Ringkasan", c: "#7FB2EE" },
    { id: "feed", label: "Timeline", c: "#9FD4FF", badge: feedHasNew() ? "Baru" : 0 },
    { id: "request", label: "Request creative", c: "#F3C77A", badge: reqOpen },
    { id: "input", label: isLead() ? "KPI tim" : "Input KPI", c: "#8FE3B5" },
    { group: "KONTEN" },
    { id: "ep", label: "Editorial plan", c: "#FFB4BB", badge: epBadge },
    ...(canCal() ? [{ id: "cal", label: "Kalender konten", c: "#C9B6FF" }] : []),
    { id: "ig", label: "Insight Instagram", c: "#F3A6C8" },
    { group: "TIM" },
    { id: "team", label: "Profil tim", c: "#FFD8A8" },
    ...(isLead() ? [{ id: "accounts", label: "Akun tim", c: "#D6E0EC" }] : []),
    { id: "settings", label: "Pengaturan", c: "#D6E0EC" },
  ];
}
function renderSide() {
  const side = $("side");
  const show = isFull() && configured();
  side.hidden = !show;
  if (!show) return;
  const u = ui.settings.user || {};
  const cur = currentPage() === "profile" ? "team" : currentPage();
  const role = isLead() ? "Creative Lead" : `Tim creative, blok ${(member() || {}).block || ""}`;
  const t = ui.data && ui.data.fetchedAt ? new Date(ui.data.fetchedAt) : null;
  side.innerHTML = `
    <div class="me">${avatar(u.username, "", u.name)}<div data-css="min-width:0"><b>${esc(u.name || u.username)}</b><small>${esc(role)}</small></div></div>
    ${navItems().map((n) => n.group ? `<div class="nav-group">${n.group}</div>` :
      `<button class="nav" data-nav="${n.id}" ${cur === n.id ? 'aria-current="page"' : ""} data-css="--c:${n.c}">
        <span class="ic"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${ICONS[n.id]}</svg></span>${esc(n.label)}
        ${n.badge ? `<span class="badge">${n.badge}</span>` : ""}</button>`).join("")}
    <div class="side-foot">
      <img src="logo.png" alt="">
      <div><b>Creative AAB</b><small>${ui.update && ui.update.current ? `v${esc(ui.update.current)}` : ""}${t ? ` · data ${pad(t.getHours())}.${pad(t.getMinutes())}` : ""}</small></div>
      <button class="icon-btn" data-act="toCompact" aria-label="Kecilkan jadi widget" title="Kecilkan jadi widget">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2"/><rect x="10" y="10" width="7" height="7" rx="1.5" fill="currentColor" stroke="none"/></svg>
      </button>
    </div>`;
  applyCss(side);
  side.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => goPage(b.dataset.nav)));
  side.querySelector('[data-act="toCompact"]').addEventListener("click", () => setMode("compact"));
}
function goPage(id, extra = {}) {
  ui.form = {};
  if (id === "settings") { ui.view = "settings"; }
  else if (id === "accounts") { ui.view = "accounts"; ui.accounts = null; loadAccounts(); }
  else { ui.tab = id; ui.view = "list"; }
  Object.assign(ui, extra);
  if (id === "feed") delete (ui.feeds || {}).all;
  if (id === "profile") delete (ui.feeds || {})[`p:${ui.profileUser}`];
  render();
  if (isLead() && (id === "home" || id === "input")) loadState();
  if (id === "ig") loadIg();
}

// ---------- Judul halaman (jendela penuh) ----------
function greeting() {
  const h = new Date().getHours();
  return h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 19 ? "Selamat sore" : "Selamat malam";
}
const HARI_PANJANG = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN_PANJANG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
function renderPageHead() {
  const el = $("pageHead");
  const show = isFull() && configured();
  el.hidden = !show;
  if (!show) return;
  const d = new Date();
  const today = `${HARI_PANJANG[d.getDay()]}, ${d.getDate()} ${BULAN_PANJANG[d.getMonth()]} ${d.getFullYear()}`;
  const first = ((ui.settings.user && ui.settings.user.name) || "").split(" ")[0];
  const heads = {
    home: [`${greeting()}, ${first}`, today],
    request: ["Request creative", isLead() ? "Semua request dari sheet REQUEST CREATIVE" : "Request yang sudah di-approve Ray"],
    input: [isLead() ? "KPI tim" : "Input KPI", isLead() ? "Angka bulan ini dan aktivitas terbaru" : `Blok ${(member() || {}).block || ""} di Creative Report Analytic`],
    ep: ["Editorial plan", ui.ep && ui.ep.title ? `${ui.ep.title} · ${ui.ep.items.length} konten` : "Google Slides EP bulan ini"],
    cal: ["Kalender konten", ui.cal && ui.cal.title ? ui.cal.title : "Content Calendar bulan ini"],
    accounts: ["Akun tim", "Buat akun, reset password, atau nonaktifkan akun"],
    ig: ["Insight Instagram", "Data resmi dari Instagram untuk akun AAB dan NUSANTARA"],
    feed: ["Timeline", "Kabar dan aktivitas tim creative"],
    team: ["Profil tim", "Kenalan lebih dekat dengan tim creative"],
    profile: ["Profil", "Foto, bio, dan aktivitas"],
    settings: ["Pengaturan", "Tampilan berlaku di laptop ini. Foto profil terlihat oleh seluruh tim."],
  };
  const [h, p] = heads[currentPage()] || heads.home;
  el.innerHTML = `<div><h1>${esc(h)}</h1><p>${esc(p)}</p></div>`;
}

// ---------- Ringkasan ----------
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const lastDays = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return isoDay(d); });
const SERIES = {
  fitria: { key: "content", label: "Konten", color: "var(--accent-2)" },
  athallah: { key: "design", label: "Desain", color: "#8FE3B5" },
  albar: { key: "video", label: "Video", color: "#F3C77A" },
  rifqi: { key: "aigcUpload", label: "AIGC upload", color: "#C9B6FF" },
};
const seriesOf = (memberId) => ((ui.data && ui.data.daily) || {})[SERIES[memberId].key] || {};
const sumDays = (obj, days) => days.reduce((a, d) => a + (obj[d] || 0), 0);
function sparkPath(vals) {
  const max = Math.max(1, ...vals);
  return vals.map((v, i) => `${i ? "L" : "M"}${Math.round((i / (vals.length - 1)) * 200)} ${Math.round(31 - (v / max) * 27)}`).join(" ");
}

function kpiCard(id) {
  const m = MEMBERS.find((x) => x.id === id);
  const c = (ui.data && ui.data.counts) || {};
  const s = SERIES[id];
  const ser = seriesOf(id);
  const week = sumDays(ser, lastDays(7));
  const num = id === "fitria" ? c.content : id === "athallah" ? c.design : id === "albar" ? c.video : c.aigcProduksi;
  const last = ui.dash && ui.dash.last ? ui.dash.last[id] : null;
  const label = { fitria: "Konten IG", athallah: "Desain", albar: "Video", rifqi: "AIGC" }[id];
  return `<div class="kpi glass">
    <div class="kpi-top">${memberAvatar(id, "sm")}<b>${esc(m.short)}</b> · ${label}</div>
    <div class="kpi-num">${num ?? 0}${id === "rifqi" ? `<small>produksi · ${c.aigcUpload ?? 0} upload</small>` : ""}<span class="delta${week ? "" : " zero"}">+${week} 7 hari</span></div>
    <svg class="spark" viewBox="0 0 200 34" preserveAspectRatio="none" aria-hidden="true"><path d="${sparkPath(lastDays(14).map((d) => ser[d] || 0))}" fill="none" stroke="${s.color}" stroke-width="2"/></svg>
    <div class="kpi-foot">${isLead() ? `Input terakhir lewat widget: ${esc(ago(last))}` : `Total bulan ini, blok ${esc(m.block)}`}</div>
  </div>`;
}

function todoItems() {
  const items = [];
  const reqs = visibleRequests();
  const today = todayISO();
  const ep = (ui.ep && ui.ep.configured && ui.ep.items) || [];
  const cal = (ui.cal && ui.cal.configured && ui.cal.rows) || [];
  if (isLead()) {
    const need = reqs.filter((r) => r.status !== "done" && !r.decision);
    if (need.length) items.push({ n: need.length, cls: "amb", t: "Request menunggu keputusanmu", s: `Contoh: ${need[0].info.slice(0, 70)}`, btn: "Putuskan", acc: true, go: ["request", { filter: "baru" }] });
  } else {
    const work = reqs.filter((r) => r.status !== "done");
    if (work.length) items.push({ n: work.length, cls: "amb", t: "Request creative belum selesai", s: work[0].info.slice(0, 70), btn: "Kerjakan", acc: true, go: ["request", {}] });
  }
  const rev = ep.filter((i) => !i.posted && i.decision && i.decision.status === "REVISI");
  if (rev.length) items.push({ n: rev.length, cls: "red", t: "EP perlu revisi", s: rev.map((i) => i.cover).filter(Boolean).slice(0, 2).join(", "), btn: "Lihat EP", go: ["ep", { epFilter: "rev" }] });
  if (isLead()) {
    const wait = ep.filter((i) => !i.posted && !i.decision);
    if (wait.length) items.push({ n: wait.length, cls: "blu", t: "EP menunggu OKE", s: wait.map((i) => i.cover).filter(Boolean).slice(0, 2).join(", "), btn: "Tinjau", go: ["ep", { epFilter: "wait" }] });
  }
  if (canCal()) {
    const late = cal.filter((r) => !r.noPosting && r.content && !r.posting && r.date && r.date < today);
    if (late.length) items.push({ n: late.length, cls: "red", t: "Konten lewat tanggal, belum posting", s: late.slice(0, 2).map((r) => r.content).join(", "), btn: "Kalender", go: ["cal", { calFilter: "todo" }] });
    const todayRows = cal.filter((r) => !r.noPosting && r.content && !r.posting && r.date === today);
    if (todayRows.length) items.push({ n: todayRows.length, cls: "blu", t: "Jadwal posting hari ini", s: todayRows.map((r) => r.content).join(", "), btn: "Kalender", go: ["cal", { calFilter: "week" }] });
  }
  const m = member();
  if (m && !isLead() && SERIES[m.id] && ui.data && ui.data.daily) {
    const key = m.id === "rifqi" ? "aigcProduksi" : SERIES[m.id].key;
    if (!(ui.data.daily[key] || {})[today]) items.push({ n: "!", cls: "blu", t: "Belum ada input KPI hari ini", s: "Kirim begitu ada hasil kerja hari ini.", btn: "Input", go: ["input", {}] });
  }
  return items;
}

function chartBox() {
  const days = lastDays(7);
  const ids = isLead() ? Object.keys(SERIES) : member() && SERIES[member().id] ? [member().id] : [];
  if (!ids.length) return "";
  const cols = days.map((d) => ids.map((id) => seriesOf(id)[d] || 0));
  const max = Math.max(1, ...cols.map((c) => c.reduce((a, b) => a + b, 0)));
  const k = 150 / max;
  return `<section class="box glass">
    <h2>Input KPI per hari <small>${esc(fmtDate(days[0]))} sampai ${esc(fmtDate(days[6]))}</small></h2>
    <div class="chart" role="img" aria-label="Jumlah input KPI per hari, 7 hari terakhir">
      ${cols.map((c) => `<div class="bar-col">${c.map((v, i) => (v ? `<i data-css="height:${Math.round(v * k)}px;background:${SERIES[ids[i]].color}" title="${SERIES[ids[i]].label}: ${v}"></i>` : "")).join("")}</div>`).join("")}
    </div>
    <div class="axis">${days.map((d) => `<span>${esc(fmtDate(d))}</span>`).join("")}</div>
    <div class="legend">${ids.map((id) => `<span data-css="--c:${SERIES[id].color}">${SERIES[id].label}</span>`).join("")}</div>
  </section>`;
}

function planBox() {
  if (!canCal() || !ui.cal || !ui.cal.configured) return "";
  const [a, b] = weekRange();
  const rows = ui.cal.rows.filter((r) => r.date >= a && r.date <= b);
  const accs = ui.cal.accounts || [];
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(`${a}T00:00:00`); d.setDate(d.getDate() + i); return isoDay(d); });
  const today = todayISO();
  return `<section class="box glass">
    <h2>Content plan <small>${esc(fmtDate(a))} sampai ${esc(fmtDate(b))}</small></h2>
    ${accs.map((acc) => {
      const mine = rows.filter((r) => r.account === acc && !r.noPosting && r.content);
      const done = mine.filter((r) => r.posting).length;
      return `<div class="plan-line"><b>${esc(acc)}</b><div class="track"><i data-css="width:${mine.length ? Math.round((done / mine.length) * 100) : 0}%"></i></div><em>${done}/${mine.length}</em></div>`;
    }).join("")}
    <div class="days">${days.map((d) => {
      const dr = rows.filter((r) => r.date === d);
      const dots = dr.map((r) => (r.noPosting ? '<i class="x"></i>' : r.posting ? "<i></i>" : '<i class="p"></i>')).join("");
      const dt = new Date(`${d}T00:00:00`);
      return `<button class="day${d === today ? " today" : ""}" data-goday="${d}" data-css="border:0">${HARI[dt.getDay()]}<b>${dt.getDate()}</b><div class="dots">${dots}</div></button>`;
    }).join("")}</div>
  </section>`;
}

function epBox() {
  if (!ui.ep || !ui.ep.configured) return "";
  const items = ui.ep.items;
  const wait = items.filter((i) => !i.posted && !i.decision).length;
  const rev = items.filter((i) => !i.posted && i.decision && i.decision.status === "REVISI").length;
  const posted = items.filter((i) => i.posted).length;
  const next = items.filter((i) => !i.posted && i.date >= todayISO()).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 3);
  return `<section class="box glass">
    <h2>Editorial plan</h2>
    <div class="mini-stats">
      <button data-goep="wait"><b>${wait}</b>menunggu OKE</button>
      <button data-goep="rev"><b>${rev}</b>revisi</button>
      <button data-goep="all"><b>${posted}</b>posted</button>
    </div>
    ${next.length ? `<div class="mini-list">${next.map((i) => `<button data-epopen="${esc(i.id)}"><span>${esc(fmtDate(i.date))}: ${esc(i.cover || i.format)}</span>${epPill(i)}</button>`).join("")}</div>` : ""}
  </section>`;
}

function activityBox() {
  if (!isLead() || !ui.dash) return "";
  const act = (ui.dash.activity || []).slice(0, 6);
  return `<section class="box glass">
    <h2>Aktivitas tim</h2>
    ${act.length ? `<ul class="act-list">${act.map((x) => `<li>${avatar(x.who, "sm")}<div>${esc(((MEMBERS.find((m) => m.id === x.member) || {}).short || x.who))}: ${esc(x.text)}</div><span>${esc(ago(x.at))}</span></li>`).join("")}</ul>` : `<p class="all-clear">Belum ada kiriman lewat widget.</p>`}
  </section>`;
}

function homeView() {
  const blocked = stateBlock();
  if (blocked) return blocked;
  const todo = todoItems();
  const ids = isLead() ? Object.keys(SERIES) : member() && SERIES[member().id] ? [member().id] : [];
  return `<div class="home">
    ${ids.length ? `<div class="home-grid kpis">${ids.map(kpiCard).join("")}</div>` : ""}
    <div class="home-grid two">
      <section class="box glass">
        <h2>Perlu ditangani sekarang</h2>
        ${todo.length ? `<div class="todo">${todo.map((t, i) => `<div class="todo-item"><span class="n ${t.cls}">${t.n}</span><div><b>${esc(t.t)}</b><small>${esc(t.s)}</small></div><button class="chip${t.acc ? " acc" : ""}" data-todo="${i}">${esc(t.btn)}</button></div>`).join("")}</div>` : `<p class="all-clear">Semua beres. Tidak ada yang menunggu.</p>`}
      </section>
      ${chartBox() || epBox()}
    </div>
    <div class="home-grid three">${planBox()}${chartBox() ? epBox() : ""}${activityBox()}</div>
  </div>`;
}

function bindHome() {
  bindCommon();
  const todo = todoItems();
  document.querySelectorAll("[data-todo]").forEach((b) => b.addEventListener("click", () => { const t = todo[+b.dataset.todo]; goPage(t.go[0], t.go[1]); }));
  document.querySelectorAll("[data-goep]").forEach((b) => b.addEventListener("click", () => goPage("ep", { epFilter: b.dataset.goep })));
  document.querySelectorAll("[data-epopen]").forEach((b) => b.addEventListener("click", () => { goPage("ep", { epOpen: b.dataset.epopen }); ui.view = "detail"; render(); }));
  document.querySelectorAll("[data-goday]").forEach((b) => b.addEventListener("click", () => goPage("cal", { calFilter: "week" })));
}

// ---------- Personalisasi ----------
function lookSection() {
  const s = ui.settings;
  const u = s.user || {};
  const acc = hexOk(s.accent) ? s.accent : DEFAULT_ACCENT;
  const custom = !ACCENTS.includes(acc.toUpperCase()) && !ACCENTS.includes(acc);
  const w = ui.win || {};
  const f = ui.form;
  return `<div class="section">
    <h2>Foto profil</h2>
    <div class="photo-row">${avatar(u.username, "lg", u.name)}
      <div><div class="btns"><label class="btn" data-css="cursor:pointer">${f.busyPhoto ? "Mengunggah…" : "Ganti foto"}<input type="file" id="photoFile" accept="image/png,image/jpeg,image/webp" hidden ${f.busyPhoto ? "disabled" : ""}></label>
        ${ui.photos && ui.photos[u.username] ? `<button class="btn secondary" data-act="photoDel">Hapus</button>` : ""}</div>
        <p class="hint">JPG atau PNG. Dipotong bulat otomatis dan terlihat oleh seluruh tim.</p></div>
    </div>
  </div>
  <div class="section">
    <h2>Warna aksen</h2>
    <div class="swatches" role="group" aria-label="Warna aksen">
      ${ACCENTS.map((c) => `<button class="sw" data-css="--c:${c}" data-accent="${c}" aria-pressed="${acc.toUpperCase() === c}" aria-label="Aksen ${c}"></button>`).join("")}
      <span class="sw-custom${custom ? " on" : ""}" title="Pilih warna sendiri"><input type="color" id="accentPick" value="${esc(acc)}" aria-label="Pilih warna aksen sendiri"></span>
    </div>
    <label for="tintRange">Warna latar dan kartu</label>
    <input type="range" id="tintRange" min="0" max="1" step="0.05" value="${clamp(s.tint ?? 0.5, 0, 1)}">
    <p class="hint">Geser ke kiri untuk latar netral, ke kanan supaya sidebar, kartu, dan latar ikut berwarna. Berlaku di jendela penuh dan widget kecil di laptop ini.</p>
  </div>
  <div class="section">
    <h2>Kaca dan tampilan</h2>
    <label for="glassRange">Transparansi kaca</label>
    <input type="range" id="glassRange" min="0.1" max="0.9" step="0.05" value="${clamp(s.glass ?? 0.55, 0.1, 0.9)}">
    <div class="opt"><div>Efek kaca Windows 11<small>${w.glassSupported ? "Wallpaper terlihat buram di belakang jendela." : "Hanya tersedia di Windows 11. Di laptop ini memakai latar gradasi."}</small></div>
      <span class="switch"><input type="checkbox" id="optNative" ${w.glassSupported && s.nativeGlass !== false ? "checked" : ""} ${w.glassSupported ? "" : "disabled"} aria-label="Efek kaca Windows 11"><span></span></span></div>
    <div class="opt"><div>Mode terang<small>Untuk ruangan yang terang</small></div>
      <span class="switch"><input type="checkbox" id="optLight" ${s.theme === "light" ? "checked" : ""} aria-label="Mode terang"><span></span></span></div>
    <div class="opt"><div>Buka sebagai jendela penuh<small>Saat Windows menyala. Mati: buka sebagai widget kecil.</small></div>
      <span class="switch"><input type="checkbox" id="optStartFull" ${s.startMode === "full" ? "checked" : ""} aria-label="Buka sebagai jendela penuh"><span></span></span></div>
    <div class="opt"><div>Buka otomatis saat Windows menyala</div>
      <span class="switch"><input type="checkbox" id="sLogin" ${s.openAtLogin ? "checked" : ""} aria-label="Buka otomatis saat Windows menyala"><span></span></span></div>
  </div>`;
}

function bindLook() {
  const save = async (patch, look = false) => {
    ui.settings = await window.aab.saveSettings(patch);
    if (look) ui.win = await window.aab.applyLook();
    applyTheme();
  };
  document.querySelectorAll("[data-accent]").forEach((b) => b.addEventListener("click", async () => { await save({ accent: b.dataset.accent }); render(); }));
  const pick = $("accentPick");
  if (pick) {
    pick.addEventListener("input", () => {
      const r = document.documentElement;
      r.style.setProperty("--accent", pick.value); r.style.setProperty("--on-accent", onAccent(pick.value));
      for (const [k, v] of Object.entries(tintChannels(pick.value, ui.settings.theme === "light", ui.settings.tint ?? 0.5))) r.style.setProperty(k, v);
    });
    pick.addEventListener("change", async () => { await save({ accent: pick.value }); render(); });
  }
  const tr = $("tintRange");
  if (tr) {
    tr.addEventListener("input", () => {
      const acc = hexOk(ui.settings.accent) ? ui.settings.accent : DEFAULT_ACCENT;
      for (const [k, v] of Object.entries(tintChannels(acc, ui.settings.theme === "light", +tr.value))) document.documentElement.style.setProperty(k, v);
    });
    tr.addEventListener("change", () => save({ tint: +tr.value }));
  }
  const g = $("glassRange");
  if (g) {
    g.addEventListener("input", () => document.documentElement.style.setProperty("--glass", g.value));
    g.addEventListener("change", () => save({ glass: +g.value }));
  }
  const chk = (id, fn) => { const el = $(id); if (el) el.addEventListener("change", () => fn(el.checked)); };
  chk("optNative", (v) => save({ nativeGlass: v }, true));
  chk("optLight", (v) => save({ theme: v ? "light" : "dark" }, true));
  chk("optStartFull", (v) => save({ startMode: v ? "full" : "compact" }));
  const file = $("photoFile");
  if (file) file.addEventListener("change", async () => {
    const f0 = file.files && file.files[0];
    if (!f0) return;
    ui.form.busyPhoto = true; render();
    try {
      const image = await photoToDataUrl(f0);
      const r = await api("/api/me/photo", { image });
      const me = ui.settings.user.username;
      ui.photos = { ...(ui.photos || {}), [me]: { ver: r.photoVer, image } };
      try { localStorage.setItem("photos", JSON.stringify(ui.photos)); } catch { /* abaikan */ }
      ui.form = { msg: "Foto profil diganti.", msgType: "ok" };
    } catch (e) { ui.form = { msg: e.message, msgType: "err" }; }
    render();
  });
  on("photoDel", async () => {
    try {
      await api("/api/me/photo", { image: "" });
      const me = ui.settings.user.username;
      if (ui.photos) delete ui.photos[me];
      try { localStorage.setItem("photos", JSON.stringify(ui.photos || {})); } catch { /* abaikan */ }
      ui.form = { msg: "Foto profil dihapus.", msgType: "ok" };
    } catch (e) { ui.form = { msg: e.message, msgType: "err" }; }
    render();
  });
}

// ===================== v1.4: Insight Instagram =====================
const IG_ACCS = ["AAB", "NUSANTARA"];
const nf = (n) => (n === null || n === undefined ? "-" : Number(n).toLocaleString("id-ID"));
const short = (n) => (n === null || n === undefined ? "-" : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")}jt` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(".", ",")}rb` : nf(n));

async function loadIg({ sync = false } = {}) {
  try {
    ui.ig = sync ? await api("/api/ig/sync", {}) : await api("/api/ig");
    ui.igErr = "";
  } catch (e) { ui.igErr = e.message; }
  if (currentPage() === "ig" || ui.view === "settings") render();
}

function igSum(daily, days, key) { return days.reduce((a, d) => a + ((daily[d] || {})[key] || 0), 0); }

function igView() {
  if (ui.igErr) return `<div class="page-card"><div class="pad"><p class="msg err">${esc(ui.igErr)}</p><button class="btn secondary" data-act="igRetry">Coba lagi</button></div></div>`;
  if (!ui.ig) return `<p class="empty">Memuat insight Instagram…</p>`;
  const acc = IG_ACCS.includes(ui.igAcc) ? ui.igAcc : "AAB";
  const a = ui.ig.accounts[acc] || {};
  const seg = accountSeg(IG_ACCS, acc, "igacc");
  if (!a.connected) {
    return `<div class="home"><div class="list-head flush">${seg}</div>
      <div class="page-card"><div class="pad"><p>Akun ${esc(acc)} belum dihubungkan ke Instagram.</p>${isLead() ? `<button class="btn" data-act="settings">Hubungkan di Pengaturan</button>` : "<p class='hint'>Minta Ray menghubungkannya di Pengaturan.</p>"}</div></div></div>`;
  }
  const days7 = lastDays(7), prev7 = lastDays(14).slice(0, 7), days14 = lastDays(14);
  const d = a.daily || {};
  const f7 = (d[days7[0]] || {}).followers, fNow = a.followers;
  const followDelta = f7 && fNow ? fNow - f7 : null;
  const stat = (label, key) => {
    const now = igSum(d, days7, key), before = igSum(d, prev7, key);
    const pct = before ? Math.round(((now - before) / before) * 100) : null;
    return `<div class="kpi glass"><div class="kpi-top"><b>${label}</b> · 7 hari</div>
      <div class="kpi-num">${short(now)}${pct !== null ? `<span class="delta${pct < 0 ? " down" : pct === 0 ? " zero" : ""}">${pct > 0 ? "+" : ""}${pct}%</span>` : ""}</div>
      <svg class="spark" viewBox="0 0 200 34" preserveAspectRatio="none" aria-hidden="true"><path d="${sparkPath(days14.map((x) => (d[x] || {})[key] || 0))}" fill="none" stroke="var(--accent-2)" stroke-width="2"/></svg>
      <div class="kpi-foot">${pct !== null ? `dibanding 7 hari sebelumnya (${short(before)})` : "data pembanding belum cukup"}</div></div>`;
  };
  const vals = days14.map((x) => (d[x] || {}).views || 0);
  const max = Math.max(1, ...vals);
  const media = (a.media || []).slice().sort((x, y) => Date.parse(y.timestamp) - Date.parse(x.timestamp));
  const range = ui.igRange || "7";
  const now = new Date();
  const since = range === "bulan" ? new Date(now.getFullYear(), now.getMonth(), 1).getTime() : Date.now() - (range === "30" ? 30 : 7) * 864e5;
  const recent = media.filter((m) => Date.parse(m.timestamp) >= since);
  const top = recent.slice().sort((x, y) => (y.views ?? y.reach ?? 0) - (x.views ?? x.reach ?? 0)).slice(0, 6);
  const upd = a.updatedAt ? new Date(a.updatedAt) : null;
  return `<div class="home">
    <div class="list-head flush">${seg}<span class="hint">@${esc(a.username)} · ${upd ? `diperbarui ${pad(upd.getHours())}.${pad(upd.getMinutes())}` : ""}${isLead() ? ` · <button class="linklike" data-act="igSync">Sinkron sekarang</button>` : ""}</span></div>
    ${a.error ? `<p class="msg err">Sinkron terakhir gagal: ${esc(a.error)}${isLead() ? " Hubungkan ulang token di Pengaturan." : ""}</p>` : ""}
    <div class="home-grid kpis">
      <div class="kpi glass"><div class="kpi-top"><b>Followers</b></div><div class="kpi-num">${short(fNow)}${followDelta !== null ? `<span class="delta${followDelta < 0 ? " down" : followDelta === 0 ? " zero" : ""}">${followDelta > 0 ? "+" : ""}${nf(followDelta)} 7 hari</span>` : ""}</div>
        <div class="kpi-foot push">${nf(a.mediaCount)} postingan</div></div>
      ${stat("Views", "views")}${stat("Reach", "reach")}${stat("Interaksi", "total_interactions")}
    </div>
    <div class="home-grid two">
      <section class="box glass">
        <h2>Views per hari <small>${esc(fmtDate(days14[0]))} sampai ${esc(fmtDate(days14[13]))}</small></h2>
        <div class="chart chart14" role="img" aria-label="Views akun per hari, 14 hari terakhir">${vals.map((v, i) => `<div class="bar-col" title="${esc(fmtDate(days14[i]))}: ${nf(v)}">${v ? `<i data-css="height:${Math.round((v / max) * 150)}px;background:var(--accent)"></i>` : ""}</div>`).join("")}</div>
        <div class="axis chart14">${days14.map((x, i) => `<span>${i % 2 ? "" : esc(fmtDate(x).split(" ").slice(1).join(" "))}</span>`).join("")}</div>
        <p class="hint">Views dan reach akun dari Instagram, bisa terlambat sampai 48 jam.</p>
      </section>
      <section class="box glass">
        <h2>Konten terbaik
          <span class="seg mini-seg" role="group" aria-label="Rentang">${[["7", "7 hari"], ["30", "30 hari"], ["bulan", "Bulan ini"]].map(([k, l]) => `<button data-igrange="${k}" aria-pressed="${range === k}">${l}</button>`).join("")}</span></h2>
        ${top.length ? `<ol class="top-list">${top.map((m) => `<li><a href="${esc(m.permalink)}" target="_blank" rel="noopener">
            ${m.thumb ? `<img src="${esc(m.thumb)}" alt="" loading="lazy">` : `<span class="no-thumb"></span>`}
            <span class="top-cap">${esc(m.caption || "(tanpa caption)")}<small>${esc(fmtDate(isoDay(new Date(m.timestamp))))} · ${esc(m.kategori)}</small></span>
            <span class="top-num"><b>${short(m.views ?? m.reach)}</b>${m.views === null ? "reach" : "views"}</span></a></li>`).join("")}</ol>` : `<p class="all-clear">Belum ada konten di rentang ini.</p>`}
      </section>
    </div>
    <section class="box glass">
      <h2>Semua konten ${IG_MEDIA_DAYS_LABEL}</h2>
      <div class="ig-table-wrap"><table class="ig-table">
        <thead><tr><th>Konten</th><th>Tanggal</th><th>Views</th><th>Reach</th><th>Likes</th><th>Komentar</th><th>Share</th><th>Save</th></tr></thead>
        <tbody>${media.map((m) => `<tr><td><a href="${esc(m.permalink)}" target="_blank" rel="noopener">${esc((m.caption || "(tanpa caption)").slice(0, 60))}</a><small>${esc(m.kategori)}</small></td>
          <td>${esc(fmtDate(isoDay(new Date(m.timestamp))))}</td><td>${nf(m.views)}</td><td>${nf(m.reach)}</td><td>${nf(m.likes)}</td><td>${nf(m.comments)}</td><td>${nf(m.shares)}</td><td>${nf(m.saved)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="hint">${ui.ig.sheetSyncAt ? `Angka konten yang sudah ada di blok CONTENT ikut diperbarui otomatis tiap 4 jam (terakhir ${esc(ago(new Date(ui.ig.sheetSyncAt).toISOString()))}).` : "Angka di blok CONTENT diperbarui otomatis tiap 4 jam."}</p>
    </section>
  </div>`;
}
const IG_MEDIA_DAYS_LABEL = "60 hari terakhir";

function bindIg() {
  bindCommon();
  on("igRetry", () => loadIg());
  on("igSync", () => { ui.ig = null; render(); loadIg({ sync: true }); });
  document.querySelectorAll("[data-igacc]").forEach((b) => b.addEventListener("click", () => { ui.igAcc = b.dataset.igacc; render(); }));
  document.querySelectorAll("[data-igrange]").forEach((b) => b.addEventListener("click", () => { ui.igRange = b.dataset.igrange; render(); }));
  if (!ui.ig && !ui.igErr && !ui.igLoading) { ui.igLoading = true; loadIg().finally(() => { ui.igLoading = false; }); }
}

// Pengaturan Ray: hubungkan akun Instagram
function igSettings() {
  const g = ui.ig;
  const f = ui.form;
  if (!g) return `<div class="section"><h2>Instagram</h2><p class="hint">Memuat…</p></div>`;
  return `<div class="section">
    <h2>Instagram</h2>
    <p class="hint">Tempel token dari Meta for Developers (Instagram API → API setup with Unified login → Buat token akses). Token disimpan di server, tidak dikirim ke laptop tim. Jangan kirim token lewat chat.</p>
    ${IG_ACCS.map((acc) => {
      const a = g.accounts[acc] || {};
      const exp = a.expiresAt ? new Date(a.expiresAt) : null;
      return `<div class="ig-conn">
        <div class="ig-conn-head"><b>${acc}</b>${a.connected ? `<span class="pill done">@${esc(a.username)}</span>` : `<span class="pill wait">Belum terhubung</span>`}
          ${a.connected ? `<button class="linklike" data-igoff="${acc}">Lepas</button>` : ""}</div>
        ${a.connected ? `<p class="hint">${exp ? `Token berlaku sampai ${exp.getDate()} ${BULAN_PANJANG[exp.getMonth()]} ${exp.getFullYear()}, diperpanjang otomatis.` : "Token tidak kedaluwarsa."}${a.error ? ` Error terakhir: ${esc(a.error)}` : ""}</p>` : ""}
        <div class="row-link"><input type="password" id="igTok-${acc}" value="${esc(f["igTok-" + acc] || "")}" placeholder="${a.connected ? "Tempel token baru untuk mengganti" : "Tempel token akun " + acc}" autocomplete="off">
          <button class="btn inline" data-igon="${acc}" ${f.igBusy === acc ? "disabled" : ""}>${f.igBusy === acc ? "Mengecek…" : "Hubungkan"}</button></div>
        ${f.igMsgAcc === acc && f.igMsg ? `<p class="msg ${f.igMsgType}" role="status">${esc(f.igMsg)}</p>` : ""}
      </div>`;
    }).join("")}
  </div>`;
}

function bindIgSettings() {
  if (!isLead()) return;
  if (!ui.ig && !ui.igLoading) { ui.igLoading = true; loadIg().finally(() => { ui.igLoading = false; }); }
  keep(IG_ACCS.map((a) => `igTok-${a}`));
  document.querySelectorAll("[data-igon]").forEach((b) => b.addEventListener("click", async () => {
    const acc = b.dataset.igon;
    const token = (ui.form[`igTok-${acc}`] || "").trim();
    if (!token) { Object.assign(ui.form, { igMsgAcc: acc, igMsg: `Tempel token akun ${acc} dulu.`, igMsgType: "err" }); return render(); }
    Object.assign(ui.form, { igBusy: acc, igMsg: "" }); render();
    try {
      const r = await api("/api/ig/connect", { account: acc, token });
      ui.form = { igMsgAcc: acc, igMsg: `Terhubung ke @${r.username} (${nf(r.followers)} followers).`, igMsgType: "ok" };
      await loadIg();
    } catch (e) { Object.assign(ui.form, { igBusy: "", igMsgAcc: acc, igMsg: e.message, igMsgType: "err" }); }
    render();
  }));
  document.querySelectorAll("[data-igoff]").forEach((b) => b.addEventListener("click", async () => {
    const acc = b.dataset.igoff;
    try { await api("/api/ig/disconnect", { account: acc }); ui.form = { igMsgAcc: acc, igMsg: `${acc} dilepas.`, igMsgType: "ok" }; await loadIg(); }
    catch (e) { ui.form = { igMsgAcc: acc, igMsg: e.message, igMsgType: "err" }; }
    render();
  }));
}

// ===================== v1.5: Timeline, tim, profil =====================
const REACTS = [["like", "👍", "Suka"], ["love", "❤️", "Love"], ["haha", "😂", "Haha"], ["wow", "😮", "Wow"], ["fire", "🔥", "Keren"]];
const DEFAULT_TITLE = { ray: "Creative Lead", fitria: "Social Media Specialist", athallah: "Graphic Designer", albar: "Video Editor", rifqi: "AIGC Content Specialist" };
const AUTO_ICON = {
  content: '<path d="M4 16V9M10 16V4M16 16v-5"/>', design: '<rect x="3" y="3" width="14" height="14" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="M17 13l-4-4-7 8"/>',
  video: '<rect x="3" y="5" width="10" height="10" rx="2"/><path d="M13 9l4-2v6l-4-2"/>', aigc: '<path d="M10 3l1.8 4.2L16 9l-4.2 1.8L10 15l-1.8-4.2L4 9l4.2-1.8z"/>',
  done: '<path d="M4 10.5l4 4 8-9"/>', request: '<path d="M4 5h12M4 10h12M4 15h7"/>', ep: '<rect x="3" y="4" width="14" height="10" rx="2"/><path d="M7 17h6"/>',
  posted: '<path d="M4 10l12-6-4 13-3-5z"/>', info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6h.01"/>',
};

const profileOf = (username) => {
  const t = teamBy("username", username) || {};
  const m = MEMBERS.find((x) => x.id === t.member) || {};
  return { username, member: t.member, name: t.name || username, short: m.short || t.name || username, title: t.title || DEFAULT_TITLE[t.member] || "", bio: t.bio || "", coverVer: t.coverVer || 0 };
};
const nameLink = (username) => `<button class="linklike who" data-prof="${esc(username)}">${esc(profileOf(username).name)}</button>`;
const avatarLink = (username, size = "") => `<button class="av-btn" data-prof="${esc(username)}" aria-label="Profil ${esc(profileOf(username).name)}">${avatar(username, size)}</button>`;

const feedSeenKey = () => `feedSeen:${(ui.settings.user || {}).username || ""}`;
function feedSeen() { try { return localStorage.getItem(feedSeenKey()) || ""; } catch { return ""; } }
function markFeedSeen(at) { try { if (at && at > feedSeen()) localStorage.setItem(feedSeenKey(), at); } catch { /* abaikan */ } }
const feedHasNew = () => !!(ui.data && ui.data.feedLatest && ui.data.feedLatest > feedSeen() && currentPage() !== "feed");

async function loadFeed({ more = false, by = "" } = {}) {
  const key = by ? `p:${by}` : "all";
  const cur = (ui.feeds ||= {})[key] || { items: [], more: false };
  if (cur.loading) return;
  cur.loading = true; cur.error = "";
  ui.feeds[key] = cur;
  try {
    const q = new URLSearchParams();
    if (by) q.set("by", by);
    if (more && cur.items.length) q.set("before", cur.items[cur.items.length - 1].at);
    const r = await api(`/api/feed${q.toString() ? "?" + q : ""}`);
    cur.items = more ? cur.items.concat(r.items) : r.items;
    cur.more = r.more;
    if (!by && !more && r.latest) { markFeedSeen(r.latest); if (ui.data) ui.data.feedLatest = r.latest; }
  } catch (e) { cur.error = e.message; }
  cur.loading = false;
  if (["feed", "profile"].includes(currentPage())) render();
}

// Ganti satu item di semua daftar yang sedang dimuat.
function feedReplace(item, removedId) {
  for (const f of Object.values(ui.feeds || {})) {
    if (removedId) f.items = f.items.filter((x) => x.id !== removedId);
    else f.items = f.items.map((x) => (x.id === item.id ? item : x));
  }
}

async function loadFeedImages() {
  const cache = (ui.feedImgs ||= {});
  for (const el of document.querySelectorAll("img[data-feedimg]")) {
    const id = el.dataset.feedimg;
    if (cache[id]) { el.src = cache[id]; continue; }
    if (cache[id] === false) continue;
    cache[id] = false;
    api(`/api/feed/image?id=${encodeURIComponent(id)}`).then((r) => { cache[id] = r.image; document.querySelectorAll(`img[data-feedimg="${CSS.escape(id)}"]`).forEach((x) => { x.src = r.image; }); }).catch(() => { delete cache[id]; });
  }
  const covers = (ui.covers ||= {});
  for (const el of document.querySelectorAll("[data-cover]")) {
    const u = el.dataset.cover, ver = el.dataset.ver;
    const k = `${u}:${ver}`;
    if (covers[k]) { el.style.backgroundImage = `url("${covers[k]}")`; continue; }
    if (covers[k] === false) continue;
    covers[k] = false;
    api(`/api/profile/cover?u=${encodeURIComponent(u)}`).then((r) => { covers[k] = r.image; document.querySelectorAll(`[data-cover="${CSS.escape(u)}"]`).forEach((x) => { x.style.backgroundImage = `url("${r.image}")`; }); }).catch(() => { delete covers[k]; });
  }
}

// Foto postingan: sisi terpanjang 1600 px, JPEG, di bawah ~420 KB.
async function postImage(file, maxSide = 1600, maxLen = 420 * 1024) {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  for (let tries = 0; tries < 4; tries++) {
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.58]) {
      const url = c.toDataURL("image/jpeg", q);
      if (url.length < maxLen) return { url, w: c.width, h: c.height };
    }
    scale *= 0.75;
  }
  throw new Error("Foto terlalu besar. Coba foto lain.");
}
// Sampul profil: dipotong 3:1, lebar 1500 px.
async function coverImage(file) {
  const bmp = await createImageBitmap(file);
  const w = bmp.width, h = Math.min(bmp.height, Math.round(bmp.width / 3));
  const cw = Math.min(1500, w), ch = Math.round(cw / 3);
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const sw = Math.min(w, Math.round(bmp.height * 3)), sh = Math.round(sw / 3);
  c.getContext("2d").drawImage(bmp, (w - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, cw, ch);
  for (const q of [0.82, 0.7, 0.58, 0.45]) {
    const url = c.toDataURL("image/jpeg", q);
    if (url.length < 330 * 1024) return url;
  }
  void h;
  throw new Error("Foto sampul terlalu besar. Coba foto lain.");
}

function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.length > 60 ? u.slice(0, 57) + "…" : u}</a>`);
}

function postCard(p) {
  const me = ui.settings.user.username;
  const canDel = p.by === me || isLead();
  const editing = ui.form.editPost === p.id;
  const total = Object.values(p.reactions).reduce((a, b) => a + b, 0);
  const showAll = (ui.openComments || {})[p.id];
  const comments = showAll ? p.comments : p.comments.slice(-3);
  const auto = p.kind === "auto";
  const head = auto
    ? `<div class="post-head auto">${avatarLink(p.by, "sm")}<span class="auto-ic"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${AUTO_ICON[p.icon] || AUTO_ICON.info}</svg></span>
        <p class="auto-text">${nameLink(p.by)} ${esc(p.text)}</p><time title="${esc(new Date(p.at).toLocaleString("id-ID"))}">${esc(ago(p.at))}</time>
        ${canDel ? `<button class="icon-btn sm" data-pdel="${p.id}" aria-label="Hapus dari timeline" title="Hapus">×</button>` : ""}</div>`
    : `<div class="post-head">${avatarLink(p.by)}<div class="post-who">${nameLink(p.by)}<small>${esc(profileOf(p.by).title)} · <time title="${esc(new Date(p.at).toLocaleString("id-ID"))}">${esc(ago(p.at))}</time>${p.editedAt ? " · diubah" : ""}</small></div>
        <div class="post-tools">${p.by === me && !editing ? `<button class="linklike" data-pedit="${p.id}">Ubah</button>` : ""}${canDel ? `<button class="linklike" data-pdel="${p.id}">Hapus</button>` : ""}</div></div>`;
  const body = auto ? "" : editing
    ? `<textarea id="editText" rows="3" maxlength="2000">${esc(ui.form.editText ?? p.text)}</textarea>
       <div class="btns"><button class="btn inline" data-psave="${p.id}">Simpan</button><button class="btn secondary inline" data-act="cancelEdit">Batal</button></div>`
    : `${p.text ? `<p class="post-text">${linkify(p.text)}</p>` : ""}
       ${p.image ? `<button class="post-img" data-zoomimg="${p.id}" aria-label="Perbesar foto"><img data-feedimg="${p.id}" alt="Foto dari ${esc(profileOf(p.by).name)}" width="${p.image.w}" height="${p.image.h}"></button>` : ""}`;
  const whoReacted = (key) => Object.entries(p.reactors).filter(([, r]) => r === key).map(([u]) => profileOf(u).short).join(", ");
  return `<article class="post glass${auto ? " is-auto" : ""}" data-post="${p.id}">
    ${head}${body}
    <div class="post-react" role="group" aria-label="Reaksi">
      ${REACTS.map(([k, e, l]) => `<button class="react${p.mine === k ? " on" : ""}" data-react="${k}" data-pid="${p.id}" aria-pressed="${p.mine === k}" title="${esc(l)}${p.reactions[k] ? ": " + esc(whoReacted(k)) : ""}"><span aria-hidden="true">${e}</span>${p.reactions[k] ? `<b>${p.reactions[k]}</b>` : `<span class="sr">${esc(l)}</span>`}</button>`).join("")}
      <span class="react-sum">${total ? `${total} reaksi` : ""}${total && p.comments.length ? " · " : ""}${p.comments.length ? `${p.comments.length} komentar` : ""}</span>
    </div>
    ${p.comments.length > 3 && !showAll ? `<button class="linklike more-cm" data-allcm="${p.id}">Lihat ${p.comments.length - 3} komentar sebelumnya</button>` : ""}
    ${comments.length ? `<ul class="comments">${comments.map((c) => `<li>${avatarLink(c.by, "sm")}<div class="cm-bubble">${nameLink(c.by)}<p>${linkify(c.text)}</p></div>
      <small>${esc(ago(c.at))}${c.by === me || isLead() ? ` · <button class="linklike" data-cdel="${c.id}" data-pid="${p.id}">Hapus</button>` : ""}</small></li>`).join("")}</ul>` : ""}
    <div class="cm-new">${avatar(me, "sm")}<input type="text" data-cm="${p.id}" maxlength="500" placeholder="Tulis komentar…" aria-label="Tulis komentar" value="${esc((ui.form.cm || {})[p.id] || "")}"><button class="btn inline" data-cmsend="${p.id}">Kirim</button></div>
  </article>`;
}

function feedList(key) {
  const f = (ui.feeds || {})[key];
  if (!f || (!f.items.length && f.loading)) return `<p class="empty">Memuat timeline…</p>`;
  if (f.error && !f.items.length) return `<p class="msg err">${esc(f.error)}</p><button class="btn secondary" data-act="feedRetry">Coba lagi</button>`;
  if (!f.items.length) return `<p class="all-clear">Belum ada aktivitas di sini.</p>`;
  return f.items.map(postCard).join("") + (f.more ? `<button class="btn secondary" data-act="feedMore" ${f.loading ? "disabled" : ""}>${f.loading ? "Memuat…" : "Muat lebih lama"}</button>` : "");
}

function composer() {
  const me = ui.settings.user.username;
  const f = ui.form;
  const first = profileOf(me).short;
  return `<section class="composer glass">
    <div class="comp-row">${avatar(me)}<textarea id="postText" rows="${f.postText ? 3 : 2}" maxlength="2000" placeholder="Apa yang lagi dikerjakan, ${esc(first)}?" aria-label="Tulis postingan">${esc(f.postText || "")}</textarea></div>
    ${f.postImg ? `<div class="comp-preview"><img src="${f.postImg.url}" alt="Pratinjau foto"><button class="icon-btn sm" data-act="dropImg" aria-label="Hapus foto">×</button></div>` : ""}
    <div class="comp-actions">
      <label class="btn secondary inline comp-photo"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${AUTO_ICON.design}</svg>Foto<input type="file" id="postFile" accept="image/png,image/jpeg,image/webp" hidden></label>
      ${f.postMsg ? `<span class="msg-inline ${f.postMsgType}" role="status">${esc(f.postMsg)}</span>` : ""}
      <button class="btn inline" data-act="sendPost" ${f.posting ? "disabled" : ""}>${f.posting ? "Mengirim…" : "Posting"}</button>
    </div>
  </section>`;
}

function feedView() {
  if (!(ui.feeds || {}).all) loadFeed();
  const team = ((ui.data && ui.data.team) || []);
  return `<div class="feed-layout"><div class="feed-wrap">${composer()}<div class="feed">${feedList("all")}</div></div>
    <aside class="feed-side glass" aria-label="Tim creative"><h3>Tim creative</h3>
      ${team.map((t) => `<button class="side-person" data-prof="${esc(t.username)}">${avatar(t.username, "sm")}<span><b>${esc(profileOf(t.username).name)}</b><small>${esc(profileOf(t.username).title)}</small></span></button>`).join("")}
    </aside></div>`;
}

function teamView() {
  const team = ((ui.data && ui.data.team) || []).slice().sort((a, b) => (a.member === "ray" ? -1 : b.member === "ray" ? 1 : a.name.localeCompare(b.name)));
  return `<div class="team-grid">${team.map((t) => {
    const p = profileOf(t.username);
    return `<button class="team-card glass" data-prof="${esc(t.username)}">
      <span class="cover sm${p.coverVer ? " has" : ""}" ${p.coverVer ? `data-cover="${esc(t.username)}" data-ver="${p.coverVer}"` : ""}></span>
      ${avatar(t.username, "lg")}
      <b>${esc(p.name)}</b><small>${esc(p.title)}</small>
      ${p.bio ? `<span class="team-bio">${esc(p.bio)}</span>` : ""}
    </button>`;
  }).join("")}</div>`;
}

function profileView() {
  const u = ui.profileUser || ui.settings.user.username;
  const p = profileOf(u);
  const mine = u === ui.settings.user.username;
  const f = ui.form;
  if (!(ui.feeds || {})[`p:${u}`]) loadFeed({ by: u });
  const editor = f.editProfile ? `<div class="prof-edit glass">
      <label for="pTitle">Jabatan</label><input type="text" id="pTitle" maxlength="60" value="${esc(f.pTitle ?? p.title)}">
      <label for="pBio">Bio</label><textarea id="pBio" rows="3" maxlength="300" placeholder="Ceritakan sedikit tentang kamu">${esc(f.pBio ?? p.bio)}</textarea>
      <div class="btns"><label class="btn secondary inline">${f.coverBusy ? "Mengunggah…" : "Ganti foto sampul"}<input type="file" id="coverFile" accept="image/png,image/jpeg,image/webp" hidden></label>
        ${p.coverVer ? `<button class="btn secondary inline" data-act="coverDel">Hapus sampul</button>` : ""}
        <button class="btn secondary inline" data-act="settings">Ganti foto profil</button></div>
      <div class="btns"><button class="btn inline" data-act="saveProfile" ${f.profBusy ? "disabled" : ""}>${f.profBusy ? "Menyimpan…" : "Simpan profil"}</button><button class="btn secondary inline" data-act="cancelProfile">Batal</button></div>
      ${f.profMsg ? `<p class="msg ${f.profMsgType}" role="status">${esc(f.profMsg)}</p>` : ""}
    </div>` : "";
  return `<div class="profile">
    <section class="prof-head glass">
      <div class="cover${p.coverVer ? " has" : ""}" ${p.coverVer ? `data-cover="${esc(u)}" data-ver="${p.coverVer}"` : ""}></div>
      <div class="prof-id">${avatar(u, "xl")}
        <div class="prof-name"><h2>${esc(p.name)}</h2><p>${esc(p.title)}</p></div>
        ${mine && !f.editProfile ? `<button class="btn secondary inline" data-act="editProfile">Edit profil</button>` : ""}
      </div>
      ${p.bio ? `<p class="prof-bio">${esc(p.bio)}</p>` : mine ? `<p class="prof-bio hint">Belum ada bio. Klik Edit profil untuk menambahkan.</p>` : ""}
    </section>
    ${editor}
    <h2 class="feed-title">Aktivitas ${esc(p.short)}</h2>
    <div class="feed">${feedList(`p:${u}`)}</div>
  </div>`;
}

function bindFeedCommon() {
  bindCommon();
  loadFeedImages();
  const key = currentPage() === "profile" ? `p:${ui.profileUser || ui.settings.user.username}` : "all";
  const by = key.startsWith("p:") ? key.slice(2) : "";
  document.querySelectorAll("[data-prof]").forEach((b) => b.addEventListener("click", () => openProfile(b.dataset.prof)));
  on("feedRetry", () => { delete ui.feeds[key]; loadFeed({ by }); render(); });
  on("feedMore", () => loadFeed({ more: true, by }));
  const run = async (fn) => { try { const r = await fn(); if (r.deleted) feedReplace(null, r.deleted); else feedReplace(r.item); } catch (e) { alertMsg(e.message); } render(); };
  document.querySelectorAll("[data-react]").forEach((b) => b.addEventListener("click", () => run(() => api("/api/feed/react", { id: b.dataset.pid, reaction: b.dataset.react }))));
  document.querySelectorAll("[data-pdel]").forEach((b) => b.addEventListener("click", () => { if (confirmInline(b, "Yakin hapus?")) run(() => api("/api/feed/delete", { id: b.dataset.pdel })); }));
  document.querySelectorAll("[data-cdel]").forEach((b) => b.addEventListener("click", () => { if (confirmInline(b, "Yakin?")) run(() => api("/api/feed/delete", { id: b.dataset.pid, commentId: b.dataset.cdel })); }));
  document.querySelectorAll("[data-allcm]").forEach((b) => b.addEventListener("click", () => { (ui.openComments ||= {})[b.dataset.allcm] = true; render(); }));
  document.querySelectorAll("[data-pedit]").forEach((b) => b.addEventListener("click", () => { ui.form.editPost = b.dataset.pedit; ui.form.editText = undefined; render(); }));
  on("cancelEdit", () => { ui.form.editPost = ""; render(); });
  const et = $("editText");
  if (et) { et.addEventListener("input", () => { ui.form.editText = et.value; }); et.focus(); }
  document.querySelectorAll("[data-psave]").forEach((b) => b.addEventListener("click", () => { const text = ui.form.editText ?? $("editText").value; ui.form.editPost = ""; run(() => api("/api/feed/edit", { id: b.dataset.psave, text })); }));
  document.querySelectorAll("[data-cm]").forEach((inp) => {
    inp.addEventListener("input", () => { (ui.form.cm ||= {})[inp.dataset.cm] = inp.value; });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendComment(inp.dataset.cm); } });
  });
  document.querySelectorAll("[data-cmsend]").forEach((b) => b.addEventListener("click", () => sendComment(b.dataset.cmsend)));
  async function sendComment(pid) {
    const text = ((ui.form.cm || {})[pid] || "").trim();
    if (!text) return;
    try { const r = await api("/api/feed/comment", { id: pid, text }); ui.form.cm[pid] = ""; (ui.openComments ||= {})[pid] = true; feedReplace(r.item); }
    catch (e) { alertMsg(e.message); }
    render();
    const again = document.querySelector(`[data-cm="${CSS.escape(pid)}"]`);
    if (again) again.focus();
  }
  document.querySelectorAll("[data-zoomimg]").forEach((b) => b.addEventListener("click", () => {
    const src = (ui.feedImgs || {})[b.dataset.zoomimg];
    if (src) showZoom(src);
  }));
}

// Pesan singkat di atas daftar, tanpa dialog bawaan browser.
function alertMsg(text) { ui.feedErr = text; setTimeout(() => { ui.feedErr = ""; render(); }, 5000); }
// Konfirmasi dua klik: klik pertama mengubah tombol jadi "Yakin?", klik kedua menjalankan.
function confirmInline(btn, label) {
  if (btn.dataset.armed) return true;
  const orig = btn.textContent;
  btn.dataset.armed = "1"; btn.textContent = label; btn.classList.add("danger");
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = orig; btn.classList.remove("danger"); } }, 3000);
  return false;
}
function showZoom(src) {
  const z = document.createElement("div");
  z.className = "zoom"; z.tabIndex = -1;
  z.innerHTML = `<img src="${src}" alt="Foto postingan">`;
  const close = () => { z.remove(); document.removeEventListener("keydown", esc2); };
  const esc2 = (e) => { if (e.key === "Escape") close(); };
  z.addEventListener("click", close); document.addEventListener("keydown", esc2);
  document.body.appendChild(z); z.focus();
}

function bindFeed() {
  bindFeedCommon();
  const t = $("postText");
  if (t) t.addEventListener("input", () => { ui.form.postText = t.value; if (t.rows < 3 && t.value) t.rows = 3; });
  const file = $("postFile");
  if (file) file.addEventListener("change", async () => {
    const f0 = file.files && file.files[0];
    if (!f0) return;
    try { ui.form.postImg = await postImage(f0); ui.form.postMsg = ""; } catch (e) { ui.form.postMsg = e.message; ui.form.postMsgType = "err"; }
    render();
  });
  on("dropImg", () => { ui.form.postImg = null; render(); });
  on("sendPost", async () => {
    const text = (ui.form.postText || "").trim();
    if (!text && !ui.form.postImg) { ui.form.postMsg = "Tulis sesuatu atau pilih foto dulu."; ui.form.postMsgType = "err"; return render(); }
    ui.form.posting = true; render();
    try {
      const img = ui.form.postImg;
      const r = await api("/api/feed/post", { text, ...(img ? { image: img.url, w: img.w, h: img.h } : {}) });
      if (img) (ui.feedImgs ||= {})[r.item.id] = img.url;
      ui.feeds.all.items.unshift(r.item);
      markFeedSeen(r.item.at);
      ui.form = {};
    } catch (e) { ui.form.posting = false; ui.form.postMsg = e.message; ui.form.postMsgType = "err"; }
    render();
  });
}

function bindTeam() {
  bindCommon();
  loadFeedImages();
  document.querySelectorAll("[data-prof]").forEach((b) => b.addEventListener("click", () => openProfile(b.dataset.prof)));
}

function bindProfile() {
  bindFeedCommon();
  const f = ui.form;
  on("editProfile", () => { ui.form = { editProfile: true }; render(); });
  on("cancelProfile", () => { ui.form = {}; render(); });
  const t = $("pTitle"), b = $("pBio");
  if (t) t.addEventListener("input", () => { f.pTitle = t.value; });
  if (b) b.addEventListener("input", () => { f.pBio = b.value; });
  const saveProf = async (patch, msg) => {
    try {
      const r = await api("/api/me/profile", patch);
      const team = (ui.data && ui.data.team) || [];
      const i = team.findIndex((x) => x.username === r.profile.username);
      if (i >= 0) team[i] = { ...team[i], ...r.profile };
      return r;
    } catch (e) { f.profMsg = e.message; f.profMsgType = "err"; throw e; }
    finally { void msg; }
  };
  on("saveProfile", async () => {
    f.profBusy = true; render();
    try { await saveProf({ title: f.pTitle ?? profileOf(ui.settings.user.username).title, bio: f.pBio ?? profileOf(ui.settings.user.username).bio }); ui.form = {}; } catch { f.profBusy = false; }
    render();
  });
  const cf = $("coverFile");
  if (cf) cf.addEventListener("change", async () => {
    const f0 = cf.files && cf.files[0];
    if (!f0) return;
    f.coverBusy = true; render();
    try { const cover = await coverImage(f0); const r = await saveProf({ cover }); (ui.covers ||= {})[`${r.profile.username}:${r.profile.coverVer}`] = cover; f.profMsg = "Foto sampul diganti."; f.profMsgType = "ok"; }
    catch (e) { f.profMsg = e.message; f.profMsgType = "err"; }
    f.coverBusy = false; render();
  });
  on("coverDel", async () => { try { await saveProf({ cover: "" }); f.profMsg = "Foto sampul dihapus."; f.profMsgType = "ok"; } catch { /* pesan sudah diisi */ } render(); });
}

function openProfile(username) {
  ui.profileUser = username;
  goPage("profile");
}

// ---------- Login ----------
function loginView() {
  const f = ui.form;
  const s = ui.settings;
  return `<div class="pad login">
    <img class="login-logo" src="logo.png" alt="" width="56" height="56">
    <h2>Masuk ke Creative AAB</h2>
    <p class="hint gap-below">Username dan password dibuat oleh Ray.</p>
    <label for="lUser">Username</label><input type="text" id="lUser" value="${esc(f.lUser || "")}" autocomplete="username" autocapitalize="off" spellcheck="false">
    <label for="lPass">Password</label><input type="password" id="lPass" value="${esc(f.lPass || "")}" autocomplete="current-password">
    <button class="btn" data-act="doLogin" ${f.busy ? "disabled" : ""}>${f.busy ? "Masuk…" : "Masuk"}</button>
    ${f.showServer ? `<label for="lUrl">Alamat server</label><input type="url" id="lUrl" value="${esc(f.lUrl ?? s.serverUrl)}">` : `<p class="hint"><button class="linklike" data-act="showServer">Ubah alamat server</button></p>`}
    ${f.msg ? `<p class="msg ${f.msgType}" role="status">${esc(f.msg)}</p>` : ""}
  </div>`;
}

function bindLogin() {
  keep(["lUser", "lPass", "lUrl"]);
  on("showServer", () => { ui.form.showServer = true; render(); });
  const go = async () => {
    const username = (ui.form.lUser || "").trim().toLowerCase();
    const password = ui.form.lPass || "";
    const url = (ui.form.lUrl ?? ui.settings.serverUrl).trim().replace(/\/+$/, "");
    if (!username || !password) return setMsg("Isi username dan password.", "err");
    if (!/^https:\/\//.test(url) && !/^http:\/\/localhost/.test(url)) return setMsg("Alamat server harus diawali https://", "err");
    ui.form.busy = true; ui.form.msg = ""; render();
    try {
      ui.settings = { ...ui.settings, serverUrl: url, token: "" };
      const res = await api("/api/login", { username, password });
      ui.settings = await window.aab.saveSettings({ serverUrl: url, token: res.token, user: res.user });
      ui.form = {}; ui.tab = isFull() ? "home" : "request"; ui.view = "list"; ui.filter = null;
      await loadState();
    } catch (e) {
      ui.form.busy = false; ui.form.lPass = ""; setMsg(e.message, "err");
    }
  };
  on("doLogin", go);
  ["lUser", "lPass"].forEach((id) => { const el = $(id); if (el) el.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); });
  const first = $(ui.form.lUser ? "lPass" : "lUser");
  if (first) first.focus();
}

// ---------- Pengaturan ----------
function updateBox() {
  const u = ui.update || {};
  const f = ui.form;
  const cur = u.current ? `Versi ${esc(u.current)}` : "Versi";
  let line = "";
  let btn = `<button class="btn secondary" data-act="checkUpdate" ${f.checking ? "disabled" : ""}>${f.checking ? "Mengecek…" : "Cek pembaruan"}</button>`;
  if (u.state === "dev") { line = "Update otomatis hanya jalan di aplikasi hasil installer."; btn = ""; }
  else if (u.state === "checking") line = "Mengecek pembaruan…";
  else if (u.state === "latest") line = "Sudah versi terbaru.";
  else if (u.state === "downloading") { line = `Mengunduh versi ${esc(u.version)}… ${u.progress || 0}%`; btn = ""; }
  else if (u.state === "ready") { line = `Versi ${esc(u.version)} sudah diunduh.`; btn = `<button class="btn" data-act="installUpdate">Pasang dan restart</button>`; }
  else if (u.state === "error") line = `Cek pembaruan gagal: ${esc(u.error || "tidak diketahui")}`;
  return `<div class="section">
    <h2>Aplikasi</h2>
    <p class="hint">${cur}. ${line}</p>
    ${btn}
  </div>`;
}

function settingsView() {
  const s = ui.settings;
  const f = ui.form;
  const u = s.user || {};
  const lead = isLead();
  const account = `<p class="hint">Masuk sebagai <b>${esc(u.username)}</b> (${esc(u.name || "")}). <button class="linklike" data-act="logout">Keluar</button></p>`;
  if (isFull()) {
    // Jendela penuh: kiri tampilan dan akun, kanan pengaturan kerja.
    return `<div class="settings-grid">
      <div class="page-card"><div class="pad"><h2>Tampilan</h2>${account}${lookSection()}</div></div>
      <div class="page-card"><div class="pad">${settingsWork(f, lead)}</div></div>
    </div>`;
  }
  return `<div class="pad">
    <button class="back" data-act="back">← Kembali</button>
    <h2>Pengaturan</h2>
    ${account}
    ${lookSection()}
    ${settingsWork(f, lead)}
  </div>`;
}

function settingsWork(f, lead) {
  return `${updateBox()}
    ${lead ? `<div class="section">
      <h2>Link sheet bulan ini</h2>
      <p class="hint">Tiap awal bulan, setelah file baru diduplikat dan app ditambahkan ke file, tempel link file baru di sini.</p>
      <label for="sSheet">Link sheet Lark</label><input type="url" id="sSheet" value="${esc(f.sSheet || "")}" placeholder="https://....larksuite.com/sheets/...">
      <button class="btn" data-act="saveSheet" ${f.busySheet ? "disabled" : ""}>${f.busySheet ? "Mengecek file…" : "Pakai file ini"}</button>
    </div>
    ${googleSettings()}
    ${igSettings()}
    <div class="section">
      <h2>Akun tim</h2>
      <p class="hint">Buat akun, reset password, atau nonaktifkan akun anggota tim.</p>
      <button class="btn secondary" data-act="openAccounts">Kelola akun tim</button>
    </div>` : ""}
    <div class="section">
      <h2>Ganti password</h2>
      ${f.pwOpen ? `<label for="pOld">Password sekarang</label><input type="password" id="pOld" value="${esc(f.pOld || "")}" autocomplete="current-password">
        <label for="pNew">Password baru (minimal 8 karakter)</label><input type="password" id="pNew" value="${esc(f.pNew || "")}" autocomplete="new-password">
        <div class="row2"><button class="btn secondary" data-act="pwCancel">Batal</button><button class="btn" data-act="pwSave" ${f.busyPw ? "disabled" : ""}>${f.busyPw ? "Menyimpan…" : "Simpan"}</button></div>`
        : `<button class="btn secondary" data-act="pwOpen">Ganti password</button>`}
    </div>
    ${f.msg ? `<p class="msg ${f.msgType}" role="status">${f.msgHtml ? f.msg : esc(f.msg)}</p>` : ""}`;
}

function googleSettings() {
  const g = ui.gcfg;
  const f = ui.form;
  if (!g) return `<div class="section"><h2>Content Calendar dan EP</h2><p class="hint">Memuat…</p></div>`;
  return `<div class="section">
    <h2>Content Calendar dan EP</h2>
    ${g.serviceAccount ? `<p class="hint">Tiap file baru dibagikan sebagai <b>Editor</b> ke email ini:</p>
      <div class="row-link"><input type="text" id="saEmail" value="${esc(g.serviceAccount)}" readonly><button class="btn secondary inline" data-act="copySa">Salin</button></div>`
      : `<p class="msg info">Akses Google belum diatur di server (secret GOOGLE_SA). Lihat panduan.</p>`}
    <p class="hint">Sekarang: ${g.calendar ? esc(g.calendar.title) : "kalender belum diisi"}; ${g.ep ? esc(g.ep.title) : "EP belum diisi"}.</p>
    <label for="gCal">Link Content Calendar (Google Sheets)</label><input type="url" id="gCal" value="${esc(f.gCal || "")}" placeholder="https://docs.google.com/spreadsheets/d/...">
    <label for="gEp">Link EP (Google Slides)</label><input type="url" id="gEp" value="${esc(f.gEp || "")}" placeholder="https://docs.google.com/presentation/d/...">
    <button class="btn" data-act="saveGoogle" ${f.busyG || !g.serviceAccount ? "disabled" : ""}>${f.busyG ? "Mengecek file…" : "Pakai link ini"}</button>
  </div>`;
}

function bindSettings() {
  bindCommon();
  bindLook();
  bindIgSettings();
  keep(["sSheet", "pOld", "pNew", "gCal", "gEp"]);
  if (isLead() && !ui.gcfg) api("/api/google").then((g) => { ui.gcfg = g; if (ui.view === "settings") render(); }).catch((e) => { ui.gcfg = { serviceAccount: "" }; ui.form.msg = e.message; ui.form.msgType = "err"; render(); });
  on("copySa", () => { const el = $("saEmail"); el.select(); navigator.clipboard.writeText(el.value).catch(() => document.execCommand("copy")); setMsg("Email service account disalin.", "ok"); });
  on("saveGoogle", async () => {
    const calendarUrl = (ui.form.gCal || "").trim();
    const epUrl = (ui.form.gEp || "").trim();
    if (!calendarUrl && !epUrl) return setMsg("Tempel minimal satu link.", "err");
    ui.form.busyG = true; render();
    try {
      const res = await api("/api/google", { calendarUrl, epUrl });
      ui.gcfg = res;
      const parts = [];
      if (calendarUrl) parts.push(`Kalender: ${res.calendar.tabs.map((t) => t.account).join(" dan ")}, ${res.calendarRows} baris.`);
      if (epUrl) parts.push(`EP: ${res.epItems} konten.`);
      ui.form = { msg: `Tersimpan. ${parts.join(" ")}${(res.warnings || []).map((w) => ` ${w}`).join("")}`, msgType: "ok" };
      await loadState();
    } catch (e) { ui.form.busyG = false; ui.form.msg = e.message; ui.form.msgType = "err"; }
    render();
  });
  on("logout", () => logout(""));
  on("openAccounts", () => { ui.view = "accounts"; ui.form = {}; ui.accounts = null; render(); loadAccounts(); });
  const login = $("sLogin");
  if (login) login.addEventListener("change", async () => { ui.settings = await window.aab.saveSettings({ openAtLogin: login.checked }); });
  on("checkUpdate", async () => {
    ui.form.checking = true; render();
    ui.update = await window.aab.checkUpdate();
    ui.form.checking = false; render();
  });
  on("installUpdate", () => window.aab.installUpdate());
  on("pwOpen", () => { ui.form.pwOpen = true; render(); });
  on("pwCancel", () => { ui.form = {}; render(); });
  on("pwSave", async () => {
    const f = ui.form;
    if ((f.pNew || "").length < 8) return setMsg("Password baru minimal 8 karakter.", "err");
    f.busyPw = true; render();
    try {
      const res = await api("/api/password", { old: f.pOld || "", password: f.pNew });
      ui.settings = await window.aab.saveSettings({ token: res.token });
      ui.form = { msg: "Password diganti.", msgType: "ok" };
      render();
    } catch (e) { f.busyPw = false; setMsg(e.message, "err"); }
  });
  on("saveSheet", async () => {
    const url = (ui.form.sSheet || "").trim();
    if (!/\/sheets\//.test(url)) return setMsg("Tempel link sheet Lark yang berisi /sheets/.", "err");
    ui.form.busySheet = true; render();
    try {
      const res = await api("/api/config", { url });
      ui.data = res;
      const warn = (res.warnings || []).map((w) => `<br>• ${esc(w)}`).join("");
      ui.form = { msg: `File bulan ini tersimpan. ${res.requests.length} request terbaca.${warn}`, msgHtml: true, msgType: warn ? "info" : "ok" };
      await checkNewRequests(res.requests || []);
    } catch (e) { ui.form.busySheet = false; setMsg(e.message, "err"); }
    render();
  });
}

// ---------- Akun tim (Ray) ----------
async function loadAccounts() {
  try { ui.accounts = await api("/api/accounts"); } catch (e) { ui.form.msg = e.message; ui.form.msgType = "err"; }
  render();
}

const randomPassword = () => {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(b, (x) => abc[x % abc.length]).join("");
};

function accountsView() {
  const f = ui.form;
  const data = ui.accounts;
  const head = `<button class="back" data-act="toSettings">← Pengaturan</button><h2>Akun tim</h2>`;
  if (!data) return `<div class="pad">${head}<p class="empty">Memuat akun…</p>${f.msg ? `<p class="msg ${f.msgType}">${esc(f.msg)}</p>` : ""}</div>`;
  const list = data.accounts;
  const used = new Set(list.map((a) => a.member));
  const free = MEMBERS.filter((m) => m.id !== "ray" && !used.has(m.id));
  const rows = list
    .map((a) => {
      const editing = f.resetFor === a.username;
      return `<li class="acc${a.active ? "" : " acc-off"}">
        <div class="acc-head"><b>${esc(a.username)}</b><span>${esc(a.name)}${a.active ? "" : ", nonaktif"}</span></div>
        ${editing ? `<label for="rPass">Password baru untuk ${esc(a.username)}</label>
          <div class="row-link"><input type="text" id="rPass" value="${esc(f.rPass || "")}" autocomplete="off" spellcheck="false"><button class="btn secondary inline" data-act="rRandom">Acak</button></div>
          <div class="row2"><button class="btn secondary" data-act="rCancel">Batal</button><button class="btn" data-act="rSave" ${f.busy ? "disabled" : ""}>Simpan password</button></div>`
        : `<div class="acc-actions">
          <button class="linklike" data-reset="${esc(a.username)}">Reset password</button>
          ${a.username === "ray" ? "" : `<button class="linklike" data-toggle="${esc(a.username)}" data-on="${a.active ? "0" : "1"}">${a.active ? "Nonaktifkan" : "Aktifkan"}</button>
          <button class="linklike" data-del="${esc(a.username)}">Hapus</button>`}
        </div>`}
        ${f.confirmDel === a.username ? `<p class="msg info">Hapus akun ${esc(a.username)}? Laptop yang memakai akun ini langsung keluar. Data di sheet tidak terhapus.</p>
          <div class="row2"><button class="btn secondary" data-act="delCancel">Batal</button><button class="btn" data-act="delYes">Ya, hapus</button></div>` : ""}
      </li>`;
    })
    .join("");
  const form = free.length
    ? `<div class="section">
      <h2>Tambah akun</h2>
      <label for="nMember">Anggota tim</label>
      <select id="nMember">${free.map((m) => `<option value="${m.id}" ${f.nMember === m.id ? "selected" : ""}>${esc(m.name)} (${esc(m.block)})</option>`).join("")}</select>
      <label for="nUser">Username</label><input type="text" id="nUser" value="${esc(f.nUser || "")}" placeholder="contoh: zahra" autocapitalize="off" spellcheck="false">
      <label for="nPass">Password awal</label>
      <div class="row-link"><input type="text" id="nPass" value="${esc(f.nPass || "")}" autocomplete="off" spellcheck="false"><button class="btn secondary inline" data-act="nRandom">Acak</button></div>
      <p class="hint">Kirim username dan password ke orangnya lewat chat pribadi. Password minimal 8 karakter.</p>
      <button class="btn" data-act="nSave" ${f.busy ? "disabled" : ""}>${f.busy ? "Menyimpan…" : "Buat akun"}</button>
    </div>`
    : `<p class="hint section">Semua anggota tim sudah punya akun.</p>`;
  return `<div class="pad">${head}
    <ul class="acc-list">${rows}</ul>
    ${form}
    ${f.msg ? `<p class="msg ${f.msgType}" role="status">${esc(f.msg)}</p>` : ""}
  </div>`;
}

function bindAccounts() {
  keep(["nUser", "nPass", "rPass"]);
  const sel = $("nMember");
  if (sel) {
    if (!ui.form.nMember) ui.form.nMember = sel.value;
    sel.addEventListener("change", () => { ui.form.nMember = sel.value; });
  }
  on("toSettings", () => { ui.view = "settings"; ui.form = {}; render(); });
  on("nRandom", () => { ui.form.nPass = randomPassword(); render(); });
  on("rRandom", () => { ui.form.rPass = randomPassword(); render(); });
  const save = async (body, okMsg) => {
    ui.form.busy = true; ui.form.msg = ""; render();
    try {
      await api("/api/accounts/save", body);
      ui.form = { msg: okMsg, msgType: "ok" };
      ui.accounts = await api("/api/accounts");
    } catch (e) { ui.form.busy = false; ui.form.msg = e.message; ui.form.msgType = "err"; }
    render();
  };
  on("nSave", () => {
    const f = ui.form;
    const username = (f.nUser || "").trim().toLowerCase();
    if (!username) return setMsg("Isi username.", "err");
    if ((f.nPass || "").length < 8) return setMsg("Password minimal 8 karakter.", "err");
    save({ username, member: f.nMember, password: f.nPass }, `Akun ${username} dibuat. Password: ${f.nPass}`);
  });
  document.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", () => { ui.form = { resetFor: b.dataset.reset, rPass: randomPassword() }; render(); }));
  on("rCancel", () => { ui.form = {}; render(); });
  on("rSave", () => {
    const f = ui.form;
    if ((f.rPass || "").length < 8) return setMsg("Password minimal 8 karakter.", "err");
    const self = f.resetFor === (ui.settings.user && ui.settings.user.username);
    save({ username: f.resetFor, password: f.rPass }, `Password ${f.resetFor} diganti: ${f.rPass}. Laptop yang memakai akun ini perlu login ulang.`)
      .then(() => { if (self && ui.form.msgType === "ok") logout("Password akunmu diganti. Login lagi dengan password baru."); });
  });
  document.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", () => save({ username: b.dataset.toggle, active: b.dataset.on === "1" }, b.dataset.on === "1" ? `Akun ${b.dataset.toggle} aktif lagi.` : `Akun ${b.dataset.toggle} dinonaktifkan dan langsung keluar dari laptopnya.`))
  );
  document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { ui.form = { confirmDel: b.dataset.del }; render(); }));
  on("delCancel", () => { ui.form = {}; render(); });
  on("delYes", async () => {
    const username = ui.form.confirmDel;
    try {
      await api("/api/accounts/delete", { username });
      ui.form = { msg: `Akun ${username} dihapus.`, msgType: "ok" };
      ui.accounts = await api("/api/accounts");
    } catch (e) { ui.form = { msg: e.message, msgType: "err" }; }
    render();
  });
}

// ---------- Komponen ----------
function dropZone(id, title, sub, accept = "image/*") {
  return `<button type="button" class="drop" id="${id}" aria-label="${esc(title)}"><strong>${esc(title)}</strong><span>${esc(sub)}</span></button>
    <input type="file" id="${id}-file" accept="${accept}" hidden>
    ${accept === "image/*" && ui.form[id] ? imagePreview(ui.form[id], id) : ""}`;
}

function imagePreview(img, id) {
  return `<div class="preview"><img src="${esc(img.url)}" alt="Pratinjau gambar yang akan dikirim">
    <div class="preview-bar"><span>${esc(img.label || "Gambar")}, ${Math.round((img.base64.length * 0.75) / 1024)} KB</span>
    <span>${id === "vImg" && ui.form.vLink ? `<button class="linklike" data-act="retake">Ambil ulang</button> · ` : ""}<button class="linklike" data-act="clear-${id}">Hapus</button></span></div></div>`;
}

// onImage: dipanggil dengan gambar yang sudah dikompres. onFile: dipanggil dengan File mentah (untuk xlsx).
function bindDrop(id, onImage, onFile) {
  const zone = $(id);
  const input = $(`${id}-file`);
  on(`clear-${id}`, () => { ui.form[id] = null; render(); });
  if (!zone) return;
  const take = async (file) => {
    if (!file) return;
    if (onFile) return onFile(file);
    if (!file.type.startsWith("image/")) return setMsg("File harus gambar (PNG atau JPG).", "err");
    try { onImage({ ...(await compressImage(file)), label: file.name }); } catch (e) { setMsg(e.message, "err"); }
  };
  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => take(input.files[0]));
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); take(e.dataTransfer.files[0]); });
  if (onImage) {
    document.onpaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (item) take(item.getAsFile());
    };
  }
}

// Kecilkan gambar: lebar maksimal 1280 px, JPEG kualitas 75%.
async function compressImage(file) {
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("Gambar tidak bisa dibaca."); });
  const scale = Math.min(1, 1280 / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.75);
  return { url, base64: url.split(",")[1] };
}

function keep(ids) {
  ids.forEach((k) => { const el = $(k); if (el) el.addEventListener("input", () => { ui.form[k] = el.value; }); });
}
function on(act, fn) {
  document.querySelectorAll(`[data-act="${act}"]`).forEach((b) => b.addEventListener("click", fn));
}
function setMsg(msg, type) {
  ui.form.msg = msg; ui.form.msgType = type; ui.form.msgHtml = false; render();
}
function bindCommon() {
  on("retry", () => loadState());
  on("settings", () => { ui.view = "settings"; ui.form = {}; render(); });
  on("back", () => { ui.view = "list"; ui.form = {}; render(); });
}

// ---------- Mulai ----------
async function init() {
  ui.settings = await window.aab.getSettings();
  ui.win = await window.aab.windowInfo();
  ui.photos = photoCache();
  if (isFull()) ui.tab = "home";
  applyTheme();
  $("btnMode").addEventListener("click", () => setMode("full"));
  $("btnMax").addEventListener("click", () => window.aab.toggleMaximize());
  $("tabRequest").addEventListener("click", () => { ui.tab = "request"; ui.view = "list"; ui.form = {}; render(); });
  $("tabInput").addEventListener("click", () => { ui.tab = "input"; ui.view = "list"; ui.form = {}; render(); if (isLead()) loadState(); });
  $("tabEp").addEventListener("click", () => { ui.tab = "ep"; ui.view = "list"; ui.form = {}; render(); });
  $("tabCal").addEventListener("click", () => { ui.tab = "cal"; ui.view = "list"; ui.form = {}; render(); });
  $("btnSettings").addEventListener("click", () => { if (!configured()) return; ui.view = "settings"; ui.form = {}; render(); });
  ui.update = await window.aab.getUpdate();
  window.aab.onUpdate((u) => { ui.update = u; renderBar(); if (ui.view === "settings") render(); });
  $("btnRefresh").addEventListener("click", () => loadState({ refresh: true }));
  $("btnHide").addEventListener("click", () => window.aab.hide());
  $("btnPin").addEventListener("click", async () => { ui.settings = await window.aab.saveSettings({ pinned: !ui.settings.pinned }); renderBar(); });
  window.aab.onOpenRequest((id) => {
    if (String(id || "").startsWith("ep:")) { ui.tab = "ep"; ui.epOpen = id.slice(3); ui.view = "detail"; ui.form = {}; render(); return; }
    ui.tab = "request";
    ui.openId = id;
    ui.view = id ? "detail" : "list";
    ui.form = {};
    render();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.view !== "list" && configured()) { ui.view = "list"; ui.form = {}; render(); }
  });
  render();
  await loadState();
  setInterval(() => loadState(), POLL_MS);
  window.addEventListener("focus", () => { if (!ui.loading && Date.now() - (ui.lastLoad || 0) > FOCUS_MIN_MS) loadState(); });
}

init();
