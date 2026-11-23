#!/usr/bin/env node
/**
 * Collects the dev-analytics snapshot: PR flow, CI health, unit-test counts, coverage, E2E.
 *
 *   node scripts/dev-analytics/collect.mjs --out dist/dev-analytics \
 *        [--days 90] [--repo owner/name] [--lcov coverage/lcov.info] \
 *        [--e2e-dir <dir containing the downloaded e2e artifacts>] [--history-dir <earlier snapshots>] \
 *        [--job-sample 60] [--skip-github]
 *
 * Writes `snapshot.json`, `index.html` (self-contained dashboard) and `summary.md`.
 *
 * Every section degrades on its own: a missing lcov, a missing E2E artifact or an API failure
 * leaves that section `null` with a reason in `gaps`, and the dashboard says "no data". It never
 * prints a zero for something it could not read, because a 0% that means "nothing was read" and
 * a 0% that means "nothing is covered" look identical on a chart.
 *
 * GitHub access is the `gh` CLI (GH_TOKEN in Actions), always launched with an argument array.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  byWeek, countSpec, kpis, parseLcov, parsePlaywright, prTimings, summariseJobs, summarisePrs,
  summariseRuns, summariseSpecs,
} from './lib.mjs';
import { renderDashboard, renderSummary } from './render.mjs';

function parseArgs(argv) {
  const o = { days: 90, jobSample: 60, out: 'dist/dev-analytics' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skip-github') o.skipGithub = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      o[key] = argv[++i];
    }
  }
  o.days = Number(o.days);
  o.jobSample = Number(o.jobSample);
  return o;
}

const gh = (args) =>
  JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));

function detectRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const m = /github\.com[:/]([^/]+\/[^/.]+)/.exec(url);
  if (!m) throw new Error(`cannot work out owner/repo from ${url}; pass --repo`);
  return m[1];
}

const PR_QUERY = `
query($owner:String!,$name:String!,$cursor:String){
  repository(owner:$owner,name:$name){
    defaultBranchRef{name}
    pullRequests(states:MERGED,first:50,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number title body headRefName baseRefName createdAt mergedAt updatedAt
        additions deletions changedFiles author{login}
        commits(first:1){nodes{commit{authoredDate}}}
        reviews(first:50){nodes{state submittedAt author{__typename login}}}
      }
    }
  }
}`;

function collectPrs(repo, since) {
  const [owner, name] = repo.split('/');
  const merged = [];
  let cursor = null;
  let branch = 'main';
  for (let page = 0; page < 40; page++) {
    const args = ['api', 'graphql', '-f', `query=${PR_QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`];
    if (cursor) args.push('-F', `cursor=${cursor}`);
    const { repository } = gh(args).data;
    branch = repository.defaultBranchRef?.name ?? branch;
    const { nodes, pageInfo } = repository.pullRequests;
    for (const n of nodes) if (n.mergedAt && n.mergedAt >= since) merged.push(n);
    // Ordered by UPDATED_AT, which is >= mergedAt, so once a whole page was last updated before
    // the window nothing later can have been merged inside it.
    if (!pageInfo.hasNextPage || nodes.every((n) => n.updatedAt < since)) break;
    cursor = pageInfo.endCursor;
  }
  // DORA numbers describe what reached the default branch, not stacked PRs into other branches.
  return { branch, prs: merged.filter((p) => p.baseRefName === branch) };
}

function collectCi(repo, since, jobSample, gaps, workflow = 'ci.yml') {
  // ci.yml runs on every push and PR (about 100 a day here), so a window of weeks is dozens of
  // pages. The cap bounds API use; hitting it is reported, never silently shortened.
  const MAX_PAGES = 40;
  const runs = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = gh(['api', `repos/${repo}/actions/workflows/${workflow}/runs?per_page=100&page=${page}&created=>=${since.slice(0, 10)}`]);
    runs.push(...res.workflow_runs);
    if (res.workflow_runs.length < 100) break;
    if (page === MAX_PAGES) truncated = true;
  }
  if (truncated) {
    const oldest = runs.at(-1)?.created_at?.slice(0, 10);
    gaps.push(`ci runs: stopped at ${runs.length} runs (oldest ${oldest}); the window is shorter than ${since.slice(0, 10)}`);
  }
  const completed = runs.filter((r) => r.status === 'completed' && ['success', 'failure'].includes(r.conclusion));
  const jobLists = [];
  for (const run of completed.slice(0, jobSample)) {
    try {
      jobLists.push(gh(['api', `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`]).jobs);
    } catch {
      /* a run whose jobs expired is skipped, not fatal */
    }
  }
  return {
    ...summariseRuns(runs),
    jobSampleRuns: jobLists.length,
    jobs: summariseJobs(jobLists),
    byWeek: byWeek(completed, (r) => r.created_at).map(([week, rs]) => ({ week, ...summariseRuns(rs) })),
  };
}

// The Vitest `include` the projects use (libs/shared/ui/vite.config.mts): `*.{test,spec}.<ext>`.
// Karma projects use `*.spec.ts`, which this also covers.
const UNIT_EXTS = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx'];
const UNIT_GLOBS = ['spec', 'test'].flatMap((kind) => UNIT_EXTS.map((ext) => `*.${kind}.${ext}`));

/** Playwright suites match the same file names but are not unit tests. */
function isBrowserSuite(path, source) {
  return /(^|\/)[^/]*-e2e\//.test(path) || /(^|\/)a11y\/specs\//.test(path) || /from\s+['"]@playwright\/test['"]/.test(source);
}

function collectUnit() {
  const files = execFileSync('git', ['ls-files', ...UNIT_GLOBS], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter(Boolean);
  const scanned = [];
  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    if (!isBrowserSuite(path, source)) scanned.push({ path, counts: countSpec(source) });
  }
  return { ...summariseSpecs(scanned), excludedBrowserSuites: files.length - scanned.length };
}

/** The `matrix.project` list in e2e-nightly.yml. Keep the two in step. */
const EXPECTED_E2E_BROWSERS = ['chromium', 'webkit'];

function collectE2e(dir) {
  const reports = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'results.json') reports.push(p);
    }
  };
  walk(dir);
  if (reports.length === 0) return null;
  // e2e-nightly.yml runs one job per browser and uploads each as `e2e-<browser>`, ignoring a job
  // that produced no files. One browser's totals presented as the nightly's would read as a pass
  // rate nobody measured, so a missing browser leaves the whole section unmeasured.
  const missing = EXPECTED_E2E_BROWSERS.filter((b) => !reports.some((p) => p.split(/[\\/]/).includes(`e2e-${b}`)));
  if (missing.length) throw new Error(`no results.json from ${missing.join(', ')}; the nightly's other browser alone would be a partial total`);
  const parts = reports.map((p) => parsePlaywright(JSON.parse(readFileSync(p, 'utf8'))));
  const sum = (k) => parts.reduce((s, x) => s + (x[k] ?? 0), 0);
  const ran = sum('total') - sum('skipped');
  return {
    total: sum('total'), passed: sum('passed'), failed: sum('failed'), flaky: sum('flaky'), skipped: sum('skipped'),
    firstAttemptPassRatePct: ran ? Math.round((sum('passed') / ran) * 1000) / 10 : null,
    durationMinutes: Math.round(parts.reduce((m, x) => Math.max(m, x.durationMinutes ?? 0), 0) * 10) / 10, // jobs run in parallel
    projects: parts.flatMap((x) => x.projects),
    flakyTests: parts.flatMap((x) => x.flakyTests),
    reports: reports.length,
  };
}

function loadHistory(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => kpis(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const now = new Date();
  const since = new Date(now.getTime() - o.days * 864e5).toISOString();
  const gaps = [];
  const snapshot = { generatedAt: now.toISOString(), windowDays: o.days, since, repo: null, gaps };

  const guard = (label, fn) => {
    try {
      return fn();
    } catch (e) {
      gaps.push(`${label}: ${String(e.message ?? e).split('\n')[0]}`);
      return null;
    }
  };

  if (o.skipGithub) {
    gaps.push('GitHub sections skipped (--skip-github)');
  } else {
    snapshot.repo = o.repo ?? guard('repo', detectRepo);
    if (snapshot.repo) {
      const got = guard('pull requests', () => collectPrs(snapshot.repo, since));
      if (got) {
        const timings = got.prs.map(prTimings);
        snapshot.defaultBranch = got.branch;
        snapshot.prs = {
          ...summarisePrs(timings),
          byWeek: byWeek(timings, (t) => t.mergedAt).map(([week, ts]) => ({
            week, merged: ts.length, ...Object.fromEntries(Object.entries(summarisePrs(ts)).filter(([k]) => ['leadHours', 'size'].includes(k))),
          })),
          // Largest and slowest, so the page can name what to look at, not only the distribution.
          slowest: [...timings].sort((a, b) => (b.leadHours ?? 0) - (a.leadHours ?? 0)).slice(0, 5)
            .map(({ number, leadHours, size }) => ({ number, leadHours: Math.round(leadHours), size })),
        };
      }
      snapshot.ci = guard('ci runs', () => collectCi(snapshot.repo, since, o.jobSample, gaps));
    }
  }

  snapshot.unit = guard('unit tests', collectUnit);

  if (o.lcov && existsSync(o.lcov)) snapshot.coverage = guard('coverage', () => parseLcov(readFileSync(o.lcov, 'utf8')));
  else gaps.push('coverage: no lcov file (the SonarCloud workflow has not published one yet)');

  if (o.e2eDir && existsSync(o.e2eDir)) {
    const before = gaps.length;
    snapshot.e2e = guard('e2e', () => collectE2e(o.e2eDir));
    // `guard` already named the reason when collection threw (a browser missing, a bad report).
    if (!snapshot.e2e && gaps.length === before) gaps.push('e2e: no results.json under the artifact directory');
  } else gaps.push('e2e: no artifact directory (no recent e2e-nightly run to read)');

  const history = loadHistory(o.historyDir);
  history.push(kpis(snapshot));
  snapshot.history = history.slice(-180);

  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  writeFileSync(join(out, 'index.html'), renderDashboard(snapshot));
  writeFileSync(join(out, 'summary.md'), renderSummary(snapshot));
  console.log(`dev-analytics: wrote ${out} (${gaps.length} gap${gaps.length === 1 ? '' : 's'})`);
  for (const g of gaps) console.log(`  gap: ${g}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
