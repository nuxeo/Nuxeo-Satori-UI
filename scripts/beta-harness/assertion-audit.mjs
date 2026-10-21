#!/usr/bin/env node
/**
 * Static audit of evidence assertions.
 *
 * This is the mechanical half of independent validation. It exists because the
 * most expensive failure in this programme was not a broken gate — it was gates
 * that were green while the thing they guarded was broken:
 *
 *   - a check that compared `"main.js"` to `"main.js"` and "would have passed after
 *     a full rebuild with entirely different bytes";
 *   - a check the Phase 1 review called "tautological… It could not fail — and
 *     notably it did not catch defect 1, which is precisely the failure it appeared
 *     to guard";
 *   - `h.check('authenticated surfaces are NOT covered', true, …)`, which inflated
 *     a total while certifying nothing.
 *
 * All three are detectable without running anything. A check whose condition is a
 * constant, or whose two sides are the same expression, cannot fail — so it is not
 * evidence, and counting it as evidence is what let a dead feature reach sign-off.
 *
 * What this CANNOT do, stated narrowly on purpose because the constant-condition
 * rule has been wrong four times by claiming more reach than it had:
 *
 *   - It does not decide every constant. It decides whether a condition's whole
 *     expression tree is literals and pure operators over them — "constant by
 *     construction" — and returns unknown for anything needing a call or a
 *     property read to see. `DECLARED_LIMITS` lists that territory and is printed
 *     on every run, pass or fail. See `classify` for why enumerating truthiness
 *     was abandoned.
 *   - It does not judge whether a falsifiable assertion asserts the *right* thing.
 *     `expectVisible('app shell')` can fail, so it passes this audit, and it still
 *     only proves the app booted. That judgement is a reviewer's job — see
 *     `AGENTS/12-review-agents.md`. This tool removes the mechanical excuses.
 *
 * Usage:
 *   node scripts/beta-harness/assertion-audit.mjs [--json] [paths...]
 *
 * Defaults to auditing `scripts/beta-harness/steps/` and the whole of
 * `scripts/collect-evidence/`, if they exist. This said `scripts/collect-evidence/steps/`
 * — a path that does not exist — after the default was widened, so the documented scope
 * was both wrong and narrower than the 42 files the audit actually reads.
 *
 * Exit 1 if any assertion cannot fail. Warnings alone do not fail the audit.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { relative, resolve, extname } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const explicit = argv.filter((a) => !a.startsWith('--'));

let parse;
try {
  ({ parse } = await import('acorn'));
} catch {
  console.error(
    'assertion-audit: acorn is unavailable, so assertions cannot be parsed.\n' +
      'It ships with eslint, so this normally means node_modules is incomplete. Run `npm ci`.\n' +
      'Refusing to report a pass on an audit that did not run.',
  );
  process.exit(1);
}

/** Assertion helpers whose second argument is the condition under test. */
const CONDITION_AT_1 = new Set(['check', 'requirePrecondition']);
/** Helpers that assert against the live page — always falsifiable by construction. */
const PAGE_ASSERTIONS = new Set(['expectVisible', 'expectText', 'expectNoConsoleErrors', 'expectNoA11yViolations']);
/** Expression forms that evaluate to a fresh object, so they are truthy whatever they contain. */
const ALWAYS_TRUTHY = {
  ObjectExpression: 'an object literal',
  ArrayExpression: 'an array literal',
  FunctionExpression: 'a function expression',
  ArrowFunctionExpression: 'an arrow function',
  ClassExpression: 'a class expression',
  // `new X()` evaluates to an object whatever the constructor does — a primitive `return` is
  // discarded by `new`. So `if (new Date()) h.check('x', false)` is `if (true)`, and without
  // this entry it read as a real guard and exempted the unconditional check beneath it.
  NewExpression: 'a constructor call, which always yields an object',
};

/**
 * The boundary of the constant-condition rule, printed on every run.
 *
 * The rule decides one question — whether a condition reads anything the run can change —
 * and there is a large class of constants it deliberately does not decide. That class is
 * stated here rather than left implied, because this rule has been wrong four times by
 * claiming reach it did not have, and a check that overstates itself is worse than a
 * narrower one that is honest: people trust the overstatement. Same treatment the e2e
 * negative control got for the same reason. See `classify`.
 */
const DECLARED_LIMITS = [
  'a call that always returns the same value — `check(n, alwaysTrue())`, `if (alwaysTrue())`',
  'a property read that never varies — `CONFIG.enabled`, an imported constant',
  'a name declared twice or reassigned, which this file resolves to no value on purpose',
  'whether a falsifiable assertion asserts the RIGHT thing — that is a reviewer’s job',
];

const files = explicit.length ? explicit.map((p) => resolve(process.cwd(), p)) : await defaultTargets();

if (files.length === 0) {
  console.error('assertion-audit: no steps files found. An audit that inspects nothing is not a pass.');
  process.exit(1);
}

/** @type {{ file: string, line: number, kind: string, severity: 'fail'|'warn', message: string }[]} */
const findings = [];
let totalAssertions = 0;
let constantAssertions = 0;
const allowlists = [];
const guardedFailures = [];

for (const file of files) {
  const src = await readFile(file, 'utf8');
  const inRepo = relative(repoRoot, file);
  const rel = inRepo.startsWith('..') ? file : inRepo;
  let ast;
  try {
    ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (err) {
    findings.push({
      file: rel,
      line: 0,
      kind: 'unparseable',
      severity: 'fail',
      message: `could not be parsed, so its assertions are unverified: ${err instanceof Error ? err.message : err}`,
    });
    continue;
  }
  auditFile(rel, src, ast);
}

report();

const failures = findings.filter((f) => f.severity === 'fail');
process.exit(failures.length ? 1 : 0);

/**
 * @param {string} rel
 * @param {string} src
 * @param {object} ast
 */
function auditFile(rel, src, ast) {
  // Identifiers bound to a literal in this file, so `const ok = true; check(n, ok)`
  // is caught as well as the direct form.
  /** @type {Map<string, unknown>} */
  const literalBindings = new Map();
  /** Array literals, so a shared `ENVIRONMENTAL_ERRORS` const resolves to its patterns. */
  const arrayBindings = new Map();
  /** Names bound to something truthy by construction, so `if (name)` cannot be false. */
  const truthyBindings = new Map();
  /**
   * Names this file cannot resolve to one value, which are therefore resolved to NONE of them.
   *
   * These maps are keyed by identifier text for the whole file, with no lexical scope. That is
   * fine while a name is declared once and never written to, and wrong the moment it is not:
   * two functions each declaring `guard`, or `let guard = {}; guard = runtimeValue`, would let
   * one declaration classify the other's reference. The direction of that error is the bad one
   * — it makes the audit *reject* a genuinely conditional check on the strength of an unrelated
   * binding.
   *
   * Rather than claim scope analysis this walker does not do, an ambiguous name is dropped from
   * every map and classifies as unknown. That is the conservative direction: the worst case is
   * that one shadowed or reassigned name keeps the laundering hole the maps exist to close,
   * instead of a valid check being reported as unfalsifiable.
   */
  const declaredCount = new Map();
  const reassigned = new Set();
  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      declaredCount.set(node.id.name, (declaredCount.get(node.id.name) ?? 0) + 1);
    }
    // A parameter shadows an outer binding just as effectively as a second declaration.
    if (Array.isArray(node.params)) {
      for (const param of node.params) {
        if (param?.type === 'Identifier') {
          declaredCount.set(param.name, (declaredCount.get(param.name) ?? 0) + 1);
        }
      }
    }
    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier') {
      reassigned.add(node.left.name);
    }
    if (node.type === 'UpdateExpression' && node.argument?.type === 'Identifier') {
      reassigned.add(node.argument.name);
    }
  });
  const ambiguous = (name) => (declaredCount.get(name) ?? 0) > 1 || reassigned.has(name);

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier') return;
    if (ambiguous(node.id.name)) return;
    if (node.init?.type === 'Literal') literalBindings.set(node.id.name, node.init.value);
    // `const guard = {}` is `const guard = true` for the purposes of `if (guard)`. Only the
    // literal initialisers were recorded, so an identifier bound to an object, array, function
    // or `new` read as unknown and `guardedBy` accepted it as a real condition.
    if (node.init && ALWAYS_TRUTHY[node.init.type]) {
      truthyBindings.set(node.id.name, ALWAYS_TRUTHY[node.init.type]);
    }
    if (node.init?.type === 'ArrayExpression') {
      arrayBindings.set(
        node.id.name,
        node.init.elements.map((e) => text(src, e)),
      );
    }
  });

  /** Steps, so a step that photographs without asserting can be spotted. */
  const steps = [];
  let current = null;

  const parents = parentMap(ast);

  // The identity guard judges the previous step at `h.step(...)`, and `.then()` timing cannot tell
  // an `await` from a discarded `Promise.all([h.step(...)])`. So the one accepted form is a
  // statement that awaits the call itself; any other reference, alias or destructuring is refused.
  // Not in `scripts/collect-evidence/`: the story runner opens steps without the identity guard.
  const guarded = !rel.startsWith('scripts/collect-evidence/');
  walk(ast, (node) => {
    if (!guarded) return;
    const isMember = node.type === 'MemberExpression' && memberName(node) === 'step';
    const isPattern =
      node.type === 'Property' &&
      parents.get(node)?.type === 'ObjectPattern' &&
      memberName({ ...node, property: node.key }) === 'step';
    if (!isMember && !isPattern) return;
    const call = parents.get(node);
    const awaited = call && parents.get(call);
    if (
      isMember &&
      call?.type === 'CallExpression' &&
      call.callee === node &&
      awaited?.type === 'AwaitExpression' &&
      parents.get(awaited)?.type === 'ExpressionStatement'
    ) {
      return;
    }
    const shown = text(src, isMember && call?.type === 'CallExpression' ? call : node).replace(/\s+/g, ' ');
    findings.push({
      file: rel,
      line: node.loc?.start.line ?? 0,
      kind: 'unawaited-step',
      severity: 'fail',
      message:
        `\`${shown.length > 60 ? `${shown.slice(0, 57)}...` : shown}\` is not \`await h.step(...);\`. ` +
        'The identity guard judges the previous step there, and only awaiting the call itself waits for it.',
    });
  });

  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const name = calleeName(node);
    if (!name) return;
    const line = node.loc?.start.line ?? 0;

    if (name === 'step') {
      current = { line, label: literalText(node.arguments[0]) ?? '(computed)', assertions: 0, shots: 0 };
      steps.push(current);
      return;
    }
    if (name === 'screenshot') {
      if (current) current.shots += 1;
      return;
    }
    if (name === 'note') return; // deliberately not an assertion

    if (PAGE_ASSERTIONS.has(name)) {
      totalAssertions += 1;
      if (current) current.assertions += 1;
      if (name === 'expectNoConsoleErrors') collectAllowlist(rel, src, node, line, arrayBindings);
      return;
    }

    if (!CONDITION_AT_1.has(name)) return;

    totalAssertions += 1;
    if (current) current.assertions += 1;

    const condition = node.arguments[1];
    const label = literalText(node.arguments[0]) ?? '(computed name)';
    if (!condition) {
      findings.push({
        file: rel,
        line,
        kind: 'no-condition',
        severity: 'fail',
        message: `\`${name}("${label}")\` has no condition, so it always passes.`,
      });
      constantAssertions += 1;
      return;
    }

    const verdict = classify(condition, src, literalBindings, truthyBindings);
    if (!verdict) return;

    // `if (!scene.criterion) check('scene names an acceptance criterion', false, …)` is the
    // deliberate report-this-as-failed idiom: the literal `false` is the verdict and the
    // enclosing `if` is the assertion. Reported as a constant, the idiom's only escape was to
    // stop making the claim, so it was recorded instead — and a gate nobody can satisfy is one
    // that gets suppressed. The guard is still listed below, because an exemption nobody has
    // to look at is how a real one hides.
    const guard = guardedBy(node, parents, src, literalBindings, truthyBindings);
    if (verdict.kind === 'literal-false' && guard) {
      guardedFailures.push({ file: rel, line, label, guard });
      return;
    }

    constantAssertions += 1;
    findings.push({
      file: rel,
      line,
      kind: verdict.kind,
      severity: 'fail',
      // `verdict.soWhat` exists because the blanket "it cannot fail" is untrue of half of
      // what this rule now reports: `check(n, 1 - 1)` is constant and always FAILS. Saying
      // "cannot fail" there would be the same overstatement this round exists to remove.
      message: `\`${name}("${label}")\` ${verdict.why}. ${verdict.soWhat ?? 'It cannot fail, so it is not evidence.'}`,
    });
  });

  for (const s of steps) {
    if (s.shots > 0 && s.assertions === 0) {
      findings.push({
        file: rel,
        line: s.line,
        kind: 'screenshot-without-assertion',
        severity: 'warn',
        message: `step "${s.label}" captures ${s.shots} screenshot(s) and asserts nothing. A photograph is not a claim.`,
      });
    }
  }
}

/**
 * Decide whether a condition expression's outcome is fixed before the run.
 *
 * ## What this decides, and what it refuses to
 *
 * This rule has been wrong four times in the same place, every time in the same direction:
 * it tried to answer *"is this expression always truthy?"*, discovered another spelling of
 * `true` it had not enumerated, and grew one more case. The spellings do not run out. After
 * the six always-truthy forms were closed, review found `if (1 + 1)`; probing the same hole
 * found seventeen more (`2 * 3`, `'a' + 'b'`, `5 > 3`, `typeof 1`, `void 0`, `~0`, `(1, 2)`,
 * `true ? 1 : 2`, `null ?? 7`, …). Enumerating truthiness is a game this cannot win.
 *
 * So it no longer plays it. The question it answers instead is narrower and decidable:
 *
 *   **Does this expression read anything the run can change?**
 *
 * An expression whose whole tree is literals, literal-bound identifiers and pure operators
 * over them is fixed at parse time. `1 + 1` and `1 - 1` are both settled before anything
 * executes — and it does not matter which is truthy, because either way the assertion's
 * outcome is the same on every run, which is precisely what disqualifies it as evidence.
 * That is decided structurally, by recursion over a closed whitelist of node types. Nothing
 * is evaluated: no constant folding, no `eval`, no `new Function`.
 *
 * **Declared boundary — what this does NOT catch.** Anything reading a runtime input is
 * returned as unknown and treated as a real condition, even when a human can see it is
 * constant. Specifically it does not catch a call that always returns the same value
 * (`check(n, alwaysTrue())`, `if (alwaysTrue())`), a property read that never varies
 * (`CONFIG.enabled`, an imported constant), or a name this file cannot resolve to one value
 * because it is declared twice or reassigned. Those are unclaimed territory, stated in the
 * audit's own output by `DECLARED_LIMITS` so nobody reads silence here as a clean bill.
 *
 * Unknown is the deliberate direction: the worse error is rejecting a genuinely conditional
 * check as unfalsifiable, which turns the gate into one nobody can satisfy.
 *
 * @param {object} node
 * @param {string} src
 * @param {Map<string, unknown>} bindings
 * @returns {{ kind: string, why: string, soWhat?: string } | null}
 */
function classify(node, src, bindings, truthyBindings = new Map()) {
  if (node.type === 'Literal') {
    // A regex literal is an object, so it is truthy whether or not the parser filled in
    // `value` — which it leaves null when the pattern uses a flag it cannot model.
    if (node.regex) return { kind: 'literal-true', why: `asserts the regex \`${text(src, node)}\`` };
    return node.value
      ? { kind: 'literal-true', why: `asserts the literal \`${JSON.stringify(node.value)}\`` }
      : { kind: 'literal-false', why: 'asserts a literal falsy value, so it always fails' };
  }

  // Expressions whose *syntax* makes them truthy. `if ({})` is `if (true)` in another
  // spelling, and so is `if (() => false)` — the arrow is an object, its body never runs.
  // Without these the guard exemption below launders precisely what `literal-false` exists
  // to catch: six of these seven shapes were verified to make an unconditional
  // `check(name, false)` exempt. See `assertion-audit.selftest.mjs`.
  const truthyByConstruction = ALWAYS_TRUTHY[node.type];
  if (truthyByConstruction) {
    return { kind: 'constant-truthy', why: `asserts ${truthyByConstruction}, which is always truthy` };
  }

  // A template with nothing to interpolate is a string literal written with backticks.
  // One that interpolates could be empty, so it is left alone.
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    const value = node.quasis.map((q) => q.value.cooked ?? '').join('');
    return value
      ? { kind: 'literal-true', why: `asserts the constant template \`${text(src, node)}\`` }
      : { kind: 'literal-false', why: 'asserts an empty template literal, so it always fails' };
  }

  // `!0`, `!!true`, `!''`
  if (node.type === 'UnaryExpression' && node.operator === '!') {
    const inner = classify(node.argument, src, bindings, truthyBindings);
    if (inner) return { kind: 'negated-constant', why: `negates a constant (\`${text(src, node)}\`)` };
  }

  if (node.type === 'Identifier' && truthyBindings.has(node.name)) {
    return {
      kind: 'constant-binding',
      why: `asserts \`${node.name}\`, bound to ${truthyBindings.get(node.name)}`,
    };
  }

  if (node.type === 'Identifier' && bindings.has(node.name)) {
    const v = bindings.get(node.name);
    return v
      ? { kind: 'constant-binding', why: `asserts \`${node.name}\`, bound to the literal \`${JSON.stringify(v)}\`` }
      : { kind: 'constant-binding', why: `asserts \`${node.name}\`, bound to a falsy literal` };
  }

  // `Boolean(true)`, `Boolean(1)`
  if (node.type === 'CallExpression' && calleeName(node) === 'Boolean' && node.arguments.length === 1) {
    const inner = classify(node.arguments[0], src, bindings, truthyBindings);
    if (inner) return { kind: 'boolean-of-constant', why: `wraps a constant (\`${text(src, node)}\`)` };
  }

  // The `"main.js" === "main.js"` shape: both sides are the same source text.
  if (node.type === 'BinaryExpression' && ['===', '==', '>=', '<='].includes(node.operator)) {
    const l = text(src, node.left);
    const r = text(src, node.right);
    if (normalise(l) === normalise(r)) {
      return { kind: 'self-comparison', why: `compares \`${l}\` to itself` };
    }
    // Two different literals compared — constant either way.
    if (node.left.type === 'Literal' && node.right.type === 'Literal') {
      return { kind: 'constant-comparison', why: `compares two literals (\`${l}\` ${node.operator} \`${r}\`)` };
    }
  }

  // `x.includes(x)`, `a.startsWith(a)`
  if (
    node.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    ['includes', 'startsWith', 'endsWith'].includes(node.callee.property?.name) &&
    node.arguments.length === 1
  ) {
    const recv = text(src, node.callee.object);
    const arg = text(src, node.arguments[0]);
    if (normalise(recv) === normalise(arg)) {
      return { kind: 'self-comparison', why: `checks whether \`${recv}\` contains itself` };
    }
  }

  // Last, because every rule above says something more specific about the same expression.
  // This is the catch-all for the spellings nobody enumerated: it does not ask what the
  // expression evaluates to, only whether anything the run does can change it.
  if (constantByConstruction(node, bindings)) {
    return {
      kind: 'constant-by-construction',
      why:
        `asserts \`${text(src, node).replace(/\s+/g, ' ')}\`, which is built only from literals ` +
        `and pure operators, so its value is fixed before the run`,
      // Deliberately not "it cannot fail": this rule does not evaluate, so it does not know
      // whether this one always passes or always fails. It knows the outcome is the same
      // every run, which is what disqualifies it either way.
      soWhat: 'Its outcome is identical on every run, so it is not evidence.',
    };
  }

  return null;
}

/**
 * Whether `node`'s value is settled at parse time because it reads no runtime input.
 *
 * Sound without evaluating anything: every accepted form is a pure operator over operands
 * that are themselves accepted, bottoming out at literals and identifiers this file has
 * resolved to a literal. No member reads, no calls, no `this`, no `await`, no assignment —
 * those are the runtime inputs whose absence is the whole claim. `instanceof` and `in` are
 * excluded because their right operand is an object, and a tagged template is excluded
 * because the tag is a function call.
 *
 * Returns false for anything not on the whitelist, which is the conservative direction: an
 * unrecognised form is treated as a real condition rather than reported as unfalsifiable.
 *
 * @param {object} node
 * @param {Map<string, unknown>} bindings identifiers resolved to a literal, non-ambiguous
 * @returns {boolean}
 */
function constantByConstruction(node, bindings) {
  if (!node || typeof node.type !== 'string') return false;
  const constant = (n) => constantByConstruction(n, bindings);

  switch (node.type) {
    case 'Literal':
      return true;
    case 'Identifier':
      // `undefined`/`NaN`/`Infinity` parse as identifiers, and `bindings` holds only names
      // this file resolved to a literal and saw declared exactly once.
      return bindings.has(node.name) || ['undefined', 'NaN', 'Infinity'].includes(node.name);
    case 'TemplateLiteral':
      return node.expressions.every(constant);
    case 'UnaryExpression':
      return ['!', '-', '+', '~', 'typeof', 'void'].includes(node.operator) && constant(node.argument);
    case 'BinaryExpression':
      return !['instanceof', 'in'].includes(node.operator) && constant(node.left) && constant(node.right);
    case 'LogicalExpression':
      return constant(node.left) && constant(node.right);
    case 'ConditionalExpression':
      return constant(node.test) && constant(node.consequent) && constant(node.alternate);
    case 'SequenceExpression':
      return node.expressions.every(constant);
    case 'ParenthesizedExpression':
      return constant(node.expression);
    default:
      return false;
  }
}

/**
 * The condition a `check(_, false)` exists to report, or `null` if there is not one.
 *
 * Narrow on purpose, in two directions, because the first cut of this was not and both
 * failures showed up the moment it was tested against a deliberate violation.
 *
 * It climbs only through wrappers that add nothing — `await`, an expression statement, a
 * `return`, and a block whose *sole* statement is the one it came from — and stops at the
 * first conditional. So `if (!scene.criterion) check(n, false)` qualifies, while a
 * `check(n, false)` buried among twenty other statements inside some outer `if` does not: the
 * enclosing block is doing plenty besides reporting, so the `if` is not this call's guard.
 * Climbing the whole ancestor chain made every statement inside a top-level `if (declarative)`
 * exempt, which is the rule relaxed until it passes.
 *
 * The guard's own test must also not be a constant, or `if (true) check(n, false)` would
 * launder precisely what `literal-false` exists to catch. "Constant" here means whatever
 * `classify` can decide, which since the fourth round is *constant by construction* rather
 * than a list of truthy spellings — so `if (1 + 1)` and `if (1 - 1)` are both refused. A
 * guard that calls a function or reads a property is still accepted at its word; that is
 * the declared limit, not an oversight, and `DECLARED_LIMITS` says so in the output.
 *
 * @param {object} node
 * @param {Map<object, object>} parents
 * @param {string} src
 * @param {Map<string, unknown>} bindings
 * @returns {string | null} the guard's source text, for the report
 */
function guardedBy(node, parents, src, bindings, truthyBindings = new Map()) {
  let child = node;
  let parent = parents.get(child);
  while (parent) {
    if (parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') {
      if (child !== parent.consequent && child !== parent.alternate) return null;
      return classify(parent.test, src, bindings, truthyBindings) ? null : text(src, parent.test);
    }
    if (parent.type === 'LogicalExpression') {
      if (child !== parent.right) return null;
      return classify(parent.left, src, bindings, truthyBindings) ? null : text(src, parent.left);
    }
    if (!isTransparentWrapper(parent, child)) return null;
    child = parent;
    parent = parents.get(child);
  }
  return null;
}

/** A node that neither guards nor accompanies its child — see `guardedBy`. */
function isTransparentWrapper(parent, child) {
  if (parent.type === 'AwaitExpression') return parent.argument === child;
  if (parent.type === 'ExpressionStatement') return parent.expression === child;
  if (parent.type === 'ReturnStatement') return parent.argument === child;
  if (parent.type === 'BlockStatement') return parent.body.length === 1 && parent.body[0] === child;
  return false;
}

/**
 * Child node -> its nearest node ancestor, so a finding can be read in the context that
 * reaches it. Arrays are traversed through rather than recorded, so an element's parent is
 * the node holding the array.
 *
 * @param {object} ast
 * @returns {Map<object, object>}
 */
function parentMap(ast) {
  const parents = new Map();
  const descend = (node, parent) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) descend(n, parent);
      return;
    }
    if (typeof node.type === 'string') {
      if (parent) parents.set(node, parent);
      parent = node;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue;
      descend(node[key], parent);
    }
  };
  descend(ast, null);
  return parents;
}

/**
 * Record every console-error suppression so they are visible in one place.
 * Not a failure — some are legitimately environmental — but a suppression that
 * nobody has to look at is how a real regression stays invisible.
 *
 * @param {string} rel
 * @param {string} src
 * @param {object} node
 * @param {number} line
 * @param {Map<string, string[]>} arrayBindings
 */
function collectAllowlist(rel, src, node, line, arrayBindings) {
  const arg = node.arguments[1];
  if (!arg) return;
  let patterns;
  if (arg.type === 'ArrayExpression') {
    patterns = arg.elements.map((e) => text(src, e));
  } else if (arg.type === 'Identifier' && arrayBindings.has(arg.name)) {
    // The real cases all hoist the list into a module-level const, and printing
    // the const's *name* would defeat the point of listing suppressions.
    patterns = arrayBindings.get(arg.name).map((p) => `${p}   (via ${arg.name})`);
  } else {
    patterns = [`${text(src, arg)}   (indirect — resolve by hand)`];
  }
  allowlists.push({ file: rel, line, patterns });
}

function report() {
  const fails = findings.filter((f) => f.severity === 'fail');
  const warns = findings.filter((f) => f.severity === 'warn');

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: fails.length === 0,
          filesAudited: files.length,
          totalAssertions,
          constantAssertions,
          findings,
          guardedFailures,
          consoleErrorAllowlists: allowlists,
          // Machine-visible for the same reason it is printed: a consumer reading `ok: true`
          // needs the boundary of that claim in the same payload.
          declaredLimits: DECLARED_LIMITS,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`\nAssertion audit — ${files.length} steps file(s), ${totalAssertions} assertion(s)\n`);

  for (const f of fails) {
    console.log(`  [FAIL] ${f.file}:${f.line}  (${f.kind})`);
    console.log(`         ${f.message}`);
  }
  for (const f of warns) {
    console.log(`  [warn] ${f.file}:${f.line}  (${f.kind})`);
    console.log(`         ${f.message}`);
  }

  if (guardedFailures.length) {
    console.log(
      '\n  Guarded failure reports — a literal `false` reached only when its guard holds,\n' +
        '  so the guard is the assertion. Listed because the exemption is real, and because\n' +
        '  a guard is only refused when it is constant BY CONSTRUCTION: a guard that calls a\n' +
        '  function or reads a property is taken at its word. Read these, do not skim them:',
    );
    for (const g of guardedFailures) {
      console.log(`    ${g.file}:${g.line}  "${g.label}"`);
      console.log(`      reached only when: ${g.guard.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }

  if (allowlists.length) {
    console.log('\n  Console-error suppressions in force — each one is a blind spot:');
    for (const a of allowlists) {
      console.log(`    ${a.file}:${a.line}`);
      for (const p of a.patterns) console.log(`      - ${p}`);
    }
  }

  console.log('');
  if (fails.length) {
    console.log(
      `assertion-audit: FAIL — ${fails.length} assertion(s) cannot fail. ` +
        `They inflate a check total while proving nothing; use h.note() for a stated limitation.`,
    );
  } else {
    console.log(
      `assertion-audit: pass — no assertion was shown to have a fixed outcome` +
        `${warns.length ? `, with ${warns.length} warning(s)` : ''}.`,
    );
  }

  // Printed on pass AND fail. On a pass it is the more important of the two, because that is
  // when the number above gets quoted as "every assertion is capable of failing" — which is
  // not what was measured. What was measured is the absence of a constant this rule can see.
  console.log('\n  NOT claimed by this audit — constants it does not decide:');
  for (const limit of DECLARED_LIMITS) console.log(`    - ${limit}`);
  console.log(
    '  A condition is reported only when its whole expression tree is literals and pure\n' +
      '  operators over them. Nothing here is evaluated, so any constant that needs a call\n' +
      '  or a property read to see is outside this rule and passes silently.',
  );
}

/* ---------- helpers ---------- */

/** @returns {Promise<string[]>} */
async function defaultTargets() {
  const dirs = [resolve(repoRoot, 'scripts/beta-harness/steps'), resolve(repoRoot, 'scripts/collect-evidence')];
  const out = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of await readdir(dir)) {
      if (extname(f) === '.mjs' || extname(f) === '.js') out.push(resolve(dir, f));
    }
  }
  return out.sort();
}

/**
 * Generic AST walk. Hand-rolled rather than pulling in acorn-walk, which is not a
 * dependency of anything here.
 * @param {unknown} node
 * @param {(n: any) => void} visit
 */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    walk(node[key], visit);
  }
}

/** `h.step` / `h['step']` -> "step"; a computed name that is not a literal -> null */
function memberName(member) {
  if (!member.computed) return member.property?.type === 'Identifier' ? member.property.name : null;
  return member.property?.type === 'Literal' ? String(member.property.value) : null;
}

/** `h.check(...)` / `check(...)` / `this.check(...)` -> "check" */
function calleeName(call) {
  const c = call.callee;
  if (!c) return null;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && c.property?.type === 'Identifier') return c.property.name;
  return null;
}

function literalText(node) {
  if (!node) return null;
  if (node.type === 'Literal') return String(node.value);
  if (node.type === 'TemplateLiteral' && node.quasis.length === 1) return node.quasis[0].value.cooked;
  return null;
}

function text(src, node) {
  return node ? src.slice(node.start, node.end) : '';
}

function normalise(s) {
  return s.replace(/\s+/g, '').replace(/^['"`]|['"`]$/g, '');
}
