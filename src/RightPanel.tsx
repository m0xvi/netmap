import { useState } from 'react';
import { useStore } from './store';
import { DevicePanel } from './DevicePanel';
import { GroupPanel } from './GroupPanel';
import { NetworkOverviewPanel } from './NetworkOverviewPanel';

/**
 * Collapsible right-side panel wrapper. The panel shows either
 * DevicePanel or GroupPanel depending on selection.
 * User can click the caret to collapse it into a slim 24-px rail.
 */
export function RightPanel() {
  const selectedGroupId = useStore(s => s.selectedGroupId);
  const selectedDeviceId = useStore(s => s.selectedDeviceId);
  const setRightPanelOpen = useStore(s => s.setRightPanelOpen);
  const select = useStore(s => s.select);
  const selectGroup = useStore(s => s.selectGroup);
  const [collapsed, setCollapsed] = useState(false);

  const hasSelection = !!(selectedGroupId || selectedDeviceId);

  // v0.47 — × button in the panel: clears selection AND fully hides the
  // panel (so canvas takes the whole width again).
  const closeFully = () => {
    select(null);
    selectGroup(null);
    setRightPanelOpen(false);
  };

  return (
    <div style={{
      display: 'flex', height: '100%', flexShrink: 0,
      transition: 'width 0.2s ease',
    }}>
      {/* Slim rail with the toggle button */}
      <div style={{
        width: 24, background: '#F9FAFB',
        borderLeft: '1px solid #E5E7EB',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '6px 0',
      }}>
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Показать панель свойств' : 'Скрыть панель свойств'}
          style={{
            width: 20, height: 40,
            background: 'transparent',
            border: 'none',
            color: '#6B7280',
            cursor: 'pointer',
            fontSize: 14, lineHeight: 1,
            padding: 0,
            borderRadius: 3,
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#F9FAFB';
                               (e.currentTarget as HTMLButtonElement).style.color = '#111827'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                               (e.currentTarget as HTMLButtonElement).style.color = '#6B7280'; }}
        >
          {collapsed ? '‹' : '›'}
        </button>

        {/* Selection indicator when collapsed */}
        {collapsed && hasSelection && (
          <div title="Есть выделенный объект" style={{
            marginTop: 8, width: 6, height: 6, borderRadius: '50%',
            background: '#2563EB',
          }} />
        )}

        {/* v0.47 — × fully-close button. Different from ‹ (collapse to 24px
            rail): this hides the whole panel + clears selection. */}
        <button
          onClick={closeFully}
          title="Закрыть панель полностью"
          style={{
            marginTop: 'auto', width: 20, height: 20,
            background: 'transparent', border: 'none',
            color: '#94A3B8', cursor: 'pointer',
            fontSize: 12, lineHeight: 1, padding: 0, borderRadius: 3,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#FEE2E2';
                               (e.currentTarget as HTMLButtonElement).style.color = '#DC2626'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                               (e.currentTarget as HTMLButtonElement).style.color = '#94A3B8'; }}
        >✕</button>
      </div>

      {/* v0.41.2: when nothing is selected we show the KPI Network Overview
          dashboard (matches reference design). Selecting a device / group
          swaps to the detailed inspector. */}
      {!collapsed && (
        selectedGroupId ? <GroupPanel />
        : selectedDeviceId ? <DevicePanel />
        : <NetworkOverviewPanel />
      )}
    </div>
  );
}
