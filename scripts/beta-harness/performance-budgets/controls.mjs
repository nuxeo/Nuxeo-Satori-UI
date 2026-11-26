#!/usr/bin/env node
/**
 * The budgets' guard, seen failing: every budget lowered on purpose below what was measured, which
 * the judgement must then fail, naming the measure, its number and the lowered budget.
 *
 *   npm run beta:budgets-controls -- --bundles bundles.json --pages pages.json
 *   npm run beta:budgets-controls -- --bundles bundles.json --pages pages.json --run-checks
 *
 * It reads the reports `bundles.mjs --report` and `pages.mjs --report` wrote for a run that was
 * within budget, and for **each line** of each:
 *
 * 1. with its budget set to the measured number, rounded up, the line is within: the budget is
 *    what decides, not something else that fails the run;
 * 2. with its budget set one below the number, the line is over, and the failure says
 *    `over budget: <measure> is <number>, budget <lowered budget>`.
 *
 * With `--run-checks`, it also runs each check itself with one budget lowered, as CI's job does:
 * `bundles.mjs --lower initialBytes=<one below>` and `pages.mjs --skip-build --runs 1 --lower
 * queue.firstPageMs=1`, and requires each to exit 1 with that line in its output. So the job's
 * own exit code, not only the judgement, is seen going red.
 *
 * Exit 0 when every control was seen failing as it should; 1 when one was not; 2 a report missing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { failures, judgeBundles, judgePages, lowered, readBudgets } from './budgets.mjs';

const HERE = import.meta.dirname;

/**
 * Each line of a judged report, lowered just below its number and set just at it: the reasons the
 * guard did not behave, empty when it did. `rejudge(budgets)` judges the same measures again.
 */
export function lineControls(judged, budgets, rejudge) {
  const shortfalls = [];
  let lines = 0;
  for (const line of judged.lines) {
    if (line.value === null || line.limit === null) continue;
    lines += 1;
    const at = Math.ceil(line.value);
    const below = Math.max(0, Math.ceil(line.value) - 1);
    const atBudget = rejudge(lowered(budgets, line.id, at)).lines.find(
      (each) => each.id === line.id,
    );
    if (!atBudget?.pass)
      shortfalls.push(`${line.id}: over with its budget at its own number, ${at}`);
    const over = rejudge(lowered(budgets, line.id, below));
    const overLine = over.lines.find((each) => each.id === line.id);
    if (overLine?.pass !== false) {
      shortfalls.push(`${line.id}: within with its budget lowered to ${below}`);
      continue;
    }
    const said = failures(over).find((message) =>
      message.startsWith(`over budget: ${line.id} is `),
    );
    const number = Math.round(line.value).toLocaleString('en');
    const limit = below.toLocaleString('en');
    if (!said || !said.includes(number) || !said.includes(`budget ${limit}`)) {
      shortfalls.push(
        `${line.id}: its failure does not name ${number} and budget ${limit}: ${said ?? 'none'}`,
      );
    }
  }
  if (lines === 0) shortfalls.push('no line was measured, so nothing was lowered');
  return { lines, shortfalls };
}

function readReport(path, kind) {
  if (!path || !existsSync(path)) return null;
  const report = JSON.parse(readFileSync(path, 'utf8'));
  if (report.kind !== kind) throw new Error(`${path} is not a ${kind} report`);
  return report;
}

/** Runs a check with a budget lowered: it must exit 1, and say the line with its numbers. */
function runLowered(script, args, expected) {
  const run = spawnSync(process.execPath, [resolve(HERE, script), ...args], { encoding: 'utf8' });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const reasons = [];
  if (run.status !== 1) reasons.push(`${script} exited ${run.status}, not 1`);
  if (!output.includes(expected)) reasons.push(`${script} did not say "${expected}"`);
  const said = output.split('\n').find((line) => line.startsWith(expected)) ?? null;
  return { reasons, said };
}

function main() {
  const { values } = parseArgs({
    options: {
      bundles: { type: 'string' },
      pages: { type: 'string' },
      'run-checks': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const budgets = readBudgets();
  const bundles = readReport(values.bundles, 'bundles');
  const pages = readReport(values.pages, 'pages');
  if (!bundles && !pages) {
    console.error('no report: give --bundles and --pages, as bundles.mjs and pages.mjs wrote them');
    process.exit(2);
  }
  const problems = [];
  if (bundles) {
    if (!bundles.pass)
      problems.push('the bundles report was not within budget, so it controls nothing');
    const { lines, shortfalls } = lineControls(bundles.judged, budgets, (b) =>
      judgeBundles(bundles.measured, b),
    );
    problems.push(...shortfalls.map((each) => `bundles: ${each}`));
    console.log(`bundles: ${lines} budgets each lowered below its number and seen failing`);
  }
  if (pages) {
    if (!pages.pass)
      problems.push('the pages report was not within budget, so it controls nothing');
    const measured = Object.fromEntries(pages.judged.lines.map((line) => [line.id, line.value]));
    const { lines, shortfalls } = lineControls(pages.judged, budgets, (b) =>
      judgePages(measured, b),
    );
    problems.push(...shortfalls.map((each) => `pages: ${each}`));
    console.log(`pages: ${lines} budgets each lowered below its number and seen failing`);
  }
  if (values['run-checks']) {
    if (bundles) {
      const below = bundles.measured.initialBytes - 1;
      const { reasons, said } = runLowered(
        'bundles.mjs',
        ['--lower', `initialBytes=${below}`],
        'over budget: initialBytes is ',
      );
      problems.push(...reasons);
      console.log(
        `bundles.mjs, initialBytes lowered to ${below}: ${said ?? 'did not fail as it should'}`,
      );
    }
    if (pages) {
      const { reasons, said } = runLowered(
        'pages.mjs',
        ['--skip-build', '--runs', '1', '--lower', 'queue.firstPageMs=1'],
        'over budget: queue.firstPageMs is ',
      );
      problems.push(...reasons);
      console.log(
        `pages.mjs, queue.firstPageMs lowered to 1: ${said ?? 'did not fail as it should'}`,
      );
    }
  }
  if (problems.length > 0) {
    console.error(`the guard did not fail as it should:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('every budget, lowered on purpose, failed the check with its number and its budget');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
