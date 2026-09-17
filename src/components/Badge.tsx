import type { ReactNode } from 'react';

interface BadgeProps {
  readonly children: ReactNode;
  readonly bg: string;
  readonly fg: string;
  readonly border: string;
  readonly title?: string;
}

/** Small mono pill used for role counts, statuses and verification. */
export function Badge({ children, bg, fg, border, title }: BadgeProps) {
  return (
    <span
      className="font-mono text-[10.5px] px-[6px] py-[2px] rounded-[5px] border whitespace-nowrap"
      style={{ background: bg, color: fg, borderColor: border }}
      {...(title !== undefined ? { title } : {})}
    >
      {children}
    </span>
  );
}

interface TagProps {
  readonly label: string;
  readonly highlighted?: boolean;
}

/** Keyword chip on a company card. */
export function Tag({ label, highlighted = false }: TagProps) {
  return (
    <span
      className={`font-mono text-[11px] px-[7px] py-[2.5px] rounded-[5px] border ${
        highlighted
          ? 'bg-accent-surface-strong text-accent-text border-accent-line-strong'
          : 'bg-chip text-ink-muted border-line-control'
      }`}
    >
      {label}
    </span>
  );
}
