/**
 * v0.43 — Vault Studio 2.0 — 1Password-style clean layout.
 *
 * Layout:
 *   ┌────┬─────────────┬──────────────────────┬──────────────────────┐
 *   │ ⛨ │ Categories  │ Items list          │ Slide-over detail    │
 *   │ ▨ │ + New       │  · card  view       │  (opens on select)   │
 *   │ 🖥 │ + Search    │  · table view       │                      │
 *   │ 🌐 │ + Tags      │                      │                      │
 *   │ 🔔 │             │                      │                      │
 *   ├────┤             │                      │                      │
 *   │ AD │             │                      │                      │
 *   └────┴─────────────┴──────────────────────┴──────────────────────┘
 *
 * Opens on Ctrl+K or from AppMenu → Tools → Vault Studio.
 * Escape or × closes. Detail panel closes with its own × or Escape.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  vaultStatus, vaultList, vaultGet, vaultUpsert, vaultDelete,
  vaultUnlock, vaultInit, vaultLock,
  type VaultItemMeta, type VaultItemFull, type VaultStatus,
} from './vaultClient';
import { PasswordGenerator } from './PasswordGenerator';
import { TotpChip } from './TotpChip';
import { VaultImportExportDialog } from './VaultImportExportDialog';
import { QrShareDialog } from './QrShareDialog';
import { getFavicon } from './faviconClient';
import { analyseItems, strengthColor, strengthLabel, estimateEntropy } from './passwordHealth';
import { alertDialog, confirmDialog } from './Modal';
import { deriveKind, deriveConnectAction, CATEGORIES, type VaultKind, type ConnectAction } from './vaultCategories';
import { launchRdp } from './rdpClient';
import { useStore } from './store';

interface Props { open: boolean; onClose: () => void; }

type NavSection = { kind: 'all' } | { kind: 'category'; id: VaultKind } | { kind: 'tag'; name: string } | { kind: 'trash' } | { kind: 'shared' };

export function VaultStudioHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onEvent = () => setOpen(true);
    window.addEventListener('netmap:open-vault-studio', onEvent);
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('netmap:open-vault-studio', onEvent);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  if (!open) return null;
  return <VaultStudio open={open} onClose={() => setOpen(false)} />;
}

function VaultStudio({ open, onClose }: Props) {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [items, setItems] = useState<VaultItemMeta[]>([]);
  const [nav, setNav] = useState<NavSection>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<VaultItemFull | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [ioOpen, setIoOpen] = useState(false);
  const [ioTab, setIoTab] = useState<'import' | 'export' | 'migrate'>('import');
  const [master, setMaster] = useState('');
  const [master2, setMaster2] = useState('');
  const [unlockErr, setUnlockErr] = useState('');
  const [showResetPrompt, setShowResetPrompt] = useState(false);

  const refresh = async () => {
    const s = await vaultStatus();
    setStatus(s);
    if (s.unlocked) setItems(await vaultList());
    else setItems([]);
  };
  useEffect(() => { if (open) refresh(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selected && !isNew) onClose();
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        (document.getElementById('vs-search') as HTMLInputElement)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, selected, isNew, onClose]);

  // Categories counts (fast — meta only, no decryption).
  const catCounts = useMemo(() => {
    const m = new Map<VaultKind, number>();
    for (const it of items) {
      const k = deriveKind(it);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [items]);

  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) for (const t of (it.tags || [])) {
      m.set(t, (m.get(t) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const visible = useMemo(() => {
    let list = items;
    if (nav.kind === 'category') list = list.filter(i => deriveKind(i) === nav.id);
    else if (nav.kind === 'tag') list = list.filter(i => (i.tags || []).includes(nav.name));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.url || '').toLowerCase().includes(q) ||
        (i.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [items, nav, query]);

  const openItem = async (id: string) => {
    setIsNew(false); setSelectedId(id);
    const res = await vaultGet(id);
    if (res.ok && res.item) setSelected(res.item);
  };

  const startNew = () => {
    setIsNew(true); setSelectedId(null);
    setSelected({
      name: '', folder: null, username: '', password: '', notes: '',
      tags: [], updated: Date.now(),
    } as any);
  };

  if (!open) return null;

  return createPortal(
    <div style={backdrop}>
      <div style={studio}>
        {!status ? (
          <div style={loaderStyle}>Загрузка…</div>
        ) : !status.initialized ? (
          <SetupScreen pw1={master} pw2={master2} err={unlockErr}
            onPw1={setMaster} onPw2={setMaster2} onClose={onClose}
            onSubmit={async () => {
              setUnlockErr('');
              if (master.length < 6) return setUnlockErr('Минимум 6 символов');
              if (master !== master2) return setUnlockErr('Пароли не совпадают');
              const res = await vaultInit(master);
              if (!res.ok) return setUnlockErr((res as any).error || 'Ошибка');
              setMaster(''); setMaster2(''); refresh();
            }} />
        ) : !status.unlocked ? (
          <UnlockScreen pw={master} err={unlockErr} showReset={showResetPrompt}
            onPw={setMaster} onClose={onClose}
            onToggleReset={() => setShowResetPrompt(v => !v)}
            onSubmit={async () => {
              setUnlockErr('');
              const res = await vaultUnlock(master);
              if (!res.ok) return setUnlockErr((res as any).error === 'wrong-password' ? 'Неверный пароль' : (res as any).error);
              setMaster(''); refresh();
            }}
            onReset={async () => {
              if (!(await confirmDialog(
                'Сбросить vault?',
                'Все сохранённые пароли будут удалены безвозвратно. Проект не пострадает.',
                { danger: true, okText: 'Сбросить' }
              ))) return;
              const w = window as any;
              if (w.netmap?.vaultReset) { await w.netmap.vaultReset(); setShowResetPrompt(false); setMaster(''); refresh(); }
            }} />
        ) : (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* Column 1: activity bar */}
            <ActivityBar onLock={async () => { await vaultLock(); setSelected(null); setSelectedId(null); refresh(); }} onClose={onClose} />

            {/* Column 2: navigator (categories + tags) */}
            <Navigator
              nav={nav} onNav={setNav}
              query={query} onQuery={setQuery}
              onNew={startNew}
              onImport={() => { setIoTab('import'); setIoOpen(true); }}
              onExport={() => { setIoTab('export'); setIoOpen(true); }}
              counts={catCounts}
              tags={allTags}
              totalCount={items.length}
            />

            {/* Column 3: items list */}
            <ItemsList
              items={visible} totalUnfiltered={items.length} nav={nav}
              viewMode={viewMode} onViewMode={setViewMode}
              selectedId={selectedId}
              onSelect={openItem}
              query={query}
            />

            {/* Column 4: slide-over detail */}
            {selected && (
              <DetailDrawer
                item={selected} isNew={isNew}
                onClose={() => { setSelected(null); setSelectedId(null); setIsNew(false); }}
                onSave={async (patch) => {
                  const merged: any = { ...selected, ...patch, id: isNew ? undefined : selected.id };
                  const res = await vaultUpsert(merged);
                  if (res.ok && res.id) {
                    await refresh();
                    const full = await vaultGet(res.id);
                    if (full.ok && full.item) { setSelected(full.item); setSelectedId(res.id); }
                    setIsNew(false);
                  }
                }}
                onDelete={async () => {
                  if (!selected.id) return;
                  if (!(await confirmDialog(`Удалить «${selected.name}»?`, undefined, { danger: true, okText: 'Удалить' }))) return;
                  await vaultDelete(selected.id);
                  setSelected(null); setSelectedId(null);
                  refresh();
                }}
              />
            )}
          </div>
        )}
      </div>

      <VaultImportExportDialog open={ioOpen} initialTab={ioTab} onClose={() => { setIoOpen(false); refresh(); }} />
    </div>,
    document.body
  );
}

// ===========================================================================
// Column 1 — Activity bar (leftmost narrow strip)
// v0.43.1: stripped to essentials — brand + Vault (active) + Lock at the
// bottom. The old "quick jump to Devices / Map / Alerts" icons were
// removed by user request — they were confusing since VaultStudio is a
// modal dialog, not a top-level app screen.

function ActivityBar({ onLock, onClose }: { onLock: () => void; onClose: () => void }) {
  return (
    <div style={{
      width: 52, background: '#F8FAFC',
      borderRight: '1px solid #E5E7EB',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '10px 0', gap: 4,
    }}>
      <div style={brandLogo}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
        </svg>
      </div>
      <ActBtn active title="Vault">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z"/>
          <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
        </svg>
      </ActBtn>
      <div style={{ flex: 1 }} />
      <ActBtn title="Заблокировать vault" onClick={onLock}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </ActBtn>
      {/* v0.43.2: prominent close button so users don't have to guess Escape. */}
      <ActBtn title="Закрыть (Esc)" onClick={onClose}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </ActBtn>
    </div>
  );
}
function ActBtn({ title, active, onClick, children }: { title: string; active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick} title={title}
      style={{
        width: 36, height: 36, padding: 0, border: 'none', borderRadius: 8,
        background: active ? '#DBEAFE' : 'transparent',
        color: active ? '#2563EB' : '#64748B',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = '#F1F5F9'; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >{children}</button>
  );
}
const brandLogo: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8,
  background: 'linear-gradient(135deg, #2563EB, #7C3AED)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  marginBottom: 8,
};

// ===========================================================================
// Column 2 — Navigator (categories + tags)

function Navigator({ nav, onNav, query, onQuery, onNew, onImport, onExport, counts, tags, totalCount }: {
  nav: NavSection; onNav: (n: NavSection) => void;
  query: string; onQuery: (q: string) => void;
  onNew: () => void; onImport: () => void; onExport: () => void;
  counts: Map<VaultKind, number>;
  tags: Array<[string, number]>;
  totalCount: number;
}) {
  return (
    <div style={{
      width: 240, background: 'white',
      borderRight: '1px solid #E5E7EB',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #F1F5F9' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Vault</div>
      </div>

      {/* Search + New */}
      <div style={{ padding: '10px 12px', display: 'grid', gap: 8 }}>
        <div style={{ position: 'relative' }}>
          <input
            id="vs-search"
            value={query} onChange={(e) => onQuery(e.target.value)}
            placeholder="Search vault..."
            style={{
              width: '100%', padding: '7px 10px 7px 30px', boxSizing: 'border-box',
              border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12,
              background: '#F8FAFC', outline: 'none',
            }}
          />
          <SearchIcon />
          <span style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            fontSize: 9, color: '#94A3B8', background: '#F1F5F9',
            padding: '1px 5px', borderRadius: 3, fontFamily: 'ui-monospace, monospace',
          }}>Ctrl+K</span>
        </div>
        <button
          onClick={onNew}
          style={{
            padding: '9px 12px', border: 'none', borderRadius: 6,
            background: '#2563EB', color: 'white',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >+ New Record</button>
        {/* v0.43.1: Import / Export as explicit text buttons (was one icon ⇄) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button onClick={onImport} style={secondaryBtn}>Импорт</button>
          <button onClick={onExport} style={secondaryBtn}>Экспорт</button>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px' }}>
        <SectionTitle>CATEGORIES</SectionTitle>
        <NavRow
          label="All Records" count={totalCount}
          icon={<AllRecordsIconSvg />}
          active={nav.kind === 'all'} onClick={() => onNav({ kind: 'all' })}
        />
        {CATEGORIES.map(c => {
          const n = counts.get(c.id) || 0;
          if (n === 0) return null;
          return (
            <NavRow
              key={c.id} label={c.label} count={n}
              icon={<CategoryIconSvg id={c.id} />} color={c.color}
              active={nav.kind === 'category' && nav.id === c.id}
              onClick={() => onNav({ kind: 'category', id: c.id })}
            />
          );
        })}

        {tags.length > 0 && (
          <>
            <SectionTitle style={{ marginTop: 16 }}>TAGS</SectionTitle>
            {tags.slice(0, 20).map(([t, n]) => (
              <NavRow
                key={t} label={t} count={n}
                icon={<TagIconSvg />}
                active={nav.kind === 'tag' && nav.name === t}
                onClick={() => onNav({ kind: 'tag', name: t })}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// v0.43.1: SVG icon helpers — no emoji anywhere.
function SearchIcon() {
  return (
    <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }}
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}
function AllRecordsIconSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="4" x2="9" y2="20"/>
    </svg>
  );
}
function TagIconSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
      <line x1="7" y1="7" x2="7.01" y2="7"/>
    </svg>
  );
}
function CategoryIconSvg({ id }: { id: VaultKind }) {
  const p = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'login':
      return (<svg {...p}><rect x="3" y="4" width="18" height="12" rx="1"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/></svg>);
    case 'ssh':
      return (<svg {...p}><path d="M4 17l6-6-6-6"/><line x1="12" y1="19" x2="20" y2="19"/></svg>);
    case 'wifi':
      return (<svg {...p}><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>);
    case 'cert':
      return (<svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="15" r="2"/><line x1="12" y1="17" x2="12" y2="20"/></svg>);
    case 'secure_note':
      return (<svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>);
    case 'api_token':
      return (<svg {...p}><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M17 6l2 2M15 8l2 2"/></svg>);
    case 'database':
      return (<svg {...p}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>);
    default:
      return null;
  }
}

function SectionTitle({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: '#94A3B8',
      letterSpacing: 0.8, padding: '10px 8px 4px',
      textTransform: 'uppercase', ...style,
    }}>{children}</div>
  );
}

function NavRow({ label, count, icon, color, active, onClick }: {
  label: string; count: number; icon: React.ReactNode; color?: string;
  active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '6px 8px', border: 'none',
        background: active ? '#EFF6FF' : 'transparent',
        color: active ? '#1D4ED8' : '#334155',
        cursor: 'pointer', borderRadius: 6,
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 12, fontWeight: active ? 600 : 500,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC'; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >
      <span style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: active ? '#2563EB' : (color || '#64748B') }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 500 }}>{count}</span>
    </button>
  );
}

// ===========================================================================
// Column 3 — Items list

function ItemsList({ items, totalUnfiltered, nav, viewMode, onViewMode, selectedId, onSelect, query }: {
  items: VaultItemMeta[]; totalUnfiltered: number; nav: NavSection;
  viewMode: 'cards' | 'table';
  onViewMode: (m: 'cards' | 'table') => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
}) {
  const heading = navHeading(nav);
  return (
    <div style={{
      flex: 1, minWidth: 0, background: '#FAFBFC',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #E5E7EB', background: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>{heading}</div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            {items.length} {items.length === 1 ? 'record' : 'records'}
            {query && items.length !== totalUnfiltered && (
              <span> · отфильтровано из {totalUnfiltered}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 2, padding: 2, background: '#F1F5F9', borderRadius: 6 }}>
          <ViewToggle active={viewMode === 'cards'} onClick={() => onViewMode('cards')} title="Карточки">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
          </ViewToggle>
          <ViewToggle active={viewMode === 'table'} onClick={() => onViewMode('table')} title="Таблица">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
            </svg>
          </ViewToggle>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {items.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>
            {totalUnfiltered === 0
              ? 'Vault пуст. Нажмите + New Record.'
              : query ? 'Ничего не найдено' : 'В этой категории нет записей'}
          </div>
        )}

        {viewMode === 'cards'
          ? <div style={{ padding: 12, display: 'grid', gap: 8 }}>
              {items.map(it => <ItemCard key={it.id} item={it} selected={selectedId === it.id} onClick={() => onSelect(it.id)} />)}
            </div>
          : <div>
              {items.map(it => <ItemRow key={it.id} item={it} selected={selectedId === it.id} onClick={() => onSelect(it.id)} />)}
            </div>
        }
      </div>
    </div>
  );
}

function navHeading(nav: NavSection): string {
  if (nav.kind === 'category') return CATEGORIES.find(c => c.id === nav.id)?.label || 'Records';
  if (nav.kind === 'tag')      return `#${nav.name}`;
  return 'All Records';
}

function ViewToggle({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} style={{
      padding: '5px 10px', border: 'none', borderRadius: 4,
      background: active ? 'white' : 'transparent',
      color: active ? '#1D4ED8' : '#64748B',
      cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: active ? '0 1px 2px rgba(15,23,42,0.06)' : undefined,
    }}>{children}</button>
  );
}

/** Card view — matches reference screen 1. */
function ItemCard({ item, selected, onClick }: { item: VaultItemMeta; selected: boolean; onClick: () => void }) {
  const [favicon, setFavicon] = useState<string | null>(null);
  useEffect(() => { getFavicon(item.url).then(setFavicon); }, [item.url]);
  const [copied, setCopied] = useState(false);

  const doCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await vaultGet(item.id);
    if (res.ok && res.item?.password) {
      navigator.clipboard.writeText(res.item.password).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      onClick={onClick}
      style={{
        background: 'white',
        border: '1px solid ' + (selected ? '#2563EB' : '#E5E7EB'),
        borderRadius: 10, padding: 12, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 12,
        transition: 'border-color 120ms, box-shadow 120ms',
        boxShadow: selected ? '0 0 0 3px rgba(37,99,235,0.15)' : '0 1px 2px rgba(15,23,42,0.03)',
      }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = '#CBD5E1'; }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = '#E5E7EB'; }}
    >
      <FaviconBubble url={item.url} favicon={favicon} setFavicon={setFavicon} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.name}
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>
          ••••••••••••
        </div>
      </div>
      <button onClick={doCopy} style={{
        padding: '6px 8px', border: '1px solid #E5E7EB', borderRadius: 6,
        background: copied ? '#D1FAE5' : 'white',
        color: copied ? '#065F46' : '#64748B',
        cursor: 'pointer', fontSize: 11,
      }}>{copied ? <IconCheck /> : <IconCopy />}</button>
    </div>
  );
}

/** Table view — matches reference screen 2 (Device-Linked Vault). */
function ItemRow({ item, selected, onClick }: { item: VaultItemMeta; selected: boolean; onClick: () => void }) {
  const [favicon, setFavicon] = useState<string | null>(null);
  useEffect(() => { getFavicon(item.url).then(setFavicon); }, [item.url]);
  const [full, setFull] = useState<VaultItemFull | null>(null);
  const [copied, setCopied] = useState<string>('');

  // Fetch full item lazily just for the connect action (we need password on ssh/rdp launch).
  const connect = deriveConnectAction(item);

  const doConnect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!connect) return;
    // Need full item for creds
    let f = full;
    if (!f) { const res = await vaultGet(item.id); if (res.ok && res.item) { f = res.item; setFull(f); } }
    if (!f) return;

    if (connect.action === 'web') {
      const url = connect.fullUrl?.startsWith('http') ? connect.fullUrl : ('http://' + connect.host);
      if (f.username) { navigator.clipboard.writeText(f.username).catch(() => {}); }
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (connect.action === 'ssh') {
      window.dispatchEvent(new CustomEvent('netmap:open-ssh-terminal', {
        detail: {
          host: connect.host, port: connect.port || 22,
          username: f.username, password: f.password,
          title: item.name, subtitle: item.url,
        },
      }));
      return;
    }
    if (connect.action === 'rdp') {
      const res = await launchRdp({
        host: connect.host, port: connect.port || 3389,
        username: f.username, password: f.password,
      });
      if (!res.ok) await alertDialog('RDP', res.error || 'Не удалось запустить RDP-клиент');
      else if (res.clipCopied) {
        useStore.getState().pushAlert({
          severity: 'info', origin: 'app',
          title: 'RDP запущен',
          message: 'Пароль скопирован в буфер (авто-очистка через 45с).',
        });
      }
      return;
    }
    if (connect.action === 'db') {
      // DB: copy connection string to clipboard as fallback
      const parts = [connect.scheme + '://', f.username, f.password ? ':' + f.password : '', f.username ? '@' : '', connect.host, connect.port ? ':' + connect.port : ''];
      navigator.clipboard.writeText(parts.join('')).catch(() => {});
      setCopied('db');
      setTimeout(() => setCopied(''), 1500);
    }
  };

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 20px', cursor: 'pointer',
        background: selected ? '#EFF6FF' : 'transparent',
        borderBottom: '1px solid #F1F5F9',
        borderLeft: '3px solid ' + (selected ? '#2563EB' : 'transparent'),
      }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = '#F8FAFC'; }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <FaviconBubble url={item.url} favicon={favicon} setFavicon={setFavicon} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.name}
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          {(full?.username) || (item.tags || [])[0] || '—'}
        </div>
      </div>
      {item.url && (
        <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'ui-monospace, monospace', textAlign: 'right', minWidth: 100 }}>
          {item.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}
        </div>
      )}
      {connect && (
        <button onClick={doConnect} style={connectBtn(connect.action)}>{connect.label}</button>
      )}
    </div>
  );
}

function connectBtn(action: ConnectAction): React.CSSProperties {
  const map: Record<ConnectAction, { bg: string; color: string; border: string }> = {
    ssh: { bg: '#0F172A', color: 'white', border: '#0F172A' },
    web: { bg: 'white', color: '#1D4ED8', border: '#93C5FD' },
    rdp: { bg: 'white', color: '#7C3AED', border: '#C4B5FD' },
    db:  { bg: 'white', color: '#059669', border: '#6EE7B7' },
    none:{ bg: '#F1F5F9', color: '#94A3B8', border: '#E5E7EB' },
  };
  const c = map[action];
  return {
    padding: '5px 12px', border: `1px solid ${c.border}`, borderRadius: 6,
    background: c.bg, color: c.color,
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  };
}

function FaviconBubble({ url, favicon, setFavicon, size }: {
  url: string | null | undefined; favicon: string | null;
  setFavicon: (f: string | null) => void; size: number;
}) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 8, flexShrink: 0,
      background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      {favicon
        ? <img src={favicon} alt="" style={{ width: size - 20, height: size - 20 }} onError={() => setFavicon(null)} />
        : <IconKey size={Math.round(size * 0.5)} color="#94A3B8" />}
    </div>
  );
}

// v0.43.1: SVG icons used instead of emoji throughout the drawer + list.
export function IconKey({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M17 6l2 2M15 8l2 2"/>
  </svg>);
}
export function IconCopy({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>
  </svg>);
}
export function IconCheck({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>);
}
export function IconEye({ size = 14, off }: { size?: number; off?: boolean }) {
  if (off) return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.85 20.85 0 0 1 5.36-5.51"/>
    <path d="M22.54 11.88A20.29 20.29 0 0 0 12 4a10.86 10.86 0 0 0-2 .19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>);
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>);
}
export function IconExternal({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>);
}
export function IconRefresh({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 1 1 5.64 5.64L23 22"/>
  </svg>);
}
export function IconSave({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
    <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
  </svg>);
}
export function IconTrash({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>);
}
export function IconQr({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    <line x1="14" y1="14" x2="14" y2="15"/><line x1="17" y1="14" x2="17" y2="18"/><line x1="20" y1="14" x2="20" y2="17"/>
    <line x1="14" y1="20" x2="21" y2="20"/><line x1="14" y1="17" x2="15" y2="17"/><line x1="17" y1="20" x2="17" y2="21"/>
  </svg>);
}
export function IconDice({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="16" cy="8" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/>
  </svg>);
}
export function IconLink({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/>
  </svg>);
}
export function IconPlus({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>);
}
export function IconX({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>);
}

// ===========================================================================
// Column 4 — Slide-over detail drawer

function DetailDrawer({ item, isNew, onClose, onSave, onDelete }: {
  item: VaultItemFull; isNew: boolean;
  onClose: () => void;
  onSave: (patch: Partial<VaultItemFull>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [tab, setTab] = useState<'details' | 'activity'>('details');
  const [name, setName] = useState(item.name || '');
  const [folder, setFolder] = useState(item.folder || '');
  const [url, setUrl] = useState(item.url || '');
  const [username, setUsername] = useState(item.username || '');
  const [password, setPassword] = useState(item.password || '');
  const [notes, setNotes] = useState(item.notes || '');
  const [tags, setTags] = useState<string[]>(item.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [totpSecret, setTotpSecret] = useState(item.totpSecret || '');
  const [fields, setFields] = useState<Record<string, string>>(item.fields || {});
  const [newFieldKey, setNewFieldKey] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwGen, setPwGen] = useState(false);
  // v0.43.1: bound device ids — connects vault entry to devices on the map.
  const [bound, setBound] = useState<string[]>(item.boundDeviceIds || []);
  const [devicePicker, setDevicePicker] = useState(false);
  const [deviceQuery, setDeviceQuery] = useState('');
  const allDevices = useStore(s => s.doc.devices);
  const [qrOpen, setQrOpen] = useState<{ value: string; title: string; subtitle?: string } | null>(null);
  const [favicon, setFavicon] = useState<string | null>(null);
  const [copied, setCopied] = useState<string>('');
  const [genLen, setGenLen] = useState(16);
  const [genLower, setGenLower] = useState(true);
  const [genUpper, setGenUpper] = useState(true);
  const [genDigits, setGenDigits] = useState(true);
  const [genSymbol, setGenSymbol] = useState(true);

  useEffect(() => {
    setName(item.name || ''); setFolder(item.folder || ''); setUrl(item.url || '');
    setUsername(item.username || ''); setPassword(item.password || ''); setNotes(item.notes || '');
    setTags(item.tags || []); setTotpSecret(item.totpSecret || ''); setFields(item.fields || {});
    setBound(item.boundDeviceIds || []);
    setShowPw(false); setTab('details');
  }, [item.id, item.updated]);
  useEffect(() => { getFavicon(url).then(setFavicon); }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = (key: string, val: string) => {
    if (!val) return;
    navigator.clipboard.writeText(val).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  };
  const addTag = (t: string) => {
    const s = t.trim();
    if (!s || tags.includes(s)) return;
    setTags([...tags, s]); setTagInput('');
  };
  const regenPw = async () => {
    const { vaultGeneratePassword } = await import('./vaultClient');
    const pw = await vaultGeneratePassword({
      length: genLen, lower: genLower, upper: genUpper, digits: genDigits, symbol: genSymbol,
    });
    setPassword(pw);
  };

  const entropy = estimateEntropy(password);
  const strengthLbl = strengthLabel(entropy);
  const strengthClr = strengthColor(entropy);

  return (
    <div style={{
      width: 480, minWidth: 480, background: 'white',
      borderLeft: '1px solid #E5E7EB',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      boxShadow: '-8px 0 24px rgba(15,23,42,0.06)',
    }}>
      {/* Header */}
      <div style={{
        padding: 20, borderBottom: '1px solid #E5E7EB',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <FaviconBubble url={url} favicon={favicon} setFavicon={setFavicon} size={48} />
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Название"
          autoFocus={isNew}
          style={{
            flex: 1, border: 'none', outline: 'none',
            fontSize: 18, fontWeight: 700, color: '#0F172A', background: 'transparent',
          }}
        />
        <button onClick={onClose} style={iconBtn}><IconX /></button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 20px 0', borderBottom: '1px solid #E5E7EB' }}>
        <TabHead active={tab === 'details'}  onClick={() => setTab('details')}  label="Details" />
        <TabHead active={tab === 'activity'} onClick={() => setTab('activity')} label="Activity" />
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20 }}>
        {tab === 'details' && (
          <>
            {/* Basic Information */}
            <SectionCard title="Basic Information">
              <FieldRow label="Title" value={name} onCopy={() => copy('title', name)} copied={copied === 'title'} readOnlyDisplay />
              <FieldRow label="Username" value={username} onChange={setUsername}
                onCopy={() => copy('user', username)} copied={copied === 'user'} />
              <FieldRow label="Password" value={password}
                onChange={setPassword}
                type={showPw ? 'text' : 'password'}
                onCopy={() => copy('pw', password)} copied={copied === 'pw'}
                extraBtn={
                  <button onClick={() => setShowPw(v => !v)} style={inlineBtn} title={showPw ? 'Скрыть' : 'Показать'}>
                    <IconEye off={showPw} />
                  </button>
                }
              />
              <FieldRow label="Strength" custom={
                <span style={{
                  display: 'inline-block', fontSize: 11, fontWeight: 600,
                  padding: '3px 10px', borderRadius: 999,
                  background: strengthClr + '20', color: strengthClr,
                }}>{strengthLbl}</span>
              } />
              <FieldRow label="Website" value={url} onChange={setUrl}
                extraBtn={
                  url ? <a href={url.startsWith('http') ? url : 'http://' + url} target="_blank" rel="noreferrer" style={{ ...inlineBtn, textDecoration: 'none' }} title="Открыть в браузере"><IconExternal /></a> : null
                }
              />
              <FieldRow label="Notes" custom={
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                  style={{
                    width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                    border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12,
                    fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                  }} />
              } />
            </SectionCard>

            {/* Password Generator */}
            <SectionCard title="Password Generator">
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input value={password} onChange={(e) => setPassword(e.target.value)}
                  type={showPw ? 'text' : 'password'}
                  style={{
                    flex: 1, padding: '8px 10px', border: '1px solid #E5E7EB',
                    borderRadius: 6, fontSize: 12, fontFamily: 'ui-monospace, monospace',
                    outline: 'none',
                  }} />
                <button onClick={regenPw} style={inlineBtn} title="Regenerate"><IconRefresh /></button>
                <button onClick={() => copy('pw', password)} style={inlineBtn} title="Copy">
                  {copied === 'pw' ? <IconCheck /> : <IconCopy />}
                </button>
              </div>
              <div style={{
                height: 4, background: '#E5E7EB', borderRadius: 2, marginBottom: 12, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${Math.min(100, entropy)}%`, height: '100%',
                  background: strengthClr, transition: 'width 200ms',
                }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: '#64748B' }}>Length</label>
                <select value={genLen} onChange={(e) => setGenLen(Number(e.target.value))} style={smallSelect}>
                  {[8, 12, 16, 20, 24, 32, 48].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <CheckLbl label="A-Z" v={genUpper} on={setGenUpper} />
                <CheckLbl label="a-z" v={genLower} on={setGenLower} />
                <CheckLbl label="0-9" v={genDigits} on={setGenDigits} />
                <CheckLbl label="!@#$%^&*" v={genSymbol} on={setGenSymbol} />
              </div>
            </SectionCard>

            {/* 2FA */}
            {(item.hasTotp || totpSecret) && (
              <SectionCard title="Two-Factor Authentication (2FA)">
                <div style={{ fontSize: 10, color: '#64748B', marginBottom: 6 }}>Time-based OTP (TOTP)</div>
                {item.hasTotp && item.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ flex: 1 }}>
                      <TotpBigDisplay itemId={item.id} />
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#B45309' }}>Сохраните, чтобы активировать TOTP.</div>
                )}
                <input
                  type="password"
                  value={totpSecret}
                  onChange={(e) => setTotpSecret(e.target.value.trim())}
                  placeholder="TOTP секрет base32 (например JBSWY3DPEHPK3PXP)"
                  style={{
                    marginTop: 10, width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                    border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12,
                    fontFamily: 'ui-monospace, monospace', outline: 'none',
                  }}
                />
              </SectionCard>
            )}

            {/* Tags */}
            <SectionCard title="Tags">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                {tags.map(t => (
                  <span key={t} style={tagChip}>
                    #{t}
                    <button onClick={() => setTags(tags.filter(x => x !== t))} style={tagX}>×</button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ',') && (e.preventDefault(), addTag(tagInput))}
                  onBlur={() => tagInput.trim() && addTag(tagInput)}
                  placeholder="+ тег"
                  style={{ ...smallInput, minWidth: 80, flex: 1 }}
                />
              </div>
            </SectionCard>

            {/* Custom fields */}
            <SectionCard title="Custom Fields">
              <div style={{ display: 'grid', gap: 6 }}>
                {Object.entries(fields).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 4 }}>
                    <input value={k} disabled style={{ ...smallInput, width: 140, opacity: 0.7 }} />
                    <input value={v} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} style={{ ...smallInput, flex: 1 }} />
                    <button onClick={() => copy('f-' + k, v)} style={inlineBtn}>{copied === 'f-' + k ? <IconCheck /> : <IconCopy />}</button>
                    <button onClick={() => { const n = { ...fields }; delete n[k]; setFields(n); }}
                      style={{ ...inlineBtn, color: '#B91C1C', borderColor: '#FCA5A5' }} title="Удалить"><IconX /></button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 4 }}>
                  <input value={newFieldKey} onChange={(e) => setNewFieldKey(e.target.value)}
                    placeholder="Название нового поля"
                    style={{ ...smallInput, flex: 1 }} />
                  <button onClick={() => {
                    const k = newFieldKey.trim();
                    if (!k || fields[k] !== undefined) return;
                    setFields({ ...fields, [k]: '' }); setNewFieldKey('');
                  }} style={inlineBtn} title="Добавить"><IconPlus /></button>
                </div>
              </div>
            </SectionCard>

            {/* v0.43.1 — Linked devices: connect vault entry to devices on the map. */}
            <SectionCard title="Привязанные устройства">
              {bound.length === 0 && (
                <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 8 }}>
                  Нет привязок. Свяжите запись с устройством из карты сети — тогда пароль будет доступен из inspector'а устройства.
                </div>
              )}
              {bound.length > 0 && (
                <div style={{ display: 'grid', gap: 5, marginBottom: 8 }}>
                  {bound.map(did => {
                    const d = allDevices.find(x => x.id === did);
                    return (
                      <div key={did} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', background: 'white',
                        border: '1px solid #E5E7EB', borderRadius: 6,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>
                            {d ? d.name : <span style={{ color: '#94A3B8' }}>Устройство не найдено ({did.slice(0, 8)}…)</span>}
                          </div>
                          {d && (d.ip || d.kind) && (
                            <div style={{ fontSize: 10, color: '#64748B', marginTop: 1 }}>
                              {d.kind}{d.ip ? ' · ' + d.ip : ''}
                            </div>
                          )}
                        </div>
                        {d && (
                          <button
                            onClick={() => {
                              useStore.getState().focusDevice(d.id);
                              useStore.getState().select(d.id);
                              window.dispatchEvent(new CustomEvent('netmap:focus-device', { detail: { id: d.id } }));
                              onClose();
                            }}
                            title="Показать на карте"
                            style={inlineBtn}
                          ><IconExternal /></button>
                        )}
                        <button
                          onClick={() => setBound(bound.filter(x => x !== did))}
                          style={{ ...inlineBtn, color: '#B91C1C', borderColor: '#FCA5A5' }}
                          title="Убрать привязку"
                        ><IconX /></button>
                      </div>
                    );
                  })}
                </div>
              )}
              <button onClick={() => setDevicePicker(true)} style={secondaryBtn}>
                Привязать устройство
              </button>
            </SectionCard>

            {/* More Actions */}
            <SectionCard title="More Actions">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  onClick={() => onSave({
                    name, folder: folder || null, url, username, password, notes,
                    tags, totpSecret, fields,
                    boundDeviceIds: bound,
                  } as any)}
                  style={actionBtn}
                ><IconSave /> {isNew ? 'Сохранить' : 'Сохранить'}</button>
                {!isNew && (
                  <button onClick={onDelete} style={{ ...actionBtn, borderColor: '#FCA5A5', color: '#B91C1C' }}>
                    <IconTrash /> Удалить
                  </button>
                )}
                {password && (
                  <button onClick={() => setQrOpen({ value: password, title: 'Password', subtitle: name })} style={actionBtn}>
                    <IconQr /> QR код
                  </button>
                )}
                <button onClick={() => setPwGen(true)} style={actionBtn}>
                  <IconDice /> Генератор
                </button>
              </div>
            </SectionCard>
          </>
        )}

        {tab === 'activity' && (
          <SectionCard title="History">
            {(item.history && item.history.length > 0) ? (
              <div style={{ display: 'grid', gap: 6 }}>
                {item.history.map((h, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', background: '#F8FAFC', borderRadius: 6,
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
                  }}>
                    <span style={{ opacity: 0.7, minWidth: 130 }}>{new Date(h.ts).toLocaleString()}</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', flex: 1 }}>
                      {'•'.repeat(Math.min(24, h.password.length))}
                    </span>
                    <button onClick={() => copy('h-' + i, h.password)} style={inlineBtn}>
                      {copied === 'h-' + i ? <IconCheck /> : <IconCopy />}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#94A3B8' }}>Ещё нет истории изменений.</div>
            )}
          </SectionCard>
        )}


      </div>

      <PasswordGenerator open={pwGen} onClose={() => setPwGen(false)} onApply={(pw) => setPassword(pw)} />
      {devicePicker && (
        <DevicePicker
          devices={allDevices}
          excludeIds={bound}
          query={deviceQuery}
          onQuery={setDeviceQuery}
          onPick={(id) => { setBound([...bound, id]); setDevicePicker(false); setDeviceQuery(''); }}
          onClose={() => { setDevicePicker(false); setDeviceQuery(''); }}
        />
      )}
      {qrOpen && (
        <QrShareDialog open={!!qrOpen} onClose={() => setQrOpen(null)}
          value={qrOpen.value} title={qrOpen.title} subtitle={qrOpen.subtitle} />
      )}
    </div>
  );
}

// v0.43.1 — device picker for "Привязать устройство" button.
function DevicePicker({ devices, excludeIds, query, onQuery, onPick, onClose }: {
  devices: any[]; excludeIds: string[];
  query: string; onQuery: (q: string) => void;
  onPick: (id: string) => void; onClose: () => void;
}) {
  const excluded = new Set(excludeIds);
  const q = query.trim().toLowerCase();
  const filtered = devices
    .filter(d => !excluded.has(d.id))
    .filter(d => !q || d.name.toLowerCase().includes(q) || (d.ip || '').includes(q) || (d.mac || '').toLowerCase().includes(q))
    .slice(0, 200);
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
        zIndex: 100020, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', width: 480, maxHeight: '70vh',
          borderRadius: 12, boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Привязать устройство</div>
          <button onClick={onClose} style={iconBtn}><IconX /></button>
        </div>
        <div style={{ padding: 10 }}>
          <input
            value={query} onChange={(e) => onQuery(e.target.value)}
            placeholder="Поиск по имени / IP / MAC…"
            autoFocus
            style={{ ...bigInput, fontSize: 12 }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 10px' }}>
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>
              {devices.length === 0 ? 'В проекте нет устройств.' : 'Ничего не найдено.'}
            </div>
          )}
          {filtered.map(d => (
            <button key={d.id} onClick={() => onPick(d.id)}
              style={{
                width: '100%', padding: '8px 10px', border: '1px solid #E5E7EB',
                borderRadius: 6, background: 'white', textAlign: 'left', cursor: 'pointer',
                marginBottom: 4,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'white'; }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>{d.name}</div>
              <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
                {d.kind}{d.ip ? ' · ' + d.ip : ''}{d.mac ? ' · ' + d.mac : ''}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TotpBigDisplay({ itemId }: { itemId: string }) {
  // Larger version of TotpChip — reference-style big blue number + circular timer.
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '10px 14px', background: '#EFF6FF', borderRadius: 8,
    }}>
      <TotpChip itemId={itemId} size="md" />
      <span style={{ fontSize: 10, color: '#64748B' }}>Клик — копировать</span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>{title}</div>
      <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 10, padding: 14 }}>
        {children}
      </div>
    </div>
  );
}

function FieldRow({ label, value, onChange, onCopy, copied, type = 'text', readOnlyDisplay, extraBtn, custom }: {
  label: string; value?: string; onChange?: (v: string) => void;
  onCopy?: () => void; copied?: boolean;
  type?: string; readOnlyDisplay?: boolean;
  extraBtn?: React.ReactNode;
  custom?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, alignItems: 'center', padding: '6px 0' }}>
      <label style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>{label}</label>
      {custom
        ? <div>{custom}</div>
        : <div style={{ display: 'flex', gap: 4 }}>
            {readOnlyDisplay ? (
              <div style={{
                flex: 1, padding: '7px 10px', fontSize: 12, color: '#0F172A',
              }}>{value || <span style={{ color: '#94A3B8' }}>—</span>}</div>
            ) : (
              <input
                value={value || ''} onChange={onChange ? (e) => onChange(e.target.value) : undefined}
                type={type}
                style={{
                  flex: 1, padding: '7px 10px', boxSizing: 'border-box',
                  border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12,
                  fontFamily: type === 'password' ? 'ui-monospace, monospace' : 'inherit',
                  outline: 'none', background: 'white',
                }}
              />
            )}
            {extraBtn}
            {onCopy && (
              <button onClick={onCopy} style={inlineBtn} title="Копировать">
                {copied ? <IconCheck /> : <IconCopy />}
              </button>
            )}
          </div>
      }
    </div>
  );
}

function TabHead({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 10px', border: 'none', background: 'transparent',
        color: active ? '#2563EB' : '#64748B',
        fontSize: 13, fontWeight: active ? 700 : 500,
        cursor: 'pointer', position: 'relative', marginBottom: -1,
        borderBottom: '2px solid ' + (active ? '#2563EB' : 'transparent'),
      }}
    >{label}</button>
  );
}

function CheckLbl({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#334155', cursor: 'pointer' }}>
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />
      {label}
    </label>
  );
}

// ===========================================================================
// Setup / Unlock screens (unchanged from v0.40)

function SetupScreen({ pw1, pw2, err, onPw1, onPw2, onSubmit, onClose }: any) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={iconBtn}><IconX /></button>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16,
              background: 'linear-gradient(135deg, #2563EB, #7C3AED)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z"/>
                <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Создать vault</div>
          <div style={{ fontSize: 12, color: '#64748B', marginBottom: 20 }}>
            Придумайте мастер-пароль (AES-256-GCM + PBKDF2 200k).<br />
            <b style={{ color: '#B91C1C' }}>Пароль нельзя восстановить.</b>
          </div>
          <input type="password" placeholder="Мастер-пароль (мин 6)" value={pw1}
            onChange={(e) => onPw1(e.target.value)} style={{ ...bigInput, marginBottom: 8 }} autoFocus />
          <input type="password" placeholder="Повторите" value={pw2}
            onChange={(e) => onPw2(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
            style={bigInput} />
          {err && <div style={{ color: '#DC2626', fontSize: 11, marginTop: 6 }}>{err}</div>}
          <button onClick={onSubmit} style={{ ...primaryBigBtn, background: '#059669', marginTop: 12 }}>Создать vault</button>
        </div>
      </div>
    </div>
  );
}

function UnlockScreen({ pw, err, showReset, onPw, onSubmit, onToggleReset, onReset, onClose }: any) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={iconBtn}><IconX /></button>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16, background: '#F1F5F9',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B',
            }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Vault заблокирован</div>
          <div style={{ fontSize: 12, color: '#64748B', marginBottom: 20 }}>Введите мастер-пароль.</div>
          <input type="password" placeholder="Мастер-пароль" value={pw}
            onChange={(e) => onPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
            style={bigInput} autoFocus />
          {err && <div style={{ color: '#DC2626', fontSize: 11, marginTop: 6 }}>{err}</div>}
          <button onClick={onSubmit} style={{ ...primaryBigBtn, marginTop: 12 }}>Разблокировать</button>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #E5E7EB' }}>
            {!showReset ? (
              <button onClick={onToggleReset} style={{
                background: 'transparent', border: 'none', color: '#64748B',
                fontSize: 11, cursor: 'pointer', textDecoration: 'underline',
              }}>Забыли пароль? Сбросить vault…</button>
            ) : (
              <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#991B1B', marginBottom: 8, lineHeight: 1.4 }}>
                  Внимание: все пароли будут удалены. Проект не пострадает.
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                  <button onClick={onToggleReset} style={inlineBtn}>Отмена</button>
                  <button onClick={onReset} style={{ ...inlineBtn, background: '#FEE2E2', borderColor: '#FCA5A5', color: '#B91C1C' }}>Сбросить всё</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Styles

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
  zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 20, backdropFilter: 'blur(4px)',
};
const studio: React.CSSProperties = {
  background: 'white', width: '100%', height: '100%', maxWidth: 1600, maxHeight: '95vh',
  borderRadius: 14, boxShadow: '0 30px 80px rgba(0,0,0,0.3)',
  display: 'flex', overflow: 'hidden',
};
const loaderStyle: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8',
};
const iconBtn: React.CSSProperties = {
  padding: '5px 10px', border: '1px solid #E5E7EB', borderRadius: 6,
  background: 'white', color: '#64748B', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const actionBtn: React.CSSProperties = {
  padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 6,
  background: 'white', color: '#334155',
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
};
const secondaryBtn: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 6,
  background: 'white', color: '#334155',
  fontSize: 12, fontWeight: 500, cursor: 'pointer',
};
const inlineBtn: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #E5E7EB', borderRadius: 6,
  background: 'white', color: '#334155', fontSize: 12, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none',
};
const smallInput: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #E5E7EB', borderRadius: 6,
  fontSize: 11, background: 'white', boxSizing: 'border-box', outline: 'none',
};
const smallSelect: React.CSSProperties = {
  padding: '5px 10px', border: '1px solid #E5E7EB', borderRadius: 6,
  fontSize: 11, background: 'white',
};
const bigInput: React.CSSProperties = {
  width: '100%', padding: '10px 12px', boxSizing: 'border-box',
  border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, outline: 'none',
};
const primaryBigBtn: React.CSSProperties = {
  width: '100%', padding: '10px 16px', border: 'none', borderRadius: 8,
  background: '#2563EB', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const tagChip: React.CSSProperties = {
  fontSize: 11, padding: '3px 8px', borderRadius: 999,
  background: '#DBEAFE', color: '#1E40AF',
  display: 'inline-flex', alignItems: 'center', gap: 4,
};
const tagX: React.CSSProperties = {
  border: 'none', background: 'transparent', color: '#1E40AF',
  cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1,
};
