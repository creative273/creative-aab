// Pasang ikon CRE dan info versi ke exe sebelum dibungkus installer (tanpa wine).
const path = require("path");
const fs = require("fs");
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== "win32") return;
  const ResEdit = await import("resedit");
  const version = ctx.packager.appInfo.version;
  const [a, b, c] = version.split(".").map(Number);
  const exePath = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, "..", "assets", "icon.ico")));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const id = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { LegalCopyright: "Agensi Anak Bangsa", ProductName: "Creative AAB", FileDescription: "Creative AAB", CompanyName: "Agensi Anak Bangsa", ProductVersion: version, FileVersion: version, OriginalFilename: "Creative AAB.exe" });
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • ikon dan versi ${version} terpasang di exe`);
};
