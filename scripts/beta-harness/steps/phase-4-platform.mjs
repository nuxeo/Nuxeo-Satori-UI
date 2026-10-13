/**
 * Phase 4 — Layer 2: publishable platform.
 *
 * The claim: **the platform is an installable package, a customer can fork the
 * template and extend it from their own library, and none of that requires editing
 * our code.**
 *
 * ## This phase is not like the others, and the evidence reflects that
 *
 * Phases 0-3 assert things about the product UI. Phase 4 asserts things about an
 * **npm artifact** and a **fork**, so a Playwright run against the product dev
 * server would prove nothing about it. This runs against the **built template**
 * served statically, and pairs the browser observations with assertions read
 * directly out of `dist/libs/platform` — the bytes a customer installs.
 *
 * ## Which checks are load-bearing, and which are not
 *
 * Read the total as a mixture, not as a count of equally meaningful facts.
 *
 * **Load-bearing** — each fails if the thing it names is not actually working:
 *
 * - Step 2: Layer 0 branding reaches both the DOM and `document.title`. The title
 *   half matters specifically: it was broken for a commit because
 *   `provideAppInitializer` callbacks run *concurrently*, so it read the config
 *   before `load()` resolved and rendered the packaged default while the heading
 *   beside it showed the configured brand.
 * - Step 3: a Layer 0 theme token is written to `<html>` **and consumed**. The
 *   computed nav background is compared against the packaged default, so a token
 *   that is written but ignored by the CSS still fails. Before `TemplateThemeService`
 *   existed, `themes` and `defaultThemeId` were present in `bootstrap.json` and
 *   entirely inert — this is the check that would have caught it.
 * - Step 4: nav text still contrasts with the themed nav background. A rebrand must
 *   not be able to make navigation unreadable from JSON alone.
 * - Step 5: the navbar is resolved **from the registry**, asserted by exact id set.
 * - Step 6: the **generated** extension library's nav entry renders, which is the
 *   zero-edit Layer 2 claim observed rather than asserted. `libs/extensions/acme-extensions`
 *   was produced by the generator and integrated by one line in the template's
 *   `app.config.ts`; if registration were inert, this entry would be absent.
 * - Step 7: `inventory()` lists the generated library's rule and nav ids.
 * - Step 9: the published `.d.ts` carries nullable types. A direct regression guard
 *   for the defect where the package was compiled without `strictNullChecks` and
 *   shipped 27 wrongly non-nullable public types.
 * - Step 10: the `exports` map advertises exactly the expected entry points — the root and six
 *   subpaths, `./components-satori` among them — by
 *   name, and every `types` file it names exists. An entry pointing at a missing file is an unresolvable import
 *   for a customer, which is how `ng-packagr-lite` shipped four broken subpaths.
 * - Step 11: `private: true` survives into the built artifact, so an accidental
 *   `npm publish` is refused while the scope is unconfirmed (R10).
 *
 * **Negative / fallback** — regression guards that would also pass if parts of the
 * system were inert:
 *
 * - Step 8: the diagnostics panel reports both halves as served by the
 *   configuration response, and the manifest as naming no package. The template
 *   serves a manifest with no fragments, so this proves the source is reported
 *   honestly, not that a manifest works.
 * - Step 12: no unexpected console errors, and no failed request at all.
 *
 * That is 9 load-bearing steps and 2 negative ones.
 *
 * ## What this phase's evidence deliberately does not cover
 *
 * - **Peer installability.** Nothing here resolves the ten declared peers from a
 *   registry at the versions we declare. `fork-simulation` compiles against the
 *   built declarations offline; it says nothing about whether `npm install`
 *   succeeds. Recorded as a note, not a check.
 * - **The Layer 1 manifest doing real work in the template.** There is no Nuxeo
 *   server, so `overrides` and manifest-added slots are unexercised here. Phase 2's
 *   evidence covers that mechanism against the product.
 *
 * Prerequisites — no Nuxeo needed, unlike every other phase:
 *   npx nx build platform
 *   npx nx build nuxeo-satori-template
 *   npx http-server dist/nuxeo-satori-template/browser -p 4321 -s
 *   APP_URL=http://127.0.0.1:4321 npm run beta:evidence -- phase-4-platform
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const DIST = join(ROOT, 'dist', 'libs', 'platform');

/** #f6f8fa — the packaged default in the template's own styles.scss. */
const PACKAGED_NAV_BG = 'rgb(246, 248, 250)';
/** #0f2b46 — the Acme theme in the template's bootstrap.json. */
const THEMED_NAV_BG = 'rgb(15, 43, 70)';

/** The subpaths the built package must export, by name: a count alone passes a swapped entry. */
const EXPECTED_EXPORTS = Object.freeze([
  '.',
  './app-config',
  './components',
  './components-satori',
  './extensions',
  './nuxeo-client',
  './ui',
]);

/** The expected subpaths an `exports` map lacks, and the ones it has that nobody expected. */
export function exportsMismatch(exportsMap) {
  const actual = Object.keys(exportsMap ?? {}).filter((k) => k !== './package.json');
  return {
    missing: EXPECTED_EXPORTS.filter((k) => !actual.includes(k)),
    unexpected: actual.filter((k) => !EXPECTED_EXPORTS.includes(k)),
  };
}

/** Perceived luminance, for the contrast guard. */
function luminance(rgb) {
  const parts = String(rgb).match(/\d+/g);
  if (!parts) return 0;
  const [r, g, b] = parts.map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

const readNav = (page) =>
  page.$$eval('.shell__nav-link', (els) => els.map((e) => e.textContent.trim()));

export default async function run(page, h) {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const failedRequests = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });

  // ---------------------------------------------------------------------------
  h.step('The served application is the template, not the product');

  await page.goto(`${h.baseUrl}/`, { waitUntil: 'networkidle' });

  const isTemplate = await page.$('.shell__nav');
  h.requirePrecondition(
    'APP_URL serves the built nuxeo-satori-template',
    Boolean(isTemplate),
    'No `.shell__nav` found. This steps file asserts the template, not the product UI.\n' +
      'Run:  npx nx build nuxeo-satori-template\n' +
      '      npx http-server dist/nuxeo-satori-template/browser -p 4321 -s\n' +
      '      APP_URL=http://127.0.0.1:4321 npm run beta:evidence -- phase-4-platform',
  );

  h.requirePrecondition(
    'dist/libs/platform exists, so the package assertions have an artifact',
    existsSync(join(DIST, 'package.json')),
    'Run `npx nx build platform` first — steps 9 to 11 read the built package.',
  );

  await page.waitForSelector('.shell__nav-link');

  // ---------------------------------------------------------------------------
  h.step('Layer 0 branding reaches the DOM and the document title');

  const heading = (await page.textContent('h1'))?.trim();
  h.check(
    'branding.applicationTitle from bootstrap.json renders as the heading',
    heading === 'Acme Content',
    `expected "Acme Content", got "${heading}"`,
  );

  const title = await page.title();
  h.check(
    'branding.documentTitle is applied to document.title',
    title === 'Acme Content',
    `expected "Acme Content", got "${title}". provideAppInitializer callbacks run ` +
      'concurrently — a one-shot read of bootstrap() races config.load() and loses.',
  );

  // ---------------------------------------------------------------------------
  h.step('A Layer 0 theme token is written to <html> and actually consumed');

  const inlineToken = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--shell-nav-bg').trim(),
  );
  h.check(
    'the theme token is present as an inline custom property on <html>',
    inlineToken === '#0f2b46',
    `expected "#0f2b46", got "${inlineToken}"`,
  );

  const navBg = await page.evaluate(() => {
    const nav = document.querySelector('.shell__nav');
    return nav ? getComputedStyle(nav).backgroundColor : '';
  });
  h.check(
    'the themed colour is what the browser actually computes for the nav',
    navBg === THEMED_NAV_BG,
    `expected ${THEMED_NAV_BG}, got ${navBg}`,
  );
  h.check(
    'and it is NOT the packaged default, so an inert theme config fails this',
    navBg !== PACKAGED_NAV_BG,
    `computed ${navBg}, which is the packaged default — themes[] did nothing`,
  );
  // One image supports steps 2, 3 and 5 together: the configured brand heading, the
  // themed dark nav, and the registry-resolved entries are all in this viewport.
  // Named for what it shows rather than for one claim, because the screenshot audit
  // is right to reject four identical images captioned as four observations.
  await h.screenshot('home-branded-themed-and-nav-from-registry');

  // ---------------------------------------------------------------------------
  h.step('The rebrand cannot make navigation unreadable');

  const navFg = await page.evaluate(() => {
    const link = document.querySelector('.shell__nav-link');
    return link ? getComputedStyle(link).color : '';
  });
  const gap = Math.abs(luminance(navFg) - luminance(navBg));
  h.check(
    'nav text and themed nav background differ in luminance by more than 0.4',
    gap > 0.4,
    `fg ${navFg} vs bg ${navBg} — luminance gap ${gap.toFixed(3)}`,
  );

  // ---------------------------------------------------------------------------
  h.step('The navbar is resolved from the extension registry');

  const nav = await readNav(page);
  h.check(
    'the template’s own two registered entries render',
    nav.includes('Home') && nav.includes('Reports'),
    `rendered: [${nav.join(', ')}]`,
  );

  // ---------------------------------------------------------------------------
  h.step('A generated extension library contributes with zero platform edits');

  h.check(
    'the generated library’s nav entry renders alongside the template’s',
    nav.includes('AcmeExtensions'),
    `rendered: [${nav.join(', ')}]. libs/extensions/acme-extensions was produced by ` +
      'the generator and integrated by one line in the template app.config.ts; if its ' +
      'registration were inert this entry would be absent.',
  );

  // Following the link is the part that matters. The entry pointed at
  // `/acme-extensions` while nothing routed there, so it fell through the wildcard
  // back to `/home` — a nav entry that goes nowhere. Asserting the URL *and* the
  // panel's own markup, because a redirect to home would still leave a rendered page.
  await page.click('.shell__nav-link:has-text("AcmeExtensions")');
  await page.waitForLoadState('networkidle');
  const url = page.url();
  h.check(
    'following the entry lands on its own route rather than redirecting to home',
    url.endsWith('/acme-extensions'),
    `url after click: ${url} — a wildcard redirect to /home means the path is unrouted`,
  );

  const panel = await page.$('.acme-panel');
  h.check(
    'the panel the library registered by ID renders there',
    Boolean(panel),
    'ExtensionOutletComponent resolved nothing for `acme.panel.acmeExtensions`. The ' +
      'host maps the path; the component comes from the registry, because the ' +
      'library deliberately does not export the class.',
  );
  await h.screenshot('generated-library-panel-on-its-own-route');

  await page.goBack();
  await page.waitForSelector('.shell__nav-link');

  // ---------------------------------------------------------------------------
  h.step('inventory() lists the generated library’s registered ids');

  const inventoryText = (await page.textContent('.home__panel:last-of-type')) ?? '';
  for (const id of [
    'acme.navbar.acmeExtensions',
    'acme.rules.canUseAcme',
    'template.rules.isSignedIn',
  ]) {
    h.check(`inventory() lists ${id}`, inventoryText.includes(id), 'not present in the panel');
  }

  // ---------------------------------------------------------------------------
  h.step('Configuration diagnostics report where configuration came from (negative check)');

  const diagnostics = (await page.textContent('.home__panel')) ?? '';
  h.check(
    'both halves were loaded from the configuration response, not packaged defaults',
    /Bootstrap\s*configuration-service\s*Manifest\s*configuration-service/.test(diagnostics),
    `diagnostics panel read: ${diagnostics.slice(0, 200)}`,
  );
  h.check(
    'the manifest is reported as naming no package',
    /Manifest packages\s*none/.test(diagnostics),
    'The template serves a manifest with no fragments, so this is the expected path. This ' +
      'check proves the source is surfaced rather than assumed — not that a manifest works.',
  );
  // Scrolled to the inventory panel, so this image shows the registered-ID list rather
  // than repeating the same above-the-fold viewport as the first shot.
  await h.screenshot('registered-ids-and-config-sources', page.locator('.home__panel').last());

  // ---------------------------------------------------------------------------
  h.step('The published declarations carry nullable types');

  const extensionsDts = readFileSync(join(DIST, 'extensions', 'index.d.ts'), 'utf8');
  h.check(
    'ExtensionRuleContextService.username is WritableSignal<string | null>',
    /readonly username: [\w.]*WritableSignal<string \| null>/.test(extensionsDts),
    'The package was once compiled without strictNullChecks, which collapsed ' +
      '`string | null` to `string` and shipped 27 wrongly non-nullable public types. ' +
      'A customer calling .set(null) on sign-out got a compile error our source does not.',
  );
  h.check(
    'ExtensionRuleContextService.document is WritableSignal<NuxeoDocument | null>',
    /readonly document: [\w.]*WritableSignal<NuxeoDocument \| null>/.test(extensionsDts),
    'same strictNullChecks regression',
  );

  // ---------------------------------------------------------------------------
  h.step('The exports map advertises the root and six subpaths, all resolvable');

  const pkg = JSON.parse(readFileSync(join(DIST, 'package.json'), 'utf8'));
  const subpaths = Object.keys(pkg.exports ?? {}).filter((k) => k !== './package.json');
  const { missing: absent, unexpected } = exportsMismatch(pkg.exports);
  h.check(
    'exactly the expected entry points are exported: the root and six subpaths',
    absent.length === 0 && unexpected.length === 0,
    `missing: ${absent.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}`,
  );

  const missing = subpaths
    .map((sub) => pkg.exports[sub]?.types)
    .filter((types) => types && !existsSync(join(DIST, types)));
  h.check(
    'every types file the exports map names exists on disk',
    missing.length === 0,
    `missing: ${missing.join(', ')} — a customer importing these gets an unresolvable module`,
  );

  // ---------------------------------------------------------------------------
  h.step('Publishing is still blocked while the scope is unconfirmed');

  h.check(
    'private: true survives into the built artifact',
    pkg.private === true,
    'Without it `npm publish` would not refuse, and the @nuxeo-satori scope is ' +
      'unconfirmed (R10). See docs/publishing-to-nuxeo-registry.md.',
  );

  h.note(
    'Peer installability is NOT covered by this phase. Nothing here resolves the ten ' +
      'declared peers from a registry at the versions we declare — fork-simulation ' +
      'compiles against the built declarations offline. The first real publish must be ' +
      '--tag alpha for exactly this reason.',
  );
  h.note(
    'The Layer 1 manifest doing real work is NOT covered here — the template ships no ' +
      'Nuxeo server. Phase 2 evidence covers that mechanism against the product.',
  );

  // ---------------------------------------------------------------------------
  h.step('No unexpected console errors (negative check)');

  // Both configuration files are served beside the template, and it reads no Nuxeo
  // document for configuration, so no request is expected to fail.
  const unexpectedRequests = failedRequests;
  h.check(
    'no failed requests',
    unexpectedRequests.length === 0,
    `unexpected: ${unexpectedRequests.join(', ')}`,
  );

  const unexpectedErrors = consoleErrors.filter(
    (e) => !/Failed to load resource|404/.test(e) && !/exportSummary is not implemented/.test(e),
  );
  h.check(
    'no unexpected console errors',
    unexpectedErrors.length === 0,
    `errors: ${unexpectedErrors.join(' | ')}`,
  );
}
