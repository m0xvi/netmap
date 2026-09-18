# NetMap — Handoff документ для нового агента

> **Что это:** самодостаточное описание проекта NetMap для передачи в новую сессию агента, у которого есть доступ к GitHub-репозиторию `m0xvi/netmap`.
> **Прочитай целиком перед первой правкой.** Здесь собраны все боевые грабли, чтобы не наступить на них заново.
> **Дата составления:** версия v0.50.0

---

## 🚨 Если прочитаешь только одно — прочитай это

> ### `.exe` собирает **GitHub Actions**, а не агент.
> ### Агент делает только: правки кода → `tsc`/`vite build` (проверка) → commit → push → **git tag + push tag**.
> ### **Никогда** не запускать `npm run build:win` локально. **Никогда** не просить об этом пользователя.
>
> Подробности: **§0.1** ниже.
>
> ```
> Агент                    GitHub Actions (windows-runner)         Пользователь
> ─────                    ──────────────────────────────         ────────────
> правит код
> tsc --noEmit (проверка)
> vite build   (проверка)
> git commit + push
> git tag vX.Y.Z
> git push origin vX.Y.Z ──▶ npm ci
>                            strip-cpu-features.cjs
>                            electron-builder install-app-deps
>                            npm run publish:win
>                                     │
>                                     ▼
>                            GitHub Releases:  ──────────────▶  баннер «Доступна vX.Y.Z»
>                            NetMap-Setup-X.Y.Z.exe             → клик «Обновить»
>                            latest.yml                         → авто-перезапуск
> ```

---

## 0. TL;DR — первые 60 секунд

**NetMap** — Windows desktop-приложение (Electron + React) для сисадмина отеля: интерактивная схема сети, которая заменяет статичные картинки из Visio/draw.io. Ведёт инвентарь устройств, портов, VLAN, кабелей, паролей (встроенный vault), мониторит ping, импортирует конфиги с MikroTik / UniFi / Omada и умеет автообнаружение топологии по LLDP/SNMP.

**Пользователь** — сисадмин отелей, работает на Windows, проект ведётся итеративно через чат. Общение **на русском**, технические термины на английском ок.

**Текущая версия:** `0.50.0`. Репозиторий: `github.com/m0xvi/netmap`.

**Первое, что нужно сделать:**
```bash
git clone https://github.com/m0xvi/netmap.git
cd netmap
npm install
npm run dev          # → http://localhost:5173 (браузер) или npm run electron:dev
npx tsc --noEmit     # обязательно проверять перед каждой правкой кода
```

---

## 0.1 ⚠️ ГЛАВНОЕ ПРАВИЛО ПО СБОРКЕ — читать первым

> ### 🚫 Агент **НЕ СОБИРАЕТ** `.exe`. Сборку производит **GitHub Actions**.
>
> `.exe` **никогда** не собирается локально агентом, и **не надо просить пользователя**
> запускать `npm run build:win` на его машине. Раньше это был локальный процесс —
> **теперь нет.**

### Как это работает

```
Агент правит код → git push (код) → git tag vX.Y.Z → git push origin vX.Y.Z
                                                              ↓
                                          ┌───────────────────────────────────┐
                                          │  GitHub Actions (windows-latest)  │
                                          │  .github/workflows/release.yml    │
                                          │                                   │
                                          │  1. npm ci                        │
                                          │  2. strip-cpu-features.cjs        │
                                          │  3. electron-builder install-app-deps
                                          │  4. npm run publish:win           │
                                          └───────────────────────────────────┘
                                                              ↓
                                     GitHub Releases: NetMap-Setup-X.Y.Z.exe
                                                    + NetMap-X.Y.Z.exe (portable)
                                                    + latest.yml  ← для auto-updater
                                                              ↓
                                     Пользователь получает обновление автоматически
                                     (баннер «Доступна новая версия» в приложении)
```

### Что это значит на практике

| Задача | Кто делает | Как |
|---|---|---|
| Написать / поправить код | **Агент** | правки в `src/`, `electron/` |
| Проверить типы и сборку | **Агент** | `npx tsc --noEmit` + `npx vite build` (только проверка!, не `.exe`) |
| Собрать `.exe` | **GitHub Actions** | автоматически на push тэга `v*` |
| Опубликовать в Releases | **GitHub Actions** | автоматически, `GH_TOKEN` = `secrets.GITHUB_TOKEN` |
| Раздать пользователям | **electron-updater** | читает `latest.yml` из Releases |
| `npm run build:win` локально | **никто** | скрипт существует, но **штатно не используется** |

### Почему так
- Windows-runner GitHub имеет всё нужное окружение (MSVC для `better-sqlite3` и т.п.) — локальная машина пользователя **не имеет** Build Tools и не должна
- Один источник истины для артефактов — Releases. Не бывает «у меня собралось, а у тебя нет»
- Auto-updater работает только с артефактами из Releases, локальная сборка ему бесполезна
- Агент физически не может собрать Windows `.exe` на Linux-песочнице

### Что агент делает вместо сборки
```bash
# 1. Проверить, что код компилируется (НЕ сборка .exe — просто проверка)
npx tsc --noEmit
npx vite build            # → dist/ (проверка бандла, ~6 сек)

# 2. Поднять версию
npm version 0.51.0 --no-git-tag-version

# 3. Закоммитить и запушить
git add .
git commit -m "v0.51.0: описание изменений"
git push

# 4. Тэг — ЭТО ЗАПУСКАЕТ СБОРКУ НА GITHUB
git tag v0.51.0
git push origin v0.51.0   # ← обязательно явно, `git push` тэги НЕ пушит

# 5. Сказать пользователю: подожди 5-10 мин, потом проверь Actions/Releases
```

**Всё.** Агент на этом свою работу по релизу закончил. `.exe` появится сам.

### Что НЕЛЬЗЯ говорить пользователю
- ❌ «Запусти `npm run build:win`» — не надо, это делает CI
- ❌ «Собери локально и проверь» — сборка не локальная
- ❌ «Удали `release/` и пересобери» — папки `release/` на машине пользователя вообще не должно быть
- ❌ «Мне нужно собрать .exe, чтобы проверить» — агент проверяет через `tsc` + `vite build` + dev-сервер, не через `.exe`

### Что МОЖНО говорить
- ✅ «Запушь код и тэг — GitHub Actions соберёт `.exe` за 5-10 минут»
- ✅ «Проверь https://github.com/m0xvi/netmap/actions — там идёт сборка»
- ✅ «Через 10 минут обновление придёт само (auto-updater)»

### Резервный путь (только если CI сломан)
Если GitHub Actions недоступен или падает и надо срочно выпустить релиз — **тогда** можно
собрать локально через `npm run publish:win` с `GH_TOKEN`. Это **исключение**, не норма.
Подробности в §8.6. Не предлагать этот путь без явной причины.

---

## 1. Стек и требования

| Компонент | Версия | Зачем |
|---|---|---|
| Electron | 33 | Оболочка, доступ к SQLite/SSH/сети |
| React | 18.3 | UI |
| TypeScript | 5.6 | Строгая типизация, `strict: true` |
| Vite | 5.4 | Сборка, `base: './'` (обязательно для Electron) |
| @xyflow/react | v12 | Канвас схемы (React Flow) |
| zustand | 5.0 | State (single store, `src/store.ts`) |
| dagre | 0.8 | Auto-layout |
| better-sqlite3 | 11 | Локальная БД (main process) |
| ssh2 | 1.17 | MikroTik SSH, SSH-терминал |
| net-snmp | 3.26 | SNMP-опрос (pure JS!) |
| electron-updater | 6.8 | Автообновления через GitHub Releases |
| kdbxweb + argon2-browser | — | Импорт/экспорт .kdbx (KeePass) |
| xterm + xterm-addon-fit | 5.3 | SSH-терминал в UI |
| qrcode | 1.5 | QR-шаринг паролей |
| html-to-image | 1.11 | Экспорт схемы в PNG |

**Node.js 20+, npm 10+.**

### 🚨 MSVC / Visual Studio Build Tools НЕ ДОЛЖНЫ требоваться
Критично. `ssh2` тянет нативный `cpu-features` (требует node-gyp → MSVC). Пользователь на Windows без Build Tools, поэтому есть `scripts/strip-cpu-features.cjs`, который **удаляет** `node_modules/cpu-features` и `nan`. Он вызывается:
- в `postinstall` (автоматически, у всех — и у агента, и у CI)
- **явно перед сборкой** внутри `build:win` / `publish:win` — то есть когда эти скрипты запускает **GitHub Actions** (см. §0.1)

**Правило:** любой новый npm-пакет с нативными зависимостями — сначала проверить, не сломает ли он сборку без MSVC. `net-snmp` выбран именно поэтому (pure JS, зависит только от `asn1-ber` + `smart-buffer`).

> ⚠️ Важно: **Windows-runner GitHub Actions имеет MSVC** и может собрать `better-sqlite3` — а вот машина пользователя нет. Поэтому единственный безопасный путь сборки — CI.

---

## 2. КРИТИЧЕСКИЕ ПРАВИЛА (нарушение = баг)

### 2.1 Никаких `alert()` / `confirm()` / `prompt()`
Electron с `contextIsolation: true` их **не поддерживает** — вызов вешает рендерер. Использовать из `src/Modal.tsx`:
```ts
const name = await promptText('Новое имя:', currentName);
const ok   = await confirmDialog('Удалить N устройств?', 'Текст', { danger: true, okText: 'Удалить' });
await alertDialog('Готово', 'Сообщение');
```

### 2.2 Никаких эмодзи в UI
Пользователь настаивал многократно. **Только inline SVG.** Примеры готовых иконок: `src/icons.tsx` (ICONS для device kinds), а также локальные SVG-функции в компонентах (`IconKey`, `IconCopy`, `IconEye`, `IconTrash` и т.д. в `VaultStudio.tsx`).
- Исключение: HTML `<select>` может содержать тире/стрелки, пункты меню в `MenuBar.tsx` используют типографские символы (`↯`, `⌘`, `⌥`, `⚙`, `⏱`) — это Unicode-символы, не эмодзи, они допустимы и уже в коде.
- Спиннеры/индикаторы — из `src/Spinner.tsx` (`MiniSpinner`, `ProgressStripe`, `ProgressBar`, `FullscreenSpinner`, `Skeleton`, `btnBusy`).

### 2.3 `base: './'` в `vite.config.ts`
Без него Electron открывает `file://` и все ассеты 404'ятся. **Не менять.**

### 2.4 Проверять сборку перед любым коммитом
```bash
npx tsc --noEmit     # TS-ошибки
npx vite build       # production-сборка
```
Оба должны проходить чисто. Никаких новых warning'ов лучше не добавлять.

### 2.5 Стабильные референсы в zustand-селекторах
```ts
// ❌ ПЛОХО — новый [] каждый рендер → React error #185 (Maximum update depth)
const vlans = useStore(s => s.doc.vlans || []);

// ✅ ХОРОШО
const EMPTY_VLANS = Object.freeze([]) as readonly Vlan[];
const vlans = useStore(s => s.doc.vlans) || EMPTY_VLANS;
```
В `store.ts` уже есть `EMPTY_STR_SET`, `EMPTY_HISTORY`, `EMPTY_VLANS` — переиспользовать.

### 2.6 Никогда не отдавать `NaN` / `Infinity` в координаты
Исторический баг: `Math.max(...emptyArray)` → `-Infinity` → `NaN` → устройство исчезало с канваса. Есть `safeFinite()` guards в `store.ts` и `setPosition`. При любой арифметике позиций — проверять `Number.isFinite`.

### 2.7 Не дублировать функционал
Перед реализацией фичи — проверить, нет ли её уже. Например, auto-updater, auto-layout, port-picker, VLAN CRUD уже есть.

---

## 3. Структура проекта

```
netmap/
├── electron/                    # main process (~17 файлов)
│   ├── main.cjs                 # все IPC handlers, lazy require через getX()
│   ├── preload.cjs              # contextBridge → window.netmap.*
│   ├── db.cjs                   # SQLite: kv, templates, vault_*, doc_backups, favicon_cache
│   ├── vault.cjs                # AES-256-GCM + PBKDF2 200k, TOTP, generator, audit
│   ├── vault-kdbx.cjs           # .kdbx bridge (kdbxweb + webcrypto)
│   ├── mikrotik-ssh.cjs         # RouterOS CLI через ssh2 (broad algos для legacy!)
│   ├── mikrotik.cjs             # RouterOS REST API
│   ├── snmp.cjs                 # net-snmp обёртка (get/walk/table/probe)
│   ├── discovery.cjs            # автообнаружение: LLDP + FDB + ARP → diff proposal
│   ├── ssh-shell.cjs            # интерактивный shell (ssh2, БЕЗ node-pty)
│   ├── rdp.cjs                  # генерация .rdp + shell.openPath
│   ├── favicon.cjs              # google.com/s2/favicons + SQLite кэш 30д
│   ├── ping.cjs / wol.cjs / traceroute.cjs / telegram.cjs / updater.cjs
│   └── importers/               # per-vendor: unifi.cjs ✅, omada-cloud.cjs ✅,
│                                #   ruijie.cjs ⚠️stub, dlink.cjs ⚠️stub, edgeswitch.cjs ⚠️stub
│
├── src/                         # renderer (100 файлов)
│   ├── store.ts                 # 1608 строк, zustand, ВСЁ состояние
│   ├── types.ts                 # Device, Port, Link, Group, Vlan, NetMapDoc (schema v3)
│   ├── App.tsx                  # layout + host-компоненты
│   ├── Canvas.tsx               # ReactFlow root (1322 строки)
│   ├── autoLayout.ts            # dagre: computeAutoLayout(doc)
│   ├── smartLayout.ts           # autoGroupDevices + gridifyGroupsIfNeeded
│   ├── persistence.ts           # hydrate/persist (SQLite ↔ localStorage)
│   └── ...компоненты (см. §6)
│
├── scripts/strip-cpu-features.cjs   # критично для сборки без MSVC
├── .github/workflows/ci.yml         # typecheck+build на каждый push
├── .github/workflows/release.yml    # .exe на тэг v*
├── build/icon.ico + icon.png        # иконка приложения
└── README.md                        # полная история версий v0.1 → v0.50
```

### Схема документа (`NetMapDoc`, schema v3)
```ts
{
  version: 3,
  name: string,
  groups: Group[],     // { id, name, x, y, width, height, color?, collapsed?, subtitle?, parentId? }
  devices: Device[],   // см. ниже
  links: Link[],       // { id, fromDeviceId, fromPortId?, toDeviceId, toPortId?, cable?, vlan?, vlans?, label? }
  stickies?: StickyNote[],
  vlans?: Vlan[],      // { id, vlanId(1-4094), name, color, cidr?, gateway?, description? }
}
```
**Автомиграция v1→v2→v3** в `normalize()` внутри `store.ts`. Не ломать.

### `Device` — ключевые поля
```ts
{
  id, name, kind,                          // kind: router|switch|patchpanel|ap|camera|server|vm|vps|pc|pos|printer|lock|cloud
  model?, vendor?, ip?, mac?, mgmtUrl?, location?,
  ports: Port[],                           // { id, label?, type?, speed?, poe?, status?, vlan?, vlans?, vlanMode? }
  credential?,  credentialId?,             // credential.vaultItemId — привязка к vault
  tags?, x, y, groupId?, hostDeviceId?,    // hostDeviceId — VM → хост
  vmInfo?, display?,                       // display: 'compact' | 'rack'
  layer?,                                  // core | distribution | access
  liveStatus?, lastRttMs?, lastCheckedAt?, // ping-монитор
  hostSpec?, dvr?, ssids?, cameraIds?, wolBroadcastIp?,
}
```
**`Port.vlanMode`** (v0.48): `'access' | 'trunk' | 'hybrid'`. Если undefined — инферится из legacy: `port.vlans.length > 0 → trunk`, `port.vlan != null → access`.
- `port.vlan` = access VLAN / trunk native (PVID)
- `port.vlans[]` = allowed tagged VLANs (только trunk/hybrid)

---

## 4. Архитектурные паттерны

### 4.1 Store — единая zustand-точка
`src/store.ts` содержит **всё**: doc, selection, UI-настройки, history, alerts, workspace (несколько проектов).

- **Persist:** `persist(doc)` дебаунс 400ms → в main-process SQLite + localStorage fallback
- **Undo/Redo:** snapshot-based, coalescing 400ms, лимит 50 снимков (`historyPush(s)`)
- **Любая мутация doc должна проходить через `historyPush`**, иначе не откатится

### 4.2 CustomEvents для межузловой коммуникации
Вместо prop-drilling — `window.dispatchEvent(new CustomEvent('netmap:...'))`. Полный список:

| Event | Кто слушает | Зачем |
|---|---|---|
| `netmap:hydrated` | Canvas | Проект загружен → fitView |
| `netmap:fit-view` | Canvas | Клавиша F / меню |
| `netmap:focus-device` | FocusView | Открыть focus mode |
| `netmap:layout-applied` | Canvas | После auto-layout → fitView |
| `netmap:open-dialog` | SettingsDialogHost, MenuBar | `{ detail: { name: 'settings'\|'help', tab? } }` |
| `netmap:open-vault-studio` | VaultStudio | Полноэкранный vault (Ctrl+K) |
| `netmap:open-import-dialog` | MenuBar | `{ detail: { vendor? } }` |
| `netmap:open-mikrotik-import` | MenuBar | Открыть MikroTik-импортёр |
| `netmap:open-discovery` | MenuBar | Автообнаружение топологии |
| `netmap:open-onboarding` | OnboardingHost | Введение |
| `netmap:open-alerts` | AlertsPanel | Центр уведомлений |
| `netmap:open-traceroute` | TracerouteDialog | `{ detail: { from?, to? } }` |
| `netmap:open-ssh-terminal` | SshTerminalDialog | |
| `netmap:progress-start` / `-end` | LoadingOverlay | `{ detail: { id, title, message? } }` |
| `netmap:clear-rf-selection` | Canvas | Сбросить выделение React Flow |

**Правило:** новый кросс-компонентный сигнал — добавлять сюда и документировать.

### 4.3 IPC — тонкий слой
`electron/preload.cjs` → `window.netmap.<method>()` → `ipcMain.handle('netmap:<name>')` в `main.cjs`.

Все handler'ы обёрнуты в `safeInvoke()` — ошибка не крашит main, возвращается `{ ok: false, error }`.

Lazy require через `getDb()`, `getVault()` и т.д. — чтобы не грузить better-sqlite3 при старте.

**Новый IPC** = 3 правки: `main.cjs` (handle) + `preload.cjs` (метод) + `src/*Client.ts` (обёртка с fallback для browser preview).

### 4.4 Работа в двух средах
Приложение должно работать **и** в `npm run dev` (браузер, без Electron), **и** в собранном .exe.
Все `*Client.ts` имеют проверку:
```ts
const hasBackend = typeof window !== 'undefined' && !!(window as any).netmap?.someMethod;
if (!hasBackend) return /* mock или graceful degrade */;
```

### 4.5 Прогресс долгих операций
```ts
window.dispatchEvent(new CustomEvent('netmap:progress-start', {
  detail: { id: 'my-op', title: 'Считаем…', message: 'Подробнее' }
}));
// ... sync или async работа ...
window.dispatchEvent(new CustomEvent('netmap:progress-end', { detail: { id: 'my-op' } }));
```
Есть параллельные задачи (счётчик по id).

---

## 5. Боевые баги — не воспроизводить

Это грабли, на которые уже наступали. **При правке смежного кода — проверить, не сломано ли.**

### 5.1 React error #185 (Maximum update depth) — серия
**Причина:** селекторы возвращали новый объект/массив каждый рендер.
**Фикс:** стабильные `EMPTY_*` референсы + zustand version tick + `handleNodesChange` пропускает эхо position-changes из React Flow.

### 5.2 ResizeObserver loop
**Фикс:** ErrorBoundary игнорирует + batch `applyPositions`.

### 5.3 Пропадают устройства после «Разложить»
**Причина:** `Math.max(...anchorX.values())` на пустом Map → `-Infinity` → `NaN`.
**Фикс:** `anchorXs.length > 0 ? Math.max(...) : 0` + `safeFinite` guards.
Плюс `addPort` ищет FREE `ethN`, `setPosition`/`setGroupPosition` отклоняют NaN.

### 5.4 Modern links не рисовались (v0.42.1)
**Причина:** `groupEndpoints()` использовал `link.aDeviceId/bDeviceId`.
**Правильно:** `link.fromDeviceId/toDeviceId`. Компонент `PortHandles` (invisible Handle per port + fallback `_top/_right/_bottom/_left`).

### 5.5 Recovery от «пустой карты» (v0.41.1)
Safety net в Canvas: listener `netmap:hydrated` → fitView в 3 попытки. Guard: если все устройства в области <50×50 px и их >3 → alert. Клавиша **F** = fit-view.
**Важно:** в legacy mode `doc.links` убран из deps `initialNodes` — был storm ремаунтов.

### 5.6 Кнопка «Импорт» в sidebar мертва (v0.44.1 → v0.44.2)
**Причина 1:** `MenuBar` не слушал `netmap:open-mikrotik-import`.
**Причина 2:** `ImportDialog` сохранял `'mikrotik'` в LS `netmap:import:last-vendor` → при следующем открытии срабатывал useEffect-редирект + `onClose()`.
**Причина 3 (главная):** `if (vendor === 'mikrotik') return null;` — компонент исчезал визуально, но `open` в родителе оставался `true` → React short-circuit'ил setState → клик по кнопке ничего не делал.
**Фикс:** убрать `return null`, сделать vendor-picker сеткой плиток, редирект через `pickVendor()` с `useRef` guard, не сохранять `'mikrotik'` в LS + одноразовая миграция.

### 5.7 Auto-updater «обновил», но версия та же
**Причина 1:** тэг не запушен (`git push` не пушит тэги!) → CI не запустился → в Releases нет новой версии.
**Причина 2 (v0.44.3):** версия была **захардкожена** в `SettingsDialog.tsx`.
**Фикс:** vite `define` пробрасывает `__APP_VERSION__` из `package.json` → `src/globals.d.ts` объявляет типы. Плюс version badge в toolbar для наглядности.

### 5.8 Smart Layout не работал (v0.50.0)
**Причина:** importUtils создаёт группы `g-net-*`; smartLayout считал их user-группами → не трогал. А `computeAutoLayout` для N групп без inter-group edges → dagre выстраивал их **в одну линию**.
**Фикс:** `AUTO_LIKE_PREFIXES = ['auto-', 'g-net-']` + `gridifyGroupsIfNeeded()` (wrap в √N×√N grid если суммарная ширина > 3600px), вызывается в `store.autoLayout` после `computeAutoLayout`.

### 5.9 MikroTik legacy handshake
Пользователь **не может** обновить production-роутер, поэтому в `mikrotik-ssh.cjs` — **broad algorithms list** (включая `diffie-hellman-group1-sha1`, `3des-cbc`, `hmac-md5`).
⚠️ **`chacha20-poly1305@openssh.com` намеренно НЕ в списке** — на некоторых Electron-сборках ssh2 падает при валидации опций (`Unsupported algorithm`) ещё до коннекта.
Ещё есть auto-retry: если падает с `Unsupported algorithm: X`, алгоритм удаляется и попытка повторяется.

### 5.10 Иконка приложения пропадает
`build/icon.ico` и `icon.png` **регулярно исчезают** из снапшотов workspace. Регенерация:
```bash
# generate_image → build/icon.png
magick icon.png -resize 256x256 -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```
**В git-репозитории иконки должны быть закоммичены** — тогда проблема уходит.

---

## 6. Карта компонентов (что где искать)

### Layout / chrome
| Файл | Что |
|---|---|
| `App.tsx` | Корневой layout, монтирование хостов |
| `MenuBar.tsx` | HTML-меню File/View/Tools/Monitor/Help + акселераторы Alt+F/V/T/M/H |
| `Toolbar.tsx` | ProjectMenu + ViewModeToggle (Modern/Legacy) + CompactViewToggle + поиск + alerts + version badge |
| `NewSidebar.tsx` | Activity bar: Топология / Устройства / Уведомления / Vault / Импорт / Settings |
| `RightPanel.tsx` | Правая панель: 24px rail + DevicePanel/GroupPanel/NetworkOverviewPanel. Кнопки ‹› (collapse) и ✕ (закрыть) |
| `LayoutFAB.tsx` | FAB в top-right, actions летят влево; smart-layout submenu |

### Канвас
| Файл | Что |
|---|---|
| `Canvas.tsx` | ReactFlow root, drop-хендлеры, MiniMap (кликабельная), recovery, hotkeys |
| `DeviceNode.tsx` / `SwitchNode.tsx` / `ServerNode.tsx` / `PatchPanelNode.tsx` | Legacy-карточки |
| `ModernDeviceNode.tsx` | Modern-карточки: круглые аватары, endpoint-chips, PortHandles |
| `GroupNode.tsx` | Контейнер-группа |
| `PortEdge.tsx` | Связь: smoothstep/bezier + edgeRouter + metric badge |
| `edgeRouter.ts` / `portSides.ts` | Ортогональная маршрутизация кабелей, dynamic handle sides |
| `FocusView.tsx` | Полноэкранный focus mode (двойной клик) |
| `MultiSelectBar.tsx` / `PathBanner.tsx` / `VlanFilterBanner.tsx` / `StickyStack.tsx` / `PoeButton.tsx` | Плавающие панели |

### Панели и диалоги
| Файл | Что |
|---|---|
| `DevicePanel.tsx` | **3074 строки**: InspectorHeader + 8 табов (Info/Ports/VLANs/Links/creds/alerts/config/hw) + PortMatrix |
| `GroupPanel.tsx` | Свойства группы |
| `NetworkOverviewPanel.tsx` | KPI-дашборд (4 тайла + bandwidth donut + utilization + alerts) |
| `CatalogPanel.tsx` | Smart Accordion по kind + AddDeviceModal |
| `DevicesTablePanel.tsx` | Плоская таблица с фильтрами + bulk delete |
| `VlansPanel.tsx` | Управление VLAN проекта + `VlanBadge` |
| `AlertsPanel.tsx` | Центр уведомлений (severity chips) |
| `ImportDialog.tsx` | Vendor-picker + формы UniFi/Omada |
| `MikrotikImportDialog.tsx` | MikroTik SSH/REST импортёр (1528 строк) + subnet picker |
| `DiscoveryDialog.tsx` | Автообнаружение: 4 фазы (Form → Scanning → Review → Done), 695 строк |
| `PortPickerDialog.tsx` | Порт-грид при drag-drop + replace flow, 523 строки |
| `OnboardingDialog.tsx` | 8 слайдов при первом запуске + seed loader, 774 строки |
| `SettingsDialog.tsx` | General/Monitor/Notify/Security/About + OrphanGridSection |
| `BackupsDialog.tsx` | Роллинг-снапшоты doc (лимит 20) |
| `Modal.tsx` | `promptText` / `confirmDialog` / `alertDialog` |
| `Spinner.tsx` | Общие индикаторы загрузки |

### Vault
| Файл | Что |
|---|---|
| `VaultPanel.tsx` | Сайдбар-версия (3 состояния: not-init / locked / unlocked) |
| `VaultStudio.tsx` | Полноэкранный 4-колоночный редактор (Ctrl+K), 1519 строк |
| `VaultImportExportDialog.tsx` | Import (.kdbx/Bitwarden/CSV) / Export / Migrate |
| `VaultImportExportDialog.tsx`, `PasswordGenerator.tsx`, `TotpChip.tsx`, `QrShareDialog.tsx` | Утилиты vault |
| `vaultCategories.ts` | Smart-категории из URL/tags |
| `vaultMatcher.ts` | Auto-suggest items по IP/name/URL |
| `vaultFolderTree.tsx` | ⚠️ Существует, но НЕ используется |

### Клиенты и утилиты
`importClient.ts`, `mikrotikClient.ts`, `discoveryClient.ts`, `vaultClient.ts`, `sshShellClient.ts`, `rdpClient.ts`, `pingClient.ts`, `tracerouteClient.ts`, `wolClient.ts`, `faviconClient.ts`, `updaterClient.ts`, `persistence.ts`, `workspace.ts`, `seed*.ts` (3 проекта), `templates.ts`, `layers.ts`, `vlanDefaults.ts`, `passwordHealth.ts`, `exportCanvas.ts`, `collide.ts`, `traceCable.ts`, `dialogShims.ts`

---

## 7. Рабочий процесс

### 7.1 Dev (что делает агент каждый день)
```bash
npm run dev            # Vite dev server → localhost:5173 (браузер)
npm run electron:dev   # concurrently: vite + electron
npx tsc --noEmit       # ОБЯЗАТЕЛЬНО перед любой отдачей результата
npx vite build         # проверка что бандл собирается (~6 сек)
```

**Важно:** `npx vite build` создаёт только `dist/` — это **проверка компиляции**,
а **не сборка `.exe`**. `.exe` собирает GitHub Actions (см. §0.1 и §8).

### 7.2 Проверка результата (что агент использует вместо .exe)

| Что нужно проверить | Как агент проверяет |
|---|---|
| Код компилируется | `npx tsc --noEmit` |
| Бандл собирается | `npx vite build` |
| UI работает | `npm run dev` → localhost:5173 (в браузере) |
| Логика Electron | `npm run electron:dev` (если доступен дисплей) |
| Работа в .exe | **не проверяет** — за это отвечает пользователь после релиза |

### 7.3 Пакетирование исходников (для передачи пользователю вручную)
Иногда (не для релиза, а чтобы пользователь просто посмотрел код) имеет смысл упаковать zip:
```bash
cd /home/user
zip -r netmap.zip netmap -x 'netmap/node_modules/*' 'netmap/dist/*' 'netmap/release/*' \
                            'netmap/.vite/*' 'netmap/.git/*'
```
Получается ~2 MB. Пользователь распаковывает, **удалив предварительно старую папку netmap**,
и далее либо запускает `npm run dev`, либо просто ждёт релиза через Actions.

**Это НЕ путь релиза.** Для релиза — только тэг + push (§8).

### 7.4 🚫 Чего агент НЕ делает
```bash
# ❌ НЕ ЭТО: это не наш путь
npm run build:win           # собирает .exe локально — НЕ ДЕЛАЕМ
npm run build:win:portable  # НЕ ДЕЛАЕМ
npm run build:win:dir       # НЕ ДЕЛАЕМ
npm run publish:win         # НЕ ДЕЛАЕМ (кроме аварийного случая, §8.6)
electron-builder --win      # НЕ ДЕЛАЕМ
```

Причины:
- Linux-песочница агента физически не соберёт Windows `.exe`
- Пользователь без MSVC / Build Tools — локальная сборка у него упадёт или отвалится по времени
- Артефакт из Releases — единственный источник, который видит auto-updater

---

## 8. GitHub: сборка, релиз и автообновление

> **Это ЕДИНСТВЕННЫЙ путь получения `.exe`.** Локальная сборка не используется (см. §0.1).

### 8.1 Как устроено
```
Агент: git push origin v0.51.0
   ↓
.github/workflows/release.yml  (windows-latest runner — НЕ машина агента, НЕ машина пользователя)
   ↓
1. Проверка: package.json.version == tag (иначе fail)
2. npm ci --ignore-scripts
3. node scripts/strip-cpu-features.cjs
4. npx electron-builder install-app-deps
5. npm run publish:win  (использует GH_TOKEN = secrets.GITHUB_TOKEN)
   ↓
GitHub Releases: NetMap-Setup-0.51.0.exe + NetMap-0.51.0.exe + latest.yml + *.blockmap
   ↓
Установленные NetMap.exe → electron-updater читает latest.yml → баннер «Доступна версия»
```

**Всё это происходит БЕЗ участия агента и пользователя.** Агент только пушит код и тэг.

Отдельно `.github/workflows/ci.yml` — на каждый push в main: `npm ci` + `tsc --noEmit` + `vite build` на Linux-runner (~1 мин, ловит ошибки до релиза).

### 8.2 `package.json` → единственный источник правды для публикации
```json
"publish": [
  { "provider": "github", "owner": "m0xvi", "repo": "netmap", "releaseType": "release" }
]
```
**Не менять** — пользователь просил зафиксировать, чтобы не редактировать каждый раз.

### 8.3 Как выпустить релиз (полный чек-лист агента)

```bash
# 1) Поднять версию
npm version 0.51.0 --no-git-tag-version
# ⚠️ SettingsDialog.tsx править НЕ надо — версия подтягивается из __APP_VERSION__

# 2) Проверить, что всё компилируется
npx tsc --noEmit       # должно быть пусто
npx vite build         # должно быть "✓ built in Xs"

# 3) Закоммитить и запушить код
git add .
git commit -m "v0.51.0: описание изменений"
git push

# 4) Тэг — ЭТО ЗАПУСКАЕТ СБОРКУ НА GITHUB ACTIONS
git tag v0.51.0
git push origin v0.51.0        # ← обязательно явно: `git push` ТЭГИ НЕ ПУШИТ
```

**Затем агенту следует:**
1. Сообщить пользователю: «Сборка запущена на GitHub Actions, ~5-10 минут»
2. Дать ссылки для проверки:
   - **https://github.com/m0xvi/netmap/actions** — прогресс сборки
   - **https://github.com/m0xvi/netmap/releases** — результат
3. На этом **всё** — агент не собирает `.exe`.

**Проверка после пуша (если пользователь сообщил о проблеме):**
- Actions показывает жёлтый ● → идёт сборка, подождать
- Actions показывает красный ✗ → кликнуть, посмотреть лог, разобрать (см. §8.4)
- Actions пусто → тэг не запушен (`git ls-remote --tags origin | findstr v0.51`)
- Releases пусто, Actions зелёный → ошибка на шаге `publish:win`, смотреть лог

### 8.4 Частые проблемы релиза
| Симптом | Причина | Решение |
|---|---|---|
| Actions пусто | тэг не запушен | `git push origin vX.Y.Z` |
| Actions красный: version mismatch | tag ≠ package.json.version | сверить; править `package.json`, не `.exe` |
| Actions красный: permission denied | нет прав GITHUB_TOKEN | Settings → Actions → General → Workflow permissions → «Read and write» |
| Actions зелёный, но нет .exe | ошибка в шаге `publish:win` | смотреть лог шага «Build & publish» |
| Auto-updater молчит | приложение запущено через `npm run dev` | updater работает **только** в собранном .exe |
| «Обновил», версия та же | в Releases только старая версия | проверить, что тэг совпадает с package.json и workflow прошёл |
| Пользователь ждал, но обновления нет | Windows закешировал .exe | перезапустить приложение / перезагрузить Windows |

### 8.5 Что пользователь делает для обновления
**Ничего.** После того как Actions опубликует релиз:
1. Установленный NetMap при следующем запуске сам увидит `latest.yml`
2. Покажет баннер «Доступна версия X.Y.Z»
3. Пользователь кликает «Обновить» → скачивается → перезапуск

**Единственное, что нужно от пользователя** — чтобы он один раз запушил код и тэг
(или чтобы это сделал агент, если у него есть write-доступ к репозиторию).

### 8.6 🔧 Резервный путь — ТОЛЬКО если CI недоступен

Это **исключение**, а не норма. Использовать, если:
- GitHub Actions отключён/недоступен
- Нужен одиночный хотфикс срочно, а CI лежит
- Пользователь явно просит

Тогда на **машине пользователя** (Windows, не у агента):
```bash
cd Q:\Desktop\netmap
taskkill /F /IM NetMap.exe
rmdir /s /q dist release
npm install

# GH_TOKEN — personal access token со scope "repo"
# (Settings → Developer settings → Personal access tokens → Tokens (classic))
set GH_TOKEN=ghp_xxxxxxxxxxxx

npm run publish:win
```
Через 3-5 минут артефакты окажутся на GitHub Releases, auto-updater подхватит как обычно.

**После этого — вернуться к штатному пути через Actions.**

---

## 9. Roadmap / открытые задачи

### Не реализовано (и явно запрашивалось)
| Задача | Приоритет | Заметки |
|---|---|---|
| **Ruijie / D-Link (SNMP) / EdgeSwitch (SSH) импортёры** | средний | `electron/importers/*.cjs` — заглушки с v0.37 |
| **UniFi UDM / UniFi OS** | средний | Сейчас только classic 8443; нужно `/proxy/network/` + `X-CSRF-Token` |
| **SNMP polling метрик** | высокий | CPU/RAM/if-counters → sparkline в DevicePanel. `electron/snmp.cjs` уже есть |
| **Триггеры/алерты по метрикам** | средний | `iface-down`, `cpu>80%` (в стиле Zabbix) |
| **Периодический re-discovery** | низкий | Скан раз в N минут, push в AlertsPanel |
| **Тёмная тема** | средний | Сейчас только Vault Studio + SSH-терминал тёмные |
| **HIBP breach check** | низкий | k-anonymity API для vault-паролей |
| **Reports / PDF-экспорт** | низкий | Карта + inventory в PDF |
| **Vault Sharing (multi-user)** | низкий | |
| **Bulk WoL** из MultiSelectBar / DevicesTable | низкий | Одиночный WoL есть |
| **MTR-style непрерывный traceroute** | низкий | Одиночный streaming есть |
| **LLDP/CDP автодискаверинг связей** | ✅ частично | `electron/discovery.cjs` работает, ждёт фидбека |
| **VaultFolderTree.tsx** | — | Файл лежит без использования. Может понадобиться для кастомных папок |

### Известные ограничения (не баги, так задумано)
- VMs скрыты с канваса, когда их хост развёрнут (`display: 'rack'`) — они рендерятся внутри карточки сервера
- `collapseEndpoints` включён по умолчанию: endpoint'ы с линком в switch/router скрыты в chips
- Auto-layout force-сжимает rack → compact перед раскладкой (опция `preserveDisplay: true` отключает)

---

## 10. Стиль работы с пользователем

### Общение
- **Русский**, технический тон, детально
- Терминология на английском ок (`port-picker`, `auto-layout`, `vault`)
- Пользователь ценит **готовый рабочий результат**, не спецификации
- Перед крупной фичей — **кратко изложить план**, потом кодить
- Пользователь **скидывает скриншоты** — смотреть внимательно, находить что не так (часто причина бага видна на картинке)

### Обязательно
- ✅ Всегда проверять `npx tsc --noEmit` + `npx vite build` перед отдачей результата
- ✅ Отвечать на языке пользователя (русский)
- ✅ Использовать `ask_user` при архитектурных развилках — НЕ гадать (пользователь ценит, когда спрашивают)
- ✅ Обновлять `README.md` — там ведётся полная история версий, пользователь её читает
- ✅ Коммитить иконки в git
- ✅ Не дублировать уже реализованное
- ✅ **При релизе — только push кода + push тэга.** Сборку `.exe` делает GitHub Actions

### Запрещено
- ❌ `alert()` / `confirm()` / `prompt()` — использовать `Modal.tsx`
- ❌ Эмодзи в UI (только inline SVG)
- ❌ Нативные зависимости без проверки на MSVC-независимость
- ❌ Коммитить `node_modules`, `dist`, `release`
- ❌ **Собирать `.exe` локально** (`npm run build:win`, `electron-builder --win`) — это делает CI, см. §0.1
- ❌ **Просить пользователя собирать `.exe` локально** — тоже делает CI
- ❌ Обещать что-то «соберу и проверю в .exe» — агент проверяет через `tsc` + `vite build` + dev-сервер

### Формат ответа на фичу
Пользователь ожидает:
1. Понятное объяснение **что** сделано и **почему** (диагноз проблемы, если это фикс)
2. **Как выпустить релиз** — команды git (push + tag + push tag), с напоминанием что
   `.exe` соберётся **на GitHub Actions** за ~5-10 минут, ссылки на Actions/Releases
3. Что **не вошло** / что дальше (roadmap)
4. Если фикс — **корневую причину**, а не только симптом

### Типовой финальный блок ответа агента
````
### Как выпустить релиз
cd Q:\Desktop\netmap
git add .
git commit -m "vX.Y.Z: описание"
git push
git tag vX.Y.Z
git push origin vX.Y.Z

Сборка .exe запустится на GitHub Actions автоматически (~5-10 мин):
- Прогресс: https://github.com/m0xvi/netmap/actions
- Результат: https://github.com/m0xvi/netmap/releases
Локально собирать ничего не надо — CI сделает всё сам.
````

---

## 11. Быстрая диагностика

### Приложение не стартует
```bash
npm run dev     # проверить в браузере — если работает, проблема в Electron
npm run electron:dev
```

### Схема пустая / устройства исчезли
Нажать **F** (fit-view). Если не помогло — Проверка целостности: Settings → Общие, или посмотреть `doc_backups` через меню Проект → Резервные копии.

### Импорт не находит устройства
- MikroTik: проверить что SSH включён, `strong-crypto=no` для legacy (`/ip ssh set strong-crypto=no`)
- Есть кнопка «Показать сырой ответ» в диалогах импорта — использовать

### Vault не разблокируется
`vaultReset()` — полный сброс (данные теряются). Или «Забыли пароль?» в VaultPanel.

### GitHub Actions сборка упала (красный ✗)

**Это правильное место для диагностики сборки** — `.exe` собирается только там (см. §0.1).

1. Открыть https://github.com/m0xvi/netmap/actions
2. Кликнуть на упавший workflow → на красный шаг
3. Скопировать последние 20-30 строк лога

Частые ошибки:

| В логе | Причина | Что делать |
|---|---|---|
| `Version mismatch — bump package.json` | `package.json.version` ≠ тэг | поправить `package.json`, новый коммит + force-push тэга или новый тэг |
| `Resource not accessible by integration` | нет прав у GITHUB_TOKEN | Settings → Actions → General → Workflow permissions → **Read and write** |
| `cpu-features` / `nan` / `node-gyp` / `MSVC` | не отработал strip-скрипт | проверить, что `strip-cpu-features.cjs` в `postinstall` И в `publish:win` |
| `Cannot find module` | что-то не закоммичено | проверить `git status`, что нет забытых файлов |

### Локальная проверка перед пушем (что делает агент вместо сборки)
```bash
npx tsc --noEmit      # типы
npx vite build        # бандл
```
Этого **достаточно**, чтобы не гонять CI зря. `.exe` собирать не надо.

---

## 12. Что проверить при первом заходе в репозиторий

### 12.1 Окружение
```bash
git log --oneline -15                 # история последних версий
cat README.md | head -120             # свежие релиз-ноты (пользователь их читает)
git tag | tail -10                    # последние локальные тэги
git ls-remote --tags origin | tail -10 # тэги НА GITHUB (важно! должны совпадать)
grep '"version"' package.json         # текущая версия
```

### 12.2 Проверить, что код в порядке
```bash
npm install          # postinstall сам уберёт cpu-features
npx tsc --noEmit     # должно быть пусто
npx vite build       # должно быть "✓ built in Xs"
npm run dev          # открыть http://localhost:5173, убедиться что UI живой
```

### 12.3 Проверить состояние релизов
1. **https://github.com/m0xvi/netmap/actions** — есть ли красные ✗?
2. **https://github.com/m0xvi/netmap/releases** — какая последняя опубликованная версия?
3. Сравнить: если `package.json` = `0.50.0`, а в Releases последняя `0.49.0` — значит релиз не доехал,
   нужно запушить тэг (см. §8.3).

### 12.4 Состояние на момент передачи
- **Версия в `package.json`: `0.50.0`**
- Пользователь в последнем сообщении описывал проблему с релизом **v0.49.0**
  (тэг не пушился → GitHub Actions не запускался → auto-updater не видел обновление)
- **Первым делом проверить, доехал ли `v0.50.0` в Releases.** Если нет — запушть тэг:
  ```bash
  git tag v0.50.0          # если тэга нет локально
  git push origin v0.50.0  # ← это запустит сборку на GitHub Actions
  ```
  и сообщить пользователю, что `.exe` появится в Releases через 5-10 минут
  (**сборка идёт на GitHub, локально ничего не собирается**).

---

## 13. История этой сессии (v0.44.0 → v0.50.0)

Что было сделано в сессии, из которой передаётся проект. Полезно понимать **логику последних решений** и то, что пользователь просил.

| Версия | Что сделали | Триггер от пользователя |
|---|---|---|
| **v0.44.0** | Автообнаружение топологии: `electron/snmp.cjs` (net-snmp) + `electron/discovery.cjs` (LLDP + FDB + ARP) + `DiscoveryDialog.tsx` (4 фазы: Form → Scanning → Review → Done) + `store.applyDiscovery()` | «можно ли проанализировать что к чему подключено, проследить маршрут и автоматически создать карту? добавить SNMP, фишки из Zabbix» |
| **v0.44.1** | CI/CD через GitHub Actions (`ci.yml` + `release.yml`) + `.gitignore` + попытка фикса кнопки Импорт | «сделай так чтобы на гитхаб отправлялся исходный код, а не готовые приложения… можно ли из этого сделать обновление?» + «баг: кнопка импорта не открывается» |
| **v0.44.2** | **Настоящий** фикс кнопки Импорт (убран `return null`, vendor-picker сеткой плиток) + `src/Spinner.tsx` (5 компонентов индикаторов) + индикаторы во всех диалогах | «баг с импортом остался… добавь везде где возможно визуальную загрузку» |
| **v0.44.3** | Динамическая версия из `package.json` через vite `define` (`__APP_VERSION__`) + version badge в toolbar | «почему в версии о программе пишется 0.44.1, хотя я обновился? напиши явно в приложении версию» |
| **v0.45.0** | `collapseEndpoints` по умолчанию ON + `CompactViewToggle` + **`src/smartLayout.ts`** (hybrid grouping: location → VLAN → /24) + submenu стратегий в FAB + smart layout после импорта | «в модерн виде устройства не сворачиваются в свитчи, остаются в линию и не группируются по подсетям» |
| **v0.46.0** | Рерайт `PortPickerDialog.tsx`: порт-грид, занятые порты с `usedBy`, replace-flow («Заменить связь»), поиск портов. Убран hard-block «нет свободных портов» | «сделай более гибкую систему: удерживаю элемент и навожу на свитч… выдаст диалог в какой конкретно порт соединять» |
| **v0.47.0** | Инверсия кликов: одинарный → `select()` + автооткрытие правой панели; двойной → FocusView. Новый `setRightPanelOpen()`, × кнопка в RightPanel | «одинарный клик вызывает расширенное меню справа, двойной — focus mode» |
| **v0.48.0** | **E:** `CredsTab` рерайт в Bitwarden-стиле (5 состояний, inline create-форма, TOTP, show/hide, copy с авто-очисткой 45с). **F:** `VlansTab` рерайт — `PortVlanMode` (access/trunk/hybrid), native VLAN отдельно, inline создание VLAN с color-picker | «вкладка с паролем: добавь кнопку "Добавить запись", поля как в битварден… вкладка с вланами не функциональна» |
| **v0.49.0** | `OnboardingDialog.tsx` — 8 слайдов при первом запуске с SVG-иллюстрациями + seed loader + повторное открытие через Help | «сделай при первом заходе overview по программе, чтобы научить пользоваться. Кнопка пропустить тоже должна быть» |
| **v0.50.0** | **FAB actions горизонтально влево** (перекрывали группы) + `gridifyGroupsIfNeeded()` (wrap групп в √N×√N grid) + `AUTO_LIKE_PREFIXES = ['auto-', 'g-net-']` | «колонка с кнопками криво располагается — сделай горизонтально выезжающей; импортированные устройства всё в длинной строке» |

### Открытые вопросы на момент передачи
1. **v0.50.0 запушен или нет?** Пользователь в последнем сообщении описывал проблему с релизом v0.49.0 (тэг не пушился → CI не запускался → auto-updater не видел обновление). Нужно проверить `git tag` и статус Actions. Если `v0.50.0` не в Releases — сделать релиз.
2. **Проверить, что grid-wrapping реально помог** на схеме Дона (38 устройств) — пользователь ждал именно этого.
3. **Развилки, которые пользователь выбирал в `ask_user`** (актуальные предпочтения):
   - Дискаверинг: только Auto-Discovery, **без** SNMP polling; источники MikroTik SSH + SNMP; merge через **review-диалог** (не авто); `net-snmp` (pure JS)
   - Онбординг: **слайды** (не spotlight), с seed-загрузкой в конце, повторный запуск через меню Help, показывать **сразу** при первом запуске
   - Раскладка: гибридная (location → VLAN → IP), **всегда** показывать диалог выбора порта при drag-drop
   - Vault-таб: **inline Bitwarden-стиль** (не компактное саммари)

---

## 14. Один абзац, если совсем некогда


NetMap = Electron+React+TS приложение для схемы сети отеля. Код: `src/` (renderer, 100 файлов, всё состояние в `store.ts`) + `electron/` (main process, IPC + SQLite + SSH/SNMP). Правила: никаких `alert/confirm` (использовать `Modal.tsx`), никаких эмодзи (только SVG), `base: './'` в vite, стабильные `EMPTY_*` референсы в селекторах, `safeFinite` для координат, проверять `tsc --noEmit` + `vite build` перед коммитом.

**⚠️ Сборку `.exe` делает GitHub Actions, а НЕ агент и НЕ пользователь.** Агент только: правит код → коммит → push → `git tag vX.Y.Z` → `git push origin vX.Y.Z`. Дальше CI на windows-runner запускает `npm run publish:win` и заливает `NetMap-Setup-X.Y.Z.exe` + `latest.yml` в GitHub Releases, откуда auto-updater раздаёт обновление клиентам. **Никогда** не запускать `npm run build:win` локально и **никогда** не просить об этом пользователя.

Отвечать по-русски, планы перед кодингом, `ask_user` при развилках. MSVC не должен требоваться (`strip-cpu-features.cjs`).
