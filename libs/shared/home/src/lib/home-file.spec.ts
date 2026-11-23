import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CORE_RULE_EVALUATORS,
  DOCUMENT_RULE_EVALUATORS,
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionRuleRegistry,
} from '@nuxeo/satori-platform/extensions';

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
        visibleWhen: { type: 'app.rules.inGroup', parameters: ['claims-supervisors'] },
      },
      {
        id: 'unassigned-queue',
        label: null,
        labelKey: null,
        kpi: null,
        queue: 'unassigned-claims',
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
    expect(ids(result)).toEqual(['all', 'contracts', 'by-nature', 'by-author']);
  });

  it('refuses the whole file on a structure finding, and says each', () => {
    expect(read([kpi('a'), { id: 'b' }])).toEqual({
      refused: ['cards[1]: a card has a "kpi", a "queue", or both [structure]'],
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
