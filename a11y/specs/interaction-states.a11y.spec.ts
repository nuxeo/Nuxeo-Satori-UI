import type { Locator, Page } from '@playwright/test';
import { aiFindingsNote, expect, REPORT_DIR, test, waitForScreenSettled } from '../fixtures';

/**
 * WCAG 2.1 AA scan of **interaction states** — surfaces that exist only after a click.
 *
 * ## Why this file exists
 *
 * `surfaces.a11y.spec.ts` and `scripts/beta-harness/steps/phase-6-a11y.mjs` both navigate to a
 * route, wait, and scan.
 * Between them they cover the default, freshly-loaded state of eight routes and nothing else.
 * Every dialog, overlay, secondary tab and alternate view mode in this application has never
 * been looked at by any layer.
 *
 * That is not a theoretical gap. Two measurements say it is where the findings are:
 *
 *   - When `phase-6-a11y.mjs` widened from three surfaces to fifteen cases, the rule classes
 *     found went from four to seven. Three of the extra classes were reachable only in states
 *     a single visit per route never produces — a 3.54:1 contrast failure on `.card-type` was
 *     invisible until a step clicked "Card view".
 *   - `/#/browse` alone declares **four** `mat-tab`s (View, Permissions, History, Trash) and
 *     opens **thirteen** dialogs. Only the View tab has ever been scanned, so three whole tabs
 *     of form fields and tables are unmeasured on a route we already call covered.
 *
 * ## Why each state is scanned at the same URL, and how findings stay attributable
 *
 * The app uses hash routing and these states do not change the hash, so every scan below
 * reports `pageUrl` as `.../#/browse`. The consolidated HTML report therefore cannot tell you
 * which click produced which finding. `scanPage()` returns the slice for that call alone, so
 * this file keeps its own per-state tally and prints it at the end. Read that table, not the
 * report's page grouping, when deciding what to fix.
 *
 * ## Why this is a separate Playwright project
 *
 * The a11y-scout accumulator is a **worker-scoped** fixture, so two spec files sharing a worker
 * share one report — and `surfaces.a11y.spec.ts` asserts its report covers exactly its own
 * surfaces, which a second file appending to the same accumulator would break. Projects get
 * their own workers, so `../playwright.config.ts` declares `surfaces` and `interaction-states`
 * separately and each emits its own report.
 *
 * Run:
 *   npm run a11y:scan -- states
 */

const BROWSE = '/#/browse';

/** The three browse tabs that are reached by a click rather than a route. */
const BROWSE_TABS = ['Permissions', 'History', 'Trash'] as const;

/**
 * Every interaction state this file covers, declared once.
 *
 * The summary used to assert `results.length === 7`. Two things were wrong with that. A
 * literal count contradicts the extension contract in `docs/authoring.md` — an eighth state
 * would scan perfectly well and then fail the report for existing — and a count cannot say
 * *which* state failed to record, which is the only thing worth knowing when one silently
 * skips. Flagged in review on PR #225.
 *
 * Declaring the ids instead buys both: the assertion names the missing state, and because
 * `scanState` takes this union rather than `string`, a mistyped id is a compile error instead
 * of a row that never matches.
 */
type InteractionState =
  | 'browse › column picker dialog'
  | 'browse › type filter select panel'
  | 'browse › date-range calendar'
  | 'browse › card view'
  | `browse › ${(typeof BROWSE_TABS)[number]} tab`;

const INTERACTION_STATES: readonly InteractionState[] = [
  'browse › column picker dialog',
  'browse › type filter select panel',
  'browse › date-range calendar',
  'browse › card view',
  ...BROWSE_TABS.map((tab): InteractionState => `browse › ${tab} tab`),
];

/** What one state's scan produced. Printed as a table by the last test. */
interface StateResult {
  readonly state: InteractionState;
  readonly findings: number;
  readonly blockers: number;
  readonly rules: readonly string[];
  readonly keyboard: boolean;
}

/**
 * Module-scoped on purpose. `workers: 1` and a single project mean every test below runs in
 * this one module instance, which is what lets the summary test see all the rows.
 */
const results: StateResult[] = [];

/**
 * Navigate to browse and prove the repository answered.
 *
 * `toBeVisible()` on `lib-browse` is not enough: an unauthenticated or failed load renders the
 * same component with an error panel, which is visible and would let every scan below report a
 * clean overlay that never opened. Asserting a real row is what ties the scan to real content —
 * the route-specific evidence `expectSurfaceUsable` in `../fixtures` defers to where it exists.
 *
 * Every scan below covers the whole page, drawer included, so the folder tree has to be settled
 * too — see `waitForScreenSettled` for what a mid-load tree does to the findings.
 */
async function openBrowse(page: Page): Promise<void> {
  await page.goto(BROWSE, { waitUntil: 'networkidle' });
  await expect(page.locator('lib-browse'), 'lib-browse must render').toBeVisible();
  await expect(
    page.locator('.browse-row, .card-grid .card-outlet').first(),
    'browse must show at least one document, or every state below scans an empty page',
  ).toBeVisible();
  await waitForScreenSettled(page, 'lib-browse', true);
}

/**
 * Enter a state and prove it was entered.
 *
 * The failure this guards against is specific and has already shipped here once: a `.click()`
 * on a control that is absent resolves without error, the scan runs against the page behind it,
 * and a step labelled "column picker" reports the list view as clean. `phase-6-a11y.mjs` warns
 * and continues in that case; this throws, because an unscanned state should never be able to
 * masquerade as a passing one.
 */
async function enterState(name: string, trigger: Locator, evidence: Locator): Promise<void> {
  await expect(
    trigger,
    `"${name}": the trigger is not present, so the state is unreachable`,
  ).toBeVisible();
  await trigger.click();
  await expect(
    evidence,
    `"${name}": the state did not open — scanning here would prove nothing`,
  ).toBeVisible();
}

/** Scan the current state and record its slice against `name`. */
async function scanState(
  a11y: {
    scanPage: (o: Record<string, unknown>) => Promise<{ findings: Array<Record<string, unknown>> }>;
  },
  name: InteractionState,
  opts: { keyboard: boolean },
): Promise<void> {
  const { findings } = await a11y.scanPage({
    level: 'AA',
    failOnBlockers: false,
    // Tier-2 focus-indicator screenshots are off for the same reason as in
    // `surfaces.a11y.spec.ts`: on browse they cost 4.1 minutes to upgrade a heuristic that
    // already reports, and nothing here is triaged yet.
    noFocusIndicatorScreenshots: true,
    keyboard: opts.keyboard,
    // Overlays animate. Material's default enter is 225ms; a scan that starts mid-transition
    // measures contrast against a half-faded backdrop and invents findings.
    extraWaitMs: 600,
  });

  const rules = [...new Set(findings.map((f) => String(f['ruleId'])))].sort();
  results.push({
    state: name,
    findings: findings.length,
    blockers: findings.filter((f) => f['severity'] === 'blocker').length,
    rules,
    keyboard: opts.keyboard,
  });
}

test.describe('accessibility: interaction states', () => {
  /**
   * The column picker — `role="dialog"`, `aria-modal="true"`, dismissed with Escape.
   *
   * The highest-value target in this file and the reason `keyboard` is on. A modal that focus
   * can enter but not leave is WCAG 2.1.2, and axe cannot see it: the trap is a property of how
   * the page responds to repeated Tab presses, not of its markup. Worth knowing before reading
   * the result — this panel's backdrop is itself a `<button>`, so it is in the tab order and
   * announces as a control, which is a plausible source of both a trap and a name finding.
   */
  test('column picker dialog', async ({ signedIn: page, a11y }) => {
    await openBrowse(page);
    await enterState(
      'column picker',
      page.getByRole('button', { name: 'Manage columns' }),
      page.locator('.col-panel'),
    );
    await scanState(a11y, 'browse › column picker dialog', { keyboard: true });
  });

  /**
   * The type filter's `mat-select` panel, which renders into `.cdk-overlay-container`.
   *
   * CDK overlays are in the document only while open, so no scan has ever included one. Keyboard
   * is on: a listbox that cannot be escaped is the same 2.1.2 failure as above.
   */
  test('type filter select panel', async ({ signedIn: page, a11y }) => {
    await openBrowse(page);
    await enterState(
      'type filter panel',
      page.locator('.toolbar-filter-select mat-select'),
      page.locator('.mat-mdc-select-panel'),
    );
    await scanState(a11y, 'browse › type filter select panel', { keyboard: true });
  });

  /**
   * The "Modified" date-range calendar overlay.
   *
   * Also the standing lead on an open question: five of a11y-scout's eight `color-contrast`
   * findings are on `.mat-start-date`, `.mat-end-date` and the select, and none of them
   * reproduced under a plain navigate-and-wait in `a11y/diagnostics/axe-differential.mjs`. Scanning
   * the control with its picker open is the most direct way to find out whether the open state
   * is what the original scan caught.
   */
  test('modified date-range calendar', async ({ signedIn: page, a11y }) => {
    await openBrowse(page);
    await enterState(
      'date-range calendar',
      page.locator('.toolbar-filter-date mat-datepicker-toggle button'),
      page.locator('mat-datepicker-content'),
    );
    await scanState(a11y, 'browse › date-range calendar', { keyboard: true });
  });

  /**
   * Card view.
   *
   * Keyboard is off here and for the tab states below. The walk presses up to 150 keys per
   * direction and took 8.8 minutes on this route; the list-view walk is already in the baseline
   * scan, and re-walking a re-skinned version of the same document list is a poor trade against
   * the axe and focus checks, which do run. If a card-specific trap is ever suspected, turn it on
   * for this one test rather than globally.
   *
   * **`keyboard: false` also disables the reflow scanner (WCAG 1.4.10)**, which is not obvious
   * from the option name — a11y-scout's upstream `scan-page.ts` gates reflow behind the same flag:
   * `if (keyboard !== false) { runReflowCheck(...) }`. There is no way to keep reflow without
   * paying for the keyboard walk. The loss is smaller than it looks, not zero:
   * `a11y/diagnostics/reflow-probe.mjs` reproduces the scanner's algorithm, closes the nav
   * drawer that covers browse at 320px, measured `/#/browse` fitting on 2026-10-02, and
   * proves its own detection path under `--negative-control`. It measures browse in list view,
   * though, so card view at 320px is measured by nothing.
   */
  test('card view', async ({ signedIn: page, a11y }) => {
    await openBrowse(page);
    await enterState(
      'card view',
      page.getByRole('button', { name: 'Card view' }),
      page.locator('.card-grid'),
    );
    // Cards render an icon until `thumbnailMap` resolves, then swap in an `<img>`.
    await waitForScreenSettled(page, 'lib-browse', true);
    await scanState(a11y, 'browse › card view', { keyboard: false });
  });

  /**
   * The three secondary tabs.
   *
   * Each is a distinct surface — Permissions and History carry their own form fields, selects and
   * tables — and none has been scanned by any layer. They are driven by visible tab label rather
   * than index so a reordered tab group fails the state assertion instead of silently scanning
   * the wrong tab.
   *
   * View mode persists in a service across navigation, so each test re-enters through
   * `openBrowse` and the tab click is the only state change.
   */
  for (const tab of BROWSE_TABS) {
    test(`${tab.toLowerCase()} tab`, async ({ signedIn: page, a11y }) => {
      await openBrowse(page);
      // Evidence is the requested tab reporting `aria-selected="true"`, NOT the presence of
      // `.mat-mdc-tab-body-active`.
      //
      // That element already exists for the View tab before the click, so it satisfied
      // `enterState` whether or not activation happened — and a failed click would then have
      // scanned the View tab under the Permissions, History or Trash label. Exactly the
      // mislabelling this file's `enterState` was written to prevent, reintroduced one line
      // later. Flagged in review on PR #225.
      await enterState(
        `${tab} tab`,
        page.getByRole('tab', { name: tab }),
        page.getByRole('tab', { name: tab, selected: true }),
      );
      // The tab body is present before its content resolves; assert something inside it so the
      // scan does not race an empty panel.
      await expect(
        page
          .locator('.mat-mdc-tab-body-active')
          .getByRole('heading')
          .or(page.locator('.mat-mdc-tab-body-active').locator('table, mat-form-field, p'))
          .first(),
        `the ${tab} tab rendered no content, so its scan would be vacuous`,
      ).toBeVisible();
      // Permissions, History and Trash each fetch on activation behind a `mat-spinner` inside
      // `lib-browse`, and a heading can render beside it. The overlays above fetch nothing.
      await waitForScreenSettled(page, 'lib-browse', true);
      await scanState(a11y, `browse › ${tab} tab`, { keyboard: false });
    });
  }

  /**
   * One consolidated report for every state above, plus the per-state table the report itself
   * cannot give (every state shares one URL — see the header).
   *
   * A test rather than `afterAll` so a11y-scout can attach the HTML to the Playwright report.
   */
  test('emits the consolidated report', async ({ a11y }) => {
    const { state, reportPaths } = await a11y.generateReport({
      outDir: REPORT_DIR,
      reportName: 'nuxeo-satori-interaction-states',
      failOnBlockers: false,
    });

    const rows = results
      .map(
        (r) =>
          `  ${r.state.padEnd(38)} ${String(r.findings).padStart(3)} findings` +
          ` ${String(r.blockers).padStart(3)} blockers` +
          ` ${r.keyboard ? ' [kbd]' : '      '}  ${r.rules.join(', ') || '—'}`,
      )
      .join('\n');

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '  per-state findings (the consolidated report groups by URL, which is identical for all of these)',
        rows,
        '',
        `  total findings : ${state.findings.length}`,
        `  LLM provider   : ${state.meta.llmProvider}${state.meta.llmMockMode ? ' (MOCK)' : ''}`,
        `  ai findings    : ${aiFindingsNote(state)}`,
        `  report         : ${reportPaths.html}`,
        '',
      ].join('\n'),
    );

    // Assert the deliverable, not the pulse. "A report exists" is a pulse; "every state this
    // file claims to cover actually recorded a scan" is the thing that would catch a test
    // silently skipping, which is exactly how an unscanned state becomes a reported pass.
    //
    // Compared as sets rather than counted, so the failure names the state. A count told you
    // a number was wrong and left you to work out which state had produced nothing.
    const scanned = new Set<string>(results.map((r) => r.state));
    expect(
      INTERACTION_STATES.filter((s) => !scanned.has(s)),
      'these declared interaction states recorded no scan slice, so the report covers less ' +
        'than it claims',
    ).toEqual([]);
    expect(
      [...scanned].filter((s) => !INTERACTION_STATES.includes(s as InteractionState)),
      'these states recorded a scan but are not declared in INTERACTION_STATES',
    ).toEqual([]);
  });
});
