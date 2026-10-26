#!/usr/bin/env node
/**
 * Offline controls for `registry-auth-check.mjs` — the classifier and the fetched-from-network
 * test, on npm output rather than a live registry.
 *
 * The E401 lines are npm 10.8.2's own, recorded against npm.pkg.github.com with a non-token and
 * with no token. The script's built-in negative control re-asserts the E401 case against the live
 * registry on every run; these cover the codes and shapes a live run cannot produce on demand.
 *
 * Usage:  node scripts/registry-auth-check.selftest.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, githubPackagesEntries, redact, unfetched } from './registry-auth-check.mjs';

const GH = 'https://npm.pkg.github.com';
const err = (code, status, url, why) =>
  `npm error code ${code}\nnpm error ${status} ${why.split(' - ')[0]} - GET ${url} - ${why.split(' - ')[1] ?? ''}\n`;

const CLASSIFY = [
  [
    'E401, bad token (recorded)',
    1,
    `npm http fetch GET 401 ${GH}/@hylandsoftware%2fsatori-tokens 508ms (cache skip)\n` +
      'npm error code E401\n' +
      `npm error 401 Unauthorized - GET ${GH}/@hylandsoftware%2fsatori-tokens - unauthenticated: User cannot be authenticated with the token provided.\n`,
    'auth',
  ],
  [
    'E401, no token (recorded)',
    1,
    'npm error code E401\n' +
      `npm error 401 Unauthorized - GET ${GH}/@hylandsoftware%2fsatori-tokens - authentication token not provided\n`,
    'auth',
  ],
  [
    'E403 on a tarball download',
    1,
    err(
      'E403',
      403,
      `${GH}/download/@alfresco/adf-core/9.0.0/abc`,
      'Forbidden - permission_denied: read_package',
    ),
    'auth',
  ],
  [
    'E404 from GitHub Packages (no access)',
    1,
    err(
      'E404',
      404,
      `${GH}/@alfresco%2fadf-core`,
      'Not Found - npm package "adf-core" does not exist under owner "alfresco"',
    ),
    'auth',
  ],
  [
    'E404 from public npm is a missing package, not auth',
    1,
    err(
      'E404',
      404,
      'https://registry.npmjs.org/no-such-pkg',
      'Not Found - no-such-pkg@1.0.0 is not in this registry.',
    ),
    'other',
  ],
  [
    'network timeout is not auth',
    1,
    'npm error code ETIMEDOUT\nnpm error network request to https://npm.pkg.github.com/x failed, reason: timeout\n',
    'other',
  ],
  ['exit 0 is ok', 0, 'added 1 package in 3s\n', 'ok'],
];

let failed = 0;
const report = (ok, name, why = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${why}`}`);
};

for (const [name, status, output, want] of CLASSIFY) {
  const got = classify(status, output);
  report(got.kind === want, `classify: ${name}`, `got ${JSON.stringify(got)}, want ${want}`);
}

const entries = [
  { name: '@hylandsoftware/satori-tokens', version: '0.6.0' },
  { name: '@alfresco/adf-core', version: '9.0.0' },
];
const blob = (pkg, v, tail) =>
  `npm http fetch GET 200 https://pkg-npm.githubusercontent.com/npmregistryv2prod/blobs/1/${pkg}/${v}/x?sig=s 900ms ${tail}`;

report(
  unfetched(
    entries,
    [
      blob('satori-tokens', '0.6.0', '(cache miss)'),
      blob('adf-core', '9.0.0', '(cache miss)'),
    ].join('\n'),
  ).length === 0,
  'unfetched: both private tarballs fetched over the network',
);
report(
  unfetched(
    entries,
    [blob('satori-tokens', '0.6.0', '(cache miss)'), blob('adf-core', '9.0.0', '(cache hit)')].join(
      '\n',
    ),
  )
    .map((e) => e.name)
    .join() === '@alfresco/adf-core',
  'unfetched: a cache hit is not a network fetch',
);
report(
  unfetched(entries, blob('satori-tokens', '0.6.1', '(cache miss)')).length === 2,
  'unfetched: a different version does not count',
);

report(
  !redact(blob('adf-core', '9.0.0', '')).includes('sig='),
  'redact: a signed blob URL loses its signature',
);

const real = githubPackagesEntries(
  JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package-lock.json'), 'utf8')),
);
report(
  real.length > 0 && real.every((e) => e.name.startsWith('@') && e.version),
  `githubPackagesEntries: the real lock has ${real.length} GitHub Packages entries, each named and versioned`,
);

console.log();
const total = CLASSIFY.length + 5;
if (failed === 0) console.log(`registry-auth selftest: pass — ${total} control(s).`);
else {
  console.error(`registry-auth selftest: FAIL — ${failed} of ${total} control(s).`);
  process.exitCode = 1;
}
