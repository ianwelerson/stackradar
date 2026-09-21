import { Link } from 'react-router-dom';
import type { Company } from '@/types/company';
import type { ScoreResult } from '@/lib/scoring';
import { CompanyTile } from './CompanyTile';
import { Badge, Tag } from './Badge';
import { MatchBar } from './MatchBar';
import { isTruncated, openingsLabel, remoteLabel } from '@/lib/format';
import { STATUS_ICONS, STATUS_TOKENS, type Status } from '@/types/tracking';

interface Props {
  readonly company: Company;
  readonly match: ScoreResult | null;
  readonly status: Status | undefined;
  readonly queryTokens: readonly string[];
}

const REMOTE_DOTS = {
  remote: 'var(--color-dot-remote)',
  hybrid: 'var(--color-dot-hybrid)',
  onsite: 'var(--color-dot-onsite)',
} as const;

export function CompanyCard({ company, match, status, queryTokens }: Props) {
  const openCount = company.currentOpenings.length;
  const hasOpenings = openCount > 0;
  const truncated = isTruncated(company);
  const dot =
    company.remotePolicy !== null
      ? REMOTE_DOTS[company.remotePolicy]
      : 'var(--color-dot-unknown)';

  return (
    <Link
      to={`/company/${company.id}`}
      className="group h-full bg-card border border-line-card rounded-[11px] px-4 pt-[15px] pb-[13px] flex flex-col gap-[11px] no-underline text-ink animate-[sp-in_.28s_ease_both] hover:border-accent-line-hover hover:bg-card-hover transition-colors"
    >
      <div className="flex items-start gap-[11px]">
        <CompanyTile
          id={company.id}
          name={company.name}
          logoUrl={company.logoUrl}
          size="md"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[14.5px] tracking-[-0.005em]">
              {company.name}
            </span>
            <Badge
              bg={hasOpenings ? 'var(--color-accent-surface)' : 'var(--color-control)'}
              fg={hasOpenings ? 'var(--color-accent-text)' : 'var(--color-ink-faint)'}
              border={hasOpenings ? 'var(--color-accent-line)' : 'var(--color-line-strong)'}
            >
              {openingsLabel(openCount, truncated)}
            </Badge>
            {status !== undefined && (
              <Badge
                bg={STATUS_TOKENS[status].bg}
                fg={STATUS_TOKENS[status].fg}
                border={STATUS_TOKENS[status].border}
              >
                {STATUS_ICONS[status]} {status}
              </Badge>
            )}
          </div>
          {/* Clamped so one wordy description cannot push this card's tags out
              of view — and, because grid rows stretch to their tallest cell,
              cannot stretch every other card in the row along with it. */}
          <p className="text-ink-dim text-[12.5px] mt-[3px] text-pretty m-0 line-clamp-2">
            {company.description}
          </p>
        </div>
      </div>

      {company.keywords.length > 0 && (
        <div className="flex gap-[5px] flex-wrap">
          {company.keywords.slice(0, 5).map((keyword) => (
            <Tag
              key={keyword}
              label={keyword}
              highlighted={queryTokens.some((token) => keyword.toLowerCase().includes(token))}
            />
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-[10px] flex-wrap pt-[10px] border-t border-line-soft text-[11.5px] text-ink-dimmer font-mono">
        <span className="flex items-center gap-[6px]">
          <span className="w-[6px] h-[6px] rounded-full flex-none" style={{ background: dot }} />
          {remoteLabel(company)}
        </span>
        <span className="text-ink-separator">·</span>
        <span className={company.country === null ? 'text-ink-fainter' : undefined}>
          {company.country ?? 'location unknown'}
        </span>
        {match !== null && <MatchBar match={match} className="ml-auto" />}
      </div>
    </Link>
  );
}
