import { workspaceRoot } from '@nx/devkit';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { filesDirFrom, generatorFilesDir } from './generator-files-dir';

/**
 * The generators that ship templates. Asserted against the directory listing in the last test,
 * so a new generator with a `files/` directory cannot be added without this list naming it.
 */
const WITH_TEMPLATES = [
  'config-package',
  'extension-component',
  'extension-library',
  'satori-component',
];

const SRC = join(workspaceRoot, 'tools', 'satori-generators', 'src');

/**
 * Both branches resolve to the same directory *in this repository*, so a test that merely
 * compares their output to the same expected path cannot tell which one ran — and the first
 * version of this spec did exactly that, passing `undefined` to a default parameter that then
 * supplied `__dirname` anyway. Hence `withAForeignDirectory` below: only the CommonJS branch
 * derives its answer from `here`, so a fake `here` is what distinguishes them.
 */
describe('filesDirFrom', () => {
  // The ESM branch: no module directory at all, which is what Nx's native type stripping leaves.
  it.each(WITH_TEMPLATES)('resolves %s from the workspace when there is no module dir', (name) => {
    const dir = filesDirFrom(undefined, name);
    expect(dir).toBe(join(SRC, name, 'files'));
    expect(existsSync(dir)).toBe(true);
  });

  // The CommonJS branch, in this repository's layout.
  it.each(WITH_TEMPLATES)('resolves %s from this module’s own directory', (name) => {
    const dir = filesDirFrom(join(SRC, 'util'), name);
    expect(dir).toBe(join(SRC, name, 'files'));
    expect(existsSync(dir)).toBe(true);
  });

  // The discriminator. A `here` that is nowhere near this workspace must still be honoured —
  // that is the published layout, `generators/util` beside `generators/<name>` inside
  // `@nuxeo/satori-platform`. If the CommonJS branch ever stopped using `here`, every other
  // assertion here would still pass and this one would fail.
  it('withAForeignDirectory, derives the path from it and not from the workspace', () => {
    const foreign = join('/fake', 'package', 'generators', 'util');
    const dir = filesDirFrom(foreign, 'config-package');
    expect(dir).toBe(join('/fake', 'package', 'generators', 'config-package', 'files'));
    expect(dir.startsWith(workspaceRoot)).toBe(false);
  });

  it('resolves both branches to the same directory in this repository', () => {
    for (const name of WITH_TEMPLATES) {
      expect(filesDirFrom(undefined, name)).toBe(filesDirFrom(join(SRC, 'util'), name));
    }
  });
});

describe('generatorFilesDir', () => {
  // Vitest defines `__dirname`, so this takes the CommonJS branch — the same one the published
  // package takes, and the only one reachable from a test: `__dirname` is a module-scoped
  // binding, not a property of `globalThis`, so it cannot be stubbed away. The ESM branch is
  // covered above through `filesDirFrom`, and end to end by the Nx command-line runs recorded on
  // PR #575, where `__dirname` genuinely does not exist.
  it.each(WITH_TEMPLATES)('resolves %s', (name) => {
    const dir = generatorFilesDir(name);
    expect(dir).toBe(join(SRC, name, 'files'));
    expect(existsSync(dir)).toBe(true);
  });
});

// The two branches agree only while the resolver stays one level below the generators. Reading
// the tree rather than trusting the list keeps that assumption asserted: move the resolver, or
// add a generator with templates, and this fails rather than resolving to a directory that is
// silently absent.
describe('the layout both branches assume', () => {
  it('names every generator directory that has a files/ directory', () => {
    const onDisk = readdirSync(SRC, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(SRC, entry.name, 'files')))
      .map((entry) => entry.name)
      .sort();
    expect(onDisk).toEqual([...WITH_TEMPLATES].sort());
  });

  it('keeps the resolver one level below the generators', () => {
    expect(existsSync(join(SRC, 'util', 'generator-files-dir.ts'))).toBe(true);
  });
});
