const params = new URLSearchParams(location.search);
let data = {};
try { data = JSON.parse(params.get("data") || "{}"); } catch { data = {}; }
document.getElementById("title").textContent = data.title || "Request baru";
document.getElementById("body").textContent = data.body || "";
document.getElementById("open").addEventListener("click", () => window.aab.popupOpen(data.id || null));
document.getElementById("later").addEventListener("click", () => window.aab.popupClose());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") window.aab.popupClose(); });
