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
import { inferLayer } from './layers';

export const ENDPOINT_KINDS: DeviceKind[] = ['ap', 'camera', 'pc', 'pos', 'printer', 'lock', 'other'];

export type DeviceMode = 'card' | 'beacon' | 'folded' | 'hidden';
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
  /** v0.72: для видимых хабов — число скрытых фокусом соседей («+N»). */
  hiddenExtra: Map<string, number>;
}

export interface ScenePlanInput {
  zoomBand: 'near' | 'mid' | 'far';
  collapseEndpoints: boolean;
  viewMode: 'modern' | 'legacy';
  /** Необязательный предикат видимости связи (фильтры кабелей/VLAN/слоёв). */
  linkVisible?: (l: NetMapDoc['links'][number]) => boolean;
  /** v0.72 focus-first (progressive disclosure): множество видимых устройств;
   *  null/undefined — показываем всё. Остальные — 'hidden', а на видимых
   *  хабах считается hiddenExtra («+N» скрытых соседей для раскрытия). */
  focus?: Set<string> | null;
}

const isEndpoint = (d: Device) => ENDPOINT_KINDS.includes(d.kind);
const isHubKind = (k: DeviceKind) => k === 'switch' || k === 'router';

export function computeScenePlan(doc: NetMapDoc, input: ScenePlanInput): ScenePlan {
  const deviceMode = new Map<string, DeviceMode>();
  const groupMode = new Map<string, GroupMode>();
  const foldedInto = new Map<string, string>();
  const bundles: BundleSpec[] = [];
  const hiddenExtra = new Map<string, number>();

  const groups = doc.groups || [];
  const devices = doc.devices;
  const byId = new Map(devices.map(d => [d.id, d]));

  // v0.72 focus-first: null — показываем всё; иначе видимы только из focus.
  const focus = input.focus ?? null;
  const isHidden = (id: string) => !!focus && !focus.has(id);

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
  // v0.72: под фокусом считаем только ВИДИМЫХ детей — опустевшая группа
  // скрывается целиком, вместо пустой рамки/пилюли.
  const childCount = new Map<string, number>();
  for (const d of devices) {
    if (!d.groupId || isHidden(d.id)) continue;
    childCount.set(d.groupId, (childCount.get(d.groupId) || 0) + 1);
  }
  for (const g of groups) {
    const hasKids = (childCount.get(g.id) || 0) > 0
      || groups.some(x => x.parentId === g.id && groupMode.get(x.id) !== 'hidden');
    if (!hasKids) { groupMode.set(g.id, 'hidden'); continue; }      // «спящие» не рисуем
    if (input.viewMode === 'modern' && (input.zoomBand === 'far' || g.collapsed)) {
      groupMode.set(g.id, 'pill');                                  // обзор и ручной коллапс
    } else {
      groupMode.set(g.id, 'frame');
    }
  }

  // --- Устройства: card / beacon / folded / hidden ------------------------
  const far = input.viewMode === 'modern' && input.zoomBand === 'far';
  const foldEndpoints = input.viewMode === 'modern' && (far || input.collapseEndpoints);
  for (const d of devices) {
    // v0.72: вне фокуса устройство не рисуется вовсе.
    if (isHidden(d.id)) { deviceMode.set(d.id, 'hidden'); continue; }
    // Обзор: состав пилюли фасуется в пилюлю.
    if (far && d.groupId && groupMode.get(d.groupId) === 'pill') {
      deviceMode.set(d.id, 'folded'); foldedInto.set(d.id, d.groupId); continue;
    }
    // Оконечное с ровно одним видимым хабом фасуется в него (обзор всегда;
    // на mid/near — при включённом collapseEndpoints, как раньше).
    // Под фокусом хаб тоже должен быть видим — иначе устройство исчезло бы
    // бесследно (его «+N» живёт на хабе).
    if (isEndpoint(d) && foldEndpoints) {
      const hubs = (hubNeighbor.get(d.id) || []).filter(h => byId.has(h) && !isHidden(h)
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
      // v0.72: связь со скрытым фокусом концом не рисуется — иначе «пучок»
      // висел бы в пустоту.
      if (isHidden(l.fromDeviceId) || isHidden(l.toDeviceId)) continue;
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

  // --- v0.72: «+N» скрытых соседей на видимых хабах ------------------------
  if (focus) {
    for (const l of links) {
      const a = byId.get(l.fromDeviceId), b = byId.get(l.toDeviceId);
      if (!a || !b) continue;
      if (focus.has(a.id) && isHubKind(a.kind) && !focus.has(b.id)) {
        hiddenExtra.set(a.id, (hiddenExtra.get(a.id) || 0) + 1);
      }
      if (focus.has(b.id) && isHubKind(b.kind) && !focus.has(a.id)) {
        hiddenExtra.set(b.id, (hiddenExtra.get(b.id) || 0) + 1);
      }
    }
  }

  return { deviceMode, groupMode, foldedInto, bundles, hiddenExtra };
}

/** Человекочитаемая сводка плана — для отладки и будущих тултипов обзора. */
export function summarizePlan(p: ScenePlan): string {
  let cards = 0, beacons = 0, folded = 0, hiddenDev = 0, frames = 0, pills = 0, hidden = 0;
  p.deviceMode.forEach(m => {
    if (m === 'card') cards++; else if (m === 'beacon') beacons++;
    else if (m === 'folded') folded++; else hiddenDev++;
  });
  p.groupMode.forEach(m => { if (m === 'frame') frames++; else if (m === 'pill') pills++; else hidden++; });
  const extra = hiddenDev > 0 ? ` · вне фокуса ${hiddenDev}` : '';
  return `карточек ${cards} · маяков ${beacons} · фасовано ${folded}${extra} · рамок ${frames} · пилюль ${pills} · скрыто групп ${hidden} · пучков ${p.bundles.length}`;
}

// ---------------------------------------------------------------------------
// v0.71.0 — навигация и проблемность.

/** С скольких устройств карта считается большой (старт в обзоре). */
export const BIG_MAP_DEVICES = 100;
/** Потолок зума при старте большой карты в обзоре (far-ступень < 0.31). */
export const OVERVIEW_START_ZOOM = 0.28;

/** Потолок зума первичного fit-view: большие карты стартуют в обзоре. */
export function overviewZoomCap(deviceCount: number, preferOverview: boolean): number {
  return preferOverview && deviceCount >= BIG_MAP_DEVICES ? OVERVIEW_START_ZOOM : 1.5;
}

/** Heatmap проблемности: для каждого хаба — число недоступных соседей
 *  (liveStatus 'down' по прямым связям). 0 = зелёный, >0 = красный бейдж. */
export function downCountsByHub(doc: NetMapDoc): Map<string, number> {
  const byId = new Map((doc.devices || []).map(d => [d.id, d]));
  const hubKind = (k: DeviceKind | undefined) => k === 'switch' || k === 'router';
  const out = new Map<string, number>();
  for (const l of doc.links || []) {
    const a = byId.get(l.fromDeviceId), b = byId.get(l.toDeviceId);
    if (!a || !b) continue;
    if (hubKind(a.kind) && b.liveStatus === 'down') out.set(a.id, (out.get(a.id) || 0) + 1);
    if (hubKind(b.kind) && a.liveStatus === 'down') out.set(b.id, (out.get(b.id) || 0) + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// v0.72.0 — focus-first (progressive disclosure по образцу yFiles/NetBrain).

/** Кольцо раскрытия от ядра по умолчанию (ядро + 2 кольца соседей). */
export const FOCUS_RINGS = 2;

/** Начальный фокус: BFS от ядра сети на N колец.
 *  Ядро — устройства слоя core (интернет-шлюз/роутеры); если таких нет,
 *  берём устройство с максимальной степенью. Детерминированно (сортировка
 *  id), поэтому один и тот же документ всегда даёт один и тот же старт. */
export function computeFocusSet(doc: NetMapDoc, rings: number = FOCUS_RINGS): Set<string> {
  const devices = doc.devices || [];
  if (devices.length === 0) return new Set();
  const degree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    degree.set(a, (degree.get(a) || 0) + 1);
    (adj.get(a) || adj.set(a, []).get(a)!).push(b);
  };
  for (const l of doc.links || []) {
    add(l.fromDeviceId, l.toDeviceId);
    add(l.toDeviceId, l.fromDeviceId);
  }
  const cores = devices.filter(d => inferLayer(d) === 'core');
  const seeds: string[] = cores.length
    ? cores.map(d => d.id).sort()
    : [devices.slice().sort((a, b) =>
        (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || a.id.localeCompare(b.id))[0].id];

  const seen = new Set<string>(seeds);
  let frontier = [...seeds];
  for (let ring = 0; ring < rings; ring++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) || []) {
        if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
      }
    }
    frontier = next;
  }
  return seen;
}

// ---------------------------------------------------------------------------
// v0.73.0 — LOD-фейдинг подписей и агрегация оконечных на карточке хаба.

/** Прозрачность подписей рёбер по ступени зума (yFiles-style label fading):
 *  near — fully visible; mid — приглушены (не конкурируют со структурой);
 *  far — не рендерятся вовсе (существующее правило v0.57). */
export function labelFadeByBand(band: 'near' | 'mid' | 'far'): number {
  if (band === 'near') return 1;
  if (band === 'mid') return 0.55;
  return 0;
}

/** С какого числа однотипных оконечных карточка хаба сворачивает их
 *  в пилюлю «N × тип» (приём NetBrain/yFiles: счётчик вместо стены точек). */
export const ENDPOINT_AGG_THRESHOLD = 8;

export interface EndpointGroup {
  kind: DeviceKind;
  ids: string[];
  /** true — группа свернута в пилюлю «N × тип». */
  aggregated: boolean;
}

/** Группирует оконечных соседей хаба по типу (ENDPOINT_ORDER, внутри типа —
 *  по имени). Группы крупнее порога помечаются aggregated. Чистая функция —
 *  покрыта юнит-тестами на реальном доке. */
export function groupEndpointsForCard(
  peers: Device[],
  endpointKinds: DeviceKind[],
  order: DeviceKind[],
  threshold: number = ENDPOINT_AGG_THRESHOLD,
): EndpointGroup[] {
  const byKind = new Map<DeviceKind, Device[]>();
  for (const d of peers) {
    if (!endpointKinds.includes(d.kind)) continue;
    const arr = byKind.get(d.kind) || [];
    arr.push(d);
    byKind.set(d.kind, arr);
  }
  const out: EndpointGroup[] = [];
  for (const kind of order) {
    const arr = byKind.get(kind);
    if (!arr || arr.length === 0) continue;
    arr.sort((a, b) => a.name.localeCompare(b.name));
    out.push({ kind, ids: arr.map(d => d.id), aggregated: arr.length > threshold });
  }
  return out;
}
