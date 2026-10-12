#!/usr/bin/env node
/**
 * Asserts that `@nuxeo-satori/platform` installs for someone with **no GitHub Packages access**.
 *
 * ## Why this exists
 *
 * `docs/publish-readiness.md` §5 named one risk no gate covered: peer installability. Every other
 * check here runs inside this monorepo, whose `node_modules` already holds `@hylandsoftware/satori-ui`
 * from GitHub Packages. A customer installing the published package has no such tree, and npm 7+
 * installs every non-optional peer — so a required Satori peer is a `404` on public npm, or a `401`
 * behind GitHub Packages auth, on the customer's very first command. That is the failure that
 * blocked presales on `@alfresco/js-api`, one layer further in.
 *
 * `@hylandsoftware/satori-ui` is therefore an **optional** peer (`peerDependenciesMeta`), and only
 * `@nuxeo-satori/platform/components-satori` imports it (plan section 3).
 *
 * ## What it checks
 *
 * 1. **Install.** The built package is packed and installed into a scratch project whose npm
 *    configuration points at public npm only and carries no credentials: an empty user and global
 *    `.npmrc`, every token variable removed, and a cache of its own that only ever saw public npm,
 *    so a cached GitHub Packages tarball cannot satisfy anything. The install must succeed and
 *    leave no `@hylandsoftware` package behind.
 * 2. **Resolve.** Every entry point except `components-satori` resolves through the installed
 *    `exports` map.
 * 3. **The bytes agree.** No file of any other entry point — bundle or declarations — imports from
 *    `@hylandsoftware/`, so importing them can never need Satori; and the `components-satori`
 *    bundle does, so check 3 is not passing over an empty or misnamed file.
 * 4. **Negative control, every run.** The same tarball with `peerDependenciesMeta` removed must
 *    FAIL to install with `E404`, naming `@hylandsoftware/satori-ui`. If it installs, this
 *    environment cannot tell an optional peer from a required one — a registry mirror that proxies
 *    GitHub Packages, say — and check 1's pass means nothing, so the gate fails. Any other failure
 *    (`ERESOLVE`, a timeout) does not show the package is missing from public npm, and fails too.
 *
 * Load-bearing: 1 and 4 together. 2 and 3 name the cause when 1 goes red, and catch a Satori import
 * leaking into a base entry point while the install still succeeds.
 *
 * Needs network access to registry.npmjs.org. The scratch cache persists under the OS temp
 * directory, so after the first run only the platform tarball is new.
 *
 * Usage: node scripts/beta-harness/peer-installability.mjs   (after `npx nx build platform`)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DIST = resolve('dist/libs/platform');
const SATORI = '@hylandsoftware/satori-ui';
const SATORI_ENTRY = 'components-satori';
const CACHE = join(tmpdir(), 'nuxeo-satori-peer-installability-npm-cache');

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);

if (!existsSync(join(DIST, 'package.json'))) {
  console.error(
    'peer-installability: dist/libs/platform does not exist.\n' +
      '  Run `npx nx build platform` first — this gate installs the built bytes, not the source.',
  );
  process.exit(2);
}

const built = JSON.parse(readFileSync(join(DIST, 'package.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'peer-installability-'));

/** An environment with no npm credentials and no registry but public npm. */
function anonymousEnv() {
  // Two files: npm refuses to load one path as both the user and the global config.
  const user = join(work, 'empty-user.npmrc');
  const global = join(work, 'empty-global.npmrc');
  writeFileSync(user, '');
  writeFileSync(global, '');
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^npm_config_/i.test(key) || /TOKEN|_AUTH|NPM_PASS/i.test(key)) delete env[key];
  }
  return {
    ...env,
    npm_config_userconfig: user,
    npm_config_globalconfig: global,
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_cache: CACHE,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };
}

/** Pack a copy of the built package, with `mutate` applied to its manifest. */
function pack(label, mutate) {
  const copy = join(work, `${label}-package`);
  cpSync(DIST, copy, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(copy, 'package.json'), 'utf8'));
  mutate(manifest);
  writeFileSync(join(copy, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const out = join(work, `${label}-tarball`);
  mkdirSync(out);
  execFileSync('npm', ['pack', copy, '--pack-destination', out, '--ignore-scripts', '--silent'], {
    env: anonymousEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return join(
    out,
    readdirSync(out).find((f) => f.endsWith('.tgz')),
  );
}

/** Install a tarball into a fresh scratch project, as a customer with no Hyland access would. */
function install(label, tarball) {
  const project = join(work, `${label}-scratch`);
  mkdirSync(project);
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify({ name: `scratch-${label}`, private: true, version: '0.0.0' }, null, 2)}\n`,
  );
  writeFileSync(join(project, '.npmrc'), 'registry=https://registry.npmjs.org/\n');
  const result = spawnSync(
    'npm',
    ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: project,
      env: anonymousEnv(),
      encoding: 'utf8',
    },
  );
  return { project, status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

try {
  const meta = built.peerDependenciesMeta?.[SATORI];
  if (!built.peerDependencies?.[SATORI]) {
    fail(`${SATORI} is not a peer of the built package, so there is nothing optional to check.`);
  } else if (meta?.optional !== true) {
    notes.push(
      `${SATORI} is a REQUIRED peer in the built package.json — check 1 is expected to fail`,
    );
  }

  // ---------------------------------------------------------------- 1. install ----
  const tarball = pack('as-built', () => {});
  const asBuilt = install('as-built', tarball);
  if (asBuilt.status !== 0) {
    fail(
      'The built package does not install without GitHub Packages access:\n' +
        asBuilt.output
          .split('\n')
          .filter((l) => /npm (error|ERR)/.test(l))
          .slice(0, 8)
          .map((l) => `    ${l}`)
          .join('\n'),
    );
  } else {
    const installed = join(asBuilt.project, 'node_modules', ...built.name.split('/'));
    if (!existsSync(join(installed, 'package.json'))) {
      fail(`npm reported success but ${built.name} is not in the scratch node_modules.`);
    }
    if (existsSync(join(asBuilt.project, 'node_modules', '@hylandsoftware'))) {
      fail(
        'The scratch install contains @hylandsoftware packages; the optional peer was installed.',
      );
    } else {
      notes.push(
        `installed ${built.name}@${built.version} from a tarball with no credentials; no @hylandsoftware package`,
      );
    }

    // ------------------------------------------------------------- 2. resolve ----
    const entries = Object.keys(built.exports ?? {})
      .filter((key) => key === '.' || /^\.\/[a-z-]+$/.test(key))
      .map((key) => (key === '.' ? built.name : `${built.name}/${key.slice(2)}`))
      .filter((specifier) => !specifier.endsWith(`/${SATORI_ENTRY}`));
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `for (const s of ${JSON.stringify(entries)}) console.log(s, '->', import.meta.resolve(s));`,
      ],
      { cwd: asBuilt.project, encoding: 'utf8' },
    );
    if (probe.status !== 0) {
      fail(`An entry point does not resolve in the scratch project:\n    ${probe.stderr.trim()}`);
    } else if (entries.length < 2) {
      fail(`Only ${entries.length} entry point(s) were found in the exports map to resolve.`);
    } else {
      notes.push(`${entries.length} entry points resolve: ${entries.join(', ')}`);
    }
  }

  // ---------------------------------------------------------- 3. the bytes agree ----
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== 'node_modules') walk(full);
      } else if (/\.(mjs|d\.ts)$/.test(entry)) files.push(full);
    }
  };
  walk(DIST);
  // A quoted module specifier — `from '…'`, `import("…")` in a declaration, `require('…')` — not
  // prose: the shipped doc comments mention the package by name, and a mention needs nothing.
  const SPECIFIER = /(['"])@hylandsoftware\/[^'"\s]*\1/;
  const isSatoriEntry = (file) =>
    file.includes(`-${SATORI_ENTRY}.mjs`) || file.includes(`/${SATORI_ENTRY}/`);
  const leaking = files.filter(
    (file) => !isSatoriEntry(file) && SPECIFIER.test(readFileSync(file, 'utf8')),
  );
  for (const file of leaking) {
    fail(
      `${file.slice(DIST.length + 1)} imports from @hylandsoftware/, so importing that entry point ` +
        `needs Satori. Only ${SATORI_ENTRY} may.`,
    );
  }
  const satoriBundle = files.find((file) => file.endsWith(`-${SATORI_ENTRY}.mjs`));
  if (!satoriBundle) {
    fail(`No ${SATORI_ENTRY} bundle in the build, so check 3 compared nothing against it.`);
  } else if (!SPECIFIER.test(readFileSync(satoriBundle, 'utf8'))) {
    fail(
      `The ${SATORI_ENTRY} bundle imports nothing from @hylandsoftware/; check 3 is looking at the wrong file.`,
    );
  } else if (!leaking.length) {
    notes.push(
      `${files.length} built .mjs/.d.ts files; only ${SATORI_ENTRY}'s import from @hylandsoftware/`,
    );
  }

  // ------------------------------------------------------ 4. negative control ----
  const required = install(
    'required-peer',
    pack('required-peer', (manifest) => {
      delete manifest.peerDependenciesMeta?.[SATORI];
    }),
  );
  const reason = required.output.match(/npm (?:error|ERR!) (?:code )?(E\d+|[A-Z_]+)/)?.[1];
  if (required.status === 0) {
    fail(
      `With ${SATORI} a REQUIRED peer, the install still succeeded. This environment cannot tell an ` +
        'optional peer from a required one, so check 1 proves nothing here.',
    );
  } else if (!required.output.includes(SATORI)) {
    fail(
      `The required-peer control failed, but not because of ${SATORI}:\n    ${required.output.slice(0, 400)}`,
    );
  } else if (reason !== 'E404') {
    // Only E404 says public npm does not have the package. ERESOLVE, a timeout or a network error
    // can name it too, and prove nothing about what a customer without access can install.
    fail(
      `The required-peer control failed with ${reason ?? 'no npm error code'}, not E404, so it ` +
        `did not show ${SATORI} is missing from public npm:\n    ${required.output.slice(0, 400)}`,
    );
  } else {
    notes.push(`control: with the peer required, the same install fails (E404) naming ${SATORI}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

for (const n of notes) console.log(`  - ${n}`);
if (failures.length) {
  console.error(`\npeer-installability: FAIL — ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}
console.log(
  '\npeer-installability: pass — installs from public npm with no GitHub Packages access.',
);
