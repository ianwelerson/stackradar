import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  EMPTY_TRACKING,
  isStatus,
  MAX_NOTE_LENGTH,
  type Status,
  type TrackingState,
} from '@/types/tracking';
import { isProfileEmpty, parseProfile, type Profile } from '@/types/profile';
import { readLocal, writeLocal, removeLocal } from '@/lib/local-storage';
import {
  deleteKey,
  maskCredentials,
  readJson,
  writeJson,
  UpstashError,
  type UpstashCredentials,
} from '@/lib/upstash';

export type SyncState = 'offline' | 'idle' | 'syncing' | 'saved' | 'error';

interface TrackingContextValue {
  readonly tracking: TrackingState;
  readonly credentials: UpstashCredentials | null;
  readonly connected: boolean;
  /**
   * Connected, but the last exchange with the database failed.
   *
   * Derived here rather than in each surface that shows connection state: the
   * header dot, the storage dialog and the profile page all used `connected`
   * alone, so a failing connection went on reporting itself as green and
   * "syncing" while the error was only visible next to whatever field the
   * reader had last touched. Telling someone their data is saved when it is not
   * is the worst thing this app could get wrong, so the three surfaces now read
   * one value instead of three copies of a rule.
   */
  readonly failing: boolean;
  readonly syncState: SyncState;
  readonly syncError: string | null;
  readonly maskedCredentials: string | null;
  readonly setStatus: (companyId: string, status: Status | null) => void;
  readonly setNote: (companyId: string, note: string) => void;
  readonly setProfile: (profile: Profile) => void;
  /** Re-attempt the last sync. The remedy for a transient failure should not be
   *  "delete your credentials and set them up again". */
  readonly retry: () => void;
  readonly connect: (creds: UpstashCredentials) => Promise<void>;
  readonly disconnect: () => void;
  readonly trackedIds: readonly string[];
}

const TrackingContext = createContext<TrackingContextValue | null>(null);

const REMOTE_KEY = ['tracking'] as const;
const SYNC_DEBOUNCE_MS = 800;

/** Parse persisted tracking data defensively — never trust stored shape. */
function parseTracking(raw: unknown): TrackingState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;

  const statuses: Record<string, Status> = {};
  if (typeof source['statuses'] === 'object' && source['statuses'] !== null) {
    for (const [id, value] of Object.entries(source['statuses'])) {
      if (isStatus(value)) statuses[id] = value;
    }
  }

  const notes: Record<string, string> = {};
  if (typeof source['notes'] === 'object' && source['notes'] !== null) {
    for (const [id, value] of Object.entries(source['notes'])) {
      if (typeof value === 'string') notes[id] = value.slice(0, MAX_NOTE_LENGTH);
    }
  }

  return { statuses, notes, profile: parseProfile(source['profile']) };
}

function parseCredentials(raw: unknown): UpstashCredentials | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (typeof source['url'] !== 'string' || typeof source['token'] !== 'string') return null;
  return { url: source['url'], token: source['token'] };
}

export function TrackingProvider({ children }: { readonly children: ReactNode }) {
  const [tracking, setTracking] = useState<TrackingState>(EMPTY_TRACKING);
  const [credentials, setCredentials] = useState<UpstashCredentials | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('offline');
  const [syncError, setSyncError] = useState<string | null>(null);

  const pendingSync = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<TrackingState>(EMPTY_TRACKING);
  latest.current = tracking;

  /**
   * Bumped whenever the connection changes. A write that was already in flight
   * when the user disconnected must not come back and report "saved to your
   * database" — by then there is no database connected, and saying otherwise
   * about where someone's data went is exactly the wrong thing to be vague on.
   */
  const connectionGeneration = useRef(0);

  // Hydrate from localStorage, then pull remote if already connected.
  useEffect(() => {
    const localTracking = readLocal('tracking', parseTracking);
    if (localTracking !== null) setTracking(localTracking);

    const localCreds = readLocal('upstash', parseCredentials);
    if (localCreds === null) return;

    setCredentials(localCreds);
    setSyncState('syncing');

    let cancelled = false;
    void readJson<unknown>(localCreds, REMOTE_KEY)
      .then((remote) => {
        if (cancelled) return;
        const parsed = parseTracking(remote);
        // Remote is authoritative for an already-connected browser; a local-only
        // record stays put when the database has nothing yet.
        if (parsed !== null) {
          setTracking(parsed);
          writeLocal('tracking', parsed);
        }
        setSyncState('idle');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSyncState('error');
        setSyncError(
          error instanceof UpstashError ? error.message : 'Could not reach your database.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const scheduleRemoteSync = useCallback((creds: UpstashCredentials | null) => {
    if (creds === null) return;
    if (pendingSync.current !== null) clearTimeout(pendingSync.current);

    const generation = connectionGeneration.current;
    const stillCurrent = () => connectionGeneration.current === generation;

    pendingSync.current = setTimeout(() => {
      if (!stillCurrent()) return;
      setSyncState('syncing');
      void writeJson(creds, REMOTE_KEY, latest.current)
        .then(() => {
          if (!stillCurrent()) return;
          setSyncState('saved');
          setSyncError(null);
          setTimeout(() => {
            if (!stillCurrent()) return;
            setSyncState((current) => (current === 'saved' ? 'idle' : current));
          }, 1600);
        })
        .catch((error: unknown) => {
          if (!stillCurrent()) return;
          setSyncState('error');
          setSyncError(
            error instanceof UpstashError
              ? error.message
              : 'Could not save to your database. Your changes are still stored in this browser.',
          );
        });
    }, SYNC_DEBOUNCE_MS);
  }, []);

  // Persist locally first — tracking works with or without a database, so a
  // failed sync never costs the user their data.
  const commit = useCallback(
    (next: TrackingState) => {
      setTracking(next);
      latest.current = next;
      writeLocal('tracking', next);
      scheduleRemoteSync(credentials);
    },
    [credentials, scheduleRemoteSync],
  );

  const setStatus = useCallback(
    (companyId: string, status: Status | null) => {
      const statuses = { ...latest.current.statuses };
      if (status === null) delete statuses[companyId];
      else statuses[companyId] = status;
      commit({ ...latest.current, statuses });
    },
    [commit],
  );

  const setNote = useCallback(
    (companyId: string, note: string) => {
      const notes = { ...latest.current.notes };
      const trimmed = note.slice(0, MAX_NOTE_LENGTH);
      if (trimmed.trim() === '') delete notes[companyId];
      else notes[companyId] = trimmed;
      commit({ ...latest.current, notes });
    },
    [commit],
  );

  const setProfile = useCallback(
    (profile: Profile) => {
      commit({ ...latest.current, profile });
    },
    [commit],
  );

  const retry = useCallback(() => {
    if (credentials === null) return;
    setSyncError(null);
    scheduleRemoteSync(credentials);
  }, [credentials, scheduleRemoteSync]);

  const connect = useCallback(async (creds: UpstashCredentials) => {
    connectionGeneration.current += 1;
    setSyncState('syncing');
    setSyncError(null);

    const remote = parseTracking(await readJson<unknown>(creds, REMOTE_KEY));
    const local = latest.current;

    // Union on connect: neither side's work is discarded. Where both hold a
    // value for the same company, the local one wins — it is what the user is
    // looking at right now.
    // The profile is one object rather than a per-company map, so it cannot be
    // unioned key by key. Local still wins — it is what the reader is looking
    // at — unless this browser has no profile yet, in which case connecting a
    // database should hand back the one already saved in it rather than
    // overwriting it with nothing.
    const localProfile = local.profile;
    const profile =
      isProfileEmpty(localProfile) && remote !== null ? remote.profile : localProfile;

    const merged: TrackingState = {
      statuses: { ...(remote?.statuses ?? {}), ...local.statuses },
      notes: { ...(remote?.notes ?? {}), ...local.notes },
      profile,
    };

    await writeJson(creds, REMOTE_KEY, merged);

    setCredentials(creds);
    setTracking(merged);
    latest.current = merged;
    writeLocal('tracking', merged);
    writeLocal('upstash', creds);
    setSyncState('idle');
  }, []);

  const disconnect = useCallback(() => {
    connectionGeneration.current += 1;
    if (pendingSync.current !== null) clearTimeout(pendingSync.current);
    // Credentials are wiped from this browser; data stays in the user's own
    // database, exactly as the modal promises.
    removeLocal('upstash');
    setCredentials(null);
    setSyncState('offline');
    setSyncError(null);
  }, []);

  const trackedIds = useMemo(
    () => Object.keys(tracking.statuses).sort(),
    [tracking.statuses],
  );

  const value = useMemo<TrackingContextValue>(
    () => ({
      tracking,
      credentials,
      connected: credentials !== null,
      failing: credentials !== null && syncState === 'error',
      syncState,
      syncError,
      maskedCredentials: credentials !== null ? maskCredentials(credentials) : null,
      setStatus,
      setNote,
      setProfile,
      retry,
      connect,
      disconnect,
      trackedIds,
    }),
    [
      tracking,
      credentials,
      syncState,
      syncError,
      setStatus,
      setNote,
      setProfile,
      retry,
      connect,
      disconnect,
      trackedIds,
    ],
  );

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>;
}

export function useTracking(): TrackingContextValue {
  const context = useContext(TrackingContext);
  if (context === null) {
    throw new Error('useTracking must be used within a TrackingProvider');
  }
  return context;
}

export { deleteKey };
