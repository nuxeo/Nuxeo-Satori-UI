/**
 * Pure functions for the dev-analytics collector: statistics, bucketing, and parsers for the
 * three inputs that are files rather than API calls (lcov, Playwright JSON, spec sources).
 *
 * Nothing here touches the network or the clock, so `lib.selftest.mjs` can pin every number.
 */

/** Median and p90 by the nearest-rank method. `null` for an empty list: "no data" is not 0. */
export function percentile(values, p) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * xs.length));
  return xs[rank - 1];
}
export const median = (values) => percentile(values, 50);
export const p90 = (values) => percentile(values, 90);

export const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 36e5;

/**
 * Splits [since, until] into contiguous, non-overlapping UTC date ranges of `days` days each,
 * oldest first, as [from, to] YYYY-MM-DD pairs (both ends inclusive, the form `created=a..b` takes).
 */
export function dateWindows(since, until, days) {
  const day = (d) => d.toISOString().slice(0, 10);
  const end = new Date(day(new Date(until)) + 'T00:00:00Z');
  const out = [];
  for (let from = new Date(day(new Date(since)) + 'T00:00:00Z'); from <= end; ) {
    const to = new Date(Math.min(from.getTime() + (days - 1) * 864e5, end.getTime()));
    out.push([day(from), day(to)]);
    from = new Date(to.getTime() + 864e5);
  }
  return out;
}

/** Monday (UTC) of the ISO week containing `iso`, as YYYY-MM-DD. */
export function weekStart(iso) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/** Groups `items` by `weekStart(keyFn(item))`, oldest week first. */
export function byWeek(items, keyFn) {
  const weeks = new Map();
  for (const item of items) {
    const w = weekStart(keyFn(item));
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w).push(item);
  }
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const round = (n, dp = 1) => (n == null ? null : Math.round(n * 10 ** dp) / 10 ** dp);

/**
 * Turns one merged pull request (as the GraphQL query returns it) into stage durations in hours.
 * Reviews by the author do not count: a self-comment is not a review. A stage whose events never
 * happened is `null`, not 0, so an unreviewed PR does not drag the median toward "instant".
 */
export function prTimings(pr) {
  const author = pr.author?.login;
  // Bots are not reviewers for this purpose. Copilot's automated review lands within minutes of
  // opening and, counted, makes review latency look instant while a human may not have looked.
  const isBot = (a) => a?.__typename === 'Bot' || /\[bot\]$|^copilot/i.test(a?.login ?? '');
  const reviews = (pr.reviews?.nodes ?? [])
    .filter((r) => r.submittedAt && r.author?.login !== author && !isBot(r.author))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const firstReview = reviews[0]?.submittedAt ?? null;
  const approval = reviews.find((r) => r.state === 'APPROVED')?.submittedAt ?? null;
  const firstCommit = pr.commits?.nodes?.[0]?.commit?.authoredDate ?? pr.createdAt;
  const stage = (from, to) => (from && to ? Math.max(0, hoursBetween(from, to)) : null);
  return {
    number: pr.number,
    mergedAt: pr.mergedAt,
    leadHours: stage(firstCommit, pr.mergedAt),
    toFirstReviewHours: stage(pr.createdAt, firstReview),
    reviewToApprovalHours: stage(firstReview, approval),
    approvalToMergeHours: stage(approval, pr.mergedAt),
    size: (pr.additions ?? 0) + (pr.deletions ?? 0),
    files: pr.changedFiles ?? 0,
    changesRequested: reviews.filter((r) => r.state === 'CHANGES_REQUESTED').length,
    reviewed: reviews.length > 0,
    // Branch, title, then body: AGENTS/06-git-workflow.md accepts the ticket in the PR body
    // ("Implements NCO-1234") as well as the title, so a body-only link is a link.
    jiraKey: /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(`${pr.headRefName ?? ''} ${pr.title ?? ''} ${pr.body ?? ''}`)?.[1] ?? null,
    // Heuristic, and labelled as one in the dashboard: the PR body carries Claude Code's
    // attribution line. It misses AI-assisted work whose author removed the line.
    aiAssisted: /Generated with \[?Claude Code/i.test(pr.body ?? ''),
  };
}

export function summarisePrs(timings) {
  const col = (k) => timings.map((t) => t[k]);
  const n = timings.length;
  return {
    merged: n,
    leadHours: { median: round(median(col('leadHours'))), p90: round(p90(col('leadHours'))) },
    toFirstReviewHours: { median: round(median(col('toFirstReviewHours'))), p90: round(p90(col('toFirstReviewHours'))) },
    reviewToApprovalHours: { median: round(median(col('reviewToApprovalHours'))), p90: round(p90(col('reviewToApprovalHours'))) },
    approvalToMergeHours: { median: round(median(col('approvalToMergeHours'))), p90: round(p90(col('approvalToMergeHours'))) },
    size: { median: median(col('size')), p90: p90(col('size')) },
    mergedWithoutReviewPct: n ? round((timings.filter((t) => !t.reviewed).length / n) * 100) : null,
    jiraLinkedPct: n ? round((timings.filter((t) => t.jiraKey).length / n) * 100) : null,
    aiAssistedPct: n ? round((timings.filter((t) => t.aiAssisted).length / n) * 100) : null,
    changesRequestedPerPr: n ? round(timings.reduce((s, t) => s + t.changesRequested, 0) / n, 2) : null,
  };
}

/**
 * Workflow-run statistics. `first attempt` = run_attempt 1 finished green. A run that is green only
 * at attempt 2+ is counted as `passedOnRerun`, the cheapest available flakiness signal for CI.
 */
export function summariseRuns(runs) {
  const done = runs.filter((r) => r.status === 'completed' && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped');
  const green = done.filter((r) => r.conclusion === 'success');
  const firstAttemptGreen = green.filter((r) => (r.run_attempt ?? 1) === 1);
  const durations = done
    .filter((r) => r.run_started_at && r.updated_at)
    .map((r) => hoursBetween(r.run_started_at, r.updated_at) * 60);
  return {
    runs: done.length,
    passRatePct: done.length ? round((green.length / done.length) * 100) : null,
    firstAttemptPassRatePct: done.length ? round((firstAttemptGreen.length / done.length) * 100) : null,
    passedOnRerun: green.length - firstAttemptGreen.length,
    // updated_at - run_started_at includes time spent waiting on reruns and approvals, so
    // treat it as an upper bound on wall-clock, not an exact job time.
    durationMinutes: { median: round(median(durations)), p90: round(p90(durations)) },
  };
}

/** Per-job pass/fail counts from `runs/{id}/jobs`, keyed by job name. */
export function summariseJobs(jobLists) {
  const jobs = new Map();
  for (const list of jobLists) {
    for (const j of list) {
      if (j.status !== 'completed' || !['success', 'failure'].includes(j.conclusion)) continue;
      const row = jobs.get(j.name) ?? { name: j.name, runs: 0, failures: 0 };
      row.runs += 1;
      if (j.conclusion === 'failure') row.failures += 1;
      jobs.set(j.name, row);
    }
  }
  return [...jobs.values()]
    .map((r) => ({ ...r, failureRatePct: round((r.failures / r.runs) * 100) }))
    .sort((a, b) => b.failureRatePct - a.failureRatePct || b.runs - a.runs);
}

/** Directory of the project a repo-relative source path belongs to: everything before `src`. */
export function projectOf(path) {
  const parts = path.split('/');
  const i = parts.indexOf('src');
  const dir = i > 0 ? parts.slice(0, i) : parts.slice(0, Math.min(3, parts.length - 1));
  return dir.join('/') || '(root)';
}

const emptyCov = () => ({ LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0 });
const pct = (hit, found) => (found ? round((hit / found) * 100) : null);
const covRow = (c) => ({
  lines: pct(c.LH, c.LF),
  branches: pct(c.BRH, c.BRF),
  functions: pct(c.FNH, c.FNF),
  linesFound: c.LF,
});

/** Parses (merged) lcov text into overall and per-project coverage percentages. */
export function parseLcov(text) {
  const total = emptyCov();
  const projects = new Map();
  let cur = null;
  let file = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      file = line.slice(3);
      cur = emptyCov();
    } else if (line === 'end_of_record' && cur) {
      const key = projectOf(file);
      const p = projects.get(key) ?? emptyCov();
      for (const k of Object.keys(cur)) {
        p[k] += cur[k];
        total[k] += cur[k];
      }
      projects.set(key, p);
      cur = null;
    } else if (cur) {
      const m = /^(LF|LH|BRF|BRH|FNF|FNH):(\d+)$/.exec(line);
      if (m) cur[m[1]] = Number(m[2]);
    }
  }
  return {
    overall: covRow(total),
    projects: [...projects.entries()]
      .map(([project, c]) => ({ project, ...covRow(c) }))
      .sort((a, b) => (a.lines ?? 101) - (b.lines ?? 101)),
  };
}

/**
 * Counts declared tests, skipped tests and `expect(` calls in one spec file. Static, so it sees
 * declarations, not executions: a `it.each` table counts once, and a conditionally skipped test
 * counts as declared. The dashboard says so.
 */
export function countSpec(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const count = (re) => (code.match(re) ?? []).length;
  const skipped = count(/\b(?:it|test|describe)\.(?:skip|todo)\b|\bx(?:it|test|describe)\s*\(/g);
  // A declaration is a line that starts with it/test (optionally .only/.each/.skip/…). `declared`
  // includes the skipped ones, so `declared - skipped` is what actually runs. A `describe.skip`
  // counts once in `skipped` however many tests it hides, so skipped is a floor, not a total.
  const declared = count(/^\s*(?:it|test|xit|xtest)(?:\.(?:only|fails|concurrent|each|skip|todo))*\s*[(`]/gm);
  return { declared, skipped, expects: count(/\bexpect(?:\.soft)?\s*\(/g) };
}

/** Aggregates `countSpec` results (one per file) per project. */
export function summariseSpecs(files) {
  const projects = new Map();
  const add = (row, c) => {
    row.files += 1;
    row.declared += c.declared;
    row.skipped += c.skipped;
    row.expects += c.expects;
    if (c.declared > 0 && c.expects === 0) row.withoutAssertions += 1;
  };
  const total = { files: 0, declared: 0, skipped: 0, expects: 0, withoutAssertions: 0 };
  for (const { path, counts } of files) {
    const key = projectOf(path);
    const row = projects.get(key) ?? { project: key, files: 0, declared: 0, skipped: 0, expects: 0, withoutAssertions: 0 };
    add(row, counts);
    add(total, counts);
    projects.set(key, row);
  }
  return {
    ...total,
    expectsPerTest: total.declared ? round(total.expects / total.declared, 2) : null,
    projects: [...projects.values()].sort((a, b) => b.declared - a.declared),
  };
}

/** Walks a Playwright JSON report into counts, flaky tests and per-project totals. */
export function parsePlaywright(report) {
  const tests = [];
  const walk = (suite, trail) => {
    const here = suite.title && !/\.(spec|test)\.[tj]s$/.test(suite.title) ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        tests.push({
          title: [...here, spec.title].join(' › '),
          file: spec.file ?? suite.file ?? '',
          project: t.projectName ?? 'default',
          status: t.status, // expected | unexpected | flaky | skipped
          retries: Math.max(0, (t.results?.length ?? 1) - 1),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const s of report.suites ?? []) walk(s, []);
  const count = (st) => tests.filter((t) => t.status === st).length;
  const ran = tests.length - count('skipped');
  const projects = new Map();
  for (const t of tests) {
    const r = projects.get(t.project) ?? { project: t.project, total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
    r.total += 1;
    if (t.status === 'expected') r.passed += 1;
    else if (t.status === 'unexpected') r.failed += 1;
    else if (t.status === 'flaky') r.flaky += 1;
    else if (t.status === 'skipped') r.skipped += 1;
    projects.set(t.project, r);
  }
  return {
    total: tests.length,
    passed: count('expected'),
    failed: count('unexpected'),
    flaky: count('flaky'),
    skipped: count('skipped'),
    // First-attempt pass = passed without needing a retry. Flaky ones passed only on retry.
    firstAttemptPassRatePct: ran ? round((count('expected') / ran) * 100) : null,
    durationMinutes: report.stats?.duration != null ? round(report.stats.duration / 6e4) : null,
    projects: [...projects.values()],
    flakyTests: tests.filter((t) => t.status === 'flaky').map(({ title, file, project, retries }) => ({ title, file, project, retries })),
  };
}

/** Pulls the scalar headline numbers out of a snapshot, for trend lines across snapshots. */
export function kpis(s) {
  return {
    date: s.generatedAt.slice(0, 10),
    unitTestsDeclared: s.unit?.declared ?? null,
    unitTestsSkipped: s.unit?.skipped ?? null,
    coverageLines: s.coverage?.overall?.lines ?? null,
    coverageBranches: s.coverage?.overall?.branches ?? null,
    e2eTotal: s.e2e?.total ?? null,
    e2ePassRate: s.e2e?.firstAttemptPassRatePct ?? null,
    e2eFlaky: s.e2e?.flaky ?? null,
    prLeadMedianHours: s.prs?.leadHours?.median ?? null,
    prSizeMedian: s.prs?.size?.median ?? null,
    ciFirstAttemptPassRate: s.ci?.firstAttemptPassRatePct ?? null,
  };
}
