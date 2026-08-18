import { Component, type ReactNode, type ErrorInfo } from 'react';
import { useStore } from './store';

/** Push a global error / warning into the store's notification centre so it
 *  also shows up in the AlertsButton dropdown (not just the red banner).
 *  Safe to call from anywhere — imperative wrapper around zustand. */
function pushErrorAlert(title: string, message: string, severity: 'critical' | 'warn' = 'critical') {
  try {
    useStore.getState().pushAlert({
      severity, origin: 'error', title, message,
    });
  } catch { /* store not ready yet — silently drop */ }
}

/**
 * v0.35.4 — App-wide error boundary.
 *
 * Previously any uncaught React error (React #185, TypeError in a node
 * renderer, etc.) would blank the whole window and force the user to open
 * DevTools + copy the stack manually. Now we render a full-screen error card
 * with:
 *   - the error message and stack (scrollable)
 *   - the component tree that threw (React componentStack)
 *   - a "Copy to clipboard" button so the user can paste the full report
 *   - "Try to recover" (re-mounts children) and "Reload app" buttons
 *
 * NOTE: React error boundaries only catch errors thrown DURING RENDER, in
 * lifecycle methods, or in constructors of child components. They do NOT
 * catch errors in:
 *   - event handlers (onClick, onChange, ...)     → caught by window.onerror
 *   - async code (setTimeout, promises)           → caught by unhandledrejection
 *   - the boundary itself
 * So we ALSO wire global error listeners and re-throw into React state.
 */

interface Props { children: ReactNode }
interface State {
  error: Error | null;
  info: ErrorInfo | null;
  /** Errors caught by the global window handlers (not by React itself). */
  globalErrors: Array<{ msg: string; source: string; at: number }>;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, globalErrors: [] };

  // v0.35.5: ignore-list for known-benign warnings that flood the banner
  // without ever actually breaking anything. `ResizeObserver loop completed
  // with undelivered notifications` is a spec-level warning from the browser
  // when the same element is resized twice in one frame — react-flow does
  // this legitimately during node measurement.
  private isBenignError(msg: string): boolean {
    return /ResizeObserver loop (completed|limit exceeded)/i.test(msg);
  }

  private onGlobalError = (e: ErrorEvent) => {
    const msg = e.error?.stack || e.error?.message || e.message || String(e);
    if (this.isBenignError(msg)) {
      // Also stop it from spamming DevTools console
      e.stopImmediatePropagation?.();
      return;
    }
    this.setState(s => ({
      globalErrors: [...s.globalErrors.slice(-9),
                     { msg, source: `${e.filename}:${e.lineno}:${e.colno}`, at: Date.now() }],
    }));
    // Mirror into the notification centre so the user sees a persistent
    // record in the toolbar bell — the red banner disappears on "Hide".
    pushErrorAlert('Ошибка приложения', `${msg}\n\n@ ${e.filename}:${e.lineno}:${e.colno}`);
  };
  private onUnhandledRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason;
    const msg = r?.stack || r?.message || (typeof r === 'string' ? r : JSON.stringify(r));
    if (this.isBenignError(msg)) return;
    this.setState(s => ({
      globalErrors: [...s.globalErrors.slice(-9),
                     { msg, source: 'unhandledrejection', at: Date.now() }],
    }));
    pushErrorAlert('Необработанный промис', msg);
  };

  componentDidMount() {
    window.addEventListener('error', this.onGlobalError);
    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
  }
  componentWillUnmount() {
    window.removeEventListener('error', this.onGlobalError);
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep both — some errors have very short .stack but rich componentStack.
    this.setState({ error, info });
    // Also mirror to console for DevTools users who prefer it there.
    // eslint-disable-next-line no-console
    console.error('[NetMap ErrorBoundary]', error, info);
    // ...and into the notification centre for persistent history.
    pushErrorAlert('Ошибка рендера', error.stack || error.message || String(error));
  }

  private recover = () => this.setState({ error: null, info: null });
  private reload = () => window.location.reload();

  private copyReport = async (report: string) => {
    try {
      await navigator.clipboard.writeText(report);
      // Non-modal ping — no toast library, just briefly flash the button label
      const btn = document.getElementById('netmap-copy-error-btn');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Скопировано ✓';
        setTimeout(() => { if (btn) btn.textContent = orig || ''; }, 1400);
      }
    } catch { /* clipboard may be blocked — silently ignore */ }
  };

  render() {
    const { error, info, globalErrors } = this.state;

    // Global errors banner — shown even without a render-time crash.
    const banner = globalErrors.length > 0 && !error ? (
      <div style={bannerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <strong>Замечены ошибки:</strong>
          <span>{globalErrors.length}</span>
          <button
            onClick={() => this.setState({ globalErrors: [] })}
            style={{ marginLeft: 'auto', ...bannerBtn }}>
            Скрыть
          </button>
          <button
            onClick={() => this.copyReport(globalErrors.map(g =>
              `[${new Date(g.at).toLocaleTimeString()}] ${g.source}\n${g.msg}`).join('\n\n'))}
            style={bannerBtn}>
            Скопировать
          </button>
        </div>
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.85 }}>Показать</summary>
          <div style={{ maxHeight: 200, overflow: 'auto', marginTop: 6,
                         fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.4 }}>
            {globalErrors.slice().reverse().map((g, i) => (
              <div key={g.at + ':' + i} style={{ marginBottom: 8, paddingBottom: 6,
                     borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
                <div style={{ opacity: 0.75, fontSize: 10 }}>
                  {new Date(g.at).toLocaleTimeString()} · {g.source}
                </div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {g.msg}
                </pre>
              </div>
            ))}
          </div>
        </details>
      </div>
    ) : null;

    if (!error) {
      return <>
        {this.props.children}
        {banner}
      </>;
    }

    // Full-screen fatal error view
    const stack = error.stack || String(error);
    const componentStack = info?.componentStack || '';
    const report =
      `NetMap error report\n` +
      `Time: ${new Date().toISOString()}\n` +
      `URL: ${location.href}\n` +
      `UA:  ${navigator.userAgent}\n` +
      `--- Error ---\n${stack}\n` +
      (componentStack ? `--- Component stack ---\n${componentStack}\n` : '') +
      (globalErrors.length ? `\n--- Also caught globally ---\n` +
        globalErrors.map(g => `[${new Date(g.at).toLocaleTimeString()}] ${g.source}\n${g.msg}`).join('\n\n')
        : '');

    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0F172A', color: '#F9FAFB',
        display: 'flex', flexDirection: 'column', padding: 24,
        overflow: 'auto', zIndex: 999999, fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{
          maxWidth: 900, margin: '0 auto', width: '100%',
          background: '#111827', border: '1px solid #DC2626', borderRadius: 10,
          padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 20, background: '#DC262622',
              border: '1px solid #DC2626', color: '#FCA5A5',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}>⚠</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>NetMap упал</div>
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>
                Приложение поймало ошибку рендера. Скопируйте отчёт и пришлите разработчику.
              </div>
            </div>
          </div>

          <div style={{
            background: '#0B1220', border: '1px solid #1F2937', borderRadius: 6,
            padding: 12, fontFamily: 'ui-monospace, monospace', fontSize: 12,
            color: '#F87171', maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {stack}
          </div>

          {componentStack && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#9CA3AF' }}>
                Component stack
              </summary>
              <div style={{
                marginTop: 8, background: '#0B1220', border: '1px solid #1F2937',
                borderRadius: 6, padding: 12, fontFamily: 'ui-monospace, monospace',
                fontSize: 11, color: '#93C5FD', maxHeight: 200, overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}>
                {componentStack}
              </div>
            </details>
          )}

          {globalErrors.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#9CA3AF' }}>
                Также поймано глобально ({globalErrors.length})
              </summary>
              <div style={{
                marginTop: 8, background: '#0B1220', border: '1px solid #1F2937',
                borderRadius: 6, padding: 12, fontFamily: 'ui-monospace, monospace',
                fontSize: 11, color: '#FBBF24', maxHeight: 200, overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}>
                {globalErrors.map(g => `[${new Date(g.at).toLocaleTimeString()}] ${g.source}\n${g.msg}`).join('\n\n')}
              </div>
            </details>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button id="netmap-copy-error-btn" onClick={() => this.copyReport(report)}
              style={{
                background: '#2563EB', color: '#fff', border: 'none',
                padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
              }}>Скопировать отчёт</button>
            <button onClick={this.recover}
              style={{
                background: 'transparent', color: '#F9FAFB', border: '1px solid #4B5563',
                padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
              }}>Попробовать восстановить</button>
            <button onClick={this.reload}
              style={{
                background: 'transparent', color: '#F9FAFB', border: '1px solid #4B5563',
                padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
              }}>Перезагрузить</button>
          </div>
        </div>
      </div>
    );
  }
}

const bannerStyle: React.CSSProperties = {
  position: 'fixed', bottom: 12, left: 12, right: 12, maxWidth: 720,
  margin: '0 auto', zIndex: 100000,
  background: '#7F1D1D', color: '#FEF2F2', borderRadius: 8, padding: 10,
  fontSize: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
  border: '1px solid #DC2626',
};
const bannerBtn: React.CSSProperties = {
  background: 'transparent', color: '#FEF2F2', border: '1px solid #FCA5A5',
  padding: '2px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
};
