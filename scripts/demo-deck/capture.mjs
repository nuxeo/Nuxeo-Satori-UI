#!/usr/bin/env node
/**
 * Demo-deck evidence capture, with six gates.
 *
 * Produces presentation-quality screenshots for `docs/demo-deck-plan.md`, and **refuses to produce
 * a misleading set**. That refusal is the point of this file, so the gates are worth stating.
 *
 * `docs/beta-demo-runbook.md` Part 6 F8 records what the previous showcase capture shipped: three
 * of ten screenshots byte-identical, and steps 8-10 photographing the repository root, so panels
 * captioned "reads real Nuxeo ACLs" showed "no local permissions" — while the run reported 21 of 22
 * checks green. Confirmed by inspection before this file was written: in
 * `showcase-adf-hx/2026-08-20T14-07-03/`, three files are exactly 64,105 bytes and two are 74,300.
 *
 * A screenshot is the one evidence form where a caption and its content can disagree silently and
 * nobody notices until it is on a projector. Hence:
 *
 *   1. DEDUP        — SHA-256 every capture; any two identical images fail the run.
 *   2. CONTENT      — each shot declares text that MUST be present in the live DOM.
 *   3. ROUTE        — the committed URL must match the shot's intent.
 *   4. RELOAD       — manifest-dependent shots do a real `page.reload()`. `withHashLocation()`
 *                     makes `goto('/#/x')` same-document, so `APP_INITIALIZER` never re-runs and a
 *                     stale manifest survives a navigation that looks like a fresh load.
 *   5. CONSOLE      — only the documented-expected errors are tolerated; anything else fails.
 *   6. DIMENSIONS   — one viewport and one deviceScaleFactor throughout, so slides look consistent.
 *
 * Gates 1-3 are falsifiable from the command line, and MUST be watched failing before the output is
 * trusted:
 *
 *   node scripts/demo-deck/capture.mjs --negative-control=route     # shot points at a wrong URL
 *   node scripts/demo-deck/capture.mjs --negative-control=content   # shot expects absent text
 *   node scripts/demo-deck/capture.mjs --negative-control=dedup     # same shot captured twice
 *
 * Each must exit non-zero and name the failing shot. A gate nobody has watched fail is the artifact
 * F8 describes.
 *
 * Usage:
 *   node scripts/demo-deck/capture.mjs [--only=id,id] [--out=DIR]
 *
 * Requires: Nuxeo on :8080, product app on :4200, template app on :4310.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { EVIDENCE_ROOT } from '../collect-evidence/evidence-path.mjs';

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  console.error('Playwright required: npm install --no-save @playwright/test');
  process.exit(1);
}

const ARGV = process.argv.slice(2);
const arg = (name) =>
  ARGV.find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');

const APP = process.env['APP_URL'] ?? 'http://localhost:4200';
const TEMPLATE = process.env['TEMPLATE_URL'] ?? 'http://localhost:4310';
const USER = process.env['NUXEO_USER'] ?? 'Administrator';
const PASS = process.env['NUXEO_PASS'] ?? 'Administrator';

/** Gate 6: one viewport, one scale, for every shot. */
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;

const NEGATIVE_CONTROL = arg('negative-control') ?? null;
const ONLY =
  arg('only')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? null;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(arg('out') ?? resolve(EVIDENCE_ROOT, 'demo', `capture-${stamp}`));

/**
 * Gate 5 allowlist — the four errors this deployment is DOCUMENTED to produce, and nothing else.
 *
 * Deliberately narrow. The runbook's own F8 postmortem notes the previous harness allowlisted
 * 'Failed to load resource', which would have hidden any resource failure at all. These are matched
 * as substrings of the console text, each tied to a stated cause:
 *
 *   - AI.Insights 500      — the AI marketplace package is not installed. Expected, not a defect.
 *   - group/Administrator  — Administrator is a user, not a group; the permissions panel probes both.
 */
const CONSOLE_ALLOW = [
  'automation/AI.Insights',
  'api/v1/group/Administrator',
  // A FOURTH expected failure, found by this gate on its first honest run and documented in no
  // runbook. `AuthService.clearStaleNuxeoCookieSession()` GETs /nuxeo/logout to drop a stale
  // JSESSIONID before login, and swallows the result with `catchError(() => of(undefined))` — so the
  // 404 is tolerated by design and reaches no user.
  //
  // Allowlisted with a caveat rather than silently: measured against this Nuxeo, `GET /nuxeo/logout`
  // answers **404** while `GET /nuxeo/logout?requestedUrl=/nuxeo/` answers **302**. The call omits
  // that parameter, so it very likely never clears the cookie session it exists to clear, and the
  // `catchError` hides that. Out of scope for the deck; worth a look on its own.
  'nuxeo/logout',
];

/**
 * Expand the navigation rail before capturing it.
 *
 * The rail is collapsed by default, so labels are hidden by CSS and a relabelled or added entry shows
 * only as an icon. Measured in the runbook: every item's `innerText` is empty while `textContent`
 * reads correctly — which means a shot of the collapsed rail would pass a text assertion and prove
 * nothing to a viewer. Any slide about nav labels must expand it first.
 */
const expandNav = async (page) => {
  const toggle = page.locator('button[aria-label*="nav" i], button[aria-label*="menu" i]').first();
  if (await toggle.count()) await toggle.click({ timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
};

/**
 * The shot list.
 *
 * `expect` is Gate 2 and is not optional — a shot with nothing to assert is a shot that cannot tell
 * you it photographed the wrong thing. `manifest` applies a Layer 1 manifest and forces Gate 4's
 * real reload. `act` runs interactions the shot needs (ticking a checkbox, opening a tab) before
 * the capture.
 */
const ACME_BRANDING = {
  branding: { applicationTitle: 'Acme Insurance', documentTitle: 'Acme Insurance' },
  defaultThemeId: 'acme',
  themes: [
    {
      id: 'acme',
      label: 'Acme Brand',
      base: 'light',
      preview: {
        sidebar: '#2d0b4e',
        surface: '#f6f2fb',
        header: '#e6dcf5',
        accent: '#7b2ff7',
        tile: '#d9c9f0',
      },
      tokens: { '--mat-sys-primary': 'rgb(123, 47, 247)', '--agentic-pill-radius': '4px' },
    },
  ],
};

/**
 * The custom-pages manifest, shared by both shots of that pair.
 *
 * Declared once rather than copied: two shots captioned "the entries" and "the page it routes to"
 * must demonstrably come from the SAME manifest, or the pair proves nothing about either.
 */
const CUSTOM_PAGES_MANIFEST = {
  version: 1,
  extensions: {
    $name: 'acme-insurance',
    overrides: {
      'app.navbar.browse': { label: 'Claim Files', order: 10 },
      'app.navbar.knowledgeDiscovery': { visible: false },
    },
    slots: {
      // The `routes` slot went live in 7fd5e46. `app.page.contracts` is registered in
      // provide-app-extensions.ts, so the manifest supplies the route AND the entries.
      routes: [{ id: 'app.page.contracts', path: 'contracts', order: 10 }],
      navbar: [
        {
          id: 'acme.navbar.contracts',
          label: 'Contracts',
          path: '/contracts',
          icon: 'gavel',
          order: 15,
        },
        {
          id: 'acme.navbar.renewals',
          label: 'Renewals',
          path: '/contracts',
          icon: 'autorenew',
          order: 16,
        },
        {
          id: 'acme.navbar.compliance',
          label: 'Compliance',
          path: '/contracts',
          icon: 'verified',
          order: 17,
        },
      ],
    },
  },
};

const SHOTS = [
  // =====================================================================================
  // TRACK A — customise the shipped app. Every "after" here is produced by an edit to
  // the bootstrap or manifest configuration (see `configLayer`). No rebuild, no deploy.
  // =====================================================================================
  {
    id: 'a0-browse-before',
    slide: 'Baseline — the product as shipped',
    base: APP,
    route: '/#/browse/default-domain',
    manifest: { version: 1 },
    expect: ['Workspaces', 'Last Contributor'],
    waitFor: 'lib-browse',
  },
  {
    // The domain-vocabulary pair. This replaces an earlier pair that relabelled two strings on the
    // Themes settings page — true, but the weakest possible example of Layer 0: nobody buys a product
    // because a settings heading can be renamed. What a customer actually wants is their own domain
    // language across the surfaces their users look at all day.
    id: 'a1-vocab-before',
    slide: 'Their language — before',
    base: APP,
    route: '/#/browse/default-domain',
    manifest: { version: 1 },
    act: expandNav,
    expect: ['Browse', 'Collections', 'Tasks', 'Last Contributor'],
    waitFor: 'lib-browse',
  },
  {
    id: 'a1-vocab-after',
    slide: 'Their language — after',
    base: APP,
    route: '/#/browse/default-domain',
    manifest: {
      version: 1,
      extensions: {
        $name: 'acme-insurance',
        overrides: {
          // Every nav id the product renders is relabellable this way.
          'app.navbar.browse': { label: 'Claim Files', order: 10 },
          'app.navbar.collections': { label: 'Policies', order: 20 },
          'app.navbar.tasks': { label: 'Underwriting Queue', order: 30 },
          'app.navbar.favorites': { label: 'Flagged Claims', order: 40 },
          'app.navbar.expiredQueue': { label: 'Lapsed Policies', order: 50 },
          'app.navbar.recentlyViewed': { label: 'Recent Activity', order: 60 },
          // Irrelevant to this customer — hidden outright.
          'app.navbar.knowledgeDiscovery': { visible: false },
          'app.navbar.assets': { visible: false },
          // The list speaks their language too.
          'app.documentList.lastContributor': { label: 'Adjuster', order: 5 },
        },
      },
    },
    act: expandNav,
    expect: ['Claim Files', 'Policies', 'Underwriting Queue', 'Adjuster'],
    domAssert: () => !document.body.innerText.includes('Knowledge Discovery'),
    waitFor: 'lib-browse',
  },
  {
    // Custom PAGES, plural, and reachable — the point a single-nav-entry shot did not make.
    // `routes` contributes the route, `navbar` the entries, and both resolve `app.page.contracts`
    // through the component registry.
    //
    // Split into two shots deliberately. The expanded drawer is an OVERLAY: with it open the page
    // heading is clipped, so one image cannot show both the new entries and the page they reach.
    id: 'a2-custom-nav',
    slide: 'Custom pages — the entries a manifest added',
    base: APP,
    route: '/#/contracts',
    manifest: CUSTOM_PAGES_MANIFEST,
    act: expandNav,
    expect: ['Contracts', 'Renewals', 'Compliance'],
    waitFor: 'body',
  },
  {
    id: 'a2-custom-page',
    slide: 'Custom pages — the page it routes to',
    base: APP,
    route: '/#/contracts',
    manifest: CUSTOM_PAGES_MANIFEST,
    // No expandNav: the rail stays collapsed so the page itself is unobstructed.
    expect: ['Expiring Soon'],
    waitFor: 'app-contracts-page, body',
  },
  {
    id: 'a3-rebrand-before',
    slide: 'Rebrand — before',
    base: APP,
    route: '/#/settings/themes',
    manifest: { version: 1 },
    expect: ['Nuxeo'],
    domAssert: () => !document.body.innerText.includes('Acme Brand'),
    waitFor: 'body',
  },
  {
    // Layer 0 branding is bootstrap configuration, not the manifest — a distinction that trips people
    // up, and the reason `runtime-manifest.ts` has no `branding` or `themes` key at all.
    id: 'a3-rebrand-after',
    slide: 'Rebrand — the result',
    base: APP,
    route: '/#/settings/themes',
    bootstrap: ACME_BRANDING,
    expect: ['Acme Brand'],
    waitFor: 'body',
  },
  {
    // The column PICKER, opened. A shot of the resulting table shows the outcome but not the
    // control, so it cannot show the difference between `disabled` (taken away from the user
    // entirely) and `hiddenByDefault` (offered, starting unchecked).
    id: 'a3-columns-picker',
    slide: 'Columns — the picker a manifest shapes',
    base: APP,
    route: '/#/browse/default-domain',
    manifest: {
      version: 1,
      extensions: {
        overrides: {
          'app.documentList.lastContributor': { label: 'Adjuster', order: 5 },
        },
        slots: {
          documentList: [
            // Removed from the picker outright — the user cannot turn it back on.
            { id: 'app.documentList.state', disabled: true },
            // Offered in the picker, but unchecked to begin with.
            { id: 'app.documentList.version', hiddenByDefault: true },
          ],
        },
      },
    },
    act: async (page) => {
      await page.waitForTimeout(2500);
      const opener = page
        .locator(
          'button[aria-label*="column" i], button[title*="column" i], ' +
            'button:has-text("Manage columns"), button:has-text("Columns")',
        )
        .first();
      if (await opener.count()) await opener.click({ timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(1800);
    },
    expect: ['Version'],
    domAssert: () => !document.body.innerText.includes('State'),
    waitFor: 'lib-browse',
  },
  {
    id: 'a4-bulk-two-selected',
    slide: 'Bulk actions — two rows selected',
    base: APP,
    route: '/#/browse/default-domain',
    manifest: {
      version: 1,
      extensions: {
        overrides: { 'app.bulkActions.publish': { visible: false } },
        slots: {
          'bulk-actions': [
            { id: 'acme.bulkActions.archive', label: 'Archive', icon: 'inventory_2', order: 15 },
            {
              id: 'acme.bulkActions.merge',
              label: 'Merge selected',
              icon: 'merge',
              order: 25,
              rule: 'app.rules.hasMultipleSelection',
            },
            {
              id: 'acme.bulkActions.review',
              label: 'Send for review',
              icon: 'rate_review',
              order: 26,
              enabledRule: 'app.rules.hasMultipleSelection',
            },
          ],
        },
      },
    },
    act: async (page) => {
      await page.waitForTimeout(2500);
      const boxes = page.locator('lib-browse input[type="checkbox"]');
      const n = await boxes.count();
      if (n >= 3) {
        await boxes.nth(1).click({ force: true, timeout: 8000 });
        await boxes.nth(2).click({ force: true, timeout: 8000 });
      }
      await page.waitForTimeout(1500);
    },
    // The bulk topbar renders ICON-ONLY buttons, so these labels live in `aria-label`/`title` and
    // never appear in `innerText`. The first cut asserted them as text and failed while the feature
    // worked perfectly — the capture clearly showed "All 2 item(s) selected" and the manifest's three
    // actions present. Assert where the label actually is.
    expect: ['All 2 item(s) selected'],
    domAssert: () => {
      const labels = [...document.querySelectorAll('[aria-label], [title]')]
        .map((el) => el.getAttribute('aria-label') || el.getAttribute('title'))
        .join(' | ');
      return (
        labels.includes('Archive') &&
        labels.includes('Merge selected') &&
        labels.includes('Send for review')
      );
    },
    waitFor: 'lib-browse',
  },

  // =====================================================================================
  // TRACK B — build a UI from scratch on the published package. A separate app on :4310,
  // importing only @nuxeo/satori-platform entry points.
  // =====================================================================================
  // The template app authenticates through its OWN login form — it does not share the product's
  // session. Without `signIn`, every one of these captures the login page instead of the page named,
  // and an assertion like 'Components' passes anyway because it matches the nav entry "UI
  // Components" in the sidebar. That happened, and it is the third time in this harness that a
  // string matched chrome rather than content. Assertions below are strings that exist ONLY in the
  // page body.
  {
    id: 'b1-template-stats',
    slide: 'From scratch — the Statistics page',
    base: TEMPLATE,
    route: '/stats',
    signIn: true,
    expect: ['Quick Statistics'],
    domAssert: () => !document.querySelector('input[type="password"]'),
    waitFor: 'lib-widget-grid, app-stats',
  },
  {
    // The template's own repository browser — the page a customer's users would actually live in,
    // and it was missing from the deck entirely.
    id: 'b0-template-documents',
    slide: 'From scratch — browsing the real repository',
    base: TEMPLATE,
    route: '/documents',
    signIn: true,
    domAssert: () => !document.querySelector('input[type="password"]'),
    expect: ['adf-datatable-marker'],
    waitFor: 'app-documents, body',
  },
  {
    id: 'b1b-template-case-file',
    slide: 'From scratch — an ECM working surface',
    base: TEMPLATE,
    route: '/case-file',
    signIn: true,
    // Select the first document so metadata, actions and the preview are all populated. An empty
    // case-file page shows three "Select a document" placeholders and proves nothing.
    act: async (page) => {
      await page.waitForTimeout(3000);
      // Click rows until the preview actually renders, rather than guessing from the row's type.
      //
      // Two earlier guesses were both wrong: the first row was a Workspace, and the first row
      // labelled `File` had no `file:content` either — Nuxeo's `File` type does not imply an
      // attachment. Only 5 of 46 documents in this repository carry a blob. Selecting by observed
      // OUTCOME is data-independent, and it is the only version of this that cannot quietly
      // photograph an empty viewer.
      const rows = page.locator('.case-file__row');
      const count = Math.min(await rows.count(), 12);
      for (let i = 0; i < count; i += 1) {
        await rows
          .nth(i)
          .click({ timeout: 10000 })
          .catch(() => undefined);
        // Metadata is one round trip and the blob a second, so both need time to land.
        await page.waitForTimeout(3500);
        const rendered = await page.evaluate(
          () =>
            !!document.querySelector('lib-document-viewer') &&
            !document.body.innerText.includes('No attachment on this document'),
        );
        if (rendered) return;
      }
    },
    expect: ['Case File', 'Metadata', 'Actions', 'Preview'],
    // The viewer must be present AND the placeholder absent — otherwise a slide about a document
    // preview can ship a picture of the words "No attachment on this document".
    domAssert: () =>
      !document.querySelector('input[type="password"]') &&
      !!document.querySelector('lib-document-viewer') &&
      !document.body.innerText.includes('No attachment on this document'),
    waitFor: 'app-case-file, body',
  },
  {
    id: 'b2-template-components',
    slide: 'From scratch — the platform UI components',
    base: TEMPLATE,
    route: '/components',
    signIn: true,
    domAssert: () => !document.querySelector('input[type="password"]'),
    expect: ['adf-datatable-marker'],
    waitFor: 'lib-widget-container, app-components',
  },
  {
    id: 'b3-template-diagnostics',
    slide: 'From scratch — what the app can see',
    base: TEMPLATE,
    route: '/home',
    signIn: true,
    domAssert: () => !document.querySelector('input[type="password"]'),
    expect: ['adf-datatable-marker'],
    waitFor: 'body',
  },
];

/**
 * Sign in through the template app's own login form.
 *
 * Reuses the product's credentials but not its session: the template is a separate application with
 * its own `TemplateSessionService`, so seeding the product's `sessionStorage` does nothing here.
 */
async function signInToTemplate(page) {
  await page.goto(`${TEMPLATE}/home`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const pw = page.locator('input[type="password"]');
  if (!(await pw.count())) return; // already signed in
  await page.locator('input').first().fill(USER);
  await pw.first().fill(PASS);
  await page.getByRole('button', { name: /sign in/i }).click({ timeout: 15000 });
  await page.waitForTimeout(3000);
}

/**
 * Gate 2 has two forms because text is not always enough.
 *
 * `expect` matches strings in the DOM. `domAssert` runs a predicate in the page for the cases where
 * presence of a *structure* is the claim — "there is a table with rows" is not a string, and the
 * string that stood in for it matched a paragraph of prose instead.
 */
const STRUCTURAL_MARKER = 'adf-datatable-marker';

// ---------------------------------------------------------------------------------------------
// Configuration. Both halves are files the dev server serves from the gitignored
// `apps/nuxeo-ui/public/agentic-ui-config/`, each the configuration servlet's envelope of
// fragments, written by `npm run config:dev`. A shot's branding or manifest is applied as one more
// fragment — `demo-deck`, after ours, as a customer package's would be — and withdrawn after it.
//
// The dev server serves only asset files that existed when it started — a file created afterwards
// stays 404 while edits to an existing one are re-served — so the files must exist before
// `nx serve`. A file on disk does not prove the server sees it, so this asks the running server
// instead, and refuses rather than patch a file nothing serves.
//
// Doing this inside the run rather than by hand matters for a reason that already bit once: with the
// rebrand left applied, the BASELINE capture came back in Acme purple while its slide called it "the
// product as shipped". Patch it for the shots that need it, restore it immediately after, and the
// mismatch cannot happen.
// ---------------------------------------------------------------------------------------------
const CONFIG_DIR = resolve(
  import.meta.dirname,
  '..',
  '..',
  'apps/nuxeo-ui/public/agentic-ui-config',
);
const DEMO_FRAGMENT = 'demo-deck';

function configLayer(layer) {
  const file = resolve(CONFIG_DIR, `${layer}.json`);
  const servedUrl = new URL(`/agentic-ui-config/${layer}.json`, APP).href;
  let original = null;

  const fetchServed = async () => {
    const res = await fetch(servedUrl, { cache: 'no-store' }).catch(() => null);
    return res?.ok ? res.json().catch(() => null) : null;
  };

  const write = async (content) => {
    const served = await fetchServed();
    if (!existsSync(file) || served?.format !== 'nuxeo-agentic-ui-config/1') {
      throw new Error(
        `${servedUrl} is not serving a configuration response, so a patch to ${file} would not ` +
          'take effect. The dev server only serves a file that existed when it started. Write ' +
          'both files, then restart nx serve:\n  npm run config:dev',
      );
    }
    const raw = await readFile(file, 'utf8');
    if (original === null) original = raw;
    const envelope = JSON.parse(original);
    envelope.fragments = [
      ...envelope.fragments.filter((fragment) => fragment.name !== DEMO_FRAGMENT),
      {
        name: DEMO_FRAGMENT,
        component: 'local.demo-deck',
        bundle: 'local.demo-deck',
        source: 'scripts/demo-deck/capture.mjs',
        content,
      },
    ];
    await writeFile(file, `${JSON.stringify(envelope, null, 2)}\n`);
    const expected = JSON.stringify(envelope);
    for (let waited = 0; waited < 15000; waited += 500) {
      if (JSON.stringify(await fetchServed()) === expected) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    await restore();
    throw new Error(`${servedUrl} did not reflect the patch within 15 s; restored the original.`);
  };

  const restore = async () => {
    if (original === null) return;
    await writeFile(file, original);
    original = null;
    await new Promise((r) => setTimeout(r, 6000));
  };

  return { write, restore };
}

const bootstrapConfig = configLayer('bootstrap');
const manifestConfig = configLayer('manifest');
const patchBootstrap = bootstrapConfig.write;
const restoreBootstrap = bootstrapConfig.restore;
const applyManifest = manifestConfig.write;
const restoreManifest = manifestConfig.restore;

// ---------------------------------------------------------------------------------------------

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  // httpCredentials guarantees Basic on every request to the origin. Seeding the session into
  // sessionStorage alone satisfies the route guard but does not reliably authenticate XHRs, which
  // surfaces as intermittent 403s on /nuxeo/api paths — the Phase 0 harness defect.
  httpCredentials: { username: USER, password: PASS, origin: APP },
});

/**
 * Gate 5, in two halves — and the split is load-bearing.
 *
 * A `console` error for a failed request reads "Failed to load resource: the server responded with
 * a status of 403 (Forbidden)". **The URL is not in that string.** So an allowlist keyed on URL
 * fragments can never match a console message, and the two documented-expected failures would fail
 * every run. The tempting fix — allowlist the substring "Failed to load resource" — is precisely the
 * mistake the F8 postmortem records, because it hides every resource failure there is.
 *
 * So failed *responses* are gated on their URL, where the allowlist means something, and JS
 * exceptions are gated separately and are **never** allowlisted.
 */
/** @type {{url: string, status: number, shot: string}[]} */
const failedResponses = [];
/** @type {{text: string, shot: string}[]} */
const pageErrors = [];
let currentShot = 'startup';

context.on('response', (res) => {
  const status = res.status();
  if (status < 400) return;
  const url = res.url();
  if (CONSOLE_ALLOW.some((allowed) => url.includes(allowed))) return;
  failedResponses.push({ url: url.slice(0, 200), status, shot: currentShot });
});

// An uncaught exception is never expected, so it has no allowlist at all.
context.on('weberror', (err) => {
  pageErrors.push({ text: String(err.error()).slice(0, 300), shot: currentShot });
});

const page = await context.newPage();

/**
 * Authenticate as a real user, and do it in the one order that survives this deployment.
 *
 * Seeding `sessionStorage` alone is NOT enough here, and the failure is silent and total. This Nuxeo
 * has **anonymous authentication enabled** — a recorded verified fact in `AGENTS/11-beta-program.md`
 * §3 — so `GET /me` answers `200` as `Anonymous` with no credentials, and the app's intentional
 * SSO-detection path *adopts that session*, overwriting whatever was seeded. Measured directly:
 * after seeding a Basic Administrator session and navigating, `sessionStorage` held
 * `{"kind":"cookie","username":"Anonymous","isAdministrator":false}`.
 *
 * The consequence is a screenshot that looks like a product defect but is an auth artifact: browse
 * renders "Failed to load folder contents." because Anonymous genuinely cannot read the folder, and
 * every protected path answers 403. On the same path an explicit Basic header answers 200.
 *
 * The app *tries* to prevent this — `AuthService.clearStaleNuxeoCookieSession()` GETs `/nuxeo/logout`
 * for exactly this reason — but that call omits Nuxeo's required `requestedUrl` parameter, so it
 * answers 404 and the `catchError` swallows it. So the cookie is cleared here instead, before the
 * session is seeded. Order matters: clear, then seed, then navigate.
 */
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await context.clearCookies();
await page.evaluate(
  (v) => {
    sessionStorage.setItem('agentic_ui_nuxeo_session', v);
    sessionStorage.removeItem('agentic_ui_signed_out');
    // Stored user state beats the manifest, so a leftover column pick or theme would make a
    // customisation shot lie about what produced it.
    localStorage.removeItem('browse_column_settings');
    localStorage.removeItem('agentic_ui_color_theme');
  },
  JSON.stringify({
    kind: 'basic',
    username: USER,
    basic: Buffer.from(`${USER}:${PASS}`).toString('base64'),
    isAdministrator: true,
    groups: [],
  }),
);

/**
 * Gate 0 — refuse to capture anything if we are not who we think we are.
 *
 * Every other gate is downstream of this one. A whole run as `Anonymous` produces images that pass
 * dedup, pass their route assertion, and show empty or error states throughout — the most expensive
 * possible failure, because nothing looks wrong until it is on a slide captioned "real repository".
 */
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const whoami = await page.evaluate(async () => {
  const r = await fetch('/nuxeo/api/v1/me');
  const j = await r.json().catch(() => ({}));
  return j.id ?? j.properties?.username ?? '(unknown)';
});
if (whoami !== USER) {
  console.error(
    `\nABORT: authenticated as "${whoami}", expected "${USER}".\n` +
      'Every capture would show empty or 403 states while passing every other gate.\n' +
      'This deployment has anonymous auth enabled and the app adopts that session; see the\n' +
      'comment above the sign-in block in this file.',
  );
  await browser.close();
  process.exit(1);
}
console.log(`auth ok: ${whoami}\n`);

const results = [];
const shots = ONLY ? SHOTS.filter((s) => ONLY.includes(s.id)) : SHOTS;

try {
  for (const shot of shots) {
    currentShot = shot.id;

    // ---- negative controls: break exactly one gate's input, leave the rest intact ----
    let route = shot.route;
    let expected = [...shot.expect];
    if (NEGATIVE_CONTROL === 'route' && shot === shots[0]) route = '/#/settings/themes';
    if (NEGATIVE_CONTROL === 'content' && shot === shots[0])
      expected = ['ThisStringIsNotOnAnyPage'];

    // Both layers are file edits, so each is applied and withdrawn per shot rather than left in
    // place: with --only, a shot must not inherit whatever the previous selected shot applied.
    if (shot.manifest) await applyManifest(shot.manifest);
    else await restoreManifest();
    if (shot.bootstrap) await patchBootstrap(shot.bootstrap);
    else await restoreBootstrap();
    if (shot.signIn) await signInToTemplate(page);

    const url = `${shot.base}${route}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Gate 4. A manifest- or bootstrap-dependent shot needs a document reload, not a hash
    // navigation: `withHashLocation()` makes `goto('/#/x')` same-document, so `APP_INITIALIZER` —
    // which is what reads bootstrap.json — never runs again.
    if (shot.manifest || shot.bootstrap) {
      await page.reload({ waitUntil: 'domcontentloaded' });
    }

    // A swallowed wait failure is how the false pass happened: the selector never appeared, the run
    // continued, and the shot photographed whatever was on screen. Record it instead of discarding it,
    // so it reaches the report even when the content gate would also have caught it.
    let waitFailed = null;
    try {
      await page.waitForSelector(shot.waitFor, { timeout: 30000 });
    } catch {
      waitFailed = shot.waitFor;
    }
    await page.waitForTimeout(2500);
    if (shot.act) await shot.act(page);

    // Gate 3 — route assertion, against the shot's DECLARED route (`shot.route`), never against the
    // possibly-mutated `route` used to navigate.
    //
    // The first cut compared `landed` against `route`, which the negative control had just rewritten —
    // so it asked "did I arrive where I told myself to go", was true by construction, and passed a
    // deliberate mis-route. Only the content gate caught it. That is the tautological path check this
    // repo has already been burned by once, reproduced exactly.
    const landed = page.url();
    const declared = shot.route.replace(/^\/#/, '#').split('?')[0];
    const routeOk = landed.includes(declared);

    // Gate 2 — content assertion, against the live DOM. Read input VALUES as well as text: adf-core
    // renders property values inside <input> elements, so a text-only assertion passed while the
    // screenshot showed a raw ISO string and [object Object].
    const domText = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input')].map((i) => i.value).join(' ');
      return `${document.body.innerText}\n${inputs}`;
    });
    // Structural claims are checked by predicate, not by text. The marker is swapped out of the
    // string list so it is never searched for literally.
    const textExpected = expected.filter((e) => e !== STRUCTURAL_MARKER);
    const missing = textExpected.filter((e) => !domText.includes(e));
    // `domAssert` runs whenever a shot declares one — NOT only when `expect` carries the structural
    // marker.
    //
    // The first cut gated it on `expected.includes(STRUCTURAL_MARKER)`, which meant any shot with a
    // `domAssert` and ordinary text expectations had its structural assertion **silently skipped**.
    // Three shots were in that state, and one of them asserted that "No attachment on this document"
    // was absent while the capture plainly showed those words. The gate reported `ok`.
    //
    // That is this harness's own failure mode turned inward: an assertion that does not run is worse
    // than no assertion, because it reads as coverage. A skipped check must never be indistinguishable
    // from a passing one.
    if (shot.domAssert) {
      const structureOk =
        NEGATIVE_CONTROL === 'content' && shot === shots[0]
          ? false
          : await page.evaluate(shot.domAssert);
      if (!structureOk) missing.push(`domAssert failed for ${shot.id}`);
    }

    // Callout geometry, read from the live DOM immediately before the screenshot so the boxes and the
    // pixels agree. Rects are CSS px; the PNG is scaled by SCALE, so the consumer multiplies.
    let callouts = null;
    if (shot.callouts) {
      callouts = await page.evaluate((defs) => {
        return defs.map((d) => {
          const el = document.querySelector(d.selector);
          if (!el) return { ...d, found: false };
          const r = el.getBoundingClientRect();
          return {
            ...d,
            found: r.width > 0 && r.height > 0,
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
          };
        });
      }, shot.callouts);
    }

    const file = resolve(outDir, `${shot.id}.png`);
    await page.screenshot({ path: file, fullPage: false });
    const bytes = await readFile(file);
    const sha = createHash('sha256').update(bytes).digest('hex');

    results.push({
      id: shot.id,
      slide: shot.slide,
      url: landed,
      intendedRoute: shot.route,
      navigatedTo: route,
      routeOk,
      waitFailed,
      expected,
      missing,
      sha256: sha,
      bytes: bytes.length,
      file: `${shot.id}.png`,
      scale: SCALE,
      callouts,
    });

    console.log(
      `${missing.length === 0 && routeOk ? 'ok  ' : 'FAIL'} ${shot.id}  ` +
        `${bytes.length} B  sha=${sha.slice(0, 12)}${missing.length ? `  MISSING: ${missing}` : ''}`,
    );

    // dedup negative control: capture the same shot a second time under a different id.
    if (NEGATIVE_CONTROL === 'dedup' && shot === shots[0]) {
      const dupFile = resolve(outDir, `${shot.id}-DUP.png`);
      await page.screenshot({ path: dupFile, fullPage: false });
      const dupBytes = await readFile(dupFile);
      results.push({
        id: `${shot.id}-DUP`,
        slide: shot.slide,
        url: landed,
        intendedRoute: route,
        routeOk: true,
        expected,
        missing: [],
        sha256: createHash('sha256').update(dupBytes).digest('hex'),
        bytes: dupBytes.length,
        file: `${shot.id}-DUP.png`,
      });
    }
  }
} finally {
  // Leave the world at baseline, whatever happened. A harness that leaves customisation applied is
  // exactly how the dirty manifest and the purple baseline both happened.
  await restoreManifest();
  await restoreBootstrap();
  await browser.close();
}

// ---- Gate 1: dedup across the whole run ----
const byHash = new Map();
for (const r of results) {
  if (!byHash.has(r.sha256)) byHash.set(r.sha256, []);
  byHash.get(r.sha256).push(r.id);
}
const duplicates = [...byHash.entries()].filter(([, ids]) => ids.length > 1);

// ---- verdict ----
const failures = [];
for (const r of results) {
  if (!r.routeOk) failures.push(`${r.id}: landed on ${r.url}, expected ${r.intendedRoute}`);
  if (r.missing.length) failures.push(`${r.id}: DOM missing ${JSON.stringify(r.missing)}`);
  if (r.waitFailed) failures.push(`${r.id}: waitFor selector never appeared: ${r.waitFailed}`);
  // A callout that resolved to nothing would be silently omitted from the drawing, leaving an
  // anatomy diagram that is missing a part while looking complete.
  for (const c of r.callouts ?? []) {
    if (!c.found)
      failures.push(`${r.id}: callout "${c.label}" selector matched nothing: ${c.selector}`);
  }
}
for (const [sha, ids] of duplicates) {
  failures.push(`byte-identical captures ${ids.join(' == ')} (sha ${sha.slice(0, 12)})`);
}
for (const r of failedResponses) {
  failures.push(`HTTP ${r.status} during ${r.shot}: ${r.url}`);
}
for (const e of pageErrors) failures.push(`uncaught exception during ${e.shot}: ${e.text}`);

const report = {
  capturedAt: new Date().toISOString(),
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  negativeControl: NEGATIVE_CONTROL,
  shots: results,
  duplicateHashes: duplicates.map(([sha, ids]) => ({ sha, ids })),
  failedResponses,
  pageErrors,
  failures,
  verdict: failures.length === 0 ? 'pass' : 'fail',
};
await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));

console.log(`\n${'='.repeat(70)}`);
console.log(`captures: ${results.length}   distinct images: ${byHash.size}`);
console.log(`output:   ${outDir}`);
if (failures.length) {
  console.log(`\nVERDICT: FAIL — ${failures.length} problem(s)`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\nVERDICT: PASS — every shot asserted its own content, all images distinct');
