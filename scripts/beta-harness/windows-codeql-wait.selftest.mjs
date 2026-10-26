import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { load } from 'js-yaml';

// Execute the actual workflow step against an API stand-in. No GitHub calls or real waits.
const workflow = load(
  readFileSync(new URL('../../.github/workflows/windows-gate.yml', import.meta.url), 'utf8'),
);
const script = workflow.jobs['windows-gate'].steps.find((step) => step.id === 'wait-codeql').with
  .script;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const execute = new AsyncFunction('github', 'context', 'core', 'Date', 'setTimeout', script);
const context = {
  repo: { owner: 'fixture', repo: 'fixture' },
  payload: { pull_request: { number: 436, head: { sha: 'head-sha' } } },
  sha: 'merge-sha',
  ref: 'refs/pull/436/merge',
  eventName: 'pull_request',
};
const success = {
  head_sha: 'head-sha',
  pull_requests: [{ number: 436 }],
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://example.invalid/codeql',
};
const analysis = { ref: context.ref, commit_sha: context.sha, tool: { name: 'CodeQL' } };

test('Windows verification and its CodeQL prerequisite run for the fixed Satori target', () => {
  const codeql = load(
    readFileSync(new URL('../../.github/workflows/codeql.yml', import.meta.url), 'utf8'),
  );
  for (const config of [workflow, codeql])
    assert.ok(config.on.pull_request.branches.includes('feature/nxsat-673-satori-1.0'));
});

test('all platform jobs use the repository-pinned runtime accepted by gate zero', () => {
  for (const job of Object.values(workflow.jobs)) {
    const setup = job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
    assert.equal(setup.with['node-version-file'], '.nvmrc');
    assert.equal(setup.with['node-version'], undefined);
  }
});

test('a clean Windows runner explicitly builds the bundle before the full gate', () => {
  const steps = workflow.jobs['windows-gate'].steps;
  const build = steps.findIndex((step) => step.run === 'npx nx build nuxeo-ui');
  const gate = steps.findIndex((step) => step.run === 'npm run beta:gate -- --phase windows-ci');
  assert.ok(build >= 0);
  assert.ok(gate > build);
});

function harness({ runs = () => [success], analyses = () => [analysis], event = context } = {}) {
  let now = 0;
  const calls = { runs: [], analyses: [], waits: 0 };
  const github = {
    rest: {
      actions: {
        listWorkflowRuns: async (query) => {
          calls.runs.push(query);
          return { data: { workflow_runs: runs(calls.runs.length) } };
        },
      },
      codeScanning: {
        listRecentAnalyses: async (query) => {
          calls.analyses.push(query);
          return { data: analyses(calls.analyses.length) };
        },
      },
    },
  };
  return {
    calls,
    run: () =>
      execute(github, event, { info: () => {} }, { now: () => now }, (callback, ms) => {
        calls.waits++;
        now += ms;
        callback();
      }),
  };
}

test('waits for the matching PR workflow and the analysis of its merge revision', async () => {
  const h = harness({
    runs: (attempt) => (attempt === 1 ? [] : [success]),
    analyses: (attempt) => [attempt === 1 ? { ...analysis, commit_sha: 'old-sha' } : analysis],
  });
  await h.run();
  assert.equal(h.calls.waits, 2);
  assert.equal(h.calls.runs[0].head_sha, 'head-sha');
  assert.equal(h.calls.runs[0].event, 'pull_request');
  assert.equal(h.calls.analyses[0].ref, 'refs/pull/436/merge');
});

test('no matching workflow is a bounded failure, never a clean result', async () => {
  const h = harness({ runs: () => [] });
  await assert.rejects(h.run(), /No completed CodeQL analysis.*within 15 minutes/);
  assert.equal(h.calls.waits, 60);
  assert.equal(h.calls.analyses.length, 0);
});

test('a successful run of an older head or a different PR cannot satisfy the wait', async () => {
  const h = harness({
    runs: () => [
      { ...success, head_sha: 'old-sha' },
      { ...success, pull_requests: [{ number: 999 }] },
    ],
  });
  await assert.rejects(h.run(), /No completed CodeQL analysis/);
  assert.equal(h.calls.analyses.length, 0);
});

test('a failed matching CodeQL run fails immediately', async () => {
  const h = harness({ runs: () => [{ ...success, conclusion: 'failure' }] });
  await assert.rejects(h.run(), /CodeQL ended with failure/);
  assert.equal(h.calls.waits, 0);
  assert.equal(h.calls.analyses.length, 0);
});

test('a different ref or a non-CodeQL analysis is insufficient', async () => {
  const h = harness({
    analyses: () => [
      { ...analysis, ref: 'refs/heads/main' },
      { ...analysis, tool: { name: 'another scanner' } },
    ],
  });
  await assert.rejects(h.run(), /No completed CodeQL analysis/);
});

test('push events require a matching branch workflow and branch revision', async () => {
  const event = {
    ...context,
    payload: {},
    ref: 'refs/heads/integration/nxsat-308',
    sha: 'branch-sha',
    eventName: 'push',
  };
  const h = harness({
    event,
    runs: (attempt) => [
      {
        ...success,
        head_sha: event.sha,
        head_branch: attempt === 1 ? 'main' : 'integration/nxsat-308',
      },
    ],
    analyses: () => [{ ...analysis, ref: event.ref, commit_sha: event.sha }],
  });
  await h.run();
  assert.equal(h.calls.waits, 1);
  assert.equal(h.calls.runs[0].head_sha, event.sha);
  assert.equal(h.calls.runs[0].event, 'push');
});
