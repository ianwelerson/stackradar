import type { CategorizedOpening } from '@/lib/categorize';
import { safeExternalUrl } from '@/lib/safe-url';
import { daysSince, relativeDays } from '@/lib/format';

interface Props {
  readonly openings: readonly CategorizedOpening[];
  readonly careersUrl: string | null;
  readonly variant?: 'panel' | 'modal';
}

function subtitle(opening: CategorizedOpening): string {
  const parts = [opening.category];
  if (opening.location !== null && opening.location.trim() !== '') {
    parts.push(opening.location);
  }
  const days = daysSince(opening.postedDate);
  parts.push(days !== null ? `posted ${relativeDays(days)}` : 'posting date unknown');
  return parts.join('  ·  ');
}

export function PositionsList({ openings, careersUrl, variant = 'panel' }: Props) {
  const fallback = safeExternalUrl(careersUrl);

  return (
    <div className="flex flex-col gap-px bg-line border border-line rounded-[10px] overflow-hidden">
      {openings.map((opening, index) => {
        const href = safeExternalUrl(opening.url) ?? fallback;
        const body = (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-medium text-ink-strong">{opening.title}</div>
              <div className="font-mono text-[11px] text-ink-dimmer mt-1">
                {subtitle(opening)}
              </div>
            </div>
            {href !== null && <span className="text-accent text-[13px]">↗</span>}
          </>
        );

        const className = `${
          variant === 'modal' ? 'bg-surface-alt' : 'bg-surface'
        } px-[15px] py-[13px] flex gap-3 items-center text-ink no-underline`;

        return href !== null ? (
          <a
            key={`${opening.title}-${index}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={`${className} hover:bg-row-hover transition-colors`}
          >
            {body}
          </a>
        ) : (
          <div key={`${opening.title}-${index}`} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

interface PillsProps {
  readonly categories: readonly string[];
  readonly active: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly onSelect: (category: string) => void;
}

export function CategoryPills({ categories, active, counts, onSelect }: PillsProps) {
  return (
    <div className="flex gap-[6px] flex-wrap">
      {categories.map((category) => {
        const on = category === active;
        return (
          <button
            key={category}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(category)}
            className={`font-mono text-[11px] px-[9px] py-[4px] rounded-[6px] cursor-pointer whitespace-nowrap border transition-colors ${
              on
                ? 'bg-accent-surface-active text-accent-text-bright border-accent-line-strong'
                : 'bg-control-alt text-ink-dim border-line-strong hover:border-accent-line-hover'
            }`}
          >
            {category} {counts[category] ?? 0}
          </button>
        );
      })}
    </div>
  );
}
