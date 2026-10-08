/**
 * v0.75 — WinBox launcher (MikroTik).
 *
 * Запускает winbox.exe с позиционными аргументами, описанными в
 * документации MikroTik (WinBox и WinBox v4):
 *
 *   winbox.exe [<connect-to> [<login> [<password>]]]
 *
 * Пароль передаётся только вместе с логином; если логин есть, а пароля
 * нет — ставим "" (пример из документации: `winbox.exe 10.5.101.1 admin ""`).
 * Путь к winbox.exe пользователь задаёт сам (сохраняется в localStorage
 * рендера и приезжает в payload); на ENOENT рендер предлагает ввести путь.
 *
 * IPC: netmap:winboxLaunch { path, ip, login?, password? } → { ok, error? }
 */

const pathMod = require('node:path');
const { spawn } = require('node:child_process');

/** Чистая функция — собрана отдельно для юнит-проверок. */
function buildWinboxArgs(ip, login, password) {
  const args = [String(ip || '')];
  if (login) {
    args.push(String(login));
    args.push(password ? String(password) : '');
  }
  return args;
}

function launch(cfg) {
  return new Promise((resolve) => {
    const p = cfg.path || '';
    const ip = cfg.ip || '';
    if (!ip) return resolve({ ok: false, error: 'ip required' });
    const exe = p || 'winbox.exe';
    const args = buildWinboxArgs(ip, cfg.login, cfg.password);
    // БАГ (v0.75.0): раньше resolve({ok:true}) шёл синхронно сразу после
    // spawn(), до события 'error' — ENOENT терялся, и рендер не мог
    // предложить указать путь. Теперь ждём либо 'spawn', либо 'error'.
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let child;
    try {
      child = spawn(exe, args, {
        detached: true,
        stdio: 'ignore',
        // winbox.exe обычно лежит вне PATH — даём пользователю указать путь;
        // если указан каталог, cwd туда же (relative-файлы winbox рядом).
        cwd: pathMod.dirname(exe) && pathMod.dirname(exe) !== '.' ? pathMod.dirname(exe) : undefined,
      });
    } catch (e) {
      return done({ ok: false, error: String(e && e.message || e) });
    }
    child.once('error', (e) => done({ ok: false, error: String(e && e.message || e) }));
    child.once('spawn', () => {
      child.unref();
      done({ ok: true });
    });
  });
}

module.exports = { launch, buildWinboxArgs };
