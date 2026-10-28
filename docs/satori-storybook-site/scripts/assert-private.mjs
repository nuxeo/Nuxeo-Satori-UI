#!/usr/bin/env node
/**
 * Refuses to publish unless this repository is private **and** its Pages site is not public.
 *
 * The mirror image of the public repository's `scripts/storybook-publication-gate.mjs`. That gate
 * answers "does this build carry Satori?" and fails when it does. This one answers "is the place
 * we are about to put it actually closed?" and fails when it is not — because here the build
 * deliberately *does* carry Satori: compiled `@hylandsoftware` modules, `--sat-*` tokens and
 * Satori's fonts, which we may consume but not redistribute.
 *
 * The failure it exists for is silent and total: somebody flips this repository to public, or
 * resets Pages visibility, and the next scheduled run quietly publishes licensed third-party
 * assets to the open internet. Nothing else in the pipeline would notice.
 *
 * Fails closed. Anything it cannot establish — a non-200, an absent field, no token, Pages not
 * configured — is a failure, never a pass. "Nothing was checked" is not "nothing was wrong".
 *
 * Usage:  node scripts/assert-private.mjs <owner/repo>
 * Exit 0 both private, 1 something is public or unverifiable, 2 bad usage.
 *
 * Needs GITHUB_TOKEN with `contents: read` (repo) and `pages: read` (Pages config).
 * Controls in `assert-private.selftest.mjs`; run them before trusting a green result.
 */

const API_VERSION = '2022-11-28';

/**
 * The two questions, asked of whatever `fetchJson` answers with. Pure, so the self-test can drive
 * it through fabricated responses without a network or a repository.
 *
 * @param {string} repo `owner/name`
 * @param {(path: string) => Promise<{ ok: boolean, status: number, body?: unknown }>} fetchJson
 * @returns {Promise<{ problems: string[], checked: string[] }>}
 */
export async function checkPrivacy(repo, fetchJson) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const checked = [];

  const repoPath = `/repos/${repo}`;
  const repoResponse = await fetchJson(repoPath);
  if (!repoResponse.ok) {
    problems.push(
      `GET ${repoPath} returned ${repoResponse.status}, so this repository's visibility is ` +
        'unknown. Treated as a failure: an unanswerable question is not a pass.',
    );
  } else if (typeof readField(repoResponse.body, 'private') !== 'boolean') {
    problems.push(
      `GET ${repoPath} answered without a boolean "private" field. The API shape this guard ` +
        'reads has changed; fix the guard rather than skipping it.',
    );
  } else if (readField(repoResponse.body, 'private') !== true) {
    problems.push(
      `${repo} is PUBLIC. A Pages site built from it is readable by anyone, and this build ` +
        'carries licensed Satori assets. Make the repository private, or stop publishing it.',
    );
  } else {
    checked.push(`${repo} is private`);
  }

  const pagesPath = `/repos/${repo}/pages`;
  const pagesResponse = await fetchJson(pagesPath);
  if (pagesResponse.status === 404) {
    problems.push(
      `GET ${pagesPath} returned 404: no Pages site is configured, so its visibility cannot be ` +
        'checked. Enable Pages with source "GitHub Actions" and visibility "Private" first.',
    );
  } else if (!pagesResponse.ok) {
    problems.push(
      `GET ${pagesPath} returned ${pagesResponse.status}, so the Pages site's visibility is ` +
        'unknown. The job token needs `pages: read`. Treated as a failure.',
    );
  } else if (typeof readField(pagesResponse.body, 'public') !== 'boolean') {
    problems.push(
      `GET ${pagesPath} answered without a boolean "public" field. That field is what access ` +
        'control shows up as; fix the guard rather than skipping it.',
    );
  } else if (readField(pagesResponse.body, 'public') !== false) {
    problems.push(
      `The Pages site of ${repo} is PUBLIC ("public": true). Access control is off, so the ` +
        'site serves to anyone. Settings → Pages → Visibility → Private.',
    );
  } else {
    checked.push(`the Pages site of ${repo} is not public`);
  }

  return { problems, checked };
}

/** @param {unknown} body @param {string} field */
function readField(body, field) {
  if (typeof body !== 'object' || body === null) return undefined;
  return /** @type {Record<string, unknown>} */ (body)[field];
}

/**
 * The real fetcher. Separated from `checkPrivacy` so the controls never reach the network.
 * @param {string} path
 */
async function githubFetch(path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, status: 0, body: undefined };
  const base = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  try {
    const response = await fetch(`${base}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': API_VERSION,
        'user-agent': 'satori-storybook-privacy-guard',
      },
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    console.error(`assert-private: ${path} could not be reached — ${error}`);
    return { ok: false, status: 0, body: undefined };
  }
}

// Only when run as a command, so importing this file for the controls has no side effect.
if (import.meta.filename === process.argv[1]) {
  const repo = process.argv[2] ?? process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    console.error('Usage: node scripts/assert-private.mjs <owner/repo>');
    process.exit(2);
  }
  if (!process.env.GITHUB_TOKEN) {
    console.error(
      'assert-private: GITHUB_TOKEN is not set, so nothing could be checked. That is a failure, ' +
        'not a pass.',
    );
    process.exit(1);
  }

  const { problems, checked } = await checkPrivacy(repo, githubFetch);
  for (const line of checked) console.log(`  ok: ${line}`);
  if (problems.length > 0) {
    for (const line of problems) console.error(`\n  [FAIL] ${line}`);
    console.error(
      '\nassert-private: FAIL — this build carries Satori and the destination is not provably ' +
        'closed. Nothing was published.',
    );
    process.exit(1);
  }
  console.log('assert-private: PASS — repository private, Pages site not public.');
}
