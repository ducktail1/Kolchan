// Своя ссылка приложения kolchan:// — бот после входа через Telegram возвращает сюда.
import { execFileSync } from "node:child_process";
const plist = new URL("./ios/App/App/Info.plist", import.meta.url).pathname;
try { execFileSync("plutil", ["-extract", "CFBundleURLTypes", "raw", plist], { stdio: "ignore" }); console.log("kolchan:// уже есть"); }
catch (e) {
  execFileSync("plutil", ["-insert", "CFBundleURLTypes", "-json", JSON.stringify([{ CFBundleURLName: "kolchan", CFBundleURLSchemes: ["kolchan"] }]), plist], { stdio: "inherit" });
  console.log("kolchan:// добавлена");
}
