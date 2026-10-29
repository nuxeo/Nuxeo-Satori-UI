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
 * Storybook build with it. That is NXSAT-649: the public Storybook stopped publishing, and
 * nothing caught it, because ci.yml runs that build only when `satori-components` is affected
 * and a change to the root ESLint config does not affect it.
 *
 * What is load-bearing here. Two claims in opposite directions, and the second is the one that
 * is easy to lose: the config must load with the package ABSENT, and it must still carry the
 * Satori rules when the package is PRESENT. A fix that satisfies only the first silently widens
 * what lint accepts in every normal run. The remaining controls are negative: a package that
 * resolves and then fails is a real error and must NOT be swallowed by the absent-package path.
 *
 * Each case runs in its own child process, because module resolution is patched before
 * `eslint.config.mjs` is imported and that cannot be undone within one process. Nothing here
 * writes to `node_modules` — the installed tree is never touched. Note that moving the scope
 * aside by hand does NOT reproduce the failure in a worktree nested inside another checkout:
 * Node walks up and resolves the parent's copy instead. That is why this patches resolution.
 *
 * Usage: node scripts/eslint-config-satori-lint.selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const CONFIG = resolve(import.meta.dirname, '..', 'eslint.config.mjs');
const ENTRY = '@hylandsoftware/satori-lint/eslint';

const failures = [];
let controls = 0;

/**
 * Imports `eslint.config.mjs` in a child process, with `require` of ENTRY optionally replaced by
 * a thrown error, and reports what the exported flat config contains.
 *
 * `throws` is the error to raise instead of resolving ENTRY: `{ message, code }`, or null to
 * leave resolution alone and use the really installed package.
 */
function loadConfig(throws) {
  const child = `
    import Module from 'node:module';
    const thrown = ${JSON.stringify(throws)};
    if (thrown) {
      const original = Module._resolveFilename;
      Module._resolveFilename = function (request, ...rest) {
        if (request === ${JSON.stringify(ENTRY)}) {
          const error = new Error(thrown.message);
          if (thrown.code) error.code = thrown.code;
          throw error;
        }
        return original.call(this, request, ...rest);
      };
    }
    const config = (await import(${JSON.stringify(CONFIG)})).default;
    const ruleKeys = config
      .flatMap((layer) => Object.keys(layer?.rules ?? {}))
      .filter((rule) => rule.startsWith('@hylandsoftware/satori-lint'));
    const plugins = config
      .flatMap((layer) => Object.keys(layer?.plugins ?? {}))
      .filter((name) => name.includes('satori-lint'));
    console.log(
      'RESULT ' +
        JSON.stringify({ layers: config.length, satoriRules: ruleKeys, satoriPlugins: plugins }),
    );
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
    encoding: 'utf8',
    cwd: resolve(import.meta.dirname, '..'),
  });
  const line = (run.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  return {
    code: run.status,
    stderr: run.stderr || '',
    result: line ? JSON.parse(line.slice('RESULT '.length)) : null,
  };
}

function check(label, condition, detail) {
  controls += 1;
  if (!condition) failures.push(`${label}${detail ? `: ${detail}` : ''}`);
}

// --------------------------------------------- the package is absent: the config must load ----

const absent = loadConfig({ message: `Cannot find module '${ENTRY}'`, code: 'MODULE_NOT_FOUND' });

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

// ------------- the package is installed: the rules must still be there (the easy one to lose) --

const present = loadConfig(null);

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

// ------------------------------- negative controls: a broken package must NOT be swallowed ----

// MODULE_NOT_FOUND, but for something the package itself requires. Tolerating this would hide a
// half-installed dependency behind "Satori lint rules are OFF" and lint would pass wider.
const innerMissing = loadConfig({
  message: "Cannot find module 'some-inner-dependency'",
  code: 'MODULE_NOT_FOUND',
});
check(
  'a missing inner dependency is re-thrown, not treated as an absent package',
  innerMissing.code !== 0,
  `exit ${innerMissing.code}, result ${JSON.stringify(innerMissing.result)}`,
);
check(
  'a missing inner dependency keeps its own message',
  innerMissing.stderr.includes('some-inner-dependency'),
  `stderr was ${JSON.stringify(innerMissing.stderr.trim().slice(0, 200))}`,
);

// A package that resolves and then throws for any other reason: also a real failure.
const brokenEntry = loadConfig({ message: 'Unexpected token in satori-lint entry' });
check(
  'a package that fails for another reason is re-thrown',
  brokenEntry.code !== 0,
  `exit ${brokenEntry.code}, result ${JSON.stringify(brokenEntry.result)}`,
);
check(
  'a package that fails for another reason keeps its own message',
  brokenEntry.stderr.includes('Unexpected token in satori-lint entry'),
  `stderr was ${JSON.stringify(brokenEntry.stderr.trim().slice(0, 200))}`,
);

console.log(`eslint.config satori-lint selftest: ${controls} controls.`);
if (failures.length) {
  console.error(`\n${failures.length} control(s) did not behave as required:`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log('All controls behaved as required.');
