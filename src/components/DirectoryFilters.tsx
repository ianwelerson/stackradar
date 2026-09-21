import type { Filters } from '@/types/filters';
import { SIZE_BANDS, SORT_OPTIONS, type SizeBandKey, type SortKey } from '@/types/filters';
import type { RemotePolicy } from '@/types/company';
import { DISCIPLINE_LABELS, TECHNICAL, type Discipline } from '@/lib/discipline';

/**
 * The filter bar.
 *
 * Laid out as two deliberate rows rather than one wrapping line. With the role
 * filter added, the controls total roughly 1,200px of content in a 1,180px
 * column, so a single `flex-wrap` row broke wherever the browser happened to
 * run out — usually mid-way through the selects, leaving Location, Size and
 * Sort squeezed into whatever was left.
 *
 *   Row 1  the toggles: what am I looking at, and what counts as a match
 *   Row 2  the selects: where, how big, in what order
 *
 * On a phone every group takes a row of its own and fills the width.
 */

interface Props {
  readonly filters: Filters;
  readonly countries: readonly string[];
  readonly onChange: (patch: Partial<Filters>) => void;
  readonly view: 'companies' | 'roles';
  readonly onViewChange: (view: 'companies' | 'roles') => void;
}

const VIEWS = [
  { key: 'companies', label: 'Companies' },
  { key: 'roles', label: 'Open roles' },
] as const;

/** Toggles, not a radio group: wanting remote *or* hybrid is the common case. */
const WORK_MODELS: readonly { value: RemotePolicy; label: string }[] = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
];

/** The disciplines worth a one-tap filter. The rest stay reachable from the
 *  profile, and every role still falls into exactly one bucket. */
const ROLE_FILTERS: readonly Discipline[] = ['engineering', 'data-ml', 'design', 'product'];

/** Add or remove one value from a selection. */
function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

const GROUP_CLASS =
  'flex bg-surface border border-line-strong rounded-[8px] p-[3px] gap-[2px] w-full overflow-x-auto scrollbar-thin md:w-auto';

const PILL_CLASS =
  'flex-1 md:flex-none border-none rounded-[6px] px-[11px] py-[6px] text-[12.5px] cursor-pointer whitespace-nowrap transition-colors';

const PILL_ON = 'bg-accent-surface-active text-accent-text-bright font-medium';
const PILL_OFF = 'bg-transparent text-ink-dim font-normal hover:text-ink-soft';

const SELECT_CLASS =
  'flex-1 min-w-0 basis-[130px] appearance-none bg-surface border border-line-strong rounded-[8px] text-ink-soft px-[11px] py-2 text-[12.5px] cursor-pointer md:flex-none md:basis-auto md:min-w-[150px]';

function Pill({
  active,
  onClick,
  title,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly title?: string | undefined;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={`${PILL_CLASS} ${active ? PILL_ON : PILL_OFF}`}
    >
      {children}
    </button>
  );
}

export function DirectoryFilters({ filters, countries, onChange, view, onViewChange }: Props) {
  return (
    <div className="flex flex-col gap-[14px]">
      <div
        data-focus-ring="wrapper"
        className="flex items-center gap-[10px] bg-surface border border-line-strong rounded-[10px] px-[14px] transition-colors focus-within:border-accent-line-strong"
      >
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

      {/* Row 1 — toggles. */}
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <div className={GROUP_CLASS} role="group" aria-label="Result view">
          {VIEWS.map((option) => (
            <Pill
              key={option.key}
              active={view === option.key}
              onClick={() => onViewChange(option.key)}
            >
              {option.label}
            </Pill>
          ))}
        </div>

        <div className={GROUP_CLASS} role="group" aria-label="Work model">
          <Pill active={filters.remote.length === 0} onClick={() => onChange({ remote: [] })}>
            All models
          </Pill>
          {WORK_MODELS.map((model) => (
            <Pill
              key={model.value}
              active={filters.remote.includes(model.value)}
              onClick={() => onChange({ remote: toggle(filters.remote, model.value) })}
            >
              {model.label}
            </Pill>
          ))}
        </div>

        {/* Shown in both views. In Open roles it picks which rows appear; in
            Companies it keeps the companies that have at least one such role
            open — "who is hiring engineers" is the same question either way. */}
        <div className={GROUP_CLASS} role="group" aria-label="Role type">
          <Pill
            active={filters.disciplines.length === 0}
            onClick={() => onChange({ disciplines: [] })}
          >
            All roles
          </Pill>
          {ROLE_FILTERS.map((discipline) => (
            <Pill
              key={discipline}
              active={filters.disciplines.includes(discipline)}
              title={
                (TECHNICAL as readonly string[]).includes(discipline)
                  ? undefined
                  : 'Not a software engineering role'
              }
              onClick={() => onChange({ disciplines: toggle(filters.disciplines, discipline) })}
            >
              {DISCIPLINE_LABELS[discipline]}
            </Pill>
          ))}
        </div>
      </div>

      {/* Row 2 — selects. Sort sits at the far end on desktop: it orders the
          result of the other two, rather than narrowing anything itself. */}
      <div className="flex gap-2 items-center min-w-0 flex-wrap">
        {/* A profile may select several locations; one <select> cannot show that
            honestly, so it says how many and picking one replaces the set. */}
        <select
          value={filters.countries.length === 1 ? filters.countries[0] : ''}
          onChange={(event) =>
            onChange({ countries: event.target.value ? [event.target.value] : [] })
          }
          aria-label="Location"
          className={SELECT_CLASS}
        >
          <option value="">
            {filters.countries.length > 1
              ? `${filters.countries.length} locations`
              : 'Any location'}
          </option>
          {countries.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>

        <select
          value={filters.sizes.length === 1 ? filters.sizes[0] : ''}
          onChange={(event) =>
            onChange({ sizes: event.target.value ? [event.target.value as SizeBandKey] : [] })
          }
          aria-label="Company size"
          className={SELECT_CLASS}
        >
          <option value="">
            {filters.sizes.length > 1 ? `${filters.sizes.length} size bands` : 'Any size'}
          </option>
          {Object.entries(SIZE_BANDS).map(([key, band]) => (
            <option key={key} value={key}>
              {band.label}
            </option>
          ))}
        </select>

        {/* Sort is not a filter — it reorders what the filters produced — so it
            reads as a label with a value rather than another boxed input. The
            native <select> is kept underneath for keyboard and screen-reader
            behaviour, made transparent and laid over the text it controls. */}
        <div className="relative flex items-center gap-[6px] md:ml-auto text-[12.5px] text-ink-dim ps-1">
          <span className="font-mono text-[11px] text-ink-faint whitespace-nowrap">sorted by</span>
          <span className="text-ink-soft whitespace-nowrap">{SORT_OPTIONS[filters.sort]}</span>
          <span className="text-ink-faint text-[10px] leading-none" aria-hidden="true">
            ▾
          </span>
          <select
            value={filters.sort}
            onChange={(event) => onChange({ sort: event.target.value as SortKey })}
            aria-label="Sort by"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          >
            {Object.entries(SORT_OPTIONS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
