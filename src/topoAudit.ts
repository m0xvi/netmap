/**
 * v0.74.0 — аудит хабов по метаданным сканирования (doc.scanMeta).
 *
 * Задача (слова пользователя): большинство устройств попало на карту из
 * DHCP-сервера (их связи предположительные — «звезда» от шлюза), остальные
 * стыкуются по данным SNMP/SSH-опроса свитчей. Аудит отвечает на два вопроса
 * по каждому свитчу/роутеру карты:
 *   1) проводилось ли по нему SNMP/SSH-сканирование (doc.scanMeta: host/name);
 *   2) какие устройства по его FDB (fdbMacs) ДОЛЖНЫ быть к нему подключены —
 *      и кто из них фактически не подключён (missing) или висит на другом хабе
 *      (misplaced — типичный след DHCP-звезды).
 *
 * Чистые функции: doc → отчёт/план. Применяет store.applyAuditFixes
 * (история + persist, откат Ctrl+Z).
 */

import type { Device, NetMapDoc, ScannedHubMeta } from './types';

export interface AuditHubRow {
  hub: Device;
  /** след сканирования, сопоставленный с хабом (по IP или имени). */
  meta: ScannedHubMeta | null;
  /** чем просканирован: 'snmp' | 'ssh' | 'both'; null — следов нет. */
  via: 'snmp' | 'ssh' | 'both' | null;
  /** сколько устройств подключено к хабу сейчас (по links). */
  connectedNow: number;
  /** сколько оконечных на хабе — из DHCP (origin 'dhcp' или без origin,
   *  но тег 'discovered' и связь-«звезда» от шлюза). */
  fromDhcp: number;
  /** устройства, которые по FDB хаба должны быть подключены к нему. */
  expectedByFdb: Device[];
  /** из них: нет НИКАКОЙ связи с хабом. */
  missing: Device[];
  /** из них: подключены, но к ДРУГОМУ хабу (а не к этому). */
  misplaced: Device[];
}

/** Нормализация MAC для сравнения: нижний регистр, без разделителей. */
export function normMac(mac?: string | null): string {
  return (mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

const HUB_KINDS = ['switch', 'router'];

function hubOfMeta(hub: Device, meta: ScannedHubMeta): boolean {
  const nm = (hub.name || '').trim().toLowerCase();
  const mn = (meta.name || '').trim().toLowerCase();
  if (nm && mn && nm === mn) return true;
  if (hub.ip && meta.host && hub.ip.trim() === meta.host.trim()) return true;
  // Имя хаба может содержать host (или наоборот) — аккуратное вхождение
  // только для длинных имён (≥5 символов), как в эвристике v0.70.
  if (nm.length >= 5 && mn && (mn.includes(nm) || nm.includes(mn))) return true;
  return false;
}

export function auditHubs(doc: NetMapDoc): AuditHubRow[] {
  const devices = doc.devices || [];
  const links = doc.links || [];
  const metas = doc.scanMeta || [];
  const hubs = devices.filter(d => HUB_KINDS.includes(d.kind));

  // Соседи каждого устройства и MAC → устройство.
  const neighbors = new Map<string, Set<string>>();
  for (const l of links) {
    if (!neighbors.has(l.fromDeviceId)) neighbors.set(l.fromDeviceId, new Set());
    if (!neighbors.has(l.toDeviceId)) neighbors.set(l.toDeviceId, new Set());
    neighbors.get(l.fromDeviceId)!.add(l.toDeviceId);
    neighbors.get(l.toDeviceId)!.add(l.fromDeviceId);
  }
  const byMac = new Map<string, Device>();
  for (const d of devices) {
    const m = normMac(d.mac);
    if (m && !byMac.has(m)) byMac.set(m, d);
  }

  const rows: AuditHubRow[] = [];
  for (const hub of hubs) {
    // Все следы сканирования этого хаба (могло быть несколько проходов).
    const ownMetas = metas.filter(m => hubOfMeta(hub, m));
    const via: AuditHubRow['via'] = ownMetas.length === 0 ? null
      : ownMetas.some(m => m.via === 'snmp') && ownMetas.some(m => m.via === 'ssh') ? 'both'
      : ownMetas.some(m => m.via === 'snmp') ? 'snmp' : 'ssh';
    const fdbMacs = new Set<string>();
    for (const m of ownMetas) for (const mac of m.fdbMacs || []) fdbMacs.add(normMac(mac));

    const neigh = neighbors.get(hub.id) || new Set<string>();
    const expected: Device[] = [];
    for (const mac of fdbMacs) {
      const d = byMac.get(mac);
      if (!d || d.id === hub.id) continue;
      if (HUB_KINDS.includes(d.kind)) continue; // L3/магистраль — не «оконечное на хабе»
      expected.push(d);
    }
    const missing: Device[] = [];
    const misplaced: Device[] = [];
    for (const d of expected) {
      if (neigh.has(d.id)) continue;
      missing.push(d);
      // Подключен к другому хабу — «пересажен» DHCP-звездой не туда.
      const nbs = neighbors.get(d.id) || new Set<string>();
      for (const nb of nbs) {
        const nd = devices.find(x => x.id === nb);
        if (nd && HUB_KINDS.includes(nd.kind) && nd.id !== hub.id) { misplaced.push(d); break; }
      }
    }

    let fromDhcp = 0;
    for (const nb of neigh) {
      const nd = devices.find(x => x.id === nb);
      if (nd && (nd.origin === 'dhcp' || (nd.tags || []).includes('discovered'))) fromDhcp++;
    }

    rows.push({
      hub, meta: ownMetas[0] || null, via,
      connectedNow: neigh.size,
      fromDhcp,
      expectedByFdb: expected,
      missing,
      misplaced,
    });
  }
  // Сначала проблемные и просканированные — отчёт читают сверху вниз.
  rows.sort((a, b) =>
    (b.missing.length - a.missing.length)
    || ((b.meta ? 1 : 0) - (a.meta ? 1 : 0))
    || a.hub.name.localeCompare(b.hub.name));
  return rows;
}

export interface AuditFix {
  deviceId: string;
  deviceName: string;
  hubId: string;
  hubName: string;
  /** 'add' — связи нет вовсе; 'move' — есть связь с другим хабом (её конец
   *  переставляем, как в topoRepair v0.70). */
  action: 'add' | 'move';
  /** для move — связь и сторона, которую переставляем. */
  linkId?: string;
  side?: 'from' | 'to';
}

/** План подключения: каждое устройство из FDB хаба — связать с этим хабом.
 *  Консервативно: только missing (нет связи с хабом). 'move' — когда висит
 *  ровно на одном другом хабе; 'add' — когда на хабах не висит вовсе. */
export function planAuditFixes(doc: NetMapDoc): AuditFix[] {
  const rows = auditHubs(doc);
  const devices = doc.devices || [];
  const byId = new Map(devices.map(d => [d.id, d]));
  const fixes: AuditFix[] = [];
  const planned = new Set<string>(); // устройство уже кому-то назначено
  for (const row of rows) {
    if (!row.meta) continue; // без следа сканирования не выдумываем
    for (const d of row.missing) {
      if (planned.has(d.id)) continue; // один владелец — первый по FDB
      planned.add(d.id);
      // Есть ли ровно один хаб-сосед?
      const hubNbs = (doc.links || [])
        .filter(l => l.fromDeviceId === d.id || l.toDeviceId === d.id)
        .map(l => ({ l, other: l.fromDeviceId === d.id ? l.toDeviceId : l.fromDeviceId }))
        .filter(x => { const nd = byId.get(x.other); return nd && HUB_KINDS.includes(nd.kind); });
      if (hubNbs.length === 1) {
        const x = hubNbs[0];
        fixes.push({
          deviceId: d.id, deviceName: d.name, hubId: row.hub.id, hubName: row.hub.name,
          action: 'move', linkId: x.l.id,
          side: x.l.fromDeviceId === x.other ? 'from' : 'to',
        });
      } else if (hubNbs.length === 0) {
        fixes.push({
          deviceId: d.id, deviceName: d.name, hubId: row.hub.id, hubName: row.hub.name,
          action: 'add',
        });
      }
      // 2+ хаба-соседа — неоднозначность, не трогаем.
    }
  }
  return fixes;
}
