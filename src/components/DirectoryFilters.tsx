import type { Filters } from '@/types/filters';
import { SIZE_BANDS, SORT_OPTIONS, type SizeBandKey, type SortKey } from '@/types/filters';
import type { RemotePolicy } from '@/types/company';

interface Props {
  readonly filters: Filters;
  readonly countries: readonly string[];
  readonly onChange: (patch: Partial<Filters>) => void;
}

const WORK_MODELS: readonly { value: RemotePolicy | null; label: string }[] = [
  { value: null, label: 'All models' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
];

const SELECT_CLASS =
  'flex-1 min-w-0 basis-[130px] appearance-none bg-surface border border-line-strong rounded-[8px] text-ink-soft px-[11px] py-2 text-[12.5px] cursor-pointer';

export function DirectoryFilters({ filters, countries, onChange }: Props) {
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center gap-[10px] bg-surface border border-line-strong rounded-[10px] px-[14px]">
        <span className="font-mono text-accent text-[13px] select-none" aria-hidden="true">
          /
        </span>
        <input
          type="search"
          value={filters.query}
          onChange={(event) => onChange({ query: event.target.value })}
          placeholder="Search stack, role, or company — e.g. Go, Postgres, design engineer"
          aria-label="Search companies"
          className="flex-1 min-w-0 bg-transparent border-none text-ink py-[13px] text-[14.5px] [&::-webkit-search-cancel-button]:hidden"
        />
        {filters.query !== '' && (
          <button
            type="button"
            onClick={() => onChange({ query: '' })}
            className="bg-transparent border-none text-ink-faint cursor-pointer text-[12px] p-1 hover:text-ink-soft"
          >
            clear
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div
          className="flex bg-surface border border-line-strong rounded-[8px] p-[3px] gap-[2px] overflow-auto scrollbar-thin"
          role="group"
          aria-label="Work model"
        >
          {WORK_MODELS.map((model) => {
            const active = filters.remote === model.value;
            return (
              <button
                key={model.label}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ remote: model.value })}
                className={`border-none rounded-[6px] px-[11px] py-[6px] text-[12.5px] cursor-pointer whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-accent-surface-active text-accent-text-bright font-medium'
                    : 'bg-transparent text-ink-dim font-normal hover:text-ink-soft'
                }`}
              >
                {model.label}
              </button>
            );
          })}
        </div>

        <select
          value={filters.country ?? ''}
          onChange={(event) => onChange({ country: event.target.value || null })}
          aria-label="Location"
          className={SELECT_CLASS}
        >
          <option value="">Any location</option>
          {countries.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>

        <select
          value={filters.size ?? ''}
          onChange={(event) =>
            onChange({ size: (event.target.value || null) as SizeBandKey | null })
          }
          aria-label="Company size"
          className={SELECT_CLASS}
        >
          <option value="">Any size</option>
          {Object.entries(SIZE_BANDS).map(([key, band]) => (
            <option key={key} value={key}>
              {band.label}
            </option>
          ))}
        </select>

        <select
          value={filters.sort}
          onChange={(event) => onChange({ sort: event.target.value as SortKey })}
          aria-label="Sort by"
          className={SELECT_CLASS}
        >
          {Object.entries(SORT_OPTIONS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
