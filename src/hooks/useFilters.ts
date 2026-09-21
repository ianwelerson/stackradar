import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  EMPTY_FILTERS,
  SIZE_BANDS,
  SORT_OPTIONS,
  type Filters,
  type SizeBandKey,
  type SortKey,
} from '@/types/filters';
import { EMPTY_PROFILE, type Profile } from '@/types/profile';
import type { RemotePolicy } from '@/types/company';
import { DISCIPLINE_LABELS, type Discipline } from '@/lib/discipline';

/**
 * Filter state lives in the query string so a search is linkable and
 * shareable — the prototype held it in component state, which meant no URL ever
 * described what you were looking at.
 *
 * A saved profile supplies the starting point, and the rule between the two is
 * deliberately blunt: **an untouched URL means "show me my profile"; the moment
 * any filter key appears, the URL describes the whole view.** Half-merging the
 * two would produce a directory where clearing a filter silently restores it
 * from the profile, which is maddening — and it would make a shared link mean
 * different things to different people, which defeats having the URL at all.
 *
 * Changing filters therefore never writes to the profile. Editing the profile
 * is its own deliberate act, on its own page.
 */

const REMOTE_VALUES: readonly RemotePolicy[] = ['remote', 'hybrid', 'onsite'];
const MAX_QUERY_LENGTH = 120;
const MAX_LIST_ITEMS = 24;

/** Keys whose presence means the reader has taken the wheel. */
const FILTER_KEYS = ['q', 'remote', 'country', 'size', 'role', 'unknown'] as const;

function parseList(value: string | null): string[] {
  if (value === null || value === '') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .slice(0, MAX_LIST_ITEMS);
}

function parseRemote(value: string | null): RemotePolicy[] {
  const wanted = new Set(parseList(value).map((v) => v.toLowerCase()));
  return REMOTE_VALUES.filter((policy) => wanted.has(policy));
}

function parseSizes(value: string | null): SizeBandKey[] {
  const wanted = new Set(parseList(value));
  return (Object.keys(SIZE_BANDS) as SizeBandKey[]).filter((band) => wanted.has(band));
}

function parseDisciplines(value: string | null): Discipline[] {
  const wanted = new Set(parseList(value));
  return (Object.keys(DISCIPLINE_LABELS) as Discipline[]).filter((key) => wanted.has(key));
}

function parseSort(value: string | null): SortKey {
  return value !== null && value in SORT_OPTIONS ? (value as SortKey) : EMPTY_FILTERS.sort;
}

export interface UseFilters {
  readonly filters: Filters;
  readonly update: (patch: Partial<Filters>) => void;
  readonly reset: () => void;
  readonly activeCount: number;
  /** True while the view is the saved profile rather than an ad-hoc search. */
  readonly usingProfile: boolean;
}

export function useFilters(profile: Profile = EMPTY_PROFILE): UseFilters {
  const [searchParams, setSearchParams] = useSearchParams();

  const touched = FILTER_KEYS.some((key) => searchParams.has(key));

  const filters = useMemo<Filters>(() => {
    const sort = parseSort(searchParams.get('sort'));

    if (!touched) {
      return {
        query: profile.terms.join(', ').slice(0, MAX_QUERY_LENGTH),
        remote: profile.remote,
        countries: profile.countries,
        sizes: profile.sizes,
        disciplines: profile.disciplines,
        includeUnknown: profile.includeUnknown,
        sort,
      };
    }

    return {
      // Bounded so a pathological URL can't drive unbounded work.
      query: (searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH),
      remote: parseRemote(searchParams.get('remote')),
      countries: parseList(searchParams.get('country')),
      sizes: parseSizes(searchParams.get('size')),
      disciplines: parseDisciplines(searchParams.get('role')),
      includeUnknown: searchParams.get('unknown') === '1',
      sort,
    };
  }, [searchParams, touched, profile]);

  const update = useCallback(
    (patch: Partial<Filters>) => {
      // Write the whole effective view, not just what changed: once the URL is
      // authoritative it has to describe every dimension, or a dimension the
      // reader just cleared would fall back to the profile on the next render.
      const next: Filters = { ...filters, ...patch };
      setSearchParams(
        (current) => {
          // Start from whatever else is in the URL. This hook owns the filter
          // keys and nothing else — the results view (`view`) is set elsewhere
          // and must survive a filter change, or typing in the search box would
          // throw the reader from Open roles back to Companies mid-search.
          const params = new URLSearchParams(current);
          for (const key of FILTER_KEYS) params.delete(key);
          if (next.query.trim() !== '') params.set('q', next.query);
          if (next.remote.length > 0) params.set('remote', next.remote.join(','));
          if (next.countries.length > 0) params.set('country', next.countries.join(','));
          if (next.sizes.length > 0) params.set('size', next.sizes.join(','));
          if (next.disciplines.length > 0) params.set('role', next.disciplines.join(','));
          if (next.includeUnknown) params.set('unknown', '1');
          if (next.sort !== EMPTY_FILTERS.sort) params.set('sort', next.sort);
          // Nothing set would read as "untouched" and snap back to the profile.
          // This marker keeps a deliberately empty search empty. Only the keys
          // this hook owns count toward that test — a `view` left over from the
          // toggle is not the reader having set a filter.
          const ownedSet = FILTER_KEYS.some((key) => params.has(key));
          if (!ownedSet) params.set('q', '');
          return params;
        },
        { replace: true },
      );
    },
    [filters, setSearchParams],
  );

  /** Back to the saved profile, by removing every filter key from the URL —
   *  and only those, so the chosen results view is kept. */
  const reset = useCallback(() => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        for (const key of FILTER_KEYS) params.delete(key);
        params.delete('sort');
        return params;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const activeCount =
    (filters.query.trim() !== '' ? 1 : 0) +
    (filters.remote.length > 0 ? 1 : 0) +
    (filters.countries.length > 0 ? 1 : 0) +
    (filters.sizes.length > 0 ? 1 : 0) +
    (filters.disciplines.length > 0 ? 1 : 0);

  return { filters, update, reset, activeCount, usingProfile: !touched };
}
