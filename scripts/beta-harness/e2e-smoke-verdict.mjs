#!/usr/bin/env node
/**
 * The pull request smoke run's verdict, read from Playwright's own report, after Playwright has
 * already exited 0 (`.github/workflows/e2e-smoke.yml`).
 *
 * Playwright's exit code says that nothing selected failed. It does not say that anything was
 * selected, or that what was selected ran: a `--grep` that matches nothing, a smoke test that
 * skips itself on an instance without the data it needs, or a run of the wrong project all exit 0
 * with nothing proved. A required check that can be green in those ways is a check that can pass
 * without having run. So the report is held to five things, each a refusal:
 *
 * - it exists and is Playwright's JSON report;
 * - it holds at least one test;
 * - every test in it carries the `@smoke` tag, so the selection was the subset and not the suite;
 * - every test ran on the one project the run asked for;
 * - every test passed: `expected` with an expected status of `passed`, or `flaky`, passed on a
 *   retry, which is named in the summary. A skipped, interrupted or failed test is refused.
 *
 * It runs unconditionally, with no "was I started directly?" guard, and exports nothing: a guard
 * that misfired would exit 0 having judged nothing, and the job passes on that exit code. Its
 * controls run it as the workflow does (`e2e-smoke.selftest.mjs`).
 *
 * Usage: node scripts/beta-harness/e2e-smoke-verdict.mjs <results.json> --project <name>
 * Exit: 0 every test passed; 1 refused, with each reason; 2 the command was wrong.
 */
import { appendFileSync, readFileSync } from 'node:fs';

const SMOKE_TAG = '@smoke';

/**
 * Every test in a Playwright JSON report, with the spec it belongs to.
 *
 * @param {any} report
 * @returns {{ title: string, file: string, tags: string[], projectName: string, status: string,
 *   expectedStatus: string, duration: number }[]}
 */
function testsOf(report) {
  const tests = [];
  const walk = (suite, titles) => {
    const here = suite.title && !suite.title.endsWith('.ts') ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? [])
        tests.push({
          title: [...here, spec.title].join(' › '),
          file: spec.file ?? suite.file ?? '',
          tags: spec.tags ?? [],
          projectName: test.projectName ?? '',
          status: test.status ?? '',
          expectedStatus: test.expectedStatus ?? '',
          duration: (test.results ?? []).reduce((sum, result) => sum + (result.duration ?? 0), 0),
        });
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report?.suites ?? []) walk(suite, []);
  return tests;
}

/**
 * What is wrong with a smoke run's report, and what it ran.
 *
 * @param {any} report Playwright's JSON report, parsed
 * @param {{ project: string }} options
 * @returns {{ problems: string[], tests: ReturnType<typeof testsOf> }}
 */
function smokeVerdict(report, { project }) {
  const problems = [];
  if (!report || typeof report !== 'object' || !Array.isArray(report.suites))
    return {
      problems: ['the report is not a Playwright JSON report: it has no suites'],
      tests: [],
    };
  const tests = testsOf(report);
  if (tests.length === 0)
    problems.push(
      'the report holds no test, so nothing was smoke-tested: did --grep match nothing?',
    );
  for (const test of tests) {
    const name = `${test.file}: ${test.title}`;
    if (!test.tags.map((tag) => (tag.startsWith('@') ? tag : `@${tag}`)).includes(SMOKE_TAG))
      problems.push(`${name} is not tagged ${SMOKE_TAG}, so the run was not the smoke subset`);
    if (test.projectName !== project)
      problems.push(`${name} ran on "${test.projectName}", not on "${project}"`);
    const passed =
      test.expectedStatus === 'passed' && (test.status === 'expected' || test.status === 'flaky');
    if (!passed)
      problems.push(
        `${name} did not pass: its status is "${test.status}" against an expected "${test.expectedStatus}"`,
      );
  }
  return { problems, tests };
}

/** The run's summary, as Markdown, for the job's summary page. */
function summaryOf({ problems, tests }) {
  const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const total = tests.reduce((sum, test) => sum + test.duration, 0);
  const lines = [
    problems.length === 0
      ? `**E2E smoke: ${tests.length} ${tests.length === 1 ? 'test' : 'tests'} passed** in ${seconds(total)} of test time.`
      : `**E2E smoke refused:** ${problems.length} problem(s).`,
    '',
  ];
  for (const problem of problems) lines.push(`- ${problem}`);
  if (problems.length) lines.push('');
  if (tests.length) {
    lines.push('| Test | Result | Time |', '| --- | --- | --- |');
    for (const test of tests)
      lines.push(
        `| ${test.file}: ${test.title.replaceAll('|', '\\|')} | ${test.status === 'flaky' ? 'passed on a retry' : test.status} | ${seconds(test.duration)} |`,
      );
  }
  return `${lines.join('\n')}\n`;
}

function main(argv) {
  const [file, flag, project, ...rest] = argv;
  if (!file || flag !== '--project' || !project || rest.length) {
    console.error(
      'usage: node scripts/beta-harness/e2e-smoke-verdict.mjs <results.json> --project <name>',
    );
    return 2;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(
      `e2e-smoke-verdict: REFUSED — ${file} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  const verdict = smokeVerdict(report, { project });
  const summary = summaryOf(verdict);
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (verdict.problems.length) {
    for (const problem of verdict.problems)
      console.error(`::error title=E2E smoke refused::${problem}`);
    return 1;
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
