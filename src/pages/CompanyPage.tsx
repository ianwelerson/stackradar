import { useMemo, useRef, useState, useId } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCompany } from '@/lib/dataset';
import { useTracking } from '@/hooks/useTracking';
import { CompanyTile } from '@/components/CompanyTile';
import { VerificationBadge } from '@/components/VerificationBadge';
import { StatusMenu } from '@/components/StatusMenu';
import { HiringHistory } from '@/components/HiringHistory';
import { PositionsList, CategoryPills } from '@/components/PositionsList';
import { Modal } from '@/components/Modal';
import { NotFoundPage } from './NotFoundPage';
import { ALL_ROLES, categoriesOf, categorizeAll } from '@/lib/categorize';
import { displayHost, safeExternalUrl } from '@/lib/safe-url';
import { remotePolicyLabel, sizeLabel } from '@/lib/format';
import { MAX_NOTE_LENGTH } from '@/types/tracking';

const VISIBLE_POSITIONS = 5;

export function CompanyPage({ onOpenStorage }: { readonly onOpenStorage: () => void }) {
  const { id } = useParams<{ id: string }>();
  const company = id !== undefined ? getCompany(id) : undefined;

  const { tracking, setStatus, setNote, connected, syncState, syncError } = useTracking();
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState(ALL_ROLES);
  const [allOpen, setAllOpen] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const modalTitleId = useId();

  const openings = useMemo(
    () => categorizeAll(company?.currentOpenings ?? []),
    [company],
  );

  if (company === undefined) return <NotFoundPage />;

  const status = tracking.statuses[company.id];
  const note = tracking.notes[company.id] ?? '';

  const categories = categoriesOf(openings);
  const activeCategory = categories.includes(category) ? category : ALL_ROLES;
  const counts: Record<string, number> = { [ALL_ROLES]: openings.length };
  for (const opening of openings) {
    counts[opening.category] = (counts[opening.category] ?? 0) + 1;
  }
  const matched =
    activeCategory === ALL_ROLES
      ? openings
      : openings.filter((o) => o.category === activeCategory);
  const visible = matched.slice(0, VISIBLE_POSITIONS);

  const website = safeExternalUrl(company.website);
  const careers = safeExternalUrl(company.careersUrl);
  const host = displayHost(company.website);

  // hqLocation holds the raw research string, which is often a work-model
  // description rather than a place. The meta grid therefore shows the
  // normalized country, and the raw string is surfaced separately as a note.
  const locationNote =
    company.hqLocation !== null && company.hqLocation !== company.country
      ? company.hqLocation
      : null;

  const meta: { key: string; value: string; muted: boolean }[] = [
    { key: 'Team size', value: sizeLabel(company), muted: company.sizeMin === null },
    { key: 'Country', value: company.country ?? 'Not recorded', muted: company.country === null },
    {
      key: 'Work model',
      value:
        remotePolicyLabel(company.remotePolicy) +
        (company.remoteRegions.length > 0 ? ` · ${company.remoteRegions.join(', ')}` : ''),
      muted: company.remotePolicy === null,
    },
    {
      key: 'Keywords',
      value: company.keywords.length > 0 ? company.keywords.join(', ') : 'None recorded',
      muted: company.keywords.length === 0,
    },
  ];

  return (
    <main className="max-w-[1000px] mx-auto px-5 pt-[22px] pb-20 animate-[sp-in_.26s_ease_both]">
      <Link
        to="/"
        className="inline-block text-ink-dim text-[12.5px] py-1 mb-[18px] font-mono no-underline hover:text-ink"
      >
        ← all companies
      </Link>

      <div className="flex gap-4 items-start flex-wrap mb-[22px]">
        <CompanyTile
          id={company.id}
          name={company.name}
          logoUrl={company.logoUrl}
          size="lg"
        />
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-[10px] flex-wrap">
            <h1 className="m-0 text-[25px] font-semibold tracking-[-0.02em]">{company.name}</h1>
            <VerificationBadge company={company} />
          </div>
          <p className="text-ink-muted text-[14px] mt-[6px] max-w-[560px] text-pretty m-0">
            {company.description}
          </p>
          <div className="flex gap-[14px] mt-[10px] text-[12.5px] font-mono flex-wrap">
            {website !== null && (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-link hover:text-accent-link-hover no-underline"
              >
                {host} ↗
              </a>
            )}
            {careers !== null && (
              <a
                href={careers}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-link hover:text-accent-link-hover no-underline"
              >
                careers page ↗
              </a>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap items-start">
          <button
            type="button"
            onClick={() => setStatus(company.id, status !== undefined ? null : 'Tracked')}
            className="flex items-center gap-[7px] rounded-[8px] px-[13px] py-[9px] text-[12.5px] cursor-pointer whitespace-nowrap border transition-colors"
            style={
              status !== undefined
                ? {
                    background: 'var(--color-status-tracked-bg)',
                    borderColor: 'var(--color-status-tracked-line)',
                    color: 'var(--color-status-tracked-text)',
                  }
                : {
                    background: 'var(--color-control)',
                    borderColor: 'var(--color-line-control)',
                    color: 'var(--color-ink-soft)',
                  }
            }
          >
            <span className="text-[12px] opacity-90">{status !== undefined ? '✓' : '+'}</span>
            {status !== undefined ? 'Tracking' : 'Track'}
          </button>

          <StatusMenu
            current={status}
            open={menuOpen}
            onToggle={() => setMenuOpen((v) => !v)}
            onClose={() => setMenuOpen(false)}
            onSelect={(next) => {
              setStatus(company.id, next);
              setMenuOpen(false);
            }}
          />

          <button
            type="button"
            onClick={() => {
              if (status === undefined) setStatus(company.id, 'Tracked');
              noteRef.current?.focus();
              noteRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }}
            className="flex items-center gap-[7px] rounded-[8px] px-[13px] py-[9px] text-[12.5px] cursor-pointer bg-control border border-line-control text-ink-soft whitespace-nowrap hover:border-accent-line-hover hover:text-ink transition-colors"
          >
            <span className="text-[12px] opacity-90">✎</span>
            {note.trim() !== '' ? 'Edit note' : 'Add note'}
          </button>
        </div>
      </div>

      {company.dataNotes !== null && (
        <div className="border-l-2 border-stale-line bg-surface-alt rounded-r-[8px] px-[14px] py-[11px] mb-[22px] text-[12.5px] text-ink-muted leading-[1.55] text-pretty">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-stale-text mr-2">
            research note
          </span>
          {company.dataNotes}
        </div>
      )}

      <div className="grid gap-px grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] bg-line border border-line rounded-[11px] overflow-hidden mb-[26px]">
        {meta.map((cell) => (
          <div key={cell.key} className="bg-surface px-[15px] py-[13px]">
            <div className="font-mono text-[10.5px] text-ink-faint uppercase tracking-[0.06em]">
              {cell.key}
            </div>
            <div
              className={`text-[13.5px] mt-[5px] ${cell.muted ? 'text-ink-fainter' : 'text-ink-soft'}`}
            >
              {cell.value}
            </div>
          </div>
        ))}
      </div>

      {locationNote !== null && (
        <p className="text-[12.5px] text-ink-dim -mt-[14px] mb-[26px] text-pretty">
          <span className="font-mono text-[11px] text-ink-faint">location as researched: </span>
          {locationNote}
        </p>
      )}

      <div className="grid gap-[26px] grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-start">
        <section>
          <div className="flex items-baseline gap-[9px] mb-3">
            <h2 className="m-0 text-[15px] font-semibold">Open positions</h2>
            <span className="font-mono text-[11.5px] text-ink-faint">
              {openings.length === 0
                ? 'none recorded'
                : activeCategory === ALL_ROLES
                  ? // A big board is sampled rather than stored whole, so say so
                    // instead of presenting the sample as the full picture.
                    company.openingsTotal !== null && company.openingsTotal > openings.length
                    ? `${openings.length} of ${company.openingsTotal} listed`
                    : `${openings.length} open`
                  : `${matched.length} of ${openings.length} open`}
            </span>
          </div>

          {openings.length > 3 && (
            <div className="mb-[10px]">
              <CategoryPills
                categories={categories}
                active={activeCategory}
                counts={counts}
                onSelect={setCategory}
              />
            </div>
          )}

          {matched.length > 0 ? (
            <>
              <PositionsList openings={visible} careersUrl={company.careersUrl} />
              {matched.length > VISIBLE_POSITIONS && (
                <button
                  type="button"
                  onClick={() => setAllOpen(true)}
                  className="mt-[10px] w-full bg-control-alt border border-line-strong text-ink-soft rounded-[8px] px-3 py-[9px] text-[12.5px] cursor-pointer font-mono hover:border-accent-line-hover hover:text-ink transition-colors"
                >
                  View all {matched.length} positions
                </button>
              )}
            </>
          ) : (
            <div className="border border-dashed border-line-control rounded-[10px] p-5 text-ink-dim text-[13px] text-pretty">
              {openings.length > 0
                ? `No ${activeCategory.toLowerCase()} open here right now — they have ${openings.length} other role${openings.length === 1 ? '' : 's'} listed.`
                : company.lastVerified === null
                  ? 'This company has never been checked against its own careers page, so no roles are recorded yet. Use the careers link above for the live picture.'
                  : 'Nothing was open when this company was last checked. The careers link above has the live picture.'}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-baseline gap-[9px] mb-3">
            <h2 className="m-0 text-[15px] font-semibold">Hiring history</h2>
            <span className="font-mono text-[11.5px] text-ink-faint">
              {company.history.length > 0 ? `${company.history.length} weeks tracked` : 'not started'}
            </span>
          </div>
          <HiringHistory company={company} />
        </section>
      </div>

      <section className="mt-7">
        <div className="flex items-baseline gap-[9px] mb-3 flex-wrap">
          <h2 className="m-0 text-[15px] font-semibold">Your notes</h2>
          <span className="font-mono text-[11.5px] text-ink-faint">
            {connected
              ? syncState === 'syncing'
                ? 'saving…'
                : syncState === 'saved'
                  ? 'saved to your database'
                  : syncState === 'error'
                    ? 'sync failed — saved in this browser'
                    : 'synced to your database'
              : 'saved in this browser only'}
          </span>
        </div>

        <textarea
          ref={noteRef}
          value={note}
          maxLength={MAX_NOTE_LENGTH}
          onChange={(event) => setNote(company.id, event.target.value)}
          placeholder="What caught your eye here? Who you spoke to, what to ask about, where you saw the role."
          className="w-full min-h-[92px] bg-surface border border-line-strong rounded-[10px] px-[14px] py-3 text-ink-soft text-[13.5px] leading-[1.55] focus:border-accent-bar"
        />

        {syncError !== null && (
          <div role="alert" className="mt-2 text-[12px] text-danger-bright font-mono">
            {syncError}
          </div>
        )}

        {!connected && (
          <p className="mt-2 text-[12.5px] text-ink-dim text-pretty m-0">
            Notes stay in this browser.{' '}
            <button
              type="button"
              onClick={onOpenStorage}
              className="bg-transparent border-none p-0 text-accent-link cursor-pointer underline text-[12.5px]"
            >
              Connect your own database
            </button>{' '}
            to keep them across visits and devices.
          </p>
        )}
      </section>

      <Modal
        open={allOpen}
        onClose={() => setAllOpen(false)}
        labelledBy={modalTitleId}
        maxWidth={640}
      >
        <div className="px-5 pt-[18px] pb-[14px] border-b border-line flex flex-col gap-[13px] flex-none">
          <div className="flex items-start gap-3">
            <CompanyTile
              id={company.id}
              name={company.name}
              logoUrl={company.logoUrl}
              size="sm"
            />
            <div className="flex-1 min-w-0">
              <h2 id={modalTitleId} className="text-[15.5px] font-semibold tracking-[-0.01em] m-0">
                {company.name} — all open positions
              </h2>
              <p className="font-mono text-[11px] text-ink-dimmer mt-[3px] m-0">
                {matched.length} {activeCategory === ALL_ROLES ? 'open' : `in ${activeCategory.toLowerCase()}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAllOpen(false)}
              aria-label="Close"
              className="bg-transparent border-none text-ink-faint text-[15px] cursor-pointer px-1 py-[2px] hover:text-ink-strong"
            >
              ✕
            </button>
          </div>
          <CategoryPills
            categories={categories}
            active={activeCategory}
            counts={counts}
            onSelect={setCategory}
          />
        </div>
        <div className="overflow-auto scrollbar-thin px-5 pt-[14px] pb-5">
          <PositionsList openings={matched} careersUrl={company.careersUrl} variant="modal" />
        </div>
      </Modal>
    </main>
  );
}
