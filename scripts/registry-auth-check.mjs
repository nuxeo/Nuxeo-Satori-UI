#!/usr/bin/env node
/**
 * Does `SATORI_GH_READONLY_TOKEN` still install every GitHub Packages dependency — today, from the
 * registry, with nothing cached?
 *
 * ## Why CI's own install cannot answer that
 *
 * `ci.yml` restores an npm cache (`actions/setup-node` with `cache: npm`). `npm ci` takes each
 * tarball from that cache by its integrity hash and never asks the registry, so a revoked or
 * expired token installs cleanly for as long as the cache lives. PR #335 found exactly that: a
 * warm cache let `npm ci` succeed with an invalid token. The first sign of a dead token would then
 * be the first cache miss — a lockfile change, an evicted cache — on whichever PR happened to
 * cause it, with nothing in that PR to do with the token.
 *
 * ## What this does
 *
 * 1. A negative control: one GitHub Packages dependency, installed with a token that is not a
 *    token, must be refused with an auth error and be classified as one. Run before the cold
 *    install on every run that gets that far — a missing token or a lock with no GitHub Packages
 *    entries fails before either — so the classifier is seen failing against the real registry
 *    rather than trusted.
 * 2. `npm ci` of the real lock in a scratch directory, with an empty cache, `--prefer-online`, and
 *    the user and global npm config replaced by empty files — a developer's `~/.npmrc` commonly
 *    carries a GitHub Packages token of its own, and would otherwise make a local run green on
 *    the wrong credential.
 * 3. On success, every lock entry resolved from `npm.pkg.github.com` must be installed at its
 *    locked version **and** have been fetched over the network (`(cache miss)`). An install that
 *    observed none of them proves nothing, and fails.
 *
 * npm's HTTP log names the redirected tarball by a signed blob URL. Raw npm output is therefore
 * never printed; only summarised lines with query strings removed.
 *
 * Exit 0 pass, 1 fail. Usage:
 *
 *   SATORI_GH_READONLY_TOKEN=… node scripts/registry-auth-check.mjs
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const GITHUB_PACKAGES = 'https://npm.pkg.github.com/';
const NOT_A_TOKEN = 'registry-auth-negative-control-not-a-token';

/**
 * Classify an npm run from its exit status and combined output.
 *
 * `auth` means GitHub Packages refused the request: E401 (no or bad token), E403 (token lacks
 * `read:packages`, or SSO not authorised for the org), or E404 (GitHub Packages answers 404 for a
 * package the token cannot see). A 404 from any other registry is a missing package, not auth.
 * @param {number | null} status
 * @param {string} output
 * @returns {{ kind: 'ok' | 'auth' | 'other', code: string | null, detail: string }}
 */
export function classify(status, output) {
  if (status === 0) return { kind: 'ok', code: null, detail: '' };
  const code = /^npm error code (\S+)/m.exec(output)?.[1] ?? null;
  const request = /^npm error (\d{3}) [^\n]*? - (?:GET|PUT|POST) (\S+)(?: - ([^\n]*))?/m.exec(
    output,
  );
  const url = request?.[2] ?? '';
  const fromGitHub = /^https:\/\/(npm\.pkg\.github\.com|[^/]*\.githubusercontent\.com)\//.test(url);
  const detail = request
    ? `${request[1]} ${redact(url)}${request[3] ? ` — ${request[3]}` : ''}`
    : redact(/^npm error (?!code )(.*)$/m.exec(output)?.[1] ?? `exit ${status}`);
  if (fromGitHub && ['E401', 'E403', 'E404'].includes(code ?? '')) {
    return { kind: 'auth', code, detail };
  }
  return { kind: 'other', code, detail };
}

/** A URL or line with every query string removed — signed blob URLs carry their signature there. */
export function redact(text) {
  return String(text).replace(/\?[^\s]*/g, '?…');
}

/**
 * The lock entries resolved from GitHub Packages, as `{ path, name, version }`.
 * @param {Record<string, any>} lock
 */
export function githubPackagesEntries(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([, v]) => String(v.resolved ?? '').startsWith(GITHUB_PACKAGES))
    .map(([path, v]) => ({ path, name: path.replace(/^.*node_modules\//, ''), version: v.version }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The private tarballs a successful install did NOT demonstrably fetch from the network.
 *
 * Host-agnostic on purpose: GitHub Packages redirects a download to a blob host, and that host is
 * an implementation detail. The `/<name>/<version>/` path segment and `(cache miss)` are what
 * identify a network fetch of that package.
 * @param {{ name: string, version: string }[]} entries
 * @param {string} output
 */
export function unfetched(entries, output) {
  const fetched = output
    .split('\n')
    .filter((l) => /^npm http fetch GET 200 \S+ .*\(cache miss\)/.test(l));
  return entries.filter(({ name, version }) => {
    const segment = `/${name.split('/').pop()}/${version}/`;
    return !fetched.some((l) => l.includes(segment));
  });
}

function npm(args, cwd, token, scratch) {
  const userconfig = join(scratch, 'empty-userconfig');
  const globalconfig = join(scratch, 'empty-globalconfig');
  writeFileSync(userconfig, '');
  writeFileSync(globalconfig, '');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^npm_config_/i.test(k) && k !== 'NODE_AUTH_TOKEN',
    ),
  );
  Object.assign(env, {
    SATORI_GH_READONLY_TOKEN: token,
    npm_config_userconfig: userconfig,
    npm_config_globalconfig: globalconfig,
    npm_config_update_notifier: 'false',
  });
  const run = spawnSync('npm', args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  return {
    status: run.status,
    output: `${run.stdout ?? ''}\n${run.stderr ?? ''}`,
    error: run.error,
  };
}

const INSTALL_FLAGS = [
  '--prefer-online',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--loglevel',
  'http',
];

function main() {
  const lines = [];
  const say = (line) => {
    lines.push(line);
    console.log(line);
  };
  const fail = (line) => {
    console.log(`::error title=Registry auth::${line}`);
    lines.push(`**FAIL** — ${line}`);
  };
  let failed = false;

  const token = process.env['SATORI_GH_READONLY_TOKEN'] ?? '';
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const entries = githubPackagesEntries(lock);

  if (!token) {
    fail(
      'SATORI_GH_READONLY_TOKEN is empty. In CI the secret is missing, or not exposed to this ' +
        'event (pull requests from forks receive no secrets). Nothing was installed.',
    );
    failed = true;
  }
  if (entries.length === 0) {
    fail(
      'No lock entry resolves from npm.pkg.github.com, so this check asserts nothing. Remove it ' +
        'together with the last GitHub Packages dependency.',
    );
    failed = true;
  }

  const work = mkdtempSync(join(tmpdir(), 'registry-auth-'));
  try {
    if (!failed) {
      // 1. Negative control.
      const probe = entries[0];
      const neg = join(work, 'negative-control');
      mkdirSync(neg);
      cpSync(join(ROOT, '.npmrc'), join(neg, '.npmrc'));
      writeFileSync(
        join(neg, 'package.json'),
        JSON.stringify({
          name: 'registry-auth-probe',
          private: true,
          dependencies: { [probe.name]: probe.version },
        }),
      );
      const negRun = npm(
        [
          'install',
          '--cache',
          mkdtempSync(join(work, 'cache-')),
          '--package-lock=false',
          ...INSTALL_FLAGS,
        ],
        neg,
        NOT_A_TOKEN,
        work,
      );
      const negClass = classify(negRun.status, negRun.output);
      if (negClass.kind === 'auth') {
        say(
          `ok   negative control: ${probe.name}@${probe.version} with a non-token → ${negClass.code} (${negClass.detail})`,
        );
      } else {
        fail(
          negClass.kind === 'ok'
            ? `negative control: ${probe.name} installed with a token that is not a token. The registry ` +
                'is not enforcing auth here, or a cache or config this script did not isolate supplied it.'
            : `negative control: ${probe.name} failed for a reason other than auth — ${negClass.code ?? ''} ` +
                `${negClass.detail}. The classifier cannot be trusted to recognise a refused token.`,
        );
        failed = true;
      }
    }

    if (!failed) {
      // 2. Cold install of the real lock.
      const app = join(work, 'install');
      mkdirSync(app);
      for (const f of ['package.json', 'package-lock.json', '.npmrc'])
        cpSync(join(ROOT, f), join(app, f));
      for (const [, v] of Object.entries(lock.packages ?? {})) {
        if (v.link && v.resolved && existsSync(join(ROOT, v.resolved))) {
          cpSync(join(ROOT, v.resolved), join(app, v.resolved), { recursive: true });
        }
      }
      const cache = mkdtempSync(join(work, 'cache-'));
      const started = Date.now();
      const run = npm(['ci', '--cache', cache, ...INSTALL_FLAGS], app, token, work);
      const seconds = Math.round((Date.now() - started) / 1000);
      const result = classify(run.status, run.output);
      if (run.error) {
        fail(`npm ci did not complete: ${run.error.message}`);
        failed = true;
      } else if (result.kind === 'auth') {
        fail(
          `GitHub Packages refused SATORI_GH_READONLY_TOKEN with ${result.code}: ${result.detail.replace(/\.$/, '')}. The ` +
            'token is revoked, expired, lacks read:packages, or is not SSO-authorised for that org. CI ' +
            'installs keep passing from the npm cache until it misses; rotate the secret now.',
        );
        failed = true;
      } else if (result.kind === 'other') {
        fail(
          `cold npm ci failed after ${seconds}s, not on auth: ${result.code ?? ''} ${result.detail}`,
        );
        failed = true;
      } else {
        const missing = unfetched(entries, run.output);
        const wrong = entries.filter(({ path, version }) => {
          const manifest = join(app, path, 'package.json');
          return (
            !existsSync(manifest) || JSON.parse(readFileSync(manifest, 'utf8')).version !== version
          );
        });
        if (missing.length || wrong.length) {
          fail(
            'npm ci exited 0 but did not demonstrably install every GitHub Packages tarball from the ' +
              `network. Not fetched: ${missing.map((e) => e.name).join(', ') || 'none'}. Not installed ` +
              `at the locked version: ${wrong.map((e) => e.name).join(', ') || 'none'}.`,
          );
          failed = true;
        } else {
          say(
            `ok   cold npm ci in ${seconds}s: all ${entries.length} GitHub Packages tarballs fetched ` +
              `(cache miss) and installed at their locked versions — ${entries.map((e) => e.name).join(', ')}`,
          );
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const verdict = failed
    ? 'registry-auth: FAIL'
    : 'registry-auth: pass — the token installs every GitHub Packages dependency from an empty cache.';
  console.log(`\n${verdict}`);
  if (process.env['GITHUB_STEP_SUMMARY']) {
    appendFileSync(
      process.env['GITHUB_STEP_SUMMARY'],
      `### Registry auth (cold cache)\n\n${lines.join('\n\n')}\n\n${verdict}\n`,
    );
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
