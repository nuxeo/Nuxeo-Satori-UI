import { loadCatalogue } from './catalogue';
import { convert, type Conversion } from './convert';
import { runCheck, runHarness, type HarnessInput } from './harness';
import { inventory, type SlotContribution } from './inventory';
import { MUTATIONS, MutationError } from './mutations';
import { slotRegistry } from './slot-registry';
import { readStudioPackage } from './studio-package';
import { m2CorpusFiles } from './testing/m2-corpus';
import { syntheticBundleFiles, syntheticPackage } from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const SLOTS = `${UI}/nuxeo-Acme-Claims-slots-bundle.html`;
const catalogue = loadCatalogue();

function prepare(bundle: Record<string, string> = {}): HarnessInput {
  const pkg = readStudioPackage(syntheticPackage({ bundle: { ...m2CorpusFiles(), ...bundle } }));
  const read = inventory(pkg);
  const allowList = new Set(['Claim.Approve']);
  return {
    pkg,
    inventory: read,
    catalogue,
    allowList,
    platformVersion: '0.2.0',
    conversion: convert(pkg, read, catalogue, { allowList, platformVersion: '0.2.0' }),
  };
}

/** What one check finds: that check alone, as the harness runs it, not the ten. */
const run = (input: HarnessInput, number: number) => runCheck(input, number);

const entry = (conversion: Conversion, index: number) =>
  conversion.report.constructs.find(
    (candidate) => candidate.id === `slot-contribution:${SLOTS}#${index}`,
  );

const actions = (conversion: Conversion) =>
  (
    (
      conversion.app['actions.json'] as {
        actions: { id: string; order?: number; parameters?: unknown }[];
      }
    )?.actions ?? []
  ).map((action) => [action.id, action.order ?? null, action.parameters ?? null]);

describe("actions and menu entries, as Web UI's slots register them", () => {
  const input = prepare();

  it('writes only the buttons Web UI shows, each as its slot keeps it', () => {
    // In Web UI's order: by order, equals in their places.
    expect(actions(input.conversion)).toEqual([
      // At the order a later contribution of its name, with no template, gives it.
      ['acme-claims.settleClaim', 5, { comment: 'Settled' }],
      ['acme-claims.approveClaim', 10, { comment: 'Approved in Web UI' }],
      // The later of two of a name, at the same priority.
      ['acme-claims.reopenClaim', 41, { comment: 'Reopened' }],
      // The earlier of two of a name, at a higher priority.
      ['acme-claims.escalateClaim', 50, { comment: 'Escalated' }],
    ]);
  });

  it('reports each contribution it leaves out, and says why', () => {
    const note = (index: number) => entry(input.conversion, index);
    expect(note(1)).toMatchObject({
      outcome: 'reported',
      note: 'It is disabled, so Web UI shows nothing of it: it is left out',
    });
    expect(note(2)?.note).toBe(
      "A later contribution of the same name, reopenClaim, replaces it, as Web UI's slots do: it is left out",
    );
    expect(note(3)).toMatchObject({
      outcome: 'converted',
      to: 'actions.json acme-claims.reopenClaim',
    });
    expect(note(4)).toMatchObject({
      outcome: 'converted',
      to: 'actions.json acme-claims.escalateClaim',
    });
    expect(note(5)?.note).toContain('has a higher priority, so Web UI keeps that one');
    expect(note(7)?.note).toContain(
      'only changes the earlier contribution of the same name, settleClaim',
    );
    expect(note(8)?.note).toContain(
      "a contribution of Web UI's own named documentLock, if there is one, which it hides",
    );
    expect(note(9)).toMatchObject({
      outcome: 'reported',
      note: 'It is disabled, so Web UI shows nothing of it: it is left out',
    });
    expect(note(10)?.note).toContain('Its menu entry, oldSearch, is not shown in Web UI');
    expect(
      (input.conversion.app['navigation.json'] as { entries: { id: string }[] }).entries.map(
        (item) => item.id,
      ),
    ).toEqual(['claimssearch']);
  });

  it('keeps slots apart, never merges contributions with no name, and lets a disabled replacement hide', () => {
    const contribution = (
      name: string,
      slot: string,
      extra: Partial<SlotContribution> = {},
    ): SlotContribution => ({
      path: 'x.html',
      name,
      slot,
      order: null,
      elements: [],
      operations: [],
      parts: [],
      conditions: [],
      uses: [],
      disabled: false,
      priority: 0,
      hasTemplate: true,
      orderValue: extra.order ?? null,
      pageNames: [],
      listing: null,
      ...extra,
    });
    const a = contribution('a', 'DOCUMENT_ACTIONS');
    const b = contribution('a', 'RESULTS_SELECTION_ACTIONS');
    const unnamed = [contribution('', 'DOCUMENT_ACTIONS'), contribution('', 'DOCUMENT_ACTIONS')];
    const hidden = contribution('h', 'DOCUMENT_ACTIONS');
    const hider = contribution('h', 'DOCUMENT_ACTIONS', { disabled: true, order: 3 });
    const registry = slotRegistry({ slotContributions: [a, b, ...unnamed, hidden, hider] });
    expect([a, b, ...unnamed].map((item) => registry.kept.has(item))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(registry.kept.has(hidden)).toBe(false);
    expect(registry.dropped.get(hider)?.note).toContain('is disabled');
    // A change with no template and no order of its own gives the earlier one Web UI's default, 0.
    const reordered = contribution('r', 'DOCUMENT_ACTIONS', { order: 9 });
    const change = contribution('r', 'DOCUMENT_ACTIONS', { hasTemplate: false });
    expect(
      slotRegistry({ slotContributions: [reordered, change] }).kept.get(reordered)?.order,
    ).toBe(0);
  });

  describe("holds each action and menu entry to Web UI's slot in checks 6 and 7", () => {
    it('passes the conversion, as the ten checks run it', () => {
      expect(runHarness(input).checks.map((check) => [check.number, check.status])).toEqual([
        [1, 'pass'],
        [2, 'pass'],
        [3, 'partial'],
        [4, 'pass'],
        [5, 'partial'],
        [6, 'partial'],
        [7, 'partial'],
        [8, 'pass'],
        [9, 'pass'],
        [10, 'pass'],
      ]);
    });

    // One case a control: each runs the one check that catches it, not the ten.
    it.each<[string, readonly string[]]>([
      [
        'revive-disabled-action',
        ['actions.json: "acme-claims.archiveClaim" runs something no button of the package runs'],
      ],
      [
        'keep-replaced-action',
        [
          'actions.json: acme-claims.reopenClaim sends {"comment":"Reopened first"}, where Web UI sends {"comment":"Reopened"}',
        ],
      ],
      [
        'keep-outranked-action',
        [
          'actions.json: acme-claims.escalateClaim sends {"comment":"Escalated later"}, where Web UI sends {"comment":"Escalated"}',
        ],
      ],
      [
        'revive-disabled-menu-entry',
        ['navigation.json: "oldsearch" opens a list no menu entry of the package opens'],
      ],
      [
        'change-action-order',
        [
          `actions.json: acme-claims.settleClaim is at order 1005, where Web UI's slot places "settleClaim" at 5`,
        ],
      ],
    ])('names what %s broke', (name, expected) => {
      const mutation = MUTATIONS.find((candidate) => candidate.name === name);
      if (!mutation) throw new Error(name);
      expect(
        run(
          { ...input, conversion: mutation.apply(input.conversion, input).conversion },
          mutation.caughtBy,
        )?.findings,
      ).toEqual(expected);
    });
  });

  it("fails check 6 on a menu entry's order, and a control that reads the package refuses without it", () => {
    const moved = {
      ...input,
      conversion: {
        ...input.conversion,
        app: {
          ...input.conversion.app,
          'navigation.json': {
            version: 2,
            entries: [{ id: 'claimssearch', label: 'Claims', order: 7, queue: 'claims' }],
          },
        },
      },
    };
    expect(run(moved, 6)?.findings).toContain(
      `navigation.json: claimssearch is at order 7, where Web UI's slot places "claimsSearch" at 1`,
    );
    const mutation = MUTATIONS.find((candidate) => candidate.name === 'keep-replaced-action');
    expect(() => mutation?.apply(input.conversion)).toThrow(MutationError);
  });

  it("opens the page Web UI's slot keeps, at the order its slot gives the entry", () => {
    const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;
    const changes = (extra: string) => prepare({ [SLOTS]: `${extra}` }).conversion;
    // A later contribution with no template moves the entry, and one that hides its page leaves
    // the entry nothing to open.
    const moved = changes(
      '<nuxeo-slot-content name="claimsSearch" slot="DRAWER_ITEMS" order="7"></nuxeo-slot-content>',
    );
    expect(moved.app['navigation.json']).toMatchObject({
      entries: [{ id: 'claimssearch', order: 7 }],
    });
    const hidden = changes(
      '<nuxeo-slot-content name="claimsSearch" slot="DRAWER_PAGES" disabled></nuxeo-slot-content>',
    );
    expect(hidden.app['navigation.json']).toBeUndefined();
    expect(
      hidden.report.constructs.find(
        (construct) => construct.id === `slot-contribution:${bundle}#3`,
      ),
    ).toMatchObject({ outcome: 'pending', note: expect.stringContaining('opens no queue') });
  });
});

describe("the review's cases of Web UI's slot registration", () => {
  const button = (name: string, comment: string, extra = '') =>
    `<nuxeo-slot-content name="${name}" slot="DOCUMENT_ACTIONS"${extra}><template><nuxeo-operation-button label="${name}" operation="Claim.Approve" input="[[document]]" params='{"comment": "${comment}"}'></nuxeo-operation-button></template></nuxeo-slot-content>`;
  const only = (markup: string, more: Record<string, string> = {}) =>
    prepare({ [SLOTS]: markup, ...more });
  const ids = (input: HarnessInput) =>
    actions(input.conversion)
      .map(([id]) => id)
      .filter((id) => id !== 'acme-claims.approveClaim');

  it('registers a contribution with no template too, so its priority outranks a later one', () => {
    const outranked = only(
      `<nuxeo-slot-content name="lockIt" slot="DOCUMENT_ACTIONS" priority="5"></nuxeo-slot-content>${button('lockIt', 'x')}`,
    );
    expect(ids(outranked)).toEqual([]);
    expect(entry(outranked.conversion, 2)?.note).toContain('has a higher priority');
    // It shows nothing itself: with no template, it changes a contribution of Web UI's own.
    expect(entry(outranked.conversion, 1)?.note).toContain(
      "a contribution of Web UI's own named lockIt",
    );
  });

  it('reads the custom bundle, which may disable a button of the bundle', () => {
    const custom = `${UI}/nuxeo-Acme-Claims-custom-bundle.html`;
    const hidden = only('', {
      [custom]:
        '<nuxeo-slot-content name="approveClaim" slot="DOCUMENT_ACTIONS" priority="1" disabled></nuxeo-slot-content>',
    });
    expect(actions(hidden.conversion).map(([id]) => id)).not.toContain('acme-claims.approveClaim');
    expect(
      hidden.conversion.report.constructs.find(
        (construct) => construct.id === `slot-contribution:${UI}/nuxeo-Acme-Claims-bundle.html#1`,
      ),
    ).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('has a higher priority'),
    });
    expect(run(hidden, 1)?.status).toBe('pass');
  });

  it('registers a contribution into each slot it names, and follows a change that moves it', () => {
    const disabled = only(
      `${button('lockIt', 'x')}<nuxeo-slot-content name="lockIt" slot="DOCUMENT_ACTIONS,RESULTS_SELECTION_ACTIONS" disabled></nuxeo-slot-content>`,
    );
    expect(ids(disabled)).toEqual([]);
    // Moved and disabled: Web UI shows it nowhere.
    expect(entry(disabled.conversion, 1)?.note).toContain('is disabled');
    // Moved, though not disabled: the converter does not follow it to the other slot.
    const moved = only(
      `${button('lockIt', 'x')}<nuxeo-slot-content name="lockIt" slot="DOCUMENT_ACTIONS,RESULTS_SELECTION_ACTIONS" order="3"></nuxeo-slot-content>`,
    );
    expect(ids(moved)).toEqual([]);
    expect(entry(moved.conversion, 1)?.note).toContain('moves it to the slots');
    const replaced = only(
      `${button('lockIt', 'first')}${button('lockIt', 'second').replace('slot="DOCUMENT_ACTIONS"', 'slot="DOCUMENT_ACTIONS,RESULTS_SELECTION_ACTIONS"')}`,
    );
    expect(ids(replaced)).toEqual([]);
    expect(entry(replaced.conversion, 1)?.note).toContain('replaces it');
    expect(entry(replaced.conversion, 2)?.note).toBe('Its slot is not in the catalogue');
  });

  it("places equals as Web UI's slot does, a replacement in the place of what it replaces", () => {
    const ties = only(button('a', 'first') + button('b', 'b') + button('a', 'second'));
    expect(ids(ties)).toEqual(['acme-claims.a', 'acme-claims.b']);
    expect(actions(ties.conversion).find(([id]) => id === 'acme-claims.a')?.[2]).toEqual({
      comment: 'second',
    });
  });

  it("reads priority and order as Polymer's numbers, and writes Web UI's default order", () => {
    const fractional = only(
      button('a', 'first', ' priority="2.5"') + button('a', 'second', ' priority="1"'),
    );
    expect(actions(fractional.conversion).find(([id]) => id === 'acme-claims.a')).toEqual([
      'acme-claims.a',
      0,
      { comment: 'first' },
    ]);
    expect(run(fractional, 6)?.findings).toEqual([]);
  });

  it("holds an action's label to the button Web UI keeps", () => {
    const relabelled = {
      ...input0(),
      conversion: (() => {
        const base = input0().conversion;
        const file = JSON.parse(JSON.stringify(base.app['actions.json'])) as {
          actions: Record<string, unknown>[];
        };
        file.actions[0]['label'] = 'Something else';
        return { ...base, app: { ...base.app, 'actions.json': file } };
      })(),
    };
    expect(run(relabelled, 6)?.findings).toEqual([
      'actions.json: acme-claims.settleClaim: the app shows "Something else", where Web UI shows "Settle"',
    ]);
  });

  it('holds a menu entry to the one Web UI keeps, under its rule or none', () => {
    const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;
    const unconditional = prepare({
      [SLOTS]:
        '<nuxeo-slot-content name="claimsSearch" slot="DRAWER_ITEMS" order="1"><template><nuxeo-menu-icon name="claimssearch" label="Claims" icon="icons:search"></nuxeo-menu-icon></template></nuxeo-slot-content>',
      [bundle]: m1Bundle()
        .replace(
          '<template><nuxeo-menu-icon name="claimssearch"',
          '<template><nuxeo-filter user="[[user]]" group="adjusters"><template><nuxeo-menu-icon name="claimssearch"',
        )
        .replace(
          'icon="icons:search"></nuxeo-menu-icon></template>',
          'icon="icons:search"></nuxeo-menu-icon></template></nuxeo-filter></template>',
        ),
    });
    // The later one, in no condition, replaces the guarded one: its entry carries no rule.
    expect(unconditional.conversion.app['navigation.json']).toMatchObject({
      entries: [{ id: 'claimssearch' }],
    });
    expect(
      (unconditional.conversion.app['navigation.json'] as { entries: Record<string, unknown>[] })
        .entries[0],
    ).not.toHaveProperty('visibleWhen');
    expect(run(unconditional, 5)?.findings).toEqual([]);
    const page = prepare({
      [SLOTS]:
        '<nuxeo-slot-content name="claimsSearch" slot="DRAWER_PAGES"><template><nuxeo-search-form provider="claims" search-name="claims" name="claimssearch"></nuxeo-search-form></template></nuxeo-slot-content>',
      [bundle]: m1Bundle().replace(
        '<template><nuxeo-search-form provider="claims" search-name="claims" name="claimssearch"></nuxeo-search-form></template>',
        '<template><nuxeo-filter user="[[user]]" group="adjusters"><template><nuxeo-search-form provider="claims" search-name="claims" name="claimssearch"></nuxeo-search-form></template></nuxeo-filter></template>',
      ),
    });
    expect(run(page, 5)?.findings).toEqual([]);
  });
});

describe("the second review's cases", () => {
  const button = (name: string, comment: string, extra = '', label = name) =>
    `<nuxeo-slot-content name="${name}" slot="DOCUMENT_ACTIONS"${extra}><template><nuxeo-operation-button label="${label}" operation="Claim.Approve" input="[[document]]" params='{"comment": "${comment}"}'></nuxeo-operation-button></template></nuxeo-slot-content>`;
  const only = (markup: string, more: Record<string, string> = {}) =>
    prepare({ [SLOTS]: markup, ...more });
  const ids = (input: HarnessInput) =>
    actions(input.conversion)
      .map(([id]) => id)
      .filter((id) => id !== 'acme-claims.approveClaim');

  it('sorts the slot after each registration, so a replacement moves with its new order', () => {
    const resorted = only(
      button('a', 'first', ' order="10"') +
        button('b', 'b', ' order="5"') +
        button('a', 'second', ' order="5"'),
    );
    expect(ids(resorted)).toEqual(['acme-claims.b', 'acme-claims.a']);
  });

  it('reads a priority as Web UI compares it, a NaN outranking nothing and kept by nothing', () => {
    const nan = only(button('a', 'first', ' priority="abc"') + button('a', 'second'));
    expect(actions(nan.conversion).find(([id]) => id === 'acme-claims.a')?.[2]).toEqual({
      comment: 'first',
    });
  });

  it('writes no order an app definition cannot hold, and reports it', () => {
    const half = only(button('a', 'x', ' order="2.5"'));
    expect(actions(half.conversion).find(([id]) => id === 'acme-claims.a')?.[1]).toBeNull();
    expect(entry(half.conversion, 1)).toMatchObject({
      outcome: 'reported',
      to: 'actions.json acme-claims.a',
      note: expect.stringContaining('Its order, 2.5, is no whole number'),
    });
    expect(run(half, 10)?.status).toBe('pass');
  });

  it("translates a button's label as Web UI does, and holds the action to it", () => {
    const keyed = only(button('a', 'x', '', 'label.claim.amount'));
    expect(
      (keyed.conversion.app['actions.json'] as { actions: Record<string, unknown>[] }).actions.find(
        (action) => action['id'] === 'acme-claims.a',
      ),
    ).toMatchObject({ labelKey: 'label.claim.amount' });
    expect(run(keyed, 6)?.findings).toEqual([]);
    const literal = {
      ...keyed,
      conversion: {
        ...keyed.conversion,
        app: {
          ...keyed.conversion.app,
          'actions.json': {
            version: 2,
            actions: (
              keyed.conversion.app['actions.json'] as { actions: Record<string, unknown>[] }
            ).actions.map((action) =>
              action['id'] === 'acme-claims.a'
                ? { ...action, labelKey: undefined, label: 'label.claim.amount' }
                : action,
            ),
          },
        },
      },
    };
    expect(run(literal, 6)?.findings).toEqual([
      'actions.json: acme-claims.a: the app shows "label.claim.amount", where Web UI shows "Amount"',
    ]);
  });

  it('holds equals to the places Web UI gives them', () => {
    const ties = only(button('a', 'a') + button('b', 'b'));
    const swapped = {
      ...ties,
      conversion: {
        ...ties.conversion,
        app: {
          ...ties.conversion.app,
          'actions.json': {
            version: 2,
            actions: [
              ...(ties.conversion.app['actions.json'] as { actions: unknown[] }).actions,
            ].reverse(),
          },
        },
      },
    };
    expect(run(ties, 6)?.findings).toEqual([]);
    expect(run(swapped, 6)?.findings).toEqual([
      `actions.json: acme-claims.b comes before acme-claims.a, where Web UI's slot shows "a" first, both at order 0`,
    ]);
  });

  it("translates a menu entry's label, and reports an order it cannot write", () => {
    const menu = only(
      '<nuxeo-slot-content name="claimsSearch" slot="DRAWER_ITEMS" order="1.5"><template><nuxeo-menu-icon name="claimssearch" label="label.search.claims" icon="icons:search"></nuxeo-menu-icon></template></nuxeo-slot-content>',
    );
    const [written] = (
      menu.conversion.app['navigation.json'] as { entries: Record<string, unknown>[] }
    ).entries;
    expect(written).toMatchObject({ id: 'claimssearch', labelKey: 'label.search.claims' });
    expect(written).not.toHaveProperty('order');
    expect(entry(menu.conversion, 1)).toMatchObject({
      outcome: 'reported',
      to: 'navigation.json claimssearch',
      note: expect.stringContaining('Its order, 1.5, is no whole number'),
    });
    expect(run(menu, 6)?.findings).toEqual([]);
  });

  it('writes no tab of a contribution to several slots, which it reports', () => {
    const tabs = `${UI}/nuxeo-Acme-Claims-tabs-bundle.html`;
    const both = prepare({
      [tabs]: `<nuxeo-slot-content name="rcItem" slot="DOCUMENT_VIEWS_ITEMS,DOCUMENT_ACTIONS"><template><nuxeo-filter document="[[document]]" type="Policy"><template><nuxeo-page-item name="rc" label="rc"></nuxeo-page-item></template></nuxeo-filter></template></nuxeo-slot-content>
<nuxeo-slot-content name="rcPage" slot="DOCUMENT_VIEWS_PAGES"><template><nuxeo-filter document="[[document]]" type="Policy"><template><acme-policy-terms name="rc" document="[[document]]"></acme-policy-terms></template></nuxeo-filter></template></nuxeo-slot-content>`,
    });
    expect(
      (both.conversion.app['layouts/Policy/view.layout.json'] as Record<string, unknown>)['tabs'],
    ).toBeUndefined();
    expect(
      both.conversion.report.constructs.find(
        (construct) => construct.id === `slot-contribution:${tabs}#1`,
      ),
    ).toMatchObject({ outcome: 'reported', note: 'Its slot is not in the catalogue' });
  });
});

/** The made-up package's own bundle, as M1 wrote it. */
function m1Bundle(): string {
  return syntheticBundleFiles()[`${UI}/nuxeo-Acme-Claims-bundle.html`];
}

/** The corpus, prepared once for the tests that only read it. */
let prepared: HarnessInput | undefined;
function input0(): HarnessInput {
  prepared ??= prepare();
  return prepared;
}
