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
 * **JavaScript.** A `dom-if`'s `if` and a filter's `expression` are code, and one in a known
 * pattern is proposed as its rule: section 3 leaves it for a person to accept. Anything else is
 * reported.
 *
 * - **A `dom-if`'s `if`** is a Polymer binding (`property-effects.js`): `[[…]]` or `{{…}}` around
 *   one path or one call, optionally negated with `!`, and nothing else in the attribute. One call
 *   of a filter function, such as `[[hasFacet(document, 'X')]]`, is a known pattern. Text around
 *   the binding, even spacing, makes it a compound binding, whose value is a string; `&&`, `||` and
 *   a method of a value are no binding, and the text stays as it is. Either way `if` is a
 *   non-empty string, which is true, so Web UI always shows what the `dom-if` holds. With no `if`
 *   at all, it shows nothing.
 * - **A filter's `expression`** runs as `return <expression>` with `this` the filter: `this.`
 *   calls of the filter functions above, and `document.facets.indexOf('X') !== -1` or
 *   `document.facets.includes('X')`, each optionally negated with `!`, joined by `&&` or by `||`.
 *   `!` before `indexOf` applies to its result, before the comparison, so that is always true.
 *
 * **Truth tables.** Both readings are implemented here, each from its own source, and
 * `truthTable` runs them over every combination of the values a condition tests and one value it
 * does not. They must agree on every row. This is the half of check 5 that needs no server: it
 * proves the mapping against the two sources as written. The other half evaluates the original
 * in Web UI itself, on the migration server, and has not run.
 */
import { MAX_NESTING } from '@agentic-ui/shared/app-definition';

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

/**
 * Why a permission test means nothing in a task layout, or in a block one uses: Web UI's task page
 * fetches the task's target without its permissions.
 */
export const TASK_PERMISSIONS =
  "It tests a permission of the document, which Web UI's task page fetches as the task's target without its permissions (nuxeo-app.js, fetch-task: targetDocumentIds), so the test never passes there: a mistake to fix, not to copy";

/** The registered rules that read the record's permissions. */
const PERMISSION_RULE_IDS = new Set(PERMISSION_RULES.map(([, rule]) => rule));

/**
 * True when a rule, or one it joins, reads the record's permissions. A rule is read as deep as
 * {@link MAX_NESTING} levels, the rule itself being the first, as the validator reads it: one
 * nested further reads none here, and its truth table cannot be read (`rulePasses`).
 */
export function readsPermissions(rule: unknown, level = 1): boolean {
  if (level > MAX_NESTING) return false;
  if (typeof rule === 'string') return PERMISSION_RULE_IDS.has(rule);
  if (typeof rule !== 'object' || rule === null) return false;
  const { type, parameters } = rule as { type?: unknown; parameters?: unknown };
  return (
    (typeof type === 'string' && PERMISSION_RULE_IDS.has(type)) ||
    (Array.isArray(parameters) && parameters.some((inner) => readsPermissions(inner, level + 1)))
  );
}

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

/**
 * A Polymer binding of `dom-if`'s `if`, and nothing else: `[[` or `{{`, a property path or one
 * computed call, either negated with `!`, and `]]` or `}}` (`property-effects.js`, whose brackets
 * need not pair). Anything around it, spacing included, makes the binding compound, a string.
 */
const POLYMER_CALL = /^(?:\[\[|\{\{)\s*(!?)\s*([a-zA-Z_$][\w.:$*-]*)\(([^()]*)\)\s*(?:\]\]|\}\})$/;
/** A method name Polymer looks up on the host as it is: `this.hasType` is no method there. */
const NAMED = /^\w+$/;
const POLYMER_PATH = /^(?:\[\[|\{\{)\s*!?\s*[\w.:$*-]+\s*(?:\]\]|\}\})$/;

/**
 * What a condition of a package becomes. A rule whose truth table is too large to run is reported
 * rather than written, since nothing could hold it to the condition.
 */
export function decideCondition(condition: Condition): ConditionDecision {
  const proposal = proposalOf(condition);
  // A rule proposed for a known JavaScript pattern is written only once a person accepts it, and
  // only the rule they accepted: one they rejected is reported, and one they decided on another
  // rule than the converter proposes now is no decision of this one.
  const verdict = condition.verdict;
  if (proposal.kind !== 'proposed' || !verdict || !sameRule(verdict.rule, proposal.rule))
    return proposal;
  return verdict.accepted
    ? { kind: 'rule', rule: proposal.rule, document: proposal.document }
    : {
        kind: 'reported',
        note: `${REJECTED} ${JSON.stringify(proposal.rule)}, so nothing it guards is written under it`,
      };
}

/** How a rejected proposal's condition is reported, before the rule a person rejected. */
export const REJECTED = 'A person rejected the rule proposed for it,';

/** Whether two rules are the same, whatever the order of an object's keys. */
export function sameRule(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
          )
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * What a condition becomes as the converter reads it, before any person's decision: its rule, its
 * rule proposed, or why it is reported.
 */
export function proposalOf(condition: Condition): ConditionDecision {
  const decision = decideOnce(condition);
  if (decision.kind === 'reported') return decision;
  // A task layout's document is the task's target as Web UI's task page fetches it, without its
  // permissions (nuxeo-app.js, `fetch-task: targetDocumentIds`, no permissions enricher).
  if (condition.permissionsInScope === false && readsPermissions(decision.rule))
    return {
      kind: 'reported',
      note: TASK_PERMISSIONS,
    };
  const rows = tableSize([condition], decision.rule);
  return rows > MAX_ROWS
    ? {
        kind: 'reported',
        note: `Its truth table would run ${rows} rows, more than the ${MAX_ROWS} one runs, so its rule could not be held to it: a person checks it`,
      }
    : decision;
}

function decideOnce(condition: Condition): ConditionDecision {
  if (condition.element !== 'nuxeo-filter') {
    const given = own(condition.attributes, 'if');
    // `if` is false until something sets it.
    if (given === undefined)
      return {
        kind: 'reported',
        note: 'It has no `if`, so Web UI never shows what it holds: a mistake to fix, not to copy',
      };
    const test = given;
    const call = POLYMER_CALL.exec(test);
    if (!call) {
      return POLYMER_PATH.test(test)
        ? {
            kind: 'reported',
            note: `Its \`if\`, ${test}, reads a property of the page, which a person maps`,
          }
        : {
            kind: 'reported',
            note: `Its \`if\`, ${JSON.stringify(test)}, is no single Polymer binding, so it is a string, and Web UI always shows what it holds: a mistake to fix, not to copy`,
          };
    }
    if (!NAMED.test(call[2]))
      return {
        kind: 'reported',
        note: `Its \`if\`, ${test}, calls ${call[2]}, which the host has no method of that name for, so its value is undefined, and Web UI never shows what it holds: a mistake to fix, not to copy`,
      };
    const parsed = parseExpression(`${call[1]}${call[2]}(${call[3]})`, { bare: true });
    if ('problem' in parsed)
      return {
        kind: 'reported',
        note: `Its \`if\`, ${test}, is free JavaScript in no known pattern: ${parsed.problem}`,
      };
    if (parsed.user && !condition.userInScope)
      return {
        kind: 'reported',
        note: `Its \`if\`, ${test}, reads a user its file is not given, so it never passes in Web UI: a mistake to fix, not to copy`,
      };
    return {
      kind: 'proposed',
      rule: parsed.rule,
      document: parsed.document,
      note: `Its \`if\`, ${test}, calls a filter function of the layout's host: the rule ${JSON.stringify(parsed.rule)} is proposed, for a person to accept, once they have seen the host has the function (section 3)`,
    };
  }
  const attributes = condition.attributes;
  const rules: Rule[] = [];
  let document = false;
  let user = false;
  let proposed: string | null = null;
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'document' || name === 'user' || value === '') continue;
    // Web UI tests a value of spacing alone, as the empty name, which nothing has.
    if (value.trim() === '' && name !== 'expression')
      return {
        kind: 'reported',
        note: `Its ${name} test is blank, so it never passes in Web UI: a mistake to fix, not to copy`,
      };
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
      case 'expression': {
        // Run as \`return <expression>\` with \`this\` the filter: its functions are \`this.\`'s.
        const parsed = parseExpression(value, { bare: false });
        if ('problem' in parsed)
          return {
            kind: 'reported',
            note: `Its expression, ${value}, is free JavaScript in no known pattern: ${parsed.problem}`,
          };
        rules.push(parsed.rule);
        document ||= parsed.document;
        user ||= parsed.user;
        proposed = `Its expression, ${value}, is free JavaScript in a known pattern`;
        break;
      }
      default:
        return {
          kind: 'reported',
          note: `Its ${name} test has no registered rule${name === 'path' ? ': no rule reads a path' : name === 'schema' ? ': no rule reads a schema' : ''}`,
        };
    }
  }
  // Web UI reads the filter's own \`document\` and \`user\`; a rule reads the open record and the
  // signed-in user. They agree only when the filter is given those.
  const documentBinding = BOUND.exec(own(attributes, 'document') ?? '')?.[1];
  if (document && documentBinding !== 'document')
    return {
      kind: 'reported',
      note: `It tests ${own(attributes, 'document') ? `the document ${own(attributes, 'document')}` : 'a document it is not given'}, where a rule reads the open record`,
    };
  const userBinding = BOUND.exec(own(attributes, 'user') ?? '')?.[1];
  if (user && (userBinding !== 'user' || !condition.userInScope))
    return {
      kind: 'reported',
      note:
        userBinding === 'user'
          ? 'Its group test is given [[user]], which its file does not hold, so it never passes in Web UI: a mistake to fix, not to copy'
          : 'Its group test is given no user, so it never passes in Web UI: a mistake to fix, not to copy',
    };
  const rule: Rule = rules.length === 0 ? 'core.true' : every(rules);
  if (proposed !== null)
    return {
      kind: 'proposed',
      rule,
      document,
      note: `${proposed}: the rule ${JSON.stringify(rule)} is proposed, for a person to accept (section 3)`,
    };
  return { kind: 'rule', rule, document };
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
  /^(!?)\s*(this\.)?(hasType|hasFacet|hasState|isMember|hasPermission)\(\s*(document|user)\s*,\s*(['"])([^'"]+)\5\s*\)$/;
const FACETS =
  /^(!?)\s*document\.facets\.(?:indexOf\(\s*(['"])([^'"]+)\2\s*\)\s*(!==\s*-1|>=\s*0|>\s*-1)|includes\(\s*(['"])([^'"]+)\5\s*\))$/;
/** True for `!document.facets.indexOf(…) !== -1`: `!` turns the index into a boolean first. */
const negatesIndex = (facets: RegExpExecArray): boolean =>
  facets[1] === '!' && facets[3] !== undefined;

/**
 * A known pattern's rule, or why it is none. `bare` is a Polymer binding's call, of the host's
 * method by its name, alone; otherwise it is a filter's `expression`, run as JavaScript with `this`
 * the filter, so a filter function is `this.`'s and terms may be joined by `&&` or `||`.
 */
export function parseExpression(
  source: string,
  options: { readonly bare: boolean },
): { rule: Rule; document: boolean; user: boolean } | { problem: string } {
  const text = source.trim();
  const and = text.includes('&&');
  const or = text.includes('||');
  if (options.bare && (and || or)) return { problem: 'a binding holds one call' };
  // Each part must be one known term whole, so grouping in parentheses is none.
  if (and && or) return { problem: 'it mixes && and ||' };
  const parts = text.split(and ? '&&' : '||').map((part) => part.trim());
  const rules: Rule[] = [];
  let document = false;
  let user = false;
  for (const part of parts) {
    const call = TERM.exec(part);
    const facets = call || options.bare ? null : FACETS.exec(part);
    let rule: Rule | null = null;
    let negated = false;
    if (call) {
      if (options.bare && call[2])
        return { problem: "a binding calls the host's method by its name" };
      if (!options.bare && !call[2])
        return {
          problem: `${call[3]} is called without this., which throws, so it never passes in Web UI`,
        };
      const known = CALLS[call[3]];
      if (known.on !== call[4]) return { problem: `${call[3]} is called on ${call[4]}` };
      rule = known.rule(call[6]);
      if (rule === null)
        return { problem: `no registered rule tests the permission ${call[6]} alone` };
      negated = call[1] === '!';
      document ||= known.on === 'document';
      user ||= known.on === 'user';
    } else if (facets) {
      if (negatesIndex(facets))
        return {
          problem: `"${part}" applies ! to indexOf's result, before the comparison, so it is always true`,
        };
      rule = { type: 'app.rules.hasFacet', parameters: [facets[3] ?? facets[6]] };
      negated = facets[1] === '!';
      document = true;
    } else return { problem: `"${part}" is none` };
    rules.push(negated ? { type: 'core.not', parameters: [rule] } : rule);
  }
  if (rules.length === 1) return { rule: rules[0], document, user };
  return { rule: { type: or ? 'core.some' : 'core.every', parameters: rules }, document, user };
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
    const test = own(condition.attributes, 'if');
    if (test === undefined) return false;
    const call = POLYMER_CALL.exec(test);
    // Not one binding alone: the text, or a compound binding's string, which is always true.
    if (!call) return POLYMER_PATH.test(test) ? null : true;
    // A name the host has no method under leaves the value undefined: false.
    if (!NAMED.test(call[2])) return false;
    return webUiExpression(`${call[1]}${call[2]}(${call[3]})`, situation, true);
  }
  for (const [name, value] of Object.entries(condition.attributes)) {
    if (name === 'document' || name === 'user' || !value) continue;
    // `expression` is one value; every other test takes comma-separated ones.
    const list = name === 'expression' ? [value] : values(value);
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
        case 'expression':
          return webUiExpression(value, situation, false);
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

function webUiExpression(source: string, situation: Situation, bare: boolean): boolean | null {
  const text = source.trim();
  const or = text.includes('||');
  const parts = text.split(or ? '||' : '&&').map((part) => part.trim());
  const results = parts.map((part): boolean | null => {
    const call = TERM.exec(part);
    if (call) {
      // A filter's expression without `this.` throws, and the filter does not pass.
      if (!bare && !call[2]) return false;
      const value = call[6];
      const result =
        call[3] === 'hasType'
          ? situation.type === value
          : call[3] === 'hasFacet'
            ? situation.facets.includes(value)
            : call[3] === 'hasState'
              ? situation.state === value
              : call[3] === 'isMember'
                ? situation.groups.includes(value)
                : situation.permissions.includes(value);
      return call[1] === '!' ? !result : result;
    }
    const facets = bare ? null : FACETS.exec(part);
    if (facets) {
      // `(!index) !== -1`, `>= 0` or `> -1`: a boolean, so always true.
      if (negatesIndex(facets)) return true;
      const result = situation.facets.includes(facets[3] ?? facets[6]);
      return facets[1] === '!' ? !result : result;
    }
    return null;
  });
  if (results.includes(null)) return null;
  return or ? results.some(Boolean) : results.every(Boolean);
}

/**
 * The app's reading of a rule: the registered rules' evaluators, for the rules M2 writes. `null`,
 * as for a rule it does not know, for one nested deeper than {@link MAX_NESTING} levels, the rule
 * itself being the first: JSON can nest further than this walk has stack for.
 */
export function rulePasses(rule: unknown, situation: Situation, level = 1): boolean | null {
  if (level > MAX_NESTING) return null;
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
      const results = list.map((inner) => rulePasses(inner, situation, level + 1));
      if (results.includes(null)) return null;
      if (type === 'core.every') return results.every(Boolean);
      if (type === 'core.some') return results.some(Boolean);
      // `core.not` is NOR: true when every nested rule is false.
      return results.every((result) => !result);
    }
    default:
      return rulePasses(type, situation, level);
  }
}

const OTHER = '~other';

/** The most rows a truth table runs; past it the table is not run, and says so. */
export const MAX_ROWS = 200_000;

/**
 * Every situation that tells a condition's tests apart, and the rule's: for each dimension either
 * tests, each value named and one that is not, or every subset of the facets, permissions and
 * groups named, with the permissions of every permission rule the rule or the condition names. A
 * dimension neither tests is held to one value. Nothing is left out to fit: a table too large to
 * run in full is `null`, and the check says it could not be read.
 */
export function situations(
  condition: Condition,
  extra: RuleValues = NO_VALUES,
): Situation[] | null {
  const { types, states, facetPool, groupPool, permissionPool, size } = poolsOf(condition, extra);
  if (size > MAX_ROWS) return null;
  const subsets = (list: readonly string[]): string[][] =>
    Array.from({ length: 2 ** list.length }, (_, mask) =>
      list.filter((_, bit) => mask & (1 << bit)),
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

/** How many rows the truth table of conditions that must all pass, against a rule, runs. */
export function tableSize(conditions: readonly Condition[], rule: unknown): number {
  return poolsOf(merged(conditions), literalsOf(rule)).size;
}

/** The values of each dimension a table runs, and how many rows they make. */
function poolsOf(condition: Condition, extra: RuleValues) {
  const named = (attribute: string): string[] => values(own(condition.attributes, attribute) ?? '');
  const expression = `${own(condition.attributes, 'if') ?? ''} ${own(condition.attributes, 'expression') ?? ''}`;
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
  const pool = (...lists: (readonly string[])[]): string[] => [...new Set(lists.flat())];
  const types = [...pool(named('type'), called('hasType'), extra.types), OTHER];
  const states = [...pool(named('state'), called('hasState'), extra.states), OTHER];
  const facetPool = pool(named('facet'), facetLiterals, extra.facets);
  const groupPool = pool(named('group'), called('isMember'), extra.groups);
  const asked = pool(named('permission'), called('hasPermission'), extra.permissions);
  const permissionPool = pool(
    asked,
    PERMISSION_RULES.filter(([permissions]) => permissions.some((p) => asked.includes(p))).flatMap(
      ([permissions]) => permissions,
    ),
  );
  const size =
    types.length *
    states.length *
    2 ** (facetPool.length + groupPool.length + permissionPool.length);
  return { types, states, facetPool, groupPool, permissionPool, size };
}

/** Conditions that must all pass, as one filter of all their tests, for their table's values. */
function merged(conditions: readonly Condition[]): Condition {
  if (conditions.length === 1) return conditions[0];
  const attributes: Record<string, string> = {};
  for (const condition of conditions)
    for (const [name, value] of Object.entries(condition.attributes))
      attributes[name] = attributes[name] ? `${attributes[name]}, ${value}` : value;
  return {
    path: '',
    index: -1,
    element: 'nuxeo-filter',
    attributes,
    parent: null,
    userInScope: true,
  };
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
  if (rows === null) return { rows: 0, disagree: [], unreadable: true };
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
  const rows = situations(merged(conditions), literalsOf(rule));
  if (rows === null) return { rows: 0, disagree: [], unreadable: true };
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
  /** The permissions of the permission rules it names. */
  readonly permissions: readonly string[];
}

const NO_VALUES: RuleValues = { types: [], facets: [], states: [], groups: [], permissions: [] };

/**
 * The values a rule names, as deep as {@link MAX_NESTING} levels, each in the dimension its rule
 * tests. A rule nested further is one `rulePasses` cannot read, so its table is unreadable whatever
 * values are found here.
 */
function literalsOf(rule: unknown): RuleValues {
  const found = {
    types: [] as string[],
    facets: [] as string[],
    states: [] as string[],
    groups: [] as string[],
    permissions: [] as string[],
  };
  const visit = (value: unknown, level: number): void => {
    if (level > MAX_NESTING) return;
    // A permission rule, by its id: its permissions are rows of the table too.
    if (typeof value === 'string') {
      for (const [permissions, id] of PERMISSION_RULES)
        if (id === value) found.permissions.push(...permissions);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const { type, parameters } = value as { type?: unknown; parameters?: unknown };
    const list = Array.isArray(parameters) ? parameters : [];
    const texts = list.filter((item): item is string => typeof item === 'string');
    // A permission rule written as an object, `{ "type": "app.rules.canWrite" }`, is the same rule.
    if (typeof type === 'string') visit(type, level);
    if (type === 'app.rules.isType') found.types.push(...texts);
    else if (type === 'app.rules.hasFacet') found.facets.push(...texts);
    else if (type === 'app.rules.inState') found.states.push(...texts);
    else if (type === 'app.rules.inGroup') found.groups.push(...texts);
    else list.forEach((inner) => visit(inner, level + 1));
  };
  visit(rule, 1);
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
