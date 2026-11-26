const params = new URLSearchParams(location.search);
let data = {};
try { data = JSON.parse(params.get("data") || "{}"); } catch { data = {}; }
if (/^#[0-9a-f]{6}$/i.test(data.accent || "")) document.documentElement.style.setProperty("--accent", data.accent);
if (data.theme === "light") document.documentElement.classList.add("light");
document.getElementById("title").textContent = data.title || "Request baru";
document.getElementById("body").textContent = data.body || "";
if (data.openLabel) document.getElementById("open").textContent = String(data.openLabel).slice(0, 24);
document.getElementById("open").addEventListener("click", () => window.aab.popupOpen(data.id || null));
document.getElementById("later").addEventListener("click", () => window.aab.popupClose());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") window.aab.popupClose(); });
