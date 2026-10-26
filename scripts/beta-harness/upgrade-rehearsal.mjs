#!/usr/bin/env node
/**
 * The upgrade rehearsal: install, customise, upgrade, and prove the customisation survived.
 *
 * `docs/adf-hx-beta-plan.md` Phase 6 calls this "the test that actually proves the model",
 * and it is the only check that speaks to the claim the whole four-layer contract rests on —
 * that **a customer upgrade is an `npm version` bump**. Every other gate tests one version
 * in isolation:
 *
 *   - `api-surface`    — has the published surface changed shape?
 *   - `publishability` — can the package be published, and do its declarations compile?
 *   - `fork-simulation`— does the template compile against ONE built version?
 *
 * None of them crosses a version boundary, so none of them can see the failure that
 * matters: an upgrade that compiles perfectly and silently drops the customer's
 * customisations.
 *
 * ## What a customer actually owns, and what must survive
 *
 * Three surfaces, taken from the reference customer in this repo rather than invented:
 *
 *   Layer 0  `public/agentic-ui-config/bootstrap.json`  theme, branding, languages
 *   Layer 1  `manifest.example.json`                    slot entries, overrides, IDs
 *   Layer 2  `libs/extensions/acme-extensions`          their own registered code
 *
 * ## The assertion that earns this script its place
 *
 * **Slot names and IDs are the upgrade contract.** The Layer 1 manifest is JSON: it names
 * `navbar`, `sidebar`, `toolbar`, and IDs like `template.actions.exportSummary`. Nothing
 * type-checks JSON. Rename a slot in the platform and every customer manifest referencing
 * it goes quietly inert — the app still boots, still compiles, and the customer's nav entry
 * is simply gone. That is the defect class this exists to catch, and it is invisible to a
 * compiler by construction.
 *
 * ## Honest limits
 *
 * The two versions differ only in their version string, because inventing API changes to
 * test against would be testing the invention. So this does not prove "any future upgrade
 * is safe" — nothing could. What it proves is that the *mechanism* holds and that the check
 * is **sensitive**: the negative control removes a slot id from the new package and this
 * script goes red. Run it with `--break-slot <name>` to see that for yourself.
 *
 * ## The result that justifies check 4c
 *
 * `--break-slot navbar` fails **both** the compile and the ID check, because the template
 * also writes `EXTENSION_SLOTS.navbar` in TypeScript. That case proves little: a compiler
 * would have caught it.
 *
 * `--break-slot toolbar` is the one that matters. `toolbar` is named in the JSON manifest
 * and referenced by **no** TypeScript in the customer's tree, so:
 *
 *     the customer app compiles against @nuxeo/satori-platform@0.2.0 (after the upgrade)
 *     upgrade-rehearsal: FAIL — 1 problem(s)
 *     - The manifest names 1 slot(s) the upgraded package no longer has: toolbar.
 *
 * A green compile and a broken customer. Check 4c is the only thing in the pipeline that
 * sees it — `api-surface` would notice the declaration changed, but that reads as "the
 * surface moved, update the snapshot", not "every manifest naming this slot is now inert".
 *
 * It is also static. It does not boot the app, so it cannot prove the nav entry renders —
 * `phase-6-a11y` and the evidence captures do that against a live server. This proves the
 * contract survives, not that the pixels arrive.
 *
 * Usage:
 *   node scripts/beta-harness/upgrade-rehearsal.mjs
 *   node scripts/beta-harness/upgrade-rehearsal.mjs --break-slot navbar   # negative control
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { entryTypes } from './package-types.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DIST = join(ROOT, 'dist', 'libs', 'platform');
const STAGE = join(ROOT, '.tmp-upgrade-rehearsal');
const TEMPLATE = 'apps/nuxeo-satori-template';

const argv = process.argv.slice(2);
const breakSlot = argv.includes('--break-slot') ? argv[argv.indexOf('--break-slot') + 1] : null;

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);

/** The customer-owned surfaces. Every one must be present, or the rehearsal is vacuous. */
const CUSTOMER_SURFACES = [
  {
    layer: 0,
    path: `${TEMPLATE}/public/agentic-ui-config/bootstrap.json`,
    what: 'theme, branding and language configuration',
  },
  {
    layer: 1,
    path: `${TEMPLATE}/manifest.example.json`,
    what: 'the runtime manifest: slot entries, overrides and ID references',
  },
  { layer: 1, path: `${TEMPLATE}/src/app/extensions/template-extensions.ts`, what: 'host wiring' },
  { layer: 2, path: 'libs/extensions/acme-extensions', what: 'the customer’s own library' },
];

if (!existsSync(DIST)) {
  console.error(
    'upgrade-rehearsal: dist/libs/platform does not exist.\n' +
      '  Run `npx nx build platform` first — this rehearses an upgrade of the built package.',
  );
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(join(DIST, 'package.json'), 'utf8'));

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

try {
  // ------------------------------------------------- 1. the customer's starting state ----

  const customerRoot = join(STAGE, 'customer');
  let surfaces = 0;
  for (const surface of CUSTOMER_SURFACES) {
    const from = join(ROOT, surface.path);
    if (!existsSync(from)) {
      fail(
        `Customer surface missing: ${surface.path} (Layer ${surface.layer} — ${surface.what}).\n` +
          '    Without it this rehearsal cannot claim that layer survives an upgrade.',
      );
      continue;
    }
    cpSync(from, join(customerRoot, surface.path), { recursive: true });
    surfaces += 1;
  }
  if (surfaces < CUSTOMER_SURFACES.length) {
    throw new Error('Cannot rehearse an upgrade without every customer surface present.');
  }
  const before = hashTree(customerRoot);
  notes.push(
    `${surfaces} customer surface(s) staged across Layers 0-2, ${before.size} file(s) hashed`,
  );

  // ----------------------------------------------------- 2. install the current version ----

  const oldVersion = pkg.version;
  const installedOld = unpackInto(join(STAGE, 'installed-old'));
  notes.push(`installed ${pkg.name}@${oldVersion} from a packed tarball`);

  compileCustomerApp(installedOld, `${pkg.name}@${oldVersion}`, 'before the upgrade');

  // -------------------------------------------------------------- 3. publish a new version ----

  /**
   * A bumped minor, produced by re-unpacking and rewriting `version`.
   *
   * The code is identical, and that is stated in the header rather than hidden: inventing
   * API changes would be testing the invention. The assertions below do not depend on the
   * two builds differing, and `--break-slot` is what proves they are sensitive.
   */
  const [major, minor] = oldVersion.split('.');
  const newVersion = `${major}.${Number(minor) + 1}.0`;
  const installedNew = unpackInto(join(STAGE, 'installed-new'));
  const newPkgPath = join(installedNew, 'package.json');
  const newPkg = JSON.parse(readFileSync(newPkgPath, 'utf8'));
  newPkg.version = newVersion;
  writeFileSync(newPkgPath, `${JSON.stringify(newPkg, null, 2)}\n`);

  if (breakSlot) {
    // The negative control. Removes one slot id from the new package's declarations, which
    // is exactly what a careless rename looks like to a customer's manifest.
    const decl = entryTypes(installedNew, './extensions');
    const text = readFileSync(decl, 'utf8');
    // `breakSlot` comes from `--break-slot` on the command line, so it is interpolated into the
    // pattern escaped. Unescaped it is regex injection (CodeQL `js/regex-injection`): a slot name
    // containing `.` or `(` would match something other than itself, and the negative control
    // would then "pass" against a slot that was never there.
    const slotRe = breakSlot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stripped = text.replace(new RegExp(`\\s*readonly ${slotRe}: "${slotRe}";`), '');
    if (stripped === text) {
      throw new Error(`--break-slot ${breakSlot}: that slot is not in the shipped declarations.`);
    }
    writeFileSync(decl, stripped);
    console.log(
      `upgrade-rehearsal: NEGATIVE CONTROL — removed slot \`${breakSlot}\` from v${newVersion}\n`,
    );
  }

  notes.push(`upgraded to ${pkg.name}@${newVersion}`);

  // ------------------------------------------------------------------- 4. the assertions ----

  // 4a. The customer changed nothing to accept the upgrade.
  const after = hashTree(customerRoot);
  const touched = [...after].filter(([f, h]) => before.get(f) !== h).map(([f]) => f);
  const removed = [...before].filter(([f]) => !after.has(f)).map(([f]) => f);
  if (touched.length || removed.length) {
    fail(
      'The upgrade modified customer-owned files, so it is not an `npm version` bump:\n' +
        [...touched, ...removed.map((f) => `${f} (removed)`)]
          .slice(0, 8)
          .map((f) => `      ${f}`)
          .join('\n'),
    );
  } else {
    notes.push(`all ${before.size} customer file(s) byte-identical after the upgrade`);
  }

  // 4b. The customer app still compiles against the new version.
  compileCustomerApp(installedNew, `${pkg.name}@${newVersion}`, 'after the upgrade');

  // 4c. Every slot the manifest names still exists in the new package.
  const shippedSlots = slotsFrom(installedNew);
  if (shippedSlots.length === 0) {
    fail(
      'No slot ids could be read from the new package, so the ID-compatibility check\n' +
        '    asserted nothing. Parse `extensions/index.d.ts` before trusting a pass.',
    );
  }

  // Parsed directly: this repo's JSON "comments" are `$`-prefixed keys, not `//`, so the
  // manifest is valid JSON. The `$`-keys are filtered out below rather than stripped here.
  const manifest = JSON.parse(readFileSync(join(ROOT, TEMPLATE, 'manifest.example.json'), 'utf8'));
  const named = Object.keys(manifest.extensions?.slots ?? {}).filter((k) => !k.startsWith('$'));
  if (named.length === 0) {
    fail('The manifest names no slots, so there is no Layer 1 contract to verify.');
  }

  const missing = named.filter((slot) => !shippedSlots.includes(slot));
  if (missing.length) {
    fail(
      `The manifest names ${missing.length} slot(s) the upgraded package no longer has: ` +
        `${missing.join(', ')}.\n` +
        `    Shipped: ${shippedSlots.join(', ')}\n` +
        '    Nothing type-checks JSON, so this is silent: the app boots, compiles, and the\n' +
        "    customer's entries are simply gone.",
    );
  } else if (named.length) {
    notes.push(
      `all ${named.length} manifest-named slot(s) still exist in the upgraded package ` +
        `(${named.join(', ')})`,
    );
  }

  /**
   * 4d. The customer reaches the platform only through published entry points.
   *
   * ## What this check used to be, and why that was wrong
   *
   * It ran `git status --porcelain libs apps` and failed on a dirty tree, claiming to prove
   * that "no edits to our sources were needed to make the upgrade work". It proved nothing
   * of the kind. This script works entirely inside a staging directory and never touches
   * the repository, so that claim is true **by construction** — unfalsifiable, which is the
   * defect this repository has paid for more than once. What the check actually detected was
   * uncommitted work, which says nothing about an upgrade and turned the gate red for anyone
   * mid-change. It was noticed exactly that way, on the commit that added the E2E project.
   *
   * ## What survives an upgrade, and therefore what is worth asserting
   *
   * A deep import into platform internals. `@nuxeo/satori-platform/extensions` is supported
   * and will still resolve next version; a path into its guts is not, and is precisely what
   * breaks when the internals move — the failure this phase's claim depends on not
   * happening. So the staged customer tree is checked for specifiers outside the published
   * `exports` map, against the map of the **upgraded** package rather than a hardcoded list.
   */
  const published = new Set(
    Object.keys(pkg.exports ?? {})
      .filter((s) => s !== './package.json')
      .map((s) => s.replace(/^\./, pkg.name)),
  );
  // Four forms, and the fourth was missing until a probe used it. A **bare side-effect
  // import** — `import '@nuxeo/satori-platform/extensions/internal/x';` — has no `from` and
  // no parentheses, so the first version of this regex sailed straight past the exact shape
  // the check exists to reject. `\\bimport\\s*['"]` is that case.
  const SPECIFIER = new RegExp(
    `(?:from\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*)['"](${pkg.name.replace('/', '\\/')}[^'"]*)['"]`,
    'g',
  );

  let inspected = 0;
  const deep = [];
  for (const [file] of after) {
    if (!/\.(ts|mts|js|mjs)$/.test(file)) continue;
    inspected += 1;
    const text = readFileSync(join(customerRoot, file), 'utf8');
    for (const m of text.matchAll(SPECIFIER)) {
      if (!published.has(m[1])) deep.push(`${file} -> ${m[1]}`);
    }
  }

  if (inspected === 0) {
    fail(
      'No TypeScript or JavaScript was staged, so check 4d inspected nothing. The customer\n' +
        '    surfaces list is probably wrong.',
    );
  } else if (deep.length) {
    fail(
      `The customer imports ${deep.length} path(s) outside the published exports map:\n` +
        deep
          .slice(0, 6)
          .map((d) => `      ${d}`)
          .join('\n') +
        `\n    Published: ${[...published].join(', ')}\n` +
        '    A deep path into internals is what actually breaks on an upgrade, because the\n' +
        '    internals are free to move without that being a breaking change.',
    );
  } else {
    notes.push(
      `${inspected} customer source file(s) import only published entry points ` +
        `(${published.size} available)`,
    );
  }
} finally {
  rmSync(STAGE, { recursive: true, force: true });
}

// ------------------------------------------------------------------------------ report ----

if (failures.length) {
  console.error(`\nupgrade-rehearsal: FAIL — ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}

console.log(`upgrade-rehearsal: pass — a customisation across Layers 0-2 survived an upgrade`);
for (const n of notes) console.log(`  - ${n}`);
if (!breakSlot) {
  console.log(
    '\n  Sensitivity: run with `--break-slot navbar` to remove a slot from the new\n' +
      '  package and watch check 4c go red. A pass here means nothing until you have.',
  );
}

/* ------------------------------------------------------------------------- helpers ---- */

/** `npm pack` the built package and unpack it, the way an install leaves it. */
function unpackInto(target) {
  mkdirSync(target, { recursive: true });
  const packed = execFileSync('npm', ['pack', DIST, '--pack-destination', STAGE], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .pop();
  execFileSync('tar', ['-xzf', join(STAGE, packed), '-C', target, '--strip-components', '1'], {
    cwd: ROOT,
  });
  return target;
}

/**
 * Compile the template against an installed copy, with `paths` repointed at it.
 *
 * The same technique as `fork-simulation.mjs`, against an unpacked tarball rather than
 * `dist/` — so this exercises the tree a customer really has, `exports` map included.
 */
function compileCustomerApp(installed, label, when) {
  const base = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8'));
  const rewritten = {};
  let repointed = 0;
  for (const [alias, targets] of Object.entries(base.compilerOptions?.paths ?? {})) {
    if (alias === pkg.name) {
      rewritten[alias] = [entryTypes(installed, '.')];
      repointed += 1;
    } else if (alias.startsWith(`${pkg.name}/`)) {
      rewritten[alias] = [entryTypes(installed, `./${alias.slice(pkg.name.length + 1)}`)];
      repointed += 1;
    } else {
      rewritten[alias] = targets;
    }
  }
  if (repointed === 0) {
    fail(
      `No alias starts with "${pkg.name}", so the compile ${when} would have used the source\n` +
        '    tree and passed without testing the installed package.',
    );
    return;
  }

  const appConfig = JSON.parse(
    readFileSync(join(ROOT, TEMPLATE, 'tsconfig.app.json'), 'utf8').replace(
      /^\s*\/\*[\s\S]*?\*\/\s*$/gm,
      '',
    ),
  );
  const out = join(STAGE, `tsc-${when.replace(/\s+/g, '-')}`);
  const configPath = join(STAGE, `tsconfig.${when.replace(/\s+/g, '-')}.json`);
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        extends: join(ROOT, 'tsconfig.json'),
        compilerOptions: {
          ...(appConfig.compilerOptions ?? {}),
          baseUrl: ROOT,
          paths: rewritten,
          outDir: out,
          types: [],
          skipLibCheck: true,
        },
        include: [join(ROOT, TEMPLATE, 'src/**/*.ts')],
        exclude: [join(ROOT, TEMPLATE, 'src/**/*.spec.ts')],
      },
      null,
      2,
    ),
  );

  try {
    execFileSync('npx', ['ngc', '-p', configPath], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
    notes.push(`the customer app compiles against ${label} (${when})`);
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    fail(
      `The customer app does not compile against ${label} ${when}:\n` +
        output
          .split('\n')
          .filter((l) => l.trim())
          .slice(0, 8)
          .map((l) => `      ${l}`)
          .join('\n'),
    );
  }
}

/** Slot ids as the upgraded package declares them. */
function slotsFrom(installed) {
  const decl = entryTypes(installed, './extensions');
  if (!existsSync(decl)) return [];
  const text = readFileSync(decl, 'utf8');
  const block = /declare const EXTENSION_SLOTS:\s*\{([\s\S]*?)\n\};/.exec(text);
  if (!block) return [];
  return [...block[1].matchAll(/readonly\s+'?([\w-]+)'?\s*:/g)].map((m) => m[1]);
}

function hashTree(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else
        out.set(
          relative(root, full),
          createHash('sha256').update(readFileSync(full)).digest('hex'),
        );
    }
  };
  walk(root);
  return out;
}
