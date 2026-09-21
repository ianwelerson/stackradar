import { EMPTY_PROFILE, type Profile } from './profile.js';

export const STATUSES = [
  'Tracked',
  'Applied',
  'Waiting response',
  'Interviewing',
  'Offer',
  'Not hired',
] as const;

export type Status = (typeof STATUSES)[number];

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export const STATUS_ICONS: Record<Status, string> = {
  Tracked: '◇',
  Applied: '↗',
  'Waiting response': '◷',
  Interviewing: '◑',
  Offer: '★',
  'Not hired': '✕',
};

export const STATUS_TOKENS: Record<Status, { bg: string; fg: string; border: string }> = {
  Tracked: {
    bg: 'var(--color-status-tracked-bg)',
    fg: 'var(--color-status-tracked-text)',
    border: 'var(--color-status-tracked-line)',
  },
  Applied: {
    bg: 'var(--color-status-applied-bg)',
    fg: 'var(--color-status-applied-text)',
    border: 'var(--color-status-applied-line)',
  },
  'Waiting response': {
    bg: 'var(--color-status-waiting-bg)',
    fg: 'var(--color-status-waiting-text)',
    border: 'var(--color-status-waiting-line)',
  },
  Interviewing: {
    bg: 'var(--color-status-interviewing-bg)',
    fg: 'var(--color-status-interviewing-text)',
    border: 'var(--color-status-interviewing-line)',
  },
  Offer: {
    bg: 'var(--color-status-offer-bg)',
    fg: 'var(--color-status-offer-text)',
    border: 'var(--color-status-offer-line)',
  },
  'Not hired': {
    bg: 'var(--color-status-rejected-bg)',
    fg: 'var(--color-status-rejected-text)',
    border: 'var(--color-status-rejected-line)',
  },
};

/**
 * Everything personal, persisted locally and optionally synced.
 *
 * The saved profile lives here rather than in its own store so it inherits the
 * behaviour already built and tested for tracking: written to localStorage
 * first so it survives without a database, debounced into Upstash when one is
 * connected, and reconciled on load. One person's data, one record.
 */
export interface TrackingState {
  readonly statuses: Readonly<Record<string, Status>>;
  readonly notes: Readonly<Record<string, string>>;
  readonly profile: Profile;
}

export const EMPTY_TRACKING: TrackingState = {
  statuses: {},
  notes: {},
  profile: EMPTY_PROFILE,
};

/** Notes are capped so a runaway paste cannot fill the user's database. */
export const MAX_NOTE_LENGTH = 4000;
