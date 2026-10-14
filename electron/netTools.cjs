/**
 * v0.90.0 — сетевые утилиты для окон NetMap (main-процесс):
 *   • SSH-ключ для этого ПК: пара ключей в формате OpenSSH (RSA или ed25519);
 *   • сохранение текстового файла через системный диалог «Сохранить как»;
 *   • SNMP walk / проверка связи / подбор SNMPv3 поверх electron/snmp.cjs.
 *
 * Ничего не пишет в документ и не передаёт данные наружу: ключ и SNMP-пароли
 * живут только в аргументах вызова и в окне, которое их запросило.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// ---------------------------------------------------------------------------
// SSH-ключ (формат OpenSSH: RSA или ed25519)
// ---------------------------------------------------------------------------

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

/** SSH-строка: uint32 длина + байты (RFC 4251). */
function sshString(buf) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8');
  return Buffer.concat([u32(data.length), data]);
}

/** mpint (RFC 4251): без лишних старших нулей; перед числом со старшим битом 1 — 0x00. */
function mpint(buf) {
  let b = Buffer.from(buf);
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  b = b.subarray(i);
  if (b.length === 0) b = Buffer.from([0]);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return sshString(b);
}

/**
 * Комментарий ключа — только латиница, цифры и . _ @ - (до 64 знаков).
 * Кириллица и пробелы в комментарии могут сломать импорт на RouterOS, поэтому убираем.
 */
function cleanComment(raw) {
  const s = String(raw || '').replace(/[^A-Za-z0-9._@-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return s || 'netmap';
}

/** Собирает файл openssh-key-v1 без шифрования из полей приватной секции. */
function assembleOpenSsh(pubBlob, privFields, comment) {
  const check = crypto.randomBytes(4);
  let priv = Buffer.concat([check, check, ...privFields, sshString(Buffer.from(comment, 'utf8'))]);
  const padLen = (8 - (priv.length % 8)) % 8;
  const pad = Buffer.alloc(padLen);
  for (let i = 0; i < padLen; i++) pad[i] = i + 1;
  priv = Buffer.concat([priv, pad]);
  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'binary'),
    sshString('none'),
    sshString('none'),
    sshString(''),
    u32(1),
    sshString(pubBlob),
    sshString(priv),
  ]);
  const b64 = body.toString('base64').match(/.{1,70}/g).join('\n');
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

function fingerprintOf(pubBlob) {
  return 'SHA256:' + crypto.createHash('sha256').update(pubBlob).digest('base64').replace(/=+$/, '');
}

/** Пара ed25519. RouterOS понимает такие ключи только с версии 7.12. */
function generateEd25519Pair(comment) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  // SPKI DER для ed25519: 12 байт префикса + 32 байта публичного ключа.
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const pub = spki.subarray(spki.length - 32);
  // PKCS#8 DER для ed25519: 16 байт префикса + 32 байта seed.
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  const seed = pkcs8.subarray(pkcs8.length - 32);
  const keyType = Buffer.from('ssh-ed25519');
  const pubBlob = Buffer.concat([sshString(keyType), sshString(pub)]);
  const privatePem = assembleOpenSsh(pubBlob, [
    sshString(keyType), sshString(pub), sshString(Buffer.concat([seed, pub])),
  ], comment);
  return {
    privatePem,
    publicLine: `ssh-ed25519 ${pubBlob.toString('base64')} ${comment}`,
    fingerprint: fingerprintOf(pubBlob),
  };
}

/**
 * Пара RSA (ssh-rsa). RouterOS импортирует такие ключи на любой версии,
 * поэтому это вариант по умолчанию для MikroTik.
 */
function generateRsaPair(comment, bits = 3072) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: bits });
  const jwk = privateKey.export({ format: 'jwk' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const b = (x) => Buffer.from(x, 'base64url');
  const n = b(pubJwk.n);
  const e = b(pubJwk.e);
  const pubBlob = Buffer.concat([sshString('ssh-rsa'), mpint(e), mpint(n)]);
  // Порядок полей приватной секции ssh-rsa: n, e, d, iqmp, p, q.
  const privatePem = assembleOpenSsh(pubBlob, [
    sshString('ssh-rsa'), mpint(n), mpint(e), mpint(b(jwk.d)), mpint(b(jwk.qi)), mpint(b(jwk.p)), mpint(b(jwk.q)),
  ], comment);
  return {
    privatePem,
    publicLine: `ssh-rsa ${pubBlob.toString('base64')} ${comment}`,
    fingerprint: fingerprintOf(pubBlob),
  };
}

/** Ставит пароль на готовый ключ через ssh-keygen (в Windows 10/11 есть как «Клиент OpenSSH»). */
function protectWithPassphrase(privatePem, passphrase) {
  return new Promise((resolve, reject) => {
    let dir = null;
    const cleanup = () => { try { if (dir) fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ } };
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netmap-key-'));
      const file = path.join(dir, 'key');
      fs.writeFileSync(file, privatePem, { mode: 0o600 });
      execFile('ssh-keygen', ['-p', '-N', passphrase, '-f', file, '-q'], { timeout: 15000 }, (err) => {
        if (err) {
          cleanup();
          const missing = err.code === 'ENOENT';
          return reject(new Error(missing
            ? 'Для ключа с паролем нужна утилита ssh-keygen (в Windows: Параметры → Приложения → Дополнительные компоненты → «Клиент OpenSSH»). Или создайте ключ без пароля.'
            : `ssh-keygen не смог поставить пароль: ${String(err.message || err).split('\n')[0]}`));
        }
        try {
          const out = fs.readFileSync(file, 'utf8');
          cleanup();
          resolve(out);
        } catch (e) { cleanup(); reject(e); }
      });
    } catch (e) { cleanup(); reject(e); }
  });
}

/**
 * IPC: создать пару ключей. cfg: { type?: 'rsa'|'ed25519', comment?, passphrase? }
 * По умолчанию RSA 3072 — совместимо со всеми RouterOS.
 * @returns {Promise<{ok, privatePem?, publicLine?, fingerprint?, type?, encrypted?, error?}>}
 */
async function sshKeyGenerate(cfg) {
  const comment = cleanComment(cfg && cfg.comment);
  const passphrase = String((cfg && cfg.passphrase) || '');
  const type = cfg && cfg.type === 'ed25519' ? 'ed25519' : 'rsa';
  if (passphrase && passphrase.length < 6) {
    return { ok: false, error: 'Пароль к ключу — не короче 6 символов (или оставьте поле пустым).' };
  }
  if (/[\r\n\0]/.test(passphrase)) return { ok: false, error: 'Пароль не должен содержать переводов строки.' };
  const pair = type === 'ed25519' ? generateEd25519Pair(comment) : generateRsaPair(comment);
  let privatePem = pair.privatePem;
  if (passphrase) privatePem = await protectWithPassphrase(privatePem, passphrase);
  return {
    ok: true,
    privatePem,
    publicLine: pair.publicLine + '\n',
    fingerprint: pair.fingerprint,
    type,
    encrypted: !!passphrase,
  };
}

/**
 * IPC: диалог «Сохранить как» и запись файла.
 * opts: { defaultPath?, content, filters?, mode? }  mode '600' для закрытого ключа.
 */
async function saveTextFile(win, opts) {
  const { dialog } = require('electron');
  const content = String((opts && opts.content) || '');
  if (!content) return { ok: false, error: 'Нечего сохранять.' };
  // Относительный путь — от домашней папки пользователя (а не от каталога запуска).
  const raw = String((opts && opts.defaultPath) || 'netmap.txt');
  const defaultPath = path.isAbsolute(raw) ? raw : path.join(os.homedir(), raw);
  try { fs.mkdirSync(path.dirname(defaultPath), { recursive: true }); } catch (_) { /* уже есть */ }
  const res = await dialog.showSaveDialog(win || undefined, {
    title: (opts && opts.title) || 'Сохранить файл',
    defaultPath,
    filters: Array.isArray(opts && opts.filters) && opts.filters.length
      ? opts.filters : [{ name: 'Все файлы', extensions: ['*'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(res.filePath, content, { mode: opts && opts.mode === '600' ? 0o600 : 0o644 });
  return { ok: true, path: res.filePath };
}

// ---------------------------------------------------------------------------
// SNMP
// ---------------------------------------------------------------------------

const HOST_RE = /^[A-Za-z0-9._:-]{1,253}$/;
const OID_RE = /^\.?\d+(\.\d+){0,63}$/;
const MAX_ROWS = 5000;

function snmpApi() { return require('./snmp.cjs'); }

function checkHost(host) {
  const h = String(host || '').trim();
  if (!HOST_RE.test(h) || h.startsWith('-')) return { error: 'Укажите IP-адрес или имя устройства (без пробелов).' };
  return { host: h };
}

/** Общие SNMP-опции из формы. v1/v2c — community; v3 — USM-пользователь. */
function snmpOptions(cfg) {
  const v = String((cfg && cfg.snmpVersion) || '2c');
  const port = Number(cfg && cfg.port);
  const timeoutMs = Number(cfg && cfg.timeoutMs);
  const base = {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 161,
    timeout: Number.isFinite(timeoutMs) && timeoutMs >= 500 && timeoutMs <= 30000 ? timeoutMs : 3000,
    retries: 1,
  };
  if (v === '3') {
    const user = String(cfg.v3User || '').trim();
    if (!user) return { error: 'SNMPv3: укажите имя пользователя (USM user).' };
    const level = ['noAuthNoPriv', 'authNoPriv', 'authPriv'].includes(cfg.v3Level) ? cfg.v3Level : 'authNoPriv';
    const v3 = {
      user,
      level,
      authProtocol: cfg.v3AuthProto || 'sha',
      authKey: String(cfg.v3AuthKey || ''),
      privProtocol: cfg.v3PrivProto || 'aes',
      privKey: String(cfg.v3PrivKey || ''),
    };
    if (level !== 'noAuthNoPriv' && !v3.authKey) return { error: 'SNMPv3: для этого уровня нужен ключ аутентификации.' };
    if (level === 'authPriv' && !v3.privKey) return { error: 'SNMPv3: для authPriv нужен ключ шифрования.' };
    return { opts: { ...base, snmpVersion: '3', v3 } };
  }
  return { opts: { ...base, snmpVersion: v === '1' ? '1' : '2c' } };
}

function communityOf(cfg) {
  return String((cfg && cfg.community) || 'public');
}

/** IPC: проверка связи (sysDescr/sysName/uptime). */
async function snmpProbe(cfg) {
  const h = checkHost(cfg && cfg.host);
  if (h.error) return { ok: false, error: h.error };
  const o = snmpOptions(cfg || {});
  if (o.error) return { ok: false, error: o.error };
  return snmpApi().probe(h.host, communityOf(cfg), o.opts);
}

/** IPC: подбор протокола SNMPv3 (уровень, auth×priv). */
async function snmpDetectV3(cfg) {
  const h = checkHost(cfg && cfg.host);
  if (h.error) return { ok: false, error: h.error };
  const o = snmpOptions({ ...(cfg || {}), snmpVersion: '3' });
  if (o.error) return { ok: false, error: o.error };
  return snmpApi().detectV3(h.host, o.opts.v3, { timeout: 2500 });
}

/** IPC: walk поддерева. cfg.rootOid по умолчанию — вся MIB-2 (1.3.6.1.2.1). */
async function snmpWalk(cfg) {
  const h = checkHost(cfg && cfg.host);
  if (h.error) return { ok: false, error: h.error };
  const root = String((cfg && cfg.rootOid) || '1.3.6.1.2.1').trim().replace(/^\./, '');
  if (!OID_RE.test(root)) return { ok: false, error: 'Некорректный OID. Пример: 1.3.6.1.2.1.1 (system).' };
  const o = snmpOptions(cfg || {});
  if (o.error) return { ok: false, error: o.error };
  const started = Date.now();
  const r = await snmpApi().walkSafe(h.host, communityOf(cfg), root, { ...o.opts, maxRepetitions: 20 });
  if (!r.ok) return r;
  const all = r.items || [];
  const rows = all.slice(0, MAX_ROWS).map(it => ({ oid: String(it.oid), value: formatValue(it.value) }));
  return {
    ok: true,
    rows,
    total: all.length,
    truncated: all.length > MAX_ROWS,
    ms: Date.now() - started,
  };
}

function formatValue(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

module.exports = {
  generateEd25519Pair,
  generateRsaPair,
  sshKeyGenerate,
  saveTextFile,
  snmpProbe,
  snmpDetectV3,
  snmpWalk,
  snmpOptions,
};
