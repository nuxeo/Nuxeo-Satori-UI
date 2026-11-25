/**
 * The axe engine the published WCAG 2.1 AA verdict is measured with, and what is installed.
 *
 * `phase-6-a11y` owns that verdict (`docs/accessibility.md`). Its prerequisites installed
 * `@axe-core/playwright` with `npm install --no-save` and no version, so each checkout ran
 * whatever the registry served on the day it installed. The 2026-10-22 pass ran axe-core 4.13.0
 * and the 2026-11-23 record ran 4.14.1, and 4.14 brought `label-content-name-mismatch` (2.5.3)
 * under the WCAG tags. The verdict changed with no commit, and the manifest, which recorded Node
 * and nothing else, could not say why (gap 8 in `docs/accessibility.md`).
 *
 * Both packages are pinned, because pinning the wrapper does not pin the engine.
 * `@axe-core/playwright@4.14.0` depends on `axe-core ~4.14.0`, and the registry published 4.14.0
 * on 2026-10-05 and 4.14.1 on 2026-11-16, both inside that range. Checkouts installed weeks apart
 * hold each of them under the same wrapper. A patch release can change what a rule reports, so
 * the engine is named in the install command and checked.
 *
 * Not `a11y/versions.mjs`. That file pins 4.13.0 for a11y-scout, whose recorded findings were
 * measured with it, and `a11y/` is built to be deleted without editing a shared script, so the
 * harness imports nothing from it. One `node_modules` holds one version of each package, so the
 * two layers cannot be installed side by side. After this install a11y-scout's preflight refuses
 * with exit 2, and after a11y-scout's install `phase-6-a11y` does. Install for the layer you are
 * about to run.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * The engine `phase-6-a11y` is measured with: the pair the 2026-11-23 record ran.
 *
 * Re-pinning is a re-measurement. Change these, re-run the capture in the same change, and update
 * the install line in the prose that cannot import this file: the steps file's header,
 * `README.md`, `capture-phase-evidence/SKILL.md` and `.github/workflows/a11y.yml`.
 */
export const PINNED_AXE = Object.freeze({
  '@axe-core/playwright': '4.14.0',
  'axe-core': '4.14.1',
});

/**
 * The install that puts the pinned engine in place. `@playwright/test` is in the same command
 * because `npm install --no-save` removes anything an earlier `--no-save` install added.
 */
export const PINNED_AXE_INSTALL = `npm install --no-save @playwright/test ${Object.entries(
  PINNED_AXE,
)
  .map(([pkg, version]) => `${pkg}@${version}`)
  .join(' ')}`;

/**
 * The version of the package `name` resolves to from `from`, or `null` when it does not resolve.
 *
 * Resolved with Node's own resolver, so it answers for the copy an `import` from the same place
 * would load, wherever npm put it. It walks up from the resolved entry point to the package's
 * manifest, because an `exports` map may refuse `<name>/package.json`, and
 * `@axe-core/playwright`'s exports only `.`.
 *
 * @param {string} name
 * @param {string | URL} [from] a file the resolution starts from; this module by default
 * @returns {{ version: string | null, entry: string } | null}
 */
function resolvePackage(name, from = import.meta.url) {
  let entry;
  try {
    entry = createRequire(from).resolve(name);
  } catch {
    return null;
  }
  for (let dir = dirname(entry); ; dir = dirname(dir)) {
    let manifest = null;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      // No readable manifest in this directory. Keep walking.
    }
    if (manifest?.name === name) {
      return { version: typeof manifest.version === 'string' ? manifest.version : null, entry };
    }
    if (dirname(dir) === dir) return null;
  }
}

/**
 * The installed version of `name`, as an import from this directory would load it, or `null`.
 *
 * @param {string} name
 * @returns {string | null}
 */
export function installedVersion(name) {
  return resolvePackage(name)?.version ?? null;
}

/**
 * The installed axe pair, as a scan loads it, with `null` for a package that is not there.
 *
 * `@axe-core/playwright` is resolved from this directory, as `helpers.mjs` imports it.
 * `axe-core` is resolved from the wrapper's entry point, which is where the wrapper's own
 * `import axe from 'axe-core'` resolves. Reading `node_modules/axe-core` at the root would report
 * the lockfile's 4.13.0 whenever npm nests the wrapper's engine beside it instead.
 *
 * @returns {{ '@axe-core/playwright': string | null, 'axe-core': string | null }}
 */
export function installedAxe() {
  const wrapper = resolvePackage('@axe-core/playwright');
  return {
    '@axe-core/playwright': wrapper?.version ?? null,
    'axe-core': wrapper ? (resolvePackage('axe-core', wrapper.entry)?.version ?? null) : null,
  };
}

/**
 * Why the installed axe pair is not the pinned one, or `null` when it is.
 *
 * @param {ReturnType<typeof installedAxe>} installed
 * @returns {string | null}
 */
export function axeEngineProblem(installed) {
  const wrong = Object.entries(PINNED_AXE)
    .filter(([pkg, pinned]) => installed[pkg] !== pinned)
    .map(([pkg, pinned]) => `${pkg} is ${installed[pkg] ?? 'not installed'}, pinned ${pinned}`);
  return wrong.length ? wrong.join('; ') : null;
}
