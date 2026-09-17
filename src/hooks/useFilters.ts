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
import type { RemotePolicy } from '@/types/company';

/**
 * Filter state lives in the query string so a search is linkable and
 * shareable — the prototype held it in component state, which meant no URL
 * ever described what you were looking at.
 */

const REMOTE_VALUES: readonly RemotePolicy[] = ['remote', 'hybrid', 'onsite'];
const MAX_QUERY_LENGTH = 120;

function parseRemote(value: string | null): RemotePolicy | null {
  return value !== null && (REMOTE_VALUES as readonly string[]).includes(value)
    ? (value as RemotePolicy)
    : null;
}

function parseSize(value: string | null): SizeBandKey | null {
  return value !== null && value in SIZE_BANDS ? (value as SizeBandKey) : null;
}

function parseSort(value: string | null): SortKey {
  return value !== null && value in SORT_OPTIONS ? (value as SortKey) : EMPTY_FILTERS.sort;
}

export function useFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<Filters>(
    () => ({
      // Bounded so a pathological URL can't drive unbounded work.
      query: (searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH),
      remote: parseRemote(searchParams.get('remote')),
      country: searchParams.get('country'),
      size: parseSize(searchParams.get('size')),
      sort: parseSort(searchParams.get('sort')),
    }),
    [searchParams],
  );

  const update = useCallback(
    (patch: Partial<Filters>) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          const apply = (key: string, value: string | null) => {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          };

          if ('query' in patch) apply('q', patch.query ?? null);
          if ('remote' in patch) apply('remote', patch.remote ?? null);
          if ('country' in patch) apply('country', patch.country ?? null);
          if ('size' in patch) apply('size', patch.size ?? null);
          if ('sort' in patch) {
            apply('sort', patch.sort === EMPTY_FILTERS.sort ? null : (patch.sort ?? null));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const reset = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const activeCount =
    (filters.query.trim() !== '' ? 1 : 0) +
    (filters.remote !== null ? 1 : 0) +
    (filters.country !== null ? 1 : 0) +
    (filters.size !== null ? 1 : 0);

  return { filters, update, reset, activeCount };
}
