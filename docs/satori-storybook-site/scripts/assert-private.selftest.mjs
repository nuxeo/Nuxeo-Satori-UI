#!/usr/bin/env node
/**
 * Controls for `assert-private.mjs`. A gate is not evidence until it has been seen to fail on
 * purpose, so this drives the guard through fabricated API responses and asserts that the one
 * safe combination passes and every other one fails.
 *
 * The pass case is deliberately last, and is asserted to be the ONLY pass: each field is flipped
 * independently from it. A guard that returned "no problems" unconditionally would satisfy the
 * pass case alone, so the pass case on its own proves nothing.
 *
 * Usage:  node scripts/assert-private.selftest.mjs
 * Exit 0 all controls behaved, 1 one did not.
 */

import { checkPrivacy } from './assert-private.mjs';

const REPO = 'nuxeo/agentic-ui-satori-storybook';

/** A fetcher over a fixed table of responses. Never touches the network. */
const responder = (table) => async (path) =>
  table[path] ?? { ok: false, status: 599, body: undefined };

const ok = (body) => ({ ok: true, status: 200, body });

const PRIVATE_REPO = ok({ private: true });
const CLOSED_PAGES = ok({ public: false });

const CASES = [
  {
    name: 'repository public',
    table: { [`/repos/${REPO}`]: ok({ private: false }), [`/repos/${REPO}/pages`]: CLOSED_PAGES },
    expect: /is PUBLIC/,
  },
  {
    name: 'Pages site public',
    table: { [`/repos/${REPO}`]: PRIVATE_REPO, [`/repos/${REPO}/pages`]: ok({ public: true }) },
    expect: /Pages site of .* is PUBLIC/,
  },
  {
    name: 'both public',
    table: {
      [`/repos/${REPO}`]: ok({ private: false }),
      [`/repos/${REPO}/pages`]: ok({ public: true }),
    },
    expect: /is PUBLIC/,
    problems: 2,
  },
  {
    name: 'Pages not configured (404)',
    table: {
      [`/repos/${REPO}`]: PRIVATE_REPO,
      [`/repos/${REPO}/pages`]: { ok: false, status: 404, body: { message: 'Not Found' } },
    },
    expect: /no Pages site is configured/,
  },
  {
    name: 'Pages unreadable (403 — token lacks pages: read)',
    table: {
      [`/repos/${REPO}`]: PRIVATE_REPO,
      [`/repos/${REPO}/pages`]: { ok: false, status: 403, body: undefined },
    },
    expect: /visibility is unknown/,
  },
  {
    name: 'repository unreadable (401)',
    table: {
      [`/repos/${REPO}`]: { ok: false, status: 401, body: undefined },
      [`/repos/${REPO}/pages`]: CLOSED_PAGES,
    },
    expect: /visibility is unknown/,
  },
  {
    name: 'network failure, as githubFetch reports it',
    table: {
      [`/repos/${REPO}`]: { ok: false, status: 0, body: undefined },
      [`/repos/${REPO}/pages`]: { ok: false, status: 0, body: undefined },
    },
    expect: /unknown/,
    problems: 2,
  },
  {
    name: 'repository "private" field absent',
    table: { [`/repos/${REPO}`]: ok({}), [`/repos/${REPO}/pages`]: CLOSED_PAGES },
    expect: /without a boolean "private" field/,
  },
  {
    name: 'Pages "public" field absent',
    table: { [`/repos/${REPO}`]: PRIVATE_REPO, [`/repos/${REPO}/pages`]: ok({ status: 'built' }) },
    expect: /without a boolean "public" field/,
  },
  {
    name: '"private" is the string "true", not a boolean',
    table: { [`/repos/${REPO}`]: ok({ private: 'true' }), [`/repos/${REPO}/pages`]: CLOSED_PAGES },
    expect: /without a boolean "private" field/,
  },
  {
    name: 'body is null',
    table: {
      [`/repos/${REPO}`]: ok(null),
      [`/repos/${REPO}/pages`]: ok(null),
    },
    expect: /without a boolean/,
    problems: 2,
  },
  {
    name: 'an endpoint the guard does not expect to be missing',
    table: {},
    expect: /unknown/,
    problems: 2,
  },
];

let failures = 0;
const report = (name, message) => {
  failures += 1;
  console.error(`  [FAIL] ${name}: ${message}`);
};

for (const testCase of CASES) {
  const { problems } = await checkPrivacy(REPO, responder(testCase.table));
  const joined = problems.join('\n');
  if (problems.length === 0) {
    report(testCase.name, 'the guard found no problem, so this build would have been published');
    continue;
  }
  if (!testCase.expect.test(joined)) {
    report(testCase.name, `no problem matched ${testCase.expect} — got:\n${joined}`);
    continue;
  }
  const expected = testCase.problems ?? 1;
  if (problems.length !== expected) {
    report(testCase.name, `expected ${expected} problem(s), got ${problems.length}:\n${joined}`);
    continue;
  }
  console.log(`  ok: refused — ${testCase.name}`);
}

// Last, and the only combination that may pass.
const safe = await checkPrivacy(
  REPO,
  responder({ [`/repos/${REPO}`]: PRIVATE_REPO, [`/repos/${REPO}/pages`]: CLOSED_PAGES }),
);
if (safe.problems.length > 0) {
  report(
    'private repository, non-public Pages',
    `refused a safe destination:\n${safe.problems.join('\n')}`,
  );
} else if (safe.checked.length !== 2) {
  report(
    'private repository, non-public Pages',
    `passed having checked ${safe.checked.length} thing(s), not 2. A pass must state both.`,
  );
} else {
  console.log('  ok: passed — private repository, non-public Pages');
}

if (failures > 0) {
  console.error(`\nassert-private.selftest: FAIL — ${failures} control(s) did not behave.`);
  process.exit(1);
}
console.log(
  `\nassert-private.selftest: PASS — ${CASES.length} refusals and 1 pass, all as intended.`,
);
