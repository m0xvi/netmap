/**
 * v0.69.0 — правила пучков параллельных кабелей (чистые функции).
 *
 * Проблема реальных карт: между парой хабов бывает десятки физических
 * линков (FDB/ARP-хинты, агрегаты) — веер расползается на сотни пикселей
 * «рамками», а каждый линк тащит свой лейбл. Правила:
 *   1) веер ограничен ±MAX_FAN_PX (кабели дальше едут по внешней дорожке);
 *   2) пар с больше чем AGGREGATE_THRESHOLD параллелей рисуем ОДНИМ
 *      пучком «×N» (bundleEdge) на всех ступенях — детальность по клику
 *      остаётся во вкладке «Порты» и в списке связей.
 */

/** Перпендикулярный шаг веера, px (историческое значение v0.23). */
export const BUNDLE_SPACING = 14;
/** Максимальный уход кабеля от оси пары, px. */
export const MAX_FAN_PX = 42;
/** Больше скольких параллелей пара агрегируется в пучок «×N». */
export const AGGREGATE_THRESHOLD = 6;

/** Знаковый перпендикулярный офсет кабеля в пучке (с ограничением). */
export function fanOffset(index: number, total: number): number {
  if (total <= 1) return 0;
  const steps = index - (total - 1) / 2;
  const off = steps * BUNDLE_SPACING;
  return Math.max(-MAX_FAN_PX, Math.min(MAX_FAN_PX, off));
}

/** Агрегировать ли пару в один пучок «×N». */
export const shouldAggregate = (total: number) => total > AGGREGATE_THRESHOLD;
