import { useState } from 'react';
import { SIZE_BANDS, type SizeBandKey } from '@/types/filters';
import { MAX_TERMS, MAX_TERM_LENGTH, type Profile } from '@/types/profile';
import type { RemotePolicy } from '@/types/company';
import { splitTerms } from '@/lib/scoring';
import { DISCIPLINE_LABELS, TECHNICAL, type Discipline } from '@/lib/discipline';

/**
 * Editing the saved profile.
 *
 * Every control is a toggle rather than a single-choice select, because the
 * honest answer to "what work model do you want" is usually more than one. The
 * absence of any selection means "no preference", which is shown explicitly
 * ("Any") rather than left as an empty row that reads like a broken control.
 *
 * Changes save as you make them — there is no Save button, because a profile
 * that silently discards work when you navigate away is worse than one that
 * commits a preference you can immediately toggle back.
 */

const WORK_MODELS: readonly { value: RemotePolicy; label: string; hint: string }[] = [
  { value: 'remote', label: 'Remote', hint: 'work from anywhere they hire' },
  { value: 'hybrid', label: 'Hybrid', hint: 'some days in an office' },
  { value: 'onsite', label: 'On-site', hint: 'based in an office' },
];

/** Offered in the order an engineer scans them. */
const ROLE_CHOICES: readonly Discipline[] = [
  'engineering',
  'data-ml',
  'design',
  'product',
  'devrel',
  'go-to-market',
  'support',
  'people-finance',
];

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="bg-surface px-[15px] py-[14px]">
      <div className="font-mono text-[10.5px] text-ink-faint uppercase tracking-[0.06em]">
        {label}
      </div>
      <p className="text-[12px] text-ink-dimmer m-0 mt-[3px] mb-[10px] text-pretty">{hint}</p>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  // Explicitly `| undefined`: the repo runs exactOptionalPropertyTypes, so an
  // optional prop and a prop that may be passed as undefined are not the same
  // type, and callers here legitimately pass undefined for "no tooltip".
  readonly title?: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={`rounded-[7px] px-[11px] py-[7px] text-[12.5px] cursor-pointer border transition-colors ${
        active
          ? 'bg-accent-surface border-accent-line text-accent-text font-medium'
          : 'bg-control border-line-control text-ink-dim hover:border-accent-line-hover hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

export function ProfileEditor({
  profile,
  countries,
  onChange,
}: {
  readonly profile: Profile;
  readonly countries: readonly string[];
  readonly onChange: (next: Profile) => void;
}) {
  const [termDraft, setTermDraft] = useState('');

  const addTerms = (raw: string) => {
    const incoming = splitTerms(raw).map((t) => t.slice(0, MAX_TERM_LENGTH));
    if (incoming.length === 0) return;
    const existing = new Set(profile.terms.map((t) => t.toLowerCase()));
    const merged = [...profile.terms];
    for (const term of incoming) {
      if (existing.has(term.toLowerCase())) continue;
      if (merged.length >= MAX_TERMS) break;
      merged.push(term);
      existing.add(term.toLowerCase());
    }
    onChange({ ...profile, terms: merged });
    setTermDraft('');
  };

  return (
    <div className="flex flex-col gap-px bg-line border border-line rounded-[11px] overflow-hidden">
      <Field
        label="Stack & role terms"
        hint="What you work with, or want to. Separate with commas — each becomes its own term, and they drive the match score."
      >
        <div className="flex gap-[6px] flex-wrap mb-[10px]">
          {profile.terms.length === 0 && (
            <span className="text-[12.5px] text-ink-fainter font-mono">none yet</span>
          )}
          {profile.terms.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() =>
                onChange({ ...profile, terms: profile.terms.filter((t) => t !== term) })
              }
              className="flex items-center gap-[6px] bg-accent-surface border border-accent-line text-accent-text rounded-[20px] px-[10px] py-[4px] text-[12px] cursor-pointer font-mono hover:bg-accent-surface-strong transition-colors"
            >
              {term} <span className="opacity-60">✕</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            value={termDraft}
            onChange={(event) => setTermDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTerms(termDraft);
              }
            }}
            onBlur={() => addTerms(termDraft)}
            placeholder="Go, Postgres, design engineer"
            aria-label="Add stack or role terms"
            maxLength={200}
            className="flex-1 min-w-[200px] bg-control border border-line-control rounded-[7px] text-ink px-[11px] py-[8px] text-[12.5px]"
          />
          <button
            type="button"
            onClick={() => addTerms(termDraft)}
            disabled={termDraft.trim() === ''}
            className="bg-control border border-line-control text-ink-soft rounded-[7px] px-[13px] py-[8px] text-[12.5px] cursor-pointer disabled:opacity-40 disabled:cursor-default hover:border-accent-line-hover hover:text-ink transition-colors"
          >
            Add
          </button>
        </div>
        {profile.terms.length >= MAX_TERMS && (
          <p className="text-[11.5px] text-ink-fainter font-mono m-0 mt-[8px]">
            {MAX_TERMS} terms is the limit — remove one to add another.
          </p>
        )}
      </Field>

      <Field
        label="Work model"
        hint="Pick every model you would take. Nothing selected means no preference."
      >
        <div className="flex gap-2 flex-wrap">
          {WORK_MODELS.map((model) => (
            <Chip
              key={model.value}
              active={profile.remote.includes(model.value)}
              title={model.hint}
              onClick={() => onChange({ ...profile, remote: toggle(profile.remote, model.value) })}
            >
              {model.label}
            </Chip>
          ))}
          {profile.remote.length === 0 && (
            <span className="text-[12.5px] text-ink-fainter font-mono self-center ml-1">
              any model
            </span>
          )}
        </div>
      </Field>

      <Field
        label="Kinds of role"
        hint="Which jobs appear in the Open roles view. Nothing selected shows every role a company has open — including the ones that are not engineering."
      >
        <div className="flex gap-2 flex-wrap">
          {ROLE_CHOICES.map((discipline) => (
            <Chip
              key={discipline}
              active={profile.disciplines.includes(discipline)}
              title={
                (TECHNICAL as readonly string[]).includes(discipline)
                  ? undefined
                  : 'Not a software engineering role'
              }
              onClick={() =>
                onChange({ ...profile, disciplines: toggle(profile.disciplines, discipline) })
              }
            >
              {DISCIPLINE_LABELS[discipline]}
            </Chip>
          ))}
        </div>
        <p className="text-[11.5px] text-ink-fainter m-0 mt-[9px] text-pretty leading-[1.5]">
          {profile.disciplines.length === 0
            ? 'Showing every kind of role. Pick Engineering to drop the sales, support and recruiting listings.'
            : 'A role is sorted by what its title says it is — a "Sales Engineer" counts as sales, a "Salesforce Developer" counts as engineering. Titles too ambiguous to place are left out of these buckets rather than guessed into one.'}
        </p>
      </Field>

      <Field
        label="Company location"
        hint="Anywhere by default. Add countries to narrow it — you can pick several."
      >
        <div className="flex gap-[6px] flex-wrap mb-[10px]">
          {profile.countries.length === 0 && (
            <span className="text-[12.5px] text-ink-fainter font-mono">anywhere</span>
          )}
          {profile.countries.map((country) => (
            <button
              key={country}
              type="button"
              onClick={() =>
                onChange({
                  ...profile,
                  countries: profile.countries.filter((c) => c !== country),
                })
              }
              className="flex items-center gap-[6px] bg-accent-surface border border-accent-line text-accent-text rounded-[20px] px-[10px] py-[4px] text-[12px] cursor-pointer font-mono hover:bg-accent-surface-strong transition-colors"
            >
              {country} <span className="opacity-60">✕</span>
            </button>
          ))}
        </div>
        <select
          value=""
          onChange={(event) => {
            const value = event.target.value;
            if (value === '' || profile.countries.includes(value)) return;
            onChange({ ...profile, countries: [...profile.countries, value] });
          }}
          aria-label="Add a country"
          className="bg-surface border border-line-strong rounded-[8px] text-ink-soft px-[11px] py-2 text-[12.5px] cursor-pointer appearance-none min-w-[180px]"
        >
          <option value="">Add a country…</option>
          {countries
            .filter((country) => !profile.countries.includes(country))
            .map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
        </select>
      </Field>

      <Field
        label="Company size"
        hint="Headcount bands you would consider. Nothing selected means any size."
      >
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(SIZE_BANDS) as SizeBandKey[]).map((band) => (
            <Chip
              key={band}
              active={profile.sizes.includes(band)}
              onClick={() => onChange({ ...profile, sizes: toggle(profile.sizes, band) })}
            >
              {SIZE_BANDS[band].label}
            </Chip>
          ))}
          {profile.sizes.length === 0 && (
            <span className="text-[12.5px] text-ink-fainter font-mono self-center ml-1">
              any size
            </span>
          )}
        </div>
      </Field>

      <Field
        label="Unconfirmed details"
        hint="Much of this directory has fields nobody could confirm. Decide whether those companies still count as a match for you."
      >
        <div className="flex gap-2 flex-wrap">
          <Chip
            active={profile.includeUnknown}
            onClick={() => onChange({ ...profile, includeUnknown: true })}
          >
            Include them
          </Chip>
          <Chip
            active={!profile.includeUnknown}
            onClick={() => onChange({ ...profile, includeUnknown: false })}
          >
            Only confirmed matches
          </Chip>
        </div>
        <p className="text-[11.5px] text-ink-fainter m-0 mt-[9px] text-pretty leading-[1.5]">
          {profile.includeUnknown
            ? 'A company with no recorded work model will still appear when you filter by one. It is never shown as matching — only as not ruled out.'
            : 'Strict: a company has to have the value recorded to appear. You will see fewer companies, and the count of what was set aside.'}
        </p>
      </Field>
    </div>
  );
}
