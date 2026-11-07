// Колчан: first-run welcome, install guide, feedback to Telegram, backup reminder.
(function () {
  "use strict";
  const TG = "ducktail10";
  const DAY = 86400000;
  const $ = (id) => document.getElementById(id);
  const K = window.__kolchan;

  function device() {
    const ua = navigator.userAgent || "";
    const ios = ua.match(/(iPhone|iPad)[^)]*OS (\d+)_(\d+)/);
    if (ios) return ios[1] + ", iOS " + ios[2] + "." + ios[3];
    const and = ua.match(/Android (\d+(\.\d+)?)/);
    if (and) return "Android " + and[1];
    return (navigator.platform || "браузер");
  }

  const css = `
.welcome { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 18px 16px; display: flex; flex-direction: column; gap: 12px; }
.welcome h2 { font-family: var(--font-display); font-size: 19px; margin: 0; }
.welcome ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; color: var(--ink); font-size: 15px; }
.welcome ol b { font-weight: 600; }
.welcome .row2 { display: flex; gap: 10px; flex-wrap: wrap; }
.welcome .row2 > * { flex: 1 1 140px; }
.remind { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; font-size: 14px; padding: 10px 12px; border-radius: 12px; }
.remind { background: var(--tape); color: var(--tape-ink); }
.remind button { padding: 8px 12px; font-size: 14px; }
.remind .rbtn { display: flex; gap: 8px; }
.remind button.ghost { background: transparent; border-color: currentColor; color: inherit; }
.fb-nick { font-family: var(--font-mono); user-select: all; }
a.primary { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; background: var(--accent); color: var(--accent-ink); border-radius: 10px; padding: 12px 14px; font-weight: 600; }
details.sync { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
details.sync summary { cursor: pointer; font-weight: 600; font-size: 15px; }
details.sync[open] summary { margin-bottom: 10px; }
details.sync > *:not(summary) { margin-top: 8px; }
`;

  const AVA = !!window.__KOLCHAN_AVA;   // avatar menu: beta only for now
  const avaCss = `
/* avatar menu (top right): account, feedback, data */
header { flex-wrap: nowrap !important; align-items: center !important; }
.hdr-right { align-items: center !important; flex: none; position: relative; }
.hdr-right > .link { display: none !important; }
.ava { width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface); color: var(--ink); display: grid; place-items: center; padding: 0; font-weight: 700; font-size: 16px; position: relative; flex: none; }
.ava.on { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
.ava .dot { position: absolute; top: -1px; right: -1px; width: 11px; height: 11px; border-radius: 50%; background: #d4553f; border: 2px solid var(--bg); }
.ava-menu { position: absolute; right: 0; top: calc(100% + 8px); z-index: 30; min-width: 220px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,.25); padding: 6px; display: flex; flex-direction: column; }
.ava-menu .who { padding: 10px 12px 8px; font-size: 13px; color: var(--muted); border-bottom: 1px solid var(--line); margin-bottom: 4px; overflow-wrap: anywhere; }
.ava-menu button { display: flex; align-items: center; gap: 12px; border: 0; background: none; color: var(--ink); text-align: left; padding: 12px; border-radius: 10px; font-size: 16px; }
.ava-menu button:active { background: var(--bg); }
.ava-menu button svg { width: 20px; height: 20px; flex: none; color: var(--muted); }
.ava-menu button .warn { margin-left: auto; color: #d4553f; }
/* centred title: menu + home on the left, avatar on the right, «Колчан» in the middle with the counter under it */
header { position: relative; min-height: 48px; }
header .tt { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); align-items: center; text-align: center; max-width: calc(100% - 190px); pointer-events: none; }
header .tt > * { pointer-events: auto; }
header .tt h1 { white-space: nowrap; }
header .tt .tsub { display: flex; gap: 4px; justify-content: center; flex-wrap: nowrap; font-size: 12px; line-height: 1.2; white-space: nowrap; max-width: 100%; }
header .tt .tsub .qname { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
header .tt .tsub .count { font-size: 12px; }
header .tt .tsub .qname { font-size: 12px; }
header .tt .tsub .qname:not([hidden])::before { content: "· "; }
/* frosted strip under the bottom buttons: the list blurs as it slides under them */
.fab-blur { position: fixed; left: 0; right: 0; bottom: 0; z-index: 4; pointer-events: none;
  height: calc(env(safe-area-inset-bottom, 0px) + 96px);
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2);
  -webkit-mask-image: linear-gradient(to top, #000 62%, transparent); mask-image: linear-gradient(to top, #000 62%, transparent); }

.inst-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; counter-reset: st; }
.inst-steps > li { display: grid; grid-template-columns: 28px 1fr; gap: 10px; align-items: start; counter-increment: st; }
.inst-steps > li::before { content: counter(st); width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); font-weight: 600; display: grid; place-items: center; font-size: 15px; }
.inst-steps .txt { font-size: 15px; line-height: 1.4; }
.inst-steps .txt small { display: block; color: var(--muted); font-size: 13px; margin-top: 2px; }
.mock { margin-top: 8px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 8px 10px; display: flex; align-items: center; gap: 10px; font-size: 14px; }
.mock.m-bar { justify-content: space-around; color: var(--muted); }
.mock .hl { color: var(--accent); background: var(--bag-soft); border-radius: 8px; padding: 4px 6px; outline: 2px solid var(--accent); display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.mock .dim { opacity: .55; display: inline-flex; align-items: center; gap: 6px; }
.mock.m-menu { flex-direction: column; align-items: stretch; gap: 4px; padding: 6px; }
.mock.m-menu > span { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-radius: 8px; }
.mock.m-menu > span.hl { justify-content: space-between; }
.mock.m-top { justify-content: space-between; }
.mock svg { width: 20px; height: 20px; flex: none; }
.inst-warn { background: var(--tape); color: var(--tape-ink); border-radius: 12px; padding: 10px 12px; font-size: 14px; line-height: 1.4; }
`;
  document.addEventListener("DOMContentLoaded", async () => {
    const st = document.createElement("style"); st.textContent = css + (AVA ? avaCss : ""); document.head.appendChild(st);
    const wrap = document.querySelector(".wrap");
    const anchor = $("crumbs");

    // welcome card
    const wel = document.createElement("div"); wel.className = "welcome"; wel.id = "welcome"; wel.hidden = true;
    wel.innerHTML = '<h2>Привет! Это Колчан</h2>' +
      '<div class="note">Записывай, где лежат вещи, складывай их в сумки и не теряй в поездках. Всё хранится только на твоём телефоне.</div>' +
      '<ol><li><b>Места</b> — где хранишь: дом, дача, у друга.</li><li><b>Сумки</b> — рюкзак, чехол: переезжают вместе с содержимым.</li><li><b>Вещи</b> — кладёшь в место или в сумку, история пишется сама.</li></ol>' +
      '<div class="row2"><button type="button" class="primary" id="wel-start">Начать: добавить место</button></div>';
    wrap.insertBefore(wel, anchor);
    const rem = document.createElement("div"); rem.className = "remind"; rem.hidden = true;
    rem.innerHTML = '<span>База хранится только на этом телефоне. Сделай резервную копию — займёт 10 секунд.</span><div class="rbtn"><button type="button" class="ghost" id="rem-later">Позже</button><button type="button" id="rem-do">Сохранить копию</button></div>';
    wrap.insertBefore(rem, anchor);
    const membar = document.createElement("div"); membar.className = "remind"; membar.hidden = true;
    membar.innerHTML = '<span>Здесь браузер не даёт сохранять данные: после закрытия всё пропадёт. В приложении на экране «Домой» всё сохраняется.</span>';
    wrap.insertBefore(membar, wel);

    // feedback button + sheet
    const dataBtn = $("data-open");
    const fbBtn = document.createElement("button"); fbBtn.type = "button"; fbBtn.className = "link"; fbBtn.id = "fb-open"; fbBtn.textContent = "Отзыв";
    dataBtn.parentElement.insertBefore(fbBtn, dataBtn);
    const ver = window.__KOLCHAN_VERSION || "";
    const fb = document.createElement("div"); fb.className = "sheet-bg"; fb.id = "fb-bg"; fb.hidden = true;
    fb.innerHTML = '<div class="sheet"><h2>Отзыв о Колчане</h2>' +
      '<div class="note">Что неудобно, что сломалось, чего не хватает — пиши как есть. Сообщение уйдёт в Telegram автору, <span class="fb-nick">@' + TG + '</span>.</div>' +
      '<label>Сообщение<textarea id="fb-text" rows="5" placeholder="Например: не нашёл, как переложить сразу несколько вещей"></textarea></label>' +
      '<div class="note" id="fb-meta"></div>' +
      '<a class="primary" id="fb-send" href="https://t.me/' + TG + '" target="_blank" rel="noopener">Написать в Telegram</a>' +
      '<button type="button" id="fb-copy">Скопировать текст</button>' +
      '<div class="ok" id="fb-msg" hidden></div>' +
      '<div class="actions"><div class="right"><button type="button" id="fb-close">Закрыть</button></div></div></div>';
    document.body.appendChild(fb);
    const meta = "Колчан " + ver + " · " + device();
    $("fb-meta").textContent = "К сообщению добавится: " + meta;
    const fullText = () => ($("fb-text").value.trim() || "Отзыв о Колчане") + "\n\n— " + meta;
    const upd = () => { $("fb-send").href = "https://t.me/" + TG + "?text=" + encodeURIComponent(fullText()); };
    $("fb-text").addEventListener("input", upd); upd();
    fbBtn.onclick = () => { $("fb-msg").hidden = true; fb.hidden = false; };
    $("fb-close").onclick = () => { fb.hidden = true; };
    fb.addEventListener("click", (e) => { if (e.target === fb) fb.hidden = true; });
    $("fb-copy").onclick = async () => {
      const m = $("fb-msg");
      try { await navigator.clipboard.writeText(fullText()); m.textContent = "Скопировано. Вставь в чат с @" + TG + "."; }
      catch (e) { $("fb-text").select(); m.textContent = "Выдели текст и скопируй вручную."; }
      m.hidden = false;
    };


    // ---- install guide: shown on first open in a browser (not from the home-screen icon) ----
    const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    const I = {
      share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
      plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
      dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
      vdots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
      back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>',
      tabs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="12" height="12" rx="2"/><path d="M8 20h10a2 2 0 0 0 2-2V8"/></svg>',
      book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z"/><path d="M12 6v14"/></svg>',
      copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>'
    };
    const iosSteps =
      '<li><div class="txt">Внизу Safari нажми «Поделиться»<small>Если кнопки не видно — сначала нажми ' + '«⋯» справа внизу, «Поделиться» будет в меню.</small></div>' +
        '<div></div><div class="mock m-bar"><span class="dim">' + I.back + '</span><span class="hl">' + I.share + '</span><span class="dim">' + I.book + '</span><span class="dim">' + I.tabs + '</span><span class="dim">' + I.dots + '</span></div></li>' +
      '<li><div class="txt">Пролистай меню вниз и выбери «На экран „Домой“»</div>' +
        '<div></div><div class="mock m-menu"><span class="dim">Скопировать ' + I.copy + '</span><span class="dim">Добавить в Избранное ' + I.book + '</span><span class="hl">На экран «Домой» ' + I.plus + '</span></div></li>' +
      '<li><div class="txt">Нажми «Добавить» справа вверху</div>' +
        '<div></div><div class="mock m-top"><span class="dim">Отменить</span><span style="font-weight:600">Колчан</span><span class="hl">Добавить</span></div></li>' +
      '<li><div class="txt">Открой Колчан с новой иконки на экране «Домой»</div></li>';
    const androidSteps =
      '<li><div class="txt">В Chrome нажми «⋮» справа вверху</div>' +
        '<div></div><div class="mock m-bar"><span class="dim">kolchan</span><span class="hl">' + I.vdots + '</span></div></li>' +
      '<li><div class="txt">Выбери «Добавить на главный экран» или «Установить приложение»</div>' +
        '<div></div><div class="mock m-menu"><span class="dim">Поделиться…</span><span class="hl">Добавить на главный экран ' + I.plus + '</span></div></li>' +
      '<li><div class="txt">Подтверди — «Добавить» или «Установить»</div></li>' +
      '<li><div class="txt">Открой Колчан с новой иконки</div></li>';
    const inst = document.createElement("div"); inst.className = "sheet-bg"; inst.id = "inst-bg"; inst.hidden = true;
    inst.innerHTML = '<div class="sheet"><h2>Поставь Колчан на экран «Домой»</h2>' +
      '<div class="note">Так он станет обычным приложением: откроется одним нажатием и будет работать без интернета.</div>' +
      '<ol class="inst-steps">' + (isAndroid ? androidSteps : iosSteps) + '</ol>' +
      '<div class="inst-warn">Вещи записывай уже в приложении с иконки. ' + (isIOS || !isAndroid ? 'На iPhone у Safari и у иконки разные базы: то, что внесёшь здесь, в приложение не перейдёт.' : 'Так база точно не потеряется.') + '</div>' +
      '<div class="actions"><div class="right"><button type="button" id="inst-close">Понятно</button></div></div></div>';
    document.body.appendChild(inst);
    const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
    const closeInst = () => { inst.hidden = true; lsSet("kolchanb.installSeen", "1"); };
    $("inst-close").onclick = closeInst;
    inst.addEventListener("click", (e) => { if (e.target === inst) closeInst(); });
    window.__showInstall = () => { inst.hidden = false; };
    if (!standalone) {
      // link in the welcome card and in «Данные»
      const how = document.createElement("button"); how.type = "button"; how.className = "link"; how.textContent = "Как поставить на экран «Домой»";
      how.onclick = window.__showInstall; wel.appendChild(how);
      const dSheet = $("data-bg") && $("data-bg").querySelector(".dataBtns");
      if (dSheet) { const b2 = document.createElement("button"); b2.type = "button"; b2.textContent = "Как поставить на экран «Домой»"; b2.onclick = () => { $("data-bg").hidden = true; window.__showInstall(); }; dSheet.appendChild(b2); }
      if (!window.__KOLCHAN_SEED && (window.__KOLCHAN_PREVIEW || !lsGet("kolchanb.installSeen"))) setTimeout(window.__showInstall, 400);
    }

    // ---- avatar menu: «Аккаунт» (beta), «Отзыв», «Данные» live behind one round button ----
    if (AVA) {
    const fb2 = document.createElement("div"); fb2.className = "fab-blur"; fb2.setAttribute("aria-hidden", "true");
    document.body.appendChild(fb2);
    // show the strip only while the bottom buttons are on screen
    const syncBlur = () => { const a = $("add"); fb2.hidden = !a || a.hidden; };
    if ($("add")) new MutationObserver(syncBlur).observe($("add"), { attributes: true, attributeFilter: ["hidden"] });
    syncBlur();
    const right = $("data-open").parentElement;
    // the counter and the quiver name go under the centred title
    const tt = document.querySelector("header .tt");
    if (tt) { const sub = document.createElement("div"); sub.className = "tsub"; const cnt = $("count"), qn = $("q-cur"); if (cnt) sub.appendChild(cnt); if (qn) sub.appendChild(qn); tt.appendChild(sub); }
    const ava = document.createElement("button"); ava.type = "button"; ava.className = "ava"; ava.id = "ava"; ava.setAttribute("aria-label", "Меню"); ava.setAttribute("aria-haspopup", "menu");
    const person = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
    const ICON = {
      "acc-open": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
      "fb-open": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
      "data-open": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>'
    };
    right.appendChild(ava);
    let menu = null;
    const warnIn = (id) => { const b = $(id); return !!(b && /⚠/.test(b.textContent)); };
    function paintAva() {
      const acc = window.__kolchanAccount && window.__kolchanAccount();
      const warn = ["acc-open", "data-open"].some(warnIn);
      ava.classList.toggle("on", !!acc);
      ava.innerHTML = (acc ? '<span>' + ((acc.email || "?")[0] || "?").toUpperCase() + "</span>" : person) + (warn ? '<span class="dot"></span>' : "");
    }
    function closeMenu() { if (menu) { menu.remove(); menu = null; ava.setAttribute("aria-expanded", "false"); } }
    function openMenu() {
      closeMenu();
      menu = document.createElement("div"); menu.className = "ava-menu"; menu.setAttribute("role", "menu");
      const acc = window.__kolchanAccount && window.__kolchanAccount();
      if ($("acc-open")) { const w = document.createElement("div"); w.className = "who"; w.textContent = acc ? (acc.email || "Аккаунт") : "Ты не вошёл"; menu.appendChild(w); }
      [["acc-open", acc ? "Аккаунт" : "Войти"], ["fb-open", "Отзыв"], ["data-open", "Данные"]].forEach(([id, label]) => {
        const src = $(id); if (!src) return;
        const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem");
        b.innerHTML = ICON[id] + "<span></span>" + (warnIn(id) ? '<span class="warn">⚠</span>' : "");
        b.querySelector("span").textContent = label;
        b.onclick = () => { closeMenu(); src.click(); };
        menu.appendChild(b);
      });
      right.appendChild(menu); ava.setAttribute("aria-expanded", "true");
    }
    ava.onclick = (e) => { e.stopPropagation(); if (menu) closeMenu(); else openMenu(); };
    document.addEventListener("click", (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
    window.__kolchanPaintAva = paintAva;
    setTimeout(() => {
      ["acc-open", "data-open"].forEach(id => { const b = $(id); if (b) new MutationObserver(paintAva).observe(b, { childList: true, characterData: true, subtree: true }); });
      paintAva();
    }, 0);
    }

    // data from the store
    const store = window.__store || window.claude;
    const db = await store.use("db");
    if (!db) return;
    const state = { places: [], bags: [], items: [] };
    async function refresh() {
      const total = state.places.length + state.bags.length + state.items.length;
      wel.hidden = total > 0;
      let show = false;
      try {
        const sync = await K.get("meta", "sync");
        const cloud = await K.get("meta", "cloudSession");
        const last = await K.get("meta", "lastExport");
        const snooze = await K.get("meta", "remindSnooze");
        const real = state.items.length;
        const now = Date.now();
        show = !(sync && sync.token) && !(cloud && cloud.access_token) && real >= 5 && (!last || now - last.t > 7 * DAY) && !(snooze && snooze.until > now);
      } catch (e) {}
      rem.hidden = !show || !!window.__kolchanMemory || !!window.__KOLCHAN_SEED;
      membar.hidden = !window.__kolchanMemory;
    }
    window.__kolchanRemind = refresh;
    ["places", "bags", "items"].forEach(c => db.collection(c).onSnapshot((s) => { state[c] = s.docs.map(d => Object.assign({ id: d.id }, d.data())); refresh(); }));

    $("wel-start").onclick = () => { const a = $("add"); a.click(); setTimeout(() => { const p = $("add-place"); if (p) p.click(); }, 50); };
    $("rem-later").onclick = async () => { await K.put("meta", { key: "remindSnooze", until: Date.now() + 3 * DAY }); refresh(); };
    $("rem-do").onclick = () => { $("data-open").click(); setTimeout(() => $("d-export").click(), 100); };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  });
})();
