/**
 * v0.74.0 — «Аудит сканирования хабов» (меню Вид).
 *
 * Отвечает на вопросы пользователя: «по каким свитчам/роутерам реально
 * проводилось SNMP/SSH-сканирование» и «какие устройства по данным скана
 * должны быть подключены к каждому хабу». Большинство устройств приходит
 * из DHCP (связи предположительные — звезда от шлюза); скан свитча даёт
 * честный FDB, и аудит предлагает пересадить оконечные на свои хабы.
 *
 * Источник истины — doc.scanMeta (пишется discovery при применении
 * результатов). На старых файлах без scanMeta отчёт честно говорит, что
 * следов сканирования нет, и предлагает запустить сканирование.
 */

import { useMemo } from 'react';
import { useStore } from './store';
import { DialogShell, DlgBtn, DlgSection } from './DialogTheme';
import { auditHubs, planAuditFixes, type AuditHubRow } from './topoAudit';
import { KIND_META } from './icons';

const VIA_LABEL: Record<string, string> = {
  snmp: 'SNMP', ssh: 'SSH', both: 'SNMP+SSH',
};

export function AuditHubsDialog({ onClose }: { onClose: () => void }) {
  const doc = useStore(s => s.doc);
  const applyAuditFixes = useStore(s => s.applyAuditFixes);

  const rows = useMemo(() => auditHubs(doc), [doc]);
  const fixes = useMemo(() => planAuditFixes(doc), [doc]);
  const hasMeta = (doc.scanMeta || []).length > 0;

  const scanned = rows.filter(r => r.meta);
  const notScanned = rows.filter(r => !r.meta);
  const totalMissing = rows.reduce((a, r) => a + r.missing.length, 0);

  return (
    <DialogShell
      title="Аудит сканирования хабов"
      subtitle="Кто из свитчей/роутеров просканирован по SNMP/SSH и что по FDB должно быть к ним подключено"
      chips={[
        `хабов: ${rows.length}`,
        `просканировано: ${scanned.length}`,
        `не просканировано: ${notScanned.length}`,
        `по FDB не подключено: ${totalMissing}`,
      ]}
      icon="search"
      onClose={onClose}
      width={760}
      footer={
        <>
          <span style={{ fontSize: 12, color: '#64748B' }}>
            {fixes.length > 0
              ? `Готово к применению правок: ${fixes.length} (откат — Ctrl+Z)`
              : 'Правок нет'}
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
            <DlgBtn onClick={onClose}>Закрыть</DlgBtn>
            <DlgBtn
              kind="primary"
              disabled={fixes.length === 0}
              onClick={() => { const n = applyAuditFixes(); if (n > 0) onClose(); }}
            >
              Подключить по FDB ({fixes.length})
            </DlgBtn>
          </span>
        </>
      }
    >
      {!hasMeta && (
        <div style={{
          margin: '0 0 14px', padding: '10px 14px', borderRadius: 10,
          background: '#FFFBEB', border: '1px solid #F59E0B', color: '#92400E',
          fontSize: 13, lineHeight: 1.5,
        }}>
          В этом файле нет следов сканирования (doc.scanMeta) — он сохранён
          версией до 0.74 или сканирование не применялось. Запустите
          «Сканирование» и примените результаты: следы SNMP/SSH-прохода
          сохранятся, и отчёт станет точным.
        </div>
      )}

      <DlgSection title={`Просканированные хабы (${scanned.length})`}>
        {scanned.length === 0 && <EmptyRow text="Нет хабов со следами сканирования" />}
        {scanned.map(r => <HubRow key={r.hub.id} row={r} />)}
      </DlgSection>

      <DlgSection title={`Без следов сканирования (${notScanned.length})`}>
        {notScanned.length === 0 && <EmptyRow text="Все хабы просканированы" />}
        {notScanned.map(r => <HubRow key={r.hub.id} row={r} />)}
      </DlgSection>
    </DialogShell>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div style={{ padding: '8px 4px', fontSize: 12.5, color: '#94A3B8' }}>{text}</div>;
}

function HubRow({ row }: { row: AuditHubRow }) {
  const meta = KIND_META[row.hub.kind as keyof typeof KIND_META];
  const viaTxt = row.via ? VIA_LABEL[row.via] : 'нет данных';
  const viaColor = row.via ? '#16A34A' : '#B45309';
  const viaBg = row.via ? '#F0FDF4' : '#FFFBEB';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '8px 10px', borderRadius: 10, border: '1px solid #E2E8F0',
      marginBottom: 6, background: '#fff',
    }}>
      <span style={{
        minWidth: 74, textAlign: 'center', padding: '2px 8px', borderRadius: 999,
        background: viaBg, color: viaColor, fontWeight: 800, fontSize: 11,
        border: `1px solid ${viaColor}35`,
      }}>
        {viaTxt}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: meta?.color || '#111827' }}>
          {row.hub.name}
          {row.meta?.host ? <span style={{ color: '#94A3B8', fontWeight: 500 }}> · {row.meta.host}</span> : null}
        </div>
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
          подключено сейчас: <b>{row.connectedNow}</b>
          {row.fromDhcp > 0 && <> · из DHCP: <b>{row.fromDhcp}</b></>}
          {row.meta && <> · по FDB должно быть: <b>{row.expectedByFdb.length}</b></>}
        </div>
        {row.missing.length > 0 && (
          <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 2 }}>
            не подключено к нему: <b>{row.missing.length}</b>
            {row.misplaced.length > 0 && <> (из них на другом хабе: {row.misplaced.length})</>}
            <span style={{ color: '#94A3B8' }}> — {row.missing.slice(0, 5).map(d => d.name).join(', ')}{row.missing.length > 5 ? '…' : ''}</span>
          </div>
        )}
        {row.meta && row.missing.length === 0 && (
          <div style={{ fontSize: 12, color: '#16A34A', marginTop: 2 }}>
            все устройства из FDB подключены
          </div>
        )}
      </div>
    </div>
  );
}
