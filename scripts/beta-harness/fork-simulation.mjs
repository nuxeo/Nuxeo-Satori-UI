#!/usr/bin/env node
/**
 * Fork simulation: compile the template against the **built package**, not the source.
 *
 * ## The gap this closes
 *
 * Every app in this workspace resolves `@nuxeo/satori-platform/*` through
 * `tsconfig.base.json` paths, straight to the sources under `libs/shared`. That is right for the
 * inner loop, and it means the template's green build proves the template compiles
 * against **our source tree** — which is not what a customer has. A customer has the
 * published `.d.ts` files, which are a different artifact: narrowed by the entry
 * point barrels, flattened by the Angular compiler, and reachable only through the
 * generated `exports` map.
 *
 * So a symbol the template uses but the package does not export, or a type that only
 * resolves because of a source-relative import, would pass every existing gate and
 * fail on the customer's first `npm install`.
 *
 * This compiles the template's real source with `paths` repointed at
 * `dist/libs/platform`. Same files, same compiler, different resolution — which is
 * precisely the variable under test.
 *
 * ## Why not npm install the tarball and build for real
 *
 * That is a stronger test and it is already partly covered: `npm pack` → install →
 * resolve every subpath → typecheck a probe is done and recorded in the Phase 4 doc.
 * Doing it for the whole template needs a scratch install of every Angular peer plus
 * a GitHub Packages token for `@hylandsoftware/satori-ui`, so it cannot run offline or
 * in a fork's CI without secrets. This gets the resolution guarantee with no network,
 * which makes it cheap enough to run on every commit. The limits are listed at the
 * bottom of this comment rather than left implied.
 *
 * ## What it does not prove
 *
 * - Not runtime behaviour. It is a compile, so a component that renders wrongly still
 *   passes.
 * - Not the `exports` map. TypeScript resolves through the `paths` override here, so a
 *   broken exports map is invisible — `npm pack` + subpath resolution covers that, and
 *   it is what caught `ng-packagr-lite` shipping four unresolvable subpaths.
 * - Not peer installability. Nothing here checks that a customer can actually resolve
 *   `@angular/material` at the version we declare.
 *
 * Usage:
 *   node scripts/beta-harness/fork-simulation.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DIST = join(ROOT, 'dist', 'libs', 'platform');
const TEMPLATE = 'apps/nuxeo-satori-template';
const SCRATCH = join(ROOT, 'dist', 'fork-simulation');

function fail(message) {
  console.error(`\nfork-simulation: FAIL\n\n${message}\n`);
  process.exit(1);
}

if (!existsSync(DIST)) {
  fail(
    'dist/libs/platform does not exist, so there is no built package to compile against.\n' +
      'Run `npx nx build platform` first.',
  );
}

const distPackage = join(DIST, 'package.json');
if (!existsSync(distPackage)) fail(`${distPackage} is missing; the platform build did not finish.`);
const pkg = JSON.parse(readFileSync(distPackage, 'utf8'));

/**
 * Repoint every platform alias at the built output, and leave everything else alone.
 *
 * Derived from `tsconfig.base.json` rather than hardcoded, so a new entry point or a
 * renamed scope is picked up automatically instead of being silently skipped — a
 * hardcoded list would quietly stop covering whatever was added last.
 */
const base = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8'));
const basePaths = base.compilerOptions?.paths ?? {};

const rewritten = {};
const repointed = [];
for (const [alias, targets] of Object.entries(basePaths)) {
  if (alias === pkg.name) {
    rewritten[alias] = [DIST];
    repointed.push(alias);
  } else if (alias.startsWith(`${pkg.name}/`)) {
    const subpath = alias.slice(pkg.name.length + 1);
    rewritten[alias] = [join(DIST, subpath)];
    repointed.push(alias);
  } else {
    // Keep workspace-relative aliases resolvable from the scratch config's location.
    rewritten[alias] = targets.map((target) => join(ROOT, target));
  }
}

if (repointed.length === 0) {
  fail(
    `No aliases in tsconfig.base.json start with "${pkg.name}", so this check would compile\n` +
      'against the source tree and pass without testing anything. Refusing to report a\n' +
      'vacuous pass.',
  );
}

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });

const templateTsConfig = JSON.parse(
  readFileSync(join(ROOT, TEMPLATE, 'tsconfig.app.json'), 'utf8').replace(
    /^\s*\/\*[\s\S]*?\*\/\s*$/gm,
    '',
  ),
);

// `paths` is replaced wholesale by a derived config, never merged, which is why every
// alias above had to be restated rather than only the platform ones.
const scratchConfig = {
  extends: join(ROOT, 'tsconfig.json'),
  compilerOptions: {
    ...(templateTsConfig.compilerOptions ?? {}),
    baseUrl: ROOT,
    paths: rewritten,
    outDir: join(SCRATCH, 'out'),
    types: [],
    // The built package ships its own declarations; do not re-check them here. The
    // `api-surface` gate is what watches their shape.
    skipLibCheck: true,
  },
  include: [join(ROOT, TEMPLATE, 'src/**/*.ts')],
  exclude: [join(ROOT, TEMPLATE, 'src/**/*.spec.ts')],
};

const configPath = join(SCRATCH, 'tsconfig.fork.json');
writeFileSync(configPath, JSON.stringify(scratchConfig, null, 2));

console.log(
  `fork-simulation: compiling ${TEMPLATE} against ${pkg.name}@${pkg.version} in dist/\n` +
    `  repointed ${repointed.length} alias(es): ${repointed.join(', ')}`,
);

try {
  execFileSync('npx', ['ngc', '-p', configPath], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });
} catch (error) {
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  fail(
    'The template does not compile against the built package, though it compiles fine\n' +
      'against the source tree. That difference is the whole point of this check: it is\n' +
      'what a customer hits on their first install.\n\n' +
      'Usually one of:\n' +
      '  - the template uses a symbol the entry point barrel does not export\n' +
      '  - a type is only reachable through a source-relative import\n' +
      '  - an entry point is missing from tsconfig.base.json\n\n' +
      output,
  );
}

console.log('fork-simulation: pass — the template compiles against the published types.');
rmSync(SCRATCH, { recursive: true, force: true });
