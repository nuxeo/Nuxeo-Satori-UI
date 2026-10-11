#!/usr/bin/env node
/**
 * Asserts that `@nuxeo-satori/platform` **can actually be published**.
 *
 * ## Why this gate exists
 *
 * Phase 4's central claim to customers is that an upgrade is an `npm version` bump. For
 * the whole of that phase the package could not be published at all:
 *
 *     ERROR: Trying to publish a package that has been compiled in full compilation mode.
 *     This is not allowed.
 *
 * ng-packagr writes that as a `prepublishOnly` script into the built `package.json`
 * whenever the entry point was compiled in anything other than partial mode, so
 * `npm publish` hard-fails on the customer's very first install path — while `lint`,
 * `test`, `build`, `typecheck`, `api-surface` and `fork-simulation` were all green,
 * because none of them runs a publish.
 *
 * The cause is worth stating because it has now produced two separate defects.
 * `@nx/angular:package` given a `tsConfig` option calls
 * `parseRemappedTsConfigAndMergeDefaults`, which — despite the name — merges only eight
 * hardcoded options and otherwise **replaces** ng-packagr's bundled
 * `conf/tsconfig.ngc.json`. That bundled file is the only place `compilationMode:
 * partial` is set, and it is also where `strictTemplates` lives. Angular's own default
 * is `FULL`. The first defect from this was 27 wrongly non-nullable public types
 * (missing `strict`); the second was an unpublishable package (missing
 * `compilationMode`). Both were configuration absent rather than configuration wrong,
 * which is the kind no type checker reports.
 *
 * ## What is load-bearing here
 *
 * Two checks do the real work, for different failures.
 *
 * **Check 3** runs `npm publish --dry-run`, the only thing that executes `prepublishOnly`.
 * Checks 1, 2 and 4 are cheap corroborations that name the specific cause when 3 goes red.
 *
 * **Check 7** typechecks the shipped `.d.ts` files with `skipLibCheck: false`. `beta:fork`
 * compiles the app *template* against them, which only exercises the types the template
 * happens to touch — so `avatarColor` shipped as `(name: string) => SatAvatarCategory` with
 * that name declared nowhere in the file, and every gate was green.
 *
 * Checks 5 and 6 assert that what the shipped docs tell a customer to run is actually in
 * the package: the guardrail script, and the five Nx generators.
 *
 * ## Every check here has been watched failing on purpose
 *
 * Re-adding the full-mode `prepublishOnly` turns 1 and 3 red; reverting `compilationMode`
 * turns 1, 2 and 3 red together; deleting a generator factory or the `generators` field
 * turns 6 red; reintroducing the dangling type turns 7 red.
 *
 * **Check 7 silently passed three times before it worked**, and each way is guarded now,
 * because a check that reports success having done nothing is worse than no check:
 *
 * 1. `--types ''` made tsc abort with `TS6044`, and the path filter discarded it. Guarded
 *    by failing on any `TS5xxx`/`TS6xxx` configuration diagnostic.
 * 2. A malformed `paths` entry (`pkg/nuxeo-clientindex.d.ts`, a missing separator) meant no
 *    entry point resolved. `TS2307` is attributed to the importing file, so the filter
 *    discarded that too. Guarded by failing on any unresolved module.
 * 3. Compiling from a temp directory outside the repo meant `node_modules` could not be
 *    reached, producing twenty peer-resolution errors that were the harness's fault. It now
 *    stages inside the repo and imports via the package specifiers a customer writes.
 *
 * ## Safety
 *
 * Nothing here can publish. The dry run happens in a throwaway copy under the OS temp
 * directory, `--dry-run` makes no registry request, and the copy is the only place
 * `private: true` is stripped — the built package keeps it, so a stray real `npm publish`
 * in `dist/` is still refused by npm.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const DIST = resolve('dist/libs/platform');

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);

if (!existsSync(DIST)) {
  console.error(
    `publishability: dist/libs/platform does not exist.\n` +
      `  Run \`npx nx build platform\` first — this gate reads the built bytes, not the source.`,
  );
  process.exit(2);
}

const pkgPath = join(DIST, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

// ------------------------------------------- 1. the full-mode tripwire is absent ----

if (pkg.scripts?.prepublishOnly) {
  fail(
    'The built package.json carries a `prepublishOnly` script:\n' +
      `    ${pkg.scripts.prepublishOnly.slice(0, 120)}...\n` +
      '    ng-packagr writes this ONLY for a non-partial build. Set\n' +
      '    `angularCompilerOptions.compilationMode: "partial"` in libs/platform/tsconfig.lib.json.',
  );
} else {
  notes.push('no `prepublishOnly` tripwire in the built package.json');
}

// -------------------------------- 2. the shipped bytes are partial-mode bytes ----

/**
 * Checked against the emitted JavaScript rather than the tsconfig, because the tsconfig
 * is the input we already got wrong. `ɵɵngDeclareComponent` is what a *library* emits
 * for the consuming application's linker to lower; `ɵɵdefineComponent` is the final form
 * and pins the output to one Angular version.
 */
const fesm = [
  'nuxeo-satori-platform.mjs',
  'nuxeo-satori-platform-app-config.mjs',
  'nuxeo-satori-platform-components.mjs',
  'nuxeo-satori-platform-components-satori.mjs',
  'nuxeo-satori-platform-extensions.mjs',
  'nuxeo-satori-platform-nuxeo-client.mjs',
  'nuxeo-satori-platform-ui.mjs',
];

let declared = 0;
for (const name of fesm) {
  const file = join(DIST, 'fesm2022', name);
  if (!existsSync(file)) {
    fail(`Expected bundle is missing: fesm2022/${name}`);
    continue;
  }
  const text = readFileSync(file, 'utf8');
  const partial = (text.match(/ɵɵngDeclare/g) ?? []).length;
  const full = (text.match(/ɵɵdefine(Component|Directive|Injectable|Pipe|NgModule)/g) ?? []).length;
  declared += partial;

  if (full > 0) {
    fail(
      `fesm2022/${name} contains ${full} fully-compiled definition(s) (ɵɵdefine*).\n` +
        "    A published library must emit ɵɵngDeclare* so the consumer's linker lowers it\n" +
        "    against the consumer's Angular version.",
    );
  }
}

if (declared === 0) {
  fail(
    'No `ɵɵngDeclare*` calls in any bundle.\n' +
      '    Check 2 would then pass vacuously for an empty package, so it is a failure:\n' +
      '    the platform ships components, services and pipes and must declare them.',
  );
} else {
  notes.push(`${declared} ɵɵngDeclare* declarations across ${fesm.length} bundles, 0 ɵɵdefine*`);
}

// ------------------------------ 2b. every external import is a declared dependency ----

/**
 * A bare import left in the bundle is a runtime dependency whether or not the manifest says so.
 *
 * ng-packagr does not inline third-party code: `import DOMPurify from 'dompurify'` survives into the
 * FESM output verbatim. If that specifier is in neither `dependencies` nor `peerDependencies`, npm
 * has not been told to install it, so the package resolves fine inside this monorepo — where the
 * root `node_modules` happens to contain it — and fails on `import` for anyone who installs it from
 * the registry. Every other check here passed while `dompurify` was undeclared, including
 * `npm publish --dry-run`, because none of them reads the bundles' import graph.
 *
 * Self-references between entry points are skipped: `@nuxeo-satori/platform/ui` importing
 * `@nuxeo-satori/platform` is the package's own `exports` map, not an external dependency.
 *
 * Specifiers come from a full AST walk. Two earlier attempts were both fail-open:
 *
 *   1. A regex for `… from '…'`, which review pointed out omits the forms that need no `from` — a
 *      side-effect import (`import 'pkg'`) and a dynamic one (`import('pkg')`).
 *   2. `ts.preProcessFile`, which looked like the right tool and is not. It reads only a file's
 *      leading import prologue, so it reported 7 specifiers for the nuxeo-client bundle and missed
 *      the mid-file `import('./reports')` that is plainly in it. A dynamic import of an undeclared
 *      package sits in the middle of compiled code, which is exactly where it stops looking.
 *
 * So the walk below visits every node and collects static imports and re-exports, dynamic
 * `import()`, `require()`, and `import x = require()`. Verified against a side-effect import and a
 * dynamic import injected mid-bundle, both of which the first two approaches passed.
 */

/**
 * Every module specifier in `text`, from anywhere in the file, plus every module load whose specifier
 * is **not** a string literal.
 *
 * The second list is the point. `import(expr)` and `require(expr)` with a computed specifier were
 * silently dropped, so a bundle could load an undeclared external package through a variable and this
 * gate would still report every import as declared — the same fail-open shape as the regex it replaced,
 * one level further in. They are now returned and reported: a specifier this cannot read is a specifier
 * whose declaration cannot be checked, which is not the same as an import that is fine.
 */
function moduleSpecifiersOf(text, fileName) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const specifiers = [];
  const unreadable = [];

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        if (ts.isStringLiteralLike(node.arguments[0])) {
          specifiers.push(node.arguments[0].text);
        } else {
          unreadable.push({
            kind: isDynamicImport ? 'import()' : 'require()',
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            text: node.arguments[0].getText(source).slice(0, 60),
          });
        }
      }
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return { specifiers, unreadable };
}
const manifestDeps = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
]);

/**
 * Every `.mjs` the `exports` map actually points at, not only the hard-coded list.
 *
 * The `fesm` list above is a deliberate, explicit expectation for check 2 — those bundles must
 * exist. It is the wrong source for *this* check, which asks a question about the whole published
 * surface: add a sixth entry point and its bundle was silently omitted, so an undeclared runtime
 * dependency reachable only through it still passed. A gate that shrinks as the package grows is the
 * fail-open shape this file keeps finding elsewhere.
 *
 * The union with `fesm` is kept so a missing expected bundle is still caught by check 2 rather than
 * quietly dropping out of both.
 */
function publishedBundleNames() {
  const found = new Set(fesm);
  const walk = (node) => {
    if (typeof node === 'string') {
      const m = /^\.\/fesm2022\/(.+\.mjs)$/.exec(node);
      if (m) found.add(m[1]);
      return;
    }
    if (node && typeof node === 'object') for (const v of Object.values(node)) walk(v);
  };
  walk(pkg.exports ?? {});
  return [...found].sort();
}

const scanned = publishedBundleNames();
const extras = scanned.filter((name) => !fesm.includes(name));
if (extras.length > 0) {
  notes.push(
    `import scan covers ${extras.length} bundle(s) beyond the expected ${fesm.length}: ${extras.join(', ')}`,
  );
}

const externalImports = new Map();
for (const name of scanned) {
  const file = join(DIST, 'fesm2022', name);
  if (!existsSync(file)) {
    // A bundle the `exports` map points at but which is not on disk.
    //
    // Continuing silently was fail-open: the fixed list is asserted present by check 2, but a newly
    // added export could point at a missing FESM file and still pass this "whole published
    // surface" scan — and `npm publish --dry-run` does not validate export targets either, so nothing
    // would have caught it. An export that does not resolve is a broken package, and it is also a
    // bundle whose imports were never read.
    if (!fesm.includes(name)) {
      fail(
        `The exports map points at fesm2022/${name}, which is not present.\n` +
          '    An export target that does not exist is a broken package, and its imports were also\n' +
          '    never scanned. Build it, or remove the export.',
      );
    }
    continue;
  }
  const text = readFileSync(file, 'utf8');
  // Deliberately no per-bundle "zero specifiers means the scan broke" check: the package root
  // legitimately has none, exporting only a frozen list of entry point names. The scanner is
  // sanity-checked once below instead, against a specifier that must be present.
  const { specifiers, unreadable } = moduleSpecifiersOf(text, name);
  for (const load of unreadable) {
    fail(
      `fesm2022/${name}:${load.line} loads a module through a non-literal ${load.kind} specifier: ${load.text}\n` +
        '    The specifier cannot be read statically, so whether its target is declared cannot be\n' +
        '    checked. Use a literal specifier, or if the target can only ever resolve inside this\n' +
        '    package, say so here explicitly rather than leaving the scan silent about it.',
    );
  }
  for (const spec of specifiers) {
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
    const parts = spec.split('/');
    const packageName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    if (packageName === pkg.name || spec.startsWith(`${pkg.name}/`)) continue;
    if (!externalImports.has(packageName)) externalImports.set(packageName, new Set());
    externalImports.get(packageName).add(name);
  }
}

/**
 * The scanner's own control.
 *
 * "Did it find anything at all" is too weak to be worth much: `@angular/core` alone satisfies it, so
 * the count stays plausible even if the scan degrades to catching one syntax form. Anchoring on a
 * specifier that must be present in a named bundle means a scan that silently stops seeing imports
 * fails here rather than reporting a shorter list as a clean result.
 */
const SCANNER_CONTROL = { bundle: 'nuxeo-satori-platform-ui.mjs', specifier: '@angular/core' };
if (!externalImports.get(SCANNER_CONTROL.specifier)?.has(SCANNER_CONTROL.bundle)) {
  fail(
    `Import scan did not find "${SCANNER_CONTROL.specifier}" in ${SCANNER_CONTROL.bundle}.\n` +
      '    That import is not optional for this bundle, so this means the scan is no longer\n' +
      '    reading the module graph — not that the dependency went away.',
  );
}

const undeclared = [...externalImports.keys()].filter((name) => !manifestDeps.has(name)).sort();
if (undeclared.length > 0) {
  for (const name of undeclared) {
    fail(
      `Bundle imports "${name}" but the built package.json declares it nowhere.\n` +
        `    Imported by: ${[...externalImports.get(name)].sort().join(', ')}\n` +
        '    Add it to `dependencies` (plus `allowedNonPeerDependencies` in ng-package.json) or to\n' +
        '    `peerDependencies`, otherwise a consumer install cannot resolve it.',
    );
  }
} else {
  notes.push(
    `${externalImports.size} external import(s) across the bundles, all declared: ` +
      `${[...externalImports.keys()].sort().join(', ')}`,
  );
}

// -------------------------------------------- 3. npm publish --dry-run succeeds ----

const staging = mkdtempSync(join(tmpdir(), 'satori-publishability-'));
const copy = join(staging, 'platform');
try {
  cpSync(DIST, copy, { recursive: true });

  // Stripped in the COPY only. `private: true` stays in dist so an accidental real
  // publish is refused; npm refuses a dry run of a private package too, which would
  // make this check unfalsifiable rather than passing.
  const copied = JSON.parse(readFileSync(join(copy, 'package.json'), 'utf8'));
  if (copied.private !== true) {
    fail(
      'The built package.json is not `private: true`.\n' +
        '    It is the last thing standing between a mistyped `npm publish` and a public\n' +
        '    release of an unfinished package. Publishing is a deliberate, later step —\n' +
        '    see docs/publishing-to-nuxeo-registry.md.',
    );
  }
  delete copied.private;
  writeFileSync(join(copy, 'package.json'), JSON.stringify(copied, null, 2));

  try {
    execFileSync('npm', ['publish', '--dry-run', '--registry=https://registry.npmjs.org'], {
      cwd: copy,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    notes.push('`npm publish --dry-run` succeeded on a copy of the built package');
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    fail(
      '`npm publish --dry-run` failed on the built package. This is the load-bearing\n' +
        '    check: it is the only one that runs the `prepublishOnly` lifecycle script.\n\n' +
        output
          .split('\n')
          .filter((l) => l.trim())
          .slice(-12)
          .map((l) => `      ${l}`)
          .join('\n'),
    );
  }

  // -------------------------------- 4. every declared subpath resolves in the copy ----

  /**
   * `ng-packagr-lite` once produced a package whose four secondary entry points were all
   * unresolvable — the `exports` map named files it had not written. Resolved from the
   * temp copy so this reads the tree as unpacked, not as built in place.
   */
  for (const [subpath, conditions] of Object.entries(pkg.exports ?? {})) {
    for (const [condition, target] of Object.entries(conditions)) {
      if (typeof target !== 'string') continue;
      if (!existsSync(join(copy, target))) {
        fail(
          `exports["${subpath}"].${condition} points at \`${target}\`, which is not in the package.\n` +
            '    A customer importing that subpath gets ERR_MODULE_NOT_FOUND.',
        );
      }
    }
  }
  notes.push(`${Object.keys(pkg.exports ?? {}).length} export subpaths resolve to present files`);

  // ------------------------------ 5. the package ships what its docs tell customers to run ----

  /**
   * `AGENTS.md` instructs customers to run the guardrail script out of
   * `node_modules/@nuxeo-satori/platform/guardrails/`. It was absent from the tarball for
   * the whole of Phase 4 — a documented step that could not be followed. Derived from the
   * docs rather than hardcoded, so a new instruction is covered without editing this file.
   */
  const docs = ['README.md', 'AGENTS.md', 'extension-reference.md'].filter((d) =>
    existsSync(join(copy, d)),
  );
  const advertised = new Set();
  for (const doc of docs) {
    const text = readFileSync(join(copy, doc), 'utf8');
    for (const m of text.matchAll(/node_modules\/@nuxeo-satori\/platform\/([\w./-]+)/g)) {
      advertised.add(m[1]);
    }
  }
  for (const path of advertised) {
    if (!existsSync(join(copy, path))) {
      fail(
        `The docs tell customers to use \`node_modules/@nuxeo-satori/platform/${path}\`,\n` +
          '    which is not in the package. Add it to `assets` in libs/platform/ng-package.json.',
      );
    }
  }
  // ---------------------------------- 6. the Nx generators resolve from the package ----

  /**
   * Layer 3 is "the differentiator" per the plan, and the generators that make it real were
   * not in the tarball at all. `AGENTS.md` section 2 told customers to run
   * `npx nx g ./tools/satori-generators:extension-library` — a path inside *our* repository
   * — so the first instruction in the shipped guide could not be run by its audience.
   *
   * Asserted from `package.json`'s `generators` field outward, the way Nx resolves a
   * plugin, so this fails if the manifest is missing, malformed, or names a factory or
   * schema that was not shipped. A factory path has no extension in the manifest, exactly
   * as Nx `require()`s it.
   */
  const manifestPath = pkg.generators;
  if (typeof manifestPath !== 'string') {
    fail(
      'package.json has no `generators` field, so Nx cannot see this package as a plugin\n' +
        '    and `nx g @nuxeo-satori/platform:…` fails with "Cannot find generator".',
    );
  } else if (!existsSync(join(copy, manifestPath))) {
    fail(`package.json points at \`${manifestPath}\`, which is not in the package.`);
  } else {
    let generators = {};
    try {
      generators = JSON.parse(readFileSync(join(copy, manifestPath), 'utf8')).generators ?? {};
    } catch (error) {
      fail(`${manifestPath} is not valid JSON (${error.message}).`);
    }
    const names = Object.keys(generators);
    if (names.length === 0) {
      fail(
        `${manifestPath} declares no generators, so check 6 asserted nothing. The package is\n` +
          '    meant to ship five: extension-library, -rule, -action, -component and config-package.',
      );
    }
    for (const [name, generator] of Object.entries(generators)) {
      // Nx requires the factory without an extension; the compiled file is `.js`.
      if (!existsSync(join(copy, `${generator.factory}.js`))) {
        fail(
          `generator \`${name}\` names factory \`${generator.factory}\`, which is not in the\n` +
            '    package. `nx g` reports "Cannot find module" at the point a customer runs it.',
        );
      }
      if (generator.schema && !existsSync(join(copy, generator.schema))) {
        fail(`generator \`${name}\` names schema \`${generator.schema}\`, which is not shipped.`);
      }
    }
    if (names.length > 0) {
      notes.push(`${names.length} Nx generator(s) resolve from the package: ${names.join(', ')}`);
    }
  }

  // ------------------------------- 7. the shipped declarations typecheck on their own ----

  /**
   * `tsc --noEmit` over every published `.d.ts`.
   *
   * `beta:fork` compiles the *app template* against these declarations, which only exercises
   * the types the template happens to touch. That left a real hole: `avatarColor` was
   * published as `(name: string) => SatAvatarCategory` with `SatAvatarCategory` **declared
   * nowhere in the file** — ng-packagr's rollup had dropped the import of a third-party type
   * — so any customer annotating that result got `TS2304: Cannot find name`. The template
   * never calls `avatarColor`, so `beta:fork` was green, and the API snapshot had recorded
   * the broken signature as its baseline.
   *
   * Compiling the declarations themselves needs no consumer and covers every symbol.
   *
   * Diagnostics are filtered to files **inside the package**. `skipLibCheck` has to be off
   * for this to mean anything, and with it off `@alfresco/adf-extensions`' shipped
   * `index.d.ts` contributes six intrinsic `TS2411` errors — a documented upstream fact, not
   * ours. Filtering by path keeps the check honest without turning off the thing that makes
   * it work.
   */
  const entryDeclarations = Object.values(pkg.exports ?? {})
    .map((conditions) => conditions?.types)
    .filter((path) => typeof path === 'string');

  if (entryDeclarations.length === 0) {
    fail('No entry point declares a `types` condition, so check 7 typechecked nothing.');
  } else {
    /**
     * Compiled from a directory **inside the repository**, against `dist/`, not against the
     * temp copy.
     *
     * Two reasons, both learned by getting it wrong. Node resolution walks *up* from the
     * file being compiled, so a probe under the OS temp directory cannot see the repo's
     * `node_modules` — the first attempt produced twenty `TS2307: Cannot find module
     * '@angular/core'` errors that were the harness's fault, not the package's. And the
     * entry points import each other by package specifier
     * (`@nuxeo-satori/platform/nuxeo-client`), so without a path mapping to `dist/` the
     * siblings do not resolve either.
     *
     * Imports use the **package specifiers a customer writes**, which makes the probe the
     * shape of real consumption rather than a relative-path approximation.
     */
    const stage = join(process.cwd(), '.tmp-publishability');
    const subpaths = Object.keys(pkg.exports ?? {}).filter((s) => s !== './package.json');
    try {
      cpSync(join(process.cwd(), 'dist/libs/platform'), join(stage, 'pkg'), { recursive: true });
      writeFileSync(
        join(stage, 'tsconfig.json'),
        `${JSON.stringify(
          {
            compilerOptions: {
              noEmit: true,
              strict: true,
              // OFF is the whole point: `true` is what lets a broken declaration ship.
              skipLibCheck: false,
              module: 'esnext',
              moduleResolution: 'bundler',
              target: 'es2022',
              types: [],
              baseUrl: '.',
              // Built with `join`, not string concatenation: the first cut produced
              // `./pkg/nuxeo-clientindex.d.ts` for `./nuxeo-client` — a missing separator
              // — and the resulting "Cannot find module" was attributed to `probe.ts`,
              // which the diagnostic filter below then discarded. The check passed while
              // resolving nothing. See the `unresolved` guard.
              paths: Object.fromEntries(
                subpaths.map((s) => [
                  s.replace(/^\./, pkg.name),
                  [`./${join('pkg', s.replace(/^\.\/?/, ''), 'index.d.ts')}`],
                ]),
              ),
            },
            files: ['probe.ts'],
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(stage, 'probe.ts'),
        `${subpaths
          .map((s, i) => `import type * as e${i} from '${s.replace(/^\./, pkg.name)}';`)
          .join(
            '\n',
          )}\nexport type Probed = [${subpaths.map((_, i) => `typeof e${i}`).join(', ')}];\n`,
      );

      var diagnostics = '';
      try {
        execFileSync('npx', ['tsc', '-p', join(stage, 'tsconfig.json')], {
          cwd: process.cwd(),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        diagnostics = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      }
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }

    const errors = diagnostics.split('\n').filter((line) => /error TS/.test(line));

    /**
     * A configuration or invocation error means the compile never happened, and filtering
     * by path would then discard the only evidence and report a pass.
     *
     * This is not hypothetical — it is how the first version of this check behaved. It
     * passed `--types ''`, which tsc rejects with `TS6044: Compiler option 'types' expects
     * an argument`; the path filter dropped that line, `ours` came back empty, and the gate
     * reported "declarations typecheck standalone" having compiled nothing. Caught by
     * reintroducing the dangling type it was written for and seeing it stay green.
     */
    const cannotRun = errors.filter((line) => /error TS[56]\d{3}/.test(line));
    if (cannotRun.length > 0) {
      fail(
        'The declaration typecheck could not run, so it asserted nothing:\n' +
          cannotRun
            .slice(0, 4)
            .map((l) => `      ${l.trim()}`)
            .join('\n'),
      );
    }

    /**
     * A module the probe cannot resolve is also a failure, and must be reported separately
     * from a type error *inside* the package.
     *
     * TS2307 is attributed to the **importing** file — `probe.ts` — not to the package, so
     * the path filter below discards it. That is exactly how the first two versions of this
     * check passed while typechecking nothing: once because `--types ''` aborted tsc, and
     * once because a malformed path mapping meant no entry point resolved. Both times the
     * gate printed "declarations typecheck standalone".
     */
    const unresolved = errors.filter((line) => /error TS2307/.test(line));
    if (unresolved.length > 0) {
      fail(
        'The probe could not resolve the published entry points, so nothing was\n' +
          '    typechecked. This is a fault in the check, not necessarily in the package:\n' +
          unresolved
            .slice(0, 4)
            .map((l) => `      ${l.trim()}`)
            .join('\n'),
      );
    }

    // The staged copy is `.tmp-publishability/pkg`, so that is what a package-owned
    // diagnostic points at. Filtered so an unrelated repo file cannot fail this check.
    const ours = errors.filter((line) => line.includes(join('.tmp-publishability', 'pkg')));

    if (ours.length > 0) {
      fail(
        `${ours.length} type error(s) in the SHIPPED declarations. A customer sees these:\n` +
          ours
            .slice(0, 8)
            .map((l) => `      ${l.trim()}`)
            .join('\n'),
      );
    } else {
      notes.push(`${entryDeclarations.length} entry point declaration(s) typecheck standalone`);
    }
  }

  if (advertised.size === 0) {
    fail(
      `None of the ${docs.length} shipped doc(s) reference a \`node_modules/@nuxeo-satori/platform/…\`\n` +
        '    path, so check 5 asserted nothing. If the guardrail instruction was removed,\n' +
        '    remove this check deliberately rather than letting it pass empty.',
    );
  } else {
    notes.push(`${advertised.size} doc-advertised path(s) present in the package`);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

// ------------------------------------------------------------------------ report ----

if (failures.length) {
  console.error(`\npublishability: FAIL — ${failures.length} problem(s) in ${DIST}\n`);
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}

console.log(`publishability: pass — @nuxeo-satori/platform@${pkg.version} is publishable`);
for (const n of notes) console.log(`  - ${n}`);
