#!/usr/bin/env node
/**
 * Harvest what the PR reviewer caught, and why we did not catch it first.
 *
 *   node scripts/pr-review-analysis.mjs harvest <pr> [<pr> …]   # -> a JSONL to classify
 *   node scripts/pr-review-analysis.mjs publish <file.jsonl>    # -> appends to Confluence
 *
 * ## What this is for
 *
 * Every review comment that lands on a pull request is a defect the authoring agent shipped
 * and the reviewing agent caught. That gap is the interesting thing: not the individual bug,
 * but the *class* of bug and the reason it was invisible from the inside. Forty-odd of them
 * in one week is enough to see the shape, and the shape is what a pre-PR review skill has to
 * be built from — otherwise it is a list of somebody's habits.
 *
 * So the harvest is mechanical and the classification is not. `harvest` pulls every Copilot
 * finding with its file, line and body and leaves two fields blank; a human or an agent fills
 * them in, judging one comment at a time; `publish` appends the result.
 *
 * "Every" means all three places GitHub puts reviewer feedback — inline review threads, the
 * review **summary body**, and PR **conversation** comments. It used to mean only the first,
 * which on PR #182 harvested 2 rows out of 5 findings: the summary body's verdict and the
 * three findings Copilot had folded into its "Suppressed comments" block were all dropped,
 * and the class counts this page exists to produce were wrong by 60%.
 *
 * ## The two fields that matter
 *
 * `category`   the defect class, from the fixed list below — free text makes rows
 *              incomparable, and an incomparable table cannot tell you what to automate.
 * `whyMissed`  why the author did not see it. This is the column the skill gets built from.
 *              "Careless" is never the answer; if it were, the fix would be "be careful",
 *              which has never worked. Look for the structural reason: a claim nobody
 *              re-read after the code changed, a guarantee asserted in prose and not in
 *              code, a check that tested a proxy for the thing it named.
 */

import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { EVIDENCE_ROOT } from './collect-evidence/evidence-path.mjs';

/**
 * The defect classes, fixed on purpose.
 *
 * Derived from the first batch rather than invented up front: each one is a pattern that
 * recurred, and each suggests a different kind of pre-PR check. A class nothing falls into is
 * worth adding; a class everything falls into is worth splitting.
 */
export const CATEGORIES = {
  'stale-prose':
    'Code changed; a comment, header, table or doc describing the old behaviour survived nearby',
  'unenforced-guarantee':
    'The prose promises something the code does not enforce, or allows a caller to contradict',
  'silent-failure':
    'An error path is swallowed — a bare `curl -s`, a `.catch(() => {})`, an exit 0 on failure',
  'proxy-check':
    'The check tests something adjacent to its name: connected for visible, a phase opened for a phase finished',
  ordering:
    'Right steps, wrong order — a guard after the side effect, a cleanup before the thing that needs it',
  'incomplete-fetch':
    'Only part of the data is read: unpaginated, first page only, one source of several',
  'broken-reference': 'A link, path or id that does not resolve',
  'false-claim': 'The PR body, changelog or docs assert something the diff does not do',
  'dead-branch': 'Code that cannot execute, or a condition that cannot fire',
  scope: 'Unrelated change bundled in, or a change the title does not mention',
  other: 'Does not fit above — if this grows, add a class',
};

const PAGE_ID = process.env['PR_ANALYSIS_PAGE_ID'] ?? '4301586839';
const CONFLUENCE = process.env['AGENT_METRICS_CONFLUENCE'] ?? 'https://hyland.atlassian.net/wiki';
const REPO = process.env['PR_ANALYSIS_REPO'] ?? 'nuxeo/agentic-ui-poc';
const OUT_DIR = resolve(EVIDENCE_ROOT, 'pr-review-analysis');

/**
 * The corpus lives on the Confluence page, and **only** there.
 *
 * It used to be committed as `docs/pr-review-findings.jsonl`, with the skill's counts generated
 * from it, on the argument that something a skill's content depends on has to travel with a
 * clone. What that bought in practice was four files of churn on every unrelated pull request —
 * the JSONL plus the regenerated skill and its two mirrors — because `publish` ran inside the
 * review loop and the `review-corpus` gate then demanded they be committed with the fix. A
 * two-line accessibility fix carried four files of review bookkeeping.
 *
 * It did not even buy freshness. Measured before this change: the page held 67 findings across
 * eight pull requests while the committed copy held 59 across six, because the missing rows were
 * sitting in the open PRs that had produced them. The repository copy was the stale one, so the
 * duplicate cost churn and lost the argument it was there to win.
 *
 * So the page is the record and the skill points at it. The skill keeps what does not go stale —
 * the defect classes and the four comparisons — and quotes no figure. `stats` fetches the
 * distribution on demand; `check-order` compares the skill's section ordering against the page's
 * ranking. Neither writes to the repository, and nothing here is a gate: both need Confluence
 * credentials, which CI does not have and has never had.
 */
const SKILL = resolve(repoRoot(), '.cursor/skills/pre-pr-review/SKILL.md');

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/** Basic auth for the Confluence API, or exit with the reason. */
function confluenceAuth() {
  const email = readIf(`${homedir()}/.jira_email`);
  const token = readIf(`${homedir()}/.jira_token`);
  if (!email || !token) {
    console.error('\n~/.jira_email and ~/.jira_token are required to reach the analysis page.\n');
    process.exit(1);
  }
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

/** The analysis page's storage body, or exit. */
async function readPage(auth) {
  const get = await fetch(`${CONFLUENCE}/api/v2/pages/${PAGE_ID}?body-format=storage`, {
    headers: { Authorization: auth, Accept: 'application/json' },
  });
  if (!get.ok) {
    console.error(`Could not read the analysis page (HTTP ${get.status}).`);
    process.exit(1);
  }
  const page = await get.json();
  return { page, storage: page.body?.storage?.value ?? '' };
}

/**
 * The findings table on the page, parsed back into rows.
 *
 * Scoped to the `<h2>Findings</h2>` table on purpose: the page carries three other tables — the
 * defect-class glossary and two prose tables — and counting classes across all of them would
 * score the glossary as one finding per class. The header row is dropped by requiring `<td>`
 * cells, which a `<th>` row has none of.
 *
 * Exits rather than returning `[]` when the table cannot be found. Zero findings and "I could
 * not read the table" are the same output otherwise, and a distribution that silently reads as
 * empty is the `silent-failure` class this page exists to record.
 */
function findingsOnPage(storage) {
  const heading = storage.indexOf('<h2>Findings</h2>');
  const close = heading === -1 ? -1 : storage.indexOf('</tbody>', heading);
  if (close === -1) {
    console.error('\nNo <h2>Findings</h2> heading with a table below it. Re-seed the page.\n');
    process.exit(1);
  }
  const table = storage.slice(heading, close);
  const rows = [];
  for (const tr of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td><p>([\s\S]*?)<\/p><\/td>/g)].map((m) => m[1]);
    // PR, file, finding, class, why-missed — the five `publish` writes. A row of any other
    // width is not a finding row, so it is skipped rather than counted into a wrong column.
    if (cells.length !== 5) continue;
    rows.push({ pr: cells[0], category: cells[3] });
  }
  if (!rows.length) {
    console.error('\nThe Findings table parsed to zero rows. Has its column layout changed?\n');
    process.exit(1);
  }
  return rows;
}

/** Classes by descending count, ties broken by name — the ranking the skill's order claims. */
function ranking(rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/** The reviewer this page is about. Everything else on a PR is somebody's opinion, not a finding. */
const REVIEWER = /copilot/i;

/**
 * A summary body that reports **no** findings.
 *
 * Observed forms, not guessed: PR #178's reviews say "Approval recommended" and
 * "Comments generated: 0". Anything unrecognised is still treated as a finding — an
 * unfamiliar verdict should be read by a person, not silently dropped — so this list is an
 * allow-list of known-clean shapes and can only shrink the false-positive side.
 */
const CLEAN_VERDICT = /approval recommended|no issues found|comments generated:\s*0\b/i;

/**
 * One page of a PR connection, paginated. `--paginate` advances `$endCursor`, and `gh` emits
 * one JSON document per page, so the result is one row per line rather than one array.
 */
function paginate(pr, connection, jq) {
  const [owner, name] = REPO.split('/');
  return gh([
    'api',
    'graphql',
    '--paginate',
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
    '-F',
    `number=${pr}`,
    '-f',
    `query=query($owner:String!,$name:String!,$number:Int!,$endCursor:String){
      repository(owner:$owner,name:$name){pullRequest(number:$number){
        title
        ${connection}
      }}}`,
    '--jq',
    `.data.repository.pullRequest as $pr | ${jq}`,
  ])
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/**
 * Remove a markup construct completely — including the openers a single pass leaves behind.
 *
 * One `.replace(/<!--[\s\S]*?-->/g, '')` is not a strip, it is one pass, and a pass only
 * removes balanced pairs of the one spelling it knows. Measured on nine inputs, one pass left
 * markup in six of them:
 *
 *     "<!--a-->b<!--c"                     -> "b<!--c"
 *     "x-->y"                              -> "x-->y"
 *     "<!-- x --!>"                        -> "<!-- x --!>"
 *     "<details>a</details></details>tail" -> "</details>tail"
 *     "<details open>a</details>tail"      -> "<details open>a</details>tail"
 *
 * CodeQL calls the class `js/incomplete-multi-character-sanitization` and flagged both call
 * sites in this file. Nothing was injectable — every cell is escaped by `esc` before it
 * reaches the page — but the strip was wrong for its own purpose: these functions exist to
 * skip markup, and an incomplete strip makes them return a fragment of it as the finding.
 *
 * So: replace to a fixed point, **then** drop any unbalanced marker. The second step is the
 * one that matters here; the loop alone cannot help, because an odd `<!--` or `-->` never
 * matches a pair however many times you look. Both steps leave markup-free text untouched.
 */
function stripAll(text, pattern, marker) {
  let out = String(text ?? '');
  let previous;
  do {
    previous = out;
    out = out.replace(pattern, '');
  } while (out !== previous);
  return out.replace(marker, '');
}

// `--!>` closes a comment as well as `-->`: HTML's comment-end-bang state accepts it, so
// browsers treat `<!-- x --!>` as a complete comment and so must anything claiming to strip
// one. Missing it left ` x --!>` in the text — CodeQL alert 40, js/bad-tag-filter.
const HTML_COMMENT = /<!--[\s\S]*?--!?>\n?/g;
const HTML_COMMENT_MARKER = /<!--|--!?>/g;
// Tolerant of attributes, spacing and case, so `<details open>` and `</Details >` are the
// same block boundary as `<details>`. The literal form matched neither.
const DETAILS_BLOCK = /<details\b[^>]*>[\s\S]*?<\/details\s*>/gi;
const DETAILS_MARKER = /<\/?details\b[^>]*>/gi;

/**
 * Escape a value for Confluence storage XHTML, in **text or an attribute**.
 *
 * `"` and `'` are here because one of these values is interpolated into `<a href="…">`, and
 * escaping only `&<>` left the quote that terminates the attribute intact. A finding URL
 * containing `#" onmouseover="…` closed `href` and opened an event handler on a page other
 * people read — CodeQL alert 37. Escaping the quotes in the shared helper rather than at the
 * one call site means the next attribute added to this table is safe without anyone
 * remembering why.
 *
 * Declared **above** `if (isCli)` on purpose. As a `const` below it, the map was in its
 * temporal dead zone while the `publish` branch ran, so the first `esc` call threw
 * `ReferenceError: Cannot access 'HTML_ESCAPES' before initialization` — a crash on every
 * successful publish, reachable only past the credential check and therefore invisible to
 * every gate.
 */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * The one line that identifies a finding in a table.
 *
 * Not simply line one of the body. A review summary body opens with a `###` verdict heading
 * and folds its detail into `<details>` blocks, so line one is "### Changes recommended",
 * which distinguishes nothing; a bot summary can open with an HTML comment marker. Headings,
 * quotes, rules and collapsed blocks are skipped and the first real prose line is used.
 *
 * The fallback is the whole body squashed, never the empty string: a row that describes its
 * finding badly can be read and fixed, and a row silently dropped for having an unusual body
 * cannot.
 */
function findingLine(body) {
  const stripped = stripAll(
    stripAll(body, HTML_COMMENT, HTML_COMMENT_MARKER),
    DETAILS_BLOCK,
    DETAILS_MARKER,
  );
  for (const line of stripped.split('\n')) {
    const text = line.replace(/\s+/g, ' ').trim();
    if (!text || text.startsWith('#') || text.startsWith('>') || /^[-*_]{3,}$/.test(text)) continue;
    return text.slice(0, 220);
  }
  return String(body ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

/**
 * The findings Copilot folds into a review body's "Suppressed comments" block.
 *
 * These are real findings — three of the five on PR #182 were here, and all three were valid
 * defects — but they are prose inside the summary body rather than threads, so nothing that
 * reads `reviewThreads` can see them. The shape is a bolded `path:line` followed by bullets:
 *
 *     **scripts/pr-review-analysis.mjs:162**
 *     * Indexing a normal object does not reliably reject unknown classes…
 *
 * Parsing a bot's markdown is brittle by nature, so this is **additive and self-healing**: if
 * the shape changes and nothing matches, `harvestPr` records the body as a single row instead,
 * and the finding is under-described rather than silently absent.
 */
function suppressedFindings(body) {
  const found = [];
  const text = String(body ?? '');
  const block = /\*\*([^*\n]+?):(\d+)\*\*\s*\n((?:\s*[*-] .*\n?)+)/g;
  for (const match of text.matchAll(block)) {
    found.push({
      file: match[1].trim(),
      line: Number(match[2]),
      finding: findingLine(match[3].replace(/^\s*[*-] /m, '')),
    });
  }
  return found;
}

/** The characters outside `<…>`; no angle bracket survives, however the markup nests. */
function textOutsideTags(html) {
  let text = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) text += ch;
  }
  return text;
}

/**
 * The findings in a review body's "Previously missed (N)" block — defects Copilot found on a
 * later pass in code that had not changed since its last review.
 *
 * They are not threads, so `reviewThreads` never sees them, and they arrive in reviews that also
 * carry ordinary threads, which is exactly when the summary body is skipped as a restatement. So
 * before this parser they were dropped twice over: absent from the record, and absent from
 * `roundFindings`, which let a round whose only findings were previously missed read clean.
 * Ten of #333's sixteen Copilot reviews carry one, holding 38 findings the harvest had never
 * recorded.
 *
 * The shape, from review 5454141630 on #333
 * (`scripts/fixtures/copilot-review-previously-missed.txt`):
 *
 *     <summary><strong>Previously missed (4)</strong></summary>
 *     In code that hasn't changed since last review
 *     <details>
 *     <summary><picture>…</picture> Missing --root causes exit 1 instead of documented exit 2</summary>
 *     `scripts/beta-harness/dependency-tree.mjs:131`
 *     The documented exit-code contract is not honored …
 *     </details>
 *
 * The path carries zero-width spaces after each `/`, which are removed. If fewer entries parse
 * than the heading declares, the shortfall is recorded as one row naming it, so a change of shape
 * under-describes findings rather than silently losing them.
 */
export function previouslyMissedFindings(body) {
  const text = String(body ?? '');
  const heading = /Previously missed \((\d+)\)/.exec(text);
  if (!heading) return [];
  const declared = Number(heading[1]);
  const section = text.slice(heading.index + heading[0].length);
  // Neither lazy group may cross a `<details` boundary, or one malformed entry would swallow the
  // next and report two findings as one under the wrong title.
  const inside = '((?:(?!</?details\\b)[\\s\\S])*?)';
  const entry = new RegExp(
    `<details\\b[^>]*>\\s*<summary\\b[^>]*>${inside}</summary\\s*>\\s*\`([^\`\\n]+?):(\\d+)\`\\s*${inside}</details\\s*>`,
    'gi',
  );
  const found = [];
  for (const match of section.matchAll(entry)) {
    if (found.length === declared) break;
    const title = textOutsideTags(match[1]).replace(/\s+/g, ' ').trim();
    found.push({
      file: match[2].replace(/[\u200b-\u200d\u2060\ufeff]/g, '').trim(),
      line: Number(match[3]),
      finding: (title || findingLine(match[4])).slice(0, 220),
    });
  }
  if (found.length < declared) {
    found.push({
      file: '(review summary)',
      line: null,
      finding:
        `Previously missed (${declared}): ${declared - found.length} of them could not be ` +
        'parsed — read the review body.',
    });
  }
  return found;
}

/**
 * The rows one Copilot review **body** contributes, given whether the review already produced a
 * finding by another route (an inline thread).
 *
 * "Previously missed" entries are always counted: they are in code the threads do not cover, so
 * they never restate one. A plain summary verdict earns a row only when nothing else did and it
 * is not an approval — see the comment at the call site in `harvestPr` for why both halves of
 * that test exist.
 * @param {string} body
 * @param {boolean} hasOtherFindings
 */
export function reviewBodyItems(body, hasOtherFindings) {
  const listed = [...suppressedFindings(body), ...previouslyMissedFindings(body)];
  if (listed.length) return listed;
  if (hasOtherFindings || CLEAN_VERDICT.test(body)) return [];
  return [{ file: '(review summary)', line: null, finding: findingLine(body) }];
}

/**
 * Resolve a review id for a command that filters by it, or exit 3 rather than let an id
 * matching nothing masquerade as an empty result.
 *
 * Both `round` and `harvest --review` narrow their output to one review, so for both of them
 * an unmatched id produces exactly what "nothing to report" produces. The skill hands the
 * same id to both, which means one mistyped or wrong-id-space argument silences the loop's
 * verdict and its record together.
 *
 * @param {string|string[]} prs the pull request(s) the id must belong to
 * @param {string} reviewId GraphQL node id or REST databaseId
 * @param {string} subject how to name the thing left unknown, e.g. 'The round'
 */
function requireReviewOnPr(prs, reviewId, subject) {
  const list = Array.isArray(prs) ? prs : [prs];
  let review = null;
  try {
    for (const pr of list) {
      review = reviewOnPr(pr, reviewId);
      if (review) break;
    }
  } catch (error) {
    console.error(
      `\nCould not read the reviews on #${list.join(', #')}: ${error.message.split('\n')[0]}`,
    );
    console.error(`${subject} is UNKNOWN, not clean.\n`);
    process.exit(3);
  }
  if (!review) {
    console.error(`\nNo review with id ${reviewId} on #${list.join(' or #')}.`);
    console.error(
      `${subject} is UNKNOWN, not clean: an id that matches no review filters every finding\n` +
        'away, and the empty result is indistinguishable from a review that found nothing.',
    );
    console.error(
      '\nPass the id `latest-review` prints — a GraphQL node id, `PRR_…`. The numeric REST\n' +
        '`databaseId` is accepted too; anything else is a wrong id, a stale one, or an id\n' +
        'belonging to a different pull request.\n',
    );
    process.exit(3);
  }
  if (!REVIEWER.test(review.author ?? '')) {
    console.error(`\nReview ${reviewId} is by ${review.author ?? 'an unknown user'}.`);
    console.error(
      `${subject} is UNKNOWN, not clean: this command reports the automated reviewer's\n` +
        'findings, so a human review would report zero of them and look clean.\n',
    );
    process.exit(3);
  }
  return review;
}

function row({ pr, prTitle, file, line, url, finding, resolved, source, reviewId = null }) {
  return {
    pr: Number(pr),
    prTitle,
    file,
    line,
    url,
    reviewId,
    // Enough to recognise the finding in a table; the URL has the rest.
    finding,
    resolved,
    source,
    category: '',
    whyMissed: '',
  };
}

/**
 * **Every** review on a PR, oldest first — human ones included, because the caller has to be
 * able to reject a human's review id explicitly rather than silently report zero findings for
 * it. `copilotReviews` is the filtered view.
 *
 * `fullDatabaseId` alongside `databaseId`: the schema types `databaseId` as a 32-bit `Int`,
 * which cannot hold a modern review id — 5204368759 is well past 2^31. In practice the API
 * returns it in full and unerrored today (verified against #184), so the numeric lookup worked
 * either way, but a field whose declared type contradicts its own values is not something to
 * depend on. `fullDatabaseId` is a `BigInt`, serialised as a string, and is preferred when
 * present; the comparison is string-based, so nothing has to survive a float.
 *
 * `gh` failing throws out of `execFileSync`, which is the point: this used to be
 * `copilot_reviews | tail -1` in a shell snippet, and without `pipefail` `tail` exits 0 when
 * the producer dies, so the snapshot id came back empty. An empty snapshot makes the *next*
 * poll treat the existing review as new, and the round reads clean without a review having
 * run. That is the third place in this loop where a pipeline turned an API failure into a
 * reassuring zero, which is the argument for the loop's state living here rather than in
 * shell.
 */
export function reviewsOnPr(pr) {
  return paginate(
    pr,
    `headRefOid
     reviews(first:50, after:$endCursor){
       pageInfo{ hasNextPage endCursor }
       nodes{ id databaseId fullDatabaseId author{ login } commit{ oid } } }`,
    '$pr.reviews.nodes[] | {head: $pr.headRefOid} + .',
  ).map((r) => ({
    id: r.id,
    databaseId: r.fullDatabaseId ?? r.databaseId ?? null,
    author: r.author?.login ?? null,
    commit: r.commit?.oid ?? null,
    head: r.head,
  }));
}

/** The Copilot reviews on a PR, oldest first. */
export function copilotReviews(pr) {
  return reviewsOnPr(pr).filter((r) => REVIEWER.test(r.author ?? ''));
}

/**
 * One review on `pr`, by either of the two ids GitHub gives it, or `null`.
 *
 * Both id spaces are accepted because both are in front of you: `latest-review` prints the
 * GraphQL node id, while the REST API and `gh api …/reviews` hand back the numeric
 * `databaseId`. They are not interchangeable, and `round` used to compare its argument against
 * node ids only — so a REST id matched nothing, filtered every finding away, and printed a
 * clean round. Verified on #184: the round-2 review reported one finding by node id and zero
 * by its own numeric id, from the same review.
 */
export function reviewOnPr(pr, reviewId) {
  const wanted = String(reviewId);
  return reviewsOnPr(pr).find((r) => r.id === wanted || String(r.databaseId) === wanted) ?? null;
}

/**
 * The newest Copilot review **of the current head**, or `null`.
 *
 * A review is tied to a commit, and the id alone does not say which. A review queued against
 * the previous head can submit after the snapshot was taken, and an id-only comparison accepts
 * it as this round's — so the round passes on a commit that was never reviewed, which is the
 * false-clean signal in its subtlest form yet. The commit has to match.
 */
export function latestReviewOfHead(pr) {
  const reviews = copilotReviews(pr);
  const head = reviews.length ? reviews[reviews.length - 1].head : null;
  const ofHead = reviews.filter((r) => r.commit && r.commit === head);
  return ofHead.length ? ofHead[ofHead.length - 1] : null;
}

/**
 * The findings attributable to one review — the number that decides whether a round is clean.
 *
 * Deliberately `harvestPr` filtered by review, not a second implementation. The clean-round
 * test and the harvest used to classify a review body differently: the shell test counted
 * only bold `path:line` entries, while `harvestPr` records a non-empty body with no threads
 * and no suppressed block as one finding. A body of that shape scored zero in the loop and
 * was harvested as a defect minutes later, so the loop could exit on something the record
 * then called a miss. One classifier, two callers, and they cannot drift.
 *
 * Resolved threads are excluded here — unlike `harvestPr`, which keeps them on purpose —
 * because a round asks "what is outstanding now", not "what did this PR ever cost".
 */
export function roundFindings(pr, reviewId) {
  return harvestPr(pr).filter((r) => r.reviewId === reviewId && r.resolved !== true);
}

/**
 * Every Copilot finding on a PR, resolved or not — a fixed one still happened.
 *
 * All three connections, because GitHub splits reviewer feedback across three and each is
 * actionable: inline `reviewThreads`, the `reviews` summary body (submitted as `COMMENTED`,
 * not `CHANGES_REQUESTED`, so it is easy to miss), and PR-level `comments`.
 */
export function harvestPr(pr) {
  const rows = [];
  const isReviewer = (login) => REVIEWER.test(login ?? '');
  /** Review ids that already contributed a finding of their own, by any route. */
  const reviewsWithFindings = new Set();

  for (const t of paginate(
    pr,
    `reviewThreads(first:50, after:$endCursor){
       pageInfo{ hasNextPage endCursor }
       nodes{ isResolved path line
         comments(first:1){ nodes{ author{ login } body url pullRequestReview{ id } } } } }`,
    '$pr.reviewThreads.nodes[] | {title: $pr.title} + .',
  )) {
    const c = t.comments.nodes[0];
    if (!c || !isReviewer(c.author?.login)) continue;
    if (c.pullRequestReview?.id) reviewsWithFindings.add(c.pullRequestReview.id);
    rows.push(
      row({
        pr,
        prTitle: t.title,
        file: t.path,
        line: t.line,
        url: c.url,
        finding: findingLine(c.body),
        resolved: t.isResolved,
        source: 'thread',
        reviewId: c.pullRequestReview?.id ?? null,
      }),
    );
  }

  for (const r of paginate(
    pr,
    `reviews(first:50, after:$endCursor){
       pageInfo{ hasNextPage endCursor }
       nodes{ id author{ login } body url } }`,
    '$pr.reviews.nodes[] | select(.body != "") | {title: $pr.title} + .',
  )) {
    if (!isReviewer(r.author?.login)) continue;
    // A summary verdict restates the findings under it, so it earns a row only when the review
    // contributed none by any other route *and* is not an approval.
    //
    // Two earlier versions of this test were wrong in opposite directions. Asking only whether
    // the *body* embedded a block, not whether the *review* already produced findings, harvested
    // a review with ordinary inline threads and a plain summary as every thread plus an extra
    // summary row — PR #180's first review is that shape. Then falling back to "any non-empty
    // body is a finding" turned an approval into a defect: PR #178's reviews say "Approval
    // recommended" and "Comments generated: 0", so `round` returned 1 for a genuinely clean
    // review and the corpus gained a row for a review that found nothing.
    const items = reviewBodyItems(r.body, reviewsWithFindings.has(r.id));
    if (items.length) reviewsWithFindings.add(r.id);
    for (const item of items) {
      rows.push(
        row({
          pr,
          prTitle: r.title,
          ...item,
          url: r.url,
          resolved: null,
          source: 'review-body',
          reviewId: r.id,
        }),
      );
    }
  }

  for (const c of paginate(
    pr,
    `comments(first:50, after:$endCursor){
       pageInfo{ hasNextPage endCursor }
       nodes{ author{ login } body url } }`,
    '$pr.comments.nodes[] | {title: $pr.title} + .',
  )) {
    if (!isReviewer(c.author?.login)) continue;
    rows.push(
      row({
        pr,
        prTitle: c.title,
        file: '(conversation)',
        line: null,
        url: c.url,
        finding: findingLine(c.body),
        resolved: null,
        source: 'conversation',
      }),
    );
  }

  return rows;
}

if (isCli) {
  const [, , cmd, ...rest] = process.argv;

  if (cmd === 'harvest') {
    // `--review <id>` records one round rather than the whole PR.
    //
    // Without it, every iteration of the loop re-harvested every finding the PR had ever
    // had, with `category` and `whyMissed` blank again — and `publish` validates
    // classifications before it deduplicates, so round two onwards demanded that everything
    // already published be classified a second time. The instruction said "harvest the
    // round"; the command harvested the PR.
    const reviewFlag = rest.indexOf('--review');
    const onlyReview = reviewFlag === -1 ? null : rest[reviewFlag + 1];
    if (reviewFlag !== -1) {
      if (!onlyReview) {
        console.error('Usage: pr-review-analysis.mjs harvest <pr> … [--review <reviewId>]');
        process.exit(2);
      }
      rest.splice(reviewFlag, 2);
    }
    if (!rest.length) {
      console.error('Usage: pr-review-analysis.mjs harvest <pr> [<pr> …] [--review <reviewId>]');
      process.exit(2);
    }
    // Resolved here, before the output file exists. `--review` narrows the harvest to one
    // review, so an id matching nothing records an empty round exactly as a clean one does —
    // and the skill passes the same id to `round`, so one wrong argument silences the verdict
    // and the record together. The check has to come before the `writeFile` below, because a
    // guard that fired afterwards would leave an empty file that the existence check then
    // refuses to overwrite, turning a bad argument into a blocked retry.
    const harvestReview = onlyReview ? requireReviewOnPr(rest, onlyReview, 'The harvest') : null;
    await mkdir(OUT_DIR, { recursive: true });
    const out = resolve(OUT_DIR, harvestFileName(rest));
    // One invocation, one file. The name used to be the UTC date, so a second harvest the same
    // day appended to a file that had already been classified and published, and the next
    // `publish` re-posted those rows to Confluence. A batch of PRs in one invocation still
    // shares one file, which is the point of accepting several; two invocations never do.
    if (existsSync(out)) {
      console.error(
        `\n${out} already exists. Refusing to append to a file that may be published.\n`,
      );
      process.exit(1);
    }
    // Created up front, so the path printed below always exists. When a PR has no Copilot
    // findings the loop never appends, and the `publish` command this prints was then
    // rejected for a missing file — a clean first review could not complete the harvest step
    // the Definition of Done requires. An empty file publishes as zero findings.
    await writeFile(out, '', { flag: 'wx' });
    let n = 0;
    const bySource = {};
    for (const pr of rest) {
      const entries = harvestReview
        ? harvestPr(pr).filter((r) => r.reviewId === harvestReview.id)
        : harvestPr(pr);
      for (const entry of entries) {
        await appendFile(out, `${JSON.stringify(entry)}\n`, 'utf8');
        bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
        n += 1;
      }
    }
    // Printed per source so a zero where feedback exists is visible rather than assumed away.
    const breakdown = Object.entries(bySource)
      .map(([source, count]) => `${count} ${source}`)
      .join(', ');
    console.log(
      `\nHarvested ${n} Copilot finding(s) from PR(s) ${rest.join(', ')}${breakdown ? ` — ${breakdown}` : ''}`,
    );
    console.log(`  ${out}\n`);
    console.log('Now fill in `category` and `whyMissed` on each row, then publish.');
    console.log(`Categories: ${Object.keys(CATEGORIES).join(', ')}\n`);
  } else if (cmd === 'publish') {
    const file = rest[0];
    if (!file || !existsSync(file)) {
      console.error('Usage: pr-review-analysis.mjs publish <file.jsonl>');
      process.exit(2);
    }
    const rows = (await readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    // `.trim()`, not truthiness: `"   "` is truthy, so a row whose classification is spaces
    // used to pass this check and publish as a visibly blank cell — exactly what the check
    // below says it refuses to do.
    const filled = (v) => typeof v === 'string' && v.trim().length > 0;
    const unclassified = rows.filter((r) => !filled(r.category) || !filled(r.whyMissed));
    if (unclassified.length) {
      console.error(
        `\n${unclassified.length} of ${rows.length} row(s) have no category or whyMissed.\n` +
          'Publishing them would put blanks in the column the page exists for. Classify first:\n' +
          unclassified
            .slice(0, 5)
            .map((r) => `  #${r.pr} ${r.file}:${r.line}`)
            .join('\n') +
          '\n',
      );
      process.exit(1);
    }
    // `Object.hasOwn`, not indexing: `CATEGORIES['toString']` is an inherited function and
    // therefore truthy, so `toString`, `constructor` and `valueOf` all passed as valid
    // classes. Only the vocabulary declared above is accepted.
    const bad = rows.filter((r) => !Object.hasOwn(CATEGORIES, r.category));
    if (bad.length) {
      console.error(
        `\nUnknown category on ${bad.length} row(s): ${[...new Set(bad.map((b) => b.category))].join(', ')}`,
      );
      console.error(`Valid: ${Object.keys(CATEGORIES).join(', ')}\n`);
      process.exit(1);
    }

    const auth = confluenceAuth();
    const { page, storage } = await readPage(auth);

    const heading = storage.indexOf('<h2>Findings</h2>');
    const close = heading === -1 ? -1 : storage.indexOf('</tbody>', heading);
    if (close === -1) {
      console.error('\nNo <h2>Findings</h2> heading with a table below it. Re-seed the page.\n');
      process.exit(1);
    }

    const cell = (v) => `<td><p>${esc(v)}</p></td>`;
    const anchor = (r) => `<a href="${esc(r.url)}">`;

    /**
     * What identifies a finding on the page.
     *
     * Not the URL. Every suppressed finding parsed out of one review body carries that
     * review's URL, so keying on it meant the first row published from a review marked all
     * its siblings as already there — the dedupe silently dropped real findings, which is
     * worse than the duplication it was added to prevent. The link plus the finding text is
     * unique per finding and is a literal substring of the row this code writes, so
     * `storage.includes` on it is exact.
     */
    const identity = (r) => `${anchor(r)}${esc(r.file)}</a></p></td>${cell(r.finding)}`;

    // Idempotent on the comment URL, decided **before** the PUT.
    //
    // The corpus append below already dedupes, but it runs after the page has been written and
    // the page body was built from every row, so re-publishing a classified file appended the
    // same rows to Confluence again while the corpus correctly ignored them. A failure between
    // the PUT and the append had the same effect on a retry. The URL is the stable identity of
    // a finding, and it is already in the page as the row's link, so the page itself says what
    // has been published.
    const pending = rows.filter((r) => !storage.includes(identity(r)));

    if (pending.length) {
      const body = pending
        .map(
          (r) =>
            '<tr>' +
            cell(`#${r.pr}`) +
            `<td><p>${identity(r)}` +
            cell(r.category) +
            cell(r.whyMissed) +
            '</tr>',
        )
        .join('\n');

      const put = await fetch(`${CONFLUENCE}/api/v2/pages/${PAGE_ID}`, {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: PAGE_ID,
          status: 'current',
          title: page.title,
          body: {
            representation: 'storage',
            value: `${storage.slice(0, close)}${body}\n${storage.slice(close)}`,
          },
          version: {
            number: page.version.number + 1,
            message: `pr-review-analysis: ${pending.length} finding(s)`,
          },
        }),
      });
      if (!put.ok) {
        console.error(`Publish failed (HTTP ${put.status}): ${(await put.text()).slice(0, 300)}`);
        process.exit(1);
      }
    }

    const already = rows.length - pending.length;
    console.log(
      `Published ${pending.length} finding(s) to ${CONFLUENCE}/pages/${PAGE_ID}` +
        (already ? ` (${already} already there, skipped)` : ''),
    );
    // Nothing tracked is written, by design — see the note above `SKILL`. There is nothing to
    // stage, so publishing is no longer something a pull request has to carry, and no longer
    // has to happen before the review loop's last round.
    console.log('Nothing written to the repository; the page is the record.');
  } else if (cmd === 'latest-review') {
    const [pr] = rest;
    if (!pr) {
      console.error('Usage: pr-review-analysis.mjs latest-review <pr>');
      process.exit(2);
    }
    let latest;
    try {
      latest = latestReviewOfHead(pr);
    } catch (error) {
      console.error(`\nCould not read the reviews on #${pr}: ${error.message.split('\n')[0]}\n`);
      process.exit(3);
    }
    // `none` rather than an error, so the loop can bootstrap. A PR that has never been
    // reviewed — #170 is one — has no review nodes, and exiting non-zero here killed the
    // caller's `BEFORE=$(…) || exit 1` before the first review was ever requested. `none`
    // compares unequal to any real id, which is exactly what the poll needs. It also covers
    // "reviews exist but none of them reviewed this head", which is the same thing for the
    // loop's purposes: there is no verdict on the commit you pushed. A genuine API failure
    // still exits 3, so "no review of this head" and "could not ask" stay distinguishable.
    console.log(latest ? latest.id : 'none');
  } else if (cmd === 'round') {
    const [pr, reviewId] = rest;
    if (!pr || !reviewId) {
      console.error('Usage: pr-review-analysis.mjs round <pr> <reviewId>');
      process.exit(2);
    }
    // The exit code carries the verdict so the caller needs no parsing: 0 clean, 1 findings,
    // 2 usage, 3 could-not-tell. 3 exists because an API failure exiting 1 would be
    // indistinguishable from "found something" — survivable, but it would make "clean" the
    // only trustworthy code, and this loop has already been bitten three times by an error
    // wearing a verdict's clothes.
    //
    // An id that matches no review on this PR is the fourth. It is not an API failure, so
    // nothing threw: the filter simply matched nothing and zero findings read as a clean
    // round. Resolve it first, so "no findings" can only ever mean a real review found none.
    const review = requireReviewOnPr(pr, reviewId, 'The round');
    let found;
    try {
      found = roundFindings(pr, review.id);
    } catch (error) {
      console.error(`\nCould not read #${pr}: ${error.message.split('\n')[0]}`);
      console.error('The round is UNKNOWN, not clean.\n');
      process.exit(3);
    }
    const bySource = {};
    for (const r of found) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    const breakdown = Object.entries(bySource)
      .map(([source, count]) => `${count} ${source}`)
      .join(', ');
    console.log(`round findings: ${found.length}${breakdown ? ` (${breakdown})` : ''}`);
    for (const r of found) {
      console.log(`  [${r.source}] ${r.file}:${r.line} — ${r.finding.slice(0, 120)}`);
    }
    process.exit(found.length === 0 ? 0 : 1);
  } else if (cmd === 'stats') {
    // Read, not embedded. The skill quotes no figure precisely so that this is the only place
    // a number comes from, and a number fetched at the moment you read it cannot go stale in a
    // file nobody re-derived.
    const rows = findingsOnPage((await readPage(confluenceAuth())).storage);
    const ordered = ranking(rows);
    const prs = new Set(rows.map((r) => r.pr));
    const top3 = ordered.slice(0, 3).reduce((n, [, c]) => n + c, 0);
    console.log(`\n${rows.length} findings across ${prs.size} pull requests.`);
    console.log(
      `The ${ordered.length > 3 ? 'three largest classes are' : 'classes are'} ${top3} of ${rows.length}.\n`,
    );
    console.log(
      table([['Class', 'Findings'], ...ordered.map(([c, n]) => [c, String(n)])]).join('\n'),
    );
    console.log(`\n${CONFLUENCE}/pages/${PAGE_ID}\n`);
  } else if (cmd === 'check-order') {
    // The skill's three numbered sections are ordered by weight, and that ordering is an
    // assertion about the findings, not a layout choice: the reader is told where to spend
    // their attention first. It is the one claim the skill still makes about the distribution,
    // now that it quotes no counts — so it is the one thing left to verify.
    //
    // Run deliberately, not as a gate. It needs Confluence credentials, and a check that
    // cannot run in CI must not be something a pull request depends on.
    const top = ranking(findingsOnPage((await readPage(confluenceAuth())).storage))
      .slice(0, 3)
      .map(([c]) => c);
    const text = await readFile(SKILL, 'utf8');
    const written = [...text.matchAll(/^## [123]\. .*`([a-z-]+)`/gm)].map((m) => m[1]);
    if (written.join() !== top.join()) {
      console.error(
        `\nThe skill's numbered sections are ordered ${written.join(' → ') || '(none found)'},\n` +
          `but the page ranks them ${top.join(' → ')}. Re-order the sections, or re-check\n` +
          'the classification — the section order tells the reader what to look at first.\n',
      );
      process.exit(1);
    }
    console.log(`skill sections match the page ranking (${top.join(' → ')})`);
  } else {
    console.error(
      'Usage: pr-review-analysis.mjs harvest <pr> … | publish <file> | latest-review <pr> | ' +
        'round <pr> <reviewId> | stats | check-order',
    );
    process.exit(2);
  }
}

/**
 * A harvest file name that is unique per invocation: a UTC timestamp to the millisecond plus
 * the PRs it covers, e.g. `2026-09-14T13-45-00-123Z-pr182.jsonl`. Sorts chronologically, and
 * names its contents so a stale file is recognisable before it is published.
 */
export function harvestFileName(prs, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const label = prs.length <= 3 ? `pr${prs.join('+')}` : `pr${prs[0]}+${prs.length - 1}more`;
  return `${stamp}-${label}.jsonl`;
}

/** A Markdown table padded the way Prettier pads one: columns to their widest cell. */
function table([header, ...body]) {
  const w = header.map((_, i) => Math.max(...[header, ...body].map((r) => r[i].length)));
  const row = (cells) => `| ${cells.map((c, i) => c.padEnd(w[i])).join(' | ')} |`;
  return [row(header), `| ${w.map((n) => '-'.repeat(n)).join(' | ')} |`, ...body.map(row)];
}

function readIf(f) {
  try {
    return readFileSync(f, 'utf8').trim();
  } catch {
    return null;
  }
}
