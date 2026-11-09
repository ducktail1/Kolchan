// Иконка приложения 1024×1024 из icon-512.png (через sips, он есть в macOS).
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
const dir = new URL("./ios/App/App/Assets.xcassets/AppIcon.appiconset/", import.meta.url).pathname;
const png = readdirSync(dir).find(f => f.endsWith(".png")) || "AppIcon-512@2x.png";
execFileSync("sips", ["-z", "1024", "1024", new URL("../icon-512.png", import.meta.url).pathname, "--out", dir + png], { stdio: "inherit" });
console.log("иконка:", dir + png);
