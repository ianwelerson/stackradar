import type { Company } from '@/types/company';
import { verificationState, verificationLabel } from '@/lib/format';
import { Badge } from './Badge';

const STYLES = {
  fresh: {
    bg: 'var(--color-fresh-surface)',
    fg: 'var(--color-fresh-text)',
    border: 'var(--color-fresh-line)',
    title: 'Checked against the company’s own careers page.',
  },
  stale: {
    bg: 'var(--color-stale-surface)',
    fg: 'var(--color-stale-text)',
    border: 'var(--color-stale-line)',
    title: 'This record has not been re-checked recently and may be out of date.',
  },
  unverified: {
    bg: 'var(--color-unverified-surface)',
    fg: 'var(--color-unverified-text)',
    border: 'var(--color-unverified-line)',
    title:
      'Sourced from research but never confirmed against the company’s own careers page.',
  },
} as const;

/**
 * Three states, not the prototype's two: a large share of the dataset has never
 * been verified against a primary source, and the spec requires the UI to show
 * that rather than imply a check that never happened.
 */
export function VerificationBadge({ company }: { readonly company: Company }) {
  const state = verificationState(company);
  const style = STYLES[state];
  return (
    <Badge bg={style.bg} fg={style.fg} border={style.border} title={style.title}>
      {verificationLabel(company)}
    </Badge>
  );
}
