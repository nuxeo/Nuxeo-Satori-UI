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
 * What is load-bearing here. THREE states, not two, and the third is the one a plausible fix
 * gets wrong:
 *
 *   - absent              -> the config must load, with the Satori rules off
 *   - installed           -> the config must load, with the Satori rules ON
 *   - installed, broken   -> the config must THROW
 *
 * The third exists because Node reports `MODULE_NOT_FOUND` on the entry point for an absent
 * package AND for an installed one whose `./eslint` export points at a missing file, with the
 * same specifier in the message. A guard that reads only the entry-point error therefore treats
 * a half-installed package as absent and silently drops every Satori rule — lint passes wider
 * and says nothing. Telling them apart needs the manifest probed separately, because a package
 * that exists but does not export `./package.json` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`,
 * and that error is proof Node found it. The real satori-lint does not export `./package.json`,
 * so this is the live path, not a hypothetical one.
 *
 * The error codes above are MEASURED against real fixtures by the first group of controls below,
 * and the behavioural controls inject errors built from the same constants. So if a Node upgrade
 * changes them, the fixtures go red and say the simulation has drifted, rather than passing while
 * testing something Node no longer does.
 *
 * Each behavioural case runs in its own child process, because module resolution is patched
 * before `eslint.config.mjs` is imported and that cannot be undone within one process. Nothing
 * here writes to the installed `node_modules`. Note that moving the scope aside by hand does NOT
 * reproduce absence in a worktree nested inside another checkout: Node walks up and resolves the
 * parent's copy. That is why this patches resolution instead.
 *
 * Usage: node scripts/eslint-config-satori-lint.selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CONFIG = join(ROOT, 'eslint.config.mjs');
const ENTRY = '@hylandsoftware/satori-lint/eslint';
const MANIFEST = '@hylandsoftware/satori-lint/package.json';

// The two codes the config's branches turn on. Asserted against real fixtures below.
const ABSENT_CODE = 'MODULE_NOT_FOUND';
const INSTALLED_BUT_UNEXPORTED_CODE = 'ERR_PACKAGE_PATH_NOT_EXPORTED';

const failures = [];
let controls = 0;

function check(label, condition, detail) {
  controls += 1;
  if (!condition) failures.push(`${label}${detail ? `: ${detail}` : ''}`);
}

// ----------------------------------------------- fixture fidelity: what Node really reports ----

/** Resolves `specifier` as if from a file in `dir`, and reports the outcome. */
function resolveFrom(dir, specifier) {
  try {
    createRequire(join(dir, 'eslint.config.mjs')).resolve(specifier);
    return { resolved: true, code: null };
  } catch (error) {
    return { resolved: false, code: error?.code ?? null };
  }
}

const fixtures = mkdtempSync(join(tmpdir(), 'satori-lint-fixtures-'));
try {
  // A tree with no `@hylandsoftware` at all.
  const absentDir = join(fixtures, 'absent');
  mkdirSync(join(absentDir, 'node_modules'), { recursive: true });

  // A tree where the package IS installed but its `./eslint` export points at a missing file.
  const brokenDir = join(fixtures, 'broken');
  const brokenPkg = join(brokenDir, 'node_modules', '@hylandsoftware', 'satori-lint');
  mkdirSync(brokenPkg, { recursive: true });
  writeFileSync(
    join(brokenPkg, 'package.json'),
    JSON.stringify({
      name: '@hylandsoftware/satori-lint',
      version: '0.0.0-fixture',
      exports: { './eslint': './eslint/index.cjs' },
    }),
  );

  const absentEntry = resolveFrom(absentDir, ENTRY);
  const absentManifest = resolveFrom(absentDir, MANIFEST);
  const brokenEntry = resolveFrom(brokenDir, ENTRY);
  const brokenManifest = resolveFrom(brokenDir, MANIFEST);
  const realEntry = resolveFrom(ROOT, ENTRY);
  const realManifest = resolveFrom(ROOT, MANIFEST);

  check(
    'fixture: an absent package fails the entry point with the absent code',
    absentEntry.code === ABSENT_CODE,
    `got ${absentEntry.code}`,
  );
  check(
    'fixture: an absent package fails the manifest with the absent code too',
    absentManifest.code === ABSENT_CODE,
    `got ${absentManifest.code}`,
  );
  check(
    'fixture: a broken install fails the entry point with the SAME code as an absent one, which ' +
      'is why the entry-point error alone cannot be trusted',
    brokenEntry.code === ABSENT_CODE,
    `got ${brokenEntry.code}`,
  );
  check(
    'fixture: a broken install is distinguishable on the manifest',
    brokenManifest.code === INSTALLED_BUT_UNEXPORTED_CODE,
    `got ${brokenManifest.code}`,
  );
  check(
    'fixture: the really installed package resolves its entry point',
    realEntry.resolved,
    `got code ${realEntry.code}`,
  );
  check(
    'fixture: the really installed package does not export its manifest, so that branch is live',
    realManifest.code === INSTALLED_BUT_UNEXPORTED_CODE,
    `got ${realManifest.resolved ? 'resolved' : realManifest.code} — if this package started ` +
      'exporting ./package.json the probe still works, but this control documents which path runs',
  );
} finally {
  rmSync(fixtures, { recursive: true, force: true });
}

// ------------------------------------------------------- behaviour: the config under each state --

/**
 * Imports `eslint.config.mjs` in a child process with resolution patched per specifier, and
 * reports what the exported flat config contains.
 *
 * `plan` maps a specifier to `{ code, message }` to throw instead of resolving it. `loadThrows`
 * instead lets the entry resolve and makes *loading* it throw, which must propagate.
 */
function loadConfig({ plan = {}, loadThrows = null } = {}) {
  const child = `
    import Module from 'node:module';
    const plan = ${JSON.stringify(plan)};
    const loadThrows = ${JSON.stringify(loadThrows)};

    const resolvedEntry = loadThrows ? Module.createRequire(${JSON.stringify(CONFIG)}).resolve(${JSON.stringify(ENTRY)}) : null;

    const originalResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      const planned = plan[request];
      if (planned) {
        const error = new Error(planned.message);
        if (planned.code) error.code = planned.code;
        throw error;
      }
      return originalResolve.call(this, request, ...rest);
    };

    if (loadThrows) {
      const originalLoad = Module._load;
      // Both forms, so this control means the same thing whether the config loads the package by
      // its resolved path or by its bare specifier. Keyed on only one, it would pass or fail on
      // the shape of the implementation rather than on the behaviour being tested.
      Module._load = function (request, ...rest) {
        if (request === resolvedEntry || request === ${JSON.stringify(ENTRY)}) {
          const error = new Error(loadThrows.message);
          if (loadThrows.code) error.code = loadThrows.code;
          throw error;
        }
        return originalLoad.call(this, request, ...rest);
      };
    }

    const config = (await import(${JSON.stringify(CONFIG)})).default;
    const satoriRules = config
      .flatMap((layer) => Object.keys(layer?.rules ?? {}))
      .filter((rule) => rule.startsWith('@hylandsoftware/satori-lint'));
    const satoriPlugins = config
      .flatMap((layer) => Object.keys(layer?.plugins ?? {}))
      .filter((name) => name.includes('satori-lint'));
    console.log('RESULT ' + JSON.stringify({ layers: config.length, satoriRules, satoriPlugins }));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  const line = (run.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  return {
    code: run.status,
    stderr: run.stderr || '',
    result: line ? JSON.parse(line.slice('RESULT '.length)) : null,
  };
}

const notFound = (specifier) => ({
  code: ABSENT_CODE,
  message: `Cannot find module '${specifier}'`,
});

// ---- absent: both the entry point and the manifest are unresolvable. Must load, rules off. ----

const absent = loadConfig({ plan: { [ENTRY]: notFound(ENTRY), [MANIFEST]: notFound(MANIFEST) } });

check(
  'absent package: the config still loads',
  absent.code === 0,
  `exit ${absent.code}; stderr: ${absent.stderr.trim().split('\n').slice(-3).join(' | ')}`,
);
check(
  'absent package: a flat config is still exported',
  absent.result !== null && absent.result.layers > 0,
  `got ${JSON.stringify(absent.result)}`,
);
check(
  'absent package: no Satori rule is named, which would make ESLint throw on an unknown plugin',
  absent.result !== null && absent.result.satoriRules.length === 0,
  `named ${JSON.stringify(absent.result?.satoriRules)}`,
);
check(
  'absent package: the run says on stderr that the rules are off',
  absent.stderr.includes(ENTRY) && /Satori lint rules are OFF/i.test(absent.stderr),
  `stderr was ${JSON.stringify(absent.stderr.trim().slice(0, 200))}`,
);

// ---- installed: the rules must still be there. The direction a careless fix loses. ----

const present = loadConfig();

check(
  'installed package: the config loads',
  present.code === 0,
  `exit ${present.code}; stderr: ${present.stderr.trim().split('\n').slice(-3).join(' | ')}`,
);
check(
  'installed package: the no-material-font-icons override is still applied',
  present.result?.satoriRules.includes(`${ENTRY}/no-material-font-icons`),
  `rules were ${JSON.stringify(present.result?.satoriRules)}`,
);
check(
  'installed package: the recommended layer still registers the plugin',
  (present.result?.satoriPlugins.length ?? 0) > 0,
  `plugins were ${JSON.stringify(present.result?.satoriPlugins)}`,
);
check(
  'installed package: strictly more layers than without it, so the layer is really added',
  (present.result?.layers ?? 0) > (absent.result?.layers ?? 0),
  `present ${present.result?.layers} vs absent ${absent.result?.layers}`,
);
check(
  'installed package: nothing is warned about the rules being off',
  !/Satori lint rules are OFF/i.test(present.stderr),
  `stderr was ${JSON.stringify(present.stderr.trim().slice(0, 200))}`,
);

// ---- installed but broken: the fail-open this exists to prevent. Must throw. ----

const brokenInstall = loadConfig({
  plan: {
    [ENTRY]: notFound(ENTRY),
    [MANIFEST]: {
      code: INSTALLED_BUT_UNEXPORTED_CODE,
      message: `Package subpath './package.json' is not defined by "exports" in ${MANIFEST}`,
    },
  },
});

check(
  'installed but broken entry point: the config THROWS rather than dropping the rules',
  brokenInstall.code !== 0,
  `exit ${brokenInstall.code}, result ${JSON.stringify(brokenInstall.result)}`,
);
check(
  'installed but broken entry point: nothing claims the package is merely absent',
  !/Satori lint rules are OFF/i.test(brokenInstall.stderr),
  `stderr was ${JSON.stringify(brokenInstall.stderr.trim().slice(0, 200))}`,
);
check(
  'installed but broken entry point: the real resolution error survives',
  brokenInstall.stderr.includes(ENTRY),
  `stderr was ${JSON.stringify(brokenInstall.stderr.trim().slice(0, 200))}`,
);

// ---- other failures on the way in must not be read as absence either. ----

const otherResolveError = loadConfig({
  plan: {
    [ENTRY]: { code: 'ERR_INVALID_MODULE_SPECIFIER', message: 'Invalid module specifier' },
  },
});
check(
  'a non-MODULE_NOT_FOUND resolution error is re-thrown',
  otherResolveError.code !== 0,
  `exit ${otherResolveError.code}, result ${JSON.stringify(otherResolveError.result)}`,
);
check(
  'a non-MODULE_NOT_FOUND resolution error keeps its own message',
  otherResolveError.stderr.includes('Invalid module specifier'),
  `stderr was ${JSON.stringify(otherResolveError.stderr.trim().slice(0, 200))}`,
);

// The package resolves, then throws while loading — a missing dependency of its own, say. Loading
// happens outside the guard, so this must propagate untouched.
const loadError = loadConfig({
  loadThrows: { code: ABSENT_CODE, message: "Cannot find module 'some-inner-dependency'" },
});
check(
  'a throw from inside satori-lint propagates instead of being read as absence',
  loadError.code !== 0,
  `exit ${loadError.code}, result ${JSON.stringify(loadError.result)}`,
);
check(
  'a throw from inside satori-lint keeps its own message',
  loadError.stderr.includes('some-inner-dependency'),
  `stderr was ${JSON.stringify(loadError.stderr.trim().slice(0, 200))}`,
);

console.log(`eslint.config satori-lint selftest: ${controls} controls.`);
if (failures.length) {
  console.error(`\n${failures.length} control(s) did not behave as required:`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log('All controls behaved as required.');
