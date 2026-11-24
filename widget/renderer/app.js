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
const KATEGORI = ["Reels/VT", "Carousel"];
const POLL_MS = 2 * 60 * 1000;

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
  const data = await res.json().catch(() => ({ ok: false, error: `Server membalas HTTP ${res.status}.` }));
  if (res.status === 401 && path !== "/api/login" && ui.settings.token) {
    await logout("Sesi habis atau akun diubah Ray. Login lagi.");
    throw new Error("Sesi habis. Login lagi.");
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Server membalas HTTP ${res.status}.`);
  return data;
}

async function logout(msg) {
  ui.settings = await window.aab.saveSettings({ token: "", user: null });
  ui.data = null; ui.dash = null; ui.ep = null; ui.cal = null; ui.gcfg = null; ui.gErr = ""; ui.tab = "request"; ui.view = "list"; ui.filter = null;
  ui.form = msg ? { msg, msgType: "info" } : {};
  render();
}

async function loadState({ refresh = false } = {}) {
  if (!configured()) { render(); return; }
  ui.loading = true;
  ui.error = "";
  renderFooter();
  try {
    const data = refresh ? await api("/api/refresh", {}) : await api("/api/state");
    ui.data = data;
    if (isLead() && ui.tab === "input") ui.dash = await api("/api/dashboard");
    await loadGoogle({ refresh });
    await checkNewRequests(data.requests || []);
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
  renderBar();
  const view = $("view");
  if (!configured()) {
    view.innerHTML = loginView();
    bindLogin();
  } else if (ui.view === "accounts" && isLead()) {
    view.innerHTML = accountsView();
    bindAccounts();
  } else if (ui.view === "settings") {
    view.innerHTML = settingsView();
    bindSettings();
  } else if (ui.tab === "ep") {
    view.innerHTML = ui.view === "detail" ? epDetailView() : epListView();
    ui.view === "detail" ? bindEpDetail() : bindEpList();
  } else if (ui.tab === "cal" && canCal()) {
    view.innerHTML = ui.view === "detail" ? calFormView() : calListView();
    ui.view === "detail" ? bindCalForm() : bindCalList();
  } else if (ui.tab === "request") {
    view.innerHTML = ui.view === "detail" ? detailView() : requestListView();
    ui.view === "detail" ? bindDetail() : bindRequestList();
  } else {
    view.innerHTML = inputView();
    bindInput();
  }
  renderFooter();
}

function renderBar() {
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
    f.textContent = `Sheet terakhir dicek ${pad(t.getHours())}.${pad(t.getMinutes())}. Server cek tiap 10 menit.`;
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
  if (ui.error) return `<div class="pad"><p class="msg err" role="alert">${esc(ui.error)}</p><button class="btn secondary" data-act="retry">Coba lagi</button></div>`;
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
      <div class="summary"><div><b>${lama.length}</b>sudah ada, angka diperbarui</div><div><b>${baru.length}</b>konten baru</div></div>
      ${baru.length ? `<p class="hint">Untuk tiap konten baru, isi nama konten dan pilih content pillar. Caption dari ABT ditampilkan sebagai acuan.</p>` : ""}
      ${baru
        .map(
          (r, i) => `<div class="bulk-item">
          <div class="bulk-meta">${esc(r.account)}, ${esc(r.tanggal)}, ${esc(r.kategori)}</div>
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
  return `<h2>Upload data dari Anak Bangsa Tools</h2>
    ${dropZone("abtFile", f.parsing ? "Membaca file…" : "Tarik file bulk ABT (.xlsx) ke sini", "atau klik untuk pilih file", ".xlsx")}
    <p class="hint">Konten yang sudah ada di sheet hanya diperbarui angkanya. Konten baru ditambahkan setelah kamu isi nama konten dan pilih pillar.</p>
    <p class="hint">Ada konten yang metriknya tidak terbaca ABT? <button class="linklike" data-act="modeManual">Input manual</button></p>`;
}

function bindContent() {
  const f = ui.form;
  on("modeManual", () => { ui.form = { mode: "manual" }; render(); });
  on("modeBulk", () => { ui.form = {}; render(); });
  on("resetBulk", () => { ui.form = {}; render(); });
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

async function loadGoogle({ refresh = false } = {}) {
  try {
    ui.ep = await api(refresh ? "/api/ep/refresh" : "/api/ep", refresh ? {} : undefined);
    if (canCal()) ui.cal = await api(refresh ? "/api/calendar/refresh" : "/api/calendar", refresh ? {} : undefined);
    ui.gErr = "";
    await checkEpRevisions();
  } catch (e) {
    ui.gErr = e.message;
  }
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
    <a class="btn secondary as-link" href="https://docs.google.com/presentation/d/${esc(ui.ep.id)}/edit#slide=id.${esc(i.id)}" target="_blank" rel="noopener">Buka slide ini</a>
    ${decision}
    ${post}
    ${f.msg ? `<p class="msg ${f.msgType}" role="status">${esc(f.msg)}</p>` : ""}
    <details class="section ep-body"><summary>Isi slide</summary><p class="detail-info">${esc(i.body)}</p></details>
  </div>`;
}

function bindEpDetail() {
  bindCommon();
  on("gRetry", () => loadState());
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
      ui.form = {}; ui.tab = "request"; ui.view = "list"; ui.filter = null;
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
  return `<div class="pad">
    <button class="back" data-act="back">← Kembali</button>
    <h2>Pengaturan</h2>
    <p class="hint">Masuk sebagai <b>${esc(u.username)}</b> (${esc(u.name || "")}). <button class="linklike" data-act="logout">Keluar</button></p>
    ${updateBox()}
    ${lead ? `<div class="section">
      <h2>Link sheet bulan ini</h2>
      <p class="hint">Tiap awal bulan, setelah file baru diduplikat dan app ditambahkan ke file, tempel link file baru di sini.</p>
      <label for="sSheet">Link sheet Lark</label><input type="url" id="sSheet" value="${esc(f.sSheet || "")}" placeholder="https://....larksuite.com/sheets/...">
      <button class="btn" data-act="saveSheet" ${f.busySheet ? "disabled" : ""}>${f.busySheet ? "Mengecek file…" : "Pakai file ini"}</button>
    </div>
    ${googleSettings()}
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
    <div class="section">
      <h2>Laptop ini</h2>
      <label class="check"><input type="checkbox" id="sLogin" ${s.openAtLogin ? "checked" : ""}> Buka otomatis saat Windows menyala</label>
    </div>
    ${f.msg ? `<p class="msg ${f.msgType}" role="status">${f.msgHtml ? f.msg : esc(f.msg)}</p>` : ""}
  </div>`;
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
      await loadGoogle();
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
  window.addEventListener("focus", () => { if (!ui.loading) loadState(); });
}

init();
