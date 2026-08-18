/**
 * Simple in-app modal system that replaces window.prompt/confirm/alert,
 * which don't work reliably in Electron with contextIsolation.
 *
 * Usage from anywhere:
 *   const name = await promptText('Новое имя:', currentName);
 *   const ok   = await confirmDialog('Удалить N устройств?');
 *   await alertDialog('Готово');
 */

import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// -----------------------------------------------------------------------------
// Public API — imperative helpers backed by a single mounted root

interface DialogSpec {
  kind: 'prompt' | 'confirm' | 'alert';
  title: string;
  message?: string;
  defaultValue?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  resolve: (value: any) => void;
}

let dialogRoot: Root | null = null;
let renderQueue: DialogSpec[] = [];
let setState: ((spec: DialogSpec | null) => void) | null = null;

function ensureRoot() {
  if (dialogRoot) return;
  const el = document.createElement('div');
  el.id = 'netmap-modal-root';
  document.body.appendChild(el);
  dialogRoot = createRoot(el);
  dialogRoot.render(<ModalHost onReady={(s) => { setState = s; drainQueue(); }} />);
}

function drainQueue() {
  if (!setState) return;
  const next = renderQueue.shift();
  if (next) setState(next);
}

function enqueue(spec: Omit<DialogSpec, 'resolve'>): Promise<any> {
  ensureRoot();
  return new Promise((resolve) => {
    const full: DialogSpec = { ...spec, resolve };
    if (setState) setState(full);
    else renderQueue.push(full);
  });
}

export function promptText(title: string, defaultValue = '', message?: string): Promise<string | null> {
  return enqueue({ kind: 'prompt', title, defaultValue, message });
}
export function confirmDialog(title: string, message?: string, opts?: { danger?: boolean; okText?: string; cancelText?: string }): Promise<boolean> {
  return enqueue({ kind: 'confirm', title, message, danger: opts?.danger, okText: opts?.okText, cancelText: opts?.cancelText });
}
export function alertDialog(title: string, message?: string): Promise<void> {
  return enqueue({ kind: 'alert', title, message });
}

// -----------------------------------------------------------------------------
// UI

function ModalHost({ onReady }: { onReady: (setSpec: (spec: DialogSpec | null) => void) => void }) {
  const [spec, setSpec] = useState<DialogSpec | null>(null);
  useEffect(() => { onReady(setSpec); }, [onReady]);
  if (!spec) return null;
  return (
    <ModalCard
      spec={spec}
      onClose={(value) => {
        spec.resolve(value);
        setSpec(null);
        // Show next queued dialog on the next tick
        setTimeout(drainQueue, 0);
      }}
    />
  );
}

function ModalCard({ spec, onClose }: { spec: DialogSpec; onClose: (value: any) => void }) {
  const [value, setValue] = useState(spec.defaultValue ?? '');

  const submit = () => {
    if (spec.kind === 'prompt') onClose(value);
    else if (spec.kind === 'confirm') onClose(true);
    else onClose(undefined);
  };
  const cancel = () => {
    if (spec.kind === 'prompt') onClose(null);
    else if (spec.kind === 'confirm') onClose(false);
    else onClose(undefined);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter' && spec.kind !== 'prompt') { e.preventDefault(); submit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, value]);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100000,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: '#F9FAFB',
          border: '1px solid #D1D5DB',
          borderRadius: 10,
          minWidth: 360, maxWidth: 500,
          boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          color: '#111827',
          padding: 20,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>{spec.title}</div>
        {spec.message && (
          <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>{spec.message}</div>
        )}
        {spec.kind === 'prompt' && (
          <input
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            style={{
              background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827',
              padding: '8px 10px', borderRadius: 6, fontSize: 13, outline: 'none',
            }}
          />
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          {spec.kind !== 'alert' && (
            <button
              onClick={cancel}
              style={{
                background: '#E5E7EB', border: '1px solid #D1D5DB', color: '#111827',
                padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
              }}
            >{spec.cancelText || 'Отмена'}</button>
          )}
          <button
            onClick={submit}
            autoFocus={spec.kind !== 'prompt'}
            style={{
              background: spec.danger ? '#FCA5A5' : '#059669',
              border: `1px solid ${spec.danger ? '#f87171' : '#10B981'}`,
              color: '#fff',
              padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
              fontWeight: 500,
            }}
          >{spec.okText || 'OK'}</button>
        </div>
      </div>
    </div>
  );
}
