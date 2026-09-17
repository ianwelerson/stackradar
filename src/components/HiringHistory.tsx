import { useState } from 'react';
import type { Company, HistoryEntry } from '@/types/company';

interface Props {
  readonly company: Company;
}

interface HoverState {
  readonly index: number;
  readonly entry: HistoryEntry;
}

/**
 * Weekly open-role history.
 *
 * Empty is the normal state, not an error: history is an append-only scan log
 * and no synthetic past was fabricated for companies we had not yet tracked.
 * A company only accumulates bars once the update script has run against it.
 */
export function HiringHistory({ company }: Props) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const { history } = company;

  if (history.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-[10px] px-[15px] py-[14px]">
        <div className="flex items-center gap-[10px] mb-[10px]">
          <span className="w-[26px] h-[26px] rounded-[7px] border border-line-strong flex items-center justify-center font-mono text-[11px] text-ink-faint flex-none">
            ⌁
          </span>
          <div className="text-[13px] font-medium">No history tracked yet</div>
        </div>
        <p className="text-[12.5px] text-ink-dim leading-[1.55] text-pretty m-0">
          Hiring history is built up one weekly scan at a time, and this company hasn&rsquo;t
          been scanned yet. Nothing has been back-filled or estimated — once tracking starts,
          a bar appears here for each week.
        </p>
      </div>
    );
  }

  const max = Math.max(1, ...history.map((entry) => entry.openCount));
  const firstWeek = history[0];
  const peak = Math.max(...history.map((e) => e.openCount));
  const average =
    Math.round((history.reduce((sum, e) => sum + e.openCount, 0) / history.length) * 10) / 10;

  return (
    <div className="bg-surface border border-line rounded-[10px] px-[15px] pt-[14px] pb-3 relative">
      <p className="text-[12.5px] text-ink-muted mb-[14px] text-pretty m-0">
        {peak === 0
          ? `Nothing open across the ${history.length} week${history.length === 1 ? '' : 's'} tracked so far.`
          : `Peaked at ${peak} role${peak === 1 ? '' : 's'} open, averaging ${average} across ${history.length} tracked week${history.length === 1 ? '' : 's'}.`}
      </p>

      {hover !== null && (
        <div className="absolute bottom-[30px] right-[10px] bg-tooltip border border-line-tooltip rounded-[8px] px-[10px] py-2 z-[4] min-w-[140px] shadow-[0_8px_24px_oklch(0.10_0_0/0.5)] pointer-events-none">
          <div className="font-mono text-[10.5px] text-ink-dimmer">
            week of {hover.entry.weekOf}
          </div>
          <div className="text-[12.5px] mt-1 font-medium">
            {hover.entry.openCount === 0
              ? 'no roles open'
              : `${hover.entry.openCount} role${hover.entry.openCount === 1 ? '' : 's'} open`}
          </div>
          <div className="flex flex-col gap-[2px] mt-[6px]">
            {Object.entries(hover.entry.keywordCounts)
              .filter(([, count]) => count > 0)
              .slice(0, 4)
              .map(([keyword, count]) => (
                <div key={keyword} className="font-mono text-[11px] text-accent-text-soft">
                  {count}× {keyword}
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="flex items-end gap-[3px] h-[74px]">
        {history.map((entry, index) => (
          <button
            key={entry.weekOf}
            type="button"
            onMouseEnter={() => setHover({ index, entry })}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover({ index, entry })}
            onBlur={() => setHover(null)}
            aria-label={`Week of ${entry.weekOf}: ${entry.openCount} roles open`}
            className="flex-1 min-w-0 flex flex-col justify-end h-[74px] bg-transparent border-none p-0 cursor-default"
          >
            <span
              className="rounded-t-[3px] rounded-b-[1px] block"
              style={{
                height: `${Math.round(5 + 64 * (entry.openCount / max))}px`,
                background:
                  entry.openCount === 0
                    ? 'var(--color-line)'
                    : hover?.index === index
                      ? 'var(--color-accent-bright)'
                      : 'var(--color-accent-bar)',
              }}
            />
          </button>
        ))}
      </div>

      <div className="flex justify-between mt-2 font-mono text-[10.5px] text-ink-fainter">
        <span>{firstWeek?.weekOf ?? ''}</span>
        <span>now</span>
      </div>
    </div>
  );
}
