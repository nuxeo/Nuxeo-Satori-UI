/**
 * Where a built entry point's declarations live, found the way TypeScript finds them.
 *
 * ng-packagr up to 20 wrote `<entry>/index.d.ts`, and the harness hardcoded that path. From 21
 * it writes one flattened file per entry under `types/` and says so in `exports[...].types` and
 * in each secondary entry's `package.json` `typings`. Guessing the path is what turned the
 * NXSAT-669 upgrade into a publishability "Cannot find module" that was the harness's fault, so
 * the path is read from the package's own metadata instead.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} root A built or installed package directory.
 * @param {string} subpath An `exports` key: `.` or `./extensions`.
 * @returns {string} The absolute path of that entry's `.d.ts`.
 */
export function entryTypes(root, subpath) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const declared = pkg.exports?.[subpath]?.types;
  if (declared) return join(root, declared);

  const entryDir = join(root, subpath);
  const entryPkg = join(entryDir, 'package.json');
  if (subpath !== '.' && existsSync(entryPkg)) {
    const typings = JSON.parse(readFileSync(entryPkg, 'utf8')).typings;
    if (typings) return join(entryDir, typings);
  }
  return join(entryDir, 'index.d.ts');
}
