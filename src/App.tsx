import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { ToolsStrip } from './ToolsStrip';
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

// ---------------------------------------------------------------------------
// v0.51.17: слайд-анимация сворачивания боковых панелей.
//
// Панель больше не монтируется/размонтируется мгновенно: она ВСЕГДА
// смонтирована внутри обёртки, у которой анимируется ширина (0 ↔ реальная
// ширина контента). Ширина контента измеряется через ResizeObserver, поэтому
// анимация корректна даже когда содержимое панели меняет размер (например,
// правая панель: обзор 320 → инспектор устройства 360, или внутреннее
// сворачивание левой панели до иконочной рейки 44).
// ---------------------------------------------------------------------------

const PANEL_MS = 240;
const PANEL_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** Уважаем системный запрос «уменьшить движение» и настройку приложения
    «Отключить анимации» (тот же ключ, что использует Canvas). */
function usePanelReduceMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try { if (localStorage.getItem('netmap:disableMapAnimations') === '1') return true; } catch {}
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });
  useEffect(() => {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onChange = () => setReduced(mq.matches);
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    } catch { return; }
  }, []);
  return reduced;
}

function SlidePanel({ open, children }: { open: boolean; children: React.ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [contentW, setContentW] = useState(0);
  const reduceMotion = usePanelReduceMotion();

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    // offsetWidth не зависит от CSS-масштаба страницы — то, что нужно для
    // ширины в тех же единицах, что и раскладка.
    const measure = () => setContentW(el.offsetWidth);
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  // Когда панель закрыта, прячем её из tab-порядка ПОСЛЕ завершения
  // анимации (задержанный переход на visibility), а при открытии — сразу.
  const transition = reduceMotion
    ? 'none'
    : open
      ? `width ${PANEL_MS}ms ${PANEL_EASE}, visibility 0s`
      : `width ${PANEL_MS}ms ${PANEL_EASE}, visibility 0s linear ${PANEL_MS}ms`;

  return (
    <div style={{
      width: open ? contentW : 0,
      minWidth: 0,
      flexShrink: 0,
      height: '100%',
      overflow: 'hidden',
      visibility: open ? 'visible' : 'hidden',
      transition,
    }}>
      <div ref={innerRef} style={{ width: 'max-content', height: '100%' }}>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const rightPanelOpen = useStore(s => s.rightPanelOpen);
  const toggleSidebar = useStore(s => s.toggleSidebar);
  const toggleRightPanel = useStore(s => s.toggleRightPanel);
  const [uiScale, setUiScale] = useState(() => {
    try {
      const v = Number(localStorage.getItem('netmap:uiScale'));
      if (!Number.isFinite(v) || v < 0.8 || v > 2) return 1;
      return v;
    } catch { return 1; }
  });

  useEffect(() => {
    const onScale = (e: Event) => {
      const value = Number((e as CustomEvent<{ value: number }>).detail?.value);
      if (Number.isFinite(value)) setUiScale(Math.max(0.8, Math.min(2, value)));
    };
    window.addEventListener('netmap:ui-scale', onScale);
    return () => window.removeEventListener('netmap:ui-scale', onScale);
  }, []);

  // v0.51.16: как применяется масштаб.
  // В Electron (нативный бэкенд) — page-zoom через webFrame (см. preload):
  // он масштабирует всё окно целиком и НЕ ломает координаты мыши на канвасе
  // (перетаскивание, drop из каталога, коннекты портов, рамки выделения).
  // Старый путь через `body.style.zoom` этим управлял плохо: координаты
  // курсора и getBoundingClientRect() масштабируются, а внутренняя математика
  // React Flow — нет, поэтому при масштабе ≠ 100% карточки «убегали» от
  // курсора, а интерфейс отсекался снизу/справа (100vh × zoom).
  // В браузерном preview (нет бэкенда) остаёмся на CSS zoom как компромисс,
  // но компенсируем размер корневого контейнера, чтобы ничего не отсекалось.
  const hasNativeZoom = typeof window !== 'undefined'
    && typeof (window as any).netmap?.setUiZoom === 'function';
  const cssZoomFallback = hasNativeZoom ? 1 : uiScale;

  useEffect(() => {
    // Keep the desktop workspace fixed to the viewport. Wheel gestures over
    // React Flow must not scroll the page and move the whole interface.
    const html = document.documentElement;
    const body = document.body;
    const previous = { htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow, bodyMargin: body.style.margin, bodyZoom: body.style.zoom };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.margin = '0';
    if (hasNativeZoom) {
      (window as any).netmap.setUiZoom(uiScale);
      body.style.zoom = '';
    } else {
      body.style.zoom = String(uiScale);
    }
    return () => {
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.margin = previous.bodyMargin;
      body.style.zoom = previous.bodyZoom;
    };
  }, [uiScale, hasNativeZoom]);

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
    <div style={{
      display: 'flex', flexDirection: 'column',
      // v0.51.16: при CSS-zoom (браузерный preview) 100vh «растягивается»
      // на коэффициент масштаба и интерфейс обрезается снизу/справа.
      // Делим размер на зум, чтобы после масштабирования занять ровно вьюпорт.
      height: cssZoomFallback !== 1 ? `calc(100vh / ${cssZoomFallback})` : '100vh',
      width: cssZoomFallback !== 1 ? `calc(100vw / ${cssZoomFallback})` : undefined,
      minHeight: 0, overflow: 'hidden',
    }}>
      {/* v0.42: HTML custom menubar (File/View/Tools/Monitor/Help). Sits
          above the toolbar, replaces the old hamburger ☰ AppMenu. */}
      <MenuBar />
      <Toolbar />
      {/* v0.61.1: ToolsStrip — горизонтальная панель инструментов (draw.io-стиль). */}
      <ToolsStrip />
      {/* v0.36.2: update banner right under the toolbar — shows on the
          "available" / "downloading" / "downloaded" / "error" states from
          electron-updater. Hides when no updates or in dev mode. */}
      <UpdateBanner />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        {/* v0.42: new 5-icon activity-bar sidebar replaces the old accordion.
            Panels: Topology (Catalog/Layers/VLANs) · Devices (table) ·
            Alerts (notification centre) · Vault · Settings.
            v0.51.17: обёртка слайд-анимации сворачивания. */}
        <SlidePanel open={sidebarOpen}><NewSidebar /></SlidePanel>
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
        {/* v0.51.17: обёртка слайд-анимации сворачивания. */}
        <SlidePanel open={rightPanelOpen}><RightPanel /></SlidePanel>
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
