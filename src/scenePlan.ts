/**
 * v0.68.0 — «Контракт сцены»: единые правила отображения (LOD + фасовка).
 * См. docs/display-logic.md — человекочитаемая спецификация этих правил.
 *
 * Модуль чистый: (doc, zoomBand, collapseEndpoints, viewMode) → план сцены.
 * Canvas больше не держит разрозненные эвристики «кого спрятать»: он берёт
 * план здесь, один раз за изменение входных данных (useMemo).
 *
 * Уровни детализации:
 *   near  — карточки устройств + портовые якоря (см. exposesPortAnchors);
 *   mid   — карточки, портовые якоря только у выделенного/под курсором,
 *           рёбра к боковым якорям по геометрии;
 *   far   — ОБЗОР: хабы-маяки, оконечные с ровно одним хабом фасуются в хаб,
 *           группы — пилюли со счётчиком (весь состав фасуется в пилюлю),
 *           связи агрегируются в пучки «×N» между видимыми сущностями.
 *
 * Инварианты:
 *   - каждое устройство представлено на каждой ступени: собой, счётчиком в
 *     хабе или счётчиком в пилюле группы (ничто не «пропадает»);
 *   - план детерминирован и идемпотентен (нет дрейфа при повторных зумах);
 *   - пустые («спящие») группы не рендерятся.
 */

import type { Device, DeviceKind, NetMapDoc } from './types';

export const ENDPOINT_KINDS: DeviceKind[] = ['ap', 'camera', 'pc', 'pos', 'printer', 'lock', 'other'];

export type DeviceMode = 'card' | 'beacon' | 'folded';
export type GroupMode = 'frame' | 'pill' | 'hidden';

export interface BundleSpec {
  id: string;
  a: string;          // id видимой сущности (device или group)
  b: string;
  count: number;      // сколько физических кабелей агрегировано
  trunk: boolean;     // магистраль (оба конца — инфраструктура)
}

export interface ScenePlan {
  deviceMode: Map<string, DeviceMode>;
  groupMode: Map<string, GroupMode>;
  /** устройство → видимая сущность, в которую оно фасуется (хаб или группа). */
  foldedInto: Map<string, string>;
  /** агрегированные связи обзора (пусто на near/mid). */
  bundles: BundleSpec[];
}

export interface ScenePlanInput {
  zoomBand: 'near' | 'mid' | 'far';
  collapseEndpoints: boolean;
  viewMode: 'modern' | 'legacy';
  /** Необязательный предикат видимости связи (фильтры кабелей/VLAN/слоёв). */
  linkVisible?: (l: NetMapDoc['links'][number]) => boolean;
}

const isEndpoint = (d: Device) => ENDPOINT_KINDS.includes(d.kind);
const isHubKind = (k: DeviceKind) => k === 'switch' || k === 'router';

export function computeScenePlan(doc: NetMapDoc, input: ScenePlanInput): ScenePlan {
  const deviceMode = new Map<string, DeviceMode>();
  const groupMode = new Map<string, GroupMode>();
  const foldedInto = new Map<string, string>();
  const bundles: BundleSpec[] = [];

  const groups = doc.groups || [];
  const devices = doc.devices;
  const byId = new Map(devices.map(d => [d.id, d]));

  // Соседи-хабы каждого устройства (для фасовки оконечных).
  const hubNeighbor = new Map<string, string[]>();
  const links = (doc.links || []).filter(l => (input.linkVisible ? input.linkVisible(l) : true));
  for (const l of links) {
    const a = byId.get(l.fromDeviceId), b = byId.get(l.toDeviceId);
    if (!a || !b) continue;
    if (isHubKind(b.kind)) (hubNeighbor.get(a.id) || hubNeighbor.set(a.id, []).get(a.id)!).push(b.id);
    if (isHubKind(a.kind)) (hubNeighbor.get(b.id) || hubNeighbor.set(b.id, []).get(b.id)!).push(a.id);
  }

  // --- Группы: hidden / pill / frame -------------------------------------
  const childCount = new Map<string, number>();
  for (const d of devices) if (d.groupId) childCount.set(d.groupId, (childCount.get(d.groupId) || 0) + 1);
  for (const g of groups) {
    const hasKids = (childCount.get(g.id) || 0) > 0 || groups.some(x => x.parentId === g.id);
    if (!hasKids) { groupMode.set(g.id, 'hidden'); continue; }      // «спящие» не рисуем
    if (input.viewMode === 'modern' && (input.zoomBand === 'far' || g.collapsed)) {
      groupMode.set(g.id, 'pill');                                  // обзор и ручной коллапс
    } else {
      groupMode.set(g.id, 'frame');
    }
  }

  // --- Устройства: card / beacon / folded ---------------------------------
  const far = input.viewMode === 'modern' && input.zoomBand === 'far';
  const foldEndpoints = input.viewMode === 'modern' && (far || input.collapseEndpoints);
  for (const d of devices) {
    // Обзор: состав пилюли фасуется в пилюлю.
    if (far && d.groupId && groupMode.get(d.groupId) === 'pill') {
      deviceMode.set(d.id, 'folded'); foldedInto.set(d.id, d.groupId); continue;
    }
    // Оконечное с ровно одним видимым хабом фасуется в него (обзор всегда;
    // на mid/near — при включённом collapseEndpoints, как раньше).
    if (isEndpoint(d) && foldEndpoints) {
      const hubs = (hubNeighbor.get(d.id) || []).filter(h => byId.has(h)
        && !(byId.get(h)!.groupId && groupMode.get(byId.get(h)!.groupId!) === 'pill'));
      if (hubs.length === 1) { deviceMode.set(d.id, 'folded'); foldedInto.set(d.id, hubs[0]); continue; }
    }
    deviceMode.set(d.id, far ? 'beacon' : 'card');
  }
  // Транзит: устройство, фасованное в хаб, который сам фасован в пилюлю.
  for (const d of devices) {
    let rep = foldedInto.get(d.id);
    const seen = new Set<string>();
    while (rep && !seen.has(rep)) {
      seen.add(rep);
      const next = foldedInto.get(rep);
      if (!next) break;
      foldedInto.set(d.id, next);
      rep = next;
    }
  }

  // --- Связи: на far агрегируем в пучки между видимыми сущностями ---------
  if (far) {
    const rep = (id: string): string => foldedInto.get(id) || id;
    const repIsInfra = (id: string): boolean => {
      if (foldedInto.has(id)) return true;              // пилюля группы — инфраструктура
      const d = byId.get(id);
      return !!d && !isEndpoint(d);
    };
    const agg = new Map<string, { a: string; b: string; count: number; trunk: boolean }>();
    for (const l of links) {
      const ra = rep(l.fromDeviceId), rb = rep(l.toDeviceId);
      if (ra === rb) continue;                          // всё внутри одной сущности
      const key = ra < rb ? `${ra}|${rb}` : `${rb}|${ra}`;
      const e = agg.get(key) || { a: ra < rb ? ra : rb, b: ra < rb ? rb : ra, count: 0, trunk: true };
      e.count++;
      e.trunk = e.trunk && repIsInfra(ra) && repIsInfra(rb);
      agg.set(key, e);
    }
    for (const [key, e] of agg) {
      bundles.push({ id: 'bndl:' + key, a: e.a, b: e.b, count: e.count, trunk: e.trunk });
    }
  }

  return { deviceMode, groupMode, foldedInto, bundles };
}

/** Человекочитаемая сводка плана — для отладки и будущих тултипов обзора. */
export function summarizePlan(p: ScenePlan): string {
  let cards = 0, beacons = 0, folded = 0, frames = 0, pills = 0, hidden = 0;
  p.deviceMode.forEach(m => { if (m === 'card') cards++; else if (m === 'beacon') beacons++; else folded++; });
  p.groupMode.forEach(m => { if (m === 'frame') frames++; else if (m === 'pill') pills++; else hidden++; });
  return `карточек ${cards} · маяков ${beacons} · фасовано ${folded} · рамок ${frames} · пилюль ${pills} · скрыто групп ${hidden} · пучков ${p.bundles.length}`;
}
