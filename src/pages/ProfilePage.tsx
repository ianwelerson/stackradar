import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { directoryHref } from '@/lib/return-to';
import { companies } from '@/lib/dataset';
import { ProfileEditor } from '@/components/ProfileEditor';
import { BackupPanel } from '@/components/BackupPanel';
import { isProfileEmpty, PROFILE_DIMENSIONS, profileStrength } from '@/types/profile';
import { useTracking } from '@/hooks/useTracking';
import { CompanyTile } from '@/components/CompanyTile';
import { Badge } from '@/components/Badge';
import { STATUSES, STATUS_ICONS, STATUS_TOKENS } from '@/types/tracking';
import { isTruncated, openingsLabel } from '@/lib/format';

export function ProfilePage({ onOpenStorage }: { readonly onOpenStorage: () => void }) {
  const { tracking, connected, failing, syncError, trackedIds, setProfile } = useTracking();

  const rows = useMemo(
    () =>
      trackedIds
        .map((id) => {
          const company = companies.find((c) => c.id === id);
          if (company === undefined) return null;
          const status = tracking.statuses[id];
          if (status === undefined) return null;
          return { company, status, note: tracking.notes[id] ?? '' };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null),
    [trackedIds, tracking],
  );

  const byStatus = STATUSES.map((status) => ({
    status,
    count: rows.filter((row) => row.status === status).length,
  })).filter((entry) => entry.count > 0);

  const withNotes = rows.filter((row) => row.note.trim() !== '').length;

  return (
    <main className="max-w-[1180px] mx-auto px-5 pt-[22px] pb-20 animate-[sp-in_.26s_ease_both]">
      <Link
        to={directoryHref()}
        className="inline-block text-ink-dim text-[12.5px] py-1 mb-[18px] font-mono no-underline hover:text-ink"
      >
        ← all companies
      </Link>

      <div className="flex items-end gap-3 flex-wrap mb-2">
        <h1 className="m-0 text-[24px] font-semibold tracking-[-0.02em]">My profile</h1>
        <span className="font-mono text-[12px] text-ink-dimmer pb-[3px]">
          {profileStrength(tracking.profile)} of {PROFILE_DIMENSIONS} preferences set · {rows.length}{' '}
          {rows.length === 1 ? 'company tracked' : 'companies tracked'} · {withNotes} with notes
        </span>
      </div>

      <div className="flex gap-3 items-center flex-wrap mb-5">
        <span className="flex items-center gap-[7px] text-[12.5px] text-ink-dim text-pretty">
          <span
            className="w-[6px] h-[6px] rounded-full flex-none"
            style={{
              background: failing
                ? 'var(--color-danger-bright)'
                : connected
                  ? 'oklch(0.80 0.15 162)'
                  : 'var(--color-dot-unknown)',
            }}
          />
          {failing
            ? (syncError ?? 'Your database could not be reached.') +
              ' Saved in this browser, but not reaching your database.'
            : connected
              ? 'Synced to your own database — your profile and everything you track.'
              : 'Held in this browser only. Connect your own database to keep your profile and list across visits and devices.'}
        </span>
        <button
          type="button"
          onClick={onOpenStorage}
          className="bg-control border border-line-control text-ink-soft rounded-[7px] px-3 py-[7px] text-[12.5px] cursor-pointer whitespace-nowrap hover:border-accent-line-hover transition-colors"
        >
          {failing ? 'Fix storage' : connected ? 'Storage connected' : 'Connect storage'}
        </button>
      </div>

      <div className="flex items-baseline gap-[9px] mb-3">
        <h2 className="m-0 text-[15px] font-semibold">What I&rsquo;m looking for</h2>
        <span className="font-mono text-[11.5px] text-ink-faint">
          {isProfileEmpty(tracking.profile)
            ? 'the directory opens unfiltered until you set something'
            : 'the directory opens filtered to this'}
        </span>
      </div>
      <div className="mb-8">
        <ProfileEditor profile={tracking.profile} onChange={setProfile} />
      </div>

      <div className="flex items-baseline gap-[9px] mb-3">
        <h2 className="m-0 text-[15px] font-semibold">Companies I&rsquo;m tracking</h2>
        <span className="font-mono text-[11.5px] text-ink-faint">
          {rows.length === 0 ? 'nothing tracked yet' : `${rows.length} with a status`}
        </span>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="flex gap-[6px] flex-wrap mb-[18px]">
            {byStatus.map(({ status, count }) => (
              <Badge
                key={status}
                bg={STATUS_TOKENS[status].bg}
                fg={STATUS_TOKENS[status].fg}
                border={STATUS_TOKENS[status].border}
              >
                {STATUS_ICONS[status]} {status} {count}
              </Badge>
            ))}
          </div>

          <div className="flex flex-col gap-[10px]">
            {rows.map(({ company, status, note }) => (
              <Link
                key={company.id}
                to={`/company/${company.id}`}
                className="bg-card border border-line-card rounded-[11px] px-4 py-[14px] flex flex-col gap-[10px] no-underline text-ink hover:border-accent-line-hover hover:bg-card-hover transition-colors"
              >
                <div className="flex gap-[11px] items-start">
                  <CompanyTile
                    id={company.id}
                    name={company.name}
                    logoUrl={company.logoUrl}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex gap-2 items-center flex-wrap">
                      <span className="font-semibold text-[14.5px]">{company.name}</span>
                      <Badge
                        bg={STATUS_TOKENS[status].bg}
                        fg={STATUS_TOKENS[status].fg}
                        border={STATUS_TOKENS[status].border}
                      >
                        {STATUS_ICONS[status]} {status}
                      </Badge>
                      <span className="font-mono text-[10.5px] text-ink-faint">
                        {openingsLabel(company.currentOpenings.length, isTruncated(company))}
                      </span>
                    </div>
                    <p className="text-ink-dim text-[12.5px] mt-1 text-pretty m-0">
                      {company.description}
                    </p>
                  </div>
                </div>
                {note.trim() !== '' && (
                  <div className="border-l-2 border-accent-line pl-[11px] py-[2px] text-[12.5px] text-ink-muted leading-[1.55] text-pretty whitespace-pre-wrap">
                    {note.length > 240 ? `${note.slice(0, 240)}…` : note}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="border border-dashed border-line-control rounded-[12px] px-6 py-11 text-center flex flex-col items-center gap-[13px]">
          <div className="text-[16px] font-semibold">Nothing tracked yet</div>
          <p className="text-ink-dim text-[13px] max-w-[420px] text-pretty m-0">
            Open a company and set a status — Tracked, Applied, Interviewing — or leave a note.
            Everything you mark shows up here.
          </p>
          <Link
            to="/"
            className="bg-accent text-accent-ink rounded-[7px] px-[15px] py-[9px] text-[12.5px] font-medium no-underline hover:bg-accent-hover transition-colors"
          >
            Browse companies
          </Link>
        </div>
      )}

      <div className="flex items-baseline gap-[9px] mb-3 mt-9">
        <h2 className="m-0 text-[15px] font-semibold">Back up &amp; restore</h2>
        <span className="font-mono text-[11.5px] text-ink-faint">one JSON file</span>
      </div>
      <BackupPanel />
    </main>
  );
}
