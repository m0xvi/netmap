import { useMemo, useState, useEffect } from 'react';
import { useStore } from './store';
import { StickyNoteCard } from './StickyNote';

/**
 * Renders the stack of sticky notes for a device.
 * Notes are added via the right-click context menu on the device.
 */
export function StickyStack({ deviceId }: { deviceId: string }) {
  const stickies = useStore(s => s.doc.stickies);
  const [freshId, setFreshId] = useState<string | null>(null);

  const notes = useMemo(
    () => (stickies || []).filter(n => n.deviceId === deviceId).sort((a, b) => a.createdAt - b.createdAt),
    [stickies, deviceId]
  );

  // Listen for a "sticky just added" event so we can trigger the pop-animation
  useEffect(() => {
    const onAdded = (e: Event) => {
      const detail = (e as CustomEvent).detail as { deviceId: string; id: string };
      if (detail?.deviceId === deviceId) setFreshId(detail.id);
    };
    window.addEventListener('netmap:sticky-added', onAdded);
    return () => window.removeEventListener('netmap:sticky-added', onAdded);
  }, [deviceId]);

  if (notes.length === 0) return null;

  return (
    <div style={{ position: 'absolute', top: -22, left: -14, pointerEvents: 'none' }}>
      {notes.map((n, i) => {
        // Custom user-set offset OR default stack position (each note peeks a bit)
        const ox = n.offsetX ?? (-40 + i * 8);
        const oy = n.offsetY ?? (-90 + i * 6);
        return (
          <div key={n.id} style={{ pointerEvents: 'auto' }}>
            <StickyNoteCard
              note={n}
              offsetX={ox}
              offsetY={oy}
              isTop={i === notes.length - 1}
              isNew={n.id === freshId}
              onDoneAnim={() => setFreshId(null)}
            />
          </div>
        );
      })}
    </div>
  );
}
