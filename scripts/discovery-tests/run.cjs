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
const { makeProposal } = disc;
const prefs = loadTs('src/discoveryPrefs.ts');
const prog = loadTs('src/discoveryProgress.ts');
const rep = loadTs('src/discoveryReport.ts');
const dif = loadTs('src/discoveryDiff.ts');
const arp = loadTs('src/arpHints.ts');
const sch = loadTs('src/discoveryScheduler.ts');
const wiz = loadTs('src/discoveryWizard.ts');

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

t('отчёт Markdown: сегменты VLAN с подсетями, коммутаторами и клиентами', () => {
  const scan = { ok: true, rootHost: '10.0.0.1', source: 'snmp', proposedDevices: [], proposedLinks: [],
    vlans: [{ id: 10, name: 'Office' }],
    segments: [{ vlan: 10, name: 'Office', subnets: ['10.10.0.0/24'], switches: ['SW-A'], endpoints: 3 }] };
  const md = rep.buildMarkdownReport(scan, { when: new Date(2026, 9, 10, 15, 30) });
  assert.ok(md.includes('## Сегменты VLAN'));
  assert.ok(md.includes('- VLAN 10 — Office: подсети: 10.10.0.0/24; коммутаторы: SW-A; клиентов: 3'));
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

t('профили сети: секреты и SNMPv3-протоколы не сохраняются, лимиты соблюдаются', () => {
  const raw = {
    '  Офис  ': { host: '10.0.0.1', mode: 'snmp', password: 'SECRET', community: 'public', v3Protocols: { '10.0.0.1': { auth: 'sha' } }, excludedVlans: [10] },
    '': { host: 'x' },
  };
  for (let i = 0; i < 30; i++) raw['P' + i] = { host: '10.0.1.' + i };
  raw['X'.repeat(60)] = { host: '10.0.2.1' };
  const map = prefs.sanitizeProfiles(raw);
  assert.ok(map['Офис']);
  assert.ok(!('password' in map['Офис']) && !('community' in map['Офис']) && !('v3Protocols' in map['Офис']));
  assert.deepStrictEqual(map['Офис'].excludedVlans, [10]);
  assert.ok(!('' in map));
  assert.ok(Object.keys(map).length <= 20, 'лимит 20 профилей');
  assert.ok(Object.keys(map).every(k => k.length <= 40));
});

t('ARP ПК: Windows, Linux, ip neigh; мусор и multicast отбрасываются', () => {
  const win = [
    'Interface: 192.168.1.10 --- 0xb',
    '  Internet Address      Physical Address      Type',
    '  192.168.1.1           00-11-22-33-44-55     dynamic',
    '  192.168.1.255         ff-ff-ff-ff-ff-ff     static',
    '  224.0.0.22            01-00-5e-00-00-16     static',
  ].join('\r\n');
  const lin = '? (192.168.1.20) at aa:bb:cc:00:11:22 [ether] on eth0\n? (192.168.1.21) at <incomplete> on eth0';
  const neigh = '192.168.1.30 dev eth0 lladdr de:ad:be:ef:00:01 REACHABLE';
  const r = arp.parseArpOutput([win, lin, neigh].join('\n'));
  assert.strictEqual(r.map['00:11:22:33:44:55'], '192.168.1.1');
  assert.strictEqual(r.map['AA:BB:CC:00:11:22'], '192.168.1.20');
  assert.strictEqual(r.map['DE:AD:BE:EF:00:01'], '192.168.1.30');
  assert.ok(!Object.keys(r.map).some(m => m.startsWith('FF:FF') || m.startsWith('01:00:5E')));
  assert.ok(!Object.values(r.map).includes('192.168.1.255'));
  assert.strictEqual(arp.parseArpOutput('nothing here').pairs, 0);
});

t('ARP ПК: подстановка IP только устройствам без IP', () => {
  const devs = [
    { tempId: 'a', mac: 'AA:BB:CC:00:11:22', name: 'AA:BB:CC:00:11:22' },
    { tempId: 'b', mac: 'AA:BB:CC:00:11:99', ip: '10.0.0.9', name: 'x' },
    { tempId: 'c', mac: 'AA:BB:CC:00:11:33', name: 'y' },
  ];
  const r = arp.applyArpHints(devs, { 'AA:BB:CC:00:11:22': '192.168.1.20', 'AA:BB:CC:00:11:99': '1.1.1.1' });
  assert.strictEqual(r.filled, 1);
  assert.strictEqual(r.devices[0].ip, '192.168.1.20');
  assert.strictEqual(r.devices[0].hint, 'IP из ARP ПК');
  assert.strictEqual(r.devices[1].ip, '10.0.0.9');
  assert.strictEqual(r.devices[2].ip, undefined);
});

t('аплинк: MAC за аплинком не дублируется, а привязывается к соседу', async () => {
  const r = await disc.scan(cfg);
  const devByMac = m => r.proposedDevices.find(d => d.mac === m);
  const child = r.proposedDevices.find(d => d.nameSource === 'sysname' && d.name === 'SW-CHILD');
  const root = r.proposedDevices.find(d => d.nameSource === 'sysname' && d.name === 'SW-ROOT');
  assert.ok(child && root);
  // MAC …77 есть в FDB соседа на access-порту — только связь с соседом
  const m77 = devByMac('00:11:22:33:44:77');
  assert.ok(m77, 'MAC 77 найден');
  const to77 = r.proposedLinks.filter(l => l.toRef.tempId === m77.tempId);
  assert.strictEqual(to77.length, 1, 'одна связь у MAC 77');
  assert.strictEqual(to77[0].fromRef.tempId, child.tempId);
  assert.strictEqual(to77[0].fromPort, 'ether3');
  // MAC …55 на аплинке, у соседа его нет — привязан к соседу через аплинк
  const m55 = devByMac('00:11:22:33:44:55');
  assert.ok(m55, 'MAC 55 найден');
  const to55 = r.proposedLinks.filter(l => l.toRef.tempId === m55.tempId);
  assert.strictEqual(to55.length, 1);
  assert.strictEqual(to55[0].fromRef.tempId, child.tempId);
  assert.ok(/за аплинком/.test(to55[0].evidence), to55[0].evidence);
  assert.ok(r.stats.fdbUplink.skipped >= 1 && r.stats.fdbUplink.attached >= 1, JSON.stringify(r.stats.fdbUplink));
});

t('плановый скан: снимок и сравнение, пропуск при ручном скане, ошибка, выключение', async () => {
  const store = new Map();
  global.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const dev = (tempId, mac, name) => ({ tempId, mac, ip: '10.5.0.' + mac.slice(-1), name, nameSource: 'sysname', kind: 'switch' });
  let calls = 0;
  let result = { ok: true, proposedDevices: [dev('a', 'AA:00:00:00:00:01', 'SW-1')], proposedLinks: [] };
  const runScan = async (cfg) => { calls++; assert.strictEqual(cfg.doc.devices.length, 0); return result; };
  // первый прогон — снимок без сравнения
  sch.startSchedule({ cfg: { host: '10.5.0.1', mode: 'snmp' }, intervalMs: 60000, runScan });
  await sch.runScheduledOnce();
  assert.strictEqual(calls, 1);
  assert.ok(sch.getScheduleStatus().lastSummary.startsWith('первый снимок'));
  // второй прогон — есть что сравнивать: одно новое, одно пропало
  result = { ok: true, proposedDevices: [dev('b', 'AA:00:00:00:00:02', 'PC-2')], proposedLinks: [] };
  await sch.runScheduledOnce();
  assert.strictEqual(sch.getScheduleStatus().lastSummary, 'новых 1, пропало 1, изменилось 0');
  // ручной скан занят — плановый пропускает и не вызывает runScan
  sch.setDiscoveryBusy(true);
  await sch.runScheduledOnce();
  assert.strictEqual(calls, 2);
  assert.ok(sch.getScheduleStatus().lastSummary.includes('пропущен'));
  sch.setDiscoveryBusy(false);
  // ошибка скана не роняет планировщик
  result = { ok: false, error: 'SNMP недоступен' };
  await sch.runScheduledOnce();
  assert.strictEqual(sch.getScheduleStatus().lastError, 'SNMP недоступен');
  assert.strictEqual(sch.getScheduleStatus().running, false);
  // выключение очищает таймер и статус
  sch.stopSchedule();
  assert.strictEqual(sch.getScheduleStatus().enabled, false);
  delete global.localStorage;
});

// v0.85.0: привязка MAC к коммутаторам (один проход, независимо от порядка источников)
const swFix = (host, name, lldp, fdb) => ({ ok: true, host, self: { name, descr: '', vendor: '', kind: 'switch' },
  lldp, fdb, ifNames: {}, arpByMac: {}, vlanList: [], mgmtAddrs: [], warnings: [] });
const mtFix = (over) => Object.assign({ ok: true, self: { name: 'GW' }, neighbors: [], arp: [], leases: [],
  addresses: [], subnetVlans: [], vlanByPort: {}, vlanIfaceByName: {}, switchVlanIds: [], fdb: [] }, over);
const devOf = (r, mac) => r.proposedDevices.find(d => d.mac === mac);
const nameOfRef = (r, ref) => {
  const d = r.proposedDevices.find(p => (ref.tempId && p.tempId === ref.tempId) || (ref.existingId && p.existingId === ref.existingId));
  return d ? d.name : null;
};

t('привязка MAC: порядок источников не меняет результат', async () => {
  const MAC = '00:11:22:33:44:77';
  const child = swFix('10.0.0.2', 'SW-CHILD', [], [{ mac: MAC, bridgePort: '3', ifName: 'ether3' }]);
  const root = swFix('10.0.0.1', 'GW-SW', [{ localPortName: 'ether5', chassisId: 'aa:bb:cc:00:00:02', portId: 'ether2',
    portDesc: '', sysName: 'SW-CHILD', sysDesc: '', mgmtIp: '10.0.0.2' }], []);
  const mt = mtFix({ fdb: [{ mac: MAC, onIface: 'ether5', vlan: 10 }] });
  const res = [];
  for (const [m, snmp] of [[mt, [root, child]], [null, [root, child]]]) {
    const r = makeProposal({ doc: { devices: [], links: [] }, rootHost: '10.0.0.1', mt: m, snmpResults: snmp });
    const dev = devOf(r, MAC);
    const ls = r.proposedLinks.filter(l => l.toRef.tempId === dev.tempId);
    assert.strictEqual(ls.length, 1, 'одна связь');
    res.push(nameOfRef(r, ls[0].fromRef) + ' ' + ls[0].fromPort);
  }
  assert.deepStrictEqual(res, ['SW-CHILD ether3', 'SW-CHILD ether3']);
});

t('привязка MAC: клиент на access-порту шлюза → шлюз', async () => {
  const MAC = '00:11:22:33:44:66';
  const r = makeProposal({ doc: { devices: [], links: [] }, rootHost: '10.0.0.1', mt: mtFix({ fdb: [{ mac: MAC, onIface: 'ether2', vlan: 10 }] }), snmpResults: [] });
  const ls = r.proposedLinks.filter(l => l.toRef.tempId === devOf(r, MAC).tempId);
  assert.strictEqual(ls.length, 1);
  assert.strictEqual(nameOfRef(r, ls[0].fromRef), 'GW');
  assert.strictEqual(ls[0].fromPort, 'ether2');
});

t('привязка MAC: аплинк к неопрошенному соседу → сосед через LLDP-порт', async () => {
  const MAC = '00:11:22:33:44:88';
  const r = makeProposal({ doc: { devices: [], links: [] }, rootHost: '10.0.0.1',
    mt: mtFix({ neighbors: [{ localIface: 'ether5', ip: '10.0.0.9', mac: 'AA:BB:CC:00:00:09', name: 'SW-FAR', platform: '', version: '', board: '' }],
      fdb: [{ mac: MAC, onIface: 'ether5', vlan: 10 }] }), snmpResults: [] });
  const ls = r.proposedLinks.filter(l => l.toRef.tempId === devOf(r, MAC).tempId);
  assert.strictEqual(ls.length, 1);
  assert.strictEqual(nameOfRef(r, ls[0].fromRef), 'SW-FAR');
  assert.ok(/за аплинком/.test(ls[0].evidence), ls[0].evidence);
});

t('сегменты VLAN: подсети, коммутаторы и число клиентов', async () => {
  const MAC = '00:11:22:33:44:99';
  const r = makeProposal({ doc: { devices: [], links: [] }, rootHost: '10.0.0.1',
    mt: mtFix({ subnetVlans: [{ cidr: '10.10.0.0/24', vlanId: 10, iface: 'vlan10' }], switchVlanIds: [10],
      fdb: [{ mac: MAC, onIface: 'ether2', vlan: 10 }] }),
    snmpResults: [] });
  assert.ok(Array.isArray(r.segments), 'segments есть');
  const seg = r.segments.find(x => x.vlan === 10);
  assert.ok(seg, 'сегмент VLAN 10');
  assert.deepStrictEqual(seg.subnets, ['10.10.0.0/24']);
  assert.ok(seg.switches.includes('GW'));
  assert.ok(seg.endpoints >= 1);
});

// v0.87.0: мастер уточнений — вопросы, ответы → правки, память, сводка
const WKIND = ['router', 'switch', 'ap', 'pc', 'other'];
const wizScan = () => ({
  ok: true, rootHost: '10.0.0.1', source: 'snmp',
  proposedDevices: [
    { tempId: 'gw', ip: '10.0.0.1', name: 'GW', nameSource: 'sysname', kind: 'router', kindConfident: true },
    { tempId: 'sw', ip: '10.0.0.2', name: 'SW-A', nameSource: 'sysname', kind: 'switch', kindConfident: true },
    { tempId: 'cam', ip: '10.0.0.30', mac: 'AA:00:00:00:00:30', name: '10.0.0.30', nameSource: 'ip', kind: 'other', kindConfident: false, vendor: 'Hikvision' },
    { tempId: 'pc', ip: '10.0.0.40', mac: 'AA:00:00:00:00:40', name: 'AA:00:00:00:00:40', nameSource: 'mac', kind: 'pc', kindConfident: true },
    { tempId: 'm1', mac: 'AA:00:00:00:00:51', name: 'AA:00:00:00:00:51', nameSource: 'mac', kind: 'other', kindConfident: true, vlan: 20 },
  ],
  proposedLinks: [
    { tempId: 'l1', fromRef: { tempId: 'gw' }, toRef: { tempId: 'pc' }, fromPort: 'ether2', evidence: 'MikroTik /ip neighbor on ether2' },
    { tempId: 'l2', fromRef: { tempId: 'gw' }, toRef: { tempId: 'm1' }, fromPort: 'ether5', evidence: 'FDB on GW:ether5 (за аплинком SW-A)' },
  ],
  vlans: [{ id: 10, name: 'Office' }, { id: 20, name: '' }],
  subnets: [{ cidr: '10.0.0.0/24', interface: 'bridge', comment: '' }, { cidr: '172.16.0.0/16', interface: 'guest', comment: 'гости' }],
  hubCandidates: [{ ip: '10.0.0.9', name: 'CORE-X', kind: 'switch', via: 'LLDP' }],
});
const wizOpts = { kindOptions: WKIND, memory: {} };

t('мастер: вопросы строятся только там, где есть неясности', () => {
  const steps = wiz.buildWizardSteps(wizScan(), wizOpts);
  const ids = steps.map(s2 => s2.id);
  assert.deepStrictEqual(ids, ['hubs', 'kind', 'name', 'uplink', 'vlan', 'subnet', 'macOnly']);
  const count = id => steps.find(s2 => s2.id === id).items.length;
  assert.strictEqual(count('hubs'), 1);
  assert.strictEqual(count('kind'), 1, 'только камера с неуверенным типом');
  assert.strictEqual(count('uplink'), 1);
  assert.strictEqual(count('vlan'), 1, 'VLAN 20 без имени');
  assert.strictEqual(count('subnet'), 2);
  assert.strictEqual(count('macOnly'), 1);
  const up = steps.find(s2 => s2.id === 'uplink').items[0];
  assert.ok(up.candidates.some(c => c.name === 'SW-A'), 'кандидат — коммутатор');
  assert.ok(!up.candidates.some(c => c.tempId === 'gw'), 'текущий коммутатор не предлагается');
});

t('мастер: пустой скан без вопросов не даёт шагов', () => {
  const steps = wiz.buildWizardSteps({ ok: true, proposedDevices: [], proposedLinks: [], vlans: [], subnets: [] }, wizOpts);
  assert.strictEqual(steps.length, 0);
});

t('мастер: ответы по умолчанию ничего не меняют', () => {
  const sc = wizScan();
  const steps = wiz.buildWizardSteps(sc, wizOpts);
  const fx = wiz.wizardEffects(sc, wiz.defaultAnswers(steps));
  assert.ok(wiz.summarizeEffects(fx).some(l => l.includes('Опросим ядро')), 'ядро в сводке');
  const none = wiz.defaultAnswers(steps); none.hubs['10.0.0.9'] = false;
  assert.deepStrictEqual(wiz.summarizeEffects(wiz.wizardEffects(sc, none)), ['Ответов нет: ничего не изменится.']);
  assert.deepStrictEqual(fx.kinds, {});
  assert.deepStrictEqual(fx.moveLinks, {});
  assert.deepStrictEqual(fx.excludeVlans, []);
  assert.deepStrictEqual(fx.skipDevices, []);
  assert.deepStrictEqual(fx.hubs, ['10.0.0.9'], 'ядро по умолчанию отмечено, как и в панели');
});

t('мастер: ответы переходят в правки (тип, имя, перенос клиента, VLAN, подсеть, MAC-only)', () => {
  const sc = wizScan();
  const steps = wiz.buildWizardSteps(sc, wizOpts);
  const a = wiz.defaultAnswers(steps);
  a.kinds.cam = 'ap';                                       // тип из допустимых
  a.names.pc = '  Бухгалтерия  ';
  a.uplinks.l2 = { mode: 'move', toTempId: 'sw' };
  a.vlans['20'] = { exclude: true, name: '' };
  a.vlans['10'] = { exclude: false, name: '' };
  a.subnets['172.16.0.0/16'] = true;
  a.macOnly = 'skip';
  a.hubs['10.0.0.9'] = false;
  const fx = wiz.wizardEffects(sc, a);
  assert.deepStrictEqual(fx.kinds, { cam: 'ap' });
  assert.deepStrictEqual(fx.names, { pc: 'Бухгалтерия' });
  assert.deepStrictEqual(fx.moveLinks, { l2: 'sw' });
  assert.deepStrictEqual(fx.excludeVlans, [20]);
  assert.deepStrictEqual(fx.excludeCidrs, ['172.16.0.0/16']);
  assert.deepStrictEqual(fx.skipDevices, ['m1']);
  assert.deepStrictEqual(fx.hubs, []);
  const lines = wiz.summarizeEffects(fx).join('\n');
  assert.ok(/VLAN исключим: 20/.test(lines) && /Клиентов переставим/.test(lines));
});

t('мастер: память ответов — запоминание, предвыбор, отбраковка мусора и лимит', () => {
  const sc = wizScan();
  const steps = wiz.buildWizardSteps(sc, wizOpts);
  const a = wiz.defaultAnswers(steps);
  a.kinds.cam = 'ap';
  a.names.pc = 'Бухгалтерия';
  const mem = wiz.rememberAnswers({}, sc, a);
  assert.deepStrictEqual(mem['AA:00:00:00:00:30'], { kind: 'ap' });
  assert.deepStrictEqual(mem['AA:00:00:00:00:40'], { name: 'Бухгалтерия' });
  // при следующем скане тот же MAC получает предвыбор
  const again = wiz.buildWizardSteps(sc, { kindOptions: WKIND, memory: mem });
  const kindItem = again.find(s2 => s2.id === 'kind').items[0];
  assert.strictEqual(kindItem.remembered, 'ap');
  assert.strictEqual(wiz.defaultAnswers(again).kinds.cam, 'ap');
  // мусор отбрасывается: тип вне списка, длинный ключ, не-объект
  const clean = wiz.sanitizeMemory({
    'AA:00:00:00:00:30': { kind: 'hacker', name: 'X' },
    ['k'.repeat(70)]: { name: 'Y' },
    'AA:00:00:00:00:41': 'строка',
    'AA:00:00:00:00:42': { kind: 'pc' },
  }, WKIND);
  assert.deepStrictEqual(clean, { 'AA:00:00:00:00:30': { name: 'X' }, 'AA:00:00:00:00:42': { kind: 'pc' } });
  // лимит 500 записей
  const big = {};
  for (let i = 0; i < 600; i++) big['M' + i] = { name: 'n' + i };
  assert.strictEqual(Object.keys(wiz.sanitizeMemory(big, WKIND)).length, 500);
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
