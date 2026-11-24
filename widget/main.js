// Creative AAB: proses utama widget (Electron)
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, nativeImage, net } = require("electron");
const path = require("path");
const fs = require("fs");

app.setAppUserModelId("com.agensianakbangsa.creative");

const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");
const DEFAULT_SERVER = "https://creative-aab.creative-545.workers.dev";
const DEFAULTS = { serverUrl: DEFAULT_SERVER, token: "", user: null, seen: [], seenInit: false, seenUser: "", pinned: false, openAtLogin: true };

// Update otomatis dari GitHub Releases (creative273/creative-aab). Hanya jalan di versi terpasang (installer).
let autoUpdater = null;
try { ({ autoUpdater } = require("electron-updater")); } catch { autoUpdater = null; }
const upd = { state: "idle", version: "", progress: 0, error: "" };

// Sesi browser khusus untuk SS otomatis. Disimpan, jadi login (misalnya Instagram) cukup sekali.
const CAPTURE_PARTITION = "persist:capture";

let win = null;
let popup = null;
let tray = null;
let quitting = false;

function loadSettings() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8")) };
    if (!s.serverUrl) s.serverUrl = DEFAULT_SERVER;
    delete s.teamKey; // v1.0 memakai kunci tim bersama, sekarang login per akun
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(next, null, 2));
  return next;
}

function placeBottomRight(w, h, margin = 16) {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - w - margin, y: workArea.y + workArea.height - h - margin };
}

function createWindow() {
  const s = loadSettings();
  const W = 400;
  const H = 640;
  const pos = placeBottomRight(W, H);
  win = new BrowserWindow({
    width: W,
    height: H,
    minWidth: 360,
    minHeight: 420,
    x: pos.x,
    y: pos.y,
    frame: false,
    show: false,
    alwaysOnTop: !!s.pinned,
    backgroundColor: "#08111D",
    icon: path.join(__dirname, "assets", "icon256.png"),
    title: "Creative AAB",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  // Link luar dibuka di browser biasa, bukan di dalam widget.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
}

function showMain(requestId) {
  if (!win) return;
  win.show();
  win.focus();
  if (requestId) win.webContents.send("open-request", requestId);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "assets", "icon16.png")));
  tray.setToolTip("Creative AAB");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Buka Creative AAB", click: () => showMain() },
      { type: "separator" },
      { label: "Keluar", click: () => { quitting = true; app.quit(); } },
    ])
  );
  tray.on("click", () => showMain());
}

function showPopup(data) {
  const W = 360;
  const H = 150;
  const pos = placeBottomRight(W, H, 24);
  if (popup && !popup.isDestroyed()) popup.close();
  popup = new BrowserWindow({
    width: W,
    height: H,
    x: pos.x,
    y: pos.y,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    show: false,
    backgroundColor: "#0E1A2B",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  popup.loadFile(path.join(__dirname, "renderer", "popup.html"), { query: { data: JSON.stringify(data) } });
  popup.once("ready-to-show", () => popup.showInactive());
  setTimeout(() => popup && !popup.isDestroyed() && popup.close(), 15000);
}

// Ambil SS dari link video (untuk Albar)
async function captureLink(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("Link harus diawali http:// atau https://");
  // TikTok dan YouTube: ambil cover resmi supaya rapi.
  try {
    const cover = await coverUrl(url);
    if (cover) {
      const buf = await fetchBuffer(cover);
      const img = nativeImage.createFromBuffer(buf);
      if (!img.isEmpty()) return toJpegBase64(img, "cover");
    }
  } catch {
    // lanjut ke SS halaman
  }
  // Instagram: halaman embed bisa dibuka tanpa login, jadi yang ter-SS postingannya, bukan halaman login.
  const ig = url.match(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  const target = ig ? `https://www.instagram.com/p/${ig[1]}/embed/captioned/` : url;
  const cap = new BrowserWindow({
    show: false,
    width: ig ? 540 : 1280,
    height: ig ? 960 : 900,
    webPreferences: { partition: CAPTURE_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  cap.webContents.setAudioMuted(true);
  cap.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    await Promise.race([
      cap.loadURL(target).catch(() => { throw new Error("Halaman tidak bisa dibuka. Cek link atau koneksi internet."); }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Halaman terlalu lama dimuat.")), 25000)),
    ]);
    await new Promise((r) => setTimeout(r, 3500));
    const img = await cap.webContents.capturePage();
    if (img.isEmpty()) throw new Error("SS kosong.");
    return toJpegBase64(img, ig ? "Postingan Instagram" : "halaman");
  } finally {
    cap.destroy();
  }
}

async function coverUrl(url) {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (yt) return `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`;
  if (/tiktok\.com\//i.test(url)) {
    const buf = await fetchBuffer(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    const data = JSON.parse(buf.toString("utf8"));
    return data.thumbnail_url || null;
  }
  return null;
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    const chunks = [];
    const t = setTimeout(() => { req.abort(); reject(new Error("timeout")); }, 15000);
    req.on("response", (res) => {
      if (res.statusCode >= 400) { clearTimeout(t); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { clearTimeout(t); resolve(Buffer.concat(chunks)); });
    });
    req.on("error", (e) => { clearTimeout(t); reject(e); });
    req.end();
  });
}

function toJpegBase64(img, source) {
  const size = img.getSize();
  const scaled = size.width > 1280 ? img.resize({ width: 1280, quality: "good" }) : img;
  return { base64: scaled.toJPEG(75).toString("base64"), source };
}

// ---------- Update ----------
function sendUpdate() {
  if (win && !win.isDestroyed()) win.webContents.send("update", { ...upd, current: app.getVersion() });
}

function setupUpdater() {
  if (!autoUpdater || !app.isPackaged) { upd.state = "dev"; return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => { upd.state = "checking"; upd.error = ""; sendUpdate(); });
  autoUpdater.on("update-available", (i) => { upd.state = "downloading"; upd.version = i.version; upd.progress = 0; sendUpdate(); });
  autoUpdater.on("update-not-available", () => { upd.state = "latest"; sendUpdate(); });
  autoUpdater.on("download-progress", (p) => { upd.progress = Math.round(p.percent || 0); sendUpdate(); });
  autoUpdater.on("update-downloaded", (i) => {
    upd.state = "ready"; upd.version = i.version; sendUpdate();
    showPopup({ id: "", title: `Versi ${i.version} siap dipasang`, body: "Buka Pengaturan, klik Pasang dan restart. Atau biarkan, terpasang otomatis saat aplikasi ditutup." });
  });
  autoUpdater.on("error", (e) => { upd.state = "error"; upd.error = String((e && e.message) || e).split("\n")[0].slice(0, 200); sendUpdate(); });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15 * 1000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

ipcMain.handle("update:get", () => ({ ...upd, current: app.getVersion() }));
ipcMain.handle("update:check", async () => {
  if (upd.state === "dev") return { ...upd, current: app.getVersion() };
  if (upd.state === "downloading" || upd.state === "ready") return { ...upd, current: app.getVersion() };
  await autoUpdater.checkForUpdates().catch((e) => { upd.state = "error"; upd.error = String(e.message || e).slice(0, 200); });
  return { ...upd, current: app.getVersion() };
});
ipcMain.handle("update:install", () => {
  if (upd.state !== "ready") return false;
  quitting = true;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
});

// IPC
ipcMain.handle("settings:get", () => loadSettings());
ipcMain.handle("settings:save", (_e, patch) => {
  const next = saveSettings(patch);
  if ("pinned" in patch && win) win.setAlwaysOnTop(!!next.pinned);
  if ("openAtLogin" in patch) app.setLoginItemSettings({ openAtLogin: !!next.openAtLogin });
  return next;
});
ipcMain.handle("capture-link", (_e, url) => captureLink(url));
// Buka jendela login di sesi SS otomatis (untuk akun yang perlu login, misalnya Instagram).
ipcMain.handle("capture-login", (_e, site) => {
  const urls = { instagram: "https://www.instagram.com/accounts/login/", tiktok: "https://www.tiktok.com/login" };
  const w = new BrowserWindow({
    width: 480,
    height: 760,
    title: "Login untuk SS otomatis",
    autoHideMenuBar: true,
    webPreferences: { partition: CAPTURE_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.loadURL(urls[site] || urls.instagram);
});
ipcMain.handle("popup:show", (_e, data) => showPopup(data));
ipcMain.handle("popup:open", (_e, id) => {
  if (popup && !popup.isDestroyed()) popup.close();
  showMain(id);
});
ipcMain.handle("popup:close", () => popup && !popup.isDestroyed() && popup.close());
ipcMain.handle("window:hide", () => win && win.hide());
ipcMain.handle("open-external", (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMain());
  app.whenReady().then(() => {
    const s = loadSettings();
    app.setLoginItemSettings({ openAtLogin: !!s.openAtLogin });
    createWindow();
    createTray();
    setupUpdater();
  });
  app.on("before-quit", () => { quitting = true; });
  app.on("window-all-closed", (e) => e.preventDefault());
}
