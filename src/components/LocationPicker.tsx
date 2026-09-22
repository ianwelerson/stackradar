import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { COUNTRIES } from '@/lib/regions';
import { locationLabel } from '@/lib/format';
import { ANYWHERE } from '@/types/filters';

/**
 * Where you can work from.
 *
 * This replaced a single-choice "company location" select, and the change is
 * one of meaning, not just of widget. The question a location filter can
 * usefully answer for someone applying is not "where is this company's head
 * office" but "which of its roles could I actually do from here" — a remote
 * role open only to US residents is no use to someone in Tallinn, however
 * remote it is. So the choice is plural (people can often work from more than
 * one country) and it is matched against each role's own stated availability.
 *
 * Two different answers were once both called "Anywhere":
 *
 *   - *Any location* — I have not said where I am. No location filter runs, and
 *     a role open only to Berlin is still listed.
 *   - *Anywhere* — I am not tied to a country. Only roles the employer opened
 *     to the whole world qualify, which is a **narrowing**: today 89 of the
 *     1,847 roles that say remote, and none of the ones scoped to a country or
 *     a region, however permissive that region is.
 *
 * Sharing one label made the second unreachable and the first a lie, since
 * "Anywhere" listed roles you could take from exactly one country. They are now
 * two choices, exclusive with each other and with the country list — picking a
 * country is itself a statement that you are tied to somewhere, and it already
 * admits worldwide roles, since those are open to that country too.
 *
 * Every country is offered, not only the ones companies here are based in: a
 * reader in Portugal can take a role open to "Europe" from a company in
 * Estonia, and should be able to say so.
 */
export function LocationPicker({
  value,
  onChange,
  className = '',
  align = 'start',
}: {
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly className?: string;
  readonly align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = useMemo(() => new Set(value), [value]);

  // Chosen countries stay pinned at the top, so what is selected is always
  // visible without scrolling a list of 250 places to find it.
  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle === '' ? COUNTRIES : COUNTRIES.filter((c) => c.toLowerCase().includes(needle));
    const chosen = matches.filter((c) => selected.has(c));
    const rest = matches.filter((c) => !selected.has(c));
    return { chosen, rest };
  }, [query, selected]);

  const [first] = value;
  const summary =
    first === undefined
      ? 'Any location'
      : value.length === 1
        ? locationLabel(first)
        : `${locationLabel(first)} +${value.length - 1}`;

  // Choosing a country drops "Anywhere": you cannot both be tied to somewhere
  // and not be, and leaving it in would widen the search back out silently.
  const toggle = (country: string) =>
    onChange(
      selected.has(country)
        ? value.filter((c) => c !== country)
        : [...value.filter((c) => c !== ANYWHERE), country],
    );

  const scope = (label: string, hint: string, checked: boolean, next: string[]) => (
    <label className="flex items-center gap-[9px] px-[10px] py-[7px] rounded-[6px] cursor-pointer text-[12.5px] text-ink-soft hover:bg-control">
      <input
        type="radio"
        name={`${panelId}-scope`}
        checked={checked}
        onChange={() => onChange(next)}
        className="accent-[var(--color-accent)] w-[13px] h-[13px] cursor-pointer"
      />
      <span>
        {label}
        <span className="block font-mono text-[10.5px] text-ink-faint mt-px">{hint}</span>
      </span>
    </label>
  );

  const option = (country: string) => (
    <label
      key={country}
      className="flex items-center gap-[9px] px-[10px] py-[6px] rounded-[6px] cursor-pointer text-[12.5px] text-ink-soft hover:bg-control"
    >
      <input
        type="checkbox"
        checked={selected.has(country)}
        onChange={() => toggle(country)}
        className="accent-[var(--color-accent)] w-[13px] h-[13px] cursor-pointer"
      />
      {country}
    </label>
  );

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Where you can work from: ${summary}`}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 bg-surface border border-line-strong rounded-[8px] text-ink-soft px-[11px] py-2 text-[12.5px] cursor-pointer whitespace-nowrap"
      >
        <span className="flex items-center gap-[7px] min-w-0">
          <span className="font-mono text-[11px] text-ink-faint">from</span>
          <span className="truncate">{summary}</span>
        </span>
        <span className="text-ink-faint text-[10px] leading-none" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Where you can work from"
          className={`absolute z-20 mt-[6px] w-[280px] max-w-[calc(100vw-40px)] bg-tooltip border border-line-tooltip rounded-[10px] shadow-[0_12px_32px_oklch(0.10_0_0/0.55)] p-[6px] flex flex-col gap-[4px] ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {scope('Any location', 'no location filter', value.length === 0, [])}
          {scope('Anywhere', 'only roles open worldwide', selected.has(ANYWHERE), [ANYWHERE])}

          <div className="h-px bg-line mx-[4px] my-[2px]" aria-hidden="true" />

          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search countries"
            aria-label="Search countries"
            className="bg-control border border-line-control rounded-[7px] text-ink px-[10px] py-[7px] text-[12.5px] mx-[2px]"
          />

          <div className="max-h-[260px] overflow-y-auto scrollbar-thin flex flex-col">
            {listed.chosen.map(option)}
            {listed.chosen.length > 0 && listed.rest.length > 0 && (
              <div className="h-px bg-line mx-[4px] my-[4px]" aria-hidden="true" />
            )}
            {listed.rest.map(option)}
            {listed.chosen.length === 0 && listed.rest.length === 0 && (
              <div className="px-[10px] py-[8px] text-[12px] text-ink-faint font-mono">
                no country matches
              </div>
            )}
          </div>

          <p className="font-mono text-[10.5px] text-ink-faint leading-[1.5] m-0 px-[8px] pt-[4px] pb-[2px] text-pretty">
            {selected.has(ANYWHERE)
              ? 'Matched against each role: only postings open to the whole world. A role open to a region — even one as wide as EMEA — is tied to somewhere, so it is not one of them.'
              : 'Matched against each role: a remote role counts only if it is open to one of these countries — or to a region or the world that includes them.'}
          </p>
        </div>
      )}
    </div>
  );
}
