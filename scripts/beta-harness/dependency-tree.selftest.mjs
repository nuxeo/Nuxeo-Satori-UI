#!/usr/bin/env node
/**
 * Controls for `dependency-tree.mjs` — proof that each of its five locations can actually fail.
 *
 * `CLAUDE.md`: *a gate is not evidence until you have seen it fail on purpose.* This one is
 * blocking since the ADF removal, so its own run in CI is green exactly when it finds nothing;
 * without these controls it could regress into a scanner that finds nothing, and it would wave a
 * returning package through with nobody seeing the difference. Every control builds a
 * throwaway repository under the OS temp directory and runs the real gate against it with
 * `--root`, so nothing tracked is touched.
 *
 * A detection control puts one package in exactly one location and runs in blocking mode; a gap
 * control makes one location uninspectable and expects exit 2 rather than a finding. Each asserts
 * the exit code **and** the line naming that location, because a control that checks only the exit
 * code cannot tell "red for my reason" from "red for an unrelated one". The fixture they
 * all start from carries the things that must stay quiet — comments and strings naming the
 * packages, a commented-out registry line, the `@hylandsoftware` mapping that stays, a package
 * installed at a version its manifest does not allow (which is what makes `npm ls` exit non-zero),
 * and an extraneous one (which npm 10 lists but still exits 0 for) — so every red also shows those
 * did not cause it.
 *
 * Package names never appear here in the shapes the `supply-chain` gate reads as a reference — a
 * `from '…'`, `import(…)` or `node_modules/…` literal. That gate scans `scripts/` for those to
 * decide whether a production dependency is used, so a fixture spelling one out would forge a
 * reference and hide a genuinely unused dependency midway through the removal. Every such string
 * is built by interpolation.
 *
 * Usage:  node scripts/beta-harness/dependency-tree.selftest.mjs
 */

import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  CONTROL_COUNT as SCAN_CONTROL_COUNT,
  selfCheck as scanSelfCheck,
} from './stylesheet-scan.mjs';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..', '..');
const GATE = join(ROOT, 'scripts', 'beta-harness', 'dependency-tree.mjs');
const NM = 'node_modules';

const HX = '@alfresco/adf-hx-content-services';
const CORE = '@alfresco/adf-core';
const EXT = '@alfresco/adf-extensions';
const JS_API = '@alfresco/js-api';
const HXCS = '@hylandsoftware/hxcs-js-client';
const ALL = [HX, CORE, EXT, JS_API, HXCS];
const VERSION = {
  [HX]: '7.20.0-automate.292',
  [CORE]: '9.0.0',
  [EXT]: '9.0.0',
  [JS_API]: '10.0.0',
  [HXCS]: '2.0.111',
};

const workspace = mkdtempSync(join(tmpdir(), 'dependency-tree-selftest-'));

// ------------------------------------------------------------------------------- fixtures ----

const CLEAN_DEPENDENCIES = { 'left-pad': '1.3.0', 'is-even': '1.0.0' };
const cleanManifest = () => ({
  name: 'fixture',
  version: '0.0.0',
  dependencies: { ...CLEAN_DEPENDENCIES },
});
const cleanLock = () => ({
  name: 'fixture',
  version: '0.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'fixture', version: '0.0.0', dependencies: { ...CLEAN_DEPENDENCIES } },
    [`${NM}/left-pad`]: { version: '1.3.0' },
    [`${NM}/is-even`]: { version: '1.0.0' },
  },
});

/**
 * The clean repository every control starts from. Everything in it must stay quiet, and the
 * positive control below proves it does.
 */
const cleanFiles = () => ({
  'package.json': cleanManifest(),
  'package-lock.json': cleanLock(),
  [`${NM}/left-pad/package.json`]: { name: 'left-pad', version: '1.3.0' },
  // Invalid — installed at a version the manifest does not allow — so `npm ls` exits 1 on this
  // tree, as it does on this repository's worktrees, and a green run proves the exit status is not
  // what the gate reads. An extraneous package alone is not enough: npm 10 lists it as a problem
  // and still exits 0.
  [`${NM}/is-even/package.json`]: { name: 'is-even', version: '0.9.0' },
  [`${NM}/is-odd/package.json`]: { name: 'is-odd', version: '3.0.1' },
  // A mapping is a line that starts with the key. A comment naming it, and a value merely
  // containing it, are not mappings.
  '.npmrc':
    '@hylandsoftware:registry=https://npm.pkg.github.com\n' +
    `# @alfresco:registry=https://npm.pkg.github.com\n` +
    `; @alfresco:registry=https://npm.pkg.github.com\n` +
    `init-license=moved off @alfresco:registry=https://npm.pkg.github.com\n`,
  'libs/ui/package.json': {
    name: '@fixture/ui',
    version: '0.0.0',
    peerDependencies: { '@angular/core': '^20.0.0' },
  },
  'libs/ui/src/index.ts': `import { Component } from '@angular/core';\nexport { Component };\n`,
  // Mentions in a comment and a string are not imports.
  'libs/ui/src/history.ts':
    `// This used to be: import { X } ${'from'} '${CORE}';\n` +
    `/* and ${'require'}('${JS_API}') before that */\n` +
    `export const RETIRED = ['${HX}', '${EXT}', '${HXCS}'];\n`,
  // A commented-out @use, and @import text inside a string value: neither is an import.
  'libs/ui/src/theme.scss':
    `// @use '${CORE}/theming';\n.a { color: red; }\n` +
    `.a::before { content: "@import '${CORE}/theming';"; }\n`,
  'apps/web/src/main.ts': `import '@hylandsoftware/satori-ui';\n`,
});

/** Write a fixture repository: the clean files, with `changes` applied (`undefined` deletes). */
function fixture(name, changes = {}) {
  const dir = join(workspace, name);
  const files = { ...cleanFiles(), ...changes };
  for (const [rel, content] of Object.entries(files)) {
    if (content === undefined) continue;
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

function lockWith(entries) {
  const lock = cleanLock();
  Object.assign(lock.packages, entries);
  return lock;
}

/**
 * A clean fixture whose `npm` prints `output` — for the shapes a real npm does not produce on
 * demand. The stand-in sits outside apps/, libs/ and tools/, so nothing scans it.
 */
function withFakeNpm(name, output) {
  const dir = fixture(name, { 'fake-bin/ls.json': output });
  const npm = join(dir, 'fake-bin', 'npm-cli.js');
  writeFileSync(
    npm,
    `process.stdout.write(require('node:fs').readFileSync(require('node:path').join(__dirname, 'ls.json'), 'utf8'));`,
  );
  return { dir, env: { ...process.env, npm_execpath: npm } };
}

// -------------------------------------------------------------------------------- harness ----

/** @type {{ name: string, expected: 'pass'|'fail'|'gap', kind: Kind, because: (string|RegExp)[], dir: string, env?: NodeJS.ProcessEnv, args: string[] }[]} */
const controls = [];
const EXIT = { pass: 0, fail: 1, gap: 2 };

/**
 * What a control proves, which its exit code alone does not say: a report-only run that lists
 * findings exits 0 like a clean one, and counting it as "stayed quiet" overstated the evidence
 * that the gate does not cry wolf.
 *
 * @typedef {'negative' | 'quiet' | 'listing'} Kind
 *   negative  must fail or report a gap
 *   quiet     must pass and report nothing
 *   listing   must pass and list findings — report-only doing its job
 */

/**
 * @param {string} name
 * @param {'pass'|'fail'|'gap'} expected  `gap` is exit 2, "could not inspect"
 * @param {string|RegExp|(string|RegExp)[]} because  what the output must contain
 * @param {string | { dir: string, env: NodeJS.ProcessEnv }} where  fixture root, or a root and
 *   the environment to run the gate in
 * @param {string[]} [args]  defaults to blocking mode with every importing file listed
 * @param {Kind} [kind]  defaults to `negative` for a failure and `quiet` for a pass
 */
function control(name, expected, because, where, args = ['--blocking', '--list-files'], kind) {
  const { dir, env } = typeof where === 'string' ? { dir: where } : where;
  controls.push({
    name,
    expected,
    kind: kind ?? (expected === 'pass' ? 'quiet' : 'negative'),
    because: [because].flat(),
    dir,
    env,
    args,
  });
}

/** The whole output is one JSON object: nothing printed as text before or after it. */
const ONLY_JSON_EXIT_2 = /^\s*\{[\s\S]*"exitCode": 2,[\s\S]*\}\s*$/;

async function runGate(dir, args, env) {
  try {
    const { stdout, stderr } = await run('node', [GATE, '--root', dir, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env,
    });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (error) {
    return {
      code: typeof error.code === 'number' ? error.code : -1,
      out: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

const results = [];
function judge(c, result) {
  const wanted = EXIT[c.expected];
  const codeOk = result.code === wanted;
  const missing = c.because.filter((b) =>
    b instanceof RegExp ? !b.test(result.out) : !result.out.includes(b),
  );
  const ok = codeOk && missing.length === 0;
  results.push({ name: c.name, expected: c.expected, kind: c.kind, ok });
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${c.name} — expected ${c.expected}, got exit ${result.code}`,
  );
  if (!ok) {
    if (!codeOk) console.log(`       exit ${result.code}, wanted ${wanted}`);
    for (const b of missing) console.log(`       output did not contain: ${b}`);
    console.log(
      result.out
        .trimEnd()
        .split('\n')
        .map((l) => `       | ${l}`)
        .join('\n'),
    );
  }
}

// ---------------------------------------------------------------------------- 1. lockfile ----

// 1-5. Each package as a top-level lock entry, and nowhere else.
for (const pkg of ALL) {
  control(
    `lockfile: ${pkg} as a top-level entry is reported`,
    'fail',
    `[lockfile] ${pkg}@${VERSION[pkg]} at ${NM}/${pkg}`,
    fixture(`lock-top-${pkg.replace(/\W/g, '_')}`, {
      'package-lock.json': lockWith({ [`${NM}/${pkg}`]: { version: VERSION[pkg] } }),
    }),
  );
}

// 6. Nested under an unrelated package — the shape a transitive dependency takes when it cannot be
//    hoisted. A check on top-level keys only would miss it.
control(
  'lockfile: a nested entry under another package is reported',
  'fail',
  `[lockfile] ${JS_API}@10.0.0 at ${NM}/x/${NM}/${JS_API}`,
  fixture('lock-nested', {
    'package-lock.json': lockWith({
      [`${NM}/x`]: { version: '1.0.0', dependencies: { [JS_API]: '10.0.0' } },
      [`${NM}/x/${NM}/${JS_API}`]: { version: '10.0.0' },
    }),
  }),
);

// 7. An npm alias is keyed by the alias, so a key-only check misses it; the entry carries the name.
control(
  'lockfile: an npm alias of a package is reported',
  'fail',
  `[lockfile] ${CORE}@9.0.0 at ${NM}/core-alias (npm alias "core-alias")`,
  fixture('lock-alias', {
    'package-lock.json': lockWith({ [`${NM}/core-alias`]: { name: CORE, version: '9.0.0' } }),
  }),
);

// -------------------------------------------------------------------------- 2. installed ----

// 8. Installed but declared nowhere — extraneous. Only `npm ls` can see this, and its exit status
//    says nothing about it (1 here only because of the fixture's invalid entry), so the finding has
//    to come from the tree.
control(
  'installed: an extraneous top-level install is reported',
  'fail',
  `[installed] ${CORE}@9.0.0 at ${NM}/${CORE} [extraneous] — under <root>`,
  fixture('installed-extraneous', {
    [`${NM}/${CORE}/package.json`]: { name: CORE, version: '9.0.0' },
  }),
);

// 9. Installed nested beneath a declared dependency, with no lock entry for it.
control(
  'installed: a nested install beneath a declared dependency is reported',
  'fail',
  `[installed] ${JS_API}@10.0.0 at ${NM}/x/${NM}/${JS_API} — under x`,
  fixture('installed-nested', {
    'package.json': { ...cleanManifest(), dependencies: { ...CLEAN_DEPENDENCIES, x: '1.0.0' } },
    'package-lock.json': (() => {
      const lock = lockWith({ [`${NM}/x`]: { version: '1.0.0' } });
      lock.packages[''].dependencies.x = '1.0.0';
      return lock;
    })(),
    [`${NM}/x/package.json`]: { name: 'x', version: '1.0.0', dependencies: { [JS_API]: '10.0.0' } },
    [`${NM}/x/${NM}/${JS_API}/package.json`]: { name: JS_API, version: '10.0.0' },
  }),
);

// Valid JSON that is not a tree parses without throwing, so a reader that only catches parse errors
// walks `[]` as an empty tree and skips `null` — either way the installed tree reads as clean.
control(
  'installed: npm ls printing JSON null is a gap, not a skipped tree',
  'gap',
  ['CANNOT INSPECT', 'npm ls --all --json printed null, not a dependency tree object'],
  withFakeNpm('gap-npm-ls-null', 'null\n'),
);
control(
  'installed: npm ls printing a JSON array is a gap, not an empty tree',
  'gap',
  ['CANNOT INSPECT', 'npm ls --all --json printed an array, not a dependency tree object'],
  withFakeNpm('gap-npm-ls-array', '[]\n'),
);
control(
  'installed: an npm ls tree whose "dependencies" is an array is a gap',
  'gap',
  ['CANNOT INSPECT', 'npm ls --all --json printed a tree whose "dependencies" is an array'],
  withFakeNpm('gap-npm-ls-dependencies-array', '{ "name": "fixture", "dependencies": [] }\n'),
);

// -------------------------------------------------------------------------- 3. manifests ----

// 10-12. The root manifest's three fields the plan names.
control(
  'manifest: a root dependency is reported',
  'fail',
  `[manifest] package.json dependencies.${HX} = ${VERSION[HX]}`,
  fixture('manifest-root-dep', {
    'package.json': {
      ...cleanManifest(),
      dependencies: { ...CLEAN_DEPENDENCIES, [HX]: VERSION[HX] },
    },
  }),
);
control(
  'manifest: a root devDependency is reported',
  'fail',
  `[manifest] package.json devDependencies.${JS_API} = 10.0.0`,
  fixture('manifest-root-dev', {
    'package.json': { ...cleanManifest(), devDependencies: { [JS_API]: '10.0.0' } },
  }),
);
control(
  'manifest: a nested root override is reported',
  'fail',
  `[manifest] package.json overrides.some-parent.${EXT}@^9.0.0 = 9.0.0`,
  fixture('manifest-root-override', {
    'package.json': {
      ...cleanManifest(),
      overrides: { 'some-parent': { [`${EXT}@^9.0.0`]: '9.0.0' } },
    },
  }),
);

// 13. The `libs/platform` peer: the one place no lock entry represents.
// The remaining dependency fields the gate claims to read, one control each, so deleting any of
// those branches turns something red.
control(
  'manifest: a root optionalDependency is reported',
  'fail',
  `[manifest] package.json optionalDependencies.${HXCS} = 2.0.111`,
  fixture('manifest-root-optional', {
    'package.json': { ...cleanManifest(), optionalDependencies: { [HXCS]: '2.0.111' } },
  }),
);
control(
  'manifest: a libs/ peerDependenciesMeta entry is reported',
  'fail',
  `[manifest] libs/platform/package.json peerDependenciesMeta.${EXT}`,
  fixture('manifest-libs-peer-meta', {
    'libs/platform/package.json': {
      name: '@fixture/platform',
      version: '0.1.0',
      peerDependenciesMeta: { [EXT]: { optional: true } },
    },
  }),
);
control(
  'manifest: a libs/ bundleDependencies entry is reported',
  'fail',
  `[manifest] libs/ui/package.json bundleDependencies[] ${JS_API}`,
  fixture('manifest-libs-bundle', {
    'libs/ui/package.json': { name: '@fixture/ui', version: '0.0.0', bundleDependencies: [JS_API] },
  }),
);
control(
  'manifest: a root bundledDependencies entry is reported',
  'fail',
  `[manifest] package.json bundledDependencies[] ${CORE}`,
  fixture('manifest-root-bundled', {
    'package.json': { ...cleanManifest(), bundledDependencies: [CORE] },
  }),
);

// npm's `"."` replaces the enclosing package itself, so an alias there swaps a harmless-looking
// name for a forbidden one without either key naming it.
control(
  'manifest: an npm: alias in an override\'s "." entry is reported',
  'fail',
  `[manifest] package.json overrides.some-parent["."] = npm:${CORE}@9.0.0`,
  fixture('manifest-override-self-alias', {
    'package.json': {
      ...cleanManifest(),
      overrides: { 'some-parent': { '.': `npm:${CORE}@9.0.0` } },
    },
  }),
);

control(
  'manifest: a libs/*/package.json peer is reported',
  'fail',
  `[manifest] libs/platform/package.json peerDependencies.${EXT} = ^9.0.0`,
  fixture('manifest-libs-peer', {
    'libs/platform/package.json': {
      name: '@fixture/platform',
      version: '0.1.0',
      peerDependencies: { [EXT]: '^9.0.0' },
    },
  }),
);

// 14. Deeper than one level, and as an alias value — `libs/**`, not `libs/*`.
control(
  'manifest: a deep libs/**/package.json npm: alias is reported',
  'fail',
  `[manifest] libs/shared/deep/package.json dependencies.hxcs = npm:${HXCS}@2.0.111`,
  fixture('manifest-libs-deep-alias', {
    'libs/shared/deep/package.json': {
      name: '@fixture/deep',
      version: '0.0.0',
      dependencies: { hxcs: `npm:${HXCS}@2.0.111` },
    },
  }),
);

// ------------------------------------------------------------------------------ 4. .npmrc ----

control(
  '.npmrc: an @alfresco registry mapping is reported',
  'fail',
  '[npmrc] .npmrc:5 @alfresco:registry=https://npm.pkg.github.com',
  fixture('npmrc-mapping', {
    '.npmrc': `${cleanFiles()['.npmrc']}@alfresco:registry=https://npm.pkg.github.com\n`,
  }),
);
control(
  '.npmrc: an indented mapping with spaces round = is reported',
  'fail',
  '[npmrc] .npmrc:1 @alfresco:registry = https://registry.npmjs.org/',
  fixture('npmrc-spaced', { '.npmrc': '   @alfresco:registry = https://registry.npmjs.org/\n' }),
);

// The root-level inputs are read by path, not walked, so each needs the containment check the walk
// applies: a committed link to a runner's or user's file makes the verdict depend on that host.
{
  const outside = join(workspace, 'outside-root-files');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'npmrc'), '@alfresco:registry=https://npm.pkg.github.com\n');
  writeFileSync(join(outside, 'package-lock.json'), JSON.stringify(cleanLock(), null, 2));
  writeFileSync(join(outside, 'package.json'), JSON.stringify(cleanManifest(), null, 2));
  for (const [file, target] of [
    ['.npmrc', 'npmrc'],
    ['package-lock.json', 'package-lock.json'],
    ['package.json', 'package.json'],
  ]) {
    const dir = fixture(`gap-root-link-outside-${file.replace(/\W/g, '_')}`, { [file]: undefined });
    symlinkSync(join(outside, target), join(dir, file));
    control(
      `a root ${file} that links outside the repository is a gap, not read`,
      'gap',
      ['CANNOT INSPECT', `${file}: links outside the repository`],
      dir,
    );
  }
}
{
  // Inside the repository a link is just a file: the check must not turn every link into a gap.
  const dir = fixture('npmrc-link-inside-root', {
    '.npmrc': undefined,
    'config/npmrc': '@alfresco:registry=https://npm.pkg.github.com\n',
  });
  symlinkSync(join('config', 'npmrc'), join(dir, '.npmrc'));
  control(
    '.npmrc: a link to a file inside the repository is read',
    'fail',
    '[npmrc] .npmrc:1 @alfresco:registry=https://npm.pkg.github.com',
    dir,
  );
}

// ----------------------------------------------------------------------------- 5. imports ----

control(
  'import: a named import in libs/ is reported',
  'fail',
  `[import] libs/ui/src/columns.ts ${CORE}`,
  fixture('import-named', {
    'libs/ui/src/columns.ts': `import type { DataColumn } ${'from'} '${CORE}';\nexport type C = DataColumn;\n`,
  }),
);
control(
  'import: a subpath re-export in apps/ is reported',
  'fail',
  `[import] apps/web/src/barrel.ts ${HX}/ui`,
  fixture('import-reexport', {
    'apps/web/src/barrel.ts': `export * ${'from'} '${HX}/ui';\n`,
  }),
);
control(
  'import: a dynamic import() in a spec is reported',
  'fail',
  `[import] libs/ui/src/lazy.spec.ts ${EXT} (spec)`,
  fixture('import-dynamic', {
    'libs/ui/src/lazy.spec.ts': `const m = await ${'import'}('${EXT}');\nexport default m;\n`,
  }),
);
// Mid-file, after executable code: a scanner that reads only the leading import prologue misses it.
control(
  'import: a lazy-route import() after executable code is reported',
  'fail',
  `[import] libs/ui/src/routes.ts ${CORE}/columns`,
  fixture('import-dynamic-mid-file', {
    'libs/ui/src/routes.ts':
      `import { Routes } ${'from'} '@angular/router';\n` +
      `const title = 'Columns';\n` +
      `export const routes: Routes = [\n` +
      `  { path: 'columns', title, loadComponent: () => ${'import'}('${CORE}/columns').then((m) => m.Columns) },\n` +
      `];\n`,
  }),
);
// Only node_modules and .git are skipped by name; a source directory called `tmp` is source.
control(
  'import: a file under a source directory named tmp is reported',
  'fail',
  `[import] libs/ui/src/tmp/legacy.ts ${HXCS}`,
  fixture('import-under-tmp', {
    'libs/ui/src/tmp/legacy.ts': `import type { Document } ${'from'} '${HXCS}';\nexport type D = Document;\n`,
  }),
);
control(
  'import: a require() in a .cjs file is reported',
  'fail',
  `[import] libs/ui/tools/load.cjs ${HXCS}`,
  fixture('import-require', {
    'libs/ui/tools/load.cjs': `module.exports = ${'require'}('${HXCS}');\n`,
  }),
);
control(
  'import: a stylesheet @use is reported',
  'fail',
  `[import] libs/ui/src/styles.scss ${CORE}/theming`,
  fixture('import-scss', { 'libs/ui/src/styles.scss': `@use '${CORE}/theming' as adf;\n` }),
);

// Every target in a stylesheet statement, not the first quoted one.
control(
  'import: the second target of a comma-separated Sass @import is reported',
  'fail',
  `[import] libs/ui/src/multi.scss ${CORE}/theming`,
  fixture('import-scss-multi', {
    'libs/ui/src/multi.scss': `@import 'local',\n  '${CORE}/theming';\n`,
  }),
);
control(
  'import: an unquoted CSS url() target is reported',
  'fail',
  `[import] libs/ui/src/legacy.css ${HX}/ui/assets/theme.css`,
  fixture('import-css-url', {
    'libs/ui/src/legacy.css': `@import url(${HX}/ui/assets/theme.css);\n`,
  }),
);

// A `//` that is not a comment — inside a string, or an unquoted url() — must not blank the rest of
// the line and the import on it.
control(
  'import: an @use after a "//" inside a string is reported',
  'fail',
  `[import] libs/ui/src/marker.scss ${CORE}/theming`,
  fixture('import-scss-slashes-in-string', {
    'libs/ui/src/marker.scss': `$marker: "//"; @use '${CORE}/theming';\n`,
  }),
);
control(
  'import: a target after a url(//…) is reported',
  'fail',
  `[import] libs/ui/src/cdn.scss ${EXT}/styles`,
  fixture('import-scss-after-protocol-relative-url', {
    'libs/ui/src/cdn.scss': `@import url(//cdn.example/x.css), '${EXT}/styles';\n`,
  }),
);
// And string content is not syntax: a `;` inside a value does not start a statement, and the
// strings in a `with (…)` clause configure a module rather than load one.
control(
  'import: a ";" and @import inside a quoted value stay quiet',
  'pass',
  'dependency-tree: pass',
  fixture('import-scss-statement-in-string', {
    'libs/ui/src/quoted.scss': `.a { content: "; @import '${CORE}/theming';"; }\n`,
  }),
);
control(
  'import: strings in an @use or @forward with (…) clause stay quiet',
  'pass',
  'dependency-tree: pass',
  fixture('import-scss-with-clause', {
    'libs/ui/src/configured.scss':
      `@use 'theme' with ($label: '${CORE}/theming');\n` +
      `@forward 'tokens' with ($source: '${EXT}' !default);\n`,
  }),
);

// ------------------------------------------------------------------- 6. the gate's own rules ----

// Report-only must not be "cannot fail": a clean tree means the removal landed, and the gate has to
// be flipped to blocking in the same change.
control(
  'report-only on a clean tree fails and names the switch',
  'fail',
  ['the tree is clean but the gate is still report-only', 'Set BLOCKING = true'],
  fixture('report-only-clean'),
  ['--report-only'],
);

// An inspection gap is exit 2 in report-only mode too — a gap in the list is not a short list.
control(
  'report-only: an unreadable lock is a gap, not a pass',
  'gap',
  ['CANNOT INSPECT', 'package-lock.json: cannot read'],
  fixture('gap-lock', { 'package-lock.json': '{ "packages": ' }),
  ['--report-only'],
);
control(
  'no installed tree is a gap, not a clean tree',
  'gap',
  ['CANNOT INSPECT', 'node_modules/ is absent'],
  fixture('gap-no-install', {
    [`${NM}/left-pad/package.json`]: undefined,
    [`${NM}/is-even/package.json`]: undefined,
    [`${NM}/is-odd/package.json`]: undefined,
  }),
);

// A subtree the walker cannot enter must not drop out of the scan as if it were clean: a silent
// skip of an unreadable directory under libs/ takes every manifest and import beneath it out of a
// blocking run's verdict.
//
// Two controls for one branch, because only one of them runs everywhere. A scan root that is not a
// directory fails `readdirSync` with ENOTDIR for any user. A mode-000 directory is the realistic
// case, but root reads straight through it, so that control is not registered under UID 0 — and
// says so, rather than passing or failing for a reason that has nothing to do with the gate.
/** Directories made unreadable for a control; restored before the workspace is removed. */
const lockedDirs = [];
/** Controls not registered on this run, and why. Printed with the verdict, never counted. */
const notRun = [];
control(
  'a scan root that cannot be listed is a gap, not a clean tree',
  'gap',
  ['CANNOT INSPECT', 'libs/: cannot list'],
  fixture('gap-scan-root-not-a-directory', {
    'libs/ui/package.json': undefined,
    'libs/ui/src/index.ts': undefined,
    'libs/ui/src/history.ts': undefined,
    'libs/ui/src/theme.scss': undefined,
    libs: 'a file where the libs/ directory should be\n',
  }),
);
if (process.getuid?.() === 0) {
  notRun.push(
    'an unlistable directory under libs/ — running as root, which reads through mode 000; the scan-root control above covers the same branch',
  );
} else {
  const dir = fixture('gap-unlistable-dir', {
    'libs/locked/src/columns.ts': `import type { DataColumn } ${'from'} '${CORE}';\nexport type C = DataColumn;\n`,
  });
  const locked = join(dir, 'libs', 'locked');
  chmodSync(locked, 0o000);
  lockedDirs.push(locked);
  control(
    'an unlistable directory under libs/ is a gap, not a clean subtree',
    'gap',
    ['CANNOT INSPECT', 'libs/locked/: cannot list'],
    dir,
  );
}
control(
  'a --root that does not resolve is a gap, not a crash',
  'gap',
  ['CANNOT INSPECT', 'cannot be resolved'],
  join(workspace, 'no-such-repository'),
);
// The failures found before the scan starts are the ones automation most needs to read, so they
// honour --json like every other gap.
control(
  'with --json, a --root that does not resolve is reported as JSON',
  'gap',
  [ONLY_JSON_EXIT_2, '"verdict": "CANNOT INSPECT', 'cannot be resolved'],
  join(workspace, 'no-such-repository'),
  ['--json'],
);
control(
  'with --json, contradictory mode flags are reported as JSON',
  'gap',
  [ONLY_JSON_EXIT_2, 'contradict each other'],
  fixture('json-contradictory-flags'),
  ['--blocking', '--report-only', '--json'],
);
// Valid JSON of the wrong shape parses without throwing, so a reader that only catches parse
// errors returns nothing and the file drops out of the scan.
control(
  'a lock whose "packages" is an array is a gap, not an empty lock',
  'gap',
  ['CANNOT INSPECT', 'package-lock.json has no "packages" map'],
  fixture('gap-lock-packages-array', { 'package-lock.json': { ...cleanLock(), packages: [] } }),
);
{
  // A link out of the repository: not followed, and not silently skipped.
  const dir = fixture('gap-link-outside-root');
  const outside = join(workspace, 'outside-the-repository');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'columns.ts'), `import type { DataColumn } ${'from'} '${CORE}';\n`);
  symlinkSync(outside, join(dir, 'libs', 'escape'));
  control(
    'a link that leaves the repository is a gap, not followed or skipped',
    'gap',
    ['CANNOT INSPECT', 'libs/escape: links outside the repository'],
    dir,
  );
}
control(
  'a lock that is valid JSON but not an object is a gap',
  'gap',
  ['CANNOT INSPECT', 'package-lock.json: is null, not a JSON object'],
  fixture('gap-lock-null', { 'package-lock.json': 'null\n' }),
);
control(
  'a manifest that is valid JSON but not an object is a gap',
  'gap',
  ['CANNOT INSPECT', 'libs/ui/package.json: is an array, not a JSON object'],
  fixture('gap-manifest-array', { 'libs/ui/package.json': '[]\n' }),
);
{
  const dir = fixture('gap-npmrc-dangling-link', { '.npmrc': undefined });
  symlinkSync('./npmrc-that-moved', join(dir, '.npmrc'));
  control(
    'a dangling .npmrc link is a gap, not an absent .npmrc',
    'gap',
    ['CANNOT INSPECT', '.npmrc: cannot read'],
    dir,
  );
}
control(
  'an unreadable .npmrc is a gap, not an absent mapping',
  'gap',
  ['CANNOT INSPECT', '.npmrc: cannot read'],
  fixture('gap-npmrc-unreadable', { '.npmrc': undefined, '.npmrc/placeholder': '' }),
);
{
  const dir = fixture('gap-dangling-link');
  symlinkSync('./does-not-exist.ts', join(dir, 'apps', 'web', 'src', 'gone.ts'));
  {
    // The scan root itself: `existsSync` follows the link and says "no libs/", which reads as an
    // empty tree.
    const dir = fixture('gap-dangling-scan-root', {
      'libs/ui/package.json': undefined,
      'libs/ui/src/index.ts': undefined,
      'libs/ui/src/history.ts': undefined,
      'libs/ui/src/theme.scss': undefined,
    });
    rmSync(join(dir, 'libs'), { recursive: true, force: true });
    symlinkSync('./moved-away', join(dir, 'libs'));
    control(
      'a scan root that is a dangling link is a gap, not an absent directory',
      'gap',
      ['CANNOT INSPECT', 'libs: cannot resolve link'],
      dir,
    );
  }
  control(
    'a link that cannot be resolved is a gap, not a skipped file',
    'gap',
    ['CANNOT INSPECT', 'apps/web/src/gone.ts: cannot resolve link'],
    dir,
  );
}
{
  // Followed rather than skipped: a symlinked directory is source the build would compile.
  const dir = fixture('import-through-symlink', {
    'vendor/shared/columns.ts': `import type { DataColumn } ${'from'} '${CORE}';\nexport type C = DataColumn;\n`,
  });
  symlinkSync(join('..', 'vendor', 'shared'), join(dir, 'libs', 'linked'));
  control(
    'import: a file reached through a symlinked directory is reported',
    'fail',
    `[import] libs/linked/columns.ts ${CORE}`,
    dir,
  );
}

// ------------------------------------------------------------------------- positive controls ----

control(
  'clean fixture passes in blocking mode, with npm ls exiting non-zero',
  'pass',
  ['dependency-tree: pass', 'npm ls exited 1'],
  fixture('clean'),
);

// Exact names, not prefixes: a check loosened to `startsWith` or `includes` goes red here.
control(
  'lookalike names stay quiet in every location',
  'pass',
  'dependency-tree: pass',
  fixture('lookalikes', {
    'package.json': {
      ...cleanManifest(),
      dependencies: { ...CLEAN_DEPENDENCIES, [`${CORE}-shim`]: '1.0.0' },
      devDependencies: { [`${JS_API}-types`]: '1.0.0' },
    },
    'package-lock.json': lockWith({
      [`${NM}/${CORE}-shim`]: { version: '1.0.0' },
      [`${NM}/${JS_API}-types`]: { version: '1.0.0' },
      [`${NM}/x/${NM}/${HXCS}-lite`]: { version: '1.0.0' },
    }),
    [`${NM}/${CORE}-shim/package.json`]: { name: `${CORE}-shim`, version: '1.0.0' },
    '.npmrc': '@alfresco-labs:registry=https://npm.pkg.github.com\n',
    'libs/ui/src/near.ts': `import { a } ${'from'} '${EXT}x';\nimport { b } ${'from'} '${HX}-legacy/ui';\nexport { a, b };\n`,
  }),
);

// The removal backlog itself: report-only with findings is green, and says what it found.
control(
  'report-only with findings exits 0 and lists them',
  'pass',
  [
    /dependency-tree: REPORT-ONLY — \d+ finding\(s\) across 5 of the 5 packages/,
    `[lockfile] ${CORE}@9.0.0 at ${NM}/${CORE}`,
    `[manifest] libs/platform/package.json peerDependencies.${EXT} = ^9.0.0`,
    '[npmrc] .npmrc:5 @alfresco:registry=',
    '[import] libs/ui — 1 file(s), 1 non-spec',
  ],
  fixture('report-only-findings', {
    'package-lock.json': lockWith(
      Object.fromEntries(ALL.map((pkg) => [`${NM}/${pkg}`, { version: VERSION[pkg] }])),
    ),
    'libs/platform/package.json': {
      name: '@fixture/platform',
      version: '0.1.0',
      peerDependencies: { [EXT]: '^9.0.0' },
    },
    '.npmrc': `${cleanFiles()['.npmrc']}@alfresco:registry=https://npm.pkg.github.com\n`,
    'libs/ui/src/columns.ts': `import type { DataColumn } ${'from'} '${CORE}';\nexport type C = DataColumn;\n`,
  }),
  ['--report-only'],
  'listing',
);

// ------------------------------------------------------------------------------- run them ----

const limit = Math.max(2, Math.min(8, Math.floor(availableParallelism() / 2)));
const outcomes = new Array(controls.length);
let next = 0;
await Promise.all(
  Array.from({ length: limit }, async () => {
    while (next < controls.length) {
      const i = next++;
      outcomes[i] = await runGate(controls[i].dir, controls[i].args, controls[i].env);
    }
  }),
);
controls.forEach((c, i) => judge(c, outcomes[i]));

// ------------------------------------------------------------- 7. the real repository ----
//
// Last and sequential, because the second depends on the first. Together they are what makes the
// gate's green on main mean something: the repository's own run is green as configured, AND the
// same tree in blocking mode is red whenever that run listed anything. On today's main — every
// package present — the second is the plan's "red run against the pre-removal lockfile". After the
// removal both become quiet controls, without this file changing.
{
  const asConfigured = await runGate(ROOT, ['--json']);
  let report = null;
  try {
    report = JSON.parse(asConfigured.out);
  } catch {
    /* judged below */
  }
  const found = typeof report?.total === 'number' && report.total > 0;
  judge(
    {
      name: 'real repository, mode as configured: exits 0',
      expected: 'pass',
      kind: found ? 'listing' : 'quiet',
      because: [/"verdict": "(REPORT-ONLY|pass) —/],
    },
    asConfigured,
  );
  if (report) {
    const total = report.total;
    judge(
      {
        name: `real repository, forced blocking: red iff the configured run found anything (it found ${total})`,
        expected: found ? 'fail' : 'pass',
        kind: found ? 'negative' : 'quiet',
        because: [found ? `dependency-tree: FAIL — ${total} finding(s)` : 'dependency-tree: pass'],
      },
      await runGate(ROOT, ['--blocking']),
    );
  } else {
    results.push({
      name: 'real repository, forced blocking',
      expected: 'fail',
      kind: 'negative',
      ok: false,
    });
    console.log(
      'FAIL real repository, forced blocking — the configured run printed no JSON report to compare with',
    );
  }
}

for (const dir of lockedDirs) chmodSync(dir, 0o755);
rmSync(workspace, { recursive: true, force: true });

// ------------------------------------------------------- 8. the stylesheet scanner itself ----
//
// In-process, because it is a pure function shared with the supply-chain gate. The import controls
// above prove the gate acts on what the scanner returns; these prove what it returns — the mask
// character for character, and the exact targets of each statement.
const scanFailures = scanSelfCheck();
const scanSplit =
  `${SCAN_CONTROL_COUNT.mask} mask (exact output) + ${SCAN_CONTROL_COUNT.negative} negative ` +
  `(must find nothing) + ${SCAN_CONTROL_COUNT.positive} positive (must find exactly these)`;

const failed = results.filter((r) => !r.ok);
// The split is reported rather than a total, because only the negative controls prove the gate
// can fail, only the quiet ones prove it does not cry wolf, and the listing ones prove neither —
// they prove report-only reports.
const count = (kind) => results.filter((r) => r.kind === kind).length;
const split =
  `${count('negative')} negative (must fail) + ${count('quiet')} quiet (must pass and report nothing)` +
  ` + ${count('listing')} listing (must pass and list findings)`;
console.log();
for (const why of notRun) console.log(`NOT RUN ${why}`);
if (scanFailures.length === 0) {
  console.log(`stylesheet-scan controls: pass — ${scanSplit}.`);
} else {
  console.error(
    `stylesheet-scan controls: FAIL — ${scanFailures.length} did not behave as specified (${scanSplit}):`,
  );
  for (const f of scanFailures) console.error(`  - ${f}`);
}
if (failed.length === 0 && scanFailures.length === 0) {
  console.log(`dependency-tree selftest: pass — ${results.length} control(s): ${split}.`);
  process.exit(0);
}
console.error(
  `dependency-tree selftest: FAIL — ${failed.length} of ${results.length} control(s) (${split}) did not behave as specified` +
    (scanFailures.length > 0 ? ', and the stylesheet-scan controls failed' : '') +
    (failed.length > 0 ? ':' : '.'),
);
for (const f of failed) console.error(`  - ${f.name} (expected ${f.expected})`);
process.exit(1);
