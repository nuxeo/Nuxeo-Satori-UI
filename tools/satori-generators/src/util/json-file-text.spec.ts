import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import appActionGenerator from '../app-action/generator';
import appFormGenerator from '../app-form/generator';
import appLayoutGenerator from '../app-layout/generator';
import appPackageGenerator from '../app-package/generator';
import { CONTRACTS_MODEL } from '../app-package/testing/scaffold';
import appQueueGenerator from '../app-queue/generator';
import { jsonFileText } from './json-file-text';

const REPOSITORY = join(__dirname, '..', '..', '..', '..');
const DESIGNERS = join(REPOSITORY, 'libs/features/layout-designer/src/lib/json-file-text.ts');
const COPY = join(__dirname, 'json-file-text.ts');

/** A file's code, below its first comment: the header each copy has of its own. */
const code = (path: string): string => {
  const text = readFileSync(path, 'utf8');
  return text.slice(text.indexOf('*/\n') + 3);
};

/** As the repository's Prettier lays out a file holding `value` afresh: the designer's bytes. */
async function afresh(value: unknown, path: string): Promise<string> {
  const filepath = join(REPOSITORY, path);
  const config = await prettier.resolveConfig(filepath);
  return prettier.format(JSON.stringify(value), { ...config, filepath });
}

describe("the generators' copy of the layout designer's writer", () => {
  it("is the designer's, line for line below its header", () => {
    expect(code(COPY)).toBe(code(DESIGNERS));
  });

  describe('writes the files the designer opens as it saves them', () => {
    const ROOT = 'business-apps/packages/acme-contracts';
    const CONFIG = `${ROOT}/bundle/agentic-ui-config`;
    const written = async (): Promise<Tree> => {
      const tree = createTreeWithEmptyWorkspace();
      await appPackageGenerator(tree, {
        name: 'acme-contracts',
        owner: 'acme',
        platform: '>=0.2.0 <1.0.0',
      });
      await appLayoutGenerator(tree, { package: ROOT, type: 'Contract', model: CONTRACTS_MODEL });
      await appFormGenerator(tree, {
        package: ROOT,
        type: 'Contract',
        mode: 'edit',
        required: 'dc:title,contract:number',
        model: CONTRACTS_MODEL,
      });
      await appQueueGenerator(tree, {
        package: ROOT,
        id: 'up-for-renewal',
        pageProvider: 'acme_renewals',
        columns: 'contract:number,dc:title',
        sort: 'contract:end',
      });
      await appActionGenerator(tree, {
        package: ROOT,
        id: 'acme-contracts.approve',
        transition: 'approve',
        on: 'record,row',
        queue: 'up-for-renewal',
      });
      return tree;
    };

    it('an Edit form, a record page and a queue: each the bytes Prettier writes for it afresh', async () => {
      const tree = await written();
      for (const path of [
        `${CONFIG}/layouts/Contract/edit.layout.json`,
        `${CONFIG}/layouts/Contract/view.layout.json`,
        `${CONFIG}/queues/up-for-renewal.json`,
      ]) {
        const text = tree.read(path, 'utf-8') ?? '';
        expect(text, path).toBe(await afresh(JSON.parse(text), path));
        expect(text, path).toBe(jsonFileText(JSON.parse(text)));
      }
    });

    it("keeps an entry that fits on a line on one: the facilities kit's four-line required field", async () => {
      const tree = await written();
      const form = tree.read(`${CONFIG}/layouts/Contract/edit.layout.json`, 'utf-8') ?? '';
      expect(form).toContain('{ "field": "dc:title", "required": true }');
      const queue = tree.read(`${CONFIG}/queues/up-for-renewal.json`, 'utf-8') ?? '';
      expect(queue).toContain('"sort": [{ "field": "contract:end", "order": "asc" }]');
      expect(queue).toContain('"rowActions": ["acme-contracts.approve"]');
    });
  });
});
