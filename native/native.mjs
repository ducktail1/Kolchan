// Нативные доработки проекта Xcode (папка ios/ создаётся на Маке, поэтому правим её этим скриптом; можно запускать сколько угодно раз).
// - своя ссылка kolchan:// (вход через Telegram и Google возвращается в приложение)
// - быстрые действия на иконке: Добавить вещь / Найти / Трата
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const app = new URL("./ios/App/App/", import.meta.url).pathname;
const plist = app + "Info.plist";
const put = (key, value) => execFileSync("plutil", ["-replace", key, "-json", JSON.stringify(value), plist]);

put("CFBundleURLTypes", [{ CFBundleURLName: "kolchan", CFBundleURLSchemes: ["kolchan"] }]);
put("UIApplicationShortcutItems", [
  { UIApplicationShortcutItemType: "add", UIApplicationShortcutItemTitle: "Добавить вещь", UIApplicationShortcutItemIconSymbolName: "plus" },
  { UIApplicationShortcutItemType: "search", UIApplicationShortcutItemTitle: "Найти", UIApplicationShortcutItemIconSymbolName: "magnifyingglass" },
  { UIApplicationShortcutItemType: "expense", UIApplicationShortcutItemTitle: "Трата", UIApplicationShortcutItemIconSymbolName: "rublesign" },
]);

const MARK = "// KOLCHAN";
const helper = `
${MARK}: быстрые действия → window.__kolchanAction(...) в странице (ждём, пока страница загрузится)
enum KolchanAction {
    static var pending: String?
    static func run(_ action: String) { pending = action; deliver(0) }
    static func deliver(_ tries: Int) {
        guard let a = pending else { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let root = scenes.flatMap { $0.windows }.compactMap { $0.rootViewController as? CAPBridgeViewController }.first
        guard let web = root?.webView else { retry(tries); return }
        web.evaluateJavaScript("window.__kolchanAction ? (window.__kolchanAction('" + a + "'), 1) : 0") { result, _ in
            if (result as? NSNumber)?.intValue == 1 { KolchanAction.pending = nil } else { KolchanAction.retry(tries) }
        }
    }
    private static func retry(_ tries: Int) {
        guard tries < 60 else { KolchanAction.pending = nil; return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { KolchanAction.deliver(tries + 1) }
    }
}
`;
const ad = app + "AppDelegate.swift", sd = app + "SceneDelegate.swift";
let a = readFileSync(ad, "utf8");
if (!a.includes(MARK)) {
  a = a.replace("import Capacitor", "import Capacitor\nimport WebKit") + helper;
  if (!existsSync(sd)) a = a.replace(/class AppDelegate: UIResponder, UIApplicationDelegate \{\n/, (m) => m + `
    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) { ${MARK}
        KolchanAction.run(shortcutItem.type)
        completionHandler(true)
    }
`);
  writeFileSync(ad, a);
}
if (existsSync(sd)) {
  let s = readFileSync(sd, "utf8");
  if (!s.includes(MARK)) {
    s = s.replace(/class SceneDelegate: UIResponder, UIWindowSceneDelegate \{\n/, (m) => m + `
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) { ${MARK}
        KolchanAction.run(shortcutItem.type)
        completionHandler(true)
    }
`);
    s = s.replace(/(SceneDelegateProxy\.shared\.scene\(scene, willConnectTo: session, options: connectionOptions\)\n)/, (m) => m + `        if let item = connectionOptions.shortcutItem { KolchanAction.run(item.type) } ${MARK}\n`);
    writeFileSync(sd, s);
  }
}
console.log("готово: kolchan://, быстрые действия" + (existsSync(sd) ? " (SceneDelegate)" : " (AppDelegate)"));
