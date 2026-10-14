/**
 * v0.76 — единая сборка SSH-аутентификации для ssh2 (ключ или пароль).
 *
 * sshAuthFragment — одна попытка (ключ в приоритете, иначе пароль).
 * sshAuthAttempts (v0.92.0) — список попыток: ключ, затем пароль как запасной
 * вариант. Passphrase для зашифрованного ключа — `passphrase`/`sshPassphrase`.
 * Чистая часть (без чтения файла) вынесена для юнит-проверок.
 */

const fs = require('node:fs');

/** Чистая функция: что передать ssh2, если ключ уже в payload. */
function sshAuthFragmentFromKey(cfg) {
  const passphrase = cfg.passphrase || cfg.sshPassphrase || undefined;
  return { privateKey: cfg.privateKey, passphrase };
}

/** Полная сборка: читает файл ключа, если задан путь. {password}|{privateKey,passphrase}. */
function sshAuthFragment(cfg = {}) {
  if (cfg.privateKey) return sshAuthFragmentFromKey(cfg);
  if (cfg.privateKeyPath) {
    const pem = fs.readFileSync(cfg.privateKeyPath, 'utf8');
    return { privateKey: pem, passphrase: cfg.passphrase || cfg.sshPassphrase || undefined };
  }
  return { password: cfg.password || undefined };
}

/** Ошибка похожа на отказ в аутентификации (а не на сетевую проблему)? */
function isAuthError(e) {
  if (!e) return false;
  if (e.level === 'client-authentication' || e.level === 'client-timeout') return true;
  const m = String(e.message || e);
  // v0.95.0: RouterOS при непринятой подписи не отвечает отказом, а молчит до
  // своего auth timeout — клиент умирает по «Timed out while waiting for
  // handshake». Для ключевой попытки это такой же провал, как и отказ:
  // иначе пароль-запасной так и не пробовался, и весь SSH-сбор был пустым.
  return /authentication methods failed|permission denied|cannot parse privatekey|unsupported key format|bad passphrase|unable to decode|signing.*failed|timed out while waiting for handshake/i.test(m);
}

/**
 * v0.92.0: ordered auth attempts — key first, then password fallback.
 * Раньше был строгий XOR: задан ключ → пароль даже не пробовался, и если
 * устройство ключ не приняло (не тот пользователь, размер ключа не поддержал
 * стек RouterOS и т.п.), вход умирал при живом пароле.
 * @returns {Array<{kind:'key'|'password', auth:object}>}
 */
function sshAuthAttempts(cfg = {}) {
  const attempts = [];
  let keyFrag = null;
  if (cfg.privateKey) keyFrag = sshAuthFragmentFromKey(cfg);
  else if (cfg.privateKeyPath) {
    const pem = fs.readFileSync(cfg.privateKeyPath, 'utf8');
    keyFrag = { privateKey: pem, passphrase: cfg.passphrase || cfg.sshPassphrase || undefined };
  }
  if (keyFrag) attempts.push({ kind: 'key', auth: keyFrag });
  if (cfg.password) attempts.push({ kind: 'password', auth: { password: cfg.password } });
  if (!attempts.length) attempts.push({ kind: 'password', auth: { password: undefined } });
  return attempts;
}

module.exports = { sshAuthFragment, sshAuthFragmentFromKey, sshAuthAttempts, isAuthError };
