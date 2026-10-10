// Фейковый snmp.cjs для проверки discovery без реального устройства.
// Задержка на каждый запрос + счётчик одновременных запросов.
const path = require('path');

module.exports = function makeFake(realSnmpPath, opts = {}) {
  const real = require(realSnmpPath);
  const OID = real.OID;
  // delay меняется через fake.setDelay: discovery.cjs держит ссылку на снимок модуля
  let delay = opts.delay != null ? opts.delay : 20;
  const stats = { inflight: 0, maxInflight: 0, calls: 0 };
  const data = {
    '10.0.0.1': {
      ifTable: [{ __index: '1', '2': 'ether1' }, { __index: '5', '2': 'ether5' }],
      ifName: [{ oid: `${OID.ifName}.1`, value: 'ether1' }, { oid: `${OID.ifName}.5`, value: 'ether5' }],
      lldpRemChassisId: [{ oid: `${OID.lldpRemChassisId}.0.5.1`, value: 'aa:bb:cc:00:00:02' }],
      lldpRemPortId: [{ oid: `${OID.lldpRemPortId}.0.5.1`, value: 'ether2' }],
      lldpRemPortDesc: [],
      lldpRemSysName: [{ oid: `${OID.lldpRemSysName}.0.5.1`, value: 'SW-CHILD' }],
      lldpRemSysDesc: [{ oid: `${OID.lldpRemSysDesc}.0.5.1`, value: 'TL-SG2008 JetStream Switch' }],
      lldpLocPortDesc: [],
      lldpRemManAddr: [{ oid: `${OID.lldpRemManAddr}.2.0.5.1.1.4.10.0.0.2`, value: '' }],
      ipNetToMediaPhysAddress: [
        { oid: `${OID.ipNetToMediaPhysAddress}.5.10.0.0.9`, value: '00:11:22:33:44:55' },
        { oid: `${OID.ipNetToMediaPhysAddress}.5.10.0.0.10`, value: '00:11:22:33:44:66' },
      ],
      dot1qVlanStaticName: [{ oid: `${OID.dot1qVlanStaticName}.1`, value: 'default' }],
      dot1qVlanCurrentEgressPorts: [{ oid: `${OID.dot1qVlanCurrentEgressPorts}.1`, value: '' }],
      dot1qPvid: [{ oid: `${OID.dot1qPvid}.1`, value: 1 }],
      dot1dBasePortIf: [{ oid: `${OID.dot1dBasePortIf}.1`, value: '1' }, { oid: `${OID.dot1dBasePortIf}.5`, value: '5' }],
      dot1qTpFdbPort: [
        { oid: `${OID.dot1qTpFdbPort}.1.0.17.34.51.68.85`, value: '5' },
        { oid: `${OID.dot1qTpFdbPort}.1.0.17.34.51.68.102`, value: '1' },
      ],
      dot1dTpFdbPort: [],
    },
    '10.0.0.2': {
      ifTable: [{ __index: '3', '2': 'ether3' }],
      ifName: [{ oid: `${OID.ifName}.3`, value: 'ether3' }],
      lldpRemChassisId: [], lldpRemPortId: [], lldpRemPortDesc: [], lldpRemSysName: [],
      lldpRemSysDesc: [], lldpLocPortDesc: [], lldpRemManAddr: [],
      ipNetToMediaPhysAddress: [],
      dot1qVlanStaticName: [], dot1qVlanCurrentEgressPorts: [], dot1qPvid: [],
      dot1dBasePortIf: [{ oid: `${OID.dot1dBasePortIf}.3`, value: '3' }],
      dot1qTpFdbPort: [{ oid: `${OID.dot1qTpFdbPort}.1.0.17.34.51.68.119`, value: '3' }],
      dot1dTpFdbPort: [],
    },
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function hit() {
    stats.calls++;
    stats.inflight++;
    stats.maxInflight = Math.max(stats.maxInflight, stats.inflight);
    await sleep(delay);
    stats.inflight--;
  }
  const fake = {
    ...real,
    OID,
    stats,
    probe: async (host) => {
      await hit();
      if (!data[host]) return { ok: false, error: 'Request timed out' };
      return {
        ok: true,
        sysDescr: host === '10.0.0.1' ? 'TL-SG2008 JetStream Switch' : 'TL-SG1016 Switch',
        sysName: host === '10.0.0.1' ? 'SW-ROOT' : 'SW-CHILD',
        sysUpTime: 1, sysObjectID: '1.3.6.1.4.1.11863.1.1.1',
      };
    },
    walk: async (host, community, oid) => {
      await hit();
      if (!data[host]) throw new Error('Request timed out');
      const v = data[host][Object.keys(OID).find(k => OID[k] === oid)] || [];
      return v.map(x => ({ oid: x.oid, value: x.value }));
    },
    table: async (host, community, oid) => {
      await hit();
      if (!data[host]) throw new Error('Request timed out');
      return data[host][Object.keys(OID).find(k => OID[k] === oid)] || [];
    },
    get: async () => ({}),
    setDelay: (ms) => { delay = ms; },
  };
  // подменяем экспорт в require.cache, чтобы discovery.cjs взял фейк
  const resolved = require.resolve(realSnmpPath);
  require.cache[resolved].exports = fake;
  return fake;
};
