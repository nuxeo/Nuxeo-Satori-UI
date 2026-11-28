#!/usr/bin/env node
/**
 * Refuse to publish an app definition package unless a person approved this run: the check that
 * `app-packages.yml`'s `publish` job runs first (docs/business-apps/package-pipeline.md, 9.2).
 *
 * `publish` names the GitHub environment `marketplace-preprod`, so GitHub holds the job until a
 * reviewer that environment requires approves it. That holds only while the environment is set so.
 * GitHub creates an environment a job names, if it has none of that name, with no protection rule,
 * and then runs the job at once. An administrator may bypass the rules, and an environment that does
 * not prevent self-review lets whoever pushed the tag approve it. In each case the `environment:`
 * line reads as an approval that no one else gave.
 *
 * So this asks GitHub not how the environment is set but what happened to this run: the run's review
 * history, `GET /repos/{repository}/actions/runs/{run}/approvals`. It refuses unless:
 *
 * - an approval of this run names the environment;
 * - it was given by a person, not a bot;
 * - and that person is neither who started the run (`GITHUB_ACTOR`, who pushed the tag) nor who
 *   started this attempt (`GITHUB_TRIGGERING_ACTOR`, who re-ran it).
 *
 * An environment with no reviewer leaves no approval, so it is refused whatever its settings say.
 * Whether GitHub records an administrator's bypass in this history is not established: if it does
 * not, a bypass is refused; if it does, it counts as an approval by that administrator, refused
 * when they are the run's own. The history is the run's, not the attempt's, so an approval of an
 * earlier attempt of the same run, which is the same tag and the same bytes, holds for a re-run.
 *
 * The review history is read from the public REST API without a token, so the job's permissions
 * stay `contents: read`. It answers for a public repository, 60 times an hour per address. If it
 * cannot be read, or the repository is private, the answer is a refusal: nothing is published on an
 * approval nobody could see.
 *
 * It runs unconditionally, with no "was I started directly?" guard: one that misfired would exit 0
 * having checked nothing, and the job publishes on that exit code. Its controls run it as the
 * workflow does, with `--approvals-json` in place of GitHub (app-package-signature.selftest.mjs).
 *
 * Usage: node scripts/app-package-approval.mjs --environment <name> [--approvals-json <file>]
 *   with GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_ACTOR and GITHUB_TRIGGERING_ACTOR as a run sets them
 * Exit: 0 a person other than the run's own approved it; 1 refused, with each reason; 2 the command
 *   or the run's environment was wrong.
 */
import { appendFileSync, readFileSync } from 'node:fs';

const USAGE =
  'usage: node scripts/app-package-approval.mjs --environment <name> [--approvals-json <file>]';

function parse(argv, env) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--environment', '--approvals-json'].includes(flag))
      return { error: `${flag} is not an option.` };
    if (value === undefined || value === '' || value.startsWith('--'))
      return { error: `${flag} has no value.` };
    if (options[flag.slice(2)] !== undefined) return { error: `${flag} is given twice.` };
    options[flag.slice(2)] = value;
  }
  if (!options.environment) return { error: '--environment is required.' };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? ''))
    return { error: 'GITHUB_REPOSITORY must name owner/name.' };
  if (!/^\d+$/.test(env.GITHUB_RUN_ID ?? '')) return { error: 'GITHUB_RUN_ID must be a run id.' };
  if (!env.GITHUB_ACTOR) return { error: 'GITHUB_ACTOR must name who started the run.' };
  return { options };
}

/** Why this run's reviews do not show that a person other than its own approved it. */
function judge(reviews, { environment, actors }) {
  if (!Array.isArray(reviews))
    return {
      problems: [
        `GitHub's review history of this run is not a list${reviews?.message ? ` (GitHub: ${reviews.message})` : ''}`,
      ],
      approvers: [],
    };
  const forHere = reviews.filter(
    (review) =>
      Array.isArray(review?.environments) &&
      review.environments.some((each) => each?.name === environment),
  );
  const problems = [];
  const approvals = forHere.filter((review) => review.state === 'approved');
  const approvers = approvals
    .filter((review) => review.user?.type === 'User' && typeof review.user?.login === 'string')
    .map((review) => review.user.login)
    .filter((login) => !actors.some((actor) => actor.toLowerCase() === login.toLowerCase()));
  if (approvals.length === 0)
    problems.push(
      `nobody approved this run for ${environment}: the environment requires no reviewer, or the run went through without one`,
    );
  else if (approvers.length === 0)
    problems.push(
      `this run was approved for ${environment} only by ${approvals
        .map(
          (review) =>
            `${review.user?.login ?? 'someone unnamed'} (${review.user?.type ?? 'of no known kind'})`,
        )
        .join(', ')}: a bot, or whoever started the run, and not another person`,
    );
  return { problems, approvers };
}

async function reviewsOf(options, env) {
  if (options['approvals-json']) return JSON.parse(readFileSync(options['approvals-json'], 'utf8'));
  const url = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/approvals`;
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      `GitHub answered ${response.status} for ${url}: ${body?.message ?? 'no message'}`,
    );
  return body;
}

function refuse(lines) {
  for (const line of lines) console.error(`::error title=Not published::${line}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `**Not published.** ${lines.join('; ')}. What an administrator sets is in ` +
        'docs/business-apps/package-pipeline.md, section 9.2.\n',
    );
  return 1;
}

async function main(argv, env) {
  const { options, error } = parse(argv, env);
  if (error) {
    console.error(`${error}\n${USAGE}`);
    return 2;
  }
  let reviews;
  try {
    reviews = await reviewsOf(options, env);
  } catch (failure) {
    return refuse([
      `this run's approvals could not be read, so nothing is published: ${failure instanceof Error ? failure.message : String(failure)}`,
    ]);
  }
  const actors = [...new Set([env.GITHUB_ACTOR, env.GITHUB_TRIGGERING_ACTOR].filter(Boolean))];
  const { problems, approvers } = judge(reviews, { environment: options.environment, actors });
  if (problems.length) return refuse(problems);
  console.log(
    `Run ${env.GITHUB_RUN_ID} was approved for ${options.environment} by ${approvers.join(', ')}, ` +
      `not by ${actors.join(' or ')}, who started it.`,
  );
  return 0;
}

process.exit(await main(process.argv.slice(2), process.env));
