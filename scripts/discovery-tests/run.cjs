// v0.77.0+: офлайн-проверки автообнаружения без устройств и без Electron.
//   node scripts/discovery-tests/run.cjs
// Фейковый snmp.cjs (fakesnmp.cjs) подменяет реальный через require.cache;
// TS-модули (src/discoveryPrefs.ts, src/discoveryProgress.ts) собираются esbuild.
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '../..');
const ELEC = path.join(ROOT, 'electron');
const esbuild = require(path.join(ROOT, 'node_modules/esbuild'));

function loadTs(rel) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, rel)], bundle: true, format: 'cjs', platform: 'node', write: false,
  });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const makeFake = require('./fakesnmp.cjs');
const fake = makeFake(path.join(ELEC, 'snmp.cjs'), { delay: 10 });
const disc = require(path.join(ELEC, 'discovery.cjs'));
const prefs = loadTs('src/discoveryPrefs.ts');
const prog = loadTs('src/discoveryProgress.ts');
const rep = loadTs('src/discoveryReport.ts');
const dif = loadTs('src/discoveryDiff.ts');

const cfg = { mode: 'snmp', host: '10.0.0.1', snmpSeeds: [], doc: { devices: [], links: [] },
  snmpRecursive: true, snmpMaxHops: 2, reverseDns: false, snmpSweep: false };
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('скан: два коммутатора, параллельность не выше 3', async () => {
  fake.stats.maxInflight = 0;
  const r = await disc.scan(cfg);
  assert.ok(r.ok);
  const names = r.proposedDevices.filter(d => d.nameSource === 'sysname').map(d => d.name).sort();
  assert.deepStrictEqual(names, ['SW-CHILD', 'SW-ROOT']);
  assert.ok(fake.stats.maxInflight <= 3, 'maxInflight=' + fake.stats.maxInflight);
  assert.ok(fake.stats.maxInflight >= 2, 'параллельность не работает');
});

t('прогресс: пары start/done, 15 walk на хост, итог 100%', async () => {
  const events = [];
  await disc.scan(cfg, e => events.push(e));
  const starts = events.filter(e => e.phase === 'host' && e.state === 'start').map(e => e.host).sort();
  const dones = events.filter(e => e.phase === 'host' && e.state === 'done').map(e => e.host).sort();
  assert.deepStrictEqual(starts, dones);
  let s = prog.initialProgress();
  for (const e of events) s = prog.reduceProgress(s, e);
  const fin = prog.summarizeProgress(s);
  assert.strictEqual(fin.hostsTotal, 2); assert.strictEqual(fin.hostsDone, 2); assert.strictEqual(fin.percent, 100);
});

t('прогресс: ошибка onProgress не роняет скан', async () => {
  const r = await disc.scan(cfg, () => { throw new Error('окно закрыто'); });
  assert.ok(r.ok);
});

t('отмена: частичный результат с флагом cancelled', async () => {
  fake.setDelay(100);
  const timer = setTimeout(() => disc.cancelScan(), 250);
  const t0 = Date.now();
  const r = await disc.scan(cfg);
  clearTimeout(timer);
  assert.ok(r.ok); assert.strictEqual(r.cancelled, true);
  assert.ok(Date.now() - t0 < 2000, 'отмена не остановила опрос');
  assert.ok(r.warnings.some(w => w.includes('Опрос отменён')));
  fake.setDelay(10);
});

t('PTR: имя только для безымянных, DNS-таймаут соблюдается', async () => {
  const devs = [
    { ip: '10.0.0.5', nameSource: 'ip', name: '10.0.0.5', kindConfident: false, kind: 'other' },
    { ip: '10.0.0.8', nameSource: 'dhcp', name: 'pc-dhcp' },
  ];
  const n = await disc.resolveReverseNames(devs, { lookup: async () => ['sw-core.corp.local.'], timeoutMs: 200, deadlineMs: 500 });
  assert.strictEqual(n, 1);
  assert.strictEqual(devs[0].name, 'sw-core'); assert.strictEqual(devs[0].nameSource, 'dns');
  assert.strictEqual(devs[1].nameSource, 'dhcp');
  const hang = [{ ip: '10.1.1.1', nameSource: 'ip', name: '10.1.1.1' }];
  const t0 = Date.now();
  await disc.resolveReverseNames(hang, { lookup: () => new Promise(() => {}), timeoutMs: 100, deadlineMs: 300 });
  assert.ok(Date.now() - t0 < 600);
  assert.strictEqual(hang[0].nameSource, 'ip');
});

t('ручной список хостов: IP, диапазон, CIDR, мусор', () => {
  const r = prefs.parseHostList('10.0.2.1-3, 10.0.5.0/29 bad 10.0.0.300');
  assert.deepStrictEqual(r.ips.slice(0, 3), ['10.0.2.1', '10.0.2.2', '10.0.2.3']);
  assert.ok(r.ips.includes('10.0.5.1') && !r.ips.includes('10.0.5.0') && !r.ips.includes('10.0.5.7'));
  assert.deepStrictEqual(r.errors, ['bad', '10.0.0.300']);
  assert.strictEqual(prefs.parseHostList('10.2.0.1-200, 10.3.0.1-200').ips.length, 256);
  assert.ok(prefs.parseHostList('10.0.0.0/16').errors.length === 1);
});

t('настройки: секреты не сохраняются, мусор отбрасывается', () => {
  const s = prefs.sanitizePrefs({ password: 'x', community: 'public', mode: 'evil', host: '10.0.0.1',
    v3Protocols: { '10.0.0.1': { auth: 'sha', priv: 'aes', authKey: 'SECRET' }, bad: { auth: 'nope' } },
    excludedVlans: [1, 'x', 5000, 20] });
  assert.ok(!('password' in s) && !('community' in s));
  assert.strictEqual(s.mode, undefined);
  assert.deepStrictEqual(s.v3Protocols, { '10.0.0.1': { auth: 'sha', priv: 'aes' } });
  assert.deepStrictEqual(s.excludedVlans, [1, 20]);
  assert.deepStrictEqual(prefs.sanitizePrefs(null), {});
});

t('отчёт CSV: BOM, ;, кавычки, правки и галочки учитываются', () => {
  const scan = { ok: true, proposedDevices: [
    { tempId: 'a', ip: '10.0.0.1', mac: 'AA:BB:CC:00:00:01', name: 'SW "core"; main', nameSource: 'sysname', kind: 'switch', vendor: 'TP-Link', vlan: 10 },
    { tempId: 'b', mac: 'AA:BB:CC:00:00:02', name: 'AA:BB:CC:00:00:02', nameSource: 'mac', kind: 'pc' },
  ], proposedLinks: [] };
  const csv = rep.buildDevicesCsv(scan, { devPick: { b: false }, nameEdits: { a: 'Ядро' } });
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  assert.strictEqual(lines[0], 'Имя;IP;MAC;Тип;Вендор;VLAN;Источник имени;Выбрано для добавления;Подсказка');
  assert.ok(lines[1].startsWith('Ядро;10.0.0.1;'), lines[1]);
  assert.ok(lines[1].endsWith(';да;'));
  assert.ok(lines[2].endsWith(';нет;'), lines[2]);
  assert.strictEqual(rep.csvCell('a;"b"'), '"a;""b"""');
});

t('отчёт Markdown: связи с именами, экранирование |, отмена', () => {
  const scan = { ok: true, cancelled: true, rootHost: '10.0.0.1', source: 'snmp',
    proposedDevices: [
      { tempId: 'a', ip: '10.0.0.1', name: 'SW|A', nameSource: 'sysname', kind: 'switch' },
      { tempId: 'b', ip: '10.0.0.2', name: 'PC', nameSource: 'ip', kind: 'pc' },
    ],
    proposedLinks: [{ tempId: 'l', fromRef: { tempId: 'a' }, toRef: { tempId: 'b' }, fromPort: 'ether2', toPort: 'eth0', evidence: 'LLDP' }],
    vlans: [{ id: 10, name: 'Office' }], warnings: ['тест'] };
  const md = rep.buildMarkdownReport(scan, { when: new Date(2026, 9, 10, 15, 30) });
  assert.ok(md.includes('SW\\|A'));
  assert.ok(md.includes('| SW\\|A | ether2 | PC | eth0 | LLDP |'));
  assert.ok(md.includes('Опрос отменён'));
  assert.ok(md.includes('- VLAN 10 — Office'));
  assert.ok(md.includes('Найдено устройств: 2'));
});

t('имя файла отчёта', () => {
  assert.strictEqual(rep.reportFileName('csv', new Date(2026, 9, 10, 5, 7)), 'netmap-discovery-2026-10-10-0507.csv');
});

t('сравнение со прошлым сканом: новые, пропавшие, изменённые, связи', () => {
  const mk = (devs, links) => ({ ok: true, proposedDevices: devs, proposedLinks: links });
  const A = { tempId: 'a', mac: 'aa:bb:cc:00:00:01', ip: '10.0.0.1', name: 'SW', kind: 'switch' };
  const B = { tempId: 'b', mac: 'aa:bb:cc:00:00:02', ip: '10.0.0.2', name: 'PC', kind: 'pc' };
  const C = { tempId: 'c', mac: 'aa:bb:cc:00:00:03', ip: '10.0.0.3', name: 'AP', kind: 'ap' };
  const D = { tempId: 'd', mac: 'aa:bb:cc:00:00:04', ip: '10.0.0.4', name: 'NEW', kind: 'pc' };
  const prev = dif.makeSnapshot(mk([A, B, C], [{ tempId: 'l1', fromRef: { tempId: 'a' }, toRef: { tempId: 'b' }, fromPort: 'ether2' }]), '10.0.0.1', 1);
  const next = dif.makeSnapshot(mk([{ ...A, name: 'SW-2' }, C, D],
    [{ tempId: 'l2', fromRef: { tempId: 'a' }, toRef: { tempId: 'd' }, fromPort: 'ether3' }]), '10.0.0.1', 2);
  const diff = dif.diffSnapshots(prev, next);
  assert.deepStrictEqual(diff.added.map(d => d.name), ['NEW']);
  assert.deepStrictEqual(diff.removed.map(d => d.name), ['PC']);
  assert.strictEqual(diff.changed.length, 1);
  assert.deepStrictEqual(diff.changed[0].fields, ['name']);
  assert.strictEqual(diff.linksAdded.length, 1);
  assert.strictEqual(diff.linksRemoved.length, 1);
  assert.strictEqual(diff.removedIgnored, false);
  // отмена в текущем скане: пропавшие не считаем
  const cancelled = dif.makeSnapshot({ ...mk([C], []), cancelled: true }, '10.0.0.1', 3);
  const d2 = dif.diffSnapshots(prev, cancelled);
  assert.strictEqual(d2.removedIgnored, true);
  assert.deepStrictEqual(d2.removed, []);
  assert.deepStrictEqual(d2.linksRemoved, []);
});

t('сравнение: хранение снимков по корням, не больше 5', () => {
  const store = new Map();
  global.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  for (let i = 0; i < 7; i++) {
    dif.saveSnapshot({ at: 1000 + i, rootHost: '10.9.0.' + i, cancelled: false, devices: [], links: [] });
  }
  const map = JSON.parse(store.get(dif.SNAPSHOT_KEY));
  assert.strictEqual(Object.keys(map).length, 5);
  assert.ok(map['10.9.0.6'] && !map['10.9.0.0']);
  assert.strictEqual(dif.loadSnapshot('10.9.0.6').at, 1006);
  assert.strictEqual(dif.loadSnapshot('10.9.0.0'), null);
  delete global.localStorage;
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('ok   ', name); }
    catch (e) { failed++; console.log('FAIL ', name, '\n     ', e.message); }
  }
  console.log(failed ? `\n${failed} FAILED` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
