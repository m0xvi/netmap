# Устранение проблем

## Ошибка `node-gyp failed to rebuild 'cpu-features'` / `Could not find any Visual Studio installation`

**Симптомы:** при `npm run build:win` или `npm run publish:win` ломается на этапе `@electron/rebuild` с сообщением о `cpu-features` и требованием Visual Studio Build Tools.

**Причина:** `cpu-features` — это нативный C++ модуль, необязательная зависимость `ssh2`, которую он использует только для авто-выбора шифра. Без него ssh2 работает нормально, просто чуть медленнее.

**Исправлено в v0.39.2** — добавлен скрипт `scripts/strip-cpu-features.cjs`, который удаляет `node_modules/cpu-features` автоматически:
- после каждого `npm install` (через `postinstall` hook)
- перед каждым `build:win / publish:win` (на всякий случай)

**Если всё равно падает** (например использовали `npm install --ignore-scripts`):

```powershell
# Удалить вручную
rmdir /s /q node_modules\cpu-features
rmdir /s /q node_modules\nan

# Пересобрать
npm run build:win
```

**Альтернатива** — поставить Visual Studio Build Tools (~5 GB, только если реально нужна оптимизация шифра для сотен SSH-подключений):

```powershell
# Установить через Visual Studio Installer:
# "Desktop development with C++" workload
```

## Ошибка при `npm run build:win`: EBUSY: resource busy or locked, 'NetMap.exe'

Windows не даёт перезаписать `NetMap.exe` — он **запущен** или его держит антивирус/проводник.

**Решение:**

```powershell
# Закрыть запущенное приложение
taskkill /F /IM NetMap.exe

# Удалить старую сборку
rmdir /s /q dist release

# Пересобрать
npm run build:win
```

Если `rmdir` ругается — виновник:
- **Explorer** с открытой папкой `dist\win-unpacked` — закройте окно
- **Антивирус** сканирует новый exe — подождите 10-30 секунд
- **Windows Defender** блокирует неподписанный exe — добавьте папку проекта в исключения

## Warning про размер бандла и dynamic import

**Исправлено в v0.8.1** — теперь бандл разбит на чанки:
- `react-vendor` — React
- `reactflow` — граф-редактор
- `dagre` — автолейаут
- `index` — код приложения

vaultClient больше не импортируется одновременно статически и динамически.

## Пустой (чёрный) экран после запуска

**Причина в 99% случаев** — `vite.config.ts` без `base: './'`. В собранном `dist/index.html` пути к JS/CSS становились абсолютными (`/assets/...`), и Electron не мог их загрузить через `file://` — потому что абсолютные пути ведут в корень диска.

**С v0.7.2 это исправлено.** Если у вас старая сборка:

1. Пересоберите проект целиком:
   ```bash
   rm -rf dist release
   npm run build
   npm run build:win
   ```
2. Запустите новый `.exe` из `release/`.

## Как открыть DevTools в .exe

В новом main.cjs:
- **F12** или **Ctrl+Shift+I** — переключить DevTools
- DevTools **открываются автоматически**, если рендерер упал (`did-fail-load`) или если `#root` остался пустым дольше 800 мс

Смотрите вкладку **Console** — там будет причина.

## Ошибки better-sqlite3 (native-модуль)

Если в DevTools или в консоли main-процесса видите что-то про `NODE_MODULE_VERSION mismatch` или `Cannot find module '.../better_sqlite3.node'`:

- Перестройте нативный модуль под текущую версию Electron:
  ```bash
  npm run rebuild-native
  ```
  (эквивалент `npx electron-builder install-app-deps`)

- На Windows для сборки native-модулей нужны:
  - **Node.js 18+**
  - **Python 3.x**
  - **Visual Studio Build Tools** с C++ workload
    (`winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools"`)

Приложение **всё равно запустится** без SQLite — оно автоматически откатится на localStorage. Просто в консоли будет warning `SQLite backend unavailable`.

## Сборка .exe — не забудьте про native-модуль

`npm run build:win` вызывает `vite build` → `electron-builder --win`. Electron-builder сам вызовет `install-app-deps` для нативных модулей во время упаковки.

Если получается `.exe`, но при запуске всё равно ошибки с sqlite — запустите вручную:

```bash
npm run rebuild-native
npm run build:win
```

## Как проверить, что всё работает

1. **Схема "Усадьбы" видна** — если да, значит React стартовал корректно
2. **В левом тулбаре 5+ иконок** — секции, каталог, слои, vault, настройки
3. **В настройках Vault** есть предложение придумать мастер-пароль — значит IPC-мост работает
4. **Если Vault открылся, но статус пишет "не удалось"** — SQLite не собрался, работает fallback (это нормально для preview)

## Логи main-процесса

Собранный `.exe` пишет `console.log` в реальный терминал только при запуске через cmd:

```powershell
"C:\Program Files\NetMap\NetMap.exe" --enable-logging
```

Или portable-версию:
```powershell
.\release\NetMap-0.7.2-portable.exe --enable-logging
```
