#!/usr/bin/env node
/**
 * Controls for `confluence-links.mjs`, plus one check against the publishing manifest.
 *
 * The manifest check covers a pin nothing compared: `documentation/MANIFEST.json` named
 * `feature/adf-hx-browse-poc`, frozen since 2026-09-07 and 1364 commits behind `main` when
 * replaced, so every repository link on the published pages showed month-old code.
 * The pin has to be the default branch; this asserts it against the remote's own record rather
 * than against a literal, when that record is available.
 *
 * Usage:  node scripts/confluence-links.selftest.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { docLinkTarget } from './confluence-links.mjs';

const ROOT = join(import.meta.dirname, '..');
const pageTitles = new Map([
  ['README.md', 'Documentation index'],
  ['20-product/00-the-short-version.md', 'The short version'],
  ['30-engineering/04-codebase-reference.md', 'Codebase reference'],
]);
const isDirectory = (p) =>
  statSync(join(ROOT, p), { throwIfNoEntry: false })?.isDirectory() ?? false;
const ctx = { pageTitles, branch: 'main', isDirectory };
const BLOB = 'https://github.com/nuxeo/agentic-ui-poc/blob/main';
const TREE = 'https://github.com/nuxeo/agentic-ui-poc/tree/main';

const CONTROLS = [
  [
    'repository file keeps its line anchor',
    [
      '../../scripts/beta-harness/verify-gate.mjs#L35',
      '30-engineering/08-dev-harness-and-gates.md',
    ],
    { kind: 'url', url: `${BLOB}/scripts/beta-harness/verify-gate.mjs#L35` },
  ],
  [
    'repository file keeps its section anchor',
    ['../../AGENTS.md#6-where-things-live', '30-engineering/01-getting-started.md'],
    { kind: 'url', url: `${BLOB}/AGENTS.md#6-where-things-live` },
  ],
  [
    '"." on a section page is the section directory under documentation/',
    ['.', '30-engineering/03-repository-guide.md'],
    { kind: 'url', url: `${TREE}/documentation/30-engineering` },
  ],
  [
    'repository directory is a /tree/ route',
    ['../../scripts/beta-harness/', '30-engineering/08-dev-harness-and-gates.md'],
    { kind: 'url', url: `${TREE}/scripts/beta-harness` },
  ],
  [
    'non-page file under documentation/ keeps its prefix',
    ['../MANIFEST.json', '30-engineering/03-repository-guide.md'],
    { kind: 'url', url: `${BLOB}/documentation/MANIFEST.json` },
  ],
  [
    'repository-root README is not the documentation index',
    ['../../README.md', '30-engineering/01-getting-started.md'],
    { kind: 'url', url: `${BLOB}/README.md` },
  ],
  [
    'sibling page becomes a page link with its anchor',
    ['../20-product/00-the-short-version.md#what-it-is', '30-engineering/02-architecture.md'],
    { kind: 'page', title: 'The short version', anchor: 'what-it-is' },
  ],
  [
    'documentation index from a section page',
    ['../README.md', '30-engineering/02-architecture.md'],
    { kind: 'page', title: 'Documentation index', anchor: null },
  ],
  [
    'same-page anchor stays on the page',
    ['#scope', '30-engineering/04-codebase-reference.md'],
    { kind: 'page', title: 'Codebase reference', anchor: 'scope' },
  ],
];

let failed = 0;
for (const [name, [href, rel], want] of CONTROLS) {
  const got = docLinkTarget(href, rel, ctx);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
}

let escapes = false;
try {
  docLinkTarget('../../../outside.md', '30-engineering/x.md', ctx);
} catch {
  escapes = true;
}
if (!escapes) failed += 1;
console.log(`${escapes ? 'ok  ' : 'FAIL'} a link resolving outside the repository is an error`);

let absolute = false;
try {
  docLinkTarget('/scripts/x.mjs', '30-engineering/x.md', ctx);
} catch {
  absolute = true;
}
if (!absolute) failed += 1;
console.log(`${absolute ? 'ok  ' : 'FAIL'} an absolute-path link is an error, not a guess`);

const { branch } = JSON.parse(readFileSync(join(ROOT, 'documentation', 'MANIFEST.json'), 'utf8'));
let defaultBranch = null;
try {
  defaultBranch = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .trim()
    .replace(/^origin\//, '');
} catch {
  // A clone without `origin/HEAD` (CI's checkout sets none) falls back to the repository's
  // documented default, which is the only branch PRs merge into.
}
const expected = defaultBranch ?? 'main';
const pinned = branch === expected;
if (!pinned) failed += 1;
console.log(
  `${pinned ? 'ok  ' : 'FAIL'} MANIFEST.json links against "${branch}", the default branch is "${expected}"` +
    (defaultBranch ? '' : ' (origin/HEAD not set; assumed)'),
);

const total = CONTROLS.length + 3;
console.log();
if (failed === 0) console.log(`confluence-links selftest: pass — ${total} control(s).`);
else {
  console.error(`confluence-links selftest: FAIL — ${failed} of ${total} control(s).`);
  process.exitCode = 1;
}
