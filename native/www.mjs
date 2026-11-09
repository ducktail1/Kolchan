// Собирает www/ для приложения из готового Колчана в корне репозитория (тот же, что на сайте).
// В приложении: считаемся «установленными» (без плашки «экран Домой»), без входа через Google
// (Google не пускает вход из встроенного браузера приложения — сделаем позже отдельно).
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
const root = new URL("../", import.meta.url), out = new URL("./www/", import.meta.url);
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
for (const f of ["local.js", "friends.js", "cloud.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"])
  if (existsSync(new URL(f, root))) copyFileSync(new URL(f, root), new URL(f, out));
let html = readFileSync(new URL("index.html", root), "utf8");
const native = '<script>window.__KOLCHAN_NATIVE = 1; try { Object.defineProperty(navigator, "standalone", { get: () => true, configurable: true }); } catch (e) {}</script>';
html = html.replace(/<head>/i, "<head>" + native);
html = html.replace(/"providers":\s*\[([^\]]*)\]/, (m, l) => '"providers": [' + l.split(",").map(s => s.trim()).filter(s => s !== '"google"').join(", ") + "]");
writeFileSync(new URL("index.html", out), html);
console.log("www готов:", html.match(/"providers":\s*\[[^\]]*\]/)[0]);
