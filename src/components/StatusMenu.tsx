import { useEffect, useId, useRef } from 'react';
import { STATUSES, STATUS_ICONS, STATUS_TOKENS, type Status } from '@/types/tracking';

interface Props {
  readonly current: Status | undefined;
  readonly onSelect: (status: Status | null) => void;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
}

export function StatusMenu({ current, onSelect, open, onToggle, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Close on outside click or Escape — a menu, unlike a modal, stays in flow.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const isExplicit = current !== undefined && current !== 'Tracked';
  const tokens = isExplicit ? STATUS_TOKENS[current] : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="flex items-center gap-[7px] rounded-[8px] px-[13px] py-[9px] text-[12.5px] cursor-pointer whitespace-nowrap border transition-colors"
        style={
          tokens !== null
            ? { background: tokens.bg, borderColor: tokens.border, color: tokens.fg }
            : {
                background: 'var(--color-control)',
                borderColor: 'var(--color-line-control)',
                color: 'var(--color-ink-muted)',
              }
        }
      >
        <span className="text-[12px] opacity-90">
          {isExplicit ? STATUS_ICONS[current] : '○'}
        </span>
        {isExplicit ? current : 'Set status'}
        <span className="text-[9px] opacity-60 ml-px">▾</span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute top-[calc(100%+6px)] right-0 z-30 min-w-[206px] bg-elevated border border-line-raised rounded-[10px] p-[5px] shadow-[0_14px_40px_oklch(0.08_0_0/0.55)] animate-[sp-in_.16s_ease_both]"
        >
          <div className="font-mono text-[10px] text-ink-faint uppercase tracking-[0.07em] px-[9px] pt-[7px] pb-[5px]">
            Application status
          </div>
          {STATUSES.map((status) => {
            const active = current === status;
            const statusTokens = STATUS_TOKENS[status];
            return (
              <button
                key={status}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => onSelect(active ? null : status)}
                className="w-full flex items-center gap-[9px] border-none rounded-[7px] px-[9px] py-2 text-[12.5px] cursor-pointer text-left hover:bg-elevated-hover transition-colors"
                style={
                  active
                    ? { background: statusTokens.bg, color: statusTokens.fg }
                    : { background: 'transparent', color: 'var(--color-ink-muted)' }
                }
              >
                <span className="w-[14px] text-center opacity-95">{STATUS_ICONS[status]}</span>
                <span className="flex-1">{status}</span>
                {active && <span className="text-accent-link text-[11px]">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
