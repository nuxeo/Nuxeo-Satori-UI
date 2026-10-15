#!/usr/bin/env node
/**
 * Code-scanning gate — read the SAST results nobody was reading.
 *
 * ## What this is actually fixing
 *
 * Every document in this repository said **"No SAST"**. That was wrong, and it had been wrong for a
 * month. GitHub's CodeQL **default setup** was configured on 2026-07-24 and has been analysing
 * every push since: 87 JavaScript/TypeScript rules, weekly plus on-push, and it was returning
 * **21 open alerts — 6 of them high**.
 *
 * Nobody saw them, for two compounding reasons:
 *
 * 1. Default setup analyses the **pull-request ref**, so the alerts live under
 *    `refs/pull/<n>/merge` (see the ref-selection note below — this file spent a while asking for
 *    `/head`, which never has one). `GET /code-scanning/alerts` with no `ref` reports on the
 *    default branch, where there are none. Asking the obvious question returned a reassuring zero.
 * 2. Nothing in the gate pipeline, the phase evidence, or CI ever asked.
 *
 * So the gap was never the tool. It was that a tool ran, found things, and no process consumed the
 * output — which is the same failure mode as a gate nobody has watched go red, one layer out.
 *
 * ## The zero-is-not-clean check
 *
 * The most important assertion here is check 1: **a ref with no analyses is not a clean ref.** That
 * is precisely the trap this gate was written after falling into — `alerts?state=open` returned `0`
 * for a ref CodeQL had never looked at, and "0 open alerts" reads exactly like "clean". A gate that
 * cannot tell those apart is worse than none, because it manufactures confidence.
 *
 * ## Two limitations, stated because they bound what a pass means
 *
 * 1. **The analysis lags the commit.** Alerts are keyed to a ref, not a commit, and CodeQL runs in
 *    parallel with CI. So the newest analysis for a ref can predate `HEAD`, and this gate then
 *    reports on the previous commit's code. The run below prints the analysis timestamp for exactly
 *    that reason — read it, do not assume it covers what you just wrote.
 * 2. **It is therefore NOT in CI.** On a fresh push CodeQL has usually not finished, so CI would
 *    fail on the previous commit's alerts — including ones the pushed commit fixes. A gate that
 *    goes red for work already done is a gate people learn to ignore. It runs in the phase gate,
 *    which is the sign-off path, and the honest cost is that it is not enforced per-push. Wiring it
 *    in properly means waiting on the CodeQL check to complete first, which is a CI change worth
 *    making deliberately rather than as a side effect of this step.
 *
 * ## Why it can be skipped, and why that is not a hole
 *
 * This gate reads GitHub state, not the working tree, so it needs `gh` and network access and is
 * not reproducible offline. `BETA_SKIP_CODE_SCANNING=1` exists for that, and it prints a loud
 * NOT RUN rather than a pass — the same distinction `verify-gate` draws for gates that were not
 * requested. CI never sets it.
 *
 * Usage:
 *   node scripts/beta-harness/code-scanning.mjs
 *   node scripts/beta-harness/code-scanning.mjs --json
 *   node scripts/beta-harness/code-scanning.mjs --today 2027-01-01   # test allowlist expiry
 *   node scripts/beta-harness/code-scanning.mjs --ref refs/heads/main  # test an unanalysed ref
 *   BETA_SKIP_CODE_SCANNING=1 node scripts/beta-harness/code-scanning.mjs
 *
 * Exit 1 on a high/critical alert, an unallowlisted or expired medium/low, a stale allowlist entry,
 * or a ref that has never been analysed. Exit NOT_RUN_EXIT_CODE (78) with a NOT RUN banner when
 * skipped, which `verify-gate` records as NOT RUN, never as a pass.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NOT_RUN_EXIT_CODE } from './gate-summary.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const todayArg = argv[argv.indexOf('--today') + 1];
const today =
  argv.includes('--today') && todayArg ? todayArg : new Date().toISOString().slice(0, 10);

if (process.env['BETA_SKIP_CODE_SCANNING'] === '1') {
  console.log(
    '\ncode-scanning: NOT RUN — BETA_SKIP_CODE_SCANNING=1.\n' +
      '  This gate reads GitHub code-scanning state, so it needs `gh` and network access.\n' +
      '  A skipped run asserts NOTHING about SAST findings. Do not read it as a pass, and do\n' +
      '  not sign a phase off on it.\n',
  );
  process.exit(NOT_RUN_EXIT_CODE);
}

const allowlistPath = resolve(repoRoot, '.ai/state/supply-chain-allowlist.json');
const allowlist = existsSync(allowlistPath) ? JSON.parse(readFileSync(allowlistPath, 'utf8')) : {};
const accepted = allowlist.codeScanning ?? {};

/** Severities that fail outright, allowlist or not. */
const BLOCKING = ['critical', 'high'];

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);

/** @param {string[]} args */
function gh(args) {
  const res = spawnSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) {
    return { ok: false, err: (res.stderr || res.error?.message || '').trim().slice(0, 300) };
  }
  try {
    return { ok: true, data: JSON.parse(res.stdout) };
  } catch {
    return { ok: false, err: 'response was not JSON' };
  }
}

const slugRes = gh(['repo', 'view', '--json', 'nameWithOwner']);
if (!slugRes.ok) {
  fail(
    `\`gh\` could not identify the repository (${slugRes.err}). Install and authenticate the ` +
      'GitHub CLI (`gh auth login`), or set BETA_SKIP_CODE_SCANNING=1 — which records NOT RUN, ' +
      'not a pass.',
  );
}
const slug = slugRes.ok ? slugRes.data.nameWithOwner : null;

/**
 * Which ref to ask about.
 *
 * Asking about the branch — or omitting `ref` and getting the default branch — is how 21 alerts
 * stayed invisible. So prefer the open PR for the current branch, and fall back to the branch ref.
 *
 * On a pull request the analysis is recorded against the **merge** ref, not the head. This file
 * previously asked for `refs/pull/<n>/head`, where there is never an analysis, so the gate could
 * only ever fail on a PR — the very failure mode it exists to prevent, pointed at itself. Measured
 * against this repository: every PR analysis returned by `GET /code-scanning/analyses` is
 * `refs/pull/<n>/merge`, and there is not one `/head` among them. `/head` is still tried as a
 * fallback, because a repository configured with an advanced workflow can analyse it instead.
 */
let ref = null;
let refKind = null;
const refArg = argv.includes('--ref') ? argv[argv.indexOf('--ref') + 1] : null;
if (refArg) {
  // Present so the zero-is-not-clean assertion below can be tested against a ref that has never
  // been analysed. Without it that check is unfalsifiable, which is exactly the property this
  // repository keeps discovering it cannot afford in a gate.
  ref = refArg;
  refKind = `--ref ${refArg}`;
} else if (slug) {
  const pr = gh(['pr', 'view', '--json', 'number,state']);
  if (pr.ok && pr.data?.number && pr.data.state === 'OPEN') {
    // Try the merge ref first, then the head ref; use whichever actually has an analysis so a
    // differently configured repository still works. If neither does, keep the merge ref so the
    // "never analysed" failure below names the ref CodeQL would normally have written to.
    const candidates = [`refs/pull/${pr.data.number}/merge`, `refs/pull/${pr.data.number}/head`];
    const analysed = candidates.find((candidate) => {
      const probe = gh(['api', `repos/${slug}/code-scanning/analyses?ref=${candidate}&per_page=1`]);
      return probe.ok && Array.isArray(probe.data) && probe.data.length > 0;
    });
    ref = analysed ?? candidates[0];
    refKind = `open PR #${pr.data.number} (${ref.replace(/^refs\/pull\/\d+\//, '')})`;
  } else {
    const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).stdout.trim();
    ref = `refs/heads/${branch}`;
    refKind = `branch ${branch}`;
  }
}

let alerts = [];
let analyses = [];
if (slug && ref) {
  const a = gh(['api', `repos/${slug}/code-scanning/analyses?ref=${ref}&per_page=5`]);
  if (!a.ok) {
    fail(`could not list code-scanning analyses for ${ref} (${a.err}).`);
  } else {
    analyses = Array.isArray(a.data) ? a.data : [];
  }

  const r = gh(['api', `repos/${slug}/code-scanning/alerts?ref=${ref}&state=open&per_page=100`]);
  if (!r.ok) {
    fail(`could not list code-scanning alerts for ${ref} (${r.err}).`);
  } else {
    alerts = Array.isArray(r.data) ? r.data : [];
  }
}

/* ---- 1. zero alerts on an unanalysed ref is not "clean" ---- */

if (slug && ref && analyses.length === 0) {
  fail(
    `code-scanning has never analysed ${ref}. That is NOT a clean result: an empty alert list ` +
      'from a ref nobody scanned is indistinguishable from a ref with no problems, and reading ' +
      'it as clean is exactly how 21 open alerts — 6 high — went unnoticed for a month. Push the ' +
      'branch, or open the PR, and let CodeQL run before trusting this gate.',
  );
} else if (analyses.length > 0) {
  const latest = analyses[0];
  notes.push(
    `latest analysis ${latest.created_at} on ${refKind} — ${latest.rules_count} rule(s), ` +
      `${latest.results_count} result(s), tool ${latest.tool?.name ?? '?'} ${latest.tool?.version ?? ''}`,
  );
}

/* ---- 2 & 3. triage ---- */

const severity = (a) => a.rule?.security_severity_level ?? a.rule?.severity ?? 'unknown';
const key = (a) => `${a.rule?.id}:${a.most_recent_instance?.location?.path}`;

const blocking = alerts.filter((a) => BLOCKING.includes(severity(a)));
for (const a of blocking) {
  fail(
    `${severity(a)} code-scanning alert ${a.rule?.id} at ` +
      `${a.most_recent_instance?.location?.path}:${a.most_recent_instance?.location?.start_line} — ` +
      `${(a.most_recent_instance?.message?.text ?? '').slice(0, 140)}. high and critical are not ` +
      'allowlistable: fix it, or dismiss it in the Security tab with a reason so the dismissal is ' +
      'itself reviewable.',
  );
}

const rest = alerts.filter((a) => !BLOCKING.includes(severity(a)));
for (const a of rest) {
  const k = key(a);
  const entry = accepted[k] ?? accepted[a.rule?.id];
  if (!entry) {
    fail(
      `${severity(a)} code-scanning alert ${a.rule?.id} at ${a.most_recent_instance?.location?.path}` +
        `:${a.most_recent_instance?.location?.start_line} has no entry in ` +
        `.ai/state/supply-chain-allowlist.json under "codeScanning". Fix it, or accept it with a ` +
        `reason and an expiry keyed "${k}".`,
    );
    continue;
  }
  if (!entry.reason || !entry.expires) {
    fail(`the "codeScanning" entry for ${k} needs both "reason" and "expires" (YYYY-MM-DD).`);
    continue;
  }
  if (entry.expires < today) {
    fail(`the "codeScanning" acceptance of ${k} expired on ${entry.expires} (today is ${today}).`);
    continue;
  }
  notes.push(`${a.rule?.id} accepted until ${entry.expires}: ${entry.reason.slice(0, 100)}`);
}

// An acceptance for an alert that no longer exists is stale reassurance.
const liveKeys = new Set([...alerts.map(key), ...alerts.map((a) => a.rule?.id)]);
for (const k of Object.keys(accepted)) {
  if (!liveKeys.has(k)) {
    fail(
      `"codeScanning" accepts ${k}, but no open alert matches it. Remove the entry — a standing ` +
        'acceptance of a fixed finding reads as coverage it does not provide.',
    );
  }
}

/* ------------------------------------------------------------------- report ---- */

const bySeverity = {};
for (const a of alerts) bySeverity[severity(a)] = (bySeverity[severity(a)] ?? 0) + 1;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok: problems.length === 0,
        today,
        repository: slug,
        ref,
        refKind,
        analyses: analyses.length,
        openAlerts: alerts.length,
        bySeverity,
        problems,
        notes,
      },
      null,
      2,
    ),
  );
  process.exit(problems.length ? 1 : 0);
}

console.log('\nCode scanning (CodeQL)\n');
console.log(`  repository   ${slug ?? '(unknown)'}`);
console.log(`  ref          ${ref ?? '(unresolved)'}   [${refKind ?? '-'}]`);
console.log(`  analyses     ${analyses.length}`);
console.log(
  `  open alerts  ${alerts.length}` +
    (alerts.length
      ? `  (${Object.entries(bySeverity)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')})`
      : ''),
);
for (const n of notes) console.log(`\n  - ${n}`);

if (problems.length) {
  console.error(`\ncode-scanning: FAIL — ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}
console.log('\ncode-scanning: pass — the ref was analysed, and no alert is unaccounted for.');
