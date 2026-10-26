#!/usr/bin/env node
/**
 * Lockfile integrity gate.
 *
 * ## Why this exists
 *
 * Phase 2's local gates were green for its entire duration while CI was red. A
 * bare `npm install` on macOS pruned optional platform entries the Linux runner
 * needs — `@oxc-resolver/binding-wasm32-wasi`'s nested `@emnapi/core` and
 * `@emnapi/runtime` — and `npm ci` on Linux then refused the whole tree. None of
 * `guardrails`, `lint`, `test` or `build` reads `package-lock.json`, so nothing
 * local could see it.
 *
 * ## Why not just `npm ci --dry-run`
 *
 * Because it would not have caught this. `npm ci` only demands the entries the
 * *current* platform resolves, so on macOS the pruned Linux-only subtree is
 * never looked at and the dry run passes. The gate has to be
 * platform-independent to be worth having, so it checks the invariant directly
 * rather than asking npm to check it for the wrong platform.
 *
 * ## The invariant
 *
 * For every package entry in the lock, each of its non-optional `dependencies`
 * must be resolvable within the lock by Node's own lookup — walk up the
 * `node_modules` chain from the dependent's own path to the root — **and the
 * entry found must actually satisfy the declared version**.
 *
 * The version half is not decoration; it is the whole failure. Name resolution
 * alone passes on the very lock that broke CI: pruning
 * `binding-wasm32-wasi/node_modules/@emnapi/core@1.11.2` leaves the top-level
 * `@emnapi/core@1.11.3` to satisfy the walk by name, while the dependent pins
 * `1.11.2` exactly and `npm ci` refuses with "Missing: @emnapi/core@1.11.2".
 *
 * Version checking is deliberately conservative, because a gate that cries wolf
 * gets switched off: exact pins are compared directly, ranges are checked only
 * when `semver` is resolvable, and anything that is not a plain version or range
 * — `npm:` aliases, `file:`, `git+`, `workspace:`, URLs, dist-tags — is left to
 * the name check alone.
 *
 * `optionalDependencies` are deliberately not required: npm legitimately omits
 * an optional package that no platform in the tree needs, and demanding them
 * would make this gate cry wolf on every lockfile.
 *
 * Usage:
 *   node scripts/beta-harness/lockfile-integrity.mjs [--lock <path>]
 *
 * Exit code is 1 if any dependency is unresolvable.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseOverrideKey } from './override-presence.mjs';

const args = process.argv.slice(2);
const lockIndex = args.indexOf('--lock');
const lockPath = resolve(lockIndex >= 0 ? args[lockIndex + 1] : 'package-lock.json');

/** @type {{ lockfileVersion?: number, packages?: Record<string, any> }} */
let lock;
try {
  lock = JSON.parse(await readFile(lockPath, 'utf8'));
} catch (error) {
  console.error(`lockfile-integrity: cannot read ${lockPath}\n  ${error.message}`);
  process.exit(1);
}

if (!lock.packages) {
  console.error(
    `lockfile-integrity: ${lockPath} has no "packages" map — lockfileVersion ${lock.lockfileVersion ?? '?'} is too old to verify.`,
  );
  process.exit(1);
}

const entries = lock.packages;
const problems = [];
let checked = 0;

/**
 * Packages force-resolved by `overrides`, each with the version selector its key carried.
 *
 * Read from the `package.json` beside the lock, because npm does not record `overrides` in
 * the lockfile — the root `packages[""]` entry omits it, so reading from there silently
 * yielded an empty set and every override still reported as a defect.
 */
const manifestPath = resolve(dirname(lockPath), 'package.json');
/** @type {Map<string, { range: string | null }[]>} */
let overrideRules = new Map();
try {
  overrideRules = collectOverrideRules(
    JSON.parse(await readFile(manifestPath, 'utf8')).overrides ?? {},
  );
} catch {
  // No manifest beside the lock (a bare fixture): treat nothing as overridden, which is
  // the strict reading rather than the permissive one.
}

/** `semver` ships with npm's own tree; use it when present, never require it. */
let semver = null;
try {
  semver = (await import('semver')).default ?? (await import('semver'));
} catch {
  /* range checking degrades to exact-pin comparison */
}

for (const [path, entry] of Object.entries(entries)) {
  // A `link` entry is a workspace symlink; its real content lives at `resolved`.
  if (entry.link) continue;
  // `devDependencies` as well as `dependencies`, and the omission mattered: the root
  // entry declares 52 dev edges that this gate never resolved. `npm ci` refuses a tree
  // with a pruned devDependency exactly as it refuses a pruned production one, and
  // "npm ci will not refuse this tree on Linux" is the only claim this gate makes. All 52
  // resolve today, so this closes a hole rather than fixing a live break — but the hole
  // is the same shape as the one that kept CI red for the whole of Phase 2.
  //
  // Still excluded, both deliberately:
  //   - `optionalDependencies` — npm legitimately omits an optional package no platform
  //     in the tree needs; demanding them would fail on a correct lock.
  //   - `peerDependencies` — npm permits an unmet peer. Requiring them would report
  //     hundreds of false problems on a tree `npm ci` installs without complaint.
  for (const kind of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(entry[kind] ?? {})) {
      checked += 1;
      const found = resolveFrom(path, name);
      if (!found) {
        problems.push({
          dependent: path || '<root>',
          missing: name,
          spec,
          reason: `absent from the lock (declared in ${kind})`,
        });
        continue;
      }
      const actual = entries[found].version;
      if (actual && !satisfiesSpec(actual, spec) && !isOverridden(name, spec, actual, path)) {
        problems.push({
          dependent: path || '<root>',
          missing: name,
          spec,
          reason: `resolves to ${found} at ${actual}, which does not satisfy "${spec}" (${kind})`,
        });
      }
    }
  }
}

/**
 * Is this dependency edge force-resolved by an `overrides` entry in `package.json`?
 *
 * An override exists precisely to install a version some dependency did not ask for —
 * `main`'s block pins 21 transitive packages to patched releases for CVEs — so the
 * resulting range violation is the override working, not a broken lock. Reporting it as
 * "unresolvable" made 24 deliberate security pins look like corruption, which is how a
 * gate teaches people that its output is noise.
 *
 * The waiver is per *edge*, not per package name, because an override key may be scoped to one
 * version line: `"brace-expansion@^5.0.0": "5.0.12"` pins only the v5 copies. Waiving the bare
 * name instead excused every `brace-expansion` edge in a tree that also holds v1 and v2 copies,
 * so a malformed v1 or v2 edge — including a pruned nested copy whose v1 request then walks up to
 * the overridden v5 root entry, which is the Phase 2 failure this gate exists for — was accepted
 * silently.
 *
 * An override entry has two halves and they answer different questions, which is the distinction
 * this got wrong once already by testing the resolved version against the selector:
 *
 *   1. the **key's selector** decides which requests the rule applies to. npm matches it against
 *      the dependency's declared spec, so an edge asking for `^1.1.7` is outside `^5.0.0` and npm
 *      leaves it alone;
 *   2. the **value** is what the override installs. That, not the selector, is what the resolved
 *      version has to be: under `"brace-expansion@^5.0.0": "5.0.12"` a stale 5.0.11 satisfies the
 *      selector while being a version nothing in the tree asked for and the override does not
 *      produce, and the mirror case — a legitimate cross-major `"x@^1.0.0": "2.0.0"` — resolves
 *      outside its own selector by design and must not be reported.
 *
 * A bare key (`"axios": "1.20.0"`) carries no selector, so it applies to every request for that
 * name — but its value still has to be what is installed. Degradations, each so the gate does not
 * cry wolf on what it cannot judge, and each as narrow as it can be: a selector that is not a valid
 * range — a dist-tag, say — applies to any request, and a value that is not a version or range,
 * such as npm's `"$dep"` back-reference, accepts any resolved version. Without `semver` resolvable
 * only ranges become unjudgeable: ancestry is string matching and an exact value is a string
 * comparison, so **both still apply**. Returning `true` for the whole waiver in that branch was a
 * defect of its own — it waived the nested-scope and stale-value cases that controls 10-13 and 6
 * exist to catch, in the one branch no control covered.
 *
 * A nested form (`{ "@angular/build": { "vite": "6.4.3" } }`) is an **ancestry-scoped** rule, not
 * a second global one: it pins `vite` beneath `@angular/build` and leaves every other `vite` edge
 * alone, and it does not pin `@angular/build` itself at all. Flattening it did both of those
 * wrong — the container got a waiver npm never granted it, and the inner pin waived unrelated
 * dependents' edges — so a rule now carries the scope it was nested under, and the container
 * contributes no rule of its own. npm's `"."` self-reference, which *does* pin the enclosing
 * package, is the only thing that gives a container a rule.
 *
 * Scope is matched on the lock's physical layout: the dependent is the scope package's own entry,
 * or lives inside its `node_modules`. That is an approximation of npm's graph ancestry and it is
 * deliberately the conservative half — a dependency hoisted out of the scope package's subtree
 * would be reported rather than waived. No edge in this lock relies on it, which the gate passing
 * is what demonstrates; the alternative, matching on the name alone, is the defect above.
 *
 * @param {string} name package name of the edge
 * @param {string} spec version range the dependent declared
 * @param {string} actual version the lock resolved it to
 * @param {string} dependentPath lock path of the package declaring the edge
 */
function isOverridden(name, spec, actual, dependentPath) {
  // The root's own edges are never excused. npm refuses an override that replaces a direct
  // dependency with a different spec — verified, not assumed:
  //
  //     dependencies: { "brace-expansion": "1.1.11" }, overrides: { "brace-expansion": "2.0.1" }
  //     npm error code EOVERRIDE
  //     npm error Override for brace-expansion@1.1.11 conflicts with direct dependency
  //
  // So a root edge an override appears to explain is a tree npm will not install, which is the
  // one claim this gate makes. Excusing it waived exactly the failure it exists to report. No
  // root edge on this lock is affected — 81 direct dependencies, three of them named in
  // `overrides` (`@angular/build`, `@angular-devkit/build-angular`, `vite`), none in violation —
  // so this closes a hole rather than fixing a live break.
  if (dependentPath === '') return false;
  const rules = overrideRules.get(name);
  if (!rules) return false;
  return rules.some(
    (rule) =>
      dependentIsWithin(dependentPath, rule.scope) &&
      selectorMatchesRequest(spec, rule.range) &&
      installedWhatItForces(actual, rule.value),
  );
}

/**
 * Does the key's selector cover this request? npm matches it against the declared spec.
 *
 * Without `semver` a range cannot be evaluated at all, so the selector is treated as covering the
 * request — the permissive half of the degradation, and the only one available.
 */
function selectorMatchesRequest(spec, range) {
  if (range === null) return true;
  if (!semver) return true;
  if (!semver.validRange(range) || !semver.validRange(spec)) return true;
  return semver.intersects(spec, range, { includePrerelease: true });
}

/**
 * Is the installed version the one this override forces?
 *
 * Without `semver` an exact value is still comparable as a string, and it is worth comparing: the
 * whole override block pins exact versions, so this keeps the check alive in the degraded path
 * rather than waiving everything. `$dep` back-references and range values stay unjudged.
 */
function installedWhatItForces(actual, value) {
  if (value === null) return true;
  if (!semver) return isExactVersion(value) ? actual === value : true;
  if (!semver.validRange(value)) return true;
  return semver.satisfies(actual, value, { includePrerelease: true });
}

/**
 * A plain `x.y.z` version — the only form comparable without `semver`, and therefore the only one
 * the degraded path may judge.
 *
 * Anchored at both ends, because unanchored it classified any range that merely *starts* with a
 * version as exact: `"1.20.0 || 2.0.0"` resolving to 1.20.0 was then rejected by string inequality,
 * which is the opposite of the documented fallback that leaves ranges unjudged. A prerelease or
 * build suffix is still exact — `1.2.3-beta.1` compares as a string perfectly well — while anything
 * containing a space, operator or wildcard is a range and is left alone. The unanchored form came
 * from `satisfiesSpec`'s own fallback and both call sites share this now, so it is fixed in both.
 */
function isExactVersion(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

/**
 * Is `dependentPath` the scope package or inside it? `null` scope is unscoped and matches anything.
 *
 * @param {string} dependentPath
 * @param {{ name: string, range: string | null } | null} scope
 */
function dependentIsWithin(dependentPath, scope) {
  if (scope === null) return true;
  const marker = `node_modules/${scope.name}`;
  if (dependentPath === marker || dependentPath.endsWith(`/${marker}`)) {
    return scopeVersionMatches(dependentPath, scope);
  }
  const nested = dependentPath.indexOf(`${marker}/`);
  if (nested === -1) return false;
  return scopeVersionMatches(dependentPath.slice(0, nested + marker.length), scope);
}

/** A scope key may itself carry a selector (`{ "vite@^6": { ... } }`); honour it when it does. */
function scopeVersionMatches(scopePath, scope) {
  if (scope.range === null) return true;
  const version = entries[scopePath]?.version;
  if (!version) return true;
  if (!semver) return isExactVersion(scope.range) ? version === scope.range : true;
  if (!semver.validRange(scope.range)) return true;
  return semver.satisfies(version, scope.range, { includePrerelease: true });
}

/**
 * Every package pinned anywhere in `overrides`, with the selector its key carried, the version it
 * forces, and the dependent it was nested under.
 *
 * Nesting deeper than one level keeps only the nearest ancestor as the scope. npm applies the
 * whole chain; matching the nearest is narrower than flattening and wider than the full chain,
 * and no override in this repository nests twice.
 *
 * @returns {Map<string, { range: string | null, value: string | null, scope: { name: string, range: string | null } | null }[]>}
 */
function collectOverrideRules(overrides) {
  /** @type {Map<string, { range: string | null, value: string | null, scope: object | null }[]>} */
  const rules = new Map();
  const add = (name, rule) => rules.set(name, [...(rules.get(name) ?? []), rule]);
  const walk = (node, scope) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      // `"."` pins the package whose object this is — the one case where a container is itself
      // overridden. Outside a container it addresses nothing.
      if (key === '.') {
        if (scope && typeof value === 'string') {
          add(scope.name, { range: scope.range, value, scope: scope.parent });
        }
        continue;
      }
      const { name, range } = parseOverrideKey(key);
      if (typeof value === 'string') add(name, { range, value, scope });
      // A nested object is a dependent scope rather than a pinned version, so it gets no rule of
      // its own; its children carry it as their scope.
      else if (value && typeof value === 'object') walk(value, { name, range, parent: scope });
    }
  };
  walk(overrides, null);
  return rules;
}

/**
 * True unless the version demonstrably fails the spec. Unknown spec forms return
 * true so the gate never fails on something it does not understand.
 *
 * @param {string} version
 * @param {string} spec
 */
function satisfiesSpec(version, spec) {
  if (typeof spec !== 'string' || spec === '' || spec === '*' || spec === 'latest') return true;
  // Aliases, filesystem, git, workspace protocols and URLs are out of scope.
  if (/^(npm:|file:|link:|git|https?:|workspace:)/.test(spec)) return true;
  if (semver) {
    if (!semver.validRange(spec)) return true;
    return semver.satisfies(version, spec, { includePrerelease: true });
  }
  // Without semver, only an exact pin can be judged safely.
  return isExactVersion(spec) ? version === spec : true;
}

/**
 * Node's resolution, applied to lock paths: try the dependent's own
 * `node_modules`, then each ancestor's, then the root.
 *
 * @param {string} dependentPath
 * @param {string} name
 */
function resolveFrom(dependentPath, name) {
  let scope = dependentPath;
  for (;;) {
    const candidate = scope === '' ? `node_modules/${name}` : `${scope}/node_modules/${name}`;
    if (entries[candidate]) return candidate;
    if (scope === '') return null;
    scope = enclosingPackagePath(scope);
  }
}

/**
 * The package directory that contains `path`'s own `node_modules`.
 *
 * `node_modules/a/node_modules/b` is enclosed by `node_modules/a`; a top-level
 * package, scoped or not, is enclosed by the root. Anything outside a
 * `node_modules` tree is a workspace, which also resolves from the root.
 *
 * @param {string} path
 */
function enclosingPackagePath(path) {
  const segments = path.split('/');
  const last = segments.lastIndexOf('node_modules');
  return last <= 0 ? '' : segments.slice(0, last).join('/');
}

if (problems.length === 0) {
  console.log(
    `lockfile-integrity: pass — ${checked} dependency edge(s) across ${Object.keys(entries).length} lock entries all resolve.`,
  );
  process.exit(0);
}

console.error(`lockfile-integrity: FAIL — ${problems.length} unresolvable dependency edge(s).`);
console.error(
  'The lockfile is missing entries that `npm ci` requires. This is what a bare\n' +
    '`npm install` on macOS does to optional platform subtrees. Do not "fix" it with\n' +
    'another bare install — restore a known-good lock and merge the new entries in.\n',
);
for (const { dependent, missing, spec, reason } of problems.slice(0, 25)) {
  console.error(`  ${dependent}\n    requires ${missing}@${spec} — ${reason}`);
}
if (problems.length > 25) console.error(`  ... and ${problems.length - 25} more`);
process.exit(1);
