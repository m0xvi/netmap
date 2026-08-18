# NetMap — интерактивная схема сети для сисадмина

Прототип desktop-приложения для Windows, которое заменяет статичные schемы Visio/draw.io живой интерактивной картой сети.

## v0.44.1 — CI/CD через GitHub Actions + фикс кнопки «Импорт» в sidebar

### 1. Auto-Release через GitHub Actions
Раньше `.exe` собирался локально командой `npm run publish:win` (нужен `GH_TOKEN`, MSVC-стек, час времени). Теперь **это делает GitHub**:

- **`.github/workflows/ci.yml`** — на каждый push в `main`: `npm ci` + `strip-cpu-features` + `tsc --noEmit` + `vite build` на Linux-runner (~1 мин). Ловит багу до релиза.
- **`.github/workflows/release.yml`** — при push тэга `v*` (например `v0.44.1`): Windows-runner делает `npm run publish:win` и заливает в **GitHub Releases**:
  - `NetMap-Setup-0.44.1.exe` (NSIS-инсталлер)
  - `NetMap-0.44.1.exe` (portable)
  - `latest.yml` + `*.blockmap` — файлы для **electron-updater**
- Ветка `main` теперь содержит только **исходники** — репо ~2 МБ вместо 100+ МБ.

### Как выпустить новую версию
```bash
# 1. Обновить package.json version (важно: должно совпасть с тэгом)
npm version 0.44.2 --no-git-tag-version
git add package.json && git commit -m "bump v0.44.2"
git push

# 2. Создать и запушить тэг → CI сам соберёт и опубликует
git tag v0.44.2
git push origin v0.44.2
```
Через ~5-10 минут `.exe` появится в Releases, и все установленные NetMap.exe покажут баннер «Доступна новая версия» (auto-updater работает как раньше через `electron-updater` + `latest.yml`).

Workflow-файл ещё умеет запускаться руками (Actions → Release → Run workflow) на случай если нужно пересобрать существующий тэг.

Sanity-check в CI: если tag = `v0.44.2`, но `package.json` = `0.44.1` — билд упадёт с понятной ошибкой.

### 2. Bug-fix: кнопка «Импорт» в левом sidebar
**Симптом (v0.43.6 – v0.44.0):** кнопка Import работает один раз. Как только выбираешь MikroTik — ImportDialog закрывается, а MikroTikImportDialog не открывается. Дальше клики по Import вообще не реагируют.

**Причина:** цепочка событий сломалась в 2 местах:
1. `MenuBar` не имел слушателя на `netmap:open-mikrotik-import`, а `ImportDialog` его диспатчил при выборе MikroTik. → MikroTikImportDialog не открывался.
2. `ImportDialog` сохранял `'mikrotik'` в `localStorage['netmap:import:last-vendor']`. При следующем открытии сразу читал MikroTik → useEffect диспатчил `netmap:open-mikrotik-import` (в пустоту) + вызывал `onClose()`. Со стороны выглядело как «кнопка мертва».

**Фикс:**
- В `MenuBar.tsx` добавлен `useEffect` с listener'ом `netmap:open-mikrotik-import` → `setMikrotikOpen(true)`.
- В `ImportDialog.tsx`:
  - Никогда не сохраняем `'mikrotik'` в `LS_LAST_VENDOR` — MikroTik всегда идёт через свой legacy-диалог.
  - При открытии игнорируем `mikrotik` из LS.
  - Редирект в MikroTik-диалог теперь только если явно передан `initialVendor === 'mikrotik'` (из «Инструменты → MikroTik»), но НЕ при обычном открытии диалога.
  - Добавлен sync `vendor` state с `initialVendor` при повторном открытии.
- **Одноразовая миграция:** при первом импорте модуля `ImportDialog.tsx` чистится залипший `mikrotik` в LS у существующих пользователей.

---

## v0.44.0 — Автообнаружение топологии (LLDP + MikroTik neighbors + Bridge FDB + ARP)

Новое ядро — **Auto-Discovery**. Раньше карту рисовали вручную (Catalog → drag&drop → соединение портов). Теперь можно взять один роутер/switch, дать логин или SNMP-community, и приложение само нарисует найденных соседей и линии между ними. Аналог Zabbix Discovery + LLDP Neighbor Map, но полностью локально и с ручным подтверждением каждой находки.

### Как это работает
1. **Tools → Автообнаружение топологии…** (`Alt+T`)
2. Форма: Source = MikroTik SSH / SNMP / **Оба** · Host · Логин / SNMP community
3. Backend делает 3 параллельных обхода:
   - **MikroTik SSH** (используем существующий `mikrotik-ssh.cjs`):
     - `/ip/neighbor print terse` — CDP/LLDP-соседи (Mikrotik + Ubiquiti + Cisco говорят на одном языке)
     - `/interface/bridge/host print terse` — MAC-таблица FDB (кто к какому порту прицеплен)
     - `/ip/arp print terse` — сопоставление MAC ↔ IP
   - **SNMP v2c walker** (новый `electron/snmp.cjs` на `net-snmp` — pure JS, без MSVC):
     - `LLDP-MIB::lldpRemTable` (`1.0.8802.1.1.2.1.4.1.1`) — сосед на каждом локальном порту
     - `BRIDGE-MIB::dot1dTpFdbTable` (`1.3.6.1.2.1.17.4.3.1`) — MAC ↔ bridge port
     - `IF-MIB::ifName` — читаемые имена портов вместо ifIndex
     - `System::sysDescr/sysName/sysObjectID` — vendor detection (MikroTik / Ubiquiti / Cisco / HPE / D-Link / Ruijie по enterprise OID)
4. Оркестратор (`electron/discovery.cjs`) сшивает 3 источника, матчит найденные MAC/IP против **текущего doc** (по `device.ip`, `device.mac`, `port.label`), дедуплицирует связи (LLDP > FDB) и возвращает **diff-предложение**:
   - `proposedDevices[]` — только те, которых ещё нет
   - `proposedLinks[]` — с ссылками либо на существующий `deviceId`, либо на `tempId` из proposedDevices

### Review-диалог (git-diff style)
- Chip-статистика сверху: LLDP-соседей / MikroTik neighbors / FDB / ARP / время
- Список **новых устройств** с чекбоксами, kind-chip (router/switch/ap/camera/…), IP · MAC · vendor
- Список **новых связей** с чекбоксами: `A :port ─ B :port` + доказательство (`LLDP on sw01:ether5`, `bridge FDB on ether3 (ARP 192.168.10.20)`)
- «Выбрать все / Снять все» на каждой секции
- Кнопка **«Применить выбранное»** → `store.applyDiscovery(diff)` — **одна операция undo** (Ctrl+Z откатит весь пакет)

### Механики защиты от мусора
- Дедупликация: если LLDP уже нашёл линк A↔B, FDB-версию отбрасываем
- Self-links (`A ↔ A`) фильтруются
- Дубликаты рёбер (в любом направлении) отсекаются по паре `(from,to)`
- Тэг `discovered` навешивается на все автоматически созданные devices → можно отфильтровать в DevicesTablePanel
- Раскладка: новые orphan'ы кладутся в grid 8 колонок ниже существующего контента (не ломают уже разложенные группы)

### Vendor detection (Zabbix-style enterprise OID matching)
```
1.3.6.1.4.1.14988   → MikroTik
1.3.6.1.4.1.41112   → Ubiquiti
1.3.6.1.4.1.9       → Cisco
1.3.6.1.4.1.11      → HPE
1.3.6.1.4.1.171     → D-Link
1.3.6.1.4.1.4881    → Ruijie
```
Плюс регексп по `sysDescr` для UniFi / Omada / Hikvision / Dahua / Aruba / Juniper.

### Новые файлы
- `electron/snmp.cjs` (~190 строк) — обёртка `net-snmp`: `get / walk / table / probe`, coerce OctetString/IpAddress/OID, стандартные OID-константы
- `electron/discovery.cjs` (~400 строк) — MikroTik SSH парсер `parseTerseLines` + SNMP LLDP/FDB walker + merge-оркестратор + вендор-хьюристики
- `src/discoveryClient.ts` — фасад с mock для browser preview
- `src/DiscoveryDialog.tsx` (~500 строк) — 4-фазный UI (form → scan → review → done)
- IPC: `netmap:discoveryTest`, `netmap:discoveryScan`
- Store: `applyDiscovery(diff)` — атомарный bulk-merge с одним undo-снапшотом
- MenuBar: `Tools → Автообнаружение топологии…` + слушатель `netmap:open-discovery`

### Что НЕ вошло в v0.44 (планы v0.45+)
- Фоновый SNMP polling метрик (CPU/RAM/interface counters) → графики sparkline
- Триггеры/алерты по метрикам (типа `iface-down`, `cpu>80`)
- SNMP-templates для конкретных вендоров
- Периодический re-discovery по расписанию
- LLDP MED (VoIP-phones + PoE budget)
- Traceroute-based topology (когда LLDP выключен)

---

## v0.43.6 — Патч: FAB→top-right, скрыть связи, кликабельная миникарта, Import icon, Modern/Legacy toggle

Пакет из 6 UX-улучшений по фидбеку пользователя (5 скринов).

### 1. LayoutFAB и «Схема выглядит запутанно» → в правый верхний угол
Раньше синий круглый FAB + плашка «Разложить автоматически» жили в bottom-left канваса и конфликтовали с левым sidebar. Теперь оба в **top-right**:
- FAB anchor: `top: 20, right: 20`
- Action-кнопки при клике на FAB раскрываются **вниз** (было — вправо)
- Плашка `hintCard` теперь `top: 20, right: 80` (слева от FAB)

### 2. Кнопка «Скрыть все связи» в FAB dropdown
Новый action в LayoutFAB: `hideEdges` (open-eye / closed-eye SVG icon). Полезно на схемах где 300+ линий закрывают карту при просмотре расположения.
- Store: `hideEdges: boolean` + `toggleHideEdges()` (persist в localStorage)
- Canvas.tsx: если `hideEdges === true` → `displayedEdges = []` (React Flow не рендерит никакие edge)
- Работает поверх всех остальных фильтров (VLAN, layer, cable-type)

### 3. Modern / Legacy — сегментированный переключатель в toolbar
Раньше только в **Settings → Оформление карты** (было 4 клика). Теперь **2 кнопки в toolbar** сверху `[Modern] [Legacy]`, стиль pill-segmented control.
- Активный стиль подсвечивается белым фоном + `#1D4ED8` текст
- Живой toggle без reload

### 4. Vault sidebar — кнопка «Развернуть» в правом верхнем углу шапки
Пользователь заметил что в **locked** и **not-initialized** состоянии кнопки Expand не было — только в unlocked. Теперь она везде.
- Клик → открывает Vault Studio на весь экран (Ctrl+K)
- SVG иконка `Maximize` (стрелки по диагоналям)

### 5. Пятая иконка «Импорт с оборудования» в activity bar sidebar
Между Vault и Settings добавлена новая иконка **Download-arrow** (SVG). Клик → диспатчит `netmap:open-import-dialog` → открывает единый ImportDialog (MikroTik / UniFi / Omada / …).
- Не переключает active panel (это action, не navigation)
- Слушатель в MenuBar подписывается на событие и открывает диалог

### 6. Кликабельная MiniMap
ReactFlow MiniMap теперь реагирует на клик:
- Добавлены props `pannable` + `zoomable`
- Handler `onClick={(_e, coord) => rf.setCenter(coord.x, coord.y, { duration: 400, zoom: rf.getZoom() })}`
- Клик по любой точке миникарты → viewport плавно (400ms) центрируется на эту точку, зум не меняется
- Cursor:`crosshair` для feedback что клик что-то делает

### Как проверить

```powershell
rmdir /s /q Q:\Desktop\netmap
npm install
npm run build:win
```

1. Открой приложение → FAB и плашка «Схема запутанно» в правом верхнем углу
2. Клик по FAB → в списке кнопок есть «Скрыть все связи» — все линии исчезают
3. В toolbar сверху `[Modern] [Legacy]` — быстрый toggle стиля
4. Sidebar → 5-я иконка (Download-arrow) — открывает Import dialog
5. Vault sidebar → верх-право есть кнопка «Развернуть» независимо от состояния
6. Миникарта в правом нижнем углу — клик в любой точке → viewport переместится туда

## v0.43.5 — Fix «километровая лента» после массового импорта

По отчёту: пользователь импортнул ~200 устройств из MikroTik ARP/DHCP → на канвасе они выстроились в полосу шириной 10000+ px в 4 строки. Раскладывать невозможно.

### Причина

Два места хардкодили сетку `% 4`:
1. **MikrotikImportDialog** — при импорте раскладывал в 4 колонки внутри группы подсети
2. **autoLayout.ts** — при auto-layout orphan-девайсы (без linked uplink switch) тоже клал в 4 строки × N колонок

Для 200 устройств из /24 подсети без связей это давало **50 колонок × 200 px = 10 000 px** горизонтали.

### Fix

**Auto-computed grid** — вместо жёсткого `% 4`:
- Автоматически ~`sqrt(N)` колонок, ограничено 4-20
- Например 200 orphans → 15 колонок × 14 строк (примерно квадрат)
- Ширина примерно 3000 px вместо 10 000

**Manual control** — новый setting `orphanGridCols` (persist в localStorage):
- **Settings → «Раскладка после импорта»** — большие кнопки-карточки: Авто / 6 / 10 / 15 / 20
- **MenuBar → View → «Плитка для орфанов при auto-layout»** — inline chip-строка с теми же опциями для быстрого переключения

Применяется:
- К следующему auto-layout (кнопка «Разложить» в LayoutFAB, `F` для fit-view не трогает раскладку)
- К следующему импорту MikroTik / UniFi / Omada
- Ретроактивно на существующие орфаны при следующем «Разложить заново»

### Как проверить

```powershell
rmdir /s /q Q:\Desktop\netmap
npm install
npm run build:win
```

1. Открой проект с 200+ импортированными устройствами
2. Меню сверху → **View → Плитка для орфанов** → выбери «10» или «15»
3. LayoutFAB (левый нижний угол) → **Разложить схему** — теперь квадратная сетка вместо ленты
4. Аналогично для нового импорта — задай сетку заранее в Settings

## v0.43.4 — Редизайн каталога устройств («Smart Accordion» стиль)

Полный рерайт `src/CatalogPanel.tsx` по референсу — аккордеон-каталог как в 1Password/Bitwarden Devices.

### Что изменилось

- **Header** — иконка куба + «Каталог устройств» + подсчёт «N шаблонов · M категорий»
- **Search** — поле «Поиск устройств…» с SVG лупой (без эмодзи)
- **Accordion body** — категории по `device.kind`:
  - Роутеры / Свитчи / Патч-панели / Точки доступа Wi-Fi / Камеры / Серверы / Виртуальные машины / VPS / ПК / POS-терминалы / Принтеры / Умные замки / Провайдеры
  - Каждая строка: иконка (в цвете кategory) + LABEL в uppercase + счётчик в pill + chevron
  - Клик по категории — разворачивает список шаблонов (аккордеон, одна секция за раз)
  - Активная категория подсвечена sky-blue `#EFF6FF` (как в референсе)
  - Последняя открытая категория сохраняется в localStorage
- **Template row** внутри развёрнутой категории:
  - 26×26 иконка в bg-цвете kategory
  - Model bold + vendor мелким серым
  - MY badge для custom-шаблонов
  - Drag'n'drop работает как раньше (кидай на карту), плюс клик = добавить в центр карты
- **Footer** — большая синяя кнопка **«+ Добавить устройство»** (по твоему запросу)
  - Открывает modal-picker: grid 3 колонки с плитками всех типов устройств (иконка + название)
  - Клик по плитке → устройство создаётся из первого доступного шаблона этого типа
  - Escape закрывает модалку
- Всплывающая подсказка «Или перетащите шаблон на карту» под кнопкой

### При поиске

Когда пользователь начинает набирать в search — все категории **автоматически разворачиваются** чтобы показать результаты. Пустой поиск — возвращает нормальный аккордеон-режим.

### Как проверить

```powershell
rmdir /s /q Q:\Desktop\netmap
npm install
npm run build:win
```

1. Сайдбар → **Устройства → Каталог**
2. Клик на любую категорию (Свитчи / Камеры / …) — раскрывается со списком моделей
3. Клик по модели — добавляет в центр карты
4. Драг модели — перетаскивает на конкретное место
5. Внизу большая синяя **«+ Добавить устройство»** — modal-picker всех типов

## v0.43.3 — Патч: каталог устройств перенесён во вкладку «Устройства»

По отчёту: пользователь искал где создавать/добавлять устройства. Каталог для drag'n'drop раньше сидел в **«Топология → Каталог»** — не самое очевидное место.

### Что изменилось

- **Сайдбар → «Устройства»** — теперь два таба сверху:
  - **«Каталог»** (по умолчанию) — draggable palette: Свитчи / Wi-Fi / Камеры / Серверы / Оконечные. Перетаскивай на карту чтобы создать. Раньше был в Топологии.
  - **«Таблица всех»** — плоская сортируемая таблица всех устройств проекта (что было раньше при клике на иконку «Устройства»).

- **Сайдбар → «Топология»** — теперь только два таба:
  - **«Слои»** — layers filter (Core / Distribution / Access)
  - **«VLAN»** — список VLAN'ов проекта

  Каталог из Топологии убран — избежать дублирования.

### Логика

- **Устройства** = всё что касается устройств: как добавить (Каталог) + что уже есть (Таблица)
- **Топология** = как схема организована: логические слои и VLAN'ы

### Как проверить

```powershell
rmdir /s /q Q:\Desktop\netmap
# распакуй netmap.zip
cd Q:\Desktop\netmap
npm install
npm run build:win
```

1. Клик на иконку **«Устройства»** в activity bar → сверху увидишь табы «Каталог» + «Таблица всех»
2. Перетащи любой тип из каталога на карту — устройство создастся
3. Клик на **«Топология»** → только Слои и VLAN, без каталога

## v0.43.2 — Патч: sidebar VaultPanel полностью переписан + кнопка закрыть в Studio

По отчёту: пользователь показал что sidebar-панель Vault (открывается кликом на щит слева) выглядела **совсем не как референс** — там были старые эмодзи, кнопки «+ Запись / Мигратор», «▼ ПАПКИ», «+ Новая папка». Я в v0.43.1 переписал только полноэкранный Vault Studio (Ctrl+K), а sidebar-panel остался старым — недосмотр.

### Полный рерайт `src/VaultPanel.tsx`
Теперь sidebar-панель Vault выглядит в том же чистом clean-стиле что и Vault Studio:

- **Header** — «Vault» + две кнопки-иконки справа: **развернуть на весь экран** (открывает Ctrl+K Studio) и **заблокировать**. Никаких эмодзи — inline SVG
- **Search** input с иконкой лупы слева и `Ctrl+K` hint справа
- **«+ New Record»** большая синяя кнопка (открывает Studio для редактирования — в sidebar нет места для полного drawer'а)
- **«Импорт» / «Экспорт»** — две текстовые кнопки в grid 1:1 (открывают VaultImportExportDialog на нужном табе)
- **CATEGORIES** — Logins / SSH Keys / Wi-Fi Passwords / Certificates / Secure Notes / API Tokens / Databases (SVG-иконки, счётчики). Автоматически из `deriveKind()`, показываются только непустые
- **TAGS** — top-20 tags со счётчиками (SVG tag-иконка)
- **Items list** внизу — compact cards (32×32 favicon-bubble + name + `••••••••••` password mask + copy-button). Клик по карточке открывает полный Studio
- **Setup / Unlock экраны** — тоже clean-стиль: gradient-shield для Setup, серый lock-box для Unlock, никаких emoji 🔐/🔒

Убрано полностью:
- «▼ ПАПКИ» accordion секция (VaultFolderTree файл остался в проекте но не используется)
- «+ Новая папка» кнопка
- «+ Запись / ⇄ Мигратор» кнопки с эмодзи в шапке
- «⛶ / ⇄ / 🔒» три эмодзи-иконки в верхнем правом углу
- «поиск по имени / URL / папке / тегу» — заменено на англ. «Search vault...» с Ctrl+K hint

### Кнопка закрыть в Vault Studio
В полноэкранном Studio (Ctrl+K) не было явной × кнопки — только Escape. Добавил **третью иконку в activity bar внизу** (после Lock) — SVG X. Tooltip «Закрыть (Esc)».

### Как проверить

```powershell
rmdir /s /q Q:\Desktop\netmap
# распакуй netmap.zip
cd Q:\Desktop\netmap
npm install
npm run build:win
```

1. Открой приложение, кликни на **щит** в левом sidebar → откроется новый VaultPanel в clean-стиле
2. Все категории и теги — с SVG иконками, никаких эмодзи
3. Ctrl+K → Vault Studio → в activity bar внизу теперь X кнопка

### Про размер архива
Пользователь заметил что архив стал 1.6 MB (был 2.2 MB). Всё в порядке:
- Проект без node_modules/dist весит 2.4 MB (94 файла в src + 16 в electron)
- Zip компрессия даёт 1.6 MB
- Разница с 2.2 MB — иконка `icon.png` теперь занимает меньше (1.0 MB vs 1.4 MB), это результат генерации нового изображения тем же промптом. На функционал не влияет.

## v0.43.1 — Патч Vault Studio: чистка UI + привязка к устройствам + текстовые кнопки

По отчёту со скрина: убраны лишние иконки, добавлена связь vault↔device.

### 1. Убраны лишние иконки в ActivityBar
Ранее в activity bar Vault Studio были 5 иконок: Vault + телефон (Devices) + глобус (Map) + колокольчик (Alerts) + Lock. Пользователь показал что 3 средние иконки — визуальный шум, потому что VaultStudio это модальный диалог, а не главная навигация.

Сейчас в activity bar только:
- **Brand-логотип NetMap** (щит) сверху
- **Vault** (active) — щит с точкой, соответствует иконке на боковой панели приложения
- **Lock** (внизу) — заблокировать vault

### 2. Иконка Vault на боковой панели приложения — щит с точкой
`NewSidebar.tsx::VaultIcon` теперь SVG-щит с точкой в центре (`<path d="M12 3l8 3v5c0 5-3.5 9-8 10..."/><circle cx="12" cy="12" r="2"/>`), полностью соответствует референсу и матчится с иконкой Vault в Studio activity bar.

### 3. Import / Export — текстовые кнопки словами
Раньше в navigator была одна маленькая иконка `⇄` рядом с заголовком «Vault». Теперь под «+ New Record» — две отдельные текстовые кнопки:
- **Импорт** — открывает VaultImportExportDialog на табе «import»
- **Экспорт** — на табе «export»

### 4. Убраны эмодзи из всего Vault Studio
Заменены на inline SVG иконки для консистентности:
- Все категории в navigator (Logins/SSH Keys/Wi-Fi/Cert/Notes/API/DB) — outline SVG
- View toggle (Cards/Table) — SVG grid vs 3 lines
- Все action кнопки в drawer (Save/Delete/QR/Generator/Show-hide/Copy/Regenerate/External link) — SVG
- Search icon, Tag icon, All Records icon — SVG
- Setup/Unlock экраны — вместо 🔐 / 🔒 emoji теперь gradient-box с shield/lock SVG внутри

Новые reusable компоненты в `VaultStudio.tsx`: `IconKey`, `IconCopy`, `IconCheck`, `IconEye`, `IconExternal`, `IconRefresh`, `IconSave`, `IconTrash`, `IconQr`, `IconDice`, `IconLink`, `IconPlus`, `IconX`.

### 5. Привязка vault-записи к устройствам на карте
Новая секция **«Привязанные устройства»** в Details tab drawer:
- Кнопка **«Привязать устройство»** открывает модалку DevicePicker с поиском по имени / IP / MAC
- Каждая привязка отображается как карточка с именем/kind/IP + кнопка «Показать на карте» (external icon) + кнопка «Убрать» (×)
- Клик «Показать на карте» → focus device + select + close Vault Studio
- Хранится в `VaultItemFull.boundDeviceIds` (уже было в схеме с v0.38, backend поддерживает)

### 6. Reverse-link в DevicePanel
В credential tab устройства теперь показывается блок **«Также связаны из Vault (N)»** — все vault-records у которых boundDeviceIds включает это устройство. Клик открывает Vault Studio. Комплементарно к традиционной `credential.vaultItemId` связи (которая 1:1).

### 7. Sharing tab убран
Placeholder «Sharing — планируется в v0.44» убран из drawer. Останется только Details + Activity. Sharing вернётся когда будет реальная реализация.

### Как применить

```powershell
rmdir /s /q Q:\Desktop\netmap
# распакуй netmap.zip
cd Q:\Desktop\netmap
npm install
npm run build:win
```

Проверка:
1. Ctrl+K — открой Vault Studio, увидишь минимальный activity bar (только Vault и Lock)
2. Import / Export — теперь отдельные текстовые кнопки в navigator
3. Клик на запись → в drawer прокрути вниз → секция «Привязанные устройства» → «Привязать устройство» → выбери из карты
4. На карте открой inspector устройства → таб Credential (значок ключа) → внизу «Также связаны из Vault» с этой записью

## v0.43.0 — Vault Studio 2.0 (1Password-style redesign) + RDP launcher

Полный рерайт `VaultStudio.tsx` по референсу пользователя — чистый 4-колоночный layout уровня 1Password / Bitwarden desktop.

### Layout (4 колонки)

```
┌────┬─────────────┬──────────────────┬──────────────────────┐
│ ⛨ │ Categories  │ Items list      │ Slide-over detail    │
│ ▨ │ + New       │  · cards view   │  (opens on click)    │
│ 🖥 │ + Search    │  · table view   │                      │
│ 🌐 │ + Tags      │                  │                      │
│ 🔔 │             │                  │                      │
│ 🔒 │             │                  │                      │
└────┴─────────────┴──────────────────┴──────────────────────┘
```

- **52px activity bar** — brand-иконка + 5 действий (Vault active, Devices, Map, Alerts, Lock)
- **240px navigator** — Vault heading, ⇄ IE/Export, Search с ⌘K hint, «+ New Record» большая синяя, CATEGORIES авто-детект (Logins/SSH Keys/Wi-Fi/Cert/Notes/API/DB), TAGS с счётчиками
- **flexible items list** — переключатель Cards/Table в шапке. Cards — как экран 1 референса. Table — как экран 2 (Device-Linked Vault) с quick-connect кнопками справа
- **480px slide-over drawer** — Details / Activity / Sharing tabs. Реф-стилевые sections: Basic Information / Password Generator / 2FA / Tags / Custom Fields / More Actions

### Smart Categories (`src/vaultCategories.ts`)

Авто-детект типа записи из URL / тегов / полей. Никакой миграции schema — derivation на лету:

- **login** — url + username + password (по умолчанию)
- **ssh** — url `ssh://`, tag `ssh`, поле `PrivateKey`
- **wifi** — tag `wifi/wi-fi`, поле `SSID`
- **cert** — tag `cert/certificate`, поле `Certificate/PEM/CA`
- **secure_note** — нет url, нет username
- **api_token** — tag `api/token/bearer`, поле `ApiKey/access_token`
- **database** — url `postgres://`, `mysql://`, `mongodb://`, etc.

Категории показываются в navigator только если хотя бы 1 запись в них есть.

### Quick-connect actions (одним кликом из table view)

Auto-detect action + host из URL:

- **SSH** (чёрная кнопка) — `ssh://` или port 22 → открывает `SshTerminalDialog` (xterm.js + ssh2, без node-pty)
- **Web UI** (синяя) — `http(s)://` → открывает в браузере, username копируется в clipboard
- **RDP** (фиолетовая) — `rdp://` или port 3389 → новый **`electron/rdp.cjs`** генерит временный `.rdp` файл + `shell.openPath()` → mstsc.exe автозапуск. Пароль копируется в clipboard с auto-clear через 45с (Windows не даёт embedded пароль без DPAPI-шифрования)
- **DB** (зелёная) — postgres/mysql/mongodb → копирует connection string `postgres://user:pass@host:port` в clipboard

### RDP Launcher (`electron/rdp.cjs`)

- Генерит стандартный `.rdp` файл в `os.tmpdir()/netmap-rdp/`
- Настройки по умолчанию: fullscreen, no cred prompt, clipboard redirect, auto-detect bandwidth
- Cleanup: файл удаляется через 60с, clipboard очищается через 45с
- Работает на Windows (auto-launch mstsc). На macOS/Linux — открывает `.rdp` в дефолт-программе

### Detail Drawer улучшения

- **Header** — 48×48 favicon-bubble + editable name + × close
- **Tabs**: Details / Activity / Sharing (Sharing пока placeholder на v0.44)
- **Basic Information** секция (реф-style) — Title / Username / Password / Strength / Website / Notes с встроенными copy-иконками ⧉
- **Password Generator** секция прямо в drawer — input + regenerate ↻ + copy ⧉ + strength bar + Length dropdown + A-Z/a-z/0-9/Symbol checkboxes
- **2FA** секция — большой синий OTP + круговой таймер (компонент TotpChip size='md')
- **More Actions** — 2×2 grid: Save/Delete + QR + Full generator

### Что сохранилось из v0.40

- Все существующие backend endpoints (vault.cjs / db.cjs / kdbx / audit / folders)
- PasswordGenerator, TotpChip, QrShareDialog — переиспользуются
- Import/Export dialog доступен из ⇄ кнопки в navigator
- Auto-lock overlay (VaultAutoLockOverlay) продолжает работать

### Что убрано

- Старый 3-колоночный layout (Folders / Items / Editor) — заменён на 4-колоночный
- Старый VaultFolderTree компонент — не используется (заменён на smart categories + tags). Файлы остались в проекте для v0.44 если понадобится вернуть.
- Health-check overview панель — вынесена, не влезала в layout. Health метрики (weak/reused/stale/no2fa) доступны через фильтр по тегам или в будущем через отдельный tab

### Как проверить

```powershell
rmdir /s /q Q:\Desktop\netmap
# распакуй netmap.zip
cd Q:\Desktop\netmap
npm install
npm run build:win
```

1. **Ctrl+K** — открывает Vault Studio
2. Категории автоматически строятся из твоих записей
3. Переключи **Table** view — увидишь quick-connect кнопки справа
4. Клик по записи → slide-over drawer справа со всеми полями
5. Если у записи URL начинается на `ssh://` или порт 22 — кнопка **SSH** запустит терминал прямо в приложении
6. Если URL `http(s)://` — **Web UI** откроет браузер
7. Если URL `rdp://` или порт 3389 — **RDP** запустит mstsc.exe (Windows)

## v0.42.1 — Патч: fix endpoint groups + connections + чистка UI

По отчёту с 3 скринами — исправил критичные баги новых карточек и убрал artifact'ы UI.

### 🐛 Critical fix: Endpoint groups не работали

**Причина:** в `ModernDeviceNode.tsx::groupEndpoints()` использовались неправильные имена полей — `link.aDeviceId/bDeviceId`. В реальной схеме в `types.ts::Link` — `fromDeviceId/toDeviceId`. Из-за этого секция «Connected Devices» с chip'ами (Wi-Fi APs / IP Cameras / Smart Locks) **никогда не появлялась** — цикл всегда возвращал пустой список.

Fix — исправил имена полей. Теперь секция появляется как ожидается.

### 🐛 Critical fix: Связи между устройствами не рисовались (modern mode)

**Причина:** мой `ModernDeviceNode` рендерил только 2 хардкодных Handle'а: `id="in"` (top) и `id="out"` (bottom). Но edges с `sourceHandle=port.id` не находили нужную точку подключения — React Flow тихо рисовал их как disconnected. Из-за этого на скрине 3 (POE_SW + 7 endpoints без collapse) — устройства были на карте, а линии между ними отсутствовали.

Fix — новый компонент `PortHandles` внутри `ModernDeviceNode.tsx`, копирует логику `CompactHandles` из `DeviceNode.tsx`:
- Handle с `id=port.id` для каждого порта устройства (source + target, invisible)
- Fallback edge-hugging handles (`_top / _right / _bottom / _left`) для связей без явного port id
- Использует `portSides.getSide()` для динамического позиционирования по геометрии линков

### 🧹 UI cleanup (по красным пометкам на скрине 1)

**1. HealthWidget убран из toolbar** — «0% Online / Network Health» перекрывался MenuBar'ом и дублировал Uptime плитку из Network Overview панели справа.

**2. LinkLegend + LayerLegend убраны из canvas** — «Легенда» в top-left и «Иерархия» chip внизу мешали просмотру карты на полный экран. Информация о цветах связей есть в Settings и на самих metric-бейджах.

**3. LayoutFAB перемещён** из bottom-right в **bottom-left**:
- Уменьшен 56→48px, action buttons 44→40px
- Action buttons теперь раскрываются **вправо** (было влево, но с новой позицией они уходили за пределы канваса)
- Не перекрывается ReactFlow MiniMap (которая в bottom-right)
- Не прячется под правой панелью когда она открыта

### Как применить

```powershell
# Замени папку целиком
rmdir /s /q Q:\Desktop\netmap
# распакуй netmap.zip
cd Q:\Desktop\netmap
npm install
npm run build:win
```

При первом запуске:
- **View → Стиль карточек → Modern**
- **View → Сворачивать endpoint'ы** — теперь секция «Connected Devices» появится в карточках switch с реальными счётчиками (Wi-Fi APs / IP Cameras / Smart Locks). Клик на chip раскрывает список конкретных устройств
- **View → Сворачивать endpoint'ы OFF** — все endpoint'ы видны как отдельные ноды, но теперь **связи между ними видны** (раньше линии были невидимы из-за handle-баga)

## v0.42.0 — HTML Menubar + Sidebar Redesign + Metric Badges (редизайн Часть 2)

Завершил вторую часть редизайна из референса.

### 1. HTML custom menubar (`src/MenuBar.tsx`)
Верхняя строка меню в стиле профессиональных приложений — **File / View / Tools / Monitor / Help**. Заменяет старый гамбургер ☰ AppMenu.
- **File** — Сохранить · Резервные копии · Импорт/Экспорт проектов · Сбросить · Выход
- **View** — Стиль карточек (Modern/Legacy) · Панели (sidebar/right) · Fit view (F) · Auto-layout · Grid/Snap
- **Tools** — Импорт с оборудования (MikroTik/UniFi/Omada/…) · Vault Studio (Ctrl+K) · Traceroute
- **Monitor** — Фоновый ping toggle · Настройки мониторинга · Центр уведомлений
- **Help** — Помощь · Проверить обновления · Настройки · О программе
- **Клавиатурные акселераторы:** Alt+F / Alt+V / Alt+T / Alt+M / Alt+H (плюс кириллические Alt+В/М/Е/Ь/Р)
- **NetMap brand** слева с фирменным N-логотипом
- Escape закрывает открытый dropdown, ArrowLeft/Right циклирует между корневыми меню

### 2. Sidebar redesign (`src/NewSidebar.tsx`)
Двухслойный: узкий 44px activity-bar + 320px content panel.

**5 иконок в activity-bar:**
- 🔗 **Топология** — табы Каталог / Слои / VLAN (все три вместе)
- 🖥 **Устройства** — плоская таблица всех устройств проекта
- 🔔 **Уведомления** — центр уведомлений с badge непрочитанных
- 🔐 **Vault** — компактный менеджер паролей (полный экран открывается Ctrl+K)
- ⚙ **Настройки** — кнопка «Открыть полные настройки…»

Клик по активной иконке — collapses панель (остаётся только activity-bar). Persist в localStorage: последний выбранный панель + collapsed state.

### 3. DevicesTablePanel (`src/DevicesTablePanel.tsx`)
Плоская таблица всех устройств проекта — новый способ навигации.
- **Столбцы**: Тип · Имя · IP · MAC · Группа · Статус (Онлайн/Оффлайн)
- **Sortable** — клик по заголовку меняет направление
- **Фильтры**: по статусу (Все / Онлайн / Оффлайн) + по типу устройства (chip'ы с иконкой и счётчиком)
- **Поиск** — по имени / IP / MAC / vendor / тегу
- **Клик по строке** — focus на карте + открывает inspector
- **Shift+клик** — multi-select
- **Bulk toolbar** внизу когда выбрано ≥1 устройство: «Снять» / «🗑 Удалить»

### 4. AlertsPanel (`src/AlertsPanel.tsx`)
Центр уведомлений — feed всех alerts из store.
- **Chip-фильтры по severity**: Все / 🔴 Critical / 🟡 Warn / ℹ Info / ✓ Success с счётчиками
- **Unread индикатор** (цветная левая полоска + подсветка фона)
- **Клик на alert с deviceId** → focus устройства на карте
- **Отметить все прочитанными** / **Очистить всё** в шапке
- **Relative time**: «только что / 5 мин назад / 3 ч назад / полная дата»
- **Открывается автоматически** по событию `netmap:open-alerts` (из Network Overview кнопки «Показать все»)

### 5. Metric badges на связях (`src/Canvas.tsx` + `src/PortEdge.tsx`)
Реализация из референса — цветные капсулы прямо на середине линии.
- **Расширенный `Port.speed`** тип: `10M | 100M | 1G | 2.5G | 10G | 25G | 40G | 100G | PoE`
- **Цветовая шкала** (совпадает с Link Legend в углу карты):
  - 100G — фиолетовый `#7C3AED`
  - 40G / 25G — светло-фиолетовый
  - 10G — синий `#2563EB`
  - 1G / 2.5G — зелёный `#22C55E`
  - 100M — амбер `#F59E0B`
  - 10M — красный (тревога)
- **Толщина линии** — соответствует скорости (100G = 4px, 10G = 2.8px, 1G = 2px)
- **Badge** — цветная капсула белым текстом, тень цвета скорости, monospace шрифт (`10 Gbps` / `100 Mbps`)
- Работает только в **modern viewMode** (в legacy — старые голубые капсулы)
- Пользователь может override через `Link.label` — тогда показывается его текст

### Технические изменения
- Убран старый `AppMenu` из `Toolbar.tsx` — теперь только `<MenuBar />` сверху и `<ProjectMenu />` в toolbar
- Backward compat: `DevicesSidebar` (старый sidebar) остался в файлах, не удалён — можно вернуться если что
- В `App.tsx` swap: `<DevicesSidebar />` → `<NewSidebar />`

### Что осталось на v0.43+
- Импортёры Ruijie / D-Link (SNMP) / EdgeSwitch (SSH) вместо заглушек
- UniFi UDM / UniFi OS (proxy path + X-CSRF-Token)
- LLDP/CDP автодискавери связей
- Bulk WoL из MultiSelectBar / DevicesTable
- MTR-style непрерывный traceroute
- Полная тёмная тема (сейчас только Vault Studio + SSH terminal тёмные)
- Backup конфигов MikroTik по расписанию
- HIBP breach check
- Reports экран (генерация PDF по проекту)

## v0.41.1 — Recovery от «пустой карты» + резервные копии + Network Overview + Link Legend

### Проблема «66 устройств есть, а карта пустая»
После отчёта о баге: 67 devices в selected, но на канвасе только пустая группа. Причина скорее всего — ноды сгруппировались в невидимой области после нашего изменения `initialNodes` deps. Комбо fixes:

**1. Автоматический recovery при загрузке проекта**
- В `Canvas.tsx` новый listener на `netmap:hydrated` → делает `fitView` в 3 попытки через requestAnimationFrame
- Guard: если после hydration все устройства в области < 50×50 px и их > 3 → показывает alert «Устройства сжаты в одну точку» с подсказкой запустить Auto Layout
- `initialNodes` useMemo теперь **не depends на `doc.links`** в legacy mode (только в modern+collapse) — убирает лишние ремаунты при ping-обновлениях

**2. Горячая клавиша F и меню «Восстановить вид»**
- Клавиша **F** → `netmap:fit-view` event → RF fitView с padding 15%, maxZoom 1.5
- Новый пункт **☰ AppMenu → Проект → «Восстановить вид»** (F)
- Новый пункт **«🔧 Разложить заново (авто-layout)»** — если ноды перемешались, одним кликом autoLayout('TB') + fitView

**3. Резервные копии проекта в SQLite**
- Новая таблица `doc_backups` в SQLite: `{ id, ts, note, json }`, лимит 20 записей
- В `db.saveDoc()` перед новым сохранением — **rotate предыдущего** снапшота в backup таблицу (dedup по контенту)
- Note автогенерируется: `auto: 66 devices, 63 links`
- IPC: `listDocBackups() / loadDocBackup(id) / deleteDocBackup(id)`
- **`src/BackupsDialog.tsx`** — новый диалог: слева список snapshot'ов с датой/содержимым, справа preview (кол-во devices/links/групп/VLAN'ов/стикеров). Кнопки:
  - **«+ Восстановить как новый проект»** — БЕЗ риска, оригинал не тронут, можно сравнить
  - **«⚠ Заменить текущий»** — с confirm dialog, текущее состояние тоже уйдёт в backup
  - **«🗑 Удалить»**
- Открывается из **☰ AppMenu → Проект → «⏮ Резервные копии…»**

### Network Overview панель (часть редизайна из референса)
- Новый компонент **`src/NetworkOverviewPanel.tsx`** — показывается в `<RightPanel />` когда **ничего не выделено**. Выделишь устройство/группу → появится обычный DevicePanel/GroupPanel. Референс-стайл:
  - 4-tile grid: Устройств всего / Клиентов / Uptime% / Связей
  - Total Bandwidth с donut-графиком (сумма скоростей всех линков по port.speed)
  - Utilization bars: Core Links / Distribution / Access / WAN
  - Alerts Summary с severity breakdown (Critical / Warning / Info) + кнопка «Показать все уведомления →»

### Link Legend (плавающий виджет)
- **`src/LinkLegend.tsx`** — floating widget в top-left канваса (как в референсе)
- Показывается только в **modern mode** и если есть хотя бы один линк
- 4 строки: `100 Gbps` (фиолет 4px) / `10 Gbps` (синий 3px) / `1 Gbps` (зелёный 2px) / `100 Mbps` (жёлтый 1.5px)
- Есть кнопка ×, состояние persist в localStorage

## v0.41.0 — Modern View: редизайн карточек + группировка endpoint'ов + скрытые панели

### Modern view mode
Новый стиль отображения карты, вдохновлённый профессиональными NMS-панелями. Переключается **☰ AppMenu → Вид → Стиль: Modern/Legacy** или **Settings → Оформление карты**. По умолчанию — Legacy (чтобы существующие юзеры ничего не заметили при обновлении).

**Что даёт modern mode (`viewMode: 'modern'`):**
- Круглые gradient-аватары 52×52 с иконкой устройства (fallback favicon для router/switch если задан mgmtUrl)
- Белые карточки с subtle shadow и скруглёнными углами 14px
- Цветной status-бейдж «Online / Offline» с точкой
- Двойной клик на hub — fitView с плавным zoom in
- Endpoint'ы (camera / ap / pc / lock / pos / printer) получают компактный горизонтальный layout

### Endpoint groups («самое главное из референса»)
Отдельный toggle `collapseEndpoints` (только для modern mode) — работает как в референсе:
- **Wi-Fi Access Points 12** / **IP Cameras 24** / **Smart Locks 8** — chip-строки внутри карточки родительского switch
- Клик по chip — раскрывается инлайн-список всех устройств этого типа с точкой online/offline
- Клик по устройству → focus в inspector
- Auto-hide связей — cable-линии к endpoint'у скрываются, чтобы не рисовать «пачку из 30 линий» в одну ноду

**Оба переключателя persist в localStorage** — не пропадают между сессиями.

### Скрытые sidebar + right-panel по умолчанию
По твоему запросу: при первом запуске **карта на весь экран**, левая и правая панель скрыты.
- В toolbar новый **PanelToggles** widget — две компактные иконки-переключалки (sidebar / right-panel) с подсветкой активного состояния
- На краях карты **floating tab-buttons** («›» слева, «‹» справа) — раскрывают панель в один клик
- Toolbar сверху остаётся видимым (по твоему выбору) — там AppMenu / project / search / alerts всегда под рукой
- Состояние persist в localStorage: `netmap:sidebarOpen` / `netmap:rightPanelOpen`

### Новые файлы / изменения
- `src/ModernDeviceNode.tsx` — новый node-компонент (hub + endpoint варианты, EndpointChip subcomponent с раскрытием списка)
- `src/store.ts` — новые поля `viewMode / collapseEndpoints / sidebarOpen / rightPanelOpen` + сеттеры с persistence
- `src/Canvas.tsx` — регистрация `modernNode`, фильтрация endpoint-девайсов из `initialNodes` и связей к ним из `initialEdges` когда collapseEndpoints активен
- `src/App.tsx` — условный рендер `<DevicesSidebar />` / `<RightPanel />`, floating edge-tab buttons
- `src/Toolbar.tsx` — `PanelToggles` widget
- `src/FileMenu.tsx` — 2 новых пункта в разделе Вид (стиль + collapse endpoints)
- `src/SettingsDialog.tsx` — новая секция «Оформление карты» с большими карточками выбора Modern/Legacy

**Что НЕ изменилось:**
- Legacy DeviceNode / SwitchNode / PatchPanelNode / ServerNode — не тронуты. Переключение обратно на legacy делает всё как было.
- Store schema, seed'ы, импортёры, vault, ping-мониторинг, updater — без изменений.
- Все существующие action'ы (autoLayout, focus, path, VLAN filter, layer filter) работают одинаково в обоих режимах.

### План v0.42 (продолжение редизайна)
- HTML custom menubar (File / View / Tools / Monitor / Help) как в референсе
- Sidebar redesign с новой структурой навигации (Topology / Devices / Clients / Alerts / Maps / Reports / Settings)
- Right panel «Network Overview» с плитками статистики + Bandwidth Utilization + Alerts Summary (как в референсе)
- Metric-бейджи на связях с цветами по скорости (Link Legend в углу)
- Возможно — тёмная тема

## v0.40.0 — Vault Studio: полноэкранный редизайн + Health-check + Favicons + QR + SSH-терминал

### Vault Studio (`src/VaultStudio.tsx`)
Полноэкранный трёхколоночный менеджер паролей уровня 1Password/Bitwarden. Открывается:
- Горячей клавишей **Ctrl+K** из любого места приложения
- Кнопкой **⛶** в компактной VaultPanel (левый сайдбар)
- Пунктом **☰ AppMenu → 🔐 Vault Studio…**

Layout:
```
┌──────────────┬────────────────────┬──────────────────────────┐
│  Health +    │  Items list        │  Item detail / edit /    │
│  Filters +   │  (favicon + tags   │  history / QR / SSH      │
│  Folders     │   + health stripe) │                          │
└──────────────┴────────────────────┴──────────────────────────┘
```

### Health-check
Новый модуль `src/passwordHealth.ts` анализирует все записи и считает:
- **Слабые пароли** (энтропия < 60 бит)
- **Дубликаты** (одинаковый password у ≥2 items)
- **Старые** (не менялись > 365 дней)
- **Без 2FA у важных** (heuristic по URL/тегам: `admin|router|firewall|mikrotik|unifi|vpn|panel|gateway|dvr|nvr`)
- **Общий счёт 0-100** с круговым прогресс-баром

Панель слева показывает 7 filter-chip'ов: Все / Слабые / Дубликаты / Старые / Без 2FA / С 2FA / Недавние (24ч). Клик — фильтрует список.

### Favicons для URL
- Новый бэкенд `electron/favicon.cjs` через `google.com/s2/favicons`
- SQLite-кэш `favicon_cache` (host → data BLOB, TTL 30 дней; negative cache 6 часов)
- Frontend `src/faviconClient.ts` с in-memory кэшем поверх backend cache
- Показываются в списке items и в шапке item editor

### QR share (`src/QrShareDialog.tsx`)
- Кнопка **📱** рядом с полем пароля → QR-код через `qrcode` npm
- Клик на QR — навел телефон, скопировал пароль
- Toggle «Wi-Fi mode»: если у записи есть SSID (через custom field), кодируется как `WIFI:S:...;T:WPA;P:...;` — телефон предлагает подключиться
- Escape закрывает, есть кнопки Show/Hide/Copy значения

### SSH-терминал (`src/SshTerminalDialog.tsx` + `electron/ssh-shell.cjs`)
- Клик **⌨ SSH** в item editor (когда есть URL + username) → открывается терминал
- **xterm.js** frontend с темой NetMap (тёмная, cyan cursor)
- Backend через **ssh2** (уже используем для MikroTik) — **не нужен node-pty**, значит не нужен MSVC на клиентском ПК сборки
- Request `xterm-256color` PTY у SSH-сервера — работает bash/RouterOS CLI/tail -f/htop
- Streaming stdin/stdout через IPC events (`netmap:ssh-data`, `netmap:ssh-close`, `netmap:ssh-error`)
- Auto-resize по контейнеру (ResizeObserver → `session.resize(cols, rows)`)
- Broad algorithms list — работает с legacy MikroTik/D-Link
- Ctrl+Shift+C / Ctrl+Shift+V — copy/paste, Escape — закрыть

### UX улучшения item editor
- Иконка вендора (favicon) в шапке
- Live entropy meter под полем пароля
- 2FA секция с зелёной плашкой если активно
- Кнопка **🌐** — открыть URL в браузере
- Кнопка **⌨ SSH** — прямой терминал
- Все копирования через 📋 с ✓ feedback и auto-clear буфера через настраиваемый timeout
- Custom fields с 📋 копированием
- Auto-focus поля Name при создании новой записи
- `/` в списке item'ов фокусит поиск

### Компактная VaultPanel в сайдбаре
- Осталась как есть, но добавилась кнопка **⛶** первой в шапке — быстрый переход в Studio
- Всё остальное работает как раньше (setup, unlock, list, editor)

### Deps
- Новые: `qrcode` (~50KB), `xterm` (~280KB), `xterm-addon-fit`, `@types/qrcode`
- Всё pure JS — никакого native. Native уже есть только `ssh2` + `better-sqlite3` (собираются с prebuilds).
- Bundle разбит на chunks: main 609KB, xterm 283KB (отдельно), qrcode 24KB (отдельно)

### Что осталось (v0.41+ идеи)
- Ruijie / D-Link (SNMP) / EdgeSwitch (SSH) — реальные implementations вместо stubs
- UniFi UDM / UniFi OS (`/proxy/network/` + X-CSRF-Token)
- LLDP/CDP автодискавери связей
- Bulk WoL из MultiSelectBar
- MTR-style непрерывный traceroute
- Тёмная тема (пока только Vault Studio + SSH терминал тёмные)
- Backup конфигов MikroTik по расписанию
- HIBP breach check (проверить пароли через haveibeenpwned k-anonymity API)
- Auto-fill в браузер / другие приложения (через shortcut)

## v0.39.2 — Патч: сборка без Visual Studio (убран cpu-features)

**Проблема:** `npm run build:win` падал на ПК без Visual Studio Build Tools с ошибкой `node-gyp failed to rebuild cpu-features` / `Could not find any Visual Studio installation`.

**Причина:** `cpu-features` — это optional native dep у `ssh2`. Она нужна только для тонкой оптимизации шифра, ssh2 работает и без неё. Но `@electron/rebuild` при packaging пытается её пересобрать через node-gyp → MSVC.

**Решение:** новый скрипт `scripts/strip-cpu-features.cjs` удаляет `node_modules/cpu-features` (и `nan`) сразу после `npm install` через `postinstall` hook. Плюс перед каждым `build:win / publish:win` — на случай если кто-то использовал `--ignore-scripts`.

**Что теперь нужно на клиентском ПК для сборки:**
- Node.js 20+
- npm 10+
- Больше ничего. Никакого Visual Studio, никакого Python.

Обновление в этой версии — только фикс сборки, функциональность не изменилась.

## v0.39.1 — Патч: диагностика ошибок обновления + сброс vault по «забыл пароль»

### Ошибки обновления теперь дублируются в notification centre
- Раньше `state='error'` от `electron-updater` показывался только в красной плашке под toolbar; если пользователь её скрыл или скролл ушёл — ошибка терялась.
- Теперь через `UpdateBanner` идёт `pushAlert()` в `store.alerts` → колокольчик 🔔 в toolbar подсвечивается unread badge.
- Dedup по тексту ошибки: одна и та же ошибка из повторных ретраев updater'а не флудит центр уведомлений.

### Понятные тексты ошибок обновления
- Новый helper `explainUpdateError(raw)` в `UpdateBanner.tsx` — превращает сырую `HttpError: 404 releases.atom` в:
  - `404 releases.atom` → «Репозиторий приватный или релиз опубликован как Draft. Сделайте репозиторий публичным на GitHub и опубликуйте черновик.»
  - `403` → «GitHub отклонил запрос. Если репозиторий приватный — нужен GH_TOKEN. Проще сделать репозиторий публичным.»
  - `ENOTFOUND / ETIMEDOUT / ECONNRESET` → «Нет соединения с GitHub. Проверьте интернет / прокси / файрвол.»
  - `Cannot find latest.yml` → «На релизе нет файла latest.yml. Пересоздайте релиз командой npm run publish:win.»
- Кнопка «Подробнее» показывает полную ошибку в alert для копипаста в диагностику.

### Vault: «забыл мастер-пароль» → сброс
- Под кнопкой «Разблокировать» появилась скромная ссылка «Забыли пароль? Сбросить vault…»
- Раскрывается предупреждение с confirmDialog: «Все зашифрованные записи и папки будут удалены безвозвратно. Проект НЕ пострадает.»
- Новый IPC `netmap:vaultReset` → `electron/vault.cjs::reset()` → `db.vaultResetAll()` (wipe `vault_meta / vault_items / vault_folders / vault_audit`, не трогает `kv / doc / templates`).
- Первая запись нового audit — `action: 'reset'`.
- После сброса откроется форма создания нового мастер-пароля.

### DB path показывается в Setup/Unlock экранах
- Строка `📁 База: C:\Users\...\AppData\Roaming\NetMap\netmap.db` под формой — чтобы пользователь понимал, WHERE лежит vault, и не путал installed / portable сборки.

## v0.39.0 — Vault v3: KeePass (.kdbx) I/O, экспорт, drag-drop папки, мигратор

### KeePass (.kdbx) импорт/экспорт
- **Новый модуль `electron/vault-kdbx.cjs`** — обёртка над `kdbxweb` с Node webcrypto (`crypto.webcrypto.subtle`) и опциональным Argon2 через `argon2-browser`. KDBX3 (AES-KDF) работает всегда; KDBX4 (Argon2) если argon2-browser корректно инициализируется, иначе понятная ошибка «пересохраните как KDBX 3.1».
- **Импорт**: renderer читает `.kdbx` как ArrayBuffer, шлёт base64 + master password в main → получает `items[]` + `folders[]` → gigantic normalized shape → `vaultImport()` через уже существующий encrypted pipeline. Папки KeePass переносятся как дерево (parent/child).
- **Экспорт**: renderer вызывает `vaultExportAll()` (bulk-decrypt в main), пользователь задаёт новый master password для нового `.kdbx`, `buildKdbx()` собирает и возвращает base64 → браузерный download.
- **TOTP round-trip**: сохраняется как поле `otp` в формате `otpauth://totp/…?secret=…` — совместимо с KeeOTP, KeePassXC, KeeWeb. При импорте secret извлекается из URI regex'ом либо из плоского field'а `TOTP` / `HmacOtp-Secret-Base32`.

### Bitwarden JSON экспорт (был только импорт)
- Формат совместим с `bitwarden.com/help/encrypted-export → JSON (unencrypted)`. Warning: пароли в открытом виде, красная плашка предупреждает.

### CSV экспорт
- KeePass-совместимый flat CSV: `Group, Title, Username, Password, URL, Notes, TOTP, Tags`. Group — путь `Отели/Усадьба/MikroTik`. Тот же warning об открытом виде.

### Audit log CSV
- Кнопка «⤓ Экспорт CSV» рядом с «Очистить журнал» в SettingsDialog → Безопасность. Дампит все до 500 записей: `Timestamp, Action, Item, Detail`.

### Мигратор embedded credentials → vault
- Новая вкладка **«⇄ Мигратор из устройств»** в VaultImportExportDialog.
- Сканирует `doc.devices` и находит устройства у которых есть `credential.username / credential.notes` но **нет** `credentialId` / `credential.vaultItemId`.
- Для каждого создаёт (или переиспользует по совпадению IP/имени) vault-item, привязывает через `device.credentialId = vaultItem.id`.
- Кнопка на VaultPanel быстрый доступ: «⇄ Мигратор» (фиолетовая).

### Drag-drop дерево папок
- **`src/VaultFolderTree.tsx`** — новый компонент. Раскладной tree слева в VaultPanel (в `<details>` секции «Папки»), компактный режим.
- **Drag folder → folder** = reparent (`vaultFolderUpsert({ parent })`)
- **Drag folder → «Без папки»** = to root
- **Drag vault-item → folder** = переносит запись (`dataTransfer.type = 'netmap/vault-item'`)
- **Cycle prevention** — нельзя переместить папку в своего потомка (`isDescendant` guard)
- **Right-click → rename / delete** (через promptText с r/d командами)
- Кнопка **«+ Новая папка»** под деревом
- При выборе конкретной папки в дереве — фильтруется список items справа, кнопка «+ Запись» pre-fill'ит `folder` этим id

### Bulk export IPC (`vaultExportAll`)
- Main-process декриптит все items за раз, возвращает `{items, folders}` с полными секретами. Пишется в audit log как `export`.
- Renderer использует для kdbx / bitwarden / csv экспорта — данные не покидают main process без явного действия пользователя.

### Deps
- Добавлены `kdbxweb ^2.x` (main-process, in-memory bundle, ~250KB, только в electron), `argon2-browser` (optional, для KDBX4)
- `package.json > asarUnpack` дополнен `node_modules/argon2-browser/**` (wasm-файл не любит asar)

### Что осталось на v0.40
- Ruijie / D-Link (SNMP) / EdgeSwitch (SSH) impl (заготовки stubs с v0.37)
- UniFi UDM / UniFi OS (`/proxy/network/` + `X-CSRF-Token`)
- LLDP/CDP автодискавери связей между свитчами
- Bulk WoL из MultiSelectBar
- MTR-style непрерывный traceroute
- Тёмная тема
- Backup конфигов MikroTik по расписанию

## v0.38.0 — Vault Manager v2 + Fix импорта MikroTik

### Часть А — Fixes импорта
- **Bug fix: подсети не фильтровали выделение** — MikrotikImportDialog учитывал `selected` без пересечения с `filtered`, из-за чего исключённые subnets всё равно попадали в импорт. Заменено на `effectiveSelected = selected ∩ filteredMacs`, счётчик показывает 271 из 189 → корректно.
- **Per-row action selector** — в таблице новая колонка «Действие» для конфликтов (rows с `existingId`):
  - `пропустить` (по умолчанию — больше НЕТ silent auto-update!)
  - `обновить пустые` (merge fresh data только в пустые/автогенерированные поля)
  - `заменить всё` (полная перезапись name/ip/vendor/comment)
- **Bulk toolbar** над таблицей: «Пропустить все / Обновить пустые / Заменить все» для видимых конфликтов
- **Import preview** в footer: `+N новых · ↻M обновить · ⚡K заменить · ⊘L пропустить`, кнопка использует effective count
- Тот же fix применён и к новому `ImportDialog.tsx` (UniFi / Omada Cloud)
- `importUtils.ts.commitImport()` теперь принимает `Map<mac, ImportAction>` и возвращает `{ placed, updated, replaced, skipped, groupCount }`

### Часть Б — Vault Manager v2 (KeePass-подобный)

**Backend (`electron/vault.cjs` + `db.cjs`):**
- Расширенная схема item: `{ ..., tags[], fields{}, totpSecret?, boundDeviceIds[], history[10] }`
- **История версий паролей** — при каждом изменении password старая версия ложится в `history[]` (лимит 10)
- **Auto-lock по idle** — main-process таймер: если `vaultTouch()` от renderer'а не приходил N минут → `lock()` + broadcast event `netmap:vault-auto-locked`
- **TOTP (RFC 6238)** — SHA-1 HMAC + 30s step + 6 digits, base32 secret decoder, без npm-пакетов (crypto builtin)
- **Password generator** — server-side rejection-sampled uniform random. Опции: length 8-64, toggles lower/upper/digits/symbol, exclude ambiguous (l/1/L/o/0/O)
- **Audit log** — новая таблица `vault_audit`: `{ ts, action, itemId?, itemName?, detail }`. Хранит последние 500. Actions: `init/unlock/unlock-fail/lock/view/edit/create/delete/import/folder-*`
- **Folder tree** — новая таблица `vault_folders` (unencrypted meta, чтобы сайдбар показывался и в locked state)
- **Access time tracking** — `accessed` колонка обновляется при каждом `getItem()`

**IPC (preload):**
```
vaultTotp(id)               → { code, remaining, period }
vaultGenPw(opts)            → { password }
vaultAuditList(limit)       → [{ id, ts, action, itemName, detail }]
vaultAuditClear()
vaultFoldersAll()           → [{ id, parent, name, color }]
vaultFolderUpsert(f)
vaultFolderDelete(id)
vaultSetIdle(ms)            → передаёт idle timeout в main process
vaultTouch()                → сбрасывает idle timer
onVaultAutoLocked(cb)       → подписка на событие авто-локи
```

**Frontend:**
- **`src/PasswordGenerator.tsx`** — модалка с length slider, character toggles, strength meter (entropy-based: <40 очень слабый, 40-60 слабый, 60-80 средний, 80-100 сильный, >100 очень сильный), кнопки Regenerate/Copy/Apply. Используется из VaultItemEditor и как standalone.
- **`src/TotpChip.tsx`** — live 6-digit код с круговым SVG-таймером 30→0 сек. Цвет меняется: `>10s` зелёный, `5-10s` жёлтый, `<5s` красный. Клик копирует. Автообновление при досчёте до 0.
- **`src/VaultAutoLockOverlay.tsx`** — fullscreen blur-overlay с формой unlock. Показывается по событию `netmap:vault-auto-locked`. Слушает mousemove/keydown/click → `vaultTouch()` каждые 5s чтобы сбрасывать таймер бэкенда.
- **`VaultPanel.tsx > VaultItemEditor`** — расширен: TOTP secret + inline TotpChip, tags chips с add/remove, custom fields (key/value), history раскрывающийся список, кнопка 🎲 для генератора, boundDeviceIds badge
- **`VaultPanel` список items** — иконки `🔐` (has TOTP), `🔗N` (bound to devices), теги chips, поиск по тегам
- **`SettingsDialog` вкладка «Безопасность»** — idle timeout slider (0-60 мин), clipboard clear timeout (0-60s), audit log с фильтром по действию, кнопка «Очистить журнал»
- **`DevicePanel`** — TotpChip показывается в CredentialTab если у привязанного vault-item есть TOTP
- **Device.credentialId** — новое поле (пока опциональное, работает параллельно с существующим `device.credential.vaultItemId`)

**Что осталось на v0.39:**
- Импорт/экспорт `.kdbx` (KeePass) через npm `kdbxweb` — требует webcrypto polyfill + argon2
- Экспорт в Bitwarden JSON (сейчас только импорт)
- Мигратор embedded credentials → vault items (по кнопке «Найдено N паролей в устройствах — перенести?»)
- Дерево папок drag-drop UI
- Bulk-операции над audit log (фильтры, экспорт CSV)

## v0.37.0 — Per-vendor importers (UniFi + Omada Cloud) + единый Import Dialog

### Что нового
- **Новая директория `electron/importers/`** — по одному модулю на вендора, единый интерфейс `testConnection(cfg)` / `scan(cfg)` → универсальный `ScanResult`.
- **UniFi Controller (self-hosted, 8443)** — полностью рабочий. Session-cookie auth (`POST /api/login`), sites list, `/stat/device` (APs/switches/gateways), `/stat/sta` + `rest/user` (клиенты Wi-Fi/LAN), `rest/networkconf` (VLANs + подсети). Принимает self-signed TLS.
- **TP-Link Omada Cloud** — cloud API `omada.tplinkcloud.com` (email+пароль → token → orgs → sites → devices/clients). **MFA пока не поддерживается** — временно отключить в аккаунте для импорта.
- **Ruijie Cloud / D-Link (SNMP) / Ubiquiti EdgeSwitch (SSH)** — заготовки-stubs. UI работает, возвращают «планируется в v0.38». Каждый — отдельный модуль в importers/ готовый к наполнению.
- **`src/ImportDialog.tsx`** — единый диалог с dropdown вендора. Форма подстраивается под VendorMeta.fields. Переиспользует subnet-picker и логику классификации по подсетям из MikroTik-импорта через `importUtils.ts`.
- **`src/importUtils.ts`** — экстрактнутая логика `buildRows` / `filterRows` / `commitImport(scan, rows, sourceTag)`. Создаёт группы по CIDR, ставит теги `imported`, `<vendor>`, `net:<cidr>`, авто-layout после импорта.
- **MikroTik остаётся отдельным диалогом** (SSH-транспорт и raw-debug button требуют специфичного UI), но появляется в dropdown единого диалога — при выборе перекидывает на legacy MikrotikImportDialog через `netmap:open-mikrotik-import` event.

### UI
- **☰ AppMenu → Импорт с оборудования:**
  - MikroTik (SSH / REST)…
  - UniFi Controller…
  - TP-Link Omada Cloud…
  - Другое (Ruijie / D-Link / EdgeSwitch)… — открывает единый диалог, юзер выбирает stub из dropdown.

### IPC (preload)
```
window.netmap.importTest({ vendor, config })  → { ok, identity?, version?, error?, sites?, orgs? }
window.netmap.importScan({ vendor, config })  → ScanResult (leases/arp/interfaces/vlans/addresses)
```

### План v0.38
- Ruijie Cloud OpenAPI (API-key based)
- D-Link через `net-snmp` (SNMP v2c/v3 walk по `ifTable` + `ipNetToMediaTable`)
- Ubiquiti EdgeSwitch через тот же ssh2 (reuse из MikroTik SSH client)
- UniFi UDM/UniFi OS (`/proxy/network/` + X-CSRF-Token)
- LLDP/CDP автодискавери связей между свитчами
- Bulk WoL из MultiSelectBar, MTR-style непрерывный traceroute

## v0.36.2 — Auto-updater, Wake-on-LAN, Traceroute (внутренний + ICMP)

### 1. Auto-updater через GitHub Releases
`electron-updater` + `electron/updater.cjs`.

**Backend flow:**
- При старте (packaged, не dev) через 5 сек стучит на GitHub API `/repos/<owner>/<repo>/releases/latest`.
- Сравнивает published version с текущей.
- Если новее — автоматически скачивает `.exe` в фоне (differential update NSIS).
- По окончании — event `netmap:update-status` со `state='downloaded'`.

**Renderer:**
- `src/UpdateBanner.tsx` под toolbar показывает состояние:
  - `available` — «🔔 Доступна версия X. Начинаем загрузку…» + «Загрузить сейчас».
  - `downloading` — progress bar с процентами + скоростью.
  - `downloaded` — «✓ Готово. Установить и перезапустить».
  - `error` — красная плашка.
- ☰ AppMenu → **«⇩ Проверить обновления…»** — форс-проверка сейчас.

**Настройка перед публикацией:**
1. В `package.json > build.publish` замените:
   ```json
   "owner": "REPLACE_ME_GITHUB_USER",
   "repo":  "REPLACE_ME_REPO_NAME"
   ```
2. Экспортируйте `GH_TOKEN` (github token с правами `write:repo`).
3. `npm run publish:win` — соберёт + залил installer + `latest.yml` в GitHub Releases.

Клиенты после этого получат обновление автоматически при следующем запуске.

**В dev-режиме updater отключён** (проверяется `app.isPackaged`) — состояние `disabled`, баннер не показывается.

### 2. Wake-on-LAN
`electron/wol.cjs` — magic packet sender (чистый dgram, без сторонних либ).

**Backend:**
- IPC `netmap:wolSend({ mac, broadcastIp?, port? })`.
- Если `broadcastIp` не задан — отправляет на **все локальные broadcast** адреса + `255.255.255.255` (перекрывает все интерфейсы машины).
- `port` по умолчанию `9`, можно `7`.

**UI:** новый блок **«Быстрые действия»** в Inspector → Overview (виден только у устройств с MAC/IP):
- Кнопка **⏻ Wake-on-LAN** — отправляет пакет через IPC.
- Раскрывающиеся «Настройки WoL» → поле **Broadcast IP** (сохраняется в `device.wolBroadcastIp`). Нужно когда target в удалённой подсети с directed-broadcast forwarding.
- После отправки — success/error плашка + запись в notification centre.

### 3. Traceroute (внутренний + ICMP)
`electron/traceroute.cjs` — обёртка вокруг системного `tracert` (Windows) / `traceroute` (Unix). Парсит вывод, стримит hop'ы через IPC events.

**Backend flow (streaming):**
- IPC `netmap:tracerouteStart({ target, maxHops, timeoutMs, requestId })` → запускает child_process.
- Каждая распознанная строка → event `netmap:traceroute-hop { requestId, hop: { n, host, rttMs, timeout } }`.
- По завершении — `netmap:traceroute-done { requestId, ok, error? }`.
- `netmap:tracerouteStop({ requestId })` — прервать.

**Парсер справляется с:**
- Windows: `"  1     2 ms     1 ms     1 ms  192.168.11.1"`, `"  2     *        *        *     Request timed out."`, `"<1 ms"`.
- Unix: `" 1  192.168.11.1  0.412 ms"`, `" 2  *"`.
- Unit-тестировано на sample-выводах (см. `_parseHopLine`).

**UI:** новый диалог **`src/TracerouteDialog.tsx`**, открывается через:
- Inspector → Overview → **🛣 Traceroute** (у устройств с IP).
- Или программно: `window.dispatchEvent(new CustomEvent('netmap:open-traceroute', { detail: { targetIp, targetDeviceId, sourceDeviceId } }))`.

Две панели в диалоге:
- **Путь по кабелям** (внутренний, синхронный) — использует существующий `traceCable()`. Показывает hop-цепочку по физическим соединениям через патч-панели и свитчи.
- **ICMP traceroute** (live) — таблица `# / Host / RTT`. Заполняется по мере поступления hop'ов, не ждём завершения. Кнопка «Остановить». RTT цветом: зелёный < 30ms, жёлтый 30-100ms, красный > 100ms.

Escape закрывает + автоматически прерывает активный traceroute.

### Backend deps (новые)
- `electron-updater ^6.x` — auto-updater.
- `dgram` (built-in) — Wake-on-LAN.
- `child_process` (built-in) + system `tracert`/`traceroute` — traceroute.

### Как обновиться и попробовать
```powershell
Remove-Item -Recurse -Force F:\Desktop\Projects\netmap
Expand-Archive netmap.zip -DestinationPath F:\Desktop\Projects\netmap
cd F:\Desktop\Projects\netmap
npm install
npm run build:win
```

**Проверка:**
1. Клик на устройство с IP → правая панель → Overview → блок «Быстрые действия» → **🛣 Traceroute** → выбрать/подтвердить цель → «Запустить». Слева — внутренний путь, справа — ICMP.
2. Клик на PC/сервер с MAC → **⏻ Wake-on-LAN**. Раскрыть «Настройки WoL» → указать broadcast IP если нужно.
3. Для auto-update: в `package.json > build.publish` заменить owner/repo, экспортировать `GH_TOKEN`, `npm run publish:win` — залить в GitHub Releases. Следующий запуск клиентов покажет баннер обновления.

### Что дальше — v0.37
Из вашего списка ещё осталось:
- **Импорт с UniFi Controller / EdgeSwitch / TP-Link Omada / Ruijie Cloud / D-Link** — per-vendor модули в `electron/importers/`.

---

## v0.36.1 — Единое меню, Splash, Loading overlay, Telegram + Toast

### 1. Toolbar → главное гамбургер-меню
Логотип «N» + подпись «NetMap» + рассыпанные кнопки help / focus-related убраны с верхней панели. Освободившееся место — под главное меню слева (☰ AppMenu). Внутри:
- **Проект**: Сохранить сейчас · Сбросить к демо-схеме.
- **Файл**: Импорт/экспорт JSON проектов и всей рабочей области.
- **Импорт с оборудования**: MikroTik (SSH / REST).
- **Вид**: Фокус связанных (toggle).
- **⚙ Настройки…** — открывает новое многовкладочное окно.
- **? Помощь · горячие клавиши**.

В шапке дропдауна — маленький градиентный логотип NetMap (взамен утекшего с toolbar).

Справа в toolbar остался только 🔔 (notifications badge с непрочитанными).

### 2. Splash screen + progress overlay
Новый `src/LoadingOverlay.tsx`:
- **Splash** — полноэкранная градиентная заставка `#2563EB → #7C3AED` с иконкой и спиннером при старте приложения. Скрывается по событию `netmap:hydrated` (после `hydrateFromNativeBackend`) или через 800 мс fallback.
- **Progress overlay** — полупрозрачный blur-overlay с карточкой (спиннер + title + message). Поднимается на события `netmap:progress-start` / `-end`. Поддерживает несколько параллельных задач.

Overlay привязан к:
- **Разложить схему** (FAB) — на 100+ устройствах dagre считает 0.5-2s.
- **Развернуть все / Свернуть все** — двойная операция display + autoLayout.
- **Экспорт PNG / SVG** — html-to-image может быть очень медленный.

### 3. Настройки — новое окно ⚙
`src/SettingsDialog.tsx`. Открывается из AppMenu, рендерится через `createPortal(body)` (чтобы FAB не перекрывал). Вкладки:

**Общие**: snap to grid · показывать сетку · фокус связанных.

**Мониторинг** (фоновый ping): вкл/выкл + слайдер интервала 10-300 сек. Показывает сколько устройств с IP-адресами в текущем проекте будут пинговаться. `PingMonitor` уже давно готов — теперь его настройки легко найти.

**Уведомления**:
- Toggle-каналы: **In-app** (🔔 в toolbar), **Windows toast** (native `Notification` API), **Telegram** (bot).
- **Severity фильтр** во внешние каналы: только критичные / +warnings / всё.
- Telegram fields: **Bot Token** (password input), **Chat ID**, **HTTP-прокси** (для стран с блокировкой Telegram — поддерживается http:// и socks5://).
- **Кнопка Проверить** — отправляет тестовое сообщение через IPC `netmap:telegramSend`.

**О программе**: версия + ссылка на debug инструменты.

### 4. Notification fan-out: Telegram + Windows toast
`src/NotificationDispatcher.tsx` — невидимый listener store.alerts:
- При появлении новой записи (не уже виденной при mount) → продублировать в enabled каналы согласно severity.
- **Windows toast** — через `new Notification()` API. Silent для success, ping для critical. Click на toast → фокус на устройстве.
- **Telegram** — через IPC → `electron/telegram.cjs` → Bot API `sendMessage`. Формат HTML: `🔴 <b>Заголовок</b>\ntext\n\n<b>Устройство:</b> имя\n<i>время</i>`.

**Прокси для Telegram** реализован через optional-пакеты `https-proxy-agent` + `socks-proxy-agent`. Если пакеты не установлены — прокси недоступен, но обычная отправка работает. `URL` парсится: `http://…`, `socks5://…`, `socks://…`.

### 5. Background ping — работает
`PingMonitor` (v0.14) уже собирал pingHistory + генерировал `AlertEntry` с severity=critical при переходе up→down. Работал только когда пользователь включал в старом UI. Теперь **включение перенесено в Настройки → Мониторинг**, и alerts дальше проходят через `NotificationDispatcher` в Telegram / toast.

### Как поставить
```powershell
Remove-Item -Recurse -Force F:\Desktop\Projects\netmap
Expand-Archive netmap.zip -DestinationPath F:\Desktop\Projects\netmap
cd F:\Desktop\Projects\netmap
npm install
npm run build:win
```

**Проверка:**
1. Запустить — увидеть splash с иконкой.
2. ☰ → Настройки → Мониторинг → включить ping, интервал 30 сек. Устройства с IP начнут пинговаться.
3. ☰ → Настройки → Уведомления → включить Telegram, ввести токен + chat ID → «Проверить» → должно прилететь в чат.
4. ☰ → Настройки → Уведомления → включить Windows toast (Windows спросит разрешение при первом toast).
5. FAB → Разложить схему — увидеть overlay «Автораскладка схемы».

### Что дальше (следующая итерация)
Из ваших заявок ещё не сделано:
- **Импорт с UniFi Controller / EdgeSwitch / TP-Link / Ruijie / D-Link** — REST API каждого разный, нужен per-vendor модуль.
- **Wake-on-LAN** — Magic packet через IPC + кнопка на PC/сервер карточке.
- **Traceroute UI** — mtr-style диаграмма с hop-time.

---

## v0.36.0 — Классификация импорта по подсетям + fix z-index FAB / LayerLegend

### 1. Классификация импортированных устройств по подсетям
Раньше импорт из MikroTik складывал всё в одну группу «DHCP · host». Теперь при импорте:

1. Для каждого выбранного устройства определяется его **CIDR** (используется тот же `summarizeSubnets` что и в subnet-picker).
2. Для каждой уникальной CIDR создаётся **отдельная группа** (или переиспользуется существующая с тем же subtitle=CIDR).
3. Устройства без IP уходят в группу «Без IP».
4. Имя группы — из /ip address comment (если < 30 символов), иначе `interface · CIDR`, иначе `Подсеть CIDR`.
5. Цвет группы — детерминированный hash от CIDR, так что повторные импорты той же подсети получают тот же цвет.

Устройства помечаются тегом `net:192.168.11.0/24` — работает поиск `tag:net:192.168.11`.

Notification centre теперь пишет: `Разложено по 4 подсетям` вместо старого `Новые устройства в группе X`.

### 2. Фикс всплывающих кнопок LayoutFAB / LayerLegend над модалкой импорта
Даже с `zIndex: 4000` модалка Mikrotik'а перекрывалась синим FAB'ом и легендой слоёв в углу канваса.

Причина: модалка рендерилась внутри `<Toolbar>` (child древа App), а FAB — внутри `<div style={{ flex: 1, position: 'relative' }}>` (canvas-wrapper). Оба — соседи в DOM, но canvas-wrapper **позже** в порядке рендера + `position: relative` создаёт stacking context для своих детей → LayoutFAB рисуется поверх модалки независимо от z-index.

Fix: **`MikrotikImportDialog` теперь рендерится через `createPortal(..., document.body)`**. Модалка попадает в конец DOM, вне всех stacking contexts, и её `zIndex: 4000` работает корректно.

---

## v0.35.12 — Fix: `Unsupported algorithm: chacha20-poly1305@openssh.com`

### Что показал предыдущий debug
Ошибка `SSH handshake не прошёл: Unsupported algorithm: chacha20-poly1305@openssh.com` — это **не** ошибка роутера. Это ssh2 **до** попытки handshake, при валидации моего algorithm list. В некоторых сборках Electron/Node библиотека не может инициализировать chacha20-poly1305 и падает. Роутер запрос вообще не увидел.

### Fix (2 барьера)

**1. Не запрашивать chacha20** — удалил его из списка cipher'ов в `electron/mikrotik-ssh.cjs`. Оставлены AEAD (`aes*-gcm@openssh.com`) + CTR + CBC + 3des. Этого более чем достаточно для любого RouterOS.

**2. Автоматический fallback на любые unsupported алгоритмы:**
- `filterToSupported(algos)` **перед connect**: сверяет каждый алгоритм со списком `SUPPORTED_*` из ssh2 и вычищает неизвестные. Если ssh2 в этой Electron-сборке не знает какой-то cipher/hmac — молча пропускаем его вместо синхронного throw.
- `runCommand` **при runtime-ошибке** `Unsupported algorithm: X` — автоматически повторяет connect с урезанным набором (без `X`). Рекурсивно, пока unsupported не закончатся или пока какое-то поле не опустеет.

Если после всех retry'ев не остаётся ни одного алгоритма в каком-то bucket'е — пробрасываем понятную ошибку.

**3. Human-friendly сообщение для `Unsupported algorithm`** в диалоге:
> Внутренняя проблема в клиенте: алгоритм «X» не поддерживается сборкой ssh2 в этой версии Electron.
> Это баг NetMap — теоретически исправлен авто-fallback'ом. Если видите это сообщение — обновите NetMap до 0.35.12+.

### Что должно поменяться у пользователя
На вашем роутере (я не могу его апгрейдить, есть только strong-crypto=no / legacy алгоритмы) теперь клиент отправит на handshake **только те алгоритмы, которые ssh2 в вашем Electron реально умеет**. Без синхронного throw. Handshake либо пройдёт (99% случаев), либо покажет реальную KEX-ошибку с подсказкой про `/ip ssh set strong-crypto=no`.

### Как проверить
1. Замените папку `netmap`; `npm install`; `npm run build:win`.
2. SSH-скан.
3. Ожидание: либо заработает, либо увидите **другую** ошибку (уже про сам handshake, не про клиент). Пришлите новый скрин если не поможет.

---

## v0.35.11 — Реальный fix SSH: расширенный набор алгоритмов + fail-fast

### Что показал debug у пользователя (спасибо!)
```
[ошибка] Handshake failed: no matching key exchange algorithm
```
на **всех** командах. То есть SSH-подключение вообще НЕ проходило handshake. Но UI показывал зелёный `✓ Подключено` — это был bug моей `testConnection`: она глушила ошибку через `.catch(() => '')` и всё равно возвращала `{ ok: true }`.

### Реальная причина
`ssh2@1.17` (актуальная версия) исключает из **дефолтного** списка legacy KEX-алгоритмов, которые нужны для RouterOS 6.x и hardened setups. У меня был список из 5 KEX, но роутер пользователя не поддерживает ни один из них — вероятно очень старый ROS + `strong-crypto=yes`, ограничивающий алгоритмы.

### Fix

**1. `electron/mikrotik-ssh.cjs` — максимально широкий набор алгоритмов** (ssh2 поддерживает исторически, просто не enables by default):
- **KEX**: 12 алгоритмов — от `curve25519-sha256` (ROS 7+) до `diffie-hellman-group1-sha1` (ROS 6.x), плюс `group-exchange-sha1`/`sha256`, `ecdh-sha2-nistp*`.
- **Cipher**: `chacha20-poly1305`, `aes*-gcm` (оба варианта `@openssh.com` и голый), `aes*-ctr`, `aes*-cbc`, `3des-cbc`.
- **HMAC**: sha2-256/512 (etm+plain), sha1 (etm+plain), md5.
- **HostKey**: ed25519, ecdsa-nistp*, rsa-sha2-*, ssh-rsa, ssh-dss.

Порядок — modern first, legacy fallback. Строгие политики (`strong-crypto=yes`) сохраняются автоматически.

**2. `testConnection` больше НЕ глушит ошибку** — handshake/auth failure пробрасывается наружу. UI теперь корректно покажет красный error-баннер вместо ложного зелёного «Подключено».

**3. `scan` fail-fast** — если testConnection упал, не запускаем ещё 6 fetch-команд с той же ошибкой (не тратим время + не спамим handshake-попытками).

**4. Improved error messages** — три новых ветки в `explainConnectionError`:
- `no matching key exchange` → подсказка про `/ip ssh set strong-crypto=no` или обновление RouterOS.
- `no matching cipher/hmac/host key` → отдельная подсказка.
- Общий handshake fallback показывает сырое сообщение.

**5. Улучшена error-панель** — pre-wrap, увеличенный шрифт, границы, чтобы многострочный текст с командами читался.

### Как проверить
1. Замените папку `netmap`; `npm install`; `npm run build:win`.
2. Попробуйте SSH-скан снова. Ожидания:
   - Или заработает (расширенный набор KEX перекрывает всё).
   - Или увидите красный баннер с точной командой для роутера (`/ip ssh set strong-crypto=no`).
3. Если всё ещё handshake failed — пришлите вывод `/ip ssh print` с роутера и я подкручу.

---

## v0.35.10 — Hotfix парсера SSH + «Показать сырой ответ» debug

### Что было не так
На скрине пользователя: SSH подключился (`✓ Подключено`), но `unknown / RouterOS unknown / uptime` — значит **все команды парсились в пусто**, включая `/system resource print`. Даже 0 DHCP / 0 ARP.

Причина — парсер `parseTerse` был слишком строгий:
1. Требовал строку начинающуюся с цифры без ведущего пробела — но MikroTik пишет `" 0 D ..."` (leading whitespace для выравнивания).
2. Line-wrap heuristic сшивал соседние строки некорректно.
3. `runCommand` не использовал `without-paging` → на длинных выводах CLI ждал нажатия «Y» для следующей страницы, но у нас non-tty session.
4. Флаг-блок парсился только как одно слово — `XD`, `DR`, `XDR` не матчились.

### Fix (`electron/mikrotik-ssh.cjs`)
- **Rewritten `parseTerse`**: правильно принимает ведущие пробелы, распознаёт multi-char флаги (`XD`, `DR`, `DC` и т.д.), сшивает continuation-lines только когда они реально wrap'нутые.
- **Все команды теперь `print terse without-paging`** — снимает pause-prompts.
- **`testConnection` использует `:put [/system identity get name]`** — прямой вывод строки, без парсинга «name: X» (было sensitive к пробелам).
- **`scan()` последовательный** вместо `Promise.all` — некоторые старые RouterOS не любят 6 одновременных SSH сессий.
- Unit-тест: парсер корректно разбирает три варианта строк (флаги, длинные индексы, quoted values) — проверено на sample.

### Новое: «🐞 Показать сырой ответ роутера»
Когда после успешного скана таблица устройств пустая, вместо простого «Ничего не найдено» показывается **диагностическая панель** с:
1. Списком вероятных причин (нет прав на `/ip/dhcp-server`, пустая ARP-таблица, всё отфильтровано подсетями).
2. Подсказкой правильной команды на MikroTik стороне:
   ```
   /user group set read policy=read,ssh,api,rest-api,winbox
   ```
3. Кнопкой **«🐞 Показать сырой ответ роутера»** (только для SSH-транспорта). Прогоняет каждую команду по отдельности и показывает **точный вывод RouterOS** в раскрывающихся `<details>` блоках. Плюс кнопка «📋 Скопировать всё» — можно отправить разработчику.

Backend: новая IPC команда `netmap:mikrotikDebug` → `mikrotik-ssh.cjs.fetchRawDebug(cfg)`.

### Улучшен header диалога и badge подключения
- Заголовок диалога: `SSH · RouterOS CLI · DHCP · ARP · VLAN · подсети` (раньше говорил «REST API v7+» даже при SSH).
- Badge «Подключено»: показывает `identity` роутера (реальное имя из `/system identity`), а не голый `boardName: unknown`. Пустые поля скрываются вместо `unknown / unknown / uptime`.

### Как обновиться и проверить
1. Замените папку `netmap`; `npm install`; `npm run build:win`.
2. Попробуйте снова тот же импорт (SSH `192.168.11.1:4345`, `netmap` / пароль).
3. Если после «Сканировать» список опять пустой — нажмите **🐞 Показать сырой ответ роутера** и скиньте вывод. Точно поймём в чём дело.

**Скорее всего** после обновления парсер вытянет DHCP+ARP+VLAN сразу без debug — исходная проблема в парсере, не в правах пользователя.

---

## v0.35.9 — Импорт из MikroTik через SSH + фильтр подсетей

### 1. Новый транспорт: SSH (CLI) вместо REST API
На production-роутерах веб-интерфейс обычно выключен (`/ip service disable www,www-ssl`), но SSH — открыт по умолчанию и рутинно доступен. Раньше импорт возвращал:
```
⚠ connect ECONNREFUSED 192.168.11.1:80
```
Теперь в диалоге импорта — **радио-переключатель транспорта** сверху:
- **SSH (CLI)** — по умолчанию. Работает через `ssh2` npm-пакет (pure-JS), драйвит RouterOS-shell командами `print terse` и парсит вывод.
- **REST API** — старый транспорт (для тех, у кого web включён).

**SSH-порт** конфигурируется отдельным полем (стандарт 22), либо пишется прямо в host: `192.168.11.1:2222`.

Backend: `electron/mikrotik-ssh.cjs` — новая точка входа. Использует те же публичные функции (`testConnection`, `scan`, `fetchDhcpLeases`, `fetchArp`, `fetchInterfaces`, `fetchVlans`, `fetchAddresses`), поэтому UI не различает транспорты — просто в cfg передаётся `transport: 'ssh'`.

**Права на MikroTik-стороне** для SSH — достаточно read-only юзера с политикой `ssh, read` (или `ssh, read, api`).

### 2. Человеческие сообщения об ошибках
`ECONNREFUSED` / `ETIMEDOUT` / `handshake failed` теперь конвертируются в понятный текст с рекомендациями. Например:
```
Порт закрыт: 192.168.11.1

REST API (:80 или :443) отключён или заблокирован. Варианты:

1. Переключитесь на «SSH (CLI)» вверху диалога — работает даже когда web выключен.

2. Или включите REST на роутере:
   /ip service enable www
   /ip service enable www-ssl
   /user group set read policy=+api,+rest-api
```

Покрыто: `ECONNREFUSED`, `ETIMEDOUT`, `EHOSTUNREACH/ENETUNREACH`, `ENOTFOUND`, auth-failed, handshake-failed, certificate errors.

### 3. Subnet picker — выборочный импорт подсетей
После сканирования появляется **новая секция «Подсети»** (когда найдено ≥2 подсетей). Показывает все обнаруженные CIDR'ы:
- **Из `/ip address` роутера** (📡) — приоритет, реальная конфигурация.
- **Инференс /24** — из уникальных IP в DHCP/ARP, если роутер не отдал CIDR явно.

Каждая подсеть — pill с:
- CIDR (`192.168.11.0/24`)
- бейджем количества устройств в ней
- значком 📡 если подсеть из `/ip address`
- зачёркиванием если исключена

Click → toggle. Кнопки «Оставить все» / «Убрать все». В таблице устройств строки автоматически фильтруются: остаются только те, чей IP попадает в **активные (не исключённые)** подсети. Devices без IP (MAC-only ARP) отображаются всегда — не участвуют в subnet-фильтре.

Utility в `mikrotikClient.ts`:
- `summarizeSubnets(scan) → SubnetStat[]` — агрегация.
- `ipInAnyCidr(ip, cidrs[]) → boolean` — проверка вхождения IP в набор CIDR.

### 4. Новая команда роутера — `/ip address print terse`
Backend теперь запрашивает список IP-адресов роутера (нужно для subnet picker). Работает и через SSH, и через REST (`/rest/ip/address`).

### Как обновиться и попробовать
1. Замените папку `netmap` содержимым нового zip; `npm install`; `npm run build:win`.
2. В приложении: **☰ AppMenu → Импорт с MikroTik REST API…** (кнопка теперь фактически «MikroTik», транспорт выбирается в самом диалоге).
3. Введите: адрес `192.168.11.1`, порт `22`, логин/пароль. Транспорт по умолчанию **SSH**.
4. **Сканировать** → появится список найденных подсетей (кликабельные pill'ы). Отключите ненужные (например `192.168.100.0/24 guest wifi`).
5. Отметьте устройства чекбоксами → **Импортировать**.

---

## v0.35.8 — Редизайн rack + compact + фикс исчезающих endpoints

### 1. Опять пропадают endpoints после «Разложить» — реальная причина
`autoLayout()` в star-layout вычислял позицию orphan-endpoints (устройств без anchor'а):
```ts
const rightmost = Math.max(...anchorX.values());   // → -Infinity, если anchorX пустой
const startX = rightmost + ENDPOINT_COL_W;         // → -Infinity
// ... x: startX + col * ENDPOINT_COL_W - s.width / 2   → -Infinity
// ... Math.round((-Infinity + PAD_X) / 20) * 20         → NaN
```
NaN попадал в `doc.devices[i].{x,y}`. React Flow с `extent:'parent'` клипил их за bounds group → **устройство исчезало**.

**Fix (двойной барьер):**
- `autoLayout` (`src/autoLayout.ts`): проверка `anchorXs.length > 0 ? Math.max(...) : 0`. Никакого больше Infinity.
- `store.autoLayout` reducer теперь оборачивает каждую координату в `safeFinite(v, fallback)` — если из computeAutoLayout прилетело NaN, оставляем **старую** позицию, не пишем мусор в doc.

### 2. Rack-view свитчей / роутеров / patch-panel / server → CLEAN VECTOR GRID
Полный редизайн по референсу пользователя (variant 1 из мокапа):

```
┌────────────────────────────────────────────────────────────┐
│ [icon] SW_CORE  [Online]                    [1G][PoE+][VLAN]│
│         TL-SG3428XMP · 10.11.99.28                          │
├────────────────────────────────────────────────────────────┤
│  [1G] [1G] [PoE] [PoE] [1G] [1G] [VLAN] [1G] [PoE] [1G]     │
│  [🞔]  [🞔]  [🞔]  [🞔]  [🞔]  [🞔]   [🞔]   [🞔]  [🞔]  [🞔]  │ ⚡ 240W
│   •    •    •    •    •    •    •    •    •    •           │ PoE Budget
│   1    3    5    7    9   11   13   15   17   19          │
│   2    4    6    8   10   12   14   16   18   20          │ ⌂ 4
│   •    •    •    •    •    •    •    •    •    •           │ VLANs
│  [🞔]  [🞔]  [🞔]  [🞔]  [🞔]  [🞔]   [🞔]   [🞔]  [🞔]  [🞔]  │
│  [1G] [PoE] [VLAN][1G] [PoE] [1G]  [1G]  [PoE][1G] [1G]     │
└────────────────────────────────────────────────────────────┘
```

- **Header**: иконка свитча (тёмно-синяя на бледно-синем badge) + name + Online/Offline pill + модель·IP + chip-легенда (`1G`, `PoE+`, `VLAN`).
- **Port grid**: 2 ряда по N портов. Каждый порт = `chip сверху` (`1G`/`10G`/`PoE`/`PoE+`/`V10`) + **новая RJ-45 иконка** (векторная тёмная с пин-барами) + **точка link-status** (зелёная = up, серая = down, красная = error).
- **SFP** отдельным блоком снизу через dashed-разделитель.
- **Uplink** порт помечается ↑ значком поверх RJ-45.
- **Right sidebar**: `24 Ports` · `370W PoE Budget` · `4 VLANs` — крупные цифры с иконками. Кнопка `…` внизу — свернуть в compact.
- Layer stripe (Core/Distribution/Access) слева сохранена.

### 3. Compact-view → COMPACT SEGMENTED BAR
Горизонтальная одностраничная карточка (variant 2 мокапа):
```
[icon] SW_CORE (Online)  Ports 18/24 ▮▮▮▮▮▮▮▮▮▮▯▯▯▯▯  PoE 240W  VLAN 4  [◱]
       TL-SG3428XMP · 10.11.99.28
```
- Иконка + name + Online/Offline pill + модель/IP слева
- **Сегментированный bar** активных портов (заполненные квадраты)
- PoE / VLAN мини-чипы справа
- `[◱]` — развернуть в rack

Замена старой compact-карточки (вертикальный mini-faceplate) — на новый горизонтальный layout ~320×64.

### 4. Обновлены sizes в autoLayout + collide
`nodeSize` в `src/autoLayout.ts` и `readSizeForKind` в `src/collide.ts` пересчитаны под новые размеры (rack 480×200, compact 320×64) чтобы reflow/collision алгоритмы работали корректно.

---

## v0.35.7 — Иконка · автозапуск · русификация · радиальная FAB · ProjectMenu/AppMenu

### 1. Установщик — иконка + автозапуск после установки
- Своя иконка приложения `build/icon.ico` (multi-resolution: 16, 24, 32, 48, 64, 96, 128, 256). Показывается в заголовке окна, на панели задач Windows, в ярлыках. Дизайн: rounded-square с синим-фиолетовым градиентом и белой сеткой узлов.
- В `nsis` config добавлены: `runAfterFinish: true` (запуск сразу после установки), `createDesktopShortcut: true`, `createStartMenuShortcut: true`, `shortcutName: "NetMap"`, свой `installerIcon`.
- `electron/main.cjs` передаёт иконку в `BrowserWindow({ icon })` и `title: 'NetMap'`.
- `extraResources` копирует `.ico` в `resources/build/` собранного приложения.

### 2. Русификация интерфейса
- Sidebar «Devices» → **«Устройства»**, поиск «Search devices…» → **«Поиск устройств…»**.
- Разделы: Network → **Сеть**, Wireless → **Wi-Fi**, Cameras → **Видеонаблюдение**, Servers → **Серверы**, Endpoints → **Оконечные устройства**.
- Item labels: `Core Switch` → **«Свитч (ядро)»**, `Router` → **«Маршрутизатор»**, `Firewall` → **«Файервол»**, `Patch panel` → **«Патч-панель»**, `PC` → **«ПК»**, `POS` → **«Касса»**, `Printer` → **«Принтер»**, `SALTO Lock` → **«СКУД (замок)»**, `ISP / Cloud` → **«Провайдер / облако»** и т.д.

### 3. Регистратор в левой панели создания
В разделе **«Видеонаблюдение»** появились готовые preset'ы:
- **Регистратор 8 каналов** — Hikvision iVMS, 1×2TB
- **Регистратор 16 каналов** — TRASSIR, 2×4TB
- **Регистратор 32 кан. 4K** — Dahua DSS, 4×8TB

Каждый item — это `kind: 'server'` с preset'ом `dvr` (deep-copy на клик). При создании через палитру устройство сразу получает бирюзовую DVR-иконку и полностью заполненный видео-блок в inspector.

### 4. Toolbar перекомпонован
**Убрано с верхней панели:**
- `+ Add Device` — есть же полная левая палитра.
- `📥 Import` — переехало в AppMenu.
- `⋮` kebab overflow — все действия переехали в радиальную FAB на канвасе.

**Новое разделение:**
- **`<AppMenu />`** — гамбургер `☰` (крайний слева). Содержит: Импорт/Экспорт JSON, Импорт с MikroTik REST, Сброс проекта к демо. При импорте/экспорте пишет в notification centre.
- **Вертикальный разделитель** между AppMenu и ProjectMenu.
- **`<ProjectMenu />`** — кнопка с иконкой папки и именем активного проекта. Содержит только: список проектов (переключение), Новый / Дублировать / Переименовать / Удалить.

### 5. Радиальная FAB — все действия на канвасе
Кнопка в правом нижнем углу канваса (была квадратная разложить-кнопка). Теперь:
- **Закрыта** — синий градиентный круг 56×56 с иконкой 2×2 (как на скрине пользователя).
- **Клик** → главная кнопка поворачивается на 45° (превращаясь в ✕), а **9 action-иконок «выезжают» справа налево** с shift-stagger (35 ms между каждой) на spring-easing.
- **Повторный клик / Escape / клик по backdrop** → иконки складываются обратно в главную кнопку.

Actions по порядку выезда:
1. **Отменить** (Ctrl+Z) — с счётчиком
2. **Повторить** (Ctrl+Y) — с счётчиком
3. **Нож** (T) — активная становится красной
4. **Разложить схему**
5. **Развернуть все** свитчи в rack-view
6. **Свернуть все** в compact
7. **Экспорт PNG**
8. **Экспорт SVG**
9. **Экспорт JSON**

Disabled кнопки полу-прозрачные и не кликабельны (например Undo когда history пуст). Каждая имеет tooltip.

---

## v0.35.6 — Drag device → device: выбор портов + Notification Center

### 1. Drop device on device → диалог выбора порта
Перетащите одно устройство на другое → появится модалка **«Соединить устройства»** с:
- Двумя выпадающими списками портов (source / target).
- Для каждого порта — id, label, тип разъёма (RJ45/SFP/…), скорость, PoE-флаг. Занятые порты помечены серым и «— занят».
- Preselect'нут первый свободный порт с каждой стороны.
- Тумблер типа кабеля: **Медь RJ-45** / **Оптика** / **Wi-Fi** (автовыбор Оптика если хотя бы один порт SFP/SFP+).
- Enter — соединить, Escape — отмена, клик по фону — отмена.

**Проверки перед открытием диалога:**
- Целевое или source устройство **без портов** (например `cloud`) → показывается `alertDialog` «Нельзя соединить, у устройства нет портов» + запись в notification centre. Кабель не создаётся.
- **Все порты заняты** → «Нет свободных портов у …. Освободите порт (Inspector → Ports) и попробуйте снова.» + запись в NC.
- Диалог **не закрывает счёт** — dropped карточка автоматически возвращается на своё место (не остаётся стоять поверх target).

**Визуальная подсветка при drag:** пока таскаете карточку и её центр оказывается внутри чужой карточки — цель обводится **пунктирным янтарным outline** (`.netmap-connect-target` в CSS) — сразу видно куда «отпустишь».

**Успешное соединение** → запись `success` в notification centre вида:
> «Кабель создан — SW_CORE · ETH7 → CCTV_karet · POE»

### 2. Notification Center — новая роль колокольчика
Кнопка ⚠ / 🔔 в toolbar раньше показывала только ping-alerts. Теперь это **единый inbox** для всего важного:
- **Ошибки** (ErrorBoundary) — критичные React errors + `window.onerror` + unhandled promise rejections.
- **Ping мониторинг** — устройство down/up (как раньше).
- **События** — импорт из MikroTik, создание кабеля через drag-connect, будущие экспорт/import/reset.

**Badge:**
- Кол-во = **непрочитанные** (обнуляется при открытии дропдауна).
- Цвет = красный если есть critical, амбер если warn, синий иначе.

**Дропдаун:**
- Фильтр-табы: **Все / Ошибки / Ping / События** с счётчиками.
- Каждая запись — заголовок + сообщение + метка времени + origin + имя устройства (если есть). Клик на запись с deviceId → focus на устройство.
- Цвет строки по severity: красный (critical), амбер (warn), зелёный (success), нейтрально-синий (info).
- Пометка «непрочитанное» — свечение точки-индикатора.
- Кнопки **«Копировать»** (весь лог в буфер обмена — удобно кидать разработчику) и **«Очистить»**.
- ErrorBoundary теперь дублирует все ошибки в NC — красный баннер уходит по «Скрыть», но запись остаётся навсегда.

### Модель
Новые типы данных:
- `AlertEntry` расширен полями `severity`, `origin`, `read`, `title`.
- `Device.attachedToRegistrarId` / `cameraIds` (v0.35.5) уже добавлены.

Новые store actions:
- `pushAlert(entry)` — универсальный push (severity + origin + title + message + optional device).
- `markAllAlertsRead()` — вызывается при открытии дропдауна.

Новый файл: `src/PortPickerDialog.tsx` — независимый модальный host (не через Modal.tsx, потому что нужен богаче UX чем prompt/confirm).

### Как обновиться
1. Замените папку `netmap` содержимым нового zip (или удалите старую и распакуйте).
2. `npm install`
3. `npm run dev` (проверить) или `npm run build:win`
4. Попробуйте перетащить AP на свитч — должен появиться диалог. Наведите на 🔔 в toolbar — должна открыться новая панель уведомлений.

---

## v0.35.5 — Camera↔DVR связка + фикс ResizeObserver loop

### 1. Реальная причина «исчезли устройства после drag» — найдена
Из ErrorBoundary пользователь прислал: `ResizeObserver loop completed with undelivered notifications`. Это спец-warning браузера когда один элемент ресайзится дважды за фрейм — React Flow делает это легитимно во время measurement. Сам по себе безобиден, НО он был симптомом более серьёзной проблемы:

**Цепочка эхо между React Flow и store:**
1. Пользователь drop-нул устройство.
2. `resolveCollisions` вызывал `setPosition` для каждого сдвинутого соседа **сепаратно** (N раз).
3. Каждый `setPosition` → doc.devices новая ссылка → `initialNodes` пересчитывается → `setNodes(initialNodes)` в useEffect.
4. React Flow получает свежий массив nodes и **эмитит back `NodeChange` типа `position:!dragging`** (потому что позиция изменилась в prop).
5. `handleNodesChange` **безусловно** коммитил эту позицию через `setPosition` → doc снова меняется → снова initialNodes → эхо-цикл.
6. ResizeObserver ловит бешеный ре-mount и бросает warning; в промежутке scene рендерится с 0 device nodes.

**Fix:**
- Новый action **`applyPositions(moves[])`** — batch-обновление N позиций в одном reducer'е.
- `resolveCollisions` и `reflowGroupChildren` теперь собирают все ходы в массив и делают **один** `applyPositions` вместо N `setPosition`.
- `handleNodesChange` теперь **пропускает** position-changes, значение которых с точностью до 0.5 px уже совпадает с doc — эхо от setNodes(initialNodes) больше не коммитится обратно.
- ErrorBoundary добавил ignore-list для «ResizeObserver loop» warning (спам-фильтр).

### 2. Camera ↔ DVR/NVR связка
Новые поля в `Device`:
- `attachedToRegistrarId?: string | null` — для kind='camera'
- `cameraIds?: string[]` — для kind='server' (DVR)

**Inspector → Hardware:**
- **Камера:** секция «Запись видео» → селект «Пишет на регистратор» из списка всех серверов с DVR-блоком (или названием DVR/NVR/Reg_CCTV/…). При выборе автоматически синхронизируется counterpart на регистраторе.
- **Регистратор (server + dvr):** секция «Подключённые камеры · N / channels» → список привязанных камер (с ✕ отвязать) + селект «Добавить камеру» с показом сколько каналов свободно. Если камер больше чем каналов — красное предупреждение.
- Обе стороны синхронизированы: правка на камере автоматически обновляет DVR, и наоборот.

**Визуально на карточке камеры:** маленький бирюзовый чип `📹 Reg_CCTV_U1` под IP — сразу видно на канвасе куда пишется поток.

**Seed'ы Усадьбы:** все CCTV_* привязаны к Reg_CCTV_U1 (ресторан+каретная, 7 камер из 16 каналов); CCTV_U4 → Reg_CCTV_KONY (1 из 8).

### Как обновиться и получить фикс
1. **Полная замена файлов**: удалите старую папку `netmap`, распакуйте новый zip. Или через PowerShell:
   ```powershell
   Remove-Item -Recurse -Force F:\Desktop\Projects\netmap
   Expand-Archive netmap.zip -DestinationPath F:\Desktop\Projects\netmap
   ```
2. `npm install`
3. `npm run dev` (проверка) или `npm run build:win`
4. **Файл → «Сбросить проект к демо-схеме»** — обновит связи камер с регистраторами.

---

## v0.35.4 — Компактный Inspector + DVR icon + AP rack-view + Error Boundary + защита координат

### 1. Error Boundary — конец белым экранам
Новый `src/ErrorBoundary.tsx` оборачивает всё приложение. При любой ошибке рендера показывает **полноэкранный красный отчёт** с:
- Полным stack trace (scrollable)
- Component stack (какой компонент упал)
- URL, UserAgent, время
- Кнопки **«Скопировать отчёт»**, «Попробовать восстановить», «Перезагрузить»

Плюс глобальные listener'ы `window.onerror` и `unhandledrejection` — ловят и non-React ошибки (event handlers, промисы), собирают их в **красный баннер внизу экрана** с deatails и кнопкой «Скопировать».

Теперь любой сбой не выкидывает белый экран, а сразу показывает что случилось.

### 2. Inspector — компактный tab-bar (иконки без подписей)
8 вкладок с текстовыми подписями не влезали в 360-px правую панель. Теперь **только иконки** 17×17 в квадратных кнопках 30×30, tooltip с русским названием, синяя полоска под активной. Все 8 tabs (Overview / Ports / VLANs / Links / Hardware / Alerts / Access / Config) помещаются даже на минимальной ширине.

### 3. DVR/NVR — своя иконка и цвет
Новая `DvrIcon` в `src/icons.tsx` — стилизованный видеорегистратор с play-треугольником, LED-точками, слотами HDD и мини-камерой на верху. Используется в `ServerNode` когда:
- `device.dvr` заполнен, ИЛИ
- имя/модель матчится `dvr | nvr | reg[_-]?cctv | trassir | hikvision | dahua`

Такие устройства также получают бирюзовый цвет (`#0891B2` / `#ECFEFF`) вместо серого серверного — сразу видно на канвасе.

### 4. AP — расширенный rack-view
AP-точки теперь тоже поддерживают toggle между compact и rack (кнопка ◱). В rack показывается **AP-специфичная карточка**:
- Иконка + имя + IP
- Vendor · Model
- Секция **SSIDs** — каждый SSID отдельной строкой с:
  - именем (mono-font)
  - band-бейджем: **2.4G** (синий), **5G** (зелёный), **6G** (фиолет), **2.4+5** (пурпурный)
  - тегами **Guest** / **Hidden**
- Секция **Uplink** — порт с его speed, PoE ⚡ индикатор, статус UP/DOWN
- Секция **VLAN** — цветные пилюли всех VLAN на портах AP

### 5. Регистратор в панели создания (Palette)
Три готовых template:
- **Hikvision NVR 8ch** — 8 каналов, 1×2TB, iVMS
- **Trassir NVR 16ch** — 16 каналов, 2×4TB, TRASSIR
- **Dahua NVR 32ch 4K** — 32 канала 4K, 4×8TB, Dahua DSS

Template содержит preset `dvr` — при создании устройства из палитры канал/диски/ПО сразу заполнены. То же для `hostSpec` (Supermicro 1U теперь preset с Xeon + 64GB + 480GB SSD) и `ssids` (можно добавить preset AP с готовыми SSID). `makeDeviceFromTemplate` копирует эти поля с deep-clone.

### 6. Опять баг «пропали все устройства при drag patch-panel» — новые защиты
Причина, скорее всего: `resolveCollisions` push'ил соседей в отрицательные абсолютные координаты, `relX = rect.x - parent.x` становился отрицательным, React Flow с `extent: 'parent'` клипил их невидимо.

Fix:
- **`resolveCollisions` теперь клампит siblings** после чейн-push'а: `x ≥ 8`, `y ≥ 48` внутри группы. NaN → safe cell.
- **`setPosition` и `setGroupPosition` в store** отклоняют NaN/Infinity сразу через `Number.isFinite` — не даём мусору попасть в doc.
- **`normalize()` при загрузке** дополнительно чинит **orphaned groupId** (device ссылается на удалённую группу → сбрасывает в null, устройство появляется на canvas).

Также если сбой повторится — теперь Error Boundary покажет отчёт, и мы точно узнаем где рвётся.

### Как обновиться
1. **Полная замена файлов**: удалите старую папку `netmap`, распакуйте новый zip.
2. `npm install`
3. `npm run dev` (проверка) или `npm run build:win`.
4. В приложении: правая панель Inspector — 8 иконок в один ряд; Reg_CCTV_* карточки бирюзовые с DVR-иконкой; expand AP через ◱ → развернутый вид с SSID/band/VLAN; палитра создания содержит 3 NVR-шаблона.

---

## v0.35.3 — Убрана ссылка на afterPack.cjs из build config

**Проблема:** electron-builder падал:
```
⨯ Unable to `require`  moduleName=F:\...\build\afterPack.cjs
  message=Cannot find module '...\build\afterPack.cjs'
```
`build/afterPack.cjs` — файл-подстраховка добавленный в v0.35.1 — не попал в распаковку (папка `build/` была в zip пустая, потому что `zip` пропустил её если файл не разархивировался). electron-builder ищет модуль по пути из package.json и падает fatal.

**Причина:** в v0.35.1 я добавил в `package.json > build.afterPack: "./build/afterPack.cjs"`. При этом файл-подстраховщик — no-op (только логирует). Настоящий фикс rcedit — `signAndEditExecutable: false` — работал сам по себе.

**Fix:** убрал `"afterPack": "./build/afterPack.cjs"` из package.json. Файл больше не нужен. Ошибка «Cannot find module» уйдёт.

Из лога видно что **rcedit-ошибки больше нет** — `signAndEditExecutable: false` из v0.35.1 работает. Осталось только убрать несуществующую ссылку.

---

## v0.35.2 — Редактор Hardware + фикс исчезающих устройств + умный Reset

### 1. Пропадают устройства после перемещения — фикс
**Причина:** при drop карточки с re-parent'ом (перенос между группами) `finalRelX/Y` могли уйти в глубоко-отрицательные координаты (карточка большая, целевая группа далеко). React Flow с `extent: 'parent'` тихо клампил их за bounds parent → карточка визуально исчезала. Плюс `resolveCollisions` ловил старую ссылку `node` от drag события и двигал sibling'ов на её основе → они тоже уходили в невидимые координаты.

**Fix:**
- Drop-логика в `Canvas.onNodeDragStop` теперь **клампит `finalRelX/Y`** в bounds новой группы: `x ∈ [8, group.width - 60]`, `y ∈ [48, group.height - 40]`. Отдельно защищает от NaN/Infinity.
- `resolveCollisions` вызывается с **виртуальной нодой** с уже-клампленными координатами (не с оригинальной ссылкой `node` от React Flow), так что двигает соседей относительно реальной позиции.
- `normalize()` (при загрузке из SQLite/localStorage) **чинит битые координаты**: NaN → safe cell (20, 52), отрицательные внутри группы → 20, 52, супер-большие (>6000 px) → тоже 20, 52. Старые «сломанные» документы становятся видимыми при первом же открытии.

### 2. Reset проекта → берёт правильный seed
Раньше «Сбросить» всегда подсовывал Усадьбу, независимо от активного проекта. Теперь:
- `resetToSeed()` смотрит на имя активного проекта: если «Дона» → `donaSeed`; «Чайковский» → `chaikovskySeed`; иначе → Усадьба.
- Кнопка в FileMenu теперь называется «Сбросить проект к демо-схеме», подтверждение показывает имя проекта.
- **После reset применятся все актуальные seed'ы v0.35**: SSID для AP, hostSpec для SRV_HYPERV/SRV_UTM, dvr для Reg_CCTV_*.

### 3. Новая вкладка Inspector — Hardware (⚙)
В DevicePanel новая вкладка **Hardware** между Links и Alerts. Показывает разные редакторы в зависимости от типа устройства:

**AP (Wi-Fi точка):**
- Список SSID: имя, диапазон (2.4/5/6/both), флаг guest, флаг hidden.
- Кнопки + SSID / ✕ удалить.

**Server:**
- **Железо и ОС:** CPU, RAM (GB), OS + версия, форм-фактор (1U/2U/4U/Tower/Mini), список ПО через запятую.
- **Диски:** объём GB, тип (HDD/SSD/NVMe), модель, роль (system / VM store / archive).
- **DVR/NVR (если применимо):** каналы всего + активных, разрешение (720p/1080p/4MP/5MP/4K), retention в днях, ПО (TRASSIR/Xeoma/Hikvision), список дисков для архива с автоподсчётом «Итого X TB».
- Кнопка «+ Настроить DVR» для устройств где DVR ещё не задан; «Убрать DVR-блок» — для очистки.

**VM:** ссылка на существующий редактор в Overview.

Все правки сразу же отражаются на карточке на канвасе (SSID-чипы под IP на AP, OS-бейдж и Hardware-блок на rack-view сервера, DVR-панель бирюзовая).

### Как получить фичи v0.35 в существующем проекте
1. Файл → **Сбросить проект к демо-схеме** — заменит текущий проект на свежий seed с ssids/dvr/hostSpec.

**Или**, если хочется сохранить свои изменения:

2. Кликнуть на нужное устройство → правая панель Inspector → вкладка **Hardware** → внести данные вручную.

---

## v0.35.1 — Build fix: отключён rcedit (обходим ошибку «Unable to commit changes»)

### Проблема
На несистемных дисках (F:, D:) и/или при активном Windows Defender / Controlled Folder Access / Dropbox / OneDrive sync — `rcedit-x64.exe` не может дописать метаданные PE-заголовка (FileVersion, ProductName и т.д.) в свежесобранный `NetMap.exe`. electron-builder падает с:
```
⨯ cannot execute  cause=exit status 1
  errorOut=Fatal error: Unable to commit changes
  command='...rcedit-x64.exe' 'F:\...\NetMap.exe' --set-version-string FileDescription '...'
```

Метаданные — косметика (правой кнопкой → Свойства → Подробно). Функциональность приложения от них не зависит. Но electron-builder v25 стал жестче — теперь падает сразу, без повторных попыток.

### Fix
В `package.json > build.win` добавлено:
- `"signAndEditExecutable": false` — **отключает вызов rcedit целиком** (official electron-builder API).
- `"verifyUpdateCodeSignature": false` — не проверять подпись при обновлениях.
- `"forceCodeSigning": false` — не требовать signing certificate.
- `"requestedExecutionLevel": "asInvoker"` — не запрашивать админ-права зря.

Также:
- Добавлен `author` в package.json (убирает warning про missing author).
- Добавлен `build/afterPack.cjs` — no-op hook на случай, если будущий electron-builder попытается что-то ещё писать в exe.
- Новые scripts: `build:win:portable` (только portable) и `build:win:dir` (только распакованная папка, без installer — самая быстрая проверка).
- Артефакты теперь называются `NetMap-Setup-0.35.1.exe` и `NetMap-Portable-0.35.1.exe`.

### Что стало
- `NetMap.exe` собирается **без метаданных PE** (в Свойствах → Подробно поля будут пустые).
- Функциональность полная: NSIS-installer (`NetMap-Setup-*.exe`) и portable exe.
- Больше не падает из-за AV / permission блокировок на rcedit.

### Если хотите вернуть метаданные exe
Уберите `"signAndEditExecutable": false` и добавьте папку проекта в исключения Defender:
```powershell
Add-MpPreference -ExclusionPath "F:\Desktop\Projects\netmap"
```

---

## v0.35.0 — PortHoverCard fix + SSID/DVR/HostSpec + широкий toolbar

### 1. PortHoverCard теперь кликабелен
Раньше при hover на порт появлялся popover с кнопками «Focus mode» / «Показать на канвасе», но:
1. Между портом и картой был gap 12 px → курсор попадал в пустоту → hover терялся → карта закрывалась.
2. Свитч имел `title="Двойной клик — крупный вид"` → браузерный тултип возникал поверх карты и **перехватывал mouseover** → карта скрывалась.

**Fix:**
- Убран browser-tooltip с корневого div свитча (title=""). Такой тултип всё равно закрывал popover — двойной клик пользователь уже знает.
- PortHoverCard: gap → 0, добавлен **невидимый hover-bridge** (14 px) между портом и картой на случай sub-pixel щели.
- Hover теперь с **220ms задержкой на mouseleave** + карта сама держит hover=true пока курсор внутри неё (передаются `onCardEnter`/`onCardLeave` из PortSlot).

Кнопки Focus mode / Показать на канвасе теперь доступны для клика.

### 2. AP: SSIDs на компактной карточке
`Device.ssids?: Array<{ name, band?, hidden?, guest? }>`.

Отображаются под IP как маленькие чипы:
- Обычные SSID — синие пилюли `#DBEAFE`
- Гостевые (`guest: true`) — янтарные `#FEF3C7`
- Скрытые (`hidden: true`) — с dashed border

Показывается до 4 SSID, остальное — `+N`. Seed'ы Усадьбы обновлены — AP_Restoran/4FL/2FL/Vhod/Zal получили `Usadba-Guest`, `Usadba-Staff`, `Usadba-Conf`.

### 3. Регистраторы (Reg_CCTV_*) — DVR блок
`Device.dvr?: { channels, activeChannels?, disks[], resolution?, retentionDays?, software? }`.

**Compact-view:** маленький бирюзовый чип «📹 16ch · 2×4TB».

**Rack-view сервера:** отдельная бирюзовая панель с:
- Кол-во каналов + сколько активных
- Разрешение (1080p/4K)
- Список дисков (модель + объём в TB)
- Итого объёма
- Retention в днях

Seed: Reg_CCTV_U1 (16 канал., TRASSIR, 2×4TB) и Reg_CCTV_KONY (8 канал., Xeoma, 1×2TB).

### 4. Серверы — hostSpec + OS-бейдж в углу
`Device.hostSpec?: { cpu, ramGb, os, osVersion?, disks[], software[], formFactor? }`.

**Rack-view сервера:**
- В верхнем правом углу — цветной бейдж ОС: WIN (синий), PROXMOX (красный), ESXi (синий), UBUNTU (оранжевый), DEBIAN (розовый), RHEL (красный), LINUX (🐧 жёлтый), TRASSIR/XEOMA/CCTV/ROS.
- Отдельный блок Hardware: `CPU`, `RAM`, `OS`, `DISK` (список с типом HDD/SSD/NVMe и объёмом), `SW` (до 6 чипов с ПО).

**Также фикс compact-view сервера:** карточка получила белый фон, светлую тень и читаемые чипы IP — раньше была прозрачная и терялась на пастельном фоне группы (Reg_CCTV_KONY).

Seed: SRV_HYPERV_U (Xeon E-2288G / 64GB / Win Server 2019 / 3 диска / Hyper-V + Bitwarden + AD + File Server + Veeam), SRV_UTM_U (i5-9500 / 16GB / Ubuntu 22.04 / nginx + PostgreSQL + PayTor UTM).

### 5. Toolbar на всю ширину
Убран `maxWidth: 640` с поиска в Toolbar — теперь занимает всю доступную ширину между HealthWidget и правой кнопочной группой. На широких мониторах поиск больше не сжатый, а тянется до конца.

---

## v0.34.3 — Дубликаты портов + автораскладка при массовом разворачивании

### Баг 1 — при hover на порт светятся два порта
**Первопричина:** `addPort()` использовал `n = d.ports.length + 1` для нового id. Если пользователь ранее удалил порт из середины списка (eth3 remove → массив [eth1, eth2, eth4, eth5], длина 4), новый порт получал id `eth5` — **дубликат**. Впоследствии `traceCable` возвращает `sw:eth5` в portKeys, а два PortSlot с одним `port.id` оба матчатся `traceKeys.has(myKey)` — glow на обоих.

**Fix:**
- `addPort()` теперь ищет **первый свободный** `ethN` (`while (usedIds.has(ethN)) n++`) — гарантированно уникальный id.
- `normalize()` (вызывается при загрузке из SQLite/localStorage/импорте) дедуплицирует ports по id — старые «поломанные» документы вычищаются на лету.
- `SwitchNode` тоже дедуплицирует ports в rack-view render'е — на случай если что-то умудрится обойти normalize.

### Баг 2 — «Развернуть все» → свитчи налезают друг на друга
**Первопричина:** `setAllRackDisplay('rack')` меняла display, но `reflowGroupChildren` только раздвигал соседей симметрично — если в группе 4-5 rack-свитчей (420 px каждый) + endpoint'ы, они не помещались в старые bounds и наваливались.

**Fix:**
- `autoLayout()` расширен опцией `{ preserveDisplay?: boolean }`. По умолчанию (для FAB «Разложить») — сохраняет прежнее поведение (rack сворачивается перед layout'ом). С `preserveDisplay: true` — рассчитывает layout с учётом текущих sizes.
- LayoutFAB «Развернуть все» теперь делает **два шага**: `setAllRackDisplay('rack')` → через 30 ms `autoLayout('TB', { preserveDisplay: true })`. Dagre + star-layout корректно перераспределяют все карточки в группах с учётом больших rack-размеров, группы растут до нужного размера.
- «Свернуть все» — `setAllRackDisplay('compact')` + `autoLayout('TB')` (обычный, свернёт всё до compact и красиво уложит).

### Итог
- Hover на порт подсвечивает ровно один порт (или несколько, только если trace реально идёт через патч-панель — это фича).
- Bulk-expand не оставляет свитчи в куче — сцена перекомпоновывается под новые размеры.
- Bulk-collapse после массового expand возвращает всё в компактный вид с чистым layout'ом.

---

## v0.34.2 — Реальный fix React #185 при multi-select clear

### Что было не так в v0.34.1
Первая попытка (убрать subscribe listener storm в edgeRouter/portSides) устранила один потенциальный источник, но НЕ основной. Настоящая причина — **двусторонняя синхронизация selection** между React Flow и zustand.

### Настоящая причина цикла
`displayedNodes` пересчитывался каждый рендер и **переопределял `n.selected`** для КАЖДОЙ ноды на основе `multiSelectedIds` из zustand:
```ts
return { ...n, selected: isMulti ? true : n.id === selectedId, style: {...} };
```

При multi-select через box-selection React Flow пишет `selected:true` в свой internal state. Наш `displayedNodes` **берёт этот internal state и снова переопределяет** через `isMulti`. Пока пользователь не нажимает крестик — всё сходится: `isMulti=true` совпадает с internal `selected=true`.

Но при клике на ✕ в MultiSelectBar:
1. `setMultiSelection([])` очищает zustand → `isMulti=false` для всех.
2. `displayedNodes` пересчитывается с `selected:false` → передаётся в React Flow.
3. React Flow видит `selected:false` в пропсах, но в internal state ещё `selected:true` для 20 нод.
4. React Flow вызывает internal `setNodes` для sync + триггерит `onNodesChange` со `select:false` изменениями.
5. Наш `handleNodesChange` → `onNodesChange(changes)` → React Flow снова sync internal → снова триггерит onNodesChange…
6. Плюс `displayedNodes` каждый рендер создаёт **новые ссылки на style** — React Flow при получении новых nodes с новыми style-ссылками делает setNodes для diff propagation → петля усиливается.

Максимум update depth exceeded → **React error #185**.

### Fix v0.34.2

1. **Убрал multi-select override в `displayedNodes`**. Multi-selection живёт **только в internal state React Flow**. Zustand `multiSelectedIds` теперь read-only проекция для UI-панелек (`MultiSelectBar`, edge dimming, hover logic). Никакой обратной записи в `n.selected` для multi-случая.

2. **Оставил single-select override** для `selectedId`/`selectedGroupId` — эти selection'ы программные (клик по карточке в sidebar, port matrix, search result), нужно уметь их программно устанавливать через React Flow.

3. **Style + selected применяются только если реально нужно**. Если для конкретной ноды `!needsStyle && !needsSelected` → возвращаем **ту же ссылку** `n`. React Flow's shallow diff не видит изменений → нет churn.

4. **MultiSelectBar.✕ и bulkDelete** теперь бросают `netmap:clear-rf-selection` event → Canvas ловит и **одним setNodes** снимает `selected:false` со всех выбранных нод. Без ping-pong'а.

### Что стало
- Multi-select через box → React Flow сам ставит `selected:true` в internal state.
- Наш `displayedNodes` игнорирует это (не переопределяет).
- Крестик → clear zustand + clear React Flow одним махом → чистый reset.
- Никаких setNodes петель.

---

## v0.34.1 — Hotfix React #185 (белый экран после multi-select) — частичный

### Симптомы
После разложения схемы + случайного multi-select + клика по крестику в MultiSelectBar → белый экран, консоль:
```
Uncaught Error: Minified React error #185 (Maximum update depth exceeded)
  at setNodes (reactflow...)
```

### Причина
В v0.34 я подписывал **каждый** `PortEdge`, `SwitchNode`, `DeviceNode` на singleton-кеши `edgeRouter` и `portSides` через `edgeRouter.subscribe(forceRerender)`. Проблема:
- На Усадьбе это ~130 подписчиков (60+ карточек + 60+ edges).
- Bulk-операция (multi-select delete, selection change) → серия setState в zustand → `doc.devices` обновляется 40+ раз в одну tick.
- Каждый обновление пробуждает **все 130 listener'ов**.
- Listeners вызывают `forceRerender` → компоненты re-mount эффекты → `edgeRouter.register/unregister` → `scheduleRebuild` → rebuild → notify → снова 130 listener'ов…
- React 18 concurrent scheduler это не переварил → error #185.

### Fix
1. **Убрал subscribe API** из `edgeRouter` и `portSides`. Вместо него — единый **version-tick, синхронизируемый с zustand-slice**:
   - `store.portSidesVersion: number` + `bumpPortSidesVersion(v)`
   - `store.edgeRouterVersion: number` + `bumpEdgeRouterVersion(v)`
   - Canvas вызывает `edgeRouter.setVersionSink(...)` при монтировании — роутер сам пушит `bumpEdgeRouterVersion(v)` после rebuild.
   - После `portSides.recompute()` Canvas вызывает `bumpPortSidesVersion(portSides.getVersion())`.
2. Компоненты (`PortEdge`, `SwitchNode.CompactSwitchView`, `DeviceNode.CompactHandles`) читают версию через нормальный `useStore(s => s.portSidesVersion)`. Zustand дедуплицирует апдейты через Object.is → рендер только при реальном изменении версии.
3. `edgeRouter.scheduleRebuild()`: **re-entrancy guard** + debounce поднят с 80 → 120 ms.
4. `PortEdge.useEffect` для register теперь без cleanup unregister (это плодило register→unregister→register storm при каждом изменении координат). Cleanup unregister вынесен в отдельный effect с deps `[id]` — вызывается **только** при demount.

### Что осталось разбираться
Второй симптом («попропадали оконечные устройства после «Разложить»») — вероятно `extent: 'parent'` React Flow клампит детей за bounds group, если autoLayout не увеличил group.height достаточно. Нужен повторный тест с этой сборкой; если баг остался, пришлите новый скрин.

---

## v0.34.0 — Динамическая сторона портов

### Проблема
Порты у compact-свитчей и endpoint-устройств выходили со **статически** назначенных сторон (uplink → Top, остальные по кругу Bottom/Right/Bottom/Left). Если реальный peer оказывался в другой стороне (например SW_CORE слева, а порт назначен на Right), кабель делал петлю вокруг карточки и пересекал соседей. На скрине хорошо видно как кабель от SW_CORE к POS_kassa (POS сверху-слева от свитча) выходил снизу свитча и потом шёл вверх-влево через саму карточку POS.

### Fix — новый модуль `src/portSides.ts`
Кеш вида `Map<'deviceId:portId', Position>` + `Map<'deviceId:portId', offsetPct>`, пересчитываемый каждый раз при изменении `doc.devices/groups/links`:

1. Для каждого link:
   - Считаем вектор `src-center → tgt-center` (в абсолютных flow-координатах, с учётом групп).
   - Dominant-axis pick: `|dx| >= |dy|` → стороны Left/Right; иначе Top/Bottom. Знак → куда именно.
   - Src-порт «смотрит» в сторону вектора; tgt-порт — в противоположную.
2. Порты с несколькими линками — **majority-vote** по сторонам.
3. Порты без линков — не попадают в кеш, консюмер использует старый static-fallback.
4. **Offset вдоль стороны**: все порты на одной стороне карточки сортируются по `port.id` и равномерно распределяются вдоль ребра.

### Интеграция
- `SwitchNode.tsx` `CompactSwitchView` — читает `portSides.getSide(dev.id, port.id)`, fallback на прежнюю статическую ротацию.
- `DeviceNode.tsx` `CompactHandles` — то же самое (endpoint'ы: AP, POS, PC, camera, printer, lock, VM/VPS).
- Оба компонента подписаны на `portSides.subscribe(...)` → пересчёт при перемещении соседей.
- `Canvas.tsx` вызывает `portSides.recompute(...)` в `useEffect` от `doc.devices/groups/links`.

### DYNAMIC_KINDS
```
switch, router, ap, camera, pc, pos, printer, lock, vm, vps
```

**Rack-view свитчей, patch-panel и server остаются со статическими портами на передней панели** — это соответствует реальному железу и не должно перестраиваться.

### Работа с уже нарисованными кабелями
После смены сторон handle-ов React Flow автоматически перерасчёт `sourceX/Y/targetX/Y` → PortEdge регистрирует новую геометрию в `edgeRouter` (v0.33) → роутер строит новую orthogonal-траекторию через <80 ms. Всё это происходит без вмешательства пользователя.

### Итог
Теперь кабель от SW_CORE к POS_kassa выйдет сверху свитча, кабель к AP_4FL — справа, кабель к SALTO_Door — снизу. Никаких петель через собственную карточку, никаких пересечений соседей поверх портов.

---

## v0.33.0 — Node-avoiding routing кабелей

### Проблема
На развёрнутых схемах кабели рисовались как smoothstep / bezier — кратчайший ортогональный путь между двумя портами. Если между src и tgt стоит какая-то карточка (POS, AP, камера), кабель проходил **сквозь неё** — закрывал имя, порты и заставлял глаз перепрыгивать. Плюс несколько кабелей часто шли по одному коридору, накладываясь друг на друга.

### Fix — свой greedy Manhattan router
Новый модуль `src/edgeRouter.ts` (~330 строк):

1. **Obstacle map:** все устройства → bounding-rect в абсолютных flow-координатах (с учётом группы-родителя и `PERSONAL_SPACE`-инфляции 10 px). Публикуется в роутер через `edgeRouter.setObstacles(...)` из Canvas.
2. **Регистрация геометрии edges:** каждый `PortEdge` в `useEffect` пушит свои `sourceX/Y/targetX/Y + sourcePosition/targetPosition` в роутер. Если ничего не изменилось — no-op.
3. **Debounced rebuild** (80 ms): для каждого кабеля генерятся кандидаты-полилинии:
   - stub наружу от порта на 22 px (кабель не разворачивается назад через свою же карточку)
   - L-shape HV / VH
   - Z-shape с несколькими промежуточными X/Y (mid, ±60, ±120)
   - **Детур вокруг блокирующего препятствия** — по 4 сторонам (сверху, снизу, слева, справа, с зазором 24 px)
4. **Scoring** — крест obstacle × 5000, длина × 0.05, изгибы × 40, коллинеарный overlap с уже-проложенными путями × 25 → **параллельные кабели сами разъезжаются по разным дорожкам** (v0.23 bundle-offset больше не нужен, но пока оставлен для fallback).
5. Выбранная полилиния упрощается (снятие коллинеарных вершин) и конвертируется в SVG `d` с округлыми углами радиуса 10.

`PortEdge.tsx` подписывается на роутер (`edgeRouter.subscribe`) и **предпочитает routed path**; если ещё не пересчитан (первый рендер, drag в процессе) — использует прежний smoothstep/bezier как fallback.

### Что это даёт
- Кабели больше не пересекают карточки — обходят их сверху/снизу/сбоку.
- Параллельные линии от одного свитча к разным устройствам разъезжаются по разным дорожкам, а не сливаются в одну.
- Работает **глобально** — во всех проектах workspace (Усадьба / Дона / Чайковский / любой импортированный).
- Пересчёт debounced 80 ms → незаметен по производительности даже на ~70 кабелях.
- Во время drag — fallback smoothstep, после drop — реальный роут.

### Известные ограничения
- Greedy алгоритм, не полный A*. В сложных ситуациях (плотная сетка карточек, кабель должен обойти 3+ препятствий) может остаться 1 пересечение. Полный A* — v0.34 если понадобится.
- Cost'ы подобраны эмпирически. Если результат где-то не радует — крутим `OBSTACLE_CROSS_COST` / `OVERLAP_COST` / `BEND_COST` в `edgeRouter.ts`.

---

## v0.32.0 — Reflow групп при разворачивании свитчей

### Проблема
После «Развернуть все» (или ручного ◱ на любой карточке) rack-view свитч раздувается с ~200×110 до ~420×130 пикселей. Соседние карточки в той же группе оказываются **под** новой карточкой — визуально наваливаются друг на друга. Плюс сам свитч часто вылезает за правую границу группы, потому что `growGroupToFitChildren` дёргался только на drop, а не после resize.

### Fix
Новая функция `reflowGroupChildren(groupId)` в `src/collide.ts`:
- Собирает все устройства группы, используя **kind-based размеры** (`readSizeForKind`), а не DOM-измерения — потому что в момент коммита `display` React ещё не отрендерил новую карточку.
- Итеративно (до 40 проходов) разгребает попарные оверлапы: каждой перекрывающейся паре добавляется `(overlap + GAP) / 2` симметрично в обе стороны по оси меньшей penetration'ы.
- Клампит всё под header группы (`y ≥ HEADER_H + 8`) и с левым отступом (`x ≥ PAD_X`) — правый/нижний край не жмёт, вместо этого группа **растёт** через `growGroupToFitChildren`.

Хук `reflowGroupsForDevices([ids])` идентифицирует затронутые группы и планирует reflow на double-rAF после commit'а — чтобы React успел смонтировать новую карточку.

Внедрено в **двух местах** store'а:
1. `updateDevice(id, { display: 'rack' })` — одиночный ◱ клик (SwitchNode / PatchPanelNode / ServerNode / DeviceNode / DevicePanel).
2. `setAllRackDisplay(mode)` — bulk «Развернуть/Свернуть все» из LayoutFAB.

Также поправлены неточные размеры в `readSizeForKind`:
- switch rack теперь `420×130` (было `420×110` — не влезал по высоте)
- patchpanel rack `440×90` (раньше не было различия — считали как compact 260×90 и он выпирал)
- server rack `260×140` (раньше одинаково 200×100)

### Итог
При любом расширении карточки — одиночном или массовом — соседи по группе аккуратно расталкиваются, а сама группа подрастает до нужного размера. Ничего не наваливается и не вылезает за границу.

---

## v0.31.0 — Fix inter-group cables в compact + «Развернуть/Свернуть все»

### 1. Fix пропадающих inter-group связей в compact-mode
Пользователь показал два скрина: в **compact-view** свитчей связи между группами не рисуются, в **rack-view** — рисуются красиво. Багу v0.28+.

**Root cause в `Canvas.tsx`:**
```ts
const srcExposesPorts = srcVisible && srcDev &&
  ((srcDev.kind === 'switch' || srcDev.kind === 'router') ? srcDev.display === 'rack' : true);
```
Если switch/router в compact — `srcExposesPorts = false` → `sourceHandle = undefined` → React Flow пытается найти fallback handle с id `null`, не находит → **edge не рисуется** (или fallback'ит куда попало).

Но в v0.27 я уже сделал compact-view свитча с **per-port handles** (id = port.id, распределены по 4 сторонам) — просто Canvas об этом не знал.

**Fix:** упростил до `srcExposesPorts = srcVisible && srcDev` — всегда true если устройство видно. React Flow теперь корректно находит handle с id 'sfp1' / 'eth3' / т.д. в compact-mode свитча.

Теперь inter-group backbone-cables работают одинаково в обоих режимах.

### 2. «Развернуть/Свернуть все» в FAB
В плавающей кнопке разкладки на канвасе новая секция **«Отображение свитчей»**:
- **Развернуть все** — все свитчи, роутеры, patch, серверы → rack-view
- **Свернуть все** — все → compact

Затрагивает всё что раньше требовало клика ◱ на каждой карточке. Отменяется через Ctrl+Z (запись в history).

Новый store action `setAllRackDisplay(mode)`.

### 3. Про новые файлы схемы
Пользователь спросил: «работает ли всё это с новыми схемами?»

**Да.** Все фичи (autoLayout, auto-heal провайдеров, star-layout, cable-trace, port-hover, collision, drop-in/out групп) работают на любом проекте в workspace:
- **Новый пустой проект** (File → Новая схема) — работают, начинаешь с чистого холста, draggable devices из левой панели
- **Импорт JSON** (File → Импортировать) — прогоняется через `normalize()`, auto-heal сработает если нужно
- **Готовые сиды** (Усадьба / Дона / Чайковский) — уже структурированы правильно
- **MikroTik-импорт** — новые устройства добавляются в отдельную группу, autoLayout вызывается автоматически

Сохранение — SQLite в Electron (собранная .exe) или localStorage в браузерном preview. Обе работают.

---

## v0.30.0 — Свитчи по умолчанию compact, автолейаут схлопывает rack

Пользователь сбросил Усадьбу и увидел гигантские rack-view свитчи, налезающие друг на друга — из-за того что в seed'ах у 28 свитчей стоит `display: 'rack'`, а rack-корпус занимает 400+ px и не помещается в группу.

### 1. Все seeds → compact
Массово поменял `display: 'rack'` → `display: 'compact'` во всех трёх сидах:
- Усадьба: 12 свитчей
- Дона: 9
- Чайковский: 7

Compact-карточка свитча компактная (~200×110) со всеми handles на 4-х сторонах — легко читается, кабели правильно выходят. Развернуть в rack можно в любой момент кнопкой ◱ в углу карточки.

### 2. Autolayout автоматически схлопывает rack
`autoLayout()` теперь **временно переводит все rack-view свитчи/роутеры/patch/server в compact** перед раскладкой, потом уже раскладывает. Логика:
- Если пользователь развернул несколько свитчей в rack, а потом жмёт «Разложить» — все схлопываются в compact
- Экономит место, всё помещается в группы
- Пользователь может снова развернуть нужный свитч после раскладки

### 3. Точнее nodeSize для compact
- switch compact: 220×130 → **200×110**
- router compact: 260×130 → **240×120**

Совпадает с реальными размерами карточек.

---

## v0.29.0 — Провайдеры в группе, компактная top-level иерархия, reset+auto-layout

### 1. Провайдеры больше не висят вне группы
На скрине пользователя isp-rt / isp-bl / isp-et висели сверху как отдельные карточки, а группа «Интернет · Провайдеры» отсутствовала. Причина — они были сохранены в старом workspace **до v0.23** (когда группа z-internet была добавлена в seed).

**Fix — auto-heal в `normalize()`:** при загрузке любого doc'а если находим ≥2 orphan cloud-устройств и нет z-internet группы → создаём группу «Интернет · Провайдеры» автоматически, размещаем cloud'ы внутри. Работает и для новых, и для старых сохранённых workspaces.

### 2. Компактнее top-level иерархия групп
Раньше 8 групп на канвасе Усадьбы растягивались в ряд 4000+px. Причина: `nodesep * 2 = 120`, `ranksep * 2 = 240` — слишком воздушно.

**Fix:**
- `nodesep = nodeSep + 20 = 80px` (было 120)
- `ranksep = rankSep = 120px` (было 240)
- Ranker `'tight-tree'` — компактнее располагает cluster'ы, лучше уплотняет дерево

Теперь Провайдеры сверху → Серверная → Ресторан/Кухня/КонференцЗал в одном ряду → корпуса ниже. Стройная 3-4 tier иерархия.

### 3. Reset к Усадьбе теперь тоже раскладывает
`resetToSeed()`:
- Прогоняет seed через `normalize()` (auto-heal сработает если нужно)
- **Сбрасывает флаг `layoutDone`** для активного проекта → welcome-баннер снова покажется
- **Через 50ms автоматически вызывает `autoLayout('TB')`** → пользователь сразу видит красивую схему без клика

---

## v0.28.0 — Крупные порты + рабочий star-layout + без 📦

Пользователь показал: после «Разложить» устройства всё равно в одну линию, коробки в названиях групп, тяжело попасть по портам.

### 1. Star-layout теперь реально работает
**Root cause:** v0.27 использовал `inferLayer(d) === 'access'` для определения leaf. Но в маленькой сети обычный switch тоже классифицируется как `access` (нет SFP+/10G). Значит **и leaves, и anchor попадали в один "access" band** — раскладка сваливалась в горизонтальный ряд.

**Fix:** новая структурная логика вместо layer-based:
- **Anchor** = устройство с 2+ intra-subgraph links ИЛИ kind ∈ {switch, router, patchpanel, server}
- **Leaf** = всё остальное (AP, camera, PC, printer, lock, POS)
- Anchors всегда на **верхней band**, leaves в вертикальных **колонках под своим anchor'ом**
- Wrap в несколько под-колонок при > 4 leaves
- `ENDPOINT_ROW_H` увеличен `100 → 130px`, `ENDPOINT_COL_W` `170 → 200px` (под новые крупные карточки)

Теперь Ресепшн с 7 endpoints раскладывается как в референсе — SW_RCP сверху, PC/AP/Printer/SALTO/etc в колонке снизу.

### 2. Крупнее порты в свитчах
- `PORT_W` 16 → **22**, `PORT_H` 14 → **20** (~40% крупнее)
- `PORT_GAP` 2 → **3**
- Hover-buffer: порт **увеличивается на scale(1.35)** при наведении курсора, обводится **оранжевой рамкой 2px** + свечением, z-index поднимается на передний план
- Плавный transition 120ms
- Прицельные попадания курсором стали в несколько раз проще

### 3. Точнее размеры устройств в autoLayout
Обновлены оценки `nodeSize` для всех kind'ов чтобы соответствовать v0.22+ визуалам:
- Router (rack1u): 210→**260**
- Switch rack: динамика по 28px на порт вместо 25
- Cloud: **220×110**
- Round-cards (ap/camera/etc): **160×130**
- Box-cards (pc/vm): **190×70**
- Server rack: 300→**320**

Больше нет underestimation → нет ложного налезания в автолейауте.

### 4. Убраны эмодзи 📦 из групп
- `GroupNode` header: эмодзи `📦` перед именем — убрано
- `GroupPanel`: заменено на inline SVG (иконка "box")
- `ContextMenuHost`: label группы без эмодзи
- `Palette`: SVG вместо эмодзи

### Что попробовать
1. **Reset к Усадьбе** → «Разложить»
2. Смотри на Ресепшн — endpoints должны стать вертикальной колонкой под SW_RCP, не в ряд
3. Наведи на любой порт в rack-view свитча — он **увеличивается**, обводится оранжевым, легко попасть

---

## v0.27.0 — Star-layout endpoints + кабели поверх свитчей

Пользователь показал два скрина: первый — все endpoints свалены в одну линию (мой автолейаут), второй — красиво в столбцах под свитчами. Плюс жалоба: кабели идут за задним планом свитча.

### 1. Star-layout endpoints внутри группы
Раньше `layoutFlat` расставлял все access-layer устройства **в один горизонтальный ряд** — при 7+ endpoints это выходило за ширину группы, все налезали друг на друга.

Теперь:
- Для каждого endpoint определяется его **upstream switch** (по links)
- Endpoints **стакаются в вертикальную колонку под своим свитчем**
- Когда endpoints > 4 → wrap в несколько под-колонок (`MAX_PER_COLUMN = 4`)
- Column-bundle **центрируется** горизонтально под свитчем
- Orphans (endpoint без явного uplink) — отдельная колонка справа
- Sizing: `ENDPOINT_ROW_H = 100`, `ENDPOINT_COL_W = 170`

Работает только в `TB` direction (сверху-вниз) — типичный кейс. `LR` fallback'ит на старую band-логику.

### 2. Кабели гарантированно поверх свитчей
- Z-index `.react-flow__edges` увеличен `1000 → 2000` — точно поверх любых nodes
- Добавлен `.react-flow__edge-path { z-index: 2000 }`, `.react-flow__edges { pointer-events: none }` — SVG не блокирует hover нод, но всегда сверху

### 3. Compact-view свитча: handles во ВСЕХ 4-х сторонах
Раньше 48 портов compact-режима имели handle **только справа** (`Position.Right`). При 7 endpoints ниже свитча → 7 кабелей выходили справа и все шли через середину других устройств. Некрасиво.

Теперь распределение:
- Uplink port → **Top** (магистраль наверх)
- Порт index % 4 == 0, 2 → **Bottom** (типичные downlinks в звезде)
- Порт index % 4 == 1 → **Right**
- Порт index % 4 == 3 → **Left**

Кабели теперь выходят с той стороны, ближе к которой их target. Плюс добавлены **fallback handles на все 4 стороны** (`_top / _bottom / _left / _right`) для линков без port id.

### Что попробовать
1. Открыть Усадьбу → «Разложить»
2. Группа «Ресепшн» — раньше 7 устройств в одну линию, теперь endpoints (PC-2, up_security, AP, Printer, SALTO) должны стать **колонкой под SW_RCP**
3. Наведи на порт SW_RCP — cable-trace теперь **поверх** свитча, видно куда идёт

---

## v0.26.0 — Port-hover cable trace (главная фича для сисадмина)

Ответ на «куда идёт кабель из этого порта?» — за один hover.

### Что делает
Наводишь курсор на **любой порт свитча/роутера** в rack-view:
- Порт сам обводится **оранжевым 2px** + получает `box-shadow` glow
- **Весь кабель по пути становится ярко-оранжевым** (`#F59E0B`), утолщается +2.5px, светится
- Если кабель проходит **через патч-панель** — трейс продолжается через неё до конечного устройства. Порты patch-панели, участвующие в трейсе, тоже подсвечиваются
- Все **не-трейсовые кабели** приглушаются до 12% opacity
- Появляется всплывающая карточка (**PortHoverCard**) с:
  - Метадата порта (тип, скорость, VLAN, uplink, PoE)
  - Список хопов пути: иконка + имя устройства + порт + IP
  - Хопы через патч-панель помечены **жёлтой плашкой `PATCH`**
  - Кнопки **«Focus mode»** (крупный вид) и **«Показать на канвасе»** (плавный zoom+pan)
  - Клик по любому хопу — центрирует на нём

### Реализация

**`src/traceCable.ts` (новый)** — алгоритм трассировки:
- Идёт по кабелю (`findLinkOnPort`) от исходного порта
- На патч-панели: **пара портов по конвенции** (port1↔port2, port3↔port4, …) — signal идёт через PP насквозь
- Ограничения: max 12 хопов, детект циклов через `visited`
- Возвращает `{ hops, linkIds, portKeys, aborted? }`

**`src/store.ts`** — новые поля:
- `hoveredPortKey: string | null` — текущий порт под курсором
- `hoveredTracePortKeys: Set<string>` — все ports в трейсе (derived, обновляется в `setHoveredPort`)
- `hoveredTraceLinkIds: Set<string>` — все links в трейсе
- `setHoveredPort(devId, portId)` — вычисляет trace один раз, кеширует result

**`src/PortEdge.tsx`** — новая ветка `isOnTrace`:
- `stroke: '#F59E0B'`, `strokeWidth +2.5`, `drop-shadow(0 0 8px #F59E0B)`
- Всё не-на-трейсе становится 12% opacity (сильнее чем focus-related)

**`src/SwitchNode.tsx`**:
- `PortSlot` подписан на `hoveredTracePortKeys`, светится оранжевым если `onTrace`
- Старый простой tooltip **заменён на `PortHoverCard`** с полной трейс-информацией
- `TraceHopRow` — компактная строка хопа с иконкой, именем, портом, IP; клик = center canvas
- `traceLinkIds` из store прокинут в PortEdge автоматически

**`src/DeviceNode.tsx`** — `PortDot` (rack-mode обычного DeviceNode) — та же логика подсветки.

### Что попробовать
1. Открыть Усадьбу → разложить
2. Развернуть свитч `SW_OPT` (двойной клик → rack view)
3. Навести на `eth2` (тот что к `SW_RCP` через патч-панель) — увидишь **весь путь оранжевым** с подсветкой промежуточных хопов
4. Наведи на любой другой порт — путь мгновенно перерисовывается
5. Всплывающая карточка показывает список хопов, клик по любому — центрирует канвас

Скорость: `traceCable` работает O(hops × links) — на схемах до 300 линков практически мгновенно (<1ms).

---

## v0.25.0 — Читаемые стикеры, grab-animation, drop-in/out групп, auto-grow групп

### 1. Стикеры теперь читаются
Жёлтый и зелёный sticky-note имели `bg` и `text` одного оттенка — нечитаемо. Исправлена вся палитра:
- yellow: bg `#FEF3C7` + text `#78350F` (контраст 8.6:1)
- pink: bg `#FBCFE8` + text `#831843`
- blue: bg `#BFDBFE` + text `#1E3A8A`
- green: bg `#D1FAE5` + text `#064E3B` (контраст 10.4:1)

### 2. Grab-animation при удержании
Захваченная карточка увеличивается `scale(1.05)` + получает `drop-shadow(0 12px 24px)`. Плавный переход `160ms` со spring-эффектом. При отпускании возвращается.

### 3. Drop-in / drop-out групп + переход между группами
**Фикс бага v0.19+:** `handleNodesChange` коммитил позиции только для `type === 'device'` — свитчи/patch/server игнорировались, координаты в store оставались устаревшими → re-parenting не работал. Теперь все non-group типы коммитят позицию. Работает: тащишь наружу — устройство отсоединяется, тащишь в группу — присоединяется, тащишь из группы A в B — перемещение через parent.

### 4. Highlight target group при drag
Во время удержания карточки над группой её граница обводится синим 3px (`.netmap-drop-target { outline: 3px solid #2563EB }`). Класс добавляется/удаляется через DOM (без React re-render — не мешает плавности drag'а).

### 5. Auto-grow групп
Новая функция `growGroupToFitChildren(groupId)` в `collide.ts`. После drop / collision-resolve проверяет крайние координаты детей — если ребёнок выходит за правый/нижний край, группа плавно расширяется через `updateGroup({width, height})`. Минимум 220×140, никогда не сжимается автоматически (не борется с ручным ресайзом).

---

## v0.24.0 — Плавное drag&drop + невидимая personal-space вокруг устройств

Пользователь описал точную проблему: **«держишь устройство, соседи расталкиваются, но само выбранное устройство дёргается от места к месту»**. Это было следствием того что resolveCollisions вызывался в `onNodeDrag` (каждый пиксель движения) → перерисовка nodes → React Flow пересчитывал координаты dragged → jitter.

### Ключевые изменения

**1. Убрано расталкивание во время drag**
- `onNodeDrag` теперь **пустой** — во время удержания карточки соседи стоят на месте, движение плавное.
- `onNodeDragStop` (отпустил кнопку) — вот тогда соседи расталкиваются одним движением с CSS-transition.
- Никаких промежуточных `setPosition` → никакого jitter dragged-ноды.

**2. Personal space — невидимая граница 12px**
- В `collide.ts` при расчёте overlap теперь **dragged rect виртуально расширяется на 12px** во все стороны (`PERSONAL_SPACE`).
- Означает: даже если бросишь карту вплотную к соседу — коллизия отодвинет соседа так, чтобы между картами всегда оставался зазор.
- Плюс `GAP = 16` (был 12) — после расталкивания зазор ещё больше, `OVERLAP_THRESHOLD = 2` (было 4) — более чувствительный детект.

**3. Более выразительная анимация**
- CSS transition: `180ms → 260ms`, easing `cubic-bezier(.34,1.56,.64,1) → cubic-bezier(.22,.61,.36,1)` (плавнее, менее bounce)
- Dragged-нода получает `drop-shadow(0 8px 20px rgba(15,23,42,0.18))` и `z-index: 500` — визуально «поднимается» когда захвачена

### Результат
- Захватываешь карту — она следует за курсором **точно и плавно**, никаких скачков
- Отпускаешь — если поверх соседей, они плавно **выезжают в стороны** с анимацией 260ms
- Между картами всегда остаётся отступ ≥12px, они никогда не касаются

---

## v0.23.0 — Параллельные кабели, группа «Интернет», авто-раскладка на импорте, focus на поиск

Пять улучшений качества жизни.

### 1. Bundle параллельных кабелей
Между парой устройств может идти несколько кабелей (например GW → SRV с двумя разными интерфейсами). Раньше они рисовались одной линией — визуально сливались. Теперь:
- В `Canvas` пре-компьютируется `bundleGroups` — Map `"a|b" → [linkId, linkId, …]`.
- Каждый link получает `bundleIndex` (0-based) и `bundleTotal`.
- В `PortEdge` перед вычислением path — sourceX/Y и targetX/Y **сдвигаются перпендикулярно** линии SRC→TGT на `(index - (total-1)/2) * 14px`.
- Пример: 3 кабеля → offsets `-14, 0, +14`; 4 кабеля → `-21, -7, +7, +21`.
- Первый (и единственный) кабель в bundle остаётся без сдвига — обычный случай не меняется.

### 2. Группа «Интернет · Провайдеры» в сидах
Раньше 3 cloud-устройства (Rostelecom / BeeLine / E-type) висели отдельными карточками сверху канваса, не связанные ни с чем визуально. Теперь:
- Добавлена **группа `z-internet`** во всех 3 seed'ах (Усадьба / Дона / Чайковский).
- Цвет `#94A3B8` (нейтральный slate), компактная высота 120px.
- Все ISP-устройства помещены в неё через `groupId: 'z-internet'`.
- Название группы: **«Интернет · Провайдеры»** — сразу читается назначение блока.

### 3. Auto-layout при MikroTik import
После успешного импорта новых устройств из MikroTik (когда `placed > 0`) — через `setTimeout(100ms)` вызывается `store.autoLayout('TB')`. Новая группа `DHCP · <router>` встраивается в общую иерархию, не перекрывая существующие устройства. В alert-диалог добавляется строка «Схема автоматически разложена».

### 4. Focus на устройство из глобального поиска
Раньше клик по результату поиска только выделял устройство в правой панели — надо было ещё глазами искать где оно на канвасе. Теперь:
- Toolbar dispatch'ит `netmap:focus-device` custom event
- Canvas ловит и вызывает `rf.setCenter(absX, absY, { zoom: 1.2, duration: 500 })` — плавно панит и зумит на устройство.
- Устройство появляется по центру viewport'а через полсекунды.

### 5. Мелкие фиксы
- Проверил handles во всех node-типах после v0.21 — кабели корректно приходят в порты
- Vite build прошёл чисто, TSC — без ошибок

---

## v0.22.0 — Порты во всю ширину + свитчи серые + роутеры чёрные + collision без фантомов + анимация расталкивания

Пять фидбэк-фиксов подряд.

### 1. Порты растянуты во всю ширину свитча
Раньше блок портов был прижат к левой стороне (`display: flex; align-items: flex-start`). Теперь:
- `display: flex; justify-content: space-between; width: 100%`
- Copper-порты занимают левый flex-1, центрированы
- SFP-блок пришпилен справа, отделён вертикальной чертой
- padding увеличен `8px 12px → 10px 14px`

### 2. Свитчи серые (как реальный Cisco/UniFi)
`SwitchNode` палитра переделана:
- `CHASSIS_BG`: тёмно-серый → **светло-серый градиент `#F1F3F5 → #B8BEC5`** (как алюминиевый корпус реального 1U-свитча)
- Header остался тёмным (dark strip сверху для контраста бренда/имени) — как на референсе UniFi Pro
- Border `#374151 → #A0A6AE`
- Text `#E5E7EB → #1F2937`
- Port slots `#0F172A` — тёмные квадратики на светлом chassis дают правильный контраст

### 3. Роутеры и файерволы чёрные (полный редизайн)
В `DeviceNode.Rack1UCard` теперь ветвление:
- **Router / Firewall** → карточка **полностью тёмная** (`#1F2937 → #111827` градиент), белое имя, серый IP, чёрный faceplate. Как реальный Cisco ISR / MikroTik CCR / FortiGate.
- **Patch panel / Cloud / ISP** → остались светлыми (не должны конкурировать со свитчами визуально).

`RouterFaceplate` тоже переделан:
- Port slots `#000000` вместо `#0F172A` (глубже чёрный)
- Порты **растянуты во всю ширину faceplate** через `flex: 1; justify-content: space-evenly`
- Bezel-акцент слева стал тоньше (3px вместо 4)
- LED-индикаторы под каждым портом больше (4px вместо 3)

`FirewallFaceplate` — та же структура + вентиляционная решётка + бренд FW сбоку. Теперь тоже full-width.

### 4. Collision без фантомов + плавная анимация
**Проблема:** при перемещении устройства на **пустое место** соседи всё равно "расталкивались", создавая ощущение поломки.

**Root cause:** `estimateSize` в `collide.ts` возвращал приблизительные size'ы устройств. Расхождение с реальными DOM-размерами создавало ложные overlap-детекции.

**Fix (v0.22 rewrite `collide.ts`):**
- Новая функция `readRenderedSize(nodeId)` — читает реальный размер ноды из DOM (`.react-flow__node[data-id="..."]` + `getBoundingClientRect()`), делит на zoom viewport'а. Точность 100%.
- **Early exit**: если dragged-нода не пересекает ни одну сиблинг-ноду → resolve сразу возвращается. Никаких phantom-нажатий.
- `OVERLAP_THRESHOLD = 4px` — небольшая drift ниже 4px не считается коллизией.

**Анимация расталкивания** (CSS в `index.html`):
```css
.react-flow__node {
  transition: transform 180ms cubic-bezier(.25, .46, .45, .94);
}
.react-flow__node.dragging, .selected, :active {
  transition: none;
}
```
- При удержании устройства и наезде на соседа — сосед **плавно уплывает** в сторону, а не резко телепортируется
- Dragged-нода сама остаётся snappy (без transition), чтобы курсор точно следовал

### 5. Соединения между группами теперь заметны
- `baseWidth` для inter-group / fiber кабелей `2 → 2.6`
- Цвет `#3B82F6 → #2563EB` (более насыщенный синий)
- Добавлен **постоянный лёгкий glow** для inter-group: `drop-shadow(0 0 3px color66)` — читается как "backbone" через белый промежуток между группами

### Что попробовать
1. Открыть Усадьбу → нажать «Разложить» → **свитчи теперь светло-серые с портами во всю ширину**, роутер `GW` **чёрный** как реальный Cisco
2. Перетащить любое устройство на **пустое место в группе** — ничего не двигается вокруг
3. Перетащить прямо **поверх соседа** — тот плавно «уплывает» с transition 180ms
4. Inter-group backbone-кабели (например GW → SW_OPT → SW_U2) — читаются даже через большие расстояния между группами

---

## v0.21.0 — Критический фикс кабелей + сворачиваемая панель + рабочие кнопки

Обнаружился серьёзный визуальный баг: **начиная с v0.17 (редизайн карточек) большинство кабелей на канвасе визуально «исчезали»**. Пользователь жаловался что не видит соединений — это была не проблема seed-данных.

### Fix: cables теперь корректно приходят в порты
**Root cause.** В v0.17 переписал `DeviceNode` на три типа карточек (Rack1U / Round / Box), при этом `CompactHandles` рендерил только 8 фейковых handles с id `_top / _right / _bottom / _left`. Но в seed'ах кабели ссылаются на настоящие port id — `poe`, `lan`, `eth1`, `ctrl` и т.д. React Flow не находил handle с таким id и **тихо не отрисовывал такие кабели** (или fallback'ил в центр ноды, где они сливались с рамкой карточки).

Затронуло: **все AP, камеры, принтеры, замки, POS-терминалы, ПК** — то есть большинство endpoint-устройств. Также **compact patch-panel** и **compact server**.

**Fix.** В `CompactHandles` для `DeviceNode`, `ServerNode` и `PatchPanelNode` теперь **на каждый port создаётся собственный `<Handle id={port.id}>`**, равномерно распределённый по краю карточки. React Flow находит handle по id → кабель рисуется корректно.

После обновления и открытия любого seed-проекта появятся все ~60 кабелей, которые раньше были скрыты — Усадьба выглядит как настоящая схема сети со всеми связями между AP, камерами и свитчами.

### Сворачивание левой панели (Devices)
Теперь у sidebar два состояния:
- **Развёрнут (260px)** — список Devices, поиск, категории, mini-toolbar. В шапке кнопка `‹` для сворачивания.
- **Свёрнут (44px)** — узкая полоска с кнопкой `›` для разворачивания + mini-toolbar вертикально (Каталог/Слои/VLAN/Vault/Настройки).
- Состояние сохраняется в `localStorage:netmap:sidebarCollapsed`.
- Клик по любой иконке mini-toolbar в свёрнутом состоянии автоматически разворачивает панель и открывает нужную под-панель.

### Убран декоративный minimap-блок
Пустая плитка с синим бордером внизу левой панели была визуальным placeholder'ом без функциональности. Удалена.

### Bell / Help — теперь рабочие
Раньше три кнопки в правой части тулбара (Bell / Help / Theme) ничего не делали.

- **Bell** → dropdown с последними ping-alert'ами (up/down transitions устройств). Красный badge с количеством. Клик по алерту выделяет устройство на канвасе. Кнопка «Очистить» сбрасывает список.
- **Help (?)** → модалка **«Быстрая справка»** с 4 секциями: Работа со схемой / Горячие клавиши / Синтаксис поиска / Плавающая кнопка + совет для новых пользователей.
- **Theme (солнце)** → **убран** — в приложении только светлая тема, кнопка вводила в заблуждение.

### Что попробовать
1. Открыть Усадьбу → нажать «Разложить» в правом верхнем углу → **теперь видны все кабели** между свитчами, AP и камерами (раньше их не было видно)
2. Нажать `‹` в шапке левой панели → она свернётся в узкую полоску, канвас станет шире
3. Нажать `?` в правой части тулбара → модалка со справкой
4. Bell рядом с ним показывает уведомления когда мониторинг найдёт down-устройство

---

## v0.20.0 — Читаемая схема с первого взгляда

Пользователь заметил: при первом открытии Усадьбы понять что куда идёт невозможно — устройства налезают на группы, кабели пересекаются, иерархия не читается. Полностью пересмотрел UX первого впечатления.

### Проблема
Seed'ы 3 отелей были расставлены вручную давно, и с ростом визуальной сложности карточек (v0.17 realistic switches, v0.19 vendor faceplates) старые координаты уже не помещаются. Устройства торчат из групп, парные свитчи налезают на «Корпус 1» и т.д. Автолейаут был, но:
1. Никто не знал что он существует (спрятан в kebab-меню)
2. Отступы были слишком тесные (nodeSep=40, rankSep=80)
3. Группы после раскладки получались впритык — дети касались бордеров

### Что сделано

**1. Улучшенные отступы в автолейауте** (`autoLayout.ts`)
- `nodeSep`: 40 → **60px** (между устройствами в ряду)
- `rankSep`: 80 → **120px** (между уровнями иерархии)
- Внутри группы: `GROUP_PAD_X = 32`, `GROUP_PAD_TOP = 64` (header + inset), `GROUP_PAD_BOTTOM = 20` — дети никогда не касаются border'а группы
- Минимальные размеры групп: 220×140

**2. Плавающая кнопка «Разложить» на канвасе** (`LayoutFAB.tsx`)
- Крупная синяя круглая FAB в правом верхнем углу канваса
- Клик → dropdown:
  - **По иерархии (сверху вниз)** — стандартная Cisco 3-tier раскладка
  - **Слева направо** — то же горизонтально
- Всегда виден, всегда доступен

**3. Welcome-баннер при первом открытии**
Показывается автоматически когда:
- Проект имеет ≥ 12 устройств (значит seed или крупная схема)
- Автолейаут ни разу не запускался (флаг `netmap:layoutDone` в localStorage per-project)
- ИЛИ обнаружены наложения (≥ 2 пары устройств с центрами ближе 20px)

Содержит текст «Схема выглядит запутанно» + кнопки **«Разложить»** / «Не сейчас» / ×. После клика или dismiss'а — флаг сохраняется, больше не показывается.

**4. Auto fit-view после раскладки**
`store.autoLayout()` теперь после применения новых позиций dispatch'ит event `netmap:layout-applied`. Canvas слушает и вызывает `rf.fitView({ padding: 0.15, duration: 400 })` — вся схема плавно центрируется в viewport'е.

### Как это ощущается
1. Открываешь Усадьбу (или любой seed-проект) первый раз → **справа сверху появляется баннер** «Схема выглядит запутанно»
2. Кликаешь **«Разложить»** → все устройства раскладываются по Cisco 3-tier (провайдеры → GW → Core → Distribution → Access), группы получают правильные размеры, ничто не пересекается
3. Через 400ms плавно zoom-in на всю схему целиком
4. Флаг сохраняется — при повторном открытии баннер уже не показывается

### Совместимость
- Существующие ручные раскладки не трогаются автоматически — только по нажатию кнопки пользователем
- `Ctrl+Z` откатывает раскладку (единичная запись в истории)
- Все другие фичи (VLAN, MikroTik, export, bulk-edit) работают как раньше

### Что можно ещё улучшить
- **Bundle параллельных кабелей** — когда 4 кабеля идут из одного свитча в другой рядом, склеивать их в один жирный жгут
- **Автоматическая иерархия провайдеров** — сейчас провайдеры (Rostelecom, BeeLine, E-type) висят отдельными карточками сверху; можно объединять их в **super-header row** «Интернет»
- **Автолейаут при импорте MikroTik** — новые DHCP-устройства сразу раскладываются в соответствующие layer'ы

---

## v0.19.0 — Коллизия + вендор-фейсплейты + MikroTik VLAN + Bulk-порты + Export + Умный поиск

Один из самых плотных релизов. Шесть блоков.

### 1. Коллизия устройств при перетаскивании
Раньше устройства могли ложиться друг на друга «поверх», превращая схему в кашу.
- Новый `src/collide.ts` — AABB-based push-away алгоритм.
- Работает **и во время drag** (`onNodeDrag`), и **после отпускания** (`onNodeDragStop`).
- **Сдвигается сосед**, а не dragged — user всегда получает узел в той точке, куда он его положил.
- Отступ 12px между карточками, до 4 итераций для разрешения chain-collision (когда сдвиг одного пушит следующего).
- Kind-aware размеры карточек: rack1u (Router/Firewall) ≠ round (AP/Camera) ≠ box (PC/Server).
- **Побочно исправлен баг v0.14+** с re-parenting: `onNodeDragStop` раньше отрабатывал только для `node.type === 'device'` — switch / patchpanel / server не переносились в группы при drag. Теперь работает для всех.

### 2. Realistic vendor faceplates (Cisco / MikroTik / UniFi / TP-Link / HP-Aruba / D-Link / Juniper)
- `detectVendor(d)` в `DeviceNode.tsx` — определяет вендор по `d.vendor` / `d.model` / `d.name` regex'ами: `cisco/catalyst/meraki`, `mikrotik/routeros/crs/ccr`, `ubiquiti/unifi/edgerouter`, `tp-link/tl-`, `hp/aruba/procurve`, `d-link/dgs`, `juniper/junos/srx`.
- Vendor-specific chassis-градиенты и цвета bezel'а:
  - **Cisco** — светло-серый с бирюзовым `#1BA0D7` bezel
  - **MikroTik** — тёмный чёрный корпус, лейбл на белом фоне
  - **UniFi** — почти белый с синим `#0559C9` bezel
  - **TP-Link** — светлый с бирюзовым
  - **D-Link** — жёлтый bezel `#FDB515`
  - **Juniper** — зелёный bezel `#84B135`
- **Vendor pill** под фейсплейтом — маленький ярлык с логотипом бренда + модель.
- Firewall-фейсплейт с брендированной вентиляционной решёткой.

### 3. Import VLAN из MikroTik
- Новый endpoint `fetchVlans` в `electron/mikrotik.cjs`:
  - `/rest/interface/vlan` — legacy L2 VLAN интерфейсы (vlan-id + parent iface)
  - `/rest/interface/bridge/vlan` — RouterOS 7 bridge VLAN filtering
- Оба сливаются по vlanId, поддержка диапазонов `vlan-ids: "10,20,30-40,100"` через `expandVlanIds`.
- В `MikrotikImportDialog` новая секция **«VLAN'ы роутера (N)»** между статус-баром и таблицей устройств:
  - Список чекбоксов, разбитый по 2-3 колонки в зависимости от ширины
  - Preselect'аются только те, которых нет в проекте (дубликаты disabled + помечены «уже есть»)
  - Кнопки «Выделить все новые» / «Снять выделение» / **«Импортировать N VLAN в проект»**
  - Каждый импортированный VLAN получает vendor-agnostic имя (UPPER-case, из RouterOS name/comment), цвет из `vlanColorForIndex`, и **description** со списком tagged/untagged портов и bridge для истории.

### 4. Bulk-edit портов через Shift/Ctrl + click в Port Matrix
Раньше можно было редактировать по одному порту — на 48-портовом свитче это боль.
- **Shift + click** в Port Matrix — выделить диапазон от последнего клика до текущего
- **Ctrl / Cmd + click** — добавить/убрать порт из выборки
- Выделенные порты обведены **синей рамкой `#2563EB`**
- Появляется **action strip** под матрицей: пилл `N портов` + кнопки:
  - **VLAN ▾** — dropdown со всеми VLAN проекта, применить access VLAN на все выделенные
  - **Скорость ▾** — `100M / 1G / 2.5G / 10G / — Сбросить`
  - **⚡ PoE** — toggle PoE у всех выделенных сразу
  - **Up / Disable** — быстро поменять status у всех
  - **✕** — снять выделение
- Обычный клик (без модификаторов) сбрасывает выборку и открывает editor одного порта — старое поведение сохранено.

### 5. Export схемы в PNG / SVG / JSON
- Новый `src/exportCanvas.ts` использует `html-to-image` (40 kb библиотека)
- **Автоматически считает bounding-box** всех групп и устройств, чтобы экспорт содержал всю схему целиком, а не только видимую область
- Временно **прячет UI-chrome** (Controls / MiniMap / attribution / баннеры) на время snapshot'а — картинка чистая
- Восстанавливает viewport transform после экспорта, чтобы user не потерял свой pan/zoom
- **PNG**: `pixelRatio=2` (retina), белый фон, суффикс `-YYYY-MM-DD` в имени файла
- **SVG**: векторный, для docs/print
- **JSON**: raw NetMapDoc без runtime-полей (liveStatus/lastRttMs)
- Все три в **kebab-меню** тулбара (⋮) — секция «Экспорт»

### 6. Умный поиск в тулбаре — синтаксис фильтров
Расширил free-text поиск структурированной грамматикой:

```
vlan:10                — устройства с VLAN 10 (access ИЛИ trunk, на порту ИЛИ линке)
ip:192.168             — префикс IP-адреса
mac:AA:BB              — substring MAC
kind:switch            — по типу
kind:switch,router     — несколько типов через запятую
tag:cctv               — по тегу
vendor:cisco           — производитель
model:catalyst         — модель
status:up|down|unknown — по ping-статусу
loc:Ресторан           — по расположению
```

- Все токены **AND-combined** — можно комбинировать: `kind:camera vlan:50` даст все камеры в VLAN 50
- Free-text без префикса работает как раньше — fuzzy match по всем полям
- **Умный dropdown**: когда ничего не найдено, показывается шпаргалка с примерами синтаксиса
- Placeholder тулбара обновлён: `Поиск: имя, IP, VLAN… (vlan:10, kind:switch, ip:192.168, status:down)`

### Совместимость и качество
- `tsc --noEmit` + `vite build` — чисто
- Никаких новых миграций схемы (v3 из v0.13 остаётся актуальной)
- Все существующие проекты открываются без изменений
- Новая зависимость: `html-to-image@^1.11` (production)

### Что попробовать
1. Попробуй перетащить устройство поверх другого — оно раздвинет соседей вместо наложения
2. Открой любой Router/Firewall с моделью `Cisco Catalyst` в `d.model` — увидишь голубой Cisco bezel
3. Открой MikroTik-роутер в диалоге импорта → увидишь секцию VLAN'ов роутера сверху
4. На большом свитче — Shift-click по крайнему порту, затем Shift-click по другому → выделен диапазон → назначь VLAN
5. В kebab-меню тулбара → «Экспорт в PNG» → скачается вся схема с полями
6. В поиске набери `kind:camera vlan:50` — найдутся все камеры в CCTV VLAN

---

## v0.18.0 — Без стрелок + подсветка связей при наведении

Две небольшие, но очень заметные вещи для читаемости схемы.

### 1. Убраны стрелки на кабелях
- Убран весь код с `arrow-end` / `arrow-start` маркерами в `PortEdge`, поля `arrowAtTarget` / `arrowAtSource` вычищены из data-props.
- Кабели теперь чистые линии, как в референс-макете.

### 2. «Подсветка связей» — новый режим просмотра
Главное юзабилити-улучшение: теперь легко разобраться в клубке кабелей, даже если их много.

**Как работает:**
- **Наведи курсор** на любое устройство → все его прямые соседи и соединяющие их кабели остаются яркими, а всё остальное **приглушается до 15% прозрачности**.
- **Кликни** на устройство → тот же эффект, но зафиксирован (пока не кликнешь по пустому месту).
- **Выдели несколько устройств** (Ctrl+клик) → подсвечиваются все их соседи разом.
- Работает и с VLAN-бэйджами, и с port-bubbles, и со скоростью — они тоже приглушаются на «чужих» кабелях.
- Связанные с активным устройством кабели становятся **чуть толще** и получают лёгкое свечение — сразу видно, куда они идут.

**Как включить/выключить:**
- В верхнем тулбаре, рядом с уведомлениями — **иконка глаза** (👁 / 👁‍🗨).
  - Включена (глаз открыт) → dim-эффект работает.
  - Выключена (глаз перечёркнут) → все кабели показаны одинаково, без затенения.
- Настройка сохраняется в `localStorage:netmap:focusRelated` — включена по умолчанию.

**Технически:**
- Новое поле в store: `hoveredDeviceId: string | null` с `setHoveredDevice` — обновляется через `onNodeMouseEnter` / `onNodeMouseLeave` React Flow.
- `focusSet` — Set узлов, которые остаются яркими: активные + все их непосредственные соседи (по links).
- В `Canvas.displayedNodes` — добавлен `focusDim` рядом с `pathDim` (совместимо с traceroute).
- В `PortEdge` — новые `isDimmed` / `isEmphasised` флаги вычисляются из `hoveredId` / `selectedDevId` / `multiSelectedIds`, применяются к `opacity`, `strokeWidth`, `filter`.
- Плавные переходы через CSS `transition` (180ms) — глаз не режет.

### Что попробовать
1. Открой схему «Усадьба» с VLAN-бэйджами
2. Наведи курсор на роутер `GW` в Server Room — всё вокруг него подсветится, соседи проступят из общего фона
3. Отведи курсор → возвращается к обычному виду
4. Выключи глаз в тулбаре → все кабели снова одинаково яркие

---

## v0.17.0 — Единый визуал по референс-макету

Полный редизайн под предоставленный референс. Пять больших блоков.

### 🔴 Новая левая панель — DevicesSidebar (260px)
Полностью заменил rail+slide-out `ActivityBar` на **единую колонку** как в макете:
- Заголовок **Devices** с шевроном для сворачивания
- Поиск по каталогу устройств (с иконкой)
- **Аккордеон-секции**: Network / Wireless / Cameras / Servers / Endpoints с шевронами ⌄
- Каждая строка — маленькая цветная иконка + название, drag-and-drop на канвас или клик = создать
- Внизу — **мини-toolbar с 5 иконками**: Каталог / Слои / VLAN / Vault / Настройки — с бэйджами счётчиков
- **Minimap** — превью-плитка внизу с синим бордером (декоративная)
- При клике на любую иконку toolbar'а справа открывается **300px slide-out** с соответствующей панелью

### 🟡 Верхний тулбар — растянут на всю ширину
- Слева: логотип **N** + NetMap + workspace-switcher + **Health-widget** (пилл `99.8% Online` + sparkline)
- По центру: **широкий поиск** `Search devices, IPs, VLANs…` с `⌘K` хинтом
- Справа сгруппированы иконки как в макете: 🔔 Bell / ❓ Help / ☀ Theme / **+ Add Device** (синяя primary CTA с dropdown) / 📥 Import / ⋮ Kebab
- В kebab-меню спрятаны **Undo/Redo/Knife/Autolayout** (чтобы тулбар не был перегружен)
- Скругления `6px` — менее выражены, как в референсе

### 🟢 Realistic визуалы устройств (три класса карточек)
Полностью переписан `DeviceNode` — теперь устройства выглядят как в макете:

**Rack1U card** (Router, Firewall, Patch panel, ISP):
- Белая карточка с названием сверху и IP под ним
- **Мини 1U-полоса** в стиле реального стойкового устройства — светло-серый градиент, LED-индикаторы, вертикальный бренд-блок, реалистичные слоты RJ45 с индикаторами связи
- Distinct-варианты фейсплейта для Router / Firewall (с вентиляционной решёткой) / Patch panel (столбики портов) / ISP (иконка облака)

**Round card** (Wi-Fi AP, Camera, Printer, Lock, POS):
- Круглая иконка-медальон в цветном кольце сверху
- Название + IP под ней
- Для AP — дополнительно **Wi-Fi волновой значок** в правом нижнем углу

**Box card** (PC, Server, VM, VPS):
- Компактная карточка: квадратная иконка слева + название/IP справа
- Для VM — доп. строка `2vCPU · 4GB`

- **Layer stripe** (Cisco 3-tier) теперь **сверху карточки** (тонкая цветная полоска), а не сбоку
- Live-status dot переехал в top-left (белая обводка, чтобы видно на любом фоне)

### 🟣 Соединения — голубые с речью скорости
- Обычные кабели: **`#93C5FD`** (soft blue) как в референсе
- Fiber / Uplink / Inter-group: **`#3B82F6`** (bright blue backbone)
- Wi-Fi: `#F59E0B` amber с dashed pattern
- **Скорость порта автоматически становится центральной подписью** кабеля (`10 Gbps`, `1 Gbps`, `100 Mbps`), если у links нет своей label
- Пилюля скорости теперь: белый фон + **бордер в цвет кабеля** + синий моноширинный текст — читается как «принадлежность» к линку

### 🔷 Правая панель — точная копия макета
- **VLANs** секция: не карточки, а **простой список строк** — цветной круглый чип с VLAN ID (кольцо + светлая заливка) + название VLAN uppercase + CIDR монами справа + ссылка **Manage** в заголовке
- **Port Matrix**: сетка квадратов с округлыми углами `4px` — **зелёные `#10B981` для 1G** с белыми цифрами, **синие `#3B82F6` для 10G**, **светло-серые `#E5E7EB` для disabled/down**. Легенда — круглые точки сверху.
- **Device Information** — без изменений (уже было ок)
- **Ping** — без изменений
- Табы Overview/Ports/VLANs/Alerts/Config — без изменений

### Совместимость
- Все существующие проекты открываются как раньше — только визуал изменился
- Handles на нодах в том же месте — существующие кабели рисуются корректно
- Undo/Redo/hotkeys — работают через kebab-меню
- `tsc --noEmit` + `vite build` — чисто

### Что можно ещё улучшить (не в этой итерации)
- **Faceplate-градиенты для конкретных вендоров** (Cisco/MikroTik/UniFi узнаваемые расцветки)
- **Bezier-curves** для inter-group соединений (пока smoothstep для внутри-групп, bezier для между)
- **Realistic camera visuals** — сейчас круг с иконкой, можно сделать похоже на реальные dome/bullet камеры
- **Расширенные fauxthumbnails** для preview в inspector header (сейчас плоская иконка на цветном фоне)

---

## v0.16.1 — Hotfix: React error #185 в focus mode

Регрессия из v0.14: при клике по устройству и заходе в focus mode приложение падало с
`Minified React error #185: Maximum update depth exceeded`. Проявлялось только в собранной .exe (production build).

**Корневая причина** — zustand-селекторы возвращали **новый массив каждый рендер**, когда поле в store было `undefined`. Пример: `useStore(s => s.pingHistory[device.id] || [])`. По дефолту zustand сравнивает через `Object.is` → каждый рендер отдаёт свежий `[]` → компонент считается изменившимся → триггерит `useEffect` в дочерних PortEdge/PortSlot/react-flow → цикл.

Исправлено в 4 местах:
- **DevicePanel.PingBlock**: `useStore(s => s.pingHistory[device.id]) || EMPTY_HISTORY` — общая замороженная константа-массив вместо inline `[]`
- **DevicePanel.AlertsTab**: `.filter()` вынесен из селектора в `useMemo`, чтобы не создавать новый массив на каждом рендере
- **DevicePanel.VlanSummaryBlock + VlansTab**: `useStore(s => s.doc.vlans) || EMPTY_VLANS` вместо `useStore(s => s.doc.vlans || [])`
- **MultiSelectBar.BulkVlanSelect**: то же для `s.doc.vlans`

Правило для будущего: **`|| []` / `|| {}` внутри селектора zustand = гарантированный бесконечный ре-рендер** если поле бывает undefined. Всегда либо стабильная константа fallback, либо fallback снаружи селектора.

Также в этом релизе — комментарии-предупреждения в коде рядом с проблемными местами, чтобы не наступать снова.

---

## v0.16.0 — Аудит light-темы + VLAN-фильтр + Bulk-VLAN + Config-таб

Полный визуальный аудит после массовых замен цветов + три полезных функции для VLAN-workflow.

### Аудит light-темы (исправлено 10 категорий багов)
Прошёл по всем 33 tsx-файлам и нашёл артефакты sed-миграции, где текст оставался невидимым из-за неполной замены палитры:

1. **FileMenu — активный проект был невидимым**: `#0d3b52` тёмный фон + `#111827` тёмный текст. Правил на светло-синий `#EFF6FF`.
2. **Danger стили в 6 файлах** (LayersPanel, VaultPanel, GroupPanel, ContextMenu, PathBanner, MultiSelectBar): `#7f1d1d`/`#3b0d0d`/`#fca5a5` использовались в шаблонах `1px solid #..`, sed их пропустил. Все → light-danger (`#FEE2E2`/`#FCA5A5`/`#B91C1C`).
3. **Dark greens** в Vault/MikroTik-панелях (`#0d2818`, `#14532d`, `#bbf7d0`, `#166534`, `#4ade80`, `#dcfce7`) → light-green.
4. **Dark blues** в тех же панелях (`#0e2b3d`, `#38bdf8`, `#164e63`, `#1e3a8a`) → light-blue.
5. **Порты в состоянии down/disabled** на DeviceNode/PatchPanelNode/ServerNode: `#1c1f26`/`#1c1917` (чёрные квадратики на белом холсте) → нейтральный `#E5E7EB`/`#F3F4F6`.
6. **FocusView close-button**: тёмная `rgba(0,0,0,0.4)` кнопка на светлой модалке → white с бордером.
7. **LayerLegend/PathBanner/MultiSelectBar overlays**: были `rgba(1,4,9,0.94)` тёмное полупрозрачное с тёмным текстом = невидимо. → `rgba(255,255,255,0.95)`.
8. **DeviceNode textShadow** `0 1px 2px rgba(0,0,0,0.9)` теперь только вредил читаемости на светлом фоне — убран.
9. **DevicePanel «Сохранить как шаблон»** — тёмный `#1e293b` фон → `#F9FAFB`.
10. **LayerLegend hover** `rgba(255,255,255,0.05)` на светлом фоне был невидим → `#F3F4F6`.

Все функциональные API/store/IPC — не тронуты. `tsc` + `vite build` чисто.

### VLAN-фильтр на канвасе
Теперь можно **одним кликом отобразить только устройства/кабели с нужным VLAN**:
- В **VlansPanel** у каждой карточки VLAN — иконка «глаз». Клик = переключить фильтр.
- Активный фильтр показывается как **баннер в центре верха канваса** (`VlanFilterBanner`): цветной пилл с ID VLAN + названием + кнопка ✕.
- Клик по **VLAN-бэйджу прямо на кабеле** тоже фильтрует по этому VLAN.
- Фильтр учитывает **access и trunk одновременно**: устройство/кабель считается «в VLAN» если он указан в `port.vlan`, `port.vlans[]`, `link.vlan` или `link.vlans[]`.
- Уже существовал `filters.vlan` в store, но условия видимости не учитывали trunk — теперь учитывают.

### Bulk-VLAN edit
- В **MultiSelectBar** (появляется при выделении 2+ устройств) — новая кнопка **VLAN ▾** с dropdown всех VLAN проекта.
- Клик = назначить access VLAN на **все порты всех выделенных устройств** (с подтверждением).
- Пункт «— Снять VLAN» — очищает access-VLAN на всех портах.
- Trunk-настройки (`port.vlans[]`) не затрагиваются — только access PVID.
- Типичный use-case: выделить все камеры → назначить CCTV VLAN (50).

### Config-таб в инспекторе
Шестой таб в правой панели — **Config** (иконка «документ»):
- Полный **raw JSON** устройства с syntax-подсветкой (тёмная тема кода на светлом инспекторе — читаемо).
- **Копировать JSON** — с визуальным feedback (галочка на 1.5 сек).
- **Скачать .json** — имя файла = `<device_name>.json`.
- Runtime-поля (liveStatus, lastRttMs, lastCheckedAt) исключены из выгрузки.
- Показывается размер (байт) и число портов.
- Подсказка: полученный JSON можно вставить обратно через File-меню → Импортировать проект.

### Что попробовать
1. Открыть Усадьбу → нажать **«Сбросить к Усадьбе»** → на канвасе VLAN-бэйджи на кабелях
2. Открыть **VLAN** в левой панели → нажать иконку «глаз» напротив CORPORATE (10) → канвас показывает только связанные устройства + баннер сверху для сброса
3. Кликнуть по цветному VLAN-бэйджу на любом кабеле → фильтр применится
4. Ctrl-выделить 3 CCTV камеры → внизу появится Multi-select bar → VLAN ▾ → CCTV (50) → все порты обновятся
5. Кликнуть по устройству → таб **Config** → скопировать/скачать JSON

### Что дальше можно сделать
- **Realistic router/firewall visuals** — сейчас DeviceNode плоские карточки
- **Import VLAN'ов из MikroTik** (`/interface/vlan`, `/interface/bridge/vlan`)
- **Bulk-edit портов внутри одного свитча**: shift-выделить N портов в rack-view → назначить VLAN разом
- **Group-панель Config-таб** тоже
- **Global search по VLAN**: `vlan:10` в поиске → показывает все устройства с VLAN 10

---

## v0.15.0 — Realistic switch faceplates + VLAN badges + Port Matrix bridge

Довожу оставшийся список из макета: свитчи выглядят как настоящие рэковые устройства, кабели показывают VLAN'ы, кликом по Port Matrix можно подсветить кабель на канвасе.

### Realistic switch visuals (SwitchNode)
Полностью переписан `SwitchNode.tsx` под облик реального свитча:
- **Dark chassis** (`#1F2937 → #111827` градиент) с subtle-бордером `#374151` — читается на светлом холсте
- **Chassis LEDs в шапке**: зелёная пульсирующая (Power/Sys OK) + синяя (Link activity)
- Название белым моно-шрифтом, модель + IP серым мелким
- **Порты как реалистичные RJ45 slots**: тёмная утопленная прорезь + `inset` shadow создаёт эффект глубины, LED-точка (зелёная = up, синяя = 10G/uplink, красная = error, оранжевая рамка = PoE)
- Два ряда портов группами по 4, точно как настоящий 24/48-портовый свитч
- SFP-порты отделены вертикальной линией, помечены `SFP` заголовком
- Uplink-порты обведены **оранжевой рамкой** + `↑` стрелка внутри
- Кастомный tooltip уже светлый
- Мини-фейсплейт на **compact-view** — узкая тёмная полоса сверху с крохотными зелёными LED-точками портов (`+N` overflow badge когда >24)

### VLAN-метки на кабелях канваса (PortEdge)
Кабели теперь показывают VLAN как **компактный pill в середине**:
- Формат: `[VLAN ID] NAME  +N`
- Цветной круглый бэйдж с VLAN ID (цвет из проекта)
- Название VLAN uppercase рядом
- `+N` badge когда линк это trunk с дополнительными VLAN (tooltip показывает список)
- Если VLAN не задан — показывается старый `centerLabel` (label кабеля, например «Rostelecom»)
- Данные `link.vlan` и `link.vlans` пробрасываются в data-property edge через Canvas
- В сиде Усадьбы уже проставлены VLAN на нескольких магистральных линках (trunk `1,10,20,30,40,50` gw→sw-opt, access `20` на guest-свитч и т.д.) — сразу видно на канвасе после сброса проекта

### Bezier routing для inter-group кабелей
- `PortEdge` теперь использует `getBezierPath` (плавные S-кривые) для линков между разными группами
- Внутри группы остаётся `getSmoothStepPath` (прямые углы — как в реальном рэке)
- Кривизна `0.35` даёт мягкий изгиб как в макете
- Inter-group кабели уже подкрашены (drop-shadow) — теперь они ещё и красиво изгибаются

### Port Matrix ↔ Canvas bridge
Клик по квадрату Port Matrix теперь синхронизируется с канвасом:
- **Обычный клик**: открывает детальный редактор порта + подсвечивает
- **Shift+клик** или **правый клик**: только подсвечивает (без открытия редактора) — удобно для «покажи мне где этот порт»
- На канвасе:
  - Соответствующий **порт свитча** получает оранжевый outline
  - Соответствующий **кабель** (если порт занят) получает оранжевое свечение (`drop-shadow` + утолщение)
- В самой Port Matrix подсветка обратная: другие порты на том же кабеле тоже помечаются
- Клик по пустому холсту сбрасывает подсветку

Реализация:
- `store.ts`: `highlightPortId: "deviceId:portId"` + `highlightLinkId: string` + `setPortHighlight(devId, portId)` — автоматически находит линк
- `SwitchNode.PortSlot`: outline оранжевый когда `highlightPortId` совпадает
- `PortEdge`: filter drop-shadow оранжевый когда `highlightLinkId` совпадает

### Мелкие фиксы
- Убран legacy тёмный `#134e4a`/`#0d1f1c` в switch-нодах (sed не покрывал вложенные palette-константы)
- Delete-кнопка на выделенном кабеле теперь светло-красная, не тёмно-бордовая
- `centerLabel` кабеля теперь в pill-стиле (`999` border-radius, светлая рамка) — согласовано с VLAN-бэйджами
- CompactSwitchView перерисован под светлую тему с mini-faceplate

### Что дальше можно сделать (не в этой итерации)
- **Realistic router/firewall visuals** (сейчас DeviceNode — плоские карточки-иконки)
- **VLAN filter на канвасе**: клик по VLAN в панели → скрыть все линки/порты без этого VLAN
- **Bulk-edit VLAN**: выделить N портов свитча в rack-view → сразу назначить access VLAN
- **Import VLAN'ов из MikroTik** (`/interface/vlan`, `/interface/bridge/vlan`)
- **Config-таб**: raw JSON устройства + copy + экспорт
- **Ping интервал <5с** для критичных устройств (favorites)

---

## v0.14.0 — Полный светлый скин + верхний тулбар + новый Inspector

Крупный визуальный редизайн под предоставленный макет. Полностью новый вид, но вся функциональность на месте.

### Полностью светлая тема
- Массовая замена GitHub-Dark палитры на Tailwind-Light: `#F9FAFB` (canvas), `#FFFFFF` (панели), `#E5E7EB` (бордеры), `#111827` (текст), `#6B7280` (subtle), `#2563EB` (accent).
- Обновлена палитра `KIND_META` для устройств — пастельные фоны + насыщенные иконки, читаются на белом.
- React Flow controls / minimap / grid — все переведены на светлые цвета через глобальные CSS-переопределения в `index.html`.
- Аккуратные кастомные скроллбары (8px, серые).

### Новый верхний тулбар (по макету)
- **Logo N** (градиент blue→purple) + название приложения.
- **File-меню** (workspace switcher) с проектами.
- **Health-widget**: цветная точка (зелёный ≥95%, амбер ≥80%, красный <80%), процент онлайн, мини-sparkline. Хинт: X / Y устройств отвечают на ping.
- **Global search** (⌘K / Ctrl+K фокусирует поле): по имени, IP, MAC, модели, локации, тегам — с dropdown-результатами. `kbd`-хинт справа.
- **Undo/Redo/Knife/Разложить/TB/LR** — компактные светлые кнопки.
- Primary CTA **+ Add Device** — синяя кнопка с dropdown-меню всех типов устройств (иконка + hint), создаёт устройство в центре канваса.

### Новый Inspector (правая панель)
- Header в стиле макета: **preview-плитка** устройства (иконка на цветном пастельном фоне) + название (двойной клик — редактировать) + модель мелким шрифтом + **Online/Offline/Checking/Unknown pill** справа с цветной точкой.
- Ниже — chip с типом устройства (`SWITCH`/`ROUTER`/…) и кнопка удалить.
- **Icon-табы** внизу шапки: Overview / Ports / VLANs / Links / Alerts / Access. Активный подчёркнут синей полоской, залит `#EFF6FF`.
- Ширина увеличена `340 → 360 px`.

### Overview-таб теперь как в макете
- **Device Information** — read-only grid `label → value` (IP Address, MAC Address, Model, Vendor, Location, Uptime), моноширинный шрифт для IP/MAC. Карандаш-кнопка справа разворачивает форму редактирования.
- **Ping** — карточка с крупной цифрой RTT в ms + `avg` + мини-график:
  - Сине-заливной area sparkline из истории пингов
  - Красные точки в моменты down
  - Диапазон подписывается: «Последние N часов» / «Собираем историю…»
- **VLANs** — компактный список используемых VLAN устройства с цветными бэйджами и CIDR.

### Ping-история в store (для sparkline)
- Новый тип `PingSample { ts, rttMs?, alive }`, кольцевой буфер до 288 сэмплов (~24 часа при 5-мин интервале).
- `pingHistory: Record<deviceId, PingSample[]>` в store, накапливается на каждом апдейте `applyPingResults`.
- Живёт в памяти (не персистится) — при перезапуске начинается заново.

### Alerts (события ping-монитора)
- Новый тип `AlertEntry { id, ts, deviceId, deviceName, kind, message }`, лимит 100.
- Автоматически генерятся при переходах up→down и down→up.
- В inspector таб **Alerts** — feed событий для конкретного устройства (красные для down, зелёные для up).
- Метод `clearAlerts()` для будущей UI-кнопки «очистить».

### Что ещё можно доработать (не в этой итерации)
- Realistic device visuals — сейчас всё ещё «плоские» карточки с иконкой + названием, не «фотореалистичные» рэковые полоски как в макете.
- VLAN-badges на самих кабелях канваса.
- Кабель-labels с bezier изгибом (сейчас smoothstep).
- Клик по кабелю в PortMatrix → выделить на канвасе.
- Realtime WebSocket ping (сейчас каждые 30с интервалом).

---

## v0.13.0 — VLAN как first-class + Port Matrix (шаг к редизайну)

Первая итерация к макету нового дизайна. Фокус — данные о VLAN и структура правой панели (Inspector).

### Схема документа v3
- `NetMapDoc.version: 2 | 3` — новая схема добавляет `vlans: Vlan[]` в проект.
- Автоматическая миграция при загрузке (v2 → v3 — просто добавляется пустой `vlans`).
- Тип **`Vlan`**: `{ id, vlanId (1..4094), name, cidr?, gateway?, color, description? }`.
- Расширения `Port`: `vlans?: number[]` (trunk allowed list; `vlan` остаётся access/PVID).
- Расширения `Link`: `vlans?: number[]` (магистральные линки-транки).

### VLAN-панель в левой боковой панели
Новый раздел **VLAN** в ActivityBar (иконка полосок с точками):
- Список VLAN проекта, отсортированный по ID.
- **Развёртывающиеся карточки** с редактированием: имя, ID, цвет, CIDR, шлюз, описание.
- Форма **«+ Добавить VLAN»** сверху: автоматически предлагает свободный ID (шаг 10), проверяет дубли.
- **Палитра из 9 предопределённых цветов** (blue/green/amber/purple/red/teal/pink/indigo/slate).
- Бейдж-счётчик использования: сколько раз VLAN назначен на портах/линках.
- Удаление с подтверждением; все ссылки на удалённый VLAN очищаются (port.vlan, port.vlans, link.vlan, link.vlans).

### Seed VLAN для 3 отелей
Каждый seed теперь идёт с осмысленными VLAN'ами под свою адресацию:
- **Усадьба** (10.11.x): MGMT/CORPORATE/GUEST/IOT-SALTO/SERVERS/CCTV
- **Дона** (192.168.x): MGMT/BUH/KASSA/GUEST/CCTV — бухгалтерия и касса вынесены
- **Чайковский** (10.16.x): MGMT/CORPORATE/GUEST/PAY-POS/CCTV

### Новая вкладка VLAN в карточке устройства
Между «Порты» и «Связи» появился таб **VLAN**:
- Сверху — сводка «VLAN на устройстве»: чипы всех VLAN, реально встреченных на портах/линках.
- Ниже — **таблица портов**, каждая строка раскрывается:
  - **Access / PVID** — dropdown с выбором VLAN проекта
  - **Trunk** — набор toggle-чипов, каждый = разрешённый VLAN
- Для крупных свитчей (>8 портов) — показываются только настроенные, кнопка «Все N портов».

### Port Matrix в табе «Порты»
Как на макете — **сетка квадратов с цветом по скорости порта**:
- **Зелёный** = 1 Gbps (default)
- **Синий** = 10 Gbps
- **Teal** = 2.5 Gbps
- **Slate** = 100 Mbps
- **Серый** = down / disabled
- **Красный** = error
- Uplink-порты обведены жёлтой рамкой.
- Клик по квадрату — открывает детальный редактор порта.
- Легенда — сверху справа.

### VLAN-блок в табе «Инфо»
После кнопки «Сохранить как шаблон» — компактный список VLAN этого устройства с цветными бейджами и CIDR (как на макете под «VLANs — Manage»).

### Что ещё впереди (следующая итерация)
Пока НЕ сделано (по договорённости «vlans_first»):
- Светлая тема — редизайн пока в тёмной палитре (VLAN-панель уже в светлых тонах).
- Верхний тулбар с global search / health / add device.
- Кабели с VLAN-метками на канвасе.
- Ping sparkline (пока просто текущий статус).
- Alerts / Config-табы.
- Realistic switch/router visuals.

---

## v0.12.0 — Крупнее интерфейс + автоматика для vault/MikroTik

### Крупнее и удобнее левая часть
- Рельс (rail) увеличен `52 → 64 px`, кнопки — крупные SVG-иконки с текстовыми подписями (не эмодзи)
- Выдвижная панель `220 → 300 px`, плитки устройств `30 → 38 px`, отступы больше
- Базовый шрифт `13 → 14 px` глобально
- Убраны лишние эмодзи в заголовках, чекбоксах, меню

### Автопривязка учёток из vault
- В карточке устройства (вкладка «Учётка») **автоматически предлагаются** записи из vault, у которых:
  - IP-адрес совпадает с device.ip (`+10 очков`)
  - имя записи совпадает / содержит имя устройства (`+8` / `+5`)
  - хост в `mgmtUrl` совпадает с URL записи (`+4`)
  - папка записи соответствует типу устройства (например «MikroTik» для router) (`+2`)
- Одним кликом «привязать» — vaultItemId сохраняется в credential

### Focus mode: кнопка «Открыть в браузере» + учётка сбоку
- В шапке Focus-модалки — синяя кнопка **«Открыть в браузере»** (URL строится из `mgmtUrl` или `http(s)://ip`)
  - для camera/router/switch по умолчанию `https://`, для остальных `http://`
  - в Electron открывается через `shell.openExternal` во внешнем браузере
- Ниже — блок с найденной учёткой (по правилам выше), кнопки копировать имя/пароль
- Пароль автоочищается из буфера через 20 сек

### MikroTik-скан: полное обновление совпадающих узлов
- Раньше при повторном скане обновлялся только IP. Теперь если MAC совпадает:
  - обновляется `ip`
  - обновляется `name`, если пользователь его не переименовывал вручную
  - подставляется `vendor`, если пуст
  - **комментарий из DHCP-lease** дописывается в `credential.notes` в формате `[MikroTik: <comment>]` (без дубликатов)
  - добавляется тег `mtk-synced`
- Флажок «показать уже в схеме» теперь включён по умолчанию (чтобы видеть, что будет обновлено)
- Метка на строке: «обновится» вместо «в схеме»
- Итоговое окно: «Синхронизация с MikroTik: добавлено N, обновлено M»

---

## v0.11.1 — Безопасное хранение учёток MikroTik (интеграция с Vault)

Пароль от MikroTik теперь можно **не вводить каждый раз** и **не хранить в plaintext**:

### Что изменилось

- **Пароль хранится ТОЛЬКО в `useRef` во время открытого диалога**, никогда не попадает в React state → не участвует в React DevTools дампах и HMR
- **После сканирования — обнуляется в памяти** (если только не выбрана vault-запись, тогда остаётся для повторных сканов той же сессии)
- **Закрытие диалога — обнуляет** ref
- Поле пароля с `autoComplete="new-password"` — не сохраняется в браузерных менеджерах

### Интеграция с Vault

Наверху диалога — селект **🔑 Учётка из Vault**:
- Если vault не создан → подсказка «откройте 🔑 Vault в тулбаре»
- Если заблокирован → кнопка «🔓 Разблокировать»
- Если разблокирован → dropdown с записями из папки **MikroTik**
- Выбор записи → host/username/password автозаполняются из vault
- Кнопка **💾 Сохранить в vault** — при первом использовании можно сразу сохранить учётку

Vault защищён вашим мастер-паролем + AES-256-GCM + PBKDF2 200k итераций.

### HTTPS-only по умолчанию

- Галочка «Разрешить самоподписанный HTTPS» теперь **выключена** по умолчанию
- Если хост введён как `http://...` — перед запросом появляется **красное предупреждение** с подтверждением
- Placeholder изменён на `https://192.168.11.1`

### Встроенный чек-лист безопасности

В диалоге — раскрывающийся блок «💡 Как создать безопасного read-only юзера на MikroTik» с готовой командной строкой:

```
/ip service enable www-ssl
/ip service disable www
/user add name=netmap password=<длинный-пароль> group=read address=192.168.11.100/32
/log print where topics~"account"
```

Плюс инструкция про **API-token** (RouterOS 7.13+) — можно использовать вместо пароля и отзывать одной командой.

### Зелёный «security callout»

Прямо в диалоге видно: «Пароль не сохраняется, живёт в памяти только на время запроса, обнуляется после — рекомендуется отдельный read-only юзер с IP-фильтром».

## v0.11.0 — Импорт устройств из MikroTik (DHCP + ARP)

Автоматическое обнаружение реальных устройств вашей сети через **RouterOS REST API**. Больше не надо руками вбивать 30 камер.

### Как включить на MikroTik

RouterOS v7.1+ уже поддерживает REST. Активируйте:
```
/ip service enable www-ssl
# (или www для plain HTTP — не рекомендуется)
/user add name=netmap password=... group=read
```

### Как импортировать

1. Меню **📁 Файл** → **📡 Импорт устройств из MikroTik…**
2. В диалоге: адрес роутера (`192.168.11.1` или `https://router.local`), логин, пароль
3. Галочки: **DHCP leases** (что раздано по DHCP), **ARP таблица** (реально видит роутер), **Разрешить самоподписанный HTTPS** (обычно да)
4. **🔎 Сканировать** — идёт HTTP-запрос к `/rest/system/resource`, `/rest/ip/dhcp-server/lease`, `/rest/ip/arp`
5. Появляется таблица: hostname, IP, MAC, тип (auto-guess), vendor (по OUI), источник (`dhcp`/`arp`/`both`)
6. Галочки/фильтры → **📥 Импортировать N** → устройства создаются в новой группе **📡 DHCP · <host>**

### Умный auto-guess

- **По MAC OUI**: Ubiquiti → AP, Hikvision/Dahua → камера, MikroTik → switch, Synology/HyperV → server, HP/Kyocera → printer
- **По hostname**: `cam*`, `cctv*` → камера; `ap*`, `wifi*` → AP; `pos*`, `kass*` → POS; `salto*`, `door*` → замок; и т.д.

### Match-by-MAC (без дублей)

Если устройство с таким MAC уже есть в текущей схеме — импорт **обновит его IP**, не создаст дубль. В таблице такие строки помечены жёлтым «в схеме».

### Что импортируется

- **hostname → name** (или vendor + last 4 MAC при пустом hostname)
- **IP из lease/ARP**
- **MAC**
- **kind** — угадан
- **vendor** — угадан по OUI
- **tags**: `imported`, `dhcp`
- Один порт **lan** (RJ45)
- Группируется в **📡 DHCP · <host>** (голубая рамка)

### Ограничения

- Работает **только в собранной .exe** (Electron main-процесс). В браузерном preview CORS/net не даёт сделать запрос. UI покажет предупреждение.
- Пароль **НЕ сохраняется** (host/user запоминаются в localStorage без пароля)
- Топология связей не строится автоматически — только устройства как ноды. Кабели рисуются вручную или через Focus mode

## v0.10.0 — Иерархическая модель Cisco (Core / Distribution / Access)

Внедрена классическая **трёхуровневая модель Cisco** для корпоративных сетей — устройства теперь помечаются уровнем в иерархии.

### 🏛 Три уровня

- **🏛 CORE — красный** — высокоскоростная магистраль (роутеры, aggregation-свитчи с 10G/SFP+)
- **🌉 DISTRIBUTION — жёлтый** — интерфейс между ядром и пользователями (managed-свитчи, серверы)
- **📱 ACCESS — зелёный** — пользователи и оконечные устройства (AP, камеры, ПК, POS, принтеры, замки)

### Визуализация

- **Цветная полоска слева** на каждой карточке устройства — сразу видно, к какому уровню оно относится
- **Мини-легенда в нижнем-левом углу канваса** — счётчик устройств по уровням, клик по уровню = скрыть/показать
- **Автолейаут теперь учитывает уровень**: при кнопке 📐 Разложить ядро уходит в верхнюю полосу, distribution в среднюю, access в нижнюю — получается настоящая иерархическая диаграмма

### Управление

- **Правый клик по устройству** → «🏛 Уровень» → подменю (Авто / Core / Distribution / Access)
- **Правая панель** → вкладка «Инфо» → селект «Уровень (Cisco 3-tier)»
- **Auto**-режим — уровень выводится из типа устройства (роутер → core, свитч с SFP+ → distribution, AP/камера → access и т.д.)

### Слои-фильтры

- Новая секция **«Иерархия сети»** в панели 🧅 Слои — чекбоксы Core/Distribution/Access
- Новые пресеты:
  - **🏛 Ядро** — оставить только CORE-магистраль
  - **🌉 Ядро+Дист** — CORE и DISTRIBUTION без пользовательских устройств
- Клик по уровню в мини-легенде тоже скрывает/показывает его

### Как это помогает

- **Быстро увидеть магистраль** — пресет «🏛 Ядро» скроет 90% устройств, останутся только core-узлы
- **Понять зависимость** — access-устройство под каким distribution-свитчем, distribution под каким core
- **Автолейаут делает диаграмму сразу читаемой** — иерархия физически проявляется на канвасе

## v0.9.2 — Кабели редактируются в Focus mode · Стрелки на аплинках · Фикс удаления

### 🔧 Управление портами прямо в Focus mode

- **Клик по свободному порту** → выпадает **пикер устройства**: список всех устройств со свободными портами + поиск по имени/IP/модели → выбор устройства → выбор порта → готово
- **Кнопка ⇄** рядом с занятым портом → **переподключить** к другому устройству/порту (старый кабель удаляется автоматически, новый создаётся)
- **Кнопка ✕** → отключить (с подтверждением)
- Пикер учитывает статус портов: занятые порты не показываются, для каждого устройства сразу видно **сколько свободных портов**
- Работает и с портами на самом фокусируемом устройстве (в т.ч. со снятием флага и заменой на другой)

### ⬆ Стрелки на uplink-кабелях

Кабели с одного из концов на **порту с флагом uplink** теперь рисуются со **стрелкой на упстрим-конце**. То же самое для **inter-group** магистральных связей — стрелка показывает «наверх по иерархии».

- **↑** на стороне aggregator/core — показывает, что нижестоящее устройство «висит» на нём
- Цвет стрелки = цвет кабеля (fiber синий, copper жёлтый)
- Стрелка автоматически ориентируется по направлению последнего сегмента пути (`orient="auto"`)

### ✅ Кнопка удаления кабеля наконец работает

Проблема была в CSS: `pointer-events: none` наследовался от контейнера `EdgeLabelRenderer`. Убрал наследование, кнопка теперь кликается корректно. Плюс сделал её крупнее (28×28), с более контрастным border и тенью — легко попасть.

## v0.9.1 — 1 кабель / порт · Нож · Focus mode · Свёрнутые заметки

### 🔒 Один кабель на порт (валидация)

При попытке подключить кабель к уже занятому порту React Flow **не даёт завершить соединение** (не показывает drop-индикатор). Двойная защита в `onConnect` — если каким-то образом просочилось, всё равно не создаётся.

- Проверка учитывает **и sourcePort, и targetPort**
- Только для endpoint'ов с `portId` (компакт-view без явного порта не блокируется)
- Self-loop (сам на себя) тоже запрещён

### ✂️ Удаление кабелей — два способа

**Способ 1: клик + красная кнопка ✕**
- Клик по кабелю выделяет его: линия становится жирнее с glow, посередине появляется **красный кружок ✕**
- Клик по кружку — удалить
- Также **Delete** на клавиатуре удаляет выделенный кабель
- Кликнули по фону — выделение снялось
- Плюс: у каждого кабеля теперь **невидимая широкая полоска-хитбокс 20px** — попасть в тонкую линию мышью стало намного проще

**Способ 2: режим ножа 🔪**
- Кнопка **🔪 Нож** в тулбаре (или клавиша **T**)
- Активируется — кнопка становится красной **✂️ Резать**, курсор на канвасе — крестик
- **Любой клик по кабелю мгновенно его перерезает** (без подтверждения)
- Escape — выход из режима ножа

### 🔍 Focus mode — двойной клик по устройству

**Новое поведение double-click:** устройство разворачивается в **полноэкранную модалку** с:
- Крупной иконкой + именем + всей мета-инфой (модель, IP, локация, счётчик портов)
- **Каждый порт** отдельной строкой с полной картинкой подключения:
  - Индикатор порта (up/down/uplink/error), тип и скорость
  - Название и иконка **подключённого устройства**, его IP и порт с той стороны
  - Свободные порты — серым, с описанием «свободен»
- **Клик по подключённому устройству** внутри focus-mode → фокус перескакивает на него (можно "путешествовать" по цепочке)
- **Заметки-стикеры** остаются видны в углу
- **Escape** или клик по затемнённому фону → закрыть
- Красивая pop-анимация появления

**Раскрыть/свернуть свитч** (compact ↔ rack) теперь только через:
- Кнопку `◱` в правом верхнем углу карточки
- ПКМ → «Развернуть (порты)» / «Свернуть»

### 📜 Свёрнутые стикеры-свитки

- Новая кнопка **📜** в углу заметки (появляется при hover) → сворачивает записку в маленький **свиток-роллик** (paper scroll SVG)
- Клик по свитку → разворачивается обратно
- Свиток сохраняет цвет и поворот, при hover увеличивается + свет
- ПКМ на свитке → меню (сменить цвет / развернуть / удалить)
- Первая строка текста в тултипе — быстрый peek
- Тоже работает через ПКМ по заметке → «📜 Свернуть в свиток»

## v0.9.0 — Workspace: несколько схем в одном приложении + меню Файл

**Главное:** приложение теперь держит **несколько независимых проектов** (по одному на каждое предприятие). Все проекты хранятся в одной рабочей области, но каждый — свой NetMapDoc.

### 🏢 Мультипроектность

- На месте прежней надписи «Отель Усадьба» в тулбаре — **выпадающее меню Файл 📁** с списком всех проектов и командами
- Из коробки создаётся **три проекта** на основе ваших схем:
  - **Отель «Усадьба»** — заново перерисован из оригинала: 3 провайдера (Rostelecom, BeeLine, E-type), GW `192.168.11.1`/`192.168.211.1`, SW_OPT `10.11.99.10`, SW_U2 `10.11.99.11`, SW_Kitchen `10.11.99.251`, SW_RCP `10.11.99.252`, SW_CORE `10.11.99.28`, PP_U2, все AP/CCTV/SALTO
  - **Отель «Дона»** — GW `192.168.10.1`/`192.168.200.1`, SW_CORE `192.168.10.85`, SW_BUH `192.168.10.245` c 7 ПК бухгалтерии, SW_DV `192.168.10.21` для ресторана Dolce, RPC_KASSA `192.168.10.251`, SW_GUEST `192.168.10.253`, HyperV, Synology NAS, 2 PoE-свитча с 11 камерами Dolce
  - **Отель «Чайковский»** — GW `10.16.0.1`/`10.16.99.1`, SW_CORE, D-Link TCH_U1/U2 (по 48 портов), 2×POE 16 портов с 30 камерами (по 15 в корпус), SRV_TCH с IPMI, 2 регистратора, все AP на этажах и в номерах

### 📁 Меню Файл (в тулбаре)

Клик по имени активного проекта → выпадает:
- **Список всех проектов** (✓ у активного) — клик переключает
- **＋ Новая схема…** — пустой проект с именем
- **⧉ Дублировать активную…** — копия текущей со всеми устройствами и связями
- **✏️ Переименовать активную…** — переименование
- **⤒ Импортировать проект…** — загрузка JSON, добавляется как новый проект
- **⤓ Экспортировать активный…** — сохраняет активный проект в .json
- **⤓⤓ Экспортировать всю рабочую область…** — все проекты в одном файле
- **↺ Сбросить к «Усадьбе»** — вернуть активный проект к сид-контенту
- **🗑️ Удалить активный проект…** — доступно если больше одного

### 🔗 Общие данные vs проектные

- **Vault (пароли), теги устройств, шаблоны Каталога, фильтры слоёв** — **общие** на все проекты (это часто персональные настройки админа)
- **Устройства, группы, кабели, стикеры** — **свои у каждого проекта**
- **История Undo/Redo** — своя у каждого проекта (переключение сбрасывает историю)

### 🧵 Inter-group кабели: чиним видимость

CSS `.react-flow__edges { z-index: 1000 !important }` — кабели ГАРАНТИРОВАННО поверх всех узлов, включая рамки групп. Раньше группы могли перекрывать fiber-магистраль между зонами.

### 📌 Что осталось от предыдущих версий

Всё, что было в v0.8.6 (перетаскивание стикеров, ресайз групп, порт-плашки, всплывашки на портах) — работает и в новых проектах.

## v0.8.6 — Порт-плашки, ресайз групп, перетаскивание стикеров, магистрали выделены

- **Port-плашки** (`E2`, `E4`, `SFP1` рядом с кабелем) сдвинуты **дальше от края** ноды в область канваса, `zIndex: 20` — больше не заслоняются устройствами
- **Handle порта** — теперь тонкая полоска-«pigtail» (8×4) вместо круга. Не заслоняет номер порта под ним. Handle рисуется **строго за пределами** ноды, чётко видно откуда торчит кабель.
- **Номера портов** правильно располагаются: **верхний ряд** — цифра сверху над портом, кабель уходит через цифру наверх; **нижний ряд** — цифра снизу, кабель уходит вниз. Используется flex-column, никакой глубины наложения.
- **Стикеры перетаскиваются** — pointer down + движение больше 4px = drag заметки в любую точку рядом с устройством. Позиция сохраняется в `StickyNote.offsetX/Y`. Обычный клик (без движения) — как раньше, входит в режим редактирования. Правый клик — меню (цвет/дублировать/удалить).
- **Группы можно ресайзить мышью** — 8 угловых/боковых handle через React Flow `NodeResizer`. Появляются при выделении группы. Snap к 20px. Минимум 180×100.
- **Магистральные (inter-group) кабели** визуально выделены: **+1.5px толщина** и мягкий glow цветом кабеля. Больше не сливаются с локальными связями.

## v0.8.5 — Модалки вместо prompt/confirm, стикеры и переименование заработали, кабели всегда сверху

**Что было сломано в .exe:**
- «Переименовать», «Переименовать / описание», «Задать VLAN» ничего не делали — вызывали `prompt()`, а он в Electron с contextIsolation молча возвращает `null`
- Заметки не появлялись при клике по цвету — тот же `prompt()`? Нет, тут другое: `overflow: hidden` + опечатка в pop-анимации оставляли стикер невидимым
- Булавка стикера была обрезана — из-за `overflow: hidden` на карточке
- Кабели визуально уходили под ноды — z-index не был выставлен

**Что сделано:**
- **Свой модальный компонент** `Modal.tsx` (`promptText / confirmDialog / alertDialog`) — работает во всех местах где раньше был `prompt/confirm/alert`. Красивый, с Enter/Escape, danger-стилем для удалений
- **Все 20+ мест** переписаны на новые модалки: переименование устройства/группы/порта, задание VLAN, описание порта, удаление всего, сохранение шаблона, ввод мастер-пароля
- **Заметки**:
  - Убран `overflow: hidden` — булавка больше не обрезается
  - Pop-анимация переделана на `requestAnimationFrame × 2` — гарантированно проигрывается вместо мгновенного скачка к финалу
  - Текст сам себя ограничивает через `overflow: auto`
- **Кабели всегда поверх нод** — глобальный CSS `.react-flow__edges { z-index: 5 }`. Устройства не перекрывают связи, всегда видно куда идёт линия

## v0.8.4 — Кабели физически цепляются к портам свитча

**Симптом:** в rack-view свитча (SW_CORE, SW_U2, SW_OPT и т.д.) кабели шли к боковым/угловым точкам карточки, не к конкретным зелёным портам. Плюс, видимого «отверстия»/точки на порту, откуда торчит кабель, не было — казалось, что связи «висят на заднем плане».

**Причина:** React Flow Handle-компоненты сидели **внутри** rotated `<div transform: rotate(45deg)>` (для SFP-ромбов) и глубоко внутри вложенных div'ов обычных портов. Из-за transform React Flow не мог правильно вычислить абсолютные координаты handle → цеплял кабель к ближайшей точке ноды-контейнера. Плюс были дублирующиеся fallback handles `_left`/`_right`, которые перехватывали связи.

**Что сделано:**
- Handle-компоненты вынесены **наружу** rotated div'ов, теперь они закреплены на верхнем/нижнем крае самого port-wrapper'а (за пределами трансформации)
- **Handle всегда виден** — маленькая цветная точка на верхнем ребре порта верхнего ряда и на нижнем ребре порта нижнего ряда. Сразу видно «здесь торчит кабель»
- Цвет точки-handle соответствует статусу порта (зелёный up, синий uplink)
- **Compact-режим свитча** тоже получил handles по портам, распределённые по правой стороне (uplink-порт — сверху). Кабели больше не теряют target при переключении display
- Fallback handles `_left`/`_right` теперь полностью прозрачные и не мешают

Теперь на SW_CORE явно видно: `sfp1` (синий ромб) → кабель уходит вверх к магистрали, `eth1` → `POE_SW`, `eth5` → `AP_Restoran` и т.д.

## v0.8.3 — Ещё один фикс React error #185

**Симптом:** после множественного выделения устройств и клика по крестику `✕` (или после массового удаления) — интерфейс исчезал с той же ошибкой Minified React error #185.

**Причина:** React Flow эхом присылал через `onSelectionChange` то самое выделение, которое мы только что через `displayedNodes` ему сами и передали. Пуш нового `Set` в store → пересчёт `displayedNodes` → снова передача в ReactFlow → снова эхо → бесконечный цикл.

**Что сделано:**
- `onSelectionChange` в Canvas теперь **сравнивает с текущим состоянием store** и молча выходит, если состав не изменился
- **Правило "1 выделенное = не multi"**: одиночный клик по устройству больше не сохраняется в `multiSelectedIds` (это уже покрывается обычным `selectedDeviceId`)
- В `MultiSelectBar.bulkDelete` selection **очищается ДО** удаления нод — React Flow не пытается синхронизировать selected-state с уже несуществующими нодами

## v0.8.2 — Порты на кабелях + причёсанная схема «Усадьбы»

Две связанные вещи:

### 🔌 Метки портов прямо на кабеле

Новый тип edge `PortEdge` — стандартный smoothstep + **две маленькие плашки-«pill»** возле каждого конца, показывающие ID порта. Формат компактный:
- `eth5` → `E5`
- `sfp1` → `S1`
- `port12` → `P12`
- прочие как есть, всё заглавными

Плашки не блокируют клик, следуют за кабелем при перетаскивании, наследуют цвет кабеля. Теперь **сразу видно** какая связь из какого порта в какой идёт — не нужно кликать по устройству чтобы это узнать.

### 🎨 Переработанная seed «Усадьбы»

Полностью перерисован seed с нуля:

- **8 логических зон** (групп) с цветами и стартовыми позициями:
  - Серверная · Корпус U2 · Корпус U4 · Ресепшн · Каретная · Ресторан · Кухня · Конференц-зал
  - VPS и провайдеры — за пределами групп, наверху канваса
- **Все 60+ связей** теперь с явными `fromPortId` и `toPortId` — метки портов сразу видны
- **У каждого порта каждого свитча** — осмысленная подпись (кто подключён): `AP_U2_Hall`, `to SW_OPT sfp2`, `Reg_CCTV_U1` и т.д.
- **Магистраль SW_OPT** явно: `sfp1→CORE`, `sfp2→U2`, `sfp3→Kitchen`, `sfp4→KONY`
- **PoE помечен** только там где реально: у AP, камер, PoE-свитчей — молния сразу видна
- **VMs привязаны** к SRV_HYPERV с корректным `hostDeviceId`
- **Устройства грамотно расставлены внутри групп** — свитч слева, оконечные справа/снизу

### Как пользоваться

1. **Reset** в тулбаре чтобы загрузить свежую схему (ваша сохранённая перезапишется — экспортируйте если нужно)
2. Нажмите **📐 Разложить (TB)** — dagre расставит зоны сверху вниз с учётом иерархии
3. Или **⇢ LR** → **📐 Разложить** — то же слева-направо (для широких мониторов)
4. Наведите на любой кабель — видны порты с обоих концов

## v0.8 — 📐 Автолейаут через dagre + улучшенные кабели

Главная боль до этой версии — устройства налезали друг на друга, кабели пересекались, схема нечитаемая. Теперь есть **автоматическая раскладка**.

### 📐 Кнопка «Разложить» в тулбаре

- **📐 Разложить** — запускает [dagre](https://github.com/dagrejs/dagre) (layered graph layout, ~40KB) и раскладывает всё за 100-300 мс
- **⇣ TB / ⇢ LR** — переключатель направления (сверху-вниз или слева-направо). Ваш выбор запоминается в localStorage
- **Ctrl+Z** отменяет — если раскладка не понравилась, вернётесь к прежним координатам
- Учитывает **размеры устройств** (свернутое устройство — 140×100, развёрнутый rack-свитч — до 600×110), поэтому ничего не перекрывается
- **Группы обрабатываются отдельно**: сначала dagre раскладывает содержимое каждой группы (с учётом только её внутренних кабелей), потом группы + одиночные устройства раскладываются на верхнем уровне как суперноды
- VMs внутри развёрнутых серверов пропускаются (они внутри карточки)
- Координаты **snap-ятся к сетке 20px** — совместимо с ручным перетаскиванием
- Границы групп автоматически подгоняются под содержимое + отступы

### ↔ Улучшенные кабели

- Все кабели теперь `smoothstep` с **углами радиуса 12** и **offset 20** — линии красиво огибают углы устройств, стало похоже на печатную плату
- Host-edges (VM ↔ сервер) остались `straight` с пунктиром — визуально отделяют «логические» связи от физических

### Как пользоваться

1. Откройте схему — сейчас у seed-«Усадьбы» устройства налезают друг на друга
2. Нажмите **📐 Разложить** — всё разложится в чёткую иерархию: провайдеры сверху, GW под ними, магистральные свитчи ниже, устройства доступа в самом низу
3. Если хочется другую ориентацию — нажмите **⇣ TB** → он превратится в **⇢ LR** → снова **📐 Разложить**
4. Двиньте что-то мышкой если хочется поправить руками — новые позиции сохраняются
5. Не понравилось — **Ctrl+Z**

## v0.7.3 — Фикс бесконечного ре-рендера (React error #185)

**Симптом:** после v0.7.2 интерфейс на секунду появлялся и тут же падал с `Minified React error #185` (Maximum update depth exceeded) в консоли.

**Причина:** `onSelectionChange` от React Flow вызывался каждый рендер и делал `setMultiSelection(ids)`, которая создавала **новый Set-инстанс** каждый раз — даже если содержимое не менялось. Это триггерило `useMemo` для `displayedNodes`, который менял `nodes`, что триггерило `onSelectionChange` — бесконечный цикл.

**Что сделано:**
- `setMultiSelection` теперь **сравнивает содержимое** и не пишет в стор, если оно не изменилось
- `setHighlight` — аналогично
- `Toolbar.tsx`: `useMemo(() => setHighlight(...))` → `useEffect` (правильный API для сайд-эффектов)

Если у вас .exe версии 0.7.2 с этой ошибкой — просто пересоберите:
```bash
rm -rf dist release
npm run build:win
```

## v0.7.2 — Хотфикс пустого экрана в собранной .exe

**Симптом:** после `npm run build:win` установили `.exe`, запустили — окно есть, но канвас пустой (чёрный).

**Причина:** `vite.config.ts` не задавал `base: './'`. Собранный `index.html` ссылался на `/assets/...` (абсолютные пути), а Electron через `file://` не мог их загрузить — файлы 404 → React не запускался.

**Что сделано:**
- `vite.config.ts` → `base: './'` — все asset-ссылки теперь относительные, работают под `file://`
- **DevTools в prod-режиме**: F12 или Ctrl+Shift+I
- **Автоматическое открытие DevTools**, если рендерер упал (`did-fail-load`) или `#root` пустой через 800 мс — теперь причина сразу видна
- **Safe wrapper** для всех IPC-обработчиков — ошибки не роняют main-процесс, а возвращаются как `{ ok: false, error }`
- **Safe stub для SQLite** — если native-модуль не собрался, приложение всё равно запускается (fallback на localStorage), пишет warning в консоль
- Убран `postinstall` (мог тихо ломать сборку native-модулей); добавлен явный `npm run rebuild-native`

Подробности и типовые ошибки — в `TROUBLESHOOTING.md`.

**Если у вас старая сборка** — просто соберите заново:
```bash
rm -rf dist release
npm run build:win
```

## Что нового в v0.7.1 — Ping-мониторинг · Copy/Paste · Порты в traceroute · F2

### 🩺 Ping-мониторинг («живая» схема)

Работает **только в собранной Electron .exe** (нужен доступ к системному `ping` и Node net; в браузере — только UI-заглушка).

- В **⋯ Настройки** → «🩺 Ping-мониторинг» → тумблер «Включить проверку доступности» + слайдер интервала (5с..5мин, по умолчанию 30с)
- Каждый цикл: параллельно (8 воркеров) пинг всех устройств с валидным IP:
  1. Сперва **ICMP** через системный `ping` (Windows: `ping -n 1 -w 1500`; Unix: `ping -c 1 -W 1`)
  2. Если ICMP недоступен (нет binary/прав) — **fallback на TCP-connect** к типичным портам: 443, 80, 22, 8291, 8080, 8443
- Каждое устройство получает **цветную точку в левом-верхнем углу**:
  - 🟢 up (с glow) — отвечает, тултип показывает RTT в мс
  - 🔴 down — не отвечает
  - 🟡 checking (пульсирует) — сейчас проверяем
- Runtime-статус **не пишется в историю** (не спамит undo-стек) и не персистится в схему
- Cloud-узлы (провайдеры) и VM пропускаются

### 🧭 Порт-в-порт в traceroute

- В баннере пути добавлена кнопка ▼ — раскрывает список хопов
- Каждый хоп: **`SW_CORE  [sfp1] ━━ [sfp1] SW_OPT`** — видно точно какие порты используются
- Синие тэги — id портов, символы кабеля: `━━` оптика, `──` медь, `···` Wi-Fi, `⇢` виртуальный host-link
- Синтетические edges (VM↔host) помечены italic'ом «hosted on»

### 📋 Copy/Paste и F2

- **Ctrl+C / Ctrl+V** — копировать/вставить выбранное устройство (или multi-select). Копия появляется со сдвигом +40,+40, свежий id, суффикс «(копия)»
- **Ctrl+D** — быстрое дублирование в один шаг
- **F2** на выбранном устройстве — переименовать через prompt
- Всё через Undo (Ctrl+Z)

## Что было в v0.7 — Undo/Redo · Multi-select · Traceroute-подсветка

### ↶ / ↷ Undo & Redo

- **Ctrl+Z** / **Ctrl+Y** (или **Ctrl+Shift+Z**) — стандартные горячие клавиши
- Кнопки ↶ ↷ в правой части тулбара с тултипами «шагов в истории: N»
- **Coalescing 400 мс**: серия быстрых изменений (drag узла, ресайз стикера) = 1 шаг истории — Ctrl+Z откатывает всю операцию целиком, а не по 1px
- Глубина истории: 50 шагов
- Работает для **всего** — перемещение, добавление/удаление, редактирование портов, создание стикеров, изменение групп, любые правки

### 🖱 Multi-select и bulk-действия

- **Тяните мышью по фону канваса** → выделяется прямоугольная область; все устройства внутри — в multi-select
- **Ctrl+клик** по устройству — добавить/убрать из выделения
- При выборе 2+ устройств снизу появляется **плавающая полоска действий**:
  - 🏷 **Тег** — добавить один или несколько тегов ко всем сразу
  - 📦 **В группу ▾** — переместить в существующую группу или вынуть наружу (позиции сохраняются)
  - ⚡ **Toggle PoE** — по клику пометить все PoE-релевантные как PoE-питаемые
  - 🗑 **Удалить** — bulk-удаление (обратимо через Ctrl+Z)
  - ✕ — снять выделение

### 🧭 Traceroute — подсветка пути между устройствами

- **Shift+клик** по устройству A → выбирается первый endpoint
- **Shift+клик** по устройству B → строится **кратчайший путь** по кабелям + host-edges (VM↔сервер)
- Устройства и кабели «на пути» — яркие, синие; **всё остальное затемнено** (opacity 0.15-0.25)
- Endpoints подсвечиваются синим glow
- Сверху канваса — баннер: `🧭 GW → CCTV_bar_u1 · 3 хопа · 3 кабеля`
- **Escape** или ✕ в баннере — очистить путь
- **Shift+клик по уже выбранному endpoint** — сбросить
- Использует **BFS** по неориентированному графу (учитывает и обычные `Link`, и виртуальные «hosted on» связи VM↔host)

## Что нового в v0.6 — Встроенный зашифрованный Vault + Bitwarden/CSV импорт

Отказ от «ссылок на Bitwarden» — теперь у приложения свой шифрованный vault.

### 🔐 Vault прямо внутри NetMap

- Новая секция **🔑 Vault** в тулбаре
- **При первом обращении** — просит придумать мастер-пароль (минимум 6 символов). После этого vault инициализируется.
- **AES-256-GCM** для каждой записи, ключ выводится PBKDF2-SHA256 из мастер-пароля (200 000 итераций).
- Дальше vault **разблокирован в текущей сессии** — можно свободно смотреть/менять записи. Кнопка 🔒 в углу — заблокировать.
- Поиск по имени/URL/папке, добавление, редактирование, удаление
- **Показать/скрыть пароль** глазиком, **📋 копировать** имя и пароль, **авто-очистка буфера через 20 секунд** после копирования пароля (best-effort — работает если фокус остаётся у приложения)

### 📥 Импорт из Bitwarden и CSV

- Кнопка **📥 Импорт** в панели vault → выбираете `.json` или `.csv`
- **Bitwarden**: экспортируйте vault как **unencrypted JSON** (`Tools → Export vault → File format: json → без пароля`) → все записи (name, folder, uri, username, password, notes) переезжают в наш vault
- **CSV**: универсальный парсер, поддерживает колонки KeePass/1Password/Bitwarden: `name/title`, `url/uri`, `username/login/email`, `password`, `notes`, `folder/group`
- Импортированные записи автоматически шифруются вашим мастер-паролем

### 🔗 Связка устройство ↔ vault

- В карточке устройства → вкладка **«Доступ»** → селект **«Запись в vault»**
- Пока vault заблокирован — показывается кнопка «🔓 Разблокировать vault»
- Как только выбрана запись — прямо в карточке показывается **имя пользователя и пароль** (скрыты дефолтно) с кнопками копирования и открытия URL
- **Поле `bitwardenUrl`** осталось для обратной совместимости, но не является основным способом

## Что нового в v0.6.1 — SQLite backend + Electron IPC

Приложение переехало с localStorage на **настоящую БД** в Electron.

### 🗄 SQLite в main-процессе

- Native-модуль `better-sqlite3` работает в main-процессе Electron
- База: `%APPDATA%/NetMap/netmap.db` (Windows), `~/.config/NetMap/netmap.db` (Linux), `~/Library/Application Support/NetMap/netmap.db` (macOS)
- WAL-режим для лучшего concurrency и crash-safety
- Схема: `kv` (doc, filters), `templates`, `vault_meta`, `vault_items` (шифрованные записи)
- **Preload-скрипт** с contextIsolation — рендерер общается с БД только через безопасный IPC (`window.netmap.loadDoc()`, `saveDoc()`, `vaultUnlock()` и т.д.)

### ⚡ Автосохранение с debounce

- Изменения в схеме коалесцируются с debounce 400 мс — при drag'е узла сохранение происходит один раз в конце
- Всегда дублируется в localStorage как fallback — если нативная БД слетит, данные не потеряются

### 🌐 Web-preview продолжает работать

- Модуль `persistence.ts` проверяет наличие `window.netmap` (Electron bridge)
- Если моста нет — прозрачно откатывается на localStorage
- **Preview в браузере/песочнице работает без изменений**, а в собранном .exe данные лежат в SQLite

### 🔐 Vault: тот же API — в native и в браузере

- `vaultClient.ts` тоже с двумя реализациями:
  - **Electron**: AES-GCM в Node crypto, ключ в памяти main-процесса, записи в SQLite
  - **Браузер**: AES-GCM через WebCrypto, ключ в памяти рендерера, записи в localStorage
- Один API, одна UX, разные бэкенды под капотом

## Что нового в v0.5.2 — Правый клик по стикеру и порту

### 📌 Меню на стикере

Правый клик на любой заметке-стикере:

- 🎨 **Сменить цвет** — подменю с 4 вариантами (текущий цвет помечен как «сейчас»)
- ⧉ **Дублировать** — создаётся такая же заметка (с текстом) с pop-анимацией
- 🗑️ **Убрать заметку**

Всё то же, что раньше требовало клика по булавке (для удаления) и создания заново (для смены цвета), теперь в одном месте.

### 🔌 Меню на порте

Правый клик по любому порту (точке на устройстве, порту в свитче или в патч-панели):

- ⚙️ **Открыть свойства** (тот же редактор в правой панели)
- **Статус** → подменю с 4 состояниями: 🟢 UP · ⚪ DOWN · ⚫ DISABLED · 🔴 ERROR
- ⚡ **Toggle PoE-active** — включить/выключить питание на порту
- ↑ **Toggle uplink** — пометить/снять флаг магистрального порта
- 🏷 **Задать VLAN** — с валидацией 1..4094; пусто = снять
- 📋 **Копировать "что подключено"** — если у порта есть label
- ✏️ **Переименовать / описание**
- 🗑️ **Удалить порт** — с подсказкой сколько кабелей отвалится

Для быстрой правки больше не нужно открывать правую панель.

## Что было в v0.5.1 — Полировка слоёв: пресеты · сохранение · счётчик

### ⚡ Пресеты в один клик

В верхней части панели **🧅 Слои / фильтры** — сетка из 7 быстрых пресетов:

- 👁 **Всё** — сброс, показать всё
- 🖧 **Data** — только сеть передачи данных (роутеры, свитчи, ПК, серверы, VM, VPS, POS, принтеры)
- 📹 **CCTV** — только видеонаблюдение (камеры + магистраль)
- 📶 **Wi-Fi** — только точки доступа + свитчи
- 🔐 **SALTO** — только замки + магистраль
- ⚡ **PoE only** — только устройства с активным PoE
- ☁️ **Внешнее** — только провайдеры, VPS и роутеры (что «наружу»)

Клик — фильтры мгновенно применяются, схема очищается до нужного среза. **Активный пресет подсвечивается синим** — сразу видно в каком «режиме» вы находитесь. Если ручными галочками сдвинуть фильтры от пресета, подсветка снимается.

### 💾 Фильтры теперь сохраняются

Все выбранные фильтры (типы, кабели, PoE-only, теги, VLAN) пишутся в **localStorage** (`netmap:filters:v1`) и восстанавливаются при перезагрузке. Открыли схему в режиме «только CCTV» — закрыли браузер — вернулись, всё как было.

Reset схемы не трогает фильтры (это отдельный ключ), кнопка ↺ в самой панели их сбрасывает.

### 🔴 Счётчик активных фильтров на иконке 🧅

- Красный бейдж в правом верхнем углу иконки **🧅** в левом тулбаре
- Показывает **число активных измерений** (скрытые типы устройств, скрытые кабели, PoE-only, тег, VLAN — каждое считается за 1)
- Даже когда панель закрыта, вы сразу видите: «схема отфильтрована, там сейчас применены 3 фильтра»
- В тултипе иконки — тоже число: `Слои / фильтры · активно 3`

## Что было в v0.5 — Слои/фильтры · Сворачиваемая правая панель · Стикеры через ПКМ

### 🧅 Слои и фильтры

Новая секция **🧅 Слои / фильтры** в тулбаре. Позволяет быстро отфильтровать канвас:

- **Типы устройств** — чекбоксы с иконкой, названием и **счётчиком** (сколько на схеме). Клик — скрыть/показать. Показываются только те типы, что реально есть.
- **Типы кабелей** — Медь / Оптика / Wi-Fi. Отключаешь оптику — вся магистраль пропадает, видна только медь.
- **⚡ Только PoE-активные** — оставляет только устройства с хотя бы одним `poeActive` портом. Идеально чтобы увидеть где что раздаёт питание.
- **Теги** — чипсы всех использованных тегов. Клик — только устройства с этим тегом (например, `external` → останутся только VPS).
- **VLAN** — если есть VLAN'ы, чипсы `VLAN 10`, `VLAN 20` и т.д. Клик — только устройства/связи в этом VLAN'е.
- **↺ Сбросить N** — счётчик активных фильтров + одна кнопка сброса.

Скрытые устройства не рендерятся; связанные с ними кабели тоже автоматически исчезают. Группы не пропадают (можно продолжать раскладывать).

### 📎 Правая панель сворачивается

Панель свойств справа теперь **сворачивается**:
- Тонкая полоска 24px с стрелкой `‹` / `›` — клик сворачивает/разворачивает
- Синий индикатор появляется на полоске когда есть выделенный объект (даже свёрнутая панель напоминает)
- Даёт больше места канвасу когда просто смотришь схему

### 📌 Стикеры через контекстное меню

- Убраны надоедливые плюсики из углов устройств
- Правый клик по устройству → пункт **«📌 Добавить заметку»** → **подменю с 4 цветами**: жёлтая · зелёная · синяя · розовая
- Всё та же анимация pop-in, всё то же редактирование inplace, всё то же удаление через клик по булавке
- Меню контекста теперь поддерживает **подменю** (нужно для выбора цвета — пригодится дальше)

## Что было в v0.4 — Каталог шаблонов устройств · Ресайз стикеров

### 🔧 Каталог моделей

Новая секция **🔧 Каталог** в тулбаре (справа от секций устройств). Внутри:

- **~25 готовых моделей** для отеля/офиса, разбитых по типам:
  - **Роутеры**: MikroTik RB3011UiAS-RM, RB5009UG+S+IN, Ubiquiti UDM-Pro
  - **Свитчи**: MikroTik CRS328-24P, CRS305, TP-Link TL-SG3428XMP, Cisco WS-CE500-24LC, D-Link DGS-1210-28P, Ubiquiti USW-Pro-24-PoE
  - **AP**: UniFi U6-Pro (Wi-Fi 6), UniFi AC-Lite, MikroTik hAP ac³
  - **Камеры**: Hikvision DS-2CD2143G2-IU (outdoor), G0-I (indoor), Dahua IPC-HDBW1230E
  - **Патч-панели**: Legrand LCS³ 24/48p, Hyperline PP3 shielded, Cabeus 24p
  - **Прочее**: Supermicro 1U Xeon, Epson TM-T88VI (чековый принтер), Атол Sigma (POS)
- **Полный поиск** сверху (по вендору, модели, тегам, описанию): `mikrotik`, `poe`, `24p`, `hikvision`, `10g`
- **Фильтр по типу**: чипсы «все / router / switch / patchpanel / ap / camera / ...»
- Каждая карточка показывает: иконку, вендор + модель, **сводку портов** (например `28p · 24⚡ · 4×SFP`) и первые теги
- **Клик** → устройство создаётся в центре канваса, **drag&drop** — прямо в нужное место (в т.ч. внутрь группы)
- Устройство создаётся с корректными портами: MikroTik CRS328-24P → 24× RJ45 PoE + 4× SFP+ 10G с флагом `uplink`; UniFi U6-Pro → 1× RJ45 PoE-активный; и т.д.

### 💾 Пользовательские шаблоны

- В правой панели любого устройства (вкладка «Инфо», внизу) — кнопка **💾 Сохранить как шаблон**
- Спрашивает вендор и модель, потом сохраняет в **localStorage** (ключ `netmap:templates:v1`) с автоматической конверсией портов в шаблонные группы (`eth1..eth24` → один `TemplatePortGroup` с `count: 24`)
- Свои шаблоны появляются **в самом верху каталога** с бирюзовой меткой **MY**, ищутся и фильтруются наравне с built-in
- Не пропадают при Reset схемы (это отдельное хранилище)

### 📐 Ресайз стикеров

- Наведите на заметку → в правом-нижнем углу появляется **грип-стрелочка**
- Тяните — заметка растёт, минимум 90×60, шаг 2px
- Размер запоминается в модели (`StickyNote.width/height`) и сохраняется в схеме

## Что было в v0.3.4 — Стикеры · Плоские иконки · Сетка · VM внутри хоста · Тулбар VS Code-style

### 📌 Sticky notes на устройствах

- Заметки в виде **настоящих бумажек** с булавкой сверху, слегка помятыми уголками, тенью и лёгким поворотом (−4°…+4°)
- 4 цвета: жёлтый · розовый · синий · зелёный (задаётся при создании, редактируется в меню)
- **Клик на заметку** — редактирование прямо на месте (contentEditable + Ctrl+Enter для сохранения, Esc — откат)
- **Клик по булавке** — снять заметку
- Можно **лепить друг на друга** — стек с небольшим смещением каждого нового листка
- **Анимация появления**: pop scale 0.4 → 1.05 → 1 + rotate из 0 в целевой угол, 380 мс cubic-bezier — как будто прилепили
- В seed уже 3 демо-стикера: на `GW`, `SW_CORE`, `SRV_HYPERV_U`

### 🎯 Плоские иконки — «настоящие» устройства, не блоки

- **Иконка = сама нода**, крупная (44px compact / 52px expanded)
- Подпись под иконкой с тенью, IP-адрес в мини-плашке под именем
- Плашка/рамка появляется только при выделении или в expanded-режиме
- Свитчи/патчи/сервер — сохранили карточку, но с более крупной иконкой в шапке

### 📐 Сетка + прилипание (snap)

- Точки-сетка 20px на фоне (можно отключить)
- **Snap-to-grid** — устройства встают ровно по узлам сетки при перетаскивании
- Тумблеры в новой панели **⋯ Настройки** в тулбаре (нижняя иконка)

### 🖥️ VM внутри хоста (v0.3.4)

- Когда сервер в **compact**-виде — все VM с этим `hostDeviceId` рисуются как **отдельные ноды** на канвасе, связаны с сервером фиолетовой пунктирной линией «hosted on»
- Когда сервер в **expanded**-виде (rack) — те же VM **исчезают** с канваса и появляются **списком внутри карточки сервера**, каждая с иконкой/именем/IP/vCPU/RAM
- Клик по строке VM в списке — VM выбирается в правой панели (для правки)
- Кнопка `⇱` рядом с VM — «выпихнуть» её на канвас (сбросить hostDeviceId, останется свободной нодой)
- В seed: `SRV_HYPERV_U` стартует в rack-виде → сразу увидите Bitwarden, DomainController, FileServer внутри карточки
- Двойной клик по серверу — сложить обратно, все VM снова отдельными нодами со стрелками «hosted on»

### 🧰 Выдвижной тулбар (activity bar в стиле VS Code)

- **Узкая полоска 52px слева** с 6 крупными иконками: 🌐 Сеть · 📱 Оконечные · 💻 Компьютеры · ☁️ Внешнее · 📦 Группа · ⋯ Настройки
- Клик на секцию — **выезжает панель 220px** с крупными кнопками устройств (56×56 с иконкой и подписью)
- Ещё клик по той же секции — панель уезжает обратно
- Анимация плавная (0.22s cubic-bezier)
- В секции **⋯ Настройки** — тумблеры сетки и snap
- Всё то же самое: клик = создать в центре, drag = создать в точке отпускания

## Что нового в v0.3.3 — VM / VPS · Компактная палитра · Right-click меню · Молния PoE

### 🖥️ Виртуальные машины (`vm`) и VPS (`vps`) — новые типы устройств

- **VM** обязательно принадлежит физическому серверу. Выбор хоста — в правой панели (вкладка Инфо → селект «Родительский сервер»). Если хост не указан — на карточке VM появляется предупреждение ⚠. VM всегда связана с хостом пунктирной фиолетовой линией «hosted on».
- **VPS** — арендованный VDS у провайдера. Отдельная нода без обязательного хоста, иконка «облачко + чип».
- **VM-мета в expanded-виде**: vCPU · RAM · OS. Редактируется в правой панели одной строкой.
- В seed «Усадьбы» добавлены 3 VM на `SRV_HYPERV_U` (Bitwarden, Domain Controller, FileServer) и 2 VPS (Selectel Website, Hetzner Mail).

### ⚡ Молния PoE — визуальный тумблер

**На устройстве** (только для PoE-релевантных типов — свитч, AP, камера, принтер, замок):
- В правом верхнем углу карточки появляется полупрозрачная кнопка молнии при наведении
- Клик → жёлтая непрозрачная = устройство помечено как PoE-питаемое/раздающее (проставляет `poe: true` всем портам)
- Ещё клик → серая полупрозрачная = снят флаг PoE

**На отдельном порту** (rack-view свитча + порты-точки на устройствах):
- В тултипе порта — та же кнопка молнии
- Переключает `poeActive` конкретного порта (⚡ виден на порту, если активно)

### 🖱️ Right-click контекстное меню

Правый клик по устройству/группе → меню с самым частым:

**Устройство:**
- ⚙️ Открыть свойства · ◱ Свернуть/Развернуть
- ✏️ Переименовать · ⧉ Дублировать (со всеми портами и учёткой)
- ⚡ Пометить как PoE
- 📋 Копировать IP · 📋 Копировать имя
- ↗ Открыть mgmt URL · 🔐 Открыть в Bitwarden
- 🗑️ Удалить (с подсказкой, сколько кабелей отвалится)

**Группа:**
- ▶/▼ Свернуть/развернуть · ✏️ Переименовать
- 🗑️ Удалить (устройства останутся) / 💥 Удалить с содержимым

### 🎨 Ещё более компактная палитра

- Ширина уменьшена с 88px до **56px** — больше места канвасу
- Кнопки квадратные 40×40 с мелкой подписью, hover подсвечивает цвет типа устройства
- Секции с разделителями: `СЕТЬ / ОКОНЕЧНЫЕ / КОМПЬЮТЕРЫ / ВНЕШНЕЕ / ГРУППА`
- Cloud переименован в **«Провайдер»** (ISP) как вы просили
- Добавлены **VM** и **VPS** в секцию «Компьютеры»

## Что нового в v0.3.2 — Compact/Expanded + Палитра + Горизонтальная патч-панель

### 🖱️ Двойной клик = свернуть/развернуть

Все устройства теперь имеют **два режима отображения** (сохраняется в `device.display`):

- **Compact** (по умолчанию для всех новых устройств) — компактная плашка с иконкой, именем, IP и мини-полоской статуса портов (либо цветные полоски по портам, либо сводка `18↑ 6↓ 8⚡` для >4 портов). Порты скрыты, но кабели всё равно можно тянуть — используются невидимые handles на всех 4 сторонах.
- **Expanded/Rack** — полный вид: свитч в rack-раскладке, патч-панель в горизонтальном виде, остальные устройства с портами по периметру.

**Двойной клик** по устройству — переключить. Или кнопка `◲` в углу.

### 🎨 Палитра слева

Заменил кашу из иконок в верхнем тулбаре на **левую вертикальную палитру** (как в draw.io/Figma):

- Секции: **Сеть** (роутер/свитч/патч) · **Оконечные** (AP/камера/принтер/замок) · **Компьютеры** (ПК/сервер/POS) · **Прочее** (облако) · **Группа**
- Каждая кнопка — крупная (68px), с иконкой и подписью, hover-подсветкой цвета типа устройства
- **Клик** — создать в центре · **Drag&drop** — тащишь на канвас, устройство создаётся точно в точке отпускания
- Если бросить внутрь развёрнутой группы — устройство автоматически прилипает к ней

### ▦ Горизонтальная патч-панель

Как настоящая 1U-планка в стойке:

- Все 24 порта в **один горизонтальный ряд**, сгруппированы по 6 (как физически на панели)
- **Мини-KJ (keystone)-визуализация**: цветные полоски внутри каждого порта имитируют пины 8P8C
- Номер порта над каждым разъёмом, слева — метка панели с моделью и локацией
- Порты «сквозные»: сверху front, снизу back — оба handle с одним `portId`, кабель можно тянуть с любой стороны
- Кнопка `◲` в правом углу — свернуть; двойной клик — тоже

### ⌨️ Клавиатура

- **Delete / Backspace** на выбранном устройстве — удалить
- **Delete** на группе — удалить группу (устройства выпадут наружу)
- Всё это работает только когда фокус НЕ в поле ввода

### 🔎 Верхний тулбар очищен

Осталось только самое нужное:
- Название схемы слева
- **Крупный поиск** (360px) с автодополнением
- Кнопки **Импорт / Экспорт / Reset** справа с чёткими подписями

## Что было в v0.3.1 — Порты на всех устройствах + Патч-панели ▦

- **Новый тип устройства `patchpanel`** — пассивная патч-панель для документирования кабельной инфраструктуры (розетка → патч-порт → свитч).
  - Компактный вид: маленькая иконка + точки-порты по обеим сторонам (front/back)
  - Развёрнутый вид (▲/▼): полный список портов с подписями розеток
  - Каждый порт «сквозной»: слева видимая сторона (front), справа back — обе стороны имеют handle с одним и тем же `portId`
- **Все устройства теперь с портами**, не только свитчи:
  - AP → порт сверху (кабель уходит в потолок)
  - Камера → порт справа
  - Принтер / POS / Cloud → снизу
  - ПК / Сервер / Замок → справа
  - Точки-порты подсвечиваются на hover, кабель тянется от конкретной точки, а не от «центра иконки»
- **Минималистичные SVG-иконки** заменили эмодзи: роутер с антеннами и LED, свитч с портами, dome-камера, серверная стойка 2U, ПК-моноблок, кассовый терминал, принтер, замок, облако, патч-панель. Все монохромные, читаемые на любом зуме, цвет соответствует типу устройства.
- **Кабели теперь ортогональные** (`smoothstep`) — красивые прямые углы вместо путаных кривых.
- **Подписи связей** на тёмном фоне для читаемости поверх кабелей.
- **Патч-панели добавлены в seed «Усадьбы»**: `PP_U2` (24p Legrand в стойке U2) и `PP_Restoran` (24p Hyperline в ресторане) с реальными подписями розеток.

## Что нового в v0.3 — Rack-view портов 🔌

Свитчи и роутеры теперь можно **разворачивать в rack-панель** с реальными портами:

- **◱ в заголовке** свитча — переключение compact ⇄ rack
- Порты нарисованы как настоящая железка: два ряда сверху/снизу (чётные/нечётные), группировка по 4
- **SFP-порты** выделены отдельным блоком справа, повёрнуты ромбом
- **Цвет порта** = статус:
  - 🟢 зелёный — up (есть link)
  - ⚫ серый — down (свободен)
  - 🔵 синий — uplink up
  - 🔴 красный — error
  - маленькая `P` внутри = PoE активно ⚡
  - `↑` внутри = uplink
- **Наведи на порт** — тултип: тип, скорость, что подключено, VLAN, PoE, статус
- **Клик по порту** — правая панель открывается сразу на редакторе этого порта:
  - тип (RJ45/SFP/SFP+/Combo/WiFi/Console), скорость (100M/1G/2.5G/10G)
  - статус, VLAN, PoE / PoE-активность, uplink-флаг
  - список кабелей, которые сейчас висят на этом порту
  - заметки
- **Кабели цепляются к конкретным портам** — тащишь от порта одного свитча к порту другого, `Link.fromPortId/toPortId` заполняется автоматически
- **Компактная сводка** в заголовке: `18↑ 6↓ 8⚡` — сколько портов активно/свободно/раздают PoE
- В списке портов (вкладка «Порты» без выделения) — быстрое сканирование: 🟢/⚫ индикатор, подпись, значки uplink/PoE/кабель

### Магистральные свитчи в seed «Усадьбы» уже настроены с rack-view

- **SW_OPT** — MikroTik CRS305-1G-4S+ (1 медь + 4×SFP+ 10G)
- **SW_CORE** — TP-Link TL-SG3428XMP (24×PoE + 4×SFP+, часть портов подписаны и в статусе up)
- **SW_U2** — Cisco WS-CE500-24LC (24 медных + 1 SFP uplink, 8 AP на PoE)

Остальные свитчи по умолчанию в compact-режиме — разверните их по вкусу.

## Что нового в v0.2

- 📦 **Группы/контейнеры** — прямоугольные рамки с заголовком и цветом. Перетащите устройство мышкой внутрь — оно **прилипнет** к группе и будет двигаться с ней вместе.
- ▶/▼ **Сворачивание группы** одним кликом на треугольник в заголовке. Все её устройства и внутренние связи скрываются, а связи «наружу» перебрасываются на саму группу — схема мгновенно упрощается.
- 🎨 **Цвета групп** (9 пресетов) в правой панели — визуально отделяйте зоны: Серверная / Ресторан / U2 / Каретная и т.д.
- 🔍 **Список содержимого** группы в правой панели + кнопка «вынуть» (⇱) устройство наружу.
- ↺ Кнопка **Reset** сбрасывает схему к seed-у «Усадьбы» — удобно если экспериментировали.

### Как пользоваться группами

1. Тулбар → нажмите зелёную 📦 → появится «Новая группа» в центре
2. Тащите её за заголовок в нужное место, растяните размеры в правой панели
3. Тащите обычные устройства мышкой на территорию группы — они автоматически привяжутся
4. Клик на группу → правая панель: имя, цвет, размер, свернуть, список детей
5. Двойной клик на треугольнике ▼ в заголовке → группа схлопывается в одну плашку

## Что уже работает (MVP)

- 🗺️ Интерактивный canvas: drag&drop устройств, панорамирование, зум, миникарта
- 🔎 Мгновенный поиск по **IP / MAC / имени / модели / локации / тегам** — совпадения подсвечиваются жёлтым прямо на схеме
- 🖱️ Клик по устройству → правая панель с полной карточкой:
  - **Инфо**: IP, MAC, вендор, модель, локация, URL веб-интерфейса (кнопка «Открыть»)
  - **Порты**: список портов + к чему подключён каждый + скорость/PoE
  - **Связи**: все соседи с указанием портов с обеих сторон, ссылка «удалить»
  - **Доступ**: имя пользователя + ссылка на запись в **вашем локальном Bitwarden** (пароль в приложении НЕ хранится)
- ➕ Кнопки добавления устройств всех типов (роутер, свитч, AP, камера, сервер, ПК, POS, принтер)
- 🖇️ Рисование связей: тащите от порта одного узла к порту другого; двойной клик по связи — удалить
- 💾 Автосохранение в `localStorage`; экспорт/импорт всей схемы в JSON
- 🎨 Разные стили линий: медь (жёлтая), оптика (синяя, анимированная), Wi-Fi (пунктир)
- 📦 Уже загружены все устройства из вашей схемы «Усадьба» (GW, SW_OPT, SW_CORE, все AP, CCTV, POS и т.д.)

## Запуск

```bash
cd netmap
npm install
npm run dev              # только веб-часть (http://localhost:5173)
npm run electron:dev     # веб + Electron-окно
npm run build:win        # собрать Windows-установщик .exe (NSIS + portable)
```

Готовые артефакты появятся в `dist/` (веб-бандл) и `release/` (Windows-инсталлятор).

## Интеграция с Bitwarden

В карточке устройства → вкладка «Доступ»:

- **Имя пользователя** — храним локально, копируется одним кликом
- **Bitwarden Item ID** (UUID записи) и **Ссылка на Bitwarden** — при клике по «Открыть 🔑» откроется ваш локальный vault (`https://vault.local/#/vault?itemId=...`) в браузере, и вы уже там разлогинитесь/скопируете пароль

Пароли в SQLite/JSON приложения **не пишутся** — только ссылка. Это соответствует вашей политике: приложение — карта, Bitwarden — источник истины по секретам.

## Что дальше (следующие итерации)

1. **SQLite бэкенд** через `better-sqlite3` вместо localStorage — уже добавлен в зависимости, нужен слой миграций
2. **Импорт из DHCP** — парсер ISC/MikroTik/Windows DHCP lease-файлов, привяжет IP к устройствам
3. **LLDP/CDP scan** — автоматически подтянуть реальные подключения между свитчами
4. **Bitwarden CLI** — вместо «открыть в браузере» вытаскивать пароль в буфер обмена через `bw get password <uuid>` (запрашивает master password только один раз за сессию)
5. **Ping-monitor** — цвет узла = живой/мёртвый
6. **Многопользовательский режим** — если понадобится, вынесем store в REST-сервис на той же Ubuntu-виртуалке рядом с Bitwarden

## Структура проекта

```
netmap/
  electron/main.cjs       # entry point для Electron (packaged .exe)
  src/
    types.ts              # модели: Device, Port, Link, Credential
    seed.ts               # предзагруженные устройства «Усадьбы»
    store.ts              # zustand + persist в localStorage
    Canvas.tsx            # React Flow схема
    DeviceNode.tsx        # кастомный узел (иконка + IP + локация)
    DevicePanel.tsx       # правая панель со вкладками
    Toolbar.tsx           # верхняя панель + поиск + импорт/экспорт
    App.tsx / main.tsx    # композиция
```
