#!/usr/bin/env node
/**
 * Controls for how `eslint.config.mjs` treats `@hylandsoftware/satori-lint`.
 *
 * Why this exists. Two builds delete the whole `@hylandsoftware` scope from `node_modules` on
 * purpose before building the Material Storybook — `storybook-pages.yml` and ci.yml's
 * `storybook` job — so a Satori import fails the build instead of compiling into a site this
 * public repository publishes. Nx loads `eslint.config.mjs` to infer lint targets while it
 * computes the project graph, which happens for *every* `nx run`, so a hard `require` of that
 * package turns the deliberate deletion into `Failed to process project graph` and takes the
 * Storybook build with it. It did: the public Storybook stopped publishing on 2026-10-28.
 *
 * What is load-bearing. Exactly one absence is legitimate — the whole scope removed — and every
 * other way the package can fail to load must be fatal. Tolerating one of those would silently
 * drop all of satori-lint's rules and leave lint green while it checked less, which is worse than
 * the build failing. And the last row matters as much as the rest: a guard that dropped the rules
 * whenever the package WAS installed would be worse than the original bug.
 *
 * Why real fixtures and not mocked errors. The question "is this absent or broken?" cannot be
 * answered from the error: Node reports `MODULE_NOT_FOUND`, with this specifier in the message,
 * for an uninstalled scope, for a package whose `./eslint` export points at a missing file, and
 * for a package directory that has lost both its manifest and its entry point. Two guards here
 * were written against mocked error shapes and both passed their own tests while failing a real
 * half-installed tree. So every control below builds an actual `node_modules` on disk and imports
 * the real config file in a child process. Nothing is simulated, and nothing can agree with a
 * mock while disagreeing with Node.
 *
 * The installed `node_modules` is never touched; `@nx` and, for the working case, the real scope
 * are symlinked into each fixture. Note also that moving `node_modules/@hylandsoftware` aside by
 * hand does NOT reproduce absence in a worktree nested inside another checkout: Node walks up and
 * resolves the parent's copy. The fixtures avoid that by living in their own tree.
 *
 * Usage: node scripts/eslint-config-satori-lint.selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CONFIG = join(ROOT, 'eslint.config.mjs');
const SCOPE = '@hylandsoftware';
const OUR_OVERRIDE = `${SCOPE}/satori-lint/eslint/no-material-font-icons`;
const LOAD_THROW_MESSAGE = 'satori-lint blew up on load';

const failures = [];
const builtFixtures = [];
let controls = 0;

function check(label, condition, detail) {
  controls += 1;
  if (!condition) failures.push(`${label}${detail ? `: ${detail}` : ''}`);
}

function manifest(extra) {
  return JSON.stringify({ name: `${SCOPE}/satori-lint`, version: '0.0.0-fixture', ...extra });
}

/** Builds a throwaway tree whose `node_modules` is in the named state. */
function buildFixture(state) {
  const dir = mkdtempSync(join(tmpdir(), `satori-lint-${state}-`));
  builtFixtures.push(dir);
  const nodeModules = join(dir, 'node_modules');
  mkdirSync(nodeModules, { recursive: true });
  // Everything the config needs apart from satori-lint, from the real install.
  symlinkSync(join(ROOT, 'node_modules', '@nx'), join(nodeModules, '@nx'), 'dir');

  const scopeDir = join(nodeModules, SCOPE);
  const packageDir = join(scopeDir, 'satori-lint');

  switch (state) {
    case 'scope-absent':
      break; // no scope directory at all: the one legitimate absence
    case 'scope-present-package-absent':
      mkdirSync(join(scopeDir, 'satori-tokens'), { recursive: true });
      break;
    case 'entry-file-missing':
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        join(packageDir, 'package.json'),
        manifest({ exports: { './eslint': './eslint/index.cjs' } }),
      );
      break;
    case 'package-gutted': // directory there, no manifest and no entry point
      mkdirSync(packageDir, { recursive: true });
      break;
    case 'entry-throws-on-load':
      mkdirSync(join(packageDir, 'eslint'), { recursive: true });
      writeFileSync(
        join(packageDir, 'package.json'),
        manifest({ exports: { './eslint': './eslint/index.cjs' } }),
      );
      writeFileSync(
        join(packageDir, 'eslint', 'index.cjs'),
        `throw new Error(${JSON.stringify(LOAD_THROW_MESSAGE)});\n`,
      );
      break;
    case 'invalid-exports-target': // a resolution failure that is not MODULE_NOT_FOUND
      mkdirSync(join(packageDir, 'eslint'), { recursive: true });
      writeFileSync(
        join(packageDir, 'package.json'),
        manifest({ exports: { './eslint': 'eslint/index.cjs' } }),
      );
      writeFileSync(join(packageDir, 'eslint', 'index.cjs'), 'module.exports = { configs: {} };\n');
      break;
    case 'installed':
      symlinkSync(join(ROOT, 'node_modules', SCOPE), scopeDir, 'dir');
      break;
    default:
      throw new Error(`unknown fixture state: ${state}`);
  }

  copyFileSync(CONFIG, join(dir, 'eslint.config.mjs'));
  return dir;
}

/** Imports the fixture's copy of the config in a child process and reports what came out. */
function loadIn(dir) {
  const child = `
    const config = (await import('file://' + ${JSON.stringify(join(dir, 'eslint.config.mjs'))})).default;
    const rules = config
      .flatMap((layer) => Object.keys(layer?.rules ?? {}))
      .filter((rule) => rule.includes('satori-lint'));
    const plugins = config
      .flatMap((layer) => Object.keys(layer?.plugins ?? {}))
      .filter((name) => name.includes('satori-lint'));
    console.log('RESULT ' + JSON.stringify({ blocks: config.length, rules, plugins }));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
    encoding: 'utf8',
    cwd: dir,
  });
  const line = (run.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  const result = line ? JSON.parse(line.slice('RESULT '.length)) : null;
  return {
    loaded: run.status === 0,
    stderr: run.stderr || '',
    warnedAbsent: /Satori lint rules are OFF/i.test(run.stderr || ''),
    blocks: result?.blocks ?? null,
    rules: result?.rules ?? null,
    plugins: result?.plugins ?? null,
  };
}

const state = (name) => loadIn(buildFixture(name));

try {
  // ----------------------------------------- the one legitimate absence: must load, rules off ----

  const absent = state('scope-absent');
  check('scope absent: the config loads', absent.loaded, lastLines(absent.stderr));
  check(
    'scope absent: no Satori rule is named, which would make ESLint throw on an unknown plugin',
    absent.rules?.length === 0,
    `named ${JSON.stringify(absent.rules)}`,
  );
  check(
    'scope absent: a flat config is still exported',
    (absent.blocks ?? 0) > 0,
    `blocks ${absent.blocks}`,
  );
  check(
    'scope absent: the run says on stderr that the rules are off',
    absent.warnedAbsent && absent.stderr.includes(SCOPE),
    `stderr ${JSON.stringify(absent.stderr.trim().slice(0, 160))}`,
  );

  // ------------------------------------------------ installed: the rules must all still be on ----

  const installed = state('installed');
  check('installed: the config loads', installed.loaded, lastLines(installed.stderr));
  check(
    'installed: the recommended layer brings real rules in',
    (installed.rules?.length ?? 0) > 0,
    `rules ${JSON.stringify(installed.rules)}`,
  );
  check(
    'installed: our own no-material-font-icons override is applied',
    installed.rules?.includes(OUR_OVERRIDE),
    `rules ${JSON.stringify(installed.rules)}`,
  );
  check(
    'installed: the plugin is registered, so naming its rules is legal',
    (installed.plugins?.length ?? 0) > 0,
    `plugins ${JSON.stringify(installed.plugins)}`,
  );
  check(
    'installed: strictly more blocks and rules than with the scope absent',
    (installed.blocks ?? 0) > (absent.blocks ?? 0) &&
      (installed.rules?.length ?? 0) > (absent.rules?.length ?? 0),
    `installed ${installed.blocks}/${installed.rules?.length} vs absent ${absent.blocks}/${absent.rules?.length}`,
  );
  check(
    'installed: nothing claims the rules are off',
    !installed.warnedAbsent,
    `stderr ${JSON.stringify(installed.stderr.trim().slice(0, 160))}`,
  );

  // ------------------- every other failure is a broken install and must be fatal, not tolerated --

  // Each of these fails resolution the same way an absent scope does, or close enough that a guard
  // reading the error rather than the filesystem gets them wrong. Two guards here did.
  for (const [name, why] of [
    ['scope-present-package-absent', 'the scope is installed but satori-lint is not'],
    ['entry-file-missing', 'its ./eslint export points at a file that is not there'],
    ['package-gutted', 'the package directory has no manifest and no entry point'],
    ['invalid-exports-target', 'resolution fails for a reason that is not MODULE_NOT_FOUND'],
  ]) {
    const broken = state(name);
    check(
      `${name}: THROWS rather than dropping the rules, because ${why}`,
      !broken.loaded,
      `loaded with rules ${JSON.stringify(broken.rules)}`,
    );
    check(
      `${name}: does not claim the package is merely absent`,
      !broken.warnedAbsent,
      `stderr ${JSON.stringify(broken.stderr.trim().slice(0, 160))}`,
    );
  }

  // A package that resolves and then throws while loading. Loading happens outside the guard, so
  // this must propagate untouched rather than being read as absence.
  const loadThrows = state('entry-throws-on-load');
  check(
    'entry-throws-on-load: a throw from inside satori-lint is fatal',
    !loadThrows.loaded,
    `loaded with rules ${JSON.stringify(loadThrows.rules)}`,
  );
  check(
    'entry-throws-on-load: the original error survives',
    loadThrows.stderr.includes(LOAD_THROW_MESSAGE),
    `stderr ${JSON.stringify(loadThrows.stderr.trim().slice(0, 160))}`,
  );
  check(
    'entry-throws-on-load: does not claim the package is merely absent',
    !loadThrows.warnedAbsent,
    `stderr ${JSON.stringify(loadThrows.stderr.trim().slice(0, 160))}`,
  );
} finally {
  for (const dir of builtFixtures) rmSync(dir, { recursive: true, force: true });
}

function lastLines(stderr) {
  return `stderr: ${stderr.trim().split('\n').slice(-3).join(' | ')}`;
}

console.log(`eslint.config satori-lint selftest: ${controls} controls.`);
if (failures.length) {
  console.error(`\n${failures.length} control(s) did not behave as required:`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log('All controls behaved as required.');
