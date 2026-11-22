import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAYOUT_V2_KEYS } from './layout-v2';
import {
  APP_RULES,
  CORE_RULES,
  PACKAGED_CHECKS,
  PACKAGED_COMPUTATIONS,
  PACKAGED_REGISTRIES,
  PACKAGED_ROW_ACTIONS,
  PACKAGED_WIDGETS,
  PROPOSED_RULES,
  withRegistered,
} from './registries';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const reference = readFileSync(join(ROOT, 'docs', 'extension-reference.md'), 'utf8');
const section = (start: string, end: string): string =>
  reference.slice(reference.indexOf(start), reference.indexOf(end, reference.indexOf(start)));
const documented = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map((match) => match[1]).sort();

type Schema = {
  $defs: Record<
    string,
    { properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }> }
  >;
} & {
  properties: Record<string, unknown>;
};
const schema = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'layout-v2.schema.json'), 'utf8'),
) as Schema;

describe('the registries, held to the extension reference', () => {
  it('know exactly the rules the reference documents, combinators included', () => {
    const rules = documented(
      section('## 4. `rules`', '\n## 5.'),
      /^\| `((?:app|core)\.[A-Za-z.]+)`/gm,
    );
    expect(rules.length).toBeGreaterThan(30);
    expect(Object.keys({ ...CORE_RULES, ...APP_RULES }).sort()).toEqual(rules);
  });

  it('list the three proposed rules apart until the reference documents them', () => {
    for (const id of Object.keys(PROPOSED_RULES)) {
      // Once phase 1 implements and documents one, it moves into APP_RULES and this stops failing.
      expect(reference).not.toContain(`\`${id}\``);
    }
  });

  it('know exactly the row actions the reference documents', () => {
    const actions = documented(
      section('## 10a. `rowActions`', '\n## 11'),
      /^\| `(app\.rowActions\.[A-Za-z]+)`/gm,
    );
    expect([...PACKAGED_ROW_ACTIONS].sort()).toEqual(actions);
  });
});

describe('the JSON Schema, held to the registries and the validator', () => {
  const defs = schema.$defs;

  it('lists the same widgets, computations, checks and row actions', () => {
    expect([...(defs['field'].properties['widget'].enum ?? [])].sort()).toEqual(
      Object.keys(PACKAGED_WIDGETS).sort(),
    );
    expect([...(defs['computation'].properties['type'].enum ?? [])].sort()).toEqual(
      Object.keys(PACKAGED_COMPUTATIONS).sort(),
    );
    expect([...(defs['check'].properties['type'].enum ?? [])].sort()).toEqual(
      Object.keys(PACKAGED_CHECKS).sort(),
    );
    expect([...(defs['related'].properties['rowActions'].items?.enum ?? [])].sort()).toEqual(
      [...PACKAGED_ROW_ACTIONS].sort(),
    );
  });

  it('allows the same keys in each part of a file as the validator does', () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...LAYOUT_V2_KEYS.file].sort());
    for (const [part, keys] of [
      ['tab', LAYOUT_V2_KEYS.tab],
      ['card', LAYOUT_V2_KEYS.card],
      ['field', LAYOUT_V2_KEYS.field],
      ['related', LAYOUT_V2_KEYS.related],
      ['check', LAYOUT_V2_KEYS.check],
    ] as const) {
      expect(Object.keys(defs[part].properties).sort()).toEqual([...keys].sort());
    }
  });
});

describe('the widgets', () => {
  it('check their parameters', () => {
    const { currency, address, 'status-badge': badge, percent } = PACKAGED_WIDGETS;
    expect(currency.parameters['currency']('USD')).toBeNull();
    expect(currency.parameters['currency']({ field: 'claim:currency' })).toBeNull();
    expect(currency.parameters['currency']('dollars')).toMatch(/ISO 4217/);
    expect(address.parameters['parts']({ street: 'street', city: 'city' })).toBeNull();
    expect(address.parameters['parts']({ planet: 'x' })).toMatch(/parts it does not know: planet/);
    expect(badge.parameters['tones']({ active: 'positive' })).toBeNull();
    expect(badge.parameters['tones']({ active: 'green' })).toMatch(/active a tone/);
    expect(percent.parameters['scale'](50)).toMatch(/must be one of 1, 100/);
  });
});

describe('withRegistered', () => {
  it("adds a customer's own rules and row actions, which take any parameters", () => {
    const registries = withRegistered(PACKAGED_REGISTRIES, {
      rules: ['acme.rules.isContract'],
      rowActions: ['acme.rowActions.sign'],
    });
    expect(registries.rules['acme.rules.isContract']).toBeNull();
    expect(registries.rowActions.has('acme.rowActions.sign')).toBe(true);
    expect(PACKAGED_REGISTRIES.rules['acme.rules.isContract']).toBeUndefined();
  });
});
