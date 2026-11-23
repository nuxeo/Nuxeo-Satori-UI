#!/usr/bin/env node
/**
 * The `storybook-satori` gate: build the Satori adapter's Storybook and check, in a real browser,
 * that Satori's own translation loader is served the catalogues it asks for.
 *
 * ## Why this exists
 *
 * satori-ui 1.0.0 stopped shipping bare-named catalogues (`en.json`), and the Satori Storybook kept
 * asking for `en`. Every story rendered raw `sat.*` keys while every gate was green: a Storybook
 * build succeeds with raw keys on screen, and nothing opened a story. The static guardrail
 * `checkStorybookSatoriCatalogues` was written for it, and twelve review rounds each found another
 * way of writing `staticDirs`, `assets` or the loader's languages that it could not follow. This
 * asks the built Storybook instead, so the question it answers is the real one — is the file
 * served — and no way of writing the configuration can make it disagree with what is served.
 *
 * ## What it runs
 *
 * `nx run satori-components-satori:build-storybook`, then
 * `scripts/storybook-interactions.mjs --satori` on its output. That runner opens every story in
 * Chromium and, with `--satori`, fails a story whose Satori catalogue request answers an error
 * without the loader's base-language fallback loading, that loads no Satori catalogue, or that
 * leaves a `sat.*` key on screen. See the runner's header for the rest of what fails a story.
 *
 * ## When it does not run
 *
 * It needs `@hylandsoftware/satori-ui` (a GitHub Packages token) and `@playwright/test` with
 * Chromium (installed with `--no-save`). Without either it exits NOT_RUN_EXIT_CODE: never green.
 *
 * Exit 0 every story passed, 1 a story failed or the build failed, 78 it could not run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NOT_RUN_EXIT_CODE } from './gate-summary.mjs';
import { spawnToolSync } from './package-command.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECT = 'satori-components-satori';
const OUTPUT = join('dist', 'storybook', PROJECT);

function notRun(message) {
  console.log(`storybook-satori: NOT RUN — ${message}`);
  process.exit(NOT_RUN_EXIT_CODE);
}

if (!existsSync(join(ROOT, 'node_modules', '@hylandsoftware', 'satori-ui', 'package.json'))) {
  notRun(
    '@hylandsoftware/satori-ui is not installed, so the Satori Storybook cannot be built. It ' +
      'installs from GitHub Packages with SATORI_GH_READONLY_TOKEN.',
  );
}
let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  notRun(
    '@playwright/test is not installed. Install it without touching the lockfile: ' +
      'npm install --no-save @playwright/test && npx playwright install chromium',
  );
}
// The package is not the browser: with Chromium's binary missing the import succeeds, the build
// runs, and the runner then fails — a FAIL that stops later gates, for an environment that simply
// cannot run this one (review on #602). Launch it before building, and say NOT RUN if it cannot.
try {
  const browser = await chromium.launch();
  await browser.close();
} catch (error) {
  notRun(
    `Chromium cannot be launched (${String(error?.message ?? error).split('\n')[0]}). Install it: ` +
      'npx playwright install chromium',
  );
}

console.log(`storybook-satori: building ${PROJECT}'s Storybook`);
const build = spawnToolSync('nx', ['run', `${PROJECT}:build-storybook`], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (build.error || build.status !== 0) {
  console.error(
    `storybook-satori: FAIL — the ${PROJECT} Storybook did not build` +
      (build.error ? ` (${build.error.message})` : ` (exit ${build.status})`),
  );
  process.exit(1);
}

const run = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts', 'storybook-interactions.mjs'), '--satori', '--dir', OUTPUT],
  { cwd: ROOT, stdio: 'inherit' },
);
if (run.status === 0) process.exit(0);
console.error(
  run.status === 2
    ? 'storybook-satori: FAIL — the runner could not run the built Storybook (see above).'
    : 'storybook-satori: FAIL — a Satori story is not served its catalogues (see above).',
);
process.exit(1);
