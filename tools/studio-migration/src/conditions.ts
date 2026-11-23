/**
 * M2's conditions (docs/business-apps/studio-migration.md, sections 3, 6 and 10): what a Web UI
 * condition becomes as a registered rule, and the truth tables that hold the two to each other.
 *
 * **What Web UI decides**, read from `nuxeo-filter` and `FiltersBehavior` in nuxeo-elements
 * (`ui/nuxeo-filter.js`, `ui/nuxeo-filters-behavior.js`, at 1f6aaee47):
 *
 * - each attribute is a test, and the filter passes only when every test given passes;
 * - a test of comma-separated values passes when any value does: `type="A, B"` is A or B;
 * - `type` is `document.type === value`, `facet` is in `document.facets`, `state` is
 *   `document.state === value`, `permission` is in `document.contextParameters.permissions`,
 *   `group` is the name of one of `user.extendedGroups`, `schema` is a schema's prefix or name, and
 *   `path` is a regular expression `^value` over the document's path;
 * - `expression` is free JavaScript, run on `document` and `user`.
 *
 * **What the app decides**, read from the registered rules (`libs/shared/extensions`,
 * `document-rules.ts`, and `libs/shared/nuxeo-client`'s `document-permissions.ts`): `isType`,
 * `hasFacet` and `inState` are exact matches of any of their parameters; `canWrite` is `Write` or
 * `WriteProperties` among the permissions, `canRemove` is `Remove`, `canAddChildren` is
 * `AddChildren`, `canManagePermissions` is `WriteSecurity` or `Everything`; `inGroup` is any of the
 * user's groups, which hold `extendedGroups`.
 *
 * So a test converts only to a rule that decides exactly as it does. A permission test converts
 * only when its values are exactly one rule's permissions; `path` and `schema` have no rule. A
 * condition with any test that does not convert is reported, never guessed.
 *
 * **JavaScript.** A `dom-if`, or a filter's `expression`, is free JavaScript. One written in a
 * known pattern, a call of the filter functions above (`hasType(document, 'X')`, `isMember(user,
 * 'g')`, ...) or `document.facets.indexOf('X') !== -1`, negated with `!` or joined with `&&` or
 * `||`, is proposed as its rule: section 3 leaves it for a person to accept. Anything else is
 * reported.
 *
 * **Truth tables.** Both readings are implemented here, each from its own source, and
 * `truthTable` runs them over every combination of the values a condition tests and one value it
 * does not. They must agree on every row. This is the half of check 5 that needs no server: it
 * proves the mapping against the two sources as written. The other half evaluates the original
 * in Web UI itself, on the migration server, and has not run.
 */
import type { Condition } from './inventory';
import { own } from './catalogue';

/** A rule as an app definition writes one: an id, or `{ "type", "parameters" }`. */
export type Rule = string | { readonly type: string; readonly parameters: readonly unknown[] };

export type ConditionDecision =
  | {
      readonly kind: 'rule';
      readonly rule: Rule;
      /** True when it reads the open document, so it means nothing where none is open. */
      readonly document: boolean;
    }
  | {
      readonly kind: 'proposed';
      readonly rule: Rule;
      readonly document: boolean;
      readonly note: string;
    }
  | { readonly kind: 'reported'; readonly note: string };

/** The permission tests that are exactly one registered rule. */
const PERMISSION_RULES: readonly (readonly [readonly string[], string])[] = [
  [['Write', 'WriteProperties'], 'app.rules.canWrite'],
  [['Remove'], 'app.rules.canRemove'],
  [['AddChildren'], 'app.rules.canAddChildren'],
  [['WriteSecurity', 'Everything'], 'app.rules.canManagePermissions'],
];

const BOUND = /^\s*(?:\[\[|\{\{)\s*([\w.]+)\s*(?:\]\]|\}\})\s*$/;

function values(text: string): string[] {
  return text
    .trim()
    .split(/\s*,\s*/)
    .filter((value) => value !== '');
}

function every(rules: readonly Rule[]): Rule {
  return rules.length === 1 ? rules[0] : { type: 'core.every', parameters: rules };
}

/** What a condition of a package becomes. */
export function decideCondition(condition: Condition): ConditionDecision {
  if (condition.element !== 'nuxeo-filter') {
    const test = own(condition.attributes, 'if');
    const expression = test === undefined ? undefined : /^\s*\[\[([\s\S]*)\]\]\s*$/.exec(test)?.[1];
    if (expression === undefined)
      return { kind: 'reported', note: 'Its `if` is not a binding a pattern can read' };
    const parsed = parseExpression(expression);
    return 'problem' in parsed
      ? {
          kind: 'reported',
          note: `Its \`if\`, ${test}, is free JavaScript in no known pattern: ${parsed.problem}`,
        }
      : {
          kind: 'proposed',
          rule: parsed.rule,
          document: parsed.document,
          note: `Its \`if\`, ${test}, is free JavaScript in a known pattern: the rule ${JSON.stringify(parsed.rule)} is proposed, for a person to accept (section 3)`,
        };
  }
  const attributes = condition.attributes;
  const rules: Rule[] = [];
  let document = false;
  let user = false;
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'document' || name === 'user' || value.trim() === '') continue;
    const list = values(value);
    switch (name) {
      case 'type':
        rules.push({ type: 'app.rules.isType', parameters: list });
        document = true;
        break;
      case 'facet':
        rules.push({ type: 'app.rules.hasFacet', parameters: list });
        document = true;
        break;
      case 'state':
        rules.push({ type: 'app.rules.inState', parameters: list });
        document = true;
        break;
      case 'group':
        rules.push({ type: 'app.rules.inGroup', parameters: list });
        user = true;
        break;
      case 'permission': {
        const wanted = [...new Set(list)].sort();
        const match = PERMISSION_RULES.find(
          ([permissions]) => [...permissions].sort().join(',') === wanted.join(','),
        );
        if (!match)
          return {
            kind: 'reported',
            note: `Its permission test, ${value}, is no registered rule: canWrite is Write or WriteProperties, canRemove Remove, canAddChildren AddChildren, canManagePermissions WriteSecurity or Everything`,
          };
        rules.push(match[1]);
        document = true;
        break;
      }
      case 'expression':
        return {
          kind: 'reported',
          note: `Its expression, ${value}, is free JavaScript beside structured tests: a person decides it`,
        };
      default:
        return {
          kind: 'reported',
          note: `Its ${name} test has no registered rule${name === 'path' ? ': no rule reads a path' : name === 'schema' ? ': no rule reads a schema' : ''}`,
        };
    }
  }
  // Web UI reads the filter's own `document` and `user`; a rule reads the open record and the
  // signed-in user. They agree only when the filter is given those.
  const documentBinding = BOUND.exec(own(attributes, 'document') ?? '')?.[1];
  if (document && documentBinding !== 'document')
    return {
      kind: 'reported',
      note: `It tests ${own(attributes, 'document') ? `the document ${own(attributes, 'document')}` : 'a document it is not given'}, where a rule reads the open record`,
    };
  const userBinding = BOUND.exec(own(attributes, 'user') ?? '')?.[1];
  if (user && userBinding !== 'user')
    return {
      kind: 'reported',
      note: 'Its group test is given no user, so it never passes in Web UI: a mistake to fix, not to copy',
    };
  if (rules.length === 0) return { kind: 'rule', rule: 'core.true', document: false };
  return { kind: 'rule', rule: every(rules), document };
}

/** The filter functions a known pattern may call, with what each becomes. */
const CALLS: Readonly<
  Record<
    string,
    { readonly on: 'document' | 'user'; readonly rule: (value: string) => Rule | null }
  >
> = {
  hasType: { on: 'document', rule: (value) => ({ type: 'app.rules.isType', parameters: [value] }) },
  hasFacet: {
    on: 'document',
    rule: (value) => ({ type: 'app.rules.hasFacet', parameters: [value] }),
  },
  hasState: {
    on: 'document',
    rule: (value) => ({ type: 'app.rules.inState', parameters: [value] }),
  },
  isMember: { on: 'user', rule: (value) => ({ type: 'app.rules.inGroup', parameters: [value] }) },
  hasPermission: {
    on: 'document',
    rule: (value) =>
      PERMISSION_RULES.find(
        ([permissions]) => permissions.length === 1 && permissions[0] === value,
      )?.[1] ?? null,
  },
};

const TERM =
  /^(!?)\s*(?:this\.)?(hasType|hasFacet|hasState|isMember|hasPermission)\(\s*(document|user)\s*,\s*(['"])([^'"]+)\4\s*\)$/;
const FACETS =
  /^(!?)\s*document\.facets\.(?:indexOf\(\s*(['"])([^'"]+)\2\s*\)\s*(!==\s*-1|>=\s*0|>\s*-1)|includes\(\s*(['"])([^'"]+)\5\s*\))$/;

/** A known pattern's rule, or why it is none. */
export function parseExpression(
  source: string,
): { rule: Rule; document: boolean } | { problem: string } {
  const text = source.trim();
  const and = text.includes('&&');
  const or = text.includes('||');
  // Each part must be one known term whole, so grouping in parentheses is none.
  if (and && or) return { problem: 'it mixes && and ||' };
  const parts = text.split(and ? '&&' : '||').map((part) => part.trim());
  const rules: Rule[] = [];
  let document = false;
  for (const part of parts) {
    const call = TERM.exec(part);
    const facets = call ? null : FACETS.exec(part);
    let rule: Rule | null = null;
    let negated = false;
    if (call) {
      const known = CALLS[call[2]];
      if (known.on !== call[3]) return { problem: `${call[2]} is called on ${call[3]}` };
      rule = known.rule(call[5]);
      if (rule === null)
        return { problem: `no registered rule tests the permission ${call[5]} alone` };
      negated = call[1] === '!';
      document ||= known.on === 'document';
    } else if (facets) {
      rule = { type: 'app.rules.hasFacet', parameters: [facets[3] ?? facets[6]] };
      negated = facets[1] === '!';
      document = true;
    } else return { problem: `"${part}" is none` };
    rules.push(negated ? { type: 'core.not', parameters: [rule] } : rule);
  }
  if (rules.length === 1) return { rule: rules[0], document };
  return { rule: { type: or ? 'core.some' : 'core.every', parameters: rules }, document };
}

/** One row of a truth table: what the document and the user are. */
export interface Situation {
  readonly type: string;
  readonly facets: readonly string[];
  readonly state: string;
  readonly permissions: readonly string[];
  readonly groups: readonly string[];
}

/** Web UI's reading of a condition: `nuxeo-filter`'s `check`, and the filter functions. */
export function webUiPasses(condition: Condition, situation: Situation): boolean | null {
  if (condition.element !== 'nuxeo-filter') {
    const expression = /^\s*\[\[([\s\S]*)\]\]\s*$/.exec(own(condition.attributes, 'if') ?? '')?.[1];
    return expression === undefined ? null : webUiExpression(expression, situation);
  }
  for (const [name, value] of Object.entries(condition.attributes)) {
    if (name === 'document' || name === 'user' || !value) continue;
    const list = values(value);
    const test = (one: string): boolean | null => {
      switch (name) {
        case 'type':
          return situation.type === one;
        case 'facet':
          return situation.facets.includes(one);
        case 'state':
          return situation.state === one;
        case 'permission':
          return situation.permissions.includes(one);
        case 'group':
          return situation.groups.includes(one);
        default:
          return null;
      }
    };
    let pass = false;
    for (const one of list) {
      const result = test(one);
      if (result === null) return null;
      if (result) {
        pass = true;
        break;
      }
    }
    if (!pass) return false;
  }
  return true;
}

function webUiExpression(source: string, situation: Situation): boolean | null {
  const text = source.trim();
  const or = text.includes('||');
  const parts = text.split(or ? '||' : '&&').map((part) => part.trim());
  const results = parts.map((part): boolean | null => {
    const call = TERM.exec(part);
    if (call) {
      const value = call[5];
      const result =
        call[2] === 'hasType'
          ? situation.type === value
          : call[2] === 'hasFacet'
            ? situation.facets.includes(value)
            : call[2] === 'hasState'
              ? situation.state === value
              : call[2] === 'isMember'
                ? situation.groups.includes(value)
                : situation.permissions.includes(value);
      return call[1] === '!' ? !result : result;
    }
    const facets = FACETS.exec(part);
    if (facets) {
      const result = situation.facets.includes(facets[3] ?? facets[6]);
      return facets[1] === '!' ? !result : result;
    }
    return null;
  });
  if (results.includes(null)) return null;
  return or ? results.some(Boolean) : results.every(Boolean);
}

/** The app's reading of a rule: the registered rules' evaluators, for the rules M2 writes. */
export function rulePasses(rule: unknown, situation: Situation): boolean | null {
  if (typeof rule === 'string') {
    switch (rule) {
      case 'core.true':
        return true;
      case 'core.false':
        return false;
      case 'app.rules.canWrite':
        return (
          situation.permissions.includes('Write') ||
          situation.permissions.includes('WriteProperties')
        );
      case 'app.rules.canRemove':
        return situation.permissions.includes('Remove');
      case 'app.rules.canAddChildren':
        return situation.permissions.includes('AddChildren');
      case 'app.rules.canManagePermissions':
        return (
          situation.permissions.includes('WriteSecurity') ||
          situation.permissions.includes('Everything')
        );
      default:
        return null;
    }
  }
  if (typeof rule !== 'object' || rule === null) return null;
  const { type, parameters } = rule as { type?: unknown; parameters?: unknown };
  const list = Array.isArray(parameters) ? parameters : [];
  const texts = list.filter((value): value is string => typeof value === 'string');
  switch (type) {
    case 'app.rules.isType':
      return texts.includes(situation.type);
    case 'app.rules.hasFacet':
      return texts.some((facet) => situation.facets.includes(facet));
    case 'app.rules.inState':
      return texts.includes(situation.state);
    case 'app.rules.inGroup':
      return texts.some((group) => situation.groups.includes(group));
    case 'core.every':
    case 'core.some':
    case 'core.not': {
      const results = list.map((inner) => rulePasses(inner, situation));
      if (results.includes(null)) return null;
      if (type === 'core.every') return results.every(Boolean);
      if (type === 'core.some') return results.some(Boolean);
      // `core.not` is NOR: true when every nested rule is false.
      return results.every((result) => !result);
    }
    default:
      return rulePasses(type, situation);
  }
}

const OTHER = '~other';

/**
 * Every situation that tells a condition's tests apart. For each dimension it tests: each value it
 * names and one it does not, or every subset of the facets, permissions or groups it names, with
 * the permissions of every rule a permission may become. A dimension it does not test is held to
 * one value, which keeps the table small enough to run in full.
 */
export function situations(condition: Condition, extra: RuleValues = NO_VALUES): Situation[] {
  const named = (attribute: string): string[] => values(own(condition.attributes, attribute) ?? '');
  const expression = own(condition.attributes, 'if') ?? '';
  const called = (name: string): string[] =>
    [...expression.matchAll(new RegExp(`${name}\\(\\s*\\w+\\s*,\\s*(['"])([^'"]+)\\1`, 'g'))].map(
      (match) => match[2],
    );
  const facetLiterals = [
    ...called('hasFacet'),
    ...[...expression.matchAll(/facets\.(?:indexOf|includes)\(\s*(['"])([^'"]+)\1/g)].map(
      (m) => m[2],
    ),
  ];
  // The rule's own values too, so that a rule naming more than the condition is seen passing
  // where Web UI does not.
  const tested = (attribute: string, literals: readonly string[]): string[] =>
    [...new Set([...named(attribute), ...literals])].slice(0, 4);
  // The rule's own values too, each in its dimension, so that a rule naming more than the
  // condition is seen passing where Web UI does not.
  const types = [...new Set([...tested('type', called('hasType')), ...extra.types]), OTHER];
  const states = [...new Set([...tested('state', called('hasState')), ...extra.states]), OTHER];
  const facetPool = [...new Set([...tested('facet', facetLiterals), ...extra.facets])].slice(0, 5);
  const groupPool = [...new Set([...tested('group', called('isMember')), ...extra.groups])].slice(
    0,
    5,
  );
  const asked = [...new Set([...named('permission'), ...called('hasPermission')])].slice(0, 4);
  const permissionPool =
    asked.length === 0
      ? []
      : [
          ...new Set([
            ...asked,
            ...PERMISSION_RULES.filter(([permissions]) =>
              permissions.some((p) => asked.includes(p)),
            ).flatMap(([permissions]) => permissions),
          ]),
        ].slice(0, 6);
  const subsets = (pool: readonly string[]): string[][] =>
    Array.from({ length: 2 ** pool.length }, (_, mask) =>
      pool.filter((_, bit) => mask & (1 << bit)),
    );
  const rows: Situation[] = [];
  for (const type of types)
    for (const state of states)
      for (const facets of subsets(facetPool))
        for (const permissions of subsets(permissionPool))
          for (const groups of subsets(groupPool))
            rows.push({ type, state, facets, permissions, groups });
  return rows;
}

/** The rows where Web UI and the rule disagree, and whether the table could be read at all. */
export function truthTable(
  condition: Condition,
  rule: unknown,
): {
  readonly rows: number;
  readonly disagree: readonly Situation[];
  readonly unreadable: boolean;
} {
  const rows = situations(condition, literalsOf(rule));
  const disagree: Situation[] = [];
  for (const situation of rows) {
    const web = webUiPasses(condition, situation);
    const app = rulePasses(rule, situation);
    if (web === null || app === null) return { rows: rows.length, disagree, unreadable: true };
    if (web !== app) disagree.push(situation);
  }
  return { rows: rows.length, disagree, unreadable: false };
}

/**
 * The truth table of conditions that must all pass, as nested filters are, against one rule: the
 * situations of every value any of them tests, and Web UI passing only when each one does.
 */
export function chainTable(
  conditions: readonly Condition[],
  rule: unknown,
): {
  readonly rows: number;
  readonly disagree: readonly Situation[];
  readonly unreadable: boolean;
} {
  if (conditions.length === 1) return truthTable(conditions[0], rule);
  const merged: Record<string, string> = {};
  for (const condition of conditions)
    for (const [name, value] of Object.entries(condition.attributes))
      merged[name] = merged[name] ? `${merged[name]}, ${value}` : value;
  const rows = situations(
    { path: '', index: -1, element: 'nuxeo-filter', attributes: merged, parent: null },
    literalsOf(rule),
  );
  const disagree: Situation[] = [];
  for (const situation of rows) {
    const results = conditions.map((condition) => webUiPasses(condition, situation));
    const app = rulePasses(rule, situation);
    if (results.includes(null) || app === null)
      return { rows: rows.length, disagree, unreadable: true };
    if (results.every(Boolean) !== app) disagree.push(situation);
  }
  return { rows: rows.length, disagree, unreadable: false };
}

/** The values a rule tests, by dimension. */
interface RuleValues {
  readonly types: readonly string[];
  readonly facets: readonly string[];
  readonly states: readonly string[];
  readonly groups: readonly string[];
}

const NO_VALUES: RuleValues = { types: [], facets: [], states: [], groups: [] };

/** The values a rule names, at any depth, each in the dimension its rule tests. */
function literalsOf(rule: unknown): RuleValues {
  const found = {
    types: [] as string[],
    facets: [] as string[],
    states: [] as string[],
    groups: [] as string[],
  };
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    const { type, parameters } = value as { type?: unknown; parameters?: unknown };
    const list = Array.isArray(parameters) ? parameters : [];
    const texts = list.filter((item): item is string => typeof item === 'string');
    if (type === 'app.rules.isType') found.types.push(...texts);
    else if (type === 'app.rules.hasFacet') found.facets.push(...texts);
    else if (type === 'app.rules.inState') found.states.push(...texts);
    else if (type === 'app.rules.inGroup') found.groups.push(...texts);
    else list.forEach(visit);
  };
  visit(rule);
  return found;
}

/** A row of a truth table, for a finding. */
export function describeSituation(situation: Situation): string {
  const parts = [
    situation.type === OTHER ? null : `type ${situation.type}`,
    situation.state === OTHER ? null : `state ${situation.state}`,
    situation.facets.length ? `facets ${situation.facets.join(', ')}` : null,
    situation.permissions.length ? `permissions ${situation.permissions.join(', ')}` : null,
    situation.groups.length ? `groups ${situation.groups.join(', ')}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join('; ') : 'none of the values it tests';
}
