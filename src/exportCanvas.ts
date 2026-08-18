/**
 * Export the current React Flow canvas to PNG / SVG / JSON.
 *
 * PNG / SVG — snapshot the .react-flow__viewport element with html-to-image.
 *   The viewport contains the transformed pan/zoom coordinate space with all
 *   nodes and edges — exactly what the user sees. We temporarily fit the view
 *   before snapshotting so the entire schema is in the frame regardless of
 *   what the user is currently looking at.
 *
 * JSON — dumps the raw NetMapDoc (devices + links + groups + vlans) from store.
 */

import { toPng, toSvg } from 'html-to-image';
import { useStore } from './store';

/** File-download helper. */
function download(blob: Blob | string, filename: string) {
  const url = typeof blob === 'string' ? blob : URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (typeof blob !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ExportOpts {
  pixelRatio?: number;      // for PNG — default 2 (retina)
  backgroundColor?: string; // default white
  padding?: number;         // extra padding around the schema, px
}

/** Grab the React Flow viewport element that holds nodes + edges. */
function getViewportEl(): HTMLElement | null {
  return document.querySelector('.react-flow__viewport') as HTMLElement | null;
}

/** Grab the .react-flow root (the whole scrollable canvas wrapper). */
function getRootEl(): HTMLElement | null {
  return document.querySelector('.react-flow') as HTMLElement | null;
}

/**
 * Compute the bounding box of all nodes on the canvas in flow coordinates.
 * We use it to size the SVG/PNG exactly to the content (no whitespace).
 */
function nodesBounds(padding = 40): { x: number; y: number; width: number; height: number } | null {
  const state = useStore.getState();
  const groups = state.doc.groups || [];
  const devs = state.doc.devices;
  if (devs.length === 0 && groups.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // Groups have absolute x/y/width/height.
  for (const g of groups) {
    minX = Math.min(minX, g.x);
    minY = Math.min(minY, g.y);
    maxX = Math.max(maxX, g.x + g.width);
    maxY = Math.max(maxY, g.y + (g.collapsed ? 44 : g.height));
  }

  // Devices — x/y are relative to their group (if any). Convert to absolute.
  // Assume a reasonable default rendered size since actual DOM sizes depend on
  // node type; this is only used as a fallback when no groups exist.
  for (const d of devs) {
    const par = d.groupId ? groups.find(g => g.id === d.groupId) : null;
    const ax = d.x + (par?.x ?? 0);
    const ay = d.y + (par?.y ?? 0);
    minX = Math.min(minX, ax);
    minY = Math.min(minY, ay);
    maxX = Math.max(maxX, ax + 200);   // approx card width
    maxY = Math.max(maxY, ay + 100);
  }

  return {
    x: minX - padding, y: minY - padding,
    width:  (maxX - minX) + padding * 2,
    height: (maxY - minY) + padding * 2,
  };
}

/**
 * Common preparation: temporarily hide UI-only chrome (minimap, controls, banners)
 * inside the exported area so the picture is clean.
 * Returns a cleanup callback to restore visibility.
 */
function hideChrome(): () => void {
  const selectors = [
    '.react-flow__controls',
    '.react-flow__minimap',
    '.react-flow__attribution',
    // App-level overlays that live inside the canvas container
    '[data-netmap-overlay]',
  ];
  const hidden: Array<[HTMLElement, string]> = [];
  for (const sel of selectors) {
    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      hidden.push([el, el.style.visibility]);
      el.style.visibility = 'hidden';
    });
  }
  return () => {
    for (const [el, prev] of hidden) el.style.visibility = prev;
  };
}

/**
 * PNG export — snapshots the full canvas (fits content, ignores current pan/zoom).
 */
export async function exportPng(projectName: string, opts: ExportOpts = {}) {
  const root = getRootEl();
  const viewport = getViewportEl();
  if (!root || !viewport) throw new Error('React Flow canvas not found');

  const bounds = nodesBounds(opts.padding ?? 40);
  if (!bounds) throw new Error('Empty schema — nothing to export');

  // v0.36.1: показать loading overlay пока html-to-image рендерит канвас.
  // На больших схемах это занимает 2-5 сек и без индикатора выглядит как фриз.
  window.dispatchEvent(new CustomEvent('netmap:progress-start', {
    detail: { id: 'export-png', title: 'Экспорт в PNG',
              message: `Готовим сцену (${Math.round(bounds.width)}×${Math.round(bounds.height)} px)…` },
  }));

  // We use the ROOT element (not viewport) so we get the full pan/zoom container
  // sized to bounds via width/height/style.transform overrides.
  const cleanup = hideChrome();
  // Save the current viewport transform so we can restore it after the snapshot.
  const prevTransform = viewport.style.transform;
  const prevRootW = root.style.width;
  const prevRootH = root.style.height;
  const rootBox = root.getBoundingClientRect();

  try {
    // Reset viewport to identity so html-to-image sees content in flow coords 1:1.
    viewport.style.transform = `translate(${-bounds.x}px, ${-bounds.y}px) scale(1)`;
    root.style.width  = `${bounds.width}px`;
    root.style.height = `${bounds.height}px`;

    const dataUrl = await toPng(root, {
      backgroundColor: opts.backgroundColor || '#FFFFFF',
      pixelRatio: opts.pixelRatio || 2,
      width:  bounds.width,
      height: bounds.height,
      cacheBust: true,
      // Skip broken images (e.g. icons that fail to inline) — we don't want the
      // whole snapshot to fail because of one asset.
      filter: (node) => {
        return !(node instanceof HTMLElement && node.dataset?.netmapOverlay === 'true');
      },
    });
    const ts = new Date().toISOString().slice(0, 10);
    download(dataUrl, `${sanitize(projectName)}-${ts}.png`);
  } finally {
    viewport.style.transform = prevTransform;
    root.style.width = prevRootW;
    root.style.height = prevRootH;
    // Prevent React Flow from getting confused about the size; ping a resize.
    window.dispatchEvent(new Event('resize'));
    void rootBox;
    cleanup();
    window.dispatchEvent(new CustomEvent('netmap:progress-end', {
      detail: { id: 'export-png' },
    }));
  }
}

/**
 * SVG export — vector, best for pasting into docs / printing.
 */
export async function exportSvg(projectName: string, opts: ExportOpts = {}) {
  const root = getRootEl();
  const viewport = getViewportEl();
  if (!root || !viewport) throw new Error('React Flow canvas not found');

  const bounds = nodesBounds(opts.padding ?? 40);
  if (!bounds) throw new Error('Empty schema — nothing to export');

  window.dispatchEvent(new CustomEvent('netmap:progress-start', {
    detail: { id: 'export-svg', title: 'Экспорт в SVG',
              message: `Готовим сцену (${Math.round(bounds.width)}×${Math.round(bounds.height)} px)…` },
  }));
  const cleanup = hideChrome();
  const prevTransform = viewport.style.transform;
  const prevRootW = root.style.width;
  const prevRootH = root.style.height;

  try {
    viewport.style.transform = `translate(${-bounds.x}px, ${-bounds.y}px) scale(1)`;
    root.style.width  = `${bounds.width}px`;
    root.style.height = `${bounds.height}px`;

    const dataUrl = await toSvg(root, {
      backgroundColor: opts.backgroundColor || '#FFFFFF',
      width:  bounds.width,
      height: bounds.height,
      cacheBust: true,
    });
    const ts = new Date().toISOString().slice(0, 10);
    download(dataUrl, `${sanitize(projectName)}-${ts}.svg`);
  } finally {
    viewport.style.transform = prevTransform;
    root.style.width = prevRootW;
    root.style.height = prevRootH;
    window.dispatchEvent(new Event('resize'));
    cleanup();
    window.dispatchEvent(new CustomEvent('netmap:progress-end', {
      detail: { id: 'export-svg' },
    }));
  }
}

/**
 * JSON export — the raw NetMapDoc for backup / migration.
 */
export function exportJson(projectName: string) {
  const doc = useStore.getState().doc;
  const json = JSON.stringify(doc, (_k, v) => {
    if (_k === 'liveStatus' || _k === 'lastRttMs' || _k === 'lastCheckedAt') return undefined;
    return v;
  }, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const ts = new Date().toISOString().slice(0, 10);
  download(blob, `${sanitize(projectName)}-${ts}.json`);
}

function sanitize(name: string): string {
  return name.replace(/[^\w\-\u0400-\u04FF]+/g, '_').replace(/^_+|_+$/g, '') || 'netmap';
}
