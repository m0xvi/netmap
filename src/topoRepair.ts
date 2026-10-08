/**
 * v0.70.0 — best-effort ремонт топологии по FDB-хинтам.
 *
 * Предыстория (разбор реальной схемы «Усадьба», docs/real-map-analysis.md):
 * discovery строил связи «шлюз ↔ оконечное» по bridge FDB шлюза, хотя по
 * хинту («bridge FDB on 2G-SW_RoomOO-1-3») видно, что MAC выглядывает с
 * порта, ведущего к нижестоящему свитчу. Если имя свитча узнаётся в токене
 * порта и свитч есть в доке — конец связи переставляется со шлюза на свитч.
 *
 * Правила (консервативные, ничего не выдумываем):
 *   - берём только связи с меткой «bridge FDB on <token>»;
 *   - «ядерный» конец — роутер; второй конец — не свитч/роутер;
 *   - свитч S ищем по вхождению имени (≥5 символов) в токен, S ≠ ядро, S ≠ второй конец;
 *   - если пара S↔E уже связана — пропускаем (не плодим дубли);
 *   - не тронутые хинтом связи не меняем.
 * Чистая функция: doc → план; применяет store.applyHintRepairs (история + persist).
 */

import type { Device, NetMapDoc } from './types';

export interface HintRepair {
  linkId: string;
  /** какой конец меняем */
  side: 'from' | 'to';
  oldDeviceId: string;
  newDeviceId: string;
  switchName: string;
  token: string;
}

const HUB_KINDS = ['switch', 'router'];

export function planHintRepairs(doc: NetMapDoc): HintRepair[] {
  const devices = doc.devices || [];
  const byId = new Map(devices.map(d => [d.id, d]));
  const switches = devices.filter(d => d.kind === 'switch' && (d.name || '').trim().length >= 5);
  const exists = new Set((doc.links || []).map(l => [l.fromDeviceId, l.toDeviceId].sort().join('|')));

  const repairs: HintRepair[] = [];
  for (const l of doc.links || []) {
    const m = /bridge FDB on (\S+)/.exec(l.label || '');
    if (!m) continue;
    const token = (m[1] || '').toLowerCase();
    if (!token) continue;
    const a = byId.get(l.fromDeviceId);
    const b = byId.get(l.toDeviceId);
    if (!a || !b) continue;
    // Ядерный конец — роутер; переставляем именно его.
    let side: 'from' | 'to' | null = null;
    let other: Device | null = null;
    if (a.kind === 'router' && !HUB_KINDS.includes(b.kind)) { side = 'from'; other = b; }
    else if (b.kind === 'router' && !HUB_KINDS.includes(a.kind)) { side = 'to'; other = a; }
    if (!side || !other) continue;

    // Свитч, узнаваемый в токене порта (самый длинный кандидат выигрывает).
    let best: Device | null = null;
    for (const s of switches) {
      const nm = s.name.toLowerCase();
      if (s.id === other.id) continue;
      if (token.includes(nm) && (!best || nm.length > (best.name || '').length)) best = s;
    }
    if (!best) continue;
    const pairKey = [best.id, other.id].sort().join('|');
    if (exists.has(pairKey)) continue; // уже есть честная связь — не дублируем
    exists.add(pairKey);
    repairs.push({
      linkId: l.id,
      side,
      oldDeviceId: side === 'from' ? a.id : b.id,
      newDeviceId: best.id,
      switchName: best.name,
      token: m[1],
    });
  }
  return repairs;
}

export function applyHintRepairsToDoc(doc: NetMapDoc, repairs: HintRepair[]): NetMapDoc {
  if (repairs.length === 0) return doc;
  const byLink = new Map(repairs.map(r => [r.linkId, r]));
  const links = (doc.links || []).map(l => {
    const r = byLink.get(l.id);
    if (!r) return l;
    return r.side === 'from'
      ? { ...l, fromDeviceId: r.newDeviceId }
      : { ...l, toDeviceId: r.newDeviceId };
  });
  return { ...doc, links };
}
