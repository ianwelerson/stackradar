import { parseTracking } from '@/hooks/useTracking';
import type { TrackingState } from '@/types/tracking';
import { isProfileEmpty } from '@/types/profile';

/**
 * Moving what you have saved between browsers, or keeping a copy of it.
 *
 * The file is the stored record itself — the same `{ statuses, notes, profile }`
 * object written to localStorage and to a connected database — with two extra
 * top-level keys saying what it is and when it was taken. Those are ignored on
 * the way back in, so a file exported today, or the raw JSON copied out of
 * your own Redis, both import.
 *
 * An import is validated by `parseTracking`, the same parser that reads local
 * storage and the database. It is untrusted input exactly as those are: a file
 * someone hands you, or one edited by hand, gets the same checks.
 */

/** Well above any real backup — thousands of notes at the note cap — and far
 *  below anything that would stall the tab while it parses. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const BACKUP_APP = 'stack-radar';

export interface ImportSummary {
  readonly tracked: number;
  readonly notes: number;
  readonly hasProfile: boolean;
}

/** Serialise the current state for download. */
export function toBackupJson(state: TrackingState): string {
  return `${JSON.stringify(
    {
      app: BACKUP_APP,
      exportedAt: new Date().toISOString(),
      statuses: state.statuses,
      notes: state.notes,
      profile: state.profile,
    },
    null,
    2,
  )}\n`;
}

/**
 * Hand the reader a file. Built from a Blob URL rather than a data: URI so a
 * large backup is not inlined into the DOM, and revoked straight after so the
 * object URL does not outlive the click.
 */
export function downloadBackup(state: TrackingState): void {
  const blob = new Blob([toBackupJson(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `stack-radar-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Deferred a tick: revoking synchronously can cancel the download in some
  // engines before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export class BackupError extends Error {}

/**
 * Read and validate a file the reader picked. Throws a BackupError with a
 * message fit to show them; never returns a state it could not vouch for.
 */
export async function readBackup(file: File): Promise<{
  state: TrackingState;
  summary: ImportSummary;
}> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new BackupError('That file is too large to be a Stack Radar backup.');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new BackupError('That file is not valid JSON.');
  }

  let markedOurs = false;
  if (typeof raw === 'object' && raw !== null) {
    const app = (raw as Record<string, unknown>)['app'];
    // Tolerated when absent — a raw copy from your own database has no marker —
    // but a file that says it belongs to something else is not ours to guess at.
    if (app !== undefined && app !== BACKUP_APP) {
      throw new BackupError('That file was not exported from Stack Radar.');
    }
    markedOurs = app === BACKUP_APP;
  }

  const state = parseTracking(raw);
  if (state === null) {
    throw new BackupError('That file does not contain any Stack Radar data.');
  }

  const tracked = Object.keys(state.statuses).length;
  const notes = Object.keys(state.notes).length;
  const hasProfile = !isProfileEmpty(state.profile);

  // The parser is lenient by design — unknown keys are ignored — so arbitrary
  // JSON parses to an empty state. Whether that is "your backup is empty" or
  // "this isn't a backup" depends on whether the file said it was one.
  if (tracked === 0 && notes === 0 && !hasProfile) {
    throw new BackupError(
      markedOurs
        ? 'That backup is valid, but there is nothing in it to import.'
        : 'That file does not contain any Stack Radar data.',
    );
  }

  return { state, summary: { tracked, notes, hasProfile } };
}
