import { useCallback, useEffect, useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { companies } from '@/lib/dataset';
import { applyFilters, availableCountries } from '@/lib/filtering';
import { splitTerms, tokenize } from '@/lib/scoring';
import { ROLE_SORTERS, searchRoles } from '@/lib/roles';
import { useFilters } from '@/hooks/useFilters';
import { useTracking } from '@/hooks/useTracking';
import { DirectoryFilters } from '@/components/DirectoryFilters';
import { CompanyCard } from '@/components/CompanyCard';
import { RoleResults } from '@/components/RoleResults';
import { SIZE_BANDS } from '@/types/filters';
import { isProfileEmpty } from '@/types/profile';
import { DISCIPLINE_LABELS, disciplineOf } from '@/lib/discipline';
import { remotePolicyLabel } from '@/lib/format';
import { rememberDirectorySearch } from '@/lib/return-to';

// The highest-yield keywords actually present in the dataset, so a suggestion
// never leads back to another empty result.
const SUGGESTIONS = ['developer-tools', 'fintech', 'saas'] as const;

type ViewKey = 'companies' | 'roles';

export function DirectoryPage() {
  const { tracking } = useTracking();
  const { filters, update, reset, activeCount, usingProfile } = useFilters(tracking.profile);
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();

  const view: ViewKey = params.get('view') === 'roles' ? 'roles' : 'companies';
  const setView = useCallback(
    (next: ViewKey) => {
      // Functional form, and only the `view` key is touched: switching views
      // must carry the current search with it, not replace it with whatever
      // this render happened to capture.
      setParams(
        (current) => {
          const copy = new URLSearchParams(current);
          if (next === 'companies') copy.delete('view');
          else copy.set('view', next);
          return copy;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // So a company page's "← all companies" link returns the reader to the view
  // they actually built, rather than a bare index.
  useEffect(() => rememberDirectorySearch(search), [search]);

  const countries = useMemo(() => availableCountries(companies), []);
  const outcome = useMemo(() => applyFilters(companies, filters), [filters]);
  const queryTokens = useMemo(() => tokenize(filters.query), [filters.query]);

  const { results } = outcome;
  const openRoles = results.reduce((sum, r) => sum + r.company.currentOpenings.length, 0);

  // Roles are drawn from the companies that already passed the filters, so the
  // two views never disagree about who qualifies — they differ only in what a
  // row stands for.
  const roles = useMemo(() => {
    if (view !== 'roles') return [];
    const matching = results.map((entry) => entry.company);
    const found = searchRoles(matching, queryTokens);
    // Discipline is applied to roles only. A company filter cannot express
    // "I want the backend job, not the account executive job" — that is a
    // property of the role, and this view is the one whose rows are roles.
    const wanted = filters.disciplines;
    const kept =
      wanted.length === 0
        ? found
        : found.filter((entry) => wanted.includes(disciplineOf(entry.opening.title)));
    return kept.sort(ROLE_SORTERS[filters.sort] ?? ROLE_SORTERS['relevance']);
  }, [view, results, queryTokens, filters.sort, filters.disciplines]);

  // Name what each filter hid for missing data, rather than letting a large
  // unverified slice of the index disappear without explanation.
  const hiddenNotes: string[] = [];
  if (outcome.excluded.unknownSize > 0) {
    hiddenNotes.push(`${outcome.excluded.unknownSize} whose team size we haven't confirmed`);
  }
  if (outcome.excluded.unknownCountry > 0) {
    hiddenNotes.push(`${outcome.excluded.unknownCountry} whose location we haven't confirmed`);
  }
  if (outcome.excluded.unknownRemote > 0) {
    hiddenNotes.push(`${outcome.excluded.unknownRemote} whose work model we haven't confirmed`);
  }
  if (outcome.excluded.unknownRoles > 0) {
    hiddenNotes.push(`${outcome.excluded.unknownRoles} with no readable list of open roles`);
  }

  const chips: { key: string; label: string; clear: () => void }[] = [];
  for (const policy of filters.remote) {
    chips.push({
      key: `remote-${policy}`,
      label: remotePolicyLabel(policy),
      clear: () => update({ remote: filters.remote.filter((p) => p !== policy) }),
    });
  }
  for (const country of filters.countries) {
    chips.push({
      key: `country-${country}`,
      label: country,
      clear: () => update({ countries: filters.countries.filter((c) => c !== country) }),
    });
  }
  for (const band of filters.sizes) {
    chips.push({
      key: `size-${band}`,
      label: SIZE_BANDS[band].label,
      clear: () => update({ sizes: filters.sizes.filter((s) => s !== band) }),
    });
  }
  for (const discipline of filters.disciplines) {
    chips.push({
      key: `role-${discipline}`,
      label: DISCIPLINE_LABELS[discipline],
      clear: () =>
        update({ disciplines: filters.disciplines.filter((d) => d !== discipline) }),
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
      clear: () => update({ query: terms.filter((_, other) => other !== index).join(', ') }),
    });
  });

  const hasProfile = !isProfileEmpty(tracking.profile);

  const empty = (
    <EmptyState
      title={
        view === 'roles' ? 'No open roles match this search' : 'No companies match these filters'
      }
      body={
        view === 'roles' && results.length > 0
          ? 'These companies match, but none of their open roles do. Switch to Companies to see them.'
          : filters.query.trim() !== ''
            ? 'Nothing matched every term. Terms are separated by commas, so try dropping one.'
            : 'Try widening a filter, or let your profile include companies whose details we could not confirm.'
      }
      activeCount={activeCount}
      onReset={reset}
      onSuggest={(term) => update({ query: term })}
    />
  );

  return (
    <main className="max-w-[1180px] mx-auto px-5 pt-7 pb-[72px]">
      <div className="flex flex-col gap-[14px] mb-[26px]">
        <DirectoryFilters
          filters={filters}
          countries={countries}
          onChange={update}
          view={view}
          onViewChange={setView}
        />

        {/* Says plainly whose search this is. Without it, a directory that opens
            pre-narrowed just looks like a directory that is missing things. */}
        {hasProfile && (
          <div className="flex items-center gap-[10px] flex-wrap font-mono text-[11.5px]">
            {usingProfile ? (
              <>
                <span className="text-accent-text">▣ filtered by your profile</span>
                <Link to="/profile" className="text-ink-dim no-underline hover:text-ink">
                  edit
                </Link>
              </>
            ) : (
              <>
                <span className="text-ink-fainter">custom search — your profile is unchanged</span>
                <button
                  type="button"
                  onClick={reset}
                  className="bg-transparent border-none text-accent-link cursor-pointer p-0 font-mono text-[11.5px] hover:text-accent-link-hover"
                >
                  back to my profile
                </button>
              </>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap items-center min-h-[22px]">
          <span className="font-mono text-[11.5px] text-ink-dimmer">
            {view === 'roles'
              ? `${roles.length} open roles at ${results.length} companies`
              : `${results.length} of ${companies.length} companies${
                  results.length > 0 ? ` · ${openRoles} open roles` : ''
                }`}
          </span>

          {hiddenNotes.length > 0 && (
            <span
              className="font-mono text-[11.5px] text-ink-fainter"
              title={
                'This filter can only match companies whose value we have actually established. ' +
                'Rather than guess, we leave those fields empty — so companies with nothing ' +
                'recorded are set aside here instead of being quietly counted as a match. ' +
                'Your profile can choose to include them.'
              }
            >
              · hidden by this filter: {hiddenNotes.join(', ')}
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

      {view === 'roles' ? (
        roles.length > 0 ? (
          <RoleResults roles={roles} statuses={tracking.statuses} queryTokens={queryTokens} />
        ) : (
          empty
        )
      ) : results.length > 0 ? (
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
        empty
      )}
    </main>
  );
}

function EmptyState({
  title,
  body,
  activeCount,
  onReset,
  onSuggest,
}: {
  readonly title: string;
  readonly body: string;
  readonly activeCount: number;
  readonly onReset: () => void;
  readonly onSuggest: (term: string) => void;
}) {
  return (
    <div className="border border-dashed border-line-control rounded-[12px] px-6 py-12 text-center flex flex-col items-center gap-[14px] animate-[sp-fade_.3s_ease_both]">
      <div className="w-[34px] h-[34px] rounded-[9px] border border-line-strong flex items-center justify-center font-mono text-ink-faint">
        0
      </div>
      <div className="text-[16px] font-semibold">{title}</div>
      <p className="text-ink-dim text-[13px] max-w-[420px] text-pretty m-0">{body}</p>
      <div className="flex gap-2 flex-wrap justify-center">
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="bg-control border border-line-control text-ink-soft rounded-[7px] px-[13px] py-[8px] text-[12.5px] cursor-pointer hover:border-accent-line-hover hover:text-ink transition-colors"
          >
            Clear filters
          </button>
        )}
        {SUGGESTIONS.map((term) => (
          <button
            key={term}
            type="button"
            onClick={() => onSuggest(term)}
            className="bg-control border border-line-control text-ink-muted rounded-[7px] px-3 py-2 text-[12.5px] cursor-pointer font-mono hover:border-accent-line-hover transition-colors"
          >
            {term}
          </button>
        ))}
      </div>
    </div>
  );
}
