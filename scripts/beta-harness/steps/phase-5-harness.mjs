/**
 * Phase 5 — Layer 3: the agent harness a customer receives.
 *
 * The claim: **a customer gets generators that produce live registrations, the contract
 * and the procedure inside the package, and a guardrail that catches their mistakes.**
 *
 * ## Why this run is mostly not a browser
 *
 * Phase 5's deliverables are generators, shipped documents and a script. Three of the
 * four are filesystem facts, so most checks read the built package and the generated
 * library rather than the DOM — the same shape Phase 4 used, and for the same reason:
 * a Playwright run against a UI would prove nothing about any of it.
 *
 * The one thing that *must* be observed in a browser is that a generated contribution
 * actually reaches the screen. `libs/extensions/acme-extensions` was produced by the
 * generators and is wired into the template, so its navigation entry rendering is the
 * end-to-end proof that the generators register live code.
 *
 * ## Which checks are load-bearing
 *
 * - Step 2: the generated library's entry **renders**, and following it lands on its own
 *   panel. This is the check that would have caught the defect the generators shipped
 *   with, where every registration was spliced inside a comment: lint, typecheck and six
 *   specs all passed while nothing was registered.
 * - Step 3: the package ships the contract and the procedure, and the shipped contract
 *   is **byte-identical** to the one `beta:reference` gates. A copy that drifts is worse
 *   than no copy.
 * - Step 4: the customer guardrail catches all five of its failures, each driven against
 *   a mutated copy of the real library. A tool we hand customers and never exercise is
 *   one we would discover was broken from their CI log.
 * - Step 5: the four generators are registered and resolvable.
 *
 * - Step 6 is **negative**: it asserts the internal harness is unchanged. It would also
 *   pass if Phase 5 had done nothing at all, so read it as a non-interference guard
 *   rather than as evidence of delivery.
 *
 * Prerequisites:
 *   npx nx build platform            (so the shipped docs exist)
 *   npx nx build nuxeo-satori-template
 *   node -e "import('./tools/video/mock-customer/serve-app.mjs').then(m =>
 *     m.serveAppWithNuxeoProxy({ root: 'dist/nuxeo-satori-template/browser', port: 4322 }))"
 *   APP_URL=http://127.0.0.1:4322 npm run beta:evidence -- phase-5-harness
 *
 * A plain static server is NOT enough: the template's navigation is rule-gated on a
 * real Nuxeo session, and the stock Nuxeo image sends no CORS headers, so the bundle
 * must be served from the same origin as `/nuxeo`.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { requireStepCredentials } from '../helpers.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const DIST = join(ROOT, 'dist', 'libs', 'platform');
const LIBRARY = join(ROOT, 'libs', 'extensions', 'acme-extensions');
const GUARDRAIL = join(ROOT, 'libs', 'platform', 'guardrails', 'check-extension-library.mjs');

/** Run the customer guardrail, returning its exit code and combined output. */
function runGuardrail(target) {
  try {
    const stdout = execFileSync('node', [GUARDRAIL, target], { encoding: 'utf8', cwd: ROOT });
    return { code: 0, output: stdout };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

/** A throwaway copy of the real library, mutated to break one rule. */
function mutatedCopy(label, mutate) {
  const dir = mkdtempSync(join(tmpdir(), `satori-${label}-`));
  const target = join(dir, 'library');
  cpSync(LIBRARY, target, { recursive: true });
  mutate(target);
  return target;
}

const readFile = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

export default async function run(page, h) {
  const cleanup = [];

  // -------------------------------------------------------------------------
  h.step('Precondition: the platform is built and the template is being served');

  h.requirePrecondition(
    'dist/libs/platform exists',
    existsSync(join(DIST, 'package.json')),
    'Run `npx nx build platform` — steps 3 and 5 read the built package.',
  );

  await page.goto(`${h.baseUrl}/`, { waitUntil: 'load' });
  const navRendered = await page
    .waitForSelector('.shell__nav-link', { timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  h.requirePrecondition(
    'APP_URL serves the built template',
    navRendered,
    'No `.shell__nav-link` found. Run:\n' +
      '  npx nx build nuxeo-satori-template\n' +
      '  serve it through tools/video/mock-customer/serve-app.mjs (it proxies /nuxeo)\n' +
      '  APP_URL=http://127.0.0.1:4322 npm run beta:evidence -- phase-5-harness',
  );

  // -------------------------------------------------------------------------
  h.step('A generated contribution reaches the screen, not just the source');

  /**
   * Sign in first — the entries are rule-gated.
   *
   * The template's navigation is gated on `template.rules.isSignedIn`, and the generated
   * library's entry on `acme.rules.canUseAcme`, both of which require a username. An
   * earlier cut of this step asserted the entry without signing in and read
   * `[Diagnostics]` — the only ungated entry. That was fail-closed working correctly,
   * not a missing registration, and reporting it as a failure would have sent someone
   * looking for a defect that was not there.
   */
  const signInForm = page.locator('input[name="username"]');
  if (await signInForm.count()) {
    // From the environment, no default — both used to fall back to the local Docker
    // administrator pair (NXSAT-649). The runner refuses this file without them already.
    const { username, password } = requireStepCredentials('sign in through the template');
    await signInForm.fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('.sign-in__submit').click();
    await page.waitForTimeout(4000);
  }

  const signedIn = await page
    .locator('.shell__nav-link:has-text("Documents")')
    .count()
    .then((n) => n > 0)
    .catch(() => false);
  h.check(
    'signing in through the template reveals the rule-gated entries',
    signedIn,
    'Only ungated entries are visible, so the session did not establish. The template ' +
      'needs Nuxeo reachable on the same origin — serve it through ' +
      'tools/video/mock-customer/serve-app.mjs, not a plain static server.',
  );

  const nav = await page.$$eval('.shell__nav-link', (els) => els.map((e) => e.textContent.trim()));
  h.check(
    'the generated library’s navigation entry renders',
    nav.includes('AcmeExtensions'),
    `rendered [${nav.join(', ')}]. libs/extensions/acme-extensions was produced by the ` +
      'generators; if their registrations were inert this entry would be absent — which ' +
      'is exactly what happened when they spliced inside a comment.',
  );

  const entry = page.locator('.shell__nav-link:has-text("AcmeExtensions")');
  if (await entry.count()) {
    await entry.click();
    await page.waitForTimeout(2500);
    h.check(
      'following it lands on its own route rather than redirecting away',
      page.url().endsWith('/acme-extensions'),
      `url after click: ${page.url()}`,
    );
    h.check(
      'the panel the generator registered by ID renders there',
      Boolean(await page.$('.acme-panel')),
      'ExtensionOutletComponent resolved nothing for `acme.panel.acmeExtensions`.',
    );
  }
  await h.screenshot('generated-contribution-rendered');

  // -------------------------------------------------------------------------
  h.step('The package ships the contract and the procedure');

  for (const name of ['README.md', 'extension-reference.md', 'AGENTS.md']) {
    h.check(
      `${name} is in the built package`,
      existsSync(join(DIST, name)),
      'A customer installing the package would not receive it.',
    );
  }

  // The shipped contract must be the gated one. A second copy that drifts is worse
  // than no copy, which is why it is generated at build time rather than committed.
  const shipped = readFile(join(DIST, 'extension-reference.md')) ?? '';
  const source = readFile(join(ROOT, 'docs', 'extension-reference.md')) ?? '';
  const shippedBody = shipped.replace(/^<!--[\s\S]*?-->\s*/, '');
  h.check(
    'the shipped contract is byte-identical to the one `beta:reference` gates',
    shippedBody === source && source.length > 0,
    `shipped body ${shippedBody.length} bytes vs source ${source.length} bytes`,
  );
  h.check(
    'the shipped copy is marked generated, so nobody edits the wrong file',
    shipped.trimStart().startsWith('<!--'),
    'No generated banner on the shipped copy.',
  );

  // -------------------------------------------------------------------------
  h.step('The customer guardrail passes the real library and catches five mistakes');

  const clean = runGuardrail(LIBRARY);
  h.check(
    'it passes the reference extension library unmodified',
    clean.code === 0,
    `exit ${clean.code}: ${clean.output.slice(0, 300)}`,
  );

  /**
   * Each case mutates a copy of the real library to break exactly one rule. A guardrail
   * nobody has watched fail is not evidence, and these five are the mistakes this
   * codebase actually made.
   */
  const cases = [
    {
      label: 'deep-import',
      expect: 'not a published entry point',
      mutate: (dir) => {
        const f = join(dir, 'src', 'lib', 'extensions.ts');
        writeFileSync(
          f,
          readFileSync(f, 'utf8').replace(
            "from '@nuxeo-satori/platform/extensions'",
            "from '@nuxeo-satori/platform/extensions/lib/internal'",
          ),
        );
      },
    },
    {
      label: 'barrel-component',
      expect: 'index.ts exports',
      mutate: (dir) => {
        const f = join(dir, 'src', 'index.ts');
        writeFileSync(
          f,
          `${readFileSync(f, 'utf8')}\nexport { AcmePanelComponent } from './lib/panel/acme-panel';\n`,
        );
      },
    },
    {
      label: 'no-fail-closed',
      expect: 'failClosedRules',
      mutate: (dir) => {
        const f = join(dir, 'src', 'lib', 'extensions.ts');
        writeFileSync(
          f,
          readFileSync(f, 'utf8').replace(/failClosedRules:\s*\[[^\]]*\],/, ''),
        );
      },
    },
    {
      label: 'no-specs',
      expect: 'no spec files',
      mutate: (dir) => {
        for (const name of ['extensions.spec.ts', 'generated-registration.spec.ts']) {
          rmSync(join(dir, 'src', 'lib', name), { force: true });
        }
      },
    },
    {
      label: 'blind-specs',
      expect: 'reference a registry',
      mutate: (dir) => {
        for (const name of ['extensions.spec.ts', 'generated-registration.spec.ts']) {
          rmSync(join(dir, 'src', 'lib', name), { force: true });
        }
        writeFileSync(
          join(dir, 'src', 'lib', 'blind.spec.ts'),
          "describe('blind', () => { it('never touches a registry', () => { expect(1).toBe(1); }); });\n",
        );
      },
    },
  ];

  for (const testCase of cases) {
    const target = mutatedCopy(testCase.label, testCase.mutate);
    cleanup.push(target);
    const result = runGuardrail(target);
    h.check(
      `it fails a library with: ${testCase.label}`,
      result.code !== 0 && result.output.includes(testCase.expect),
      `exit ${result.code}, output did not contain "${testCase.expect}": ` +
        result.output.slice(0, 300),
    );
  }

  // -------------------------------------------------------------------------
  h.step('All four generators are registered and resolvable');

  const collection = JSON.parse(
    readFile(join(ROOT, 'tools', 'satori-generators', 'generators.json')) ?? '{}',
  );
  const generators = Object.keys(collection.generators ?? {});
  for (const name of [
    'extension-library',
    'extension-rule',
    'extension-action',
    'extension-component',
  ]) {
    h.check(
      `${name} is registered in the collection`,
      generators.includes(name),
      `collection lists [${generators.join(', ')}]`,
    );
    const entry = collection.generators?.[name];
    h.check(
      `${name} resolves its factory and schema on disk`,
      Boolean(entry) &&
        existsSync(join(ROOT, 'tools', 'satori-generators', `${entry.factory}.ts`)) &&
        existsSync(join(ROOT, 'tools', 'satori-generators', entry.schema)),
      `factory ${entry?.factory}, schema ${entry?.schema}`,
    );
  }

  // -------------------------------------------------------------------------
  h.step('Non-interference with the internal harness (negative check)');

  // Phase 5 was required not to disturb the harness this development runs on. This
  // asserts the state rather than the change, so it would also pass had Phase 5 done
  // nothing — read it as a guard, not as delivery.
  const untouched = execFileSync(
    'git',
    [
      'diff',
      '--stat',
      'HEAD',
      '--',
      'AGENTS',
      'AGENTS.md',
      'CLAUDE.md',
      'scripts/review-guardrails.mjs',
      '.cursor',
      '.github/workflows',
    ],
    { encoding: 'utf8', cwd: ROOT },
  ).trim();
  h.check(
    'AGENTS/, CLAUDE.md, review-guardrails.mjs, .cursor/ and the workflows are unmodified',
    untouched === '',
    `git reports changes:\n${untouched}`,
  );

  h.note(
    'NOT covered: the generator commands in the shipped AGENTS.md are ' +
      '`./tools/satori-generators:*`, a path inside this repository. A customer who ' +
      'installs the package has no such path, so the commands as written are not ' +
      'runnable for them. Making the generators invocable from an installed package is ' +
      'unresolved.',
  );

  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
}
