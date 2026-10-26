#!/usr/bin/env node
/**
 * Controls for how `pr-review-analysis.mjs` reads a Copilot review **body**.
 *
 * The fixtures are real bodies, byte for byte, not reconstructions:
 *
 *   copilot-review-previously-missed.txt       #333 review 5454141630 — two threads plus four
 *                                              "Previously missed" findings
 *   copilot-review-previously-missed-only.txt  #336 review 5454093728 — no threads, one
 *                                              "Previously missed" finding
 *   copilot-review-clean.txt                   #336 review 5456308917 — "Approval recommended"
 *
 * The first is the case that was lost: the review had threads, so its body was skipped as a
 * restatement and the four findings in it were recorded nowhere and counted by no round.
 *
 * Usage:  node scripts/pr-review-analysis.selftest.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { previouslyMissedFindings, reviewBodyItems } from './pr-review-analysis.mjs';

const fixture = (name) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const withThreads = fixture('copilot-review-previously-missed.txt');
const missedOnly = fixture('copilot-review-previously-missed-only.txt');
const clean = fixture('copilot-review-clean.txt');

const results = [];
function control(name, kind, check) {
  let ok;
  let detail = '';
  try {
    detail = check() ?? '';
    ok = detail === '';
  } catch (error) {
    ok = false;
    detail = error.message;
  }
  results.push({ name, kind, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${kind}] ${name}${ok ? '' : ` — ${detail}`}`);
}

const where = (items) => items.map((i) => `${i.file}:${i.line}`);
const same = (got, want) =>
  JSON.stringify(got) === JSON.stringify(want)
    ? ''
    : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`;

control('review with threads keeps its four previously-missed findings', 'must report', () =>
  same(where(reviewBodyItems(withThreads, true)), [
    'scripts/beta-harness/dependency-tree.mjs:131',
    'scripts/beta-harness/dependency-tree.mjs:645',
    'documentation/30-engineering/08-dev-harness-and-gates.md:14',
    'scripts/beta-harness/dependency-tree.selftest.mjs:614',
  ]),
);

control('each finding is its title, not the severity icon markup', 'must report', () =>
  same(
    previouslyMissedFindings(withThreads).map((i) => i.finding),
    [
      'Missing --root causes exit 1 instead of documented exit 2',
      'readJson accepts null or arrays without recording an inspection gap',
      'Update documentation provenance for the new 26-gate inventory',
      'Selftest misclassifies report-only controls as must-stay-quiet',
    ],
  ),
);

control('review without threads records its finding with file and line', 'must report', () =>
  same(where(reviewBodyItems(missedOnly, false)), ['apps/nuxeo-ui-e2e/src/search.spec.ts:237']),
);

control('a shape change is a shortfall row, not a silent loss', 'must report', () => {
  const broken = withThreads.replace('`scripts/', '`(path moved)` scripts/');
  const items = previouslyMissedFindings(broken);
  if (items.length !== 4) return `got ${items.length} rows, want 3 parsed + 1 shortfall`;
  const titles = items.slice(0, 3).map((i) => i.finding);
  if (titles[0] !== 'readJson accepts null or arrays without recording an inspection gap') {
    return `the broken entry leaked into the next one: ${JSON.stringify(titles)}`;
  }
  const last = items[items.length - 1];
  return last.file === '(review summary)' && /1 of them could not be parsed/.test(last.finding)
    ? ''
    : `last row is ${JSON.stringify(last)}`;
});

control('a title with nested markup keeps no angle bracket', 'must stay quiet', () => {
  const nested = withThreads.replace(
    'Missing --root causes exit 1',
    '<scr<script>ipt>Missing --root</scr</b>ipt> causes exit 1',
  );
  const title = previouslyMissedFindings(nested)[0].finding;
  return /[<>]/.test(title) ? `title kept markup: ${JSON.stringify(title)}` : '';
});

control('an unparsed non-clean body with no threads is still one summary row', 'must report', () =>
  same(where(reviewBodyItems('### Changes recommended\n\nSomething is wrong.', false)), [
    '(review summary):null',
  ]),
);

control('an approval contributes nothing', 'must stay quiet', () =>
  same(reviewBodyItems(clean, false), []),
);

control('a plain summary under threads is not double-counted', 'must stay quiet', () =>
  same(reviewBodyItems('### Changes recommended\n\nSee the comments.', true), []),
);

const failed = results.filter((r) => !r.ok);
const reports = results.filter((r) => r.kind === 'must report').length;
const split = `${reports} must report + ${results.length - reports} must stay quiet`;
console.log();
if (failed.length === 0) {
  console.log(`pr-review-analysis selftest: pass — ${results.length} control(s): ${split}.`);
} else {
  console.error(
    `pr-review-analysis selftest: FAIL — ${failed.length} of ${results.length} control(s) (${split}).`,
  );
  process.exitCode = 1;
}
