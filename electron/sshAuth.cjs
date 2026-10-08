/**
 * v0.76 — единая сборка SSH-аутентификации для ssh2 (ключ или пароль).
 *
 * Приоритет: приватный ключ (PEM-текст `privateKey` или файл
 * `privateKeyPath`) → иначе пароль. Passphrase для зашифрованного ключа —
 * `passphrase`/`sshPassphrase`. Чистая часть (без чтения файла) вынесена
 * для юнит-проверок.
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

module.exports = { sshAuthFragment, sshAuthFragmentFromKey };
