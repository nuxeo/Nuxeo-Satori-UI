#!/usr/bin/env node
import { spawnToolSync } from './package-command.mjs';

/**
 * Public API surface gate for `@nuxeo/satori-platform`.
 *
 * ## Why this exists
 *
 * Phase 4's promise to customers is that an upgrade is a version bump, not a
 * merge. That is only true if the published surface cannot change by accident.
 * Nothing else in this repo can see such a change: `lint`, `test`, `build` and
 * `typecheck` are all perfectly happy when a library gains, loses or reshapes an
 * export, because every in-repo caller is updated in the same commit. The break
 * lands on the customer, one release later.
 *
 * So this reads the **built** `.d.ts` files — the bytes a customer actually
 * installs, not the source — and compares the surface against a checked-in
 * snapshot at `docs/api/platform.api.md`.
 *
 * ## Why not @microsoft/api-extractor
 *
 * Three reasons, in order of weight. It is another dependency on a lockfile that
 * has already cost this programme a phase. It wants a single rolled-up entry
 * point, and this package deliberately ships five. And it is markedly harder to
 * break on purpose, which is the bar every gate here has to clear —
 * `AGENTS/11-beta-program.md` is explicit that a gate nobody has watched go red
 * is not evidence. A small script over the emitted declarations is auditable in
 * one sitting.
 *
 * ## What it deliberately does not check
 *
 * It records exported **names, kinds and type signatures** per entry point. It
 * does not parse Angular decorator metadata, so a change to a component's
 * selector or input alias is invisible to it, and it does not diff JSDoc. It is a
 * shape gate, not a semantic-compatibility oracle. That limit is stated here so
 * that a green run is not read as "this release is backwards compatible".
 *
 * Usage:
 *   node scripts/beta-harness/api-surface.mjs            # check, non-zero on drift
 *   node scripts/beta-harness/api-surface.mjs --update   # rewrite the snapshot
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DIST = join(ROOT, 'dist', 'libs', 'platform');
const SNAPSHOT = join(ROOT, 'docs', 'api', 'platform.api.md');
const update = process.argv.includes('--update');

function fail(message) {
  console.error(`\napi-surface: FAIL\n\n${message}\n`);
  process.exit(1);
}

// First, not last: this builds `dist`, so the existence checks below are post-build sanity checks
// rather than instructions to the caller.
ensureFreshDist();

if (!existsSync(DIST)) {
  fail(
    `${DIST} does not exist even after building, so there is no surface to inspect.\n` +
      'This gate reads the artifact a customer installs, deliberately, rather than the\n' +
      'source it was built from.',
  );
}

const pkgPath = join(DIST, 'package.json');
if (!existsSync(pkgPath)) fail(`${pkgPath} is missing; the build did not complete.`);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

/**
 * Make `dist` fresh rather than guessing whether it is.
 *
 * This gate reads built declarations, so against a stale `dist` it compares yesterday's surface to
 * the snapshot and passes — which is exactly what it did during review of an earlier PR, reporting a
 * clean surface for a service that had gained a public method minutes earlier.
 *
 * ## Why it builds instead of comparing timestamps or hashes
 *
 * Two heuristics were tried and both produced a red that meant nothing:
 *
 *   1. **mtimes**, against `dist/.../package.json`. Anything that rewrites a file with *identical
 *      bytes* bumps its mtime — `sanitizer-audit.selftest.mjs` does precisely that, perturbing files
 *      and restoring the original bytes in a `finally`. Running the selftest turned this gate red
 *      without a character of source having changed. Worse, `npx nx build platform` could not clear
 *      it: Nx hashes content, so the build was a cache hit and `dist` mtimes were never touched.
 *      Only `--skip-nx-cache` worked, and since `build` runs immediately before `api-surface` in
 *      `ALL_GATES` and is itself a cache hit, a full `beta:gate` run could not self-heal.
 *   2. **Content hashes**, recording the source hash against the hash of the `dist` it described.
 *      That fixed the identical-bytes case but wedged a narrower one: a source edit that does not
 *      alter the emitted `.d.ts` leaves `dist` byte-identical, so the record still "describes" it,
 *      the source hash differs forever, and *no* rebuild clears it.
 *
 * Both failures share a cause: inferring freshness from observable side effects of the build. So
 * this asks the build system instead. `nx build platform` is idempotent and a cache hit costs about
 * a second, after which `dist` corresponds to the sources on disk **by construction** — there is
 * nothing left to infer, and no state to keep. The gate is slower standalone and cannot produce an
 * uncleanable red, which is the right trade for something that already refuses to read source.
 */
function ensureFreshDist() {
  const built = spawnToolSync('npx', ['nx', 'build', 'platform'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer to handle large build output
  });

  if (built.status !== 0) {
    fail(
      'Could not build dist/libs/platform, so there is no trustworthy surface to inspect.\n' +
        'This gate reads the artifact a customer installs, so a failed build is a failed gate.\n\n' +
        `${built.stdout ?? ''}${built.stderr ?? ''}`.trim().split('\n').slice(-25).join('\n'),
    );
  }
}

/**
 * Entry point subpath -> its `types` file, taken from the generated `exports` map.
 *
 * Read from `exports` rather than by globbing for `index.d.ts`, because the
 * exports map is what actually decides whether a customer can reach an entry
 * point. A declaration file nothing exports is not part of the surface, and an
 * exports entry pointing at a missing file is a broken package — which is exactly
 * how `ng-packagr-lite` shipped four unresolvable subpaths.
 */
function entryPoints() {
  const found = [];
  for (const [subpath, conditions] of Object.entries(pkg.exports ?? {})) {
    if (subpath === './package.json') continue;
    const types = typeof conditions === 'object' ? conditions.types : undefined;
    if (!types) continue;
    const file = join(DIST, types);
    if (!existsSync(file)) {
      fail(
        `The exports map advertises "${subpath}" with types "${types}", but that file does\n` +
          'not exist. A customer importing that subpath gets an unresolvable module.',
      );
    }
    found.push({ subpath, types, file });
  }
  return found.sort((a, b) => a.subpath.localeCompare(b.subpath));
}

/** Follow `export * from './x'` so re-exported declarations are not invisible. */
function collectDeclarationFiles(entryFile, seen = new Set()) {
  if (seen.has(entryFile) || !existsSync(entryFile)) return seen;
  seen.add(entryFile);
  const text = readFileSync(entryFile, 'utf8');
  for (const match of text.matchAll(
    /export\s+(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s*)?from\s*['"](\.[^'"]+)['"]/g,
  )) {
    const target = resolve(join(entryFile, '..'), match[1]);
    for (const candidate of [`${target}.d.ts`, join(target, 'index.d.ts')]) {
      if (existsSync(candidate)) {
        collectDeclarationFiles(candidate, seen);
        break;
      }
    }
  }
  return seen;
}

/**
 * Strip comments, so JSDoc is not part of the surface and braces inside prose
 * cannot confuse the body scanner below.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/\/.*$/gm, '');
}

/**
 * Whether a declaration's opening line leaves anything unclosed.
 *
 * This replaces a `BRACED_KINDS` allowlist of `class | abstract class | interface | enum |
 * namespace`, which is where the gate's second blind spot lived. `const` and `type` were
 * matched by {@link DECLARATION} but not in that set, so a multi-line one recorded only
 * its opening line and its contents were invisible to the diff. The snapshot literally
 * held
 *
 *     const EXTENSION_SLOTS:
 *
 * with nothing after the colon — and `EXTENSION_SLOTS` is the registry of slot ids every
 * customer manifest is written against. Removing or renaming a slot would have been
 * reported as "no change". `NOTE_FORMAT_OPTIONS` was recorded as
 * `const NOTE_FORMAT_OPTIONS: readonly [` for the same reason.
 *
 * Balance-based rather than kind-based so the class of bug cannot come back for a kind
 * nobody thought of: `[` matters as much as `{` — a `readonly [{ … }]` tuple opens with a
 * bracket — and `(` matters for a multi-line function signature. Safe on emitted
 * declarations, which contain no string, template or regex literals that could carry an
 * unbalanced bracket; `stripComments` has already removed the only other source.
 */
function unclosedDepth(line) {
  let depth = 0;
  for (const char of line) {
    if (char === '{' || char === '[' || char === '(') depth += 1;
    else if (char === '}' || char === ']' || char === ')') depth -= 1;
  }
  return depth;
}
// Two forms, because a rolled-up `.d.ts` uses both. Values need `declare`;
// `type` and `interface` are type-only and appear bare — `PlatformEntryPoint` is
// emitted as `type PlatformEntryPoint = ...` with no `declare`, and requiring the
// keyword left it unparsed.
const DECLARATION = new RegExp(
  '^(?:export\\s+)?(?:declare\\s+)?(abstract class|class|interface|function|const|let|var|enum|namespace|type)\\s+([A-Za-z_$][\\w$]*)([\\s\\S]*?)$',
);

/**
 * Every declaration in a rolled-up `.d.ts`, keyed by name, with its **members**.
 *
 * ## The bug this replaces
 *
 * The first cut required declarations to start with `export`. In a rolled-up
 * bundle they do not: ng-packagr emits `declare class Foo { ... }` and then a
 * single `export { Foo, Bar, ... }` clause at the end. So every regex missed, and
 * every symbol fell through to a name-only fallback. The snapshot listed 233
 * *names* and not one signature — and it duly reported "no change" when a
 * `strictNullChecks` misconfiguration altered 23 published types. A gate that
 * cannot see a type change is not an API gate.
 *
 * ## Why bodies, not just declaration lines
 *
 * The interesting breakages are inside: a method losing an overload, a property
 * turning nullable, a parameter becoming required. Recording `class Foo` would
 * have missed all three. Bodies are captured by brace depth after comments are
 * stripped, which is reliable on emitted declarations — they contain no
 * expressions, no template literals and no regex literals to confuse it.
 */
function declarationsIn(text) {
  const clean = stripComments(text);
  const lines = clean.split('\n');
  const found = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const match = DECLARATION.exec(lines[index].trim());
    if (!match) continue;
    const [, kind, name, rest] = match;

    if (unclosedDepth(lines[index]) <= 0) {
      found.set(name, `${kind} ${name}${normalise(rest)}`);
      continue;
    }

    // Walk to the line that closes it, then record each member on its own line so a
    // diff points at the member that changed rather than the whole declaration.
    let depth = 0;
    const members = [];
    let closer = '}';
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      depth += unclosedDepth(line);
      if (cursor > index) {
        const member = line.trim();
        // The final line is the closer, and it is re-emitted below rather than kept as
        // a member — but keep whatever punctuation it actually uses (`}`, `]`, `];`)
        // so a tuple does not silently render as an object.
        if (depth <= 0 && /^[}\])];]*$/.test(member)) closer = member;
        // `private` members are emitted into the `.d.ts` but are not customer-visible: TypeScript
        // keeps them only so subclass field layout stays sound. Recording them made an internal
        // refactor — renaming a private field, extracting a private helper — show up as a change
        // to the published surface, and the fix for a spurious diff is `--update`, which is how a
        // gate stops being read. Only depth-1 members are filtered; a `private` inside a nested
        // type literal cannot occur in emitted declarations.
        else if (member && !/^private\s/.test(member)) {
          members.push(`    ${sortUnionMembers(member.replace(/\s+/g, ' '))}`);
        }
      }
      if (depth <= 0) {
        index = cursor;
        break;
      }
    }
    // `normalise` deliberately NOT used for the header: it strips a trailing `{`, which
    // is what turned `const EXTENSION_SLOTS: {` into `const EXTENSION_SLOTS:` and made
    // the opener — object vs tuple — invisible. Collapse whitespace only.
    const header = `${kind} ${name}${rest.replace(/\s+/g, ' ').trimEnd()}`;
    found.set(name, [header, ...members, closer].join('\n'));
  }

  return found;
}

/** The names a rolled-up `.d.ts` actually makes public. */
function exportedNames(text) {
  const clean = stripComments(text);
  const names = new Set();

  // `export declare class Foo` — the non-rolled-up form, still possible.
  for (const m of clean.matchAll(
    /^export\s+declare\s+(?:abstract class|class|interface|function|const|let|var|enum|namespace|type)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(m[1]);
  }
  for (const m of clean.matchAll(/^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  // `export { A, B as C }` and `export type { T }`, possibly spanning lines.
  for (const m of clean.matchAll(/^export\s+(?:type\s+)?\{([\s\S]*?)\}\s*;?/gm)) {
    for (const clause of m[1].split(',')) {
      const parts = clause
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/);
      const name = (parts[1] ?? parts[0])?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * The public surface of an entry point: every exported name with its full
 * declaration.
 *
 * Regex over `.d.ts` rather than the TypeScript compiler API. Emitted
 * declarations are a far narrower language than source — no expressions, no
 * inference — and the alternative is asking the gate to depend on the compiler's
 * own resolution, which is part of what is being audited.
 */
function surfaceOf(files) {
  const declarations = new Map();
  const exported = new Set();

  for (const file of [...files].sort()) {
    const text = readFileSync(file, 'utf8');
    for (const [name, signature] of declarationsIn(text)) declarations.set(name, signature);
    for (const name of exportedNames(text)) exported.add(name);
  }

  if (exported.size === 0) {
    fail(
      'No exported names were found in the built declarations. Either the build is\n' +
        'broken or this gate has stopped understanding the emitted format — both of\n' +
        'which must fail rather than report an empty surface as a pass.',
    );
  }

  // Self-audit. An exported name with no captured declaration means the surface is
  // being under-reported, which is exactly the failure that let 23 changed types
  // through. Fail loudly rather than record a bare name.
  const undeclared = [...exported].filter((name) => !declarations.has(name)).sort();
  if (undeclared.length) {
    fail(
      `${undeclared.length} exported name(s) have no declaration this gate could parse,\n` +
        'so their signatures are not being checked. Teach `declarationsIn()` about the\n' +
        'form they use before trusting a green run.\n\n' +
        undeclared
          .slice(0, 20)
          .map((n) => `  ${n}`)
          .join('\n'),
    );
  }

  return [...exported]
    .sort()
    .map((name) => declarations.get(name))
    .filter(Boolean);
}

/** Collapse whitespace so reformatting is not reported as an API change. */
function normalise(fragment) {
  return sortUnionMembers(
    fragment
      .replace(/\s+/g, ' ')
      .replace(/\s*\{\s*$/, '')
      .trimEnd(),
  );
}

/**
 * Put the members of a string-literal union in a fixed order.
 *
 * TypeScript emits an inferred union in the order it resolved the members, which is not stable
 * across build states — `contentType` on the document viewer alternated between two orderings
 * of the same eleven literals on consecutive runs of this script, reporting a removal and an
 * addition each time. That is a false red, and a gate that reddens for no reason gets
 * regenerated without reading, which is how a real removal slips through.
 *
 * Only literal unions are touched. Reordering members of a union of *object* types would need
 * balanced-bracket parsing, and those do not reorder in practice.
 */
function sortUnionMembers(fragment) {
  return fragment.replace(/(?:"[^"]*"|'[^']*')(?:\s*\|\s*(?:"[^"]*"|'[^']*'))+/g, (union) =>
    union
      .split('|')
      .map((member) => member.trim())
      .sort()
      .join(' | '),
  );
}

const entries = entryPoints();
if (entries.length === 0) fail('The exports map advertises no typed entry points.');

const lines = [
  '<!-- GENERATED by scripts/beta-harness/api-surface.mjs. Do not edit by hand. -->',
  '',
  `# ${pkg.name} — public API surface`,
  '',
  'Regenerate with `npm run beta:api -- --update`, and **review the diff**: every',
  'line here is something a customer can import, so a removal or a signature change',
  'is a breaking change and needs a major version.',
  '',
  'Names, kinds and signatures only. Angular decorator metadata — a component',
  'selector, an input alias — is **not** covered, so a green check is not a promise',
  'of backwards compatibility.',
  '',
];

for (const entry of entries) {
  const importPath = entry.subpath === '.' ? pkg.name : `${pkg.name}${entry.subpath.slice(1)}`;
  const symbols = surfaceOf(collectDeclarationFiles(entry.file));
  lines.push(`## ${importPath}`, '', `${symbols.length} exported symbol(s).`, '', '```ts');
  lines.push(...symbols);
  lines.push('```', '');
}

const generated = `${lines.join('\n').trimEnd()}\n`;

if (update) {
  writeFileSync(SNAPSHOT, generated);
  const total = entries.length;
  console.log(`api-surface: snapshot written — ${total} entry point(s) -> ${SNAPSHOT}`);
  process.exit(0);
}

if (!existsSync(SNAPSHOT)) {
  fail(
    `${SNAPSHOT} does not exist. Create it with:\n\n  npm run beta:api -- --update\n\n` +
      'and commit it, so a later change to the published surface shows up as a diff.',
  );
}

const committed = readFileSync(SNAPSHOT, 'utf8');
if (committed === generated) {
  const counts = entries.map((e) => e.subpath).join(', ');
  console.log(`api-surface: pass — published surface matches the snapshot (${counts}).`);
  process.exit(0);
}

const committedLines = committed.split('\n');
const generatedLines = generated.split('\n');
const added = generatedLines.filter((l) => l.trim() && !committedLines.includes(l));
const removed = committedLines.filter((l) => l.trim() && !generatedLines.includes(l));

const detail = [
  'The published API surface no longer matches docs/api/platform.api.md.',
  '',
  'This is not automatically wrong — but it is a customer-visible change, so it has',
  'to be a decision rather than a side effect. A removed or reshaped export is a',
  'breaking change and needs a major version.',
];
if (removed.length) {
  detail.push(
    '',
    `REMOVED or CHANGED (${removed.length}):`,
    ...removed.slice(0, 25).map((l) => `  - ${l}`),
  );
  if (removed.length > 25) detail.push(`  … and ${removed.length - 25} more`);
}
if (added.length) {
  detail.push('', `ADDED (${added.length}):`, ...added.slice(0, 25).map((l) => `  + ${l}`));
  if (added.length > 25) detail.push(`  … and ${added.length - 25} more`);
}
detail.push('', 'If the change is intended:', '', '  npm run beta:api -- --update', '');
fail(detail.join('\n'));
