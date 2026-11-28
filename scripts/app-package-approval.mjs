#!/usr/bin/env node
/**
 * Refuse to publish an app definition package unless a person had to approve it: the check that
 * `app-packages.yml`'s `publish` job runs before anything else (docs/business-apps/package-pipeline.md,
 * section 9.2).
 *
 * `publish` names the GitHub environment `marketplace-preprod`, so GitHub holds the job until a
 * reviewer that environment requires approves it. That holds only once an administrator has given
 * the environment its reviewers. Until then GitHub creates the environment the first time a job
 * names it, with no protection rule at all, and the job runs at once: the `environment:` line would
 * read as an approval that never happened. So the job asks GitHub how the environment it waited on
 * is set, and refuses unless:
 *
 * - it exists, under the name the job names;
 * - it requires reviewers, at least one;
 * - "Prevent self-review" is on, so whoever pushed the tag cannot approve their own publish;
 * - administrators cannot bypass it, so no approval is skipped.
 *
 * A deployment policy that lets any branch or tag deploy to it is reported, not refused: the
 * workflow's own condition already lets only an `app-package/*` tag reach `publish`.
 *
 * It reads the public REST API without a token, `GET /repos/{repository}/environments/{name}`,
 * which answers for a public repository, so the job's permissions stay `contents: read`. If GitHub
 * cannot be read, or the repository is private, the answer is a refusal: nothing is published on a
 * gate nobody could see. Unauthenticated reads are limited to 60 an hour per address.
 *
 * It runs unconditionally, with no "was I started directly?" guard: one that misfired would exit 0
 * having checked nothing, and the job publishes on that exit code. Its controls run it as the
 * workflow does, with `--environment-json` in place of GitHub (app-package-signature.selftest.mjs).
 *
 * Usage: node scripts/app-package-approval.mjs --environment <name>
 *          [--repository <owner/name>] [--environment-json <file>]
 * Exit: 0 a person had to approve; 1 refused, with each reason; 2 the command was wrong.
 */
import { appendFileSync, readFileSync } from 'node:fs';

const USAGE =
  'usage: node scripts/app-package-approval.mjs --environment <name> [--repository <owner/name>] [--environment-json <file>]';

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--environment', '--repository', '--environment-json'].includes(flag))
      return { error: `${flag} is not an option.` };
    if (value === undefined || value === '' || value.startsWith('--'))
      return { error: `${flag} has no value.` };
    if (options[flag.slice(2)] !== undefined) return { error: `${flag} is given twice.` };
    options[flag.slice(2)] = value;
  }
  if (!options.environment) return { error: '--environment is required.' };
  options.repository ??= process.env.GITHUB_REPOSITORY;
  if (
    !options['environment-json'] &&
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository ?? '')
  )
    return { error: '--repository, or GITHUB_REPOSITORY, must name owner/name.' };
  return { options };
}

/** Who a required-reviewers rule names, for the log. */
function reviewersOf(rule) {
  return (rule.reviewers ?? []).map((entry) =>
    entry.type === 'Team'
      ? `team ${entry.reviewer?.slug ?? entry.reviewer?.name ?? '?'}`
      : `user ${entry.reviewer?.login ?? '?'}`,
  );
}

/** What is wrong with the environment as GitHub described it, and what is only worth saying. */
function judge(environment, name) {
  const problems = [];
  const notes = [];
  if (!environment || typeof environment !== 'object' || environment.name !== name) {
    problems.push(
      `the environment ${name} does not exist${environment?.message ? ` (GitHub: ${environment.message})` : ''}, ` +
        'so GitHub would create it for this job with no protection rule',
    );
    return { problems, notes, reviewers: [] };
  }
  const rules = Array.isArray(environment.protection_rules) ? environment.protection_rules : [];
  const review = rules.find((rule) => rule?.type === 'required_reviewers');
  const reviewers = review ? reviewersOf(review) : [];
  if (!review || reviewers.length === 0)
    problems.push(`${name} requires no reviewer, so nobody approved this publish`);
  else if (review.prevent_self_review !== true)
    problems.push(
      `${name} does not prevent self-review, so whoever pushed the tag could approve their own publish`,
    );
  if (environment.can_admins_bypass !== false)
    problems.push(
      `${name} lets administrators bypass its rules, so a publish could skip the approval`,
    );
  if (!environment.deployment_branch_policy)
    notes.push(
      `${name} lets any branch or tag deploy to it; this workflow's own condition lets only an app-package tag reach publish`,
    );
  return { problems, notes, reviewers };
}

async function environmentOf(options) {
  if (options['environment-json'])
    return JSON.parse(readFileSync(options['environment-json'], 'utf8'));
  const url = `https://api.github.com/repos/${options.repository}/environments/${encodeURIComponent(options.environment)}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 404) return { message: body.message ?? 'Not Found' };
  if (!response.ok)
    throw new Error(
      `GitHub answered ${response.status} for ${url}: ${body.message ?? 'no message'}`,
    );
  return body;
}

function refuse(lines) {
  for (const line of lines) console.error(`::error title=Not published::${line}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `**Not published.** ${lines.join('; ')}. An administrator sets the environment as ` +
        'docs/business-apps/package-pipeline.md, section 9.2, says.\n',
    );
  return 1;
}

async function main(argv) {
  const { options, error } = parse(argv);
  if (error) {
    console.error(`${error}\n${USAGE}`);
    return 2;
  }
  let environment;
  try {
    environment = await environmentOf(options);
  } catch (failure) {
    return refuse([
      `how ${options.environment} is set could not be read, so nothing is published: ${failure instanceof Error ? failure.message : String(failure)}`,
    ]);
  }
  const { problems, notes, reviewers } = judge(environment, options.environment);
  for (const note of notes) console.log(`::notice title=Approval gate::${note}`);
  if (problems.length) return refuse(problems);
  console.log(
    `${options.environment} held this job for an approval: reviewers ${reviewers.join(', ')}, ` +
      'self-review prevented, no administrator bypass.',
  );
  return 0;
}

process.exit(await main(process.argv.slice(2)));
