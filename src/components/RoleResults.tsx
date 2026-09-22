import { Link } from 'react-router-dom';
import type { ScoredRole } from '@/lib/roles';
import { CompanyTile } from './CompanyTile';
import { MatchBar } from './MatchBar';
import { Badge, Tag } from './Badge';
import { safeExternalUrl } from '@/lib/safe-url';
import { STATUS_ICONS, STATUS_TOKENS, type Status } from '@/types/tracking';

/**
 * Open roles as the unit of the result list.
 *
 * Cards in the same grid as the company view rather than full-width rows: a
 * role title is short, so a row across 1180px left most of the line empty and
 * pushed the match meter so far from the title that they read as unrelated.
 * Three columns put the title, its employer and its score in one glance.
 *
 * Each card offers two destinations and keeps them distinct: the title links
 * out to the posting, the company name links in to its page here. Conflating
 * them would mean a reader aiming for the job description lands on our page
 * instead, which is the small betrayal this directory exists to avoid.
 */
export function RoleResults({
  roles,
  statuses,
  queryTokens,
}: {
  readonly roles: readonly (ScoredRole & { readonly confirmed?: boolean })[];
  readonly statuses: Readonly<Record<string, Status>>;
  readonly queryTokens: readonly string[];
}) {
  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,335px),1fr))]">
      {roles.map(({ company, opening, match, confirmed = true }) => {
        const href = safeExternalUrl(opening.url);
        const status = statuses[company.id];

        return (
          <div
            key={`${company.id}-${opening.title}-${opening.url ?? ''}`}
            className="group h-full bg-card border border-line-card rounded-[11px] px-4 pt-[13px] pb-[12px] flex flex-col gap-[9px] animate-[sp-in_.28s_ease_both] hover:border-accent-line-hover hover:bg-card-hover transition-colors"
          >
            <div className="flex items-center gap-[9px] min-w-0">
              <CompanyTile id={company.id} name={company.name} logoUrl={company.logoUrl} size="sm" />
              <Link
                to={`/company/${company.id}`}
                className="font-mono text-[11.5px] text-ink-dim no-underline hover:text-ink truncate"
              >
                {company.name}
              </Link>
              {status !== undefined && (
                <Badge
                  bg={STATUS_TOKENS[status].bg}
                  fg={STATUS_TOKENS[status].fg}
                  border={STATUS_TOKENS[status].border}
                >
                  {STATUS_ICONS[status]}
                </Badge>
              )}
            </div>

            {href !== null ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[14px] font-medium text-ink-strong no-underline leading-[1.35] text-pretty hover:text-accent-link"
              >
                {opening.title} <span className="text-accent text-[12px]">↗</span>
              </a>
            ) : (
              <span
                className="text-[14px] font-medium text-ink-strong leading-[1.35] text-pretty"
                title="This role was recorded without its own link — open the company's careers page instead."
              >
                {opening.title}
              </span>
            )}

            {opening.detectedKeywords.length > 0 && (
              <div className="flex gap-[5px] flex-wrap">
                {opening.detectedKeywords.slice(0, 5).map((keyword) => (
                  <Tag
                    key={keyword}
                    label={keyword}
                    highlighted={queryTokens.some((token) => keyword.toLowerCase() === token)}
                  />
                ))}
              </div>
            )}

            {/* Pinned to the card's baseline so the meta line and score sit on
                one level across a row, however long the title above them ran. */}
            <div className="mt-auto flex items-center gap-[8px] flex-wrap pt-[9px] border-t border-line-soft text-[11px] text-ink-dimmer font-mono">
              <span className={opening.location === null ? 'text-ink-fainter' : undefined}>
                {opening.location ?? 'location not stated'}
              </span>
              {opening.postedDate !== null && (
                <>
                  <span className="text-ink-separator">·</span>
                  <span>{opening.postedDate}</span>
                </>
              )}
              {!confirmed && (
                <span
                  className="text-stale-text"
                  title="The posting does not say which countries it is open to, or does not state a work model. It is shown because your profile includes unconfirmed matches."
                >
                  · not confirmed
                </span>
              )}
              {match !== null && <MatchBar match={match} className="ml-auto" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
