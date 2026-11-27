import { MAX_NESTING, type Finding } from './checker';
import { validateHome, validateNavigation } from './home';
import { validateActions } from './actions';
import { validateLayoutV2 } from './layout-v2';
import { validateQueue } from './queue';
import { PACKAGED_REGISTRIES, withRegistered } from './registries';

// The validators of the menu and the home (docs/business-apps/app-definition-v2.md, sections 9
// and 10). Each table row is a negative control: an input wrong in one way, whose findings must be
// exactly these.

const show = (findings: Finding[]): string[] =>
  findings.map((finding) => `${finding.path}: ${finding.message} [${finding.kind}]`);

type Row = { readonly what: string; readonly input: unknown; readonly found: readonly string[] };

const adjusters = { type: 'app.rules.inGroup', parameters: ['claims-adjusters'] };

describe('home.json', () => {
  const home = (cards: unknown[], keys: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: 2,
    cards,
    ...keys,
  });
  const kpi = (figure: Record<string, unknown>, keys: Record<string, unknown> = {}) => ({
    id: 'open',
    label: 'Open claims',
    kpi: { pageProvider: 'payers_open_claims', ...figure },
    ...keys,
  });

  it('passes a sound one: a count, a bucket, a breakdown and a link, each with a rule', () => {
    const sound = home(
      [
        kpi({ parameters: ['Claim', 30, true] }, { queue: 'open', visibleWhen: adjusters }),
        kpi({ aggregate: 'claim_state_agg', bucket: 'pending' }, { id: 'pending' }),
        kpi({ aggregate: 'claim_type_agg' }, { id: 'by-type', labelKey: 'payers.home.byType' }),
        { id: 'queue', queue: 'open', visibleWhen: { type: 'core.not', parameters: [adjusters] } },
      ],
      { $schema: 'https://example.com/home.schema.json', label: 'Claims' },
    );
    expect(show(validateHome(sound, { queues: new Set(['open']) }))).toEqual([]);
  });

  const rows: readonly Row[] = [
    { what: 'not an object', input: [], found: [': a home file is a JSON object [structure]'] },
    {
      what: 'another version',
      input: { version: 1, cards: [] },
      found: ['version: version must be 2, not 1 [structure]'],
    },
    {
      what: 'no cards',
      input: home([]),
      found: ['cards: needs a list of cards [structure]'],
    },
    {
      what: 'cards that are not a list',
      input: { version: 2, cards: {} },
      found: ['cards: needs a list of cards [structure]'],
    },
    {
      what: 'a key it does not have',
      input: home([kpi({})], { title: 'Claims' }),
      found: ['title: "title" is not a key version 2 has [unknown]'],
    },
    {
      what: 'a title that is not a text',
      input: home([kpi({})], { label: 3 }),
      found: ['label: must be a text [structure]'],
    },
    {
      what: 'a card that is not an object',
      input: home(['open']),
      found: ['cards[0]: a card is an object [structure]'],
    },
    {
      what: 'a card with no id',
      input: home([{ label: 'Open', kpi: { pageProvider: 'payers_open_claims' } }]),
      found: [
        'cards[0].id: an id is 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit [structure]',
      ],
    },
    {
      what: 'two cards with one id',
      input: home([kpi({}), kpi({}, { label: 'Again' })]),
      found: ['cards[1].id: the id "open" is already used at cards[0].id [structure]'],
    },
    {
      what: 'a card with neither a figure nor a queue',
      input: home([{ id: 'open', label: 'Open' }]),
      found: ['cards[0]: a card has a "kpi", a "queue", or both [structure]'],
    },
    {
      what: 'a figure with no name',
      input: home([{ id: 'open', kpi: { pageProvider: 'payers_open_claims' } }]),
      found: ['cards[0]: needs a "label" or a "labelKey" [structure]'],
    },
    {
      what: 'a key a card does not have',
      input: home([kpi({}, { span: 2 })]),
      found: ['cards[0].span: "span" is not a key version 2 has [unknown]'],
    },
    {
      what: 'a figure that is not an object',
      input: home([{ id: 'open', label: 'Open', kpi: 'payers_open_claims' }]),
      found: [
        'cards[0].kpi: a KPI is { "pageProvider", "parameters", "aggregate", "bucket" }, a page provider at least [structure]',
      ],
    },
    {
      what: 'a figure with no page provider',
      input: home([{ id: 'open', label: 'Open', kpi: { aggregate: 'claim_type_agg' } }]),
      found: [
        'cards[0].kpi.pageProvider: needs the name of a page provider defined on the server [structure]',
      ],
    },
    {
      what: 'a key a figure does not have',
      input: home([kpi({ query: 'SELECT * FROM Claim' })]),
      found: ['cards[0].kpi.query: "query" is not a key version 2 has [unknown]'],
    },
    {
      what: 'parameters that are not a list',
      input: home([kpi({ parameters: 'Claim' })]),
      found: ['cards[0].kpi.parameters: parameters must be a list [structure]'],
    },
    {
      what: 'a parameter from a record the home does not have',
      input: home([kpi({ parameters: [{ field: 'claim:member' }] })]),
      found: [
        'cards[0].kpi.parameters[0]: no record is open on the home, so a page provider parameter is a literal [structure]',
      ],
    },
    {
      what: 'an aggregate that is not a name',
      input: home([kpi({ aggregate: '1st' })]),
      found: [
        `cards[0].kpi.aggregate: needs the name of one of the page provider's aggregates [structure]`,
      ],
    },
    {
      what: 'an empty bucket',
      input: home([kpi({ aggregate: 'claim_state_agg', bucket: '' })]),
      found: [
        `cards[0].kpi.bucket: a bucket is the key of one of the aggregate's buckets [structure]`,
      ],
    },
    {
      what: 'a bucket with no aggregate',
      input: home([kpi({ bucket: 'pending' })]),
      found: ['cards[0].kpi.bucket: a bucket is counted in an aggregate: name it too [structure]'],
    },
    {
      what: 'a queue that is not an id',
      input: home([{ id: 'open', queue: 'open claims' }]),
      found: [`cards[0].queue: names a queue by its id, its file's name in queues/ [structure]`],
    },
    {
      what: 'a rule nobody registered',
      input: home([kpi({}, { visibleWhen: 'acme.rules.isAdjuster' })]),
      found: ['cards[0].visibleWhen: the rule "acme.rules.isAdjuster" is not registered [unknown]'],
    },
    {
      what: 'a rule given parameters it does not take',
      input: home([kpi({}, { visibleWhen: { type: 'app.rules.inGroup', parameters: [] } })]),
      found: [
        'cards[0].visibleWhen.parameters: the rule "app.rules.inGroup" takes at least 1 parameter, not 0 [parameter]',
      ],
    },
    {
      what: 'a rule given a property, with no record to read it from',
      input: home([
        kpi(
          {},
          {
            visibleWhen: {
              type: 'app.rules.fieldIn',
              parameters: [{ field: 'claim:state' }, 'pending'],
            },
          },
        ),
      ]),
      found: [
        'cards[0].visibleWhen.parameters[0]: no record is open here, so a rule is given literals, not a property [parameter]',
      ],
    },
    {
      what: 'a property inside a combined rule',
      input: home([
        kpi(
          {},
          {
            visibleWhen: {
              type: 'core.some',
              parameters: [
                adjusters,
                { type: 'app.rules.fieldIn', parameters: [{ field: 'claim:state' }, 'open'] },
              ],
            },
          },
        ),
      ]),
      found: [
        'cards[0].visibleWhen.parameters[1].parameters[0]: no record is open here, so a rule is given literals, not a property [parameter]',
      ],
    },
  ];
  it.each(rows)('refuses $what', ({ input, found }) => {
    expect(show(validateHome(input))).toEqual(found);
  });

  it("takes a customer's own rule, registered in Layer 2 code", () => {
    const registries = withRegistered(PACKAGED_REGISTRIES, { rules: ['acme.rules.isAdjuster'] });
    const input = home([kpi({}, { visibleWhen: 'acme.rules.isAdjuster' })]);
    expect(show(validateHome(input, { registries }))).toEqual([]);
  });

  it("checks a registered rule nested in a customer's own, however deep, as a rule", () => {
    const registries = withRegistered(PACKAGED_REGISTRIES, { rules: ['acme.rules.anyOf'] });
    const card = (parameters: unknown[]) =>
      home([kpi({}, { visibleWhen: { type: 'acme.rules.anyOf', parameters } })]);
    // `core.not` over nothing is `true` in the registry: a composite resolving it would show the card.
    expect(
      show(validateHome(card([{ type: 'core.not', parameters: [] }]), { registries })),
    ).toEqual([
      'cards[0].visibleWhen.parameters[0].parameters: the rule "core.not" takes 1 parameter, not 0 [parameter]',
    ]);
    expect(
      show(
        validateHome(card([{ any: [{ type: 'app.rules.inGroup', parameters: [] }] }]), {
          registries,
        }),
      ),
    ).toEqual([
      'cards[0].visibleWhen.parameters[0].any[0].parameters: the rule "app.rules.inGroup" takes at least 1 parameter, not 0 [parameter]',
    ]);
    // A sound nested rule, a value and a `{ "type" }` nobody registered are the customer's to read.
    expect(
      show(
        validateHome(
          card([
            { type: 'app.rules.inGroup', parameters: ['claims-adjusters'] },
            'claims-supervisors',
            { type: 'acme.kind', of: 'x' },
          ]),
          { registries },
        ),
      ),
    ).toEqual([]);
    // In a layout too, where a record is open: the nested rule is a rule there as well.
    const layout = {
      version: 2,
      cards: [
        {
          id: 'c',
          fields: [
            {
              field: 'dc:title',
              visibleWhen: {
                type: 'acme.rules.anyOf',
                parameters: [{ type: 'core.not', parameters: [] }],
              },
            },
          ],
        },
      ],
    };
    expect(show(validateLayoutV2(layout, { mode: 'view', registries }))).toEqual([
      'cards[0].fields[0].visibleWhen.parameters[0].parameters: the rule "core.not" takes 1 parameter, not 0 [parameter]',
    ]);
  });

  it("refuses a property in a customer's own rule too, however deep, which has no signature here", () => {
    const registries = withRegistered(PACKAGED_REGISTRIES, { rules: ['acme.rules.ownerIs'] });
    const input = home([
      kpi(
        {},
        {
          visibleWhen: {
            type: 'acme.rules.ownerIs',
            parameters: ['x', [{ field: 'dc:creator' }], { of: { field: 'dc:title' } }],
          },
        },
      ),
    ]);
    expect(show(validateHome(input, { registries }))).toEqual([
      'cards[0].visibleWhen.parameters[1][0]: no record is open here, so a rule is given literals, not a property [parameter]',
      'cards[0].visibleWhen.parameters[2].of: no record is open here, so a rule is given literals, not a property [parameter]',
    ]);
    // Where a record is open, the same rule reads it, as a layout's may.
    const layout = {
      version: 2,
      cards: [
        {
          id: 'c',
          fields: [
            {
              field: 'dc:title',
              visibleWhen: { type: 'acme.rules.ownerIs', parameters: [{ field: 'dc:creator' }] },
            },
          ],
        },
      ],
    };
    expect(show(validateLayoutV2(layout, { mode: 'view', registries }))).toEqual([]);
  });
});

describe('navigation.json', () => {
  const navigation = (
    entries: unknown[],
    keys: Record<string, unknown> = {},
  ): Record<string, unknown> => ({ version: 2, entries, ...keys });

  it('passes a sound one: the home, a queue and two of the platform pages', () => {
    const sound = navigation([
      { id: 'home', label: 'Home', icon: 'home', page: 'home' },
      { id: 'open', queue: 'open', order: 10, visibleWhen: adjusters },
      { id: 'tasks', labelKey: 'payers.nav.tasks', page: 'app.navbar.tasks' },
      { id: 'admin', label: 'Admin', page: 'app.navbar.administration' },
    ]);
    expect(show(validateNavigation(sound, { queues: new Set(['open']) }))).toEqual([]);
  });

  const rows: readonly Row[] = [
    {
      what: 'not an object',
      input: 'x',
      found: [': a navigation file is a JSON object [structure]'],
    },
    {
      what: 'no entries',
      input: navigation([]),
      found: ['entries: needs a list of entries [structure]'],
    },
    {
      what: 'a key it does not have',
      input: navigation([{ id: 'home', label: 'Home', page: 'home' }], { label: 'Menu' }),
      found: ['label: "label" is not a key version 2 has [unknown]'],
    },
    {
      what: 'an entry that is not an object',
      input: navigation(['home']),
      found: ['entries[0]: an entry is an object [structure]'],
    },
    {
      what: 'two entries with one id',
      input: navigation([
        { id: 'home', label: 'Home', page: 'home' },
        { id: 'home', queue: 'open' },
      ]),
      found: ['entries[1].id: the id "home" is already used at entries[0].id [structure]'],
    },
    {
      what: 'an entry that opens nothing',
      input: navigation([{ id: 'home', label: 'Home' }]),
      found: ['entries[0]: an entry opens a "queue" or a "page": one of the two [structure]'],
    },
    {
      what: 'an entry that opens two things',
      input: navigation([{ id: 'home', label: 'Home', page: 'home', queue: 'open' }]),
      found: ['entries[0]: an entry opens a "queue" or a "page": one of the two [structure]'],
    },
    {
      what: 'a page with no name',
      input: navigation([{ id: 'home', page: 'home' }]),
      found: ['entries[0]: needs a "label" or a "labelKey" [structure]'],
    },
    {
      what: 'a page nobody registered',
      input: navigation([{ id: 'reports', label: 'Reports', page: 'app.navbar.reports' }]),
      found: ['entries[0].page: the page "app.navbar.reports" is not registered [unknown]'],
    },
    {
      what: 'the settings drawer, which is not a page',
      input: navigation([{ id: 'settings', label: 'Settings', page: 'app.navbar.settings' }]),
      found: ['entries[0].page: the page "app.navbar.settings" is not registered [unknown]'],
    },
    {
      what: 'a page that is not a text',
      input: navigation([{ id: 'home', label: 'Home', page: 1 }]),
      found: [`entries[0].page: a page is "home" or the ID of a page's menu entry [structure]`],
    },
    {
      what: 'an icon that is not a Material Symbols name',
      input: navigation([{ id: 'open', queue: 'open', icon: 'Inbox Tray' }]),
      found: [
        'entries[0].icon: icon is the name of a Material Symbols icon, such as "inbox" [structure]',
      ],
    },
    {
      what: 'an order that is not a whole number',
      input: navigation([{ id: 'open', queue: 'open', order: 1.5 }]),
      found: ['entries[0].order: order is a whole number [structure]'],
    },
    {
      what: 'a key an entry does not have',
      input: navigation([{ id: 'open', queue: 'open', path: '/queues/open' }]),
      found: ['entries[0].path: "path" is not a key version 2 has [unknown]'],
    },
    {
      what: 'a rule given a property, with no record to read it from',
      input: navigation([
        {
          id: 'open',
          queue: 'open',
          visibleWhen: { type: 'app.rules.fieldIn', parameters: [{ field: 'dc:title' }, 'x'] },
        },
      ]),
      found: [
        'entries[0].visibleWhen.parameters[0]: no record is open here, so a rule is given literals, not a property [parameter]',
      ],
    },
  ];
  it.each(rows)('refuses $what', ({ input, found }) => {
    expect(show(validateNavigation(input))).toEqual(found);
  });

  it("opens a deployment's own page, registered in a manifest or in code", () => {
    const registries = withRegistered(PACKAGED_REGISTRIES, { pages: ['acme.navbar.contracts'] });
    const input = navigation([
      { id: 'contracts', label: 'Contracts', page: 'acme.navbar.contracts' },
    ]);
    expect(show(validateNavigation(input, { registries }))).toEqual([]);
  });
});

describe('a record-free checker leaves the rest alone', () => {
  it('still reads a property in a layout, where a record is open', () => {
    const layout = {
      version: 2,
      cards: [
        {
          id: 'c',
          fields: [
            {
              field: 'dc:title',
              visibleWhen: {
                type: 'app.rules.fieldIn',
                parameters: [{ field: 'dc:title' }, 'x'],
              },
            },
          ],
        },
      ],
    };
    expect(show(validateLayoutV2(layout, { mode: 'view' }))).toEqual([]);
  });
});

describe('nesting deeper than the validator reads', () => {
  // JSON can nest further than a recursive walk has stack for. Each walk stops at MAX_NESTING
  // levels with a finding, so a file is refused or left out rather than crashing the check.
  const levels = 6000;
  const nestedValue = (): unknown => {
    let value: unknown = 'x';
    for (let index = 0; index < levels; index++) value = { a: value };
    return value;
  };
  const nestedRule = (): unknown => {
    let rule: unknown = 'core.true';
    for (let index = 0; index < levels; index++) rule = { type: 'core.not', parameters: [rule] };
    return rule;
  };
  const deepest = (findings: Finding[]): string[] =>
    findings.map((finding) => `${finding.message} [${finding.kind}]`);
  const tooDeep = `nests more than ${MAX_NESTING} levels deep, deeper than the validator reads [parameter]`;

  it("finds it in a customer's own rule, rather than overflowing the stack", () => {
    const registries = withRegistered(PACKAGED_REGISTRIES, { rules: ['acme.rules.anyOf'] });
    const input = {
      version: 2,
      cards: [
        {
          id: 'a',
          label: 'A',
          kpi: { pageProvider: 'p' },
          visibleWhen: { type: 'acme.rules.anyOf', parameters: [nestedValue()] },
        },
      ],
    };
    expect(deepest(validateHome(input, { registries }))).toEqual([tooDeep]);
  });

  it('finds it in rules nested in rules, on the home and in a layout', () => {
    const input = {
      version: 2,
      cards: [{ id: 'a', label: 'A', kpi: { pageProvider: 'p' }, visibleWhen: nestedRule() }],
    };
    expect(deepest(validateHome(input))).toEqual([tooDeep]);
    const layout = {
      version: 2,
      cards: [{ id: 'c', fields: [{ field: 'dc:title', visibleWhen: nestedRule() }] }],
    };
    expect(deepest(validateLayoutV2(layout, { mode: 'view' }))).toEqual([tooDeep]);
  });

  it('finds it in computations nested in computations', () => {
    let computed: unknown = { type: 'core.count', parameters: [{ field: 'dc:title' }] };
    for (let index = 0; index < levels; index++)
      computed = { type: 'core.choose', parameters: ['core.true', { computed }, 1] };
    const layout = { version: 2, cards: [{ id: 'c', fields: [{ id: 'k', computed }] }] };
    // At the limit a `core.choose` has a rule and a computation, each one level too deep.
    expect(deepest(validateLayoutV2(layout, { mode: 'view' }))).toEqual([tooDeep, tooDeep]);
  });

  it('finds it in tables nested in tables', () => {
    let column: unknown = 'dc:title';
    for (let index = 0; index < levels; index++)
      column = { field: 'dc:contributors', widget: 'table', parameters: { columns: [column] } };
    const layout = { version: 2, cards: [{ id: 'c', fields: [column] }] };
    expect(deepest(validateLayoutV2(layout, { mode: 'view' }))).toEqual([tooDeep]);
  });

  it('names a value it refuses by its kind, rather than writing it out as deep as it nests', () => {
    expect(deepest(validateHome({ version: nestedValue(), cards: [] }))).toEqual([
      'version must be 2, not {…} [structure]',
    ]);
    expect(deepest(validateHome({ version: [[2]], cards: [] }))).toEqual([
      'version must be 2, not […] [structure]',
    ]);
    const queue = {
      version: 2,
      label: 'Open',
      pageProvider: 'payers_open',
      columns: ['dc:title'],
      rowActions: [nestedValue()],
    };
    expect(deepest(validateQueue(queue))).toEqual([
      'the row action {…} is not registered [unknown]',
    ]);
    const actions = {
      version: 2,
      actions: [{ id: 'a', label: 'A', transition: 'go', on: [nestedValue()] }],
    };
    expect(deepest(validateActions(actions))).toEqual([
      '{…} is not "record", "row", "card" or "bulk" [structure]',
    ]);
  });

  it('reads as deep as the limit', () => {
    let rule: unknown = 'core.true';
    // Each core.not is one level, and the innermost rule one more.
    for (let index = 0; index < MAX_NESTING - 1; index++)
      rule = { type: 'core.not', parameters: [rule] };
    const input = {
      version: 2,
      cards: [{ id: 'a', label: 'A', kpi: { pageProvider: 'p' }, visibleWhen: rule }],
    };
    expect(deepest(validateHome(input))).toEqual([]);
    expect(
      deepest(
        validateHome({
          ...input,
          cards: [{ ...input.cards[0], visibleWhen: { type: 'core.not', parameters: [rule] } }],
        }),
      ),
    ).toEqual([tooDeep]);
  });
});
