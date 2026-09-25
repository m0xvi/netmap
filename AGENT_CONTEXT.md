# NetMap — контекст для агента (session handoff)

> Живой документ для передачи проекта между агентскими сессиями.
> Обновляй его в конце каждой значимой сессии: версия, HEAD, что сделано, что отложено.
> Вечные правила — в `HANDOFF.md` (§0.1 сборка, §2 критические правила). Этот файл — про *текущее состояние*.

## 1. Снимок состояния

| Поле | Значение (на 2026-09-25) |
|---|---|
| Проект | NetMap — desktop-приложение (Windows) для интерактивной схемы сети сисадмина. Замена статичным схемам Visio/draw.io |
| Стек | Electron + React 18 + Vite + XYFlow (`@xyflow/react`) + Zustand + dagre. Main-процесс — CommonJS (`electron/*.cjs`) |
| Ветка | `arena/01a0ced4-netmap` (+22 коммита поверх `main`; `main` заморожен на `ad8ced0`) |
| HEAD | `4467e13` |
| Версия | `0.62.2` (package.json), дерево чистое, тег `v0.62.2` запушен |
| Релиз | v0.62.2 собран в CI (release.yml, windows-latest), артефакты на месте: `NetMap-Setup-0.62.2.exe`, `NetMap-Portable-0.62.2.exe`, `latest.yml` |
| CI | `ci.yml` — проверка на каждый push; `release.yml` — сборка `.exe` **только по git-тегу** `v*` (вручную `.exe` НЕ собирать, см. HANDOFF.md §0.1) |

## 2. Где остановились

Последняя завершённая работа — **v0.62.2 «тихая фоновая проверка обновлений»**:
пользователь поймал красную плашку `net::ERR_TIMED_OUT` на старте (автопроверка обновлений не дотянулась
до GitHub). Теперь main-процесс помечает происхождение проверки (`origin: auto|manual`,
`electron/updater.cjs`), а `UpdateBanner` молча глотает *сетевые* ошибки фоновой проверки.
Плашка осталась для ручной проверки из меню и не-сетевых ошибок (404/403/конфиг).
Плюс распознавание Chromium-ошибок сети (`ERR_TIMED_OUT`, `ERR_INTERNET_DISCONNECTED` и др.).

Что было прямо перед этим (свежий код, который надо знать):
- **v0.62.0** — `src/DialogTheme.tsx`: единая тема всех модальных окон по шаблону
  «Автообнаружения топологии» (каркас `DialogShell`, кнопки, контролы, zIndex 9500/99900/100000).
  На неё переведены 10 диалогов + примитивы `Modal.tsx`. Само окно discovery не тронуто (эталон).
- **v0.61.0/0.61.1** — `src/ToolsStrip.tsx`: горизонтальная draw.io-панель инструментов под тулбаром
  (17 кнопок, сворачивание с персистом). Легенда подсетей переехала вправо-влево (было наложение на FAB).
- **v0.60.0** — связи красятся по подсетям (/24) + `SubnetLegend`, пилюли-ориентиры всем хабам.

## 3. Открытые задачи и вопросы

1. **Макеты основного окна/карты (`map-variants.html`) — ГЛАВНАЯ ОТЛОЖЕННАЯ ЗАДАЧА.**
   Пользователь готовил варианты макета и просил проанализировать: какой лучше выглядит,
   удобнее и быстрее/оптимизированнее. Файл **не дошёл до песочницы** (каталога uploads не было).
   Следующий агент: попросить пользователя прикрепить файл заново, затем сделать разбор.
2. **FAB vs ToolsStrip.** Синий круг `LayoutFAB` дублирует кнопки новой панели инструментов.
   Пользователю предложено убрать FAB в одной из следующих версий — решения пока нет, не удалять самому.
3. **Кнопка «Умная раскладка» на полосе** делает только гибрид; остальные стратегии — в FAB.
   Если пользователь попросит — добавить выбор стратегии на полосу.
4. `main` отстал на 22 коммита (заморожен на `ad8ced0`). Сливать в `main` только по явной просьбе пользователя.

## 4. Карта репозитория (что где)

```
src/
  App.tsx, main.tsx            каркас окна: MenuBar → Toolbar → ToolsStrip → [sidebar|Canvas|right]
  store.ts                     zustand-стор: документ, история undo/redo, UI-флаги (персист в LS)
  Canvas.tsx                   карта (XYFlow): ноды, связи, легенды, пилюли, declutter
  Toolbar.tsx / MenuBar.tsx / FileMenu.tsx   верхняя оболочка и меню (File/View/Tools/Monitor/Help)
  ToolsStrip.tsx               draw.io-панель инструментов (v0.61.0+)
  LayoutFAB.tsx                синий круг-раскладка (фан-меню; кандидат на удаление, см. §3)
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
  `vite build` → commit → push в `arena/01a0ced4-netmap` → тег `vX.Y.Z` → push тега → `gh run watch`.
- **Зависимости в песочнице:** `npm ci --ignore-scripts` (обычный `npm ci` падает на
  `better-sqlite3`/node-gyp: sandbox без тулчейна и с обрезанной сетью). Для tsc/vite этого хватает.
- **UI-правила:** никаких `alert()/confirm()/prompt()` (только `Modal.tsx`); никаких эмодзи/
  экзотики в UI (только SVG); `base: './'`; стабильные референсы селекторов; `safeFinite()` для координат.
- **Отвечать пользователю по-русски.** Каждый релиз — запись в историю версий README.md.
- Новые диалоги/окна — только через `DialogShell` из `DialogTheme.tsx` (единый стиль, §2).

## 6. Грабли песочницы (прочитай, иначе потеряешь время)

1. **Снапшоты сбрасывают git:** HEAD может откатиться на `ad8ced0`, ветки/теги пропасть из локального
   клона, `node_modules` — вытираться (не персистится). Первое действие в сессии:
   `git log --oneline -2 && git status --short`. Если HEAD не тот — `git fetch origin
   '+refs/heads/arena/*:refs/remotes/origin/arena/*' '+refs/tags/*:refs/tags/*'`, сверить дерево
   с `origin/arena/01a0ced4-netmap` и только потом чинить (`reset --hard` — лишь убедившись,
   что рабочее дерево совпадает с remote).
2. **НЕ батчить несколько правок одного файла** в один параллельный блок — правки гоняются
   (v0.61.1: потерялся тег `<ToolsStrip />`, релиз вышел без панели). Один файл — одна правка за раз;
   после правок проверять результат чтением/grep, а не верить «success».
3. `gh run cancel` возвращает 403 — протухшие CI-раны не отменить; проверять провенанс артефактов
   по штампам времени (`gh run view` vs `gh release view --json assets`), а не перезапускать.
4. Удаление git-тега не останавливает уже стартовавший релизный ран; публикация релиза
   перезаписывает ассеты — побеждает поздний ран.
5. При backup/restore файлов маской `*.tsx` не забыть `store.ts` (`.ts`) — копировать явно.
6. `/tmp` и `node_modules` не персистятся между сессиями. jsdom-стенд для runtime-проверки диалогов
   (v0.62.1, 50 тестов) жил в `/tmp/dlgtest` и **не сохранился** — при нужде пересоздать по рецепту:
   `esbuild harness.tsx --bundle --platform=node --format=cjs --jsx=automatic
   --loader:.css=empty --external:jsdom`, `NODE_PATH=<repo>/node_modules`, в конце обязательно
   `window.close()` + `process.exit`, иначе Node висит.

## 7. Быстрая проверка после правок

```bash
ls node_modules/.bin/tsc >/dev/null 2>&1 || npm ci --ignore-scripts
./node_modules/.bin/tsc --noEmit && npm run build
```

## 8. История этого файла

- 2026-09-25: создан при передаче проекта между сессиями (v0.62.2, HEAD `4467e13`).
