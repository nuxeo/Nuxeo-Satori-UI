/**
 * Scene 3 — Acme Insurance builds their own UI on the platform, then customises it.
 *
 * ## What this scene is
 *
 * A working application, doing real work, against the local Nuxeo server. It signs
 * in with a real credential, browses real folders, opens a real document and reads
 * its real blob, and searches the real OpenSearch index. Then it customises that
 * running application through three of the four layers, live, and the customisation
 * is visible because the thing being customised is on screen the whole time.
 *
 * The previous cut of this scene was rejected as "more of a PPT presentation". The
 * fix was not shorter slides: it was giving the template an application worth
 * filming. Two title cards survive, together under twenty seconds.
 *
 * ## Prerequisites, and why the scene refuses rather than fakes
 *
 *   npx nx build nuxeo-satori-template
 *   node tools/video/mock-customer/seed-nuxeo.mjs
 *
 * If Nuxeo is not running, or the Acme workspace is not seeded, this throws before
 * recording anything. A screencast of empty tables that claims to show real data is
 * worse than no screencast, and mocking the data would defeat the entire point.
 *
 * ## Why it does not use the harness's `serve()`
 *
 * `serve()` is `http-server`, which cannot proxy. The stock Nuxeo Docker image
 * sends no CORS headers, so a bundle on another port cannot call it from a browser
 * at all. `serveAppWithNuxeoProxy` puts the app and Nuxeo on one origin, which is
 * also the topology a real deployment uses. See its file comment.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { caption, hideCode, showCode } from '../mock-customer/captions.mjs';
import { serveAppWithNuxeoProxy } from '../mock-customer/serve-app.mjs';
import { ACME_WORKSPACE_PATH, check } from '../mock-customer/seed-nuxeo.mjs';
import { requireNuxeoCredentials } from '../../../scripts/beta-harness/nuxeo-credentials.mjs';

const APP_PORT = 4413;
const CONFIG = 'agentic-ui-config/bootstrap.json';
const MANIFEST = 'agentic-ui-config/manifest.json';

const CLAIMS_PATH = `${ACME_WORKSPACE_PATH}/claims`;

/** Acme's Layer 0 branding — what the application is deployed as for them. */
const ACME_BRANDING = {
  branding: { applicationTitle: 'Acme Insurance', documentTitle: 'Acme Insurance — Content' },
  defaultThemeId: 'acme',
};

/**
 * A second tenant on the **same bundle**.
 *
 * Rebranding away from Acme rather than towards it is deliberate: the interesting
 * claim is not "a customer can be branded", it is that one build serves two
 * customers with different identities and nothing is recompiled between them. A
 * new theme id also proves `themes` is merged by id rather than replaced.
 */
const NORTHWIND_BRANDING = {
  branding: { applicationTitle: 'Northwind Mutual', documentTitle: 'Northwind Mutual — Records' },
  defaultThemeId: 'northwind',
  themes: [
    {
      id: 'northwind',
      label: 'Northwind',
      tokens: {
        '--shell-fg': '#12261c',
        '--shell-muted': '#4d6b5a',
        '--shell-border': '#c2d8ca',
        '--shell-surface': '#ffffff',
        '--shell-surface-alt': '#e9f4ec',
        '--shell-accent': '#0f7a4a',
        '--shell-accent-fg': '#ffffff',
        '--shell-nav-fg': '#eaf6ee',
        '--shell-nav-muted': '#a9c9b6',
        '--shell-nav-bg': '#123b28',
        '--shell-nav-hover': '#1c5138',
        '--shell-nav-active': '#0f7a4a',
      },
    },
  ],
};

/**
 * Acme's Layer 1 manifest fragment, as their configuration package contributes it.
 *
 * One override of each kind the registry supports, against ids the build knows and
 * one id the build has never heard of being renamed — `acme.navbar.acmeExtensions`
 * comes from a separate library.
 */
const ACME_MANIFEST = {
  version: 1,
  extensions: {
    $name: 'acme-insurance-layer-1',
    overrides: {
      'template.navbar.documents': { label: 'Claims Library', order: 5 },
      'acme.navbar.acmeExtensions': { label: 'Acme Tools', order: 15 },
      'template.navbar.reports': { visible: false },
    },
  },
};

/**
 * Rewrite branches of the template's bootstrap fragment in the served `bootstrap.json`.
 *
 * The file is the configuration servlet's envelope; the template's values are its
 * one fragment, standing in for the bootstrap fragment of Acme's configuration
 * package.
 *
 * `themes` is merged **by id** rather than assigned, and that is not a nicety: the
 * first cut used `Object.assign` alone, which replaced the file's themes with the
 * incoming one. So switching to Northwind worked, switching back to Acme silently
 * lost the Acme palette, `resolveTheme` fell through to the packaged theme — whose
 * `tokens` are empty by design — and three minutes of the recording showed a
 * light navigation while the caption said the brand was back. Caught by looking at
 * the frames, which is the only reason it was caught at all.
 */
function patchConfig(dir, patch) {
  const path = join(dir, CONFIG);
  const envelope = JSON.parse(readFileSync(path, 'utf8'));
  const config = envelope.fragments.at(-1).content;
  const existingThemes = Array.isArray(config.themes) ? config.themes : [];
  Object.assign(config, patch);
  config.themes = mergeThemesById(existingThemes, patch.themes ?? []);
  writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`);
}

/** Serve `manifest` as Acme's manifest fragment, or no fragment at all for `null`. */
function writeManifest(dir, manifest) {
  const path = join(dir, MANIFEST);
  const envelope = JSON.parse(readFileSync(path, 'utf8'));
  envelope.fragments =
    manifest === null
      ? []
      : [
          {
            name: 'acme',
            component: 'com.acme.insurance.config',
            bundle: 'com.acme.insurance.config',
            source: 'agentic-ui-config/manifest.json',
            content: manifest,
          },
        ];
  writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`);
}

/** Same rule as `mergeBootstrapConfig`: later wins per id, unknown ids append. */
function mergeThemesById(existing, incoming) {
  const merged = existing.map((theme) => ({ ...theme }));
  for (const theme of incoming) {
    const index = merged.findIndex((candidate) => candidate.id === theme.id);
    if (index >= 0) merged[index] = { ...merged[index], ...theme };
    else merged.push(theme);
  }
  return merged;
}

/**
 * Sign in, on camera, with a credential typed rather than injected.
 *
 * @param {{ username: string, password: string }} credentials from `run`, which requires them
 */
async function signIn(page, hold, { username, password }) {
  await page.waitForSelector('.sign-in', { timeout: 45000 });
  await caption(
    page,
    'Their application, not ours',
    'Acme wrote this shell, this sign-in form and every page behind it. The only thing they took from us is the platform package.',
  );
  await hold(page, 5000);

  await page.click('input[name="username"]');
  await page.type('input[name="username"]', username, { delay: 90 });
  await page.click('input[name="password"]');
  await page.type('input[name="password"]', password, { delay: 70 });
  await hold(page, 1200);
  await page.click('.sign-in__submit');
}

export default async function run({ page, deckUrl, hold, teardown, ROOT }) {
  // Credentials for the local Docker instance, from the environment with no default — both used
  // to fall back to its administrator pair (NXSAT-649). First, because everything below needs
  // them: `check()` reads the repository and the sign-in types them on camera.
  const credentials = requireNuxeoCredentials('record the 03-mock-customer scene');

  // ---- refuse to record a lie -------------------------------------------------
  await check({ quiet: true });

  const built = join(ROOT, 'dist', 'nuxeo-satori-template', 'browser');
  const stage = join(ROOT, 'dist', '.video-stage-03');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(built, stage, { recursive: true });
  patchConfig(stage, ACME_BRANDING);
  writeManifest(stage, null);

  const app = await serveAppWithNuxeoProxy({ root: stage, port: APP_PORT });
  teardown.push(app.stop);

  // ---- opening card -----------------------------------------------------------
  await page.goto(`${deckUrl}/mock-customer/cards.html?card=open`, { waitUntil: 'load' });
  await page.waitForSelector('body[data-ready="true"]');
  await hold(page, 9500);

  // ---- 1. sign in against Nuxeo ----------------------------------------------
  await page.goto(app.url, { waitUntil: 'load' });
  await signIn(page, hold, credentials);

  // ---- 2. browse the real repository -----------------------------------------
  await page.waitForSelector('.docs__table', { timeout: 45000 });
  await caption(
    page,
    'Real repository, live',
    'Every row is a document Nuxeo just returned — the whole workspace root of the local server, including content this demo did not create.',
  );
  await hold(page, 6000);

  await page.locator('.docs__link:has-text("Acme Insurance")').first().click();
  await page.waitForSelector('.docs__title:has-text("Acme Insurance")', { timeout: 30000 });
  await caption(
    page,
    'Acme’s own workspace',
    'Claims, Policies and Underwriting. Folders, breadcrumbs and paging all come from BrowseService — the same service the Nuxeo product UI uses.',
  );
  await hold(page, 5500);

  await page.locator('.docs__link:has-text("Claims")').first().click();
  await page.waitForSelector('.docs__title:has-text("Claims")', { timeout: 30000 });
  await caption(
    page,
    'Five real documents',
    'Titles, descriptions, authors, sizes and timestamps are Dublin Core properties read straight off the REST payload. Nothing here is a fixture in the browser.',
  );
  await hold(page, 6500);

  // ---- 3. one document, its metadata and its actual bytes --------------------
  await page.locator('.docs__link:has-text("Hurricane")').first().click();
  await page.waitForSelector('.detail__facts', { timeout: 30000 });
  await caption(
    page,
    'One document, in full',
    'Type, path, UID, lifecycle state, contributors, MIME type and size — one call to /nuxeo/api/v1/id/… with properties: *.',
  );
  await hold(page, 6500);

  await page.waitForSelector('.detail__content', { timeout: 30000 });
  await caption(
    page,
    'And its actual content',
    'The file body, fetched as a blob through DocumentDetailService and signed by Acme’s own auth interceptor. A bare fetch() or an <img src> would 401 here.',
  );
  await hold(page, 7000);

  // ---- 4. search the real index ----------------------------------------------
  await page.locator('.shell__nav-link:has-text("Search")').click();
  await page.waitForSelector('.search__input', { timeout: 30000 });
  await caption(
    page,
    'Full-text search',
    'Nuxeo’s default_search page provider over OpenSearch. The words being matched are inside the documents, not in their titles.',
  );
  await page.click('.search__input');
  await page.type('.search__input', 'hurricane', { delay: 120 });
  await page.waitForSelector('.search__table', { timeout: 30000 });
  await hold(page, 6000);

  await page.fill('.search__input', '');
  await page.type('.search__input', 'flood', { delay: 120 });
  await hold(page, 5500);

  // ---- 5. the application's own diagnostics ----------------------------------
  await page.locator('.shell__nav-link:has-text("Diagnostics")').click();
  await page.waitForSelector('.home__panel', { timeout: 30000 });
  await caption(
    page,
    'What the app knows about itself',
    'Where each half of its configuration came from, and every extension ID this build registered — read from the live registry, not from a document.',
  );
  await hold(page, 6500);
  await page.locator('.home__panel').last().scrollIntoViewIfNeeded();
  await hold(page, 6000);

  // ---- 6. Layer 0: rebrand the same bytes ------------------------------------
  await page.goto(`${app.url}/documents?path=${encodeURIComponent(CLAIMS_PATH)}`, {
    waitUntil: 'load',
  });
  await page.waitForSelector('.docs__table', { timeout: 45000 });
  await caption(
    page,
    'Layer 0 — configuration in their own package',
    'This is Acme’s brand and palette, from the bootstrap fragment in their configuration package. Watch what one fragment does to the same build.',
  );
  await showCode(
    page,
    'bootstrap fragment — the edit',
    JSON.stringify(NORTHWIND_BRANDING, null, 2),
  );
  await hold(page, 9000);

  patchConfig(stage, NORTHWIND_BRANDING);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.docs__table', { timeout: 45000 });
  await caption(
    page,
    'Same bundle. Second tenant.',
    'Brand, tab title, navigation, accents and surfaces all changed. No rebuild — the same bundle, a different configuration fragment. The documents did not move.',
  );
  await hold(page, 8500);

  patchConfig(stage, ACME_BRANDING);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.docs__table', { timeout: 45000 });
  await caption(page, 'And back', 'Acme again. Still the same JavaScript on disk.');
  await hold(page, 4500);

  // ---- 7. Layer 2: their own library, in one line ----------------------------
  await caption(
    page,
    'Layer 2 — their own code, registered by ID',
    'AcmeExtensions is a separate library. Integrating it took one line in app.config.ts and no edit to any platform library.',
  );
  await showCode(
    page,
    'app.config.ts',
    [
      "import { provideAcmeExtensions } from '@agentic-ui/acme-extensions';",
      '',
      'export const appConfig: ApplicationConfig = {',
      '  providers: [',
      '    // …',
      '    provideAcmeExtensions(),',
      '  ],',
      '};',
    ].join('\n'),
  );
  await hold(page, 8000);
  await hideCode(page);

  await page.locator('.shell__nav-link:has-text("AcmeExtensions")').click();
  await page.waitForSelector('.acme-panel', { timeout: 30000 });
  await caption(
    page,
    'A panel the host never imported',
    'The route names an ID; the registry resolves the component and lazily loads its chunk. Its button is gated by a fail-closed rule that reads the signed-in Nuxeo user.',
  );
  await hold(page, 7500);

  // ---- 8. Layer 1: a manifest fragment in Acme's package ----------------------
  await page.goto(`${app.url}/documents?path=${encodeURIComponent(CLAIMS_PATH)}`, {
    waitUntil: 'load',
  });
  await page.waitForSelector('.docs__table', { timeout: 45000 });
  await caption(
    page,
    'Layer 1 — a manifest in Acme’s own package',
    'A fragment in a Marketplace package that depends on ours. Upgrading our package leaves it in force, and nothing is edited on the server.',
  );
  await showCode(
    page,
    'manifest fragment — com.acme.insurance.config',
    JSON.stringify(ACME_MANIFEST.extensions.overrides, null, 2),
  );
  await hold(page, 9000);

  writeManifest(stage, ACME_MANIFEST);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.shell__nav-link', { timeout: 45000 });
  await caption(
    page,
    'Renamed, reordered, hidden',
    '“Documents” is now “Claims Library”, the Acme library’s entry is renamed and moved above Search, and Reports is gone. The build was not touched.',
  );
  await hold(page, 8500);

  // The claim above is only worth making if the application will corroborate it,
  // so end on the page that reports where its configuration came from.
  await page.locator('.shell__nav-link:has-text("Diagnostics")').click();
  await page.waitForSelector('.home__panel', { timeout: 30000 });
  await caption(
    page,
    'And it says so itself',
    'Both halves: configuration-service, with the package each fragment came from. The application reports where its configuration came from — it does not assume.',
  );
  await hold(page, 8000);

  // ---- closing card -----------------------------------------------------------
  await page.goto(`${deckUrl}/mock-customer/cards.html?card=close`, { waitUntil: 'load' });
  await page.waitForSelector('body[data-ready="true"]');
  await hold(page, 13000);

  // ---- leave the server as we found it ---------------------------------------
  rmSync(stage, { recursive: true, force: true });
}
