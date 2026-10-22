#!/usr/bin/env node
/**
 * Negative controls for `assertion-audit.mjs` — proof that each rule can actually fail.
 *
 * `CLAUDE.md`: *a gate is not evidence until you have seen it fail on purpose.* This audit
 * has now been wrong FOUR times in the same place, every time in the `literal-false` guard
 * exemption, and every time it was caught by someone thinking to try a specific input
 * rather than by anything that runs:
 *
 *   1. The first cut climbed the whole ancestor chain to the top-level `if (declarative)`,
 *      so a deliberate unconditional `check(x, false)` anywhere inside it went green.
 *   2. The second stopped at the first conditional and rejected a *constant* guard — but
 *      `classify` only knew about literals, so `if ({})`, `if ([])`, `if (() => false)`,
 *      `if (function () {})`, `if (class {})` and `` if (`x`) `` all reached the exemption
 *      as ordinary guards. Six spellings of `if (true)` that the rule did not recognise.
 *   3. The third closed those six and `new Date()`, one indirection included.
 *   4. The fourth was `if (1 + 1)`. Probing found seventeen more spellings equally silent.
 *
 * Rounds 2 to 4 are the same error three times: the rule was asking *"is this always
 * truthy?"*, a question whose answers have no closed list, so each round bought exactly the
 * cases it thought of. The rule was therefore narrowed rather than patched again — it now
 * decides only whether a condition reads anything the run can change, and states the
 * constants it does NOT decide in its own output. The controls below are in three groups:
 * the rules shown red, the exemption shown still usable, and the declared boundary shown
 * deliberately silent. The third group is new and is the point of round four.
 *
 * Unlike `sanitizer-audit.selftest.mjs`, nothing here perturbs a tracked file: the audit
 * accepts explicit paths, so every control is a fixture written to a fresh temp directory
 * and handed to the audit as an argument. The repository is never touched, and the controls
 * can therefore be run concurrently with anything.
 *
 * Usage:  node scripts/beta-harness/assertion-audit.selftest.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const AUDIT = 'scripts/beta-harness/assertion-audit.mjs';

const workdir = mkdtempSync(join(tmpdir(), 'assertion-audit-selftest-'));
process.on('exit', () => rmSync(workdir, { recursive: true, force: true }));

let fixtureSeq = 0;
/** Writes `source` to a fresh file and returns the audit's exit code and output. */
function runAgainst(source) {
  const file = join(workdir, `fixture-${(fixtureSeq += 1)}.mjs`);
  writeFileSync(file, source, 'utf8');
  const r = spawnSync('node', [AUDIT, file], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const results = [];

/**
 * A control that must make the audit go red, for a named reason.
 *
 * @param {string} name
 * @param {string} source   the fixture the audit is pointed at
 * @param {string} expect   substring the red output must contain
 */
function red(name, source, expect) {
  const { code, out } = runAgainst(source);
  results.push({
    name,
    kind: 'negative',
    pass: code !== 0 && out.includes(expect),
    detail: `exit ${code}; expected output to contain ${JSON.stringify(expect)}`,
    out,
  });
}

/**
 * A control that must leave the audit green — the other half, without which every rule
 * above could be satisfied by a gate that simply reports everything.
 *
 * @param {string} name
 * @param {string} source
 * @param {string} [expect] substring the green output must contain, if the control needs one
 */
function green(name, source, expect) {
  const { code, out } = runAgainst(source);
  results.push({
    name,
    kind: 'silence',
    pass: code === 0 && (expect === undefined || out.includes(expect)),
    detail: `exit ${code}${expect === undefined ? '' : `; expected output to contain ${JSON.stringify(expect)}`}`,
    out,
  });
}

// ---- the rules, each shown red on purpose --------------------------------------------------

red(
  'a check with no condition is reported',
  `export async function run(h) {\n  h.check('no condition');\n}\n`,
  'has no condition, so it always passes',
);

red(
  'a check on a literal true is reported',
  `export async function run(h) {\n  h.check('constant', true, 'why');\n}\n`,
  'asserts the literal `true`',
);

red(
  'a check on an identifier bound to a literal is reported',
  `const ok = true;\nexport async function run(h) {\n  h.check('bound', ok, 'why');\n}\n`,
  'bound to the literal',
);

red(
  'a check comparing an expression to itself is reported',
  `export async function run(h, name) {\n  h.check('self', name === name, 'why');\n}\n`,
  'compares `name` to itself',
);

red(
  'an unconditional literal-false check is reported',
  `export async function run(h) {\n  h.check('unconditional', false, 'why');\n}\n`,
  'asserts a literal falsy value',
);

// ---- step boundaries: the identity guard judges the previous step at `await h.step(...)` -----

red(
  'a step boundary that is not awaited is reported',
  `export async function run(h) {\n  h.step('two');\n  h.check('c', h.ok);\n}\n`,
  'unawaited-step',
);

red(
  'a discarded Promise.all around a step boundary is reported, though the runtime reads it as awaited',
  `export async function run(h) {\n  Promise.all([h.step('two')]);\n  h.check('c', h.ok);\n}\n`,
  'unawaited-step',
);

red(
  'a step boundary awaited through a .then() chain is reported',
  `export async function run(h) {\n  await h.step('two').then(() => undefined);\n  h.check('c', h.ok);\n}\n`,
  'unawaited-step',
);

red(
  'an alias of h.step is reported, so the rule cannot be stepped around',
  `export async function run(h) {\n  const { step } = h;\n  const s = h['step'];\n  await step('two');\n  await s('three');\n  h.check('c', h.ok);\n}\n`,
  'unawaited-step',
);

green(
  'an awaited step boundary is not reported, inside a block or split over lines',
  `export async function run(h, recorder) {\n  await h.step('one');\n  if (recorder.steps.length) {\n    await h.step(\n      'two',\n    );\n  }\n  h.check('c', recorder.steps.length > 0);\n}\n`,
);

// ---- identity transitions: each judges the outgoing identity before restarting the window ----

red(
  'an unawaited h.signedInAs is reported: the outgoing identity would go unjudged',
  `export async function run(h) {\n  h.signedInAs('parity-user', 'why');\n  h.check('c', h.ok);\n}\n`,
  'unawaited-identity-transition',
);

red(
  'an unawaited h.signedOut is reported',
  `export async function run(h) {\n  h.signedOut('why');\n  h.check('c', h.ok);\n}\n`,
  'unawaited-identity-transition',
);

red(
  'an alias of h.signedInAs is reported, so the rule cannot be stepped around',
  `export async function run(h) {\n  const { signedInAs } = h;\n  await signedInAs('parity-user', 'why');\n  h.check('c', h.ok);\n}\n`,
  'unawaited-identity-transition',
);

green(
  'awaited identity transitions are not reported',
  `export async function run(h, recorder) {\n  await h.signedInAs('parity-user', 'why');\n  await h.signedOut('why');\n  h.check('c', recorder.steps.length > 0);\n}\n`,
);

// ---- the guard exemption, which is where this audit has been wrong twice ---------------------
//
// Each fixture below is `if (<always truthy>) check(name, false)` — an unconditional failure
// report wearing a guard. Every one of them was verified exempt before `classify` learned
// these forms, so every one of them is a hole this file now keeps shut.

const laundered = {
  'an object literal': '{}',
  'an array literal': '[]',
  'an arrow function': '() => false',
  'a function expression': 'function () {}',
  'a class expression': 'class {}',
  'a constant template literal': '`literal`',
  'a literal true': 'true',
  'a negated constant': '!0',
  'a regex literal': '/x/',
  // `new` discards a primitive `return`, so this is an object and the guard cannot be false.
  // Review found it exempt; these last two are the holes that round closed.
  'a constructor call': 'new Date()',
};
for (const [description, guard] of Object.entries(laundered)) {
  red(
    `${description} does not launder an unconditional check(name, false)`,
    `export async function run(h) {\n  if (${guard}) h.check('laundered', false, 'why');\n}\n`,
    'asserts a literal falsy value',
  );
}

// The same laundering one indirection away. Only *literal* initialisers were recorded as
// bindings, so `const guard = {}` read as an unknown value and `if (guard)` passed for a real
// condition. Written out rather than folded into `laundered` above because it needs the
// declaration as well as the guard.
for (const [description, init] of Object.entries({
  'an object literal': '{}',
  'an array literal': '[]',
  'an arrow function': '() => false',
  'a constructor call': 'new Date()',
})) {
  red(
    `a binding to ${description} does not launder an unconditional check either`,
    `export async function run(h) {\n  const guard = ${init};\n  if (guard) h.check('laundered', false, 'why');\n}\n`,
    'asserts a literal falsy value',
  );
}

red(
  'a constant guard in a logical expression does not launder it either',
  `export async function run(h) {\n  ({}) && h.check('laundered', false, 'why');\n}\n`,
  'asserts a literal falsy value',
);

red(
  'a check buried among other statements inside an if is not exempt',
  `export async function run(h) {\n  if (h.declarative) {\n    await h.step('s');\n    h.check('buried', false, 'why');\n  }\n}\n`,
  'asserts a literal falsy value',
);

red(
  'a file the parser cannot read is reported rather than skipped',
  `export async function run(h) { this is not javascript`,
  'could not be parsed',
);

// ---- round four: constant BY CONSTRUCTION, after enumerating truthiness was abandoned ------
//
// Review found `if (1 + 1)` exempt. Probing the same hole found seventeen more spellings, all
// silent, which settled the argument that the rule could not be fixed by adding cases: it was
// answering "is this always truthy?", a question with no closed list of answers. It now answers
// "does this read anything the run can change?" instead — decided structurally, nothing
// evaluated — so every spelling below is refused by one rule rather than seventeen.
//
// `1 - 1` and `void 0` are in here deliberately: both are FALSY, so the guard never holds and
// the check never runs. A constant guard is refused whatever it evaluates to, because the
// rule does not evaluate it.
for (const [description, guard] of Object.entries({
  'literal arithmetic': '1 + 1',
  'falsy literal arithmetic': '1 - 1',
  'literal multiplication': '2 * 3',
  'string concatenation': "'a' + 'b'",
  'a comparison outside the equality list': '5 > 3',
  'a logical AND of literals': '1 && 2',
  'a logical OR of literals': '0 || 3',
  'a typeof on a literal': 'typeof 1',
  'a void expression': 'void 0',
  'a bitwise complement': '~0',
  'a negated literal number': '-1',
  'a sequence expression': '(1, 2)',
  'a conditional over literals': 'true ? 1 : 2',
  'a nullish coalesce of literals': 'null ?? 7',
  'a template interpolating only literals': '`${1 + 1}`',
})) {
  red(
    `${description} does not launder an unconditional check(name, false)`,
    `export async function run(h) {\n  if (${guard}) h.check('laundered', false, 'why');\n}\n`,
    'asserts a literal falsy value',
  );
}

red(
  'literal arithmetic one binding away does not launder it either',
  `export async function run(h) {\n  const two = 2;\n  if (two + two) h.check('laundered', false, 'why');\n}\n`,
  'asserts a literal falsy value',
);

// The same rule in the other position: not a guard laundering a `false`, but a constant used
// directly as the thing being asserted.
red(
  'a constant-by-construction condition is reported in the assertion position',
  `export async function run(h) {\n  h.check('arithmetic', 1 + 1, 'why');\n}\n`,
  'built only from literals and pure operators, so its value is fixed before the run',
);

// The rule does not evaluate, so it does not know whether a given constant always passes or
// always fails — and must not say "it cannot fail" of one that always fails. This control
// exists because that blanket wording was the previous round's overstatement in miniature.
red(
  'a constant assertion is not described as one that "cannot fail"',
  `export async function run(h) {\n  h.check('falsy arithmetic', 1 - 1, 'why');\n}\n`,
  'Its outcome is identical on every run, so it is not evidence.',
);

// ---- and the other half: the idiom the exemption exists for must still pass ------------------
//
// Without these, every control above is satisfied by an audit that reports everything — which
// is the "gate nobody can satisfy is one that gets suppressed" failure the exemption was added
// to avoid in the first place.

green(
  'the guarded failure-report idiom stays exempt',
  `export async function run(h, scene) {\n  if (!scene.criterion) h.check('scene names an acceptance criterion', false, 'why');\n}\n`,
  'reached only when: !scene.criterion',
);

// Shadowing and reassignment, which the binding maps cannot resolve because they are keyed by
// identifier text for the whole file. An ambiguous name must classify as UNKNOWN, so the check
// stays exempt — a false rejection here would report a genuinely conditional check as
// unfalsifiable, which is the worse direction of the two errors available.
green(
  'a name declared twice does not let one declaration classify the other',
  `export async function run(h, scene) {\n  const guard = {};\n  if (guard) await h.step('s');\n  const inner = () => { const guard = scene.criterion; if (!guard) h.check('real', false, 'why'); };\n  inner();\n}\n`,
  'reached only when: !guard',
);

green(
  'a reassigned name is not classified from its initialiser',
  `export async function run(h, scene) {\n  let guard = {};\n  guard = scene.criterion;\n  if (!guard) h.check('real', false, 'why');\n}\n`,
  'reached only when: !guard',
);

green(
  'a guarded failure report reached through a logical AND stays exempt',
  `export async function run(h, asserted) {\n  !asserted && h.check('scene asserts something', false, 'why');\n}\n`,
  'reached only when: !asserted',
);

green(
  'an interpolating template guard stays exempt, because it can be empty',
  'export async function run(h, term) {\n' +
    '  if (`${term}`) h.check(\'guarded\', false, \'why\');\n' +
    '}\n',
  'reached only when',
);

green(
  'an ordinary falsifiable check is not reported',
  `export async function run(h, res) {\n  h.check('status is 200', res.status === 200, 'why');\n}\n`,
);

// ---- the declared boundary: cases the rule no longer claims to decide ------------------------
//
// These are the reason the rule was narrowed rather than patched a fifth time. Each one is a
// constant a human can see and the audit deliberately does not, because seeing it needs a call
// or a property read — evaluation this rule does not do. They assert SILENCE on purpose: the
// point of narrowing is that the unclaimed territory is real, stated in `DECLARED_LIMITS`, and
// therefore cannot be mistaken later for a hole nobody noticed. If a future round teaches the
// rule to decide one of these, its control here must move to `red` and the limit must come out
// of the printed list in the same commit.

green(
  'a guard calling a function that always returns true is NOT claimed, and stays exempt',
  `export async function run(h) {\n  const alwaysTrue = () => true;\n  if (alwaysTrue()) h.check('not claimed', false, 'why');\n}\n`,
  'reached only when: alwaysTrue()',
);

green(
  'a guard reading a property is NOT claimed, and stays exempt',
  `export async function run(h, CONFIG) {\n  if (CONFIG.enabled) h.check('not claimed', false, 'why');\n}\n`,
  'reached only when: CONFIG.enabled',
);

green(
  'a property read on a literal is NOT claimed, even though it is constant',
  `export async function run(h) {\n  if ('abc'.length) h.check('not claimed', false, 'why');\n}\n`,
  "reached only when: 'abc'.length",
);

// The false-positive direction of the new rule, which is the one that would turn the gate into
// something nobody can satisfy: arithmetic is only constant when every operand is. One runtime
// operand anywhere in the tree must make the whole expression unknown.
green(
  'arithmetic with a runtime operand is not reported as constant',
  `export async function run(h, res) {\n  h.check('count is positive', res.count + 1 > 0, 'why');\n}\n`,
);

// The boundary is only honest if it is visible where the verdict is read, so the printed list
// is itself a tested property — on a pass, which is when the verdict gets quoted.
green(
  'a passing audit prints the boundary of what it did not decide',
  `export async function run(h, res) {\n  h.check('status is 200', res.status === 200, 'why');\n}\n`,
  'NOT claimed by this audit',
);

red(
  'a failing audit prints the boundary too, not just the failures',
  `export async function run(h) {\n  h.check('constant', true, 'why');\n}\n`,
  'NOT claimed by this audit',
);

// ---- report ----------------------------------------------------------------------------------
// Split by kind for the same reason `sanitizer-audit.selftest.mjs` splits: only the `negative`
// rows are evidence that a rule can fail. The `silence` rows assert green, which is context.
const KIND_LABEL = { negative: 'RED-ON-PURPOSE', silence: 'silence' };

console.log('\nassertion-audit selftest\n');
let failed = 0;
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  [${KIND_LABEL[r.kind]}]  ${r.name}`);
  if (!r.pass) {
    failed += 1;
    console.log(`        ${r.detail}`);
    console.log(
      r.out
        .split('\n')
        .map((l) => `        | ${l}`)
        .join('\n'),
    );
  }
}

const tally = (k) => results.filter((r) => r.kind === k).length;
console.log('');
if (failed > 0) {
  console.log(`selftest: FAIL — ${failed} of ${results.length} controls did not behave as expected.`);
  console.log('A rule that cannot be made to fail is decoration. Fix the rule, not the control.');
  process.exit(1);
}
console.log(
  `selftest: PASS — ${tally('negative')} negative control(s) observed red on purpose; ` +
    `${tally('silence')} silence assertion(s) as context. ${results.length} controls total.`,
);
console.log(
  '  Only the negative controls prove a rule can fail. The silence assertions keep the',
);
console.log(
  '  exemption usable, so the audit cannot pass them by reporting everything.',
);
