import { Link } from 'react-router-dom';
import { companies, generatedAt, totalOpenings, verifiedCount } from '@/lib/dataset';
import { directoryHref } from '@/lib/return-to';
import { POSITION_CAP } from '@/lib/format';

/**
 * How the data is gathered, in the reader's own interest.
 *
 * Every figure here is counted from the dataset at render time rather than
 * typed in. A methodology page that quietly goes stale is worse than none: it
 * is the one page whose whole value is that you can check it against the thing
 * it describes.
 *
 * Built from the same primitives as the rest of the app — the hairline grid
 * from the company meta block, the left-rule callout from a research note, the
 * mono micro-labels — so it reads as part of the directory rather than a
 * document bolted onto it.
 */

const SOURCES: readonly { name: string; kind: string; note: string }[] = [
  {
    name: 'Work at a Startup',
    kind: "Y Combinator's job board",
    note: 'Companies hiring engineers today, with their own site and team size. For YC startups with no board of their own, it is also where the roles come from.',
  },
  {
    name: 'Y Combinator directory',
    kind: 'public company list',
    note: 'Every company YC has funded, hiring or not. Carries headcount and a remote / partly-remote flag.',
  },
  {
    name: 'Hacker News',
    kind: '“Ask HN: Who is hiring?”',
    note: 'The monthly thread, read through the public Algolia API. The main route to remote-friendly startups that appear in no directory.',
  },
  {
    name: 'We Work Remotely',
    kind: 'RSS category feeds',
    note: 'Remote-first companies. Only postings that link the employer’s own domain are used — about a third — because a link into an aggregator is not a link to the company.',
  },
  {
    name: 'Curated list',
    kind: 'added by hand',
    note: 'For ecosystems with no machine-readable directory. All Estonian coverage arrives this way: Startup Estonia publishes its database behind a bot challenge that blocks every automated request.',
  },
];

function SectionHead({ title, aside }: { readonly title: string; readonly aside?: string }) {
  return (
    <div className="flex items-baseline gap-[9px] mb-3 mt-9 first:mt-0">
      <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
      {aside !== undefined && (
        <span className="font-mono text-[11.5px] text-ink-faint">{aside}</span>
      )}
    </div>
  );
}

function Panel({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-line rounded-[10px] px-[15px] py-[14px] flex flex-col gap-[11px] text-[12.5px] text-ink-dim leading-[1.6] text-pretty">
      {children}
    </div>
  );
}

export function MethodologyPage() {
  const openings = companies.flatMap((c) => c.currentOpenings);
  const withLink = openings.filter((o) => o.url !== null).length;
  const withBoard = companies.filter((c) => c.currentOpenings.length > 0).length;
  const unknownCountry = companies.filter((c) => c.country === null).length;
  const unknownRemote = companies.filter((c) => c.remotePolicy === null).length;

  const stats: { key: string; value: string }[] = [
    { key: 'Companies', value: String(companies.length) },
    { key: 'Open positions', value: String(totalOpenings) },
    {
      key: 'Checked on a board',
      value: `${Math.round((verifiedCount / companies.length) * 100)}%`,
    },
    { key: 'Last updated', value: new Date(generatedAt).toISOString().slice(0, 10) },
  ];

  return (
    <main className="max-w-[1180px] mx-auto px-5 pt-[22px] pb-20 animate-[sp-in_.26s_ease_both]">
      <Link
        to={directoryHref()}
        className="inline-block text-ink-dim text-[12.5px] py-1 mb-[18px] font-mono no-underline hover:text-ink"
      >
        ← all companies
      </Link>

      <div className="mb-[22px]">
        <h1 className="m-0 text-[25px] font-semibold tracking-[-0.02em]">
          Where this data comes from
        </h1>
        <p className="text-ink-muted text-[14px] mt-[6px] max-w-[62ch] text-pretty m-0">
          A directory of companies and the engineering roles they have open. This page is how each
          part of it is gathered, what the gaps mean, and where to take the whole thing as one file.
        </p>
      </div>

      <div className="grid gap-px grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] bg-line border border-line rounded-[11px] overflow-hidden mb-[26px]">
        {stats.map((cell) => (
          <div key={cell.key} className="bg-surface px-[15px] py-[13px]">
            <div className="font-mono text-[10.5px] text-ink-faint uppercase tracking-[0.06em]">
              {cell.key}
            </div>
            <div className="text-[13.5px] mt-[5px] text-ink-soft">{cell.value}</div>
          </div>
        ))}
      </div>

      <div className="border-l-2 border-stale-line bg-surface-alt rounded-r-[8px] px-[14px] py-[11px] mb-[26px] text-[12.5px] text-ink-muted leading-[1.55] text-pretty">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-stale-text mr-2">
          the rule
        </span>
        A missing value is fine; a wrong one is not. Every field shown as unknown is a field nobody
        could confirm — an office in Tallinn is not evidence about whether a company hires
        remotely, so its work model stays empty until the company says so. Right now that is{' '}
        {unknownRemote} companies with no confirmed work model and {unknownCountry} with no
        confirmed country, and filtering sets them aside rather than guessing which way they fall.
      </div>

      <SectionHead title="Where companies come from" aside={`${SOURCES.length} sources`} />
      <div className="flex flex-col gap-px bg-line border border-line rounded-[10px] overflow-hidden">
        {SOURCES.map((source) => (
          <div key={source.name} className="bg-surface px-[15px] py-[13px]">
            <div className="flex items-baseline gap-[9px] flex-wrap">
              <span className="text-[13.5px] font-medium text-ink-strong">{source.name}</span>
              <span className="font-mono text-[11px] text-ink-dimmer">{source.kind}</span>
            </div>
            <p className="text-[12.5px] text-ink-dim leading-[1.55] mt-[5px] text-pretty m-0">
              {source.note}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[12.5px] text-ink-faint leading-[1.55] mt-[10px] max-w-[62ch] text-pretty">
        Each source supplies a company name and its own domain — never the jobs. The roles are then
        read from that company&rsquo;s own job board.
      </p>

      <SectionHead title="How the open roles are collected" aside={`${withLink} of ${totalOpenings} link the exact role`} />
      <Panel>
        <p className="m-0">
          Job boards with a public API are read directly — Ashby, Greenhouse, Lever, Workable,
          Personio, Recruitee, SmartRecruiters, BambooHR and Teamtailor. That is what lets a listing
          link <strong className="text-ink-soft">the exact role</strong> instead of a careers page
          you then have to search. The rest are roles a company named without linking individually.
        </p>
        <p className="m-0">
          {withBoard} of {companies.length} companies have a board that can be read this way. The
          rest publish nothing machine-readable, and their records stay thinner for it — the single
          biggest limit on this directory.
        </p>
        <p className="m-0">
          Boards are sampled, not copied whole: at most {POSITION_CAP} roles per company are stored,
          and one that hit the ceiling shows{' '}
          <span className="font-mono text-[12px] text-ink-soft">{POSITION_CAP}+ roles open</span>{' '}
          rather than passing a sample off as the full list. Postings that invite a CV rather than
          name a role are left out.
        </p>
        <p className="m-0">
          Each role&rsquo;s location is read into where, and in what mode, it can be done.
          &ldquo;Remote - US&rdquo; is remote for people in the United States; &ldquo;Home based -
          EMEA&rdquo; is remote across Europe, the Middle East and Africa. That is what the location
          filter matches against — where <em>you</em> can work from — so a remote role closed to
          your country is not shown as one you can take. A work model is only recorded when the
          posting states it, and a plain &ldquo;Remote&rdquo; that never says who may apply is
          marked not confirmed rather than read as worldwide.
        </p>
        <p className="m-0">
          A scan that fails changes nothing. An unreachable careers page is indistinguishable from a
          company that stopped hiring, so a failed read leaves the record exactly as it was — still
          showing its age.
        </p>
      </Panel>

      <SectionHead title="What is deliberately not done" />
      <Panel>
        <p className="m-0">
          <strong className="text-ink-soft">LinkedIn is never fetched.</strong> Its robots.txt
          prohibits automated access, so no company data here comes from it. Where a LinkedIn link
          appears, it was taken from a link that company publishes on its own site — a link out for
          you, not a source for us.
        </p>
        <p className="m-0">
          <strong className="text-ink-soft">Companies never see your visit.</strong> Logos are
          stored here rather than hot-linked, so reading the directory does not disclose your
          address to every company in it. Page views are counted with Vercel Web Analytics, which
          sets no cookies, and anything you track stays in your own browser or your own database.
        </p>
      </Panel>

      <SectionHead title="Take the data" aside="one static file" />
      <Panel>
        <p className="m-0">
          The whole dataset — every company, every open role, every weekly count — with no key and
          no rate limit.
        </p>
        <p className="m-0">
          <a
            href="/companies.json"
            target="_blank"
            rel="noopener"
            className="text-accent-link hover:text-accent-link-hover no-underline font-mono text-[12.5px]"
          >
            /companies.json ↗
          </a>
        </p>
        <p className="m-0 text-ink-faint">
          Each record carries its own <span className="font-mono text-[12px]">lastVerified</span>{' '}
          date and <span className="font-mono text-[12px]">dataNotes</span>, so you can see when a
          fact was established and what caveat came with it. Fields nobody confirmed are{' '}
          <span className="font-mono text-[12px]">null</span> — please keep them that way.
        </p>
      </Panel>
    </main>
  );
}
