#!/usr/bin/env node
/**
 * The performance check's negative controls, each seen failing: `npm run
 * beta:asset-performance-controls`. A check that cannot go red certifies nothing (CLAUDE.md, "A
 * gate is not evidence until you have seen it fail on purpose"), so every line of the budget is
 * broken on purpose by at least one of them (`CONTROLS` in check.mjs):
 *
 * - `slow`, the stand-in's server five times slower: the times after the first paint;
 * - `big-bundle`, the app's first script 1.5 MB heavier: the first paint and the first page;
 * - `fetch-all`, every page of a query read before the app's own request: the library's requests;
 * - `twice`, every request sent twice: every request line;
 * - `hold-pages`, every page of results kept in the page: the heap's growth;
 * - `ballast`, 80 MB held from the start: the heap after 50 pages;
 * - `unwindowed`, the search index's window enforced but not stated in the answer: a page asked
 *   for past it, the control left enabled at its edge, and the notice of it;
 * - `capped-count`, the count held to the window: the totals shown, and the notice.
 *
 * Each runs `check.mjs --control <id> --runs 1` against the same build, after one production
 * build unless `--skip-build`, and writes its report under
 * `$AGENTIC_UI_EVIDENCE_DIR/beta/asset-performance/<timestamp>-controls/<id>/`. A control passes
 * only when its run ended `fail`, not `error`, and every line `CONTROLS[id].over` names was
 * measured and over its limit: a run that failed because it measured nothing, or failed on some
 * other line only, is not this control seen working.
 *
 * Exit 0 when every control was seen failing as it should; 1 when one was not; 2 a precondition not
 * met, as the check's own.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { EVIDENCE_ROOT } from '../../collect-evidence/evidence-path.mjs';
import { CONTROLS } from './check.mjs';

const CHECK = resolve(import.meta.dirname, 'check.mjs');

/**
 * Whether `report` shows `control` working: the run failed, and every line it must break was
 * measured and over. Returns the reasons it does not, empty when it does.
 */
export function controlShortfalls(id, report) {
  const control = CONTROLS[id];
  if (!control) return [`no control "${id}"`];
  if (!report || typeof report !== 'object') return ['no report was written'];
  const reasons = [];
  if (report.verdict !== 'fail') reasons.push(`the run ended "${report.verdict}", not "fail"`);
  const lines = new Map((report.judged?.lines ?? []).map((line) => [line.id, line]));
  for (const id_ of control.over) {
    const line = lines.get(id_);
    if (!line) reasons.push(`${id_} was not judged`);
    else if (typeof line.value !== 'number' || !Number.isFinite(line.value)) {
      reasons.push(`${id_} was not measured`);
    } else if (line.value <= line.limit) {
      reasons.push(`${id_} was within its limit: ${line.value} of ${line.limit}`);
    }
  }
  return reasons;
}

async function main() {
  const { values } = parseArgs({
    options: { 'skip-build': { type: 'boolean', default: false }, port: { type: 'string' } },
    strict: true,
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reports = resolve(EVIDENCE_ROOT, 'beta', 'asset-performance', `${stamp}-controls`);
  const failures = [];
  let built = values['skip-build'];
  for (const id of Object.keys(CONTROLS)) {
    const out = join(reports, id);
    const args = [CHECK, '--control', id, '--runs', '1', '--report', out];
    if (built) args.push('--skip-build');
    if (values.port) args.push('--port', values.port);
    console.log(`\n── control ${id}: ${CONTROLS[id].describe}`);
    const run = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (run.status === 2) {
      console.error(`control ${id}: precondition not met; see above`);
      process.exit(2);
    }
    built = true;
    const file = join(out, 'report.json');
    const report = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    const reasons = controlShortfalls(id, report);
    if (run.status !== 1) reasons.unshift(`the check exited ${run.status}, not 1`);
    if (reasons.length === 0) {
      console.log(`control ${id}: seen failing, over on ${CONTROLS[id].over.join(', ')}`);
    } else {
      failures.push(`${id}: ${reasons.join('; ')}`);
      console.error(`control ${id}: NOT seen failing as it should: ${reasons.join('; ')}`);
    }
  }
  console.log(`\nreports: ${reports}`);
  if (failures.length > 0) {
    console.error(
      `${failures.length} control(s) did not fail as they should:\n  ${failures.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(`every control was seen failing: ${Object.keys(CONTROLS).join(', ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
