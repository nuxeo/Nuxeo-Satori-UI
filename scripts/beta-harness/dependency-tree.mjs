#!/usr/bin/env node
import { spawnToolSync } from './package-command.mjs';

/**
 * Dependency-tree gate — NXSAT-308 acceptance criterion 3: *no adf-hx, adf-core, adf-extensions
 * or js-api package remains in the dependency tree, checked in CI.*
 *
 * ## What it looks for
 *
 * The five packages in `FORBIDDEN`, in five places, because each place can hold one the other four
 * miss:
 *
 *   lockfile   every `packages` key in package-lock.json whose last segment is
 *              `node_modules/<name>`, nested ones included, plus an npm alias whose entry carries
 *              the real name. The lock is what `npm ci` installs from.
 *   installed  `npm ls --all --json --long` on the installed tree, read from the parsed tree and
 *              never from the exit status. npm exits non-zero for problems that have nothing to do
 *              with these packages — an extraneous or invalid entry — and does so on this
 *              repository's worktrees today, so an exit-status check would be red for the wrong
 *              reason or, inverted, green for the wrong one.
 *   manifests  the root package.json and every package.json under apps/, libs/ and tools/, in every
 *              dependency field: dependencies, devDependencies, optionalDependencies,
 *              peerDependencies, peerDependenciesMeta, bundleDependencies and overrides (keys at any
 *              depth, and `npm:` alias values). This is what catches the `libs/platform` peer, which
 *              no lock entry represents.
 *   npmrc      an `@alfresco:registry` mapping in the root .npmrc. Comment lines do not count.
 *   imports    a module specifier naming one of the five, or a subpath of one, in any source or
 *              style file under apps/ or libs/. Code is read with the TypeScript scanner, so a
 *              comment or a string that mentions a name is not an import. Stylesheets have a
 *              scanner of their own, `stylesheet-scan.mjs`, shared with the supply-chain gate, so
 *              the same holds there: an `@import` counts every target, quoted or `url(...)`, and a
 *              `@use` or `@forward` its first, the rest configuration.
 *
 * ## Blocking since the ADF removal
 *
 * All five were on main by construction while ADF was in use, so a blocking gate would have been
 * red from the day it landed, and a permanently red gate gets bypassed. Until the ADF removal
 * (NXSAT-638) it ran REPORT-ONLY: it listed every finding — the removal backlog — and exited 0.
 * `BLOCKING` below is the one switch, and the removal set it to `true`, so any finding now fails.
 * `--report-only` still forces the old mode, for the selftest.
 *
 * Report-only is not "cannot fail":
 *
 *   - a location that could not be inspected — a `--root` that does not resolve, an unreadable lock,
 *     manifest or .npmrc, a lock or manifest that is valid JSON but not an object, no installed tree,
 *     `npm ls` output that is not a JSON tree object, a directory under apps/, libs/ or tools/ that
 *     cannot be listed, a link that cannot be resolved or that leaves the repository (a root-level
 *     lock, manifest or .npmrc included), a source file that cannot be read — exits 2 in either
 *     mode. A gap in the list is not a short list;
 *   - report-only on a tree with **no** findings exits 1. A clean tree means the removal has
 *     landed, and a gate left report-only after that would let the packages come back unseen, so
 *     the commit that removes the last finding is made to flip `BLOCKING` in the same change.
 *
 * ## What it does not see
 *
 * References that are neither a dependency nor an import: angular.json asset globs that copy files
 * out of a package's folder, scripts and tools that read a package's files by path, and prose.
 * Section 4 of the NXSAT-308 plan lists those for the removal commit. They fail loudly — a missing
 * asset, a red `bundle` gate — when the package goes, rather than shipping it silently.
 *
 * Usage:
 *   node scripts/beta-harness/dependency-tree.mjs [--root <dir>] [--blocking | --report-only]
 *                                                [--list-files] [--json]
 *
 *   --root         the repository to inspect (default: the one this script lives in)
 *   --blocking     force blocking mode, whatever `BLOCKING` says — for previews and the selftest
 *   --report-only  force report-only mode — for the selftest
 *   --list-files   print every importing file rather than one line per project
 *   --json         machine-readable output, same exit codes, failures before the scan included
 *
 * Exit: 0 pass, or report-only with findings · 1 findings in blocking mode, or report-only on a
 * clean tree · 2 a location could not be inspected.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { styleSpecifiers } from './stylesheet-scan.mjs';

/**
 * THE SWITCH. `false` = report-only, `true` = blocking.
 *
 * `true` since the ADF removal (NXSAT-638). CI, the `beta:gate` entry and the npm script all run
 * this file with no mode flag, so this one line decides the mode everywhere, and setting it back to
 * `false` on a clean tree is caught by the clean-tree rule above.
 */
const BLOCKING = true;

const FORBIDDEN = Object.freeze([
  '@alfresco/adf-hx-content-services',
  '@alfresco/adf-core',
  '@alfresco/adf-extensions',
  '@alfresco/js-api',
  '@hylandsoftware/hxcs-js-client',
]);

const SCRIPT = 'scripts/beta-harness/dependency-tree.mjs';
const MANIFEST_DIRS = ['apps', 'libs', 'tools'];
const IMPORT_DIRS = ['apps', 'libs'];
/**
 * Installed packages are not ours to scan and `.git` is not source. Nothing else is skipped by name:
 * build output lives at the repository root, outside the scanned trees, and a source directory
 * called `tmp` or `dist` under `src/` is source like any other.
 */
const SKIP_DIRS = new Set(['node_modules', '.git']);
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const STYLE_FILE = /\.(?:s[ac]ss|css|less)$/;
const SPEC_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
];

// ------------------------------------------------------------------------------------- args ----

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const asJson = has('--json');

if (has('--blocking') && has('--report-only')) {
  await cannotStart('--blocking and --report-only contradict each other.', false);
}

const rootArg = option('--root');
// Real path, because `npm ls --long` reports real paths and macOS's temp directory is a symlink —
// `relative()` across the two printed `../../private/var/...` for every installed package.
let root;
try {
  root = realpathSync(resolve(rootArg ?? join(import.meta.dirname, '..', '..')));
} catch (error) {
  await cannotStart(
    `the root ${rootArg ?? '(this repository)'} cannot be resolved: ${error.message}`,
  );
}
const blocking = has('--blocking') ? true : has('--report-only') ? false : BLOCKING;
const modeSource =
  has('--blocking') || has('--report-only')
    ? 'forced on the command line'
    : `BLOCKING = ${BLOCKING} in ${SCRIPT}`;
const listFiles = has('--list-files');

/** @type {{ location: 'lockfile'|'installed'|'manifest'|'npmrc'|'import', pkg: string, where: string, detail: string, spec?: boolean, project?: string }[]} */
const findings = [];
/** directory -> the Nx project it belongs to, filled by `projectOf`. */
const projectCache = new Map();
/** Locations that could not be read. Any entry here is exit 2, whatever the mode. */
const gaps = [];
const notes = [];

// ------------------------------------------------------------------------------- 1. lockfile ---

{
  const lockPath = join(root, 'package-lock.json');
  const lock = readJson(lockPath, 'package-lock.json');
  if (
    lock &&
    (typeof lock.packages !== 'object' || lock.packages === null || Array.isArray(lock.packages))
  ) {
    gaps.push(
      `package-lock.json has no "packages" map (lockfileVersion ${lock.lockfileVersion ?? '?'}), so its entries cannot be listed.`,
    );
  } else if (lock) {
    const entries = Object.entries(lock.packages);
    for (const [key, entry] of entries) {
      const installedAs = installedNameOf(key);
      if (installedAs === null) continue;
      // An aliased entry is keyed by the alias and carries the real name in `name`.
      const realName = typeof entry?.name === 'string' ? entry.name : installedAs;
      const pkg = FORBIDDEN.find((n) => n === realName || n === installedAs);
      if (!pkg) continue;
      const traits = ['dev', 'optional', 'devOptional', 'peer'].filter((t) => entry?.[t] === true);
      const declaredBy = entries
        .filter(([, e]) => declares(e, installedAs))
        .map(([k]) => (k === '' ? '<root>' : k));
      findings.push({
        location: 'lockfile',
        pkg,
        where: key,
        detail: [
          `${pkg}@${entry?.version ?? '?'} at ${key}`,
          installedAs !== pkg ? `(npm alias "${installedAs}")` : '',
          traits.length ? `[${traits.join(', ')}]` : '',
          declaredBy.length ? `— declared by ${abbreviate(declaredBy)}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
  }
}

// ------------------------------------------------------------------------- 2. installed tree ---

{
  if (!existsSync(join(root, 'node_modules'))) {
    gaps.push(
      'node_modules/ is absent, so there is no installed tree to inspect. Run `npm ci` first — ' +
        'the gate cannot say the installed tree is clean when there is none.',
    );
  } else {
    const proc = spawnToolSync('npm', ['ls', '--all', '--json', '--long'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    let tree = null;
    if (proc.error) {
      gaps.push(`npm ls could not be run: ${proc.error.message}`);
    } else {
      try {
        const parsed = JSON.parse(proc.stdout);
        // Valid JSON of another shape parses without throwing, and would walk as an empty tree.
        const shape = !isObject(parsed)
          ? `${describe(parsed)}, not a dependency tree object`
          : parsed.dependencies !== undefined && !isObject(parsed.dependencies)
            ? `a tree whose "dependencies" is ${describe(parsed.dependencies)}, not an object`
            : null;
        if (shape) gaps.push(`npm ls --all --json printed ${shape}`);
        else tree = parsed;
      } catch {
        gaps.push(
          `npm ls --all --json exited ${proc.status} without printing a JSON tree:\n${lastLines(proc.stderr, 8)}`,
        );
      }
    }
    if (tree) {
      const problems = Array.isArray(tree.problems) ? tree.problems.length : 0;
      notes.push(
        proc.status === 0
          ? 'npm ls exited 0.'
          : `npm ls exited ${proc.status} with ${problems} problem(s) of its own; the gate reads the tree, not the exit status.`,
      );
      /** physical path -> { pkg, version, alias, dependents } */
      const installed = new Map();
      const walk = (node, parentLabel) => {
        for (const [key, child] of Object.entries(node?.dependencies ?? {})) {
          if (!child || typeof child !== 'object') continue;
          // Declared but not on disk: that is a manifest finding, not an installed one.
          if (child.missing) continue;
          const realName = typeof child.name === 'string' ? child.name : key;
          const pkg = FORBIDDEN.find((n) => n === realName || n === key);
          if (pkg) {
            const where =
              typeof child.path === 'string' ? toRepoPath(child.path) : `${parentLabel} > ${key}`;
            const seen = installed.get(where) ?? {
              pkg,
              version: child.version ?? '?',
              alias: key !== pkg ? key : null,
              extraneous: child.extraneous === true,
              dependents: new Set(),
            };
            seen.dependents.add(parentLabel);
            installed.set(where, seen);
          }
          walk(child, key);
        }
      };
      walk(tree, '<root>');
      for (const [where, item] of installed) {
        findings.push({
          location: 'installed',
          pkg: item.pkg,
          where,
          detail: [
            `${item.pkg}@${item.version} at ${where}`,
            item.alias ? `(npm alias "${item.alias}")` : '',
            item.extraneous ? '[extraneous]' : '',
            `— under ${abbreviate([...item.dependents])}`,
          ]
            .filter(Boolean)
            .join(' '),
        });
      }
    }
  }
}

// ------------------------------------------------------------------------------ 3. manifests ---

{
  const manifests = [
    'package.json',
    ...MANIFEST_DIRS.flatMap((d) =>
      walkFiles(d, (f) => f.endsWith(`${sep}package.json`) || f === 'package.json'),
    ),
  ];
  for (const rel of manifests) {
    const manifest = readJson(join(root, rel), rel);
    if (!manifest) continue;
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        const pkg = forbiddenDeclaration(name, spec);
        if (pkg) {
          findings.push({
            location: 'manifest',
            pkg,
            where: rel,
            detail: `${rel} ${field}.${name}${typeof spec === 'string' ? ` = ${spec}` : ''}`,
          });
        }
      }
    }
    for (const field of ['bundleDependencies', 'bundledDependencies']) {
      if (!Array.isArray(manifest[field])) continue;
      for (const name of manifest[field]) {
        if (FORBIDDEN.includes(name)) {
          findings.push({
            location: 'manifest',
            pkg: name,
            where: rel,
            detail: `${rel} ${field}[] ${name}`,
          });
        }
      }
    }
    walkOverrides(manifest.overrides, 'overrides', (path, name, value) => {
      const pkg = forbiddenDeclaration(name, value);
      if (pkg) {
        findings.push({
          location: 'manifest',
          pkg,
          where: rel,
          detail: `${rel} ${path}${typeof value === 'string' ? ` = ${value}` : ' { … }'}`,
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------------- 4. .npmrc ---

{
  const npmrc = join(root, '.npmrc');
  let text = null;
  // lstat, not existsSync: a dangling `.npmrc` link is an entry that cannot be read, not an absence.
  let present = false;
  try {
    lstatSync(npmrc);
    present = true;
  } catch {
    /* no .npmrc at all, which is a clean answer */
  }
  if (present && resolvesInside(npmrc, '.npmrc')) {
    try {
      text = readFileSync(npmrc, 'utf8');
    } catch (error) {
      gaps.push(`.npmrc: cannot read — ${error.message}`);
    }
  }
  if (text !== null) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const text = line.trim();
      if (text.startsWith('#') || text.startsWith(';')) return;
      if (/^@alfresco:registry\s*=/.test(text)) {
        findings.push({
          location: 'npmrc',
          pkg: '@alfresco',
          where: `.npmrc:${i + 1}`,
          detail: `.npmrc:${i + 1} ${text}`,
        });
      }
    });
  }
}

// --------------------------------------------------------------------------------- 5. imports ---

{
  const files = IMPORT_DIRS.flatMap((d) =>
    walkFiles(d, (f) => CODE_FILE.test(f) || STYLE_FILE.test(f)),
  );
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch (error) {
      gaps.push(`${rel}: cannot read — ${error.message}`);
      continue;
    }
    const specifiers = CODE_FILE.test(rel) ? codeSpecifiers(text) : styleSpecifiers(text, rel);
    const hits = new Map();
    for (const specifier of specifiers) {
      const pkg = FORBIDDEN.find((n) => specifier === n || specifier.startsWith(`${n}/`));
      if (pkg && !hits.has(pkg)) hits.set(pkg, specifier);
    }
    for (const [pkg, specifier] of hits) {
      findings.push({
        location: 'import',
        pkg,
        where: rel,
        detail: `${rel} ${specifier}`,
        spec: SPEC_FILE.test(rel),
        project: projectOf(rel),
      });
    }
  }
}

// ---------------------------------------------------------------------------------- report ----

const LOCATIONS = ['lockfile', 'installed', 'manifest', 'import'];
const perPackage = Object.fromEntries(
  FORBIDDEN.map((pkg) => [
    pkg,
    Object.fromEntries(
      LOCATIONS.map((loc) => [
        loc,
        findings.filter((f) => f.pkg === pkg && f.location === loc).length,
      ]),
    ),
  ]),
);
const npmrcCount = findings.filter((f) => f.location === 'npmrc').length;
const total = findings.length;
const packagesPresent = FORBIDDEN.filter((pkg) =>
  LOCATIONS.some((loc) => perPackage[pkg][loc] > 0),
);

let verdict;
let exitCode;
if (gaps.length > 0) {
  verdict = `CANNOT INSPECT — ${gaps.length} location(s) could not be read. This is not a pass in either mode.`;
  exitCode = 2;
} else if (blocking && total > 0) {
  verdict = `FAIL — ${total} finding(s) of ${packagesPresent.length} of the ${FORBIDDEN.length} removed ADF packages (blocking).`;
  exitCode = 1;
} else if (blocking) {
  verdict = `pass — none of the ${FORBIDDEN.length} packages is in the lock, the installed tree, a manifest, .npmrc or an import under apps/ or libs/ (blocking).`;
  exitCode = 0;
} else if (total > 0) {
  verdict = `REPORT-ONLY — ${total} finding(s) across ${packagesPresent.length} of the ${FORBIDDEN.length} packages; exit 0 because report-only mode was forced.`;
  exitCode = 0;
} else {
  verdict =
    `FAIL — the tree is clean but the gate is still report-only. Set BLOCKING = true in ${SCRIPT} ` +
    'in this same change, or the packages can come back without anything going red.';
  exitCode = 1;
}

// `process.exitCode` rather than `process.exit()`: stdout on a pipe is asynchronous on macOS, and
// exiting straight after a large write truncated the `--json` report mid-object.
process.exitCode = exitCode;
if (asJson) {
  console.log(
    JSON.stringify(
      {
        verdict,
        exitCode,
        mode: blocking ? 'blocking' : 'report-only',
        modeSource,
        root,
        total,
        perPackage,
        npmrc: npmrcCount,
        findings,
        gaps,
        notes,
      },
      null,
      2,
    ),
  );
} else {
  const out = exitCode === 0 ? console.log : console.error;
  out(`dependency-tree: ${verdict}`);
  out(`  mode   ${blocking ? 'BLOCKING' : 'REPORT-ONLY'} (${modeSource})`);
  out(`  root   ${root}`);
  for (const note of notes) out(`  note   ${note}`);
  for (const gap of gaps) out(`  GAP    ${gap.replace(/\n/g, '\n         ')}`);
  out('');
  out(table());
  if (total > 0) {
    out('');
    for (const loc of ['lockfile', 'installed', 'manifest', 'npmrc']) {
      for (const f of findings.filter((x) => x.location === loc)) out(`  [${loc}] ${f.detail}`);
    }
    for (const line of importLines()) out(`  ${line}`);
  }
}

// --------------------------------------------------------------------------------- helpers ----

/**
 * Report a failure found before the scan can start — exit 2, as JSON with `--json` — and stop.
 * The write is awaited because `process.exit()` straight after one can truncate a pipe.
 */
async function cannotStart(reason, inspectionGap = true) {
  const verdict = inspectionGap ? `CANNOT INSPECT — ${reason}` : reason;
  const [stream, text] = asJson
    ? [
        process.stdout,
        JSON.stringify(
          { verdict, exitCode: 2, gaps: inspectionGap ? [reason] : [], findings: [], notes: [] },
          null,
          2,
        ),
      ]
    : [process.stderr, `dependency-tree: ${verdict}`];
  await new Promise((done) => stream.write(`${text}\n`, done));
  process.exit(2);
}

function table() {
  const head = ['package', 'lockfile', 'installed', 'manifests', 'imports', 'total'];
  const rows = FORBIDDEN.map((pkg) => {
    const c = perPackage[pkg];
    const sum = LOCATIONS.reduce((n, loc) => n + c[loc], 0);
    return [pkg, c.lockfile, c.installed, c.manifest, c.import, sum];
  });
  const totals = LOCATIONS.map((loc) => FORBIDDEN.reduce((n, pkg) => n + perPackage[pkg][loc], 0));
  rows.push(['@alfresco:registry in .npmrc', '', '', '', '', npmrcCount]);
  rows.push(['total', ...totals, total]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const fmt = (r) =>
    `  ${r.map((cell, i) => (i === 0 ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i]))).join('  ')}`;
  return [fmt(head), ...rows.map(fmt)].join('\n');
}

/** One line per Nx project, or per file with `--list-files`. Imports are the long tail. */
function importLines() {
  const imports = findings.filter((f) => f.location === 'import');
  if (listFiles) return imports.map((f) => `[import] ${f.detail}${f.spec ? ' (spec)' : ''}`);
  const byProject = new Map();
  for (const f of imports) {
    const p = byProject.get(f.project) ?? {
      files: new Set(),
      specFiles: new Set(),
      pkgs: new Map(),
    };
    p.files.add(f.where);
    if (f.spec) p.specFiles.add(f.where);
    p.pkgs.set(f.pkg, (p.pkgs.get(f.pkg) ?? 0) + 1);
    byProject.set(f.project, p);
  }
  const lines = [...byProject.entries()]
    .sort((a, b) => b[1].files.size - a[1].files.size)
    .map(([project, p]) => {
      const pkgs = [...p.pkgs.entries()].map(([pkg, n]) => `${pkg} ${n}`).join(', ');
      return `[import] ${project} — ${p.files.size} file(s), ${p.files.size - p.specFiles.size} non-spec: ${pkgs}`;
    });
  if (lines.length) lines.push('(--list-files prints every importing file)');
  return lines;
}

/** The package a lock key installs, or `null` for a key outside any `node_modules` (a workspace). */
function installedNameOf(key) {
  const marker = 'node_modules/';
  const at = key.lastIndexOf(marker);
  return at < 0 ? null : key.slice(at + marker.length);
}

/** Does this lock entry declare a dependency on `name`, in any field npm will act on? */
function declares(entry, name) {
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(
    (field) => Object.hasOwn(entry?.[field] ?? {}, name),
  );
}

/**
 * Which forbidden package a manifest entry brings in: the key itself, or the target of an
 * `npm:<name>@<range>` alias value. Scoped names carry their own leading `@`, so the version
 * separator is the last `@`, not the first.
 */
function forbiddenDeclaration(name, spec) {
  if (FORBIDDEN.includes(name)) return name;
  if (typeof spec === 'string' && spec.startsWith('npm:')) {
    const target = spec.slice(4);
    const at = target.lastIndexOf('@');
    const aliased = at > 0 ? target.slice(0, at) : target;
    if (FORBIDDEN.includes(aliased)) return aliased;
  }
  return null;
}

/**
 * Visit every key in an `overrides` block at any depth. A key may carry a version selector
 * (`"name@^1.0.0"`), and a nested object is a scope rather than a pin, but either way the key names
 * a package npm will resolve — so both are reported.
 */
function walkOverrides(node, path, visit, container = null) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    // `"."` replaces the package whose object this is, so it is that package's entry — and its
    // value may be an `npm:` alias onto a forbidden one while the container's own name is not.
    if (key === '.') {
      if (container !== null) visit(`${path}["."]`, container, value);
      continue;
    }
    const at = key.lastIndexOf('@');
    const name = at > 0 ? key.slice(0, at) : key;
    visit(`${path}.${key}`, name, value);
    if (value && typeof value === 'object') walkOverrides(value, `${path}.${key}`, visit, name);
  }
}

/** Import, export, require, dynamic `import()` and triple-slash type references — never comments. */
function codeSpecifiers(text) {
  const info = ts.preProcessFile(text, true, true);
  return [
    ...info.importedFiles.map((f) => f.fileName),
    ...info.typeReferenceDirectives.map((f) => f.fileName),
  ];
}

/**
 * Files under `dir` (relative to root) that `keep` accepts, as root-relative paths.
 *
 * A directory that cannot be listed, or a link that cannot be resolved, is a gap rather than a
 * skip: everything beneath it would otherwise drop out of the scan, and a blocking run would read
 * the missing subtree as a clean one. Symlinked directories are followed, once each by real path.
 */
function walkFiles(dir, keep) {
  const out = [];
  const seen = new Set();
  const visit = (rel) => {
    let entries;
    try {
      const real = realpathSync(join(root, rel));
      if (real !== root && !real.startsWith(`${root}${sep}`)) {
        gaps.push(`${rel}: links outside the repository, to ${real} — not scanned`);
        return;
      }
      if (seen.has(real)) return;
      seen.add(real);
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch (error) {
      gaps.push(`${rel}/: cannot list — ${error.message}`);
      return;
    }
    for (const entry of entries) {
      const child = join(rel, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const target = statSync(join(root, child));
          // The scan scope is the repository. A link out of it is not followed — it could reach
          // `/` or a runner's workspace — and is not skipped either, because what it points at is
          // source the build may compile.
          const real = realpathSync(join(root, child));
          if (real !== root && !real.startsWith(`${root}${sep}`)) {
            gaps.push(`${child}: links outside the repository, to ${real} — not scanned`);
            continue;
          }
          isDirectory = target.isDirectory();
          isFile = target.isFile();
        } catch (error) {
          gaps.push(`${child}: cannot resolve link — ${error.message}`);
          continue;
        }
      }
      if (isDirectory) {
        if (!SKIP_DIRS.has(entry.name)) visit(child);
      } else if (isFile && keep(child)) {
        out.push(child);
      }
    }
  };
  // `existsSync` follows links, so a dangling `libs` link reads as "no libs/" and would be skipped.
  let top;
  try {
    top = lstatSync(join(root, dir));
  } catch {
    return out;
  }
  if (top.isSymbolicLink() && !existsSync(join(root, dir))) {
    gaps.push(`${dir}: cannot resolve link — its target does not exist`);
    return out;
  }
  visit(dir);
  return out.sort();
}

/** The Nx project a file belongs to: the nearest ancestor holding a `project.json`. */
function projectOf(rel) {
  let dir = dirname(rel);
  const trail = [];
  while (dir && dir !== '.' && dir !== dirname(dir)) {
    if (projectCache.has(dir)) {
      const hit = projectCache.get(dir);
      for (const d of trail) projectCache.set(d, hit);
      return hit;
    }
    trail.push(dir);
    if (existsSync(join(root, dir, 'project.json'))) {
      for (const d of trail) projectCache.set(d, dir);
      return dir;
    }
    dir = dirname(dir);
  }
  // No project.json (a bare fixture): fall back to the first two segments, `libs/<name>`.
  const fallback = rel.split(sep).slice(0, 2).join(sep);
  for (const d of trail) projectCache.set(d, fallback);
  return fallback;
}

/**
 * A JSON object, or `null` with a gap recorded. Valid JSON of another shape is a gap too, and so is
 * a link out of the repository.
 */
function readJson(path, label) {
  if (!resolvesInside(path, label)) return null;
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    gaps.push(`${label}: cannot read — ${error.message}`);
    return null;
  }
  if (!isObject(value)) {
    gaps.push(`${label}: is ${describe(value)}, not a JSON object`);
    return null;
  }
  return value;
}

/**
 * False, with a gap recorded, when `path` resolves outside the repository. The root-level inputs
 * are read by path rather than walked, so they need the walk's containment check of their own. A
 * path that does not resolve is left to the reader, whose failure is the gap.
 */
function resolvesInside(path, label) {
  let real;
  try {
    real = realpathSync(path);
  } catch {
    return true;
  }
  if (real === root || real.startsWith(`${root}${sep}`)) return true;
  gaps.push(`${label}: links outside the repository, to ${real} — not read`);
  return false;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** What a non-object JSON value is, for a gap message. */
function describe(value) {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'an array' : `a ${typeof value}`;
}

function toRepoPath(path) {
  const rel = relative(root, path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : path;
}

function abbreviate(list, max = 4) {
  return list.length <= max
    ? list.join(', ')
    : `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
}

function lastLines(text, n) {
  return (text ?? '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(-n)
    .join('\n');
}
