import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS_V2_KEYS, PLACEMENTS } from './actions';
import { APP_ID, APP_V2_KEYS } from './app';
import { ICON, ID, NAME } from './checker';
import { HOME_V2_KEYS, NAVIGATION_V2_KEYS } from './home';
import { LABEL_KEY, LABELS_V2_KEYS } from './labels';
import { LAYOUT_V2_KEYS } from './layout-v2';
import { QUEUE_V2_KEYS } from './queue';
import { parseRange, parseVersion } from './semver';
import {
  APP_RULES,
  CORE_RULES,
  EXTERNAL_WIDGETS,
  PACKAGED_BULK_ACTIONS,
  PACKAGED_CHECKS,
  PACKAGED_COMPUTATIONS,
  PACKAGED_PAGES,
  PACKAGED_REGISTRIES,
  PACKAGED_ROW_ACTIONS,
  PACKAGED_WIDGETS,
  withRegistered,
  XPATH,
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

  it('know exactly the row actions the reference documents', () => {
    const actions = documented(
      section('## 10a. `rowActions`', '\n## 11'),
      /^\| `(app\.rowActions\.[A-Za-z]+)`/gm,
    );
    expect([...PACKAGED_ROW_ACTIONS].sort()).toEqual(actions);
  });

  it('know exactly the bulk actions the reference documents', () => {
    const actions = documented(
      section('## 5. `bulk-actions`', '\n## 6.'),
      /^\| `(app\.bulkActions\.[A-Za-z]+)`/gm,
    );
    expect(actions.length).toBeGreaterThan(5);
    expect([...PACKAGED_BULK_ACTIONS].sort()).toEqual(actions);
  });

  it("know exactly the pages the reference's menu entries open", () => {
    const pages = documented(
      section('## 3. `navbar`', '\n## 4.'),
      /^\| `(app\.navbar\.[A-Za-z]+)`/gm,
    );
    expect(pages.length).toBeGreaterThan(10);
    // The settings drawer is named in the section's prose, not its table: it opens no page.
    expect(pages).not.toContain('app.navbar.settings');
    expect([...PACKAGED_PAGES].sort()).toEqual(pages);
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
    expect([...(defs['externalField'].properties['widget'].enum ?? [])].sort()).toEqual(
      [...EXTERNAL_WIDGETS].sort(),
    );
    // Every widget a card from another system may use is one the platform registers.
    expect([...EXTERNAL_WIDGETS].filter((id) => !Object.hasOwn(PACKAGED_WIDGETS, id))).toEqual([]);
  });

  it('knows no connector until it is given the ones a server registers', () => {
    expect(PACKAGED_REGISTRIES.connectors).toBeNull();
    const given = withRegistered(PACKAGED_REGISTRIES, {
      connectors: { 'payers.claimPayments': ['paymentStatus'] },
    });
    expect(given.connectors?.['payers.claimPayments']).toEqual(new Set(['paymentStatus']));
    // Adding rules keeps them; adding connectors again replaces one by its id.
    const again = withRegistered(withRegistered(given, { rules: ['acme.rules.x'] }), {
      connectors: { 'payers.claimPayments': ['paidOn'], 'payers.policy': ['policyNumber'] },
    });
    expect(again.connectors).toEqual({
      'payers.claimPayments': new Set(['paidOn']),
      'payers.policy': new Set(['policyNumber']),
    });
  });

  it('allows the same keys in each part of a file as the validator does', () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...LAYOUT_V2_KEYS.file].sort());
    for (const [part, keys] of [
      ['banner', LAYOUT_V2_KEYS.banner],
      ['review', LAYOUT_V2_KEYS.review],
      ['tab', LAYOUT_V2_KEYS.tab],
      ['card', LAYOUT_V2_KEYS.card],
      ['field', LAYOUT_V2_KEYS.field],
      ['related', LAYOUT_V2_KEYS.related],
      ['timeline', LAYOUT_V2_KEYS.timeline],
      ['comments', LAYOUT_V2_KEYS.comments],
      ['external', LAYOUT_V2_KEYS.external],
      ['externalField', LAYOUT_V2_KEYS.externalField],
      ['checklist', LAYOUT_V2_KEYS.checklist],
      ['checklistItem', LAYOUT_V2_KEYS.checklistItem],
      ['check', LAYOUT_V2_KEYS.check],
    ] as const) {
      expect(Object.keys(defs[part].properties).sort()).toEqual([...keys].sort());
    }
  });
});

type AnySchema = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const schemaFile = (name: string): AnySchema =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', `${name}.schema.json`), 'utf8'));
const keysOf = (part: AnySchema): string[] => Object.keys(part['properties']).sort();

describe("the other files' JSON Schemas, held to their validators", () => {
  const [app, queue, actions, labels, module, home, navigation] = [
    'app',
    'queue',
    'actions',
    'labels',
    'module',
    'home',
    'navigation',
  ].map(schemaFile);

  it('allow the same keys in each part of a file as the validators do', () => {
    const pairs: [AnySchema, readonly string[]][] = [
      [app, APP_V2_KEYS.app],
      [app['$defs'].branding, APP_V2_KEYS.branding],
      [app['$defs'].image.oneOf[1], APP_V2_KEYS.image],
      [queue, QUEUE_V2_KEYS.queue],
      [queue['$defs'].facet, QUEUE_V2_KEYS.facet],
      [actions, ACTIONS_V2_KEYS.file],
      [actions['$defs'].action, ACTIONS_V2_KEYS.action],
      [actions['$defs'].message, ACTIONS_V2_KEYS.message],
      [labels, LABELS_V2_KEYS.labels],
      [module, LABELS_V2_KEYS.module],
      [home, HOME_V2_KEYS.home],
      [home['$defs'].homeCard, HOME_V2_KEYS.card],
      [home['$defs'].kpi, HOME_V2_KEYS.kpi],
      [navigation, NAVIGATION_V2_KEYS.navigation],
      [navigation['$defs'].entry, NAVIGATION_V2_KEYS.entry],
    ];
    for (const [part, keys] of pairs) expect(keysOf(part)).toEqual([...keys].sort());
    expect(actions['$defs'].action.properties.on.items.enum).toEqual([...PLACEMENTS]);
  });

  it('ask a name of a home card with a figure, whatever else it has, as the validator does', () => {
    // Each way a card may be valid either requires a name or excludes a figure.
    type Branch = {
      required: string[];
      anyOf?: { required: string[] }[];
      not?: { required: string[] };
    };
    const branches = home['$defs'].homeCard.anyOf as Branch[];
    expect(branches.length).toBe(2);
    for (const branch of branches) {
      const excludesKpi = branch.not?.required.includes('kpi') === true;
      const named = (branch.anyOf ?? [])
        .map((option) => option.required)
        .flat()
        .sort();
      expect([branch.required, excludesKpi || named.join()]).toEqual([
        branch.required,
        excludesKpi || 'label,labelKey',
      ]);
    }
  });

  it("copy the layout schema's definitions they share, unchanged", () => {
    // Each schema stands alone, for editors, so the rules, values and field entries are copied
    // from the layout schema rather than referenced across files. This keeps the copies equal.
    for (const other of [app, queue, actions, home, navigation]) {
      const shared = Object.keys(other['$defs']).filter((name) => name in schema.$defs);
      expect(shared.length).toBeGreaterThan(0);
      for (const name of shared) expect(other['$defs'][name]).toEqual(schema.$defs[name]);
    }
  });

  it('read versions and ranges as the validator does, so an editor marks what it refuses', () => {
    const version = new RegExp(app['properties'].packageVersion.pattern);
    const range = new RegExp(app['properties'].platform.pattern);
    for (const text of [
      '1.0.0',
      '1.0.0+build.5',
      '1.0.0-0',
      '1.0.0-0a',
      '1.0.0-rc.1',
      '1.0.0-01',
      '01.0.0',
      '1.0',
      'v1.0.0',
    ])
      expect([text, version.test(text)]).toEqual([text, parseVersion(text) !== null]);
    for (const text of [
      '^1.2.0',
      '~1.2.0',
      '>=1.0.0 <2.0.0',
      '>=1.0.0+b <2.0.0',
      '1.2.0',
      '>=1.0.0-01',
      '>= 1.0.0',
      '1.x',
      '',
    ])
      expect([text, range.test(text)]).toEqual([text, parseRange(text) !== null]);
  });

  it("write the validators' patterns", () => {
    const layout = schema as AnySchema;
    expect(layout['$defs'].id.pattern).toBe(ID.source);
    expect(layout['$defs'].xpath.pattern).toBe(XPATH.source);
    expect(layout['$defs'].related.properties.pageProvider.pattern).toBe(NAME.source);
    expect(layout['$defs'].timeline.properties.events.items.pattern).toBe(NAME.source);
    expect(app['$defs'].appId.pattern).toBe(APP_ID.source);
    expect(queue['properties'].pageProvider.pattern).toBe(NAME.source);
    expect(queue['$defs'].facet.properties.aggregate.pattern).toBe(NAME.source);
    expect(actions['$defs'].action.properties.transition.pattern).toBe(NAME.source);
    expect(actions['$defs'].action.properties.operation.pattern).toBe(NAME.source);
    expect(labels['properties'].labels.propertyNames.pattern).toBe(LABEL_KEY.source);
    expect(home['$defs'].kpi.properties.pageProvider.pattern).toBe(NAME.source);
    expect(home['$defs'].kpi.properties.aggregate.pattern).toBe(NAME.source);
    expect(navigation['$defs'].entry.properties.icon.pattern).toBe(ICON.source);
    expect(actions['$defs'].action.properties.icon.pattern).toBe(ICON.source);
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
