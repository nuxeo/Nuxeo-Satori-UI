import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import appPackageGenerator from '../app-package/generator';
import appDependencyGenerator, { type AppDependencySchema } from './generator';

const ROOT = 'business-apps/packages/acme-onboarding';
const DESCRIPTOR = `${ROOT}/package/package.xml`;
const read = (tree: Tree): string => tree.read(DESCRIPTOR, 'utf-8') ?? '';

describe('app-dependency generator', () => {
  let tree: Tree;
  const generate = (options: Partial<AppDependencySchema>) =>
    appDependencyGenerator(tree, { package: ROOT, name: 'nuxeo-agentic-signature', ...options });

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    await appPackageGenerator(tree, {
      name: 'acme-onboarding',
      owner: 'acme',
      platform: '>=0.2.0 <1.0.0',
    });
  });

  it('adds a dependency after the platform, gives it another version in its place, and takes it out', async () => {
    const before = read(tree);
    await generate({ version: '0.1.0' });
    expect(read(tree)).toContain(
      '  <dependencies>\n' +
        '    <package>nuxeo-agentic-ui:2026.0.2</package>\n' +
        '    <package>nuxeo-agentic-signature:0.1.0</package>\n' +
        '  </dependencies>\n',
    );
    await generate({ version: '0.2.0:1.0.0' });
    expect(read(tree)).toContain('    <package>nuxeo-agentic-signature:0.2.0:1.0.0</package>\n');
    expect(read(tree).split('nuxeo-agentic-signature').length).toBe(2);
    await generate({ remove: true });
    expect(read(tree)).toBe(before);
  });

  const refusals: [string, Partial<AppDependencySchema>, string][] = [
    [
      'a name that is not a package',
      { name: 'Not A Package', version: '1.0.0' },
      'is not a Marketplace',
    ],
    ['no version', {}, '--version ""'],
    ['a version that is not one', { version: 'latest' }, '--version "latest"'],
    ['itself', { name: 'acme-onboarding', version: '1.0.0' }, "this package's own name"],
    ["the platform's own, taken out", { name: 'nuxeo-agentic-ui', remove: true }, 'it stays'],
    [
      'a removal of one it does not have',
      { remove: true },
      'has no dependency on nuxeo-agentic-signature',
    ],
    ['a removal with a version', { remove: true, version: '1.0.0' }, 'without --version'],
  ];
  for (const [what, options, message] of refusals) {
    it(`refuses ${what}, and writes nothing`, async () => {
      const before = read(tree);
      await expect(generate(options)).rejects.toThrow(message);
      expect(read(tree)).toBe(before);
    });
  }
});
