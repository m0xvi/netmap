/**
 * v0.90.0 — проверки сетевых утилит (electron/netTools.cjs). Без Electron и сети.
 * Запуск: node scripts/nettools-tests/run.cjs
 *
 * Ключ сверяется с настоящим ssh-keygen, если он установлен (в Linux-песочнице и
 * в Windows с «Клиентом OpenSSH» он есть). Без него проверяется только структура.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const nt = require('../../electron/netTools.cjs');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failures.push(name); console.log('  FAIL', name, '\n       ', e.message); }
}

function haveSshKeygen() {
  try { execFileSync('ssh-keygen', ['-V'], { stdio: 'ignore' }); return true; }
  catch (e) { return e.status === 0 || e.status === 1 || e.code !== 'ENOENT'; }
}

function parseOpenSshPem(pem) {
  const m = pem.match(/-----BEGIN OPENSSH PRIVATE KEY-----\n([\s\S]+?)\n-----END OPENSSH PRIVATE KEY-----\n$/);
  assert.ok(m, 'нет заголовков OPENSSH PRIVATE KEY');
  const buf = Buffer.from(m[1].replace(/\n/g, ''), 'base64');
  assert.strictEqual(buf.subarray(0, 15).toString('binary'), 'openssh-key-v1\0', 'магическая строка');
  let off = 15;
  const str = () => { const n = buf.readUInt32BE(off); off += 4; const s = buf.subarray(off, off + n); off += n; return s; };
  assert.strictEqual(str().toString(), 'none', 'шифр');
  assert.strictEqual(str().toString(), 'none', 'KDF');
  str();
  assert.strictEqual(buf.readUInt32BE(off), 1, 'число ключей'); off += 4;
  const pubBlob = str();
  const priv = str();
  assert.strictEqual(priv.length % 8, 0, 'длина приватной секции кратна 8');
  assert.strictEqual(priv.readUInt32BE(0), priv.readUInt32BE(4), 'контрольные числа совпадают');
  return { pubBlob, priv: priv.subarray(8) };
}

(async () => {
  console.log('netTools tests');

  await test('ключ ed25519: структура OpenSSH и публичная строка совпадают', async () => {
    const r = await nt.sshKeyGenerate({ comment: 'тест-ПК' });
    assert.ok(r.ok, r.error);
    assert.ok(r.fingerprint.startsWith('SHA256:'));
    assert.strictEqual(r.encrypted, false);
    const { pubBlob } = parseOpenSshPem(r.privatePem);
    const line = r.publicLine.trim().split(' ');
    assert.strictEqual(line[0], 'ssh-ed25519');
    assert.strictEqual(Buffer.from(line[1], 'base64').toString('hex'), pubBlob.toString('hex'));
    assert.strictEqual(line.slice(2).join(' '), 'тест-ПК');
  });

  await test('комментарий без переводов строки и не пустой', async () => {
    const r = await nt.sshKeyGenerate({ comment: 'a\nb\0c' });
    assert.ok(r.ok);
    assert.ok(!/[\r\n\0]/.test(r.publicLine.trim()));
    const r2 = await nt.sshKeyGenerate({ comment: '   ' });
    assert.ok(r2.publicLine.trim().endsWith(' netmap'));
  });

  await test('короткий пароль к ключу отклоняется', async () => {
    const r = await nt.sshKeyGenerate({ passphrase: '123' });
    assert.strictEqual(r.ok, false);
    assert.ok(/не короче 6/.test(r.error));
  });

  await test('ключ, который читает настоящий ssh-keygen', async (t) => {
    if (!haveSshKeygen()) { console.log('       (ssh-keygen не найден — пропуск)'); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-test-'));
    const r = await nt.sshKeyGenerate({ comment: 'verify' });
    const kf = path.join(dir, 'k');
    fs.writeFileSync(kf, r.privatePem, { mode: 0o600 });
    const derived = execFileSync('ssh-keygen', ['-y', '-f', kf], { encoding: 'utf8' }).trim();
    assert.strictEqual(derived.split(' ')[1], r.publicLine.trim().split(' ')[1], 'публичный ключ из закрытого не совпал');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('пароль к ключу: читается верным паролем, отклоняется неверным', async () => {
    if (!haveSshKeygen()) { console.log('       (ssh-keygen не найден — пропуск)'); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-test-'));
    const r = await nt.sshKeyGenerate({ comment: 'enc', passphrase: 'correct-horse-1' });
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.encrypted, true);
    const kf = path.join(dir, 'k');
    fs.writeFileSync(kf, r.privatePem, { mode: 0o600 });
    execFileSync('ssh-keygen', ['-y', '-P', 'correct-horse-1', '-f', kf], { stdio: 'ignore' });
    let rejected = false;
    try { execFileSync('ssh-keygen', ['-y', '-P', 'wrong-pass-1', '-f', kf], { stdio: 'ignore' }); }
    catch (_) { rejected = true; }
    assert.ok(rejected, 'неверный пароль должен отклоняться');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('SNMP: некорректный host и OID отсекаются без обращения к сети', async () => {
    const a = await nt.snmpWalk({ host: '-oProxyCommand=x', snmpVersion: '2c' });
    assert.strictEqual(a.ok, false);
    const b = await nt.snmpWalk({ host: '10.0.0.1', rootOid: '1.3.6.a', snmpVersion: '2c' });
    assert.strictEqual(b.ok, false);
    assert.ok(/OID/.test(b.error));
  });

  await test('SNMPv3: без имени пользователя и без ключей — понятная ошибка', async () => {
    const a = nt.snmpOptions({ snmpVersion: '3' });
    assert.ok(a.error && /пользовател/.test(a.error));
    const b = nt.snmpOptions({ snmpVersion: '3', v3User: 'zbx', v3Level: 'authPriv', v3AuthKey: 'k1' });
    assert.ok(b.error && /шифрования/.test(b.error));
    const c = nt.snmpOptions({ snmpVersion: '3', v3User: 'zbx', v3Level: 'authNoPriv', v3AuthKey: 'k1', v3AuthProto: 'sha256' });
    assert.ok(!c.error);
    assert.strictEqual(c.opts.v3.authProtocol, 'sha256');
    assert.strictEqual(c.opts.snmpVersion, '3');
  });

  await test('SNMP v1/v2c: версия выбирается, community по умолчанию не пустая строка', async () => {
    const v1 = nt.snmpOptions({ snmpVersion: '1' });
    assert.strictEqual(v1.opts.snmpVersion, '1');
    const v2 = nt.snmpOptions({});
    assert.strictEqual(v2.opts.snmpVersion, '2c');
    assert.strictEqual(v2.opts.v3, undefined);
  });

  await test('SNMP: недоступный порт возвращает ошибку, а не падает', async () => {
    const r = await nt.snmpProbe({ host: '127.0.0.1', port: 1, snmpVersion: '2c', community: 'public', timeoutMs: 500 });
    assert.strictEqual(r.ok, false);
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
