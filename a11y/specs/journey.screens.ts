/**
 * The screens the accessibility journey covers — the single source of truth.
 *
 * Imported by **both** `journey.a11y.spec.ts` (which declares one test per screen) and
 * `../playwright.config.ts` (which declares one project per screen). Adding a screen is one
 * edit here plus one `journeyTest()` call in the spec; nothing else needs touching, including
 * `package.json`, because `a11y:scan -- journey` selects projects with a `journey-*` wildcard.
 *
 * ## Why this file exists rather than three parallel lists
 *
 * Before it, a screen's identity was written out three times — a tag in the test title, a
 * `grep` regex in the config, and a project name — and nothing tied them together. That is a
 * silent failure, not a noisy one, and it was measured rather than assumed:
 *
 *     a fifth project declared with grep /@journey-serach/ (a typo for "search")
 *     → Total: 4 tests in 1 file        exit: 0
 *
 * Playwright reports "No tests found" only when the *whole run* is empty. A single project
 * matching nothing, alongside projects that match, is dropped without a warning — so a screen
 * added with a mistyped tag would simply never be scanned while the command stayed green.
 *
 * Two mechanisms close that, and between them every way of getting it wrong is loud:
 *
 *   - `JourneyScreenId` is a literal union, so `journeyTag('logn')` is a **compile error**;
 *   - the spec asserts at module scope that every id in `JOURNEY_SCREENS` was declared, so an
 *     id added here with no matching test is a **collection error** in every project.
 */

/**
 * One screen. `id` is the whole contract: it produces the project name, the test tag and the
 * report name, so those three can never disagree.
 */
export interface JourneyScreen {
  readonly id: JourneyScreenId;
  /** Human label, used in the test title and the console summary. */
  readonly label: string;
  /**
   * `false` only for the sign-in form, which needs `httpCredentials` removed.
   *
   * With credentials set, Playwright answers the Basic auth challenge on the app's anonymous
   * `/nuxeo/api/v1/me` hydration probe, the app builds a session from the reply, and
   * `authGuard` forwards `/` to the dashboard — so the sign-in form is unreachable. The first
   * run of this suite scanned the dashboard because of it.
   */
  readonly authenticated: boolean;
}

/**
 * Order is the journey order, and it is also the report order — `journeyProjectName()` numbers
 * from this array rather than from a hardcoded prefix, so inserting a screen in the middle does
 * not require renaming the ones after it.
 */
export const JOURNEY_SCREENS = [
  { id: 'login', label: 'login screen', authenticated: false },
  { id: 'dashboard', label: 'dashboard screen', authenticated: true },
  { id: 'browse', label: 'browse screen', authenticated: true },
  { id: 'document-detail', label: 'document detail screen', authenticated: true },
  {
    id: 'document-detail-more-actions',
    label: 'document detail More actions focus',
    authenticated: true,
  },
  // Core flows: finding and returning to content.
  { id: 'search', label: 'search results screen', authenticated: true },
  { id: 'documents', label: 'documents (assets) screen', authenticated: true },
  { id: 'collection', label: 'collection screen', authenticated: true },
  { id: 'favorites', label: 'favorites panel', authenticated: true },
  { id: 'recently-viewed', label: 'recently viewed panel', authenticated: true },
  { id: 'personal-space', label: 'personal space screen', authenticated: true },
  { id: 'clipboard', label: 'clipboard panel', authenticated: true },
  // Work screens: what a user acts on rather than reads.
  { id: 'tasks', label: 'tasks screen', authenticated: true },
  { id: 'expired-queue', label: 'expired queue panel', authenticated: true },
  { id: 'trash', label: 'trash screen', authenticated: true },
  { id: 'administration', label: 'administration screen', authenticated: true },
] as const satisfies ReadonlyArray<Omit<JourneyScreen, 'id'> & { id: string }>;

/** Every screen id, as a literal union — a mistyped id is a compile error, not a silent skip. */
export type JourneyScreenId = (typeof JOURNEY_SCREENS)[number]['id'];

/**
 * The Playwright project name for a screen.
 *
 * Numbered from the array index so `--project="journey-*"` lists them in journey order, which
 * is the order someone reads the reports in. Zero-padded because the reports directory sorts
 * by name, and unpadded `journey-10-…` lists before `journey-2-…` once there are ten screens.
 */
export function journeyProjectName(id: JourneyScreenId): string {
  const index = JOURNEY_SCREENS.findIndex((s) => s.id === id);
  return `journey-${String(index + 1).padStart(2, '0')}-${id}`;
}

/** The tag that appears in the test title and that the project's `grep` matches. */
export function journeyTag(id: JourneyScreenId): string {
  return `@journey-${id}`;
}

/** The report directory slug, so a screen's report is named the same as its project. */
export function journeyReportName(id: JourneyScreenId): string {
  return journeyProjectName(id);
}
