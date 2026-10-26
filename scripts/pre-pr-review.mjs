#!/usr/bin/env node
/**
 * The mechanisable part of a pre-PR review.
 *
 *   node scripts/pre-pr-review.mjs            # the whole working tree's changed files
 *   node scripts/pre-pr-review.mjs --base <ref>
 *   node scripts/pre-pr-review.mjs --all      # every file, not just the diff
 *
 * ## Why these checks and not others
 *
 * Built from the reviewer findings on the PR Review analysis page, classified by *why* they were
 * missed rather than what they were. The distribution said something useful: almost none were
 * logic errors. In every case the author understood the problem and wrote code that solved it,
 * and what went wrong was the gap between what the code does and what the author believed it
 * does — invisible from the inside, because the belief is what produced the code.
 *
 * So the checks worth automating are the ones that **compare two artifacts** rather than
 * inspect one. Three classes are mechanisable that way and are implemented here:
 *
 *   silent-failure    an error path that reports success
 *   broken-reference  a link or path that does not resolve
 *   false-claim       (partly) docs naming a command or file that does not exist
 *
 * The other classes — `proxy-check`, `unenforced-guarantee`, `stale-prose` — need judgement and
 * live in `.cursor/skills/pre-pr-review/SKILL.md`. They are the majority, which is worth
 * stating plainly: **a green run here is not a review.** It clears the floor so a reader spends
 * their attention on the three classes a grep cannot see.
 *
 * Per-class counts are deliberately not repeated here; the ones that were had already gone
 * stale against the page. `npm run review:analysis -- stats` reads them from the record.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const arg = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : null);
const base = arg('base') ?? 'origin/main';
const all = argv.includes('--all');

/** @type {{file:string,line:number,rule:string,message:string}[]} */
const findings = [];
const report = (file, line, rule, message) => findings.push({ file, line, rule, message });

/**
 * Fail closed, and say what git said.
 *
 * This used to return `''` on any failure, which made every git error indistinguishable from
 * "nothing changed". A missing or mistyped `--base` made both `merge-base` and the diff fail,
 * and an otherwise clean tree was reported as a passing zero-file review — the checker's most
 * reassuring output produced by its inability to see any code at all.
 */
function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  } catch (error) {
    const detail = String(error.stderr ?? '').trim() || error.message;
    console.error(`\ngit ${args.join(' ')} failed:\n  ${detail}\n`);
    process.exit(1);
  }
}

/**
 * `git` for the one question whose failure is itself an answer: two refs can legitimately have
 * no common ancestor, and the documented fallback below is to diff from `base` directly. Every
 * other call goes through `git` and stops the run.
 */
function gitOptional(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    return '';
  }
}

/**
 * Only what *this* branch changed.
 *
 * `git diff <base>` reports files that differ in either direction, so once the base moves
 * ahead it lists other people's work too — the first run of this file reported three findings
 * in a file the branch had never touched, which is how a tool earns the reputation of being
 * noise. Diffing from the merge base asks the question that was meant: what did I change?
 */
const mergeBase = gitOptional(['merge-base', base, 'HEAD']).trim() || base;
/**
 * Untracked-but-not-ignored files, in both modes.
 *
 * Neither mode could see them: the diff modes read git diffs, which say nothing about a file
 * git has never heard of, and `--all` used bare `ls-files`, which lists the index. So a
 * newly authored script or document — the most likely place for a new defect, and the normal
 * state of a file until the moment it is staged — was reported as a clean tree. Same reason
 * and same call as `scripts/review-guardrails.mjs`, which learned this earlier.
 */
const untracked = () => git(['ls-files', '--others', '--exclude-standard']).split('\n');

const touched = (
  all
    ? [...git(['ls-files']).split('\n'), ...untracked()]
    : [
        ...git(['diff', '--name-only', `${mergeBase}..HEAD`, '--']).split('\n'),
        ...git(['diff', '--name-only', '--cached']).split('\n'),
        ...git(['diff', '--name-only']).split('\n'),
        ...untracked(),
      ]
)
  .map((f) => f.trim())
  .filter(Boolean)
  .filter((f, i, a) => a.indexOf(f) === i);

/**
 * Generated mirrors of `.cursor/`, which must not be reviewed.
 *
 * `.claude/` and `.agent/` are byte-identical copies produced by `mirror-agent-config.mjs`.
 * Scanning them reported every finding three times and attributed it to a file that is not the
 * source, so the fix a reader was sent to make would have been overwritten by the next sync.
 * Syncing the mirrors also drags 74 untouched files into the diff, which turned a focused
 * review into a wall — and a tool whose output is mostly noise is a tool whose output is
 * skimmed. Findings in a mirrored skill are reported against `.cursor/`, where they belong.
 */
const GENERATED = /^\.(claude|agent)\//;

const files = touched.filter(
  (f) =>
    !GENERATED.test(f) &&
    existsSync(resolve(repoRoot, f)) &&
    statSync(resolve(repoRoot, f)).isFile(),
);

/**
 * Markdown this change **removed or renamed away**.
 *
 * The line above drops anything that no longer exists, which is right for a scanner that
 * reads file contents and wrong for the link check: deleting `docs/x.md` breaks every link to
 * it, and all of those live in files this diff did not touch, so the run was clean while the
 * change it was judging had broken the tree. Deletions are the one case where the blast radius
 * is outside the diff, so when there are any, the link check widens to every tracked
 * Markdown file. That is affordable — a few hundred files, a regex each — and it is the only
 * way the rule can see what it claims to cover.
 */
const deletedMarkdown = touched.filter(
  (f) => f.endsWith('.md') && !existsSync(resolve(repoRoot, f)),
);
const linkScanFiles = deletedMarkdown.length
  ? [...git(['ls-files', '*.md']).split('\n'), ...untracked().filter((f) => f.endsWith('.md'))]
      .map((f) => f.trim())
      .filter((f) => f && existsSync(resolve(repoRoot, f)))
      .filter((f, i, a) => a.indexOf(f) === i)
  : files.filter((f) => f.endsWith('.md'));

const read = (f) => readFileSync(resolve(repoRoot, f), 'utf8');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * One pass over the source producing two views, both the same length as the input so every
 * offset and line number is shared:
 *
 *   `code`   strings, template literals **and** comments blanked — what patterns run against
 *   `prose`  strings blanked, comments kept — what the rationale check reads
 *
 * Two views rather than one because the two questions are opposites, and every version that
 * tried to answer both from a single string was wrong in one direction or the other:
 *
 * - Raw source flagged this file's own documentation, which names the swallow pattern as an
 *   example. A checker that fires on its own prose is one people switch off. → blank strings.
 * - An apostrophe in a comment is not a quote. `// don't discard this` opened a quoted region
 *   that ran to the end of the file and hid every subsequent defect — in most prose. → track
 *   comment state.
 * - Keeping comment text in the matched view reintroduced the first problem. → blank comments
 *   in `code`.
 * - Reading raw text for the rationale check then meant a `//` **inside a string** counted as
 *   a comment, so `fetch('https://example').catch(() => {})` was excused by its own URL.
 *   → give the rationale check `prose`, where that `//` is blanked and real comments are not.
 * - Every quote outside a comment was a string opener, but a regex literal can contain one:
 *   `const pattern = /isn't/;` opened a region that swallowed the next `.catch(() => {})`.
 *   This file is itself full of `/…['"]…/`, so the rule was blind to its own neighbourhood.
 *   → lex regex literals too.
 *
 * Whether `/` starts a regex or divides is not decidable from one character, so the usual
 * heuristic is used: it is a regex when the previous significant character is one that cannot
 * end an expression (`(,=:[!&|?{};` or a line start), or the previous word is `return`,
 * `typeof`, `case` or `in`. Division always follows a value, so the two do not overlap in
 * practice. Escapes and character classes are tracked, because `/[/]/` and `/\//` both
 * contain a `/` that does not close the literal.
 */
function maskSource(text) {
  let code = '';
  let prose = '';
  let quote = null;
  let comment = null; // 'line' | 'block'
  let regex = null; // { inClass: boolean }

  /** Could a `/` here begin a regex literal rather than divide? */
  const regexCanStart = () => {
    const before = code.replace(/\s+$/, '');
    if (!before) return true;
    const last = before[before.length - 1];
    if ('(,=:[!&|?{};+-*%~^<>'.includes(last)) return true;
    return /\b(return|typeof|case|in|of|do|else|yield|await|void|delete)$/.test(before);
  };

  const both = (c) => {
    code += c;
    prose += c;
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (comment) {
      if (comment === 'line' && c === '\n') {
        comment = null;
        both(c);
        continue;
      }
      if (comment === 'block' && c === '*' && text[i + 1] === '/') {
        code += '  ';
        prose += '*/';
        i += 1;
        comment = null;
        continue;
      }
      code += c === '\n' ? c : ' ';
      prose += c;
      continue;
    }

    if (regex) {
      if (c === '\\') {
        code += '  ';
        prose += '  ';
        i += 1;
        continue;
      }
      if (c === '[') regex.inClass = true;
      else if (c === ']') regex.inClass = false;
      else if (c === '/' && !regex.inClass) {
        regex = null;
        both(c);
        continue;
      }
      const blank = c === '\n' ? c : ' ';
      code += blank;
      prose += blank;
      continue;
    }

    if (quote) {
      if (c === '\\') {
        code += '  ';
        prose += '  ';
        i += 1;
        continue;
      }
      if (c === quote) {
        quote = null;
        both(c);
        continue;
      }
      const blank = c === '\n' ? c : ' ';
      code += blank;
      prose += blank;
      continue;
    }

    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      comment = text[i + 1] === '/' ? 'line' : 'block';
      code += '  ';
      prose += c + text[i + 1];
      i += 1;
      continue;
    }
    if (c === '/' && regexCanStart()) {
      regex = { inClass: false };
      both(c);
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      both(c);
      continue;
    }
    both(c);
  }
  return { code, prose };
}

// ---------------------------------------------------------------- silent-failure

/**
 * An error path that reports success.
 *
 * Five findings, and two of them were the *same* flaw in a sibling call that had been fixed
 * one round earlier — a `curl` in an upload helper and a `curl` in the remote-link POST. That
 * is the argument for a grep rather than a habit.
 */
function silentFailure(file) {
  const text = read(file);
  const { code, prose } = maskSource(text);

  // Shell and docs only. In JavaScript a `curl …` is inside a string, and the masking above
  // is what stops that being reported — but the command it documents is still worth checking
  // when it appears in a fenced block, which is how the skills ship theirs.
  //
  // Backslash continuations are joined first, by replacing the `\` and the newline with two
  // spaces. Two characters for two, so every offset survives and `lineOf` still reports the
  // line `curl` is on. Without it `[^\n]*` stopped at the first physical newline, and since a
  // real write is almost always wrapped — the upload helper in `fix-bug/SKILL.md` puts `-F` on
  // the next line — the check only ever saw the first line of the command it was judging.
  // Deleting that helper's `--fail-with-body` left `writes` false and the gate green.
  const joined = text.replace(/\\\n/g, '  ');
  const curls = /\.(sh|md|mdc)$/.test(file)
    ? [...joined.matchAll(/curl\s+(-[A-Za-z-]+\s+|--[a-z-]+(=\S+)?\s+)*[^\n]*/g)]
    : [];
  for (const m of curls) {
    const cmd = m[0];
    const writes = /-X\s*(POST|PUT|PATCH|DELETE)|(^|\s)(-F|--form|-d|--data)\b/.test(cmd);

    // `--fail`/`--fail-with-body` make curl itself exit non-zero. `-w '%{http_code}'` does
    // not: it only *prints* the status, so a write that returned 500 was classified as
    // guarded while the script sailed past it — the same shape of defect the rule exists to
    // catch, inside the rule. It counts only when something downstream tests the status.
    // Complete option tokens. `/--fail\b/` also matches `--fail-early`, because `\b` succeeds
    // before a hyphen — and `--fail-early` does not make an HTTP error fail, it only aborts a
    // multi-transfer run sooner, so a write carrying it alone was cleared.
    const failsHard = /(?:^|\s)(?:--fail|--fail-with-body|-[A-Za-z]*f[A-Za-z]*)(?=\s|$)/.test(cmd);

    // `%{http_code}` specifically, for both option spellings. A bare `--write-out` can emit
    // anything: `--write-out '%{url_effective}'` compared with `!=` used to read as an
    // HTTP-error guard, so a 500 passed.
    const printsStatus = /(?:-w|--write-out)[=\s]+['"]?[^'"\n]*%\{http_code\}/.test(cmd);

    // "Something downstream tests it" has to mean *this* variable, in *this* condition.
    // Two earlier attempts were too loose. The first looked for any test operator in the
    // following lines and cleared an unguarded write because the *next* command checked its
    // own status. The second required the variable and an operator to both appear, but
    // independently — so `echo "$status"` followed by `[ "$retry" -eq 1 ]` satisfied it. The
    // reference and the operator now have to sit inside one test expression.
    // The optional quote is load-bearing. `var=$(curl …)` was recognised but `var="$(curl …)"`
    // was not, and the quoted form is the one everything in this repo actually writes — so the
    // rule flagged two calls that capture `%{http_code}` and branch on it, which is the very
    // remedy its own message recommends. A checker that reports the recommended fix as a defect
    // is a checker whose output gets skimmed and then ignored.
    const captured = /(\w+)=["']?(?:\$\(|`)\s*$/.exec(joined.slice(0, m.index));
    const after = joined
      .slice(m.index + cmd.length)
      .split('\n')
      .slice(0, 6)
      .join('\n');
    let statusTested = false;
    if (printsStatus && captured !== null) {
      const ref = `\\$\\{?${captured[1]}\\}?`;
      const op = '(?:-eq|-ne|-ge|-gt|-lt|-le|==|!=|=~)';
      statusTested =
        new RegExp(
          `(?:\\[\\[?|\\btest\\b)[^\\n\\]]*(?:${ref}\\s*"?\\s*${op}|${op}\\s*"?\\s*${ref})`,
        ).test(after) || new RegExp(`\\bcase\\s+"?${ref}`).test(after);
    }

    if (writes && !failsHard && !statusTested) {
      report(
        file,
        lineOf(text, m.index),
        'silent-failure',
        'curl writes but cannot fail: `-s` exits 0 on HTTP 4xx/5xx. Add --fail-with-body, or capture %{http_code} and branch on it.',
      );
    }
  }

  // A rejection swallowed whole. An empty handler discards the reason as well as the failure.
  for (const m of code.matchAll(
    /\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\}|null|undefined|void 0)\s*\)/g,
  )) {
    const line = lineOf(code, m.index);
    // `prose`, not the raw text: a `//` inside a string is not a comment, and reading raw
    // source let `fetch('https://example').catch(() => {})` excuse itself with its own URL.
    const context = prose
      .split('\n')
      .slice(Math.max(0, line - 4), line)
      .join('\n');
    // A comment saying why is the difference between a decision and an oversight.
    if (!/\/\/|\/\*/.test(context)) {
      report(
        file,
        line,
        'silent-failure',
        'empty `.catch()` with no comment: the failure and its reason are both discarded. Handle it, or say in a comment why losing it is correct.',
      );
    }
  }
}

// ---------------------------------------------------------------- broken-reference

/**
 * A relative link that does not resolve. One finding, and it shipped in four places at once.
 *
 * Every relative target, not only the ones written `./` or `../`. The first version required
 * that prefix, which is the least common way to write a same-directory link: a plain
 * `[text](07-risks.md)` — the form the `AGENTS/` and `docs/` trees actually use — was never
 * checked at all, so the rule could not catch a broken link in the majority of the links it
 * claimed to cover.
 *
 * Excluded, because they are not paths this repo can resolve: anything with a URL scheme,
 * protocol-relative `//host`, root-relative `/path` (resolved by the docs site, not the
 * filesystem), and pure `#anchor` fragments.
 */
function brokenReference(file) {
  if (!file.endsWith('.md')) return;
  const text = read(file);
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const raw = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue; // http:, mailto:, tel:
    if (raw.startsWith('//') || raw.startsWith('/') || raw.startsWith('#')) continue;
    const target = resolve(repoRoot, dirname(file), raw.split('#')[0]);
    if (!existsSync(target)) {
      report(file, lineOf(text, m.index), 'broken-reference', `link does not resolve: ${raw}`);
    }
  }
}

// ---------------------------------------------------------------- false-claim

/**
 * Docs naming something that does not exist.
 *
 * Partial cover for `false-claim`: it cannot tell whether prose is *true*, but it can tell
 * whether the command it tells you to run is real. Four findings were claims contradicted by
 * the tree, including a PR body citing a file that had never been changed.
 */
let pkgScripts = null;

/** npm options that take no value, so the next word is still a candidate script name. */
const NPM_FLAG_OPTIONS = new Set([
  '-s',
  '--silent',
  '-q',
  '--quiet',
  '-d',
  '--verbose',
  '--if-present',
  '--ignore-scripts',
  '--foreground-scripts',
  '--json',
  '--parseable',
]);
/** npm options that take the next word as their value when written without `=`. */
const NPM_VALUE_OPTIONS = new Set([
  '--script-shell',
  '--loglevel',
  '--userconfig',
  '--registry',
  '--cache',
]);
/** npm options that change which `package.json` the script is looked up in. */
const NPM_MANIFEST_OPTIONS = new Set([
  '-w',
  '--workspace',
  '-ws',
  '--workspaces',
  '--include-workspace-root',
  '--prefix',
  '-C',
]);

/**
 * The script name in the words after `npm run`, skipping the options before it —
 * `--silent config:dev`, `--registry https://r.example test`.
 *
 * Returns `null`, so the command goes unchecked, for an option that points npm at another
 * manifest — this check reads only the root `package.json` — and for an option it does not
 * recognise. Guessing an unknown option's arity would either name the wrong word as the script or
 * skip past a missing one, and npm's own option table is not a dependency of this repository.
 */
function npmRunScript(words) {
  const tokens = words.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('-')) return /^[a-z0-9:._-]+/i.exec(token)?.[0] ?? null;
    const name = token.split('=')[0];
    if (NPM_MANIFEST_OPTIONS.has(name)) return null;
    if (NPM_FLAG_OPTIONS.has(token)) continue;
    if (token.includes('=') && (NPM_FLAG_OPTIONS.has(name) || NPM_VALUE_OPTIONS.has(name)))
      continue;
    if (NPM_VALUE_OPTIONS.has(token)) {
      i += 1;
      continue;
    }
    return null;
  }
  return null;
}

// Regression cases for the parser, run on every invocation so it cannot regress unnoticed.
for (const [words, want] of [
  ['beta:gate', 'beta:gate'],
  ['--silent config:dev -- --manifest x', 'config:dev'],
  ['--workspace docs test', null],
  ['--workspace=docs test', null],
  ['-w docs test', null],
  ['--workspaces test', null],
  ['--prefix=sub test', null],
  ['--loglevel=warn test', 'test'],
  ['--registry https://registry.example/ test', 'test'],
  ['--cache /tmp/npm-cache test', 'test'],
  ['--some-future-option value test', null],
  ['--some-future-option=value test', null],
  ['--json=false test', 'test'],
  ['beta:api -- --update', 'beta:api'],
  ['--silent', null],
]) {
  const got = npmRunScript(words);
  if (got !== want) {
    throw new Error(`pre-pr-review: npmRunScript(${JSON.stringify(words)}) is ${got}, not ${want}`);
  }
}

function falseClaim(file) {
  if (!/\.(md|mdc)$/.test(file)) return;
  const text = read(file);
  pkgScripts ??= Object.keys(JSON.parse(read('package.json')).scripts ?? {});

  for (const m of text.matchAll(/npm run((?:[ \t]+[^\s`'"|;&)]+)+)/gi)) {
    const script = npmRunScript(m[1]);
    if (script && !pkgScripts.includes(script)) {
      report(
        file,
        lineOf(text, m.index),
        'false-claim',
        `\`npm run ${script}\` is not a script in package.json`,
      );
    }
  }
  // The extension has to be the end of the path, not a prefix of it: without the boundary,
  // `…/proxy.parity.json` matched as far as `.js` and was then reported as a file that does not
  // exist, naming a path nobody had written. Anchored on a non-path character so a longer
  // extension is left to the next iteration rather than truncated into a false claim.
  for (const m of text.matchAll(
    /(?:^|[\s`(])(scripts\/[A-Za-z0-9/._-]+\.(?:mjs|sh|js))(?![A-Za-z0-9])/g,
  )) {
    if (!existsSync(resolve(repoRoot, m[1]))) {
      report(
        file,
        lineOf(text, m[1] ? m.index : 0),
        'false-claim',
        `references a file that does not exist: ${m[1]}`,
      );
    }
  }
}

// ---------------------------------------------------------------- run

const scanned = files.filter(
  (f) => /\.(mjs|js|ts|sh|md|mdc)$/.test(f) && !f.startsWith('node_modules/'),
);

// `brokenReference` runs over its own file set, because a deletion breaks links in files the
// diff never touched. See `linkScanFiles`.
const RUNS = [
  { check: silentFailure, over: scanned },
  { check: falseClaim, over: scanned },
  { check: brokenReference, over: linkScanFiles.filter((f) => !f.startsWith('node_modules/')) },
];

for (const { check, over } of RUNS) {
  for (const f of over) {
    try {
      check(f);
    } catch (err) {
      report(f, 0, 'internal', `check ${check.name} threw: ${err.message}`);
    }
  }
}

console.log(
  `\npre-PR review — ${scanned.length} changed file(s) ${all ? 'across the whole tree' : `since ${mergeBase.slice(0, 8)}`}` +
    (deletedMarkdown.length
      ? `\n  ${deletedMarkdown.length} Markdown file(s) deleted, so links are checked across all ${linkScanFiles.length} tracked Markdown files\n`
      : '\n'),
);

if (findings.length) {
  const byRule = findings.reduce(
    (acc, f) => ({ ...acc, [f.rule]: [...(acc[f.rule] ?? []), f] }),
    {},
  );
  for (const [rule, list] of Object.entries(byRule)) {
    console.log(`  ${rule} — ${list.length}`);
    for (const f of list) console.log(`    ${f.file}:${f.line}\n      ${f.message}`);
    console.log('');
  }
}

console.log(
  findings.length
    ? `FAIL — ${findings.length} finding(s)\n`
    : 'pass — no mechanisable defect found\n',
);
console.log(
  '  This clears the floor; it is not a review. The three largest classes — proxy-check,\n' +
    '  unenforced-guarantee and stale-prose — need judgement, and are the majority of\n' +
    '  everything recorded. Work through\n' +
    '  .cursor/skills/pre-pr-review/SKILL.md before opening the PR.\n',
);

process.exit(findings.length ? 1 : 0);
