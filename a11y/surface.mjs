/**
 * Is this surface worth measuring? — the Node-side twin of `expectSurfaceUsable` in
 * `fixtures.ts`.
 *
 * The diagnostics used to wait only for the feature host to become visible. That is not
 * enough, and the reason is specific rather than theoretical: a failed load renders the *same
 * host* with an error panel inside it, so the host is visible and the check passes. The
 * `/nuxeo/api/v1/me` preflight does not close the gap either — it proves credentials and the
 * backend are reachable, not that this route's data request succeeded.
 *
 * What that produced, per diagnostic:
 *
 *   - `reflow-probe.mjs` measured the geometry of an error panel and reported `fits`. An
 *     error panel has a perfectly well-behaved layout; it is the one thing guaranteed not to
 *     overflow.
 *   - `axe-differential.mjs` ran both tag sets against an error DOM and recorded the route as
 *     measured, so a rule that only fires on real content read as "did not reproduce".
 *
 * Both are false-clean, which is the failure mode this whole folder exists to avoid. Flagged
 * in review on PR #225.
 *
 * This module is the single definition of both lists below and of `screenUnsettledReason`, the
 * wait every scan makes before measuring; `fixtures.ts` imports them, which is why the folder
 * sets `allowJs`. It is `.mjs` rather than `.ts` so the diagnostics, which are plain Node
 * scripts and never see the TypeScript compiler, can import it too.
 */

/**
 * Every class that means "this surface failed to load".
 *
 * There is no shared error component in this application — each feature rolls its own — so
 * this list is the closest thing to one, and it is maintained by sweeping the templates
 * rather than by memory. That distinction is not pedantic: the list was written by hand from
 * the features that had already been scanned, the comment above it claimed it had been
 * collected from the templates, and it was missing twenty classes. `.widget-error` was found
 * in review on PR #225 — the dashboard renders it in four places, so a dashboard whose
 * widgets had all failed rendered plenty of text, tripped no selector here, and would have
 * been scanned and reported as a clean surface.
 *
 * `diagnostics/error-class-drift.mjs` now re-derives this from the templates and fails when
 * either list has drifted, so the next feature cannot reopen the same hole quietly.
 */
export const ERROR_STATE_CLASSES = [
  // Feature surfaces.
  'detail-error',
  'results-error',
  'task-error',
  'kd-error',
  'kd-banner--error',
  'kd-citation-dialog__state--error',
  'kd-content-lake-upload__error',
  'gd-error',
  'ud-error',
  'ug-error',
  'nxql-error',
  'compare-error',
  'cpd-error',
  // App-shell pages, which have no feature library but are scanned the same way.
  'widget-error',
  'personal-space-page__error',
  'authorized-applications-page__state--error',
  'connected-accounts-page__state--error',
  // The shared full-page error panel (`nxs-error-state`), used by browse, search and document
  // detail when the page's data fails to load. Its four parts are listed separately because the
  // drift check reads class names: a panel whose wrapper is missed here is still caught by its
  // heading, icon, message or actions.
  'nxs-error-state__heading',
  'nxs-error-state__icon',
  'nxs-error-state__message',
  'nxs-error-state__actions',
];

export const ERROR_STATE_SELECTOR = ERROR_STATE_CLASSES.map((c) => `.${c}`).join(', ');

/**
 * Classes that match `error` but must **not** refuse a surface, and why.
 *
 * This list exists so that "not in `ERROR_STATE_CLASSES`" can mean "nobody has looked at it
 * yet". Without it the drift check could only be silenced by adding a class to the selector,
 * which would trade false-clean scans for false refusals — the failure mode where the suite
 * reports nothing because it declines to measure anything.
 *
 * Two kinds qualify. An **ancillary feature** failing leaves the surface itself rendered and
 * worth scanning. A **data state** describes the content, not the load.
 */
export const NOT_A_SURFACE_ERROR = {
  'ai-error': 'AI: the search page rendered; its AI panel did not.',
  'ai-error-banner': 'AI: document detail rendered; its AI panel did not.',
  'ai-chat-error': 'AI: the shell rendered; the chat drawer did not.',
  'ke-status-banner--error': 'Data state: knowledge-enrichment status of this document.',
  'kd-status-chip--error': 'Data state: status of one answer in the KD list.',
  'edit-document-dialog__error': 'Save error inside the edit dialog; the page rendered.',
  'nxs-folder-picker-dialog__failure': 'Failure inside the folder-picker dialog; the page rendered.',
  'nxs-rename-dialog__failure': 'Failure inside the rename dialog; the page rendered.',
  'nxs-share-external-dialog__error': 'Failure inside the external-share dialog; the page rendered.',
  'nxs-update-permission-dialog__error': 'Failure inside the update-permission dialog; the page rendered.',
  'saved-search-error': 'Validation inside the saved-search dialog, not a load failure.',
  'nxs-metadata-editor__error': 'Field validation inside the metadata editor, not a load failure.',
  'nxs-permissions-panel__field-error': 'Field validation inside the permissions panel, not a load failure.',
  'nxs-permissions-panel__error': 'Ancillary: the permissions panel failed; the page rendered.',
  'nxs-comments__failed': 'Ancillary: the comments panel failed; the page rendered.',
  'nxs-document-tree__error': 'Ancillary: the document tree failed; the page rendered.',
  'nxs-document-tree__item--error': 'Ancillary: one document-tree item failed; the page rendered.',
  'nxs-document-tree__row--error': 'Ancillary: one document-tree row failed; the page rendered.',
  'import-error': 'Validation inside the create-import dialog, not a load failure.',
  'import-error--staged': 'Validation inside the create-import dialog, not a load failure.',
  'types-error': 'Validation inside the create-import dialog, not a load failure.',
  'error-text': 'Validation inside the create-import dialog, not a load failure.',
  error:
    'Nav-drawer tree (`.tree-empty.error`). A bare `.error` is too broad to put in the ' +
    'host-scoped selector. NOT unchecked, though: `screenUnsettledReason` refuses a screen ' +
    'whose drawer shows a visible one, because the scan measures the drawer too. This entry ' +
    'used to say it was "out of reach anyway", which was true of the host-scoped checks and ' +
    'false of the scan — flagged in review on PR #225.',
};

/**
 * The three AI entries are the load-bearing ones. The AI backend is a separate marketplace
 * package that is **absent by default** (`CLAUDE.md` §5: its absence means HTTP 500, which is
 * expected, not a client defect). Treating those banners as surface failures would refuse
 * search, document detail and every shell-level scan on any environment without that package
 * — which is most of them, including this one. The suite would then report no findings, and
 * "no findings" is indistinguishable from "clean" at a glance.
 */

/**
 * Wait for a surface to be worth measuring, or explain why it is not.
 *
 * Proves the host rendered, that no known error state is inside it, and that it has real text
 * rather than being an empty shell. It does **not** prove repository data arrived: a feature
 * that fails silently, with no error class and a plausible empty layout, still passes. Named
 * for the weaker claim it makes.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} host    the feature component selector, e.g. `lib-browse`
 * @param {string} label   how this surface is named in the output
 * @param {number} [timeoutMs]
 * @returns {Promise<string|null>} null when usable, otherwise the reason it is not
 */
export async function surfaceUnusableReason(page, host, label, timeoutMs = 20_000) {
  try {
    await page.locator(host).first().waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    return `${label}: ${host} never became visible`;
  }

  const errors = await page.locator(`${host} :is(${ERROR_STATE_SELECTOR})`).count();
  if (errors > 0) {
    return `${label}: showing an error state — measuring it would measure the error, not the surface`;
  }

  const text = (await page.locator(host).first().innerText()).trim();
  if (text.length === 0) {
    return `${label}: rendered an empty shell, so a clean measurement of it would prove nothing`;
  }

  return null;
}

/**
 * Everything that means "still loading", in the nav drawer or inside a feature host.
 *
 * Spinners are matched by element, not by the wrapper class they sit in (`.results-loading`,
 * `.tab-loading`, `.browse-loading`, …). Loaders that show text or a skeleton rather than a
 * spinner can only be identified by class, so those are listed.
 */
const LOADING_SELECTOR = [
  'mat-spinner',
  'mat-progress-spinner',
  'mat-progress-bar',
  '.tree-loading',
  // Text only: "Loading…" in the trash filters drawer, no spinner inside it.
  '.drawer-results-loading',
  // Text only: "Loading…" while an extension outlet resolves its component, in the drawer.
  '.extension-outlet__loading',
  // Grey placeholder lines while a document-detail AI card waits for its answer.
  '.ai-loading-skeleton',
].join(', ');

/** The shell's nav drawer. Present on every signed-in route, absent on the sign-in page. */
const NAV_DRAWER = 'app-nav-drawer';

/**
 * The drawer's own error panel — the one error state no host-scoped check can see.
 *
 * `surfaceUnusableReason` looks only inside the feature host, and the drawer is a sibling of
 * the router outlet, so a failed drawer request never reached it. But the scan measures the
 * whole page, drawer included, so the result was the accessibility of an error panel recorded
 * as the screen's.
 *
 * `/#/tasks` is the case that makes this more than theoretical, and it is the worst one: the
 * task list lives in the drawer *only* — "Task list lives in the shell nav drawer only (single
 * inbox)", `tasks-page.component.html:2` — and the page renders a "select a task" prompt with
 * no error class and plenty of text. So when the task request fails the drawer shows
 * `.tree-empty.error`, the page looks perfectly healthy to every other check here, and the one
 * thing the screen exists to show is an error. Flagged in review on PR #225.
 *
 * Matched as `.tree-empty.error` rather than by adding a bare `.error` to
 * `ERROR_STATE_CLASSES`, which is too broad to apply inside feature hosts — see
 * `NOT_A_SURFACE_ERROR`.
 */
const DRAWER_ERROR_SELECTOR = '.tree-empty.error';

/**
 * The text of a visible drawer error, or `null`.
 *
 * Visibility is load-bearing: a closed `mat-sidenav` is `visibility: hidden`, so a collapsed
 * drawer holding a stale error panel is not something the scan can meet, and refusing on it
 * would be a false refusal. Same `checkVisibility` call the loader count uses.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string|null>}
 */
async function visibleDrawerError(page) {
  return page.evaluate(
    ({ drawer, selector }) => {
      const root = document.querySelector(drawer);
      if (!root) return null;
      const found = [...root.querySelectorAll(selector)].find((el) =>
        el.checkVisibility({ visibilityProperty: true, opacityProperty: false }),
      );
      return found ? (found.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) : null;
    },
    { drawer: NAV_DRAWER, selector: DRAWER_ERROR_SELECTOR },
  );
}

/**
 * Wait until a screen has stopped changing, or explain why it never did.
 *
 * ## Why a quiet window, and why it covers the drawer AND the host
 *
 * A scan that arrives mid-load does not just add noise, it can report the wrong number. The
 * drawer's folder tree showed that first: while a node loads, its toggle holds
 * `<mat-spinner aria-label="Loading">`, which lends the button an accessible name its settled
 * state does not have, so an early scan reported six unnamed toggles where there were seven
 * (`docs/accessibility.md`, "The run-to-run difference was a loading spinner masking a real
 * defect").
 *
 * The same shape recurs well beyond the tree, which is why this observes both regions:
 *
 *   - the drawer's other panels — favorites, recently viewed, expired, collections, tasks —
 *     each render their own `.tree-loading` **outside** `.folder-tree`, which the earlier
 *     tree-only wait never looked at;
 *   - those panels, and the result lists inside feature hosts, fetch thumbnails after the list
 *     renders and swap an icon for an `<img>` when each arrives, with no loading marker at all.
 *
 * The app exposes no "loaded" signal for any of this, so stillness is the evidence: no loader
 * visible, and the tree node count, `<img>` count and element count of both regions unchanged
 * for `quietMs`. All are read in one `evaluate`, so a poll sees one consistent DOM rather than
 * counts taken across a re-render.
 *
 * `<img>` is counted separately because an icon-to-thumbnail swap replaces one element with one
 * element and leaves the element count unchanged.
 *
 * Shared by the Playwright specs (through `waitForScreenSettled` in `fixtures.ts`) and the
 * Node diagnostics, so the two cannot disagree about when a screen is ready to measure.
 *
 * ## Settled is not the same as measurable
 *
 * Once the screen holds still, a visible `.tree-empty.error` in the drawer is refused — see
 * `DRAWER_ERROR_SELECTOR`. A screen can settle perfectly on a failed drawer request, and the
 * scan measures the drawer, so stillness alone would have certified an error panel.
 *
 * Not covered: a loading state with none of the markers in `LOADING_SELECTOR`. The element
 * counts still have to hold still, so such a state is only missed if it outlasts `quietMs`
 * without the DOM changing.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object}  options
 * @param {string|null} options.host   the feature host, or `null` for a screen without one
 * @param {boolean} options.treeRequired  the screen must show the folder tree, so an empty
 *   drawer fails rather than settling as "nothing to wait for"
 * @param {number}  [options.quietMs]
 * @param {number}  [options.timeoutMs]
 * @returns {Promise<string|null>} null when settled, otherwise what was last seen
 */
export async function screenUnsettledReason(
  page,
  { host, treeRequired, quietMs = 1500, timeoutMs = 20_000 },
) {
  const deadline = Date.now() + timeoutMs;

  if (host) {
    try {
      await page.locator(host).first().waitFor({ state: 'visible', timeout: timeoutMs });
    } catch {
      return `${host} never became visible, so there was nothing to wait on`;
    }
  }
  if (treeRequired) {
    try {
      await page
        .locator('.tree-node')
        .first()
        .waitFor({ state: 'visible', timeout: Math.max(deadline - Date.now(), 1) });
    } catch {
      return 'this screen shows the folder tree, and no .tree-node ever rendered';
    }
  }

  let previous = '';
  let stableSince = Date.now();
  let seen = 'not read yet';
  while (Date.now() < deadline) {
    /** @type {{loading: number, shape: string} | null} */
    let state = null;
    try {
      state = await page.evaluate(
        ({ roots, loaders }) => {
          // `checkVisibility` rather than a box test: a closed `mat-sidenav` is
          // `visibility: hidden`, which still has boxes, and a spinner nobody can see is
          // not a loader the scan would meet.
          /** @param {Element} el */
          const visible = (el) =>
            el.checkVisibility({ visibilityProperty: true, opacityProperty: false });
          let loading = 0;
          let images = 0;
          let elements = 0;
          for (const selector of roots) {
            const root = document.querySelector(selector);
            if (!root) continue;
            loading += [...root.querySelectorAll(loaders)].filter(visible).length;
            images += root.querySelectorAll('img').length;
            elements += root.getElementsByTagName('*').length;
          }
          const nodes = document.querySelectorAll('.tree-node').length;
          return { loading, shape: `${nodes} tree node(s), ${images} img, ${elements} elements` };
        },
        { roots: host ? [NAV_DRAWER, host] : [NAV_DRAWER], loaders: LOADING_SELECTOR },
      );
    } catch {
      // A read racing a navigation throws. That is "not settled yet", not a failure.
      state = null;
    }

    if (state === null) {
      seen = 'unreadable (page was navigating)';
      previous = '';
      stableSince = Date.now();
    } else {
      seen = `${state.loading} loader(s), ${state.shape}`;
      if (state.loading > 0 || state.shape !== previous) {
        previous = state.loading > 0 ? '' : state.shape;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= quietMs) {
        // Settled — but settled on an error is still not measurable. Checked here rather
        // than before the loop so the drawer has finished loading before it is judged, and
        // here rather than in a function of its own because this is the one call every scan
        // and every diagnostic already makes.
        const drawerError = await visibleDrawerError(page);
        if (drawerError) {
          return (
            `the nav drawer is showing an error state (${DRAWER_ERROR_SELECTOR}): ` +
            `"${drawerError}". The scan measures the whole page including the drawer, so this ` +
            "would record an error panel's accessibility as the screen's result — and on " +
            '/#/tasks the drawer is where the task list lives, so it would be the whole screen.'
          );
        }
        return null;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return (
    `the screen never held still, with no loader visible, for ${quietMs}ms within ` +
    `${timeoutMs}ms — last seen: ${seen}. A scan now would measure a partial load.`
  );
}
