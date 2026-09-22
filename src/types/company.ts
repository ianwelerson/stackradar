/**
 * Domain types for the company directory.
 *
 * Nullability is deliberate and load-bearing: size, location, remote policy and
 * verification date are genuinely unknown for a large share of the dataset, and
 * the app is required to show that honestly rather than guess. Every consumer
 * must handle null — see `docs` in the spec, §1 and §3.
 */

export type RemotePolicy = 'remote' | 'hybrid' | 'onsite';

export interface Opening {
  readonly title: string;
  readonly url: string | null;
  /** Where the role is advertised, as the job board states it. */
  readonly location: string | null;
  /** ISO date. Null when the posting date could not be determined. */
  readonly postedDate: string | null;
  readonly detectedKeywords: readonly string[];
  /**
   * How and where the role can be done, one slot per place the posting names.
   * See WorkplaceSlot. Empty when the posting gave no location at all, in which
   * case the company's own recorded policy stands in.
   */
  readonly workplace: readonly WorkplaceSlot[];
}

/**
 * One place a role is offered, and in what mode.
 *
 * `mode` is only asserted when the posting states it; 'unknown' means a place
 * was named without a work model, and the company's policy resolves it.
 * `where` holds canonical country names and region keys ('worldwide', 'europe',
 * 'americas'…); empty means not stated, which is never the same as anywhere.
 */
export interface WorkplaceSlot {
  readonly mode: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  readonly where: readonly string[];
}

export interface HistoryEntry {
  /** ISO date of the Monday of that week. */
  readonly weekOf: string;
  readonly openCount: number;
  readonly keywordCounts: Readonly<Record<string, number>>;
}

export interface Company {
  readonly id: string;
  readonly name: string;
  readonly logoUrl: string | null;
  readonly description: string;
  readonly website: string | null;
  readonly careersUrl: string | null;
  /**
   * The company's own LinkedIn page, taken from a link it publishes on its own
   * site. LinkedIn is never fetched — its robots.txt prohibits automated
   * access — so this is a link out for the reader, never a source of data.
   */
  readonly linkedinUrl: string | null;
  /** Original free-text size from research, preserved verbatim for display. */
  readonly sizeRange: string | null;
  readonly sizeMin: number | null;
  readonly sizeMax: number | null;
  readonly hqLocation: string | null;
  /** Normalized country name, used to build the location filter. */
  readonly country: string | null;
  readonly remotePolicy: RemotePolicy | null;
  readonly remoteRegions: readonly string[];
  readonly keywords: readonly string[];
  readonly currentOpenings: readonly Opening[];
  /**
   * What the company's job board listed before de-duplication and the
   * per-company cap. Larger than `currentOpenings.length` means the stored list
   * is a sample, and the UI says so. Null when never scanned.
   */
  readonly openingsTotal: number | null;
  /** Append-only weekly scan log. Empty until the update script has run. */
  readonly history: readonly HistoryEntry[];
  /** ISO datetime, or null when never verified against a primary source. */
  readonly lastVerified: string | null;
  /** Research caveat shown in the UI as an honesty note. */
  readonly dataNotes: string | null;
}

export interface CompanyDataset {
  readonly generatedAt: string;
  readonly companies: readonly Company[];
}

export type VerificationState = 'fresh' | 'stale' | 'unverified';
