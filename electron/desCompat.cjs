'use strict';
// DES-CBC для SNMPv3 (authPriv + DES).
//
// Зачем: net-snmp при privProtocol=DES вызывает crypto.createCipheriv('des-cbc').
// (1) В OpenSSL 3 (Node 17+, Electron 22+) DES выключен по умолчанию → «unsupported».
// (2) В самой net-snmp lib/des-ecb.js функция раунда f() — заглушка (XOR без S-боксов),
//     то есть даже при включённом OpenSSL шифрование DES было бы неверным.
// Поэтому для 'des-cbc' подставляем проверенную реализацию des.js (MIT, чистый JS).
// Остальные алгоритмы идут в нативный crypto, как раньше.
//
// Проверено: вектор FIPS 133457799BBCDFF1 / 0123456789ABCDEF → 85e813540f0ab405,
// и совпадение с pycryptodome на случайных данных (см. /tmp/vt/des_check.cjs).

const crypto = require('crypto');
const DES = require('des.js');

const origCreateCipheriv = crypto.createCipheriv;
const origCreateDecipheriv = crypto.createDecipheriv;
let installed = false;

function isDesCbc(alg) {
  return String(alg).toLowerCase() === 'des-cbc';
}

// Интерфейс как у crypto.Cipher: update() копит данные, final() отдаёт результат.
// net-snmp всегда передаёт кратные 8 байтам данные и сам управляет паддингом,
// поэтому автопаддинг здесь не применяем.
function makeDesStream(type, key, iv) {
  const chunks = [];
  let done = false;
  return {
    update(data) {
      chunks.push(Buffer.from(data));
      return Buffer.alloc(0);
    },
    final() {
      if (done) throw new Error('DES stream already finalized');
      done = true;
      const all = Buffer.concat(chunks);
      if (all.length % 8 !== 0) throw new Error('DES data length must be a multiple of 8');
      const engine = DES.CBC.instantiate(DES.DES).create({ type, key: Buffer.from(key), iv: Buffer.from(iv), padding: false });
      // При расшифровке des.js придерживает последний блок до final() — собираем оба куска.
      const head = Buffer.from(engine.update(all));
      const tail = Buffer.from(engine.final());
      return Buffer.concat([head, tail]);
    },
    setAutoPadding() {
      return this;
    },
  };
}

function installDesCompat() {
  if (installed) return;
  installed = true;
  crypto.createCipheriv = function createCipheriv(alg, key, iv, opts) {
    if (isDesCbc(alg)) return makeDesStream('encrypt', key, iv);
    return origCreateCipheriv.call(crypto, alg, key, iv, opts);
  };
  crypto.createDecipheriv = function createDecipheriv(alg, key, iv, opts) {
    if (isDesCbc(alg)) return makeDesStream('decrypt', key, iv);
    return origCreateDecipheriv.call(crypto, alg, key, iv, opts);
  };
}

module.exports = { installDesCompat, makeDesStream };
