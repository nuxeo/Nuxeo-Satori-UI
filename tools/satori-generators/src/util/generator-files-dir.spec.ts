import { workspaceRoot } from '@nx/devkit';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { generatorFilesDir } from './generator-files-dir';

/**
 * The generators that ship templates. Asserted against the directory listing below, so a new
 * generator with a `files/` directory cannot be added without this list naming it.
 */
const WITH_TEMPLATES = [
  'config-package',
  'extension-component',
  'extension-library',
  'satori-component',
];

const SRC = join(workspaceRoot, 'tools', 'satori-generators', 'src');

describe('generatorFilesDir', () => {
  // Vitest defines `__dirname`, and so does the CommonJS that
  // `scripts/build-platform-generators.mjs` emits — the branch the published package takes.
  it.each(WITH_TEMPLATES)('resolves %s from this module’s own directory', (generator) => {
    const dir = generatorFilesDir(generator, __dirname);
    expect(dir).toBe(join(SRC, generator, 'files'));
    expect(existsSync(dir)).toBe(true);
  });

  // The branch Nx takes: native type stripping loads the source as ESM, where `__dirname` is
  // not defined at all. No unit test reaches this through the real global — vitest always
  // defines it — which is why `here` is a parameter, and why the CLI run is recorded in the
  // NXSAT-795 evidence rather than asserted here.
  it.each(WITH_TEMPLATES)('resolves %s with no __dirname at all', (generator) => {
    const dir = generatorFilesDir(generator, undefined);
    expect(dir).toBe(join(SRC, generator, 'files'));
    expect(existsSync(dir)).toBe(true);
  });

  it('resolves both branches to the same directory', () => {
    for (const generator of WITH_TEMPLATES) {
      expect(generatorFilesDir(generator, undefined)).toBe(generatorFilesDir(generator, __dirname));
    }
  });

  // The two branches agree only while this module stays one level below the generators. Reading
  // the tree rather than trusting the list keeps that assumption asserted: move this file, or
  // add a generator with templates, and this fails rather than resolving to a directory that is
  // silently absent.
  it('names every generator directory that has a files/ directory', () => {
    const onDisk = readdirSync(SRC, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(SRC, entry.name, 'files')))
      .map((entry) => entry.name)
      .sort();
    expect(onDisk).toEqual([...WITH_TEMPLATES].sort());
  });
});
