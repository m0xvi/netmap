/**
 * v0.66.0 — радиальная раскладка «радуга» (приём макета C, map-variants.html).
 *
 * Геометрия (в отличие от dagre — без иерархических слоёв):
 *   - ядро (устройство с layer 'core', иначе самый связный узел) — в центре;
 *   - соседи ядра (хабы) — по орбите R1, следующие кольца — R2, R3…;
 *   - оконечные устройства (AP/камеры/ПК/…) — дугами вокруг своего хаба
 *     (наружу от центра), как клиенты вокруг хабов в макете;
 *   - группы — единый «мета-узел» на орбите, состав раскладывается сеткой
 *     внутри рамки (координаты детей — ОТНОСИТЕЛЬНЫЕ, как ожидает RF);
 *   - несвязанные устройства — ряд под схемой.
 *
 * Модуль чистый (без стора/DOM) — легко тестировать. Формат результата
 * повторяет computeAutoLayout: absolute-позиции устройств без группы,
 * относительные — у детей групп, плюс рамки групп.
 */

import type { NetMapDoc } from './types';
import { inferLayer } from './layers';

// Локальная копия (не импорт из ModernDeviceNode — тот тянет store, был бы цикл).
const ENDPOINT_KINDS: string[] = ['ap', 'camera', 'pc', 'pos', 'printer', 'lock', 'other'];

export interface RadialResult {
  positions: Map<string, { x: number; y: number }>;
  groupPositions: Map<string, { x: number; y: number; width: number; height: number }>;
}

const CX = 1400;          // центр сцены (абсолютные координаты канваса)
const CY = 1000;
const RING_STEP = 380;    // шаг колец вокруг ядра
const ARC_R0 = 110;       // первый радиус дуги клиентов вокруг хаба
const ARC_DR = 30;        // шаг следующих рядов дуги

export function computeRadialLayout(doc: NetMapDoc): RadialResult {
  const positions = new Map<string, { x: number; y: number }>();
  const groupPositions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const devices = doc.devices || [];
  const groups = doc.groups || [];
  const links = doc.links || [];
  if (devices.length === 0) return { positions, groupPositions };

  const byId = new Map(devices.map(d => [d.id, d]));
  const groupById = new Map(groups.map(g => [g.id, g]));
  const isEndpoint = (id: string) => {
    const d = byId.get(id);
    return !!d && ENDPOINT_KINDS.includes(d.kind);
  };

  // 1. Мета-узлы: устройство без группы = 'd:<id>', группа = 'g:<id>'.
  const metaOf = new Map<string, string>();
  for (const d of devices) {
    metaOf.set(d.id, d.groupId && groupById.has(d.groupId) ? `g:${d.groupId}` : `d:${d.id}`);
  }
  const metaIds = Array.from(new Set(metaOf.values())).sort();

  // 2. Соседство мета-узлов (внутригрупповые связи игнорируем).
  const adj = new Map<string, Set<string>>(metaIds.map(m => [m, new Set<string>()]));
  const neighborsOf = new Map<string, Set<string>>(devices.map(d => [d.id, new Set<string>()]));
  for (const l of links) {
    if (!byId.has(l.fromDeviceId) || !byId.has(l.toDeviceId)) continue;
    neighborsOf.get(l.fromDeviceId)!.add(l.toDeviceId);
    neighborsOf.get(l.toDeviceId)!.add(l.fromDeviceId);
    const a = metaOf.get(l.fromDeviceId)!;
    const b = metaOf.get(l.toDeviceId)!;
    if (a !== b) { adj.get(a)!.add(b); adj.get(b)!.add(a); }
  }

  // 3. Ядро: мета-узел с устройством layer 'core' (при нескольких — самый
  //    связный); иначе самый связный мета-узел; иначе первый по имени.
  const deg = (m: string) => adj.get(m)!.size;
  const coreMetas = metaIds.filter(m =>
    devices.some(d => metaOf.get(d.id) === m && inferLayer(d) === 'core'));
  const byDegree = (a: string, b: string) => deg(b) - deg(a) || (a < b ? -1 : 1);
  const core = coreMetas.length
    ? coreMetas.sort(byDegree)[0]
    : metaIds.slice().sort(byDegree)[0];

  // 4. BFS-кольца от ядра.
  const depth = new Map<string, number>([[core, 0]]);
  let frontier = [core];
  while (frontier.length) {
    const next: string[] = [];
    for (const m of frontier) {
      for (const n of adj.get(m)!) {
        if (!depth.has(n)) { depth.set(n, depth.get(m)! + 1); next.push(n); }
      }
    }
    frontier = next;
  }

  // 5. Оконечные с «якорем» (несосед-оконечное или группа) — не в кольцо,
  //    а дугой вокруг якоря. Остальные оконечные остаются в кольцах.
  const anchorOf = new Map<string, string>(); // endpoint device id → meta якоря
  for (const d of devices) {
    if (!isEndpoint(d.id) || (d.groupId && groupById.has(d.groupId))) continue;
    const nbrs = Array.from(neighborsOf.get(d.id) || []).sort();
    const anchor = nbrs.find(n => {
      const m = metaOf.get(n)!;
      return m.startsWith('g:') || !isEndpoint(n);
    });
    if (anchor) anchorOf.set(d.id, metaOf.get(anchor)!);
  }

  // 6. Расстановка мета-узлов по кольцам.
  const metaPos = new Map<string, { x: number; y: number }>();
  metaPos.set(core, { x: CX, y: CY });
  const rings = new Map<number, string[]>();
  for (const [m, dpt] of depth) {
    if (dpt === 0) continue;
    if (m.startsWith('d:') && anchorOf.has(m.slice(2))) continue; // уйдёт дугой
    const arr = rings.get(dpt) || [];
    arr.push(m);
    rings.set(dpt, arr);
  }
  let maxDepth = 0;
  for (const [dpt, members] of rings) {
    maxDepth = Math.max(maxDepth, dpt);
    members.sort();
    const R = dpt * RING_STEP;
    members.forEach((m, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / members.length;
      metaPos.set(m, { x: CX + Math.cos(ang) * R, y: CY + Math.sin(ang) * R });
    });
  }
  // Несвязанные — ряд внизу.
  const orphans = metaIds.filter(m => !depth.has(m) && !(m.startsWith('d:') && anchorOf.has(m.slice(2))));
  orphans.forEach((m, i) => {
    metaPos.set(m, {
      x: CX - ((orphans.length - 1) * 280) / 2 + i * 280,
      y: CY + (maxDepth + 1) * RING_STEP,
    });
  });

  // 7. Группы: сетка внутри рамки; координаты детей относительные.
  const membersByGroup = new Map<string, string[]>();
  for (const d of devices) {
    if (d.groupId && groupById.has(d.groupId)) {
      const arr = membersByGroup.get(d.groupId) || [];
      arr.push(d.id);
      membersByGroup.set(d.groupId, arr);
    }
  }
  for (const [gid, members] of membersByGroup) {
    members.sort((a, b) => (byId.get(a)!.name || a).localeCompare(byId.get(b)!.name || b));
    const cols = Math.max(1, Math.ceil(Math.sqrt(members.length * 1.6)));
    const rows = Math.ceil(members.length / cols);
    const width = Math.max(260, cols * 230 + 60);
    const height = Math.max(140, 70 + rows * 110 + 30);
    const c = metaPos.get(`g:${gid}`) || { x: CX, y: CY };
    groupPositions.set(gid, {
      x: Math.round(c.x - width / 2), y: Math.round(c.y - height / 2), width, height,
    });
    members.forEach((id, i) => {
      positions.set(id, { x: 40 + (i % cols) * 230, y: 70 + Math.floor(i / cols) * 110 });
    });
  }

  // 8. Оконечные дугой вокруг якоря (приём макета C: веер наружу от центра).
  const arcGroups = new Map<string, string[]>();
  for (const [devId, anchorMeta] of anchorOf) {
    const arr = arcGroups.get(anchorMeta) || [];
    arr.push(devId);
    arcGroups.set(anchorMeta, arr);
  }
  for (const [anchorMeta, ids] of arcGroups) {
    const anchor = metaPos.get(anchorMeta);
    if (!anchor) continue;
    ids.sort((a, b) => (byId.get(a)!.name || a).localeCompare(byId.get(b)!.name || b));
    const n = ids.length;
    const per = Math.max(4, Math.round(Math.sqrt(n) * 3));
    const rowsN = Math.ceil(n / per);
    const span = Math.max(0.6, rowsN * 0.18 + 0.6);
    const dx = anchor.x - CX, dy = anchor.y - CY;
    const baseAng = (dx === 0 && dy === 0) ? -Math.PI / 2 : Math.atan2(dy, dx);
    const a0 = baseAng - span / 2;
    ids.forEach((id, j) => {
      const rr = ARC_R0 + (j % rowsN) * ARC_DR;
      const aa = a0 + (Math.floor(j / rowsN) / Math.max(1, per - 1)) * span;
      positions.set(id, {
        x: anchor.x + Math.cos(aa) * rr,
        y: anchor.y + Math.sin(aa) * rr,
      });
    });
  }

  // 9. Остальные устройства (не в группе, не дуговые) — позиция мета-узла.
  for (const d of devices) {
    if (positions.has(d.id)) continue;
    const p = metaPos.get(metaOf.get(d.id)!);
    if (p) positions.set(d.id, { x: p.x, y: p.y });
  }

  // 10. Контракт safeFinite: никаких NaN/Infinity наружу.
  for (const [id, p] of positions) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) positions.set(id, { x: CX, y: CY });
  }
  for (const [id, g] of groupPositions) {
    if (![g.x, g.y, g.width, g.height].every(Number.isFinite)) {
      groupPositions.set(id, { x: CX - 200, y: CY - 150, width: 400, height: 300 });
    }
  }

  return { positions, groupPositions };
}
