/**
 * Phase 1 — Layer 0: upgrade-safe configuration.
 *
 * The claim this phase makes is narrow and testable: **configuration alone
 * changes behaviour, with no rebuild**. Everything below exists to make that
 * falsifiable rather than asserted.
 *
 * The method matters. The customised passes do not edit a file and rebuild —
 * a single route handler answers the exact URL the running application fetches,
 * and the body it serves is swapped between passes. The JavaScript bundle is
 * fetched and hashed on both the default and customised loads and asserted
 * byte-identical, so a difference in the rendered UI can only have come from
 * configuration. That is stronger than editing a source file, which would leave
 * "did the dev server rebuild it?" open.
 *
 * Not every check here is load-bearing. Roughly a third are negative or fallback
 * assertions — `data-app-theme` is non-null, no inline token overrides on the
 * default pass, the default title is unchanged, and both tolerant-failure steps —
 * which would still pass if configuration loading were entirely dead. They are
 * worth keeping as regression guards, but the claim of the phase rests on
 * steps 5-8, where a swapped configuration body has to change observable state.
 *
 * Two things learned while first running this, both encoded below:
 *
 * 1. The handler must be installed **before the first navigation** and must
 *    answer with `Cache-Control: no-store`. Registering it later has no effect,
 *    because the browser serves the already-cached `bootstrap.json` without
 *    issuing a request that interception could see. This cost the first run four
 *    false failures.
 * 2. `/#/settings/themes` is in the settings drawer, so the shell header shows
 *    "Themes" rather than falling back to the branded application title. Branding
 *    is therefore asserted on `document.title`, which is unambiguous and is also
 *    the value a customer notices first.
 * 3. The application uses `withHashLocation()`, so navigating between routes is a
 *    same-document fragment change. `page.goto('/#/other')` therefore does *not*
 *    re-bootstrap Angular, the `APP_INITIALIZER` does not re-run, and swapped
 *    configuration is never fetched. Every configuration change below is followed
 *    by an explicit `reloadApp`. This cost the second run six false failures, and
 *    is exactly the kind of thing a screenshot-only capture would have missed.
 *
 * The steps, in order:
 *   1-4. The packaged default reproduces today's behaviour. If adopting
 *        configuration changed anything for a customer who configured nothing,
 *        the phase would be a regression rather than a feature.
 *   5-7. A customised bootstrap file rebrands the product, overrides theme
 *        tokens and adds a whole theme — same bundle, no rebuild.
 *   8.   The runtime manifest, served as a package's manifest fragment,
 *        relabels the product.
 *   9-10. Tolerant failure: malformed configuration and an absent configuration
 *        service must both leave a working application.
 *
 * Both configuration URLs answer the configuration servlet's envelope
 * (`nuxeo-agentic-ui-config/1`): ordered fragments, one per package. The bodies
 * below are built the way the servlet builds them — our defaults first, then a
 * customer's fragment — so the default passes serve exactly what an install with
 * no customer package serves.
 *
 * Prerequisites:
 *   docker start nuxeo          (container `nuxeo`, published on 8080)
 *   npx nx serve nuxeo-ui       (separate terminal)
 *
 * Run:
 *   npm run beta:evidence -- phase-1-config
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { configResponse } from '../config-response.mjs';

/**
 * Console errors this environment always produces.
 *
 * The first two are carried over from `phase-0-baseline.mjs`: the `AI.*`
 * operations come from a marketplace package that is not installed on a plain
 * local Nuxeo, and the app probes `/nuxeo/logout` on boot.
 *
 * The last two are the tolerant path working as designed, and step 10 induces them
 * on purpose: with no configuration service both URLs 404, and the browser logs a
 * console entry for any 404 regardless of whether the application handled it. Suppressing them here hides
 * nothing: steps 7 and 9 assert the present and absent cases separately, and the
 * count of ignored errors is still reported.
 */
const ENVIRONMENTAL_ERRORS = [
  /automation\/AI\./,
  '/nuxeo/logout',
  '/agentic-ui-config/bootstrap.json',
  '/agentic-ui-config/manifest.json',
];

const BOOTSTRAP_ROUTE = '**/agentic-ui-config/bootstrap.json';
const MANIFEST_ROUTE = '**/agentic-ui-config/manifest.json';
const BOOTSTRAP_PATH = '/agentic-ui-config/bootstrap.json';
const LOCAL_BOOTSTRAP = 'apps/nuxeo-ui/public/agentic-ui-config/bootstrap.json';

const CORE_RESOURCES = 'nuxeo-agentic-core/src/main/resources';

const PACKAGED_BOOTSTRAP = configResponse('bootstrap');
const PACKAGED_MANIFEST = configResponse('manifest');
const DEPLOYMENT_FRAGMENT = readFileSync(
  resolve(process.cwd(), `${CORE_RESOURCES}/OSGI-INF/deployment-fragment.xml`),
  'utf8',
);

const INSTALL_XML = readFileSync(
  resolve(process.cwd(), 'nuxeo-agentic-ui-package/src/main/resources/install.xml'),
  'utf8',
);
/** Production base href of the packaged application. */
const PRODUCTION_BASE_HREF = 'https://server.example/nuxeo/agentic-ui/';
/** Web context path the application and the configuration servlet are mounted under. */
const CONTEXT_PATH = '/nuxeo';

/** The `url-pattern`s the deployment fragment maps the configuration servlet and the auth filter on. */
function deploymentMappings() {
  const patterns = (block) =>
    [...DEPLOYMENT_FRAGMENT.matchAll(new RegExp(`<${block}>([\\s\\S]*?)</${block}>`, 'g'))].map(
      (m) => ({
        name: /<(?:servlet|filter)-name>([^<]+)</.exec(m[1])?.[1] ?? '',
        urls: [...m[1].matchAll(/<url-pattern>([^<]+)</g)].map((u) => u[1].trim()),
      }),
    );
  return { servlets: patterns('servlet-mapping'), filters: patterns('filter-mapping') };
}

/**
 * Servlet-spec `url-pattern` matching for a path inside the context: exact, `/prefix/*`,
 * `*.extension`, and `/` (the default servlet, which every path falls through to).
 */
function urlPatternMatches(pattern, path) {
  if (pattern === '/' || pattern === '/*') return true;
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (pattern.startsWith('*.')) return path.endsWith(pattern.slice(1));
  return pattern === path;
}

/**
 * SHA-256 over the bytes of every `<script src>` the page actually loaded, plus
 * their URLs.
 *
 * The earlier version of this check compared the `src` *attributes*, which in a
 * dev build are the single unhashed `main.js` — so it compared `"main.js"` with
 * `"main.js"` and would have passed after a full rebuild with entirely different
 * bytes. Fetching and hashing the content is what actually makes "no rebuild
 * took place" falsifiable. `page.request` bypasses page routes, so this reads
 * the real bundle rather than an interception fixture.
 *
 * @param {import('@playwright/test').Page} page
 */
async function bundleFingerprint(page) {
  const sources = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')]
      .map((s) => new URL(s.getAttribute('src') ?? '', document.baseURI).href)
      .sort(),
  );
  const digest = createHash('sha256');
  let bytes = 0;
  for (const src of sources) {
    const response = await page.request.get(src, { headers: { 'cache-control': 'no-cache' } });
    const body = await response.body();
    bytes += body.length;
    digest.update(src);
    digest.update(body);
  }
  return { count: sources.length, bytes, digest: digest.digest('hex') };
}

/** Values a customer could plausibly want, chosen so each is visible in the UI. */
const CUSTOMISED_BOOTSTRAP = {
  branding: { applicationTitle: 'Acme Content Cloud', documentTitle: 'Acme Content Cloud' },
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
      // Inline custom properties on <html>: this is what makes a rebrand a JSON
      // edit rather than a Sass change and a new bundle.
      tokens: { '--mat-sys-primary': 'rgb(123, 47, 247)', '--agentic-pill-radius': '4px' },
    },
  ],
};

/** A customer package's manifest fragment. */
const CUSTOMISED_MANIFEST = {
  version: 1,
  labels: {
    'settings.themes.title': 'Appearance',
    'settings.themes.apply': 'Use this one',
  },
  featureToggles: { 'acme.pilot': true },
};

/**
 * Read the state configuration is supposed to control, from the live DOM.
 *
 * @param {import('@playwright/test').Page} page
 */
function readConfiguredState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      themeAttribute: root.getAttribute('data-app-theme'),
      themeId: root.dataset['appThemeId'] ?? null,
      inlinePrimary: root.style.getPropertyValue('--mat-sys-primary').trim(),
      computedPrimary: getComputedStyle(root).getPropertyValue('--mat-sys-primary').trim(),
      pillRadius: root.style.getPropertyValue('--agentic-pill-radius').trim(),
      documentTitle: document.title,
    };
  });
}

/**
 * Force a full document reload so the `APP_INITIALIZER` re-reads configuration.
 *
 * @param {import('@playwright/test').Page} page
 */
async function reloadApp(page) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  /** Mutable bodies for the two configuration URLs, swapped between passes; `null` is a 404. */
  let bootstrapBody = PACKAGED_BOOTSTRAP;
  let manifestBody = PACKAGED_MANIFEST;

  /** Any request for a Nuxeo document under a `config` folder — the path this app no longer reads. */
  const documentReads = [];
  page.on('request', (request) => {
    if (/\/api\/v1\/(path|repo\/[^/]+\/path)\/[^?]*\/config\//.test(request.url())) {
      documentReads.push(request.url());
    }
  });

  // Installed before the first navigation and answering `no-store`, so that
  // every later reload actually re-requests the configuration instead of reusing
  // a cached copy.
  await page.route(BOOTSTRAP_ROUTE, (route) =>
    route.fulfill({
      status: bootstrapBody === null ? 404 : 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: bootstrapBody ?? 'Not Found',
    }),
  );
  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: manifestBody === null ? 404 : 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: manifestBody ?? 'Not Found',
    }),
  );

  // ---------------------------------------------------------------------------
  // The packaged default must change nothing.
  // ---------------------------------------------------------------------------
  await h.step('The configuration file is served from outside the application bundle');
  await h.login();
  await h.expectVisible('app shell rendered', 'app-shell');

  // `page.request` is not subject to page routes, so this asks the dev server for
  // the real file rather than the interception fixture. Nothing is packaged at that
  // path (NXSAT-317): it is served only from a developer's gitignored local copy,
  // which the dev server sees only if it existed when `nx serve` started.
  const served = await page.request.get(`${h.baseUrl}${BOOTSTRAP_PATH}`);
  const localCopy = existsSync(LOCAL_BOOTSTRAP) ? readFileSync(LOCAL_BOOTSTRAP, 'utf8') : null;
  if (localCopy === null) {
    h.check(
      'with no local copy, the dev server serves no bootstrap.json and nothing packaged shadows it',
      served.status() === 404,
      `HTTP ${served.status()} for ${BOOTSTRAP_PATH}, with no ${LOCAL_BOOTSTRAP}`,
    );
  } else {
    h.check(
      'the dev server serves the local copy at the sibling configuration path',
      served.status() === 200 && (await served.text()) === localCopy,
      `HTTP ${served.status()} for ${BOOTSTRAP_PATH}; restart nx serve if ${LOCAL_BOOTSTRAP} ` +
        'was created after it started',
    );
  }
  // The application resolves the configuration URL relative to its own base
  // href. Under production packaging that is `/nuxeo/agentic-ui/`, so the URL is
  // `/nuxeo/agentic-ui-config/bootstrap.json`. Strip the context path and what is
  // left must fall under the servlet's mapping, with no authentication filter on it.
  const productionPaths = ['bootstrap.json', 'manifest.json'].map(
    (file) => new URL(`../agentic-ui-config/${file}`, PRODUCTION_BASE_HREF).pathname,
  );
  const inContext = productionPaths.map((path) => path.slice(CONTEXT_PATH.length));
  const { servlets, filters } = deploymentMappings();
  h.check(
    'both URLs the application fetches are mapped to the configuration servlet',
    inContext.every((path) =>
      servlets.some(
        (m) =>
          m.name === 'Agentic UI Configuration' && m.urls.some((u) => urlPatternMatches(u, path)),
      ),
    ),
    `${inContext.join(', ')}; servlet mappings: ${JSON.stringify(servlets)}`,
  );
  h.check(
    'no filter mapping of any pattern form covers either, so both answer before sign-in',
    !filters.some((m) => m.urls.some((u) => inContext.some((path) => urlPatternMatches(u, path)))),
    `filter mappings: ${JSON.stringify(filters)}`,
  );
  h.check(
    'the installer copies nothing into the path the servlet owns',
    !/<copy[^>]*agentic-ui-config/.test(INSTALL_XML),
    'install.xml has a copy into agentic-ui-config',
  );

  const defaultBundle = await bundleFingerprint(page);
  h.check(
    'the running bundle could be fingerprinted',
    defaultBundle.count > 0 && defaultBundle.bytes > 0,
    `${defaultBundle.count} scripts, ${defaultBundle.bytes} bytes`,
  );

  const defaults = await readConfiguredState(page);
  h.check(
    'the packaged default theme is applied',
    defaults.themeAttribute !== null,
    `data-app-theme was ${defaults.themeAttribute}`,
  );
  h.check(
    'the default config sets no inline token overrides',
    defaults.inlinePrimary === '' && defaults.pillRadius === '',
    `inline overrides present: primary "${defaults.inlinePrimary}", radius "${defaults.pillRadius}"`,
  );
  h.check(
    'the compiled palette still supplies a primary colour',
    defaults.computedPrimary !== '',
    'computed --mat-sys-primary was empty, so the Sass theme did not apply',
  );
  h.check(
    'the default browser title is unchanged from the current release',
    defaults.documentTitle === 'Nuxeo Platform',
    `document.title was "${defaults.documentTitle}"`,
  );
  await h.screenshot('default-config-shell');

  await h.step('Default configuration reproduces production browse unchanged');
  await h.goTo('/#/browse');
  await h.expectVisible('browse page rendered', 'lib-browse');
  await h.expectText('repository content listed', 'lib-browse', 'Default domain');
  await h.screenshot('default-config-production-browse');

  await h.step('Default configuration reproduces the adf-hx POC route unchanged');
  await h.goTo('/#/browse-adf-hx');
  await h.expectVisible('POC page rendered', 'lib-browse-adf-hx-poc');
  await h.expectVisible('hxp document list present', 'hxp-document-list');
  await h.expectText('Nuxeo children listed', 'hxp-document-list', 'Default domain');
  await h.screenshot('default-config-adf-hx-browse');

  await h.step('Translations resolve rather than leaking raw keys');
  await h.goTo('/#/settings/themes');
  await h.expectVisible('themes page rendered', 'app-themes-page');
  await h.expectText('translated page title rendered', 'app-themes-page', 'Themes');
  const pageText = await page.locator('app-themes-page').innerText();
  h.check(
    'no untranslated keys are visible',
    !pageText.includes('settings.themes.'),
    'a raw translation key reached the DOM',
  );
  const packagedThemeCount = await page.locator('app-themes-page .theme-card').count();
  h.check(
    'the four packaged themes are offered',
    packagedThemeCount === 4,
    `found ${packagedThemeCount} theme cards`,
  );
  await h.screenshot('default-config-themes-page');

  // ---------------------------------------------------------------------------
  // The same bundle, different configuration.
  // ---------------------------------------------------------------------------
  await h.step('A customised configuration file rebrands the application, with no rebuild');
  bootstrapBody = configResponse('bootstrap', { customer: [CUSTOMISED_BOOTSTRAP] });
  // Clear the stored preference so the *configured* default is what applies.
  await page.evaluate(() => localStorage.removeItem('agentic_ui_color_theme'));
  await h.goTo('/#/settings/themes');
  await reloadApp(page);

  const customised = await readConfiguredState(page);
  const customisedBundle = await bundleFingerprint(page);
  h.check(
    'the JavaScript bundle bytes are unchanged — no rebuild took place',
    customisedBundle.count > 0 && customisedBundle.digest === defaultBundle.digest,
    `bundle content hash differed:\n` +
      `  before ${defaultBundle.digest} (${defaultBundle.count} scripts, ${defaultBundle.bytes} bytes)\n` +
      `  after  ${customisedBundle.digest} (${customisedBundle.count} scripts, ${customisedBundle.bytes} bytes)`,
  );
  h.check(
    'configured branding reaches the browser title',
    customised.documentTitle === 'Acme Content Cloud',
    `document.title was "${customised.documentTitle}"`,
  );
  h.check(
    'the configured theme is selected as the default',
    customised.themeId === 'acme',
    `active theme id was ${customised.themeId}`,
  );
  h.check(
    'the configured theme falls back to its named compiled palette',
    customised.themeAttribute === 'light',
    `data-app-theme was ${customised.themeAttribute}`,
  );
  h.check(
    'the configured token overrides the compiled primary colour',
    customised.inlinePrimary === 'rgb(123, 47, 247)',
    `inline --mat-sys-primary was "${customised.inlinePrimary}"`,
  );
  h.check(
    'a non-colour design token is configurable too',
    customised.pillRadius === '4px',
    `--agentic-pill-radius was "${customised.pillRadius}"`,
  );
  await h.screenshot('customised-config-theme-applied');

  await h.step('The configured theme set is open, not the four compiled ones');
  const customisedThemeCount = await page.locator('app-themes-page .theme-card').count();
  h.check(
    'a fifth theme added in JSON appears in the picker',
    customisedThemeCount === 5,
    `found ${customisedThemeCount} theme cards, expected 5`,
  );
  await h.expectText('the configured theme label is rendered', 'app-themes-page', 'Acme Brand');
  await h.screenshot('customised-config-theme-picker');

  await h.step("The runtime manifest relabels the product from a package's manifest fragment");
  manifestBody = configResponse('manifest', { customer: [CUSTOMISED_MANIFEST] });
  await reloadApp(page);
  await h.expectText(
    'manifest label overrides the shipped string',
    'app-themes-page',
    'Appearance',
  );
  await h.expectText('manifest label overrides a button', 'app-themes-page', 'Use this one');
  const stillRenders = await page.locator('app-themes-page .theme-card').count();
  h.check(
    'relabelling did not break the page it relabelled',
    stillRenders === 5,
    `found ${stillRenders} theme cards`,
  );
  await h.screenshot('customised-manifest-labels');

  // ---------------------------------------------------------------------------
  // Failure paths.
  // ---------------------------------------------------------------------------
  await h.step('A malformed configuration file degrades to the packaged defaults');
  bootstrapBody = '{"branding": {"applicationTitle": ';
  manifestBody = '{"labels": ';
  await h.goTo('/#/browse');
  await reloadApp(page);
  await h.expectVisible('browse page still renders', 'lib-browse');
  await h.expectText('repository content still listed', 'lib-browse', 'Default domain');
  const afterMalformed = await readConfiguredState(page);
  h.check(
    'the packaged theme is restored rather than left half-applied',
    afterMalformed.inlinePrimary === '' && afterMalformed.pillRadius === '',
    `inline overrides survived: primary "${afterMalformed.inlinePrimary}"`,
  );
  h.check(
    'the packaged branding is restored',
    afterMalformed.documentTitle === 'Nuxeo Platform',
    `document.title was "${afterMalformed.documentTitle}"`,
  );
  await h.screenshot('malformed-config-falls-back');

  await h.step('An absent configuration service leaves a working application');
  bootstrapBody = null;
  manifestBody = null;
  await h.goTo('/#/browse-adf-hx');
  await reloadApp(page);
  await h.expectVisible('POC page renders with no configuration at all', 'lib-browse-adf-hx-poc');
  await h.expectText('Nuxeo children still listed', 'hxp-document-list', 'Default domain');
  await h.goTo('/#/settings/themes');
  await reloadApp(page);
  await h.expectText(
    'shipped translations still resolve without a manifest',
    'app-themes-page',
    'Themes',
  );
  const unconfigured = await readConfiguredState(page);
  h.check(
    'the packaged defaults are in force',
    unconfigured.documentTitle === 'Nuxeo Platform' && unconfigured.inlinePrimary === '',
    `title "${unconfigured.documentTitle}", inline primary "${unconfigured.inlinePrimary}"`,
  );
  await h.screenshot('absent-config-still-works');

  await h.step('Configuration health');
  h.check(
    'no request read a configuration document from the repository',
    documentReads.length === 0,
    documentReads.join(', '),
  );
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
}
