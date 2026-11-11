#!/usr/bin/env node
/**
 * Controls for `nx-project-matching.mjs` — proof that each part of it can actually fail.
 *
 * ## Why this file exists
 *
 * The gate shipped with check C accepting a scanned `minimatch` member if it existed under
 * **either** access path — the named export or a property of the exported function. That is green
 * against the break the gate was written for, because minimatch 11.0.1 dropped `makeRe` from
 * both. It is also green against half of it: a minimatch that kept the named export and dropped
 * the function property satisfies "either", while every `minimatch_1.minimatch.makeRe(…)` call
 * site still throws. Review (#586) found that by reading the code, which is the part this file
 * closes — the gate had no controls at all, so nothing re-asserted its behaviour.
 *
 * The two one-sided removals are therefore the headline cases here: `namespace-only` and
 * `function-only`, each of which must fail the access path it does not serve and pass the one it
 * does. Four cases, not two, because a check that only ever rejects is as useless as one that
 * only ever accepts.
 *
 * ## Hermetic
 *
 * Nothing here spawns nx, reads the repository's `node_modules` or perturbs a tracked file. The
 * gate's four pure functions are imported directly; the scanner's fixtures are throwaway trees
 * under the OS temp directory, and the API shapes are objects built in this file. So there is no
 * dirty-tree recovery path, because there is no way for this to leave the tree dirty.
 *
 * ## What it does not reach, stated so the pass is not read as more than it is
 *
 * The gate's gathering half — `spawnToolSync('nx', …)`, `createRequire` against nx's own tree,
 * `statSync` on `nx/dist/src` — is not pure and is not driven here. Those produce the
 * `cannot launch nx` / `nx cannot resolve minimatch` / `is not a directory` gaps, and they are
 * the one class of verdict with no control. The gate's header says the same thing.
 *
 * Usage:  node scripts/beta-harness/nx-project-matching.selftest.mjs
 *
 * Exit: 0 every control behaved as specified · 1 at least one did not.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ACCESS,
  evaluate,
  minimatchMembersUsedUnder,
  missingUsages,
  pickSubject,
} from './nx-project-matching.mjs';

const workspace = mkdtempSync(join(tmpdir(), 'nx-project-matching-selftest-'));
/** @type {{ name: string, kind: 'negative' | 'positive', ok: boolean, detail?: string }[]} */
const results = [];

/**
 * `kind` is what the control proves, not whether it passed: `negative` cases must make the gate
 * complain, `positive` cases must leave it quiet. Both totals are printed, because "22 controls
 * passed" says nothing about whether any of them could ever have failed.
 */
function check(name, kind, ok, detail) {
  results.push({ name, kind, ok: Boolean(ok), detail });
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ------------------------------------------------------------------- the scanner's fixtures */

/** Write `files` into a fresh directory and scan it. Keys are paths relative to that directory. */
function scan(caseName, files) {
  const dir = join(workspace, caseName);
  for (const [relative, source] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, source);
  }
  mkdirSync(dir, { recursive: true });
  return minimatchMembersUsedUnder(dir).map(({ member, access }) => `${access}:${member}`);
}

check(
  'the function-property form is recorded as `function` access',
  'positive',
  same(scan('fn-form', { 'a.js': 'const r = minimatch_1.minimatch.makeRe(p, { dot: true });' }), [
    'function:makeRe',
  ]),
);

check(
  'the named-export form is recorded as `namespace` access',
  'positive',
  same(scan('ns-form', { 'a.js': 'const r = minimatch_1.makeRe(p);' }), ['namespace:makeRe']),
);

check(
  'the same member under both forms is two usages, not one',
  'positive',
  same(
    scan('both-forms', {
      'a.js': 'minimatch_1.minimatch.makeRe(p);',
      'b.js': 'minimatch_1.makeRe(p);',
    }),
    ['function:makeRe', 'namespace:makeRe'],
  ),
);

check(
  'the bare binding `minimatch_1.minimatch(…)` is not a member usage',
  'negative',
  same(scan('bare-binding', { 'a.js': 'if (minimatch_1.minimatch(file, pattern)) return;' }), []),
);

check(
  'a nested directory is walked',
  'positive',
  same(scan('nested', { 'deep/deeper/a.js': 'minimatch_1.minimatch.filter(p);' }), [
    'function:filter',
  ]),
);

check(
  'a non-.js file is not scanned',
  'negative',
  same(
    scan('non-js', {
      'a.d.ts': 'export const x: typeof minimatch_1.minimatch.makeRe;',
      'b.json': '{"note":"minimatch_1.makeRe"}',
      'c.mjs': 'minimatch_1.makeRe(p);',
    }),
    [],
  ),
);

check(
  'a .js file with no `minimatch_1.` reference contributes nothing',
  'negative',
  same(scan('unrelated', { 'a.js': 'const { minimatch } = require("minimatch");' }), []),
);

check(
  'an empty tree scans to nothing rather than throwing',
  'negative',
  same(scan('empty', {}), []),
);

let scanThrew = false;
try {
  minimatchMembersUsedUnder(join(workspace, 'does-not-exist-at-all'));
} catch {
  scanThrew = true;
}
check('a missing directory throws, so the gate can call it a gap', 'negative', scanThrew);

/* ------------------------------------------------------------------- the API shapes for C */

/**
 * A stand-in for one of minimatch's exports. The gate only asks `typeof … === 'function'`, so the
 * body is never called; it returns a value anyway because an empty one is an eslint error here.
 */
const stub = () => () => true;

/** Both access paths carry `makeRe`, as minimatch 10.2.5 does. */
const BOTH = (() => {
  const callable = stub();
  callable.makeRe = stub();
  return { makeRe: stub(), minimatch: callable };
})();

/** The named export only — the one-sided removal that "accepts either" would have waved through. */
const NAMESPACE_ONLY = { makeRe: stub(), minimatch: stub() };

/** The function property only — the mirror image. */
const FUNCTION_ONLY = (() => {
  const callable = stub();
  callable.makeRe = stub();
  return { minimatch: callable };
})();

/** Neither, as minimatch 11.0.1 is. */
const NEITHER = { minimatch: stub() };

const VIA_FUNCTION = [{ member: 'makeRe', access: ACCESS.function, files: ['x.js'] }];
const VIA_NAMESPACE = [{ member: 'makeRe', access: ACCESS.namespace, files: ['x.js'] }];

const API_CASES = [
  ['a function-property call against a module with both paths', VIA_FUNCTION, BOTH, 0],
  ['a function-property call against function-only', VIA_FUNCTION, FUNCTION_ONLY, 0],
  ['a function-property call against NAMESPACE-only', VIA_FUNCTION, NAMESPACE_ONLY, 1],
  ['a named-export call against a module with both paths', VIA_NAMESPACE, BOTH, 0],
  ['a named-export call against namespace-only', VIA_NAMESPACE, NAMESPACE_ONLY, 0],
  ['a named-export call against FUNCTION-only', VIA_NAMESPACE, FUNCTION_ONLY, 1],
  ['a function-property call against neither', VIA_FUNCTION, NEITHER, 1],
  ['a named-export call against neither', VIA_NAMESPACE, NEITHER, 1],
  [
    'both call shapes against neither are both reported',
    [...VIA_FUNCTION, ...VIA_NAMESPACE],
    NEITHER,
    2,
  ],
  ['both call shapes against both paths are quiet', [...VIA_FUNCTION, ...VIA_NAMESPACE], BOTH, 0],
];

for (const [name, usages, module, expected] of API_CASES) {
  const got = missingUsages(usages, module).length;
  check(name, expected === 0 ? 'positive' : 'negative', got === expected, `reported ${got}`);
}

check(
  'a one-sided failure says the other path exists and does not save the call sites',
  'negative',
  evaluate(okInput({ usages: VIA_FUNCTION, module: NAMESPACE_ONLY })).failures[0]?.detail.includes(
    'different runtime path',
  ),
);

/* ------------------------------------------------------------------------ pickSubject */

const ROOTS = { alpha: 'libs/alpha', beta: 'libs/beta', dotty: '.', tiny: 'x' };
const rootOf = (name) => ROOTS[name] ?? null;

check(
  'the first usable root in sorted order is the subject, and `other` differs',
  'positive',
  (() => {
    const p = pickSubject(['beta', 'alpha'], rootOf);
    return p.subject?.name === 'alpha' && p.other === 'beta' && p.rootGlob === 'libs/alph*';
  })(),
);

check(
  'a `.` root is skipped — its glob would be `*`, which minimatch does not match against `.`',
  'negative',
  pickSubject(['dotty', 'alpha'], rootOf).subject?.name === 'alpha',
);

check(
  'a one-character root is skipped — nothing would be left once the last character becomes `*`',
  'negative',
  pickSubject(['tiny', 'alpha'], rootOf).subject?.name === 'alpha',
);

check(
  'a roster where no project has a usable root is a gap, not a pass',
  'negative',
  'gap' in pickSubject(['dotty', 'tiny'], rootOf),
);

check(
  'a roster of one project is a gap — probe A needs a second project to exclude',
  'negative',
  'gap' in pickSubject(['alpha'], rootOf),
);

check(
  'an unresolvable root is skipped rather than crashing',
  'negative',
  pickSubject(['missing', 'alpha'], rootOf).subject?.name === 'alpha',
);

/* --------------------------------------------------------------------------- evaluate */

/** A fully healthy input set, with individual parts overridable per control. */
function okInput(overrides = {}) {
  const { usages = VIA_FUNCTION, module = BOTH, ...rest } = overrides;
  return {
    subject: { name: 'alpha', root: 'libs/alpha' },
    other: 'beta',
    rootGlob: 'libs/alph*',
    probeA: { projects: ['alpha'] },
    probeB: { projects: [] },
    controlProbe: () => ({ projects: ['alpha'] }),
    usages,
    minimatch: { version: '10.2.5', path: 'node_modules/minimatch', module },
    ...rest,
  };
}

check('a healthy input set exits 0', 'positive', evaluate(okInput()).exit === 0);

check(
  'no usage at all is exit 2 — a scanner that found nothing is a gap, not a clean bill',
  'negative',
  (() => {
    const v = evaluate(okInput({ usages: [] }));
    return v.exit === 2 && v.gap?.includes('re-point it');
  })(),
);

check(
  'probe A erroring is exit 1 and quotes nx',
  'negative',
  (() => {
    const v = evaluate(okInput({ probeA: { error: 'nx exited 1: makeRe is not a function' } }));
    return v.exit === 1 && v.failures[0].detail.includes('makeRe is not a function');
  })(),
);

check(
  "probe A's control separates a broken matcher from an unselectable subject",
  'negative',
  (() => {
    const broken = evaluate(okInput({ probeA: { error: 'boom' } }));
    const graph = evaluate(
      okInput({ probeA: { error: 'boom' }, controlProbe: () => ({ error: 'also boom' }) }),
    );
    return (
      broken.failures[0].detail.includes('the fault is in --exclude') &&
      graph.failures[0].detail.includes('may be the project graph')
    );
  })(),
);

check(
  'the control probe is not consulted while probe A is healthy',
  'positive',
  (() => {
    let called = 0;
    evaluate(
      okInput({
        controlProbe: () => {
          called += 1;
          return { projects: ['alpha'] };
        },
      }),
    );
    return called === 0;
  })(),
);

check(
  'probe A returning a project it was not given is exit 1',
  'negative',
  evaluate(okInput({ probeA: { projects: ['alpha', 'beta'] } })).exit === 1,
);

check(
  'probe A returning nothing is exit 1 — excluding a project outside the selection must not empty it',
  'negative',
  evaluate(okInput({ probeA: { projects: [] } })).exit === 1,
);

check(
  'probe B still holding the subject is exit 1 — this is the no-op exclusion case',
  'negative',
  (() => {
    const v = evaluate(okInput({ probeB: { projects: ['alpha'] } }));
    return v.exit === 1 && v.failures[0].detail.includes('silently skipped');
  })(),
);

check(
  'probe B erroring is exit 1',
  'negative',
  evaluate(okInput({ probeB: { error: 'nx exited 1' } })).exit === 1,
);

check(
  'a probe failure and an API failure are reported together, not one instead of the other',
  'negative',
  evaluate(okInput({ probeB: { projects: ['alpha'] }, module: NEITHER })).failures.length === 2,
);

check(
  'the notes name the subject and both patterns, so a pass says what it ran against',
  'positive',
  (() => {
    const notes = evaluate(okInput()).notes.join('\n');
    return notes.includes('alpha') && notes.includes('beta') && notes.includes('libs/alph*');
  })(),
);

/* ---------------------------------------------------------------------------- verdict */

const failed = results.filter((r) => !r.ok);
const negative = results.filter((r) => r.kind === 'negative').length;
const positive = results.filter((r) => r.kind === 'positive').length;

for (const r of results) {
  if (r.ok) console.log(`  ok   ${r.name}`);
  else console.error(`  FAIL ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}

if (failed.length > 0) {
  console.error(
    `\nnx-project-matching selftest: FAIL — ${failed.length} of ${results.length} control(s) ` +
      'did not behave as specified.',
  );
  process.exit(1);
}

console.log(
  `\nnx-project-matching selftest: pass — ${results.length} control(s): ${negative} negative ` +
    `(must be reported) + ${positive} positive (must stay quiet).`,
);
