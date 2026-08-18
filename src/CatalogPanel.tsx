/**
 * v0.43.4 — Redesigned device catalog panel (reference "Smart Accordion" style).
 *
 * Layout:
 *   Header:  [cube icon]  Каталог устройств        [filter] [...]
 *   Search:  [magnifier] Search devices...               [Ctrl+K]
 *   Body:    Accordion — one row per device kind (Роутеры / Свитчи / …)
 *            Each row: [icon] LABEL          [count] [chevron]
 *            When expanded — templates listed underneath as compact rows
 *            (drag'n'drop still works; click to add to canvas centre).
 *   Footer:  [+ Добавить устройство] big blue button — opens modal picker
 *            that creates a device at the current viewport centre.
 *
 * Categories are derived from `device.kind` (per user pick, v0.43.3):
 *   router / switch / patchpanel / ap / camera / server / vm / vps / pc /
 *   pos / printer / lock / cloud
 * Only categories with ≥1 template are shown.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store';
import { ICONS, KIND_META } from './icons';
import type { Device, DeviceKind } from './types';
import {
  BUILT_IN_TEMPLATES,
  loadCustomTemplates,
  saveCustomTemplates,
  makeDeviceFromTemplate,
  type DeviceTemplate,
} from './templates';

// Custom templates cache lives outside React so ActivityBar navigation
// doesn't remount and lose them.
let CUSTOM_CACHE: DeviceTemplate[] = loadCustomTemplates();

export function pushCustomTemplate(t: DeviceTemplate) {
  CUSTOM_CACHE = [...CUSTOM_CACHE, t];
  saveCustomTemplates(CUSTOM_CACHE);
  window.dispatchEvent(new CustomEvent('netmap:templates-updated'));
}
export function removeCustomTemplate(id: string) {
  CUSTOM_CACHE = CUSTOM_CACHE.filter(t => t.id !== id);
  saveCustomTemplates(CUSTOM_CACHE);
  window.dispatchEvent(new CustomEvent('netmap:templates-updated'));
}

// ---------------------------------------------------------------------------
// Category order for the accordion. Kinds not in this list still show up
// at the end. Hidden entirely if the current template set has no matches.

const CATEGORY_ORDER: DeviceKind[] = [
  'router', 'switch', 'patchpanel', 'ap',
  'camera', 'server', 'vm', 'vps',
  'pc', 'pos', 'printer', 'lock', 'cloud',
];

// Русские labels для аккордеона — берём из KIND_META (там уже есть в англ).
// Локализуем — KIND_META.label заглавные англ (SWITCH), тут более "человеческие".
const KIND_LABEL_RU: Partial<Record<DeviceKind, string>> = {
  router:     'Роутеры',
  switch:     'Свитчи',
  patchpanel: 'Патч-панели',
  ap:         'Точки доступа Wi-Fi',
  camera:     'Камеры',
  server:     'Серверы',
  vm:         'Виртуальные машины',
  vps:        'VPS / хостинг',
  pc:         'ПК',
  pos:        'POS-терминалы',
  printer:    'Принтеры',
  lock:       'Умные замки',
  cloud:      'Провайдеры / облака',
};

// ---------------------------------------------------------------------------

export function CatalogPanel() {
  const addDevice = useStore(s => s.addDevice);
  const select = useStore(s => s.select);
  const [q, setQ] = useState('');
  const [customs, setCustoms] = useState<DeviceTemplate[]>(CUSTOM_CACHE);
  // Only one section expanded at a time (accordion). null = all collapsed.
  // Persist last-opened category between sessions.
  const [openCat, setOpenCat] = useState<DeviceKind | null>(() => {
    try { const v = localStorage.getItem('netmap:catalog:openCat'); return (v as DeviceKind) || null; } catch { return null; }
  });
  useEffect(() => {
    try {
      if (openCat) localStorage.setItem('netmap:catalog:openCat', openCat);
      else localStorage.removeItem('netmap:catalog:openCat');
    } catch {}
  }, [openCat]);

  const [addModalOpen, setAddModalOpen] = useState(false);

  useEffect(() => {
    const h = () => setCustoms([...CUSTOM_CACHE]);
    window.addEventListener('netmap:templates-updated', h);
    return () => window.removeEventListener('netmap:templates-updated', h);
  }, []);

  const all = useMemo(() => [...customs, ...BUILT_IN_TEMPLATES], [customs]);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(() =>
    !query ? all : all.filter(t =>
      t.vendor.toLowerCase().includes(query) ||
      t.model.toLowerCase().includes(query) ||
      t.kind.includes(query) ||
      t.tags?.some(tag => tag.toLowerCase().includes(query)) ||
      (t.description || '').toLowerCase().includes(query)
    ),
  [all, query]);

  // Group filtered templates by kind + preserve category order.
  const groups = useMemo(() => {
    const m = new Map<DeviceKind, DeviceTemplate[]>();
    for (const t of filtered) {
      const arr = m.get(t.kind) || [];
      arr.push(t);
      m.set(t.kind, arr);
    }
    const seen = new Set<DeviceKind>();
    const ordered: { kind: DeviceKind; items: DeviceTemplate[] }[] = [];
    for (const k of CATEGORY_ORDER) {
      const items = m.get(k);
      if (items && items.length) { ordered.push({ kind: k, items }); seen.add(k); }
    }
    // Add kinds not in CATEGORY_ORDER (safety net for new kinds).
    for (const [k, items] of m) {
      if (!seen.has(k)) ordered.push({ kind: k, items });
    }
    return ordered;
  }, [filtered]);

  // When user starts searching, auto-expand everything so results are visible.
  const forceExpanded = query.length > 0;

  function createFromTemplate(t: DeviceTemplate) {
    const dev = makeDeviceFromTemplate(t, 400, 300);
    addDevice(dev);
    select(dev.id);
  }

  const totalCount = filtered.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'white' }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid #F1F5F9',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, background: '#F1F5F9',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155',
        }}>
          <BoxIcon size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Каталог устройств</div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>
            {totalCount} шаблонов · {groups.length} категорий
          </div>
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: '10px 12px 6px' }}>
        <div style={{ position: 'relative' }}>
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Поиск устройств..."
            style={{
              width: '100%', padding: '7px 10px 7px 30px', boxSizing: 'border-box',
              border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12,
              background: '#F8FAFC', outline: 'none',
            }}
          />
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', display: 'flex' }}>
            <SearchIcon size={12} />
          </span>
        </div>
      </div>

      {/* Accordion body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 8px 12px' }}>
        {groups.length === 0 && (
          <div style={{ padding: 24, fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>
            Ничего не найдено
          </div>
        )}
        {groups.map(g => {
          const meta = KIND_META[g.kind];
          const Icon = ICONS[g.kind];
          const label = KIND_LABEL_RU[g.kind] || meta.label;
          const isOpen = forceExpanded || openCat === g.kind;
          return (
            <div key={g.kind} style={{ marginBottom: 4 }}>
              <button
                onClick={() => setOpenCat(prev => prev === g.kind ? null : g.kind)}
                style={{
                  width: '100%', padding: '10px 10px', border: 'none',
                  background: isOpen ? '#EFF6FF' : 'transparent',
                  color: isOpen ? '#1D4ED8' : '#334155',
                  cursor: 'pointer', borderRadius: 6,
                  display: 'flex', alignItems: 'center', gap: 10,
                  fontSize: 12, fontWeight: isOpen ? 700 : 600,
                  textAlign: 'left',
                }}
                onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC'; }}
                onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <span style={{ color: isOpen ? '#2563EB' : meta.color, display: 'flex' }}>
                  <Icon size={16} color={isOpen ? '#2563EB' : meta.color} />
                </span>
                <span style={{ flex: 1, textTransform: 'uppercase', letterSpacing: 0.3, fontSize: 11 }}>
                  {label}
                </span>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 999,
                  background: isOpen ? '#DBEAFE' : '#F1F5F9',
                  color: isOpen ? '#1D4ED8' : '#64748B', fontWeight: 700,
                }}>{g.items.length}</span>
                <Chevron open={isOpen} />
              </button>

              {isOpen && (
                <div style={{ padding: '4px 0 6px 8px' }}>
                  {g.items.map(t => (
                    <TemplateRow
                      key={t.id}
                      template={t}
                      onClick={() => createFromTemplate(t)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer button — the "+ Добавить устройство" per user request */}
      <div style={{
        padding: 10, borderTop: '1px solid #E5E7EB', background: '#F8FAFC',
      }}>
        <button
          onClick={() => setAddModalOpen(true)}
          style={{
            width: '100%', padding: '9px 12px', border: 'none', borderRadius: 6,
            background: '#2563EB', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <PlusIcon size={14} />
          Добавить устройство
        </button>
        <div style={{ marginTop: 8, fontSize: 10, color: '#94A3B8', textAlign: 'center' }}>
          Или перетащите шаблон на карту
        </div>
      </div>

      {addModalOpen && (
        <AddDeviceModal
          onClose={() => setAddModalOpen(false)}
          onPick={(kind) => {
            setAddModalOpen(false);
            // Find the first template of that kind and drop it at viewport centre.
            const t = BUILT_IN_TEMPLATES.find(x => x.kind === kind) || customs.find(x => x.kind === kind);
            if (t) createFromTemplate(t);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One template row inside an expanded category.

function TemplateRow({ template, onClick }: { template: DeviceTemplate; onClick: () => void }) {
  const Icon = ICONS[template.kind];
  const meta = KIND_META[template.kind];
  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('application/x-netmap-template', template.id);
        e.dataTransfer.setData('application/x-netmap-template-custom', template.isCustom ? '1' : '0');
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onClick}
      style={{
        padding: '7px 10px', borderRadius: 6, cursor: 'grab',
        display: 'flex', alignItems: 'center', gap: 10,
        transition: 'background 100ms',
        userSelect: 'none',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#F8FAFC'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      title="Клик — добавить в центр карты. Перетащите — на конкретное место."
    >
      <div style={{
        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
        background: meta.bg, color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={14} color={meta.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 500, color: '#0F172A',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{template.model}</div>
        <div style={{ fontSize: 10, color: '#64748B', marginTop: 1 }}>{template.vendor}</div>
      </div>
      {template.isCustom && (
        <span style={{
          fontSize: 9, padding: '1px 6px', borderRadius: 999,
          background: '#FEF3C7', color: '#92400E', fontWeight: 700,
        }}>MY</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "+ Добавить устройство" modal picker — grid of kinds, click to instantiate.

function AddDeviceModal({ onClose, onPick }: {
  onClose: () => void;
  onPick: (kind: DeviceKind) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
        zIndex: 100020, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'white', width: 480, maxWidth: '92vw',
          borderRadius: 12, boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '14px 16px', borderBottom: '1px solid #E5E7EB',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Добавить устройство</div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
              Выберите тип — устройство появится в центре карты
            </div>
          </div>
          <button onClick={onClose} style={{
            padding: '5px 10px', border: '1px solid #E5E7EB', borderRadius: 6,
            background: 'white', color: '#64748B', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CloseIcon size={14} />
          </button>
        </div>

        <div style={{
          padding: 16, display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
        }}>
          {CATEGORY_ORDER.map(kind => {
            const meta = KIND_META[kind];
            const Icon = ICONS[kind];
            const label = KIND_LABEL_RU[kind] || meta.label;
            return (
              <button
                key={kind}
                onClick={() => onPick(kind)}
                style={{
                  padding: '14px 10px', border: '1px solid #E5E7EB', borderRadius: 8,
                  background: 'white', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  transition: 'border-color 100ms, background 100ms, transform 100ms',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = meta.color;
                  (e.currentTarget as HTMLButtonElement).style.background = meta.bg;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#E5E7EB';
                  (e.currentTarget as HTMLButtonElement).style.background = 'white';
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: meta.bg, color: meta.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={20} color={meta.color} />
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#0F172A', textAlign: 'center', lineHeight: 1.3 }}>
                  {label}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Icons

const svgP = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function BoxIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" {...svgP}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>);
}
function SearchIcon({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" {...svgP}>
    <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>);
}
function PlusIcon({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>);
}
function CloseIcon({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>);
}
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 150ms', color: '#94A3B8' }}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}
