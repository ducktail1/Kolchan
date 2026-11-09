// Собирает www/ для приложения из исходников Колчана (src/).
// В приложении считаемся «установленными» (без плашки «экран Домой»); Google входит через системный браузер.
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
// собираем из исходников src/ (свежее, чем выкаченный сайт): python3 есть на Маке вместе с git
const src = new URL("../src/", import.meta.url).pathname, ver = "app-" + new Date().toISOString().slice(0, 10);
execFileSync("python3", [src + "kolchan-src/build.py", src, ver], { stdio: "ignore" });
execFileSync("python3", [src + "kolchan-src/build_main.py", src, ver, "https://jtmujxxpcqjddauitrio.supabase.co", "sb_publishable_PrBfsQIYFTYLzoqWso1CHA_ED-qe00L", "email,telegram,google"], { stdio: "ignore" });
const root = new URL("../src/kolchan/", import.meta.url), out = new URL("./www/", import.meta.url);
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
for (const f of ["local.js", "friends.js", "cloud.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"])
  if (existsSync(new URL(f, root))) copyFileSync(new URL(f, root), new URL(f, out));
let html = readFileSync(new URL("index.html", root), "utf8");
const native = '<script>window.__KOLCHAN_NATIVE = 1; try { Object.defineProperty(navigator, "standalone", { get: () => true, configurable: true }); } catch (e) {}</script>';
html = html.replace(/<head>/i, "<head>" + native);
writeFileSync(new URL("index.html", out), html);
console.log("www готов:", html.match(/"providers":\s*\[[^\]]*\]/)[0]);
