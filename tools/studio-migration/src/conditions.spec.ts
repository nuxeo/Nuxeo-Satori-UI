import {
  chainTable,
  decideCondition,
  parseExpression,
  rulePasses,
  truthTable,
  webUiPasses,
  type Situation,
} from './conditions';
import { guardOfSet } from './guards';
import type { Condition, Inventory } from './inventory';

const filter = (
  attributes: Record<string, string>,
  index = 0,
  parent: number | null = null,
): Condition => ({
  path: 'layout.html',
  index,
  element: 'nuxeo-filter',
  attributes: { document: '[[document]]', user: '[[user]]', ...attributes },
  parent,
  userInScope: true,
});
const domIf = (test: string): Condition => ({
  path: 'layout.html',
  index: 0,
  element: 'template',
  attributes: { is: 'dom-if', if: `[[${test}]]` },
  parent: null,
  userInScope: true,
});
const situation = (partial: Partial<Situation>): Situation => ({
  type: 'File',
  facets: [],
  state: 'project',
  permissions: [],
  groups: [],
  ...partial,
});

describe("Web UI's reading of a condition, as nuxeo-filter's check implements it", () => {
  it('passes a test when any of its values does, and the filter only when every test does', () => {
    const condition = filter({ type: 'Claim, Case', state: 'open' });
    expect(webUiPasses(condition, situation({ type: 'Case', state: 'open' }))).toBe(true);
    expect(webUiPasses(condition, situation({ type: 'Case', state: 'closed' }))).toBe(false);
    expect(webUiPasses(condition, situation({ type: 'File', state: 'open' }))).toBe(false);
    // An empty attribute is no test.
    expect(webUiPasses(filter({ type: '' }), situation({}))).toBe(true);
  });

  it('reads facets, permissions and groups as lists, and cannot read a path or a schema', () => {
    expect(
      webUiPasses(filter({ facet: 'Versionable' }), situation({ facets: ['Versionable'] })),
    ).toBe(true);
    expect(
      webUiPasses(filter({ permission: 'Write' }), situation({ permissions: ['WriteProperties'] })),
    ).toBe(false);
    expect(webUiPasses(filter({ group: 'a, b' }), situation({ groups: ['b'] }))).toBe(true);
    expect(webUiPasses(filter({ path: '/default-domain' }), situation({}))).toBeNull();
  });

  it("runs a filter's expression with this the filter, so a call without this. throws", () => {
    const file = situation({ type: 'File' });
    expect(webUiPasses(filter({ expression: "this.hasType(document, 'File')" }), file)).toBe(true);
    expect(webUiPasses(filter({ expression: "hasType(document, 'File')" }), file)).toBe(false);
  });
});

describe('what a condition becomes', () => {
  it('makes each structured test its registered rule, and several tests one core.every', () => {
    expect(decideCondition(filter({ type: 'Claim, Case' }))).toEqual({
      kind: 'rule',
      rule: { type: 'app.rules.isType', parameters: ['Claim', 'Case'] },
      document: true,
    });
    expect(decideCondition(filter({ facet: 'Versionable', state: 'open' }))).toMatchObject({
      kind: 'rule',
      rule: {
        type: 'core.every',
        parameters: [
          { type: 'app.rules.hasFacet', parameters: ['Versionable'] },
          { type: 'app.rules.inState', parameters: ['open'] },
        ],
      },
    });
    expect(decideCondition(filter({ group: 'adjusters' }))).toEqual({
      kind: 'rule',
      rule: { type: 'app.rules.inGroup', parameters: ['adjusters'] },
      document: false,
    });
  });

  it('converts a permission test only to the rule with exactly its permissions', () => {
    expect(decideCondition(filter({ permission: 'WriteProperties, Write' }))).toMatchObject({
      rule: 'app.rules.canWrite',
    });
    expect(decideCondition(filter({ permission: 'Remove' }))).toMatchObject({
      rule: 'app.rules.canRemove',
    });
    expect(decideCondition(filter({ permission: 'Everything,WriteSecurity' }))).toMatchObject({
      rule: 'app.rules.canManagePermissions',
    });
    // canWrite also passes on WriteProperties alone, where Web UI's Write would not.
    expect(decideCondition(filter({ permission: 'Write' }))).toMatchObject({ kind: 'reported' });
    expect(decideCondition(filter({ permission: 'ReadWrite' }))).toMatchObject({
      kind: 'reported',
    });
  });

  it('reports a test no rule makes, never guessing one', () => {
    for (const attributes of [
      { path: '/default-domain/' },
      { schema: 'dublincore' },
      { expression: 'true' },
    ] as Record<string, string>[])
      expect(decideCondition(filter(attributes))).toMatchObject({
        kind: 'reported',
      });
  });

  it('reports a filter given another document than the open record, or a group test given no user', () => {
    expect(
      decideCondition({
        ...filter({ type: 'Claim' }),
        attributes: { document: '[[item]]', type: 'Claim' },
      }),
    ).toMatchObject({ kind: 'reported', note: expect.stringMatching(/the document \[\[item\]\]/) });
    expect(decideCondition({ ...filter({}), attributes: { group: 'adjusters' } })).toMatchObject({
      kind: 'reported',
      note: expect.stringMatching(/never passes in Web UI/),
    });
    // A group test reads no document, so it needs none.
    expect(
      decideCondition({ ...filter({}), attributes: { user: '[[user]]', group: 'adjusters' } }),
    ).toMatchObject({ kind: 'rule' });
  });

  it("proposes a dom-if's one call of a filter function, and reports what is no Polymer binding", () => {
    expect(decideCondition(domIf("!hasFacet(document, 'Folderish')"))).toMatchObject({
      kind: 'proposed',
      rule: {
        type: 'core.not',
        parameters: [{ type: 'app.rules.hasFacet', parameters: ['Folderish'] }],
      },
    });
    // Polymer binds a path or one call: `&&`, `||` and a method of a value are left as text,
    // which is always true, so Web UI always shows what the dom-if holds.
    for (const free of [
      "hasType(document, 'A') && isMember(user, 'b')",
      "document.facets.indexOf('Versionable') !== -1",
    ])
      expect(decideCondition(domIf(free))).toMatchObject({
        kind: 'reported',
        note: expect.stringMatching(/no Polymer binding, so Web UI always shows what it holds/),
      });
    expect(decideCondition(domIf('document.isFolderish'))).toMatchObject({
      kind: 'reported',
      note: expect.stringMatching(/reads a property of the page/),
    });
    expect(decideCondition(domIf('_customCheck(document)'))).toMatchObject({ kind: 'reported' });
    // A binding's one call is the host's, by its name: the parser holds to that on its own too.
    for (const free of [
      "hasType(document, 'A') && isMember(user, 'b')",
      "this.hasType(document, 'A')",
    ])
      expect(parseExpression(free, { bare: true })).toHaveProperty('problem');
    expect(decideCondition({ ...domIf("isMember(user, 'g')"), userInScope: false })).toMatchObject({
      kind: 'reported',
      note: expect.stringMatching(/reads a user its file is not given/),
    });
  });

  it("proposes a filter's expression in a known pattern, which calls this.'s functions", () => {
    expect(
      decideCondition(
        filter({ expression: "this.isMember(user, 'a') || this.isMember(user, 'b')" }),
      ),
    ).toMatchObject({
      kind: 'proposed',
      rule: {
        type: 'core.some',
        parameters: [
          { type: 'app.rules.inGroup', parameters: ['a'] },
          { type: 'app.rules.inGroup', parameters: ['b'] },
        ],
      },
    });
    expect(
      parseExpression("document.facets.indexOf('Versionable') !== -1", { bare: false }),
    ).toMatchObject({ rule: { type: 'app.rules.hasFacet', parameters: ['Versionable'] } });
    // Without `this.`, the call throws in the filter's function, and the filter never passes.
    expect(decideCondition(filter({ expression: "hasType(document, 'A')" }))).toMatchObject({
      kind: 'reported',
      note: expect.stringMatching(/without this\., which throws/),
    });
    for (const free of [
      "this.hasType(document, 'A') && this.isMember(user, 'b') || x",
      '(this.hasType(document, "A"))',
      "this.isMember(document, 'a')",
      "this.hasPermission(document, 'Write')",
      'this._customCheck(document)',
    ])
      expect(parseExpression(free, { bare: false })).toHaveProperty('problem');
  });

  it('reports a test of spacing alone, which never passes in Web UI', () => {
    expect(decideCondition(filter({ type: ' ' }))).toMatchObject({
      kind: 'reported',
      note: expect.stringMatching(/blank, so it never passes/),
    });
    expect(webUiPasses(filter({ type: ' ' }), situation({}))).toBe(false);
  });

  it('reports a group test whose user its file does not hold', () => {
    expect(decideCondition({ ...filter({ group: 'g' }), userInScope: false })).toMatchObject({
      kind: 'reported',
      note: expect.stringMatching(/given \[\[user\]\], which its file does not hold/),
    });
  });
});

describe('the guard of what sits in several conditions', () => {
  const inventoryOf = (conditions: Condition[]) => ({ conditions }) as unknown as Inventory;

  it('joins conditions nested one in the next, and reports them side by side', () => {
    const outer = filter({ group: 'g' }, 0);
    const nested = filter({ type: 'Claim' }, 1, 0);
    expect(guardOfSet(inventoryOf([outer, nested]), 'layout.html', [0, 1])).toMatchObject({
      kind: 'rule',
      rule: {
        type: 'core.every',
        parameters: [
          { type: 'app.rules.isType', parameters: ['Claim'] },
          { type: 'app.rules.inGroup', parameters: ['g'] },
        ],
      },
    });
    const beside = filter({ type: 'Claim' }, 1);
    expect(guardOfSet(inventoryOf([outer, beside]), 'layout.html', [0, 1])).toMatchObject({
      kind: 'reported',
      note: expect.stringMatching(/side by side/),
    });
  });
});

describe('the truth tables', () => {
  it('agree for every rule a condition becomes', () => {
    for (const condition of [
      filter({ type: 'Claim, Case', permission: 'Write, WriteProperties' }),
      filter({ facet: 'A, B', state: 'open, closed', group: 'g' }),
      filter({ permission: 'WriteSecurity, Everything' }),
      filter({
        expression: "this.hasType(document, 'Claim') && !this.hasFacet(document, 'Folderish')",
      }),
      filter({ expression: "this.isMember(user, 'a') || this.isMember(user, 'b')" }),
      domIf("!hasState(document, 'deleted')"),
    ]) {
      const decision = decideCondition(condition);
      if (decision.kind === 'reported') throw new Error(decision.note);
      const table = truthTable(condition, decision.rule);
      expect([table.unreadable, table.disagree]).toEqual([false, []]);
      expect(table.rows).toBeGreaterThan(1);
    }
  });

  it('find the rows where a rule decides otherwise', () => {
    const condition = filter({ type: 'Claim' });
    expect(
      truthTable(condition, {
        type: 'core.not',
        parameters: [{ type: 'app.rules.isType', parameters: ['Claim'] }],
      }).disagree,
    ).toHaveLength(2);
    expect(truthTable(filter({ permission: 'Write' }), 'app.rules.canWrite').disagree).toEqual([
      expect.objectContaining({ permissions: ['WriteProperties'] }),
    ]);
    expect(truthTable(condition, 'core.true').disagree).toHaveLength(1);
    // A rule that names more than the condition passes where Web UI does not: its own values are
    // rows of the table too.
    expect(
      truthTable(condition, { type: 'app.rules.isType', parameters: ['Claim', 'Case'] }).disagree,
    ).toEqual([expect.objectContaining({ type: 'Case' })]);
    expect(
      truthTable(filter({ group: 'g' }), { type: 'app.rules.inGroup', parameters: ['g', 'h'] })
        .disagree,
    ).toEqual([expect.objectContaining({ groups: ['h'] })]);
    expect(truthTable(condition, 'app.rules.someOther').unreadable).toBe(true);
    // A permission rule the condition does not name is tabled by its own permissions.
    expect(
      truthTable(filter({ type: 'File' }), {
        type: 'core.some',
        parameters: [{ type: 'app.rules.isType', parameters: ['File'] }, 'app.rules.canWrite'],
      }).disagree.length,
    ).toBeGreaterThan(0);
    // Every value is tabled, however many: a fifth group added or dropped is seen.
    const five = filter({ group: 'g1, g2, g3, g4, g5' });
    expect(
      truthTable(five, { type: 'app.rules.inGroup', parameters: ['g1', 'g2', 'g3', 'g4'] }).disagree
        .length,
    ).toBeGreaterThan(0);
    expect(
      truthTable(five, {
        type: 'app.rules.inGroup',
        parameters: ['g1', 'g2', 'g3', 'g4', 'g5', 'administrators'],
      }).disagree.length,
    ).toBeGreaterThan(0);
  });

  it('hold nested conditions, which must all pass, to one rule', () => {
    const outer = filter({ group: 'g' }, 0);
    const inner = filter({ type: 'Claim' }, 1, 0);
    const both = {
      type: 'core.every',
      parameters: [
        { type: 'app.rules.isType', parameters: ['Claim'] },
        { type: 'app.rules.inGroup', parameters: ['g'] },
      ],
    };
    expect(chainTable([inner, outer], both).disagree).toEqual([]);
    expect(
      chainTable([inner, outer], { type: 'app.rules.isType', parameters: ['Claim'] }).disagree
        .length,
    ).toBeGreaterThan(0);
  });

  it('read core.not as the platform does, as NOR', () => {
    const situationOf = situation({ type: 'Claim' });
    expect(
      rulePasses({ type: 'core.not', parameters: ['core.false', 'core.false'] }, situationOf),
    ).toBe(true);
    expect(
      rulePasses({ type: 'core.not', parameters: ['core.false', 'core.true'] }, situationOf),
    ).toBe(false);
  });
});
