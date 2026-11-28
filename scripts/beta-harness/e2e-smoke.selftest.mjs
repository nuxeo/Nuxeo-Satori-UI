#!/usr/bin/env node
/**
 * Controls for the pull request smoke run (`.github/workflows/e2e-smoke.yml`): the parts of it that
 * decide whether a green check means the flows ran, each seen refusing what it must refuse.
 *
 * - **The run prefix** (`e2e-run-prefix.mjs`), which is all that stands between the sweep's
 *   `LIKE '<prefix>%'` and every document on the shared server: a sound one is taken; an empty one,
 *   a bare `e2e-`, a short one, one with a quote, `%`, `_`, a capital or no trailing hyphen is
 *   refused; with none set the suite runs as before; a malformed one throws before anything is
 *   written; and `uniqueTitle` puts it first.
 * - **The verdict** (`e2e-smoke-verdict.mjs`), run as the workflow runs it, on reports written here:
 *   a report of passed smoke tests passes, a flaky one passes and is named; refused are a report
 *   with no test, one that is not a report, one that is not JSON, a test not tagged `@smoke`, one
 *   on another project, a skipped one, a failed one, and a command without `--project`.
 * - **The sweep** (`e2e-sweep.mjs`), run as the workflow runs it, against a stand-in Nuxeo on a
 *   local port: it asks for exactly the prefix's live documents, trashes each and nothing else, and
 *   says so; with nothing left it says that. Refused: a trash the server refuses, exit 1, naming the
 *   document; an identity that is not `NUXEO_USER`, exit 2, before any query; a query the server
 *   refuses, exit 2; and no prefix, exit 2, before any request.
 * - **The workflow's text:** the triggers, `pull_request` into the three branch families and never
 *   `pull_request_target`; read-only permissions; `smoke` running exactly when `not-run` does not,
 *   on this repository's own non-Dependabot pull requests; one shared concurrency group that never
 *   cancels a run in progress; the run prefix; the subset selected by tag on Chromium, then held to
 *   the verdict; the sweep on every outcome; no `continue-on-error`; and no token left in
 *   `.git/config`. Each, broken in a copy of the text, is refused. And the nightly dispatches its
 *   staging branches as well as its integration branches.
 *
 * Node 24 alone, no install and no network: the stand-in listens on 127.0.0.1 for the run only.
 *
 * Usage: node scripts/beta-harness/e2e-smoke.selftest.mjs
 * Exit: 0 every control held; 1 otherwise.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftoverQuery, runPrefix, runPrefixProblem } from './e2e-run-prefix.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERDICT = join(REPO, 'scripts', 'beta-harness', 'e2e-smoke-verdict.mjs');
const SWEEP = join(REPO, 'scripts', 'beta-harness', 'e2e-sweep.mjs');
const WORKFLOW = join(REPO, '.github', 'workflows', 'e2e-smoke.yml');
const NIGHTLY = join(REPO, '.github', 'workflows', 'e2e-nightly.yml');
const E2E_DATA = join(REPO, 'apps', 'nuxeo-ui-e2e', 'src', 'e2e-data.ts');

const failures = [];
let positive = 0;
let negative = 0;
function check(name, condition, detail = '', isNegative = true) {
  if (isNegative) negative += 1;
  else positive += 1;
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── The run prefix ──────────────────────────────────────────────────────────────────────────────
function thePrefix() {
  const sound = 'e2e-pr812-45933950039-1-';
  check(
    'a run prefix as the workflow makes it is taken',
    runPrefixProblem(sound) === null,
    '',
    false,
  );
  for (const [label, value] of [
    ['an empty prefix', ''],
    ['a bare e2e-', 'e2e-'],
    ['a prefix short enough to begin a typed title', 'e2e-pr1-2-'],
    ['a prefix with a quote', "e2e-pr812-4593'-1-"],
    ['a prefix with %', 'e2e-pr812-45933950039%-1-'],
    ['a prefix with _', 'e2e-pr812-45933950039_1-'],
    ['a prefix in capitals', 'E2E-PR812-45933950039-1-'],
    ['a prefix without its trailing hyphen', 'e2e-pr812-45933950039-1'],
    ['a prefix not starting e2e-', 'run-pr812-45933950039-1-'],
    ['a prefix of one segment', 'e2e-pr81245933950039-'],
    ['a prefix longer than 64', `e2e-${'a'.repeat(60)}-1-`],
  ])
    check(`refused: ${label}`, runPrefixProblem(value) !== null);
  check(
    'with no prefix set, titles are as they were',
    runPrefix({}) === '' && runPrefix({ E2E_RUN_PREFIX: '' }) === '',
    '',
    false,
  );
  let threw = false;
  try {
    runPrefix({ E2E_RUN_PREFIX: 'e2e-' });
  } catch {
    threw = true;
  }
  check('refused: a malformed prefix in the environment throws before anything is written', threw);
  const query = leftoverQuery(sound);
  check(
    "the sweep's query is the prefix's live documents",
    query.includes(`dc:title LIKE '${sound}%'`) && /ecm:isTrashed = 0/.test(query),
    query,
    false,
  );
  let sweptAll = false;
  try {
    leftoverQuery('');
    sweptAll = true;
  } catch {
    // refused, as it must be
  }
  check('refused: a sweep with an empty prefix, which would match every document', !sweptAll);
  check(
    'uniqueTitle puts the run prefix first',
    /return `\$\{runPrefix\(\)\}\$\{prefix\}-/.test(readFileSync(E2E_DATA, 'utf8')),
    'apps/nuxeo-ui-e2e/src/e2e-data.ts',
    false,
  );
}

// ── The verdict ─────────────────────────────────────────────────────────────────────────────────
const scratch = mkdtempSync(join(tmpdir(), 'e2e-smoke-selftest-'));

const aTest = (overrides = {}) => ({
  title: 'lists repository content at the root',
  tags: ['smoke'],
  project: 'chromium',
  status: 'expected',
  expectedStatus: 'passed',
  ...overrides,
});

/** A report shaped like Playwright's JSON reporter's: a file suite, a describe, its specs. */
const report = (tests) => ({
  config: {},
  suites: [
    {
      title: 'browse.spec.ts',
      file: 'browse.spec.ts',
      specs: [],
      suites: [
        {
          title: 'browse',
          file: 'browse.spec.ts',
          specs: tests.map((t) => ({
            title: t.title,
            file: 'browse.spec.ts',
            tags: t.tags,
            tests: [
              {
                projectName: t.project,
                status: t.status,
                expectedStatus: t.expectedStatus,
                results: [{ duration: 1200 }],
              },
            ],
          })),
        },
      ],
    },
  ],
  stats: {},
});

function verdict(content, args = ['--project', 'chromium']) {
  const file = join(scratch, `results-${negative + positive}.json`);
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  const run = spawnSync(process.execPath, [VERDICT, file, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
  });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

function theVerdict() {
  const good = verdict(report([aTest(), aTest({ title: 'offers navigation' })]));
  check(
    'passed: two passed smoke tests on chromium',
    good.status === 0 && /2 tests passed/.test(good.out),
    good.out,
    false,
  );
  const flaky = verdict(report([aTest({ status: 'flaky' })]));
  check(
    'passed, and named: a smoke test that passed on a retry',
    flaky.status === 0 && /passed on a retry/.test(flaky.out),
    flaky.out,
    false,
  );
  for (const [label, content, reason] of [
    ['a report with no test, as a --grep that matched nothing', report([]), /holds no test/],
    ['a report that is not one', { stats: {} }, /not a Playwright JSON report/],
    ['a file that is not JSON', 'Error: no tests found', /could not be read as JSON/],
    ['a test not tagged @smoke', report([aTest(), aTest({ tags: [] })]), /is not tagged @smoke/],
    ['a test on another project', report([aTest({ project: 'webkit' })]), /ran on "webkit"/],
    ['a skipped smoke test', report([aTest({ status: 'skipped' })]), /status is "skipped"/],
    ['a failed smoke test', report([aTest({ status: 'unexpected' })]), /status is "unexpected"/],
    [
      'a test expected to fail',
      report([aTest({ expectedStatus: 'failed' })]),
      /against an expected "failed"/,
    ],
  ]) {
    const result = verdict(content);
    check(`refused: ${label}`, result.status === 1 && reason.test(result.out), result.out);
  }
  const usage = verdict(report([aTest()]), []);
  check('refused: the verdict without --project, as a usage error', usage.status === 2, usage.out);
}

// ── The sweep ───────────────────────────────────────────────────────────────────────────────────
const SWEPT = 'e2e-pr812-45933950039-1-';
const USER = 'sweep-control-user';

/**
 * A stand-in for the few Nuxeo endpoints the sweep calls, through the dev server's `/nuxeo` path:
 * `/me`, `Repository.Query`, which answers the documents whose title starts with the prefix the
 * query names and are not trashed, and `Document.Trash`. Every request is recorded.
 */
function standIn({ documents, refuseTrash = [], me = USER, queryStatus = 200 }) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body });
      const send = (status, value) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (request.url === '/nuxeo/api/v1/me')
        return send(200, { 'entity-type': 'user', id: me, properties: { username: me } });
      if (request.url === '/nuxeo/api/v1/automation/Repository.Query') {
        if (queryStatus !== 200) return send(queryStatus, { message: 'refused' });
        const query = JSON.parse(body).params.query;
        const like = /dc:title LIKE '([^']*)%'/.exec(query)?.[1] ?? '\u0000';
        return send(200, {
          'entity-type': 'documents',
          entries: documents
            .filter((doc) => !doc.trashed && doc.title.startsWith(like))
            .map(({ uid, title, path }) => ({ uid, title, path })),
        });
      }
      const trash = /^\/nuxeo\/api\/v1\/id\/([^/]+)\/@op\/Document\.Trash$/.exec(request.url ?? '');
      if (trash) {
        if (refuseTrash.includes(trash[1])) return send(403, { message: 'forbidden' });
        const doc = documents.find((each) => each.uid === trash[1]);
        if (doc) doc.trashed = true;
        return send(200, { uid: trash[1], isTrashed: true });
      }
      return send(404, { message: `no stand-in for ${request.url}` });
    });
  });
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => done({ server, requests, port: server.address().port })),
  );
}

/** The sweep, as the workflow runs it, against the stand-in. */
function sweep(port, env = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [SWEEP], {
      cwd: REPO,
      env: {
        ...process.env,
        E2E_BASE_URL: `http://127.0.0.1:${port}`,
        E2E_ALLOWED_HOSTS: `127.0.0.1:${port}`,
        NUXEO_USER: USER,
        NUXEO_PASS: 'stand-in-only',
        E2E_RUN_PREFIX: SWEPT,
        ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (status) => done({ status, out }));
  });
}

const leftDocuments = () => [
  { uid: 'left-1', title: `${SWEPT}e2e-trash-1a2b3c4d`, path: '/ws/left-1' },
  { uid: 'left-2', title: `${SWEPT}e2e-collection-5e6f7a8b`, path: '/ws/left-2' },
  { uid: 'other-run', title: 'e2e-pr813-45933950040-1-e2e-trash-0a0b0c0d', path: '/ws/other-run' },
  { uid: 'a-person', title: 'Quarterly report', path: '/ws/a-person' },
];

async function theSweep() {
  {
    const documents = leftDocuments();
    const { server, requests, port } = await standIn({ documents });
    const result = await sweep(port);
    server.close();
    const queries = requests
      .filter((r) => r.url.endsWith('/Repository.Query'))
      .map((r) => JSON.parse(r.body).params.query);
    const trashedIds = documents.filter((doc) => doc.trashed).map((doc) => doc.uid);
    check(
      "the sweep trashes the run's two leftovers and nothing else, asking only for the prefix's",
      result.status === 0 &&
        trashedIds.join(',') === 'left-1,left-2' &&
        queries.length > 0 &&
        queries.every((query) => query === leftoverQuery(SWEPT)) &&
        /2 document\(s\) left under the prefix/.test(result.out),
      `exit ${result.status}, trashed ${trashedIds.join(',')}: ${result.out}`,
      false,
    );
  }
  {
    const { server, port } = await standIn({ documents: leftDocuments().slice(2) });
    const result = await sweep(port);
    server.close();
    check(
      'the sweep says so when the specs left nothing',
      result.status === 0 && /nothing was left under the prefix/.test(result.out),
      result.out,
      false,
    );
  }
  {
    const { server, port } = await standIn({ documents: leftDocuments(), refuseTrash: ['left-2'] });
    const result = await sweep(port);
    server.close();
    check(
      'refused, exit 1: a leftover the server will not trash, named',
      result.status === 1 && /left-2/.test(result.out) && /HTTP 403/.test(result.out),
      result.out,
    );
  }
  {
    const { server, requests, port } = await standIn({ documents: leftDocuments(), me: 'Guest' });
    const result = await sweep(port);
    server.close();
    check(
      'refused, exit 2: an identity that is not NUXEO_USER, before any query',
      result.status === 2 && !requests.some((r) => r.url.endsWith('/Repository.Query')),
      result.out,
    );
  }
  {
    const { server, port } = await standIn({ documents: leftDocuments(), queryStatus: 500 });
    const result = await sweep(port);
    server.close();
    check('refused, exit 2: a query the server refuses', result.status === 2, result.out);
  }
  {
    const { server, requests, port } = await standIn({ documents: leftDocuments() });
    const result = await sweep(port, { E2E_RUN_PREFIX: '' });
    server.close();
    check(
      'refused, exit 2: no prefix, before any request',
      result.status === 2 && requests.length === 0,
      result.out,
    );
  }
}

// ── The workflow ────────────────────────────────────────────────────────────────────────────────
/** The jobs of a workflow's text, read by indentation as this repository writes them. */
function jobsOf(text) {
  const lines = text.split('\n').filter((line) => !line.trimStart().startsWith('#'));
  const start = lines.findIndex((line) => line === 'jobs:');
  const jobs = new Map();
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) jobs.set((current = header[1]), []);
    else if (current !== null) jobs.get(current).push(line);
  }
  return { head: lines.slice(0, start < 0 ? lines.length : start), jobs };
}

/** A job's steps, each as its text. */
function stepsOf(lines) {
  const steps = [];
  for (const line of lines) {
    if (/^ {6}- /.test(line)) steps.push(line);
    else if (steps.length > 0 && /^ {8}/.test(line)) steps[steps.length - 1] += `\n${line}`;
  }
  return steps;
}

const OWN =
  "github.event.pull_request.head.repo.full_name == github.repository && github.actor != 'dependabot[bot]'";
const NOT_OWN =
  "github.event.pull_request.head.repo.full_name != github.repository || github.actor == 'dependabot[bot]'";

/** What is wrong with e2e-smoke.yml, as these controls hold it. */
function workflowProblems(text) {
  const problems = [];
  const { head, jobs } = jobsOf(text);
  const top = head.join('\n');
  // Comments are not read: the header's own account of what the file does not do names it.
  const code = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  if (/pull_request_target/.test(code)) problems.push('it is triggered by pull_request_target');
  if (
    !/^on:\n {2}pull_request:\n {4}branches: \[main, 'integration\/\*\*', 'staging\/\*\*'\]$/m.test(
      top,
    )
  )
    problems.push('it does not run on pull requests into main, integration/** and staging/**');
  if (/^ {2}(push|workflow_run|schedule|workflow_dispatch):/m.test(top))
    problems.push('it has a trigger other than pull_request');
  if (!/^permissions:\n {2}contents: read\n {2}packages: read$/m.test(top))
    problems.push("the workflow's permissions are not contents: read and packages: read");
  if (/:\s*write\b|write-all/.test(code)) problems.push('something is given a write permission');
  if (/continue-on-error/.test(code)) problems.push('a step or job may fail and still pass');
  const smoke = jobs.get('smoke');
  const notRun = jobs.get('not-run');
  if (!smoke || !notRun) return [...problems, 'there is no smoke job and not-run job'];
  const ifOf = (lines) =>
    (lines.find((line) => /^ {4}if:/.test(line)) ?? '').replace(/^ {4}if:\s*/, '');
  if (ifOf(smoke) !== OWN)
    problems.push(
      "smoke does not run on exactly this repository's own non-Dependabot pull requests",
    );
  if (ifOf(notRun) !== NOT_OWN) problems.push('not-run is not the exact complement of smoke');
  if (!notRun.some((line) => /::notice title=E2E smoke not run::/.test(line)))
    problems.push('not-run does not say that the smoke run did not run');
  if (notRun.some((line) => /secrets\./.test(line))) problems.push('not-run reads a secret');
  const smokeText = smoke.join('\n');
  if (
    !/\n {4}concurrency:\n {6}group: e2e-hosted-nuxeo-smoke\n {6}cancel-in-progress: false(\n|$)/.test(
      smokeText,
    )
  )
    problems.push(
      'smoke runs are not serialised in one group that never cancels a run in progress',
    );
  if (
    !/\n {6}E2E_RUN_PREFIX: e2e-pr\$\{\{ github\.event\.pull_request\.number \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-(\n|$)/.test(
      smokeText,
    )
  )
    problems.push("smoke's documents do not carry the run's own prefix");
  const steps = stepsOf(smoke);
  const checkout = steps.find((step) => /uses: actions\/checkout@/.test(step)) ?? '';
  if (!/\n {10}persist-credentials: false(\n|$)/.test(checkout))
    problems.push('the checkout leaves a token where the pull request code can read it');
  const suite = steps.findIndex((step) => /npx playwright test /.test(step));
  const suiteStep = steps[suite] ?? '';
  if (suite < 0) problems.push('smoke does not run Playwright');
  else {
    if (!/ --grep @smoke(\s|$)/.test(suiteStep))
      problems.push('the suite is not narrowed to @smoke');
    if (!/ --project=chromium(\s|$)/.test(suiteStep))
      problems.push('the suite does not run on chromium');
    if (/ --pass-with-no-tests| --grep-invert| \|\| true/.test(suiteStep))
      problems.push('the suite may pass with nothing run');
    if (/\n {8}if:/.test(suiteStep)) problems.push('the suite step is conditional');
  }
  const verdictAt = steps.findIndex((step) =>
    /node scripts\/beta-harness\/e2e-smoke-verdict\.mjs dist\/e2e\/results\.json --project chromium(\n|$)/.test(
      step,
    ),
  );
  if (verdictAt < 0 || verdictAt < suite)
    problems.push('the report is not held to the verdict after the suite');
  else if (/\n {8}if:/.test(steps[verdictAt])) problems.push('the verdict step is conditional');
  const sweep = steps.find((step) => /e2e-sweep\.mjs/.test(step)) ?? '';
  if (!/\n {8}if: always\(\)/.test(sweep))
    problems.push('the sweep does not run whatever happened');
  return problems;
}

function theWorkflow() {
  const text = readFileSync(WORKFLOW, 'utf8');
  const sound = workflowProblems(text);
  check(
    'e2e-smoke.yml: read-only, skipped only without secrets, serialised, held to the verdict, swept',
    sound.length === 0,
    sound.join('; '),
    false,
  );
  const breaks = [
    [
      'pull_request_target',
      (t) => t.replace(/^ {2}pull_request:$/m, '  pull_request_target:'),
      /pull_request_target/,
    ],
    ['no staging branches', (t) => t.replace(", 'staging/**']", ']'), /staging\/\*\*/],
    [
      'a write permission',
      (t) => t.replace('  packages: read\n', '  packages: read\n  pull-requests: write\n'),
      /write permission/,
    ],
    [
      'smoke skipped for its own pull requests too',
      (t) => t.replace(`    if: ${OWN}`, "    if: github.actor != 'dependabot[bot]' && false"),
      /smoke does not run on exactly/,
    ],
    [
      'not-run that does not cover a fork',
      (t) => t.replace(`    if: ${NOT_OWN}`, "    if: github.actor == 'dependabot[bot]'"),
      /not the exact complement/,
    ],
    [
      'a silent not-run',
      (t) => t.replace('::notice title=E2E smoke not run::', ''),
      /does not say/,
    ],
    [
      'a group per pull request',
      (t) =>
        t.replace(
          'group: e2e-hosted-nuxeo-smoke',
          'group: e2e-hosted-nuxeo-smoke-${{ github.event.pull_request.number }}',
        ),
      /not serialised/,
    ],
    [
      'a run in progress cancelled by the next',
      (t) =>
        t.replace(
          'group: e2e-hosted-nuxeo-smoke\n      cancel-in-progress: false',
          'group: e2e-hosted-nuxeo-smoke\n      cancel-in-progress: true',
        ),
      /not serialised/,
    ],
    ['no run prefix', (t) => t.replace(/\n {6}E2E_RUN_PREFIX: [^\n]*/, ''), /run's own prefix/],
    ['the whole suite', (t) => t.replace(' --grep @smoke', ''), /not narrowed to @smoke/],
    [
      'webkit',
      (t) => t.replace('--project=chromium --grep', '--project=webkit --grep'),
      /does not run on chromium/,
    ],
    [
      'a suite that passes with no test',
      (t) => t.replace(' --grep @smoke', ' --grep @smoke --pass-with-no-tests'),
      /nothing run/,
    ],
    [
      'no verdict',
      (t) =>
        t.replace(
          'node scripts/beta-harness/e2e-smoke-verdict.mjs dist/e2e/results.json --project chromium',
          'echo verdict',
        ),
      /not held to the verdict/,
    ],
    [
      'a step allowed to fail',
      (t) =>
        t.replace(
          '      - name: Run the smoke flows\n',
          '      - name: Run the smoke flows\n        continue-on-error: true\n',
        ),
      /fail and still pass/,
    ],
    [
      'a sweep only on success',
      (t) =>
        t.replace(
          "if: always() && steps.serve.outcome == 'success'",
          "if: steps.serve.outcome == 'success'",
        ),
      /sweep does not run/,
    ],
    [
      'a checkout that keeps its token',
      (t) => t.replace('persist-credentials: false', 'persist-credentials: true'),
      /leaves a token/,
    ],
  ];
  for (const [label, edit, reason] of breaks) {
    const broken = edit(text);
    const problems = workflowProblems(broken);
    check(
      `refused: e2e-smoke.yml with ${label}`,
      broken !== text && problems.some((problem) => reason.test(problem)),
      broken === text ? 'the break changed nothing' : problems.join('; ') || 'no problem found',
    );
  }

  const nightly = readFileSync(NIGHTLY, 'utf8');
  const dispatches = (t) =>
    /matching-refs\/heads\/integration\//.test(t) && /matching-refs\/heads\/staging\//.test(t);
  check(
    'e2e-nightly.yml dispatches its integration and staging branches',
    dispatches(nightly),
    '',
    false,
  );
  check(
    'refused: e2e-nightly.yml without its staging branches',
    !dispatches(
      nightly.replace(/matching-refs\/heads\/staging\//g, 'matching-refs/heads/integration/'),
    ),
  );
}

try {
  thePrefix();
  theVerdict();
  await theSweep();
  theWorkflow();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(
  `\n${negative} negative and ${positive} positive controls, ${failures.length} failed.\n`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
