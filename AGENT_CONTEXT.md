# NetMap — контекст для агента (session handoff)

> Живой документ для передачи проекта между агентскими сессиями.
> Обновляй его в конце каждой значимой сессии: версия, HEAD, что сделано, что отложено.
> Вечные правила — в `HANDOFF.md` (§0.1 сборка, §2 критические правила). Этот файл — про *текущее состояние*.

## 1. Снимок состояния

| Поле | Значение (на 2026-09-25) |
|---|---|
| Проект | NetMap — desktop-приложение (Windows) для интерактивной схемы сети сисадмина. Замена статичным схемам Visio/draw.io |
| Стек | Electron + React 18 + Vite + XYFlow (`@xyflow/react`) + Zustand + dagre. Main-процесс — CommonJS (`electron/*.cjs`) |
| Ветка | исторически `arena/01a0ced4-netmap` → двойник `arena/01a0da2c-netmap`; текущая сессия Arena — `arena/01a0da42-netmap` (мерж полной истории v0.63.0 + `map-variants.html` из нового `main`) |
| HEAD | v0.76.7 (автообнаружение: VLAN, пошаговый обход, SSH-ключи в UI) поверх v0.76.6 (аудит). Ранее v0.76.5 (SNMPv3: buildV3User — USM в объекте пользователя) поверх v0.76.0 (SSH-ключи) поверх v0.75.1 (stacking/имена/SNMPv3) поверх v0.75.0 (WinBox/автообнаружение в фокусе) поверх v0.74.0 (аудит сканирования хабов) поверх v0.73.1/v0.73.0 (LOD-фейдинг + агрегация оконечных) поверх v0.72/v0.71/v0.70/v0.69/v0.68/v0.67/v0.66/v0.65/v0.64 |
| Версия | `0.80.0` (package.json), тег `v0.80.0` (см. §2) |
| Релиз | v0.76.5 собран в CI (release.yml, windows-latest) по тегу; артефакты: `NetMap-Setup-0.76.5.exe`, `NetMap-Portable-0.76.5.exe`, `latest.yml` |
| Реальная схема | `Новая_схема.netmap.json` в корне `main` (124 dev/129 lnk); разбор — `docs/real-map-analysis.md` |
| CI | `ci.yml` — проверка на каждый push; `release.yml` — сборка `.exe` **только по git-тегу** `v*` (вручную `.exe` НЕ собирать, см. HANDOFF.md §0.1) |

## 2. Где остановились

**Standing rule (указание пользователя, 2026-10-08): после КАЖДОГО изменения кода — релиз.**
Порядок: поднять `version` в `package.json` + `package-lock.json` → `tsc` + `vite build` → commit → push ветки →
`git tag vX.Y.Z` → `git push origin vX.Y.Z` (сборку делает Actions `release.yml`, `.exe` локально не собирать).
Проверить `gh run list --workflow Release`; сообщить пользователю ссылки на Actions/Releases.

**v0.80.0 (автообнаружение: сравнение с прошлым сканом, 2026-10-10)** — `src/discoveryDiff.ts`: `makeSnapshot` (ключ устройства — MAC, иначе IP; связи — по концам и портам), `diffSnapshots` (added/removed/changed/links; при `cancelled` пропавшие не считаются), `loadSnapshot`/`saveSnapshot` (localStorage `netmap.discovery.snapshots.v1`, до 5 корней). `DiscoveryDialog.tsx`: сравнение и снимок только в `onScan`; блок `DiffSummary` в просмотре.

**v0.79.0 (автообнаружение: экспорт отчёта, 2026-10-10)** — `src/discoveryReport.ts`: `buildDevicesCsv` (`;`, BOM, CRLF), `buildMarkdownReport` (связи через tempId → имя, экранирование `|`), `reportFileName`. `DiscoveryDialog.tsx`: `exportReport('csv'|'md')` через Blob (как в `MenuBar.tsx`); файл учитывает `devPick`, `nameEdits`, `kindEdits`.

**v0.78.0 (автообнаружение: реальный прогресс опроса, 2026-10-10)** — `electron/discovery.cjs`: `scan(cfg, onProgress)` → `scanInner(cfg, emit)` шлёт события `mikrotik`, `wave`, `host` (start/done), `walk` (готовые параллельные запросы, `onStep` из `collectSnmp`), `dns`. `electron/main.cjs` отправляет их в окно `netmap:discoveryProgress`, `preload` даёт `onDiscoveryProgress(cb)` → отписка. `src/discoveryProgress.ts` — чистый редьюсер и `summarizeProgress` (офлайн-тесты: `node scripts/discovery-tests/run.cjs`, фейковый SNMP в `scripts/discovery-tests/fakesnmp.cjs`). `DiscoveryDialog.tsx`: `ScanProgressView` заменил таймерный `ScanStages`.

**v0.77.0 (автообнаружение: параллельный SNMP, отмена, ручные хосты, память настроек, PTR, 2026-10-10)** — `electron/discovery.cjs`: `collectSnmp` запускает независимые walk через `makeLimiter(SNMP_PARALLEL=3)`; обработка не меняется, ошибки всплывают в тех же местах (`await P.x`). `scan()` — обёртка над `scanInner()` с токеном `currentScan`; `cancelScan()` (IPC `netmap:discoveryCancel`, `window.netmap.discoveryCancel`) → между волнами и перед хостом выход, результат `cancelled: true` + предупреждение. `resolveReverseNames()` — PTR только для `nameSource === 'ip'`, `cfg.reverseDns !== false`, источник имени `dns`. `DiscoveryDialog.tsx`: кнопка отмены в фазе scanning, поле ручных хостов → `snmpSeeds` (`parseHostList` в `src/discoveryPrefs.ts`), настройки и исключения в localStorage (`netmap.discovery.prefs.v1`, без секретов; `sanitizePrefs`). Тесты: мок `snmp.cjs` через `require.cache` (параллельность/отмена/сравнение со старой версией), отдельный харнесс PTR и парсера. НЕ проверено на реальном TP-Link/D-Link и в собранном UI.

**v0.76.10 (автообнаружение: MAC-only, подписи по режиму, 2026-10-09)** — `DiscoveryDialog.tsx`: устройства без IP (клиенты коммутатора) выбираются, переименовываются и получают тип как обычные; фильтр «Без IP» (`showNoIp`) удалён; `macOnlyTotal` — счётчик для подсказок. Шапка и подпись экрана опроса зависят от `mode`. Store (`applyDiscovery`) и backend (`makeProposal`) не менялись: ip у устройства опционален. Правило «только с IP» снято по решению пользователя (вариант b). Открыто: OUI TP-Link/D-Link; стенд snmpsim в /tmp потерян при сбросе окружения (восстанавливать по §6 при необходимости).

**v0.76.9 (SNMPv3/TP-Link/D-Link/меню, 2026-10-09)** — DES для SNMPv3: `electron/desCompat.cjs` подменяет `crypto` для `des-cbc` на `des.js` (net-snmp DES — заглушка, OpenSSL 3 без DES). Подбор протокола: `snmp.cjs` `detectV3` ← `discovery.cjs` `detectV3` ← IPC `netmap:discoveryDetectV3` ← кнопка в `DiscoveryDialog`. `discovery.test()` теперь передаёт v3-опции (`snmpSessionOpts`). Ошибки v3 переводятся (`humanizeError`). Классификация: `kindByDescr` (роутеры TL-R/Archer/DIR перед общими «wireless»), `guessVendor` (TP-Link OID 11863). Меню стратегий: `ToolsStrip.tsx` — `smartMenuRef` в глобальном mousedown. Тесты вне репо: `/tmp/vt/sim_scan.cjs`, `detect_check.cjs`, `kind_check.cjs`, `des_check.cjs` (эмуляторы snmpsim на 127.0.0.2–4:1161; без root порт 161 недоступен). Открыто: правило «MAC-only без IP» (решение пользователя); OUI TP-Link/D-Link.

**v0.76.8 (Vault, 2026-10-09)** — `VaultCreds.tsx`: «В Vault» обновляет запись с тем же хостом/логином/портом (`findSameRecord`, `sameRecord`), а не создаёт дубль; `mergeIntoExisting` не затирает notes/totp/history; папка пишется по id (`resolveFolderId`); пикер показывает детали и «что заполнится», дубли помечены. Тест разбора: `/tmp/vt/vault_test.cjs` (вне репо) — ALL PASS.

**v0.76.7 (автообнаружение, 2026-10-08)** — VLAN находятся полностью (bridge без комментария,
trunk-only, назначение по FDB `vid` и по подсети на транке, `vlanSource`); пошагово предлагается
опросить найденные ядро/распределение (`hubCandidates`, `scannedHosts`, `snmpRecursive` по умолчанию
выключен); решения пользователя при повторном опросе переносятся по IP/MAC; `applyDiscovery` заводит
VLAN из скана в `doc.vlans`; SSH-ключ: поля «Путь к ключу» и «Passphrase» в форме и Vault. Подробности — README, v0.76.7 и раздел «Вход по SSH-ключу».
Тест: `/tmp/vt/verify_vlan.cjs` (моки, вне репозитория) — ALL PASS.

**v0.76.6 (аудит, 2026-10-08)** — исправлено: will-navigate/openExternal в `electron/main.cjs`
(окно не уходит на внешние URL, схемы ограничены http/https/mailto); `isSafeHost` в ping/traceroute;
SSH keyboard-interactive + гонка sessionId в `ssh-shell.cjs`; ENOENT WinBox (`winbox.cjs`);
логирование ошибок сохранения в `persistence.ts`. Подробности — README, v0.76.6.
Не сделано: тег/релиз (по правилам — только по запросу), включение `sandbox` у окна.

**Сессия 2026-10-08 (эта ветка, `arena/01a0da42-netmap`)** — закрыта серия
v0.75.0 → v0.76.5, всё выпущено и в CI success:
- **v0.75.0**: WinBox (`electron/winbox.cjs`, аргументы `winbox.exe <ip> [login [password]]`,
  путь в localStorage `netmap:winboxPath`), автообнаружение с устройства в фокусе,
  фикс крестика в focus-виде.
- **v0.75.1**: z-index шапок MenuBar/Toolbar 60 (попапы не наезжают); уникальные имена
  проектов `uniqueProjectName` (« (2)»/« (3)» в create/rename); SNMPv3 в discovery
  (форма USM + `buildV3Options`/`createV3Session` в snmp.cjs).
- **v0.76.0**: SSH-ключи во всём стеке: `electron/sshAuth.cjs` (privateKey | privateKeyPath |
  password + passphrase), подключено в mikrotik-ssh.cjs и ssh-shell.cjs; vault-поля
  sshKey/sshKeyPath/sshPassphrase (секция «SSH-ключ» в VaultStudio); терминал,
  ContextMenuHost и discovery берут ключ из vault.
- **v0.76.1**: дропдауны MenuBar — `createPortal(document.body)` + z10000 (перекрывались
  тулбаром/легендой); guard в onScan discovery («proposedDevices is not iterable»):
  валидация r.ok/proposedDevices ДО setScan + alertDialog.
- **v0.76.2**: collectSnmp читал голый `cfg` (ReferenceError) — v3 через `opts.cfg`;
  scan() передаёт SSH-ключ в collectMikrotik (в 0.76.0 терялся по дороге).
- **v0.76.3**: после портала outside-click закрывал меню на mousedown по пункту —
  «кнопки не нажимаются». Фикс: `dropdownNode` (ref портал-дива) в проверке.
  jsdom-стенд на реальном MenuBar: PASS.
- **v0.76.4** (полный аудит по жалобе «проверь полностью»): (1) vault.cjs secretPart —
  whitelist без ssh-полей → ключи молча не сохранялись; (2) VaultCreds save/pick —
  ssh-поля top-level, а не fields{}; (3) DiscoveryDialog: sshKeyPem/sshPassPem + values/
  onApply + privateKey/sshPassphrase в currentCfg (ранее поле было пустышкой).
- **v0.76.5**: SNMPv3 не работал НИКАКОЙ — net-snmp ждёт USM в объекте пользователя,
  а мы слали имя строкой + level в options → пустой msgUserName → authorizationError.
  `buildV3User()` + `createV3Session(host, userObj)`. Живой прогон против независимого
  pysnmp-агента: 4 комбинации probe + walk OK (рецепт стенда — грабля 9).

**Следующее по плану пользователя** (не начато): плавность карты по
`docs/comfyui-analysis.md` — кандидаты A (FPS-метр) и B (canvas-обзор);
ждём подтверждения. Новые задачи — только по указанию пользователя
(«всегда задавай уточняющие вопросы, если непонятно»).

**Текущая сессия (2026-09-25, ветка `arena/01a0da42-netmap`):** разбор макетов
`map-variants.html` → `docs/map-variants-analysis.md`; план «гибрид» из трёх релизов
**ВЫПОЛНЕН ПОЛНОСТЬЮ**:
- **v0.64.0 «точки-клиенты на хабах»** (приёмы B): интерактивные точки 13 px в секции
  Connected Devices, «N down» в шапке, живой тултип `DeviceTooltip.tsx`, «Пинг» и
  «SSH-терминал» в ПКМ-меню. jsdom 15/15.
- **v0.65.0 «иерархия и фокус»** (приёмы A): ховер-подсветка соседей (затемнение
  не-соседей по DOM без ре-рендеров), двойной штрих магистралей (`data.trunk` →
  подложка в PortEdge), контейнеры-группы (GroupNode), связи ПОД карточками на near
  (класс `nm-edges-below` в index.html), кегль 10→11 px. jsdom 13/13.
- **v0.66.0 «радуга и синхрон»** (приёмы C+D): `src/radialLayout.ts` — чистый модуль
  радиальной раскладки (ядро в центре CX1400/CY1000, хабы по орбите RING_STEP 380,
  оконечные дугами ARC_R0 110 вокруг хаба, группы — мета-узлы с сеткой внутри);
  action `radialLayout()` в store (компакт+safeFinite+historyPush+fit-view); пункт
  «Радиальная · «радуга»» в SmartMenu (ToolsStrip) и в меню Вид; `src/HubPeersList.tsx`
  — раздел «Подключённые устройства» в InfoTab DevicePanel с двусторонним синхроном
  через `hoveredDeviceId` (затемнение карты в Canvas теперь effect на hoveredDeviceId —
  единый источник для карты и панели). Юнит radial 16/16 + jsdom peers 9/9.
Следующих задач из макетов нет.
- **v0.67.0 «режимы на любой карте + оптимизация»**: пользователь пожаловался, что
  меню стратегий «мёртвое». Причина (воспроизведено стендом на реальном store):
  `autoGroupDevices` не трогал устройства в пользовательских группах → на
  сгруппированной карте все стратегии давали одну картину. Фикс: опция
  `takeOverUserGroups` (smartLayout) — стратегия переорганизует всю карту, «дом»
  помнится в `device.userGroupId`; `restoreUserGroups()` для groupBy='none'
  (store.autoLayout); пустые «спящие» группы не рендерятся (Canvas initialNodes);
  pushAlert с итогом группировки после умной раскладки (ToolsStrip doLayout,
  summarizeAutoGrouping; при отсутствии данных — честное сообщение).
  Оптимизация DOM: портовые якоря (2 DOM/порт) рендерятся только near/selected/
  hovered (`exposesPortAnchors` в ModernDeviceNode), на mid/far рёбра цепляются к
  боковым `_top/_right/_bottom/_left` по геометрии (geoSide в Canvas, тот же
  предикат в мемо рёбер). Стенд 37/37.
Кандидаты дальше (из `docs/map-baseline.md` §5): тултипы на дальнем зуме,
разгрузка верхней полосы баннеров (якоря оптимизированы в v0.67).
- **v0.68.0 «контракт сцены»** по запросу пользователя «грамотно разложить
  логику отображения/фасовки/расположения»: `src/scenePlan.ts` — чистый план
  (deviceMode card/beacon/folded, groupMode frame/pill/hidden, foldedInto,
  bundles «×N» на far, linkVisible-фильтры); Canvas initialNodes/initialEdges
  берут план (эвристики hideAsEndpoint удалены); `src/BundleEdge.tsx`;
  даблклик по группе — нырок (`netmap:focus-group` → setViewport); спецификация
  `docs/display-logic.md`. Юнит 17/17; регрессии radial 8/8, strat 29/29.
Снапшот в этой сессии сбрасывался в начале каждого хода — лечение: fetch +
`reset --mixed origin/arena/01a0da42-netmap` (дерево не трогать!).

Последняя завершённая работа прошлой сессии — **v0.63.0 «LayoutFAB удалён, стратегии раскладки — на полосе»**:
синий круг-раскладка убран с карты (он дублировал полосу инструментов; вместе с ним ушла и
всплывающая подсказка «схема выглядит запутанно»). Единственное уникальное действие FAB —
выбор стратегии умной раскладки — переехало на `ToolsStrip`: «Умная раскладка» стала
split-кнопкой (иконка = гибрид в один клик, шеврон = меню из 4 стратегий: гибрид / локации /
VLAN / подсети). Меню закрывается Escape, кликом мимо, скроллом и сворачиванием полосы.
Проверки: `tsc` + `vite build`, плюс jsdom-стенд 23/23 (полоса, split, стратегии, закрытие меню,
отсутствие «залипшего» меню после сворачивания). Бандл −9 КБ.

Что было прямо перед этим (свежий код, который надо знать):
- **v0.62.2 «тихая фоновая проверка обновлений»** — пользователь поймал красную плашку
  `net::ERR_TIMED_OUT` на старте (автопроверка обновлений не дотянулась до GitHub). Теперь
  main-процесс помечает происхождение проверки (`origin: auto|manual`, `electron/updater.cjs`),
  а `UpdateBanner` молча глотает *сетевые* ошибки фоновой проверки. Плашка осталась для ручной
  проверки из меню и не-сетевых ошибок (404/403/конфиг). Плюс распознавание Chromium-ошибок сети
  (`ERR_TIMED_OUT`, `ERR_INTERNET_DISCONNECTED` и др.).
- **v0.62.0** — `src/DialogTheme.tsx`: единая тема всех модальных окон по шаблону
  «Автообнаружения топологии» (каркас `DialogShell`, кнопки, контролы, zIndex 9500/99900/100000).
  На неё переведены 10 диалогов + примитивы `Modal.tsx`. Само окно discovery не тронуто (эталон).
- **v0.61.0/0.61.1** — `src/ToolsStrip.tsx`: горизонтальная draw.io-панель инструментов под тулбаром
  (17 кнопок, сворачивание с персистом). Легенда подсетей переехала вправо-влево (было наложение на FAB).
- **v0.60.0** — связи красятся по подсетям (/24) + `SubnetLegend`, пилюли-ориентиры всем хабам.

## 3. Открытые задачи и вопросы

1. ~~**Макеты карты (`map-variants.html`) — гибрид v0.64–v0.66.**~~ **ЗАКРЫТО**:
   все три релиза выпущены (точки-клиенты B → иерархия/фокус A → радуга/синхрон C+D).
   Разбор — `docs/map-variants-analysis.md`. Не переносили сознательно: плавающий
   roundbt (FAB-дубль), палитру макета, авто-раскладку как единственную, отказ от портов.
   Новые задачи — ждать указаний пользователя; кандидаты в §5 `docs/map-baseline.md`.
2. ~~**FAB vs ToolsStrip.**~~ **ЗАКРЫТО в v0.63.0**: `LayoutFAB` удалён, стратегии раскладки —
   на split-кнопке в `ToolsStrip`. Не возвращать: дублирования больше нет.
3. ~~**Стратегии умной раскладки**~~ **ЗАКРЫТО в v0.63.0**: меню из 4 стратегий на полосе
   (шеврон у «Умной раскладки»).
4. `main` отстал (заморожен на `ad8ced0`). Сливать в `main` только по явной просьбе пользователя.
5. **Плавность больших карт** — кандидаты A–E в `docs/comfyui-analysis.md` (173a1d4):
   A FPS-метр, B canvas-обзор вместо DOM на far и т.д. Пользователь может вернуться.
6. **Аудит хабов v0.74**: ждём новый экспорт пользователя после скана 0.74+, чтобы
   проверить topoAudit на живых данных (старые файлы без scanMeta — «нет данных»).
7. SNMPv3 aes256r (Cisco/Reeder) против реального железа не проверен (стенд pysnmp
   покрывает aes256b/Blumenthal); при жалобе — сверять со snmpwalk -x AES-256-C.

## 4. Карта репозитория (что где)

```
src/
  App.tsx, main.tsx            каркас окна: MenuBar → Toolbar → ToolsStrip → [sidebar|Canvas|right]
  store.ts                     zustand-стор: документ, история undo/redo, UI-флаги (персист в LS)
  Canvas.tsx                   карта (XYFlow): ноды, связи, легенды, пилюли, declutter
  Toolbar.tsx / MenuBar.tsx / FileMenu.tsx   верхняя оболочка и меню (File/View/Tools/Monitor/Help)
  ToolsStrip.tsx               draw.io-панель инструментов (v0.61.0+); с v0.63.0 «Умная
                               раскладка» — split-кнопка с меню стратегий (бывш. FAB)
  LayoutFAB.tsx                УДАЛЁН в v0.63.0 (дублировал полосу; стратегии — в ToolsStrip)
  DialogTheme.tsx              ЕДИНАЯ ТЕМА ОКОН: DialogShell, DlgBtn, DlgSection, DlgIcon (v0.62.0+)
  Modal.tsx                    promptText/confirmDialog/alertDialog (своя тема, z 100000)
  *Dialog.tsx / VaultStudio.tsx  диалоги (все на DialogShell, кроме discovery — он эталон)
  DiscoveryDialog.tsx          автообнаружение топологии (редизайн v0.56.0 — визуальный эталон)
  ModernDeviceNode.tsx / DeviceNode.tsx / SwitchNode.tsx / GroupNode.tsx / PatchPanelNode.tsx
  updaterClient.ts + UpdateBanner.tsx   клиент автообновлений и баннер статусов
electron/
  main.cjs / preload.cjs       main-процесс и IPC-мост (window.netmap.*)
  updater.cjs                  electron-updater: автопроверка (старт+5с), origin auto/manual (v0.62.2)
  discovery.cjs / snmp.cjs / mikrotik*.cjs / ssh-shell.cjs / ping.cjs / traceroute.cjs / vault*.cjs ...
.github/workflows/            ci.yml (проверка), release.yml (сборка .exe по тегу v*)
```

Документы: `HANDOFF.md` — вечные правила (читать обязательно);
`README.md` — сверху история версий (каждый релиз дописывать);
`TROUBLESHOOTING.md` — пользовательские грабли сборки.

## 5. Как работать (кратко, детали — HANDOFF.md)

- **Сборка `.exe` — только GitHub Actions по git-тегу.** Агент: правки → `tsc --noEmit` →
  `vite build` → **fetch + `git reset --mixed origin/arena/01a0da42-netmap`** (снепшот
  откатывает HEAD) → commit → push в `arena/01a0da42-netmap` → тег `vX.Y.Z` **только для
  релизов** → push тега → `gh run list`/`gh release view`. Сессия привязана к
  `arena/01a0da42-netmap` — другие ветки не трогать.
- **Зависимости в песочнице:** `npm ci --ignore-scripts` (обычный `npm ci` падает на
  `better-sqlite3`/node-gyp: sandbox без тулчейна и с обрезанной сетью). Для tsc/vite этого хватает.
- **UI-правила:** никаких `alert()/confirm()/prompt()` (только `Modal.tsx`); никаких эмодзи/
  экзотики в UI (только SVG); `base: './'`; стабильные референсы селекторов; `safeFinite()` для координат.
- **Отвечать пользователю по-русски.** Каждый релиз — запись в историю версий README.md.
- **Формат каждого ответа пользователю** (требование): что сделал → как это подробно
  выглядит → как проверить → точечно изменения. При неоднозначности — сначала
  `ask_user`, а не догадки.
- Новые диалоги/окна — только через `DialogShell` из `DialogTheme.tsx` (единый стиль, §2).

## 6. Грабли песочницы (прочитай, иначе потеряешь время)

1. **Снапшоты сбрасывают git:** HEAD может откатиться на `ad8ced0`, ветки/теги пропасть из локального
   клона, `node_modules` и `/tmp` — вытираться (не персистятся). Первое действие в сессии:
   `git log --oneline -2 && git status --short`. Если HEAD не тот — `git fetch origin
   '+refs/heads/arena/*:refs/remotes/origin/arena/*' '+refs/tags/*:refs/tags/*'`, сверить дерево
   с актуальной веткой и только потом чинить (`reset --hard` — лишь убедившись, что рабочее
   дерево совпадает с remote).
1a. **Откат может случиться ПРЯМО ПОСРЕДИ СЕССИИ** (v0.63.0: сбросило дважды, один раз — между
   правками файлов). Если в рабочем дереве есть незакоммиченные правки, то после `fetch` надо
   `git reset --mixed <целевой коммит>` (двигает HEAD и индекс, дерево НЕ трогает) — иначе
   `--hard` вытрет всю работу. Правки после этого видны как обычные modifications.
2. **НЕ батчить несколько правок одного файла** в один параллельный блок — правки гоняются
   (v0.61.1: потерялся тег `<ToolsStrip />`, релиз вышел без панели). Один файл — одна правка за раз;
   после правок проверять результат чтением/grep, а не верить «success».
3. `gh run cancel` возвращает 403 — протухшие CI-раны не отменить; проверять провенанс артефактов
   по штампам времени (`gh run view` vs `gh release view --json assets`), а не перезапускать.
4. Удаление git-тега не останавливает уже стартовавший релизный ран; публикация релиза
   перезаписывает ассеты — побеждает поздний ран.
5. При backup/restore файлов маской `*.tsx` не забыть `store.ts` (`.ts`) — копировать явно.
6. `/tmp` и `node_modules` не персистятся между сессиями. jsdom-стенды (v0.62.1 — диалоги,
   v0.63.0 — ToolsStrip) жили в `/tmp/dlgtest` и `/tmp/nmstrip` и **не сохраняются** — пересоздавать
   по рецепту: `npm i --no-save jsdom@24` в отдельном каталоге; копию компонента бандлить с
   подменой импортов (`sed` на `'./store'` → фейковый стор, модалки/экспорт → заглушки);
   `esbuild harness.tsx --bundle --platform=node --format=cjs --jsx=automatic --loader:.css=empty
   --external:jsdom`; `NODE_PATH=<repo>/node_modules`; в конце `window.close()` + `process.exit`.
   **Три обязательных гвоздя** (иначе стенд врёт): 1) `globalThis.IS_REACT_ACT_ENVIRONMENT = true`
   до импорта react-dom; 2) `CustomEvent`/`Event` брать **из реалма jsdom**
   (`g.CustomEvent = dom.window.CustomEvent`), иначе `window.dispatchEvent(new CustomEvent(...))`
   в коде падает с «parameter 1 is not of type Event»; 3) подменить `requestAnimationFrame`
   на `setTimeout` и «прокачивать» его через `await act(async () => { click(); await tick(); })`.
   Плюс `npm ci --ignore-scripts` перед замером — обрезанная сеть ломает postinstall.
7. **Вложения пользователя в песочницу не доходят** (v0.62.2 → v0.63.0: `map-variants.html`
   не появился дважды, каталога `/home/user/uploads` просто нет). Не искать файл по ФС — просить
   вставку HTML текстом в чат, публичную ссылку (gist/raw) или файл в репозитории.
   **Обновление (01a0da42): сработал путь «файл в репозитории»** — пользователь закоммитил
   `map-variants.html` в `main` (`15de20f`), и новая сессия, стартовавшая от `main`, увидела файл.
   Это самый надёжный канал доставки.
8. **Снепшот может стартовать от свежего `main` без истории** (01a0da42: локально был только
   коммит `15de20f`, ветки/теги отсутствовали, но remote был цел). Лечение то же: `fetch`
   arena-веток и тегов, затем `merge --allow-unrelated-histories` актуальной ветки (даёт полную
   историю в ветке сессии) — `reset --hard` не нужен, если рабочее дерево уже содержит свежий код.
9. **Правки `s.replace(...)` в AGENT_CONTEXT без assert молча не применялись**
  (якоря не находились — файл оставался stale, хотя код говорил «ok»). Любые
  автозамены в документах — только с assert/проверкой вхождения, и после — grep.
10. **`node_modules` и `/tmp` вытираются и МЕЖДУ ХОДАМИ внутри сессии.** Каждый ход:
  `npm ci --ignore-scripts`; jsdom — `npm i --no-save jsdom`; стенды/скрипты в `/tmp`
  пересоздавать. `npx tsc` ставит мусорный tsc@2 — только `./node_modules/.bin/tsc`.
11. **apt недоступен** (прокси режет deb-индексы), но **sudo работает**; pip ставится
  через `python3 -m venv /tmp/venv`. Рецепт SNMP-interop-стенда (проверено 2026-10-08):
  venv + `pip install pysnmp cryptography` (pysnmp 7: API asyncio `get_cmd`,
  Debug('secmod','acl','msgproc') для вердиктов агента; AES требует cryptography);
  агент на 127.0.0.1:16100 с v3-юзерами (addV3User/addVacmUser) — независимая
  реализация для сверки net-snmp(npm). tcpdump НЕ установлен.
12. **net-snmp (npm) API v3**: USM-параметры — ТОЛЬКО в объекте пользователя
  `{name, level, authProtocol, authKey, privProtocol, privKey}` (числовые коды из
  AuthProtocols/PrivProtocols: sha256=5, sha512=7, aes=4, aes256b=6, aes256r=8);
  в options сессии они игнорируются. Ошибка «AuthorizationError» от библиотеки =
  error-status 16 от агента (VACM/пустой user), а не report usmStats.

## 7. Быстрая проверка после правок

```bash
ls node_modules/.bin/tsc >/dev/null 2>&1 || npm ci --ignore-scripts
./node_modules/.bin/tsc --noEmit && npm run build
```

## 8. История этого файла

- 2026-10-10: сессия `arena/cbcdb62e-netmap` — v0.80.0: сравнение с прошлым сканом (новые/пропавшие/изменённые устройства и связи).
- 2026-10-10: сессия `arena/cbcdb62e-netmap` — v0.79.0: экспорт отчёта автообнаружения (CSV по устройствам, Markdown с связями).
- 2026-10-10: сессия `arena/cbcdb62e-netmap` — v0.78.0: реальный прогресс опроса (события бэкенда вместо таймера).
- 2026-10-10: сессия `arena/cbcdb62e-netmap` — v0.77.0: параллельный SNMP-опрос коммутатора, отмена скана, ручные SNMP-хосты, запоминание настроек без секретов, обратный DNS для безымянных устройств.
- 2026-10-09: сессия `arena/cbcdb62e-netmap` — v0.76.10: MAC-only устройства в автообнаружении, подписи по режиму.
- 2026-10-09: сессия `arena/cbcdb62e-netmap` — v0.76.9: DES для SNMPv3 (desCompat), подбор протокола v3, ошибки v3, TP-Link/D-Link классификация, меню стратегий. Грабли: порт 161 без root недоступен (эмуляторы на 1161), net-snmp DES — заглушка.

- 2026-10-08: сессия `arena/01a0da42-netmap` — серия релизов v0.75.0 → v0.76.5
  (подробности в блоке §2 и в истории README): stacking/имена/SNMPv3 (0.75.1),
  SSH-ключи (0.76.0), портал-меню + guard discovery (0.76.1), cfg в collectSnmp +
  ключ в MikroTik-скан (0.76.2), кликабельность меню (0.76.3), аудит vault/VaultCreds/
  DiscoveryDialog (0.76.4), buildV3User SNMPv3 (0.76.5). Добавлены грабли 8a–11,
  обновлены §2/§3/§5. Файл приведён в актуальное состояние для передачи другому
  агенту: снимок (§1) + где остановились (§2) + открытые задачи (§3) — источник правды.

- 2026-09-25: создан при передаче проекта между сессиями (v0.62.2, HEAD `4467e13`).
- 2026-09-25: сессия Arena на ветке-двойнике `arena/01a0da2c-netmap` (та же история, что
  `01a0ced4`). Выпущен **v0.63.0** (HEAD `d06c2ce`): удалён `LayoutFAB`, стратегии раскладки —
  на split-кнопке полосы. Добавлены грабли 1a, 7 и рецепт jsdom-стенда в п.6.
  Открыта главная задача — разбор макетов `map-variants.html` (ждём вставку текстом;
  база замеров — `docs/map-baseline.md`).
- 2026-09-25: сессия Arena на `arena/01a0da42-netmap` (старт от нового `main` `15de20f` —
  макет `map-variants.html` доехал через репозиторий). Снапшот без истории — починен мержем
  `origin/arena/01a0da2c-netmap`. Выполнен разбор макетов → `docs/map-variants-analysis.md`
  (рекомендация: гибрид, v0.64–v0.66). Добавлена грабля 8.
- 2026-09-25: та же сессия — выпущен **v0.64.0**: точки-клиенты на хабах (интерактивные,
  13 px, цвет=тип/красный=down), живой тултип `DeviceTooltip.tsx`, «Пинг» и «SSH-терминал»
  в ПКМ-меню устройства. jsdom-стенд 15/15; найден и исправлен баг ctrl+клика (не подхватывал
  ранее выбранное устройство в мульти-набор). Тег `v0.64.0` запушен, сборка в CI.
- 2026-09-25: та же сессия — выпущен **v0.65.0**: ховер-подсветка соседей (DOM-затемнение
  без ре-рендеров), двойной штрих магистралей (data.trunk → подложка в PortEdge),
  контейнеры-группы (GroupNode), связи под карточками на near (nm-edges-below),
  кегль 10→11 px. jsdom-стенд 13/13. Снапшот снова откатывался между ходами —
  починен `reset --mixed`. Тег `v0.65.0` запушен, сборка в CI.
- 2026-09-25: та же сессия — выпущен **v0.66.0**: радиальная раскладка «радуга»
  (`src/radialLayout.ts` + action `radialLayout` + пункты в SmartMenu и меню Вид),
  синхронный список «Подключённые устройства» (`src/HubPeersList.tsx` в InfoTab),
  затемнение не-соседей переведено на эффект `hoveredDeviceId`. Юнит radial 16/16 +
  jsdom peers 9/9. Тег `v0.66.0` запушен, сборка в CI. План гибрида закрыт.
- 2026-09-26: та же сессия — выпущен **v0.67.0** по жалобе «меню стратегий мёртвое»:
  takeover-перегруппировка всей карты (`takeOverUserGroups` + `userGroupId` +
  `restoreUserGroups`), скрытие спящих групп, pushAlert-итог раскладки, оптимизация
  портовых якорей (exposesPortAnchors + geoSide). Стенд 37/37. Тег `v0.67.0`, CI.
- 2026-09-26: та же сессия — выпущен **v0.68.0** по запросу «выстроить логику
  отображения/фасовки больших карт»: контракт сцены `src/scenePlan.ts` +
  `docs/display-logic.md`, пучки «×N» (`BundleEdge`), пилюли групп с нырком,
  единый план для узлов и рёбер. Юнит 17/17 + регрессии. Тег `v0.68.0`, CI.
- 2026-09-28: та же сессия — выпущен **v0.71.0** («берём» из вариантов):
  MiniMap (тумблер, по умолчанию вкл), старт больших карт (≥100 dev) в обзоре
  (overviewZoomCap 0.28 на первичном fit, ручной fit без потолка), heatmap
  проблемности `downCountsByHub` → пилюля «N down» на карточке хаба и маяке.
  Юнит 7/7 + регрессия ремонта 4/4. Кандидаты дальше: focus-first
  (progressive disclosure), тултипы на дальнем зуме, разгрузка баннеров.
- 2026-09-28: та же сессия — выпущен **v0.72.0** (пользователь: «берем»
  focus-first + тултипы + разгрузка баннеров): `computeFocusSet` (BFS от
  core, FOCUS_RINGS=2, фолбэк max degree), deviceMode 'hidden' вне фокуса
  (связи/пучки/опустевшие группы не рисуются), синяя пилюля «+N»
  (hiddenExtra) на хабе и маяке → expandFocus, чип «Фокус: X из Y»
  (Показать всё/Сбросить), тумблер «Вид → Фокус», тултип группы на
  пилюлях (showGroupTip/GroupTooltipHost), EndpointsFoldedChip гаснет под
  фокусом. На реальной звезде кольцо 2 = вся карта (честно: 124/124).
  Юнит 18/18 (реальный док 11 + синтетическая цепочка 7).
- 2026-09-28: та же сессия — выпущен **v0.73.0** (пользователь: «берем»
  LOD-фейдинг + агрегацию оконечных): `labelFadeByBand` (near 1 / mid 0.55 /
  far — не рендер; CSS transition, без подписки на непрерывный зум) —
  подписи рёбер приглушаются на mid; `groupEndpointsForCard` +
  `ENDPOINT_AGG_THRESHOLD` = 8 — однотипные оконечные на карточке хаба
  стартуют пилюлей «N × тип» (клик раскрывает точки). На реальном GW:
  ap 13 / camera 43 / pc 9 / other 32 — пилюли. Юнит 14/14.
- 2026-10-02: та же сессия — **v0.73.1** (хотфикс отчёта пользователя: React
  error #185 при работе с картой). Причина: селектор GroupTipCard (v0.72)
  возвращал новый массив `rows` → useShallow (Object.is по полям) считал
  снапшот всегда изменившимся → бесконечный ре-рендер при ховере пилюли
  группы. Фикс: `selectGroupTip` возвращает примитивы (rows — строка «|»).
  Правило: в useShallow-селекторах — только примитивы на верхнем уровне.
  Юнит 6/6 (стабильность на реальном доке + регрессия паттерна).
- 2026-10-02: та же сессия — выпущен **v0.74.0** (пользователь: «snmp+ssh
  проход по dhcp-серверу, все устройства видны, не знаю с чего начать
  нормализацию»; варианты → выбрано: метаданные скана + отчёт с применением,
  меню «Вид»). `doc.scanMeta` (ScannedHubMeta: host/name/via/fdbMacs/at) +
  `device.origin` (dhcp|snmp|ssh|manual) пишет discovery при применении;
  `src/topoAudit.ts` — auditHubs/planAuditFixes (move когда висит на одном
  другом хабе, add когда без хабов, 2+ — не трогаем); AuditHubsDialog
  (DialogShell) + «Вид → Аудит сканирования хабов…». Старые файлы без
  scanMeta — «нет данных», план пуст. Юнит 15/15. Ждём новый экспорт
  пользователя (после скана 0.74+) для проверки на живых данных.
- 2026-09-28: та же сессия — файл `Новая_схема.netmap.json` доехал (корень
  `main`): числовой разбор (GW degree 122/129 — звезда FDB; параллельных пар
  нет; группы до 12504px; 106/109 оконечных foldable) → выпущен **v0.70.0**:
  `src/topoRepair.ts` (план ремонта: конец связи со шлюза → на свитч по имени
  в хинте), пункт «Вид → Починить связи по FDB-хинтам» (dry-run + confirm),
  эвристика в electron/discovery.cjs. На реальном файле 2 правки (SW_RoomOO);
  полнота — за SNMP-сканом свитчей (рекомендация в docs/real-map-analysis.md).
  Стенд 8/8. Следующий кандидат: minimap + старт в обзоре (v0.71).
- 2026-09-28: та же сессия — выпущен **v0.69.0** по разбору реальной схемы
  пользователя (скрины: «ленты» рёбер, сотни лейблов «bridge FDB», розовые
  «рамки» веера, пустой обзор с полосами): non-scaling-stroke в PortEdge/
  BundleEdge; `src/edgeBundling.ts` (fanOffset ±42px, агрегация пар >6 в ×N
  на всех ступенях); лейблы только на активных рёбрах или тумблер
  showLinkLabels (меню Вид); компактные пилюли ≤380px. Юнит 6/6 + регрессии.
  ВАЖНО: .netmap.json пользователя в песочницу НЕ доехал (только скрины) —
  выводы по коду+скринам.
