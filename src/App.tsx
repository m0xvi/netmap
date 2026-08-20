import { useEffect } from 'react';
import { useStore } from './store';
import { Canvas } from './Canvas';
import { RightPanel } from './RightPanel';
import { Toolbar } from './Toolbar';
import { MenuBar } from './MenuBar';
import { NewSidebar } from './NewSidebar';
import { ContextMenuHost } from './ContextMenuHost';
import { PathBanner } from './PathBanner';
import { MultiSelectBar } from './MultiSelectBar';
import { PingMonitor } from './PingMonitor';
import { FocusView } from './FocusView';
import { LayerLegend } from './LayerLegend';
import { VlanFilterBanner } from './VlanFilterBanner';
import { LayoutFAB } from './LayoutFAB';
import { LoadingOverlay } from './LoadingOverlay';
import { OnboardingHost } from './OnboardingDialog';
import { NotificationDispatcher } from './NotificationDispatcher';
import { VaultAutoLockOverlay } from './VaultAutoLockOverlay';
import { VaultStudioHost } from './VaultStudio';
import { SshTerminalDialogHost } from './SshTerminalDialog';
import { UpdateBanner } from './UpdateBanner';
import { TracerouteDialogHost } from './TracerouteDialog';
import { hydrateFromNativeBackend } from './store';
import { hydrateTemplatesFromBackend } from './templates';

export default function App() {
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const rightPanelOpen = useStore(s => s.rightPanelOpen);
  const toggleSidebar = useStore(s => s.toggleSidebar);
  const toggleRightPanel = useStore(s => s.toggleRightPanel);

  useEffect(() => {
    // v0.36.1: mark hydration complete so LoadingOverlay splash hides.
    Promise.all([
      Promise.resolve(hydrateFromNativeBackend()),
      hydrateTemplatesFromBackend(),
    ]).then(() => {
      window.dispatchEvent(new CustomEvent('netmap:templates-updated'));
      window.dispatchEvent(new CustomEvent('netmap:hydrated'));
    });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* v0.42: HTML custom menubar (File/View/Tools/Monitor/Help). Sits
          above the toolbar, replaces the old hamburger ☰ AppMenu. */}
      <MenuBar />
      <Toolbar />
      {/* v0.36.2: update banner right under the toolbar — shows on the
          "available" / "downloading" / "downloaded" / "error" states from
          electron-updater. Hides when no updates or in dev mode. */}
      <UpdateBanner />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        {/* v0.42: new 5-icon activity-bar sidebar replaces the old accordion.
            Panels: Topology (Catalog/Layers/VLANs) · Devices (table) ·
            Alerts (notification centre) · Vault · Settings. */}
        {sidebarOpen && <NewSidebar />}
        <div style={{ flex: 1, position: 'relative' }}>
          <Canvas />
          <PathBanner />
          <MultiSelectBar />
          {/* v0.42.1: LayerLegend + LinkLegend убраны из canvas по запросу —
              они дублируют информацию из правой панели / фильтров и мешают
              просмотру карты на весь экран. */}
          <VlanFilterBanner />
          <LayoutFAB />

          {/* v0.41: floating tab-buttons to bring the panels back when hidden.
              Sit at left/right edge of the map, half-visible chevrons. */}
          {!sidebarOpen && (
            <button
              onClick={toggleSidebar}
              title="Показать боковую панель"
              style={edgeTabLeft}
            >›</button>
          )}
          {!rightPanelOpen && (
            <button
              onClick={toggleRightPanel}
              title="Показать правую панель"
              style={edgeTabRight}
            >‹</button>
          )}
        </div>
        {rightPanelOpen && <RightPanel />}
      </div>
      <ContextMenuHost />
      <PingMonitor />
      <FocusView />
      {/* v0.36.1: splash + progress overlay for long ops (loads, imports, exports) */}
      <LoadingOverlay />
      {/* v0.49.0: first-run onboarding tour (7 slides + seed loader).
          Auto-opens on first launch, re-openable via Help menu. */}
      <OnboardingHost />
      {/* v0.36.1: fan-out ping-alerts to native Windows toast + Telegram */}
      <NotificationDispatcher />
      {/* v0.36.2: traceroute dialog — opens on `netmap:open-traceroute` event
          (fired from Inspector → Overview → Traceroute button). */}
      <TracerouteDialogHost />
      {/* v0.38: fullscreen overlay shown when vault auto-locks from idle */}
      <VaultAutoLockOverlay />
      {/* v0.40: fullscreen Vault Studio (Ctrl+K) */}
      <VaultStudioHost />
      {/* v0.40: SSH terminal dialog (opens on netmap:open-ssh-terminal event) */}
      <SshTerminalDialogHost />
    </div>
  );
}

// v0.41: floating tab-buttons on the map edges to show panels when hidden.
const edgeTabBase: React.CSSProperties = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
  width: 20, height: 60, padding: 0,
  background: '#FFFFFF', border: '1px solid #E5E7EB',
  color: '#64748B', cursor: 'pointer', fontSize: 16, fontWeight: 700,
  zIndex: 50,
  boxShadow: '0 2px 8px rgba(15,23,42,0.08)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const edgeTabLeft: React.CSSProperties = {
  ...edgeTabBase, left: 0, borderLeft: 'none',
  borderRadius: '0 8px 8px 0',
};
const edgeTabRight: React.CSSProperties = {
  ...edgeTabBase, right: 0, borderRight: 'none',
  borderRadius: '8px 0 0 8px',
};
