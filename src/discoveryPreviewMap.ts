// v0.98.0: схематичная мини-карта результата автообнаружения — предпросмотр
// «что будет добавлено» прямо в окне результата, до применения.
//
// Раскладка послойная (BFS от шлюзов/роутеров): уровень 0 — шлюз, дальше
// ядро → распределение → доступ → клиенты. Детерминированно, без физики:
// одна и та же схема при одних и тех же входных данных, координаты всегда
// конечные (несвязанные устройства уходят последним слоем).

export interface PreviewNodeIn {
  id: string;
  label: string;
  sub: string;
  kind: string;
  /** Уже есть в проекте (якорь), новым устройством не является. */
  existing: boolean;
}

export interface PreviewLinkIn {
  a: string;
  b: string;
  label?: string;
}

export interface PreviewNode extends PreviewNodeIn {
  x: number;
  y: number;
  level: number;
}

export interface PreviewEdge {
  a: string;
  b: string;
  label?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const PREVIEW_NODE_W = 148;
export const PREVIEW_NODE_H = 34;

const LEVEL_DX = 182;
const ROW_DY = 46;
const PAD = 16;

const KIND_RANK: Record<string, number> = {
  gateway: 0, router: 0, switch: 1, patchpanel: 2, ap: 3,
  server: 4, vm: 4, vps: 4, dvr: 5, camera: 5, pbx: 5,
  pc: 6, pos: 6, printer: 6, lock: 6, cloud: 7, other: 8,
};

function rank(kind: string): number {
  return KIND_RANK[kind] ?? 8;
}

export function layoutPreviewMap(
  nodesIn: PreviewNodeIn[],
  linksIn: PreviewLinkIn[],
): { nodes: PreviewNode[]; edges: PreviewEdge[]; width: number; height: number } {
  const byId = new Map<string, PreviewNodeIn>();
  for (const n of nodesIn) if (!byId.has(n.id)) byId.set(n.id, n);

  // Связи: без дублей, самопетель и висячих концов.
  const edgeMap = new Map<string, PreviewLinkIn>();
  const adj = new Map<string, Set<string>>();
  const link = (x: string, y: string) => {
    if (!adj.has(x)) adj.set(x, new Set());
    adj.get(x)!.add(y);
  };
  for (const l of linksIn) {
    if (l.a === l.b || !byId.has(l.a) || !byId.has(l.b)) continue;
    const key = l.a < l.b ? l.a + '|' + l.b : l.b + '|' + l.a;
    if (!edgeMap.has(key)) edgeMap.set(key, l);
    link(l.a, l.b);
    link(l.b, l.a);
  }

  // Корни: шлюзы/роутеры; если их нет — коммутаторы; если и их нет — узел
  // с наибольшим числом связей (или просто первый).
  let roots = nodesIn.filter(n => n.kind === 'gateway' || n.kind === 'router');
  if (!roots.length) roots = nodesIn.filter(n => n.kind === 'switch');
  if (!roots.length && nodesIn.length) {
    let best = nodesIn[0];
    for (const n of nodesIn) {
      if ((adj.get(n.id)?.size ?? 0) > (adj.get(best.id)?.size ?? 0)) best = n;
    }
    roots = [best];
  }

  // BFS по слоям от всех корней сразу.
  const level = new Map<string, number>();
  const queue: string[] = [];
  for (const r of roots) {
    if (!level.has(r.id)) { level.set(r.id, 0); queue.push(r.id); }
  }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const lv = level.get(cur)!;
    for (const nb of adj.get(cur) ?? []) {
      if (!level.has(nb)) { level.set(nb, lv + 1); queue.push(nb); }
    }
  }
  let maxLevel = 0;
  for (const v of level.values()) maxLevel = Math.max(maxLevel, v);
  // Недостижимые из корней — отдельным последним слоем, а не в (0,0).
  for (const n of nodesIn) if (!level.has(n.id)) level.set(n.id, maxLevel + 1);
  if (nodesIn.length && roots.length === 0) for (const n of nodesIn) level.set(n.id, 0);

  const byLevel = new Map<number, PreviewNodeIn[]>();
  for (const n of nodesIn) {
    const lv = level.get(n.id)!;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv)!.push(n);
  }
  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
  const maxCount = Math.max(1, ...Array.from(byLevel.values()).map(v => v.length));

  const nodes: PreviewNode[] = [];
  const pos = new Map<string, { x: number; y: number }>();
  levels.forEach((lv, li) => {
    const group = byLevel.get(lv)!.slice().sort((a, b) =>
      rank(a.kind) - rank(b.kind) || a.label.localeCompare(b.label, 'ru'));
    group.forEach((n, i) => {
      const x = PAD + li * LEVEL_DX;
      const y = PAD + (i + (maxCount - group.length) / 2) * ROW_DY;
      pos.set(n.id, { x, y });
      nodes.push({ ...n, x, y, level: lv });
    });
  });

  const edges: PreviewEdge[] = [];
  for (const l of edgeMap.values()) {
    const pa = pos.get(l.a)!;
    const pb = pos.get(l.b)!;
    const right = pb.x >= pa.x;
    edges.push({
      a: l.a, b: l.b, label: l.label,
      x1: pa.x + (right ? PREVIEW_NODE_W : 0), y1: pa.y + PREVIEW_NODE_H / 2,
      x2: pb.x + (right ? 0 : PREVIEW_NODE_W), y2: pb.y + PREVIEW_NODE_H / 2,
    });
  }

  const width = PAD * 2 + Math.max(1, levels.length) * LEVEL_DX - (LEVEL_DX - PREVIEW_NODE_W);
  const height = Math.max(96, PAD * 2 + maxCount * ROW_DY);
  // Страховка от NaN/Infinity: координаты строятся только из индексов, но
  // если вход пуст — отдаём минимальный холст.
  return {
    nodes: nodes.map(n => ({ ...n, x: Number.isFinite(n.x) ? n.x : PAD, y: Number.isFinite(n.y) ? n.y : PAD })),
    edges,
    width: Number.isFinite(width) && width > 0 ? width : 320,
    height: Number.isFinite(height) && height > 0 ? height : 120,
  };
}
