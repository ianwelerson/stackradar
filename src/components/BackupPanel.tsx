import { useRef, useState } from 'react';
import { useTracking } from '@/hooks/useTracking';
import { BackupError, downloadBackup, readBackup, type ImportSummary } from '@/lib/backup';
import type { TrackingState } from '@/types/tracking';

/**
 * Export and import of everything saved here.
 *
 * Import is two steps on purpose. The file is read and validated first, and
 * the reader is told exactly what it holds and what merging it will do; only
 * then does anything change. Merging someone's tracked list is not something to
 * do on the strength of which file happened to be selected.
 */
export function BackupPanel() {
  const { tracking, importData } = useTracking();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ state: TrackingState; summary: ImportSummary } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const trackedHere = Object.keys(tracking.statuses).length;
  const notesHere = Object.keys(tracking.notes).length;

  async function onFile(file: File | undefined) {
    setError(null);
    setDone(null);
    setPending(null);
    if (file === undefined) return;
    try {
      setPending(await readBackup(file));
    } catch (readError) {
      setError(
        readError instanceof BackupError ? readError.message : 'That file could not be read.',
      );
    } finally {
      // Cleared so choosing the same file again still fires a change event.
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  }

  function confirmImport() {
    if (pending === null) return;
    importData(pending.state);
    const { tracked, notes, hasProfile } = pending.summary;
    setDone(
      `Imported ${tracked} tracked ${tracked === 1 ? 'company' : 'companies'}, ${notes} ${
        notes === 1 ? 'note' : 'notes'
      }${hasProfile ? ' and your profile' : ''}.`,
    );
    setPending(null);
  }

  return (
    <div className="bg-surface border border-line rounded-[10px] px-[15px] py-[14px] flex flex-col gap-[11px]">
      <p className="text-[12.5px] text-ink-dim leading-[1.55] text-pretty m-0">
        A copy of your profile, tracked companies and notes as one JSON file — the same record
        this browser stores and your database syncs. Use it to move to another browser, or just
        to keep a copy.
      </p>

      <div className="flex gap-2 flex-wrap items-center">
        <button
          type="button"
          onClick={() => downloadBackup(tracking)}
          className="bg-control border border-line-control text-ink-soft rounded-[7px] px-[13px] py-[8px] text-[12.5px] cursor-pointer hover:border-accent-line-hover hover:text-ink transition-colors"
        >
          ↓ Export JSON
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="bg-control border border-line-control text-ink-soft rounded-[7px] px-[13px] py-[8px] text-[12.5px] cursor-pointer hover:border-accent-line-hover hover:text-ink transition-colors"
        >
          ↑ Import JSON
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Choose a Stack Radar backup to import"
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
        <span className="font-mono text-[11px] text-ink-fainter">
          {trackedHere} tracked · {notesHere} notes here now
        </span>
      </div>

      {error !== null && (
        <div role="alert" className="text-[12px] text-danger-bright font-mono">
          {error}
        </div>
      )}

      {done !== null && (
        <div role="status" className="text-[12px] text-accent-text font-mono">
          {done}
        </div>
      )}

      {pending !== null && (
        <div className="border-l-2 border-accent-line bg-surface-alt rounded-r-[8px] px-[14px] py-[11px] flex flex-col gap-[10px]">
          <p className="text-[12.5px] text-ink-muted leading-[1.55] text-pretty m-0">
            This file holds <strong className="text-ink-soft">{pending.summary.tracked}</strong>{' '}
            tracked {pending.summary.tracked === 1 ? 'company' : 'companies'},{' '}
            <strong className="text-ink-soft">{pending.summary.notes}</strong>{' '}
            {pending.summary.notes === 1 ? 'note' : 'notes'}
            {pending.summary.hasProfile ? ' and a profile' : ''}. Importing adds it to what is
            here: where both have a value for the same company, the file&rsquo;s wins, and
            nothing the file does not mention is removed.
            {pending.summary.hasProfile && ' Your current profile will be replaced by the one in the file.'}
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={confirmImport}
              className="bg-accent-surface border border-accent-line text-accent-text-bright rounded-[7px] px-[13px] py-[8px] text-[12.5px] cursor-pointer hover:bg-accent-surface-strong transition-colors"
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="bg-transparent border border-line-strong text-ink-muted rounded-[7px] px-[13px] py-[8px] text-[12.5px] cursor-pointer hover:text-ink-strong transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
