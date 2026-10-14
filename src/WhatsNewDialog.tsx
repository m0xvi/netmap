/**
 * v0.90.0 — окно «Что нового».
 *
 * Открывается автоматически один раз после обновления (версия в localStorage
 * не совпадает с текущей) и вручную через «Справка → Что нового в этой версии…»
 * (событие `netmap:open-whats-new`).
 *
 * Новая установка (онбординг ещё не пройден) не показывает окно: там онбординг.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { DialogShell, DlgBtn } from './DialogTheme';
import { whatsNewFor } from './whatsNew';
import { hasCompletedOnboarding } from './OnboardingDialog';

const SEEN_KEY = 'netmap.whatsNew.seenVersion';

function readSeen(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}
function writeSeen(v: string) {
  try { localStorage.setItem(SEEN_KEY, v); } catch { /* приватный режим — не критично */ }
}

export function WhatsNewHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const version = __APP_VERSION__;
    const seen = readSeen();
    if (seen === version) return;
    if (seen === null && !hasCompletedOnboarding()) {
      // Новая установка: онбординг сам всё объяснит. Запоминаем версию без показа.
      writeSeen(version);
      return;
    }
    // Обновление (или первый показ у существующего пользователя): после загрузки интерфейса.
    const t = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('netmap:open-whats-new', onOpen);
    return () => window.removeEventListener('netmap:open-whats-new', onOpen);
  }, []);

  if (!open) return null;
  return <WhatsNewDialog onClose={() => { writeSeen(__APP_VERSION__); setOpen(false); }} />;
}

function WhatsNewDialog({ onClose }: { onClose: () => void }) {
  const release = whatsNewFor(__APP_VERSION__);
  const footer = (
    <div style={{ display: 'flex', width: '100%', justifyContent: 'flex-end' }}>
      <DlgBtn kind="primary" onClick={onClose}>Понятно</DlgBtn>
    </div>
  );
  return (
    <DialogShell
      title={`Что нового в v${__APP_VERSION__}`}
      subtitle="Что появилось и где это найти"
      icon="bell"
      onClose={onClose}
      width={680}
      footer={footer}
    >
      <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {release.items.map((it, i) => (
          <div key={i} style={card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>{it.title}</div>
            <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>{it.text}</div>
            <div style={whereRow}>
              <span style={whereLabel}>Где найти</span>
              <span style={whereText}>{it.where}</span>
            </div>
          </div>
        ))}
      </div>
    </DialogShell>
  );
}

const card: CSSProperties = {
  border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 12px', background: '#fff',
};
const whereRow: CSSProperties = { display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 8, flexWrap: 'wrap' };
const whereLabel: CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#1D4ED8', background: '#EFF6FF', borderRadius: 5,
  padding: '2px 6px', textTransform: 'uppercase', letterSpacing: .3, flexShrink: 0,
};
const whereText: CSSProperties = { fontSize: 12, color: '#1E3A8A', fontWeight: 600 };
