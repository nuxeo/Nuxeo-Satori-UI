#!/usr/bin/env node
/**
 * Controls for `lockfile-integrity.mjs` — proof that each half of it can actually fail.
 *
 * `CLAUDE.md`: *a gate is not evidence until you have seen it fail on purpose.* This gate is one
 * of the three the rule was written about, and it has now been wrong in both directions on the
 * same line of code:
 *
 *   - it matched dependency **names** but not versions, so it was green on the very lock that
 *     kept CI red for the whole of Phase 2 (`@oxc-resolver/binding-wasm32-wasi`'s nested
 *     `@emnapi/*` pruned by a bare `npm install` on macOS);
 *   - then the override waiver stripped the **selector** off `"brace-expansion@^5.0.0"` and
 *     waived every `brace-expansion` major, in a tree that holds v1 and v2 copies as well.
 *
 * Both were found in review rather than by the gate, because nothing re-asserted the gate's
 * behaviour. That is what this file is for. The two directions pull against each other — too
 * strict and 24 deliberate security pins look like corruption, too loose and a malformed edge is
 * waived — so the controls come in pairs: for each waiver there is a case that must stay excused
 * and a case that must be reported.
 *
 * Unlike `sanitizer-audit.selftest.mjs`, nothing here perturbs a tracked file. The gate takes
 * `--lock`, so every control is a throwaway lock plus manifest under the OS temp directory, and
 * the two controls that need the real lock copy it there first. There is no dirty-tree recovery
 * path because there is no way for this to leave the tree dirty.
 *
 * Usage:  node scripts/beta-harness/lockfile-integrity.selftest.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const GATE = 'scripts/beta-harness/lockfile-integrity.mjs';
const REAL_LOCK = join(ROOT, 'package-lock.json');
const REAL_MANIFEST = join(ROOT, 'package.json');

const workspace = mkdtempSync(join(tmpdir(), 'lockfile-integrity-selftest-'));
const results = [];

/**
 * Writes a `package.json` + `package-lock.json` pair into its own directory and runs the gate
 * against it. The manifest has to sit beside the lock because that is where the gate reads
 * `overrides` from — npm does not record them in the lock.
 */
function runGate(caseName, manifest, lock, { hideSemver = false } = {}) {
  const dir = join(workspace, caseName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock, null, 2));
  const nodeArgs = hideSemver ? [`--import=${semverHiderUrl()}`] : [];
  const r = spawnSync('node', [...nodeArgs, GATE, '--lock', join(dir, 'package-lock.json')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * A module-resolution hook that makes `import('semver')` fail, so the gate's degraded path can be
 * exercised for real.
 *
 * The gate treats `semver` as optional — it is reached through npm's own tree, not declared — and
 * that branch was the one place no control looked. It had `return true` for the entire override
 * waiver, so with `semver` absent a nested rule waived unrelated edges and a stale exact value was
 * accepted: the failures controls 6 and 10-13 exist to catch, alive in a branch they never ran in.
 *
 * Hiding the module from the child process is better than a test-only flag in the gate: nothing in
 * the gate knows this is a test, so the control exercises the real condition — the module genuinely
 * not resolving — rather than a switch that approximates it.
 */
function semverHiderUrl() {
  const hooks = join(workspace, 'hide-semver-hooks.mjs');
  const entry = join(workspace, 'hide-semver.mjs');
  writeFileSync(
    hooks,
    `export async function resolve(specifier, context, next) {\n` +
      `  if (specifier === 'semver') {\n` +
      `    const error = new Error("Cannot find package 'semver' (hidden by the selftest)");\n` +
      `    error.code = 'ERR_MODULE_NOT_FOUND';\n` +
      `    throw error;\n` +
      `  }\n` +
      `  return next(specifier, context);\n` +
      `}\n`,
  );
  writeFileSync(
    entry,
    `import { register } from 'node:module';\n` +
      `register(new URL('./hide-semver-hooks.mjs', import.meta.url));\n`,
  );
  return pathToFileURL(entry).href;
}

/**
 * @param {string} name
 * @param {'pass' | 'fail'} expected
 * @param {string} because the substring the output must contain — a control that only checks the
 *   exit code cannot tell "red for my reason" from "red for an unrelated one", and this gate has
 *   1835 entries' worth of unrelated reasons available.
 * @param {{ code: number, out: string }} result
 */
function expect(name, expected, because, result) {
  const wanted = expected === 'pass' ? 0 : 1;
  const codeOk = result.code === wanted;
  const textOk = result.out.includes(because);
  const ok = codeOk && textOk;
  results.push({ name, expected, ok });
  const verdict = ok ? 'ok  ' : 'FAIL';
  console.log(`${verdict} ${name} — expected ${expected}, got exit ${result.code}`);
  if (!ok) {
    if (!codeOk) console.log(`       exit ${result.code}, wanted ${wanted}`);
    if (!textOk) console.log(`       output did not contain: ${because}`);
    console.log(
      result.out
        .trimEnd()
        .split('\n')
        .map((l) => `       | ${l}`)
        .join('\n'),
    );
  }
}

/** A minimal lock: one dependent declaring `spec` for `name`, resolved to `resolvedVersion`. */
function lockWithEdge({
  dependent = 'minimatch',
  dependentVersion = '3.1.2',
  name,
  spec,
  resolvedVersion,
  resolvedPath,
}) {
  return {
    name: 'fixture',
    version: '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'fixture',
        version: '0.0.0',
        dependencies: { [dependent]: `^${dependentVersion}` },
      },
      [`node_modules/${dependent}`]: { version: dependentVersion, dependencies: { [name]: spec } },
      ...(resolvedVersion === null
        ? {}
        : { [resolvedPath ?? `node_modules/${name}`]: { version: resolvedVersion } }),
    },
  };
}

const V5_OVERRIDE = { 'brace-expansion@^5.0.0': '5.0.12' };

// ---------------------------------------------------------------------------------------------
// 1. Baseline. If the real lock does not pass, every control below is measuring something else.
// ---------------------------------------------------------------------------------------------
{
  const r = spawnSync('node', [GATE], { cwd: ROOT, encoding: 'utf8' });
  expect(
    'real lock passes (baseline — guards against the controls all being vacuous)',
    'pass',
    'lockfile-integrity: pass',
    { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` },
  );
}

// ---------------------------------------------------------------------------------------------
// 2. The selector must be honoured. Copilot's fixture on PR #300: a `^5.0.0` override and a
//    `^1.1.7` edge resolving to v2. npm's override does not touch that request, so the gate
//    must not excuse it. Reported `pass` while the waiver was keyed on the bare name.
// ---------------------------------------------------------------------------------------------
expect(
  'out-of-scope major is reported despite a v5 override',
  'fail',
  'requires brace-expansion@^1.1.7',
  runGate(
    'out-of-scope-major',
    { name: 'fixture', version: '0.0.0', overrides: V5_OVERRIDE },
    lockWithEdge({ name: 'brace-expansion', spec: '^1.1.7', resolvedVersion: '2.1.4' }),
  ),
);

// ---------------------------------------------------------------------------------------------
// 3. The mirror of 2, and the reason the waiver checks the *request* as well as the resolved
//    version. Prune a nested v1 copy and the v1 request walks up to the overridden v5 root
//    entry — which is the Phase 2 failure shape. Checking only "does 5.0.12 satisfy ^5.0.0"
//    would excuse it, because it does.
// ---------------------------------------------------------------------------------------------
expect(
  'v1 request resolving to the overridden v5 entry is reported (pruned nested copy)',
  'fail',
  'at 5.0.12, which does not satisfy "^1.1.7"',
  runGate(
    'pruned-nested-copy',
    { name: 'fixture', version: '0.0.0', overrides: V5_OVERRIDE },
    lockWithEdge({ name: 'brace-expansion', spec: '^1.1.7', resolvedVersion: '5.0.12' }),
  ),
);

// ---------------------------------------------------------------------------------------------
// 4/5. The other direction: the deliberate pin must stay excused, and that pass must be the
//      waiver doing it rather than the version check being asleep. 5 is 4 with the override
//      key deleted, so the same lock has to go red.
// ---------------------------------------------------------------------------------------------
const inScopeLock = lockWithEdge({
  dependent: 'nx',
  dependentVersion: '22.7.8',
  name: 'brace-expansion',
  spec: '5.0.8',
  resolvedVersion: '5.0.12',
});
expect(
  'in-scope pin stays excused (deliberate security pin, not corruption)',
  'pass',
  'lockfile-integrity: pass',
  runGate(
    'in-scope-pin',
    { name: 'fixture', version: '0.0.0', overrides: V5_OVERRIDE },
    inScopeLock,
  ),
);
expect(
  'the same in-scope edge is reported once the override key is removed',
  'fail',
  'requires brace-expansion@5.0.8',
  runGate('in-scope-pin-no-override', { name: 'fixture', version: '0.0.0' }, inScopeLock),
);

// ---------------------------------------------------------------------------------------------
// 6/7. The selector says which requests the rule applies to; the **value** is what gets
//      installed, and the resolved version has to be that. Testing it against the selector
//      instead gets both of these wrong: a stale 5.0.11 satisfies `^5.0.0` while being a version
//      neither the tree nor the override asked for, and a legitimate cross-major value resolves
//      outside its own selector by design.
// ---------------------------------------------------------------------------------------------
expect(
  'a stale resolution inside the selector but not the forced value is reported',
  'fail',
  'requires brace-expansion@5.0.8',
  runGate(
    'stale-inside-selector',
    { name: 'fixture', version: '0.0.0', overrides: V5_OVERRIDE },
    lockWithEdge({
      dependent: 'nx',
      dependentVersion: '22.7.8',
      name: 'brace-expansion',
      spec: '5.0.8',
      resolvedVersion: '5.0.11',
    }),
  ),
);
expect(
  'a cross-major override value is excused even though it resolves outside its own selector',
  'pass',
  'lockfile-integrity: pass',
  runGate(
    'cross-major-value',
    { name: 'fixture', version: '0.0.0', overrides: { 'brace-expansion@^1.0.0': '2.0.0' } },
    lockWithEdge({ name: 'brace-expansion', spec: '^1.1.7', resolvedVersion: '2.0.0' }),
  ),
);

// ---------------------------------------------------------------------------------------------
// 8/9. A bare key carries no selector, so it applies to every request for that name — 24 of the
//      26 waived edges on the real lock are this shape — but its value is still load-bearing.
// ---------------------------------------------------------------------------------------------
const bareKeyLock = lockWithEdge({
  dependent: 'nx',
  dependentVersion: '22.7.8',
  name: 'axios',
  spec: '1.18.1',
  resolvedVersion: '1.20.0',
});
expect(
  'bare override key waives any request for the name',
  'pass',
  'lockfile-integrity: pass',
  runGate(
    'bare-key',
    { name: 'fixture', version: '0.0.0', overrides: { axios: '1.20.0' } },
    bareKeyLock,
  ),
);
expect(
  'bare override key does not waive a version it does not force',
  'fail',
  'requires axios@1.18.1',
  runGate(
    'bare-key-stale',
    { name: 'fixture', version: '0.0.0', overrides: { axios: '1.21.0' } },
    bareKeyLock,
  ),
);

// ---------------------------------------------------------------------------------------------
// 10-13. A nested override is ancestry-scoped: `{ parent: { child: "2.0.0" } }` pins `child`
//        beneath `parent` and pins `parent` itself not at all. Flattening it got both halves
//        wrong, so there is a control for each false pass, plus the legitimate waiver it must
//        not cost and npm's `"."` self-reference, which is the one form that *does* pin the
//        container.
// ---------------------------------------------------------------------------------------------
const NESTED_OVERRIDE = { parent: { child: '2.0.0' } };
expect(
  'a nested override does not waive the container package itself',
  'fail',
  'requires parent@1.0.0',
  runGate(
    'nested-container',
    { name: 'fixture', version: '0.0.0', overrides: NESTED_OVERRIDE },
    {
      name: 'fixture',
      version: '0.0.0',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '0.0.0', dependencies: { parent: '1.0.0' } },
        'node_modules/parent': { version: '2.0.0' },
      },
    },
  ),
);
expect(
  "a nested override does not waive an unrelated dependent's edge",
  'fail',
  'requires child@^1.0.0',
  runGate(
    'nested-unrelated',
    { name: 'fixture', version: '0.0.0', overrides: NESTED_OVERRIDE },
    {
      name: 'fixture',
      version: '0.0.0',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '0.0.0', dependencies: { other: '1.0.0' } },
        'node_modules/other': { version: '1.0.0', dependencies: { child: '^1.0.0' } },
        'node_modules/child': { version: '2.0.0' },
      },
    },
  ),
);
expect(
  'a nested override still waives the edge inside its own scope',
  'pass',
  'lockfile-integrity: pass',
  runGate(
    'nested-in-scope',
    { name: 'fixture', version: '0.0.0', overrides: NESTED_OVERRIDE },
    {
      name: 'fixture',
      version: '0.0.0',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '0.0.0', dependencies: { parent: '1.0.0' } },
        'node_modules/parent': { version: '1.0.0', dependencies: { child: '^1.0.0' } },
        'node_modules/child': { version: '2.0.0' },
      },
    },
  ),
);
/**
 * The dependent in the `"."` fixture below, kept in a constant rather than written inline.
 *
 * `minimatch` was a production dependency with an `unreferencedDependencies` exception until
 * NXSAT-672, and the `supply-chain` gate treats a literal `node_modules/<dep>` anywhere under
 * `scripts/` as a build reference. Spelling the lock path out therefore forged a reference to it
 * and turned that gate red — correctly: a string in a fixture making an unused production dependency look used is exactly
 * the weakening it exists to catch. Interpolating the name keeps the fixture honest.
 */
const SELF_REF_DEPENDENT = 'minimatch';

// This fixture is not invented: it is what `npm install --package-lock-only` actually produced for
// that manifest on npm 10.8.2, so the gate is being asked to accept a tree npm itself wrote. The
// root deliberately depends on `minimatch` rather than on `brace-expansion`, because overriding a
// *direct* dependency to a different spec is refused outright — `npm error code EOVERRIDE` — and a
// fixture npm will not install cannot show the gate agreeing with npm about anything.
expect(
  'npm\'s "." self-reference does pin the container',
  'pass',
  'lockfile-integrity: pass',
  runGate(
    'nested-self-reference',
    {
      name: 'fixture',
      version: '0.0.0',
      dependencies: { [SELF_REF_DEPENDENT]: '3.1.2' },
      overrides: { 'brace-expansion': { '.': '2.0.1' } },
    },
    {
      name: 'fixture',
      version: '0.0.0',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '0.0.0', dependencies: { [SELF_REF_DEPENDENT]: '3.1.2' } },
        'node_modules/balanced-match': { version: '1.0.2' },
        'node_modules/brace-expansion': {
          version: '2.0.1',
          dependencies: { 'balanced-match': '^1.0.0' },
        },
        [`node_modules/${SELF_REF_DEPENDENT}`]: {
          version: '3.1.2',
          dependencies: { 'brace-expansion': '^1.1.7' },
        },
      },
    },
  ),
);

// ---------------------------------------------------------------------------------------------
// 14/15. A scoped name carries its own leading `@`, so the key has to split on the LAST one. Split
//     on the first and `"@scope/pkg@^2.0.0"` becomes the name `""` with range `scope/pkg@^2.0.0`,
//     and both of these go the wrong way.
// ---------------------------------------------------------------------------------------------
const SCOPED_OVERRIDE = { '@emnapi/core@^2.0.0': '2.1.0' };
expect(
  'scoped name with a selector: in-scope edge stays excused',
  'pass',
  'lockfile-integrity: pass',
  runGate(
    'scoped-in-scope',
    { name: 'fixture', version: '0.0.0', overrides: SCOPED_OVERRIDE },
    lockWithEdge({ name: '@emnapi/core', spec: '2.0.1', resolvedVersion: '2.1.0' }),
  ),
);
expect(
  'scoped name with a selector: out-of-scope edge is reported',
  'fail',
  'requires @emnapi/core@1.11.2',
  runGate(
    'scoped-out-of-scope',
    { name: 'fixture', version: '0.0.0', overrides: SCOPED_OVERRIDE },
    lockWithEdge({ name: '@emnapi/core', spec: '1.11.2', resolvedVersion: '1.11.3' }),
  ),
);

// ---------------------------------------------------------------------------------------------
// 16. An override never excuses a ROOT edge, because npm refuses to install that tree at all:
//
//       dependencies: { "brace-expansion": "1.1.11" }, overrides: { "brace-expansion": "2.0.1" }
//       npm error code EOVERRIDE
//       npm error Override for brace-expansion@1.1.11 conflicts with direct dependency
//
//     Waiving it hid the very condition the gate claims to check — that `npm ci` will not refuse
//     this tree. Run against the implementation before this control existed, it reports `pass`.
// ---------------------------------------------------------------------------------------------
expect(
  'an override does not excuse a root edge (npm refuses that tree with EOVERRIDE)',
  'fail',
  'requires brace-expansion@1.1.11',
  runGate(
    'root-edge-not-waived',
    { name: 'fixture', version: '0.0.0', overrides: { 'brace-expansion': '2.0.1' } },
    {
      name: 'fixture',
      version: '0.0.0',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '0.0.0', dependencies: { 'brace-expansion': '1.1.11' } },
        'node_modules/brace-expansion': { version: '2.0.1' },
      },
    },
  ),
);

// ---------------------------------------------------------------------------------------------
// 17. The name half of the invariant, which no override touches: an edge whose package is not in
//    the lock at all.
// ---------------------------------------------------------------------------------------------
expect(
  'an edge with no lock entry at all is reported',
  'fail',
  'absent from the lock',
  runGate(
    'absent-entry',
    { name: 'fixture', version: '0.0.0' },
    lockWithEdge({ name: 'brace-expansion', spec: '^1.1.7', resolvedVersion: null }),
  ),
);

// ---------------------------------------------------------------------------------------------
// 18. The Phase 2 failure itself, fixed in NXSAT-673: the lockfile originally had nested
//    `@emnapi/*` entries at 1.11.2 under `@oxc-resolver/binding-wasm32-wasi` that a bare
//    `npm install` on macOS would prune, causing version mismatches with top-level 1.11.3.
//    The fix hoisted @emnapi/core and @emnapi/runtime to the top level and removed the nested
//    copies. This control verifies the fix stays in place: if nested @emnapi entries at the
//    wrong version reappear (under any path), the gate catches them.
// ---------------------------------------------------------------------------------------------
{
  const lock = JSON.parse(readFileSync(REAL_LOCK, 'utf8'));
  const manifest = JSON.parse(readFileSync(REAL_MANIFEST, 'utf8'));
  // The fix removed node_modules/@oxc-resolver/.../node_modules/@emnapi/* entries.
  // They may exist elsewhere (e.g. under storybook or nx) at correct versions.
  // This control adds back a problematic nested entry at the old wrong version to verify
  // the gate would catch a regression.
  const testLock = structuredClone(lock);
  const WRONG_VERSION = '1.11.2';
  const problematicEntry = {
    version: WRONG_VERSION,
    resolved: `https://registry.npmjs.org/@emnapi/core/-/core-${WRONG_VERSION}.tgz`,
    integrity: 'sha512-TC8MkTuZUtcTSiFeuC0ksCh9QIJ5+F21MvZ4Wn4ORfYaFJ/0dsiudv5tVkejgwZlwQ39jL9WWDe2lz8x0WglOA==',
    dev: true,
    license: 'MIT',
    dependencies: { tslib: '^2.4.0' },
  };
  testLock.packages['node_modules/@oxc-resolver/binding-wasm32-wasi/node_modules/@emnapi/core'] =
    problematicEntry;
  expect(
    'Phase 2 regression: nested @emnapi/core at wrong version under @oxc-resolver should fail',
    'fail',
    'at 1.11.2',
    runGate('phase2-emnapi-wrong-version', manifest, testLock),
  );
}

// ---------------------------------------------------------------------------------------------
// 19. At least one of the real manifest's override keys is load-bearing: with that key removed,
//     the real lock goes red on the edge it was waiving. The pass in control 1 is therefore the
//     override waiver excusing those edges, not the version check failing to look.
//
//     The key is found rather than named. This control used to remove `brace-expansion@^5.0.0`,
//     which was load-bearing when it was written and stopped being so under Nx 23: nx then
//     requests `brace-expansion` at exactly the version the lock holds, so the waiver has nothing
//     to excuse and removing it changes nothing. The control went green-by-vacuity — the very
//     failure it exists to rule out for control 1. Searching keeps it honest as the tree moves;
//     only "no key is load-bearing" can now pass for the wrong reason, and that throws.
// ---------------------------------------------------------------------------------------------
{
  const lock = JSON.parse(readFileSync(REAL_LOCK, 'utf8'));
  const manifest = JSON.parse(readFileSync(REAL_MANIFEST, 'utf8'));
  const keys = Object.keys(manifest.overrides ?? {});
  if (keys.length === 0) {
    throw new Error(
      'the real manifest declares no overrides — this control would have passed for the wrong reason',
    );
  }

  let found = null;
  for (const key of keys) {
    const without = JSON.parse(JSON.stringify(manifest));
    delete without.overrides[key];
    const result = runGate(`real-lock-no-override-${key.replace(/[^\w.-]/g, '_')}`, without, lock);
    if (result.code === 1 && result.out.includes('requires ')) {
      found = { key, result };
      break;
    }
  }

  if (!found) {
    throw new Error(
      `removing each of the ${keys.length} override key(s) in turn left the real lock green, so ` +
        'control 1 does not depend on the override waiver and this control cannot prove it does. ' +
        'Either the waiver is dead code or the lock no longer needs it — decide which, do not ' +
        'delete this control.',
    );
  }

  expect(
    `real lock goes red on ${found.key} once its override key is removed`,
    'fail',
    'requires ',
    found.result,
  );
}

// ---------------------------------------------------------------------------------------------
// 20-23. The degraded path, with `semver` genuinely unresolvable. It is reached through npm's own
//        tree rather than declared, so it can be absent — and it was the one branch no control
//        covered, which is why it had `return true` for the whole waiver. Ancestry is string
//        matching and an exact value is a string comparison, so both must still apply there.
// ---------------------------------------------------------------------------------------------
expect(
  'no semver: a nested override still does not waive an unrelated dependent',
  'fail',
  'requires child@1.0.0',
  runGate(
    'no-semver-nested-unrelated',
    { name: 'fixture', version: '0.0.0', overrides: NESTED_OVERRIDE },
    {
      name: 'fixture',
      version: '0.0.0',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '0.0.0', dependencies: { other: '1.0.0' } },
        'node_modules/other': { version: '1.0.0', dependencies: { child: '1.0.0' } },
        'node_modules/child': { version: '2.0.0' },
      },
    },
    { hideSemver: true },
  ),
);
expect(
  'no semver: a stale exact resolution is still not waived',
  'fail',
  'requires axios@1.18.1',
  runGate(
    'no-semver-stale-value',
    { name: 'fixture', version: '0.0.0', overrides: { axios: '1.21.0' } },
    bareKeyLock,
    { hideSemver: true },
  ),
);
expect(
  'no semver: a RANGE value is left unjudged rather than read as an exact version',
  'pass',
  'lockfile-integrity: pass',
  runGate(
    'no-semver-range-value',
    { name: 'fixture', version: '0.0.0', overrides: { axios: '1.20.0 || 2.0.0' } },
    bareKeyLock,
    { hideSemver: true },
  ),
);
expect(
  'no semver: the real lock still passes (the degradation does not cry wolf)',
  'pass',
  'lockfile-integrity: pass',
  runGate(
    'no-semver-real-lock',
    JSON.parse(readFileSync(REAL_MANIFEST, 'utf8')),
    JSON.parse(readFileSync(REAL_LOCK, 'utf8')),
    { hideSemver: true },
  ),
);

rmSync(workspace, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
// The split is reported rather than a total, because only the negative controls prove the gate
// can fail; the positive ones prove it does not cry wolf, and reading the total as failure-path
// coverage overstates it. Review on PR #300 caught exactly that wording.
const negatives = results.filter((r) => r.expected === 'fail').length;
const positives = results.length - negatives;
const split = `${negatives} negative (must report) + ${positives} positive (must stay quiet)`;
console.log();
if (failed.length === 0) {
  console.log(`lockfile-integrity selftest: pass — ${results.length} control(s): ${split}.`);
  process.exit(0);
}
console.error(
  `lockfile-integrity selftest: FAIL — ${failed.length} of ${results.length} control(s) (${split}) did not behave as specified:`,
);
for (const f of failed) console.error(`  - ${f.name} (expected ${f.expected})`);
process.exit(1);
