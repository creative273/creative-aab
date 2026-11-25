// Service worker versi HP Creative AAB.
// Push dari server tidak membawa isi. Saat push masuk, ambil notifikasi terbaru dari server
// dengan token login yang disimpan di IndexedDB, lalu tampilkan yang belum pernah ditampilkan.
const DB = "aab-mobile";

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
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
const get = (k) => idb("readonly", (s) => s.get(k));
const put = (k, v) => idb("readwrite", (s) => s.put(v, k));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const VERB = {
  mention: (n) => (n.postBy && n.postBy !== n.by ? "menandai kamu di komentar" : "menandai kamu di postingan"),
  comment: () => "mengomentari postinganmu",
  reply: () => "juga mengomentari postingan yang kamu komentari",
  react: () => "memberi reaksi pada postinganmu",
  update: (n) => `minta kamu update aplikasi laptop ke v${n.version}`,
};

function describe(n, names) {
  const who = names[n.by] || n.by || "";
  if (n.type === "request") return { title: `Request baru dari ${n.requester || "user"}`, body: `${n.text}${n.deadline ? ` · deadline ${n.deadline}` : ""}. Perlu approval.` };
  if (n.type === "ep") return { title: n.status === "OKE" ? `EP di-OKE: ${n.text}` : `Revisi EP: ${n.text}`, body: n.status === "OKE" ? "Lanjut produksi." : n.note || "Ada catatan revisi." };
  const verb = (VERB[n.type] || (() => "berinteraksi denganmu"))(n);
  return { title: `${who} ${verb}`, body: n.text || "" };
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const token = await get("token").catch(() => null);
    let items = [];
    let names = {};
    if (token) {
      try {
        const res = await fetch("/api/notif", { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) items = (await res.json()).items || [];
        names = (await get("names").catch(() => null)) || {};
      } catch { /* tampilkan pesan umum di bawah */ }
    }
    const shown = new Set((await get("shown").catch(() => null)) || []);
    const fresh = items.filter((n) => !n.read && !shown.has(n.id));
    const unread = items.filter((n) => !n.read).length;
    if (self.navigator.setAppBadge) self.navigator.setAppBadge(unread).catch(() => {});
    if (!fresh.length) {
      // iOS mewajibkan setiap push menampilkan notifikasi.
      return self.registration.showNotification("Creative AAB", { body: "Ada notifikasi baru.", icon: "icon-192.png", badge: "badge.png", tag: "aab-generic" });
    }
    for (const n of fresh.slice(0, 3).reverse()) {
      const d = describe(n, names);
      await self.registration.showNotification(d.title, { body: d.body.replace(/@([a-z0-9._-]+)/gi, (a, u) => (names[u.toLowerCase()] ? `@${names[u.toLowerCase()].split(" ")[0]}` : a)), icon: "icon-192.png", badge: "badge.png", tag: n.id, data: { id: n.id } });
      shown.add(n.id);
    }
    await put("shown", [...shown].slice(-200));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = (event.notification.data || {}).id || "";
  event.waitUntil((async () => {
    const url = `/m/${id ? `#n=${encodeURIComponent(id)}` : ""}`;
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith("/m/")) {
        await w.focus();
        w.postMessage({ open: id });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
