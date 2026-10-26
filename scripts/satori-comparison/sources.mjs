/**
 * A digest of everything the capture's images depend on, so publish can refuse a stale capture.
 *
 * Covers the component sections as the check reads them (component, story, capture state), the
 * sources of both component libraries and their Storybook configuration, the application
 * catalogue their Storybook serves, the installed Satori version and the capture script itself.
 * A change to any of them changes the digest. A change outside them that alters rendering — in a
 * library these import, say — does not, so re-capture after one.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TREES = [
  'libs/shared/satori-components/src',
  'libs/shared/satori-components/.storybook',
  'libs/shared/satori-components-satori/src',
  'libs/shared/satori-components-satori/.storybook',
];
const FILES = [
  'libs/shared/satori-components/project.json',
  'libs/shared/satori-components-satori/project.json',
  'apps/nuxeo-ui/public/i18n/en.json',
  'node_modules/@hylandsoftware/satori-ui/package.json',
  'scripts/satori-comparison/capture.mjs',
];

function walk(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) return walk(root, child);
    return entry.name.endsWith('.spec.ts') ? [] : [child];
  });
}

/**
 * @param {string} root
 * @param {Array<object>} components `loadComparison(root).components`
 * @returns {{ digest: string, files: number }}
 */
export function captureInputs(root, components) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(components));
  const files = [...TREES.flatMap((t) => walk(root, t)), ...FILES].sort();
  for (const file of files) {
    hash.update(`\0${file}\0`);
    const abs = join(root, file);
    hash.update(existsSync(abs) ? readFileSync(abs) : '(absent)');
  }
  return { digest: hash.digest('hex'), files: files.length };
}
