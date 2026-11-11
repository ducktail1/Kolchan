// Нативные доработки проекта Xcode (папка ios/ создаётся на Маке, поэтому правим её этим скриптом; можно запускать сколько угодно раз).
// - своя ссылка kolchan:// (вход через Telegram и Google возвращается в приложение)
// - быстрые действия на иконке: Добавить вещь / Найти / Трата
// - Siri: «Добавь в Колчан» (открывает новую вещь), «Где в Колчане» (отвечает голосом, не открывая приложение)
// - язык разработки — русский (фразы Siri в коде по-русски)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const app = new URL("./ios/App/App/", import.meta.url).pathname;
const plist = app + "Info.plist", pbx = new URL("./ios/App/App.xcodeproj/project.pbxproj", import.meta.url).pathname;
const put = (key, value) => execFileSync("plutil", ["-replace", key, "-json", JSON.stringify(value), plist]);

put("CFBundleURLTypes", [{ CFBundleURLName: "kolchan", CFBundleURLSchemes: ["kolchan"] }]);
put("UIApplicationShortcutItems", [
  { UIApplicationShortcutItemType: "add", UIApplicationShortcutItemTitle: "Добавить вещь", UIApplicationShortcutItemIconSymbolName: "plus" },
  { UIApplicationShortcutItemType: "search", UIApplicationShortcutItemTitle: "Найти", UIApplicationShortcutItemIconSymbolName: "magnifyingglass" },
  { UIApplicationShortcutItemType: "expense", UIApplicationShortcutItemTitle: "Трата", UIApplicationShortcutItemIconSymbolName: "rublesign" },
]);
put("CFBundleDevelopmentRegion", "ru");
// Siri склоняет: «в Колчане», «в Колчан» — даём ей другие формы названия, иначе ищет «Колчан» в App Store
put("INAlternativeAppNames", ["Колчане", "Колчану", "Колчана"].map(n => ({ INAlternativeAppName: n })));
let p = readFileSync(pbx, "utf8");
p = p.replace("developmentRegion = en;", "developmentRegion = ru;");
if (!/knownRegions = \([^)]*\bru,/.test(p)) p = p.replace(/knownRegions = \(\n/, (m) => m + "\t\t\t\tru,\n");
writeFileSync(pbx, p);

const BEGIN = "// KOLCHAN-BEGIN", END = "// KOLCHAN-END";
const block = `${BEGIN} (вставлено native.mjs — правки делать там)
// Быстрые действия и Siri → window.__kolchanAction(...) в странице (ждём, пока страница загрузится)
enum KolchanAction {
    static var pending: (String, String)?
    static func run(_ action: String, _ text: String = "") { pending = (action, text); deliver(0) }
    static func deliver(_ tries: Int) {
        guard let job = pending else { return }
        let (a, t) = job
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let root = scenes.flatMap { $0.windows }.compactMap { $0.rootViewController as? CAPBridgeViewController }.first
        guard let web = root?.webView,
              let data = try? JSONSerialization.data(withJSONObject: [a, t]),
              let args = String(data: data, encoding: .utf8) else { KolchanAction.retry(tries); return }
        web.evaluateJavaScript("window.__kolchanAction ? (window.__kolchanAction.apply(null, " + args + "), 1) : 0") { result, _ in
            if (result as? NSNumber)?.intValue == 1 { KolchanAction.pending = nil } else { KolchanAction.retry(tries) }
        }
    }
    static func retry(_ tries: Int) {
        guard tries < 60 else { KolchanAction.pending = nil; return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { KolchanAction.deliver(tries + 1) }
    }
}

// «Где …»: страница складывает список [вещь, где] в настройки приложения (плагин Preferences)
enum KolchanIndex {
    static func stem(_ w: String) -> String { String(w.prefix(max(3, w.count - 2))) }
    static func answer(_ q: String) -> String {
        guard let s = UserDefaults.standard.string(forKey: "CapacitorStorage.siri"),
              let d = s.data(using: .utf8),
              let rows = (try? JSONSerialization.jsonObject(with: d)) as? [[String]] else {
            return "Открой Колчан один раз — тогда я буду знать, где что лежит."
        }
        let words = q.lowercased().split(separator: " ").map(String.init).filter { $0.count > 1 }
        let hits = rows.filter { r in
            guard r.count > 1, !words.isEmpty else { return false }
            let n = r[0].lowercased()
            return words.allSatisfy { n.contains(stem($0)) }
        }
        if hits.isEmpty { return "Не нашёл «\\(q)» в Колчане." }
        var out = hits.prefix(3).map { "\\($0[0]) — \\($0[1])" }.joined(separator: ". ")
        if hits.count > 3 { out += ". И ещё \\(hits.count - 3)." }
        return out
    }
}

@available(iOS 17.0, *)
struct KolchanAddIntent: AppIntent {
    static var title: LocalizedStringResource = "Добавить вещь"
    static var description = IntentDescription("Открывает Колчан с новой вещью: «маска в чехол Nitro».")
    static var openAppWhenRun: Bool = true
    @Parameter(title: "Вещь", requestValueDialog: IntentDialog("Что добавить?"))
    var text: String
    @MainActor
    func perform() async throws -> some IntentResult {
        KolchanAction.run("add", text)
        return .result()
    }
}

@available(iOS 17.0, *)
struct KolchanFindIntent: AppIntent {
    static var title: LocalizedStringResource = "Где вещь"
    static var description = IntentDescription("Говорит, где лежит вещь.")
    static var openAppWhenRun: Bool = false
    @Parameter(title: "Вещь", requestValueDialog: IntentDialog("Что найти?"))
    var text: String
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let a = KolchanIndex.answer(text)
        return .result(dialog: "\\(a)")
    }
}

@available(iOS 17.0, *)
struct KolchanShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: KolchanAddIntent(), phrases: [
            "Добавь в \\(.applicationName)",
            "Добавить в \\(.applicationName)",
            "Новая вещь в \\(.applicationName)"
        ], shortTitle: "Добавить вещь", systemImageName: "plus")
        AppShortcut(intent: KolchanFindIntent(), phrases: [
            "Где в \\(.applicationName)",
            "Найди в \\(.applicationName)",
            "Что где в \\(.applicationName)"
        ], shortTitle: "Где вещь", systemImageName: "magnifyingglass")
    }
}
${END}
`;
const ad = app + "AppDelegate.swift", sd = app + "SceneDelegate.swift";
let a = readFileSync(ad, "utf8");
// старый вариант без BEGIN/END (до Siri) — убрать
const old = a.indexOf("// KOLCHAN: быстрые действия");
if (old >= 0) a = a.slice(0, old).trimEnd() + "\n";
const b0 = a.indexOf(BEGIN), b1 = a.indexOf(END);
if (b0 >= 0 && b1 > b0) a = a.slice(0, b0).trimEnd() + "\n" + a.slice(b1 + END.length).replace(/^\n/, "");
for (const imp of ["WebKit", "AppIntents"]) if (!a.includes("import " + imp)) a = a.replace("import Capacitor", "import Capacitor\nimport " + imp);
a = a.trimEnd() + "\n\n" + block;
const MARK = "// KOLCHAN";
if (!existsSync(sd) && !a.includes("performActionFor shortcutItem")) a = a.replace(/class AppDelegate: UIResponder, UIApplicationDelegate \{\n/, (m) => m + `
    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) { ${MARK}
        KolchanAction.run(shortcutItem.type)
        completionHandler(true)
    }
`);
writeFileSync(ad, a);
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
console.log("готово: kolchan://, быстрые действия, Siri" + (existsSync(sd) ? " (SceneDelegate)" : " (AppDelegate)"));
