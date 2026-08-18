/**
 * v0.39 — Folder tree for VaultPanel.
 *
 * Renders a nested list of folders using HTML5 drag-and-drop:
 *   - drag folder onto another folder → reparents
 *   - drag folder onto "🗑 Убрать" chip → moves to root (parent=null)
 *   - drag vault-item chip (from item list) onto folder → set item.folder
 *   - "+ Новая папка" button under the tree
 *   - right-click / long-press → rename / delete
 *
 * Uses vaultFoldersAll / vaultFolderUpsert / vaultFolderDelete IPC.
 * The vault-item drag payload uses dataTransfer type "netmap/vault-item".
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  vaultFoldersAll, vaultFolderUpsert, vaultFolderDelete,
  vaultGet, vaultUpsert,
  type VaultFolder,
} from './vaultClient';
import { promptText, confirmDialog } from './Modal';

interface Props {
  selectedFolderId: string | null | 'all';
  onSelect: (folderId: string | null | 'all') => void;
  /** Called after any tree mutation so the parent can re-fetch items list. */
  onChange?: () => void;
  /** Compact vs full mode — sidebar uses compact. */
  compact?: boolean;
}

interface TreeNode {
  folder: VaultFolder;
  children: TreeNode[];
}

export function VaultFolderTree({ selectedFolderId, onSelect, onChange, compact }: Props) {
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dropOver, setDropOver] = useState<string | null | 'root'>(null);

  const refresh = async () => {
    const list = await vaultFoldersAll();
    setFolders(list);
    // Auto-expand all on first load.
    if (expanded.size === 0 && list.length > 0) {
      setExpanded(new Set(list.map(f => f.id)));
    }
  };
  useEffect(() => { refresh(); }, []);

  const tree = useMemo(() => buildTree(folders), [folders]);

  const handleDrop = async (targetFolderId: string | null, e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(null);
    // 1) dragged folder
    const draggedFolderId = e.dataTransfer.getData('netmap/vault-folder');
    if (draggedFolderId && draggedFolderId !== targetFolderId) {
      // Prevent creating cycles: don't reparent folder into its own descendant.
      if (targetFolderId && isDescendant(folders, targetFolderId, draggedFolderId)) return;
      const f = folders.find(x => x.id === draggedFolderId);
      if (!f) return;
      await vaultFolderUpsert({ ...f, parent: targetFolderId });
      await refresh();
      onChange && onChange();
      return;
    }
    // 2) dragged vault item — decrypt it and re-upsert with new folder id.
    const draggedItemId = e.dataTransfer.getData('netmap/vault-item');
    if (draggedItemId) {
      const res = await vaultGet(draggedItemId);
      if (res.ok && res.item) {
        await vaultUpsert({ ...res.item, folder: targetFolderId });
        onChange && onChange();
      }
      return;
    }
  };

  const createFolder = async () => {
    const name = await promptText('Новая папка', '', 'Название');
    if (!name) return;
    await vaultFolderUpsert({ parent: null, name });
    await refresh();
    onChange && onChange();
  };

  const renameFolder = async (f: VaultFolder) => {
    const name = await promptText('Переименовать папку', f.name, 'Новое название');
    if (!name || name === f.name) return;
    await vaultFolderUpsert({ ...f, name });
    await refresh();
    onChange && onChange();
  };

  const deleteFolder = async (f: VaultFolder) => {
    if (!(await confirmDialog(`Удалить папку «${f.name}»?`,
        'Записи из неё останутся, но окажутся в разделе «Без папки». Отменить нельзя.',
        { danger: true, okText: 'Удалить' }))) return;
    await vaultFolderDelete(f.id);
    if (selectedFolderId === f.id) onSelect('all');
    await refresh();
    onChange && onChange();
  };

  const rowStyle = (isSelected: boolean, isDrop: boolean): React.CSSProperties => ({
    padding: compact ? '3px 6px' : '5px 8px',
    borderRadius: 4, cursor: 'pointer',
    background: isDrop ? '#DBEAFE' : (isSelected ? '#EFF6FF' : 'transparent'),
    color: isSelected ? '#1D4ED8' : '#334155',
    fontWeight: isSelected ? 600 : 400,
    fontSize: compact ? 11 : 12,
    display: 'flex', alignItems: 'center', gap: 4,
    outline: isDrop ? '1px dashed #2563EB' : 'none',
  });

  const renderNode = (n: TreeNode, depth: number): React.ReactNode => {
    const isExpanded = expanded.has(n.folder.id);
    const isSelected = selectedFolderId === n.folder.id;
    const isDrop = dropOver === n.folder.id;
    return (
      <div key={n.folder.id}>
        <div
          style={{ ...rowStyle(isSelected, isDrop), paddingLeft: 6 + depth * 12 }}
          draggable
          onDragStart={(e) => { e.dataTransfer.setData('netmap/vault-folder', n.folder.id); }}
          onDragOver={(e) => { e.preventDefault(); setDropOver(n.folder.id); }}
          onDragLeave={() => setDropOver(prev => (prev === n.folder.id ? null : prev))}
          onDrop={(e) => handleDrop(n.folder.id, e)}
          onClick={() => onSelect(n.folder.id)}
          onContextMenu={async (e) => {
            e.preventDefault();
            const choice = await promptText(
              `Папка «${n.folder.name}»`, '',
              'r — переименовать · d — удалить · Enter — ничего'
            );
            if (choice === 'r') renameFolder(n.folder);
            else if (choice === 'd') deleteFolder(n.folder);
          }}
          title="Клик — выбрать · перетащите чтобы переместить · правый клик — переименовать / удалить"
        >
          {n.children.length > 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(prev => {
                  const next = new Set(prev);
                  if (next.has(n.folder.id)) next.delete(n.folder.id);
                  else next.add(n.folder.id);
                  return next;
                });
              }}
              style={{
                width: 12, height: 12, padding: 0, border: 'none', background: 'transparent',
                fontSize: 10, cursor: 'pointer', color: '#64748B',
              }}
            >{isExpanded ? '▼' : '▶'}</button>
          ) : (
            <span style={{ width: 12, display: 'inline-block' }} />
          )}
          <span>📁</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {n.folder.name}
          </span>
        </div>
        {isExpanded && n.children.map(c => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div
        style={rowStyle(selectedFolderId === 'all', false)}
        onClick={() => onSelect('all')}
      >
        <span style={{ width: 12 }} />
        <span>🗂</span>
        <span>Все записи</span>
      </div>
      <div
        style={rowStyle(selectedFolderId === null, dropOver === 'root')}
        onDragOver={(e) => { e.preventDefault(); setDropOver('root'); }}
        onDragLeave={() => setDropOver(prev => (prev === 'root' ? null : prev))}
        onDrop={(e) => handleDrop(null, e)}
        onClick={() => onSelect(null)}
      >
        <span style={{ width: 12 }} />
        <span>📂</span>
        <span>Без папки</span>
      </div>

      <div style={{ borderTop: '1px solid #E5E7EB', margin: '4px 0' }} />

      {tree.map(n => renderNode(n, 0))}

      <button
        onClick={createFolder}
        style={{
          marginTop: 4, padding: compact ? '3px 6px' : '4px 8px',
          border: '1px dashed #CBD5E1', borderRadius: 4, background: 'transparent',
          color: '#64748B', fontSize: compact ? 10 : 11, cursor: 'pointer',
        }}
      >+ Новая папка</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers

function buildTree(folders: VaultFolder[]): TreeNode[] {
  const byParent = new Map<string | null, VaultFolder[]>();
  for (const f of folders) {
    const p = f.parent || null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(f);
  }
  const walk = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) || [])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(f => ({ folder: f, children: walk(f.id) }));
  return walk(null);
}

function isDescendant(folders: VaultFolder[], candidateId: string, ancestorId: string): boolean {
  let cur = folders.find(f => f.id === candidateId);
  let guard = 50;
  while (cur && cur.parent && guard-- > 0) {
    if (cur.parent === ancestorId) return true;
    cur = folders.find(f => f.id === cur!.parent);
  }
  return false;
}
