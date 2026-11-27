import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CORE_RULE_EVALUATORS,
  DOCUMENT_RULE_EVALUATORS,
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionRuleRegistry,
} from '@nuxeo/satori-platform/extensions';

import { MAX_NESTING } from '@agentic-ui/shared/app-definition';

import { MAX_RULE_LEVELS, readHome, refusedRule, type ReadHome } from './home-file';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const proposal = readFileSync(join(ROOT, 'docs', 'business-apps', 'app-definition-v2.md'), 'utf8');
/** The proposal's `home.json`, as the app is to read it. */
const example = JSON.parse(/```json home\.json\n([\s\S]*?)```/.exec(proposal)?.[1] ?? 'null');

/** The rules the app registers: the composites and the document rules, `app.rules.inGroup` among them. */
const REGISTERED = [...Object.keys(CORE_RULE_EVALUATORS), ...Object.keys(DOCUMENT_RULE_EVALUATORS)];

const kpi = (id: string, keys: Record<string, unknown> = {}) => ({
  id,
  label: id,
  kpi: { pageProvider: 'payers_open_claims' },
  ...keys,
});
const read = (cards: unknown[], keys: Record<string, unknown> = {}): ReadHome =>
  readHome({ version: 2, cards, ...keys }, REGISTERED);
const ids = (result: ReadHome): string[] =>
  'home' in result ? result.home.cards.map((card) => card.id) : ['refused'];

describe('reading home.json', () => {
  it("reads the proposal's example whole, each card as written", () => {
    const result = readHome(example, REGISTERED);
    if (!('home' in result)) throw new Error(`refused: ${result.refused.join('; ')}`);
    expect(result.problems).toEqual([]);
    expect(result.home.label).toBe('Claims');
    expect(result.home.cards).toEqual([
      {
        id: 'unassigned',
        label: 'Unassigned claims',
        labelKey: null,
        kpi: {
          pageProvider: 'payers_unassigned_claims',
          parameters: [],
          aggregate: null,
          bucket: null,
        },
        queue: 'unassigned-claims',
        tasks: null,
        recent: null,
        visibleWhen: { type: 'app.rules.inGroup', parameters: ['claims-adjusters'] },
      },
      {
        id: 'unassigned-by-type',
        label: 'Unassigned, by claim type',
        labelKey: null,
        kpi: {
          pageProvider: 'payers_unassigned_claims',
          parameters: [],
          aggregate: 'claim_type_agg',
          bucket: null,
        },
        queue: null,
        tasks: null,
        recent: null,
        visibleWhen: { type: 'app.rules.inGroup', parameters: ['claims-adjusters'] },
      },
      {
        id: 'pending',
        label: 'Pending determination',
        labelKey: null,
        kpi: {
          pageProvider: 'payers_open_claims',
          parameters: [],
          aggregate: 'claim_state_agg',
          bucket: 'pending',
        },
        queue: null,
        tasks: null,
        recent: null,
        visibleWhen: { type: 'app.rules.inGroup', parameters: ['claims-supervisors'] },
      },
      {
        id: 'unassigned-queue',
        label: null,
        labelKey: null,
        kpi: null,
        queue: 'unassigned-claims',
        tasks: null,
        recent: null,
        visibleWhen: { type: 'app.rules.inGroup', parameters: ['claims-supervisors'] },
      },
    ]);
  });

  it("reads the sample the dev server serves, on the platform's own page providers, whole", () => {
    const sample = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', 'samples', 'documents', 'home.json'),
        'utf8',
      ),
    );
    const result = readHome(sample, REGISTERED);
    expect('home' in result && result.problems).toEqual([]);
    expect(ids(result)).toEqual([
      'all',
      'contracts',
      'by-nature',
      'by-author',
      'my-tasks',
      'recent-notes',
    ]);
  });

  it('reads a list of tasks and a list of recent records, each with its limit or the default', () => {
    const result = read([
      { id: 'mine', tasks: {} },
      { id: 'reviews', label: 'Reviews', tasks: { workflow: 'SerialDocumentReview', limit: 3 } },
      { id: 'recent', recent: {} },
      { id: 'contracts', labelKey: 'x.recent', recent: { types: ['Contract'], limit: 20 } },
    ]);
    if (!('home' in result)) throw new Error(`refused: ${result.refused.join('; ')}`);
    expect(result.problems).toEqual([]);
    expect(
      result.home.cards.map(({ id, label, labelKey, kpi, queue, tasks, recent }) => ({
        id,
        label,
        labelKey,
        kpi,
        queue,
        tasks,
        recent,
      })),
    ).toEqual([
      {
        id: 'mine',
        label: null,
        labelKey: null,
        kpi: null,
        queue: null,
        tasks: { workflow: null, limit: 5 },
        recent: null,
      },
      {
        id: 'reviews',
        label: 'Reviews',
        labelKey: null,
        kpi: null,
        queue: null,
        tasks: { workflow: 'SerialDocumentReview', limit: 3 },
        recent: null,
      },
      {
        id: 'recent',
        label: null,
        labelKey: null,
        kpi: null,
        queue: null,
        tasks: null,
        recent: { types: [], limit: 5 },
      },
      {
        id: 'contracts',
        label: null,
        labelKey: 'x.recent',
        kpi: null,
        queue: null,
        tasks: null,
        recent: { types: ['Contract'], limit: 20 },
      },
    ]);
  });

  it('leaves out a list an unknown finding names, and keeps a sound one', () => {
    const result = read([
      { id: 'typo', recent: { type: 'Contract' } },
      { id: 'mine', tasks: {} },
      { id: 'later', tasks: { assignee: 'ada' } },
    ]);
    expect(ids(result)).toEqual(['mine']);
    expect('home' in result && result.problems).toEqual([
      'cards[0].recent.type: "type" is not a key version 2 has [unknown]; cards[0] left out',
      'cards[2].tasks.assignee: "assignee" is not a key version 2 has [unknown]; cards[2] left out',
    ]);
  });

  it('refuses the whole file for a list of the wrong shape, as for any structure finding', () => {
    expect(read([{ id: 'mine', tasks: { limit: 50 } }, kpi('a')])).toEqual({
      refused: [
        'cards[0].tasks.limit: limit is how many the card shows: a whole number from 1 to 20 [structure]',
      ],
    });
    expect(read([{ id: 'both', tasks: {}, recent: {} }])).toEqual({
      refused: [
        'cards[0]: a card shows one thing, and this one has "tasks" and "recent" [structure]',
      ],
    });
  });

  it('refuses the whole file on a structure finding, and says each', () => {
    expect(read([kpi('a'), { id: 'b' }])).toEqual({
      refused: [
        'cards[1]: a card has a "kpi", a "queue", or both; or a "tasks" or a "recent" [structure]',
      ],
    });
    expect(readHome({ version: 1, cards: [] }, REGISTERED)).toEqual({
      refused: ['version: version must be 2, not 1 [structure]'],
    });
    expect(readHome(null, REGISTERED)).toEqual({
      refused: ['the file: a home file is a JSON object [structure]'],
    });
  });

  it('leaves out the card an unknown or a parameter finding names, and keeps the rest', () => {
    const result = read([
      kpi('a', { visibleWhen: 'acme.rules.isAdjuster' }),
      kpi('b'),
      kpi('c', { kpi: { pageProvider: 'p', depth: 2 } }),
      kpi('d', {
        visibleWhen: { type: 'app.rules.fieldIn', parameters: [{ field: 'claim:state' }, 'open'] },
      }),
      kpi('e', { visibleWhen: { type: 'app.rules.inGroup', parameters: [] } }),
    ]);
    expect(ids(result)).toEqual(['b']);
    expect('home' in result && result.problems).toEqual([
      'cards[0].visibleWhen: the rule "acme.rules.isAdjuster" is not registered [unknown]; cards[0] left out',
      'cards[2].kpi.depth: "depth" is not a key version 2 has [unknown]; cards[2] left out',
      'cards[3].visibleWhen.parameters[0]: no record is open here, so a rule is given literals, not a property [parameter]; cards[3] left out',
      'cards[4].visibleWhen.parameters: the rule "app.rules.inGroup" takes at least 1 parameter, not 0 [parameter]; cards[4] left out',
    ]);
  });

  it("ignores a key of the file's own, and says so", () => {
    const result = read([kpi('a')], { columns: 3 });
    expect(ids(result)).toEqual(['a']);
    expect('home' in result && result.problems).toEqual([
      'columns: "columns" is not a key version 2 has [unknown]; ignored',
    ]);
  });

  it("knows a customer's own rule this build registers, though the packaged list lacks it", () => {
    const result = readHome(
      { version: 2, cards: [kpi('a', { visibleWhen: 'acme.rules.isAdjuster' })] },
      [...REGISTERED, 'acme.rules.isAdjuster'],
    );
    expect(ids(result)).toEqual(['a']);
  });

  it('leaves out a card whose rule this build does not register, wherever it is nested', () => {
    // The validator knows `app.rules.canWrite`; the registry of a build without it answers `true`.
    const without = REGISTERED.filter((id) => id !== 'app.rules.canWrite');
    const result = readHome(
      {
        version: 2,
        cards: [
          kpi('a', { visibleWhen: { type: 'core.not', parameters: ['app.rules.canWrite'] } }),
          kpi('b', { visibleWhen: { type: 'app.rules.inGroup', parameters: ['members'] } }),
        ],
      },
      without,
    );
    expect(ids(result)).toEqual(['b']);
    expect('home' in result && result.problems).toEqual([
      'cards[0].visibleWhen names the rule "app.rules.canWrite", which this build does not register; cards[0] left out',
    ]);
  });
});

describe("a customer's own composite", () => {
  it('leaves out a card whose rule nests an unregistered rule in it, as the core composites do', () => {
    const registered = [...REGISTERED, 'acme.rules.anyOf'];
    const card = (nested: unknown) => ({
      version: 2,
      cards: [kpi('a', { visibleWhen: { type: 'acme.rules.anyOf', parameters: [nested] } })],
    });
    expect(
      ids(readHome(card({ type: 'app.rules.inGroup', parameters: ['members'] }), registered)),
    ).toEqual(['a']);
    // The validator does not read a customer rule's parameters as rules; the build's registry does.
    const result = readHome(card({ type: 'acme.rules.unknown' }), registered);
    expect(ids(result)).toEqual([]);
    expect('home' in result && result.problems).toEqual([
      'cards[0].visibleWhen names the rule "acme.rules.unknown", which this build does not register; cards[0] left out',
    ]);
    // A text among a rule's parameters is a value, such as a group, not a rule's id.
    expect(ids(readHome(card('claims-adjusters'), registered))).toEqual(['a']);
    // However deep the customer's own parameters hold it.
    expect(ids(readHome(card({ any: [[{ type: 'acme.rules.unknown' }]] }), registered))).toEqual(
      [],
    );
  });
});

describe('parameters nested deeper than the validator reads', () => {
  it('are refused by refusedRule on its own, rather than overflowing the stack', () => {
    let deep: unknown = { type: 'acme.rules.unknown' };
    for (let index = 0; index < 50_000; index++) deep = { a: deep };
    expect(refusedRule({ type: 'acme.rules.anyOf', parameters: [deep] }, () => true)).toBe(
      `nests its parameters more than ${MAX_NESTING} levels deep, deeper than this build reads`,
    );
  });
});

describe('a rule nested deeper than the registry answers', () => {
  const every = (levels: number, innermost: string): unknown =>
    levels <= 1 ? innermost : { type: 'core.every', parameters: [every(levels - 1, innermost)] };

  it('is answered as written at the limit, and not one level past it, as the registry does', () => {
    const registry = new ExtensionRuleRegistry();
    // At the limit the registry still answers `core.false` as written.
    expect(
      registry.evaluate(
        every(MAX_RULE_LEVELS, 'core.false') as never,
        EMPTY_EXTENSION_RULE_CONTEXT,
      ),
    ).toBe(false);
    // One level more, and it answers `true`: a card gated on it would show to everyone.
    expect(
      registry.evaluate(
        every(MAX_RULE_LEVELS + 1, 'core.false') as never,
        EMPTY_EXTENSION_RULE_CONTEXT,
      ),
    ).toBe(true);
    const known = (id: string): boolean => REGISTERED.includes(id);
    expect(refusedRule(every(MAX_RULE_LEVELS, 'core.false'), known)).toBeNull();
    expect(refusedRule(every(MAX_RULE_LEVELS + 1, 'core.false'), known)).toBe(
      `nests its rule more than ${MAX_RULE_LEVELS} levels deep, deeper than this build answers`,
    );
    expect(
      ids(read([kpi('deep', { visibleWhen: every(MAX_RULE_LEVELS + 1, 'core.false') })])),
    ).toEqual([]);
  });
});
