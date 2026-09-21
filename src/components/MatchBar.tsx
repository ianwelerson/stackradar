import type { ScoreResult } from '@/lib/scoring';

/**
 * The relevance meter, in one place.
 *
 * It was previously inlined in the company card; roles and the company page
 * show the same number now, and three copies of a scoring readout is three
 * chances for them to disagree about what a percentage means.
 *
 * The reasons ride along as a tooltip on purpose. A bare "68% match" invites
 * the reader to wonder what it is counting; "go — in this role's stack" is the
 * whole justification, and it costs nothing to carry.
 */
export function MatchBar({
  match,
  className = '',
}: {
  readonly match: ScoreResult;
  readonly className?: string;
}) {
  return (
    <span
      className={`flex items-center gap-[7px] ${className}`}
      title={match.reasons.join(' · ')}
    >
      <span className="w-[42px] h-[4px] rounded-[2px] bg-line-strong overflow-hidden block flex-none">
        <span className="block h-[4px] bg-accent" style={{ width: `${match.score}%` }} />
      </span>
      <span className="text-accent whitespace-nowrap">{match.score}% match</span>
    </span>
  );
}
