import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import appPackageGenerator from '../app-package/generator';
import appQueueGenerator from '../app-queue/generator';
import appActionGenerator, { type AppActionSchema } from './generator';

const ROOT = 'business-apps/packages/acme-contracts';
const CONFIG = `${ROOT}/bundle/agentic-ui-config`;
const read = (tree: Tree, path: string): Record<string, unknown> =>
  JSON.parse(tree.read(path, 'utf-8') ?? 'null');

describe('app-action generator', () => {
  let tree: Tree;
  const generate = (options: Partial<AppActionSchema> = {}) =>
    appActionGenerator(tree, {
      package: ROOT,
      id: 'acme-contracts.approve',
      transition: 'approve',
      ...options,
    });

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    await appPackageGenerator(tree, {
      name: 'acme-contracts',
      owner: 'acme',
      platform: '>=0.2.0 <1.0.0',
    });
    await appQueueGenerator(tree, {
      package: ROOT,
      id: 'open-contracts',
      pageProvider: 'acme_open_contracts',
    });
  });

  it('writes a transition to actions.json, its texts as label keys in labels/en.json', async () => {
    await generate({
      type: 'Contract',
      icon: 'check',
      on: 'record,row',
      confirm: 'Approve this contract?',
      success: 'The contract is approved.',
    });
    expect(read(tree, `${CONFIG}/actions.json`)).toEqual({
      $schema: '../../../../../libs/shared/app-definition/src/actions.schema.json',
      version: 2,
      actions: [
        {
          id: 'acme-contracts.approve',
          labelKey: 'acme-contracts.action.approve',
          icon: 'check',
          on: ['record', 'row'],
          visibleWhen: { type: 'app.rules.isType', parameters: ['Contract'] },
          transition: 'approve',
          confirm: { labelKey: 'acme-contracts.action.approve.confirm' },
          success: { labelKey: 'acme-contracts.action.approve.done' },
        },
      ],
    });
    expect(read(tree, `${CONFIG}/labels/en.json`)['labels']).toMatchObject({
      'acme-contracts.action.approve': 'Approve',
      'acme-contracts.action.approve.confirm': 'Approve this contract?',
      'acme-contracts.action.approve.done': 'The contract is approved.',
    });
  });

  it('adds an operation after the actions there, with its parameters', async () => {
    await generate();
    await generate({
      id: 'acme-contracts.assignToMe',
      transition: undefined,
      operation: 'Acme.AssignToCurrentUser',
      parameters: '{ "notify": true }',
      on: 'bulk',
      label: 'Assign to me',
    });
    const actions = read(tree, `${CONFIG}/actions.json`)['actions'] as Record<string, unknown>[];
    expect(actions.map((action) => action['id'])).toEqual([
      'acme-contracts.approve',
      'acme-contracts.assignToMe',
    ]);
    expect(actions[1]).toEqual({
      id: 'acme-contracts.assignToMe',
      labelKey: 'acme-contracts.action.assignToMe',
      on: ['bulk'],
      operation: 'Acme.AssignToCurrentUser',
      parameters: { notify: true },
    });
  });

  it("offers it on a queue: on its rows' menu and in its selection, as it shows", async () => {
    await generate({ on: 'row', queue: 'open-contracts' });
    await generate({
      id: 'acme-contracts.assignToMe',
      transition: undefined,
      operation: 'Acme.AssignToCurrentUser',
      on: 'row,bulk',
      queue: 'open-contracts',
    });
    // Twice, and it is there once.
    await generate({ on: 'row', queue: 'open-contracts', force: true });
    expect(read(tree, `${CONFIG}/queues/open-contracts.json`)).toMatchObject({
      rowActions: ['acme-contracts.approve', 'acme-contracts.assignToMe'],
      bulkActions: ['acme-contracts.assignToMe'],
    });
  });

  it('written again with fewer places, leaves the queues that offered it there', async () => {
    await generate({ on: 'record,row,bulk', queue: 'open-contracts' });
    expect(read(tree, `${CONFIG}/queues/open-contracts.json`)).toMatchObject({
      rowActions: ['acme-contracts.approve'],
      bulkActions: ['acme-contracts.approve'],
    });
    await generate({ on: 'record,bulk', force: true });
    const queue = read(tree, `${CONFIG}/queues/open-contracts.json`);
    expect(queue['rowActions']).toBeUndefined();
    expect(queue['bulkActions']).toEqual(['acme-contracts.approve']);
    await generate({ on: 'record', force: true });
    expect(read(tree, `${CONFIG}/queues/open-contracts.json`)['bulkActions']).toBeUndefined();
  });

  describe('refuses', () => {
    const refusals: [string, Partial<AppActionSchema>, string][] = [
      ['an id of the platform’s', { id: 'app.approve' }, "which is the platform's"],
      ['an id of core’s', { id: 'core.approve' }, "which is the platform's"],
      ['an id that is not one', { id: 'approve contract' }, '--id "approve contract"'],
      ['neither a transition nor an operation', { transition: undefined }, 'one of --transition'],
      ['both a transition and an operation', { operation: 'Acme.Approve' }, 'one of --transition'],
      ['parameters for a transition', { parameters: '{}' }, 'a transition takes none'],
      [
        'parameters that are not an object',
        { transition: undefined, operation: 'Acme.Approve', parameters: '[1]' },
        '--parameters is a JSON object',
      ],
      ['a place it cannot show', { on: 'toolbar' }, '--on "toolbar"'],
      [
        'a type rule on a bulk action, which has no one record to read',
        { on: 'bulk', type: 'Contract' },
        'a bulk action has none',
      ],
      [
        'a queue for a record-page action',
        { queue: 'open-contracts' },
        'must include "row" or "bulk"',
      ],
      ['a queue the package does not have', { on: 'row', queue: 'closed' }, 'no queue "closed"'],
      ['an icon that is not a Material Symbols name', { icon: 'Check Mark' }, '--icon'],
      [
        'a field as a bulk action’s parameter, which runs on many records',
        {
          transition: undefined,
          operation: 'Acme.Assign',
          on: 'bulk',
          parameters: '{ "who": { "field": "dc:creator" } }',
        },
        'its parameters are literals',
      ],
      [
        'a parameter name the validator refuses',
        { transition: undefined, operation: 'Acme.Assign', parameters: '{ "a-b": 1 }' },
        '"a-b" is not a parameter name',
      ],
    ];
    for (const [what, options, message] of refusals) {
      it(what, async () => {
        await expect(generate(options)).rejects.toThrow(message);
        expect(tree.exists(`${CONFIG}/actions.json`)).toBe(false);
      });
    }

    it('a second action whose label key would be the first one’s', async () => {
      await generate({ id: 'approve', label: 'Approve' });
      await expect(generate({ transition: 'reject', label: 'Reject' })).rejects.toThrow(
        'The action approve has the label key acme-contracts.action.approve already',
      );
    });

    it('an action the file has already, unless forced', async () => {
      await generate();
      await expect(generate()).rejects.toThrow('already has the action acme-contracts.approve');
      await generate({ force: true, transition: 'sign' });
      const actions = read(tree, `${CONFIG}/actions.json`)['actions'] as Record<string, unknown>[];
      expect(actions).toHaveLength(1);
      expect(actions[0]['transition']).toBe('sign');
    });
  });
});
