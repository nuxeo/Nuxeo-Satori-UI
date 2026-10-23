#!/usr/bin/env node
/**
 * Negative control for a11y-scout's reflow scanner (WCAG 1.4.10).
 *
 * ## Why this exists
 *
 * Reflow is one of the three capabilities a11y-scout was adopted for, and across every report
 * on disk — 81 findings over seven routes, 71 over seven interaction states, 12 on login — it
 * has produced **zero** findings. That is either a clean bill of health or a scanner that
 * cannot fail, and this repository's rule is that the two are indistinguishable until you have
 * watched the check go red on purpose.
 *
 * ## What the scanner actually does, and why zero is plausible
 *
 * `node_modules/a11y-scout/src/scanners/reflow.ts` resizes to 320×256, reads
 * `documentElement.scrollWidth`, and — this is the part that matters here — attributes the
 * overflow. An element that overflows is ignored if it is inside one of:
 *
 *     table, pre, svg, [role="img"], [role="application"]
 *
 * which WCAG 1.4.10 exempts as "content that by usage requires two-dimensional layout". A
 * violation is reported only when at least one overflowing element sits OUTSIDE all of those.
 *
 * This application renders its primary surfaces as `mat-table`, which emits a real `<table>`.
 * So a zero is exactly what a correct scanner should return here, and the interesting question
 * is not "is the app clean" but "would this scanner notice if it were not".
 *
 * ## What this prints
 *
 * Per route: the 320px `scrollWidth`, whether anything overflows, and if so whether every
 * offender is inside an exempt subtree. The last column is the scanner's verdict reproduced
 * independently. A route that overflows via a NON-exempt element and was still reported clean
 * by a11y-scout would mean the scanner is broken.
 *
 * A row measured after closing the nav drawer says so. At 320px every route measured on
 * 2026-10-02 opened with the drawer filling the screen and the content 0px wide; see
 * `revealContentBehindDrawer`.
 *
 * Run:  node a11y/diagnostics/reflow-probe.mjs [--negative-control]
 */

import { judgeMe } from '../../scripts/beta-harness/identity-guard.mjs';
import { parseCliOrExit } from '../cli.mjs';
import { nuxeoBasicAuthHeader, resolveBaseUrl } from '../env.mjs';
import { injectedSession, SESSION_KEY, SIGNED_OUT_KEY } from '../session.mjs';
import { screenUnsettledReason, surfaceUnusableReason } from '../surface.mjs';
import { PINNED_INSTALL_ARGS } from '../versions.mjs';
import {
  credentialsOrExit,
  gotoOrExit,
  launchChromium,
  requireAdministrationAccess,
  requireSessionAdopted,
  watchNuxeoApiOrigins,
} from './preconditions.mjs';

const NEGATIVE_CONTROL = parseCliOrExit('reflow-probe', {
  'negative-control': { type: 'boolean' },
})['negative-control'] === true;

const REFLOW_WIDTH = 320;
const REFLOW_HEIGHT = 256;
const TOLERANCE = 4;
const EXEMPT = ['table', 'pre', 'svg', '[role="img"]', '[role="application"]'];

// One resolver for every command in this folder — see `resolveBaseUrl` for why there used to
// be two and what that broke. This file read `A11Y_BASE_URL` at one point, a third name that
// nothing else honoured, so the documented override silently did nothing here.
const baseUrl = resolveBaseUrl();
// Required, never defaulted — see `../env.mjs` for why a default is worse than an error here.
const { username: user, password: pass } = credentialsOrExit('reflow-probe');

/**
 * Refuse to measure a backend that is not answering.
 *
 * `run.mjs` skips the shared preflight for the diagnostics, on the grounds that a 20-second
 * answer should not wait on a document query, so each diagnostic checks the backend itself.
 * It matters most here: this one measures *geometry*, and an error panel has perfectly good
 * geometry. A route whose data failed to load would be measured as a clean layout and
 * reported as `fits`. Flagged in review on PR #225.
 *
 * Also checks the identity can reach `/#/administration`, one of the six routes. Without
 * that, adminGuard redirects to the dashboard and its geometry is reported under the
 * administration label.
 *
 * Cheap enough to always run: one request, and it is the difference between measuring the app
 * and measuring its error state.
 */
async function requireBackend() {
  const url = new URL('/nuxeo/api/v1/me', baseUrl);
  try {
    const res = await fetch(url, {
      headers: { Authorization: nuxeoBasicAuthHeader() },
      // Not followed: another server at the destination could name any user.
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 200) {
      console.error(
        `reflow-probe: Nuxeo answered ${res.status} at ${url}. Every route would render an\n` +
          '  error panel, and an error panel has a perfectly measurable layout — the probe\n' +
          '  would report "fits" for surfaces it never saw.\n',
      );
      process.exit(2);
    }
    // A body that is not JSON is no identity, which requireAdministrationAccess refuses with exit 2.
    const me = await res.json().catch(() => null);
    // Nor is a 200: a guest-enabled Nuxeo answers 200 as `Anonymous` (NXSAT-643).
    const { problem } = judgeMe({ status: res.status, body: me }, user);
    if (problem) {
      console.error(`reflow-probe: ${url}: ${problem}. A layout measured as the guest is not the user's.\n`);
      process.exit(2);
    }
    requireAdministrationAccess(me, user, 'reflow-probe');
  } catch (error) {
    console.error(
      `reflow-probe: could not reach Nuxeo through ${baseUrl}: ` +
        `${error instanceof Error ? error.message : String(error)}\n\n` +
        '    npm run beta:backend && npx nx serve nuxeo-ui\n',
    );
    process.exit(2);
  }
}

await requireBackend();

/** Same six surfaces `surfaces.a11y.spec.ts` scans, so the comparison is like for like. */
const ROUTES = [
  ['browse', '/#/browse', 'lib-browse'],
  ['search', '/#/search', 'lib-search'],
  ['trash', '/#/trash', 'lib-trash'],
  ['tasks', '/#/tasks', 'lib-tasks-page'],
  ['administration', '/#/administration', 'lib-administration-shell'],
  ['knowledge-discovery', '/#/knowledge-discovery', 'lib-knowledge-discovery'],
];

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch (err) {
  console.error(
    `reflow-probe: cannot measure — ${err instanceof Error ? err.message : err}\n` +
      `  npm install --no-save ${PINNED_INSTALL_ARGS}`,
  );
  process.exit(2);
}

/**
 * A browser context that is actually signed in.
 *
 * Both mechanisms are required and this is the second time that has cost something:
 * `httpCredentials` satisfies the XHRs, and the sessionStorage session satisfies the route
 * guard. See `apps/nuxeo-ui-e2e/src/fixtures.ts`.
 *
 * Extracted because the negative control built its own context and applied only the first
 * half, so it had **never been signed in**. The route guard bounced it to `/#/login` and it
 * measured the sign-in page while reporting `/#/browse`. That went unnoticed because the old
 * control only checked that injecting a 900px div raised `scrollWidth` — which is true on any
 * page, including the wrong one. It surfaced the moment the surface assertion was added, with
 * "lib-browse never became visible".
 *
 * @param {number} width
 * @param {number} height
 */
async function newSignedInContext(width, height) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    // `send: 'always'`: a guest-enabled Nuxeo never challenges, so without it
    // `page.request` ran as Anonymous (NXSAT-643).
    httpCredentials: { username: user, password: pass, origin: baseUrl, send: 'always' },
  });
  await ctx.addInitScript(
    ({ key, signedOutKey, value }) => {
      sessionStorage.setItem(key, value);
      sessionStorage.removeItem(signedOutKey);
    },
    { key: SESSION_KEY, signedOutKey: SIGNED_OUT_KEY, value: injectedSession(user, pass) },
  );
  return ctx;
}

const browser = await launchChromium(chromium, 'reflow-probe');
const context = await newSignedInContext(1440, 900);

/**
 * Wait for the layout to stop moving after a resize, or report that it never did.
 *
 * This was a fixed 400ms pause (200ms in the control). A resize reaches this app through
 * `BreakpointObserver` and change detection, so the narrow layout lands some frames later,
 * and a pause guesses how many. Instead `scrollWidth` — the number the verdict is computed
 * from — and the element count are read every frame until both hold for `stillFrames` frames
 * in a row, so the measurement is taken of the layout the narrow viewport produced rather than
 * of one still in transition. Flagged in review on PR #225 as the same fixed-delay defect as
 * the other two diagnostics.
 *
 * This watches layout only. Anything the narrow layout starts loading is waited for separately,
 * by `screenUnsettledReason`, after it.
 *
 * @param {import('@playwright/test').Page} p
 * @returns {Promise<boolean>} false when it was still moving after `maxFrames` frames
 */
async function layoutHeldStill(p) {
  return p.evaluate(
    ({ stillFrames, maxFrames }) =>
      new Promise((resolve) => {
        let last = '';
        let still = 0;
        let frames = 0;
        const tick = () => {
          const shape = `${document.documentElement.scrollWidth}/${document.getElementsByTagName('*').length}`;
          still = shape === last ? still + 1 : 0;
          last = shape;
          frames += 1;
          if (still >= stillFrames) resolve(true);
          else if (frames >= maxFrames) resolve(false);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    // About 170ms of stillness, inside a 5s budget at 60fps.
    { stillFrames: 10, maxFrames: 300 },
  );
}

const NAV_DRAWER_SIDENAV = 'mat-sidenav.nav-drawer-sidenav';
const FREEZE_STYLE_ID = 'reflow-probe-freeze-motion';

/**
 * Turn transitions and animations off for the measurement, and back on before the next route.
 *
 * Removable because the route loop reuses one page and `/#/…` navigations are same-document:
 * a tag added on one route was still there on the next, so the drawer on that route could not
 * finish closing — see `revealContentBehindDrawer`.
 *
 * @param {import('@playwright/test').Page} p
 */
async function freezeMotion(p) {
  await p.evaluate((id) => {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(style);
  }, FREEZE_STYLE_ID);
}

/** @param {import('@playwright/test').Page} p */
async function unfreezeMotion(p) {
  await p.evaluate((id) => document.getElementById(id)?.remove(), FREEZE_STYLE_ID).catch(() => undefined);
}

/**
 * At 320px, show the screen rather than the nav drawer, or say why that was not possible.
 *
 * The drawer is a `mode="side"` sidenav, 280px wide, that a deep link opens and nothing closes
 * at a narrow width. At 320×256 it takes the whole container and the feature host is laid out
 * 0px wide — measured on 2026-10-02 on all six routes this probe reaches. Every earlier `fits`
 * here was therefore a measurement of the drawer, and the summary note blamed a "closed"
 * drawer that was open.
 *
 * The user's way out is the rail item that opened the drawer: clicking the active item again
 * closes it (`onNavClick` in `apps/nuxeo-ui/src/app/shell/app-shell.component.ts`). The ☰ button
 * in the header toggles the
 * rail, not the drawer, so it is not used. A click that silently did something else is ruled
 * out by asserting the drawer closed, the URL did not change, and the host now has a width.
 *
 * Decided on the drawer being open, not on the host being 0px: a drawer that left the content a
 * sliver would still be measured as the drawer's layout.
 *
 * @param {import('@playwright/test').Page} p
 * @param {string} host
 * @returns {Promise<{drawerWasOpen: boolean, widthBehindDrawer?: number, error?: string}>}
 *   `widthBehindDrawer` is the host's width before the drawer was closed; `error` when the
 *   screen could not be revealed
 */
async function revealContentBehindDrawer(p, host) {
  /** @returns {Promise<number | null>} null when the host is not in the page */
  const hostWidth = () =>
    p.evaluate((h) => {
      const el = document.querySelector(h);
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    }, host);
  const drawerOpen = () =>
    p.evaluate(
      (sel) => document.querySelector(sel)?.classList.contains('mat-drawer-opened') ?? false,
      NAV_DRAWER_SIDENAV,
    );

  if (!(await drawerOpen())) return { drawerWasOpen: false };

  const widthBehindDrawer = await hostWidth();
  if (widthBehindDrawer === null) {
    return { drawerWasOpen: true, error: `${host} is not in the page after the resize` };
  }
  const urlBefore = p.url();
  const activeItem = p.locator('sat-platform-nav-list-item a.sat-platform-nav-item-active');
  if ((await activeItem.count()) !== 1) {
    return {
      drawerWasOpen: true,
      widthBehindDrawer,
      error: `the nav drawer is open and there is not exactly one active rail item to close it with`,
    };
  }
  await activeItem.click();
  // Waited for as the condition itself, not as layout stillness: `scrollWidth` and the element
  // count do not move while the drawer slides out, so stillness resolves before it has.
  // Material removes the content's 280px margin only when the close transition ends, which is
  // why the caller must not have disabled transitions yet — with them off, the drawer closed
  // and the host stayed 0px wide, measured on 2026-10-02.
  await p
    .waitForFunction(
      ({ h, sel }) =>
        !document.querySelector(sel)?.classList.contains('mat-drawer-opened') &&
        (document.querySelector(h)?.getBoundingClientRect().width ?? 0) > 0,
      { h: host, sel: NAV_DRAWER_SIDENAV },
      { timeout: 5_000 },
    )
    // A timeout is not lost: the drawerOpen() check below decides what it means.
    .catch(() => undefined);
  if (await drawerOpen()) {
    return {
      drawerWasOpen: true,
      widthBehindDrawer,
      error: 'clicking the active rail item did not close the nav drawer',
    };
  }
  if (p.url() !== urlBefore) {
    return { drawerWasOpen: true, widthBehindDrawer, error: `closing the nav drawer navigated to ${p.url()}` };
  }
  const width = await hostWidth();
  if (width === null) {
    return { drawerWasOpen: true, widthBehindDrawer, error: `${host} left the page when the nav drawer closed` };
  }
  if (width <= 0) {
    return {
      drawerWasOpen: true,
      widthBehindDrawer,
      error: `${host} was still 0px wide 5s after clicking the active rail item`,
    };
  }
  return { drawerWasOpen: true, widthBehindDrawer };
}

/**
 * Measure horizontal overflow at the narrow viewport and classify it.
 *
 * Extracted so the route loop and the negative control run **the same code**. They did not
 * before: the control only checked that injecting a 900px div raised `scrollWidth`, which
 * exercises none of the exempt/non-exempt attribution that actually decides `VIOLATION`. A
 * broken classification path — the part most likely to break, and the part that had already
 * been wrong once with the truncation bug — would still have printed `detection path: WORKS`.
 * A control that cannot fail for the reason the tool fails is decoration. Flagged in review
 * on PR #225.
 *
 * @param {import('@playwright/test').Page} p
 * @param {string} [markerId] element id to report the classification of, for the negative
 *   control. Returned as `marker`: `non-exempt`, `exempt` or `not-seen`.
 */
async function measureReflow(p, markerId) {
  const m = await p.evaluate(
    ({ width, exempt, tol, marker }) => {
      const root = document.documentElement;
      const sw = root.scrollWidth;
      const offenders = [];
      const exemptSel = exempt.join(',');
      for (const el of Array.from(root.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.right <= width + tol) continue;
        const sel = el.id
          ? `#${el.id}`
          : `${el.tagName.toLowerCase()}${
              (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)[0]
                ? '.' + (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)[0]
                : ''
            }`;
        offenders.push({ sel, exempt: !!el.closest(exemptSel), right: Math.round(r.right) });
      }

      // Classify BEFORE truncating, and count in the page rather than outside it.
      //
      // This previously returned `offenders.slice(0, 200)` and the caller filtered for
      // non-exempt afterwards. On a page with more than 200 overflowing elements — which the
      // exemption list exists precisely because this app has — a single non-exempt offender
      // in DOM position 201 was discarded, `nonExempt.length` came out 0, and the verdict
      // printed `exempt` instead of `VIOLATION`. A diagnostic that under-reports the thing it
      // exists to find is worse than no diagnostic.
      //
      // The cap now applies only to the sample carried out for display.
      const nonExempt = offenders.filter((o) => !o.exempt);

      // How the marker element, if one was asked about, came out of classification. This is
      // what lets the negative control assert that the element it injected went through the
      // exempt/non-exempt attribution, rather than inferring it from a count or a verdict.
      let markerState = 'not-seen';
      if (marker) {
        const el = document.getElementById(marker);
        const hit = el ? offenders.find((o) => o.sel === `#${marker}`) : undefined;
        if (hit) markerState = hit.exempt ? 'exempt' : 'non-exempt';
      }

      return {
        scrollWidth: sw,
        total: offenders.length,
        nonExemptCount: nonExempt.length,
        firstNonExempt: nonExempt[0]?.sel,
        sample: nonExempt.slice(0, 20),
        marker: markerState,
      };
    },
    { width: REFLOW_WIDTH, exempt: EXEMPT, tol: TOLERANCE, marker: markerId ?? null },
  );

  const overflows = m.scrollWidth > REFLOW_WIDTH + TOLERANCE;
  return {
    ...m,
    overflows,
    verdict: overflows && m.nonExemptCount > 0 ? 'VIOLATION' : overflows ? 'exempt' : 'fits',
  };
}

const page = await context.newPage();
const rows = [];
let couldNotMeasure = 0;

const foreignApiOrigins = watchNuxeoApiOrigins(page, baseUrl);
await gotoOrExit(page, baseUrl, 'reflow-probe', { waitUntil: 'networkidle', timeout: 45_000 });
await requireSessionAdopted(page, user, 'reflow-probe', { baseUrl, foreignApiOrigins });

for (const [label, route, host] of ROUTES) {
  try {
    await unfreezeMotion(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 45_000 });

    // `goto` to another `/#/…` is same-document, so `networkidle` resolves at once; this is
    // the wait the load actually gets. Same definition as the specs.
    const unsettled = await screenUnsettledReason(page, { host, treeRequired: route === '/#/browse' });
    if (unsettled) {
      couldNotMeasure += 1;
      rows.push({ label, error: unsettled });
      continue;
    }

    // Waiting for the host is not enough, and the `/me` preflight does not cover this: it
    // proves the backend is reachable, not that THIS route's data request succeeded. A route
    // whose data failed renders the same host with an error panel inside it, and an error
    // panel is the one layout guaranteed not to overflow — it would be measured as `fits`.
    const unusable = await surfaceUnusableReason(page, host, label);
    if (unusable) {
      couldNotMeasure += 1;
      rows.push({ label, error: unusable });
      continue;
    }

    await page.setViewportSize({ width: REFLOW_WIDTH, height: REFLOW_HEIGHT });
    if (!(await layoutHeldStill(page))) {
      couldNotMeasure += 1;
      rows.push({
        label,
        error: 'the layout was still changing 300 frames (about 5s) after the resize',
      });
      continue;
    }
    const revealed = await revealContentBehindDrawer(page, host);
    // The host's width behind the open drawer; absent when the drawer was not open.
    const behindDrawer = revealed.drawerWasOpen ? { width: revealed.widthBehindDrawer ?? null } : undefined;
    if (revealed.error) {
      couldNotMeasure += 1;
      rows.push({ label, behindDrawer, error: revealed.error });
      continue;
    }
    await freezeMotion(page);
    if (!(await layoutHeldStill(page))) {
      couldNotMeasure += 1;
      rows.push({
        label,
        behindDrawer,
        error: 'the layout was still changing 300 frames (about 5s) after motion was frozen',
      });
      continue;
    }
    // The narrow layout can start loads of its own — a re-rendered list fetching thumbnails.
    // No tree is required: the drawer that holds it was closed above, or was never open.
    const unsettledNarrow = await screenUnsettledReason(page, { host, treeRequired: false });
    if (unsettledNarrow) {
      couldNotMeasure += 1;
      rows.push({ label, behindDrawer, error: `after the resize: ${unsettledNarrow}` });
      continue;
    }

    const m = await measureReflow(page);
    rows.push({
      label,
      behindDrawer,
      scrollWidth: m.scrollWidth,
      overflows: m.overflows,
      total: m.total,
      nonExempt: m.nonExemptCount,
      firstNonExempt: m.firstNonExempt,
      verdict: m.verdict,
    });
  } catch (err) {
    couldNotMeasure += 1;
    rows.push({
      label,
      error: err instanceof Error ? err.message.split('\n')[0] : String(err),
    });
  }
}

// Only the measurement context. The browser stays open because the negative control below
// needs it for its own signed-in context — it used to launch a second browser, which is what
// let it quietly skip the session init script the first one had.
await context.close();

console.log(`\nreflow probe @ ${REFLOW_WIDTH}x${REFLOW_HEIGHT} — ${baseUrl}\n`);
console.log(
  `  ${'route'.padEnd(22)}${'scrollW'.padStart(8)}${'overflowing'.padStart(13)}${'non-exempt'.padStart(12)}  verdict`,
);
console.log(`  ${'-'.repeat(70)}`);
for (const r of rows) {
  if (r.error) {
    console.log(`  ${r.label.padEnd(22)}${'—'.padStart(8)}${''.padStart(13)}${''.padStart(12)}  could not measure: ${r.error}`);
    continue;
  }
  console.log(
    `  ${r.label.padEnd(22)}${String(r.scrollWidth).padStart(8)}${String(r.total).padStart(13)}${String(r.nonExempt).padStart(12)}  ${r.verdict}` +
      (r.firstNonExempt ? `  (${r.firstNonExempt})` : '') +
      (r.behindDrawer
        ? `  [content ${r.behindDrawer.width}px wide behind the nav drawer; measured after closing it]`
        : ''),
  );
}

const violations = rows.filter((r) => r.verdict === 'VIOLATION');
const exempted = rows.filter((r) => r.verdict === 'exempt');
const fits = rows.filter((r) => r.verdict === 'fits');
const measured = rows.filter((r) => !r.error);
const behindDrawer = rows.filter((r) => r.behindDrawer);
console.log(
  [
    '',
    behindDrawer.length > 0
      ? `  ${behindDrawer.length} route(s) opened at ${REFLOW_WIDTH}px behind the nav drawer, with the feature content\n` +
        '  only as wide as each row says, until the user closes the drawer from its rail item. A scan of\n' +
        '  that state measures the drawer, not the screen; rows marked so were measured after closing it.'
      : '',
    `  ${violations.length} route(s) overflow via a NON-exempt element — a11y-scout should report these`,
    `  ${exempted.length} route(s) overflow only inside exempt subtrees (table/pre/svg) — correctly silent`,
    `  ${fits.length} route(s) do not scroll horizontally at all (scrollWidth <= ${REFLOW_WIDTH + TOLERANCE})`,
    '',
    // Said only when this run shows it, because the two middle columns invite the opposite
    // reading: a route that fits while elements extend past the viewport. Those elements never
    // reach the document's scroll extent — on 2026-10-02, with the drawer closed, their nearest
    // ancestor with `overflow-x` other than `visible` was inside the content: Material tab label
    // strips and tab bodies (`hidden`), and scroll containers (`auto`) such as `div.result-list`
    // on search and trash and `div.browse-table-wrapper` on browse. This used to blame the
    // "closed" drawer, which was open and was the only thing being measured.
    //
    // The scanner returns early on `scrollWidth` and never attributes them. That is a limit of
    // this check, not a pass: whether those regions make the user scroll in two dimensions for
    // content 1.4.10 does not exempt is not decided here.
    fits.some((r) => r.total > 0)
      ? `  Note: on ${fits.filter((r) => r.total > 0).length} route(s) that fit, elements extend past ${REFLOW_WIDTH}px without reaching\n` +
        "  the document's scroll extent — clipped or scrolled inside a container, or positioned out of\n" +
        '  flow — so the scanner returns a pass before attribution runs. Horizontal scrolling inside a\n' +
        '  region is NOT measured by this check either way.'
      : '',
    '',
    measured.length === 0
      ? ''
      : violations.length > 0
        ? '  a11y-scout reported ZERO reflow findings. Any VIOLATION above is a scanner defect.'
        : '  Consistent with a11y-scout reporting zero — but a zero that was never seen to be a',
    measured.length === 0 || violations.length > 0
      ? ''
      : NEGATIVE_CONTROL
        ? '  non-zero proves nothing. The negative control below is that non-zero.'
        : '  non-zero proves nothing. Re-run with --negative-control.',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n') + '\n',
);

/**
 * Negative control: inject a 900px-wide, non-exempt element and confirm the verdict flips.
 *
 * What this proves and what it does not. It exercises the same algorithm the scanner runs —
 * resize, read `scrollWidth`, attribute the first offender outside `EXEMPT_SELECTORS` — and
 * shows that path reaching VIOLATION on this application. It does **not** execute a11y-scout's
 * own binary, so it validates the logic this probe reproduces rather than the package. That is
 * the honest limit of a control written outside the tool.
 */
if (NEGATIVE_CONTROL) {
  // The SAME signed-in context helper the measurement loop uses. Previously this built its
  // own context with `httpCredentials` only, so it was never past the route guard.
  //
  // And the SAME sequence: load wide, assert the surface, then resize. Creating the context
  // at 320x256 and navigating straight into it does not work — `lib-browse` never becomes
  // visible at that width, so the control aborted with "never became visible" on a page that
  // the measurement loop had just measured successfully. The loop loads at 1440x900 first for
  // this reason; the control has to do the same or it is not reproducing the loop.
  const ctx2 = await newSignedInContext(1440, 900);
  const p2 = await ctx2.newPage();
  // `gotoOrExit`, not a bare `goto`: the control cannot treat a navigation failure as a
  // result. If browse will not load, the detection path was not exercised either way, and
  // reporting that as a failed control would say the probe is broken when the app is absent.
  const foreignApiOrigins2 = watchNuxeoApiOrigins(p2, baseUrl);
  await gotoOrExit(p2, `${baseUrl}/#/browse`, 'reflow-probe (negative control)', {
    waitUntil: 'networkidle',
    timeout: 45_000,
  });
  await requireSessionAdopted(p2, user, 'reflow-probe (negative control)', {
    baseUrl,
    foreignApiOrigins: foreignApiOrigins2,
  });

  // Same check as the measurement loop. A control run against an error panel would still
  // "prove" the detection path works, but it would prove it on a page nobody is measuring.
  const controlUnusable =
    (await screenUnsettledReason(p2, { host: 'lib-browse', treeRequired: true })) ??
    (await surfaceUnusableReason(p2, 'lib-browse', 'negative control'));
  if (controlUnusable) {
    console.error(`\nreflow-probe: cannot run the negative control — ${controlUnusable}\n`);
    await ctx2.close();
    await browser.close();
    process.exit(2);
  }

  await p2.setViewportSize({ width: REFLOW_WIDTH, height: REFLOW_HEIGHT });
  // The loop's order exactly: reveal before freezing motion, or the drawer cannot finish closing.
  let controlNarrowUnsettled = (await layoutHeldStill(p2))
    ? (await revealContentBehindDrawer(p2, 'lib-browse')).error
    : 'the layout never held still after the resize';
  if (!controlNarrowUnsettled) {
    await freezeMotion(p2);
    controlNarrowUnsettled = (await layoutHeldStill(p2))
      ? await screenUnsettledReason(p2, { host: 'lib-browse', treeRequired: false })
      : 'the layout never held still after motion was frozen';
  }
  if (controlNarrowUnsettled) {
    console.error(`\nreflow-probe: cannot run the negative control — ${controlNarrowUnsettled}\n`);
    await ctx2.close();
    await browser.close();
    process.exit(2);
  }

  const MARKER = 'reflow-negative-control';

  // Both measurements go through `measureReflow`, the function the route loop uses, so the
  // control exercises the exempt/non-exempt attribution rather than only `scrollWidth`.
  const before = await measureReflow(p2, MARKER);
  await p2.evaluate((id) => {
    const d = document.createElement('div');
    d.id = id;
    d.style.cssText = 'width:900px;height:8px;background:red';
    document.body.appendChild(d);
  }, MARKER);
  // Reading layout forces it, so the measurement below would see the element without this.
  // The wait is for whatever the injection sets off — a resize observer, a re-render — to
  // finish first. Whether the element itself was classified is the `marker` field, checked
  // below; stillness proves nothing about it.
  if (!(await layoutHeldStill(p2))) {
    console.error('\nreflow-probe: cannot run the negative control — the layout never settled after the injection\n');
    await ctx2.close();
    await browser.close();
    process.exit(2);
  }
  const after = await measureReflow(p2, MARKER);
  await ctx2.close();

  // The claim is that the INJECTED ELEMENT was classified non-exempt by the real attribution
  // path — not that a verdict changed.
  //
  // Asserting a transition to VIOLATION was wrong, and wrong in a way that punishes a true
  // positive: on a browse page that already has a genuine reflow violation, `before.verdict`
  // is already VIOLATION, the transition never happens, and the control reports failure and
  // exits 1 — turning a real finding into a broken run, which is exactly the "findings do not
  // fail the run" promise this file makes three lines further down. Flagged in review on #225.
  //
  // `marker` answers the question directly: the element went in, and classification put it in
  // the non-exempt bucket. That holds whether or not the page was already violating, and it
  // still fails if the exemption logic is broken.
  //
  // It is not the whole path, though. The marker proves attribution; the verdict is a separate
  // step, and a control that stopped at the marker reported WORKS even if the verdict still
  // read `fits` with a 900px element sticking out. So the post-injection verdict must also be
  // VIOLATION — an absolute state, not a transition, which still passes on a page that was
  // already violating. Flagged in review on PR #225.
  const fired =
    before.marker === 'not-seen' && after.marker === 'non-exempt' && after.verdict === 'VIOLATION';
  console.log(
    [
      `  negative control — a 900px div (#${MARKER}) appended to /#/browse`,
      `    before : scrollWidth ${before.scrollWidth}, non-exempt ${before.nonExemptCount}, marker ${before.marker}  ->  ${before.verdict}`,
      `    after  : scrollWidth ${after.scrollWidth}, non-exempt ${after.nonExemptCount}, marker ${after.marker}  ->  ${after.verdict}`,
      `    detection path     : ${fired ? 'WORKS — the injected element was classified non-exempt by the real attribution path' : `DID NOT FIRE (marker ${before.marker} -> ${after.marker}, verdict after ${after.verdict}) — the zero above is not trustworthy`}`,
      '',
    ].join('\n'),
  );
  if (!fired) {
    await browser.close();
    process.exit(1);
  }
}

await browser.close();

// 0 measured, 2 could not measure. Findings do not fail the run — this is a diagnostic, and a
// diagnostic that turns the build red is one people stop running.
// ANY unmeasured route is exit 2, not just all of them.
//
// This used to be `couldNotMeasure === rows.length`, so six measured routes and one that
// never rendered exited 0 and read as a clean seven-route pass. The authoring guide states
// the contract this file is meant to follow — "it must ALWAYS return 2 rather than 0 when it
// could not measure, because a scan that silently did not happen must never read as clean" —
// and a partial run is exactly that. The surface checks added in 4c288808d made partial runs
// more likely, which is how this surfaced. Flagged in review on PR #225.
if (couldNotMeasure > 0) {
  console.error(
    `\nreflow-probe: ${couldNotMeasure} of ${rows.length} route(s) could not be measured, so this\n` +
      '  is an incomplete result rather than a clean one. See the rows marked with an error above.\n',
  );
  process.exit(2);
}
process.exit(0);
