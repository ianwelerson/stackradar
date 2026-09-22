import type { Company, RemotePolicy, VerificationState } from '@/types/company';
import { ANYWHERE } from '@/types/filters';

/** Days past `lastVerified` after which data is shown as stale. */
export const STALE_AFTER_DAYS = 14;

export function verificationState(
  company: Company,
  staleAfterDays: number = STALE_AFTER_DAYS,
  now: Date = new Date(),
): VerificationState {
  if (company.lastVerified === null) return 'unverified';
  const parsed = Date.parse(company.lastVerified);
  if (Number.isNaN(parsed)) return 'unverified';
  const days = Math.floor((now.getTime() - parsed) / 86_400_000);
  return days <= staleAfterDays ? 'fresh' : 'stale';
}

export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (iso === null) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed) / 86_400_000));
}

export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

export function verificationLabel(company: Company, now: Date = new Date()): string {
  const state = verificationState(company, STALE_AFTER_DAYS, now);
  if (state === 'unverified') return 'not yet verified';
  const days = daysSince(company.lastVerified, now) ?? 0;
  return state === 'fresh'
    ? `verified ${relativeDays(days)}`
    : `stale · last checked ${relativeDays(days)}`;
}

/** Display string for team size, honest about what is unknown. */
export function sizeLabel(company: Company): string {
  if (company.sizeRange !== null && company.sizeRange.trim() !== '') {
    return company.sizeRange;
  }
  if (company.sizeMin !== null && company.sizeMax !== null) {
    return company.sizeMin === company.sizeMax
      ? `${company.sizeMin}`
      : `${company.sizeMin}–${company.sizeMax}`;
  }
  if (company.sizeMin !== null) return `${company.sizeMin}+`;
  return 'Unknown';
}

export function remotePolicyLabel(policy: RemotePolicy | null): string {
  switch (policy) {
    case 'remote':
      return 'Remote';
    case 'hybrid':
      return 'Hybrid';
    case 'onsite':
      return 'On-site';
    default:
      return 'Unknown';
  }
}

export function remoteLabel(company: Company): string {
  return remotePolicyLabel(company.remotePolicy);
}

/**
 * How a chosen location reads on a chip or a button.
 *
 * Every entry but one is a country and reads as itself. ANYWHERE is stored as
 * the same token postings are parsed into, `worldwide`, which is the right word
 * for what the *employer* said and the wrong one for what the *reader* asked:
 * they said they can work from anywhere.
 */
export function locationLabel(value: string): string {
  return value === ANYWHERE ? 'Anywhere' : value;
}

/**
 * The per-company cap the update script applies when storing postings, mirrored
 * from `positions.maxPerCompany` in research.config.json. Kept in step by
 * scripts/validate-data.mjs, which fails the build if the two drift apart.
 */
export const POSITION_CAP = 60;

/**
 * True when a company's board held more roles than we stored.
 *
 * `openingsTotal > currentOpenings.length` is NOT enough on its own, and that
 * distinction matters: for most companies the gap is duplicate titles being
 * collapsed — Resend's board lists the same six roles across nine city-specific
 * postings — and there the stored count is the honest number of distinct roles.
 * Only a list that actually ran into the cap is truncated.
 */
export function isTruncated(company: Company): boolean {
  return (
    company.openingsTotal !== null &&
    company.openingsTotal > company.currentOpenings.length &&
    company.currentOpenings.length >= POSITION_CAP
  );
}

export function openingsLabel(count: number, truncated = false): string {
  if (count === 0) return 'no roles listed';
  if (truncated) return `${count}+ roles open`;
  return count === 1 ? '1 role open' : `${count} roles open`;
}

/** Stable hue per company id, so tiles are colourful but deterministic. */
export function hueFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

export function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}
