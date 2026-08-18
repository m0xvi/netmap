/**
 * v0.43.2 — sidebar Vault panel (rebuild from scratch in reference clean-style).
 *
 * Rendered inside NewSidebar's content column (~320px wide) when user clicks
 * the shield icon in the activity bar. Not the full 3-column Studio — a
 * single stack layout with the same visual language:
 *   - Header: "Vault" + Expand / Import / Export / Lock buttons (no emoji)
 *   - Search input with Ctrl+K hint
 *   - Big blue "+ New Record" button
 *   - Categories list (auto-derived from item kind)
 *   - Tags list
 *   - Items grid (compact cards)
 *
 * For editing an item we open the full Vault Studio (Ctrl+K) — the sidebar
 * doesn't have room for the slide-over drawer.
 */

import { useEffect, useMemo, useState } from 'react';
import { alertDialog, confirmDialog } from './Modal';
import {
  vaultStatus, vaultInit, vaultUnlock, vaultLock,
  vaultList, vaultGet,
  type VaultItemMeta, type VaultStatus,
} from './vaultClient';
import { VaultImportExportDialog } from './VaultImportExportDialog';
import { CATEGORIES, deriveKind, type VaultKind } from './vaultCategories';
import { getFavicon } from './faviconClient';
import { MiniSpinner } from './Spinner';

type NavSection = { kind: 'all' } | { kind: 'category'; id: VaultKind } | { kind: 'tag'; name: string };

export function VaultPanel() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [items, setItems] = useState<VaultItemMeta[]>([]);
  const [nav, setNav] = useState<NavSection>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [ioOpen, setIoOpen] = useState(false);
  const [ioTab, setIoTab] = useState<'import' | 'export' | 'migrate'>('import');
  // Setup / Unlock inline
  const [master, setMaster] = useState('');
  const [master2, setMaster2] = useState('');
  const [err, setErr] = useState('');
  const [showResetPrompt, setShowResetPrompt] = useState(false);
  const [unlocking, setUnlocking] = useState(false); // v0.44.2 — visual feedback

  const refresh = async () => {
    const s = await vaultStatus();
    setStatus(s);
    if (s.unlocked) setItems(await vaultList());
    else setItems([]);
  };
  useEffect(() => { refresh(); }, []);

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

  // v0.43.6: expand button available in every state (was only in unlocked).
  const expand = () => window.dispatchEvent(new CustomEvent('netmap:open-vault-studio'));

  // ---------- Not initialized ----------
  if (status && !status.initialized) {
    return (
      <PanelChrome title="Vault" onExpand={expand}>
        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          <div style={centerIcon}>
            <ShieldIcon size={22} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', textAlign: 'center' }}>
            Создать vault
          </div>
          <div style={{ fontSize: 11, color: '#64748B', lineHeight: 1.5, textAlign: 'center' }}>
            Придумайте мастер-пароль. Он шифрует все записи (AES-256-GCM + PBKDF2 200k).
            <br /><b style={{ color: '#B91C1C' }}>Пароль нельзя восстановить.</b>
          </div>
          <input type="password" placeholder="Мастер-пароль (мин 6)" value={master}
            onChange={e => setMaster(e.target.value)} style={inputStyle} autoFocus />
          <input type="password" placeholder="Повторите" value={master2}
            onChange={e => setMaster2(e.target.value)}
            onKeyDown={async e => {
              if (e.key !== 'Enter') return;
              setErr('');
              if (master.length < 6) return setErr('Минимум 6 символов');
              if (master !== master2) return setErr('Пароли не совпадают');
              const res = await vaultInit(master);
              if (!res.ok) return setErr((res as any).error || 'Ошибка');
              setMaster(''); setMaster2(''); refresh();
            }}
            style={inputStyle} />
          {err && <div style={{ fontSize: 11, color: '#DC2626' }}>{err}</div>}
          <button
            onClick={async () => {
              setErr('');
              if (master.length < 6) return setErr('Минимум 6 символов');
              if (master !== master2) return setErr('Пароли не совпадают');
              const res = await vaultInit(master);
              if (!res.ok) return setErr((res as any).error || 'Ошибка');
              setMaster(''); setMaster2(''); refresh();
            }}
            style={primaryBtnStyle}
          >Создать</button>
        </div>
      </PanelChrome>
    );
  }

  // ---------- Locked ----------
  if (status && !status.unlocked) {
    return (
      <PanelChrome title="Vault" onExpand={expand}>
        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          <div style={centerIcon}>
            <LockIcon size={22} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', textAlign: 'center' }}>
            Vault заблокирован
          </div>
          <div style={{ fontSize: 11, color: '#64748B', textAlign: 'center' }}>
            Введите мастер-пароль.
          </div>
          <input type="password" placeholder="Мастер-пароль" value={master}
            disabled={unlocking}
            onChange={e => setMaster(e.target.value)}
            onKeyDown={async e => {
              if (e.key !== 'Enter' || unlocking) return;
              setErr(''); setUnlocking(true);
              try {
                const res = await vaultUnlock(master);
                if (!res.ok) { setErr((res as any).error === 'wrong-password' ? 'Неверный пароль' : (res as any).error); return; }
                setMaster(''); refresh();
              } finally { setUnlocking(false); }
            }}
            style={inputStyle} autoFocus />
          {err && <div style={{ fontSize: 11, color: '#DC2626' }}>{err}</div>}
          <button
            disabled={unlocking || !master}
            onClick={async () => {
              setErr(''); setUnlocking(true);
              try {
                const res = await vaultUnlock(master);
                if (!res.ok) { setErr((res as any).error === 'wrong-password' ? 'Неверный пароль' : (res as any).error); return; }
                setMaster(''); refresh();
              } finally { setUnlocking(false); }
            }}
            style={{ ...primaryBtnStyle, opacity: (unlocking || !master) ? 0.65 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >{unlocking && <MiniSpinner light />}{unlocking ? 'Проверяем…' : 'Разблокировать'}</button>

          {/* Forgot password */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #F1F5F9' }}>
            {!showResetPrompt ? (
              <button onClick={() => setShowResetPrompt(true)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 10, cursor: 'pointer', textDecoration: 'underline', width: '100%' }}>
                Забыли пароль? Сбросить vault…
              </button>
            ) : (
              <div style={{ padding: 10, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#991B1B', marginBottom: 6, lineHeight: 1.4 }}>
                  Все сохранённые пароли будут удалены. Проект не пострадает.
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => setShowResetPrompt(false)} style={{ ...secondaryBtnStyle, flex: 1 }}>Отмена</button>
                  <button onClick={async () => {
                    if (!(await confirmDialog('Сбросить vault?', 'Все пароли будут удалены безвозвратно.', { danger: true, okText: 'Сбросить' }))) return;
                    const w = window as any;
                    if (w.netmap?.vaultReset) { await w.netmap.vaultReset(); setShowResetPrompt(false); setMaster(''); refresh(); }
                  }} style={{ ...secondaryBtnStyle, flex: 1, borderColor: '#FCA5A5', color: '#B91C1C' }}>Сбросить</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </PanelChrome>
    );
  }

  // ---------- Unlocked ----------
  return (
    <PanelChrome
      title="Vault"
      onExpand={expand}
      onLock={async () => { await vaultLock(); refresh(); }}
    >
      <VaultImportExportDialog open={ioOpen} initialTab={ioTab} onClose={() => { setIoOpen(false); refresh(); }} />

      <div style={{ padding: '10px 12px', display: 'grid', gap: 8, borderBottom: '1px solid #F1F5F9' }}>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search vault..."
            style={{
              width: '100%', padding: '7px 10px 7px 30px', boxSizing: 'border-box',
              border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12,
              background: '#F8FAFC', outline: 'none',
            }}
          />
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', display: 'flex' }}>
            <SearchIcon size={12} />
          </span>
          <span style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            fontSize: 9, color: '#94A3B8', background: '#F1F5F9',
            padding: '1px 5px', borderRadius: 3, fontFamily: 'ui-monospace, monospace',
          }}>Ctrl+K</span>
        </div>

        {/* Primary + secondary buttons */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('netmap:open-vault-studio'))}
          style={{
            padding: '9px 12px', border: 'none', borderRadius: 6,
            background: '#2563EB', color: 'white',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >+ New Record</button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button onClick={() => { setIoTab('import'); setIoOpen(true); }} style={secondaryBtnStyle}>Импорт</button>
          <button onClick={() => { setIoTab('export'); setIoOpen(true); }} style={secondaryBtnStyle}>Экспорт</button>
        </div>
      </div>

      {/* Body — scrollable */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Categories */}
        <div style={{ padding: '10px 8px 4px' }}>
          <SectionTitle>CATEGORIES</SectionTitle>
          <NavRow
            label="All Records" count={items.length}
            icon={<AllRecordsIcon />}
            active={nav.kind === 'all'} onClick={() => setNav({ kind: 'all' })}
          />
          {CATEGORIES.map(c => {
            const n = catCounts.get(c.id) || 0;
            if (n === 0) return null;
            return (
              <NavRow
                key={c.id} label={c.label} count={n}
                icon={<CategoryIcon id={c.id} />} color={c.color}
                active={nav.kind === 'category' && nav.id === c.id}
                onClick={() => setNav({ kind: 'category', id: c.id })}
              />
            );
          })}
        </div>

        {/* Tags */}
        {allTags.length > 0 && (
          <div style={{ padding: '8px 8px 4px' }}>
            <SectionTitle>TAGS</SectionTitle>
            {allTags.slice(0, 20).map(([t, n]) => (
              <NavRow
                key={t} label={t} count={n}
                icon={<TagIcon />}
                active={nav.kind === 'tag' && nav.name === t}
                onClick={() => setNav({ kind: 'tag', name: t })}
              />
            ))}
          </div>
        )}

        {/* Items list */}
        <div style={{ padding: '4px 10px 12px' }}>
          <SectionTitle>
            {nav.kind === 'all' ? 'ALL RECORDS'
              : nav.kind === 'category' ? (CATEGORIES.find(c => c.id === nav.id)?.label.toUpperCase() || 'RECORDS')
              : `#${nav.name}`.toUpperCase()}
            <span style={{ marginLeft: 6, color: '#CBD5E1' }}>·</span>
            <span style={{ marginLeft: 6, color: '#94A3B8', fontWeight: 500 }}>{visible.length}</span>
          </SectionTitle>
          {visible.length === 0 ? (
            <div style={{ padding: '16px 8px', fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>
              {items.length === 0
                ? 'Vault пуст. Добавьте запись или импортируйте.'
                : query ? 'Ничего не найдено' : 'В этой категории нет записей'}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {visible.map(item => <CompactItemCard key={item.id} item={item} />)}
            </div>
          )}
        </div>
      </div>
    </PanelChrome>
  );
}

// ===========================================================================
// Panel chrome (header with Vault title + Expand / Lock buttons)

function PanelChrome({ title, onExpand, onLock, children }: {
  title: string;
  onExpand?: () => void;
  onLock?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'white' }}>
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid #F1F5F9',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>{title}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {onExpand && (
            <button onClick={onExpand} title="Развернуть на весь экран (Ctrl+K)" style={iconBtnStyle}>
              <ExpandIcon size={13} />
            </button>
          )}
          {onLock && (
            <button onClick={onLock} title="Заблокировать" style={iconBtnStyle}>
              <LockIcon size={13} />
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

// ===========================================================================
// Compact item card (single-column, ~280px wide)

function CompactItemCard({ item }: { item: VaultItemMeta }) {
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
  const openStudio = () => {
    // Open full Studio so the user has room to edit — sidebar is too narrow.
    window.dispatchEvent(new CustomEvent('netmap:open-vault-studio'));
  };
  return (
    <div
      onClick={openStudio}
      style={{
        background: 'white', border: '1px solid #E5E7EB', borderRadius: 8,
        padding: 10, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
        transition: 'border-color 100ms, box-shadow 100ms',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#CBD5E1'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#E5E7EB'; }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 6, flexShrink: 0,
        background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {favicon
          ? <img src={favicon} alt="" style={{ width: 20, height: 20 }} onError={() => setFavicon(null)} />
          : <KeyIcon size={14} color="#94A3B8" />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.name}
        </div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>
          ••••••••••
        </div>
      </div>
      <button onClick={doCopy} style={{
        padding: '5px 7px', border: '1px solid #E5E7EB', borderRadius: 5,
        background: copied ? '#D1FAE5' : 'white',
        color: copied ? '#065F46' : '#64748B',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      </button>
    </div>
  );
}

// ===========================================================================
// Navigator components

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
      <span style={{ width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: active ? '#2563EB' : (color || '#64748B') }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 500 }}>{count}</span>
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color: '#94A3B8',
      letterSpacing: 0.8, padding: '4px 8px 4px',
      textTransform: 'uppercase',
      display: 'flex', alignItems: 'center',
    }}>{children}</div>
  );
}

// ===========================================================================
// SVG icons (all inline — no external deps, no emoji)

const svgP = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function ShieldIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" {...svgP}>
    <path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z"/>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
  </svg>);
}
function LockIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" {...svgP}>
    <rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>);
}
function ExpandIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" {...svgP}>
    <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
  </svg>);
}
function SearchIcon({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" {...svgP}>
    <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>);
}
function AllRecordsIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" {...svgP}>
    <rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="4" x2="9" y2="20"/>
  </svg>);
}
function TagIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" {...svgP}>
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
    <line x1="7" y1="7" x2="7.01" y2="7"/>
  </svg>);
}
function KeyIcon({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M17 6l2 2M15 8l2 2"/>
  </svg>);
}
function CopyIcon({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" {...svgP}>
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>
  </svg>);
}
function CheckIcon({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>);
}
function CategoryIcon({ id }: { id: VaultKind }) {
  switch (id) {
    case 'login':       return (<svg width="14" height="14" viewBox="0 0 24 24" {...svgP}><rect x="3" y="4" width="18" height="12" rx="1"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/></svg>);
    case 'ssh':         return (<svg width="14" height="14" viewBox="0 0 24 24" {...svgP}><path d="M4 17l6-6-6-6"/><line x1="12" y1="19" x2="20" y2="19"/></svg>);
    case 'wifi':        return (<svg width="14" height="14" viewBox="0 0 24 24" {...svgP}><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>);
    case 'cert':        return (<svg width="14" height="14" viewBox="0 0 24 24" {...svgP}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="15" r="2"/><line x1="12" y1="17" x2="12" y2="20"/></svg>);
    case 'secure_note': return (<svg width="14" height="14" viewBox="0 0 24 24" {...svgP}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>);
    case 'api_token':   return (<svg width="14" height="14" viewBox="0 0 24 24" {...svgP}><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M17 6l2 2M15 8l2 2"/></svg>);
    case 'database':    return (<svg width="14" height="14" viewBox="0 0 24 24" {...svgP}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>);
    default: return null;
  }
}

// ===========================================================================
// Styles

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 6,
  fontSize: 12, background: 'white', boxSizing: 'border-box', width: '100%', outline: 'none',
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '9px 12px', border: 'none', borderRadius: 6,
  background: '#2563EB', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 6,
  background: 'white', color: '#334155', fontSize: 12, fontWeight: 500, cursor: 'pointer',
};
const iconBtnStyle: React.CSSProperties = {
  padding: '5px 7px', border: '1px solid #E5E7EB', borderRadius: 5,
  background: 'white', color: '#64748B', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const centerIcon: React.CSSProperties = {
  margin: '10px auto 0', width: 48, height: 48, borderRadius: 12,
  background: 'linear-gradient(135deg, #2563EB, #7C3AED)',
  color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
};
