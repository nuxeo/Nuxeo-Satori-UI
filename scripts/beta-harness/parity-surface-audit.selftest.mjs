#!/usr/bin/env node
/**
 * Negative controls for `parity-surface-audit.mjs` — proof that each of its three rules can fail,
 * and that its two exemptions do not quietly excuse everything.
 *
 * A gate is not evidence until it has been seen to fail on purpose. This one was written because
 * the parity run spent two months unable to finish while every local gate was green: the defects
 * were in a steps file nothing audited. A guard against that, which could not itself go red, would
 * be the same mistake one layer up.
 *
 * Nothing tracked is touched. Each control is a small synthetic steps file written to a temporary
 * directory, shaped like the real one — a `SURFACES` map of named adapter objects — with exactly
 * one thing wrong. The temporary directory is removed in a `finally`, and on a signal.
 *
 * Usage:  node scripts/beta-harness/parity-surface-audit.selftest.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const AUDIT = 'scripts/beta-harness/parity-surface-audit.mjs';
const REAL_STEPS = 'scripts/beta-harness/steps/nxsat-308-parity.mjs';

const dir = mkdtempSync(join(tmpdir(), 'parity-surface-selftest-'));
const cleanUp = () => rmSync(dir, { recursive: true, force: true });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    cleanUp();
    process.exit(130);
  });
}
process.on('uncaughtException', (error) => {
  cleanUp();
  console.error(error);
  process.exit(2);
});

/**
 * A steps file in the shape the audit reads. `adapters` is appended inside each surface object and
 * `steps` becomes the body outside every adapter, which is the distinction every rule turns on.
 */
const stepsFile = ({
  adfExtra = '',
  nxsExtra = '',
  helpers = '',
  steps = '',
  surfacesMap = "{ 'adf-hx': ADF_HX, nxs: NXS }",
}) => `
${helpers}
const ADF_HX = {
  id: 'adf-hx',
  list: { rows: 'hxp-document-list tr' },
  viewer: { root: 'mat-dialog-container', fallback: 'adf-viewer-unknown-format' },
  knownGaps: new Set(['viewer.pdf']),
${adfExtra}
};
const NXS = {
  id: 'nxs',
  list: { rows: 'nxs-document-list tr' },
  viewer: { root: 'lib-document-viewer', fallback: '.viewer-placeholder' },
  knownGaps: new Set(),
${nxsExtra}
};
const SURFACES = ${surfacesMap};

export default async function run(page, h) {
  const A = SURFACES[process.env['PARITY_SURFACE'] ?? 'adf-hx'];
  const rows = await page.locator(A.list.rows).count();
  h.check('rows are listed', rows > 0, String(rows));
  const gapped = A.knownGaps.has('viewer.pdf');
  h.check('the gap is declared or it is not', typeof gapped === 'boolean', String(gapped));
${steps}
}
`;

const controls = [
  {
    name: 'a clean steps file passes',
    expectExit: 0,
    file: stepsFile({}),
  },
  {
    name: 'a click with no .catch() is caught',
    expectExit: 1,
    expectRule: 'unguarded-click',
    file: stepsFile({ steps: `  await page.locator(A.list.rows).first().click();` }),
  },
  {
    name: 'a click WITH .catch() is not reported, so the rule is about the catch',
    expectExit: 0,
    file: stepsFile({
      steps: `  await page.locator(A.list.rows).first().click({ timeout: 10 }).catch(() => undefined);`,
    }),
  },
  {
    name: "a surface's element passed to locator() from a step is caught",
    expectExit: 1,
    expectRule: 'surface-selector-in-step',
    file: stepsFile({ steps: `  await page.locator('nxs-error-state button').count();` }),
  },
  {
    name: "a surface's element inside a page.evaluate's querySelectorAll is caught",
    expectExit: 1,
    expectRule: 'surface-selector-in-step',
    file: stepsFile({
      steps: `  await page.evaluate(() => document.querySelectorAll('nxs-viewer-fallback').length);`,
    }),
  },
  {
    name: "a surface's element inside :is() is caught — ( is a boundary too",
    expectExit: 1,
    expectRule: 'surface-selector-in-step',
    file: stepsFile({ steps: `  await page.locator(':is(nxs-error-state) button').count();` }),
  },
  {
    name: "a surface's element inside :has() is caught",
    expectExit: 1,
    expectRule: 'surface-selector-in-step',
    file: stepsFile({ steps: `  await page.locator('main:has(nxs-error-state)').count();` }),
  },
  {
    name: 'an inline object spread that replaces an inherited group is resolved, not ignored',
    // `{ ...ADF_HX, ...{ search: {} } }` replaces the whole group at run time. Skipping the inline
    // spread read `search.pageSize` as still inherited, so a step reading it got no finding on a
    // surface where it is undefined.
    expectExit: 1,
    expectRule: 'adapter-gap',
    file: stepsFile({
      adfExtra: `  search: { pageSize: 50 },`,
      nxsExtra: `  ...{ search: {} },`,
      steps: `  h.check('page size', A.search.pageSize > 0, String(A.search.pageSize));`,
    }),
  },
  {
    name: 'the same element inside an adapter is not reported, so the rule is about where it is',
    expectExit: 0,
    file: stepsFile({
      nxsExtra: `  extra: { bar: 'nxs-error-state button' },`,
      adfExtra: `  extra: { bar: 'adf-error' },`,
    }),
  },
  {
    name: 'an adapter key the steps read but one surface does not define is caught',
    expectExit: 1,
    expectRule: 'adapter-gap',
    file: stepsFile({
      nxsExtra: `  search: { pageSize: 40 },`,
      steps: `  h.check('page size', A.search.pageSize > 0, String(A.search.pageSize));`,
    }),
  },
  {
    name: 'the same key defined on both surfaces passes',
    expectExit: 0,
    file: stepsFile({
      adfExtra: `  search: { pageSize: 50 },`,
      nxsExtra: `  search: { pageSize: 40 },`,
      steps: `  h.check('page size', A.search.pageSize > 0, String(A.search.pageSize));`,
    }),
  },
  {
    name: 'a top-level adapter key one surface does not define is caught',
    // `A.crumbHref` is read directly, not as `A.group.member`. Only the two-level shape was
    // collected, so deleting a surface's `crumbHref` produced no finding at all — on the very
    // function the breadcrumb step calls before its guarded click.
    expectExit: 1,
    expectRule: 'adapter-gap',
    file: stepsFile({
      adfExtra: `  crumbHref: (path) => '#/browse-adf-hx?path=' + path,`,
      steps: `  h.check('crumb href', typeof A.crumbHref === 'function', 'fn');`,
    }),
  },
  {
    name: 'the same top-level key defined on both surfaces passes',
    expectExit: 0,
    file: stepsFile({
      adfExtra: `  crumbHref: (path) => '#/browse-adf-hx?path=' + path,`,
      nxsExtra: `  crumbHref: (path) => '#/browse' + path,`,
      steps: `  h.check('crumb href', typeof A.crumbHref === 'function', 'fn');`,
    }),
  },
  {
    name: 'a method call on a non-object adapter value is not reported as a missing key',
    // `A.knownGaps.has(…)` is in every control above. If it were read as `knownGaps.has`, every
    // one of them would fail, and the suite would be measuring nothing but this bug.
    expectExit: 0,
    file: stepsFile({}),
  },
  {
    name: 'a helper only the adapters call may hold their selectors',
    expectExit: 0,
    file: stepsFile({
      helpers: `async function openAdfTab(page, tab) {
  await page.locator('hxp-browse-tabs [role="tab"]').filter({ hasText: tab }).first().click({ timeout: 10 }).catch(() => undefined);
}`,
      adfExtra: `  openTab: (page, tab) => openAdfTab(page, tab),`,
      nxsExtra: `  openTab: (page) => page.locator('[role="tab"]').first().click({ timeout: 10 }).catch(() => undefined),`,
      steps: `  await A.openTab(page, 'Permissions');`,
    }),
  },
  {
    name: 'a helper the steps also call may not — the exemption is not a blanket one',
    expectExit: 1,
    expectRule: 'surface-selector-in-step',
    file: stepsFile({
      helpers: `async function openAdfTab(page, tab) {
  await page.locator('hxp-browse-tabs [role="tab"]').filter({ hasText: tab }).first().click({ timeout: 10 }).catch(() => undefined);
}`,
      adfExtra: `  openTab: (page, tab) => openAdfTab(page, tab),`,
      nxsExtra: `  openTab: (page) => page.locator('[role="tab"]').first().click({ timeout: 10 }).catch(() => undefined),`,
      steps: `  await openAdfTab(page, 'Permissions');`,
    }),
  },
  {
    name: 'a SURFACES entry written inline refuses the whole map rather than auditing the rest',
    // The audit's own version of the bug it exists to catch: the unresolvable entry was skipped,
    // and a run that never looked at `nxs` at all reported a pass.
    expectExit: 2,
    file: stepsFile({
      surfacesMap: "{ 'adf-hx': ADF_HX, nxs: { ...NXS, search: {} } }",
      steps: `  await page.locator(A.list.rows).count();`,
    }),
  },
  {
    name: 'a SURFACES entry naming an unknown adapter refuses the whole map',
    expectExit: 2,
    file: stepsFile({ surfacesMap: "{ 'adf-hx': ADF_HX, nxs: NXS_TYPO }" }),
  },
  {
    name: 'a spread inside the SURFACES map refuses it',
    expectExit: 2,
    file: stepsFile({ surfacesMap: "{ ...{ 'adf-hx': ADF_HX }, nxs: NXS }" }),
  },
  {
    name: 'a group one surface defines as a value, opposite a real group, is caught',
    // The scalar exemption is for `knownGaps: new Set(…)`. It must not excuse `search: null`
    // opposite `search: { pageSize }` — the nxs run throws on `A.search.pageSize`.
    expectExit: 1,
    expectRule: 'adapter-gap',
    file: stepsFile({
      adfExtra: `  search: { pageSize: 50 },`,
      nxsExtra: `  search: null,`,
      steps: `  h.check('page size', A.search.pageSize > 0, String(A.search.pageSize));`,
    }),
  },
  {
    name: 'a file with no SURFACES map is refused rather than passed',
    expectExit: 2,
    file: `export default async function run() {}\n`,
  },
  {
    name: 'a file that does not parse is refused rather than passed',
    expectExit: 2,
    file: `const broken = {{{\n`,
  },
];

const run = (file) =>
  spawnSync('node', [AUDIT, '--json', file], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });

let failures = 0;
try {
  controls.forEach((control, index) => {
    const path = join(dir, `control-${index}.mjs`);
    writeFileSync(path, control.file, 'utf8');
    const result = run(path);
    const exit = result.status;
    let rules = [];
    try {
      rules = (JSON.parse(result.stdout).files ?? []).flatMap((f) =>
        (f.findings ?? []).map((x) => x.rule),
      );
    } catch {
      rules = [];
    }
    const exitOk = exit === control.expectExit;
    const ruleOk = !control.expectRule || rules.includes(control.expectRule);
    if (exitOk && ruleOk) {
      console.log(`  ok    ${control.name}`);
      return;
    }
    failures += 1;
    console.error(
      `  FAIL  ${control.name}\n` +
        `        expected exit ${control.expectExit}` +
        `${control.expectRule ? ` with rule "${control.expectRule}"` : ''}, ` +
        `got exit ${exit} with rules ${JSON.stringify(rules)}`,
    );
    if (result.stderr?.trim())
      console.error(`        stderr: ${result.stderr.trim().slice(0, 300)}`);
  });

  // The tracked file the gate actually guards. A suite of synthetic controls that passes while the
  // real file is red would be answering a different question than the gate does.
  const real = run(REAL_STEPS);
  if (real.status === 0) {
    console.log(`  ok    the tracked parity steps pass the audit`);
  } else {
    failures += 1;
    console.error(
      `  FAIL  the tracked parity steps do not pass the audit (exit ${real.status})\n` +
        `        run: node ${AUDIT}`,
    );
  }
} finally {
  cleanUp();
}

console.log(
  failures === 0
    ? `\nparity-surface-audit selftest: pass — ${controls.length + 1} controls`
    : `\nparity-surface-audit selftest: FAIL — ${failures} of ${controls.length + 1} controls`,
);
process.exit(failures === 0 ? 0 : 1);
