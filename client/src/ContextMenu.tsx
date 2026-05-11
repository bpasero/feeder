import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type MenuEntry =
  | {
      kind: 'item';
      label: string;
      icon?: ReactNode;
      onClick: () => void | Promise<void>;
      destructive?: boolean;
      disabled?: boolean;
    }
  | { kind: 'separator' };

type Props = {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
};

export function ContextMenu({ x, y, entries, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const pad = 8;
    const nextX = Math.min(x, window.innerWidth - r.width - pad);
    const nextY = Math.min(y, window.innerHeight - r.height - pad);
    setPos({ x: Math.max(pad, nextX), y: Math.max(pad, nextY) });
  }, [x, y, entries]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onScroll() {
      onClose();
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ top: pos.y, left: pos.x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        entry.kind === 'separator' ? (
          <div key={`s-${i}`} className="context-menu-separator" role="separator" />
        ) : (
          <button
            key={`i-${i}`}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            className={`context-menu-item${entry.destructive ? ' destructive' : ''}`}
            onClick={async () => {
              onClose();
              await entry.onClick();
            }}
          >
            <span className="context-menu-icon" aria-hidden="true">
              {entry.icon}
            </span>
            <span>{entry.label}</span>
          </button>
        )
      )}
    </div>
  );
}
