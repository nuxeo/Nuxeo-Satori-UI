import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import appPackageGenerator from '../app-package/generator';
import appQueueGenerator, { type AppQueueSchema } from './generator';

const ROOT = 'business-apps/packages/acme-contracts';
const CONFIG = `${ROOT}/bundle/agentic-ui-config`;
const read = (tree: Tree, path: string): Record<string, unknown> =>
  JSON.parse(tree.read(path, 'utf-8') ?? 'null');

describe('app-queue generator', () => {
  let tree: Tree;
  const generate = (options: Partial<AppQueueSchema> = {}) =>
    appQueueGenerator(tree, {
      package: ROOT,
      id: 'open-contracts',
      pageProvider: 'acme_open_contracts',
      ...options,
    });

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    await appPackageGenerator(tree, {
      name: 'acme-contracts',
      owner: 'acme',
      platform: '>=0.2.0 <1.0.0',
    });
  });

  it("says to read the page provider with the package, which answers for a demo kit's own", async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output = '';
    try {
      (await generate())();
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }
    expect(output).toContain(
      `describe_page_provider, { "name": "acme_open_contracts", "package": "${ROOT}" }`,
    );
  });

  it('writes queues/<id>.json version 2, named by a label key in labels/en.json', async () => {
    await generate({
      columns: 'contract:number, dc:title ,contract:end',
      sort: 'contract:end:desc',
      pageSize: 25,
      label: 'Contracts to sign',
    });
    expect(read(tree, `${CONFIG}/queues/open-contracts.json`)).toEqual({
      $schema: '../../../../../../libs/shared/app-definition/src/queue.schema.json',
      version: 2,
      labelKey: 'acme-contracts.queue.open-contracts',
      pageProvider: 'acme_open_contracts',
      columns: ['contract:number', 'dc:title', 'contract:end'],
      sort: [{ field: 'contract:end', order: 'desc' }],
      pageSize: 25,
    });
    expect(read(tree, `${CONFIG}/labels/en.json`)['labels']).toMatchObject({
      'acme-contracts.queue.open-contracts': 'Contracts to sign',
    });
  });

  it('defaults to the title and the last change, sorted ascending when no order is said', async () => {
    await generate({ sort: 'dc:modified' });
    expect(read(tree, `${CONFIG}/queues/open-contracts.json`)).toMatchObject({
      columns: ['dc:title', 'dc:modified'],
      sort: [{ field: 'dc:modified', order: 'asc' }],
    });
    expect(read(tree, `${CONFIG}/labels/en.json`)['labels']).toMatchObject({
      'acme-contracts.queue.open-contracts': 'Open contracts',
    });
  });

  describe('refuses', () => {
    const refusals: [string, Partial<AppQueueSchema>, string][] = [
      ['an id that is not a file name', { id: '../open' }, '--id "../open"'],
      ['a page provider that is not a name', { pageProvider: 'select * from' }, '--pageProvider'],
      ['a column that is not <prefix>:<name>', { columns: 'title' }, '--columns: "title"'],
      ['a sort in another order', { sort: 'dc:title:up' }, '--sort "dc:title:up"'],
      ['a page size over 100', { pageSize: 500 }, '--pageSize 500'],
      [
        'a task variable as a column',
        { columns: 'dc:title,var:decision' },
        'var: names a task form',
      ],
      ['a task variable as the sort', { sort: 'var:decision' }, '--sort "var:decision"'],
    ];
    for (const [what, options, message] of refusals) {
      it(what, async () => {
        await expect(generate(options)).rejects.toThrow(message);
        expect(tree.exists(`${CONFIG}/queues`)).toBe(false);
      });
    }

    it('a queue the package has already, unless forced', async () => {
      await generate();
      await expect(generate()).rejects.toThrow('already exists. Pass --force');
      await generate({ force: true, columns: 'dc:title' });
      expect(read(tree, `${CONFIG}/queues/open-contracts.json`)['columns']).toEqual(['dc:title']);
    });
  });

  it('written again, keeps what it does not write: parameters, actions, facets, the rule', async () => {
    await generate({ sort: 'dc:modified:desc', pageSize: 20 });
    const file = `${CONFIG}/queues/open-contracts.json`;
    const queue = read(tree, file);
    const byHand = {
      parameters: ['open'],
      rowActions: ['acme-contracts.approve'],
      bulkActions: ['app.bulkActions.downloadZip'],
      facets: [{ aggregate: 'contract_category_agg', label: 'Category' }],
      visibleWhen: { type: 'app.rules.inGroup', parameters: ['legal'] },
    };
    tree.write(file, JSON.stringify({ ...queue, ...byHand }));
    await generate({
      force: true,
      columns: 'dc:title,contract:end',
      pageProvider: 'acme_contracts',
    });
    expect(read(tree, file)).toEqual({
      ...queue,
      ...byHand,
      pageProvider: 'acme_contracts',
      columns: ['dc:title', 'contract:end'],
      // Not given again, so kept.
      sort: [{ field: 'dc:modified', order: 'desc' }],
      pageSize: 20,
    });
  });
});
