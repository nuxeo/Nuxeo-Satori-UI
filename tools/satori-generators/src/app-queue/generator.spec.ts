import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import appModelGenerator from '../app-model/generator';
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

  describe('--facets', () => {
    const QUEUE = `${CONFIG}/queues/open-contracts.json`;
    const LABELS = `${CONFIG}/labels/en.json`;
    const MODEL = `${ROOT}/bundle/OSGI-INF/acme-contracts-model.xml`;
    const facet = (aggregate: string) => ({
      aggregate,
      labelKey: `acme-contracts.facet.${aggregate}`,
    });

    // A stand-in model, as app-model writes one: a page provider of the search index with two
    // terms aggregates, <prefix>_<name>_agg, and one of the repository, which answers none.
    beforeEach(async () => {
      await appModelGenerator(tree, {
        package: ROOT,
        type: 'Contract',
        properties: 'number,status=Draft|Active,noticeDays:long,value:double',
      });
      await appModelGenerator(tree, {
        package: ROOT,
        type: 'Contract',
        pageProvider: 'acme_open_contracts',
        aggregates: 'contract:status,contract:noticeDays',
      });
      await appModelGenerator(tree, {
        package: ROOT,
        type: 'Contract',
        pageProvider: 'acme_all_contracts',
      });
    });

    it("writes each aggregate id the package's page provider defines, named in labels/en.json", async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      let output = '';
      try {
        (await generate({ facets: 'contract_status_agg, contract_noticeDays_agg' }))();
        output = log.mock.calls.map((call) => call.join(' ')).join('\n');
      } finally {
        log.mockRestore();
      }
      // Held to the page provider's definition, which the package has.
      expect(output).toContain(
        `Facets:         contract_status_agg, contract_noticeDays_agg, each an aggregate ${MODEL} defines`,
      );
      expect(output).not.toContain('not checked');
      expect(read(tree, QUEUE)['facets']).toEqual([
        facet('contract_status_agg'),
        facet('contract_noticeDays_agg'),
      ]);
      // The text is the property's name the aggregate groups by, made readable.
      expect(read(tree, LABELS)['labels']).toMatchObject({
        'acme-contracts.queue.open-contracts': 'Open contracts',
        'acme-contracts.facet.contract_status_agg': 'Status',
        'acme-contracts.facet.contract_noticeDays_agg': 'Notice days',
      });
    });

    it('takes a property for the aggregate the page provider defines on it, in the order given', async () => {
      await generate({ facets: 'contract:noticeDays,contract:status' });
      expect(read(tree, QUEUE)['facets']).toEqual([
        facet('contract_noticeDays_agg'),
        facet('contract_status_agg'),
      ]);
    });

    it("keeps the text labels/en.json has for a facet's key, and says so", async () => {
      await generate({ facets: 'contract:status' });
      const labels = read(tree, LABELS);
      (labels['labels'] as Record<string, string>)['acme-contracts.facet.contract_status_agg'] =
        'State';
      tree.write(LABELS, JSON.stringify(labels));
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      let output = '';
      try {
        (await generate({ force: true, facets: 'contract:status' }))();
        output = log.mock.calls.map((call) => call.join(' ')).join('\n');
      } finally {
        log.mockRestore();
      }
      expect(read(tree, LABELS)['labels']).toMatchObject({
        'acme-contracts.facet.contract_status_agg': 'State',
      });
      expect(output).toContain('Facets:         contract_status_agg');
      expect(output).toContain('acme-contracts.facet.contract_status_agg');
    });

    describe('refuses, writing nothing,', () => {
      const refusals: [string, Partial<AppQueueSchema>, string][] = [
        [
          'an aggregate the page provider does not define, naming those it does',
          { facets: 'contract:status,contract_owner_agg' },
          `the page provider "acme_open_contracts", defined in ${MODEL}, has no aggregate "contract_owner_agg": it defines contract_status_agg (contract:status), contract_noticeDays_agg (contract:noticeDays)`,
        ],
        [
          'a property it has no aggregate on',
          { facets: 'contract:value' },
          'has no aggregate on contract:value: it defines contract_status_agg (contract:status), contract_noticeDays_agg (contract:noticeDays)',
        ],
        [
          'a facet on a page provider of the repository, which answers no aggregate',
          { pageProvider: 'acme_all_contracts', facets: 'contract:status' },
          'it reads the repository, which answers none',
        ],
        [
          "a property on the server's page provider, whose aggregates nothing here reads",
          { pageProvider: 'default_search', facets: 'dc:creator' },
          "default_search is not one of the package's own page providers",
        ],
        [
          'what is neither an aggregate nor a property',
          { facets: 'contract status' },
          '--facets: "contract status" is neither an aggregate\'s id nor a property',
        ],
        [
          'an aggregate named twice, by its id and its property',
          { facets: 'contract:status,contract_status_agg' },
          '--facets names contract_status_agg twice',
        ],
        ['no aggregate at all', { facets: ' , ' }, '--facets names no aggregate'],
      ];
      for (const [what, options, message] of refusals) {
        it(what, async () => {
          const labels = tree.read(LABELS, 'utf-8');
          await expect(generate(options)).rejects.toThrow(message);
          expect(tree.exists(`${CONFIG}/queues`)).toBe(false);
          expect(tree.read(LABELS, 'utf-8')).toBe(labels);
        });
      }
    });

    it("writes an aggregate id on the server's page provider as given, and says it was not checked", async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      let output = '';
      try {
        (await generate({ pageProvider: 'default_search', facets: 'dc_creator_agg' }))();
        output = log.mock.calls.map((call) => call.join(' ')).join('\n');
      } finally {
        log.mockRestore();
      }
      expect(read(tree, QUEUE)['facets']).toEqual([facet('dc_creator_agg')]);
      expect(read(tree, LABELS)['labels']).toMatchObject({
        'acme-contracts.facet.dc_creator_agg': 'Creator',
      });
      expect(output).toContain('not checked');
      expect(output).toContain(
        `describe_page_provider, { "name": "default_search", "package": "${ROOT}" }`,
      );
    });

    it('on a queue that exists, keeps its facets unless forced, and replaces them when forced', async () => {
      await generate({ facets: 'contract:status' });
      // A widget written by hand on a facet, which this generator does not write.
      const queue = read(tree, QUEUE);
      tree.write(
        QUEUE,
        JSON.stringify({
          ...queue,
          facets: [{ ...facet('contract_status_agg'), widget: 'user' }],
        }),
      );
      const byHand = read(tree, QUEUE);
      await expect(generate({ facets: 'contract:noticeDays' })).rejects.toThrow(
        'already exists. Pass --force',
      );
      expect(read(tree, QUEUE)).toEqual(byHand);

      // Forced with no --facets, the queue keeps its own.
      await generate({ force: true, columns: 'dc:title' });
      expect(read(tree, QUEUE)['facets']).toEqual(byHand['facets']);

      // Forced with --facets, they are replaced: the ones given, in their order. A facet on an
      // aggregate the queue had keeps its widget.
      await generate({ force: true, facets: 'contract:noticeDays,contract:status' });
      expect(read(tree, QUEUE)['facets']).toEqual([
        facet('contract_noticeDays_agg'),
        { ...facet('contract_status_agg'), widget: 'user' },
      ]);
      await generate({ force: true, facets: 'contract_noticeDays_agg' });
      expect(read(tree, QUEUE)['facets']).toEqual([facet('contract_noticeDays_agg')]);
    });
  });
});
