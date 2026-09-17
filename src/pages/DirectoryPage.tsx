import { useMemo } from 'react';
import { companies } from '@/lib/dataset';
import { applyFilters, availableCountries } from '@/lib/filtering';
import { splitTerms, tokenize } from '@/lib/scoring';
import { useFilters } from '@/hooks/useFilters';
import { useTracking } from '@/hooks/useTracking';
import { DirectoryFilters } from '@/components/DirectoryFilters';
import { CompanyCard } from '@/components/CompanyCard';
import { SIZE_BANDS } from '@/types/filters';
import { remotePolicyLabel } from '@/lib/format';

// The highest-yield keywords actually present in the dataset, so a suggestion
// never leads back to another empty result.
const SUGGESTIONS = ['developer-tools', 'fintech', 'saas'] as const;

export function DirectoryPage() {
  const { filters, update, reset, activeCount } = useFilters();
  const { tracking } = useTracking();

  const countries = useMemo(() => availableCountries(companies), []);
  const outcome = useMemo(() => applyFilters(companies, filters), [filters]);
  const queryTokens = useMemo(() => tokenize(filters.query), [filters.query]);

  const { results } = outcome;
  const openRoles = results.reduce((sum, r) => sum + r.company.currentOpenings.length, 0);

  // Name what each filter hid for missing data, rather than letting a large
  // unverified slice of the index disappear without explanation.
  const hiddenNotes: string[] = [];
  if (outcome.excluded.unknownSize > 0) {
    hiddenNotes.push(`${outcome.excluded.unknownSize} with unknown size`);
  }
  if (outcome.excluded.unknownCountry > 0) {
    hiddenNotes.push(`${outcome.excluded.unknownCountry} with unknown location`);
  }
  if (outcome.excluded.unknownRemote > 0) {
    hiddenNotes.push(`${outcome.excluded.unknownRemote} with unknown work model`);
  }

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.remote !== null) {
    chips.push({
      key: 'remote',
      label: remotePolicyLabel(filters.remote),
      clear: () => update({ remote: null }),
    });
  }
  if (filters.country !== null) {
    chips.push({
      key: 'country',
      label: filters.country,
      clear: () => update({ country: null }),
    });
  }
  if (filters.size !== null) {
    chips.push({
      key: 'size',
      label: SIZE_BANDS[filters.size].label,
      clear: () => update({ size: null }),
    });
  }
  // One pill per search term rather than one for the whole box, so a term can
  // be dropped without retyping the rest. Terms are split by the same function
  // the scorer uses, so a pill always corresponds to something actually searched.
  const terms = splitTerms(filters.query);
  terms.forEach((term, index) => {
    chips.push({
      key: `q-${index}-${term}`,
      label: `“${term}”`,
      clear: () =>
        update({ query: terms.filter((_, other) => other !== index).join(', ') }),
    });
  });

  return (
    <main className="max-w-[1180px] mx-auto px-5 pt-7 pb-[72px]">
      <div className="flex flex-col gap-[14px] mb-[26px]">
        <DirectoryFilters filters={filters} countries={countries} onChange={update} />

        <div className="flex gap-2 flex-wrap items-center min-h-[22px]">
          <span className="font-mono text-[11.5px] text-ink-dimmer">
            {results.length} of {companies.length} companies
            {results.length > 0 && ` · ${openRoles} open roles`}
          </span>
          {hiddenNotes.length > 0 && (
            <span className="font-mono text-[11.5px] text-ink-fainter">
              · {hiddenNotes.join(', ')} not shown
            </span>
          )}
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.clear}
              className="flex items-center gap-[6px] bg-accent-surface border border-accent-line text-accent-text rounded-[20px] px-[9px] py-[3px] text-[11.5px] cursor-pointer font-mono hover:bg-accent-surface-strong transition-colors"
            >
              {chip.label} <span className="opacity-60">✕</span>
            </button>
          ))}
        </div>
      </div>

      {results.length > 0 ? (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,335px),1fr))]">
          {results.map(({ company, match }) => (
            <CompanyCard
              key={company.id}
              company={company}
              match={match}
              status={tracking.statuses[company.id]}
              queryTokens={queryTokens}
            />
          ))}
        </div>
      ) : (
        <div className="border border-dashed border-line-control rounded-[12px] px-6 py-12 text-center flex flex-col items-center gap-[14px] animate-[sp-fade_.3s_ease_both]">
          <div className="w-[34px] h-[34px] rounded-[9px] border border-line-strong flex items-center justify-center font-mono text-ink-faint">
            0
          </div>
          <div className="text-[16px] font-semibold">No companies match these filters</div>
          <p className="text-ink-dim text-[13px] max-w-[420px] text-pretty m-0">
            {filters.query.trim() !== ''
              ? `Nothing indexed matches “${filters.query.trim()}” with these filters. Try a broader term, or drop a filter.`
              : 'These filters exclude every company in the index. Widen the size range or work model.'}
          </p>
          <div className="flex gap-2 flex-wrap justify-center mt-[2px]">
            {activeCount > 0 && (
              <button
                type="button"
                onClick={reset}
                className="bg-accent border-none text-accent-ink rounded-[7px] px-[14px] py-2 text-[12.5px] font-medium cursor-pointer hover:bg-accent-hover transition-colors"
              >
                Reset all filters
              </button>
            )}
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  reset();
                  update({ query: suggestion });
                }}
                className="bg-control border border-line-control text-ink-muted rounded-[7px] px-3 py-2 text-[12.5px] cursor-pointer font-mono hover:border-accent-line-hover transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
