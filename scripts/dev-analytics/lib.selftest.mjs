#!/usr/bin/env node
/** Pins every number `lib.mjs` can produce. Run: node scripts/dev-analytics/lib.selftest.mjs */
import assert from 'node:assert/strict';

import {
  byWeek, countSpec, dateWindows, kpis, median, p90, parseLcov, parsePlaywright, prTimings, projectOf,
  summariseJobs, summarisePrs, summariseRuns, summariseSpecs, weekStart,
} from './lib.mjs';
import { mdCell } from './render.mjs';

// statistics: nearest rank, and "no data" is null rather than 0
assert.equal(median([1, 2, 3, 4]), 2);
assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
assert.equal(median([]), null);
assert.equal(median([NaN, 5]), 5);

// weeks start on Monday (UTC)
assert.equal(weekStart('2026-11-23T10:00:00Z'), '2026-11-23'); // a Monday
assert.equal(weekStart('2026-11-29T23:59:00Z'), '2026-11-23'); // the Sunday after it
assert.equal(weekStart('2026-11-30T00:00:00Z'), '2026-11-30');
assert.deepEqual(byWeek([{ d: '2026-11-30T00:00:00Z' }, { d: '2026-11-23T00:00:00Z' }], (x) => x.d).map(([w]) => w), ['2026-11-23', '2026-11-30']);

// date windows: contiguous, no gaps or overlap, the last one clipped to today
assert.deepEqual(dateWindows('2026-11-01T10:00:00Z', '2026-11-08T01:00:00Z', 3), [
  ['2026-11-01', '2026-11-03'], ['2026-11-04', '2026-11-06'], ['2026-11-07', '2026-11-08'],
]);
assert.deepEqual(dateWindows('2026-11-08T00:00:00Z', '2026-11-08T23:00:00Z', 3), [['2026-11-08', '2026-11-08']]);
{
  const w = dateWindows('2026-08-25T00:00:00Z', '2026-11-23T12:00:00Z', 3);
  for (let i = 1; i < w.length; i++) assert.equal(new Date(w[i][0]) - new Date(w[i - 1][1]), 864e5);
  assert.equal(w.length, 31); // 91 inclusive days -> 31 queries, each far under the 1,000-result cap
}

// PR timings: author's own review is ignored; unreviewed PR yields null stages, not 0
const pr = {
  number: 7, title: 'NXSAT-42 thing', headRefName: 'fix/x', body: '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  createdAt: '2026-11-01T10:00:00Z', mergedAt: '2026-11-02T10:00:00Z', additions: 30, deletions: 10, changedFiles: 3,
  author: { login: 'me' },
  commits: { nodes: [{ commit: { authoredDate: '2026-11-01T08:00:00Z' } }] },
  reviews: { nodes: [
    { submittedAt: '2026-11-01T10:30:00Z', state: 'COMMENTED', author: { login: 'me' } },
    { submittedAt: '2026-11-01T12:00:00Z', state: 'CHANGES_REQUESTED', author: { login: 'rev' } },
    { submittedAt: '2026-11-01T16:00:00Z', state: 'APPROVED', author: { login: 'rev' } },
  ] },
};
const t = prTimings(pr);
assert.equal(t.leadHours, 26);
assert.equal(t.toFirstReviewHours, 2);
assert.equal(t.reviewToApprovalHours, 4);
assert.equal(t.approvalToMergeHours, 18);
assert.equal(t.size, 40);
assert.equal(t.changesRequested, 1);
assert.equal(t.jiraKey, 'NXSAT-42');
assert.equal(t.aiAssisted, true);
// a bot review must not count as the first review, or as a review at all
const botOnly = prTimings({ number: 9, createdAt: '2026-11-01T00:00:00Z', mergedAt: '2026-11-01T05:00:00Z', author: { login: 'me' },
  reviews: { nodes: [{ submittedAt: '2026-11-01T00:02:00Z', state: 'COMMENTED', author: { __typename: 'Bot', login: 'copilot-pull-request-reviewer' } }] } });
assert.equal(botOnly.reviewed, false);
assert.equal(botOnly.toFirstReviewHours, null);
const bare = prTimings({ number: 8, createdAt: '2026-11-01T00:00:00Z', mergedAt: '2026-11-01T01:00:00Z', author: { login: 'me' }, reviews: { nodes: [] } });
assert.equal(bare.toFirstReviewHours, null);
assert.equal(bare.reviewed, false);
assert.equal(bare.jiraKey, null);
// a ticket named only in the body ("Implements NCO-1234") is still a link
const bodyOnly = prTimings({ number: 10, title: 'add export', headRefName: 'feature/export', body: 'Implements NCO-1234', createdAt: '2026-11-01T00:00:00Z', mergedAt: '2026-11-01T01:00:00Z', author: { login: 'me' }, reviews: { nodes: [] } });
assert.equal(bodyOnly.jiraKey, 'NCO-1234');
const s = summarisePrs([t, bare]);
assert.equal(s.merged, 2);
assert.equal(s.mergedWithoutReviewPct, 50);
assert.equal(s.jiraLinkedPct, 50);
assert.equal(s.toFirstReviewHours.median, 2); // the null is ignored, not averaged in as 0

// runs: cancelled/skipped are excluded, a green attempt-2 run is a rerun pass
const runs = [
  { status: 'completed', conclusion: 'success', run_attempt: 1, run_started_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:10:00Z' },
  { status: 'completed', conclusion: 'success', run_attempt: 2, run_started_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:30:00Z' },
  { status: 'completed', conclusion: 'failure', run_attempt: 1 },
  { status: 'completed', conclusion: 'cancelled', run_attempt: 1 },
  { status: 'in_progress', conclusion: null },
];
const r = summariseRuns(runs);
assert.equal(r.runs, 3);
assert.equal(r.passRatePct, 66.7);
assert.equal(r.firstAttemptPassRatePct, 33.3);
assert.equal(r.passedOnRerun, 1);
assert.equal(r.durationMinutes.median, 10); // nearest rank: the lower of 10 and 30

assert.deepEqual(
  summariseJobs([[{ name: 'lint', status: 'completed', conclusion: 'failure' }, { name: 'lint', status: 'completed', conclusion: 'success' }, { name: 'skipme', status: 'completed', conclusion: 'skipped' }]]),
  [{ name: 'lint', runs: 2, failures: 1, failureRatePct: 50 }],
);

// project grouping
assert.equal(projectOf('libs/shared/ui/src/lib/a.ts'), 'libs/shared/ui');
assert.equal(projectOf('apps/nuxeo-ui/src/app/x.ts'), 'apps/nuxeo-ui');

// lcov: two files in one project, one in another; an unfinished record is ignored
const lcov = [
  'SF:libs/a/src/x.ts', 'FNF:2', 'FNH:1', 'LF:10', 'LH:8', 'BRF:4', 'BRH:2', 'end_of_record',
  'SF:libs/a/src/y.ts', 'FNF:0', 'FNH:0', 'LF:10', 'LH:2', 'BRF:0', 'BRH:0', 'end_of_record',
  'SF:libs/b/src/z.ts', 'LF:5', 'LH:5', 'BRF:0', 'BRH:0', 'FNF:1', 'FNH:1', 'end_of_record',
  'SF:libs/c/src/partial.ts', 'LF:99', 'LH:99',
].join('\n');
const cov = parseLcov(lcov);
assert.equal(cov.overall.lines, 60); // 15 / 25
assert.equal(cov.overall.branches, 50); // 2 / 4
assert.equal(cov.projects[0].project, 'libs/a'); // worst first
assert.equal(cov.projects[0].lines, 50);
assert.equal(cov.projects.length, 2);
assert.equal(parseLcov('').overall.lines, null);

// spec counting: skips and assertions, comments ignored
const spec = `
  // it('commented out', () => {});
  /* test('also commented', () => {}); */
  describe('x', () => {
    it('a', () => { expect(1).toBe(1); expect(2).toBe(2); });
    it.skip('b', () => {});
    xit('c', () => {});
    test.each([1, 2])('d %s', () => {});
    it('no assertion', () => {});
  });`;
const c = countSpec(spec);
assert.equal(c.declared, 5);
assert.equal(c.skipped, 2);
assert.equal(c.expects, 2);
const ss = summariseSpecs([
  { path: 'libs/a/src/a.spec.ts', counts: c },
  { path: 'libs/a/src/b.spec.ts', counts: { declared: 0, skipped: 0, expects: 0 } },
]);
assert.equal(ss.files, 2);
assert.equal(ss.declared, 5);
assert.equal(ss.withoutAssertions, 0);
assert.equal(summariseSpecs([{ path: 'libs/a/src/c.spec.ts', counts: { declared: 3, skipped: 0, expects: 0 } }]).withoutAssertions, 1);

// playwright: nested describe, flaky, skipped
const report = {
  stats: { duration: 120000 },
  suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', suites: [{ title: 'Browse', specs: [
    { title: 'opens', file: 'a.spec.ts', tests: [{ projectName: 'chromium', status: 'expected', results: [{}] }] },
    { title: 'flaky one', file: 'a.spec.ts', tests: [{ projectName: 'chromium', status: 'flaky', results: [{}, {}] }] },
    { title: 'broken', file: 'a.spec.ts', tests: [{ projectName: 'webkit', status: 'unexpected', results: [{}] }] },
    { title: 'later', file: 'a.spec.ts', tests: [{ projectName: 'webkit', status: 'skipped', results: [] }] },
  ] }] }],
};
const pw = parsePlaywright(report);
assert.equal(pw.total, 4);
assert.equal(pw.flaky, 1);
assert.equal(pw.skipped, 1);
assert.equal(pw.firstAttemptPassRatePct, 33.3); // 1 of the 3 that ran passed first time
assert.equal(pw.durationMinutes, 2);
assert.equal(pw.flakyTests[0].title, 'Browse › flaky one');
assert.equal(pw.flakyTests[0].retries, 1);
assert.equal(pw.projects.find((p) => p.project === 'webkit').failed, 1);

// kpis tolerate missing sections
assert.equal(kpis({ generatedAt: '2026-11-23T00:00:00Z' }).coverageLines, null);

// Markdown escaping: backslash first, so a trailing backslash cannot free the pipe after it
assert.equal(mdCell('a|b'), 'a\\|b');
assert.equal(mdCell('evil\\'), 'evil\\\\');
assert.equal(mdCell('x\\|y'), 'x\\\\\\|y'); // \| in -> \\ then \| out: the pipe stays escaped
assert.equal(mdCell('<b>*_`'), '\\<b\\>\\*\\_\\`');
assert.equal(mdCell('line1\nline2'), 'line1 line2');
assert.equal(mdCell(null), '');

console.log('dev-analytics lib selftest: ok');
